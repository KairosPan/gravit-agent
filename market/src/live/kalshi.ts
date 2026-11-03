/** Kalshi's candles, as its trade API v2 answers them (docs.kalshi.com, read 2026-10-05; OpenAPI 3.32.0): what the market keeps of the
 * account's Kalshi module, which also reads and trades a Kalshi account. Here nothing is signed for and nothing is placed: only how a
 * window of history becomes Kalshi's candlestick requests.
 *
 *   GET    /trade-api/v2/markets/candlesticks?market_tickers=   a market's price history (batch-get-market-candlesticks.md)
 *
 * The account's original (its header names the account, order and fill endpoints, the order rules and the request signature) stays in
 * account/src/portfolio/live/kalshi.ts.
 */
// Trimmed copy of account/src/portfolio/live/kalshi.ts at 20ead850 (account split, plan A1): the market's own from here.
import { limitOf, utcDay } from "./history.ts";
import { INTERVAL_MS, type Candle, type CandleInterval, type CandlePage, type CandleWindow } from "./trade.ts";

// ---- candles -----------------------------------------------------------------------------------------

/** Kalshi keeps candles of 1, 60 and 1440 minutes (get-market-candlesticks.md; asked for 5 it answers none — OBSERVED): every other size is
 * the finer one it keeps folded together — five and fifteen minutes from one-minute candles, four hours from hourly ones, a week (from
 * Monday, UTC) from daily ones */
export const PERIOD_MIN: Readonly<Record<CandleInterval, number>> = { "1m": 1, "5m": 1, "15m": 1, "1h": 60, "4h": 60, "1d": 1440, "1w": 1440 };

/** the most candles Kalshi answers a request: it counts them over the span asked, whatever the market traded — start_ts=1 answered "requested
 * candlesticks across all markets: 29870400, max candlesticks: 10000", a span of 10,001 minutes "10001", and a start of 0 "start_ts is
 * required" (HTTP 400 each, live 2026-10-17) — so a request asks 9,999 periods at most */
export const KALSHI_CANDLES_MOST = 9_999;
/** how many such requests one window takes at most: an older part is left for scrolling left */
export const KALSHI_SPANS = 6;

/** A WINDOW AS KALSHI'S CANDLESTICK REQUESTS: from the later of the window's start (a page with none: `limit` bars before its end, 300 at
 * most a thousand), its latest `limit` bars (HISTORY_MOST at most: live/history.ts limitOf), the market's open where it is known (`openMs`)
 * and one second, to its end (`endTs`, seconds, as the caller rounds it), cut into spans of KALSHI_CANDLES_MOST periods at most, newest
 * first, KALSHI_SPANS at most. `cut`: an older part of what was asked is left out (the answer says older bars exist); `opened`: the market
 * opened after the start asked (the answer says where its history starts); `wide`: one request does not hold the window from its start
 * asked — the caller learns the market's open first and asks again, so a short window costs no lookup */
export function kalshiSpans(interval: CandleInterval, w: CandleWindow, endTs: number, openMs?: number): { spans: Array<{ start: number; end: number }>; cut: boolean; opened: boolean; wide: boolean } {
  const G = INTERVAL_MS[interval];
  const period = PERIOD_MIN[interval] * 60;
  const end = endTs * 1000;
  const want = w.since ?? end - Math.min(w.limit ?? 300, 1_000) * G;
  const latest = w.since === undefined ? Number.NEGATIVE_INFINITY : end - limitOf(w) * G;
  const opened = openMs !== undefined && openMs > want;
  const from = Math.max(1_000, want, latest, openMs ?? 0);
  const start = Math.floor(from / 1000);
  const wide = (endTs - Math.floor(Math.max(1_000, want) / 1000)) / period > KALSHI_CANDLES_MOST;
  const spans: Array<{ start: number; end: number }> = [];
  let e = endTs;
  for (; e > start && spans.length < KALSHI_SPANS; e -= KALSHI_CANDLES_MOST * period) spans.push({ start: Math.max(start, e - KALSHI_CANDLES_MOST * period), end: e });
  return { spans, cut: latest > Math.max(want, openMs ?? 0) || e > start, opened, wide };
}
/** KALSHI'S BARS AS A PAGE (both readers: this trader's and the public one, live/public-markets.ts): older bars said to exist where the
 * spans left an older part of the window out, a request after the first was refused (`partial`), or a page scrolled left brought any; where
 * the market opened after the start asked, its history said to start at its first bar. A window asked whole in one request is the plain
 * list it always was (live/history.ts pageOf reads it the same way) */
export function kalshiPage(bars: Candle[], asked: { cut: boolean; opened: boolean }, w: CandleWindow, partial: boolean, market: string): Candle[] | CandlePage {
  const sorted = bars.sort((a, b) => a.t - b.t);
  if (!asked.cut && !asked.opened && !partial) return sorted;
  const more = partial || (!asked.opened && (asked.cut || (w.since === undefined && sorted.length > 0)));
  const ends = asked.opened && !partial ? (sorted.length ? `${market} history starts ${utcDay(sorted[0]!.t)}` : `${market} market had not opened by then`) : undefined;
  return { bars: sorted, more, ...(partial ? { partial: true as const } : {}), ...(ends ? { ends } : {}) };
}
