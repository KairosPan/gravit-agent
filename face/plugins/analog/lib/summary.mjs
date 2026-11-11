// face/plugins/analog/lib/summary.mjs
/**
 * What a group of sell-off cases did afterwards, in medians and shares. Pure functions: no clock, no I/O.
 *
 * A case under way (fewer than 20 sessions after its day 0) is in no summary. `n` counts the rest and `n60` those of
 * them with a close 60 sessions on. A group is summarized only when `n60` reaches 8; under that every statistic is
 * null and only the counts are given, so a handful of cases never reads as a median.
 *
 * `r5` and `r20` are medians over the `n` cases that have them, and `up20` the share of the `n` cases whose `r20` is
 * above zero. Over the `n60` cases: the median `r60` and its quartiles, the median `low60` and `lowAt`, the shares
 * whose further low reached −5%, −10% and −20% (`lower5`, `lower10`, `lower20`), and the share whose `r60` is above
 * zero (`up60`).
 */
import { UNDER_WAY } from "./episodes.mjs";

/**
 * @typedef {import("./episodes.mjs").After} After
 * @typedef {{ n: number, n60: number, summarized: boolean, r5: number | null, r20: number | null,
 *   r60: number | null, r60q1: number | null, r60q3: number | null, low60: number | null, lowAt: number | null,
 *   lower5: number | null, lower10: number | null, lower20: number | null, up20: number | null,
 *   up60: number | null }} Summary
 */

/** The fewest cases with a 60-session close a group needs before it gets a median. */
export const MIN_GROUP = 8;
/** The further lows the `lower` shares count: a low at or below each. */
const LOWER = Object.freeze({ lower5: -0.05, lower10: -0.10, lower20: -0.20 });

/**
 * The `p` quantile of `values`, interpolated linearly between the two nearest values in sorted order; NaN when
 * `values` is empty. The input is not reordered.
 * @param {number[]} values @param {number} p
 * @returns {number}
 */
export function quantile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** @param {Array<number | null>} values @returns {number[]} */
const present = (values) => /** @type {number[]} */ (values.filter((v) => typeof v === "number"));

/** @param {number[]} values @returns {number | null} */
const median = (values) => (values.length === 0 ? null : quantile(values, 0.5));

/** @param {number} count @param {number} of @returns {number | null} */
const share = (count, of) => (of === 0 ? null : count / of);

/**
 * The summary of a group of cases.
 * @param {Array<{ after: After }>} cases
 * @returns {Summary}
 */
export function summarize(cases) {
  const counted = cases.map((c) => c.after).filter((a) => a.sessionsAfter >= UNDER_WAY);
  const full = counted.filter((a) => a.r60 !== null);
  const n = counted.length;
  const n60 = full.length;
  const summarized = n60 >= MIN_GROUP;
  if (!summarized) {
    return {
      n, n60, summarized, r5: null, r20: null, r60: null, r60q1: null, r60q3: null, low60: null, lowAt: null,
      lower5: null, lower10: null, lower20: null, up20: null, up60: null,
    };
  }
  const r20s = present(counted.map((a) => a.r20));
  const r60s = present(full.map((a) => a.r60));
  const lows = present(full.map((a) => a.low60));
  /** @param {number} floor */
  const lowerShare = (floor) => share(lows.filter((v) => v <= floor).length, n60);
  return {
    n,
    n60,
    summarized,
    r5: median(present(counted.map((a) => a.r5))),
    r20: median(r20s),
    r60: quantile(r60s, 0.5),
    r60q1: quantile(r60s, 0.25),
    r60q3: quantile(r60s, 0.75),
    low60: median(lows),
    lowAt: median(present(full.map((a) => a.lowAt))),
    lower5: lowerShare(LOWER.lower5),
    lower10: lowerShare(LOWER.lower10),
    lower20: lowerShare(LOWER.lower20),
    up20: share(r20s.filter((v) => v > 0).length, n),
    up60: share(r60s.filter((v) => v > 0).length, n60),
  };
}
