/** src/memory-gate.ts: the owner's answer to an order card, registered by the face's code - declined at Gate 2, approved
 * once the seat says the order is placed, and under Guard mode once the Account's card is answered - on a stub memory
 * whose `record` and `decisions` keep what they were asked, a stub Account and a fake clock; `seatOutcomes`;
 * `followAnswers` on a fake context; and `gateAccount.approval` over a stub overview. Nothing leaves the process and no
 * real timer is waited on. */
import test from "node:test";
import assert from "node:assert/strict";
import type { Memory, RecallAnswer } from "gravit-memory";
import {
  GATE_KEPT,
  GATE_OWN_CALL_MS,
  GATE_POSITION_MS,
  GATE_WATCH_EVERY_MS,
  GATE_WATCH_GRACE_MS,
  createMemoryGate,
  followAnswers,
  gateAccount,
  seatOutcomes,
  type GateAccount,
  type GateView,
  type MemoryGate,
} from "../src/memory-gate.ts";
import type { Position } from "../src/memory-order.ts";
import { memoryFaultWords, type MemoryStanding } from "../src/memory.ts";
import type { UpstreamAnswer } from "../src/upstream-proxy.ts";

const ORDER = "mcp__account__portfolio_live_order";
const BATCH = "mcp__account__portfolio_live_batch";
const START = Date.parse("2026-03-02T20:00:00.000Z");
const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** A fake clock from START: timers fire when the time is moved to them, earliest first. */
function clockOf() {
  let at = START;
  const timers: Array<{ due: number; run: () => void; cleared: boolean }> = [];
  const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const fireNext = (): boolean => {
    const next = timers.filter((t) => !t.cleared).sort((a, b) => a.due - b.due)[0];
    if (next === undefined) return false;
    next.cleared = true;
    at = Math.max(at, next.due);
    next.run();
    return true;
  };
  return {
    now: (): number => at,
    setTimer: (run: () => void, ms: number): unknown => { const t = { due: at + ms, run, cleared: false }; timers.push(t); return t; },
    clearTimer: (t: unknown): void => { (t as { cleared: boolean }).cleared = true; },
    live: (): number => timers.filter((t) => !t.cleared).length,
    flush,
    /** Moves the time by `ms`, firing every timer due on the way, in order. */
    async advance(ms: number): Promise<void> {
      const to = at + ms;
      for (;;) {
        await flush();
        const next = timers.filter((t) => !t.cleared && t.due <= to).sort((a, b) => a.due - b.due)[0];
        if (next === undefined) break;
        fireNext();
      }
      at = to;
      await flush();
    },
    /** Settles `p`, moving the clock to each next timer while it is pending; throws when it would hang. */
    async run<T>(p: Promise<T>): Promise<T> {
      let done = false;
      let value: T | undefined;
      p.then((v) => { done = true; value = v; });
      for (;;) {
        await flush();
        if (done) break;
        if (!fireNext()) throw new Error("hangs with no timer pending");
      }
      return value as T;
    },
  };
}

function answerOf(over: Partial<RecallAnswer> = {}): RecallAnswer {
  return {
    recall_id: "r-1", applies: [], applies_more: 0, untold: [], untold_more: 0, same: [], like: [],
    house: { armed: 0, may_be_due: 0, proposals_waiting: 0, cards_changed: [], cards_broken: [], owner_chain_broken: false, chains_broken: [], partial: [] },
    text: "", ...over,
  } as RecallAnswer;
}
const RED = {
  id: "L-0007", strength: "red-line", says: "dont", actions: ["buy"], words: "never chase a gap",
  record: { owner: { fired: 1, followed: 0, overridden: 0, seen: 1, backfilled: 0, no_decision: 0 }, agents: { followed: 0, overridden: 0, seen: 0 } },
} as unknown as RecallAnswer["applies"][number];

type Status = "pending" | "approved" | "rejected" | undefined;
interface Over {
  recall?: () => Promise<RecallAnswer>;
  record?: (input: unknown) => Promise<unknown>;
  decisions?: (filter: unknown) => Promise<unknown>;
  kind?: string;
  open?: () => Promise<MemoryStanding>;
}

/** The rig: `state.position` is the Account's position now, `state.approval` the Account's card now. */
function rig(over: Over = {}) {
  const clock = clockOf();
  const asked = {
    records: [] as Array<{ by: string; input: Record<string, unknown> }>, decisions: [] as unknown[], positions: [] as Array<[string, string]>,
    approvals: [] as string[], logs: [] as string[], opens: 0,
  };
  const state = {
    position: async (_symbol?: string): Promise<Position | null | undefined> => null,
    approval: async (): Promise<Status> => "pending",
  };
  const memory = {
    recall: () => (over.recall ?? (async () => answerOf()))(),
    record: async (by: string, input: Record<string, unknown>) => { asked.records.push({ by, input }); return over.record ? over.record(input) : {}; },
    decisions: async (filter: unknown) => { asked.decisions.push(filter); return over.decisions ? over.decisions(filter) : { items: [], more: false }; },
  } as unknown as Memory;
  const account: GateAccount = {
    paperVenue: async () => "paper-1",
    position: (venue, symbol) => { asked.positions.push([venue, symbol]); return state.position(symbol); },
    kind: async () => over.kind ?? "stock",
    approval: (card) => { asked.approvals.push(card); return state.approval(); },
  };
  const gate = createMemoryGate({
    open: () => { asked.opens += 1; return (over.open ?? (async (): Promise<MemoryStanding> => ({ connected: true, memory, home: "/tmp/m" })))(); },
    facts: async () => ({ facts: {}, sources: {} }),
    account,
    log: (line) => { asked.logs.push(line); },
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  const check = (args: unknown = BUY, callId = "c-1", name = ORDER, sessionId = "s-1") =>
    clock.run(gate.check({ callId, name, args, sessionId }));
  const idle = () => clock.run(gate.idle());
  const registered = (callId = "c-1"): Array<string | undefined> => (gate.view(callId)?.lines ?? []).map((l) => l.registered);
  return { gate, asked, clock, state, check, idle, registered };
}

const BUY = { venue: "paper-1", symbol: "NVDA", side: "buy", qty: 10, limitPrice: 183 };
const SELL = { venue: "paper-1", symbol: "NVDA", side: "sell", qty: 5, limitPrice: 190 };
const json = (body: unknown, isError = false) => ({ isError, text: `${isError ? "Error: " : ""}${JSON.stringify(body)}` });
const PLACED = json({ ok: true, order: { id: "o-1", status: "filled" }, next: "done" });
const REFUSED = json({ ok: false, code: "E_MANDATE_NONE", message: "no limit" }, true);
const EXPIRES = START + 300_000;
const PENDING = json({ ok: true, pending: true, card: { id: "ap-1", reason: "guard", usd: 1830, expiresAt: new Date(EXPIRES).toISOString() }, flight: "f-1", next: "…" });
const EVIDENCE = ["session s-1", "call c-1"];
const APPROVED_BUY = {
  action: "buy", whose: "owner", thesis: "Approved Gravit's order card: buy 10 NVDA · limit 183 · paper-1.",
  symbol: "NVDA", market: "US", price: 183, price_source: "the order card's limit price", size: "10", recall: "r-1", evidence: EVIDENCE,
};
const POSITION_UNREAD = "not registered: the position could not be read - tell Gravit what you decided";

/* Declined at Gate 2. */

test("declined at Gate 2: one record as gravit-face, a buy's pass, at once; the line reads registered: pass", async () => {
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "rejected", "s-1");
  await r.idle();
  assert.deepEqual(r.asked.records, [{
    by: "gravit-face",
    input: {
      action: "pass", whose: "owner", thesis: "Declined Gravit's order card: buy 10 NVDA · limit 183 · paper-1.",
      symbol: "NVDA", market: "US", recall: "r-1", evidence: EVIDENCE,
    },
  }]);
  assert.deepEqual(r.registered(), ["registered: pass"]);
  assert.equal(r.asked.positions.length, 1, "a decline reads no position: the check's read alone");
});

test("declined at Gate 2: a sell's is hold", async () => {
  const r = rig();
  await r.check(SELL);
  r.gate.answered("c-1", "rejected", "s-1");
  await r.idle();
  assert.equal(r.asked.records.length, 1);
  assert.equal(r.asked.records[0].input.action, "hold");
  assert.equal(r.asked.records[0].input.thesis, "Declined Gravit's order card: sell 5 NVDA · limit 190 · paper-1.");
  assert.deepEqual(r.registered(), ["registered: hold"]);
});

/* Approved at Gate 2, placed by the seat. */

test("approved: nothing yet; once the seat says placed, the approval line with the position read again as flat", async () => {
  const r = rig();
  r.state.position = async () => ({ side: "long", qty: 3 });
  await r.check();
  r.state.position = async () => null;
  r.gate.answered("c-1", "allowed-once", "s-1");
  await r.idle();
  assert.equal(r.asked.records.length, 0, "allowed-once writes nothing yet");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.deepEqual(r.asked.records, [{ by: "gravit-face", input: APPROVED_BUY }]);
  assert.deepEqual(r.asked.positions, [["paper-1", "NVDA"], ["paper-1", "NVDA"]], "read again, on the venue the check resolved");
  assert.deepEqual(r.registered(), ["registered: buy"]);
  assert.deepEqual(r.asked.decisions, [{ symbol: "NVDA", limit: 20 }]);
});

test("approved: a usd order's size is $100; an order with no limit price has no price and no price_source", async () => {
  const r = rig();
  await r.check({ venue: "paper-1", symbol: "NVDA", side: "buy", usd: 100 });
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.deepEqual(r.asked.records[0].input, {
    action: "buy", whose: "owner", thesis: "Approved Gravit's order card: buy $100 of NVDA · paper-1.",
    symbol: "NVDA", market: "US", size: "$100", recall: "r-1", evidence: EVIDENCE,
  });
});

test("approved under an override: words is its reason and wrong_if its wrongIf - the later override's", async () => {
  const r = rig({ recall: async () => answerOf({ applies: [RED] }) });
  await r.check();
  assert.equal(r.gate.override("c-1", { reason: "the first reason", wrongIf: "the first wrong" }), "kept");
  assert.equal(r.gate.override("c-1", { reason: "the gap is earnings, not a chase", wrongIf: "it closes under 180" }), "kept");
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.deepEqual(r.asked.records[0].input, { ...APPROVED_BUY, words: "the gap is earnings, not a chase", wrong_if: "it closes under 180" });
});

test("approved under an override with no wrongIf: words alone", async () => {
  const r = rig({ recall: async () => answerOf({ applies: [RED] }) });
  await r.check();
  r.gate.override("c-1", { reason: "my call" });
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.deepEqual(r.asked.records[0].input, { ...APPROVED_BUY, words: "my call" });
});

/** One decision item as `decisions` answers it. */
const decisionItem = (line: Record<string, unknown>, voided = false) => ({
  view: { line: { v: 1, kind: "decision", seq: 1, prev: null, sum: "x", action: "buy", thesis: "t", ...line }, amends: [], void: voided, open: true, reviewed: false, decidedMs: 0 },
  figures: [],
});
const GRAVITS = { id: "d-20260302-0f3a9c21", by: "gravit", whose: "agent", symbol: "NVDA", t: new Date(START - 60_000).toISOString() };

test("Gravit's own call on the symbol within GATE_OWN_CALL_MS is evidence", async () => {
  assert.equal(GATE_OWN_CALL_MS, 600_000);
  const r = rig({ decisions: async () => ({ items: [decisionItem(GRAVITS)], more: false }) });
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.deepEqual(r.asked.records[0].input.evidence, [...EVIDENCE, "decision d-20260302-0f3a9c21"]);
});

test("Gravit's own call: an older one, the owner's, another symbol's, a void one add nothing; decisions throwing adds nothing", async () => {
  const cases: Array<() => Promise<unknown>> = [
    async () => ({ items: [decisionItem({ ...GRAVITS, t: new Date(START - GATE_OWN_CALL_MS - 1).toISOString() })], more: false }),
    async () => ({ items: [decisionItem({ ...GRAVITS, by: "gravit", whose: "owner" })], more: false }),
    async () => ({ items: [decisionItem({ ...GRAVITS, by: "someone" })], more: false }),
    async () => ({ items: [decisionItem({ ...GRAVITS, symbol: "AMD" })], more: false }),
    async () => ({ items: [decisionItem(GRAVITS, true)], more: false }),
    async () => ({ items: [decisionItem({ ...GRAVITS, id: "d-nope" })], more: false }),
    async () => { throw new Error("E_IO: the decisions could not be read"); },
    async () => ({ nothing: true }),
  ];
  for (const decisions of cases) {
    const r = rig({ decisions });
    await r.check();
    r.gate.answered("c-1", "allowed-once", "s-1");
    r.gate.settled("c-1", PLACED, "s-1");
    await r.idle();
    assert.equal(r.asked.records.length, 1, "the line is still written");
    assert.deepEqual(r.asked.records[0].input.evidence, EVIDENCE);
  }
});

/** A position read that answers when the test says. */
function deferred() {
  let answer: (p: Position | null | undefined) => void = () => {};
  const read = (): Promise<Position | null | undefined> => new Promise((resolve) => { answer = resolve; });
  return { read, answer: (p: Position | null | undefined) => answer(p) };
}
const LONG_10: Position = { side: "long", qty: 10 };

test("(a) the approval's read answers before the seat's result: it is used - long 10 at the approval, flat at the check, is an add", async () => {
  const r = rig();
  await r.check();
  r.state.position = async () => LONG_10;
  r.gate.answered("c-1", "allowed-once", "s-1");
  await r.clock.flush();
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.equal(r.asked.records[0].input.action, "add");
  assert.deepEqual(r.registered(), ["registered: add"]);
});

test("(b) the approval's read answers after the seat's result: the check's flat stands - a buy - and the late answer changes nothing", async () => {
  const r = rig();
  await r.check();
  const late = deferred();
  r.state.position = late.read;
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-1");
  late.answer(LONG_10);
  await r.idle();
  await r.clock.flush();
  assert.deepEqual(r.asked.records, [{ by: "gravit-face", input: APPROVED_BUY }]);
  assert.deepEqual(r.registered(), ["registered: buy"]);
  assert.equal(r.clock.live(), 0);
});

test("(c) the approval's read answers after the seat's result and the check read no position: nothing written, the card says why, one log line", async () => {
  const r = rig();
  r.state.position = never;
  await r.check();
  assert.equal(r.gate.view("c-1")?.lines[0].positionRead, false);
  const late = deferred();
  r.state.position = late.read;
  const logs = r.asked.logs.length;
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-1");
  late.answer(LONG_10);
  await r.idle();
  assert.equal(r.asked.records.length, 0);
  assert.deepEqual(r.registered(), [POSITION_UNREAD]);
  assert.equal(r.asked.logs.length - logs, 1);
  assert.match(r.asked.logs.at(-1)!, /c-1: buy 10 NVDA · limit 183 · paper-1: not registered: the position could not be read/);
});

test("(d) the approval's read never answers: the check's position, once GATE_POSITION_MS passes or the result comes, and no timer left", async () => {
  assert.equal(GATE_POSITION_MS, 5_000);
  const passes = rig();
  await passes.check();
  passes.state.position = never;
  passes.gate.answered("c-1", "allowed-once", "s-1");
  await passes.clock.advance(GATE_POSITION_MS);
  assert.equal(passes.clock.live(), 0, "the read's timer has run out");
  passes.gate.settled("c-1", PLACED, "s-1");
  await passes.idle();
  assert.equal(passes.asked.records[0].input.action, "buy");
  assert.equal(passes.clock.live(), 0);

  const comes = rig();
  await comes.check();
  comes.state.position = never;
  comes.gate.answered("c-1", "allowed-once", "s-1");
  assert.equal(comes.clock.live(), 1, "the read is racing its timer");
  const at = comes.clock.now();
  comes.gate.settled("c-1", PLACED, "s-1");
  await comes.idle();
  assert.equal(comes.clock.live(), 0, "the result ended the read and cleared its timer");
  assert.equal(comes.clock.now(), at, "nothing waited on the read");
  assert.equal(comes.asked.records[0].input.action, "buy");
});

test("(e) a batch: each line by the same rule - one read answered before the result, one after", async () => {
  const r = rig();
  await r.check({ legs: [BUY, { venue: "paper-1", symbol: "AMD", side: "buy", qty: 4 }] }, "c-1", BATCH);
  const amd = deferred();
  r.state.position = (symbol?: string) => (symbol === "NVDA" ? Promise.resolve(LONG_10) : amd.read());
  r.gate.answered("c-1", "allowed-once", "s-1");
  await r.clock.flush();
  r.gate.settled("c-1", json({ ok: true, legs: [{ leg: 1, ok: true, order: { id: "o-1" } }, { leg: 2, ok: true, order: { id: "o-2" } }] }), "s-1");
  amd.answer({ side: "long", qty: 4 });
  await r.idle();
  assert.deepEqual(r.asked.records.map((x) => [x.input.symbol, x.input.action]), [["NVDA", "add"], ["AMD", "buy"]]);
});

test("Guard mode: the seat's pending result is the moment - a read answering after it is dropped", async () => {
  const r = rig();
  await r.check();
  const late = deferred();
  r.state.position = late.read;
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PENDING, "s-1");
  late.answer(LONG_10);
  r.state.approval = async () => "approved";
  await r.clock.advance(GATE_WATCH_EVERY_MS);
  await r.idle();
  assert.deepEqual(r.asked.records, [{ by: "gravit-face", input: APPROVED_BUY }]);
});

test("a usd sell of a long: no single action, nothing written, the card says why", async () => {
  const r = rig();
  r.state.position = async () => ({ side: "long", qty: 10 });
  await r.check({ venue: "paper-1", symbol: "NVDA", side: "sell", usd: 500 });
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.equal(r.asked.records.length, 0);
  assert.deepEqual(r.registered(), ["not registered: the order does not say how much of the position it sells - tell Gravit what you decided"]);
  assert.equal(r.asked.logs.length, 1);
});

test("refused by the seat, as ok false or as an error result: nothing written, the card says the seat refused", async () => {
  for (const result of [json({ ok: false, code: "E_X", message: "m" }), REFUSED, { isError: true, text: "Error: the call failed" }]) {
    const r = rig();
    await r.check();
    r.gate.answered("c-1", "allowed-once", "s-1");
    r.gate.settled("c-1", result, "s-1");
    await r.idle();
    assert.equal(r.asked.records.length, 0);
    assert.deepEqual(r.registered(), ["not registered: the seat refused the order"]);
    assert.equal(r.asked.logs.length, 1);
  }
});

test("a seat answer that cannot be read: nothing written, the card says so", async () => {
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", { isError: false, text: "not json" }, "s-1");
  await r.idle();
  assert.equal(r.asked.records.length, 0);
  assert.deepEqual(r.registered(), ["not registered: the seat's answer could not be read"]);
});

test("cancelled, unavailable, and a settled call never answered allowed-once: nothing", async () => {
  for (const outcome of ["cancelled", "unavailable"]) {
    const r = rig();
    await r.check();
    r.gate.answered("c-1", outcome, "s-1");
    r.gate.settled("c-1", PLACED, "s-1");
    await r.idle();
    assert.equal(r.asked.records.length, 0, outcome);
    assert.deepEqual(r.registered(), [undefined]);
  }
  const r = rig();
  await r.check();
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.equal(r.asked.records.length, 0);
  assert.equal(r.asked.positions.length, 1);
});

/* Guard mode: the Account's card. */

test("Guard mode: the Account's card is polled every GATE_WATCH_EVERY_MS; approved there, the approval line", async () => {
  assert.equal(GATE_WATCH_EVERY_MS, 5_000);
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PENDING, "s-1");
  await r.idle();
  assert.deepEqual(r.asked.approvals, []);
  await r.clock.advance(GATE_WATCH_EVERY_MS);
  await r.idle();
  assert.deepEqual(r.asked.approvals, ["ap-1"]);
  await r.clock.advance(GATE_WATCH_EVERY_MS);
  await r.idle();
  assert.deepEqual(r.asked.approvals, ["ap-1", "ap-1"]);
  assert.equal(r.asked.records.length, 0);
  r.state.approval = async () => "approved";
  await r.clock.advance(GATE_WATCH_EVERY_MS);
  await r.idle();
  assert.deepEqual(r.asked.records, [{ by: "gravit-face", input: APPROVED_BUY }]);
  assert.deepEqual(r.registered(), ["registered: buy"]);
  assert.equal(r.clock.live(), 0, "the polling stops");
});

test("Guard mode: rejected before expiresAt, the Account's decline", async () => {
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PENDING, "s-1");
  r.state.approval = async () => "rejected";
  await r.clock.advance(GATE_WATCH_EVERY_MS);
  await r.idle();
  assert.deepEqual(r.asked.records, [{
    by: "gravit-face",
    input: {
      action: "pass", whose: "owner", thesis: "Declined the Account's card for Gravit's order: buy 10 NVDA · limit 183 · paper-1.",
      symbol: "NVDA", market: "US", recall: "r-1", evidence: EVIDENCE,
    },
  }]);
  assert.deepEqual(r.registered(), ["registered: pass"]);
  assert.equal(r.clock.live(), 0);
});

test("Guard mode: rejected at or after expiresAt is an expiry: nothing written, the card says so", async () => {
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PENDING, "s-1");
  await r.clock.advance(EXPIRES - r.clock.now() - 1);
  await r.idle();
  r.state.approval = async () => "rejected";
  await r.clock.advance(GATE_WATCH_EVERY_MS);
  await r.idle();
  assert.equal(r.asked.records.length, 0);
  assert.deepEqual(r.registered(), ["not registered: the Account's card expired"]);
  assert.equal(r.clock.live(), 0);
});

test("Guard mode: still pending at expiresAt + GATE_WATCH_GRACE_MS: nothing, and the polling stops", async () => {
  assert.equal(GATE_WATCH_GRACE_MS, 60_000);
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PENDING, "s-1");
  await r.clock.advance(EXPIRES + GATE_WATCH_GRACE_MS - r.clock.now() + GATE_WATCH_EVERY_MS);
  await r.idle();
  const polls = r.asked.approvals.length;
  assert.ok(polls > 0);
  assert.equal(r.clock.live(), 0, "the polling stops");
  await r.clock.advance(GATE_WATCH_EVERY_MS * 4);
  assert.equal(r.asked.approvals.length, polls);
  assert.equal(r.asked.records.length, 0);
  assert.deepEqual(r.registered(), ["not registered: the Account's card expired"]);
});

test("Guard mode: unreadable at expiresAt + GATE_WATCH_GRACE_MS: nothing, and the polling stops", async () => {
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PENDING, "s-1");
  r.state.approval = async () => undefined;
  await r.clock.advance(EXPIRES + GATE_WATCH_GRACE_MS - r.clock.now() + GATE_WATCH_EVERY_MS);
  await r.idle();
  assert.equal(r.clock.live(), 0);
  assert.equal(r.asked.records.length, 0);
  assert.deepEqual(r.registered(), ["not registered: the Account's card could not be read"]);
});

test("Guard mode: an Account that never answers a poll is cut at GATE_WATCH_EVERY_MS and polled again", async () => {
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PENDING, "s-1");
  r.state.approval = never;
  await r.clock.advance(GATE_WATCH_EVERY_MS * 3);
  await r.idle();
  assert.ok(r.asked.approvals.length >= 2);
  r.state.approval = async () => "approved";
  await r.clock.advance(GATE_WATCH_EVERY_MS * 2);
  await r.idle();
  assert.equal(r.asked.records.length, 1);
  assert.equal(r.clock.live(), 0);
});

test("Guard mode: dispose while watching stops the polling and nothing is written afterwards", async () => {
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PENDING, "s-1");
  await r.clock.advance(GATE_WATCH_EVERY_MS);
  await r.idle();
  r.state.approval = async () => "approved";
  r.gate.dispose();
  assert.equal(r.clock.live(), 0);
  await r.clock.advance(GATE_WATCH_EVERY_MS * 3);
  await r.gate.idle();
  assert.equal(r.asked.approvals.length, 1);
  assert.equal(r.asked.records.length, 0);
});

test("dispose while a poll's answer is on its way: nothing is written", async () => {
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PENDING, "s-1");
  let answer: (s: Status) => void = () => {};
  r.state.approval = () => new Promise<Status>((resolve) => { answer = resolve; });
  await r.clock.advance(GATE_WATCH_EVERY_MS);
  r.gate.dispose();
  answer("approved");
  await r.clock.flush();
  await r.gate.idle();
  assert.equal(r.asked.records.length, 0);
  assert.equal(r.clock.live(), 0);
});

test("dispose while the position is being read again: the read's timer is cleared, and a result after it writes nothing", async () => {
  const r = rig();
  await r.check();
  const late = deferred();
  r.state.position = late.read;
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.dispose();
  assert.equal(r.clock.live(), 0);
  late.answer(LONG_10);
  r.gate.settled("c-1", PLACED, "s-1");
  await r.clock.flush();
  await r.gate.idle();
  assert.equal(r.asked.records.length, 0);
});

test("dispose while the memory is being opened for an approval: nothing is written", async () => {
  let opening: (s: MemoryStanding) => void = () => {};
  let calls = 0;
  const memory = { recall: async () => answerOf(), record: async () => { throw new Error("never written"); } } as unknown as Memory;
  const r = rig({
    open: () => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ connected: true, memory, home: "/tmp/m" }) : new Promise<MemoryStanding>((resolve) => { opening = resolve; });
    },
  });
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.clock.flush();
  r.gate.dispose();
  opening({ connected: true, memory, home: "/tmp/m" });
  await r.clock.flush();
  await r.gate.idle();
  assert.deepEqual(r.registered(), []);
  assert.equal(r.asked.logs.length, 0, "no write was tried");
  assert.equal(r.clock.live(), 0);
});

/* A batch, a fault, once, a coin. */

test("a batch of two: each line by its own leg's answer - one placed, one refused - one record", async () => {
  const r = rig();
  await r.check({ legs: [BUY, { venue: "paper-1", symbol: "AMD", side: "buy", qty: 4 }] }, "c-1", BATCH);
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", json({ ok: true, legs: [{ leg: 1, ok: true, order: { id: "o-1" } }, { leg: 2, ok: false, error: "no limit" }] }), "s-1");
  await r.idle();
  assert.deepEqual(r.asked.records, [{ by: "gravit-face", input: APPROVED_BUY }]);
  assert.deepEqual(r.registered(), ["registered: buy", "not registered: the seat refused the order"]);
});

test("a batch declined: a line each", async () => {
  const r = rig();
  await r.check({ legs: [BUY, SELL] }, "c-1", BATCH);
  r.gate.answered("c-1", "rejected", "s-1");
  await r.idle();
  assert.deepEqual(r.asked.records.map((x) => x.input.action), ["pass", "hold"]);
});

test("no recall on the line (the check faulted), the memory connected: the line is written without recall", async () => {
  const r = rig({ recall: async () => { throw new Error("E_IO: the ledger could not be read"); } });
  await r.check();
  r.gate.answered("c-1", "rejected", "s-1");
  await r.idle();
  assert.equal(r.asked.records.length, 1);
  assert.equal("recall" in r.asked.records[0].input, false);
});

test("not connected at registration: nothing more but one log line, and the standing's words on the card", async () => {
  let connected = true;
  const memory = { recall: async () => answerOf(), record: async () => { throw new Error("never"); } } as unknown as Memory;
  const r = rig({
    open: async () => (connected ? { connected: true, memory, home: "/tmp/m" } : { connected: false, why: "disabled", say: "the memory is not connected: the mcp-memory row is disabled" }),
  });
  await r.check();
  connected = false;
  const logs = r.asked.logs.length;
  r.gate.answered("c-1", "rejected", "s-1");
  await r.idle();
  assert.deepEqual(r.registered(), ["not registered: the memory is not connected: the mcp-memory row is disabled"]);
  assert.equal(r.asked.logs.length - logs, 1);
});

test("record throwing: nothing more but one log line, and the fault's words on the card", async () => {
  const fault = new Error("E_REFUSED: the ledger is locked");
  const r = rig({ record: async () => { throw fault; } });
  await r.check();
  r.gate.answered("c-1", "rejected", "s-1");
  await r.idle();
  assert.deepEqual(r.registered(), [`not registered: ${memoryFaultWords(fault)}`]);
  assert.equal(r.asked.logs.length, 1);
});

test("each call is registered once: a second answered or settled changes nothing", async () => {
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "rejected", "s-1");
  r.gate.answered("c-1", "rejected", "s-1");
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.equal(r.asked.records.length, 1);
  const a = rig();
  await a.check();
  a.gate.answered("c-1", "allowed-once", "s-1");
  a.gate.settled("c-1", PLACED, "s-1");
  a.gate.settled("c-1", PLACED, "s-1");
  a.gate.answered("c-1", "rejected", "s-1");
  await a.idle();
  assert.equal(a.asked.records.length, 1);
  assert.equal(a.asked.records[0].input.action, "buy");
});

test("a coin (no market placed): the record carries no symbol and no market", async () => {
  const r = rig({ kind: "crypto" });
  await r.check({ venue: "paper-1", symbol: "BTC/USDT", side: "buy", qty: 1 });
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.equal(r.asked.records.length, 1);
  const input = r.asked.records[0].input;
  assert.equal("symbol" in input, false);
  assert.equal("market" in input, false);
  assert.equal(input.thesis, "Approved Gravit's order card: buy 1 BTC/USDT · paper-1.");
  assert.deepEqual(r.asked.decisions, [], "no symbol, no own call asked");
});

/* The session, and the answered mark. */

test("answered and settled for another session are ignored", async () => {
  const r = rig();
  await r.check();
  r.gate.answered("c-1", "rejected", "s-2");
  r.gate.answered("c-1", "rejected", undefined as unknown as string);
  await r.idle();
  assert.equal(r.asked.records.length, 0);
  r.gate.answered("c-1", "allowed-once", "s-1");
  r.gate.settled("c-1", PLACED, "s-2");
  await r.idle();
  assert.equal(r.asked.records.length, 0, "a result for another session's call settles nothing");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.equal(r.asked.records.length, 1);
});

test("a placeholder - a kept callId being checked again - takes no answer", async () => {
  let hold = false;
  let release: (a: RecallAnswer) => void = () => {};
  const r = rig({ recall: () => (hold ? new Promise<RecallAnswer>((resolve) => { release = resolve; }) : Promise.resolve(answerOf())) });
  await r.check();
  hold = true;
  const again = r.gate.check({ callId: "c-1", name: ORDER, args: BUY, sessionId: "s-1" });
  await r.clock.flush();
  r.gate.answered("c-1", "rejected", "s-1");
  release(answerOf());
  await r.clock.run(again);
  await r.idle();
  assert.equal(r.asked.records.length, 0, "the placeholder took no answer");
  r.gate.answered("c-1", "rejected", "s-1");
  await r.idle();
  assert.equal(r.asked.records.length, 1, "the new entry takes its own");
});

test("every decided card is marked answered: override then answers answered, whatever the outcome", async () => {
  for (const outcome of ["allowed-once", "rejected", "cancelled", "unavailable"]) {
    const r = rig({ recall: async () => answerOf({ applies: [RED] }) });
    await r.check();
    r.gate.answered("c-1", outcome, "s-1");
    assert.equal(r.gate.override("c-1", { reason: "late words" }), "answered", outcome);
    await r.idle();
  }
});

test("a red line answered is evictable like any other entry", async () => {
  const r = rig({ recall: async () => answerOf({ applies: [RED] }) });
  await r.check();
  r.gate.answered("c-1", "rejected", "s-1");
  await r.idle();
  for (let i = 0; i < GATE_KEPT; i++) await r.check(BUY, `n-${i}`);
  assert.equal(r.gate.view("c-1"), undefined);
});

test("an override for the card answered with no override kept: the approval carries no words", async () => {
  const r = rig({ recall: async () => answerOf({ applies: [RED] }) });
  await r.check();
  r.gate.answered("c-1", "allowed-once", "s-1");
  assert.equal(r.gate.override("c-1", { reason: "after the answer" }), "answered");
  r.gate.settled("c-1", PLACED, "s-1");
  await r.idle();
  assert.deepEqual(r.asked.records[0].input, APPROVED_BUY);
});

/* seatOutcomes. */

test("seatOutcomes: placed, pending, refused, and a batch of each", () => {
  assert.deepEqual(seatOutcomes(PLACED, 1), [{ kind: "placed" }]);
  assert.deepEqual(seatOutcomes(PENDING, 1), [{ kind: "pending", card: "ap-1", expiresAt: EXPIRES }]);
  assert.deepEqual(seatOutcomes(json({ ok: true, pending: true, card: { id: "ap-2" } }), 1), [{ kind: "pending", card: "ap-2" }]);
  assert.deepEqual(seatOutcomes(json({ ok: false, code: "E_X", message: "m" }), 1), [{ kind: "refused" }]);
  assert.deepEqual(seatOutcomes(REFUSED, 1), [{ kind: "refused" }]);
  const batch = json({
    ok: true,
    legs: [
      { leg: 1, ok: true, order: { id: "o-1" } },
      { leg: 2, ok: true, pending: true, card: { id: "ap-3", expiresAt: new Date(EXPIRES).toISOString() } },
      { leg: 3, ok: false, error: "no limit" },
    ],
  });
  assert.deepEqual(seatOutcomes(batch, 3), [{ kind: "placed" }, { kind: "pending", card: "ap-3", expiresAt: EXPIRES }, { kind: "refused" }]);
  assert.deepEqual(seatOutcomes(json({ ok: false, legs: [{ leg: 1, ok: false, error: "x" }, { leg: 2, ok: false, error: "y" }] }, true), 2), [{ kind: "refused" }, { kind: "refused" }]);
});

test("seatOutcomes: an Error:-prefixed text is refused; text that is not JSON is unreadable for every line", () => {
  assert.deepEqual(seatOutcomes({ isError: true, text: 'Error: {"ok":false,"code":"E_X"}' }, 1), [{ kind: "refused" }]);
  assert.deepEqual(seatOutcomes({ isError: true, text: "Error: the call failed" }, 2), [{ kind: "refused" }, { kind: "refused" }]);
  assert.deepEqual(seatOutcomes({ isError: false, text: "not json" }, 2), [{ kind: "unreadable" }, { kind: "unreadable" }]);
  assert.deepEqual(seatOutcomes({ isError: false, text: "" }, 1), [{ kind: "unreadable" }]);
});

test("seatOutcomes: a batch whose legs count differs from the lines, legs out of order, or a lone answer for two lines, is unreadable", () => {
  const two = json({ ok: true, legs: [{ leg: 1, ok: true, order: {} }, { leg: 2, ok: true, order: {} }] });
  assert.deepEqual(seatOutcomes(two, 3), [{ kind: "unreadable" }, { kind: "unreadable" }, { kind: "unreadable" }]);
  const swapped = json({ ok: true, legs: [{ leg: 2, ok: true, order: {} }, { leg: 1, ok: true, order: {} }] });
  assert.deepEqual(seatOutcomes(swapped, 2), [{ kind: "unreadable" }, { kind: "unreadable" }]);
  assert.deepEqual(seatOutcomes(PLACED, 2), [{ kind: "unreadable" }, { kind: "unreadable" }]);
});

test("seatOutcomes: an ok answer with neither an order nor a card, a card with a bad id, or a bad expiry", () => {
  assert.deepEqual(seatOutcomes(json({ ok: true, result: {} }), 1), [{ kind: "unreadable" }]);
  assert.deepEqual(seatOutcomes(json({ ok: true, pending: true, card: { id: "a b\n" } }), 1), [{ kind: "unreadable" }]);
  assert.deepEqual(seatOutcomes(json({ ok: true, pending: true, card: { id: "ap-1", expiresAt: "soon" } }), 1), [{ kind: "pending", card: "ap-1" }]);
  assert.deepEqual(seatOutcomes(json([1, 2]), 1), [{ kind: "unreadable" }]);
});

/* followAnswers. */

function fakeCtx() {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();
  return {
    listeners,
    on(name: string, listener: (...args: never[]) => unknown): () => boolean {
      const list = listeners.get(name) ?? [];
      list.push(listener as (...args: unknown[]) => unknown);
      listeners.set(name, list);
      return () => { const at = list.indexOf(listener as (...args: unknown[]) => unknown); if (at >= 0) list.splice(at, 1); return at >= 0; };
    },
    emit(name: string, ...args: unknown[]): void { for (const l of listeners.get(name) ?? []) l(...args); },
  };
}
function fakeGate(kept: string[], throws = false) {
  const calls: unknown[][] = [];
  const gate: Pick<MemoryGate, "answered" | "settled" | "view"> = {
    answered: (...args) => { calls.push(["answered", ...args]); if (throws) throw new Error("boom"); },
    settled: (...args) => { calls.push(["settled", ...args]); if (throws) throw new Error("boom"); },
    view: (callId) => (kept.includes(callId) ? ({ callId } as GateView) : undefined),
  };
  return { gate, calls };
}
const asked = (id: string, callId: string) => ({ type: "approval/asked", data: { id, callId, toolName: ORDER } });
const decided = (id: string, outcome: string) => ({ type: "approval/decided", data: { id, outcome } });

test("followAnswers: an asked for a kept callId, then its decided, calls answered with the session's id", () => {
  const ctx = fakeCtx();
  const { gate, calls } = fakeGate(["c-1"]);
  followAnswers(ctx, gate);
  ctx.emit("session/event", { id: "s-1" }, asked("ap-x", "c-1"));
  ctx.emit("session/event", { id: "s-1" }, { type: "turn/start", data: {} });
  ctx.emit("session/event", { id: "s-1" }, decided("ap-x", "rejected"));
  ctx.emit("session/event", { id: "s-1" }, decided("ap-x", "allowed-once"));
  assert.deepEqual(calls, [["answered", "c-1", "rejected", "s-1"]], "a decided is paired once");
});

test("followAnswers: a decided whose asked named a callId the gate does not keep, or from another session, calls nothing", () => {
  const ctx = fakeCtx();
  const { gate, calls } = fakeGate(["c-1"]);
  followAnswers(ctx, gate);
  ctx.emit("session/event", { id: "s-1" }, asked("ap-1", "c-9"));
  ctx.emit("session/event", { id: "s-1" }, decided("ap-1", "rejected"));
  ctx.emit("session/event", { id: "s-1" }, asked("ap-2", "c-1"));
  ctx.emit("session/event", { id: "s-2" }, decided("ap-2", "rejected"));
  ctx.emit("session/event", { id: "s-1" }, decided("ap-3", "rejected"));
  ctx.emit("session/event", { id: "s-1" }, { type: "approval/asked", data: { id: "ap-4", callId: "bad id\n" } });
  ctx.emit("session/event", { id: "s-1" }, decided("ap-4", "rejected"));
  assert.deepEqual(calls, []);
});

test("followAnswers: a tools/result for a kept callId calls settled with isError, the first text block and the agent's id", () => {
  const ctx = fakeCtx();
  const { gate, calls } = fakeGate(["c-1"]);
  followAnswers(ctx, gate);
  ctx.emit("tools/result", { callId: "c-1", name: ORDER, agent: { id: "s-1" } }, { isError: false, content: [{ type: "image", data: "x" }, { type: "text", text: '{"ok":true}' }, { type: "text", text: "second" }] });
  ctx.emit("tools/result", { callId: "c-1", name: ORDER, agent: { id: "s-1" } }, { isError: true, content: [] });
  ctx.emit("tools/result", { callId: "c-2", name: ORDER, agent: { id: "s-1" } }, { isError: false, content: [{ type: "text", text: "{}" }] });
  ctx.emit("tools/result", { name: ORDER, agent: { id: "s-1" } }, { isError: false, content: [] });
  assert.deepEqual(calls, [
    ["settled", "c-1", { isError: false, text: '{"ok":true}' }, "s-1"],
    ["settled", "c-1", { isError: true, text: "" }, "s-1"],
  ]);
});

test("followAnswers: a listener that throws inside is caught; the disposer removes both listeners", () => {
  const ctx = fakeCtx();
  const { gate, calls } = fakeGate(["c-1"], true);
  const off = followAnswers(ctx, gate);
  ctx.emit("session/event", { id: "s-1" }, asked("ap-1", "c-1"));
  assert.doesNotThrow(() => ctx.emit("session/event", { id: "s-1" }, decided("ap-1", "rejected")));
  assert.doesNotThrow(() => ctx.emit("tools/result", { callId: "c-1", agent: { id: "s-1" } }, { isError: false, content: [{ type: "text", text: "{}" }] }));
  assert.doesNotThrow(() => ctx.emit("session/event", null, null));
  assert.doesNotThrow(() => ctx.emit("tools/result", null, null));
  assert.equal(calls.length, 2);
  off();
  assert.equal(ctx.listeners.get("session/event")?.length, 0);
  assert.equal(ctx.listeners.get("tools/result")?.length, 0);
});

/* gateAccount.approval. */

function overviewOf(answer: UpstreamAnswer | (() => Promise<UpstreamAnswer>)) {
  return gateAccount({
    reader: { read: async () => ({ unreachable: "ECONNREFUSED" }) },
    positions: async () => ({ unreachable: "ECONNREFUSED" }),
    market: async () => ({ unreachable: "ECONNREFUSED" }),
    overview: typeof answer === "function" ? answer : async () => answer,
  });
}
const okBody = (body: unknown, status = 200): UpstreamAnswer => ({ status, body: JSON.stringify(body) });

test("gateAccount.approval: the status of the approvals entry with that id; undefined on anything else", async () => {
  const approvals = [{ id: "ap-1", status: "pending" }, { id: "ap-2", status: "approved" }, { id: "ap-3", status: "rejected" }, { id: "ap-4", status: "odd" }];
  const account = overviewOf(okBody({ approvals }));
  assert.equal(await account.approval("ap-1"), "pending");
  assert.equal(await account.approval("ap-2"), "approved");
  assert.equal(await account.approval("ap-3"), "rejected");
  assert.equal(await account.approval("ap-4"), undefined);
  assert.equal(await account.approval("ap-9"), undefined);
  assert.equal(await overviewOf(okBody({ approvals }, 503)).approval("ap-1"), undefined);
  assert.equal(await overviewOf(okBody({ approvals: "no" })).approval("ap-1"), undefined);
  assert.equal(await overviewOf({ unreachable: "disabled" }).approval("ap-1"), undefined);
  assert.equal(await overviewOf(async () => { throw new Error("x"); }).approval("ap-1"), undefined);
});
