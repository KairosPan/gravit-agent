/** src/memory-alert.ts: an alert as the memory is asked about it - what might be done on a hit, its facts, the
 * phone's block and the conversation's note, and the watch's ask on a stub memory, stub bars and an injected timer.
 * Nothing leaves the process and no real timer is waited on. */
import test from "node:test";
import assert from "node:assert/strict";
import type { Memory, RecallAnswer } from "gravit-memory";
import {
  ALERT_ASK_MS, ALERT_BLOCK_MAX, ALERT_FACTS_MS, ALERT_WORDS_MAX, alertBlock, alertConsidering, alertNote, createAlertLessons, hitFacts,
} from "../src/memory-alert.ts";
import type { Asked, GateLesson } from "../src/memory-ask.ts";
import { changeFacts } from "../src/memory-facts.ts";
import type { MemoryStanding } from "../src/memory.ts";
import type { UpstreamAnswer } from "../src/upstream-proxy.ts";
import type { AlertHit } from "../src/watch-eval.ts";

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const chars = (s: string): number => [...s].length;

/** A US hit on NVDA, a move up 10% on the day, not held; `over` laid on it. */
function hitOf(over: Partial<AlertHit> = {}, quote: Partial<NonNullable<AlertHit["quote"]>> = {}): AlertHit {
  return {
    t: "2026-03-02T15:00:01Z", kind: "alert", id: "a-1", pass: "p-1", date: "2026-03-02", key: "NVDA:move", market: "us", symbol: "NVDA",
    label: "NVDA", trigger: { type: "move", rule: "big-move", pct: 5 }, gap: false,
    quote: { market: "us", price: 176, asOf: "2026-03-02T15:00:00Z", feed: "cboe", status: "live", prevClose: 160, chgPct: 10, receivedAt: null, ...quote },
    holding: null, plan: null, source: { file: "rules.yml", index: 0 }, decision: "send", annotate: false, ...over,
  } as AlertHit;
}
const HELD = { qty: 10, avgCost: 140.8 };

test("alertConsidering: what might be done on a hit", () => {
  assert.deepEqual(alertConsidering(hitOf()), ["buy"]);
  assert.deepEqual(alertConsidering(hitOf({ holding: HELD })), ["add", "trim", "hold"]);
  assert.deepEqual(alertConsidering(hitOf({ holding: HELD }, { chgPct: -4 })), ["add", "sell", "hold"]);
  assert.deepEqual(alertConsidering(hitOf({ holding: HELD }, { chgPct: 0 })), ["add", "trim", "hold"]);
  assert.deepEqual(alertConsidering(hitOf({ holding: { qty: 10, avgCost: 140 } }, { chgPct: null })), ["add", "trim", "hold"]);
  assert.deepEqual(alertConsidering(hitOf({ holding: { qty: 10, avgCost: 200 } }, { chgPct: null })), ["add", "trim", "hold"], "up on the day, whatever the cost");
  assert.deepEqual(alertConsidering(hitOf({ holding: HELD }, { chgPct: null, prevClose: 200 })), ["add", "sell", "hold"]);
  assert.deepEqual(alertConsidering(hitOf({ holding: { qty: 10, avgCost: 140 } }, { chgPct: null, prevClose: null })), ["add", "trim", "hold"]);
  assert.deepEqual(alertConsidering(hitOf({ holding: { qty: 10, avgCost: 200 } }, { chgPct: null, prevClose: null })), ["add", "sell", "hold"]);
  assert.deepEqual(alertConsidering(hitOf({ holding: { qty: 10, avgCost: 200 } }, { chgPct: null, prevClose: 0 })), ["add", "sell", "hold"], "a previous close of zero is none");
  assert.deepEqual(alertConsidering(hitOf({ trigger: { type: "level", kind: "stop", price: 170, when: "cross_down" } as AlertHit["trigger"] })), ["buy"]);
  assert.deepEqual(alertConsidering(hitOf({ trigger: { type: "gap", rule: "gap", pct: 3 }, holding: HELD }, { chgPct: -4 })), ["add", "sell", "hold"]);
});

test("alertConsidering: nothing for a filing, a hit with no quote, or a symbol off its market's shape", () => {
  const filing = { type: "filing", rule: "8k", form: "8-K", accession: "x", accepted: null, filingDate: "2026-03-02", items: null, url: "u" } as AlertHit["trigger"];
  assert.equal(alertConsidering(hitOf({ trigger: filing })), undefined);
  assert.equal(alertConsidering(hitOf({ quote: null })), undefined);
  assert.equal(alertConsidering(hitOf({ symbol: "nvda" })), undefined);
  assert.equal(alertConsidering(hitOf({ market: "cn", symbol: "sh600519" })), undefined);
  assert.equal(alertConsidering(hitOf({ market: "cn", symbol: "NVDA" })), undefined);
  assert.deepEqual(alertConsidering(hitOf({ market: "cn", symbol: "600519" })), ["buy"]);
});

test("hitFacts: the hit's own quote and holding, each fact with its source", () => {
  const quoted = "the watch's quote (cboe) at 2026-03-02T15:00:00Z";
  assert.deepEqual(hitFacts(hitOf({ holding: HELD })), {
    facts: { price: 176, change_1d_pct: 10, held: true, unrealized_pct: 25 },
    sources: {
      price: quoted, change_1d_pct: quoted, held: "the desk's book",
      unrealized_pct: "the watch's quote over the desk's book's average cost",
    },
  });
  assert.deepEqual(hitFacts(hitOf()).facts, { price: 176, change_1d_pct: 10, held: false });
  assert.deepEqual(Object.keys(hitFacts(hitOf({}, { prevClose: null })).facts), ["price", "held"]);
  assert.equal("unrealized_pct" in hitFacts(hitOf({ holding: { qty: 1, avgCost: 0 } })).facts, false);
  assert.deepEqual(hitFacts(hitOf({}, { price: 176.456, prevClose: 170 })).facts, { price: 176.46, change_1d_pct: 3.8, held: false });
  const long = hitFacts(hitOf({}, { feed: `${"f".repeat(40)}\n${"g".repeat(39)}` }));
  for (const source of Object.values(long.sources)) {
    assert.ok(chars(source) <= 120);
    assert.equal(source.includes("\n"), false);
  }
  for (const f of [hitFacts(hitOf({ holding: HELD })), hitFacts(hitOf()), long]) {
    for (const key of Object.keys(f.facts)) assert.equal(typeof f.sources[key], "string", key);
  }
});

const A: GateLesson = { id: "no-add-before-earnings", strength: "red-line", says: "dont", words: "Never add to a loser before earnings.", fired: 4, followed: 3, overridden: 1 };
const B: GateLesson = { id: "size-down", strength: "caveat", says: "careful", words: "Size down after two losses in a row.", fired: 1, followed: 0, overridden: 0 };
const askedOf = (over: Partial<Asked> = {}): Asked => ({ recall: "r-20260302-0f3a9c21", lessons: [], lessonsMore: 0, untold: [], untoldMore: 0, ...over });
const HEAD = "Your own lessons on NVDA, not advice:";
const LINE_A = "· red line (don't): \"Never add to a loser before earnings.\" · fired 4 · followed 3 · overridden 1";

test("alertBlock: red lines first, then the answer's order", () => {
  assert.equal(alertBlock("NVDA", askedOf({ lessons: [B, A] })), [
    "Your own lessons on NVDA, not advice:",
    "· red line (don't): \"Never add to a loser before earnings.\" · fired 4 · followed 3 · overridden 1",
    "· caveat (careful): \"Size down after two losses in a row.\" · fired 1 · followed 0 · overridden 0",
  ].join("\n"));
  const block = alertBlock("NVDA", askedOf({ lessons: [{ ...B, says: "do" }] }));
  assert.equal(block, `${HEAD}\n· caveat (do): "Size down after two losses in a row." · fired 1 · followed 0 · overridden 0`);
});

test("alertBlock: at most three lessons, the rest counted in the tail", () => {
  const five = [1, 2, 3, 4, 5].map((n) => ({ ...B, id: `l-${n}`, words: `w${n}` }));
  const lines = alertBlock("NVDA", askedOf({ lessons: five, lessonsMore: 2 }))!.split("\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[3], "· caveat (careful): \"w3\" · fired 1 · followed 0 · overridden 0");
  assert.equal(lines[4], "and 4 more");
});

test("alertBlock: a lesson is added only while the block with its tail fits", () => {
  const three = [1, 2, 3].map((n) => ({ ...B, id: `l-${n}`, words: String(n).repeat(200) }));
  const block = alertBlock("NVDA", askedOf({ lessons: three }))!;
  const lines = block.split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[3], "and 1 more");
  assert.ok(chars(block) <= ALERT_BLOCK_MAX);
});

test("alertBlock: a lesson's unsafe characters are shown as escapes, never raw", () => {
  const block = alertBlock("NVDA", askedOf({ lessons: [{ ...B, words: "a\nb\u202ec" }] }))!;
  const lines = block.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes("\"a\\u000ab\\u202ec\""), lines[1]);
  assert.equal(/[\u202e\n]/u.test(lines[1]), false);
});

test("alertBlock: words of 200 direction marks are cut to ALERT_WORDS_MAX, the block within its bound", () => {
  const block = alertBlock("NVDA", askedOf({ lessons: [{ ...B, words: "\u202e".repeat(200) }] }))!;
  const words = block.split("\n")[1].split("\"")[1];
  assert.equal(chars(words), ALERT_WORDS_MAX);
  assert.ok(words.endsWith("…"));
  assert.ok(chars(block) <= ALERT_BLOCK_MAX);
  assert.equal(block.includes("\u202e"), false);
});

test("alertBlock: no lesson, no block", () => {
  assert.equal(alertBlock("NVDA", askedOf()), undefined);
  assert.equal(alertBlock("NVDA", askedOf({ untold: [{ id: "x-1", needs: ["market"] }] })), undefined);
});

test("alertBlock: never past ALERT_BLOCK_MAX on any input", () => {
  const huge = [1, 2, 3, 4].map((n) => ({ ...A, id: `l-${n}`, words: "\u{1f600}\n".repeat(500), fired: 1e300 }));
  for (const symbol of ["NVDA", "\u202e".repeat(500)]) {
    const block = alertBlock(symbol, askedOf({ lessons: huge, lessonsMore: Number.MAX_SAFE_INTEGER }))!;
    assert.ok(chars(block) <= ALERT_BLOCK_MAX, String(chars(block)));
    assert.ok(block.split("\n").length >= 2, "at least one lesson is shown");
  }
});

test("alertNote: the block, the untold lines and the recall", () => {
  assert.equal(alertNote("NVDA", askedOf({ lessons: [A], untold: [{ id: "sector-heat", needs: ["industry", "market"] }], untoldMore: 2 })), [
    "Your own lessons on NVDA, not advice:",
    "· red line (don't): \"Never add to a loser before earnings.\" · fired 4 · followed 3 · overridden 1",
    "could not be checked on NVDA: sector-heat needs industry, market",
    "and 2 more could not be checked",
    "recall r-20260302-0f3a9c21",
  ].join("\n"));
});

test("alertNote: untold only, past three, ids and needs off their shapes, no recall id", () => {
  assert.equal(alertNote("NVDA", askedOf({ untold: [{ id: "sector-heat", needs: ["industry"] }] })),
    "could not be checked on NVDA: sector-heat needs industry\nrecall r-20260302-0f3a9c21");
  const four = [1, 2, 3, 4].map((n) => ({ id: `u-${n}`, needs: ["market"] }));
  assert.equal(alertNote("NVDA", askedOf({ untold: four, untoldMore: 1 })), [
    "could not be checked on NVDA: u-1 needs market",
    "could not be checked on NVDA: u-2 needs market",
    "could not be checked on NVDA: u-3 needs market",
    "and 2 more could not be checked",
    "recall r-20260302-0f3a9c21",
  ].join("\n"));
  assert.equal(alertNote("NVDA", { lessons: [], lessonsMore: 0, untold: [{ id: "A B", needs: ["x y", "change_5d_pct"] }], untoldMore: 0 }),
    "could not be checked on NVDA: a lesson needs a fact, change_5d_pct");
  assert.equal(alertNote("NVDA", { lessons: [A], lessonsMore: 0, untold: [], untoldMore: 0 }), `${HEAD}\n${LINE_A}`);
});

test("alertNote: neither a lesson nor an untold one, no note", () => {
  assert.equal(alertNote("NVDA", askedOf({ lessonsMore: 3, untoldMore: 2 })), undefined);
});

// --- the watch's ask --------------------------------------------------------------------------------------------

/** A recall answer with `over` laid on an empty one. */
function answerOf(over: Partial<RecallAnswer> = {}): RecallAnswer {
  return {
    recall_id: "r-20260302-0f3a9c21", applies: [], applies_more: 0, untold: [], untold_more: 0, same: [], like: [],
    house: { armed: 0, may_be_due: 0, proposals_waiting: 0, cards_changed: [], cards_broken: [], owner_chain_broken: false, chains_broken: [], partial: [] },
    text: "", ...over,
  } as RecallAnswer;
}
const CARD_A = {
  id: A.id, strength: A.strength, says: A.says, actions: ["add"], words: A.words,
  record: { owner: { fired: 4, followed: 3, overridden: 1, seen: 4, backfilled: 0, no_decision: 0 }, agents: { followed: 0, overridden: 0, seen: 0 } },
} as unknown as RecallAnswer["applies"][number];

/** A manual timer. */
function timerOf() {
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  return {
    timers,
    setTimer: (run: () => void, ms: number): unknown => { const t = { run, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t: unknown): void => { (t as { cleared: boolean }).cleared = true; },
    live: (): number => timers.filter((t) => !t.cleared).length,
  };
}

/** Seventy daily bars closing 100, 101, … before 2026-03-02; the last closes 169. */
const BARS = Array.from({ length: 70 }, (_, i) => ({ t: Date.parse("2026-03-02T14:30:00Z") - (70 - i) * 86_400_000, c: 100 + i }));
const okBars = (): Promise<UpstreamAnswer> => Promise.resolve({ status: 200, body: JSON.stringify({ ok: true, candles: BARS }) });
const NOW = Date.parse("2026-03-02T15:00:02Z");

/** The ask's deps on a memory whose recall answers `answer`, bars from `candles` and a manual timer. */
function depsOf(opts: { answer?: () => Promise<RecallAnswer>; standing?: () => Promise<MemoryStanding>; candles?: (q: string) => Promise<UpstreamAnswer> } = {}) {
  const calls: Array<{ by: string; input: unknown }> = [];
  const asked: string[] = [];
  const logs: string[] = [];
  let opened = 0;
  let clock = NOW;
  const memory = { recall: (by: string, input: unknown) => { calls.push({ by, input }); return (opts.answer ?? (async () => answerOf({ applies: [CARD_A] })))(); } } as unknown as Memory;
  const t = timerOf();
  const deps = {
    open: () => { opened++; return (opts.standing ?? (async (): Promise<MemoryStanding> => ({ connected: true, memory, home: "/tmp/m" })))(); },
    candles: (q: string) => { asked.push(q); return (opts.candles ?? okBars)(q); },
    log: (line: string) => { logs.push(line); },
    now: () => clock,
    setTimer: t.setTimer, clearTimer: t.clearTimer,
  };
  return { deps, calls, asked, logs, t, opened: () => opened, tick: (ms: number) => { clock += ms; } };
}

test("createAlertLessons: a held US hit that fell asks once as gravit-face with its facts, and answers the block", async () => {
  const s = depsOf();
  const hit = hitOf({ holding: HELD }, { chgPct: -4, prevClose: 183.33 });
  const answer = await createAlertLessons(s.deps)(hit);
  const changes = await changeFacts({ candles: okBars, now: () => NOW }, "NVDA", "US", 176);
  const own = hitFacts(hit);
  assert.equal(Object.keys(changes.facts).length, 3);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].by, "gravit-face");
  assert.deepEqual(s.calls[0].input, {
    considering: ["add", "sell", "hold"], symbol: "NVDA", market: "US",
    facts: { ...own.facts, ...changes.facts }, fact_sources: { ...own.sources, ...changes.sources },
  });
  assert.deepEqual(s.asked, ["venue=cboe&symbol=NVDA&interval=1d&range=6M"]);
  const asked = askedOf({ lessons: [A] });
  assert.deepEqual(answer, {
    phone: alertBlock("NVDA", asked), phoneKey: "NVDA:2026-03-02:no-add-before-earnings", note: alertNote("NVDA", asked), key: "NVDA:2026-03-02:no-add-before-earnings|",
  });
  assert.equal(s.t.live(), 0, "no timer is left");
  assert.deepEqual(s.logs, []);
});

test("createAlertLessons: with no chgPct the direction and change_1d_pct agree, both from the previous close", async () => {
  const s = depsOf();
  await createAlertLessons(s.deps)(hitOf({ holding: { qty: 10, avgCost: 200 } }, { chgPct: null, prevClose: 160 }));
  const input = s.calls[0].input as { considering: string[]; facts: Record<string, unknown> };
  assert.deepEqual(input.considering, ["add", "trim", "hold"]);
  assert.equal(input.facts.change_1d_pct, 10);
});

test("createAlertLessons: the key sorts the lessons' and the untold ids; untold only has no phone", async () => {
  const untold = [{ id: "z-need", needs: [{ what: "market" }] }, { id: "b-need", needs: [{ what: "fact", fact: "industry" }] }] as unknown as RecallAnswer["untold"];
  const s = depsOf({ answer: async () => answerOf({ untold }) });
  const answer = await createAlertLessons(s.deps)(hitOf());
  assert.deepEqual(answer, {
    note: "could not be checked on NVDA: z-need needs market\ncould not be checked on NVDA: b-need needs industry\nrecall r-20260302-0f3a9c21",
    key: "NVDA:2026-03-02:|b-need,z-need",
  });
  const two = depsOf({ answer: async () => answerOf({ applies: [{ ...CARD_A, id: "z-l" }, { ...CARD_A, id: "a-l" }] as RecallAnswer["applies"] }) });
  assert.equal((await createAlertLessons(two.deps)(hitOf()))!.key, "NVDA:2026-03-02:a-l,z-l|");
});

test("createAlertLessons: phoneKey is the symbol, the date and the applying lessons alone - the untold ids change only key", async () => {
  const untold = [{ id: "b-need", needs: [{ what: "fact", fact: "industry" }] }] as unknown as RecallAnswer["untold"];
  const bare = await createAlertLessons(depsOf().deps)(hitOf());
  const withUntold = await createAlertLessons(depsOf({ answer: async () => answerOf({ applies: [CARD_A], untold }) }).deps)(hitOf());
  assert.equal(bare!.phoneKey, "NVDA:2026-03-02:no-add-before-earnings");
  assert.equal(withUntold!.phoneKey, bare!.phoneKey);
  assert.equal(withUntold!.phone, bare!.phone, "the same block");
  assert.notEqual(withUntold!.key, bare!.key);
  const noBlock = await createAlertLessons(depsOf({ answer: async () => answerOf({ untold }) }).deps)(hitOf());
  assert.equal(noBlock!.phoneKey, undefined, "no block, no phoneKey");
});

test("createAlertLessons: an unexpected throw inside the ask is one log line, the symbol or a hit, and undefined", async () => {
  const s = depsOf();
  const answer = await createAlertLessons({ ...s.deps, now: () => { throw new Error("the clock\nbroke"); } })(hitOf());
  assert.equal(answer, undefined);
  assert.deepEqual(s.logs, ["memory alert: NVDA: the clock broke"]);
  const odd = depsOf();
  const hit = hitOf();
  Object.defineProperty(hit, "trigger", { get: () => { throw new Error("no trigger"); } });
  assert.equal(await createAlertLessons(odd.deps)(hit), undefined);
  assert.deepEqual(odd.logs, ["memory alert: NVDA: no trigger"]);
  const unshaped = depsOf();
  const bad = hitOf({ symbol: "NV\nDA" });
  Object.defineProperty(bad, "trigger", { get: () => { throw new Error("no trigger"); } });
  assert.equal(await createAlertLessons(unshaped.deps)(bad), undefined);
  assert.deepEqual(unshaped.logs, ["memory alert: a hit: no trigger"]);
});

test("createAlertLessons: an A share is asked in CN, its bars read as changeFacts reads them while trading", async () => {
  const s = depsOf();
  const answer = await createAlertLessons(s.deps)(hitOf({ market: "cn", symbol: "600519", key: "600519:move" }, { market: "cn" }));
  const probe: string[] = [];
  const changes = await changeFacts({ candles: (q) => { probe.push(q); return okBars(); }, now: () => NOW }, "600519", "CN", 176, "trading");
  assert.deepEqual(s.asked, probe);
  const input = s.calls[0].input as { market: string; symbol: string; facts: Record<string, unknown> };
  assert.equal(input.market, "CN");
  assert.equal(input.symbol, "600519");
  for (const [key, value] of Object.entries(changes.facts)) assert.equal(input.facts[key], value);
  assert.ok(answer?.phone?.startsWith("Your own lessons on 600519, not advice:"));
});

test("createAlertLessons: nothing considered asks nothing", async () => {
  const s = depsOf();
  assert.equal(await createAlertLessons(s.deps)(hitOf({ quote: null })), undefined);
  assert.equal(await createAlertLessons(s.deps)(hitOf({ symbol: "NVDA\n" })), undefined);
  assert.equal(s.opened(), 0);
  assert.deepEqual(s.asked, []);
  assert.deepEqual(s.calls, []);
});

test("createAlertLessons: not connected, a fault and a late recall answer nothing; a log line for the fault alone", async () => {
  const off = depsOf({ standing: async () => ({ connected: false, why: "no home named", say: "no memory here" }) });
  assert.equal(await createAlertLessons(off.deps)(hitOf()), undefined);
  assert.deepEqual(off.logs, []);

  const fault = depsOf({ answer: async () => { throw new Error("broken\nhome"); } });
  assert.equal(await createAlertLessons(fault.deps)(hitOf()), undefined);
  assert.deepEqual(fault.logs, ["memory alert: NVDA: broken home"]);

  const late = depsOf({ answer: () => new Promise<RecallAnswer>(() => {}) });
  const pending = createAlertLessons(late.deps)(hitOf());
  await flush();
  const recallTimer = late.t.timers.find((t) => !t.cleared)!;
  assert.equal(recallTimer.ms, ALERT_ASK_MS);
  recallTimer.run();
  assert.equal(await pending, undefined);
  assert.deepEqual(late.logs, ["memory alert: NVDA: the memory did not answer in time"]);
  assert.equal(late.t.live(), 0);
});

test("createAlertLessons: the memory is opened before the bars - not connected or disabled reads nothing at the Market and logs nothing", async () => {
  const off = depsOf({ standing: async () => ({ connected: false, why: "disabled", say: "the memory is not connected: the mcp-memory row is disabled" }) });
  assert.equal(await createAlertLessons(off.deps)(hitOf()), undefined);
  assert.equal(off.opened(), 1);
  assert.deepEqual(off.asked, [], "no bars read");
  assert.deepEqual(off.calls, []);
  assert.deepEqual(off.logs, []);
  assert.equal(off.t.live(), 0);
});

test("createAlertLessons: a home that was never made, from open or from the recall: undefined, no log line", async () => {
  const noHome = Object.assign(new Error("no memory here: run gravit-memory init"), { code: "E_NO_HOME" });
  const fromOpen = depsOf({ standing: async () => { throw noHome; } });
  assert.equal(await createAlertLessons(fromOpen.deps)(hitOf()), undefined);
  assert.deepEqual(fromOpen.asked, [], "no bars read");
  assert.deepEqual(fromOpen.logs, []);
  const fromRecall = depsOf({ answer: async () => { throw noHome; } });
  assert.equal(await createAlertLessons(fromRecall.deps)(hitOf()), undefined);
  assert.equal(fromRecall.calls.length, 1);
  assert.deepEqual(fromRecall.logs, []);
  assert.equal(fromRecall.t.live(), 0);
});

test("createAlertLessons: an open that rejects otherwise is a fault: one log line, no bars read", async () => {
  const s = depsOf({ standing: async () => { throw new Error("the install is broken"); } });
  assert.equal(await createAlertLessons(s.deps)(hitOf()), undefined);
  assert.deepEqual(s.asked, []);
  assert.deepEqual(s.logs, ["memory alert: NVDA: the install is broken"]);
  const slow = depsOf({ standing: () => new Promise<MemoryStanding>(() => {}) });
  const pending = createAlertLessons(slow.deps)(hitOf());
  await flush();
  const openTimer = slow.t.timers.find((t) => !t.cleared)!;
  assert.equal(openTimer.ms, ALERT_ASK_MS, "the open is bounded by the whole budget");
  openTimer.run();
  assert.equal(await pending, undefined);
  assert.deepEqual(slow.asked, []);
  assert.deepEqual(slow.logs, ["memory alert: NVDA: the memory did not answer in time"]);
});

test("createAlertLessons: nothing applies and nothing untold answers nothing", async () => {
  const s = depsOf({ answer: async () => answerOf({ applies_more: 2 }) });
  assert.equal(await createAlertLessons(s.deps)(hitOf()), undefined);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.logs, []);
});

test("createAlertLessons: bars that never answer leave the recall the hit's four facts after ALERT_FACTS_MS, and the rest of the budget", async () => {
  const s = depsOf({ candles: () => new Promise<UpstreamAnswer>(() => {}) });
  const pending = createAlertLessons(s.deps)(hitOf({ holding: HELD }));
  await flush();
  assert.equal(s.calls.length, 0);
  const barsTimer = s.t.timers.find((t) => !t.cleared)!;
  assert.equal(barsTimer.ms, ALERT_FACTS_MS);
  s.tick(ALERT_FACTS_MS);
  barsTimer.run();
  await flush();
  assert.equal(s.calls.length, 1);
  assert.deepEqual((s.calls[0].input as { facts: unknown }).facts, hitFacts(hitOf({ holding: HELD })).facts);
  assert.equal(s.t.timers.length, 3, "the open's, the bars' and the recall's");
  assert.equal(s.t.timers[2].ms, ALERT_ASK_MS - ALERT_FACTS_MS, "the recall has what is left of the budget");
  assert.ok((await pending)?.phone);
  assert.equal(s.t.live(), 0);
});

test("createAlertLessons: open and candles throwing synchronously never throw", async () => {
  const s = depsOf({ standing: () => { throw new Error("sync open"); }, candles: () => { throw new Error("sync bars"); } });
  const ask = createAlertLessons(s.deps);
  let answer: unknown = "unset";
  assert.doesNotThrow(() => { void ask(hitOf()).then((a) => { answer = a; }); });
  await flush();
  assert.equal(answer, undefined);
  assert.equal(s.logs.length, 1);
  const noisy = depsOf();
  const throwing = createAlertLessons({ ...noisy.deps, now: () => { throw new Error("clock"); }, log: () => { throw new Error("log"); } });
  assert.equal(await throwing(hitOf()), undefined);
});
