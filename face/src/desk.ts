/** The desk's ledger: `$DSH_HOME/face/desk/events.jsonl`, the face's own record of its lifetime -
 * with the sleep watch that writes into it and the status route that reads it back.
 *
 * The desk is Gravit's always-on side (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md):
 * the face kept running by launchd as a user service (§5.2), and, in the later plans, the clock,
 * the watch and the phone bridge that work in it. Of what §8 gives this module - the ledger, the
 * budget, the `OFF` switch, the two desk tools, the `/desk` page and `/data/desk/*` - P0 holds the
 * ledger, the sleep watch and `GET /data/desk/status`, and of the ledger's files (§5.7) only
 * `events.jsonl`, with three kinds of event: a `boot`, a clean `shutdown`, and an `asleep` gap in
 * the face's timers.
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
 * {@link installDesk} mounts it all on a booted face. The status route ({@link deskStatus}:
 * pid, version, uptime, this run's gaps, the ledger's runs) is mounted always, so a face with the
 * desk off - a second face beside the service, §5.2 - still answers, with `desk.enabled: false`;
 * the `boot` event, the watch and the `shutdown` event only when the desk is on. An unreadable
 * ledger is named in the status, never a 500.
 * @module
 */
import { appendFile, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { withFileLock } from "@deepseek-ai/dsh-atomic-write";
import { isTrustedDataRequest } from "./data.ts";
import { FORBIDDEN, HttpError } from "./http.ts";
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

/** One ledger line. `t` is when the face recorded the event; `t`, `from` and `to` are ISO-8601 UTC
 * (`new Date(ms).toISOString()`). A `boot` names the process, the dsh version it runs and whether
 * it mounted the desk; a `shutdown` is a clean stop with the exit code the face leaves with; an
 * `asleep` is a gap in the face's timers, from the last tick before it to the tick that found it. */
export type DeskEvent =
  | { t: string; kind: "boot"; pid: number; version: string; deskEnabled: boolean }
  | { t: string; kind: "shutdown"; pid: number; code: number }
  | { t: string; kind: "asleep"; from: string; to: string; gapMs: number };

/** Every kind {@link DeskEvent} has, and only those. A record over the union rather than a list,
 * so a kind added to the type and not here fails to compile instead of reading back as skipped. */
const KINDS: Readonly<Record<DeskEvent["kind"], true>> = { boot: true, shutdown: true, asleep: true };

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

/**
 * Append one event to `$DSH_HOME/face/desk/events.jsonl`.
 *
 * The directory is made first, because `withFileLock` creates its lock beside the file
 * (`roster.ts`'s `update` keeps the same order). Inside the lock, a file over `rotateBytes` is
 * renamed to `events.<t>.jsonl` - the `t` of the event being appended, each `:` made `-` - and the
 * line goes to a fresh file. A file whose last byte is not a newline ends in a write that a crash
 * or a full disk cut short; the line then opens with a newline, so the fragment stays one skipped
 * line instead of swallowing this event - a swallowed `boot` would leave the killed run reading
 * as the live one. The lock makes the size check, the rename, that one-byte read and the append
 * one step, so no writer's line lands in a file another has just moved aside. Files are created
 * `0600`; the mode applies on creation only, as `roster.log`'s does.
 *
 * Never rejects. Any failure - directory, lock, rename, tail read, append - is one call to
 * `log` (default `console.error`) naming the file and the error's code, or its message when it
 * has none, and the event is dropped: the ledger is a record, never a gate on the face. The lock's
 * retries are not jittered, so appenders that start together take it about one per retry round,
 * and a burst of a dozen or more can outlast its two-second wait (measured: 20 at once, 6
 * dropped); the desk's events come one or two at a time.
 * @param home - the harness home.
 * @param event - the event, written as one JSON line.
 * @param opts - `rotateBytes`, default {@link LEDGER_ROTATE_BYTES}; `log`, for the failure line.
 */
export async function appendEvent(
  home: string,
  event: DeskEvent,
  opts: { rotateBytes?: number; log?: (line: string) => void } = {},
): Promise<void> {
  const dir = deskDir(home);
  const file = join(dir, EVENTS_FILE);
  try {
    await mkdir(dir, { recursive: true });
    await withFileLock(file, async () => {
      let size = await sizeOf(file);
      if (size > (opts.rotateBytes ?? LEDGER_ROTATE_BYTES)) {
        await rename(file, join(dir, `events.${event.t.replaceAll(":", "-")}.jsonl`));
        size = 0;
      }
      const lead = size > 0 && (await endsMidLine(file, size)) ? "\n" : "";
      await appendFile(file, `${lead}${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    });
  } catch (err) {
    const log = opts.log ?? ((line: string) => console.error(line));
    log(`${BIN}: the desk ledger at ${file} could not be written: ${reasonOf(err)}`);
  }
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
 * has ended it, is not lost - it may be the process that is running now. `asleep` events, and a
 * `shutdown` that matches no open run, change nothing.
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
      open.endedAt = event.t;
      open.code = event.code;
      open = undefined;
    }
  }
  return runs;
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

/** What `GET /data/desk/status` answers. `pid`, `version` (the dsh version this face runs),
 * `bootedAt` and `uptimeMs` are this process's; `desk` says whether its rows are mounted and where
 * its files are; `asleep` is this run's gaps; `runs` is every run in the current ledger.
 * `ledgerError` is present only when the ledger could not be read - its code, or its message when
 * it has none - and `asleep` and `runs` are then empty: an unreadable ledger is named, never passed
 * off as an empty one. */
export interface DeskStatus {
  ok: true;
  pid: number;
  version: string;
  bootedAt: string;
  uptimeMs: number;
  desk: { enabled: boolean; dir: string };
  asleep: { from: string; to: string; gapMs: number }[];
  runs: DeskRun[];
  ledgerError?: string;
}

/**
 * The face's status as the desk sees it, read from the ledger afresh on every call.
 *
 * `asleep` is every `asleep` event whose `from` is at or after `bootedAt` - this run's gaps, not
 * those of the runs before it; ISO-8601 UTC strings order as their times do, so the comparison is
 * on the strings. `runs` is {@link runsOf} over the whole current file. Never rejects on the
 * ledger: a read that fails ({@link readEvents} rejects on EACCES, EISDIR, EIO by design) is
 * `ledgerError`.
 * @param deps - `home`, the harness home; `bootedAt`, when this run began, in ms since the epoch;
 *   `enabled`, whether the desk's rows are mounted; `now`, `pid` and `version`, defaulting to
 *   `Date.now`, `process.pid` and {@link DSH_PIN}.
 */
export async function deskStatus(deps: {
  home: string;
  bootedAt: number;
  enabled: boolean;
  now?: () => number;
  pid?: number;
  version?: string;
}): Promise<DeskStatus> {
  const since = new Date(deps.bootedAt).toISOString();
  let events: DeskEvent[] = [];
  let ledgerError: string | undefined;
  try {
    events = (await readEvents(deps.home)).events;
  } catch (err) {
    ledgerError = reasonOf(err);
  }
  const asleep = events.flatMap((e) =>
    e.kind === "asleep" && e.from >= since ? [{ from: e.from, to: e.to, gapMs: e.gapMs }] : []);
  return {
    ok: true,
    pid: deps.pid ?? process.pid,
    version: deps.version ?? DSH_PIN,
    bootedAt: since,
    uptimeMs: (deps.now ?? Date.now)() - deps.bootedAt,
    desk: { enabled: deps.enabled, dir: deskDir(deps.home) },
    asleep,
    runs: runsOf(events),
    ...(ledgerError === undefined ? {} : { ledgerError }),
  };
}

/**
 * Mount `GET /data/desk/status`, which answers {@link deskStatus}.
 *
 * The handler is panels.ts's `get` shell, restated rather than imported so that desk.ts does not
 * pull in the panels' dependencies: the browser fence first, refused with the fixed `FORBIDDEN`
 * body; then `200` with the status; an {@link HttpError} as its own status; anything else a `500`
 * with a fixed message, so no filesystem error reaches a body. An unreadable ledger is not a
 * failure here: {@link deskStatus} names it inside a `200`.
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
  const isTrusted = deps.isTrusted ?? isTrustedDataRequest;
  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  webServer.register({
    kind: "exact",
    path: "/data/desk/status",
    handler: async (req, res) => {
      if (!isTrusted(req)) return send(res, 403, FORBIDDEN);
      try {
        return send(res, 200, await deskStatus(deps));
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
        return send(res, 500, { ok: false, error: "request failed" });
      }
    },
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
 * Mount the desk's P0 rows on a booted face.
 *
 * The status route is mounted whatever `enabled` says. With the desk on, `ready` is the `boot`
 * event's append - stamped `bootedAt`, which is `now()` at this call and the status's uptime
 * origin - and the sleep watch starts at once, writing into the ledger. `dispose(code)` stops the
 * watch, lets the `boot` append settle (two appends started together take the file lock in either
 * order, and a `shutdown` written before its `boot` reads as a lost run), then appends the
 * `shutdown` with `code`. It is idempotent: a second call writes nothing and settles with the
 * first. With the desk off, `ready` is already resolved and `dispose` writes nothing. Nothing here
 * rejects on the ledger, so a caller need not await `ready`.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - `home`, the harness home; `enabled`, whether to mount the desk's rows; `now`
 *   (default `Date.now`) and `version` (default {@link DSH_PIN}), for the events and the status;
 *   `watch`, the sleep watch's seams for tests - its `append` is always the ledger's.
 * @throws when the status path is already registered, before anything is written or started.
 */
export function installDesk(
  webServer: RouteRegistrar,
  deps: { home: string; enabled: boolean; now?: () => number; version?: string; watch?: Partial<AsleepWatchOptions> },
): DeskHandle {
  const { home, enabled } = deps;
  const now = deps.now ?? Date.now;
  const version = deps.version ?? DSH_PIN;
  const bootedAt = now();
  registerDeskRoutes(webServer, { home, bootedAt, enabled, now, version });
  if (!enabled) return { enabled, bootedAt, ready: Promise.resolve(), dispose: async () => {} };
  const ready = appendEvent(home, { t: new Date(bootedAt).toISOString(), kind: "boot", pid: process.pid, version, deskEnabled: true });
  const stopWatch = installAsleepWatch({ now, ...deps.watch, append: (event) => appendEvent(home, event) });
  let disposing: Promise<void> | undefined;
  return {
    enabled,
    bootedAt,
    ready,
    dispose(code) {
      disposing ??= (async () => {
        stopWatch();
        await ready;
        await appendEvent(home, { t: new Date(now()).toISOString(), kind: "shutdown", pid: process.pid, code });
      })();
      return disposing;
    },
  };
}
