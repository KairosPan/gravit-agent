/** The XSHG clock: which days the Shanghai Stock Exchange trades in 2026, and when.
 *
 * THE CALENDAR IS A TABLE IN THIS FILE, in Node, with no Python and no network, as the XNYS rules are
 * (src/market-clock.ts). China's exchange closures follow no rule a computus could give - the State Council sets
 * each year's holidays and the SSE announces them - so {@link XSHG_CLOSURES} copies the year's notices, and
 * nothing past {@link XSHG_COVERED} is guessed: a later date is `"uncovered"`, and a window reaching past the
 * table is cut at its end, or refused when it starts past it. The table is the Lunhui plugin's
 * `face/plugins/lunhui/lib/calendar/2026.json`, copied (the face imports nothing from `face/plugins/` at runtime;
 * tests/xshg-clock.test.ts pins the copy against that file). Its sources, the SSE's notices:
 *
 * - https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml - the year's holidays
 *   (元旦, 春节, 清明节, 劳动节, 端午节);
 * - https://www.sse.com.cn/disclosure/announcement/general/c/c_20260915_10832273.shtml - 中秋节 and 国庆节.
 *
 * Only the weekdays inside each range are listed: the exchange never trades a Saturday or a Sunday, a makeup
 * working weekend (调休) included. Regular hours are 09:30-15:00 Beijing time (UTC+8, no daylight time), the
 * midday break inside the session; there are no early closes. Extend the table, and {@link XSHG_COVERED}, when
 * the SSE publishes the next year's notice.
 *
 * It imports only market-clock.ts's types, so the cycle market-clock.ts → this file stays type-only.
 * @module
 */
import type { MarketClock, MarketSession, MarketWindow } from "./market-clock.ts";

/** The table's name, carried as a window's `source` and as the A-share calendar's `clock`. */
export const XSHG_CLOCK = "builtin XSHG table (face/src/xshg-clock.ts)";

/** Every weekday of 2026 the SSE is closed, by Beijing date, naming the holiday. */
export const XSHG_CLOSURES: Readonly<Record<string, string>> = {
  "2026-01-01": "元旦",
  "2026-01-02": "元旦",
  "2026-02-16": "春节",
  "2026-02-17": "春节",
  "2026-02-18": "春节",
  "2026-02-19": "春节",
  "2026-02-20": "春节",
  "2026-02-23": "春节",
  "2026-04-06": "清明节",
  "2026-05-01": "劳动节",
  "2026-05-04": "劳动节",
  "2026-05-05": "劳动节",
  "2026-06-19": "端午节",
  "2026-09-25": "中秋节",
  "2026-10-01": "国庆节",
  "2026-10-02": "国庆节",
  "2026-10-05": "国庆节",
  "2026-10-06": "国庆节",
  "2026-10-07": "国庆节",
};

/** The Beijing dates the table answers for, both ends included. */
export const XSHG_COVERED = { from: "2026-01-01", through: "2026-12-31" } as const;

/** The most days one window holds: market-clock.ts's `MAX_WINDOW_DAYS`, restated so this file imports no value. */
const MAX_DAYS = 31;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a real calendar date written `YYYY-MM-DD`. */
function isDateText(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
}

/** The date `n` days after `date`. */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The whole days from `a` to `b`. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const dateRefusal = (date: unknown): Error =>
  new Error(`the A-share calendar takes a YYYY-MM-DD date, not ${JSON.stringify(String(date).slice(0, 40))}`);

/**
 * That Beijing date's XSHG session.
 * @param date - a Beijing date, `YYYY-MM-DD`.
 * @returns the session, 09:30-15:00 Beijing as UTC instants (`01:30:00Z`-`07:00:00Z`); `"closed"` for a weekend or
 *   a closure in the table; `"uncovered"` outside {@link XSHG_COVERED}, where the table knows nothing.
 * @throws Error - `the A-share calendar takes a YYYY-MM-DD date, not "<date>"`.
 */
export function xshgSession(date: string): MarketSession | "closed" | "uncovered" {
  if (!isDateText(date)) throw dateRefusal(date);
  if (date < XSHG_COVERED.from || date > XSHG_COVERED.through) return "uncovered";
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (wd === 0 || wd === 6 || XSHG_CLOSURES[date] !== undefined) return "closed";
  return { date, open: `${date}T01:30:00Z`, close: `${date}T07:00:00Z`, early: false };
}

/**
 * Every XSHG session from `from` through the `days`-th day, cut to end at {@link XSHG_COVERED}'s `through`.
 * @param from - the first Beijing date, `YYYY-MM-DD`.
 * @param days - how many days, 1 to 31; the window's own `days` may be fewer, at the table's end.
 * @returns the window, its `source` {@link XSHG_CLOCK}.
 * @throws Error - for a bad date or day count, and `the A-share calendar covers 2026-01-01 to 2026-12-31; <from> is
 *   past it` (or `is before it`) for a `from` outside the table.
 */
export function xshgWindow(from: string, days: number): MarketWindow {
  if (!isDateText(from)) throw dateRefusal(from);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`the A-share calendar takes 1 to ${MAX_DAYS} days, not ${String(days)}`);
  const covers = `the A-share calendar covers ${XSHG_COVERED.from} to ${XSHG_COVERED.through}`;
  if (from > XSHG_COVERED.through) throw new Error(`${covers}; ${from} is past it`);
  if (from < XSHG_COVERED.from) throw new Error(`${covers}; ${from} is before it`);
  const held = Math.min(days, daysBetween(from, XSHG_COVERED.through) + 1);
  const sessions: MarketSession[] = [];
  for (let n = 0; n < held; n++) {
    const session = xshgSession(addDays(from, n));
    if (typeof session === "object") sessions.push(session);
  }
  return { from, days: held, source: XSHG_CLOCK, sessions };
}

/** The A-share clock: {@link xshgWindow}, as a {@link MarketClock}; a `from` past the table rejects. */
export function xshgMarketClock(): MarketClock {
  return async (from, days) => xshgWindow(from, days);
}
