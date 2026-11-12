// face/plugins/analog/lib/events.mjs
/**
 * An event's day 0, what the stock did after it against the market, the tape around it, and its window of bars.
 * Pure functions over daily bars, oldest first: no clock, no I/O.
 *
 * Day 0 is the first session that could react to the event: the event's own date when it came before or during the
 * session (`pre`, `open`), the next session when it came after the close or on a day the market was shut (`post`,
 * `closed`); a date that is no session of the company's moves to its next one. Every change is measured from the
 * close before day 0, and against the market as (1 + stock) ÷ (1 + market) − 1, the market's bars paired with the
 * company's by date and never by position.
 */
import { POST, barOn, dateOf, windowOf } from "./episodes.mjs";

/**
 * @typedef {import("./selloff.mjs").Bar} Bar
 * @typedef {{ date: string, timing: "pre" | "open" | "post" | "closed" }} When
 * @typedef {{ base: number, gap: number, r0: number, r1: number | null, r5: number | null, r20: number | null,
 *   r60: number | null, x0: number | null, x1: number | null, x5: number | null, x20: number | null,
 *   x60: number | null, low60: number, lowAt: number, sessionsAfter: number }} Measure
 * @typedef {{ vol0: number | null, busiest: { at: number, ratio: number } | null,
 *   flags: Array<"quiet" | "elsewhere"> }} Tape
 */

/** When an event came: before the open, during the session, after the close, or on a day the market was shut. */
export const TIMINGS = ["pre", "open", "post", "closed"];
/** The fewest sessions a company needs before day 0. */
export const MIN_BEFORE = 20;
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

/** The horizons, in sessions after day 0, of the changes measured. */
const HORIZONS = [0, 1, 5, 20, 60];

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
 * A market close that is a positive finite number, or null.
 * @param {Bar | undefined} bar
 * @returns {number | null}
 */
function closeOf(bar) {
  return bar !== undefined && Number.isFinite(bar.c) && bar.c > 0 ? bar.c : null;
}

/**
 * What the stock did from the close before day `i0` (`i0 >= 1`): day 0's open (`gap`) and the closes 0, 1, 5, 20 and
 * 60 sessions on (`r_k`) over that close, minus one, null for a horizon not reached; each against the market (`x_k`),
 * null when the market lacks the date of the base or of the horizon's bar, or its close there is not a positive
 * finite number; the lowest low from day 0 through 60 sessions on (or the last bar) on the same footing, and its
 * session (the earliest on ties); and how many sessions follow day 0.
 * @param {Bar[]} bars @param {number} i0 @param {Bar[] | null} marketBars
 * @returns {Measure}
 */
export function measureEvent(bars, i0, marketBars) {
  const last = bars.length - 1;
  const base = bars[i0 - 1].c;
  const marketBase = marketBars === null ? null : closeOf(barOn(marketBars, dateOf(bars[i0 - 1].t)));
  /** @type {Record<string, number | null>} */
  const changes = {};
  for (const k of HORIZONS) {
    const i = i0 + k;
    const r = i <= last ? bars[i].c / base - 1 : null;
    changes[`r${k}`] = r;
    let x = null;
    if (r !== null && marketBars !== null && marketBase !== null) {
      const close = closeOf(barOn(marketBars, dateOf(bars[i].t)));
      if (close !== null) x = (1 + r) / (close / marketBase) - 1;
    }
    changes[`x${k}`] = x;
  }
  let low = Infinity;
  let lowAt = 0;
  for (let i = i0; i <= Math.min(i0 + POST, last); i++) {
    if (bars[i].l < low) { low = bars[i].l; lowAt = i - i0; }
  }
  return {
    base, gap: bars[i0].o / base - 1,
    r0: /** @type {number} */ (changes.r0), r1: changes.r1, r5: changes.r5, r20: changes.r20, r60: changes.r60,
    x0: changes.x0, x1: changes.x1, x5: changes.x5, x20: changes.x20, x60: changes.x60,
    low60: low / base - 1, lowAt, sessionsAfter: last - i0,
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
 * The event's window, 30 sessions before day `i0` to 60 after, its prices a percentage of the close before day 0;
 * and its path against the market, `[k, value]` for each row whose date the market has: the company's close over that
 * base, divided by the market's close over the market's close on the base's date, times 100, to two decimals. The
 * path is empty when there is no market or it lacks the base's date.
 * @param {Bar[]} bars @param {number} i0 @param {Bar[] | null} marketBars
 * @returns {{ window: Array<[number, number, number, number, number, number]>, rel: Array<[number, number]> }}
 */
export function eventWindow(bars, i0, marketBars) {
  const base = bars[i0 - 1].c;
  const window = windowOf(bars, i0, base);
  /** @type {Array<[number, number]>} */
  const rel = [];
  const marketBase = marketBars === null ? null : closeOf(barOn(marketBars, dateOf(bars[i0 - 1].t)));
  if (marketBars === null || marketBase === null) return { window, rel };
  for (const [k] of window) {
    const bar = bars[i0 + k];
    const close = closeOf(barOn(marketBars, dateOf(bar.t)));
    if (close === null) continue;
    rel.push([k, Math.round(((bar.c / base) / (close / marketBase)) * 10_000) / 100]);
  }
  return { window, rel };
}
