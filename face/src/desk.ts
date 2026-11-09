/** The desk's ledger: `$DSH_HOME/face/desk/events.jsonl`, the face's own record of its lifetime -
 * with the sleep watch that writes into it, the `OFF` switch that pauses the desk, and the status
 * route that reads them back.
 *
 * The desk is Gravit's always-on side (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md):
 * the face kept running by launchd as a user service (§5.2), and, in the later plans, the clock,
 * the watch and the phone bridge that work in it. Of what §8 gives this module - the ledger, the
 * budget, the `OFF` switch, the two desk tools, the `/desk` page and `/data/desk/*` - P0 holds the
 * ledger, the sleep watch and `GET /data/desk/status`, and P1 adds the `OFF` switch and the Desk
 * panel's `POST /data/desk/pause` (the panel itself is client/desk-panel.js, in the chat page rather
 * than a `/desk` page), mounts the two desk tools and the desk's guard, which src/desk-tools.ts
 * defines, and runs the phone bridge, src/phone-bridge.ts, over the account's inbox and send (src/phone.ts).
 * Of the ledger's files (§5.7) this module keeps `events.jsonl`, `OFF` and P3's `MUTE`;
 * {@link appendRecord} is the append path for the others, P2's firing
 * ledger, {@link FIRINGS_FILE}, and P3's {@link ALERTS_FILE} and {@link FILINGS_FILE} among them,
 * {@link appendChain} one writer's ordered queue onto it, {@link appendRecordOnce} the path for a
 * record that must land once, and {@link readRecords} reads any of them back. `events.jsonl` has
 * fourteen kinds of event: P0's `boot`, clean `shutdown` and `asleep` gap in the face's timers; P1's
 * `off-set` and `off-cleared`, a `desk-session` for each desk conversation the face opens, a
 * `desk-turn` for each turn on it, and a `desk-refused` for a turn the face would not open; P2's
 * `standing-error`, `calendar-error` and `budget-spent`, which the standing orders' clock writes; and
 * P3's `mute-set`, `mute-cleared` and `watch-load`.
 *
 * Why a budget (P2, ruling P2-8): the desk spends tokens unattended - the phone's turns, the
 * standing orders' firings - so `standing.yml`'s `budget.dailyTokens` caps the day's: the plain sum
 * of the four buckets of every `desk-turn` since 00:00 ET, whatever opened it and however it ended
 * ({@link budgetState}). Once it is spent, firings are refused and each phone post is answered with
 * one line ({@link budgetReplyLine}) instead of a turn; the pause outranks it.
 *
 * Why a ledger: a service that launchd restarts after a crash or a `kill -9` looks healthy from
 * outside - it is running again. Read back as runs ({@link runsOf}), the ledger says otherwise: a
 * boot that the next boot follows with no `shutdown` between is `lost`.
 *
 * The writer appends one JSON object per line under the face's file lock, creates its files
 * `0600`, and rotates the file once it is over {@link LEDGER_ROTATE_BYTES}, the new file opening
 * with the old one's last `desk-session` and last `conversation`, so both are found again. It never throws
 * into the face: an append that fails is one `gravit-face:` line on stderr, and a face whose ledger
 * cannot be written still boots and serves. The reader takes the current file only, and skips and
 * counts every line that is not an event. A last line torn by a crash mid-append is the case that
 * matters: the writer starts the next event on a fresh line, so the fragment is one skipped line
 * and never takes the next event with it.
 *
 * Why a sleep watch (P0's, not §5.5's watch row): a Mac that sleeps takes the face with it, and a
 * face that wakes looks as though it had never been away (§5.2). {@link installAsleepWatch} ticks
 * every {@link ASLEEP_TICK_MS} on a plain timer and reads the wall clock at each tick; a gap
 * between two ticks over {@link ASLEEP_THRESHOLD_MS} is one `asleep` event. Whatever stops the
 * timers reads the same way - the machine asleep, the process stopped, the event loop blocked -
 * and so does a wall clock set forward past the threshold; one set back writes nothing.
 *
 * Why an `OFF` switch: the operator quiets the desk from wherever they are - the phone, the Desk
 * panel, a terminal - and only a terminal makes it loud again (§5.8), so a pause from the phone or
 * the panel never shortens the one in force ({@link writeOff}). The switch is a file, `OFF`,
 * beside the ledger: while it is there the desk is paused. What it holds ({@link OffState}: who
 * set it, when, until when) only adds to that - anything by that name that says nothing a state
 * can be read from, `touch OFF` included, is a pause from a terminal. A pause lifts at its
 * `until`, on `npm run desk -- resume` ({@link clearOff}) or when the file is deleted; each set
 * and each lift that goes through this module is an event, written under the switch's lock.
 *
 * Why a `MUTE` beside it (P3): the watch's alerts can come in New York's night, and the operator
 * silences them without pausing the desk. `MUTE` is a second switch on the same rules and its own
 * lock - the phone sets it (`/mute 2h`, {@link writeMute}) and never shortens one in force, a terminal
 * lifts it (`npm run desk -- unmute`, {@link clearMute}) - and while it holds, the watch still detects
 * and still writes its ledger; only the phone lines wait.
 *
 * {@link installDesk} mounts it all on a booted face. The status route ({@link deskStatus}:
 * pid, version, uptime, this run's gaps, the ledger's runs, the pause in force, the desk
 * conversation, today's desk turns and their tokens, the day's budget, the standing orders when
 * their clock runs, and the phone bridge) and the pause route
 * are mounted always, and so are the desk tools and the guard, so a face with the desk off -
 * a second face beside the service, §5.2 - still answers, with `desk.enabled: false`, and an old
 * desk conversation it opens keeps its tools and its guard; the `boot` event, the watch, the desk
 * conversation's owner (src/desk-conversation.ts), the bridge and the `shutdown` event only when
 * the desk is on. An unreadable ledger is named in the status, never a 500. {@link deskStatusLines}
 * is the status as the terminal and the phone read it, the day's budget ({@link budgetLine}) and the
 * standing orders ({@link standingLines}) among its lines.
 * @module
 */
import { appendFile, lstat, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { basename, extname, join } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { createAnnotator, type Annotator } from "./annotator.ts";
import { createDeskConversation, type ClaimsOn, type DeskConversation, type DeskConversationCtxLike } from "./desk-conversation.ts";
import type { DeskClock, DeskSessionCtxLike, DeskSessionDeps, DeskSessionPersistenceLike, SessionEventsOn } from "./desk-session.ts";
import { deskToolDefinitions, installDeskGuard, installDeskTools, type DeskFetch, type DeskGuardCtxLike } from "./desk-tools.ts";
import { etDate, etDayStart, etTime } from "./et.ts";
import { fencedGet, fencedPost, HttpError, isTrustedDataRequest } from "./http.ts";
import type { MarketQuoteSource } from "./market-quotes.ts";
import type { FiringRouteCtx, ScheduleDeps, ScheduleHandle } from "./schedule.ts";
import type { StandingStatus } from "./standing.ts";
import type { RouteRegistrar } from "./static.ts";
import type { PhoneBridgeHandle } from "./phone-bridge.ts";
import type { AccountPhoneStatus, PhoneClient } from "./phone.ts";
import { DSH_PIN } from "./version.ts";
import type { DeskCalendars } from "./market-clock.ts";
import type { EdgarFetch } from "./edgar.ts";
import type { NewsAnswer } from "./market-news.ts";
import type { WatchHandle, WatchStatus } from "./watch.ts";

/** Diagnostic label, the same string every other `${BIN}:`-prefixed line in this program uses
 * (`roster.ts`, `main.ts`) - copied rather than imported, because it is a label rather than a
 * contract. */
const BIN = "gravit-face";

/** Where the desk keeps its files under the harness home, beside the face's other
 * operator-side state (`channels.json`, `roster.log`). */
export const DESK_DIR = ["face", "desk"] as const;

/** The desk's directory under `home`, the harness home (absolute, as `resolveDshHome` returns it). */
export function deskDir(home: string): string {
  return join(home, ...DESK_DIR);
}

/** The ledger's current file; a rotated one sits beside it as `events.<t>.jsonl`. */
export const EVENTS_FILE = "events.jsonl";

/** The firing ledger (P2): each standing order's firing, step by step, in the desk's directory beside
 * `events.jsonl` - appended through {@link appendRecord}, its key-consuming `started` through
 * {@link appendRecordOnce}, read back through {@link readRecords}. */
export const FIRINGS_FILE = "firings.jsonl";

/** The size past which the next append first moves the file aside (spec §5.7). */
export const LEDGER_ROTATE_BYTES = 50 * 1024 * 1024;

/** A desk turn's tokens in the four buckets the harness meters them in (`deriveTurnTokenUsage`,
 * `@deepseek-ai/dsh-token-meter`), and every route the turn ran on, as `provider/model`. */
export interface TurnUsage {
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  routes: string[];
}

/** One ledger line. `t` is when the face recorded the event; `t`, `from`, `to` and `until` are
 * ISO-8601 UTC (`new Date(ms).toISOString()`). A `boot` names the process, the dsh version it runs
 * and whether it mounted the desk; a `shutdown` is a clean stop with the exit code the face leaves
 * with; an `asleep` is a gap in the face's timers, from the last tick before it to the tick that
 * found it. An `off-set` is a pause - who set it and, for a timed one, until when - and an
 * `off-cleared` its lift, from a terminal or by its own expiry. A `desk-session` names a desk
 * conversation when the face opens one: `created` when there was none to resume, `new` when the
 * operator asked for another. A `desk-turn` is one turn on it: the kind of message that opened it
 * (`source`), its number, whether it ended, the face's deadline cut it off, something else cancelled
 * it - with what `cancel`led it: `shutdown`, `stopped from the phone`, `stopped in the browser` - or it
 * failed - with the `error` it failed on - its wall time and, when the harness reported them, its
 * tokens. A
 * `desk-refused` is a turn the face would not open: why, and the path that made it refuse when a path
 * did. P2's clock adds three: a `standing-error`, when `standing.yml` is refused or the firing ledger
 * cannot be read - the errors that say why; a `calendar-error`, a session date the market calendar did
 * not answer for - the date, the interpreter asked and its error; and a `budget-spent`, once per ET
 * date ({@link noteBudgetSpent}) - the date, the tokens used and the day's cap. A `standing-error` or
 * `calendar-error` whose phone line the pause held back carries `phoned: false`, so a restart phones it
 * again rather than never. P3's watch adds three: a `mute-set` and a `mute-cleared`, the mute's set and
 * lift as the pause's are, and a `watch-load`, one of the watch's files read - its repo-relative name, the
 * rows it loaded, each refusal's line, and, for a file refused whole, the `error` the watch keeps its last
 * good load against. The hardening's graceful stop adds two (spec §16 H3, R93): a `desk-carry`, written by the desk
 * conversation's dispose before it cancels anything - the phone's texts still queued on the desk session `sessionId`
 * (`queued`, oldest first: each one's key, the message's id, its text without the provenance or context, and when the
 * operator wrote it) and the phone turn under way (`cut`: its number, its message's key and when that was written) -
 * and a `desk-carried`, the boot that answered it: the carry's `t` (`of`), the texts it posted again and those it
 * skipped as already in the session (src/desk-conversation.ts). A `desk-fetch` is one `web_fetch` a desk agent made that
 * reached dispatch (spec 2026-11-07 §5.6, charter A1 and D29): its session and the URL as the model asked it, cut at
 * src/desk-tools.ts `DESK_FETCH_URL_MAX` characters - written whatever the fetch then answered, so the operator sees
 * every page a desk turn opened (src/desk-tools.ts `installDeskGuard`'s fetch record). A `conversation` names Gravit's one
 * router conversation when the face opens one (src/conversation.ts, spec 2026-11-08 §5.10): `created` when the ledger
 * named none, `new` when the one it named could not be had or was not the conversation; a face resumes the last
 * ({@link lastConversation}). */
export type DeskEvent =
  | { t: string; kind: "boot"; pid: number; version: string; deskEnabled: boolean }
  | { t: string; kind: "shutdown"; pid: number; code: number }
  | { t: string; kind: "asleep"; from: string; to: string; gapMs: number }
  | { t: string; kind: "off-set"; by: OffState["by"]; until?: string }
  | { t: string; kind: "off-cleared"; by: "terminal" | "expiry" }
  | { t: string; kind: "desk-session"; sessionId: string; reason: "created" | "new" }
  | { t: string; kind: "conversation"; sessionId: string; reason: "created" | "new" }
  | {
    t: string; kind: "desk-turn"; sessionId: string; source: string; turn: number; outcome: "ended" | "timed-out" | "cancelled" | "failed";
    wallMs: number; usage?: TurnUsage; cancel?: string; error?: string;
  }
  | { t: string; kind: "desk-refused"; reason: string; path?: string }
  | { t: string; kind: "standing-error"; errors: string[]; phoned?: false }
  | { t: string; kind: "calendar-error"; date: string; clock: string; error: string; phoned?: false }
  | { t: string; kind: "budget-spent"; date: string; used: number; dailyTokens: number }
  | { t: string; kind: "mute-set"; by: MuteState["by"]; until?: string }
  | { t: string; kind: "mute-cleared"; by: "terminal" | "expiry" }
  | { t: string; kind: "watch-load"; file: string; loaded: number; refused: string[]; error?: string }
  | {
    t: string; kind: "desk-carry"; sessionId: string; queued: { key: string; text: string; at?: string }[];
    cut?: { turn: number; key?: string; at?: string };
  }
  | { t: string; kind: "desk-carried"; of: string; posted: number; skipped: number }
  | { t: string; kind: "desk-fetch"; sessionId: string; url: string };

/** Every kind {@link DeskEvent} has, and only those. A record over the union rather than a list,
 * so a kind added to the type and not here fails to compile instead of reading back as skipped. */
const KINDS: Readonly<Record<DeskEvent["kind"], true>> = {
  boot: true,
  shutdown: true,
  asleep: true,
  "off-set": true,
  "off-cleared": true,
  "desk-session": true,
  conversation: true,
  "desk-turn": true,
  "desk-refused": true,
  "standing-error": true,
  "calendar-error": true,
  "budget-spent": true,
  "mute-set": true,
  "mute-cleared": true,
  "watch-load": true,
  "desk-carry": true,
  "desk-carried": true,
  "desk-fetch": true,
};

/** What a failure is reported as - in the append's failure line and the status's `ledgerError`:
 * the error's code when it has one (`ENOTDIR`, `EACCES`, `ENOSPC`), else its message (the lock's
 * timeout carries no code). */
function reasonOf(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error ? err.message : String(err);
}

/** The ledger's size in bytes; 0 while there is none. */
async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
}

/** Whether the ledger ends mid-line: its last byte, at `size - 1`, is there and is not a newline -
 * the tail of a write that a crash or a full disk cut short. */
async function endsMidLine(file: string, size: number): Promise<boolean> {
  const handle = await open(file, "r");
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(1), 0, 1, size - 1);
    return bytesRead === 1 && buffer[0] !== "\n".charCodeAt(0);
  } finally {
    await handle.close();
  }
}

/** Whether a failure says the path is not there: `ENOENT`, or `ENOTDIR` - a non-directory where
 * `face/` or `face/desk/` should be, so that nothing can be there. */
function isAbsent(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The name `file` is moved aside to: the stamp - each `:` made `-` - before its extension, so
 * `events.jsonl` becomes `events.<t>.jsonl`. */
function rotatedName(file: string, stamp: string): string {
  const ext = extname(file);
  return `${file.slice(0, file.length - ext.length)}.${stamp.replaceAll(":", "-")}${ext}`;
}

/** Throws a `TypeError` naming `fn` unless `file` is a plain name - not a path, `.`, `..` or empty: the
 * caller's mistake, never the ledger's, caught before anything is touched. */
function requireName(fn: string, file: string): void {
  if (basename(file) !== file || file === "" || file === "." || file === "..") {
    throw new TypeError(`${fn} takes a file name in the desk's directory, not ${JSON.stringify(file)}`);
  }
}

/** What {@link appendRecord} and {@link appendRecordOnce} take: `rotateBytes`, default
 * {@link LEDGER_ROTATE_BYTES}; `log`, for the failure line; `carry`, the lines a rotation hands on to
 * the fresh file, none when absent. */
export interface AppendOptions {
  rotateBytes?: number;
  log?: (line: string) => void;
  carry?: (rotated: string) => readonly string[];
}

/** {@link appendRecord}'s one failure line, to `log` (default `console.error`). */
function ledgerFailed(path: string, err: unknown, log: ((line: string) => void) | undefined): void {
  (log ?? ((line: string) => console.error(line)))(`${BIN}: the desk ledger at ${path} could not be written: ${reasonOf(err)}`);
}

/** The append itself, inside `file`'s lock, which the caller holds: the rotation, the newline after a
 * torn tail, the line (see {@link appendRecord}). Rejects on any failure. */
async function appendLocked(dir: string, file: string, record: object, opts: AppendOptions): Promise<void> {
  const path = join(dir, file);
  let size = await sizeOf(path);
  if (size > (opts.rotateBytes ?? LEDGER_ROTATE_BYTES)) {
    const { t } = record as { t?: unknown };
    const rotated = join(dir, rotatedName(file, typeof t === "string" ? t : new Date().toISOString()));
    await rename(path, rotated);
    size = 0;
    /* what the old file hands the new one, line by line, before the record that rotated it */
    const carried = opts.carry === undefined ? [] : opts.carry(await readFile(rotated, "utf8"));
    if (carried.length > 0) {
      const text = carried.map((line) => `${line}\n`).join("");
      await appendFile(path, text, { encoding: "utf8", mode: 0o600 });
      size = Buffer.byteLength(text);
    }
  }
  const lead = size > 0 && (await endsMidLine(path, size)) ? "\n" : "";
  await appendFile(path, `${lead}${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

/**
 * Append one record, as one JSON line, to `file` in the desk's directory - the ledger's
 * `events.jsonl` ({@link appendEvent}) or any other of its JSONL files.
 *
 * The directory is made first, because `withFileLock` creates its lock beside the file
 * (`roster.ts`'s `update` keeps the same order). Inside the lock, a file over `rotateBytes` is
 * renamed to `<name>.<t>.<ext>` ({@link rotatedName}) - `t` being the record's own `t` when it
 * carries one as a string, else the time of the append - and the line goes to a fresh file, after
 * what `carry`, given the renamed file's text, hands on to it, one line each (the ledger's last
 * `desk-session`, {@link appendEvent}; nothing for any other file). A file
 * whose last byte is not a newline ends in a write that a crash or a full disk cut short; the line
 * then opens with a newline, so the fragment stays one skipped line instead of swallowing this
 * record - a swallowed `boot` would leave the killed run reading as the live one. The lock makes
 * the size check, the rename, that one-byte read and the append one step, so no writer's line
 * lands in a file another has just moved aside. Files are created `0600`; the mode applies on
 * creation only, as `roster.log`'s does.
 *
 * Never rejects on the ledger. Any failure - directory, lock, rename, tail read, append - is one
 * call to `log` (default `console.error`) naming the file and the error's code, or its message
 * when it has none, and the record is dropped: the ledger is a record, never a gate on the face.
 * The lock's retries are not jittered, so appenders that start together take it about one per
 * retry round, and a burst of a dozen or more can outlast its two-second wait (measured: 20 at
 * once, 6 dropped); the desk's records come one or two at a time. A `file` that is not a plain
 * name - a path, `.`, `..`, empty - is the caller's mistake, not the ledger's: it rejects with a
 * `TypeError` before anything is touched, so no record lands outside the desk's directory.
 * @param home - the harness home.
 * @param file - the file's name in {@link deskDir} - a name, not a path.
 * @param record - the record, written as one JSON line.
 * @param opts - see {@link AppendOptions}.
 */
export async function appendRecord(home: string, file: string, record: object, opts: AppendOptions = {}): Promise<void> {
  requireName("appendRecord", file);
  const dir = deskDir(home);
  const path = join(dir, file);
  try {
    await mkdir(dir, { recursive: true });
    await withFileLock(path, () => appendLocked(dir, file, record, opts));
  } catch (err) {
    ledgerFailed(path, err, opts.log);
  }
}

/**
 * Append `record` to `file` unless the file already holds one that `isDuplicate` matches: the
 * check-and-append that consumes a key once, however many faces on one harness home reach for it at
 * once (ruling P2-23 - a firing's `started`; the day's `budget-spent`, {@link noteBudgetSpent}).
 *
 * Under `file`'s lock, as {@link appendRecord} takes it: the file is read whole - before any rotation,
 * so the check sees everything it held - and `isDuplicate` is asked of each line that is a JSON object,
 * in file order, a torn line and any other value passed over; a match answers `duplicate` and writes
 * nothing. Else the record goes in as {@link appendRecord} puts it - the rotation and `carry`, the
 * newline after a torn tail, `0600`. A rotation leaves the earlier lines in the rotated file, which no
 * later check reads: a key is once per current file.
 *
 * Never rejects on the ledger: any failure - the directory, the lock (its two-second wait), the read,
 * the append, an `isDuplicate` that throws - is one `log` line, as {@link appendRecord}'s, and
 * `failed`, nothing known to be written. A `file` that is not a plain name is the caller's
 * `TypeError`, before anything is touched.
 * @param home - the harness home.
 * @param file - the file's name in {@link deskDir} - a name, not a path.
 * @param record - the record, written as one JSON line.
 * @param isDuplicate - whether a line already there is this record's: handed each JSON object the file holds.
 * @param opts - see {@link AppendOptions}.
 * @returns `appended`, `duplicate` or `failed`.
 */
export async function appendRecordOnce(
  home: string,
  file: string,
  record: object,
  isDuplicate: (existing: unknown) => boolean,
  opts: AppendOptions = {},
): Promise<"appended" | "duplicate" | "failed"> {
  requireName("appendRecordOnce", file);
  const dir = deskDir(home);
  const path = join(dir, file);
  try {
    await mkdir(dir, { recursive: true });
    return await withFileLock(path, async (): Promise<"appended" | "duplicate"> => {
      if (await holdsMatch(path, isDuplicate)) return "duplicate";
      await appendLocked(dir, file, record, opts);
      return "appended";
    });
  } catch (err) {
    ledgerFailed(path, err, opts.log);
    return "failed";
  }
}

/** Whether a line of the file at `path` - none when there is no file - is a JSON object `matches` takes. */
async function holdsMatch(path: string, matches: (existing: unknown) => boolean): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  return linesOf(text).some((line) => {
    const object = objectOf(line);
    return object !== undefined && matches(object);
  });
}

/**
 * Append one event to `$DSH_HOME/face/desk/events.jsonl`: {@link appendRecord} on
 * {@link EVENTS_FILE}, rotated under the event's `t` - the new file opening with the last
 * `desk-session` line and the last `conversation` line of the old one, as written ({@link carryDeskSession}), so the
 * desk conversation and the conversation a face resumes ({@link lastDeskSession}, {@link lastConversation}) are still
 * the current file's. Never rejects;
 * a failure is one `log` line.
 * @param home - the harness home.
 * @param event - the event, written as one JSON line.
 * @param opts - `rotateBytes`, default {@link LEDGER_ROTATE_BYTES}; `log`, for the failure line.
 */
export async function appendEvent(
  home: string,
  event: DeskEvent,
  opts: { rotateBytes?: number; log?: (line: string) => void } = {},
): Promise<void> {
  await appendRecord(home, EVENTS_FILE, event, { ...opts, carry: carryDeskSession });
}

/** One writer's queue onto one of the desk's files ({@link appendChain}). */
export interface AppendChain {
  /** Queue `record` behind every record this chain was handed before it. Returns nothing, never throws. */
  append(record: object): void;
  /** Resolves once every record handed so far is written or its failure logged; never rejects. */
  settled(): Promise<void>;
}

/**
 * One append chain onto `file` in the desk's directory: {@link appendRecord} once per record, in call
 * order, each after the last has settled - so a burst from one writer never contends for the file's lock
 * with itself. Bare appends started together take the lock about one per retry round, and P0 measured 20
 * at once dropping 6 (P3-6); the watch's alerts, filings and events each go through one chain, and lose
 * none. Other writers on the file - another face, another of this face's modules - still take the lock as
 * they always did.
 *
 * `append` never throws and its record's write never rejects: a failure is {@link appendRecord}'s one
 * `log` line (default `console.error`), and the next record is tried as though it had gone. On
 * {@link EVENTS_FILE} a rotation carries the last `desk-session` and `conversation`, as {@link appendEvent}'s does. A `file`
 * that is not a plain name is the caller's `TypeError`, thrown here, before anything is touched.
 * @param home - the harness home.
 * @param file - the file's name in {@link deskDir} - a name, not a path.
 * @param opts - `log`, for the failure lines.
 */
export function appendChain(home: string, file: string, opts: { log?: (line: string) => void } = {}): AppendChain {
  requireName("appendChain", file);
  const append: AppendOptions = { ...(opts.log === undefined ? {} : { log: opts.log }), ...(file === EVENTS_FILE ? { carry: carryDeskSession } : {}) };
  let tail: Promise<void> = Promise.resolve();
  return {
    append(record) {
      tail = tail.then(() => appendRecord(home, file, record, append)).catch(() => undefined);
    },
    settled: () => tail,
  };
}

/** The kinds whose last line a rotation hands on: what a face finds its long-lived sessions by. */
const CARRIED: ReadonlySet<string> = new Set(["desk-session", "conversation"]);

/** What a rotated ledger hands the new one: its last line that is a `desk-session` event and its last that is a
 * `conversation` event, each as it was written, in file order - either or both absent when it has none. Read once per
 * rotation, from the end. */
function carryDeskSession(rotated: string): string[] {
  const lines = rotated.split("\n");
  const found = new Map<string, number>();
  for (let i = lines.length - 1; i >= 0 && found.size < CARRIED.size; i--) {
    const object = objectOf(lines[i]);
    if (object === undefined || !isDeskEvent(object) || !CARRIED.has(object.kind) || found.has(object.kind)) continue;
    found.set(object.kind, i);
  }
  return [...found.values()].sort((a, b) => a - b).map((i) => lines[i]);
}

/** A file's lines: its text split at each newline, less the empty one after the newline that ends the
 * last line. */
function linesOf(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** One line as a JSON object - not `null`, not an array - or `undefined`: not JSON (a torn line, a
 * blank one), or JSON that is no object. */
function objectOf(line: string): object | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
}

/** Whether a line's object is an event: a string `t` and a known `kind` - and, for a `desk-fetch`, a string
 * `sessionId` and `url`, the two fields the Desk view reads it for. Nothing else is checked - the face is the
 * file's one writer, and the rest of the shape is the writer's to keep. */
function isDeskEvent(x: unknown): x is DeskEvent {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const { t, kind } = x as { t?: unknown; kind?: unknown };
  if (typeof t !== "string" || typeof kind !== "string" || !Object.hasOwn(KINDS, kind)) return false;
  /* a fetch line is read for its session and its URL (the Desk view's pages): one without both is no record of a page */
  if (kind === "desk-fetch") {
    const { sessionId, url } = x as { sessionId?: unknown; url?: unknown };
    return typeof sessionId === "string" && typeof url === "string";
  }
  return true;
}

/**
 * The records of `file` in the desk's directory, in file order, and how many lines were not records:
 * any of the desk's JSONL files read back - `events.jsonl` ({@link readEvents}), the firing ledger
 * ({@link FIRINGS_FILE}) - each line taken when it is a JSON object `guard` accepts.
 *
 * Reads the current file only, never a rotated one. An absent file - none written yet, or a
 * non-directory where `face/` or `face/desk/` should be, so that none can exist - is
 * `{ records: [], skipped: 0 }`; any other read failure rejects, so an unreadable file never reads as
 * an empty one. Every other line is skipped and counted - a torn one, a blank one, JSON that is no
 * object (`guard` is never handed one), an object `guard` refuses; the newline that ends the last line
 * opens no line of its own. A `file` that is not a plain name is the caller's `TypeError`.
 * @param home - the harness home.
 * @param file - the file's name in {@link deskDir} - a name, not a path.
 * @param guard - whether a line's object is a record.
 */
export async function readRecords<T>(
  home: string,
  file: string,
  guard: (x: unknown) => x is T,
): Promise<{ records: T[]; skipped: number }> {
  requireName("readRecords", file);
  let text: string;
  try {
    text = await readFile(join(deskDir(home), file), "utf8");
  } catch (err) {
    if (isAbsent(err)) return { records: [], skipped: 0 };
    throw err;
  }
  const records: T[] = [];
  let skipped = 0;
  for (const line of linesOf(text)) {
    const object = objectOf(line);
    if (object !== undefined && guard(object)) records.push(object);
    else skipped += 1;
  }
  return { records, skipped };
}

/**
 * The current ledger's events, in file order, and how many lines were not events: {@link readRecords}
 * on {@link EVENTS_FILE}, a line being an event when it has a string `t` and a known `kind` ({@link isDeskEvent}).
 *
 * Reads `events.jsonl` only, never a rotated file - a rotation hands its last `desk-session` and `conversation` on
 * ({@link appendEvent}), and the runs and turns before it stay behind. An absent ledger is
 * `{ events: [], skipped: 0 }`; any other read failure rejects, so an unreadable ledger never reads
 * as an empty one.
 * @param home - the harness home.
 */
export async function readEvents(home: string): Promise<{ events: DeskEvent[]; skipped: number }> {
  const { records, skipped } = await readRecords(home, EVENTS_FILE, isDeskEvent);
  return { events: records, skipped };
}

/** One process's life as the ledger tells it. `endedAt` and `code` are present only when a
 * `shutdown` ended the run - absent, never `undefined`, otherwise. `lost` marks a run that the next
 * boot followed with no `shutdown` between: killed, crashed, or the machine lost power. */
export interface DeskRun {
  bootedAt: string;
  pid: number;
  endedAt?: string;
  code?: number;
  lost: boolean;
}

/**
 * Fold events into runs: one per `boot`, in order. A `shutdown` with the open run's `pid` ends
 * it; a `boot` while a run is still open marks that run `lost`. The last run, when no `shutdown`
 * has ended it, is not lost - it may be the process that is running now. Events of every other
 * kind - `asleep`, the pause's, the desk conversation's - and a `shutdown` that matches no open
 * run change nothing.
 * @param events - the ledger's events in file order, as {@link readEvents} returns them.
 */
export function runsOf(events: DeskEvent[]): DeskRun[] {
  const runs: DeskRun[] = [];
  let open: DeskRun | undefined;
  for (const event of events) {
    if (event.kind === "boot") {
      if (open !== undefined) open.lost = true;
      open = { bootedAt: event.t, pid: event.pid, lost: false };
      runs.push(open);
    } else if (event.kind === "shutdown" && open !== undefined && event.pid === open.pid) {
      /* Each only when the line carries it: the reader checks `t` and `kind` alone, and a hand-written
       * `shutdown` may lack a `code` - its run then has none, absent rather than `undefined`. */
      if (typeof event.t === "string") open.endedAt = event.t;
      if (event.code !== undefined) open.code = event.code;
      open = undefined;
    }
  }
  return runs;
}

/**
 * The desk conversation the ledger names last: the `sessionId` of its last `desk-session` event,
 * or `undefined` when it has none - the one a face that boots again resumes rather than opening
 * another.
 * @param events - the ledger's events in file order, as {@link readEvents} returns them.
 */
export function lastDeskSession(events: DeskEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === "desk-session") return event.sessionId;
  }
  return undefined;
}

/**
 * The conversation the ledger names last: the `sessionId` of its last `conversation` event, or `undefined` when it
 * has none - the one a face that boots again resumes (src/conversation.ts `ensureConversation`).
 * @param events - the ledger's events in file order, as {@link readEvents} returns them.
 */
export function lastConversation(events: readonly DeskEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === "conversation") return event.sessionId;
  }
  return undefined;
}

/** How often the sleep watch ticks (spec §5.2). */
export const ASLEEP_TICK_MS = 30_000;

/** The gap between two ticks past which the face was asleep (spec §5.2): four ticks' worth, so a
 * tick that a busy event loop runs late is not a sleep. */
export const ASLEEP_THRESHOLD_MS = 120_000;

/** The sleep watch's seams, injected the way room.ts's `RoomClock` is. `append` is the writer and
 * has no default - {@link installDesk} passes the ledger's. The watch does not await it, so it must
 * neither throw nor reject; {@link appendEvent} does neither. The rest default to
 * {@link ASLEEP_TICK_MS}, {@link ASLEEP_THRESHOLD_MS}, `Date.now` and the global timer. */
export interface AsleepWatchOptions {
  tickMs?: number;
  thresholdMs?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  append: (event: DeskEvent) => void | Promise<void>;
}

/**
 * Start the sleep watch: every `tickMs`, read `now()` and take the gap since the last tick.
 *
 * A gap over `thresholdMs` - strictly over - is one `asleep` event from the last tick to this one,
 * stamped with this tick; any other gap, a negative one from a clock set back included, writes
 * nothing. Either way this tick becomes the last, so a gap is counted once and a clock set back is
 * measured from where it landed. The first gap is measured from the call. The default timer is
 * `unref`'d, as quotes.ts's poller is: the watch never holds the process open by itself.
 * @param opts - the seams; only `append` is required.
 * @returns the disposer, which stops the timer.
 */
export function installAsleepWatch(opts: AsleepWatchOptions): () => void {
  const thresholdMs = opts.thresholdMs ?? ASLEEP_THRESHOLD_MS;
  const now = opts.now ?? Date.now;
  const start = opts.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms).unref());
  const stop = opts.clearInterval ?? ((handle: unknown) => clearInterval(handle as NodeJS.Timeout));
  let last = now();
  const handle = start(() => {
    const at = now();
    const gap = at - last;
    if (gap > thresholdMs) {
      const to = new Date(at).toISOString();
      void opts.append({ t: to, kind: "asleep", from: new Date(last).toISOString(), to, gapMs: gap });
    }
    last = at;
  }, opts.tickMs ?? ASLEEP_TICK_MS);
  return () => stop(handle);
}

/** The switch's file in {@link deskDir}: while it is there, the desk is paused (spec §5.8). */
export const OFF_FILE = "OFF";

/** What `OFF` holds: when the pause was set and by whom - the phone, by the network its `/pause` came through
 * (`telegram`, `slack`), the Desk panel or a terminal - and, for a timed pause, when it lifts; both times ISO-8601 UTC. */
export interface OffState {
  setAt: string;
  by: "telegram" | "slack" | "imessage" | "page" | "terminal";
  until?: string;
}

/** The mute's file in {@link deskDir} (P3): while it is there, the watch's alerts are not sent - detection
 * and the ledger go on. A switch as `OFF` is, beside it, with its own lock. */
export const MUTE_FILE = "MUTE";

/** What `MUTE` holds: when the mute was set and by whom - the phone, by the network its `/mute` came through
 * (`telegram`, `slack`), or, for a `MUTE` that says nothing a state can be read from, a terminal - and, for a timed
 * mute, when it lifts; both times ISO-8601 UTC. */
export interface MuteState {
  setAt: string;
  by: "telegram" | "slack" | "imessage" | "terminal";
  until?: string;
}

/** The watch's alert ledger (P3), beside `events.jsonl`, appended through one {@link appendChain}. */
export const ALERTS_FILE = "alerts.jsonl";
/** The watch's filings ledger (P3), the same way. */
export const FILINGS_FILE = "filings.jsonl";
/** The watch's lease (P3): which face on this home holds the watch. */
export const WATCH_LEASE_FILE = "watch.lease";

/** A switch's state: who set it and when, and, for a timed one, when it lifts. */
type SwitchState = { setAt: string; by: string; until?: string };

/** One of the desk's switches: its file, the setters its state may name, and the events its set and its
 * lift are. `OFF` ({@link OFF_SWITCH}) and `MUTE` ({@link MUTE_SWITCH}) are the two; every rule below -
 * the name being there is the switch, the phone never shortens one, one lock per switch, an event only
 * on a real change - is the same for both. */
interface Switch<S extends SwitchState> {
  file: string;
  setters: Readonly<Record<S["by"], true>>;
  /** The event a set is, carrying the state. */
  set(state: S): DeskEvent;
  /** The event a lift is. */
  cleared(t: string, by: "terminal" | "expiry"): DeskEvent;
}

/** The pause: `OFF`, set from the phone, the Desk panel or a terminal. */
const OFF_SWITCH: Switch<OffState> = {
  file: OFF_FILE,
  setters: { telegram: true, slack: true, imessage: true, page: true, terminal: true },
  set: (s) => ({ t: s.setAt, kind: "off-set", by: s.by, ...(s.until === undefined ? {} : { until: s.until }) }),
  cleared: (t, by) => ({ t, kind: "off-cleared", by }),
};

/** The mute: `MUTE`, set from the phone; a terminal only lifts it, or `touch`es it. */
const MUTE_SWITCH: Switch<MuteState> = {
  file: MUTE_FILE,
  setters: { telegram: true, slack: true, imessage: true, terminal: true },
  set: (s) => ({ t: s.setAt, kind: "mute-set", by: s.by, ...(s.until === undefined ? {} : { until: s.until }) }),
  cleared: (t, by) => ({ t, kind: "mute-cleared", by }),
};

/** Whether `value` is a time: a string `Date.parse` reads. */
const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** A switch file's text as a state - JSON with a time `setAt`, one of the switch's `by`s and, if any,
 * a time `until`; other keys dropped - or `undefined` when it is anything else. */
function switchStateOf<S extends SwitchState>(sw: Switch<S>, text: string): S | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const { setAt, by, until } = parsed as { setAt?: unknown; by?: unknown; until?: unknown };
  if (!isTime(setAt) || typeof by !== "string" || !Object.hasOwn(sw.setters, by)) return undefined;
  if (until !== undefined && !isTime(until)) return undefined;
  return { setAt, by, ...(until === undefined ? {} : { until }) } as S;
}

/** {@link readOffState} for any switch. */
async function readSwitch<S extends SwitchState>(sw: Switch<S>, home: string, now: () => number): Promise<{ state?: S; expired: boolean }> {
  const file = join(deskDir(home), sw.file);
  let text: string | undefined;
  try {
    text = await readFile(file, "utf8");
  } catch {
    /* nothing to read - no file, a link to nothing, a directory, a file shut to the face: lstat tells which */
  }
  const state = text === undefined ? undefined : switchStateOf(sw, text);
  if (state !== undefined) return { state, expired: state.until !== undefined && Date.parse(state.until) <= now() };
  let mtime: Date;
  try {
    mtime = (await lstat(file)).mtime;
  } catch (err) {
    if (isAbsent(err)) return { expired: false };
    throw err;
  }
  return { state: { setAt: mtime.toISOString(), by: "terminal" } as S, expired: false };
}

/** Whether a switch set until `until` outlasts one in force until `held`, either being `undefined` for
 * one with no end: an open-ended one outlasts any timed one and is outlasted by none; of two timed
 * ones, the later `until` outlasts. */
function outlasts(until: string | undefined, held: string | undefined): boolean {
  if (held === undefined) return false;
  if (until === undefined) return true;
  return Date.parse(until) > Date.parse(held);
}

/** {@link writeOff} for any switch. */
async function writeSwitch<S extends SwitchState>(
  sw: Switch<S>, home: string, input: { by: S["by"]; until?: number }, now: () => number,
): Promise<S> {
  const until = input.until === undefined ? undefined : new Date(input.until).toISOString();
  const dir = deskDir(home);
  const file = join(dir, sw.file);
  await mkdir(dir, { recursive: true });
  return withFileLock(file, async () => {
    const at = now();
    if (input.by !== "terminal") {
      const { state: held, expired } = await readSwitch(sw, home, () => at);
      if (held !== undefined && !expired && !outlasts(until, held.until)) return held;
    }
    const state = { setAt: new Date(at).toISOString(), by: input.by, ...(until === undefined ? {} : { until }) } as S;
    await writeFileAtomic(file, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await appendEvent(home, sw.set(state));
    return state;
  });
}

/** {@link clearOff} for any switch. */
async function clearSwitch<S extends SwitchState>(sw: Switch<S>, home: string, by: "terminal" | "expiry", now: () => number): Promise<boolean> {
  const file = join(deskDir(home), sw.file);
  try {
    await lstat(file); // nothing there is nothing to lift; something there means the lock's directory exists
  } catch (err) {
    if (isAbsent(err)) return false;
    throw err;
  }
  return withFileLock(file, async () => {
    const at = now();
    if (by === "expiry" && !(await readSwitch(sw, home, () => at)).expired) return false;
    try {
      await unlink(file);
    } catch (err) {
      if (isAbsent(err)) return false;
      throw err;
    }
    await appendEvent(home, sw.cleared(new Date(at).toISOString(), by));
    return true;
  });
}

/**
 * Whether the desk is paused: `OFF`'s state, and whether its `until` has come.
 *
 * No `OFF` - nothing by that name, or a non-directory where `face/` or `face/desk/` should be, so
 * that nothing can be there - is `{ expired: false }`, with no state. An `OFF` that holds a state
 * is that state, `expired` once `now()` reaches its `until`; one without an `until` never
 * expires. Anything else by that name - the empty file `touch` leaves, text that is no state, a
 * link to nothing, a directory, a file the face may not read - is a pause all the same, read as
 * `{ setAt: <its own mtime>, by: "terminal" }`, never expiring: the switch is the name being
 * there, and what the file holds only says who and until when. Whether the name is there is
 * `lstat`'s answer, so a link is judged as itself, not by what it points at. Rejects only when
 * not even `lstat` answers - the desk's directory itself unreadable - so a switch that cannot be
 * read never reads as no switch. Expiry is read here, not acted on: whoever finds it expired lifts
 * it with {@link clearOff}.
 * @param home - the harness home.
 * @param now - the clock `until` is compared with, default `Date.now`.
 */
export async function readOffState(home: string, now: () => number = Date.now): Promise<{ state?: OffState; expired: boolean }> {
  return readSwitch(OFF_SWITCH, home, now);
}

/**
 * Pause the desk: write `OFF` and record an `off-set` event carrying the same state - unless the
 * phone or the Desk panel asks for less than the pause already in force.
 *
 * The phone and the panel can only make the desk quieter (§5.8), so from `telegram` or `page` a
 * pause in force stands unless the one asked for outlasts it: an open-ended pause stands against
 * any, and of two timed pauses the later `until` wins. Were it otherwise, a phone's `/pause 1m`
 * over a terminal's open-ended pause would lift it a minute later. A `terminal` pause replaces
 * whatever is there; an expired pause is replaced from anywhere, as though there were none. When
 * the pause in force stands, nothing is written and no event recorded, and that pause is what
 * this returns - so a reply built from the result says what is true.
 *
 * All under the switch's lock, which {@link clearOff} takes too - its directory made first, as
 * {@link appendRecord} makes its own: reading the pause in force, writing and recording are one
 * step, so a pause racing a pause or a resume leaves the file and the ledger in agreement. The
 * file is replaced in one step (`writeFileAtomic`: a sibling written `0600`, renamed over `OFF`),
 * so a reader, which takes no lock, finds the old state or the new, never part of one. Rejects
 * when `OFF` cannot be written or its lock taken - a pause that did not happen must not report
 * one - and, before anything, on an `until` that is no time (`RangeError`); the event never
 * rejects ({@link appendEvent}).
 * @param home - the harness home.
 * @param input - `by`, who paused; `until`, when the pause lifts in ms since the epoch, absent for
 *   a pause that lasts until a resume.
 * @param now - the clock `setAt` is read from and the pause in force is judged expired by,
 *   default `Date.now`.
 * @returns the pause in force afterwards: the one written, or the one that stood.
 */
export async function writeOff(home: string, input: { by: OffState["by"]; until?: number }, now: () => number = Date.now): Promise<OffState> {
  return writeSwitch(OFF_SWITCH, home, input, now);
}

/**
 * Lift the pause: remove `OFF`, then - only when there was one to remove - record an
 * `off-cleared` event, so a second resume, or one racing another, records nothing.
 *
 * `by` is `terminal` for `npm run desk -- resume`, which lifts whatever is there, and `expiry` for
 * a pause found past its `until`, which lifts it only if it still is: `OFF` is read again under
 * the switch's lock, which {@link writeOff} takes too, so a pause written between the caller's
 * read and this call stands. The phone and the Desk panel only ever pause. No `OFF` - or a
 * non-directory where its directory should be - is `false`, before any lock, and so is an
 * `expiry` that finds the pause in force or without an end. Rejects when `OFF` is there and cannot
 * be removed (a directory, a directory the face may not write) or its lock cannot be taken: the
 * pause stands, and the caller says so.
 * @param home - the harness home.
 * @param by - what lifts it.
 * @param now - the clock the event is stamped with and `expiry` judges by, default `Date.now`.
 * @returns whether a pause was lifted.
 */
export async function clearOff(home: string, by: "terminal" | "expiry", now: () => number = Date.now): Promise<boolean> {
  return clearSwitch(OFF_SWITCH, home, by, now);
}

/**
 * Whether the watch's alerts are muted: `MUTE`'s state, and whether its `until` has come - read as
 * {@link readOffState} reads `OFF`. Anything by that name that says nothing a state can be read from,
 * `touch MUTE` included, is a mute by `terminal` with no end.
 * @param home - the harness home.
 * @param now - the clock `until` is compared with, default `Date.now`.
 */
export async function readMuteState(home: string, now: () => number = Date.now): Promise<{ state?: MuteState; expired: boolean }> {
  return readSwitch(MUTE_SWITCH, home, now);
}

/**
 * Mute the watch's alerts from the phone (`/mute <d>`): write `MUTE` and record a `mute-set` - as
 * {@link writeOff} writes `OFF`, under `MUTE`'s own lock. The phone never shortens a mute: one in force
 * stands unless this one outlasts it, and nothing is written or recorded; the mute in force afterwards
 * is what this returns. A mute from the phone always has an end. Rejects when `MUTE` cannot be written
 * or its lock taken.
 * @param home - the harness home.
 * @param input - `by`, the phone's network; `until`, when the mute lifts in ms since the epoch.
 * @param now - the clock `setAt` is read from, default `Date.now`.
 * @returns the mute in force afterwards: the one written, or the one that stood.
 */
export async function writeMute(home: string, input: { by: "telegram" | "slack" | "imessage"; until: number }, now: () => number = Date.now): Promise<MuteState> {
  return writeSwitch(MUTE_SWITCH, home, input, now);
}

/**
 * Lift the mute: remove `MUTE` and record a `mute-cleared` only when there was one to remove - as
 * {@link clearOff} lifts `OFF`. `terminal` is `npm run desk -- unmute`, which lifts whatever is there;
 * `expiry` lifts it only if it is still past its `until` under the lock.
 * @param home - the harness home.
 * @param by - what lifts it.
 * @param now - the clock the event is stamped with and `expiry` judges by, default `Date.now`.
 * @returns whether a mute was lifted.
 */
export async function clearMute(home: string, by: "terminal" | "expiry", now: () => number = Date.now): Promise<boolean> {
  return clearSwitch(MUTE_SWITCH, home, by, now);
}

/** What `/mute` with no or a bad duration replies; nothing is muted. */
export const MUTE_USAGE = "mute needs a duration: /mute 30m, /mute 2h or /mute 1d";

/**
 * The phone's line for `/mute`, built from the mute in force: its end as {@link deskTime} shows it, or,
 * for a mute with none (a `touch`ed `MUTE`), `a terminal lifts it`.
 * @param state - the mute in force.
 * @param now - the time it is read at.
 */
export function muteReplyLine(state: MuteState, now: Date): string {
  const until = state.until === undefined ? "a terminal lifts it" : deskTime(new Date(state.until), now);
  return `alerts muted until ${until}; detection and the ledger go on. A terminal lifts it: npm run desk -- unmute`;
}

/** A pause's length as the phone, the Desk panel and the terminal spell it. */
const DURATION = /^(\d+)(m|h|d)$/;

/** Each unit of {@link DURATION} in milliseconds. */
const UNIT_MS: Readonly<Record<string, number>> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** The longest pause a duration asks for: 36,500 days, a hundred years - far inside what a `Date`
 * can hold, so now plus any duration is a time. */
const MAX_PAUSE_MS = 36_500 * 86_400_000;

/**
 * A pause's length in milliseconds: digits, then `m`, `h` or `d` - `30m`, `2h`, `1d`. Anything
 * else is `undefined`: a sign, a space, a fraction, a capital unit, a zero amount (a pause of
 * nothing is none) and an amount past 36,500 days ({@link MAX_PAUSE_MS}), so that a pause's end
 * is always a time a `Date` can hold.
 * @param text - the duration as typed.
 */
export function parseDuration(text: string): number | undefined {
  const match = DURATION.exec(text);
  if (match === null) return undefined;
  const ms = Number(match[1]) * UNIT_MS[match[2]];
  return ms > 0 && ms <= MAX_PAUSE_MS ? ms : undefined;
}

/**
 * A time as the desk shows it to the operator: `14:03 ET` on the same New York date as `now`, and
 * `2026-10-21 14:03 ET` on any other - so a pause until tomorrow, or one set yesterday, never
 * reads as today's.
 * @param at - the time shown.
 * @param now - the time it is read at.
 */
export function deskTime(at: Date, now: Date): string {
  const date = etDate(at);
  return date === etDate(now) ? etTime(at) : `${date} ${etTime(at)}`;
}

/** The day's tokens against its cap (ruling P2-8). `dailyTokens` is `standing.yml`'s
 * `budget.dailyTokens`, present only when there is one - no key, no cap. `used` is the four buckets
 * of every `desk-turn` since 00:00 America/New_York and their plain sum, `total`; `spent`, whether a
 * cap is set and `total` has reached it. `error` is present only when the ledger could not be read -
 * its code, or its message when it has none - and `used` is then zeros: an unreadable ledger never
 * spends the budget (the plan's ruling 8), and the status names it. */
export interface BudgetState {
  dailyTokens?: number;
  used: { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; total: number };
  spent: boolean;
  error?: string;
}

/** A bucket as the day counts it: a count - a finite number, not below zero - or nothing. The ledger's
 * reader checks a line's `t` and `kind` only, so a hand-written `desk-turn` may carry anything. */
const tokensOf = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** The `desk-turn` events at or after `since`, ISO-8601 UTC strings ordering as their times do: how
 * many, and their tokens bucket by bucket with the plain sum. A turn without usage counts and adds
 * nothing. */
function turnsSince(events: readonly DeskEvent[], since: string): { count: number; used: BudgetState["used"] } {
  const used = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, total: 0 };
  let count = 0;
  for (const e of events) {
    if (e.kind !== "desk-turn" || e.t < since) continue;
    count += 1;
    const usage = e.usage as Partial<Record<keyof TurnUsage, unknown>> | undefined;
    used.uncachedInputTokens += tokensOf(usage?.uncachedInputTokens);
    used.outputTokens += tokensOf(usage?.outputTokens);
    used.cacheReadTokens += tokensOf(usage?.cacheReadTokens);
    used.cacheWriteTokens += tokensOf(usage?.cacheWriteTokens);
  }
  used.total = used.uncachedInputTokens + used.outputTokens + used.cacheReadTokens + used.cacheWriteTokens;
  return { count, used };
}

/** The state of `used` against `dailyTokens`, each optional key present only when it has a value. */
function budgetOf(used: BudgetState["used"], dailyTokens: number | undefined, error?: string): BudgetState {
  return {
    ...(dailyTokens === undefined ? {} : { dailyTokens }),
    used,
    spent: dailyTokens !== undefined && used.total >= dailyTokens,
    ...(error === undefined ? {} : { error }),
  };
}

/**
 * The day's budget from the ledger's events: the four buckets of every `desk-turn` from 00:00
 * America/New_York on the ET date of `now` ({@link etDayStart}) - the phone's, the browser's, a
 * firing's, whatever opened it, and however it ended: a cancelled, failed or timed-out turn spent its
 * tokens too - summed; spent once that sum reaches `dailyTokens`. No cap, never spent.
 * @param events - the ledger's events, as {@link readEvents} returns them.
 * @param now - when the budget is read, in ms since the epoch: what today is.
 * @param dailyTokens - the day's cap, `standing.yml`'s `budget.dailyTokens`; none when absent.
 */
export function budgetState(events: readonly DeskEvent[], now: number, dailyTokens?: number): BudgetState {
  return budgetOf(turnsSince(events, new Date(etDayStart(now)).toISOString()).used, dailyTokens);
}

/**
 * The day's budget as the ledger has it now: {@link budgetState} over {@link readEvents}. Never
 * rejects: a ledger that cannot be read is zeros and not spent, with `error` its code - the budget
 * fails open, the plan's ruling 8, and the status says why.
 * @param home - the harness home.
 * @param now - when the budget is read, in ms since the epoch.
 * @param dailyTokens - the day's cap; none when absent.
 */
export async function readBudget(home: string, now: number, dailyTokens?: number): Promise<BudgetState> {
  try {
    return budgetState((await readEvents(home)).events, now, dailyTokens);
  } catch (err) {
    return budgetOf({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, total: 0 }, dailyTokens, reasonOf(err));
  }
}

/**
 * Note that the budget is spent: one `budget-spent` event per ET date, appended through
 * {@link appendRecordOnce} under the ledger's lock, so two faces on one home, or two firings at once,
 * note it once - the clock's cue for the day's one phone line. The event carries the date, `used`'s
 * `total` and the cap, stamped `now`; a rotation hands the desk conversation on, as
 * {@link appendEvent}'s does. Only the current file is read for the day's note, so a ledger that
 * rotates mid-day may note the day twice.
 * @param home - the harness home.
 * @param now - when, in ms since the epoch: its ET date is the day noted.
 * @param state - the day's budget; one that is not spent, or has no cap, notes nothing.
 * @param opts - `rotateBytes`, default {@link LEDGER_ROTATE_BYTES}; `log`, for the failure line.
 * @returns `true` when the event was appended - or could not be, with one line: nothing then says the
 *   day was noted before, so the caller's line goes out rather than none; `false` when the day already
 *   has its note, or there is nothing to note.
 */
export async function noteBudgetSpent(
  home: string,
  now: number,
  state: BudgetState,
  opts: { rotateBytes?: number; log?: (line: string) => void } = {},
): Promise<boolean> {
  if (!state.spent || state.dailyTokens === undefined) return false;
  const date = etDate(new Date(now));
  const event: DeskEvent = { t: new Date(now).toISOString(), kind: "budget-spent", date, used: state.used.total, dailyTokens: state.dailyTokens };
  const sameDay = (existing: unknown): boolean => isDeskEvent(existing) && existing.kind === "budget-spent" && existing.date === date;
  return (await appendRecordOnce(home, EVENTS_FILE, event, sameDay, { ...opts, carry: carryDeskSession })) !== "duplicate";
}

/**
 * The phone's line for a post while the day's budget is spent (the plan's Global Constraints):
 * `the desk's token budget for today is spent: 2,013,402 of 2,000,000 tokens since 00:00 ET. It opens
 * again at midnight ET, or raise budget.dailyTokens in standing.yml` - numbers as `en-US` writes them,
 * and no `of <cap>` for a state that has none.
 * @param state - the day's budget.
 */
export function budgetReplyLine(state: BudgetState): string {
  const cap = state.dailyTokens === undefined ? "" : ` of ${state.dailyTokens.toLocaleString("en-US")}`;
  return `the desk's token budget for today is spent: ${state.used.total.toLocaleString("en-US")}${cap} tokens since 00:00 ET. `
    + "It opens again at midnight ET, or raise budget.dailyTokens in standing.yml";
}

/** The phone bridge as the status reports it (src/phone-bridge.ts): `configured`, whether the face has the account's
 * half to reach - the `mcp-account` row not disabled; `polling`, whether its loop runs; `lastPollAt`, the last read of
 * the account's inbox that answered; `accountFailing`, present while the reads fail - `since` the first that failed after
 * the last that answered, and `reason`, why the last one failed; and, as the account's last answer gave them, `networks`,
 * the networks connected and how each polls; `queued`, the messages waiting in the account's outbox; `strangers`, how
 * many senders Account › Identity's Not you lists. */
export interface PhoneStatus {
  configured: boolean;
  polling: boolean;
  lastPollAt?: string;
  accountFailing?: { since: string; reason: string };
  networks: AccountPhoneStatus["networks"];
  queued: number;
  strangers: number;
}

/** What `GET /data/desk/status` answers. `pid`, `version` (the dsh version this face runs),
 * `bootedAt` and `uptimeMs` are this process's; `desk` says whether its rows are mounted and where
 * its files are; `asleep` is this run's gaps; `runs` is every run in the current ledger. `off` is
 * the pause in force, present only while one is; `deskSession`, the desk conversation the ledger
 * names last ({@link lastDeskSession}), present only when it names one; `turnsToday`, the desk
 * turns recorded since 00:00 America/New_York and their tokens; `budget`, those tokens against the
 * day's cap ({@link BudgetState}) - optional in the type, so a status built by hand may leave it out,
 * and always set by {@link deskStatus}; `standing`, the standing orders as their clock reports them
 * (src/standing.ts `StandingStatus`), present only while a provider has one; `watch`, the watch's status
 * (src/watch.ts `WatchStatus`), present only while the watch runs; `phone`, the bridge's
 * state, present only when a provider is passed - {@link installDesk} always passes one, so the route
 * and `desk_state` always carry it; `fetchesToday`, today's `desk-fetch` lines ({@link fetchesSince}) -
 * optional in the type as `budget` is, always set by {@link deskStatus}, and left out of `desk_state`'s answer
 * (src/desk-tools.ts). `ledgerError` is present only when the ledger could not be
 * read - its code, or its message when it has none - and `asleep`, `runs` and `fetchesToday` are then empty,
 * `turnsToday` zero, and the budget zeros and not spent, its `error` the same: an unreadable ledger is
 * named, never passed off as an empty one. */
export interface DeskStatus {
  ok: true;
  pid: number;
  version: string;
  bootedAt: string;
  uptimeMs: number;
  desk: { enabled: boolean; dir: string };
  asleep: { from: string; to: string; gapMs: number }[];
  runs: DeskRun[];
  off?: OffState;
  deskSession?: string;
  turnsToday: { count: number; usage: Omit<TurnUsage, "routes"> };
  budget?: BudgetState;
  standing?: StandingStatus;
  phone?: PhoneStatus;
  watch?: WatchStatus;
  fetchesToday?: OpenedPage[];
  ledgerError?: string;
}

/** One page a desk agent opened, as `GET /data/desk/status` lists it in `fetchesToday`: a `desk-fetch` line's
 * time, session (`unknown` when the call carried none) and URL. */
export interface OpenedPage {
  t: string;
  sessionId: string;
  url: string;
}

/** How many of today's opened pages the status lists, the newest kept. */
export const FETCHES_TODAY_MAX = 50;

/**
 * Today's `desk-fetch` lines - those whose `t` is at or after `since` - newest first, at most
 * {@link FETCHES_TODAY_MAX}.
 * @param events - the ledger's events in file order, as {@link readEvents} returns them.
 * @param since - the start of today in New York, as an ISO-8601 UTC string.
 */
export function fetchesSince(events: DeskEvent[], since: string): OpenedPage[] {
  const fetches: OpenedPage[] = [];
  for (let i = events.length - 1; i >= 0 && fetches.length < FETCHES_TODAY_MAX; i--) {
    const e = events[i];
    if (e.kind === "desk-fetch" && e.t >= since) fetches.push({ t: e.t, sessionId: e.sessionId, url: e.url });
  }
  return fetches;
}

/**
 * The face's status as the desk sees it, read from the ledger and `OFF` afresh on every call, at
 * one reading of the clock.
 *
 * `asleep` is every `asleep` event whose `from` is at or after `bootedAt` - this run's gaps, not
 * those of the runs before it; ISO-8601 UTC strings order as their times do, so the comparison is
 * on the strings, as it is for `turnsToday`: the `desk-turn` events whose `t` is at or after the
 * start of today in New York ({@link etDayStart}), counted, their tokens summed - a turn recorded
 * without usage counts and adds nothing. `budget` is the same turns' tokens against `dailyTokens`'
 * cap ({@link budgetState}). `fetchesToday` is {@link fetchesSince} from the same start of the day.
 * `runs` is {@link runsOf} over the whole current file.
 * `off` is {@link readOffState}'s state unless it has expired: a pause past its `until` is no
 * longer in force, though its file waits for whoever lifts it. Never rejects on the ledger: a read
 * that fails ({@link readEvents} rejects on EACCES, EISDIR, EIO by design) is `ledgerError`, and the
 * budget's `error`; a switch that cannot be read at all is left out, the directory that holds it
 * being the ledger's too.
 * @param deps - `home`, the harness home; `bootedAt`, when this run began, in ms since the epoch;
 *   `enabled`, whether the desk's rows are mounted; `now`, `pid` and `version`, defaulting to
 *   `Date.now`, `process.pid` and {@link DSH_PIN}; `phone`, the bridge's status, `dailyTokens`,
 *   the day's cap (the standing orders' last good load), `standing`, the standing orders'
 *   status, and `watch`, the watch's (src/watch.ts) - each read once per call when given,
 *   `dailyTokens`, `standing` and `watch` answering `undefined` while there is none.
 */
export async function deskStatus(deps: {
  home: string;
  bootedAt: number;
  enabled: boolean;
  now?: () => number;
  pid?: number;
  version?: string;
  phone?: () => PhoneStatus;
  dailyTokens?: () => number | undefined;
  standing?: () => StandingStatus | undefined;
  watch?: () => WatchStatus | undefined;
}): Promise<DeskStatus> {
  const at = (deps.now ?? Date.now)();
  const since = new Date(deps.bootedAt).toISOString();
  let events: DeskEvent[] = [];
  let ledgerError: string | undefined;
  try {
    events = (await readEvents(deps.home)).events;
  } catch (err) {
    ledgerError = reasonOf(err);
  }
  let off: OffState | undefined;
  try {
    const { state, expired } = await readOffState(deps.home, () => at);
    if (!expired) off = state;
  } catch {
    /* the desk's directory cannot be read: ledgerError names it */
  }
  const asleep = events.flatMap((e) =>
    e.kind === "asleep" && e.from >= since ? [{ from: e.from, to: e.to, gapMs: e.gapMs }] : []);
  const dayStart = new Date(etDayStart(at)).toISOString();
  const today = turnsSince(events, dayStart);
  const fetchesToday = fetchesSince(events, dayStart);
  const { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = today.used;
  const turnsToday = { count: today.count, usage: { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } };
  const budget = budgetOf(today.used, deps.dailyTokens?.(), ledgerError);
  const standing = deps.standing?.();
  const watch = deps.watch?.();
  const deskSession = lastDeskSession(events);
  return {
    ok: true,
    pid: deps.pid ?? process.pid,
    version: deps.version ?? DSH_PIN,
    bootedAt: since,
    uptimeMs: at - deps.bootedAt,
    desk: { enabled: deps.enabled, dir: deskDir(deps.home) },
    asleep,
    runs: runsOf(events),
    ...(off === undefined ? {} : { off }),
    ...(deskSession === undefined ? {} : { deskSession }),
    turnsToday,
    budget,
    ...(standing === undefined ? {} : { standing }),
    ...(deps.phone === undefined ? {} : { phone: deps.phone() }),
    ...(watch === undefined ? {} : { watch }),
    fetchesToday,
    ...(ledgerError === undefined ? {} : { ledgerError }),
  };
}

/** The pause line: since when and by whom, until when for a timed pause, and the terminal command that
 * lifts it. */
function offLine(off: OffState, now: Date): string {
  const until = off.until === undefined ? "" : ` until ${deskTime(new Date(off.until), now)}`;
  return `desk: paused since ${deskTime(new Date(off.setAt), now)} by ${off.by}${until} (npm run desk -- resume)`;
}

/** The phone line: that the face has no account's half to reach; that the account has no network connected, and where
 * one is; else each network and whether it polls - `blocked (403)` first when the operator blocked the bot - the last
 * read of the inbox, what the account's outbox holds and how many strangers Not you lists, then a network's last
 * conflict and its failing poll; and last, while the account does not answer, since when and why.
 * @param phone - the bridge's status.
 * @param now - when the line is read.
 */
export function phoneLine(phone: PhoneStatus, now: Date): string {
  if (!phone.configured) return "phone: none (the account's half is off)";
  const failing = phone.accountFailing === undefined ? ""
    : `, the account has not answered since ${deskTime(new Date(phone.accountFailing.since), now)}: ${phone.accountFailing.reason}`;
  if (phone.networks.length === 0) return `phone: nothing connected (Account › Identity)${failing}`;
  const parts = [
    phone.networks.map((n) => `${n.network} ${n.blocked === true ? "blocked (403), " : ""}${n.polling ? "polling" : "not polling"}`).join(", "),
    phone.lastPollAt === undefined ? "no poll yet" : `last poll ${deskTime(new Date(phone.lastPollAt), now)}`,
    `${phone.queued} queued`,
    `${phone.strangers} stranger${phone.strangers === 1 ? "" : "s"}`,
  ];
  for (const n of phone.networks) {
    if (n.conflictAt !== undefined) parts.push(`${n.network} conflict at ${deskTime(new Date(n.conflictAt), now)}`);
    if (n.pollFailing !== undefined) parts.push(`${n.network} poll failing since ${deskTime(new Date(n.pollFailing.since), now)}: ${n.pollFailing.reason}`);
  }
  return `phone: ${parts.join(", ")}${failing}`;
}

/**
 * The day's budget as one status line (ruling P2-8), numbers as `en-US` writes them: `budget: 1,234,567
 * tokens today, cap not set (budget.dailyTokens in standing.yml)` with no cap; `budget: 1,234,567 of
 * 2,000,000 tokens today` under it; `budget: spent, 2,013,402 of 2,000,000 tokens today; standing orders
 * and phone turns wait for 00:00 ET` once it is reached - and after any of them ` (ledger unreadable:
 * <error>)` when the ledger could not be read, the zeros then counted being no measure of the day.
 * @param b - the day's budget.
 */
export function budgetLine(b: BudgetState): string {
  const used = b.used.total.toLocaleString("en-US");
  const cap = b.dailyTokens?.toLocaleString("en-US");
  const line = cap === undefined
    ? `budget: ${used} tokens today, cap not set (budget.dailyTokens in standing.yml)`
    : b.spent
      ? `budget: spent, ${used} of ${cap} tokens today; standing orders and phone turns wait for 00:00 ET`
      : `budget: ${used} of ${cap} tokens today`;
  return b.error === undefined ? line : `${line} (ledger unreadable: ${b.error})`;
}

/** How many characters of a refused `standing.yml`'s errors its status line quotes - the first fault or
 * two; the phone's line when the file is refused quotes 500. */
const REFUSED_SHOWN_MAX = 200;

/** `text` cut to `max` characters (code points), the last a `…` when it is cut, as desk-book.ts and
 * market-clock.ts cut theirs. */
function cutText(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** A time the standing orders' status holds, as {@link deskTime} shows it - or as written when it is no
 * time: a firing's `t` comes from the firing ledger, a file the operator may edit, and a status line
 * must never throw. */
function statusTime(iso: string, now: Date): string {
  return Number.isNaN(Date.parse(iso)) ? iso : deskTime(new Date(iso), now);
}

/** One standing order's state as its line says it: the first of these that holds - its firing running,
 * the order disabled, expired, its text's pin moved or the text gone, the same of its script, its
 * strategy's `levels.yml` changed, gone or unreadable since arming - else its anchor and when it next
 * falls, or that the calendar's window holds no session for it. A pin not yet checked (`unknown`) claims
 * nothing. A firing's key is `<id>:<date>`, and an id holds no `:`. */
function orderState(order: StandingStatus["orders"][number], running: StandingStatus["running"], now: Date): string {
  if (running !== undefined && running.key.startsWith(`${order.id}:`)) return `running since ${statusTime(running.startedAt, now)}`;
  if (!order.enabled) return "disabled";
  if (order.expired) return `expired after ${order.expires}`;
  const rearm = `changed since arming (npm run desk -- rearm ${order.id})`;
  const text = `${order.dir}/${order.file}`;
  if (order.hash === "changed") return `${text} ${rearm}`;
  if (order.hash === "missing") return `${text} is missing`;
  const script = order.producer ?? "its producer";
  if (order.producerHash === "changed") return `${script} ${rearm}`;
  if (order.producerHash === "missing") return `${script} is missing`;
  const levels = `${order.dir}/levels.yml`;
  if (order.levelsHash === "changed") return `${levels} ${rearm}`;
  if (order.levelsHash === "missing") return `${levels} is gone since arming (npm run desk -- rearm ${order.id})`;
  if (order.levelsHash === "unreadable") return `${levels} cannot be read`;
  return order.nextAnchor === undefined
    ? `${order.at}, no session in the calendar's window`
    : `${order.at}, next ${statusTime(order.nextAnchor, now)}`;
}

/**
 * The standing orders' lines (src/standing.ts `StandingStatus`) as the terminal and the phone print them:
 * first what holds the whole book - `standing orders: none armed (npm run desk -- arm)` while it has no
 * order and is not refused, else `standing orders stopped: standing.yml is refused: <its errors, joined by
 * "; " and cut at 200 characters>`; `standing orders stopped: the firing ledger cannot be read (<code>)`;
 * `standing orders: no calendar today, <clock>: <error>` for the US calendar, `standing orders: no A-share
 * calendar today, <clock>: <error>` for the A-share one - then a line per order of the last good load,
 * `standing <id>: <state>` ({@link orderState}) - `standing <id>: market cn, <state>` for an A-share order -
 * with `; last <outcome> <time>` after it once the order has fired. Times are New York's, as
 * {@link deskTime} shows them.
 * @param s - the standing orders' status.
 * @param now - when the lines are read: what "today" is.
 */
export function standingLines(s: StandingStatus, now: Date): string[] {
  const lines: string[] = [];
  if (s.file.state === "refused") {
    lines.push(`standing orders stopped: standing.yml is refused: ${cutText((s.file.errors ?? []).join("; "), REFUSED_SHOWN_MAX)}`);
  } else if (s.orders.length === 0) lines.push("standing orders: none armed (npm run desk -- arm)");
  if (s.ledger !== undefined) lines.push(`standing orders stopped: the firing ledger cannot be read (${s.ledger.error})`);
  if (s.calendar.state === "failed") lines.push(`standing orders: no calendar today, ${s.calendar.clock}: ${s.calendar.error ?? "no reason given"}`);
  const cn = s.calendars?.cn;
  if (cn?.state === "failed") lines.push(`standing orders: no A-share calendar today, ${cn.clock}: ${cn.error ?? "no reason given"}`);
  for (const order of s.orders) {
    const last = order.last === undefined ? "" : `; last ${order.last.outcome} ${statusTime(order.last.t, now)}`;
    const market = order.market === "cn" ? "market cn, " : "";
    lines.push(`standing ${order.id}: ${market}${orderState(order, s.running, now)}${last}`);
  }
  return lines;
}

/**
 * The desk's lines as the operator reads them, in `npm run service -- status` (scripts/service.ts
 * `formatStatus`) and in the phone's `/status` (src/phone-bridge.ts): the desk line - how long the face has
 * been up and since when, and whether the desk is on - then, while a pause is in force, the pause line;
 * when the status carries the bridge, the phone line ({@link phoneLine}); when it carries the day's budget, the budget
 * line ({@link budgetLine}); when it carries the standing orders - while their clock runs - their
 * lines ({@link standingLines}); and when it carries the watch - while it runs - its lines
 * ({@link watchLines}). Each time is New York's, as {@link deskTime} shows it - dated when it
 * falls on another New York date than `now`'s; the boot time stays ISO-8601 UTC, which carries its date
 * anyway. The desk line is the tail of `formatStatus`'s `answering at` line, which puts the port before it.
 * @param status - what {@link deskStatus} answered.
 * @param now - when the lines are read: what "today" is.
 */
export function deskStatusLines(status: DeskStatus, now: Date): string[] {
  const hours = Math.floor(status.uptimeMs / 3_600_000);
  const minutes = Math.floor(status.uptimeMs / 60_000) % 60;
  const lines = [`up ${hours}h ${minutes}m since ${status.bootedAt} · desk ${status.desk.enabled ? "on" : "off (FACE_DESK=0)"}`];
  if (status.off !== undefined) lines.push(offLine(status.off, now));
  if (status.phone !== undefined) lines.push(phoneLine(status.phone, now));
  if (status.budget !== undefined) lines.push(budgetLine(status.budget));
  if (status.standing !== undefined) lines.push(...standingLines(status.standing, now));
  if (status.watch !== undefined) lines.push(...watchLines(status.watch, now));
  return lines;
}

/** How many characters of a watch file's error its status line quotes. */
const FILE_ERROR_SHOWN_MAX = 80;
/** How many characters of a market's or the filings' last error a status line quotes. */
const WATCH_ERROR_SHOWN_MAX = 200;

/** A market as the watch's lines name it. */
const MARKET_NAMES = { us: "US", cn: "A shares" } as const;

/** The reasons an alert is suppressed, in the order the lines count them. */
const SUPPRESS_ORDER = ["cap", "muted", "off", "cooldown", "window"] as const;

/** One market's phase as its line says it: no calendar, closed, before the open, polling, after the close. */
function marketPhase(m: WatchStatus["markets"]["us"], now: Date): string {
  const date = m.session?.date ?? "today's";
  switch (m.state) {
    case "no-calendar":
      return "no calendar today";
    case "closed":
      return "closed today";
    case "waiting":
      return m.session === undefined ? "waiting for the session" : `the ${date} session opens at ${statusTime(m.session.open, now)}`;
    case "polling":
      return `polling the ${date} session, ${m.watched} symbols, ${m.lastPollAt === undefined ? "no poll yet" : `last poll ${statusTime(m.lastPollAt, now)}`}`;
    case "after-close":
    default:
      return `the ${date} session has closed`;
  }
}

/** One market's alerts today, or nothing when it has no record on its session date: `<n> sent`, then the
 * suppressed ones by reason and the repeats in a cooldown, zero counts left out. */
function todayLine(name: string, today: WatchStatus["markets"]["us"]["today"]): string | undefined {
  const reasons = SUPPRESS_ORDER.filter((r) => today.suppressed[r] > 0);
  const suppressed = reasons.reduce((n, r) => n + today.suppressed[r], 0);
  if (today.sent === 0 && suppressed === 0 && today.repeats === 0) return undefined;
  const parts = [`${today.sent} sent`];
  if (suppressed > 0) parts.push(`${suppressed} suppressed (${reasons.map((r) => `${r} ${today.suppressed[r]}`).join(", ")})`);
  if (today.repeats > 0) parts.push(`${today.repeats} repeats in a cooldown`);
  return `alerts today (${name}): ${parts.join(", ")}`;
}

/** The filings' state as its line says it. A poll's error names its first symbol's; the status keeps no count. */
function filingsPhrase(f: WatchStatus["filings"], now: Date): string {
  switch (f.state) {
    case "no-contact":
      return "off: set ALPHA_EDGAR_USER_AGENT";
    case "refused-today":
      return "off until tomorrow: SEC refused the requests";
    case "polling": {
      const poll = f.lastPollAt === undefined ? "no poll yet" : `last poll ${statusTime(f.lastPollAt, now)}`;
      return `polling, ${f.symbols} symbols, ${poll}${f.lastError === undefined ? "" : `; last error ${cutText(f.lastError, WATCH_ERROR_SHOWN_MAX)}`}`;
    }
    case "off":
    default:
      return "off";
  }
}

/**
 * The watch's lines (src/watch.ts `WatchStatus`), appended by {@link deskStatusLines} after P2's:
 * - `watch: <starting | nothing to watch | stopped | another face (pid <n>) holds the watch on this home | off today:
 *   its lease cannot be written (<error>) | watching>`;
 * - per market with a source (its state not `off`): `watch <US | A shares>: <no calendar today | closed today | the
 *   <date> session opens at <HH:MM ET> | polling the <date> session, <n> symbols, last poll <HH:MM ET> | the <date>
 *   session has closed>[; not watched: <k>][; <its last error>]`;
 * - per market with a record on its session date: `alerts today (<US | A shares>): <n> sent[, <k> suppressed
 *   (<reason> <k>, …)][, <r> repeats in a cooldown]`;
 * - `alerts: <k> held for the next hour's batch` while any are held; `alerts: muted until <HH:MM ET> (npm run desk --
 *   unmute)`, or `until a terminal lifts it`; `alerts: the ledger cannot be read (<error>), so the watch sends nothing
 *   until it can` while it cannot;
 * - `filings: <off | off: set ALPHA_EDGAR_USER_AGENT | polling, <n> symbols, last poll <HH:MM ET>[; last error <e>] |
 *   off until tomorrow: SEC refused the requests>`;
 * - only for files with refusals or an error: `watch files refused: <file> <k> of <n>[; <file> (<error, cut at 80>)]`,
 *   `<n>` the entries loaded and refused.
 * Times are New York's, as {@link deskTime} shows them.
 * @param w - the watch's status.
 * @param now - when the lines are read: what "today" is.
 */
export function watchLines(w: WatchStatus, now: Date): string[] {
  const head = w.state === "idle" ? "nothing to watch"
    : w.state === "held-elsewhere" ? `another face${w.holder === undefined ? "" : ` (pid ${w.holder.pid})`} holds the watch on this home`
      : w.state === "lease-failed" ? `off today: its lease cannot be written (${w.leaseError ?? "unknown"})`
        : w.state;
  const lines = [`watch: ${head}`];
  const markets = ["us", "cn"] as const;
  for (const m of markets) {
    const s = w.markets[m];
    if (s.state === "off") continue;
    const notWatched = s.notWatched.length === 0 ? "" : `; not watched: ${s.notWatched.length}`;
    const error = s.lastError === undefined ? "" : `; ${cutText(s.lastError, WATCH_ERROR_SHOWN_MAX)}`;
    lines.push(`watch ${MARKET_NAMES[m]}: ${marketPhase(s, now)}${notWatched}${error}`);
  }
  for (const m of markets) {
    const line = todayLine(MARKET_NAMES[m], w.markets[m].today);
    if (line !== undefined) lines.push(line);
  }
  if (w.pending > 0) lines.push(`alerts: ${w.pending} held for the next hour's batch`);
  if (w.muted !== undefined) {
    lines.push(`alerts: muted until ${w.muted.until === undefined ? "a terminal lifts it" : statusTime(w.muted.until, now)} (npm run desk -- unmute)`);
  }
  if (w.ledgerError !== undefined) lines.push(`alerts: the ledger cannot be read (${w.ledgerError}), so the watch sends nothing until it can`);
  lines.push(`filings: ${filingsPhrase(w.filings, now)}`);
  const refused = w.files.flatMap((f) => (f.error !== undefined ? [`${f.file} (${cutText(f.error, FILE_ERROR_SHOWN_MAX)})`]
    : f.refusals.length > 0 ? [`${f.file} ${f.refusals.length} of ${f.entries + f.refusals.length}`] : []));
  if (refused.length > 0) lines.push(`watch files refused: ${refused.join("; ")}`);
  return lines;
}

/** What the pause route answers an `until` that {@link parseDuration} does not read. */
const UNTIL_REFUSED = "until must look like 30m, 2h or 1d";

/**
 * Pause the desk from the Desk panel: `writeOff` set by `page`, for `until` - a duration as
 * {@link parseDuration} reads it, `30m`, `2h`, `1d` - after `now()`, or until a resume when the body
 * has no `until`. Any other `until`, a non-string included, is an `HttpError` 400 before anything is
 * written. Answers `{ off }`, the pause in force afterwards: a page pause never shortens one in force
 * ({@link writeOff}), so it may be a longer pause that stood rather than the one asked for, and the
 * panel shows what is true.
 * @param body - the request's JSON object.
 * @param home - the harness home.
 * @param now - the clock, read once for `setAt` and the end.
 */
async function pauseFromPage(body: Record<string, unknown>, home: string, now: () => number): Promise<{ off: OffState }> {
  const { until } = body;
  const ms = typeof until === "string" ? parseDuration(until) : undefined;
  if (until !== undefined && ms === undefined) throw new HttpError(400, UNTIL_REFUSED);
  const at = now();
  return { off: await writeOff(home, { by: "page", ...(ms === undefined ? {} : { until: at + ms }) }, () => at) };
}

/**
 * Mount the desk's two routes, behind the browser fence: `GET /data/desk/status`, which answers
 * {@link deskStatus} through http.ts's {@link fencedGet}, and `POST /data/desk/pause`, the Desk
 * panel's Pause, through {@link fencedPost} - `{ until?: "<duration>" }` in, `{ off }`, the pause in
 * force, out (`pauseFromPage`). The fence refuses first, with the fixed `FORBIDDEN` body; anything that
 * throws is a `500` with a fixed message, so a pause that could not be written is never reported as
 * one. An unreadable ledger is not a failure of the status: {@link deskStatus} names it inside a `200`.
 * There is no resume route: the page, like the phone, only ever pauses, and a terminal resumes (spec
 * §5.8).
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - {@link deskStatus}'s, read on every request - `home` and `now` serve the pause too -
 *   and `isTrusted`, the fence (default {@link isTrustedDataRequest}).
 * @throws when a path is already registered - a duplicate route is a composition error the
 *   webserver refuses on purpose.
 */
export function registerDeskRoutes(
  webServer: RouteRegistrar,
  deps: Parameters<typeof deskStatus>[0] & { isTrusted?: (req: IncomingMessage) => boolean },
): void {
  const isTrusted = deps.isTrusted ?? isTrustedDataRequest;
  webServer.register({
    kind: "exact",
    path: "/data/desk/status",
    handler: fencedGet(isTrusted, () => deskStatus(deps)),
  });
  webServer.register({
    kind: "exact",
    path: "/data/desk/pause",
    handler: fencedPost(isTrusted, (body) => pauseFromPage(body, deps.home, deps.now ?? Date.now)),
  });
}

/** The root bus as the desk's owners listen to it: `on` called on the context, as cordis's must be. */
function busOf(ctx: DeskConversationCtxLike): SessionEventsOn {
  return (name, listener) => {
    const off = ctx.on(name, listener);
    return () => { off(); };
  };
}

/** dsh-agent's `agent/inbox/claimed` on the booted root context, as the desk conversation hears it: every agent's
 * claims (the event is scope-filtered, and the root's listener is unscoped). */
function claimsOf(ctx: DeskConversationCtxLike): ClaimsOn {
  return (listener) => {
    const off = (ctx as unknown as { on(name: string, listener: (payload: never) => void): () => unknown }).on("agent/inbox/claimed", listener);
    return () => { off(); };
  };
}

/** The desk session's slice of `ctx` with the session persistence a keyed post needs (src/desk-conversation.ts):
 * `ctx` itself when it carries `sessionPersistence`, or when it has no `get` that answers one; else a slice that
 * reads `ctx`'s members through it and carries the persistence `ctx.get("sessionPersistence")` answered - main.ts
 * reads the booted context's services through `get`. */
function withPersistence(ctx: DeskSessionCtxLike): DeskSessionCtxLike {
  if (ctx.sessionPersistence !== undefined) return ctx;
  const get = (ctx as { get?: (name: string) => unknown }).get;
  const persistence = typeof get === "function" ? get.call(ctx, "sessionPersistence") as DeskSessionPersistenceLike | undefined : undefined;
  if (persistence === undefined) return ctx;
  return {
    get agents() { return ctx.agents; },
    get agentPresets() { return ctx.agentPresets; },
    get permissionPresets() { return ctx.permissionPresets; },
    sessionPersistence: persistence,
  };
}

/** What {@link installDesk} hands back. `bootedAt` is when this run began, in ms since the epoch;
 * `ready` settles once the `boot` event is written or its failure logged, and never rejects;
 * `conversation` is the desk session's owner (src/desk-conversation.ts), present only when the
 * desk is on and `installDesk` was given what it needs; `annotator`, the alert annotations' lane (src/annotator.ts),
 * present with the conversation; `schedule`, present with the conversation,
 * settles to the standing orders' clock (src/schedule.ts) once its module has loaded - `undefined` when it
 * could not load, or when the desk was disposed first - and never rejects; `watchRow`, present with the schedule
 * when `installDesk` was given `watchRow`, settles to the watch (src/watch.ts) once its module has loaded -
 * `undefined` with no quote source or one `unavailable`, when the schedule or the watch could not load, or when the
 * desk was disposed first - and never rejects; `dispose(code)` ends the run. */
export interface DeskHandle {
  enabled: boolean;
  bootedAt: number;
  ready: Promise<void>;
  conversation?: DeskConversation;
  annotator?: Annotator;
  schedule?: Promise<ScheduleHandle | undefined>;
  watchRow?: Promise<WatchHandle | undefined>;
  dispose(code: number): Promise<void>;
}

/** An alert's annotation turn's deadline (P3-12; 240 s since the why-it-moved plan, room for a US move's look at the
 * news): 240 s from its own `turn/start` in the annotation lane (src/annotator.ts), then the turn is cut with its own
 * line as a reply. */
export const ALERT_DEADLINE_MS = 240_000;

/** The watch's timers: the wall clock, `unref`'d, so the watch never holds the process open. */
const watchClock = (now: () => number): DeskClock => ({
  now,
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
});

/**
 * Mount the desk's rows on a booted face.
 *
 * The status and pause routes ({@link registerDeskRoutes}) are mounted whatever `enabled` says -
 * the switch is the home's, not this face's - and so, given both `ctx` and `quotes`, are the two desk
 * tools (src/desk-tools.ts): every `gravit-desk` agent, those already live included, gets
 * `desk_quotes` over `quotes` and `desk_state` over {@link deskStatus} with the status route's own
 * deps, so the tool and the route agree - but for `runs`, which the tool cuts to the last ten and
 * counts in `runsInLedger` - and a face with the desk off still opens an old desk conversation
 * with its tools. Given `ctx`, a quote source or none and whatever `enabled` says, the desk's guard
 * (src/desk-tools.ts `installDeskGuard`) is installed too, its listener and its backstop,
 * anchored on `root`, its secrets taken from `process.env` now: every desk agent's `write`, `edit`
 * or `str_replace_editor` of an instruction file, its read outside `root` or of a key file, and any
 * call of its that carries a secret are denied before they run - and, without a `root`, every desk
 * write and read; and, with it, the fetch record: every desk agent's `web_fetch` that reaches dispatch is a
 * `desk-fetch` line, stamped `now()`, the desk on or off. With the desk on, `ready`
 * is the `boot` event's append - stamped `bootedAt`, which is
 * `now()` at this call and the status's uptime origin - and the sleep watch starts at once, writing
 * into the ledger. Given `root`, `route`, `sessionCtx` and `installModelSelection`
 * too, the desk conversation's owner (src/desk-conversation.ts) is created on the same `now` and
 * started without being awaited - its `start` never rejects. It starts once the bridge, if any, has set the
 * outlet, so a line about a phone turn a restart cut finds it. The desk session is so ensured and
 * supervised before any phone message, and a turn the operator opens from the browser is timed,
 * fenced and recorded like a phone turn. Given `phone` as well, the phone bridge
 * (src/phone-bridge.ts) runs on that conversation over the account's inbox and send: its module loads on first use and the bridge starts
 * without being awaited, on the same `now`. The status route and `desk_state` report the bridge's
 * own status ({@link PhoneStatus}); a face that runs no bridge reports `configured` - whether
 * `phone` was given - and nothing polling, connected, queued or strange. With the conversation, the standing
 * orders' clock (src/schedule.ts) runs too: its module loads on first use, once the bridge has set the
 * outlet, and `schedule` settles to it; its firings deliver through the conversation, the status route
 * and `desk_state` read its orders and its cap, and the conversation's budget is the day's tokens
 * against that cap (ruling P2-8). Given `watchRow` and a quote source that answers, the watch (src/watch.ts, P3)
 * runs too, once the clock row is made: its module loads on first use, it shares the clock row's market calendars,
 * its alerts and lines go out through the conversation's `deliver`, its annotations through the annotation lane
 * (src/annotator.ts, spec §16 H1: each a fresh desk agent of its own, its turn cut at `alertDeadlineMs`, its reply
 * through the conversation's `deliver`, its run noted on the watch), the conversation's desk state is its
 * `stateText`, and the status route and
 * `desk_state` carry its status. `dispose(code)` stops the clock first - the firing under way
 * aborted, waited for two seconds at most - then the watch - its passes and posts waited for two seconds at most,
 * its lease released - then the annotation lane - a check under way cancelled as `shutdown`, its agent let go,
 * waited for 12 s at most -
 * then the bridge - no phone text is posted from then on,
 * and its read of the account's inbox is cut, its cursor kept for the next boot -
 * then the conversation, which cancels the desk turns under way as `shutdown`, gives each cut agent
 * two seconds to go idle so the cut turn is recorded, and gives a start, post or renew under way
 * five seconds to settle, so nothing the conversation writes lands after the `shutdown` - then
 * removes the tools' listener and the guard, stops the watch, lets the `boot` append settle (two
 * appends started together take the file lock in either order, and a `shutdown` written before its
 * `boot` reads as a lost run), then appends the `shutdown` with `code`. It is idempotent: a second
 * call writes nothing and settles with the first. With the desk off, `ready` is already resolved,
 * there is no conversation and no bridge, and `dispose` only removes the tools and the guard. Nothing here
 * rejects on the ledger, so a caller need not await `ready`.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - `home`, the harness home; `enabled`, whether to mount the desk's rows; `now`
 *   (default `Date.now`) and `version` (default {@link DSH_PIN}), for the events and the status;
 *   `watch`, the sleep watch's clock and timer seams, for tests - not its `append`, which is
 *   always the ledger's; `ctx`, the booted ROOT context, and `quotes`, the Market's quote source main.ts owns
 *   (src/market-quotes.ts), the tools' and the brief's -
 *   which the desk tools need both of - the guard needs `ctx`, and judges below `root`;
 *   `root`, the repository whose `desk/journal/` the desk session runs in, `route`, its model route
 *   (src/desk-session.ts `resolveDeskRoute`), `sessionCtx`, the booted ROOT context as the
 *   conversation reads it - and its default model and model calls, which a standing order's route
 *   is resolved on - and
 *   `installModelSelection`, dsh-agent's - the four the conversation needs; `phone`, the
 *   account's inbox and send (src/phone.ts `createPhoneClient`), absent when the `mcp-account` row
 *   is disabled; `deskDeadlineMs`, every desk turn's deadline, handed to the conversation as its
 *   `deadlineMs` (its own five minutes when absent) - a test seam, which tests/phone-smoke.test.ts
 *   sets to 1,500 so a parked card is cut in a second and a half; main.ts never passes it;
 *   `python`, the interpreter a `.py` script producer runs under - `FACE_PYTHON || python3` when absent
 *   (no calendar needs it: the market clock is builtin); `schedule`, the clock's seams for tests - its
 *   clock, calendar (the XNYS one), calendars (either market's), script runner, builtins, tick and grace;
 *   `alertDeadlineMs`, an alert's annotation turn's deadline, {@link ALERT_DEADLINE_MS} when absent - a test seam;
 *   `watchRow`, the watch's switch and seams - its clock (the wall clock, `unref`'d), tick, calendars (over the
 *   schedule's), whether a pid lives, `edgar`, SEC's fetch and contact: `null` for none, absent for the face's
 *   own, the global `fetch` with `ALPHA_EDGAR_USER_AGENT` when that is set - the watch's filings poll and its why
 *   posts' filings read both use it - and `news`, a why post's headline read: `null` for none, absent for the
 *   Market's (src/market-news.ts `marketNews`, loaded with the watch); the watch's posts wait on the annotation
 *   lane's `idle`, so passes that come while a turn runs fold into one post; `log`,
 *   where every line of the desk's goes - the guard's, its line at install naming what the secret
 *   check covers included, the tools', the ledger's, the conversation's, the bridge's and the clock's -
 *   stderr when absent, as main.ts leaves it; tests pass their own, or one that drops the line.
 * @throws when a desk route's path is already registered, before anything is written or started.
 */
export function installDesk(
  webServer: RouteRegistrar,
  deps: {
    home: string;
    enabled: boolean;
    now?: () => number;
    version?: string;
    watch?: Partial<Omit<AsleepWatchOptions, "append">>;
    ctx?: DeskGuardCtxLike;
    quotes?: MarketQuoteSource;
    root?: string;
    route?: { provider: string; model: string };
    sessionCtx?: DeskConversationCtxLike & Partial<FiringRouteCtx>;
    installModelSelection?: NonNullable<DeskSessionDeps["installModelSelection"]>;
    phone?: PhoneClient;
    deskDeadlineMs?: number;
    python?: string;
    schedule?: { clock?: DeskClock; calendars?: Partial<DeskCalendars> } & Partial<Pick<ScheduleDeps, "calendar" | "runScript" | "builtins" | "tickMs" | "graceMs">>;
    alertDeadlineMs?: number;
    watchRow?: {
      clock?: DeskClock;
      tickMs?: number;
      calendars?: Partial<DeskCalendars>;
      edgar?: { fetch: EdgarFetch; userAgent: string } | null;
      news?: ((symbols: readonly string[], since: string) => Promise<Map<string, NewsAnswer>>) | null;
      alive?: (pid: number) => boolean;
    };
    log?: (line: string) => void;
  },
): DeskHandle {
  const { home, enabled } = deps;
  const now = deps.now ?? Date.now;
  const version = deps.version ?? DSH_PIN;
  const log = deps.log ?? ((line: string): void => { console.error(line); });
  const bootedAt = now();
  /* The bridge once it runs; until then, and in a face that runs none, the status says only whether its
   * two names are set. */
  let bridge: PhoneBridgeHandle | undefined;
  const phone = (): PhoneStatus => bridge?.status() ?? { configured: deps.phone !== undefined, polling: false, networks: [], queued: 0, strangers: 0 };
  /* The standing orders' clock once it runs: the status's orders and the day's cap are its; until then, and in a
   * face that runs none, there are no orders and no cap. */
  let schedule: ScheduleHandle | undefined;
  /* The watch once it runs (P3): the status's `watch` is its; until then, and in a face that runs none, there is none. */
  let watch: WatchHandle | undefined;
  const status = {
    home, bootedAt, enabled, now, version, phone,
    dailyTokens: () => schedule?.dailyTokens(),
    standing: () => schedule?.status(),
    watch: () => watch?.status(),
  };
  registerDeskRoutes(webServer, status);
  /* every desk web_fetch that reaches dispatch is a desk-fetch line, the desk on or off (spec 2026-11-07 §5.6) */
  const recordFetch = ({ sessionId, url }: DeskFetch): Promise<void> =>
    appendEvent(home, { t: new Date(now()).toISOString(), kind: "desk-fetch", sessionId, url }, { log });
  const removeGuard = deps.ctx === undefined ? async () => {} : installDeskGuard(deps.ctx, deps.root, { log, recordFetch });
  const removeTools = deps.ctx === undefined || deps.quotes === undefined ? () => {} : installDeskTools(deps.ctx, deskToolDefinitions({
    quotes: deps.quotes,
    readState: () => deskStatus(status),
  }), { log });
  if (!enabled) return { enabled, bootedAt, ready: Promise.resolve(), dispose: async () => { removeTools(); await removeGuard(); } };
  const ready = appendEvent(home, { t: new Date(bootedAt).toISOString(), kind: "boot", pid: process.pid, version, deskEnabled: true }, { log });
  const stopWatch = installAsleepWatch({ now, ...deps.watch, append: (event) => appendEvent(home, event, { log }) });
  const clock: DeskClock = { now, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) };
  const { root, route, sessionCtx, installModelSelection } = deps;
  const wiring = root === undefined || route === undefined || sessionCtx === undefined || installModelSelection === undefined
    ? undefined
    : { root, sessionCtx, session: { ctx: withPersistence(sessionCtx), root, home, route, installModelSelection, now, log }, on: busOf(sessionCtx) };
  const conversation = wiring === undefined
    ? undefined
    : createDeskConversation({
      session: wiring.session,
      on: wiring.on,
      onClaimed: claimsOf(wiring.sessionCtx),
      deadlineMs: deps.deskDeadlineMs,
      /* the day's budget against the standing orders' cap - none until their clock has read standing.yml (P2-8) */
      budget: () => readBudget(home, now(), schedule?.dailyTokens()),
      clock,
      log,
    });
  /* The alert annotations' lane (spec §16 H1): each pass's check in a fresh desk agent of its own, never queued behind
   * the conversation's turns; its reply leaves through the conversation's `deliver`, and its run is noted on the watch,
   * read when the run ends - the watch is installed later, after the clock row. */
  const annotator = wiring === undefined || conversation === undefined
    ? undefined
    : createAnnotator({
      session: wiring.session,
      home,
      root: wiring.root,
      on: wiring.on,
      deliver: (text, opts) => conversation.deliver(text, opts),
      budget: () => readBudget(home, now(), schedule?.dailyTokens()),
      deadlineMs: deps.alertDeadlineMs ?? ALERT_DEADLINE_MS,
      onAnnotated: (r) => { watch?.noteAnnotated(r); },
      clock,
      log,
    });
  let disposing: Promise<void> | undefined;
  /* The bridge's module loads on first use, as the conversation's machinery does (src/desk-conversation.ts,
   * MODULE WEIGHT): the pause switch and scripts/service.ts import this module and never run a bridge. Not
   * awaited, and it never rejects - a module that cannot load, or a bridge that throws as it installs, is one line; a
   * module that arrives once dispose has begun installs nothing. */
  const client = deps.phone;
  const bridging = client === undefined || conversation === undefined ? Promise.resolve() : import("./phone-bridge.ts").then(
    (bridgeModule) => {
      if (disposing !== undefined) return;
      bridge = bridgeModule.installPhoneBridge({
        phone: client,
        clock,
        home,
        conversation,
        status: () => deskStatus(status),
        log,
        /* a reply's alert and its annotation (spec §16 H1b): the watch is installed after the bridge, so it is read at
         * each reply - none until it runs, and none in a face that runs none */
        contextFor: (messageId) => watch?.contextFor(messageId),
      });
    },
  ).catch((err: unknown) => {
    /* the module's load and the bridge's install alike: one line, and the desk goes on without a bridge */
    log(`${BIN}: desk: the phone bridge could not be started: ${reasonOf(err)}`);
  });
  /* The conversation starts once the bridge has set the outlet (or there is no bridge): a start that resumed the desk
   * session may answer a phone turn the restart cut at once (src/desk-conversation.ts AFTER A RESTART), and that line
   * must find the outlet. `bridging` never rejects; were it to, the conversation starts all the same. */
  const startConversation = (): Promise<void> | undefined => conversation?.start();
  void bridging.then(startConversation, startConversation);
  /* The standing orders' clock (src/schedule.ts) loads on first use too - with it src/firing.ts, src/standing.ts and
   * js-yaml - once the bridge has set the outlet, so the boot's lines reach the phone. It never rejects: a module that
   * cannot load, or a clock that cannot start, is one line and `undefined`; one that arrives once dispose has begun
   * starts nothing. The desk's one pair of market calendars (P3's ruling 13) is made here, from the schedule's
   * module, so src/xshg-clock.ts loads with it and never with this file: the clock row and the watch share the
   * pair. */
  let calendars: DeskCalendars | undefined;
  const scheduling = wiring === undefined || conversation === undefined ? undefined : bridging
    .then(() => import("./schedule.ts"))
    .then((scheduleModule) => {
      if (disposing !== undefined) return undefined;
      calendars = scheduleModule.deskCalendars({
        ...(deps.schedule?.calendar === undefined ? {} : { us: deps.schedule.calendar }),
        ...deps.schedule?.calendars,
        ...deps.watchRow?.calendars,
      });
      schedule = scheduleModule.createDeskSchedule({
        home,
        root: wiring.root,
        python: deps.python ?? (process.env.FACE_PYTHON || "python3"),
        quotes: deps.quotes,
        session: wiring.session,
        sessionCtx: wiring.sessionCtx,
        on: wiring.on,
        deliver: (text, opts) => conversation.deliver(text, opts),
        log,
        /* the schedule's clock reads the same now as the conversation's, unless a test hands it a clock of its own */
        ...(deps.now === undefined ? {} : { now: deps.now }),
        seams: { ...deps.schedule, calendar: calendars.us, calendars },
      });
      return schedule;
    })
    .catch((err: unknown) => {
      log(`${BIN}: desk: the standing orders' clock could not be loaded: ${reasonOf(err)}`);
      return undefined;
    });
  /* The watch (src/watch.ts, P3) loads on first use as well, in the same chain once the clock row is made - only when
   * `watchRow` is given (main.ts passes `{}`; tests/desk.test.ts and tests/watch-smoke.test.ts pass theirs over a
   * scratch home and repo, so none polls the operator's book) and the quote
   * source answers: one source serves both markets, so a face with no Market read watches neither. It never rejects:
   * a module that cannot load is one line and `undefined`; one that arrives once dispose has begun starts nothing. */
  const watchRow = deps.watchRow;
  const quotes = deps.quotes;
  const watching = scheduling === undefined || watchRow === undefined || conversation === undefined || annotator === undefined ? undefined : scheduling
    .then(async (made) => {
      if (made === undefined || calendars === undefined || quotes === undefined || quotes.unavailable !== undefined) return undefined;
      const watchModule = await import("./watch.ts");
      if (disposing !== undefined) return undefined;
      const userAgent = process.env.ALPHA_EDGAR_USER_AGENT;
      const edgar = watchRow.edgar === null ? undefined
        : watchRow.edgar ?? (userAgent ? { fetch: globalThis.fetch as EdgarFetch, userAgent } : undefined);
      const news = watchRow.news === null ? undefined : watchRow.news ?? (await import("./market-news.ts")).marketNews();
      if (disposing !== undefined) return undefined;
      const handle = watchModule.installWatch({
        home,
        root: wiring?.root ?? "",
        quotes,
        calendars,
        clock: watchRow.clock ?? watchClock(now),
        deliver: (text, opts) => conversation.deliver(text, opts),
        post: (input) => annotator.post(input),
        idle: () => annotator.idle(),
        budget: () => readBudget(home, now(), schedule?.dailyTokens()),
        ...(edgar === undefined ? {} : { edgar }),
        ...(news === undefined ? {} : { news }),
        ...(watchRow.alive === undefined ? {} : { alive: watchRow.alive }),
        ...(watchRow.tickMs === undefined ? {} : { tickMs: watchRow.tickMs }),
        log,
      });
      watch = handle;
      conversation.setState(() => handle.stateText());
      return handle;
    })
    .catch((err: unknown) => {
      log(`${BIN}: desk: the watch could not be loaded: ${reasonOf(err)}`);
      return undefined;
    });
  return {
    enabled,
    bootedAt,
    ready,
    ...(conversation === undefined ? {} : { conversation }),
    ...(annotator === undefined ? {} : { annotator }),
    ...(scheduling === undefined ? {} : { schedule: scheduling }),
    ...(watching === undefined ? {} : { watchRow: watching }),
    dispose(code) {
      disposing ??= (async () => {
        await (await scheduling)?.dispose();
        await (await watching)?.dispose();
        await annotator?.dispose();
        conversation?.setState(undefined);
        await bridging;
        await bridge?.dispose();
        await conversation?.dispose();
        removeTools();
        await removeGuard();
        stopWatch();
        await ready;
        await appendEvent(home, { t: new Date(now()).toISOString(), kind: "shutdown", pid: process.pid, code }, { log });
      })();
      return disposing;
    },
  };
}
