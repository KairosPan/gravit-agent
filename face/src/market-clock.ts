/** The market clock: which days the New York Stock Exchange trades, and when (rulings P2-1, P2-10).
 *
 * THE CALENDAR IS A RULE TABLE IN THIS FILE, in Node, with no Python and no network: the desk's runtime
 * depends on no Python environment (the operator's ruling of 2026-11-01: runtime in Node, research in
 * Python, kept apart). {@link xnysWindow} answers a window of XNYS sessions - each session's New York
 * date, its open and its close as UTC instants, and whether the close is early - from:
 *
 * - the full-day holidays as NYSE observes them: New Year's Day (Sunday → Monday; a Saturday New Year
 *   is not observed on the Friday before), Martin Luther King Jr. Day (third Monday of January),
 *   Washington's Birthday (third Monday of February), Good Friday (two days before Easter Sunday, by the
 *   Gregorian computus), Memorial Day (last Monday of May), Juneteenth (from 2022), Independence Day,
 *   Labor Day (first Monday of September), Thanksgiving (fourth Thursday of November) and Christmas -
 *   Juneteenth, Independence Day and Christmas on a Saturday observed the Friday before, on a Sunday the
 *   Monday after;
 * - the early closes at 13:00 ET: July 3 when it falls Monday to Thursday, the day after Thanksgiving,
 *   and December 24 when it falls Monday to Thursday;
 * - {@link XNYS_AD_HOC_CLOSURES}, the small explicit table of the exchange's one-off closures (a national
 *   day of mourning, a storm). A closure announced after this file was last edited is unknown until it is
 *   added here; nothing fetches one.
 *
 * Regular hours are 09:30-16:00 New York time. New York's offset comes from the US rule in force since
 * 2007 (daylight time from the second Sunday of March to the first Sunday of November); both changes fall
 * on a Sunday, when XNYS never trades, so a session date's offset is the same all day.
 *
 * {@link createMarketCalendar} keeps the answer. It asks for a {@link CALENDAR_DAYS}-day window once per
 * New York date - at the first `today()`, then whenever `etDate(now)` changes - and concurrent calls
 * share the ask. A failed ask is asked again, at most every {@link CALENDAR_RETRY_MS}, until an ask
 * returns a window that holds the date. Meanwhile the date is answered from the newest window that still
 * holds it, marked `stale`, and with none it is `{ ok: false }`, so no calendar-anchored order fires
 * until a window comes. The builtin clock does not fail on a real date; the fallbacks stay for an ask a
 * test or a later clock supplies.
 *
 * A CALENDAR PER MARKET. A calendar asks by its own market's date - `dateOf(now)`, the New York date by default -
 * and {@link deskCalendars} builds the desk's two: `us` on these rules and New York dates, `cn` on the XSHG table
 * (src/xshg-clock.ts) and Beijing dates.
 *
 * Of the face's modules it imports only `et.ts` and `xshg-clock.ts`, and the pause switch (`npm run desk`) does not
 * load it.
 * @module
 */
import { bjDate, etDate } from "./et.ts";
import { XSHG_CLOCK, xshgMarketClock } from "./xshg-clock.ts";

/* ---------- the window ---------- */

/** One XNYS session: its New York date, its open and its close as UTC instants to the second
 * (`2026-11-27T14:30:00Z`), and whether the close is early (13:00 ET). */
export interface MarketSession {
  date: string;
  open: string;
  close: string;
  early: boolean;
}

/** Every XNYS session from `from` through the `days`-th day, and the clock's `source`. A date inside it
 * with no session is a closed day; a date outside it is unknown. */
export interface MarketWindow {
  from: string;
  days: number;
  source: string;
  sessions: MarketSession[];
}

/** The most days one window holds. */
export const MAX_WINDOW_DAYS = 31;

/** The builtin clock's name, carried as a window's `source` and as the calendar's `clock`. */
export const XNYS_CLOCK = "builtin XNYS rules (face/src/market-clock.ts)";

/** The exchange's one-off full-day closures that no rule gives, by New York date. Add one when NYSE
 * announces it; nothing fetches them. */
export const XNYS_AD_HOC_CLOSURES: Readonly<Record<string, string>> = {
  "2012-10-29": "Hurricane Sandy",
  "2012-10-30": "Hurricane Sandy",
  "2018-12-05": "National Day of Mourning for President George H. W. Bush",
  "2025-01-09": "National Day of Mourning for President Jimmy Carter",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a real calendar date written `YYYY-MM-DD`: `2026-02-30` is not. */
function isDateText(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
}

/** The date `n` days after `date` (`YYYY-MM-DD`). */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of a year, a month (1-12) and a day. */
function ymd(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

/** The weekday of a date: 0 Sunday … 6 Saturday. */
function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The `n`-th (1-based) `wd` weekday of a month; `n = -1` is the last. */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return ymd(y, m, 1 + ((wd - first + 7) % 7) + 7 * (n - 1));
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return ymd(y, m, lastDay - ((last - wd + 7) % 7));
}

/** Easter Sunday of a Gregorian year (the anonymous Gregorian computus, Meeus/Jones/Butcher). */
export function easterSunday(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

/** A fixed holiday as observed: Saturday → the Friday before, Sunday → the Monday after. */
function observed(date: string): string {
  const wd = weekday(date);
  return wd === 6 ? addDays(date, -1) : wd === 0 ? addDays(date, 1) : date;
}

/**
 * The XNYS full-day holidays of a year that fall in it, by the rules in the module doc, ad-hoc closures
 * aside. New Year's Day on a Saturday is not observed (NYSE's rule), so it closes no day of either year.
 * @param y - the year.
 * @returns the holidays' dates, sorted.
 */
export function xnysHolidays(y: number): string[] {
  const days = new Set<string>();
  const newYear = ymd(y, 1, 1);
  if (weekday(newYear) !== 6) days.add(observed(newYear));
  days.add(nthWeekday(y, 1, 1, 3));
  days.add(nthWeekday(y, 2, 1, 3));
  days.add(addDays(easterSunday(y), -2));
  days.add(nthWeekday(y, 5, 1, -1));
  if (y >= 2022) days.add(observed(ymd(y, 6, 19)));
  days.add(observed(ymd(y, 7, 4)));
  days.add(nthWeekday(y, 9, 1, 1));
  days.add(nthWeekday(y, 11, 4, 4));
  days.add(observed(ymd(y, 12, 25)));
  return [...days].filter((date) => date.startsWith(`${y}-`)).sort();
}

/**
 * The XNYS early closes (13:00 ET) of a year: July 3 when it falls Monday to Thursday, the day after
 * Thanksgiving, December 24 when it falls Monday to Thursday.
 * @param y - the year.
 * @returns their dates, sorted.
 */
export function xnysEarlyCloses(y: number): string[] {
  const days: string[] = [];
  const july3 = ymd(y, 7, 3);
  if (weekday(july3) >= 1 && weekday(july3) <= 4) days.push(july3);
  days.push(addDays(nthWeekday(y, 11, 4, 4), 1));
  const dec24 = ymd(y, 12, 24);
  if (weekday(dec24) >= 1 && weekday(dec24) <= 4) days.push(dec24);
  return days;
}

/** Whether New York keeps daylight time on a date (the US rule since 2007: from the second Sunday of
 * March to the first Sunday of November). Read only for a weekday, which is never a change day. */
function isDaylight(date: string): boolean {
  const y = Number(date.slice(0, 4));
  return date >= nthWeekday(y, 3, 0, 2) && date < nthWeekday(y, 11, 0, 1);
}

/** A New York wall time on a date as a UTC instant to the second (`nyInstant("2026-11-30", 4, 0)` is
 * `2026-11-30T09:00:00Z`), at the offset the date keeps: right on a weekday, which is never a change day. */
export function nyInstant(date: string, hour: number, minute: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const offset = isDaylight(date) ? 4 : 5;
  return new Date(Date.UTC(y, m - 1, d, hour + offset, minute)).toISOString().replace(".000Z", "Z");
}

/** That date's XNYS session, or `undefined` when the exchange is closed (a weekend, a holiday, an ad-hoc closure). */
function xnysSession(date: string): MarketSession | undefined {
  const wd = weekday(date);
  if (wd === 0 || wd === 6 || XNYS_AD_HOC_CLOSURES[date] !== undefined) return undefined;
  const y = Number(date.slice(0, 4));
  if (xnysHolidays(y).includes(date)) return undefined;
  const early = xnysEarlyCloses(y).includes(date);
  return { date, open: nyInstant(date, 9, 30), close: nyInstant(date, early ? 13 : 16, 0), early };
}

/**
 * Every XNYS session from `from` through the `days`-th day.
 * @param from - the first New York date, `YYYY-MM-DD`.
 * @param days - how many days, 1 to {@link MAX_WINDOW_DAYS}.
 * @returns the window, its `source` {@link XNYS_CLOCK}.
 * @throws Error - `the market clock takes a YYYY-MM-DD date, not "<from>"` or `the market clock takes 1 to 31
 *   days, not <days>`.
 */
export function xnysWindow(from: string, days: number): MarketWindow {
  if (!isDateText(from)) throw new Error(`the market clock takes a YYYY-MM-DD date, not ${JSON.stringify(String(from).slice(0, 40))}`);
  if (!Number.isInteger(days) || days < 1 || days > MAX_WINDOW_DAYS) throw new Error(`the market clock takes 1 to ${MAX_WINDOW_DAYS} days, not ${String(days)}`);
  const sessions: MarketSession[] = [];
  for (let n = 0; n < days; n++) {
    const session = xnysSession(addDays(from, n));
    if (session !== undefined) sessions.push(session);
  }
  return { from, days, source: XNYS_CLOCK, sessions };
}

/**
 * Whether `date` lies inside the window: `from ≤ date < from + days`.
 * @param window - a window.
 * @param date - the market's date, `YYYY-MM-DD`; anything else is never inside.
 */
export function windowCovers(window: MarketWindow, date: string): boolean {
  return isDateText(date) && window.from <= date && date < addDays(window.from, window.days);
}

/**
 * That date's session in the window.
 * @param window - a window.
 * @param date - the market's date, `YYYY-MM-DD`.
 * @returns the session; `"closed"` for a date inside the window with none (a holiday, a weekend);
 *   `undefined` outside the window, where the window knows nothing.
 */
export function sessionFor(window: MarketWindow, date: string): MarketSession | "closed" | undefined {
  if (!windowCovers(window, date)) return undefined;
  return window.sessions.find((session) => session.date === date) ?? "closed";
}

/**
 * The date of the session before `date` in the window: its latest session dated before `date`, when the window
 * holds the day before it.
 * @param window - a window, or none.
 * @param date - a New York date, `YYYY-MM-DD`.
 * @returns the date, or `undefined` when the window cannot say (it starts on `date` or later, or holds no session
 *   before it).
 */
export function sessionBefore(window: MarketWindow | undefined, date: string): string | undefined {
  if (window === undefined || !isDateText(date) || !windowCovers(window, addDays(date, -1))) return undefined;
  let found: string | undefined;
  for (const s of window.sessions) if (s.date < date && (found === undefined || s.date > found)) found = s.date;
  return found;
}

/**
 * The date of the XNYS session before `date`, by the builtin rules, at most {@link MAX_WINDOW_DAYS} days back.
 * @param date - a New York date, `YYYY-MM-DD`; anything else has none.
 */
export function xnysPrevious(date: string): string | undefined {
  if (!isDateText(date)) return undefined;
  for (let n = 1; n <= MAX_WINDOW_DAYS; n++) {
    const before = addDays(date, -n);
    if (xnysSession(before) !== undefined) return before;
  }
  return undefined;
}

/* ---------- the clock ---------- */

/** Ask the clock for the window of `days` days from the New York date `from`. Rejects with why it has none. */
export type MarketClock = (from: string, days: number) => Promise<MarketWindow>;

/** The face's clock: {@link xnysWindow}, as a {@link MarketClock}. */
export function builtinMarketClock(): MarketClock {
  return async (from, days) => xnysWindow(from, days);
}

/** The most characters of an error the calendar carries on one line into a status and a phone line. */
const ERROR_MAX = 300;

/** `text` on one line, at most {@link ERROR_MAX} characters (code points; a cut ends in `…`). */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length <= ERROR_MAX ? flat : `${chars.slice(0, ERROR_MAX - 1).join("")}…`;
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
  /** The clock the calendar asks, for the lines that name it: {@link XNYS_CLOCK} or {@link XSHG_CLOCK} in the face. */
  readonly clock: string;
  /** The answer for the market's date of `now` (`etDate(now)` for XNYS). Asks the clock only when that date
   * differs from the last one asked, or when its last ask failed {@link CALENDAR_RETRY_MS} or more before `now`; never rejects for a failed ask. */
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
 * @param opts - `ask` the clock, {@link builtinMarketClock} by default; `clock` its name, kept for the lines that
 *   name it, {@link XNYS_CLOCK} by default; `days` the window asked for, {@link CALENDAR_DAYS} by default; `dateOf`
 *   the market's date of an instant, the New York date (`etDate`) by default.
 * @returns a {@link MarketCalendar}. Its `today(now)` asks once per market date (`dateOf(now)`), and calls for the date
 *   being asked share the one ask. A date whose own ask returned a window is answered from it, and never
 *   asked again. A failed ask - a rejection, a throw, or a window that does not hold the date - is answered
 *   from the newest window that still holds the date, with `stale: { error }`, or with none as
 *   `{ ok: false, date, error }`; a `today(now)` {@link CALENDAR_RETRY_MS} or more after that ask began
 *   asks again, until an ask returns a window that holds the date. An ask settling after a later date's
 *   replaces neither the newest window nor what `peek()` says.
 */
export function createMarketCalendar(
  opts: { ask?: MarketClock; clock?: string; days?: number; dateOf?: (now: number) => string } = {},
): MarketCalendar {
  const days = opts.days ?? CALENDAR_DAYS;
  const dateOf = opts.dateOf ?? ((now: number) => etDate(new Date(now)));
  const ask = opts.ask ?? builtinMarketClock();
  /** The newest window any ask returned: the fallback for a date whose own ask failed. */
  let newest: MarketWindow | undefined;
  /** The ask for the date asked last: when it began, settling to its window or its error, and - once it has
   * settled with an error - `failed`. */
  let asked: { date: string; at: number; settled: Promise<AskResult>; failed: boolean } | undefined;
  /** The latest date's answer, for peek(). */
  let latest: DayAnswer | undefined;

  const askFor = async (date: string): Promise<AskResult> => {
    try {
      const window = await ask(date, days);
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
    clock: opts.clock ?? XNYS_CLOCK,
    async today(now) {
      const date = dateOf(now);
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

/* ---------- a calendar per market ---------- */

/** The desk's calendars: `us` for XNYS on New York dates, `cn` for XSHG on Beijing dates. */
export interface DeskCalendars {
  us: MarketCalendar;
  cn: MarketCalendar;
}

/**
 * The desk's two calendars.
 * @param seams - a calendar to use in place of either, for a test.
 * @returns the seams' calendars, else {@link createMarketCalendar}'s XNYS calendar for `us`, and for `cn` one over
 *   {@link xshgMarketClock} named {@link XSHG_CLOCK} that asks by the Beijing date.
 */
export function deskCalendars(seams: Partial<DeskCalendars> = {}): DeskCalendars {
  return {
    us: seams.us ?? createMarketCalendar(),
    cn: seams.cn ?? createMarketCalendar({ ask: xshgMarketClock(), clock: XSHG_CLOCK, dateOf: (n) => bjDate(new Date(n)) }),
  };
}
