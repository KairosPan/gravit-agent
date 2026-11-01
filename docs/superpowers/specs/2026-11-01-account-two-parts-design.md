# The Account's two parts, one face — Design (A shares into the Market part; the Account's own page retired)

Written 2026-11-01 against main @ c06367c3. Projects 2 and 3 of the Account-in-repo design
(`docs/superpowers/specs/2026-10-27-account-in-repo-design.md` §2; `DEVELOPMENT.md` §10 items 22 and 23), designed and
to be built together on the operator's word. Status: builder check done (four questions: three settled in §5.1, §5.6 and §3,
one ruled by the operator in §7); for the operator's approval. The canvas the design was settled on:
https://claude.ai/artifact/SNQPFqNEj3jYNoRhVrJVNh (v7).

## 1. Intent — the operator's words

On 2026-10-27 the operator brought the Account's back end into this repository for two reasons: **防钥匙** — the agent and
the money live in different boxes, so Gravit's shell cannot reach the exchange side's keys — and **主动权**: "我们可以掌握交易所
这个数据提供和钱包提供的主动权", the market data and the wallet provision become this tree's to evolve. They ruled that the
A-share data moves into the Account box ("现在搬过去", project 2) and named project 3, the Account's own page retired.

On 2026-10-31, offered project 2 or an interim, they chose the interim ("先做 face 临时版"): the Markets screen's China tab
and the A-share page on the face's own Tencent wire (`docs/superpowers/specs/2026-10-31-china-tab-design.md`, whose §1 says
item 22 replaces it).

On 2026-11-01, having confirmed that neither project had started, they said **"一起做完"** — do both, to the end. Shown a first
proposal that treated the Account as one block, they corrected it: **"account本身就是主要两部分，一部分是market，另外的是另一部分"**,
the other part being the wallet. The Account is two parts, and this design is organised by them:

- **The Market part (数据提供)** — what there is to trade and what it costs: the markets by tab, a market's page, Trade.
- **The wallet part (钱包提供)** — the owner's money and who may touch it: holdings, venues, receiving and moving money, Earn,
  agent wallets, the agents and their limits, cards, Guard and Beast.

On the reorganised canvas — the wallet half moving to the face whole, the Market half completed, three agent features left
behind — the operator answered **"对"**.

## 2. Today and after

| | Today (c06367c3) | After |
|---|---|---|
| The agent box (face 3090 · dsh · Gravit) | Reaches market hosts itself: the face's A-share wire (`/data/quotes`, `/data/quotes/stream`, `/data/symbols/search`, `/data/cn/rank`, `/data/cn/candles` → `qt.gtimg.cn`, `smartbox.gtimg.cn`, `proxy.finance.qq.com`, `web.ifzq.gtimg.cn`) and the four Lunhui freeze rows (Tencent, `push2.eastmoney.com`, `push2ex.eastmoney.com`, the iFinD stand-in at `quantapi.51ifind.com`). Runs `akshare-mcp` (Python) as the dsh row `mcp-akshare`, 14 `mcp__akshare__*` tools for Gravit. Holds the DeepSeek key and the iFinD token | Reaches no market host. Runs no data source. Holds the DeepSeek key only. Gravit's market tools are the seat's; the face's screens read the Account through the proxy; the freezes fetch through the Account |
| The Account box (`account/`, 4820) — Market part | US stocks, crypto, predictions, RWAs, perps, pre-IPO; dollar markets only; Trade with amend/close/leverage, and the Superagent (the Desk, the Account's own agents) | Adds **China**: A shares from Tencent and Eastmoney, view-only, in CNY. Owns the Lunhui freezes' upstream reach (a relay and the iFinD route) and the `akshare-mcp` sidecar |
| The Account box — wallet part | Holdings, venues, receive and move, Earn, agent wallets, agents and limits, cards, Guard/Beast, the cap, the session, leverage | The server unchanged |
| The Account's own page (`account/src/portfolio/public`) | Both parts drawn again; the only place for Guard/Beast, the cap, money moves, agent wallets, wallet and OAuth connects | **Gone.** The Account serves its API only |
| The face's screens | Markets and Trade draw the Market part, Account draws the wallet part; each misses what only the page does | Markets and Trade are the Market part's only face; the Account screen is the wallet part's only face (§5) |
| Port 4820 | Published on the host's loopback (host loop and compose alike) | Under compose, published to nobody but the agent box; the host loop keeps 127.0.0.1:4820 |

## 3. Goals, non-goals, anti-goals

**Goals.**
1. The agent box holds no market data source: no face route, no Lunhui row and no Gravit tool reaches a market host except
   through the Account; the agent image carries no `akshare-mcp`, nor the uv / Python 3.12 install that served it (the base
   image's own `python3` is no data source and stays); the iFinD token lives only where the Account runs.
2. The Account's Market part serves A shares, and the face's Markets › China, its search, stars and the A-share page look and
   behave as they do today, read from the Account.
3. Lunhui's four freezes produce the same evidence, under the same contracts, through the Account — the boards stand-in included.
4. Gravit reaches AKShare through its seat at the Account.
5. The Account serves no page. The face carries both halves: the fifteen page-only items of §5.1 moved, the three of §5.4 left.
6. Under compose, 4820 is published to nobody but the agent box.
7. The face and Account suites, the smokes and the live docs are green and true at the end.

**Non-goals.**
- Trading A shares, or any limit that is not in dollars.
- Tracking Linqi's repository (the Account-in-repo design's ruling stands: a copy, maintained here).
- Changing the door protocol, the envelope, the Guard, or any existing route's shape; this design only adds routes and fields.
- The Account's Superagent (the Desk and its Brains), Intents and Memory on the face (§5.4).
- Hosting off the operator's Mac; the always-on desk work on `feat/desk-p1-p4`.

**Anti-goals** — a result that would be a failure even if it ran:
- A direct-to-upstream fallback anywhere in the agent box ("if the Account is down, fetch Tencent ourselves"). When the Account
  cannot be reached, a freeze refuses and a screen says the Account is unavailable.
- A frozen artifact that no longer says where its data came from, or a China screen that shows stale prices without saying so.
- The face holding a key or signing for the owner by itself (D18): every owner action stays prepare → What you sign → the
  browser's key.
- Real money reachable through the new wallet screens without the real-money trigger (§8 of the charter): the screens may exist;
  the operator's paper-venues-only rule still governs their use.

## 4. Part 1 — the Market part takes A shares (project 2)

### 4.1 China in the Account

China is one more **public market source** of the Account (`account/src/portfolio/live/`, beside `public-stocks.ts`,
`public-markets.ts`), keyless and GET-only on fixed hosts through the Account's guarded fetch. Its code is moved, not
rewritten: the face's `cn-rank.ts`, `quote-snapshots.ts`, `cn-candles.ts`, `symbol-search.ts` and `cn-session.ts` (with their
parsers, limits and tests) are the starting point.

- **Keys.** An A share is `cn:<6 digits>` in the Account, the grammar the face already uses (`wire/market-model.js`), so stars,
  the Lunhui run view's "Open in Markets" and a market's page id carry over unchanged. The face's `isAccountKey` gains `cn`.
- **The tab.** `explore?tab=china`, label `China`, with the sorts the China tab has today (`volume`, `movers`) and the same rows
  (name, price, today's change, turnover). China rows are priced in CNY and say so (`currency: "CNY"`); they never appear in
  `all`, and no trader is ever offered one (`canTrade: false`): the dollar rule of `explore.ts`/`trade.ts`
  ("so that every limit means dollars") stays as it is, with China as its one view-only exception.
- **Search.** `explore?q=` finds A shares by code or name (Tencent's smartbox, as today), merged with the other markets' hits.
- **A market's page.** The facts the A-share page shows today (`CN_FACTS`: market cap, PE TTM, turnover rate, limit up and down,
  amplitude, last session) and its history: 1D and 5D as minute lines with the previous close, the longer ranges as day, week and
  month bars, forward-adjusted. The builder picks which Account read carries them (`asset?key=`, `market`, `candles`) as long as
  the A-share page draws what it draws today.
- **Sessions.** China counts its sessions on the Shanghai clock and the A-share trading days (today the Account counts 1D and 5D
  in New York sessions, `live/history.ts`). The session phase the China tab shows comes from the Account.
- **Live prices.** The China tab's and the A-share page's live updates reach the face through the Account's push channel
  (`stream/markets`) or its quote read — whichever the Account's public-source path supports; the face no longer polls Tencent.
- **Stars.** A-share stars live in the Account's watch list like every other market's (signed `setWatch` while the page signs);
  the face's local `cn:` list moves over once, the way the old `us:`/`crypto:` stars did.
- **Statuses.** The Account says when China is unavailable or stale in its own words; the face's Venues line "A-share quotes"
  reads that status instead of the face wire's providers.
- Known traps carried with the code: STAR shares (688…) report volume in shares, the rest in lots; Tencent answers in GBK
  (GB18030) with a trailing `~`; board mapping by code prefix exists three times today (the face server, `cnBoardOf`, Lunhui's
  `boardOf`) — one of them goes with the face wire.

### 4.2 The Lunhui freezes through the Account

Only four Lunhui rows fetch (`lunhui_freeze_quotes`, `_limit_up`, `_boards`, `_index`); the other eight read frozen files.
**The fetching moves to the Account; the reading of what comes back stays in Lunhui.**

- **A relay.** `GET /api/cn/relay?url=<upstream URL>` on the Account forwards one GET to an allow-list of (host, path) pairs —
  exactly the endpoints the four rows use today: Tencent `qt.gtimg.cn/q=…`, `web.ifzq.gtimg.cn/appstock/app/fqkline/get` and
  `/appstock/app/day/query`; Eastmoney `push2ex.eastmoney.com` (`getTopicZTPool`, `getTopicZBPool`, `getYesterdayZTPool`,
  `getTopicZDFenBu`), `push2.eastmoney.com/api/qt/clist/get`, and `push2delay.eastmoney.com` for the one redirect Eastmoney
  sends. It answers with the upstream's status, content type and bytes unchanged (no decoding, no caching), does not follow
  redirects (Lunhui's own one-redirect rule keeps working), and applies a timeout and a size cap no looser than Lunhui's own
  (7 s and 512 KiB for Tencent and Eastmoney reads, 4 s for minute lines, 4 MiB overall). Anything off the list is refused.
- **The iFinD route.** `POST /api/cn/ifind {query}` runs the boards stand-in's 问财 query (`smart_stock_picking`) with the token
  the Account holds (`IFIND_ACCESS_TOKEN` / `IFIND_REFRESH_TOKEN` in the Account's environment), keeping today's token cache and
  its one re-exchange on refusal, and answers with iFinD's reply unchanged. Without a token it refuses, and Lunhui records
  "备用未配置" exactly as today.
- **Lunhui's side.** In production the freeze rows' fetch is an adapter that sends each upstream URL to the relay at the
  Account's address (the face's `FACE_ACCOUNT_URL`, default `http://127.0.0.1:4820`, `http://account:4820` under compose) and
  each iFinD query to the iFinD route; the parsers, derivations, contracts and the fixture mapper the tests use stay as they are.
  The iFinD variables leave the face's environment (`face/src/agents.ts` stops needing to strip them; the operator's face start
  stops sourcing `.env.ifind`, the Account's start sources it instead).
- **Provenance.** The evidence still names the upstream host it came from, and records that it came through the Account at the
  file level, without changing an item's shape. Whether that bumps the Lunhui `CONTRACT_VERSION` is the builder's call under the
  contract rules.
- **Failure.** The Account unreachable is a refusal like an upstream timeout (the rows' existing codes); modules depending on that
  source read `NOT_EVALUABLE`, as they do today when Eastmoney fails.

### 4.3 AKShare in the Account box

- **The sidecar.** The Account runs `akshare-mcp` as an MCP child over stdio (the Account already depends on the MCP SDK):
  started on first use, restarted when it exits, each call bounded (today's 120 s and `AKSHARE_MCP_MAX_ROWS=500`). The command
  comes from the Account's environment, defaulting to `~/.local/bin/akshare-mcp` on the host; the account image installs it at
  the pin the face's image uses today (`xiaozhozho/akshare-mcp @ 9b6a22b`, `uv tool install --python 3.12 --with 'mcp<2'`).
- **Routes.** A read listing the sidecar's tools, and a read calling one (`tool` plus its arguments), both under the Host fence.
  Nothing an AKShare tool does writes anything.
- **The seat.** One new read tool, the passthrough — `tool` plus `arguments`, its description naming the sidecar's tools and
  `akshare_discover` as the way to find a function. Gravit's 14 `mcp__akshare__*` tools become this one seat tool. The face
  classifies it as a read (`SEAT_READ_RAW_NAMES`), so it raises no Gate 2 card; the seat smoke's tool count moves by one.
- **What leaves the face.** The `mcp-akshare` row (`face/src/akshare.ts`) and its prompt section, its boot and check-home wiring
  and tests; `uv`, Python and `akshare-mcp` in `face/Dockerfile`. Every live document and prompt naming `mcp__akshare__*`
  (`GRAVIT.md`, `dsh/profile/cycle.md` and its generated mirror, the roles' never-list, `face/README.md`, `DEVELOPMENT.md`,
  `CLAUDE.md`) names the seat's tool instead. The roles still get no AKShare.

### 4.4 The face's own wire retires

`/data/quotes`, `/data/quotes/stream`, `/data/symbols/search`, `/data/cn/rank` and `/data/cn/candles` and the modules behind them
are deleted, not kept as a fallback. The client's China tab, search, live quotes, stars and A-share page read the Account through
the proxy (§5.5 adds the reads it lacks); the drawing stays as it is (`render/markets.js` `cnPage`, the charts). The China tab
spec's `explore?tab=china must never be sent` becomes the opposite: it is the only way China is read.

### 4.5 Done when (project 2)

- The agent image carries no `akshare-mcp` and none of the uv / Python 3.12 install that served it; no Lunhui row, no face
  route and no Gravit tool reaches a market host
  (a test records every request the four freezes make and finds only the Account's address; the face's source holds no route to a
  market host).
- The China tab, search, stars and the A-share page work on the Account; a live Lunhui market run seals with the same artifacts
  as before, its boards from Eastmoney or from the stand-in through the Account; Gravit answers an AKShare question through the seat.

## 5. Part 2 — the page retired, both halves on the face (project 3)

### 5.1 What only the page does today, and where it goes

| Half | Item | The face today | Decision |
|---|---|---|---|
| Market | Close a position, amend an open order, set leverage (`liveClose`, `liveAmend`, `liveLeverage`) | Order and Cancel only | **Move**: Trade's Under way, a market's page and the Portfolio's positions |
| Market | A market's page: "you here" — your positions, open orders and cost in it, what the agents do in it (the Account's asset sheet) | Partly | **Move** |
| Market | A market's order book and latest trades (`/api/account/book`, `/api/account/trades`; the page's `ui/book.js`) | None | **Move**: a market's page |
| Market | A perpetual's funding history (`/api/account/funding`; the page's `ui/terminal.js`) | None | **Move**: a market's page |
| Wallet | Guard / Beast, the cap, the agents' session, their leverage (`/api/mode guard`; `setPolicy` mode `open`, `cap`, `session`, `maxLeverage`) | A chip for the mode and the cap | **Move**: a Rules tab |
| Wallet | Close a venue to agents, reopen it (`/api/revoke`; `setPolicy restore`) | None | **Move** |
| Wallet | Receive: an account's address to be paid at | None | **Move**: a Money tab |
| Wallet | Move money between the owner's accounts; a browser wallet sending what the Account built (`liveMove`, the bridge routes, the order-sent reports) | None | **Move**: Money |
| Wallet | Earn in and out (`liveEarn`); Sell many (up to ten holdings) | None | **Move**: Money and the Portfolio |
| Wallet | Agent wallets (`createSubAccount` with a float) | None | **Move**: Agents |
| Wallet | Every limit scope (`approveSpend` trade · venues · payees · earn); Revoke and the limit on Gravit's own row | `trade` only; Gravit's row has no buttons | **Move** |
| Wallet | Connect a browser wallet (the wallet challenge and proof) or a venue's OAuth sign-in (Robinhood) | Key-file connectors only | **Move** — real-money paths, unused under the paper-venues rule |
| Wallet | Connect by an address (a wallet read from its address) or by the command-line connector (MetaMask's `mm`) | Sent to "Connect on the Account page" (`ELSEWHERE`, `host/account-view.js`) | **Move**: Venues |
| Wallet | Grant every kind of ask | Some kinds | **Move** |
| Wallet | Sign-out's "switch to Guard first" | None | **Move**: Settings › Devices |

Already on the face and left as they are: the Portfolio and the Statement, key-file connectors, paper accounts (open, top up,
start over, disconnect), placing and cancelling orders, cards, devices and pairing.

### 5.2 The Market half on the face

Trade, a market's page and the Portfolio gain Close…, Change (amend) and Leverage, each prepared by the Account and signed in
What you sign like Trade's order today. A market's page gains the Account's own view of the owner in that market (positions,
open orders, what was paid, the agents' activity), read from the Account's asset sheet, and — where the venue has them — its
order book, its latest trades and, for a perpetual, its funding history. A shares keep their view-only page.

### 5.3 The wallet half on the face

The Account screen's tabs become **Portfolio · Money · Venues · Agents · Cards · Rules**; the canvas's Rules board is the
settled look for Rules.

- **Rules** — Mode (Guard ⇄ Beast), Each move at most (the cap), Agents' session (renew for 30 days), Their leverage. Guard is
  one click and unsigned, as the Account defines it (making the Account safer needs no signature); Beast, the cap, the session and
  leverage are signed. On a read-only Account the cap, session and leverage rows say why there is nothing to set. Beast removes
  the Account's card only: Gravit's order still raises Gate 2 in the thread first, and Rules says so.
- **Money** — Receive (an address per account, asset and network), Move between the owner's accounts, a browser wallet's send,
  Earn in and out. The Portfolio gains Sell many.
- **Venues** — every connector kind the page offers — a browser wallet, a venue's OAuth sign-in, an address, the command-line
  connector — beside the key-file ones; each venue row gains Close to agents (unsigned, the safer direction) and Reopen (signed).
- **Agents** — agent wallets (open one with a float; fund it), every limit scope, and Gravit's own row with Revoke and its limit.
- **Cards** — every kind of ask can be granted.
- **Settings › Devices** — Sign out offers to switch to Guard first when this is the last device that signs.

Every signed action uses the face's existing sheet machinery (`js/host/sheet.js`: prepare → What you sign → sign); the face holds
no key and signs nothing itself.

### 5.4 What stays off the face

The **Superagent** (the Desk — the Account's own agents that trade a paper account by themselves — and its **Brains**, the model
keys they think with), **Intents** (a signed sentence handed to an agent; on the face the operator tells Gravit in chat) and
**Memory** (what the Account's agents remember about the owner; the face dropped it on 2026-10-20, and Gravit's memory is its own
design). Their server code and seat tools stay in `account/`; nothing on the face draws them.

### 5.5 The face's proxy grows

`face/src/account-proxy.ts` (today twenty exact routes, three of them the owner's writes) gains what §4 and §5 read and write:
the asset sheet, the book and trades, funding, receive, earn and sellable, the wallet challenge and proof, the bridge routes and
the order-sent reports, the two unsigned safer-direction writes (`mode` limited to `guard`, `revoke`), and the OAuth start and
callback. Each new route is exact, keeps the proxy's rules (loopback, passthrough bodies for writes, no logging of envelopes,
per-route TTLs and aborts), and the allow-list stays a list. The **OAuth callback** is the one top-level navigation: the venue
sends the browser back to the face, which forwards it to the Account, so the Account must build its redirect address on the
origin the browser uses — the builder designs this, and the face's data fence gains an exception for that one route only.

### 5.6 The Account serves no page

`account/src/portfolio/public/` and its static serving go; the Account answers its API and nothing at `/`. The Host fence's
exceptions for page navigations shrink to what remains (none, once the OAuth callback arrives through the face). The page's own
tests go with it — among them `test/unit/ui-superagent.test.ts`, the suite's one known red. The server's scripts that print the
pairing code (`npm run account:service -- code`, the terminal line) stay: the first owner still pairs on the face with that code.

**Before the page goes, the face must already sign for the home the operator runs** (`~/.buyer-agent-demo`). An Account that has
an owner lets a new device in only when an existing owner device signs it in (`convertToMultiSigUser`); the pairing code works
only on an Account with no owner. If the page's browser is the only device that signs, deleting the page leaves nothing that can
let the face in. So plan 5 starts by checking that the face signs (the Account screen's device line); if it does not, the operator
lets the face in from the page's Settings › Devices — or signs the page's device out, which makes the Account print a new code
the face pairs with — before the page is deleted. `--fresh` is not the remedy: it throws away the owner, the venues, the agents
and their limits.

### 5.7 Compose

The account box publishes no port; the agent box reaches `account:4820` on the `gravit` network. The pairing code is read with
`docker compose logs account`. The host loop (two host processes) keeps `127.0.0.1:4820` on loopback. The `two-box drill` of
`face/README.md` is rewritten for this and run (it is owed anyway, `DEVELOPMENT.md` §10 item 24).

### 5.8 Words

Every face sentence that sends the operator to the Account's page changes — "Open the Account page" (`render/account.js`),
"knocking — admit it on the Account page", "Let it sign on the Account page, under Devices", "Connect on the Account page",
"Card raised on the Account page · answer it there" and its batch form — to the face's own place for it. The seat's card
sentences say where the card is answered: Cards, on the face.

### 5.9 Done when (project 3)

- `account/src/portfolio/public` is gone and the Account serves no page; under compose 4820 is published to nobody but the agent box.
- Each of the fifteen items of §5.1 works from the face against the Account (on paper venues or stand-ins); the face draws no
  sentence pointing at the Account's page.

## 6. Constraints

- Paper venues only (the operator's rule); the real-money trigger (charter §8) is unchanged. Real-money screens are drilled on
  the Account's stand-ins, never on a real venue.
- Gate 2 cards every seat write, as today; the new seat read raises none.
- The face holds no key (D18). The owner device protocol, the envelope and the door are unchanged.
- The Account stays its own package (`account/`, Node 22, vitest); the face stays `node --test`; tests are offline, with
  upstream hosts injected (the Account's `Http`/`network(routes)` fixtures, Lunhui's fixture mapper).
- The Lunhui contracts and their frozen artifacts stay valid; nothing rewrites a sealed run.
- Local main only, never pushed; `strategies/*` is not touched by the build.

## 7. Order of work

| Plan | Covers | Needs |
|---|---|---|
| 1 | China in the Account (§4.1) and the face re-pointed, its wire deleted (§4.4) | — |
| 2 | The relay and the iFinD route; Lunhui's adapter (§4.2) | — (shares 1's guarded fetch if 1 lands first) |
| 3 | AKShare in the Account box and the seat (§4.3) | — |
| 4 | The Market half and the wallet half on the face; the proxy's new routes (§5.1–§5.5, §5.8) | — |
| 5 | The page retired, compose, the docs and the drills (§5.6, §5.7, §8) | 1–4 |

Plans 1 to 4 can be built in any order; 5 is last. Each plan ends with its suites green and a final review on fable.

`feat/desk-p1-p4` (the always-on desk, another session's work, still moving) already contains main @ c06367c3, so main can
fast-forward to it. It overlaps this work in six files — `GRAVIT.md`, `face/src/agents.ts`, `boot.ts`, `http.ts`, `main.ts`,
`orders.ts` — and carries no Python since its Node market calendar (`1e02865b`). The operator's ruling (2026-11-01, "这次先开工"):
these plans start on main as it stands, without waiting for the desk; whichever of the two lands second resolves the six-file overlap.

## 8. Documents and drills

- **Charter (`Gravit-Design.md`):** §1's MARKET line (the Account provides every market, A shares included), the write map's
  data rows, D17 (the iFinD token and `akshare-mcp` in the Account box), D18 (the face as the only page; the proxy's allow-list;
  the wallet screens), §9's "Guard · Beast and the cap on the face" closed, the debts.
- **`DEVELOPMENT.md`:** the Account, proxy, seat, Lunhui and Markets sections; §10 items 22 and 23 moved to the built log,
  item 24 updated. **`CLAUDE.md`:** the `face/`, `face/src/akshare.ts`, `account/` and `face/client/` rows and the gotchas.
  **`GRAVIT.md`** within its byte budget; `face/README.md`; `account/README.md`; the loops page where the loops move.
- **Live drills, the operator's or mine with the operator's go-ahead:** the China tab and an A-share page on the Account; a Lunhui
  market run through the Account; Gravit asking AKShare through the seat; Rules on the read-only Account and on a writes-on
  Account with a paper venue; the two-box drill with 4820 unpublished.

## 9. My calls, for the operator to check

1. A shares keep the `cn:<6 digits>` key in the Account (§4.1).
2. China is view-only and never in `all`; the dollar rule stays (§4.1).
3. The Lunhui freezes go through a relay of raw upstream bytes plus an iFinD route, with the parsers left in Lunhui, rather than
   moving the parsers into the Account (§4.2). The heavier road — the Account understanding pools and boards — stays open for later.
4. Gravit's 14 AKShare tools become one passthrough tool on the seat (§4.3).
5. The face's wire is deleted, with no fallback (§4.4).
6. The Account screen's tabs: Portfolio · Money · Venues · Agents · Cards · Rules (§5.3).
7. Guard and Close-to-agents are unsigned one-click actions, as the Account defines them; everything that widens is signed (§5.3).
8. The OAuth callback comes back through the face (§5.5).
9. Five plans in that order (§7).
10. The order book, latest trades, funding history and the address and command-line connectors move too, by the two-part rule
    (the wallet half whole, the Market half completed): fifteen items moved, not twelve (§5.1).
11. "No Python in the agent box" means no `akshare-mcp` and none of the uv / Python 3.12 install that served it; the base
    image's own `python3` stays (§3).

## 10. Left to the builder

The Account read that carries the A-share facts and history; live China prices by push or by poll; the relay's exact parameters
and the per-host limiter; how the evidence records the Account at file level and whether the contract version moves; the
sidecar's supervision details; the new proxy routes' TTLs and aborts; the OAuth redirect origin; the layout of Money, Agents and
the Market half's sheets within the face's existing look; the tests' shapes.
