// face/plugins/analog/lib/sessions.mjs
/**
 * Day 0 checked on SPY's sessions (spec §4.2). Pure: no clock, no I/O.
 *
 * The same day-0 rule applied to the calendar's bars (SPY's) gives the first session that could react; the sessions
 * the calendar traded from it up to the stock's day 0 are the sessions the stock skipped. A skip after the stock had
 * traded is a halt or a hole, measured and counted; a skip onto the stock's first bar means the date's session is not
 * in its bars, unmeasured. Where the calendar does not cover the date, day 0 more than `CALENDAR_DAYS` calendar days
 * after the date is unmeasured instead.
 */
import { dayZero } from "./events.mjs";
import { dateOf } from "./windows.mjs";

/**
 * @typedef {import("./bars.mjs").Bar} Bar
 * @typedef {import("./events.mjs").When} When
 */

/** Where the calendar does not cover the date, day 0 may come at most this many calendar days after it. */
export const CALENDAR_DAYS = 7;

const DAY = 86_400_000;

/**
 * Calendar days from one `YYYY-MM-DD` date to another.
 * @param {string} from @param {string} to
 * @returns {number}
 */
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/**
 * Checks day `i0` of `bars` for the event `when` against the calendar's sessions. The calendar covers the date when
 * it has bars, its first is dated on or before the event's date and the day-0 rule finds a session in it. Covered:
 * the sessions skipped are the calendar's bars dated from its day 0 up to, not including, the stock's day 0's date;
 * skipped with `i0 > 0` is a halt, `{ skipped, listed: false }`; skipped with `i0 === 0` is unmeasured, the words
 * naming the first bar and the date; none skipped is `listed` when day 0 is the first bar of a history not read
 * short. Not covered: day 0 more than `CALENDAR_DAYS` calendar days after the date is unmeasured, else
 * `{ skipped: 0, listed: false }`.
 * @param {Bar[]} bars @param {number} i0 @param {When} when
 * @param {{ calendar: Bar[] | null, short: boolean }} options
 * @returns {{ skipped: number, listed: boolean } | { words: string }}
 */
export function checkDayZero(bars, i0, when, { calendar, short }) {
  const day0 = dateOf(bars[i0].t);
  const s = calendar !== null && calendar.length > 0 && dateOf(calendar[0].t) <= when.date ? dayZero(calendar, when) : null;
  if (calendar === null || s === null) {
    const days = daysBetween(when.date, day0);
    if (days > CALENDAR_DAYS) {
      return { words: `day 0 would be ${day0}, ${days} days after ${when.date}: its bars do not cover the date` };
    }
    return { skipped: 0, listed: false };
  }
  let skipped = 0;
  for (let i = s; i < calendar.length && dateOf(calendar[i].t) < day0; i++) skipped++;
  if (skipped > 0) {
    if (i0 > 0) return { skipped, listed: false };
    const sessions = skipped === 1 ? "session" : "sessions";
    return { words: `its bars start ${day0}, ${skipped} ${sessions} after ${when.date}: the date's session is not in its bars` };
  }
  return { skipped: 0, listed: i0 === 0 && !short };
}
