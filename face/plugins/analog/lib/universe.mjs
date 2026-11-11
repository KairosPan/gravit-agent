// face/plugins/analog/lib/universe.mjs
/**
 * The companies a chart scan reads beside the query, the date the list was drawn and the rule it was drawn by. The
 * list is today's large companies, so companies that failed or were delisted are missing; the view says so.
 */

/** The list's date. */
export const UNIVERSE_AS_OF = "2026-11-10";

/** The rule the list was drawn by. */
export const UNIVERSE_RULE =
  "the S&P 100's members on the list's date, plus named former giants that still trade, cut from the smallest up until a cold read fits five minutes; at most 100";

/** The companies, never `SPY`, each written as `normalizeSymbol` writes it. */
export const UNIVERSE = Object.freeze([
  "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "AMD", "INTC", "CSCO", "ORCL", "QCOM", "TXN", "MU", "AMAT",
  "NFLX", "ADBE", "CRM", "IBM", "JPM", "XOM", "WMT", "JNJ", "BA", "GE", "C", "PFE", "DIS", "NKE", "UNH", "HD", "KO",
  "NVDA",
]);
