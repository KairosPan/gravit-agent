# Lunhui Eastmoney fixtures

**Synthetic.** Every code, name, price, amount and time in these files is made up; nothing here
was fetched from the network. They stand in for the Eastmoney endpoints the Lunhui freezes read
(`face/plugins/lunhui/lib/eastmoney.mjs`), for `tests/lunhui-eastmoney.test.ts` and for a freeze
row given this directory as its `config.fetch` (spec 2026-10-25 A15). The codes follow the
exchanges' prefixes (`600`/`603` Shanghai, `000`/`002`/`300` Shenzhen); the names, `示例…`, are
no real security's.

Each pool file is one `push2ex.eastmoney.com` reply in the live shape: `rc`, `rt`, `svr`, `lt`,
`full` and `data: { tc, qdate, pool: [...] }`, the session 2026-10-23 (`qdate` 20261023). Prices
(`p`, `ztp`) are in thousandths of a yuan, as Eastmoney sends them; times (`fbt`, `lbt`, `yfbt`)
are `HHMMSS` integers; `zttj` is `{ days, ct }`.

- `zt-pool.json` — `getTopicZTPool`, the 涨停池: six rows with the keys `c m n p zdp amount ltsz
  tshare hs lbc fbt lbt fund zbc hybk zttj`; 连板数 (`lbc`) 1, 2, 3 and 5, so the streak
  distribution has several buckets.
- `zb-pool.json` — `getTopicZBPool`, the 炸板池: three rows with the keys `c m n p ztp zdp amount
  ltsz tshare hs fbt zbc zf zs zttj hybk`; two of them (`000102`, `002104`) are in the 涨停池 too,
  so the seal and break ratios derived from the two pools are not trivial.
- `yesterday-pool.json` — `getYesterdayZTPool`, 昨日涨停 today: five rows with the keys `c m n p
  ztp zdp amount ltsz tshare hs zf zs yfbt ylbc hybk zttj`; today's change (`zdp`) runs from
  -6.05 to 10.04, so the median and the negative tail are not trivial.

`createFixtureFetch` (`face/plugins/lunhui/lib/fixture-fetch.mjs`) serves this directory: a URL
whose host is `push2ex.eastmoney.com` gets the pool file its path names (`/getTopicZTPool`,
`/getTopicZBPool`, `/getYesterdayZTPool`); a `push2.eastmoney.com/api/qt/clist/get` URL gets the
board, member, fund-flow or count-page file its `fs` names, files the boards task adds; any other
URL, or a file the directory does not hold, a 404. The redirect to `push2delay.eastmoney.com` is
not a fixture: the tests hand `fetchEastmoneyJson` a small fake `fetch` for it.
