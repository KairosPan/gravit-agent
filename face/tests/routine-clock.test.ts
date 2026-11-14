// face/tests/routine-clock.test.ts
/** The routines' clock row (src/routine-clock.ts): a slot's key consumed once, the grace, missed slots and why, the
 * one-at-a-time queue, the pause, the daily cap, a test run, a run a stop cut off, a refused store, and the status the
 * page reads. Offline: a WallClock and a fake calendar (tests/desk-fakes.ts), a run that records its calls and appends
 * its own `finished` (or holds until released), ticks driven by hand. Each case's repository root and harness home sit
 * INSIDE the repository, under tests/tmp/routine-clock-<pid>/, and are removed afterwards. */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent, appendRecord, clearOff, deskDir, readRecords, writeOff } from "../src/desk.ts";
import type { MarketCalendar, MarketSession } from "../src/market-clock.ts";
import { carryToday, HISTORY_MAX, installRoutineClock, runNote, type RoutineClock } from "../src/routine-clock.ts";
import { isRunRecord, type RoutineRunRecord, type RunItem } from "../src/routine-run.ts";
import type { RoutineSchedule } from "../src/routine-schedule.ts";
import { routineOps, ROUTINES_FILE, ROUTINES_LEDGER } from "../src/routines.ts";
import { fakeBus, fakeCalendar, WallClock } from "./desk-fakes.ts";

/* ---------- fixtures, inside the repository ---------- */

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "tmp", `routine-clock-${process.pid}`);
before(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
});
after(() => rm(TEST_DIR, { recursive: true, force: true }));

interface Fixture { root: string; home: string }
let made = 0;
async function fixture(): Promise<Fixture> {
  const dir = join(TEST_DIR, String(++made));
  const root = join(dir, "root");
  const home = join(dir, "home");
  await mkdir(join(root, "desk", "journal"), { recursive: true });
  await mkdir(deskDir(home), { recursive: true });
  return { root, home };
}

/** A routine as the store holds it: `r-0000000<n>`, confirmed a week before the cases' days. */
function routine(n: number, schedule: RoutineSchedule, over: { enabled?: boolean; confirmedAt?: string } = {}): object {
  return {
    id: `r-0000000${n}`, name: `Routine ${n}`, schedule, instruction: `Do thing ${n}.`, sha256: "0".repeat(64), proposal: `p-0000000${n}`,
    origin: { kind: "web" }, confirmedAt: over.confirmedAt ?? "2026-11-06T12:00:00.000Z", enabled: over.enabled ?? true,
  };
}
async function writeStore(home: string, routines: object[], dailyTokens = 10_000_000): Promise<void> {
  await writeFile(join(deskDir(home), ROUTINES_FILE), `${JSON.stringify({ version: 1, budget: { dailyTokens }, routines, proposals: [] }, null, 2)}\n`);
}

const regular = (date: string): MarketSession => ({ date, open: `${date}T14:30:00Z`, close: `${date}T21:00:00Z`, early: false });
/** Friday the 13th trading, the weekend closed, Monday trading. New York is on EST: 09:00 ET is 14:00Z. */
const DAYS: Record<string, MarketSession | "closed"> = {
  "2026-11-13": regular("2026-11-13"),
  "2026-11-14": "closed",
  "2026-11-15": "closed",
  "2026-11-16": regular("2026-11-16"),
};
const DAY_MS = 86_400_000;

interface Rig {
  fx: Fixture;
  clock: WallClock;
  rc: RoutineClock;
  runs: RunItem[];
  lines: string[];
  /** Release the held run of `key`, appending its `finished`. */
  release(key: string): void;
  /** The most runs under way at once. */
  peak(): number;
}

/** A clock row over `fx` on a WallClock at `start`: ticks a day apart (driven by hand), DAYS' calendar, and a run that
 * records its item and appends its `finished` (`ended`, "No ideas") - after its release when `hold` is set. */
function rig(fx: Fixture, start: string, opts: { calendar?: MarketCalendar; bootedAt?: number; hold?: boolean; clock?: WallClock } = {}): Rig {
  const clock = opts.clock ?? new WallClock(start);
  const runs: RunItem[] = [];
  const lines: string[] = [];
  const gates = new Map<string, () => void>();
  let now = 0;
  let peak = 0;
  const rc = installRoutineClock({
    home: fx.home, root: fx.root, clock,
    calendar: opts.calendar ?? fakeCalendar(DAYS),
    createAgent: () => Promise.reject(new Error("no agent in these cases")),
    resolveRoute: async () => ({ provider: "stub", model: "echo" }),
    on: fakeBus().on,
    log: (line) => { lines.push(line); },
    tickMs: DAY_MS,
    ...(opts.bootedAt === undefined ? {} : { bootedAt: opts.bootedAt }),
    run: async (_deps, item, signal) => {
      runs.push(item);
      now += 1;
      peak = Math.max(peak, now);
      if (opts.hold === true) {
        await new Promise<void>((done) => {
          gates.set(item.key, done);
          signal.addEventListener("abort", () => { done(); }, { once: true });
        });
      }
      now -= 1;
      if (signal.aborted) return;
      await appendRecord(fx.home, ROUTINES_LEDGER, {
        t: new Date(clock.now()).toISOString(), kind: "finished", key: item.key, routine: item.routine.id, outcome: "ended",
        headline: "No ideas", reported: false, wallMs: 1000, ...(item.test === true ? { test: true } : {}),
      } satisfies RoutineRunRecord);
    },
  });
  return {
    fx, clock, rc, runs, lines,
    release: (key) => { gates.get(key)?.(); },
    peak: () => peak,
  };
}

/** Poll, in real time, until `ok` holds: the ledger settles on real file I/O, which no fake clock drives. */
async function waitFor(what: string, ok: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 2));
  }
}
/** Until the clock row has nothing queued or running, three polls in a row. */
async function idle(rc: RoutineClock): Promise<void> {
  let quiet = 0;
  await waitFor("the runner to go idle", async () => {
    const s = await rc.status();
    quiet = s.queued.length === 0 && s.running === undefined ? quiet + 1 : 0;
    if (quiet < 3) await new Promise((done) => setTimeout(done, 10));
    return quiet >= 3;
  });
}
/** Tick at `iso`, then wait for whatever the tick queued. */
async function at(r: Rig, iso: string): Promise<void> {
  r.clock.set(iso);
  await r.rc.tick();
  await idle(r.rc);
}
const records = async (home: string): Promise<RoutineRunRecord[]> => (await readRecords(home, ROUTINES_LEDGER, isRunRecord)).records;
async function ofKind<K extends RoutineRunRecord["kind"]>(home: string, kind: K): Promise<Extract<RoutineRunRecord, { kind: K }>[]> {
  return (await records(home)).filter((r): r is Extract<RoutineRunRecord, { kind: K }> => r.kind === kind);
}

const AT_0900: RoutineSchedule = { days: "daily", times: ["09:00"] };
const HALF_HOURLY: RoutineSchedule = { days: "daily", every: { minutes: 30, from: "09:00", to: "10:00" } };

/* ---------- the note ---------- */

test("runNote gives codes: an ended run its headline, other ends their outcome, a miss and a skip their why", () => {
  const base = { t: "2026-11-13T14:00:00.000Z", key: "r-00000001:2026-11-13:09:00", routine: "r-00000001" };
  assert.equal(runNote({ ...base, kind: "finished", outcome: "ended", headline: "1 idea: long AMD", reported: true, wallMs: 1 }), "1 idea: long AMD");
  assert.equal(runNote({ ...base, kind: "finished", outcome: "timed-out", headline: "", reported: false, wallMs: 1 }), "timed-out");
  assert.equal(runNote({ ...base, kind: "finished", outcome: "no-answer", headline: "", reported: false, wallMs: 1 }), "no-answer");
  assert.equal(runNote({ ...base, kind: "finished", outcome: "cancelled", headline: "", reported: false, wallMs: 1 }), "cancelled");
  assert.equal(runNote({ ...base, kind: "finished", outcome: "error", headline: "", reported: false, wallMs: 1, error: "x" }), "error");
  assert.equal(runNote({ ...base, kind: "missed", date: "2026-11-13", slot: "09:00", why: "asleep", foundAt: base.t }), "asleep");
  assert.equal(runNote({ t: base.t, kind: "skipped", routine: base.routine, why: "cap" }), "cap");
  assert.equal(runNote({ ...base, kind: "interrupted", startedAt: base.t }), "interrupted");
});

/* ---------- the key and the grace ---------- */

test("a slot fires once inside its grace, never twice across two ticks or two clock rows on one home", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, AT_0900)]);
  const clock = new WallClock("2026-11-13T13:50:00Z");
  const a = rig(fx, "", { clock });
  const b = rig(fx, "", { clock });
  await at(a, "2026-11-13T13:59:00Z");
  assert.equal(a.runs.length, 0, "before its minute, it waits");
  clock.set("2026-11-13T14:01:00Z");
  await Promise.all([a.rc.tick(), b.rc.tick()]);
  await Promise.all([idle(a.rc), idle(b.rc)]);
  await at(a, "2026-11-13T14:03:00Z");
  await at(b, "2026-11-13T14:04:00Z");
  assert.equal(a.runs.length + b.runs.length, 1);
  const started = await ofKind(fx.home, "started");
  assert.deepEqual(started.map((s) => [s.key, s.date, s.slot, s.at]), [["r-00000001:2026-11-13:09:00", "2026-11-13", "09:00", "2026-11-13T14:00:00.000Z"]]);
  assert.equal((await ofKind(fx.home, "missed")).length, 0);
  await at(a, "2026-11-13T14:30:00Z");
  assert.equal(a.runs.length + b.runs.length, 1, "past its grace, a started slot is settled");
  await Promise.all([a.rc.dispose(), b.rc.dispose()]);
});

test("Review Focus 1: three slots slept across are three missed saying asleep, and none runs on wake", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, HALF_HOURLY)]);
  const r = rig(fx, "2026-11-13T13:00:00Z");
  await at(r, "2026-11-13T13:50:00Z");
  await at(r, "2026-11-13T15:20:00Z"); // 10:20 ET: 09:00, 09:30 and 10:00 all past their grace
  assert.equal(r.runs.length, 0);
  const missed = await ofKind(fx.home, "missed");
  assert.deepEqual(missed.map((m) => [m.slot, m.why]), [["09:00", "asleep"], ["09:30", "asleep"], ["10:00", "asleep"]]);
  assert.deepEqual(missed[0]!.asleep, { from: "2026-11-13T13:50:00.000Z", to: "2026-11-13T15:20:00.000Z" });
  await at(r, "2026-11-13T15:21:00Z");
  assert.equal((await ofKind(fx.home, "missed")).length, 3, "each recorded once");
  await r.rc.dispose();
});

test("a slot before the face booted is missed as down; one found late while awake is late", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, AT_0900), routine(2, { days: "daily", times: ["09:10"] })]);
  const r = rig(fx, "2026-11-13T14:08:00Z");
  await at(r, "2026-11-13T14:08:00Z");
  /* the store refused across 09:10's grace, ticked every minute, then fixed: 09:10 is found late, not slept across */
  const good = await readFile(join(deskDir(fx.home), ROUTINES_FILE), "utf8");
  await writeFile(join(deskDir(fx.home), ROUTINES_FILE), "{");
  for (let m = 9; m <= 15; m++) await at(r, `2026-11-13T14:${String(m).padStart(2, "0")}:30Z`);
  await writeFile(join(deskDir(fx.home), ROUTINES_FILE), good);
  await at(r, "2026-11-13T14:16:30Z");
  const missed = await ofKind(fx.home, "missed");
  assert.deepEqual(missed.map((m) => [m.routine, m.why]), [["r-00000001", "down"], ["r-00000002", "late"]]);
  assert.equal(r.runs.length, 0);
  await r.rc.dispose();
});

test("a slot before the routine was confirmed is settled, never run nor missed", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, AT_0900, { confirmedAt: "2026-11-13T14:02:00.000Z" })]);
  const r = rig(fx, "2026-11-13T13:00:00Z");
  await at(r, "2026-11-13T14:03:00Z");
  await at(r, "2026-11-13T14:30:00Z");
  assert.equal(r.runs.length, 0);
  assert.deepEqual(await records(fx.home), []);
  await r.rc.dispose();
});

/* ---------- the queue ---------- */

test("two routines on one minute run one after the other", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, AT_0900), routine(2, AT_0900)]);
  const r = rig(fx, "2026-11-13T13:00:00Z", { hold: true });
  r.clock.set("2026-11-13T14:01:00Z");
  await r.rc.tick();
  await waitFor("the first run", () => r.runs.length === 1);
  assert.deepEqual((await r.rc.status()).queued, ["r-00000002:2026-11-13:09:00"]);
  assert.equal((await r.rc.status()).running, "r-00000001:2026-11-13:09:00");
  r.release("r-00000001:2026-11-13:09:00");
  await waitFor("the second run", () => r.runs.length === 2);
  r.release("r-00000002:2026-11-13:09:00");
  await idle(r.rc);
  assert.equal(r.peak(), 1);
  assert.deepEqual((await ofKind(fx.home, "finished")).map((f) => f.key), ["r-00000001:2026-11-13:09:00", "r-00000002:2026-11-13:09:00"]);
  await r.rc.dispose();
});

test("the second of two is missed as busy when the first holds for 16 minutes", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, AT_0900), routine(2, AT_0900)]);
  const r = rig(fx, "2026-11-13T13:00:00Z", { hold: true });
  r.clock.set("2026-11-13T14:00:30Z");
  await r.rc.tick();
  await waitFor("the first run", () => r.runs.length === 1);
  r.clock.set("2026-11-13T14:16:30Z");
  await r.rc.tick(); // the second is still queued: settled, not missed by the tick
  r.release("r-00000001:2026-11-13:09:00");
  await idle(r.rc);
  assert.equal(r.runs.length, 1);
  const missed = await ofKind(fx.home, "missed");
  assert.deepEqual(missed.map((m) => [m.key, m.why]), [["r-00000002:2026-11-13:09:00", "busy"]]);
  await r.rc.dispose();
});

test("Review Focus 4: a routine switched off while its slot is queued never runs, and nothing is recorded for it", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, AT_0900), routine(2, AT_0900)]);
  const r = rig(fx, "2026-11-13T13:00:00Z", { hold: true });
  r.clock.set("2026-11-13T14:01:00Z");
  await r.rc.tick();
  await waitFor("the first run", () => r.runs.length === 1);
  await routineOps({ home: fx.home }).setEnabled("r-00000002", false);
  r.release("r-00000001:2026-11-13:09:00");
  await idle(r.rc);
  assert.deepEqual(r.runs.map((x) => x.key), ["r-00000001:2026-11-13:09:00"]);
  assert.deepEqual((await records(fx.home)).filter((x) => x.routine === "r-00000002"), []);
  await at(r, "2026-11-13T14:30:00Z");
  assert.deepEqual(await ofKind(fx.home, "missed"), [], "a disabled routine's slot is not missed either");
  await r.rc.dispose();
});

/* ---------- the pause and the cap ---------- */

test("a paused desk writes one skipped for three slots, runs nothing, and misses none", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, HALF_HOURLY)]);
  const r = rig(fx, "2026-11-13T13:00:00Z");
  await writeOff(fx.home, { by: "terminal" }, () => r.clock.now());
  await at(r, "2026-11-13T14:01:00Z");
  await at(r, "2026-11-13T14:31:00Z");
  await at(r, "2026-11-13T15:01:00Z");
  await at(r, "2026-11-13T15:30:00Z");
  assert.equal(r.runs.length, 0);
  assert.deepEqual((await ofKind(fx.home, "skipped")).map((s) => [s.routine, s.why]), [["r-00000001", "paused"]]);
  assert.deepEqual(await ofKind(fx.home, "missed"), []);
  /* a new pause after a lift is a new span */
  await clearOff(fx.home, "terminal", () => r.clock.now());
  await at(r, "2026-11-13T15:31:00Z");
  await writeOff(fx.home, { by: "terminal" }, () => r.clock.now());
  await writeStore(fx.home, [routine(1, { days: "daily", times: ["10:35"] })]);
  await at(r, "2026-11-13T15:36:00Z");
  assert.equal((await ofKind(fx.home, "skipped")).length, 2);
  await r.rc.dispose();
});

test("the cap is spent by desk turns of source routine, not by ones of source alert", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, AT_0900), routine(2, { days: "daily", times: ["09:10"] })], 1_000);
  const usage = (n: number) => ({ uncachedInputTokens: n, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, routes: [] });
  await appendEvent(fx.home, { t: "2026-11-13T13:00:00.000Z", kind: "desk-turn", sessionId: "s", source: "alert", turn: 1, outcome: "ended", wallMs: 1, usage: usage(5_000) });
  await appendEvent(fx.home, { t: "2026-11-13T04:00:00.000Z", kind: "desk-turn", sessionId: "s", source: "routine", turn: 1, outcome: "ended", wallMs: 1, usage: usage(5_000) });
  const r = rig(fx, "2026-11-13T13:00:00Z");
  await at(r, "2026-11-13T14:01:00Z");
  assert.equal(r.runs.length, 1, "the alert's tokens and yesterday's routine tokens count nothing");
  await appendEvent(fx.home, { t: "2026-11-13T14:02:00.000Z", kind: "desk-turn", sessionId: "s", source: "routine", turn: 1, outcome: "ended", wallMs: 1, usage: { ...usage(600), outputTokens: 400 } });
  await at(r, "2026-11-13T14:11:00Z");
  await at(r, "2026-11-13T14:12:00Z");
  assert.equal(r.runs.length, 1);
  assert.deepEqual((await ofKind(fx.home, "skipped")).map((s) => [s.routine, s.why]), [["r-00000002", "cap"]]);
  const s = await r.rc.status();
  assert.deepEqual(s.cap, { dailyTokens: 1_000, used: 1_000, spent: true });
  assert.equal(await r.rc.test("r-00000001"), "cap");
  await r.rc.dispose();
});

/* ---------- a test run ---------- */

test("a test runs under its own key while the routine is off, and is answered paused on a paused desk", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, AT_0900, { enabled: false })]);
  const r = rig(fx, "2026-11-13T15:00:04Z");
  assert.equal(await r.rc.test("r-00000009"), "unknown");
  assert.equal(await r.rc.test("r-00000001"), "queued");
  await idle(r.rc);
  assert.deepEqual(r.runs.map((x) => [x.key, x.test, x.date, x.slot]), [["r-00000001:test:2026-11-13T15:00:04.000Z", true, "2026-11-13", "10:00"]]);
  const [started] = await ofKind(fx.home, "started");
  assert.equal(started!.test, true);
  await writeOff(fx.home, { by: "terminal" }, () => r.clock.now());
  assert.equal(await r.rc.test("r-00000001"), "paused");
  assert.deepEqual((await r.rc.status()).queued, []);
  assert.equal(r.runs.length, 1);
  const [view] = (await r.rc.status()).routines;
  assert.deepEqual(view!.runs.map((v) => [v.status, v.note, v.test]), [["succeeded", "No ideas", true]]);
  await r.rc.dispose();
});

/* ---------- a restart ---------- */

test("a started with no end at boot is one interrupted, and its slot is not run again", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, AT_0900)]);
  const key = "r-00000001:2026-11-13:09:00";
  await appendRecord(fx.home, ROUTINES_LEDGER, {
    t: "2026-11-13T14:00:10.000Z", kind: "started", key, routine: "r-00000001", name: "Routine 1", sha256: "0".repeat(64),
    date: "2026-11-13", slot: "09:00", at: "2026-11-13T14:00:00.000Z",
  } satisfies RoutineRunRecord);
  const r = rig(fx, "2026-11-13T14:02:00Z");
  await at(r, "2026-11-13T14:02:00Z");
  await at(r, "2026-11-13T14:03:00Z");
  assert.equal(r.runs.length, 0);
  assert.deepEqual((await ofKind(fx.home, "interrupted")).map((i) => [i.key, i.startedAt]), [[key, "2026-11-13T14:00:10.000Z"]]);
  const [view] = (await r.rc.status()).routines;
  assert.deepEqual(view!.runs.map((v) => [v.key, v.status, v.note]), [[key, "failed", "interrupted"]]);
  /* a second boot finds it ended */
  await r.rc.dispose();
  const again = rig(fx, "2026-11-13T14:04:00Z");
  await at(again, "2026-11-13T14:04:00Z");
  assert.equal((await ofKind(fx.home, "interrupted")).length, 1);
  await again.rc.dispose();
});

/* ---------- a refused store ---------- */

test("a store cut short stops every routine, the status says so, and nothing writes over it", async () => {
  const fx = await fixture();
  const path = join(deskDir(fx.home), ROUTINES_FILE);
  const cut = `{"version":1,"budget":{"dailyTokens":10000000},"routines":[${JSON.stringify(routine(1, AT_0900))}`;
  await writeFile(path, cut);
  const r = rig(fx, "2026-11-13T13:00:00Z");
  await at(r, "2026-11-13T14:01:00Z");
  await at(r, "2026-11-13T14:30:00Z");
  assert.equal(r.runs.length, 0);
  assert.deepEqual(await records(fx.home), []);
  const s = await r.rc.status();
  assert.equal(s.load.ok, false);
  assert.match(s.load.ok ? "" : s.load.error, /routines\.json is not JSON/);
  assert.deepEqual(s.routines, []);
  assert.deepEqual(s.proposals, []);
  assert.equal(await r.rc.test("r-00000001"), "unknown");
  assert.equal(await readFile(path, "utf8"), cut);
  assert.equal(r.lines.filter((l) => l.includes("routines store")).length, 1, "one line per distinct reason");
  await r.rc.dispose();
});

/* ---------- the status ---------- */

test("status gives the next run and the runs newest first, 20 at most", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, AT_0900), routine(2, AT_0900, { enabled: false })]);
  for (let day = 1; day <= 25; day++) {
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    const key = `r-00000001:${date}:09:00`;
    const at = `${date}T13:00:00.000Z`;
    await appendRecord(fx.home, ROUTINES_LEDGER, { t: at, kind: "started", key, routine: "r-00000001", name: "Routine 1", sha256: "0".repeat(64), date, slot: "09:00", at } satisfies RoutineRunRecord);
    await appendRecord(fx.home, ROUTINES_LEDGER, {
      t: at, kind: "finished", key, routine: "r-00000001", wallMs: 1, reported: false,
      ...(day === 25 ? { outcome: "timed-out" as const, headline: "", error: "deadline" } : { outcome: "ended" as const, headline: `Day ${day}` }),
    } satisfies RoutineRunRecord);
  }
  await appendRecord(fx.home, ROUTINES_LEDGER, {
    t: "2026-10-26T14:20:00.000Z", kind: "missed", key: "r-00000001:2026-10-26:09:00", routine: "r-00000001", date: "2026-10-26", slot: "09:00", why: "late", foundAt: "2026-10-26T14:20:00.000Z",
  } satisfies RoutineRunRecord);
  const r = rig(fx, "2026-11-13T15:00:00Z");
  const s = await r.rc.status();
  const [one, two] = s.routines;
  assert.equal(one!.when, "Every day at 09:00 ET");
  assert.deepEqual(one!.next, { date: "2026-11-14", slot: "09:00", at: "2026-11-14T14:00:00.000Z" });
  assert.equal(two!.next, undefined, "a switched-off routine has no next run");
  assert.equal(one!.runs.length, HISTORY_MAX);
  assert.deepEqual(one!.runs.slice(0, 3).map((v) => [v.at, v.status, v.note, v.detail]), [
    ["2026-10-26T13:00:00.000Z", "missed", "late", undefined],
    ["2026-10-25T13:00:00.000Z", "failed", "timed-out", "deadline"],
    ["2026-10-24T13:00:00.000Z", "succeeded", "Day 24", undefined],
  ]);
  assert.equal(one!.runs.at(-1)!.note, "Day 7", "the 26 runs' newest 20");
  assert.deepEqual(s.cap, { dailyTokens: 10_000_000, used: 0, spent: false });
  assert.deepEqual(two!.runs, []);
  await r.rc.dispose();
});

test("status carries every proposal, newest first: its when line, the routine it replaces by name, whether it is current, a current one's next run", async () => {
  const fx = await fixture();
  const proposal = (n: number, over: object): object => ({
    id: `p-0000000${n}`, name: `Proposal ${n}`, schedule: AT_0900, instruction: `Do thing ${n}.`, sha256: "0".repeat(64),
    origin: { kind: "web" }, proposedAt: `2026-11-0${n}T12:00:00.000Z`, ...over,
  });
  const settled = { settledAt: "2026-11-09T12:00:00.000Z" };
  await writeFile(join(deskDir(fx.home), ROUTINES_FILE), `${JSON.stringify({
    version: 1, budget: { dailyTokens: 10_000_000 },
    routines: [routine(1, AT_0900), routine(2, AT_0900, { enabled: false })],
    proposals: [
      proposal(1, { state: "confirmed", ...settled, routine: "r-00000001" }),
      proposal(2, { state: "confirmed", ...settled, routine: "r-00000002" }),
      proposal(3, { state: "confirmed", ...settled, routine: "r-00000009" }),
      proposal(4, { state: "pending", replaces: "r-00000001", note: "Earlier." }),
      proposal(5, { state: "superseded", ...settled, replaces: "r-00000009" }),
      proposal(6, { state: "confirmed", ...settled, routine: "r-00000001" }),
    ],
  }, null, 2)}\n`);
  const r = rig(fx, "2026-11-13T15:00:00Z");
  const s = await r.rc.status();
  assert.deepEqual(s.proposals.map((p) => p.id), ["p-00000006", "p-00000005", "p-00000004", "p-00000003", "p-00000002", "p-00000001"]);
  const byId = new Map(s.proposals.map((p) => [p.id, p]));
  assert.deepEqual(byId.get("p-00000001"), {
    id: "p-00000001", name: "Proposal 1", when: "Every day at 09:00 ET", instruction: "Do thing 1.", state: "confirmed",
    proposedAt: "2026-11-01T12:00:00.000Z", settledAt: "2026-11-09T12:00:00.000Z", routine: "r-00000001", current: true,
    next: { date: "2026-11-14", slot: "09:00", at: "2026-11-14T14:00:00.000Z" },
  });
  assert.deepEqual([byId.get("p-00000002")!.current, byId.get("p-00000002")!.next], [true, undefined], "a switched-off routine's proposal is current, with no next run");
  assert.deepEqual([byId.get("p-00000003")!.current, byId.get("p-00000003")!.next], [false, undefined], "one whose routine was deleted is not current");
  assert.deepEqual([byId.get("p-00000006")!.current, byId.get("p-00000006")!.next], [false, undefined],
    "nor one confirmed onto a routine whose version is another proposal's");
  assert.deepEqual(byId.get("p-00000004"), {
    id: "p-00000004", name: "Proposal 4", when: "Every day at 09:00 ET", instruction: "Do thing 4.", note: "Earlier.",
    replaces: "r-00000001", replacesName: "Routine 1", state: "pending", proposedAt: "2026-11-04T12:00:00.000Z", current: false,
  });
  assert.equal(byId.get("p-00000005")!.replaces, "r-00000009");
  assert.equal(byId.get("p-00000005")!.replacesName, undefined, "a replaced routine the store no longer holds has no name");
  await r.rc.dispose();
});

/* ---------- the calendar ---------- */

test("a trading-days routine has no slot on a closed day; a daily one does", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, { days: "trading", times: ["09:00"] }), routine(2, AT_0900)]);
  const r = rig(fx, "2026-11-14T13:00:00Z");
  await at(r, "2026-11-14T14:01:00Z");
  await at(r, "2026-11-14T14:30:00Z");
  assert.deepEqual(r.runs.map((x) => x.key), ["r-00000002:2026-11-14:09:00"]);
  assert.deepEqual(await ofKind(fx.home, "missed"), []);
  const [trading] = (await r.rc.status()).routines;
  assert.deepEqual(trading!.next, { date: "2026-11-16", slot: "09:00", at: "2026-11-16T14:00:00.000Z" });
  await r.rc.dispose();
});

test("a calendar that cannot answer makes no trading-days slot due, said once", async () => {
  const fx = await fixture();
  await writeStore(fx.home, [routine(1, { days: "trading", times: ["09:00"] })]);
  const r = rig(fx, "2026-11-20T13:00:00Z");
  await at(r, "2026-11-20T14:01:00Z");
  await at(r, "2026-11-20T14:02:00Z");
  assert.equal(r.runs.length, 0);
  assert.equal(r.lines.filter((l) => l.includes("cannot answer for 2026-11-20")).length, 1);
  await r.rc.dispose();
});

/* ---------- the rotation ---------- */

test("a rotation carries today's started and missed lines and the ends of the runs they carry", () => {
  const line = (r: object): string => JSON.stringify(r);
  const today = "2026-11-13";
  const s = (date: string, n: number) => ({ t: `${date}T14:00:00.000Z`, kind: "started", key: `r-0000000${n}:${date}:09:00`, routine: `r-0000000${n}`, name: "R", sha256: "0", date, slot: "09:00", at: `${date}T14:00:00.000Z` });
  const f = (date: string, n: number) => ({ t: `${date}T14:01:00.000Z`, kind: "finished", key: `r-0000000${n}:${date}:09:00`, routine: `r-0000000${n}`, outcome: "ended", headline: "h", reported: false, wallMs: 1 });
  const m = { t: `${today}T15:00:00.000Z`, kind: "missed", key: `r-00000003:${today}:09:00`, routine: "r-00000003", date: today, slot: "09:00", why: "late", foundAt: `${today}T15:00:00.000Z` };
  const act = { t: `${today}T13:00:00.000Z`, kind: "confirmed", proposal: "p-00000001", routine: "r-00000001" };
  const text = [s("2026-11-12", 1), f("2026-11-12", 1), act, s(today, 1), f(today, 1), s(today, 2), m].map(line).join("\n") + "\n{torn";
  assert.deepEqual(carryToday(text, today), [s(today, 1), f(today, 1), s(today, 2), m].map(line));
});
