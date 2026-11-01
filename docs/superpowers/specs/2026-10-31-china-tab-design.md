# The China tab: A shares on Markets, on the face's own wire (interim)

Design, 2026-10-31. Status: approved by the operator 2026-10-31 ("批准"). Brainstormed with the operator
in one session (mockups in the brainstorming companion, `.superpowers/brainstorm/`, git-ignored).

## 1. Why

The operator, 2026-10-31: "底层的市场接口接了那么多，但是market部分还是没有显示出来，而且搜索功能也不是很好用".

What was measured that morning, on the live pair (face 3090, Account 4820):

- Every wire answers. Markets draws the Account's 153 markets (33 crypto, 24 US stocks, 74 RWAs, 9
  pre-IPO, 13 predictions), BTC's page draws its candles, the face's Tencent quotes and search answer.
- Not one A share appears on an unstarred browser. Markets' rows are the Account's explore read plus
  the face's `cn:` rows, and those come only from this browser's starred list or from search hits
  (`host/market-view.js` `unsortedRowsOf`). The Stocks tab is US stocks.
- The A-share page (`#/markets/cn:600519`) is a price, previous close, volume and source. It has no
  chart, it says "as of Oct 30 04:14 · Stale" on a Saturday (New York time, and Stale instead of
  Closed), and its tile is the code's first four digits.
- The A-share sources wired since 2026-10-25 (Tencent quotes, minutes and daily bars; Eastmoney
  boards, limit-up pools and counts; iFinD 问财) feed Gravit's Lunhui rows and the composed answer.
  None reaches the Markets screen.
- Root cause: `DEVELOPMENT.md` §10 item 22, "A shares into the Account box" (decided 2026-10-27),
  has no design yet. Until it lands, the face's own A-share wire was kept for stars and search hits
  alone.

Offered the choice between building item 22 now and an interim on the face's own wire, the
operator chose the interim: "先做 face 临时版". This document is that interim. Item 22 replaces it.

The search half of the complaint has its own fix: the A-share search dropped every STAR Market
listing (Tencent files them as `GP-A-KCB`, the parser admitted only `GP-A`). That fix is commit
237209be ("fix: the A-share search keeps the STAR Market's listings", one test,
`face/src/symbol-search.ts`, the `DEVELOPMENT.md` route-table row), fast-forwarded into local main on
2026-10-31 on the operator's word ("先合并修复"). This build branches from that main.

## 2. What the operator decided

1. **A tab named China in the Markets tab row, at the very end.** They first put it leftmost
   ("crypto、pre-ipo那一栏的最左边是china"), then, after seeing it there, moved it: "China放在最末尾".
2. **Its content is one ranking table, the same shape as the Account's tabs.** Shown three versions
   (A: the table alone; B: an index strip above the table; C: indices, breadth and boards above the
   table), they chose A: "A吧". No index strip, no index rows, no boards, no breadth.
3. **The eight details on the annotated mockup**, "基本上都对", with the position corrected. They are
   §4 below.
4. **The A-share page as mocked**: "非常对". It is §5 below.

Everything else here is marked either as my call (the operator can overrule it while reading) or as
the builder's.

## 3. Goals, non-goals, anti-goals

**Goals**

- Every A share Tencent ranks is reachable from Markets without starring or searching first.
- The day's most traded and biggest-moving A shares are visible at a glance, in the same table the
  other tabs use.
- An A share's page carries the facts an A-share reader looks at and a price history, the way an
  Account market's page does.

**Non-goals**

- Indices anywhere: no strip, no index rows, no index pages, no index search.
- Boards (industry or concept), market breadth, limit-up ladders. These were version C, not chosen.
- Trading A shares. There is no Buy or Sell: the Account cannot trade A shares.
- Moving A shares into the Account (item 22), or changing the Account's tabs, reads or page.
- Search changes beyond the STAR fix: ETFs, B shares, Beijing listings by code, and Chinese names of
  US stocks or crypto all stay as they are.
- Any change to the Lunhui rows, Gravit's tools, `GRAVIT.md` or the composed answer.

**Anti-goals** (would make this a failure even if it works)

- The face reading or polling anything for China while Markets is not on screen.
- Asking the Account for a `china` tab. The Account has no such tab, and `explore?tab=china` must
  never be sent.
- Polling iFinD (quota) or Eastmoney (its push2 lists fail from this network every day, measured by
  the Lunhui drills 2026-10-26..28).
- The face importing from `face/plugins/`. It never does (`face/src/lunhui-view.ts` states the rule);
  a helper from the Lunhui library is copied, not imported.
- A second watchlist. The China table's stars are the existing `cn:` stars.

## 4. The China tab

1. **Position.** Last in the tab row, after Predictions. When the Watching tab shows (anything is
   starred), China sits before Watching. *My call:* Watching stays the row's closing tab, as the
   Account's own page orders it. While a query is typed, All results leads the row as today.
2. **Default tab.** Markets still opens on All. *My call:* China is no longer the first tab, so it is
   not the default (the mockup's guess 1 assumed it was leftmost).
3. **Count.** `China · 5,577`: the ranking read's total, every A share Tencent ranks, Beijing
   listings included (5,577 on 2026-10-30's close). No count until the first ranking read answers, as
   with the Account's tabs before All's read.
4. **Rows.** The top 20 of the sort in effect. Two sorts, the other tabs' words:
   - *Most traded*: by turnover (成交额), largest first.
   - *Biggest moves*: by the size of the day's change, gainers and losers together. Limit-up and
     limit-down rows both rank near the top.
5. **Columns.** The star; Market (a round tile with the name's first character, the name, and under
   it the code and the board: `SH`, `SZ`, `ChiNext`, `STAR` or `BJ`); Price in yuan; Today (the
   change against the previous close, in percent); Turnover; Source (`Tencent`). On China the column
   headers read Today and Turnover; the Account's tabs keep 24h and Volume.
   - *My call:* Turnover is written in the run view's yuan grammar (`render/lunhui/block.js`
     `yuan`: `¥216.10亿`, `¥1.67万亿`). The mockup wrote `216.1亿`. One grammar for yuan across the
     face beats a second.
   - *My call:* the tile change (name's first character, not the code's first four digits) applies
     to every `cn:` row and page, not only China's.
6. **Colours.** The face's own: green up, red down.
7. **Refresh.** One read when China comes on screen, then every 20 seconds while it stays on screen
   in a visible tab, and nothing otherwise. That is the Account explore poll's rule
   (`host/markets.js` `EXPLORE_MS`).
8. **Closed.** When Tencent says the A-share market is closed, a muted line above the table says
   Closed with the last session's date and close in Beijing time (for example
   `Closed · 10-30 15:00 Beijing`). The rows are that session's. No Stale anywhere on China.
9. **Stars.** A row's star is the existing `cn:` star (this browser's list). A starred A share keeps
   appearing under All and Watching. China shows the ranking alone; a starred share inside the top 20
   shows a filled star.
   - *My call:* starred A shares leave the Stocks tab, and Stocks stops counting them. Stocks becomes
     the Account's stocks alone, because China is now the A shares' home.
10. **A row opens the A-share page** (§5), knowing the share's name and board from its row.
11. **Search is unchanged.** The box searches the Account and the A shares together into All results,
    with the STAR fix.
12. **Failure.** A ranking read that fails leaves the last rows in place with a muted line saying so.
    With no rows yet, the table says Loading… or that China is unavailable, as the other tabs do.
    The words are the builder's.

## 5. The A-share page

Approved as mocked (`china-stock-page.html` in the companion, Moutai on 10-30):

- **Head.** As today (`‹ Markets`, the tile, the name, `A-share · 600519 · SH`, Hand to Gravit,
  Watch), with the name's first character on the tile.
- **Price line.** The price, the change against the previous close. Under it, the source and state
  in Beijing time: `Tencent · Live` during the session, `Tencent · Closed · 10-30 15:00 Beijing`
  outside it. No Stale and no New York time on this page. The cases the mockup did not show are
  my calls (the builder check asked):

  | When | The state line |
  |---|---|
  | Continuous trading, the quote at most 5 minutes old | `Tencent · Live` |
  | Continuous trading, the quote older than 5 minutes | `Tencent · Delayed · <last trade time> Beijing` |
  | The face's wire failing (stream and fallback read both down) | `Quotes unavailable`, the last price kept (the wire's existing word) |
  | Halted, where Tencent marks it | `Tencent · Halted` (the builder finds the mark: the ranking's `state`, or the quote's own field; none found, no word) |
  | The midday break, 11:30–13:00 Beijing on a trading day | `Tencent · Midday break · 11:30 Beijing` |
  | Before the open, after the close, a weekend or a holiday | `Tencent · Closed · <last session's date> 15:00 Beijing` |

  Open or closed comes from `marketStat` (§6); the midday break and the open's minutes come from
  the Beijing clock, because `marketStat`'s form at lunch is unmeasured. When `marketStat` does not
  parse, the Beijing clock decides alone: a weekday inside 09:30–11:30 or 13:00–15:00 counts as open,
  anything else as closed. A holiday then reads open, and its old quote reads Delayed. That is
  acceptable for a fallback, and it never prints Stale or New York time. The line above the China
  table says the same words, once, for the whole table: Closed, Midday break or Delayed. It says
  nothing while every row is live.
- **Facts card**, twelve: Previous close, Open, High, Low, Turnover, Turnover rate, Market cap,
  P/E (TTM), Limit up, Limit down, Volume, Amplitude. All twelve come from the same Tencent quote the
  page already polls, so the card needs no extra request. Volume is written in 万股 or 亿股, the
  approved mockup's form (`599万股`); Turnover and Market cap use the yuan grammar of §4.5.
- **Price history.** The Account market page's range pills (1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX).
  1D is the default range. Outside the session, 1D shows the last session.
  - **1D** is the session chart the approved mockup draws: the fixed 09:30–15:00 grid (242
    minutes), so a chart read at 10:30 fills only its first hour. The previous close is a dashed
    line. The scale is the day's own range, the previous close included, never the limit prices.
    The axis reads `09:30 · Previous close · Low · High · 15:00`. Points Tencent sends past 15:00
    are dropped. The face already draws exactly this chart: `render/lunhui/intraday.js`
    `intradaySvg`, scaled to the stock's own day since 9bcdcde7. *My call:* reuse it rather than
    teach `render/chart.js` a session grid. Its minute-amount bars are the builder's choice; the
    approved mockup had none.
  - **5D** *(my call)*: the five sessions' minutes on one fixed grid of five sessions, with the day
    boundaries marked and the five dates on the axis. The dashed line is the previous close before
    the first of the five.
  - **1M to MAX** *(my call)*: forward-adjusted (前复权) daily closes, drawn by `render/chart.js`
    `candlesSvg` taught a yuan unit and Beijing dates on its axis. The Account's charts must not
    change. The builder may use weekly or monthly bars for 5Y and MAX.
- **Gravit on it.** The conversations that name the share, as today.
- **No Buy or Sell.**

## 6. Measured facts the build rests on (2026-10-30/31, from this network)

- **Ranking.** `GET https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList?_appver=11.17.0&board_code=aStock&sort_type=<turnover|priceRatio>&direct=<down|up>&offset=0&count=<n>`
  answers JSON
  `{code: 0, data: {total, rank_list: [{code: "sh600519", name, zxj, zdf, turnover, volume, hsl, pe_ttm, zsz, ltsz, zf, lb, state, stock_type, …}]}}`.
  - `zxj` is the price, `zdf` the change in percent, `turnover` the 成交额 in 万元.
  - `stock_type` is `GP-A` (main board), `GP-A-CYB` (ChiNext), `GP-A-KCB` (STAR) or `GP` (Beijing,
    e.g. `bj920306`).
  - `total` was 5,577. `priceRatio` with `down` lists the gainers, with `up` the losers. AKShare's
    `stock_zh_a_spot_tx` reads the same endpoint.
- **Quote.** `https://qt.gtimg.cn/q=sh600519`, GBK. Field 1 name, 3 last, 4 previous close, 5 open,
  6 volume (lots; shares on STAR: `quote-snapshots.ts` decides by turnover), 30 time (Beijing,
  `YYYYMMDDHHMMSS`, runs past the close: 16:14:55 for 600519 on 10-30), 32 change %, 33 high, 34 low,
  37 turnover (万元), 38 turnover rate %, 39 P/E TTM (equal to the ranking's `pe_ttm`, 21.18),
  43 amplitude %, 45 total market cap (亿元), 47 limit up, 48 limit down.
- **Market state.** `q=marketStat` in the same request answers, on 2026-10-31 (a Saturday),
  `v_marketStat="2026-10-31 14:16:46|HK_close_已休市|SH_close_已休市|SZ_close_已休市|…|KCB_close_已休市|…|CYB_close_已休市|…"`.
  - It has no Beijing entry; Beijing listings trade the same hours as SH and SZ.
  - Only the closed form is measured. The open form is not, so the builder keys on the token between
    the underscores (`close`, presumably `open`), never on the Chinese words. When neither parses,
    the status stays `unknown`, today's behaviour.
- **Minutes.** `GET https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh600519` returns
  `data[code].data` as five days, newest first, each `{date, prec, data: ["HHMM price cumvol cumamount", …]}`.
  10-30 carried 267 points, 15:01–15:30 included. The Lunhui library parses it
  (`face/plugins/lunhui/lib/market.mjs` `parseTencentMinutes`): copy, do not import.
- **Daily bars.** `GET https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,<n>,qfq`
  returns `data[code].qfqday` as `[date, open, close, high, low, volume]` rows, oldest first (130
  asked, 130 back). `week` and `month` in place of `day` are unmeasured.
- **Ids.** The face's A-share id is `cn:<six digits>`. The exchange follows from the code
  (`quote-snapshots.ts` `tencentCode`: 6 → sh, 0/3 → sz, 4/8/9 → bj), so every ranking row maps to
  exactly one id (`sh688066` → `cn:688066`).

## 7. Server shape (my calls; the builder may rename)

- **`GET /data/cn/rank?sort=volume|movers`** → `{ok, total, asOf, marketStatus, items: [{id, symbol, name, board, price, change_pct, turnover, volume}]}`.
  - Behind the `/data` fence (`http.ts` `isTrustedDataRequest`) like every `/data` route.
  - One Tencent call for `volume`, two for `movers` (gainers and losers, merged by the size of the
    change, 20 kept).
  - Cached per sort for a short TTL, shared by every tab and tab-open. Bodies bounded. Nothing logged.
  - A fixed refusal body on failure.
- **`GET /data/cn/candles?id=cn:<code>&range=<1D…MAX>`**, two shapes by range:
  - 1D and 5D answer the sessions' minutes in the shape `intradaySvg` reads (`{price, amount, prec}`
    per session on the 242-point grid, as the run view's minutes are), with each session's date.
  - 1M to MAX answer `{ok, range, candles: [{t, o, h, l, c}]}`, the Account's candle shape, so
    `candlesSvg` draws them.
- **`/data/quotes` and its stream.** A quote gains `open`, `high`, `low`, `turnover` (yuan),
  `turnover_rate`, `market_cap` (yuan), `pe_ttm`, `limit_up`, `limit_down` and `amplitude`, each a
  number or null. It also gains `market_status` read from `marketStat`. The hub's existing rule then
  says Closed rather than Stale on a closed market (`quotes.ts`: a quote is stale when old *and* the
  market is not closed).

## 8. Relation to other work

- The STAR fix is in main (237209be). This build branches from main and edits the same
  `DEVELOPMENT.md` route table after it, so the two do not conflict.
- `DEVELOPMENT.md` §10 item 22 retires all of this. When A shares move into the Account, China
  becomes one of the Account's own tabs, and `/data/cn/*`, `/data/quotes` and
  `/data/symbols/search` go with the face's wire. Item 22's text gains one line naming this interim.
- The Lunhui rows, the Account, the seat, Gate 2 and Trade are untouched.

## 9. Left to the builder

- Route and field names, TTLs, body limits, the error words.
- Movers ties, and whether halted rows (a non-empty `state`) are left out.
- The bar interval for 5Y and MAX.
- Where the copied minute and bar parsers live.
- The tests' shapes.
- Which document sections change:
  - `DEVELOPMENT.md`'s route table, its Markets sections and §10 item 22;
  - `face/README.md`'s Markets;
  - `CLAUDE.md`'s `face/` row, whose quote-wire sentence names the face's `/data` routes.

## 10. How it is checked

- **Offline tests** over recorded Tencent fixtures: ranking for both sorts with a STAR, a ChiNext and
  a Beijing row and a halted row; `marketStat` in its measured closed form, and an open form marked
  unmeasured; minutes; daily bars.
- **Client tests** (`face/tests/client/`): the tab's place before Watching, its count, its columns
  and headers, the closed line, the stars, Stocks without A shares, and the page's facts and chart.
- **A live look** on a scratch face, with `FACE_ACCOUNT_URL` at an unreachable port so the page's
  owner device pairs with nothing (the test-face trap). Ideally run during an A-share session, to
  see `Live` and the open `marketStat` form once.
- **The operator's step:** restart their face on 3090.
