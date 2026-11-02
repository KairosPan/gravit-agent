// face/src/symbols.ts
/** The desk's market grammar: which market a symbol names, and the id a quote source is asked for it under. A US share
 * is a ticker in capitals (`NVDA`, `BRK.B`); an A share is its six digits (`600519`), never a number and never an
 * exchange-prefixed code (`sh600519`). desk-book.ts, market-quotes.ts and desk-tools.ts read it, so `desk_quotes`
 * routes six digits without loading the book (js-yaml with it).
 *
 * MODULE WEIGHT. A leaf: it imports nothing (tests/symbols.test.ts pins it).
 * @module
 */

/** The two markets the desk speaks: US shares and A shares. */
export type Market = "us" | "cn";

/** A US ticker: a capital letter, then at most 9 of A-Z, 0-9, `.` and `-` (`BRK.B`, `BF-B`). */
export const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** An A share: its six digits (`600519`, `000001`). */
export const CN_SYMBOL_RE = /^\d{6}$/;

/** The market `symbol` names: `cn` for six digits, `us` for a ticker, `undefined` for anything else - a number
 * included, so an unquoted `600519` in YAML is no A share. */
export function marketOf(symbol: unknown): Market | undefined {
  if (typeof symbol !== "string") return undefined;
  if (CN_SYMBOL_RE.test(symbol)) return "cn";
  return SYMBOL_RE.test(symbol) ? "us" : undefined;
}

/** The id a quote source is asked for `symbol` under: `us:NVDA`, `cn:600519`. */
export function idOf(market: Market, symbol: string): string {
  return `${market}:${symbol}`;
}
