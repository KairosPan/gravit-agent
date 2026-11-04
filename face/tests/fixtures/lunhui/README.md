# Lunhui market fixtures

**Synthetic.** Every price, volume, amount and time in these files is made up; nothing here was
fetched from the network. They stand in for the two Tencent endpoints the Lunhui market module
reads (`face/plugins/lunhui/lib/market.mjs`), for `tests/lunhui-market.test.ts` and for a freeze
row given this directory as its `config.fetch` (spec 2026-10-25 A15). The security names are the real ones; the
numbers are not those securities' prices.

- `quotes.gb18030.txt` — one `qt.gtimg.cn` reply as raw bytes, GB18030-encoded, one
  `v_<symbol>="…";` line each for the four indices `sh000001`, `sz399001`, `sz399006`,
  `sh000300` and the four main-board stocks `sh600519`, `sz000001`, `sh601318`, `sz000333`.
  Each line is the 55-field `~` layout of the `quote()` helper in the source branch's
  `frontend/test/market-provider.test.mjs`: 0 market (`1` Shanghai, `51` Shenzhen), 1 name,
  2 code, 3 last, 4 previous close, 5 open, 6 volume in lots, 30 provider time, 31 change,
  32 change %, 33 high, 34 low, 37 amount in 10,000 CNY; every other field empty. The provider
  time is 15:00:0x China time on 2026-10-12, the close of the last trading day before the
  freeze instant the test uses (2026-10-13 09:00:33 China time, pre-open).
- `kline-<symbol>.json` — one `web.ifzq.gtimg.cn` `fqkline/get` reply per symbol, the shape of
  that file's `kline()` helper: `{"code":0,"data":{"<symbol>":{"<key>":[[date, open, close,
  high, low, volume in lots], …]}}}`, 60 trading days of the 2026 SSE calendar from 2026-07-13
  to 2026-10-12. The four stock files are keyed `qfqday`, the reply to the module's `qfq`
  request; the four index files are keyed `day`, as real index replies are, so their bars parse
  with adjustment `none`. The last bar agrees with the symbol's quote line (open, close, high,
  low, volume; the quote's previous close is the bar before).
- `minutes-<symbol>.json` — one `web.ifzq.gtimg.cn` `day/query` minute-line reply per index
  (`sh000001`, `sz399001`, `sz399006`, `sh000300`): `{"code":0,"data":{"<symbol>":{"data":[{date,
  prec, data: ["HHMM price cumVolume cumAmount", …]}, …]}}}`, five days 20261023 back to 20261019,
  each the 242 points of the grid with the same made-up curve off its `prec`. Synthetic, like
  everything here: `make-minutes.mjs` writes them (`node face/tests/fixtures/lunhui/make-minutes.mjs`,
  no clock, no randomness), and its header gives the formula; edit the script and rerun it rather
  than the files.

`fetch.ts` serves them through `createFixtureFetch` (`face/plugins/lunhui/lib/fixture-fetch.mjs`),
the one mapping a row's `config.fetch` uses too: a URL whose host is `qt.gtimg.cn` gets
`quotes.gb18030.txt` as bytes, a URL whose host is `web.ifzq.gtimg.cn` and whose `param` starts
with `<symbol>,` gets `kline-<symbol>.json`, a URL on that host whose path is
`/appstock/app/day/query` gets `minutes-<code>.json`, any other URL a 404. The sibling directory
`../lunhui-empty/` holds no replies at all, so a fetch served from there answers every URL with a
404.

`account.ts` is a fake market over the same mapping (its name kept from before plan A2), for the
freeze tests of a row mounted with no `config.fetch`, whose fetch is the market's: it answers `GET /api/cn/relay?url=` with the
mapped reply for the decoded URL (status, bytes, `content-type`, `location`) marked
`x-cn-relay: upstream`, and `POST /api/cn/ifind` with `wencai-universe.json` marked
`x-cn-ifind: upstream` (or the `unconfigured` refusal), recording every request it is sent.
