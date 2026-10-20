/** The desk's ledger: `$DSH_HOME/face/desk/events.jsonl`, the face's own record of its lifetime -
 * with the sleep watch that writes into it, the `OFF` switch that pauses the desk, and the status
 * route that reads them back.
 *
 * The desk is Gravit's always-on side (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md):
 * the face kept running by launchd as a user service (§5.2), and, in the later plans, the clock,
 * the watch and the phone bridge that work in it. Of what §8 gives this module - the ledger, the
 * budget, the `OFF` switch, the two desk tools, the `/desk` page and `/data/desk/*` - P0 holds the
 * ledger, the sleep watch and `GET /data/desk/status`, and P1 adds the `OFF` switch and mounts the
 * two desk tools, which src/desk-tools.ts defines. Of the ledger's files (§5.7) this module keeps
 * `events.jsonl` and `OFF`; {@link appendRecord} is the append path for the others. `events.jsonl`
 * has eight kinds of event: P0's `boot`, clean `shutdown` and `asleep` gap in the face's timers,
 * and P1's `off-set` and `off-cleared`, a `desk-session` for each desk conversation the face
 * opens, a `desk-turn` for each turn on it, and a `desk-refused` for a turn the face would not
 * open.
 *
 * Why a ledger: a service that launchd restarts after a crash or a `kill -9` looks healthy from
 * outside - it is running again. Read back as runs ({@link runsOf}), the ledger says otherwise: a
 * boot that the next boot follows with no `shutdown` between is `lost`.
 *
 * The writer appends one JSON object per line under the face's file lock, creates its files
 * `0600`, and rotates the file once it is over {@link LEDGER_ROTATE_BYTES}. It never throws into
 * the face: an append that fails is one `gravit-face:` line on stderr, and a face whose ledger
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
 * {@link installDesk} mounts it all on a booted face. The status route ({@link deskStatus}:
 * pid, version, uptime, this run's gaps, the ledger's runs, the pause in force, the desk
 * conversation, today's desk turns and their tokens, and the Telegram bridge when one is passed)
 * is mounted always, and so are the desk tools, so a face with the desk off - a second face beside
 * the service, §5.2 - still answers, with `desk.enabled: false`, and an old desk conversation it
 * opens keeps its tools; the `boot` event, the watch and the `shutdown` event only when the desk is
 * on. An unreadable ledger is named in the status, never a 500.
 * @module
 */
import { appendFile, lstat, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { basename, extname, join } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { isTrustedDataRequest } from "./data.ts";
import { deskToolDefinitions, installDeskTools, type DeskToolsCtxLike } from "./desk-tools.ts";
import { etDate, etDayStart, etTime } from "./et.ts";
import { fencedGet } from "./http.ts";
import type { QuoteHub } from "./quotes.ts";
import type { RouteRegistrar } from "./static.ts";
import { DSH_PIN } from "./version.ts";

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
 * (`source`), its number, whether it ended or the face's deadline cut it off, its wall time and,
 * when the harness reported them, its tokens. A `desk-refused` is a turn the face would not open:
 * why, and the path that made it refuse when a path did. */
export type DeskEvent =
  | { t: string; kind: "boot"; pid: number; version: string; deskEnabled: boolean }
  | { t: string; kind: "shutdown"; pid: number; code: number }
  | { t: string; kind: "asleep"; from: string; to: string; gapMs: number }
  | { t: string; kind: "off-set"; by: "telegram" | "page" | "terminal"; until?: string }
  | { t: string; kind: "off-cleared"; by: "terminal" | "expiry" }
  | { t: string; kind: "desk-session"; sessionId: string; reason: "created" | "new" }
  | { t: string; kind: "desk-turn"; sessionId: string; source: string; turn: number; outcome: "ended" | "timed-out"; wallMs: number; usage?: TurnUsage }
  | { t: string; kind: "desk-refused"; reason: string; path?: string };

/** Every kind {@link DeskEvent} has, and only those. A record over the union rather than a list,
 * so a kind added to the type and not here fails to compile instead of reading back as skipped. */
const KINDS: Readonly<Record<DeskEvent["kind"], true>> = {
  boot: true,
  shutdown: true,
  asleep: true,
  "off-set": true,
  "off-cleared": true,
  "desk-session": true,
  "desk-turn": true,
  "desk-refused": true,
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

/**
 * Append one record, as one JSON line, to `file` in the desk's directory - the ledger's
 * `events.jsonl` ({@link appendEvent}) or any other of its JSONL files.
 *
 * The directory is made first, because `withFileLock` creates its lock beside the file
 * (`roster.ts`'s `update` keeps the same order). Inside the lock, a file over `rotateBytes` is
 * renamed to `<name>.<t>.<ext>` ({@link rotatedName}) - `t` being the record's own `t` when it
 * carries one as a string, else the time of the append - and the line goes to a fresh file. A file
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
 * @param opts - `rotateBytes`, default {@link LEDGER_ROTATE_BYTES}; `log`, for the failure line.
 */
export async function appendRecord(
  home: string,
  file: string,
  record: object,
  opts: { rotateBytes?: number; log?: (line: string) => void } = {},
): Promise<void> {
  if (basename(file) !== file || file === "" || file === "." || file === "..") {
    throw new TypeError(`appendRecord takes a file name in the desk's directory, not ${JSON.stringify(file)}`);
  }
  const dir = deskDir(home);
  const path = join(dir, file);
  try {
    await mkdir(dir, { recursive: true });
    await withFileLock(path, async () => {
      let size = await sizeOf(path);
      if (size > (opts.rotateBytes ?? LEDGER_ROTATE_BYTES)) {
        const { t } = record as { t?: unknown };
        await rename(path, join(dir, rotatedName(file, typeof t === "string" ? t : new Date().toISOString())));
        size = 0;
      }
      const lead = size > 0 && (await endsMidLine(path, size)) ? "\n" : "";
      await appendFile(path, `${lead}${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    });
  } catch (err) {
    const log = opts.log ?? ((line: string) => console.error(line));
    log(`${BIN}: the desk ledger at ${path} could not be written: ${reasonOf(err)}`);
  }
}

/**
 * Append one event to `$DSH_HOME/face/desk/events.jsonl`: {@link appendRecord} on
 * {@link EVENTS_FILE}, rotated under the event's `t`. Never rejects; a failure is one `log` line.
 * @param home - the harness home.
 * @param event - the event, written as one JSON line.
 * @param opts - `rotateBytes`, default {@link LEDGER_ROTATE_BYTES}; `log`, for the failure line.
 */
export async function appendEvent(
  home: string,
  event: DeskEvent,
  opts: { rotateBytes?: number; log?: (line: string) => void } = {},
): Promise<void> {
  await appendRecord(home, EVENTS_FILE, event, opts);
}

/** One line as an event, or `undefined`: not JSON, not an object, or without a string `t` and a
 * known `kind`. Only those two fields are checked - the face is the file's one writer, and the
 * rest of the shape is the writer's to keep. */
function eventOf(line: string): DeskEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const { t, kind } = parsed as { t?: unknown; kind?: unknown };
  if (typeof t !== "string" || typeof kind !== "string" || !Object.hasOwn(KINDS, kind)) return undefined;
  return parsed as DeskEvent;
}

/**
 * The current ledger's events, in file order, and how many lines were not events.
 *
 * Reads `events.jsonl` only, never a rotated file. An absent ledger - none written yet, or a
 * non-directory where `face/` or `face/desk/` should be, so that none can exist - is
 * `{ events: [], skipped: 0 }`; any other read failure rejects, so an unreadable ledger never
 * reads as an empty one. Every line that {@link eventOf} refuses is skipped and counted, a blank
 * one included; the newline that ends the last line opens no line of its own.
 * @param home - the harness home.
 */
export async function readEvents(home: string): Promise<{ events: DeskEvent[]; skipped: number }> {
  let text: string;
  try {
    text = await readFile(join(deskDir(home), EVENTS_FILE), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { events: [], skipped: 0 };
    throw err;
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events: DeskEvent[] = [];
  let skipped = 0;
  for (const line of lines) {
    const event = eventOf(line);
    if (event === undefined) skipped += 1;
    else events.push(event);
  }
  return { events, skipped };
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

/** What `OFF` holds: when the pause was set and by whom - the phone, the Desk panel or a
 * terminal - and, for a timed pause, when it lifts; both times ISO-8601 UTC. */
export interface OffState {
  setAt: string;
  by: "telegram" | "page" | "terminal";
  until?: string;
}

/** Every setter {@link OffState} names, and only those. */
const SETTERS: Readonly<Record<OffState["by"], true>> = { telegram: true, page: true, terminal: true };

/** Whether `value` is a time: a string `Date.parse` reads. */
const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** `OFF`'s text as a state - JSON with a time `setAt`, a known `by` and, if any, a time `until`;
 * other keys dropped - or `undefined` when it is anything else. */
function offStateOf(text: string): OffState | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const { setAt, by, until } = parsed as { setAt?: unknown; by?: unknown; until?: unknown };
  if (!isTime(setAt) || typeof by !== "string" || !Object.hasOwn(SETTERS, by)) return undefined;
  if (until !== undefined && !isTime(until)) return undefined;
  return { setAt, by: by as OffState["by"], ...(until === undefined ? {} : { until }) };
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
  const file = join(deskDir(home), OFF_FILE);
  let text: string | undefined;
  try {
    text = await readFile(file, "utf8");
  } catch {
    /* nothing to read - no OFF, a link to nothing, a directory, a file shut to the face: lstat tells which */
  }
  const state = text === undefined ? undefined : offStateOf(text);
  if (state !== undefined) return { state, expired: state.until !== undefined && Date.parse(state.until) <= now() };
  let mtime: Date;
  try {
    mtime = (await lstat(file)).mtime;
  } catch (err) {
    if (isAbsent(err)) return { expired: false };
    throw err;
  }
  return { state: { setAt: mtime.toISOString(), by: "terminal" }, expired: false };
}

/** Whether a pause until `until` outlasts one in force until `held`, either being `undefined` for
 * a pause with no end: an open-ended pause outlasts any timed one and is outlasted by none; of two
 * timed pauses, the later `until` outlasts. */
function outlasts(until: string | undefined, held: string | undefined): boolean {
  if (held === undefined) return false;
  if (until === undefined) return true;
  return Date.parse(until) > Date.parse(held);
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
  const until = input.until === undefined ? undefined : new Date(input.until).toISOString();
  const dir = deskDir(home);
  const file = join(dir, OFF_FILE);
  await mkdir(dir, { recursive: true });
  return withFileLock(file, async () => {
    const at = now();
    if (input.by !== "terminal") {
      const { state: held, expired } = await readOffState(home, () => at);
      if (held !== undefined && !expired && !outlasts(until, held.until)) return held;
    }
    const state: OffState = { setAt: new Date(at).toISOString(), by: input.by, ...(until === undefined ? {} : { until }) };
    await writeFileAtomic(file, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await appendEvent(home, { t: state.setAt, kind: "off-set", by: state.by, ...(until === undefined ? {} : { until }) });
    return state;
  });
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
  const file = join(deskDir(home), OFF_FILE);
  try {
    await lstat(file); // nothing there is nothing to lift; something there means the lock's directory exists
  } catch (err) {
    if (isAbsent(err)) return false;
    throw err;
  }
  return withFileLock(file, async () => {
    const at = now();
    if (by === "expiry" && !(await readOffState(home, () => at)).expired) return false;
    try {
      await unlink(file);
    } catch (err) {
      if (isAbsent(err)) return false;
      throw err;
    }
    await appendEvent(home, { t: new Date(at).toISOString(), kind: "off-cleared", by });
    return true;
  });
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

/** The Telegram bridge as the status reports it: `configured`, whether its token and the
 * operator's id are both set; `polling`, whether its loop runs; `lastPollAt`, its last poll;
 * `dropped`, the updates it refused as not the operator's private chat, and `lastDroppedFrom`,
 * the last one's sender; `queued`, the messages waiting in its outbox; `conflictAt`, the last time
 * Telegram said another poller holds the token. */
export interface TelegramStatus {
  configured: boolean;
  polling: boolean;
  lastPollAt?: string;
  dropped: number;
  lastDroppedFrom?: number;
  queued: number;
  conflictAt?: string;
}

/** What `GET /data/desk/status` answers. `pid`, `version` (the dsh version this face runs),
 * `bootedAt` and `uptimeMs` are this process's; `desk` says whether its rows are mounted and where
 * its files are; `asleep` is this run's gaps; `runs` is every run in the current ledger. `off` is
 * the pause in force, present only while one is; `deskSession`, the desk conversation the ledger
 * names last ({@link lastDeskSession}), present only when it names one; `turnsToday`, the desk
 * turns recorded since 00:00 America/New_York and their tokens; `telegram`, the bridge's state,
 * present only when a bridge is passed. `ledgerError` is present only when the ledger could not be
 * read - its code, or its message when it has none - and `asleep` and `runs` are then empty, and
 * `turnsToday` zero: an unreadable ledger is named, never passed off as an empty one. */
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
  telegram?: TelegramStatus;
  ledgerError?: string;
}

/**
 * The face's status as the desk sees it, read from the ledger and `OFF` afresh on every call, at
 * one reading of the clock.
 *
 * `asleep` is every `asleep` event whose `from` is at or after `bootedAt` - this run's gaps, not
 * those of the runs before it; ISO-8601 UTC strings order as their times do, so the comparison is
 * on the strings, as it is for `turnsToday`: the `desk-turn` events whose `t` is at or after the
 * start of today in New York ({@link etDayStart}), counted, their tokens summed - a turn recorded
 * without usage counts and adds nothing. `runs` is {@link runsOf} over the whole current file.
 * `off` is {@link readOffState}'s state unless it has expired: a pause past its `until` is no
 * longer in force, though its file waits for whoever lifts it. Never rejects on the ledger: a read
 * that fails ({@link readEvents} rejects on EACCES, EISDIR, EIO by design) is `ledgerError`; a
 * switch that cannot be read at all is left out, the directory that holds it being the ledger's
 * too.
 * @param deps - `home`, the harness home; `bootedAt`, when this run began, in ms since the epoch;
 *   `enabled`, whether the desk's rows are mounted; `now`, `pid` and `version`, defaulting to
 *   `Date.now`, `process.pid` and {@link DSH_PIN}; `telegram`, the bridge's status, read once
 *   per call when given.
 */
export async function deskStatus(deps: {
  home: string;
  bootedAt: number;
  enabled: boolean;
  now?: () => number;
  pid?: number;
  version?: string;
  telegram?: () => TelegramStatus;
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
  const today = new Date(etDayStart(at)).toISOString();
  const turnsToday = { count: 0, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  for (const e of events) {
    if (e.kind !== "desk-turn" || e.t < today) continue;
    turnsToday.count += 1;
    turnsToday.usage.uncachedInputTokens += e.usage?.uncachedInputTokens ?? 0;
    turnsToday.usage.outputTokens += e.usage?.outputTokens ?? 0;
    turnsToday.usage.cacheReadTokens += e.usage?.cacheReadTokens ?? 0;
    turnsToday.usage.cacheWriteTokens += e.usage?.cacheWriteTokens ?? 0;
  }
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
    ...(deps.telegram === undefined ? {} : { telegram: deps.telegram() }),
    ...(ledgerError === undefined ? {} : { ledgerError }),
  };
}

/**
 * Mount `GET /data/desk/status`, which answers {@link deskStatus} through http.ts's
 * {@link fencedGet}: the browser fence first, refused with the fixed `FORBIDDEN` body; then `200`
 * with the status; anything that throws, a `500` with a fixed message. An unreadable ledger is
 * not a failure here: {@link deskStatus} names it inside a `200`.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - {@link deskStatus}'s, read on every request, and `isTrusted`, the fence (default
 *   {@link isTrustedDataRequest}).
 * @throws when the path is already registered - a duplicate route is a composition error the
 *   webserver refuses on purpose.
 */
export function registerDeskRoutes(
  webServer: RouteRegistrar,
  deps: Parameters<typeof deskStatus>[0] & { isTrusted?: (req: IncomingMessage) => boolean },
): void {
  webServer.register({
    kind: "exact",
    path: "/data/desk/status",
    handler: fencedGet(deps.isTrusted ?? isTrustedDataRequest, () => deskStatus(deps)),
  });
}

/** What {@link installDesk} hands back. `bootedAt` is when this run began, in ms since the epoch;
 * `ready` settles once the `boot` event is written or its failure logged, and never rejects;
 * `dispose(code)` ends the run. */
export interface DeskHandle {
  enabled: boolean;
  bootedAt: number;
  ready: Promise<void>;
  dispose(code: number): Promise<void>;
}

/**
 * Mount the desk's rows on a booted face.
 *
 * The status route is mounted whatever `enabled` says, and so, given both `ctx` and `hub`, are the
 * two desk tools (src/desk-tools.ts): every `gravit-desk` agent, those already live included, gets
 * `desk_quotes` over `hub` and `desk_state` over {@link deskStatus} with the status route's own
 * deps, so the tool and the route agree - but for `runs`, which the tool cuts to the last ten and
 * counts in `runsInLedger` - and a face with the desk off still opens an old desk conversation
 * with its tools. With the desk on, `ready` is the `boot` event's append - stamped `bootedAt`,
 * which is `now()` at this call and the status's uptime origin - and the sleep watch starts at
 * once, writing into the ledger. `dispose(code)` removes the tools' listener, stops the watch, lets
 * the `boot` append settle (two appends started together take the file lock in either order, and a
 * `shutdown` written before its `boot` reads as a lost run), then appends the `shutdown` with
 * `code`. It is idempotent: a second call writes nothing and settles with the first. With the desk
 * off, `ready` is already resolved and `dispose` only removes the listener. Nothing here rejects on
 * the ledger, so a caller need not await `ready`.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - `home`, the harness home; `enabled`, whether to mount the desk's rows; `now`
 *   (default `Date.now`) and `version` (default {@link DSH_PIN}), for the events and the status;
 *   `watch`, the sleep watch's clock and timer seams, for tests - not its `append`, which is
 *   always the ledger's; `ctx`, the booted ROOT context, and `hub`, the quote hub main.ts owns,
 *   which the desk tools need both of.
 * @throws when the status path is already registered, before anything is written or started.
 */
export function installDesk(
  webServer: RouteRegistrar,
  deps: {
    home: string;
    enabled: boolean;
    now?: () => number;
    version?: string;
    watch?: Partial<Omit<AsleepWatchOptions, "append">>;
    ctx?: DeskToolsCtxLike;
    hub?: Pick<QuoteHub, "snapshot">;
  },
): DeskHandle {
  const { home, enabled } = deps;
  const now = deps.now ?? Date.now;
  const version = deps.version ?? DSH_PIN;
  const bootedAt = now();
  registerDeskRoutes(webServer, { home, bootedAt, enabled, now, version });
  const removeTools = deps.ctx === undefined || deps.hub === undefined ? () => {} : installDeskTools(deps.ctx, deskToolDefinitions({
    hub: deps.hub,
    readState: () => deskStatus({ home, bootedAt, enabled, now, version }),
  }));
  if (!enabled) return { enabled, bootedAt, ready: Promise.resolve(), dispose: async () => { removeTools(); } };
  const ready = appendEvent(home, { t: new Date(bootedAt).toISOString(), kind: "boot", pid: process.pid, version, deskEnabled: true });
  const stopWatch = installAsleepWatch({ now, ...deps.watch, append: (event) => appendEvent(home, event) });
  let disposing: Promise<void> | undefined;
  return {
    enabled,
    bootedAt,
    ready,
    dispose(code) {
      disposing ??= (async () => {
        removeTools();
        stopWatch();
        await ready;
        await appendEvent(home, { t: new Date(now()).toISOString(), kind: "shutdown", pid: process.pid, code });
      })();
      return disposing;
    },
  };
}
