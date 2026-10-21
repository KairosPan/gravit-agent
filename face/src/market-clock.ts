/** The market clock: which days the New York Stock Exchange trades, and when (rulings P2-1, P2-10).
 *
 * The calendar's facts stay in Python. `scripts/market_clock.py` prints a window of XNYS sessions from
 * pandas_market_calendars - each session's date, its open and its close as UTC instants, and whether
 * the close is early - and this module runs it, reads its JSON and keeps the answer. A holiday or a
 * weekend is a date the window holds with no session; DST is already inside the instants, so an
 * anchor is plain arithmetic on them.
 *
 * {@link pythonMarketClock} runs the script through a {@link ProducerRunner}: by path, under the face's
 * interpreter (`FACE_PYTHON || python3`, the one `face_data.py` runs on), cwd the repository root, a
 * {@link MARKET_CLOCK_TIMEOUT_MS} deadline and {@link baseEnv}'s environment - PATH, HOME, LANG, TZ and
 * LC_*, never a market key: the calendar is offline and needs none. A run that answers no window hands
 * the tail of its stderr - a Python traceback ends in its cause - to its owner, one line, which the
 * clock row logs. It is not hash-pinned, unlike a standing order's producer: like `face_data.py` it is
 * face infrastructure. A recorded residual: a change to it in the tree takes effect at the face's next
 * ask, unreviewed.
 *
 * {@link createMarketCalendar} keeps the answer. It asks for a {@link CALENDAR_DAYS}-day window once per
 * New York date - at the first `today()`, then whenever `etDate(now)` changes - and concurrent calls
 * share the ask. A failed ask is asked again, at most every {@link CALENDAR_RETRY_MS}, until an ask
 * returns a window that holds the date (P2 Task 8's ruling 1: a transient failure at the first ask after
 * a boot must not cost the day's anchored orders). Meanwhile the date is answered from the newest window
 * that still holds it, marked `stale`, and with none it is `{ ok: false }`, so no calendar-anchored order
 * fires until a window comes.
 *
 * Of the face's modules it imports only `producer.ts` and `et.ts`, and the pause switch (`npm run desk`)
 * does not load it.
 * @module
 */
import { resolve } from "node:path";
import { etDate } from "./et.ts";
import { baseEnv, defaultProducerRunner, formatDuration, type ProducerRunner, type RunResult } from "./producer.ts";

/* ---------- the window ---------- */

/** One XNYS session: its New York date, its open and its close as UTC instants to the second
 * (`2026-11-27T14:30:00Z`), and whether the close is early (13:00 ET). */
export interface MarketSession {
  date: string;
  open: string;
  close: string;
  early: boolean;
}

/** Every XNYS session from `from` through the `days`-th day, the clock's `source`
 * (`pandas_market_calendars 5.4.0`) and the `python` it ran in. A date inside it with no session is a
 * closed day; a date outside it is unknown. */
export interface MarketWindow {
  from: string;
  days: number;
  source: string;
  python: string;
  sessions: MarketSession[];
}

/** The only calendar the clock answers for. */
const CALENDAR = "XNYS";
/** The most days one window holds: the script's own limit. */
const MAX_WINDOW_DAYS = 31;
/** The most characters of an error the clock or an ask gives, carried on one line into a status and a phone line. */
const ERROR_MAX = 300;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Whether `value` is a real calendar date written `YYYY-MM-DD`: `2026-02-30` is not. */
function isDateText(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
}

/** Whether `value` is a real UTC instant written `YYYY-MM-DDTHH:MM:SSZ`; V8 would read `2026-02-30` as March 2. */
function isInstantText(value: unknown): value is string {
  if (typeof value !== "string" || !INSTANT_RE.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === `${value.slice(0, 19)}.000Z`;
}

/** The date `n` days after `date` (`YYYY-MM-DD`). */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `text` on one line, at most {@link ERROR_MAX} characters (code points; a cut ends in `…`). */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length <= ERROR_MAX ? flat : `${chars.slice(0, ERROR_MAX - 1).join("")}…`;
}

/** The end of `text` on one line, at most {@link ERROR_MAX} characters (code points; a cut opens with `…`), or
 * `undefined` when it holds nothing but blanks. */
function lastLine(text: string): string | undefined {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return undefined;
  const chars = [...flat];
  return chars.length <= ERROR_MAX ? flat : `…${chars.slice(chars.length - (ERROR_MAX - 1)).join("")}`;
}

/** The clock's own `error`, one line; a missing one is named. */
function clockError(error: unknown): string {
  return typeof error === "string" && error.trim() !== "" ? oneLine(error) : "the clock failed and gave no error";
}

/** One session of the clock's JSON, checked: its fields' shapes, its open and close on its own New York
 * date, its close after its open. Unknown keys are dropped. */
function sessionOf(raw: unknown, i: number): MarketSession {
  if (!isRecord(raw)) throw new Error(`session ${i} is not an object`);
  const { date, open, close, early } = raw;
  if (!isDateText(date)) throw new Error(`session ${i} has a bad date`);
  if (!isInstantText(open) || etDate(new Date(open)) !== date) throw new Error(`session ${i} has a bad open`);
  if (!isInstantText(close) || etDate(new Date(close)) !== date || Date.parse(close) <= Date.parse(open)) {
    throw new Error(`session ${i} has a bad close`);
  }
  if (typeof early !== "boolean") throw new Error(`session ${i} has a bad early`);
  return { date, open, close, early };
}

/**
 * Read the clock's stdout as a window. Unknown keys are dropped; nothing else is forgiven.
 * @param stdout - what `scripts/market_clock.py sessions …` printed.
 * @returns the window: `from`, `days`, `source`, `python` and the sessions, in date order.
 * @throws Error - the clock's own `error` when it answered `ok: false` (on one line, at most 300
 *   characters), else the fault: `not JSON`; `not a JSON object`; `window has a bad <field>` (`ok`,
 *   `calendar` - XNYS only -, `from`, `days` - 1 to 31 -, `source`, `python`); `sessions is not a list`;
 *   `session <i> is not an object`; `session <i> has a bad <field>` (`date`, `open`, `close`, `early`;
 *   `i` from 0; an open or a close off the session's New York date, or a close not after the open, is
 *   bad); `sessions are out of order` (a repeated date too); `session <date> is outside the window`.
 */
export function parseMarketWindow(stdout: string): MarketWindow {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("not JSON");
  }
  if (!isRecord(data)) throw new Error("not a JSON object");
  if (data.ok === false) throw new Error(clockError(data.error));
  if (data.ok !== true) throw new Error("window has a bad ok");
  if (data.calendar !== CALENDAR) throw new Error("window has a bad calendar");
  const { from, days, source, python, sessions } = data;
  if (!isDateText(from)) throw new Error("window has a bad from");
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_WINDOW_DAYS) throw new Error("window has a bad days");
  if (typeof source !== "string" || source === "") throw new Error("window has a bad source");
  if (typeof python !== "string") throw new Error("window has a bad python");
  if (!Array.isArray(sessions)) throw new Error("sessions is not a list");
  const end = addDays(from, days);
  const read: MarketSession[] = [];
  for (const [i, raw] of sessions.entries()) {
    const session = sessionOf(raw, i);
    const previous = read.at(-1);
    if (previous !== undefined && session.date <= previous.date) throw new Error("sessions are out of order");
    if (session.date < from || session.date >= end) throw new Error(`session ${session.date} is outside the window`);
    read.push(session);
  }
  return { from, days, source, python, sessions: read };
}

/**
 * Whether `date` lies inside the window: `from ≤ date < from + days`.
 * @param window - a window.
 * @param date - a New York date, `YYYY-MM-DD`; anything else is never inside.
 */
export function windowCovers(window: MarketWindow, date: string): boolean {
  return isDateText(date) && window.from <= date && date < addDays(window.from, window.days);
}

/**
 * That date's session in the window.
 * @param window - a window.
 * @param date - a New York date, `YYYY-MM-DD`.
 * @returns the session; `"closed"` for a date inside the window with none (a holiday, a weekend);
 *   `undefined` outside the window, where the window knows nothing.
 */
export function sessionFor(window: MarketWindow, date: string): MarketSession | "closed" | undefined {
  if (!windowCovers(window, date)) return undefined;
  return window.sessions.find((session) => session.date === date) ?? "closed";
}

/* ---------- running the clock ---------- */

/** Ask the clock for the window of `days` days from the New York date `from`. Rejects with why it has none. */
export type MarketClock = (from: string, days: number) => Promise<MarketWindow>;

/** How long one run of the clock may take: a whole spawn measured 0.70 s. */
export const MARKET_CLOCK_TIMEOUT_MS = 30_000;

/** The runner's two overflow errors (producer.ts's `RunResult`): not spawn codes, so reported as they are. */
const OVERFLOWS: ReadonlySet<string> = new Set(["stdout over 1 MiB", "stderr over 1 MiB"]);

/** The clock's own error when `stdout` is its `{ "ok": false, "error": … }`, else `undefined`. */
function failureOf(stdout: string): string | undefined {
  try {
    const data: unknown = JSON.parse(stdout);
    if (isRecord(data) && data.ok === false) return clockError(data.error);
  } catch {
    /* not the clock's JSON: the exit code is all that is known */
  }
  return undefined;
}

/**
 * The face's clock: `scripts/market_clock.py` under `python`, run by path - not hash-pinned (the module
 * doc's residual). Each ask runs `[<root>/scripts/market_clock.py, "sessions", "--from", from, "--days",
 * String(days)]` with cwd `root`, `baseEnv(process.env)` as read at that ask (no market key), no stdin and
 * the deadline. Its stderr never reaches the answer: a crash reads `exit <code>`. A run that answers no
 * window - whatever its exit - hands its stderr's tail to `stderr` when it wrote anything but blanks: its
 * last 300 characters on one line (a cut opens with `…`), where a Python traceback names its cause (P2 Task
 * 8's ruling 2). A hook that throws costs nothing but its line.
 * @param opts - `root` the repository root; `python` the interpreter, named in a failure to start;
 *   `run` the runner, `defaultProducerRunner(python)` by default; `timeoutMs` the deadline,
 *   {@link MARKET_CLOCK_TIMEOUT_MS} by default; `stderr`, where a failed run's stderr tail goes - dropped
 *   when absent.
 * @returns a {@link MarketClock} that resolves with {@link parseMarketWindow}'s window of an exit 0, and
 *   rejects with the clock's own `error` (an exit with `{ ok: false }`, or `ok: false` at exit 0),
 *   `exit <code>` (an exit without it), `timed out after 30 s`, `stdout over 1 MiB` or `stderr over 1 MiB`,
 *   `could not start <python>: <code>` (a spawn failure: `ENOENT`, `EACCES`, …), or parseMarketWindow's fault.
 */
export function pythonMarketClock(opts: {
  root: string;
  python: string;
  run?: ProducerRunner;
  timeoutMs?: number;
  stderr?: (tail: string) => void;
}): MarketClock {
  const run = opts.run ?? defaultProducerRunner(opts.python);
  const timeoutMs = opts.timeoutMs ?? MARKET_CLOCK_TIMEOUT_MS;
  const script = resolve(opts.root, "scripts", "market_clock.py");
  /** The window a run answered, or why it answered none. */
  const windowOf = (result: RunResult): MarketWindow => {
    if (result.timedOut) throw new Error(`timed out after ${formatDuration(timeoutMs)}`);
    if (result.error !== undefined) {
      throw new Error(OVERFLOWS.has(result.error) ? result.error : `could not start ${opts.python}: ${result.error}`);
    }
    if (result.code !== 0) throw new Error(failureOf(result.stdout) ?? `exit ${result.code}`);
    return parseMarketWindow(result.stdout);
  };
  return async (from, days) => {
    const result = await run([script, "sessions", "--from", from, "--days", String(days)], {
      cwd: opts.root,
      env: baseEnv(process.env),
      timeoutMs,
    });
    try {
      return windowOf(result);
    } catch (error) {
      const tail = lastLine(result.stderr);
      if (tail !== undefined) {
        try {
          opts.stderr?.(tail);
        } catch {
          /* the owner's log failed: the ask's own error still answers */
        }
      }
      throw error;
    }
  };
}

/* ---------- the calendar ---------- */

/** How many days the face asks for: today and the nine after, enough to cross a long weekend and to
 * name the next session on a closed day. */
export const CALENDAR_DAYS = 10;

/** How long after a failed ask its date may be asked again: ten minutes (P2 Task 8's ruling 1). */
export const CALENDAR_RETRY_MS = 600_000;

/** A New York date's answer: its session or `"closed"`, from the window's `source` - `stale` when that
 * date's own ask failed and an older window still holds the date - or, with no window holding it, the
 * failed ask's `error`. */
export type DayAnswer =
  | { ok: true; date: string; session: MarketSession | "closed"; source: string; stale?: { error: string } }
  | { ok: false; date: string; error: string };

/** The face's calendar: today's session, from a window it keeps. */
export interface MarketCalendar {
  /** The interpreter the clock runs in, for the lines that name it. */
  readonly python: string;
  /** The answer for `etDate(now)`. Asks the clock only when that date differs from the last one asked, or
   * when its last ask failed {@link CALENDAR_RETRY_MS} or more before `now`; never rejects for a failed ask. */
  today(now: number): Promise<DayAnswer>;
  /** The latest date's answer so far, without asking; `undefined` before the first. */
  peek(): DayAnswer | undefined;
  /** The newest window an ask returned, which may no longer hold today; `undefined` before the first. */
  window(): MarketWindow | undefined;
}

/** How one ask ended: the window it returned (holding its date), or why there is none. */
type AskResult = { window: MarketWindow; error?: undefined } | { window?: undefined; error: string };

/** A thrown value as one line. */
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim() === "" ? "the market clock failed and gave no reason" : oneLine(text);
}

/**
 * The face's calendar over `ask`.
 * @param opts - `ask` the clock ({@link pythonMarketClock} in the face); `python` its interpreter, kept for
 *   the lines that name it; `days` the window asked for, {@link CALENDAR_DAYS} by default.
 * @returns a {@link MarketCalendar}. Its `today(now)` asks once per New York date, and calls for the date
 *   being asked share the one ask. A date whose own ask returned a window is answered from it, and never
 *   asked again. A failed ask - a rejection, a throw, or a window that does not hold the date - is answered
 *   from the newest window that still holds the date, with `stale: { error }`, or with none as
 *   `{ ok: false, date, error }`; a `today(now)` {@link CALENDAR_RETRY_MS} or more after that ask began
 *   asks again, until an ask returns a window that holds the date. An ask settling after a later date's
 *   replaces neither the newest window nor what `peek()` says.
 */
export function createMarketCalendar(opts: { ask: MarketClock; python: string; days?: number }): MarketCalendar {
  const days = opts.days ?? CALENDAR_DAYS;
  /** The newest window any ask returned: the fallback for a date whose own ask failed. */
  let newest: MarketWindow | undefined;
  /** The ask for the date asked last: when it began, settling to its window or its error, and - once it has
   * settled with an error - `failed`. */
  let asked: { date: string; at: number; settled: Promise<AskResult>; failed: boolean } | undefined;
  /** The latest date's answer, for peek(). */
  let latest: DayAnswer | undefined;

  const askFor = async (date: string): Promise<AskResult> => {
    try {
      const window = await opts.ask(date, days);
      if (!windowCovers(window, date)) {
        return { error: `the market clock answered a window from ${window.from} for ${window.days} days, which does not hold ${date}` };
      }
      if (newest === undefined || window.from >= newest.from) newest = window;
      return { window };
    } catch (error) {
      return { error: errorText(error) };
    }
  };

  const answer = (date: string, result: AskResult): DayAnswer => {
    const window = result.window ?? newest;
    const session = window === undefined ? undefined : sessionFor(window, date);
    let found: DayAnswer;
    if (window === undefined || session === undefined) {
      found = { ok: false, date, error: result.error ?? `no market window holds ${date}` };
    } else if (result.error === undefined) {
      found = { ok: true, date, session, source: window.source };
    } else {
      found = { ok: true, date, session, source: window.source, stale: { error: result.error } };
    }
    if (latest === undefined || date >= latest.date) latest = found;
    return found;
  };

  return {
    python: opts.python,
    async today(now) {
      const date = etDate(new Date(now));
      let flight = asked;
      if (flight === undefined || flight.date !== date || (flight.failed && now - flight.at >= CALENDAR_RETRY_MS)) {
        const next = { date, at: now, settled: askFor(date), failed: false };
        /* registered before any caller awaits the ask, so `failed` is set by the time one reads the answer */
        void next.settled.then((result) => { next.failed = result.error !== undefined; });
        asked = next;
        flight = next;
      }
      return answer(date, await flight.settled);
    },
    peek: () => latest,
    window: () => newest,
  };
}
