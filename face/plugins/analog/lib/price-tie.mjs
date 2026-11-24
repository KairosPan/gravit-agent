// face/plugins/analog/lib/price-tie.mjs
/**
 * The price tied to the bars (spec §4.2a). An offer price is in the dollars of its day and the bars are split-adjusted,
 * so the two are tied through the first-day open its source states and, after a split, the company's split record:
 * the bars' own factor is the stated open over day 0's open in the bars; with no record it must be within the
 * tolerance of 1, with a record it must be within the tolerance of the record's factor. The face never adjusts a price
 * by a factor it read only from the bars.
 */

/** How far the bars' factor may stand from the one the tie uses: the bars keep about nine significant digits, and the
 * 2% covers an open its source wrote to the cent, which on an old listing split many times over is a coarse figure. */
export const TIE_TOLERANCE = 0.02;

/** The most splits a case's record holds. */
export const SPLITS_MAX = 20;

/** @typedef {{ date: string, new: number, old: number }} Split */

const isPrice = (/** @type {unknown} */ v) => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * A factor as words: a whole number as written, else up to three significant digits.
 * @param {number} f
 */
export function factorWords(f) {
  const r = Math.round(f);
  if (r !== 0 && Math.abs(f - r) < 1e-6) return String(r);
  return String(Number(f.toPrecision(3)));
}

/**
 * @param {{ day0Open: number, day0Date: string, statedOpen: number | null, splits: Split[] | null }} a
 * @returns {{ factor: number, splitFactor: number | null } | { words: string }} `splitFactor` null when no split in the
 *   record is after day 0
 */
export function tiePrice({ day0Open, day0Date, statedOpen, splits }) {
  if (!isPrice(statedOpen)) return { words: "no first-day open from its source: its price cannot be tied to the bars" };
  if (!isPrice(day0Open)) return { words: "day 0's open in its bars is not a price" };
  const stated = /** @type {number} */ (statedOpen);
  const fBars = stated / day0Open;
  if (!splits || splits.length === 0) {
    if (Math.abs(fBars - 1) <= TIE_TOLERANCE) return { factor: 1, splitFactor: null };
    return {
      words: `its bars are adjusted about ×${factorWords(fBars)} since day 0 (its source's open ${stated.toFixed(2)}, the bars' ${day0Open.toFixed(2)}): a split record is needed`,
    };
  }
  const since = splits.filter((s) => s.date > day0Date);
  let fRecord = 1;
  for (const s of since) fRecord *= s.new / s.old;
  // a record with no split after day 0 divides the price by nothing: no split factor, as with no record
  if (Math.abs(fBars / fRecord - 1) <= TIE_TOLERANCE) return { factor: fRecord, splitFactor: since.length > 0 ? fRecord : null };
  return { words: `its split record gives ×${factorWords(fRecord)}, its bars ×${factorWords(fBars)}` };
}
