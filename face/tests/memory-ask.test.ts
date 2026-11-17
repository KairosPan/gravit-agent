/** src/memory-ask.ts: one recall as gravit-face, its answer mapped into lessons, untold, counts, the recall id and a
 * fault - on a stub memory and an injected timer. Nothing leaves the process and no real timer is waited on. */
import test from "node:test";
import assert from "node:assert/strict";
import type { Memory, RecallAnswer } from "gravit-memory";
import { ASK_LATE, askMemory, type AskInput } from "../src/memory-ask.ts";
import { memoryFaultWords, type MemoryStanding } from "../src/memory.ts";

const never = <T>(): Promise<T> => new Promise<T>(() => {});
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

/** A recall answer with `over` laid on an empty one. */
function answerOf(over: Partial<RecallAnswer> = {}): RecallAnswer {
  return {
    recall_id: "r-20260302-0f3a9c21", applies: [], applies_more: 0, untold: [], untold_more: 0, same: [], like: [],
    house: { armed: 0, may_be_due: 0, proposals_waiting: 0, cards_changed: [], cards_broken: [], owner_chain_broken: false, chains_broken: [], partial: [] },
    text: "", ...over,
  } as RecallAnswer;
}
const LESSON = {
  id: "L-0001", strength: "caveat", says: "careful", actions: ["add"], words: "do not chase a gap",
  record: { owner: { fired: 3, followed: 2, overridden: 1, seen: 4, backfilled: 0, no_decision: 0 }, agents: { followed: 0, overridden: 0, seen: 0 } },
} as unknown as RecallAnswer["applies"][number];
const UNTOLD = { id: "L-0002", needs: [{ what: "fact", fact: "change_5d_pct" }, { what: "market" }] } as unknown as RecallAnswer["untold"][number];
const ANSWER = answerOf({ applies: [LESSON], applies_more: 2, untold: [UNTOLD], untold_more: 1 });

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

/** A connected memory whose recall records its arguments and answers with `recall`. */
function memoryOf(recall: (by: string, input: unknown) => Promise<RecallAnswer> = async () => ANSWER) {
  const calls: Array<{ by: string; input: unknown }> = [];
  const memory = { recall: (by: string, input: unknown) => { calls.push({ by, input }); return recall(by, input); } } as unknown as Memory;
  const open = async (): Promise<MemoryStanding> => ({ connected: true, memory, home: "/tmp/m" });
  return { calls, open };
}

const INPUT: AskInput = { considering: ["buy"], symbol: "600519", market: "CN", facts: { facts: { price: 10, industry: "白酒" }, sources: { price: "s", industry: "t" } } };

test("connected: one recall as gravit-face, its answer mapped", async () => {
  const { calls, open } = memoryOf();
  const t = timerOf();
  const answer = await askMemory(open, INPUT, { ms: 3_000, setTimer: t.setTimer, clearTimer: t.clearTimer });
  assert.deepEqual(answer, {
    asked: {
      recall: "r-20260302-0f3a9c21",
      lessons: [{ id: "L-0001", strength: "caveat", says: "careful", words: "do not chase a gap", fired: 3, followed: 2, overridden: 1 }],
      lessonsMore: 2,
      untold: [{ id: "L-0002", needs: ["change_5d_pct", "market"] }],
      untoldMore: 1,
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].by, "gravit-face");
  assert.equal(t.live(), 0, "no timer is left");
});

test("what recall is given: the question, the facts and their sources", async () => {
  const { calls, open } = memoryOf();
  await askMemory(open, INPUT, { ms: 3_000 });
  assert.deepEqual(calls[0].input, {
    considering: ["buy"], symbol: "600519", market: "CN",
    facts: { price: 10, industry: "白酒" }, fact_sources: { price: "s", industry: "t" },
  });
});

test("no symbol and no facts: the question alone, as the gate asks it", async () => {
  const { calls, open } = memoryOf();
  await askMemory(open, { considering: ["sell"], facts: { facts: {}, sources: {} } }, { ms: 3_000 });
  assert.deepEqual(calls[0].input, { considering: ["sell"] });
});

test("not connected: the standing's words", async () => {
  const open = async (): Promise<MemoryStanding> => ({ connected: false, why: "no home named", say: "no memory here" });
  assert.deepEqual(await askMemory(open, INPUT, { ms: 3_000 }), { notConnected: "no memory here" });
});

test("a recall that throws or rejects, an open that rejects or throws: a fault, nothing applies", async () => {
  const empty = { lessons: [], lessonsMore: 0, untold: [], untoldMore: 0 };
  const error = new Error("the store is locked");
  const rejecting = memoryOf(() => Promise.reject(error));
  assert.deepEqual(await askMemory(rejecting.open, INPUT, { ms: 3_000 }), { asked: { ...empty, fault: memoryFaultWords(error) } });
  const throwing = memoryOf(() => { throw error; });
  assert.deepEqual(await askMemory(throwing.open, INPUT, { ms: 3_000 }), { asked: { ...empty, fault: memoryFaultWords(error) } });
  assert.deepEqual(await askMemory(() => Promise.reject(error), INPUT, { ms: 3_000 }), { asked: { ...empty, fault: memoryFaultWords(error) } });
  assert.deepEqual(await askMemory(() => { throw error; }, INPUT, { ms: 3_000 }), { asked: { ...empty, fault: memoryFaultWords(error) } });
});

test("an answer that cannot be read is a fault, with no recall id", async () => {
  const { open } = memoryOf(async () => ({ recall_id: "r-1", applies: null }) as unknown as RecallAnswer);
  const answer = await askMemory(open, INPUT, { ms: 3_000 });
  assert.ok("asked" in answer);
  assert.equal(answer.asked.recall, undefined);
  assert.deepEqual(answer.asked.lessons, []);
  assert.equal(typeof answer.asked.fault, "string");
});

test("a recall that never answers settles at ms as late; its later answer changes nothing", async () => {
  let answerNow: (a: RecallAnswer) => void = () => {};
  const { open } = memoryOf(() => new Promise<RecallAnswer>((resolve) => { answerNow = resolve; }));
  const t = timerOf();
  const pending = askMemory(open, INPUT, { ms: 1_234, setTimer: t.setTimer, clearTimer: t.clearTimer });
  let settled = false;
  void pending.then(() => { settled = true; });
  await flush();
  assert.equal(settled, false, "waiting on the recall");
  assert.deepEqual(t.timers.map((x) => x.ms), [1_234]);
  t.timers[0].run();
  const answer = await pending;
  assert.deepEqual(answer, { asked: { lessons: [], lessonsMore: 0, untold: [], untoldMore: 0, fault: ASK_LATE } });
  answerNow(ANSWER);
  await flush();
  assert.deepEqual(answer, { asked: { lessons: [], lessonsMore: 0, untold: [], untoldMore: 0, fault: ASK_LATE } }, "the late answer changed nothing");
});

test("an open that never answers settles at ms as late; no time left asks nothing", async () => {
  const t = timerOf();
  const pending = askMemory(never, INPUT, { ms: 500, setTimer: t.setTimer, clearTimer: t.clearTimer });
  await flush();
  t.timers[0].run();
  assert.deepEqual(await pending, { asked: { lessons: [], lessonsMore: 0, untold: [], untoldMore: 0, fault: ASK_LATE } });
  let opened = 0;
  const none = await askMemory(async () => { opened += 1; return { connected: false, why: "disabled", say: "x" }; }, INPUT, { ms: 0 });
  assert.deepEqual(none, { asked: { lessons: [], lessonsMore: 0, untold: [], untoldMore: 0, fault: ASK_LATE } });
  assert.equal(opened, 0, "nothing was opened");
});

test("a timer that cannot be set settles at once as late", async () => {
  const { calls, open } = memoryOf(never);
  const answer = await askMemory(open, INPUT, { ms: 3_000, setTimer: () => { throw new Error("no timers"); } });
  assert.deepEqual(answer, { asked: { lessons: [], lessonsMore: 0, untold: [], untoldMore: 0, fault: ASK_LATE } });
  assert.equal(calls.length, 0);
});

test("a home that was never made, from the recall or from open: not connected, in the memory's words", async () => {
  const noHome = Object.assign(new Error("no memory here: run gravit-memory init"), { code: "E_NO_HOME" });
  const words = memoryFaultWords(noHome);
  const fromRecall = memoryOf(() => Promise.reject(noHome));
  assert.deepEqual(await askMemory(fromRecall.open, INPUT, { ms: 3_000 }), { notConnected: words });
  const throwing = memoryOf(() => { throw noHome; });
  assert.deepEqual(await askMemory(throwing.open, INPUT, { ms: 3_000 }), { notConnected: words });
  assert.deepEqual(await askMemory(() => Promise.reject(noHome), INPUT, { ms: 3_000 }), { notConnected: words });
  assert.deepEqual(await askMemory(() => { throw noHome; }, INPUT, { ms: 3_000 }), { notConnected: words });
  const other = Object.assign(new Error("locked"), { code: "E_LOCKED" });
  const coded = await askMemory(memoryOf(() => Promise.reject(other)).open, INPUT, { ms: 3_000 });
  assert.ok("asked" in coded && coded.asked.fault === memoryFaultWords(other), "another code stays a fault");
});
