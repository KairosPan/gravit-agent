# The Account's two parts, plan 1 — China in the Account, the face re-pointed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Account serves A shares (the China tab, A-share search, an A share's quote, facts and history, China's status) from Tencent, and the face's Markets screen reads them through its proxy; the face's own Tencent wire is deleted with no fallback.

**Architecture:** The face's five Tencent modules (`cn-rank.ts`, `quote-snapshots.ts`, `cn-candles.ts`, `symbol-search.ts`, `cn-session.ts`) are copied into `account/src/portfolio/live/` as `cn-*.ts` over a raw-bytes fixed-host GET (`cn-http.ts`), composed by one `ChinaSource` (`live/china.ts`) that the service mounts beside — not inside — its public sources. The service answers China through reads it already has: `explore?tab=china&sort=`, `explore?q=` (hits merged), `quotes?pairs=china|<code>` (price, facts, session) and `candles?venue=china&symbol=<code>&range=` (minutes or forward-adjusted bars). The face client keeps its store slices and drawing (`chinaRowsOf`, `cnPageOf`, `cnStateWord`, `render/markets.js` `cnPage`) and swaps its wire for one pure adapter module (`wire/china.js`); the face server then deletes its wire.

**Tech Stack:** `account/`: Node 22, TypeScript, vitest (`npm test`, `npm run typecheck`). `face/`: Node 22, TypeScript via tsx, `node --test` (`npm test`, `npm run typecheck`), plain ES-module client.

**Spec:** `docs/superpowers/specs/2026-11-01-account-two-parts-design.md` (§4.1, §4.4, §9 calls 1, 2, 5). What the face must keep drawing: `docs/superpowers/specs/2026-10-31-china-tab-design.md` (§4 the tab, §5 the page, §6 the measured upstream facts).

## Global Constraints

- Keys: an A share is `cn:<6 digits>` everywhere — the Account's explore key, the face's page id, the watch entry `{venue: "china", symbol: "<6 digits>"}`.
- The tab: `explore?tab=china`, label `China`, sorts `volume` and `movers` only (`closing` refused); 20 rows at most (`RANK_ROWS = 20`).
- China rows carry `currency: "CNY"`, never appear in `all`, and every line says `canTrade: false` with no `connectTo`/`connector`; the dollar rule of `explore.ts` (`inDollars`, explore.ts:930) is unchanged for every other row.
- Code is MOVED (copied with its parsers, limits and tests, then the face copy deleted in Task 8), not rewritten. The traps travel with it: STAR (688/689) volume in shares, the rest in lots, decided by the reply's own turnover; Tencent's qt replies decoded as GBK before the `~` split, smartbox as GB18030; the face server's board mapping (`tencentCode`) leaves the face (it lives on in the Account; the client's `cnBoardOf` and Lunhui's `boardOf` stay).
- Upstream hosts, GET only, https, default port: `qt.gtimg.cn`, `smartbox.gtimg.cn`, `proxy.finance.qq.com`, `web.ifzq.gtimg.cn`. No other host is added by this plan.
- Anti-goal: no direct-to-upstream fallback anywhere in `face/`. When the Account cannot answer, the face says so; a China screen never shows stale prices without saying so.
- The face holds no key and signs nothing itself: an A-share star on a page that signs goes through the existing owner `setWatch` path (`host/markets.js` `setWatch`).
- Tests are offline: the Account's China code takes an injected `CnHttp`; the service takes `china?: ChinaSource` (absent: no China, never the network); face tests use recorded fixtures.
- `account/` suite is green but for the known red `test/unit/ui-superagent.test.ts` (DEVELOPMENT.md, the account test row).
- Work on `feat/two-parts-1` from local `main` in a worktree; never push; never touch `strategies/*`; commit messages written to a file outside the worktree (the session scratchpad) and committed with `git commit -F <file>` — no backticks in messages, no attribution lines.
- Plans 2–5 are out of scope, and nothing here may block them: `cn-http.ts` takes its host list as a parameter (plan 2's relay extends it), `GRAVIT.md`, Lunhui (`face/plugins/lunhui/`) and AKShare are untouched.
- `feat/desk` reads `/data/quotes` for US ids (DEVELOPMENT.md, the quote-wire residual); its merge meets a deleted route — say so in the final report, change nothing on that branch.

## Review Focus

- **An A-share page reached cold** — a deep link or Lunhui's Open in Markets (`app.js` `lunhuiMarkets` → `cn:<code>`) before any China read, now that `isAccountKey` is true for `cn:`: a host or view branch that tests `isAccountKey` before `isCnKey` sends the id to `pageOf` and draws nothing. Expect the A-share page with its candles read at `venue=china`. Test in Task 6.
- **The Account down while China is on screen** — the proxy re-serves a kept explore answer flagged `stale: true` (account-proxy.ts header comment): China must draw a line saying the Account is not answering, never the old rows bare. Test in Task 6.
- **Beijing's Saturday on New York's Friday evening** — 1D/5D must be Tencent's last session(s), never the New York session window (`service.ts` `sessionsSince`, `live/history.ts`); the state line says Closed, never Stale. Test in Task 4.
- **A search typed in Chinese or as a STAR code** (`茅台`, `688981`) — encoded through the proxy and the Account, decoded GB18030, STAR listings kept (`GP-A-KCB`). Test in Task 4.
- **Moving the old local cn stars when the browser's Account-key store is nearly full** — the move must keep what does not fit on the cn list (said `full`), never drop a star. Test in Task 7.

---

## File structure

**account/** (new, each one responsibility; copied from face where marked)

| File | Responsibility |
|---|---|
| `src/portfolio/live/cn-http.ts` (new) | raw-bytes GET to a fixed host list: `CnHttp`, `realCnHttp`, `cnHosts`, `CN_HOSTS`, `readCapped` |
| `src/portfolio/live/cn-session.ts` (from `face/src/cn-session.ts`) | the A-share session: `parseMarketStat`, `beijingDate`, `cnPhase`, `sessionFromReply`, `readCnSession` |
| `src/portfolio/live/cn-quotes.ts` (from `face/src/quote-snapshots.ts`) | `tencentCode`, `parseTencentQuotes` (GBK, STAR volume, the facts) |
| `src/portfolio/live/cn-rank.ts` (from `face/src/cn-rank.ts`) | `parseTencentRank`, `mergeMovers`, `rankUrl` |
| `src/portfolio/live/cn-history.ts` (from `face/src/cn-candles.ts`) | `gridIndex`, `parseDayQuery`, `parseKline`, `CN_BARS`, `historyUrl` |
| `src/portfolio/live/cn-search.ts` (from `face/src/symbol-search.ts`) | `parseTencentSearch`, `searchUrl` |
| `src/portfolio/live/china.ts` (new) | `ChinaSource`: keepers, flights, status words, rows and markets in the Account's shapes |
| `test/unit/cn-*.test.ts`, `test/unit/china.test.ts`, `test/unit/account-china.test.ts` | the moved tests (vitest) and the new ones |

**account/** (modified): `live/categories.ts` (TabId, TABS), `live/explore.ts` (ExploreKind, ExploreItem fields), `service.ts` (option, explore, candles, quotes), `server.ts` (mount the source), `mcp.ts` (the seat's explore tab enum).

**face/** (modified/new): `src/account-proxy.ts` (explore's `sort`); `client/js/wire/china.js` (new adapters); `client/js/host/markets.js`, `host/market-view.js`, `reducers/markets.js`, `render/markets.js`, `render/account.js`, `wire/market-model.js`, `app.js`, `data/empty.js`. Deleted in Task 8: `src/quotes.ts`, `src/quote-snapshots.ts`, `src/quote-types.ts`, `src/symbol-search.ts`, `src/cn-rank.ts`, `src/cn-candles.ts`, `src/cn-session.ts`, `client/js/wire/market-quotes.js`, `client/js/wire/market-search.js` and their tests.

---

### Task 1: The raw-bytes fetch, the session and the quote parser in the Account

Why its own fetch: the Account's `Http` (`live/types.ts:117-147`, `realHttp`) decodes every body as UTF-8 (`r.text()`) and keeps 2,000 characters of it — a GBK reply would be mangled before the split (the trail-byte `~` trap) and a ranking or a minute series cut short. `fixedHosts` (`public-markets.ts:412`) is the model for the host guard.

**Files:**
- Create: `account/src/portfolio/live/cn-http.ts`
- Create (copy of `face/src/cn-session.ts`, adapted): `account/src/portfolio/live/cn-session.ts`
- Create (copy of `face/src/quote-snapshots.ts`'s parsing half): `account/src/portfolio/live/cn-quotes.ts`
- Test: `account/test/unit/cn-http.test.ts`, `account/test/unit/cn-session.test.ts` (from `face/tests/cn-session.test.ts`), `account/test/unit/cn-quotes.test.ts` (from `face/tests/quote-snapshots.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  // cn-http.ts
  export const CN_HOSTS: readonly string[]; // ["qt.gtimg.cn", "smartbox.gtimg.cn", "proxy.finance.qq.com", "web.ifzq.gtimg.cn"]
  export interface CnReply { status: number; bytes: Uint8Array }
  export type CnHttp = (url: string, init: { timeoutMs: number; maxBytes: number; headers?: Record<string, string> }) => Promise<CnReply>;
  export const realCnHttp: CnHttp;       // fetch, redirect "manual", the body streamed and cut: past maxBytes throws Error("too-large"); a timeout throws Error("timeout")
  export function cnHosts(http: CnHttp, hosts?: readonly string[]): CnHttp; // throws "<host> is not asked: an A share is read from <hosts> only" for anything not https / default port / no user / listed host
  // cn-session.ts — the face's exports, readCnSession re-typed
  export type CnPhase = "trading" | "midday" | "closed";
  export interface CnSession { phase: CnPhase; lastSession: string | null }
  export const SESSION_CODES: readonly ["marketStat", "sh000001"];
  export function parseMarketStat(text: string): "open" | "closed" | null;
  export function beijingDate(tencentTime: string | undefined): string | null;
  export function cnPhase(nowMs: number, stat: "open" | "closed" | null, lastSession: string | null): CnPhase;
  export function sessionFromReply(text: string, nowMs: number): CnSession;
  export function readCnSession(http: CnHttp, nowMs: number): Promise<CnSession>; // any failure: the Beijing clock's word, lastSession null
  // cn-quotes.ts
  export const QUOTE_TIMEOUT_MS = 7_000, QUOTE_RESPONSE_LIMIT = 1024 * 1024;
  export function tencentCode(symbol: string): string | null; // 6→sh, 0/3→sz, 4/8/9→bj
  export interface CnQuote { symbol: string; name: string | null; price: number | null; prevClose: number | null; volume: number | null; asOf: string | null;
    open: number | null; high: number | null; low: number | null; turnover: number | null; turnoverRate: number | null; marketCap: number | null;
    peTtm: number | null; limitUp: number | null; limitDown: number | null; amplitude: number | null }
  export function decodeGbk(bytes: Uint8Array): string;   // new TextDecoder("gbk")
  export function parseTencentQuotes(text: string, symbols: readonly string[], nowMs: number): { session: CnSession; quotes: Map<string, CnQuote> };
  ```
  `CnQuote` is the face's `QuoteUpdate` in the Account's camelCase: `turnover` and `marketCap` in yuan (fields 37 ×10,000 and 45 ×1e8), `asOf` the `+08:00` ISO time of field 30 (the round-trip check kept), `volume` in shares by `volumeShares` unchanged, `peTtm` signed. A symbol with no row (or a row for another code, or under 38 fields) is absent from the map.

- [ ] **Step 1: Copy the three files and the two test files.** `cp face/src/cn-session.ts account/src/portfolio/live/cn-session.ts`, and the same for the tests into `account/test/unit/`. `cn-quotes.ts` takes from `quote-snapshots.ts` `number`, `tencentTimestamp`, `volumeShares`, `signed`, `scaled`, `tencentCode` and the body of `tencent()`'s row parsing (quote-snapshots.ts:139-164) as `parseTencentQuotes`; the hub, the provider states and the Chinese messages stay behind (they die in Task 8).

- [ ] **Step 2: Convert the moved tests to vitest and point them at the new modules.** `import { describe, expect, it } from "vitest"` (the account suite's style, e.g. `test/unit/live-public-stocks.test.ts`); keep every case and its fixture strings. The face cases that tested the hub (`createQuoteSnapshots().load`, provider states, abort) become `parseTencentQuotes` cases where they test parsing, and are dropped where they test the hub; the limits case ("the session's own limits equal the quote wire's") pins `SESSION_RESPONSE_LIMIT === QUOTE_RESPONSE_LIMIT` and `SESSION_TIMEOUT_MS === QUOTE_TIMEOUT_MS`. Keep by name:
  - `volume is in shares: lots on most boards, shares on STAR, unknown when the turnover fits neither`
  - `GBK names decode before the fields split, so a trail byte that reads as ~ moves no field` — through `decodeGbk` on the same bytes
  - `a quote carries the page's facts, in yuan and percent`, `a negative P/E is kept`, `a missing or malformed event time stays missing`
  - the five `cn-session` cases, `readCnSession` now over a `CnHttp` stand-in.

- [ ] **Step 3: Write the failing `cn-http` tests.**
  ```ts
  it("cnHosts asks only the four Tencent hosts, over https, by GET", async () => {
    const sent: string[] = [];
    const http = cnHosts(async (url) => { sent.push(url); return { status: 200, bytes: new Uint8Array() }; });
    await http("https://qt.gtimg.cn/q=sh600519", { timeoutMs: 7_000, maxBytes: 1024 });
    for (const bad of ["http://qt.gtimg.cn/q=x", "https://qt.gtimg.cn:8443/q=x", "https://u:p@qt.gtimg.cn/", "https://push2.eastmoney.com/api"])
      await expect(http(bad, { timeoutMs: 1, maxBytes: 1 })).rejects.toThrow(/is not asked/);
    expect(sent).toEqual(["https://qt.gtimg.cn/q=sh600519"]);
  });
  it("cnHosts takes a longer list for a caller that names one", ...)   // plan 2's relay: a host passed in is asked
  it("readCapped stops past maxBytes", ...)                              // the helper realCnHttp reads its body with; a stream of 3 × 600 bytes, maxBytes 1,024 → rejects "too-large"
  ```
  Export `readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array>` from `cn-http.ts` so the cap is testable without the network; `realCnHttp` itself is not unit-tested (no network in tests).

- [ ] **Step 4: Run them and see them fail.** `cd account && npx vitest run test/unit/cn-http.test.ts test/unit/cn-session.test.ts test/unit/cn-quotes.test.ts` — FAIL: modules or exports not found.

- [ ] **Step 5: Implement `cn-http.ts` and adapt the two copied modules** to the Interfaces above (imports from `./cn-http.ts`; no import from `face/`).

- [ ] **Step 6: Run them and see them pass**, then `npm run typecheck`. Expected: PASS, no type errors.

- [ ] **Step 7: Commit.** Message: `feat(account): the A-share fetch, session and quote parser, moved from the face`.

---

### Task 2: The ranking, the history and the search parsers in the Account

**Files:**
- Create (copy of `face/src/cn-rank.ts`'s parsing half): `account/src/portfolio/live/cn-rank.ts`
- Create (copy of `face/src/cn-candles.ts`'s parsing half): `account/src/portfolio/live/cn-history.ts`
- Create (copy of `face/src/symbol-search.ts`'s parsing half): `account/src/portfolio/live/cn-search.ts`
- Test: `account/test/unit/cn-rank.test.ts`, `cn-history.test.ts`, `cn-search.test.ts` (from `face/tests/cn-rank.test.ts`, `cn-candles.test.ts`, `symbol-search.test.ts`)

**Interfaces:**
- Consumes: `tencentCode` (Task 1).
- Produces:
  ```ts
  // cn-rank.ts
  export type ChinaSort = "volume" | "movers";
  export const RANK_ROWS = 20, RANK_BODY_LIMIT = 256 * 1024;
  export interface RankRow { symbol: string; name: string; price: number | null; changePct: number | null; turnover: number | null } // turnover in yuan
  export function parseTencentRank(body: string): { total: number; rows: RankRow[] };
  export function mergeMovers(gainers: RankRow[], losers: RankRow[], limit?: number): RankRow[];
  export function rankUrl(sortType: "turnover" | "priceRatio", direct: "down" | "up", count: number): string; // proxy.finance.qq.com getBoardRankList, _appver=11.17.0, board_code=aStock, offset=0
  // cn-history.ts
  export type ChinaRange = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX";
  export interface CnMinutes { date: string; prec: number; price: number[]; amount: number[] }
  export interface CnBar { t: number; o: number; h: number; l: number; c: number }
  export const CN_BARS: Record<Exclude<ChinaRange, "1D" | "5D">, ["day" | "week" | "month", number]>; // the face's BARS, unchanged
  export const HISTORY_BODY_LIMIT = 1024 * 1024;
  export function gridIndex(hhmm: string): number | null;
  export function parseDayQuery(body: string, code: string): CnMinutes[];
  export function parseKline(body: string, code: string, interval: "day" | "week" | "month"): CnBar[];
  export function historyUrl(code: string, range: ChinaRange): string; // day/query?code= for 1D/5D, fqkline/get?param=<code>,<interval>,,,<n>,qfq otherwise
  // cn-search.ts
  export const SEARCH_TIMEOUT_MS = 6_000, SEARCH_RESPONSE_LIMIT = 256 * 1024, SEARCH_RESULTS = 30;
  export interface CnHit { symbol: string; name: string; exchange: "SH" | "SZ" | "BJ" }
  export function parseTencentSearch(body: string): { hits: CnHit[]; truncated: boolean };
  export function searchUrl(q: string): string; // https://smartbox.gtimg.cn/s3/?q=<encoded>&t=all
  ```
  `RankRow` drops the face's `id`: the Account makes the key in Task 3. The routes, caches and fences of the three face modules stay behind.

- [ ] **Step 1: Copy the parsers and the three test files**, the tests converted to vitest as in Task 1.
- [ ] **Step 2: Keep, by name, every parser case** — among them `parseTencentRank maps rows … and skips what is not an A share`, `mergeMovers ranks gainers and losers by the size of the move, then turnover`, `parseDayQuery: oldest first, gaps repeat the last price with nothing traded, points past 15:00 dropped`, `parseKline: forward-adjusted rows to bars stamped 15:00 Beijing, for day, week and month`, `Tencent decodes Chinese suggestions, retains stable ids and excludes non-A listings`, `STAR Market listings (GP-A-KCB), its CDRs among them, are A shares; an index, a fund and a B share are not`, `suggestion limits are disclosed even when excluded markets reduce visible results`. Drop the route, cache and fence cases (they belong to Task 3's source, or die with the face). Replace the cross-package `CN_RANGES is the client's CANDLE_RANGES` with:
  ```ts
  it("China's ranges are the Account's chart ranges", () => {
    expect(["1D", "5D", ...Object.keys(CN_BARS)].sort()).toEqual([...CANDLE_RANGES].sort()); // trade.ts CANDLE_RANGES
  });
  it("the URLs name their hosts and encode the query", () => {
    expect(searchUrl("茅台")).toBe("https://smartbox.gtimg.cn/s3/?q=%E8%8C%85%E5%8F%B0&t=all");
    expect(historyUrl("sh600519", "5Y")).toBe("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,week,,,260,qfq");
    expect(rankUrl("priceRatio", "up", 20)).toContain("sort_type=priceRatio&direct=up&offset=0&count=20");
  });
  ```
- [ ] **Step 3: Run and see them fail.** `cd account && npx vitest run test/unit/cn-rank.test.ts test/unit/cn-history.test.ts test/unit/cn-search.test.ts` — FAIL: modules not found.
- [ ] **Step 4: Implement** to the Interfaces (the bodies are the face's).
- [ ] **Step 5: Run and see them pass**; `npm run typecheck`.
- [ ] **Step 6: Commit.** `feat(account): the A-share ranking, history and search parsers, moved from the face`.

---

### Task 3: The China source

**Files:**
- Create: `account/src/portfolio/live/china.ts`
- Modify: `account/src/portfolio/live/explore.ts` — `ExploreKind` (:113) gains `"ashare"`; `type DollarKind = Exclude<ExploreKind, "event" | "ashare">` replaces `Exclude<ExploreKind, "event">` in `ExploreOptions.moversMinUsd` (:139), `FLOOR_USD` (:341), `TAB_OF` (:657) and the casts at :724, :913, :969 (`kindOf`, explore.ts:528, never returns `"ashare"`: China never enters `exploreAcross`); `ExploreItem` (:210) gains `currency?: "CNY" | undefined` and `turnoverCny?: number | undefined`; `Exploration` (:280) gains `china?: ChinaRead | undefined` (a type-only import from `china.ts`)
- Test: `account/test/unit/china.test.ts` (a `CnHttp` stand-in answering by URL, recording each URL — the `network(routes)` style of `test/unit/live-public-markets-fixtures.ts`, over bytes)

**Interfaces:**
- Consumes: everything Tasks 1–2 produce; `ExploreItem` (explore.ts:210, with the fields above); `Market` and `MarketSession` (trade.ts:40, :162); `no` (`../refuse.ts`), `Refusal`.
- Produces:
  ```ts
  export const CHINA_ID = "china";
  export const CHINA_NAME = "Tencent";             // a line's venueName and every quoteFrom
  export const CHINA_NOTE = "China: A shares as Tencent ranks them, view-only and priced in CNY; no venue here trades them.";
  export const RANK_TTL_MS = 10_000, QUOTES_TTL_MS = 5_000, MINUTES_TTL_MS = 30_000, BARS_TTL_MS = 600_000, SEARCH_TTL_MS = 60_000;
  export const STALE_KEEP_MS = 600_000;            // a ranking kept to answer, flagged stale, after a failed read
  export const DELAYED_MS = 300_000;               // a trading-hours quote older than this is "delayed"
  export interface ChinaStatus { state: "live" | "stale" | "unavailable"; said: string; at?: string | undefined }
  export interface ChinaRead { sort: ChinaSort; total: number; asOf: string; session: CnSession; status: ChinaStatus }
  export interface ChinaFacts { prevClose: number | null; open: number | null; high: number | null; low: number | null; turnover: number | null;
    turnoverRate: number | null; marketCap: number | null; peTtm: number | null; limitUp: number | null; limitDown: number | null;
    volume: number | null; amplitude: number | null; lastSession: string | null; phase: CnPhase; quoteStatus: "live" | "delayed" }
  export type ChinaMarket = Market & { currency: "CNY"; cn: ChinaFacts };
  export type ChinaHistory =
    | { venue: "china"; venueName: "Tencent"; symbol: string; range: "1D" | "5D"; sessions: CnMinutes[]; source: string }
    | { venue: "china"; venueName: "Tencent"; symbol: string; range: Exclude<ChinaRange, "1D" | "5D">; candles: CnBar[]; source: string; adjustment: string };
  export interface ChinaSource {
    rank(sort: ChinaSort): Promise<{ items: ExploreItem[]; read: ChinaRead } | Refusal>;
    search(q: string): Promise<ExploreItem[] | Refusal>;
    quotes(symbols: readonly string[]): Promise<Map<string, ChinaMarket> | Refusal>; // at most SEARCH_RESULTS (30) symbols
    history(symbol: string, range: ChinaRange): Promise<ChinaHistory | Refusal>;
    status(): ChinaStatus;
  }
  export function chinaSource(deps?: { http?: CnHttp; clock?: () => number }): ChinaSource; // http defaults to realCnHttp, always wrapped in cnHosts
  ```
- The shapes it fills (exact):
  - A China **row** (`ExploreItem`): `{ key: "cn:600519", kind: "ashare", name, base: "600519", currency: "CNY", price?, changePct24h? (the change against the previous close), turnoverCny?, quoteFrom: "Tencent", tabs: ["china"], at: [{ venue: "china", venueName: "Tencent", symbol: "600519", connected: false, canTrade: false, public: true, price?, quoteFrom: "Tencent" }] }` — no `connectTo`, no `connector`, never `"all"` in `tabs`.
  - A China **market** (`ChinaMarket`): `{ symbol, name, kind: "stock", base: symbol, quote: "CNY", currency: "CNY", open: false, types: [], price?, quoteAt? (asOf), quoteFrom: "Tencent", change24h?, changePct24h?, session: { open: phase === "trading" }, cn: ChinaFacts }`. `quote: "CNY"` keeps every dollar path (`inDollars`) shut to it.
  - **Status words** (the Account's own, fixed): live `"Tencent · answering"`; stale `` `Tencent did not answer · China as of ${HH:MM} Beijing` `` (the kept answer's time); unavailable `"Tencent is not answering: A shares cannot be read now"`; before any read `{ state: "unavailable", said: "Tencent · not read yet" }`.
  - A **refusal** of any read is `no("E_VENUE_UNREACHABLE", { venue: "china", message: <the unavailable words, or "Tencent's search did not answer"> })`; no vendor text, URL or thrown message ever reaches it.

- [ ] **Step 1: Write the failing tests** (names and the assertions that pin them):
  ```ts
  it("volume asks the ranking once by turnover; movers twice by priceRatio, merged; each with the session", async () => {
    // sent URLs: one rankUrl("turnover","down",20) + one qt marketStat,sh000001 read; movers: two rankUrls + one session read
    expect(r.items.map((i) => i.key)).toEqual(["cn:600519", "cn:688981", "cn:300750", "cn:920306"]);
    expect(r.read).toMatchObject({ sort: "volume", total: 5577, session: { phase: "closed", lastSession: "2026-10-30" }, status: { state: "live" } });
  });
  it("a China row is view-only, in CNY, and only in China", ...)        // tabs ["china"], at[0].canTrade false, no connectTo/connector, currency "CNY", turnoverCny 21610000000 for 216.1亿
  it("a ranking is kept 10 s per sort, shared by concurrent asks; a failure is never kept", ...)
  it("a failed ranking answers the last good one for ten minutes, flagged stale, then refuses", ...)
      // clock +11 s, upstream 503 → same items, read.status = { state: "stale", said: "Tencent did not answer · China as of 15:00 Beijing" }
      // clock +601 s → isRefusal, code E_VENUE_UNREACHABLE, message "Tencent is not answering: A shares cannot be read now"; status().state "unavailable"
  it("quotes: one qt GET for the session and every code, GBK, the facts and the phase", ...)
      // sent: ["https://qt.gtimg.cn/q=marketStat,sh000001,sh600519,sz000001"]; m.cn.turnover in yuan; m.cn.phase "trading"; quoteStatus "delayed" when asOf is 6 min old at 10:40 Beijing
  it("quotes: a STAR share's volume is in shares, a main-board share's in lots ×100", ...)
  it("quotes: a code Tencent does not file is never asked; more than 30 is refused", ...)
  it("history: 1D the last session, 5D the last five, from day/query; 1M–MAX forward-adjusted bars", ...)
      // range "5Y" sends historyUrl("sh600519","5Y"); answer.adjustment "forward-adjusted (前复权)"; YTD cut at Jan 1 Beijing of the last bar's year
  it("history: a share with fewer than five sessions answers the sessions it has", ...)
  it("search: smartbox hits priced by one quote read; a failed quote read leaves them unpriced", ...)
      // q "茅台" → sent[0] searchUrl("茅台"), sent[1] qt for the hits; items carry key cn:600519 and price; qt 503 → items without price, not a refusal
  it("search: a STAR listing is found by its code", ...)                // q "688981", GP-A-KCB row kept
  it("search: kept 60 s per query; an outage is not kept", ...)
  it("no request leaves the four hosts", ...)                           // every sent URL's host ∈ CN_HOSTS over all of the above
  ```
  Fixture bytes: the face tests' recorded strings (Task 1–2 copies), GBK-encoded where the face test encoded them; a ranking body with a STAR (`sh688981`), a ChiNext (`sz300750`), a Beijing (`bj920306`) and a halted row (non-empty `state`, kept as a row, as today).
- [ ] **Step 2: Run them and see them fail.** `cd account && npx vitest run test/unit/china.test.ts` — FAIL: module not found.
- [ ] **Step 3: Implement `chinaSource`.** One small keeper per read (key → `{at, answer}`) plus a flight map, as `face/src/cn-rank.ts` `createCnRank` and `cn-candles.ts` `createCnCandles` do; the search keeper keeps 128 queries least-recently-used and at most 32 flights (the face's `SEARCH_CACHE_LIMIT`/`SEARCH_FLIGHT_LIMIT`), a 33rd refused `E_ACCOUNT_BAD_ACTION` "too many A-share searches at once". Decode qt replies with `decodeGbk`, smartbox with `new TextDecoder("gb18030")`, the ranking and history as UTF-8. Time limits: 7 s (`QUOTE_TIMEOUT_MS`) for qt, ranking and history, 6 s for search. `status()` is updated by every rank and quotes outcome.
- [ ] **Step 4: Run and see them pass**, with the explore.ts type changes above; then `npm test && npm run typecheck` (the type changes touch `exploreAcross`: its suites must stay green).
- [ ] **Step 5: Commit.** `feat(account): the China source - ranking, quotes, history and search from Tencent`.

---

### Task 4: China in the service, the routes and the seat

**Files:**
- Modify: `account/src/portfolio/live/categories.ts:31-43` (TabId gains `"china"`; TABS gains `{ id: "china", label: "China" }` after Predictions)
- Modify: `account/src/portfolio/service.ts` — `ServiceOptions` (:124) gains `china?: ChinaSource | undefined`; `explore` (:904), `candles` (:1322), `quotes` (:1658)
- Modify: `account/src/portfolio/server.ts:1137` (pass `china: chinaSource()`)
- Modify: `account/src/portfolio/mcp.ts:843` (the seat's `portfolio_explore` `tab` enum gains `"china"`; the description gains one sentence)
- Test: `account/test/unit/account-china.test.ts` (a `PortfolioService` built as `test/unit/geo-after-connect.test.ts:101` builds one, `publicMarkets: []`, with a recording stand-in `ChinaSource`), plus whatever pinned the tab list or the seat schema (`npx vitest run` names them)

**Interfaces:**
- Consumes: `ChinaSource`, `ChinaRead`, `ChinaMarket`, `ChinaHistory`, `CHINA_ID`, `CHINA_NOTE`, `RANK_ROWS` (Task 3).
- Produces (the wire the face reads in Tasks 5–7):
  - `GET /api/account/explore?tab=china&sort=volume|movers[&limit=]` → `{ ok: true, asOf, tabs: [{ id: "china", label: "China", count: total }], items: <China rows, at most RANK_ROWS>, movers: [], closing: [], mostTraded: [], missing: [], notes: [CHINA_NOTE], china: ChinaRead }`; `sort` absent is `volume`; `closing` refused `E_ACCOUNT_BAD_ACTION` "China is sorted by volume or movers"; `q` with `tab=china` searches China alone (`items` the hits, `china` absent). A refusal of the source is answered as the refusal (409). Not kept in `marketReads` (the source keeps it 10 s).
  - `GET /api/account/explore?q=<q>` (tab absent or `all`) → as today, with China's hits appended after the dollar rows (`items: [...explored.items, ...hits].slice(0, limit)`); the China search waits at most `CHINA_SEARCH_WAIT_MS = 4_000` (the per-source budget of `exploreAcross`), and a late or refused one adds `{ venue: "china", venueName: "Tencent", connected: false, why }` to `missing`. Any other tab never asks China.
  - `GET /api/account/explore` (All, or any dollar tab) never carries a `cn:` row, and its `tabs` never a `china` entry (exploreAcross counts zero rows there and drops it, explore.ts:975).
  - `GET /api/account/quotes?pairs=china|600519,...` → each `{ venue: "china", symbol, market: ChinaMarket }`, or `{ venue: "china", symbol, refusal }` (the source's refusal, or `E_ACCOUNT_BAD_ACTION` "an A share is its six digits" for a bad symbol, or "no A-share quote for <symbol>" when Tencent filed none); China's pairs go to the source in ONE `quotes` call, the others as today; the 12-pair limit stands.
  - `GET /api/account/candles?venue=china&symbol=600519&range=1D` → `ChinaHistory` (as `{ ok: true, ...ChinaHistory }`); `range` required and one of `CANDLE_RANGES`, `before` refused ("an A share's history is read by range"), `interval` ignored; decided before `historyAsk` and before `sessionsSince` (Shanghai sessions, never New York's).
  - Without `opts.china` (every existing test, the demos): `tab=china` refuses `E_ACCOUNT_BAD_ACTION` "China is not read on this account", searches never ask China, venue `china` pairs and candles refuse the same words. `server.ts` mounts `chinaSource()` for the real server only, as `streams` is mounted (ServiceOptions.streams' comment).
  - Seat: `portfolio_explore`'s `tab` enum is `["all", "crypto", "stocks", "rwas", "perps", "preipo", "predictions", "china"]`; added sentence: "`china` is the A shares Tencent ranks — view-only, priced in CNY (`currency`), sorted by `volume` (turnover, `turnoverCny`) or `movers`, never in `all`, and no venue trades them."

- [ ] **Step 1: Write the failing service tests:**
  ```ts
  it("explore tab=china answers the source's ranking with its read, its count and its note", ...)
      // stub.rank called with "movers"; answer.tabs → [{ id: "china", label: "China", count: 5577 }]; answer.china.sort "movers"; notes [CHINA_NOTE]
  it("explore tab=china refuses closing; a source refusal is the answer", ...)
  it("All and every dollar tab never hold an A share", ...)          // explore(), explore({ tab: "stocks" }): no key starts "cn:", no tabs entry "china", stub.rank and stub.search never called
  it("a search merges China's hits after the dollar rows", ...)
  it("a search whose China half is late answers without it and says so in missing", ...)   // stub.search never settles; fake timers; missing has { venue: "china", venueName: "Tencent" }
  it("a search in Chinese reaches the source as typed", ...)          // explore({ q: "茅台" }) → stub.search("茅台")
  it("quotes: China's pairs go to the source in one call, the others as before", ...)
  it("candles venue china: by range, never by before; Tencent's last session on a Beijing Saturday", ...)
      // realNow = 2026-10-30T22:30:00-04:00 (Friday NY, Saturday 10:30 Beijing); stub.history("600519","1D") returns sessions [{ date: "2026-10-30", … }]; the answer is it, unchanged
  it("without a China source, China refuses in its own words", ...)
  it("the seat's explore takes the china tab", ...)                   // in the seat's test file: the tool's schema accepts { tab: "china" }
  ```
- [ ] **Step 2: Run them and see them fail.** `cd account && npx vitest run test/unit/account-china.test.ts` — FAIL.
- [ ] **Step 3: Add the tab** (categories.ts) listed under Files.
- [ ] **Step 4: Implement the service branches.** In `explore`, after the tab and sort checks (service.ts:906-909), branch `tab === "china"` before `marketReads.get`; the search merge goes inside the cached closure beside `exploreAcross` (service.ts:933). In `candles`, branch `id === CHINA_ID` right after the venue and symbol checks (service.ts:1326-1327). In `quotes`, split the pairs by venue before `liveMarket`. Wire `server.ts` and `mcp.ts`.
- [ ] **Step 5: Run the file, then the whole suite and the typecheck.** `npx vitest run test/unit/account-china.test.ts && npm test && npm run typecheck` — PASS but the known red `ui-superagent`.
- [ ] **Step 6: Commit.** `feat(account): China in explore, quotes and candles; the seat reads the china tab`.

---

### Task 5: The face's China adapters

**Files:**
- Create: `face/client/js/wire/china.js`
- Create fixtures: `face/tests/fixtures/account/explore-china.json`, `quotes-china.json`, `candles-china-1d.json`, `candles-china-1m.json`, `explore-search-china.json` (each an answer in Task 4's shapes; build them from the values in Task 3's tests — Moutai on 10-30, a STAR and a ChiNext share)
- Test: `face/tests/client/china-wire.test.js`

**Interfaces:**
- Consumes: the wire of Task 4; `normalizeAsset`, `number` (`wire/market-model.js`).
- Produces (pure, no DOM, no fetch):
  ```js
  export const CHINA_VENUE = 'china';
  export const isCnKey = id => typeof id === 'string' && /^cn:\d{6}$/.test(id);
  export function chinaPairOf(id)            // 'china|600519' for a cn key, else null
  export function rankOf(body, sort)         // explore tab=china answer → { ok: true, sort, total, asOf, session, status, stale, items: [{ id, symbol, name, price, change_pct, turnover }] } — the shape chinaRowsOf already reads (market-view.js:215); null for any other body or another sort
  export function cnQuoteOf(row, now)        // a quotes row → the LiveQuote the views read: { id, market: 'cn', symbol, name, price, prev_close, change, change_pct, volume, as_of, received_at, volume_as_of,
                                             //   source: 'Tencent', feed: '', basis: 'previous_close', quote_status, market_status, message: '', last_session, open, high, low, turnover, turnover_rate, market_cap, pe_ttm, limit_up, limit_down, amplitude }
                                             //   market_status from cn.phase: trading→'open', midday→'midday', closed→'closed'; quote_status = cn.quoteStatus; null for a refused row
  export function cnHitsOf(body)             // an explore?q= answer → { assets: Asset[] (normalizeAsset of { id: key, market: 'cn', symbol: base, name, currency: 'CNY' }), quotes: { [id]: LiveQuote-shaped { price, change_pct } } } from its cn: items
  export function chinaProviderOf(status)    // ChinaStatus → [{ id: 'tencent', market: 'cn', status: live→'connected', stale→'limited', unavailable→'error', said }] ; [] for none
  ```
- [ ] **Step 1: Write the failing tests:** `rankOf` over `explore-china.json` gives `items[0]` `{ id: 'cn:600519', symbol: '600519', name: '贵州茅台', price: …, change_pct: …, turnover: 21610000000 }` and `total` 5577; `rankOf(body, 'movers')` is null for a `volume` answer; a proxy-flagged body (`{ ...body, stale: true }`) gives `stale: true`; `cnQuoteOf` maps every one of the twelve facts and the phase; `cnQuoteOf({ refusal })` is null; `cnHitsOf(explore-search-china.json)` returns only cn items, STAR included; `chinaProviderOf({ state: 'stale', said: 'x' })[0]` is `{ id: 'tencent', market: 'cn', status: 'limited', said: 'x' }`.
- [ ] **Step 2: Run and see them fail.** `cd face && npx tsx --test tests/client/china-wire.test.js` — FAIL.
- [ ] **Step 3: Implement `wire/china.js`.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit.** `feat(face): adapters from the Account's China answers to the Markets screen's shapes`.

---

### Task 6: The face reads China from the Account

**Files:**
- Modify: `face/src/account-proxy.ts:110-126` (`ACCOUNT_QUERY.explore` = `["tab", "q", "key", "sort", "limit"]`; the header comment's explore line)
- Modify: `face/client/js/host/markets.js` (reads), `host/market-view.js`, `reducers/markets.js`, `render/markets.js`, `app.js:283-287`, `data/empty.js`
- Test: `face/tests/account-proxy.test.ts`, `face/tests/client/host-markets.test.js`, `market-view.test.js`, `markets.test.js`, `host-reducers.test.js`, `app.test.js`/`app-dom.test.js` where they hand `createLiveQuotes`/`createSymbolSearch`

**Interfaces:**
- Consumes: Task 5's adapters; the proxy routes `explore`, `quotes`, `candles` (account-proxy.ts).
- Produces: `startMarkets` loses `createLiveQuotes` and `createSymbolSearch` (and `app.js` stops passing them); `RANK_PATH`/`CN_CANDLES_PATH`/`HIT_QUOTES` go; new reads:
  - China: `/data/account/explore?tab=china&sort=<volume|movers>&limit=20`, when China comes on screen, every `EXPLORE_MS` (20 s) while it stays, again when its sort changes (host/markets.js:107-119, 308) — landing `rankLoaded` with `rankOf(body, sort)` (a null is `rankFailed` with the Account's sentence) and `chinaStatusUpdated` with `body.china.status`.
  - An A share's history: `/data/account/candles?venue=china&symbol=<code>&range=<range>` (host/markets.js:177-183, same landing).
  - A shares' live prices: one `cnQuotes` flight on the `QUOTES_MS` (5 s) tick beside `readQuotes`, while Markets is shown: the page's cn id first, then the cn rows in view (`rowsInView`, `tableOf` rows with `isCnKey`), at most `QUOTE_PAIRS` (12), `/data/account/quotes?pairs=<china|code,…>` → `quotesUpdated` `{ quotes: { [id]: cnQuoteOf(row) } merged over the kept ones, connection: 'polling' }`; a failed read keeps the quotes and sets `connection: 'error'`; a refused row keeps its kept quote, marks it `quote_status: 'stale'`, and lands `chinaStatusUpdated` with `{ state: 'unavailable', said: refusal.message }` (so `cnStateWord`, market-view.js:196-200, says `Quotes unavailable` over the last price).
  - Search: the existing `explore?q=` read alone (host/markets.js:342); its cn items are the hits — `resultsLoaded` also lands `hitQuotesLoaded` with `cnHitsOf(body).quotes`. No `/data/symbols/search`, `/data/quotes` or `/data/cn/` path is ever read.
  - Reducers: `searchUpdated` and the `search` slice go (empty.js); `chinaStatusUpdated: (s, { status }) => mk(s, { providers: chinaProviderOf(status) })`; `quotesUpdated: (s, { quotes, connection }) => mk(s, { quotes, connection })` — it no longer touches `providers`, which only `chinaStatusUpdated` sets.
  - Views: `isAccountKey` (market-view.js:149) gains `cn` (`/^(coin|stock|perp|rwa|event|preipo|kalshi|pm|pmus|cn):/`); every call site tests `isCnKey` first where an A share's path differs — host/markets.js:132, 353, 383, 403, 417; market-view.js:742 (`handWordsOf`); render/markets.js:183 (`marketPage`); app.js:364, 483-486; reducers/markets.js:20 stays as it is; reducers/messages.js:28 and market-view.js:382/392/405 are Task 7's. `faceAssetOf` and `cnSearchWord` read hits from `cnHitsOf(m.results?.data)` in place of `m.search`; `cnSearchWord` says `Search is unavailable` for A shares when the results body's `missing` names `china`. `unsortedRowsOf` draws a results body's cn items as `cnRow`s (not `accountRow`s). `CHINA_TAB`'s comment says it is the Account's china tab. China's muted line (render/markets.js:140): `chinaWord(session)`, then the Account's `status.said` when `rank.data.status.state === 'stale'`, then `The Account is not answering · China as last read` when `rank.data.stale`, then `Couldn’t refresh China` as today.

- [ ] **Step 1: Write the failing tests.** In `host-markets.test.js` (rewrite the cn wire cases; keep the fake `getJson` that records `r.reads`):
  ```js
  test('China reads the Account: explore tab=china now, every 20 s, and again on a new sort', ...)
    // r.reads includes '/data/account/explore?tab=china&sort=volume&limit=20', then after setMarketsSort('movers') '/data/account/explore?tab=china&sort=movers&limit=20'
  test('an A share page reached cold reads its candles at venue china', ...)
    // empty markets slice, r.markets.page('cn:600519') → '/data/account/candles?venue=china&symbol=600519&range=1D'; setRange 5D → …&range=5D
  test('A-share quotes: the page first, then the cn rows in view, twelve a call, every 5 s', ...)
    // '/data/account/quotes?pairs=china%7C600000%2Cchina%7C600519'
  test('a failed A-share quote read keeps the price and says the connection failed', ...)
  test('search is one explore?q read; its A shares are hits with their prices', ...)
  test('nothing reads the face wire', ...)
    // after every case above: r.reads.every(p => !/^\/data\/(quotes|symbols|cn)\b/.test(p))
  ```
  In `account-proxy.test.ts`: `rebuildQuery("explore", "/data/account/explore?tab=china&sort=movers&limit=20")` → `{ query: "tab=china&sort=movers&limit=20", fresh: false }`. In `markets.test.js` (render): the China table over a `stale: true` rank draws `The Account is not answering · China as last read` and its rows; over `status.state 'stale'` draws the Account's words; `marketPage('cn:600519', …)` draws the A-share page with no Account read. In `market-view.test.js`: `handWordsOf(m, a, 'cn:600519')` is `{ symbol: '600519', name: '贵州茅台' }` from a rank read; `isAccountKey('cn:600519')` true.
- [ ] **Step 2: Run and see them fail.** `cd face && npx tsx --test tests/account-proxy.test.ts tests/client/host-markets.test.js tests/client/markets.test.js tests/client/market-view.test.js` — FAIL.
- [ ] **Step 3: Implement** the proxy name, the reads, the reducers and the view branches above.
- [ ] **Step 4: Run them, then the whole face suite.** `npm test && npm run typecheck` — PASS (the wire modules still exist; nothing imports them from the client but their own tests).
- [ ] **Step 5: Commit.** `feat(face): Markets reads China, A-share quotes, history and search from the Account`.

---

### Task 7: A-share stars in the Account's watch list; the Venues line reads the Account

**Files:**
- Modify: `face/client/js/wire/market-model.js:127-190` (`ACCOUNT_KEY` gains `cn:` + six digits)
- Modify: `face/client/js/host/markets.js` (`watch`, `unwatch`, `load`, `askOld` skip cn), `host/market-view.js` (`starredOf`, `watchKeysOf`, `setWatchOf`, `watchedOf`, `chinaRowsOf` stars, `unsortedRowsOf` Watching/All), `reducers/messages.js:28` (as its test says), `render/account.js:178-180`
- Test: `face/tests/client/host-markets.test.js`, `market-view.test.js`, `account.test.js`, `market-fmt.test.js` or wherever `readAccountWatch` is tested

**Interfaces:**
- Consumes: `isCnKey`, `CHINA_VENUE`, `chinaProviderOf` (Task 5); `owner.act({ type: 'setWatch', venue, symbol, on })` (host/markets.js:255-263, unchanged).
- Produces:
  - `setWatchOf(markets, page, 'cn:600519')` → `{ on: { venue: 'china', symbol: '600519' }, off: <the page's entry { venue: 'china', symbol: '600519' }> | null }` with no read needed.
  - `watchKeysOf(page, rows)` maps every page entry `{ venue: 'china', symbol }` to `cn:<symbol>` directly (no row needed), the others as today.
  - `watch('cn:…')` / `unwatch('cn:…')` take the Account-key path (host/markets.js:353-365, 383-392): signed `setWatch` on a page that signs, else the browser's Account-key store (`ACCOUNT_WATCH_KEY`); the cn list (`STORAGE_KEY`) no longer takes a cn id.
  - `moveCnStars()` in `startMarkets`, once after `load()`: every `cn:` entry of the cn list appended to the Account-key store (once each, while it has room under `WATCH_LIMIT`), then the cn list saved without those that moved; what did not fit stays on the cn list and the store's error reads `full`.
  - Starred A shares draw as `cnRow`s under All and Watching (spec 2026-10-31 §4.9 kept), from `m.watch` and the page's china entries; on China a starred row shows a filled star.
  - The Venues line: `A-share quotes` over each `providers` entry with `market: 'cn'`, drawing its `said` (the Account's words, escaped) where it has one, else `providerWord` as today.
- [ ] **Step 1: Write the failing tests:**
  ```js
  test('an A-share star on a page that signs is the Account setWatch china|<code>', ...)   // owner.act called with { type: 'setWatch', venue: 'china', symbol: '600519', on: 'true' }; unwatch → on: ''
  test('an A-share star on a page that does not sign is kept in the browser\'s Account store', ...) // storage ACCOUNT_WATCH_KEY items ['cn:600519']; STORAGE_KEY untouched
  test('the old cn list moves to the Account store once at load', ...)
    // STORAGE_KEY [cn:000001, us:MSFT, cn:600519] → ACCOUNT_WATCH_KEY ['cn:000001','cn:600519'], STORAGE_KEY [us:MSFT]; a second boot moves nothing
  test('the move keeps what does not fit and says the store is full', ...)   // store at 99 keys + two cn stars → one moves, one stays on the cn list, watchError 'full'
  test('watchKeysOf names a china entry by its cn key with no read', ...)
  test('Watching and All draw a starred A share as its A-share row', ...)
  test('readAccountWatch keeps cn:600519 and drops cn:60051x', ...)
  test('the Venues line says the Account\'s China words', ...)            // providers [{ id: 'tencent', market: 'cn', status: 'error', said: 'Tencent is not answering: A shares cannot be read now' }] → that sentence under A-share quotes
  ```
- [ ] **Step 2: Run and see them fail.** `cd face && npx tsx --test tests/client/host-markets.test.js tests/client/market-view.test.js tests/client/account.test.js`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, then `npm test && npm run typecheck`.** PASS.
- [ ] **Step 5: Commit.** `feat(face): A-share stars live in the Account watch list; the Venues line reads the Account`.

---

### Task 8: The face's wire deleted

**Files:**
- Delete: `face/src/quotes.ts`, `quote-snapshots.ts`, `quote-types.ts`, `symbol-search.ts`, `cn-rank.ts`, `cn-candles.ts`, `cn-session.ts`; `face/client/js/wire/market-quotes.js`, `market-search.js`; `face/tests/quotes.test.ts`, `quote-snapshots.test.ts`, `cn-session.test.ts`, `cn-rank.test.ts`, `cn-candles.test.ts`, `symbol-search.test.ts`, `market-quotes.test.ts`, `market-search.test.ts`
- Modify: `face/src/main.ts:24-27, 176-193` (the four registrations and their disposers; `disposeData` keeps `disposeView`), `face/src/boot.ts:35` (the comment naming the face's own A-share fetches)
- Modify: `face/tests/http.test.ts:80-100` (the test that registered the search route as `/data`'s example), `face/tests/smoke.test.ts:420-456` (the fence drill's `/data` route), `face/tests/gravit-client-smoke.test.ts:73` (drop `market-quotes.js` from the served list)
- Create: `face/tests/no-market-hosts.test.ts`

**Interfaces:**
- Consumes: Tasks 6–7 (nothing in `client/` imports the two wire modules any more).
- Produces: no face route reaches a market host; the anti-goal pinned by a test.

- [ ] **Step 1: Write the failing test** `no-market-hosts.test.ts`:
  ```ts
  test("the face's own source names no market host", async () => {
    // every .ts/.js/.mjs file under face/src and face/client, read as text (face/plugins/ is Lunhui's — plan 2)
    for (const [file, text] of files) assert.doesNotMatch(text, /gtimg\.cn|finance\.qq\.com|eastmoney\.com|51ifind\.com/, file);
  });
  test("main.ts mounts no quote, search or China route", async () => {
    assert.doesNotMatch(main, /registerQuoteRoutes|registerSymbolSearchRoute|registerCnRankRoute|registerCnCandlesRoute/);
  });
  ```
- [ ] **Step 2: Run it and see it fail** — `cd face && npx tsx --test tests/no-market-hosts.test.ts` — FAIL naming `src/cn-rank.ts` (and the other four).
- [ ] **Step 3: Delete the files, unmount the routes, rewrite the three tests.** `http.test.ts`: assert `main.ts` registers none of the four (the assertion above) and keep its `/data` fence case on a route that stays (`registerLunhuiViewRoute`, as `smoke.test.ts` wires it). `smoke.test.ts`: the forged-host drill sends `/data/lunhui/view?strategy=cn-market&run=20990101T000000Z-00000000` with `evil.example.com` → 403, and a new line asserts `GET /data/quotes?ids=cn:600519`, `/data/symbols/search?q=1`, `/data/cn/rank?sort=volume` and `/data/cn/candles?id=cn:600519&range=1D` each answer 404. `gravit-client-smoke.test.ts`: `/client/js/wire/market-quotes.js` answers 404.
- [ ] **Step 4: Run the suite, the typecheck and the two real-boot smokes.** `npm test && npm run typecheck && FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts tests/gravit-client-smoke.test.ts` — PASS.
- [ ] **Step 5: Commit.** `refactor(face): the face's own A-share wire deleted - China is the Account's`.

---

### Task 9: The documents follow the tree

**Files:**
- Modify: `CLAUDE.md` (the `face/` row's sentence "the face's own quote wire (`/data/quotes`, …) speaks A shares alone (Tencent)" → the Markets screens read A shares from the Account; the `account/` row names China among its public markets; `face/client/` row's "the cn search" / face wire wording where it names the deleted modules)
- Modify: `DEVELOPMENT.md` — the face module table rows for the seven deleted modules (search `quotes.ts`, `symbol-search.ts`, `cn-rank.ts`, `cn-candles.ts`), the route table rows for `/data/quotes*`, `/data/symbols/search`, `/data/cn/*` (removed) and the `explore` proxy row (`sort`), the client `js/host/markets.js` row, the Markets sections that describe the face wire (search `/data/quotes?ids=`), the quote-wire residual (search "speaks A shares alone"), §10 item 22 (China built; the Lunhui relay and AKShare left for plans 2–3), the Account's public-markets section (the China source, its hosts and limits, `CnHttp` and why); the `cd account && npm test` row's counts as measured
- Modify: `face/README.md` (Markets: China, search and the A-share page read through the Account; `FACE_QUOTE_POLL_MS` gone), `account/README.md` (China among the Account's markets, view-only, CNY)
- Test: none new — the step is a grep.

- [ ] **Step 1: Find every stale sentence.** `grep -rn "data/quotes\|symbols/search\|data/cn/\|quote-snapshots\|cn-rank\|cn-candles\|symbol-search\|FACE_QUOTE_POLL_MS\|market-quotes\|market-search" CLAUDE.md DEVELOPMENT.md face/README.md account/README.md GRAVIT.md Gravit-Design.md` — every hit that describes the tree as it now is gets rewritten; hits in dated history (the built log, the specs' own records) stay.
- [ ] **Step 2: Rewrite them** in the documents' present-tense, descriptive voice; `CLAUDE.md` stays about as long as it is (one sentence changed per row).
- [ ] **Step 3: Verify.** Re-run the grep: only historical hits remain. Then `cd account && npm test && npm run typecheck` and `cd face && npm test && npm run typecheck` — green (the account suite but its known red).
- [ ] **Step 4: Commit.** `docs: China read from the Account; the face's A-share wire gone`.

---

## Self-review notes (run 2026-11-01)

- Spec §4.1 coverage: keys (Global Constraints, Tasks 3, 5, 7), the tab and sorts (Tasks 3, 4, 6), CNY / `canTrade: false` / never in `all` (Tasks 3, 4), search (Tasks 3, 4, 6), the page's facts and history (Tasks 3, 4, 5, 6), Shanghai sessions (Tasks 1, 4 — the Beijing-Saturday test), live prices (Task 6, by the quote read), stars and the one-time move (Task 7), statuses and the Venues line (Tasks 3, 7), the traps (Tasks 1, 2, 3). §4.4: Task 8 and its no-host test. §3 anti-goal (no fallback, stale said): Tasks 6, 8.
- Calls made where the spec left them to the builder: the facts and live price ride `quotes?pairs=china|<code>`, the history `candles?venue=china` (both existing reads, existing proxy routes); live prices by the quote read, not `stream/markets`, because China has no upstream push and the stream's frames carry no facts — a China stream would be a server-side poll re-framed; China is a `ChinaSource` beside the public sources, not a `PublicSource`, because `publicMarkets()` feeds paper pricing, the candles and book routes and the venue checks (service.ts:1007, :1363-1477, :1789), none of which may meet a CNY market.
