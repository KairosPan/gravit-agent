// face/plugins/analog/lib/universe.mjs
/**
 * A list of today's large US companies, the date it was drawn and the rule it was drawn by. It was drawn for the
 * chart scan, withdrawn on 2026-11-13; nothing in this plugin reads it now, and the read-through rows
 * (`face/plugins/readthrough/`) fence their peers by it. Companies that failed or were delisted are missing from it.
 */

/** The list's date. */
export const UNIVERSE_AS_OF = "2026-11-11";

/** The rule the list was drawn by. */
export const UNIVERSE_RULE =
  "the S&P 100's members on the list's date, plus named former giants that still trade, cut from the smallest up until a cold read fits five minutes; at most 100";

/** The companies, never `SPY`, each written as `normalizeSymbol` writes it. */
export const UNIVERSE = Object.freeze([
  "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "AMD", "INTC", "CSCO", "ORCL", "QCOM", "TXN", "MU", "AMAT",
  "NFLX", "ADBE", "CRM", "IBM", "JPM", "XOM", "WMT", "JNJ", "BA", "GE", "C", "PFE", "DIS", "NKE", "UNH", "HD", "KO",
  "NVDA", "T", "VZ", "F", "GM",
  "LLY", "BRK.B", "V", "MA", "ABBV", "COST", "CVX", "PG", "PLTR", "MRK", "BAC", "PM", "LRCX", "CAT", "PANW", "TMO", "RTX",
  "GS", "WFC", "AMGN", "LIN", "MS", "GEV", "GILD", "MCD", "ANET", "PEP", "ABT", "NEE", "UNP", "BLK", "DE", "AXP", "ISRG",
  "COP", "ACN", "SCHW", "DHR", "UBER", "LOW", "SNDK", "BMY", "MO", "MDT", "SBUX", "BKNG", "COF", "LMT", "CVS", "SO",
  "NOW", "DELL", "BNY", "DUK", "MMM", "USB", "EMR", "INTU", "GD", "AMT", "CMCSA", "MDLZ", "UPS",
]);
