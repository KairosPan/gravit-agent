# The Account's two parts, plan 2 — the relay, the iFinD route, Lunhui's adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four Lunhui freeze rows reach no market host themselves: every Tencent and Eastmoney GET goes through the Account's relay (`GET /api/cn/relay?url=`) and the boards stand-in's 问财 query through its iFinD route (`POST /api/cn/ifind`), which alone holds the iFinD token; the evidence, the contracts and every refusal Lunhui gives stay as they are.

**Architecture:** Fetching moves, reading stays. The Account gains two raw passthrough routes over plan 1's `CnHttp` (`account/src/portfolio/live/cn-http.ts`, whose host list is already a parameter): `cn-relay.ts` (an allow-list of exactly the (host, path) pairs the rows use, bytes/status/content type/location unchanged, no redirect followed, no cache) and `cn-ifind.ts` (the token exchange, the six-day cache and the one re-exchange moved from `face/plugins/lunhui/lib/wencai.mjs`). Lunhui's production `fetchImpl` — today `globalThis.fetch` in `freezeDeps` (`lib/freeze-tool.mjs:74-88`) — becomes `accountFetch(origin)` (`lib/account-fetch.mjs`), a fetch-shaped adapter, so `fetchBytes`, the Eastmoney limiter and one-redirect rule, every parser and derivation, and the fixture mapper (`config.fetch`) are untouched. Each evidence file frozen through the Account says so at file level (`via: "account"`).

**Tech Stack:** `account/`: Node 22, TypeScript, express, vitest (`npm test`, `npm run typecheck`). `face/`: Node 22, Lunhui rows as plain `.mjs`, tests in TypeScript via tsx and `node --test` (`npm test`, `npm run typecheck`).

**Spec:** `docs/superpowers/specs/2026-11-01-account-two-parts-design.md` (§4.2, §3 goal 1 and 3 and the anti-goals, §4.5's first done-line, §6, §9 call 3, §10). Conventions from plan 1: `docs/superpowers/plans/2026-11-01-account-two-parts-plan-1-china.md`.

## Global Constraints

- The relay's allow-list is exactly: `qt.gtimg.cn` path `/q=<codes>` (no query); `web.ifzq.gtimg.cn` `/appstock/app/fqkline/get` and `/appstock/app/day/query`; `push2ex.eastmoney.com` `/getTopicZTPool`, `/getTopicZBPool`, `/getYesterdayZTPool`, `/getTopicZDFenBu`; `push2.eastmoney.com` and `push2delay.eastmoney.com` `/api/qt/clist/get`. https, default port, no user, no fragment. Anything else is refused.
- Limits no looser than Lunhui's own: 7 s and 512 KiB per relayed read, 4 s for `/appstock/app/day/query`; the iFinD route 15 s for the whole ask (exchange, query, one re-exchange, one more query) and 4 MiB per reply.
- The relay and the iFinD route answer the upstream's status, content type and bytes unchanged (plus `location` on a 3xx): no decoding, no caching, no redirect followed.
- The iFinD token (`IFIND_ACCESS_TOKEN` / `IFIND_REFRESH_TOKEN`) is read only from the Account process's environment, held only in its memory, and never appears in a reply, a log line, a refusal or a file. Lunhui sends no token and holds none.
- Anti-goal: no direct-to-upstream fallback in `face/`. A row mounted without `config.fetch` reaches only the Account; `config.fetch` (the fixture directory) and `config.now` and `config.account` are test-only keys; production rows carry no config (`face/tests/boot.test.ts` "a freeze or module row carries no config in production" stays true, `face/src/lunhui.ts` is not edited).
- The Account's address is `FACE_ACCOUNT_URL`, default `http://127.0.0.1:4820` (`http://account:4820` under compose), the variable `face/src/account-seat.ts` `seatUrl()` reads.
- Lunhui's refusal codes and words do not change: the Account unreachable or refusing is `UPSTREAM_TIMEOUT` / `UPSTREAM_TOO_LARGE` / `UPSTREAM_INVALID` like an upstream failure; no token at the Account is the boards row's existing sentence `东方财富板块请求失败（<code>）；同花顺问财备用未配置；本次未写入任何文件。`.
- Evidence items keep their shapes and ids; the provenance is one file-level field `via: "account"` on the evidence file and its `run.json` entry. `CONTRACT_VERSION` stays `"3"` (it versions the artifact validation rules, `lib/contract-core.mjs:202-207`; no contract and no role context reads a file-level field).
- No new code in `account/src/core/errors.ts`: the two routes refuse in their own words (`{ok:false, relay:<word>}`, `{ok:false, ifind:<word>}`), marked by a response header (`x-cn-relay` / `x-cn-ifind`: `upstream` or `refused`).
- Both routes are reads: they work on a `--read-only` Account and sit behind the Host fence (`server.ts:463-478`) like every `/api/` route.
- Tests are offline: the Account's routes take an injected `cn` option (absent: refused `off`, never the network); Lunhui's tests use the fixture mapper or a fake Account over it.
- `account/` suite green but for the known red `test/unit/ui-superagent.test.ts`.
- Work on `feat/two-parts-2` from local `main` in a worktree; never push; never touch `strategies/*` or a sealed run; `GRAVIT.md` untouched; `.claude/launch.json` is the operator's — the plan documents the start-line change, it does not edit the file; commit messages written to a file in the session scratchpad and committed with `git commit -F <file>`, no backticks, no attribution lines.
- Plans 3–5 are out of scope. `face/src/lunhui.ts`, `boot.ts`, `main.ts` are not edited (the last two overlap `feat/desk-p1-p4`).

## Review Focus

- **Eastmoney's one redirect, through two hops** — a clist read answered 302 with `location: https://push2delay.eastmoney.com/…` must reach `eastmoney.mjs` `request` with that status and location (the Account's fetch with `redirect: "manual"`, the adapter's too), so the members item is stamped `push2delay.eastmoney.com`, `delayed: true`, and the follow-up goes through the relay too. Tests in Task 1 (the relay keeps the location) and Task 6 (the existing redirect case rebuilt on the fake Account).
- **A GBK Tencent body through the Account** — the quote reply's bytes (with the trail byte that reads as `~`) must arrive identical; any UTF-8 decode in the relay or the adapter mangles the names. Test in Task 1 (byte identity on `face/tests/fixtures/lunhui/quotes.gb18030.txt`'s kind of bytes) and Task 6 (evidence items equal between fixture mode and Account mode).
- **The Account down, or an Account started before this plan** — ECONNREFUSED, or an express 404 page with no `x-cn-relay` header, must be a refusal (`UPSTREAM_INVALID`, nothing written, stderr naming the Account), never parsed as the upstream's reply; the boards stand-in then fails too and the refusal names both. Tests in Task 4 (adapter) and Task 6 (freeze).
- **Two freezes at once** (drill 3 caught Gravit running two modules in parallel) — the limit-up freeze's minute stage (4 in flight) plus another freeze's Eastmoney reads (4 in flight) exceed any small cap; the relay must queue past its cap, not refuse. Test in Task 1.
- **A cached iFinD token gone stale** — the Account, not Lunhui, forgets it, exchanges once and asks once more; a bare `IFIND_ACCESS_TOKEN` is never re-exchanged; the whole ask stays inside 15 s. Test in Task 2.

---

## File structure

| File | Responsibility |
|---|---|
| `account/src/portfolio/live/cn-http.ts` (modify) | `CnReply` gains `contentType?`, `location?`; `CnHttp` init gains `body?` (a POST, the iFinD route only) |
| `account/src/portfolio/live/cn-relay.ts` (new) | the allow-list (`relayTarget`), the per-target limits, the header pick, the in-flight queue: `createCnRelay` |
| `account/src/portfolio/live/cn-ifind.ts` (new) | the 问财 query's grammar, the token exchange, the cache, the one re-exchange: `createIfind` |
| `account/src/portfolio/server.ts` (modify) | `PortfolioServerOptions.cn`, the two routes, the real entry's wiring and its start line |
| `account/test/unit/cn-relay.test.ts`, `cn-ifind.test.ts`, `cn-routes.test.ts` (new) | vitest |
| `face/plugins/lunhui/lib/account-fetch.mjs` (new) | `accountOrigin`, `accountFetch`: a fetch-shaped adapter onto the two routes |
| `face/plugins/lunhui/lib/wencai.mjs` (modify) | the query and the reply's parse only; one POST, no token |
| `face/plugins/lunhui/freeze-boards-row.mjs` (modify) | no `env`; "未配置" from the Account's answer |
| `face/plugins/lunhui/lib/freeze-tool.mjs`, `lib/runs.mjs` (modify) | the adapter as the production fetch; `via` |
| `face/tests/fixtures/lunhui/account.ts` (new) | `fakeAccount`: the two routes over the fixture mapper, recording every request |
| `face/tests/lunhui-account-fetch.test.ts` (new); `lunhui-wencai.test.ts`, `lunhui-freeze.test.ts`, `lunhui-runs.test.ts`, `lunhui-contract-leader.test.ts`, `lunhui-contract-theme.test.ts`, `compose.test.ts` (modify) | |
| `face/scripts/lunhui-standin-check.mjs`, `compose.yml`, `face/src/agents.ts` (comment), `face/README.md`, `account/README.md`, `DEVELOPMENT.md`, `CLAUDE.md` (modify) | the live check, the boxes' env, the documents |

---

### Task 1: The relay in the Account

**Files:**
- Modify: `account/src/portfolio/live/cn-http.ts`
- Create: `account/src/portfolio/live/cn-relay.ts`
- Test: `account/test/unit/cn-relay.test.ts`; `account/test/unit/cn-http.test.ts` (one case added)

**Interfaces:**
- Consumes: `CnHttp`, `CnReply`, `cnHosts`, `realCnHttp` (plan 1, `cn-http.ts`).
- Produces:
  ```ts
  // cn-http.ts (additions; plan 1's callers unchanged)
  export interface CnReply { status: number; bytes: Uint8Array; contentType?: string; location?: string }
  export type CnHttp = (url: string, init: { timeoutMs: number; maxBytes: number; headers?: Record<string, string>; body?: string }) => Promise<CnReply>;
  // realCnHttp: method POST when body is given, else GET; contentType from the reply's content-type, location from its location header
  // cn-relay.ts
  export const RELAY_TIMEOUT_MS = 7_000, MINUTES_TIMEOUT_MS = 4_000, RELAY_MAX_BYTES = 512 * 1024, RELAY_IN_FLIGHT = 16, RELAY_URL_MAX = 2_048;
  export const RELAY_HOSTS: readonly string[]; // the five hosts of Global Constraints
  export const RELAY_HEADERS: readonly ["accept", "referer", "user-agent"];
  export interface RelayTarget { url: string; timeoutMs: number; maxBytes: number }
  export function relayTarget(raw: string): RelayTarget | null;
  export type RelayWord = "not-listed" | "timeout" | "too-large" | "unreachable";
  export type RelayAnswer =
    | { kind: "upstream"; status: number; contentType?: string; location?: string; bytes: Uint8Array }
    | { kind: "refused"; word: RelayWord };
  export type CnRelay = (url: string, headers: Record<string, string>) => Promise<RelayAnswer>;
  export function createCnRelay(http: CnHttp, opts?: { inFlight?: number }): CnRelay;
  ```

- [ ] **Step 1: Write the failing tests** in `cn-relay.test.ts` (vitest, the style of `test/unit/cn-http.test.ts`):
  - `relayTarget takes exactly the rows' endpoints` — accepted, with their limits: `https://qt.gtimg.cn/q=sh000001,sz399001,sh600519` (7 000, 524 288); `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,60,qfq` (7 000); `https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh000001` (4 000); `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt:asc&date=20261023`, and the same for `getTopicZBPool`, `getYesterdayZTPool`, `getTopicZDFenBu`; `https://push2.eastmoney.com/api/qt/clist/get?fs=m:90+t:3+f:!50&pz=30`; `https://push2delay.eastmoney.com/api/qt/clist/get?fs=b:BK0715`. Refused (`null`): `http://qt.gtimg.cn/q=sh000001`, `https://qt.gtimg.cn:8443/q=x`, `https://u:p@qt.gtimg.cn/q=x`, `https://qt.gtimg.cn/q=sh000001?x=1`, `https://qt.gtimg.cn/q=sh000001#a`, `https://qt.gtimg.cn/q=../x`, `https://smartbox.gtimg.cn/s3/?q=x`, `https://push2ex.eastmoney.com/getTopicDTPool`, `https://push2delay.eastmoney.com/getTopicZTPool`, `https://quantapi.51ifind.com/api/v1/smart_stock_picking`, `https://17.push2.eastmoney.com/api/qt/clist/get`, `not a url`, and any URL longer than `RELAY_URL_MAX`.
  - `the relay answers the upstream's status, type, location and bytes unchanged` — a stub `CnHttp` answering `{status: 200, contentType: "text/plain; charset=GBK", bytes}` where `bytes` is `new Uint8Array([0x76, 0x5f, 0xd2, 0x7e, 0x7e])` (a GBK lead byte followed by `~`): the answer's `bytes` equal byte for byte; a stub answering `{status: 302, location: "https://push2delay.eastmoney.com/api/qt/clist/get?fs=b:BK0715", bytes: new Uint8Array()}` comes back 302 with that location and is asked exactly once (no follow); a 404 comes back 404 (the upstream's status is not a refusal).
  - `the relay asks with the target's limits and three headers only` — the stub records `init`: for a fqkline URL `{timeoutMs: 7000, maxBytes: 524288}`, for a day/query URL `timeoutMs: 4000`; headers passed `{accept, referer, "user-agent", cookie, authorization, "x-forwarded-for"}` reach the stub as `{accept, referer, "user-agent"}` only, each value cut at 256 characters and dropped if it holds CR or LF.
  - `refusals are words` — an unlisted URL never reaches the stub and answers `{kind: "refused", word: "not-listed"}`; a stub throwing `Error("timeout")` → `timeout`; `Error("too-large")` → `too-large`; any other throw (`new TypeError("fetch failed")`) → `unreachable`.
  - `past its cap the relay queues, never refuses` — `createCnRelay(stub, {inFlight: 2})` with a stub that holds each call until released: three asks → the stub sees two; releasing one lets the third in; all three answer `upstream`.
  - In `cn-http.test.ts`: `cnHosts passes a POST body through` — `init.body` reaches the wrapped `CnHttp` unchanged.
- [ ] **Step 2: Run them and see them fail.** `cd account && npx vitest run test/unit/cn-relay.test.ts test/unit/cn-http.test.ts` — FAIL: module not found.
- [ ] **Step 3: Implement.** `cn-http.ts`: the two optional reply fields and `body` (the header comment says POST only when a body is given, the iFinD route's alone). `cn-relay.ts`: `relayTarget` parses with `new URL`, checks protocol/user/port/hash/length and the host→paths table (`qt.gtimg.cn` pathname `/^\/q=[A-Za-z0-9_,]{1,1024}$/` and an empty search; the others by exact pathname); `createCnRelay` wraps `http` in `cnHosts(http, RELAY_HOSTS)` and a FIFO slot queue of `inFlight` (default `RELAY_IN_FLIGHT`).
- [ ] **Step 4: Run them and see them pass**, then `npm run typecheck`. Expected: PASS, no type errors; plan 1's `china.test.ts` and `cn-*.test.ts` still pass.
- [ ] **Step 5: Commit.** Message: `feat(account): the A-share relay - the Lunhui rows' endpoints, raw bytes, no redirect followed`.

---

### Task 2: The iFinD client in the Account

**Files:**
- Create: `account/src/portfolio/live/cn-ifind.ts`
- Test: `account/test/unit/cn-ifind.test.ts` (the token cases of `face/tests/lunhui-wencai.test.ts` ported to vitest)

**Interfaces:**
- Consumes: `CnHttp` with `body` (Task 1).
- Produces:
  ```ts
  export const IFIND_HOST = "quantapi.51ifind.com";
  export const IFIND_DEADLINE_MS = 15_000, IFIND_MAX_BYTES = 4 * 1024 * 1024, TOKEN_TTL_MS = 6 * 24 * 3600 * 1000;
  /** the boards stand-in's one query (wencai.mjs), its date the only part that varies */
  export const IFIND_QUERY = /^A股 \d{4}年\d{2}月\d{2}日涨跌幅 成交额 主力资金流向 所属概念$/;
  export type IfindWord = "unconfigured" | "credential" | "timeout" | "too-large" | "unreachable";
  export type IfindAnswer =
    | { kind: "upstream"; status: number; contentType?: string; bytes: Uint8Array }
    | { kind: "refused"; word: IfindWord };
  export interface CnIfind { configured(): boolean; ask(query: string): Promise<IfindAnswer> }
  export function createIfind(opts: { env: () => Record<string, string | undefined>; http: CnHttp; now?: () => number }): CnIfind;
  ```
  The rules are `wencai.mjs`'s, moved: `IFIND_ACCESS_TOKEN` used as it is and never re-exchanged; else `IFIND_REFRESH_TOKEN` exchanged at `POST https://quantapi.51ifind.com/api/v1/get_access_token` (header `refresh_token`), the token taken from `data.access_token` of an `errorcode: 0` reply and cached in the instance's memory for `TOKEN_TTL_MS`; the query is `POST …/smart_stock_picking`, header `access_token`, body `{"searchstring": <query>, "searchtype": "stock"}`. A reply asked with the CACHED token that is not (HTTP 200 and `errorcode` 0) — a nonzero errorcode, a 401/403, a body that is not JSON — forgets the cache, exchanges once and asks once more. The last reply is answered as `upstream`, its status and bytes unchanged, whatever its errorcode (Lunhui reads it). Every call's `timeoutMs` is what is left of `IFIND_DEADLINE_MS` since `ask` began (at least 1 ms; none left → `timeout`), `maxBytes` `IFIND_MAX_BYTES`, headers `Content-Type: application/json`, `Accept: application/json`.

- [ ] **Step 1: Write the failing tests** (a recording stub `CnHttp`, its replies scripted per path and per call; `now` injected):
  - `no token is unconfigured, and nothing is asked` — `env: () => ({})` → `configured()` false, `ask` → `{kind: "refused", word: "unconfigured"}`, the stub never called.
  - `a refresh token is exchanged once, then the query asked with the access token` — paths `["/api/v1/get_access_token", "/api/v1/smart_stock_picking"]`, the first's `refresh_token` header the env's, the second's `access_token` the exchanged one, its body `{"searchstring":"A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念","searchtype":"stock"}`; the answer `upstream` with the query reply's exact bytes.
  - `the access token is cached for six days` — a second `ask` asks only `smart_stock_picking`; with `now` moved past `TOKEN_TTL_MS` it exchanges again.
  - `a cached token answered nonzero is exchanged once and asked once more` — second ask: query answers `{"errorcode":-1010}`, exchange answers a new token, query answers `{"errorcode":0,…}` → paths `[query, exchange, query]`, the second query with the new token, the answer that second reply.
  - `the retry's own refusal is answered unchanged, not retried again` — both queries nonzero → three calls, the answer the second query's bytes.
  - `a freshly exchanged token answered nonzero is not exchanged again` and `a bare IFIND_ACCESS_TOKEN is never exchanged` — one query, answered as it came.
  - `a 401 on the cached token re-exchanges like a nonzero errorcode`.
  - `an exchange refused is credential` — exchange `{"errorcode":-1302}`, or HTTP 403, or no `data.access_token` → `credential`; the query never asked.
  - `the whole ask is bounded by 15 s` — with `now` advancing 10 s per stub call, the second call's `timeoutMs` is 5 000 and a third call is never made (`timeout`).
  - `timeouts and sizes are words; nothing carries a token` — stub throwing `Error("timeout")` → `timeout`, `Error("too-large")` → `too-large`, a `TypeError` → `unreachable`; `JSON.stringify(answer)` of every refused answer contains neither token string.
- [ ] **Step 2: Run them and see them fail.** `cd account && npx vitest run test/unit/cn-ifind.test.ts` — FAIL: module not found.
- [ ] **Step 3: Implement `createIfind`** in `cn-ifind.ts` (the cache a closure variable of the instance; JSON parsed only to read `errorcode` and `data.access_token`).
- [ ] **Step 4: Run them and see them pass**, then `npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(account): the iFinD client - the token, its cache and its one re-exchange, moved from Lunhui`.

---

### Task 3: The two routes, the server's wiring and its start line

**Files:**
- Modify: `account/src/portfolio/server.ts` (`PortfolioServerOptions`; the routes after the fence and JSON parser, server.ts:463-485, beside the other `/api/` routes; the entry at server.ts:1138-1150)
- Modify: `account/README.md`
- Test: `account/test/unit/cn-routes.test.ts`

**Interfaces:**
- Consumes: `createCnRelay`, `CnRelay`, `RelayAnswer`, `RELAY_URL_MAX` (Task 1); `createIfind`, `CnIfind`, `IFIND_QUERY`, `IFIND_HOST` (Task 2); `realCnHttp`, `cnHosts` (plan 1).
- Produces (what Task 4's adapter relies on — the wire):
  ```ts
  export interface PortfolioServerOptions { /* … */ cn?: { relay: CnRelay; ifind: CnIfind } | undefined }
  ```
  - `GET /api/cn/relay?url=<encoded upstream URL>` — upstream: the upstream's status, header `x-cn-relay: upstream`, `content-type` the upstream's (else `application/octet-stream`), `location` when the status is 3xx and the upstream gave one, body the bytes. Refused: header `x-cn-relay: refused`, JSON `{ok:false, relay:<word>}`, status `not-listed` 403, `timeout` 504, `too-large` 502, `unreachable` 502, `off` 503 (no `cn`). A `url` absent, given twice, or longer than `RELAY_URL_MAX` is `not-listed` and nothing is asked. Only the caller's `accept`, `referer`, `user-agent` are passed to the relay.
  - `POST /api/cn/ifind` body `{"query": <string>}` — upstream: header `x-cn-ifind: upstream`, iFinD's status, content type and bytes. Refused: header `x-cn-ifind: refused`, JSON `{ok:false, ifind:<word>}`, status `unconfigured` 503, `credential` 502, `timeout` 504, `too-large` 502, `unreachable` 502, `not-the-query` 400 (a body whose `query` is not a string matching `IFIND_QUERY`), `off` 503.
  - The real entry passes `cn: { relay: createCnRelay(realCnHttp), ifind: createIfind({ env: () => process.env, http: cnHosts(realCnHttp, [IFIND_HOST]) }) }` (classic or not, `--read-only` or not) and prints one line after "your account at …": `Lunhui's reach: /api/cn/relay (Tencent, Eastmoney) · iFinD configured` or `… · iFinD not configured (IFIND_REFRESH_TOKEN or IFIND_ACCESS_TOKEN in this process's environment)`.

- [ ] **Step 1: Write the failing tests** — `startPortfolioServer({port: 0, service, cn})` over the `service()` of `test/unit/server-guard.test.ts` (copy its three lines), `cn` built from stub `CnRelay` / `CnIfind` that record what they are given:
  - `the relay route passes the upstream through` — stub answers `{kind:"upstream", status: 302, location: "https://push2delay.eastmoney.com/x", bytes: new Uint8Array()}`: `fetch(…/api/cn/relay?url=${encodeURIComponent(u)}, {redirect: "manual"})` → 302, `x-cn-relay: upstream`, that location; a 200 GBK answer → the same bytes (`new Uint8Array(await r.arrayBuffer())`) and its content type; the stub received `u` decoded exactly and headers `{accept, referer, "user-agent"}` only (a `cookie` sent is not among them).
  - `the relay route's refusals` — no `url`, `url` twice, a 2 049-character url → 403 `{ok:false, relay:"not-listed"}`, header `refused`, stub not called; stub refusals map to 504/502/502; a server started without `cn` → 503 `{ok:false, relay:"off"}`.
  - `the iFinD route asks only the stand-in's query` — `{"query":"A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念"}` reaches the stub and its upstream answer (status 200, bytes) comes back with `x-cn-ifind: upstream`; `{"query":"A股 茅台"}`, `{"query": 1}`, no body → 400 `not-the-query`, stub not called; each refused word maps to its status; no `cn` → 503 `off`.
  - `both routes are behind the fence` — `origin: https://evil.example` → 403 before either stub is called; `host: account:4820` with `hosts: ["account:4820"]` → answered.
  - `both routes answer on a read-only service` — `PortfolioService.create` as `server-guard`'s (no `liveWrites`) answers the relay route 200.
- [ ] **Step 2: Run them and see them fail.** `cd account && npx vitest run test/unit/cn-routes.test.ts` — FAIL: 404s.
- [ ] **Step 3: Implement** the option, the two routes (each inside `wrap`; the query read directly from `req.query.url`, not through `strings()`, which would cut an over-long URL into another), and the entry's wiring and start line.
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck` — green but the known red.
- [ ] **Step 5: Document.** `account/README.md`: one bullet after "Markets" — "Lunhui's reach: `GET /api/cn/relay?url=` forwards the Lunhui freezes' Tencent and Eastmoney GETs (an allow-list of their endpoints, the bytes unchanged) and `POST /api/cn/ifind` runs the boards stand-in's 问财 query with the iFinD token this process holds (`IFIND_REFRESH_TOKEN` or `IFIND_ACCESS_TOKEN` in its environment; start it with `set -a; [ ! -f ../.env.ifind ] || . ../.env.ifind; set +a; npm run account`)", and under "In the box" that the box reads `.env.ifind` (Task 7's compose line).
- [ ] **Step 6: Commit.** Message: `feat(account): /api/cn/relay and /api/cn/ifind, behind the fence, read-only`.

---

### Task 4: Lunhui's adapter onto the Account

**Files:**
- Create: `face/plugins/lunhui/lib/account-fetch.mjs`
- Test: `face/tests/lunhui-account-fetch.test.ts`

**Interfaces:**
- Consumes: the wire of Task 3 (paths, headers `x-cn-relay` / `x-cn-ifind`, the refusal words).
- Produces:
  ```js
  export const DEFAULT_ACCOUNT_URL = "http://127.0.0.1:4820";
  export const WENCAI_QUERY_URL = "https://quantapi.51ifind.com/api/v1/smart_stock_picking";
  /** the codes the adapter throws for the iFinD route's two answers Lunhui words itself */
  export const IFIND_UNCONFIGURED = "IFIND_UNCONFIGURED", IFIND_CREDENTIAL = "IFIND_CREDENTIAL";
  /** an http(s) URL with no user, path other than "/", query or fragment → its origin; else TypeError naming what was wrong */
  export function accountOrigin(raw) { /* → string */ }
  /** @returns {(url: string | URL, init?: RequestInit) => Promise<Response>} */
  export function accountFetch(origin, { fetchImpl = (u, i) => globalThis.fetch(u, i) } = {}) {}
  ```
  `fetchImpl` is read at call time (tests mock `globalThis.fetch`). The adapter's behaviour:
  - A GET (no `init.method`, or `GET`) of any URL → `GET <origin>/api/cn/relay?url=<encodeURIComponent(url)>`, with `init.signal`, `redirect: "manual"`, and of `init.headers` (a plain object or `Headers`, any case) only `accept`, `referer`, `user-agent`.
    - `x-cn-relay: upstream` → that response, returned as it is; except a 3xx when `init.redirect` is not `"manual"`, which throws a plain `TypeError("redirect refused")` (what `fetch` with `redirect: "error"` does — Tencent's reads use it).
    - `x-cn-relay: refused` → by its `relay` word: `timeout` throws `Object.assign(new Error(…), {code: "PROVIDER_TIMEOUT"})`, `too-large` `{code: "RESPONSE_TOO_LARGE"}`, any other word a plain `Error` naming the word.
    - No `x-cn-relay` header (an Account older than this plan, or anything else on that port) → a plain `Error("the Account at <origin> answered without its relay (HTTP <status>): restart it from this tree")`.
    - The request rejecting because `init.signal` aborted → rethrown as it is; rejecting otherwise → a plain `Error("the Account at <origin> did not answer", {cause})`.
  - A POST to exactly `WENCAI_QUERY_URL` → its JSON body's `searchstring` sent as `POST <origin>/api/cn/ifind`, body `{"query": searchstring}`, `content-type: application/json`, the signal; no other header and no other body field. `x-cn-ifind: upstream` → that response; refused `unconfigured` → `{code: IFIND_UNCONFIGURED}`, `credential` → `{code: IFIND_CREDENTIAL}`, `timeout` / `too-large` as above, others plain; no header and a rejection as above.
  - Anything else (another method, another POST URL, `get_access_token` among them) → a plain `Error("the Account relays GETs and the one 问财 query only")`, nothing sent.
  Plain errors carry no code, so `errors.mjs` `upstreamError` words them `UPSTREAM_INVALID` "请求未完成（连接失败或响应中断）" and writes the message (naming the Account) to stderr — the existing path (errors.mjs:176-188).

- [ ] **Step 1: Write the failing tests** (`node:test`; a recording `fetchImpl` returning scripted `Response`s):
  - `accountOrigin takes an origin and nothing else` — `http://127.0.0.1:4820` and `http://account:4820/` → origins; `ftp://x`, `http://u:p@h`, `http://h/api`, `http://h?x=1`, `""`, `42` → TypeError.
  - `a GET goes to the relay with the upstream URL and three headers` — upstream `https://push2.eastmoney.com/api/qt/clist/get?fs=m:90+t:3&fid0=f62` with headers `{Accept, Referer, "User-Agent", Cookie}` → one request to `http://127.0.0.1:4820/api/cn/relay?url=` + the encoded URL (`new URL(sent).searchParams.get("url")` equals the upstream exactly), `redirect: "manual"`, the same signal, headers `accept`, `referer`, `user-agent` only.
  - `the upstream's answer comes back unchanged` — a scripted `x-cn-relay: upstream` 200 with GBK bytes → `new Uint8Array(await r.arrayBuffer())` equal; a 302 with a location and `init.redirect: "manual"` → status 302, `headers.get("location")` kept; the same 302 with `redirect: "error"` → rejects TypeError; a 404 upstream → resolves 404.
  - `the relay's refusals become the codes fetchBytes knows` — `timeout` → rejects `code: "PROVIDER_TIMEOUT"`; `too-large` → `code: "RESPONSE_TOO_LARGE"`; `not-listed` → rejects with no `code`.
  - `an Account without the relay, or none at all, is a code-less failure naming the Account` — a 404 with no `x-cn-relay` → rejects, no `code`, message names `http://127.0.0.1:4820`; a `fetchImpl` rejecting `TypeError("fetch failed")` → rejects, no `code`, `cause` kept.
  - `the 问财 query goes to the iFinD route, its token-free body only` — `POST WENCAI_QUERY_URL` with body `{"searchstring":"A股 …","searchtype":"stock"}` and an `access_token` header → one request `POST …/api/cn/ifind`, body exactly `{"query":"A股 …"}`, no `access_token` or `refresh_token` header; `unconfigured` → `code: "IFIND_UNCONFIGURED"`; `credential` → `code: "IFIND_CREDENTIAL"`.
  - `nothing else is sent` — a POST to `https://quantapi.51ifind.com/api/v1/get_access_token`, a PUT, a POST to a Tencent URL → reject, `fetchImpl` never called.
  - `an aborted signal aborts the Account's request` — the scripted `fetchImpl` waits on `init.signal`; aborting rejects with the signal's reason.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --import tsx --test tests/lunhui-account-fetch.test.ts` — FAIL: module not found.
- [ ] **Step 3: Implement `account-fetch.mjs`** (a header comment in the style of `lib/fixture-fetch.mjs`: what goes where, and that it is the only production fetch of the four freezes).
- [ ] **Step 4: Run them and see them pass**, then `npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(lunhui): the Account adapter - a fetch onto the relay and the iFinD route`.

---

### Task 5: The 问财 client holds no token; the boards row asks the Account

**Files:**
- Modify: `face/plugins/lunhui/lib/wencai.mjs`, `face/plugins/lunhui/freeze-boards-row.mjs`, `face/scripts/lunhui-standin-check.mjs`
- Test: `face/tests/lunhui-wencai.test.ts` (rewritten), `face/tests/lunhui-freeze.test.ts` (the boards stand-in cases at :450-617), `face/tests/lunhui-contract-leader.test.ts:446`, `face/tests/lunhui-contract-theme.test.ts:27` (their `env` dropped)

**Interfaces:**
- Consumes: `IFIND_UNCONFIGURED`, `IFIND_CREDENTIAL`, `accountFetch`, `accountOrigin`, `DEFAULT_ACCOUNT_URL` (Task 4).
- Produces:
  ```js
  // wencai.mjs — removed: resetWencaiToken, hasWencaiCredentials, the cache, the exchange, the env
  export const WENCAI_PROVIDER = "同花顺问财";
  export const WENCAI_NOT_CONFIGURED = "NOT_CONFIGURED";
  /** @param {{ session: string, fetchImpl?: Function, timeoutMs?: number, maxBytes?: number }} options */
  export async function fetchWencaiUniverse(options) {} // same return shape as today
  ```
  One `POST https://quantapi.51ifind.com/api/v1/smart_stock_picking`, headers `Content-Type` and `Accept` only, body `{searchstring, searchtype: "stock"}`, through `fetchBytes` with 15 s and 4 MiB as today. Error words as today, plus: a rejection coded `IFIND_UNCONFIGURED` → `new LunhuiError(WENCAI_NOT_CONFIGURED, "同花顺问财未配置（账户没有 iFinD 凭据）；本次未写入任何文件。")`; coded `IFIND_CREDENTIAL` → `UPSTREAM_INVALID` "同花顺问财凭据被拒（令牌换取未通过）"; a 401/403 or a `TOKEN_ERRORCODES` reply → "凭据被拒（访问令牌无效）" as today. The boards row's `freezeStandIn` drops its credential pre-check and turns a `WENCAI_NOT_CONFIGURED` refusal into today's exact sentence `${EASTMONEY}板块请求失败（${code}）；${WENCAI_PROVIDER}备用未配置；本次未写入任何文件。` with Eastmoney's code; `apply` refuses any `config.env` with `lunhui-freeze-boards: env is gone - the iFinD token is the Account's (IFIND_* in the Account's environment)`.

- [ ] **Step 1: Rewrite the failing tests.**
  - `lunhui-wencai.test.ts`: keep `rows carry six-digit codes and split concepts`, the `sha256 …` case and the refusal table of `no token, an errorcode, missing columns, …` (minus its no-token row), over the fixture mapper with no env; replace the four token cases with `a universe is one query, the session's date in it, and no token` (calls `["/api/v1/smart_stock_picking"]`, no `access_token`/`refresh_token` header, the body's `searchstring` and `searchtype`), `the Account without a token is NOT_CONFIGURED` (a `fetchImpl` rejecting `{code: "IFIND_UNCONFIGURED"}` → `LunhuiError` code `NOT_CONFIGURED`, message names 同花顺问财), `a refused exchange at the Account is 凭据被拒` (`{code: "IFIND_CREDENTIAL"}` → `UPSTREAM_INVALID`, `/凭据被拒/`), `a 401 is 凭据被拒（访问令牌无效）`. The four token cases' behaviour lives on in Task 2.
  - `lunhui-freeze.test.ts`: every `{ boards: { env: IFIND_ENV } }` becomes no config beyond the fixtures; `resetWencaiToken` imports and calls go; `with no iFinD token a refused Eastmoney read refuses naming both …` keeps its assertions (code `UPSTREAM_INVALID`, `/东方财富板块请求失败（UPSTREAM_INVALID）/`, `/同花顺问财备用未配置/`, only `metrics.json` and `run.json` in the run) with its `smart_stock_picking` request answered by a rejection coded `IFIND_UNCONFIGURED` (until Task 6 moves it onto the fake Account); `the iFinD token is in no file …` becomes `no token travels: the stand-in's request carries none and no file names one` (the recorded POST has no `access_token`/`refresh_token` header; no file under `cn-market` matches `/access_token|refresh_token/`); `a boards row refuses an env that is not an object` becomes `a boards row refuses any env, naming the Account` (`{env: {}}` throws `/lunhui-freeze-boards: env is gone/`).
  - The two contract tests: drop `env` from `boardsConfig` / the theme row's config.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --import tsx --test tests/lunhui-wencai.test.ts tests/lunhui-freeze.test.ts tests/lunhui-contract-leader.test.ts tests/lunhui-contract-theme.test.ts` — FAIL: the request still carries a token; `env` still accepted.
- [ ] **Step 3: Implement** the shrunk `wencai.mjs` (its header comment: the token, the cache and the re-exchange are the Account's, `account/src/portfolio/live/cn-ifind.ts`), the boards row, and the live check: `lunhui-standin-check.mjs` builds `accountFetch(accountOrigin(process.env.FACE_ACCOUNT_URL || DEFAULT_ACCOUNT_URL))`, passes it as `fetchImpl`, exits 2 on `NOT_CONFIGURED` ("the Account holds no iFinD token: start it with .env.ifind sourced"), its usage line `cd face && node scripts/lunhui-standin-check.mjs` (the Account running).
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `refactor(lunhui): the 问财 client holds no token - the Account asks iFinD`.

---

### Task 6: The four freezes fetch through the Account

**Files:**
- Modify: `face/plugins/lunhui/lib/freeze-tool.mjs` (`freezeDeps` :74-88, `defineFreeze` :137 where it calls `addEvidence`), `face/plugins/lunhui/lib/runs.mjs` (`optionalMeta`, the `EvidenceMeta` typedef :620-621)
- Create: `face/tests/fixtures/lunhui/account.ts`
- Test: `face/tests/lunhui-freeze.test.ts` (`mockFetch` :119-132 and the redirect case :421-437 rebuilt; new cases), `face/tests/lunhui-runs.test.ts` (one case)

**Interfaces:**
- Consumes: `accountFetch`, `accountOrigin`, `DEFAULT_ACCOUNT_URL` (Task 4); `createFixtureFetch` (unchanged).
- Produces:
  ```js
  // freeze-tool.mjs
  /** config.fetch (fixtures) and config.account are exclusive; without fetch, fetchImpl is accountFetch(origin) with origin
   * accountOrigin(config.account ?? (process.env.FACE_ACCOUNT_URL || DEFAULT_ACCOUNT_URL)), read at mount; a bad one throws naming the row */
  export function freezeDeps(rowName, ctx, config) {} // → { runs, fetchImpl, now, via?: "account" }
  // defineFreeze({ …, via }) adds `via` to the meta it hands addEvidence when given
  // runs.mjs: EvidenceMeta gains via?: "account" — stamped on the evidence file and listed on its run.json entry; any other value is a TypeError
  ```
  ```ts
  // tests/fixtures/lunhui/account.ts
  export function fakeAccount(dir: string, opts?: { origin?: string; ifind?: "configured" | "unconfigured"; stall?: (upstream: URL) => boolean;
    upstream?: (target: URL, init?: RequestInit) => Promise<Response> | undefined }): {
    fetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
    sent: URL[];        // every request, as sent
    upstream: URL[];    // the relayed upstream URLs, decoded
    queries: string[];  // the iFinD route's bodies' query
    reached: Promise<void>;
  };
  ```
  `fakeAccount` answers `GET <origin>/api/cn/relay?url=` with the fixture mapper's (or `opts.upstream`'s) response for the decoded URL, its status and body, `content-type` and `location` kept, header `x-cn-relay: upstream` (a stalled one waits on the signal, as `mockFetch` does today); `POST <origin>/api/cn/ifind` with `wencai-universe.json`'s bytes and `x-cn-ifind: upstream`, or 503 `{ok:false, ifind:"unconfigured"}` with `x-cn-ifind: refused`; anything else 404 with no header. `origin` defaults to `DEFAULT_ACCOUNT_URL`.

- [ ] **Step 1: Write the failing tests.**
  - `mockFetch(t, dir, stall)` becomes `t.mock.method(globalThis, "fetch", fakeAccount(dir, {stall}).fetch)` and returns `{ urls: upstream, sent, queries, reached }`, so every existing case that counts upstream hosts keeps its assertions; the redirect case (:421) passes its 302 through `opts.upstream`; the no-token case of Task 5 uses `fakeAccount(dir, {ifind: "unconfigured"})` and asserts `queries.length === 1` where it asserted no QuantAPI URL.
  - `freeze: every request the four freezes make goes to the Account, and only there` — mount the four rows with no `config.fetch`; freeze quotes (`symbols: ["sh000001", "sh600519"]`), limit-up, index, and boards with `boards.json` removed (the stand-in) in one run; assert every `sent` URL's origin is `http://127.0.0.1:4820` and its path `/api/cn/relay` or `/api/cn/ifind`; the decoded `upstream` hosts are exactly `{qt.gtimg.cn, web.ifzq.gtimg.cn, push2ex.eastmoney.com, push2.eastmoney.com}` and `queries` holds the one 问财 query.
  - `freeze: FACE_ACCOUNT_URL names the Account` — with `config.account` `"http://account:4820"` (and, separately, `process.env.FACE_ACCOUNT_URL` set for the mount through `t.mock` / a restored assignment) every `sent` origin is that one.
  - `freeze: frozen through the Account, the evidence is the fixture's, with via at file level` — the same source frozen in two runs, one `config.fetch` over `dir`, one through `fakeAccount(dir)`: `items` (ids included) deepEqual; the Account run's evidence file and its `run.json` entry carry `via: "account"`, the fixture run's carry no `via`.
  - `freeze: the Account down is a refusal like an upstream failure, and writes nothing` — `globalThis.fetch` rejecting `TypeError("fetch failed")`: quotes → `UPSTREAM_INVALID`; boards → `UPSTREAM_INVALID` naming 东方财富 and 同花顺问财; each run holds only `metrics.json` and `run.json`, and `metrics.json` `refusals` lists the code.
  - `freeze rows: a bad account address or fetch with account refuses the mount, naming the row` — `{account: "http://h/api"}` and `{fetch: dir, account: "http://127.0.0.1:4820"}` throw `/lunhui-freeze-quotes:/`.
  - `lunhui-runs.test.ts`: `addEvidence refuses a via that is not "account"` (`via: "direct"` → TypeError) and `records via on the file and its run.json entry`.
- [ ] **Step 2: Run them and see them fail.** `cd face && node --import tsx --test tests/lunhui-freeze.test.ts tests/lunhui-runs.test.ts` — FAIL: requests go straight to the upstream hosts; no `via`.
- [ ] **Step 3: Implement** `freezeDeps`, `defineFreeze`'s `via` and `optionalMeta`'s `via`; update the header comments (`freeze-tool.mjs`: the production fetch is the Account's; `freezeDeps`' JSDoc).
- [ ] **Step 4: Run them and see them pass**, then the whole face suite: `npm test && npm run typecheck` — green, the market-run and strategy-run smokes included (they freeze from `config.fetch` and are unchanged); `CONTRACT_VERSION` still `"3"` (`grep -n 'CONTRACT_VERSION = "3"' plugins/lunhui/lib/contract-core.mjs`).
- [ ] **Step 5: Commit.** Message: `feat(lunhui): the four freezes fetch through the Account; evidence says via account`.

---

### Task 7: The boxes' environment and the documents

**Files:**
- Modify: `compose.yml`, `face/tests/compose.test.ts`, `face/src/agents.ts` (the comment above `SCRUBBED_ENV`, :108-114)
- Modify: `face/README.md` (Run :50-62; the Lunhui egress table :561-569 and the stand-in paragraph :595-612), `DEVELOPMENT.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above; changes no code path.

- [ ] **Step 1: Write the failing compose assertions** in `compose.test.ts`: `c.services.account.env_file` deepEquals `[{ path: ".env.ifind", required: false }]`; the agent's `env_file` stays `[{ path: ".env.deepseek", required: false }]` (already asserted) and no agent `environment` key starts with `IFIND`.
- [ ] **Step 2: Run it and see it fail.** `cd face && node --import tsx --test tests/compose.test.ts` — FAIL: no `env_file` on account.
- [ ] **Step 3: Change `compose.yml`** — the account service gains `env_file: [{path: .env.ifind, required: false}]` with a comment: the iFinD token is the Account's alone (`/api/cn/ifind`); the agent box never reads it. `agents.ts`: the comment says the face no longer reads `IFIND_*` (the Account holds the token) and the names stay scrubbed because an operator's shell may still carry them, as the `APCA_*` pair; the list itself is unchanged.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Rewrite the documents**, present tense:
  - `face/README.md` Run: the face's start sources `.env.deepseek` only — drop the "Optional iFinD credentials" lines; say the operator's untracked `.claude/launch.json` face line drops `[ ! -f ../.env.ifind ] || . ../.env.ifind;` and its account line becomes `cd …/account || exit 1; set -a; [ ! -f ../.env.ifind ] || . ../.env.ifind; set +a; exec npm run account -- --read-only` (and the Account must be restarted from this tree, or every freeze refuses `UPSTREAM_INVALID` naming the Account). The egress table: the face process reaches no Tencent, Eastmoney or iFinD host; the Account reaches them for the freezes through `/api/cn/relay` and `/api/cn/ifind` (the allow-list and limits of Task 1 and Task 3). The stand-in paragraph: "备用未配置" when the Account holds no token; `via: "account"` on each evidence file; `scripts/lunhui-standin-check.mjs` goes through the Account.
  - `DEVELOPMENT.md`: the Lunhui tools row (:344, the freezes' fetch through the Account, `via`), the environment table rows for `IFIND_*` (:1752, :5018 → the Account's environment, `account/src/portfolio/live/cn-ifind.ts`) and `FACE_ACCOUNT_URL` (:1751, :5009 → the Lunhui freezes too), the scrub paragraph (:1760, :1775), risk R1b (:4303-4305: the token file is now sourced by the Account's start; the face's environment holds no token), the Account section §3.9 (the two routes), the iFinD egress line (:4666), §10 item 22 (the relay and the iFinD route built; AKShare left for plan 3); the `cd account && npm test` counts as measured.
  - `CLAUDE.md`: the `face/` row's Lunhui sentence says the rows fetch through the Account's relay; the `account/` row names `/api/cn/relay` and `/api/cn/ifind` among its routes. One clause each; the file stays its length.
  - Find stragglers: `grep -rn "IFIND\|ifind\|quantapi\|hasWencaiCredentials\|resetWencaiToken" CLAUDE.md DEVELOPMENT.md face/README.md account/README.md face/plugins face/scripts face/src` — every hit describing the tree as it now is is true; dated history stays.
- [ ] **Step 6: Verify.** `cd account && npm test && npm run typecheck`; `cd face && npm test && npm run typecheck` — green (the account suite but its known red).
- [ ] **Step 7: Commit.** Message: `docs: the Lunhui freezes reach their hosts through the Account; the iFinD token is the Account's`.

---

## Owed after the build (the operator's, or mine on the operator's go-ahead)

A live market run through the Account (spec §4.5, §8): restart the host Account from this tree with `.env.ifind` sourced and the face without it; `lunhui_freeze_*` in `cn-market`; the run seals with the same artifacts, each evidence file `via: "account"`; `node scripts/lunhui-standin-check.mjs` prints the stand-in's boards.

## Self-review notes (run 2026-11-01)

- Spec §4.2 coverage: the relay (Tasks 1, 3), the iFinD route with the cache and one re-exchange (Tasks 2, 3), Lunhui's adapter at `FACE_ACCOUNT_URL` (Tasks 4, 6), parsers/derivations/contracts/fixture mapper unchanged (Task 6's equal-items test; `fixture-fetch.mjs` not edited), the iFinD variables out of the face's environment (Tasks 5, 7), provenance (Task 6), failure as a refusal (Tasks 4, 6), "备用未配置" exactly (Tasks 5, 6). §4.5's done line: Task 6's every-request test. Anti-goal (no fallback): Global Constraints, Task 6 (no production path reaches an upstream host). §3 goal 1's "the iFinD token lives only where the Account runs": Tasks 2, 5, 7.
- Calls made where the spec left them to the builder (§10): the relay's parameters are one `url` query, its limiter a 16-slot FIFO queue (refusing would fail a parallel run), headers passed are three named ones (so the upstream sees Lunhui's own `Referer`/`User-Agent`); the routes' refusals are their own words behind a header, not new `core/errors.ts` codes; `location` travels with a 3xx (the spec names status, type and bytes; the redirect rule needs the location too); the iFinD route accepts only the stand-in's query grammar (it spends the operator's quota); the whole iFinD ask has one 15 s deadline; provenance is `via: "account"` on the file and its `run.json` entry, and `CONTRACT_VERSION` does not move because no contract reads a file-level field; the address comes from `FACE_ACCOUNT_URL` read at mount, not from `face/src/lunhui.ts` config (production rows stay config-free and two `feat/desk` overlap files stay untouched); `agents.ts` keeps scrubbing `IFIND_*`; the run view's "via iFinD" line is unchanged.
