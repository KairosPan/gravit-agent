// face/plugins/analog/lib/event-summary.mjs
/**
 * What a group of events did afterwards against the market, the group's median path, and the order its cases are
 * shown in. Pure functions: no clock, no I/O.
 *
 * `n` counts a group's measured cases and `n0`, `n1`, `n5`, `n20` and `n60` those of them with a change against the
 * market at each horizon. A horizon reached by fewer than 8 cases gets no median and no share below zero (and, at 60
 * sessions, no quartiles), so a handful of cases never reads as a median; the worst day 0 is named only when day 0 has
 * its median. A share below zero counts the changes strictly under 0 over that horizon's count.
 *
 * A group's path runs from day 0 for as long as 8 or more of its measured cases have the session: at each, the median
 * and the quartiles of their values against the market, indexed to 100 at the close before day 0, to two decimals.
 */
import { MIN_GROUP, quantile } from "./summary.mjs";

/**
 * @typedef {import("./events.mjs").Measure} Measure
 * @typedef {{ n: number, n0: number, n1: number, n5: number, n20: number, n60: number, x0: number | null,
 *   x1: number | null, x5: number | null, x20: number | null, x60: number | null, x60q1: number | null,
 *   x60q3: number | null, down0: number | null, down1: number | null, down5: number | null, down20: number | null,
 *   down60: number | null, worst0: { id: string, x0: number } | null }} EventSummary
 * @typedef {{ median: number[], q1: number[], q3: number[] }} Paths
 */

/** The horizons, in sessions after day 0, a summary reads. */
export const HORIZONS = [0, 1, 5, 20, 60];

/** @param {number} value @returns {number} */
const twoDecimals = (value) => Math.round(value * 100) / 100;

/**
 * The summary of a group of events.
 * @param {Array<{ id: string, state: string, measure: Measure | null }>} cases
 * @returns {EventSummary}
 */
export function summarizeEvents(cases) {
  const measured = cases.filter((c) => c.state === "measured" && c.measure !== null);
  /** @type {Record<string, any>} */
  const out = { n: measured.length };
  for (const k of HORIZONS) {
    const key = /** @type {"x0" | "x1" | "x5" | "x20" | "x60"} */ (`x${k}`);
    const values = /** @type {number[]} */ (
      measured.map((c) => c.measure?.[key]).filter((v) => typeof v === "number"));
    const enough = values.length >= MIN_GROUP;
    out[`n${k}`] = values.length;
    out[key] = enough ? quantile(values, 0.5) : null;
    out[`down${k}`] = enough ? values.filter((v) => v < 0).length / values.length : null;
    if (k === 60) {
      out.x60q1 = enough ? quantile(values, 0.25) : null;
      out.x60q3 = enough ? quantile(values, 0.75) : null;
    }
  }
  /** @type {{ id: string, x0: number } | null} */
  let worst0 = null;
  if (out.n0 >= MIN_GROUP) {
    for (const c of measured) {
      const x0 = c.measure?.x0;
      if (typeof x0 === "number" && (worst0 === null || x0 < worst0.x0)) worst0 = { id: c.id, x0 };
    }
  }
  out.worst0 = worst0;
  return /** @type {EventSummary} */ (out);
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
 * with a day 0 against the market, most negative first, then the measured ones without it by their own day 0, most
 * negative first, then the unmeasured as given. The sort is stable.
 * @template {{ group: string, state: string, measure: Measure | null }} T
 * @param {T[]} cases
 * @returns {T[]}
 */
export function orderCases(cases) {
  /** @type {Map<string, number>} */
  const groups = new Map();
  for (const c of cases) if (!groups.has(c.group)) groups.set(c.group, groups.size);
  /** @param {T} c @returns {[number, number]} the case's tier inside its group and its value there */
  const rank = (c) => {
    const m = c.state === "measured" ? c.measure : null;
    if (m === null) return [2, 0];
    if (typeof m.x0 === "number") return [0, m.x0];
    return [1, m.r0];
  };
  return cases
    .map((c) => ({ c, g: /** @type {number} */ (groups.get(c.group)), r: rank(c) }))
    .sort((a, b) => a.g - b.g || a.r[0] - b.r[0] || a.r[1] - b.r[1])
    .map(({ c }) => c);
}
