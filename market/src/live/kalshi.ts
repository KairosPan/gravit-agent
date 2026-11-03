/** A Kalshi account, read and traded through its trade API v2 (docs.kalshi.com, read 2026-10-05; OpenAPI 3.32.0).
 *
 *   GET /trade-api/v2/portfolio/balance      balance, in cents
 *   GET /trade-api/v2/portfolio/positions    market_positions[]: ticker, position_fp (contracts; negative = NO), market_exposure_dollars (cost)
 *   GET /trade-api/v2/markets?tickers=…      the held markets, for what a position is worth now: Kalshi reports only what it cost
 *
 * Orders (the trader below):
 *
 *   GET    /trade-api/v2/markets/{ticker}                 one market: *_dollars prices, price_ranges (its price grid), status (`active` trades)
 *   GET    /trade-api/v2/markets?status=open&…            the list a search runs over
 *   GET    /trade-api/v2/exchange/status                  whether Kalshi is taking orders now, per exchange shard
 *   GET    /trade-api/v2/api_keys                         the key's own scopes: `write` or `write::trade` places orders, `read` alone does not
 *   POST   /trade-api/v2/portfolio/events/orders          place (the V2 endpoint; the old /portfolio/orders writes were removed in June 2026)
 *   DELETE /trade-api/v2/portfolio/events/orders/{id}     cancel, with ?market_ticker= so Kalshi routes it to the market's shard
 *   POST   /trade-api/v2/portfolio/events/orders/{id}/amend   a resting order's price or size changed in place (amend-order-v2.md)
 *   GET    /trade-api/v2/portfolio/orders/{id}            what became of it: resting, executed, canceled
 *   GET    /trade-api/v2/portfolio/orders?ticker=         the orders on one market: those resting (a sell counts them), one by its client id
 *   GET    /trade-api/v2/portfolio/fills?order_id=        the price of each fill, in YES and in NO terms, and its fee
 *   GET    /trade-api/v2/portfolio/positions?count_filter=position   what is held, for the trader's positions
 *   GET    /trade-api/v2/markets?tickers=…                those positions' markets, for their names and prices
 *
 * Reading the market (nothing signed for but the request itself, nothing placed):
 *
 *   GET    /trade-api/v2/markets?min_close_ts=&max_close_ts=   the markets closing within a window (get-markets.md)
 *   GET    /trade-api/v2/events?tickers=…                 the events those markets belong to, for their category
 *   GET    /trade-api/v2/markets/candlesticks?market_tickers=   a market's price history (batch-get-market-candlesticks.md)
 *
 * What an order may say (create-order-v2.md): every Kalshi event order is a limit order with a price, and it says how long it stays —
 * good_till_canceled, immediate_or_cancel or fill_or_kill, which V2 requires; a good-till-canceled one may carry an `expiration_time`, which
 * is how a day order is sent. It may be post_only, and reduce_only when it fills at once. Kalshi has no stop orders on event contracts.
 *
 * Each request carries three headers: the key's id, a millisecond timestamp, and a signature over `timestamp + METHOD + path` — the path
 * with its `/trade-api/v2` prefix and without the query string, the body never signed — made with the private key that came with the id:
 * RSA-PSS (SHA-256, MGF1 SHA-256, salt as long as the digest) for an RSA key, the string signed directly for an Ed25519 one. The private
 * key is a PEM file the key file points to; it is read in this process and used for nothing but these signatures.
 *
 * Kalshi's API has no call that moves money in or out: this connection could not start a deposit or a withdrawal if it wanted to. An order
 * moves dollars into contracts and back, inside the Kalshi account.
 */
// Trimmed copy of account/src/portfolio/live/kalshi.ts at 20ead850 (account split, plan A1): the market's own from here.
import { limitOf, utcDay } from "./history.ts";
import { INTERVAL_MS, type Candle, type CandleInterval, type CandlePage, type CandleWindow } from "./trade.ts";

// ---- trading -----------------------------------------------------------------------------------------

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
