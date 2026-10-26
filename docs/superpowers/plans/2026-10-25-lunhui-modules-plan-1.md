# Lunhui Modules, Plan 1: the backbone, the freezes, the market channel, the runs card

> **Self-reviewed 2026-10-25** by the executing session against the spec and stage 0's code at
> `0de97cf` (spec coverage, step scan, type consistency, Review Focus, proportion). The fixes:
> the calendar table keeps stage 0's named holidays and their two sources (Task 2); a missing or
> corrupt `metrics.json` resets the counts as A7 says, not `NO_SUCH_RUN` (Task 3); stage 0's
> provider-to-`UPSTREAM_*` mapping, which lived in the retired `server.mjs`, moves into
> `errors.mjs` (Task 4); `@deepseek-ai/dsh-tools` is declared at the pin the tree already
> installs (Task 4); stage 0's `fetchBytes` is generalized instead of reused as is, since it
> refuses redirects and sends Tencent's headers (Task 5); A17's four-in-flight limit gets an
> owner (Task 5); the redirect case uses a fake fetch, not a fixture directory (Task 5); the
> limit-up pools are read for the expected quote date (Task 8); the graft spec and ledger land as
> history and the ignore rule gets its `git check-ignore` test (Task 1); the runs card reads a
> `status` beside the headline and pins its table to `MODULES` (Tasks 11–12); the 2027 calendar
> table is recorded as a forward item (Task 13).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the data half of the Lunhui modules design on current `main`: stage 0's library,
one backbone row providing the `lunhuiRuns` service and `lunhui_read_run`, four freeze rows that
freeze Tencent and Eastmoney evidence into sealable runs with host-derived measures, the committed
market channel `strategies/cn-market/`, and the channel page's runs card for the new run shape.

**Architecture:** Every piece is a cordis file plugin under `face/plugins/lunhui/`, composed by
`face/src/lunhui.ts` after the Account seat's row in `composeFace`. The backbone row provides the
service the freeze rows inject; the freeze rows register one in-process tool each with
`defineTool`, fetch from the face process (fixtures by row config in tests), and write evidence
files plus derived items into `strategies/<name>/analysis/<run>/`. A run seals on its first
context read (plan 2); this plan builds the open run, the seal function and `lunhui_read_run`.
The channel page reads runs through stage 0's bounded reader. Plans 2–4 add the module rows, the
roles, the protocol section and the artifacts.

**Tech Stack:** Node 22, dsh `0.2.0-rc.2` (`@deepseek-ai/dsh-tools` `defineTool`, `@deepseek-ai/cordis`
`ctx.provide`/`inject`), TypeScript for `face/src`, ES modules for `face/plugins/lunhui/`,
`node --test` through tsx.

**Spec:** `docs/superpowers/specs/2026-10-25-lunhui-modules-design.md` (approved 2026-10-25). This
plan is its §10 item 1. Stage 0, reused by copy, is the worktree
`/Users/pan/Desktop/self-evolve/evolving-alpha-us/.claude/worktrees/lunhui-graft` at `0de97cf`
(read-only for this plan; copy with `cp`, never edit there).

## Global Constraints

- dsh stays `0.2.0-rc.2`; no dsh package is edited, forked or re-pinned (spec §3).
- No new package installed: `defineTool` comes from `@deepseek-ai/dsh-tools`, today only a transitive dependency of `dsh-tool-subagent` at `0.2.0-rc.2`; Task 4 declares it in `face/package.json` at that exact pin so the plugin files do not lean on hoisting, and `npm ls @deepseek-ai/dsh-tools` shows one copy.
- Tool names are plain, `lunhui_…`, no dots (a dotted name is hashed); this plan's five: `lunhui_read_run`, `lunhui_freeze_quotes`, `lunhui_freeze_limit_up`, `lunhui_freeze_boards`, `lunhui_freeze_index` (spec §5.5).
- Tool descriptions and refusal texts are Chinese; code, tests and docs are English (D14′).
- Every refusal is a thrown `LunhuiError` whose message opens with its code word; no refusal names a path (spec §5.7).
- Every path the rows touch resolves under `config.strategiesRoot` through stage 0's `runs.mjs` anchoring (D4′).
- Egress from the face process is exactly: `qt.gtimg.cn`, `web.ifzq.gtimg.cn`, `push2ex.eastmoney.com`, `push2.eastmoney.com` and its one redirect target `push2delay.eastmoney.com`; 7-second timeout, 512 KiB per response, at most four requests in flight (A17, A28).
- An evidence file is ≤ 256 KiB and a run's evidence ≤ 2 MiB (spec §5.3); evidence files are gitignored, `run.json`, `metrics.json` and artifacts tracked (A26).
- Eight freeze calls per run; past that `TOOL_BUDGET` (A7).
- A freeze refuses a delegated child caller with `NOT_GRAVIT`: `exec.agent?.session?.header?.origin === "subagent"` and not `isSeeded` (A23; the mirror of `gravit.js`'s `isRootOrFork`, and `exec.agent` is how `src/agents.ts` and `src/room.ts` already read the caller).
- `GRAVIT.md` ≤ 4,500 bytes (`face/tests/gravit-md.test.ts`); `cycle.md` untouched.
- Never touch `dsh/profile/`, `bots/` (save the generated mirror, untouched by this plan), `roles/` (plan 2), or the live `~/.dsh`.
- Commit after every task with `git commit -m` and a message free of backticks, `$` and parentheses; one commit per task, never push. This worktree's Bash sandbox refuses command text that names git in a non-plain form: run git as plain one-line commands from the worktree root, and edit files through the file tools.
- Tests never reach the network and never call a model; the only real boots are the `FACE_SMOKE=1` smokes.
- Test commands: `cd face && npx tsx --test tests/<file>.test.ts` for one file, `npm test` for all, `FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts` for a real boot (slow; no keys needed).

## Review Focus

1. A pool reply whose `data` is `null` (a holiday, a pre-market call) must refuse `NO_MARKET_DATA` and write nothing for that source — Task 5.
2. Two freezes of one run arriving together must serialize through the run mutex and both land; a second freeze of the same source must refuse `SOURCE_FROZEN` — Task 3 and Task 8.
3. A `run` argument naming another strategy's run must refuse `NO_SUCH_RUN`, never read it — Task 3.
4. The all-shares count pages disagreeing on `total` mid-read must mark the counts `partial: true`, carried into the derived item — Task 6 and Task 7.
5. A board member list longer than 100 must be cut to 100 with `truncated: true`, and the derived breadth must come from the board's own advancer and decliner counts, never from the cut list — Task 6 and Task 7.

---

### Task 1: Stage 0 lands as a library

**Files:**
- Create (copied from the graft worktree, imports re-pointed): `face/plugins/lunhui/lib/market.mjs`, `face/plugins/lunhui/lib/contract.mjs`, `face/plugins/lunhui/lib/runs.mjs`, `face/plugins/lunhui/lib/fixture-fetch.mjs`
- Create (copied as they are): `face/tests/fixtures/lunhui/` (every file), `face/tests/fixtures/lunhui-empty/README.md`, `face/tests/lunhui-market.test.ts`, `face/tests/lunhui-runs.test.ts`, `face/tests/lunhui-contract.test.ts`, `docs/research/lunhui/README.md`, `docs/research/lunhui/manifest.json`, `docs/research/lunhui/design/` (every file), `strategies/lunhui-s01-repair/` and `strategies/lunhui-s02-rotation/` (every tracked file), and as history (spec §5.13) `docs/superpowers/specs/2026-10-19-lunhui-plugin-graft-design.md` and `docs/superpowers/plans/2026-10-19-lunhui-plugin-graft-ledger.md`
- Modify: `.gitignore` (two lines), `face/tests/fixtures/lunhui/fetch.ts` (one import), `face/plugins/lunhui/lib/fixture-fetch.mjs` (its header comment: the fixture directory is a row's `config.fetch` now, A15; the `LUNHUI_FETCH_FIXTURES` sentence goes)
- Test: `face/tests/lunhui-ignore.test.ts`

**Interfaces:**
- Produces: `lib/runs.mjs` exports `LunhuiError`, `STRATEGY_NAME_RE`, `RUN_ID_RE`, `resolveStrategy(root, name)`, `newRunId(now)`, `resolveRun(strategyDir, run)`, `createRun(strategyDir, run)`, `writeNew(dir, name, text)`, `readText(dir, name)`, `writeAnalysis(dir, analysis)`, `writeMetrics(dir, metrics)` — unchanged from stage 0. `lib/market.mjs` exports `freezeSample`, `fetchQuotes`, `fetchDailyBars`, `getMarketSession`, `validateSymbols`, the parsers and assessments — unchanged. `lib/contract.mjs` exports `buildAnalysisContext`, `validateAnalysis`, the hints, `MAX_CONTEXT_BYTES`, `MAX_ANALYSIS_BYTES` and the module-private `hash(value)` (made exported in Task 3). `lib/fixture-fetch.mjs` exports `createFixtureFetch(dir)`.

- [ ] **Step 1: Copy the files**

Run, from the worktree root, one `cp -R` per source (the graft worktree is read-only to you; `cp` reads it):
`<graft>/face/plugins/lunhui/{market,contract,runs,fixture-fetch}.mjs` → `face/plugins/lunhui/lib/`;
`<graft>/face/tests/fixtures/lunhui` and `lunhui-empty` → `face/tests/fixtures/`;
the three test files → `face/tests/`; `<graft>/docs/research/lunhui/{README.md,manifest.json,design}` → `docs/research/lunhui/`;
`<graft>/strategies/lunhui-s01-repair` and `lunhui-s02-rotation` → `strategies/` (the `analysis/` directories, if any, are not copied).
Then re-point imports: in `lib/contract.mjs` (`./market.mjs` stays), in `tests/fixtures/lunhui/fetch.ts` (`../../plugins/lunhui/lib/fixture-fetch.mjs`), in the three tests (`../plugins/lunhui/lib/<file>.mjs`).

- [ ] **Step 2: Add the ignore lines**

With the file tool, append to `.gitignore` under a new comment `# the Lunhui corpus and the runs' evidence files stay out of the public repository (spec 2026-10-25 A26, D11)`:
```
/docs/research/lunhui/corpus/
strategies/*/analysis/*/evidence-*.json
```

Then the ignore test (spec §6), `face/tests/lunhui-ignore.test.ts`, running `git check-ignore -q` from the repository root through `execFileSync` (exit 0 ignored, 1 not):

```ts
test("ignore: a run's evidence files are ignored; run.json, metrics.json and an artifact are not; the corpus is", () => {
  assert.equal(ignored("strategies/cn-market/analysis/20261023T070000Z-0123abcd/evidence-limit-up.json"), true);
  for (const f of ["run.json", "metrics.json", "sentiment.json"]) assert.equal(ignored(`strategies/cn-market/analysis/20261023T070000Z-0123abcd/${f}`), false);
  assert.equal(ignored("docs/research/lunhui/corpus/x.md"), true);
});
```

- [ ] **Step 3: Run the moved tests**

Run: `cd face && npx tsx --test tests/lunhui-market.test.ts tests/lunhui-runs.test.ts tests/lunhui-contract.test.ts tests/lunhui-ignore.test.ts`
Expected: every test passes (stage 0's three files had 36, 12 and 17, give or take a nested case; the ignore test 1).

- [ ] **Step 4: Run the whole suite and the type check**

Run: `cd face && npm test && npm run typecheck`
Expected: pass; the count grows by the three files' tests.

- [ ] **Step 5: Commit**

```bash
git add .gitignore face/plugins/lunhui/lib face/tests/fixtures/lunhui face/tests/fixtures/lunhui-empty face/tests/lunhui-market.test.ts face/tests/lunhui-runs.test.ts face/tests/lunhui-contract.test.ts face/tests/lunhui-ignore.test.ts docs/research/lunhui strategies/lunhui-s01-repair strategies/lunhui-s02-rotation docs/superpowers/specs/2026-10-19-lunhui-plugin-graft-design.md docs/superpowers/plans/2026-10-19-lunhui-plugin-graft-ledger.md
git commit -m "feat: the Lunhui stage 0 library, fixtures, research input and the two theses land on main"
```

---

### Task 2: Calendar tables by year

**Files:**
- Create: `face/plugins/lunhui/lib/calendar/2026.json`, `face/plugins/lunhui/lib/calendar.mjs`
- Modify: `face/plugins/lunhui/lib/market.mjs` (the calendar constants read the table; `getMarketSession` unchanged in behaviour)
- Test: `face/tests/lunhui-calendar.test.ts`

**Interfaces:**
- Produces: `calendar.mjs` exports `loadCalendars(dir = <lib/calendar>)` → `Map<string, CalendarTable>` keyed by year; `coverageOf(date: "YYYY-MM-DD", tables)` → `"covered" | "uncovered"`; `isTradingDay(date, tables)` → boolean, defined only for a covered date (not a weekend, not inside a holiday); `holidayOn(date, tables)` → the holiday or `undefined`; `CalendarTable = { year, source, holidays: [{ start, end, name, source }] }` — stage 0's holiday ranges as they are, each with its own notice URL (2026 has two: the annual notice and the autumn one), `source` the annual one. `market.mjs` keeps exporting `getMarketSession(now)` with the same labels and per-holiday `source`, now reading the tables through `loadCalendars()` at module load; its `calendarCoverage` field names the covered years joined by `,` (`"2026"` today), and the uncovered reason names them instead of the literal 2026.

- [ ] **Step 1: Write the failing test**

```ts
test("calendar: the 2026 table loads, a 2026 holiday is closed, a 2027 date is uncovered", async () => {
  const tables = loadCalendars();
  assert.deepEqual([...tables.keys()], ["2026"]);
  assert.equal(coverageOf("2026-10-01", tables), "covered");
  assert.equal(isTradingDay("2026-10-01", tables), false); // National Day
  assert.equal(isTradingDay("2026-10-12", tables), true);
  assert.equal(coverageOf("2027-01-04", tables), "uncovered");
});
test("calendar: a second table in the directory covers its year", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lunhui-cal-"));
  await copyFile(<lib/calendar/2026.json>, join(dir, "2026.json"));
  await writeFile(join(dir, "2099.json"), JSON.stringify({ year: "2099", source: "synthetic", holidays: [{ start: "2099-01-01", end: "2099-01-01", name: "元旦", source: "synthetic" }] }));
  const tables = loadCalendars(dir);
  assert.equal(coverageOf("2099-06-01", tables), "covered");
  assert.equal(isTradingDay("2099-01-01", tables), false);
});
test("calendar: a malformed table is refused with its file named", async () => { /* a table whose year is not four digits or differs from its file name, or a holiday whose start or end is not a date of that year or ends before it starts, throws an Error naming the file */ });
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd face && npx tsx --test tests/lunhui-calendar.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Extract the table and write the loader**

Move what `market.mjs` hard-codes (`CALENDAR_YEAR`, `FIRST_DATE`, `LAST_DATE`, `ANNUAL_SOURCE`, `AUTUMN_SOURCE` and the `holidays` array) into `lib/calendar/2026.json` as `{ year, source, holidays }`; write `calendar.mjs` (read with `readFileSync` from `new URL("./calendar/", import.meta.url)`); make `market.mjs`'s `isCovered`, `holidayOn` and `isTradingDate` read the loaded tables, keeping every existing `getMarketSession` test green.

- [ ] **Step 4: Run the calendar and market tests**

Run: `cd face && npx tsx --test tests/lunhui-calendar.test.ts tests/lunhui-market.test.ts`
Expected: PASS, no change to the market tests' count.

- [ ] **Step 5: Commit**

```bash
git add face/plugins/lunhui/lib/calendar face/plugins/lunhui/lib/calendar.mjs face/plugins/lunhui/lib/market.mjs face/tests/lunhui-calendar.test.ts
git commit -m "feat: the Lunhui calendar is a table per year, 2026 shipped, an uncovered date reported"
```

---

### Task 3: The run contract: open, add evidence, seal

**Files:**
- Modify: `face/plugins/lunhui/lib/runs.mjs`, `face/plugins/lunhui/lib/contract.mjs` (export `hash`)
- Test: `face/tests/lunhui-runs.test.ts` (extended)

**Interfaces:**
- Consumes: Task 1's `runs.mjs` and `contract.mjs`.
- Produces, in `runs.mjs`:
  - `openRun(strategyDir, kind, now = new Date())` → `Promise<{ run, dir }>`: `createRun` plus `run.json` `{ run, strategy, kind, as_of: null, opened_at, sealed_at: null, snapshot_id: null, evidence: [], artifacts: [] }` and `metrics.json` `{ freezes: 0, calls: {}, rejections: {}, submitted: [] }`; `kind` is `"market"` or `"strategy"`.
  - `addEvidence(dir, source, items, meta)` → `Promise<{ file, sha256, bytes, ids }>`: writes `evidence-<source>.json` (`writeNew`, so a second file for the same source throws `SOURCE_FROZEN`) holding `{ source, received_at, host, delayed, truncated, items }`, each item given `id = "ev_" + hash(item).slice(0, 24)` before writing; refuses `RUN_SEALED` when `run.json` has `sealed_at`; refuses `EVIDENCE_TOO_LARGE` over 256 KiB and `RUN_TOO_LARGE` when the run's evidence would pass 2 MiB; appends `{ source, file, sha256, bytes, received_at, host, delayed }` to `run.json`'s `evidence` through `replaceFile`. `source` matches `^[a-z][a-z-]{0,30}$`.
  - `sealRun(dir, now = new Date())` → `Promise<RunManifest>`: sets `sealed_at`, `as_of` (the latest `received_at`), `snapshot_id = "snap_" + sha256(sorted evidence sha256s joined by "\n")`; idempotent on a sealed run.
  - `readRun(dir)` → `Promise<{ manifest: RunManifest, metrics, metricsReset: boolean }>`, both through `readText`; a missing or unparseable `run.json` is `NO_SUCH_RUN`, but a missing or corrupt `metrics.json` yields zeroed metrics with `metricsReset: true` (A7's fail-open, pinned) and the next write mirrors them back.
  - `evidenceId(item)` → the id above (exported for the freeze rows' tests).
- `contract.mjs` exports its existing `hash(value)`.

- [ ] **Step 1: Write the failing tests**

```ts
test("runs: openRun writes run.json and metrics.json; addEvidence ids items and lists the file; sealRun fixes snapshot_id", async () => {
  const { run, dir } = await openRun(strategyDir, "market", new Date("2026-10-23T07:00:00Z"));
  assert.match(run, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
  const a = await addEvidence(dir, "limit-up", [{ code: "002982" }, { code: "600519" }], { received_at: "2026-10-23T07:00:01Z", host: "push2ex.eastmoney.com", delayed: false, truncated: false });
  assert.equal(a.ids.length, 2);
  assert.equal(a.ids[0], evidenceId({ code: "002982" }));
  const sealed = await sealRun(dir, new Date("2026-10-23T07:00:05Z"));
  assert.match(sealed.snapshot_id, /^snap_[0-9a-f]{64}$/);
  assert.equal(sealed.as_of, "2026-10-23T07:00:01Z");
  await rejectsWith(addEvidence(dir, "boards", [{ code: "BK0715" }], meta), "RUN_SEALED");
  assert.deepEqual(await sealRun(dir), sealed); // idempotent
});
test("runs: snapshot_id depends on the evidence bytes, not on the order the sources were added", ...);
test("runs: a second file for one source is SOURCE_FROZEN; a new source on the same run lands; a source name off the grammar throws a plain Error (host code's bug, never a LunhuiError)", ...);
test("runs: an evidence file over 256 KiB is EVIDENCE_TOO_LARGE; a run passing 2 MiB is RUN_TOO_LARGE; nothing is written in either case", ...);
test("runs: a run id of another strategy resolves to NO_SUCH_RUN under this one", async () => {
  // open a run under strategy A, resolveRun(strategyDirB, runA) rejects NO_SUCH_RUN
});
test("runs: readRun reads back both files; a missing or corrupt metrics.json reads as zeroed counts with metricsReset true; a missing run.json is NO_SUCH_RUN", ...);
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd face && npx tsx --test tests/lunhui-runs.test.ts`
Expected: the new tests FAIL (`openRun is not a function`); stage 0's pass.

- [ ] **Step 3: Implement**

Add the functions to `runs.mjs` with the signatures above, reusing `createRun`, `writeNew`, `readText`, `replaceFile` (make it the module's own helper for `run.json` as `writeAnalysis` uses it), `stillResolved`; add the four new `LunhuiError` codes (`RUN_SEALED`, `SOURCE_FROZEN`, `EVIDENCE_TOO_LARGE`, `RUN_TOO_LARGE`) with Chinese reasons naming no path. `SOURCE_FROZEN` is this plan's addition to spec §5.7's list (one snapshot per source per run, A27's rule); record it in the ledger. Export `hash` from `contract.mjs`.

- [ ] **Step 4: Run the tests**

Run: `cd face && npx tsx --test tests/lunhui-runs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add face/plugins/lunhui/lib/runs.mjs face/plugins/lunhui/lib/contract.mjs face/tests/lunhui-runs.test.ts
git commit -m "feat: a Lunhui run opens, takes evidence files with ids, and seals to a snapshot id"
```

---

### Task 4: The backbone row and `lunhui_read_run`

**Files:**
- Create: `face/plugins/lunhui/runs-row.mjs`, `face/plugins/lunhui/lib/modules.mjs`, `face/plugins/lunhui/lib/errors.mjs` (the caller gate and the refusal helpers shared by rows)
- Modify: `face/package.json` and `face/package-lock.json` (`"@deepseek-ai/dsh-tools": "0.2.0-rc.2"` in `dependencies`, then `npm install` — no new package lands; `npm ls @deepseek-ai/dsh-tools` shows the one deduped copy)
- Test: `face/tests/lunhui-rows.test.ts`

**Interfaces:**
- Consumes: Task 3's `runs.mjs`.
- Produces:
  - `runs-row.mjs` exports `name = "lunhui-runs"`, `inject = ["tools"]`, `apply(ctx, config)`. `config = { strategiesRoot: string }`; `apply` throws `Error("lunhui-runs: strategiesRoot must be an absolute path to an existing directory")` otherwise. It calls `ctx.provide("lunhuiRuns", service)` and registers `lunhui_read_run` through `ctx.tools.register(defineTool({...}))`, both inside `ctx.effect` so a reload disposes them (as `gravit.js` does).
  - The service (`/** @typedef LunhuiRuns */`): `strategiesRoot`; `resolveStrategy(name)`; `openRun(strategyName, kind)`; `addEvidence(strategyName, run, source, items, meta)`; `sealRun(strategyName, run)`; `readRun(strategyName, run)`; `withRun(strategyName, run, fn)` — one in-process mutex per `<strategy>/<run>` key, `fn` runs alone; `countFreeze(strategyName, run)` — increments `metrics.freezes`, throws `TOOL_BUDGET` past 8, persists; every method anchors through `runs.mjs`.
  - `modules.mjs` exports `MODULES`: the six module names in order (`environment`, `sentiment`, `theme`, `leader`, `mode`, `counterevidence`), each with `file` (`<name>.json`) and `headline` (the field names of spec §5.4: environment `index_state, liquidity_state, cycle_anchor`; sentiment `state, money_effect, freeze_type`; theme `mainline_candidates, theme_stage, rotation`; leader `leader_candidates, top_pattern_flags`; mode `mode, preconditions, research_only_matches, expectation, expectation_review`; counterevidence `items`).
  - `errors.mjs` exports `refuse` (the stage-0 refusal table rebuilt for rows: `notAStrategy`, `badRunId`, `noSuchRun`, `runSealed`, `sourceFrozen`, `toolBudget`, `notGravit`, `notARole` (plan 2), `calendarUncovered`, `internal`), `callerIsChild(exec)` → `exec?.agent?.session?.header?.origin === "subagent" && exec.agent.session.header.isSeeded !== true`, `upstreamError(error, provider)` → stage 0's provider-to-refusal mapping moved out of the retired `server.mjs` (its `refuse.timeout`/`tooLarge`/`invalidReply`/`unassembled` and the `INVALID_REPLY_CODES` rule: `PROVIDER_TIMEOUT` → `UPSTREAM_TIMEOUT`, the size code → `UPSTREAM_TOO_LARGE`, the reply codes and an uncoded fetch failure → `UPSTREAM_INVALID`), its Chinese texts naming the provider (`腾讯行情` or `东方财富`), and `asToolError(error)` → a `LunhuiError` passes through, anything else becomes `INTERNAL` after its detail is written to `process.stderr`.
  - `lunhui_read_run({ strategy, run })` returns one JSON text: `run.json`'s manifest, `metrics`, and `artifacts: [{ module, accepted, headline }]` for each file of `MODULES` present in the run (none in this plan) — the headline read as the runs card reads it (Task 11's bounded reader is server-side; here `readText` with a 24 KiB cap). Description, Chinese: 读取一次研究运行的清单、计数与各模块工件的要点；参数是策略名与运行编号，不是路径。

- [ ] **Step 1: Write the failing tests**

Build a stand-in scope as `face/tests/gravit-plugin.test.ts` does, extended: `ctx.provide(name, value)` records `[name, value]`; `ctx.tools.register(def)` records `def` and returns a disposer; `ctx.effect(fn)` runs `fn` and keeps its disposer.

```ts
test("lunhui-runs: name and inject; apply refuses a bad strategiesRoot with its reason", ...);
test("lunhui-runs: apply provides lunhuiRuns once and registers exactly lunhui_read_run; unload disposes both", ...);
test("lunhui-runs: the service opens, adds, seals and reads a run under the root, and refuses a strategy outside it", ...);
test("lunhui-runs: withRun serializes two callers on one run", async () => { /* two concurrent fn's; the second starts after the first resolves (record order) */ });
test("lunhui-runs: countFreeze throws TOOL_BUDGET on the ninth call and persists the count; a deleted metrics.json restarts the count at zero", ...);
test("errors: upstreamError maps stage 0's provider codes to UPSTREAM_TIMEOUT, UPSTREAM_TOO_LARGE and UPSTREAM_INVALID, names the provider, and never a path", ...);
test("lunhui_read_run: returns the manifest, the metrics and an empty artifacts list; a bad run id is BAD_RUN_ID; a path-like strategy is NOT_A_STRATEGY", async () => {
  const text = await tool.execute({ strategy: "alpha", run }, fakeExec());
  const body = JSON.parse(text);
  assert.equal(body.manifest.run, run); assert.deepEqual(body.artifacts, []);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd face && npx tsx --test tests/lunhui-rows.test.ts`
Expected: FAIL, the row does not exist.

- [ ] **Step 3: Implement the three files**

`defineTool` from `@deepseek-ai/dsh-tools`, as `@deepseek-ai/dsh-tool-subagent` calls it: `parameters` a property map `{ strategy: { type: "string", description, required: true }, run: { type: "string", description, required: true } }`, `output: { schema: { type: "string" }, render: (_args, result) => [{ type: "text", text: result }] }`, `execute(args, exec)` returning the JSON text or throwing through `asToolError`.

- [ ] **Step 4: Run the tests**

Run: `cd face && npx tsx --test tests/lunhui-rows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add face/package.json face/package-lock.json face/plugins/lunhui/runs-row.mjs face/plugins/lunhui/lib/modules.mjs face/plugins/lunhui/lib/errors.mjs face/tests/lunhui-rows.test.ts
git commit -m "feat: the lunhui-runs row provides the runs service and registers lunhui_read_run"
```

---

### Task 5: Eastmoney fetch core and the limit-up pools

**Files:**
- Create: `face/plugins/lunhui/lib/eastmoney.mjs`, `face/tests/fixtures/lunhui-eastmoney/` (`zt-pool.json`, `zb-pool.json`, `yesterday-pool.json`, `README.md`)
- Modify: `face/plugins/lunhui/lib/fixture-fetch.mjs` (the Eastmoney URL → file mapping), `face/plugins/lunhui/lib/market.mjs` (`fetchBytes` exported and generalized)
- Test: `face/tests/lunhui-eastmoney.test.ts`

**Interfaces:**
- Produces, in `market.mjs`: `fetchBytes(url, fetchImpl, timeoutMs, { redirect = "error", headers = <stage 0's Tencent headers>, maxBytes = MAX_RESPONSE_BYTES } = {})` → `Promise<{ status, headers, bytes }>`, exported; every existing Tencent call keeps the defaults, so its behaviour and its `PROVIDER_*` codes are unchanged (the market tests pin it).
- Produces, in `eastmoney.mjs`:
  - `inFlight(fn)` — one module-level limiter, at most four Eastmoney requests running at once across every caller (A17); the others queue in arrival order. Every request below goes through it.
  - `fetchEastmoneyJson(url, { fetchImpl = fetch, timeoutMs = 7000, maxBytes = 512 * 1024 })` → `Promise<{ json, host, delayed }>`: GET with `redirect: "manual"`; a 301/302/307/308 is followed once and only when the `location` host is `push2delay.eastmoney.com` and its path and query equal the request's (else `UPSTREAM_INVALID`); a second redirect is `UPSTREAM_INVALID`; `host` is the serving host; `delayed` is `host === "push2delay.eastmoney.com" || typeof json.dlmkts === "string" && json.dlmkts !== ""`; the body is read through `fetchBytes` with `redirect: "manual"`, Eastmoney's headers (`Accept: application/json`, `Referer: https://quote.eastmoney.com/`) and the cap, its codes mapped by Task 4's `upstreamError(_, "东方财富")` (timeout → `UPSTREAM_TIMEOUT`, over `maxBytes` → `UPSTREAM_TOO_LARGE`, not JSON or a non-2xx → `UPSTREAM_INVALID`).
  - `fetchLimitUpPools({ date, fetchImpl, timeoutMs })` → `Promise<{ zt: PoolRow[], zb: PoolRow[], yesterday: PoolRow[], host, delayed, truncated }>`; `date` is `YYYYMMDD`; the three endpoints are `https://push2ex.eastmoney.com/getTopicZTPool`, `getTopicZBPool`, `getYesterdayZTPool`, each with the query AKShare sends (`ut=7eea3edcaed734bea9cbfc24409ed989`, `dpt=wz.ztzt`, `Pageindex=0`, `pagesize=500`, `sort=fbt:asc` for the first, the others as `stock_zt_pool_zbgc_em` and `stock_zt_pool_previous_em` send in the installed `akshare/stock_feature/stock_ztb_em.py`); a reply whose `data` is `null` or whose pool is empty is `NO_MARKET_DATA`; more than 500 rows sets `truncated: true` and keeps the first 500.
  - `PoolRow` for `zt`: `{ code, name, pct, price, amount, floatCap, totalCap, turnoverRate, boards: lbc, firstSealAt: fbt, lastSealAt: lbt, sealFunds: fund, breakCount: zbc, industry: hybk, streak: { days, count } }` with the reply's keys `c n zdp p amount ltsz tshare hs lbc fbt lbt fund zbc hybk zttj`; `price` divided by 1000 as AKShare divides it; `zb` and `yesterday` rows carry the fields their replies carry, named in the same English, the raw key named in a comment beside each.
- `fixture-fetch.mjs`: a URL whose host is `push2ex.eastmoney.com` maps by path to `zt-pool.json`, `zb-pool.json`, `yesterday-pool.json`; a URL whose host is `push2.eastmoney.com` and path `/api/qt/clist/get` maps by its `fs` query: `m:90+t:3` with `fid0` → `board-flow.json`, `m:90+t:3` → `boards.json`, `b:<code>…` → `members-<code>.json`, the all-shares `fs` → `counts-page-<pn>.json`; anything else 404. The redirect cases are not fixtures: the tests hand `fetchEastmoneyJson` a small fake `fetchImpl` that answers 302 with a `location` and records every URL it was asked for (spec §6).

- [ ] **Step 1: Write the fixtures**

Synthetic, shaped exactly like the live replies (the keys above; `rc`, `rt`, `svr`, `lt`, `full`, `data: { tc, qdate, pool: [...] }` for the pools), small (≤ 8 rows each), with a README as `fixtures/lunhui/README.md` is written; the zb pool shares two codes with the zt pool so the derived ratios in Task 7 are non-trivial.

- [ ] **Step 2: Write the failing tests**

```ts
test("eastmoney: the ZT pool parses to PoolRows with the price divided by 1000 and the streak split", ...);
test("eastmoney: data null is NO_MARKET_DATA; an empty pool is NO_MARKET_DATA", ...);
test("eastmoney: 501 rows are cut to 500 with truncated true", ...);
test("eastmoney: one redirect to push2delay is followed with delayed true; a redirect elsewhere is UPSTREAM_INVALID; a second redirect is UPSTREAM_INVALID; no numbered host is ever asked", ...);
test("eastmoney: ten concurrent requests never have more than four in flight", ...);
test("eastmoney: a reply with dlmkts set is delayed even from the plain host", ...);
test("eastmoney: not JSON is UPSTREAM_INVALID, over 512 KiB is UPSTREAM_TOO_LARGE, a hung body is UPSTREAM_TIMEOUT", ...);
test("eastmoney: the fixture fetch answers the three pool paths and 404s an unknown path", ...);
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd face && npx tsx --test tests/lunhui-eastmoney.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

Generalize `fetchBytes` as the Interfaces block says, then build `eastmoney.mjs` on it.

- [ ] **Step 5: Run the tests**

Run: `cd face && npx tsx --test tests/lunhui-eastmoney.test.ts tests/lunhui-market.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add face/plugins/lunhui/lib/eastmoney.mjs face/plugins/lunhui/lib/fixture-fetch.mjs face/plugins/lunhui/lib/market.mjs face/tests/fixtures/lunhui-eastmoney face/tests/lunhui-eastmoney.test.ts
git commit -m "feat: the Eastmoney fetch core follows one redirect to the delay host and parses the limit-up pools"
```

---

### Task 6: Boards, board members, fund flow and the all-shares counts

**Files:**
- Modify: `face/plugins/lunhui/lib/eastmoney.mjs`
- Create: fixtures `boards.json`, `members-BK0715.json`, `members-BK1716.json`, `board-flow.json`, `counts-page-1.json`, `counts-page-2.json` under `face/tests/fixtures/lunhui-eastmoney/`
- Test: `face/tests/lunhui-eastmoney.test.ts` (extended)

**Interfaces:**
- Produces, in `eastmoney.mjs`:
  - `fetchBoards({ fetchImpl, top = 30 })` → `Promise<{ boards: Board[], host, delayed }>`: `https://push2.eastmoney.com/api/qt/clist/get` with `pn=1 pz=<top> po=1 np=1 fltt=2 invt=2 fid=f6 fs=m:90+t:3 fields=f12,f14,f3,f6,f104,f105,f128`; `Board = { code: f12, name: f14, pct: f3, amount: f6, advancers: f104, decliners: f105, leader: f128 }`.
  - `fetchBoardMembers(code, { fetchImpl, max = 100 })` → `Promise<{ members: Member[], truncated, host, delayed }>`: the same path with `fs=b:<code>+f:!50`, `pz=<max>`, `fields=f12,f14,f3`; `code` must match `^BK\d{4}$` (else `UPSTREAM_INVALID` before any request); `total` over `max` sets `truncated: true`.
  - `fetchBoardFundFlow({ fetchImpl, top = 30 })` → `Promise<{ rows: FlowRow[], host, delayed }>`: the query `stock_sector_fund_flow_rank("今日", "概念资金流")` sends in the installed `akshare/stock/stock_fund_em.py` (`fid0=f62`, `fs=m:90 t:3`, its `fields`); `FlowRow = { code, name, pct, mainNet: f62, mainShare: f184 }`.
  - `fetchMarketCounts({ fetchImpl, pageSize = 1000, maxPages = 8 })` → `Promise<{ advancers, decliners, unchanged, limitUp, limitDown, total, pages, pageHashes, partial, host, delayed }>`: the same path with `fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23` (A shares), `fields=f3,f2`, `pz=<pageSize>`, `pn` from 1; a page's `data.total` differing from the first page's, or `maxPages` reached before `total` rows, sets `partial: true`; `limitUp` counts rows with `f3 >= 9.9` and `limitDown` rows with `f3 <= -9.9` (the main board's 10%; a research-candidate threshold, named in a constant); no rows are returned, only counts and each page's sha256.

- [ ] **Step 1: Write the fixtures**

Synthetic replies in the clist shape `{ rc, rt, svr, lt, full, dlmkts, dsc, data: { total, diff: [...] } }`; `members-BK1716.json` with `total: 140` and 100 rows (the truncation case); `counts-page-2.json` with a `total` differing from page 1 (the partial case).

- [ ] **Step 2: Write the failing tests**

```ts
test("eastmoney: fetchBoards returns the top boards with advancers and decliners", ...);
test("eastmoney: fetchBoardMembers refuses a code off the BK grammar before fetching, and cuts a 140-member board to 100 with truncated true", ...);
test("eastmoney: fetchBoardFundFlow parses the main net inflow and its share", ...);
test("eastmoney: fetchMarketCounts sums pages, counts limit-up and limit-down rows, hashes every page, and marks a changed total partial", ...);
```

- [ ] **Step 3: Run them to see them fail**, **Step 4: Implement**, **Step 5: Run them to pass**

Run: `cd face && npx tsx --test tests/lunhui-eastmoney.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add face/plugins/lunhui/lib/eastmoney.mjs face/tests/fixtures/lunhui-eastmoney face/tests/lunhui-eastmoney.test.ts
git commit -m "feat: Eastmoney boards, members, fund flow and the all-shares counts, bounded and hashed"
```

---

### Task 7: Derived measures

**Files:**
- Create: `face/plugins/lunhui/lib/derive.mjs`
- Test: `face/tests/lunhui-derive.test.ts`

**Interfaces:**
- Consumes: Task 5 and 6's row shapes; Task 3's `evidenceId`.
- Produces, in `derive.mjs`, pure functions returning `DerivedItem[]`, each `{ id, source, kind: "derived", measure, value, inputs: string[], params?: object, partial?: boolean }`, `id = "ev_" + hash({measure, value, inputs}).slice(0, 24)`:
  - `deriveLimitUp({ zt, zb, yesterday }, ids)` → `streak_distribution` (`{ "1": n, "2": n, … }` from `boards`), `seal_ratio` (unique zt codes / unique codes in zt ∪ zb), `break_ratio` (unique zb codes / the same union), `yesterday_return_median` (the median `pct` of `yesterday`), `yesterday_negative_tail` (the share of `yesterday` with `pct <= NEGATIVE_TAIL_PCT`, `NEGATIVE_TAIL_PCT = -5`, carried in `params`); `ids` maps a row's code to its evidence id so `inputs` cite rows.
  - `deriveBoards(boards, members, ids)` → per board `breadth` = `advancers / (advancers + decliners)` (null when both are 0) and `turnover_share` = `amount / Σ amount` over the fetched boards; never from the member lists.
  - `deriveCounts(counts, ids)` → `advance_decline_ratio` (`advancers / decliners`, null when decliners is 0), `limit_up_count`, `limit_down_count`, with `partial` copied from the counts.
  - `deriveIndex(quotes, ids)` → `total_turnover` = the `amount` of `sh000001` plus `sz399001` from the Tencent quotes.

- [ ] **Step 1: Write the failing tests**

Hand-computed expectations from the fixtures: e.g. with zt codes `{A, B, C}` and zb codes `{B, D}`, `seal_ratio = 3/4`, `break_ratio = 2/4`; a `yesterday` pool of pcts `[-6, -2, 1, 4]` gives median `-0.5` and tail `0.25`; a board with 7 advancers and 3 decliners has breadth `0.7`; `inputs` hold the cited rows' ids; `partial` copies through.

- [ ] **Step 2: Run them to see them fail**, **Step 3: Implement**, **Step 4: Run them to pass**

Run: `cd face && npx tsx --test tests/lunhui-derive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add face/plugins/lunhui/lib/derive.mjs face/tests/lunhui-derive.test.ts
git commit -m "feat: the Lunhui derived measures, computed by host code with their inputs cited"
```

---

### Task 8: The four freeze rows

**Files:**
- Create: `face/plugins/lunhui/lib/freeze-tool.mjs`, `face/plugins/lunhui/freeze-quotes-row.mjs`, `face/plugins/lunhui/freeze-limit-up-row.mjs`, `face/plugins/lunhui/freeze-boards-row.mjs`, `face/plugins/lunhui/freeze-index-row.mjs`
- Test: `face/tests/lunhui-freeze.test.ts`

**Interfaces:**
- Consumes: Task 4's service and `errors.mjs`; Tasks 5–7; Task 2's `coverageOf`; stage 0's `freezeSample`, `fetchQuotes`, `fetchDailyBars`.
- Produces:
  - `freeze-tool.mjs` exports `defineFreeze({ name, description, parameters, source, kind, freeze })` → the `defineTool` definition: `execute(args, exec)` refuses `NOT_GRAVIT` when `callerIsChild(exec)`; resolves the strategy; refuses `WRONG_CHANNEL` when `kind` is `"market"` and the strategy is not `cn-market`, or `"strategy"` and it is (quotes accepts both); checks `coverageOf(today in China)` → `CALENDAR_UNCOVERED`; `withRun`: opens a run when `args.run` is absent, else resolves it and refuses `RUN_SEALED`; `countFreeze` (budget); calls `freeze(fetchImpl, args)` → `{ items, derived, meta }`, a provider error passed through Task 4's `upstreamError` (nothing written for that source); `addEvidence(source, [...items, ...derived], meta)`; returns JSON text `{ run, strategy, source, as_of: meta.received_at, items: items.length, derived: measures, host, delayed, truncated }`. The row's `config.fetch`, when set, is a directory handed to `createFixtureFetch`; else the global `fetch`.
  - Each row exports `name`, `inject = ["tools", "lunhuiRuns"]`, `apply(ctx, config)` registering one tool:
    - `lunhui-freeze-quotes` → `lunhui_freeze_quotes({ strategy, run?, symbols })`, `kind: "any"`, source `quotes`: stage 0's `freezeSample` (1–8 symbols, its grammar); items are the quotes and the histories; derived: none here (`deriveIndex` belongs to the index row).
    - `lunhui-freeze-limit-up` → `lunhui_freeze_limit_up({ strategy, run? })`, `kind: "market"`, source `limit-up`: `fetchLimitUpPools` for `getMarketSession(now).expectedQuoteDate` as `YYYYMMDD` (the latest trading day whose pool can exist: on a weekend or holiday the previous session, before 09:15 the previous session; a null date is `CALENDAR_UNCOVERED`), items are the three pools' rows tagged `pool: "zt" | "zb" | "yesterday"`, derived `deriveLimitUp`.
    - `lunhui-freeze-boards` → `lunhui_freeze_boards({ strategy, run?, boards? })`, `kind: "market"`, source `boards`: `fetchBoards`, then members for `args.boards` (each `^BK\d{4}$`, at most 10) or the top 10 by turnover, `fetchBoardFundFlow`; items are boards, one member-list item per board, flow rows; derived `deriveBoards`.
    - `lunhui-freeze-index` → `lunhui_freeze_index({ strategy, run? })`, `kind: "market"`, source `index`: Tencent quotes and 120-day bars for the four indices (`fetchDailyBars` with the day count made a parameter), `fetchMarketCounts`; items are the index quotes, the bar series, the counts; derived `deriveIndex` and `deriveCounts`.
  - Descriptions in Chinese state every bound (symbols 1–8, boards ≤ 10, eight freezes per run, Gravit only, market channel only where it holds).

- [ ] **Step 1: Write the failing tests**

With the stand-in scope of Task 4 holding a real `lunhuiRuns` service over a temp strategies root (with `cn-market` and `alpha` strategies) and rows configured with `fetch: <fixtures>`:

```ts
test("freeze: lunhui_freeze_limit_up opens a run in cn-market, writes evidence-limit-up.json with rows and derived items, and returns the summary", ...);
test("freeze: a second limit-up freeze on the same run is SOURCE_FROZEN; a freeze on a sealed run is RUN_SEALED", ...);
test("freeze: limit-up, boards and index refuse a strategy channel with WRONG_CHANNEL; quotes accepts both", ...);
test("freeze: a delegated child caller is NOT_GRAVIT; a fork and a root pass", async () => {
  await rejectsWith(tool.execute(args, exec({ origin: "subagent", isSeeded: false })), "NOT_GRAVIT");
  await tool.execute(args, exec({ origin: "subagent", isSeeded: true }));
  await tool.execute(args, exec({}));
});
test("freeze: the ninth freeze on one run is TOOL_BUDGET", ...);
test("freeze: a date no table covers is CALENDAR_UNCOVERED before any fetch", ...);
test("freeze: a NO_MARKET_DATA pool writes nothing and leaves the run open with its other evidence", ...);
test("freeze: on a Saturday the limit-up pools are asked for the previous trading day's date", ...);
test("freeze: a Tencent timeout on the quotes freeze is UPSTREAM_TIMEOUT and writes nothing", ...);
test("freeze: boards cuts a long member list at 100 with truncated true, and breadth comes from the board's own counts", ...);
test("freeze: index records partial counts as partial in the derived item", ...);
test("freeze: two freezes of different sources on one run at once both land", ...);
```

- [ ] **Step 2: Run them to see them fail**, **Step 3: Implement**, **Step 4: Run them to pass**

Run: `cd face && npx tsx --test tests/lunhui-freeze.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add face/plugins/lunhui/lib/freeze-tool.mjs face/plugins/lunhui/freeze-quotes-row.mjs face/plugins/lunhui/freeze-limit-up-row.mjs face/plugins/lunhui/freeze-boards-row.mjs face/plugins/lunhui/freeze-index-row.mjs face/tests/lunhui-freeze.test.ts
git commit -m "feat: the four Lunhui freeze rows write evidence and derived measures into a run"
```

---

### Task 9: Composed into the face

**Files:**
- Create: `face/src/lunhui.ts`
- Modify: `face/src/boot.ts` (compose after `seatPatches`), `face/src/setup.ts` (`PATCH_HEADER` names the rows), `face/scripts/schema-sizes.ts` (`GROUPS` gains `"lunhui_"`), `face/tests/boot.test.ts` (the layer count and the five ids), `face/tests/smoke.test.ts` (the five tools and the rows' phases), `face/tests/bots.test.ts` (no bot sees a `lunhui_` tool)

**Interfaces:**
- Produces: `lunhui.ts` exports `LUNHUI_ROW_IDS = ["lunhui-runs", "lunhui-freeze-quotes", "lunhui-freeze-limit-up", "lunhui-freeze-boards", "lunhui-freeze-index"]`, `LUNHUI_TOOL_NAMES` (the five), and `lunhuiPatches(repoRoot = <this file's repository>)` → `FacePatchList`: one `insert` of five rows in that order, each `{ id, name: <absolute file URL of the plugin file>, config }`; the backbone's `config = { strategiesRoot: join(repoRoot, "strategies") }`, a freeze row's `config = {}`.

- [ ] **Step 1: Extend the tests**

`boot.test.ts`: the exact-layer test counts one more layer; the exactly-once test asserts each of `LUNHUI_ROW_IDS` once. `smoke.test.ts`: after the boot, `tools.schemas()` names include every `LUNHUI_TOOL_NAMES`; `/data/plugins.json`'s `rows` hold the five ids with `phase === "active"` and `enabled === true`. `bots.test.ts`: `expandAllow(DEFAULT_ALLOW, [...knownNames, ...LUNHUI_TOOL_NAMES])` and every shipped bot's allow list (through `listBots`) admit no `lunhui_` name.

- [ ] **Step 2: Run them to see them fail**

Run: `cd face && npx tsx --test tests/boot.test.ts tests/bots.test.ts`
Expected: FAIL on the missing module.

- [ ] **Step 3: Implement**

`lunhui.ts` after `akshare.ts`'s shape; `boot.ts`: `const lunhuiRows = lunhuiPatches();` composed in `patches` and `below` right after `seatPatches`; `setup.ts` header sentence names the five rows beside AKShare's and the seat's; `schema-sizes.ts` `GROUPS = ["mcp__akshare__", "mcp__account__", "lunhui_", "agent_", "role_"]`.

- [ ] **Step 4: Run the suites**

Run: `cd face && npm test && npm run typecheck`, then `FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts tests/bots-smoke.test.ts`
Expected: PASS; the smoke prints the five tools among the roster.

- [ ] **Step 5: Commit**

```bash
git add face/src/lunhui.ts face/src/boot.ts face/src/setup.ts face/scripts/schema-sizes.ts face/tests/boot.test.ts face/tests/smoke.test.ts face/tests/bots.test.ts
git commit -m "feat: the five Lunhui rows compose after the Account seat, pinned on a real boot"
```

---

### Task 10: The market channel

**Files:**
- Create: `strategies/cn-market/THESIS.md`, `strategies/cn-market/journal.md`, `strategies/cn-market/status.yaml`
- Modify: `GRAVIT.md` (one line)
- Test: `face/tests/gravit-md.test.ts` (unchanged; the cap), `face/tests/channels.test.ts` (one case: the directory lists as a channel)

- [ ] **Step 1: Write the three files**

`THESIS.md`, Chinese body under the template's English headings: `# cn-market`; status line `**Status:** idea · **Owner:** agent + operator`; `## Thesis`: the market read itself — three hypotheses in the tree's own words, each with its chapter and paragraph ids (环境与大周期: 一 P0019–P0074, 八 P1652–P1708; 情绪周期: 二 P0156–P0163, P0020–P0056; 题材与轮动: P0075–P0153, 六 P1345–P1464) and the seven states named as revisable labels; `## Rules`: the run order of spec §5.10 for this channel, no entry or exit (it trades nothing); `## Falsification`: a state label is wrong when the next session's frozen evidence contradicts it (the measures of Task 7, named), and the expectation review of a strategy run that cited it is the grader. No sentence quotes the manuscript. `journal.md`: the template's header. `status.yaml`: `status: idea` with the template's comment.

- [ ] **Step 2: The `GRAVIT.md` line**

Under "A strategy directory", after the lifecycle paragraph: `` `analysis/<run>/` holds frozen A-share research runs the Lunhui rows write; never edit them by hand, and `strategies/cn-market/` is the market read's channel. `` Check `wc -c GRAVIT.md` ≤ 4,500.

- [ ] **Step 3: Test and commit**

Run: `cd face && npx tsx --test tests/gravit-md.test.ts tests/channels.test.ts`
Expected: PASS.

```bash
git add strategies/cn-market GRAVIT.md
git commit -m "feat: the cn-market channel, the market read's own strategy directory"
```

---

### Task 11: The runs card, server side

**Files:**
- Modify: `face/src/channels.ts`
- Test: `face/tests/channels.test.ts`

**Interfaces:**
- Consumes: Task 4's `MODULES` (its names and headline fields, copied into channels.ts as a constant `MODULE_HEADLINES` — the server owns the table; the client renders the pairs it receives); stage 0's `channels.ts` at the graft worktree for the code to port.
- Produces: `ChannelBody` gains `runs: RunRow[]`, `runsOmitted: number`, `latestRun: LatestRun | null`;
  `RunRow = { run, asOf: string | null, snapshotId: string | null, sealed: boolean, kind: "market" | "strategy" | null, artifacts: { [module]: { accepted: true, status: string | null, contractVersion: string | null, headline: Record<string, unknown> } }, marketRun: string | null, bytes: number }` — `status` is the artifact's top-level `status` (`"NOT_EVALUABLE"` for a module whose evidence was missing, spec §5.4; plan 2 writes it), `contractVersion` its `contract_version` (A19);
  `LatestRun = { run, asOf, snapshotId, artifacts: { [module]: { headline, json } }, marketRun }` — the newest sealed run with at least one artifact, or null. Also ported as they are: `readBoundedJson(path, cap, diskCap)`, `nestsWithin`, `JSON_FILE_MAX_DEPTH = 32`, `BACKTEST_MAX_BYTES`, `BACKTEST_MAX_DISK_BYTES`, the bounded latest-evidence block, and `send()` serializing before `writeHead`. New caps: `run.json` and `metrics.json` 8 KiB, an artifact 24 KiB on the compact JSON, read bound twice the cap.

- [ ] **Step 1: Port stage 0's bounds tests, then write the runs tests**

From the graft's `channels.test.ts`: the three evidence-block cases (over the cap or too deep; the disk ceiling; links and a linked `backtests/`) and the route case "a body that cannot be serialized answers one clean 500", adapted to main's helpers. New:

```ts
test("readChannelBody: runs list newest first with sealed, snapshotId and the artifacts' headlines; an open run has snapshotId null", ...);
test("readChannelBody: latestRun is the newest sealed run with an artifact; runs with none are listed but not latest", ...);
test("readChannelBody: the listing stops at 50 and counts the rest in runsOmitted", ...);
test("readChannelBody: a linked analysis/, a linked run file and a hard-linked one are never read", ...);
test("readChannelBody: an artifact over 24 KiB compact or nested past 32 is listed without a headline", ...);
test("readChannelBody: run.json that does not parse lists the run with nulls and bytes still counted", ...);
test("MODULE_HEADLINES equals the plugins' MODULES table, name for name and field for field", ...);
```

The run fixtures are made with Task 3's `openRun`, `addEvidence`, `sealRun` and a hand-written `mode.json` so the shapes are the server's own.

- [ ] **Step 2: Run them to see them fail**, **Step 3: Implement**, **Step 4: Run them to pass**

Run: `cd face && npx tsx --test tests/channels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add face/src/channels.ts face/tests/channels.test.ts
git commit -m "feat: the channel overview lists Lunhui runs with their artifacts, every read bounded, the head written after the body serializes"
```

---

### Task 12: The runs card, client side

**Files:**
- Create: `face/client/js/host/runs-view.js`
- Modify: `face/client/js/render/channel.js`
- Test: `face/tests/client/runs-view.test.js`, `face/tests/client/channel.test.js` (extended)

**Interfaces:**
- Consumes: Task 11's `runs`, `runsOmitted`, `latestRun`.
- Produces: `runs-view.js` exports `runsView(body)` → `{ latest: { run, asOf, snapshotId, marketRun, chips: [{ module, text }], expectation: [[key, value]] | null } | null, rows: [{ run, asOf, sealed, artifacts: string[], bytes }], omitted: number, empty: "no runs yet" | "no sealed run with an artifact yet" | null }` — pure, every string from the wire passed through as data; `chips` one per module present, text `<module>: <headline fields joined>`, or `<module>: not evaluable` when the artifact's `status` is `"NOT_EVALUABLE"`. `channel.js` renders a `sec('Research runs', …)` after `latest(body)`: the latest run's line, its chips, the expectation as `kv`, then one dim row per run (`run · as of · N artifacts · bytes`), then `older runs not listed: N` when `omitted > 0`; every value through `esc`.

- [ ] **Step 1: Write the failing tests**

```js
test('runsView: shapes the latest run, its chips and the rows; omitted carries through', ...);
test('runsView: no runs yields the empty word; runs without an artifact yield the other', ...);
test('the channel page draws the research runs after the latest backtest, every string escaped', () => {
  const h = renderChannelScreen(on(overview({ body: { ...overview().body, runs: [...], runsOmitted: 2, latestRun: {...} } })), NOW);
  assert.match(h, /Research runs/); assert.match(h, /older runs not listed: 2/); assert.doesNotMatch(h, /<script>/);
});
```

- [ ] **Step 2: Run them to see them fail**, **Step 3: Implement**, **Step 4: Run them to pass**

Run: `cd face && npx tsx --test tests/client/runs-view.test.js tests/client/channel.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add face/client/js/host/runs-view.js face/client/js/render/channel.js face/tests/client/runs-view.test.js face/tests/client/channel.test.js
git commit -m "feat: the channel page shows the research runs, the latest run's chips and its expectation card"
```

---

### Task 13: Documentation and the measured sizes

**Files:**
- Modify: `DEVELOPMENT.md` (§3.6 one row for the five tools; §4.2 `lunhui.ts` row; §4.3 the five rows after the seat, the layer list; §4.4 the overview row; §4.6 the fixture config is row config, no environment variable; §5.1 the two client files; §5.2 the runs card wire; §7.3 the new test files; §9: R32 re-worded for the face process, R33 the calendar tables, new residuals for the delayed Eastmoney quotes and the evidence files out of git; §10: plans 2–4 as forward items, and the 2027 calendar table — `lib/calendar/2027.json` from the SSE notice, due when the notice is out, usually December; until then a 2027 session date refuses `CALENDAR_UNCOVERED` (A25)), `face/README.md` (a "Lunhui analysis" section rewritten for rows: the eleven planned rows and the five built, the egress hosts and the redirect, the fixture config, the disable lines, `strategies/cn-market/`, the two commands of a first market freeze), `CLAUDE.md` (the `face/` row names `face/plugins/lunhui/` as rows; the `strategies/` row names `cn-market`), `ROADMAP.md` (built log entry naming the spec and this plan)

- [ ] **Step 1: Measure the schema sizes**

On a copy of the harness home made without its credentials and sessions:
`rsync -a --exclude .credentials.yaml --exclude sessions ~/.dsh/ <scratch>/dsh-sizes/`, then `cd face && DSH_HOME=<scratch>/dsh-sizes npx tsx scripts/schema-sizes.ts | tail -9`, then delete the copy. Record the `lunhui_` group line and the total in DEVELOPMENT §4.3's table.

- [ ] **Step 2: Write every row listed above** in each document's voice, present tense; DEVELOPMENT cites files and symbols, never line numbers.

- [ ] **Step 3: Verify**

Run: `cd face && npm test && npm run typecheck`; `git status --porcelain docs/research/lunhui/corpus strategies/cn-market/analysis` → empty.
Expected: pass; nothing from the corpus or an evidence file staged.

- [ ] **Step 4: Commit**

```bash
git add DEVELOPMENT.md face/README.md CLAUDE.md ROADMAP.md
git commit -m "docs: the Lunhui rows, the market channel and the runs card through the documents"
```
