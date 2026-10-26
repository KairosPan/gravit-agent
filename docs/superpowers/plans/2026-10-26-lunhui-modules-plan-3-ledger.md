# SDD ledger — plan: docs/superpowers/plans/2026-10-26-lunhui-modules-plan-3.md

Spec: docs/superpowers/specs/2026-10-25-lunhui-modules-design.md (approved; build notes §12 plan 1, §13 plan 2). Branch feat/lunhui-modules-3 from main 3418043; plan committed ffb2a6e. Plan written and self-reviewed in this session (coverage: A5 freshness, A6/A22 counterevidence gate for S01/S02, A12 expectation card and review, A18 mode set and research_only labels, A27 leader within the cited market run, E4 daily registration and the theses' re-fit, §5.4–§5.6 leader and mode, §5.9 cn-stock-analyst, §5.10 strategy channel; counterevidence and the reviewer are plan 4). The operator asked for plans 3 and 4 ("计划 3 和 4").
Models: implementers + task reviewers opus; re-reviews sonnet; final review fable.

## Pre-flight scan

| Tasks | Shared file / interface | Produces → consumes | Finding |
|---|---|---|---|
| 1 → 2,3 | marketRun option, readSealedRun, previousTradingDay, buildContext market/marketSources/marketArtifacts, artifactIds, bound market_run fields | leader and mode contracts | ok |
| 2 → 3 | leader.json accepted in the run | mode reads it | ok |
| 2,3 → 4 | two rows, four tools | composition, role allow list | ok |
| 3 ↔ 4 | THESIS falsification read by mode; Task 4 rewrites it | the mode context shows the section verbatim, bounded | ok — mode reads whatever THESIS holds |
| 4 → 5 | role, rows | protocol, smoke | ok |
| 6 | docs of all | — | ok |

Per task self-agreement: Task 5's smoke concludes WAIT (S01 needs plan 4's counterevidence) — stated in the task. Task 3's S01 acceptance uses a hand-written accepted counterevidence artifact — stated.

## Progress
Task 1: dispatched (base ffb2a6e, implementer opus)
Task 1: implementer DONE_WITH_CONCERNS at 9811478 (1565/1545/20, typecheck clean)
Ruling: the submit takes no market_run (spec §5.5's shape; the plan said read and submit both) — the digest from the read binds the market run and the envelope's market_run/market_snapshot_id carry it; a second argument only adds a way to be refused — costs nothing.
Ruling: a shown artifact carries its citable id ({id, module, headline, claims}); an uncovered strategy session is STALE_MARKET_RUN (A25 fail-closed) — costs nothing.
Task 1: review Approved, 5 minors. Ruling (fix round): minor 1 is load-bearing for Tasks 2–3 — artifact views are bounded (headline plus at most 6 claims, each claim's text cut to 120 characters, ids whole) and a required artifact the cap leaves out enters `missing`; minors 2 (the run's own item wins an id collision), 3 (runArtifacts honoured without marketRun) and 4 (anchor the free-text artifact id) ride along — costs a smaller artifact view.
Ruling: minor 5 (a refused cited run still seals the strategy run; a strategy run more than one session old can never pass A5) goes into Task 5's protocol sentence: open a new strategy run when the market run is stale — costs nothing.
Task 1: fix round 1/5 (4 addressed, 0 open; commits 4828570..1de0169)
Task 1: complete (commits ffb2a6e..1de0169, review clean)
Task 2: dispatched (base 1de0169, implementer opus)
Task 2: implementer DONE_WITH_CONCERNS at 83bd86b (1580/1560/20, typecheck clean); shared exampleOf now copies market_run/market_snapshot_id
Ruling: the flags share one non-INSUFFICIENT claim citing a pool row; any pool (zt, zb, yesterday) counts; a duplicate symbol is REFERENCE and NONE stands alone — costs nothing.
Ruling (before review): a candidate's board, when given, must be a theme mainline board whose frozen members list holds the candidate's code (A27: 顺位 within the market run's mainline candidates) — costs a tighter rule.
Ruling (before review): the leader's market views are filtered to what a candidate can stand on — pool rows whose code is one of the strategy run's frozen equities, members items only of the theme artifact's mainline boards (each showing its first 10 members plus any frozen equity among them) — so a live-size market run cannot push the ids a candidate needs out of the 30 KiB context; a live-size pin measures it — costs context breadth the leader does not use.
Task 2: rulings applied at 3995845 (a core priority filter(item, digest); live-size leader context 21,307 bytes, nothing cut)
Task 2: review Needs fixes — Important 1 (plan-mandated): a 龙头 sentence can stand on evidence of another stock or be written as a conclusion. Ruling: in rules, every claim sentence matching the leader class must cite the quote of a listed candidate and use 龙头 only as 龙头候选 (总龙头 and a bare 龙头 refused); minor 1 (an unpriced quote cannot be a candidate) rides along — costs nothing.
Ruling: a candidate with board null may stand on any frozen pool row or members list (A27's "a frozen board or pool"), its 顺位 then not tied to a mainline board — costs a tighter bind later.
Task 2: minor (deferred): the schema's union-typed board pattern is not interpreted by checkSchema (rules covers it); the core filter test had no RED
Task 2: fix round 1/5 (2 addressed, 0 open; commits 3995845..41856f9)
Task 2: minor (deferred): a SCOPE_EXEMPT word lets a 龙头候选 sentence skip the candidate-quote citation (as the core scope rule does for gap sentences); a frozen name containing 龙头 (e.g. 龙头股份) as a candidate name is unpinned
Task 2: complete (commits 1de0169..41856f9, review clean)
Ruling: the counterevidence artifact shape is fixed now so mode can address it and plan 4 builds to it: items 0–12 { id: /^x\d{1,2}$/, against: one of the six module names, kind: CONTRADICTS | MISSING_EVIDENCE | STALE | RULING_CONFLICT | OVERREACH, text ≤ 300, evidence_ids 1–16 (evidence or "<module>@<snapshot_id>") } — costs a mode change if plan 4 needs another shape.
Task 3: dispatched (base 41856f9, implementer opus)
Task 3: implementer DONE_WITH_CONCERNS at 1a4cfbc (1602/1582/20, typecheck clean; live-size mode context 29,033 of 30,720 bytes)
Ruling: preconditions 0–8 in the schema (WAIT and NOT_EVALUABLE carry none), S01/S02 require their list through rules; a core unknownHeadline option lets WAIT and a NOT_EVALUABLE review count as asserting nothing — costs nothing.
Ruling: the card binds frozen_version = the run's snapshot_id, state = the cited sentiment state, candidates ⊆ leader candidates; a review grade cites evidence this run froze (the strategy run's quotes) — the grade is of the earlier card against this run's own facts — costs nothing.
Ruling: the mode context's 1.7 KiB headroom with a maximal card and long counterevidence is plan 4's to pin (its reviewer adds the counterevidence view) — carried to plan 4.
Task 3: review Needs fixes — 3 Importants (leader and mode on two market runs; a precondition "met" on any known id; an empty/NOT_EVALUABLE counterevidence passes A22) and a spec issue (the previous-card lookup skips WAIT runs). Rulings, one fix round:
Ruling: the previous card is the newest earlier mode.json of the same strategy from a strictly earlier session (A12's "next run"); a WAIT there has no card to grade, so no review is required — an old card is not re-graded run after run — costs nothing.
Ruling: the mode read refuses MISSING_EVIDENCE when the run's accepted leader artifact cites another market run than the one given (naming the leader's), so leader and mode stand on one market snapshot (A27) — plan 4's counterevidence gets the same binding — costs nothing.
Ruling: each required precondition cites its own class of evidence when met — theme_gate/theme_not_falsified the theme artifact (which has ≥ 1 mainline candidate) or a mainline board/members/boards-derived item; candidate_before_divergence/candidates_pooled the leader artifact or a candidate's quote or pool row; negative_tail_not_widening the yesterday_negative_tail derived item or the sentiment artifact; old_theme_retreat the theme or sentiment artifact or a boards derived item — REFERENCE otherwise — costs nothing.
Ruling: the A22 gate needs the run's counterevidence artifact accepted with status OK and an items array (an OK artifact with no items is a review that found nothing and passes); a NOT_EVALUABLE one is UNADDRESSED_COUNTEREVIDENCE — costs nothing.
Ruling: minors ride along — an `unmet: no source` precondition carries no evidence ids; a THESIS that cannot be read shows `falsification_unreadable: true`; the card hint says price_band is an observation band relative to the anchor, not a target price.
Task 3: fix round 1/5 (7 addressed, 0 open; commits 1a4cfbc..1f052ed; live-size mode context 29,629 bytes)
Task 3: minor (deferred, for the final wave): theme_gate/theme_not_falsified accept a boards derived item of a non-mainline board — tighten to the mainline boards' measures
Task 3: minor (deferred): a missing THESIS.md shows falsification_unreadable; no mode test of a Monday S01 or of the Monday CURRENT-on-Friday refusal; artifact rows carry no scope; a non-OK counterevidence makes addressed entries REFERENCE before the UNADDRESSED gate
Task 3: complete (commits 41856f9..1f052ed, review clean)
Task 4: dispatched (base 1f052ed, implementer opus)
Task 4: implementer DONE_WITH_CONCERNS at 7587d48 (1610/1589/21; FACE_SMOKE smoke, bots-smoke, roles-smoke 5/5, market-run smoke 1/1); E4 paragraphs cut to ~500 bytes to keep the live-size mode context under 30 KiB
Ruling (before review): the mode context shows at most 1,500 bytes of the Falsification section (cut on a character boundary, falsification_truncated true) so an operator's edit of a THESIS can never push evidence out of the context — costs the tail of a long section in the context (the file keeps it).
Ruling (before review): the theses' stale "Not evaluable today: no A-share point-in-time bed…" line is reworded to the daily frame (a run is a daily registration and observation, never a trade; minute-level confirmation and announcements have no source) — the bed no longer exists in the tree — costs one sentence of the operator's text, which the operator reviews under E4.
Task 4: rulings applied at 03bdba7 (falsification ≤ 1,500 bytes flagged; S01 1,445 and S02 1,421 bytes shown whole; the E4 paragraph at the end would be cut first if the operator lengthens a section)
Task 4: minor (deferred, for the final wave): the E4 paragraph sits last in each Falsification section, so it is the first text the 1,500-byte cap cuts — move it to the top; "下一个交易日的运行" is narrower than the code (any later-session run; NOT_EVALUABLE grade allowed); ROLE.md could say the leader must be accepted before the mode
Task 4: minor (deferred): S01's reworded line mentions announcements S01 does not need
Task 4: complete (commits 1f052ed..03bdba7, review clean)
Task 5: dispatched (base 03bdba7, implementer opus)
Task 5: implementer DONE_WITH_CONCERNS at 8020a5e (1613/1591/22; FACE_SMOKE strategy smoke + protocols + market smoke 10/10); lunhui-run.md 2,873 of 3,000 bytes — plan 4's reviewer steps must tighten it (A9's cap); channel.js/channel.test.js touched to draw the review line
Task 5: minor (deferred, to plan 4's protocol rewrite): the STALE path's parenthetical reason is false (a sealed strategy run can be re-read with a fresh market_run before a leader is accepted); "当日" is narrower than A5 (the previous trading day's run also passes); "a refused mode is a result" not carried; how to find the market run id not said
Task 5: minor (deferred): the smoke's mode artifact is mostly the context's example; the smoke duplicates plan 2's builders and Date shift
Task 5: complete (commits 03bdba7..8020a5e, review clean)
Task 6: dispatched (base 8020a5e, implementer opus)
Task 6: implementer DONE_WITH_CONCERNS at aa33d7b (1613/1591/22; FACE_SMOKE 1611 pass, 2 skipped; schema sizes 92 tools 49,172 chars/4, lunhui_ 15 tools 2,703, role_ 2 tools 461; spec §14 15 rows; the live home still runs an alpaca_kit row — reported again to the operator)
Task 6: review Needs fixes — CLAUDE.md bots/ row names one role (two ship); DEVELOPMENT §4 'eight row files' (ten); §4.3 states a sealed run's citation is fixed (it is not); ROLE.md byte count off by one. One fix round.
Task 6: fix round 1/5 (4 addressed, 0 open; commits aa33d7b..e2c12e1)
Task 6: complete (commits 8020a5e..e2c12e1, review clean)
Final review: dispatched (merge base 3418043, head e2c12e1, fable)
Final review (fable): Ready to merge: Yes — 0 Critical; 3 Importants latent until a counterevidence artifact can land (plan 4): (1) a maximal previous card (~10 KB) pushes the required leader out of the mode context → NOT_EVALUABLE, the card never graded (measured: fixed part 25,116 bytes with a maximal card); (2) the counterevidence view is unbounded (12 × 300-char items ≈ 11 KB) → cut → S01 unreachable; (3) the A22 gate does not bind the counterevidence to the leader or the market run (an OK empty review before the leader passes).
Ruling: the three Importants and the folded minors (theme preconditions to mainline-board measures; non-OK counterevidence ordering; the protocol wording set; ROLE.md's leader-before-mode; the 目标价 word in the expectation hint; DEVELOPMENT's "1,091 bytes under the cap" true only for a short card) become plan 4's first tasks, not a fix wave here — plan 4 builds on this branch next and nothing writes a counterevidence artifact before it (R48) — costs nothing if plan 4 lands before any merge; the operator decides merges.
Plan 3: complete (3418043..e2c12e1, final review Yes)
