# Lunhui Module Cards — Plan 1 (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the face everything the module cards will stand on — a read-only listing of every channel's Lunhui runs, a second protocol section that teaches Gravit a single-module request, and a market-analyst role that writes the one module a brief names — without changing a row, a contract, an artifact or the chain.

**Architecture:** Three seams the tree already has are extended in place: `face/src/channels.ts`'s run reader grows the fields a card needs and backs a new `GET /data/modules.json` beside `/data/channels.json`; `face/src/protocols.ts` reads a second prose file under `dsh/profile/` that `plugins/gravit.js` mounts as a section after `lunhui:run`; `roles/cn-market-analyst/` gains one sentence. Nothing visible changes in the client until plan 2.

**Tech Stack:** Node 22, TypeScript (face/src, strict `tsc --noEmit`), ESM `.mjs` rows, `node --test` via tsx, js-yaml; no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-28-lunhui-module-cards-design.md` — §4 F4, F6, G8, G21–G24; §5.2, §5.6, §5.9; §6; §11 plan 1. Plans 2 (the shelf and the page) and 3 (Run) follow on the same spec.

## Global Constraints

- No change to any Lunhui row, contract, schema, field, artifact, freeze or budget (spec F4 / N1). The only role change is the market analyst's one sentence (F6).
- `dsh/profile/lunhui-run.md` is not edited (2,999 of 3,000 bytes).
- A protocol file: trimmed, no `{{`, at most `PROTOCOL_MAX_BYTES` = 3,000 raw bytes at the loader; `lunhui-module.md` at most **1,500** bytes (spec G4), Chinese, section name `lunhui:module` (regex `^[a-z]+:[a-z-]+$`), probe `lunhui_read_run`.
- `roles/<id>/ROLE.md` at most 2,000 bytes; `role.yml` `description` one line, at most 300 characters (`face/src/roles.ts` refuses otherwise; `tests/roles.test.ts` pins).
- `bots/gravit/agent.cordis.yml` is written only by `cd face && npm run render:roles`; `tests/roles.test.ts` byte-compares it with the render and fails on drift.
- Every `/data` route: `isTrustedDataRequest` first, fixed refusal text, nothing from a request echoed; JSON files through `readBoundedJson` (`run.json` 8 KiB, an artifact 24 KiB), never an evidence file.
- Code, tests, commit messages and English docs in English; the protocol and the role persona in Chinese; the manuscript cited by paragraph id only, never its text.
- Commit messages: plain words, no backticks, no parentheses, no `$()` (zsh runs them); write a long message to a file and `git commit -F` it.
- Work on a feature branch in a worktree (superpowers:using-git-worktrees); never `git switch` the primary checkout; `cd face && npm test && npm run typecheck` green before each commit that touches `face/`.

## Review Focus

1. A `run.json` whose `evidence` is missing, not an array, or holds entries without a string `source` → `frozen: []`, the run still listed (Task 1 test "frozen is the evidence sources, in order, strings only").
2. An artifact whose `missing_sources` is absent, not an array, or mixes non-strings → `missingSources: []`; a `market_run` that is not a string → `marketRun: null` (Task 1 test "missingSources and marketRun tolerate malformed fields").
3. A channel with no `analysis/` directory yet → `runs: []` and not `unreadable`; one whose `analysis/` cannot be read for another reason (EACCES, a file where the directory was) → `runs: []`, `unreadable: true`; the route still 200 either way (Task 2 test "a channel whose read throws").
4. The row `include:lunhui-runs` present but `disabled: true`, or with `fiber.state` 3 (failed) or no fiber → `mounted: false` (Task 2 test "lunhuiMounted").
5. `lunhui-module.md` at exactly 1,500 bytes passes its budget test and 1,501 fails it, while the loader still admits up to 3,000 (Task 3 test "the module protocol's budget is its own, under the loader's").

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `face/src/channels.ts` | modify | `RunArtifact` + `RunRow` fields; `readAnalysisRuns` exported with a cap; `MODULES_RUNS_CAP`, `MARKET_CHANNEL`, `ModuleRunRow`, `ModulesChannel`, `readModulesChannels`; the `/data/modules.json` route in `registerChannelRoutes`; `ChannelRouteDeps.lunhuiMounted` |
| `face/src/panels.ts` | modify | `lunhuiMounted(entries)` beside `FIBER_PHASE` |
| `face/src/main.ts` | modify | passes `lunhuiMounted` into `registerChannelRoutes` |
| `face/src/protocols.ts` | modify | `LUNHUI_MODULE_FILE`, `LUNHUI_MODULE_PATH`, `LUNHUI_MODULE_SECTION`, `LUNHUI_MODULE_MAX_BYTES`; `readProtocols` returns two |
| `face/plugins/gravit.js` | modify | `LUNHUI_MODULE_SECTION`; protocol order `-60 + index` |
| `face/src/roles.ts` | modify | the mirror's generated header names both protocol files |
| `face/scripts/render-roles.ts` | modify | its doc comment names both files |
| `dsh/profile/lunhui-module.md` | create | the single-module section (Chinese) |
| `roles/cn-market-analyst/ROLE.md`, `role.yml` | modify | the one-module brief sentence and clause |
| `bots/gravit/agent.cordis.yml` | regenerate | by `npm run render:roles` after Tasks 3 and 4 |
| `face/tests/channels.test.ts` | modify | Task 1's cases; the whole-row expectation gains the new fields |
| `face/tests/lunhui-modules-listing.test.ts` | create | Task 2's route and `readModulesChannels` |
| `face/tests/panels.test.ts` | modify | `lunhuiMounted` |
| `face/tests/protocols.test.ts`, `gravit-plugin.test.ts`, `roles.test.ts` | modify | Tasks 3 and 4 |
| `DEVELOPMENT.md` §3.1, §3.8, §4.2, §4.3, §4.4, §7.3; `face/README.md`; `Gravit-Docs-and-Prompt-Loops.html`; the spec's Appendix C | modify | the documents each task's deliverable touches |

---

### Task 1: Run rows carry what a card needs

**Files:**
- Modify: `face/src/channels.ts` (`RunArtifact`, `RunRow`, `readAnalysisRuns` near lines 200–264 and 383–438)
- Test: `face/tests/channels.test.ts` (the runs-card block from line 268; the whole-row expectation at line 348)

**Interfaces:**
- Consumes: `readBoundedJson`, `MODULE_HEADLINES`, `headlineOf`, `stringOrNull` as they are in `channels.ts`.
- Produces:
  - `export interface RunArtifact { accepted: true; status: string | null; contractVersion: string | null; headline: Record<string, unknown>; missingSources: string[]; marketRun: string | null }`
  - `export interface RunRow { …as today…; openedAt: string | null; sealedAt: string | null; frozen: string[] }` (`sealed` and the row-level `marketRun` stay, the runs card reads them)
  - `export type AnalysisRuns = Pick<ChannelBody, "runs" | "runsOmitted" | "latestRun">`
  - `export async function readAnalysisRuns(strategyDir: string, options?: { cap?: number }): Promise<AnalysisRuns>` — `cap` defaults to `ANALYSIS_RUNS_CAP` (50); `runsOmitted` counts against the cap given.

- [ ] **Step 1: Write the failing tests** in `face/tests/channels.test.ts`, after the existing runs-card tests, using `makeRun` and the fixtures there:

```ts
test("readAnalysisRuns: frozen is the evidence sources, in order, strings only; openedAt and sealedAt come from the manifest", async () => {
  const dir = await strategyDir("face-runs-frozen-");
  const sealed = await makeRun(dir, new Date("2026-10-25T01:00:00Z"));          // one quotes freeze, sealed a second later
  const open = await makeRun(dir, new Date("2026-10-26T01:00:00Z"), { open: true });
  const { runs } = await readAnalysisRuns(dir);
  assert.deepEqual(runs.map((r) => r.run), [open.run, sealed.run]);
  assert.deepEqual(runs[1].frozen, ["quotes"]);
  assert.equal(runs[1].openedAt, "2026-10-25T01:00:00.000Z");
  assert.equal(runs[1].sealedAt, "2026-10-25T01:00:01.000Z");
  assert.equal(runs[0].sealedAt, null);
  // a manifest whose evidence is not an array, or whose entries lack a string source: frozen is empty, the run still lists
  const manifest = JSON.parse(await readFile(join(open.runDir, "run.json"), "utf8"));
  await writeFile(join(open.runDir, "run.json"), JSON.stringify({ ...manifest, evidence: [{ source: 7 }, "x", { file: "evidence-index.json" }] }));
  assert.deepEqual((await readAnalysisRuns(dir)).runs[0].frozen, []);
  await writeFile(join(open.runDir, "run.json"), JSON.stringify({ ...manifest, evidence: "none" }));
  assert.deepEqual((await readAnalysisRuns(dir)).runs[0].frozen, []);
});

test("readAnalysisRuns: an artifact's missingSources and marketRun; malformed fields read as empty and null", async () => {
  const dir = await strategyDir("face-runs-artifact-fields-");
  const theme = { module: "theme", contract_version: "2", status: "NOT_EVALUABLE", missing_sources: ["boards"], mainline_candidates: [], theme_stage: "UNKNOWN", rotation: "UNKNOWN" };
  const leader = { module: "leader", contract_version: "2", status: "OK", market_run: "20261028T020953Z-f3b89ce6", leader_candidates: [], top_pattern_flags: [] };
  const { run } = await makeRun(dir, new Date("2026-10-28T02:15:00Z"), { artifacts: { "theme.json": theme, "leader.json": leader, "environment.json": ENVIRONMENT_NOT_EVALUABLE } });
  const row = (await readAnalysisRuns(dir)).runs[0];
  assert.equal(row.run, run);
  assert.deepEqual(row.artifacts.theme.missingSources, ["boards"]);
  assert.equal(row.artifacts.theme.marketRun, null);
  assert.equal(row.artifacts.leader.marketRun, "20261028T020953Z-f3b89ce6");
  assert.deepEqual(row.artifacts.environment.missingSources, [], "the old fixture's missing is not missing_sources");
  await writeFile(join(dir, "analysis", run, "leader.json"), JSON.stringify({ ...leader, market_run: 5, missing_sources: ["a", 1] }));
  const again = (await readAnalysisRuns(dir)).runs[0];
  assert.equal(again.artifacts.leader.marketRun, null);
  assert.deepEqual(again.artifacts.leader.missingSources, []);
});

test("readAnalysisRuns: the cap option limits the rows and counts the rest", async () => {
  const dir = await strategyDir("face-runs-cap-");
  for (const day of [21, 22, 23]) await makeRun(dir, new Date(`2026-10-${day}T01:00:00Z`));
  const capped = await readAnalysisRuns(dir, { cap: 2 });
  assert.equal(capped.runs.length, 2);
  assert.equal(capped.runsOmitted, 1);
  assert.equal((await readAnalysisRuns(dir)).runsOmitted, 0);
});
```

Add `readAnalysisRuns` to the test file's import from `../src/channels.ts`, and extend the whole-row expectation at line 348 with the new fields: the open run `openedAt: "2026-10-24T01:00:00.000Z", sealedAt: null, frozen: ["quotes"]`; the older run `openedAt: "2026-10-23T01:00:00.000Z", sealedAt: "2026-10-23T01:00:01.000Z", frozen: ["quotes"]`, and each artifact `missingSources: []`, `marketRun: null` for sentiment and `"20261023T010000Z-0000abcd"` for mode.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/channels.test.ts`
Expected: FAIL — `readAnalysisRuns` is not exported; the whole-row test fails on the missing fields.

- [ ] **Step 3: Implement** in `face/src/channels.ts`: the two interface extensions; `readAnalysisRuns(strategyDir, options = {})` exported, `const cap = options.cap ?? ANALYSIS_RUNS_CAP` in place of the constant in the two places it is used; `openedAt`/`sealedAt` via `stringOrNull(manifest.opened_at)` / `stringOrNull(manifest.sealed_at)`; `frozen` = `Array.isArray(manifest.evidence) ? manifest.evidence.filter(isRecord).map((e) => e.source).filter((s): s is string => typeof s === "string") : []`, duplicates kept in order (a run has one file per source, so none arise); per artifact `missingSources` = the `missing_sources` array's string members, else `[]`; `marketRun` = `stringOrNull(artifact.json.market_run)`. Update the `RunRow` doc comment in one sentence.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/channels.test.ts tests/client/runs-view.test.js && npm run typecheck`
Expected: PASS (the client's runs view ignores the extra fields).

- [ ] **Step 5: Commit**

```bash
git add face/src/channels.ts face/tests/channels.test.ts
git commit -m "feat: run rows carry opened and sealed times, the frozen sources, each artifact's missing sources and market run; readAnalysisRuns exported with a cap"
```

---

### Task 2: `GET /data/modules.json`

**Files:**
- Modify: `face/src/channels.ts` (`ChannelRouteDeps`, `registerChannelRoutes` beside the `/data/channels.json` route, line 886 on), `face/src/panels.ts` (beside `FIBER_PHASE`, line 76), `face/src/main.ts` (the `registerChannelRoutes` call, line 265)
- Test: `face/tests/lunhui-modules-listing.test.ts` (create), `face/tests/panels.test.ts`
- Docs: `DEVELOPMENT.md` §4.4 (the route table, after the `/data/channels` rows), §4.2 (`channels.ts` row), §7.3 (the new test file)

**Interfaces:**
- Consumes: `readAnalysisRuns(dir, { cap })` and `RunRow` from Task 1; `reconcile()` and `ChannelRow` as `registerChannelRoutes` has them; `PanelDeps["loaderEntries"]`'s entry shape.
- Produces:
  - `export const MODULES_RUNS_CAP = 12;`
  - `export const MARKET_CHANNEL = "cn-market";` (the same string as `MARKET_CHANNEL` in `face/plugins/lunhui/lib/freeze-tool.mjs`; the test pins the two equal)
  - `export interface ModuleRunRow { run: string; session: string | null; asOf: string | null; openedAt: string | null; sealedAt: string | null; frozen: string[]; artifacts: { [module: string]: { status: string | null; missingSources: string[]; headline: Record<string, unknown>; marketRun: string | null } } }`
  - `export interface ModulesChannel { channel: string; workspaceId: string; kind: "market" | "strategy"; runs: ModuleRunRow[]; runsOmitted: number; unreadable?: true }`
  - `export async function readModulesChannels(rows: readonly ChannelRow[], read: (dir: string, options: { cap: number }) => Promise<AnalysisRuns> = readAnalysisRuns): Promise<ModulesChannel[]>` — skips `isRoot` rows and `missingDir` rows; a `read` that throws `ENOENT` (no `analysis/` yet — `readAnalysisRuns` lstats it, and `readChannelBody` swallows the same error) yields `runs: [], runsOmitted: 0` and no `unreadable`; any other throw yields `runs: [], runsOmitted: 0, unreadable: true`.
  - `ChannelRouteDeps.lunhuiMounted(): boolean`
  - in `panels.ts`: `export function lunhuiMounted(entries: Iterable<{ id: string; disabled?: boolean; fiber?: { state: number } }>): boolean` — true when an entry has `id === "include:lunhui-runs"`, `disabled !== true` and `fiber?.state === 2` (ACTIVE in `FIBER_PHASE`'s order).
  - The route: `GET /data/modules.json` → 200 `{ ok: true, mounted, root, channels }`; 403 `FORBIDDEN` when `!isTrustedDataRequest(req)`; 500 `{ ok: false, error: "listing failed" }` when `reconcile()` throws.

- [ ] **Step 1: Write the failing tests**

`face/tests/panels.test.ts`, beside the `pluginListing` tests:

```ts
test("lunhuiMounted: the include:lunhui-runs row, enabled and active; disabled, failed, pending or absent is not mounted", () => {
  const row = (extra: object) => ({ id: "include:lunhui-runs", options: { name: "file:///x/runs-row.mjs" }, ...extra });
  assert.equal(lunhuiMounted([row({ fiber: { state: 2 } })]), true);
  assert.equal(lunhuiMounted([row({ fiber: { state: 2 }, disabled: true })]), false);
  assert.equal(lunhuiMounted([row({ fiber: { state: 3 } })]), false);
  assert.equal(lunhuiMounted([row({ fiber: { state: 0 } })]), false);
  assert.equal(lunhuiMounted([row({})]), false);
  assert.equal(lunhuiMounted([{ id: "include:lunhui-environment", options: {}, fiber: { state: 2 } }]), false);
  assert.equal(lunhuiMounted([]), false);
});
```

`face/tests/lunhui-modules-listing.test.ts` (new; copy `fakeRes`, `getReq` and `fakeRegistry` as `tests/channels.test.ts` has them, or move them to `tests/helpers/` if that file already shares helpers that way):

```ts
test("readModulesChannels: cn-market is market, the rest strategy; the root and a missing directory are skipped; runs carry status, missing sources, headline and market run", async () => {
  // a temp root with strategies/cn-market (one sealed run: environment OK, theme NOT_EVALUABLE missing boards; one open run with an index freeze),
  // strategies/lunhui-s01-repair (one sealed run: leader with market_run, counterevidence, mode WAIT), strategies/lunhui-s02-rotation (no analysis/),
  // built with openRun / addEvidence / sealRun and hand-written artifacts named in run.json, as tests/channels.test.ts makeRun does
  const rows = [root row { isRoot: true }, cn-market row, s01 row, s02 row, { name: "gone", dir: "<root>/strategies/gone", missingDir: true, … }];
  const out = await readModulesChannels(rows);
  assert.deepEqual(out.map((c) => [c.channel, c.kind, c.runs.length, c.runsOmitted]), [["cn-market", "market", 2, 0], ["lunhui-s01-repair", "strategy", 1, 0], ["lunhui-s02-rotation", "strategy", 0, 0]]);
  const market = out[0].runs[1];                                   // the sealed one (newest first)
  assert.deepEqual(market.frozen, ["index", "limit-up"]);
  assert.equal(market.artifacts.environment.status, "OK");
  assert.deepEqual(market.artifacts.theme.missingSources, ["boards"]);
  assert.deepEqual(market.artifacts.environment.headline, { index_state: "WEAK", liquidity_state: "STABLE", cycle_anchor: "x" });
  assert.equal(out[0].runs[0].sealedAt, null);
  assert.equal(out[1].runs[0].artifacts.leader.marketRun, market.run);
  assert.equal(out[1].runs[0].artifacts.mode.headline.mode, "WAIT");
  assert.equal("bytes" in market, false, "the listing's row is the card's shape, not the runs card's");
  assert.doesNotMatch(JSON.stringify(out), /EVIDENCE-ONLY/);
});

test("readModulesChannels: a channel whose read throws ENOENT has no runs yet; one that throws anything else is unreadable; the others answer", async () => {
  const enoent = Object.assign(new Error("no analysis"), { code: "ENOENT" });
  const out = await readModulesChannels([cn-market row, s01 row, s02 row], async (dir) => {
    if (dir.endsWith("cn-market")) throw new Error("EACCES: permission denied");
    if (dir.endsWith("lunhui-s02-rotation")) throw enoent;
    return { runs: [], runsOmitted: 0, latestRun: null };
  });
  assert.deepEqual(out.map((c) => [c.channel, c.runs, c.unreadable === true]), [["cn-market", [], true], ["lunhui-s01-repair", [], false], ["lunhui-s02-rotation", [], false]]);
});

test("readModulesChannels: the cap is MODULES_RUNS_CAP", async () => {
  // 13 sealed runs in one strategy, a second apart
  const out = await readModulesChannels([that row]);
  assert.equal(out[0].runs.length, MODULES_RUNS_CAP);
  assert.equal(out[0].runsOmitted, 1);
  assert.equal(MODULES_RUNS_CAP, 12);
});

test("GET /data/modules.json: the fence, the shape, mounted from the dep; a reconcile failure is a fixed 500", async () => {
  // routesFor(root, home, { lunhuiMounted: () => true }) as tests/channels.test.ts registers routes
  const forged = fakeRes(); await route.handler(getReq("evil.example.com"), forged.res); assert.equal(forged.out.status, 403);
  const ok = fakeRes(); await route.handler(getReq("127.0.0.1:3090"), ok.res);
  const body = JSON.parse(ok.out.body);
  assert.equal(ok.out.status, 200);
  assert.equal(body.ok, true); assert.equal(body.mounted, true); assert.equal(body.root, root);
  assert.deepEqual(body.channels.map((c) => c.channel), ["cn-market", "lunhui-s01-repair"]);
  assert.ok(body.channels.every((c) => typeof c.workspaceId === "string" && c.workspaceId !== ""));
  // mounted false when the dep says so
  // a registry whose listing throws → 500 {ok:false, error:"listing failed"}
});

test("MARKET_CHANNEL is the freeze rows' MARKET_CHANNEL", async () => {
  const { MARKET_CHANNEL: rows } = await import("../plugins/lunhui/lib/freeze-tool.mjs");
  assert.equal(MARKET_CHANNEL, rows);
});
```

The sketches' rows come from one helper the test file defines: `channelRow(root: string, name: string, extra: Partial<ChannelRow> = {}): ChannelRow` → `{ workspaceId: \`ws-${name}\`, name, title: name, dir: name === WORKBENCH ? root : join(root, "strategies", name), isRoot: name === WORKBENCH, missingDir: false, sessionIds: [], ...extra }`; the runs are made with `openRun` / `addEvidence` / `sealRun` from `../plugins/lunhui/lib/runs.mjs` and artifacts written by hand and named in `run.json`, as `makeRun` in `tests/channels.test.ts` does (copy that helper rather than importing across test files). Write the sketches out in full.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/lunhui-modules-listing.test.ts tests/panels.test.ts`
Expected: FAIL — `readModulesChannels`, `MODULES_RUNS_CAP`, `MARKET_CHANNEL`, `lunhuiMounted` not exported; no `/data/modules.json` route.

- [ ] **Step 3: Implement** `lunhuiMounted` in `panels.ts`; in `channels.ts` the constants, the two interfaces, `readModulesChannels` (map each `RunRow` to a `ModuleRunRow`, dropping `bytes`, `sealed`, `snapshotId`, `kind`, `contractVersion`, `accepted`), the `lunhuiMounted` dep, and the route — `kind: "exact", path: "/data/modules.json"`, the same `send` helper and the same try/catch shape as `/data/channels.json`: `const { channels } = await reconcile(); send(res, 200, { ok: true, mounted: deps.lunhuiMounted(), root: deps.root, channels: await readModulesChannels(channels) })`. In `main.ts` pass `lunhuiMounted: () => lunhuiMounted(booted.ctx.loader.entries())` (the same `ctx.loader.entries()` `panelDeps` wraps; import `lunhuiMounted` from `./panels.ts`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/lunhui-modules-listing.test.ts tests/panels.test.ts tests/channels.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Document** — `DEVELOPMENT.md` §4.4: one row `| GET /data/modules.json | channels.ts | every channel but the root with its kind, workspaceId and its newest 12 runs (MODULES_RUNS_CAP): session, opened and sealed times, the frozen sources, each artifact's status, missing sources, headline and market run; mounted says whether include:lunhui-runs is active; a channel whose read fails is listed unreadable; the plan-1 backing of Discover's Research shelf (spec 2026-10-28) |`; §4.2 `channels.ts` row: name `readAnalysisRuns`'s cap, `readModulesChannels`; §7.3: the new test file in the suite list.

- [ ] **Step 6: Commit**

```bash
git add face/src/channels.ts face/src/panels.ts face/src/main.ts face/tests/lunhui-modules-listing.test.ts face/tests/panels.test.ts DEVELOPMENT.md
git commit -m "feat: GET /data/modules.json lists every channel's Lunhui runs for the module cards, with whether the rows are mounted"
```

---

### Task 3: The second protocol file and its section

**Files:**
- Create: `dsh/profile/lunhui-module.md`
- Modify: `face/src/protocols.ts`, `face/plugins/gravit.js` (the protocols loop, lines 263–270, and the exports), `face/src/roles.ts` (`GENERATED_HEADER`, line 321), `face/scripts/render-roles.ts` (doc comment)
- Regenerate: `bots/gravit/agent.cordis.yml`
- Test: `face/tests/protocols.test.ts`, `face/tests/gravit-plugin.test.ts`, `face/tests/roles.test.ts`
- Docs: `DEVELOPMENT.md` §3.1 (the mirror paragraph, line ~520), §4.2 (`protocols.ts` row, line ~860), §4.3 (line ~898), the prompt-section passage near line 1017, §7.3; `face/README.md` "Lunhui analysis" (lines ~416, ~532, ~578) and "Roles" (line ~2045); `Gravit-Docs-and-Prompt-Loops.html` (the sections table row at line ~151 and the list item at ~255); the spec's Appendix C (sync the shipped text and its byte count)

**Interfaces:**
- Consumes: `readProtocol`, `PROTOCOL_MAX_BYTES`, `PROTOCOLS_DIR` as they are; `plugins/gravit.js` `apply`'s `config.protocols` loop.
- Produces:
  - `export const LUNHUI_MODULE_FILE = "lunhui-module.md"; export const LUNHUI_MODULE_PATH = join(PROTOCOLS_DIR, LUNHUI_MODULE_FILE); export const LUNHUI_MODULE_SECTION = "lunhui:module"; export const LUNHUI_MODULE_MAX_BYTES = 1500;`
  - `readProtocols(dir = PROTOCOLS_DIR): Protocol[]` → `[{ name: "lunhui:run", probe: "lunhui_read_run", text }, { name: "lunhui:module", probe: "lunhui_read_run", text }]`, in that order.
  - `plugins/gravit.js`: `export const LUNHUI_MODULE_SECTION = "lunhui:module";` and each protocol's section `order: getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 60 + index` (index in `config.protocols`).

- [ ] **Step 1: Write the protocol file** `dsh/profile/lunhui-module.md`, exactly:

```
# 单模块请求

面从模块卡发来的消息写明：模块、频道、运行（已有运行或开新运行），策略模块还有 market_run 与可选代码。只做这一个模块，其余照 lunhui:run。

- cn-market 的 environment、sentiment、theme 调 role_cn_market_analyst，任务说明点名只写哪个模块；它没点名时会写三份。
- 开新运行（cn-market）：先按 lunhui:run 第 1 步冻结整套——运行一被角色读过即封存，不先冻整套，别的卡就不能再用它；再调角色只写所请求的模块。
- 已有运行：不再冻结，直接调角色。
- leader 开新运行：先调用 lunhui_freeze_quotes 开运行（代码用消息给的，没给就按 lunhui:run 第 2 步自选 1–4 只），再调 role_cn_stock_analyst 只写 leader。
- counterevidence 只在已有接受的 leader（策略频道）或至少一份市场工件（cn-market）的运行上调 role_cn_reviewer。
- mode 只在 leader 与反证都被接受后调 role_cn_stock_analyst；反证在 mode 之前，两者不并行。
- 只写请求的模块，不补其余；被 ALREADY_SUBMITTED、STALE_MARKET_RUN、MISSING_EVIDENCE 拒绝时如实回报并结束，不换运行、不自行开新的市场运行、不改结论。
- 最后的消息只报本模块的要点、是否 NOT_EVALUABLE 及缺哪些来源、行情是否 delayed。
```

Run: `wc -c dsh/profile/lunhui-module.md` — Expected: at most 1500 (the text above measures 1,372 bytes with a trailing newline).

- [ ] **Step 2: Write the failing tests**

`face/tests/protocols.test.ts` — change the `readProtocols` expectation to the two entries, and add:

```ts
test("the shipped lunhui-module.md reads, fits its own budget under the loader's, is Chinese, and states the single-module rules", () => {
  const bytes = readFileSync(LUNHUI_MODULE_PATH).length;
  assert.ok(bytes <= LUNHUI_MODULE_MAX_BYTES, `lunhui-module.md is ${bytes} bytes; its budget is ${LUNHUI_MODULE_MAX_BYTES}`);
  assert.equal(LUNHUI_MODULE_MAX_BYTES, 1500);
  assert.ok(LUNHUI_MODULE_MAX_BYTES < PROTOCOL_MAX_BYTES);
  const text = readProtocol(LUNHUI_MODULE_PATH);
  assert.ok(/[一-鿿]/.test(text) && !text.includes("{{"));
  for (const word of ["只做这一个模块", "lunhui:run", "role_cn_market_analyst", "点名只写", "没点名", "封存", "lunhui_freeze_quotes", "role_cn_stock_analyst", "role_cn_reviewer", "反证在 mode 之前", "ALREADY_SUBMITTED", "STALE_MARKET_RUN", "MISSING_EVIDENCE", "不自行开新的市场运行", "NOT_EVALUABLE", "delayed"]) assert.ok(text.includes(word), `carries ${word}`);
  const at = (w: string) => text.indexOf(w);
  assert.ok(at("counterevidence 只在") < at("mode 只在"), "the reviewer's rule before the mode's");
  assert.ok(at("开新运行（cn-market）") < at("已有运行："), "a new run's freeze rule before the existing-run rule");
});

test("the module protocol's budget is its own, under the loader's: 1,500 bytes read, 1,501 still read by the loader but failed by the budget check", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-module-protocol-"));
  try {
    const at = join(dir, "lunhui-module.md"); await writeFile(at, "运".repeat(LUNHUI_MODULE_MAX_BYTES / 3));
    assert.equal(readProtocol(at).length, LUNHUI_MODULE_MAX_BYTES / 3);
    const over = join(dir, "over.md"); await writeFile(over, "运".repeat(LUNHUI_MODULE_MAX_BYTES / 3) + "\n");
    assert.equal(readProtocol(over).length, LUNHUI_MODULE_MAX_BYTES / 3, "the loader admits it (under 3,000)");
    assert.ok(readFileSync(over).length > LUNHUI_MODULE_MAX_BYTES, "and the budget check is what refuses it");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

Generalise the two existing loops — "every lunhui_* tool … names is a tool the Lunhui rows register" and "every role_* tool … is a role the shipped library has" — over `[LUNHUI_RUN_PATH, LUNHUI_MODULE_PATH]`; extend "the section name is the same in src/protocols.ts and plugins/gravit.js" to the module section (`LUNHUI_MODULE_SECTION` from both); in the `readProtocols(dir)` fixture test write both files into the temp dir and expect both entries, and expect the missing-file refusal to name `lunhui-run.md` when neither exists and `lunhui-module.md` when only the run file is there.

`face/tests/gravit-plugin.test.ts` — in the protocol section test, apply with two protocols `[PROTOCOL, { name: "lunhui:module", probe: "lunhui_read_run", text: "# 单模块" }]` and assert the second section's `order` equals the first's plus one and still precedes the cycle; both gated alike (the same `textFor` matrix on the second).

`face/tests/roles.test.ts` line 241: add `assert.match(mirror, /^ {6}- name: lunhui:module\n {8}probe: lunhui_read_run\n/m, "and the module protocol")` and `assert.ok(mirror.includes("lunhui-module.md"))`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/protocols.test.ts tests/gravit-plugin.test.ts tests/roles.test.ts`
Expected: FAIL — the new exports are missing; `readProtocols` returns one entry; the mirror lacks the second protocol.

- [ ] **Step 4: Implement** — `protocols.ts`: the four exports and the two-entry `readProtocols`; its module comment says two ship. `plugins/gravit.js`: the export and `- 60 + index` in the loop (`for (const [index, protocol] of (config.protocols ?? []).entries())`), the comment above it amended ("ten before the cycle, in their listed order"). `roles.ts`: `GENERATED_HEADER` names `dsh/profile/lunhui-run.md and lunhui-module.md` (both lines). `scripts/render-roles.ts`: the doc comment likewise. Then regenerate: `cd face && npm run render:roles`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/protocols.test.ts tests/gravit-plugin.test.ts tests/roles.test.ts && npm run typecheck`
Expected: PASS; `git diff --stat bots/gravit/agent.cordis.yml` shows the second protocol block added and nothing else changed.

- [ ] **Step 6: Document** — `DEVELOPMENT.md` §3.1: the mirror embeds "the two run protocols as its `protocols`"; §4.2 `protocols.ts`: `readProtocols` reads `lunhui-run.md` and `lunhui-module.md`, `LUNHUI_MODULE_MAX_BYTES` 1,500 pinned by test under the 3,000 loader cap; §4.3: "rendered from `roles/`, `dsh/profile/cycle.md`, `lunhui-run.md` and `lunhui-module.md`"; the prompt-section passage (~1017): `lunhui:module` one step after `lunhui:run`, its bytes; §7.3: the protocol tests' new cases. `face/README.md`: "Lunhui analysis" — after the `lunhui:run` paragraph, one paragraph: `lunhui:module` (`../dsh/profile/lunhui-module.md`, ≤ 1,500 bytes) tells Gravit how to run one module on a card's message: a new market run freezes the whole set first, the reviewer before the mode, a refusal it cannot cure is reported and the message ends; "Editing either protocol file or a role means `npm run render:roles`, `npm test` and a restart". `Gravit-Docs-and-Prompt-Loops.html`: a row for `dsh/profile/lunhui-module.md` under the sections table (bytes / 1,500, the same readers as `lunhui:run`, order one after it) and a list item beside `lunhui-run.md`'s (Chinese, in the page's own style). The spec's Appendix C: replace the draft with the shipped text and its measured bytes.

- [ ] **Step 7: Commit**

```bash
git add dsh/profile/lunhui-module.md face/src/protocols.ts face/plugins/gravit.js face/src/roles.ts face/scripts/render-roles.ts bots/gravit/agent.cordis.yml face/tests/protocols.test.ts face/tests/gravit-plugin.test.ts face/tests/roles.test.ts DEVELOPMENT.md face/README.md Gravit-Docs-and-Prompt-Loops.html docs/superpowers/specs/2026-10-28-lunhui-module-cards-design.md
git commit -m "feat: the lunhui:module protocol section teaches Gravit a single-module request, one order step after lunhui:run"
```

---

### Task 4: The market analyst takes a one-module brief

**Files:**
- Modify: `roles/cn-market-analyst/ROLE.md` (1,450 bytes today, cap 2,000), `roles/cn-market-analyst/role.yml` (`description`)
- Regenerate: `bots/gravit/agent.cordis.yml`
- Test: `face/tests/roles.test.ts` (the cn-market-analyst test at line 70)
- Docs: `DEVELOPMENT.md` §3.8 (the `cn-market-analyst` passage, line ~439); `face/README.md` "Roles" (the cn-market-analyst line)

**Interfaces:**
- Consumes: `readRoles`, `ROLES_ROOT`, `MARKET_ANALYST_ALLOW` as the test has them.
- Produces: the persona sentence and the description clause below; nothing in code.

- [ ] **Step 1: Write the failing test** — extend the cn-market-analyst test in `face/tests/roles.test.ts`:

```ts
  assert.ok(persona.includes("点名只写") && persona.includes("只做那一个模块") && persona.includes("没有点名"), "a brief that names one module gets that module alone; an unnamed brief the three (spec 2026-10-28 F6)");
  assert.ok(at("按顺序做三个模块") < at("点名只写"), "the order first, the exception after it");
  const role = readRoles(ROLES_ROOT).find((r) => r.id === "cn-market-analyst")!;
  assert.ok(role.description.includes("or the one module the brief names"), "the summary Gravit reads says so too");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd face && npx tsx --test tests/roles.test.ts`
Expected: FAIL on the three new assertions.

- [ ] **Step 3: Edit the role** — `ROLE.md`: after the paragraph that begins `按顺序做三个模块` (ending `…不写进消息。…`), insert as its own paragraph:

```
Gravit 的任务说明点名只写环境、情绪或题材中的某一个模块时，只做那一个模块，读它的上下文、提交它的工件，其余两个不读不写；没有点名时照上面的顺序做三个。
```

`role.yml` `description`, one line: `Reads one frozen cn-market run's environment, sentiment and theme contexts, in that order, or the one module the brief names, and submits each module's validated artifact through its submit tool.` Then `cd face && npm run render:roles`.

Run: `wc -c ../roles/cn-market-analyst/ROLE.md` — Expected: at most 2000.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/roles.test.ts tests/protocols.test.ts && npm run typecheck`
Expected: PASS (the order assertions still hold: the sentence names no tool).

- [ ] **Step 5: Document** — `DEVELOPMENT.md` §3.8 `cn-market-analyst` passage: one sentence, "since spec 2026-10-28 F6 a brief that names one of its three modules gets that module alone; the chain's brief names none"; `face/README.md` "Roles": the same in one clause on the cn-market-analyst line.

- [ ] **Step 6: Commit**

```bash
git add roles/cn-market-analyst/ROLE.md roles/cn-market-analyst/role.yml bots/gravit/agent.cordis.yml face/tests/roles.test.ts DEVELOPMENT.md face/README.md
git commit -m "feat: the market analyst writes the one module a brief names, the three when none is named"
```

---

### Task 5: The whole suite, the smokes, the spec's build note

**Files:**
- Modify: `docs/superpowers/specs/2026-10-28-lunhui-module-cards-design.md` (a "Build notes, plan 1" section at the end, as the 10-25 spec keeps them)

- [ ] **Step 1: Run the face suite and the typecheck**

Run: `cd face && npm test && npm run typecheck`
Expected: every test passes, `tsc` silent.

- [ ] **Step 2: Run the Lunhui smokes on a real boot** (offline, no keys)

Run: `cd face && FACE_SMOKE=1 npx tsx --test tests/lunhui-market-run-smoke.test.ts tests/lunhui-strategy-run-smoke.test.ts tests/roles-smoke.test.ts tests/instructions-smoke.test.ts`
Expected: PASS — the chain's fixture runs still land their artifacts; the roles smoke sees the edited persona; the prompt carries both sections for a root session.

- [ ] **Step 3: Write the build note** — a short section "## 12. Build notes, plan 1 (2026-10-2x)" in the spec: the commits, the measured byte counts (`lunhui-module.md`, `ROLE.md`), anything the plan left to the builder that was decided, and nothing else.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-28-lunhui-module-cards-design.md
git commit -m "docs: plan 1 build notes for the Lunhui module cards"
```
