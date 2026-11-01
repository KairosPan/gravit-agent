# Lunhui Modules, Plan 3: the leader and mode modules, the stock analyst, the expectation card

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A strategy channel's run gets its two artifacts: a leader artifact ranking candidates
within a cited `cn-market` run's frozen boards and pools, and a mode artifact concluding `S01`,
`S02` or `WAIT` as a daily registration with a frozen expectation card that the next run grades —
written by the role `cn-stock-analyst`, ordered by the run protocol, and driven end to end on a real
boot.

**Architecture:** A module may now cite a second run: `defineModule` gains a `marketRun` contract
option (`"required"` for leader and mode, `"optional"` for plan 4's counterevidence) that adds a
`market_run` argument, resolves it through a new service method `readSealedRun`, applies the A5
freshness rule, and hands the market run's evidence and accepted artifacts to `buildContext`, whose
digest then binds the cited run (`market_run`, `market_snapshot_id`). The mode contract also reads
the strategy's previous accepted `mode.json` and its THESIS.md falsification section. Plan 4 adds the
counterevidence module and the reviewer; until then a mode artifact can only conclude `WAIT`,
because `S01`/`S02` require an accepted counterevidence artifact (A22).

**Tech Stack:** as plans 1–2 — Node 22, dsh `0.2.0-rc.2`, ES modules under `face/plugins/lunhui/`,
`node --test` through tsx, `FACE_SMOKE=1` real boots with `tests/stub-llm.ts`.

**Spec:** `docs/superpowers/specs/2026-10-25-lunhui-modules-design.md`, §10 item 3, with the build
notes of §12 (plan 1) and §13 (plan 2). Plans 1–2's ledgers
(`docs/superpowers/plans/2026-10-2{5,6}-lunhui-modules-plan-{1,2}-ledger.md`) record the rulings the
code follows.

## Global Constraints

- dsh stays `0.2.0-rc.2`; no dsh package edited; no new package.
- Tools added, plain names: `lunhui_read_leader_context`, `lunhui_submit_leader`, `lunhui_read_mode_context`, `lunhui_submit_mode` (§5.5). Rows added: `lunhui-leader`, `lunhui-mode`, composed after `lunhui-theme`.
- Leader and mode accept only a run of a strategy other than `cn-market` (`WRONG_CHANNEL`); their `market_run` must name a sealed `cn-market` run (`NO_SUCH_RUN`, or `MISSING_EVIDENCE` when it is not sealed).
- A5: the cited market run's `session` must equal the strategy run's `session` or be the trading day before it (calendar tables, `isTradingDay`); else `STALE_MARKET_RUN`. Applied to leader and mode both.
- New refusal codes: `STALE_MARKET_RUN`, `MISSING_EVIDENCE`. New validation categories (beside `MODULE_REPAIRS`' seven, with Chinese repairs): `INADMISSIBLE_STATE`, `UNADDRESSED_COUNTEREVIDENCE`.
- The mode set is `S01`, `S02`, `WAIT` (A18). A strategy maps to the one mode it may register: `lunhui-s01-repair` → `S01`, `lunhui-s02-rotation` → `S02`; any other strategy concludes `WAIT` only. `S02` is refused while its catalyst precondition is `unmet: no source` (E4), so today it concludes `WAIT`.
- Admitted sentiment states (strategy-spec §3–§4, spec §5.6): S01 `REPAIR`, `EXPANSION`; S02 `CHAOS`, `IGNITION`, `REPAIR`, `EXPANSION`; never `CLIMAX`, `RETREAT`, `UNKNOWN`. Read from the cited market run's accepted `sentiment.json`.
- R01–R14 family labels appear only under `research_only_matches`, each with a reason `data`, `ruling` or `registration` (A18); that path is exempt from the forbidden-word and scope checks; a label anywhere else that matches a scope class is refused as before.
- Everything else is plan 2's: envelope (A19), digest ≤ 30 KiB, artifact ≤ 24 KiB, ten calls a module, role-only submits, Chinese descriptions and texts, no manuscript text, no trade instruction, commits without backticks/`$`/parentheses, never push, real boots on a temp `DSH_HOME` at port 0.

## Review Focus

1. A mode artifact citing a market run of two sessions back must be `STALE_MARKET_RUN` at the read, and one citing the previous session over a weekend or holiday must pass — Task 1.
2. A leader candidate whose 6-digit code is in the market run's pools or members but whose `sh`/`sz` symbol is not in the strategy run's frozen quotes must be `[REFERENCE]`; and the reverse — Task 2.
3. An `S01` registration on a market run whose sentiment is `CLIMAX` must be `[INADMISSIBLE_STATE]`; on `EXPANSION` with no accepted counterevidence artifact, `[UNADDRESSED_COUNTEREVIDENCE]` — Task 3.
4. The second run of a strategy whose first run registered an expectation card must grade it (`expectation_review`) and cite the earlier card's run — Task 3.
5. A `research_only_matches` label such as 题材轮动 must be accepted there and refused as a claim sentence without evidence — Task 3.

---

### Task 1: The cited run in the context

**Files:** Modify `face/plugins/lunhui/runs-row.mjs`, `face/plugins/lunhui/lib/module-tool.mjs`, `face/plugins/lunhui/lib/contract-core.mjs`, `face/plugins/lunhui/lib/errors.mjs`, `face/plugins/lunhui/lib/calendar.mjs`. Test `face/tests/lunhui-module-tool.test.ts`, `face/tests/lunhui-contract-core.test.ts`, `face/tests/lunhui-calendar.test.ts`, `face/tests/lunhui-rows.test.ts`.

**Interfaces:**
- `calendar.mjs`: `previousTradingDay(date, tables)` → the latest covered trading day strictly before `date`, or `null` when it walks off coverage.
- Service: `readSealedRun(strategyName, run)` → `{ strategy, run, manifest, evidence: [{source, session, items}], artifacts: { [module]: parsed } }` — no lock taken; refuses `NO_SUCH_RUN` for a missing run, `MISSING_EVIDENCE` (new `refuse.missingEvidence`) for an unsealed one; `artifacts` holds only the modules `artifacts[]` names, each read bounded (24 KiB) and parsed; `readText`'s anchoring throughout.
- `refuse.staleMarketRun(strategySession, marketSession)`, `refuse.missingEvidence(what)` — Chinese, no path.
- `defineModule` contract option `marketRun: "required" | "optional"`: the read and submit gain a `market_run` string parameter (required or optional); the read resolves it with `readSealedRun("cn-market", market_run)` and checks A5 against the strategy run (both read after the strategy run seals, inside its `readContext`); the context receives `market: { run, snapshot_id, session, evidence, artifacts }`.
- `buildContext` accepts `market` and the contract's `marketSources` (the market-run sources the module reads): those evidence items join the digest's `items` (time scope CURRENT when their file's session equals the strategy run's session, else HISTORICAL), and `marketArtifacts` (the modules whose accepted artifacts the module reads) are shown as digests: `{ module, headline, claims: [{id, text, evidence_ids}] }` per artifact, and their ids `"<module>@<snapshot_id>"` are citable (`digest.artifactIds`).
- The envelope gains, only for a contract with `marketRun`, the bound fields `market_run` and `market_snapshot_id` (`ENVELOPE_BOUND` extended per contract), and `checkEnvelope` accepts a cited id that is in `artifactIds`.

- [ ] Steps: failing tests (previousTradingDay over a weekend and the October holiday; readSealedRun on a sealed run returns only named artifacts, refuses an open run `MISSING_EVIDENCE`; a toy contract with `marketRun: "required"` — `market_run` required, a market run two trading days back `STALE_MARKET_RUN`, the previous session accepted, market items citable and their scope computed against the strategy run's session, an artifact id citable, `market_run`/`market_snapshot_id` bound); run them failing; implement; run them and `npm test`, `npm run typecheck`; commit `feat: a Lunhui module may cite a sealed cn-market run, fresh by A5, its evidence and artifacts in the digest`.

---

### Task 2: The leader module

**Files:** Create `face/plugins/lunhui/lib/contracts/leader.mjs`, `face/plugins/lunhui/leader-row.mjs`. Test `face/tests/lunhui-contract-leader.test.ts`.

**Interfaces:**
- Channel `strategy`, `marketRun: "required"`, `sources: ["quotes"]` (the strategy run's), `marketSources: ["limit-up", "boards"]`, `marketArtifacts: ["theme", "sentiment"]`, `required: ["quotes"]`, market run artifacts `theme` required (absent → NOT_EVALUABLE with `missing_sources: ["market:theme"]`).
- Headline: `leader_candidates` 0–5 `{ symbol: /^(sh|sz)\d{6}$/, name ≤ 20, rank: 1..5 unique, board: /^BK\d{4}$/ | null, evidence_ids }` — `rank` is 顺位 within the cited market run's mainline candidates; `top_pattern_flags` 0–5 of `ACCELERATING DIVERGENCE BROKEN_STREAK HIGH_POSITION FIRST_BOARD NONE` (neutral descriptors of the frozen rows, not 打法 names).
- Rules (spec §5.6, A27): each candidate's `symbol` has a quote item in the strategy run; its 6-digit code is in a frozen limit-up pool row or a frozen `members` list of the cited market run (`[REFERENCE]` otherwise); its `evidence_ids` cite its quote and that pool row or members item; `board`, when given, is a board the market run's `theme.json` names among its `mainline_candidates` (`[REFERENCE]` otherwise); ranks are 1..n without gaps; `name` equals the quote's frozen name (exempt path, as theme's); a non-empty `top_pattern_flags` (other than `NONE`) stands on a claim of its own citing a limit-up pool row (`ownClaims`).
- `owns: ["leader"]`, `ownedBy.leader`: a quote item, a limit-up pool row or a members item; hints say a 龙头 is written only as 龙头候选 for a listed candidate.
- Hypotheses: chapter 四 (P0654–P1340) in the tree's own words — 地位 read from frozen streak, seal time and board membership; 龙头 is a revisable candidate label, never a conclusion.
- Row `lunhui-leader`.

- [ ] Steps: failing tests through real rows over fixtures (a market run frozen and its three artifacts accepted as plan 2's smoke does, then a strategy run's quotes): a valid two-candidate artifact accepted; a candidate whose code is in the pools but whose symbol was not frozen `[REFERENCE]`; the reverse `[REFERENCE]`; a board not among the theme's candidates `[REFERENCE]`; a cn-market run `WRONG_CHANNEL`; no theme artifact in the market run → NOT_EVALUABLE; a stale market run refused at the read. The fixture gap (no Tencent equity is in the Eastmoney fixtures) is closed by a test fixture copy whose members/pool rows include `600519` and `000333`, never by changing plan 1's fixtures. Run, implement, run, commit `feat: the Lunhui leader module - candidates ranked within the cited market run, each a frozen quote and a frozen member`.

---

### Task 3: The mode module

**Files:** Create `face/plugins/lunhui/lib/contracts/mode.mjs`, `face/plugins/lunhui/mode-row.mjs`; modify `face/plugins/lunhui/lib/contract-core.mjs` (the two categories). Test `face/tests/lunhui-mode.test.ts`.

**Interfaces:**
- Channel `strategy`, `marketRun: "required"`, `sources: ["quotes"]`, `marketSources: ["index", "limit-up", "boards"]`, `marketArtifacts: ["environment", "sentiment", "theme"]`, run artifacts read: `leader` (required — absent → NOT_EVALUABLE `missing_sources: ["leader"]`) and `counterevidence` (when accepted; plan 4), the strategy's previous accepted `mode.json` (the newest earlier sealed run of the same strategy whose `artifacts[]` names `mode`), and the Falsification section of the strategy's THESIS.md (read bounded, ≤ 4 KiB, through the strategy directory's anchoring).
- Headline (A12, E4): `mode` ∈ `S01 S02 WAIT`; `preconditions` 1–8 `{ id: /^p\d$/, name, status: met | unmet | unmet: no source, evidence_ids }` (evidence required when `met`); `research_only_matches` 0–14 `{ family: R01..R14, label: that family's registered name, reason: data | ruling | registration }`; `expectation`: null for `WAIT`, else the card `{ frozen_version, candidates[symbols], anchor, state, triggers[], vetoes[], window, price_band, holding_period, branches: { 符合, 强于, 弱于 } }` (strings ≤ 200, arrays ≤ 5); `expectation_review`: null when no previous card, else `{ previous_run, grade: 符合 | 强于 | 弱于 | NOT_EVALUABLE, evidence_ids }`; plus `parameters_used` 0–12 `{ name, value, note }` required non-empty for S01/S02.
- The strategy table: `MODE_FOR = { "lunhui-s01-repair": "S01", "lunhui-s02-rotation": "S02" }`; `REQUIRED_PRECONDITIONS = { S01: [theme_gate, candidate_before_divergence, theme_not_falsified, negative_tail_not_widening, minute_confirmation], S02: [old_theme_retreat, catalyst, candidates_pooled, minute_confirmation] }` (strategy-spec §3–§4 in the tree's words); `minute_confirmation` and S02's `catalyst` are always `unmet: no source` today.
- Rules (spec §5.6, A6, A12, A18, A22, E4): `mode` other than `WAIT` must equal `MODE_FOR[strategy]` (else `[INADMISSIBLE_STATE]`); S01/S02 need: the market sentiment `state` in the admitted set (`[INADMISSIBLE_STATE]`), every required precondition present, each non-`no source` one `met` with evidence (`[REFERENCE]`), `minute_confirmation` and (S02) `catalyst` stated `unmet: no source` — so S02 is refused `[INADMISSIBLE_STATE]` while its catalyst has no source; an accepted counterevidence artifact in the run, every item addressed (`addressed: [{ item, response ≤ 200, evidence_ids? }]` naming each item id; `[UNADDRESSED_COUNTEREVIDENCE]` otherwise); an `expectation` card; `parameters_used` non-empty. `WAIT` needs none of these and an `expectation` of null. When the context carries a previous card, `expectation_review` is required, its `previous_run` equal to that card's run, its grade other than `NOT_EVALUABLE` citing evidence of this run (`[REFERENCE]`).
- `exemptPaths`: `research_only_matches[*].label`, `preconditions[*].name`, `expectation.*` strings are not exempt (the card is research text and passes the rules).
- `owns: []` (mode opens nothing, A21); it cites artifacts (`<module>@<snapshot_id>`) and evidence.
- Hypotheses: chapters 三 (P0164–P0452), 七 (P1610–P1650), P0159 in the tree's own words — 模式选择 last and only from accepted readings; 预期 is a frozen card graded next session.
- Row `lunhui-mode`.

- [ ] Steps: failing tests (`face/tests/lunhui-mode.test.ts`, spec §6's row): `STALE_MARKET_RUN`; `WRONG_CHANNEL`; `S01` on `CLIMAX` `[INADMISSIBLE_STATE]`; `S01` on `EXPANSION` without counterevidence `[UNADDRESSED_COUNTEREVIDENCE]`; `S02` refused while catalyst has no source; `S01` in `lunhui-s02-rotation` `[INADMISSIBLE_STATE]`; `WAIT` with null card accepted; a research_only label (题材轮动) accepted under `research_only_matches` and refused as a bare claim sentence; a second run carrying the first run's card requires `expectation_review` naming that run; no leader artifact → NOT_EVALUABLE. An `S01` acceptance test uses a hand-written accepted counterevidence artifact in the run (written with the service's artifact writer in the test, since plan 4 builds the module). Run, implement, run, commit `feat: the Lunhui mode module - S01, S02 or WAIT as a daily registration with an expectation card graded next run`.

---

### Task 4: Composition, the role and the theses' daily frame

**Files:** Modify `face/src/lunhui.ts` (two ids, four tools), `face/tests/boot.test.ts`, `face/tests/bots.test.ts`, `face/tests/smoke.test.ts`, `face/tests/lunhui-rows.test.ts`; create `roles/cn-stock-analyst/{role.yml,ROLE.md}`; modify `face/tests/roles.test.ts`, `face/tests/roles-smoke.test.ts`, `bots/gravit/agent.cordis.yml` (regenerated); modify `strategies/lunhui-s01-repair/THESIS.md`, `strategies/lunhui-s02-rotation/THESIS.md` (Falsification re-fitted to the daily frame, E4) and their `status.yaml` `one_line`/`next`.

**Interfaces:**
- `role.yml`: `name: CN stock analyst`; one-line English description; `allow: [skill, lunhui_read_leader_context, lunhui_submit_leader, lunhui_read_mode_context, lunhui_submit_mode]`; `model: deepseek-official/deepseek-flash`.
- `ROLE.md` (Chinese, ≤ 2,000 bytes): 个股与预期分析员; the brief carries the strategy, the run and the market run ids, and which artifact to write (leader or mode — two calls); read once, submit through the module's own tool, the JSON only in `analysis`; a mode conclusion is a daily registration, `WAIT` is a result; a third rejection stops that module; a failed read stops the role; the four-heading report.
- THESIS re-fit: each Falsification section gains a "Daily registration (E4)" paragraph in the tree's own words: which preconditions the daily evidence can show and which stay `unmet: no source`, that the expectation card is graded in the next run, the parameters as research candidates. The operator reviews it (spec E4).
- Real boot (roles-smoke): the child's tools exactly its allow list; its leader submit lands; Gravit's root submit `NOT_A_ROLE`.

- [ ] Steps: failing tests, run, implement, `npm run render:roles`, `npm test && npm run typecheck`, `FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts tests/bots-smoke.test.ts tests/roles-smoke.test.ts`, commit `feat: the leader and mode rows compose, the cn-stock-analyst role writes them, and the theses register daily`.

---

### Task 5: The protocol's strategy channel and a strategy run on a real boot

**Files:** Modify `dsh/profile/lunhui-run.md`, `bots/gravit/agent.cordis.yml` (regenerated), `face/tests/protocols.test.ts`; create `face/tests/lunhui-strategy-run-smoke.test.ts`; modify `face/client/js/host/runs-view.js` and `face/tests/client/runs-view.test.js` (the mode chip shows `mode` alone, and the expectation review as one line `review: <grade> of <previous_run>`).

**Interfaces:**
- `lunhui-run.md` (≤ 3,000 bytes) adds the strategy channel for what exists after this plan: read the cited cn-market run with `lunhui_read_run`; choose 1–4 candidate equities from its theme candidates' members and pools; `lunhui_freeze_quotes` on the strategy; `role_cn_stock_analyst` for the leader with the run and the market run ids; then again for the mode; then `lunhui_read_run`; a `WAIT` is a result; the reviewer step lands with plan 4 (one sentence).
- The smoke: one boot (its own file), Date shifted as plan 2's smoke, fixture copy with the two equities in members/pools; Gravit's stub runs the market run first (freezes, `role_cn_market_analyst`), then one strategy run in `lunhui-s01-repair` (quotes, leader, mode). S01 needs an accepted counterevidence artifact (plan 4), so this run concludes `WAIT` with a null card; the card-grading path is pinned by Task 3's unit tests and by plan 4's smoke. Asserts: leader.json and mode.json accepted and re-validated against rebuilt digests, mode `WAIT`, `market_run` bound, the runs card shows the strategy run with its market run cited.

- [ ] Steps: write, run, `npm run render:roles`, `npm test`, `FACE_SMOKE=1` the new smoke and the protocol tests, commit `test: a lunhui-s01-repair run on a real boot, quotes to leader to mode, citing the day's market run`.

---

### Task 6: Documentation

**Files:** `DEVELOPMENT.md` (§3.6 the four tools, §3.8 the role, §4.3 the two rows and `market_run`, §5.2 the card's mode line, §7.3/§7.4 the new tests and drills, §9 residuals: cross-run reads unlocked by design, the strategy table in code, S02 WAIT-only; §10 plan 4), `face/README.md` "Lunhui analysis", `CLAUDE.md` (in place: roles/ row names two roles; face/ row ten rows), `ROADMAP.md`, the spec's "## 14. Build notes, plan 3" (append only), `strategies/cn-market/THESIS.md` nothing unless stale.

- [ ] Steps: measure `lunhui_` schema sizes on a home copy without `.credentials.yaml` and sessions (delete after; record owed if refused); write; `npm test && npm run typecheck`; `git status --porcelain docs/research/lunhui/corpus strategies/*/analysis` empty; commit `docs: the leader and mode modules, the stock analyst and the strategy channel through the documents`.
