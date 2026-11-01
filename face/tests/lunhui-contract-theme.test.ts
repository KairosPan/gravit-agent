/**
 * The Lunhui theme module (modules spec §5.4, §5.6, A20, A21): its contract
 * (`lib/contracts/theme.mjs`) and its row (`theme-row.mjs`), mounted on the stand-in scope
 * of tests/lunhui-rows.test.ts beside a real `lunhui-runs` service and the real index, limit-up and
 * boards freeze rows over a temp copy of the Tencent and Eastmoney fixtures, so every evidence item
 * the context carries is the shape a freeze writes. Nothing reaches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as themeRow from "../plugins/lunhui/theme-row.mjs";
import { contract, HYPOTHESES } from "../plugins/lunhui/lib/contracts/theme.mjs";
import { BOARD_CODE_PATTERN, MAX_CONTEXT_BYTES, hypothesesVersion } from "../plugins/lunhui/lib/contract-core.mjs";
import {
  ROLE, type Cleanup, type Source, type ToolDef, exec, fakeScope, frozenRun as freezeRun, idWhere, mount as mountRow, rejectsWith, rowsOf,
} from "./lunhui-contract-harness.ts";

const mount = (t: Cleanup, prepare?: (dir: string) => Promise<void>) => mountRow(t, themeRow, prepare);
/** The 问财 stand-in: Eastmoney's board list refused (404) and the fixture's 问财 answering, so the boards freeze lands THS: concepts. */
const standIn = (t: Cleanup, rename?: [string, string]) => mountRow(t, themeRow, async (dir) => {
  await rm(join(dir, "boards.json"));
  if (rename) {
    const file = join(dir, "wencai-universe.json");
    await writeFile(file, (await readFile(file, "utf8")).replaceAll(rename[0], rename[1]));
  }
});
/** A cn-market run frozen through the real rows, the sources in order. */
const frozenRun = (freeze: Record<string, ToolDef>, sources: Source[] = ["boards", "limit-up"], boards?: string[] | null) =>
  freezeRun(freeze, sources, { boards });

/** An artifact over `context` with the envelope copied and `fields` over an OK default. */
function artifact(context: any, fields: Record<string, unknown>) {
  return {
    module: context.module, contract_version: context.contract_version, hypotheses_version: context.hypotheses_version,
    snapshot_id: context.snapshot_id, run: context.run, as_of: context.as_of, session: context.session,
    status: "OK", missing_sources: [], mainline_candidates: [], theme_stage: "UNKNOWN", rotation: "UNKNOWN",
    claims: [], limitations: [],
    ...fields,
  };
}

async function submitted(submit: ToolDef, run: string, analysis: unknown) {
  return JSON.parse(await submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(analysis) }, exec(ROLE)));
}

/** A board's ids in the context: its board row, its member list, its breadth. */
function boardIds(context: any, code: string) {
  return {
    board: idWhere(context, (row) => row.kind === "board" && row.code === code),
    members: idWhere(context, (row) => row.kind === "members" && row.board === code),
    breadth: idWhere(context, (row) => row.measure === "breadth" && row.params.board === code),
    share: idWhere(context, (row) => row.measure === "turnover_share" && row.params.board === code),
  };
}

test("theme row: name, inject, the module's two tools; a mount without the backbone names the row", () => {
  assert.equal(themeRow.name, "lunhui-theme");
  assert.deepEqual(themeRow.inject, ["tools", "lunhuiRuns"]);
  const scope = fakeScope({ lunhuiRuns: {} });
  themeRow.apply(scope.ctx, {});
  assert.deepEqual(scope.tools.map((tool) => tool.name), ["lunhui_read_theme_context", "lunhui_submit_theme"]);
  for (const tool of scope.tools) assert.match(tool.description, /cn-market/);
  assert.throws(() => themeRow.apply(fakeScope().ctx, {}), { message: /^lunhui-theme: .*lunhui-runs/ });
});

test("theme contract: Chinese hypotheses restating THESIS.md hypothesis 3 with its paragraph ids, the headline schema, the sources, the name carve-out", () => {
  assert.equal(contract.hypotheses, HYPOTHESES);
  assert.match(HYPOTHESES, /P0075–P0153/);
  assert.match(HYPOTHESES, /六 P1345–P1464/);
  assert.match(HYPOTHESES, /可修订/);
  const properties = contract.schema.properties as any;
  assert.equal(properties.mainline_candidates.minItems, 0);
  assert.equal(properties.mainline_candidates.maxItems, 5);
  assert.equal(properties.mainline_candidates.items.properties.board.pattern, BOARD_CODE_PATTERN);
  assert.deepEqual(contract.exemptPaths, ["mainline_candidates[*].name", "mainline_candidates[*].board"]);
  assert.equal(properties.mainline_candidates.items.properties.name.maxLength, 40);
  assert.deepEqual(properties.theme_stage.enum, ["START", "FERMENT", "DIVERGE", "CLIMAX", "FADE", "CHAOS", "UNKNOWN"]);
  assert.deepEqual(properties.rotation.enum, ["NONE", "HIGH_LOW_SWITCH", "NEW_DIRECTION", "ROTATING", "UNKNOWN"]);
  assert.deepEqual(contract.schema.required, ["mainline_candidates", "theme_stage", "rotation"]);
  assert.deepEqual(contract.owns, ["theme"]);
  assert.deepEqual(contract.required, ["boards", "limit-up"]);
  assert.deepEqual(contract.sources, ["boards", "limit-up"]);
  assert.equal(typeof contract.hints, "function", "the hints state the boards source's stamps from the digest");
});

test("theme: a context over a real boards and limit-up freeze - OK expected, derived first, member lists cut to 10, at most 30 KiB - whose example is accepted", async (t) => {
  const { root, freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.deepEqual(context.missing, []);
  assert.equal(context.hypotheses_version, hypothesesVersion(HYPOTHESES));
  assert.deepEqual(context.derived.map((row: any) => row.measure), [
    ...Array(4).fill(["breadth", "turnover_share"]).flat(),
    "streak_distribution", "seal_ratio", "break_ratio", "yesterday_return_median", "yesterday_negative_tail",
  ]);
  assert.deepEqual(context.evidence.map((row: any) => row.kind ?? row.pool), [
    "board", "board", "board", "board", "members", "members", "flow", "flow", "flow", "flow", "zt", "zt", "zt", "zt", "zt", "zt",
  ]);
  const file = JSON.parse(await readFile(join(root, "cn-market", "analysis", run, "evidence-boards.json"), "utf8"));
  // The hints: members_total, the members item's own truncated (the source's cut at 100) named apart
  // from the context's list, and the boards source's host and delay stated once.
  assert.match(context.hints.members, /members_total/);
  assert.match(context.hints.members, /成分股证据自带的 truncated.*100.*顶层的 truncated/);
  assert.equal(context.hints.served, "boards 各行来自 push2.eastmoney.com；均非延时行情（delayed 为 false）。");
  // Board, member-list and flow rows carry no per-item stamp, a board no leader; the file keeps them.
  for (const row of context.evidence.filter((row: any) => row.source === "boards"))
    assert.ok(!("host" in row) && !("delayed" in row) && !("leader" in row), `${row.kind} ${row.code ?? row.board}`);
  assert.ok(file.items.every((item: any) => item.kind === "derived" || typeof item.host === "string"));
  // A member list shows its first 10 members, members_total the frozen count.
  for (const row of context.evidence.filter((row: any) => row.kind === "members")) {
    const whole = file.items.find((item: any) => item.kind === "members" && item.board === row.board).members;
    assert.equal(row.members_total, whole.length);
    assert.deepEqual(row.members, whole.slice(0, 10));
  }
  assert.deepEqual(context.evidence.filter((row: any) => row.kind === "members").map((row: any) => [row.board, row.members.length, row.members_total]), [
    ["BK0715", 4, 4], ["BK1716", 10, 100],
  ]);
  // A zt row shows its industry, not its trading fields.
  for (const row of context.evidence.filter((row: any) => row.pool === "zt"))
    assert.deepEqual(Object.keys(row).sort(), ["boards", "code", "id", "industry", "name", "pool", "scope", "source"]);
  assert.deepEqual(context.truncated, [{ source: "limit-up", kind: "zb", count: 3 }, { source: "limit-up", kind: "yesterday", count: 5 }]);
  // A derived row is the shared shape: no source, kind, scope or input ids.
  for (const row of context.derived) {
    assert.ok(Object.keys(row).every((key) => ["id", "measure", "value", "params", "inputs_total"].includes(key)), row.measure);
    assert.ok(Number.isInteger(row.inputs_total));
  }
  const example = context.example;
  assert.equal(example.status, "OK");
  assert.deepEqual([example.mainline_candidates, example.theme_stage, example.rotation], [[], "UNKNOWN", "UNKNOWN"]);
  assert.equal(example.claims.length, 1);
  assert.equal(example.claims[0].basis, "INSUFFICIENT");
  assert.ok(rowsOf(context).some((row) => row.id === example.claims[0].evidence_ids[0]));
  assert.deepEqual(await submitted(submit, run, example), { accepted: true, module: "theme", run });
});

test("theme: a hand-written artifact with two mainline candidates, each citing its board and members, is accepted", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const grid = boardIds(context, "BK0715");
  const compute = boardIds(context, "BK1716");
  const analysis = artifact(context, {
    mainline_candidates: [
      { board: "BK0715", name: "示例电网", evidence_ids: [grid.board, grid.members, grid.breadth] },
      { board: "BK1716", name: "示例算力", evidence_ids: [compute.board, compute.members] },
    ],
    theme_stage: "FERMENT", rotation: "NEW_DIRECTION",
    claims: [
      { id: "c1", text: "主线候选示例电网：板块上涨占比与成交占比见所引派生证据。", basis: "CURRENT", evidence_ids: [grid.breadth, grid.share] },
      { id: "c2", text: "题材候选示例算力的成交占比次之，见所引派生证据。", basis: "CURRENT", evidence_ids: [compute.share, compute.board] },
    ],
    limitations: ["成分股列表只到前 100 只。"],
  });
  assert.equal((await submitted(submit, run, analysis)).accepted, true);
});

test("theme: a candidate must cite its frozen board and its members, under the board's own name - REFERENCE otherwise", async (t) => {
  const { service, freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const grid = boardIds(context, "BK0715");
  const compute = boardIds(context, "BK1716");
  const ev = idWhere(context, (row) => row.kind === "board" && row.code === "BK0493");
  const claims = [{ id: "c1", text: "板块上涨占比见所引派生证据。", basis: "CURRENT", evidence_ids: [grid.breadth] }];
  const cases: Array<[unknown, RegExp]> = [
    // Its board item only.
    [{ board: "BK0715", name: "示例电网", evidence_ids: [grid.board] }, /mainline_candidates\[0\]/],
    // A code the run did not freeze.
    [{ board: "BK9999", name: "示例电网", evidence_ids: [grid.board, grid.members] }, /mainline_candidates\[0\]\.board/],
    // A frozen board whose members were not frozen.
    [{ board: "BK0493", name: "示例新能源车", evidence_ids: [ev] }, /mainline_candidates\[0\]\.board/],
    // Another board's member list.
    [{ board: "BK0715", name: "示例电网", evidence_ids: [grid.board, compute.members] }, /mainline_candidates\[0\]/],
    // A name that is not the board's.
    [{ board: "BK0715", name: "示例算力", evidence_ids: [grid.board, grid.members] }, /mainline_candidates\[0\]\.name/],
  ];
  for (const [candidate, path] of cases) {
    const analysis = artifact(context, { mainline_candidates: [candidate], claims });
    const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(analysis) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] /u);
    assert.match(refusal.message, path);
  }
  // One board, two candidates.
  const twice = { board: "BK0715", name: "示例电网", evidence_ids: [grid.board, grid.members] };
  const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(artifact(context, { mainline_candidates: [twice, twice], claims })) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.mainline_candidates\[1\]/u);
  assert.deepEqual((await service.readRun("cn-market", run)).metrics.rejections.theme, Array(6).fill("REFERENCE"));
});

test("theme: a stage and a rotation other than UNKNOWN each stand on a claim of their own citing a boards measure - REFERENCE otherwise", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const grid = boardIds(context, "BK0715");
  const seal = idWhere(context, (row) => row.measure === "seal_ratio");
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    // A board row is not a measure.
    [{ theme_stage: "START", claims: [{ id: "c1", text: "示例电网的涨跌幅见所引证据。", basis: "CURRENT", evidence_ids: [grid.board] }] }, /theme_stage/],
    // A limit-up measure is not a boards one.
    [{ rotation: "ROTATING", claims: [{ id: "c1", text: "封板率见所引派生证据。", basis: "CURRENT", evidence_ids: [seal] }] }, /rotation/],
    // An INSUFFICIENT claim stands for nothing.
    [{ rotation: "NONE", claims: [
      { id: "c1", text: "板块上涨占比见所引派生证据。", basis: "INSUFFICIENT", evidence_ids: [grid.breadth] },
      { id: "c2", text: "示例电网的涨跌幅见所引证据。", basis: "CURRENT", evidence_ids: [grid.board] },
    ] }, /rotation/],
    // One claim cannot stand for both.
    [{ theme_stage: "DIVERGE", rotation: "HIGH_LOW_SWITCH", claims: [
      { id: "c1", text: "板块上涨占比与成交占比见所引派生证据。", basis: "CURRENT", evidence_ids: [grid.breadth, grid.share] },
    ] }, /each need a claim of their own/],
  ];
  for (const [fields, field] of cases) {
    const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(artifact(context, fields)) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] /u);
    assert.match(refusal.message, field);
  }
});

test("theme: a 题材 sentence needs a derived item of the boards source - a board row or a limit-up measure alone is UNSUPPORTED_SCOPE", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const grid = boardIds(context, "BK0715");
  const seal = idWhere(context, (row) => row.measure === "seal_ratio");
  for (const ids of [[grid.board], [seal], [grid.members]]) {
    const analysis = artifact(context, { claims: [{ id: "c1", text: "题材集中在示例电网。", basis: "CURRENT", evidence_ids: ids }] });
    const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(analysis) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[UNSUPPORTED_SCOPE\] /u);
  }
  // Sentiment is a class the theme module does not own.
  const sentiment = artifact(context, { claims: [{ id: "c1", text: "情绪进入扩张。", basis: "CURRENT", evidence_ids: [grid.breadth] }] });
  const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(sentiment) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[UNSUPPORTED_SCOPE\] /u);
});

test("theme: a candidate's name is the board's own, so an owned or forbidden word in it passes; the same words elsewhere do not", async (t) => {
  // BK0715 renamed to carry the 主线 class word and a trading word, as a live board name may.
  const NAME = "示例主线做多电网";
  const rename = async (dir: string) => {
    const reply = JSON.parse(await readFile(join(dir, "boards.json"), "utf8"));
    reply.data.diff[0].f14 = NAME;
    await writeFile(join(dir, "boards.json"), JSON.stringify(reply));
  };
  const { freeze, read, submit } = await mount(t, rename);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const grid = boardIds(context, "BK0715");
  const claims = [{ id: "c1", text: "板块上涨占比见所引派生证据。", basis: "CURRENT", evidence_ids: [grid.breadth] }];
  const candidate = { board: "BK0715", name: NAME, evidence_ids: [grid.board, grid.members] };
  const elsewhere = artifact(context, { mainline_candidates: [candidate], claims, limitations: [NAME] });
  const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(elsewhere) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[(?:UNSUPPORTED_SCOPE|EXECUTION_CONTENT)\] analysis\.limitations\[0\]/u);
  assert.equal((await submitted(submit, run, artifact(context, { mainline_candidates: [candidate], claims }))).accepted, true);
});

test("theme: a run without boards evidence expects NOT_EVALUABLE - an OK artifact refused, the example accepted", async (t) => {
  const { freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze, ["limit-up"]);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  assert.equal(context.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(context.missing, ["boards"]);
  assert.equal(context.example.status, "NOT_EVALUABLE");
  assert.deepEqual(context.example.missing_sources, ["boards"]);
  assert.deepEqual(context.example.claims, []);
  const seal = idWhere(context, (row) => row.measure === "seal_ratio");
  const ok = artifact(context, { claims: [{ id: "c1", text: "封板率见所引派生证据。", basis: "CURRENT", evidence_ids: [seal] }] });
  const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(ok) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[SCHEMA\] /u);
  assert.equal((await submitted(submit, run, context.example)).accepted, true);
});

test("theme: a full run - index, limit-up and boards frozen - fits 30 KiB; the index never enters, the 炸板 and 昨日涨停 rows are what is left out", async (t) => {
  const { freeze, read } = await mount(t);
  const run = await frozenRun(freeze, ["index", "limit-up", "boards"]);
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.ok(rowsOf(context).every((row) => row.source !== "index"));
  assert.equal(context.derived.length, 13);
  assert.equal(context.evidence.length, 16);
  assert.deepEqual(context.truncated, [{ source: "limit-up", kind: "zb", count: 3 }, { source: "limit-up", kind: "yesterday", count: 5 }]);
});

test("theme: a full run of thirty boards and ten member lists passes 30 KiB - every member list and board row stays, the 涨停 rows and the flow go first", async (t) => {
  // Thirty boards ranked by change, a member list of 100 (of 140) for each of the first ten, thirty flow rows.
  const CODES = Array.from({ length: 30 }, (_, i) => `BK${2000 + i}`);
  const widen = async (dir: string) => {
    const boards = JSON.parse(await readFile(join(dir, "boards.json"), "utf8"));
    const [board] = boards.data.diff;
    boards.data.diff = CODES.map((code, i) => ({ ...board, f12: code, f14: `示例板块${i}`, f3: 9 - i * 0.3, f6: 1e10 - i * 1e8 }));
    await writeFile(join(dir, "boards.json"), JSON.stringify(boards));
    const flow = JSON.parse(await readFile(join(dir, "board-flow.json"), "utf8"));
    const [row] = flow.data.diff;
    flow.data.diff = CODES.map((code, i) => ({ ...row, f12: code, f14: `示例板块${i}`, f62: 1e9 - i * 1e8 }));
    await writeFile(join(dir, "board-flow.json"), JSON.stringify(flow));
    const members = JSON.parse(await readFile(join(dir, "members-BK1716.json"), "utf8"));
    for (const [i, code] of CODES.slice(0, 10).entries()) {
      members.data.diff = members.data.diff.map((member: any, j: number) => ({ ...member, f12: String(300000 + i * 1000 + j), f14: `示例成分${i}-${j}` }));
      await writeFile(join(dir, `members-${code}.json`), JSON.stringify(members));
    }
  };
  const { freeze, read, submit } = await mount(t, widen);
  const run = await frozenRun(freeze, ["index", "limit-up", "boards"], null);
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.equal(context.derived.length, 65, "every derived item is shown");
  // Every board row first, then the member lists in the freeze's order, the top boards' first.
  const kinds = context.evidence.map((row: any) => row.kind ?? row.pool);
  const lists = context.evidence.filter((row: any) => row.kind === "members");
  const flows = context.evidence.filter((row: any) => row.kind === "flow");
  assert.deepEqual(kinds, [...Array(30).fill("board"), ...Array(10).fill("members"), ...Array(flows.length).fill("flow")]);
  assert.equal(lists.length, 10, `${lists.length} member lists shown`);
  assert.deepEqual(lists.map((row: any) => [row.board, row.members.length]), CODES.slice(0, lists.length).map((code) => [code, 10]));
  // Measured 2026-10-26: 30,708 bytes with 15 of the 30 flow rows; the 65 derived rows take 8,576.
  assert.ok(flows.length > 0 && flows.length < 30, `${flows.length} flow rows shown`);
  // What goes first: the flow rows from some row on and every 涨停 row; zb and yesterday are never asked for.
  assert.deepEqual(context.truncated, [
    { source: "boards", kind: "flow", count: 30 - flows.length },
    { source: "limit-up", kind: "zt", count: 6 }, { source: "limit-up", kind: "zb", count: 3 }, { source: "limit-up", kind: "yesterday", count: 5 },
  ]);
  // A candidate on the top board can still cite its board row and member list.
  const top = boardIds(context, "BK2000");
  const analysis = artifact(context, {
    mainline_candidates: [{ board: "BK2000", name: "示例板块0", evidence_ids: [top.board, top.members] }],
    claims: [{ id: "c1", text: "示例板块0 的上涨占比见所引派生证据。", basis: "CURRENT", evidence_ids: [top.breadth] }],
  });
  assert.equal((await submitted(submit, run, analysis)).accepted, true);
});

test("theme: a strategy run is WRONG_CHANNEL", async (t) => {
  const { read } = await mount(t);
  await rejectsWith(read.execute({ strategy: "alpha", run: "nope" }, exec(ROLE)), "WRONG_CHANNEL");
});

test("theme: a stand-in run - a THS: candidate the run froze is accepted, one it did not is REFERENCE; the served hint names 同花顺问财", async (t) => {
  const { freeze, read, submit } = await standIn(t);
  const run = await frozenRun(freeze, ["boards", "limit-up"], null);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  assert.equal(context.hints.served, "板块来自同花顺问财（同花顺概念；涨跌幅为成分股等权平均，不是指数）；各行来自 quantapi.51ifind.com，均非延时行情。");
  // The source is said once, in `served`: no boards row of the context repeats a stamp.
  const boardRows = context.evidence.filter((row: any) => ["board", "members", "flow"].includes(row.kind));
  assert.ok(boardRows.some((row: any) => row.kind === "board") && boardRows.some((row: any) => row.kind === "members") && boardRows.some((row: any) => row.kind === "flow"));
  for (const row of boardRows)
    for (const stamp of ["provider", "taxonomy", "pct_basis", "host", "delayed"])
      assert.equal(Object.hasOwn(row, stamp), false, `${row.kind} row carries ${stamp}`);
  const robot = boardIds(context, "THS:人形机器人");
  const claims = [{ id: "c1", text: "板块上涨占比见所引派生证据。", basis: "CURRENT", evidence_ids: [robot.breadth] }];
  const good = { board: "THS:人形机器人", name: "人形机器人", evidence_ids: [robot.board, robot.members, robot.breadth] };
  const unfrozen = { board: "THS:未冻结", name: "人形机器人", evidence_ids: [robot.board, robot.members] };
  const refusal = await rejectsWith(submit.execute({ strategy: "cn-market", run, analysis: JSON.stringify(artifact(context, { mainline_candidates: [unfrozen], claims })) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.mainline_candidates\[0\]\.board/u);
  assert.equal((await submitted(submit, run, artifact(context, { mainline_candidates: [good], claims }))).accepted, true);
});

test("theme: a candidate's THS: board code is frozen data, outside the wording rules - a board named with a forbidden word passes", async (t) => {
  const { freeze, read, submit } = await standIn(t, ["白酒概念", "买入概念"]);
  const run = await frozenRun(freeze, ["boards", "limit-up"], null);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const ids = boardIds(context, "THS:买入概念");
  const candidate = { board: "THS:买入概念", name: "买入概念", evidence_ids: [ids.board, ids.members] };
  const claims = [{ id: "c1", text: "板块上涨占比见所引派生证据。", basis: "CURRENT", evidence_ids: [ids.breadth] }];
  assert.equal((await submitted(submit, run, artifact(context, { mainline_candidates: [candidate], claims }))).accepted, true);
});

test("theme: a stand-in concept whose name holds an inner space is a citable THS: board", async (t) => {
  const { freeze, read, submit } = await standIn(t, ["人形机器人", "中国机器人 50"]);
  const run = await frozenRun(freeze, ["boards", "limit-up"], null);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  const ids = boardIds(context, "THS:中国机器人 50");
  const candidate = { board: "THS:中国机器人 50", name: "中国机器人 50", evidence_ids: [ids.board, ids.members] };
  const claims = [{ id: "c1", text: "板块上涨占比见所引派生证据。", basis: "CURRENT", evidence_ids: [ids.breadth] }];
  assert.equal((await submitted(submit, run, artifact(context, { mainline_candidates: [candidate], claims }))).accepted, true);
});

test("theme: an Eastmoney run keeps its served hint", async (t) => {
  const { freeze, read } = await mount(t);
  const run = await frozenRun(freeze);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run }, exec(ROLE)));
  assert.equal(context.hints.served, "boards 各行来自 push2.eastmoney.com；均非延时行情（delayed 为 false）。");
});
