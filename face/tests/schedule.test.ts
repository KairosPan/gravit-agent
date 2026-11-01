// face/tests/schedule.test.ts
/** The clock row (src/schedule.ts): when a standing order is due, missed or settled - across the early close, the
 * Mac's sleep, a restart and a second face on one home -, what each refusal records and phones, the fail-closed stops
 * - a refused standing.yml, an unreadable firing ledger, a day with no calendar -, the status it keeps, a rotation of
 * the firing ledger, and its disposal. Offline: a WallClock, a fake calendar or the real one over a stand-in ask, the
 * real checkFiring over a fixture root and harness home, and a run that records its calls (tests/desk-fakes.ts). The
 * ticks are driven by hand - `tick()` at a time the test sets - so no case depends on how many turns of the event loop
 * a tick's I/O takes. Each case's repository root and harness home sit INSIDE the repository, under
 * tests/tmp/schedule-<pid>/, and are removed afterwards; createDeskSchedule's case runs a stand-in clock - JavaScript
 * under scripts/market_clock.py, pinned by its own hash and run by node itself (process.execPath) from its private copy. */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent, appendRecord, clearOff, deskDir, FIRINGS_FILE, readBudget, readEvents, readRecords, writeOff, type DeskEvent } from "../src/desk.ts";
import type { DeliverResult } from "../src/desk-conversation.ts";
import type { DeskSessionCtxLike } from "../src/desk-session.ts";
import {
  checkFiring, isFiringRecord, LINES, type FinishedRecord, type FiringDeps, type FiringItem, type FiringRecord, type runFiring, type Verified,
} from "../src/firing.ts";
import { createMarketCalendar, type MarketCalendar, type MarketSession, type MarketWindow } from "../src/market-clock.ts";
import { defaultProducerRunner } from "../src/producer.ts";
import { createDeskSchedule, decide, installSchedule, SCHEDULE_TICK_MS, type ScheduleDeps, type ScheduleHandle } from "../src/schedule.ts";
import { parseStanding, rehashOrder, renderOrder, sha256Hex, STANDING_FILE, writeStanding, type ArmEntry } from "../src/standing.ts";

/** The errors parseStanding refuses `text` with. */
const parseStandingErrors = (text: string): string[] => {
  const load = parseStanding(text);
  if (load.ok) throw new Error("it loads");
  return load.errors;
};
import { fakeAgents, fakeBus, fakeCalendar, recordingDeliver, WallClock } from "./desk-fakes.ts";

/* ---------- fixtures, inside the repository ---------- */

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "tmp", `schedule-${process.pid}`);
before(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
  /* CommonJS for the stand-in clock: face/package.json says "module", under which node refuses a .py file. */
  await writeFile(join(TEST_DIR, "package.json"), '{ "type": "commonjs" }\n');
});
after(() => rm(TEST_DIR, { recursive: true, force: true }));

/** The order's text as armed. */
const STANDING = "# The pre-close brief\n\nSPY · QQQ · IWM: the day's moves, then the book. Never recommend a trade.\n";

/** A repository root - desk/STANDING.md and desk/journal/ - and a harness home whose desk directory exists. */
interface Fixture {
  root: string;
  home: string;
}
let made = 0;
async function fixture(): Promise<Fixture> {
  const dir = join(TEST_DIR, String(++made));
  const root = join(dir, "root");
  const home = join(dir, "home");
  await mkdir(join(root, "desk", "journal"), { recursive: true });
  await mkdir(deskDir(home), { recursive: true });
  await writeFile(join(root, "desk", "STANDING.md"), STANDING);
  return { root, home };
}

/** The pre-close brief as `npm run desk -- arm` writes it: close-30m, builtin:brief, armed a week before. */
const ENTRY: ArmEntry = {
  id: "preclose", dir: "desk", file: "STANDING.md", sha256: sha256Hex(STANDING), at: "close-30m", producer: "builtin:brief", wake: true,
  turnDeadline: "10m", producerDeadline: "5m", expires: "2026-12-31", armedAt: "2026-11-20T15:00:00.000Z",
};

/** Write `standing.yml` holding `entries`, as arm renders them, and a budget when given; its text. */
async function arm(home: string, entries: ArmEntry[], dailyTokens?: number): Promise<string> {
  const budget = dailyTokens === undefined ? "" : `budget:\n  dailyTokens: ${dailyTokens}\n`;
  const text = `${budget}orders:\n${entries.map((entry) => renderOrder(entry, 2)).join("")}`;
  await writeStanding(home, text);
  return text;
}

/* ---------- the calendar ---------- */

const regular = (date: string): MarketSession => ({ date, open: `${date}T14:30:00Z`, close: `${date}T21:00:00Z`, early: false });
/** Thanksgiving week, 2026: the 26th closed, the 27th an early close at 13:00 ET, then a weekend. */
const DAYS: Record<string, MarketSession | "closed"> = {
  "2026-11-24": regular("2026-11-24"),
  "2026-11-25": regular("2026-11-25"),
  "2026-11-26": "closed",
  "2026-11-27": { date: "2026-11-27", open: "2026-11-27T14:30:00Z", close: "2026-11-27T18:00:00Z", early: true },
  "2026-11-28": "closed",
  "2026-11-29": "closed",
  "2026-11-30": regular("2026-11-30"),
  "2026-12-01": regular("2026-12-01"),
};

/** The clock's window of `days` days from `from`, over DAYS. */
function windowFrom(from: string, days = 10): MarketWindow {
  const [y, m, d] = from.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  const sessions = Object.values(DAYS).filter((day): day is MarketSession => day !== "closed" && day.date >= from && day.date < end);
  return { from, days, source: "a stand-in clock", python: "python3", sessions };
}

/* ---------- the schedule's world ---------- */

/** One call of the recording run: the firing's key, the clock when it ran, what it was handed. */
interface RunCall {
  key: string;
  at: number;
  item: FiringItem;
  verified: Verified;
  signal: AbortSignal;
}

/** A run that records its call, waits on `hold` when given, and - unless aborted by then - ends as src/firing.ts's
 * does: a `finished` record, delivered, appended to the ledger and returned. */
function recordingRun(calls: RunCall[], hold?: (call: RunCall, deps: FiringDeps) => Promise<void>): typeof runFiring {
  return async (deps, item, verified, signal) => {
    const call: RunCall = { key: item.key, at: deps.clock.now(), item, verified, signal };
    calls.push(call);
    if (hold !== undefined) await hold(call, deps);
    if (signal.aborted) return undefined;
    const record: FinishedRecord = {
      t: new Date(deps.clock.now()).toISOString(), kind: "finished", key: item.key, order: item.order.id, date: item.date, wallMs: 4_000,
      turn: { sessionId: "session-run", outcome: "ended", deadlineMs: item.order.turnDeadlineMs, wallMs: 3_000 },
      files: [], delivery: { sent: [1] }, chars: 5,
    };
    await appendRecord(deps.home, FIRINGS_FILE, record);
    return record;
  };
}

interface Rig {
  fx: Fixture;
  clock: WallClock;
  schedule: ScheduleHandle;
  out: ReturnType<typeof recordingDeliver>;
  /** The face's log lines. */
  lines: string[];
  runs: RunCall[];
}

/** A day of ticks: so long that no timer tick lands inside a case, which drives its ticks by hand. */
const DAY_MS = 86_400_000;

/** A schedule over `fx` on a WallClock at `start`: the real checkFiring, the recording run (or `run`), DAYS' calendar
 * (or `calendar`), a delivery that records each line, the budget read as the face reads it. */
function rig(fx: Fixture, start: string, opts: {
  calendar?: MarketCalendar;
  hold?: (call: RunCall, deps: FiringDeps) => Promise<void>;
  run?: typeof runFiring;
  bootedAt?: number;
  answer?: (text: string, n: number) => DeliverResult;
} = {}): Rig {
  const clock = new WallClock(start);
  const out = recordingDeliver(opts.answer);
  const lines: string[] = [];
  const runs: RunCall[] = [];
  const agents = fakeAgents();
  let handle: ScheduleHandle | undefined;
  const deps: ScheduleDeps = {
    home: fx.home,
    root: fx.root,
    clock,
    calendar: opts.calendar ?? fakeCalendar(DAYS),
    runScript: defaultProducerRunner(process.execPath, []),
    builtins: {},
    createAgent: (o) => agents.createAgent(o),
    resolveRoute: async () => ({ provider: "stub", model: "echo" }),
    on: fakeBus().on,
    deliver: (text) => out.deliver(text),
    budget: () => readBudget(fx.home, clock.now(), handle?.dailyTokens()),
    log: (line) => { lines.push(line); },
    tickMs: DAY_MS,
    firing: { check: checkFiring, run: opts.run ?? recordingRun(runs, opts.hold) },
    ...(opts.bootedAt === undefined ? {} : { bootedAt: opts.bootedAt }),
  };
  handle = installSchedule(deps);
  return { fx, clock, schedule: handle, out, lines, runs };
}

/** Poll, in real time, until `ok` holds: the ledger and the checks settle on real file I/O, which no fake clock drives. */
async function waitFor(what: string, ok: () => boolean, ms = 5_000): Promise<void> {
  const until = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 2));
  }
}

/** Until the runner has nothing queued and nothing running. */
const idle = (schedule: ScheduleHandle): Promise<void> =>
  waitFor("the runner to go idle", () => {
    const s = schedule.status();
    return s.queued.length === 0 && s.running === undefined;
  });

/** Tick at `iso`, then wait for whatever the tick queued. */
async function at(r: Rig, iso: string): Promise<void> {
  r.clock.set(iso);
  await r.schedule.tick();
  await idle(r.schedule);
}

const iso = (ms: number): string => new Date(ms).toISOString();
const firings = async (home: string): Promise<FiringRecord[]> => (await readRecords(home, FIRINGS_FILE, isFiringRecord)).records;
async function ofKind<K extends FiringRecord["kind"]>(home: string, kind: K): Promise<Extract<FiringRecord, { kind: K }>[]> {
  return (await firings(home)).filter((r): r is Extract<FiringRecord, { kind: K }> => r.kind === kind);
}
async function eventsOf<K extends DeskEvent["kind"]>(home: string, kind: K): Promise<Extract<DeskEvent, { kind: K }>[]> {
  return (await readEvents(home)).events.filter((e): e is Extract<DeskEvent, { kind: K }> => e.kind === kind);
}
const ledgerPath = (home: string): string => join(deskDir(home), FIRINGS_FILE);

/* ---------- deciding ---------- */

test("decide: wait before the anchor, due inside the grace, missed after it - unless started, missed, refused, pending or armed after it", () => {
  assert.equal(SCHEDULE_TICK_MS, 30_000);
  const anchorMs = Date.parse("2026-11-27T17:30:00Z");
  const base = {
    anchorMs, nowMs: anchorMs, graceMs: 300_000, armedFromMs: Date.parse("2026-11-20T15:00:00Z"), started: false, missed: false, refused: false, pending: false,
  };
  assert.equal(decide({ ...base, nowMs: anchorMs - 1 }), "wait");
  assert.equal(decide(base), "due", "at the anchor");
  assert.equal(decide({ ...base, nowMs: anchorMs + 300_000 }), "due", "the grace's last millisecond");
  assert.equal(decide({ ...base, nowMs: anchorMs + 300_001 }), "missed");
  for (const flag of ["started", "missed"] as const) {
    for (const nowMs of [anchorMs - 60_000, anchorMs, anchorMs + 600_000]) assert.equal(decide({ ...base, nowMs, [flag]: true }), "settled", `${flag} at ${iso(nowMs)}`);
  }
  assert.equal(decide({ ...base, refused: true }), "due", "a refusal consumes nothing inside the grace");
  assert.equal(decide({ ...base, nowMs: anchorMs + 300_001, refused: true }), "settled", "and past it is settled, never missed");
  assert.equal(decide({ ...base, pending: true }), "settled", "queued or running: in hand");
  assert.equal(decide({ ...base, nowMs: anchorMs + 300_001, pending: true }), "settled", "queued in time, it runs late rather than missed");
  const armedAfter = { ...base, armedFromMs: anchorMs + 60_000 };
  assert.equal(decide({ ...armedAfter, nowMs: anchorMs - 1 }), "wait");
  assert.equal(decide({ ...armedAfter, nowMs: anchorMs + 60_000 }), "settled", "an anchor before arming is neither fired");
  assert.equal(decide({ ...armedAfter, nowMs: anchorMs + 300_001 }), "settled", "nor missed");
  assert.equal(decide({ ...base, armedFromMs: anchorMs }), "due", "armed at the anchor itself fires");
});

/* ---------- firing on time ---------- */

test("an order fires once inside its grace and never again that day, across a reload and a restart", async () => {
  const fx = await fixture();
  const text = await arm(fx.home, [ENTRY]);
  const r = rig(fx, "2026-11-27T17:29:00Z");
  await at(r, "2026-11-27T17:29:50Z");
  assert.equal(r.runs.length, 0, "ten seconds before its anchor: nothing");
  await at(r, "2026-11-27T17:30:10Z");
  assert.deepEqual(r.runs.map((call) => [call.key, iso(call.at)]), [["preclose:2026-11-27", "2026-11-27T17:30:10.000Z"]]);
  assert.equal(r.runs[0].item.anchorMs, Date.parse("2026-11-27T17:30:00Z"));
  assert.equal(r.runs[0].verified.standingText, STANDING, "the run gets the text the check verified");
  assert.deepEqual(await ofKind(fx.home, "started"), [{
    t: "2026-11-27T17:30:10.000Z", kind: "started", key: "preclose:2026-11-27", order: "preclose", date: "2026-11-27", dir: "desk", cwd: "desk/journal",
    at: "close-30m", anchor: "2026-11-27T17:30:00.000Z", standingSha: ENTRY.sha256, producer: "builtin:brief", wake: true, deadlineMs: 600_000,
  }]);
  await at(r, "2026-11-27T17:31:00Z");
  r.clock.set("2026-11-27T17:31:20Z");
  await writeStanding(fx.home, text);
  await at(r, "2026-11-27T17:31:30Z");
  assert.equal(r.runs.length, 1, "neither a later tick nor a reload of the same file fires it again");
  await r.schedule.dispose();

  const again = rig(fx, "2026-11-27T17:32:00Z");
  await again.clock.advance(0);
  await at(again, "2026-11-27T17:32:30Z");
  assert.equal(again.runs.length, 0, "a restart inside the grace runs nothing");
  assert.deepEqual((await firings(fx.home)).map((record) => record.kind), ["started", "finished"], "and writes nothing: no second started, no interrupted");
  assert.deepEqual([...r.out.texts, ...again.out.texts], [], "the run sends its own text; the clock row adds no line");
  await again.schedule.dispose();
});

test("the 2026-11-27 early close fires close-30m at 17:30Z, and a 15:30 order at 20:30Z", async () => {   // Review Focus 8
  const fx = await fixture();
  await arm(fx.home, [ENTRY, { ...ENTRY, id: "afternoon", at: "15:30" }]);
  const r = rig(fx, "2026-11-27T17:00:00Z");
  await at(r, "2026-11-27T17:29:50Z");
  assert.equal(r.runs.length, 0);
  await at(r, "2026-11-27T17:30:10Z");
  assert.deepEqual(r.runs.map((call) => [call.key, iso(call.item.anchorMs)]), [["preclose:2026-11-27", "2026-11-27T17:30:00.000Z"]], "close-30m on a 13:00 close is 12:30 ET");
  await at(r, "2026-11-27T20:29:50Z");
  assert.equal(r.runs.length, 1, "15:30 is not moved by the early close");
  await at(r, "2026-11-27T20:30:10Z");
  assert.deepEqual(r.runs.map((call) => [call.key, iso(call.item.anchorMs)]), [
    ["preclose:2026-11-27", "2026-11-27T17:30:00.000Z"],
    ["afternoon:2026-11-27", "2026-11-27T20:30:00.000Z"],
  ]);
  await r.schedule.dispose();
});

test("a sleep across the anchor: inside the grace it fires, past it it is missed with the gap", async () => {   // Review Focus 7
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const r = rig(fx, "2026-11-27T17:00:00Z");
  await at(r, "2026-11-27T17:25:00Z");
  r.clock.jump(8 * 60_000);
  await r.schedule.tick();
  await idle(r.schedule);
  assert.deepEqual(r.runs.map((call) => [call.key, iso(call.at)]), [["preclose:2026-11-27", "2026-11-27T17:33:00.000Z"]], "woken inside the grace, it fires");

  await at(r, "2026-11-30T20:25:00Z");
  r.clock.jump(11 * 60_000);
  await r.schedule.tick();
  await idle(r.schedule);
  assert.equal(r.runs.length, 1, "woken past the grace, it never runs late");
  assert.deepEqual(await ofKind(fx.home, "missed"), [{
    t: "2026-11-30T20:36:00.000Z", kind: "missed", key: "preclose:2026-11-30", order: "preclose", date: "2026-11-30", anchor: "2026-11-30T20:30:00.000Z",
    why: "asleep", asleep: { from: "2026-11-30T20:25:00.000Z", to: "2026-11-30T20:36:00.000Z" }, foundAt: "2026-11-30T20:36:00.000Z",
  }]);
  assert.deepEqual(r.out.texts, [
    "preclose · 2026-11-30 missed its 15:30 ET anchor: the face was asleep from 15:25 ET to 15:36 ET. A standing order never runs late",
  ]);
  await at(r, "2026-11-30T20:36:30Z");
  assert.equal(r.out.texts.length, 1, "missed once");
  await r.schedule.dispose();
});

test("missed as down, missed as late, and an order armed after its anchor", async () => {
  const down = await fixture();
  await arm(down.home, [ENTRY]);
  const booted = rig(down, "2026-11-27T17:40:00Z");
  await at(booted, "2026-11-27T17:40:00Z");
  assert.deepEqual((await ofKind(down.home, "missed")).map((r) => [r.why, r.asleep]), [["down", undefined]]);
  assert.deepEqual(booted.out.texts, ["preclose · 2026-11-27 missed its 12:30 ET anchor: the face was not running. A standing order never runs late"]);
  assert.equal(booted.runs.length, 0);
  await booted.schedule.dispose();

  const late = await fixture();
  const found = rig(late, "2026-11-27T17:00:00Z");
  await at(found, "2026-11-27T17:35:30Z");
  found.clock.set("2026-11-27T17:36:00Z");
  await arm(late.home, [ENTRY]);
  await at(found, "2026-11-27T17:36:00Z");
  await at(found, "2026-11-27T17:36:30Z");
  assert.deepEqual((await ofKind(late.home, "missed")).map((r) => [r.why, r.foundAt]), [["late", "2026-11-27T17:36:00.000Z"]]);
  assert.deepEqual(found.out.texts, ["preclose · 2026-11-27 missed its 12:30 ET anchor: found at 12:36 ET, past the 5-minute grace. A standing order never runs late"]);
  await found.schedule.dispose();

  /* a gap in the ticks that opens after the anchor does not cover it: found late, not asleep */
  const gap = await fixture();
  const stalled = rig(gap, "2026-11-27T17:00:00Z");
  await at(stalled, "2026-11-27T17:31:00Z");
  stalled.clock.set("2026-11-27T17:39:00Z");
  await arm(gap.home, [ENTRY]);
  stalled.clock.set("2026-11-27T17:40:00Z");
  await stalled.schedule.tick();
  await idle(stalled.schedule);
  assert.deepEqual((await ofKind(gap.home, "missed")).map((r) => [r.why, r.asleep]), [["late", undefined]]);
  await stalled.schedule.dispose();

  const fresh = await fixture();
  const armedAfter = rig(fresh, "2026-11-27T17:00:00Z");
  await at(armedAfter, "2026-11-27T17:29:50Z");
  armedAfter.clock.set("2026-11-27T17:31:00Z");
  await arm(fresh.home, [{ ...ENTRY, armedAt: "2026-11-27T17:31:00.000Z" }]);
  for (const t of ["2026-11-27T17:31:10Z", "2026-11-27T17:34:00Z", "2026-11-27T17:40:00Z"]) await at(armedAfter, t);
  assert.equal(armedAfter.runs.length, 0, "an anchor before arming never fires");
  assert.deepEqual(await firings(fresh.home), [], "and is never missed");
  assert.deepEqual(armedAfter.out.texts, []);
  await at(armedAfter, "2026-11-30T20:30:10Z");
  assert.deepEqual(armedAfter.runs.map((call) => call.key), ["preclose:2026-11-30"], "the next session fires it");
  await armedAfter.schedule.dispose();
});

/* ---------- the ledger's own records ---------- */

test("a started firing with no end is interrupted once its deadline and slack have passed, once, and never re-run", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const startedAt = "2026-11-27T17:30:10.000Z";
  const started = {
    kind: "started", order: "preclose", dir: "desk", cwd: "desk/journal", at: "close-30m", standingSha: ENTRY.sha256, producer: "builtin:brief", wake: true, deadlineMs: 600_000,
  };
  /* the 25th's ended; the 27th's was cut off */
  await appendRecord(fx.home, FIRINGS_FILE, { ...started, t: "2026-11-25T20:30:10.000Z", key: "preclose:2026-11-25", date: "2026-11-25", anchor: "2026-11-25T20:30:00.000Z" });
  await appendRecord(fx.home, FIRINGS_FILE, { t: "2026-11-25T20:34:10.000Z", kind: "finished", key: "preclose:2026-11-25", order: "preclose", date: "2026-11-25", wallMs: 240_000 });
  await appendRecord(fx.home, FIRINGS_FILE, { ...started, t: startedAt, key: "preclose:2026-11-27", date: "2026-11-27", anchor: "2026-11-27T17:30:00.000Z" });

  /* booted 50 s after the started, inside its 10-minute deadline and the minute's slack: perhaps a live firing on
   * another face on this home (M2) - not judged yet, and never run here */
  const r = rig(fx, "2026-11-27T17:31:00Z");
  await r.clock.advance(0);
  await r.schedule.tick();
  await idle(r.schedule);
  assert.deepEqual(r.out.texts, [], "too young to call cut off");
  await at(r, "2026-11-27T17:31:30Z");
  assert.equal(r.runs.length, 0, "inside its grace, and never run again");
  await at(r, "2026-11-27T17:41:09Z");
  assert.deepEqual(r.out.texts, [], "a second before its deadline and slack have passed");
  await at(r, "2026-11-27T17:41:10Z");
  assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 was cut off by a restart; a standing order never runs twice"]);
  assert.deepEqual(await ofKind(fx.home, "interrupted"), [{
    t: "2026-11-27T17:41:10.000Z", kind: "interrupted", key: "preclose:2026-11-27", order: "preclose", date: "2026-11-27", startedAt,
  }]);
  assert.equal(r.runs.length, 0);
  assert.equal(r.schedule.status().orders[0].last?.outcome, "interrupted");
  await r.schedule.dispose();

  const again = rig(fx, "2026-11-27T17:42:00Z");
  await again.clock.advance(0);
  await at(again, "2026-11-27T17:42:00Z");
  assert.deepEqual(again.out.texts, [], "reported once, across restarts");
  assert.equal((await ofKind(fx.home, "interrupted")).length, 1);
  await again.schedule.dispose();
});

/* ---------- refusals ---------- */

test("refusals do not consume the key: OFF is silent and a resume inside the grace fires; an identical refusal is recorded once", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const r = rig(fx, "2026-11-27T17:30:00Z");
  await writeOff(fx.home, { by: "terminal" }, () => r.clock.now());
  await at(r, "2026-11-27T17:30:10Z");
  await at(r, "2026-11-27T17:30:40Z");
  assert.deepEqual(await ofKind(fx.home, "refused"), [{
    t: "2026-11-27T17:30:10.000Z", kind: "refused", key: "preclose:2026-11-27", order: "preclose", date: "2026-11-27", reason: "off", reported: false,
  }]);
  assert.deepEqual(r.out.texts, [], "OFF sends nothing");
  assert.equal(r.runs.length, 0);
  assert.equal(r.schedule.status().orders[0].last?.outcome, "refused (off)");
  await clearOff(fx.home, "terminal", () => r.clock.now());
  await at(r, "2026-11-27T17:31:10Z");
  assert.deepEqual(r.runs.map((call) => call.key), ["preclose:2026-11-27"], "a resume inside the grace fires");
  await at(r, "2026-11-27T17:40:00Z");
  assert.deepEqual(await ofKind(fx.home, "missed"), [], "never a missed record");
  await r.schedule.dispose();
});

test("a changed STANDING.md is refused once per change, and a rearm inside the grace fires", async () => {   // Review Focus 9
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const r = rig(fx, "2026-11-27T17:00:00Z");
  await at(r, "2026-11-27T17:00:00Z");
  assert.equal(r.schedule.status().orders[0].hash, "unknown", "not yet checked: it claims nothing");
  const textPath = join(fx.root, "desk", "STANDING.md");
  const edited = `${STANDING}Also, buy the dip.\n`;
  await writeFile(textPath, edited);
  await at(r, "2026-11-27T17:30:10Z");
  assert.deepEqual((await ofKind(fx.home, "refused")).map((x) => [x.key, x.reason, x.detail, x.reported]), [["preclose:2026-11-27", "hash", sha256Hex(edited), true]]);
  assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 refused: desk/STANDING.md changed since arming. Review it, then: npm run desk -- rearm preclose"]);
  assert.equal(r.schedule.status().orders[0].hash, "changed");
  await at(r, "2026-11-27T17:31:00Z");
  assert.equal((await ofKind(fx.home, "refused")).length, 1, "the same refusal again records nothing");
  assert.equal(r.out.texts.length, 1);

  r.clock.set("2026-11-27T17:33:00Z");
  const rearmed = rehashOrder(await readFile(join(deskDir(fx.home), STANDING_FILE), "utf8"), "preclose", { sha256: sha256Hex(edited) });
  assert.ok("text" in rearmed);
  await writeStanding(fx.home, rearmed.text);
  await at(r, "2026-11-27T17:33:30Z");
  assert.deepEqual(r.runs.map((call) => [call.key, iso(call.at)]), [["preclose:2026-11-27", "2026-11-27T17:33:30.000Z"]], "re-armed inside the grace, it fires that day");
  assert.equal(r.schedule.status().orders[0].hash, "ok");

  /* another change on the 30th is phoned; the same change still unarmed on December 1 is recorded, not phoned */
  const again = `${edited}And sell the rip.\n`;
  await writeFile(textPath, again);
  await at(r, "2026-11-30T20:30:10Z");
  await at(r, "2026-12-01T20:30:10Z");
  await at(r, "2026-12-01T20:40:00Z");
  assert.deepEqual((await ofKind(fx.home, "refused")).map((x) => [x.key, x.detail, x.reported]), [
    ["preclose:2026-11-27", sha256Hex(edited), true],
    ["preclose:2026-11-30", sha256Hex(again), true],
    ["preclose:2026-12-01", sha256Hex(again), false],
  ]);
  assert.deepEqual(r.out.texts.slice(1), ["preclose · 2026-11-30 refused: desk/STANDING.md changed since arming. Review it, then: npm run desk -- rearm preclose"]);
  assert.deepEqual(await ofKind(fx.home, "missed"), [], "a key whose grace passes refused is never missed");
  assert.equal(r.runs.length, 1);

  /* a rearm the status has not seen checked claims nothing */
  const repinned = rehashOrder(await readFile(join(deskDir(fx.home), STANDING_FILE), "utf8"), "preclose", { sha256: sha256Hex(again) });
  assert.ok("text" in repinned);
  await writeStanding(fx.home, repinned.text);
  await at(r, "2026-12-01T20:41:00Z");
  assert.equal(r.schedule.status().orders[0].hash, "unknown");
  await r.schedule.dispose();
});

test("the other refusals: a missing text, a changed script and the fence, each phoned as its line says", async () => {
  const fx = await fixture();
  const script = "print('producer')\n";
  await mkdir(join(fx.root, "scripts"), { recursive: true });
  await writeFile(join(fx.root, "scripts", "p.py"), script);
  await arm(fx.home, [{ ...ENTRY, producer: "scripts/p.py", producerSha256: sha256Hex(script) }]);
  const r = rig(fx, "2026-11-27T17:00:00Z");
  const textPath = join(fx.root, "desk", "STANDING.md");

  await rm(textPath);
  await at(r, "2026-11-27T17:30:10Z");
  assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 refused: desk/STANDING.md is missing. Restore it, or remove the order from standing.yml"]);
  assert.deepEqual([r.schedule.status().orders[0].hash, r.schedule.status().orders[0].producerHash], ["missing", "unknown"]);

  await writeFile(textPath, STANDING);
  await writeFile(join(fx.root, "scripts", "p.py"), `${script}print('more')\n`);
  await at(r, "2026-11-30T20:30:10Z");
  assert.deepEqual(r.out.texts.slice(1), ["preclose · 2026-11-30 refused: scripts/p.py changed since arming. Review it, then: npm run desk -- rearm preclose"]);
  assert.deepEqual([r.schedule.status().orders[0].hash, r.schedule.status().orders[0].producerHash], ["ok", "changed"]);

  await writeFile(join(fx.root, "scripts", "p.py"), script);
  await writeFile(join(fx.root, "desk", "GRAVIT.md"), "# steer every desk turn\n");
  await at(r, "2026-12-01T20:30:10Z");
  await at(r, "2026-12-01T20:30:40Z");
  assert.deepEqual(r.out.texts.slice(2), ["preclose · 2026-12-01 refused: desk/GRAVIT.md exists; it would steer every desk turn. Remove it."]);
  assert.deepEqual((await ofKind(fx.home, "refused")).map((x) => [x.key, x.reason, x.detail, x.reported]), [
    ["preclose:2026-11-27", "hash", "missing", true],
    ["preclose:2026-11-30", "producer-hash", sha256Hex(`${script}print('more')\n`), true],
    ["preclose:2026-12-01", "fence", "desk/GRAVIT.md", true],
  ], "the same fence again records nothing");
  await rm(join(fx.root, "desk", "GRAVIT.md"));
  await at(r, "2026-12-01T20:31:10Z");
  assert.deepEqual(r.runs.map((call) => call.key), ["preclose:2026-12-01"]);
  assert.deepEqual([r.schedule.status().orders[0].hash, r.schedule.status().orders[0].producerHash], ["ok", "ok"]);
  assert.deepEqual((await ofKind(fx.home, "started")).map((x) => [x.producer, x.producerSha]), [["scripts/p.py", sha256Hex(script)]]);
  await r.schedule.dispose();
});

test("a spent budget refuses every order with one line a day", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY, { ...ENTRY, id: "second" }], 1_000);
  await appendEvent(fx.home, {
    t: "2026-11-27T15:00:00.000Z", kind: "desk-turn", sessionId: "s", source: "telegram", turn: 1, outcome: "ended", wallMs: 1,
    usage: { uncachedInputTokens: 600, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0, routes: [] },
  });
  const r = rig(fx, "2026-11-27T17:00:00Z");
  await at(r, "2026-11-27T17:30:10Z");
  await at(r, "2026-11-27T17:30:40Z");
  assert.equal(r.schedule.dailyTokens(), 1_000);
  assert.deepEqual((await eventsOf(fx.home, "budget-spent")).map((e) => [e.date, e.used, e.dailyTokens]), [["2026-11-27", 1_000, 1_000]]);
  assert.deepEqual(r.out.texts, ["standing orders are refused for the rest of the day: the desk's token budget is spent (1,000 of 1,000 tokens since 00:00 ET)"]);
  assert.deepEqual((await ofKind(fx.home, "refused")).map((x) => [x.key, x.reason, x.reported]), [
    ["preclose:2026-11-27", "budget", true],
    ["second:2026-11-27", "budget", false],
  ], "each order refused once; the second silently");
  assert.equal(r.runs.length, 0);
  await r.schedule.dispose();
});

/* ---------- one at a time, one face per firing ---------- */

test("two orders due on one tick run one after the other, the second past its grace", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY, { ...ENTRY, id: "second" }]);
  const r = rig(fx, "2026-11-27T17:30:00Z", {
    hold: async (call, deps) => {
      if (call.key === "preclose:2026-11-27") await new Promise<void>((done) => { deps.clock.setTimeout(done, 600_000); });
    },
  });
  r.clock.set("2026-11-27T17:30:10Z");
  await r.schedule.tick();
  await waitFor("the first run", () => r.runs.length === 1);
  const busy = r.schedule.status();
  assert.equal(busy.running?.key, "preclose:2026-11-27");
  assert.deepEqual(busy.queued, ["second:2026-11-27"]);
  r.clock.set("2026-11-27T17:36:00Z");
  await r.schedule.tick();
  assert.deepEqual(await ofKind(fx.home, "missed"), [], "queued in time, the second is not missed while it waits");
  await r.clock.advance(250_000);
  await waitFor("the second run", () => r.runs.length === 2);
  await idle(r.schedule);
  assert.deepEqual(r.runs.map((call) => [call.key, iso(call.at)]), [
    ["preclose:2026-11-27", "2026-11-27T17:30:10.000Z"],
    ["second:2026-11-27", "2026-11-27T17:40:10.000Z"],
  ]);
  assert.deepEqual(await ofKind(fx.home, "missed"), []);
  await r.schedule.dispose();
});

test("a queued firing is dropped with a line when its order is disabled or gone, or standing.yml is refused, before its turn", async () => {
  const cases: [string, (text: string) => string, string][] = [
    ["disabled", (text) => text.replace(/(- id: "second"[\s\S]*?)enabled: true/, "$1enabled: false"), "it is disabled"],
    ["gone", (text) => text.slice(0, text.indexOf('  - id: "second"')), "it is no longer in standing.yml"],
    ["refused", (text) => text.replace("\n  - id:", "\n\t- id:"), "standing.yml is refused"],
  ];
  for (const [label, edit, why] of cases) {
    const fx = await fixture();
    const text = await arm(fx.home, [ENTRY, { ...ENTRY, id: "second" }]);
    let release: () => void = () => {};
    const held = new Promise<void>((done) => { release = done; });
    const r = rig(fx, "2026-11-27T17:30:00Z", { hold: async (call) => { if (call.key === "preclose:2026-11-27") await held; } });
    r.clock.set("2026-11-27T17:30:10Z");
    await r.schedule.tick();
    await waitFor(`the first run (${label})`, () => r.runs.length === 1);
    assert.deepEqual(r.schedule.status().queued, ["second:2026-11-27"]);
    r.clock.set("2026-11-27T17:31:00Z");
    await writeStanding(fx.home, edit(text));
    await r.schedule.tick();
    release();
    await idle(r.schedule);
    assert.deepEqual(r.runs.map((call) => call.key), ["preclose:2026-11-27"], `the second never runs (${label})`);
    assert.deepEqual(r.lines.filter((line) => line.includes("is dropped")), [`gravit-face: desk: standing order second:2026-11-27 is dropped: ${why}`]);
    await r.schedule.dispose();
  }
});

test("two schedules on one home start a firing once", async () => {   // Review Focus 4
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const a = rig(fx, "2026-11-27T17:30:10Z");
  const b = rig(fx, "2026-11-27T17:30:10Z");
  await Promise.all([a.schedule.tick(), b.schedule.tick()]);
  await Promise.all([idle(a.schedule), idle(b.schedule)]);
  assert.equal(a.runs.length + b.runs.length, 1, "one face runs it");
  assert.equal((await ofKind(fx.home, "started")).length, 1);
  assert.deepEqual([...a.lines, ...b.lines].filter((line) => line.includes("another face")),
    ["gravit-face: desk: another face on this home started preclose:2026-11-27; this one does not run it"]);
  await Promise.all([at(a, "2026-11-27T17:30:40Z"), at(b, "2026-11-27T17:30:40Z")]);
  assert.equal(a.runs.length + b.runs.length, 1, "and neither tries again");
  await Promise.all([a.schedule.dispose(), b.schedule.dispose()]);
});

/* ---------- what stops every order ---------- */

test("a broken standing.yml stops every order, reports once, keeps the cap, and a fix inside the grace fires", async () => {   // Review Focus 6
  const fx = await fixture();
  const good = await arm(fx.home, [ENTRY], 2_000_000);
  const r = rig(fx, "2026-11-27T17:10:00Z");
  await at(r, "2026-11-27T17:10:00Z");
  assert.equal(r.schedule.status().file.state, "loaded");
  r.clock.set("2026-11-27T17:20:00Z");
  const broken = good.replace("\n  - id:", "\n\t- id:");
  const load = parseStanding(broken);
  assert.ok(!load.ok);
  await writeStanding(fx.home, broken);
  await at(r, "2026-11-27T17:20:00Z");
  assert.deepEqual((await eventsOf(fx.home, "standing-error")).map((e) => e.errors), [load.errors]);
  assert.deepEqual(r.out.texts, [LINES.standingRefused(load.errors)]);
  assert.match(r.out.texts[0], /^standing\.yml is refused, so no standing order runs until it is fixed: standing\.yml is not YAML: tab characters/);
  const stopped = r.schedule.status();
  assert.deepEqual([stopped.file.state, stopped.file.errors], ["refused", load.errors]);
  assert.deepEqual(stopped.orders.map((order) => order.id), ["preclose"], "the last good orders stay in the status");
  assert.equal(r.schedule.dailyTokens(), 2_000_000, "and the last good cap stays the day's");

  r.clock.set("2026-11-27T17:25:00Z");
  await writeStanding(fx.home, broken);
  await at(r, "2026-11-27T17:25:00Z");
  assert.equal(r.out.texts.length, 1, "the same break again says nothing");
  assert.equal((await eventsOf(fx.home, "standing-error")).length, 1);
  await at(r, "2026-11-27T17:30:10Z");
  assert.equal(r.runs.length, 0, "no order runs while the file is refused");
  assert.deepEqual(r.lines.filter((line) => line.includes("is dropped")), [], "none is even queued");

  r.clock.set("2026-11-27T17:32:00Z");
  await writeStanding(fx.home, good);
  await at(r, "2026-11-27T17:32:30Z");
  assert.deepEqual(r.runs.map((call) => call.key), ["preclose:2026-11-27"], "fixed inside the grace, it fires");
  assert.equal(r.schedule.status().file.state, "loaded");
  await r.schedule.dispose();
});

test("an unarmed order stops every order with its line", async () => {   // Review Focus 3
  const fx = await fixture();
  const handWritten = `orders:\n${renderOrder(ENTRY, 2).replace(/^ +armedAt: .*\n/m, "")}${renderOrder({ ...ENTRY, id: "second" }, 2)}`;
  await writeStanding(fx.home, handWritten);
  const r = rig(fx, "2026-11-27T17:00:00Z");
  await at(r, "2026-11-27T17:30:10Z");
  assert.deepEqual(r.out.texts, [
    "standing.yml is refused, so no standing order runs until it is fixed: orders[0] (preclose): not armed: npm run desk -- arm desk …",
  ]);
  assert.deepEqual((await eventsOf(fx.home, "standing-error")).map((e) => e.errors), [["orders[0] (preclose): not armed: npm run desk -- arm desk …"]]);
  assert.equal(r.runs.length, 0, "the armed order beside it does not run either");
  assert.deepEqual(r.schedule.status().orders, [], "no good load, no orders");
  await r.schedule.dispose();
});

test("a standing.yml the face cannot read is refused like a broken one, one line per failure, and read again once it can", { skip: process.getuid?.() === 0 ? "root reads through a 0o000 directory" : false }, async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const r = rig(fx, "2026-11-27T17:00:00Z");
  await at(r, "2026-11-27T17:00:00Z");
  assert.equal(r.schedule.status().file.state, "loaded");
  await chmod(deskDir(fx.home), 0o000);
  try {
    await at(r, "2026-11-27T17:05:00Z");
    await at(r, "2026-11-27T17:05:30Z");
  } finally {
    await chmod(deskDir(fx.home), 0o700);
  }
  const failures = r.lines.filter((line) => line.startsWith("gravit-face: desk: schedule "));
  assert.equal(failures.length, 1, `one face line for the failure, however often it recurs: ${failures.join(" | ")}`);
  assert.ok(failures[0].startsWith("gravit-face: desk: schedule reload: EACCES"), failures[0]);
  assert.deepEqual(r.out.texts, ["standing.yml is refused, so no standing order runs until it is fixed: standing.yml cannot be read (EACCES)"]);
  assert.equal(r.schedule.status().file.state, "refused");
  await at(r, "2026-11-27T17:10:00Z");
  assert.equal(r.schedule.status().file.state, "loaded", "readable again, unchanged, it is read again");
  await at(r, "2026-11-27T17:30:10Z");
  assert.deepEqual(r.runs.map((call) => call.key), ["preclose:2026-11-27"]);
  await r.schedule.dispose();
});

test("a tick that throws is one face line per distinct failure, and the next tick is armed", async () => {
  const fx = await fixture();
  await arm(fx.home, [{ ...ENTRY, id: "afternoon", at: "15:30" }]);
  /* a calendar answering a session whose open is no time: a wall-clock anchor cannot be placed on it */
  const broken: MarketCalendar = {
    python: "python3",
    today: async () => ({
      ok: true, date: "2026-11-27", source: "a broken calendar",
      session: { date: "2026-11-27", open: "at the bell", close: "2026-11-27T18:00:00Z", early: true },
    }),
    peek: () => undefined,
    window: () => undefined,
  };
  const r = rig(fx, "2026-11-27T17:00:00Z", { calendar: broken });
  await r.clock.advance(0);
  await r.schedule.tick();
  await r.schedule.tick();
  const failures = r.lines.filter((line) => line.startsWith("gravit-face: desk: schedule "));
  assert.deepEqual(failures, ["gravit-face: desk: schedule boot: Invalid time value", "gravit-face: desk: schedule tick: Invalid time value"]);
  assert.equal(r.clock.pending(), 1, "the boot's failure still armed the next tick");
  assert.deepEqual([r.runs, r.out.texts], [[], []]);
  await r.schedule.dispose();
});

test("an unreadable firings.jsonl stops every firing with one line per reason and never throws", async () => {   // Review Focus 2
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    const fx = await fixture();
    await arm(fx.home, [ENTRY]);
    await mkdir(ledgerPath(fx.home));
    const r = rig(fx, "2026-11-27T17:30:00Z");
    await at(r, "2026-11-27T17:30:10Z");
    assert.deepEqual(r.schedule.status().ledger, { error: "EISDIR" });
    assert.deepEqual(r.out.texts, [`the firing ledger ${ledgerPath(fx.home)} cannot be read (EISDIR), so no standing order runs until it can`]);
    assert.deepEqual((await eventsOf(fx.home, "standing-error")).map((e) => e.errors), [[`${ledgerPath(fx.home)} cannot be read (EISDIR)`]]);
    assert.equal(r.runs.length, 0);
    await at(r, "2026-11-27T17:30:40Z");
    assert.equal(r.out.texts.length, 1, "the same reason again says nothing");
    assert.deepEqual(r.lines.filter((line) => line.includes("could not be written")), [], "no firing was even tried: nothing reached for the ledger's lock");

    await rm(ledgerPath(fx.home), { recursive: true });
    await writeFile(ledgerPath(fx.home), '{"t":"2026-11-27T17:00:00.000Z","kind":"sta');
    await at(r, "2026-11-27T17:31:10Z");
    assert.deepEqual(r.runs.map((call) => call.key), ["preclose:2026-11-27"], "read again, a torn line skipped, it fires inside the grace");
    assert.equal(r.schedule.status().ledger, undefined);
    await r.schedule.dispose();
    await new Promise((done) => setTimeout(done, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("no covering calendar: one calendar-error and one line a day, nothing that day, asked again the next date", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const asks: string[] = [];
  const clockState: { failure?: string } = { failure: "pandas_market_calendars is not importable in /x" };
  const calendar = createMarketCalendar({
    python: "python3",
    ask: async (from) => {
      asks.push(from);
      if (clockState.failure !== undefined) throw new Error(clockState.failure);
      return windowFrom(from);
    },
  });
  const r = rig(fx, "2026-11-27T15:00:00Z", { calendar });
  await at(r, "2026-11-27T15:00:00Z");
  assert.deepEqual(r.out.texts, [
    "no standing order runs today: the market calendar failed in python3 (pandas_market_calendars is not importable in /x). FACE_PYTHON must name an interpreter with pandas_market_calendars",
  ]);
  assert.deepEqual((await eventsOf(fx.home, "calendar-error")).map((e) => [e.date, e.python, e.error]),
    [["2026-11-27", "python3", "pandas_market_calendars is not importable in /x"]]);
  assert.deepEqual(r.schedule.status().calendar, { python: "python3", state: "failed", error: "pandas_market_calendars is not importable in /x" });
  await at(r, "2026-11-27T15:05:00Z");
  assert.deepEqual(asks, ["2026-11-27"], "not asked again inside ten minutes");
  await at(r, "2026-11-27T15:10:00Z");
  assert.deepEqual(asks, ["2026-11-27", "2026-11-27"], "asked again after ten");
  await at(r, "2026-11-27T17:30:10Z");
  assert.equal(r.runs.length, 0, "no calendar, nothing that day");
  assert.equal(r.out.texts.length, 1, "one line a day, however often it is asked");
  assert.equal((await eventsOf(fx.home, "calendar-error")).length, 1);

  /* the next date asks again; an error that is not a missing pandas_market_calendars names no FACE_PYTHON */
  clockState.failure = "timed out after 30 s";
  await at(r, "2026-11-30T15:00:00Z");
  assert.equal(asks.at(-1), "2026-11-30");
  assert.deepEqual(r.out.texts.slice(1), ["no standing order runs today: the market calendar failed in python3 (timed out after 30 s)"]);
  /* a transient failure costs nothing once the clock answers inside the day */
  clockState.failure = undefined;
  await at(r, "2026-11-30T15:10:00Z");
  assert.deepEqual(r.schedule.status().calendar, {
    python: "python3", state: "ok", source: "a stand-in clock", today: { date: "2026-11-30", open: "2026-11-30T14:30:00Z", close: "2026-11-30T21:00:00Z", early: false },
  });
  await at(r, "2026-11-30T20:30:10Z");
  assert.deepEqual(r.runs.map((call) => call.key), ["preclose:2026-11-30"]);

  assert.deepEqual((await eventsOf(fx.home, "calendar-error")).map((e) => [e.date, e.error]),
    [["2026-11-27", "pandas_market_calendars is not importable in /x"], ["2026-11-30", "timed out after 30 s"]]);
  await r.schedule.dispose();

  /* the real calendar turns an ask that throws into a failed day: the event and the line */
  const throwing = await fixture();
  await arm(throwing.home, [ENTRY]);
  const t = rig(throwing, "2026-11-27T15:00:00Z", { calendar: createMarketCalendar({ python: "python3", ask: () => { throw new Error("spawn refused"); } }) });
  await at(t, "2026-11-27T15:00:00Z");
  assert.deepEqual(t.out.texts, ["no standing order runs today: the market calendar failed in python3 (spawn refused)"]);
  assert.deepEqual((await eventsOf(throwing.home, "calendar-error")).map((e) => [e.date, e.python, e.error]), [["2026-11-27", "python3", "spawn refused"]]);
  await t.schedule.dispose();

  /* a calendar whose today() itself rejects: one face line per distinct failure, never a throw, the next tick armed */
  const standIn = await fixture();
  await arm(standIn.home, [ENTRY]);
  const rejecting: MarketCalendar = {
    python: "python3",
    today: async () => { throw new Error("the stand-in's today failed"); },
    peek: () => undefined,
    window: () => undefined,
  };
  const s = rig(standIn, "2026-11-27T17:30:00Z", { calendar: rejecting });
  await s.clock.advance(0);
  await s.schedule.tick();
  await at(s, "2026-11-27T17:30:30Z");
  assert.deepEqual(s.lines.filter((line) => line.includes("schedule calendar")), ["gravit-face: desk: schedule calendar: the stand-in's today failed"]);
  assert.equal(s.clock.pending(), 1, "the next tick is armed");
  assert.deepEqual(s.out.texts, []);
  assert.equal(s.runs.length, 0);
  await s.schedule.dispose();
});

test("a closed day is silent and the next session fires", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const r = rig(fx, "2026-11-26T17:00:00Z");
  for (const t of ["2026-11-26T17:29:50Z", "2026-11-26T17:30:10Z", "2026-11-26T17:40:00Z"]) await at(r, t);
  assert.deepEqual([r.runs.length, r.out.texts, await firings(fx.home)], [0, [], []], "Thanksgiving: no queue, no missed, no line");
  await at(r, "2026-11-27T17:30:10Z");
  assert.deepEqual(r.runs.map((call) => call.key), ["preclose:2026-11-27"]);
  for (const t of ["2026-11-28T17:30:10Z", "2026-11-28T17:40:00Z"]) await at(r, t);
  assert.equal(r.runs.length, 1, "a Saturday is closed too");
  assert.deepEqual(await ofKind(fx.home, "missed"), []);
  assert.deepEqual([r.out.texts, r.lines], [[], []], "and nothing at all is said of a closed day");
  await r.schedule.dispose();
});

test("an expired order is reported once and never fires; a disabled one is silent", async () => {
  const fx = await fixture();
  const quiet = renderOrder({ ...ENTRY, id: "quiet", expires: "2026-11-20" }, 2).replace("enabled: true", "enabled: false");
  await writeStanding(fx.home, `orders:\n${renderOrder({ ...ENTRY, expires: "2026-11-26" }, 2)}${quiet}`);
  const line = "preclose expired after 2026-11-26 and no longer fires; extend it with npm run desk -- rearm preclose --expires <YYYY-MM-DD> to keep it";
  const r = rig(fx, "2026-11-27T17:00:00Z");
  await at(r, "2026-11-27T17:00:00Z");
  await at(r, "2026-11-27T17:30:10Z");
  assert.deepEqual(r.out.texts, [line]);
  assert.deepEqual(await ofKind(fx.home, "expired"), [{
    t: "2026-11-27T17:00:00.000Z", kind: "expired", key: "preclose:2026-11-26", order: "preclose", date: "2026-11-26", expires: "2026-11-26",
  }]);
  assert.equal(r.runs.length, 0);
  const shown = r.schedule.status().orders;
  assert.deepEqual(shown.map((order) => [order.id, order.enabled, order.expired]), [["preclose", true, true], ["quiet", false, true]]);
  await r.schedule.dispose();

  /* across a restart, still once; then a late `rearm --expires`: today's past anchor is not reported missed */
  const again = rig(fx, "2026-11-27T17:35:00Z");
  await at(again, "2026-11-27T17:35:00Z");
  assert.deepEqual(again.out.texts, [], "reported once across reinstalls");
  again.clock.set("2026-11-27T17:40:00Z");
  const extended = rehashOrder(await readFile(join(deskDir(fx.home), STANDING_FILE), "utf8"), "preclose", { sha256: ENTRY.sha256, expires: "2026-12-31" });
  assert.ok("text" in extended);
  await writeStanding(fx.home, extended.text);
  await at(again, "2026-11-27T17:40:30Z");
  assert.deepEqual(await ofKind(fx.home, "missed"), [], "the anchor fell while it was expired: settled, not missed");
  assert.deepEqual(again.out.texts, []);
  await at(again, "2026-11-30T20:30:10Z");
  assert.deepEqual(again.runs.map((call) => call.key), ["preclose:2026-11-30"], "extended, it fires again");
  await again.schedule.dispose();

  /* extended before its anchor, it fires that day */
  const early = await fixture();
  await arm(early.home, [{ ...ENTRY, expires: "2026-11-26" }]);
  const e = rig(early, "2026-11-27T15:00:00Z");
  await at(e, "2026-11-27T15:00:00Z");
  assert.deepEqual(e.out.texts, [line]);
  e.clock.set("2026-11-27T16:00:00Z");
  await arm(early.home, [ENTRY]);
  await at(e, "2026-11-27T17:30:10Z");
  assert.deepEqual(e.runs.map((call) => call.key), ["preclose:2026-11-27"]);
  await e.schedule.dispose();

  /* a ledger the face may read but not append to: the expiry is still phoned, and once, not at every tick */
  if (process.getuid?.() !== 0) {
    const locked = await fixture();
    await arm(locked.home, [{ ...ENTRY, expires: "2026-11-26" }]);
    await writeFile(ledgerPath(locked.home), "");
    await chmod(ledgerPath(locked.home), 0o444);
    const l = rig(locked, "2026-11-27T15:00:00Z");
    await at(l, "2026-11-27T15:00:00Z");
    await at(l, "2026-11-27T15:00:30Z");
    assert.deepEqual(l.out.texts, [line]);
    assert.equal(l.lines.filter((x) => x.includes("could not be written")).length, 1, "one failed append, and no second try");
    await l.schedule.dispose();
  }
});

test("the ET date change asks the calendar again", async () => {
  const fx = await fixture();
  const calendar = fakeCalendar(DAYS);
  const r = rig(fx, "2026-11-27T04:58:00Z", { calendar });
  await at(r, "2026-11-27T04:58:00Z");
  await arm(fx.home, [{ ...ENTRY, expires: "2026-11-20" }]);
  await at(r, "2026-11-27T04:58:30Z");
  assert.deepEqual(calendar.asked, [], "no order, or only an expired one: the calendar is not asked");
  await arm(fx.home, [ENTRY]);
  await at(r, "2026-11-27T04:59:30Z");
  assert.deepEqual(calendar.asked, ["2026-11-26"], "23:59 ET is still the 26th");
  await at(r, "2026-11-27T05:00:30Z");
  assert.deepEqual(calendar.asked, ["2026-11-26", "2026-11-27"], "00:00 ET opens the 27th");
  await r.schedule.dispose();
});

/* ---------- what it reports ---------- */

test("status: hash state, next anchor, last outcome, running, queued and recent", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY, { ...ENTRY, id: "second" }], 2_000_000);
  let release: () => void = () => {};
  const held = new Promise<void>((done) => { release = done; });
  const r = rig(fx, "2026-11-25T20:00:00Z", {
    hold: async (call, deps) => {
      if (call.key !== "preclose:2026-11-25") return;
      await deps.createAgent({ cwd: call.verified.cwd, route: { provider: "stub", model: "echo" } });
      await held;
    },
  });
  const before = r.schedule.status();
  assert.deepEqual([before.orders, before.queued, before.recent, before.running], [[], [], [], undefined], "nothing read yet");
  assert.equal(before.calendar.state, "unknown");
  await at(r, "2026-11-25T20:00:00Z");
  const waiting = r.schedule.status();
  assert.deepEqual(waiting.file, { path: join(deskDir(fx.home), STANDING_FILE), state: "loaded", loadedAt: "2026-11-25T20:00:00.000Z" });
  assert.deepEqual(waiting.orders.map((order) => [order.id, order.hash, order.nextAnchor, order.last]), [
    ["preclose", "unknown", "2026-11-25T20:30:00.000Z", undefined],
    ["second", "unknown", "2026-11-25T20:30:00.000Z", undefined],
  ], "today's anchor while ahead");

  r.clock.set("2026-11-25T20:30:10Z");
  await r.schedule.tick();
  await waitFor("the first run's session", () => r.schedule.status().running?.sessionId !== undefined);
  const busy = r.schedule.status();
  assert.deepEqual(busy.running, { key: "preclose:2026-11-25", startedAt: "2026-11-25T20:30:10.000Z", sessionId: "session-fake-1" });
  assert.deepEqual(busy.queued, ["second:2026-11-25"]);
  release();
  await idle(r.schedule);

  r.clock.set("2026-11-25T21:00:00Z");
  const s = r.schedule.status();
  assert.deepEqual(s.orders[0], {
    id: "preclose", dir: "desk", file: "STANDING.md", at: "close-30m", producer: "builtin:brief", wake: true, enabled: true, expires: "2026-12-31",
    expired: false, hash: "ok", nextAnchor: "2026-11-27T17:30:00.000Z", last: s.recent[1],
  }, "after its anchor, with the 26th closed, the next is the 27th's early close");
  assert.equal(s.orders[0].last?.outcome, "delivered");
  assert.deepEqual(s.recent.map((x) => [x.key, x.kind, x.outcome, x.sessionId, x.wallMs, x.files]), [
    ["second:2026-11-25", "finished", "delivered", "session-run", 4_000, 0],
    ["preclose:2026-11-25", "finished", "delivered", "session-run", 4_000, 0],
  ], "newest first");
  assert.deepEqual([s.running, s.queued, s.ledger], [undefined, [], undefined]);
  assert.deepEqual(s.calendar, {
    python: "python3", state: "ok", source: "fake calendar", today: { date: "2026-11-25", open: "2026-11-25T14:30:00Z", close: "2026-11-25T21:00:00Z", early: false },
  });
  /* an order on its last day, armed after today's anchor: no anchor ahead today, and none past its expires */
  await arm(fx.home, [ENTRY, { ...ENTRY, id: "second" }, { ...ENTRY, id: "lastday", at: "10:00", expires: "2026-11-25", armedAt: "2026-11-25T20:59:00.000Z" }], 2_000_000);
  await at(r, "2026-11-25T21:00:00Z");
  assert.deepEqual(r.schedule.status().orders.map((order) => [order.id, order.nextAnchor]), [
    ["preclose", "2026-11-27T17:30:00.000Z"],
    ["second", "2026-11-27T17:30:00.000Z"],
    ["lastday", undefined],
  ]);
  assert.deepEqual(await ofKind(fx.home, "missed"), [], "armed after its anchor: neither fired nor missed");
  r.clock.set("2026-11-26T15:00:00Z");
  assert.equal(r.schedule.status().calendar.state, "unknown", "a day not asked yet claims no calendar");
  await r.schedule.dispose();
});

test("dispose aborts the running firing and stops the ticks", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const calendar = fakeCalendar(DAYS);
  const r = rig(fx, "2026-11-27T17:30:00Z", {
    calendar,
    hold: (call) => new Promise<void>((done) => { call.signal.addEventListener("abort", () => done(), { once: true }); }),
  });
  await r.clock.advance(0);
  await r.schedule.tick();
  await waitFor("the boot's firing", () => r.runs.length === 1);
  assert.equal(r.clock.pending(), 1, "the next tick is armed");
  await r.schedule.dispose();
  assert.equal(r.runs[0].signal.aborted, true, "the firing under way is aborted");
  assert.equal(r.schedule.status().running, undefined);
  assert.equal(r.clock.pending(), 0, "no tick is armed");
  const asked = calendar.asked.length;
  await r.clock.advance(3_600_000);
  r.clock.set("2026-11-30T20:30:10Z");
  await r.schedule.tick();
  assert.equal(calendar.asked.length, asked, "nothing ticks once disposed: the 30th is never asked");
  assert.equal(r.runs.length, 1);
  assert.deepEqual((await firings(fx.home)).map((record) => record.kind), ["started"], "a started with no end: the next boot reads it interrupted");

  /* a firing that ignores its abort is waited for two seconds, no more */
  const deaf = await fixture();
  await arm(deaf.home, [ENTRY]);
  const d = rig(deaf, "2026-11-27T17:30:00Z", { hold: () => new Promise<void>(() => {}) });
  d.clock.set("2026-11-27T17:30:10Z");
  await d.schedule.tick();
  await waitFor("the deaf firing", () => d.runs.length === 1);
  let done = false;
  const disposing = d.schedule.dispose().then(() => { done = true; });
  await d.clock.advance(1_999);
  assert.equal(done, false);
  await d.clock.advance(1);
  await disposing;
  assert.equal(done, true);
});

/* ---------- the ledger's rotation ---------- */

test("a rotation of firings.jsonl hands the day's started lines and their ends to the new file", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const startedOn = (key: string, date: string, t: string): string => JSON.stringify({
    t, kind: "started", key, order: key.split(":")[0], date, dir: "desk", cwd: "desk/journal", at: "close-30m", anchor: t, standingSha: ENTRY.sha256, wake: true, deadlineMs: 600_000,
  });
  const ended = (key: string, date: string, t: string): string => JSON.stringify({ t, kind: "finished", key, order: key.split(":")[0], date, wallMs: 1 });
  const yesterday = startedOn("preclose:2026-11-25", "2026-11-25", "2026-11-25T20:30:10.000Z");
  const today = startedOn("noon:2026-11-27", "2026-11-27", "2026-11-27T17:00:10.000Z");
  const pad = JSON.stringify({ pad: "x".repeat(50 * 1024 * 1024) });
  await writeFile(ledgerPath(fx.home), [
    yesterday, ended("preclose:2026-11-25", "2026-11-25", "2026-11-25T20:34:00.000Z"), pad,
    today, ended("noon:2026-11-27", "2026-11-27", "2026-11-27T17:04:00.000Z"), "",
  ].join("\n"));
  const r = rig(fx, "2026-11-27T17:30:00Z");
  await at(r, "2026-11-27T17:30:10Z");
  assert.deepEqual(r.runs.map((call) => call.key), ["preclose:2026-11-27"]);
  const names = await readdir(deskDir(fx.home));
  assert.ok(names.includes("firings.2026-11-27T17-30-10.000Z.jsonl"), names.join(", "));
  const lines = (await readFile(ledgerPath(fx.home), "utf8")).split("\n").filter(Boolean);
  assert.equal(lines[0], today, "today's started, as written, opens the new file");
  assert.equal(lines[1], ended("noon:2026-11-27", "2026-11-27", "2026-11-27T17:04:00.000Z"), "with its finished: the key ended (p2-m28)");
  assert.deepEqual(lines.slice(2).map((line) => [JSON.parse(line).kind, JSON.parse(line).key]), [
    ["started", "preclose:2026-11-27"],
    ["finished", "preclose:2026-11-27"],
  ], "and nothing else of the old file came with it");
  await r.schedule.dispose();

  /* a restart after the rotation reads the delivered firing as ended: no false interrupted */
  const again = rig(fx, "2026-11-27T17:50:00Z");
  await again.clock.advance(0);
  await at(again, "2026-11-27T17:50:00Z");
  assert.deepEqual(again.out.texts, [], "nothing was cut off");
  assert.deepEqual(await ofKind(fx.home, "interrupted"), []);
  await again.schedule.dispose();
});

/* ---------- the face's defaults ---------- */

test("createDeskSchedule: the market clock under the face's interpreter, its failures phoned once a day and its stderr's tail logged once", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  await mkdir(join(fx.root, "scripts"), { recursive: true });
  /* A stand-in clock: on the 27th the interpreter dies with a traceback on stderr; on the 30th it answers that it has no calendar. */
  await writeFile(join(fx.root, "scripts", "market_clock.py"), [
    "const from = process.argv[process.argv.indexOf('--from') + 1];",
    "if (from === '2026-11-27') {",
    "  process.stderr.write('Traceback (most recent call last):\\n  File \"scripts/market_clock.py\", line 3\\n' + 'x'.repeat(400) + '\\nSystemError: the calendar crashed\\n');",
    "  process.exit(1);",
    "}",
    "process.stdout.write(JSON.stringify({ ok: false, error: 'pandas_market_calendars is not importable in /x' }));",
    "process.exit(1);",
    "",
  ].join("\n"));
  const clock = new WallClock("2026-11-27T15:00:00Z");
  const out = recordingDeliver();
  const lines: string[] = [];
  const ctx: DeskSessionCtxLike = {
    agents: {
      get: () => undefined,
      create: async () => { throw new Error("no firing runs here"); },
      resume: async () => { throw new Error("no firing runs here"); },
    },
    agentPresets: { mount: async (_agentCtx, id) => ({ id }) },
    permissionPresets: { set: () => {}, current: () => "workspace-write" },
  };
  const schedule = createDeskSchedule({
    home: fx.home, root: fx.root, python: process.execPath,
    session: { ctx, root: fx.root, home: fx.home, route: { provider: "stub", model: "echo" }, installModelSelection: () => () => {} },
    sessionCtx: {},
    on: fakeBus().on,
    deliver: (text) => out.deliver(text),
    log: (line) => { lines.push(line); },
    /* the stand-in is JavaScript under the clock's name: node runs its private copy, pinned by its own hash */
    seams: { clock, tickMs: DAY_MS, runScript: defaultProducerRunner(process.execPath, []), marketClockSha256: sha256Hex(await readFile(join(fx.root, "scripts", "market_clock.py"))) },
  });
  clock.set("2026-11-27T15:00:00Z");
  await schedule.tick();
  clock.set("2026-11-27T15:10:00Z");
  await schedule.tick();
  const tails = lines.filter((line) => line.startsWith("gravit-face: desk: schedule calendar: "));
  assert.equal(tails.length, 1, `one line for the same stderr, however often it is asked: ${lines.join(" | ")}`);
  const tail = tails[0].slice(tails[0].indexOf("its stderr ends: ") + "its stderr ends: ".length);
  assert.ok(tails[0].startsWith(`gravit-face: desk: schedule calendar: scripts/market_clock.py under ${process.execPath} failed; its stderr ends: …`), tails[0]);
  assert.ok(tail.endsWith("SystemError: the calendar crashed") && !tail.includes("\n") && [...tail].length === 300, tail);
  assert.deepEqual(out.texts, [`no standing order runs today: the market calendar failed in ${process.execPath} (exit 1)`], "not a missing calendar: no FACE_PYTHON");
  assert.deepEqual(schedule.status().calendar, { python: process.execPath, state: "failed", error: "exit 1" });

  clock.set("2026-11-30T15:00:00Z");
  await schedule.tick();
  assert.deepEqual(out.texts.slice(1), [
    `no standing order runs today: the market calendar failed in ${process.execPath} (pandas_market_calendars is not importable in /x). FACE_PYTHON must name an interpreter with pandas_market_calendars`,
  ]);
  assert.equal(lines.filter((line) => line.startsWith("gravit-face: desk: schedule calendar: ")).length, 1, "a run with nothing on stderr logs nothing");
  assert.equal(schedule.dailyTokens(), undefined, "no budget: no cap");
  await schedule.dispose();
});

/* ---------- the fix wave: nothing lost while paused (I4), the edges (p2-m30..m33) ---------- */

test("lines held back while paused are not counted as phoned: each event lands once, each line goes out after the resume", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY, { ...ENTRY, id: "old", expires: "2026-11-30" }]);
  let paused = true;
  const answer = (): DeliverResult => (paused ? { undelivered: "paused" } : { sent: [1] });
  /* 2026-12-02 is a date the calendar cannot answer, and the day after "old" expired */
  const r = rig(fx, "2026-12-02T15:00:00Z", { answer });
  await writeOff(fx.home, { by: "terminal" }, () => r.clock.now());
  await r.clock.advance(0);
  await at(r, "2026-12-02T15:00:00Z");
  await at(r, "2026-12-02T15:00:30Z");
  const expired = "old expired after 2026-11-30 and no longer fires; extend it with npm run desk -- rearm old --expires <YYYY-MM-DD> to keep it";
  const calendar = "no standing order runs today: the market calendar failed in python3 (the fake calendar has no 2026-12-02)";
  assert.ok(r.out.texts.length >= 4, `each line was tried and held, and tried again: ${r.out.texts.join(" | ")}`);
  assert.ok(r.out.texts.every((text) => text === expired || text.startsWith(calendar)), r.out.texts.join(" | "));
  assert.equal((await ofKind(fx.home, "expired")).length, 1, "the expiry is recorded once");
  const errors = await eventsOf(fx.home, "calendar-error");
  assert.equal(errors.length, 1, "the calendar's failure is recorded once");
  assert.equal(errors[0].phoned, false, "and says its line was held");

  await clearOff(fx.home, "terminal", () => r.clock.now());
  paused = false;
  const before = r.out.texts.length;
  await at(r, "2026-12-02T15:01:00Z");
  const after = r.out.texts.slice(before);
  assert.deepEqual(after.filter((text) => text === expired), [expired], "the held expiry goes out once");
  assert.equal(after.filter((text) => text.startsWith(calendar)).length, 1, "the calendar's line once, its failure still standing");
  await at(r, "2026-12-02T15:01:30Z");
  assert.equal(r.out.texts.length, before + after.length, "and nothing again");
  await r.schedule.dispose();
});

test("a standing.yml refused while paused is phoned once the pause lifts, while it still stands; its event lands once", async () => {
  const fx = await fixture();
  let paused = true;
  const r = rig(fx, "2026-11-27T15:00:00Z", { answer: () => (paused ? { undelivered: "paused" } : { sent: [1] }) });
  await writeStanding(fx.home, "orders: [\n");
  await r.clock.advance(0);
  await at(r, "2026-11-27T15:00:00Z");
  await at(r, "2026-11-27T15:00:30Z");
  const refusedLines = () => r.out.texts.filter((text) => text.startsWith("standing.yml is refused"));
  assert.ok(refusedLines().length >= 2, "tried at each tick while held");
  const events = await eventsOf(fx.home, "standing-error");
  assert.equal(events.length, 1);
  assert.equal(events[0].phoned, undefined, "no OFF file: the event did not know the outlet would answer paused");
  paused = false;
  const before = r.out.texts.length;
  await at(r, "2026-11-27T15:01:00Z");
  await at(r, "2026-11-27T15:01:30Z");
  assert.equal(r.out.texts.length, before + 1, "phoned once after the lift");
  assert.equal((await eventsOf(fx.home, "standing-error")).length, 1);
  await r.schedule.dispose();
});

test("a refusal whose line the pause held is recorded reported: false, and the line goes out after the lift", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  let paused = true;
  const r = rig(fx, "2026-11-27T17:30:00Z", { answer: () => (paused ? { undelivered: "paused" } : { sent: [1] }) });
  await writeFile(join(fx.root, "desk", "STANDING.md"), "# changed\n");
  await r.clock.advance(0);
  await at(r, "2026-11-27T17:30:00Z");
  const [refused] = await ofKind(fx.home, "refused");
  assert.deepEqual([refused?.reason, refused?.reported], ["hash", false]);
  paused = false;
  await at(r, "2026-11-27T17:30:30Z");
  assert.equal(r.out.texts.at(-1), "preclose · 2026-11-27 refused: desk/STANDING.md changed since arming. Review it, then: npm run desk -- rearm preclose");
  await r.schedule.dispose();
});

test("boot seeds what events.jsonl says was phoned: an unchanged refusal and today's calendar failure are not phoned again; a held one is", async () => {
  const fx = await fixture();
  await writeStanding(fx.home, "orders: [\n");
  const first = rig(fx, "2026-11-27T15:00:00Z");
  await first.clock.advance(0);
  await at(first, "2026-11-27T15:00:00Z");
  assert.equal(first.out.texts.length, 1);
  await first.schedule.dispose();
  const again = rig(fx, "2026-11-27T15:10:00Z");
  await again.clock.advance(0);
  await at(again, "2026-11-27T15:10:00Z");
  assert.deepEqual(again.out.texts, [], "the same refusal, already phoned, is not phoned after a restart");
  assert.equal((await eventsOf(fx.home, "standing-error")).length, 1, "nor recorded twice");
  await again.schedule.dispose();

  const held = await fixture();
  await writeStanding(held.home, "orders: [\n");
  await appendEvent(held.home, { t: "2026-11-27T14:00:00.000Z", kind: "standing-error", errors: parseStandingErrors("orders: [\n"), phoned: false });
  const resumed = rig(held, "2026-11-27T15:10:00Z");
  await resumed.clock.advance(0);
  await at(resumed, "2026-11-27T15:10:00Z");
  assert.equal(resumed.out.texts.length, 1, "one the pause held before the restart is phoned now");
  assert.equal((await eventsOf(held.home, "standing-error")).length, 1, "and not recorded again");
  await resumed.schedule.dispose();
});

test("an anchor that passed while the order was disabled is settled, not missed, when it is enabled again (p2-m31)", async () => {
  const fx = await fixture();
  await writeStanding(fx.home, `orders:\n${renderOrder(ENTRY, 2).replace("enabled: true", "enabled: false")}`);
  const r = rig(fx, "2026-11-27T17:29:00Z");
  await r.clock.advance(0);
  await at(r, "2026-11-27T17:29:00Z");
  await at(r, "2026-11-27T17:31:00Z");
  await arm(fx.home, [ENTRY]);
  await at(r, "2026-11-27T17:40:00Z");
  assert.deepEqual(await ofKind(fx.home, "missed"), [], "it was not in force for that anchor");
  assert.deepEqual(r.out.texts, []);
  assert.equal(r.runs.length, 0);
  await r.schedule.dispose();
});

test("an unreadable standing.yml fails closed for its tick and is phoned once per code, however often it recurs (p2-m33)", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const path = join(deskDir(fx.home), STANDING_FILE);
  const text = await readFile(path, "utf8");
  const r = rig(fx, "2026-11-27T15:00:00Z");
  await r.clock.advance(0);
  await at(r, "2026-11-27T15:00:00Z");
  for (const minute of ["01", "02", "03"]) {
    /* a directory where the file was: stat answers, the read fails EISDIR - a failure that comes and goes */
    await rm(path);
    await mkdir(path);
    await at(r, `2026-11-27T15:${minute}:00Z`);
    assert.equal(r.schedule.status().file.state, "refused", "fail closed");
    await rm(path, { recursive: true });
    await writeStanding(fx.home, text);
    await at(r, `2026-11-27T15:${minute}:30Z`);
    assert.equal(r.schedule.status().file.state, "loaded");
  }
  assert.deepEqual(r.out.texts, ["standing.yml is refused, so no standing order runs until it is fixed: standing.yml cannot be read (EISDIR)"],
    "one line for the code");
  await r.schedule.dispose();
});

test("a started record that cannot be written is a ledger failure: its line, the ledger read again, and no late miss (p2-m30)", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root writes a 0400 file");
    return;
  }
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const r = rig(fx, "2026-11-27T17:29:00Z");
  await r.clock.advance(0);
  await at(r, "2026-11-27T17:29:59Z");
  /* a ledger the face can read and cannot write: the once-only append fails */
  const ledger = join(deskDir(fx.home), FIRINGS_FILE);
  await writeFile(ledger, "");
  await chmod(ledger, 0o400);
  await at(r, "2026-11-27T17:30:00Z");
  await at(r, "2026-11-27T17:30:30Z");
  await at(r, "2026-11-27T17:31:00Z");
  const told = r.out.texts.filter((text) => text.startsWith(`the firing ledger ${ledger} cannot be read (the started record could not be written)`));
  assert.equal(told.length, 1, `one line, however often the append fails: ${r.out.texts.join(" | ")}`);
  assert.equal((await eventsOf(fx.home, "standing-error")).length, 1);
  await chmod(ledger, 0o600);
  await at(r, "2026-11-27T17:40:00Z");
  assert.equal(r.schedule.status().ledger, undefined, "read again, and readable");
  assert.deepEqual(await ofKind(fx.home, "missed"), [], "no miss reported late for it");
  assert.equal(r.runs.length, 0);
  await r.schedule.dispose();
});

test("createDeskSchedule reads its owner's now when no clock seam is given (M7)", async () => {
  const fx = await fixture();
  await arm(fx.home, [ENTRY]);
  const calendar = fakeCalendar(DAYS);
  const ctx: DeskSessionCtxLike = {
    agents: { get: () => undefined, create: async () => { throw new Error("none"); }, resume: async () => { throw new Error("none"); } },
    agentPresets: { mount: async (_agentCtx, id) => ({ id }) },
    permissionPresets: { set: () => {}, current: () => "workspace-write" },
  };
  const schedule = createDeskSchedule({
    home: fx.home, root: fx.root, python: "python3",
    session: { ctx, root: fx.root, home: fx.home, route: { provider: "stub", model: "echo" }, installModelSelection: () => () => {} },
    sessionCtx: {}, on: fakeBus().on, deliver: recordingDeliver().deliver, log: () => {},
    now: () => Date.parse("2026-11-24T15:00:00Z"),
    seams: { calendar, tickMs: DAY_MS },
  });
  await schedule.tick();
  assert.deepEqual(calendar.asked, ["2026-11-24"], "the day is the owner's, not the wall clock's");
  assert.equal(schedule.status().calendar.today?.date, "2026-11-24");
  await schedule.dispose();
});
