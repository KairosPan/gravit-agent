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
 * - Per market with an enabled order unexpired on that market's date - `us` on New York's, `cn` on Beijing's
 *   (src/et.ts `dateOf`; an order with no `market` is `us`) - that market's calendar answers for its date once
 *   (src/market-clock.ts); a date it cannot answer is one `calendar-error` event and one line, and no order of that
 *   market fires until it can - the other market's go on.
 * - Each order, in file order, on its own market's answer and date: a disabled one is skipped; one past its `expires`
 *   is one `expired` record and line per expiry; a closed day is silent; else {@link decide} says whether today's
 *   anchor is due, missed or settled. The day's budget stays New York's (src/desk.ts `readBudget`). A
 *   missed anchor says why: the face asleep across it (a gap between two ticks over the sleep watch's threshold),
 *   not running when it came, or finding it late.
 *
 * THE KEY. A firing's key, `<id>:<session date>` - its market's date - is consumed only by its `started` record, appended through
 * src/desk.ts `appendRecordOnce` under the ledger's lock (P2-23): of two faces on one home, one runs it. A refusal
 * consumes nothing - a rearm or a resume inside the grace fires that day - and a key whose grace passes refused is
 * settled, never missed. A `started` with no end at boot was cut off: one `interrupted` record and line, never run
 * again. Earlier days are never back-filled. A rotation of the ledger hands either market's today's `started` lines to
 * the new file, which is the only one the once-only append reads.
 *
 * THE RUNNER takes one firing at a time, in queue order - a queued one runs even past its grace (P2-11) - and for
 * each: the order looked up again in the last load; one still queued at its market moment (src/firing.ts `cutoffOf`)
 * is missed as `cutoff`, once, never checked or started; src/firing.ts `checkFiring`, whose refusal is recorded once
 * per key and phoned as {@link refusalLine} says - a strategy's `levels.yml` pin among them, checked after the fence;
 * the `started`; then `runFiring`.
 *
 * HELD LINES (P4 ruling 7). A one-shot line the pause holds back is sent again at each tick until it gets through; a
 * miss, a cut-off or interrupted firing or an expiry written while lines are held says `held`, a refusal held says
 * `reported: false`, and the line that reaches the phone is followed by a `phoned` record - so the ledger's first read
 * after a restart holds again the last three days' lines no `phoned` follows.
 *
 * FAILURES never reach the face (P2-21): a tick, the reload, the calendar, the budget's note - each is caught, one
 * `gravit-face: desk: schedule <what>: <reason>` line per distinct failure, and the next tick is armed regardless.
 *
 * MODULE WEIGHT. This module brings src/firing.ts (src/desk-session.ts, the desk preset, dsh-agent, src/desk-book.ts),
 * src/standing.ts (js-yaml), src/brief.ts, src/report.ts and src/market-clock.ts (src/xshg-clock.ts): src/desk.ts
 * loads it on first use, so the pause switch never does.
 * @module
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { briefProducer } from "./brief.ts";
import {
  appendEvent, appendRecord, appendRecordOnce, ASLEEP_THRESHOLD_MS, deskDir, FIRINGS_FILE, noteBudgetSpent, readBudget, readEvents, readOffState, readRecords,
  type BudgetState,
} from "./desk.ts";
import { createDeskAgent, type DeskClock, type DeskSessionDeps, type SessionEventsOn } from "./desk-session.ts";
import type { DeliverOpts } from "./desk-conversation.ts";
import { dateOf } from "./et.ts";
import {
  checkFiring, cutoffOf, FIRING_SLACK_MS, firingKey, isFiringRecord, kindOf, LINES, outcomeOf, repoRelative, resolveFiringRoute, runFiring,
  type ExpiredRecord, type FiringDeps, type FiringItem, type FiringRecord, type InterruptedRecord, type MissedRecord, type PhonedRecord,
  type Refusal, type RefusedRecord, type StartedRecord, type Verified,
} from "./firing.ts";
import { deskCalendars, sessionFor, type DayAnswer, type DeskCalendars, type MarketCalendar, type MarketSession } from "./market-clock.ts";
export { deskCalendars, type DeskCalendars } from "./market-clock.ts";
import { defaultProducerRunner, formatProducer, type BuiltinName, type BuiltinProducer } from "./producer.ts";
import { unwiredMarketQuotes, type MarketQuoteSource } from "./market-quotes.ts";
import { reportProducer } from "./report.ts";
import {
  anchorInstant, GRACE_MS, needsLevelsPin, orderMarket, parseStanding, STANDING_FILE, type FiringSummary, type StandingOrder, type StandingStatus,
} from "./standing.ts";
import type { Market } from "./symbols.ts";

/** The markets in the order a tick asks their calendars. */
const MARKETS: readonly Market[] = ["us", "cn"];

/** Diagnostic label, the one every `${BIN}:`-prefixed line in the face uses; desk lines add `desk:`. */
const BIN = "gravit-face";
/** How a line about the clock row, or about an order no longer loaded, goes (src/phone.ts). */
const REPORT: DeliverOpts = { kind: "report" };
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
 * install by default); `calendar`, the US market calendar (XNYS, New York dates); `calendars`, either market's - its
 * `us` in place of `calendar`, its `cn` the A-share one (XSHG, Beijing dates), src/market-clock.ts `deskCalendars()`'s
 * builtin, offline one by default; `tickMs` and `graceMs`, {@link SCHEDULE_TICK_MS} and src/standing.ts `GRACE_MS` by
 * default; `firing`, the checks and the run (src/firing.ts's, by default). */
export interface ScheduleDeps extends FiringDeps {
  bootedAt?: number;
  calendar: MarketCalendar;
  calendars?: Partial<DeskCalendars>;
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
/** A `levels.yml` pin's state, as the status shows it. */
type LevelsState = NonNullable<StandingStatus["orders"][number]["levelsHash"]>;

/** A `levels-hash` refusal's detail as the status names the file's state. */
const levelsStateOf = (detail: string): LevelsState =>
  (detail === "missing" ? "missing" : detail.startsWith("unreadable (") ? "unreadable" : "changed");

/** Whether a line of the firing ledger, its object, is a record of `kind` for `key`. */
const recordOf = (kind: FiringRecord["kind"], key: string) => (x: unknown): boolean => isFiringRecord(x) && x.kind === kind && x.key === key;

/** A refusal's detail as the dedupe compares it: the text's, and the script's when its pin moved too. */
const refusalDetail = (detail: string, producerDetail: string | undefined): string =>
  (producerDetail === undefined ? detail : `${detail} ${producerDetail}`);

/** The kinds a rotation hands on for today's keys (p2-m28) - a `phoned` for any key a carried line has (P4 ruling 7). */
const CARRIED: ReadonlySet<string> = new Set(["started", "finished", "interrupted", "missed", "refused", "phoned"]);

/** How far back the ledger's first read looks for a held line no `phoned` follows (P4 ruling 7): three days. */
const REHOLD_MS = 3 * 86_400_000;
/** The refusals whose held line a restart sends again: the ones phoned once per change (the fence, each time). */
const REHELD_REASONS: ReadonlySet<string> = new Set(["hash", "fence", "levels-hash"]);

/** A held line's `phoned` record, as the line carries it until its send resolves final: a refusal's names its reason
 * and detail, so it matches its own refusal and no other of the key. */
type PhonedMark = { key: string; of: PhonedRecord["of"]; reason?: Refusal["reason"]; detail?: string };

/** The refusal or record a `phoned` matches, and the `phoned` a record would be matched by: `<of> <key>`, and for a
 * refusal its reason and its detail as the dedupe compares it. */
const phonedId = (of: string, key: string, reason?: string, detail?: string): string =>
  (of === "refused" ? `refused ${key} ${reason ?? ""} ${detail ?? ""}` : `${of} ${key}`);

/** The keys the records show ended: a `finished` or an `interrupted`. */
function endedKeys(records: readonly FiringRecord[]): Set<string> {
  return new Set(records.flatMap((r) => (r.kind === "finished" || r.kind === "interrupted") && typeof r.key === "string" ? [r.key] : []));
}

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
  /* each market's calendar: P2's `calendar` is the US one; the A-share one is made only when none is given */
  const calendars: DeskCalendars = {
    us: deps.calendars?.us ?? deps.calendar,
    cn: deps.calendars?.cn ?? deskCalendars().cn,
  };
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

  /** Send a line through `deliver`, which never rejects; one that does is one face line. Whether the line got past
   * the pause: `false` only when `deliver` answered `{ undelivered: "paused" }` - the line held back, so whatever
   * dedupes it must not count it as phoned (P2 fix wave, I4); any other answer is final. A line about one order goes
   * as that order's kind (src/firing.ts `kindOf`: the brief's as `brief`, so an operator who routes the brief hears it
   * was missed); a line about the clock row or the file as a whole as `report` (src/phone.ts). */
  const send = async (text: string, opts: DeliverOpts = REPORT): Promise<boolean> => {
    try {
      const answer = await deps.deliver(text, opts);
      return !("undelivered" in answer && answer.undelivered === "paused");
    } catch (err) {
      log(`${BIN}: desk: a standing order's line could not be sent: ${errText(err)}`);
      return true;
    }
  };

  /** Whether a line sent now would get past the pause - read before an event is written, so a held line's event says
   * `phoned: false`. The switch is read as the conversation reads it; a switch that cannot be read reads as paused. */
  const deliverable = async (): Promise<boolean> => {
    try {
      const { state, expired } = await readOffState(home, () => clock.now());
      return state === undefined || expired;
    } catch {
      return false;
    }
  };

  /** The one-shot lines the pause held back - a missed anchor, a cut-off firing, an expiry, a firing's refusal - in
   * the order they came, each sent again at every tick until an answer is not `paused`; those a record says were held
   * carry the `phoned` record that follows them to the phone (P4 ruling 7). */
  const held: { text: string; phoned?: PhonedMark; opts?: DeliverOpts }[] = [];
  /** The kind a line about the order `id` goes as: its kind while it is loaded, else `report`. */
  const kindOfId = (id: string): DeliverOpts => {
    const order = orders.find((o) => o.id === id);
    return order === undefined ? REPORT : kindOf(order);
  };
  /** A held line's `phoned` record, appended once the line's send resolved final. */
  const notePhoned = async (mark: PhonedMark): Promise<void> => {
    const record: PhonedRecord = {
      t: iso(clock.now()), kind: "phoned", key: mark.key, of: mark.of,
      ...(mark.reason === undefined ? {} : { reason: mark.reason }), ...(mark.detail === undefined ? {} : { detail: mark.detail }),
    };
    await appendRecord(home, FIRINGS_FILE, record, ledgerOpts);
  };
  /** Whether a one-shot line written now would be held - one held before it, or the pause in force - read before its
   * record is appended, so the record says `held` (P4 ruling 7). */
  const holding = async (): Promise<boolean> => held.length > 0 || !(await deliverable());
  /** A one-shot line as `entry`, the very object held: sent, or held while the pause holds. Whether it got through. */
  const sendEntry = async (entry: { text: string; phoned?: PhonedMark; opts?: DeliverOpts }): Promise<boolean> => {
    if (held.length > 0) {
      held.push(entry); // behind the ones held before it, so the phone hears them in order
      return false;
    }
    const reached = await send(entry.text, entry.opts);
    if (!reached) held.push(entry);
    return reached;
  };
  /** A one-shot line: sent, or held while the pause holds; `phoned`, its `phoned` record once its send resolves final,
   * at once or from {@link flushHeld}. */
  const sendOnce = async (text: string, phoned: PhonedMark | undefined, opts: DeliverOpts): Promise<boolean> => {
    const reached = await sendEntry(phoned === undefined ? { text, opts } : { text, phoned, opts });
    if (reached && phoned !== undefined) await notePhoned(phoned);
    return reached;
  };
  /** The held lines, sent in order until one is held again, each marked one followed by its `phoned` record. */
  const flushHeld = async (): Promise<void> => {
    while (held.length > 0) {
      const [first] = held;
      if (!(await send(first.text, first.opts))) return;
      held.shift();
      if (first.phoned !== undefined) await notePhoned(first.phoned);
    }
  };

  /** What a rotation of the firing ledger hands the new file, as written: today's `started` lines, so the once-only
   * append - which reads the current file alone - still finds today's keys (P2 Task 8's ruling 5); today's
   * `finished`, `interrupted`, `missed` and `refused` lines, so a restart after the rotation reads each carried key
   * as it ended and phones no false `interrupted`; the `expired` lines of the loaded orders' expiries, so an
   * expiry is not phoned twice (p2-m28); and the `phoned` lines of the keys those carry, so a held line a restart
   * would send again is not (P4 ruling 7). The clock row's own appends and a firing's carry it alike. */
  const carry = (rotated: string): string[] => {
    const now = clock.now();
    /* either market's today: an A-share firing at 19:00 ET is dated the next Beijing day */
    const today = new Set(MARKETS.map((market) => dateOf(market, now)));
    const expiryKeys = new Set(orders.map((order) => firingKey(order.id, order.expires)));
    const keeps = (r: FiringRecord): boolean => {
      if (r.kind === "expired") return expiryKeys.has(r.key);
      return CARRIED.has(r.kind) && "date" in r && typeof r.date === "string" && today.has(r.date);
    };
    const lines = rotated.split("\n");
    /* a phoned goes with the line it follows: kept when a kept line has its key */
    const keys = new Set<string>();
    for (const line of lines) {
      const r = lineRecord(line);
      if (r !== undefined && r.kind !== "phoned" && keeps(r)) keys.add(r.key);
    }
    return lines.filter((line) => {
      const r = lineRecord(line);
      if (r === undefined) return false;
      return r.kind === "phoned" ? keys.has(r.key) : keeps(r);
    });
  };
  const ledgerOpts = { log, carry };

  /* ---- what the ledger and this face know, by key and by order ---- */
  const started = new Set<string>();
  const missed = new Set<string>();
  /** Each key's last refusal. */
  const refusals = new Map<string, { reason: Refusal["reason"]; detail?: string }>();
  /** Each order's last phoned detail of a `hash`, a `producer-hash` or a `levels-hash` refusal, by `<order> <reason>`. */
  const phonedDetail = new Map<string, string>();
  /** The `expired` records' keys, `<id>:<expires>`: one each. */
  const expiries = new Set<string>();
  /** The latest instant each order was found expired: a later anchor today is settled by it (P2 Task 8's ruling 4). */
  const expiredAt = new Map<string, number>();
  /** The latest instant each order was found disabled: an anchor today it passed while disabled is settled by it. */
  const disabledAt = new Map<string, number>();
  /** The keys whose `started` could not be written: their grace passes as a ledger failure, not a miss. */
  const unwritten = new Set<string>();
  const lastOf = new Map<string, FiringSummary>();
  let recent: FiringSummary[] = [];
  /** Each order's pins as its last check found them, and the pins it checked. */
  const checked = new Map<string, {
    sha256: string; producerSha256?: string; levelsSha256?: string; hash: HashState; producerHash?: HashState; levelsHash?: LevelsState;
  }>();

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
        refusals.set(r.key, { reason: r.reason, ...(r.detail === undefined ? {} : { detail: refusalDetail(r.detail, r.producerDetail) }) });
        if (r.reported === true && (r.reason === "hash" || r.reason === "producer-hash" || r.reason === "levels-hash") && typeof r.detail === "string") {
          phonedDetail.set(`${r.order} ${r.reason}`, refusalDetail(r.detail, r.producerDetail));
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
  /** The refusal last recorded and the one last phoned, its errors joined; both cleared by a good load, so a new
   * break is recorded and phoned again. They differ while the pause holds the line back: the next tick phones it. */
  let eventedRefusal: string | undefined;
  let phonedRefusal: string | undefined;
  /** The code of a refusal for a file the face could not read, while that is the refusal in force. */
  let unreadableCode: string | undefined;
  /** The codes of an unreadable `standing.yml` already phoned, one line each for this face's life - a transient
   * EMFILE fails closed for its tick, and is not phoned again each time it recurs (p2-m33). */
  const phonedUnreadable = new Set<string>();
  /** The last good load. */
  let orders: StandingOrder[] = [];
  let cap: number | undefined;

  /** The refusal in force, phoned unless it was already - by its joined errors, or for an unreadable file by its
   * code - and unless the pause holds it back, in which case the next tick tries again while it stands. */
  const phoneRefusal = async (errors: readonly string[]): Promise<void> => {
    const joined = errors.join("\n");
    if (unreadableCode !== undefined ? phonedUnreadable.has(unreadableCode) : phonedRefusal === joined) return;
    if (!(await send(LINES.standingRefused(errors)))) return;
    if (unreadableCode !== undefined) phonedUnreadable.add(unreadableCode);
    else phonedRefusal = joined;
  };

  const refuse = async (errors: string[], now: number, code?: string): Promise<void> => {
    fileState = "refused";
    refused = errors;
    unreadableCode = code;
    const joined = errors.join("\n");
    if (eventedRefusal !== joined) {
      eventedRefusal = joined;
      const phoned = code !== undefined ? phonedUnreadable.has(code) : phonedRefusal === joined;
      /* its line is phoned next; held back by the pause, the event says so, and a restart phones it again */
      const reached = phoned || (await deliverable());
      await appendEvent(home, { t: iso(now), kind: "standing-error", errors, ...(reached ? {} : { phoned: false as const }) }, { log });
    }
    await phoneRefusal(errors);
  };

  /** A file the face cannot stat or read: refused like one it cannot parse - fail closed, even for a transient code -
   * and read whole at the next tick that can, moved or not; its line goes out once per code. */
  const unreadable = async (err: unknown, now: number): Promise<void> => {
    fail("reload", err);
    signature = undefined;
    const code = reasonOf(err);
    await refuse([`${STANDING_FILE} cannot be read (${code})`], now, code);
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
    unreadableCode = undefined;
    eventedRefusal = undefined;
    phonedRefusal = undefined;
    /* a boot that read the ledger while standing.yml was refused re-holds its refusals now, once */
    if (fileState === "loaded" && reholdPending !== undefined) {
      const pending = reholdPending;
      reholdPending = undefined;
      await rehold(pending, now, true);
      await flushHeld();
    }
  };

  /* ---- the firing ledger ---- */
  let ledgerRead = false;
  /** Whether the ledger has been read whole once, its records noted and its cut-off firings found. */
  let ledgerReadOnce = false;
  let ledgerError: string | undefined;
  /** The ledger failure last recorded and the one last phoned, by reason; the second only once a line got past the
   * pause. */
  let eventedLedger: string | undefined;
  let phonedLedger: string | undefined;
  /** Which failure the two above are about: a read clears a read failure's, a written `started` a write failure's. */
  let ledgerFailing: "read" | "write" | undefined;
  /** A `started` with no end that was younger than its turn's deadline and the slack at boot - perhaps a live firing
   * on another face on this home (M2): judged once it is that old, by the ledger as it then reads. */
  const young = new Map<string, { record: StartedRecord; at: number }>();
  /** The ledger's records as the first read found them, while `standing.yml` was refused - no order loaded to build a
   * refusal's line for: the first good load re-holds their refusals, once. */
  let reholdPending: readonly FiringRecord[] | undefined;

  /** A ledger failure - unreadable, or a `started` that could not be written: recorded once and phoned once per
   * reason, the line tried again at each tick the pause holds it back; every firing stops until the ledger reads. */
  const ledgerFailure = async (reason: string, now: number, kind: "read" | "write" = "read"): Promise<void> => {
    ledgerRead = false;
    ledgerError = reason;
    ledgerFailing = kind;
    const errors = [`${ledgerPath} cannot be read (${reason})`];
    if (eventedLedger !== reason) {
      eventedLedger = reason;
      await appendEvent(home, { t: iso(now), kind: "standing-error", errors, ...((await deliverable()) ? {} : { phoned: false as const }) }, { log });
    }
    if (phonedLedger !== reason && (await send(LINES.ledgerUnreadable(ledgerPath, reason)))) phonedLedger = reason;
  };

  /** One `started` the last run left without an end: `interrupted`, recorded once and phoned once. */
  const interrupt = async (r: StartedRecord, now: number): Promise<void> => {
    const isHeld = await holding();
    const record: InterruptedRecord = {
      t: iso(now), kind: "interrupted", key: r.key, order: r.order, date: r.date, startedAt: r.t, ...(isHeld ? { held: true as const } : {}),
    };
    const outcome = await appendRecordOnce(home, FIRINGS_FILE, record, recordOf("interrupted", r.key), ledgerOpts);
    note(record);
    if (outcome !== "duplicate") await sendOnce(LINES.interrupted(r.order, r.date), isHeld ? { key: r.key, of: "interrupted" } : undefined, kindOfId(r.order));
  };

  /**
   * At the ledger's first read, the lines a pause held that never reached the phone (P4 ruling 7), held again in ledger
   * order: of the records written in the last {@link REHOLD_MS} with no `phoned` of their key and kind after them, a
   * `held` miss, cut-off firing or expiry, its line as {@link LINES} builds it; and a refusal recorded `reported: false`
   * - `hash`, `fence` or `levels-hash`, the last of its `<order> <reason> <detail>` - for an order still loaded, whose
   * line {@link refusalLine} would send now. Each is followed by its `phoned` once it reaches the phone. A record the
   * operator's edit left without its fields holds nothing. Read while `standing.yml` is refused, no order is loaded:
   * the records are kept, and the first good load holds their refusals alone ({@link reholdPending}).
   */
  const rehold = async (records: readonly FiringRecord[], now: number, refusalsOnly = false): Promise<void> => {
    if (!refusalsOnly && fileState === "refused") reholdPending = records;
    const phonedAt = new Map<string, number>();
    const lastRefusal = new Map<string, number>();
    const detailOf = (r: RefusedRecord): string => refusalDetail(String(r.detail), r.producerDetail);
    const refusalId = (r: RefusedRecord): string => `${r.order} ${r.reason} ${detailOf(r)}`;
    /* a record's phoned: its kind and key - a refusal's by its reason and detail too, so one phoned refusal masks no
     * other of the key */
    const idOf = (r: FiringRecord): string => (r.kind === "refused" ? phonedId("refused", r.key, r.reason, detailOf(r)) : phonedId(r.kind, r.key));
    records.forEach((r, i) => {
      if (r.kind === "phoned") phonedAt.set(phonedId(r.of, r.key, r.reason, r.detail), i);
      else if (r.kind === "refused") lastRefusal.set(refusalId(r), i);
    });
    for (const [i, r] of records.entries()) {
      const t = Date.parse(r.t);
      if (typeof r.key !== "string" || !("order" in r) || typeof r.order !== "string" || !Number.isFinite(t) || now - t > REHOLD_MS) continue;
      if ((phonedAt.get(idOf(r)) ?? -1) > i || (refusalsOnly && r.kind !== "refused")) continue;
      let text: string | undefined;
      try {
        if (r.kind === "missed" && r.held === true) text = LINES.missed(r);
        else if (r.kind === "interrupted" && r.held === true) text = LINES.interrupted(r.order, r.date);
        else if (r.kind === "expired" && r.held === true) text = LINES.expired(r.order, r.expires);
        else if (r.kind === "refused" && r.reported === false && REHELD_REASONS.has(r.reason) && typeof r.detail === "string" && lastRefusal.get(refusalId(r)) === i) {
          const order = orders.find((o) => o.id === r.order);
          const refusal: Refusal | undefined = r.reason === "hash"
            ? { reason: "hash", detail: r.detail, ...(typeof r.producerDetail === "string" ? { producerDetail: r.producerDetail } : {}) }
            : r.reason === "fence" || r.reason === "levels-hash" ? { reason: r.reason, detail: r.detail } : undefined;
          if (order !== undefined && refusal !== undefined) text = await refusalLine({ order, date: r.date }, refusal, now);
        }
      } catch {
        text = undefined;
      }
      if (text === undefined) continue;
      const opts = kindOfId(r.order);
      if (r.kind === "refused") held.push({ text, phoned: { key: r.key, of: "refused", reason: r.reason, detail: detailOf(r) }, opts });
      else if (r.kind === "missed" || r.kind === "interrupted" || r.kind === "expired") held.push({ text, phoned: { key: r.key, of: r.kind }, opts });
    }
  };

  /** The ledger read - every key it holds, every firing a restart cut off - or `false`, with its line once per
   * distinct reason, when it cannot be: then nothing fires until it can. */
  const readLedger = async (now: number): Promise<boolean> => {
    let records: FiringRecord[];
    try {
      records = (await readRecords(home, FIRINGS_FILE, isFiringRecord)).records;
    } catch (err) {
      await ledgerFailure(reasonOf(err), now);
      return false;
    }
    const first = !ledgerReadOnce;
    ledgerReadOnce = true;
    ledgerRead = true;
    ledgerError = undefined;
    if (ledgerFailing === "read") {
      eventedLedger = undefined;
      phonedLedger = undefined;
      ledgerFailing = undefined;
    }
    /* a re-read after a failure knows the records already noted */
    if (!first) return true;
    for (const r of records) note(r);
    /* the lines a pause held when the last run ended, before the cut-off firings it left: the older first */
    await rehold(records, now);
    const ended = endedKeys(records);
    for (const r of records) {
      if (r.kind !== "started" || typeof r.key !== "string" || typeof r.order !== "string" || typeof r.date !== "string" || ended.has(r.key)) continue;
      ended.add(r.key);
      const at = Date.parse(r.t) + (typeof r.deadlineMs === "number" ? r.deadlineMs : 0) + FIRING_SLACK_MS;
      if (Number.isFinite(at) && at > now) {
        young.set(r.key, { record: r, at });
        continue;
      }
      await interrupt(r, now);
    }
    await flushHeld();
    return true;
  };

  /** The young `started` records now old enough to judge: each still without an end in the ledger is interrupted. */
  const judgeYoung = async (now: number): Promise<void> => {
    const due = [...young.values()].filter((y) => y.at <= now);
    if (due.length === 0) return;
    let ended: Set<string>;
    try {
      ended = endedKeys((await readRecords(home, FIRINGS_FILE, isFiringRecord)).records);
    } catch (err) {
      fail("ledger", err);
      return; // the next tick asks again
    }
    for (const y of due) {
      young.delete(y.record.key);
      if (!ended.has(y.record.key)) await interrupt(y.record, now);
    }
  };

  /* ---- the calendars, one per market ---- */
  /** This face's last answer from each market's calendar. */
  const answers: Partial<Record<Market, DayAnswer>> = {};
  /** The `<market>:<date>`s whose failure was recorded, and those whose line got past the pause: a held one is phoned
   * at the next tick that still finds the date failed. Seeded from `events.jsonl` at boot (p2-m32). */
  const calendarEvented = new Set<string>();
  const calendarPhoned = new Set<string>();

  const askCalendar = async (market: Market, now: number): Promise<DayAnswer | undefined> => {
    const calendar = calendars[market];
    const what = market === "us" ? "calendar" : "A-share calendar";
    let got: DayAnswer;
    try {
      got = await calendar.today(now);
    } catch (err) {
      fail(what, err);
      return undefined;
    }
    recover(what);
    answers[market] = got;
    const day = `${market}:${got.date}`;
    if (!got.ok && !calendarEvented.has(day)) {
      calendarEvented.add(day);
      const reached = await deliverable();
      await appendEvent(home, {
        t: iso(now), kind: "calendar-error", date: got.date, clock: calendar.clock, error: got.error, ...(reached ? {} : { phoned: false as const }),
      }, { log });
    }
    if (!got.ok && !calendarPhoned.has(day) && (await send(LINES.noCalendar(calendar.clock, got.error, market, got.date)))) calendarPhoned.add(day);
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
    const isHeld = await holding();
    const record: ExpiredRecord = {
      t: iso(now), kind: "expired", key, order: order.id, date: order.expires, expires: order.expires, ...(isHeld ? { held: true as const } : {}),
    };
    const outcome = await appendRecordOnce(home, FIRINGS_FILE, record, recordOf("expired", key), ledgerOpts);
    note(record);
    if (outcome !== "duplicate") await sendOnce(LINES.expired(order.id, order.expires), isHeld ? { key, of: "expired" } : undefined, kindOf(order));
  };

  /** An anchor found past its grace: why, recorded and phoned once. */
  const miss = async (order: StandingOrder, key: string, date: string, anchorMs: number, now: number, since: number | undefined): Promise<void> => {
    const asleep = since !== undefined && now - since > ASLEEP_THRESHOLD_MS && since <= anchorMs ? { from: iso(since), to: iso(now) } : undefined;
    const isHeld = await holding();
    const record: MissedRecord = {
      t: iso(now), kind: "missed", key, order: order.id, date, anchor: iso(anchorMs),
      why: asleep !== undefined ? "asleep" : anchorMs < bootedAt ? "down" : "late",
      ...(asleep === undefined ? {} : { asleep }), foundAt: iso(now), ...(isHeld ? { held: true as const } : {}),
    };
    const outcome = await appendRecordOnce(home, FIRINGS_FILE, record, recordOf("missed", key), ledgerOpts);
    note(record);
    if (outcome !== "duplicate") await sendOnce(LINES.missed(record), isHeld ? { key, of: "missed" } : undefined, kindOf(order));
  };

  /** A firing still queued at its market moment (src/firing.ts `cutoffOf`): missed as `cutoff`, never checked or
   * started, its record appended only when the key holds no `started` or `missed` - of two faces on one home, the one
   * that ran it settles it - and its line phoned with it. A duplicate settles the key with no line. */
  const cutOff = async (item: FiringItem, now: number): Promise<void> => {
    const isHeld = await holding();
    const record: MissedRecord = {
      t: iso(now), kind: "missed", key: item.key, order: item.order.id, date: item.date, anchor: iso(item.anchorMs),
      why: "cutoff", moment: item.order.anchor.kind === "close" ? "close" : "open", foundAt: iso(now), ...(isHeld ? { held: true as const } : {}),
    };
    const outcome = await appendRecordOnce(home, FIRINGS_FILE, record, (x) => (recordOf("started", item.key)(x) || recordOf("missed", item.key)(x)), ledgerOpts);
    if (outcome === "duplicate") {
      /* settled by the other face's started or missed, whichever: no tick weighs it again */
      missed.add(item.key);
      return;
    }
    note(record);
    await sendOnce(LINES.missed(record), isHeld ? { key: item.key, of: "missed" } : undefined, kindOf(item.order));
  };

  /** One order on one session: queued when due, recorded when missed. */
  const weigh = async (order: StandingOrder, session: MarketSession, now: number, since: number | undefined): Promise<void> => {
    const anchorMs = anchorInstant(order.anchor, session);
    const key = firingKey(order.id, session.date);
    /* found expired, or disabled, at or after this anchor: the order was not in force for it, whatever a later rearm
     * or re-enable says (p2-m31) */
    if ((expiredAt.get(order.id) ?? -Infinity) >= anchorMs) return;
    if ((disabledAt.get(order.id) ?? -Infinity) >= anchorMs) return;
    /* a started append that failed: a ledger failure, never a miss to report late (p2-m30) */
    if (unwritten.has(key) && now - anchorMs > graceMs) return;
    const verdict = decide({
      anchorMs, nowMs: now, graceMs, armedFromMs: Date.parse(order.armedAt),
      started: started.has(key), missed: missed.has(key), refused: refusals.has(key), pending: pending(key),
    });
    if (verdict === "due") queue.push({ key, order, date: session.date, session, anchorMs });
    else if (verdict === "missed") await miss(order, key, session.date, anchorMs, now, since);
  };

  /* ---- the tick ---- */
  let lastTickAt: number | undefined;
  let seeded = false;

  /** At boot: what `events.jsonl` says this home already recorded and phoned today - the last refusal of
   * `standing.yml` and each market's calendar failure on its own today - so a restart neither records nor phones them
   * twice; one held back by the pause (`phoned: false`) is phoned again. An unreadable ledger seeds nothing. */
  const seed = async (now: number): Promise<void> => {
    let events: Awaited<ReturnType<typeof readEvents>>["events"];
    try {
      events = (await readEvents(home)).events;
    } catch {
      return;
    }
    const ledgerError = `${ledgerPath} cannot be read (`;
    for (const e of events) {
      if (e.kind === "standing-error" && Array.isArray(e.errors) && !(e.errors.length === 1 && String(e.errors[0]).startsWith(ledgerError))) {
        eventedRefusal = e.errors.join("\n");
        phonedRefusal = e.phoned === false ? undefined : eventedRefusal;
      } else if (e.kind === "calendar-error") {
        /* the market whose calendar is the event's clock, on that market's today (the event names no market) */
        for (const market of MARKETS) {
          if (calendars[market].clock !== e.clock || e.date !== dateOf(market, now)) continue;
          calendarEvented.add(`${market}:${e.date}`);
          if (e.phoned !== false) calendarPhoned.add(`${market}:${e.date}`);
        }
      }
    }
  };

  const runTick = async (): Promise<void> => {
    if (disposed) return;
    const now = clock.now();
    const since = lastTickAt;
    lastTickAt = now;
    if (!seeded) {
      seeded = true;
      await seed(now);
    }
    await flushHeld();
    await reload(now);
    if (fileState === "refused" && refused !== undefined) await phoneRefusal(refused);
    if (!ledgerRead && !(await readLedger(now))) return;
    await judgeYoung(now);
    if (fileState === "refused") return;
    /* one ask per market with an order in force on its own date: each order is weighed on its market's answer */
    const days: Partial<Record<Market, DayAnswer>> = {};
    for (const market of MARKETS) {
      const today = dateOf(market, now);
      if (!orders.some((order) => orderMarket(order) === market && order.enabled && today <= order.expires)) continue;
      days[market] = await askCalendar(market, now);
    }
    for (const order of orders) {
      if (!order.enabled) {
        disabledAt.set(order.id, now);
        continue;
      }
      const market = orderMarket(order);
      if (dateOf(market, now) > order.expires) {
        await expire(order, now);
        continue;
      }
      const day = days[market];
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
    carry,
    createAgent: async (opts) => {
      const made = await deps.createAgent(opts);
      if (inHand?.key === key && inHand.started !== undefined) inHand.started.sessionId = made.sessionId;
      return made;
    },
  });

  /** A check's pins, kept with the pins it checked, for the status. A pause or a budget refuses before any pin is read. */
  const notePins = (order: StandingOrder, verdict: { refuse: Refusal } | { go: Verified }): void => {
    const script = order.producer?.kind === "script";
    const pinned = needsLevelsPin(order);
    const state = (detail: string): HashState => (detail === "missing" ? "missing" : "changed");
    let hash: HashState;
    let producerHash: HashState | undefined;
    /* the levels are read last: a refusal before them leaves their state unknown */
    let levelsHash: LevelsState | undefined = pinned ? "unknown" : undefined;
    if ("go" in verdict) {
      hash = "ok";
      producerHash = script ? "ok" : undefined;
      levelsHash = pinned ? "ok" : undefined;
    } else {
      const refusal = verdict.refuse;
      if (refusal.reason === "off" || refusal.reason === "budget") return;
      if (refusal.reason === "hash") {
        hash = state(refusal.detail);
        producerHash = !script ? undefined : refusal.producerDetail === undefined ? "unknown" : state(refusal.producerDetail);
      } else if (refusal.reason === "producer-hash") {
        hash = "ok";
        producerHash = state(refusal.detail);
      } else if (refusal.reason === "levels-hash") {
        hash = "ok";
        producerHash = script ? "ok" : undefined;
        levelsHash = levelsStateOf(refusal.detail);
      } else {
        hash = "ok";
        producerHash = script ? "ok" : undefined;
      }
    }
    checked.set(order.id, {
      sha256: order.sha256,
      ...(order.producerSha256 === undefined ? {} : { producerSha256: order.producerSha256 }),
      ...(order.levelsSha256 === undefined ? {} : { levelsSha256: order.levelsSha256 }),
      hash,
      ...(producerHash === undefined ? {} : { producerHash }),
      ...(levelsHash === undefined ? {} : { levelsHash }),
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

  /** The phone's line for a refusal recorded now, or `undefined`: `off` never; `budget` with the day's note; `hash`,
   * `producer-hash` and `levels-hash` when the order's last phoned detail for that reason differs; `fence` always. */
  const refusalLine = async (item: Pick<FiringItem, "order" | "date">, refusal: Refusal, now: number): Promise<string | undefined> => {
    const { order, date } = item;
    switch (refusal.reason) {
      case "off":
        return undefined;
      case "budget":
        return (await budgetNoted(refusal.state, now)) ? LINES.budgetSpent(refusal.state) : undefined;
      case "hash":
      case "producer-hash": {
        const told = `${order.id} ${refusal.reason}`;
        const both = refusal.reason === "hash" ? refusal.producerDetail : undefined;
        if (phonedDetail.get(told) === refusalDetail(refusal.detail, both)) return undefined;
        const path = refusal.reason === "hash" ? `${order.dir}/${order.file}` : scriptOf(order);
        if (refusal.detail === "missing") return LINES.missing(order.id, date, path);
        /* the text and the script both moved: one line names both (p2-m11) */
        return LINES.changed(order.id, date, both === undefined ? path : [path, scriptOf(order)]);
      }
      case "fence":
        return LINES.fence(item, refusal.detail);
      case "levels-hash": {
        const told = `${order.id} levels-hash`;
        if (phonedDetail.get(told) === refusal.detail) return undefined;
        if (refusal.detail === "missing") return LINES.levelsGone(order.id, date, order.dir);
        const unreadable = /^unreadable \((.*)\)$/s.exec(refusal.detail);
        if (unreadable !== null) return LINES.levelsUnreadable(order.id, date, order.dir, unreadable[1]);
        return LINES.levelsChanged(order.id, date, order.dir);
      }
    }
  };

  /** A refusal, recorded only when it differs from the key's last, with its line when it has one. */
  const refuseFiring = async (item: FiringItem, refusal: Refusal, now: number): Promise<void> => {
    const detail = "detail" in refusal ? refusal.detail : undefined;
    const producerDetail = refusal.reason === "hash" ? refusal.producerDetail : undefined;
    const last = refusals.get(item.key);
    if (last !== undefined && last.reason === refusal.reason && last.detail === (detail === undefined ? undefined : refusalDetail(detail, producerDetail))) return;
    const line = await refusalLine(item, refusal, now);
    /* its line held back by the pause is no report: `reported: false`, and the line goes out once the pause lifts.
     * Sent at once, its `reported` says so; held, its `phoned` mark is attached only once the refusal is appended, so
     * no `phoned` can precede the refusal it marks */
    const entry: { text: string; phoned?: PhonedMark; opts?: DeliverOpts } | undefined = line === undefined ? undefined : { text: line, opts: kindOf(item.order) };
    const reported = entry !== undefined && (await sendEntry(entry));
    const record: RefusedRecord = {
      t: iso(now), kind: "refused", key: item.key, order: item.order.id, date: item.date, reason: refusal.reason,
      ...(detail === undefined ? {} : { detail }), ...(producerDetail === undefined ? {} : { producerDetail }), reported,
    };
    note(record);
    await appendRecord(home, FIRINGS_FILE, record, ledgerOpts);
    if (entry === undefined || reported) return;
    const mark: PhonedMark = {
      key: item.key, of: "refused", reason: refusal.reason, ...(detail === undefined ? {} : { detail: refusalDetail(detail, producerDetail) }),
    };
    /* still held - or in a send under way, which reads the mark once it resolves - it carries the mark; flushed while
     * the refusal was appended, its phoned goes now, after it */
    if (held.includes(entry)) entry.phoned = mark;
    else await notePhoned(mark);
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
    /* still queued at its market moment: missed, never checked or started (P2-11's cut-off at start) */
    const cutoff = cutoffOf(item);
    if (cutoff !== undefined && clock.now() >= cutoff) {
      await cutOff(item, clock.now());
      return;
    }
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
      ...(order.levelsSha256 === undefined ? {} : { levelsSha: order.levelsSha256 }),
      wake: order.wake, deadlineMs: order.turnDeadlineMs,
    };
    const outcome = await appendRecordOnce(home, FIRINGS_FILE, record, recordOf("started", item.key), ledgerOpts);
    if (outcome === "failed") {
      /* a ledger that cannot take the key stops every firing until it reads again; the key, past its grace, is no miss */
      unwritten.add(item.key);
      await ledgerFailure("the started record could not be written", clock.now(), "write");
      return;
    }
    if (ledgerFailing === "write") {
      eventedLedger = undefined;
      phonedLedger = undefined;
      ledgerFailing = undefined;
    }
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
          fail(`firing ${item.key}`, err);
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
   * one past the order's `expires` - each on the order's market: its calendar, its date. */
  const nextAnchorOf = (order: StandingOrder, now: number, today: string): string | undefined => {
    const window = calendars[orderMarket(order)].window();
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

  const orderStatus = (order: StandingOrder, now: number): StandingStatus["orders"][number] => {
    const market = orderMarket(order);
    const today = dateOf(market, now);
    const pins = checked.get(order.id);
    const current = pins !== undefined && pins.sha256 === order.sha256 && pins.producerSha256 === order.producerSha256
      && pins.levelsSha256 === order.levelsSha256 ? pins : undefined;
    let nextAnchor: string | undefined;
    try {
      nextAnchor = nextAnchorOf(order, now, today);
    } catch {
      nextAnchor = undefined;
    }
    const last = lastOf.get(order.id);
    return {
      id: order.id, dir: order.dir, market, file: order.file, at: order.at,
      ...(order.producer === undefined ? {} : { producer: formatProducer(order.producer) }),
      wake: order.wake, enabled: order.enabled, expires: order.expires, expired: today > order.expires,
      hash: current?.hash ?? "unknown",
      ...(order.producer?.kind === "script" ? { producerHash: current?.producerHash ?? "unknown" } : {}),
      ...(needsLevelsPin(order) ? { levelsHash: current?.levelsHash ?? "unknown" } : {}),
      ...(nextAnchor === undefined ? {} : { nextAnchor }),
      ...(last === undefined ? {} : { last }),
    };
  };

  /** A market's calendar as its today's answer says it: none asked today is `unknown`. */
  const calendarStatus = (market: Market, now: number): StandingStatus["calendar"] => {
    const clockName = calendars[market].clock;
    const answer = answers[market];
    const day = answer?.date === dateOf(market, now) ? answer : undefined;
    if (day === undefined) return { clock: clockName, state: "unknown" };
    if (!day.ok) return { clock: clockName, state: "failed", error: day.error };
    const session = day.session;
    return {
      clock: clockName,
      state: day.stale === undefined ? "ok" : "stale",
      source: day.source,
      today: session === "closed" ? { date: day.date, closed: true } : { date: day.date, open: session.open, close: session.close, early: session.early },
      ...(day.stale === undefined ? {} : { error: day.stale.error }),
    };
  };

  const status = (): StandingStatus => {
    const now = clock.now();
    const running = inHand?.started;
    const us = calendarStatus("us", now);
    return {
      file: {
        path: standingPath,
        state: fileState,
        ...(loadedAt === undefined ? {} : { loadedAt }),
        ...(fileState === "refused" && refused !== undefined ? { errors: [...refused] } : {}),
      },
      ...(ledgerError === undefined ? {} : { ledger: { error: ledgerError } }),
      calendar: us,
      calendars: { us, cn: calendarStatus("cn", now) },
      orders: orders.map((order) => orderStatus(order, now)),
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

/**
 * The face's builtin producers over the Market's one quote source: `report`, src/report.ts `reportProducer` on the
 * schedule's clock, and `brief`, src/brief.ts `briefProducer`.
 * @param opts - `quotes` the source, src/market-quotes.ts `unwiredMarketQuotes()` when there is none - then each
 *   builtin answers `quotes unavailable: <its reason>`, asking nothing; `root` the repository root; `home` the harness
 *   home the brief's watch blocks read; `now` the schedule's clock.
 * @param seams - builtins that replace those of the same name, and only those.
 */
export function deskBuiltins(
  opts: { quotes?: MarketQuoteSource; root: string; home: string; now: () => number },
  seams: Partial<Record<BuiltinName, BuiltinProducer>> = {},
): Record<BuiltinName, BuiltinProducer> {
  const quotes = opts.quotes ?? unwiredMarketQuotes();
  const builtins: Record<BuiltinName, BuiltinProducer> = {
    brief: briefProducer({ quotes, root: opts.root, home: opts.home }),
    report: reportProducer({ quotes, root: opts.root, now: opts.now }),
  };
  for (const name of Object.keys(builtins) as BuiltinName[]) {
    const seam = seams[name];
    if (seam !== undefined) builtins[name] = seam;
  }
  return builtins;
}

/** The face's clock: the wall clock, and timers `unref`'d, so the clock row never holds the process open (the plan's
 * ruling 1). */
const FACE_CLOCK: DeskClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * The clock row as the face runs it: {@link installSchedule} with the face's defaults - the market calendars, the
 * builtin XNYS rules and the builtin XSHG table (src/market-clock.ts `deskCalendars`), a script producer under
 * `python -I` (src/producer.ts), the builtins over the Market's quote source ({@link deskBuiltins}),
 * a fresh desk agent per firing (src/desk-session.ts `createDeskAgent`), the order's route (src/firing.ts
 * `resolveFiringRoute`, on the booted context's default model and model calls), and the day's budget against the last
 * good load's cap. `seams` replaces the clock - the wall clock by default, its timers `unref`'d - the US calendar
 * (`calendar`), either market's (`calendars`, over it), the script producer's runner, any of the builtins by name, the
 * tick and the grace.
 * @param opts - `home` the harness home; `root` the repository root; `python` the interpreter a `.py` script producer runs
 *   under; `quotes` the desk's quote source, the Market's reads (src/market-quotes.ts); `session` the desk session's deps; `sessionCtx` the booted ROOT context, whose
 *   `agentDefaultModel` and `llm` a firing's route needs - a firing on a context without them could not run; `on` the
 *   root bus; `deliver` the desk conversation's; `log`, stderr by default; `now`, the owner's clock - the wall clock
 *   by default - under the face's timers; `seams`, for tests.
 */
export function createDeskSchedule(opts: {
  home: string;
  root: string;
  python: string;
  quotes?: MarketQuoteSource;
  session: DeskSessionDeps;
  sessionCtx: Partial<FiringRouteCtx>;
  on: SessionEventsOn;
  deliver: FiringDeps["deliver"];
  log?: (line: string) => void;
  now?: () => number;
  seams?: { clock?: DeskClock; calendars?: Partial<DeskCalendars> } & Partial<Pick<ScheduleDeps, "calendar" | "runScript" | "builtins" | "tickMs" | "graceMs">>;
}): ScheduleHandle {
  const log = opts.log ?? defaultLog;
  const seams = opts.seams ?? {};
  /* the clock seam, else the face's - on `now` when the owner's desk reads one (installDesk's), so the budget's day
   * and a firing's stamps agree with the conversation's (M7) */
  const clock = seams.clock ?? (opts.now === undefined ? FACE_CLOCK : { ...FACE_CLOCK, now: opts.now });
  /* the script producer's runner: the given interpreter, isolated */
  const runScript = seams.runScript ?? defaultProducerRunner(opts.python);
  const calendars = deskCalendars({ ...(seams.calendar === undefined ? {} : { us: seams.calendar }), ...seams.calendars });
  const { sessionCtx } = opts;
  const handle: ScheduleHandle = installSchedule({
    home: opts.home,
    root: opts.root,
    clock,
    calendar: calendars.us,
    calendars,
    runScript,
    builtins: deskBuiltins({ ...(opts.quotes === undefined ? {} : { quotes: opts.quotes }), root: opts.root, home: opts.home, now: () => clock.now() }, seams.builtins),
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
