# SDD ledger — plan: docs/superpowers/plans/2026-10-26-lunhui-modules-plan-2.md

Spec: docs/superpowers/specs/2026-10-25-lunhui-modules-design.md (approved; §12 build notes from plan 1). Branch feat/lunhui-modules-2 from main 472a06a; plan committed c5c5811. Plan written and self-reviewed in this session (spec coverage: A4 seal, A7 module budgets, A9 protocol, A16/A21 core split and scope allowances, A19 envelope, A23 caller checks on a real boot, A24 digests, §5.4 three market modules, §5.6 rules, §5.9 role, §5.10 protocol, §10 item 2's real-boot market run; the reviewer step and strategy modules are plans 3–4).
Models: implementers + task reviewers opus; re-reviews sonnet; final review fable.

## Pre-flight scan

| Tasks | Shared file / interface | Produces → consumes | Finding |
|---|---|---|---|
| 1 → 3,4,5,6 | contract-core validateEnvelope / buildContext / SCOPE_CLASSES | contracts and the module tool | ok |
| 2 → 3 | service readContext / submit, refuse.readFirst/alreadySubmitted/moduleBudget/rejected, callerIsRole | module-tool | ok |
| 3 → 4,5,6 | defineModule, moduleDeps, contract object shape incl. sources | module rows | ok |
| 4,5,6 → 7 | three row files | lunhui.ts ids | ok |
| 7 → 8 | six tool names registered | role allow list (exact names checked at tools.restrict) | ok |
| 8 ↔ 9 | roles.ts gravitRows / renderGravitComposition, the mirror, roles-smoke | both edit roles.ts and roles-smoke; sequential | ok |
| 1–9 → 10 | the whole pipeline, fixture dirs, freeze config.now | smoke | ok |
| 2 | lunhui_read_run accepted = named in artifacts[] | plan 1's deferred ruling | ok |
| 11 | docs of all | — | ok |

Per task self-agreement: all tasks list their test files and commit lines consistently; Task 7 modifies lunhui-rows.test.ts also touched by Task 2 (sequential, ok); Task 8 rewrites roles.test.ts' "_template alone" case (plan-mandated, intended).

## Progress
Task 1: dispatched (base c5c5811, implementer opus)
Task 1: implementer DONE_WITH_CONCERNS at 5383234 (1462/1444/18, typecheck clean)
Ruling: the digest carries an `items` map (id → source, kind, scope, item) beyond the brief — the time-scope rule and the module rules need it — costs nothing.
Ruling: all-INSUFFICIENT claims force every headline to UNKNOWN/null/empty (TIME_SCOPE); headline fields come from MODULES (sentiment's conflict is not a headline); truncation is strict priority; derivedFirst is a list of sources — costs small edits if a module needs otherwise.
Ruling: the module path gets module-neutral repair texts (stage 0's mention universe and WAIT, which mislead a module role); stage 0's validateAnalysis keeps its own; and the sentence split adds newline as stage 0 did — costs nothing.
Task 1: review Needs fixes — Important 1 (plan-mandated): a module with no frozen evidence at all cannot submit NOT_EVALUABLE (claims minItems 1, ids minItems 1). Ruling: a NOT_EVALUABLE artifact may carry claims: [] (and then needs no ids); minors 1 (missing_sources must equal context.missing as a set), 2 (envelope properties spread last so a module cannot override them) and 4's give-back-loop test ride along — costs nothing.
Ruling: the theme module's name fields (board names) are carved out of the scope and forbidden-word checks through the core's labelAllow / a name-field list in Task 6 — carried to Task 6's dispatch.
Task 1: minor (deferred): ids are content hashes with no run salt, so an identical row in two runs shares an id (accepted in either) — record, arguably correct
Task 1: minor (deferred): duplicate priority entries would show rows twice; derived-overflow case untested; assert.fail inside try; raw undefined gives a bare TypeError (host only)
Task 1: fix round 1/5 (4 addressed, 0 open; commits 0e522f1..a8fd6b4)
Task 1: complete (commits c5c5811..a8fd6b4, review clean)
Task 2: dispatched (base a8fd6b4, implementer opus)
Task 2: implementer DONE at 1ed75e2 (1480/1462/18, typecheck clean); SUBMIT_IN_PROGRESS never thrown (submits serialize under withRun; concurrent second submit → ALREADY_SUBMITTED); withRun now passes {strategy, run, dir} to fn; build runs inside the run lock
Task 2: review Needs fixes — Important 1 (plan-mandated): a failed context read still unlocks the submit. Ruling: the read is recorded only after build returns (seal and count stay first) — READ_FIRST must mean the role received a context — costs nothing. Minors 1 (crash between rename and manifest test), 2 (repairFor fallback) and 3 (MODULE_NAMES once, from modules.mjs) ride along.
Task 2: minor (deferred): submit reads the manifest twice; the read set never shrinks (docstring note); the concurrent-seal test cannot fail under the mutex (kept as a pin)
Task 2: fix round 1/5 (4 addressed, 0 open; commits 1ed75e2..2475658; 2475658 loosened a flaky concurrent-submit test to accept either winner, still one artifact + one ALREADY_SUBMITTED)
Task 2: complete (commits a8fd6b4..2475658, review clean)
Task 3: dispatched (base 2475658, implementer opus)
Task 3: implementer DONE_WITH_CONCERNS at 9e8d24c (1490/1472/18, typecheck clean)
Ruling: refuse.wrongChannel gains a "module" branch (the freeze wording pointed a module role at lunhui_freeze_quotes) — costs nothing.
Ruling: a submit whose digest is missing (a row reloaded while the service lives on) refuses READ_FIRST instead of INTERNAL — the role's right move is to read again — overrides my earlier "TypeError" resolution — costs nothing.
Ruling: an INVALID_CONTEXT build (the contract's fixed part over 30 KiB) stays INTERNAL — a host bug the contract tests catch — costs nothing.
Task 3: review Needs fixes — Important 1: the read keys its digest by the on-disk run name, the submit by the caller's spelling; a miscased run id (case-insensitive APFS) loops READ_FIRST to TOOL_BUDGET. Ruling: key both by the located canonical {strategy, run} that runs.submit passes to validate; minor 2 (the read description states the one-artifact rule) rides along — costs nothing.
Ruling: A7's "refused ones counted" means refusals inside a resolved run (READ_FIRST, ALREADY_SUBMITTED, INVALID_ANALYSIS, TOOL_BUDGET); the gates before the run resolves (NOT_A_ROLE, WRONG_CHANNEL, NOT_A_STRATEGY, BAD_RUN_ID) are not counted — there is no run to count against, and Gravit's mistaken root submit must not spend the role's ten calls — costs a count line if the operator reads A7 literally.
Task 3: minor (deferred): the digests Map is never pruned (same shape as the service's reads set)
Task 3: fix round 1/5 (2 addressed, 0 open; commits 1f0b184..89660de)
Task 3: minor (deferred): readContext's doc comment has a merged long line
Task 3: complete (commits 2475658..89660de, review clean)
Task 4: dispatched (base 89660de, implementer opus)
Task 4: implementer DONE_WITH_CONCERNS at e5d5698 (1499/1481/18, typecheck clean; full index+quotes context 23,199 bytes, nothing truncated)
Ruling: view cuts (last 20 bars) are carried as bars_total on the shown row rather than named in truncated — the core names whole rows only; Task 6 does the same for members (members_total) — costs a core change if the operator wants cuts in truncated.
Ruling: required stays ["index"] (quotes optional in cn-market per §5.10) over §5.4's "index, quotes" — costs nothing; §12 row in Task 11.
Ruling: the module examples use UNKNOWN headline states with one INSUFFICIENT claim (still a valid artifact), not placeholder states like NEUTRAL/STABLE a role could copy unexamined — costs nothing.
Ruling: headline strings and limitations cite no evidence, so owned scope words there are refused; the hints tell the role to keep such words in claims — costs a carve-out later if roles trip on it.
Task 4: review Approved, 6 minors. Ruling (fix round): minor 2 is a spec/core tension — A21's derived-item binding makes every 指数 sentence cite turnover or breadth, the coupling system-design §4 forbids. The core lets a contract say which evidence satisfies an owned class (an `ownedBy` predicate per class, default: a derived item); environment's `index` class accepts an index quote, a bars item or a derived item. Minor 1 rides along: each non-UNKNOWN state needs its own non-INSUFFICIENT claim (index_state and liquidity_state not satisfied by the same claim). Minors 3 (hint: 涨跌家数 is the market class, not owned) and 4 (pin the 8-symbol context: index rows never truncated, quote history first to go) ride along — costs a core option; recorded in spec §12 by Task 11.
Task 4: minor (deferred): rule messages reach REFERENCE through the classifier's substring; the example's fallback edge unpinned; the quotes freeze of index symbols duplicates index bars in the context
Task 4: the implementer saw the miscased-run module-tool test fail once in a combined run; the controller re-ran the three files 8 times: 0 failures. Logged as a possible flake for the final review to examine (the test makes a run id by case; a timing or a stat on APFS).
Task 4: fix round 1/5 (4 addressed, 0 open; commits 3c4a7d6..1bfaea9)
Task 4: complete (commits 89660de..1bfaea9, review clean)
Ruling: Tasks 5 and 6 go to one implementer as one dispatch (same contract shape, two commits) and one review unit — they share the pattern Task 4 set — costs a larger review package.
Tasks 5+6: dispatched (base 1bfaea9, implementer opus)
Tasks 5+6: implementer DONE_WITH_CONCERNS at 06e4a28 (sentiment) and 58fb7c6 (theme, plus a core exemptPaths option) — 1524/1506/18, typecheck clean; full contexts 14,450 and 14,014 bytes
Ruling: sentiment's context carries no index quotes or bars (the brief's priority); roles cite counts or index derived items for the index side — costs nothing.
Ruling: a theme 题材/主线/轮动 sentence needs any boards-source derived item, not one of the board it names; candidates are bound to their exact board, members item and frozen name — costs a tighter rule later if roles cite loosely.
Ruling: exemptPaths ["mainline_candidates[*].name"] skips only the forbidden-word and scope checks, the name must equal the frozen board name — costs nothing.
Tasks 5+6: review Needs fixes — Important 1: the example/firstId/NOT_EVALUABLE scaffolding copied into three contracts. Ruling: hoist into one shared helper. Minors ride along: (1) the sentiment example's conflict names no real measures; (2) every non-UNKNOWN headline state needs a non-INSUFFICIENT claim citing its kind of evidence (money_effect and freeze_type: a limit-up derived item; theme_stage and rotation: a boards derived item), as environment set; (4) the theme hint names the members item's upstream truncated apart from the context's truncated list; (5) a theme overflow pin; (6) one shared test harness for the three contract tests; (7) sentiment's market class carried by counts or an index derived item; (8) a NOT_EVALUABLE test for missing index — costs one fix round.
Tasks 5+6: minor (deferred): rule messages bent to reach REFERENCE through the classifier's substring (same as Task 4's)
Ruling: spec §5.6's "a 题材 named without a frozen board is REFERENCE" is built as the scope rule (UNSUPPORTED_SCOPE without a boards derived id) and the member cut as members_total — both go to spec §12 in Task 11 — costs nothing.
Tasks 5+6: fix round 1/5 at 9274c0b (8 addressed; plus a core derivedView option — derived items show inputs_total instead of id lists, else 30 turnover_share items × 30 ids filled the theme context — and theme priority board, members, flow, zt)
Ruling: derived inputs are counted (inputs_total) in contexts, the file keeps the full lists — costs nothing; the context still cites the derived item by its id.
Ruling: the theme view shows 10 members per list (members_total kept) and board/flow rows without host/delayed/leader in the context (the file keeps every stamp; the context header states the source's host and delayed), so all ten frozen member lists fit at live size — a candidate must be able to cite its board's members item — costs member detail in the context.
Tasks 5+6: fix round 2/5 at 6bb738e (members 10 a list, rows unstamped in the context, hints may be a function of the digest for the source's one "served" line) — BLOCKED as instructed: nine of ten member lists fit at live size (30,616 of 30,720 bytes; boards derived items 11,201)
Ruling: derived items are shown in every module's context as {id, measure, value, params?, partial?, inputs_total} — source, kind and scope are implied by the derived section — which frees ~3.6 KB so the tenth list fits; the file and the digest keep every field — costs nothing.
Tasks 5+6: fix round 3/5 at 8ef5f68 (one derived row shape for the three modules; theme 30-board pin 30,708 bytes with all ten member lists; environment 30,442; sentiment 13,699 / 30,488 with a 150-row pool)
Tasks 5+6: re-review of rounds 1-3: all addressed, no new Critical/Important
Tasks 5+6: minor (deferred): the theme pin's flows.length > 0 is a last-row tripwire — a floor (≥ 8 flow rows) and 10-character board names would show the ~2 KB headroom guarding the ten member lists
Tasks 5+6: minor (deferred): DERIVED_HINT's "时效同其来源文件的各行" is loose for the index file (bars HISTORICAL, derived CURRENT)
Tasks 5+6: complete (commits 1bfaea9..8ef5f68, 3 fix rounds, review clean)
Task 7: dispatched (base 8ef5f68, implementer opus)
Task 7: implementer DONE_WITH_CONCERNS at 86f7f99 (1534/1516/18; FACE_SMOKE smoke + bots-smoke pass, eleven tools, eight rows active); boot/bots tests now compare against written-out lists (they compared the lists with themselves before)
Ruling: setup.ts's PATCH_HEADER "The five Lunhui rows" goes to Task 11's docs pass — costs nothing.
Task 7: complete (commits 8ef5f68..86f7f99, review clean)
Task 8: dispatched (base 86f7f99, implementer opus)
Task 8: implementer DONE_WITH_CONCERNS at dfc069c (1536/1517/19; FACE_SMOKE=1 npm test 1534 pass, 0 fail, 2 skipped; roles-smoke 2/2)
Ruling: NOT_GRAVIT on a real boot is pinned on a plain subagent child, since the role child cannot see lunhui_freeze_index at all (its allow list masks it: dsh refuses "unknown tool") — the stronger fence; both pinned — costs nothing.
Ruling: the smoke's temp strategies root comes through a home-patch override of lunhui-runs' strategiesRoot, no new boot option — costs nothing.
Task 8: minor (deferred): role.yml's summary says "cites evidence ids only … trades nothing" which ROLE.md does not state (the allow list and validator enforce it) — trim or add a clause in Task 11
Task 8: minor (deferred): a smoke comment says the root submit is refused "before the run is touched" without checking calls.environment; redundant mirror substring checks
Task 8: complete (commits 86f7f99..dfc069c, review clean)
Task 9: dispatched (base dfc069c, implementer opus)
Task 9: implementer DONE at 20d5a0a (1545/1526/19; FACE_SMOKE bots-smoke + roles-smoke 3/3; lunhui-run.md 1,873 bytes; seam protocolsDir; duplicate protocol names refused)
Ruling: the protocol tells Gravit to journal a run with NOT_EVALUABLE artifacts in the channel's journal.md (spec §5.10 "journaled as such"; §5.8 says Gravit writes journal entries) — the brief omitted it — costs one sentence; taken into the review's fix if the review finds nothing else, or added there.
Task 9: review Needs fixes — Important 1: no journaling clause (§5.10). Fix round with minors 1 (name each artifact's file in the final message), 2 (say which modules have no artifact at all), 3 (a refused first freeze names the run to pass on), 4 (protocol names may not take gravit:* section names), 5 (one LUNHUI_RUN_SECTION constant or a test that both agree), 6 (every lunhui_* the protocol names is a registered tool).
Task 9: fix round 1/5 (6 addressed, 0 open; commits 20d5a0a..bb4fb2e; lunhui-run.md 2,240 bytes)
Task 9: complete (commits dfc069c..bb4fb2e, review clean)
Task 10: dispatched (base bb4fb2e, implementer opus)
Task 10: implementer DONE_WITH_CONCERNS at 91307f2 (smoke 1/1 ~1.2 s, twice; npm test 1548/1528/20; typecheck clean); all three artifacts real OK ones built from the parsed contexts and re-validated against a rebuilt digest
Ruling: config.now cannot cross the boot's structuredClone of patches, so the smoke shifts globalThis.Date for the boot's lifetime (a Proxy starting Friday 2026-10-23 15:00 China, restored in finally) instead of adding a production config form — the rows stay untouched; the cost is a test-wide clock shift dsh's own timestamps also see — costs a config.nowIso option if the shift ever bites.
Task 10: minor (deferred): temp dirs leak if setup throws before try; the re-validation copies module-tool's argument wiring by hand; calls could be pinned at exactly 2; the child's model route not checked on its request; some readings constant though cited
Task 10: complete (commits bb4fb2e..91307f2, review clean)
Task 11: dispatched (base 91307f2, implementer opus)
Task 11: implementer DONE_WITH_CONCERNS at 91b521d (1548/1528/20; FACE_SMOKE 1546 of 1548, 2 skipped for want of FACE_ACCOUNT_SEAT_DIR; schema sizes lunhui_ 11 tools 13,016 bytes, total 87 tools 47,997 chars/4; spec §12 plan-2 block 15 rows; R43 updated, R44/R45 new)
Ruling: the three stale facts in CLAUDE.md's face/, bots/ and face/tests/ rows (five rows → eight, "none today" → cn-market-analyst, 18 → 20 real boots) are corrected in place, no line added — CLAUDE.md must state present-tense facts — costs nothing.
Ruling: the charter (Gravit-Design.md) and the loops page wait for plan 4's docs pass, as the spec's §6 and §8 place them — costs a lag in two documents.
Measured: the schema-size run's stderr shows the operator's live ~/.dsh patch still trying to start an alpaca_kit server — the operator's file, untouched; reported to the operator.
Task 11: minor (deferred): DEVELOPMENT's validator-order sentence places the all-INSUFFICIENT→UNKNOWN check in the status rule; the code runs it after time scope as TIME_SCOPE
Task 11: minor (deferred): CLAUDE.md's face/ row says the eight rows "freeze" research runs (three read contexts and take artifacts)
Task 11: minor (deferred): the spec now has two "## 12." headings (plan 1's and plan 2's build notes)
Task 11: complete (commits 91307f2..78c6b44, review clean)
Final review: dispatched (merge base 472a06a, head 78c6b44, fable)
Final review (fable): With fixes — 0 Critical, 3 Important (the miscased-run test fails when the 8 hex chars are all digits, ~2.3% a run; sentiment hints send the role at index words it does not own — a TOOL_BUDGET loop; "Gravit never submits" — a plain spawn child passes NOT_A_ROLE, undocumented), 8 Minor.
Ruling: one fix wave takes the three Importants (deterministic miscase via run.replace("T","t"); a sentiment word-avoidance hint like theme's; one sentence in R44 and the README that A23's gate admits any unseeded child, a plain spawn child included) and minors 4 (ROLE.md: a third rejection stops that module only, the role goes on and reports each blocked module), 6 (prune a module's digest after an accepted submit), 8 (validator-order sentence), 9 (plan 2's build notes as "## 13."), 10 (CLAUDE.md "freezing and analysing"), 11 (DERIVED_HINT: derived items are CURRENT for the run's session unless their file's session is older) and the budget sentence in the tool descriptions (refused calls inside a resolved run) — costs one wave.
Ruling: final Minor 5 (SCOPE_EXEMPT's 需要/不足/仅凭 and no split on "，" let a hedged owned-class clause pass without evidence) is deferred to plan 3, where the mode conclusions ride on the scope rule — costs a looser plan-2 validator until then.
Final fix wave: dispatched (base 78c6b44, opus)
Final fix wave: DONE, commits 78c6b44..cb70f16 (1550/1530/20, typecheck clean, roles-smoke + market-run smoke 3/3, module-tool file 10x stable); the report's status is blocked when any module is blocked
Final fix wave re-review (fable): all 10 addressed, no new Critical/Important.
Final: parked — Ruling: the third-rejection change left three stale descriptions (face/README.md and DEVELOPMENT.md §3.8 still say a module's third rejection stops the role; DEVELOPMENT gives ROLE.md 1,337 bytes, now 1,450), spec §13 lacks a row for the departure from §5.9's "blocked exit after … the third rejection", and lunhui-run.md's "角色以 blocked 停止" now reads loose — no second fix wave by the process; offered to the operator as a docs follow-up — costs three stale sentences until then.
Final: minor (deferred): DERIVED_HINT does not mention the null-session edge (frozen files always carry a session)
Plan 2: complete (472a06a..cb70f16, final review with fixes, re-review clean)
