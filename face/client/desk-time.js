/** New York's time as the desk shows it in the browser, in one place: the
 * Desk panel (desk-panel.js) and its standing orders' card (desk-standing.js)
 * both write every time through here, so the two can never disagree on when a
 * time is dated - and with them the two small things both modules need, the
 * dash for a value the face did not give and the object test.
 *
 * Times are New York's, as the desk shows them everywhere (src/et.ts, src/desk.ts
 * `deskTime`): `14:03 ET` on the same New York date as now, `2026-10-21 14:03
 * ET` on any other, so a time from yesterday never reads as today's.
 * @module
 */

/** Rendered in place of a value the face did not give. */
export const EM = "—";

/** @param {unknown} value @returns {value is Record<string, any>} whether `value` is a non-null, non-array object. */
export const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** One formatter for every helper: `hourCycle: "h23"`, so midnight is `00`, never `24`. */
const NY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** @param {Date} d @returns {Record<string, string>} `d` in New York, field by field. */
function nyParts(d) {
  /** @type {Record<string, string>} */
  const parts = {};
  for (const { type, value } of NY.formatToParts(d)) parts[type] = value;
  return parts;
}

/** @param {unknown} d @returns {boolean} whether `d` is a Date that holds a time. */
export const isTime = (d) => d instanceof Date && !Number.isNaN(d.getTime());

/** @param {Date} d @returns {string} the date in New York: `2026-10-20`. */
export function nyDate(d) {
  const { year, month, day } = nyParts(d);
  return `${year}-${month}-${day}`;
}

/**
 * A time as the desk shows it, less its ` ET`: `14:03` on the same New York date
 * as `now`, `2026-10-21 14:03` on any other - and on every date when `now` holds
 * no time; `—` for no time.
 * @param {unknown} at - the time shown: a Date, else no time.
 * @param {Date} now - the time it is read at.
 * @returns {string}
 */
export function deskStamp(at, now) {
  if (!isTime(at)) return EM;
  const d = /** @type {Date} */ (at);
  const { hour, minute } = nyParts(d);
  const time = `${hour}:${minute}`;
  return isTime(now) && nyDate(d) === nyDate(now) ? time : `${nyDate(d)} ${time}`;
}

/**
 * A time as the desk shows it (src/desk.ts `deskTime`): `14:03 ET` on the same
 * New York date as `now`, `2026-10-21 14:03 ET` on any other; `—` for no time.
 * @param {unknown} at - the time shown: a Date, else no time.
 * @param {Date} now - the time it is read at.
 * @returns {string}
 */
export function deskTime(at, now) {
  const stamp = deskStamp(at, now);
  return stamp === EM ? EM : `${stamp} ET`;
}
