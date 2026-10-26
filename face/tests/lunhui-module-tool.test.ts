/**
 * The Lunhui module tool builder (modules spec §5.4, §5.5, §5.7, A3, A11, A23, A24):
 * `moduleDeps` and `defineModule`, mounted on the stand-in scope of tests/lunhui-rows.test.ts beside
 * a real `lunhui-runs` service over a temp strategies root holding `cn-market` and `alpha`, with a
 * toy contract - one enum headline - over evidence written through the service's `addEvidence`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply as applyRuns } from "../plugins/lunhui/runs-row.mjs";
import { defineModule, moduleDeps } from "../plugins/lunhui/lib/module-tool.mjs";
import { MAX_CONTEXT_BYTES, hypothesesVersion } from "../plugins/lunhui/lib/contract-core.mjs";
import { LunhuiError } from "../plugins/lunhui/lib/runs.mjs";

type Cleanup = { after(fn: () => unknown): unknown };
type ToolDef = { name: string; description: string; parameters: any; execute(args: unknown, exec: unknown): Promise<string> };

const META = { received_at: "2026-10-23T07:00:00.000Z", session: "2026-10-23", host: "qt.gtimg.cn", delayed: false, truncated: false };
const HYPOTHESES = "H1（P0019）：玩具假设，只用于测试。";

/** The toy contract: the environment module's slot, one enum headline, the environment's sources. */
function toyContract(rules?: (parsed: any, context: any) => void) {
  return {
    schema: { required: ["index_state"], properties: { index_state: { enum: ["UP", "FLAT", "DOWN", "UNKNOWN"] } } },
    owns: ["index"],
    rules,
    hypotheses: HYPOTHESES,
    hints: "玩具提示。",
    example: (digest: any) => ({ module: digest.module, run: digest.run, index_state: "UNKNOWN" }),
    sources: ["index", "quotes"],
    required: ["index", "quotes"],
    priority: [{ source: "index", kind: "index" }, { source: "quotes", kind: "quote" }],
    derivedFirst: ["index"],
  };
}

/** A strategies root holding `cn-market` and `alpha`, each with its THESIS.md. */
async function strategiesRoot(t: Cleanup): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lunhui-module-tool-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const strategy of ["cn-market", "alpha"]) {
    await mkdir(join(root, strategy));
    await writeFile(join(root, strategy, "THESIS.md"), `# ${strategy}\n`);
  }
  return root;
}

/** The stand-in scope, `lunhuiRuns` among its injections once the backbone is mounted. */
function fakeScope(extra: Record<string, unknown> = {}) {
  const provided: Array<[string, any]> = [];
  const tools: ToolDef[] = [];
  const ctx: any = {
    ...extra,
    effect(fn: () => unknown) { const d = fn(); assert.equal(typeof d, "function"); return d; },
    provide(key: string, value: unknown) { provided.push([key, value]); return () => {}; },
    tools: { register(def: ToolDef) { tools.push(def); return () => { tools.splice(tools.indexOf(def), 1); }; } },
  };
  return { ctx, provided, tools };
}

/** The backbone's service over `root`. */
function backbone(root: string) {
  const scope = fakeScope();
  applyRuns(scope.ctx, { strategiesRoot: root });
  return scope.provided[0][1];
}

/** A module's two tools over `service`, as a module row builds them. */
function tools(service: any, channel: "market" | "strategy" | "any" = "market", contract = toyContract()) {
  const { runs } = moduleDeps("lunhui-environment", { lunhuiRuns: service });
  const [read, submit] = defineModule({ module: "environment", channel, contract, runs }) as unknown as ToolDef[];
  return { read, submit };
}

/** An `exec` as dsh hands a tool: the caller's session header, a root session's by default. */
function exec(header: Record<string, unknown> = {}) {
  return { agent: { session: { header } }, signal: new AbortController().signal };
}
const ROLE = { origin: "subagent" };
const FORK = { origin: "subagent", isSeeded: true };

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<LunhuiError> {
  let refusal: any;
  await assert.rejects(promise, (error: any) => {
    assert.ok(error instanceof LunhuiError, `a LunhuiError, not ${error?.stack ?? error}`);
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(`^${code}: `));
    assert.doesNotMatch(error.message, /\/|\\/);
    refusal = error;
    return true;
  });
  return refusal;
}

/** A run of `strategy` holding an index file (a quote and a derived item) and a quotes file. */
async function frozenRun(service: any, strategy: string) {
  const { run } = await service.openRun(strategy, strategy === "cn-market" ? "market" : "strategy");
  const index = await service.addEvidence(strategy, run, "index", [
    { kind: "index", symbol: "sh000001", last: 3000 },
    { kind: "derived", measure: "turnover_total", value: 1.2e12 },
  ], META);
  await service.addEvidence(strategy, run, "quotes", [{ kind: "quote", symbol: "sh600000", last: 10 }], META);
  return { run, quoteId: index.ids[0] as string, derivedId: index.ids[1] as string };
}

/** A valid toy artifact over the context `text`, citing `ids`. */
function artifactOf(text: string, ids: string[]) {
  const context = JSON.parse(text);
  return {
    module: context.module, contract_version: context.contract_version, hypotheses_version: context.hypotheses_version,
    snapshot_id: context.snapshot_id, run: context.run, as_of: context.as_of, session: context.session,
    status: "OK", missing_sources: [], index_state: "UP",
    claims: [{ id: "c1", text: "sh000001 报价 3000，属本运行交易日。", basis: "CURRENT", evidence_ids: ids }],
    limitations: [],
  };
}

test("module tools: moduleDeps returns the backbone's service and refuses a missing one, naming the row", () => {
  const service = {};
  assert.equal(moduleDeps("lunhui-environment", { lunhuiRuns: service }).runs, service);
  for (const ctx of [{}, { lunhuiRuns: null }, undefined])
    assert.throws(() => moduleDeps("lunhui-environment", ctx), { message: "lunhui-environment: lunhuiRuns is missing; mount the lunhui-runs row first" });
});

test("module tools: names, parameters and Chinese descriptions stating the bounds", async (t) => {
  const { read, submit } = tools(backbone(await strategiesRoot(t)));
  assert.equal(read.name, "lunhui_read_environment_context");
  assert.equal(submit.name, "lunhui_submit_environment");
  assert.deepEqual(Object.keys(read.parameters.properties), ["strategy", "run"]);
  assert.deepEqual(read.parameters.required, ["strategy", "run"]);
  assert.deepEqual(Object.keys(submit.parameters.properties), ["strategy", "run", "analysis"]);
  assert.deepEqual(submit.parameters.required, ["strategy", "run", "analysis"]);
  for (const tool of [read, submit]) {
    for (const property of Object.values(tool.parameters.properties) as any[]) {
      assert.equal(property.type, "string");
      assert.match(property.description, /[一-鿿]/u);
    }
    assert.match(tool.description, /10 次/);
    assert.match(tool.description, /找到运行之后被拒绝的调用也计入/);
    assert.match(tool.description, /参数是名称与编号，不是路径/);
    assert.match(tool.description, /cn-market/);
    assert.match(tool.description, /只接受一个工件/);
  }
  assert.match(submit.description, /NOT_A_ROLE/);
  assert.match(read.description, /30 KiB/);
  assert.throws(() => defineModule({ module: "nope", channel: "market", contract: toyContract(), runs: {} } as any), TypeError);
  assert.throws(() => defineModule({ module: "environment", channel: "elsewhere", contract: toyContract(), runs: {} } as any), TypeError);
});

test("module tools: a read returns the built context, at most 30 KiB, with the envelope fields, the example built from the digest, and seals the run", async (t) => {
  const service = backbone(await strategiesRoot(t));
  const { read } = tools(service);
  const { run, quoteId, derivedId } = await frozenRun(service, "cn-market");
  // A read is open to any caller: a root session here.
  const text = await read.execute({ strategy: "cn-market", run }, exec());
  assert.equal(typeof text, "string");
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  const { manifest, metrics } = await service.readRun("cn-market", run);
  assert.ok(manifest.sealed_at);
  assert.equal(context.module, "environment");
  assert.equal(context.contract_version, "1");
  assert.equal(context.hypotheses_version, hypothesesVersion(HYPOTHESES));
  assert.equal(context.run, run);
  assert.equal(context.snapshot_id, manifest.snapshot_id);
  assert.equal(context.as_of, manifest.as_of);
  assert.equal(context.session, manifest.session);
  assert.equal(context.status_expected, "OK");
  assert.deepEqual(context.example, { module: "environment", run, index_state: "UNKNOWN" });
  assert.equal(context.hypotheses, HYPOTHESES);
  assert.deepEqual(context.derived.map((row: any) => row.id), [derivedId]);
  assert.ok(context.evidence.some((row: any) => row.id === quoteId));
  assert.equal(metrics.calls.environment, 1);
  // Read again from a role: the same context.
  assert.equal(await read.execute({ strategy: "cn-market", run }, exec(ROLE)), text);
});

test("module tools: a market module refuses a strategy run WRONG_CHANNEL before counting; a strategy module refuses cn-market; any takes both", async (t) => {
  const service = backbone(await strategiesRoot(t));
  const market = tools(service, "market");
  const alpha = await frozenRun(service, "alpha");
  const refusal = await rejectsWith(market.read.execute({ strategy: "alpha", run: alpha.run }, exec()), "WRONG_CHANNEL");
  assert.match(refusal.message, /cn-market/);
  await rejectsWith(market.submit.execute({ strategy: "alpha", run: alpha.run, analysis: "{}" }, exec(ROLE)), "WRONG_CHANNEL");
  assert.equal((await service.readRun("alpha", alpha.run)).metrics.calls.environment, undefined);
  assert.equal((await service.readRun("alpha", alpha.run)).manifest.sealed_at, null);

  const cn = await frozenRun(service, "cn-market");
  const strategy = tools(service, "strategy");
  await rejectsWith(strategy.read.execute({ strategy: "cn-market", run: cn.run }, exec()), "WRONG_CHANNEL");
  await rejectsWith(strategy.submit.execute({ strategy: "cn-market", run: cn.run, analysis: "{}" }, exec(ROLE)), "WRONG_CHANNEL");
  assert.equal(JSON.parse(await strategy.read.execute({ strategy: "alpha", run: alpha.run }, exec())).run, alpha.run);

  const any = tools(service, "any");
  for (const [name, { run }] of [["alpha", alpha], ["cn-market", cn]] as const)
    assert.equal(JSON.parse(await any.read.execute({ strategy: name, run }, exec())).run, run);
  await rejectsWith(any.read.execute({ strategy: "../alpha", run: alpha.run }, exec()), "NOT_A_STRATEGY");
});

test("module tools: a submit from a root session or a seeded fork is NOT_A_ROLE, uncounted; from a role child a valid artifact lands", async (t) => {
  const root = await strategiesRoot(t);
  const service = backbone(root);
  const { read, submit } = tools(service);
  const { run, quoteId, derivedId } = await frozenRun(service, "cn-market");
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  const analysis = JSON.stringify(artifactOf(text, [quoteId, derivedId]));
  for (const header of [{}, FORK]) {
    const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis }, exec(header)), "NOT_A_ROLE");
    assert.match(refusal.message, /角色/);
  }
  assert.equal((await service.readRun("cn-market", run)).metrics.calls.environment, 1);
  const reply = await submit.execute({ strategy: "cn-market", run, analysis }, exec(ROLE));
  assert.equal(typeof reply, "string");
  assert.deepEqual(JSON.parse(reply), { accepted: true, module: "environment", run });
  const stored = JSON.parse(await readFile(join(root, "cn-market", "analysis", run, "environment.json"), "utf8"));
  assert.deepEqual(stored, JSON.parse(analysis));
  const { manifest, metrics } = await service.readRun("cn-market", run);
  assert.deepEqual(manifest.artifacts, ["environment"]);
  assert.deepEqual(metrics.submitted, ["environment"]);
  await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis }, exec(ROLE)), "ALREADY_SUBMITTED");
});

test("module tools: a submit before a read is READ_FIRST; an invalid artifact is INVALID_ANALYSIS with its category and repair; the contract's own rules run last", async (t) => {
  const service = backbone(await strategiesRoot(t));
  let ruled = 0;
  const { read, submit } = tools(service, "market", toyContract((parsed) => {
    ruled += 1;
    if (parsed.index_state === "DOWN") throw Object.assign(new TypeError("analysis.index_state: invalid enum."), { code: "INVALID_ANALYSIS" });
  }));
  const { run, quoteId } = await frozenRun(service, "cn-market");
  await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: "{}" }, exec(ROLE)), "READ_FIRST");
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  const bad = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: "not json" }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(bad.message, /^INVALID_ANALYSIS: \[SCHEMA\] .+\n修复：/u);
  const mismatch = { ...artifactOf(text, [quoteId]), snapshot_id: "snap_other" };
  const refused = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(mismatch) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refused.message, /^INVALID_ANALYSIS: \[REFERENCE\] /u);
  assert.equal(ruled, 0);
  await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify({ ...artifactOf(text, [quoteId]), index_state: "DOWN" }) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.equal(ruled, 1);
  assert.deepEqual((await service.readRun("cn-market", run)).metrics.rejections.environment, ["SCHEMA", "REFERENCE", "SCHEMA"]);
  assert.deepEqual(JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(artifactOf(text, [quoteId])) }, exec(ROLE))).accepted, true);
});

test("module tools: the digest is per definition - a read through one, a submit through another over the same service, is READ_FIRST until it reads", async (t) => {
  const service = backbone(await strategiesRoot(t));
  const first = tools(service);
  const second = tools(service);
  const { run, quoteId } = await frozenRun(service, "cn-market");
  const text = await first.read.execute({ strategy: "cn-market", run }, exec(ROLE));
  const analysis = JSON.stringify(artifactOf(text, [quoteId]));
  await rejectsWith(second.submit.execute({ strategy: "cn-market", run, analysis }, exec(ROLE)), "READ_FIRST");
  await second.read.execute({ strategy: "cn-market", run }, exec(ROLE));
  await rejectsWith(first.submit.execute({ strategy: "cn-market", run, analysis: "{}" }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.deepEqual(JSON.parse(await second.submit.execute({ strategy: "cn-market", run, analysis }, exec(ROLE))).accepted, true);
});

test("module tools: a submit naming the run in another letter case finds the digest the read kept under the on-disk names", async (t) => {
  const root = await strategiesRoot(t);
  const service = backbone(root);
  const { read, submit } = tools(service);
  const { run, quoteId } = await frozenRun(service, "cn-market");
  // The run id's "T" lower-cased: still a run id, another spelling on disk whatever its hex digits.
  const miscased = run.replace("T", "t");
  assert.notEqual(miscased, run);
  const resolves = await stat(join(root, "cn-market", "analysis", miscased)).then(() => true, () => false);
  if (!resolves) {
    t.skip("the filesystem is case-sensitive: a miscased run id names no run here");
    return;
  }
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  const analysis = JSON.stringify(artifactOf(text, [quoteId]));
  assert.deepEqual(JSON.parse(await submit.execute({ strategy: "cn-market", run: miscased, analysis }, exec(ROLE))), { accepted: true, module: "environment", run });
});

test("module tools: an accepted submit drops the module's digest - a manifest that no longer names the artifact is READ_FIRST until the role reads again", async (t) => {
  const root = await strategiesRoot(t);
  const service = backbone(root);
  const { read, submit } = tools(service);
  const { run, quoteId } = await frozenRun(service, "cn-market");
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  const analysis = JSON.stringify(artifactOf(text, [quoteId]));
  assert.deepEqual(JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis }, exec(ROLE))).accepted, true);
  // Past ALREADY_SUBMITTED only by hand: the manifest edited to forget the artifact.
  const manifestPath = join(root, "cn-market", "analysis", run, "run.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, artifacts: [] }));
  await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis }, exec(ROLE)), "READ_FIRST");
});

// -------------------------------------------------------------------------------------------------
// The cited run (A5, A27, §5.1, §5.5): a contract with marketRun reads a sealed cn-market run.
// -------------------------------------------------------------------------------------------------

/** The toy contract citing a market run: the leader module's slot, a strategy run's quotes, the market's limit-up and sentiment. */
function citingContract(marketRun: "required" | "optional" = "required") {
  return {
    schema: { required: ["top_pattern_flags"], properties: { top_pattern_flags: { type: "array", minItems: 0, maxItems: 1, items: { enum: ["NONE"] } } } },
    owns: [],
    hypotheses: HYPOTHESES,
    hints: "玩具提示。",
    example: (digest: any) => ({ module: digest.module, market_run: digest.market_run }),
    sources: ["quotes"],
    required: ["quotes"],
    priority: [{ source: "quotes", kind: "quote" }, { source: "market:limit-up", kind: "zt" }],
    marketRun,
    marketSources: ["limit-up"],
    marketArtifacts: ["sentiment"],
  };
}

function leaderTools(service: any, contract: any = citingContract()) {
  const { runs } = moduleDeps("lunhui-leader", { lunhuiRuns: service });
  const [read, submit] = defineModule({ module: "leader", channel: "strategy", contract, runs }) as unknown as ToolDef[];
  return { read, submit };
}

/** A sealed cn-market run of `session` with a limit-up pool row and an accepted sentiment artifact. */
async function marketRun(service: any, root: string, session: string) {
  const { run } = await service.openRun("cn-market", "market");
  const limitUp = await service.addEvidence("cn-market", run, "limit-up", [{ pool: "zt", code: "600000", name: "甲" }], { ...META, session });
  const manifest = await service.sealRun("cn-market", run);
  const dir = join(root, "cn-market", "analysis", run);
  await writeFile(join(dir, "sentiment.json"), JSON.stringify({ module: "sentiment", state: "REPAIR", claims: [] }));
  await writeFile(join(dir, "run.json"), JSON.stringify({ ...manifest, artifacts: ["sentiment"] }));
  return { run, snapshot: manifest.snapshot_id as string, poolId: limitUp.ids[0] as string };
}

/** A strategy run of `alpha` with one quote of `session`. */
async function strategyRun(service: any, session = "2026-10-23") {
  const { run } = await service.openRun("alpha", "strategy");
  const quotes = await service.addEvidence("alpha", run, "quotes", [{ kind: "quote", symbol: "sh600000", last: 10 }], { ...META, session });
  return { run, quoteId: quotes.ids[0] as string };
}

/** A valid citing artifact over the context `text`. */
function citingOf(text: string, ids: string[]) {
  const context = JSON.parse(text);
  return {
    module: context.module, contract_version: context.contract_version, hypotheses_version: context.hypotheses_version,
    snapshot_id: context.snapshot_id, run: context.run, as_of: context.as_of, session: context.session,
    market_run: context.market_run, market_snapshot_id: context.market_snapshot_id,
    status: "OK", missing_sources: [], top_pattern_flags: [],
    claims: [{ id: "c1", text: "sh600000 报价已冻结。", basis: "CURRENT", evidence_ids: ids }],
    limitations: [],
  };
}

test("module tools with a cited run: market_run is a parameter of the read alone, required for a required contract, optional for an optional one; an unknown option is a TypeError", async (t) => {
  const service = backbone(await strategiesRoot(t));
  const { read, submit } = leaderTools(service);
  assert.deepEqual(Object.keys(read.parameters.properties), ["strategy", "run", "market_run"]);
  assert.deepEqual(read.parameters.required, ["strategy", "run", "market_run"]);
  // The submit is spec §5.5's: the read's digest binds the market run.
  assert.deepEqual(Object.keys(submit.parameters.properties), ["strategy", "run", "analysis"]);
  assert.deepEqual(submit.parameters.required, ["strategy", "run", "analysis"]);
  assert.match(read.parameters.properties.market_run.description, /cn-market/);
  assert.match(read.description, /STALE_MARKET_RUN/);
  assert.match(submit.description, /market_snapshot_id/);
  const optional = leaderTools(service, citingContract("optional"));
  assert.deepEqual(optional.read.parameters.required, ["strategy", "run"]);
  assert.ok(Object.hasOwn(optional.read.parameters.properties, "market_run"));
  assert.throws(() => leaderTools(service, { ...citingContract(), marketRun: "sometimes" }), TypeError);
  // Without the option the tools are plan 2's.
  assert.deepEqual(Object.keys(tools(service).read.parameters.properties), ["strategy", "run"]);
});

test("module tools with a cited run: a market run two trading days back is STALE_MARKET_RUN, counted; the previous session is accepted, over a weekend too", async (t) => {
  const root = await strategiesRoot(t);
  const service = backbone(root);
  const { read } = leaderTools(service);
  const strategy = await strategyRun(service, "2026-10-23");
  const stale = await marketRun(service, root, "2026-10-21");
  const refusal = await rejectsWith(read.execute({ strategy: "alpha", run: strategy.run, market_run: stale.run }, exec(ROLE)), "STALE_MARKET_RUN");
  assert.match(refusal.message, /2026-10-21/);
  assert.equal((await service.readRun("alpha", strategy.run)).metrics.calls.leader, 1);
  const previous = await marketRun(service, root, "2026-10-22");
  assert.equal(JSON.parse(await read.execute({ strategy: "alpha", run: strategy.run, market_run: previous.run }, exec(ROLE))).market_run, previous.run);
  const same = await marketRun(service, root, "2026-10-23");
  assert.equal(JSON.parse(await read.execute({ strategy: "alpha", run: strategy.run, market_run: same.run }, exec(ROLE))).market_run, same.run);
  // A newer market run is not the same day or the day before either.
  const monday = await strategyRun(service, "2026-10-12");
  const friday = await marketRun(service, root, "2026-10-09");
  assert.equal(JSON.parse(await read.execute({ strategy: "alpha", run: monday.run, market_run: friday.run }, exec(ROLE))).market_run, friday.run);
  await rejectsWith(read.execute({ strategy: "alpha", run: monday.run, market_run: same.run }, exec(ROLE)), "STALE_MARKET_RUN");
});

test("module tools with a cited run: an open market run is MISSING_EVIDENCE, a missing one NO_SUCH_RUN, a strategy run named as the market run NO_SUCH_RUN; an absent or bad market_run refused before counting", async (t) => {
  const root = await strategiesRoot(t);
  const service = backbone(root);
  const { read } = leaderTools(service);
  const strategy = await strategyRun(service);
  const open = await service.openRun("cn-market", "market");
  await service.addEvidence("cn-market", open.run, "limit-up", [{ pool: "zt", code: "600000" }], META);
  await rejectsWith(read.execute({ strategy: "alpha", run: strategy.run, market_run: open.run }, exec(ROLE)), "MISSING_EVIDENCE");
  // The cited run is only read: it stays open.
  assert.equal((await service.readRun("cn-market", open.run)).manifest.sealed_at, null);
  await rejectsWith(read.execute({ strategy: "alpha", run: strategy.run, market_run: "20261023T070000Z-00000000" }, exec(ROLE)), "NO_SUCH_RUN");
  const other = await strategyRun(service);
  await service.sealRun("alpha", other.run);
  await rejectsWith(read.execute({ strategy: "alpha", run: strategy.run, market_run: other.run }, exec(ROLE)), "NO_SUCH_RUN");
  assert.equal((await service.readRun("alpha", strategy.run)).metrics.calls.leader, 3);
  await rejectsWith(read.execute({ strategy: "alpha", run: strategy.run, market_run: "../x" }, exec(ROLE)), "BAD_RUN_ID");
  // defineTool validates the arguments' presence and type before execute.
  for (const market_run of [undefined, 7])
    await assert.rejects(read.execute({ strategy: "alpha", run: strategy.run, market_run }, exec(ROLE)));
  assert.equal((await service.readRun("alpha", strategy.run)).metrics.calls.leader, 3);
});

test("module tools with a cited run: market items and artifacts are citable, scoped against the strategy run's session; market_run and market_snapshot_id bound by the read's digest", async (t) => {
  const root = await strategiesRoot(t);
  const service = backbone(root);
  const { read, submit } = leaderTools(service);
  const strategy = await strategyRun(service, "2026-10-23");
  const market = await marketRun(service, root, "2026-10-22");
  const text = await read.execute({ strategy: "alpha", run: strategy.run, market_run: market.run }, exec(ROLE));
  const context = JSON.parse(text);
  assert.equal(context.market_snapshot_id, market.snapshot);
  assert.deepEqual(context.market, { run: market.run, snapshot_id: market.snapshot, session: "2026-10-22" });
  assert.deepEqual(context.example, { module: "leader", market_run: market.run });
  const pool = context.evidence.find((row: any) => row.id === market.poolId);
  assert.deepEqual([pool.source, pool.scope], ["market:limit-up", "HISTORICAL"]);
  assert.deepEqual(context.artifacts.map((row: any) => row.id), [`sentiment@${market.snapshot}`]);

  // A market item of the day before cannot carry a CURRENT claim alone.
  const historical = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy.run, analysis: JSON.stringify(citingOf(text, [market.poolId])) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(historical.message, /\[TIME_SCOPE\]/);
  for (const field of ["market_run", "market_snapshot_id"]) {
    const refused = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy.run, analysis: JSON.stringify({ ...citingOf(text, [strategy.quoteId]), [field]: "snap_other" }) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refused.message, /\[REFERENCE\]/);
  }
  const analysis = JSON.stringify(citingOf(text, [strategy.quoteId, `sentiment@${market.snapshot}`]));
  // An envelope copying another market run than the read's is REFERENCE: the read's digest binds it.
  const other = await marketRun(service, root, "2026-10-23");
  const elsewhere = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy.run, analysis: JSON.stringify({ ...JSON.parse(analysis), market_run: other.run, market_snapshot_id: other.snapshot }) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(elsewhere.message, /\[REFERENCE\]/);
  assert.deepEqual(JSON.parse(await submit.execute({ strategy: "alpha", run: strategy.run, analysis }, exec(ROLE))), { accepted: true, module: "leader", run: strategy.run });
  const stored = JSON.parse(await readFile(join(root, "alpha", "analysis", strategy.run, "leader.json"), "utf8"));
  assert.equal(stored.market_run, market.run);
  assert.equal(stored.market_snapshot_id, market.snapshot);
  assert.deepEqual(stored.claims[0].evidence_ids, [strategy.quoteId, `sentiment@${market.snapshot}`]);
});

test("module tools with an optional cited run: without market_run the read and submit go on, market_run and market_snapshot_id null", async (t) => {
  const root = await strategiesRoot(t);
  const service = backbone(root);
  const { read, submit } = leaderTools(service, citingContract("optional"));
  const strategy = await strategyRun(service);
  const text = await read.execute({ strategy: "alpha", run: strategy.run }, exec(ROLE));
  const context = JSON.parse(text);
  assert.equal(context.market_run, null);
  assert.equal(context.market, null);
  assert.deepEqual(context.artifacts, []);
  const analysis = JSON.stringify(citingOf(text, [strategy.quoteId]));
  assert.deepEqual(JSON.parse(await submit.execute({ strategy: "alpha", run: strategy.run, analysis }, exec(ROLE))).accepted, true);
});

test("module tools: a contract naming runArtifacts without marketRun shows the run's own accepted artifacts, citable by the run's snapshot", async (t) => {
  const root = await strategiesRoot(t);
  const service = backbone(root);
  const { read, submit } = tools(service, "market", { ...toyContract(), runArtifacts: ["sentiment"] } as any);
  const { run, quoteId } = await frozenRun(service, "cn-market");
  const manifest = await service.sealRun("cn-market", run);
  const dir = join(root, "cn-market", "analysis", run);
  await writeFile(join(dir, "sentiment.json"), JSON.stringify({ module: "sentiment", state: "REPAIR", claims: [] }));
  await writeFile(join(dir, "run.json"), JSON.stringify({ ...manifest, artifacts: ["sentiment"] }));
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  const context = JSON.parse(text);
  const id = `sentiment@${manifest.snapshot_id}`;
  assert.deepEqual(context.artifacts.map((row: any) => row.id), [id]);
  assert.equal(Object.hasOwn(context, "market_run"), false);
  assert.deepEqual(read.parameters.required, ["strategy", "run"]);
  const analysis = JSON.stringify(artifactOf(text, [quoteId, id]));
  assert.deepEqual(JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis }, exec(ROLE))).accepted, true);
});
