# Region fixtures (Task 3), read once 2026-11-22 ~05:00 UTC (Saturday night in Asia; every market closed; last session Friday 2026-11-20)

Each file is one reply's bytes as received. One GET per URL, sequential, browser user agent; Eastmoney with `Referer: https://quote.eastmoney.com/`. No 403 or 429 was met.

## Facts for the later tasks
- Tencent `hk_rank.php`: `list_data={"code":0,...,"data":{"page_data":["code~name~last~chg%~chg~?~?~volume~turnover~open~prev~high~low~turnover%", ...]}}`; names are JS escapes of Chinese (JSON-decodable). No movers metric was probed (none named in the reply): movers = re-sort the turnover ranking by absolute change %.
- Tencent smartbox `t=hk`: `v_hint="hk~00700~<escaped name>~tencent~GP^hk~80700~..."` (the 8xxxx line is the RMB counter).
- Tencent quotes: `r_hk00700` lines, GBK; HK and A index lines in the same reply.
- Tencent index kline: `hkfqkline` works for `hkHSI` (`hk-index-kline.json`); `fqkline` (cn-history.ts's KLINE_URL) works for `sh000300` (`cn-index-kline.json`).
- Eastmoney HK list: `data.total` 4,745, includes ETFs (02800 first by turnover); `dlmkts:"8,10,128"` (HK declared delayed, no figure). Index list: all 15 secids answered, including `100.SPX`, `100.NDX`, `100.DJIA`.
- Naver world indices: every one of `.N225 .GDAXI .FTSE .FCHI .STOXX50E .BSESN .TWII .HSI .INX .IXIC .DJI` answered; the delay is `datas[i].stockExchangeType.delayTime` (minutes); values are strings with thousands commas.
- Naver domestic index `KOSPI,KOSDAQ`: both answered, `delayTime` 0.
- Naver KOSPI ranking: no turnover ranking found (`/api/stocks/tradingValue/KOSPI` 404; `quantTop` answered total 0 on 2026-11-19). `marketValue` it is (`totalCount` 2,496; rows mix `stockEndType` `stock` and `etf`; each row carries `accumulatedTradingValueRaw`). No English name field: `stockName` is Korean only.
- Naver domestic quotes: `delayTime` 0 under `stockExchangeType`.
- Naver search `q=samsung` returns world listings (Hong Kong ETFs first); a Korean share is found by `typeCode`/`nationCode` KOR.
- TWSE `STOCK_DAY_ALL`: 1,393 rows, ETFs included (codes starting `00`, e.g. `00400A`); `Date` in ROC form `1151120`; numbers as strings.
- TWSE MIS: took three symbols in one ask; no batch limit stated in the reply (`userDelay` 5000): batch 50 stands. `z` last, `y` prev close, `o` open, `h` high, `l` low, `v` volume (lots), `tlong` ms epoch, `d` date.
- TWSE `STOCK_DAY` (www.twse.com.tw): `stat` "OK", one month per ask, ROC dates `115/11/02`, comma numbers.

## Log (UTC time, status, file, URL)
2026-11-21T21:01:14Z 200 hk-rank.txt https://stock.gtimg.cn/data/hk_rank.php?board=main_all&metric=amount&pageSize=50&reqPage=1&order=decs&var_name=list_data
2026-11-21T21:01:16Z 200 tencent-quotes.txt https://qt.gtimg.cn/q=r_hk00700,r_hk09988,hkHSI,hkHSCEI,hkHSTECH,sh000001,sz399001,sh000300,sz399006,sh000688
2026-11-21T21:01:19Z 200 hk-kline.json https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=hk00700,day,,,320,qfq
2026-11-21T21:01:21Z 200 hk-minute.json https://web.ifzq.gtimg.cn/appstock/app/hkMinute/query?code=hk00700
2026-11-21T21:01:22Z 200 hk-search.txt https://smartbox.gtimg.cn/s3/?v=2&q=tencent&t=hk
2026-11-21T21:01:25Z 200 hk-index-kline.json https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=hkHSI,day,,,320,qfq
2026-11-21T21:01:41Z 200 cn-index-kline.json https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000300,day,,,250,qfq
2026-11-21T21:01:43Z 200 em-hk-list.json https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f6&fs=m:128+t:3,m:128+t:4,m:128+t:1,m:128+t:2&fields=f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18&ut=bd1d9ddb04089700cf9c27f6f7426281
2026-11-21T21:01:45Z 200 em-indices.json https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=100.HSI,100.HSCEI,124.HSTECH,100.N225,100.KS11,100.KOSPI200,100.TWII,100.SENSEX,100.SX5E,100.GDAXI,100.FTSE,100.FCHI,100.SPX,100.NDX,100.DJIA&fields=f2,f3,f4,f12,f14,f18,f124&ut=bd1d9ddb04089700cf9c27f6f7426281
2026-11-21T21:01:48Z 200 em-kline.json https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.N225&klt=101&fqt=1&lmt=320&end=20500101&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57
2026-11-21T21:02:00Z 200 naver-world.json https://polling.finance.naver.com/api/realtime/worldstock/index/.N225,.GDAXI,.FTSE,.FCHI,.STOXX50E,.BSESN,.TWII,.HSI,.INX,.IXIC,.DJI
2026-11-21T21:02:02Z 200 naver-domestic-index.json https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI,KOSDAQ
2026-11-21T21:02:05Z 200 naver-kospi-value.json https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=1&pageSize=100
2026-11-21T21:02:08Z 200 naver-kr-chart.json https://api.stock.naver.com/chart/domestic/item/005930?periodType=dayCandle
2026-11-21T21:02:10Z 200 naver-index-chart.json https://api.stock.naver.com/chart/foreign/index/.N225?periodType=dayCandle
2026-11-21T21:02:13Z 200 naver-search.json https://ac.stock.naver.com/ac?q=samsung&target=stock
2026-11-21T21:02:15Z 200 naver-kr-quotes.json https://polling.finance.naver.com/api/realtime/domestic/stock/005930,000660
2026-11-21T21:02:26Z 404 naver-try-tradingvalue.json https://m.stock.naver.com/api/stocks/tradingValue/KOSPI?page=1&pageSize=20
2026-11-21T21:02:37Z 200 twse-day-all.json https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL
2026-11-21T21:02:38Z 200 twse-mis.json https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw|tse_2330.tw|tse_2317.tw&json=1&delay=0
2026-11-21T21:02:40Z 200 twse-stock-day.json https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20261101&stockNo=2330
