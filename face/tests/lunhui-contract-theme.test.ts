/**
 * The Lunhui theme module (modules spec §5.4, §5.6, A20, A21): its contract
 * (`lib/contracts/theme.mjs`) and its row (`theme-row.mjs`), mounted on the stand-in scope
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
import * as themeRow from "../plugins/lunhui/theme-row.mjs";
import { contract, HYPOTHESES } from "../plugins/lunhui/lib/contracts/theme.mjs";
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
  const root = await mkdtemp(join(tmpdir(), "lunhui-theme-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const strategy of ["cn-market", "alpha"]) {
    await mkdir(join(root, strategy));
    await writeFile(join(root, strategy, "THESIS.md"), `# ${strategy}\n`);
  }
  return root;
}

/** One directory holding both fixture sets. */
async function fixtures(t: Cleanup): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lunhui-theme-fixtures-"));
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

/** The backbone, the three market freezes over the fixtures, and the theme row's two tools. */
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
  themeRow.apply(scope.ctx, {});
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
async function frozenRun(freeze: Record<string, ToolDef>, sources: Source[] = ["boards", "limit-up"]) {
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
  assert.equal(properties.mainline_candidates.items.properties.board.pattern, "^BK\\d{4}$");
  assert.equal(properties.mainline_candidates.items.properties.name.maxLength, 40);
  assert.deepEqual(properties.theme_stage.enum, ["START", "FERMENT", "DIVERGE", "CLIMAX", "FADE", "CHAOS", "UNKNOWN"]);
  assert.deepEqual(properties.rotation.enum, ["NONE", "HIGH_LOW_SWITCH", "NEW_DIRECTION", "ROTATING", "UNKNOWN"]);
  assert.deepEqual(contract.schema.required, ["mainline_candidates", "theme_stage", "rotation"]);
  assert.deepEqual(contract.owns, ["theme"]);
  assert.deepEqual(contract.required, ["boards", "limit-up"]);
  assert.deepEqual(contract.sources, ["boards", "limit-up"]);
  assert.deepEqual(contract.exemptPaths, ["mainline_candidates[*].name"]);
  assert.match(JSON.stringify(contract.hints), /members_total/);
});

test("theme: a context over a real boards and limit-up freeze - OK expected, derived first, member lists cut to 20, at most 30 KiB - whose example is accepted", async (t) => {
  const { root, freeze, read, submit } = await mount(t);
  const run = await frozenRun(freeze);
  const text = await read.execute({ strategy: "cn-market", run }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.deepEqual(context.missing, []);
  assert.equal(context.hypotheses_version, hypothesesVersion(HYPOTHESES));
  assert.deepEqual(context.derived.map((row: any) => row.source), [...Array(8).fill("boards"), ...Array(5).fill("limit-up")]);
  assert.deepEqual(context.evidence.map((row: any) => row.kind ?? row.pool), [
    "board", "board", "board", "board", "flow", "flow", "flow", "flow", "members", "members", "zt", "zt", "zt", "zt", "zt", "zt",
  ]);
  // A member list shows its first 20 members, members_total the frozen count.
  const file = JSON.parse(await readFile(join(root, "cn-market", "analysis", run, "evidence-boards.json"), "utf8"));
  for (const row of context.evidence.filter((row: any) => row.kind === "members")) {
    const whole = file.items.find((item: any) => item.kind === "members" && item.board === row.board).members;
    assert.equal(row.members_total, whole.length);
    assert.deepEqual(row.members, whole.slice(0, 20));
  }
  assert.deepEqual(context.evidence.filter((row: any) => row.kind === "members").map((row: any) => [row.board, row.members.length, row.members_total]), [
    ["BK0715", 4, 4], ["BK1716", 20, 100],
  ]);
  // A zt row shows its industry, not its trading fields.
  for (const row of context.evidence.filter((row: any) => row.pool === "zt"))
    assert.deepEqual(Object.keys(row).sort(), ["boards", "code", "id", "industry", "name", "pool", "scope", "source"]);
  assert.deepEqual(context.truncated, [{ source: "limit-up", kind: "zb", count: 3 }, { source: "limit-up", kind: "yesterday", count: 5 }]);
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

test("theme: a strategy run is WRONG_CHANNEL", async (t) => {
  const { read } = await mount(t);
  await rejectsWith(read.execute({ strategy: "alpha", run: "nope" }, exec(ROLE)), "WRONG_CHANNEL");
});
