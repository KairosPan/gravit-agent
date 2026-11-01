# Lunhui Modules, Plan 4: counterevidence, the reviewer, the docs pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the design: the reviewer's counterevidence artifact (A6, A22) written by the role
`cn-reviewer` in both channels, the mode's gates bound to it, the mode context safe at its maximal
inputs, the protocol carrying the whole order, an `S01` registration graded by the next session on a
real boot, and the docs pass the spec's §6 and §8 assign to this plan (charter, loops page, upgrade
guide, seams inventory, schema sizes).

**Architecture:** One more module row, `lunhui-review` (`lunhui_read_counterevidence_context`,
`lunhui_submit_counterevidence`), channel `any`, built on plan 3's cited-run plumbing: in
`cn-market` it reviews the run's three market artifacts and takes no `market_run`; in a strategy
channel it requires `market_run` and the run's accepted leader artifact, and binds both. Plan 3's
final review found the mode context's budget and the A22 gate open at their maximal inputs; Task 1
closes them before the module lands. `lunhui_read_run` learns to list a strategy's recent runs so
Gravit can find the day's market run from a strategy channel.

**Tech Stack:** as plans 1–3.

**Spec:** `docs/superpowers/specs/2026-10-25-lunhui-modules-design.md`, §10 item 4, §6's docs rows,
§8, with the build notes §12–§14. Plan 3's ledger
(`docs/superpowers/plans/2026-10-26-lunhui-modules-plan-3-ledger.md`) lists what this plan must do
first and must not break.

## Global Constraints

- dsh stays `0.2.0-rc.2`; no new package; no dsh package edited.
- Added: row `lunhui-review` (after `lunhui-mode`), tools `lunhui_read_counterevidence_context`, `lunhui_submit_counterevidence` — seventeen tools, eleven rows (spec §5.5, §5.12); role `cn-reviewer` (`skill` + the pair, `deepseek-official/deepseek-flash`, §5.9).
- The counterevidence artifact shape (plan 3's ruling): `items` 0–12 `{ id: /^x\d{1,2}$/, against, kind: CONTRADICTS | MISSING_EVIDENCE | STALE | RULING_CONFLICT | OVERREACH, text, evidence_ids 1–16 }`; `against` names a module whose accepted artifact the context shows (never `mode` in a strategy run, never `counterevidence`); an item with no evidence id is `[REFERENCE]` (§5.6).
- The counterevidence `text` cap is 160 characters (down from plan 3's 300, so twelve items fit the mode context); the mode's view of it shows ids whole.
- In `cn-market` the reviewer takes no `market_run` (a `market_run` given there is refused `WRONG_CHANNEL`); in any other strategy `market_run` is required, the run's accepted leader artifact is required (`NOT_EVALUABLE` with `missing_sources: ["leader"]` otherwise) and must cite the same market run (`MISSING_EVIDENCE` at the read otherwise).
- The mode's A22 gate additionally requires the counterevidence's `market_run` to equal the mode's (`[UNADDRESSED_COUNTEREVIDENCE]` otherwise).
- The expectation card: compact JSON ≤ 2,048 bytes (`[BYTE_LIMIT]`); a previous card shown in a context ≤ 2,048 bytes.
- `dsh/profile/lunhui-run.md` ≤ 3,000 bytes; `ROLE.md` ≤ 2,000; `GRAVIT.md` ≤ 4,500.
- Everything else is plans 1–3's: envelope, digests ≤ 30 KiB, artifacts ≤ 24 KiB, ten calls a module, role-only submits, Chinese texts in the tree's own words with paragraph ids, no manuscript text, no trade instruction, plain commits, never push, real boots on a temp home at port 0.

## Review Focus

1. A mode read with a maximal previous card and twelve maximal counterevidence items must still show the leader and the counterevidence, `status_expected: OK` — Task 1.
2. An `OK` counterevidence with no items, submitted in a strategy run before its leader exists, must not let an `S01` through — Tasks 1 and 2.
3. A counterevidence item `against: "mode"` in a strategy run, or naming a module whose artifact the context did not show, must be `[REFERENCE]` — Task 2.
4. A `cn-market` reviewer read given `market_run` (its own run or another) must be `WRONG_CHANNEL` — Task 2.
5. The second session's strategy run must grade the first session's S01 card on a real boot — Task 5.

---

### Task 1: The mode at its maximal inputs

**Files:** Modify `face/plugins/lunhui/lib/contracts/mode.mjs`, `face/plugins/lunhui/lib/contract-core.mjs`. Test `face/tests/lunhui-mode.test.ts`, `face/tests/lunhui-contract-core.test.ts`.

**Interfaces:**
- `contract-core.mjs` artifact views: the run's own artifacts (`runArtifacts`) are placed before the market artifacts in the context order, so the cap cuts market artifacts first; an artifact's headline field that is an array of objects with a `text` string (counterevidence `items`) is shown with each `text` cut to 120 characters (ids and every other field whole), the same rule as claims.
- `mode.mjs`: a card over 2,048 compact bytes is `[BYTE_LIMIT]`; the previous card shown in the context is the card as stored when ≤ 2,048 bytes, else its fields cut (strings to 120 characters) with `card_truncated: true`; the A22 gate also requires `counterevidence.market_run === digest.market_run`; when the counterevidence is not `OK`, the gate (`[UNADDRESSED_COUNTEREVIDENCE]`) speaks before any `addressed` entry is checked; `theme_gate`/`theme_not_falsified` accept a boards derived item only when its `params.board` is a mainline board; the expectation hint drops 目标价 (say 观察区间，相对锚点).
- A maximal pin: a previous card at 2,048 bytes and a counterevidence of twelve 160-character items with sixteen ids each → context ≤ 30 KiB, leader and counterevidence shown, `status_expected: OK`, an S01 accepted.

- [ ] Steps: failing tests for each rule and the pin; implement; run `npx tsx --test tests/lunhui-mode.test.ts tests/lunhui-contract-core.test.ts`, `npm test`, `npm run typecheck`; commit `fix: the mode stands at its maximal inputs - the card capped, the run's own artifacts first, the counterevidence bound to the market run`.

---

### Task 2: The counterevidence module

**Files:** Create `face/plugins/lunhui/lib/contracts/counterevidence.mjs`, `face/plugins/lunhui/review-row.mjs`. Test `face/tests/lunhui-contract-counterevidence.test.ts`.

**Interfaces:**
- Channel `any`; `marketRun: "optional"` with the channel rules of the Global Constraints (cn-market: none; other strategies: required). In `cn-market`: `sources` index, limit-up, boards; `runArtifacts` environment, sentiment, theme; `required` none of the artifacts individually, but a run with no accepted market artifact gives `NOT_EVALUABLE` (`missing_sources` naming the three). In a strategy run: `sources` quotes; `marketSources` index, limit-up, boards; `marketArtifacts` environment, sentiment, theme; `runArtifacts` leader; `required` leader.
- Headline `items` (the shape above, text ≤ 160). Rules: each item's `against` is a module whose artifact the context shows and not `mode`/`counterevidence`; each item cites ≥ 1 id, at least one of which is evidence (not only artifact ids) — an item resting only on the artifact it is against is `[REFERENCE]`; ids unique per item; `x` ids unique.
- `owns`: every scope class, `ownedBy` any cited evidence item (the reviewer may deny any reading, §5.6 "counterevidence may deny any of them") — but the scope rule still requires each owned-class sentence to cite evidence.
- Hints carry the ten rulings by topic (strategy-spec §7) in the tree's own words, the five kinds, the 160-character text, that an empty `items` means nothing was found and is a result, and that the reviewer runs before the mode.
- Hypotheses: the ten rulings (strategy-spec §7) and §5, paragraph ids only where the manuscript is cited.
- Row `lunhui-review` (`name`), tools `lunhui_read_counterevidence_context` / `lunhui_submit_counterevidence`.

- [ ] Steps: failing tests — cn-market review accepted against an artifact; `market_run` in cn-market `WRONG_CHANNEL`; a strategy run without `market_run` refused at the read; a strategy run with no leader → NOT_EVALUABLE; a leader on another market run → MISSING_EVIDENCE; `against: "mode"` `[REFERENCE]`; an item with no evidence id `[REFERENCE]`; an item citing only an artifact id `[REFERENCE]`; empty items accepted; the mode then accepts S01 addressing every item. Implement; run; commit `feat: the Lunhui counterevidence module - the reviewer's items against the shown artifacts, in both channels`.

---

### Task 3: Composition and the role `cn-reviewer`

**Files:** `face/src/lunhui.ts`, `face/src/setup.ts`, `face/tests/{boot,bots,smoke,lunhui-rows,roles,roles-smoke,bot-presets,bots-smoke}.test.ts` as plan 3's Task 4 changed them; create `roles/cn-reviewer/{role.yml,ROLE.md}`; `bots/gravit/agent.cordis.yml` regenerated.

**Interfaces:**
- `role.yml`: `name: CN reviewer`; one-line English description; `allow: [skill, lunhui_read_counterevidence_context, lunhui_submit_counterevidence]`; `model: deepseek-official/deepseek-flash`.
- `ROLE.md` (Chinese, ≤ 2,000 bytes): 反证审查员; the brief names the strategy, the run and (outside cn-market) the market run; read once, submit once, JSON only in `analysis`; each item names the module it is against and cites evidence; an empty list is a result; the reviewer shares no tool with the analysts; the blocked exit; the four headings.
- Real boot: the reviewer child's tools exactly its allow list; its submit lands; Gravit's root submit `NOT_A_ROLE`; the three roles share only `skill`.

- [ ] Steps: failing tests, implement, `npm run render:roles`, `npm test && npm run typecheck`, `FACE_SMOKE=1` smoke, bots-smoke, roles-smoke; commit `feat: the lunhui-review row composes and the cn-reviewer role writes the counterevidence`.

---

### Task 4: The protocol's whole order, and finding a market run

**Files:** `face/plugins/lunhui/runs-row.mjs` (`lunhui_read_run` with `run` optional), `face/tests/lunhui-rows.test.ts`; `dsh/profile/lunhui-run.md`, `bots/gravit/agent.cordis.yml` (regenerated), `face/tests/protocols.test.ts`; `roles/cn-stock-analyst/ROLE.md` (the leader lands before the mode).

**Interfaces:**
- `lunhui_read_run({ strategy, run? })`: with `run` omitted it lists the strategy's newest sealed runs (≤ 5: `run`, `session`, `snapshot_id`, `artifacts`), read lockless and bounded; with `run` it behaves as today. The description says so in Chinese.
- `lunhui-run.md` (≤ 3,000 bytes, Chinese, the tree's own words): cn-market — freezes, `role_cn_market_analyst`, then `role_cn_reviewer`, then `lunhui_read_run`; strategy channel — `lunhui_read_run` on `cn-market` without `run` to find the day's (or the previous trading day's) sealed market run, choose candidates, freeze quotes, `role_cn_stock_analyst` (leader), `role_cn_reviewer` (with the market run), `role_cn_stock_analyst` (mode), `lunhui_read_run`; a WAIT, a NOT_EVALUABLE and a refused mode are results; STALE_MARKET_RUN → freeze a fresh cn-market run, then re-read with it (a sealed strategy run may be re-read until its leader is accepted); journal NOT_EVALUABLE runs; never freeze after a role has read; never edit `analysis/`; never submit yourself.

- [ ] Steps: failing tests (the listing; the protocol's order and key words; every tool and role named is registered/shipped), implement, render, run, commit `feat: the run protocol carries the reviewer in both channels, and lunhui_read_run lists a strategy's recent runs`.

---

### Task 5: The whole loop on a real boot

**Files:** Modify `face/tests/lunhui-market-run-smoke.test.ts` (the reviewer step), `face/tests/lunhui-strategy-run-smoke.test.ts` (two sessions).

**Interfaces:**
- Market smoke: after the analyst, `role_cn_reviewer` lands `counterevidence.json` (items or none) on the market run; re-validated.
- Strategy smoke, two shifted sessions (Friday, Monday): Friday — market run with review; `lunhui-s01-repair`: `lunhui_read_run` listing finds the market run, quotes, leader, reviewer, mode `S01` with a card (preconditions met by class, minute_confirmation `unmet: no source`, every counterevidence item addressed, `parameters_used`); Monday — a new market run and strategy run whose mode grades Friday's card (`expectation_review.previous_run` = Friday's run). Asserts each artifact accepted and re-validated against rebuilt digests, the runs card's latest run showing the review line.

- [ ] Steps: write, run with `FACE_SMOKE=1`, `npm test`; commit `test: an S01 registered on Friday and graded on Monday, the reviewer in both channels, on a real boot`.

---

### Task 6: The docs pass

**Files:** `DEVELOPMENT.md` (§3.6 seventeen tools, §3.8 three roles, §4.3 eleven rows and the review row, the corrected live-size numbers, §5.2, §7, §9 residuals per spec §8, §10), `face/README.md`, `CLAUDE.md` (in place), `ROADMAP.md`, `Gravit-Design.md` (spec §8: §1 MARKET bullet, §4 `strategies/` writer clause, D10, §7.2's "none ships" sentence), `Gravit-Docs-and-Prompt-Loops.html` (the `lunhui:run` section at order 10140 in the section table and loop 1's assembly step, the three roles, the Lunhui rows in the composition order), `docs/dsh-upgrade-guide.md` (re-check rows for the Lunhui rows, `defineTool`, `ctx.provide`/`inject`, the `exec.agent.session.header` caller gate, the spill cap — dated), `docs/research/2026-10-15-dsh-seams-inventory.md` (dated additions for the seams the Lunhui rows use), the spec's "## 15. Build notes, plan 4" (append only).

- [ ] Steps: measure schema sizes on a home copy without `.credentials.yaml` and sessions (deleted after; owed if refused); write; `npm test && npm run typecheck`; corpus/analysis porcelain empty; commit `docs: counterevidence, the reviewer and the Lunhui rows through the charter, the loops page, the upgrade guide and the seams inventory`.
