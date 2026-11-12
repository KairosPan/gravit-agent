// face/src/watch.ts
/** The watch row (P3): the desk's eye on the operator's book between turns. It polls the Market's read for the US
 * shares and the A shares the book names, judges the operator's levels and rules on each print (src/watch-eval.ts),
 * sends each alert to the phone itself, the plan verbatim (src/alert-text.ts), posts its annotation to the
 * annotation lane - a why post for a US price move, a plan check otherwise - and alerts on a held name's new US filings (src/edgar.ts, src/filings.ts). Nothing here
 * places, cancels or proposes an order (B2).
 *
 * ONE WATCH PER HOME (ruling 7). `watch.lease` (`{ pid, since, beat }`, `0600`) names the face that watches; it
 * beats every {@link LEASE_BEAT_MS}. A lease whose pid is gone (`ESRCH` or `EPERM`) or whose beat is
 * {@link LEASE_STALE_MS} old is taken over - a check and a write under P0's lock on the file, then a re-read, so of
 * two faces only the pid the re-read names watches. Another face's live lease leaves this one `held-elsewhere`,
 * which it says once per ET date; the lease is retried each tick and released at `dispose` when it is this face's.
 * A lease step that throws (`EACCES`, `EROFS`, the lock's timeout) leaves the watch `lease-failed`, the reason in the
 * status's `leaseError`: it polls nothing and says so once per ET date; the next tick tries again. Either line waits
 * for a book that names something to watch, a check re-read only when a book file's stamp or the ET date changed.
 *
 * THE TICK, every {@link WATCH_TICK_MS}, each step caught - one `gravit-face: desk: watch <step>: <reason>` line per
 * distinct failure - and the next tick always armed: the lease; the ET date's line memories; the files (ruling 8:
 * `desk/levels.yml`, every `strategies/<name>/levels.yml`, `desk/holdings.yml`, `desk/rules.yml`, re-read on an
 * mtime or size change and on each new ET date, a broken file keeping its last good load, one line per distinct
 * change); an expired mute lifted; nothing to watch is `idle`, and the tick stops there - no calendar, no poll, no
 * line; the ledgers, read once before any pass is judged (`alerts.jsonl` into src/watch-eval.ts `rebuildDay`,
 * `filings.jsonl` into src/filings.ts `baselineFrom`; an unreadable `alerts.jsonl` judges nothing until it reads,
 * with one line; its orphans handled at that first read, see below); each
 * market, its calendar's answer for its own date, its window (a US share's from 04:00 ET of its date to the close
 * plus 4 h, 20:00 ET or 17:00 on an early close, its session handed over with the date of the one before it; an A
 * share's, ruling 2, 10 minutes before the open to a minute after the close) and a poll when due by its cadence
 * (ruling 3), never two in flight per market; a due batch; and the
 * filings (ruling 9), one single-flight poll when due, aborted at 120 s.
 *
 * A PASS is one market's poll - one snapshot over that market's ids alone - or one filings poll. Its hits are judged
 * synchronously and go on the send chain in order: the flags read once (OFF and MUTE, then the budget when an alert
 * would be annotated), each hit recorded with its gate's decision, each send delivered and its delivery recorded, and
 * then its posted alerts - an annotated hit that is a US price move (a why post: its headlines from the Market since
 * its reference close and its 8-K filings of the last 24 h, each read bounded at {@link WHY_READ_MS}, and the
 * read-through it asks for, {@link WatchDeps.readThrough}) or has a plan to
 * check; an A-share move with no plan is posted nothing - on a buffer that a second chain no pass waits on (ruling 5)
 * drains: it waits for the lane to be idle, then posts the whole buffer as one to the annotation lane (src/annotator.ts,
 * spec §16 H1), so passes that come while a turn runs are folded into one post and one `annotation` record; a batch
 * the hour's cap held gets no post. The lane's run comes back as one `annotated` record ({@link WatchHandle.noteAnnotated});
 * a send that dispose cuts off is recorded `{ undelivered: "the face shut down" }`, never delivered. A failed poll - rejected, or every quote
 * `unavailable` - judges nothing and says so once per session date per market; a watched symbol unpriced on its
 * first {@link UNPRICED_POLLS} polls of a session date says so once (ruling 16).
 *
 * THE ORPHANS (spec §16 H2). A `send` written with no `delivered` after it is an alert a restart caught between its
 * decision and its send. At the ledger's first read each is handled once, on the send chain ahead of any pass: one
 * younger than src/watch-eval.ts `ALERT_REPLAY_MS` is delivered late (alert-text.ts `lateAlertText`) and recorded
 * `replayed`, with no annotation post - a check would read a market that has moved; the older ones are one line
 * (`lostAlertsLine`) and each a `{ undelivered: "lost to a restart" }` record, left out of the hour's cap though
 * still in their keys' cooldowns. Whatever `deliver` answers is recorded, a pause's hold among them.
 *
 * A SHARES PAST THE XSHG TABLE. A failed A-share calendar answer once the Beijing date is past `XSHG_COVERED` is no
 * missing calendar: the session is 09:30-15:00 Beijing on a weekday, marked `uncovered`, said once per Beijing date.
 *
 * MODULE WEIGHT. src/desk.ts imports this file on first use, after src/schedule.ts, and only for its types
 * otherwise (tests/desk-weight.test.ts).
 * @module
 */
import { lstat, mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import {
  alertText, annotationPost, batchText, lateAlertText, lostAlertsLine, priceStamp, stateBody, WATCH_LINES, whyPost, type DeskStateView, type NearView, type WhyContext,
} from "./alert-text.ts";
import { listChannelDirs } from "./channels.ts";
import {
  ALERTS_FILE, appendChain, clearMute, deskDir, deskTime, EVENTS_FILE, FILINGS_FILE, readMuteState, readOffState, readRecords, WATCH_LEASE_FILE,
  type BudgetState, type MuteState,
} from "./desk.ts";
import {
  levelDistancePct, loadHoldings, loadLevels, loadRules, resolveSymbols, type Holding, type Level, type LevelKind, type LoadRefusal, type LoadResult, type Rule,
} from "./desk-book.ts";
import type { DeliverOpts, DeliverResult, DeskConversation, PostResult } from "./desk-conversation.ts";
import type { Annotator } from "./annotator.ts";
import type { DeskClock, DeskTurnRecord } from "./desk-session.ts";
import type { DeskLine } from "./conversation.ts";
import { createEdgar, type Edgar, type EdgarFetch, type EdgarResult, type Filing } from "./edgar.ts";
import { bjDate, etDate } from "./et.ts";
import {
  allRefused, baselineFrom, diffFilings, FILINGS_ABORT_MS, FILINGS_LOOKBACK_DAYS, FILINGS_STOP_AFTER_MS, filingSymbols, inFilingWindow, isFilingRecord, pollDue,
  seenKey, type Baseline, type FilingRecord,
} from "./filings.ts";
import { HttpError } from "./http.ts";
import { nyInstant, sessionBefore, sessionFor, xnysPrevious, xnysWindow, type DayAnswer, type DeskCalendars, type MarketSession } from "./market-clock.ts";
import type { NewsAnswer } from "./market-news.ts";
import type { MarketQuoteSource } from "./market-quotes.ts";
import type { ReadThroughAsk, ReadThroughEvent, ReadThroughLane } from "./readthrough-lane.ts";
import { idOf, type Market } from "./symbols.ts";
import {
  AFTER_HOURS_MS, alertId, batchDue, batchId, CLOSE_PRINT_MS, emptyDay, evaluatePass, findOrphans, gate, isAlertRecord, passId, priceKeys, REBUILD_WINDOW_MS, rebuildDay, snapOf,
  takeBatch, watchQuoteOf,
  type AlertAnnotation, type AlertBatch, type AlertDelivered, type AlertHit, type AlertRecord, type Hit, type PriceKey, type WatchDay, type WatchQuote,
} from "./watch-eval.ts";
import { XSHG_COVERED } from "./xshg-clock.ts";

/** How often the watch ticks: which polls are due, the lease, the files, the batch, the mute, the filings. */
export const WATCH_TICK_MS = 5_000;
/** A US poll's cadence: the proxy's 20 s explore cache (ruling 3). */
export const WATCH_US_POLL_MS = 20_000;
/** An A-share poll's cadence: two of the Account's 5 s China quote lives. */
export const WATCH_CN_POLL_MS = 10_000;
/** The most US symbols polled. */
export const WATCH_US_MAX = 40;
/** The most A-share symbols polled. */
export const WATCH_CN_MAX = 60;
/** How long before an A-share open its polls begin. A US share's begin at 04:00 ET of the session date. */
export const WATCH_LEAD_MS = 600_000;
/** How long after an A-share close they go on. A US share's go on to the close plus 4 h (20:00 ET, or 17:00 on an
 * early close): src/watch-eval.ts `AFTER_HOURS_MS`. */
export const WATCH_TAIL_MS = 60_000;
/** How often the face that watches rewrites its lease's beat. */
export const LEASE_BEAT_MS = 30_000;
/** How old a beat makes a lease stale. */
export const LEASE_STALE_MS = 120_000;
/** The most near levels the status and the desk state carry. */
export const NEAR_MAX = 10;
/** The most levels the status's `marks` carries, for the Markets rows. */
export const MARKS_MAX = 100;
/** How long the desk state waits for each market's snapshot. */
export const STATE_QUOTES_TIMEOUT_MS = 3_000;
/** How many polls of a session date a watched symbol may go unpriced before it is said. */
export const UNPRICED_POLLS = 3;

/** How near a level is "near", in percent of its last price (ruling 6). */
const NEAR_PCT = 2;
/** How long a why post waits for each of its reads - the headlines, the filings - before it says so and goes. */
export const WHY_READ_MS = 10_000;
/** What a why post says of its filings with no SEC contact. */
export const WHY_NO_SEC = "no SEC contact: ALPHA_EDGAR_USER_AGENT is not set";
/** The forms a why post's filings read asks for, whatever the filing rules name. */
const WHY_FORMS: readonly string[] = ["8-K", "8-K/A"];
/** How far back a why post's filings reach, by their acceptance time. */
const WHY_FILINGS_MS = 24 * 3_600_000;
/** How long `dispose` waits for the passes, the posts and the chains. */
const DISPOSE_WAIT_MS = 2_000;
/** How many alerts the status's `recent` lists. */
const RECENT_MAX = 10;
/** How long the watch keeps its records and its dated line memories in memory, for a reply's context and the
 * orphans; the crossing state is rebuilt from {@link REBUILD_WINDOW_MS} of the ledger, apart from it. */
const MEMORY_MS = 48 * 3_600_000;
const DAY_MS = 86_400_000;
const BIN = "gravit-face";
const MARKETS: readonly Market[] = ["us", "cn"];

/* ---------- the shapes ---------- */

/** What {@link installWatch} needs. `quotes` is the one source for both markets; `calendars` the desk's two;
 * `deliver` and `budget` the desk conversation's, `post` and `idle` the annotation lane's (src/annotator.ts) - with no
 * `idle` a post waits for nothing but the one before it; `news` the Market's headline read (src/market-news.ts), for
 * a why post - none, each symbol's headlines unavailable; `edgar`, SEC's fetch and contact - none, no filings and a
 * why post's filings unavailable; `readThrough` the read-through lane (src/readthrough-lane.ts), which a why post asks
 * whether each fallen company's event was given a direction - none, no read-through; `pid` this face's
 * (`process.pid`), `alive` whether a pid lives (`process.kill(pid, 0)`), `tickMs`, `log`. */
export interface WatchDeps {
  home: string;
  root: string;
  quotes?: MarketQuoteSource;
  calendars: DeskCalendars;
  clock: DeskClock;
  deliver: DeskConversation["deliver"];
  /** Note an alert or a batch `deliver` did not refuse as a line in Gravit's one conversation (src/conversation.ts
   * `note`, through src/desk.ts); none when absent - and never a late replay or the lost line. */
  note?: (line: DeskLine) => void;
  post: Annotator["post"];
  budget: () => Promise<BudgetState>;
  edgar?: { fetch: EdgarFetch; userAgent: string };
  news?: (symbols: readonly string[], since: string) => Promise<Map<string, NewsAnswer>>;
  idle?: () => Promise<void>;
  readThrough?: Pick<ReadThroughLane, "ready" | "given">;
  pid?: number;
  alive?: (pid: number) => boolean;
  tickMs?: number;
  log?: (line: string) => void;
}

/** One of the watch's files as it was last read: `missing` with no file, `error` for one refused whole - its
 * last good load kept, `entries` counting that - and `loadedAt` its last good load. */
export interface WatchFileStatus {
  file: string;
  kind: "levels" | "holdings" | "rules";
  missing?: true;
  entries: number;
  refusals: LoadRefusal[];
  error?: string;
  loadedAt?: string;
}

/** One alert as the status lists it: `feed` the print's, `latencyMs` the delivered record's `tradeMs` - `null` when
 * the send was queued or never went. */
export interface AlertSummary {
  id: string;
  t: string;
  market: Market;
  symbol: string;
  label: string;
  gap: boolean;
  price: number | null;
  feed: string | null;
  outcome: "pending" | "sent" | "queued" | "undelivered" | "suppressed";
  suppressed?: string;
  latencyMs: number | null;
  receivedMs?: number;
}

/** One market's part of the status. `off`: no source, the source `unavailable`, or no symbol in the market. */
export interface MarketWatchStatus {
  state: "off" | "no-calendar" | "closed" | "waiting" | "polling" | "after-close";
  session?: { date: string; open: string; close: string };
  watched: number;
  notWatched: string[];
  lastPollAt?: string;
  lastError?: string;
  uncovered?: true;
  today: { sent: number; suppressed: Record<"cooldown" | "cap" | "muted" | "off" | "window", number>; repeats: number };
}

/** A level for the Markets rows: its distance from its symbol's last polled price, `null` before one. */
export interface WatchMark {
  market: Market;
  symbol: string;
  kind: LevelKind;
  level: string;
  when: Level["when"];
  plan: string;
  file: string;
  distancePct: number | null;
}

/** What the watch reports: `/data/desk/status`'s `watch`. */
export interface WatchStatus {
  state: "starting" | "idle" | "held-elsewhere" | "lease-failed" | "watching" | "stopped";
  markets: Record<Market, MarketWatchStatus>;
  holder?: { pid: number; since: string };
  /** Why the lease step failed, while `lease-failed`: its code, else its message. */
  leaseError?: string;
  muted?: MuteState;
  files: WatchFileStatus[];
  near: NearView[];
  marks: WatchMark[];
  pending: number;
  recent: AlertSummary[];
  filings: { state: "off" | "no-contact" | "polling" | "refused-today"; symbols: number; aShares: number; seeded: number; lastPollAt?: string; lastError?: string };
  ledgerError?: string;
}

/** One annotation run's end, as the annotation lane (src/annotator.ts) reports it and `alerts.jsonl` keeps it (spec §16
 * H1): the pass it checked, its session, its turn's outcome, the ids of the messages its reply went out as
 * (`<network>:<id>`; an older record's numbers read as `telegram:<n>`) - none when the reply was held back or queued -
 * the reply, at most 2,000 characters, and `directions`, the ids of the read-through blocks appended to it - absent when
 * none. */
export type AnnotatedRecord = {
  t: string;
  kind: "annotated";
  pass: string;
  sessionId: string;
  outcome: DeskTurnRecord["outcome"];
  sent: string[];
  text: string;
  directions?: string[];
};

/** A message id as the watch keeps it, `<network>:<the network's own id>`. */
const MESSAGE_ID_RE = /^[a-z]{1,16}:\S{1,64}$/;

/** `x` as a message id: a `<network>:<id>` string as it is, a number an older record holds as Telegram's -
 * `telegram:<n>` (spec §8) - and `undefined` for anything else. */
export function messageIdOf(x: unknown): string | undefined {
  if (typeof x === "number") return Number.isSafeInteger(x) && x >= 0 ? `telegram:${x}` : undefined;
  return typeof x === "string" && MESSAGE_ID_RE.test(x) ? x : undefined;
}

/** A record's `sent` as message ids ({@link messageIdOf}); `undefined` when it is not a list of them. */
function idsOf(sent: unknown): string[] | undefined {
  if (!Array.isArray(sent)) return undefined;
  const ids = sent.map(messageIdOf);
  return ids.every((id): id is string => id !== undefined) ? ids : undefined;
}

/** `r` with the message ids it holds as strings: an older record's numbers become `telegram:<n>`. A `sent` that is not
 * a list of ids is left as it is - {@link WatchHandle.contextFor} reads no id from it. */
function withStringIds<R extends WatchRecord>(r: R): R {
  if (r.kind === "annotated") {
    /* `directions` kept only as a list of ids; anything else is dropped */
    const { directions, ...rest } = r;
    const kept = Array.isArray(directions) && directions.every((d) => typeof d === "string") ? { directions } : {};
    return { ...rest, sent: idsOf(r.sent) ?? [], ...kept } as R;
  }
  if (r.kind !== "delivered" && r.kind !== "batch") return r;
  const delivery = (r as { delivery?: unknown }).delivery;
  if (typeof delivery !== "object" || delivery === null || !("sent" in delivery)) return r;
  const ids = idsOf((delivery as { sent: unknown }).sent);
  return ids === undefined ? r : { ...r, delivery: { ...delivery, sent: ids } };
}

/** Whether `x` is an {@link AnnotatedRecord}, by the fields the watch reads back. */
export function isAnnotatedRecord(x: unknown): x is AnnotatedRecord {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return r.kind === "annotated" && typeof r.t === "string" && typeof r.pass === "string" && typeof r.sessionId === "string"
    && typeof r.outcome === "string" && idsOf(r.sent) !== undefined && typeof r.text === "string";
}

/** A line of `alerts.jsonl` as the watch keeps it: src/watch-eval.ts's four kinds and the lane's `annotated`. */
type WatchRecord = AlertRecord | AnnotatedRecord;
const isWatchRecord = (x: unknown): x is WatchRecord => isAlertRecord(x) || isAnnotatedRecord(x);

/** The running watch. `tick` runs one tick now (after any under way); `stateText` the desk state, `undefined`
 * unless watching; `noteAnnotated` appends an annotation run's record to `alerts.jsonl` and keeps it in memory with
 * the rest; `contextFor` what a phone reply to the message `messageId` answers (spec §16 H1b): from the records of the
 * last {@link MEMORY_MS}, an alert's message gives that alert's text, as sent with no note, and the annotation of its
 * pass when there is one; an annotation's message gives its pass's alerts and the annotation - at most
 * {@link CONTEXT_MAX} characters, and `undefined` for a message the watch did not send; `dispose` stops it and
 * releases the lease. */
export interface WatchHandle {
  tick(): Promise<void>;
  status(): WatchStatus;
  stateText(): Promise<string | undefined>;
  noteAnnotated(r: AnnotatedRecord): void;
  contextFor(messageId: string): string | undefined;
  dispose(): Promise<void>;
}

/** The most a reply's context ({@link WatchHandle.contextFor}) carries, in UTF-16 code units: one Telegram message. */
const CONTEXT_MAX = 4_000;

/** How the watch's sends go (src/phone.ts): an alert of a rule marked `urgent: true` as `urgent`, which quiet hours do
 * not hold, and so a batch or a late replay that carries one; every other alert, batch and late replay, the lost line
 * and the watch's own lines as `alert`. */
const ALERT: DeliverOpts = { kind: "alert" };
const URGENT: DeliverOpts = { kind: "urgent" };
/** How a send carrying `hits` goes - a batch, a late replay: `urgent` when any of them is an urgent rule's, else
 * `alert`. */
const kindOfHits = (hits: readonly AlertHit[]): DeliverOpts => (hits.some((h) => h.urgent === true) ? URGENT : ALERT);

/** `text` cut to at most `max` UTF-16 code units, never between the two halves of a surrogate pair. */
export function cutAt(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** The lease's contents. */
interface Lease { pid: number; since: string; beat: string }

/** One of the watch's book files. */
interface BookFile<T> {
  file: string;
  path: string;
  kind: WatchFileStatus["kind"];
  load: (path: string, file: string, today: string) => Promise<LoadResult<T>>;
  /** What lstat said last time (mtime, size, inode - or missing), and the ET date it was read on. */
  stamp?: string;
  date?: string;
  /** The last good load's entries and sha256. */
  good: T[];
  sha?: string;
  status: WatchFileStatus;
}

/** A hit before the gate: its record but for the decision, and a decision taken before the gate (a filing's
 * window or cooldown). */
type Pending = { record: Omit<AlertHit, "decision" | "suppressed" | "id">; pre?: "window" | "cooldown" };

/** A pass's posted alerts waiting for the annotation lane: its pass, its hits, the message its post replies to, and
 * whether any of its hits is an urgent rule's. */
type PostEntry = { pass: string; hits: AlertHit[]; replyTo: string | undefined; urgent: boolean };

/* ---------- small helpers ---------- */

const iso = (ms: number): string => new Date(ms).toISOString();
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): unknown => (err as { code?: unknown } | null | undefined)?.code;
/** A failure as a line names it: its code when it has one, else its message. */
const reasonOf = (err: unknown): string => {
  const code = codeOf(err);
  return typeof code === "string" ? code : errText(err);
};
const isAbsent = (err: unknown): boolean => codeOf(err) === "ENOENT" || codeOf(err) === "ENOTDIR";
const marketDate = (m: Market, at: number): string => (m === "us" ? etDate(new Date(at)) : bjDate(new Date(at)));
const levelText = (l: Pick<Level, "price" | "range">): string => (l.range !== undefined ? `${l.range[0]}-${l.range[1]}` : String(l.price));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Whether `pid` lives: `process.kill(pid, 0)` answers without throwing. `ESRCH` (gone) and `EPERM` (another user's
 * process, so not a face on this home) are both no. */
export function pidAlive(pid: number, kill: (pid: number, signal: 0) => unknown = (p, s) => process.kill(p, s)): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The lease's text as a lease, or `undefined` for anything else. */
function leaseOf(text: string): Lease | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const { pid, since, beat } = (parsed ?? {}) as Partial<Record<keyof Lease, unknown>>;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return undefined;
  if (typeof since !== "string" || typeof beat !== "string" || !Number.isFinite(Date.parse(beat))) return undefined;
  return { pid, since, beat };
}

/** The lease on disk; `undefined` with none or one that is no lease. A read that fails otherwise rejects. */
async function readLease(path: string): Promise<Lease | undefined> {
  try {
    return leaseOf(await readFile(path, "utf8"));
  } catch (err) {
    if (isAbsent(err)) return undefined;
    throw err;
  }
}

/** One refusal as a `watch-load` event lists it, as the phone line does. */
function refusalText(r: LoadRefusal): string {
  const place = r.index === undefined ? "" : `#${r.index + 1}${r.symbol !== undefined ? ` ${r.symbol}` : ""}: `;
  return `${place}${r.reason}`;
}

/** The ET date `days` before `date`. */
function daysBefore(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** The A-share session past the XSHG table: 09:30-15:00 Beijing on a weekday of the Beijing date of `at`. */
function cnPastSession(at: number): MarketSession | "closed" {
  const date = bjDate(new Date(at));
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (wd === 0 || wd === 6) return "closed";
  return { date, open: `${date}T01:30:00Z`, close: `${date}T07:00:00Z`, early: false };
}

const emptyToday = (): MarketWatchStatus["today"] => ({ sent: 0, suppressed: { cooldown: 0, cap: 0, muted: 0, off: 0, window: 0 }, repeats: 0 });

/* ---------- the watch ---------- */

/**
 * Install the watch: its boot - the ledgers read, then the first tick - on the clock's next timer turn, and a tick
 * every `tickMs` after (see the module header).
 * @param deps - see {@link WatchDeps}.
 */
export function installWatch(deps: WatchDeps): WatchHandle {
  const { home, root, clock } = deps;
  const pid = deps.pid ?? process.pid;
  const alive = deps.alive ?? ((p: number) => pidAlive(p));
  const tickMs = deps.tickMs ?? WATCH_TICK_MS;
  const log = deps.log ?? ((line: string): void => { console.error(line); });
  const dir = deskDir(home);
  const leasePath = join(dir, WATCH_LEASE_FILE);
  const alerts = appendChain(home, ALERTS_FILE, { log });
  const filingsLedger = appendChain(home, FILINGS_FILE, { log });
  const events = appendChain(home, EVENTS_FILE, { log });
  const edgar: Edgar | undefined = deps.edgar === undefined ? undefined : createEdgar({ fetch: deps.edgar.fetch, userAgent: deps.edgar.userAgent, now: () => clock.now() });

  /* ---- what the watch knows ---- */
  let state: WatchStatus["state"] = "starting";
  let holder: { pid: number; since: string } | undefined;
  let leaseBeat: number | undefined;
  let leaseError: string | undefined;
  let muted: MuteState | undefined;
  let day: WatchDay = emptyDay();
  let alertsRead = false;
  let ledgerError: string | undefined;
  let baseline: Baseline = { seeded: new Set(), seen: new Set() };
  let filingsRead = false;
  /** The alert records of the last {@link MEMORY_MS}: the rebuild's, then this run's, in order. */
  let records: WatchRecord[] = [];
  /** Each delivered record by its alert's id. */
  const deliveries = new Map<string, AlertDelivered>();
  /** The last priced print of each `market:symbol`. */
  const lastQuotes = new Map<string, WatchQuote>();
  const markets: Record<Market, MarketWatchStatus> = { us: { state: "off", watched: 0, notWatched: [], today: emptyToday() }, cn: { state: "off", watched: 0, notWatched: [], today: emptyToday() } };
  const inflight: Record<Market, boolean> = { us: false, cn: false };
  const lastStart: Partial<Record<Market, number>> = {};
  /** Each market's watched symbols by session date: how many polls answered, and whether one priced it. */
  const unpriced: Record<Market, { date?: string; seen: Map<string, { polls: number; priced: boolean }> }> = { us: { seen: new Map() }, cn: { seen: new Map() } };
  /** Each market's repeats its keys' cooldowns swallowed on a session date, as this run counted them. */
  const repeats: Record<Market, { date?: string; n: number }> = { us: { n: 0 }, cn: { n: 0 } };
  const filings: WatchStatus["filings"] = { state: "off", symbols: 0, aShares: 0, seeded: 0 };
  let filingsInflight = false;
  let filingsLastStart: number | undefined;
  let filingsRefusedOn: string | undefined;
  let filingsAbort: AbortController | undefined;

  /* ---- the book ---- */
  const bookFile = <T>(file: string, kind: WatchFileStatus["kind"], load: BookFile<T>["load"]): BookFile<T> => ({
    file, path: join(root, ...file.split("/")), kind, load, good: [], status: { file, kind, entries: 0, refusals: [] },
  });
  const holdingsFile = bookFile<Holding>("desk/holdings.yml", "holdings", (p, f) => loadHoldings(p, f));
  const levelsFile = bookFile<Level>("desk/levels.yml", "levels", (p, f, today) => loadLevels(p, f, today));
  const rulesFile = bookFile<Rule>("desk/rules.yml", "rules", (p, f) => loadRules(p, f));
  const strategyFiles = new Map<string, BookFile<Level>>();
  let filesRead = false;
  let book: { holdings: Holding[]; levels: Level[]; rules: Rule[] } = { holdings: [], levels: [], rules: [] };
  let keys: PriceKey[] = [];

  /* ---- the line memories: once ever (the files', the ledger's), once a dated key (the rest) ---- */
  const saidEver = new Set<string>();
  const saidOn = new Map<string, number>();
  const failed = new Set<string>();
  let lastEt: string | undefined;

  /* ---- the chains: sends in order, posts on their own, and every pass and poll in flight ---- */
  let sendChain: Promise<void> = Promise.resolve();
  let postChain: Promise<void> = Promise.resolve();
  const flights = new Set<Promise<void>>();
  let tickChain: Promise<void> = Promise.resolve();
  let ticking: Promise<void> | undefined;
  let timer: unknown;
  let stopped = false;
  let disposing: Promise<void> | undefined;

  /** One line per distinct failure of a step; the step's next success says nothing. */
  const fail = (step: string, err: unknown): void => {
    const line = `${BIN}: desk: watch ${step}: ${reasonOf(err)}`;
    if (failed.has(line)) return;
    failed.add(line);
    log(line);
  };
  /** An alert the phone got, noted in the conversation (`deps.note`); a note that throws is one line. */
  const noteLine = (line: DeskLine): void => {
    if (deps.note === undefined) return;
    try {
      deps.note(line);
    } catch (err) {
      fail("note", err);
    }
  };
  /** Queue `job` behind every send before it; it never rejects. */
  const onSendChain = (job: () => Promise<void>): void => {
    sendChain = sendChain.then(job).catch((err: unknown) => { fail("send", err); });
  };
  /** Send `text` once for `key`: `ever` for a memory that never lapses. */
  const sayOnce = (key: string, text: string, opts: { ever?: boolean; at: number; replyTo?: string }): void => {
    if (opts.ever === true ? saidEver.has(key) : saidOn.has(key)) return;
    if (opts.ever === true) saidEver.add(key);
    else saidOn.set(key, opts.at);
    const replyTo = opts.replyTo;
    onSendChain(async () => {
      if (stopped) return;
      await deps.deliver(text, replyTo === undefined ? ALERT : { ...ALERT, replyTo });
    });
  };
  const track = (work: Promise<void>): void => {
    flights.add(work);
    void work.finally(() => { flights.delete(work); });
  };

  /* ---------- the lease ---------- */

  const stale = (l: Lease, at: number): boolean => !alive(l.pid) || at - Date.parse(l.beat) >= LEASE_STALE_MS;

  /** The lease step: whether this face holds the lease after it, beating or taking it over as due. */
  async function leaseStep(at: number): Promise<boolean> {
    if (leaseBeat !== undefined && at - leaseBeat < LEASE_BEAT_MS) return true;
    await mkdir(dir, { recursive: true });
    const seen = await readLease(leasePath);
    if (seen !== undefined && seen.pid !== pid && !stale(seen, at)) return heldBy(seen, at);
    await withFileLock(leasePath, async () => {
      if (stopped) return;
      const current = await readLease(leasePath);
      if (current !== undefined && current.pid !== pid && !stale(current, at)) return;
      const since = current?.pid === pid ? current.since : iso(at);
      await writeFileAtomic(leasePath, `${JSON.stringify({ pid, since, beat: iso(at) } satisfies Lease)}\n`, { mode: 0o600 });
    });
    const after = await readLease(leasePath);
    if (after?.pid !== pid) return after === undefined ? false : heldBy(after, at);
    leaseBeat = at;
    holder = { pid, since: after.since };
    return true;
  }

  /** Another face holds the lease: one log line per holder; the phone line is the tick's ({@link heldLine}). */
  function heldBy(other: Lease, at: number): false {
    void at;
    leaseBeat = undefined;
    holder = { pid: other.pid, since: other.since };
    const line = `${BIN}: desk: another face (pid ${other.pid}) runs the watch on this home; this one does not`;
    if (!failed.has(line)) {
      failed.add(line);
      log(line);
    }
    return false;
  }

  /** The last {@link bookHasWatch} answer: the stamps it was read under, its ET date and the strategies it listed. */
  let bookCheck: { stamp: string; date: string; names: string[]; answer: boolean } | undefined;

  /** The book files' stamps (mtime, size, inode - or missing) and the strategies directory's, as one string. */
  async function bookStamp(names: readonly string[]): Promise<string> {
    const paths = [holdingsFile.path, levelsFile.path, rulesFile.path, join(root, "strategies"), ...names.map((name) => join(root, "strategies", name, "levels.yml"))];
    const stamps = await Promise.all(paths.map(async (path) => {
      try {
        const s = await lstat(path);
        return `${s.mtimeMs}:${s.size}:${s.ino}`;
      } catch (err) {
        return isAbsent(err) ? "missing" : `error:${reasonOf(err)}`;
      }
    }));
    return stamps.join("|");
  }

  /** Whether the book on disk names anything to watch - a price key or a US filing symbol - saying nothing: a face
   * that does not watch never phones the book's lines, and with nothing to watch sends none. It is read afresh only
   * when a file's stamp or the strategies directory's changed, or on a new ET date; else the last answer stands. */
  async function bookHasWatch(today: string): Promise<boolean> {
    if (bookCheck !== undefined && bookCheck.date === today && (await bookStamp(bookCheck.names)) === bookCheck.stamp) return bookCheck.answer;
    const loads = async <T>(load: Promise<LoadResult<T>>): Promise<T[]> => (await load.catch(() => undefined))?.entries ?? [];
    let strategies: string[] = [];
    try {
      strategies = (await listChannelDirs(root)).filter((c) => !c.isRoot).map((c) => c.name);
    } catch (err) {
      fail("strategies", err);
    }
    const holdings = await loads(loadHoldings(holdingsFile.path, holdingsFile.file));
    const rules = await loads(loadRules(rulesFile.path, rulesFile.file));
    const levels = [
      ...await loads(loadLevels(levelsFile.path, levelsFile.file, today)),
      ...(await Promise.all(strategies.map((name) => loads(loadLevels(join(root, "strategies", name, "levels.yml"), `strategies/${name}/levels.yml`, today))))).flat(),
    ];
    const answer = priceKeys({ holdings, levels, rules }).length > 0 || filingSymbols(rules, { holdings, levels }).polled.length > 0;
    bookCheck = { stamp: await bookStamp(strategies), date: today, names: strategies, answer };
    return answer;
  }

  /** The held-elsewhere line, once per ET date, and only when there is something to watch (Starting). */
  async function heldLine(at: number): Promise<void> {
    if (holder === undefined || holder.pid === pid) return;
    const today = etDate(new Date(at));
    if (saidOn.has(`held:${today}`)) return;
    if (!(await bookHasWatch(today))) return;
    sayOnce(`held:${today}`, WATCH_LINES.heldElsewhere(holder.pid), { at });
  }

  /** The lease-failed line, once per ET date, and only when there is something to watch (Starting). */
  async function leaseFailedLine(at: number, reason: string): Promise<void> {
    const today = etDate(new Date(at));
    if (saidOn.has(`leaseFailed:${today}`)) return;
    if (!(await bookHasWatch(today))) return;
    sayOnce(`leaseFailed:${today}`, WATCH_LINES.leaseFailed(reason), { at });
  }

  /** Release the lease when it is this face's. */
  async function releaseLease(): Promise<void> {
    if (leaseBeat === undefined) return;
    leaseBeat = undefined;
    try {
      await withFileLock(leasePath, async () => {
        if ((await readLease(leasePath))?.pid === pid) await unlink(leasePath);
      });
    } catch (err) {
      fail("lease release", err);
    }
  }

  /* ---------- the files ---------- */

  /** Re-read `f` when it changed or the ET date did; whether its entries changed. */
  async function readBookFile<T>(f: BookFile<T>, today: string, at: number): Promise<boolean> {
    let stamp: string;
    try {
      const s = await lstat(f.path);
      stamp = `${s.mtimeMs}:${s.size}:${s.ino}`;
    } catch (err) {
      stamp = isAbsent(err) ? "missing" : `error:${reasonOf(err)}`;
    }
    if (stamp === f.stamp && today === f.date) return false;
    f.stamp = stamp;
    f.date = today;
    const r = await f.load(f.path, f.file, today);
    if (r.missing === true) {
      const had = f.good.length > 0;
      f.good = [];
      f.sha = undefined;
      f.status = { file: f.file, kind: f.kind, missing: true, entries: 0, refusals: [] };
      return had;
    }
    if (r.error !== undefined) {
      const { missing: _missing, ...last } = f.status;
      f.status = { ...last, entries: f.good.length, refusals: [], error: r.error };
      if (!saidEver.has(`file:${f.file}:error:${r.error}`)) events.append({ t: iso(at), kind: "watch-load", file: f.file, loaded: f.good.length, refused: [], error: r.error });
      sayOnce(`file:${f.file}:error:${r.error}`, WATCH_LINES.fileRefused(f.file, r.error), { ever: true, at });
      return false;
    }
    /* the boot's first read is the baseline: a clean file then says nothing */
    const first = !filesRead;
    f.good = r.entries;
    f.status = { file: f.file, kind: f.kind, entries: r.entries.length, refusals: r.refusals, loadedAt: iso(at) };
    const sha = r.sha256 ?? "";
    if (r.refusals.length > 0) {
      const key = `file:${f.file}:${sha}:${JSON.stringify(r.refusals.map(refusalText))}`;
      if (!saidEver.has(key)) events.append({ t: iso(at), kind: "watch-load", file: f.file, loaded: r.entries.length, refused: r.refusals.map(refusalText) });
      sayOnce(key, WATCH_LINES.fileLoaded(f.file, r.entries.length, r.refusals), { ever: true, at });
    } else if (!first && sha !== f.sha) {
      const key = `file:${f.file}:${sha}`;
      if (!saidEver.has(key)) events.append({ t: iso(at), kind: "watch-load", file: f.file, loaded: r.entries.length, refused: [] });
      sayOnce(key, WATCH_LINES.fileChanged(f.file, sha, r.entries.length), { ever: true, at });
    }
    f.sha = sha;
    return true;
  }

  /** The files step: every book file re-read as due, the book and its keys rebuilt when one changed. */
  async function filesStep(at: number): Promise<void> {
    const today = etDate(new Date(at));
    const wasRead = filesRead;
    let names: string[] | undefined;
    try {
      names = (await listChannelDirs(root)).filter((c) => !c.isRoot).map((c) => c.name);
    } catch (err) {
      fail("strategies", err);
    }
    let changed = false;
    if (names !== undefined) {
      for (const name of [...strategyFiles.keys()]) {
        if (!names.includes(name)) {
          changed = changed || (strategyFiles.get(name)?.good.length ?? 0) > 0;
          strategyFiles.delete(name);
        }
      }
      for (const name of names) {
        if (!strategyFiles.has(name)) strategyFiles.set(name, bookFile<Level>(`strategies/${name}/levels.yml`, "levels", (p, f, d) => loadLevels(p, f, d)));
      }
    }
    for (const f of [holdingsFile, levelsFile, rulesFile]) {
      try {
        if (await readBookFile<unknown>(f as BookFile<unknown>, today, at)) changed = true;
      } catch (err) {
        fail(`load ${f.file}`, err);
      }
    }
    for (const f of strategyFiles.values()) {
      try {
        if (await readBookFile(f, today, at)) changed = true;
      } catch (err) {
        fail(`load ${f.file}`, err);
      }
    }
    filesRead = true;
    if (!changed && wasRead) return;
    book = {
      holdings: holdingsFile.good,
      levels: [...levelsFile.good, ...[...strategyFiles.values()].flatMap((f) => f.good)],
      rules: rulesFile.good,
    };
    keys = priceKeys(book);
  }

  const fileStatuses = (): WatchFileStatus[] => [levelsFile.status, ...[...strategyFiles.values()].map((f) => f.status), holdingsFile.status, rulesFile.status];

  /* ---------- the symbols ---------- */

  /** A market's symbols to poll, in rank: the held ones, then the levels' in file order, then the rules', sorted. */
  function rankedSymbols(m: Market): string[] {
    const keyed = new Set(keys.filter((k) => k.market === m).map((k) => k.symbol));
    const out: string[] = [];
    const add = (s: string): void => {
      if (keyed.has(s) && !out.includes(s)) out.push(s);
    };
    for (const h of book.holdings) if (h.market === m) add(h.symbol);
    for (const l of book.levels) if (l.market === m) add(l.symbol);
    for (const s of [...keyed].sort()) add(s);
    return out;
  }

  const sourceOk = (): boolean => deps.quotes !== undefined && deps.quotes.unavailable === undefined;

  /* ---------- the markets ---------- */

  /** One market's step: its calendar, its window, and its poll when due. Returns the calendar's answer, when asked. */
  async function marketStep(m: Market, at: number): Promise<DayAnswer | undefined> {
    const mk = markets[m];
    const symbols = sourceOk() ? rankedSymbols(m) : [];
    const max = m === "us" ? WATCH_US_MAX : WATCH_CN_MAX;
    mk.watched = Math.min(symbols.length, max);
    mk.notWatched = symbols.slice(max);
    if (symbols.length === 0) {
      mk.state = "off";
      delete mk.session;
      delete mk.uncovered;
      return undefined;
    }
    let answer: DayAnswer;
    try {
      answer = await deps.calendars[m].today(at);
    } catch (err) {
      answer = { ok: false, date: marketDate(m, at), error: errText(err) };
    }
    let session: MarketSession | undefined;
    let uncovered = false;
    if (!answer.ok) {
      if (m === "cn" && bjDate(new Date(at)) > XSHG_COVERED.through) {
        const past = cnPastSession(at);
        if (past !== "closed") {
          session = past;
          uncovered = true;
        }
      } else {
        mk.state = "no-calendar";
        mk.lastError = answer.error;
        delete mk.session;
        delete mk.uncovered;
        if (m === "us") sayOnce(`noCalendar:${answer.date}`, WATCH_LINES.noCalendar(answer.error), { at });
        else fail("cn calendar", new Error(`${answer.date}: ${answer.error}`));
        return answer;
      }
    } else if (answer.session !== "closed") {
      session = answer.session;
    }
    if (session === undefined) {
      mk.state = "closed";
      delete mk.session;
      delete mk.uncovered;
      return answer;
    }
    mk.session = { date: session.date, open: session.open, close: session.close };
    if (uncovered) mk.uncovered = true;
    else delete mk.uncovered;
    /* a US share from 04:00 ET of its date to the close plus 4 h; an A share ten minutes before the open to a minute
     * after the close */
    const from = m === "us" ? Date.parse(nyInstant(session.date, 4, 0)) : Date.parse(session.open) - WATCH_LEAD_MS;
    const to = Date.parse(session.close) + (m === "us" ? AFTER_HOURS_MS : WATCH_TAIL_MS);
    mk.state = at < from ? "waiting" : at >= to ? "after-close" : "polling";
    if (mk.state !== "polling") return answer;
    if (uncovered) sayOnce(`pastTable:${session.date}`, WATCH_LINES.cnPastTable(XSHG_COVERED.through), { at });
    if (mk.notWatched.length > 0) sayOnce(`overCap:${m}:${session.date}:${mk.notWatched.join(",")}`, WATCH_LINES.overCap(m, max, mk.notWatched), { at });
    const cadence = m === "us" ? WATCH_US_POLL_MS : WATCH_CN_POLL_MS;
    const last = lastStart[m];
    if (!inflight[m] && (last === undefined || at - last >= cadence)) {
      inflight[m] = true;
      lastStart[m] = at;
      mk.lastPollAt = iso(at);
      const watched = symbols.slice(0, max);
      const sessions = m === "us" ? { us: { ...session, prev: prevSession(session.date) } } : { cn: uncovered ? { ...session, uncovered: true as const } : session };
      track((async () => {
        try {
          await pricePass(m, watched, session, sessions, at);
        } catch (err) {
          fail(`${m} pass`, err);
        } finally {
          inflight[m] = false;
        }
      })());
    }
    return answer;
  }

  /** The date of the US session before `date`: the calendar's window's, else the XNYS rules' (the calendar's window
   * starts on the date it was asked for, so it rarely holds the one before); the date itself, as a last resort, when
   * neither can say - every print of the session then measures from one reference. */
  function prevSession(date: string): string {
    return sessionBefore(deps.calendars.us.window(), date) ?? xnysPrevious(date) ?? date;
  }

  /** A failed poll: its reason the market's `lastError`, said once per session date. */
  function failedPoll(m: Market, date: string, reason: string, at: number): void {
    markets[m].lastError = reason;
    sayOnce(`noPrices:${m}:${date}`, WATCH_LINES.noPrices(m, reason), { at });
  }

  /** One market's poll: one snapshot over its ids alone, mapped and judged. */
  async function pricePass(m: Market, watched: string[], session: MarketSession, sessions: Parameters<typeof evaluatePass>[3], at: number): Promise<void> {
    const source = deps.quotes;
    if (source === undefined) return;
    let payload;
    try {
      payload = await source.snapshot(watched.map((symbol) => ({ id: idOf(m, symbol), market: m, symbol })));
    } catch (err) {
      failedPoll(m, session.date, err instanceof HttpError && err.status === 429 ? "busy" : errText(err), at);
      return;
    }
    const own = payload.quotes.filter((q) => q.market === m);
    const quotes = own.map(watchQuoteOf);
    const pricedOf = (q: WatchQuote | undefined): boolean => q !== undefined && q.status !== "unavailable" && q.price !== null;
    if (!quotes.some(pricedOf)) {
      failedPoll(m, session.date, own.find((q) => q.message !== "")?.message ?? "the Market read answered no quote", at);
      return;
    }
    delete markets[m].lastError;
    for (const q of quotes) if (pricedOf(q)) lastQuotes.set(`${m}:${q.symbol}`, q);
    /* a symbol unpriced on its first polls of the session date (ruling 16) */
    const u = unpriced[m];
    if (u.date !== session.date) {
      u.date = session.date;
      u.seen = new Map();
    }
    for (const symbol of watched) {
      const q = quotes.find((x) => x.symbol === symbol);
      const seen = u.seen.get(symbol) ?? { polls: 0, priced: false };
      seen.polls += 1;
      if (pricedOf(q)) seen.priced = true;
      u.seen.set(symbol, seen);
      if (!seen.priced && seen.polls === UNPRICED_POLLS) {
        const reason = own.find((x) => x.symbol === symbol)?.message || "the Market read answered no quote for it";
        sayOnce(`unpriced:${m}:${session.date}:${symbol}:${reason}`, WATCH_LINES.unpriced(symbol, reason), { at });
      }
    }
    const watchedSet = new Set(watched);
    const judged = keys.filter((k) => k.market === m && watchedSet.has(k.symbol));
    const before = new Map(judged.map((k) => [k.key, day.keys.get(k.key)] as const));
    const counts = new Map([...before].map(([key, kd]) => [key, kd?.repeats ?? 0] as const));
    const hits = evaluatePass(day, judged, quotes, sessions, at);
    /* the repeats this pass swallowed, on the session date it judged: a US key's reference is the previous close in
     * pre-market and the session, so its day's repeats cannot be told by its reference */
    let swallowed = 0;
    for (const [key, kd] of before) {
      const now = day.keys.get(key);
      if (now !== undefined) swallowed += now.repeats - (now === kd ? (counts.get(key) ?? 0) : 0);
    }
    if (swallowed > 0) {
      const r = repeats[m];
      if (r.date !== session.date) {
        r.date = session.date;
        r.n = 0;
      }
      r.n += swallowed;
    }
    if (hits.length === 0) return;
    const pass = passId();
    queueHits(pass, hits.map((h) => ({ record: priceRecord(h, pass, at) })), at);
  }

  /** The holding a symbol's alert names. */
  const holdingOf = (symbol: string): AlertHit["holding"] => {
    const h = book.holdings.find((x) => x.symbol === symbol);
    return h === undefined ? null : { qty: h.qty, avgCost: h.avgCost };
  };

  /** Whether a sent alert gets a why turn (spec §5.3): a US price move, a `move` hit (labelled `gap` or not) or a
   * `gap` rule's. */
  const whyOf = (rec: AlertHit): boolean => rec.market === "us" && (rec.trigger.type === "move" || rec.trigger.type === "gap");

  /** A price hit's record, but for its id and decision. */
  function priceRecord(h: Hit, pass: string, at: number): Pending["record"] {
    return {
      t: iso(at), kind: "alert", pass, date: h.date, key: h.key.key, market: h.key.market, symbol: h.key.symbol, label: h.key.label,
      trigger: h.key.trigger, gap: h.gap, quote: snapOf(h.quote), holding: holdingOf(h.key.symbol), plan: h.key.plan, source: h.key.source,
      annotate: h.key.annotate, ref: h.ref,
      ...(h.phase !== undefined ? { phase: h.phase } : {}),
      ...(h.onePrint === true ? { onePrint: true as const } : {}),
      ...(h.key.urgent ? { urgent: true as const } : {}),
    };
  }

  /* ---------- the sends ---------- */

  /** OFF and MUTE as in force at `at`; a switch that cannot be read is one line, and not in force. */
  async function flagsAt(at: number): Promise<{ off: boolean; muted: boolean }> {
    let off = false;
    let mute = false;
    try {
      const o = await readOffState(home, () => at);
      off = o.state !== undefined && !o.expired;
    } catch (err) {
      fail("OFF", err);
    }
    try {
      const s = await readMuteState(home, () => at);
      mute = s.state !== undefined && !s.expired;
    } catch (err) {
      fail("MUTE", err);
    }
    return { off, muted: mute };
  }

  /** Record a pass's hits, deliver its sends in order, and queue its annotation - on the send chain. */
  function queueHits(pass: string, pending: Pending[], at: number): void {
    onSendChain(async () => {
      const needsGate = pending.some((p) => p.pre === undefined);
      const flags = needsGate ? await flagsAt(at) : { off: false, muted: false };
      const decided: AlertHit[] = pending.map((p) => {
        const id = alertId();
        const g = p.pre !== undefined ? { send: false as const, suppressed: p.pre } : gate(day, at, flags, id);
        const rec: AlertHit = g.send ? { ...p.record, id, decision: "send" } : { ...p.record, id, decision: "suppressed", suppressed: g.suppressed };
        records.push(rec);
        alerts.append(rec);
        return rec;
      });
      const sends = decided.filter((r) => r.decision === "send");
      if (sends.length === 0) return;
      let spent = false;
      if (sends.some((r) => r.annotate)) {
        try {
          spent = (await deps.budget()).spent;
        } catch (err) {
          fail("budget", err);
        }
      }
      const delivered: { rec: AlertHit; result: DeliverResult }[] = [];
      for (const rec of sends) {
        /* dispose has begun: no deliver after it and no post, and each send left is recorded undelivered, so none
         * stays pending */
        /* a why turn for a US price move; a plan check for another annotated hit with a plan; an A-share move with
         * no plan is posted nothing (why-it-moved task 10), so nothing is said to follow, the budget or not */
        const why = whyOf(rec);
        const note = !rec.annotate || (!why && rec.plan === null) ? "none" : spent ? "budget" : why ? "why" : "follows";
        let result: DeliverResult;
        if (stopped) result = { undelivered: "the face shut down" };
        else {
          /* the text built inside the try, as before: a throw is this alert's undelivered answer, never the pass's */
          let text = "";
          try {
            text = alertText(rec, clock.now(), note);
            result = await deps.deliver(text, rec.urgent === true ? URGENT : ALERT);
          } catch (err) {
            result = { undelivered: `send failed: ${errText(err)}` };
          }
          if (!("undelivered" in result)) noteLine({ kind: "alert", alert: rec.id, symbol: rec.symbol, label: rec.label, text });
        }
        const done = clock.now();
        const sent = "sent" in result;
        const asOf = rec.quote === null ? Number.NaN : Date.parse(rec.quote.asOf);
        const received = rec.quote?.receivedAt == null ? Number.NaN : Date.parse(rec.quote.receivedAt);
        const d: AlertDelivered = {
          t: iso(done), kind: "delivered", id: rec.id, delivery: result,
          latency: { tradeMs: sent && Number.isFinite(asOf) ? done - asOf : null, receivedMs: sent && Number.isFinite(received) ? done - received : null },
        };
        records.push(d);
        deliveries.set(rec.id, d);
        alerts.append(d);
        if (!("undelivered" in result)) delivered.push({ rec, result });
      }
      if (stopped) return;
      /* posted: an annotated alert that gets a why turn or has a plan to check - the hits whose note was not "none" */
      const posted = delivered.filter((d) => d.rec.annotate && (whyOf(d.rec) || d.rec.plan !== null));
      if (spent || posted.length === 0) return;
      /* the post replies to the first posted alert delivered - none when the outlet queued it (ruling 16) */
      const first = posted[0];
      const replyTo = "sent" in first.result ? first.result.sent[0] : undefined;
      queuePost({ pass, hits: posted.map((d) => d.rec), replyTo, urgent: posted.some((d) => d.rec.urgent === true) });
    });
  }

  /** A pass's posted alerts waiting for the annotation lane (why-it-moved task 10), and whether a drain runs. */
  const postBuffer: PostEntry[] = [];
  let draining = false;

  /** Put a pass's posted alerts on the buffer, and start the drain on the post chain unless one runs. The drain waits
   * for the lane to be idle (`deps.idle`), takes the whole buffer, posts it as one ({@link postFolded}) and goes round
   * again while entries wait - so the passes that come while a turn runs are folded into one post when it ends. No
   * wait comes before a post when the lane is idle. */
  function queuePost(entry: PostEntry): void {
    postBuffer.push(entry);
    if (draining) return;
    draining = true;
    postChain = postChain.then(async () => {
      try {
        while (postBuffer.length > 0 && !stopped) {
          await deps.idle?.().catch(() => {});
          if (stopped) break;
          const taken = postBuffer.splice(0);
          try {
            await postFolded(taken);
          } catch (err) {
            fail("post", err);
          }
        }
      } finally {
        draining = false;
      }
    }).catch((err: unknown) => { fail("post", err); });
  }

  /** One post over `entries`' hits, in order: the first entry's pass and reply, `urgent` if any entry's is - a why
   * post when any hit is a US price move, else the plan check; then one annotation record naming every alert, and a
   * refused post's line as a reply once per ET date. A why post asks the read-through ({@link readThroughOf}) for the
   * fallen companies with no direction on record and lists the others for the face's line; when that variant cannot be
   * built it is one line and the plain why post goes - a read-through never costs the reason. */
  async function postFolded(entries: readonly PostEntry[]): Promise<void> {
    const hits = entries.flatMap((e) => e.hits);
    const { pass, replyTo } = entries[0]!;
    const urgent = entries.some((e) => e.urgent);
    let r: PostResult;
    try {
      const ctx = hits.some(whyOf) ? await whyContext(hits) : undefined;
      if (stopped) return;
      let readThrough: { asks: ReadThroughAsk[]; later: ReadThroughEvent[] } | undefined;
      let body: ReturnType<typeof whyPost> | undefined;
      if (ctx !== undefined) {
        try {
          readThrough = await readThroughOf(hits);
          if (stopped) return;
          if (readThrough !== undefined) body = whyPost(hits, pass, clock.now(), ctx, { readThrough: readThrough.asks.map((a) => a.symbol) });
        } catch (err) {
          log(`${BIN}: desk: watch read-through: ${errText(err)}; the why post goes without it`);
          readThrough = undefined;
          body = undefined;
        }
      }
      const at = clock.now();
      body ??= ctx === undefined ? annotationPost(hits, pass, at) : whyPost(hits, pass, at, ctx);
      r = await deps.post({
        ...body,
        ...(replyTo === undefined ? {} : { replyTo }),
        ...(urgent ? { urgent: true } : {}),
        ...(readThrough === undefined ? {} : { readThrough }),
      });
    } catch (err) {
      r = { refused: "error", line: `the desk could not annotate this alert: ${errText(err)}` };
    }
    const done = clock.now();
    const rec: AlertAnnotation = "opened" in r
      ? { t: iso(done), kind: "annotation", pass, alerts: hits.map((h) => h.id), result: "opened", sessionId: r.sessionId }
      : { t: iso(done), kind: "annotation", pass, alerts: hits.map((h) => h.id), result: "refused", reason: r.refused };
    records.push(rec);
    alerts.append(rec);
    if ("refused" in r) sayOnce(`post:${etDate(new Date(done))}:${r.line}`, r.line, { at: done, ...(replyTo === undefined ? {} : { replyTo }) });
  }

  /** A why post's read-through, or none when it has nothing to ask: with `deps.readThrough` ready, each symbol of the
   * US price moves that fell (`quote.chgPct` below 0), once in the hits' order, as `{ symbol, ref, since }` - the hit's
   * reference close, else its date, and {@link sinceOf} it - asked `given`: false is an ask, true a later alert of an
   * event already given, listed as `{ symbol, ref }`; a `given` that rejects leaves the symbol out of both, with one
   * line. `undefined` with no lane, a lane not ready, or both lists empty. */
  async function readThroughOf(hits: readonly AlertHit[]): Promise<{ asks: ReadThroughAsk[]; later: ReadThroughEvent[] } | undefined> {
    const lane = deps.readThrough;
    if (lane === undefined || !lane.ready()) return undefined;
    const candidates = new Map<string, ReadThroughAsk>();
    for (const hit of hits) {
      if (!whyOf(hit) || hit.quote === null || typeof hit.quote.chgPct !== "number" || !(hit.quote.chgPct < 0)) continue;
      if (!candidates.has(hit.symbol)) candidates.set(hit.symbol, { symbol: hit.symbol, ref: hit.ref ?? hit.date, since: sinceOf(hit, hit.quote.asOf) });
    }
    const asks: ReadThroughAsk[] = [];
    const later: ReadThroughEvent[] = [];
    for (const candidate of candidates.values()) {
      let given: boolean;
      try {
        given = await lane.given(candidate.symbol, candidate.ref);
      } catch (err) {
        log(`${BIN}: desk: watch read-through: ${candidate.symbol} ${candidate.ref}: the record could not be read: ${errText(err)}`);
        continue;
      }
      if (given) later.push({ symbol: candidate.symbol, ref: candidate.ref });
      else asks.push(candidate);
    }
    return asks.length === 0 && later.length === 0 ? undefined : { asks, later };
  }

  /** The instant a US price hit's event's session began, ISO - a print at or after it is the market's reaction to the
   * event (plugins/readthrough/service-row.mjs): for a hit in after-hours, that session day's regular close plus
   * {@link CLOSE_PRINT_MS}, past the closing cross, whose change is still the whole day's; for any other, 04:00 ET of
   * the hit's date, so a print of the evening before is not taken for the reaction. When the close cannot be told,
   * `printAt`, the alert's own print. */
  function sinceOf(hit: AlertHit, printAt: string): string {
    let at: number | undefined;
    try {
      at = hit.phase === "after" ? knownCloseOf(hit.date) : Date.parse(nyInstant(hit.date, 4, 0));
    } catch {
      at = undefined;   // not a date
    }
    return at !== undefined && Number.isFinite(at) ? new Date(hit.phase === "after" ? at + CLOSE_PRINT_MS : at).toISOString() : printAt;
  }

  /** `work`, or why not: a rejection's reason, or {@link WHY_READ_MS} on the clock passing - when its signal aborts. */
  async function bounded<T>(what: string, work: (signal: AbortSignal) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    const abort = new AbortController();
    let timer: unknown;
    const late = new Promise<{ ok: false; reason: string }>((done) => {
      timer = clock.setTimeout(() => {
        const reason = `the ${what} read passed ${WHY_READ_MS / 1000} s`;
        abort.abort(new Error(reason));
        done({ ok: false, reason });
      }, WHY_READ_MS);
    });
    try {
      const read = (async () => work(abort.signal))().then(
        (value) => ({ ok: true as const, value }),
        (err: unknown) => ({ ok: false as const, reason: `the ${what} read failed: ${errText(err)}` }),
      );
      return await Promise.race([read, late]);
    } finally {
      clock.clearTimeout(timer);
    }
  }

  /** The close instant of the US session dated `date`: the calendar's, else the XNYS rules', else `undefined`. */
  function knownCloseOf(date: string): number | undefined {
    const window = deps.calendars.us.window();
    const session = window === undefined ? undefined : sessionFor(window, date);
    if (session !== undefined && session !== "closed") return Date.parse(session.close);
    try {
      const rules = xnysWindow(date, 1).sessions[0];
      if (rules !== undefined) return Date.parse(rules.close);
    } catch {
      /* not a date */
    }
    return undefined;
  }

  /** The close instant of the US session dated `date`: {@link knownCloseOf}, else 16:00 ET. */
  function closeOf(date: string): number {
    return knownCloseOf(date) ?? Date.parse(nyInstant(date, 16, 0));
  }

  /** What a why post reads besides its alerts (spec §5.3): the US symbols' headlines since the earliest reference
   * close of their price alerts, and their 8-K filings accepted in the last 24 h - each read bounded at
   * {@link WHY_READ_MS}, a failure said in its place. An A share's headlines are said unavailable. */
  async function whyContext(hits: readonly AlertHit[]): Promise<WhyContext> {
    const usHits = hits.filter((h) => h.market === "us");
    const symbols = [...new Set(usHits.map((h) => h.symbol))];
    const closes = usHits.filter((h) => h.trigger.type !== "filing").map((h) => closeOf(h.ref ?? h.date)).filter(Number.isFinite);
    const since = new Date(closes.length > 0 ? Math.min(...closes) : clock.now() - WHY_FILINGS_MS).toISOString();
    const [news, filings] = await Promise.all([newsFor(symbols, since), filingsFor(symbols)]);
    for (const h of hits) if (h.market !== "us" && !news.has(h.symbol)) news.set(h.symbol, { unavailable: "an A share: the headline read covers US shares" });
    return { news, filings };
  }

  /** The symbols' headlines since `since`, or each one's reason none could be read. */
  async function newsFor(symbols: readonly string[], since: string): Promise<Map<string, NewsAnswer>> {
    const all = (unavailable: string): Map<string, NewsAnswer> => new Map(symbols.map((s) => [s, { unavailable }] as const));
    if (symbols.length === 0) return new Map();
    const read = deps.news;
    if (read === undefined) return all("the face has no headline read");
    const r = await bounded("headline", () => read(symbols, since));
    return r.ok ? r.value : all(r.reason);
  }

  /** Each symbol's 8-K filings accepted in the last 24 h (one whose acceptance time is unknown kept, its filing date
   * being inside the lookback), or its own error when EDGAR could not read it (`deadline` among them); or why none
   * could be read at all: no SEC contact, or the read's failure or deadline. A symbol read cleanly with nothing fresh
   * is left out - the post says `none`. */
  async function filingsFor(symbols: string[]): Promise<WhyContext["filings"]> {
    if (edgar === undefined) return { unavailable: WHY_NO_SEC };
    const out = new Map<string, Filing[] | { unavailable: string }>();
    if (symbols.length === 0) return out;
    const now = clock.now();
    const r = await bounded("EDGAR", (signal) => edgar.recentFilings(symbols, WHY_FORMS, daysBefore(etDate(new Date(now)), 1), { stopAfterMs: WHY_READ_MS, signal }));
    if (!r.ok) return { unavailable: r.reason };
    const fresh = r.value.filings.filter((f) => {
      if (f.accepted === null) return true;
      const t = Date.parse(f.accepted);
      return Number.isFinite(t) && now - t <= WHY_FILINGS_MS;
    });
    for (const f of fresh) {
      const had = out.get(f.symbol);
      out.set(f.symbol, [...(Array.isArray(had) ? had : []), f]);
    }
    for (const e of r.value.errors) out.set(e.symbol, { unavailable: `EDGAR could not read it: ${e.error}` });
    return out;
  }

  /** The batch step: the held alerts, once due, delivered as one line - or dropped under OFF or MUTE. */
  function batchStep(at: number): void {
    if (!batchDue(day, at)) return;
    const ids = takeBatch(day);
    onSendChain(async () => {
      if (stopped) return;
      const flags = await flagsAt(at);
      const date = etDate(new Date(at));
      const base = { t: iso(at), kind: "batch" as const, id: batchId(), date, alerts: ids };
      let rec: AlertBatch;
      if (flags.off) rec = { ...base, dropped: "off" };
      else if (flags.muted) rec = { ...base, dropped: "muted" };
      else {
        const byId = new Map(records.flatMap((r) => (r.kind === "alert" ? [[r.id, r] as const] : [])));
        const held = ids.flatMap((id) => { const r = byId.get(id); return r === undefined ? [] : [r]; });
        let delivery: DeliverResult;
        let text = "";
        try {
          text = batchText(held, at);
          delivery = held.length === 0 ? { undelivered: "the held alerts are not in memory" } : await deps.deliver(text, kindOfHits(held));
        } catch (err) {
          delivery = { undelivered: `send failed: ${errText(err)}` };
        }
        if (!("undelivered" in delivery)) {
          noteLine({ kind: "alert", alert: base.id, symbol: [...new Set(held.map((h) => h.symbol))].join(","), label: "batch", text });
        }
        rec = { ...base, delivery };
      }
      records.push(rec);
      alerts.append(rec);
    });
  }

  /* ---------- the filings ---------- */

  /** The filings step: its state, and a poll when due. */
  function filingsStep(at: number, usAnswer: DayAnswer | undefined): Promise<void> | void {
    const filingRules = book.rules.filter((r) => r.kind === "filing");
    const { polled, overCap, aShares } = filingSymbols(book.rules, { holdings: book.holdings, levels: book.levels });
    filings.symbols = polled.length;
    filings.aShares = aShares;
    filings.seeded = polled.filter((s) => baseline.seeded.has(s)).length;
    const today = etDate(new Date(at));
    if (filingRules.length === 0 || polled.length === 0) {
      filings.state = "off";
      return;
    }
    if (edgar === undefined) {
      filings.state = "no-contact";
      sayOnce(`noContact:${today}`, WATCH_LINES.filingsNoContact(), { at });
      return;
    }
    if (filingsRefusedOn === today) {
      filings.state = "refused-today";
      return;
    }
    filings.state = "polling";
    if (overCap.length > 0) sayOnce(`filingsOverCap:${today}:${overCap.join(",")}`, WATCH_LINES.filingsOverCap(overCap), { at });
    return (async () => {
      const answer = usAnswer ?? await deps.calendars.us.today(at).catch((err: unknown): DayAnswer => ({ ok: false, date: today, error: errText(err) }));
      if (!filingsRead || filingsInflight || !pollDue(at, filingsLastStart, answer)) return;
      filingsInflight = true;
      filingsLastStart = at;
      filings.lastPollAt = iso(at);
      const forms = [...new Set(filingRules.flatMap((r) => (r.kind === "filing" ? r.forms : [])))];
      const names = { holdings: book.holdings.map((h) => h.symbol), levels: book.levels.map((l) => l.symbol) };
      track((async () => {
        try {
          await filingsPass(polled, filingRules, names, forms, answer, at);
        } catch (err) {
          fail("filings pass", err);
        } finally {
          filingsInflight = false;
          filingsAbort = undefined;
        }
      })());
    })();
  }

  /** One filings poll: the result seeded or judged, each fresh filing one record and one hit per rule it matches. */
  async function filingsPass(polled: string[], rules: Rule[], names: { holdings: string[]; levels: string[] }, forms: string[], answer: DayAnswer, at: number): Promise<void> {
    if (edgar === undefined) return;
    const abort = new AbortController();
    filingsAbort = abort;
    const cut = clock.setTimeout(() => { abort.abort(new Error(`the filings poll ran past ${FILINGS_ABORT_MS / 1000} s`)); }, FILINGS_ABORT_MS);
    let result: EdgarResult;
    try {
      result = await edgar.recentFilings(polled, forms, daysBefore(etDate(new Date(at)), FILINGS_LOOKBACK_DAYS), { stopAfterMs: FILINGS_STOP_AFTER_MS, signal: abort.signal });
    } finally {
      clock.clearTimeout(cut);
    }
    if (stopped) return;
    const refused = allRefused(result, polled);
    if (refused !== undefined) {
      const today = etDate(new Date(at));
      filingsRefusedOn = today;
      filings.state = "refused-today";
      filings.lastError = refused;
      sayOnce(`filingsRefused:${today}`, WATCH_LINES.filingsRefused(refused), { at });
      return;
    }
    const firstError = result.errors[0];
    if (firstError === undefined) delete filings.lastError;
    else filings.lastError = `${firstError.symbol}: ${firstError.error}`;
    const { seed, fresh } = diffFilings(baseline, result, polled);
    for (const s of seed) {
      const rec: FilingRecord = { t: iso(at), kind: "seeded", symbol: s.symbol, accessions: s.accessions };
      filingsLedger.append(rec);
      baseline.seeded.add(s.symbol);
      for (const a of s.accessions) baseline.seen.add(seenKey(s.symbol, a));
    }
    const pending: Pending[] = [];
    const date = etDate(new Date(at));
    for (const f of fresh) {
      const rec: FilingRecord = { t: iso(at), kind: "seen", symbol: f.symbol, accession: f.accession, form: f.form, filingDate: f.filingDate, accepted: f.accepted, items: f.items, url: f.url };
      filingsLedger.append(rec);
      baseline.seen.add(seenKey(f.symbol, f.accession));
      for (const rule of rules) {
        if (rule.kind !== "filing" || !(rule.forms as readonly string[]).includes(f.form) || !resolveSymbols(rule.symbols, names).includes(f.symbol)) continue;
        const key = `filing:${rule.id}:${f.symbol}`;
        let pre: Pending["pre"];
        if (!inFilingWindow(f.accepted, answer, at)) pre = "window";
        else {
          const kd = day.keys.get(key);
          if (kd !== undefined && kd.ref === date && kd.lastHitAt !== undefined && at - kd.lastHitAt < rule.cooldownMs) pre = "cooldown";
        }
        if (pre === undefined) {
          /* a filing that reaches the gate starts its rule's cooldown; one outside the window or inside the cooldown
           * does not (the T9 review's ruling), as filingCooldowns reads the ledger back */
          const kd = day.keys.get(key);
          day.keys.set(key, { ref: date, alerted: true, repeats: kd?.ref === date ? kd.repeats : 0, lastHitAt: at });
        }
        pending.push({
          pre,
          record: {
            t: iso(at), kind: "alert", pass: "", date, key, market: "us", symbol: f.symbol, label: f.form,
            trigger: { type: "filing", rule: rule.id, form: f.form, accession: f.accession, accepted: f.accepted, filingDate: f.filingDate, items: f.items, url: f.url },
            gap: false, quote: null, holding: holdingOf(f.symbol), plan: rule.plan ?? null, source: { file: rule.file, index: rule.index }, annotate: rule.annotate,
            ...(rule.urgent ? { urgent: true as const } : {}),
          },
        });
      }
    }
    if (pending.length === 0) return;
    const pass = passId();
    queueHits(pass, pending.map((p) => ({ ...p, record: { ...p.record, pass } })), at);
  }

  /* ---------- the ledgers ---------- */

  /** The filing keys' cooldowns as the ledger leaves them: src/watch-eval.ts rebuildDay starts a key's cooldown at its
   * date's latest record not suppressed `cooldown`; for a filing key, a record suppressed `window` starts none either,
   * so its `lastHitAt` is its date's latest record that reached the gate, or none. Price keys are rebuildDay's. */
  function filingCooldowns(rebuilt: WatchDay, read: readonly WatchRecord[]): void {
    const latest = new Map<string, number>();
    for (const r of read) {
      if (r.kind !== "alert" || !r.key.startsWith("filing:")) continue;
      if (rebuilt.keys.get(r.key)?.ref !== (r.ref ?? r.date) || r.suppressed === "cooldown" || r.suppressed === "window") continue;
      const at = Date.parse(r.t);
      if (Number.isFinite(at) && at > (latest.get(r.key) ?? Number.NEGATIVE_INFINITY)) latest.set(r.key, at);
    }
    for (const [key, kd] of rebuilt.keys) {
      if (!key.startsWith("filing:")) continue;
      const at = latest.get(key);
      if (at === undefined) delete kd.lastHitAt;
      else kd.lastHitAt = at;
    }
  }

  /** The first read's orphans, on the send chain: each young one delivered late and recorded `replayed`, never
   * posted; then the lost ones as one line, each recorded undelivered. */
  function queueOrphans({ replay, lost }: { replay: AlertHit[]; lost: AlertHit[] }): void {
    if (replay.length === 0 && lost.length === 0) return;
    const record = (id: string, delivery: DeliverResult, replayed: boolean): void => {
      const d: AlertDelivered = {
        t: iso(clock.now()), kind: "delivered", id, delivery, latency: { tradeMs: null, receivedMs: null }, ...(replayed ? { replayed: true as const } : {}),
      };
      records.push(d);
      deliveries.set(id, d);
      alerts.append(d);
    };
    onSendChain(async () => {
      for (const hit of replay) {
        let result: DeliverResult;
        if (stopped) result = { undelivered: "the face shut down" };
        else {
          try {
            result = await deps.deliver(lateAlertText(hit, clock.now()), kindOfHits([hit]));
          } catch (err) {
            result = { undelivered: `send failed: ${errText(err)}` };
          }
        }
        record(hit.id, result, true);
      }
      if (lost.length === 0) return;
      if (!stopped) {
        try {
          await deps.deliver(lostAlertsLine(lost, clock.now()), ALERT);
        } catch (err) {
          fail("lost alerts line", err);
        }
      }
      for (const hit of lost) record(hit.id, { undelivered: "lost to a restart" }, false);
    });
  }

  async function ledgersStep(at: number): Promise<void> {
    if (!alertsRead) {
      try {
        const { records: read } = await readRecords(home, ALERTS_FILE, isWatchRecord);
        /* the crossing state from the ledger's five days, so a long weekend keeps Friday's after-hours alert; the
         * orphans, the reply context and the records kept from its 48 hours */
        const back = [...read.filter((r) => at - Date.parse(r.t) <= REBUILD_WINDOW_MS).map(withStringIds), ...records];
        const merged = [...read.filter((r) => at - Date.parse(r.t) <= MEMORY_MS).map(withStringIds), ...records];
        const orphans = findOrphans(merged, at);
        day = rebuildDay(back, at, new Set(orphans.lost.map((r) => r.id)));
        filingCooldowns(day, back);
        records = merged;
        for (const r of merged) if (r.kind === "delivered") deliveries.set(r.id, r);
        alertsRead = true;
        ledgerError = undefined;
        queueOrphans(orphans);
      } catch (err) {
        ledgerError = reasonOf(err);
        sayOnce(`ledger:${ledgerError}`, `the alert ledger ${join(dir, ALERTS_FILE)} cannot be read (${ledgerError}), so the watch sends nothing until it can`, { ever: true, at });
      }
    }
    if (!filingsRead) {
      try {
        baseline = baselineFrom((await readRecords(home, FILINGS_FILE, isFilingRecord)).records);
        filingsRead = true;
      } catch (err) {
        fail("filings ledger", err);
      }
    }
  }

  /* ---------- the tick ---------- */

  /** A new ET date: the dated line memories and the records older than {@link MEMORY_MS} let go. */
  function datesStep(at: number): void {
    const today = etDate(new Date(at));
    if (today === lastEt) return;
    lastEt = today;
    for (const [key, t] of saidOn) if (at - t > MEMORY_MS) saidOn.delete(key);
    records = records.filter((r) => at - Date.parse(r.t) <= MEMORY_MS);
    for (const [id, d] of deliveries) if (at - Date.parse(d.t) > MEMORY_MS) deliveries.delete(id);
  }

  /** Both markets and the filings shown off: nothing is polled. */
  function marketsOff(): void {
    for (const m of MARKETS) {
      markets[m].state = "off";
      markets[m].watched = 0;
      markets[m].notWatched = [];
    }
    filings.state = "off";
  }

  /** The mute step: an expired mute lifted, and the status's mute read - idle or watching. */
  async function muteStep(at: number): Promise<void> {
    try {
      const m = await readMuteState(home, () => at);
      if (m.state !== undefined && m.expired) {
        await clearMute(home, "expiry", () => at);
        muted = undefined;
      } else {
        muted = m.state;
      }
    } catch (err) {
      fail("mute", err);
    }
  }

  async function runTick(): Promise<void> {
    if (stopped) return;
    const at = clock.now();
    let held = false;
    let leaseFailure: string | undefined;
    try {
      held = await leaseStep(at);
    } catch (err) {
      fail("lease", err);
      leaseFailure = reasonOf(err);
    }
    if (stopped) return;
    leaseError = leaseFailure;
    if (leaseFailure !== undefined) {
      state = "lease-failed";
      marketsOff();
      try {
        await leaseFailedLine(at, leaseFailure);
      } catch (err) {
        fail("lease line", err);
      }
      return;
    }
    if (!held) {
      if (holder !== undefined && holder.pid !== pid) {
        state = "held-elsewhere";
        try {
          await heldLine(at);
        } catch (err) {
          fail("held line", err);
        }
      }
      return;
    }
    datesStep(at);
    try {
      await filesStep(at);
    } catch (err) {
      fail("files", err);
    }
    await muteStep(at);
    const filingsAny = filingSymbols(book.rules, { holdings: book.holdings, levels: book.levels }).polled.length > 0;
    if (keys.length === 0 && !filingsAny) {
      state = "idle";
      marketsOff();
      return;
    }
    state = "watching";
    await ledgersStep(at);
    if (!alertsRead) return;
    let usAnswer: DayAnswer | undefined;
    for (const m of MARKETS) {
      try {
        const answer = await marketStep(m, at);
        if (m === "us") usAnswer = answer;
      } catch (err) {
        fail(`${m} market`, err);
      }
    }
    try {
      batchStep(at);
    } catch (err) {
      fail("batch", err);
    }
    try {
      await filingsStep(at, usAnswer);
    } catch (err) {
      fail("filings", err);
    }
  }

  /** One tick, after any under way. */
  const tick = (): Promise<void> => {
    const run = tickChain.then(runTick).catch((err: unknown) => { fail("tick", err); });
    tickChain = run;
    ticking = run;
    void run.finally(() => { if (ticking === run) ticking = undefined; });
    return run;
  };
  /** The timer's tick: the next armed first, and none started while one is under way. */
  const onTimer = (): Promise<void> | undefined => {
    if (stopped) return undefined;
    timer = clock.setTimeout(onTimer, tickMs);
    return ticking ?? tick();
  };
  timer = clock.setTimeout(onTimer, 0);

  /* ---------- the status ---------- */

  function todayOf(m: Market, at: number): MarketWatchStatus["today"] {
    const date = marketDate(m, at);
    const today = emptyToday();
    for (const r of records) {
      if (r.kind !== "alert" || r.market !== m || r.date !== date) continue;
      if (r.decision === "send") today.sent += 1;
      else if (r.suppressed !== undefined) today.suppressed[r.suppressed] += 1;
    }
    if (repeats[m].date === date) today.repeats = repeats[m].n;
    return today;
  }

  /** The levels within {@link NEAR_PCT} of their symbol's price in `prices`, nearest first, at most {@link NEAR_MAX}. */
  function nearOf(prices: Map<string, WatchQuote>, at: number): NearView[] {
    const near: NearView[] = [];
    for (const l of book.levels) {
      const q = prices.get(`${l.market}:${l.symbol}`);
      if (q === undefined || q.price === null || !(q.price > 0)) continue;
      const d = levelDistancePct(l, q.price);
      if (Math.abs(d) > NEAR_PCT) continue;
      const snap = snapOf(q);
      near.push({
        market: l.market, symbol: l.symbol, kind: l.kind, level: levelText(l), when: l.when, last: q.price, at: snap === null ? "" : priceStamp(snap, at),
        distancePct: round2(d), plan: l.plan, file: l.file,
      });
    }
    return near.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct)).slice(0, NEAR_MAX);
  }

  function marksOf(): WatchMark[] {
    const marks: WatchMark[] = book.levels.map((l) => {
      const q = lastQuotes.get(`${l.market}:${l.symbol}`);
      const d = q?.price !== null && q?.price !== undefined && q.price > 0 ? round2(levelDistancePct(l, q.price)) : null;
      return { market: l.market, symbol: l.symbol, kind: l.kind, level: levelText(l), when: l.when, plan: l.plan, file: l.file, distancePct: d };
    });
    const rank = (m: WatchMark): number => (m.distancePct === null ? Number.POSITIVE_INFINITY : Math.abs(m.distancePct));
    return marks.sort((a, b) => rank(a) - rank(b)).slice(0, MARKS_MAX);
  }

  function recentOf(): AlertSummary[] {
    const out: AlertSummary[] = [];
    for (let i = records.length - 1; i >= 0 && out.length < RECENT_MAX; i--) {
      const r = records[i];
      if (r.kind !== "alert") continue;
      const d = deliveries.get(r.id);
      const outcome: AlertSummary["outcome"] = r.decision === "suppressed" ? "suppressed"
        : d === undefined ? "pending"
          : "undelivered" in d.delivery ? "undelivered"
            : "sent" in d.delivery ? "sent" : "queued";
      out.push({
        id: r.id, t: r.t, market: r.market, symbol: r.symbol, label: r.label, gap: r.gap, price: r.quote?.price ?? null, feed: r.quote?.feed ?? null, outcome,
        ...(r.suppressed === undefined ? {} : { suppressed: r.suppressed }),
        latencyMs: d?.latency.tradeMs ?? null,
        ...(d?.latency.receivedMs === null || d?.latency.receivedMs === undefined ? {} : { receivedMs: d.latency.receivedMs }),
      });
    }
    return out;
  }

  function status(): WatchStatus {
    const at = clock.now();
    const marketsNow = {} as Record<Market, MarketWatchStatus>;
    for (const m of MARKETS) marketsNow[m] = { ...structuredClone(markets[m]), today: todayOf(m, at) };
    return {
      state,
      markets: marketsNow,
      ...(holder === undefined ? {} : { holder: { ...holder } }),
      ...(leaseError === undefined ? {} : { leaseError }),
      ...(muted === undefined ? {} : { muted: { ...muted } }),
      files: fileStatuses().map((f) => structuredClone(f)),
      near: nearOf(lastQuotes, at),
      marks: marksOf(),
      pending: day.pending.length,
      recent: recentOf(),
      filings: { ...filings },
      ...(ledgerError === undefined ? {} : { ledgerError }),
    };
  }

  /* ---------- the desk state ---------- */

  /** `work`, or why not within {@link STATE_QUOTES_TIMEOUT_MS} on the clock. */
  function within<T>(work: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    return new Promise((done) => {
      const t = clock.setTimeout(() => { done({ ok: false, reason: `it did not answer in ${STATE_QUOTES_TIMEOUT_MS / 1000} s` }); }, STATE_QUOTES_TIMEOUT_MS);
      work.then(
        (value) => { clock.clearTimeout(t); done({ ok: true, value }); },
        (err: unknown) => { clock.clearTimeout(t); done({ ok: false, reason: err instanceof HttpError && err.status === 429 ? "busy" : errText(err) }); },
      );
    });
  }

  async function stateText(): Promise<string | undefined> {
    if (state !== "watching") return undefined;
    const at = clock.now();
    const prices = new Map<string, WatchQuote>();
    const missing: Partial<Record<Market, string>> = {};
    await Promise.all(MARKETS.map(async (m) => {
      /* the holdings first, then the levels in file order, as the watch ranks them; the snapshot asks at most the
       * market's watch cap, a symbol past it takes its last polled price, and those with none are counted */
      const symbols = [...new Set([...book.holdings.filter((h) => h.market === m).map((h) => h.symbol), ...book.levels.filter((l) => l.market === m).map((l) => l.symbol)])];
      if (symbols.length === 0) return;
      const max = m === "us" ? WATCH_US_MAX : WATCH_CN_MAX;
      const asked = symbols.slice(0, max);
      const past = symbols.slice(max);
      const source = deps.quotes;
      const name = m === "us" ? "US" : "A-share";
      const reasons: string[] = [];
      if (source === undefined || source.unavailable !== undefined) {
        reasons.push(`${name} unavailable: ${source?.unavailable ?? "no quote source"}`);
      } else {
        const got = await within(source.snapshot(asked.map((symbol) => ({ id: idOf(m, symbol), market: m, symbol }))));
        if (!got.ok) reasons.push(`${name} unavailable: ${got.reason}`);
        else for (const q of got.value.quotes) if (q.market === m && q.quote_status !== "unavailable" && q.price !== null) prices.set(`${m}:${q.symbol}`, watchQuoteOf(q));
      }
      let unpricedPast = 0;
      for (const symbol of past) {
        const last = lastQuotes.get(`${m}:${symbol}`);
        if (last === undefined) unpricedPast += 1;
        else prices.set(`${m}:${symbol}`, last);
      }
      if (unpricedPast > 0) reasons.push(`${unpricedPast} ${name} ${unpricedPast === 1 ? "symbol" : "symbols"} past the cap of ${max} not priced`);
      if (reasons.length > 0) missing[m] = reasons.join("; ");
    }));
    const sent = MARKETS.reduce((n, m) => n + todayOf(m, at).sent, 0);
    const suppressed = MARKETS.reduce((n, m) => n + Object.values(todayOf(m, at).suppressed).reduce((a, b) => a + b, 0), 0);
    const view: DeskStateView = {
      holdings: book.holdings.map((h) => {
        const q = prices.get(`${h.market}:${h.symbol}`);
        const snap = q === undefined ? null : snapOf(q);
        return { market: h.market, symbol: h.symbol, qty: h.qty, avgCost: h.avgCost, last: q?.price ?? null, at: snap === null ? null : priceStamp(snap, at), chgPct: q?.changePct ?? null };
      }),
      near: nearOf(prices, at),
      alerts: { sent, suppressed },
      ...(muted === undefined ? {} : { muted: muted.until === undefined ? "with no end" : `until ${deskTime(new Date(muted.until), new Date(at))}` }),
      ...(Object.keys(missing).length === 0 ? {} : { prices: MARKETS.flatMap((m) => missing[m] ?? []).join("; ") }),
    };
    return stateBody(view);
  }

  /* ---------- a reply's context (spec §16 H1b) ---------- */

  /** What a phone reply to `messageId` (`<network>:<id>`) answers: see {@link WatchHandle.contextFor}. Newest record
   * first, so a message id Telegram numbered afresh finds the latest send. */
  function contextFor(messageId: string): string | undefined {
    try {
      return contextOf(messageId);
    } catch (err) {
      fail("context", err);
      return undefined;
    }
  }

  /** {@link contextFor}'s work. A record the ledger kept in a shape `alertText` cannot read - the rebuild checks only
   * the fields it reads - is skipped, as if the watch had not sent it; the next record that sent the message is tried. */
  function contextOf(messageId: string): string | undefined {
    const at = clock.now();
    const live = records.filter((r) => at - Date.parse(r.t) <= MEMORY_MS).reverse();
    const sentIt = (sent: unknown): boolean => Array.isArray(sent) && sent.some((id) => messageIdOf(id) === messageId);
    const hitOf = (id: string): AlertHit | undefined => live.find((r): r is AlertHit => r.kind === "alert" && r.id === id);
    const annotatedOf = (pass: string): AnnotatedRecord | undefined => live.find((r): r is AnnotatedRecord => r.kind === "annotated" && r.pass === pass);
    const noteOf = (a: AnnotatedRecord | undefined): string[] => (a === undefined || a.text === "" ? [] : [`annotation:\n${a.text}`]);
    /** The alert's text as sent with no note; `undefined` for a hit in a shape it cannot be read from. */
    const textOf = (hit: AlertHit): string | undefined => {
      try {
        return alertText(hit, at, "none");
      } catch {
        return undefined;
      }
    };
    let parts: string[] | undefined;
    for (const r of live) {
      if (r.kind === "delivered" && typeof r.delivery === "object" && r.delivery !== null && sentIt((r.delivery as { sent?: unknown }).sent)) {
        const hit = hitOf(r.id);
        const text = hit === undefined ? undefined : textOf(hit);
        if (hit === undefined || text === undefined) continue;
        const post = live.find((p): p is AlertAnnotation => p.kind === "annotation" && Array.isArray(p.alerts) && p.alerts.includes(hit.id));
        parts = [text, ...noteOf(post === undefined ? undefined : annotatedOf(post.pass))];
        break;
      }
      if (r.kind === "annotated" && sentIt(r.sent)) {
        const post = live.find((p): p is AlertAnnotation => p.kind === "annotation" && p.pass === r.pass);
        const ids = Array.isArray(post?.alerts) ? post.alerts : [];
        const texts = ids.flatMap((id) => { const hit = hitOf(id); const text = hit === undefined ? undefined : textOf(hit); return text === undefined ? [] : [text]; });
        parts = [...texts, ...noteOf(r)];
        break;
      }
    }
    if (parts === undefined || parts.length === 0) return undefined;
    return cutAt(parts.join("\n\n"), CONTEXT_MAX);
  }

  /* ---------- the handle ---------- */

  return {
    tick,
    status,
    stateText,
    noteAnnotated(r) {
      records.push(r);
      alerts.append(r);
    },
    contextFor,
    dispose() {
      disposing ??= (async () => {
        stopped = true;
        clock.clearTimeout(timer);
        filingsAbort?.abort(new Error("the face is shutting down"));
        let wait: NodeJS.Timeout | undefined;
        const bound = new Promise<void>((done) => { wait = setTimeout(done, DISPOSE_WAIT_MS); wait.unref?.(); });
        const settled = (async () => {
          await tickChain;
          await Promise.all([...flights]);
          await sendChain;
          await postChain;
          await Promise.all([alerts.settled(), filingsLedger.settled(), events.settled()]);
        })();
        await Promise.race([settled, bound]);
        clearTimeout(wait);
        await releaseLease();
        state = "stopped";
      })();
      return disposing;
    },
  };
}
