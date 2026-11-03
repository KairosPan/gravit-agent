/**
 * The Lunhui rows (modules spec §5.2, §5.7, A1, A7, A23): the backbone row `lunhui-runs`, its
 * `lunhuiRuns` service and its one tool `lunhui_read_run`, and the refusal helpers every row shares
 * (`lib/errors.mjs`). The row is mounted on a stand-in scope, as tests/gravit-plugin.test.ts mounts
 * `gravit.js`, extended with `provide` and `tools.register`; every case builds its own strategies
 * root under `mkdtemp` and removes it when the case ends.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fsPromises, { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVIDENCE_CACHE_RUNS, apply, createLunhuiRuns, inject, name } from "../plugins/lunhui/runs-row.mjs";
import { MODULES } from "../plugins/lunhui/lib/modules.mjs";
import { MODULE_BUDGET, asToolError, callerIsChild, callerIsRole, refuse, upstreamError } from "../plugins/lunhui/lib/errors.mjs";
import { repairFor } from "../plugins/lunhui/lib/contract-core.mjs";
import { LunhuiError, RUN_ID_RE, badRunId } from "../plugins/lunhui/lib/runs.mjs";
import * as environmentRow from "../plugins/lunhui/environment-row.mjs";
import * as sentimentRow from "../plugins/lunhui/sentiment-row.mjs";
import * as themeRow from "../plugins/lunhui/theme-row.mjs";
import * as leaderRow from "../plugins/lunhui/leader-row.mjs";
import * as modeRow from "../plugins/lunhui/mode-row.mjs";
import * as reviewRow from "../plugins/lunhui/review-row.mjs";
import * as indexRow from "../plugins/lunhui/freeze-index-row.mjs";
import * as limitUpRow from "../plugins/lunhui/freeze-limit-up-row.mjs";
import { createFixtureFetch } from "../plugins/lunhui/lib/fixture-fetch.mjs";
import { fetchLimitUpPools } from "../plugins/lunhui/lib/eastmoney.mjs";
import { promotion } from "../plugins/lunhui/lib/derive.mjs";
import { viewDigest } from "../plugins/lunhui/lib/view.mjs";
import { LUNHUI_ROW_IDS, LUNHUI_TOOL_NAMES } from "../src/lunhui.ts";

type Cleanup = { after(fn: () => Promise<unknown>): unknown };

/** A strategies root holding `alpha` and `beta`, each with its THESIS.md, removed when the case ends. */
async function strategiesRoot(t: Cleanup): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lunhui-rows-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const strategy of ["alpha", "beta"]) {
    await mkdir(join(root, strategy));
    await writeFile(join(root, strategy, "THESIS.md"), `# ${strategy}\n`);
  }
  return root;
}

type ToolDef = { name: string; description: string; parameters: unknown; execute(args: unknown, exec: unknown): Promise<string> };

/** A stand-in scope: `provide` records `[name, value]`, `tools.register` records the definition,
 *  each returning a disposer that removes it; `effect` runs `fn` and keeps its disposer. */
function fakeScope() {
  const provided: Array<[string, any]> = [];
  const tools: ToolDef[] = [];
  const disposers: Array<() => unknown> = [];
  const ctx = {
    effect(fn: () => unknown) { const d = fn(); assert.equal(typeof d, "function"); disposers.push(d as () => unknown); return d; },
    provide(key: string, value: unknown) {
      const entry: [string, unknown] = [key, value];
      provided.push(entry);
      return () => { provided.splice(provided.indexOf(entry), 1); };
    },
    tools: {
      register(def: ToolDef) {
        tools.push(def);
        return () => { tools.splice(tools.indexOf(def), 1); };
      },
    },
  };
  return { ctx, provided, tools, unload: () => { for (const d of disposers.splice(0).reverse()) d(); } };
}

/** The row mounted over `root`: its service and its tool. */
function mounted(root: string) {
  const scope = fakeScope();
  apply(scope.ctx, { strategiesRoot: root });
  const [[, service]] = scope.provided;
  const [tool] = scope.tools;
  return { scope, service, tool };
}

/** An `exec` as dsh hands a tool: the caller's session header, a root session's by default. */
function fakeExec(header: Record<string, unknown> = {}) {
  return { agent: { session: { header } }, signal: new AbortController().signal };
}

const META = { received_at: "2026-10-23T07:00:00.000Z", session: "2026-10-23", host: "qt.gtimg.cn", delayed: false, truncated: false };

/** Asserts `promise` rejects with a `LunhuiError` of `code`; returns the refusal. */
async function rejectsWith(promise: Promise<unknown>, code: string): Promise<LunhuiError> {
  let refusal: any;
  await assert.rejects(promise, (error: any) => {
    assert.ok(error instanceof LunhuiError, `a LunhuiError, not ${error}`);
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(`^${code}: `));
    refusal = error;
    return true;
  });
  return refusal;
}

/** Name `modules` in the run's `run.json` `artifacts[]`, as a submit would. */
async function nameArtifacts(dir: string, modules: string[]) {
  const manifest = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
  await writeFile(join(dir, "run.json"), JSON.stringify({ ...manifest, artifacts: modules }));
}

test("lunhui-runs: name and inject; apply refuses a bad strategiesRoot with its reason", async (t) => {
  assert.equal(name, "lunhui-runs");
  assert.deepEqual(inject, ["tools"]);
  const reason = { message: "lunhui-runs: strategiesRoot must be an absolute path to an existing directory" };
  const root = await strategiesRoot(t);
  for (const config of [undefined, {}, { strategiesRoot: "" }, { strategiesRoot: "strategies" }, { strategiesRoot: join(root, "missing") }, { strategiesRoot: join(root, "alpha", "THESIS.md") }]) {
    const scope = fakeScope();
    assert.throws(() => apply(scope.ctx, config as any), reason);
    assert.equal(scope.provided.length + scope.tools.length, 0);
  }
});

test("lunhui-runs: apply provides lunhuiRuns once and registers exactly lunhui_read_run; unload disposes both", async (t) => {
  const root = await strategiesRoot(t);
  const scope = fakeScope();
  apply(scope.ctx, { strategiesRoot: root });
  assert.deepEqual(scope.provided.map(([key]) => key), ["lunhuiRuns"]);
  assert.equal(scope.provided[0][1].strategiesRoot, root);
  assert.deepEqual(scope.tools.map((tool) => tool.name), ["lunhui_read_run"]);
  const [tool] = scope.tools;
  assert.equal(tool.description, READ_RUN_DESCRIPTION);
  assert.deepEqual((tool.parameters as any).required, ["strategy"], "run is optional");
  assert.deepEqual(Object.keys((tool.parameters as any).properties), ["strategy", "run"]);
  scope.unload();
  assert.equal(scope.provided.length, 0);
  assert.equal(scope.tools.length, 0);
});

test("lunhui-runs: the service opens, adds, seals and reads a run under the root, and refuses a strategy outside it", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  assert.deepEqual(await service.resolveStrategy("alpha"), { name: "alpha" });
  const opened = await service.openRun("alpha", "strategy");
  assert.deepEqual(Object.keys(opened).sort(), ["run", "strategy"]);
  assert.equal(opened.strategy, "alpha");
  const { run } = opened;
  const added = await service.addEvidence("alpha", run, "quotes", [{ symbol: "sh600000", price: 10 }], META);
  assert.equal(added.ids.length, 1);
  const onDisk = JSON.parse(await readFile(join(root, "alpha", "analysis", run, "evidence-quotes.json"), "utf8"));
  assert.equal(onDisk.items[0].id, added.ids[0]);
  const sealed = await service.sealRun("alpha", run);
  assert.match(sealed.snapshot_id, /^snap_[0-9a-f]{64}$/);
  await rejectsWith(service.addEvidence("alpha", run, "index", [], META), "RUN_SEALED");
  const read = await service.readRun("alpha", run);
  assert.equal(read.manifest.run, run);
  assert.equal(read.manifest.evidence.length, 1);
  assert.equal(read.metricsReset, false);
  // Names, never paths: another strategy's run, a path-like name, a run id that is a path.
  await rejectsWith(service.readRun("beta", run), "NO_SUCH_RUN");
  await rejectsWith(service.readRun("../alpha", run), "NOT_A_STRATEGY");
  await rejectsWith(service.openRun(join(root, "alpha"), "strategy"), "NOT_A_STRATEGY");
  await rejectsWith(service.readRun("alpha", `../${run}`), "BAD_RUN_ID");
});

test("lunhui-runs: withRun serializes two callers on one run", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "strategy");
  const { run: other } = await service.openRun("alpha", "strategy");
  const order: string[] = [];
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  const first = service.withRun("alpha", run, async () => { order.push("first:start"); firstStarted(); await firstHeld; order.push("first:end"); return 1; });
  // The second arrives while the first holds the run.
  await started;
  const second = service.withRun("alpha", run, async () => { order.push("second:start"); return 2; });
  // Another run of the strategy is its own key and does not wait.
  assert.equal(await service.withRun("alpha", other, async () => { order.push("other"); return 3; }), 3);
  // Give the second every chance to enter: it resolves the run, then must wait.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(order, ["first:start", "other"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ["first:start", "other", "first:end", "second:start"]);
  // A caller that throws releases the run for the next.
  await assert.rejects(service.withRun("alpha", run, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await service.withRun("alpha", run, async () => 4), 4);
  await rejectsWith(service.withRun("alpha", "nope", async () => 0), "NO_SUCH_RUN");
});

test("lunhui-runs: countFreeze throws TOOL_BUDGET on the ninth call and persists the count; a deleted metrics.json restarts the count at zero", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "strategy");
  const metricsFile = join(root, "alpha", "analysis", run, "metrics.json");
  for (let i = 1; i <= 8; i++) await service.countFreeze("alpha", run);
  assert.equal(JSON.parse(await readFile(metricsFile, "utf8")).freezes, 8);
  await rejectsWith(service.countFreeze("alpha", run), "TOOL_BUDGET");
  assert.equal(JSON.parse(await readFile(metricsFile, "utf8")).freezes, 9);
  assert.equal((await service.readRun("alpha", run)).metrics.freezes, 9);
  await rm(metricsFile);
  await service.countFreeze("alpha", run);
  const restarted = JSON.parse(await readFile(metricsFile, "utf8"));
  assert.equal(restarted.freezes, 1);
  assert.deepEqual(restarted, { freezes: 1, calls: {}, rejections: {}, submitted: [] });
});

test("errors: upstreamError maps stage 0's provider codes to UPSTREAM_TIMEOUT, UPSTREAM_TOO_LARGE and UPSTREAM_INVALID, names the provider, and never a path", (t) => {
  const stderr: string[] = [];
  t.mock.method(process.stderr, "write", (chunk: string) => { stderr.push(String(chunk)); return true; });
  const coded = (code: string) => Object.assign(new Error(`failed at /Users/someone/strategies/${code}`), { code });
  const cases: Array<[unknown, string]> = [
    [coded("PROVIDER_TIMEOUT"), "UPSTREAM_TIMEOUT"],
    [coded("RESPONSE_TOO_LARGE"), "UPSTREAM_TOO_LARGE"],
    [coded("PROVIDER_HTTP_ERROR"), "UPSTREAM_INVALID"],
    [coded("INVALID_RESPONSE"), "UPSTREAM_INVALID"],
    [coded("INVALID_ENCODING"), "UPSTREAM_INVALID"],
    [coded("PROVIDER_ERROR"), "UPSTREAM_INVALID"],
    [coded("INVALID_CONTEXT"), "UPSTREAM_INVALID"],
    [new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) }), "UPSTREAM_INVALID"],
  ];
  for (const provider of ["腾讯行情", "东方财富"] as const) {
    for (const [error, code] of cases) {
      const refusal = upstreamError(error, provider);
      assert.ok(refusal instanceof LunhuiError);
      assert.equal(refusal.code, code);
      assert.match(refusal.message, new RegExp(`^${code}: ${provider}`));
      assert.doesNotMatch(refusal.message, /\/|Users|strategies/);
    }
  }
  assert.match(upstreamError(coded("PROVIDER_HTTP_ERROR"), "东方财富")!.message, /PROVIDER_HTTP_ERROR/);
  // The uncoded fetch failure's detail goes to stderr, never into the refusal.
  assert.equal(stderr.length, 2);
  assert.match(stderr[0], /fetch failed; cause: connect ECONNREFUSED \(ECONNREFUSED\)/);
  // normalizeQuotes' code-less no-quote errors are NO_MARKET_DATA, naming the provider, with no stderr line.
  for (const provider of ["腾讯行情", "东方财富"] as const) {
    for (const message of ["Invalid response", "Empty response", "No usable quotes"]) {
      const refusal = upstreamError(new Error(message), provider)!;
      assert.equal(refusal.code, "NO_MARKET_DATA");
      assert.match(refusal.message, new RegExp(`^NO_MARKET_DATA: ${provider}`));
    }
  }
  assert.equal(stderr.length, 2);
  // The Account's own failure names the Account, not the provider's fault; its detail goes to stderr.
  for (const provider of ["腾讯行情", "东方财富", "同花顺问财"] as const) {
    const down = Object.assign(new Error("the Account at http://127.0.0.1:4820 did not answer"), { code: "ACCOUNT_UNAVAILABLE" });
    const refusal = upstreamError(down, provider)!;
    assert.equal(refusal.code, "UPSTREAM_INVALID");
    assert.match(refusal.message, new RegExp(`^UPSTREAM_INVALID: ${provider}请求未完成：转发它的 Account 未应答或拒绝转发`));
    assert.match(refusal.message, new RegExp(`不是${provider}的故障`));
    assert.doesNotMatch(refusal.message, /127\.0\.0\.1|\//);
  }
  assert.equal(stderr.length, 5);
  assert.match(stderr[4], /the Account did not relay a 同花顺问财 request: the Account at http:\/\/127\.0\.0\.1:4820 did not answer/);
  // Another coded error is the host's own fault: null, which the caller rethrows as INTERNAL.
  assert.equal(upstreamError(coded("INVALID_NOW"), "腾讯行情"), null);
  // A refusal already made passes through; an unknown provider is host code's bug.
  const sealed = refuse.runSealed();
  assert.equal(upstreamError(sealed, "腾讯行情"), sealed);
  assert.throws(() => upstreamError(coded("PROVIDER_TIMEOUT"), "新浪" as any), TypeError);
});

test("errors: asToolError passes a LunhuiError through and turns anything else into INTERNAL, its detail on stderr only", (t) => {
  const stderr: string[] = [];
  t.mock.method(process.stderr, "write", (chunk: string) => { stderr.push(String(chunk)); return true; });
  const refusal = refuse.badRunId();
  assert.equal(asToolError(refusal), refusal);
  const internal = asToolError(new Error("ENOENT: /Users/someone/strategies/alpha/run.json"));
  assert.ok(internal instanceof LunhuiError);
  assert.equal(internal.code, "INTERNAL");
  assert.doesNotMatch(internal.message, /\/|Users|ENOENT/);
  assert.equal(stderr.length, 1);
  assert.match(stderr[0], /ENOENT: \/Users\/someone/);
});

test("errors: the refusal table opens each message with its code word and names no path", () => {
  const codes: Record<string, string> = {
    notAStrategy: "NOT_A_STRATEGY", badRunId: "BAD_RUN_ID", noSuchRun: "NO_SUCH_RUN", runSealed: "RUN_SEALED",
    sourceFrozen: "SOURCE_FROZEN", toolBudget: "TOOL_BUDGET", notGravit: "NOT_GRAVIT", notARole: "NOT_A_ROLE",
    calendarUncovered: "CALENDAR_UNCOVERED", internal: "INTERNAL", noMarketData: "NO_MARKET_DATA",
    otherSession: "NO_MARKET_DATA", noMarketMove: "NO_MARKET_DATA", wrongChannel: "WRONG_CHANNEL", symbolShape: "INVALID_SYMBOL", symbolDuplicate: "INVALID_SYMBOL",
    symbolSet: "INVALID_SYMBOL", symbolMix: "INVALID_SYMBOL", boardShape: "INVALID_SYMBOL",
    readFirst: "READ_FIRST", alreadySubmitted: "ALREADY_SUBMITTED", moduleBudget: "TOOL_BUDGET", rejected: "INVALID_ANALYSIS",
    staleMarketRun: "STALE_MARKET_RUN", missingEvidence: "MISSING_EVIDENCE", marketRunDiffers: "MISSING_EVIDENCE",
    marketRunMissing: "MISSING_EVIDENCE", notMarketRun: "NOT_A_MARKET_RUN", invalidPresent: "INVALID_PRESENT",
  };
  assert.deepEqual(Object.keys(refuse).sort(), Object.keys(codes).sort());
  // One text per code: the rows' BAD_RUN_ID is runs.mjs's own, naming the new tools.
  assert.equal(refuse.badRunId().message, badRunId().message);
  assert.ok(RUN_ID_RE.test("20261023T070000Z-0a1b2c3d"));
  assert.match(refuse.badRunId().message, /lunhui_read_run/);
  assert.doesNotMatch(refuse.badRunId().message, /freeze_market_snapshot/);
  for (const [key, code] of Object.entries(codes)) {
    const error = (refuse as any)[key]("腾讯行情");
    assert.ok(error instanceof LunhuiError);
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(`^${code}: \\S`));
    assert.doesNotMatch(error.message, /\//);
  }
});

test("errors: the module refusals name the module; a rejection carries its category and repair; the module budget is ten", () => {
  assert.equal(MODULE_BUDGET, 10);
  assert.match(refuse.readFirst("environment").message, /^READ_FIRST: .*environment.*lunhui_read_environment_context/);
  assert.match(refuse.alreadySubmitted("theme").message, /^ALREADY_SUBMITTED: .*theme/);
  const budget = refuse.moduleBudget("sentiment").message;
  assert.match(budget, /^TOOL_BUDGET: .*sentiment/);
  assert.match(budget, /10/);
  assert.match(budget, /停止/);
  assert.match(budget, /blocked/);
  const rejected = refuse.rejected("SCHEMA", "analysis.status must be one of OK, NOT_EVALUABLE", "按 schema 修正。");
  assert.equal(rejected.code, "INVALID_ANALYSIS");
  assert.equal(rejected.message, "INVALID_ANALYSIS: [SCHEMA] analysis.status must be one of OK, NOT_EVALUABLE\n修复：按 schema 修正。");
});

test("errors: STALE_MARKET_RUN names both sessions and the rule; MISSING_EVIDENCE names what is unsealed; neither names a path", () => {
  const stale = refuse.staleMarketRun("2026-10-23", "2026-10-21").message;
  assert.match(stale, /^STALE_MARKET_RUN: /);
  assert.match(stale, /2026-10-23/);
  assert.match(stale, /2026-10-21/);
  assert.match(stale, /前一个交易日/);
  assert.match(refuse.staleMarketRun(null, null).message, /^STALE_MARKET_RUN: .*无/);
  const missing = refuse.missingEvidence("引用的运行").message;
  assert.match(missing, /^MISSING_EVIDENCE: 引用的运行/);
  assert.match(missing, /封存/);
  // Leader and mode on two market runs: the leader's run named, the rule stated.
  const differs = refuse.marketRunDiffers("20261023T070000Z-0a1b2c3d").message;
  assert.match(differs, /^MISSING_EVIDENCE: .*20261023T070000Z-0a1b2c3d/);
  assert.match(differs, /同一个市场运行/);
  for (const message of [stale, missing, differs]) assert.doesNotMatch(message, /\/|\\/);
});

/* R44: a role child composes its own role-<id> preset (D20/B1); a plain `subagent` child joins Gravit's. */
test("errors: callerIsRole is callerIsChild on a role- preset alone", () => {
  assert.equal(callerIsRole(fakeExec({ origin: "subagent", agentPreset: "role-cn-reviewer" })), true);
  assert.equal(callerIsRole(fakeExec({ origin: "subagent", agentPreset: "gravit" })), false, "a plain subagent child of Gravit is no role");
  assert.equal(callerIsRole(fakeExec({ origin: "subagent" })), false, "nor a child with no preset recorded");
  assert.equal(callerIsRole(fakeExec({ origin: "subagent", isSeeded: true, agentPreset: "role-cn-reviewer" })), false, "nor a seeded fork");
  assert.equal(callerIsRole(fakeExec({ agentPreset: "role-cn-reviewer" })), false, "nor a root session");
  assert.equal(callerIsRole(fakeExec()), false);
  assert.equal(callerIsRole(undefined), false);
});

test("errors: callerIsChild is true for a delegated child alone, never for a root or a seeded fork", () => {
  assert.equal(callerIsChild(fakeExec()), false);
  assert.equal(callerIsChild(fakeExec({ origin: "subagent", isSeeded: true })), false);
  assert.equal(callerIsChild(fakeExec({ origin: "subagent" })), true);
  assert.equal(callerIsChild(fakeExec({ origin: "subagent", isSeeded: false })), true);
  assert.equal(callerIsChild(undefined), false);
  assert.equal(callerIsChild({}), false);
});

test("modules: the six modules in order, each with its file and its headline fields", () => {
  assert.deepEqual(MODULES.map((module: any) => module.name), ["environment", "sentiment", "theme", "leader", "mode", "counterevidence"]);
  for (const module of MODULES as any[]) assert.equal(module.file, `${module.name}.json`);
  assert.deepEqual(Object.fromEntries((MODULES as any[]).map((module) => [module.name, module.headline])), {
    environment: ["index_state", "liquidity_state", "cycle_anchor"],
    sentiment: ["state", "money_effect", "freeze_type"],
    theme: ["mainline_candidates", "theme_stage", "rotation"],
    leader: ["leader_candidates", "top_pattern_flags"],
    mode: ["mode", "preconditions", "research_only_matches", "expectation", "expectation_review"],
    counterevidence: ["items"],
  });
});

test("lunhui_read_run: returns the manifest, the metrics and an empty artifacts list; a bad run id is BAD_RUN_ID; a path-like strategy is NOT_A_STRATEGY", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tool } = mounted(root);
  const { run } = await service.openRun("alpha", "strategy");
  await service.countFreeze("alpha", run);
  const text = await tool.execute({ strategy: "alpha", run }, fakeExec());
  const body = JSON.parse(text);
  assert.equal(body.manifest.run, run);
  assert.equal(body.manifest.strategy, "alpha");
  assert.equal(body.metrics.freezes, 1);
  assert.deepEqual(body.artifacts, []);
  assert.doesNotMatch(text, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await rejectsWith(tool.execute({ strategy: "alpha", run: "../x" }, fakeExec()), "BAD_RUN_ID");
  await rejectsWith(tool.execute({ strategy: "../alpha", run }, fakeExec()), "NOT_A_STRATEGY");
  await rejectsWith(tool.execute({ strategy: "beta", run }, fakeExec()), "NO_SUCH_RUN");
  // defineTool validates the arguments before execute.
  await assert.rejects(tool.execute({ run }, fakeExec()));
});

test("lunhui_read_run: an artifact present lists its headline; one that does not parse or is over 24 KiB lists unaccepted", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tool } = mounted(root);
  const { run } = await service.openRun("alpha", "strategy");
  const dir = join(root, "alpha", "analysis", run);
  await nameArtifacts(dir, ["sentiment", "theme", "leader"]);
  await writeFile(join(dir, "sentiment.json"), JSON.stringify({ state: "REPAIR", money_effect: "weak", freeze_type: null, claims: [] }));
  await writeFile(join(dir, "theme.json"), "{ not json");
  await writeFile(join(dir, "leader.json"), JSON.stringify({ leader_candidates: [], filler: "x".repeat(25 * 1024) }));
  const body = JSON.parse(await tool.execute({ strategy: "alpha", run }, fakeExec()));
  assert.deepEqual(body.artifacts, [
    { module: "sentiment", accepted: true, headline: { state: "REPAIR", money_effect: "weak", freeze_type: null } },
    { module: "theme", accepted: false, headline: null },
    { module: "leader", accepted: false, headline: null },
  ]);
});

test("lunhui_read_run: a module file run.json does not name in artifacts lists unaccepted, whatever it holds", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tool } = mounted(root);
  const { run } = await service.openRun("alpha", "strategy");
  const dir = join(root, "alpha", "analysis", run);
  await nameArtifacts(dir, ["sentiment"]);
  await writeFile(join(dir, "environment.json"), JSON.stringify({ index_state: "UP", liquidity_state: "LOOSE", cycle_anchor: null }));
  await writeFile(join(dir, "sentiment.json"), JSON.stringify({ state: "REPAIR" }));
  const body = JSON.parse(await tool.execute({ strategy: "alpha", run }, fakeExec()));
  assert.deepEqual(body.artifacts, [
    { module: "environment", accepted: false, headline: null },
    { module: "sentiment", accepted: true, headline: { state: "REPAIR" } },
  ]);
});

test("lunhui_read_run: an unexpected failure is INTERNAL, its detail on stderr only", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tool } = mounted(root);
  const { run } = await service.openRun("alpha", "strategy");
  const stderr: string[] = [];
  t.mock.method(process.stderr, "write", (chunk: string) => { stderr.push(String(chunk)); return true; });
  t.mock.method(service, "readRun", async () => { throw new Error(`EACCES: ${root}`); });
  await rejectsWith(tool.execute({ strategy: "alpha", run }, fakeExec()), "INTERNAL");
  assert.equal(stderr.length, 1);
  assert.match(stderr[0], /EACCES/);
});

const READ_RUN_DESCRIPTION = "读取研究运行，参数是策略名与运行编号，不是路径。带 run：返回该运行的清单、计数与各模块工件的要点。不带 run：列出该策略最近至多 5 个已封存的运行（运行编号、session、sealed_at、snapshot_id、已接受的工件），新的在前，用来找当日或前一个交易日的 cn-market 运行。带 run 时另附 view：face 画图用的同一份数字的摘要；作答时标题与结论里的数字只取自这里。";

/** Seal `run` of `strategy` with one evidence entry of `session`, naming `artifacts` accepted. */
async function sealedRun(root: string, service: any, strategy: string, session: string, artifacts: string[] = []) {
  const { run } = await service.openRun(strategy, "market");
  await service.addEvidence(strategy, run, "index", [{ code: "000001" }], { ...META, session });
  await service.sealRun(strategy, run);
  if (artifacts.length > 0) await nameArtifacts(join(root, strategy, "analysis", run), artifacts);
  return run as string;
}

test("lunhui_read_run without run: the newest five sealed runs by run id, newest first; open and unusable runs passed over", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tool } = mounted(root);
  assert.deepEqual(JSON.parse(await tool.execute({ strategy: "alpha" }, fakeExec())), { strategy: "alpha", runs: [] }, "no analysis/ yet");
  const sealed: string[] = [];
  for (let day = 20; day <= 26; day += 1) sealed.push(await sealedRun(root, service, "alpha", `2026-10-${day}`));
  // Runs of one second order by their random hex, so the newest by run id is found, not assumed.
  const newest = [...sealed].sort().reverse().slice(0, 5);
  await nameArtifacts(join(root, "alpha", "analysis", newest[0]), ["environment", "theme"]);
  const { run: open } = await service.openRun("alpha", "market");
  // A directory whose name passes the run-id grammar but holds no run.json, sorting after every real id.
  await mkdir(join(root, "alpha", "analysis", "zzzz-not-a-run"));
  const text = await tool.execute({ strategy: "alpha" }, fakeExec());
  assert.doesNotMatch(text, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const body = JSON.parse(text);
  assert.equal(body.strategy, "alpha");
  assert.deepEqual(body.runs.map((row: any) => row.run), newest);
  assert.equal(body.runs.some((row: any) => row.run === open), false, "an open run is not listed");
  for (const row of body.runs) {
    assert.deepEqual(Object.keys(row), ["run", "session", "sealed_at", "snapshot_id", "artifacts"]);
    const manifest = JSON.parse(await readFile(join(root, "alpha", "analysis", row.run, "run.json"), "utf8"));
    assert.equal(row.session, manifest.session);
    assert.equal(row.sealed_at, manifest.sealed_at);
    assert.match(row.snapshot_id, /^snap_[0-9a-f]{64}$/);
  }
  assert.deepEqual(body.runs[0].artifacts, ["environment", "theme"]);
  assert.deepEqual(body.runs.slice(1).map((row: any) => row.artifacts), [[], [], [], []]);
  // Another strategy's runs are its own; a path-like strategy is NOT_A_STRATEGY, as with a run.
  assert.deepEqual(JSON.parse(await tool.execute({ strategy: "beta" }, fakeExec())).runs, []);
  await rejectsWith(tool.execute({ strategy: "../alpha" }, fakeExec()), "NOT_A_STRATEGY");
  await rejectsWith(tool.execute({ strategy: "alpha/analysis" }, fakeExec()), "NOT_A_STRATEGY");
  await rejectsWith(tool.execute({ strategy: "gamma" }, fakeExec()), "NOT_A_STRATEGY");
});

test("lunhui_read_run without run: a run directory that is a link, or whose run.json is unusable, is passed over", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tool } = mounted(root);
  const kept = await sealedRun(root, service, "alpha", "2026-10-23");
  const broken = await sealedRun(root, service, "alpha", "2026-10-24");
  await writeFile(join(root, "alpha", "analysis", broken, "run.json"), "{ not json");
  const elsewhere = await sealedRun(root, service, "beta", "2026-10-26");
  await symlink(join(root, "beta", "analysis", elsewhere), join(root, "alpha", "analysis", "99999999T999999Z-ffffffff"));
  assert.deepEqual(JSON.parse(await tool.execute({ strategy: "alpha" }, fakeExec())).runs.map((row: any) => row.run), [kept]);
});

test("lunhui_read_run without run: of a long history only the newest 50 run ids are read", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tool } = mounted(root);
  const old = await sealedRun(root, service, "alpha", "2026-10-01");
  // Fifty open runs whose ids sort after the sealed one: the listing reads no further back.
  for (let i = 0; i < 50; i += 1) await mkdir(join(root, "alpha", "analysis", `99999999T9999${String(i).padStart(2, "0")}Z-00000000`));
  assert.deepEqual(JSON.parse(await tool.execute({ strategy: "alpha" }, fakeExec())).runs, []);
  await rm(join(root, "alpha", "analysis", "99999999T999900Z-00000000"), { recursive: true });
  assert.deepEqual(JSON.parse(await tool.execute({ strategy: "alpha" }, fakeExec())).runs.map((row: any) => row.run), [old]);
});

test("lunhui_read_run: an artifact that is a link lists unaccepted; the run directory swapped for a link mid-read refuses NO_SUCH_RUN", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tool } = mounted(root);
  const { run } = await service.openRun("alpha", "strategy");
  const dir = join(root, "alpha", "analysis", run);
  await nameArtifacts(dir, ["sentiment"]);
  await writeFile(join(root, "elsewhere.json"), JSON.stringify({ state: "REPAIR" }));
  await symlink(join(root, "elsewhere.json"), join(dir, "sentiment.json"));
  const body = JSON.parse(await tool.execute({ strategy: "alpha", run }, fakeExec()));
  assert.deepEqual(body.artifacts, [{ module: "sentiment", accepted: false, headline: null }]);
  // The swap lands between the listing and the read: readdir is hooked through the builtin's
  // live ESM exports, so the row's own named import sees it.
  const original = fsPromises.readdir;
  t.mock.method(fsPromises, "readdir", async (...args: unknown[]) => {
    const names = await (original as any)(...args);
    await rename(dir, `${dir}-moved`);
    await symlink(`${dir}-moved`, dir);
    return names;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await rejectsWith(tool.execute({ strategy: "alpha", run }, fakeExec()), "NO_SUCH_RUN");
});

// -------------------------------------------------------------------------------------------------
// The module plumbing (modules spec §5.1, §5.2, §5.7, A4, A7, A10): readContext seals and reads,
// submit takes one validated artifact per module, ten calls per module per run.
// -------------------------------------------------------------------------------------------------

/** A `build` that hands back what readContext gave it. */
const echo = (input: any) => input;

/** A validator accepting `text` as JSON. */
const accept = (text: unknown) => JSON.parse(String(text));

/** A validator rejecting as `validateEnvelope` does: a coded TypeError with its category and repair. */
const rejectAs = (category: string) => () => {
  throw Object.assign(new TypeError("analysis.status must be one of OK, NOT_EVALUABLE"), { code: "INVALID_ANALYSIS", category, repair: repairFor(category) });
};

/** The run's metrics.json as on disk. */
async function metricsOf(root: string, run: string) {
  return JSON.parse(await readFile(join(root, "alpha", "analysis", run, "metrics.json"), "utf8"));
}

test("lunhui-runs: the first readContext seals the run and hands build the manifest and every evidence file; a freeze after it is RUN_SEALED", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  const quotes = await service.addEvidence("alpha", run, "quotes", [{ symbol: "sh600000", price: 10 }], META);
  await service.addEvidence("alpha", run, "index", [{ symbol: "sh000001", price: 3000 }], { ...META, session: "2026-10-22" });
  const seen = await service.readContext("alpha", run, "environment", echo);
  assert.ok(seen.manifest.sealed_at);
  assert.match(seen.manifest.snapshot_id, /^snap_[0-9a-f]{64}$/);
  assert.deepEqual(seen.evidence, [
    { source: "quotes", session: "2026-10-23", items: [{ symbol: "sh600000", price: 10, id: quotes.ids[0] }] },
    { source: "index", session: "2026-10-22", items: [{ symbol: "sh000001", price: 3000, id: seen.evidence[1].items[0].id }] },
  ]);
  assert.deepEqual((await service.readRun("alpha", run)).manifest, seen.manifest);
  await rejectsWith(service.addEvidence("alpha", run, "boards", [{ code: "BK0715" }], META), "RUN_SEALED");
  // A later read keeps the seal.
  const again = await service.readContext("alpha", run, "sentiment", echo);
  assert.equal(again.manifest.sealed_at, seen.manifest.sealed_at);
  assert.deepEqual((await metricsOf(root, run)).calls, { environment: 1, sentiment: 1 });
});

test("lunhui-runs: two readContext calls at once on an open run seal it once and agree on snapshot_id", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  await service.addEvidence("alpha", run, "quotes", [{ symbol: "sh600000", price: 10 }], META);
  const [a, b] = await Promise.all([
    service.readContext("alpha", run, "environment", echo),
    service.readContext("alpha", run, "sentiment", echo),
  ]);
  assert.equal(a.manifest.snapshot_id, b.manifest.snapshot_id);
  assert.equal(a.manifest.sealed_at, b.manifest.sealed_at);
  assert.deepEqual((await metricsOf(root, run)).calls, { environment: 1, sentiment: 1 });
});

test("lunhui-runs: a module's eleventh call is TOOL_BUDGET, counted and persisted; another module is unaffected", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  for (let i = 0; i < 9; i++) await service.readContext("alpha", run, "environment", echo);
  await rejectsWith(service.submit("alpha", run, "environment", "{}", rejectAs("SCHEMA")), "INVALID_ANALYSIS"); // the tenth
  let built = false;
  const refusal = await rejectsWith(service.readContext("alpha", run, "environment", () => { built = true; }), "TOOL_BUDGET");
  assert.match(refusal.message, /environment/);
  assert.equal(built, false);
  await rejectsWith(service.submit("alpha", run, "environment", "{}", accept), "TOOL_BUDGET");
  assert.equal((await metricsOf(root, run)).calls.environment, 12);
  assert.equal((await service.readRun("alpha", run)).manifest.artifacts.length, 0);
  await service.readContext("alpha", run, "sentiment", echo);
  assert.deepEqual(await service.submit("alpha", run, "sentiment", "{\"module\":\"sentiment\"}", accept), { accepted: true, module: "sentiment", run });
  assert.deepEqual((await metricsOf(root, run)).calls, { environment: 12, sentiment: 2 });
});

test("lunhui-runs: submit before the module's context read is READ_FIRST, counted; a restart keeps the counts and forgets the reads", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  let validated = false;
  const refusal = await rejectsWith(service.submit("alpha", run, "environment", "{}", () => { validated = true; return {}; }), "READ_FIRST");
  assert.match(refusal.message, /environment/);
  assert.equal(validated, false);
  // Another module's read does not open this one's submit.
  await service.readContext("alpha", run, "sentiment", echo);
  await rejectsWith(service.submit("alpha", run, "environment", "{}", accept), "READ_FIRST");
  await service.readContext("alpha", run, "environment", echo);
  // A second service over the same root is a restart: the counts are on disk, the reads were in the process.
  const restarted = createLunhuiRuns(root);
  await rejectsWith(restarted.submit("alpha", run, "environment", "{}", accept), "READ_FIRST");
  assert.deepEqual((await metricsOf(root, run)).calls, { environment: 4, sentiment: 1 });
  await restarted.readContext("alpha", run, "environment", echo);
  assert.equal((await restarted.submit("alpha", run, "environment", "{}", accept)).accepted, true);
});

test("lunhui-runs: a build that throws or an unusable evidence file does not count as a read: the submit stays READ_FIRST", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  await service.addEvidence("alpha", run, "quotes", [{ symbol: "sh600000", price: 10 }], META);
  const failed = Object.assign(new Error("INVALID_CONTEXT"), { code: "INVALID_CONTEXT" });
  await assert.rejects(service.readContext("alpha", run, "environment", () => { throw failed; }), (error) => error === failed);
  await rejectsWith(service.submit("alpha", run, "environment", "{}", accept), "READ_FIRST");
  // The seal and the count stand.
  assert.ok((await service.readRun("alpha", run)).manifest.sealed_at);
  assert.equal((await metricsOf(root, run)).calls.environment, 2);
  // An evidence file swapped for garbage refuses the read, and the submit stays READ_FIRST.
  const file = join(root, "alpha", "analysis", run, "evidence-quotes.json");
  await rm(file);
  await writeFile(file, "{ not json");
  await rejectsWith(service.readContext("alpha", run, "sentiment", echo), "NO_SUCH_RUN");
  await rejectsWith(service.submit("alpha", run, "sentiment", "{}", accept), "READ_FIRST");
});

test("lunhui-runs: a rejection carrying no repair gets its category's repair", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  await service.readContext("alpha", run, "environment", echo);
  const bare = () => { throw Object.assign(new TypeError("too long"), { code: "INVALID_ANALYSIS", category: "BYTE_LIMIT" }); };
  const refusal = await rejectsWith(service.submit("alpha", run, "environment", "{}", bare), "INVALID_ANALYSIS");
  assert.equal(refusal.message, `INVALID_ANALYSIS: [BYTE_LIMIT] too long\n修复：${repairFor("BYTE_LIMIT")}`);
  assert.doesNotMatch(refusal.message, /undefined/);
});

test("lunhui-runs: a submit whose run.json write fails after the artifact landed lists the module unaccepted, and a retry is accepted", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tool } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  await service.readContext("alpha", run, "environment", echo);
  const dir = join(root, "alpha", "analysis", run);
  await mkdir(join(dir, "run.pending.json")); // replaceFile refuses a directory at its staging name
  await rejectsWith(service.submit("alpha", run, "environment", "{\"n\":1}", accept), "NO_SUCH_RUN");
  await rm(join(dir, "run.pending.json"), { recursive: true });
  let body = JSON.parse(await tool.execute({ strategy: "alpha", run }, fakeExec()));
  assert.deepEqual(body.artifacts, [{ module: "environment", accepted: false, headline: null }]);
  assert.deepEqual(body.manifest.artifacts, []);
  assert.deepEqual(body.metrics.submitted, []);
  assert.deepEqual(await service.submit("alpha", run, "environment", "{\"n\":2}", accept), { accepted: true, module: "environment", run });
  body = JSON.parse(await tool.execute({ strategy: "alpha", run }, fakeExec()));
  assert.deepEqual(body.artifacts, [{ module: "environment", accepted: true, headline: {} }]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "environment.json"), "utf8")), { n: 2 });
  assert.deepEqual(body.metrics.submitted, ["environment"]);
});

test("lunhui-runs: a validator rejection is recorded by category and thrown INVALID_ANALYSIS with its repair; a validator's own bug is rethrown as is", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  await service.readContext("alpha", run, "environment", echo);
  await assert.rejects(service.submit("alpha", run, "environment", "{}", rejectAs("SCHEMA")), (error: any) => {
    assert.ok(error instanceof LunhuiError);
    assert.equal(error.code, "INVALID_ANALYSIS");
    assert.equal(error.message, `INVALID_ANALYSIS: [SCHEMA] analysis.status must be one of OK, NOT_EVALUABLE\n修复：${repairFor("SCHEMA")}`);
    return true;
  });
  await rejectsWith(service.submit("alpha", run, "environment", "{}", rejectAs("TIME_SCOPE")), "INVALID_ANALYSIS");
  const bug = new TypeError("Cannot read properties of undefined");
  await assert.rejects(service.submit("alpha", run, "environment", "{}", () => { throw bug; }), (error) => error === bug);
  const metrics = await metricsOf(root, run);
  assert.deepEqual(metrics.rejections, { environment: ["SCHEMA", "TIME_SCOPE"] });
  assert.equal(metrics.calls.environment, 4);
  assert.deepEqual(metrics.submitted, []);
  assert.deepEqual((await service.readRun("alpha", run)).manifest.artifacts, []);
});

test("lunhui-runs: an accepted submit writes <module>.json, names it in artifacts and submitted, and lunhui_read_run lists it; a second is ALREADY_SUBMITTED", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tool } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  // build and validate are each handed the run's on-disk names.
  let built: unknown;
  await service.readContext("alpha", run, "environment", (input: any, located: unknown) => { built = located; return input; });
  assert.deepEqual(built, { strategy: "alpha", run });
  const artifact = { module: "environment", index_state: "UP", liquidity_state: "LOOSE", cycle_anchor: "2026-10-01", claims: [] };
  // The validated object is written, not the submitted text.
  let handed: unknown;
  const result = await service.submit("alpha", run, "environment", "ignored", (_text: unknown, located: unknown) => { handed = located; return artifact; });
  assert.deepEqual(handed, { strategy: "alpha", run });
  assert.deepEqual(result, { accepted: true, module: "environment", run });
  const dir = join(root, "alpha", "analysis", run);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "environment.json"), "utf8")), artifact);
  assert.deepEqual((await service.readRun("alpha", run)).manifest.artifacts, ["environment"]);
  assert.deepEqual((await metricsOf(root, run)).submitted, ["environment"]);
  const body = JSON.parse(await tool.execute({ strategy: "alpha", run }, fakeExec()));
  assert.deepEqual(body.artifacts, [{ module: "environment", accepted: true, headline: { index_state: "UP", liquidity_state: "LOOSE", cycle_anchor: "2026-10-01" } }]);
  let validated = false;
  await rejectsWith(service.submit("alpha", run, "environment", "{}", () => { validated = true; return {}; }), "ALREADY_SUBMITTED");
  assert.equal(validated, false);
  assert.equal((await metricsOf(root, run)).calls.environment, 3);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "environment.json"), "utf8")), artifact);
});

test("lunhui-runs: two submits of one module at once land one artifact; the other is ALREADY_SUBMITTED", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  await service.readContext("alpha", run, "environment", echo);
  const results = await Promise.allSettled([
    service.submit("alpha", run, "environment", "{\"n\":1}", accept),
    service.submit("alpha", run, "environment", "{\"n\":2}", accept),
  ]);
  // Each call resolves the run before it queues on the mutex, so either may win; exactly one does.
  const won = results.findIndex((result) => result.status === "fulfilled");
  assert.notEqual(won, -1);
  const lost = results[1 - won];
  assert.equal(lost.status, "rejected");
  assert.equal((lost as PromiseRejectedResult).reason.code, "ALREADY_SUBMITTED");
  assert.deepEqual(JSON.parse(await readFile(join(root, "alpha", "analysis", run, "environment.json"), "utf8")), { n: won + 1 });
});

/* The six module rows (spec §5.12), composed after the freezes - the three market modules, then
 * the leader, the mode and the review (the counterevidence module's row, `lunhui-review`): each
 * injects `tools` and the backbone's `lunhuiRuns`, registers exactly its read and submit pair, and
 * refuses to mount without the service, naming the row it needs. */
const MODULE_ROWS = [
  [environmentRow, "environment", "lunhui-environment"], [sentimentRow, "sentiment", "lunhui-sentiment"], [themeRow, "theme", "lunhui-theme"],
  [leaderRow, "leader", "lunhui-leader"], [modeRow, "mode", "lunhui-mode"], [reviewRow, "counterevidence", "lunhui-review"],
] as const;

test("the composed module rows are the six, in order, their pairs follow the freezes, and the present row closes both lists", () => {
  assert.deepEqual(LUNHUI_ROW_IDS.slice(5, 11), MODULE_ROWS.map(([, , id]) => id));
  assert.deepEqual(LUNHUI_ROW_IDS.slice(5, 11), MODULE_ROWS.map(([row]) => row.name));
  assert.deepEqual(LUNHUI_TOOL_NAMES.slice(5, 17), MODULE_ROWS.flatMap(([, module]) => [`lunhui_read_${module}_context`, `lunhui_submit_${module}`]));
  assert.deepEqual(LUNHUI_ROW_IDS.slice(11), ["lunhui-present"]);
  assert.deepEqual(LUNHUI_TOOL_NAMES.slice(17), ["lunhui_present"]);
});

for (const [row, module, id] of MODULE_ROWS) {
  test(`${id}: mounts over the backbone's service, registers exactly its pair, and refuses without lunhuiRuns`, async (t) => {
    assert.equal(row.name, id);
    assert.deepEqual(row.inject, ["tools", "lunhuiRuns"]);
    const { service } = mounted(await strategiesRoot(t));
    const scope = fakeScope();
    row.apply(Object.assign(scope.ctx, { lunhuiRuns: service }), {});
    assert.deepEqual(scope.tools.map((tool) => tool.name), [`lunhui_read_${module}_context`, `lunhui_submit_${module}`]);
    assert.equal(scope.provided.length, 0);
    scope.unload();
    assert.equal(scope.tools.length, 0);

    const bare = fakeScope();
    assert.throws(() => row.apply(bare.ctx, {}), (error: any) => {
      assert.match(error.message, /lunhui-runs/);
      return true;
    });
    assert.equal(bare.tools.length, 0);
  });
}

// -------------------------------------------------------------------------------------------------
// The cited run (modules spec A5, A27, §5.1): readSealedRun reads another run whole, unlocked.
// -------------------------------------------------------------------------------------------------

test("lunhui-runs: readSealedRun returns a sealed run's manifest, evidence and only the artifacts run.json names, each bounded and parsed", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  const limitUp = await service.addEvidence("alpha", run, "limit-up", [{ pool: "zt", code: "600001" }], META);
  await service.addEvidence("alpha", run, "index", [{ kind: "index", symbol: "sh000001" }], { ...META, session: "2026-10-22" });
  const sealed = await service.sealRun("alpha", run);
  const dir = join(root, "alpha", "analysis", run);
  await nameArtifacts(dir, ["sentiment", "theme", "environment"]);
  await writeFile(join(dir, "sentiment.json"), JSON.stringify({ module: "sentiment", state: "REPAIR", claims: [] }));
  await writeFile(join(dir, "theme.json"), "{ not json");
  await writeFile(join(dir, "environment.json"), JSON.stringify({ module: "environment", filler: "x".repeat(25 * 1024) }));
  // Present but not named: never read as an artifact.
  await writeFile(join(dir, "leader.json"), JSON.stringify({ module: "leader" }));
  const read = await service.readSealedRun("alpha", run);
  assert.equal(read.strategy, "alpha");
  assert.equal(read.run, run);
  assert.equal(read.manifest.snapshot_id, sealed.snapshot_id);
  assert.deepEqual(read.evidence, [
    { source: "limit-up", session: "2026-10-23", items: [{ pool: "zt", code: "600001", id: limitUp.ids[0] }] },
    { source: "index", session: "2026-10-22", items: [read.evidence[1].items[0]] },
  ]);
  assert.deepEqual(read.artifacts, { sentiment: { module: "sentiment", state: "REPAIR", claims: [] } });
  // Nothing counted, nothing written: the cited run is only read.
  assert.deepEqual((await service.readRun("alpha", run)).metrics.calls, {});
});

test("lunhui-runs: readSealedRun refuses an open run MISSING_EVIDENCE, a missing run NO_SUCH_RUN, a bad id BAD_RUN_ID, and takes no lock", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "market");
  await service.addEvidence("alpha", run, "index", [{ kind: "index", symbol: "sh000001" }], META);
  const refusal = await rejectsWith(service.readSealedRun("alpha", run), "MISSING_EVIDENCE");
  assert.doesNotMatch(refusal.message, /\//);
  assert.equal((await service.readRun("alpha", run)).manifest.sealed_at, null);
  await rejectsWith(service.readSealedRun("beta", run), "NO_SUCH_RUN");
  await rejectsWith(service.readSealedRun("alpha", "../x"), "BAD_RUN_ID");
  await service.sealRun("alpha", run);
  // Read from inside the run's own mutex: no lock taken, so no deadlock.
  const inside = await service.withRun("alpha", run, () => service.readSealedRun("alpha", run));
  assert.equal(inside.run, run);
});

// The mode's reads beside its run (modules spec A11, A12): the strategy's previous card and THESIS.md.

test("lunhui-runs: previousArtifact returns the newest earlier run of an earlier session naming the module, whatever it holds - same-session, unnamed, open, later and other-strategy runs passed over", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  /** A run opened a few milliseconds after the last, its evidence of `session`, sealed, its mode.json named. */
  const make = async (session: string, artifact?: unknown, { strategy = "alpha", seal = true, named = true } = {}) => {
    await new Promise((resolve) => setTimeout(resolve, 3));
    const { run } = await service.openRun(strategy, "strategy");
    await service.addEvidence(strategy, run, "quotes", [{ kind: "quote", symbol: "sh600519" }], { ...META, session });
    const sealed = seal ? await service.sealRun(strategy, run) : null;
    if (artifact !== undefined) {
      const dir = join(root, strategy, "analysis", run);
      if (named) await nameArtifacts(dir, ["mode"]);
      await writeFile(join(dir, "mode.json"), JSON.stringify(artifact));
    }
    return { run: run as string, snapshot: sealed?.snapshot_id };
  };
  const oldest = await make("2026-10-21", { card: 1 });
  const older = await make("2026-10-22", { card: 2 });
  await make("2026-10-22", { card: 3 }, { named: false });
  await make("2026-10-22", { card: 4 }, { seal: false });
  await make("2026-10-23", { card: 5 });
  await make("2026-10-22", { card: 6 }, { strategy: "beta" });
  const current = await make("2026-10-23");
  const later = await make("2026-10-22", { card: null });
  assert.deepEqual(await service.previousArtifact("alpha", current.run, "mode"), { run: older.run, snapshot_id: older.snapshot, session: "2026-10-22", artifact: { card: 2 } });
  assert.equal(await service.previousArtifact("alpha", oldest.run, "mode"), null);
  // A later asker finds the later run, a card or not: the caller judges what it holds.
  const last = await make("2026-10-23");
  assert.deepEqual((await service.previousArtifact("alpha", last.run, "mode"))?.artifact, { card: null });
  assert.equal((await service.previousArtifact("alpha", last.run, "mode"))?.run, later.run);
  // An open run has no session, so no earlier one; nothing is counted or sealed.
  const { run: open } = await service.openRun("alpha", "strategy");
  assert.equal(await service.previousArtifact("alpha", open, "mode"), null);
  const { manifest, metrics } = await service.readRun("alpha", open);
  assert.deepEqual([manifest.sealed_at, metrics.calls], [null, {}]);
  await rejectsWith(service.previousArtifact("alpha", "../x", "mode"), "BAD_RUN_ID");
  await assert.rejects(service.previousArtifact("alpha", current.run, "nope"), TypeError);
});

test("lunhui-runs: readThesis returns the strategy's THESIS.md text, null past 64 KiB", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  assert.equal(await service.readThesis("alpha"), "# alpha\n");
  await writeFile(join(root, "beta", "THESIS.md"), "x".repeat(64 * 1024 + 1));
  assert.equal(await service.readThesis("beta"), null);
  await rejectsWith(service.readThesis("gamma"), "NOT_A_STRATEGY");
});

test("lunhui-runs: readContext hands build the run's accepted artifacts, only those run.json names", async (t) => {
  const root = await strategiesRoot(t);
  const { service } = mounted(root);
  const { run } = await service.openRun("alpha", "strategy");
  await service.sealRun("alpha", run);
  const dir = join(root, "alpha", "analysis", run);
  await nameArtifacts(dir, ["leader"]);
  await writeFile(join(dir, "leader.json"), JSON.stringify({ module: "leader", leader_candidates: [] }));
  await writeFile(join(dir, "mode.json"), JSON.stringify({ module: "mode" }));
  const seen = await service.readContext("alpha", run, "mode", echo);
  assert.deepEqual(seen.artifacts, { leader: { module: "leader", leader_candidates: [] } });
});

// -------------------------------------------------------------------------------------------------
// The run view (run view plan 1, Task 9): service.view builds the view of a sealed run, its evidence
// half cached per run, and lunhui_read_run carries its digest.
// -------------------------------------------------------------------------------------------------

const TENCENT_FIXTURES = fileURLToPath(new URL("./fixtures/lunhui/", import.meta.url));
const EASTMONEY_FIXTURES = fileURLToPath(new URL("./fixtures/lunhui-eastmoney/", import.meta.url));
/** Friday 2026-10-23, 15:00 in China: after the close of a covered trading day. */
const FRIDAY = new Date("2026-10-23T07:00:00.000Z");

/** The backbone over a root holding `cn-market`, with the index and limit-up freeze rows over the FRIDAY fixtures. */
async function viewBench(t: Cleanup) {
  const root = await mkdtemp(join(tmpdir(), "lunhui-view-rows-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "cn-market"));
  await writeFile(join(root, "cn-market", "THESIS.md"), "# cn-market\n");
  const fixtures = await mkdtemp(join(tmpdir(), "lunhui-view-fixtures-"));
  t.after(() => rm(fixtures, { recursive: true, force: true }));
  await cp(TENCENT_FIXTURES, fixtures, { recursive: true });
  await cp(EASTMONEY_FIXTURES, fixtures, { recursive: true });
  const { service, tool } = mounted(root);
  const freezeTool = (row: any) => {
    const scope = fakeScope();
    (scope.ctx as any).lunhuiRuns = service;
    row.apply(scope.ctx, { fetch: fixtures, now: () => FRIDAY });
    return scope.tools[0];
  };
  return { root, service, tool, index: freezeTool(indexRow), limitUp: freezeTool(limitUpRow) };
}

test("lunhui-runs: view of a frozen and sealed run has the fixture pools' ladder; a second call reuses the cached evidence half", async (t) => {
  const { service, index, limitUp } = await viewBench(t);
  const { run } = JSON.parse(await index.execute({ strategy: "cn-market" }, fakeExec()));
  await limitUp.execute({ strategy: "cn-market", run }, fakeExec());
  await service.readContext("cn-market", run, "environment", echo);
  const pools = await fetchLimitUpPools({ date: "20261023", fetchImpl: createFixtureFetch(EASTMONEY_FIXTURES) });
  const view = await service.view("cn-market", run);
  assert.equal(view.strategy, "cn-market");
  assert.equal(view.run, run);
  assert.equal(view.ladder.unavailable, null);
  assert.equal(view.ladder.height, promotion(pools).height);
  assert.equal(view.indices.rows.length, 4);
  const again = await service.view("cn-market", run, { modules: [] });
  assert.strictEqual(again.ladder, view.ladder);
  assert.strictEqual(again.indices, view.indices);
});

test("lunhui-runs: view reads artifacts and metrics on every call, the evidence half cached", async (t) => {
  const { root, service, index } = await viewBench(t);
  const { run } = JSON.parse(await index.execute({ strategy: "cn-market" }, fakeExec()));
  await service.readContext("cn-market", run, "environment", echo);
  const before = await service.view("cn-market", run);
  assert.deepEqual(before.verdicts, []);
  const dir = join(root, "cn-market", "analysis", run);
  await nameArtifacts(dir, ["environment"]);
  await writeFile(join(dir, "environment.json"), JSON.stringify({ module: "environment", analysis: { status: "OK" }, state: "RISK_OFF", claims: [] }));
  const after = await service.view("cn-market", run);
  assert.deepEqual(after.verdicts.map((v: any) => v.module), ["environment"]);
  assert.strictEqual(after.breadth, before.breadth);
});

test("lunhui-runs: view refuses as readSealedRun does - an open run MISSING_EVIDENCE, NO_SUCH_RUN, BAD_RUN_ID, NOT_A_STRATEGY", async (t) => {
  const { service, index } = await viewBench(t);
  const { run } = JSON.parse(await index.execute({ strategy: "cn-market" }, fakeExec()));
  await rejectsWith(service.view("cn-market", run), "MISSING_EVIDENCE");
  // The refusal is not cached: once sealed, the view builds.
  await service.sealRun("cn-market", run);
  assert.equal((await service.view("cn-market", run)).run, run);
  await rejectsWith(service.view("cn-market", "../x"), "BAD_RUN_ID");
  await rejectsWith(service.view("cn-market", "20261023T070000Z-0a1b2c3d"), "NO_SUCH_RUN");
  await rejectsWith(service.view("../cn-market", run), "NOT_A_STRATEGY");
});

test("lunhui_read_run: with a sealed run the reply carries the view digest, at most 2,048 bytes; an open run's view is null", async (t) => {
  const { service, tool, index, limitUp } = await viewBench(t);
  const { run } = JSON.parse(await index.execute({ strategy: "cn-market" }, fakeExec()));
  await limitUp.execute({ strategy: "cn-market", run }, fakeExec());
  const open = JSON.parse(await tool.execute({ strategy: "cn-market", run }, fakeExec()));
  assert.deepEqual(Object.keys(open), ["manifest", "metrics", "artifacts", "view"]);
  assert.equal(open.view, null);
  await service.readContext("cn-market", run, "environment", echo);
  const sealed = JSON.parse(await tool.execute({ strategy: "cn-market", run }, fakeExec()));
  assert.deepEqual(Object.keys(sealed), ["manifest", "metrics", "artifacts", "view"]);
  assert.equal(typeof sealed.view, "string");
  assert.ok(sealed.view.includes("ladder:"), sealed.view);
  assert.ok(Buffer.byteLength(sealed.view, "utf8") <= 2048);
  assert.equal(sealed.view, viewDigest(await service.view("cn-market", run)));
});

test("lunhui-runs: the view of a run frozen before minute lines builds, each index row NOT_FROZEN", async (t) => {
  const { root, service, index } = await viewBench(t);
  const { run: fresh } = JSON.parse(await index.execute({ strategy: "cn-market" }, fakeExec()));
  const frozen = JSON.parse(await readFile(join(root, "cn-market", "analysis", fresh, "evidence-index.json"), "utf8"));
  // The same index evidence as a run written before the run view: no minute items, no own ids.
  const items = frozen.items
    .filter((item: any) => item.kind !== "minutes" && item.kind !== "minutes_missing")
    .map(({ id: _id, ...item }: any) => item);
  assert.ok(items.length > 0 && items.length < frozen.items.length);
  const { run } = await service.openRun("cn-market", "market");
  await service.addEvidence("cn-market", run, "index", items, { ...META, host: "qt.gtimg.cn" });
  await service.sealRun("cn-market", run);
  const view = await service.view("cn-market", run);
  assert.equal(view.indices.unavailable, null);
  assert.equal(view.indices.rows.length, 4);
  for (const row of view.indices.rows) {
    assert.equal(row.minutes, null);
    assert.equal(row.minutesMissing, "NOT_FROZEN");
  }
  assert.equal(view.through, null);
  assert.ok(viewDigest(view).length > 0);
});

test("lunhui_read_run: a sealed run whose view cannot be built still replies with its manifest and artifacts, view null and view_error its code", async (t) => {
  const { root, service, tool, index, limitUp } = await viewBench(t);
  const { run } = JSON.parse(await index.execute({ strategy: "cn-market" }, fakeExec()));
  await limitUp.execute({ strategy: "cn-market", run }, fakeExec());
  await service.readContext("cn-market", run, "environment", echo);
  const dir = join(root, "cn-market", "analysis", run);
  await nameArtifacts(dir, ["environment"]);
  await writeFile(join(dir, "environment.json"), JSON.stringify({ module: "environment", index_state: "RISK_OFF" }));
  await writeFile(join(dir, "evidence-index.json"), "{ not json");
  await rejectsWith(service.view("cn-market", run), "NO_SUCH_RUN");
  const body = JSON.parse(await tool.execute({ strategy: "cn-market", run }, fakeExec()));
  assert.deepEqual(Object.keys(body), ["manifest", "metrics", "artifacts", "view", "view_error"]);
  assert.equal(body.view_error, "NO_SUCH_RUN");
  assert.equal(body.manifest.run, run);
  assert.ok(body.manifest.sealed_at);
  assert.deepEqual(body.manifest.evidence.map((e: any) => e.source), ["index", "limit-up"]);
  assert.deepEqual(body.artifacts, [{ module: "environment", accepted: true, headline: { index_state: "RISK_OFF" } }]);
  assert.equal(body.view, null);
});

test("lunhui_read_run: a non-Lunhui failure building the view goes to stderr and the reply keeps view null, view_error INTERNAL", async (t) => {
  const { service, tool, index } = await viewBench(t);
  const { run } = JSON.parse(await index.execute({ strategy: "cn-market" }, fakeExec()));
  await service.readContext("cn-market", run, "environment", echo);
  t.mock.method(service, "view", async () => { throw new Error("view bug"); });
  const writes: string[] = [];
  t.mock.method(process.stderr, "write", (chunk: string) => { writes.push(String(chunk)); return true; });
  const body = JSON.parse(await tool.execute({ strategy: "cn-market", run }, fakeExec()));
  assert.equal(body.manifest.run, run);
  assert.equal(body.view, null);
  assert.equal(body.view_error, "INTERNAL");
  assert.ok(writes.some((w) => w.includes("lunhui: internal error") && w.includes("view bug")), writes.join(""));
});

test("lunhui-runs: the view's evidence cache keeps the last 8 runs viewed; a ninth evicts the least recently viewed", async (t) => {
  assert.equal(EVIDENCE_CACHE_RUNS, 8);
  const { service, index } = await viewBench(t);
  const { run: first } = JSON.parse(await index.execute({ strategy: "cn-market" }, fakeExec()));
  await service.sealRun("cn-market", first);
  const frozen = JSON.parse(await readFile(join(service.strategiesRoot, "cn-market", "analysis", first, "evidence-index.json"), "utf8"));
  const items = frozen.items.map(({ id: _id, ...item }: any) => item);
  const runsOpened = [first];
  for (let i = 1; i < 9; i++) {
    const { run } = await service.openRun("cn-market", "market");
    await service.addEvidence("cn-market", run, "index", items, { ...META, host: "qt.gtimg.cn" });
    await service.sealRun("cn-market", run);
    runsOpened.push(run);
  }
  const views = [];
  for (const run of runsOpened.slice(0, 8)) views.push(await service.view("cn-market", run));
  // A hit on the first run makes the second the least recently viewed.
  assert.strictEqual((await service.view("cn-market", runsOpened[0])).indices, views[0].indices);
  await service.view("cn-market", runsOpened[8]);
  assert.strictEqual((await service.view("cn-market", runsOpened[0])).indices, views[0].indices, "the recently viewed first run stays cached");
  assert.notStrictEqual((await service.view("cn-market", runsOpened[1])).indices, views[1].indices, "the second run was evicted");
});
