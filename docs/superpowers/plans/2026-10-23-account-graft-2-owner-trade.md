# The Account grafted into the face — stage 2: the owner device and Trade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The face's page becomes an owner device of Linqi's Account — a non-extractable P-256 key in the browser, paired at the Account's door, signing the Account's own envelope — and the owner's hand acts return to the face: the Trade ticket, Cancel, Connect an account / Open a paper account / Disconnect, the Agents' Let in / Give a limit / End limit / Revoke, the Cards' Approve / Reject, the Asks' Decline, a star that signs `setWatch`, and Settings › Devices (Let it sign, Sign out).

**Architecture:** The proxy (`face/src/account-proxy.ts`, stage 1) gains the Account's stage-2 rows — four reads (`venues`, `connect/reach`, `keyfile`, `paper/books`) and three POSTs (`pair`, `prepare`, `exchange`) whose bodies pass as bytes, never kept, never logged. In the browser one engine does every owner action: `host/owner.js` is the device (the key in IndexedDB, the standing read off every `/data/account` page, pair · prepare · sign · exchange · sign-out), `host/sheet.js` is the prepare → *What you sign* → sign cycle for one open sheet (the Account's `quoteDialog` as a face drawer: a form, its draft, the quote, the verbatim fields, the ten-minute countdown, the re-prepare rules), and every key on a screen opens a sheet of a kind whose fields and draft are pure (`host/sheet-view.js`). Trade is the biggest sheet: `host/trade-view.js` builds the `liveOrder` draft from the ticket, `host/trade.js` reads the picker and follows the market, `render/trade.js` (gravit-ui's at `feat/gravit-ui @ 2418df7`, re-fed) draws it. The face process holds no key and signs nothing.

**Tech Stack:** Node 22 + TypeScript on the server (`tsx --test`); vanilla ES modules in the browser (WebCrypto `crypto.subtle`, IndexedDB), the client tests over the fake DOM with Node's `crypto.subtle` and `crypto.verify` as the door's verifier; the Account's stand-in (`FACE_ACCOUNT_SEAT_DIR`, `test/standin/ui-standin.ts`) for the fixtures and the smoke.

**Spec:** `docs/superpowers/specs/2026-10-22-account-graft-design.md` — §5.1 (the stage-2 rows of the route table), §6.2 (the keys stage 2 adds), §6.3 (the owner's device), §6.4 (Trade and the other owner keys), §6.5, §7, §8 (the charter amendments, items 1–6 and 9 — item 8 is stage 3's), §10 (the device tests, the smoke's owner half, the manual drill), §11. The Account's owner path, byte for byte: `docs/research/2026-10-22-account-owner-path-map.md` (§1 the key and pairing, §2 the envelope, §3 the actions, §4 the cards, §6 the risks). Stage 1 landed on main @ d227316; this branch (`feat/account-graft-2`) is cut from it.

## Global Constraints

- The product speaks English; screens carry no explanatory small print — one muted status line where the spec allows it (the device line in the Account head is one); the Account's refusal sentences are drawn as its words, verbatim.
- Vanilla ES modules, no bundler, no framework; `tsx --test tests/*.test.ts tests/client/*.test.js`; `face/tests/fixtures/events.jsonl` untouched; the stage-1 fixtures untouched (new ones added beside them).
- Every proxied route: the fence first (`isTrustedDataRequest`, 403 `{"ok":false,"error":"forbidden"}`), then 405, then the whitelisted query or the body; nothing of the raw query reaches the Account; `fresh` never forwarded.
- The POST rows (the `stream/markets` rules, generalised): a body declared `application/json` (else 415), no query (else 400), at most the row's bytes (else 413) — `pair` 4 096, `prepare` 16 384, `exchange` 65 536 — forwarded as posted with `content-type: application/json`, never parsed, kept, logged or echoed; the Account's status and body pass through as they are; a fetch failure is `503 {"ok":false,"unreachable":"<CODE>"}`; nothing served stale for a write. Aborts: `pair` 7 000 ms, `prepare` 30 000, `exchange` 30 000 (a placement asks a venue).
- The stage-2 reads: `venues` 60 000 · 30 000 ms, no query name (never `force`); `connect/reach` (`connector`) 5 000 · 30 000; `keyfile` (`kind`, `venue`, `ref`, `exchange`) 5 000 · 30 000; `paper/books` (no names) 5 000 · 30 000; each cached like the stage-1 reads, 64 keys.
- The face process holds no key, signs nothing, makes no envelope, mints no cookie; the key is the browser's: `crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])`, kept in IndexedDB database `gravit-face-owner`, version 1, store `keys`, record `device`; the pair label is `Gravit face`; the sign-out flag is `localStorage["gravit.owner.signedOut.v1"] === "1"`.
- The envelope is the Account's, byte for byte (the map §2.1): `message = { accountChain, ...shown[].name → value }`, `input = canonical({ domain, primaryType, message })` with keys sorted recursively, `undefined` dropped, no whitespace; ECDSA P-256 / SHA-256 over the UTF-8 bytes, raw `r‖s`, base64url without padding; the body `{ action: prepared.action, nonce: prepared.action.nonce, signature: { kid, es256 } }`; the nonce is prepare's, never the browser's; `threshold` is never raised.
- Every money or standing action is prepare → *What you sign* (every `shown[]` field verbatim, `name: value`, the nonce among them) → sign; a form changed since the preparation re-prepares instead of signing; a `deadline` is drawn as `Your signature is good for m:ss more.` and re-prepared at zero and when under 30 s on submit; a refusal at prepare is drawn and nothing is signed; `kind: "result"` with `result.ok === false` is a refusal on a 200.
- One click (prepare → sign, no sheet) only for `setWatch` and `liveCancel` — neither a money type, neither quoted — as the Account's own page does (*call*).
- Keys that sign are drawn only while this page signs (`owner.role === 'signs'`); otherwise the device line says why and the keys are absent, not disabled (*call*).
- The seat's paper-only rule stands: `allow` in Give a limit is a pick list of the Account's venues, paper first, `*` never offered; perps, pre-IPO, leverage, stops, time in force, amend are not drawn (`""` in the draft).
- No third-party image URL rendered; every Account string drawn passes through `esc`; no `NaN`/`undefined`/raw JSON on a screen.
- `GRAVIT.md` stays ≤ 4 500 bytes (`face/tests/gravit-md.test.ts`; it is 4 496 today — the one line this stage adds pays for itself by a trim elsewhere in the file).
- Commit messages are written to a file and committed with `git commit -F` (no backticks, `$()` or parentheses on a `-m` line); one logical change per commit; the committed ledger `docs/superpowers/plans/2026-10-22-account-graft-ledger.md` gains a stage-2 section with a line per task.

## Review Focus

1. **A preparation that aged** — the page held an order sheet open past ten minutes, or presses Sign with 20 s left: nothing stale is signed; the sheet prepares again (at zero on its own; on submit when under 30 s, then signs the fresh one). Pinned in Task 5 (`host-sheet.test.js`: "at zero the sheet prepares again", "a submit under thirty seconds prepares again before signing").
2. **`E_ACCOUNT_BAD_SIGNATURE` on a page that thinks it signs** (the Account restarted and lost the pending list, or an owner dropped this device): the standing is read again, the line says so, and no key is drawn until it signs again. Pinned in Task 3 (`host-owner.test.js`: "a bad-signature answer re-reads the standing").
3. **A rejected card on a 200** (`kind: "result"`, `result.ok === false`): drawn as the Account's refusal, never as success. Pinned in Task 4 (`owner-view.test.js`: "a result that is a refusal is refused on a 200").
4. **A form changed after the preparation** (the amount retyped, the venue switched): the sign key goes off at once and a press re-prepares instead of signing what was shown. Pinned in Task 5 (`host-sheet.test.js`: "a changed form is prepared again, not signed").
5. **The bytes are built from `shown`, not from `action`** — a stringifier that keeps insertion order, emits `null`, or pads base64 is `E_ACCOUNT_BAD_SIGNATURE`; the fake door verifies exactly as the Account's `es256Verify` does. Pinned in Task 2 (`owner-key.test.js`: "the canonical bytes equal the map's SetWatch input character for character", "a signature verifies under ieee-p1363") and Task 3 (the fake door).

---

## File structure

| File | Responsibility |
|---|---|
| `face/src/account-proxy.ts` (modify) | the stage-2 rows: `ReadRoute` + `venues`, `reach`, `keyfile`, `books`; a `WriteRoute` (`pair`, `prepare`, `exchange`) with body limits and aborts, the `stream/markets` POST rules generalised |
| `face/scripts/capture-account-fixtures.ts` (modify) · `face/tests/fixtures/account/{venues,paper-books,keyfile,prepared-order,prepared-watch,prepared-card}.json` (new) | the stand-in's answers for the new reads and three `prepare` answers (prepare is unsigned) |
| `face/client/js/wire/owner-key.js` (new) | pure over an injected `subtle`: `canonical`, `b64u`, `kidOf`, `signingInput`, `signPrepared`, `publicJwkOf` |
| `face/client/js/wire/key-store.js` (new) | the key's home: `indexedDbKeys(indexedDB)`, `memoryKeys()`, `signedOutFlag(storage)` |
| `face/client/js/host/owner.js` (new) | the device: standing, pair, prepare, sign, exchange, sign-out, sign-in, let a device in |
| `face/client/js/host/owner-view.js` (new) | pure: the standing's words, the Devices rows, *What you sign* lines, the countdown words, `refusedAt`, `whyOf`, `refusalOf` |
| `face/client/js/host/sheet-view.js` (new) | pure: every sheet kind's fields, its draft from the fields, what is still missing |
| `face/client/js/host/sheet.js` (new) | impure: the one open sheet's prepare → sign cycle |
| `face/client/js/reducers/owner.js` (new) | the `owner` and `sheet` slices |
| `face/client/js/render/owner.js` (new) | the device line and the pair box, Settings › Devices, the sheet drawer |
| `face/client/js/host/trade-view.js` (new) · `reducers/trade.js` (new) · `host/trade.js` (new) · `render/trade.js` (new) | Trade: the picker, the ticket's legs and draft, the quote's words, Under way; its reads and follow; its screen |
| `face/client/js/render/account.js` · `render/markets.js` · `host/market-view.js` · `host/markets.js` · `host/account.js` · `render/rail.js` · `router.js` · `data/empty.js` · `app.js` · `css/app.css` (modify) | the keys on the screens, the star that signs, the Connect reads, the rail's Trade item, `#/trade`, the slices, the wiring, the ticket's and the sheet's styles |
| `face/tests/client/{owner-key,key-store,host-owner,owner-view,sheet-view,host-sheet,owner,trade-view,host-trade,trade}.test.js` (new); `account.test.js`, `markets.test.js`, `market-view.test.js`, `host-markets.test.js`, `host-account.test.js`, `rail.test.js`, `reducers.test.js`, `app-dom.test.js` (modify); `face/tests/account-proxy.test.ts`, `account-graft-smoke.test.ts` (modify) | the tests and the smoke's owner half |
| `Gravit-Design.md`, `GRAVIT.md`, `face/README.md`, `DEVELOPMENT.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-20-account-seat-design.md`, `docs/superpowers/plans/2026-10-22-account-graft-ledger.md` (modify) | the documents |

---

### Task 1: The proxy's stage-2 rows and the fixtures

**Files:**
- Modify: `face/src/account-proxy.ts` (the route tables, the registrar), `face/scripts/capture-account-fixtures.ts`
- Create: `face/tests/fixtures/account/venues.json`, `paper-books.json`, `keyfile.json`, `prepared-order.json`, `prepared-watch.json`, `prepared-card.json`
- Test: `face/tests/account-proxy.test.ts`, `face/tests/account-fixtures.test.ts`

**Interfaces:**
- Consumes: stage 1's `registerAccountProxy(webServer, deps) → { reader, dispose }`, `ACCOUNT_QUERY`, `ACCOUNT_TTL_MS`, `ACCOUNT_ABORT_MS`, `rebuildQuery`, `readBody`, `isJsonBody`, `STREAM_BODY_LIMIT`.
- Produces: `ReadRoute` gains `"venues" | "reach" | "keyfile" | "books"` (face paths `/data/account/venues`, `/data/account/connect/reach`, `/data/account/keyfile`, `/data/account/paper/books`; Account paths `/api/account/venues`, `/api/account/connect/reach`, `/api/account/keyfile`, `/api/account/paper/books`); `ACCOUNT_QUERY` rows `venues: []`, `reach: ["connector"]`, `keyfile: ["kind", "venue", "ref", "exchange"]`, `books: []`; `ACCOUNT_TTL_MS`/`ACCOUNT_ABORT_MS` per the Global Constraints. `export type WriteRoute = "pair" | "prepare" | "exchange"`; `export const WRITE_BODY_LIMIT: Readonly<Record<WriteRoute, number>> = { pair: 4_096, prepare: 16_384, exchange: 65_536 }`; `export const WRITE_ABORT_MS: Readonly<Record<WriteRoute, number>> = { pair: 7_000, prepare: 30_000, exchange: 30_000 }`; face paths `/data/account/pair`, `/data/account/prepare`, `/data/account/exchange` → Account `/api/account/pair`, `/api/account/prepare`, `/api/exchange`. A write answers the Account's status and body as they are, never stale, never kept; a disabled row answers `disabled` once the body is read.

- [ ] **Step 1: Write the failing tests** in `account-proxy.test.ts`: `"the four stage-2 reads are registered with their names and never force"` (`venues?force=1` → 400, nothing forwarded; `reach?connector=live:kalshi` forwarded as the only name); `"a write forwards its body as bytes with the Account's status"` (a 409 `{ok:false,refusal:{…}}` body comes back as 409 with the same bytes; the upstream saw `content-type: application/json` and no `Origin`); `"a write past its limit is 413, a non-JSON one 415, a query on it 400"` (`pair` at 4 097 bytes, `prepare` at 16 385, `exchange` at 65 537); `"a write never serves stale and never caches"` (two identical `exchange` POSTs reach the Account twice); `"an unreachable Account on a write is 503 with the code"`; `"a write's abort is the row's"`.
- [ ] **Step 2: Run** `cd face && npx tsx --test tests/account-proxy.test.ts` — Expected: FAIL (the routes are not registered: 404 from the fake web server).
- [ ] **Step 3: Implement** the rows in `account-proxy.ts`: extend the read tables; add the write table and a `registerWrite(route)` beside the `stream/markets` handler (share its body-reading rules — extract `readJsonPost(req, res, limit)` from it), the per-write abort, the pass-through; keep the module's header true (count the rows).
- [ ] **Step 4: Run** the proxy tests — Expected: PASS; `npm run typecheck` clean.
- [ ] **Step 5: Extend the capture script** to read `venues`, `paper/books`, `keyfile?kind=alpaca-paper&venue=alpaca-paper` and to POST three prepares to the stand-in — `{ draft: { type: "liveOrder", venue: "ex", symbol: "ETH/USDT", side: "buy", orderType: "market", usd: "25", limitPrice: "", stopPrice: "", tif: "", postOnly: "", reduceOnly: "", extendedHours: "", trailPercent: "", trailPrice: "", takeProfit: "", stopLoss: "" } }`, `{ draft: { type: "setWatch", venue: "ex", symbol: "BTC/USDT", on: "true" } }`, and `{ draft: { type: "approveCard", card: <the seeded card's id from the page>, action: <its hash>, decision: "approve" } }` — writing them trimmed like the stage-1 fixtures (the stand-in's `now`, nonces and deadlines kept as captured). Run it once against the stand-in (`FACE_ACCOUNT_SEAT_DIR=$HOME/buyer-agent-demo npx tsx scripts/capture-account-fixtures.ts`); commit the six files. Add their shape checks to `account-fixtures.test.ts` (`prepared-order.json` has `shown` with 18 entries, `action.deadline` a safe integer, `quote.order.words` a string).
- [ ] **Step 6: Run** `npm test` and `npm run typecheck` — Expected: green.
- [ ] **Step 7: Commit** — "face: the proxy's stage-2 rows — four reads and the three writes, bodies as bytes; fixtures for them from the stand-in"

### Task 2: The owner key module and the key store

**Files:**
- Create: `face/client/js/wire/owner-key.js`, `face/client/js/wire/key-store.js`
- Test: `face/tests/client/owner-key.test.js`, `face/tests/client/key-store.test.js`

**Interfaces:**
- Consumes: nothing of the face's (pure).
- Produces (`owner-key.js`): `canonical(v) → string` (keys sorted recursively, `undefined` dropped, arrays in order, no whitespace); `b64u(bufferOrView) → string` (no padding); `signingInput(prepared) → string` (`message = { accountChain: prepared.accountChain }` + each `prepared.shown[]` `name → value`, then `canonical({ domain: prepared.domain, primaryType: prepared.primaryType, message })`); `async kidOf(subtle, jwk) → string` (the first 16 hex of SHA-256 over base64url-decoded `x ‖ y`); `async publicJwkOf(subtle, keyPair) → { kty, crv, x, y }`; `async signPrepared(subtle, privateKey, kid, prepared) → { kid, es256 }` (ECDSA SHA-256 over the UTF-8 bytes of the input, raw `r‖s`); `async makeKey(subtle) → CryptoKeyPair` (non-extractable P-256, `["sign", "verify"]`). (`key-store.js`): `indexedDbKeys(indexedDB) → { get(): Promise<CryptoKeyPair|undefined>, put(k): Promise<void>, remove(): Promise<void> }` over `gravit-face-owner` v1 / `keys` / `device`; `memoryKeys()` the same shape; `signedOutFlag(storage) → { get(): boolean, set(on: boolean): void }` over `gravit.owner.signedOut.v1`, every access in try/catch.

- [ ] **Step 1: Write the failing tests** (`owner-key.test.js`, Node's `globalThis.crypto.subtle`): `"the canonical bytes equal the map's SetWatch input character for character"` — a prepared `{ domain: { name: "AgentAccountSignTransaction", version: "1", chainId: 424242 }, primaryType: "AccountTransaction:SetWatch", accountChain: "Simulation", shown: [{ name: "venue", value: "okx" }, { name: "symbol", value: "BTC/USDT" }, { name: "on", value: "true" }, { name: "nonce", value: "1761100000000" }] }` (shown out of alphabetical order on purpose) gives exactly `{"domain":{"chainId":424242,"name":"AgentAccountSignTransaction","version":"1"},"message":{"accountChain":"Simulation","nonce":"1761100000000","on":"true","symbol":"BTC/USDT","venue":"okx"},"primaryType":"AccountTransaction:SetWatch"}`; `"undefined is dropped and null is kept"`; `"a signature verifies under ieee-p1363"` — `makeKey`, `signPrepared`, then `crypto.verify("sha256", Buffer.from(input), { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(es256, "base64url"))` is true and the raw signature is 64 bytes; `"the kid is the first sixteen hex of sha256 over x and y"` (against `createHash("sha256")` in the test); `"b64u pads nothing and maps + and /"`. (`key-store.test.js`): `memoryKeys` get/put/remove; `indexedDbKeys` over a minimal fake `indexedDB` (`open` → request with `onupgradeneeded`/`onsuccess`, `transaction(store, mode).objectStore(store).get/put/delete` → requests) creates the store on upgrade and round-trips a value; `signedOutFlag` over a throwing storage answers false and never throws.
- [ ] **Step 2: Run** `npx tsx --test tests/client/owner-key.test.js tests/client/key-store.test.js` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** both modules; the IndexedDB code mirrors the Account's `owner.js` `open`/`tx` (the map §1.1) under the face's names.
- [ ] **Step 4: Run** the two files — Expected: PASS.
- [ ] **Step 5: Commit** — "client: the owner key — the Account's canonical bytes and signature over a P-256 key the browser keeps"

### Task 3: The device host

**Files:**
- Create: `face/client/js/host/owner.js`, `face/client/js/reducers/owner.js` (the `owner` slice only; the `sheet` slice is Task 5's)
- Modify: `face/client/js/data/empty.js` (`owner: { role: 'unknown', kid: '', refusal: null, busy: false }`), `face/client/js/reducers/index.js` (register)
- Test: `face/tests/client/host-owner.test.js`, `reducers.test.js`

**Interfaces:**
- Consumes: Task 2; `pageOk` from `host/account-view.js`.
- Produces: `startOwner({ store, post, subtle, keys, flag, now, label = 'Gravit face' }) → { ready(code?), standing(page), prepare(draft), submit(prepared), act(draft), signOut(), signIn(), close() }` where `post(path, body) → Promise<{ status, body }>` never throws (`{ status: 0, body: { ok: false, error: 'The account did not answer. Try again.' } }` on a thrown fetch); `export function postVia(fetch) → post` (a POST with `content-type: application/json`, the body parsed or `{}`, the thrown fetch as that refusal) lives beside `startOwner` for `app.js` and the smoke's Node runner. Roles (the slice's `role`): `'unknown' | 'signs' | 'pending' | 'needs-code' | 'signed-out' | 'none'` (`none` = no `subtle`, or the pair threw). `ready(code)`: the flag set and no code → `signed-out`; a code clears the flag; the key from `keys.get()` or made and put; `POST /data/account/pair { jwk, label, code? }`; 200 → role from `body.role` (`owner → signs`, `pending`, `needs-code`) and `kid = body.kid`, checked against `kidOf` (a mismatch is `none` with the refusal `'The account named another key'`); non-200 → `ownerRefusal(whyOf(r))`, the role unchanged. `standing(page)`: with a kid and a recognised page — in `signers.owners` → `signs`; in `pendingDevices` → `pending`; in neither while the role was `signs` or `pending` → `ready()` again (the service restarted); with no kid and role `unknown` and not signed out → `ready()` once. `prepare(draft)` → `post('/data/account/prepare', { draft })`. `submit(prepared)` → `post('/data/account/exchange', { action: prepared.action, nonce: prepared.action.nonce, signature })`; an answer whose `body.refusal?.code === 'E_ACCOUNT_BAD_SIGNATURE'` while the role is `signs` dispatches `ownerRefusal` and calls `ready()` (Review Focus 2). `act(draft)` = prepare, then submit only when `status === 200 && body.ok !== false && Array.isArray(body.shown)`, else the prepare answer as it came. `signOut()`: refused locally unless `signs` with a kid; `act({ type: 'signOut', device: 'device:<kid>' })`; on 200 with `ok !== false`: the flag set, role `signed-out`, kid `''`, `keys.remove()`; `signIn()`: the flag off, `ready()`. Reducers: `ownerStanding({ role, kid })`, `ownerRefusal(message|null)`, `ownerBusy(bool)`.

- [ ] **Step 1: Write the failing tests** (`host-owner.test.js`) with a **fake door**: a `post` that answers `/data/account/pair` (`needs-code` without a code, `owner` with `"K7QX-M2PA"`, the kid computed from the JWK as the Account does), `/data/account/prepare` (the generic branch: `action = { ...draft, nonce: 1761100000000 }`, `shown` = the type's fields then nonce as strings, `domain`/`primaryType`/`accountChain` per the map §2.1), `/data/account/exchange` (verifies `signature.es256` over `signingInput` rebuilt from its own `shown` with `crypto.verify` ieee-p1363 against the paired JWK — a wrong signature is 401 `E_ACCOUNT_BAD_SIGNATURE`; a right one 200 `{ ok: true, kind: "account", summary }`): `"a fresh page pairs with the code and signs"`; `"the standing follows the page's signers"` (owners → signs; pendingDevices → pending; neither after signs → pair again); `"an envelope the door verifies"` (act(setWatch) → 200; the door's log shows the body had exactly `action`, `nonce`, `signature`); `"a bad-signature answer re-reads the standing"` (the door answers 401 once: `ownerRefusal` set and pair called again); `"a refusal at prepare is handed back unsigned"` (409 at prepare → exchange never called); `"sign-out deletes the key and sets the flag; sign-in makes a new key"`; `"no WebCrypto is none"`; `"a thrown post is a refusal in the same shape"`.
- [ ] **Step 2: Run** `npx tsx --test tests/client/host-owner.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `host/owner.js` and the `owner` reducers; register the slice.
- [ ] **Step 4: Run** the file and `reducers.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — "client: the owner device — paired at the Account's door, signing its envelope, its standing read off every page"

### Task 4: The owner views and the sheet kinds

**Files:**
- Create: `face/client/js/host/owner-view.js`, `face/client/js/host/sheet-view.js`
- Test: `face/tests/client/owner-view.test.js`, `face/tests/client/sheet-view.test.js`

**Interfaces:**
- Consumes: `pageOk`, `venuesOf`, `requestsOf`, `asksOf`, `cardsOf` (stage 1); the fixtures `account.json`, `prepared-*.json`.
- Produces (`owner-view.js`): `standingWords(owner) → { line: string, key: null | 'pair' | 'signIn' }` — `signs` → `This page signs for the account`; `pending` → `Waiting to be let in — Let it sign on the Account page, under Devices`; `needs-code` → `Pair with the code the Account printed in its terminal` (key `pair`); `signed-out` → `Signed out` (key `signIn`); `none` → `This browser cannot sign for the account`; `unknown` → `''`; `devicesOf(page, owner) → { owners: [{ id, label, kind, here: bool }], pending: [{ kid, at }] }`; `whatYouSignLines(prepared) → string[]` (`${name}: ${value}` in `shown` order); `goodForWords(ms) → string` (`Your signature is good for m:ss more.`, `''` at or under zero); `refusedAt(r) → boolean` (the Account's own test: `!r || r.status >= 400 || !r.body || r.body.ok === false || (r.body.kind === 'result' && r.body.result && r.body.result.ok === false)`); `whyOf(r) → string` (`refusal.message || error || result.message || ''`); `refusalOf(r) → { message, again: bool, standing: bool }` (`again` for `E_ACCOUNT_REQUOTE` and `E_ACCOUNT_EXPIRED`, `standing` for `E_ACCOUNT_BAD_SIGNATURE`); `saidOf(body) → string` (`kind: 'order'` → `${order.id} · ${status words}` (`open on the book` / `filled` / `canceled` / the status), `kind: 'account'` → `summary`, `kind: 'result'` → `Done`). (`sheet-view.js`): `SHEET_KINDS` and, per kind, `fieldsOf(kind, seed) → [{ name, label, type: 'text'|'number'|'select'|'seg'|'check'|'pick', options?, placeholder?, value }]`, `draftOf(kind, fields, seed, now) → draft | string` (a string = what is missing, e.g. `Type an amount`), `titleOf(kind, seed) → string`, `goWord(kind) → string` (`Let it in`, `Give the limit`, `End the limit`, `Revoke`, `Connect`, `Open the account`, `Top up`, `Start over`, `Disconnect`, `Approve`, `Reject`, `Decline`, `Let it sign`, `Sign out`, `Sign and place`). Kinds and drafts (the map §3): `letIn` → `approveAgent { agentAddress: lower-cased, agentName, validUntil: now + days·DAY }` (days seg 1 · 7 · 30 · 90); `limit` → `approveSpend { agent, scope: 'trade', allow: ids joined by ',', perPayment, budget, windowHours: 0, validUntil }` (`allow` a pick over `seed.venues` paper first, at least one; `0 < perPayment ≤ budget`); `endLimit` → `approveSpend { …, perPayment: '0', budget: '0', windowHours: 0, validUntil: now + DAY }`; `revoke` → `approveAgent { agentAddress: '0x0000000000000000000000000000000000000000', agentName, validUntil: 0 }`; `connect` → `connectVenue { venue, connector, label, credentialRef }` (connector a select over `seed.options`; venue id; label; ref the key file's path, default the option's `defaultRef`); `paper` → `connectVenue { venue: 'paper-<id>', connector: 'live:paper', label, credentialRef: usd }` (`''` continues a kept book picked from `seed.books`); `topUp` → `topUpPaper { venue, usd }`; `resetPaper` → `resetPaper { venue, usd }`; `disconnect` → `disconnectVenue { venue }`; `approveCard` → `approveCard { card, action: hash, decision }`; `declineAsk` → `answerAsk { ask, decision: 'decline' }`; `letDevice` → `convertToMultiSigUser { signers: JSON.stringify({ authorizedUsers: [...owner ids, 'device:' + kid] sorted without repeats, threshold: 1 }) }`; `signOut` → `signOut { device }`; `order` → `tradeDraftOf` (Task 9; `sheet-view.js` delegates). `grantOf(ask) → { kind, seed } | null` (`limit`/`venue` → `limit`, `letIn` → `letIn`, `topup` → `topUp`; `session`, `leverage`, `mode` → null).

- [ ] **Step 1: Write the failing tests** (`owner-view.test.js`): the six standing lines; `devicesOf` over `account.json`'s `signers` with this page marked; `whatYouSignLines(prepared-watch)` = four lines in order; `goodForWords(125_000)` = `Your signature is good for 2:05 more.`; `"a result that is a refusal is refused on a 200"` (`{ status: 200, body: { ok: true, kind: 'result', result: { ok: false, code: 'E_CARD_REJECTED', message: 'You rejected it; nothing moved' } } }` → refused, `whyOf` the message); `refusalOf` for REQUOTE (again), BAD_SIGNATURE (standing). (`sheet-view.test.js`): each kind's draft from its fields (the exact objects above), the missing words for an empty amount, `allow` never `*`, the signers JSON sorted and unique with threshold 1, `grantOf` per ask kind.
- [ ] **Step 2: Run** the two files — Expected: FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — "client: the owner's words and every sheet's fields and draft, in the Account's own shapes"

### Task 5: The sheet engine

**Files:**
- Create: `face/client/js/host/sheet.js`
- Modify: `face/client/js/reducers/owner.js` (the `sheet` slice), `face/client/js/data/empty.js` (`sheet: null`)
- Test: `face/tests/client/host-sheet.test.js`, `reducers.test.js`

**Interfaces:**
- Consumes: Task 3's `owner`, Task 4's `draftOf`/`refusedAt`/`refusalOf`/`saidOf`.
- Produces: `startSheet({ store, owner, schedule, cancelTimer, now, afterAction, onChange = () => {} }) → { open(kind, seed, fields?), change(name, value), prepareNow({ quiet } = {}), submit(), again(), close() }` — `afterAction(kind, body)` after a signed answer; `onChange(kind, name, value)` after every `change` (Task 8's `connect` checks hang on it); `PREPARE_QUIET_MS = 300`, `RESIGN_UNDER_MS = 30_000`, `FRESH_MS = 3_000`. The slice: `sheet: null | { kind, seed, fields, status: 'incomplete'|'asking'|'ready'|'refused'|'signing'|'done', words, prepared, preparedAt, asked, deadline, message, again, said }`. Reducers: `sheetOpen({ kind, seed, fields })`, `sheetField({ name, value })` (status back to `incomplete`/`asking`? — no: the fields change, `asked` stays, the renderer compares `JSON.stringify(draftOf(...))` to `asked` to disable the key), `sheetIncomplete(words)`, `sheetAsking({ quiet })` (a quiet ask keeps `prepared` and `ready`), `sheetPrepared({ prepared, at, asked, deadline })`, `sheetRefused({ message, again })`, `sheetSigning`, `sheetDone({ said })`, `sheetClose`. Rules: `open` prepares at once when the draft is complete; `change` prepares after 300 ms of quiet (a new change cancels the pending one); `submit` — not `ready`, or the draft now ≠ `asked` → `prepareNow()` and return (Review Focus 4); `deadline` and `deadline − now() < 30 000` → `prepareNow()` then sign the fresh one in the same press (Review Focus 1); the countdown ticks every second only while a `deadline` is held (a timer dispatching `sheetTick`-free — the renderer draws `goodForWords(deadline − now)`, so the tick only re-renders; at ≤ 0 → `prepareNow()`); signing → `owner.submit(prepared)` → `refusedAt` → `sheetRefused(refusalOf(r))`, else `sheetDone({ said: saidOf(body) })` + `afterAction(kind, body)`; `close` cancels every timer.

- [ ] **Step 1: Write the failing tests** over a fake owner (`prepare` answering `prepared-watch.json`-shaped bodies with a `deadline` where asked, `submit` recording the envelope): `"a complete sheet prepares at once and an incomplete one says what is missing"`; `"a change prepares after 300 ms of quiet, once"`; `"a changed form is prepared again, not signed"`; `"a submit under thirty seconds prepares again before signing"`; `"at zero the sheet prepares again"`; `"a quiet ask keeps the shown preparation until the new one lands"`; `"a refusal at prepare is drawn and nothing is signed"`; `"a refusal with again offers Prepare again"`; `"done calls afterAction once with the kind and the body"`; `"close cancels the timers"`.
- [ ] **Step 2: Run** `npx tsx --test tests/client/host-sheet.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `host/sheet.js` and the slice.
- [ ] **Step 4: Run** the file and `reducers.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — "client: the sheet — prepare, What you sign, sign; the ten minutes and the re-prepare rules"

### Task 6: The owner's screen pieces

**Files:**
- Create: `face/client/js/render/owner.js`
- Modify: `face/client/js/render/account.js` (the head's device line and pair box; Settings › Devices), `face/client/css/app.css`
- Test: `face/tests/client/owner.test.js`, `account.test.js`, `css.test.js`

**Interfaces:**
- Consumes: Tasks 4–5's views and slice.
- Produces: `renderDeviceLine(state) → string` (the muted line; the pair box = an input `#pair-code` + a key `data-action="pairDevice"` when `key === 'pair'`; a `Sign in` key `data-action="signIn"` when `signIn`); `renderDevices(state) → string` (the Settings section: owners `label · id`, this page marked `this page`; pending `kid · since` each with `Let it sign` `data-action="letDevice" data-kid` when this page signs; `Sign out` `data-action="signOut"` when this page signs); `renderSheet(state, now) → string` (`<aside class="drawer sheet">`: the title, the fields by type (`data-action="sheetField"` with `name`; a `pick` as checkboxes; a `seg` via `seg()`), the quote box (`Fill it in to see what it would be.` / `Asking…` / the quote's `words` + figures for an `order` (Task 11 draws the ticket's own) / the refusal as the Account's words with `Prepare again` `data-action="sheetAgain"` when `again`), `<details class="acct-shown"><summary>What you sign</summary>` the lines verbatim, the countdown `<p class="sheet-left">`, the `said` line, Cancel `data-action="sheetClose"` and the go key `data-action="sheetSubmit"` disabled unless `ready` and the draft equals `asked`); the Account head draws the device line under the chips; `renderSettings` gains the Devices section.

- [ ] **Step 1: Write the failing tests** (`owner.test.js`, fake DOM over states built with the reducers and the fixtures): the six lines and their keys; Devices with and without a signing page; a sheet of kind `letIn` draws its fields and no go key before a preparation; a `ready` sheet draws What you sign lines verbatim and an enabled key; a changed field disables the key; a refusal draws the Account's sentence and `Prepare again` only when `again`; a countdown line; no CJK, no raw JSON, every Account string escaped (a name with `<b>`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `render/owner.js`, the head and Settings edits, the CSS (`.sheet` reuses `.drawer`; `.sheet-left`, `.pair-box`).
- [ ] **Step 4: Run** `owner.test.js`, `account.test.js`, `css.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — "client: the device line, Devices in Settings and the sheet drawn"

### Task 7: The Agents', Cards' and Asks' keys

**Files:**
- Modify: `face/client/js/render/account.js` (Agents, Cards), `face/client/js/host/account-view.js` (`agentsOf` rows gain `address`, each limit its `{ scope, allow, id }` beside its words; `cardsOf` cards gain `hash`; `asksOf` gains `kind` already — keep), `face/client/js/reducers/owner.js` (no change expected)
- Test: `face/tests/client/account.test.js`, `account-view.test.js`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces: data-actions — `openSheet` with `data-kind` and the seed in `data-*` (`letIn`: `data-address`, `data-name`; `limit`: `data-address`, `data-name`; `endLimit`: `data-address`, `data-allow`; `revoke`: `data-name`; `approveCard`: `data-card`, `data-hash`, `data-decision`; `declineAsk`: `data-ask`; `grant`: `data-ask`); the keys drawn only when `state.owner.role === 'signs'`; a `revoke` and a `disconnect` go through the existing two-step `confirm` (`askConfirm` with `action: 'revoke'`/`'disconnect'`) before the sheet opens.

- [ ] **Step 1: Write the failing tests** (`account.test.js`): with a signing page, a knocking key's row carries `Let in…`; an agent's row `Give a limit…`, each trade limit `End limit`, and `Revoke…`; a card carries `✓ Approve` and `✗ Reject` with its id and hash; an ask carries `Decline` and, for a `limit` ask, `Grant`; with a page that does not sign, none of these keys and the device line says why; (`account-view.test.js`) the rows' new fields from `account.json` and `agents.json`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the keys and the view fields.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — "client: Let in, Give a limit, End limit, Revoke, Approve, Reject, Decline and Grant on the Account screen"

### Task 8: The Venues' keys and the Connect reads

**Files:**
- Modify: `face/client/js/host/account.js` (`loadVenuesHere()`, `loadPaperBooks()`, `checkKeyfile({ kind, venue, ref })`, `reach(connector)`), `face/client/js/host/account-view.js` (`connectOptionsOf(page, venuesHere) → [{ connector, label, needs, example, defaultRef, kind, verdict, said, group }]` — key-file options with their verdict; `sign-in`/`address`/`cli` options carry `elsewhere: true`; `paperBooksOf(body)`, `keyfileWords(body) → { ready, path, missing[], message }`), `face/client/js/reducers/account.js` (reads `venuesHere`, `paperBooks`, `keyfile`, `reach`), `face/client/js/data/empty.js`, `face/client/js/render/account.js` (Venues: `Connect an account` → `openSheet` kind `connect`; `Open a paper account` → `paper`; a venue row's `Disconnect…` → confirm → `disconnect`; a paper venue's Details gain `Top up` and `Start over`), `face/client/js/host/sheet-view.js` (the `connect` sheet's `check` words from `keyfile`/`reach`: `ready` → `Key file found: <path>`, missing → `Missing: a, b`, `elsewhere` → `Connect on the Account page`)
- Test: `face/tests/client/host-account.test.js`, `account-view.test.js`, `account.test.js`

**Interfaces:**
- Consumes: Task 1's reads; Tasks 4–7.
- Produces: the four reads, their views, the Venues keys; the `connect` sheet asks `checkKeyfile` after 300 ms of quiet on its `ref` field and `reach` when the connector is picked (through the sheet host's `change` hook: `onChange(kind, name, value)` injected into `startSheet` by app.js — Task 13).

- [ ] **Step 1: Write the failing tests**: the four reads land and keep the Account's sentence on a refusal; `connectOptionsOf` over `account.json`'s `connectLive.options` × `venues.json` (a `not-served` venue carries its `said`; a `sign-in` option is `elsewhere`); `paperBooksOf(paper-books.json)`; `keyfileWords(keyfile.json)`; the Venues keys drawn only when the page signs.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — "client: Connect an account, Open a paper account, Disconnect, Top up and Start over, with the Account's own checks"

### Task 9: Trade's views and slice

**Files:**
- Create: `face/client/js/host/trade-view.js`, `face/client/js/reducers/trade.js`
- Modify: `face/client/js/data/empty.js` (`trade: { kind: <the first of TRADE_KINDS>, q: '', picks: {}, results: READ, ticket: null, said: null }`), `face/client/js/host/sheet-view.js` (`order` delegates to `tradeDraftOf`)
- Test: `face/tests/client/trade-view.test.js`, `reducers.test.js`

**Interfaces:**
- Consumes: `pageOf`, `legsOf`, `matchKey`, `rowsOf`, `ACCOUNT_TABS`, `priceOf` (stage 1's `market-view.js`); `openOrdersOf`, `orderWords`.
- Produces: `TRADE_KINDS` = the four `ACCOUNT_TABS` entries that are the Account's crypto, stocks, RWA and predictions tabs (read `market-view.js` for their ids); `pickerOf(state, now) → { held, watching, most, results }` rows `{ id, name, sub, priceWord, side?, venue? }` (held from the leading lens's rows matched to a key by `matchKey`, a prediction held opening as a sell; watching from `markets.watch` ∪ the page's `watch` (Task 12's `watchKeysOf`); most from `trade.picks[kind]`'s items (the explore read `tab=<kind>&limit=12`); results from `trade.results`); `ticketOf(state, now) → null | { id, item, legs: [{ venue, venueName, symbol, price, best, paper, able, public, session }], event, outcomes, unitWord, held }` (legs = the page view's legs where `able` = connected and the venue's `trade.can === true`; the best marked; public ones after); `tradeDraftOf(fields, ticket) → draft | string` — the 17-field `liveOrder` (`qty` or `usd` by `unit`; `limitPrice` for a limit — an event's typed in cents, sent as dollars `String(cents / 100)`; `extendedHours: 'true'` only when ticked and the leg's `session?.extendedHours`; every other field `''`); the missing words `Pick where`, `Type an amount`, `Type the limit price`, `A price in cents is between 0 and 100`; `quoteOf(prepared) → { words, price, notionalUsd, maxUsd, feeUsd, capUsd, paper, quoteFrom, quoteAt, name }` from `prepared.quote.order` (`number()` on each figure); `underWayOf(page) → [{ ...openOrdersOf row, cancel: { venue, order } }]`; `fillWords(ev) → string` from a `fill` frame (its shape in the read map §3.2 and the stand-in's frames fixture: `Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange`, `· Paper account` when `paper`). Reducers: `tradeKind`, `tradeQuery`, `picksLoading/Loaded/Failed({ kind, … })`, `resultsLoading/Loaded/Failed`, `ticketOpen({ id, side, venue, outcome })`, `ticketClose`, `tradeSaid(words|null)`.

- [ ] **Step 1: Write the failing tests** over `explore-all.json`, `explore-predictions.json`, `holdings.json`, `account.json`, `prepared-order.json`: the picker's groups; the ticket's legs with the best marked and a public one after; `tradeDraftOf` for a market buy in dollars, a limit sell in units, an event limit in cents (→ `"0.62"`), extended hours ticked where offered; the missing words; `quoteOf(prepared-order)`; `underWayOf(account.json)` with cancel seeds; `fillWords`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — "client: Trade's picker, ticket, draft and quote as views over the Account's shapes"

### Task 10: Trade's host

**Files:**
- Create: `face/client/js/host/trade.js`
- Test: `face/tests/client/host-trade.test.js`

**Interfaces:**
- Consumes: Task 9; Task 5's `sheet`; Task 3's `owner`; the stream client's `follow(keys)`.
- Produces: `startTrade({ store, getJson, owner, sheet, stream, schedule, cancelTimer, now }) → { show(on), kind(k), query(q), pick(id, { side = 'buy', venue = null, outcome = 0 } = {}), closeTicket(), cancel(venue, order), onStreamEvent(ev), close() }`; `PICKS_MS = 20_000`, `PICK_LIMIT = 12`, `FRESH_MS = 3_000`. `show(on)`: the kind's picks read (`/data/account/explore?tab=<kind>&limit=12`) on entry and every 20 s while on screen in a visible tab; `kind(k)` reads its picks; `query(q)` reads `/data/account/explore?q=<q>&limit=12` into `results` (blank drops them); `pick` opens the ticket (`ticketOpen`) and the `order` sheet with fields `{ venue: the best able leg or the one given, side, outcome, amount: '', unit: 'usd', orderType: 'market', limit: '', extendedHours: false }`, and follows the leg (`stream.follow(['<venue>:<symbol>'])`); a venue change re-follows; `closeTicket` closes the sheet and releases (`stream.follow([])`); `cancel(venue, order)` → `owner.act({ type: 'liveCancel', venue, order })` → `tradeSaid(saidOf | the refusal)` and `afterAction`; `onStreamEvent`: a `quote` frame for the followed leg while the sheet is `ready` and `now − preparedAt ≥ FRESH_MS` → `sheet.prepareNow({ quiet: true })`; a `fill` frame → `tradeSaid(fillWords(ev))`.

- [ ] **Step 1: Write the failing tests** with a fake `getJson`, a fake sheet and owner, a recording stream: picks on show and on a kind change, the poll stops off screen; a query reads results and a blank drops them; `pick` opens the sheet with the best venue and follows it; a venue change re-follows; a quote frame re-prepares quietly only after 3 s; a fill frame says it; `cancel` acts once and says the answer; `close` releases.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — "client: Trade's reads, the ticket's follow and its fresh quote, Cancel"

### Task 11: The Trade screen, the rail, the route, Buy and Sell

**Files:**
- Create: `face/client/js/render/trade.js` (from `git show 2418df7:gravit-ui/js/render/trade.js`, re-fed by Task 9's views: no `INSTRUMENTS`/`KINDS`/`trade.js` data; the ticket's quote, What you sign, the countdown and the message from the `sheet` slice through Task 4's words; the picker from `pickerOf`; Under way from `underWayOf` with `Cancel` `data-action="cancelOrder" data-venue data-order`; the head's chip from `headOf(page).writes`)
- Modify: `face/client/js/router.js` (`#/trade` → `{ screen: 'trade', id: null }`; `#/trade/<id>` the market to open), `face/client/js/render/rail.js` (`Trade` between Markets and Discover, icon `trade` or the nearest in `icons.js`), `face/client/js/render/markets.js` (an Account page's keys gain `Buy` (`data-action="openTicket" data-id data-side="buy"`) and `Sell` where held — only when the page signs), `face/client/css/app.css` (the `.trade`, `.tp*`, `.tk-*` rules from `git show 2418df7:gravit-ui/css/app.css`, trimmed to what the renderer uses)
- Test: `face/tests/client/trade.test.js`, `rail.test.js`, `markets.test.js`, `css.test.js`, the router test

**Interfaces:**
- Consumes: Tasks 4, 5, 9, 10.
- Produces: `renderTradeScreen(state, now) → string`; data-actions `tradeKind` (`data-value`), `tradeQuery` (`#tq`), `pickMarket` (`data-id`, `data-side`, `data-venue`), `ticketVenue` (`data-venue`), `ticketSide`, `ticketOutcome`, `ticketField` (`name`), `placeOrder` (the form's submit → `sheetSubmit`), `closeTicket`, `toggleSigns`, `cancelOrder`, `handToGravit` (the existing composer key; a ticket in words), `openTicket`.

- [ ] **Step 1: Write the failing tests** (`trade.test.js`): the screen with no ticket (`Pick a market`); a ticket with Where (the best marked, a public leg with `Connect to trade` → `#/account/venues`, `Paper` chips), the side seg, Amount and In, Market/Limit, the limit field only for a limit, Extended hours only where the leg offers it, the quote box from `prepared-order.json` (`words`, `≈ $notional`, `up to $max`, `fee`), What you sign closed by default with the 18 lines verbatim, the countdown, `Sign and place` disabled until ready; a prediction's outcomes under the picked row with cents; Under way with Cancel; no CJK, no icon URL, every Account string escaped; (`rail.test.js`) the Trade item in place; (`markets.test.js`) Buy and Sell on a signing page, absent otherwise.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the renderer, the route, the rail, the keys, the CSS.
- [ ] **Step 4: Run** the five files — Expected: PASS.
- [ ] **Step 5: Commit** — "client: the Trade screen on the Account's ticket — Where, the amount, the quote, What you sign, Sign and place; Buy and Sell on a market's page"

### Task 12: The star signs setWatch

**Files:**
- Modify: `face/client/js/host/market-view.js` (`watchKeysOf(page) → string[]` — the page's `watch[]` rows (`{ venue, symbol }`) as Account keys through the explore rows' legs (`matchKey`); `watchedOf` and the Watching tab take the union of `markets.watch` and `watchKeysOf(page)`), `face/client/js/host/markets.js` (`watch(id)`/`unwatch(id)` for an Account key: when the page signs, `owner.act({ type: 'setWatch', venue, symbol, on: 'true' | '' })` for the row's followed leg (`followOf`) — the refusal into `watchError` as the Account's words; the face's own list kept as the fallback when the page does not sign (*call*: the two lists are one tab)), `face/client/js/render/markets.js` (a starred Account row's word `Watched at the Account` under the star when the key is the page's)
- Test: `face/tests/client/market-view.test.js`, `host-markets.test.js`, `markets.test.js`

- [ ] **Step 1: Write the failing tests**: `watchKeysOf(account.json)` over `explore-all.json`; the Watching tab lists a page-watched row the face never starred; a star on a signing page acts `setWatch` with the followed leg and the row reads watched after the page re-reads; a refusal is the Account's sentence; a star on a page that does not sign goes to the face's list as before.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — "client: a star on an Account row signs setWatch; Watching is the Account's list and the face's together"

### Task 13: The wiring

**Files:**
- Modify: `face/client/js/app.js`, `face/client/js/data/empty.js` (every slice present), `face/client/js/reducers/index.js`, `face/client/js/render/account.js`/`rail.js` where a `renderSheet` must mount (the sheet is the drawer of any screen: `overlayOf`/`drawerOf` know `sheet`)
- Test: `face/tests/client/app-dom.test.js`, `app.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces, in `boot`: `const owner = startOwner({ store, post: postVia((path, init) => win.fetch(path, init)), subtle: win.crypto?.subtle ?? null, keys: win.indexedDB ? indexedDbKeys(win.indexedDB) : memoryKeys(), flag: signedOutFlag(storage), now })` (`postVia` from Task 3); `const sheet = startSheet({ store, owner, schedule, cancelTimer, now, afterAction, onChange })` where `afterAction(kind, body)` reads the page, the holdings and the statement past the cache (as the Account's `own()` does), and the seat after `letIn`/`limit`/`endLimit`/`revoke`; `onChange` for the `connect` sheet calls `account.checkKeyfile`/`account.reach` (Task 8); `const trade = startTrade({ store, getJson, owner, sheet, stream, schedule, cancelTimer, now })`; the owner's standing on every `accountLoaded` (subscribe to the store, or call `owner.standing(body)` from `account`'s landing through an `onPage` hook — add `onPage` to `startAccount`); `owner.ready()` once at boot after the first page lands; the stream handler passes `fill`/`quote` to `trade.onStreamEvent`; `follow()`: `#/trade` → `trade.show(...)` + `markets.show(false)`; `#/trade/<id>` entered with no ticket open on that id → `trade.pick(id)` (a buy); leaving Trade → `trade.closeTicket()`; `openTicket` (a market page's Buy or Sell) → `go({ screen: 'trade', id })` then `trade.pick(id, { side: el.dataset.side })`, which wins over `follow()`'s plain pick; the Account tabs as before; the data-actions: `pairDevice` (the `#pair-code` value → `owner.ready(code)`), `signIn`, `signOut` (→ `sheet.open('signOut', { kid })`), `letDevice` (→ `sheet.open('letDevice', { owners, kid })`), `openSheet` (kind + seed from `data-*`; `revoke`/`disconnect` via `askConfirm` first), `sheetField`, `sheetSubmit`, `sheetAgain`, `sheetClose`, `grant` (`grantOf(ask)` → `openSheet`), `tradeKind`, `tradeQuery` (300 ms quiet via the Markets search's helper), `pickMarket`, `openTicket` (→ `go({ screen: 'trade', id })` then `trade.pick`), `ticketVenue`/`ticketSide`/`ticketOutcome`/`ticketField` (→ `sheet.change`), `placeOrder` (→ `sheet.submit()`), `closeTicket`, `toggleSigns`, `cancelOrder` (→ `trade.cancel`), `toggleWatch` (Task 12's rule); Escape closes the sheet like the other drawers; `render()` mounts `renderSheet` into the current screen's `<main>` when `state.sheet` is set; `proxy`-side nothing.

- [ ] **Step 1: Write the failing tests** (`app-dom.test.js`, the fake DOM and fake hosts): boot pairs once after the first page; the pair box's code reaches `owner.ready`; `Let in…` opens the sheet with the knocking key's seed; a sheet field change reaches `sheet.change`; Sign reaches `sheet.submit`; done reloads the page, the holdings and the statement fresh; Escape closes the sheet; `#/trade` shows Trade and hides Markets' polls; Buy on a market page opens the ticket on it; a star on a signing page acts `setWatch`; Cancel in Under way acts `liveCancel`; a `fill` frame is said.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: green.
- [ ] **Step 5: Commit** — "client: the wiring — the device at boot, every key to its sheet, Trade on its route, the after-action reads"

### Task 14: The smoke's owner half

**Files:**
- Modify: `face/tests/account-graft-smoke.test.ts` (and `face/tests/helpers/standin.ts` if the pairing code must be exposed — it already is)
- Create: `face/tests/helpers/owner-node.ts` (runs `host/owner.js` under Node: a one-slice store, `post` over `node:http` to the face's port with the fence's headers (`Host` loopback, no `Origin`), `globalThis.crypto.subtle`, `memoryKeys()`, a memory flag)
- Test: the smoke under `FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=$HOME/buyer-agent-demo`

**Interfaces:**
- Consumes: Tasks 1, 3; the stand-in's seeds (`ex` = Stand-in Exchange with `ETH/USDT`, `SOL/USDT`; the seeded card from "Claude Code" asking a market buy of ETH; the pairing code from its stdout; it admits any browser typing the code once per run).
- Produces: the smoke's second half, per the spec §10: through the face's port — `owner.ready(code)` → `signs`; `act(setWatch { venue: 'ex', symbol: 'BTC/USDT', on: 'true' })` → 200 and `GET /data/account?fresh=1` lists it under `watch`; the stream opened first (`/data/account/stream?client=face-smoke…`), then `act(liveOrder { venue: 'ex', symbol: 'ETH/USDT', side: 'buy', orderType: 'market', usd: '25', …'' })` → `kind: 'order'`, and a `fill` frame within 10 s; `holdings?cost=1` shows ETH at `ex`; a limit buy of SOL at 0.9 × the ask → `open`, then `act(liveCancel { venue: 'ex', order })` → `canceled`; the seeded card approved (`approveCard { card, action: hash, decision: 'approve' }`) → 200 and a `card` frame `outcome: 'approved'` within 10 s; the fence: a POST to `/data/account/exchange` with a foreign `Origin` is 403; nothing of a body in the face's stdout (the smoke captures the boot's output and greps the code and `es256` out of it).

- [ ] **Step 1: Write the failing smoke assertions** (skipped without `FACE_SMOKE`).
- [ ] **Step 2: Run** `cd face && FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=$HOME/buyer-agent-demo npx tsx --test tests/account-graft-smoke.test.ts` — Expected: FAIL on the owner half (the routes exist from Task 1; the runner is missing).
- [ ] **Step 3: Implement** `owner-node.ts`; adjust `host/owner.js` only where Node differs from the browser (nothing expected: `subtle`, `keys`, `flag`, `post` are injected).
- [ ] **Step 4: Run** the smoke, then `FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=$HOME/buyer-agent-demo npm test` — Expected: green; no stand-in home left.
- [ ] **Step 5: Commit** — "face: the graft smoke pairs, watches, trades and answers a card through the face as the owner's device"

### Task 15: The documents and the charter

**Files:**
- Modify: `Gravit-Design.md` (the spec's §8 items 1, 2, 3, 4 (D18), 5, 6 and 9 — exact text; item 8 is stage 3's), `GRAVIT.md` (the spec §7's one line: the operator trades the same Account by hand from the face; a position Gravit did not open may be the owner's; the statement names who — and a trim elsewhere to stay ≤ 4 500 bytes), `face/README.md` ("The Account in the face" gains the device (pairing, Devices, Sign out), Trade, the keys, the manual drill of §10 with the real Account on 4820 and paper venues only; "The Account seat" loses "the only place a card is signed"), `DEVELOPMENT.md` (§4.2 the proxy's stage-2 rows, §4.4 the seven routes, §5.3 `host/owner.js`, `host/sheet.js`, `host/trade.js`, §5.4 `render/owner.js`, `render/trade.js`, §5.5 the slices, §6 a path "the operator places an order" (pick → prepare → What you sign → sign → exchange → the fill on the stream), §7.3 the new tests, §7.4 the drill, §9 residuals), `CLAUDE.md` (the `face/client/` row's stage 2 sentence gains Trade and the device; the Account-seat gotcha gains one sentence: the face's page is an owner device of the Account — paper venues only in the drill), `docs/superpowers/specs/2026-10-20-account-seat-design.md` (§6.3 and §11 marked superseded by the graft design), `docs/superpowers/plans/2026-10-22-account-graft-ledger.md` (a stage-2 section: a line per task, the rulings, the deferred minors, the drill owed)
- Test: `face/tests/gravit-md.test.ts`; `npm test`

- [ ] **Step 1: Write** the documents — every number from the Global Constraints, every route from Task 1, the honest states from Tasks 6–11; the charter's edits verbatim from the spec §8.
- [ ] **Step 2: Run** `cd face && npm test && npm run typecheck` — Expected: green (GRAVIT.md within its bytes).
- [ ] **Step 3: Commit** — "docs: stage 2 of the graft — the owner device, Trade and the keys; the charter's D18"

---

## Self-review notes

- Spec coverage: §5.1 stage-2 rows (Task 1); §6.3 the device (Tasks 2–3, 6, 13), pairing and Devices (3, 6, 13), the envelope (2–3), every action prepare → What you sign → sign (4–5), the answers and refusals (3–5), sign-out (3, 6, 13); §6.4 the Trade screen (9–11, 13), the ticket and its draft (9), Under way and Cancel (9–11), Connect an account / paper / Disconnect (8), Agents (7), Cards (7), Watch (12), Settings › Devices (6); §6.5 unchanged; §7 (15); §8 items 1–6, 9 (15); §10 the device tests (2–5), the smoke (14), the manual drill (15, owed to the operator); §11 the risks stated in the README (15).
- Calls made here, each reversible by a word: one-click `setWatch` and `liveCancel`; the signing keys absent (not disabled) when the page does not sign; the two watch lists as one tab; a submit under 30 s re-prepares and signs in the same press; `Grant` opens only `limit`/`letIn`/`topUp` (the rest Decline only).
- Open to the builder: the IndexedDB fake's shape in the tests; the ticket's CSS trim; which `icons.js` glyph is Trade's; the owner-node runner's http helper; how `afterAction` names the seat reload.
- Proportion: signatures, test names and the Account's exact values; no function body is written out.
