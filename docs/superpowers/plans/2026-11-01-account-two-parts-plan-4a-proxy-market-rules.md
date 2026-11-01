# The Account's two parts, plan 4a — the proxy's new routes, the Market half, Rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The face's proxy carries every Account route the two halves need (§5.5), the OAuth callback comes back through the face, and the face does the Market half's page-only items (close, amend, leverage; a market's "you here", its book, its latest trades, a perpetual's funding) and the wallet half's Rules (Guard ⇄ Beast, the cap, the agents' session, their leverage) — so that, with plan 4b, nothing of §5.1's fifteen items is left to the Account's own page.

**Architecture:** `face/src/account-proxy.ts` grows from twenty exact routes to thirty-eight by the same tables (reads with a whitelist, TTL and abort; POST writes whose bodies pass unparsed), plus one GET navigation route — the OAuth callback — behind a narrow fence exception in `face/src/http.ts`. The Account builds its OAuth redirect and its wallet sentence on the origin the browser uses, which the proxy names in one header. On the client, every new signed action is a new kind on the existing sheet engine (`client/js/host/sheet.js`: prepare → What you sign → sign through `host/owner.js`), its fields and draft in a small per-half module that `host/sheet-view.js` dispatches to; the two unsigned safer-direction writes are plain posts through the owner device's `post`. Views stay pure (`host/*-view.js`), renderers draw them.

**Tech Stack:** `face/`: Node 22, TypeScript server (`node --test` via tsx: `npm test`, `npm run typecheck`, `FACE_SMOKE=1` for real boots), the browser client in plain ES modules with fake-DOM tests (`face/tests/client/*`). `account/`: Node 22, express, vitest (`npm test`, `npm run typecheck`).

**Spec:** `docs/superpowers/specs/2026-11-01-account-two-parts-design.md` (§5.1–§5.3 Market half and Rules, §5.5, §5.8's words for this half; §3 anti-goals; §6; §9 calls 6, 7, 8, 10; §10 "the new proxy routes' TTLs and aborts; the OAuth redirect origin; the layout of … the Market half's sheets"). Companion: `docs/superpowers/plans/2026-11-01-account-two-parts-plan-4b-wallet.md` — **this plan (4a) is built first; 4b consumes its routes.** Conventions from plans 1–3 (`…-plan-1-china.md`, `-plan-2-lunhui.md`, `-plan-3-akshare.md`).

## Global Constraints

- **The face holds no key and signs nothing itself (D18).** Every signed action is `sheet.open(kind, seed)` → `/data/account/prepare` → What you sign → `owner.submit` (`client/js/host/sheet.js:37-153`, `host/owner.js:132-161`). The only unsigned writes are the two the Account itself defines as the safer direction: Guard (`POST /api/mode {mode:"guard"}`, `account/src/portfolio/server.ts:1093-1100`) and Close to agents (`POST /api/revoke {account}`, `server.ts:1102-1108`).
- The door protocol, the envelope, the Guard, every existing Account route's shape and every existing proxy route are unchanged. The Account gains one read of one request header (Task 2) and changed words; nothing else in `account/`.
- The proxy's rules (header of `face/src/account-proxy.ts:1-69`) hold for every new route: `exact` routes, the route table is the allow-list; a plain loopback fetch with no Origin, no Sec-Fetch-*, no cookie, `redirect: "error"`; a read's query rebuilt from its whitelist; a write's body read under its limit, declared `application/json`, forwarded as posted, never parsed, kept, echoed or logged — the one exception is `guard`, whose browser body is read under its limit and discarded, the Account always receiving the fixed body `{"mode":"guard"}`; only 2xx reads are kept, per rebuilt query, for the route's TTL; a failed fetch is `503 {"ok":false,"unreachable":"<CODE>"}`; a disabled seat row disables every route.
- Paper venues only: the new keys are drawn for whatever the Account offers, and are exercised in tests and smokes only on the Account's stand-in (`account/test/standin/ui-standin.ts` through `face/tests/helpers/standin.ts`), never on 4820, never on `~/.buyer-agent-demo`.
- Tests are offline: the proxy's with an injected `fetch`, the client's with the fake DOM (`face/tests/client/helpers`), the smoke against the stand-in. `face/tests/no-market-hosts.test.ts` stays green: nothing in `face/` reaches past the Account.
- Product copy is English; the exact sentences this plan pins are written in its tasks; every other sentence a sheet shows is the Account's own (`refusal.message`, `quote.words`, `shown`).
- `face/` suite and typecheck green; `FACE_SMOKE=1` green; `account/` suite green but the known red `test/unit/ui-superagent.test.ts`.
- Work on `feat/two-parts-4a` from local `main` (c8c76485) in a worktree (`.claude/worktrees/two-parts-4a`); never push; never touch `strategies/*`, `~/.dsh`, `~/.buyer-agent-demo` or `.claude/launch.json`; commit messages written to a file in the session scratchpad and committed with `git commit -F <file>`, no backticks, no attribution lines.
- `feat/desk-p1-p4` overlaps this plan in `face/src/http.ts` alone (of the spec's six files, §7): whichever lands second resolves it. `face/src/main.ts` is not edited (every new route is registered inside `registerAccountProxy`).
- Out of scope: the Account's page and its tests stay until plan 5; the Superagent, Intents and Memory stay off the face (§5.4); the charter, `DEVELOPMENT.md`, `CLAUDE.md` and the READMEs move with plan 5's documents (spec §8) — each task's header comments say what is true.
- `face/client/*` is served with no cache headers: a drill hard-reloads.

## Review Focus

- **An order that changes under its Change… sheet** — it fills or is cancelled on the stream while the sheet is open: the Account's refusal is drawn in its words with Prepare again, and nothing signs for a gone order; the sheet's key on the row disappears once the page no longer lists the order. Test in Task 3.
- **Guard pressed twice, or on a page that does not sign** — one request in the air, the second press a no-op until it is answered; a page that does not sign may still press Guard (the safer direction needs no owner, as the Account rules), never Beast or a signed row. Test in Task 5.
- **The callback reached as something other than the venue's navigation** — a cross-site `fetch`, a POST, a forged Host, a query name outside the five, an over-long `code`: 403 or 400 before the Account is asked; only a GET top-level document navigation on a loopback Host passes. Test in Task 2.
- **A read-only Account** (started without writes): Rules says why for the cap, the session and leverage and draws no key for them; the mode row stays; Close…, Change… and Leverage… are not drawn on a page whose `connectLive.writes.on` is not true. Tests in Tasks 3 and 5.
- **An Account that does not answer a new read** — an older 4820 without the route (express's 404 page) or one that is down: the market page draws everything else, and each new section says it is unavailable, never a stale figure as current and never a parse error. Test in Task 4.

---

## File structure

| File | Responsibility |
|---|---|
| `face/src/account-proxy.ts` (modify) | eight reads, nine writes, the callback route; the origin header |
| `face/src/http.ts` (modify) | `isTrustedNavigation` — the callback's fence, and nothing else's |
| `account/src/portfolio/server.ts` (modify) | `faceOriginOf(req)`; `signin/start` and `wallet/challenge` build on it; the callback page's and its refusal's words |
| `account/src/portfolio/live/proof.ts` (modify) | the wallet sentence's words |
| `face/client/js/host/sheet-market.js` (new) | the `close`, `amend`, `leverage` kinds: fields, drafts, titles, go words |
| `face/client/js/host/sheet-rules.js` (new) | the `beast`, `cap`, `session`, `leverageCap` kinds |
| `face/client/js/host/sheet-view.js` (modify) | `SHEET_KINDS`, `titleOf`, `goWord`, `fieldsOf`, `draftOf` delegate to the two modules |
| `face/client/js/host/account-view.js` (modify) | `openOrdersOf` and `positionsOf` carry `kind`, `stopPrice`, `leverage`; `venuesOf` carries `tradeCan`; `writesOn(page)` |
| `face/client/js/host/rules-view.js` (new) | `rulesOf(page)` — the Rules tab's rows |
| `face/client/js/host/market-depth-view.js` (new) | `hereOf`, `bookOf`, `tradesOf`, `fundingOf` — a market page's four new sections |
| `face/client/js/host/markets.js`, `host/account.js` (modify) | the page's four reads and their cadence; `guard()` |
| `face/client/js/reducers/markets.js`, `reducers/account.js`, `data/empty.js` (modify) | the slices those reads land in |
| `face/client/js/render/markets.js`, `render/trade.js`, `render/account.js`, `router.js`, `app.js` (modify) | the keys, the sections, the Rules tab |
| `face/tests/account-proxy.test.ts`, `http.test.ts` (modify); `account/test/unit/face-origin.test.ts` (new) | the server half |
| `face/tests/client/sheet-market.test.js`, `sheet-rules.test.js`, `rules-view.test.js`, `market-depth-view.test.js` (new); `host-markets.test.js`, `host-account.test.js`, `account-view.test.js`, `app-dom.test.js` (modify) | the client half |
| `face/tests/account-market-smoke.test.ts` (new) | one real boot over the stand-in |

---

### Task 1: The proxy's new reads and writes

**Files:**
- Modify: `face/src/account-proxy.ts` (`ReadRoute` :79-81, `ACCOUNT_TTL_MS` :84-88, `ACCOUNT_ABORT_MS` :92-96, `WriteRoute` :100, `WRITE_BODY_LIMIT` :103, `WRITE_ABORT_MS` :106, `ACCOUNT_QUERY` :113-129, `READ_PATHS` :179, `WRITE_PATHS` :185, `postHandler` :451-459, `registerAccountProxy` :465-488, the module header)
- Test: `face/tests/account-proxy.test.ts`

**Interfaces:**
- Produces (the client's paths; every one under the existing rules):

  | Face path | Method | Account | Query names (≤ 240 chars) or body limit | TTL / abort |
  |---|---|---|---|---|
  | `/data/account/asset` | GET | `/api/account/asset` | `key`, `interval`, `range` | 5 s / 25 s |
  | `/data/account/book` | GET | `/api/account/book` | `venue`, `symbol`, `depth` | 2 s / 7 s |
  | `/data/account/trades` | GET | `/api/account/trades` | `venue`, `symbol`, `limit` | 2 s / 7 s |
  | `/data/account/funding` | GET | `/api/account/funding` | `venue`, `limit` | 60 s / 12 s |
  | `/data/account/receive` | GET | `/api/account/receive` | `venue`, `asset`, `network` | 60 s / 30 s |
  | `/data/account/earn` | GET | `/api/account/earn` | `venue`, `asset`, `fresh` | 15 s / 30 s |
  | `/data/account/sellable` | GET | `/api/account/sellable` | `fresh` | 5 s / 30 s |
  | `/data/account/signin/status` | GET | `/api/account/signin/status` | `state` | 1 s / 7 s |
  | `/data/account/wallet/challenge` | POST | `/api/account/wallet/challenge` | 1 024 B | — / 7 s |
  | `/data/account/wallet/prove` | POST | `/api/account/wallet/prove` | 2 048 B | — / 12 s |
  | `/data/account/signin/start` | POST | `/api/account/signin/start` | 512 B | — / 30 s |
  | `/data/account/bridge-routes` | POST | `/api/account/bridge-routes` | 4 096 B | — / 30 s |
  | `/data/account/live/order-sent` | POST | `/api/account/live/order-sent` | 512 B | — / 30 s |
  | `/data/account/live/order-requote` | POST | `/api/account/live/order-requote` | 512 B | — / 30 s |
  | `/data/account/live/sent` | POST | `/api/account/live/sent` | 512 B | — / 30 s |
  | `/data/account/revoke` | POST | `/api/revoke` | 512 B | — / 7 s |
  | `/data/account/guard` | POST | `/api/mode`, body always `{"mode":"guard"}` | 256 B (read, discarded) | — / 7 s |

  `ReadRoute` gains `"asset" | "book" | "trades" | "funding" | "receive" | "earn" | "sellable" | "signinStatus"` (`READ_PATHS.signinStatus = "/signin/status"`); `WriteRoute` gains `"challenge" | "prove" | "signinStart" | "bridgeRoutes" | "orderSent" | "orderRequote" | "sent" | "revoke" | "guard"`, with `WRITE_PATHS` becoming `Record<WriteRoute, { face: string; account: string }>` (the face's sub-path under `/data/account/`, the Account's path); `WRITE_BODY_LIMIT` and `WRITE_ABORT_MS` gain the rows above.
  - `export const FACE_ORIGIN_HEADER = "x-gravit-face-origin"` — set on the upstream request of `challenge` and `signinStart` only, its value `faceOriginOf(req)`.
  - `export function faceOriginOf(req: IncomingMessage): string | null` — `http://` plus the browser request's `Host` as WHATWG parses it (`new URL("http://" + host).host`), only when `isLoopbackHost(host)`; else null (then no header is sent).

- [ ] **Step 1: Write the failing tests** in `account-proxy.test.ts` (its existing fake `webServer`, `fetch` recorder and `req`/`res` doubles):
  - `the routes: thirty-seven exact paths` — the registered paths are exactly the twenty of today plus the seventeen above (Task 2 extends this test to thirty-eight with `/data/account/signin/callback`); none is a prefix route.
  - `the new reads keep their whitelists and TTLs` — for each new read: a query with its names passes rebuilt in order; an unknown name is 400 and nothing is fetched; `ACCOUNT_TTL_MS` and `ACCOUNT_ABORT_MS` equal the table; a second read inside the TTL fetches once; `sellable?fresh=1` asks again.
  - `the new writes forward their bodies as bytes` — each write's body arrives upstream byte-identical with `content-type: application/json` at its Account path; a body one byte over its limit is 413 and nothing is fetched; `text/plain` is 415; a query on it is 400.
  - `guard sends the fixed body whatever the browser posted` — a browser body `{"mode":"open"}` reaches the Account as exactly `{"mode":"guard"}` at `/api/mode`; a body of 257 bytes is 413 and nothing is fetched; the Account's status and body come back as they are.
  - `the face's origin rides challenge and signin/start only` — with the browser's `Host: localhost:3090`, the upstream of `challenge` and `signinStart` carries `x-gravit-face-origin: http://localhost:3090`; with `Host: 127.0.0.1:3090`, `http://127.0.0.1:3090`; no other route's upstream carries the header; `faceOriginOf` of a non-loopback Host is null (the fence has refused it already, the function still answers null).
  - `nothing of a new write's body is logged` — `console.log`/`console.error` spies see no byte of a posted `{"address":"0xabc…","signature":"0xdef…"}`.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --import tsx --test tests/account-proxy.test.ts` — FAIL: 404 on the new paths.
- [ ] **Step 3: Implement** the table rows, `faceOriginOf`, and `postHandler`'s two options — an `extraHeaders(req)` for the origin and a `fixedBody` for `guard` — registered in `registerAccountProxy`'s write loop. The module header's counts and lists say thirty-eight routes: twenty-three reads, the two stream routes, twelve writes and the callback; the `guard` exception and the origin header each get one line.
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): the proxy carries the Account's reads and writes for both halves - eight reads, nine writes, guard with a fixed body`.

---

### Task 2: The OAuth callback through the face, on the browser's origin

**Files:**
- Modify: `face/src/http.ts` (after `isTrustedDataRequest` :111-122), `face/src/account-proxy.ts` (`registerAccountProxy`)
- Modify: `account/src/portfolio/server.ts` (`wallet/challenge` :637-643, `signin/start` :654-662, `signin/callback` :668-675's refusal, `signedInPage` :346-349), `account/src/portfolio/live/proof.ts:50` (the sentence)
- Test: `face/tests/http.test.ts`, `face/tests/account-proxy.test.ts`, `account/test/unit/face-origin.test.ts` (new)

**Interfaces:**
- Produces:
  - `export function isTrustedNavigation(req: IncomingMessage): boolean` in `http.ts` — `isLoopbackHost(req.headers.host)` AND method `GET` AND `sec-fetch-mode === "navigate"` AND `sec-fetch-dest === "document"` AND no `Origin` header (a top-level GET navigation sends none); any `sec-fetch-site` is allowed (the venue's page sends `cross-site`). Used by the callback route alone; `isTrustedDataRequest` is unchanged.
  - `GET /data/account/signin/callback` — `isTrustedNavigation`, else `403 FORBIDDEN`; the query rebuilt from `state` (240), `code` (2 000), `error` (240), `error_description` (1 000), `iss` (500), each at most once, else `400`; forwarded to `GET /api/account/signin/callback?<rebuilt>` (abort 30 s, never kept, never stale); the Account's status and body answered with `content-type: text/html; charset=utf-8`, `cache-control: no-store`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`; a failed fetch is `503` with a fixed one-line HTML page `The Account did not answer. Go back to Gravit and start the sign-in again.`; a disabled row is 503 the same way.
  - In `server.ts`: `export function faceOriginOf(req: express.Request): string | undefined` — the `x-gravit-face-origin` header when it matches `/^http:\/\/(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]):\d{1,5}$/` and is given once, else `undefined`. `signin/start`'s redirect is `${faceOrigin}/data/account/signin/callback` when there is one, else today's `${req.protocol}://${host}/api/account/signin/callback`; `wallet/challenge`'s page is `{ domain: new URL(faceOrigin).host, uri: faceOrigin + "/" }` when there is one, else today's.
  - Words: `signedInPage`'s success line `Go back to Gravit: it carries on from here. This tab can be closed.`; the callback's refusal `this sign-in is not one this server started, or it ran out: start it again from Gravit, under Account › Venues`; the wallet sentence `Show this wallet's balances on my account. Read-only: this is not a transaction and it lets nothing be moved.`

- [ ] **Step 1: Write the failing tests.**
  - `http.test.ts` `isTrustedNavigation: only a GET top-level document on a loopback Host` — true for `GET` + `navigate` + `document` + `Host: 127.0.0.1:3090` with `sec-fetch-site` `cross-site`, `none` or absent; false with `Host: evil.example:3090`, with an `Origin`, with `sec-fetch-mode: cors`, with `sec-fetch-dest: empty`, for `POST`.
  - `account-proxy.test.ts` `the callback forwards a venue's navigation and answers the Account's page` — a cross-site navigation with `?state=s1&code=c1&iss=https%3A%2F%2Fexample` reaches `/api/account/signin/callback?state=s1&code=c1&iss=…` once; the answer's body is the Account's bytes with the four headers; a `fetch()`-shaped request (`sec-fetch-mode: cors`) is 403 and nothing is fetched; `?foo=1`, a repeated `state`, a `code` of 2 001 characters: 400; the upstream refused: 503 with the fixed page; extend `the routes` to thirty-eight with the callback.
  - `account/test/unit/face-origin.test.ts` (the `startPortfolioServer` + stand-in-service style of `test/unit/akshare-routes.test.ts`, the sign-in's OAuth endpoints injected as that test injects its fixtures): `signin/start` with `x-gravit-face-origin: http://127.0.0.1:3090` registers and sends `redirect_uri=http://127.0.0.1:3090/data/account/signin/callback`; without the header, today's `http://127.0.0.1:<port>/api/account/signin/callback`; with `http://evil.example:3090`, `https://127.0.0.1:3090` or the header given twice, today's; `wallet/challenge` with the header returns a message whose SIWE domain is `127.0.0.1:3090` and URI `http://127.0.0.1:3090/`, and the new sentence; the callback's success page carries `Go back to Gravit`, never `account page`.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --import tsx --test tests/http.test.ts tests/account-proxy.test.ts`; `cd account && npx vitest run test/unit/face-origin.test.ts` — FAIL.
- [ ] **Step 3: Implement** both halves. The Account's Host fence (`server.ts:479-492`) is unchanged: its `navigable` exception for the callback stays (an Account reached directly still works) and the proxied request reaches it as a plain local request. A comment at `faceOriginOf` says why a loopback-only origin is safe to take from a local caller (it can only send the code back to this machine).
- [ ] **Step 4: Run them and see them pass**; `cd account && npm test && npm run typecheck`; `cd face && npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat: the OAuth callback comes back through the face, and the Account builds it and the wallet sentence on the browser's origin`.

---

### Task 3: Close, Change and Leverage — the Market half's sheets

**Files:**
- Create: `face/client/js/host/sheet-market.js`
- Modify: `face/client/js/host/sheet-view.js` (`SHEET_KINDS` :22, `GO` :25-29, `titleOf` :38-58, `fieldsOf` :114-170, `draftOf` :188-271), `face/client/js/host/account-view.js` (`positionsOf` :128-134, `openOrdersOf` :141-154, `venuesOf` :216-233), `face/client/js/host/trade-view.js` (`tradeDraftOf`'s cents rule :258-266 becomes `eventPriceOf`), `face/client/js/render/trade.js` (`underWay` :97-107), `face/client/js/render/markets.js` (`accountPage` :202-261), `face/client/js/render/account.js` (the Portfolio's positions), `face/client/js/app.js` (`openSheetFrom` :665-679)
- Test: `face/tests/client/sheet-market.test.js` (new), `account-view.test.js`, `trade-view.test.js`, `app-dom.test.js`

**Interfaces:**
- Consumes: the sheet engine and renderer unchanged (`renderSheet` draws `quote.words` and What you sign for any kind).
- Produces:
  - `account-view.js`: `positionsOf` rows gain `kind: str(p.kind)`, `leverage: number(p.leverage)`; `openOrdersOf` rows gain `kind: str(o.kind)`, `stopPrice: number(o.stopPrice)`, `base: str(o.base)`; `venuesOf` rows gain `tradeCan: { amend, leverage, close }` (each `v.trade?.<flag> === true`); `export function writesOn(page): boolean` (`pageOk(page) && page.connectLive.writes?.on === true`).
  - `trade-view.js`: `export function eventPriceOf(typed: string): string | null` — cents typed → dollars to six places, trailing zeros trimmed; null outside `0 < c < 100` (the rule `tradeDraftOf` applies today, now called from both).
  - `sheet-market.js`: `export const MARKET_KINDS = ['close', 'amend', 'leverage']`; `marketTitleOf(kind, seed)`, `marketGoOf(kind, seed)`, `marketFieldsOf(kind, seed)`, `marketDraftOf(kind, fields, seed)` (no clock: each deadline is the Account's).
    - `close` — seed `{ venue, symbol, name, side, qty, kind }`; title `Close <name>`, or `Sell <name>` for a stock or an event; go `Sign and close` / `Sign and sell`; field `qty` (`How much`, placeholder `All <qty>`); draft `{ type: 'liveClose', venue, symbol, qty }` with `qty` as typed or `''` (all of it); a typed qty that is not a decimal above zero → `Type how much, or leave it empty for all of it`.
    - `amend` — seed `{ venue, order, type, kind, qty, limitPrice, stopPrice, side, base }`; title `Change <order>`; go `Sign and change`; fields `qty` (`Size`, placeholder the order's), `limitPrice` for `limit`/`stop_limit` (`Limit, in cents` for an event, else `Limit price`), `stopPrice` for `stop`/`stop_limit` (`Stop, in cents` / `Stop price`), each blank to keep; draft `{ type: 'liveAmend', venue, order, qty, limitPrice, stopPrice }` (an event's prices through `eventPriceOf`); all three blank → `Type what changes`; an event price out of range → `A price in cents is between 0 and 100`.
    - `leverage` — seed `{ venue, venueName, symbol, name, leverage }`; title `Leverage · <name>`; go `Sign leverage`; fields `leverage` (`Leverage`, placeholder the current, else `1`), `marginMode` (`Margin`, select `''` `Keep it`, `cross` `Cross`, `isolated` `Isolated`); draft `{ type: 'liveLeverage', venue, symbol, leverage, marginMode }`; a leverage that is not `/^\d{1,3}$/` and ≥ 1 → `Leverage is a whole number, 1 or more`.
  - Keys (`data-action="openSheet"`, `data-kind`, the seed's fields as `data-*`), drawn only when `state.owner.role === 'signs'` and `writesOn(page)`:
    - Trade's Under way and a market page's Open orders: `Change…` on a row whose venue's `tradeCan.amend` and whose `type` is `limit`, `stop` or `stop_limit`.
    - The Portfolio's Positions and a market page's You hold: `Close…` (`Sell…` for a stock or an event) on every position row; `Leverage…` on a `perp` position whose venue's `tradeCan.leverage`.
    - A perpetual's market page (item `kind === 'perp'`): `Leverage…` in its keys for its first connected line whose venue's `tradeCan.leverage`.
  - `app.js` `openSheetFrom` gains the three cases, each seed read from the key's `data-*` (numbers as the strings they are drawn as).

- [ ] **Step 1: Write the failing tests.**
  - `sheet-market.test.js`: `close drafts the Account's liveClose` (blank qty → `qty: ''`; `0.5` → `'0.5'`; `abc` → the words); `close is Sell for a stock and an event`; `amend keeps what is blank and converts an event's cents` (`{ limitPrice: '62' }` on an event → `limitPrice: '0.62'`, `qty: ''`, `stopPrice: ''`; all blank → `Type what changes`; `100` → the cents words); `amend draws only the fields its type has` (`market` none but `qty`, `stop_limit` all three); `leverage refuses a fraction and keeps the margin mode blank by default` (`2.5` → words; `5` → `{ leverage: '5', marginMode: '' }`).
  - `sheet-view` through `fieldsOf`/`draftOf`/`titleOf`/`goWord` for each kind: the same answers (the delegation).
  - `account-view.test.js`: `writesOn` false for a read-only page (`connectLive.writes: { on: false }`) and an unrecognised one; `venuesOf` carries `tradeCan`; `openOrdersOf` and `positionsOf` carry the new fields, absent ones `''`/null.
  - `trade-view.test.js`: `eventPriceOf` (`'62'` → `'0.62'`, `'0.5'` → `'0.005'`, `'100'` → null) and `tradeDraftOf`'s answers unchanged.
  - `app-dom.test.js` (the fake page with a signing owner and the stand-in-shaped page fixture): `Under way offers Change… on a resting limit at a venue that amends, and opens the amend sheet`; `the Portfolio's BTC perpetual offers Close… and Leverage…`; `a read-only page draws none of the three`; **Review Focus**: `an order the stream reports filled while its Change… sheet is open` — the prepare answers the Account's 409 refusal, the sheet draws its message and Prepare again, the go key stays off, and after the page read without the order the row and its key are gone.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --test tests/client/sheet-market.test.js tests/client/account-view.test.js tests/client/trade-view.test.js tests/client/app-dom.test.js` — FAIL.
- [ ] **Step 3: Implement** `sheet-market.js`, the delegation, the view fields, `eventPriceOf`, the keys and the three `openSheetFrom` cases. `afterAction`'s fresh reads (`app.js:245-252`) already re-read the page, holdings and statement after each taken action; the asset read of Task 4 is added to them there.
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): close, change and leverage on Trade, a market's page and the Portfolio - the Account's liveClose, liveAmend and liveLeverage signed in What you sign`.

---

### Task 4: A market's page — you here, its book, its latest trades, its funding

**Files:**
- Create: `face/client/js/host/market-depth-view.js`
- Modify: `face/client/js/host/markets.js` (the page's reads beside its candles, :190-252; the 5 s beat beside the quotes), `face/client/js/reducers/markets.js` and `data/empty.js` (the slices), `face/client/js/render/markets.js` (`accountPage` :202-261), `face/client/js/app.js` (`afterAction` :245-252 reads the page's asset again)
- Test: `face/tests/client/market-depth-view.test.js` (new), `host-markets.test.js`, `markets.test.js`

**Interfaces:**
- Consumes: Task 1's `asset`, `book`, `trades`, `funding` reads; `openOrdersOf`'s `who` words (`account-view.js:141-154`).
- Produces:
  - `markets.js`: on a market page for an Account key (not `cn:`), `asset?key=<id>` once on entering and after every taken owner action; `book?venue=&symbol=&depth=10` and `trades?venue=&symbol=&limit=20` for the page's followed line (`followOf(item)`) on entering and every `QUOTES_MS` (5 s) while the page is on screen; `funding?venue=<v>&limit=100` once on entering for a `perp` item, one per connected line's venue. Each a `fly` of its own kind, only the latest landing, nothing after leaving or `close()`. Store: `markets.depth[id] = { here, book, trades, funding }`, each `{ status, data, at, message }` (`depthLoading`, `depthLoaded`, `depthFailed` with `{ id, part }`); leaving the page drops `markets.depth[id]`.
  - `market-depth-view.js` (pure; a body it does not recognise is the part's empty shape):
    - `hereOf(assetBody, page)` → `{ positions, orders, cost, agents, missing }`: the sheet's positions (as `positionsOf` rows), its open orders with `who` (as `openOrdersOf` names them, the page's `keys` for agents' names), its `cost` rows `{ key, side, symbol, avgCostUsd, costUsd, coveredQty, ofQty }`, `agents` — its orders and statement lines whose author is not the owner (`authority !== 'owner'`; a line's `by` not `You`) — and `missingWords(missing)`.
    - `bookOf(body)` → `{ bids, asks, from, at, depth, public }` (each side `[{ price, size }]`, best first, sizes null when the source gives none); `tradesOf(body)` → `{ trades: [{ price, size, side, at }], none, public }` (`none` the Account's sentence when the source publishes no trades); `fundingOf(bodies, symbol)` → the lines of every funding read whose `symbol` is the page's, newest first, `{ at, venueName, side, qty, rate, usd, paper }`.
  - `render/markets.js` `accountPage`: **You here** replaces You hold's and Open orders' reads by the asset sheet (positions with their cost, open orders with who placed them and Task 3's keys), a line per agent action under `What agents do here`; **Order book** (ten levels a side, the source in its words, `Top of book only` when `depth === 'top'`); **Latest trades** (twenty, newest first, or the `none` sentence); **Funding** on a perpetual (what was paid and received, `None yet.` when empty). Each section's failed read: `Unavailable` with the Account's sentence when it gave one (`Order book unavailable`, `Trades unavailable`, `Funding unavailable`, `Account unavailable`); loading: `Loading…`; a kept answer re-served `stale: true` says `As of <time>`. An A share's page (`cnPage`) is unchanged and reads none of the four.

- [ ] **Step 1: Write the failing tests.**
  - `market-depth-view.test.js`: `hereOf names who placed each order and lists the agents' actions` (an owner order → `You`; an agent's at the page's key address → `Agent · Claude Code`; a statement line by `Claude Code, inside its limit` in `agents`); `hereOf of a refusal or an unknown body is empty`; `bookOf keeps best first and a null size`; `tradesOf carries the none sentence`; `fundingOf keeps the page's symbol only, newest first`.
  - `host-markets.test.js`: `a market page reads its asset, book, trades and, for a perpetual, funding; the book and trades every 5 s; nothing after leaving` (the fake timers); `a stock's page reads no funding`; `an A share's page reads none of the four`; `only the latest book read lands`.
  - `markets.test.js` (render): the four sections from fixtures; **Review Focus**: `an Account that answers the book with express's 404 page, and the trades with 503 unreachable` — the page draws its price, history and You here, `Order book unavailable` and `Trades unavailable`, and no parse error reaches the console.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --test tests/client/market-depth-view.test.js tests/client/host-markets.test.js tests/client/markets.test.js` — FAIL.
- [ ] **Step 3: Implement** the reads, the slices, the views and the sections, within the page's existing look (`section`, `feed`, `line`, `partBody` of `render/markets.js`).
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): a market's page reads the Account's asset sheet, book, latest trades and a perpetual's funding`.

---

### Task 5: Rules — Guard and Beast, the cap, the session, their leverage

**Files:**
- Create: `face/client/js/host/rules-view.js`, `face/client/js/host/sheet-rules.js`
- Modify: `face/client/js/host/sheet-view.js` (delegation, as Task 3), `face/client/js/host/account.js` (`startAccount` deps and `guard`), `face/client/js/reducers/account.js` and `data/empty.js` (`account.guard`), `face/client/js/render/account.js` (`TABS` :25, `renderAccountScreen` :325-333, a `rulesTab`), `face/client/js/router.js` (`TABS`), `face/client/js/app.js` (`startAccount`'s `post`; actions `setGuard`, and `openSheetFrom`'s four cases)
- Test: `face/tests/client/rules-view.test.js`, `sheet-rules.test.js` (new), `host-account.test.js`, `account.test.js`, `app-dom.test.js`

**Interfaces:**
- Consumes: Task 1's `/data/account/guard`; Task 3's `writesOn(page)`; the page's `mode`, `connectLive.writes` (`{ on, capUsd }`), `dial` (`{ sessionExpiresAt, sessionEnded, revoked, maxLeverage }`, `server.ts:587`), `modeRules` (`{ rows: [{ door, guard, beast }], cardMinutes }`), `venues[].trade.leverage`.
- Produces:
  - Tabs: `Portfolio · Venues · Agents · Cards · Rules` (`#/account/rules`); plan 4b inserts Money after Portfolio.
  - `rules-view.js` `rulesOf(page, now)` → `{ mode: 'guard' | 'open' | '', modeRows, cardMinutes, writes: boolean, cap: { usd } | null, session: { until, ended } | null, leverage: { max } | null, leverageOffered: boolean }`; `leverageOffered` when any venue's `trade.leverage === true`; an unrecognised page is all empty.
  - `sheet-rules.js`: `RULES_KINDS = ['beast', 'cap', 'session', 'leverageCap']` with `rulesTitleOf`, `rulesGoOf`, `rulesFieldsOf`, `rulesDraftOf`:
    - `beast` — title `Switch to Beast`, go `Sign Beast`, no field, draft `{ type: 'setPolicy', change: 'mode', value: 'open' }`.
    - `cap` — seed `{ capUsd }`; title `Each move at most`, go `Sign the cap`; field `cap` (`Dollars`, value the cap now); draft `{ type: 'setPolicy', change: 'cap', value }` after stripping `$`, `,` and spaces; not `/^\d{1,7}(\.\d{1,2})?$/` or not above zero → `A number of dollars, more than zero, to the cent`; equal to now → `That is the cap now`.
    - `session` — seed `{ ended }`; title `Agents' session`, go `Renew for 30 days` (`Start a new one` when ended); no field; draft `{ type: 'setPolicy', change: 'session', value: '30d' }`.
    - `leverageCap` — seed `{ max }`; title `Their leverage`, go `Sign leverage`; field `max` (seg over `[1, 2, 3, 5, 10, 20, max]`, sorted, once each, labelled `<n>x`); draft `{ type: 'setPolicy', change: 'maxLeverage', value: String(n) }`; equal to now → `That is their leverage now`.
  - `account.js` `startAccount({ …, post })` gains `guard(): Promise<void>` — one POST to `/data/account/guard` with `{}` in the air at a time (a second call while it is in the air returns the same promise); dispatches `guardAsking`, then `guardSaid` with `Guard: what agents ask for waits for you on a card.` or `guardRefused` with the Account's words (`refusal.message`, else `error`, else `The account did not answer. Try again.`); then `load({ fresh: true })`.
  - The Rules tab, in the Account screen's look: **Mode** — the seg `Guard | Beast` (the mode in force pressed), the line `Guard: what agents ask for waits for you on a card. Beast: inside the limits you signed, it goes at once. Guard is one click; Beast is signed.`, and under it, always, `Beast removes the Account's card only: Gravit's orders still raise their Gate 2 card in this face first.`; the door-by-door table from `modeRules` (`An agent, inside its limit` · `Guard` · `Beast`, the mode in force marked `Now`) and `A card nobody answers in <n> minutes expires.`; pressing Guard calls `account.guard()` on any page that reads the Account; pressing Beast opens the `beast` sheet only on a page that signs (else nothing, and the seg says `Only a browser that signs switches to Beast.`). **Each move at most** — `$<cap> an order or a move`, `Change…` (the `cap` sheet). **Agents' session** — `Agents may act until <date>.` or `Ended: agents can do nothing until you start a new one.`, `Renew for 30 days` / `Start a new one` (the `session` sheet). **Their leverage** (only when `leverageOffered`) — `Up to <n>x on a perpetual, at a venue that sets leverage from here.`, `Change…` (the `leverageCap` sheet). On a read-only Account the three rows say `Read-only: the Account was started without trading, so there is no cap to set.`, `… so there is no session to open.`, `… so there is no leverage to set.`, with no key. The signed keys are drawn only on a page that signs.

- [ ] **Step 1: Write the failing tests.**
  - `rules-view.test.js`: `rulesOf reads the mode, the writes, the cap, the session and leverage` (stand-in-shaped page); `a read-only page has no cap, session or leverage`; `leverage is offered only where a venue sets it`.
  - `sheet-rules.test.js`: each kind's draft and words (`$1,250.50` → `'1250.50'`; `0` and `1.234` → the dollars words; now's cap → `That is the cap now`; `leverageCap`'s options sorted and unique with now among them).
  - `host-account.test.js`: `guard posts once while one is in the air, says the Account's words, and reads the page fresh` (a held `post`: two calls, one POST; then `guardSaid`, a `load({ fresh: true })`); `a refused guard says the refusal and leaves the mode drawn as the page has it`.
  - `account.test.js` (render): the Rules tab on a writes-on page that signs (every row and key, the Gate 2 sentence); on a read-only page (the three Read-only sentences, no key); on a page that does not sign (the Guard seg live, no Beast sheet key, no Change…).
  - `app-dom.test.js` **Review Focus**: `Guard pressed twice in a row on a page that does not sign` — one POST to `/data/account/guard`, the said line once; Beast pressed on that page opens no sheet.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --test tests/client/rules-view.test.js tests/client/sheet-rules.test.js tests/client/host-account.test.js tests/client/account.test.js tests/client/app-dom.test.js` — FAIL.
- [ ] **Step 3: Implement** the views, the kinds, `guard`, the reducers, the tab and its route. The Account head's chips (`headOf`) stay; the Venues tab's seat box keeps its mode line.
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): a Rules tab - Guard in one unsigned click, Beast, the cap, the session and their leverage signed`.

---

### Task 6: One real boot — the Market half and Rules against the stand-in

**Files:**
- Create: `face/tests/account-market-smoke.test.ts`
- Modify: `face/tests/helpers/owner-node.ts` only if it lacks a plain `post(path, body)` for the unsigned writes

**Interfaces:**
- Consumes: Tasks 1–5; `startStandin`/`stopStandin`/`standinSkip` (`face/tests/helpers/standin.ts`), `startOwnerNode` (`helpers/owner-node.ts`), the boot pattern of `face/tests/account-graft-smoke.test.ts:1-60` (its own file: one boot per process; `bootFace` in a `mkdtemp` home, the seat row disabled, the proxy registered on the booted web server with the stand-in's URL, every call to the face's port).

- [ ] **Step 1: Write the smoke** `account market smoke: through the face's port, the owner closes, changes and sets leverage, reads a market's depth, and rules the agents` (skipped unless `FACE_SMOKE=1` and `account/` is installed):
  1. Pair the owner node with the stand-in's printed code.
  2. Reads: `asset?key=` for the stand-in's ETH perpetual's key (read from `explore?tab=perps`) answers `ok: true` with `positions`; `book` and `trades` for its followed line answer `ok: true`; `funding?venue=<stand-in exchange>` answers `ok: true` with `lines`.
  3. Change: the resting SOL limit buy the stand-in seeds — prepare `liveAmend` with a new `limitPrice` through `/data/account/prepare`, sign, the page's order shows the new price.
  4. Leverage: prepare and sign `liveLeverage` `3` on the ETH perpetual; the position's leverage reads 3.
  5. Close: prepare `liveClose` of half the ETH perpetual's long; sign; the position's qty is halved.
  6. Rules: `POST /data/account/guard` with `{"mode":"open"}` as the body — the page reads `mode: "guard"` (the fixed body went); sign `setPolicy cap 300`, the page's `connectLive.writes.capUsd` is 300; sign `setPolicy session 30d`, `dial.sessionEnded` false; sign `setPolicy maxLeverage 3`, `dial.maxLeverage` 3; sign `setPolicy mode open`, `mode: "open"`; Guard again, `mode: "guard"`.
  7. Fences: a `/data/account/guard` POST with `Origin: https://evil.example` is 403; `GET /data/account/signin/callback` with `sec-fetch-mode: cors` is 403.
  8. Nothing of a signature or the pairing code is in what the face's process wrote (the capture of `account-graft-smoke`).
- [ ] **Step 2: Run it.** `cd face && FACE_SMOKE=1 node --import tsx --test tests/account-market-smoke.test.ts` — PASS (a step that fails is a bug in Tasks 1–5, fixed there with its own test first).
- [ ] **Step 3: Run the suites.** `cd face && npm test && npm run typecheck && FACE_SMOKE=1 npm test`; `cd account && npm test && npm run typecheck` — green (the account suite but its known red).
- [ ] **Step 4: Commit.** Message: `test(face): a smoke drives the Market half and Rules through the face's port against the stand-in`.

---

## Owed after the build (the operator's, or mine on the operator's go-ahead)

Restart the face on 3090 from this tree (the host Account too, for Task 2's header) and hard-reload; on the Account screen's Rules tab, Guard ⇄ Beast on the operator's writes-on Account with a paper venue, and Rules on a `--read-only` one (spec §8). The OAuth callback through the face is drilled only on a stand-in or with Robinhood's sign-in left unused (the paper-venues rule; plan 5 records it).

## Self-review notes (run 2026-11-01)

- Spec coverage, this plan's share of §5.1: close/amend/leverage on Trade's Under way, a market's page and the Portfolio (Task 3); "you here" from the asset sheet (Task 4); book and latest trades (Task 4); a perpetual's funding (Task 4); Guard/Beast, the cap, the session, leverage (Task 5). §5.5: the asset sheet, book and trades, funding, receive, earn and sellable, the wallet challenge and proof, the bridge routes and the order-sent reports, `mode` limited to guard, `revoke`, the OAuth start and callback, each exact with TTLs and aborts (Tasks 1, 2); the callback's origin designed and the fence's one exception (Task 2). §5.8 here: the callback page's and the wallet sentence's words (Task 2); the face's own Account-page sentences are plan 4b's Task 7. Plan 4b covers Money, Venues' connectors and Close to agents, Agents, Cards, Sell many and Settings › Devices.
- Calls made where the spec left them: the face's guard route is its own path, `/data/account/guard`, with a fixed upstream body — "mode limited to guard" is enforced by never forwarding the browser's body; the origin travels as `x-gravit-face-origin`, set by the proxy from the browser's own loopback Host (works on the host loop, under compose and for `localhost` versus `127.0.0.1` alike), taken by the Account only when it is a loopback `http` origin — an environment variable would be wrong whenever the browser uses the other loopback name; the wallet sentence's SIWE domain follows the same origin, since a wallet compares it with the page asking; `signin/status` is proxied (the sign-in's poll needs it) though §5.5 does not name it; Guard is pressable on a page that does not sign (the Account takes it from any local caller; on the face it is the brake); the book and trades are polled every 5 s with the quotes rather than followed on the stream; the asset sheet's own candles are not drawn (the page's chart keeps its own read).
- Types: `faceOriginOf` (face and Account, same name, each in its own module), `FACE_ORIGIN_HEADER`, `isTrustedNavigation`, `writesOn`, `eventPriceOf`, `tradeCan`, `MARKET_KINDS`, `RULES_KINDS`, `rulesOf`, `hereOf`, `bookOf`, `tradesOf`, `fundingOf`, `guard` are spelled the same in every task and in plan 4b.
