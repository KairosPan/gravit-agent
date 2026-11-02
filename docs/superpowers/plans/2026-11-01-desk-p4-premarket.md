# The Desk, P4 — the Per-strategy Pre-market Report (re-plan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before its market's open, every strategy the operator armed gets a report on the phone, written by an unattended desk turn that informs and never orders. A US strategy's market is XNYS; an A-share strategy's is XSHG. The report's first line says truthfully whether its research run (its Lunhui run) covers the previous session; then come the strategy's status and its levels against each symbol's last print, the previous close and the overnight gap. A firing is refused, loudly and once, when the strategy's `STANDING.md` or `levels.yml` changed since arming.

**Architecture:**
- **The order.** A report is a P2 standing order with `dir: strategies/<name>`, an optional `market: cn` (M8; absent is `us`, read through `orderMarket`), and an anchor such as `open-90m` on that market's calendar.
- **The producer.** `builtin:report` (`face/src/report.ts`) writes one JSON block into the wake message, holding:
  - the screen line, first (M7), from the strategy's sealed Lunhui runs, read through `channels.ts`'s run reader;
  - `status.yaml`;
  - one snapshot per market of the level symbols, through the Market's one source (P3's `MarketQuoteSource`, M11), each quote classified on its own market's date and session;
  - `levels.yml`, as the bytes `checkFiring` hashed.
- **The pin.** Arming pins `levels.yml` beside `STANDING.md`.
- **The schedule.** The clock row judges each order on its own market's calendar and date, through the one `DeskCalendars` that `installDesk` builds when the schedule starts.
- **Reuse.** P2's firing, fence and cut-off, and P3's Desk view in Markets, do the rest.

**Tech Stack:** Node 22, TypeScript strict via `tsx`, `node:test`; js-yaml 4.3.2 through P2's `CORE_SCHEMA` readers; the gravit-ui client; no new dependency, no Python; dsh 0.2.0-rc.2 unchanged.

**Spec:** `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` — §4.3, §5.3–§5.5, §5.9, §7, §9, §12, as amended by **§15 (M1–M8, M11), which wins**. Binding beside it: the P4 rulings in `.superpowers/research/desk-p1-p4/controller-notes.md` this plan keeps (see "Rulings carried"), its "Plan review rulings, 2026-11-01 evening", the P2 rulings where P4 uses P2's machinery, and `replan-brief.md`'s M9 and M10.

**Base:** `feat/desk-p1-p4` after P3's final review (P4-9). P4 consumes P3's names exactly as the plan review's rulings spell them:
- `face/src/symbols.ts`: `Market`, `idOf(market, symbol)`; `desk-book.ts`: `Level.market`, `levelDistancePct`;
- `market-quotes.ts`: `MarketQuoteSource`, `MarketQuote`, `unwiredMarketQuotes`;
- `et.ts`: `bjDate`, `bjClock`, `bjStamp`; `xshg-clock.ts`: `XSHG_CLOCK`, `xshgSession`, `xshgMarketClock`;
- `market-clock.ts`: `DeskCalendars`, `deskCalendars`, `createMarketCalendar`'s `dateOf` option;
- `alert-text.ts`: `priceStamp` (over its `QuoteSnap`), whose stamps are `ROBINHOOD 10:21:03 ET`, `NASDAQ 10:21:03 ET`, `CBOE DELAYED 10:05:00 ET`, `TENCENT 14:03:12 Beijing`;
- `briefProducer({ quotes, root, home })`;
- `installDesk`'s `quotes` and its `schedule.calendars?: Partial<DeskCalendars>` seam, and the one `DeskCalendars` it builds when the schedule starts; `createDeskSchedule`'s optional `quotes?: MarketQuoteSource`;
- `face/tests/desk-fakes.ts`: `fakeCalendar(days, clock = "fake clock", dateOf = (n) => etDate(new Date(n)))`;
- charter D28; the Markets Desk view (`face/client/js/host/desk-view.js` `deskViewOf`, `render/desk.js` `renderDeskTab`, `face/tests/client/desk-view.test.js`).

HEAD's own names, not P3's: `xnysWindow`, `sessionFor` (market-clock.ts), `etDate`, `etClock`, `etTime` (et.ts), `deskTime` (desk.ts), `readScriptBytes` (producer.ts), `readBoundedJson`, `stillAt`, `ANALYSIS_RUN_RE`, `RUN_MANIFEST_MAX_BYTES` (channels.ts). P2's `firing.ts` has `LINES`, `cutoffOf` and `snapshotFiles`/`diffFiles`. **"The old Task N"** means Task N of `docs/superpowers/plans/2026-10-20-desk-p4-premarket.md` (superseded, kept): its text binds where this plan says "as the old Task N", except for what this plan changes.

**Done (§15 M6, P4) — the operator's drill, written by Task 6.** One strategy's report preceded its market's open on three sessions and said truthfully what it says about its screen. A Lunhui strategy (`lunhui-s01-repair`, `market: cn`, `open-90m` = 08:00 Beijing) qualifies, once the drill's step 0 has given it a `STANDING.md` and a `levels.yml`, which it lacks today.

## Rulings carried (M9)

These stand as written:
- P4-1, the report is builtin, with the amended contents below;
- P4-2 and P4-8, the pins and D20's wording, now D28's;
- P4-3, the fence before and after;
- P4-4, file order, and lateness at queueing;
- P4-7, the loops page is P4's;
- P4-9, the base after P3;
- P4-10, the `open-Nm` room rule and the guarded `levels.yml` read;
- the old plan's rulings 2–6 and 8–14.

The full kept/changed/dropped table is in `replan-report.md` §1.

## Rulings this plan makes

Each ends with the cost if wrong.

1. **The strategy's market is an order field (M8).** `market?: Market` on `StandingOrder` and `ProducerInput`, absent meaning `us`, read through `orderMarket(o)` (`o.market ?? "us"`). `arm --market cn` writes it, and arming reads the Beijing date for cn. A P2 order parses, renders and fires with no `market` key, so P2's literals stand. The field beats deriving the market: `cn-market` has no levels, and a strategy may list both markets' symbols. An A-share order anchors on `open±Nm` or `close±Nm` only, since `anchorInstant`'s wall time is New York's; `builtin:brief` runs only on `us`. Cost: one flag at arming.
2. **One calendar per market, one date per market.** The schedule asks `calendars[orderMarket(order)].today(now)`. An order's session date, key, `expires`, status and provenance date are its market's (`dateOf(market, now)`); rotation, the once-only calendar sets and the boot's seed work per market. P2-24 is judged on the market date: `open-Nm` ≤ 570 and `close+Nm` ≤ 479 hold for XSHG (00:00 to 22:59 Beijing). The budget stays the ET day's (P2-8), so a US day that spends it refuses the next morning's A-share report. A cn calendar failure stops cn orders only, with its own line; past the XSHG table an A-share order fails closed, naming `XSHG_CLOCK`. Cost: an A-share order stops on 2027-01-01 until the table is extended.
3. **The screen line (M7).** No screen exists; a strategy's research run before the open is its Lunhui run, read through `channels.ts`'s exported run reader (`ANALYSIS_RUN_RE` names, `RUN_MANIFEST_MAX_BYTES`, `readBoundedJson`). The face imports nothing from `plugins/`, and Lunhui's looser `RUN_ID_RE` is not used. An open run (`sealed_at` null) is neither taken nor counted. A sealed run covers the previous session when its `session` is that date or later; the line names the latest-sealed covering run, else the latest-sealed run, by instant, never by string. Cost: a run sealed for an older session reads as "not run", which is the truth the operator wants.
4. **Each print on its own market (old ruling 1, per quote).** A quote is judged on its own market's date, `dateOf(q.market, now)`, and that date's session, whatever the order's market: `pre-market` or `session` on the market date, `close` on its previous session, `earlier` before that, `none` without a price or a time. Only `pre-market` and `session` carry the previous close and the gap; a `close` print's distance is the distance at the close; a `stale` quote is never `pre-market` or `session`. An A-share report at 08:00 Beijing quotes yesterday's close as `close`. Cost: no A-share gap before the open, which the auction would be the only source of.
5. **The pin, the read, the room** (old rulings 2, 4, 5; P4-10): unchanged. `levelsSha256` is 64 hex or `none`, read once after the fence through `readDeskFile`, now built on P2's descriptor read (C3). `open-Nm` must hold the producer deadline, the turn deadline and the 5-minute grace.
6. **Where a report session shows** (old ruling 11, re-placed for gravit-ui). In Messages, every `gravit-desk` conversation goes in one **Desk** group, never in a channel's, so a report never lands among the strategy's research; in Markets › Desk, each order's last firing links its session. Cost: the strategy's own group does not show its reports.
7. **Lines held by a pause survive a restart (M10).** `expire`, `miss` and `interrupt` read `deliverable()` before their append and mark the record `held: true`; a refusal, whose line goes before its record as in P2, is held when `reported: false`. A held line that reaches the phone is followed by a `phoned` record. The ledger's first read re-holds the last 3 days' held records with no `phoned` (Task 4). Cost: a held line can go twice if the face dies between the send and the `phoned` append, and a pause set between a tick's read and its send holds a line no record marks.
8. **A detached producer dies with the firing (M10).** `ProducerRunner`'s opts gain `signal`. An abort (the deadline, the schedule's dispose, the face's shutdown) sends `SIGKILL` to the child's group; the `RunResult` is `{ code: null, timedOut: false, error: "aborted" }`, the producer record `ok: false, error: "aborted"`, and no line goes out, the firing itself being cancelled. Cost: none.
9. **No migration** (old ruling 14): an order armed under P2 with no `market` key is `us`, and one with no `levelsSha256` where it needs one is P2's `not armed`.
10. **Names are the Market's (M11).** The report's block, the template and the strategy lines name a quote's `feed` and its time; the word Account appears in none of them, as P3 ruling 14 holds for the whole desk. Cost: none.
11. **The firing's walk skips `analysis/`.** The Lunhui rows own and write it concurrently, its diff is noise, and about 120 runs would truncate every walk at `FILES_WALK_MAX` before `reports/`. Cost: a turn's own write under `analysis/` goes unnamed (a §9 residual).

## Global Constraints

- **B2.** A report informs and never orders. Its template forbids recommending a trade, sizing a position, or saying an order was placed. No tool, mask or gate changes.
- **Builtins (P2-14, P4-1).** `builtin:report` is face-side, with no Python, no bars and nothing to hash. It reads only:
  - the Market's source, `Pick<MarketQuoteSource, "snapshot" | "unavailable">`, one snapshot per market;
  - `status.yaml`, through `readChannelStatus` after a guarded read;
  - `<dir>/analysis/<run>/run.json`, through `channels.ts`'s `readRunManifests`;
  - `levels.yml`, as `ProducerInput.levels`.
- **The fence (P2-4, P2-15, P4-3).** A strategy order runs in `strategies/<name>`. P2's `findChainViolation` refuses before the firing and at its turn's start, and reports after it.
- **Order, cut-off, room (P2-11, P2-16, P2-20, P2-23, P2-24, P2-25, P4-4, P4-10).** These are the old plan's Global Constraints, verbatim, applied per market. P2-24 is judged on the order's market date: `open-Nm` ≤ 570 and `close+Nm` ≤ 479 hold for XSHG.
- **B4.** Ignored: `/strategies/*/levels.yml` (already) and `/strategies/*/reports/`. Tracked: `strategies/_template/STANDING.md` and `levels.example.yml`.
- **No live network in a test.** Never the Account (and so no market host), the SEC or Telegram: the report's tests and the smoke pass fake sources.
- **Module weight.** `report.ts` loads with the schedule, on first use. `src/desk.ts` and `scripts/desk.ts` load none of it, and `arm` imports `desk-book.ts` and `xshg-clock.ts` inside the command.
- **Quote texts, exact (M11).** A source with `unavailable` set: `quotes unavailable: <its reason>`, nothing asked. One market's snapshot rejected: `US quotes unavailable: <reason>` or `A-share quotes unavailable: <reason>`, `<reason>` being `busy` for a 429, else the error's message, the other market's prices standing and `ok: true` while it priced. No symbol priced, at least one asked: `ok: false`, error `quotes unavailable: the Market's read has no price for any symbol` unless a reason above is set.
- **Phone lines, exact.** These are P4's rows; P2's and P3's tables hold the rest.

  | When | Line |
  |---|---|
  | `levels.yml` changed, appeared or oversize since arming | `<id> · <date> refused: <dir>/levels.yml changed since arming. Review it, then: npm run desk -- rearm <id>` |
  | it is gone since arming | `<id> · <date> refused: <dir>/levels.yml is gone since arming. Restore it, or re-arm without it: npm run desk -- rearm <id>` |
  | it cannot be read | `<id> · <date> refused: <dir>/levels.yml cannot be read (<reason>)` |
  | the fence refused a strategy firing | `<id> · <date> refused: <path> exists; it would steer every turn in <dir>. Remove it.` |
  | a strategy firing left a fence violation | `<id> · <date> left <path> behind; every firing in <dir> is refused, and every session in it reads it, until it is removed` |
  | a strategy firing wrote outside `reports/` (the walk skips `<dir>/analysis/`) | `<id> · <date> wrote outside reports/: <paths, sorted, ", ", at most five>[, and <k> more][; the listing stopped at <max> entries]` |
  | its directory is gone | P2's could-not-run line, `<reason>` = `<dir> is gone` |
  | a queued firing reached its cut-off | P2's missed line, `<why>` = `it was still queued at the open, behind other firings` (`close` for a close anchor) |
  | the A-share calendar failed | `no A-share standing order runs on <date>: the market calendar failed in <clock> (<error>)`; the US line stays P2's |

  `<date>` is the order's market date.
- **Tests.** Never `~/.dsh`, `launchctl` or `npm run service`. Real boots run only in `FACE_SMOKE=1` smokes; P4 extends `schedule-smoke` and adds none. Fixtures go under `face/tests/tmp/<file>-<pid>/`. Every cn fake calendar is `fakeCalendar(days, "fake XSHG", (n) => bjDate(new Date(n)))`.
- **Conventions.** `||` for env defaults; the `gravit-face:` prefix; strict typecheck; key-first refusals; explicit pathspecs.

## Review Focus

1. **The evening ET when an A-share report fires.** `open-90m` on XSHG is 19:00 or 20:00 ET the day before, and the ET date differs from the firing's. Expected: the key, the provenance line, the wake's session line, `expires` and the cut-off are all Beijing's, and the budget is the ET day's. Tests: Task 3, "an A-share order fires on its Beijing session date at 08:00 Beijing, is cut off at the Beijing open, and expires on the Beijing date" and "a budget spent on ET 2026-11-30 refuses the next Beijing morning's report".
2. **No print since the open.** Every A-share report, and a quiet US name. Expected: yesterday's close is `close` with its distance at the close; anything older is `earlier`; neither has a gap. Test: Task 1, "buildReport quotes both markets from one snapshot each, each print on its own market's date".
3. **A Lunhui run that is open, broken, old or hand-stamped.** Expected: an open run is neither taken nor counted; a link or torn `run.json` is skipped and counted, never followed; a run sealed for the session before last says `not run for <prev>`; an offset `sealed_at` is compared as an instant. Tests: Task 1, "the screen line names the newest sealed run and whether it covers the previous session; links and torn runs are skipped" and "the newest sealed run is chosen by instant, not by string …".
4. **More reports at one anchor than fit before the open.** Expected: they run in file order, and one still queued at the open is missed once and never started. Tests: Task 4, "reports at one anchor run in file order …" and "two schedules record a cut-off once …".
5. **A pause across a restart.** Expected: a missed line held by OFF reaches the phone after the next boot, once the pause lifts, and never again. Test: Task 4, "a line held by the pause is sent after a restart, once".

---

### Task 1: The report — `builtin:report`, the screen line, the template, and the producer's group kill

**Files:**
- Create: `face/src/report.ts`, `face/tests/report.test.ts`, `strategies/_template/STANDING.md`, `strategies/_template/levels.example.yml`
- Modify: `face/src/producer.ts`, `face/tests/producer.test.ts`, `face/src/desk-book.ts`, `face/tests/desk-book.test.ts`, `face/src/channels.ts`, `face/tests/channels.test.ts`, `face/src/et.ts`, `face/tests/et.test.ts`, `face/tests/desk-weight.test.ts`, `strategies/_template/status.yaml`, `.gitignore`

**Interfaces:**
- **Consumes:** P2's producer types and runners, `readScriptBytes`, `loadLevels`, `LoadResult`, `DESK_FILE_MAX_BYTES`, `STANDING_TEXT_MAX_BYTES`; HEAD's names above, `readChannelStatus`, `HttpError`; P3's `Market`, `idOf`, `Level.market`, `levelDistancePct`, `bjDate`, `bjClock`, `xshgSession`, `MarketQuoteSource`, `priceStamp`.
- **Produces, `producer.ts`:**
  - `BUILTIN_PRODUCERS = ["brief", "report"] as const`;
  - `interface VerifiedLevels { file: string; sha256: string; text: string | null }`;
  - `ProducerInput` gains `market?: Market` (absent is `us`; `date` is that market's) and `levels?: VerifiedLevels`; P2's input literals stand.
  - `readFileBytes(path: string, maxBytes: number): Promise<Buffer | "irregular" | "oversized" | { errno: string }>`, `readScriptBytes`'s body keeping the failure's code; `readScriptBytes` maps `{ errno }` to `"missing"` (C3).
  - `signal?: AbortSignal` in the opts of `ProducerRunner`, `runPinnedScript` and `runScriptProducer`, passed on; on abort `defaultProducerRunner` kills the group with `SIGKILL` and resolves `{ code: null, stdout, stderr, timedOut: false, error: "aborted" }`, so the output is `{ ok: false, error: "aborted" }`.
- **Produces, `desk-book.ts`:**
  - `readDeskFile(path: string, maxBytes: number = DESK_FILE_MAX_BYTES): Promise<{ state: "absent" } | { state: "unreadable"; reason: string } | { state: "oversize" } | { state: "ok"; bytes: Buffer; text: string }>` over `readFileBytes`: `ENOENT`/`ENOTDIR` → `absent`; another code → `unreadable` with it; `irregular` → `not a regular file`; a failed fatal UTF-8 decode → `not UTF-8`.
  - `parseLevels(text, file, today, sha256): LoadResult<Level>` — the old Task 1's.
- **Produces, `channels.ts`:**
  - `export` on `ANALYSIS_RUN_RE` and `RUN_MANIFEST_MAX_BYTES`;
  - `type RunManifest = { run: string; manifest: Record<string, unknown> } | { run: string; unusable: true } | { run: string; missing: true }`;
  - `readRunManifests(strategyDir: string, cap: number): Promise<RunManifest[]>` lists as `readAnalysisRuns` does (a real `analysis/` only, its `ENOENT`/`ENOTDIR` throws, real `ANALYSIS_RUN_RE` directories newest first, the first `cap`, `stillAt` before each read) and reads each `run.json` through `readBoundedJson(…, RUN_MANIFEST_MAX_BYTES)`: a `null` whose `lstat` throws `ENOENT` is `missing`; another `null`, `parsed: false` or a non-object is `unusable`.
- **Produces, `et.ts`:**
  - `dateOf(market: Market, now: number): string` — `etDate` or `bjDate` of `new Date(now)`;
  - `bjSessionTime(at: Date): string` — `<bjClock(at)'s HH:MM> Beijing (<etTime(at)> ET)`, e.g. `09:30 Beijing (20:30 ET)`.
- **Produces, `report.ts`:**
  - **Constants:** `SCREEN_RUNS_MAX = 200`; `STATUS_TEXT_MAX = 300`; `STATUS_NUMBERS_MAX = 20`; `NO_SCREEN = "no screen is wired for this strategy"`.
  - **The screen:** `interface Screen { wired: boolean; ran: boolean | null; line: string; run?: { id: string; kind: string; session: string; sealedAt: string; artifacts: string[] }; skipped?: number }`, in that key order, `skipped` only when above 0. Its `line` is exactly one of:
    - `ran: Lunhui run <id> (<kind>) sealed <deskTime> covers the <session> session; artifacts: <a, b | none>`;
    - `not run for the <prev> session: the last sealed Lunhui run is <id> (<kind>), for the <session> session, sealed <deskTime>`;
    - `not run: no Lunhui run in <dir>/analysis/ is sealed`;
    - `cannot tell whether the screen ran: <error>`;
    - `NO_SCREEN`.

    `<kind>` and `<session>` are the manifest's strings, else `unknown`; `<deskTime>` is `deskTime(sealedAt, now)`.
  - **`previousSessionDate(market: Market, date: string): string | { error: string }`** walks back at most 10 days through `sessionFor(xnysWindow(d, 1), d)` or `xshgSession(d)`: an uncovered XSHG day is `{ error: "the A-share calendar does not cover <d>" }`, ten empty days `{ error: "no session in the 10 days before <date>" }`.
  - **`readScreen(root, dir, market, date, now): Promise<Screen>`** over `readRunManifests(join(root, dir), SCREEN_RUNS_MAX)`:
    - `ENOENT`/`ENOTDIR` → `{ wired: false, ran: null, line: NO_SCREEN }`; another throw → `cannot tell whether the screen ran: <dir>/analysis/ cannot be read (<code>)`;
    - `missing` is ignored; `sealed_at` null or absent is open, neither taken nor counted; `skipped` counts `unusable` and a `sealed_at` that is not ISO (`^\d{4}-\d{2}-\d{2}T`, finite `Date.parse`) (B6);
    - no sealed run → `not run: no …`; else a `previousSessionDate` error → `cannot tell …: <error>`; else ruling 3's choice, `ran` true exactly when a covering run exists; `run.artifacts` is the manifest's string array, else `[]`.
  - **Quotes:** `type Print = "pre-market" | "session" | "close" | "earlier" | "none"`; `interface ReportQuote { symbol: string; market: Market; feed: string; last: number | null; at: string | null; print: Print; prevClose: number | null; sinceClosePct: number | null; status: string }`, in that key order.
    - `at` is P3's `priceStamp` for the quote: `ROBINHOOD 07:58:03 ET`, `TENCENT 15:00:03 Beijing`, dated when the print's date in its zone is not now's (`bjStamp` for an A share); `feed` is the quote's (`""` when its market was not priced); `status` is `quote_status`.
    - `print` follows ruling 4, the market date's session read as `previousSessionDate` reads one. `sinceClosePct = (last − prevClose) / prevClose · 100` for `pre-market` and `session` only.
  - **Levels:** `ReportLevel` is the old Task 1's, gaining `market` after `symbol`. `closeDistancePct` is `levelDistancePct(level, prevClose)` for `pre-market` and `session`, and equals `distancePct` for `close`; `crossedSinceClose` is the old Task 1's rule for `pre-market` and `session`, else `null`.
  - **The block:** `interface Report { strategy; market: Market; date; takenAt; session: { open; close; early }; screen: Screen; statusFile; status; quotes: ReportQuote[]; quotesError?: string; levels: { file; rows; refusals; missing?: true; error?: string } }`, in that key order.
    - `takenAt` is `<etClock> ET`.
    - `session` is `etTime … ET` for US and `bjSessionTime` for an A share.
  - **The producer:** `interface ReportDeps { quotes: Pick<MarketQuoteSource, "snapshot" | "unavailable">; root: string; now?: () => number }`; `reportProducer(deps): BuiltinProducer`; `buildReport(deps, input): Promise<ProducerOutput>`, its text `JSON.stringify(report)`.
- **The rules `buildReport` keeps:** the old Task 1's refusals, levels, status and percentages, with these changes.
  - **The screen first:** `readScreen(root, input.dir, input.market ?? "us", input.date, now)`, before any quote is asked.
  - **One snapshot per market** that has symbols, in parallel, each over that market's ids alone (`idOf(level.market, level.symbol)`, distinct, first-seen order).
  - **The texts** are the Global Constraints' "Quote texts". A rejected market's quotes are `print: "none"`, `status: "unavailable"`, every number `null`; several reasons join with `; `.
- **`strategies/_template/STANDING.md`** (tracked) is the old Task 1's text, edited: paragraph 2 names `the face's one snapshot of this strategy's screen line, status, levels and prices`; the list opens `1. The screen: its screen.line from the block, verbatim.`, then the old items 1, 2 and 4 as 2–4, `with its source and time` reading `with its feed and time`; and the gap paragraph reads: `A pre-market print's sinceClosePct is its overnight gap. A close print is the previous session's close: its closeDistancePct is the distance at the close. An earlier print has no gap and no previous close: say "no print since" and its time. Every price names its feed and time as the block gives them (ROBINHOOD 07:58:03 ET, TENCENT 15:00:03 Beijing).`
- **`levels.example.yml`, `status.yaml` and `.gitignore`:** as the old Task 1. `levels.example.yml` adds a third entry, `symbol: "600519"` (quoted), a `watch` at 1450 `cross_up` with a plan, a `source` and `expires: 2026-12-31`.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/report.test.ts — root face/tests/tmp/report-<pid>/: strategies/demo/status.yaml (researching, ONE_LINE, a next, numbers { hit_rate: 0.54 }),
// strategies/demo/analysis/<run>/run.json fixtures in the id form; a fake source recording each snapshot's ids, priced from one table per market
const NOW = () => Date.parse("2026-11-27T13:00:05Z");
test("buildReport quotes both markets from one snapshot each, each print on its own market's date", async () => { // RF 2
  // input.market "us", date "2026-11-27", session 14:30Z-18:00Z early. LEVELS: NVDA target 180 cross_up; AAPL buy_zone [218,222] enter; IBM watch 230 cross_up;
  // 600519 stop 1400 cross_down. Table: NVDA 181.5 prev 178.2 as_of 2026-11-27T12:58:03Z; AAPL 236.1 as_of 2026-11-25T20:59:58Z; IBM 231 as_of
  // 2026-11-24T20:59:58Z; all feed robinhood; 600519 1398.5 prev 1420 as_of 2026-11-27T07:00:03Z feed tencent; all live
  assert.deepEqual(source.calls.map((c) => c.map((a) => a.id)).sort(), [["cn:600519"], ["us:NVDA", "us:AAPL", "us:IBM"]]);
  assert.deepEqual(r.quotes, [
    { symbol: "NVDA", market: "us", feed: "robinhood", last: 181.5, at: "ROBINHOOD 07:58:03 ET", print: "pre-market", prevClose: 178.2, sinceClosePct: 1.85, status: "live" },
    { symbol: "AAPL", market: "us", feed: "robinhood", last: 236.1, at: "ROBINHOOD 2026-11-25 15:59:58 ET", print: "close", prevClose: null, sinceClosePct: null, status: "live" },
    { symbol: "IBM", market: "us", feed: "robinhood", last: 231, at: "ROBINHOOD 2026-11-24 15:59:58 ET", print: "earlier", prevClose: null, sinceClosePct: null, status: "live" },
    { symbol: "600519", market: "cn", feed: "tencent", last: 1398.5, at: "TENCENT 15:00:03 Beijing", print: "session", prevClose: 1420, sinceClosePct: -1.51, status: "live" }]);
  // rows (distancePct, closeDistancePct, crossedSinceClose): NVDA -0.83, 1.01, true; AAPL -5.97, -5.97, null; IBM -0.43, null, null; 600519 0.11, -1.41, true
  assert.equal(r.takenAt, "08:00:05 ET"); assert.deepEqual(r.session, { open: "09:30 ET", close: "13:00 ET", early: true }); assert.equal(r.market, "us");
  assert.doesNotMatch(text, /Account/);
  // the same input with market "cn" and XSHG's 2026-11-27 (01:30Z-07:00Z) → r.session { open: "09:30 Beijing (20:30 ET)", close: "15:00 Beijing (02:00 ET)", early: false }
});
test("the screen line names the newest sealed run and whether it covers the previous session; links and torn runs are skipped", async () => { // RF 3
  // now 2026-11-30T00:00:05Z, market cn, date 2026-11-30 (previous XSHG session 2026-11-27). Runs: A1 = 20261127T081000Z-000000a1 sealed 2026-11-27T08:10:00Z,
  //   session 2026-11-27, kind market, artifacts ["environment","sentiment"]; A0 = 20261126T081000Z-000000a0 sealed 2026-11-26T08:10:00Z, session 2026-11-26;
  //   20261128T010000Z-000000a2 sealed_at null; 20261128T020000Z-000000a3 whose run.json is a symlink; 20261128T030000Z-000000a4 not JSON; a dir "notes"
  assert.deepEqual(screen, { wired: true, ran: true, line: "ran: Lunhui run 20261127T081000Z-000000a1 (market) sealed 2026-11-27 03:10 ET covers the 2026-11-27 session; artifacts: environment, sentiment",
    run: { id: "20261127T081000Z-000000a1", kind: "market", session: "2026-11-27", sealedAt: "2026-11-27T08:10:00Z", artifacts: ["environment", "sentiment"] }, skipped: 2 });
  // only A0 → ran false, "not run for the 2026-11-27 session: the last sealed Lunhui run is 20261126T081000Z-000000a0 (market), for the 2026-11-26 session, sealed 2026-11-26 03:10 ET"
  // analysis/ empty → "not run: no Lunhui run in strategies/demo/analysis/ is sealed"; no analysis/, or a link to one → { wired: false, ran: null, line: NO_SCREEN }
  // date 2027-01-04 with A1 → ran null, "cannot tell whether the screen ran: the A-share calendar does not cover 2027-01-03"
});
test("the newest sealed run is chosen by instant, not by string, and a later-sealed older-session run does not hide a covering one", async () => { // R4
  // B1 sealed "2026-11-27T09:30:00+08:00", B2 sealed "2026-11-27T02:00:00Z", both session 2026-11-27; B3 sealed "2026-11-27T03:00:00Z", session 2026-11-26 →
  //   ran true, run.id B2's, line "ran: Lunhui run <B2> (market) sealed 2026-11-26 21:00 ET covers the 2026-11-27 session; artifacts: none"
});
test("previousSessionDate walks back over weekends and holidays, and refuses past the XSHG table", () => {
  assert.equal(previousSessionDate("cn", "2026-10-08"), "2026-09-30"); assert.equal(previousSessionDate("us", "2026-11-30"), "2026-11-27");
  assert.equal(previousSessionDate("us", "2026-11-27"), "2026-11-25");
  assert.deepEqual(previousSessionDate("cn", "2027-01-04"), { error: "the A-share calendar does not cover 2027-01-03" });
});
test("the screen leads the block, and a full levels file with a 5,000-character next keeps it inside the cap", async () => {
  // the old RF 4 test; Object.keys(r) = ["strategy", "market", "date", "takenAt", "session", "screen", "statusFile", "status", "quotes", "levels"];
  //   text.slice(0, 32_768).includes('"screen":{"wired":')
});
test("an unavailable source says so; a rejected market stands alone; a strategy with no levels calls no source", async () => {
  // { unavailable: "no Market read is wired" } → { ok: false, error: "quotes unavailable: no Market read is wired" }, no snapshot, every last null
  // cn rejects HttpError(429, "busy"), us priced → ok true, quotesError "A-share quotes unavailable: busy", 600519 { print: "none", status: "unavailable" }, NVDA priced
  // us rejects Error("the Account is not reachable"), cn priced → ok true, quotesError "US quotes unavailable: the Account is not reachable"
  // both answer with no price → { ok: false, error: "quotes unavailable: the Market's read has no price for any symbol" }; levels { sha256: "none", text: null } → no call, quotes [], ok true
});
test("a malformed, a missing and an unreadable status.yaml are named, not invented", async () => { /* the old test */ });
test("the report reads the verified bytes, never the file, and refuses what is not its own", async () => { /* the old test */ });
test("the template's STANDING.md is the pre-market order, the screen first", () => {
  // the old phrases, "IEX 07:58:03 ET" replaced by "ROBINHOOD 07:58:03 ET, TENCENT 15:00:03 Beijing", plus "screen.line" and "closeDistancePct";
  // text.indexOf("1. The screen") < text.indexOf("2. The strategy"); no "Account"; bytes ≤ STANDING_TEXT_MAX_BYTES
});
test("the template's levels.example.yml loads with no refusal", async () => { /* kinds ["buy_zone", "stop", "watch"]; entries[2].market "cn" */ });
// face/tests/producer.test.ts (append)
test("an aborted run kills the producer's whole group", async () => {
  // node as the interpreter, a fixture script that spawns a sleeping child and prints both pids; abort after 200 ms →
  // within 2 s, { code: null, timedOut: false, error: "aborted" }; process.kill(childPid, 0) throws ESRCH
});
// producer.test.ts: parseProducer("builtin:report") → { kind: "builtin", name: "report" }; the unknown pin moves to "builtin:nope"
// channels.test.ts: "readRunManifests lists run directories by the id form, newest first, and says why a manifest is unusable" —
//   a run dir that is a symlink and a dir "notes" are not listed; no run.json → missing; a symlinked or 20 KiB run.json → unusable
// desk-book.test.ts: the old readDeskFile and parseLevels tests (oversize now { state: "oversize" }), plus "readDeskFile honours its cap"
// et.test.ts: dateOf("cn", Date.parse("2026-11-30T23:59:50Z")) === "2026-12-01"; bjSessionTime(new Date("2026-11-27T01:30:00Z")) === "09:30 Beijing (20:30 ET)"
// desk-weight.test.ts: "/src/report.ts" joins HEAVY
```

- [ ] **Step 2: Run them to verify they fail** — `cd face && npx tsx --test tests/report.test.ts tests/producer.test.ts tests/desk-book.test.ts tests/channels.test.ts tests/et.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `report.ts`, the producer additions and the signal kill, `readFileBytes`, `readDeskFile`, `parseLevels`, `readRunManifests`, `dateOf`, `bjSessionTime`, and the template files.
- [ ] **Step 4: Run them to verify they pass** — `npm test && npm run typecheck`; `git check-ignore -q strategies/demo/reports/2026-11-27-premarket.md` exits 0; `git check-ignore strategies/_template/STANDING.md strategies/_template/levels.example.yml` prints nothing. Expected: PASS.
- [ ] **Step 5: Commit** — the files above, message `feat(face): builtin:report - the Lunhui run as the screen line, status, verified levels and one snapshot per market, each print on its own market; the template's pre-market order; an aborted producer's group killed`.

---

### Task 2: Arming a strategy order — `market`, the `levels.yml` pin and the `open-Nm` room rule

**Files:**
- Modify: `face/src/standing.ts`, `face/tests/standing.test.ts`, `face/src/desk-book.ts`, `face/scripts/desk.ts`, `face/tests/desk-cli.test.ts`, `face/tests/desk-arm.test.ts` (its `USAGE` gains the `--market` part, and its one strategy arming, `alpha-open`, now prints `, no strategies/alpha/levels.yml` and loads `levelsSha256: "none"`)

**Interfaces:**
- **Consumes:** Task 1 (`readDeskFile`, `parseLevels`, `BUILTIN_PRODUCERS`, `dateOf`); P3 (`Market`, `Level.market`, `bjDate`, `XSHG_CLOCK`, `xshgMarketClock`, `createMarketCalendar`'s `dateOf`); P2's `standing.ts`, `runDesk`, `roomProblem`, `sha256Hex`.
- **Produces, `standing.ts`:**
  - **From the old Task 2, unchanged:** `LEVELS_NONE`, `REPORT_PLACE`, `needsLevelsPin`, `levelsSha256` on `StandingOrder`, `ArmEntry` and `OrderChange`, and the `REWRITTEN_LINE_RE` key.
  - **`StandingOrder.market?: Market`** and `ArmEntry.market?: Market`; `orderMarket(o: { market?: Market }): Market` returns `o.market ?? "us"`. `ORDER_KEYS` gains `market` after `dir`. A parsed order has the key only when the file has it. `renderOrder` writes `market: "cn"` right after `dir`, and only for `cn`, and `matchesEntry` compares it. P2's literals (`standing.test.ts` lines 51 and 321, `firing.test.ts` line 95, `desk-arm.test.ts`) stand unchanged.
  - **`roomProblem(anchor, need)`** covers `open-Nm` too, with the old plan's exact text. P2-24's bounds stay `parseAnchor`'s, and they hold on the Beijing date.
  - **`parseStanding` gains these refusals:**
    - the old Task 2's four;
    - `orders[<i>] (<id>): market must be us or cn`;
    - `orders[<i>] (<id>): an A-share order anchors on the open or the close, not <HH:MM>`;
    - `orders[<i>] (<id>): builtin:brief is the US pre-close brief; it runs only with market: us`.
- **Produces, `desk-book.ts`:** `levelsPin(root, dir, today)`, as the old Task 2.
- **Produces, `scripts/desk.ts`:**
  - `arm` takes `--market us|cn` (in `VALUE_FLAGS`; anything else is `--market <v> is not us or cn`). `DeskDeps` gains `cnMarketClock?: MarketClock`.
  - **The market's date.** `expiresProblem(m, expires, now, market)` reads `dateOf(market, now)` and, for cn, says `--expires <d> is before today, <today> Beijing`. The day check for cn is `createMarketCalendar({ ask: deps.cnMarketClock ?? xshgMarketClock(), clock: XSHG_CLOCK, dateOf: (n) => bjDate(new Date(n)) })`. `levelsPin` takes the same date.
  - **`USAGE`'s arm part** gains ` [--market us | cn]` after `--expires YYYY-MM-DD`.
  - **The success line** gains `, market cn` (only for cn) before the producer part, and the levels part as the old Task 2.
  - **One note** when the order is `us`, needs the pin, and every entry of its `levels.yml` has `market: "cn"`: `note: every symbol in <dir>/levels.yml is an A share; arm with --market cn, or the report fires on New York's open`.
  - **`rearm`** works as the old Task 2, its `--expires` and pin on the order's market date.

- [ ] **Step 1: Write the failing tests** — the old Task 2's tests (its `FULL_REPORT` fixture gains `market: "cn"` in one copy), plus:

```ts
test("market is us by default, cn when written, and anything else refused; a P2 order renders byte-identically", () => {
  // parseStanding(`orders:\n${renderOrder(ENTRY, 2)}`) → Object.hasOwn(orders[0], "market") false, orderMarket(orders[0]) "us";
  // renderOrder(ENTRY, 2) equals P2's fixture text byte for byte; renderOrder({ ...ENTRY, market: "cn" }, 2) has '    market: "cn"\n' right after the dir line,
  //   and parses to market "cn"; market: "jp" → "orders[0] (preclose): market must be us or cn"
});
test("an A-share order may not anchor on a wall time, and builtin:brief runs only on us", () => {
  // market: cn with at: "08:00" → "orders[0] (demo-report): an A-share order anchors on the open or the close, not 08:00"
  // builtin:brief with market: cn → "orders[0] (preclose): builtin:brief is the US pre-close brief; it runs only with market: us"
});
// desk-cli.test.ts (append)
test("arm --market cn pins a Lunhui strategy's report and prints its market", async () => {
  // now 2026-11-30T02:00:00Z; runDesk("arm", ["strategies/demo", "--id", "demo-report", "--at", "open-90m", "--market", "cn", "--producer", "builtin:report", "--expires", "2026-12-31"], …)
  // → 0; standing.yml's order has market: cn; out → [`armed demo-report in ${root}: strategies/demo/STANDING.md sha256 ${s12}…, at open-90m, expires 2026-12-31,
  //   market cn, producer builtin:report, no strategies/demo/levels.yml; the face reads standing.yml again within 30 s`]
});
test("arm --market cn --at open-570m is armed: the offset stays on the Beijing date", async () => { /* → 0 */ });
test("arm --market cn at 2026-11-30T02:00:00Z with --expires 2026-11-29 is refused", async () => { // R3
  // → 1, out ["cannot arm demo-report: --expires 2026-11-29 is before today, 2026-11-30 Beijing"]; standing.yml unchanged
});
test("arm without --market over a levels.yml whose every symbol is an A share prints one note naming --market cn", async () => { // R3
  // levels.yml with two "600519"/"000001" entries → 0; out[1] "note: every symbol in strategies/demo/levels.yml is an A share; arm with --market cn, or the report fires on New York's open"
});
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/standing.test.ts tests/desk-cli.test.ts` FAIL, then implement, then PASS with `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** — the six files and this plan, message `feat(face): arming names a strategy's market and reads its date, pins its levels.yml beside its STANDING.md, and an open anchor must hold its deadlines and the grace`.

---

### Task 3: The schedule per market, the pin at the firing, and wherever an order's state shows

**Files:**
- Modify: `face/src/schedule.ts`, `face/src/firing.ts`, `face/src/standing.ts` (`StandingStatus`), `face/src/desk.ts` (`installDesk`'s hand-off; `standingLines`), `face/src/desk-session.ts` (`createDeskAgent`'s `make`), `face/client/js/host/desk-view.js` (the standing rows' hash and market cells)
- Test: `face/tests/schedule.test.ts`, `face/tests/firing.test.ts`, `face/tests/desk.test.ts`, `face/tests/desk-session.test.ts`, `face/tests/client/desk-view.test.js`

**Interfaces:**
- **Consumes:** Tasks 1–2 (`orderMarket`, `dateOf`, `bjSessionTime`, `readDeskFile`, `reportProducer`); P3's `DeskCalendars`, `deskCalendars`, `fakeCalendar`'s `dateOf`, `unwiredMarketQuotes`, `briefProducer`; P2's `installSchedule`, `createDeskSchedule`, `checkFiring`, `runFiring`, `LINES`.
- **Produces, `firing.ts`:**
  - the old Task 3's `levels-hash` refusal, `Verified.levels`, the check order (OFF, budget, fence, `STANDING.md`, script, levels), `started.levelsSha`, its three `LINES` rows, and `make: order.dir === "desk"`;
  - `produce` adds `market` to the input only when the order has one, and `levels: verified.levels`, and passes `signal: run.signal` to `runScriptProducer` (S7, S13);
  - `LINES.noCalendar(clock: string, error: string, market: Market = "us", date?: string)`: `us` keeps P2's text, `cn` is the Global Constraints' line (S4);
  - `wakeMessage`'s session line prints a cn session as `open <bjSessionTime>, close <bjSessionTime>` (S16).
- **Produces, `schedule.ts`:**
  - **The calendars.** `ScheduleDeps` gains `calendars?: Partial<DeskCalendars>`; P2's `calendar` is the US one, cn defaulting to `deskCalendars().cn` (builtin, offline).
  - **Each tick**, per market with an enabled order unexpired on `dateOf(market, now)`: one `calendars[market].today(now)`, each order weighed on its own market's answer, keyed `firingKey(id, <market session date>)`.
  - **Per-market memory (S5).** `calendarEvented`/`calendarPhoned` keyed `<market>:<date>`; `carry` keeps records whose `date` is either market's today; `seed` matches a `calendar-error` to the market whose calendar has its `clock`, on that market's date; a failure is phoned with `LINES.noCalendar(clock, error, market, date)`.
  - **The status.** `StandingStatus.orders[]` gains `market?: Market` (always set) and `levelsHash?` (old Task 3); `expired` and `nextAnchor` read the order's market date and window. `StandingStatus` gains `calendars?: Partial<Record<Market, StandingStatus["calendar"]>>`, `calendar` staying the US one for P2's and P3's readers. One P2 assertion changes: `schedule.test.ts`'s `s.orders[0]` deepEqual (line 948) gains `market: "us"`.
  - **Lines:** a `levels-hash` line once per changed detail, as the old Task 3.
  - **`deskBuiltins(opts: { quotes?: MarketQuoteSource; root: string; home: string; now: () => number }, seams?: Partial<Record<BuiltinName, BuiltinProducer>>): Record<BuiltinName, BuiltinProducer>`:** `quotes` defaults to `unwiredMarketQuotes()`; `report` is `reportProducer({ quotes, root, now })`, `brief` is `briefProducer({ quotes, root, home })`; a seam replaces only the names it gives.
  - **`createDeskSchedule`** keeps its optional `quotes`; its `seams` gain `calendars`. It hands `installSchedule` `calendars = deskCalendars({ ...(seams.calendar && { us: seams.calendar }), ...seams.calendars })`, `calendar: calendars.us`, and `deskBuiltins({ quotes, root, home, now: () => clock.now() }, seams.builtins)`.
- **Produces, `desk.ts`:** `installDesk` hands its one `DeskCalendars` (P3 Task 9) to `createDeskSchedule` as `seams.calendars`. `standingLines` gains the old Task 3's three lines, `standing <id>: market cn`, and `standing orders: no A-share calendar today, <clock>: <error>` when `calendars.cn` failed.
- **Produces, `desk-session.ts`:** `createDeskAgent(deps, { cwd, route?, make? })`, as the old Task 3.
- **Produces, client:** `deskViewOf`'s standing rows show `levels.yml changed`, `levels.yml gone` or `levels.yml unreadable` in the hash cell, and the order's market.

- [ ] **Step 1: Write the failing tests** — the old Task 3's `firing.test.ts`, `schedule.test.ts`, `desk.test.ts` and `desk-session.test.ts` cases, unchanged but for the builtins' deps, plus:

```ts
// face/tests/schedule.test.ts (append; rig(…, { calendars: { cn: fakeCalendar(CN_DAYS, "fake XSHG", (n) => bjDate(new Date(n))) } }),
//   CN_DAYS: 2026-12-01 and 2026-12-02 at 01:30Z-07:00Z; lunhui-report in strategies/demo, market cn, open-90m, builtin:report)
test("an A-share order fires on its Beijing session date at 08:00 Beijing, is cut off at the Beijing open, and expires on the Beijing date", async () => { // RF 1
  // expires 2026-12-01. tick 2026-11-30T23:59:50Z (ET 18:59) → nothing; 2026-12-01T00:00:10Z → one run, item.date "2026-12-01", key "lunhui-report:2026-12-01",
  //   cutoffOf(item) === Date.parse("2026-12-01T01:30:00Z"); 2026-12-01T16:00:10Z (Beijing 2026-12-02, ET still 2026-12-01) → one expired record, its line once
});
test("a budget spent on ET 2026-11-30 refuses the next Beijing morning's report", async () => { // R2, and RF 1's budget day
  // budget.dailyTokens 1,000; a desk-turn of 1,000 tokens at 2026-11-30T15:00:00Z; expires 2026-12-31 →
  //   2026-12-01T00:00:10Z refused budget with LINES.budgetSpent(state) (since 00:00 ET); 2026-12-02T00:00:10Z → run(lunhui-report:2026-12-02)
});
test("a calendar failure is per market: a cn order stops, a us order fires", async () => {
  // cn today() { ok: false } on 2026-12-01 → one calendar-error { clock: "fake XSHG", date: "2026-12-01" },
  //   "no A-share standing order runs on 2026-12-01: the market calendar failed in fake XSHG (the fake calendar has no 2026-12-01)"; the us order runs;
  //   a us failure on 2026-12-01 as well → a second event and P2's line: one market's date never masks the other's
});
test("a rotation at 2026-12-01T00:30Z carries lunhui-report:2026-12-01's started; a restart then seeds the cn calendar-error for its Beijing date and phones it once", async () => { // R5
  // the P2 rotation pattern: the new file opens with lunhui-report:2026-12-01's started and finished;
  // the cn calendar failing on Beijing 2026-12-02 at 2026-12-01T17:00:00Z → one event, one line; a new schedule at 17:10Z → no event, no line
});
test("status carries each order's market and levelsHash, and each market's calendar", async () => {
  // orders[].market "cn" / "us"; levelsHash "ok", edited → "changed"; calendars.cn.clock "fake XSHG"; calendars.us deepEquals calendar
});
test("deskBuiltins: both builtins over the one source, a seam replaces only its names", async () => {
  // deskBuiltins({ quotes, root, home, now }) → Object.keys sorted ["brief", "report"]; { brief: fake } → brief === fake, report !== fake;
  // no quotes → report over a strategy with levels answers { ok: false, error: `quotes unavailable: ${unwiredMarketQuotes().unavailable}` };
  // now 2026-11-30T13:00:05Z → the default report's takenAt "08:00:05 ET"
});
// face/tests/firing.test.ts (append)
test("a cn wake message dates its session in Beijing and New York", () => {
  // wakeMessage({ item: lunhui-report on 2026-12-01, firedAt 2026-12-01T00:00:10Z, verified }) → line 0 "[schedule · lunhui-report · 2026-12-01]";
  //   line 1 starts "Standing order lunhui-report, for the 2026-12-01 session (open 09:30 Beijing (20:30 ET), close 15:00 Beijing (02:00 ET)), fired at 19:00:10 ET."
});
test("a firing aborted while its script producer runs kills the producer and phones nothing", async () => {
  // abort at 200 ms → producer record { ok: false, error: "aborted" }; no deliver call; the producer's child is gone (ESRCH)
});
// face/tests/client/desk-view.test.js (append): a changed levels.yml shows in its order's hash cell, with "cn" in its market cell
// face/tests/desk.test.ts (append): standingLines prints "standing orders: no A-share calendar today, fake XSHG: <error>" and "standing lunhui-report: market cn"
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/firing.test.ts tests/schedule.test.ts tests/desk.test.ts tests/desk-session.test.ts tests/client/desk-view.test.js` FAIL, then implement, then PASS with `npm test && npm run typecheck`. P2's schedule tests stay green but for line 948's `market: "us"`: they pass `calendar`, and no order has `market`.
- [ ] **Step 5: Commit** — the files above, message `feat(face): the clock row per market - each order on its own calendar and date, its records carried and seeded per market; a strategy firing checks its levels.yml pin after the fence; deskBuiltins over the one source`.

---

### Task 4: Strategy firings — the cut-off at start, the strategy's lines, held lines across a restart, and where a report shows

**Files:**
- Modify: `face/src/firing.ts`, `face/src/schedule.ts`, `face/client/js/host/list-view.js`, `face/client/js/host/desk-view.js`, `face/client/js/render/desk.js`
- Test: `face/tests/firing.test.ts`, `face/tests/schedule.test.ts`, `face/tests/client/list-view.test.js`, `face/tests/client/desk-view.test.js`

**Interfaces:**
- **Consumes:** P2's `cutoffOf`, `LINES`, `appendRecordOnce`, `snapshotFiles`, `diffFiles`, `FILES_WALK_MAX`, `deliverable`, `sendOnce`, `flushHeld`, `readLedger`, `CARRIED`, `FIRING_KINDS`; Task 3; the client's `bucketFor(channel, archived, bot, member, desk)`, `DESK_KEY` (`wire/grouping.js`) and `isDeskPreset` (`wire/speaker.js`).
- **Produces, `firing.ts` and `schedule.ts`:**
  - from the old Task 4: `LINES.fence(item, path)`, `LINES.leftBehind(item, path)`, `LINES.outsideReports(item, paths, truncated)`, `OUTSIDE_REPORTS_MAX = 5`, `FiringDeps.filesWalkMax?`, the cut-off at start through `appendRecordOnce`, and `why: "cutoff"`;
  - **the walk (ruling 11):** `snapshotFiles(dir, max, skip: ReadonlySet<string> = new Set())` leaves out the top-level names in `skip`; a strategy firing's two walks pass `new Set(["analysis"])`, the desk's none;
  - **held lines (ruling 7):**
    - the `missed`, `interrupted` and `expired` records gain `held?: true`, set when `held.length > 0 || !(await deliverable())` before the append;
    - `type PhonedRecord = { t: string; kind: "phoned"; key: string; of: "refused" | "missed" | "interrupted" | "expired" }` joins `FiringRecord`, `FIRING_KINDS` and `CARRIED`; `carry` hands on a `phoned` whose key a carried line has; `outcomeOf` reads it `phoned`, and `summaryOf` lists it not;
    - `held` holds `{ text, phoned?: { key, of } }`, and each line so marked is followed by its `phoned` record once it reaches the phone, from `sendOnce` or `flushHeld`;
    - `readLedger`'s first pass re-holds, in ledger order, the records whose `t` is within 3 days of now, with no `phoned` of their key and kind: a `held` missed, interrupted or expired, its line from `LINES`; a refused with `reported: false` and reason `hash`, `fence` or `levels-hash`, for an order still loaded, whose line `refusalLine` would send now, one per `<order> <reason> <detail>`.
- **Produces, client:**
  - `groupsOf` passes `desk: isDeskPreset(c.preset)` to `bucketFor`, and the `DESK_KEY` group is `{ kind: "desk", label: "Desk" }`, ordered right after the root channel.
  - `deskViewOf`'s standing rows carry `last.sessionId`, from P2's `FiringSummary`, and `renderDeskTab` links it as `#/messages/<sessionId>`, the Messages route.

- [ ] **Step 1: Write the failing tests** — the old Task 4's three `firing.test.ts` and two `schedule.test.ts` cases (RF 4), plus:

```ts
// face/tests/firing.test.ts (append)
test("a strategy whose analysis/ holds 2,100 files, with a turn that writes only reports/, sends no outside-reports line", async () => { // R1
  // 2,100 files under strategies/demo/analysis/<run>/; the turn adds reports/2026-11-30-premarket.md and analysis/<run>/x.json →
  //   finished.files [{ path: "reports/2026-11-30-premarket.md", change: "added" }], no filesTruncated; deliver calls [<text>]
});
// face/tests/schedule.test.ts (append; the rig's deliver answers { undelivered: "paused" } while OFF is set)
test("a line held by the pause is sent after a restart, once", async () => { // RF 5
  // OFF set; an anchor passes asleep → missed record { held: true }, nothing delivered; dispose; a new schedule over the same home; OFF lifted;
  // first tick → deliver(LINES.missed(record)) once, then { kind: "phoned", key: record.key, of: "missed" }; a third schedule sends nothing
});
test("a fence line held by the pause reaches the phone after a restart once; a hash refusal already phoned is not held again", async () => {
  // OFF set; a fence refusal → refused { reported: false }; restart, OFF lifted → LINES.fence(item, path) once, then phoned { of: "refused" };
  // a hash refusal reported: true, and the next day's same detail (reported: false, no line) → a restart sends nothing for either
});
// face/tests/client/list-view.test.js (append)
test("every desk conversation is in the Desk group, never in a channel's", () => {
  // a gravit-desk conversation whose channel is strategies/demo → group kind "desk", label "Desk", right after the root; demo's group lists none of it
});
// face/tests/client/desk-view.test.js (append): a standing row links its last firing's session as #/messages/<sessionId>
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/firing.test.ts tests/schedule.test.ts tests/client/list-view.test.js tests/client/desk-view.test.js` FAIL, then implement, then PASS with `npm test && npm run typecheck`. Hard-reload any browser showing the page.
- [ ] **Step 5: Commit** — the files above, message `feat(face): strategy firings - a queued firing past its cut-off is missed once, lines that name the strategy, a walk that skips analysis/, held lines survive a restart, reports in the Desk group and on Markets › Desk`.

---

### Task 5: `schedule-smoke`'s strategy cases

**Files:**
- Modify: `face/tests/schedule-smoke.test.ts`

**Interfaces:**
- **Consumes:** Tasks 1–4; P2's scaffold (`WallClock`, `fakeCalendar`, the recorder, the stub deciding by the wake's first line, `tickAt`, `heard`, `said`); P3's `installDesk` `quotes` and `schedule.calendars`; `writeStanding`, `renderOrder`, `sha256Hex`.
- **The scaffold:** the old Task 5's, with these changes.
  - **No watch.** `installDesk` gets no `watchRow`, so P3's watch never reads the strategies' `levels.yml` and nothing but the file's own firings reaches the recorder.
  - **The source.** One fake `MarketQuoteSource` over two tables, one per market, as `installDesk`'s `quotes`, in place of P2's `hub`.
  - **Calendars.** `schedule: { clock, calendar, calendars: { cn }, tickMs, runScript, builtins: { brief } }`, so `report` is `deskBuiltins`' own:
    - `calendar` (us) holds P2's 2026-11-27, then 2026-11-28 and 2026-11-29 closed, and 2026-11-30 at 14:30Z–21:00Z;
    - `cn` is `fakeCalendar({...}, "fake XSHG", (n) => bjDate(new Date(n)))`, holding 2026-11-30 and 2026-12-01 at 01:30Z–07:00Z: the last cases tick on Beijing's 2026-12-01.
  - **Strategies**, made before the boot, each with the template's `STANDING.md`:
    - `demo-a` (US): an NVDA `target` at 180 `cross_up`, a filled `status.yaml`, no `analysis/`; NVDA priced 181.5 (prev 178.2, as_of 2026-11-30T12:58:03Z, feed robinhood);
    - `demo-b` (cn): a `"600519"` stop at 1400 `cross_down`, the template's `status.yaml`, and `analysis/20261127T081000Z-000000b1/run.json` sealed 2026-11-27T08:10:00Z for 2026-11-27 (the previous XSHG session) with two artifacts; 600519 priced 1398.5 (prev 1420, as_of 2026-11-27T07:00:03Z, feed tencent).
  - **The book.** After P2's case 10, `writeStanding` (expecting the text it replaces) holds only P4's orders and P2's `abort`, re-armed at `close+90m`. All are armed at `ARMED_AT`. `open-30m`, `open-15m` and `open-10m` orders carry `turnDeadline: 1m`, inside the room rule. P2's other orders leave the book, so their 2026-11-30 wall times are never weighed.
  - **Keys.** `key(id, date = DATE)`, so a case names its own session date.
- [ ] **Step 1: Write the cases**, after P2's ten, in clock order:
  11. **An A-share report.** `demo-b-report` (`market: cn`, `open-90m`, anchor 2026-11-30T00:00Z): a tick at 2026-11-29T23:59:50Z fires nothing; at 00:00:10Z it fires in a fresh `gravit-desk` session with cwd `strategies/demo-b`. The stub sees:
      - `[schedule · demo-b-report · 2026-11-30]`, and `open 09:30 Beijing (20:30 ET)` on the session line;
      - a block holding `"screen":{"wired":true,"ran":true`, `"market":"cn"`, `"print":"close"` and `TENCENT 2026-11-27 15:00:03 Beijing`, and nowhere the word `Account`.

      It writes `reports/2026-11-30-premarket.md` and ends `REPORT-B`; no outside-reports line follows.
  13. **The canary in a strategy:** the old case 12, on `demo-b`: `demo-b-canary` (`open-30m`, fired at 01:00:10Z) and `demo-b-next` (`open-15m`), with the old assertions. `demo-b-next` is refused `hash` at 01:15:10Z, refused `levels-hash` at 01:16:00Z with `STANDING.md` restored, and fires at 01:16:30Z with `levels.yml` restored, ending `NEXT-B`.
  12. **Two US reports at one anchor.** `demo-a-report`, then `demo-a-second`, both `open-90m`: nothing at 12:59:50Z; at 13:00:10Z they run in file order, ending `REPORT-A` and `SECOND-A`. a's block holds `"screen":{"wired":false` with `no screen is wired for this strategy`, `"print":"pre-market"` and `ROBINHOOD 07:58:03 ET`.
  14. **The fence in a strategy:** the old case 13, on `demo-a`, `open-10m`, refused at 14:20:10Z.
  15. **A producer-only strategy order:** the old case 14, `close+60m` on `demo-a`, at 22:00:10Z.
  - **The delivery check**, moved here from after case 10: `said` gains `REPORT-B`, `CANARY-B`, `NEXT-B`, `REPORT-A` and `SECOND-A`, and every firing that spoke delivered once through the recorder.
  - **4b, last.** P2's abort case, unchanged but for its time: `abort:2026-11-30` at 22:30:05Z.
  - **Across the file.** `woken` is P2's seven 2026-11-27 keys, then `demo-b-report`, `demo-b-canary`, `demo-b-next`, `demo-a-report`, `demo-a-second` and `abort`, each on 2026-11-30; `created.slice(1)` follows it; `sent` equals `expected`; `faceLog` still holds the one stderr line.
- [ ] **Step 2: Run it** — `cd face && FACE_SMOKE=1 npx tsx --test tests/schedule-smoke.test.ts`. Expected: PASS.
- [ ] **Step 3: Run the whole suite** — `FACE_SMOKE=1 npm test`. Expected: every file green, with the real-boot count unchanged.
- [ ] **Step 4: Commit** — `face/tests/schedule-smoke.test.ts`, message `test(face): schedule-smoke's strategy cases in clock order - an A-share report on its Beijing date, the canary held by both pins, two US reports at one anchor, the fence, a producer-only order, the abort last`.

---

### Task 6: The documents, the charter, and the loops page

**Files:**
- Modify: `Gravit-Design.md`, `DEVELOPMENT.md`, `face/README.md`, `ROADMAP.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md`, `Gravit-Docs-and-Prompt-Loops.html`

- [ ] **Step 1: `Gravit-Design.md`.**
  - **D28 (P4-8's wording).** "Held by" becomes the old Task 6's D20 text. It is held for a strategy's own firings; for the brief it is moot, since the brief reads `desk/` only; for the watch it is recorded, not held. "Revisit" is the old one.
  - **§4, the write map:** a report firing writes `reports/` and can write anything in its strategy; the outside-reports line names whatever it wrote outside `analysis/`.
- [ ] **Step 2: `DEVELOPMENT.md`.**
  - **§3.4, the strategy contract:** `STANDING.md`, `levels.yml` and its example, `reports/`, `analysis/` as the screen's source, the template's `status.yaml` keys, the fence.
  - **The module table:** a `report.ts` row; changed rows for `producer.ts`, `desk-book.ts`, `channels.ts`, `et.ts`, `standing.ts`, `firing.ts`, `schedule.ts`, `desk-session.ts`, `list-view.js` and `desk-view.js`.
  - **The desk files:** `market`, `levelsSha256`, `started.levelsSha`, `levels-hash`, `missed` with `why: "cutoff"`, `held` and `phoned`.
  - **§7:** fresh counts, `schedule-smoke` cases 11–15 with 4b last, and the drill's P4 row.
  - **§9 residuals:** the old Task 6's list ("the brief and the watch read `levels.yml` unpinned" corrected to the watch alone); no A-share pre-open gap; the screen trusts `run.json`'s `sealed_at`, which the strategy's own sessions can write; the XSHG table ends 2026-12-31; a held line can go twice across a crash; the ET budget day refuses the next Beijing morning's report after a spent US day; the walk skips `analysis/`, so a turn's write there goes unnamed.
  - **§10:** the desk item reads P4 built; the drill can run on a Lunhui strategy.
- [ ] **Step 3: `face/README.md`.**
  - **"The desk" gains "Strategy reports",** the old Task 6's list, with:
    - `--market cn` and the Beijing anchors (`open-90m` is 08:00 Beijing, the evening before in New York);
    - the screen line's five forms, and the print kinds `pre-market`, `session`, `close` and `earlier`;
    - one sentence on the budget: it is New York's day, so a US day that spends it refuses the next morning's A-share report.
  - **"The desk drill" gains its P4 half:**
    0. Give `lunhui-s01-repair` what the report reads: its `STANDING.md` from the template, and a `levels.yml` from `levels.example.yml` holding at least one quoted A-share level (`symbol: "600519"`).
    1. Arm its report: `npm run desk -- arm strategies/lunhui-s01-repair --id s01-report --at open-90m --market cn --producer builtin:report --expires <YYYY-MM-DD>`, from the checkout the service runs.
    2. On three XSHG sessions, confirm the report reached the phone before 09:30 Beijing and quoted each level's print with `TENCENT` and its Beijing time, and that Markets › Desk shows `delivered`. Its screen line reads `ran` when a Lunhui run for the previous XSHG session was sealed before the 08:00 Beijing firing, and names the newest sealed run under `analysis/` otherwise.
    3. Edit one level: the next report is refused with its line. Run `rearm`, and the next one runs.
- [ ] **Step 4: `ROADMAP.md`, `CLAUDE.md` and the spec.**
  - **`ROADMAP.md`:** item (2) reads "P0–P4 built (each plan's done criterion is the operator's drill)".
  - **`CLAUDE.md`:** the desk row names `report.ts` and `builtin:report` beside `builtin:brief`.
  - **The spec:** an "As built (P4)" note under §5.9's report bullet, pointing at §15: the Lunhui screen line, the per-quote print rule with `close`, `market:`, `levelsSha256`, the cut-off at start, the `open-Nm` room rule, `reports/`. §13's "Roles on the desk" closes: roles stay off.
- [ ] **Step 5: `Gravit-Docs-and-Prompt-Loops.html`** (P2-18, P4-7). Write it in Chinese, and set its "written against" line to this branch's head. Add three loops, station by station, as the old Task 6 says:
  - **the phone:** Telegram → bridge → conversation → turn → deliver;
  - **the schedule:** tick per market → check (the pins, the fence) → `builtin:brief` or `builtin:report` → fresh `gravit-desk` session → turn → deliver or withhold;
  - **the alert:** P3's polled watch → send → annotation.
- [ ] **Step 6: Verify and commit** — `cd face && npm test && npm run typecheck`, then `FACE_SMOKE=1 npm test`; every count in the documents matches the run. Commit the seven files with `docs: the desk P4 - the pre-market report per market, the Lunhui run as its screen line, charter D28 held for a strategy's own firings, the desk's loops`.

---

## Pre-flight conflict scan

### A. Task pairs that share a file or an interface

| Pair | Shared | Note |
|---|---|---|
| T1→T2, T3 | `readDeskFile` (over `readFileBytes`), `parseLevels`, `BUILTIN_PRODUCERS`, `VerifiedLevels`, `reportProducer`, `ProducerInput.market`, `dateOf`, `bjSessionTime` | `levelsPin` lives in `desk-book.ts`, `dateOf` in `et.ts`, so there is no import cycle with `schedule.ts` |
| T1→T3 | the runner's `signal` | the firing's signal reaches the runner, and dispose aborts it |
| T2→T3, T5 | `orderMarket`, `StandingOrder.market`, `needsLevelsPin`, `LEVELS_NONE`, `levelsSha256`, the room rule | the smoke's short anchors carry short deadlines |
| T3→T4 | `firing.ts`, `schedule.ts` and their tests | sequential: T3 the per-market tick, the check and the builtins; T4 the lines, the walk, the cut-off, the held lines |
| T3/T4 | `desk-view.js`, `desk-view.test.js` | T3 the hash and market cells, T4 the session link: disjoint |
| T1, T4→T5, T6 | the template, the block's keys, the screen lines, the print kinds, the strategy lines | the smoke and the documents quote them |

### B. Each task against itself

- **T1:** the screen is read before any quote, and it leads the block; an open run is neither taken nor counted.
- **T2:** a P2 order parses with no `market` key and renders byte-identically.
- **T3:** P2's tests pass `calendar` and stay green, line 948 gaining `market: "us"`.
- **T4:** a `phoned` record is written only after the send resolves.
- **T5:** no network and no watch; 4b last; P2's orders leave the book before the 2026-11-30 cases.

### C. P4's changes to P1, P2 and P3 files

| File (owners) | Collision |
|---|---|
| `producer.ts`, `desk-book.ts` (P2; P3 T1, T3) | `report` becomes known; `ProducerInput` gains `market?` and `levels?`; the runner gains `signal`; `readFileBytes` under `readScriptBytes`; `readDeskFile`, `parseLevels` and `levelsPin` are added; `loadLevels` keeps its read and its `sha256`, which P3's watch keys on |
| `channels.ts` (the Lunhui runs card) | two exports and `readRunManifests` beside `readAnalysisRuns`, which is unchanged |
| `et.ts` (P2; P3 T1 adds `bjDate`, `bjClock`, `bjStamp`) | `dateOf` and `bjSessionTime` added after P3's three |
| `standing.ts`, `scripts/desk.ts`, `desk-cli.test.ts` (P2; P3 T4) | `market` and `levelsSha256`; the open room rule; `StandingStatus`'s market, `levelsHash` and `calendars`; P3's `unmute` stays in `USAGE` |
| `firing.ts`, `schedule.ts` (P2; P3 T10) | the per-market tick, carry and seed; `deskBuiltins` keeps P3's `briefProducer({ quotes, root, home })`; `snapshotFiles` gains `skip` |
| `desk.ts` (P1–P3) | `installDesk` hands P3's one `DeskCalendars` to the schedule as `seams.calendars`; the one `quotes` source is P3 Task 1's; `standingLines` gains lines |
| `desk-session.ts` (P1) | `createDeskAgent` gains `make`, defaulting to P1's behaviour |
| `tests/desk-fakes.ts` (P3 T2) | not touched: P3 adds `fakeCalendar`'s `dateOf`, and P4 passes `bjDate` |
| client `list-view.js`, `desk-view.js`, `render/desk.js` (gravit-ui; P3 T11) | the Desk group; two cells; one link |
