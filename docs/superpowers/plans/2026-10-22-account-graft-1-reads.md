# The Account grafted into the face — stage 1, the reads · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The face proxies the Account's reads and push channel under `/data/account/*`, and its Markets and Account screens draw the Account's content — markets, net worth, holdings, positions, open orders, statement, venues, agents, cards — with the face's own keyed quote providers no longer subscribed by any screen and A shares alone on the face's wire.

**Architecture:** One new server module, `face/src/account-proxy.ts`, registers exact `/data/account/…` routes behind the face's `/data` fence, each a bare loopback `fetch` of the Account with a per-route TTL cache, single flight and `?fresh=1`, bodies passed through unparsed, the SSE stream piped per browser connection; `seat.ts` reads `/api/account` through the proxy's shared reader. In the client the Account's payloads enter the store through re-pointed host layers (`host/account.js`, `host/markets.js`) and a new stream client (`wire/account-stream.js`); pure views (`host/account-view.js`, `host/market-view.js`) reduce them to words and rows the renderers draw; nothing in the client computes a price, a fit or a cap of its own.

**Tech Stack:** Node 22, TypeScript (`tsx --test`), vanilla ES modules in the browser (no bundler), `node:test` with the fake DOM under `face/tests/client/`, Linqi's stand-in Account (`test/standin/ui-standin.ts` at the installed checkout) for fixtures and the smoke.

**Spec:** `docs/superpowers/specs/2026-10-22-account-graft-design.md` (§5 the proxy, §6.1 Markets, §6.2 Account, §10 tests; the Account's shapes in `docs/research/2026-10-22-account-read-api-map.md`).

## Global Constraints

- The product speaks English; screens carry no explanatory small print — one muted status line where the spec allows it; the Account's refusal sentences are drawn as its words.
- Vanilla ES modules, no bundler, no framework; `tsx --test tests/*.test.ts tests/client/*.test.js`; the frame fixture `face/tests/fixtures/events.jsonl` untouched.
- Every proxied route: the face's fence first (`isTrustedDataRequest`, 403 `{"ok":false,"error":"forbidden"}`), then 405 for a method the row does not name, then the whitelisted query, then the Account; nothing of the raw query reaches the Account; `fresh` is the face's own flag, never forwarded.
- The loopback fetch sends no `Origin`, no `Sec-Fetch-Site`, no cookie; `redirect: "error"`; the Account's status and body pass through as they are; a fetch failure is `503 {"ok":false,"unreachable":"<CODE>"}` with a code matching `/^[A-Z][A-Z0-9_]{1,31}$/` (`ECONNREFUSED`, `timeout`, `unreadable`, `disabled`), never an error's text.
- TTLs and aborts, in milliseconds: `account` 15 000 · 7 000; `explore` 20 000 · 10 000; `market`, `quotes` 3 000 · 7 000; `compare` 15 000 · 7 000; `candles` 30 000 · 25 000; `holdings` 8 000 · 12 000; `positions` 10 000 · 7 000; `statement` 10 000 · 7 000; `history` 60 000 · 12 000; `agents` 15 000 · 7 000; at most 64 cache keys per route; `stream/markets` body ≤ 4 096 bytes.
- The client reads at the Account's own cadence: `/data/account` every 20 s on screen, 80 s while the stream is open; `explore` every 20 s while Markets is on screen in a visible tab; `quotes` every 5 s for the rows in view, twelve pairs a call; a hidden tab stops everything and closes its stream.
- No third-party image URL from the Account's rows is ever rendered; the tile is the face's own letters.
- The face's quote wire (`/data/quotes`, `/data/quotes/stream`, `/data/symbols/search`) is subscribed for `cn:` ids only after this stage; `/data/bars` and `/data/account.json` are read by no screen.
- Commit messages are written to a file and committed with `git commit -F` (no backticks or parentheses on a `-m` line); one logical change per commit; the ledger `docs/superpowers/plans/2026-10-22-account-graft-ledger.md` gets a line per task.

## Review Focus

1. **An Account answer with `ok: false` on a 200 or a 409** (`{ ok: false, refusal: { message } }` or `{ ok: false, error }`): the screen draws the Account's sentence as a status line and keeps the last good data, never treats the body as data or blanks the numbers. Pinned in Task 7 (`host-account.test.js`: "a 409 refusal keeps the last data and carries the Account's message") and Task 10 (`host-markets.test.js`: "an explore refusal keeps the last rows").
2. **An `explore` item without a price, an event past its end, a Kalshi row with `contracts24h` and no dollar volume**: the row draws `—` for what is missing, `Closed` for `pastEnd`, contracts where there are no dollars, and sorts nulls last. Pinned in Task 9 (`market-view.test.js`: "unpriced, past-end and contract-volume rows").
3. **A `snapshot` frame on the stream** (a reconnect past the Account's ring, or another process run): every account read runs again and the kept quotes are dropped. Pinned in Task 5 (`account-stream.test.js`: "a snapshot is delivered as an event") and Task 7 ("a snapshot reloads account, holdings, statement and agents").
4. **A `/data/account` page the face does not recognise** (missing `venues`, `cards`, `signers`, `connectLive`, or `ok` absent): the head reads "Account unreadable", no figure is drawn, the seat box says `unreadable`. Pinned in Task 6 (`account-view.test.js`: "an unrecognised page is unreadable, never a number") and Task 8 (`account.test.js`).
5. **A query the whitelist refuses** (a repeated name, `limit=abc`, a 300-character `q`, `force=1` on `venues`): the face answers 400 `invalid account request` and the Account is never asked. Pinned in Task 2 (`account-proxy.test.ts`: "a repeated or unknown name, an over-long value: 400, nothing forwarded").

---

## File structure

| File | Responsibility |
|---|---|
| `face/src/account-proxy.ts` (new) | the route table, the whitelist, the shared reader, the GET caches, the SSE pipe, the `stream/markets` POST |
| `face/src/seat.ts` (modify) | reads `/api/account` through the shared reader; its reduction unchanged |
| `face/src/main.ts` (modify) | registers the proxy with the composed seat row's URL; hands the reader to the seat route |
| `face/scripts/capture-account-fixtures.ts` (new) | spawns the stand-in, reads the stage-1 routes, writes trimmed fixtures |
| `face/tests/fixtures/account/*.json` (new) | the Account's answers at 133b9a7: `account`, `explore-all`, `explore-predictions`, `holdings`, `holdings-paper`, `positions`, `statement`, `history`, `history-paper`, `agents`, `compare`, `candles`, `market`, `stream-frames.txt` |
| `face/client/js/wire/account-stream.js` (new) | the browser's stream client over `/data/account/stream`: client id, resume, follows, stale/dead, hidden-tab policy |
| `face/client/js/host/account-view.js` (rewrite) | pure: head, worth, change, assets, positions, open orders, statement + CSV, venues, agents (Gravit first), cards, asks, the unreadable case |
| `face/client/js/host/account.js` (rewrite) | impure: the reads and their cadence, the stream's account events |
| `face/client/js/host/market-view.js` (rewrite) | pure: the Account's tabs, rows by kind, prices by kind, source words, legs, the page's view, the old-star match |
| `face/client/js/host/markets.js` (rewrite) | impure: explore, quotes in view, candles, compare, the page's follow, the cn wire, the two watch stores, the ask-once |
| `face/client/js/reducers/account.js`, `reducers/markets.js`, `data/empty.js`, `router.js` (modify) | the slices and the tabs |
| `face/client/js/render/account.js`, `render/markets.js`, `render/chart.js`, `render/rail.js` (modify) | the screens |
| `face/client/js/app.js` (modify) | the wiring: the stream, the polls, the page's follow, the receipt reload |
| `face/tests/account-proxy.test.ts` (new), `face/tests/seat.test.ts` (modify), `face/tests/account-graft-smoke.test.ts` (new) | the server tests and the smoke |
| `face/tests/client/account-stream.test.js` (new), `account-view.test.js`, `host-account.test.js`, `account.test.js`, `rail.test.js`, `market-view.test.js`, `host-markets.test.js`, `markets.test.js`, `chart.test.js` (rewrite) | the client tests |
| `face/README.md`, `DEVELOPMENT.md`, `CLAUDE.md`, the ledger (modify) | the documents |

---

### Task 1: The Account's answers as fixtures

**Files:**
- Create: `face/scripts/capture-account-fixtures.ts`
- Create: `face/tests/fixtures/account/{account,explore-all,explore-predictions,holdings,holdings-paper,positions,statement,history,history-paper,agents,compare,candles,market}.json`, `face/tests/fixtures/account/stream-frames.txt`
- Test: `face/tests/account-fixtures.test.ts`

**Interfaces:**
- Produces: the fixture files every client test of this plan reads (`JSON.parse(readFileSync(...))`), each the Account's own body at 133b9a7 with `native` fields and `icon` URLs stripped and arrays cut to the first 12 entries; `stream-frames.txt` holds the first ten frames of `GET /api/account/stream?client=face-fixture00000000000000` verbatim (a `retry:` line, a `snapshot` or replay, an `hb`).

- [ ] **Step 1: Write the failing fixture test**

```ts
// face/tests/account-fixtures.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const fx = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/account/${name}.json`, import.meta.url), "utf8"));

test("the Account fixtures carry what the views read", () => {
  const a = fx("account");
  assert.equal(a.ok, true); assert.ok(Array.isArray(a.venues)); assert.ok(Array.isArray(a.cards)); assert.ok(a.signers?.owners);
  assert.ok(a.connectLive?.writes && typeof a.connectLive.writes.capUsd === "number"); assert.ok(["guard", "open"].includes(a.mode));
  const e = fx("explore-all");
  assert.ok(e.tabs.some((t: any) => t.id === "all")); assert.ok(e.items.length > 0); assert.ok(e.items.every((i: any) => typeof i.key === "string" && i.at));
  assert.ok(e.items.every((i: any) => i.icon === undefined), "icons stripped");
  const p = fx("explore-predictions"); assert.ok(p.items.some((i: any) => i.kind === "event" && Array.isArray(i.outcomes)));
  const h = fx("holdings"); assert.equal(h.ok, true); assert.ok(Array.isArray(h.rows)); assert.ok(h.change24h);
  assert.equal(fx("holdings-paper").paper, true);
  assert.ok(Array.isArray(fx("positions").positions)); assert.ok(Array.isArray(fx("statement").lines)); assert.ok(Array.isArray(fx("history").points));
  assert.equal(fx("history-paper").paper, true); assert.ok(Array.isArray(fx("agents").agents)); assert.ok(Array.isArray(fx("compare").rows));
  assert.ok(Array.isArray(fx("candles").candles)); assert.ok(fx("market").market?.symbol);
  const frames = readFileSync(new URL("./fixtures/account/stream-frames.txt", import.meta.url), "utf8");
  assert.match(frames, /^retry: 1000\n\n/); assert.match(frames, /\nevent: (snapshot|hb)\n/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd face && npx tsx --test tests/account-fixtures.test.ts`
Expected: FAIL — `ENOENT … fixtures/account/account.json`

- [ ] **Step 3: Write `face/scripts/capture-account-fixtures.ts`**

Spawns the stand-in exactly as `tests/account-seat-smoke.test.ts` does (`process.execPath`, `<FACE_ACCOUNT_SEAT_DIR>/node_modules/tsx/dist/cli.mjs`, `test/standin/ui-standin.ts --port <free> --no-desk`, wait for the `page` and `home` lines), then reads with bare `fetch` (no headers): `/api/account`, `/api/account/explore`, `/api/account/explore?tab=predictions`, `/api/account/holdings?cost=1`, `/api/account/holdings?cost=1&paper=1`, `/api/account/positions`, `/api/account/statement`, `/api/account/history?range=1w`, `/api/account/history?range=1w&paper=1`, `/api/account/agents`, `/api/account/compare?base=ETH&side=buy`, `/api/account/candles?venue=<the paper venue id from account.venues>&symbol=<its first market from explore's at[]>&range=1D`, `/api/account/market?venue=<same>&symbol=<same>`; strips every `native` and `icon` key recursively, cuts every array to 12, writes each as pretty JSON; reads the stream for ten frames with `accept: text/event-stream` and writes them verbatim; kills the stand-in. Usage: `FACE_ACCOUNT_SEAT_DIR=~/buyer-agent-demo npx tsx scripts/capture-account-fixtures.ts`.

- [ ] **Step 4: Run the script and the test**

Run: `cd face && FACE_ACCOUNT_SEAT_DIR=$HOME/buyer-agent-demo npx tsx scripts/capture-account-fixtures.ts && npx tsx --test tests/account-fixtures.test.ts`
Expected: the thirteen JSON files and `stream-frames.txt` written; PASS 1/1

- [ ] **Step 5: Commit**

```bash
git add face/scripts/capture-account-fixtures.ts face/tests/fixtures/account face/tests/account-fixtures.test.ts
git commit -F /tmp/m   # "face: the Account's answers at 133b9a7 as fixtures, captured from the stand-in"
```

---

### Task 2: The proxy's reader and GET routes

**Files:**
- Create: `face/src/account-proxy.ts`
- Test: `face/tests/account-proxy.test.ts`

**Interfaces:**
- Consumes: `isTrustedDataRequest` (`face/src/data.ts`), `FORBIDDEN`, `markStale`, `readBody`, `HttpError` (`face/src/http.ts`), `RouteRegistrar` (`face/src/static.ts`), `seatUrl` (`face/src/account-seat.ts`).
- Produces:

```ts
export const ACCOUNT_TTL_MS: Readonly<Record<ReadRoute, number>>;      // the Global Constraints table
export const ACCOUNT_ABORT_MS: Readonly<Record<ReadRoute, number>>;
export const ACCOUNT_CACHE_KEYS = 64;
export type ReadRoute = "account" | "explore" | "market" | "quotes" | "compare" | "candles" | "holdings" | "positions" | "statement" | "history" | "agents";
export type AccountAnswer = { status: number; body: string } | { unreachable: string };
export interface AccountReader { read(fresh?: boolean): Promise<AccountAnswer> }        // GET /api/account through the `account` cache
export interface AccountProxyDeps { url?: string; fetch?: typeof fetch; now?: () => number; disabled?: boolean }
export function createAccountReader(deps?: AccountProxyDeps): AccountReader;
export function registerAccountProxy(webServer: RouteRegistrar, deps?: AccountProxyDeps & { reader?: AccountReader }): { reader: AccountReader; dispose(): void };
/** The whitelist: route → allowed query names; a value is at most 240 characters, each name at most once. */
export const ACCOUNT_QUERY: Readonly<Record<ReadRoute, readonly string[]>>;
export function rebuildQuery(route: ReadRoute, rawUrl: string): { query: string; fresh: boolean } | null;   // null = invalid
```

The face routes: `/data/account` → `account`; `/data/account/<route>` for the other ten. Allowed names: `account` [`fresh`]; `explore` [`tab`,`q`,`key`,`limit`]; `market` [`venue`,`symbol`]; `quotes` [`pairs`]; `compare` [`base`,`side`,`usd`,`asset`]; `candles` [`venue`,`symbol`,`interval`,`range`,`before`,`limit`]; `holdings` [`cost`,`paper`,`fresh`]; `positions` [`venue`]; `statement` [`fresh`]; `history` [`range`,`paper`,`venue`]; `agents` [`fresh`]. The upstream URL is `<url>/api/account[/<route>]?<query>` with `fresh` removed.

- [ ] **Step 1: Write the failing tests** — `face/tests/account-proxy.test.ts`, with the `req`/`fakeRes`/`routeWith` helpers of `tests/seat.test.ts` copied for this module (`registerAccountProxy({ register }, { url, fetch: spy, now })`; the route found by path):

```ts
test("rebuildQuery: the whitelist, once each, 240 characters, fresh stripped", () => {
  assert.deepEqual(rebuildQuery("explore", "/data/account/explore?tab=crypto&q=btc&limit=60"), { query: "tab=crypto&q=btc&limit=60", fresh: false });
  assert.deepEqual(rebuildQuery("holdings", "/data/account/holdings?cost=1&fresh=1"), { query: "cost=1", fresh: true });
  assert.equal(rebuildQuery("explore", "/data/account/explore?tab=a&tab=b"), null, "a repeated name");
  assert.equal(rebuildQuery("explore", "/data/account/explore?force=1"), null, "an unknown name");
  assert.equal(rebuildQuery("explore", `/data/account/explore?q=${"x".repeat(241)}`), null, "an over-long value");
  assert.deepEqual(rebuildQuery("account", "/data/account"), { query: "", fresh: false });
});
test("the routes: eleven exact paths; the fence refuses a foreign Origin and a missing Host before any fetch", …);   // 403 + FORBIDDEN, fetched.length === 0
test("a GET passes the Account's status and body through, with application/json and no-store", …);               // 200 body === the fake's; a 409 refusal body passes as 409
test("a repeated or unknown name, an over-long value: 400 invalid account request, nothing forwarded", …);
test("the upstream request carries no Origin, no Sec-Fetch-Site, no cookie, redirect error, and the rebuilt query only", …);  // inspect init.headers and the url the spy saw
test("two reads within the TTL fetch once; ?fresh=1 fetches again and never joins a plain flight; the TTL expires per route", …);  // ACCOUNT_TTL_MS.holdings vs .account
test("concurrent reads of one key share a fetch; two keys are two fetches; the 65th key evicts the least recently used", …);
test("an unreachable, hanging, refusing or unreadable Account: 503 with the code and never the text; a cached read is re-served stale:true", …);
test("a disabled row answers 503 unreachable disabled on every route without a fetch", …);
test("POST on a GET route is 405", …);
test("createAccountReader: read() is the account route's cache; read(true) asks again", …);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd face && npx tsx --test tests/account-proxy.test.ts`
Expected: FAIL — `Cannot find module '../src/account-proxy.ts'`

- [ ] **Step 3: Implement `face/src/account-proxy.ts`** — the reader and the GET routes per the Interfaces block: one `Map<string, { body: string; status: number; at: number }>` per route keyed by the rebuilt query, insertion-ordered for LRU; one in-flight map per route with the seat route's `fresh` rule (a plain read joins any flight, a fresh read joins only a fresh flight and otherwise runs after the plain one); the fetch as `seat.ts` does it (`AbortController`, `redirect: "error"`, the abort on headers and body, the body read as text); `send(res, status, body)` with `content-type: application/json; charset=utf-8` and `cache-control: no-store`.

- [ ] **Step 4: Run the tests**

Run: `cd face && npx tsx --test tests/account-proxy.test.ts`
Expected: PASS, all

- [ ] **Step 5: Commit**

```bash
git add face/src/account-proxy.ts face/tests/account-proxy.test.ts
git commit -F /tmp/m   # "face: the Account proxy, its reader and eleven read routes behind the fence"
```

---

### Task 3: The stream pipe and `stream/markets`

**Files:**
- Modify: `face/src/account-proxy.ts`
- Test: `face/tests/account-proxy.test.ts`

**Interfaces:**
- Produces: `/data/account/stream` (GET; query `since`, `client`, `markets`; `Last-Event-ID` → `since` when absent) and `/data/account/stream/markets` (POST, ≤ 4 096 bytes, passed as bytes with `content-type: application/json`, status and body through). `export const STREAM_CLIENT = /^[A-Za-z0-9_-]{8,48}$/;` `export const STREAM_BODY_LIMIT = 4096;`

- [ ] **Step 1: Write the failing tests**

```ts
test("the stream: a bad client id is 400; a good one opens upstream with accept text/event-stream, since and markets as sent; frames pass through byte for byte", …);
// the fake fetch answers a ReadableStream that emits "retry: 1000\n\n", then "id: ab.1\nevent: hb\ndata: {\"at\":1}\n\n"; the fake res collects writes; assert the writes equal the chunks and the headers are text/event-stream, no-cache, no-transform, keep-alive
test("Last-Event-ID becomes since when the query has none; a since in the query wins", …);
test("the Account's 503 passes through as 503 with its body; an unreachable upstream is 503 unreachable", …);
test("closing the browser response aborts the upstream fetch", …);   // the fake fetch's signal fires
test("stream/markets: the body passes as bytes with application/json; 413 past 4096; GET is 405", …);
```

- [ ] **Step 2: Run them** — Expected: FAIL (no such routes)
- [ ] **Step 3: Implement** — the SSE handler: validate `client` (400 `invalid account request` when absent or not `STREAM_CLIENT`), build the upstream URL (`since` from the query or the `last-event-id` header, `client`, `markets` ≤ 4 000 characters), `fetch` with `headers: { accept: "text/event-stream" }` and an `AbortController` aborted on `res.close`; on a non-200 answer send its status and body as JSON; on 200 `writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" })` and `for await (const chunk of body) res.write(chunk)`, ending the response when the upstream ends; a `writableLength` over 256 KiB destroys the response as `quotes.ts` does. The POST: `readBody(req, STREAM_BODY_LIMIT)` then `fetch(..., { method: "POST", headers: { "content-type": "application/json" }, body })`, status and body through; `HttpError` 413 → `{ ok: false, error: "body too large" }`.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — "face: the Account's push channel piped per browser connection; the follow set forwarded"

---

### Task 4: The seat route through the shared reader; the proxy registered in `main.ts`

**Files:**
- Modify: `face/src/seat.ts` (the `read` function, `SeatDeps`, `SEAT_TTL_MS`), `face/src/main.ts:170-178`
- Test: `face/tests/seat.test.ts` (modify), `face/tests/account-proxy.test.ts` (one test added)

**Interfaces:**
- Consumes: `createAccountReader`, `registerAccountProxy`, `AccountReader` (Task 2).
- Produces: `SeatDeps` gains `reader?: AccountReader`; `registerSeatRoute` makes a reader from `url/fetch/now/timeoutMs` when none is given (so `seat.test.ts` keeps its `fetch` seam) and otherwise reads through the one it is handed; `SEAT_TTL_MS` is re-exported as `ACCOUNT_TTL_MS.account` (15 000). `main.ts` calls `const proxy = registerAccountProxy(booted.ctx.webServer, seatRow === undefined ? {} : seatRow.disabled ? { disabled: true } : { url: seatRow.url });` and then `registerSeatRoute(booted.ctx.webServer, { …, reader: proxy.reader })`.

- [ ] **Step 1: Write the failing test** (in `account-proxy.test.ts`):

```ts
test("the seat route and /data/account share one upstream read within the TTL", async () => {
  // registerAccountProxy with a counting fetch; registerSeatRoute({ register }, { url, seatName: "Gravit", reader: proxy.reader, now });
  // call /data/account then /data/seat.json: fetched.length === 1; the seat view says admitted
});
```
And in `seat.test.ts` change the TTL test's constant expectation: `assert.equal(SEAT_TTL_MS, 15_000)`.

- [ ] **Step 2: Run** — Expected: FAIL (`reader` is not a dep; the TTL is 30 000)
- [ ] **Step 3: Implement** — in `seat.ts`, `read()` becomes: `const a = await reader.read(fresh)`; `"unreachable" in a` → `unreachable(a.unreachable)`; `a.status !== 200` → `unreachable(\`http ${a.status}\`)`; else `JSON.parse(a.body)` (a throw → `unreadable`) → `seatView`. The seat route keeps its own `fly` for the reduced body but its TTL is the shared one. In `main.ts` register the proxy before the seat route and pass the reader.
- [ ] **Step 4: Run** `cd face && npx tsx --test tests/seat.test.ts tests/account-proxy.test.ts tests/account-seat.test.ts && npm run typecheck` — Expected: PASS, typecheck clean
- [ ] **Step 5: Commit** — "face: the seat box reads the Account through the proxy's shared reader; the proxy registered at boot"

---

### Task 5: The browser's stream client

**Files:**
- Create: `face/client/js/wire/account-stream.js`
- Test: `face/tests/client/account-stream.test.js`

**Interfaces:**
- Produces:

```js
export const STALE_MS = 20_000, DEAD_MS = 45_000, RETRY_MS = [1000, 2000, 5000, 10000, 30000], FOLLOW_LIMIT = 16;
export function mintClientId(random)                    // "face-" + 24 lower-case hex from random(12) → Uint8Array
export function createAccountStream({ createEventSource, fetcher, schedule, cancelTimer, now, random }, onEvent)
// → { open(), close(), follow(keys), status(), clientId, lastId() }
// onEvent({ type, id, data }) for every named event (snapshot, order, fill, position, balance, paper, statement, card, desk, quote, trades, book, hb)
// status(): 'idle' | 'connecting' | 'open' | 'stale' | 'closed'
```
Behaviour: `open()` makes an EventSource at `/data/account/stream?client=<id>&since=<lastId when known>` (the browser adds `Last-Event-ID` itself on its own reconnects; `since` covers a fresh object); every frame with an `id` updates `lastId()`; no frame for `STALE_MS` → `stale`; none for `DEAD_MS` → close and reopen after `RETRY_MS[n]`; a `snapshot` event is delivered like any other (the host decides what to re-read); `follow(keys)` keeps the last set (≤ `FOLLOW_LIMIT`, extra dropped), POSTs `/data/account/stream/markets` `{ client, markets, n }` with a rising `n` whenever the stream is open and the set changes, and tells it again on every open and once more after 1 s when the POST was not 2xx; `close()` closes the source and cancels timers.

- [ ] **Step 1: Write the failing tests** — with a fake `EventSource` class the test drives (`emit(type, data, id)`, `error()`), fake timers (`schedule`/`cancelTimer` recording), a recording `fetcher`:

```js
test('mintClientId is face- and 24 hex from the random bytes', …);
test('open connects with the client id and no since; a frame id becomes lastId; a reopen carries since', …);
test('a named event reaches onEvent with its id and parsed data; a snapshot is delivered as an event', …);
test('silence for STALE_MS is stale; for DEAD_MS the source is closed and reopened after RETRY_MS[0], then [1]', …);
test('follow posts the set with a rising n on open and on change, drops past 16, and retells once after a failed post', …);
test('close cancels every timer and closes the source', …);
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/account-stream.test.js` — Expected: FAIL (no module)
- [ ] **Step 3: Implement** `wire/account-stream.js` per the Interfaces block (the `onEvent` payload's `data` is `JSON.parse(ev.data)`, an unparsable frame is dropped).
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — "client: the Account's push channel in the browser — the client id, resume, follows, stale and dead"

---

### Task 6: The Account's pure views

**Files:**
- Rewrite: `face/client/js/host/account-view.js`
- Test: `face/tests/client/account-view.test.js` (rewrite; reads the fixtures of Task 1)

**Interfaces:**
- Consumes: `money`, `number`, `pct`, `sign` (`wire/account-model.js`), `fmtDate` (`time.js`), the fixtures.
- Produces (all pure, `null` for anything that does not parse, never `NaN`):

```js
export function pageOk(page)                 // true iff page?.ok === true && Array.isArray(page.venues) && Array.isArray(page.cards) && Array.isArray(page.orders) && page.signers && page.connectLive
export function headOf(page)                 // { mode: 'Guard' | 'Beast' | '', writes: 'Trading on · $100 a move' | 'Read-only' | '' }
export function worthOf(page, holdings, paper)   // { lead: { label: 'Net worth' | 'Paper', usd }, second: { label, usd } | null, paperLeads }
//   real leads unless page.totalUsd === 0 (or null) and some page.venues[].paper === true and paper?.totalUsd is a number
export function changeOf(history)            // { usd, pct, partial, first } from changeUsd/changePct/partial/first; nulls when absent
export function assetsOf(holdings)           // [{ key, asset, cls, amount, usd, price, changePct24h, venues: [{ venue, venueName, amount, usd, stale }] }] largest usd first
export function positionsOf(holdings)        // [{ venue, venueName, symbol, name, side, qty, entryPrice, markPrice, usd, unrealizedUsd, paper }]
export function openOrdersOf(page)           // page.orders with status in open|partial|pending → [{ id, venue, venueName, symbol, side, type, qty, filledQty, limitPrice, status, who, paper }]; who = 'You' for authority 'owner', else agentName or 'An agent'
export function missingWords(missing)        // ['<venueName> did not answer', …]
export function statementOf(statement)       // lines newest first: [{ key, at, type, kind, description, amountUsd, feeUsd, status, by, paper }]
export function csvOf(rows)                  // 'date,type,kind,description,amount,fee,status,by' + RFC 4180 rows, CRLF
export function venuesOf(page)               // [{ id, name, usd, frontLine, health: 'answers' | 'not-answering' | 'not-read', healthWords, does: string[], paper, asOf, stale, details: { holdings: [{asset, amount, usd}], noTradeBecause, restricted, notServed, closeOnly, watchOnly, keyFile } }]
//   health from page.health[id]: lastOkAt newer than lastFailAt → answers; lastFailAt newer → not-answering with 'Not answering since HH:MM' built by the renderer from lastFailAt; neither → not-read
//   does: 'Trades' when trade.can === true, 'Moves money' when liveCan.transfer || liveCan.withdraw, 'Receives' when liveCan.receive, 'Earns' when earn.can === true, 'Watched' when watchOnly
export function agentsOf(agents, seatView)   // Gravit's row first from seatWords(seatView) as { gravit: true, name, standing, limits, cards, orders }, then agents.agents[] as { gravit: false, name, status, validUntil, limits: ['trade · paper-1 · $100 an order · $850 of $1,000 left'], cards: n, orders: n }; the knocking page.requests[] are not here (Task 8 draws them from cardsOf)
export function cardsOf(page)                // [{ agentName, cards: [{ id, reason, usd, expiresAt, shown: [{ name, value }] }] }] grouped in order of first appearance
export function asksOf(page)                 // [{ id, agentName, kind, text, expiresAt }]
export function requestsOf(page)             // [{ address, name, at }]
export { seatWords } (unchanged)
```

- [ ] **Step 1: Write the failing tests** over the fixtures (`account.json`, `holdings.json`, `holdings-paper.json`, `history.json`, `statement.json`, `agents.json`) plus hand-built edge cases:

```js
test('pageOk: the fixture is a page; a body missing venues, cards, signers or connectLive is not', …);
test('headOf: guard + writes on → Guard, Trading on · $250 a move; open → Beast; writes off → Read-only', …);   // the stand-in's cap is 250
test('worthOf: real money leads when totalUsd > 0; with totalUsd 0 and a paper venue, Paper leads and real is second', …);
test('changeOf: usd, pct, partial, first; nulls when the history is missing', …);
test('assetsOf and positionsOf: the fixture rows in order, amounts numeric, a row without usd is null', …);
test('openOrdersOf: only open, partial and pending; who is You or the agent name', …);
test('statementOf and csvOf: newest first; the CSV header and a quoted description', …);
test('venuesOf: health from lastOkAt/lastFailAt; does words; the paper flag; details without a key value', …);
test('agentsOf: Gravit first from the seat view, then the Account agents with their limit words', …);
test('cardsOf, asksOf, requestsOf: grouped by agent; shown verbatim', …);
test('an unrecognised page is unreadable, never a number: every function answers empty on {ok:true} alone', …);
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/account-view.test.js` — Expected: FAIL (`headOf is not a function` …)
- [ ] **Step 3: Implement** `host/account-view.js` per the Interfaces block; keep `seatWords` and its `dollars` helper; `fmtDate`/`fmtClock` for words that carry a date are the renderer's (the view returns ISO strings and numbers).
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — "client: the Account's page, holdings, history, statement and agents as the screen's pure views"

---

### Task 7: The Account host layer and slices

**Files:**
- Rewrite: `face/client/js/host/account.js`; Modify: `face/client/js/reducers/account.js`, `face/client/js/data/empty.js` (the `account` slice)
- Test: `face/tests/client/host-account.test.js` (rewrite)

**Interfaces:**
- Consumes: `pageOk` (Task 6); the stream events (Task 5) as `onStreamEvent`.
- Produces: the slice `account: { status, data, at, message, holdings: READ, paper: READ, history: READ & { range }, statement: READ, agents: READ, statementOpen }` with `READ = { status: 'idle'|'loading'|'ready'|'error', data, at }`; reducers `accountLoading`, `accountLoaded({ data, at })`, `accountFailed({ at, message })` (keeps the last data; `message` is the Account's refusal sentence or null), `holdingsLoaded/paperLoaded/historyLoaded/statementLoaded/agentsLoaded({ data, at })` and their `…Loading`/`…Failed({ at })`, `setHistoryRange(range)` (`'1d'|'1w'|'1m'|'all'`), `openStatement`, `closeStatement` (kept); and

```js
export const ACCOUNT_POLL_MS = 20_000, ACCOUNT_POLL_STREAM_MS = 80_000;
export function startAccount({ store, getJson, now, schedule, cancelTimer, streamOpen })   // streamOpen: () => boolean
// → { load({ fresh }), loadHoldings(), loadHistory(range), loadStatement(), loadAgents(), loadAll(), poll(on), onStreamEvent(ev), close() }
```
`load` reads `/data/account` (`?fresh=1` when fresh; the one-flight-per-kind rule of today's `load` kept); a body with `ok !== true` or failing `pageOk` dispatches `accountFailed` with `message = body?.refusal?.message ?? body?.error ?? null`. `loadHoldings` reads `holdings?cost=1` and, when `store.get().account.data?.venues` has a paper venue, `holdings?cost=1&paper=1` too. `loadHistory(range)` reads `history?range=<range>` and, when a paper venue exists and `worthOf` says paper leads, `history?range=<range>&paper=1` instead (one read, the leading one). `onStreamEvent`: `order`, `fill`, `paper`, `balance`, `position` → `loadHoldings()` + `load({ fresh: true })`; `statement` → `loadStatement()`; `card` → `load({ fresh: true })`; `snapshot` → `loadAll()`. `poll(true)` schedules `load()` every `ACCOUNT_POLL_MS`, or `ACCOUNT_POLL_STREAM_MS` while `streamOpen()`; `poll(false)` cancels.

- [ ] **Step 1: Write the failing tests** (the `rig` of today's test, with recording `schedule`/`cancelTimer`):

```js
test('load reads /data/account once for two callers; fresh reads ?fresh=1 and does not join a plain flight', …);
test('a 409 refusal keeps the last data and carries the Account message; an unrecognised page is a failure', …);
test('loadHoldings reads cost=1, and cost=1&paper=1 only when a paper venue is connected', …);
test('loadHistory reads the leading curve: paper=1 when paper leads', …);
test('stream events: order and fill reload holdings and the page fresh; statement reloads the statement; a snapshot reloads everything', …);
test('poll schedules every 20 s, 80 s while the stream is open; poll(false) cancels', …);
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/host-account.test.js` — Expected: FAIL
- [ ] **Step 3: Implement** the host layer, the reducers and the slice. Remove `KEY_REFS`, `PROBE_IDS`, `describe()`, `credentialsLoaded`, `toolsLoaded`, `probeLoaded` and the `creds`/`tools`/`probe` fields (the A-share provider chip is Task 10's).
- [ ] **Step 4: Run** `cd face && npx tsx --test tests/client/host-account.test.js tests/client/reducers.test.js` — Expected: PASS
- [ ] **Step 5: Commit** — "client: the Account read at its own cadence, its holdings, history, statement and agents, the stream's events"

---

### Task 8: The Account screen, the rail's worth line, the tabs

**Files:**
- Rewrite: `face/client/js/render/account.js`; Modify: `face/client/js/render/rail.js:58-64`, `face/client/js/router.js` (`TABS = ['portfolio', 'venues', 'agents', 'cards']`), `face/client/js/render/chart.js` (a `curveSvg(points, { currency })` for net-worth points `{ at, usd }`)
- Test: `face/tests/client/account.test.js` (rewrite), `face/tests/client/rail.test.js` (modify), `face/tests/client/chart.test.js` (add `curveSvg`), `face/tests/client/router.test.js` (modify if present)

**Interfaces:**
- Consumes: every view of Task 6, the slice of Task 7, `seg`, `segLinks`, `chip` as today.
- Produces: `renderAccountScreen(state, now)`; `renderStatement(state, now)`; `renderSettings(state)` (unchanged). The head: `Account` · the mode chip and the writes chip from `headOf` · `Refresh` · `Settings`; the tabs `Portfolio · Venues · Agents · Cards` (`#/account/<tab>`), the Cards tab's label carries the count when any. Portfolio: the lead figure with its label, the second figure, the change line for the range with a `seg` of `1D · 1W · 1M · All` (`data-action="setHistoryRange"`), the curve (`curveSvg`), **Assets** (Asset · Amount · Price · 24h · Value, each row's venues under its name), **Positions**, **Open orders** (`<venue> · Buy 0.5 ETH · limit 2,400 · open · You`), `missingWords` as a muted line, the stale stamp and the unreachable line, `Account unreadable` when `pageOk` is false, the Account's `message` when present. Venues: the rows of `venuesOf` (name, value, frontLine, the health word, the does words, `Paper` chip, `Details` → a drawer `details` under `state.account.detailsVenue`), the seat box as today under them, the A-share quotes line (Task 10's `providers` for `cn`), **Open the Account page**. Agents: `agentsOf` rows, Gravit's first; the knocking `requestsOf` under a `Knocking` label. Cards: `cardsOf` groups, each card's reason, value, `answer by HH:MM`, a `<details>` **What it asks** listing `shown` as `name: value`; `asksOf` under `Asks`. The rail: `worthLine` draws `worthOf(...).lead` as `$9,988 · Paper` or `$12,480`.

- [ ] **Step 1: Write the failing tests** (states built with the reducers over the fixtures):

```js
test('the head: Guard and Trading on chips; Refresh and Settings; four tabs with the cards count', …);
test('Portfolio on the stand-in: Paper leads with its label; the change line; the curve; assets and positions rows; open orders with who', …);
test('Portfolio: an unrecognised page reads Account unreadable and draws no figure; a 409 message is drawn as the Account words', …);
test('Venues: the rows with health, does and Paper; Details opens the drawer; the seat box and Open the Account page stay', …);
test('Agents: Gravit first, the stand-in agent after with its limit words; Knocking requests', …);
test('Cards: grouped by agent with What it asks verbatim; Asks under them', …);
test('the Statement drawer: the lines newest first with by; Export CSV', …);
test('no CJK, no icon URL, no raw JSON in any rendered string', …);
test('rail: the worth line is the lead figure with Paper when paper leads', …);
test('router: account tabs agents and cards parse; an unknown tab is portfolio', …);
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/account.test.js tests/client/rail.test.js tests/client/chart.test.js` — Expected: FAIL
- [ ] **Step 3: Implement** the renderer, the rail line, the router tabs, `curveSvg` (the same geometry as `chartSvg`, points by `at`).
- [ ] **Step 4: Run** — Expected: PASS; then `npx tsx --test tests/client/*.test.js` green but for the Markets tests not yet rewritten (name them in the ledger).
- [ ] **Step 5: Commit** — "client: Account is the Account — Portfolio, Venues, Agents, Cards, the Statement; the rail's worth"

---

### Task 9: The Markets pure view

**Files:**
- Rewrite: `face/client/js/host/market-view.js`
- Test: `face/tests/client/market-view.test.js` (rewrite; the `explore-*`, `compare`, `candles`, `market`, `holdings`, `statement` fixtures)

**Interfaces:**
- Consumes: `normalizeAsset`, `number` (`wire/market-model.js`) for the cn rows; `positionsOf`, `openOrdersOf`, `statementOf` (Task 6).
- Produces:

```js
export const ACCOUNT_TABS = [['all','All'],['crypto','Crypto'],['stocks','Stocks'],['rwas','RWAs'],['perps','Perps'],['preipo','Pre-IPO'],['predictions','Predictions']];
export const MARKET_SORTS = [{ id: 'volume', label: 'Most traded' }, { id: 'movers', label: 'Biggest moves' }, { id: 'closing', label: 'Closing soonest' }];
export function canonicalId(raw)                       // unchanged (the face's grammar); plus
export function isAccountKey(id)                       // /^(coin|stock|perp|rwa|kalshi|pm|pmus):/
export function tabsOf(explore, cnCount)               // [{ id, label, count }] : All first, then the Account's non-empty tabs in ACCOUNT_TABS order; Stocks present or its count raised when cnCount > 0; 'watching' when any star; 'results' while searching
export function priceOf(item)                          // { price, unit: 'usd' | 'cents', changePct, change24h, volume, volumeUnit: 'usd' | 'contracts', implied } — an event's price in cents (price * 100), change24h in cents; a pre-IPO perp carries implied.usd
export function sourceWordOf(item, now)                // 'Robinhood · real time' | 'Cboe · 15 min delayed' | '<venueName>' … from quoteFrom, with the age ('· 2 min ago') when quoteAt is older than 5 s
export function legsOf(item)                           // [{ venue, venueName, symbol, connected, paper, canTrade, public, connectTo, connector, price, bid, ask, best }] connected first, best = the lowest ask among connected
export function rowsOf(markets, cn)                    // the table's rows for markets.tab, markets.q, markets.sort: Account rows { id: item.key, source: 'account', item, kind, name, sub, priced: priceOf, sourceWord, closeTime, pastEnd, watched, legs } ∪ cn rows { id, source: 'face', asset, quote, … }; sorted volume desc | |movers| desc | closeTime asc, nulls last; 'watching' = stars only; 'results' = the search hits (Account q-results ∪ cn hits)
export function matchKey(faceId)                       // 'us:AAPL' → { q: 'AAPL', kind: 'stock' }; 'crypto:BTC/USD' → { q: 'BTC', kind: 'coin' }; cn → null
export function pairsOf(rows, limit = 12)              // the first `limit` rows' first connected leg as 'venue|symbol'
export function pageOf(markets, account, id)           // { item, legs, candles: markets.candles[id]?.data, range, compare: markets.compare[item.base]?.rows, held: positionsOf(...) for the item's legs' (venue, symbol), orders: openOrdersOf(account.data) for them, lines: statementOf(account.statement.data) whose description names the symbol, mentions: [] }
export const mentionsOf (unchanged)
```

- [ ] **Step 1: Write the failing tests**

```js
test('tabsOf: the fixture tabs in order, All first; Stocks raised by cn rows; Watching and Results when due', …);
test('priceOf: a coin in dollars; an event in cents with change in cents; Kalshi volume in contracts; a pre-IPO implied', …);
test('sourceWordOf: the Account quoteFrom verbatim, with the age past 5 s', …);
test('legsOf: connected first, best marked, public legs with connectTo', …);
test('rowsOf: the fixture rows and two cn rows side by side; source words; the three sorts; nulls last; a cn row only under All and Stocks', …);
test('unpriced, past-end and contract-volume rows: dashes, Closed, contracts', …);
test('matchKey and pairsOf', …);
test('pageOf: the item, its legs, candles for the range, compare rows, held, orders and lines for the market', …);
test('no icon URL survives any view (an item given an https icon by hand)', …);
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/market-view.test.js` — Expected: FAIL
- [ ] **Step 3: Implement** `host/market-view.js` per the Interfaces block (delete `MARKET_TABS`, `holdingAssets`, `listAssets`, `marketRows`, `assetFor`, `positionId`; keep `canonicalId`, `quoteWord`, `connectionWord`, `providerWord`, `basisWord`, `sourceWord`, `volumeWord`, `searchWord`, `watchWord` for the cn rows).
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — "client: Markets' rows, tabs, prices by kind and a market's page from the Account's shapes"

---

### Task 10: The Markets host layer and slices

**Files:**
- Rewrite: `face/client/js/host/markets.js`; Modify: `face/client/js/reducers/markets.js`, `face/client/js/data/empty.js` (the `markets` slice), `face/client/js/wire/market-model.js` (a second storage key)
- Test: `face/tests/client/host-markets.test.js` (rewrite)

**Interfaces:**
- Consumes: `rowsOf`, `pairsOf`, `matchKey`, `isAccountKey` (Task 9); the stream's `follow` and quote events (Task 5).
- Produces: the slice `markets: { tab, sort, q, explore: READ, results: READ, accountQuotes: {} (by 'venue|symbol' → Market), candles: {} (by id → READ & { range }), compare: {} (by base → READ), watch: [] (Account keys, under storage key 'gravit.account.watch.v1'), asked: {} (faceId → item key | null), watchlist (cn only), watchError, quotes, providers, connection, search, hitQuotes }`; reducers `exploreLoading/Loaded/Failed`, `resultsLoaded`, `accountQuotesLoaded({ quotes })`, `candlesLoading/Loaded/Failed({ id, range, data })`, `compareLoaded({ base, data })`, `accountWatchLoaded({ items, error })`, `askedOfAccount({ faceId, key })`, `streamQuote({ key, data })` (updates `accountQuotes` for the followed market), `setMarketsTab` (any of ACCOUNT_TABS, `watching`, `results`), `setMarketsSort` (+ `closing`), `setMarketsQuery`, `setRange({ id, range })`; `wire/market-model.js` exports `ACCOUNT_WATCH_KEY = 'gravit.account.watch.v1'`, `readAccountWatch(storage)`, `saveAccountWatch(storage, keys)`; and

```js
export const EXPLORE_MS = 20_000, QUOTES_MS = 5_000, QUOTE_PAIRS = 12;
export function startMarkets({ store, getJson, createLiveQuotes, createSymbolSearch, storage, win, stream, schedule, cancelTimer, now })
// → { show(on), search(q), watch(id), unwatch(id), page(id), range(id, range), rowsInView(ids), close() }
```
`show(true)` reads `explore` at once and every `EXPLORE_MS`, and `quotes?pairs=` every `QUOTES_MS` for `pairsOf(rowsInView)`; `show(false)` cancels both and tells the cn wire `setVisible(false)`. `search(q)` reads `explore?q=<q>&limit=200` into `results` and the cn search for `q` (the face's wire); `watch(id)`: an Account key → the account watch store; a `cn:` id → the cn watchlist; `page(id)`: an Account key → `candles?venue=&symbol=&range=<range>` for its first connected leg (else its first public leg), `compare?base=<item.base>&side=buy` for coins, perps and stocks, and `stream.follow([`${venue}:${symbol}`])`; leaving the page → `stream.follow([])`. On boot the cn wire's old `us:`/`crypto:` watchlist entries are asked of the Account once each (`explore?q=<matchKey.q>&limit=12`; a hit whose `kind` matches and whose `base` equals `q` → `askedOfAccount({ faceId, key })` and the entry moves to the account watch store; none → `askedOfAccount({ faceId, key: null })`, the entry stays listed as "Not listed at the Account"). The cn wire subscribes only `cn:` ids.

- [ ] **Step 1: Write the failing tests**

```js
test('show reads explore now and every 20 s; quotes for the pairs in view every 5 s, twelve a call; show(false) cancels', …);
test('an explore refusal keeps the last rows and the Account message', …);
test('search reads explore?q and the cn search; results land in results', …);
test('watch: an Account key goes to the account store, a cn id to the cn list; the cn wire subscribes cn only', …);
test('page: candles for the range, compare for a coin, the stream follow; leaving releases the follow; range re-reads candles', …);
test('old us: and crypto: stars are asked of the Account once; a hit moves the star, a miss is Not listed', …);
test('a stream quote updates the followed market', …);
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/host-markets.test.js` — Expected: FAIL
- [ ] **Step 3: Implement** the host layer, the reducers, the slice and the storage key.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — "client: Markets reads the Account — explore, quotes in view, candles, compare, the follow; A shares on the face's wire; the old stars asked once"

---

### Task 11: The Markets screen and the chart

**Files:**
- Rewrite: `face/client/js/render/markets.js`; Modify: `face/client/js/render/chart.js` (`candlesSvg(candles, { unit, range })`, a range seg)
- Test: `face/tests/client/markets.test.js` (rewrite), `face/tests/client/chart.test.js` (modify)

**Interfaces:**
- Consumes: Task 9's views, Task 10's slice.
- Produces: `renderMarketsScreen(state, now)`, `marketPage(id, state, now)`; `mkAv(name)` keeps the letter tile. The table: the Account's tabs (`tabsOf`), the search box, the sort seg (three sorts, `Closing soonest` only when any row has a `closeTime`), rows: star · tile and name with the sub (`BTC · Perpetual`, an event's short name, the cn exchange) · price (cents with `¢` for an event) · 24h · volume (`contracts` where so) · the source word; `Closed` where `pastEnd`; the "Not listed at the Account" line with `Remove` for the asked-and-missed stars; the muted lines (`connectionWord` for the cn wire, the Account's `message`). The page: `‹ Markets`, the tile and name, the sub, keys `Hand to Gravit` · `Watch` (no Buy, no Sell), the price and 24h with the source word, the facts (`Previous close`-less: `24h volume`, `Venues`, `Source`), **Price history** with the range seg `1D · 5D · 1M · 3M · 6M · YTD · 1Y · 5Y · MAX` (`data-action="setRange"`) and `candlesSvg` plus the Account's `ends`/`note` line, **Across venues** from `legsOf` (connected with price and `best`, public with `Connect to trade` → `#/account/venues`), **You hold**, **Open orders**, **Gravit on it**, **On the statement**; a `cn:` id → today's page unchanged.

- [ ] **Step 1: Write the failing tests** (states over the fixtures and the reducers; the helpers of today's `markets.test.js`):

```js
test('the table: the Account tabs, rows with source words, cents for an event, contracts for Kalshi, Closed past end', …);
test('sorts: Most traded, Biggest moves, Closing soonest only with events', …);
test('a cn row beside the Account rows under Stocks; Not listed line with Remove for a missed star', …);
test('the page: no Buy, no Sell; the range seg; Across venues with best and Connect to trade; You hold and Open orders; On the statement', …);
test('candlesSvg draws closes for a range; cents for an event', …);
test('no CJK, no icon URL in any rendered string', …);
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/markets.test.js tests/client/chart.test.js` — Expected: FAIL
- [ ] **Step 3: Implement** the renderer and `candlesSvg`.
- [ ] **Step 4: Run** `cd face && npx tsx --test tests/client/*.test.js` — Expected: PASS, every client test
- [ ] **Step 5: Commit** — "client: Markets is the Account's Markets — its tabs, its prices, a market's page with its venues and history"

---

### Task 12: The wiring, the A-share line, the smoke

**Files:**
- Modify: `face/client/js/app.js` (the `boot` wiring), `face/client/js/host/actions.js` (`refreshAccount` → `account.load({ fresh: true })` + holdings + seat; `setHistoryRange`; `setRange`; `removeAsked`), `face/client/js/render/account.js` (the A-share quotes line from `state.markets.providers` filtered to `cn`)
- Create: `face/tests/account-graft-smoke.test.ts`
- Modify: `face/tests/gravit-client-smoke.test.ts` (the account read it asserts)
- Test: `face/tests/client/app.test.js` (if present: the wiring assertions), the smoke

**Interfaces:**
- Consumes: everything above.
- Produces: in `boot`, `const stream = createAccountStream({ createEventSource, fetcher, schedule, cancelTimer, now, random }, ev => { account.onStreamEvent(ev); if (ev.type === 'quote') store.dispatch('streamQuote', ev.data); if (ev.type === 'card' && ev.data?.waits === undefined) void seat.load({ fresh: true }); })`; `stream.open()` on boot, closed on `visibilitychange` hidden and reopened on visible; `account.poll(true)` while the Account screen is on screen and visible, `markets.show(...)` while Markets is; entering a market page → `markets.page(id)`, leaving → `markets.page(null)`; `onReceipt` → `seat.load({ fresh: true })` and `account.load({ fresh: true })`; the Account tabs read what they need on entry (Venues: nothing more; Agents: `loadAgents()`; Cards: `load({ fresh: true })`; Portfolio: `loadHoldings()` + `loadHistory(range)`; the Statement drawer: `loadStatement()`). The smoke (`FACE_SMOKE=1` and `FACE_ACCOUNT_SEAT_DIR`): the stand-in spawned as `account-seat-smoke` does, the face booted with `FACE_ACCOUNT_URL` at it, then over HTTP to the face's own port: `GET /data/account` is 200 with `ok: true` and `venues`; `GET /data/account/explore` is 200 with `items`; `GET /data/account/explore?force=1` is 400; `GET /data/account/stream?client=face-smoke0000000000000000` answers `text/event-stream` and a first frame within 5 s; `GET /data/seat.json` says reachable.

- [ ] **Step 1: Write the failing smoke** per the Interfaces block (skip unless `FACE_SMOKE=1`). `bootFace` registers no `/data` route — `main.ts` does, after it — so the smoke registers the two itself on `booted.ctx.webServer`, as `tests/smoke.test.ts` and `account-seat-smoke.test.ts` register the seat route: `const proxy = registerAccountProxy(booted.ctx.webServer, { url: standin.url }); registerSeatRoute(booted.ctx.webServer, { url: standin.url, seatName: SEEDED_AGENT_NAME, reader: proxy.reader });`.
- [ ] **Step 2: Run** `cd face && FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=$HOME/buyer-agent-demo npx tsx --test tests/account-graft-smoke.test.ts` — Expected: FAIL on the client-side assertions only if any are made against the page; the HTTP assertions pass once Tasks 2–4 are in — so this step's expected failure is the `gravit-client-smoke` assertion on `/data/account.json`, run next.
- [ ] **Step 3: Wire `app.js` and `actions.js`**; point `gravit-client-smoke.test.ts`'s account assertion at `/data/account`.
- [ ] **Step 4: Run** the smoke, then `npm test`, `npm run typecheck`, `FACE_SMOKE=1 npm test` — Expected: all green; the smoke 1/1
- [ ] **Step 5: Commit** — "face, client: the wiring — the stream, the polls, the page's follow; the graft smoke against the stand-in"

---

### Task 13: The documents for stage 1

**Files:**
- Modify: `face/README.md` ("Markets and Account" rewritten; the seat section's box paragraph; a new "The Account in the face" section with the proxy's table, the cadence, the fixtures script, the smoke), `DEVELOPMENT.md` (§4.2 `account-proxy.ts` row, §4.4 the twelve routes + `/data/seat.json` through the reader, §4.6 nothing new, §5.3 the host layers, §5.4 the renderers, §5.5 the slices, §6 a path "the operator opens Markets", §7.3 the new tests, §9 a residual: the keyed providers idle), `CLAUDE.md` (the `face/src/account-seat.ts` row gains `account-proxy.ts`; the `face/client/` row's stage 2 sentence), the ledger
- Test: `face/tests/gravit-md.test.ts` still green (GRAVIT.md untouched this stage); `npm test`

- [ ] **Step 1: Write the README section and the DEVELOPMENT rows** — every number from the Global Constraints, every route from Task 2's table, the honest states from Task 8.
- [ ] **Step 2: Run** `cd face && npm test && npm run typecheck` — Expected: green
- [ ] **Step 3: Commit** — "docs: stage 1 of the graft — the proxy, the two screens on the Account, the tests"

---

## Self-review notes

- Spec coverage: §5.1 (Tasks 2–4), §5.2 (Task 4), §6.1 (Tasks 9–11), §6.2 reads (Tasks 6–8), §6.5 (Task 8), the stream (Tasks 3, 5), the cadence (Tasks 7, 10, 12), the honest states (Tasks 6, 8), the fixtures and the smoke (Tasks 1, 12), the documents (Task 13). Stage 2 (§6.3–§6.4) and stage 3 (§12) are their own plans.
- Open to the builder: the exact LRU structure; the cn wire's `createLiveQuotes` left as it is; the drawer markup for Venue details; the `curveSvg`/`candlesSvg` geometry (today's `chartSvg`'s); which test helper files are shared.
- Proportion: the plan names signatures, tests and values; no function body is written out.
