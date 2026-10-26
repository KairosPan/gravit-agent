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
