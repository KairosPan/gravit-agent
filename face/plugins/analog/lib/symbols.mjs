// face/plugins/analog/lib/symbols.mjs
/**
 * A US ticker as people type it, made the one way the rows write it.
 */
import { refuse } from "./errors.mjs";

const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;

/**
 * A ticker as people type it, trimmed and upper-cased; anything that is not a ticker is `BAD_SYMBOL`.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeSymbol(raw) {
  if (typeof raw !== "string") throw refuse.badSymbol();
  const symbol = raw.trim().toUpperCase();
  if (!SYMBOL.test(symbol)) throw refuse.badSymbol();
  return symbol;
}
