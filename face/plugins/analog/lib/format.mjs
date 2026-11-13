// face/plugins/analog/lib/format.mjs
/**
 * How a digest writes a number, and the most bytes a digest holds. A percentage has one decimal, U+2212 for a negative
 * and `+` for a positive, bare when it rounds to 0.0%; a ratio has one decimal and `×`; a share is a whole percentage;
 * a number the view does not have is `n/a`.
 */

/** The most bytes a digest holds. */
export const DIGEST_MAX = 2048;

/** @param {number | null | undefined} v */
export function pct(v) {
  if (typeof v !== "number") return "n/a";
  const s = (v * 100).toFixed(1);
  if (s === "0.0" || s === "-0.0") return "0.0%";
  return s.startsWith("-") ? `−${s.slice(1)}%` : `+${s}%`;
}

/** @param {number | null | undefined} v */
export const ratio = (v) => (typeof v === "number" ? `${v.toFixed(1)}×` : "n/a");

/** A share as a whole percentage. @param {number | null | undefined} v */
export const whole = (v) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "n/a");
