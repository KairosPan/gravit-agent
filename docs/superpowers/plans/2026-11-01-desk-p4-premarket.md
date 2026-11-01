# The Desk, P4 — the Per-strategy Pre-market Report (re-plan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before its market's open, every strategy the operator armed gets a report on the phone, written by an unattended desk turn that informs and never orders. A US strategy's market is XNYS; an A-share strategy's is XSHG. The report covers the strategy's status, its levels against the last print and its previous close, and a first line saying truthfully whether its research run (its Lunhui run) covers the previous session. A firing is refused, loudly and once, when the strategy's `STANDING.md` or `levels.yml` changed since arming.

**Architecture:**
- **The order.** A report is a P2 standing order with `dir: strategies/<name>`, a new `market: us | cn` (M8), and an anchor such as `open-90m` on that market's calendar.
- **The producer.** `builtin:report` (`face/src/report.ts`) writes one JSON block into the wake message, holding:
  - the screen line, first (M7);
  - `status.yaml`;
  - one snapshot per market of the level symbols: US through the Account's read, A shares through the hub;
  - `levels.yml`, as the bytes `checkFiring` hashed.
- **The pin.** Arming pins `levels.yml` beside `STANDING.md`.
- **The schedule.** The clock row judges each order on its own market's calendar and date, through P3's `DeskCalendars`.
- **Reuse.** P2's firing, fence and cut-off, and P3's Desk view in Markets, do the rest.

**Tech Stack:** Node 22, TypeScript strict via `tsx`, `node:test`; js-yaml 4.3.2 through P2's `CORE_SCHEMA` readers; the gravit-ui client; no new dependency, no Python; dsh 0.2.0-rc.2 unchanged.

**Spec:** `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` — §4.3, §5.3–§5.5, §5.9, §7, §9, §12, as amended by **§15 (M1–M8), which wins**. Binding beside it: the P4 rulings in `.superpowers/research/desk-p1-p4/controller-notes.md` this plan keeps (see "Rulings carried"), the P2 rulings where P4 uses P2's machinery, and `replan-brief.md`'s M9 and M10.

**Base:** `feat/desk-p1-p4` after P3's final review (P4-9). It consumes P3's names exactly:
- `Market`, `marketOf`, `Level.market`, `Holding.market`, `levelDistancePct` (desk-book.ts);
- `XSHG_CLOCK`, `XSHG_COVERED`, `bjDate`, `bjClock`, `xshgSession`, `xshgWindow`, `xshgMarketClock` (xshg-clock.ts);
- `DeskCalendars`, `deskCalendars`, `createMarketCalendar`'s `dateOf` (market-clock.ts);
- `briefProducer({ hub, root, home })`;
- `installDesk`'s `cnHub` and `watchRow`; `WatchStatus`; charter D28;
- the Markets Desk view (`face/client/js/host/desk-view.js` `deskViewOf`, `render/desk.js`).

P2's `firing.ts` has `LINES.failed`, `cutoffOf` and `snapshotFiles`/`diffFiles`. **"The old Task N"** means Task N of `docs/superpowers/plans/2026-10-20-desk-p4-premarket.md` (superseded, kept): its text binds where this plan says "as the old Task N", except for what this plan changes.

**Done (§15 M6, P4) — the operator's drill, written by Task 6.** One strategy's report preceded its market's open on three sessions and said truthfully what it says about its screen. A Lunhui strategy (`lunhui-s01-repair`, `market: cn`, `open-90m` = 08:00 Beijing) qualifies, so the drill no longer waits for a US strategy.

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

1. **The strategy's market is an order field (M8).**
   - **The field.** `market: us | cn`, absent meaning `us`; `arm --market cn` writes it. The field is chosen over deriving the market from the strategy, because nothing in a strategy says its market reliably: `cn-market` has no levels, and a strategy may list both markets' symbols.
   - **The anchor.** An A-share order anchors on `open±Nm` or `close±Nm` only, never `HH:MM`, since `anchorInstant`'s wall time is New York's.
   - **The brief.** `builtin:brief` runs only with `market: us`.

   Cost: one flag at arming.
2. **One calendar per market, one date per market.**
   - **Calendars.** The schedule asks `calendars[order.market].today(now)`.
   - **Dates.** An order's session date, its firing key's date, its `expires` and its provenance date are all its market's: Beijing for `cn`. The budget stays ET-daily.
   - **Past the XSHG table.** An A-share order fails closed, with P2's `calendar-error` line naming `XSHG_CLOCK`.

   Cost: an A-share order stops on 2027-01-01 until the table is extended.
3. **The screen line (M7).** No screen exists. A strategy's research run before the open is its Lunhui run.
   - **Not wired.** With no real `<dir>/analysis/` directory, the line is `no screen is wired for this strategy`.
   - **The runs read.** The report reads at most `SCREEN_RUNS_MAX = 200` run directories (names matching the Lunhui `RUN_ID_RE`), each one's `run.json` through the guarded read, and takes the sealed run with the greatest `sealed_at`.
   - **`ran`** is true when that run's `session` is the market's previous session date or later: the run covers the last close.
   - **The four lines** are exact, in Task 1.

   The report reads `run.json` itself: the face imports nothing from `plugins/`. Cost: a run sealed for an older session reads as "not run", which is the truth the operator wants.
4. **Print, previous close and gap** (old ruling 1, per market).
   - A print counts as the session's (`pre-market` or `session`) only when its date in its market's zone is the firing's date.
   - An earlier print is `earlier`, with no previous close and no gap.
   - An A-share report at 08:00 Beijing therefore always quotes yesterday's last print as `earlier`, and its distances are measured from that print.

   Cost: no A-share gap before the open, which the auction would be the only source of.
5. **The pin, the read, the room** (old rulings 2, 4, 5; P4-10): unchanged. `levelsSha256` is 64 hex or `none`, and is read once after the fence through `readDeskFile`. `open-Nm` must hold the producer deadline, the turn deadline and the 5-minute grace.
6. **Where a report session shows** (old ruling 11, re-placed for gravit-ui).
   - **In Messages:** every `gravit-desk` conversation — the phone's and each firing's — goes in one **Desk** group, never in a channel's group, so a report never lands among the strategy's research.
   - **In Markets › Desk:** each order's last firing links its session.

   Cost: the strategy's own group does not show its reports.
7. **Lines held by a pause survive a restart (M10).**
   - A one-shot line held back by the pause (missed, interrupted, expired, refused, cut-off) is recorded with `held: true` on its firing record.
   - When the line finally goes, a `phoned` record follows.
   - The boot's seed re-holds every record from the last 3 days that is `held` and has no `phoned`, in ledger order.

   Cost: a held line can go twice if the face dies between the send and the `phoned` append.
8. **A detached producer dies with the firing (M10).** `ProducerRunner`'s opts gain `signal`. An abort, whether the deadline, the schedule's dispose or the face's shutdown, sends `SIGKILL` to the child's process group. Cost: none.
9. **No migration** (old ruling 14): an order armed under P2 with no `market` key is `us`, and one with no `levelsSha256` where it needs one is P2's `not armed`.

## Global Constraints

- **B2.** A report informs and never orders. Its template forbids recommending a trade, sizing a position, or saying an order was placed. No tool, mask or gate changes.
- **Builtins (P2-14, P4-1).** `builtin:report` is face-side, with no Python, no bars and nothing to hash. It reads only:
  - the US source, `Pick<UsQuoteSource, "snapshot" | "unavailable">`;
  - the A-share hub, `Pick<QuoteHub, "snapshot">`;
  - `status.yaml`, through `readChannelStatus` after a guarded read;
  - `<dir>/analysis/*/run.json`, guarded;
  - `levels.yml`, as `ProducerInput.levels`.
- **The fence (P2-4, P2-15, P4-3).** A strategy order runs in `strategies/<name>`. P2's `findChainViolation` refuses before the firing and at its turn's start, and reports after it.
- **Order, cut-off, room (P2-11, P2-16, P2-20, P2-23, P2-25, P4-4, P4-10).** These are the old plan's Global Constraints, verbatim, applied per market.
- **B4.** Ignored: `/strategies/*/levels.yml` (already) and `/strategies/*/reports/`. Tracked: `strategies/_template/STANDING.md` and `levels.example.yml`.
- **No live network in a test.** Never the Account, Tencent, the SEC or Telegram: the report's tests and the smoke pass fake sources.
- **Module weight.** `report.ts` loads with the schedule, on first use. `src/desk.ts` and `scripts/desk.ts` load none of it, and `arm` imports `desk-book.ts` and `xshg-clock.ts` inside the command.
- **Phone lines, exact.** These are P4's rows; P2's and P3's tables hold the rest.

  | When | Line |
  |---|---|
  | `levels.yml` changed, appeared or oversize since arming | `<id> · <date> refused: <dir>/levels.yml changed since arming. Review it, then: npm run desk -- rearm <id>` |
  | it is gone since arming | `<id> · <date> refused: <dir>/levels.yml is gone since arming. Restore it, or re-arm without it: npm run desk -- rearm <id>` |
  | it cannot be read | `<id> · <date> refused: <dir>/levels.yml cannot be read (<reason>)` |
  | the fence refused a strategy firing | `<id> · <date> refused: <path> exists; it would steer every turn in <dir>. Remove it.` |
  | a strategy firing left a fence violation | `<id> · <date> left <path> behind; every firing in <dir> is refused, and every session in it reads it, until it is removed` |
  | a strategy firing wrote outside `reports/` | `<id> · <date> wrote outside reports/: <paths, sorted, ", ", at most five>[, and <k> more][; the listing stopped at <max> entries]` |
  | its directory is gone | P2's could-not-run line, `<reason>` = `<dir> is gone` |
  | a queued firing reached its cut-off | P2's missed line, `<why>` = `it was still queued at the open, behind other firings` (`close` for a close anchor) |

  `<date>` is the order's market date.
- **Tests.** Never `~/.dsh`, `launchctl` or `npm run service`. Real boots run only in `FACE_SMOKE=1` smokes; P4 extends `schedule-smoke` and adds none. Fixtures go under `face/tests/tmp/<file>-<pid>/`.
- **Conventions.** `||` for env defaults; the `gravit-face:` prefix; strict typecheck; key-first refusals; explicit pathspecs.

## Review Focus

1. **The evening ET when an A-share report fires.** `open-90m` on XSHG is 19:00 or 20:00 ET the day before, and the ET date differs from the firing's. Expected: the key, the provenance line, `expires` and the cut-off are all Beijing's, and the budget is the ET day's. Test: Task 3, "an A-share order fires on its Beijing session date at 08:00 Beijing, and expires on the Beijing date".
2. **No print since an earlier session.** Every A-share report, and a quiet US name. Expected: the print is dated, with no previous close and no gap. Test: Task 1, "buildReport quotes both markets from one snapshot each; an earlier print carries no previous close and no gap".
3. **A Lunhui run that is open, broken or old.** Expected:
   - an unsealed run is not counted;
   - a `run.json` that is a symlink or oversize is skipped and counted, never followed;
   - a run sealed for the session before last says `not run for <prev>`.

   Test: Task 1, "the screen line names the newest sealed run and whether it covers the previous session; links and torn runs are skipped".
4. **More reports at one anchor than fit before the open.** Expected: they run in file order, and one still queued at the open is missed once and never started. Tests: Task 4, "reports at one anchor run in file order …" and "two schedules record a cut-off once …".
5. **A pause across a restart.** Expected: a missed line held by OFF reaches the phone after the next boot, once the pause lifts. Test: Task 4, "a line held by the pause is sent after a restart, once".

---

### Task 1: The report — `builtin:report`, the screen line, the template, and the producer's group kill

**Files:**
- Create: `face/src/report.ts`, `face/tests/report.test.ts`, `strategies/_template/STANDING.md`, `strategies/_template/levels.example.yml`
- Modify: `face/src/producer.ts`, `face/tests/producer.test.ts`, `face/src/desk-book.ts`, `face/tests/desk-book.test.ts`, `face/tests/desk-weight.test.ts`, `strategies/_template/status.yaml`, `.gitignore`

**Interfaces:**
- **Consumes:**
  - from P2: `ProducerInput`, `ProducerOutput`, `BuiltinProducer`, `ProducerRunner`, `defaultProducerRunner`, `runScriptProducer`; `loadLevels`, `LoadResult`, `LoadRefusal`, `DESK_FILE_MAX_BYTES`; `STANDING_TEXT_MAX_BYTES`; `quoteTime`.
  - from P3: `Market`, `levelDistancePct`; `bjDate`, `bjClock`, `xshgSession`; `xnysWindow`; `etDate`, `etClock`, `etTime`; `deskTime`.
  - also: `readChannelStatus`, `ChannelStatus`; `UsQuoteSource`; `QuoteHub`.
- **Produces, `producer.ts`:**
  - `BUILTIN_PRODUCERS = ["brief", "report"] as const`;
  - `interface VerifiedLevels { file: string; sha256: string; text: string | null }`;
  - `ProducerInput` gains `market: Market` and `levels?: VerifiedLevels`;
  - `ProducerRunner`'s opts gain `signal?: AbortSignal`. `defaultProducerRunner` kills the child's group with `SIGKILL` on abort, as it does at the deadline. `runScriptProducer` passes the firing's signal.
- **Produces, `desk-book.ts`:**
  - `readDeskFile(path: string, maxBytes: number = DESK_FILE_MAX_BYTES)` — the old Task 1's `readDeskFile`, with the cap a parameter.
  - `parseLevels(text, file, today, sha256): LoadResult<Level>` — the old Task 1's.
- **Produces, `report.ts`:**
  - **Constants:** `SCREEN_RUNS_MAX = 200`; `RUN_JSON_MAX_BYTES = 262_144` (the Lunhui `MAX_READ_BYTES`); `RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/` (copied; a test pins it to `face/plugins/lunhui/lib/runs.mjs`'s); `STATUS_TEXT_MAX = 300`; `STATUS_NUMBERS_MAX = 20`; `NO_SCREEN = "no screen is wired for this strategy"`.
  - **The screen:** `interface Screen { wired: boolean; ran: boolean | null; line: string; run?: { id: string; kind: string; session: string; sealedAt: string; artifacts: string[] }; skipped?: number }`. Its `line` is exactly one of:
    - `ran: Lunhui run <id> (<kind>) sealed <deskTime> covers the <session> session; artifacts: <a, b | none>`;
    - `not run for the <prev> session: the last sealed Lunhui run is <id> (<kind>), for the <session> session, sealed <deskTime>`;
    - `not run: no Lunhui run in <dir>/analysis/ is sealed`;
    - `cannot tell whether the screen ran: <error>`, when the previous session is unknown;
    - `NO_SCREEN`.
  - **The previous session:** `previousSessionDate(market: Market, date: string): string | { error: string }`. It walks back at most 10 days through `xnysWindow` or `xshgSession`. An `uncovered` XSHG day is `{ error: "the A-share calendar does not cover <d>" }`.
  - **`readScreen(root, dir, market, date, now): Promise<Screen>`**:
    - `lstat`s `<dir>/analysis`, so a link or a non-directory reads as not wired;
    - reads the first `SCREEN_RUNS_MAX` names, sorted descending, that match `RUN_ID_RE`;
    - for each, reads `run.json` with `readDeskFile(…, RUN_JSON_MAX_BYTES)`; a missing, unreadable, oversize or unparseable one, or one with no ISO `sealed_at`, is skipped, and the non-missing ones are counted in `skipped`;
    - from the rest, takes the greatest `sealed_at`; a string `session` and string `artifacts` are kept.
  - **Quotes:** `type Print = "pre-market" | "session" | "earlier" | "none"`; `ReportQuote` is the old Task 1's, gaining `market` and `source: "Account" | "Tencent"`.
    - `at` is `Account <quoteTime(feed, as_of, now)>` for a US quote, and `Tencent <bjClock> Beijing` for an A share, dated when the Beijing date differs from now's.
    - The print's date is read in its market's zone.
  - **Levels:** `ReportLevel` is the old Task 1's, gaining `market`.
  - **The block:** `interface Report { strategy; market: Market; date; takenAt; session: { open; close; early }; screen: Screen; statusFile; status; quotes: ReportQuote[]; quotesError?: string; levels: { file; rows; refusals; missing?: true; error?: string } }`, in that key order.
    - `takenAt` is `<etClock> ET`.
    - `session` is printed as `<HH:MM ET>` for US, and as `<HH:MM> Beijing (<HH:MM ET>)` for an A share.
  - **The producer:** `interface ReportDeps { usQuotes?: Pick<UsQuoteSource, "snapshot" | "unavailable">; cnHub?: Pick<QuoteHub, "snapshot">; root: string; now?: () => number }`; `reportProducer(deps): BuiltinProducer`; `buildReport(deps, input): Promise<ProducerOutput>`.
- **The rules `buildReport` keeps:** the old Task 1's, with these changes.
  - **One snapshot per market** that has symbols, in parallel.
  - **A market with no source** sets every price of its symbols `null` and `quotesError` to `quotes unavailable: no <US | A-share> quote source in this face`.
  - **A US 429** is `quotes unavailable: busy`.
  - **`ok: false`** only when no symbol of any market has a timed price.
  - **The screen** comes from `readScreen(root, input.dir, input.market, input.date, now)`, before any quote is asked.
- **`strategies/_template/STANDING.md`** (tracked) is the old Task 1's text, with three edits:
  - paragraph 2 names the block's `screen.line`: `the face's one snapshot of this strategy's screen line, status, levels and prices`;
  - item 3 reads `3. The screen: its screen.line from the block, verbatim.`;
  - the source sentence reads `Every price names its source and time as the block gives them (Account ROBINHOOD 07:58:03 ET, Tencent 15:00:03 Beijing).`
- **`levels.example.yml`, `status.yaml` and `.gitignore`:** as the old Task 1. `levels.example.yml` adds one A-share entry (`symbol: "600519"`, quoted), so its kinds read `["buy_zone", "stop", "watch"]`.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/report.test.ts — root face/tests/tmp/report-<pid>/: strategies/demo/status.yaml (researching, ONE_LINE, a next, numbers { hit_rate: 0.54 }),
// strategies/demo/analysis/<runs>/run.json fixtures; fake usQuotes and cnHub recording each call
const NOW = () => Date.parse("2026-11-27T13:00:05Z");
test("buildReport quotes both markets from one snapshot each; an earlier print carries no previous close and no gap", async () => { // RF 2
  // LEVELS: NVDA target 180 cross_up; AAPL buy_zone [218,222]; 600519 stop 1400 cross_down. usQuotes NVDA 181.5 prev 178.2 as_of 12:58:03Z (pre-market),
  // AAPL as_of 2026-11-25T20:59:58Z; cnHub 600519 1398.5 prev 1420 as_of 2026-11-27T07:00:03Z (15:00:03 Beijing, the date's own close)
  // → usQuotes.calls [["NVDA","AAPL"]], cnHub.calls [["cn:600519"]]; quotes[0].at "Account ROBINHOOD 07:58:03 ET", print "pre-market", sinceClosePct 1.85;
  //   quotes[1].print "earlier", prevClose null; quotes[2].at "Tencent 15:00:03 Beijing", source "Tencent"
});
test("the screen line names the newest sealed run and whether it covers the previous session; links and torn runs are skipped", async () => { // RF 3
  // date 2026-11-30 (cn), previous session 2026-11-27: runs r1 sealed 2026-11-27T08:10Z session 2026-11-27 artifacts ["environment","sentiment"];
  //   r0 sealed earlier; r2 unsealed; r3 run.json a symlink; r4 not JSON →
  //   screen { wired: true, ran: true, line: "ran: Lunhui run r1 (market) sealed 03:10 ET covers the 2026-11-27 session; artifacts: environment, sentiment", skipped: 2 }
  // only r0 → "not run for the 2026-11-27 session: the last sealed Lunhui run is r0 (market), for the 2026-11-26 session, sealed …"
  // analysis/ empty → "not run: no Lunhui run in strategies/demo/analysis/ is sealed"; no analysis/ or a link to one → NO_SCREEN
});
test("previousSessionDate walks back over weekends and holidays, and refuses past the XSHG table", () => {
  assert.equal(previousSessionDate("cn", "2026-10-08"), "2026-09-30"); assert.equal(previousSessionDate("us", "2026-11-30"), "2026-11-27");
  assert.deepEqual(previousSessionDate("cn", "2027-01-04"), { error: "the A-share calendar does not cover 2027-01-03" });
});
test("RUN_ID_RE is the Lunhui runs' grammar", () => { /* the source of face/plugins/lunhui/lib/runs.mjs holds the same literal */ });
test("the screen leads the block, and a full levels file with a 5,000-character next keeps it inside the cap", async () => { /* the old RF 4 test; Object.keys order above */ });
test("a market with no source says so; a strategy with no levels calls no source", async () => { /* … */ });
test("a malformed, a missing and an unreadable status.yaml are named, not invented", async () => { /* the old test */ });
test("the report reads the verified bytes, never the file, and refuses what is not its own", async () => { /* the old test */ });
test("the template's STANDING.md is the pre-market order", () => { /* the old phrases, "IEX 07:58:03 ET" replaced by "Tencent 15:00:03 Beijing", plus "screen.line" */ });
test("the template's levels.example.yml loads with no refusal", async () => { /* kinds ["buy_zone", "stop", "watch"] */ });
// face/tests/producer.test.ts (append)
test("an aborted run kills the producer's whole group", async () => {
  // node as the interpreter, a fixture script that spawns a sleeping child and prints both pids; abort after 200 ms →
  // RunResult within 2 s, and process.kill(childPid, 0) throws ESRCH
});
// desk-book.test.ts: the old readDeskFile and parseLevels tests, plus "readDeskFile honours its cap"; desk-weight.test.ts: src/report.ts joins the list
```

- [ ] **Step 2: Run them to verify they fail** — `cd face && npx tsx --test tests/report.test.ts tests/producer.test.ts tests/desk-book.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `report.ts`, the producer additions and the signal kill, `readDeskFile`, `parseLevels`, and the template files.
- [ ] **Step 4: Run them to verify they pass** — `npm test && npm run typecheck`; `git check-ignore -q strategies/demo/reports/2026-11-27-premarket.md` exits 0; `git check-ignore strategies/_template/STANDING.md strategies/_template/levels.example.yml` prints nothing. Expected: PASS.
- [ ] **Step 5: Commit** — the files above, message `feat(face): builtin:report - the Lunhui run as the screen line, status, verified levels and one snapshot per market; the template's pre-market order; an aborted producer's group killed`.

---

### Task 2: Arming a strategy order — `market`, the `levels.yml` pin and the `open-Nm` room rule

**Files:**
- Modify: `face/src/standing.ts`, `face/tests/standing.test.ts`, `face/src/desk-book.ts`, `face/scripts/desk.ts`, `face/tests/desk-cli.test.ts`

**Interfaces:**
- **Consumes:** Task 1 (`readDeskFile`, `parseLevels`, `BUILTIN_PRODUCERS`); P3 (`Market`, `bjDate`, `xshgMarketClock`); P2's `standing.ts`, `runDesk`, `roomProblem`, `sha256Hex`.
- **Produces, `standing.ts`:**
  - **From the old Task 2, unchanged:** `LEVELS_NONE`, `REPORT_PLACE`, `needsLevelsPin`, `levelsSha256` on `StandingOrder`, `ArmEntry` and `OrderChange`, and the `REWRITTEN_LINE_RE` key.
  - **`StandingOrder.market: Market`** and `ArmEntry.market?: Market`. `renderOrder` writes `market: cn` right after `dir`, and only for `cn`, so P2's files render byte-identically.
  - **`roomProblem(anchor, need)`** covers `open-Nm` too, with the old plan's exact text.
  - **`parseStanding` gains these refusals:**
    - the old Task 2's four;
    - `orders[<i>] (<id>): market must be us or cn`;
    - `orders[<i>] (<id>): an A-share order anchors on the open or the close, not <HH:MM>`;
    - `orders[<i>] (<id>): builtin:brief is the US pre-close brief; it runs only with market: us`.
- **Produces, `desk-book.ts`:** `levelsPin(root, dir, today)`, as the old Task 2.
- **Produces, `scripts/desk.ts`:**
  - `arm` takes `--market us|cn` (in `VALUE_FLAGS`), and `DeskDeps` gains `cnMarketClock?: MarketClock` (`xshgMarketClock()` by default) for an A-share order's anchor checks.
  - **`USAGE`'s arm part** gains ` [--market us | cn]` after `--expires YYYY-MM-DD`.
  - **The success lines** gain `, market cn` (only for cn) before the producer part, and the levels part as the old Task 2.
  - `levelsPin` is called with the market's date: `etDate(now)` or `bjDate(new Date(now))`.
  - **`rearm`** works as the old Task 2.

- [ ] **Step 1: Write the failing tests** — the old Task 2's tests (its `FULL_REPORT` fixture gains `market: cn` in one copy), plus:

```ts
test("market is us by default, cn when written, and anything else refused; a P2 order renders byte-identically", () => { /* … */ });
test("an A-share order may not anchor on a wall time, and builtin:brief runs only on us", () => {
  // market: cn with at: "08:00" → "orders[0] (demo-report): an A-share order anchors on the open or the close, not 08:00"
  // builtin:brief with market: cn → "orders[0] (preclose): builtin:brief is the US pre-close brief; it runs only with market: us"
});
// desk-cli.test.ts (append)
test("arm --market cn pins a Lunhui strategy's report and prints its market", async () => {
  // runDesk("arm", ["strategies/demo", "--id", "demo-report", "--at", "open-90m", "--market", "cn", "--producer", "builtin:report", "--expires", "2026-12-31"], …)
  // → 0; standing.yml's order has market: cn; out → [`armed demo-report in ${root}: strategies/demo/STANDING.md sha256 ${s12}…, at open-90m, expires 2026-12-31,
  //   market cn, producer builtin:report, no strategies/demo/levels.yml; the face reads standing.yml again within 30 s`]
});
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/standing.test.ts tests/desk-cli.test.ts` FAIL, then implement, then PASS with `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** — the five files, message `feat(face): arming names a strategy's market, pins its levels.yml beside its STANDING.md, and an open anchor must hold its deadlines and the grace`.

---

### Task 3: The schedule per market, the pin at the firing, and wherever an order's state shows

**Files:**
- Modify: `face/src/schedule.ts`, `face/src/firing.ts`, `face/src/desk.ts` (`installDesk` passes P3's `DeskCalendars` and `cnHub` to `createDeskSchedule`; `standingLines`), `face/src/desk-session.ts` (`createDeskAgent`'s `make`), `face/client/js/host/desk-view.js` (the standing rows' hash cell)
- Test: `face/tests/schedule.test.ts`, `face/tests/firing.test.ts`, `face/tests/desk.test.ts`, `face/tests/desk-session.test.ts`, `face/tests/client/desk-view.test.js`

**Interfaces:**
- **Consumes:** Tasks 1–2; P3's `DeskCalendars`, `deskCalendars`, `bjDate`; P2's `installSchedule`, `createDeskSchedule`, `checkFiring`, `runFiring`, `LINES`.
- **Produces, `schedule.ts`:**
  - **The calendars.** `ScheduleDeps` gains `calendars?: Partial<DeskCalendars>`, with P2's `calendar` kept as the US one. The cn calendar defaults to `deskCalendars().cn` (builtin and offline).
  - **`dateOf(market: Market, now: number): string`** — `etDate` or `bjDate`.
  - **Each tick**, for each market with an enabled, unexpired order:
    - one `calendars[market].today(now)`, its `calendar-error` once per market date;
    - each order is weighed on its own market's answer and date;
    - `expires` is compared with the order's market date;
    - the key is `firingKey(id, <market session date>)`.
  - **`createDeskSchedule`'s opts** gain `cnHub?: Pick<QuoteHub, "snapshot">`, and its `seams` gain `calendars?: Partial<DeskCalendars>`.
  - **`deskBuiltins(opts: { usQuotes?: UsQuoteSource; cnHub?: Pick<QuoteHub, "snapshot">; root: string; home: string; now: () => number }, seams?: Partial<Record<BuiltinName, BuiltinProducer>>): Partial<Record<BuiltinName, BuiltinProducer>>`:
    - `report` is always present: `reportProducer({ usQuotes, cnHub, root, now })`;
    - `brief` is present only with `usQuotes`;
    - a seam replaces only the names it gives.
  - **The status:** `StandingStatus.orders[]` gains `market` and `levelsHash?`, as the old Task 3. `nextAnchor` is read from the order's market's window.
  - **Lines:** a `levels-hash` line goes once per changed detail; `started.levelsSha` is recorded, as the old Task 3.
- **Produces, `firing.ts`:** the old Task 3's `levels-hash` refusal, `Verified.levels`, the check order (OFF, budget, fence, `STANDING.md`, script, levels), `started.levelsSha`, the three `LINES` rows, and `make: order.dir === "desk"`. `ProducerInput.market` is the order's.
- **Produces, `desk-session.ts`:** `createDeskAgent(deps, { cwd, route?, make? })`, as the old Task 3.
- **Produces, `desk.ts`:** `standingLines` gains the old Task 3's three lines, and `standing <id>: market cn` when an order is cn. `installDesk` passes its one `DeskCalendars` (P3 Task 9) as `seams.calendars`, and passes `cnHub`.
- **Produces, client:** `deskViewOf`'s standing rows show `levels.yml changed`, `levels.yml gone` or `levels.yml unreadable` in the hash cell, and the order's market.

- [ ] **Step 1: Write the failing tests** — the old Task 3's `firing.test.ts`, `schedule.test.ts`, `desk.test.ts` and `desk-session.test.ts` cases, unchanged but for the builtins' deps, plus:

```ts
// face/tests/schedule.test.ts (append; calendars { us: fakeCalendar(…), cn: fakeCalendar({ "2026-12-01": 01:30Z-07:00Z }, "fake XSHG") })
test("an A-share order fires on its Beijing session date at 08:00 Beijing, and expires on the Beijing date", async () => { // RF 1
  // lunhui-report open-90m market cn expires 2026-12-01; tick 2026-11-30T23:59:50Z (ET 2026-11-30 18:59) → nothing; 2026-12-01T00:00:10Z → run with
  //   item.date "2026-12-01", key "lunhui-report:2026-12-01", the wake's first line "[schedule · lunhui-report · 2026-12-01]";
  //   the next Beijing day (2026-12-02) → one expired record, its line once
});
test("a calendar failure is per market: a cn order stops, a us order fires", async () => { /* cn today() { ok: false } → one calendar-error naming "fake XSHG" */ });
test("deskBuiltins: report is always there, brief only with the US source, a seam replaces only its names", () => { /* … */ });
// face/tests/client/desk-view.test.js (append): a changed levels.yml shows in its order's hash cell, with "cn"
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/firing.test.ts tests/schedule.test.ts tests/desk.test.ts tests/desk-session.test.ts tests/client/desk-view.test.js` FAIL, then implement, then PASS with `npm test && npm run typecheck`. P2's schedule tests stay green unchanged: they pass `calendar` and no order has `market`.
- [ ] **Step 5: Commit** — the files above, message `feat(face): the clock row per market - each order on its own calendar and date; a strategy firing checks its levels.yml pin after the fence; deskBuiltins on both sources`.

---

### Task 4: Strategy firings — the cut-off at start, the strategy's lines, held lines across a restart, and where a report shows

**Files:**
- Modify: `face/src/firing.ts`, `face/src/schedule.ts`, `face/client/js/host/list-view.js`, `face/client/js/host/desk-view.js`, `face/client/js/render/desk.js`
- Test: `face/tests/firing.test.ts`, `face/tests/schedule.test.ts`, `face/tests/client/list-view.test.js`, `face/tests/client/desk-view.test.js`

**Interfaces:**
- **Consumes:** P2's `cutoffOf`, `LINES`, `appendRecordOnce`, `snapshotFiles`, `diffFiles`, `FILES_WALK_MAX`; Task 3; the client's `bucketFor(channel, archived, bot, member, desk)`, `DESK_KEY` and `isDeskPreset` (`wire/speaker.js`).
- **Produces, `firing.ts` and `schedule.ts`:**
  - from the old Task 4: `LINES.fence(item, path)`, `LINES.leftBehind(item, path)`, `LINES.outsideReports(item, paths, truncated)`, `OUTSIDE_REPORTS_MAX = 5`, `FiringDeps.filesWalkMax?`, the cut-off at start through `appendRecordOnce`, and `why: "cutoff"`;
  - **held lines (ruling 7):**
    - the `refused`, `missed`, `interrupted` and `expired` records gain `held?: true`;
    - `type PhonedRecord = { t: string; kind: "phoned"; key: string; of: "refused" | "missed" | "interrupted" | "expired" }` joins `FiringRecord`, and `isFiringRecord` accepts it;
    - `sendOnce` writes the record with `held: true` when the pause holds the line, and `flushHeld` appends `phoned` after each held line it sends;
    - the boot's seed rebuilds `held` from the last 3 days' records that are `held` and have no `phoned`, each line built from its record by `LINES`.
- **Produces, client:**
  - `groupsOf` passes `desk: isDeskPreset(c.preset)` to `bucketFor`, and the `DESK_KEY` group is `{ kind: "desk", label: "Desk" }`, ordered right after the root channel.
  - `deskViewOf`'s standing rows carry `last.sessionId`, from P2's `FiringSummary`, and `renderDeskTab` links it as `#/messages/<sessionId>`, the Messages route.

- [ ] **Step 1: Write the failing tests** — the old Task 4's three `firing.test.ts` and two `schedule.test.ts` cases (RF 4), plus:

```ts
// face/tests/schedule.test.ts (append)
test("a line held by the pause is sent after a restart, once", async () => { // RF 5
  // OFF set; an anchor passes asleep → missed record { held: true }, nothing delivered; dispose; a new schedule over the same home; OFF lifted;
  // first tick → deliver(the missed line) once, then a phoned record { key, of: "missed" }; a third schedule sends nothing
});
// face/tests/client/list-view.test.js (append)
test("every desk conversation is in the Desk group, never in a channel's", () => {
  // a gravit-desk conversation whose channel is strategies/demo → group kind "desk", label "Desk", after the root; demo's group lists none of it
});
// face/tests/client/desk-view.test.js (append): a standing row links its last firing's session
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/firing.test.ts tests/schedule.test.ts tests/client/list-view.test.js tests/client/desk-view.test.js` FAIL, then implement, then PASS with `npm test && npm run typecheck`. Hard-reload any browser showing the page.
- [ ] **Step 5: Commit** — the files above, message `feat(face): strategy firings - a queued firing past its cut-off is missed once, lines that name the strategy, held lines survive a restart, reports in the Desk group and on Markets › Desk`.

---

### Task 5: `schedule-smoke`'s strategy cases

**Files:**
- Modify: `face/tests/schedule-smoke.test.ts`

**Interfaces:**
- **Consumes:** Tasks 1–4; P2's scaffold (`WallClock`, `fakeCalendar`, the recorder, the stub deciding by the wake's first line); P3's `watchRow` seam; `appendOrder`, `writeStanding`, `sha256Hex`.
- **The scaffold:** the old Task 5's, with these changes.
  - **A quiet watch.** `installDesk` gets `watchRow: { clock, calendars, tickMs: 86_400_000, edgar: null }`, and no book file names a symbol, so the watch is `idle`.
  - **Fake sources.** A fake `UsQuoteSource` and a fake `cnHub` replace the old hub, and `installDesk` gets `cnHub`.
  - **Calendars.** `us` holds 2026-11-30 at 14:30Z–21:00Z. `cn` holds 2026-11-28 and 2026-11-29 closed, and 2026-11-30 at 01:30Z–07:00Z.
  - **Strategies.**
    - `demo-a` (US): an NVDA target, a filled `status.yaml`, no `analysis/`.
    - `demo-b` (cn): a 600519 stop, the template's `status.yaml`, and `analysis/r1/run.json` sealed for 2026-11-27 (the previous XSHG session) with two artifacts.
- [ ] **Step 1: Write the cases**, after P2's ten:
  11. **An A-share report.** `demo-b-report` (`market: cn`, `open-90m`, anchor 2026-11-30T00:00Z) fires at 00:00:10Z in a fresh `gravit-desk` session with cwd `strategies/demo-b`. The stub sees:
      - `[schedule · demo-b-report · 2026-11-30]`;
      - a block holding `"screen":{"wired":true,"ran":true`, `"market":"cn"`, `"print":"earlier"` and `Tencent`.

      It writes `reports/2026-11-30-premarket.md` and ends `REPORT-B`; no outside-reports line follows.
  12. **Two US reports at one anchor.** `demo-a-report`, then `demo-a-second`, both `open-90m` at 13:00Z, run in file order. a's block holds `"screen":{"wired":false` with `no screen is wired for this strategy`, `"print":"pre-market"` and `Account`.
  13. **The canary in a strategy:** the old case 12, on `demo-b`, at `open-30m` and `open-15m` Beijing, with the old assertions.
  14. **The fence in a strategy:** the old case 13, on `demo-a`.
  15. **A producer-only strategy order:** the old case 14, `close+60m` on `demo-a`.
  16. **A pause across a restart.** OFF set, `demo-b-late` missed while paused, then the desk disposed and re-installed over the same home and OFF lifted: its missed line arrives once.
- [ ] **Step 2: Run it** — `cd face && FACE_SMOKE=1 npx tsx --test tests/schedule-smoke.test.ts`. Expected: PASS.
- [ ] **Step 3: Run the whole suite** — `FACE_SMOKE=1 npm test`. Expected: every file green, with the real-boot count unchanged.
- [ ] **Step 4: Commit** — `face/tests/schedule-smoke.test.ts`, message `test(face): schedule-smoke's strategy cases - an A-share report on its Beijing date, two US reports at one anchor, the canary held by both pins, the fence, a producer-only order, a pause across a restart`.

---

### Task 6: The documents, the charter, and the loops page

**Files:**
- Modify: `Gravit-Design.md`, `DEVELOPMENT.md`, `face/README.md`, `ROADMAP.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md`, `Gravit-Docs-and-Prompt-Loops.html`

- [ ] **Step 1: `Gravit-Design.md`.**
  - **D28 (P4-8's wording).** "Held by" becomes the old Task 6's D20 text. It is held for a strategy's own firings; for the brief it is moot, since the brief reads `desk/` only; for the watch it is recorded, not held. "Revisit" is the old one.
  - **§4, the write map:** a report firing writes `reports/` and can write anything in its strategy; the outside-reports line names whatever it wrote.
- [ ] **Step 2: `DEVELOPMENT.md`.**
  - **§3.4, the strategy contract:**
    - `STANDING.md`;
    - `levels.yml` and `levels.example.yml`;
    - `reports/`;
    - `analysis/` as the screen's source;
    - the template's `status.yaml` keys;
    - the fence.
  - **The module table:** a `report.ts` row, and changed rows for `producer.ts`, `desk-book.ts`, `standing.ts`, `firing.ts`, `schedule.ts`, `desk-session.ts` and the client's `list-view.js` and `desk-view.js`.
  - **The desk files:** `market`, `levelsSha256`, `started.levelsSha`, `levels-hash`, `missed` with `why: "cutoff"`, `held` and `phoned`.
  - **§7:** fresh counts, `schedule-smoke` cases 11–16, and the drill's P4 row.
  - **§9 residuals:**
    - the old Task 6's list, with "the brief and the watch read `levels.yml` unpinned" corrected to the watch alone;
    - an A-share report has no pre-open gap;
    - the screen line trusts `run.json`'s `sealed_at`, which the strategy's own sessions can write;
    - the XSHG table ends 2026-12-31;
    - a held line can go twice across a crash (ruling 7).
  - **§10:** the desk item reads P4 built; the drill can run on a Lunhui strategy.
- [ ] **Step 3: `face/README.md`.**
  - **"The desk" gains "Strategy reports",** the old Task 6's list, with:
    - `--market cn` and the Beijing anchors (`open-90m` is 08:00 Beijing, the evening before in New York);
    - the screen line's four forms.
  - **"The desk drill" gains its P4 half:**
    1. Arm `lunhui-s01-repair`'s report: `npm run desk -- arm strategies/lunhui-s01-repair --id s01-report --at open-90m --market cn --producer builtin:report --expires <YYYY-MM-DD>`. Do it from the checkout the service runs, after writing its `STANDING.md` from the template.
    2. On three XSHG sessions, confirm the report reached the phone before 09:30 Beijing and quoted each level's print with `Tencent` and its time. Confirm its screen line matches the newest sealed run under `analysis/`, and that Markets › Desk shows `delivered`.
    3. Edit one level: the next report is refused with its line. Run `rearm`, and the next one runs.
- [ ] **Step 4: `ROADMAP.md`, `CLAUDE.md` and the spec.**
  - **`ROADMAP.md`:** item (2) reads "P0–P4 built (each plan's done criterion is the operator's drill)".
  - **`CLAUDE.md`:** the desk row names `report.ts` and `builtin:report` beside `builtin:brief`.
  - **The spec:** an "As built (P4)" note under §5.9's report bullet, pointing at §15 and naming:
    - the screen line from the Lunhui run;
    - the per-market print rule;
    - `market:`;
    - `levelsSha256`;
    - the cut-off at start;
    - the `open-Nm` room rule;
    - `reports/`.

    §13's "Roles on the desk" closes: roles stay off.
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
| T1→T2, T3 | `readDeskFile` (cap a parameter), `parseLevels`, `BUILTIN_PRODUCERS`, `VerifiedLevels`, `reportProducer`, `ProducerInput.market` | `levelsPin` lives in `desk-book.ts`, so there is no import cycle |
| T1→T3 | `ProducerRunner`'s `signal` | the firing's signal reaches the runner, and dispose aborts it |
| T2→T3, T5 | `StandingOrder.market`, `needsLevelsPin`, `LEVELS_NONE`, `levelsSha256`, the room rule | the smoke's short anchors carry short deadlines |
| T3→T4 | `firing.ts`, `schedule.ts` and their tests | sequential: T3 the per-market tick, the check and the builtins; T4 the lines, the cut-off, the held lines |
| T3/T4 | `desk-view.js`, `desk-view.test.js` | T3 the hash cell, T4 the session link — disjoint |
| T1, T4→T5, T6 | the template, the block's keys, the screen lines, the strategy lines | the smoke and the documents quote them |

### B. Each task against itself

- **T1:** the screen is read before any quote, and it leads the block.
- **T2:** a P2 order renders byte-identically.
- **T3:** P2's tests pass `calendar` and stay green.
- **T4:** a `phoned` record is written only after the send resolves.
- **T5:** no network, and a quiet watch.

### C. P4's changes to P1, P2 and P3 files

| File (owners) | Collision |
|---|---|
| `producer.ts`, `desk-book.ts` (P2; P3 T1, T3) | `report` becomes known; `ProducerInput` gains `market`; the runner gains `signal`; `readDeskFile`, `parseLevels` and `levelsPin` are added; `loadLevels` keeps its read and its `sha256`, which P3's watch keys on |
| `standing.ts`, `scripts/desk.ts`, `desk-cli.test.ts` (P2; P3 T4) | `market` and `levelsSha256`; the open room rule; P3's `unmute` stays in `USAGE` |
| `firing.ts`, `schedule.ts` (P2; P3 T10) | the per-market tick; `deskBuiltins` keeps P3's `briefProducer({ …, home })` |
| `desk.ts` (P1–P3) | `installDesk` hands the schedule P3's calendars and `cnHub`; `standingLines` gains lines |
| `desk-session.ts` (P1) | `createDeskAgent` gains `make`, defaulting to P1's behaviour |
| client `list-view.js`, `desk-view.js`, `render/desk.js` (gravit-ui; P3 T11) | the Desk group; two cells |
