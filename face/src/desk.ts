/** The desk's ledger: `$DSH_HOME/face/desk/events.jsonl`, the face's own record of its lifetime.
 *
 * The desk is Gravit's always-on side (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md):
 * the face kept running by launchd as a user service (§5.2), and, in the later plans, the clock,
 * the watch and the phone bridge that work in it. Of what §8 gives this module - the ledger, the
 * budget, the `OFF` switch, the two desk tools, the `/desk` page - P0 holds the ledger only, and
 * of the ledger's files (§5.7) only `events.jsonl`, with three kinds of event: a `boot`, a clean
 * `shutdown`, and an `asleep` gap in the face's timers.
 *
 * Why a ledger: a service that launchd restarts after a crash or a `kill -9` looks healthy from
 * outside - it is running again. Read back as runs ({@link runsOf}), the ledger says otherwise: a
 * boot that the next boot follows with no `shutdown` between is `lost`.
 *
 * The writer appends one JSON object per line under the face's file lock, creates its files
 * `0600`, and rotates the file once it is over {@link LEDGER_ROTATE_BYTES}. It never throws into
 * the face: an append that fails is one `gravit-face:` line on stderr, and a face whose ledger
 * cannot be written still boots and serves. The reader takes the current file only, and skips and
 * counts every line that is not an event - a last line torn by a crash mid-append is the case that
 * matters.
 * @module
 */
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock } from "@deepseek-ai/dsh-atomic-write";

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

/** What the failure line names: the error's code when it has one (`ENOTDIR`, `EACCES`, `ENOSPC`),
 * else its message (the lock's timeout carries no code). */
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

/**
 * Append one event to `$DSH_HOME/face/desk/events.jsonl`.
 *
 * The directory is made first, because `withFileLock` creates its lock beside the file
 * (`roster.ts`'s `update` keeps the same order). Inside the lock, a file over `rotateBytes` is
 * renamed to `events.<t>.jsonl` - the `t` of the event being appended, each `:` made `-` - and the
 * line goes to a fresh file. The lock is for that rotation: it makes the size check, the rename
 * and the append one step, so no writer's line lands in a file another has just moved aside.
 * Files are created `0600`; the mode applies on creation only, as `roster.log`'s does.
 *
 * Never rejects. Any failure - the directory, the lock, the rename, the append - is one call to
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
      if ((await sizeOf(file)) > (opts.rotateBytes ?? LEDGER_ROTATE_BYTES)) {
        await rename(file, join(dir, `events.${event.t.replaceAll(":", "-")}.jsonl`));
      }
      await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
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
