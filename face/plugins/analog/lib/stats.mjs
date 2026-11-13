// face/plugins/analog/lib/stats.mjs
/**
 * The quantile a summary takes and the fewest cases it takes one over. Pure: no clock, no I/O.
 */

/** The fewest cases a group needs at a horizon before it gets a median there. */
export const MIN_GROUP = 8;

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
