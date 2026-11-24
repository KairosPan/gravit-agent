// face/plugins/analog/lib/event-summary.mjs
/**
 * What a group of events did afterwards, at the horizons the call chose, against the benchmark or raw, the group's
 * median path, and the order its cases are shown in. Pure functions: no clock, no I/O.
 *
 * `n` counts a group's measured cases and each horizon's `n` those of them with a figure there: the change against
 * the benchmark (`x`) under `benchmark`, the raw change (`r`) under `raw`. A horizon reached by fewer than 8 cases gets
 * no median and no share below zero (and, at the last horizon, no quartiles), so a handful of cases never reads as a
 * median; the worst at the first horizon is named only when that horizon has its median. A share below zero counts
 * the figures strictly under 0 over that horizon's count.
 *
 * A group's path runs from day 0 for as long as 8 or more of its measured cases have the session: at each, the median
 * and the quartiles of their `rel` values (against the benchmark, or the stock's own path when the view is raw), each
 * indexed to 100 at the case's base, to two decimals.
 */
import { MIN_GROUP, quantile } from "./stats.mjs";

/**
 * @typedef {import("./events.mjs").Measure} Measure
 * @typedef {import("./events.mjs").Change} Change
 * @typedef {"benchmark" | "raw"} Against
 * @typedef {{ k: number, n: number, median: number | null, down: number | null }} AtHorizon
 * @typedef {{ n: number, against: Against, at: AtHorizon[], q1: number | null, q3: number | null,
 *   worst: { id: string, value: number } | null }} EventSummary
 * @typedef {{ median: number[], q1: number[], q3: number[] }} Paths
 */

/** @param {number} value @returns {number} */
const twoDecimals = (value) => Math.round(value * 100) / 100;

/**
 * A change's figure: against the benchmark (`x`) or raw (`r`); null when it has none.
 * @param {Change | undefined} change
 * @param {Against} against
 * @returns {number | null}
 */
export function valueOf(change, against) {
  if (!change) return null;
  const v = against === "raw" ? change.r : change.x;
  return typeof v === "number" ? v : null;
}

/**
 * The summary of a group of events at `horizons`; a case's figure at horizon `j` is its `measure.changes[j]`.
 * @param {Array<{ id: string, state: string, measure: Measure | null }>} cases
 * @param {number[]} horizons
 * @param {Against} against
 * @returns {EventSummary}
 */
export function summarizeEvents(cases, horizons, against) {
  const measured = cases.filter((c) => c.state === "measured" && c.measure !== null);
  /** @param {number} j @returns {Array<{ id: string, value: number }>} */
  const valuesAt = (j) => measured.flatMap((c) => {
    const value = valueOf(c.measure?.changes[j], against);
    return value === null ? [] : [{ id: c.id, value }];
  });
  const at = horizons.map((k, j) => {
    const values = valuesAt(j).map((v) => v.value);
    const enough = values.length >= MIN_GROUP;
    return {
      k, n: values.length,
      median: enough ? quantile(values, 0.5) : null,
      down: enough ? values.filter((v) => v < 0).length / values.length : null,
    };
  });
  const last = horizons.length - 1;
  const lastValues = last >= 0 ? valuesAt(last).map((v) => v.value) : [];
  const quartiles = lastValues.length >= MIN_GROUP;
  /** @type {{ id: string, value: number } | null} */
  let worst = null;
  if (at.length > 0 && at[0]?.median !== null) {
    for (const v of valuesAt(0)) if (worst === null || v.value < worst.value) worst = v;
  }
  return {
    n: measured.length, against, at,
    q1: quartiles ? quantile(lastValues, 0.25) : null,
    q3: quartiles ? quantile(lastValues, 0.75) : null,
    worst,
  };
}

/**
 * The median path of a group and its quartiles, one value per session from day 0, while at least 8 measured cases
 * have that session; null when fewer than 8 have day 0.
 * @param {Array<{ state: string, rel: Array<[number, number]> | null }>} cases
 * @returns {Paths | null}
 */
export function groupPaths(cases) {
  const byCase = cases
    .filter((c) => c.state === "measured" && c.rel !== null)
    .map((c) => new Map(/** @type {Array<[number, number]>} */ (c.rel).filter(([session]) => session >= 0)));
  /** @type {Paths} */
  const paths = { median: [], q1: [], q3: [] };
  for (let session = 0; ; session++) {
    const values = /** @type {number[]} */ (byCase.map((m) => m.get(session)).filter((v) => typeof v === "number"));
    if (values.length < MIN_GROUP) break;
    paths.median.push(twoDecimals(quantile(values, 0.5)));
    paths.q1.push(twoDecimals(quantile(values, 0.25)));
    paths.q3.push(twoDecimals(quantile(values, 0.75)));
  }
  return paths.median.length === 0 ? null : paths;
}

/**
 * The cases in the order they are shown: groups in the order they first appear; inside a group the measured cases
 * with a figure at the first horizon (against the benchmark, or raw under `raw`), most negative first, then the
 * measured ones without it by their raw change there, most negative first, then the unmeasured as given. The sort is
 * stable.
 * @template {{ group: string, state: string, measure: Measure | null }} T
 * @param {T[]} cases
 * @param {Against} against
 * @returns {T[]}
 */
export function orderCases(cases, against) {
  /** @type {Map<string, number>} */
  const groups = new Map();
  for (const c of cases) if (!groups.has(c.group)) groups.set(c.group, groups.size);
  /** @param {T} c @returns {[number, number]} the case's tier inside its group and its value there */
  const rank = (c) => {
    const first = c.state === "measured" ? c.measure?.changes[0] : undefined;
    const value = valueOf(first, against);
    if (value !== null) return [0, value];
    const raw = valueOf(first, "raw");
    if (raw !== null) return [1, raw];
    return [2, 0];
  };
  return cases
    .map((c) => ({ c, g: /** @type {number} */ (groups.get(c.group)), r: rank(c) }))
    .sort((a, b) => a.g - b.g || a.r[0] - b.r[0] || a.r[1] - b.r[1])
    .map(({ c }) => c);
}
