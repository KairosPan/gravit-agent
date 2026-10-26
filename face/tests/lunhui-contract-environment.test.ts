/**
 * The Lunhui environment module (modules spec §5.4, §5.6, A20, A21): its contract
 * (`lib/contracts/environment.mjs`) and its row (`environment-row.mjs`), mounted through
 * tests/lunhui-contract-harness.ts beside a real `lunhui-runs` service and the real index and
 * quotes freeze rows over a temp copy of the Tencent and Eastmoney fixtures, so every evidence item
 * the context carries is the shape a freeze writes. Nothing reaches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as environmentRow from "../plugins/lunhui/environment-row.mjs";
import { contract, HYPOTHESES } from "../plugins/lunhui/lib/contracts/environment.mjs";
import { MAX_CONTEXT_BYTES, hypothesesVersion } from "../plugins/lunhui/lib/contract-core.mjs";
import {
  ROLE, type Cleanup, type Source, type ToolDef, exec, fakeScope, frozenRun as freezeRun, idWhere, mount as mountRow, rejectsWith, rowsOf,
} from "./lunhui-contract-harness.ts";

const mount = (t: Cleanup) => mountRow(t, environmentRow);
/** A cn-market run frozen through the real rows: index, then quotes unless `index` alone is asked for. */
const frozenRun = (freeze: Record<string, ToolDef>, sources: Source[] = ["index", "quotes"], symbols?: string[]) =>
  freezeRun(freeze, sources, { symbols });

/** An artifact over `context` with the envelope copied and `fields` over an OK default. */
function artifact(context: any, fields: Record<string, unknown>) {
  return {
    module: context.module, contract_version: context.contract_version, hypotheses_version: context.hypotheses_version,
    snapshot_id: context.snapshot_id, run: context.run, as_of: context.as_of, session: context.session,
    status: "OK", missing_sources: [], index_state: "UNKNOWN", liquidity_state: "UNKNOWN", cycle_anchor: "UNKNOWN",
    claims: [], limitations: [],
    ...fields,
  };
}

test("environment row: name, inject, the module's two tools; a mount without the backbone names the row", () => {
  assert.equal(environmentRow.name, "lunhui-environment");
  assert.deepEqual(environmentRow.inject, ["tools", "lunhuiRuns"]);
  const scope = fakeScope({ lunhuiRuns: {} });
  environmentRow.apply(scope.ctx, {});
  assert.deepEqual(scope.tools.map((tool) => tool.name), ["lunhui_read_environment_context", "lunhui_submit_environment"]);
  for (const tool of scope.tools) assert.match(tool.description, /cn-market/);
  assert.throws(() => environmentRow.apply(fakeScope().ctx, {}), { message: /^lunhui-environment: .*lunhui-runs/ });
});

test("environment contract: Chinese hypotheses restating THESIS.md hypothesis 1 with its paragraph ids, the headline enums, the sources", () => {
  assert.equal(contract.hypotheses, HYPOTHESES);
  assert.match(HYPOTHESES, /一 P0019–P0074/);
  assert.match(HYPOTHESES, /八 P1652–P1708/);
  assert.match(HYPOTHESES, /分开报告/);
  const sentences = HYPOTHESES.split("。").filter((s: string) => s.trim());
  assert.ok(sentences.length >= 3 && sentences.length <= 5, `${sentences.length} sentences`);
  const properties = contract.schema.properties as any;
  assert.deepEqual(properties.index_state.enum, ["STRONG", "NEUTRAL", "WEAK", "UNKNOWN"]);
  assert.deepEqual(properties.liquidity_state.enum, ["EXPANDING", "STABLE", "CONTRACTING", "UNKNOWN"]);
  assert.equal(properties.cycle_anchor.maxLength, 120);
  assert.deepEqual(contract.schema.required, ["index_state", "liquidity_state", "cycle_anchor"]);
  assert.deepEqual(contract.owns, ["index"]);
  assert.deepEqual(contract.required, ["index"]);
  assert.deepEqual(contract.sources, ["index", "quotes"]);
  assert.match(JSON.stringify(contract.hints), /分开/);
  assert.match(JSON.stringify(contract.hints), /CURRENT/);
});

test("environment: a context over a real index and quotes freeze - OK expected, derived first, bars cut to the last 20, at most 30 KiB - whose example is accepted", async (t) => {
  const { root, freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.deepEqual(context.missing, []);
  // With the bars cut, every row of both sources fits: nothing is left out.
  assert.deepEqual(context.truncated, []);
  assert.equal(context.hypotheses_version, hypothesesVersion(HYPOTHESES));
  assert.deepEqual(context.derived.map((row: any) => row.measure), ["total_turnover", "advance_decline_ratio", "limit_up_count", "limit_down_count"]);
  assert.deepEqual(context.evidence.map((row: any) => row.kind), [
    "index", "index", "index", "index", "counts", "bars", "bars", "bars", "bars", "quote", "quote", "history", "history",
  ]);
  for (const row of context.evidence.filter((row: any) => row.kind === "bars" || row.kind === "history")) {
    assert.ok(row.bars.length > 0 && row.bars.length <= 20, `${row.symbol}: ${row.bars.length} bars`);
    assert.ok(row.bars_total >= row.bars.length);
  }
  // The cut is the series' last 20: the frozen file keeps all 120.
  const file = JSON.parse(await readFile(join(root, "cn-market", "analysis", run, "evidence-index.json"), "utf8"));
  const series = file.items.filter((item: any) => item.kind === "bars");
  for (const row of context.evidence.filter((row: any) => row.kind === "bars")) {
    const whole = series.find((item: any) => item.symbol === row.symbol).bars;
    assert.equal(row.bars_total, whole.length);
    assert.deepEqual(row.bars, whole.slice(-20));
  }
  // The example makes no judgment a role could copy: UNKNOWN headlines, one INSUFFICIENT claim citing one digest id.
  assert.equal(context.example.status, "OK");
  assert.deepEqual([context.example.index_state, context.example.liquidity_state, context.example.cycle_anchor], ["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
  assert.equal(context.example.claims.length, 1);
  assert.equal(context.example.claims[0].basis, "INSUFFICIENT");
  assert.equal(context.example.claims[0].evidence_ids.length, 1);
  assert.ok(rowsOf(context).some((row) => row.id === context.example.claims[0].evidence_ids[0]));
  assert.deepEqual(JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(context.example) }, exec(ROLE))), {
    accepted: true, module: "environment", run,
  });
});

test("environment: a hand-written artifact reporting index and liquidity apart is accepted", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const quote = idWhere(context, (row) => row.kind === "index" && row.symbol === "sh000001");
  const bars = idWhere(context, (row) => row.kind === "bars" && row.symbol === "sh000001");
  const turnover = idWhere(context, (row) => row.measure === "total_turnover");
  const ratio = idWhere(context, (row) => row.measure === "advance_decline_ratio");
  const analysis = artifact(context, {
    index_state: "WEAK", liquidity_state: "CONTRACTING", cycle_anchor: "背景偏弱，位置待下一交易日复核",
    claims: [
      { id: "c1", text: "上证指数本运行交易日的报价见所引证据，结合两市成交额合计读为偏弱。", basis: "CURRENT", evidence_ids: [quote, turnover] },
      { id: "c2", text: "sh000001 最近 20 根日线的收盘见所引证据。", basis: "HISTORICAL", evidence_ids: [bars] },
      { id: "c3", text: "流动性读为收缩：两市成交额合计与涨跌比见所引派生证据。", basis: "CURRENT", evidence_ids: [turnover, ratio] },
    ],
    limitations: ["缺少更长周期的量能对照。"],
  });
  assert.equal(JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(analysis) }, exec(ROLE))).accepted, true);
});

test("environment: each rule refuses with its category - an index state without an index quote or bars, a liquidity state without turnover or the advance/decline ratio", async (t) => {
  const { service, freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const quote = idWhere(context, (row) => row.kind === "index" && row.symbol === "sh000001");
  const ratio = idWhere(context, (row) => row.measure === "advance_decline_ratio");
  const limitUp = idWhere(context, (row) => row.measure === "limit_up_count");
  const turnover = idWhere(context, (row) => row.measure === "total_turnover");
  const equity = idWhere(context, (row) => row.kind === "quote" && row.symbol === "sh600519");

  const cases: Array<[Record<string, unknown>, RegExp]> = [
    // An index state citing only a derived ratio.
    [{ index_state: "STRONG", claims: [{ id: "c1", text: "涨跌比读数见所引派生证据。", basis: "CURRENT", evidence_ids: [ratio] }] }, /index_state/],
    // An index state citing an equity quote: the quotes source's, not an index quote or bars.
    [{ index_state: "NEUTRAL", claims: [{ id: "c1", text: "sh600519 报价见所引证据。", basis: "CURRENT", evidence_ids: [equity] }] }, /index_state/],
    // A liquidity state citing an index quote and the limit-up count, neither turnover nor the ratio.
    [{ liquidity_state: "EXPANDING", claims: [{ id: "c1", text: "sh000001 报价与涨停计数见所引证据。", basis: "CURRENT", evidence_ids: [quote, limitUp] }] }, /liquidity_state/],
    // One claim citing both an index quote and turnover stands for one state, not both.
    [{ index_state: "WEAK", liquidity_state: "CONTRACTING", claims: [
      { id: "c1", text: "上证指数报价与两市成交额合计见所引证据，均读为偏弱。", basis: "CURRENT", evidence_ids: [quote, turnover] },
    ] }, /each need a claim of their own/],
    // An INSUFFICIENT claim stands for no state: the index's here, the liquidity's next.
    [{ index_state: "STRONG", claims: [
      { id: "c1", text: "sh000001 报价见所引证据。", basis: "INSUFFICIENT", evidence_ids: [quote] },
      { id: "c2", text: "sh600519 报价见所引证据。", basis: "CURRENT", evidence_ids: [equity] },
    ] }, /index_state/],
    [{ liquidity_state: "EXPANDING", claims: [
      { id: "c1", text: "上涨与下跌家数之比见所引派生证据。", basis: "INSUFFICIENT", evidence_ids: [ratio] },
      { id: "c2", text: "sh600519 报价见所引证据。", basis: "CURRENT", evidence_ids: [equity] },
    ] }, /liquidity_state/],
  ];
  for (const [fields, field] of cases) {
    const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(artifact(context, fields)) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] /u);
    assert.match(refusal.message, field);
    assert.match(refusal.message, /\n修复：/u);
  }
  assert.deepEqual((await service.readRun("cn-market", run)).metrics.rejections.environment, Array(6).fill("REFERENCE"));
  // UNKNOWN headlines need neither.
  const unknown = artifact(context, { claims: [{ id: "c1", text: "sh600519 报价见所引证据。", basis: "CURRENT", evidence_ids: [equity] }] });
  assert.equal(JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(unknown) }, exec(ROLE))).accepted, true);
});

test("environment: an index sentence citing only an index quote is accepted - the index class rests on index evidence, not on a liquidity measure", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const quote = idWhere(context, (row) => row.kind === "index" && row.symbol === "sh000001");
  const analysis = artifact(context, {
    index_state: "STRONG",
    claims: [{ id: "c1", text: "上证指数本运行交易日的报价见所引证据，读为偏强。", basis: "CURRENT", evidence_ids: [quote] }],
  });
  assert.equal(JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(analysis) }, exec(ROLE))).accepted, true);
});

test("environment: a full run - index and quotes for all eight fixture symbols - fits 30 KiB; the index rows are never left out, quote histories go first", async (t) => {
  const { freeze, read } = await mount(t);
  const symbols = ["sh000001", "sz399001", "sz399006", "sh000300", "sh600519", "sh601318", "sz000001", "sz000333"];
  const run = await frozenRun(freeze, ["index", "quotes"], symbols);
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.deepEqual(context.evidence.filter((row: any) => row.source === "index").map((row: any) => row.kind), [
    "index", "index", "index", "index", "counts", "bars", "bars", "bars", "bars",
  ]);
  assert.equal(context.derived.length, 4);
  assert.ok(context.truncated.length > 0, "eight quote histories do not all fit");
  assert.ok(context.truncated.every((entry: any) => entry.source === "quotes"));
  assert.deepEqual([context.truncated[0].source, context.truncated[0].kind], ["quotes", "history"]);
});

test("environment: a run without index evidence expects NOT_EVALUABLE - an OK artifact refused, NOT_EVALUABLE naming index accepted", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze, ["quotes"]);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  assert.equal(context.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(context.missing, ["index"]);
  assert.deepEqual(context.derived, []);
  assert.equal(context.example.status, "NOT_EVALUABLE");
  assert.deepEqual(context.example.missing_sources, ["index"]);
  const equity = idWhere(context, (row) => row.kind === "quote" && row.symbol === "sh600519");
  const ok = artifact(context, { claims: [{ id: "c1", text: "sh600519 报价见所引证据。", basis: "CURRENT", evidence_ids: [equity] }] });
  const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(ok) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[SCHEMA\] /u);
  const notEvaluable = artifact(context, { status: "NOT_EVALUABLE", missing_sources: ["index"], limitations: ["缺少 index 证据，无法评估。"] });
  assert.equal(JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(notEvaluable) }, exec(ROLE))).accepted, true);
});

test("environment: the NOT_EVALUABLE example of a run without index evidence is itself accepted", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze, ["quotes"]);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  assert.equal(JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(context.example) }, exec(ROLE))).accepted, true);
});

test("environment: a strategy run is WRONG_CHANNEL", async (t) => {
  const { read } = await mount(t);
  await rejectsWith(read.execute({ strategy: "alpha", run: "nope" }, exec(ROLE)), "WRONG_CHANNEL");
});
