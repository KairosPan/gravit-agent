/**
 * The composition check of `lunhui_present`, `plugins/lunhui/lib/present.mjs`: `checkPresent`
 * against the synthetic sealed 10-27 run's view and digest (`syntheticSealedRun()`), and
 * `unsupportedNumbers`, the digest number rule - a number Gravit writes in another form than the
 * digest's ("4,774", "1.3%", "41%" for 0.41, full-width digits) is found, one the digest does not
 * hold is named. Then the row, `present-row.mjs`: `lunhui_present` over a run frozen from the
 * FRIDAY fixtures and sealed by a module context read, as tests/lunhui-rows.test.ts builds one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildView, viewDigest } from "../plugins/lunhui/lib/view.mjs";
import { MODULE_BLOCKS, PRESENT_KINDS, checkPresent, unsupportedNumbers } from "../plugins/lunhui/lib/present.mjs";
import { LunhuiError } from "../plugins/lunhui/lib/runs.mjs";
import * as runsRow from "../plugins/lunhui/runs-row.mjs";
import * as indexRow from "../plugins/lunhui/freeze-index-row.mjs";
import * as limitUpRow from "../plugins/lunhui/freeze-limit-up-row.mjs";
import * as presentRow from "../plugins/lunhui/present-row.mjs";
import { syntheticSealedRun } from "./lunhui-view-fixtures.ts";

const sealed = syntheticSealedRun();
const view = buildView(sealed);
const digest = viewDigest(view);

const ok = (over = {}) => ({ strategy: "cn-market", run: sealed.run, summary: "普跌的一天：567 家上涨、4,774 家下跌。",
  blocks: [{ kind: "verdicts" }, { kind: "breadth", title: "近九成个股下跌" },
    { kind: "indices", title: "14:00 后放量跳水", focus: { from: "14:00", to: "15:00" } },
    { kind: "ladder", title: "断在 3 板：昨天 8 个 2 板", focus: { rung: 3 } }, { kind: "sources" }], choices: [], ...over });

test("an ok composition returns its kinds and the run's market modules", () => {
  assert.deepEqual(checkPresent(ok(), { view, digest, manifest: sealed.manifest }),
    { blocks: ["verdicts", "breadth", "indices", "ladder", "sources"], modules: ["environment", "sentiment", "theme", "counterevidence"] });
});
test("numbers in other forms are found in the digest", () => {
  assert.deepEqual(unsupportedNumbers(["上证跌 1.3%，跌 1.33%", "炸板率 41%", "成交约 1.5 万亿", "１４:００ 后"], digest, new Set()), []);
});
test("numbers the digest does not hold are named", () => {
  assert.deepEqual(unsupportedNumbers(["近九成 88.8%", "上证跌 2.1%", "１４:３７"], digest, new Set()), ["88.8%", "2.1%", "14:37"]);
});
test("run ids, dates and pool codes are exempt", () => {
  assert.deepEqual(unsupportedNumbers([`${sealed.run} 2026-10-27 10-27 10月27日 600001`], digest, new Set(Object.keys(view.stocks))), []);
});
test("each rule refuses with its field", () => {
  const refuse = (args: any, field: string) => assert.throws(() => checkPresent(args, { view, digest, manifest: sealed.manifest }),
    (e: any) => e.code === "INVALID_PRESENT" && e.message.startsWith(`INVALID_PRESENT: ${field}`));
  refuse(ok({ summary: "" }), "summary");
  refuse(ok({ blocks: [] }), "blocks");
  refuse(ok({ blocks: [{ kind: "sources" }, { kind: "sources" }] }), "blocks");
  refuse(ok({ module: "environment" }), "blocks[3].kind");
  refuse(ok({ blocks: [{ kind: "ladder", title: "x".repeat(41) }] }), "blocks[0].title");
  refuse(ok({ blocks: [{ kind: "ladder" }] }), "blocks[0].title");
  refuse(ok({ blocks: [{ kind: "ladder", title: "梯队", focus: { rung: 9 } }] }), "blocks[0].focus");
  refuse(ok({ blocks: [{ kind: "indices", title: "指数", focus: { from: "15:00", to: "14:00" } }] }), "blocks[0].focus");
  refuse(ok({ blocks: [{ kind: "breadth", title: "涨跌", focus: { rung: 1 } }] }), "blocks[0].focus");
  refuse(ok({ choices: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }] }), "choices");
  refuse(ok({ choices: [{ label: "打开", stock: "999999" }] }), "choices[0].stock");
  refuse(ok({ summary: "近九成个股下跌 88.8%" }), "numbers");
});
test("a strategy run is refused", () => {
  assert.throws(() => checkPresent(ok(), { view, digest, manifest: { ...sealed.manifest, kind: "strategy" } }), (e: any) => e.code === "NOT_A_MARKET_RUN");
});
test("an undrawable block is refused with the view's reason", () => {
  const noIndex = buildView({ ...sealed, manifest: { ...sealed.manifest, evidence: sealed.manifest.evidence.filter((e: any) => e.source !== "index") },
    evidence: sealed.evidence.filter((e: any) => e.source !== "index") });
  assert.throws(() => checkPresent(ok({ summary: "普跌" , blocks: [{ kind: "indices", title: "指数" }] }), { view: noIndex, digest: viewDigest(noIndex), manifest: sealed.manifest }),
    (e: any) => e.code === "INVALID_PRESENT" && /index not frozen/.test(e.message));
});
test("a card run's module narrows the modules", () => {
  assert.deepEqual(checkPresent(ok({ module: "sentiment", blocks: [{ kind: "ladder", title: "断在 3 板" }] }), { view, digest, manifest: sealed.manifest }).modules, ["sentiment"]);
});

test("yesterday and signals are in the catalog, and sentiment's card may draw them", () => {
  assert.deepEqual([...PRESENT_KINDS], ["verdicts", "breadth", "indices", "ladder", "yesterday", "signals", "sources"]);
  assert.deepEqual([...MODULE_BLOCKS.sentiment], ["verdicts", "ladder", "yesterday", "signals", "sources"]);
  assert.deepEqual([...MODULE_BLOCKS.environment], ["verdicts", "breadth", "indices", "sources"]);
  assert.deepEqual([...MODULE_BLOCKS.theme], ["verdicts", "sources"]);
  assert.deepEqual([...MODULE_BLOCKS.counterevidence], ["verdicts", "sources"]);
});
test("yesterday and signals need a title", () => {
  for (const kind of ["yesterday", "signals"]) {
    assert.throws(() => checkPresent(ok({ summary: "普跌", blocks: [{ kind }] }), { view, digest, manifest: sealed.manifest }),
      (e: any) => e.code === "INVALID_PRESENT" && e.message.startsWith("INVALID_PRESENT: blocks[0].title"));
  }
});
test("signals on a run without sentiment is refused by reason", () => {
  const noSentiment = buildView(sealed, { modules: ["environment"] });
  assert.throws(() => checkPresent(ok({ summary: "普跌", blocks: [{ kind: "signals", title: "信号" }] }), { view: noSentiment, digest: viewDigest(noSentiment), manifest: sealed.manifest }),
    (e: any) => e.code === "INVALID_PRESENT" && /sentiment/.test(e.message));
});
test("yesterday on a run whose limit-up pools were not frozen is refused with the view's reason", () => {
  const noLimitUp = buildView({ ...sealed, manifest: { ...sealed.manifest, evidence: sealed.manifest.evidence.filter((e: any) => e.source !== "limit-up") },
    evidence: sealed.evidence.filter((e: any) => e.source !== "limit-up") });
  assert.throws(() => checkPresent(ok({ summary: "普跌", blocks: [{ kind: "yesterday", title: "昨日涨停" }] }), { view: noLimitUp, digest: viewDigest(noLimitUp), manifest: sealed.manifest }),
    (e: any) => e.code === "INVALID_PRESENT" && /limit-up not frozen/.test(e.message));
});
test("an ok call may draw yesterday and signals", () => {
  assert.deepEqual(checkPresent(ok({ summary: "普跌", blocks: [{ kind: "yesterday", title: "昨日涨停今日回撤" }, { kind: "signals", title: "收缩与接力" }] }),
    { view, digest, manifest: sealed.manifest }).blocks, ["yesterday", "signals"]);
});

// -------------------------------------------------------------------------------------------------
// The row: `lunhui-present` registers `lunhui_present`, which checks a composition against the
// run's view and digest and, on ok alone, concludes the turn.
// -------------------------------------------------------------------------------------------------

type Cleanup = { after(fn: () => Promise<unknown>): unknown };
type ToolDef = { name: string; description: string; parameters: any; output: any; execute(args: unknown, exec: unknown): Promise<string> };

const TENCENT_FIXTURES = fileURLToPath(new URL("./fixtures/lunhui/", import.meta.url));
const EASTMONEY_FIXTURES = fileURLToPath(new URL("./fixtures/lunhui-eastmoney/", import.meta.url));
/** Friday 2026-10-23, 15:00 in China: after the close of a covered trading day. */
const FRIDAY = new Date("2026-10-23T07:00:00.000Z");

/** A stand-in scope: `provide` and `tools.register` record, `effect` keeps the disposer. */
function fakeScope(extra: Record<string, unknown> = {}) {
  const provided: Array<[string, any]> = [];
  const tools: ToolDef[] = [];
  const disposers: Array<() => unknown> = [];
  const ctx = {
    ...extra,
    effect(fn: () => unknown) { const d = fn(); assert.equal(typeof d, "function"); disposers.push(d as () => unknown); return d; },
    provide(key: string, value: unknown) { const entry: [string, unknown] = [key, value]; provided.push(entry); return () => { provided.splice(provided.indexOf(entry), 1); }; },
    tools: { register(def: ToolDef) { tools.push(def); return () => { tools.splice(tools.indexOf(def), 1); }; } },
  };
  return { ctx, provided, tools, unload: () => { for (const d of disposers.splice(0).reverse()) d(); } };
}

/** An `exec` as dsh hands a tool, counting `concludeTurn` calls; it must be called as a method. */
function countingExec(header: Record<string, unknown> = {}) {
  const exec = {
    calls: 0,
    agent: { session: { header } },
    signal: new AbortController().signal,
    concludeTurn() { assert.equal(this, exec, "concludeTurn is called as a method"); exec.calls += 1; },
  };
  return exec;
}

/** The backbone over a root holding `cn-market`, the index and limit-up freezes over the FRIDAY
 *  fixtures, and the present row over the backbone's service. */
async function presentBench(t: Cleanup) {
  const root = await mkdtemp(join(tmpdir(), "lunhui-present-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "cn-market"));
  await writeFile(join(root, "cn-market", "THESIS.md"), "# cn-market\n");
  const fixtures = await mkdtemp(join(tmpdir(), "lunhui-present-fixtures-"));
  t.after(() => rm(fixtures, { recursive: true, force: true }));
  await cp(TENCENT_FIXTURES, fixtures, { recursive: true });
  await cp(EASTMONEY_FIXTURES, fixtures, { recursive: true });
  const backbone = fakeScope();
  runsRow.apply(backbone.ctx, { strategiesRoot: root });
  const [[, service]] = backbone.provided;
  const rowTool = (row: any, config: unknown) => {
    const scope = fakeScope({ lunhuiRuns: service });
    row.apply(scope.ctx, config);
    return scope.tools[0];
  };
  const freeze = { fetch: fixtures, now: () => FRIDAY };
  return { root, service, index: rowTool(indexRow, freeze), limitUp: rowTool(limitUpRow, freeze), present: rowTool(presentRow, {}) };
}

/** A run frozen (index, limit-up) and sealed by the environment module's context read. */
async function sealedFridayRun(bench: Awaited<ReturnType<typeof presentBench>>) {
  const { run } = JSON.parse(await bench.index.execute({ strategy: "cn-market" }, countingExec()));
  await bench.limitUp.execute({ strategy: "cn-market", run }, countingExec());
  await bench.service.readContext("cn-market", run, "environment", (input: any) => input);
  return run as string;
}

/** A composition whose every number the FRIDAY run's digest holds (asserted against it below). */
const composition = (run: string, over: Record<string, unknown> = {}) => ({
  strategy: "cn-market", run, summary: "上证涨 0.5%，15 家上涨、12 家下跌。",
  blocks: [
    { kind: "indices", title: "14:00 后跌 1.29%", focus: { from: "14:00", to: "15:00" } },
    { kind: "ladder", title: "最高 5 板", focus: { rung: 5 } },
    { kind: "breadth", title: "涨停 6 家、跌停 2 家" },
    { kind: "sources" },
  ],
  choices: [{ label: "看 5 板的票" }],
  ...over,
});

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<LunhuiError> {
  let refusal: any;
  await assert.rejects(promise, (error: any) => {
    assert.ok(error instanceof LunhuiError, `a LunhuiError, not ${error}`);
    assert.equal(error.code, code);
    refusal = error;
    return true;
  });
  return refusal;
}

const PRESENT_DESCRIPTION = "市场运行的作答：一两句结论 summary，按当天轻重排的 blocks（verdicts、breadth、indices、ladder、yesterday、signals、sources），每块一句 title，可标 focus（ladder 的 rung，indices 的 from/to），至多三个 choices。数字只能取自 lunhui_read_run 的 view 摘要。成功即结束本轮。";

test("lunhui-present: name and inject; registers exactly lunhui_present, its description and closed parameters; unload disposes it", async (t) => {
  assert.equal(presentRow.name, "lunhui-present");
  assert.deepEqual(presentRow.inject, ["tools", "lunhuiRuns"]);
  const scope = fakeScope({ lunhuiRuns: {} });
  presentRow.apply(scope.ctx);
  assert.deepEqual(scope.tools.map((tool) => tool.name), ["lunhui_present"]);
  const [tool] = scope.tools;
  assert.equal(tool.description, PRESENT_DESCRIPTION);
  const p = tool.parameters;
  assert.deepEqual(Object.keys(p.properties), ["strategy", "run", "module", "summary", "blocks", "choices"]);
  assert.deepEqual(p.required, ["strategy", "run", "summary", "blocks"]);
  assert.deepEqual(p.properties.module.enum, ["environment", "sentiment", "theme", "counterevidence"]);
  const block = p.properties.blocks.items;
  assert.equal(block.additionalProperties, false);
  assert.deepEqual(block.required, ["kind"]);
  assert.deepEqual(block.properties.kind.enum, ["verdicts", "breadth", "indices", "ladder", "yesterday", "signals", "sources"]);
  assert.equal(block.properties.focus.additionalProperties, false);
  assert.deepEqual(Object.keys(block.properties.focus.properties), ["rung", "from", "to"]);
  assert.equal(block.properties.focus.properties.rung.type, "integer");
  const choice = p.properties.choices.items;
  assert.equal(choice.additionalProperties, false);
  assert.deepEqual(choice.required, ["label"]);
  assert.deepEqual(tool.output.render({}, "x"), [{ type: "text", text: "x" }]);
  scope.unload();
  assert.equal(scope.tools.length, 0);
  assert.throws(() => presentRow.apply(fakeScope().ctx), { message: "lunhui-present: lunhuiRuns is missing; mount the lunhui-runs row first" });
});

test("lunhui_present: a composition from the run's digest is ok, its kinds and modules, and concludes the turn once", async (t) => {
  const bench = await presentBench(t);
  const run = await sealedFridayRun(bench);
  const digest = viewDigest(await bench.service.view("cn-market", run));
  for (const token of ["+0.50%", "15 up", "12 down", "14:00–15:00 −1.29%", "height 5", "limit-up 6", "limit-down 2"])
    assert.ok(digest.includes(token), `the digest holds ${token}: ${digest}`);
  const exec = countingExec();
  const reply = JSON.parse(await bench.present.execute(composition(run), exec));
  assert.deepEqual(reply, { ok: true, blocks: ["indices", "ladder", "breadth", "sources"], modules: [] });
  assert.equal(exec.calls, 1);
});

test("lunhui_present: a number the digest does not hold is INVALID_PRESENT naming it, and the turn goes on", async (t) => {
  const bench = await presentBench(t);
  const run = await sealedFridayRun(bench);
  const exec = countingExec();
  const refusal = await rejectsWith(bench.present.execute(composition(run, { summary: "近九成个股下跌 88.8%" }), exec), "INVALID_PRESENT");
  assert.match(refusal.message, /^INVALID_PRESENT: numbers: .*88\.8%/);
  assert.equal(exec.calls, 0);
  // A second, valid call in the same turn is the one that concludes it.
  await bench.present.execute(composition(run), exec);
  assert.equal(exec.calls, 1);
});

test("lunhui_present: a delegated child is NOT_GRAVIT before anything is read; a seeded fork may present", async (t) => {
  const bench = await presentBench(t);
  const run = await sealedFridayRun(bench);
  let reads = 0;
  const original = bench.service.readRun;
  t.mock.method(bench.service, "readRun", async (...args: unknown[]) => { reads += 1; return original.apply(bench.service, args); });
  const child = countingExec({ origin: "subagent" });
  await rejectsWith(bench.present.execute(composition(run), child), "NOT_GRAVIT");
  assert.equal(reads, 0);
  assert.equal(child.calls, 0);
  const fork = countingExec({ origin: "subagent", isSeeded: true });
  assert.equal(JSON.parse(await bench.present.execute(composition(run), fork)).ok, true);
  assert.equal(fork.calls, 1);
});

test("lunhui_present: an open run is MISSING_EVIDENCE", async (t) => {
  const bench = await presentBench(t);
  const { run } = JSON.parse(await bench.index.execute({ strategy: "cn-market" }, countingExec()));
  const exec = countingExec();
  await rejectsWith(bench.present.execute(composition(run), exec), "MISSING_EVIDENCE");
  assert.equal(exec.calls, 0);
});

test("lunhui_present: a module the run has no artifact of is INVALID_PRESENT module, before the view is built", async (t) => {
  const bench = await presentBench(t);
  const run = await sealedFridayRun(bench);
  let views = 0;
  t.mock.method(bench.service, "view", async () => { views += 1; throw new Error("not reached"); });
  const exec = countingExec();
  const refusal = await rejectsWith(bench.present.execute(composition(run, { module: "sentiment", blocks: [{ kind: "sources" }] }), exec), "INVALID_PRESENT");
  assert.match(refusal.message, /^INVALID_PRESENT: module: /);
  assert.equal(views, 0);
  assert.equal(exec.calls, 0);
});

test("lunhui_present: a sealed strategy run is NOT_A_MARKET_RUN, before the module check and the view", async (t) => {
  const bench = await presentBench(t);
  const run = await sealedFridayRun(bench);
  const file = join(bench.root, "cn-market", "analysis", run, "run.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...manifest, kind: "strategy" }));
  let views = 0;
  t.mock.method(bench.service, "view", async () => { views += 1; throw new Error("not reached"); });
  for (const args of [composition(run), composition(run, { module: "sentiment", blocks: [{ kind: "sources" }] })]) {
    const exec = countingExec();
    await rejectsWith(bench.present.execute(args, exec), "NOT_A_MARKET_RUN");
    assert.equal(exec.calls, 0);
  }
  assert.equal(views, 0);
});

test("lunhui_present: a card run of a module the run holds records that module and views it alone", async (t) => {
  const bench = await presentBench(t);
  const run = await sealedFridayRun(bench);
  const dir = join(bench.root, "cn-market", "analysis", run);
  const manifest = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
  await writeFile(join(dir, "run.json"), JSON.stringify({ ...manifest, artifacts: ["environment"] }));
  await writeFile(join(dir, "environment.json"), JSON.stringify({ module: "environment", analysis: { status: "OK" }, state: "RISK_OFF", claims: [] }));
  const seen: unknown[] = [];
  const original = bench.service.view;
  t.mock.method(bench.service, "view", async (...args: unknown[]) => { seen.push(args[2]); return original.apply(bench.service, args); });
  const exec = countingExec();
  const reply = JSON.parse(await bench.present.execute(composition(run, { module: "environment", blocks: [{ kind: "verdicts" }, { kind: "sources" }], choices: [] }), exec));
  assert.deepEqual(reply, { ok: true, blocks: ["verdicts", "sources"], modules: ["environment"] });
  assert.deepEqual(seen, [{ modules: ["environment"] }]);
  assert.equal(exec.calls, 1);
});

test("lunhui_present: a non-Lunhui failure is INTERNAL and does not conclude the turn", async (t) => {
  const bench = await presentBench(t);
  const run = await sealedFridayRun(bench);
  t.mock.method(bench.service, "view", async () => { throw new Error("view bug"); });
  t.mock.method(process.stderr, "write", () => true);
  const exec = countingExec();
  await rejectsWith(bench.present.execute(composition(run), exec), "INTERNAL");
  assert.equal(exec.calls, 0);
});
