/** The routines' clock row: when a routine runs. A routine is a named instruction the operator confirmed, run on New
 * York's wall clock by an unattended desk agent (src/routine-run.ts runs one); this module keeps each slot's key,
 * queues what is due, records what was missed and why, and runs the queue one at a time - the model is the standing
 * orders' clock row (src/schedule.ts), without its producers, hashes, phone lines or held lines.
 *
 * THE TICK, every {@link ROUTINE_TICK_MS} on the injected clock - a timer re-armed once a tick is done, so a Mac that
 * slept wakes to one tick, never a burst -, in this order:
 * - the store's sweep (src/routines.ts), then its load: a refused load stops every routine until it is fixed - one
 *   line per distinct reason, and it is what {@link RoutineClock.status} says;
 * - once, the run ledger (`routines.jsonl`): the keys it holds, and each `started` with no end one `interrupted`
 *   record, never run again; a ledger that cannot be read stops every routine, one line per distinct reason, and is
 *   read again each tick;
 * - the desk's pause: a tick that finds the desk running forgets which routines' skips the last pause recorded;
 * - New York's date, and - when an enabled routine runs on trading days - whether the US calendar holds a session
 *   that day; a calendar that cannot answer makes no trading-days slot due that day, and says so in one line;
 * - each enabled routine's slots today ({@link slotsOn}): one whose key holds a `started` or a `missed` is settled;
 *   before its minute, it waits; one before the later of the routine's `confirmedAt` and its `enabledAt` (src/routines.ts:
 *   a slot passed while it was off) is passed over with no record, never run; within
 *   {@link SLOT_GRACE_MS} of its minute it is queued unless it is queued or running already; past that, one queued,
 *   running or refused (the pause, the cap, a ledger that would not take its `started`) is settled, any other one
 *   `missed` - `asleep` when the gap since the last tick is over src/desk.ts `ASLEEP_THRESHOLD_MS` and began at or
 *   before the slot, `down` when the slot came before this run began (`bootedAt`), else `late`.
 *
 * THE KEY. A slot's key, `<routine>:<date>:<HH:MM>`, is consumed by its `started` alone, appended through src/desk.ts
 * `appendRecordOnce` under the ledger's lock: of two faces on one home, one runs it. A rotation of the ledger hands
 * the new file today's `started` and `missed` lines and the ends of the runs they carry ({@link carryToday}), so the
 * once-only append - which reads the current file alone - still finds today's keys. Earlier days are never
 * back-filled. A test run's key is `<routine>:test:<ISO time>`.
 *
 * THE RUNNER takes one item at a time, in queue order - a test at the front -, and before a run, in this order: an
 * item more than {@link SLOT_WAIT_MS} past its minute is `missed`, `busy` (a test never is); the routine as the store
 * holds it now - gone, switched off (a test runs while it is off) or at another version - drops the item with no
 * record; the desk paused (src/desk.ts `readOffState`) is one `skipped`, `paused`, a routine a pause; the day's cap
 * spent is one `skipped`, `cap`, a routine a New York day; else the `started`, then the run.
 *
 * THE CAP is the store's `budget.dailyTokens` against the four token buckets of the day's `desk-turn` events whose
 * `source` is `routine` - the routines' own spend, from 00:00 New York; only the day's sum is kept, the file's appended
 * bytes alone read again ({@link spendReader}).
 *
 * FAILURES never reach the face: a tick, a run, a ledger read - each is caught, one
 * `gravit-face: desk: routines <what>: <reason>` line, and the next tick is armed regardless.
 *
 * MODULE WEIGHT. It brings src/routine-run.ts (src/desk-session.ts, the desk preset, js-yaml, dsh-agent): src/desk.ts
 * loads it lazily, inside `installDesk`, and nothing light imports it.
 * @module
 */
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  appendRecord, appendRecordOnce, ASLEEP_THRESHOLD_MS, deskDir, EVENTS_FILE, readOffState, readRecords,
} from "./desk.ts";
import { etDate, etDayStart, etTime } from "./et.ts";
import type { MarketCalendar } from "./market-clock.ts";
import { proposalViews } from "./routine-routes.ts";
import { isRunRecord, runRoutine, type RoutineRunRecord, type RunDeps, type RunItem } from "./routine-run.ts";
import { nextRun, nyInstant, SLOT_GRACE_MS, SLOT_WAIT_MS, slotsOn, whenText } from "./routine-schedule.ts";
import { DAILY_TOKENS_DEFAULT, loadRoutines, routineOps, ROUTINES_LEDGER, type Proposal, type Routine, type StoreLoad } from "./routines.ts";

/** Diagnostic label, the one every `${BIN}:`-prefixed line in the face uses; desk lines add `desk:`. */
const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/** Where the clock row's lines go unless its deps pass `log`: stderr, as the desk's others do. */
const defaultLog = (line: string): void => { console.error(line); };
const iso = (ms: number): string => new Date(ms).toISOString();

/** How often the clock row ticks. */
export const ROUTINE_TICK_MS = 30_000;
/** The most runs a routine's history shows. */
export const HISTORY_MAX = 20;
/** The longest a dispose waits for the run it aborted and the tick under way. */
const DISPOSE_WAIT_MS = 2_000;

/** One run as the status table shows it: its key; its slot's instant (a test's, when it was asked for; a skip's, when
 * it was recorded), ISO-8601 UTC; how it stands; its note ({@link runNote}); `test` for a test run; the session it ran
 * in; and `detail`, a failed run's error text. */
export interface RunView {
  key: string;
  at: string;
  status: "running" | "succeeded" | "failed" | "missed" | "skipped";
  note: string;
  test?: true;
  sessionId?: string;
  detail?: string;
}

/** A routine as the page shows it: its store fields, its when line ({@link whenText}), its next slot (an enabled
 * routine's, when one falls in the lookahead) and its runs, newest first, at most {@link HISTORY_MAX}. */
export interface RoutineView {
  id: string;
  name: string;
  when: string;
  instruction: string;
  note?: string;
  enabled: boolean;
  sha256: string;
  confirmedAt: string;
  next?: { date: string; slot: string; at: string };
  runs: RunView[];
}

/** A proposal as the page shows it: its store fields, its when line ({@link whenText}), `replacesName` - the name of
 * the routine `replaces` names, while the store holds it -, `current` - confirmed, and the routine it made still held
 * at its version (`routine.proposal` is its id): false once that routine is deleted or replaced by a later one - and
 * `next`, a current proposal's routine's next slot as its {@link RoutineView} gives it, while that routine is on. */
export interface ProposalView {
  id: string;
  name: string;
  when: string;
  instruction: string;
  note?: string;
  replaces?: string;
  replacesName?: string;
  state: Proposal["state"];
  proposedAt: string;
  settledAt?: string;
  routine?: string;
  current: boolean;
  next?: { date: string; slot: string; at: string };
}

/** What the page reads: the store's load, its routines, every proposal it holds (newest first), the day's cap and the
 * routines' spend against it, the key of the run under way, and the keys queued. */
export interface RoutinesStatus {
  load: { ok: true } | { ok: false; error: string };
  routines: RoutineView[];
  proposals: ProposalView[];
  cap: { dailyTokens: number; used: number; spent: boolean };
  running?: string;
  queued: string[];
}

/** What the clock row reads of its world: a run's ({@link RunDeps}), whose `clock` is its one clock; `calendar`, the
 * US market calendar; `bootedAt`, when this run of the face began (the clock's now at install by default); `tickMs`,
 * {@link ROUTINE_TICK_MS} by default; `run`, src/routine-run.ts `runRoutine` by default. */
export interface RoutineClockDeps extends RunDeps {
  calendar: MarketCalendar;
  bootedAt?: number;
  tickMs?: number;
  run?: typeof runRoutine;
}

/** The clock row: a tick by hand, the status, a test run, the end. */
export interface RoutineClock {
  /** One tick, after any under way; never rejects. */
  tick(): Promise<void>;
  /** The routines, their next slots and their runs, as the page reads them; never rejects. */
  status(): Promise<RoutinesStatus>;
  /** A test run of `id`, queued at the front - or why not: the desk is paused, the cap is spent, no such routine. */
  test(id: string): Promise<"queued" | "paused" | "cap" | "unknown">;
  /** Stop ticking, empty the queue, abort the run under way; waits at most {@link DISPOSE_WAIT_MS} for it. */
  dispose(): Promise<void>;
}

/**
 * A run record's note, as the status table's client words it: codes, never English. A `finished` that `ended` is
 * its headline; any other end its outcome - `timed-out`, `no-answer`, `cancelled`, or `error` for a run that could not
 * run or whose model call failed; a `missed` its why (`asleep`, `down`, `late`, `busy`); a `skipped` its why
 * (`paused`, `cap`); an `interrupted` `interrupted`; a `started` nothing, and a `report` its headline.
 * @param record - a run record.
 */
export function runNote(record: RoutineRunRecord): string {
  switch (record.kind) {
    case "finished":
      if (record.outcome === "ended") return record.headline;
      return record.outcome === "failed" ? "error" : record.outcome;
    case "missed":
    case "skipped":
      return record.why;
    case "interrupted":
      return "interrupted";
    case "report":
      return record.headline;
    default:
      return "";
  }
}

/** The New York date a slot's or a test's key names: `r-1:2026-11-13:08:30` is the 13th, as is
 * `r-1:test:2026-11-14T03:00:00.000Z` (22:00 ET); any other key names none. */
export const dateOfKey = (key: string): string | undefined => {
  const slot = /^[^:]+:(\d{4}-\d{2}-\d{2}):\d{2}:\d{2}$/.exec(key);
  if (slot !== null) return slot[1];
  const test = /^[^:]+:test:(.+)$/.exec(key);
  const ms = test === null ? Number.NaN : Date.parse(test[1]!);
  return Number.isNaN(ms) ? undefined : etDate(new Date(ms));
};

/** The day's pruning: the settled keys and the refused keys of days before `today`. */
export function pruneBefore(settled: Map<string, string | undefined>, refused: Set<string>, today: string): void {
  for (const [key, date] of settled) if (date !== undefined && date < today) settled.delete(key);
  for (const key of refused) if ((dateOfKey(key) ?? today) < today) refused.delete(key);
}

/** A ledger line read back, or undefined for any line that is not a run record. */
function runRecordOf(line: string): RoutineRunRecord | undefined {
  if (line.trim() === "") return undefined;
  try {
    const x: unknown = JSON.parse(line);
    return isRunRecord(x) ? x : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What a rotation of the run ledger hands the new file, as written: the `started` and `missed` lines of `today`, and
 * the `finished`, `report` and `interrupted` lines of the keys those `started` lines carry - so the once-only append
 * still finds today's keys, and a restart after the rotation reads each carried run as it ended, not as interrupted.
 * @param rotated - the rotated file's text.
 * @param today - New York's date.
 */
export function carryToday(rotated: string, today: string): string[] {
  const lines = rotated.split("\n");
  const keys = new Set<string>();
  for (const line of lines) {
    const r = runRecordOf(line);
    if (r?.kind === "started" && r.date === today) keys.add(r.key);
  }
  return lines.filter((line) => {
    const r = runRecordOf(line);
    if (r === undefined) return false;
    if (r.kind === "started" || r.kind === "missed") return r.date === today;
    if (r.kind === "finished" || r.kind === "report" || r.kind === "interrupted") return keys.has(r.key);
    return false;
  });
}

/** A file read again only when its size or mtime moved. */
function cachedFile<T>(path: string, read: () => Promise<T>, empty: T): () => Promise<T> {
  let cached: { size: number; mtimeMs: number; value: T } | undefined;
  return async () => {
    let size: number;
    let mtimeMs: number;
    try {
      ({ size, mtimeMs } = await stat(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        cached = undefined;
        return empty;
      }
      throw err;
    }
    if (cached !== undefined && cached.size === size && cached.mtimeMs === mtimeMs) return cached.value;
    const value = await read();
    cached = { size, mtimeMs, value };
    return value;
  };
}

/** How much of the events file the spend reads at once. */
const SPEND_CHUNK_BYTES = 1 << 20;

/** The routines' own tokens in one `events.jsonl` line: the four buckets of a `desk-turn` of source `routine` stamped
 * at or after `since` (ISO); 0 for any other line, a torn one included. */
function lineSpend(line: string, since: string): number {
  if (line.trim() === "") return 0;
  let e: unknown;
  try {
    e = JSON.parse(line);
  } catch {
    return 0;
  }
  if (typeof e !== "object" || e === null) return 0;
  const { kind, source, t, usage } = e as Record<string, unknown>;
  if (kind !== "desk-turn" || source !== "routine" || typeof t !== "string" || t < since) return 0;
  const u = (typeof usage === "object" && usage !== null ? usage : {}) as Record<string, unknown>;
  const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return count(u.uncachedInputTokens) + count(u.outputTokens) + count(u.cacheReadTokens) + count(u.cacheWriteTokens);
}

/**
 * The routines' spend on the New York day of `now`, read from `path` (src/desk.ts {@link EVENTS_FILE}), which other
 * modules append to and which rotates: only the day's sum is kept, never the events. The file is read again only when
 * its size, mtime or inode moved, and then - when it only grew, on the same day - from the end of the last whole line
 * read; a file that shrank or is another file (a rotation) or a new New York day is read from its start. A half-written
 * last line is left for the next read. An absent file is no spend; any other failure rejects.
 */
function spendReader(path: string): (now: number) => Promise<number> {
  let kept: { nyDay: string; size: number; mtimeMs: number; ino: number; offset: number; used: number } | undefined;
  return async (now) => {
    let st: { size: number; mtimeMs: number; ino: number };
    try {
      st = await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        kept = undefined;
        return 0;
      }
      throw err;
    }
    const nyDay = etDate(new Date(now));
    if (kept !== undefined && kept.nyDay === nyDay && kept.size === st.size && kept.mtimeMs === st.mtimeMs && kept.ino === st.ino) return kept.used;
    const grew = kept !== undefined && kept.nyDay === nyDay && kept.ino === st.ino && st.size > kept.size;
    let offset = grew ? kept!.offset : 0;
    let used = grew ? kept!.used : 0;
    const since = iso(etDayStart(now));
    const file = await open(path, "r");
    try {
      /* the text in hand starts at `offset` in the file; the bytes after its last newline wait for the next chunk */
      let pending = Buffer.alloc(0);
      for (let at = offset; at < st.size;) {
        const chunk = Buffer.alloc(Math.min(SPEND_CHUNK_BYTES, st.size - at));
        const { bytesRead } = await file.read(chunk, 0, chunk.length, at);
        if (bytesRead === 0) break;
        at += bytesRead;
        const text = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
        const end = text.lastIndexOf(0x0a);
        if (end < 0) {
          pending = text;
          continue;
        }
        for (const line of text.subarray(0, end).toString("utf8").split("\n")) used += lineSpend(line, since);
        offset += end + 1;
        pending = text.subarray(end + 1);
      }
    } finally {
      await file.close();
    }
    kept = { nyDay, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, offset, used };
    return used;
  };
}

/**
 * Install the clock row (see the module header): its boot tick on the clock's next turn, then one every `tickMs`.
 * @param deps - see {@link RoutineClockDeps}.
 */
export function installRoutineClock(deps: RoutineClockDeps): RoutineClock {
  const { home, clock, calendar } = deps;
  const log = deps.log ?? defaultLog;
  const tickMs = deps.tickMs ?? ROUTINE_TICK_MS;
  const bootedAt = deps.bootedAt ?? clock.now();
  const run = deps.run ?? runRoutine;
  const ops = routineOps({ home, now: () => clock.now(), log });
  const ledgerOpts = { log, carry: (rotated: string) => carryToday(rotated, etDate(new Date(clock.now()))) };

  const readLedgerCached = cachedFile(join(deskDir(home), ROUTINES_LEDGER), async () => (await readRecords(home, ROUTINES_LEDGER, isRunRecord)).records, [] as RoutineRunRecord[]);
  const readSpend = spendReader(join(deskDir(home), EVENTS_FILE));

  /** One line per distinct failure of `what` until it recovers. */
  const failing = new Map<string, string>();
  const fail = (what: string, reason: string): void => {
    if (failing.get(what) === reason) return;
    failing.set(what, reason);
    try {
      log(`${BIN}: desk: routines ${what}: ${reason}`);
    } catch {
      /* a log that throws must not break the chain */
    }
  };
  const recover = (what: string): void => { failing.delete(what); };

  /* ---- what the ledger and this face know ---- */
  /** Each settled key - a `started` or a `missed` - with the date it names; earlier days are pruned at each tick. */
  const settled = new Map<string, string | undefined>();
  /** Keys the runner refused (the pause, the cap, an unwritten `started`): past the grace, settled, never missed. */
  const refused = new Set<string>();
  /** The routines whose `skipped`, `paused`, the pause in force already has. */
  const pausedNoted = new Set<string>();
  /** Each routine's New York date whose `skipped`, `cap`, is recorded. */
  const capNoted = new Map<string, string>();
  let ledgerRead = false;
  let lastTickAt: number | undefined;
  const queue: RunItem[] = [];
  let inHand: { key: string; started: boolean; abort?: AbortController } | undefined;
  let draining = false;
  let runner: Promise<void> = Promise.resolve();
  let disposed = false;

  const pending = (key: string): boolean => inHand?.key === key || queue.some((item) => item.key === key);
  const settle = (key: string): void => { settled.set(key, dateOfKey(key)); };
  const keyed = (kinds: RoutineRunRecord["kind"][], key: string) => (x: unknown): boolean =>
    isRunRecord(x) && kinds.includes(x.kind) && "key" in x && x.key === key;

  /** At boot: the ledger's keys, and one `interrupted` a `started` with no end. False when it cannot be read. */
  const readLedger = async (): Promise<boolean> => {
    let records: RoutineRunRecord[];
    try {
      records = (await readRecords(home, ROUTINES_LEDGER, isRunRecord)).records;
    } catch (err) {
      fail("ledger", `${ROUTINES_LEDGER} cannot be read (${(err as NodeJS.ErrnoException).code ?? errText(err)}); no routine runs until it can`);
      return false;
    }
    recover("ledger");
    const open = new Map<string, Extract<RoutineRunRecord, { kind: "started" }>>();
    for (const r of records) {
      if (r.kind === "started") {
        settle(r.key);
        open.set(r.key, r);
      } else if (r.kind === "missed") settle(r.key);
      else if (r.kind === "finished" || r.kind === "interrupted") open.delete(r.key);
    }
    for (const s of open.values()) {
      const record: RoutineRunRecord = { t: iso(clock.now()), kind: "interrupted", key: s.key, routine: s.routine, startedAt: s.t };
      await appendRecordOnce(home, ROUTINES_LEDGER, record, keyed(["interrupted", "finished"], s.key), ledgerOpts);
      log(`${BIN}: desk: routine run ${s.key} was cut off by the face's stop; it is not run again`);
    }
    ledgerRead = true;
    return true;
  };

  /** A slot found past its grace: why, recorded once. */
  const miss = async (routine: Routine, key: string, date: string, slot: string, at: number, now: number, since: number | undefined, why?: "busy"): Promise<void> => {
    const asleep = why === undefined && since !== undefined && now - since > ASLEEP_THRESHOLD_MS && since <= at ? { from: iso(since), to: iso(now) } : undefined;
    const record: RoutineRunRecord = {
      t: iso(now), kind: "missed", key, routine: routine.id, date, slot,
      why: why ?? (asleep !== undefined ? "asleep" : at < bootedAt ? "down" : "late"),
      ...(asleep === undefined ? {} : { asleep }), foundAt: iso(now),
    };
    const outcome = await appendRecordOnce(home, ROUTINES_LEDGER, record, keyed(["started", "missed"], key), ledgerOpts);
    if (outcome !== "failed") settle(key);
  };

  /** Whether the desk is paused now. */
  const paused = async (): Promise<boolean> => {
    const off = await readOffState(home, () => clock.now());
    return off.state !== undefined && !off.expired;
  };

  /** The day's cap and the routines' spend against it. */
  const capOf = async (dailyTokens: number, now: number): Promise<{ dailyTokens: number; used: number; spent: boolean }> => {
    let used = 0;
    try {
      used = await readSpend(now);
    } catch (err) {
      fail("budget", `the desk's events cannot be read (${(err as NodeJS.ErrnoException).code ?? errText(err)}); the cap counts nothing`);
    }
    return { dailyTokens, used, spent: used >= dailyTokens };
  };

  /* ---- the tick ---- */
  const runTick = async (): Promise<void> => {
    if (disposed) return;
    const now = clock.now();
    const since = lastTickAt;
    lastTickAt = now;
    try {
      await ops.sweep();
    } catch {
      /* an unreadable store is the load's to say */
    }
    const load = await loadRoutines(home);
    if (!load.ok) {
      fail("store", `${load.error}; no routine runs until it is fixed`);
      return;
    }
    recover("store");
    if (!ledgerRead && !(await readLedger())) return;
    if (!(await paused())) pausedNoted.clear();

    const today = etDate(new Date(now));
    pruneBefore(settled, refused, today);

    const enabled = load.store.routines.filter((r) => r.enabled);
    let trading = false;
    if (enabled.some((r) => r.schedule.days === "trading")) {
      const day = await calendar.today(now);
      if (day.ok) {
        recover("calendar");
        trading = day.session !== "closed";
      } else {
        fail("calendar", `the US calendar cannot answer for ${day.date} (${day.error}); trading-days routines are not due`);
      }
    }

    for (const routine of enabled) {
      /* a slot before the routine was confirmed, or before it was last switched on, passed while it could not run */
      const from = Math.max(Date.parse(routine.confirmedAt), routine.enabledAt === undefined ? -Infinity : Date.parse(routine.enabledAt));
      for (const { slot, at } of slotsOn(routine.schedule, today, trading)) {
        const key = `${routine.id}:${today}:${slot}`;
        if (settled.has(key) || now < at || at < from) continue;
        if (now - at <= SLOT_GRACE_MS) {
          if (!pending(key)) queue.push({ key, routine, date: today, slot, at });
        } else if (!pending(key) && !refused.has(key)) {
          await miss(routine, key, today, slot, at, now, since);
        }
      }
    }
    startRunner();
  };

  /** A tick after any under way. Never rejects: the chain must stay whole for the ticks after it. */
  let ticking: Promise<void> = Promise.resolve();
  const tickNow = (): Promise<void> => {
    const next = ticking
      .then(async () => {
        try {
          await runTick();
          recover("tick");
        } catch (err) {
          fail("tick", errText(err));
        }
      })
      .catch(() => {});
    ticking = next;
    return next;
  };

  /* ---- the timer: the boot on the clock's next turn, then a tick re-armed once each is done ---- */
  let timer: unknown;
  const arm = (): void => {
    if (disposed) return;
    timer = clock.setTimeout(() => {
      timer = undefined;
      return tickNow().then(arm);
    }, tickMs);
  };
  /* each callback returns its tick, re-armed, so a test clock can wait for it; it never rejects */
  timer = clock.setTimeout(() => {
    timer = undefined;
    return tickNow().then(arm);
  }, 0);

  /* ---- the runner ---- */

  /** One item, from the queue to its run's end. */
  const fire = async (item: RunItem): Promise<void> => {
    const now = clock.now();
    if (item.test !== true && now - item.at > SLOT_WAIT_MS) {
      await miss(item.routine, item.key, item.date, item.slot, item.at, now, undefined, "busy");
      return;
    }
    /* the routine as the store holds it now: gone, switched off or changed since it was queued, it does not run */
    const load = await loadRoutines(home);
    const routine = load.ok ? load.store.routines.find((r) => r.id === item.routine.id) : undefined;
    if (!load.ok || routine === undefined || routine.sha256 !== item.routine.sha256 || (!routine.enabled && item.test !== true)) return;

    if (await paused()) {
      refused.add(item.key);
      if (!pausedNoted.has(routine.id)) {
        pausedNoted.add(routine.id);
        await appendRecord(home, ROUTINES_LEDGER, { t: iso(clock.now()), kind: "skipped", routine: routine.id, why: "paused" } satisfies RoutineRunRecord, ledgerOpts);
      }
      return;
    }
    const today = etDate(new Date(clock.now()));
    if ((await capOf(load.store.budget.dailyTokens, clock.now())).spent) {
      refused.add(item.key);
      if (capNoted.get(routine.id) !== today) {
        capNoted.set(routine.id, today);
        await appendRecord(home, ROUTINES_LEDGER, { t: iso(clock.now()), kind: "skipped", routine: routine.id, why: "cap" } satisfies RoutineRunRecord, ledgerOpts);
      }
      return;
    }
    if (disposed) return;

    const record: RoutineRunRecord = {
      t: iso(clock.now()), kind: "started", key: item.key, routine: routine.id, name: routine.name, sha256: routine.sha256,
      date: item.date, slot: item.slot, at: iso(item.at), ...(item.test === true ? { test: true as const } : {}),
    };
    /* a key another face started or recorded missed is settled: this one does not start it */
    const outcome = await appendRecordOnce(home, ROUTINES_LEDGER, record, keyed(["started", "missed"], item.key), ledgerOpts);
    if (outcome === "failed") {
      refused.add(item.key);
      fail("ledger", `the started record of ${item.key} could not be written; it does not run`);
      return;
    }
    if (item.test !== true) settle(item.key); // a test's key is never a slot the tick walks
    if (outcome === "duplicate") {
      log(`${BIN}: desk: another face on this home started or missed routine run ${item.key}; this one does not run it`);
      return;
    }
    const abort = new AbortController();
    if (inHand !== undefined) {
      inHand.started = true;
      inHand.abort = abort;
    }
    if (disposed) abort.abort();
    await run(deps, { ...item, routine }, abort.signal);
  };

  /** Run the queue, one item at a time, until it is empty or the clock row is disposed. */
  const drain = async (): Promise<void> => {
    draining = true;
    try {
      for (let item = queue.shift(); item !== undefined && !disposed; item = queue.shift()) {
        inHand = { key: item.key, started: false };
        try {
          await fire(item);
        } catch (err) {
          fail("run", `${item.key}: ${errText(err)}`); // one label: the map never grows a key a run
        } finally {
          inHand = undefined;
        }
      }
    } finally {
      draining = false;
    }
  };
  const startRunner = (): void => {
    if (queue.length > 0 && !draining && !disposed) runner = drain();
  };

  /* ---- the status ---- */

  /** Whether the calendar's window holds a session on `date`; undefined outside it. */
  const isTrading = (date: string): boolean | undefined => {
    const window = calendar.window();
    if (window === undefined || date < window.from) return undefined;
    const last = new Date(Date.parse(`${window.from}T00:00:00Z`) + (window.days - 1) * 86_400_000).toISOString().slice(0, 10);
    if (date > last) return undefined;
    return window.sessions.some((s) => s.date === date);
  };

  /** Each routine's runs, newest first, at most {@link HISTORY_MAX}. */
  const runsOf = (records: readonly RoutineRunRecord[]): Map<string, RunView[]> => {
    const byRoutine = new Map<string, { view: RunView; order: number }[]>();
    const byKey = new Map<string, RunView>();
    const add = (routine: string, view: RunView, order: number): void => {
      const list = byRoutine.get(routine) ?? [];
      list.push({ view, order });
      byRoutine.set(routine, list);
    };
    records.forEach((r, order) => {
      switch (r.kind) {
        case "started": {
          const view: RunView = { key: r.key, at: r.at, status: "running", note: "", ...(r.test === true ? { test: true as const } : {}) };
          byKey.set(r.key, view);
          add(r.routine, view, order);
          break;
        }
        case "finished": {
          let view = byKey.get(r.key);
          if (view === undefined) {
            view = { key: r.key, at: r.t, status: "running", note: "", ...(r.test === true ? { test: true as const } : {}) };
            byKey.set(r.key, view);
            add(r.routine, view, order);
          }
          view.status = r.outcome === "ended" ? "succeeded" : "failed";
          view.note = runNote(r);
          if (r.sessionId !== undefined) view.sessionId = r.sessionId;
          if (r.error !== undefined && r.outcome !== "ended") view.detail = r.error;
          break;
        }
        case "interrupted": {
          const view = byKey.get(r.key);
          if (view !== undefined) {
            view.status = "failed";
            view.note = runNote(r);
          } else add(r.routine, { key: r.key, at: r.startedAt, status: "failed", note: runNote(r) }, order);
          break;
        }
        case "missed": {
          const at = nyInstant(r.date, r.slot);
          add(r.routine, { key: r.key, at: at === undefined ? r.foundAt : iso(at), status: "missed", note: runNote(r) }, order);
          break;
        }
        case "skipped":
          add(r.routine, { key: `${r.routine}:skipped:${r.t}`, at: r.t, status: "skipped", note: runNote(r) }, order);
          break;
        default:
          break;
      }
    });
    /* a started with no end that is not the run in hand was cut off: the boot's ledger read records it so */
    for (const view of byKey.values()) {
      if (view.status === "running" && view.key !== inHand?.key) {
        view.status = "failed";
        view.note = "interrupted";
      }
    }
    const out = new Map<string, RunView[]>();
    for (const [routine, list] of byRoutine) {
      list.sort((a, b) => (a.view.at < b.view.at ? 1 : a.view.at > b.view.at ? -1 : b.order - a.order));
      out.set(routine, list.slice(0, HISTORY_MAX).map((x) => x.view));
    }
    return out;
  };

  const status = async (): Promise<RoutinesStatus> => {
    const now = clock.now();
    const load: StoreLoad = await loadRoutines(home).catch((err: unknown) => ({ ok: false as const, error: errText(err) }));
    let records: RoutineRunRecord[] = [];
    try {
      records = await readLedgerCached();
    } catch (err) {
      fail("status", `${ROUTINES_LEDGER} cannot be read (${(err as NodeJS.ErrnoException).code ?? errText(err)})`);
    }
    const runs = runsOf(records);
    const routines: RoutineView[] = load.ok
      ? load.store.routines.map((r) => {
        const next = r.enabled ? nextRun(r.schedule, now, isTrading) : undefined;
        return {
          id: r.id, name: r.name, when: whenText(r.schedule), instruction: r.instruction, ...(r.note === undefined ? {} : { note: r.note }),
          enabled: r.enabled, sha256: r.sha256, confirmedAt: r.confirmedAt,
          ...(next === undefined ? {} : { next: { date: next.date, slot: next.slot, at: iso(next.at) } }),
          runs: runs.get(r.id) ?? [],
        };
      })
      : [];
    const cap = await capOf(load.ok ? load.store.budget.dailyTokens : DAILY_TOKENS_DEFAULT, now);
    return {
      load: load.ok ? { ok: true } : { ok: false, error: load.error },
      routines,
      proposals: load.ok ? proposalViews(load.store, routines) : [],
      cap,
      ...(inHand?.started === true ? { running: inHand.key } : {}),
      queued: queue.map((item) => item.key),
    };
  };

  /* ---- a test run ---- */

  const test = async (id: string): Promise<"queued" | "paused" | "cap" | "unknown"> => {
    const load = await loadRoutines(home);
    const routine = load.ok ? load.store.routines.find((r) => r.id === id) : undefined;
    if (!load.ok || routine === undefined || disposed) return "unknown";
    if (await paused()) return "paused";
    const now = clock.now();
    if ((await capOf(load.store.budget.dailyTokens, now)).spent) return "cap";
    const d = new Date(now);
    queue.unshift({ key: `${id}:test:${iso(now)}`, routine, date: etDate(d), slot: etTime(d).slice(0, 5), at: now, test: true });
    startRunner();
    return "queued";
  };

  /* ---- the end ---- */
  let disposing: Promise<void> | undefined;

  return {
    tick: tickNow,
    status,
    test,
    dispose() {
      disposing ??= (async () => {
        disposed = true;
        if (timer !== undefined) {
          clock.clearTimeout(timer);
          timer = undefined;
        }
        queue.length = 0;
        inHand?.abort?.abort();
        let wait: unknown;
        await Promise.race([
          Promise.all([runner, ticking]),
          new Promise<void>((done) => { wait = clock.setTimeout(done, DISPOSE_WAIT_MS); }),
        ]);
        clock.clearTimeout(wait);
      })();
      return disposing;
    },
  };
}
