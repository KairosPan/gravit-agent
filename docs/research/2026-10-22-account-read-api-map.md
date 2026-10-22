# Linqi's Account — the READ side of its HTTP API, mapped for a server-side consumer

Read from `/Users/pan/buyer-agent-demo` (buyer-agent-demo @ the checkout installed 2026-10-20) on 2026-10-22 without running
anything. Sources: `src/portfolio/server.ts` (routes, fence, status codes), `src/portfolio/service.ts` (every read's logic, caches,
timeouts and the view interfaces), `src/portfolio/account/{exchange,stream,statement,holdings,networth,paper-equity,desk,memory,state,
mode-rules,costbasis,live-orders,payments,live-earn}.ts`, `src/portfolio/live/{trade,explore,compare,availability,reach,stream-hub,
earn,public-markets,paper,history,categories,icons,index,exchange,types}.ts`, `src/core/errors.ts`, `src/portfolio/refuse.ts`, the page
scripts `src/portfolio/public/ui/{core,shell,stream,markets,portfolio,chart,live,book,terminal,trade,statement}.js`, and the tests
`test/unit/{server-guard,account-stream,ui-markets,ui-portfolio,ui-statement,live-availability}.test.ts` + `test/standin/*`.

Everything quoted in `code` is verbatim from the source. Anything I could not read directly is marked **(inferred)**. Nothing below
was observed from a live server: it is what the code says it answers.

Conventions used here: `Refusal` is the shape in §1.3; "409 refusal" means `{ ok: false, refusal: Refusal }` with HTTP 409;
"400 error" means `{ ok: false, error: string }` with HTTP 400. Timestamps are ISO-8601 strings unless a field says `ms`.

---

## 1. The fence

### 1.1 What every `/api/*` request must and must not carry

`server.ts` registers, in this order: (a) a header middleware, (b) the page's static files (`/`, `/account`, `/portfolio.js`,
`/portfolio.css`, `/account.css`, `/owner.js`, `/ui/<name>.(js|css)`, `/fonts/<name>.woff2`), (c) **the fence**, (d) the JSON body
parser, (e) every `/api/*` route. So the static files are NOT fenced; every `/api/*` route is. The fence, verbatim:

```ts
app.use((req, res, next) => {
  const host = String(req.headers.host ?? "");
  const local = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host);
  const origin = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  const navigable = !req.path.startsWith("/api/") || req.path === "/api/account/signin/callback";
  const topLevel = req.headers["sec-fetch-mode"] === "navigate" && req.headers["sec-fetch-dest"] === "document" && req.method === "GET" && navigable;
  const foreignOrigin = typeof origin === "string" && origin !== `${req.protocol}://${host}`;
  const foreignSite = (site === "cross-site" || site === "same-site") && !topLevel;
  if (!local || foreignOrigin || foreignSite) return void res.status(403).json({ ok: false, error: "this server answers only its own pages on this machine" });
  next();
});
```

For a Node app fetching `http://127.0.0.1:4820/api/...` over loopback this means:

| Header | Must | Must not |
|---|---|---|
| `Host` | be `127.0.0.1[:port]`, `localhost[:port]` or `[::1][:port]` (case-insensitive). Node's `fetch` sets it from the URL, so `http://127.0.0.1:4820` passes. | be anything else (a DNS name → 403). |
| `Origin` | be absent, or exactly `http://127.0.0.1:4820` (`${req.protocol}://${host}`; `req.protocol` is `http` — no `trust proxy` is set). | be `null`, another origin, or a different spelling of the same host (`http://localhost:4820` with Host `127.0.0.1:4820` → 403). |
| `Sec-Fetch-Site` | be absent, `same-origin` or `none`. | be `cross-site` or `same-site` (403, except a top-level GET navigation to a non-`/api` path or the sign-in callback). |
| `Sec-Fetch-Mode` / `Sec-Fetch-Dest` | anything for ordinary routes. **For `GET /api/account/stream` only:** must NOT be `navigate` / `document` (a second check in that route → 403, see §3). | |

`test/unit/server-guard.test.ts` confirms: no headers → 200; `origin: srv.url` → 200; `origin: https://evil.example` → 403; `origin: "null"`
→ 403; `sec-fetch-site: cross-site` (+ no-cors/image) → 403; `sec-fetch-site: same-origin, sec-fetch-mode: cors, sec-fetch-dest: empty`
→ 200; a cross-site *navigation* reaches `/` (200) and `/api/account/signin/callback` (400 — it ran) but not `/api/account` (403) nor
`/api/account/stream?client=…` (403). The test comment notes Node's `fetch` "puts its own sec-fetch-mode on every request" (undici sends
`sec-fetch-mode: cors`), which is fine.

There is no token, cookie or key on any read route. The fence is the only guard on reads ("that is not authentication: a program on
this machine that sends the header is answered", per the `/brain-test` comment). Writes are signed envelopes at `POST /api/exchange`
and are out of scope here.

### 1.2 Headers the server sets

- First middleware: `cache-control: no-store` on every path starting with `/api/`, `no-cache` elsewhere. Express adds a weak ETag to
  whole JSON answers; the page files carry `W/"<sha256[0:16]>"` ETags and `?v=<hash>` names kept a year (not relevant to the consumer).
- The SSE route writes `content-type: text/event-stream; charset=utf-8`, `cache-control: no-store`, `connection: keep-alive`,
  `x-accel-buffering: no` and sets `socket.setNoDelay(true)`.
- `--classic` servers (no account layer) answer every `/api/account/*` route `404 { ok:false, error:"the account layer is not mounted" }`
  (some say `"… (--classic)"`). The default `npm run account` always mounts the layer.

### 1.3 Refusal and error shapes, by status

```ts
// src/core/errors.ts
export type Layer = "MOUNT" | "MANDATE" | "CARD" | "GATE" | "SIGNER" | "WALLET" | "VENUE" | "ACCOUNT" | "PAYEE";
export interface Refusal {
  ok: false;
  code: Code;            // `E_<LAYER>_<REASON>`, one of the keys of CODES (e.g. E_VENUE_GEOBLOCKED, E_ACCOUNT_BAD_ACTION, E_WALLET_ACCOUNT_UNKNOWN)
  layer: Layer;
  /** one line for the screen, Chinese */   // in practice English: every portfolio refusal is raised through refuse.ts `no()`, which supplies the English sentence
  message: string;
  venue?: string;
  tool?: string;
  /** structured facts the model can act on (never secrets) */
  detail?: Record<string, unknown>;
  /** the venue's own error, verbatim */
  native?: unknown;
}
export function isRefusal(value: unknown): value is Refusal   // ok === false && typeof code === "string" && code in CODES
```

| HTTP | Body | When |
|---|---|---|
| 200 | `{ ok: true, ...view }` or `{ ok: true, <key>: view }` | the read answered (see each route for which). `/api/now` and `/api/read` too. |
| 400 | `{ ok: false, error: string }` | a malformed query: a param given twice (`"<k>" is given more than once`), a non-digit `limit`/`depth`/`since`, a bad `connector` list, a bad `client` id, bad `pairs`. |
| 401 | `{ ok: false, refusal: Refusal }` | owner-only / signed-only routes called unsigned (`/api/say`, `/api/approve`, `/api/execute`, `/api/order`, `/api/restore`, `/api/reset`, `/api/mode {open}`): codes `E_ACCOUNT_OWNER_SURFACE` or `E_ACCOUNT_BAD_SIGNATURE`. Not a read concern. |
| 403 | `{ ok: false, error: "this server answers only its own pages on this machine" }` | the fence; also a navigation to the stream. `/api/account/brain-test` adds its own 403 sentence. |
| 404 | `{ ok: false, error: string }` | account layer not mounted; `"this account keeps no desk"` (desk routes when `svc.desk` is undefined — only when the service was created without `real`; the real server always has one); `"no stream of that page is open: …"` (`POST /stream/markets`). |
| 409 | `{ ok: false, refusal: Refusal }` | the service answered a `Refusal` (every `answerOf(...)` route), a thrown refusal inside a route, `/api/markets` and `/api/quote` on the real account (`E_ACCOUNT_BAD_ACTION`, "this account holds real accounts only: Markets is GET /api/account/explore, a price is GET /api/account/market"). |
| 500 | `{ ok: false, error: "The account hit an error answering this; it was recorded." }` | any other exception (`wrap`); the stack goes to the server's stderr, never to the client. |
| 503 | `{ ok: false, error: "this account has N pages listening already: close a tab of it, and this one listens again on its next try" }` | the stream when 32 are open. |
| 4xx (parser) | `{ ok: false, error: "The body of this request could not be read as JSON; it was not kept." }` | a POST body that is not JSON / too large / an unsupported encoding (`express.json({ inflate: false })`). |

Several reads also carry **per-item** refusals inside a 200 (e.g. `/quotes` returns `{venue, symbol, refusal}` rows; `/positions`,
`/holdings`, `/explore`, `/compare`, `/earn`, `/funding`, `/asset`, `/sellable` carry a `missing: ReadMissing[]` list naming the venues
that did not answer). Always check `body.ok === false` first (the page's `refusalOf(body)` reads `body.refusal.message || body.error`).

### 1.4 Query-string rules shared by the routes

`strings(req, res, { name: maxLen, … })`: every named param is read as a string, cut to `maxLen` characters, `""` when absent; a param
given twice (array) → 400 `"<name>" is given more than once`. Unknown params are ignored. Only `/quotes` uses a different reader
(`pairs` and `pair` may repeat).

---

## 2. The routes, one by one

Order follows `server.ts`. "Cache" = the service's `ReadCache` (`marketReads.get(key, ttlMs, …)`): one in-flight read per key is shared,
the answer kept `ttlMs`, a refusal that "holds back" (geoblock, rate limit, ban, no answer) is kept 20 s (`FAIL_KEEP_MS`) and the venue
is held — further reads answer the held refusal at once — for `holdBackMs(r)` (10 min for a place rule, the venue's own `Retry-After`/ban
time, else 20 s). At most `PER_VENUE = 2` reads of one venue are in flight; others queue. Every venue read records `VenueHealth`.

### 2.1 `GET /api/overview`

- Query: none.
- Side effects: `await svc.account?.settle()` (expires cards, settles due payments, **polls every real venue's orders/payments/earn**, bounded
  by a 3 s race — see §6), then `svc.overview()`.
- Response (real account): `Overview` with the simulation-only fields removed, plus route extras:

```ts
export interface Overview {
  now: string;
  live: boolean;                         // real: whether any venue connected live is on the account
  mode: Mode;                            // "open" | "guard"
  session: { expiresAt: string; expired: boolean };
  portfolio: Aggregate;                  // { totalUsd, byClass: [{class,label,usd,pct}], byAccount: [{account,name,kind,kindLabel,live,usd,pct,holdings: Holding[]}] }; totalUsd replaced by the account page's total
  liquidity: Liquidity;                  // { mobileUsd, stuckUsd, mobile: LiquiditySource[], stuck: StuckSource[] } (LiquiditySource = {account,name,asset,chain?,usd}; Stuck adds `why`)
  ladder: Ladder;                        // REMOVED on the real account by the route (`const { ladder, ...real } = o`)
  accounts: AccountView[];               // Account & { kindLabel, enforcerLabel, reach: Capability[], revoked, usd, holdings: Holding[], readError? } — NOTE: Account carries `credentialRef` (a path)
  compiled?: OpennessRow[]; openness?: Openness; daily?: {used,cap};   // absent on the real account
  approvals: Approval[];                 // route adds `hash: cardHash(a)` to each
  flights: Flight[];                     // last 40
  agents: Array<AgentId & { flights: number }>;
  ledger: LedgerRow[];                   // newest 80; route strips `envelope` and adds `signed: true` where one was (see §5.5)
  chain: { ok: boolean; rows: number; at?: number };
  counters: { writes: number; refusals: number; cards: number };
  ledgerPath: string;                    // an absolute filesystem path
}
// the route then adds: presets: PRESETS (["Subscribe $5,000 OUSG","Sell 3 ETH","Buy 1,000 YES · Fed hike","Rebalance","Withdraw to cold wallet","Send to a new address"]), accountLayer: true
```

- No `ok` field at the top level (it is the bare Overview object). Errors: 500 only. Latency: bounded by `settle()` (≤ 3 s) plus the venue
  balance reads behind `views()`/`accountView()`.
- This is the legacy statement page's read; for the Account screens `/api/account` is the one the page uses.

### 2.2 `GET /api/now`

- `{ ok: true, now: svc.now() /* ISO */, ms: Date.parse(now) }`. The service's clock (real time on the real server). No fence issues, no
  side effects. Signers take their nonce from here.

### 2.3 `GET /api/account` — the page's main read

- Query: none. Side effects: `accountView()` → `account.view()` → **`settle()`** (same venue poll as overview, 3 s race) and
  `withEarnings()` (each earning venue's positions, 3 s cap per venue in parallel).
- 404 when not mounted. Otherwise `{ ok: true, ...realPage(view), mode, live, dial, health, memoryAsks, agentSetup }` where `realPage`
  (real account) is the `AccountPage` with top-level `destinations` removed, each venue row stripped of
  `runways, agentKey, in, out, swaps, fiat, ledgers`, and `DOOR_LISTS` spread in: `dollars: string[]` (the `STABLES` set: `"USD", "USDC",
  "USDC.E", "USDT", "USDT0", "USD₮0", "USD₮", "FDUSD", "PYUSD", "DAI", "TUSD", "USDP", "PUSD", "USDG"`), `networks: string[]` (the chains
  stablecoins travel on), `bridgeChains: string[]`.

The whole `AccountPage` is reproduced in §5.1. The route-level extras:

```ts
mode: Openness["mode"]                   // "open" (Beast) | "guard" (Guard)
live: boolean                            // svc.live: the --classic mm flag; false on the real account
dial: { sessionExpiresAt: string; sessionEnded: boolean; revoked: string[]; maxLeverage: number /* 1 unless signed */ }
health: Record<string /* venue id */, VenueHealth>   // only venues connected live
memoryAsks: Array<{ agent: string; agentName: string; id: string; topic: "style"|"rules"|"venues"; text: string; how?: string; at: string }>
agentSetup: { command: string; url: string }          // `claude mcp add portfolio -e PORTFOLIO_URL=<origin> -- npx tsx <abs path to mcp.ts>` — contains an absolute path of the install
```

```ts
export interface VenueHealth { lastOkAt?: string; lastFailAt?: string; code?: string; message?: string; ms?: number }
```

- Example (the shape, from `test/unit/ui-portfolio.test.ts`'s fixture, which the test calls "an account as /api/account says it"):

```json
{ "ok": true, "now": "2026-10-06T12:00:00.000Z", "liveUsd": 12000, "inFlightUsd": 0, "mode": "guard",
  "connectLive": { "writes": { "on": true, "capUsd": 250, "turnOn": "npm run account" }, "home": "/home/x",
    "options": [ { "kind": "exchange", "connector": "live:exchange", "label": "Exchange account · API key", "needs": "key-file", "venues": ["okx","kraken"] },
                 { "kind": "kalshi", "connector": "live:kalshi", "label": "Kalshi · event contracts", "needs": "key-file", "venues": [] } ] },
  "dial": { "sessionExpiresAt": "2026-11-05T00:00:00.000Z", "sessionEnded": false, "maxLeverage": 5, "revoked": [] },
  "venues": [
    { "id": "ex", "name": "Exchange", "live": true, "usd": 9000, "holdings": [], "trade": { "can": true, "what": "spot and perpetuals", "positions": true },
      "liveCan": { "withdraw": true, "ledgers": ["spot","futures"], "transfer": true, "swap": true, "receive": true, "send": false }, "plugged": true, "asOf": "2026-10-06T11:58:00.000Z" },
    { "id": "predict", "name": "Predictions", "live": true, "usd": 900, "holdings": [], "trade": { "can": false, "what": "event contracts", "positions": true }, "connector": "live:kalshi", "keyFile": "credentials/predict/api-key.json", "plugged": true },
    { "id": "agent-claude-code", "name": "Agent wallet · Claude Code", "live": true, "usd": 100, "holdings": [], "address": "0x90cd…", "proven": "this account holds its key", "plugged": true } ],
  "keys": [ { "address": "0x3a08…", "name": "Claude Code", "code": "CC", "status": "ok", "validUntil": "2026-11-05T00:00:00.000Z", "approvedAt": "2026-10-06T12:00:00.000Z" } ],
  "spend": [ { "id": "spend-0001", "agent": "0x3a08…", "scope": "trade", "allow": ["ex"], "perPaymentUsd": 150, "budgetUsd": 600, "spentUsd": 100, "reservedUsd": 0, "expired": false } ],
  "subAccounts": [ { "id": "sub-1", "name": "Claude Code", "agent": "0x3a08…", "agentName": "Claude Code", "address": "0x90cd…", "capUsd": 100, "balanceUsd": 0 } ] }
```
(The fixture omits fields the real answer always has: `type`, `totalUsd`, `heldUsd`, `payments`, `orders`, `earns`, `requests`, `fees`,
`cards`, `signers`, `activeKeys`, `pay`, `connectable`, `watch`, `intents`, `asks`, `declinedAsks`, `modeRules`, `real`, `health`,
`memoryAsks`, `agentSetup`, `dollars`, `networks`, `bridgeChains`.)

- Latency: `settle()` ≤ 3 s + earnings ≤ 3 s; the venue balances themselves are read in the background by each adapter and served from
  their last read (`asOf`/`stale`), so a normal call is fast. The page reads it every 20 s (80 s while the stream is connected) and after
  every pushed burst.

### 2.4 `GET /api/account/exchanges`

- `{ ok: true, exchanges: Array<{ id: string; name: string; needs: string[] }> }` — ccxt's exchange list, ranked with a few first
  (`FIRST`), each with the credential field names it requires; exchanges keyed by wallet (`privateKey`/`walletAddress`) are left out.
- Latency: **loads the ccxt library on first ask** (seconds); the promise is memoised for the process lifetime. Not fenced beyond §1.

### 2.5 `GET /api/account/paper/books`

- `{ ok: true, books: PaperBookSummary[] }` — the paper books on disk (`<home>/paper/<venue>/book.json`) **not** currently connected.

```ts
export interface PaperBookSummary { venue: string; name: string; cashUsd: number; startCashUsd: number; addedUsd: number; createdAt: string; updatedAt: string; holdings: number; positions: number; open: number }
```
- Reads the disk on every call (every book file parsed). Cheap.

### 2.6 `GET /api/account/keyfile?kind=&venue=&ref=&exchange=`

- Params (each ≤ 200): `kind` (a connector kind: `exchange`, `alpaca`, `alpaca-paper`, `kalshi`, `polymarket-us`, `robinhood-crypto`,
  `polymarket-trade`, `hyperliquid-trade`, `hyperliquid-paper`), `venue`, `ref` (path, default `defaultKeyRef(venue)`), `exchange` (with
  `kind=exchange`: the ccxt id, to learn the extra fields it needs — triggers `exchangeList()`).
- `{ ok: true, ready: boolean; path: string /* absolute */; fields: string[]; message: string; missing?: string[]; mode?: string }`.
  Field names only; never a value. Reads the key file from disk. A kind with no shape: `ready:false`, `message: "a <kind> connection does
  not read a key file"`.

### 2.7 `GET /api/account/venues[?force=1]`

- `{ ok: true, venues: VenueHere[] }` — where this user can connect, every venue the account knows, judged from the network it runs on.

```ts
export type Verdict = "connectable" | "not-served" | "close-only" | "terms-exclude" | "setup" | "closed" | "no-answer";
export interface VenueHere {
  connector: string;                 // `live:exchange:okx`, `live:kalshi`
  name: string;
  group: "Exchanges" | "Brokers" | "Wallets" | "Markets and tokens" | "Paper";
  needs: "key-file" | "sign-in" | "address" | "cli" | "none";
  verdict: Verdict;
  said?: string;                     // the venue's own words when not connectable
  terms?: TermsLine & { excludesHere?: boolean; servesHere?: boolean };   // TermsLine = { url, read, says, note?, via?, unread? }
  connected: boolean;                // on the account now (or waiting)
  waiting?: string;                  // why it waits and when it is asked again
  readOnly?: boolean;                // read by address
  edition?: { connector: string; name: string; said: string };
  asked?: string;                    // ISO; absent when nothing answered
}
```
- The list is `venueCatalog(liveOptions(home).options)`: with an `exchange` option present, one row per `KNOWN_EXCHANGES` id
  (`okx, okxus, kraken, coinbase, bybit, binance, binanceus, kucoin, gate, bitget, mexc, deribit, krakenfutures, kucoinfutures, cryptocom,
  gemini, bitstamp, bitfinex, htx`, group Exchanges, key-file), then every other connector kind (`KIND_HERE` names/groups, else the label's
  first part and "Markets and tokens"). Example from `live-availability.test.ts`: `live:exchange:binance` → `{verdict:"not-served",
  group:"Exchanges", needs:"key-file", said: "…Service unavailable from a restricted location…"}`; `live:kalshi` → `{verdict:"connectable",
  group:"Markets and tokens"}`; `live:metamask` → `{verdict:"connectable", group:"Wallets", needs:"cli"}`; `live:wallet` → `needs:"address"`.
  The country/region is never in the answer (the test asserts the JSON does not contain it).
- Cache/latency: kept 30 min when every venue answered and the place was learned (`sure`), else 20 s and re-asked in the background;
  `force=1` re-probes every connector now **and re-learns the place**. A cold or forced call probes every venue in parallel: each HTTP
  probe 6 s (`PROBE_MS`), the Hyperliquid probe also waits for the place up to `PLACE_BUDGET_MS = 4*6000+500 = 24.5 s`, mm's `auth status`
  up to 8 s — so **a cold/forced call can block ~25 s**. The real server runs `watchVenues()` (every 30 min) so the list is usually warm.
  Nothing is written; no key is sent.

### 2.8 `GET /api/account/connect/reach?connector=a,b[&force=1]`

- `connector`: 1–24 comma-separated connectors, each matching `/^live:[a-z0-9-]{1,40}(?::[a-z0-9-]{1,40})?$/` (else 400 "connector is a
  comma-separated list of 1 to 24 connections, like live:exchange:okx,live:kalshi"). `{ ok: true, reach: Reach[] }`.

```ts
export type ReachState = "ok" | "location" | "close-only" | "setup" | "closed" | "unreachable";
export interface Reach { connector: string; state: ReachState; said?: string; at: string; until?: number /* ms */; ban?: true }
```
- Kept per connector: `location|close-only|closed` 10 min, `ok` 2 min, `setup` 5 s, `unreachable` 20 s or until the venue's ban/wait
  (≤ 1 h). Same probe costs as §2.7 (6 s each; HL up to 24.5 s). A venue that banned this address is not re-asked even with `force=1`.

### 2.9 `GET /api/account/statement`

- Side effect: `await svc.account.settle()` (3 s race). `{ ok: true, lines: StatementLine[] }`, newest first, one line per transaction
  (the last line written for each `key`), across every ledger file in the home (older files cached by size).

```ts
export interface StatementLine {
  key: string;            // `order:<clientId>` | `payment:<run>:<id>` | `paper:<venue>:<ref>`
  id: string;             // ord-0001, pay-0001, earn-0001, or a paper fill's ref
  at: string; updatedAt: string;
  type: "trade" | "transfer" | "earn";
  kind: string;           // buy · sell · withdraw · deposit · send · transfer · swap · bridge · supply · withdraw (earn) · pay
  account: string; accountName: string;
  to?: string; toName?: string;
  description: string;    // "Buy 0.5 SOL · SOL / USDT · limit 142.44 · at 141.9 · 0.2 of 0.5 filled" — prices grouped en-US (may carry commas)
  amountUsd: number;      // trade: filled notional, buy negative; transfer: amount moved
  worthUsd?: number; feeUsd?: number; realizedUsd?: number;
  status: string;         // order: pending|open|partial|filled|canceled|rejected|expired|"waiting for wallet"|"not followed since a restart"|"not followed"; payment: …|settled|failed|returned|stranded|"waiting for wallet"; earn: pending|done|rejected
  by: string;             // "You" | "<agent name>, approved by you" | "<agent name>, inside its limit" | "The paper account" | "<name>, take-profit of ord-0001"
  agent?: string; agentName?: string;
  ref?: string;           // the venue's id or a tx hash
  paper?: true;
}
```
- Example (from `test/unit/ui-statement.test.ts`, "the lines as GET /api/account/statement gives them"):

```json
[ { "key": "o1", "id": "ord-0001", "at": "2026-10-05T14:00:00.000Z", "updatedAt": "2026-10-05T14:00:01.000Z", "type": "trade", "kind": "buy", "account": "ex", "accountName": "Exchange", "description": "Buy 0.01 BTC · market", "amountUsd": -620, "status": "filled", "by": "You" },
  { "key": "p1", "id": "pay-0001", "at": "2026-10-05T16:00:00.000Z", "updatedAt": "2026-10-05T16:05:00.000Z", "type": "transfer", "kind": "withdraw", "account": "ex", "accountName": "Exchange", "to": "wallet", "toName": "Wallet", "description": "Withdraw 50 USDC · Base", "amountUsd": 50, "feeUsd": 0.5, "status": "settled", "by": "You" },
  { "key": "earn:e1", "id": "earn-0001", "at": "2026-10-05T17:00:00.000Z", "updatedAt": "2026-10-05T17:00:02.000Z", "type": "earn", "kind": "supply", "account": "ex", "accountName": "Exchange", "description": "Supply 100 USDT · USDT Flexible · 5.2% APY", "amountUsd": 100, "status": "done", "by": "Claude Code, inside its limit", "agent": "0x3a08…", "agentName": "Claude Code", "ref": "purchase:USDT:abc" } ]
```
- The page reads it alongside `/api/account` on every `load()`; the Statement sheet filters by month (New York), account, type, agent.
  The terminal's history tabs ask it again with `ttl: 10_000`. A `statement` SSE event tells the page to re-read.

### 2.10 `GET /api/account/stream` and `POST /api/account/stream/markets` — see §3.

### 2.11 `GET /api/account/markets?venue=&q=`

- `venue` (≤ 120) a venue id connected live; `q` (≤ 120) a few letters. `{ ok: true, markets: Market[] }` (about 20; the trader's
  start-from list with `q` empty). 409 refusal when the venue is unknown (`E_WALLET_ACCOUNT_UNKNOWN`, `"<venue>" is not a venue connected
  live`) or trades nothing (`E_VENUE_RAIL_CLOSED`). Cached 60 s per (venue, q).
- Only connected venues: public venues' listings are `/explore`'s.

### 2.12 `GET /api/account/market?venue=&symbol=`

- `venue`, `symbol` (≤ 160). `{ ok: true, market: Market }` with a price ≤ 3 s old (`MARKET_KEEP_MS`). Same refusals as above.
- `Market` (live/trade.ts), the shape every price read shares:

```ts
export type MarketKind = "spot" | "perp" | "future" | "stock" | "crypto" | "event" | "token";
export interface Market {
  symbol: string;                           // `BTC/USDT`, `AAPL`, `BTC-USD`, `KXFED-25DEC-T4.00:YES`, `<slug>:<outcome>`, `WETH/USDC@Base`
  marginModes?: MarginMode[]; brackets?: boolean; statsFrom?: string;
  name: string; kind: MarketKind; base: string; quote: string;
  price?: number; bid?: number; ask?: number;
  minQty?: number; qtyStep?: number; priceStep?: number; minNotional?: number; contractSize?: number;
  open: boolean;
  session?: MarketSession;                  // { open: boolean; opensAt?; closesAt?; phase?: "pre"|"regular"|"after"|"overnight"|"closed"; phaseEndsAt?; extendedHours? }
  note?: string; leverage?: number; rule?: string;
  types: OrderType[];                       // "market" | "limit" | "stop" | "stop_limit" | "trailing_stop"
  refusesNow?: Partial<Record<OrderType, string>>; tifs?: TimeInForce[]; tifsByType?: …; postOnly?: boolean; reduceOnly?: boolean; sellsReduce?: boolean; maxLeverage?: number;
  changePct24h?: number; change24h?: number; volumeUsd24h?: number; contracts24h?: number;
  closeTime?: string; category?: string; group?: { id: string; title: string }; outcome?: string;
  fundingRate?: number; nextFundingAt?: string; fundingEveryH?: number;
  markPrice?: number; oraclePrice?: number; premium?: number; openInterest?: number; openInterestUsd?: number;
  issuer?: string; eligibility?: string;
  implied?: { perPoint: number; unit: string; usd?: number };
  quoteAt?: string; delayMs?: number; quoteFrom?: string;   // a price's own stamp and source ("Nasdaq · real time", "Cboe · 15 min delayed")
}
```

### 2.13 `GET /api/account/compare?base=&side=&usd=&asset=`

- `base` (1–40 chars, else 409 `E_ACCOUNT_BAD_ACTION`), `side` `sell` or anything else → `buy`, `usd` (> 0 optional), `asset` `stock|crypto`
  (else ignored). `{ ok: true, base, side, rows: CompareRow[], missing: CompareMissing[] }`.

```ts
export interface CompareRow { venue; venueName; symbol; name; kind: MarketKind; base; quote; price: number; priceIs: "ask"|"bid"|"last"; bid?; ask?; spreadPct?; open: boolean; canTrade: boolean|"unknown"; ready: boolean; qty?; fits?; minUsd?; note?; category?; worse?: number; best?: true }
export interface CompareMissing { venue; venueName; why: string; code?: string; scope?: string }
```
- Only venues connected live that trade; **paper accounts are excluded**; venues not serving this network excluded. Cached 15 s per
  (base, side, usd, asset); each venue has 4 s. The drawer asks `/compare?base=<base>&side=buy` (ttl 15 s) for coins/perps/stocks.

### 2.14 `GET /api/account/positions[?venue=]`

- Without `venue`: `{ ok: true, positions: VenuePosition[], missing: ReadMissing[] }` across every connected venue that lists positions;
  with `venue` (≤ 40): `{ ok: true, positions: Position[] }` (each with `paper: true` when the venue is a paper account; 409 refusal when
  the venue cannot be read). The route adds `icon?: string` (a logo URL, §2.16) to perps/futures.

```ts
export interface Position { symbol; name; kind: MarketKind; side: "long"|"short"; qty: number; entryPrice?; markPrice?; usd?; unrealizedUsd?; leverage?; marginMode?: "cross"|"isolated"; liquidationPrice?; costUsd?; marginUsd?; fundingUsd?; native: unknown }
export interface VenuePosition extends Position { venue: string; venueName?: string; paper?: true }
export interface ReadMissing { venue; venueName; why: string; code?: string; part?: "stats"|"positions"|"candles"|"compare"|"earn"|"funding" }
```
- Cached 15 s per venue. `native` is the venue's raw answer (can be large). The page reads it with ttl 8–10 s on Portfolio › Positions,
  Trade and the terminal; a `position` SSE event (paper books only) patches the kept copy in place.

### 2.15 `GET /api/account/funding?venue=&limit=`

- `limit` 1–500 (digits only, else 400), default 500; `venue` optional. `{ ok: true, lines: VenueFunding[], missing: ReadMissing[] }`,
  newest first. `VenueFunding = FundingLine & { venue; venueName; paper?: true }`, `FundingLine = { at; symbol; side?; qty?; price?; rate?;
  usd: number; quoted?: true }`. 409 when the named venue is unknown or lists no funding. Cached 30 s per (venue, limit).

### 2.16 `GET /api/account/explore?tab=&q=&key=&sort=&limit=` — Markets

- Params: `tab` one of `all|crypto|stocks|rwas|perps|preipo|predictions` (absent = every row); `q` ≤ 60 chars (route cuts at 80, service
  refuses > 60 with 409); `key` one row's own key (≤ 200; route reads 240 so a longer one is refused, not truncated); `sort` `volume|
  movers|closing`; `limit` 1–200 digits (default 60; 400 when not digits, 409 when out of range).
- `{ ok: true, ...Exploration }`:

```ts
export interface Exploration {
  asOf: string;
  tabs: Array<{ id: TabId; label: string; count: number }>;   // only tabs with something in them; "all" first
  items: ExploreItem[];
  movers: Mover[];                 // ExploreItem & { changePct24h: number; volumeUsd24h: number }
  closing: ExploreItem[];
  mostTraded: ExploreItem[];
  missing: ExploreMissing[];       // CompareMissing & { connected: boolean; part?: "markets"|"stats"|"events"; said?: string; symbol?: string }
  notes: string[];                 // sentences for under the list, each < 160 chars
}
export type ExploreKind = "coin" | "stock" | "perp" | "event" | "rwa";
export interface ExploreItem {
  key: string;                     // `coin:BTC`, `stock:AAPL`, `perp:ETH`, `rwa:NVDA`, `kalshi:<market ticker>`, `pm:<condition id>`, `pmus:<market slug>`
  kind: ExploreKind; name: string; base?: string;
  price?: number; quoteFrom?: string; quoteAt?: string;
  changePct24h?: number; change24h?: number; changeFrom?: { venue; venueName };
  volumeUsd24h?: number; contracts24h?: number; eventVolumeUsd24h?: number;
  category?: string; closeTime?: string; pastEnd?: boolean;
  event?: { id: string; title: string; market?: string };
  icon?: string;                   // an https image URL the page loads itself (Elbstream / Kalshi / Polymarket hosts / Google favicons); never fetched by the server
  fundingRate?: number; nextFundingAt?: string; session?: MarketSession;
  outcomes?: ExploreOutcome[];     // { label: "Yes"|"No"|…; price?; bid?; ask?; change24h? /* $ per contract */; at: Array<{ venue; symbol }> }
  issuer?: string; eligibility?: string;
  group?: { id: string; title: string };   // `preipo:<slug>` for a pre-IPO perpetual
  implied?: { usd: number; unit: string };
  tabs: TabId[];                   // "all" first, then its own
  at: ExploreAt[];
  paper?: true;
}
export interface ExploreAt {
  venue: string; venueName: string; symbol: string; connected: boolean; paper?: true; closeOnly?: true;
  canTrade: boolean | "unknown"; public: boolean;
  price?; bid?; ask?; quoteFrom?; quoteAt?; open?: boolean; session?: MarketSession; pastEnd?: boolean;
  connectTo?: string; connector?: string;   // a public line: the venue to connect and the connector that does
  note?; issuer?; eligibility?; implied?: { usd: number; unit: string };
}
```
- Example rows (from `test/unit/ui-markets.test.ts`; the page accepts the legacy tab id `now` for `all`):

```json
{ "key": "coin:BTC", "kind": "coin", "name": "Bitcoin", "base": "BTC", "price": 62140, "changePct24h": 2.1, "volumeUsd24h": 1900000000, "tabs": ["now","crypto"],
  "at": [ { "venue": "ex", "venueName": "Exchange X", "symbol": "BTC/USDT", "connected": true, "canTrade": true, "public": false, "price": 62140, "open": true },
          { "venue": "okx-public", "venueName": "OKX", "symbol": "BTC/USDT", "connected": false, "canTrade": false, "public": true, "price": 62150, "connectTo": "okx", "connector": "live:exchange:okx" } ] }
{ "key": "perp:BTC", "kind": "perp", "name": "BTC perpetual", "base": "BTC", "price": 62180, "changePct24h": 1.2, "volumeUsd24h": 4200000000, "fundingRate": 0.0001, "tabs": ["now","perps"],
  "at": [ { "venue": "ex", "venueName": "Exchange X", "symbol": "BTC/USDT:USDT", "connected": true, "canTrade": true, "public": false, "price": 62180, "open": true } ] }
{ "key": "kalshi:KXFED-DEC", "kind": "event", "name": "Fed cuts in December?", "price": 0.62, "volumeUsd24h": 4100000, "category": "Economics", "closeTime": "2026-10-08T09:12:30.000Z", "tabs": ["now","predictions"],
  "outcomes": [ { "label": "YES", "price": 0.62, "bid": 0.61, "ask": 0.63, "at": [ { "venue": "kalshi", "symbol": "KXFED-DEC:YES" }, { "venue": "pm-public", "symbol": "fed-dec:Yes" } ] },
                { "label": "NO",  "price": 0.38, "bid": 0.37, "ask": 0.39, "at": [ { "venue": "kalshi", "symbol": "KXFED-DEC:NO" },  { "venue": "pm-public", "symbol": "fed-dec:No" } ] } ] }
```
- Semantics the page relies on: a row's `price`/`changePct24h` are its most traded venue's; an event row's `price` is its first outcome's
  and its 24 h is `change24h` in **dollars per contract** (`0.03 = 3¢`; the page shows `change24h * 100` with a `¢` unit); Kalshi volume is
  `contracts24h`, never dollars; a perp with `implied` or `category === "Pre-IPO"` belongs to the `preipo` tab, not `perps` (the page also
  filters `perps` by that); Predictions without a search is at most `PREDICTIONS_MAX = 12` curated rows + IPO questions; sports/weather/
  entertainment events are excluded upstream; `tabs` are the server's category tabs and the page adds its own "Watching" (from
  `A.watch`) and "All results" (while searching). The page never asks the server to `sort`: it sorts `items` itself (by volume /
  `Math.abs(changePct24h)` or `|change24h|*100` / `closeTime`), and ignores `closing`/`movers`/`mostTraded` except as extra rows to find
  a market by key/name.
- Cache/latency: the answer is cached 30 s per (tab, q, key, sort, limit); each source has 4 s for all its calls (`timeoutMs` 4000),
  40 markets per source (`perSource`), so a cold answer is ≈ 4–5 s and a warm one instant. Connected venues' listings are kept 60 s,
  public listings 20 s here (the source keeps its bodies 90 s, lists 10 min). A public source whose venue is connected is not asked.
  The page: `MKT_TTL = 20_000` (re-asked when the pane draws and the kept read is > 20 s old), prefetches `/api/account/explore` (All,
  no params) on idle after the first account read, `?limit=200` for the Watching tab and name lookups, `?tab=<kind>&limit=12` per
  kind for the Trade picker (`TK_READ_MS = 15_000`), `?tab=predictions&q=<company>&limit=12` for a pre-IPO drawer's IPO markets.

### 2.17 `GET /api/account/holdings[?cost=1][&paper=1]` — Portfolio

- `cost=1` adds `cost` and `positions`; `paper=1` returns the paper accounts' rows instead (summed as paper money; `paper: true` on the
  answer). `{ ok: true, ...HoldingsView }`:

```ts
export interface HoldingsView {
  asOf: string;
  totalUsd: number;            // the account page's total (venues + in flight + held), or the paper accounts' sum with paper=1
  rows: HeldRow[];             // AssetRow & { changePct24h?: number; changeFrom?: { venue; venueName } }
  money: MoneySummary;
  change24h: DayChange;
  missing: ReadMissing[];
  cost?: CostBasis[];          // with cost=1
  positions?: VenuePosition[]; // with cost=1 (real or paper ones, matching `paper`)
  paper?: true;
}
export interface AssetRow {
  key: string;                 // `crypto:BTC`, `stable:USDC`, `cash:USD`, `equity:AAPL`, `event:KXFED-25DEC-T4.00:YES`, `rwa:USDY`, and `earn:<venue>:<product>` for money in an earn product
  asset: string; class: AssetClass;     // "crypto" | "stable" | "cash" | "rwa" | "event" | "equity" | "earn"
  amount: number; usd: number; price?: number; unpriced?: number;
  venues: AssetLine[];         // { venue; venueName; amount; usd; note?; inTransit?: true; noPrice?: true; stale?: true; watched?: true }, largest first
  earn?: { venue; venueName; product; asset; name?; apy?; accrued?; accruedUsd? };
}
export interface MoneySummary { cashUsd; stableUsd; inTransitUsd; readyUsd; tradesHereUsd; canMoveUsd; staysUsd; venues: ReadyVenue[] }   // ReadyVenue = { venue; venueName; usd; lines: [{asset, note?, usd}]; tradesHere: boolean; movesOut: boolean; why? }
export interface DayChange { usd: number; pct?: number; coveredUsd: number; ofUsd: number; missing: string[] /* row keys */ }
export interface CostBasis { key: string /* row key or `position:<venue>:<symbol>` */; asset; class: AssetClass | "position"; side?; symbol?; avgCostUsd?; costUsd?; coveredQty: number; ofQty: number; unrealizedUsd?; realizedUsd: number; source: "account orders" | "venue" | "venue and account orders" | "none"; words: string; parts: CostPart[]; orders: number; markets: Array<{ venue; symbol }>; lastFillAt?; soldUnknownQty?; unpricedFills?; unreportedFees? }
```
- Example (from `test/unit/ui-portfolio.test.ts`, a paper lens answer):

```json
{ "ok": true, "paper": true, "totalUsd": 9988.17,
  "rows": [ { "key": "cash:USD", "asset": "USD", "class": "cash", "amount": 7281.7, "usd": 7281.7, "price": 1, "venues": [ { "venue": "paper-1", "venueName": "Paper account", "amount": 7281.7, "usd": 7281.7 } ] } ],
  "money": { "readyUsd": 7281.7, "venues": [ { "venue": "paper-1", "venueName": "Paper account", "usd": 7281.7, "lines": [], "tradesHere": true, "movesOut": false } ] },
  "change24h": { "usd": -54.97, "pct": -0.55, "coveredUsd": 9988.17, "ofUsd": 9988.17, "missing": [] }, "missing": [] }
```
- Latency: `accountView()` (settle ≤ 3 s + earnings ≤ 3 s) + `dayStats` (each venue's 24 h stats, 4 s per source, in parallel; then
  public exchange tickers for coins still unpriced, in lots of 13) + (`cost=1`) `allPositions()` (15 s cache). Budget **≈ 4–8 s cold**.
  The page reads `?cost=1` with ttl 8 s and, when a paper account is connected, `?cost=1&paper=1` too.
- Real vs paper: real rows exclude paper venues (`byAsset` leaves `paper` venues out unless `paper: true`); positions and costs are split by
  `o.paper === true` likewise.

### 2.18 `GET /api/account/history?range=&paper=1&venue=`

- `range` `1d|1w|1m|all` (default `1d`; a wrong one → 409 with `detail.ranges`). Without `paper`: `{ ok: true, ...NetWorthHistory }`,
  read synchronously from `<home>/portfolio/networth.jsonl`. With `paper=1` (+ optional `venue`): `{ ok: true, ...PaperHistory }`; `venue`
  without `paper=1` → 400.

```ts
export interface NetWorthHistory {
  range: "1d"|"1w"|"1m"|"all"; from: string; bucket: "5m"|"1h"|"1d";
  points: NetWorthPoint[];       // { at: string; usd: number; partial?: true }, oldest first, one per bucket
  first?: string;
  events: NetWorthEvent[];       // { at; kind: "connect"|"disconnect"; venue; name?; usd }
  changeUsd: number; paidOutUsd?: number; changePct?: number; partial?: true;
}
export interface PaperHistory extends NetWorthHistory { paper: true; venue?: string; startUsd?: number; sinceStartUsd?: number; addedUsd?: number; rebuilt: boolean; inexact?: string[]; missing?: string[] }
```
- Points are written by the server every 5 min (`snapshotMs`, default 300 000) and on connect/disconnect; an unchanged account writes one
  an hour. Paper curves are rebuilt from the book + public bars (each bar read ≤ 8 s) and cached 60 s per (range, venue). The page asks
  with ttl 60 s.

### 2.19 `GET /api/account/receive?venue=&asset=&network=`

- `asset` `/^[A-Z0-9.]{1,15}$/` (upper-cased), `network` one of the account's chain names (`CHAINS` keys: Arbitrum, Base, Ethereum, Optimism,
  Polygon, BNB Chain… — the exact set is in `live/chain.ts`, not read). `{ ok: true, venue, venueName, asset, network, address, tag?, whose,
  note? }` (`ReceiveAddress`). 409 for a watched address, a venue that takes nothing, or the exchange's own refusal. Exchange deposit
  addresses cached 60 s. **Reaches the venue** (a keyed call) when not cached.

### 2.20 `GET /api/account/asset?key=&interval=&range=` — the market drawer's "what is held" read

- `key` a holdings key (`crypto:|stable:|cash:|equity:|rwa:|event:`; `coin:` and `stock:` are accepted for `crypto:`/`equity:`), `interval`
  one of `1m 5m 15m 1h 4h 1d 1w` (default `1h`), `range` one of `1D 5D 1M 3M 6M YTD 1Y 5Y MAX` (optional). `{ ok: true, ...AssetDetail }`:

```ts
export interface AssetDetail {
  key: string; row?: HeldRow; compare?: Comparison; candles?: CandleSeries;   // CandleSeries = { venue; venueName; symbol; interval; bars: Candle[]; public?: true; source?: string }
  positions: VenuePosition[]; orders: LiveOrder[] /* open ones only */; lines: StatementLine[] /* ≤ 50, newest first */; cost: CostBasis[]; missing: ReadMissing[];
}
```
- **Heavy**: `held({cost:true})` (everything §2.17 does with cost) + `liveCompare` (15 s cache) + a candles read (up to `HISTORY_WAIT_MS`
  20 s) + statement rows. The page asks it with ttl 10 s whenever the drawer opens or its range changes.

### 2.21 `GET /api/account/quotes?pairs=venue|symbol,…` (or repeated `?pair=`)

- 1–12 markets, each `venue|symbol` (400 "each market is venue|symbol, e.g. okx|BTC/USDT" when malformed; 409 when 0 or > 12).
  `{ ok: true, quotes: Array<{ venue: string; symbol: string; market?: Market; refusal?: Refusal }> }` — each a `/market` read (3 s cache).
  Only venues connected live (a public venue's pair comes back as a refusal row).
- The page polls it every 5 s for the cards/rows in view and the drawer (`MKT_POLL_MS`), for live position cards (`LV_EVERY_MS` 5 s, twelve
  a read), and the chart's live price (ttl 3 s).

### 2.22 `GET /api/account/sellable`

- `{ ok: true, items: Sellable[], missing: ReadMissing[] }` — everything held that is not a dollar, with what selling it would sign.
  `Sellable = { key; asset; venue; venueName; action: "sell"|"close"; symbol?; kind?; side?; held: number; sellQty: number; price?; usd?; ready:
  boolean; why? }`. Calls `accountView()`, `allPositions()` and a market read per held line. Used by the Sell-many sheet only.

### 2.23 `GET /api/account/agents`

- `{ ok: true, ...AgentsView }` = `{ asOf; mode: "guard"|"open"; agents: AgentView[]; requests: Array<{ address; name; at }> }`.

```ts
export interface AgentView {
  address; name; code; status: string /* ok · expired · revoked */; validUntil; approvedAt;
  limits: Array<{ id; scope; allow: string[]; perPaymentUsd; budgetUsd; spentUsd; reservedUsd; leftUsd; windowHours; validUntil; expired }>;
  cards: AccountPage["cards"]; orders: LiveOrder[] /* ≤20 */; payments: Payment[] /* ≤20 */; earns: LiveEarn[] /* ≤20 */;
  wallets: Array<AccountPage["subAccounts"][number] & { venue: string; usd?: number }>;
  intents: AccountPage["intents"]; asks: AgentAsk[]; declinedAsks: DeclinedAsk[];
  flights: Array<{ no; at; request; legs: string[] }>;   // legs as "✓ …" / "✗ …" / "▣ …" / "· …" strings
  memory: { notes: number; waiting: number };
}
```
- Built from `accountView()` (so it pays `settle()` too). The page asks with ttl 15 s when any key exists.

### 2.24 `GET /api/account/desk` · `/desk/catalog` · `/desk/feed?since=` · `/desk/seat?address=`

- `/desk` → `{ ok: true, desk: DeskView | null }` (null when no desk is hired). `/desk/catalog` → `{ ok: true, ...DeskCatalog }`.
  `/desk/feed?since=<seq>` (digits ≤ 15, else 400; empty = 0) → `{ ok: true, ...DeskFeed }` or `{ ok: true, desk: null }`.
  `/desk/seat?address=0x…` (≤ 42) → `{ ok: true, ...forSeat }` or 409.
- Types (desk.ts), trimmed to the fields a renderer needs:

```ts
export interface DeskView {
  id; name; createdAt; objective: DeskObjective;   // { text; venue; venueName?; universe: TabId; targetPct; maxRiskPct; maxDailyLossPct; hours; everyMin; reportAt: "21:00"; maxOpen }
  brain: BrainStatus & { provider: string; label: string; effort: string; price?; spend: DeskSpend };   // BrainStatus = { ok; model; how?; why?; fix?: BrainFix }; DeskSpend = { calls; inputTokens; outputTokens; usd; unpricedTokens?; failed? }
  autonomy?: { paper: boolean; at: string }; lastScan?: DeskScan;
  seats: Array<DeskSeat & { status: "ok"|"not let in"|"expired"|"revoked"; limit?: SeatLimit; cards: number }>;   // DeskSeat = { role: RoleId; kind: "house"|"outside"; address; name; charter: { owns; good; never }; hiredAt }
  session?: DeskSession & { state: "live"|"paused"|"halted"|"ended"; elapsedMs; remainingMs };
  equity: { nowUsd; startUsd; changeUsd; changePct; mult; points: Array<[ms, usd]> };
  target: { pct; progressPct; reachedUsd; targetUsd }; funnel: DeskFunnel /* { scanned, cleared, confirmed, placed, executed, closed, rejected } */;
  today: { pnlUsd; wins; losses; scanned; cleared; executed; closed; lossRoomUsd };
  open: Lead[]; recent: Lead[]; tape: { wins; losses; winRatePct; avgWinPct; avgLossPct; closes: [...] }; big: [...]; room: RoomMessage[];   // RoomMessage = { seq; at; from: RoleId|"you"|"account"; kind: RoomKind; lead?; text; refs?; brain?: true }
  routines: { everyMin; nextCycleAt?; reportAt; nextReportAt; weeklyAt; lastReport? }; reports: DeskReport[]; cards: Array<{ id; lead?; reason; usd }>;
  venue: { id; name; usd; paper: boolean; connected: boolean };
}
export interface DeskCatalog { roles: RoleSpec[]; seats: Partial<Record<RoleId, Hex>>; brain: …; brains: Array<BrainStatus & { id; label; models } & Partial<BrainAbout>>; universes; defaults; hired: boolean; autonomy: DeskAutonomy | null; bounds }
export interface DeskFeed { seq: number; room: RoomMessage[] /* after `since`, ≤ 200, oldest first */; working: DeskWorking|null; inFlight: number; lastThink; lastScan; autonomy; session; venue; equity: { nowUsd; startUsd; changeUsd; changePct; tail: Array<[ms, usd]> /* ≤ 120 */ }; target; funnel; today; leads: FeedLead[] /* ≤ 60 + open */; routines; brain: { ok; why?; fix?; provider; label; model; spend }; name; objective; seats; hard: { maxSpreadPct } }
// forSeat(address) answers: { desk, objective, session?, autonomy: { paper, at? }, lastScan: {cycle, at, venue, scanned, picked, note?} | null, yourSeat: {role, name, charter, trades} | null, seats: [{role, kind, name}], funnel, today, open: [{id, symbol, side, sizeUsd, entry, mark, unrealizedUsd, plan: {tpPct, slPct, maxHours}}], room: last 40 of {seq, at, from, kind, lead, text} }
```
- `ROLES = ["head","search","risk","sniper","exit","watch","flow","sentiment"]`. The page polls `/desk/feed` **every second** while the
  Superagent floor shows (it drops the kept read each time) and `/desk` with ttl 2.5 s + `/desk/catalog` 30 s on the Agents pane. The
  `desk` SSE event (`{seq, working, inFlight, at}`) nudges a feed read. Note `BrainAbout` carries `keyFile` (a relative path) and the key's
  masked `tail`; `BrainFix.file` is an absolute path and `command` a shell command — data about the install.

### 2.25 `GET /api/account/memory` · `/memory/agent?address=&q=`

- `/memory` → `{ ok: true, ...MemoryPage }` = `{ asOf; agents: Array<{ address; name; code; status /* ok·expired·revoked·gone */; rules:
  { learn; ask; share }; notes: MemoryNote[]; fromLimits: MemoryFromLimit[] }>; limits: { noteText: 500; howText: 80; maxNotes: 100; topics:
  [{id, words}] } }`. `MemoryNote = { id; topic: "style"|"rules"|"venues"; text; from: "you"|"agent"; how?; at; updatedAt?; waiting? }`.
- `/memory/agent` needs `address` `/^0x[0-9a-f]{40}$/` (lower-cased), optional `q`: `{ ok: true, asOf, rules, notes, waiting, fromLimits,
  sharedWithYou: [{agent, name, notes}], limits }`. Reads JSON files under `<home>/memory` (sync). The page: ttl 4 s.

### 2.26 `GET /api/account/candles?venue=&symbol=&interval=&range=` | `&before=&limit=`

- `venue` `/^[a-z0-9][a-z0-9-]{0,59}$/` — a connected venue's id **or a public source's id** as `/explore`'s `at[].venue` names it;
  `symbol` 1–160 plain characters; `interval` `1m|5m|15m|1h|4h|1d|1w` (empty = the range's own bar: `RANGE_BAR`, or `1h`); either `range`
  (`1D 5D 1M 3M 6M YTD 1Y 5Y MAX`; neither given = the interval's own range `INTERVAL_RANGE = {1m:"1D",5m:"1D",15m:"5D",1h:"1M",4h:"3M",
  1d:"1Y",1w:"5Y"}`) **or** `before=<bar start ms>` (+ `limit`, default 300, ≤ 1 000) — both → 409. A first view holds ≤ `HISTORY_MOST =
  5_000` bars.
- `{ ok: true, ...CandlesView }`:

```ts
export interface CandlesView {
  venue; venueName; symbol; interval: CandleInterval; range?: CandleRange; before?: number;
  candles: Candle[];           // { t: ms; o; h; l; c; v? }, oldest first; an event contract's prices are 0–1 dollars (the page multiplies by 100 for cents)
  more: boolean; partial?: true; ends?: string; note?: string; source?: string; adjustment?: string; session?: string; folded?: string;
  gaps?: Array<{ from: number; to: number; why: string }>; today?: { t: number; words: string }; public?: true; from?: string;
}
```
- Latency: the service waits `HISTORY_WAIT_MS = 20 s` for a first view and `PAGE_WAIT_MS = 12 s` for a page (a Nasdaq whole history is
  ~10 s); answers are kept seconds-to-minutes in a bounded memory (64 answers / 250 000 bars). The page asks the first view with ttl 30 s
  and a **25 s** client timeout (`HISTORY_TIMEOUT_MS`), pages with ttl 60 s, and re-reads a chart every 60 s / after a bar ends; between
  reads it moves the last bar from `/quotes` (3 s) or the stream's `quote` event.

### 2.27 `GET /api/account/book?venue=&symbol=&depth=`

- `depth` 1–50 (digits ≤ 2, default 20). `{ ok: true, venue, venueName, symbol, book: OrderBook, public?: true }`.

```ts
export interface OrderBook { bids: Array<[price, size|null]>; asks: Array<[price, size|null]>; at: string; from: string; depth: "full"|"top"; more?: { bids: boolean; asks: boolean }; topOnly?: "none"|"unread"; upToMs?: number }
```
- A source with no book answers `depth: "top"` (best bid/ask only, sizes `null`; `topOnly` says why; `upToMs` how old a kept quote may
  be). Kept 1.5 s (`BOOK_KEEP_MS`); waited for 5 s. The page polls every 2 s (`BK_BOOK_MS`), 4 s for trades, and backs off to 60 s on
  refusals; while the stream pushes `book`, the REST read only fills depth beyond the stream's levels.

### 2.28 `GET /api/account/trades?venue=&symbol=&limit=`

- `limit` 1–100 (digits ≤ 3, default 30). `{ ok: true, venue, venueName, symbol, trades: PublicTrade[] /* { price; size; side?; at } newest
  first */, none?: string, public?: true }`. A source that publishes no trades is **200 with `trades: []` and `none: "<source> publishes no
  trades the account can read"`** (not a refusal); the page then stops asking until the market changes. Kept 3 s; waited 5 s.

### 2.29 `GET /api/account/earn?venue=&asset=`

- `asset` `/^[A-Z0-9.]{1,20}$/`. `{ ok: true, ...EarnView }` = `{ asOf; venues: [{ venue; venueName; can: boolean|"unknown"; what; whyNot? }];
  products: Array<EarnProduct & { venue; venueName }>; positions: Array<EarnPosition & { venue; venueName }>; missing; writes: { on; capUsd;
  turnOn } }`. `EarnProduct = { id; asset; name; apy?; apyHigh?; rateKind?: "apy"|"apr"; protocol?; chain?; minAmount?; lockDays?; tvlUsd?;
  priceUsd?; lands; canSupply; canWithdraw; why?; note? }`; `EarnPosition = { product; id; asset; amount; usd?; apy?; accrued?; accruedUsd?;
  name?; chain?; protocol?; pending? }`. Products cached 60 s, positions 15 s, each read ≤ 8 s. 409 when a named venue earns nothing.

### 2.30 `POST /api/account/bridge-routes {draft}` (a read by POST)

- Body `{ draft: { from, to, network, toLedger, asset, toAsset, amount } }` → `{ ok: true, routes: … }` or 409. Quotes a bridge; reaches
  LI.FI-style parties. Out of the Markets/Account screens' scope; listed for completeness.

### 2.31 `GET /api/read[?account=]`

- `{ ok: true, holdings: Holding[] }` where `Holding = { account; asset; amount; usd; class: AssetClass; note?; redeemable?; inTransit?;
  freeUsd?; freeAmount? }` — the adapters' raw balance reads, **without** the earn merge `/api/account` does.
- **Mutates on GET: `svc.read()` appends a ledger row** `{ kind: "read", venue: account ?? "*", tool: "portfolio_read", outcome: "N holdings
  across M account(s) · no card" }` to the hash-chained ledger file every call. Avoid for polling.

### 2.32 `GET /api/markets` and `GET /api/quote`

- On the real account both answer **409** `{ ok:false, refusal: { code: "E_ACCOUNT_BAD_ACTION", message: "this account holds real accounts
  only: Markets is GET /api/account/explore, a price is GET /api/account/market" } }`. Only `--classic` serves the fixture's event markets.

### 2.33 Sign-in GETs (not for the screens)

- `GET /api/account/signin/status?state=` → `{ ok: true, status: "unknown" }` or the OAuth sign-in's status; `GET /api/account/signin/callback`
  answers HTML. Both unsigned; irrelevant to a read-only consumer.

---

## 3. The push channel: `GET /api/account/stream`

### 3.1 Subscribing

- `GET /api/account/stream?since=<id>&client=<name>&markets=<k1,k2,…>` with the §1 fence satisfied and **neither `sec-fetch-mode: navigate`
  nor `sec-fetch-dest: document`** (else 403 with the fence sentence). `client` must match `/^[A-Za-z0-9_-]{8,48}$/` (400 otherwise; the
  page uses `tab-<24 hex>`); without `client` the stream carries account events only and can follow nothing. `markets` (≤ 4 000 chars) is an
  initial follow list (≤ 16 keys). `since` (≤ 64) or the `Last-Event-ID` request header names the last id heard.
- 404 when not mounted; **503** when `MAX_CLIENTS = 32` streams are open (the message says how many listen). Each stream is one HTTP
  response held open; closing the socket drops it (and its follows, told to the service).
- Wire, verbatim from `account/stream.ts`: first `retry: 1000\n\n`; then either the replay (every account event after `since` from a ring of
  500, when `since` is `<thisRun>.<seq>` and still in the ring) **or** one `snapshot` frame; then events as they come. Each frame:
  `id: <run>.<seq>\nevent: <type>\ndata: <JSON>\n\n` where `run` is 8 hex chars of this process (`randomBytes(4)`) and `seq` rises by one
  per frame (`STREAM_ID = /^([a-z0-9]{1,16})\.(\d{1,15})$/`). Every 15 s a heartbeat `: hb <ms>\nevent: hb\ndata: {"at":<ms>}\n\n` (no id).
  A same-named `client` reconnecting before its old stream dropped takes over its follows and is told each market again.
- Resume: a browser `EventSource` sends `Last-Event-ID` by itself; a Node consumer passes `?since=` (or the header). An id from another
  run, older than the ring, or none → a snapshot: `{ orders: LiveOrder[] /* open ones, ≤ 60 */, paper: PaperBookSummary[], at: "<run>.<seq>" }`
  under the current seq — "read everything again". A slow socket (write returned false) gets account events queued (≤ 256, then a snapshot
  instead) and only the latest quote/book/trades per market.
- Event names (`ST_EVENTS` in the page): `snapshot, order, fill, position, balance, paper, statement, card, desk, quote, trades, book, hb`.
  `order…desk` are **account events** (at once, in order, kept for resume); `quote/trades/book` are **coalesced** (≤ 1 per 100 ms per market
  for quote/trades, 250 ms for book; the first at once, the latest at the window's end; never resumed) and go only to clients following
  that market's key.

### 3.2 Payloads, as `service.ts` builds them

| event | `data` |
|---|---|
| `order` | a `LiveOrder` (§5.1), spread, as the account records it (`{...o}`); from a paper book: the account's own record + `{status, filledQty, qty, avgPrice?, feeUsd?, limitPrice?, stopPrice?, updatedAt, note?, paper: true}`, or — an order the account has no record of yet — a `PaperOrderSaid` + `{venue, venueName, paper: true}` (keyed by `clientId`, no `id`). |
| `fill` | `{ venue, venueName, paper?: true, ref, clientId, filledQty /* in all */, symbol, name, kind, side, qty /* this fill */, price?, avg?: true, at, order /* ord-id */, by: "owner"|"agent" }`; a paper book's fill: `PaperFillSaid & { venue, venueName, paper: true, order?, by? }` (+ `realizedUsd?`, `note?`). The page toasts it once per `${clientId}|${filledQty}`. |
| `position` | `{ venue, venueName, paper: true, symbol, position: (Position & { venue, venueName, paper: true }) | null }` — **only paper books emit it**; real venues' positions change only on the next `/positions` read. |
| `balance` | `{ venue, venueName, paper: true, cashUsd, at }` — paper cash only. |
| `paper` | `PaperBookSummary & { reset?: { archived: string; at: string }, at }`. |
| `statement` | `{ venue, line: StatementLine | null, at }` for a ledger statement row, or `{ venue, paper: true, at }` after a paper fill/reset — "read the statement again". |
| `card` | `{ id, venue, outcome, at }` for a card raised/answered, or `{ waits: "letIn"|"ask"|"memory"|"device", venue, at }` for something else now waiting on the owner. |
| `desk` | `{ seq, working: DeskWorking | null, inFlight: number, at }`. |
| `quote` | `{ key, venue, symbol, source, bid?, ask?, bidSz?, askSz?, last?, mark?, oracle?, funding?, openInterest?, volumeUsd24h?, prevDayPx?, premium?, bar?: {t,o,h,l,c,v?}, at: ISO, priceAt?: ISO, seenAt: ISO, from: "<src> · live" | "Robinhood · real time" | "Nasdaq · real time", delayMs?, everyMs?, askedEveryMs?, live: boolean, seq }` or `{ key, venue, symbol, source, live: false }` when the hub has no quote yet. |
| `book` | `{ key, venue, symbol, source, bids: [[p,s]…], asks, at: ISO, from: "<src> · live", depth: "full", more: { bids, asks }, live }` or `{ …, live: false }`. Top 20 levels (`BOOK_TOP`). |
| `trades` | `{ key, venue, symbol, source, trades: PublicTrade[] /* newest first, ≤ 30 */, live }`. |
| `snapshot` | `{ orders, paper, at }` as above. |
| `hb` | `{ at: <ms> }`. |

`key` is the follow key as the client sent it (`venue:symbol`, with `~` for quote-only); `venue` is the part before the colon (minus
`~`); `source` is the hub's own source id (a public source such as `coinbase`/`kraken`/`okx`/`hyperliquid`, the US stocks feed, or the
paper account's price source).

### 3.3 `POST /api/account/stream/markets`

- Body `{ client: string, markets: string[], n?: number }` (JSON). `markets` replaces the follow set: each `<venue>:<symbol>` (≤ 160 chars,
  must contain `:`), at most `MAX_FOLLOWS = 16` (extra dropped); prefix `~` = price alone (quote only, no book held). `n` is the page's
  rising counter: a telling with `n` ≤ the last taken is ignored (answered with the current set). 400 on a bad `client`/`markets`/`n`;
  **404 when no stream of that `client` is open** (open the stream first); `{ ok: true, following: string[] }` otherwise. An empty list
  follows nothing.
- What a key resolves to (`streamAt`): the venue part (a leading `public:` is stripped) must be `/^[a-z0-9][a-z0-9-]{0,59}$/`. A paper
  account's market → its listing source's stream; a venue whose id is itself a hub source (`hyperliquid`, `coinbase`, `kraken`, `okx`,
  or the US-stocks feed's id) → that stream; anything else → **nothing is streamed** (the key is kept, no events come). Binance/Bybit are
  never streamed. The hub opens the venue's public WebSocket lazily on the first follow and closes it a minute after the last.
- The page tells its follows on every stream open (`stTellFollows`) and re-tells once after 1 s when the POST was not 2xx. The Trade
  terminal follows the market shown whole + the positions' markets as `~` marks; the Superagent floor its focus market + leads; Markets
  and Portfolio follow nothing (they poll `/quotes`).

### 3.4 The page's reconnect policy (ui/stream.js), for a consumer to mirror

`ST_STALE_MS = 20_000` (silent → "stale"), `ST_DEAD_MS = 45_000` (close and reopen from the last id), `ST_RETRY_MS = [1 000, 2 000, 5 000,
10 000, 30 000]` after a closed/503 stream, a watch every 5 s; closed while the tab is hidden and reopened with `?since=` when shown; the
regular `/api/account` poll slows from 20 s to 80 s while connected. Quotes kept from a stream are discarded on any reconnect/snapshot
(the server re-tells each followed market on `onAgain`).

---

## 4. Identifiers and page state

### 4.1 How a market is named across routes

| Where | Form | Notes |
|---|---|---|
| `/explore` rows | `key`: `coin:BTC` · `stock:AAPL` · `perp:ETH` · `rwa:NVDA` · `kalshi:<market ticker>` · `pm:<condition id>` · `pmus:<market slug>`; a pre-IPO perp's `group.id` is `preipo:<slug>` | `kind` ∈ coin/stock/perp/event/rwa. Tabs: all/crypto/stocks/rwas/perps/preipo/predictions. |
| a venue line | `at[].venue` + `at[].symbol` (the symbol **as that venue names it**); `at[].connectTo` is the account venue id a public line would become | the page's "pair" is `${venue}|${symbol}` |
| `/quotes` | `venue|symbol` (pipe) | connected venues only |
| `/market`, `/markets`, `/candles`, `/book`, `/trades` | `venue=` + `symbol=` query params | `venue` may be a public source id for candles/book/trades |
| SSE follow keys | `venue:symbol`, optional leading `~` (quote only); `public:` prefix tolerated | ≤ 16 per client |
| `/asset`, `/holdings` rows | `crypto:BTC` · `stable:USDC` · `cash:USD` · `equity:AAPL` · `rwa:USDY` · `event:<symbol at its venue>` · `earn:<venue>:<product>`; cost rows for positions `position:<venue>:<symbol>` | `/asset` also takes `coin:`/`stock:` spellings |
| `/positions` | `{ venue, symbol }` pairs | |
| the watchlist (`A.watch`) | `{ venue, symbol, at }` — `venue` is the connected venue's id, or for a public row its `connectTo` | set by the signed owner action `setWatch` |
| orders | `LiveOrder.id` `ord-0001` (per run), `clientId` (the venue's idempotency key, globally unique), `ref` (the venue's id) | statement key `order:<clientId>` |
| venues | `id` on the account (`okx`, `kalshi`, `paper-1`, `agent-claude-code`), `connector` (`live:exchange:okx`, `live:kalshi`, `live:paper`, `live:wallet`, `live:metamask`, `live:agent-wallet`) | public sources in `/explore` use their own ids (e.g. `okx-public` in tests; the real ids are the `PublicSource.id`s) |
| agents | the key's lower-case `0x…` address; `code` a 2–3 letter flight prefix | |

Predictions: an event row carries `outcomes[]` (`label` `"YES"`/`"NO"` or a named outcome; the page title-cases YES/NO), each with its own
`at: [{venue, symbol}]` legs — a Kalshi leg is `<ticker>:YES`/`:NO`, a Polymarket leg `<slug>:Yes`/`<token id>`. Prices are dollars per
contract (0–1); the page shows cents. A Kalshi market past `closeTime` is closed; a Polymarket one may still trade (`pastEnd: true`).

### 4.2 Server-side vs browser-local state

| State | Where |
|---|---|
| watchlist (★ on Markets) | **server**: `A.watch`, written by the signed `setWatch` owner action; agents read it over MCP |
| open intents, cards, asks, memory switches, mode (Guard/Beast), the desk | server (signed actions) |
| Markets tab, search `q`, sort | the URL hash only (`#/markets?tab=crypto&q=btc&sort=movers`); not persisted |
| the drawer's range/interval | in-memory (`MKT.open`) |
| Portfolio segment (assets/positions) and range | in-memory (`PF.tab`, `PF.range`; `?view=` in the hash) |
| the lens (All accounts / Real money / Paper / a venue / an agent) | in-memory (`view.lens`) |
| theme | `localStorage["account.theme"]` (`cream`/`black`) |
| trade mode (Regular/Superagent) | `localStorage["account.tradeMode"]` |
| Trade's own stars, recents, ticket draft, onboarding-off | `localStorage["account.starred"]`, `["account.recent"]`, `["account.ticket"]`, a `TK_ONBOARD_OFF` key (value not read) — **browser-local, not the server watchlist** |
| signed-out flag, the device key | `owner.js` (localStorage flag + IndexedDB key; not read here) |

---

## 5. The overview / account payloads in detail

### 5.1 `AccountPage` (account/exchange.ts), as `/api/account` serves it on the real account

```ts
export interface AccountPage {
  now: string;
  type: "Separate" | "Unified";
  totalUsd: number;            // venues that are not paper + inFlightUsd + heldUsd + sub-account floats
  inFlightUsd: number; heldUsd: number;
  venues: Array<{
    id: string; name: string; connector?: string; keyFile?: string /* a path under the home, never its contents */; frontLine: string;
    usd: number; cashUsd: number;
    holdings: Array<{ asset; amount; usd; class: AssetClass; note?; inTransit: boolean; freeUsd?; freeAmount?; icon?: string; earn?: EarnHolding }>;
    restricted?: string; plugged?: boolean; via?: string; live?: true;
    paper?: true; paperStartUsd?: number; paperAddedUsd?: number;
    watchOnly?: string; asOf?: string; stale?: string;
    notServed?: { said: string; edition?: { connector; name; said } }; closeOnly?: { said: string };
    proven?: string; liveCan?: Account["liveCan"]; readOnlyBecause?: string;
    trade?: { can: boolean|"unknown"; what: string; kinds?: MarketKind[]; positions?; amend?; leverage?; close? }; noTradeBecause?: string;
    earn?: { can: boolean|"unknown"; what: string; whyNot?: string }; address?: string;
    // stripped by realPage(): in, out, fiat, ledgers, swaps, agentKey, runways
  }>;
  payments: Payment[];         // ≤ 40, newest first
  orders: LiveOrder[];         // ≤ 60, newest first
  earns: LiveEarn[];           // ≤ 40
  keys: Array<{ address; name; code; validUntil: ISO; approvedAt; status: "ok"|"unknown"|"expired"|"revoked" }>;
  requests: Array<{ address; name; at }>;
  spend: Array<{ id; agent; agentName; scope: "venues"|"trade"|"payees"|"earn"; allow: string[]; perPaymentUsd; budgetUsd; spentUsd; reservedUsd; windowHours; validUntil: ISO; expired: boolean; payTo: Record<string,string>; intent?; renewHours?; renewsAt? }>;
  fees: Array<{ builder: string; maxFeeRate: string /* "0.05%" */ }>;
  cards: Array<{ id; flight; usd; reason; hash: Hex; kind: string /* agentLiveOrder, agentLiveMove, … */; agent?; agentName?; expiresAt?; shown: Array<{ name: string; value: string }> }>;   // pending only; `shown` is every field the owner signs (the action's fields stringified, JSON for objects)
  subAccounts: Array<{ id; name; agent; agentName; address; capUsd; balanceUsd }>;
  signers: { owners: Array<{ id: string /* "device:<kid>" or an EOA address */; kind: "eoa"|"device"; label: string }>; threshold: number; pendingDevices: Array<{ kid; at }> };
  // destinations: stripped on the real account
  activeKeys: number;
  pay: PayView;                // { payees: [...], sessions: [...] }
  connectable: Connectable[];  // { id; name; connector; via; credential; credentialRef; asks }
  liveUsd: number;             // real money at venues connected live (paper excluded)
  connectLive?: { home: string /* absolute path */; options: LiveOption[]; writes?: { on: boolean; capUsd: number; turnOn: string }; waiting?: WaitingConnection[] };
  real?: true;
  restore?: RestoreReport;     // { runs; from; owner; agents; limits; mode: "Guard"|"Beast"; venues: [{venue, ok, why?, waiting?, said?}]; orders; payments; skipped: string[]; state: "restoring"|"done" }
  watch: Array<{ venue; symbol; at }>;
  intents: Array<{ id; agent: Hex|"*"; agentName; venue; symbol; side: "buy"|"sell"|""; usd: string; text; validUntil: ISO; at; reports: number; report?: AgentReport & { byName }; byAgent: Array<AgentReport & { byName }> }>;
  asks: AgentAsk[];            // { id; agent; agentName; kind: "letIn"|"limit"|"venue"|"topup"|"session"|"leverage"|"mode"; venue; usd: string; text; at; expiresAt }
  declinedAsks: DeclinedAsk[]; // AgentAsk & { declinedAt }
  modeRules: { rows: ModeRule[] /* { door; guard; beast } × 11 */; cardMinutes: 30 };
}
export interface LiveOption { connector: string; label: string; needs: "key-file"|"address"|"cli"|"sign-in"|"none"; example: string; defaultRef?: string; venues: string[]; kind: string }
export interface WaitingConnection { venue; name; connector; needs; keyFile?; address?; said: string; code: string; by: "venue"|"account"; since; lastUsd?; lastAt?; how: "connect"|"restart"; stopped?: true }
```

Row types the page re-draws:

```ts
export interface LiveOrder { id; clientId; at; venue; venueName; symbol; name; kind: MarketKind; base; side: Side; type: OrderType; qty; limitPrice?; worstPrice?; stopPrice?; tif?; postOnly?; reduceOnly?; extendedHours?; trailPercent?; trailPrice?; takeProfit?; stopLoss?; exitOf?: { order; kind: "take-profit"|"stop-loss" }; contractSize?; price: number; usd: number; status: OrderStatus /* pending|open|partial|filled|canceled|rejected|expired */; filledQty; avgPrice?; feeUsd?; ref: string; signer; authority: "owner"|"agent"; agent?; card?; approval?; heldBy?; canceling?; unfollowed?: true; cancelWanted?: true; wantedFrom?; unconfirmed?: true; changing?; reported?; action?: Hex; note: string; updatedAt; native: unknown; walletTxs?; paper?: true }
export interface Payment { id; kind: PaymentKind; at; from; to; external?; sourceToken; token; amountUsd; feeUsd; receiveUsd; legs: PaymentLeg[]; status: PaymentStatus; settlesAt; settledAt?; signer; authority; agent?; flight?; action?; approval?; card?; protocol?; heldUsd?; note?; run?; live?: { kind; toAddress?; network?; txHash?; toNetwork?; tool?; sendBy?; reported?; expired? } }
export interface LiveEarn { id; clientId; at; updatedAt; venue; venueName; kind: EarnKind; product; productName; asset; amount; all?; usd; apy?; rateKind?; lockDays?; lands; status: "pending"|"done"|"rejected"; ref; signer; authority; agent?; card?; approval?; note; native: unknown }
```

### 5.2 Guard vs Beast

Wire value `mode: "guard" | "open"` (`Openness["mode"]`, also `AgentsView.mode`, `Overview.mode`); the words are the page's: `guard` =
**Guard** (every agent write above the allowance waits on a card), `open` = **Beast** (inside its limits, at once; a transfer to a
never-used address and a market past its close still ask). `RestoreReport.mode` is already the word (`"Guard" | "Beast"`); the page's
`modeOf(m)` accepts both spellings. `modeRules.rows` carries the 11 door-by-door sentences and `cardMinutes = 30` (a card expires after
`CARD_TTL_MS = 30 min`). Tightening to Guard is a free `POST /api/mode {mode:"guard"}`; opening is a signed `setPolicy`.

### 5.3 The live cap, "trading on", read-only

`connectLive.writes = { on: boolean; capUsd: number; turnOn: "npm run account" }` (`liveWritesView()`): `on` is false when the server was
started `--read-only`; `capUsd` is `--live-cap` (default 100). The page draws "Trading on · $<cap> a move" when `on`, else a "Read-only"
pill; `EarnView.writes` repeats it. Paper accounts are not bound by the cap but are bound by signatures/limits/mode.

### 5.4 Pairing / paired state and `agentSetup`

`signers.owners` lists the owner keys (`{ id: "device:<kid>", kind: "device", label }` for a browser's WebCrypto key, `{ kind: "eoa" }` for a
seed/EOA), `signers.threshold` (1), `signers.pendingDevices` the browsers waiting to be let in. The page derives its `Owner.role`
(`owner` / `pending` / `needs-code` / `signed-out` / cannot sign) from whether its own `device:<kid>` is among `owners` or `pendingDevices`
and from `owner.js`'s local state; the first browser pairs with a code printed in the server's terminal (`POST /api/account/pair {jwk,
label, code}`). `restore.owner` says whether an owner device came back after a restart. `agentSetup = { command, url }` is the literal
`claude mcp add portfolio -e PORTFOLIO_URL=<origin> -- npx tsx <absolute path>/src/portfolio/mcp.ts` (the path is quoted when it has shell
characters); the consumer should treat it as display text.

### 5.5 The ledger rows in `/api/overview`

```ts
export interface LedgerRowInput { kind: LedgerKind; venue: string; intentId?; callId?; tool?; args?: Record<string,unknown>; outcome?; venueOrderId?; notionalUsd?; code?; reason?; detail?: unknown; native?: unknown; flight?; agent?; envelope?: unknown; signer?; payment? }
export interface LedgerRow extends LedgerRowInput { v: 1; seq: number; ts: string; prev: string; hash: string }
```
The route maps `o.ledger.map(({ envelope, ...row }) => ({ ...row, ...(envelope !== undefined ? { signed: true } : {}) }))`: the signed
envelope never travels; a row that had one carries `signed: true`. `detail`/`native` travel as written (a statement row's `detail` is the
`StatementLine`, its `native` the order/payment). Only the newest 80 rows of **this run's** ledger; `chain` is the hash-chain check.
`approvals[]` are `Approval & { hash }` (the card hash the owner signs over).

---

## 6. Surprises and risks for a server-side consumer

1. **GETs with side effects.** `/api/read` appends a ledger row on every call (a hash-chained file write). `/api/overview`, `/api/account`,
   `/api/account/statement`, and everything built on `accountView()` (`/holdings`, `/asset`, `/sellable`, `/agents`, `/history?paper=1`,
   `/venues`) run `settle()` first: it expires cards, settles due payments and **polls every real venue's open orders, payments and earn
   requests** (bounded by a 3 s race, but the venue calls continue in the background). Polling `/api/account` every few seconds from a
   second consumer doubles the venue traffic the page already causes.
2. **Routes that block for seconds.** `/venues` and `/connect/reach` cold or with `force=1`: up to ~25 s (the Hyperliquid place lookup budget),
   6 s per other probe. `/candles` first view: up to 20 s (`HISTORY_WAIT_MS`), a page 12 s. `/explore` cold: ~4–5 s. `/asset`: compare +
   candles + holdings ≈ 4–25 s worst case. `/exchanges` and `/keyfile?exchange=`: load ccxt on first ask. `/book`, `/trades`: ≤ 5 s. Use
   client timeouts ≥ the page's (15 s general, 25 s for candles) or you will race the account.
3. **Caches are per process and per key; the venues are rate-limited behind them.** Two reads per venue in flight (`PER_VENUE = 2`), the rest
   queue; a venue that refused (geoblock, 429, ban) is held and every read answers that refusal instantly for 20 s–10 min (`holdBackMs`), a ban
   until the venue's time (≤ 1 h). A consumer that asks for many markets at once should do so through `/quotes` (12 per call, 3 s cache) rather
   than many `/market` calls.
4. **Large payloads.** `/api/account` carries up to 60 orders + 40 payments + 40 earns each with a `native: unknown` venue answer; `/positions`
   rows too; `/overview.ledger` 80 rows with `native`/`detail`; `/explore?limit=200` hundreds of rows with legs; `/desk` the whole room (≤ 160
   lines shown, 3 000 kept) and equity points (≤ 2 000). Nothing is paginated except candles (`before`/`limit`) and the desk feed (`since`).
5. **Paths and local facts leak into reads.** `ledgerPath`, `connectLive.home`, `keyFile`, `BrainFix.file`/`command`, `agentSetup.command`,
   `AccountView.credentialRef`, `keyfile.path` are absolute/relative filesystem paths of the operator's machine; key **values** never travel,
   and the public IP/place is scrubbed everywhere (`unaddressed`). Treat these as display data.
6. **The region check.** `/venues` judges each venue from the server's network (its own probes and its published terms matched to a place
   learned in memory); `verdict` ∈ `connectable | not-served | close-only | terms-exclude | setup | closed | no-answer`. A connected venue
   that stops serving the network shows `venues[].notServed` / `closeOnly` on `/api/account` (last good numbers kept, `asOf`), is left out of
   `/explore` and `/compare`, and its reads answer `E_VENUE_GEOBLOCKED`. The place itself is never in any answer.
7. **The SSE stream has side effects of its own.** While ≥ 1 stream is open the door's clock (`watchDoor`, every 5 s) polls venues that have
   something pending; following a market opens the venue's public WebSocket (lazily, closed a minute after the last follow). Only 32 streams
   are accepted; a Node consumer that reconnects without closing the old socket burns slots until the server notices the close. Market events
   are never resumed; account events only from a ring of 500 of the same process run — on any gap you get a `snapshot` and must re-read.
8. **Only paper books push positions/balances.** Real venues' positions, balances and earn change only on the next REST read; what the stream
   does push for them is `order` (state), `fill`, `statement`, `card`. Plan to keep polling `/positions`, `/holdings` and `/api/account` (the
   page polls at 20 s / 80 s).
9. **Price semantics vary by kind.** Event contracts: prices 0–1 dollars, `change24h` in dollars per contract, Kalshi volume in `contracts24h`;
   pre-IPO perps: `implied.usd` (a valuation) with the contract price in `price`; stocks: `session` + `quoteAt`/`quoteFrom`/`delayMs` say how
   old and from which source a "real time" price is (a pre-market quote can be yesterday's last trade); a paper account's price is its source's
   kept listing (`quoteAt` may be minutes old; `OrderBook.upToMs` says so). The page shows `ageWords(quoteAt)` beside any price older than 5 s.
10. **Two tab vocabularies.** `/explore` tabs are `all crypto stocks rwas perps preipo predictions` (the page also accepts the legacy `now` /
    `venues` as `all`); the ticket's kinds are the same ids; the holdings classes are `crypto stable cash rwa event equity earn`. A perp with
    `implied`/`category: "Pre-IPO"` is `preipo` in the page even though its `kind` is `perp`.
11. **Not every connected venue streams or compares.** Paper accounts are excluded from `/compare` and never set a row's price in `/explore`;
    `/quotes` refuses public venues; streaming covers Hyperliquid/Coinbase/Kraken/OKX public feeds, the US-stocks REST feed and paper markets
    priced from them — a Binance or Kalshi market gets no `quote` events however it is followed.
12. **`ok` is not uniform.** `/api/overview` has no `ok`; most `/api/account/*` reads spread the view beside `ok: true`; `/markets`, `/market`,
    `/quotes`, `/desk`, `/venues`, `/reach`, `/statement`, `/exchanges`, `/paper/books`, `/read` wrap it under a key. A 200 can still carry
    per-venue refusals in `missing[]` or per-row `refusal`.
13. **Clock.** Every `at`/`asOf`/`now` is the server's clock in ISO; candles and desk equity points are epoch ms; `/history` buckets are
    5m/1h/1d; the Statement's month filter is New York time (the page's `nyDay`/`nyTime`).

### Appendix: numbers in one place

| Constant | Value | Where |
|---|---|---|
| page `/api/account` poll | 20 s; ×4 while the stream is connected | shell.js `REFRESH_MS`, `REFRESH_SLOW` |
| page API timeout | 15 s general, 25 s candles first view | core.js `API_TIMEOUT_MS`, `HISTORY_TIMEOUT_MS` |
| `/quotes` polls | every 5 s (Markets cards in view, live position cards), ttl 3 s (chart) | markets.js `MKT_POLL_MS`, live.js `LV_EVERY_MS` |
| `/explore` page cache / server cache | 20 s / 30 s | markets.js `MKT_TTL`; service.ts explore |
| `/book` `/trades` page polls | 2 s / 4 s, backoff to 60 s | book.js `BK_BOOK_MS`, `BK_TRADES_MS` |
| `/desk/feed` poll | 1 s while the floor shows | superagent.js |
| server caches | market 3 s · markets 60 s · positions 15 s · compare 15 s · funding 30 s · earn products 60 s / positions 15 s · receive 60 s · book 1.5 s · trades 3 s · explore 30 s · venues 30 min · paper curve 60 s | service.ts |
| server waits | stats 4 s · candle source 6 s · history view 20 s · page 12 s · book/trades 5 s · earn 8 s · settle race 3 s · earnings 3 s/venue · reach probe 6 s · place 24.5 s · paper bars 8 s | service.ts, reach.ts |
| SSE | heartbeat 15 s · retry hint 1 s · ring 500 · clients 32 · backlog 256 · follows 16 · coalesce 100/100/250 ms | account/stream.ts |
| net-worth snapshots | every 5 min; unchanged account hourly | server.ts `snapshotMs`, networth.ts |
