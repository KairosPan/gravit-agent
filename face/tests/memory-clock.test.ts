import test from "node:test";
import assert from "node:assert/strict";
import type { Memory, ReconcileReport } from "gravit-memory";
import {
  MEMORY_EVERY_MS,
  MEMORY_FIRST_MS,
  MEMORY_LIMIT_MS,
  installMemoryClock,
  memoryClockEnabled,
  reconcileLine,
  type MemoryClockDeps,
} from "../src/memory-clock.ts";
import type { MemoryStanding } from "../src/memory.ts";

/** A timer the clock asked for: what it runs, after how long, and whether it was cleared. */
type FakeTimer = { fn: () => void; ms: number; cleared: boolean };

/** Injected timers that never fire on their own: the test fires them. */
function fakeTimers(): { timers: FakeTimer[]; deps: Pick<MemoryClockDeps, "setTimer" | "clearTimer"> } {
  const timers: FakeTimer[] = [];
  return {
    timers,
    deps: {
      setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
      clearTimer: (timer) => { (timer as FakeTimer).cleared = true; },
    },
  };
}

/** A report as the package gives it, with what a test names over nothing measured. */
function report(over: Partial<ReconcileReport> = {}): ReconcileReport {
  return { source: "http://127.0.0.1:4821", measured: 0, closed: 0, stillDue: 0, refused: [], unmeasured: [], written: [], ...over };
}

/** A connected standing whose memory answers `reconcile` with `answer`, noting who asked. */
function connected(answer: (by: string) => Promise<ReconcileReport>, calls: string[] = []): () => Promise<MemoryStanding> {
  const memory = { reconcile: (by: string) => { calls.push(by); return answer(by); } } as unknown as Memory;
  return async () => ({ connected: true, memory, home: "/memory/home" });
}

/** Lets every settled promise run its continuations. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("two minutes after boot, then every eight hours", async () => {
  assert.equal(MEMORY_FIRST_MS, 120_000);
  assert.equal(MEMORY_EVERY_MS, 28_800_000);
  assert.equal(MEMORY_LIMIT_MS, 60_000);
  const { timers, deps } = fakeTimers();
  const lines: string[] = [];
  const clock = installMemoryClock({ open: connected(async () => report({ measured: 1 })), log: (l) => lines.push(l), ...deps });
  // installing runs nothing yet
  assert.deepEqual(timers.map((t) => t.ms), [120_000]);
  assert.deepEqual(lines, []);
  timers[0]!.fn();
  await settle();
  assert.deepEqual(lines, ["memory: reconciled: measured 1, closed 0, still due 0, refused 0"]);
  const ticks = () => timers.filter((t) => t.ms !== MEMORY_LIMIT_MS).map((t) => t.ms);
  assert.deepEqual(ticks(), [120_000, 28_800_000]);
  timers.filter((t) => t.ms === MEMORY_EVERY_MS).at(-1)!.fn();
  await settle();
  assert.equal(lines.length, 2);
  assert.deepEqual(ticks(), [120_000, 28_800_000, 28_800_000]);
  // each run's limit was asked for, and cleared once the run came back
  const limits = timers.filter((t) => t.ms === MEMORY_LIMIT_MS);
  assert.equal(limits.length, 2);
  assert.ok(limits.every((t) => t.cleared));
  clock.dispose();
});

test("it reconciles as gravit-face and says what was measured", async () => {
  const calls: string[] = [];
  const lines: string[] = [];
  const answer = async () => report({ measured: 3, closed: 1, stillDue: 2, refused: [{ market: "us", symbol: "AAA", why: "no bars" }] });
  const clock = installMemoryClock({ open: connected(answer, calls), log: (l) => lines.push(l), ...fakeTimers().deps });
  const line = await clock.runOnce();
  assert.deepEqual(calls, ["gravit-face"]);
  assert.equal(line, "memory: reconciled: measured 3, closed 1, still due 2, refused 1");
  assert.deepEqual(lines, [line]);
  clock.dispose();
});

test("fresh, no source, no home, not connected, a fault: each its line", async () => {
  const lineOf = async (open: () => Promise<MemoryStanding>) => {
    const lines: string[] = [];
    const clock = installMemoryClock({ open, log: (l) => lines.push(l), ...fakeTimers().deps });
    const line = await clock.runOnce();
    clock.dispose();
    assert.deepEqual(lines, [line]);
    return line;
  };
  const fresh = report({ fresh: { asked_at: "2026-11-13T14:00:00.000Z", again_after: "2026-11-13T15:00:00.000Z", refused: 0 } });
  assert.equal(await lineOf(connected(async () => fresh)),
    "memory: reconcile fresh: the source was asked at 2026-11-13T14:00:00.000Z, again after 2026-11-13T15:00:00.000Z");
  assert.equal(await lineOf(connected(async () => report({ source: null }))),
    "memory: reconcile skipped: the home's config.json names no price source");
  const noHome = Object.assign(new Error("no memory here"), { code: "E_NO_HOME" });
  assert.equal(await lineOf(connected(async () => { throw noHome; })), "memory: no memory here: run gravit-memory init");
  assert.equal(await lineOf(async () => ({ connected: false, why: "disabled", say: "the memory is not connected: the mcp-memory row is disabled" })),
    "memory: the memory is not connected: the mcp-memory row is disabled");
  assert.equal(await lineOf(connected(async () => { throw new Error("the ledger\nis torn"); })),
    "memory: reconcile failed: the ledger is torn");
  // an open that throws is a fault too
  assert.equal(await lineOf(async () => { throw new Error("refused"); }), "memory: reconcile failed: refused");
});

test("a run that does not come back is abandoned at 60 s and the next tick runs", async () => {
  const { timers, deps } = fakeTimers();
  const lines: string[] = [];
  const calls: string[] = [];
  let late: ((r: ReconcileReport) => void) | undefined;
  let answers = 0;
  const answer = () => {
    answers += 1;
    return answers === 1 ? new Promise<ReconcileReport>((resolve) => { late = resolve; }) : Promise.resolve(report({ measured: 2 }));
  };
  const clock = installMemoryClock({ open: connected(answer, calls), log: (l) => lines.push(l), ...deps });
  timers[0]!.fn();
  await settle();
  assert.deepEqual(calls, ["gravit-face"]);
  assert.deepEqual(lines, []);
  // a tick while the run is inside its limit is skipped and says nothing
  const tick = () => timers.filter((t) => t.ms === MEMORY_EVERY_MS).at(-1)!.fn();
  tick();
  await settle();
  assert.deepEqual(calls, ["gravit-face"]);
  assert.deepEqual(lines, []);
  // the limit passes: one line, the run left to finish
  timers.find((t) => t.ms === MEMORY_LIMIT_MS)!.fn();
  await settle();
  assert.deepEqual(lines, ["memory: reconcile passed its 60 s limit and is left to finish"]);
  // the next tick starts a new run
  tick();
  await settle();
  assert.deepEqual(calls, ["gravit-face", "gravit-face"]);
  assert.deepEqual(lines.at(-1), "memory: reconciled: measured 2, closed 0, still due 0, refused 0");
  // the abandoned run's late result logs nothing
  late!(report({ measured: 9 }));
  await settle();
  assert.equal(lines.length, 2);
  clock.dispose();
});

test("runOnce on its own resolves to the limit line when the run does not come back", async () => {
  const { timers, deps } = fakeTimers();
  const lines: string[] = [];
  const clock = installMemoryClock({ open: connected(() => new Promise<ReconcileReport>(() => {})), log: (l) => lines.push(l), ...deps });
  const run = clock.runOnce();
  await settle();
  timers.find((t) => t.ms === MEMORY_LIMIT_MS)!.fn();
  assert.equal(await run, "memory: reconcile passed its 60 s limit and is left to finish");
  assert.deepEqual(lines, [await run]);
  clock.dispose();
});

test("dispose clears the timers and waits for nothing", async () => {
  const { timers, deps } = fakeTimers();
  const lines: string[] = [];
  const clock = installMemoryClock({ open: connected(() => new Promise<ReconcileReport>(() => {})), log: (l) => lines.push(l), ...deps });
  timers[0]!.fn();
  await settle();
  assert.equal(clock.dispose(), undefined);
  // the first tick has fired; the next tick and the run's limit were still pending, and both are cleared
  const pending = timers.slice(1);
  assert.deepEqual(pending.map((t) => t.ms).sort(), [MEMORY_EVERY_MS, MEMORY_LIMIT_MS].sort());
  assert.ok(pending.every((t) => t.cleared));
  assert.deepEqual(lines, []);
});

test("the default timers do not hold the process open", () => {
  // what keeps the event loop alive, as node counts it: an unref'd timer is not among it
  const holding = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  const before = holding();
  const clock = installMemoryClock({ open: async () => { throw new Error("never"); }, log: () => {} });
  assert.equal(holding(), before);
  clock.dispose();
});

test("off when FACE_MEMORY_RECONCILE is 0", () => {
  assert.equal(memoryClockEnabled({ FACE_MEMORY_RECONCILE: "0" }), false);
  assert.equal(memoryClockEnabled({}), true);
  assert.equal(memoryClockEnabled({ FACE_MEMORY_RECONCILE: "1" }), true);
});

test("the helper turns it off for every test boot", async () => {
  await import("./helpers/no-memory.ts");
  assert.equal(memoryClockEnabled(), false);
});

test("the line of a report, by itself", () => {
  assert.equal(reconcileLine(report({ measured: 0 })), "memory: reconciled: measured 0, closed 0, still due 0, refused 0");
  assert.equal(reconcileLine(report({ source: null })), "memory: reconcile skipped: the home's config.json names no price source");
});
