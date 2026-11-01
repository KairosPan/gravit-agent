# SDD ledger — plan: docs/superpowers/plans/2026-10-25-lunhui-modules-plan-1.md

Spec: docs/superpowers/specs/2026-10-25-lunhui-modules-design.md (approved). Branch feat/lunhui-modules, start 6eb71f7 (plan self-reviewed). Merge base with main: a89502f.
Models: implementers + task reviewers opus (operator's practice on the account-graft arc); final review fable.

## Pre-flight scan

| Tasks | Shared file / interface | Produces → consumes | Finding |
|---|---|---|---|
| 1 → 2 | lib/market.mjs | T1 copies; T2 moves the calendar out | ok, T2 keeps getMarketSession's shape |
| 1 → 3 | lib/runs.mjs, lib/contract.mjs | T1 copies; T3 adds openRun/addEvidence/sealRun/readRun/evidenceId, exports hash | ok |
| 1 → 5 | lib/fixture-fetch.mjs | T1 edits the header comment; T5 adds the Eastmoney mapping | ok, sequential |
| 2 → 8 | calendar.mjs coverageOf, getMarketSession.expectedQuoteDate | T8 consumes both | ok |
| 3 → 4 | runs.mjs functions | T4's service wraps them by strategy name | ok |
| 4 → 5 | errors.mjs upstreamError | T5 maps Eastmoney codes through it | ok, T4 precedes T5 |
| 4 → 8 | service withRun/countFreeze/addEvidence, callerIsChild | T8 freeze-tool | ok |
| 5 → 6 | eastmoney.mjs, fixture dir, inFlight | T6 extends | ok |
| 5,6 → 7 | PoolRow, Board, counts shapes | derive.mjs | ok |
| 5–7 → 8 | fetch*, derive* | freeze rows | ok |
| 8 → 9 | five row files | lunhui.ts names them by URL | ok |
| 4 → 11 | modules.mjs MODULES | channels.ts MODULE_HEADLINES + equality test | ok |
| 10 ↔ 11 | tests/channels.test.ts | T10 adds one case; T11 ports + adds | ok, sequential |
| 11 → 12 | ChannelBody runs/runsOmitted/latestRun incl. status | runs-view.js | ok |
| 9, 13 | DEVELOPMENT.md / schema-sizes GROUPS | T9 edits GROUPS; T13 measures | ok |

Per task self-agreement: 1 ok (tests = copied files + ignore test); 2 ok; 3 ok; 4 ok (package.json added to files and commit); 5 ok (market.mjs in Files and commit); 6 ok; 7 ok; 8 ok (two new tests consistent with the Interfaces); 9 ok; 10 commit omits channels.test.ts though Step 3 adds a case — Ruling below; 11 ok; 12 ok; 13 ok.

Ruling: Task 10's commit also adds face/tests/channels.test.ts, since its Files list names the one new case — a commit that leaves the test out would leave it untracked — costs nothing if wrong.

## Progress
Task 1: dispatched (base 6eb71f7, implementer opus)
Task 1: implementer DONE_WITH_CONCERNS at ee9bb62 (1336/1318/18 skipped, typecheck clean)
Ruling: the fetch.ts import is ../../../plugins/lunhui/lib/fixture-fetch.mjs, the plan's ../../ was one level short — the path is fixed by the file's depth — costs nothing if wrong.
Ruling: the two strategies' backtest.py, screen.py and backtests/.gitkeep do not land — main holds no Python and nothing backtests since 2026-10-24 (CLAUDE.md), they import the deleted alpaca_kit, and _template has none of them; "every tracked file" in the plan predates that — costs a re-copy from 0de97cf if wrong.
Ruling: stale comments naming server.mjs in the moved lib and tests stay until the task that rewrites each file (Tasks 3-5) — the brief limited Task 1 to imports — costs a docs pass if the final review disagrees.
Task 1: minor (deferred): face/tests/fixtures/lunhui/fetch.ts:2-4 and fixtures/lunhui/README.md:5-6,26 still name LUNHUI_FETCH_FIXTURES and pre-move paths — carried into Task 5's dispatch
Task 1: minor (deferred): tests/lunhui-{market,runs,contract}.test.ts:2 header comments cite pre-move paths
Task 1: minor (deferred): strategies/lunhui-s0{1,2}-*/status.yaml one_line/next speak of an A-share bed that main no longer plans
Task 1: complete (commits 6eb71f7..6323cfa, review clean)
Task 2: dispatched (base 6323cfa, implementer opus)
Task 2: implementer DONE_WITH_CONCERNS at 999bd6f (1341/1323/18, typecheck clean); concerns: extra isWeekend export, non-year json refused, import fails on a bad table, uncovered source = newest annual notice
Task 2: minor (deferred): multi-year getMarketSession untested (market.mjs binds the default dir at load, plan-mandated) — add a market test when 2027.json ships
Task 2: minor (deferred): holiday ranges not checked for overlap/order (calendar.mjs:61-71)
Task 2: minor (deferred): an empty calendar dir degrades quietly to "" coverage instead of refusing (calendar.mjs loadCalendars)
Task 2: minor (deferred): validation branches untested: non-object table, non-object holiday, missing name
Task 2: minor (deferred): extra isWeekend export, JSDoc should say it assumes a valid date
Task 2: complete (commits 6323cfa..999bd6f, review clean)
Task 3: dispatched (base 999bd6f, implementer opus)
Task 3: implementer DONE_WITH_CONCERNS at 49d3216 (1347/1329/18, typecheck 0)
Ruling: SOURCE_FROZEN joins spec §5.7's refusal codes — one snapshot per source per run, A27's rule that two snapshots of one pool would disagree — costs a code rename if the operator prefers another word.
Ruling: sealRun on a run with no evidence seals with as_of null at the library level; plan 2's context read is where an empty or under-evidenced run is answered (NOT_EVALUABLE per §5.4) — costs a guard in plan 2 if wrong.
Task 3: review Approved, 7 minors. Ruling: minors 1-3 are taken as a fix round because minor 2 is load-bearing for Task 7 — addEvidence overwrites an item's own id, and Task 7's derived items carry one; addEvidence now refuses (TypeError) a non-plain-object item or one that already has id, validates meta.host (string), delayed and truncated (booleans), and the rollback gets its test. Task 7's derived items therefore carry no id of their own: their id is addEvidence's evidenceId over the whole item, and derive.mjs returns the would-be id only through evidenceId for inputs of later derivations — costs a re-plan of Task 7's id field if wrong.
Task 3: minor (deferred): ids hash canonical JSON, file bytes and snapshot use plain JSON.stringify — note it in the JSDoc
Task 3: minor (deferred): openRun can leave a half-made run if the second write fails — a residual line in the header
Task 3: minor (deferred): run.json itself is under readText's 256 KiB cap; the eight-freeze budget bounds it
Task 3: fix round 1/5 (3 addressed, 0 open; commits 49d3216..8056bb6)
Task 3: minor (deferred): addEvidence docstring wraps awkwardly ("TypeError. A")
Task 3: complete (commits 999bd6f..8056bb6, review clean)
Task 4: dispatched (base 8056bb6, implementer opus)
Task 4: implementer DONE_WITH_CONCERNS at 309b522 (1362/1344/18, typecheck clean, lock +1 line)
Ruling: withRun needs an existing run, so Task 8's freeze with run omitted calls openRun first (a fresh unique id has no contender) and then takes withRun on it — the plan's "withRun: opens a run" ordering is read that way — costs a small reorder if wrong.
Ruling: refuse.toolBudget's text names the freeze budget only; plan 2 adds the per-module text — costs nothing now.
Task 4: review Needs fixes — Important 1: upstreamError dropped stage 0's no-quote branch (NO_QUOTE_MESSAGES → NO_MARKET_DATA). Ruling: restore it in upstreamError with a provider-named NO_MARKET_DATA text (option a), so every freeze row inherits stage 0's mapping — costs nothing if wrong. Minors 1 (runs.mjs BAD_RUN_ID text names the retired tool) and 3 (readText NO_SUCH_RUN swallowed in lunhui_read_run) ride along.
Task 4: minor (deferred): the 24 KiB artifact cap is on the compact JSON — state it in the docstring
Task 4: minor (deferred): missing-argument test does not assert what rejects (match ToolArgsError)
Task 4: minor (deferred): withRun order is by resolution, not call — say so in the docstring
Task 4: minor (deferred): lunhui_read_run resolves strategy and run twice
Task 4: fix round 1/5 (3 addressed, 0 open; commits 309b522..72bfc38)
Task 4: minor (deferred): unusableFile is an ad hoc own property on LunhuiError; no-quote errors matched by exact message string (as stage 0)
Task 4: complete (commits 8056bb6..72bfc38, review clean)
Task 5: dispatched (base 72bfc38, implementer opus)
Task 5: implementer DONE_WITH_CONCERNS at 91ead38 (1371/1353/18, typecheck clean)
Ruling: pagesize=500 for all three pools (the plan's 500-row cap) with AKShare's sorts kept — the cap is the spec's, AKShare's 10000/5000 would fetch past it — costs a truncated pool on a 500+ day, flagged truncated.
Ruling: only the 涨停 pool's null or empty data refuses NO_MARKET_DATA; a null or empty 炸板 or 昨日涨停 pool is an empty list — a day with no 炸板 is a market state, and a holiday or pre-market date already refuses through the 涨停 pool of the same date — costs a silent [] if Eastmoney ever serves zt but fails zb.
Ruling: one host string for the three pools, distinct hosts joined by "," — the evidence file has one host field (§5.1) — costs nothing.
Task 5: review Needs fixes — Important 1 (partly plan-mandated): truncated can never fire under pagesize=500; read data.tc. Ruling: truncated = rows > 500 or data.tc > rows kept, the ruled page size stays — costs nothing if wrong. Minor 1 (redirect refusal text says PROVIDER_HTTP_ERROR) rides along.
Task 5: minor (deferred): fetchBytes messages say 腾讯行情 on the Eastmoney path (rewritten by upstreamError; stderr stacks mislead)
Task 5: minor (deferred): timeout is per hop, a followed redirect can take 2 x 7 s — one comment line
Task 5: minor (deferred): fixture-fetch push2 clist positive branches untested — cover in Task 6
Task 5: minor (deferred): a fetchImpl ignoring signal keeps running after its limiter slot frees on timeout (fakes only)
Task 5: fix round 1/5 (2 addressed, 0 open; commits 344885b..4e68593)
Task 5: complete (commits 72bfc38..4e68593, review clean)
Task 6: dispatched (base 4e68593, implementer opus)
Task 6: implementer DONE_WITH_CONCERNS at 2138f7d (1376/1358/18, typecheck clean)
Measured 2026-10-25 by the controller (one GET): the all-A-shares clist with pz=1000 answers via a 302 to push2delay (dlmkts "8,10,128"), total 5925, 100 rows — the live page cap is 100, not 1,000.
Ruling: fetchMarketCounts reads 100 a page (the measured cap) with maxPages 64, page 1 first for total, the rest concurrently through inFlight; spec A28's "1,000 a page" is superseded by the measurement and goes to the docs pass (Task 13) — costs about 60 requests a counts freeze (~5 s at four in flight) if wrong.
Ruling: AKShare's queries win where they differ from the brief (boards fs "m:90 t:3 f:!50", counts fs with the Beijing exchange, ut tokens, members fid=f12) — §7 makes AKShare the source of the query strings — costs a fixture remap if wrong.
Task 6: review Approved, 5 minors.
Measured 2026-10-25 by the controller: the live concept-board list sorted by fid=f6 leads with 融资融券, 昨日高振幅, 深股通, 基金增仓, 富时罗素 — membership and screen boards, not 题材.
Ruling: fetchBoards ranks the top 30 by change (fid=f3, po=1) instead of turnover, keeping f6 in every row so turnover share is still derived, and Task 8's default constituents are the first 10 of that list — a turnover ranking would hand the theme module index-membership pseudo-boards; spec §5.3's "ranked by turnover" goes to the docs pass — costs a one-line re-sort if the operator prefers turnover.
Ruling: minors 1 (a failed count read leaves queued pages running in the shared limiter) and 2 (no test for a later page failing) are taken as a fix round with the re-sort — the shared limiter is every freeze's — costs nothing if wrong.
Task 6: minor (deferred): mixed hosts across count pages not tested or flagged partial
Task 6: minor (deferred): the board-code refusal is built inline, not in errors.mjs's table
Task 6: minor (deferred): top/max/pageSize not validated (internal callers only)
Task 6: fix round 1/5 (3 addressed, 0 open; commits b2310a1..2f2d192)
Task 6: complete (commits 4e68593..2f2d192, review clean)
Task 7: dispatched (base 2f2d192, implementer opus)
Task 7: implementer DONE_WITH_CONCERNS at ef1923b (1390/1372/18, typecheck clean); rowKey exported; deriveBoards keeps an unused members parameter (brief's signature)
Task 7: review Approved, 4 minors.
Ruling: board breadth stays advancers / (advancers + decliners), the plan's form, over spec A20's "advancers over members" — unchanged members (suspended, flat) carry no direction and the board's own counts give no member total — costs a one-line formula change if the operator wants members as denominator.
Ruling: Task 8's ids map builder refuses a duplicate rowKey (TypeError) — fixes Task 7 minor 1 at its source — costs nothing.
Task 7: minor (deferred): a comment that params.board is what separates two boards' turnover_share ids
Task 7: minor (deferred): inputs mean rows read, not rows counted — say so in the JSDoc
Task 7: minor (deferred): deriveBoards' members parameter is unused (plan signature); Task 8 passes the member lists anyway
Task 7: complete (commits 2f2d192..ef1923b, review clean)
Task 8: dispatched (base ef1923b, implementer opus)
Task 8: implementer DONE_WITH_CONCERNS at d895516 (1404/1386/18, typecheck clean)
Ruling: a freeze counts before it checks RUN_SEALED, and an argument refusal (INVALID_SYMBOL) runs before the calendar and touches no run — A7 counts refused calls that reach the run; a malformed call has no run to count against — costs nothing if wrong.
Ruling: when a freeze that opened its own run fails, the refusal text names the opened run id so the retry passes it instead of opening a second empty run (an id, not a path) — costs one sentence per refusal.
Ruling: the index freeze fails whole on a Tencent failure — the four indices are one source; a partly frozen index file would let a module read a half environment — costs a retry on a flaky day.
Task 8: review Needs fixes — Important 1: host and delayed live only at file level; A28/§5.3 say every Eastmoney item. Ruling: stamp every Eastmoney item (pool rows, boards, member lists, flow rows, the counts item) with its own reply's host and delayed; the file meta stays as the summary — costs ~60 KB on a full pool day, inside 256 KiB. Minor 1 (calendarUncovered inside an opened run claims nothing was written) rides along: check expectedQuoteDate before the run is touched.
Ruling: the boards argument refusal reuses INVALID_SYMBOL — stays inside §5.7's code list — costs nothing.
Task 8: minor (deferred): kind "strategy" and refuse.wrongChannel("strategy") are dead paths until plan 3's strategy-only tools
Task 8: minor (deferred): in-flight boards/index requests run to completion after a sibling fails (shared AbortSignal would end them)
Task 8: minor (deferred): WRONG_CHANNEL test uses one non-market strategy only
Task 8: fix round 1/5 (2 addressed, 0 open; commits a1967d3..21d077d)
Task 8: minor (deferred): docstring lines past the usual width in freeze-boards-row.mjs and freeze-tool.mjs
Task 8: complete (commits ef1923b..21d077d, review clean)
Task 9: dispatched (base 21d077d, implementer opus)
Task 9: implementer DONE_WITH_CONCERNS at e6a4fbf (1410/1392/18, typecheck clean, FACE_SMOKE smoke + bots-smoke pass on a temp DSH_HOME, port 0)
Ruling: the freeze rows' config is {} — they read the strategies root through the injected lunhuiRuns service, one source of truth; spec §5.12's "config: { strategiesRoot }" for every row goes to the docs pass — costs one config key if wrong.
Ruling: "no lunhui_ tool in a bot's scope" is pinned offline in bots.test.ts over DEFAULT_ALLOW and every shipped bot, not on a real bots-smoke boot (spec §6 names bots-smoke) — the allow lists are what masks a bot; plan 2's protocol section adds the bots-smoke case — costs one smoke assertion later.
Task 9: minor (deferred): the override test cannot tell replace from merge (only strategiesRoot on both sides)
Task 9: minor (deferred): the smoke does not log the roster (brief Step 4's "prints")
Task 9: minor (deferred): spec §5.12 freeze-row config to re-fit to {} in the docs pass
Task 9: minor (deferred): lunhui.ts computes the same dirname twice
Task 9: complete (commits 21d077d..e6a4fbf, review clean)
Task 10: dispatched (base e6a4fbf, implementer opus)
Task 10: implementer DONE at 923242f (1411/1393/18, typecheck clean, GRAVIT.md 3459 bytes)
Task 10: review Approved, 4 minors. Ruling: minors 2 (a state changing is not a label being wrong) and 3 ("冻结之后不再补冻" over-reaches §5.10's "never freeze after a role has read") are taken as a quick wording fix — the thesis is what Gravit reads as the channel's rules — costs nothing.
Task 10: minor (deferred): falsification names measures without thresholds or a window (thresholds would be research candidates; the operator reviews theses)
Task 10: minor (deferred): the corpus is absent locally, so no quotation check against the manuscript ran; grep "单一个股的上涨不构成题材" once the corpus is back
Task 10: minor (deferred): the GRAVIT.md line is past the usual wrap (verbatim per the brief)
Task 10: fix round 1/5 (2 addressed, 0 open; commits 923242f..f1c0f64)
Task 10: minor (deferred): the thesis names "states a label can move into" without a transition map for the seven labels
Task 10: complete (commits e6a4fbf..f1c0f64, review clean)
Task 11: dispatched (base f1c0f64, implementer opus)
Task 11: implementer DONE_WITH_CONCERNS at 569482d (1423/1405/18, typecheck clean)
Ruling: an unreadable present artifact is left out of artifacts (no accepted:false) — the card shows what can be shown; the run still lists with its bytes — costs a "present but unreadable" hint if the operator wants one.
Ruling: metrics.json is not read by the card (no field carries it) and the expectation card reaches latestRun through artifacts.mode — A14's shape names no metrics field; Task 12's view takes expectation from artifacts.mode.headline — costs a field later if the card grows counters.
Task 11: automated security review flagged TOCTOU on intermediate directories in channels.ts (lstat of analysis/ or a run dir, then a read through join(): O_NOFOLLOW guards only the last component). Ruling: real but low impact (a writer inside strategies/ could swap a run dir for a link between the check and the read, and up to 24 KiB of a JSON file elsewhere would reach the operator's own tokenized page); taken into Task 11's fix round — re-check each run dir's realpath lies under the strategy's realpath/analysis immediately before its reads, as runs.mjs's stillResolved does — costs a realpath per run.
Task 11: review Approved, 3 minors. Fix round 1 takes the security finding (= minor 2) plus minors 1 (one bad run dir blanks the card) and 3 (test helper uses stat).
Ruling: "accepted" on the card means the module file is present and readable — plan 2's submit writes a module file only after its validator accepts it, atomically — costs a cross-check against run.json's artifacts[] if plan 2 ever writes before validating.
Ruling: latestRun is chosen among the 50 listed runs — the card's reads stay bounded; a newer accepted run cannot hide past 50 newer ones in practice — costs nothing.
Task 11: fix round 1/5 (3 addressed, 0 open; commits 569482d..91c2d2b)
Task 11: minor (deferred): residual check-then-use window after stillAt; a run skipped mid-read leaves no indicator on the card
Task 11: complete (commits f1c0f64..91c2d2b, review clean)
Task 12: dispatched (base 91c2d2b, implementer opus)
Task 12: implementer DONE_WITH_CONCERNS at 85b110b (1434/1416/18, typecheck clean)
Ruling: the Research runs section is drawn only when runs is a non-empty array — every channel (the workbench root, room-drill, bots' channels) would otherwise carry a "no runs yet" section; runsView keeps its empty word, and "no sealed run with an artifact yet" still shows inside a channel that has runs — costs the empty word on cn-market before its first run.
Ruling: latest.details (module + compact JSON) joins the view's shape for spec §5.11's collapsed artifacts — costs nothing.
Task 12: minor (deferred): the mode chip repeats the expectation fields the kv card already shows
Task 12: minor (deferred): an accepted module with an empty headline shows a bare name chip
Task 12: minor (deferred): off-type latestRun artifacts untested at the view level
Task 12: minor (deferred): two "missing" conventions in one run row (cosmetic)
Task 12: complete (commits 91c2d2b..1a41fd8, review clean)
Ruling: Task 13 also adds a dated "Build notes, plan 1" section to the spec recording what the build measured or ruled against its text (A28's page size, §5.3's board ranking, §5.12's freeze-row config, SOURCE_FROZEN, A20's breadth denominator) — the spec stays the authority and must not drift silently from the tree — costs one section the operator may fold back into the clauses.
Task 13: dispatched (base 1a41fd8, implementer opus)
Task 13: implementer DONE_WITH_CONCERNS at b37fff6 (1435/1417/18, typecheck clean, corpus/analysis status empty); schema sizes measured: lunhui_ 5 tools 6,133 bytes, total 80 tools 227,274 bytes; residuals R39-R43; concerns: the 'disabling only lunhui-runs refuses the boot' claim is reasoned not booted; runs.mjs comments still say MCP server / LUNHUI_STRATEGIES_ROOT
Task 13: review Approved, 5 minors.
Ruling: the README's first-market-freeze drill is recorded as owed with plan 2 instead of two commands — the freezes are model-called tools, nothing in the tree calls one without a model — costs a drill section in plan 2.
Task 13: minor (deferred): DEVELOPMENT §4.3 states the wrong mechanism for "no backbone refuses the boot" (the freeze rows stay pending on lunhuiRuns and the strict row audit refuses; freezeDeps' message never shows); no boot pins it
Task 13: minor (deferred): R39/R40 cite "stage 0's R32/R33" without naming the graft ledger, colliding with this document's own R32/R33
Task 13: minor (deferred): runs.mjs JSDoc still names LUNHUI_STRATEGIES_ROOT and an MCP server
Task 13: minor (deferred): CLAUDE.md is 67 lines (the target is ~55)
Task 13: complete (commits 1a41fd8..b37fff6, review clean)
Final review: dispatched (merge base a89502f, head b37fff6, fable)
Final review (fable): With fixes — 0 Critical, 2 Important, 6 Minor; triage: T1/T13 comment sweep, T13 §4.3 mechanism, T13 R39/R40 ledger name must fix; the rest can wait; the manuscript-quotation grep gates the push.
Ruling: Important 1 — every evidence file and run.json evidence entry records `session` (the trading day its data belongs to, getMarketSession(now).expectedQuoteDate as YYYY-MM-DD; the quotes freeze too) and sealRun writes run.json `session` = the latest evidence session, beside as_of — plan 2's A5 same-day rule and CURRENT/HISTORICAL wording then read a trading day, not a wall clock — costs one field in three files.
Ruling: Important 2 — the limit-up source gets its own 1 MiB evidence cap (others stay 256 KiB; the run stays ≤ 2 MiB), so three full 500-row pools (~585 KB stamped) fit and the derived ratios keep reading every row; EVIDENCE_TOO_LARGE's text stops promising a range the tool lacks — costs 1 MiB of gitignored disk per market run; recorded in spec §12.
Ruling: the final reviewer's disagreement with the T11 ruling is accepted — the card marks an artifact accepted only when run.json's artifacts[] names it (A10's record of what a submit landed) — costs one includes() check; plan 2's submit must append to artifacts[].
Ruling: final Minors taken in the one fix wave: dedupe duplicate pool keys (keep the first, count duplicates) instead of INTERNAL; the Tencent fan-out in the index freeze recorded as a §12 row (the limiter stays Eastmoney's); the stale MCP/LUNHUI_* comment sweep; .gitignore adds run.pending.json and *.tmp under runs; kind "quote"/"index" on quote items; §4.3 mechanism corrected and marked unverified by a boot; R39/R40 name the graft ledger.
Final fix wave: dispatched (base b37fff6, opus)
Final fix wave: DONE_WITH_CONCERNS, commits b37fff6..2ec42b9 (1441/1423/18, typecheck clean, FACE_SMOKE smoke 1/1)
Ruling: the pre-run calendar check now covers all four freezes (a null previous session refuses CALENDAR_UNCOVERED before any run) — it is what makes session non-null — costs nothing.
Ruling: lunhui_read_run still reports accepted from the file alone while the card needs the artifacts[] name; parked to plan 2, whose submit writes both — costs one includes() in plan 2.
Ruling: readText's 256 KiB bound cannot read a limit-up file between 256 KiB and 1 MiB; plan 2's context builder gives that source its own bound — costs nothing in plan 1 (nothing reads evidence back).
Final fix wave re-review (fable): all 9 addressed, no new Critical/Important.
Final: minor (deferred): freeze reply spreads a row's summary among the standard fields (a reserved-key guard later)
Final: minor (deferred): addEvidence's session guard accepts 2026-02-30 (host-bug guard only)
Final: minor (deferred): per-run card rows carry no session; only the latest line shows it
Plan 1: complete (a89502f..2ec42b9, final review with fixes, re-review clean)
