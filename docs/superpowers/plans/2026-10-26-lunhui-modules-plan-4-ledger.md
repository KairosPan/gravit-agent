# SDD ledger — plan: docs/superpowers/plans/2026-10-26-lunhui-modules-plan-4.md

Spec: docs/superpowers/specs/2026-10-25-lunhui-modules-design.md (§10 item 4, §6 docs rows, §8; build notes §12–§14). Branch feat/lunhui-modules-3 continues (plan 3 head 453b576, plan 4 committed 1d98722). Plan written and self-reviewed in this session against the spec and plan 3's final review (its three Importants and folded minors are Task 1, Task 2's bindings and Task 4's protocol). The operator asked for plans 3 and 4.
Models: implementers + task reviewers opus; re-reviews sonnet (opus for the mode); final review fable.

## Pre-flight scan

| Tasks | Shared file / interface | Produces → consumes | Finding |
|---|---|---|---|
| 1 → 2 | the counterevidence view bound, run artifacts first, the gate's market_run bind | the module's artifacts consumed by mode | ok |
| 2 → 3 | the row and pair | composition, role | ok |
| 3 → 4 | role_cn_reviewer shipped | protocol names it | ok |
| 4 → 5 | lunhui_read_run listing, protocol order | smoke drives it | ok |
| 1–5 → 6 | everything | docs | ok |
| 1 ↔ 2 | counterevidence text cap 160 | Task 1 pins with 160-char items before the module exists (hand-written artifacts) | ok |

Per task: Task 1 tests use hand-written counterevidence artifacts (the module is Task 2's) — stated.

## Progress
Task 1: dispatched (base 1d98722, implementer opus)
Task 1: implementer NEEDS_CONTEXT, uncommitted — every rule built, but the maximal pin cannot fit: fixed part 16,901 bytes, leader view at cap 8,451, counterevidence view at cap 11,247 (12 × 16 ids whole) ≈ 37.6 KB; with a small leader it fits but the latch then cuts every market artifact, so the mode cannot see the sentiment state.
Ruling: artifact views show every evidence_ids array as its first 3 ids plus ids_total (the digest keeps every id; a mode cites the artifact or an item id, not the item's inner evidence), at most 4 claims an artifact (claims_total), and artifact rows do not latch: a view that does not fit is skipped and the smaller views after it are still tried (evidence and derived rows keep plan 2's strict priority). The pin keeps every real maximum and must show leader, counterevidence, sentiment and theme — costs inner ids the role no longer sees in views.
Task 1: NEEDS_CONTEXT again — the pin at every maximum is 30,676 bytes with leader, counterevidence and environment shown, sentiment and theme skipped (~2.6 KB over; a real counterevidence's claims add ~2 KB).
Ruling: a contract may set its artifact view per module; the mode shows the market artifacts headline-only (claims_total, no claims — the mode cites the artifact id and reads state and mainline boards from headlines), in the order sentiment, theme, environment; the run's own artifacts (leader, counterevidence) at most 2 claims of 60 characters; counterevidence items keep 120-character text (the mode answers them) with 3 ids + ids_total — costs claim detail the mode does not cite.
Task 1: implementer DONE at 08f416a (1619/1597/22; maximal pin 30,710 of 30,720 bytes, all five views shown, S01 accepted; live-size 29,293)
Task 1: review Needs fixes — Important 1: the maximal pin's S01 cites ids its own context does not show (0 evidence rows shown). Ruling, one fix round: rebuild the pin's S01 from shown ids only, asserting each is shown; the mode's priority puts the run's own candidate quotes ahead of the derived rows (so a card can be graded from what the role sees); market:sentiment and market:theme join the mode's required (a skipped view gives NOT_EVALUABLE, never an unseen state); minors 4–6 (shared bytes/cut helpers from core; state exempt from the card cut; the long docstring line) ride along — costs a few hundred bytes of derived rows at maximal inputs.
Task 1: minor (recorded for Task 6): the mode context's real margin at maximal inputs is ~1.1 KB before the environment view (then theme) is skipped; 4-byte characters in 12 × 120-character items could take ~1.5–2 KB
Task 1: fix round 3 NEEDS_CONTEXT — items 1, 3, 4 green (and a core bug fixed: the example is rebuilt when a required view is skipped); item 2 misses by one quote (~50 bytes over at maximal inputs).
Ruling: option b — the mode keeps the environment artifact (spec §5.4 has the mode read the market run's three artifacts) but fills it after the candidate quotes, so at maximal inputs it is the view skipped; environment stays optional — costs the environment view at maximal inputs only; spec §15 row in Task 6.
Task 1: fix round 3 done at b216151 (1622/1600/22; maximal pin 30,233 bytes, OK, S01 from shown ids, environment skipped)
Task 1: fix round re-review: all 4 addressed, no new breakage (core first/late fill markers used by the mode only)
Task 1: minor (deferred): the rebuilt example could in principle cite an artifact pruned later (WAIT cites none); no test that the example's cited quote is a shown one
Task 1: complete (commits 1d98722..b216151, 3 rulings on the budget, review clean)
Task 2: dispatched (base b216151, implementer opus)
Task 2: implementer DONE at 748eef6 after a network drop (1631/1609/22, typecheck clean); a forStrategy hook picks the contract by channel; cn-market market_run → WRONG_CHANNEL, a missing one elsewhere → MISSING_EVIDENCE (refuse.marketRunMissing), uncounted; core options requiredAny and scopedFields
Ruling: forStrategy, requiredAny and scopedFields accepted — the smallest options for a channel-dependent contract and item-scoped text — costs nothing.
Task 2: review Needs fixes — Important 1 (plan-mandated): an OK review can pass A22 without ever seeing the sentiment the mode stands on (late acceptance or a cap cut). Ruling: the strategy reviewer's required = ["leader", "market:sentiment", "market:theme"], matching the mode's — a missing or cut view fails closed; minors ride along: requiredAny through hide() (all cut → missing), a strategy-reviewer maximal pin, the against list built from shown views, the mode's item view at 160 characters — costs nothing.
Task 2: minor (deferred to Task 6): docs for forStrategy, requiredAny, scopedFields, marketRunMissing
Task 2: fix round 1 at c9b84e6 (items 1–4 done; strategy reviewer maximal pin 30,703 bytes, OK, leader/sentiment/theme shown)
Ruling: the mode keeps showing counterevidence items at 120 of their 160 characters — at 160 the mode's maximal context cuts the candidate quotes the grade needs; the mode answers items by id and sees their kind, against and first 120 characters — costs the tail of a long item in the mode's view (the reviewer's file keeps it).
Task 2: fix round 1/5 (4 addressed, 1 not applied by ruling; commits 748eef6..c9b84e6)
Task 2: minor (deferred, for the final wave): mark the strategy reviewer's quote priority first: true (as the mode) so quotes outrank derived rows past the 17-byte margin
Task 2: complete (commits b216151..c9b84e6, review clean)
Task 3: dispatched (base c9b84e6, implementer opus)
Task 3: implementer DONE at 01199f2 (1637/1614/23; FACE_SMOKE smoke/bots/roles 6/6, market and strategy smokes 2/2); quote first: true applied to the strategy reviewer
Task 3: review Needs fixes — Important: a review context with artifacts but no evidence id (a sealed empty run, its market artifacts NOT_EVALUABLE) has an OK example the gate refuses and no accepted path. Ruling: when the counterevidence digest holds no evidence item after the cap, the channel's evidence sources enter missing (cn-market: index, limit-up, boards; strategy: quotes plus the market sources) so the example and the expected status are NOT_EVALUABLE and the mode WAITs — never a hollow OK; pin it with a contract test on a sealed empty run; minors ride along (ROLE.md: each item cites at least one ev_ evidence id; the long lunhui.ts comment line) — costs nothing.
Task 3: fix round 1 at 126ed22 (core evidenceRequired; 1639/1616/23). Ruling: evidenceRequired also on leader and mode (the same dead end on a strategy run whose context shows no evidence item) — one rule for every module that cites a market run — costs nothing.
Task 3: fix round 2 at 9cd6cef (evidenceRequired on leader and mode; 1639/1616/23; strategy smoke 1/1)
Task 3: fix rounds 1–2 re-review: all addressed, no new breakage
Task 3: minor (deferred): evidenceRequired names every listed source as missing when nothing shows, even one that was frozen (status right, missing text imprecise)
Task 3: complete (commits c9b84e6..9cd6cef, review clean)
Task 4: dispatched (base 9cd6cef, implementer opus)
Task 4: implementer DONE_WITH_CONCERNS, commit 5ddda58 (lunhui-run.md 2,990/3,000; roles.test.ts pin added; listing artifacts from run.json accepted); review dispatched
Task 4: review Needs fixes: Important 1 (STALE remedy pointed at an unsealed fresh freeze, refused MISSING_EVIDENCE); Minors 2-6
Task 4: fix baf8cc1 by the controller: remedy = a whole cn-market run per the market section, or a new strategy run when the strategy run itself is stale (Minor 2 folded in); pin in protocols.test.ts; mirror re-rendered; lunhui-run.md 2,999/3,000; suite 1642/1619/0/23, typecheck clean
Task 4: minors (deferred): 3 mode skipped when leader blocked is implicit; 4 listing artifacts from run.json accepted record (ruled not a defect); 5 listing duplicates the previousArtifact last-50 iterator; 6 more than 50 newer open runs empty the listing (by design)
Task 4: ruling: the out-of-brief roles.test.ts pin is fine
Task 4: complete (commits 5ddda58..baf8cc1, review fixes applied, pinned)
Task 5: dispatched (base baf8cc1, implementer opus)
Task 4: fix re-review (sonnet): all addressed, no new issues; minor (deferred): the STALE pin does not refuse the old 先冻结 wording
Task 5: implementer DONE_WITH_CONCERNS, commit d77bcd3 (one unreproduced not-ok-with-fail-0 under a combined run; Monday reuses Friday quote bytes; builders duplicated; per-day sign-in under the shifted clock); review dispatched
Task 5: review Approved (opus): no Critical or Important; the one cancelled run was a 300 s timeout from Mac sleep on battery (pmset log), 3/3 under caffeinate in about 3 s; Date and dispose restored in finally
Task 5: minors (deferred): 1 Monday's grade cites Friday's quote bytes, the next-day grade is not tested on new prices; 2 market builders and reviewArtifact duplicated across the two smokes; 3 the market smoke's validateEnvelope omits unknownHeadline
Task 5: complete (commit d77bcd3, review clean)
Task 6: dispatched (base d77bcd3, implementer opus)
Task 6: implementer DONE_WITH_CONCERNS, commit e927c97 (schema 95 tools 49,885 chars/4, lunhui_ 17 tools 3,188, role_ 3 tools 689, fresh setup home; out-of-list edits dsh/README.md and cn-market THESIS.md; older stale byte counts on the loops page); review dispatched
Task 6: review Needs fixes: Important 1 CLAUDE.md 22 real boots, 23 in the tree; Important 2 DEVELOPMENT 7.1 and 7.3 still 1613/1591/22 in 136 files; Minor 3 loops page roles range 544 excludes role.yml 526
Task 6: fix by the controller (counts 1642/1619/23 in 137 files, 23 real boots, range 526–1,687); DEVELOPMENT lines 28-29 are a dated plan 3 history note, kept
Task 6: minor (deferred): older byte counts on the loops page predate plan 4 (CLAUDE.md and GRAVIT.md sizes in its section 1 table, the section 8 summary)
Task 6: ruling: the THESIS.md line 14 edit is accepted as a factual correction of a builder-written status clause in Rules, not the Falsification or E4 text; dsh/README.md three roles accepted
Task 6: complete (commits e927c97 and the count fix, review addressed)
Final review: dispatched on fable over 3418043..HEAD
Final review (fable): Ready after fixes; no Critical; Important 1 the protocol had Gravit pick members and pools from lunhui_read_run, which returns headlines only; Important 2 the strategy reviewer step was not conditioned on the leader acceptance, and a review read before it is NOT_EVALUABLE for good; Minors 1-3
Final review: fix wave by the controller: step 2 names evidence-boards.json and evidence-limit-up.json under the market run, step 5 waits for the leader, the STALE sentence covers the reviewer, the closing message lists the artifact files without their fields; pins in protocols.test.ts incl. no 先冻结新的; README, DEVELOPMENT, loops page mirrored; lunhui-run.md 2,964 B, 1,642 chars; suite 1642/1619/0/23, typecheck clean, FACE_SMOKE market, strategy, roles 6/6
Final review: minors (deferred): 2 the mode's counterevidence view is not required and non-latching, fail-closed, unreachable at every pinned maximum; 3 cn-reviewer ROLE.md names mode but not counterevidence as never against
Final review: deferred Task 5 minor 1 scheduled for the owed real-service drill
Final review: re-review (fable) all addressed; new minors 1 the evidence path was repo-relative but a strategy channel cwd is strategies/<name>/, 2 the test header, 3 the loops page bullet - all three fixed by the controller (path ../cn-market/analysis/<run>/, lunhui-run.md 2,956 B, 1,634 chars); suite 1642/1619/0/23, typecheck clean, strategy and roles smokes 5/5
Plan 4: complete, review clean
