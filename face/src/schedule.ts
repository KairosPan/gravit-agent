// face/src/schedule.ts
/** The clock row: what fires the operator's standing orders on the exchange calendar, unattended
 * (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md §5.9; rulings P2-1, P2-9, P2-10, P2-11, P2-21,
 * P2-22, P2-23; the P2 plan's rulings 1, 5, 6 and 15). One firing - its checks, its producer, its turn, its message -
 * is src/firing.ts's; this module decides when, and keeps each firing's key.
 *
 * THE TICK, every {@link SCHEDULE_TICK_MS} on the injected clock - a timer re-armed once a tick is done, so a Mac that
 * slept wakes to one tick, never a burst - compares the clock with absolute UTC anchors, in this order:
 * - `standing.yml` is read again when its size, mtime or inode moved. A load it refuses - `not armed` among the
 *   reasons, and a file the face cannot read - stops every order until it is fixed: one `standing-error` event and
 *   one phone line per distinct refusal; the last good load's orders stay in the status, its budget cap the day's.
 * - The firing ledger is read once, for the keys it holds and the firings a restart cut off; one it cannot read
 *   stops every firing, one `standing-error` event and one line per distinct reason, and is read again each tick.
 * - With an enabled, unexpired order, the market calendar answers for today's New York date (src/market-clock.ts);
 *   a date it cannot answer is one `calendar-error` event and one line, and no anchored order fires until it can.
 * - Each order, in file order: a disabled one is skipped; one past its `expires` is one `expired` record and line per
 *   expiry; a closed day is silent; else {@link decide} says whether today's anchor is due, missed or settled. A
 *   missed anchor says why: the face asleep across it (a gap between two ticks over the sleep watch's threshold),
 *   not running when it came, or finding it late.
 *
 * THE KEY. A firing's key, `<id>:<session date>`, is consumed only by its `started` record, appended through
 * src/desk.ts `appendRecordOnce` under the ledger's lock (P2-23): of two faces on one home, one runs it. A refusal
 * consumes nothing - a rearm or a resume inside the grace fires that day - and a key whose grace passes refused is
 * settled, never missed. A `started` with no end at boot was cut off: one `interrupted` record and line, never run
 * again. Earlier days are never back-filled. A rotation of the ledger hands the day's `started` lines to the new file,
 * which is the only one the once-only append reads.
 *
 * THE RUNNER takes one firing at a time, in queue order - a queued one runs even past its grace (P2-11) - and for
 * each: the order looked up again in the last load; src/firing.ts `checkFiring`, whose refusal is recorded once per
 * key and phoned as {@link refusalLine} says; the `started`; then `runFiring`.
 *
 * FAILURES never reach the face (P2-21): a tick, the reload, the calendar, the budget's note - each is caught, one
 * `gravit-face: desk: schedule <what>: <reason>` line per distinct failure, and the next tick is armed regardless.
 *
 * MODULE WEIGHT. This module brings src/firing.ts (src/desk-session.ts, the desk preset, dsh-agent), src/standing.ts
 * (js-yaml), src/brief.ts and src/market-clock.ts: src/desk.ts loads it on first use, so the pause switch never does.
 * @module
 */
import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { briefProducer } from "./brief.ts";
import {
  appendEvent, appendRecord, appendRecordOnce, ASLEEP_THRESHOLD_MS, deskDir, FIRINGS_FILE, noteBudgetSpent, readBudget, readRecords,
  type BudgetState,
} from "./desk.ts";
import type { DeliverResult } from "./desk-conversation.ts";
import { createDeskAgent, type DeskClock, type DeskSessionDeps, type SessionEventsOn } from "./desk-session.ts";
import { etDate } from "./et.ts";
import {
  checkFiring, firingKey, isFiringRecord, LINES, outcomeOf, resolveFiringRoute, runFiring,
  type ExpiredRecord, type FiringDeps, type FiringItem, type FiringRecord, type InterruptedRecord, type MissedRecord, type Refusal,
  type RefusedRecord, type StartedRecord, type Verified,
} from "./firing.ts";
import { createMarketCalendar, pythonMarketClock, sessionFor, type DayAnswer, type MarketCalendar, type MarketSession } from "./market-clock.ts";
import { defaultProducerRunner, formatProducer } from "./producer.ts";
import type { QuoteHub } from "./quotes.ts";
import { anchorInstant, GRACE_MS, parseStanding, STANDING_FILE, type FiringSummary, type StandingOrder, type StandingStatus } from "./standing.ts";

/** Diagnostic label, the one every `${BIN}:`-prefixed line in the face uses; desk lines add `desk:`. */
const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): unknown => (err as { code?: unknown } | null | undefined)?.code;
/** A failure as a line names it: its code when it has one (`EISDIR`), else its message. */
const reasonOf = (err: unknown): string => {
  const code = codeOf(err);
  return typeof code === "string" ? code : errText(err);
};
/** Whether a failure says the path is not there: ENOENT, or ENOTDIR - a file where a directory should be. */
const isAbsent = (err: unknown): boolean => codeOf(err) === "ENOENT" || codeOf(err) === "ENOTDIR";
/** Where the clock row's lines go unless its owner passes `log`: stderr, as the desk's others do. */
const defaultLog = (line: string): void => { console.error(line); };
const iso = (ms: number): string => new Date(ms).toISOString();

/** How often the clock row ticks (the plan's ruling 1): a firing starts at most this long after its anchor. */
export const SCHEDULE_TICK_MS = 30_000;
/** The longest {@link ScheduleHandle.dispose} waits for the firing it aborted and the tick under way. */
const DISPOSE_WAIT_MS = 2_000;
/** The most firings the status lists as recent. */
const RECENT_MAX = 10;

/* ---------- deciding ---------- */

/**
 * What a tick does with one order's anchor today (rulings P2-9, P2-11; the plan's rulings 5 and 6): `settled` once
 * its key has a `started` or a `missed`; `wait` before the anchor; `settled` when the anchor came before the order
 * was armed - neither fired nor missed; inside the grace (the anchor to `graceMs` past it, inclusive) `due`, unless
 * it is already queued or running; past the grace `settled` when it was refused - a refusal is no miss - or is still
 * queued or running - queued in time, it runs late - else `missed`.
 * @param input - the anchor's instant, now and the grace, in ms; `armedFromMs`, the order's `armedAt`; and what the
 *   key holds: a `started`, a `missed`, a refusal, a place in the queue or the run (`pending`).
 */
export function decide(input: {
  anchorMs: number;
  nowMs: number;
  graceMs: number;
  armedFromMs: number;
  started: boolean;
  missed: boolean;
  refused: boolean;
  pending: boolean;
}): "wait" | "due" | "missed" | "settled" {
  if (input.started || input.missed) return "settled";
  if (input.nowMs < input.anchorMs) return "wait";
  if (input.anchorMs < input.armedFromMs) return "settled";
  if (input.nowMs - input.anchorMs <= input.graceMs) return input.pending ? "settled" : "due";
  return input.refused || input.pending ? "settled" : "missed";
}

/* ---------- the schedule ---------- */

/** What the clock row reads of its world: a firing's ({@link FiringDeps}), whose `clock` is its one clock - every
 * tick, every record's `t`, the budget's and the pause's now - and `bootedAt`, when this run began (the clock's now at
 * install by default); `calendar`, the market calendar; `tickMs` and `graceMs`, {@link SCHEDULE_TICK_MS} and
 * src/standing.ts `GRACE_MS` by default; `firing`, the checks and the run (src/firing.ts's, by default). */
export interface ScheduleDeps extends FiringDeps {
  bootedAt?: number;
  calendar: MarketCalendar;
  tickMs?: number;
  graceMs?: number;
  firing?: { check: typeof checkFiring; run: typeof runFiring };
}

/** The clock row as its owner holds it: `tick` runs a tick now, after any under way, and never rejects; `status`
 * says what it knows, from memory; `dailyTokens` is the last good load's cap; `dispose` stops it. */
export interface ScheduleHandle {
  tick(): Promise<void>;
  status(): StandingStatus;
  dailyTokens(): number | undefined;
  dispose(): Promise<void>;
}

/** A pin's state against the file on disk, as the status shows it. */
type HashState = StandingStatus["orders"][number]["hash"];

/** Whether a line of the firing ledger, its object, is a record of `kind` for `key`. */
const recordOf = (kind: FiringRecord["kind"], key: string) => (x: unknown): boolean => isFiringRecord(x) && x.kind === kind && x.key === key;

/** A line of the firing ledger as a record, or `undefined`: not JSON, or not a record. */
function lineRecord(line: string): FiringRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isFiringRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A record as the status lists it - a firing's end, a refusal, a miss, a cut-off, an expiry - or `undefined` for the
 * steps between and for a line the ledger holds that is no such record (the ledger is a file the operator may edit). */
function summaryOf(r: FiringRecord): FiringSummary | undefined {
  if (r.kind !== "finished" && r.kind !== "refused" && r.kind !== "missed" && r.kind !== "interrupted" && r.kind !== "expired") return undefined;
  if (typeof r.key !== "string" || typeof r.order !== "string" || typeof r.date !== "string") return undefined;
  let outcome: string;
  try {
    outcome = outcomeOf(r);
  } catch {
    return undefined;
  }
  const base: FiringSummary = { key: r.key, order: r.order, date: r.date, kind: r.kind, outcome, t: r.t };
  if (r.kind !== "finished") return base;
  const turn = typeof r.turn === "object" && r.turn !== null ? r.turn : undefined;
  return {
    ...base,
    ...(typeof turn?.sessionId === "string" ? { sessionId: turn.sessionId } : {}),
    ...(typeof r.wallMs === "number" ? { wallMs: r.wallMs } : {}),
    ...(turn?.usage === undefined ? {} : { usage: turn.usage }),
    ...(Array.isArray(r.files) ? { files: r.files.length } : {}),
  };
}

/** The phone's line for a day the calendar cannot answer: src/firing.ts `LINES.noCalendar` - its FACE_PYTHON hint
 * only for an interpreter without pandas_market_calendars (P2 Task 8's ruling 2); any other error, the line without it. */
function noCalendarLine(python: string, error: string): string {
  return /is not importable in /.test(error) ? LINES.noCalendar(python, error) : `no standing order runs today: the market calendar failed in ${python} (${error})`;
}

/** The repo-relative form of `cwd`, `/`-joined: `desk/journal`, `strategies/<name>`. */
const repoRelative = (root: string, cwd: string): string => relative(resolve(root), resolve(cwd)).split(sep).join("/");

/** An order's script producer, as its refusal names it. */
const scriptOf = (order: StandingOrder): string => (order.producer === undefined ? "its producer" : order.producer.kind === "script" ? order.producer.script : formatProducer(order.producer));

/**
 * Start the clock row over `deps` (see the module header). Nothing runs at the call: the boot - the first tick, whose
 * read of the firing ledger reports the firings a restart cut off - comes on the clock's next timer turn, and each tick
 * arms the next once it is done. Never throws into the face, and nothing it starts rejects.
 * @param deps - see {@link ScheduleDeps}.
 */
export function installSchedule(deps: ScheduleDeps): ScheduleHandle {
  const { home, clock } = deps;
  const log = deps.log ?? defaultLog;
  const tickMs = deps.tickMs ?? SCHEDULE_TICK_MS;
  const graceMs = deps.graceMs ?? GRACE_MS;
  const bootedAt = deps.bootedAt ?? clock.now();
  const firing = deps.firing ?? { check: checkFiring, run: runFiring };
  const standingPath = join(deskDir(home), STANDING_FILE);
  const ledgerPath = join(deskDir(home), FIRINGS_FILE);
  let disposed = false;

  /* ---- one line per distinct failure ---- */
  const failing = new Map<string, string>();
  const fail = (what: string, err: unknown): void => {
    const reason = errText(err);
    if (failing.get(what) === reason) return;
    failing.set(what, reason);
    log(`${BIN}: desk: schedule ${what}: ${reason}`);
  };
  const recover = (what: string): void => { failing.delete(what); };

  /** Send a line through `deliver`, which never rejects; one that does is one face line. */
  const send = async (text: string): Promise<void> => {
    try {
      await deps.deliver(text);
    } catch (err) {
      log(`${BIN}: desk: a standing order's line could not be sent: ${errText(err)}`);
    }
  };

  /** The firing ledger's appends: a rotation hands the new file today's `started` lines, as written, so the once-only
   * append - which reads the current file alone - still finds today's keys (P2 Task 8's ruling 5). */
  const ledgerOpts = {
    log,
    carry: (rotated: string): string[] => {
      const today = etDate(new Date(clock.now()));
      return rotated.split("\n").filter((line) => {
        const r = lineRecord(line);
        return r?.kind === "started" && r.date === today;
      });
    },
  };

  /* ---- what the ledger and this face know, by key and by order ---- */
  const started = new Set<string>();
  const missed = new Set<string>();
  /** Each key's last refusal. */
  const refusals = new Map<string, { reason: Refusal["reason"]; detail?: string }>();
  /** Each order's last phoned detail of a `hash` or a `producer-hash` refusal, by `<order> <reason>`. */
  const phonedDetail = new Map<string, string>();
  /** The `expired` records' keys, `<id>:<expires>`: one each. */
  const expiries = new Set<string>();
  /** The latest instant each order was found expired: a later anchor today is settled by it (P2 Task 8's ruling 4). */
  const expiredAt = new Map<string, number>();
  const lastOf = new Map<string, FiringSummary>();
  let recent: FiringSummary[] = [];
  /** Each order's pins as its last check found them, and the pins it checked. */
  const checked = new Map<string, { sha256: string; producerSha256?: string; hash: HashState; producerHash?: HashState }>();

  /** Fold a record into what the clock row knows - from the ledger at its read, or as this face writes it. */
  const note = (r: FiringRecord): void => {
    if (typeof r.key !== "string") return;
    switch (r.kind) {
      case "started":
        started.add(r.key);
        break;
      case "missed":
        missed.add(r.key);
        break;
      case "refused":
        refusals.set(r.key, { reason: r.reason, ...(r.detail === undefined ? {} : { detail: r.detail }) });
        if (r.reported === true && (r.reason === "hash" || r.reason === "producer-hash") && typeof r.detail === "string") {
          phonedDetail.set(`${r.order} ${r.reason}`, r.detail);
        }
        break;
      case "expired": {
        expiries.add(r.key);
        const at = Date.parse(r.t);
        if (Number.isFinite(at) && at > (expiredAt.get(r.order) ?? -Infinity)) expiredAt.set(r.order, at);
        break;
      }
      default:
        break;
    }
    const summary = summaryOf(r);
    if (summary === undefined) return;
    lastOf.set(summary.order, summary);
    recent = [summary, ...recent].slice(0, RECENT_MAX);
  };

  /* ---- standing.yml ---- */
  /** The file as last read - its size, mtime and inode, or `missing` - and the state of that read. */
  let signature: string | undefined;
  let fileState: StandingStatus["file"]["state"] = "missing";
  let loadedAt: string | undefined;
  let refused: string[] | undefined;
  /** The refusal last phoned, its errors joined; cleared by a good load, so a new break is phoned again. */
  let phonedRefusal: string | undefined;
  /** The last good load. */
  let orders: StandingOrder[] = [];
  let cap: number | undefined;

  const refuse = async (errors: string[], now: number): Promise<void> => {
    fileState = "refused";
    refused = errors;
    const joined = errors.join("\n");
    if (phonedRefusal === joined) return;
    phonedRefusal = joined;
    await appendEvent(home, { t: iso(now), kind: "standing-error", errors }, { log });
    await send(LINES.standingRefused(errors));
  };

  /** A file the face cannot stat or read: refused like one it cannot parse, and read whole at the next tick that can,
   * moved or not. */
  const unreadable = async (err: unknown, now: number): Promise<void> => {
    fail("reload", err);
    signature = undefined;
    await refuse([`${STANDING_FILE} cannot be read (${reasonOf(err)})`], now);
  };

  /** `standing.yml` read again when it moved. */
  const reload = async (now: number): Promise<void> => {
    let next = "missing";
    try {
      const info = await stat(standingPath);
      next = `${info.size}:${info.mtimeMs}:${info.ino}`;
    } catch (err) {
      if (!isAbsent(err)) {
        await unreadable(err, now);
        return;
      }
    }
    if (next === signature) return;
    let text = "";
    if (next !== "missing") {
      try {
        text = await readFile(standingPath, "utf8");
      } catch (err) {
        if (!isAbsent(err)) {
          await unreadable(err, now);
          return;
        }
        next = "missing";
      }
    }
    recover("reload");
    signature = next;
    const load = parseStanding(text);
    if (!load.ok) {
      await refuse(load.errors, now);
      return;
    }
    orders = load.orders;
    cap = load.budget?.dailyTokens;
    fileState = next === "missing" ? "missing" : "loaded";
    loadedAt = next === "missing" ? undefined : iso(now);
    refused = undefined;
    phonedRefusal = undefined;
  };

  /* ---- the firing ledger ---- */
  let ledgerRead = false;
  let ledgerError: string | undefined;
  let phonedLedger: string | undefined;

  /** The ledger read - every key it holds, every firing a restart cut off - or `false`, with its line once per
   * distinct reason, when it cannot be: then nothing fires until it can. */
  const readLedger = async (now: number): Promise<boolean> => {
    let records: FiringRecord[];
    try {
      records = (await readRecords(home, FIRINGS_FILE, isFiringRecord)).records;
    } catch (err) {
      const code = reasonOf(err);
      ledgerError = code;
      if (phonedLedger !== code) {
        phonedLedger = code;
        await appendEvent(home, { t: iso(now), kind: "standing-error", errors: [`${ledgerPath} cannot be read (${code})`] }, { log });
        await send(LINES.ledgerUnreadable(ledgerPath, code));
      }
      return false;
    }
    ledgerRead = true;
    ledgerError = undefined;
    for (const r of records) note(r);
    const ended = new Set(records.flatMap((r) => (r.kind === "finished" || r.kind === "interrupted") && typeof r.key === "string" ? [r.key] : []));
    for (const r of records) {
      if (r.kind !== "started" || typeof r.key !== "string" || typeof r.order !== "string" || typeof r.date !== "string" || ended.has(r.key)) continue;
      ended.add(r.key);
      const record: InterruptedRecord = { t: iso(now), kind: "interrupted", key: r.key, order: r.order, date: r.date, startedAt: r.t };
      const outcome = await appendRecordOnce(home, FIRINGS_FILE, record, recordOf("interrupted", r.key), ledgerOpts);
      note(record);
      if (outcome !== "duplicate") await send(LINES.interrupted(r.order, r.date));
    }
    return true;
  };

  /* ---- the calendar ---- */
  /** This face's last answer from the calendar. */
  let answer: DayAnswer | undefined;
  /** The dates whose failure was phoned. */
  const calendarPhoned = new Set<string>();

  const askCalendar = async (now: number): Promise<DayAnswer | undefined> => {
    let got: DayAnswer;
    try {
      got = await deps.calendar.today(now);
    } catch (err) {
      fail("calendar", err);
      return undefined;
    }
    recover("calendar");
    answer = got;
    if (!got.ok && !calendarPhoned.has(got.date)) {
      calendarPhoned.add(got.date);
      await appendEvent(home, { t: iso(now), kind: "calendar-error", date: got.date, python: deps.calendar.python, error: got.error }, { log });
      await send(noCalendarLine(deps.calendar.python, got.error));
    }
    return got;
  };

  /* ---- the runner's queue ---- */
  const queue: FiringItem[] = [];
  /** The firing the runner holds: being checked, then - once its `started` is written - running. */
  let inHand: { key: string; started?: { at: string; abort: AbortController; sessionId?: string } } | undefined;
  let draining = false;
  let runner: Promise<void> = Promise.resolve();
  const pending = (key: string): boolean => inHand?.key === key || queue.some((item) => item.key === key);

  /* ---- a tick's records ---- */

  /** An order past its `expires`: noted as found expired now, and recorded and phoned once per expiry. */
  const expire = async (order: StandingOrder, now: number): Promise<void> => {
    expiredAt.set(order.id, now);
    const key = firingKey(order.id, order.expires);
    if (expiries.has(key)) return;
    const record: ExpiredRecord = { t: iso(now), kind: "expired", key, order: order.id, date: order.expires, expires: order.expires };
    const outcome = await appendRecordOnce(home, FIRINGS_FILE, record, recordOf("expired", key), ledgerOpts);
    note(record);
    if (outcome !== "duplicate") await send(LINES.expired(order.id, order.expires));
  };

  /** An anchor found past its grace: why, recorded and phoned once. */
  const miss = async (order: StandingOrder, key: string, date: string, anchorMs: number, now: number, since: number | undefined): Promise<void> => {
    const asleep = since !== undefined && now - since > ASLEEP_THRESHOLD_MS && since <= anchorMs ? { from: iso(since), to: iso(now) } : undefined;
    const record: MissedRecord = {
      t: iso(now), kind: "missed", key, order: order.id, date, anchor: iso(anchorMs),
      why: asleep !== undefined ? "asleep" : anchorMs < bootedAt ? "down" : "late",
      ...(asleep === undefined ? {} : { asleep }), foundAt: iso(now),
    };
    const outcome = await appendRecordOnce(home, FIRINGS_FILE, record, recordOf("missed", key), ledgerOpts);
    note(record);
    if (outcome !== "duplicate") await send(LINES.missed(record));
  };

  /** One order on one session: queued when due, recorded when missed. */
  const weigh = async (order: StandingOrder, session: MarketSession, now: number, since: number | undefined): Promise<void> => {
    const anchorMs = anchorInstant(order.anchor, session);
    const key = firingKey(order.id, session.date);
    /* found expired at or after this anchor: the order was not in force for it, whatever a later rearm says */
    if ((expiredAt.get(order.id) ?? -Infinity) >= anchorMs) return;
    const verdict = decide({
      anchorMs, nowMs: now, graceMs, armedFromMs: Date.parse(order.armedAt),
      started: started.has(key), missed: missed.has(key), refused: refusals.has(key), pending: pending(key),
    });
    if (verdict === "due") queue.push({ key, order, date: session.date, session, anchorMs });
    else if (verdict === "missed") await miss(order, key, session.date, anchorMs, now, since);
  };

  /* ---- the tick ---- */
  let lastTickAt: number | undefined;

  const runTick = async (): Promise<void> => {
    if (disposed) return;
    const now = clock.now();
    const since = lastTickAt;
    lastTickAt = now;
    await reload(now);
    if (!ledgerRead && !(await readLedger(now))) return;
    if (fileState === "refused") return;
    const today = etDate(new Date(now));
    const day = orders.some((order) => order.enabled && today <= order.expires) ? await askCalendar(now) : undefined;
    for (const order of orders) {
      if (!order.enabled) continue;
      if (today > order.expires) {
        await expire(order, now);
        continue;
      }
      if (day === undefined || !day.ok || day.session === "closed") continue;
      await weigh(order, day.session, now, since);
    }
    if (queue.length > 0 && !draining && !disposed) runner = drain();
  };

  /** A tick after any under way, its failure one line as `what` - the boot's, or a tick's. Never rejects, a `log`
   * that throws included: the chain must stay whole for the ticks after it. */
  let ticking: Promise<void> = Promise.resolve();
  const tickAs = (what: "boot" | "tick"): Promise<void> => {
    const next = ticking
      .then(async () => {
        try {
          await runTick();
          recover(what);
        } catch (err) {
          fail(what, err);
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
    try {
      timer = clock.setTimeout(() => {
        timer = undefined;
        return tickAs("tick").then(arm);
      }, tickMs);
    } catch (err) {
      fail("tick", err);
    }
  };
  /* Each timer's callback returns its tick, re-armed, so a test clock can wait for it before it looks for the next
   * timer; the face's timers drop it, and it never rejects. */
  timer = clock.setTimeout(() => {
    timer = undefined;
    return tickAs("boot").then(arm);
  }, 0);

  /* ---- the runner ---- */

  /** The deps a firing runs on: the clock row's, its session's id noted as the run makes it. */
  const runDeps = (key: string): FiringDeps => ({
    ...deps,
    createAgent: async (opts) => {
      const made = await deps.createAgent(opts);
      if (inHand?.key === key && inHand.started !== undefined) inHand.started.sessionId = made.sessionId;
      return made;
    },
  });

  /** A check's pins, kept with the pins it checked, for the status. A pause or a budget refuses before any pin is read. */
  const notePins = (order: StandingOrder, verdict: { refuse: Refusal } | { go: Verified }): void => {
    const script = order.producer?.kind === "script";
    const state = (detail: string): HashState => (detail === "missing" ? "missing" : "changed");
    let hash: HashState;
    let producerHash: HashState | undefined;
    if ("go" in verdict) {
      hash = "ok";
      producerHash = script ? "ok" : undefined;
    } else {
      const refusal = verdict.refuse;
      if (refusal.reason === "off" || refusal.reason === "budget") return;
      if (refusal.reason === "hash") {
        hash = state(refusal.detail);
        producerHash = script ? "unknown" : undefined;
      } else if (refusal.reason === "producer-hash") {
        hash = "ok";
        producerHash = state(refusal.detail);
      } else {
        hash = "ok";
        producerHash = script ? "ok" : undefined;
      }
    }
    checked.set(order.id, {
      sha256: order.sha256,
      ...(order.producerSha256 === undefined ? {} : { producerSha256: order.producerSha256 }),
      hash,
      ...(producerHash === undefined ? {} : { producerHash }),
    });
  };

  /** Whether the day's budget note was written now - so its line goes out - or could not be, which says nothing of the
   * day's note, so the line goes out too. */
  const budgetNoted = async (state: BudgetState, now: number): Promise<boolean> => {
    try {
      const noted = await noteBudgetSpent(home, now, state, { log });
      recover("budget");
      return noted;
    } catch (err) {
      fail("budget", err);
      return true;
    }
  };

  /** The phone's line for a refusal recorded now, or `undefined`: `off` never; `budget` with the day's note; `hash`
   * and `producer-hash` when the order's last phoned detail for that reason differs; `fence` always. */
  const refusalLine = async (item: FiringItem, refusal: Refusal, now: number): Promise<string | undefined> => {
    const { order, date } = item;
    switch (refusal.reason) {
      case "off":
        return undefined;
      case "budget":
        return (await budgetNoted(refusal.state, now)) ? LINES.budgetSpent(refusal.state) : undefined;
      case "hash":
      case "producer-hash": {
        const told = `${order.id} ${refusal.reason}`;
        if (phonedDetail.get(told) === refusal.detail) return undefined;
        const path = refusal.reason === "hash" ? `${order.dir}/${order.file}` : scriptOf(order);
        return refusal.detail === "missing" ? LINES.missing(order.id, date, path) : LINES.changed(order.id, date, path);
      }
      case "fence":
        return LINES.fence(order.id, date, refusal.detail);
    }
  };

  /** A refusal, recorded only when it differs from the key's last, with its line when it has one. */
  const refuseFiring = async (item: FiringItem, refusal: Refusal, now: number): Promise<void> => {
    const detail = "detail" in refusal ? refusal.detail : undefined;
    const last = refusals.get(item.key);
    if (last !== undefined && last.reason === refusal.reason && last.detail === detail) return;
    const line = await refusalLine(item, refusal, now);
    const record: RefusedRecord = {
      t: iso(now), kind: "refused", key: item.key, order: item.order.id, date: item.date, reason: refusal.reason,
      ...(detail === undefined ? {} : { detail }), reported: line !== undefined,
    };
    note(record);
    if (line !== undefined) await send(line);
    await appendRecord(home, FIRINGS_FILE, record, ledgerOpts);
  };

  /** One firing, from the queue to its end, on the order as last loaded - dropped, with a line, when the load is
   * refused or no longer holds it enabled. */
  const fire = async (queued: FiringItem): Promise<void> => {
    const order = fileState === "refused" ? undefined : orders.find((o) => o.id === queued.order.id);
    if (order === undefined || !order.enabled) {
      const why = fileState === "refused" ? `${STANDING_FILE} is refused` : order === undefined ? `it is no longer in ${STANDING_FILE}` : "it is disabled";
      log(`${BIN}: desk: standing order ${queued.key} is dropped: ${why}`);
      return;
    }
    const item: FiringItem = { ...queued, order };
    const verdict = await firing.check(deps, order);
    notePins(order, verdict);
    if ("refuse" in verdict) {
      await refuseFiring(item, verdict.refuse, clock.now());
      return;
    }
    if (disposed) return;
    const at = clock.now();
    const record: StartedRecord = {
      t: iso(at), kind: "started", key: item.key, order: order.id, date: item.date, dir: order.dir, cwd: repoRelative(deps.root, verdict.go.cwd),
      at: order.at, anchor: iso(item.anchorMs), standingSha: verdict.go.standingSha,
      ...(order.producer === undefined ? {} : { producer: formatProducer(order.producer) }),
      ...(verdict.go.producerSha === undefined ? {} : { producerSha: verdict.go.producerSha }),
      wake: order.wake, deadlineMs: order.turnDeadlineMs,
    };
    const outcome = await appendRecordOnce(home, FIRINGS_FILE, record, recordOf("started", item.key), ledgerOpts);
    if (outcome === "failed") return; // the ledger's line says why; the next tick inside the grace asks again
    started.add(item.key);
    if (outcome === "duplicate") {
      log(`${BIN}: desk: another face on this home started ${item.key}; this one does not run it`);
      return;
    }
    const abort = new AbortController();
    if (inHand?.key === item.key) inHand.started = { at: record.t, abort };
    if (disposed) abort.abort();
    const finished = await firing.run(runDeps(item.key), item, verdict.go, abort.signal);
    if (finished !== undefined) note(finished);
  };

  /** Run the queue, one firing at a time, until it is empty or the clock row is disposed. */
  const drain = async (): Promise<void> => {
    draining = true;
    try {
      for (let item = queue.shift(); item !== undefined && !disposed; item = queue.shift()) {
        inHand = { key: item.key };
        try {
          await fire(item);
        } catch (err) {
          log(`${BIN}: desk: standing order ${item.key} failed: ${errText(err)}`);
        } finally {
          inHand = undefined;
        }
      }
    } finally {
      draining = false;
    }
  };

  /* ---- the status ---- */

  /** Today's anchor while it is ahead and unsettled, else the first later session's in the calendar's window - never
   * one past the order's `expires`. */
  const nextAnchorOf = (order: StandingOrder, now: number, today: string): string | undefined => {
    const window = deps.calendar.window();
    if (window === undefined) return undefined;
    const session = sessionFor(window, today);
    if (session !== undefined && session !== "closed" && today <= order.expires) {
      const anchorMs = anchorInstant(order.anchor, session);
      const key = firingKey(order.id, today);
      if (anchorMs > now && !started.has(key) && !missed.has(key)) return iso(anchorMs);
    }
    const later = window.sessions.find((s) => s.date > today && s.date <= order.expires);
    return later === undefined ? undefined : iso(anchorInstant(order.anchor, later));
  };

  const orderStatus = (order: StandingOrder, now: number, today: string): StandingStatus["orders"][number] => {
    const pins = checked.get(order.id);
    const current = pins !== undefined && pins.sha256 === order.sha256 && pins.producerSha256 === order.producerSha256 ? pins : undefined;
    let nextAnchor: string | undefined;
    try {
      nextAnchor = nextAnchorOf(order, now, today);
    } catch {
      nextAnchor = undefined;
    }
    const last = lastOf.get(order.id);
    return {
      id: order.id, dir: order.dir, file: order.file, at: order.at,
      ...(order.producer === undefined ? {} : { producer: formatProducer(order.producer) }),
      wake: order.wake, enabled: order.enabled, expires: order.expires, expired: today > order.expires,
      hash: current?.hash ?? "unknown",
      ...(order.producer?.kind === "script" ? { producerHash: current?.producerHash ?? "unknown" } : {}),
      ...(nextAnchor === undefined ? {} : { nextAnchor }),
      ...(last === undefined ? {} : { last }),
    };
  };

  /** The calendar as today's answer says it: none asked today is `unknown`. */
  const calendarStatus = (today: string): StandingStatus["calendar"] => {
    const python = deps.calendar.python;
    const day = answer?.date === today ? answer : undefined;
    if (day === undefined) return { python, state: "unknown" };
    if (!day.ok) return { python, state: "failed", error: day.error };
    const session = day.session;
    return {
      python,
      state: day.stale === undefined ? "ok" : "stale",
      source: day.source,
      today: session === "closed" ? { date: day.date, closed: true } : { date: day.date, open: session.open, close: session.close, early: session.early },
      ...(day.stale === undefined ? {} : { error: day.stale.error }),
    };
  };

  const status = (): StandingStatus => {
    const now = clock.now();
    const today = etDate(new Date(now));
    const running = inHand?.started;
    return {
      file: {
        path: standingPath,
        state: fileState,
        ...(loadedAt === undefined ? {} : { loadedAt }),
        ...(fileState === "refused" && refused !== undefined ? { errors: [...refused] } : {}),
      },
      ...(ledgerError === undefined ? {} : { ledger: { error: ledgerError } }),
      calendar: calendarStatus(today),
      orders: orders.map((order) => orderStatus(order, now, today)),
      ...(inHand === undefined || running === undefined
        ? {}
        : { running: { key: inHand.key, startedAt: running.at, ...(running.sessionId === undefined ? {} : { sessionId: running.sessionId }) } }),
      queued: [...(inHand !== undefined && running === undefined ? [inHand.key] : []), ...queue.map((item) => item.key)],
      recent: [...recent],
    };
  };

  /* ---- the end ---- */
  let disposing: Promise<void> | undefined;

  return {
    tick: () => tickAs("tick"),
    status,
    dailyTokens: () => cap,
    dispose() {
      disposing ??= (async () => {
        disposed = true;
        if (timer !== undefined) {
          clock.clearTimeout(timer);
          timer = undefined;
        }
        queue.length = 0;
        inHand?.started?.abort.abort();
        /* the firing aborted and the tick under way, each given at most DISPOSE_WAIT_MS on the clock */
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

/* ---------- the face's defaults ---------- */

/** What a firing's route reads of the booted ROOT context (src/firing.ts `resolveFiringRoute`). */
export type FiringRouteCtx = Parameters<typeof resolveFiringRoute>[0];

/** Whether `ctx` carries the default model and the model calls a firing's route is resolved on. */
const hasRoutes = (ctx: Partial<FiringRouteCtx>): ctx is FiringRouteCtx => ctx.agentDefaultModel !== undefined && ctx.llm !== undefined;

/** The face's clock: the wall clock, and timers `unref`'d, so the clock row never holds the process open (the plan's
 * ruling 1). */
const FACE_CLOCK: DeskClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * The clock row as the face runs it: {@link installSchedule} with the face's defaults - the market calendar over
 * scripts/market_clock.py under `python` (src/market-clock.ts; a failed run's stderr tail one line, once per distinct
 * tail), a script producer under the same interpreter, `builtin:brief` over the quote hub when there is one (src/brief.ts),
 * a fresh desk agent per firing (src/desk-session.ts `createDeskAgent`), the order's route (src/firing.ts
 * `resolveFiringRoute`, on the booted context's default model and model calls), and the day's budget against the last
 * good load's cap. `seams` replaces the clock - the wall clock by default, its timers `unref`'d - the calendar, the
 * script runner, the builtins, the tick and the grace.
 * @param opts - `home` the harness home; `root` the repository root; `python` the face's interpreter (`FACE_PYTHON ||
 *   python3`); `hub` the quote hub; `session` the desk session's deps; `sessionCtx` the booted ROOT context, whose
 *   `agentDefaultModel` and `llm` a firing's route needs - a firing on a context without them could not run; `on` the
 *   root bus; `deliver` the desk conversation's; `log`, stderr by default; `seams`, for tests.
 */
export function createDeskSchedule(opts: {
  home: string;
  root: string;
  python: string;
  hub?: Pick<QuoteHub, "snapshot">;
  session: DeskSessionDeps;
  sessionCtx: Partial<FiringRouteCtx>;
  on: SessionEventsOn;
  deliver: (text: string) => Promise<DeliverResult>;
  log?: (line: string) => void;
  seams?: { clock?: DeskClock } & Partial<Pick<ScheduleDeps, "calendar" | "runScript" | "builtins" | "tickMs" | "graceMs">>;
}): ScheduleHandle {
  const log = opts.log ?? defaultLog;
  const seams = opts.seams ?? {};
  const clock = seams.clock ?? FACE_CLOCK;
  let toldTail: string | undefined;
  /* one runner for the clock and a script producer: the face's interpreter, isolated */
  const runScript = seams.runScript ?? defaultProducerRunner(opts.python);
  const calendar = seams.calendar ?? createMarketCalendar({
    python: opts.python,
    ask: pythonMarketClock({
      root: opts.root,
      python: opts.python,
      run: runScript,
      stderr: (tail) => {
        if (tail === toldTail) return;
        toldTail = tail;
        log(`${BIN}: desk: schedule calendar: scripts/market_clock.py under ${opts.python} failed; its stderr ends: ${tail}`);
      },
    }),
  });
  const { sessionCtx } = opts;
  const handle: ScheduleHandle = installSchedule({
    home: opts.home,
    root: opts.root,
    clock,
    calendar,
    runScript,
    builtins: seams.builtins ?? (opts.hub === undefined ? {} : { brief: briefProducer({ hub: opts.hub, root: opts.root }) }),
    createAgent: (o) => createDeskAgent(opts.session, o),
    resolveRoute: async (raw) => {
      if (!hasRoutes(sessionCtx)) throw new Error("this face's context names no default model to route a standing order on");
      return resolveFiringRoute(sessionCtx, raw, log);
    },
    on: opts.on,
    deliver: opts.deliver,
    budget: () => readBudget(opts.home, clock.now(), handle.dailyTokens()),
    log,
    ...(seams.tickMs === undefined ? {} : { tickMs: seams.tickMs }),
    ...(seams.graceMs === undefined ? {} : { graceMs: seams.graceMs }),
  });
  return handle;
}
