/** src/memory-gate.ts: the memory gate's check - an order card's lines asked of the memory and kept by call - on a
 * stub memory, stub facts, a stub Account and a fake clock; and `gateAccount` over stub reads. Nothing leaves the
 * process and no real timer is waited on. */
import test from "node:test";
import assert from "node:assert/strict";
import type { Memory, RecallAnswer } from "gravit-memory";
import {
  CALL_ID,
  CHECK_NOT_FINISHED,
  HELD_BY_ANOTHER,
  GATE_ACCOUNT_MS,
  GATE_CHECK_MS,
  GATE_FACTS_MS,
  GATE_FACT_READ_MS,
  GATE_KEPT,
  createMemoryGate,
  gateAccount,
  redLineRefusal,
  type GateAccount,
  type GateCall,
  type MemoryGateDeps,
} from "../src/memory-gate.ts";
import { priceFacts, type FactReads, type Facts } from "../src/memory-facts.ts";
import type { MarketQuotePayload } from "../src/market-quotes.ts";
import type { Position } from "../src/memory-order.ts";
import { memoryFaultWords, type MemoryStanding } from "../src/memory.ts";
import type { AccountReader } from "../src/account-proxy.ts";
import type { UpstreamAnswer } from "../src/upstream-proxy.ts";

const ORDER = "mcp__account__portfolio_live_order";
const BATCH = "mcp__account__portfolio_live_batch";
const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** A fake clock: timers fire when `run` moves the time to them, earliest first. */
function clockOf() {
  let at = 0;
  const timers: Array<{ due: number; run: () => void; cleared: boolean }> = [];
  const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  return {
    now: (): number => at,
    setTimer: (run: () => void, ms: number): unknown => { const t = { due: at + ms, run, cleared: false }; timers.push(t); return t; },
    clearTimer: (t: unknown): void => { (t as { cleared: boolean }).cleared = true; },
    live: (): number => timers.filter((t) => !t.cleared).length,
    flush,
    /** Settles `p`, moving the clock to each next timer while it is pending; throws when it would hang. */
    async run<T>(p: Promise<T>): Promise<T> {
      let done = false;
      let value: T | undefined;
      let failure: unknown;
      let failed = false;
      p.then((v) => { done = true; value = v; }, (e) => { done = true; failed = true; failure = e; });
      for (;;) {
        await flush();
        if (done) break;
        const next = timers.filter((t) => !t.cleared).sort((a, b) => a.due - b.due)[0];
        if (next === undefined) throw new Error("the check hangs with no timer pending");
        next.cleared = true;
        at = Math.max(at, next.due);
        next.run();
      }
      if (failed) throw failure;
      return value as T;
    },
  };
}

/** A recall answer with `applies` and `untold` as given; the rest empty. */
function answerOf(over: Partial<RecallAnswer> = {}): RecallAnswer {
  return {
    recall_id: "r-20260302-0f3a9c21", applies: [], applies_more: 0, untold: [], untold_more: 0, same: [], like: [],
    house: { armed: 0, may_be_due: 0, proposals_waiting: 0, cards_changed: [], cards_broken: [], owner_chain_broken: false, chains_broken: [], partial: [] },
    text: "", ...over,
  } as RecallAnswer;
}
function lessonOf(id: string, strength: "caveat" | "red-line", says: "dont" | "do" | "careful", words = `the words of ${id}`) {
  return {
    id, strength, says, actions: ["add"], words,
    record: { owner: { fired: 3, followed: 2, overridden: 1, seen: 4, backfilled: 0, no_decision: 0 }, agents: { followed: 0, overridden: 0, seen: 0 } },
  } as unknown as RecallAnswer["applies"][number];
}
const CAREFUL = answerOf({ applies: [lessonOf("L-0001", "caveat", "careful", "do not chase a gap")] });

const PRICE: Facts = {
  facts: { price: 110, change_1d_pct: 10 },
  sources: { price: "the Market's quote (cboe delayed) at 2026-03-02T20:59:00.000Z", change_1d_pct: "the Market's quote (cboe delayed) at 2026-03-02T20:59:00.000Z" },
};

/** The rig: every stub records what it was asked; `over` replaces a stub. */
function rig(over: {
  open?: () => Promise<MemoryStanding>;
  recall?: (by: string, input: unknown) => Promise<RecallAnswer>;
  facts?: (symbol: string, market: "US") => Promise<Facts>;
  paperVenue?: () => Promise<string | undefined>;
  position?: (venue: string, symbol: string) => Promise<Position | null | undefined>;
  kind?: (venue: string, symbol: string) => Promise<string | undefined>;
  log?: (line: string) => void;
} = {}) {
  const clock = clockOf();
  const asked = {
    open: 0, recalls: [] as Array<{ by: string; input: unknown; at: number }>, facts: [] as Array<[string, string]>,
    paperVenue: 0, positions: [] as Array<[string, string]>, kinds: [] as Array<[string, string]>, logs: [] as string[],
  };
  const memory = {
    recall: (by: string, input: unknown) => { asked.recalls.push({ by, input, at: clock.now() }); return (over.recall ?? (async () => CAREFUL))(by, input); },
  } as unknown as Memory;
  const account: GateAccount = {
    paperVenue: () => { asked.paperVenue += 1; return (over.paperVenue ?? (async () => "paper-1"))(); },
    position: (venue, symbol) => { asked.positions.push([venue, symbol]); return (over.position ?? (async () => ({ side: "long", qty: 5, entryPrice: 100 }) as Position))(venue, symbol); },
    kind: (venue, symbol) => { asked.kinds.push([venue, symbol]); return (over.kind ?? (async () => "stock"))(venue, symbol); },
    approval: async () => undefined,
  };
  const deps: MemoryGateDeps = {
    open: () => { asked.open += 1; return (over.open ?? (async (): Promise<MemoryStanding> => ({ connected: true, memory, home: "/tmp/m" })))(); },
    facts: (symbol, market) => { asked.facts.push([symbol, market]); return (over.facts ?? (async () => PRICE))(symbol, market); },
    account,
    log: (line) => { asked.logs.push(line); (over.log ?? (() => {}))(line); },
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  };
  const gate = createMemoryGate(deps);
  return { gate, asked, clock };
}
const callOf = (args: unknown, callId = "call_1", name = ORDER): GateCall => ({ callId, name, args, sessionId: "s-1" });
const BUY_NVDA = { venue: "paper-1", symbol: "NVDA", side: "buy", qty: 10 };

test("one line, long 10, a buy: one recall as gravit-face with the line's question and the face's own facts", async () => {
  const { gate, asked, clock } = rig();
  const note = await clock.run(gate.check(callOf(BUY_NVDA)));
  assert.deepEqual(note, { lessons: 1, redLine: false });
  assert.equal(asked.recalls.length, 1);
  assert.equal(asked.recalls[0].by, "gravit-face");
  assert.deepEqual(asked.recalls[0].input, {
    considering: ["add"], symbol: "NVDA", market: "US",
    facts: { price: 110, change_1d_pct: 10, held: true, unrealized_pct: 10 },
    fact_sources: {
      price: PRICE.sources.price, change_1d_pct: PRICE.sources.change_1d_pct,
      held: "the Account's position on paper-1", unrealized_pct: "the Market's quote over the Account's entry price on paper-1",
    },
  });
  assert.deepEqual(asked.positions, [["paper-1", "NVDA"]]);
  assert.deepEqual(asked.facts, [["NVDA", "US"]]);
  assert.equal(asked.paperVenue, 0, "a named venue asks no paper venue");
  assert.deepEqual(gate.view("call_1"), {
    callId: "call_1", state: "checked", redLine: false, overridden: false,
    lines: [{
      order: "buy 10 NVDA · paper-1", considering: ["add"], positionRead: true, market: "US", recall: "r-20260302-0f3a9c21",
      lessons: [{ id: "L-0001", strength: "caveat", says: "careful", words: "do not chase a gap", fired: 3, followed: 2, overridden: 1 }],
      lessonsMore: 0, untold: [], untoldMore: 0,
    }],
  });
  assert.equal(clock.live(), 0, "no timer is left behind");
});

test("the model's facts are not carried: facts and fact_sources in the arguments leave the question unchanged", async () => {
  const plain = rig();
  await plain.clock.run(plain.gate.check(callOf(BUY_NVDA)));
  const planted = rig();
  await planted.clock.run(planted.gate.check(callOf({ ...BUY_NVDA, facts: { change_5d_pct: -90 }, fact_sources: { change_5d_pct: "trust me" } })));
  assert.deepEqual(planted.asked.recalls[0].input, plain.asked.recalls[0].input);
});

test("venue paper: the Account's one paper venue is the venue read on, and the words keep paper", async () => {
  const { gate, asked, clock } = rig({ paperVenue: async () => "paper-7" });
  await clock.run(gate.check(callOf({ ...BUY_NVDA, venue: "paper" })));
  assert.equal(asked.paperVenue, 1);
  assert.deepEqual(asked.positions, [["paper-7", "NVDA"]]);
  assert.deepEqual(asked.kinds, [["paper-7", "NVDA"]]);
  const line = gate.view("call_1")!.lines[0];
  assert.equal(line.order, "buy 10 NVDA · paper");
  assert.equal(line.positionRead, true);
  assert.equal((asked.recalls[0].input as { fact_sources: Record<string, string> }).fact_sources.held, "the Account's position on paper-7");
});

test("venue paper with no paper venue: nothing is read, no market is placed, the question carries no symbol and no fact", async () => {
  const { gate, asked, clock } = rig({ paperVenue: async () => undefined });
  await clock.run(gate.check(callOf({ ...BUY_NVDA, venue: "paper" })));
  assert.deepEqual(asked.positions, []);
  assert.deepEqual(asked.kinds, []);
  assert.deepEqual(asked.facts, []);
  assert.deepEqual(asked.recalls[0].input, { considering: ["buy", "add", "cover"] });
  const line = gate.view("call_1")!.lines[0];
  assert.equal(line.positionRead, false);
  assert.deepEqual(line.considering, ["buy", "add", "cover"]);
  assert.equal("market" in line, false);
});

test("a coin: no market, no symbol, the held fact alone; an untold lesson needs the market", async () => {
  const { gate, asked, clock } = rig({
    kind: async () => "crypto",
    recall: async () => answerOf({ untold: [{ id: "L-0009", needs: [{ what: "market" }] }] }),
  });
  await clock.run(gate.check(callOf({ venue: "paper-1", symbol: "BTC", side: "buy", qty: 1 })));
  assert.deepEqual(asked.facts, [], "no price facts without a market");
  assert.deepEqual(asked.recalls[0].input, { considering: ["add"], facts: { held: true }, fact_sources: { held: "the Account's position on paper-1" } });
  const line = gate.view("call_1")!.lines[0];
  assert.equal("market" in line, false);
  assert.deepEqual(line.untold, [{ id: "L-0009", needs: ["market"] }]);
});

test("an untold lesson's fact need is the fact's name", async () => {
  const { gate, clock } = rig({
    recall: async () => answerOf({ untold: [{ id: "L-0004", needs: [{ what: "fact", fact: "change_5d_pct", definition: "the five-day change" }] }], untold_more: 2 }),
  });
  await clock.run(gate.check(callOf(BUY_NVDA)));
  const line = gate.view("call_1")!.lines[0];
  assert.deepEqual(line.untold, [{ id: "L-0004", needs: ["change_5d_pct"] }]);
  assert.equal(line.untoldMore, 2);
});

test("a red line is a red-line lesson that says dont; a red-line careful and a caveat dont are not", async () => {
  const red = rig({ recall: async () => answerOf({ applies: [lessonOf("L-0002", "red-line", "dont")] }) });
  assert.deepEqual(await red.clock.run(red.gate.check(callOf(BUY_NVDA))), { lessons: 1, redLine: true });
  assert.equal(red.gate.view("call_1")!.redLine, true);
  const near = rig({ recall: async () => answerOf({ applies: [lessonOf("L-0003", "red-line", "careful"), lessonOf("L-0005", "caveat", "dont")] }) });
  assert.deepEqual(await near.clock.run(near.gate.check(callOf(BUY_NVDA))), { lessons: 2, redLine: false });
  assert.equal(near.gate.view("call_1")!.redLine, false);
});

test("a batch of two lines: two recalls, legs 1 and 2, lessons counted across both", async () => {
  const { gate, asked, clock } = rig();
  const legs = [BUY_NVDA, { venue: "paper-1", symbol: "AMD", side: "sell", qty: 2 }];
  const note = await clock.run(gate.check(callOf({ legs }, "call_2", BATCH)));
  assert.deepEqual(note, { lessons: 2, redLine: false });
  assert.equal(asked.recalls.length, 2);
  const lines = gate.view("call_2")!.lines;
  assert.deepEqual(lines.map((l) => [l.leg, l.order]), [[1, "buy 10 NVDA · paper-1"], [2, "sell 2 AMD · paper-1"]]);
  assert.deepEqual(lines.map((l) => l.considering), [["add"], ["trim"]]);
});

test("the lines of a batch are read together, not one after another", async () => {
  const held: Array<() => void> = [];
  const { gate, asked, clock } = rig({ position: () => new Promise((r) => held.push(() => r(null))) });
  const legs = [BUY_NVDA, { venue: "paper-1", symbol: "AMD", side: "buy", qty: 2 }];
  const pending = gate.check(callOf({ legs }, "call_2", BATCH));
  await clock.flush();
  assert.deepEqual(asked.positions, [["paper-1", "NVDA"], ["paper-1", "AMD"]], "both positions asked before either answers");
  for (const release of held) release();
  await clock.run(pending);
});

test("an order the gate does not check: not checked, with why; the memory is not opened", async () => {
  const { gate, asked, clock } = rig();
  const note = await clock.run(gate.check(callOf({ venue: "paper-1" }, "call_3", "mcp__account__portfolio_balance")));
  assert.equal(note, undefined);
  assert.equal(asked.open, 0);
  assert.deepEqual(gate.view("call_3"), { callId: "call_3", state: "not checked", words: "not checked for this tool", lines: [], redLine: false, overridden: false });
  await clock.run(gate.check(callOf({ ...BUY_NVDA, qty: -1 }, "call_4")));
  assert.equal(gate.view("call_4")!.words, "the order could not be read");
  assert.equal(asked.open, 0);
});

test("not connected: the standing's words, no line, nothing asked of the Account", async () => {
  const say = "the memory is not connected: the mcp-memory row is disabled";
  const { gate, asked, clock } = rig({ open: async () => ({ connected: false, why: "disabled", say }) });
  const note = await clock.run(gate.check(callOf(BUY_NVDA)));
  assert.equal(note, undefined);
  assert.deepEqual(gate.view("call_1"), { callId: "call_1", state: "not connected", words: say, lines: [], redLine: false, overridden: false });
  assert.deepEqual(asked.positions, []);
});

test("a recall that throws: the line's fault in the memory's words, no lesson, no recall id; the check still resolves", async () => {
  const error = Object.assign(new Error("no home"), { code: "E_NO_HOME" });
  const { gate, asked, clock } = rig({ recall: async () => { throw error; } });
  assert.deepEqual(await clock.run(gate.check(callOf(BUY_NVDA))), { lessons: 0, redLine: false });
  const line = gate.view("call_1")!.lines[0];
  assert.equal(line.fault, memoryFaultWords(error));
  assert.deepEqual(line.lessons, []);
  assert.equal("recall" in line, false);
  assert.equal(asked.logs.length, 1, "one log line for the fault");
});

test("time: an Account that never answers leaves the position unread after GATE_ACCOUNT_MS", async () => {
  const { gate, asked, clock } = rig({ position: never });
  await clock.run(gate.check(callOf(BUY_NVDA)));
  const line = gate.view("call_1")!.lines[0];
  assert.equal(line.positionRead, false);
  assert.deepEqual(line.considering, ["buy", "add", "cover"]);
  assert.equal(line.market, "US", "the kind answered");
  assert.equal(asked.facts.length, 1);
  assert.equal(asked.recalls[0].at, GATE_ACCOUNT_MS);
  assert.equal(clock.live(), 0);
});

test("time: facts that never answer are left out after GATE_FACTS_MS", async () => {
  const { gate, asked, clock } = rig({ facts: never });
  await clock.run(gate.check(callOf(BUY_NVDA)));
  assert.equal(asked.recalls[0].at, GATE_FACTS_MS);
  assert.deepEqual(asked.recalls[0].input, {
    considering: ["add"], symbol: "NVDA", market: "US", facts: { held: true }, fact_sources: { held: "the Account's position on paper-1" },
  });
});

test("time: the gate bounds each price read at GATE_FACT_READ_MS - slow bars still give the quote's facts and unrealized_pct", async () => {
  assert.equal(GATE_FACT_READ_MS, 1_200);
  assert.ok(GATE_FACT_READ_MS < GATE_FACTS_MS);
  const clock = clockOf();
  const recalls: unknown[] = [];
  const memory = { recall: async (_by: string, input: unknown) => { recalls.push(input); return CAREFUL; } } as unknown as Memory;
  const quote = { id: "us:NVDA", market: "us", symbol: "NVDA", price: 110, prev_close: 100, as_of: "2026-03-02T20:59:00.000Z", feed: "cboe delayed" };
  const factReads: FactReads = {
    quotes: { snapshot: async () => ({ ok: true, quotes: [quote] }) as unknown as MarketQuotePayload },
    candles: never,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  };
  const gate = createMemoryGate({
    open: async () => ({ connected: true, memory, home: "/tmp/m" }),
    facts: (symbol, market, opts) => priceFacts(factReads, symbol, market, opts),
    account: { paperVenue: async () => "paper-1", position: async () => ({ side: "long", qty: 5, entryPrice: 100 }), kind: async () => "stock", approval: async () => undefined },
    log: () => {}, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  await clock.run(gate.check(callOf(BUY_NVDA)));
  assert.deepEqual((recalls[0] as { facts: unknown }).facts, { price: 110, change_1d_pct: 10, held: true, unrealized_pct: 10 });
  assert.equal(clock.live(), 0);
});

test("time: a recall that never answers settles the check at GATE_CHECK_MS; its late answer changes nothing", async () => {
  let answer!: (a: RecallAnswer) => void;
  const { gate, clock } = rig({ recall: () => new Promise((r) => { answer = r; }) });
  const note = await clock.run(gate.check(callOf(BUY_NVDA)));
  assert.equal(clock.now(), GATE_CHECK_MS);
  assert.deepEqual(note, { lessons: 0, redLine: false });
  const before = gate.view("call_1")!;
  assert.equal(before.lines[0].fault, "the memory did not answer in time");
  answer(answerOf({ applies: [lessonOf("L-0002", "red-line", "dont")] }));
  await clock.flush();
  assert.deepEqual(gate.view("call_1"), before);
  assert.equal(clock.live(), 0);
});

test("a callId off CALL_ID: undefined, and nothing is asked", async () => {
  assert.equal(CALL_ID.test("call_1:a.b-c"), true);
  assert.equal(CALL_ID.test("x".repeat(129)), false);
  const { gate, asked, clock } = rig();
  for (const callId of ["", "bad id", "a/b", "x".repeat(129)]) {
    assert.equal(await clock.run(gate.check(callOf(BUY_NVDA, callId))), undefined);
    assert.equal(gate.view(callId), undefined);
  }
  assert.equal(await clock.run(gate.check({ callId: 7, name: ORDER, args: BUY_NVDA, sessionId: "s" } as unknown as GateCall)), undefined);
  assert.equal(asked.open, 0);
});

test("a kept callId is checked again: the memory is asked for the new call and the entry replaced whole", async () => {
  const { gate, asked, clock } = rig();
  await clock.run(gate.check(callOf(BUY_NVDA)));
  assert.deepEqual(await clock.run(gate.check(callOf({ ...BUY_NVDA, qty: 99 }))), { lessons: 1, redLine: false });
  assert.equal(asked.open, 2);
  assert.equal(asked.recalls.length, 2);
  assert.equal(gate.view("call_1")!.lines[0]!.order, "buy 99 NVDA · paper-1");
});

/** A rig whose recall answers a red line for `symbol` alone, a caveat for the rest. */
const redFor = (symbol: string) => rig({
  recall: async (_by, input) => ((input as { symbol?: string }).symbol === symbol
    ? answerOf({ applies: [lessonOf("L-0002", "red-line", "dont", `never touch ${symbol}`)] })
    : CAREFUL),
});
const AMD_BUY = { venue: "paper-1", symbol: "AMD", side: "buy", qty: 1 };

test("a callId first with no red line, then again with an order that meets one: the red line is refused", async () => {
  const { gate, clock } = redFor("AMD");
  await clock.run(gate.check(callOf(BUY_NVDA)));
  assert.equal(gate.redLineReason("call_1", "s-1"), undefined);
  assert.deepEqual(await clock.run(gate.check(callOf(AMD_BUY))), { lessons: 1, redLine: true });
  assert.equal(gate.redLineReason("call_1", "s-1"), redLineRefusal("never touch AMD"));
});

test("a red-lined callId overridden, then checked again with a red line: no override carried, refused again", async () => {
  const { gate, clock } = redFor("AMD");
  await clock.run(gate.check(callOf(AMD_BUY)));
  assert.equal(gate.override("call_1", { reason: "the first card's reason" }), "kept");
  assert.equal(gate.redLineReason("call_1", "s-1"), undefined);
  await clock.run(gate.check(callOf({ ...AMD_BUY, qty: 5 })));
  assert.equal(gate.view("call_1")!.overridden, false);
  assert.equal(gate.redLineReason("call_1", "s-1"), redLineRefusal("never touch AMD"));
});

test("a red line is not dodged by spelling: paper, Paper, \" paper\" and a symbol with a trailing space are all red-lined", async () => {
  const spellings: Array<[string, Record<string, unknown>]> = [
    ["paper", { venue: "paper" }], ["Paper", { venue: "Paper" }], [" paper", { venue: " paper" }], ["NVDA ", { venue: "paper", symbol: "NVDA " }],
  ];
  for (const [what, args] of spellings) {
    const { gate, asked, clock } = rig({
      kind: async (venue) => (venue === "paper-1" ? "stock" : undefined),
      recall: async (_by, input) => ((input as { symbol?: string }).symbol === "NVDA"
        ? answerOf({ applies: [lessonOf("L-0002", "red-line", "dont", "never touch NVDA")] })
        : CAREFUL),
    });
    assert.deepEqual(await clock.run(gate.check(callOf({ ...BUY_NVDA, ...args }))), { lessons: 1, redLine: true }, what);
    assert.deepEqual(asked.positions, [["paper-1", "NVDA"]], what);
    assert.equal(gate.redLineReason("call_1", "s-1"), redLineRefusal("never touch NVDA"), what);
  }
});

/** A rig whose first recall answers `first`, and every later one waits for `release()` and answers `later`. */
function heldRig(first: RecallAnswer, later: RecallAnswer) {
  const held: { release?: () => void; calls: number } = { calls: 0 };
  const r = rig({
    recall: async () => {
      held.calls += 1;
      if (held.calls === 1) return first;
      await new Promise<void>((resolve) => { held.release = resolve; });
      return later;
    },
  });
  return { ...r, held };
}

test("while a callId's second check runs, a placeholder holds it: no view, no override, not finished for any caller", async () => {
  const { gate, clock, held } = heldRig(CAREFUL, answerOf({ applies: [lessonOf("L-0002", "red-line", "dont", "never add")] }));
  await clock.run(gate.check(callOf(BUY_NVDA)));
  const second = gate.check(callOf({ ...BUY_NVDA, qty: 2 }));
  await clock.flush();
  assert.equal(held.calls, 2, "the second recall is running");
  assert.equal(gate.view("call_1"), undefined, "the first entry is replaced by the placeholder");
  assert.equal(gate.redLineReason("call_1", "s-1"), CHECK_NOT_FINISHED);
  assert.equal(gate.redLineReason("call_1", "s-other"), CHECK_NOT_FINISHED);
  assert.equal(gate.redLineReason("call_1", undefined), CHECK_NOT_FINISHED);
  assert.equal(gate.override("call_1", { reason: "why" }), "no such card");
  held.release!();
  assert.deepEqual(await clock.run(second), { lessons: 1, redLine: true });
  assert.equal(gate.redLineReason("call_1", "s-1"), redLineRefusal("never add"));
});

test("the exact words of the two refusals", () => {
  assert.equal(HELD_BY_ANOTHER, "this call id is held by another order card: the order is not run - place it again");
  assert.equal(CHECK_NOT_FINISHED, "the memory's check of this call is not finished: the order is not run - place it again");
});

test("session A's red-lined callId checked again by session B: not finished while B's check runs; then held from A, clear for B", async () => {
  const { gate, clock, held } = heldRig(answerOf({ applies: [lessonOf("L-0002", "red-line", "dont", "never add")] }), CAREFUL);
  await clock.run(gate.check({ callId: "call_1", name: ORDER, args: BUY_NVDA, sessionId: "A" }));
  assert.equal(gate.redLineReason("call_1", "A"), redLineRefusal("never add"));
  const fromB = gate.check({ callId: "call_1", name: ORDER, args: { ...BUY_NVDA, qty: 1 }, sessionId: "B" });
  await clock.flush();
  assert.equal(gate.redLineReason("call_1", "A"), CHECK_NOT_FINISHED);
  assert.equal(gate.redLineReason("call_1", "B"), CHECK_NOT_FINISHED);
  held.release!();
  assert.deepEqual(await clock.run(fromB), { lessons: 1, redLine: false });
  assert.equal(gate.redLineReason("call_1", "A"), HELD_BY_ANOTHER);
  assert.equal(gate.redLineReason("call_1", "B"), undefined);
  assert.equal(gate.redLineReason("call_1", undefined), HELD_BY_ANOTHER, "no session against a kept entry is a mismatch");
  assert.equal(gate.redLineReason("call_9", undefined), undefined, "no entry: undefined");
});

test("a callId never kept before gets no placeholder: undefined while its own check runs", async () => {
  let release: (() => void) | undefined;
  const { gate, clock } = rig({
    recall: async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return answerOf({ applies: [lessonOf("L-0002", "red-line", "dont", "never add")] });
    },
  });
  const first = gate.check(callOf(BUY_NVDA));
  await clock.flush();
  assert.notEqual(release, undefined, "the recall is running");
  assert.equal(gate.redLineReason("call_1", "s-1"), undefined);
  release!();
  await clock.run(first);
  assert.equal(gate.redLineReason("call_1", "s-1"), redLineRefusal("never add"));
});

test("a placeholder whose check runs is never evicted", async () => {
  const { gate, clock, held } = heldRig(CAREFUL, CAREFUL);
  await clock.run(gate.check(callOf(BUY_NVDA, "reused")));
  const again = gate.check(callOf(BUY_NVDA, "reused"));
  await clock.flush();
  for (let i = 0; i < GATE_KEPT + 5; i++) await clock.run(gate.check(callOf({}, `p${i}`, "mcp__account__portfolio_balance")));
  assert.equal(gate.redLineReason("reused", "s-1"), CHECK_NOT_FINISHED, "still held");
  held.release!();
  await clock.run(again);
  assert.equal(gate.redLineReason("reused", "s-1"), undefined);
  assert.notEqual(gate.view("reused"), undefined, "its entry took the placeholder's place");
});

test("at most GATE_KEPT entries are kept; the oldest goes first", async () => {
  const { gate, clock } = rig();
  for (let i = 0; i <= GATE_KEPT; i++) await clock.run(gate.check(callOf({}, `c${i}`, "mcp__account__portfolio_balance")));
  assert.equal(gate.view("c0"), undefined);
  assert.notEqual(gate.view("c1"), undefined);
  assert.notEqual(gate.view(`c${GATE_KEPT}`), undefined);
});

test("a red line still waiting is never evicted; overridden, it goes in its turn", async () => {
  const { gate, clock } = redFor("AMD");
  await clock.run(gate.check(callOf(AMD_BUY, "red")));
  const plain = (i: number): string => `p${i}`;
  for (let i = 0; i < GATE_KEPT; i++) await clock.run(gate.check(callOf({}, plain(i), "mcp__account__portfolio_balance")));
  const keptPlain = (): number => Array.from({ length: GATE_KEPT + 2 }, (_, i) => gate.view(plain(i))).filter((v) => v !== undefined).length;
  assert.notEqual(gate.view("red"), undefined, "the waiting red line is kept");
  assert.equal(gate.redLineReason("red", "s-1"), redLineRefusal("never touch AMD"));
  assert.equal(keptPlain() + 1, GATE_KEPT, "the cap holds, the oldest plain entry out");
  assert.equal(gate.view(plain(0)), undefined);

  assert.equal(gate.override("red", { reason: "the owner's reason" }), "kept");
  await clock.run(gate.check(callOf({}, plain(GATE_KEPT), "mcp__account__portfolio_balance")));
  assert.equal(gate.view("red"), undefined, "overridden, it is the oldest evictable and goes");
  assert.equal(keptPlain(), GATE_KEPT);
});

test("check never rejects: each stub throwing synchronously in turn", async () => {
  const boom = (): never => { throw new Error("boom"); };
  const cases: Array<[string, Parameters<typeof rig>[0]]> = [
    ["open", { open: boom }], ["recall", { recall: boom }], ["facts", { facts: boom }], ["paperVenue", { paperVenue: boom }],
    ["position", { position: boom }], ["kind", { kind: boom }], ["log", { recall: boom, log: boom }],
  ];
  for (const [name, over] of cases) {
    const { gate, clock } = rig(over);
    const note = await clock.run(gate.check(callOf({ ...BUY_NVDA, venue: "paper" })));
    assert.ok(note === undefined || typeof note.lessons === "number", name);
    assert.notEqual(gate.view("call_1"), undefined, `${name}: the call is kept`);
    assert.equal(clock.live(), 0, `${name}: no timer is left behind`);
  }
  const gate = createMemoryGate({
    open: async () => ({ connected: false, why: "disabled", say: "x" }), facts: async () => PRICE,
    account: { paperVenue: async () => undefined, position: async () => undefined, kind: async () => undefined, approval: async () => undefined },
    log: () => {}, now: () => { throw new Error("no clock"); },
  });
  assert.equal(await gate.check(callOf(BUY_NVDA)), undefined, "a clock that throws");
});

test("dispose forgets every entry and settles a pending check", async () => {
  const { gate, clock } = rig({ recall: never });
  const pending = gate.check(callOf(BUY_NVDA));
  await clock.flush();
  gate.dispose();
  await pending;
  assert.equal(gate.view("call_1"), undefined);
  assert.equal(clock.live(), 0);
});

/* gateAccount over stub reads. */

function readsOf(answers: { account?: UpstreamAnswer; positions?: UpstreamAnswer; market?: UpstreamAnswer }) {
  const asked = { positions: [] as string[], fresh: [] as Array<boolean | undefined>, market: [] as string[], marketFresh: [] as Array<boolean | undefined> };
  const reader: AccountReader = { read: async () => answers.account ?? { unreachable: "ECONNREFUSED" } };
  return {
    asked,
    account: gateAccount({
      reader,
      positions: async (q, fresh) => { asked.positions.push(q); asked.fresh.push(fresh); return answers.positions ?? { unreachable: "ECONNREFUSED" }; },
      market: async (q, fresh) => { asked.market.push(q); asked.marketFresh.push(fresh); return answers.market ?? { unreachable: "ECONNREFUSED" }; },
      overview: async () => ({ unreachable: "ECONNREFUSED" }),
    }),
  };
}
const ok = (body: unknown, status = 200): UpstreamAnswer => ({ status, body: JSON.stringify(body) });

test("gateAccount.paperVenue: exactly one paper venue is its id; none or several is undefined", async () => {
  const one = readsOf({ account: ok({ ok: true, venues: [{ id: "live-1", paper: false }, { id: "paper-1", paper: true }] }) });
  assert.equal(await one.account.paperVenue(), "paper-1");
  const none = readsOf({ account: ok({ ok: true, venues: [{ id: "live-1", paper: false }] }) });
  assert.equal(await none.account.paperVenue(), undefined);
  const two = readsOf({ account: ok({ ok: true, venues: [{ id: "paper-1", paper: true }, { id: "paper-2", paper: true }] }) });
  assert.equal(await two.account.paperVenue(), undefined);
  assert.equal(await readsOf({}).account.paperVenue(), undefined);
  assert.equal(await readsOf({ account: { status: 200, body: "not json" } }).account.paperVenue(), undefined);
});

test("gateAccount.position: the line's symbol's entry, null when none, undefined on anything but a 200 with ok", async () => {
  const positions = [{ symbol: "AMD", side: "short", qty: 3 }, { symbol: "NVDA", side: "long", qty: 5, entryPrice: 100, mark: 1 }];
  const r = readsOf({ positions: ok({ ok: true, positions }) });
  assert.deepEqual(await r.account.position("paper-1", "NVDA"), { side: "long", qty: 5, entryPrice: 100 });
  assert.deepEqual(await r.account.position("paper-1", "AMD"), { side: "short", qty: 3 });
  assert.equal(await r.account.position("paper-1", "TSLA"), null);
  assert.deepEqual(r.asked.positions, ["venue=paper-1", "venue=paper-1", "venue=paper-1"]);
  assert.deepEqual(r.asked.fresh, [true, true, true], "every position read is asked fresh, past the proxy's TTL");
  assert.equal(await readsOf({ positions: ok({ ok: false, positions }) }).account.position("paper-1", "NVDA"), undefined);
  assert.equal(await readsOf({ positions: ok({ ok: true, positions }, 503) }).account.position("paper-1", "NVDA"), undefined);
  assert.equal(await readsOf({}).account.position("paper-1", "NVDA"), undefined);
});

test("gateAccount.kind: the listing's kind; undefined on anything else", async () => {
  const r = readsOf({ market: ok({ ok: true, market: { kind: "stock", name: "NVIDIA" } }) });
  assert.equal(await r.account.kind("paper-1", "NVDA"), "stock");
  assert.deepEqual(r.asked.market, ["venue=paper-1&symbol=NVDA"]);
  assert.notEqual(r.asked.marketFresh[0], true, "the listing may ride the cache");
  assert.equal(await readsOf({ market: ok({ ok: false }) }).account.kind("paper-1", "NVDA"), undefined);
  assert.equal(await readsOf({}).account.kind("paper-1", "NVDA"), undefined);
});

/* ---------- the guard's read and the owner's override ---------- */

/** The guard's refusal for `words`, word for word as the plan's Global Constraints give it. */
const refusalOf = (words: string): string =>
  `a red line applies to this order - "${words}" - and no override is on record: the owner opens the card and overrides it in their own words`;

test("redLineRefusal: the Global Constraints' sentence, the lesson's words cut to 200 characters", () => {
  assert.equal(redLineRefusal("never add to a loser"), refusalOf("never add to a loser"));
  assert.equal(redLineRefusal("w".repeat(260)), refusalOf("w".repeat(200)));
});

test("redLineReason: undefined with no entry, no red line or no callId; the first red line's refusal until an override is kept", async () => {
  const lessons = [
    lessonOf("L-0003", "caveat", "careful"), lessonOf("L-0002", "red-line", "dont", "never add to a loser"),
    lessonOf("L-0004", "red-line", "dont", "the second red line"),
  ];
  const red = rig({ recall: async () => answerOf({ applies: lessons }) });
  assert.equal(red.gate.redLineReason("call_1", "s-1"), undefined, "no entry");
  assert.equal(red.gate.redLineReason(undefined, "s-1"), undefined, "no callId");
  await red.clock.run(red.gate.check(callOf(BUY_NVDA)));
  assert.equal(red.gate.redLineReason("call_1", "s-1"), refusalOf("never add to a loser"));
  assert.equal(red.gate.view("call_1")!.overridden, false);
  assert.equal(red.gate.override("call_1", { reason: "Earnings are out and the gap filled." }), "kept");
  assert.equal(red.gate.redLineReason("call_1", "s-1"), undefined);
  assert.equal(red.gate.view("call_1")!.overridden, true);

  const caveat = rig();
  await caveat.clock.run(caveat.gate.check(callOf(BUY_NVDA)));
  assert.equal(caveat.gate.redLineReason("call_1", "s-1"), undefined, "an entry with no red line");
});

test("redLineReason: the first red line in line order, across a batch's lines, whichever recall answers first", async () => {
  const legs = [{ venue: "paper-1", symbol: "AMD", side: "buy", qty: 1 }, BUY_NVDA];
  const { gate, clock } = rig({
    recall: async (_by, input) => {
      const symbol = (input as { symbol?: string }).symbol;
      if (symbol === "AMD") for (let i = 0; i < 3; i++) await Promise.resolve();
      return answerOf({ applies: [lessonOf("L-0009", "red-line", "dont", `no more ${symbol}`)] });
    },
  });
  await clock.run(gate.check(callOf({ legs }, "call_b", BATCH)));
  assert.equal(gate.view("call_b")!.redLine, true);
  assert.equal(gate.redLineReason("call_b", "s-1"), refusalOf("no more AMD"));
});

test("override: no such card, no red line; a later override replaces an earlier one", async () => {
  const red = rig({ recall: async () => answerOf({ applies: [lessonOf("L-0002", "red-line", "dont")] }) });
  assert.equal(red.gate.override("call_9", { reason: "why" }), "no such card");
  await red.clock.run(red.gate.check(callOf(BUY_NVDA)));
  assert.equal(red.gate.override("call_1", { reason: "first" }), "kept");
  assert.equal(red.gate.override("call_1", { reason: "second", wrongIf: "it gaps down" }), "kept");
  assert.equal(red.gate.view("call_1")!.overridden, true);
  assert.equal(red.gate.redLineReason("call_1", "s-1"), undefined);

  const caveat = rig();
  await caveat.clock.run(caveat.gate.check(callOf(BUY_NVDA)));
  assert.equal(caveat.gate.override("call_1", { reason: "why" }), "no red line");
  assert.equal(caveat.gate.view("call_1")!.overridden, false);
});

test("redLineReason on an entry that throws on read: undefined, and one line", async () => {
  const tampered = new Proxy({}, { get() { throw new Error("tampered"); } }) as unknown as string;
  const { gate, asked, clock } = rig({ recall: async () => answerOf({ applies: [lessonOf("L-0002", "red-line", "dont", tampered)] }) });
  await clock.run(gate.check(callOf(BUY_NVDA)));
  const before = asked.logs.length;
  assert.equal(gate.redLineReason("call_1", "s-1"), undefined);
  assert.equal(asked.logs.length, before + 1);
  assert.match(asked.logs.at(-1)!, /^memory gate: /);
});
