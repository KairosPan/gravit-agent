// face/plugins/analog/lib/selloff.mjs
/**
 * The five numbers of a sell-off on one day, the bands a query's numbers set, and the distance between two days.
 * Pure functions over daily bars, oldest first: no clock, no I/O. A day's numbers read bars up to and including
 * that day only.
 *
 * The five numbers of day `i`:
 * - `depth`: the close over the highest high of the last 60 sessions (`[i − 60, i]`), minus one;
 * - `days`: the sessions since that high (the earliest on ties);
 * - `last5`: the close over the close five sessions before, minus one;
 * - `gap`: the lowest open over the previous close, minus one, of the last five sessions (0 when none gapped down);
 * - `volume`: the highest volume of the last five sessions over the mean volume of `[i − 55, i − 6]`.
 * Beside them, `gapAt` is the session of that gap, `peakAt` the session of the high, and `fromHigh` whether the high
 * was within 2% of the highest high of the year before it.
 *
 * The bands are relative to the query and hold the query's own numbers when its high is 1 to 59 sessions old. A high
 * 60 sessions old sits on the window's edge: the days band's cap of 59 leaves the query's own days out, and a higher
 * high may lie older than the window, so the fall may be deeper than the window shows. A query whose high is its own
 * day (0 days) has no usable bands and is refused by the scan before `bandsFor` or `distance` sees it.
 */

/**
 * @typedef {{ t: number, o: number, h: number, l: number, c: number, v: number | null }} Bar
 * @typedef {{ depth: number, days: number, last5: number, gap: number, gapAt: number, volume: number | null,
 *   peakAt: number, fromHigh: boolean | null }} Features
 * @typedef {{ depth: [number, number], days: [number, number], last5: number | null, gap: number | null,
 *   volume: number | null, dropped: string[] }} Bands
 */

/** The sessions the high is looked for in, before the day itself. */
export const LOOKBACK = 60;
/** The fewest bars a stock needs before it is scanned. */
export const MIN_BARS = 120;
/** A day is a sell-off when its depth is at or below this. */
export const SELLOFF_DEPTH = -0.10;

/** The bands' factors on the query's numbers, and what the query must meet for a condition to be active. */
export const BAND = Object.freeze({
  depthDeep: 1.45, depthShallow: 0.70, daysLo: 0.4, daysHi: 1.8, last5: 0.53, gap: 0.55, volume: 0.62,
  volumeFloor: 1.5, last5Needs: -0.05, gapNeeds: -0.02,
});
/** The scale each difference is divided by in the distance; days and volume are compared as logarithms. */
export const SCALE = Object.freeze({ depth: 0.07, lnDays: 0.45, last5: 0.06, gap: 0.035, lnVolume: 0.45 });

/** The volume baseline's window, `[i − 55, i − 6]`, and the fewest sessions in it that must carry a volume. */
const BASELINE_FROM = 55;
const BASELINE_TO = 6;
const BASELINE_MIN = 40;
/** `fromHigh` needs this many sessions before the high, and compares it with the high of this many before it. */
const HISTORY_BEFORE_HIGH = 200;
const YEAR = 252;
const NEAR_YEAR_HIGH = 0.98;

/** @param {number | null | undefined} v */
const positive = (v) => typeof v === "number" && v > 0;

/**
 * The relative volume of day `i`, or null when fewer than 40 of the 50 baseline sessions, or none of the last five,
 * carry a volume.
 * @param {Bar[]} bars @param {number} i
 * @returns {number | null}
 */
function volumeAt(bars, i) {
  let sum = 0;
  let n = 0;
  for (let k = i - BASELINE_FROM; k <= i - BASELINE_TO; k++) {
    const v = bars[k]?.v;
    if (positive(v)) { sum += /** @type {number} */ (v); n++; }
  }
  if (n < BASELINE_MIN) return null;
  let top = 0;
  for (let k = i - 4; k <= i; k++) {
    const v = bars[k].v;
    if (positive(v) && /** @type {number} */ (v) > top) top = /** @type {number} */ (v);
  }
  return top > 0 ? top / (sum / n) : null;
}

/**
 * Whether the high at `peakAt` is within 2% of the highest high of the 252 sessions before it; null when fewer than
 * 200 sessions precede it.
 * @param {Bar[]} bars @param {number} peakAt
 * @returns {boolean | null}
 */
function fromHighAt(bars, peakAt) {
  if (peakAt < HISTORY_BEFORE_HIGH) return null;
  let before = -Infinity;
  for (let k = Math.max(0, peakAt - YEAR); k < peakAt; k++) if (bars[k].h > before) before = bars[k].h;
  return bars[peakAt].h >= NEAR_YEAR_HIGH * before;
}

/**
 * The five numbers of day `i`, or null when fewer than 60 sessions precede it.
 * @param {Bar[]} bars @param {number} i
 * @returns {Features | null}
 */
export function featuresAt(bars, i) {
  if (i < LOOKBACK || i >= bars.length) return null;
  let peakAt = i - LOOKBACK;
  for (let k = peakAt + 1; k <= i; k++) if (bars[k].h > bars[peakAt].h) peakAt = k;
  let gap = 0;
  let gapAt = i;
  for (let k = i - 4; k <= i; k++) {
    const g = bars[k].o / bars[k - 1].c - 1;
    if (g < gap) { gap = g; gapAt = k; }
  }
  return {
    depth: bars[i].c / bars[peakAt].h - 1,
    days: i - peakAt,
    last5: bars[i].c / bars[i - 5].c - 1,
    gap,
    gapAt,
    volume: volumeAt(bars, i),
    peakAt,
    fromHigh: fromHighAt(bars, peakAt),
  };
}

/**
 * The bands a query's numbers set. The days band is `[max(3, 0.4·days), min(59, 1.8·days)]`, rounded, its lower edge
 * lowered to the query's own days when the high is under three sessions old, so the band holds the query's days from
 * 1 to 59 (1 → [1, 2], 2 → [2, 4]); at 60, the high on the window's edge, the cap leaves them out ([24, 59]), and that
 * high may not be the stock's highest, nor the fall its deepest, beyond the window. A query of 0 days is the scan's to refuse before it reaches here: daily bars cannot
 * time a fall inside one session. `last5`, `gap` and `volume` are active only when the query meets their need; an
 * inactive one is null and named in `dropped`.
 * @param {Features} q
 * @returns {Bands}
 */
export function bandsFor(q) {
  /** @type {string[]} */
  const dropped = [];
  const last5 = q.last5 <= BAND.last5Needs ? BAND.last5 * q.last5 : (dropped.push("last5"), null);
  const gap = q.gap <= BAND.gapNeeds ? BAND.gap * q.gap : (dropped.push("gap"), null);
  const volume = q.volume !== null && q.volume >= BAND.volumeFloor
    ? Math.max(BAND.volumeFloor, BAND.volume * q.volume)
    : (dropped.push("volume"), null);
  return {
    depth: [BAND.depthDeep * q.depth, BAND.depthShallow * q.depth],
    days: [
      Math.min(q.days, Math.max(3, Math.round(BAND.daysLo * q.days))),
      Math.min(LOOKBACK - 1, Math.round(BAND.daysHi * q.days)),
    ],
    last5,
    gap,
    volume,
    dropped,
  };
}

/**
 * Whether a day's numbers hold every active condition of the bands; a day with no volume fails an active volume band.
 * @param {Features} f @param {Bands} bands
 * @returns {boolean}
 */
export function inBand(f, bands) {
  if (f.depth < bands.depth[0] || f.depth > bands.depth[1]) return false;
  if (f.days < bands.days[0] || f.days > bands.days[1]) return false;
  if (bands.last5 !== null && f.last5 > bands.last5) return false;
  if (bands.gap !== null && f.gap > bands.gap) return false;
  if (bands.volume !== null && (f.volume === null || f.volume < bands.volume)) return false;
  return true;
}

/**
 * The distance from a day's numbers to the query's: the root of the summed squares of the scaled differences, days
 * and volume as logarithms, an inactive condition's term left out. A day that passed `inBand` carries every number
 * an active condition needs.
 * @param {Features} f @param {Features} q @param {Bands} bands
 * @returns {number}
 */
export function distance(f, q, bands) {
  let sum = ((f.depth - q.depth) / SCALE.depth) ** 2 + (Math.log(f.days / q.days) / SCALE.lnDays) ** 2;
  if (bands.last5 !== null) sum += ((f.last5 - q.last5) / SCALE.last5) ** 2;
  if (bands.gap !== null) sum += ((f.gap - q.gap) / SCALE.gap) ** 2;
  if (bands.volume !== null && f.volume !== null && q.volume !== null) {
    sum += (Math.log(f.volume / q.volume) / SCALE.lnVolume) ** 2;
  }
  return Math.sqrt(sum);
}
