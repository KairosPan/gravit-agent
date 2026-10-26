/**
 * The Lunhui sentiment module (modules spec §5.4, §5.6, A20, A21; system-design §4): its contract
 * (`lib/contracts/sentiment.mjs`) and its row (`sentiment-row.mjs`), mounted on the stand-in scope
 * of tests/lunhui-rows.test.ts beside a real `lunhui-runs` service and the real index, limit-up and
 * boards freeze rows over a temp copy of the Tencent and Eastmoney fixtures, so every evidence item
 * the context carries is the shape a freeze writes. Nothing reaches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply as applyRuns } from "../plugins/lunhui/runs-row.mjs";
import * as indexRow from "../plugins/lunhui/freeze-index-row.mjs";
import * as limitUpRow from "../plugins/lunhui/freeze-limit-up-row.mjs";
import * as boardsRow from "../plugins/lunhui/freeze-boards-row.mjs";
import * as sentimentRow from "../plugins/lunhui/sentiment-row.mjs";
import { contract, HYPOTHESES } from "../plugins/lunhui/lib/contracts/sentiment.mjs";
import { MAX_CONTEXT_BYTES, hypothesesVersion } from "../plugins/lunhui/lib/contract-core.mjs";
import { LunhuiError } from "../plugins/lunhui/lib/runs.mjs";

type Cleanup = { after(fn: () => unknown): unknown };
type ToolDef = { name: string; description: string; parameters: any; execute(args: unknown, exec: unknown): Promise<string> };
type Source = "index" | "limit-up" | "boards";

const TENCENT = fileURLToPath(new URL("./fixtures/lunhui/", import.meta.url));
const EASTMONEY = fileURLToPath(new URL("./fixtures/lunhui-eastmoney/", import.meta.url));
/** Friday 2026-10-23, 15:00 in China: after the close of a covered trading day. */
const FRIDAY = new Date("2026-10-23T07:00:00.000Z");
const ROLE = { origin: "subagent" };
/** The boards the fixtures hold member lists for. */
const BOARDS = ["BK0715", "BK1716"];

async function strategiesRoot(t: Cleanup): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lunhui-sentiment-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const strategy of ["cn-market", "alpha"]) {
    await mkdir(join(root, strategy));
    await writeFile(join(root, strategy, "THESIS.md"), `# ${strategy}\n`);
  }
  return root;
}

/** One directory holding both fixture sets. */
async function fixtures(t: Cleanup): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lunhui-sentiment-fixtures-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(TENCENT, dir, { recursive: true });
  await cp(EASTMONEY, dir, { recursive: true });
  return dir;
}

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

/** The backbone, the three market freezes over the fixtures, and the sentiment row's two tools. */
async function mount(t: Cleanup, prepare?: (dir: string) => Promise<void>) {
  const root = await strategiesRoot(t);
  const dir = await fixtures(t);
  await prepare?.(dir);
  const backbone = fakeScope();
  applyRuns(backbone.ctx, { strategiesRoot: root });
  const service = backbone.provided[0][1];
  const freeze: Record<string, ToolDef> = {};
  for (const [source, row] of [["index", indexRow], ["limit-up", limitUpRow], ["boards", boardsRow]] as const) {
    const scope = fakeScope({ lunhuiRuns: service });
    row.apply(scope.ctx, { fetch: dir, now: () => FRIDAY });
    freeze[source] = scope.tools[0];
  }
  const scope = fakeScope({ lunhuiRuns: service });
  sentimentRow.apply(scope.ctx, {});
  const [read, submit] = scope.tools;
  return { root, service, freeze, read, submit };
}

function exec(header: Record<string, unknown> = {}) {
  return { agent: { session: { header } }, signal: new AbortController().signal };
}

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<LunhuiError> {
  let refusal: any;
  await assert.rejects(promise, (error: any) => {
    assert.ok(error instanceof LunhuiError, `a LunhuiError, not ${error?.stack ?? error}`);
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(`^${code}: `));
    refusal = error;
    return true;
  });
  return refusal;
}

/** A cn-market run frozen through the real rows, the sources in order. */
async function frozenRun(freeze: Record<string, ToolDef>, sources: Source[] = ["index", "limit-up"]) {
  let run: string | undefined;
  for (const source of sources) {
    const args = { strategy: "cn-market", ...(run === undefined ? {} : { run }), ...(source === "boards" ? { boards: BOARDS } : {}) };
    run = JSON.parse(await freeze[source].execute(args, exec())).run;
  }
  return run as string;
}

/** The context's rows by id, derived and evidence alike. */
function rowsOf(context: any): any[] {
  return [...context.derived, ...context.evidence];
}
const idWhere = (context: any, test: (row: any) => boolean) => {
  const row = rowsOf(context).find(test);
  assert.ok(row, "the context carries the row the test cites");
  return row.id as string;
};
const measure = (context: any, name: string) => idWhere(context, (row) => row.measure === name);

/** An artifact over `context` with the envelope copied and `fields` over an OK default. */
function artifact(context: any, fields: Record<string, unknown>) {
  return {
    module: context.module, contract_version: context.contract_version, hypotheses_version: context.hypotheses_version,
    snapshot_id: context.snapshot_id, run: context.run, as_of: context.as_of, session: context.session,
    status: "OK", missing_sources: [], state: "UNKNOWN", money_effect: "UNKNOWN", freeze_type: "UNKNOWN",
    conflict: "seal_ratio 偏高而 yesterday_negative_tail 不低，读数方向相反。",
    claims: [], limitations: [],
    ...fields,
  };
}

async function submitted(submit: ToolDef, run: string, analysis: unknown) {
  return JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(analysis) }, exec(ROLE)));
}

test("sentiment row: name, inject, the module's two tools; a mount without the backbone names the row", () => {
  assert.equal(sentimentRow.name, "lunhui-sentiment");
  assert.deepEqual(sentimentRow.inject, ["tools", "lunhuiRuns"]);
  const scope = fakeScope({ lunhuiRuns: {} });
  sentimentRow.apply(scope.ctx, {});
  assert.deepEqual(scope.tools.map((tool) => tool.name), ["lunhui_read_sentiment_context", "lunhui_submit_sentiment"]);
  for (const tool of scope.tools) assert.match(tool.description, /cn-market/);
  assert.throws(() => sentimentRow.apply(fakeScope().ctx, {}), { message: /^lunhui-sentiment: .*lunhui-runs/ });
});

test("sentiment contract: Chinese hypotheses restating THESIS.md hypothesis 2 with its paragraph ids and the seven revisable states, the headline enums, the sources", () => {
  assert.equal(contract.hypotheses, HYPOTHESES);
  assert.match(HYPOTHESES, /二 P0156–P0163/);
  assert.match(HYPOTHESES, /P0020–P0056/);
  for (const state of ["UNKNOWN", "CHAOS", "IGNITION", "EXPANSION", "CLIMAX", "RETREAT", "REPAIR"]) assert.match(HYPOTHESES, new RegExp(state));
  assert.match(HYPOTHESES, /可修订/);
  const properties = contract.schema.properties as any;
  assert.deepEqual(properties.state.enum, ["UNKNOWN", "CHAOS", "IGNITION", "EXPANSION", "CLIMAX", "RETREAT", "REPAIR"]);
  assert.deepEqual(properties.money_effect.enum, ["POSITIVE", "MIXED", "NEGATIVE", "UNKNOWN"]);
  assert.deepEqual(properties.freeze_type.enum, ["NONE", "ICE_POINT", "POST_ICE", "UNKNOWN"]);
  assert.equal(properties.conflict.maxLength, 200);
  assert.deepEqual(contract.schema.required, ["state", "money_effect", "freeze_type"]);
  assert.deepEqual(contract.owns, ["sentiment", "market"]);
  assert.equal(contract.ownedBy, undefined, "the default carrier: a derived item");
  assert.deepEqual(contract.required, ["limit-up", "index"]);
  assert.deepEqual(contract.sources, ["limit-up", "index"]);
  assert.match(JSON.stringify(contract.hints), /conflict/);
  assert.match(JSON.stringify(contract.hints), /CURRENT/);
});

test("sentiment: a context over a real index and limit-up freeze - OK expected, derived first, counts then the pools in order, at most 30 KiB - whose example is accepted", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.deepEqual(context.missing, []);
  assert.equal(context.hypotheses_version, hypothesesVersion(HYPOTHESES));
  assert.deepEqual(context.derived.map((row: any) => row.measure), [
    "streak_distribution", "seal_ratio", "break_ratio", "yesterday_return_median", "yesterday_negative_tail",
    "total_turnover", "advance_decline_ratio", "limit_up_count", "limit_down_count",
  ]);
  assert.deepEqual(context.evidence.map((row: any) => row.kind ?? row.pool), [
    "counts", "zt", "zt", "zt", "zt", "zt", "zt", "zb", "zb", "zb", "yesterday", "yesterday", "yesterday", "yesterday", "yesterday",
  ]);
  const zt = context.evidence.filter((row: any) => row.pool === "zt").map((row: any) => row.boards);
  assert.deepEqual(zt, [...zt].sort((a, b) => b - a), "zt rows by boards, highest first");
  const yesterday = context.evidence.filter((row: any) => row.pool === "yesterday").map((row: any) => row.pct);
  assert.deepEqual(yesterday, [...yesterday].sort((a, b) => a - b), "yesterday rows by pct, lowest first");
  // The index quotes and bars are no row of the module's priority: left out, counted, still citable.
  assert.deepEqual(context.truncated, [{ source: "index", kind: "index", count: 4 }, { source: "index", kind: "bars", count: 4 }]);
  // The example makes no judgment a role could copy: UNKNOWN headlines, a conflict, one INSUFFICIENT claim.
  const example = context.example;
  assert.equal(example.status, "OK");
  assert.deepEqual([example.state, example.money_effect, example.freeze_type], ["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
  assert.equal(typeof example.conflict, "string");
  assert.equal(example.claims.length, 1);
  assert.equal(example.claims[0].basis, "INSUFFICIENT");
  assert.ok(rowsOf(context).some((row) => row.id === example.claims[0].evidence_ids[0]));
  assert.deepEqual(await submitted(submit, run, example), { accepted: true, module: "sentiment", run });
});

test("sentiment: a hand-written EXPANSION citing the pools' derived items and the index evidence is accepted", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const streak = measure(context, "streak_distribution");
  const seal = measure(context, "seal_ratio");
  const median = measure(context, "yesterday_return_median");
  const ratio = measure(context, "advance_decline_ratio");
  const counts = idWhere(context, (row) => row.kind === "counts");
  const analysis = artifact(context, {
    state: "EXPANSION", money_effect: "POSITIVE", freeze_type: "NONE", conflict: undefined,
    claims: [
      { id: "c1", text: "情绪进入扩张：连板高度分布到 5 板，封板率见所引派生证据。", basis: "CURRENT", evidence_ids: [streak, seal] },
      { id: "c2", text: "全市场上涨与下跌家数之比见所引派生证据与家数计数。", basis: "CURRENT", evidence_ids: [ratio, counts] },
      { id: "c3", text: "赚钱效应为正：昨日涨停股的收益中位数见所引派生证据。", basis: "CURRENT", evidence_ids: [median] },
    ],
    limitations: ["缺少分钟级的封板过程。"],
  });
  assert.equal((await submitted(submit, run, analysis)).accepted, true);
});

test("sentiment: a state other than UNKNOWN needs two limit-up ids and one index id across claims not INSUFFICIENT - REFERENCE naming the rule", async (t) => {
  const { service, freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const streak = measure(context, "streak_distribution");
  const seal = measure(context, "seal_ratio");
  const ratio = measure(context, "advance_decline_ratio");
  const zt = idWhere(context, (row) => row.pool === "zt");

  const cases: Array<Record<string, unknown>> = [
    // One limit-up id.
    { state: "EXPANSION", claims: [{ id: "c1", text: "情绪进入扩张，封板率见所引派生证据。", basis: "CURRENT", evidence_ids: [seal, ratio] }] },
    // Two limit-up ids, no index id.
    { state: "CLIMAX", claims: [{ id: "c1", text: "情绪高潮，见所引派生证据。", basis: "CURRENT", evidence_ids: [seal, streak] }] },
    // The second limit-up id sits in an INSUFFICIENT claim: it does not count.
    { state: "REPAIR", claims: [
      { id: "c1", text: "情绪修复，封板率见所引派生证据。", basis: "CURRENT", evidence_ids: [seal, ratio] },
      { id: "c2", text: "涨停池首行见所引证据。", basis: "INSUFFICIENT", evidence_ids: [zt] },
    ] },
  ];
  for (const fields of cases) {
    const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(artifact(context, fields)) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.state: /u);
    assert.match(refusal.message, /two .*limit-up .*one .*index/);
    assert.match(refusal.message, /\n修复：/u);
  }
  assert.deepEqual((await service.readRun("cn-market", run)).metrics.rejections.sentiment, Array(3).fill("REFERENCE"));
  // A pool row counts as limit-up evidence: one row and one derived item, with an index id, stand.
  const rows = artifact(context, { state: "IGNITION", claims: [
    { id: "c1", text: "情绪启动：涨停池首行与封板率见所引证据。", basis: "CURRENT", evidence_ids: [zt, seal] },
    { id: "c2", text: "上涨与下跌家数之比见所引派生证据。", basis: "CURRENT", evidence_ids: [ratio] },
  ] });
  assert.equal((await submitted(submit, run, rows)).accepted, true);
});

test("sentiment: UNKNOWN in an OK artifact needs a conflict naming the indicators - SCHEMA without one", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const seal = measure(context, "seal_ratio");
  const tail = measure(context, "yesterday_negative_tail");
  const claims = [{ id: "c1", text: "封板率偏高而昨日涨停股的负尾占比不低，见所引派生证据。", basis: "CURRENT", evidence_ids: [seal, tail] }];
  const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(artifact(context, { claims, conflict: undefined })) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[SCHEMA\] analysis\.conflict: required\./u);
  assert.equal((await submitted(submit, run, artifact(context, { claims }))).accepted, true);
});

test("sentiment: owned sentences need a derived id - 情绪 citing pool rows alone, and 题材 at all, are UNSUPPORTED_SCOPE", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const seal = measure(context, "seal_ratio");
  const zt = context.evidence.filter((row: any) => row.pool === "zt").map((row: any) => row.id);
  const cases: Array<Record<string, unknown>> = [
    { claims: [{ id: "c1", text: "情绪进入扩张。", basis: "CURRENT", evidence_ids: zt.slice(0, 2) }] },
    { claims: [{ id: "c1", text: "题材集中在少数板块。", basis: "CURRENT", evidence_ids: [seal] }] },
    { conflict: "情绪读数相互矛盾。" },
  ];
  for (const fields of cases) {
    const analysis = artifact(context, { claims: [{ id: "c1", text: "封板率见所引派生证据。", basis: "CURRENT", evidence_ids: [seal] }], ...fields });
    const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(analysis) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[UNSUPPORTED_SCOPE\] /u);
  }
});

test("sentiment: a run without limit-up evidence expects NOT_EVALUABLE - an OK artifact refused, the example accepted", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze, ["index"]);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  assert.equal(context.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(context.missing, ["limit-up"]);
  assert.equal(context.example.status, "NOT_EVALUABLE");
  assert.deepEqual(context.example.missing_sources, ["limit-up"]);
  assert.deepEqual(context.example.claims, []);
  const ratio = measure(context, "advance_decline_ratio");
  const ok = artifact(context, { claims: [{ id: "c1", text: "上涨与下跌家数之比见所引派生证据。", basis: "CURRENT", evidence_ids: [ratio] }] });
  const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(ok) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[SCHEMA\] /u);
  assert.equal((await submitted(submit, run, context.example)).accepted, true);
});

test("sentiment: a full run - index, limit-up and boards frozen - fits 30 KiB; boards never enter, the index quotes and bars are what is left out", async (t) => {
  const { freeze, read } = await mount(t);
  const run = await frozenRun(freeze, ["index", "limit-up", "boards"]);
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.ok(rowsOf(context).every((row) => row.source !== "boards"));
  assert.equal(context.evidence.length, 15);
  assert.deepEqual(context.truncated, [{ source: "index", kind: "index", count: 4 }, { source: "index", kind: "bars", count: 4 }]);
});

test("sentiment: a 涨停 pool past the cap keeps its highest streaks; the rest of it, the 炸板 and 昨日涨停 rows are left out first", async (t) => {
  // A synthetic 涨停 pool of 150 rows, 连板数 1-5, in the live reply's shape.
  const enlarge = async (dir: string) => {
    const reply = JSON.parse(await readFile(join(dir, "zt-pool.json"), "utf8"));
    const [row] = reply.data.pool;
    reply.data.pool = Array.from({ length: 150 }, (_, i) => ({ ...row, c: `60${String(1000 + i)}`, n: `示例${i}`, lbc: (i % 5) + 1 }));
    reply.data.tc = 150;
    await writeFile(join(dir, "zt-pool.json"), JSON.stringify(reply));
  };
  const { freeze, read } = await mount(t, enlarge);
  const run = await frozenRun(freeze, ["index", "limit-up", "boards"]);
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.equal(context.derived.length, 9, "every derived item is shown");
  assert.equal(context.evidence[0].kind, "counts");
  const zt = context.evidence.filter((row: any) => row.pool === "zt").map((row: any) => row.boards);
  assert.ok(zt.length > 0 && zt.length < 150, `${zt.length} zt rows shown`);
  assert.equal(zt[0], 5);
  assert.deepEqual(zt, [...zt].sort((a: number, b: number) => b - a));
  assert.deepEqual(context.truncated.map((entry: any) => [entry.source, entry.kind]), [
    ["limit-up", "zt"], ["limit-up", "zb"], ["limit-up", "yesterday"], ["index", "index"], ["index", "bars"],
  ]);
  assert.equal(context.truncated[0].count, 150 - zt.length);
});

test("sentiment: a strategy run is WRONG_CHANNEL", async (t) => {
  const { read } = await mount(t);
  await rejectsWith(read.execute({ strategy: "alpha", run: "nope" }, exec(ROLE)), "WRONG_CHANNEL");
});
