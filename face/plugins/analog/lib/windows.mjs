// face/plugins/analog/lib/windows.mjs
/**
 * A bar's date, a series' bar on a date, and the window of bars around a day. Pure functions over daily bars, oldest
 * first: no clock, no I/O.
 */

/**
 * @typedef {import("./bars.mjs").Bar} Bar
 * @typedef {Array<[number, number, number, number, number, number]>} Path a window's rows, each `[k, o, h, l, c, v]`
 */

/** A case's window: this many sessions before day 0 and this many after. */
export const PRE = 30;
export const POST = 60;

/**
 * The `YYYY-MM-DD` date of a bar's `t` in UTC.
 * @param {number} t
 * @returns {string}
 */
export function dateOf(t) {
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Each series' bars by date (the first bar of a date), built on the first call that sees the series. The index is
 * keyed by the bars array, so it holds only while that array is not changed in place.
 * @type {WeakMap<Bar[], Map<string, Bar>>}
 */
const seriesIndex = new WeakMap();

/**
 * The bars of a series by date, built once per series.
 * @param {Bar[]} bars
 * @returns {Map<string, Bar>}
 */
function byDate(bars) {
  let index = seriesIndex.get(bars);
  if (index === undefined) {
    index = new Map();
    for (const b of bars) {
      const date = dateOf(b.t);
      if (!index.has(date)) index.set(date, b);
    }
    seriesIndex.set(bars, index);
  }
  return index;
}

/**
 * The bar of a series on a `YYYY-MM-DD` date (its first bar of that date), through the series' date index.
 * @param {Bar[]} bars @param {string} date
 * @returns {Bar | undefined}
 */
export function barOn(bars, date) {
  return byDate(bars).get(date);
}

/**
 * The bars from 30 sessions before day `i` to 60 after, as many as there are, each `[k, o, h, l, c, v]`: `k` the
 * session relative to day 0, prices a percentage of `base` (day 0's close unless given) to two decimals, `v` as it is
 * (0 when missing).
 * @param {Bar[]} bars @param {number} i @param {number} [base]
 * @returns {Path}
 */
export function windowOf(bars, i, base = bars[i].c) {
  /** @param {number} p */
  const pct = (p) => Math.round((p / base) * 10_000) / 100;
  /** @type {Path} */
  const out = [];
  for (let k = Math.max(0, i - PRE); k <= Math.min(bars.length - 1, i + POST); k++) {
    const b = bars[k];
    out.push([k - i, pct(b.o), pct(b.h), pct(b.l), pct(b.c), b.v ?? 0]);
  }
  return out;
}
