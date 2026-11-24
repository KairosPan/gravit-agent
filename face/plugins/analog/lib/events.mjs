// face/plugins/analog/lib/events.mjs
/**
 * An event's day 0, its base, what the stock did after it against a benchmark, the tape around it, and its paths.
 * Pure functions over daily bars, oldest first: no clock, no I/O.
 *
 * Day 0 is the first session that could react to the event: the event's own date when it came before or during the
 * session (`pre`, `open`), the next session when it came after the close or on a day the market was shut (`post`,
 * `closed`); a date that is no session of the company's moves to its next one. Every change is measured from one
 * base (spec §4.2): the close before day 0 (`prior_close`), a stated price (`price`), day 0's open (`day0_open`) or
 * day 0's close (`day0_close`); and against a benchmark as (1 + stock) / (1 + benchmark) - 1, the benchmark's bars
 * paired with the company's by date and never by position.
 */
import { PRE, barBefore, barOn, dateOf, windowOf } from "./windows.mjs";

/**
 * @typedef {import("./bars.mjs").Bar} Bar
 * @typedef {import("./windows.mjs").Path} Path
 * @typedef {{ date: string, timing: "pre" | "open" | "post" | "closed" }} When
 * @typedef {"prior_close" | "price" | "day0_open" | "day0_close"} Base
 * @typedef {{ k: number, r: number | null, x: number | null }} Change
 * @typedef {{ base: number, gap: number | null, changes: Change[], low: number | null, lowAt: number | null,
 *   sessionsAfter: number }} Measure
 * @typedef {{ value: number, benchBase: number | null }} Based
 * @typedef {{ vol0: number | null, busiest: { at: number, ratio: number } | null,
 *   flags: Array<"quiet" | "elsewhere"> }} Tape
 */

/** The bases a case can be measured from. */
export const BASES = ["prior_close", "price", "day0_open", "day0_close"];
/** The most horizons a call can ask for. */
export const HORIZONS_MAX = 6;
/** The farthest horizon, in sessions after day 0. */
export const HORIZON_MAX = 250;
/** The horizons, in sessions after day 0, measured when a call names none. */
export const DEFAULT_HORIZONS = [0, 1, 5, 20, 60];
/** ... and under `day0_close`, whose horizon 0 would be its own base. */
export const DEFAULT_HORIZONS_DAY0_CLOSE = [1, 5, 20, 60];
/** When an event came: before the open, during the session, after the close, or on a day the market was shut. */
export const TIMINGS = ["pre", "open", "post", "closed"];
/** Day 0's volume is against the mean of this many sessions before it. */
export const VOLUME_BASE = 50;
/** The fewest of those sessions that must carry a volume for any ratio. */
export const MIN_VOLUMES = 20;
/** Day 0's volume under this many times the mean is `quiet`. */
export const QUIET = 1.5;
/** A neighbour at this many times the mean or more ... */
export const ELSEWHERE = 3;
/** ... and at least this many times day 0's own is `elsewhere`. */
export const ELSEWHERE_OVER = 1.5;
/** The neighbours are the sessions this many either side of day 0. */
export const NEIGHBOURS = 2;

/**
 * The index of day 0 for an event: `pre` and `open` take the first bar dated on or after the event's date, `post`
 * and `closed` the first bar dated after it; null when there is none (day 0 has not traded).
 * @param {Bar[]} bars @param {When} when
 * @returns {number | null}
 */
export function dayZero(bars, when) {
  const after = when.timing === "post" || when.timing === "closed";
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const date = dateOf(bars[mid].t);
    if (after ? date <= when.date : date < when.date) lo = mid + 1;
    else hi = mid;
  }
  return lo < bars.length ? lo : null;
}

/**
 * A price that is a positive finite number, or null.
 * @param {number | undefined} p
 * @returns {number | null}
 */
function priceOf(p) {
  return typeof p === "number" && Number.isFinite(p) && p > 0 ? p : null;
}

/**
 * The base of day `i0` and its benchmark's, per spec §4.2: `prior_close` the close of the bar before day 0 (none when
 * day 0 is the first bar) and the benchmark's close on that bar's date; `price` the given price (already divided by
 * its split factor) and the benchmark's close on its last bar dated before day 0's date; `day0_open` day 0's open and
 * the benchmark's open on day 0's date; `day0_close` day 0's close and the benchmark's close on day 0's date. A
 * benchmark price that is not a positive finite number, a benchmark without the date, or none, gives `benchBase`
 * null. A base that cannot be had gives the words why.
 * @param {Bar[]} bars @param {number} i0 @param {Base} base @param {number | null} price
 * @param {Bar[] | null} bench
 * @returns {Based | { words: string }}
 */
export function baseOf(bars, i0, base, price, bench) {
  const day0 = dateOf(bars[i0].t);
  if (base === "prior_close") {
    if (i0 < 1) {
      return { words: `day 0 is its first bar (${day0}): there is no close before it; measure a listing from its price, day 0's open or day 0's close` };
    }
    const before = bars[i0 - 1];
    return { value: before.c, benchBase: bench === null ? null : priceOf(barOn(bench, dateOf(before.t))?.c) };
  }
  if (base === "price") {
    return { value: /** @type {number} */ (price), benchBase: bench === null ? null : priceOf(barBefore(bench, day0)?.c) };
  }
  if (base === "day0_open") {
    const open = priceOf(bars[i0].o);
    if (open === null) return { words: "day 0's open in its bars is not a price" };
    return { value: open, benchBase: bench === null ? null : priceOf(barOn(bench, day0)?.o) };
  }
  return { value: bars[i0].c, benchBase: bench === null ? null : priceOf(barOn(bench, day0)?.c) };
}

/**
 * What the stock did from its base: day 0's open over it (`gap`, under `prior_close` and `price` only, else null);
 * at each horizon `k` the close `k` sessions after day 0 over it, minus one (`r`), null when the bars do not reach
 * it, and against the benchmark (`x`), null when the benchmark lacks the horizon's date or its base, or its close
 * there is not a positive finite number; the lowest low from day 0 (the session after, under `day0_close`) through
 * the last horizon or the last bar, over the base, and its session (the earliest on ties), both null when that
 * range is empty; and how many sessions follow day 0.
 * @param {Bar[]} bars @param {number} i0 @param {Base} base @param {Based} based @param {number[]} horizons
 * @param {Bar[] | null} bench
 * @returns {Measure}
 */
export function measureCase(bars, i0, base, based, horizons, bench) {
  const last = bars.length - 1;
  const value = based.value;
  /** @type {Change[]} */
  const changes = horizons.map((k) => {
    const i = i0 + k;
    const r = i <= last ? bars[i].c / value - 1 : null;
    let x = null;
    if (r !== null && bench !== null && based.benchBase !== null) {
      const close = priceOf(barOn(bench, dateOf(bars[i].t))?.c);
      if (close !== null) x = (1 + r) / (close / based.benchBase) - 1;
    }
    return { k, r, x };
  });
  let low = null;
  let lowAt = null;
  const through = Math.min(i0 + (horizons.at(-1) ?? 0), last);
  for (let i = base === "day0_close" ? i0 + 1 : i0; i <= through; i++) {
    if (low === null || bars[i].l < low) { low = bars[i].l; lowAt = i - i0; }
  }
  return {
    base: value,
    gap: base === "prior_close" || base === "price" ? bars[i0].o / value - 1 : null,
    changes,
    low: low === null ? null : low / value - 1,
    lowAt,
    sessionsAfter: last - i0,
  };
}

/**
 * A bar's volume when it carries one above 0, or null.
 * @param {Bar | undefined} bar
 * @returns {number | null}
 */
function volumeOf(bar) {
  return bar !== undefined && typeof bar.v === "number" && bar.v > 0 ? bar.v : null;
}

/**
 * The tape around day `i0`: its volume over the mean of the volumes of the 50 sessions before it (`vol0`), needing 20
 * of them; the busiest of the sessions two either side on the same footing (the earliest on ties); and its flags,
 * `quiet` when day 0 is under 1.5 times the mean, `elsewhere` when that neighbour is at 3 times or more and at least
 * 1.5 times day 0's. No mean, or no volume on day 0, gives no ratio and no flag.
 * @param {Bar[]} bars @param {number} i0
 * @returns {Tape}
 */
export function tapeCheck(bars, i0) {
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, i0 - VOLUME_BASE); i < i0; i++) {
    const v = volumeOf(bars[i]);
    if (v !== null) { sum += v; count++; }
  }
  const v0 = volumeOf(bars[i0]);
  if (count < MIN_VOLUMES || v0 === null) return { vol0: null, busiest: null, flags: [] };
  const mean = sum / count;
  const vol0 = v0 / mean;
  /** @type {{ at: number, ratio: number } | null} */
  let busiest = null;
  for (let at = -NEIGHBOURS; at <= NEIGHBOURS; at++) {
    if (at === 0) continue;
    const v = volumeOf(bars[i0 + at]);
    if (v === null) continue;
    const ratio = v / mean;
    if (busiest === null || ratio > busiest.ratio) busiest = { at, ratio };
  }
  /** @type {Array<"quiet" | "elsewhere">} */
  const flags = [];
  if (vol0 < QUIET) flags.push("quiet");
  if (busiest !== null && busiest.ratio >= ELSEWHERE && busiest.ratio >= ELSEWHERE_OVER * vol0) flags.push("elsewhere");
  return { vol0, busiest, flags };
}

/**
 * A case's paths: its window, 30 sessions before day `i0` to 60 after (none before a listing), as a percentage of
 * its base; and `rel`, `[k, value]` from 30 sessions before day 0 to `through` after (as far as the bars go). Against
 * a benchmark (`relOf: "benchmark"`) each value is the company's close over its base divided by the benchmark's close
 * over its base, times 100, to two decimals, for each row whose date the benchmark has; empty when the benchmark
 * lacks its base. With no benchmark (`relOf: "self"`) it is the company's own close over its base, times 100.
 * @param {Bar[]} bars @param {number} i0 @param {Based} based @param {Bar[] | null} bench @param {number} through
 * @returns {{ window: Path, rel: Array<[number, number]>, relOf: "benchmark" | "self" }}
 */
export function casePaths(bars, i0, based, bench, through) {
  const value = based.value;
  const window = windowOf(bars, i0, value);
  /** @type {Array<[number, number]>} */
  const rel = [];
  const relOf = bench === null ? "self" : "benchmark";
  if (bench !== null && based.benchBase === null) return { window, rel, relOf };
  const benchBase = /** @type {number} */ (based.benchBase);
  for (let i = Math.max(0, i0 - PRE); i <= Math.min(bars.length - 1, i0 + through); i++) {
    const bar = bars[i];
    let ratio = bar.c / value;
    if (bench !== null) {
      const close = priceOf(barOn(bench, dateOf(bar.t))?.c);
      if (close === null) continue;
      ratio /= close / benchBase;
    }
    rel.push([i - i0, Math.round(ratio * 10_000) / 100]);
  }
  return { window, rel, relOf };
}
