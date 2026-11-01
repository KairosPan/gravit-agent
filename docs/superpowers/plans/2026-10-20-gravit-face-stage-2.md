# gravit-ui on the face, stage 2 — Markets and Account — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `#/markets`, `#/markets/<id>` and `#/account` in the face's one client draw the face's own quotes, search, watchlist, daily bars and paper account, and `/market`, `/account` and Trade leave the tree.

**Architecture:** The old client's market and account modules move unmodified to `js/wire/`. Two impure host layers (`js/host/markets.js`, `js/host/account.js`) drive them and the `/data` routes into reducers, and two pure view modules (`js/host/market-view.js`, `js/host/account-view.js`) turn the slices into what the screens draw — in English, from the wire's enums and numbers. The renderers keep gravit-ui's layout, classes and helpers. The back end gains one route, `GET /data/bars` (`face/src/bars.ts`), over a fixed-argv producer `scripts/face_bars.py`.

**Tech Stack:** vanilla ES modules in the browser (no bundler), Node 22 + `node:test` via `tsx --test`, the face's TypeScript routes, Python 3 + `alpaca_kit` + pytest for the producer.

**Spec:** `docs/superpowers/specs/2026-10-19-gravit-ui-on-face-design.md` — §7 "Stage 2", §8 (the back-end rows), §2 (goals 4 and 7, the anti-goals), §3, §5 ("State"). The look is `docs/superpowers/specs/2026-10-09-demo-v2-gravit-frontend-design.md` §8, §15, §16, minus what route A leaves out. Stage 1's plan, ledger and rulings: `docs/superpowers/plans/2026-10-19-gravit-face-stage-1.md`, `docs/superpowers/plans/2026-10-19-gravit-face-ledger.md` (this stage appends its own section there).

## Global Constraints

- The product speaks English. The wire's Chinese strings are never drawn: quote and provider `message`, search `note`/`error`, the watchlist module's error strings, `MARKET_INFO` labels, `accountMode().label`, `quoteConnectionLabel`, `describeQuote`, `quoteSource`, `quoteTime`, account `error` text (spec §3). The screens read enums and numbers.
- No explanatory small print. The allowed host status: the status line under the composer, a stale stamp, the bars' source and as-of stamp, the quotes' connection word while not streaming, and the Statement's "The 50 most recent orders" (spec §3 *call*).
- No new door: no Buy, Sell, Trade, order route, venue Connect, Move, Receive or allow-always; no Guard | Beast, no "Trading on" chip (spec §2 non-goals and anti-goals).
- The watchlist lives in the face's key `gravit.market.watchlist.v1`, read and written only by `market-model.js`'s `readWatchlist` / `saveWatchlist` (spec §5); `gravit-ui.prefs` no longer carries `watch`. At most 100 entries (the quote wire's cap).
- `market-model.js`, `market-quotes.js`, `market-search.js` and `account-model.js` move to `face/client/js/wire/` unmodified but for `market-quotes.js`'s JSDoc typedef path; their tests keep passing. `market-catalog.js` stays put: `face/src/watchlist.ts` imports it.
- Instrument ids are the face's grammar — `us:AAPL` (`/^[A-Z][A-Z0-9.-]{0,14}$/`), `cn:600519` (six digits), `crypto:BTC/USD` — canonicalised by `normalizeAsset`, and written raw into the hash (`#/markets/crypto:BTC/USD`).
- `GET /data/bars?id=&days=`: GET only; the fence first; exactly one `id`, a valid `us:` id; `days` an integer in [5, 730], 120 when absent; argv `[<repo>/scripts/face_bars.py, <SYMBOL>, <DAYS>]` from validated values only; a cache per `SYMBOL:DAYS`, fresh for 10 minutes, at most 64 keys, single flight per key, stale on error; spawn timeout 30 s (spec §8; stage-1 ruling 7).
- `face_bars.py`: keys first (`make_source("alpaca")` when both `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` are set, the live read under a 12 s deadline), the PIT bed behind it (`ALPHA_PIT_ROOT`, else `data/pit/2yr`), stamped `source: "bed"` with the bed's `as_of`; RAW prices through `GuardedSource` + `AsOfGuard`; fixed error words on stdout — never exception text.
- Every commit leaves `npm test --prefix face` and `python -m pytest` green and `npm start` bootable. No push. Commit messages through `git commit -F <file>`.
- The front-end spec's tokens, sizes and board states stay; only what has no back end leaves the screens.

## Review Focus

1. **A keyless face** (no APCA keys, no PIT bed): Account says "No APCA keys in the environment", US quotes read "Not configured", the Market page draws no chart, and nothing throws — pinned in Tasks 4, 7 and 8.
2. **Nulls and Chinese on the wire**: a null price, change or volume (A-share volume is always null; an unknown symbol is all null) draws "—" and sorts last under both sorts; no CJK character from a `message`, `note` or `error` reaches the HTML — pinned in Tasks 4, 6 and 8.
3. **Ids in the address bar**: `#/markets/crypto:BTC/USD` keeps its slash; a valid id on no list (`us:MSFT`) opens its page; a garbage id opens Markets — pinned in Tasks 6 and 7.
4. **Leaving Markets or hiding the page** pauses the quote stream and coming back resumes it; while the stream is down the connection word shows — pinned in Tasks 5 and 6.
5. **A failing account or storage**: a stale account payload shows the stale stamp; a 503 shows "Account unavailable" with Retry and keeps the last good data; a watchlist save that fails keeps the list on screen and says "Couldn't save the watchlist" — pinned in Tasks 5 and 8.

## Calls this plan makes

Each goes to the ledger as a ruling when its task lands, with what it costs if wrong.

- With a query typed, the rows are the search's hits ("All results", front-end spec §15.1); without one, the watchlist and the holdings — the spec's union, taken a state at a time.
- Order tools on or off comes from the tool registry (`/data/plugins.json`, any tool ending `__place_order`), not `orders_gate.gate1_registered`: the flag lives in the alpaca-kit row's own env, so the face process reads it as false even when the tools are registered (`face/src/orders.ts` says the registry is the only honest source).
- Gravit on it reads conversation titles only; `session/search` snippets wait until that Remote's mount is verified. No bid/ask (the spec's optional wire change).
- The `daily_bars` tool row's chart joins the other tool-row renderers in stage 3 (§7's research surfaces), though §6's note puts kind 11 in stage 2; this stage's chart is the Market page's.
- The Statement stays the drawer the design draws, opened from Portfolio and from a Market page; the Account tabs are Portfolio and Venues.
- Venues reads the quote providers' states from one `/data/quotes` read of `us:SPY`, `crypto:BTC/USD` and `cn:600519` on each visit; the wire reports a provider only for a market it was asked about.
- The Memory tab leaves Account; the memory reducers and state stay for Discover's Like shelf until stage 3.
- `face/scripts/capture-demo-assets.mjs` leaves with the two pages it captures; the landing page keeps its three images, and a capture of the new screens is a later item.
- The account `error` text (it can carry an Alpaca response or a local path) is never drawn; the screen says "Account unavailable".
- A Market page charts 120 calendar days of daily bars.

---

### Task 1: The market and account wire modules move under `js/wire`

**Files:**
- Move (`git mv`): `face/client/{market-model,market-quotes,market-search,account-model}.js` → `face/client/js/wire/`
- Modify: `face/client/js/wire/market-quotes.js` (the typedef `import('../src/quote-types.ts')` → `import('../../../src/quote-types.ts')`); every import of the four in `face/client/*.js` (`market.js`, `account-view.js`) → `./js/wire/<file>.js`
- Test: `face/tests/{market-model,market-quotes,market-search,account-model}.test.ts` (import paths only)

**Interfaces:**
- Produces: `face/client/js/wire/market-model.js` (`STORAGE_KEY`, `LEGACY_STORAGE_KEY`, `normalizeAsset`, `readWatchlist`, `saveWatchlist`, `filterWatchlist`, `sortWatchlist`, `number`, `price`, `signed`, `percent`), `market-quotes.js` (`createLiveQuotes(onUpdate, {fetcher, createEventSource, schedule, cancelTimer, …})` → `{setAssets, setVisible, refresh, close}`), `market-search.js` (`createSymbolSearch(onUpdate, {fetcher, delayMs})` → `{search, cancel}`), `account-model.js` (`number`, `money`, `signedMoney`, `pct`, `sign`, `text`, `accountMode`, `unrealizedTotal`, `orderMatches`).

- [ ] **Step 1: Point the four tests at the new paths** — `../client/<file>.js` → `../client/js/wire/<file>.js`.
- [ ] **Step 2: Run them** — `npx tsx --test tests/market-model.test.ts tests/market-quotes.test.ts tests/market-search.test.ts tests/account-model.test.ts` (in `face/`). Expected: FAIL, module not found.
- [ ] **Step 3: Move the files**, fix the typedef path, and update the old pages' imports so `/market` and `/account` keep working until Task 9.
- [ ] **Step 4: Run them again**, then `npm test` and `npm run typecheck`. Expected: PASS; no file outside `face/client/js/wire/` imports `./market-model.js`, `./market-quotes.js`, `./market-search.js` or `./account-model.js` (`grep -rn` over `face/client`).
- [ ] **Step 5: Commit** — "client: the market and account wire modules move under js/wire".

### Task 2: One instrument-id check, and `GET /data/bars`

**Files:**
- Modify: `face/src/quotes.ts` (export `parseInstrumentId`; `parseQuoteRequest` uses it), `face/src/data.ts` (register the bars route; the module's invariant sentence)
- Create: `face/src/bars.ts`
- Test: `face/tests/quotes.test.ts`, `face/tests/bars.test.ts` (new), `face/tests/data.test.ts` (the route list)

**Interfaces:**
- Produces: `parseInstrumentId(raw: string): QuoteIdentity | null` (quotes.ts); in bars.ts `BARS_TTL_MS = 600_000`, `BARS_CACHE_LIMIT = 64`, `BARS_TIMEOUT_MS = 30_000`, `BARS_DAYS = { min: 5, max: 730, fallback: 120 }`, `parseBarsRequest(rawUrl: string): { symbol: string; days: number }` (throws `HttpError(400, "invalid bars request")`), `registerBarsRoute(webServer: RouteRegistrar, opts: { isTrusted: (req) => boolean; spawn: Spawner; script: string; now?: () => number }): void`. data.ts calls it with its own spawner and `script = <REPO_ROOT>/scripts/face_bars.py`. bars.ts imports types only: `import type { RouteRegistrar } from "./static.ts"`, `import type { Spawner } from "./data.ts"`.
- Contract: 403 before anything when the fence refuses; 405 for any method but GET; 400 for a URL over 2048 characters or with a malformed `%`, a missing or repeated `id`, an id `parseInstrumentId` refuses or whose market is not `us`, or a `days` that is not `^\d+$` within [5, 730]. A good request is cached per `${symbol}:${days}`: within 10 minutes the body is served as is; otherwise one flight per key spawns `[script, symbol, String(days)]` with `BARS_TIMEOUT_MS`; exit 0 with output is cached (least recently used key leaves past 64); a failure with a cached body serves it with `stale: true`; with nothing cached the producer's own JSON (or `{"ok":false,"error":"producer failed"}`, or `{"ok":false,"error":"producer spawn failed","code":…}`) is a 503. Child stderr never reaches a response.

- [ ] **Step 1: Write the failing tests.**
  - quotes.test.ts — `"parseInstrumentId accepts the three grammars and refuses the rest"`: `us:AAPL`, `us:BRK.B`, ` cn:600519 `, `crypto:BTC/USD` → `{id, market, symbol}`; `us:aapl`, `us:`, `cn:12345`, `crypto:BTC`, `us:AAPL:X`, `AAPL`, `us:-X` → `null`.
  - bars.test.ts (a recording spawner, requests built by hand as `{ url, method, headers: { host: "127.0.0.1:3090" } }`):
    - `"a valid us id and day count spawn face_bars.py with exactly the script, the symbol and the days"` — `/data/bars?id=us:AAPL&days=60` → argv `[…/scripts/face_bars.py, "AAPL", "60"]`, timeout 30000; `/data/bars?id=us%3ABRK.B` → days `"120"`.
    - `"anything else is a 400 and never spawns"` — no id; `id` twice; `us:aapl`; `cn:600519`; `crypto:BTC/USD`; `us:A;rm`; `us:-X`; `days=4`; `days=731`; `days=1.5`; `days=abc`; `%ZZ`; a 2049-character URL.
    - `"GET only, and the fence before anything"` — POST → 405; a forged Host → 403; neither spawns.
    - `"one cache entry per symbol and day count, fresh for ten minutes, one flight per key"`.
    - `"a failure after a good read serves the cached body marked stale; with nothing cached the producer's JSON is a 503 and the spawn-failure body carries no error text"`.
    - `"at most 64 keys are kept, the least recently used leaving first"`.
  - data.test.ts — the exact route list gains `"exact /data/bars"`.
- [ ] **Step 2: Run them** — `npx tsx --test tests/quotes.test.ts tests/bars.test.ts tests/data.test.ts`. Expected: FAIL (`parseInstrumentId` and `bars.ts` missing; six routes, not seven).
- [ ] **Step 3: Implement** `parseInstrumentId` (quotes.ts's three regexes, unchanged, moved into it) and bars.ts as contracted; reword data.ts's invariant to "no unvalidated request data reaches the child: the producer routes pass a fixed argv, and `/data/bars` passes a symbol and a day count that `parseBarsRequest` has checked".
- [ ] **Step 4: Run them again**, then `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — "face: GET /data/bars, daily bars for a us id over a checked argv".

### Task 3: `scripts/face_bars.py` — keys-first daily bars, the bed behind them

**Files:**
- Create: `scripts/face_bars.py`, `tests/test_face_bars.py`

**Interfaces:**
- Produces (Python): `SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,14}$")`, `DAYS_RANGE = (5, 730)`, `LIVE_DEADLINE_S = 12.0`;
  `bars_payload(source, symbol: str, start: date, end: date, *, source_name: str, feed: str | None, as_of: date) -> dict` — reads `GuardedSource(source, AsOfGuard(end)).daily_bars(symbol, start, end)`, keeps rows inside `[start, end]` even if the source ignores the bounds, sorts by date, NaN → None, and returns `{"ok": True, "id": f"us:{symbol}", "symbol": symbol, "source": source_name, "feed": feed, "as_of": as_of.isoformat(), "rows": [{"date": "YYYY-MM-DD", "open", "high", "low", "close", "volume"}, …]}`;
  `pick(env: Mapping[str, str], symbol: str, days: int, today: date, *, live_factory, bed_factory, deadline_s: float = LIVE_DEADLINE_S) -> dict` — both keys set: `live_factory()` read over `[today - days, today]` under the deadline, `source_name="alpaca"`, `feed` = `ALPHA_DATA_FEED` lower-cased or `"iex"`, `as_of` = the last row's date or `today`; any exception or the deadline falls to the bed; the bed: `bed_factory()` → `(source, as_of) | None`, read over `[as_of - days, as_of]`, `source_name="bed"`, `feed=None`; neither → `{"ok": False, "error": "no bar source"}`;
  `main(argv: list[str]) -> int` — argv `[script, SYMBOL, DAYS]`; a symbol `SYMBOL_RE` refuses or a day count outside `DAYS_RANGE` prints `{"ok": false, "error": "invalid request"}` and returns 1 without reading; otherwise prints the payload (`json.dumps(…, allow_nan=False)`) and returns 0 when `ok`, else 1; any exception prints `face_bars: failed (<TypeName>)` to stderr and `{"ok": false, "error": "bars unavailable"}` to stdout and returns 1. The CLI's live factory is `make_source("alpaca")`; its bed factory opens `PITStore` at `ALPHA_PIT_ROOT` or `<repo>/data/pit/2yr` (absent → None), takes `as_of` = the last calendar day with a snapshot, and reads through `SnapshotSource` — the imports as `face_data.py` makes them. The deadline is `signal.setitimer(signal.ITIMER_REAL, …)` raising `TimeoutError`, restored in `finally`.

- [ ] **Step 1: Write the failing tests** (pytest, no keys, no network; the script imported through `sys.path` as `tests/test_face_watchlist.py` does; fake sources):
  - `test_payload_shape_dates_and_nulls` — a NaN close → `None`; dates are ISO strings in order; `id`, `source`, `feed`, `as_of` present.
  - `test_rows_stay_inside_the_window_when_the_source_ignores_bounds`.
  - `test_keys_present_read_live_first` — `source == "alpaca"`, `feed == "iex"`, and `"sip"` when `ALPHA_DATA_FEED=SIP`; the bed factory is never called.
  - `test_a_failing_live_read_falls_to_the_bed_with_its_as_of` — rows within `[as_of - days, as_of]`, `source == "bed"`, `feed is None`.
  - `test_a_live_read_past_the_deadline_falls_to_the_bed` — a source that sleeps 2 s, `deadline_s=0.2`; back in under 1.5 s.
  - `test_no_keys_read_the_bed`; `test_no_keys_and_no_bed_is_a_fixed_error` — `{"ok": False, "error": "no bar source"}`.
  - `test_main_refuses_a_bad_symbol_or_day_count_without_reading` — `["x", "aapl", "120"]`, `["x", "AAPL", "4"]`, `["x", "-rf", "120"]`, `["x", "AAPL"]` → 1 and `invalid request`.
  - `test_main_never_prints_exception_text` — `pick` raising `RuntimeError("SECRET /Users/x")` → stdout without `SECRET`, exit 1.
  - `test_every_read_goes_through_the_firewall` — `face_bars.GuardedSource` spied: every read is guarded with `AsOfGuard(end)`.
- [ ] **Step 2: Run them** — `python -m pytest tests/test_face_bars.py`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** `scripts/face_bars.py` as contracted, in `face_watchlist.py`'s shape (module-relative `REPO_ROOT`, no `sys.path` changes, fixed error words).
- [ ] **Step 4: Run them again**, then `python -m pytest`. Expected: PASS.
- [ ] **Step 5: Commit** — "scripts: face_bars.py, live RAW daily bars with the PIT bed behind them".

### Task 4: The market and account views (pure)

**Files:**
- Create: `face/client/js/host/market-view.js`, `face/client/js/host/account-view.js`
- Test: `face/tests/client/market-view.test.js`, `face/tests/client/account-view.test.js`

**Interfaces:**
- Consumes: `normalizeAsset`, `price` (`js/wire/market-model.js`); `number`, `money`, `signedMoney`, `pct`, `sign`, `orderMatches` (`js/wire/account-model.js`).
- Produces, market-view.js:
  - `MARKET_TABS = [{id:'all',label:'All'},{id:'crypto',label:'Crypto'},{id:'stocks',label:'Stocks'}]`, `MARKET_SORTS = [{id:'volume',label:'Most traded'},{id:'movers',label:'Biggest moves'}]`;
  - `canonicalId(raw: string): string | null` — `normalizeAsset({id: raw})?.id ?? null`;
  - `holdingAssets(accountData): Asset[]` — `us_equity` positions → `us:<symbol>` (exchange kept), `crypto` → `crypto:<BASE>/USD` (from `BTCUSD` or `BTC/USD`), anything else dropped;
  - `listAssets(markets, accountData): Asset[]` — with `markets.q` blank: the watchlist, then holdings not on it; with a query: the search's assets;
  - `marketRows(markets, accountData): Array<{asset, quote, watched, held}>` — `listAssets` filtered by `markets.tab` (stocks = `us` and `cn`), then sorted: `volume` by `quote.volume` descending, `movers` by `|quote.change_pct|` descending, nulls last under both, ties in list order; a hit's quote comes from `markets.hitQuotes`;
  - `assetFor(markets, accountData, id): Asset | null` — the known asset, else `normalizeAsset({id})` (name = symbol);
  - words: `quoteWord(quote)` → `Live` | `Delayed` | `Stale` | `No quote`, with ` · Closed` when `market_status === 'closed'` and there is a price; `connectionWord(status)` → `''` (idle, streaming), `Connecting…`, `Updating every 15 s` (polling), `Paused`, `Quotes unavailable` (error); `providerWord(p)` → `Alpaca · Connected` from `{alpaca:'Alpaca', coinbase:'Coinbase', ifind:'iFinD'}` × `{connecting:'Connecting', connected:'Connected', unconfigured:'Not configured', error:'Error', limited:'Limited'}`; `basisWord(quote)` → `vs previous close` | `24h`; `sourceWord(quote)` → `Alpaca · IEX` (`iex`→`IEX`, `sip`→`SIP`, `delayed_sip`→`SIP, delayed`, other feeds unnamed); `volumeWord(asset, quote)` → compact (`1.2M`, `950k`, `2.3B`) plus `shares` (us) or the base (`BTC`), `—` when null; `searchWord(search)` → `''`, `Searching…`, `Nothing matches “<q>”`, `Search is unavailable`, `Some results may be missing` (partial); `watchWord(error)` → `Couldn't read the saved watchlist` (`read`), `Couldn't save the watchlist` (`unsaved`), `The watchlist is full` (`full`); `barsWord(payload)` → `Daily · Alpaca IEX` | `Daily · PIT bed · as of 2026-07-09`, with ` · stale` when `stale`;
  - `mentionsOf(conversations, asset)` — conversations whose title names the symbol (crypto: the base) as a whole word, case-sensitive, in list order.
- Produces, account-view.js:
  - `portfolioOf(data)` → `{available, reason, currency, netWorth, today, todayPct, alloc: [{token, label, value, pct}], holdings: [{id, symbol, qty, value, changeToday}], orders: {working, filled, closed, other}}` — `netWorth = number(account.equity)`; `today = equity − last_equity` and `todayPct = today / last_equity` only when both parse and `last_equity > 0`; `alloc` sums `market_value` by `asset_class` (`us_equity` → `equity`/`Stocks`, `crypto` → `crypto`/`Crypto`, others → `stable`/`Other`) plus `cash` (`cash`/`Cash`, a negative balance counted as 0), `pct` of the total; holdings' `changeToday` is Alpaca's fraction; orders bucketed with `orderMatches` (`working`, `filled`, `closed`; a status none of them takes goes to `other`);
  - `orderLine(order)` → `Buy 2 AAPL · limit 150 · 0 of 2 filled` (`notional` orders: `Buy $500 AAPL · market`);
  - `statementOf(data)` → filled orders newest first: `[{at, side, qty, symbol, price, amount}]` (`at` = `filled_at` ?? `submitted_at`, `amount = qty × price`);
  - `csvOf(rows)` → `date,side,qty,symbol,price,amount` then one RFC-4180 line per row;
  - `venueOf(data, creds, toolNames)` → `{host, mode: 'Paper'|'Live'|'', keys: 'env'|'file'|'project-env'|'user-env'|'none'|'unknown', orders: 'on'|'off'|'unknown'}` — `keys` from `credentials/describe` (both APCA refs configured → the id ref's `source`), `orders` `on` when any tool name ends `__place_order`, `unknown` when the registry is unread.

- [ ] **Step 1: Write the failing tests.**
  - market-view: `"holdings become face ids; list = watchlist then holdings, deduped; a query lists the hits"`; `"tabs: Stocks holds us and cn"`; `"sorts put nulls last both ways and keep list order on ties"` (an A-share with `volume: null` last under Most traded; an unknown symbol all null last under Biggest moves); `"canonicalId: us:aapl → us:AAPL, crypto:btc-usd → crypto:BTC/USD, BTC → null"`; `"every word is English"` — feed each function every enum value and a quote whose `message` is `"行情连接已断开"`: no output matches `/[㐀-鿿]/`; `"mentionsOf matches whole words: AAPL in 'Is AAPL cheap?', not in 'AAPLX'"`; `"volumeWord: shares, the base, — for null"`.
  - account-view: a keyed payload in Alpaca's own string amounts (`equity: "123346.11"`, `last_equity: "122011.09"`, two positions, orders in `accepted`, `filled`, `canceled`, `done_for_day`) → net worth 123346.11, today 1335.02, `todayPct` ≈ 0.01094, alloc tokens `cash`, `equity`, `crypto` with pcts summing to 100 ± 0.1, buckets `working`/`filled`/`closed`/`other` one each; `"the keyless payload is unavailable with its reason"`; `"unparseable amounts are null, never NaN"`; `"statement rows are the filled orders, newest first, and csvOf quotes commas and quotes"`; `"venueOf: keys and order tools, each unknown until read"`.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/market-view.test.js tests/client/account-view.test.js`. Expected: FAIL (no modules).
- [ ] **Step 3: Implement** both modules, DOM-free.
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: the market and account views, English from the wire's enums".

### Task 5: The markets and account host layers

**Files:**
- Create: `face/client/js/host/markets.js`, `face/client/js/host/account.js`
- Modify: `face/client/js/reducers/markets.js`, `face/client/js/reducers/account.js` (add the host reducers beside the demo's), `face/client/js/data/empty.js` (the new fields), `face/client/js/host/live.js` (`onReceipt`)
- Test: `face/tests/client/host-markets.test.js`, `face/tests/client/host-account.test.js` (new), `face/tests/client/live.test.js`

**Interfaces:**
- New state (beside the demo's fields, which leave in Tasks 6 and 8): `markets.watchlist: Asset[]`, `markets.watchError: null|'read'|'unsaved'|'full'`, `markets.quotes: Record<id, LiveQuote>`, `markets.providers: ProviderState[]`, `markets.connection: QuoteState['status']`, `markets.search: {query, status, assets, partial}`, `markets.hitQuotes: Record<id, LiveQuote>`, `markets.bars: Record<id, {status:'loading'|'ready'|'failed', payload?}>`; `account.status: 'idle'|'loading'|'ready'|'error'`, `account.data`, `account.at`, `account.creds`, `account.tools: string[]|null`, `account.probe: ProviderState[]`, `account.statementOpen: false`.
- Reducers: `watchlistLoaded(s, {items, error})`, `quotesUpdated(s, quoteState)` (keeps `quotes`, `providers`, `status`; drops `note`), `searchUpdated(s, searchState)` (drops `note`), `hitQuotesLoaded(s, {quotes})`, `barsLoading(s, {id})`, `barsLoaded(s, {id, payload})`, `barsFailed(s, {id})`; `accountLoading`, `accountLoaded(s, {data, at})`, `accountFailed(s, {at})` (keeps `data`), `credentialsLoaded(s, creds)`, `toolsLoaded(s, names)`, `probeLoaded(s, providers)`.
- `startMarkets({store, createLiveQuotes, createSymbolSearch, storage, getJson, win}) → {show(on: boolean), search(q: string), watch(id: string), unwatch(id: string), bars(id: string), close()}` — loads the watchlist at start; `show(true)` sets the live quotes visible and subscribed to `watchlist ∪ holdingAssets(account.data)`, re-subscribing whenever that id set changes; `show(false)` pauses them; `search(q)` runs `createSymbolSearch` over all markets and, once it succeeds, reads `/data/quotes?ids=` once for up to 30 hits; `watch`/`unwatch` save through `saveWatchlist` (a failure keeps the new list in the store and sets `unsaved`; the 101st watch sets `full`); `bars(id)` reads `/data/bars?id=<id>&days=120` once per call for a `us` id and nothing otherwise; a window `storage` event for `STORAGE_KEY` reloads the watchlist.
- `startAccount({store, getJson, call}) → {load(): Promise<void>, describe(): Promise<void>}` — `load()` shares one flight; `/data/account.json` ok → `accountLoaded` (a `stale` body stays stale), a rejection → `accountFailed`; `describe()` reads `credentials/describe` with `refs: ['APCA_API_KEY_ID', 'APCA_API_SECRET_KEY']`, `/data/plugins.json` (every `mcp[].tools[].name`) and `/data/quotes?ids=us:SPY,crypto:BTC/USD,cn:600519` (its `providers`), each independent of the others' failure.
- `startLive({…, onReceipt})` — after it dispatches a message of kind `receipt`, it calls `onReceipt()` (spec §6: the account is read again right after a fill).

- [ ] **Step 1: Write the failing tests** (a fake `createLiveQuotes` recording `setAssets` / `setVisible` and handing the test its `onUpdate`; a fake `createSymbolSearch`; a memory storage; a recording `getJson` and `call`):
  - host-markets: `"show(true) subscribes the watchlist and the holdings; show(false) pauses; coming back resumes"`; `"a watch saves the asset under gravit.market.watchlist.v1 and re-subscribes; unwatch removes it"`; `"a list saved by the old page under the kairos key is read"`; `"a failed save keeps the list and reports unsaved; the 101st watch is refused as full"`; `"quotes and search reach the store without their notes; hits get one REST quote read"`; `"bars: one read of /data/bars per call for a us id, none for crypto or cn"`; `"another tab's storage event reloads the watchlist"`.
  - host-account: `"load reads /data/account.json once even when asked twice"`; `"a stale body stays stale; a 503 keeps the last good data and reads error"`; `"describe makes three reads, and one failing leaves the others"`.
  - live: `"a place_order result that is a receipt calls onReceipt once"`.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/host-markets.test.js tests/client/host-account.test.js tests/client/live.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the reducers, the two host layers and the `onReceipt` hook.
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: the markets and account host layers over the face's quotes, search, watchlist, bars and account".

### Task 6: Markets on screen; the demo Markets and Trade leave

**Files:**
- Rewrite: `face/client/js/render/markets.js` (the list; the page arrives in Task 7), `face/client/js/reducers/markets.js` (the demo and Trade reducers leave)
- Modify: `face/client/js/router.js` (a markets id is everything after `#/markets/`, `toHash` writes it raw; `trade` → Messages; account tabs `portfolio`, `venues`), `face/client/js/app.js` (`routeOf` keeps `markets`; boot starts `startMarkets` with the wire factories and `win.localStorage`, calls `show(route.screen === 'markets' && !doc.hidden)` on every route change and `visibilitychange`; the data-actions below; `prefsOf`/`initialState` lose `watch`), `face/client/js/reducers/messages.js` (`nav` canonicalises a markets id with `canonicalId`; an invalid one opens Markets), `face/client/js/render/rail.js` (Markets → `#/markets`, current on that screen), `face/client/js/data/empty.js` (`markets` keeps only the Task 5 fields plus `tab`, `sort`, `q`; `trade` leaves), `face/client/css/app.css`
- Delete: `face/client/js/render/trade.js`, `face/tests/client/trade.test.js`, the old `face/tests/client/markets.test.js`
- Test: `face/tests/client/markets.test.js` (new), `face/tests/client/app.test.js`, `face/tests/client/app-dom.test.js`, `face/tests/client/rail.test.js`, `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 4's views, Task 5's `startMarkets` and reducers (`setMarketsTab`, `setMarketsSort`, `setMarketsQuery` are kept, with the new tab and sort ids).
- Produces: `renderMarketsScreen(state, now): string`; data-actions `mkTab`, `mkSort`, `mkQuery` (input `#mq`: `setMarketsQuery` + `markets.search`), `mkClear`, `toggleWatch` (`data-id`), `openMarket` (`data-id` → `#/markets/<id>`).
- The screen: `<main class="main mkts">`, h1 `Markets`, the search box (`#mq`, placeholder `Search markets`), the tabs, the sort seg (two or more rows), and one table — the star (`Watch AAPL` / `Stop watching AAPL`), the name button (`mkAv`, the name, `AAPL · NASDAQ`, a `Held` tag), Price (`price(quote.price, asset.currency)`), Change (`chgHtml(quote.change_pct)`), Volume (`volumeWord`), and the muted `quoteWord`; with a query, `N markets for “q”` and Clear; `connectionWord`, `searchWord` and `watchWord` as muted one-liners; no rows and no query: `Nothing watched yet`. No Where column, no Trade or Connect key, no prediction cards.

- [ ] **Step 1: Write the failing tests.**
  - markets.test.js (rendered from built states): `"rows are the watchlist and the holdings with their quotes"`; `"price in its currency: $189.24, ¥1,688.00; null fields draw —"`; `"the star's state and words"`; `"tabs and sorts as labelled; Stocks shows us and cn"`; `"while searching the hits are the rows, with their REST quotes; the count and Clear show"`; `"no Chinese reaches the HTML"` — the state carries `message: "该标的暂无 Alpaca 行情"`, a search note and a provider message: `/[㐀-鿿]/` never matches; `"the connection word shows while polling and not while streaming"`; `"no Trade, Connect, Where, Buy or Sell"`.
  - app.test.js: `routeOf('#/markets/us:AAPL')` keeps markets; `parseHash('#/markets/crypto:BTC/USD').id === 'crypto:BTC/USD'` and `toHash` writes it back; `settle('#/trade')` → `#/messages`; the prefs never carry `watch`.
  - app-dom.test.js (fake live quotes and search through `host`): `"typing in the search box searches; a star watches and writes the face's key; a row opens its page"`; `"leaving Markets pauses the quotes and coming back resumes them"`; `"#/markets/garbage opens Markets"`.
  - rail.test.js: Markets links `#/markets` and is current on the Markets screen.
  - css.test.js: `everyState` gains the list empty, with rows, searching, failed search and polling; every emitted class has a rule.
- [ ] **Step 2: Run them** — `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement**; delete Trade and the demo Markets (`render/trade.js`; the Trade and demo reducers; the `trade` slice; Trade's CSS `.tp-*` / `.tk-*` and the demo-only `mk-*` rules — prediction cards, venues, Across). `trade.js` and `data/markets.js` stay until Task 8: the Account panels still import them.
- [ ] **Step 4: Run them again** — `npm test`. Expected: PASS; `grep -rn "render/trade\|setTradeKind\|INTERVALS" face/client/js face/tests/client` → empty.
- [ ] **Step 5: Commit** — "client: Markets on the face's watchlist, quotes and search; the demo Markets and Trade leave".

### Task 7: The Market page and its chart

**Files:**
- Create: `face/client/js/render/chart.js`
- Modify: `face/client/js/render/markets.js` (`marketPage`), `face/client/js/app.js` (open a page → `markets.bars(id)`; `handToGravit`), `face/client/css/app.css`
- Test: `face/tests/client/markets.test.js`, `face/tests/client/chart.test.js` (new), `face/tests/client/app-dom.test.js`, `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: `assetFor`, the words, `mentionsOf`, `barsWord` (Task 4); `portfolioOf`, `statementOf` (Task 4); `markets.bars` (Task 5); `startDraft` (stage 1).
- Produces: `chartSvg(rows: Array<{date: string, close: number|null}>, {currency}): string` — `''` with fewer than two finite closes; else the area and line paths (the demo `chart()`'s geometry and classes `mk-chart`, `mk-chart-area`, `mk-chart-line`, `mk-axis`), aria-label `Daily closes from <first> to <last>: from <p0> to <pN>, low <lo>, high <hi>`. Data-action `handToGravit` (`data-id` → a new message in the root channel with `Look at AAPL (Apple)` in the composer).
- The page `#/markets/<id>`: `‹ Markets`; the head (`mkAv` large, the name, `Stock · AAPL · NASDAQ` / `A-share · 600519 · SH` / `Crypto · BTC/USD`) with Hand to Gravit and Watch / Watching; the big price, `chgHtml(change_pct)` with `basisWord`, the as-of time and `quoteWord`; facts Previous close, Volume, Source; **Price history** for a `us` id once its bars hold two closes (`chartSvg` and the muted `barsWord`), absent otherwise; **You hold** (`5 shares · $600.00` and today's change, or `You don’t hold any.`); **On the statement** (up to 8 filled orders on the symbol; Task 8 adds its `Open the Statement →` key, once Account is a route); **Gravit on it** (`mentionsOf` as links to `#/messages/<id>`, absent when empty).

- [ ] **Step 1: Write the failing tests.**
  - chart.test.js: `"fewer than two closes draw nothing"`; `"the path spans the box and the aria-label names the range"`; `"null closes are skipped"`.
  - markets.test.js: `"a us page: price, change against the previous close, facts, the chart with its source stamp, holdings, the statement and Gravit on it"`; `"a crypto page: 24h basis, no Price history"`; `"a us page whose bars failed, or hold fewer than two closes, draws no Price history"`; `"a valid id on no list opens by its symbol with No quote"`; `"host conversations without demo fields never break the page"` — conversations shaped as `host/sessions.js` makes them, one titled `Is AAPL breaking out?`; `"a bed-served chart is stamped PIT bed · as of"`.
  - app-dom.test.js: `"opening a us page reads /data/bars once; a crypto page reads none"`; `"Hand to Gravit opens New message with the words in the composer"`.
  - css.test.js: `everyState` gains the us page with a chart and the crypto page.
- [ ] **Step 2: Run them** — `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again** — `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: the Market page, with daily bars from /data/bars".

### Task 8: Account on screen; the demo Account leaves

**Files:**
- Rewrite: `face/client/js/render/account.js` (`renderAccountScreen`, the Statement drawer, Venues; `renderSettings` kept), `face/client/js/reducers/account.js` (`setMode` leaves; the memory reducers stay for Discover's Like shelf until stage 3)
- Modify: `face/client/js/render/markets.js` (the page's `Open the Statement →` key), `face/client/js/app.js` (`routeOf` keeps `account`; boot starts `startAccount` and calls `load()` at boot, on entering Account, on Refresh and from `onReceipt`; `describe()` on entering Venues; data-actions `refreshAccount`, `openStatement`, `closeStatement`, `exportStatement`; Escape closes the Statement; the memory handlers and `commitEdit`'s memory branch leave with the Memory tab), `face/client/js/render/rail.js` (Account → `#/account/portfolio`, current on Account, with an `.account-line` of the net worth once known), `face/client/js/reducers/messages.js` (`closeOverlays` and `nav` close the Statement instead of the old panels), `face/client/js/reducers/controls.js` (the Move, Receive and Connect panel reducers leave), `face/client/js/data/empty.js` (`account` keeps only the Task 5 fields), `face/client/css/app.css`
- Delete: `face/client/js/trade.js`, `face/client/js/data/markets.js`, the old `face/tests/client/account.test.js`
- Test: `face/tests/client/account.test.js` (new), `face/tests/client/controls.test.js`, `face/tests/client/reducers.test.js`, `face/tests/client/app-dom.test.js`, `face/tests/client/rail.test.js`, `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 4's `portfolioOf`, `orderLine`, `statementOf`, `csvOf`, `venueOf`, `providerWord`; Task 5's `startAccount`.
- Produces: reducers `openStatement` and `closeStatement` (reducers/account.js; one drawer at a time, as `openSettings` is); the Market page's `Open the Statement →` key (data-action `openStatement` → `#/account/portfolio` with the Statement open).
- The screen `#/account/<portfolio|venues>`: the head `Account`, a `Paper` / `Live` chip, Refresh, Settings; tabs Portfolio · Venues. **Portfolio**: Net worth (`money`), Today (`signedMoney` and `pct`, `up`/`down` by `sign`), the allocation bar and legend, the holdings (each linking `#/markets/<id>`, its quantity, value and today's change), Orders under Working / Filled / Closed / Other (`orderLine`; `No orders`), and a Statement key; keyless: `No APCA keys in the environment` in place of the numbers; failed with nothing loaded: `Account unavailable` and Retry; `stale`: the muted `As of 14:32 · stale`. **Statement** (a drawer): `The 50 most recent orders`, the filled rows, Export CSV (a `statement.csv` download through `win.Blob` and `win.URL.createObjectURL`, revoked after the click), `No filled orders` when empty. **Venues**: one Alpaca row — the host, `Keys · env` / `No keys` / `Keys unknown`, `Order tools on` / `Order tools off` / `Order tools unknown` — then Quotes with one `providerWord` per probed provider. No Guard | Beast, no Trading-on chip, no Move, Receive, Connect or Memory.

- [ ] **Step 1: Write the failing tests.**
  - account.test.js: `"Portfolio from a keyed payload: net worth, today with its sign, the bar, holdings linking their market, orders by bucket"`; `"the keyless face says No APCA keys in the environment and draws no numbers"`; `"a 503 with nothing loaded: Account unavailable and Retry; with data loaded: the data and no error"`; `"a stale payload carries its stamp"`; `"the Statement drawer: its rows, the 50-orders line and Export CSV"`; `"Venues: keys and order tools, each unknown until read, then the providers"`; `"no Chinese ever reaches the HTML"` — an account `error` and provider messages in Chinese; `"no Guard, Beast, Trading on, Move, Receive, Connect or Memory"`.
  - app-dom.test.js: `"the account loads at boot and the rail shows the net worth"`; `"Refresh reloads; entering Venues describes once"`; `"Export CSV hands the browser a blob with the statement and revokes it"` (the test wraps `f.win.Blob` to capture the parts); `"a receipt in a conversation reloads the account"`; `"Open the Statement on a Market page lands on Account with the Statement open"`.
  - rail.test.js: Account links `#/account/portfolio`, current on Account, with the net worth.
  - controls.test.js / reducers.test.js: the panel and `setMode` tests leave; rename, confirm and one-drawer-at-a-time stay, the last now with the Statement.
  - css.test.js: `everyState` gains Portfolio keyed, keyless and failed, the Statement open, and Venues.
- [ ] **Step 2: Run them** — `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement**; delete what no longer has an importer (`grep -rn "trade.js\|data/markets.js" face/client/js face/tests/client` → empty) and the dead CSS (`move-form`, `receive*`, `qr`, `mem-*`, `switch*`, the `.director*` leftovers).
- [ ] **Step 4: Run them again** — `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: Account on the face's paper account; the demo Account leaves".

### Task 9: The old pages leave

**Files:**
- Delete: `face/client/{market.html,account.html,market.js,account.js,account-view.js,navigation.js,chat.css,market.css,account.css}`, `face/scripts/capture-demo-assets.mjs`
- Modify: `face/src/static.ts` (`PAGES` holds `/` alone; the header's page list), `face/client/js/market-fmt.js` (only what the screens import stays) with `face/tests/client/market-fmt.test.js`
- Test: `face/tests/static.test.ts`, `face/tests/smoke.test.ts` (the `/market` assertion), `face/tests/gravit-client-smoke.test.ts`

- [ ] **Step 1: Write the failing tests** — static.test.ts: the routes are exactly `exact /` and `prefix /client`, and `/market` and `/account` reach no route; gravit-client-smoke: `/client/js/wire/market-quotes.js` and `/client/js/host/markets.js` are served as JavaScript, `/market` and `/account` are 404; smoke.test.ts: the boot smoke's `/market` check becomes a 404.
- [ ] **Step 2: Run them** — `npx tsx --test tests/static.test.ts`. Expected: FAIL (two page routes still registered).
- [ ] **Step 3: Delete and edit** as listed.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, then `FACE_SMOKE=1 npm test`. Expected: PASS; `grep -rln "market.html\|account.html\|chat.css\|navigation.js" face/src face/client face/tests` → empty.
- [ ] **Step 5: Commit** — "face: /market and /account leave; the client at / is the only page".

### Task 10: Documents and the manual look

**Files:**
- Modify: `DEVELOPMENT.md` (§1's face routes; §3.5's scripts table gains `face_bars.py`; §4.4's route table loses `/market` and `/account` and gains `/data/bars`; §5 — Markets, the Market page, Account, the two host layers, the views, the wire modules; §7 — the new tests and the counts; the env index where `ALPHA_PIT_ROOT` is now read by the face's producer too), `face/README.md` ("Market and Account" rewritten for the new screens; "Data routes and caches" gains `/data/bars`; the landing-page section — the capture helper left with the pages it served, the three images stay; the counts), `CLAUDE.md` (the `face/` row serves the one page; the `face/client/` row's stage; the `scripts/` row gains `face_bars.py`), `docs/superpowers/plans/2026-10-19-gravit-face-ledger.md` (a "Stage 2" section: the rulings, the manual look, deferred minors)

- [ ] **Step 1: Update the documents**; `grep -rn "/market\b\|/account\b\|market.html\|account.html" CLAUDE.md DEVELOPMENT.md face/README.md` → only historical mentions and the landing page's redirects.
- [ ] **Step 2: The manual look** — the face on the scratch home (no keys, no bed), in the browser pane: Markets empty; search `AAPL`, watch it (US quotes read Not configured); watch `BTC/USD` (Coinbase, live); the AAPL page with no Price history; Account reads No APCA keys in the environment; Venues shows No keys and the providers; `/market` is 404. Record it in the ledger; stop the server.
- [ ] **Step 3: Commit** — "docs: Markets and Account on the face, stage 2".
