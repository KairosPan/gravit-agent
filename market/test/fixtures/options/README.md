# Option fixtures (Task 2), read once 2026-11-22 ~05:30–06:10 UTC (Sunday; US and crypto option markets: crypto trading, US closed)

One reply per URL, sequential, browser user agent; Nasdaq with `Accept: application/json`. No 403/429/451 met.
`deribit-btc.json`, `okx-btc.json`, `nasdaq-aapl.json` are the earlier probe's replies (same session).
`okx-opt-summary.json`, `okx-open-interest.json`, `okx-instruments.json` and `okx-btc.json` itself are TRIMMED to the three nearest expiries of the BTC-USD tickers (the same instIds in each); `deribit-eth.json` to its first 300 rows.
`deribit-usdc.json` is TRIMMED to its first 240 SOL_USDC/XRP_USDC rows (the full reply was 2 MB, 3,322 options).

## Facts for the later tasks
- Deribit `get_book_summary_by_currency?kind=option`: BTC (1,036) and ETH as inverse options named `BTC-26MAR27-40000-C` (prices in the coin);
  linear USDC options under `currency=USDC`, named `SOL_USDC-<date>-<strike>-C` (bases AVAX, BTC, ETH, HYPE, SOL, TRX, XRP; prices in USDC;
  strikes may carry a `d` for a decimal point, e.g. `XRP_USDC-…-2d2-C`, check the fixture). Fields: bid_price, ask_price, last, mark_price,
  mark_iv, open_interest, volume, volume_usd, price_change (24 h percent), underlying_price, underlying_index, estimated_delivery_price.
- Deribit `get_currencies` lists every currency (not only those with options): use the book summaries to know which have options.
- OKX `market/tickers?instType=OPTION&instFamily=BTC-USD`: 954 contracts `BTC-USD-261218-44000-C`, bidPx/askPx/last in the coin, vol24h; no IV, no OI.
- OKX `public/opt-summary?instFamily=BTC-USD`: keyless; per contract `markVol` (IV as a fraction, 0.567 = 56.7 %), bidVol, askVol,
  delta/gamma/vega/theta, fwdPx. IV for OKX legs = markVol × 100.
- OKX `public/open-interest?instType=OPTION&instFamily=BTC-USD`: keyless; per contract `oi` (contracts), `oiCcy` (coin), `oiUsd`.
- OKX `public/instruments?instType=OPTION&instFamily=BTC-USD`: 970 KB; `ctVal` (contract size, a fraction of a coin), `expTime`, `stk`.
- OKX `market/index-tickers?instId=BTC-USD`: `idxPx` 59395.5.
- Nasdaq `option-chain`: default = near the money, nearest expiries, 20 rows a page; `filterlist.fromdate` values are month ranges
  ("2026-12-02|2026-12-31"); asking `fromdate=2026-12-02&todate=2026-12-31&money=all&type=all&limit=60&offset=0` gave totalRecord 400,
  60 rows a page (page with `offset`), expiry groups "December 2, 2026", "December 4, 2026". Rows: an `expirygroup` header row, then
  strike rows with c_*/p_* cells; "--" for none. No IV. `lastTrade`: "LAST TRADE: $342.56 (AS OF NOV 20, 2026)".
- Nasdaq takes a single date (`fromdate` = `todate`, read 2026-11-22 by the controller): `nasdaq-aapl-single-date.json` is AAPL's
  `fromdate=2026-12-18&todate=2026-12-18&money=all&type=all&limit=60&offset=0`, HTTP 200, totalRecord 103, every row in the group
  "December 18, 2026" (its first page, 60 rows). A chain asks its expiry this way; the month ranges are scanned with `money=at` only for their groups.
- Nasdaq no-options reply (BRK.A): HTTP 200, `data.totalRecord` 0, rows null, `message` "Options are not available for this symbol".

## Log (UTC time, status, file, URL)
2026-11-22T02:57:23Z 200 deribit-currencies.json https://www.deribit.com/api/v2/public/get_currencies
2026-11-22T02:57:24Z 200 deribit-eth.json https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=ETH&kind=option
2026-11-22T02:57:25Z 200 okx-instruments.json https://www.okx.com/api/v5/public/instruments?instType=OPTION&instFamily=BTC-USD
2026-11-22T02:57:27Z 200 okx-opt-summary.json https://www.okx.com/api/v5/public/opt-summary?instFamily=BTC-USD
2026-11-22T02:57:28Z 200 okx-open-interest.json https://www.okx.com/api/v5/public/open-interest?instType=OPTION&instFamily=BTC-USD
2026-11-22T02:57:29Z 200 okx-index.json https://www.okx.com/api/v5/market/index-tickers?instId=BTC-USD
2026-11-22T02:57:46Z 200 nasdaq-aapl-expiry.json https://api.nasdaq.com/api/quote/AAPL/option-chain?assetclass=stocks&limit=60&offset=0&fromdate=2026-12-02&todate=2026-12-31&money=all&type=all
2026-11-22T02:57:52Z 200 nasdaq-none.json https://api.nasdaq.com/api/quote/BRK.A/option-chain?assetclass=stocks&limit=20
2026-11-22 (controller) 200 nasdaq-aapl-single-date.json https://api.nasdaq.com/api/quote/AAPL/option-chain?assetclass=stocks&limit=60&offset=0&fromdate=2026-12-18&todate=2026-12-18&money=all&type=all
2026-11-22T02:57:54Z 200 deribit-usdc.json https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=USDC&kind=option
