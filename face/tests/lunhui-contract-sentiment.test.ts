/**
 * The Lunhui sentiment module (modules spec §5.4, §5.6, A20, A21; system-design §4): its contract
 * (`lib/contracts/sentiment.mjs`) and its row (`sentiment-row.mjs`), mounted on the stand-in scope
 * of tests/lunhui-rows.test.ts beside a real `lunhui-runs` service and the real index, limit-up and
 * boards freeze rows over a temp copy of the Tencent and Eastmoney fixtures, so every evidence item
 * the context carries is the shape a freeze writes. Nothing reaches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as sentimentRow from "../plugins/lunhui/sentiment-row.mjs";
import { contract, HYPOTHESES } from "../plugins/lunhui/lib/contracts/sentiment.mjs";
import { MAX_CONTEXT_BYTES, hypothesesVersion } from "../plugins/lunhui/lib/contract-core.mjs";
import {
  ROLE, type Cleanup, type Source, type ToolDef, exec, fakeScope, frozenRun as freezeRun, idWhere, mount as mountRow, rejectsWith, rowsOf,
} from "./lunhui-contract-harness.ts";

const mount = (t: Cleanup, prepare?: (dir: string) => Promise<void>) => mountRow(t, sentimentRow, prepare);
/** A cn-market run frozen through the real rows, the sources in order. */
const frozenRun = (freeze: Record<string, ToolDef>, sources: Source[] = ["index", "limit-up"]) => freezeRun(freeze, sources);
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
  // 情绪 keeps the default carrier, a derived item; 全市场 rests on the counts or an index measure.
  assert.deepEqual(Object.keys(contract.ownedBy as object), ["market"]);
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
  // The conflict shows the format only: no measure a role could copy unobserved.
  assert.doesNotMatch(example.conflict, /[a-z]+_[a-z]+/);
  // Derived items show how many inputs they read, not the ids.
  for (const row of context.derived)
    assert.ok(Object.keys(row).every((key) => ["id", "measure", "value", "params", "partial", "inputs_total"].includes(key)), row.measure);
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

test("sentiment: a money effect and a freeze reading other than UNKNOWN each stand on a claim of their own citing a limit-up measure - REFERENCE otherwise", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const median = measure(context, "yesterday_return_median");
  const seal = measure(context, "seal_ratio");
  const ratio = measure(context, "advance_decline_ratio");
  const zt = idWhere(context, (row) => row.pool === "zt");
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    // An index measure is not a limit-up one.
    [{ money_effect: "POSITIVE", claims: [{ id: "c1", text: "上涨与下跌家数之比见所引派生证据。", basis: "CURRENT", evidence_ids: [ratio] }] }, /money_effect/],
    // A pool row is not a measure.
    [{ freeze_type: "NONE", claims: [{ id: "c1", text: "涨停池首行见所引证据。", basis: "CURRENT", evidence_ids: [zt] }] }, /freeze_type/],
    // An INSUFFICIENT claim stands for nothing.
    [{ freeze_type: "ICE_POINT", claims: [
      { id: "c1", text: "封板率见所引派生证据。", basis: "INSUFFICIENT", evidence_ids: [seal] },
      { id: "c2", text: "涨停池首行见所引证据。", basis: "CURRENT", evidence_ids: [zt] },
    ] }, /freeze_type/],
    // One claim cannot stand for both.
    [{ money_effect: "NEGATIVE", freeze_type: "POST_ICE", claims: [
      { id: "c1", text: "封板率与昨日涨停股收益中位数见所引派生证据。", basis: "CURRENT", evidence_ids: [seal, median] },
    ] }, /each need a claim of their own/],
  ];
  for (const [fields, field] of cases) {
    const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(artifact(context, fields)) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] /u);
    assert.match(refusal.message, field);
  }
  const apart = artifact(context, { money_effect: "NEGATIVE", freeze_type: "POST_ICE", claims: [
    { id: "c1", text: "昨日涨停股收益中位数见所引派生证据。", basis: "CURRENT", evidence_ids: [median] },
    { id: "c2", text: "封板率见所引派生证据。", basis: "CURRENT", evidence_ids: [seal] },
  ] });
  assert.equal((await submitted(submit, run, apart)).accepted, true);
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
    // A whole-market sentence rests on the counts or an index measure, not on a pool's measure.
    { claims: [{ id: "c1", text: "全市场上涨与下跌家数之比偏高。", basis: "CURRENT", evidence_ids: [seal] }] },
  ];
  for (const fields of cases) {
    const analysis = artifact(context, { claims: [{ id: "c1", text: "封板率见所引派生证据。", basis: "CURRENT", evidence_ids: [seal] }], ...fields });
    const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(analysis) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[UNSUPPORTED_SCOPE\] /u);
  }
});

test("sentiment: a whole-market sentence citing the all-shares counts is accepted", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const counts = idWhere(context, (row) => row.kind === "counts");
  const analysis = artifact(context, { claims: [{ id: "c1", text: "全市场上涨与下跌的家数见所引计数。", basis: "CURRENT", evidence_ids: [counts] }] });
  assert.equal((await submitted(submit, run, analysis)).accepted, true);
});

test("sentiment: the claims hint keeps the index words out and names the wording - a claim so worded citing index evidence is accepted, the index word refused", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  for (const word of ["指数", "大盘", "成交额", "流动性", "两市成交合计", "上涨与下跌家数之比"]) assert.match(context.hints.claims, new RegExp(word));
  const turnover = measure(context, "total_turnover");
  const ratio = measure(context, "advance_decline_ratio");
  const counts = idWhere(context, (row) => row.kind === "counts");
  const claims = (first: string) => [
    { id: "c1", text: first, basis: "CURRENT", evidence_ids: [turnover] },
    { id: "c2", text: "上涨与下跌家数之比见所引派生证据与家数计数。", basis: "CURRENT", evidence_ids: [ratio, counts] },
  ];
  const indexWorded = artifact(context, { claims: claims("两市成交额见所引派生证据。") });
  const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(indexWorded) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[UNSUPPORTED_SCOPE\] /u);
  const worded = artifact(context, { claims: claims("两市成交合计见所引派生证据。") });
  assert.deepEqual(await submitted(submit, run, worded), { accepted: true, module: "sentiment", run });
});

test("sentiment: a run without index evidence expects NOT_EVALUABLE naming index - an OK artifact refused, the example accepted", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze, ["limit-up"]);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  assert.equal(context.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(context.missing, ["index"]);
  assert.deepEqual(context.example.missing_sources, ["index"]);
  const seal = measure(context, "seal_ratio");
  const ok = artifact(context, { claims: [{ id: "c1", text: "封板率见所引派生证据。", basis: "CURRENT", evidence_ids: [seal] }] });
  const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(ok) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[SCHEMA\] /u);
  assert.equal((await submitted(submit, run, context.example)).accepted, true);
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
  // Measured 2026-10-26, derived rows in the shared shape: 13,699 bytes, the nine derived rows 989.
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
  // Measured 2026-10-26: 30,488 bytes with 54 of the 150 涨停 rows shown.
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
