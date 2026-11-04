# The Account split, plan A2 — the face on two upstreams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The face, the client and Gravit read the Market from the market service (127.0.0.1:4821) and the wallet from the account (127.0.0.1:4820); the account stops answering the Market's routes and its four relays; compose runs three boxes and the drills say so.

**Architecture:**
- **Two upstreams in the face.** `face/src/account-proxy.ts` keeps the wallet half. A new `face/src/market-proxy.ts` serves the market's public reads and stream under `/data/market/…`. Both are built on one extracted core, `face/src/upstream-proxy.ts`. Each half follows its own dsh row: `mcp-account` (the seat) and a new `mcp-market`.
- **The account keeps a connected venue's own data** under `/api/account/connected/{explore,quotes,candles,book,trades}`. The name says "connected", so these routes cannot be taken for the market's. The public halves of its reads, its public follows, the relays and the copies A1 Task 6 made are deleted.
- **The client joins the halves in the host layer.** A pure `host/explore-join.js` joins the market's rows with the account's connected rows and its venue verdicts. `host/markets.js` reads a connected line from the account first and falls back to that line's public twin. The asset page is the account's parts plus the chart's own candles read. A market-stream twin of `wire/account-stream.js` carries the public follows.
- **Gravit's market reads are their own MCP server.** `market/src/mcp.ts` (`npm run market:mcp`) holds no key and raises no card. Its five tools leave the seat: they are renamed in every prompt, allow-list and gate list. The seat gains `portfolio_live_candles` and `portfolio_live_book` for connected venues.

**Tech Stack:** Node 22 and TypeScript in all three packages (vitest in `account/` and `market/`; `node --test` via tsx in `face/`); express 4; `@modelcontextprotocol/sdk` and zod in `market/`; the face's plain-ESM browser client, tested with a fake DOM.

**Spec:** `docs/superpowers/specs/2026-11-03-account-split-and-identity-design.md`. In scope: §4.3 items 3, 5, 6 and 7, §4.4, §4.5, §4.6 (compose and the drills) and §4.7 A2. Read §1–§4 and §7–§9. Background: plan A1 (`docs/superpowers/plans/2026-11-03-account-split-plan-a1-market-service.md`, built and merged), its Global Constraints and its section "Left for plan A2"; `DEVELOPMENT.md` §3.8, §3.9 and §3.10; `account/README.md` and `market/README.md`. Part B (Identity), iMessage, Gate 2's rules, the owner envelope and pairing are out of scope.

## Global Constraints

- **Where to work.**
  - Work on `feat/account-split-a2`, cut from local `main` at the commit that adds this plan, in the worktree `.claude/worktrees/account-split-a2`. Never push.
  - Never run `npm run service`, `npm run account:service`, `npm run market:service -- install`, `docker compose`, or a server outside a test.
  - Never open `.env*`, `~/.dsh/.credentials.yaml`, anything under `~/.buyer-agent-demo/`, or a key file.
  - `FACE_SMOKE=1` runs from the worktree, which is outside `/tmp` and `$TMPDIR`.
- **Commits.** Write each message to a file in the session scratchpad and commit with `git commit -F <that file's literal absolute path>`. The message has no backticks, no `$()`, no shell variables and no attribution lines. Each task's last step gives the message.
- **Three suites, green after every task.**
  - `cd market && npm test && npm run typecheck`. Baseline at 308a36c8: 284 tests.
  - `cd account && npm test && npm run typecheck`. Baseline: 2,188 tests in 143 files. Run `cd market && npm ci` first.
  - `cd face && npm test && npm run typecheck`. Baseline: 2,993 tests (2,960 pass, 33 skipped, 0 fail).
  - Tasks 5, 6 and 7 also run `cd face && FACE_SMOKE=1 npm test`.
- **Consumers move before routes go.** No task deletes an account route, a relay or a proxy route while a consumer still uses it. Consumers move in Tasks 4–6. Deletions happen in Task 7 only.
- **The two URLs.**
  - `FACE_ACCOUNT_URL`, default `http://127.0.0.1:4820` (unchanged).
  - `FACE_MARKET_URL`, default `DEFAULT_MARKET_URL = "http://127.0.0.1:4821"`.
  - `FACE_MARKET_DIR` overrides where the `mcp-market` row runs from. The default is the repo's `market/`, mirroring `FACE_ACCOUNT_SEAT_DIR`.
- **Route names.**
  - The account's kept keyed reads live under `/api/account/connected/`.
  - The face's market paths are `/data/market/{explore,quotes,candles,book,trades,stream,stream/markets}`. They map one-to-one to the market's `/api/{explore,quotes,candles,book,trades,stream,stream/markets}`.
  - Nothing new under the market says "account".
- **Tool names.**
  - The server is `market`, so its tools are `mcp__market__market_explore`, `…_quotes`, `…_candles`, `…_book` and `…_akshare`.
  - The seat loses `portfolio_explore`, `portfolio_candles`, `portfolio_book` and `portfolio_akshare`. It gains `portfolio_live_candles` and `portfolio_live_book`.
  - None of the four lost names appears anywhere in `GRAVIT.md`, `dsh/`, `roles/`, `bots/`, `face/src`, `face/plugins`, `face/client/js` or `account/src` after Task 4. Task 4's `moved-tools.test.ts` pins this.
- **Size budgets.** `GRAVIT.md` ≤ 4,500 bytes (`face/tests/gravit-md.test.ts`). `dsh/profile/lunhui-run.md` ≤ 3,000 bytes; it is at 2,975 and names no moved tool, so it is not edited.
- **The market's sentence when it is down** stays A1's `MARKET_DOWN`: "The market service is not answering, so prices here are not current."
- **Product copy** is English and uses the face's tokens (spec §3).
- **Rulings already made, not to be reopened:**
  - `/api/quotes` keeps refusing a public pair that is not China. No new public quote branch is added.
  - The market's refusal sentences lose the account and wallet wording once the account's copies are gone (Task 7).
  - The two Hyperliquid history lanes stay separate: the account's keyed lane and the market's public lane.

## Review Focus

- **The account down while a page shows a market on a keyed testnet venue** (`hyperliquid-paper`). The chart, book and trades must not fall back to Hyperliquid mainnet's public data. The fallback goes only to the public line with the same `connector`; this venue has none, so each part says "The Account is not answering". Test in Task 6 (`the Account down: a connected line falls back to its public twin, never another connection's`).
- **The market down while the account answers.** Markets shows the connected rows alone, with "The market is not answering" in `missing`. Portfolio shows its last prices marked old. Trade's prepare refuses in plain words. Tests in Task 6 (`the market down: the connected rows alone …` and `Portfolio marks prices old while the market is down`).
- **The two explore halves land apart.** A stale connected half (`stale: true`, the account not answering) is dropped from the join, so no connected line is offered on a dead account. A half that lands late for an older question lands nowhere. Test in Task 6 (`a stale connected half is dropped …` and `an explore half for a tab left lands nowhere`).
- **A seat newer than the running account.** After the merge but before the operator restarts the account, `portfolio_live_candles` and `portfolio_live_book` meet a 404. They must say to restart the account, not show an HTTP code. Test in Task 4 (`portfolio_live_candles on an Account without the connected routes says to restart it`).
- **One row disabled, the other not.** An operator patch can disable `mcp-market` while the seat runs, or the other way round. Only that half's `/data/…` routes answer 503 `disabled`; the other half's screens keep working. Test in Task 5 (`a disabled mcp-market row disables the market half alone`).

---

## File structure

**`market/`:**
- `src/mcp.ts` (new): the stdio MCP server with five read tools. `package.json` gains the script `market:mcp` and `"zod": "^4.5.0"`. Task 3.
- `src/reads.ts`, `src/core/errors.ts`, `src/refuse.ts`: the refusal sentences reworded, and a new code `E_MARKET_UNKNOWN_SOURCE`. Task 7.
- `src/server.ts` (the `close` fix) and `src/market-service.ts` (`answers`): Task 1.

**`account/`:**
- `src/portfolio/market/{hub,link,client}.ts`: hardening (Task 1); `raw` deleted (Task 7).
- `src/portfolio/service.ts`: `connectedOnly` and the connected explore and quotes (Task 2). In Task 7 the public branches go, the public follows go, and `asset` loses `candles`.
- `src/portfolio/server.ts`: the five connected routes (Task 2). In Task 7 the five public routes and the four relays go.
- `src/portfolio/mcp.ts`: the seat's tool changes (Task 4); `portfolio_asset`'s words (Task 7).
- `test/standin/ui-standin.ts`: it also runs a market in-process and prints its URL. Task 5.

**`face/`:**
- `src/upstream-proxy.ts` (new; the core extracted from `account-proxy.ts`), `src/market-proxy.ts` (new), `src/account-proxy.ts`, `src/main.ts`, `src/market-quotes.ts`: Task 5.
- `src/market-row.ts` (new), `src/boot.ts`, `scripts/check-home.ts`, `src/orders.ts`, `src/roles.ts`: Task 4.
- `plugins/lunhui/lib/account-fetch.mjs` → `market-fetch.mjs` (`git mv`), plus `freeze-tool.mjs`, `errors.mjs`, `runs.mjs`, `wencai.mjs` and `scripts/lunhui-standin-check.mjs`: Task 5.
- `client/js/wire/market-stream.js` (new), `wire/account-stream.js`, `host/explore-join.js` (new), `host/markets.js`, `host/trade.js`, `host/market-view.js`, `host/account-view.js`, `render/account.js`, `app.js`: Task 6.
- `tests/helpers/standin.ts` and the smokes: Task 5.

**Root:** `GRAVIT.md`, `dsh/profile/cycle.md`, `dsh/skills/mechanics/account-seat-guide/SKILL.md`, `dsh/README.md`, `dsh/profile/cordis.yml`, `roles/_template/README.md` and `bots/gravit/agent.cordis.yml` (rendered) change in Task 4. `compose.yml`, `face/docker-entrypoint.sh`, `CLAUDE.md`, `DEVELOPMENT.md`, `Gravit-Design.md`, `Gravit-Docs-and-Prompt-Loops.html` and the READMEs change in Task 8.

---

### Task 1: Hardening the link and the market (A1's deferred minors)

**Files:**
- Modify: `account/src/portfolio/market/hub.ts` (`connect`, `sendHold`, `hold`'s release, `mirror`), `account/src/portfolio/market/link.ts` (the loop's timer), `account/src/portfolio/market/client.ts` (an `onFail` hook).
- Modify: `market/src/market-service.ts` (`answers` exported) and `market/src/server.ts` (`close`).
- Test: `account/test/unit/market-hardening.test.ts`, `market/test/unit/market-service.test.ts` and `market/test/unit/server-guard.test.ts`.

**Interfaces:**
- `export const HUB_HEADERS_MS = 10_000` in `hub.ts`. `connect()` aborts its fetch if no headers arrive by then. Once headers arrive, the existing `SILENT_MS` heartbeat takes over.
- Holds and releases are serialized per market. Each `source|symbol` keeps one promise chain, and every hold or want POST for that key waits for the one before it. The wire does not change.
- A mirror is deleted when its last hold is released and no want for it lasts (`WANT_LASTS_MS`). The same check runs in `sendAll`. `hub.mirrorCount(): number` is exported for tests.
- `MarketClient.onFail(fn: () => void): () => void`. It fires on the first failure after an answer: the moment `staleSince` goes from undefined to set. `RemoteHub.onDown(fn): () => void` fires in `dropped()`. The link subscribes to both. When either fires while the next source read is scheduled `SOURCES_EVERY_MS` away, it clears that timer and schedules the read `SOURCES_WAIT_MS` away.
- `export async function answers(port: number, http: typeof fetch = fetch): Promise<boolean>` in `market-service.ts` is true only for `r.ok` and a JSON body whose `service === "market"`.
- `MarketServerHandle.close()`: the first call rejects with `o.close`'s error. Every later call resolves once the listener has closed. The listener-close promise is memoized on its own, so a rejection is never re-served.
- `client.ts` `raw()` clears `stale` on a 5xx. That minor is resolved in Task 7 by deleting `raw` together with the relays, its only users; Task 7's `MarketClient has no raw` pins it.

- [ ] **Step 1: Write the failing tests.**

  `account/test/unit/market-hardening.test.ts`. Use vitest's fake timers and an injected `fetch`.
```ts
it("a hub whose stream sends no headers is dropped after HUB_HEADERS_MS and tried again", ...)
  // fetch for /api/hub never resolves until aborted; advance HUB_HEADERS_MS + BACKOFF_MIN_MS → the hub fetch was called twice; hub.poke() is not blocked (a third call after poke)
it("a release posted after its hold reaches the market after it", ...)
  // the stub delays the first /api/hub/hold 50 ms; hold() then release() at once → the stub saw held:true then held:false, in that order
it("a market no hold and no want keeps is forgotten", ...)
  // hold, an event arrives, release; advance past WANT_LASTS_MS → hub.mirrorCount() === 0, hub.quote(src, sym) === undefined
it("the source list is asked again within 5 s of the first failure, not 60 s", ...)
  // the market answers /api/sources; a client.get fails (stub closed) → a /api/sources request within SOURCES_WAIT_MS + 100 ms
it("the source list is asked again within 5 s of the hub stream dropping", ...)
```
  In `market/test/unit/market-service.test.ts`:
```ts
it("status counts only a market as answering", ...)  // a stub on an ephemeral port answering {ok:true, service:"account"} → answers(port) false; {ok:true, service:"market"} → true; 500 → false
```
  In `market/test/unit/server-guard.test.ts`:
```ts
it("a close that throws rejects once, then closes quietly, and frees the port", ...)
  // startMarketServer({port:0, close: async () => { throw new Error("boom") }}): first close() rejects "boom"; second close() resolves; a new server listens on the same port
```

- [ ] **Step 2: Run them and see them fail.** Run `cd account && npx vitest run test/unit/market-hardening.test.ts` and `cd market && npx vitest run test/unit/market-service.test.ts test/unit/server-guard.test.ts`. Expected: FAIL. The constants, `onFail`, `onDown`, `mirrorCount` and the export of `answers` do not exist yet.
- [ ] **Step 3: Implement the interfaces above.**
- [ ] **Step 4: Run all three suites.** Expected: green, with A1's `market-link.test.ts` unchanged and passing.
- [ ] **Step 5: Commit.** Message: `fix: the market link and service, hardened - a hub stream with no headers is dropped, holds keep their order, idle mirrors are forgotten, the source list is re-asked within 5 s of a failure, status asks for a market, close never re-serves a rejection`.

---

### Task 2: The account's connected routes

**Files:**
- Modify: `account/src/portfolio/service.ts`. Add `connectedOnly`, `connectedExplore` and `connectedQuotes`.
- Modify: `account/src/portfolio/server.ts`. Add five routes beside the old ones; the old routes are left untouched.
- Test: `account/test/unit/account-connected.test.ts`.

**Interfaces:**
- `private connectedOnly(venue: string): Refusal | undefined` refuses a venue that is not connected and watched (`this.adapters.get(id)?.account.watchOnly && this.liveVenues.get(id)`):
```ts
no("E_WALLET_NOT_CONNECTED", { venue: id, message: `"${id.slice(0, 40)}" is not a venue connected to this account: its public data is the market's` })
```
- `async connectedExplore(o)` takes the same options as `explore`. It answers `exploreAcross({ connected: placed, public: [] }, …)` with the same checks, `serves`, cache key prefix `connected-explore|` and no China. `tab === "china"` is refused:
```ts
no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message: "China is the market's: its explore answers it" })
```
- `async connectedQuotes(pairs)` follows `quotes`' rules for 1 to 12 pairs. A connected pair is priced by `liveMarket`. Every other pair carries the `connectedOnly` refusal.
- The routes, with the query parsing and status codes of the old routes they mirror (`server.ts`):

| Route | Answers with |
|---|---|
| `GET /api/account/connected/explore` | `connectedExplore` |
| `GET /api/account/connected/quotes` | `connectedQuotes`, under `quotes` |
| `GET /api/account/connected/candles` | `connectedOnly`, then `candles` |
| `GET /api/account/connected/book` | `connectedOnly`, then `marketBook` |
| `GET /api/account/connected/trades` | `connectedOnly`, then `marketTrades` |

- [ ] **Step 1: Write the failing tests.** Build the service with a fake public source and a paper venue, the way `account-paper.test.ts` opens one, and use the server over it.
```ts
it("explores the venues connected, and no public line", ...)        // connected/explore?q=BTC: every item's at[] has connected:true; none has public:true
it("refuses China, which is the market's", ...)                      // ?tab=china → 409, refusal.message === "China is the market's: its explore answers it"
it("reads a connected venue's candles, book and trades as the old routes do", ...)  // deepEqual(connected/candles?venue=<paper>&symbol=BTC/USDT&range=1D, /api/account/candles same query); same for book and trades
it("refuses a public source by name", ...)                           // connected/candles?venue=fake&symbol=BTC/USDT → 409 code E_WALLET_NOT_CONNECTED, message '"fake" is not a venue connected to this account: its public data is the market\'s'
it("quotes connected pairs and refuses the rest one by one", ...)    // pairs=<paper>|BTC/USDT,fake|BTC/USDT → quotes[0].market defined, quotes[1].refusal.code E_WALLET_NOT_CONNECTED
```
- [ ] **Step 2: Run and see it fail.** Run `cd account && npx vitest run test/unit/account-connected.test.ts`. Expected: FAIL with 404s.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all three suites.** Expected: green.
- [ ] **Step 5: Commit.** Message: `feat(account): a connected venue's own reads under /api/account/connected - explore, quotes, candles, book and trades, a public source refused by name`.

---

### Task 3: `market:mcp`, the market's own MCP server

**Files:**
- Create: `market/src/mcp.ts`.
- Modify: `market/package.json`. Add the script `"market:mcp": "tsx src/mcp.ts"` and the dependency `"zod": "^4.5.0"`, then run `cd market && npm install`. The lock already holds zod 4.6.7.
- Test: `market/test/unit/mcp.test.ts`.

**Interfaces:**
- `const BASE = process.env.MARKET_URL ?? "http://127.0.0.1:4821"`. Requests are plain loopback fetches with no Origin header.
- Five tools, each `annotations: { readOnlyHint: true }`:

| Tool | Input | Calls |
|---|---|---|
| `market_explore` | `tab?, q?, sort?, limit?` | `GET /api/explore` |
| `market_quotes` | `pairs: string[]`, 1–12 `venue\|symbol` | `GET /api/quotes?pairs=` |
| `market_candles` | `venue, symbol, interval?, range?, before?, limit?` | `GET /api/candles` |
| `market_book` | `venue, symbol, depth?` | `GET /api/book` and `GET /api/trades?limit=30` |
| `market_akshare` | `tool, arguments?` | `POST /api/akshare/call` |

  - The input schemas are the seat's `portfolio_explore`, `portfolio_candles`, `portfolio_book` and `portfolio_akshare` schemas, taken from `account/src/portfolio/mcp.ts`.
  - `market_book`'s answer has the same shape as `portfolio_book`'s: `book`, then `trades` or `tradesNone` or `tradesRefused`.
  - **Descriptions.** Each is the seat's description, rewritten:
    - Drop every clause about a connected venue.
    - "The Account" becomes "the market".
    - `market_explore` says that a row's public lines name `connectTo`, and that what the owner has connected is the seat's `portfolio_account`.
    - `market_quotes` says it prices A shares (venue `china`) and that a public market's price is in `market_explore`.
- A fetch that fails answers `isError: true` with `{ok:false, error: "The market service is not answering, so prices here are not current."}`.
- `AKSHARE_TOOLS` comes from `./live/akshare.ts`. Importing it starts no child process.

- [ ] **Step 1: Write the failing tests.**

  The test starts an in-process market with `startMarketServer` over `createMarketCore({ sources: [fake], china: fakeChina, akshare: createAkshare({ command: process.execPath, args: [<the akshare fixture A1's akshare-routes.test.ts uses>] }) })`, mounted with `mountProtocol`, `mountCn`, `mountReads` and `mountStream`. It spawns `node <market>/node_modules/tsx/dist/cli.mjs src/mcp.ts` with `MARKET_URL` set to that market's URL, through the SDK's `StdioClientTransport`.
```ts
it("lists five read tools", ...)                       // names sorted === ["market_akshare","market_book","market_candles","market_explore","market_quotes"]; every annotations.readOnlyHint === true
it("market_explore answers the market's explore", ...) // JSON.parse(text).items[0].key === the fake's first key
it("market_book carries the book and the latest trades", ...)
it("market_quotes quotes an A share and passes a refusal on", ...)  // china|600519 → market defined; fake|BTC/USDT → refusal with a code
it("market_akshare passes a call through to the sidecar", ...)
it("a market not answering says so in plain words", ...)          // MARKET_URL=http://127.0.0.1:9 → isError, text contains "The market service is not answering"
```
- [ ] **Step 2: Run and see it fail.** Run `cd market && npx vitest run test/unit/mcp.test.ts`. Expected: FAIL, because `src/mcp.ts` does not exist.
- [ ] **Step 3: Implement `market/src/mcp.ts`.** Also add one line to `market/test/unit/no-wallet.test.ts`'s fs-write allow-list check: `mcp.ts` writes nothing to disk.
- [ ] **Step 4: Run all three suites.** Expected: green.
- [ ] **Step 5: Commit.** Message: `feat(market): market:mcp, the market's own MCP server - explore, quotes, candles, book and AKShare, read-only, no key`.

---

### Task 4: Gravit's tools — the `mcp-market` row and every rename

**Files:**
- Create: `face/src/market-row.ts`.
- Modify: `face/src/boot.ts` (insert the row right after `accountSeatPatches()`) and `face/scripts/check-home.ts` (`mcpRowIdsToDisable`).
- Modify: `face/src/orders.ts` (`SEAT_READ_RAW_NAMES` and its header) and `face/src/roles.ts` (the AKShare `NEVER` rule).
- Modify: `account/src/portfolio/mcp.ts`. Remove the four tools, add the two `portfolio_live_*` tools, drop the `AKSHARE_TOOLS` import, and update the header's lists. Drop `AKSHARE_TOOLS` from `account/src/portfolio/market/shapes.ts` once nothing imports it.
- Modify the prompts: `GRAVIT.md`, `dsh/profile/cycle.md`, `dsh/skills/mechanics/account-seat-guide/SKILL.md`, `dsh/README.md`, `dsh/profile/cordis.yml` and `roles/_template/README.md`.
- Regenerate: `bots/gravit/agent.cordis.yml` (`cd face && npm run render:roles`).
- Delete: `account/test/akshare-seat.test.ts`. `market/test/unit/mcp.test.ts` covers it now.
- Test: `face/tests/market-row.test.ts`, `face/tests/moved-tools.test.ts`, `boot.test.ts`, `check-home.test.ts`, `orders.test.ts`, `roles.test.ts`, `gravit-md.test.ts`, `account-seat-smoke.test.ts`, and `account/test/portfolio-mcp-real.test.ts`.

**Interfaces:**
- **`market-row.ts`** mirrors `account-seat.ts`:
```ts
export const MARKET_ROW_ID = "mcp-market";
export const MARKET_SERVER = "market";
export const MARKET_TOOL_PREFIX = "mcp__market__";
export const DEFAULT_MARKET_DIR: string;          // <repo>/market, resolved from this module
export const DEFAULT_MARKET_URL = "http://127.0.0.1:4821";
export function marketDir(): string;               // FACE_MARKET_DIR || DEFAULT_MARKET_DIR
export function marketUrl(): string;               // FACE_MARKET_URL || DEFAULT_MARKET_URL
export type MarketRowStanding = { disabled: true } | { disabled: false; url: string };
export function composedMarketRow(entries: Iterable<SeatEntryLike>): MarketRowStanding | undefined;  // url from config.env.MARKET_URL
export function marketRowPatches(dir = marketDir(), url = marketUrl()): FacePatchList;
```
  The row's config is `transport: "stdio"`, `serverName: "market"`, `command: process.execPath`, `args: [<dir>/node_modules/tsx/dist/cli.mjs, "src/mcp.ts"]`, `cwd: dir`, `env: { MARKET_URL: url }`, `toolCallTimeoutMs: 130_000` and `failOnStartupError: false`.
- **The seat.**
  - `portfolio_live_candles` takes `portfolio_candles`' schema, through `venueOf`, and calls `/api/account/connected/candles`.
  - `portfolio_live_book` takes `portfolio_book`'s schema and calls `/api/account/connected/book` and `/api/account/connected/trades`, keeping its answer shape.
  - Each description is the old one with its public half removed, ending "a public market's are market_candles / market_book, under mcp__market__".
  - A 404 answer says: `this Account has no connected-venue reads (/api/account/connected): restart it from this tree`.
  - The seat's real-account tool count goes from 36 to 34. `account-seat.ts`'s header and `seat.ts` say so.
- **Gate 2.** `SEAT_READ_RAW_NAMES` loses `portfolio_explore`, `portfolio_candles`, `portfolio_book` and `portfolio_akshare`, and gains `portfolio_live_candles` and `portfolio_live_book`. `mcp__market__*` is not under the seat prefix, so its tools are never carded. Gate 2's rules do not change.
- **Roles.** The AKShare rule's `rawNames` becomes `["portfolio_akshare", "market_akshare"]`. No role's allow-list changes: none names a moved tool (check with `grep -rn portfolio_ roles/*/role.yml bots/*/preset.yml`; expected: no output).
- **The prompts.**
  - `GRAVIT.md` lines 6–8 and 23 become: MARKET is the market service, read through `mcp__market__*` (keyless, no card; AKShare for A shares is `mcp__market__market_akshare`). ACCOUNT is the operator's Account, reached through the seat (`mcp__account__*`, paper venues only).
  - `cycle.md` lines 20–21 become: the market's reads through `mcp__market__market_*`, AKShare for A shares (`market_akshare`), and the Account's own positions, statement and history through the seat (`mcp__account__portfolio_*`).
  - `account-seat-guide`: the loop becomes `portfolio_account` → `portfolio_venues` / `mcp__market__market_explore` → `portfolio_live_preview` → …. The "quotes are public" bullet names `market_candles`, `market_book`, `market_explore` and `portfolio_live_markets`.
  - `lunhui-run.md` and `lunhui-module.md` are not edited.

- [ ] **Step 1: Write the failing tests.**
```ts
// face/tests/market-row.test.ts
test("marketRowPatches spawns the market's MCP server from market/ with this node and the install's tsx", ...)  // the config above, exactly
test("FACE_MARKET_DIR and FACE_MARKET_URL override the defaults", ...)
test("composedMarketRow follows the row as composed: disabled, or its MARKET_URL", ...)
// face/tests/boot.test.ts
test("the market row sits right after the seat row, once", ...)
// face/tests/check-home.test.ts: mcpRowIdsToDisable([]) deepEquals [ACCOUNT_SEAT_ROW_ID, MARKET_ROW_ID]
// face/tests/orders.test.ts
test("a market read raises no card, and the seat's two connected reads are reads", ...)  // mcp__market__market_book: no card; mcp__account__portfolio_live_book: classified read
// face/tests/roles.test.ts
test("a role naming market_akshare is refused as an AKShare tool", ...)  // plus the existing render-equals-file case
// face/tests/gravit-md.test.ts: GRAVIT.md ≤ 4,500 bytes, contains "mcp__market__market_akshare", does not contain "portfolio_akshare"
// face/tests/moved-tools.test.ts
test("no prompt, allow-list or code names a tool that left the seat", ...)
  // walk GRAVIT.md, dsh/, roles/, bots/, face/src, face/plugins, face/client/js, account/src (skip node_modules): no match of /\bportfolio_(explore|candles|book|akshare)\b/
  // roles.ts's NEVER rawName "portfolio_akshare" is the one allowed line, matched by its exact text
```
  In `account/test/portfolio-mcp-real.test.ts`:
```ts
it("lists portfolio_live_candles and portfolio_live_book and none of the four that left", ...)
it("portfolio_live_candles on an Account without the connected routes says to restart it", ...)  // a stub answering 404 → the sentence above
```
- [ ] **Step 2: Run and see them fail.** Run `cd face && node --import tsx --test tests/market-row.test.ts tests/moved-tools.test.ts tests/orders.test.ts tests/roles.test.ts tests/gravit-md.test.ts` and `cd account && npx vitest run test/portfolio-mcp-real.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Edit the code, then the prompts. Run `cd face && npm run render:roles`. Check the size with `wc -c GRAVIT.md`; expected ≤ 4500.
- [ ] **Step 4: Run all three suites,** then `cd face && FACE_SMOKE=1 node --import tsx --test tests/account-seat-smoke.test.ts tests/roles-smoke.test.ts`. Expected: green. The seat smoke's tool list has 34 tools.
- [ ] **Step 5: Commit.** Message: `feat: Gravit reads the market through mcp-market - five keyless tools; the seat keeps the wallet and gains portfolio_live_candles and portfolio_live_book; every prompt, gate list and role rule renamed`.

---

### Task 5: The face on two upstreams — the proxy, the desk's quotes, Lunhui and the stand-in

**Files:**
- Create: `face/src/upstream-proxy.ts` and `face/src/market-proxy.ts`.
- Modify: `face/src/account-proxy.ts`. It is rebuilt on the core and gains the five `connected/*` reads; the five public reads stay until Task 7.
- Modify: `face/src/main.ts`. Build `composedMarketRow`, register the market proxy, hand its reads to `marketQuotes`, and add its dispose.
- Modify: `face/src/market-quotes.ts`. Its deps become the market proxy's reads, and its header says so.
- Lunhui: `git mv face/plugins/lunhui/lib/account-fetch.mjs face/plugins/lunhui/lib/market-fetch.mjs`. Modify `freeze-tool.mjs`, `errors.mjs`, `runs.mjs` (`via`), `wencai.mjs`, `face/scripts/lunhui-standin-check.mjs` and `face/tests/fixtures/lunhui/{README.md,account.ts}`. Rename `face/tests/lunhui-account-fetch.test.ts` to `lunhui-market-fetch.test.ts`.
- The stand-in: modify `account/test/standin/ui-standin.ts` and `face/tests/helpers/standin.ts`. Set `FACE_MARKET_URL` in `account-market-smoke`, `account-graft-smoke`, `account-wallet-smoke`, `account-seat-smoke` and `lunhui-market-run-smoke`.
- Test: `face/tests/market-proxy.test.ts`, `account-proxy.test.ts`, `market-quotes.test.ts`, `lunhui-market-fetch.test.ts`, `lunhui-freeze.test.ts`, `standin-helper.test.ts`, and `account/test/unit/ui-standin.test.ts`.

**Interfaces:**
- **`upstream-proxy.ts`** is `account-proxy.ts`'s rules extracted unchanged: the fence, 405, the rebuilt query, the kept-answer cache, stale re-serve, unreachable codes, the piped stream and the POST rules.
```ts
export interface UpstreamRead { face: string; upstream: string; query: readonly string[]; long?: ReadonlyMap<string, number>; ttlMs: number; abortMs: number }
export interface UpstreamSettings { url: string; doFetch: typeof fetch; now: () => number; disabled: boolean }
export type UpstreamAnswer = { status: number; body: string } | { unreachable: string };
export type UpstreamRouteRead = (query: string) => Promise<UpstreamAnswer>;
export function mountReads(webServer: RouteRegistrar, s: UpstreamSettings, reads: readonly UpstreamRead[]): { read: Map<string, UpstreamRouteRead>; clear(): void };
export function mountStream(webServer: RouteRegistrar, s: UpstreamSettings, o: { face: string; upstream: string; followFace: string; followUpstream: string }): { abortAll(): void };
```
  `account-proxy.ts` keeps every export it has today: `AccountAnswer = UpstreamAnswer`, `AccountRouteRead = UpstreamRouteRead`, `ACCOUNT_QUERY` and the rest. Its `ReadRoute` gains `connectedExplore`, `connectedQuotes`, `connectedCandles`, `connectedBook` and `connectedTrades`. Their face paths are `/data/account/connected/<x>`, their account paths `/api/account/connected/<x>`; query names, TTL and abort are copied from the route each mirrors.
- **`market-proxy.ts`:**
```ts
export const MARKET_READS: readonly UpstreamRead[];  // explore, quotes, candles, book, trades: face /data/market/<r> → /api/<r>, query names, TTLs and aborts copied from ACCOUNT_QUERY / ACCOUNT_TTL_MS / ACCOUNT_ABORT_MS
export function registerMarketProxy(webServer: RouteRegistrar, deps?: { url?: string; fetch?: typeof fetch; now?: () => number; disabled?: boolean }):
  { explore: UpstreamRouteRead; quotes: UpstreamRouteRead; dispose(): void };
```
  It also mounts `/data/market/stream` → `/api/stream` and `POST /data/market/stream/markets` → `/api/stream/markets`, with the account stream's query names, limits and aborts.
- **Lunhui.**
  - `market-fetch.mjs` exports `DEFAULT_MARKET_URL = "http://127.0.0.1:4821"`, `marketOrigin`, `marketFetch`, `MARKET_UNAVAILABLE = "MARKET_UNAVAILABLE"`, `WENCAI_QUERY_URL`, `IFIND_UNCONFIGURED` and `IFIND_CREDENTIAL`.
  - The paths it calls (`/api/cn/relay`, `/api/cn/ifind`) and its header rules are unchanged. Its words say "the market at <origin>".
  - `freezeDeps` reads `config.market ?? (FACE_MARKET_URL || DEFAULT_MARKET_URL)` and returns `via: "market"`. `runs.mjs` takes only `via: "market"` for new evidence; sealed runs that say `"account"` are read as they are, and nothing reads `via` back.
- **The stand-in.**
  - `startStandin` also starts `startMarketServer({ port: 0, mount })` over `createMarketCore({ sources: publicSources(), hub })`. Both are the stand-in's own world, imported from `market/src` in test code, mounted with `mountProtocol`, `mountReads` and `mountStream`.
  - `Standin.marketUrl: string` is added. `close` closes the market too.
  - The main prints `  market        <url>  — start the face with FACE_MARKET_URL=<url>` after the account line.
  - The face's helper returns `{ url, marketUrl }`.

- [ ] **Step 1: Write the failing tests.**
```ts
// face/tests/market-proxy.test.ts (a stub market on an ephemeral port)
test("mounts seven routes under /data/market and nothing else", ...)
test("a read goes to the market's own path with its rebuilt query", ...)   // /data/market/explore?q=BTC → stub saw GET /api/explore?q=BTC; ?q=BTC&x=1 → 400, stub saw nothing
test("the market not answering is 503 unreachable, a kept answer re-served stale", ...)
test("a disabled mcp-market row disables the market half alone", ...)       // market proxy disabled → /data/market/explore 503 {"ok":false,"unreachable":"disabled"}; /data/account/holdings still reaches the account stub
test("the stream is piped from /api/stream, follows posted to /api/stream/markets", ...)
// face/tests/account-proxy.test.ts
test("the connected reads go to /api/account/connected/*", ...)            // and the route count is 43 until Task 7
// face/tests/market-quotes.test.ts: the US explore read and the A-share quotes read reach the market stub's /api/explore and /api/quotes
// face/tests/lunhui-market-fetch.test.ts: the old file's cases, renamed (DEFAULT_MARKET_URL, MARKET_UNAVAILABLE, "the market at"); its assertions otherwise unchanged
// face/tests/lunhui-freeze.test.ts: the evidence a freeze writes says via: "market"
// face/tests/standin-helper.test.ts: the helper parses the market line
// account/test/unit/ui-standin.test.ts
it("the stand-in serves its markets from a market of its own", ...)        // GET <marketUrl>/api/explore?q=BTC lists the stand-in's BTC; <marketUrl>/api/health service === "market"
```
- [ ] **Step 2: Run and see them fail.** Run `cd face && node --import tsx --test tests/market-proxy.test.ts tests/account-proxy.test.ts tests/market-quotes.test.ts tests/lunhui-market-fetch.test.ts` and `cd account && npx vitest run test/unit/ui-standin.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Extract the core first and keep `account-proxy.test.ts` green before adding anything. Then add the market proxy, `main.ts`, the desk's quotes, Lunhui and the stand-in.
- [ ] **Step 4: Run all three suites, then `cd face && FACE_SMOKE=1 npm test`.** Expected: 0 fail.
- [ ] **Step 5: Commit.** Message: `feat(face): two upstreams - the market's reads and stream under /data/market, the account's connected reads, the desk's quotes and Lunhui on the market, the stand-in with a market of its own`.

---

### Task 6: The client on two upstreams — the joins, the market stream and the old-price marker

**Files:**
- Create: `face/client/js/host/explore-join.js` and `face/client/js/wire/market-stream.js`.
- Modify: `face/client/js/wire/account-stream.js`. `createAccountStream` takes optional `paths: {stream, follow}` and `eventTypes`; the defaults are today's values.
- Modify: `face/client/js/host/markets.js`, `face/client/js/host/trade.js`, `face/client/js/app.js` and `face/client/js/host/market-view.js` (`NOT_ANSWERING_WORD` becomes `'The market is not answering · China as last read'`).
- Modify: `face/client/js/host/account-view.js` (`marketOldOf`) and `face/client/js/render/account.js` (the Portfolio line).
- Test: `face/tests/client/explore-join.test.js`, `market-stream.test.js`, `host-markets.test.js`, `host-trade.test.js`, `markets.test.js`, `account-view.test.js` and `account.test.js`.
- Test: `account/test/unit/explore-join-parity.test.ts`, deleted again in Task 7.

**Interfaces:**
- **`explore-join.js`:**
```js
/** @returns {object|null} an explore body as the views read it ({ok:true, items, movers, closing, mostTraded, tabs, missing, notes, asOf, china?, stale?}) */
export function joinExplore(market, connected, { venues = [], here = [] } = {})
```
  `market` and `connected` are the two bodies, or null for a half that failed. `venues` are `venuesOf(page)` rows; `here` is the venues read's rows, `{connector, verdict}`. The rules:
  1. A connected body with `stale: true` is treated as null. A stale market body is kept, and the result carries `stale: true`.
  2. A market row's line (`at` entry, and each outcome's `at`) is dropped when it is `public: true` and its `connector` is either:
     - the `connector` of a `venues` row that is not paper (the connected venue speaks for it), or
     - one whose `here` verdict is `not-served`, `closed` or `close-only`.
     A row left with no lines is dropped.
  3. A key in both bodies has its lines in this order: the connected row's non-paper lines, then the market row's kept lines, then the connected row's paper lines. The market row lends the row-level fields when the connected row is `paper: true` or its `volumeUsd24h` is smaller; otherwise the connected row does. Fields the lender lacks are filled from the other row.
  4. `items` are the market's rows in its order, then the connected-only rows in their order, cut to the market body's length (or the connected body's, when the market is null).
  5. `tabs` have the market's order and labels; the count is the market's count plus the connected-only rows in that tab. `movers`, `closing` and `mostTraded` are the market's lists with joined rows swapped in, then connected-only entries, each list cut to its longer source length.
  6. `missing` is both lists, plus a line for each half that is null:
     - `{venue:"account", venueName:"the Account", why:"The Account is not answering: the venues connected are not listed"}`
     - `{venue:"market", venueName:"the market", why:"The market is not answering: public markets are not listed"}`
     `notes` are both, without duplicates. `asOf` and `china` are the market's.
- **`market-stream.js`:**
  - `export function createMarketStream(deps, onEvent)` is `createAccountStream` with `paths: {stream: "/data/market/stream", follow: "/data/market/stream/markets"}` and `eventTypes: ["snapshot", "quote", "trades", "book", "hb"]`.
  - `app.js` opens it beside the account stream. A market `snapshot` dispatches `streamSnapshot`, and a market `quote` dispatches `streamQuote`.
- **`host/markets.js`:**
  - **Explore.**
    - Each explore read (a tab, a search, China's ranking) asks `/data/market/explore?…` and `/data/account/connected/explore?…` with the same query. China's ranking and its search hits come from the market alone.
    - The host keeps the latest body of each half per tab. On every landing it dispatches `exploreLoaded` with `data: joinExplore(market, connected, {venues: venuesOf(page), here: venuesHere rows})`. It dispatches `exploreFailed` only when both halves failed, with the market's sentence.
    - The venues read (`/data/account/venues`) is asked once when Markets is shown, landing `venuesHereLoaded`.
  - **Quotes.** The pairs are split by line: a pair at a venue in `venuesOf(page)` goes to `/data/account/connected/quotes`, every other pair (China's among them) to `/data/market/quotes`. These are two flights, `quotes:account` and `quotes:market`.
  - **Keyed-first** applies to candles, book and trades at the line the page follows (`followOf`).
    - A connected line asks `/data/account/connected/<r>`.
    - When that read fails with the Account not answering — a rejection whose body is `{unreachable}`, or no body — the host asks `/data/market/<r>` once, at the public line of the same row whose `connector` equals the connected venue's `connector`. With no such line, the part fails with "The Account is not answering".
    - A refusal (409) is the answer, never a reason to fall back.
    - A public line asks the market directly. An A share asks `/data/market/candles?venue=china`.
  - **Follows.** A connected line is followed on the account stream and a public line on the market stream. Whichever is not used is told `follow([])`.
  - **Unchanged.** `compare`, `asset` and `funding` stay the account's. The page draws its chart from the candles read and its You here from the asset read.
- **`host/trade.js`.** The picks and the search are the joined explore, built the same way. The ticket follows its able line, always a connected one, on the account stream, as today.
- **The old-price marker.**
  - `export function marketOldOf(holdingsBody): { since: string; message: string } | null` in `account-view.js`.
  - `render/account.js` draws one line under Portfolio's worth: `Prices are old · <message> · since <HH:MM>`, in the face's muted note style.
  - The rows keep their last prices.

- [ ] **Step 1: Write the failing tests.**
```js
// face/tests/client/explore-join.test.js
test("a public line is left out where a connected venue speaks for its connection", ...)
test("a public line is left out where the venues read says its venue does not serve here", ...)
test("a row both list carries the connected lines first, then the public, then the paper", ...)
test("a paper row lends no price where the market lists the thing", ...)
test("a row only the Account lists comes after the market's rows", ...)
test("a stale connected half is dropped, and missing says the Account is not answering", ...)
test("the market down: the connected rows alone, and missing says the market is not answering", ...)
// face/tests/client/market-stream.test.js
test("opens /data/market/stream and posts its follows to /data/market/stream/markets", ...)
test("takes snapshot, quote, trades, book and hb, and no wallet event", ...)
// face/tests/client/host-markets.test.js
test("explore reads both halves and lands their join", ...)
test("an explore half for a tab left lands nowhere", ...)
test("a page on a connected line reads its candles, book and trades from the Account's connected routes", ...)
test("the Account down: a connected line falls back to its public twin, never another connection's", ...)
  // row with a hyperliquid-paper line (connector live:hyperliquid-paper) and a public hyperliquid line (live:hyperliquid-trade): connected read rejects {unreachable:"ECONNREFUSED"} → no /data/market/book asked; part failed "The Account is not answering"
  // row with a connected okx line and a public okx line of the same connector → /data/market/book?venue=okx asked once and landed
test("a refusal from the Account is the answer, with no fallback", ...)
test("quotes split by line: connected pairs to the Account, the rest to the market", ...)
test("a public line is followed on the market stream, a connected line on the Account's", ...)
test("China's ranking, search and history are the market's", ...)
// face/tests/client/host-trade.test.js
test("the picks are the joined explore, and the ticket follows its able line on the Account's stream", ...)
// face/tests/client/account-view.test.js and account.test.js
test("Portfolio marks prices old while the market is down", ...)   // marketOldOf; the rendered line contains "Prices are old" and the MARKET_DOWN sentence
```
  In `account/test/unit/explore-join-parity.test.ts`, import `../../../face/client/js/host/explore-join.js`:
```ts
it("the join of the market's explore and the connected explore lists what the account's explore lists", ...)
  // fakes: a public source, a paper venue; old = svc.explore({q:"BTC"}); joined = joinExplore(marketReads(core).explore({q:"BTC"}), svc.connectedExplore({q:"BTC"}), {venues, here: []})
  // same set of item keys; for each key the same set of (venue, symbol, connected) lines
```
- [ ] **Step 2: Run and see them fail.** Run `cd face && node --import tsx --test tests/client/*.test.js` and `cd account && npx vitest run test/unit/explore-join-parity.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Start with the pure join and the wire twin, then the hosts, then the marker. Update the paths in the existing client tests' fakes as the hosts change.
- [ ] **Step 4: Run all three suites, then `cd face && FACE_SMOKE=1 npm test`.** Expected: 0 fail. `gravit-client-smoke` and `account-market-smoke` draw Markets from the stand-in's market.
- [ ] **Step 5: Commit.** Message: `feat(client): Markets and Trade on two upstreams - the market's rows joined with the connected venues in the host, a connected line read from the Account first with its public twin as the fallback, the market stream, old prices marked on Portfolio`.

---

### Task 7: The account drops what the market answers

**Files:**
- Modify: `account/src/portfolio/server.ts`. Delete `/api/account/{explore,quotes,candles,book,trades}`, the four relays (`/api/cn/relay`, `/api/cn/ifind`, `/api/akshare/tools`, `/api/akshare/call`) and their `market` relay helper. The start line keeps `market: <url> · answering | not answering yet`.
- Modify: `account/src/portfolio/service.ts`.
  - Delete `explore` and `exploreChina`. `connectedExplore` keeps its name.
  - `quotes` becomes `connectedQuotes` alone.
  - `candles`, `marketBook` and `marketTrades` lose their public branches (`const src = this.publicMarkets().find(…)` onwards) and start with `connectedOnly`.
  - `streamAt` returns `undefined` unless the venue is in `this.liveVenues`.
  - `asset` loses `candles` and `candlesFor`, and `AssetDetail` loses the field.
  - `publicMarkets()` stays: paper, `dayStats` and the desk use it.
- Modify: `account/src/portfolio/market/client.ts`. Delete `raw`.
- Modify: `account/src/portfolio/mcp.ts`. `portfolio_asset`'s description drops its `candles` clause and adds "its price history is market_candles' (or portfolio_live_candles' at a venue connected)".
- Modify: `market/src/reads.ts`, `market/src/core/errors.ts` and `market/src/refuse.ts`. Reword the sentences (table below) and add `E_MARKET_UNKNOWN_SOURCE: { layer: "VENUE", zh: "市场没有这个公开行情源" }` with English `"the market has no public source by that name"`.
- Modify: `face/src/account-proxy.ts`. Remove the five public reads; the header counts thirty-eight routes again. Modify `face/scripts/capture-account-fixtures.ts`, which reads the public bodies from the stand-in's `marketUrl` at the market's paths.
- Delete: `account/test/unit/market-parity.test.ts`, `market-relay.test.ts` and `explore-join-parity.test.ts`.
- Migrate the account tests that hit a deleted route or branch:
  - Files: `test/attack/ask-candles-earn-holes.test.ts`, `test/unit/{account-candles-range,account-china,account-paper,account-wallet-api,account-wallet-contracts,geo-after-connect,live-book,live-trade-dex,market-account,market-down,market-link,review2-placeholder,review2-service,ui-standin}.test.ts` and `test/standin/venues.ts`.
  - The rule: a case about a connected venue moves to its `/api/account/connected/*` route. A case about public data is deleted where `market/test/unit/` holds its counterpart (`reads.test.ts`, `live-*.test.ts`). Otherwise it moves to `market/test/unit/reads.test.ts` over a `createMarketCore` of the same fakes.
- Test: `account/test/unit/no-market-code.test.ts`, `account/test/unit/account-stream.test.ts`, `market/test/unit/reads.test.ts`, `market/test/unit/no-wallet.test.ts` and `face/tests/account-proxy.test.ts`.

**The market's sentences after this task:**

| Where | Code | Message |
|---|---|---|
| `notPublic` (candles, book, trades) | `E_MARKET_UNKNOWN_SOURCE` | `"<id>" is not a public market source: Markets names each source by its id` |
| a non-China pair in `quotes` | `E_VENUE_RAIL_CLOSED` | `"<venue>" is priced in explore: the market quotes A shares only (venue "china")` |
| `CHINA_NOT_READ` | (unchanged) | `China is not read by this market` |
| the unread book | (unchanged) | `The market reads no order book from <name>, and it gives no best bid or ask for <symbol> just now` |
| the trades `none` | (unchanged) | `<name> publishes no trades the market can read` |

The header comments of `reads.ts` and `follows.ts` drop "the account's copy" and "kept alike" and say these are the face's reads.

- [ ] **Step 1: Write the failing tests.**
```ts
// account/test/unit/no-market-code.test.ts
it("account/src serves no market route and no relay", ...)    // server.ts matches none of "/api/cn/", "/api/akshare/", "\"/api/account/explore\"", "\"/api/account/quotes\"", "\"/api/account/candles\"", "\"/api/account/book\"", "\"/api/account/trades\""
it("MarketClient has no raw", ...)                             // client.ts does not match /\braw\s*\(/
it("the asset answer carries no candles", ...)                 // svc.asset("crypto:BTC") has no "candles" key
// account/test/unit/account-stream.test.ts
it("a public market is not followed on the account's stream; a paper venue's market is", ...)  // follow coinbase:BTC/USD → no quote event after a hub tick; follow <paper>:BTC/USDT → a quote event
// market/test/unit/reads.test.ts: one case per row of the table above, asserting code and message exactly
// market/test/unit/no-wallet.test.ts
it("the market's reads say nothing of an account", ...)        // reads.ts, follows.ts, routes-cn.ts, protocol.ts: no match of /this account|connected live|the account (reads|can read)|E_WALLET_ACCOUNT_UNKNOWN/
// face/tests/account-proxy.test.ts: thirty-eight routes; /data/account/explore is not registered (404 from the host)
```
- [ ] **Step 2: Run and see them fail.** Run `cd account && npx vitest run test/unit/no-market-code.test.ts test/unit/account-stream.test.ts` and `cd market && npx vitest run test/unit/reads.test.ts test/unit/no-wallet.test.ts`. Expected: FAIL.
- [ ] **Step 3: Delete, migrate and reword as above.** Run `cd account && npm run typecheck` to find what still names a deleted member.
- [ ] **Step 4: Run all three suites, then `cd face && FACE_SMOKE=1 npm test`.** Expected: green, and the account file count is recorded for Task 8.
- [ ] **Step 5: Commit.** Message: `refactor(account): the account answers no Market read - its public explore, quotes, candles, book, trades and follows, the four relays and the copies plan A1 made are gone; the market's sentences lose the account's words`.

---

### Task 8: Three boxes, the docs and the drills

**Files:**
- Modify: `compose.yml`, `face/docker-entrypoint.sh` and `face/tests/compose.test.ts`.
- Modify: `CLAUDE.md`, `DEVELOPMENT.md` (§3.6, §3.9, §3.10, §4.2, §4.3, §4.4, §4.6, §5.2, §5.3, §7.4 and Appendix A), `Gravit-Design.md` (its one `portfolio_akshare`), `Gravit-Docs-and-Prompt-Loops.html` (its tool names and the loop stations that name them), `face/README.md`, `account/README.md`, `market/README.md` and `dsh/README.md`.

**Interfaces:**
- **`compose.yml`'s `agent`:**
  - `environment.FACE_MARKET_URL: "http://market:4821"`.
  - `depends_on.market.condition: service_healthy` beside the account's.
  - Volumes `./market:${PWD}/market:ro` and `market-modules:${PWD}/market/node_modules`, plus `market-modules: {}` under `volumes`.
  - The header says the agent box reaches the market at `market:4821` for the Markets screens and `mcp-market`.
- **`docker-entrypoint.sh`:** `for dir in ../face ../account ../market`.
- **`face/README.md`:**
  - "The two-box drill" becomes **"The three-box drill"**:
    - Up: `cd account && npm ci` and `cd market && npm ci` on the host first.
    - The fence: neither 4820 nor 4821 answers on the host. `docker compose exec agent node -e "fetch('http://market:4821/api/health')…"` prints 200.
    - The standing: Discover lists `account` with 34 tools and `market` with 5.
    - The read: `market_explore` (tab=stocks, q=AAPL) with no card.
    - AKShare: `market_akshare` with no card.
    - The negative and Down as before.
  - "The two-parts drills" become **"The three-parts drills"**:
    - China: rows from the market. Stopping the market says `The market is not answering · China as last read`.
    - Lunhui: evidence `via: "market"`. Stopping the market makes a freeze refuse naming the market.
    - AKShare through `market_akshare`.
    - Keyed-first on `hyperliquid-paper`. With the account stopped, its book says the Account is not answering and is never mainnet's.
    - The market stopped: Portfolio says `Prices are old`, and Trade's prepare refuses with `MARKET_DOWN`.
    - Rules, the page gone, and the boxes as before.
  - The drill index lines that cite either title change.
- **`CLAUDE.md`:**
  - The `market/` row names `market:mcp` and the face's `/data/market` reads.
  - The `account/` row loses the relays and names `/api/account/connected/*`.
  - The `face/` row says it has two upstreams.
  - The seat row adds `face/src/market-row.ts` and `market-proxy.ts`.
  - The Account gotcha says three processes.
  - Update "Last reviewed". The file grows by at most four lines.
- **`DEVELOPMENT.md` §7.4** records the suite counts from Step 4 and states that both drills are not yet run.

- [ ] **Step 1: Write the failing test.** Edit `face/tests/compose.test.ts`:
```ts
assert.equal(c.services.agent.environment.FACE_MARKET_URL, "http://market:4821");
assert.equal(c.services.agent.depends_on.market.condition, "service_healthy");
assert.ok(c.services.agent.volumes.includes("./market:${PWD}/market:ro"));
assert.ok(c.services.agent.volumes.includes("market-modules:${PWD}/market/node_modules"));
assert.ok("market-modules" in c.volumes);
assert.match(readFileSync(join(ROOT, "face", "docker-entrypoint.sh"), "utf8"), /for dir in \.\.\/face \.\.\/account \.\.\/market/);
```
  And in `market/test/unit/no-wallet.test.ts`'s README case, add `"npm run market:mcp"` and `"FACE_MARKET_URL"`.
- [ ] **Step 2: Run and see it fail.** Run `cd face && node --import tsx --test tests/compose.test.ts`. Expected: FAIL.
- [ ] **Step 3: Edit the files and write the docs.** The docs state present-tense facts only.
- [ ] **Step 4: Run all three suites, then `cd face && FACE_SMOKE=1 npm test`.** Record the counts in `DEVELOPMENT.md` §7.4. Do not run `docker compose`.
- [ ] **Step 5: Commit.** Message: `docs: three boxes - compose gives the agent the market, the three-box and three-parts drills, CLAUDE.md, DEVELOPMENT and the READMEs as built`.

---

## Self-review

- **Spec coverage:**

| Spec | Where |
|---|---|
| §4.3 item 3 (keyed-first) | Tasks 2 and 6 |
| §4.3 item 5 (two streams) | Tasks 5 and 6; the account keeps only connected follows (Task 7) |
| §4.3 item 6 (explore's venues) | Task 6 `joinExplore` |
| §4.3 item 7 (the asset) | Task 6; the field is dropped in Task 7 |
| §4.4 | Tasks 3 and 4 |
| §4.5 | Tasks 5 and 6; `no-market-hosts.test.ts` is unchanged and still passes |
| §4.6 (compose and the drills) | Task 8 |
| §4.7 A2 | Tasks 5–8 |
| "Left for plan A2" | each item covered above, including `marketOld` (Task 6) |
| A1's minors | Task 1, and `raw` in Task 7 |

- **Types:** these names are used the same way in every task: `connectedOnly`, `connectedExplore`, `connectedQuotes`, `/api/account/connected/*`, `MARKET_ROW_ID`, `composedMarketRow`, `registerMarketProxy`, `UpstreamRouteRead`, `joinExplore`, `createMarketStream`, `marketOldOf`, `DEFAULT_MARKET_URL`, `MARKET_UNAVAILABLE` and `via: "market"`.
- **Review Focus:** each of its five lines has its test in the owning task (Tasks 6, 6, 6, 4 and 5).

## For the operator, after the merge (not an agent's step)

1. `cd market && npm ci`. It adds zod for `market:mcp`.
2. Restart the market: `npm run market:service -- restart`, or `npm run market` in a terminal.
3. Restart the account: `npm run account:service -- restart`, or `npm run account`. Until you do, `portfolio_live_candles` and `portfolio_live_book` say to restart it.
4. Restart the face (`cd face && npm run service -- restart`, or `npm start`) and hard-reload the browser. Discover's MCP shelf should list `account` with 34 tools and `market` with 5.
5. Run `face/README.md` "The three-parts drills" on paper venues. Record them in `DEVELOPMENT.md` §7.4.
6. With Docker Desktop up and the host face stopped, run "The three-box drill": `cd account && npm ci`, `cd market && npm ci`, then `docker compose up --build` at the repo root.
   - If an earlier up left module volumes, `docker volume rm` the project's `face-modules` and `account-modules` first.
   - Observe that neither 4820 nor 4821 answers on the host, that `market:4821/api/health` answers from the agent box, and that `market_explore` and `market_akshare` answer with no card.
