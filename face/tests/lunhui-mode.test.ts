/**
 * The Lunhui mode module (modules spec §5.4, §5.6, A5, A6, A12, A18, A22, E4): its contract
 * (`lib/contracts/mode.mjs`) and its row (`mode-row.mjs`), mounted on the stand-in scope of
 * tests/lunhui-rows.test.ts beside a real `lunhui-runs` service, the real freeze rows and the real
 * environment, sentiment, theme and leader rows over a temp copy of the Tencent and Eastmoney
 * fixtures, as the leader's tests do: a cn-market run is frozen and its three artifacts accepted -
 * the sentiment one hand-written at the state a case needs - then a run of `lunhui-s01-repair` or
 * `lunhui-s02-rotation` (their THESIS.md copied from the tree) freezes quotes, its leader artifact is
 * accepted, and the mode reads it citing that market run. The reviewer's counterevidence is plan
 * 4's module: a case that needs one writes a hand-made accepted artifact through the runs library's
 * writer, in the shape plan 4 builds to. Nothing reaches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as modeRow from "../plugins/lunhui/mode-row.mjs";
import * as leaderRow from "../plugins/lunhui/leader-row.mjs";
import * as environmentRow from "../plugins/lunhui/environment-row.mjs";
import * as sentimentRow from "../plugins/lunhui/sentiment-row.mjs";
import * as themeRow from "../plugins/lunhui/theme-row.mjs";
import * as quotesRow from "../plugins/lunhui/freeze-quotes-row.mjs";
import {
  CARD_BYTES, contract, FALSIFICATION_BYTES, HYPOTHESES, MODE_FOR, REQUIRED_PRECONDITIONS, R_FAMILIES, falsificationOf, previousCard,
} from "../plugins/lunhui/lib/contracts/mode.mjs";
import { MAX_CONTEXT_BYTES, hypothesesVersion } from "../plugins/lunhui/lib/contract-core.mjs";
import { writeArtifact } from "../plugins/lunhui/lib/runs.mjs";
import {
  ROLE, type Cleanup, type ToolDef, exec, fakeScope, frozenRun, idWhere, mount, rejectsWith, rowsOf,
} from "./lunhui-contract-harness.ts";

const S01 = "lunhui-s01-repair";
const S02 = "lunhui-s02-rotation";
/** The tree's two Lunhui strategies, whose THESIS.md the temp root copies. */
const THESIS = (name: string) => fileURLToPath(new URL(`../../strategies/${name}/THESIS.md`, import.meta.url));
/** Monday 2026-10-26, 15:00 in China: the trading day after the harness's Friday. */
const MONDAY = new Date("2026-10-26T07:00:00.000Z");
/** Tuesday 2026-10-27, 15:00 in China: two trading days after the harness's Friday. */
const TUESDAY = new Date("2026-10-27T07:00:00.000Z");
const SYMBOLS = ["sh600519", "sz000333", "sh601318"];
const MAINLINE = [["BK0715", "示例电网"], ["BK1716", "示例算力"]];

/** The fixture copy: 600519 sealed in the 涨停池, 600519 and 000333 members of BK0715 (the leader's). */
async function addEquities(dir: string) {
  const zt = JSON.parse(await readFile(join(dir, "zt-pool.json"), "utf8"));
  zt.data.pool.push({ ...zt.data.pool[0], c: "600519", m: 1, n: "贵州茅台", lbc: 4, fbt: 93000, lbt: 93000, zttj: { days: 4, ct: 4 } });
  zt.data.tc = zt.data.pool.length;
  await writeFile(join(dir, "zt-pool.json"), JSON.stringify(zt));
  const members = JSON.parse(await readFile(join(dir, "members-BK0715.json"), "utf8"));
  members.data.diff.push({ f3: 0.76, f12: "600519", f14: "贵州茅台" }, { f3: -1.6, f12: "000333", f14: "美的集团" });
  members.data.total = members.data.diff.length;
  await writeFile(join(dir, "members-BK0715.json"), JSON.stringify(members));
}

function tools(service: unknown, row: { apply(ctx: any, config: unknown): void }): ToolDef[] {
  const scope = fakeScope({ lunhuiRuns: service });
  row.apply(scope.ctx, {});
  return scope.tools;
}

async function submitted(submit: ToolDef, strategy: string, run: string, analysis: unknown) {
  return JSON.parse(await submit.execute({ strategy, run, analysis: JSON.stringify(analysis) }, exec(ROLE)));
}

type Setup = {
  state?: string | null; prepare?: (dir: string) => Promise<void>; mainline?: string[][]; boards?: string[] | null;
};

/**
 * A mounted mode row with the two Lunhui strategies and a cn-market run whose three artifacts are
 * accepted: environment its example, sentiment hand-written at `state` (null: its UNKNOWN example),
 * theme naming `mainline` as its mainline candidates.
 */
async function setup(t: Cleanup, { state = "EXPANSION", prepare = addEquities, mainline = MAINLINE, boards }: Setup = {}) {
  let fixtureDir = "";
  const mounted = await mount(t, modeRow, async (dir) => { fixtureDir = dir; await prepare(dir); });
  const { root, service, freeze } = mounted;
  for (const name of [S01, S02]) {
    await mkdir(join(root, name));
    await copyFile(THESIS(name), join(root, name, "THESIS.md"));
  }
  const market = await frozenRun(freeze, ["index", "limit-up", "boards"], boards === undefined ? {} : { boards });
  const [envRead, envSubmit] = tools(service, environmentRow);
  const envContext = JSON.parse(await envRead.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
  assert.equal((await submitted(envSubmit, "cn-market", market, envContext.example)).accepted, true);
  const [sentRead, sentSubmit] = tools(service, sentimentRow);
  const sentContext = JSON.parse(await sentRead.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
  const measure = (name: string) => idWhere(sentContext, (row) => row.measure === name);
  const sentiment = state === null ? sentContext.example : {
    ...sentContext.example, state, money_effect: "UNKNOWN", freeze_type: "UNKNOWN", conflict: undefined,
    claims: [
      { id: "c1", text: "连板高度分布与封板率见所引派生证据。", basis: "CURRENT", evidence_ids: [measure("streak_distribution"), measure("seal_ratio")] },
      { id: "c2", text: "上涨与下跌家数之比见所引派生证据与家数计数。", basis: "CURRENT", evidence_ids: [measure("advance_decline_ratio"), idWhere(sentContext, (row) => row.kind === "counts")] },
    ],
  };
  assert.equal((await submitted(sentSubmit, "cn-market", market, sentiment)).accepted, true);
  const [themeRead, themeSubmit] = tools(service, themeRow);
  const themeContext = JSON.parse(await themeRead.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
  // The claim stands on the first mainline board's breadth, or BK0715's when the theme names none.
  const [lead, leadName] = mainline[0] ?? MAINLINE[0];
  const breadth = idWhere(themeContext, (row) => row.measure === "breadth" && row.params.board === lead);
  assert.equal((await submitted(themeSubmit, "cn-market", market, {
    ...themeContext.example,
    mainline_candidates: mainline.map(([code, name]) => ({ board: code, name, evidence_ids: [
      idWhere(themeContext, (row) => row.kind === "board" && row.code === code),
      idWhere(themeContext, (row) => row.kind === "members" && row.board === code),
    ] })),
    claims: [{ id: "c1", text: `${leadName}的上涨占比见所引派生证据。`, basis: "CURRENT", evidence_ids: [breadth] }],
  })).accepted, true);
  return { ...mounted, market, fixtureDir };
}

/**
 * A strategy run: quotes for `symbols` - frozen on the harness's Friday, or at `now` (Monday, the
 * next session) - then (unless `leader` is false) a leader artifact naming 600519 on its 涨停池 row,
 * citing `market` (the setup's market run by default), accepted through the real leader tools.
 */
async function strategyRun(mounted: Awaited<ReturnType<typeof setup>>, strategy: string,
  { leader = true, symbols = SYMBOLS, now, market = mounted.market }: { leader?: boolean; symbols?: string[]; now?: Date; market?: string } = {}) {
  const { service, freeze, fixtureDir } = mounted;
  let quotes = freeze.quotes;
  if (now !== undefined) {
    const scope = fakeScope({ lunhuiRuns: service });
    quotesRow.apply(scope.ctx, { fetch: fixtureDir, now: () => now });
    quotes = scope.tools[0];
  }
  const run = JSON.parse(await quotes.execute({ strategy, symbols }, exec())).run as string;
  if (leader) {
    const [read, submit] = tools(service, leaderRow);
    const context = JSON.parse(await read.execute({ strategy, run, market_run: market }, exec(ROLE)));
    const quote = rowsOf(context).find((row) => row.kind === "quote" && row.symbol === "sh600519");
    const zt = idWhere(context, (row) => row.pool === "zt" && row.code === "600519");
    assert.equal((await submitted(submit, strategy, run, {
      ...context.example,
      leader_candidates: [{ symbol: "sh600519", name: quote.name, rank: 1, board: null, evidence_ids: [quote.id, zt] }],
      // The quote is of this run's session; the pool row may be the day before's.
      claims: [{ id: "c1", text: `${quote.name}连板数见所引涨停池行。`, basis: "CURRENT", evidence_ids: [zt, quote.id] }],
    })).accepted, true);
  }
  return run;
}

/** A hand-made accepted counterevidence artifact in the run, plan 4's shape, through the runs library's writer. */
async function counterevidence(root: string, strategy: string, run: string, context: any, count = 2, text = "所引报价只有一个交易日，候选地位的持续性待核验。",
  fields: Record<string, unknown> = {}) {
  const quote = idWhere(context, (row) => row.kind === "quote" && row.symbol === "sh600519");
  const dir = await realpath(join(root, strategy, "analysis", run));
  await writeArtifact(dir, "counterevidence", {
    module: "counterevidence", contract_version: "1", hypotheses_version: "h_000000000000", snapshot_id: context.snapshot_id,
    run, as_of: context.as_of, session: context.session, market_run: context.market_run, market_snapshot_id: context.market_snapshot_id,
    status: "OK", missing_sources: [],
    items: Array.from({ length: count }, (_, i) => ({ id: `x${i + 1}`, against: "leader", kind: "MISSING_EVIDENCE", text, evidence_ids: [quote] })),
    claims: [], limitations: [],
    ...fields,
  });
}

/** An artifact over `context` with the envelope copied and `fields` over a WAIT default. */
function artifact(context: any, fields: Record<string, unknown>) {
  return {
    module: context.module, contract_version: context.contract_version, hypotheses_version: context.hypotheses_version,
    snapshot_id: context.snapshot_id, run: context.run, as_of: context.as_of, session: context.session,
    market_run: context.market_run, market_snapshot_id: context.market_snapshot_id,
    status: "OK", missing_sources: [], mode: "WAIT", preconditions: [], research_only_matches: [], expectation: null,
    expectation_review: null, parameters_used: [], addressed: [], claims: [], limitations: [],
    ...fields,
  };
}

/** The ids a mode artifact cites: a quote, a derived measure, an accepted artifact. */
function ids(context: any) {
  return {
    quote: (symbol: string) => idWhere(context, (row) => row.kind === "quote" && row.symbol === symbol),
    measure: (name: string) => idWhere(context, (row) => row.measure === name),
    artifact: (module: string) => context.artifacts.find((row: any) => row.module === module).id as string,
  };
}

/** An S01 registration over `context`: the five preconditions, a card, a parameter, every counterevidence item addressed. */
function registration(context: any, fields: Record<string, unknown> = {}) {
  const id = ids(context);
  return artifact(context, {
    mode: "S01",
    preconditions: [
      { id: "p1", name: "theme_gate", status: "met", evidence_ids: [id.artifact("theme")] },
      { id: "p2", name: "candidate_before_divergence", status: "met", evidence_ids: [id.artifact("leader")] },
      // A mainline board's breadth when the context shows one (none when the theme names no board).
      { id: "p3", name: "theme_not_falsified", status: "met", evidence_ids: [id.artifact("theme"), rowsOf(context).find((row) => row.measure === "breadth")?.id ?? id.artifact("theme")].filter((v, i, a) => a.indexOf(v) === i) },
      { id: "p4", name: "negative_tail_not_widening", status: "met", evidence_ids: [id.measure("yesterday_negative_tail")] },
      { id: "p5", name: "minute_confirmation", status: "unmet: no source", evidence_ids: [] },
    ],
    expectation: {
      frozen_version: context.snapshot_id, candidates: ["sh600519"], anchor: "本运行冻结报价的最新价，不事后换锚。", state: "EXPANSION",
      triggers: ["下一运行冻结的报价涨跌幅为正，且仍在涨停池中。"], vetoes: ["下一运行引用的市场状态为 CLIMAX、RETREAT 或 UNKNOWN。"],
      window: "下一个交易日。", price_band: "以锚点上下百分之五为观察区间。", holding_period: "一个交易日的观察。",
      branches: { 符合: "仍在涨停池且涨跌幅为正。", 强于: "连板数加一。", 弱于: "跌出涨停池或涨跌幅为负。" },
    },
    parameters_used: [{ name: "d_i", value: "未设定", note: "研究候选，没有生产值。" }],
    addressed: [{ item: "x1", response: "记入限制说明，下一运行核对。" }, { item: "x2", response: "同上。", evidence_ids: [id.quote("sh600519")] }],
    // The market run's artifacts and measures are CURRENT on its own session, HISTORICAL the day after.
    claims: [{ id: "c1", text: "S01 登记：前提见所引工件与派生证据，分钟确认缺少来源。", basis: context.market.session === context.session ? "CURRENT" : "HISTORICAL",
      evidence_ids: [id.artifact("theme"), id.measure("yesterday_negative_tail")] }],
    limitations: ["分钟确认缺少来源，只作每日登记。"],
    ...fields,
  });
}

/** A card frozen at `snapshot` whose compact JSON is exactly `size` bytes: the S01 card's fields, its triggers and vetoes filled. */
function cardOf(snapshot: string, size: number) {
  const card: any = {
    frozen_version: snapshot, candidates: ["sh600519"], anchor: "本运行冻结报价的最新价，不事后换锚。", state: "EXPANSION",
    triggers: Array.from({ length: 5 }, (_, i) => `第${i + 1}条：下一运行冻结的报价涨跌幅为正，且仍在涨停池中，连板数不减。`),
    vetoes: Array.from({ length: 5 }, (_, i) => `第${i + 1}条：下一运行引用的市场状态为 CLIMAX、RETREAT 或 UNKNOWN。`),
    window: "下一个交易日。", price_band: "以锚点上下百分之五为观察区间。", holding_period: "一个交易日的观察。",
    branches: { 符合: "仍在涨停池且涨跌幅为正。", 强于: "连板数加一。", 弱于: "跌出涨停池或涨跌幅为负。" },
  };
  const fields = ["anchor", "window", "price_band", "holding_period"];
  for (const field of fields) {
    const deficit = size - Buffer.byteLength(JSON.stringify(card), "utf8");
    const room = 200 - Array.from(card[field]).length;
    const add = Math.min(Math.floor(deficit / 3), room);
    card[field] += "观".repeat(Math.max(add, 0));
  }
  const rest = size - Buffer.byteLength(JSON.stringify(card), "utf8");
  assert.ok(rest >= 0 && rest < 200 - Array.from(card.holding_period).length, `${rest} bytes left`);
  card.holding_period += "0".repeat(rest);
  assert.equal(Buffer.byteLength(JSON.stringify(card), "utf8"), size);
  return card;
}

const refusal = (submit: ToolDef, strategy: string, run: string, analysis: unknown) =>
  rejectsWith(submit.execute({ strategy, run, analysis: JSON.stringify(analysis) }, exec(ROLE)), "INVALID_ANALYSIS");

test("mode row: name, inject, the module's two tools; a mount without the backbone names the row", () => {
  assert.equal(modeRow.name, "lunhui-mode");
  assert.deepEqual(modeRow.inject, ["tools", "lunhuiRuns"]);
  const scope = fakeScope({ lunhuiRuns: {} });
  modeRow.apply(scope.ctx, {});
  assert.deepEqual(scope.tools.map((tool) => tool.name), ["lunhui_read_mode_context", "lunhui_submit_mode"]);
  assert.deepEqual(scope.tools[0].parameters.required, ["strategy", "run", "market_run"]);
  assert.deepEqual(Object.keys(scope.tools[1].parameters.properties), ["strategy", "run", "analysis"]);
  for (const tool of scope.tools) assert.match(tool.description, /策略频道/);
  assert.throws(() => modeRow.apply(fakeScope().ctx, {}), { message: /^lunhui-mode: .*lunhui-runs/ });
});

test("mode contract: Chinese hypotheses of chapters 三 and 七 and P0159, the strategy table, the schema, the wiring, the label carve-outs", () => {
  assert.equal(contract.hypotheses, HYPOTHESES);
  for (const id of [/三 P0164–P0452/, /七 P1610–P1650/, /P0159/, /符合、强于或弱于/]) assert.match(HYPOTHESES, id);
  assert.deepEqual(MODE_FOR, { [S01]: "S01", [S02]: "S02" });
  assert.deepEqual(REQUIRED_PRECONDITIONS, {
    S01: ["theme_gate", "candidate_before_divergence", "theme_not_falsified", "negative_tail_not_widening", "minute_confirmation"],
    S02: ["old_theme_retreat", "catalyst", "candidates_pooled", "minute_confirmation"],
  });
  assert.equal(Object.keys(R_FAMILIES).length, 14);
  assert.equal(R_FAMILIES.R08, "题材轮动/低吸弱方向");
  const properties = contract.schema.properties as any;
  assert.deepEqual(properties.mode.enum, ["S01", "S02", "WAIT"]);
  assert.deepEqual([properties.preconditions.minItems, properties.preconditions.maxItems], [0, 8]);
  assert.deepEqual(properties.preconditions.items.properties.status.enum, ["met", "unmet", "unmet: no source"]);
  assert.deepEqual([properties.research_only_matches.minItems, properties.research_only_matches.maxItems], [0, 14]);
  assert.deepEqual(properties.research_only_matches.items.properties.reason.enum, ["data", "ruling", "registration"]);
  assert.deepEqual(Object.keys(properties.expectation.properties), ["frozen_version", "candidates", "anchor", "state", "triggers", "vetoes", "window", "price_band", "holding_period", "branches"]);
  assert.deepEqual(Object.keys(properties.expectation.properties.branches.properties), ["符合", "强于", "弱于"]);
  assert.deepEqual(properties.expectation_review.properties.grade.enum, ["符合", "强于", "弱于", "NOT_EVALUABLE"]);
  assert.equal(properties.parameters_used.maxItems, 12);
  assert.equal(properties.addressed.items.properties.response.maxLength, 200);
  assert.deepEqual(contract.schema.required, ["mode", "preconditions", "research_only_matches", "expectation", "expectation_review", "parameters_used", "addressed"]);
  assert.deepEqual(contract.owns, []);
  assert.equal(contract.marketRun, "required");
  assert.deepEqual(contract.sources, ["quotes"]);
  assert.deepEqual(contract.marketSources, ["index", "limit-up", "boards"]);
  assert.deepEqual(contract.marketArtifacts, ["sentiment", "theme", "environment"]);
  assert.deepEqual(contract.runArtifacts, ["leader", "counterevidence"]);
  assert.deepEqual(contract.artifactViews, {
    environment: { claims: 0, late: true }, sentiment: { claims: 0 }, theme: { claims: 0 },
    leader: { claims: 2, claimText: 60 }, counterevidence: { claims: 2, claimText: 60 },
  });
  assert.deepEqual(contract.required, ["leader", "market:sentiment", "market:theme"]);
  assert.deepEqual(contract.exemptPaths, ["research_only_matches[*].label", "preconditions[*].name"]);
});

test("mode: the Falsification section read from THESIS.md - to the next heading, at most 1,500 bytes and flagged when cut, null when absent", () => {
  assert.equal(FALSIFICATION_BYTES, 1500);
  assert.deepEqual(falsificationOf("# t\n\n## Falsification\n不是见涨就算修复。\n\n## Next\n别的。\n"), { text: "不是见涨就算修复。", truncated: false });
  assert.equal(falsificationOf("# t\n\n## Rules\n- x\n"), null);
  assert.equal(falsificationOf(null), null);
  const long = falsificationOf(`## Falsification\n${"证".repeat(3000)}\n`)!;
  assert.equal(long.truncated, true);
  assert.equal(long.text, "证".repeat(500), "cut on a character: 500 three-byte characters, 1,500 bytes");
  const exact = falsificationOf(`## Falsification\n${"a".repeat(1500)}\n`)!;
  assert.deepEqual([exact.text.length, exact.truncated], [1500, false], "a section of exactly 1,500 bytes is shown whole");
  // The shipped theses' sections are shown whole.
  for (const name of [S01, S02]) assert.equal(falsificationOf(readFileSync(THESIS(name), "utf8"))!.truncated, false, name);
});

test("mode: a context over an S01 run's quotes citing the day's market run - OK expected, the five artifacts read, the strategy and its falsification, no previous card, at most 30 KiB - whose WAIT example is accepted", async (t) => {
  const mounted = await setup(t);
  const run = await strategyRun(mounted, S01);
  const { read, submit, market } = mounted;
  const text = await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.deepEqual(context.missing, []);
  assert.equal(context.market_run, market);
  assert.equal(context.hypotheses_version, hypothesesVersion(HYPOTHESES));
  assert.equal(context.strategy, S01);
  assert.equal(context.previous, null);
  assert.match(context.falsification, /^\*\*不是见涨就算修复\*\*/);
  assert.match(context.falsification, /Daily registration \(E4\)/, "the shipped section whole, its E4 paragraph included");
  assert.ok(!("falsification_truncated" in context));
  assert.doesNotMatch(context.falsification, /^## /mu);
  // The run's own artifacts first, then the market run's: the cap cuts the market run's first.
  assert.deepEqual(context.artifacts.map((row: any) => row.module), ["leader", "sentiment", "theme", "environment"]);
  assert.match(context.hints.strategy, /S01/);
  assert.match(context.hints.strategy, /REPAIR、EXPANSION/);
  assert.match(context.hints.strategy, /minute_confirmation/);
  // The rows: the run's quotes, the candidate's pool row, the mainline boards' board and member items.
  assert.deepEqual(context.evidence.map((row: any) => [row.source, row.kind ?? row.pool, row.code ?? row.board ?? row.symbol]), [
    ...["sh600519", "sh601318", "sz000333"].map((symbol) => ["quotes", "quote", symbol]),
    ["market:limit-up", "zt", "600519"],
    ["market:boards", "board", "BK0715"], ["market:boards", "board", "BK1716"],
    ["market:boards", "members", "BK0715"], ["market:boards", "members", "BK1716"],
  ]);
  // Derived: index and limit-up whole, boards only the mainline boards'.
  const boardsDerived = context.derived.filter((row: any) => row.params?.board !== undefined);
  assert.deepEqual([...new Set(boardsDerived.map((row: any) => row.params.board))].sort(), ["BK0715", "BK1716"]);
  assert.ok(context.derived.some((row: any) => row.measure === "advance_decline_ratio"));
  assert.ok(context.derived.some((row: any) => row.measure === "yesterday_negative_tail"));
  const example = context.example;
  assert.equal(example.status, "OK");
  assert.equal(example.mode, "WAIT");
  assert.deepEqual([example.preconditions, example.research_only_matches, example.expectation, example.expectation_review], [[], [], null, null]);
  assert.equal(example.claims[0].basis, "INSUFFICIENT");
  assert.deepEqual(await submitted(submit, S01, run, example), { accepted: true, module: "mode", run });
});

test("mode: S01 on a market run whose sentiment is CLIMAX is INADMISSIBLE_STATE", async (t) => {
  const mounted = await setup(t, { state: "CLIMAX" });
  const run = await strategyRun(mounted, S01);
  const { root, read, submit, market } = mounted;
  const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  await counterevidence(root, S01, run, context);
  const reread = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  const error = await refusal(submit, S01, run, registration(reread, { expectation: { ...(registration(reread).expectation as any), state: "CLIMAX" } }));
  assert.match(error.message, /^INVALID_ANALYSIS: \[INADMISSIBLE_STATE\] analysis\.mode/u);
  assert.match(error.message, /修复：/u);
});

test("mode: S01 on EXPANSION with no accepted counterevidence artifact is UNADDRESSED_COUNTEREVIDENCE; an item left unaddressed too; every item addressed is accepted", async (t) => {
  const mounted = await setup(t);
  const run = await strategyRun(mounted, S01);
  const { root, service, read, submit, market } = mounted;
  const bare = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  const none = await refusal(submit, S01, run, registration(bare, { addressed: [] }));
  assert.match(none.message, /^INVALID_ANALYSIS: \[UNADDRESSED_COUNTEREVIDENCE\] /u);
  await counterevidence(root, S01, run, bare);
  const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  assert.deepEqual(context.artifacts.map((row: any) => row.module), ["leader", "counterevidence", "sentiment", "theme", "environment"]);
  assert.deepEqual(context.artifacts[1].headline.items.map((item: any) => item.id), ["x1", "x2"]);
  const partial = await refusal(submit, S01, run, registration(context, { addressed: [{ item: "x1", response: "记入限制说明。" }] }));
  assert.match(partial.message, /^INVALID_ANALYSIS: \[UNADDRESSED_COUNTEREVIDENCE\] analysis\.addressed.*x2/u);
  const unknown = await refusal(submit, S01, run, registration(context, { addressed: [{ item: "x1", response: "a" }, { item: "x2", response: "b" }, { item: "x9", response: "c" }] }));
  assert.match(unknown.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.addressed\[2\]/u);
  assert.deepEqual(await submitted(submit, S01, run, registration(context)), { accepted: true, module: "mode", run });
  const stored = JSON.parse(await readFile(join(root, S01, "analysis", run, "mode.json"), "utf8"));
  assert.equal(stored.mode, "S01");
  assert.deepEqual([stored.market_run, stored.expectation.frozen_version], [market, context.snapshot_id]);
  assert.deepEqual((await service.readRun(S01, run)).metrics.rejections.mode, ["UNADDRESSED_COUNTEREVIDENCE", "UNADDRESSED_COUNTEREVIDENCE", "REFERENCE"]);
});

test("mode: S01's preconditions - each present, met with evidence, the minute confirmation unmet: no source - and its card bound to the run - REFERENCE or SCHEMA otherwise", async (t) => {
  const mounted = await setup(t);
  const { root, read, submit, market } = mounted;
  /** A run of S01 with its leader and two counterevidence items, read: ten calls a module a run, so two runs serve the cases. */
  const ready = async () => {
    const run = await strategyRun(mounted, S01);
    await counterevidence(root, S01, run, JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE))));
    return { run, context: JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE))) };
  };
  let { run, context } = await ready();
  const base = registration(context) as any;
  const pre = (i: number, change: Record<string, unknown>) => base.preconditions.map((p: any, j: number) => (j === i ? { ...p, ...change } : p));
  const card = (change: Record<string, unknown>) => ({ ...base.expectation, ...change });
  const reference: Array<[Record<string, unknown>, RegExp]> = [
    [{ preconditions: base.preconditions.slice(0, 4) }, /analysis\.preconditions/],
    [{ preconditions: pre(0, { status: "unmet", evidence_ids: [] }) }, /analysis\.preconditions\[0\]/],
    [{ preconditions: pre(0, { evidence_ids: [] }) }, /analysis\.preconditions\[0\]/],
    [{ preconditions: pre(4, { status: "met", evidence_ids: [ids(context).quote("sh600519")] }) }, /analysis\.preconditions\[4\]/],
    [{ preconditions: pre(4, { evidence_ids: [ids(context).quote("sh600519")] }) }, /analysis\.preconditions\[4\]\.evidence_ids/],
    [{ expectation: card({ frozen_version: "snap_other" }) }, /analysis\.expectation\.frozen_version/],
    [{ expectation: card({ state: "REPAIR" }) }, /analysis\.expectation\.state/],
    [{ expectation: card({ candidates: ["sz000333"] }) }, /analysis\.expectation\.candidates/],
  ];
  for (const [fields, path] of reference) {
    const error = await refusal(submit, S01, run, { ...base, ...fields });
    assert.match(error.message, /^INVALID_ANALYSIS: \[REFERENCE\] /u, JSON.stringify(fields));
    assert.match(error.message, path);
  }
  ({ run, context } = await ready());
  const second = registration(context) as any;
  Object.assign(base, second);
  for (const fields of [
    { expectation: null }, { parameters_used: [] }, { expectation: card({ triggers: [] }) },
    { preconditions: [...base.preconditions, { ...base.preconditions[0], id: "p6" }] },
  ]) {
    const error = await refusal(submit, S01, run, { ...base, ...fields });
    assert.match(error.message, /^INVALID_ANALYSIS: \[SCHEMA\] analysis\.(?:expectation|parameters_used|preconditions)/u, JSON.stringify(fields));
  }
  // The card is research text: a class word or a trading word in it is refused as anywhere else.
  assert.match((await refusal(submit, S01, run, { ...base, expectation: card({ anchor: "以题材的分歧低点为锚。" }) })).message, /^INVALID_ANALYSIS: \[UNSUPPORTED_SCOPE\] analysis\.expectation\.anchor/u);
  assert.match((await refusal(submit, S01, run, { ...base, expectation: card({ window: "次日开盘买入。" }) })).message, /^INVALID_ANALYSIS: \[EXECUTION_CONTENT\] analysis\.expectation\.window/u);
});

test("mode: S02 is refused while its catalyst has no source; a mode other than the strategy's own is INADMISSIBLE_STATE in either strategy", async (t) => {
  const mounted = await setup(t);
  const { root, read, submit, market } = mounted;
  const s02 = await strategyRun(mounted, S02);
  const bare = JSON.parse(await read.execute({ strategy: S02, run: s02, market_run: market }, exec(ROLE)));
  await counterevidence(root, S02, s02, bare);
  const context = JSON.parse(await read.execute({ strategy: S02, run: s02, market_run: market }, exec(ROLE)));
  assert.match(context.hints.strategy, /catalyst/);
  const id = ids(context);
  const s02Registration = registration(context, {
    mode: "S02",
    preconditions: [
      { id: "p1", name: "old_theme_retreat", status: "met", evidence_ids: [id.artifact("theme")] },
      { id: "p2", name: "catalyst", status: "unmet: no source", evidence_ids: [] },
      { id: "p3", name: "candidates_pooled", status: "met", evidence_ids: [id.artifact("leader")] },
      { id: "p4", name: "minute_confirmation", status: "unmet: no source", evidence_ids: [] },
    ],
  });
  const catalyst = await refusal(submit, S02, s02, s02Registration);
  assert.match(catalyst.message, /^INVALID_ANALYSIS: \[INADMISSIBLE_STATE\] .*catalyst/u);
  const s01InS02 = await refusal(submit, S02, s02, registration(context));
  assert.match(s01InS02.message, /^INVALID_ANALYSIS: \[INADMISSIBLE_STATE\] analysis\.mode/u);
  const s01 = await strategyRun(mounted, S01);
  const s01Context = JSON.parse(await read.execute({ strategy: S01, run: s01, market_run: market }, exec(ROLE)));
  // No counterevidence in this run: nothing to address, and the mode is refused before it is asked for.
  const s02InS01 = await refusal(submit, S01, s01, registration(s01Context, { mode: "S02", addressed: [] }));
  assert.match(s02InS01.message, /^INVALID_ANALYSIS: \[INADMISSIBLE_STATE\] analysis\.mode/u);
});

test("mode: WAIT carries no card - accepted with null, SCHEMA with one; a research_only label is accepted only under research_only_matches as its family's registered name", async (t) => {
  const mounted = await setup(t);
  const run = await strategyRun(mounted, S01);
  const { read, submit, market } = mounted;
  const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  const id = ids(context);
  const claims = [{ id: "c1", text: "本运行登记为 WAIT：分钟确认缺少来源。", basis: "CURRENT", evidence_ids: [id.quote("sh600519")] }];
  const withCard = await refusal(submit, S01, run, artifact(context, { claims, expectation: (registration(context).expectation) }));
  assert.match(withCard.message, /^INVALID_ANALYSIS: \[SCHEMA\] analysis\.expectation/u);
  const match = (family: string, label: string) => ({ family, label, reason: "registration" });
  for (const [matches, expected] of [
    [[match("R02", "题材轮动")], /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.research_only_matches\[0\]\.label/u],
    [[match("R08", "题材主线")], /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.research_only_matches\[0\]\.label/u],
    [[match("R15", "题材轮动")], /^INVALID_ANALYSIS: \[SCHEMA\] analysis\.research_only_matches\[0\]\.family/u],
    [[match("R08", "题材轮动"), match("R08", "低吸弱方向")], /^INVALID_ANALYSIS: \[SCHEMA\] analysis\.research_only_matches/u],
  ] as const) {
    const error = await refusal(submit, S01, run, artifact(context, { claims, research_only_matches: matches }));
    assert.match(error.message, expected);
  }
  // The label as a claim sentence, or anywhere else, is a theme assertion mode does not own.
  for (const fields of [
    { claims: [{ ...claims[0], text: "题材轮动与本运行相符。" }] },
    { claims, limitations: ["R08 题材轮动只作研究登记。"] },
  ]) {
    const error = await refusal(submit, S01, run, artifact(context, fields));
    assert.match(error.message, /^INVALID_ANALYSIS: \[UNSUPPORTED_SCOPE\] /u);
  }
  const accepted = artifact(context, {
    claims,
    preconditions: [{ id: "p1", name: "minute_confirmation", status: "unmet: no source", evidence_ids: [] }],
    research_only_matches: [match("R08", "题材轮动"), { family: "R02", label: "一进二", reason: "ruling" }, { family: "R14", label: "唯一反弹/指数形态择时", reason: "data" }],
  });
  assert.deepEqual(await submitted(submit, S01, run, accepted), { accepted: true, module: "mode", run });
});

test("mode: the next session's run grades the newest earlier session's card - naming that run, citing evidence it froze unless NOT_EVALUABLE; a same-session run or a WAIT in between leaves nothing to grade", async (t) => {
  const mounted = await setup(t);
  const { root, read, submit, market } = mounted;
  /** A run with its leader and counterevidence, read citing the Friday market run. */
  const ready = async (strategy: string, now?: Date) => {
    const run = await strategyRun(mounted, strategy, { now });
    await counterevidence(root, strategy, run, JSON.parse(await read.execute({ strategy, run, market_run: market }, exec(ROLE))));
    return { run, context: JSON.parse(await read.execute({ strategy, run, market_run: market }, exec(ROLE))) };
  };
  // Friday: S01 with a card.
  const first = await ready(S01);
  const card = registration(first.context);
  assert.equal((await submitted(submit, S01, first.run, card)).accepted, true);
  // Friday again: a re-run of the same session grades nothing.
  const rerun = await ready(S01);
  assert.equal(rerun.context.previous, null);
  // Monday: the next session grades Friday's card.
  const monday = await ready(S01, MONDAY);
  const context = monday.context;
  assert.equal(context.session, "2026-10-26");
  assert.deepEqual(context.previous, { run: first.run, snapshot_id: first.context.snapshot_id, session: "2026-10-23", expectation: (card as any).expectation });
  assert.deepEqual(context.example.expectation_review, { previous_run: first.run, grade: "NOT_EVALUABLE", evidence_ids: [] });
  const id = ids(context);
  const claims = [{ id: "c1", text: "上一运行的预期卡对照本运行冻结的报价评为符合。", basis: "CURRENT", evidence_ids: [id.quote("sh600519")] }];
  for (const review of [
    null,
    { previous_run: monday.run, grade: "符合", evidence_ids: [id.quote("sh600519")] },
    { previous_run: first.run, grade: "符合", evidence_ids: [] },
    // Evidence of the cited market run, not an item this run froze.
    { previous_run: first.run, grade: "符合", evidence_ids: [idWhere(context, (row) => row.pool === "zt" && row.code === "600519")] },
  ]) {
    const error = await refusal(submit, S01, monday.run, artifact(context, { claims, expectation_review: review }));
    assert.match(error.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.expectation_review/u, JSON.stringify(review));
  }
  assert.deepEqual(await submitted(submit, S01, monday.run, artifact(context, { claims, expectation_review: { previous_run: first.run, grade: "符合", evidence_ids: [id.quote("sh600519")] } })),
    { accepted: true, module: "mode", run: monday.run });
  // The Friday re-run concludes WAIT: it is now the newest earlier session's mode, so a later Monday
  // run has nothing to grade, and a review is refused.
  assert.equal((await submitted(submit, S01, rerun.run, rerun.context.example)).accepted, true);
  const after = await ready(S01, MONDAY);
  assert.equal(after.context.previous, null);
  assert.equal(after.context.example.expectation_review, null);
  const stray = await refusal(submit, S01, after.run, artifact(after.context, {
    claims: [{ ...claims[0], evidence_ids: [ids(after.context).quote("sh600519")] }],
    expectation_review: { previous_run: first.run, grade: "符合", evidence_ids: [ids(after.context).quote("sh600519")] },
  }));
  assert.match(stray.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.expectation_review/u);
  assert.equal((await submitted(submit, S01, after.run, after.context.example)).accepted, true);
});

test("mode: leader and mode stand on one market run - a mode read citing another market run than the leader's is MISSING_EVIDENCE naming the leader's", async (t) => {
  const mounted = await setup(t);
  const { freeze, service, read, market } = mounted;
  // A second sealed market run of the same Friday.
  const other = await frozenRun(freeze, ["index", "limit-up", "boards"]);
  await service.sealRun("cn-market", other);
  const run = await strategyRun(mounted, S01);
  const error = await rejectsWith(read.execute({ strategy: S01, run, market_run: other }, exec(ROLE)), "MISSING_EVIDENCE");
  assert.match(error.message, new RegExp(market));
  assert.doesNotMatch(error.message, /\//u);
  // The leader's own market run reads.
  assert.equal(JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE))).status_expected, "OK");
});

test("mode: each met precondition cites its own class - REFERENCE on another's evidence, and the theme artifact counts only with a mainline candidate", async (t) => {
  const mounted = await setup(t);
  const { root, read, submit, market } = mounted;
  const run = await strategyRun(mounted, S01);
  await counterevidence(root, S01, run, JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE))));
  const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  const id = ids(context);
  const base = registration(context) as any;
  const cite = (i: number, evidence: string[]) => ({ preconditions: base.preconditions.map((p: any, j: number) => (j === i ? { ...p, evidence_ids: evidence } : p)) });
  for (const [fields, index] of [
    [cite(0, [id.measure("yesterday_negative_tail")]), 0],
    [cite(1, [id.quote("sz000333")]), 1],
    [cite(2, [id.artifact("leader")]), 2],
    [cite(3, [id.artifact("theme")]), 3],
  ] as const) {
    const error = await refusal(submit, S01, run, { ...base, ...fields });
    assert.match(error.message, new RegExp(`^INVALID_ANALYSIS: \\[REFERENCE\\] analysis\\.preconditions\\[${index}\\]\\.evidence_ids`, "u"));
  }
  // Another class member of each passes: a mainline board's members, a candidate's quote, the sentiment artifact.
  const members = idWhere(context, (row) => row.kind === "members" && row.board === "BK0715");
  const zt = idWhere(context, (row) => row.pool === "zt" && row.code === "600519");
  const other = { ...base, ...cite(0, [members]) };
  other.preconditions = other.preconditions.map((p: any, j: number) => (j === 1 ? { ...p, evidence_ids: [id.quote("sh600519"), zt] } : j === 3 ? { ...p, evidence_ids: [id.artifact("sentiment")] } : p));
  assert.equal((await submitted(submit, S01, run, other)).accepted, true);
  // A theme artifact naming no mainline candidate carries no theme precondition.
  const empty = await setup(t, { mainline: [] });
  const emptyRun = await strategyRun(empty, S01);
  await counterevidence(empty.root, S01, emptyRun, JSON.parse(await empty.read.execute({ strategy: S01, run: emptyRun, market_run: empty.market }, exec(ROLE))));
  const emptyContext = JSON.parse(await empty.read.execute({ strategy: S01, run: emptyRun, market_run: empty.market }, exec(ROLE)));
  const error = await refusal(empty.submit, S01, emptyRun, registration(emptyContext, cite(0, [ids(emptyContext).artifact("theme")])));
  assert.match(error.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.preconditions\[0\]\.evidence_ids/u);
});

test("mode: the A22 gate takes a counterevidence artifact accepted OK with an items array - NOT_EVALUABLE or malformed is UNADDRESSED_COUNTEREVIDENCE, an empty review is accepted", async (t) => {
  const mounted = await setup(t);
  const { root, read, submit, market } = mounted;
  for (const [fields, accepted] of [
    [{ status: "NOT_EVALUABLE", missing_sources: ["leader"], items: [] }, false],
    [{ items: { x1: "not a list" } }, false],
    [{ items: [{ text: "no id" }] }, false],
    // Bound to the mode's market run (A22): another run's, or none, is no review of this one.
    [{ market_run: "m_other_run" }, false],
    [{ market_run: undefined }, false],
    [{ items: [] }, true],
  ] as const) {
    const run = await strategyRun(mounted, S01);
    await counterevidence(root, S01, run, JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE))), 0, "", fields);
    const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
    const analysis = registration(context, { addressed: [] });
    if (accepted) assert.deepEqual(await submitted(submit, S01, run, analysis), { accepted: true, module: "mode", run });
    else {
      assert.match((await refusal(submit, S01, run, analysis)).message, /^INVALID_ANALYSIS: \[UNADDRESSED_COUNTEREVIDENCE\] analysis\.addressed/u, JSON.stringify(fields));
      // The gate speaks before an answer is checked: an answer to an item of no usable review is not REFERENCE.
      const answered = registration(context, { addressed: [{ item: "x1", response: "记入限制说明。" }] });
      assert.match((await refusal(submit, S01, run, answered)).message, /^INVALID_ANALYSIS: \[UNADDRESSED_COUNTEREVIDENCE\] analysis\.addressed[^[]/u, JSON.stringify(fields));
    }
  }
  const run = await strategyRun(mounted, S01);
  await counterevidence(root, S01, run, JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE))), 2, undefined, { market_run: "m_other_run" });
  const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  assert.match((await refusal(submit, S01, run, registration(context))).message, new RegExp(`^INVALID_ANALYSIS: \\[UNADDRESSED_COUNTEREVIDENCE\\] .*market run ${market}`, "u"));
  assert.match(context.hints.addressed, /market_run/);
});

test("mode: a card is at most 2,048 bytes of compact JSON - one byte more is BYTE_LIMIT; the expectation hint names no 目标价", async (t) => {
  assert.equal(CARD_BYTES, 2048);
  const mounted = await setup(t);
  const { root, read, submit, market } = mounted;
  const run = await strategyRun(mounted, S01);
  await counterevidence(root, S01, run, JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE))));
  const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  assert.doesNotMatch(context.hints.expectation, /目标价/u);
  assert.match(context.hints.expectation, /2,048/u);
  const over = registration(context, { expectation: cardOf(context.snapshot_id, CARD_BYTES + 1) });
  const error = await refusal(submit, S01, run, over);
  assert.match(error.message, /^INVALID_ANALYSIS: \[BYTE_LIMIT\] analysis\.expectation/u);
  assert.match(error.message, /2,048/u);
  assert.deepEqual(await submitted(submit, S01, run, registration(context, { expectation: cardOf(context.snapshot_id, CARD_BYTES) })), { accepted: true, module: "mode", run });
});

test("mode: the previous card is shown as stored up to 2,048 bytes; a larger stored card is shown cut - strings to 120 characters, ids whole, card_truncated - within 2,048 bytes", () => {
  const snapshot = `snap_${"a".repeat(64)}`;
  const exact = cardOf(snapshot, CARD_BYTES);
  assert.deepEqual(previousCard(exact), { expectation: exact });
  // A card stored before the cap, at its schema's fullest: seventeen 200-character strings.
  const long = (n: number) => `${n}`.padEnd(200, "观");
  const full = {
    frozen_version: snapshot, candidates: ["sh600519", "sz000333", "sh601318", "sz000001", "sh600000"], anchor: long(1), state: "EXPANSION",
    triggers: [2, 3, 4, 5, 6].map(long), vetoes: [7, 8, 9, 10, 11].map(long), window: long(12), price_band: long(13), holding_period: long(14),
    branches: { 符合: long(15), 强于: long(16), 弱于: long(17) },
  };
  const shown = previousCard(full);
  assert.equal(shown.card_truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(shown.expectation), "utf8") <= CARD_BYTES, `${Buffer.byteLength(JSON.stringify(shown.expectation), "utf8")} bytes`);
  assert.deepEqual(Object.keys(shown.expectation), Object.keys(full));
  assert.deepEqual([shown.expectation.frozen_version, shown.expectation.candidates, shown.expectation.state], [snapshot, full.candidates, "EXPANSION"]);
  // The state is an enum, never cut, at any cut: even the shortest.
  assert.equal(previousCard({ ...full, state: "EXPANSION" }).expectation.state, "EXPANSION");
  assert.ok(full.anchor.startsWith(shown.expectation.anchor) && Array.from(shown.expectation.anchor).length <= 120);
  // A card over the cap whose strings at 120 characters fit is cut to exactly 120.
  const middle = { ...full, triggers: ["下一运行冻结的报价涨跌幅为正。"], vetoes: ["引用的市场状态为 UNKNOWN。"], holding_period: "一个交易日的观察。",
    branches: { 符合: "仍在涨停池。", 强于: "连板数加一。", 弱于: "跌出涨停池。" } };
  assert.ok(Buffer.byteLength(JSON.stringify(middle), "utf8") > CARD_BYTES);
  const cut = previousCard(middle);
  assert.equal(cut.card_truncated, true);
  assert.equal(Array.from(cut.expectation.anchor).length, 120);
  assert.equal(cut.expectation.state, middle.state);
});

test("mode: theme_gate and theme_not_falsified accept a boards derived item only of a mainline board", async (t) => {
  const mounted = await setup(t, { mainline: [MAINLINE[0]] });
  const { root, service, read, submit, market } = mounted;
  const [themeRead] = tools(service, themeRow);
  const themeContext = JSON.parse(await themeRead.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
  const outside = idWhere(themeContext, (row) => row.measure === "breadth" && row.params?.board === "BK1716");
  const inside = idWhere(themeContext, (row) => row.measure === "breadth" && row.params?.board === "BK0715");
  const run = await strategyRun(mounted, S01);
  await counterevidence(root, S01, run, JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE))));
  const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  const base = registration(context) as any;
  const cite = (i: number, evidence: string[]) => ({ ...base, preconditions: base.preconditions.map((p: any, j: number) => (j === i ? { ...p, evidence_ids: evidence } : p)) });
  for (const index of [0, 2]) {
    const error = await refusal(submit, S01, run, cite(index, [outside]));
    assert.match(error.message, new RegExp(`^INVALID_ANALYSIS: \\[REFERENCE\\] analysis\\.preconditions\\[${index}\\]\\.evidence_ids`, "u"));
  }
  const both = cite(0, [inside]);
  both.preconditions[2] = { ...both.preconditions[2], evidence_ids: [inside] };
  assert.deepEqual(await submitted(submit, S01, run, both), { accepted: true, module: "mode", run });
});

test("mode: a run without a leader artifact expects NOT_EVALUABLE naming leader - an OK artifact refused, the example accepted", async (t) => {
  const mounted = await setup(t);
  const run = await strategyRun(mounted, S01, { leader: false });
  const { read, submit, market } = mounted;
  const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  assert.equal(context.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(context.missing, ["leader"]);
  assert.deepEqual(context.example.missing_sources, ["leader"]);
  assert.equal(context.example.mode, "WAIT");
  const ok = artifact(context, { claims: [{ id: "c1", text: "本运行登记为 WAIT。", basis: "CURRENT", evidence_ids: [ids(context).quote("sh600519")] }] });
  assert.match((await refusal(submit, S01, run, ok)).message, /^INVALID_ANALYSIS: \[SCHEMA\] /u);
  assert.equal((await submitted(submit, S01, run, context.example)).accepted, true);
});

test("mode: a cn-market run is WRONG_CHANNEL; a market run two trading days before the strategy run is STALE_MARKET_RUN; a strategy without a Falsification section reads null", async (t) => {
  const mounted = await setup(t);
  const { read, market, service, fixtureDir } = mounted;
  await rejectsWith(read.execute({ strategy: "cn-market", run: market, market_run: market }, exec(ROLE)), "WRONG_CHANNEL");
  const scope = fakeScope({ lunhuiRuns: service });
  quotesRow.apply(scope.ctx, { fetch: fixtureDir, now: () => TUESDAY });
  const tuesday = JSON.parse(await scope.tools[0].execute({ strategy: S01, symbols: SYMBOLS }, exec())).run;
  await rejectsWith(read.execute({ strategy: S01, run: tuesday, market_run: market }, exec(ROLE)), "STALE_MARKET_RUN");
  const alpha = await strategyRun(mounted, "alpha");
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: alpha, market_run: market }, exec(ROLE)));
  assert.equal(context.falsification, null);
  assert.ok(!("falsification_unreadable" in context));
  // A THESIS.md past the read's 64 KiB cap: unreadable, said so, not a refusal.
  await mkdir(join(mounted.root, "gamma"));
  await writeFile(join(mounted.root, "gamma", "THESIS.md"), `## Falsification\n${"证".repeat(23 * 1024)}\n`);
  const gamma = await strategyRun(mounted, "gamma");
  const unreadable = JSON.parse(await read.execute({ strategy: "gamma", run: gamma, market_run: market }, exec(ROLE)));
  assert.deepEqual([unreadable.falsification, unreadable.falsification_unreadable], [null, true]);
  assert.equal(context.strategy, "alpha");
  assert.match(context.hints.strategy, /WAIT/);
});

test("mode: a live-size market run - three 500-row pools, thirty boards, ten 100-member lists - with four equities and twelve counterevidence items fits 30 KiB, every artifact and quote shown", async (t) => {
  const CODES = Array.from({ length: 30 }, (_, i) => `BK${2000 + i}`);
  const EQUITIES = ["sh600519", "sz000333", "sh601318", "sz000001"];
  const widen = async (dir: string) => {
    for (const [pool, file, base] of [["zt", "zt-pool.json", 680000], ["zb", "zb-pool.json", 690000], ["yesterday", "yesterday-pool.json", 830000]] as const) {
      const reply = JSON.parse(await readFile(join(dir, file), "utf8"));
      const [row] = reply.data.pool;
      reply.data.pool = Array.from({ length: 500 }, (_, k) => ({ ...row, c: String(base + k), n: `示例${pool}${k}` }));
      if (pool === "zt") reply.data.pool[450] = { ...row, c: "600519", n: "示例600519", lbc: 4 };
      if (pool === "yesterday") reply.data.pool[10] = { ...row, c: "600519", n: "示例600519" };
      reply.data.tc = 500;
      await writeFile(join(dir, file), JSON.stringify(reply));
    }
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
      if (code === "BK2000") members.data.diff[50] = { ...members.data.diff[50], f12: "600519", f14: "示例600519" };
      await writeFile(join(dir, `members-${code}.json`), JSON.stringify(members));
    }
  };
  const mainline = [["BK2000", "示例板块0"], ["BK2001", "示例板块1"], ["BK2002", "示例板块2"]];
  const mounted = await setup(t, { prepare: widen, mainline, boards: null });
  const { root, read, submit, market } = mounted;
  // An operator's Falsification section of about 6 KiB: the context shows its first 1,500 bytes, flagged.
  const longSection = "下一个交易日的运行对照冻结的事实评级，登记从不等于确认。".repeat(75);
  assert.ok(Buffer.byteLength(longSection, "utf8") >= 6000);
  const thesisPath = join(root, S01, "THESIS.md");
  await writeFile(thesisPath, (await readFile(thesisPath, "utf8")).replace("## Falsification\n", `## Falsification\n${longSection}\n\n`));
  // Twelve items of 160 characters each, the reviewer's whole allowance of items and text.
  const item = "候选的地位只有一个交易日的冻结证据，".repeat(9).slice(0, 160);
  const addressed = Array.from({ length: 12 }, (_, i) => ({ item: `x${i + 1}`, response: "记入限制说明，下一运行核对。" }));
  /** A run of S01 with its leader and twelve counterevidence items, read citing the market run. */
  const ready = async (now?: Date) => {
    const run = await strategyRun(mounted, S01, { symbols: EQUITIES, now });
    await counterevidence(root, S01, run, JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE))), 12, item);
    return { run, text: await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)) };
  };
  const first = await ready();
  assert.equal((await submitted(submit, S01, first.run, registration(JSON.parse(first.text), { addressed }))).accepted, true);
  // Monday's run carries Friday's card too: the fullest context a run of S01 reads.
  const { run, text } = await ready(MONDAY);
  // Measured 2026-10-26: 29,293 bytes with the previous card and twelve 160-character items, nothing the mode cites cut by the cap.
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES, `${Buffer.byteLength(text, "utf8")} bytes`);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.equal(context.previous.run, first.run);
  assert.deepEqual(context.artifacts.map((row: any) => row.module), ["leader", "counterevidence", "sentiment", "theme", "environment"]);
  assert.equal(context.artifacts[1].headline.items.length, 12);
  assert.equal(context.falsification_truncated, true, "the long section is cut and flagged");
  assert.ok(Buffer.byteLength(context.falsification, "utf8") <= FALSIFICATION_BYTES);
  assert.ok(longSection.startsWith(context.falsification), "its first 1,500 bytes, on a character");
  assert.deepEqual(context.evidence.filter((row: any) => row.kind === "quote").map((row: any) => row.symbol).sort(), [...EQUITIES].sort());
  assert.deepEqual(context.evidence.filter((row: any) => row.source === "market:limit-up").map((row: any) => [row.pool, row.code]).sort(), [["yesterday", "600519"], ["zt", "600519"]]);
  assert.deepEqual(context.evidence.filter((row: any) => row.kind === "board").map((row: any) => row.code), ["BK2000", "BK2001", "BK2002"]);
  assert.deepEqual(context.evidence.filter((row: any) => row.kind === "members").map((row: any) => row.board), ["BK2000", "BK2001", "BK2002"]);
  assert.deepEqual([...new Set(context.derived.filter((row: any) => row.params?.board !== undefined).map((row: any) => row.params.board))], ["BK2000", "BK2001", "BK2002"]);
  // What is left out is what the filters leave out: no artifact, no quote, no derived item of index or limit-up.
  assert.deepEqual(context.truncated.map((row: any) => `${row.source} ${row.kind}`).sort(), [
    "market:boards board", "market:boards derived", "market:boards flow", "market:boards members", "market:index bars", "market:index counts",
    "market:index index", "market:limit-up yesterday", "market:limit-up zb", "market:limit-up zt", "quotes history",
  ]);
  const id = ids(context);
  const graded = registration(context, {
    addressed, expectation_review: { previous_run: first.run, grade: "弱于", evidence_ids: [id.quote("sh600519")] },
  });
  assert.deepEqual(await submitted(submit, S01, run, graded), { accepted: true, module: "mode", run });
});

test("mode: the maximal pin - a 2,048-byte previous card, twelve 160-character counterevidence items of sixteen ids, the five artifact views at their caps, a 1,500-byte falsification - fits 30 KiB with leader, counterevidence, sentiment and theme shown, OK expected, an S01 accepted", async (t) => {
  const mounted = await setup(t);
  const { root, read, submit, market } = mounted;
  const longSection = "下一个交易日的运行对照冻结的事实评级，登记从不等于确认。".repeat(75);
  const thesisPath = join(root, S01, "THESIS.md");
  await writeFile(thesisPath, (await readFile(thesisPath, "utf8")).replace("## Falsification\n", `## Falsification\n${longSection}\n\n`));
  /** Sixteen distinct evidence ids of the id's own shape, for the views' citations. */
  const sixteen = (seed: number) => Array.from({ length: 16 }, (_, i) => `ev_${(seed * 100 + i).toString(16).padStart(24, "0")}`);
  const longText = (n: number) => `${n}`.padEnd(300, "证");
  /** Twelve claims of 300 characters, sixteen ids each: a view shows six, cut to 120 characters. */
  const claims = (seed: number) => Array.from({ length: 12 }, (_, i) => ({ id: `c${i + 1}`, text: longText(i), basis: "CURRENT", evidence_ids: sixteen(seed + i) }));
  // Friday: S01 registers a card of exactly 2,048 bytes.
  const friday = await strategyRun(mounted, S01);
  await counterevidence(root, S01, friday, JSON.parse(await read.execute({ strategy: S01, run: friday, market_run: market }, exec(ROLE))));
  const fridayContext = JSON.parse(await read.execute({ strategy: S01, run: friday, market_run: market }, exec(ROLE)));
  const card = cardOf(fridayContext.snapshot_id, CARD_BYTES);
  assert.equal((await submitted(submit, S01, friday, registration(fridayContext, { expectation: card }))).accepted, true);
  // Monday: the strategy run with its leader, read before anything is widened: the ids a registration cites.
  const run = await strategyRun(mounted, S01, { now: MONDAY });
  const bare = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  // The market run's three artifacts at their caps, written over the accepted ones (the reader takes them as accepted).
  const marketDir = await realpath(join(root, "cn-market", "analysis", market));
  const stored = async (module: string) => JSON.parse(await readFile(join(marketDir, `${module}.json`), "utf8"));
  await writeArtifact(marketDir, "environment", { ...(await stored("environment")), cycle_anchor: "锚".repeat(120), claims: claims(1) });
  await writeArtifact(marketDir, "sentiment", { ...(await stored("sentiment")), claims: claims(2) });
  const theme = await stored("theme");
  const boards = [...MAINLINE.map(([code]) => code), "BK0001", "BK0002", "BK0003"];
  await writeArtifact(marketDir, "theme", {
    ...theme, claims: claims(3),
    mainline_candidates: boards.map((board, i) => ({ board, name: `示例${i}`.padEnd(40, "板"), evidence_ids: [...theme.mainline_candidates[0].evidence_ids, ...sixteen(40 + i)].slice(0, 16) })),
  });
  // Then the run's leader and counterevidence at their caps.
  const runDir = await realpath(join(root, S01, "analysis", run));
  const leader = JSON.parse(await readFile(join(runDir, "leader.json"), "utf8"));
  const [own] = leader.leader_candidates;
  await writeArtifact(runDir, "leader", {
    ...leader, claims: claims(5), top_pattern_flags: leader.top_pattern_flags,
    leader_candidates: [own, ...["sz000333", "sh601318", "sz000001", "sh600000"].map((symbol, i) => ({ symbol, name: `示例${i}`.padEnd(20, "股"), rank: i + 2, board: null, evidence_ids: sixteen(60 + i) }))]
      .map((candidate) => ({ ...candidate, evidence_ids: [...candidate.evidence_ids, ...sixteen(70)].slice(0, 16) })),
  });
  const cited = rowsOf(bare).map((row) => row.id).slice(0, 16);
  assert.equal(cited.length, 16);
  const item = "候选的地位只有一个交易日的冻结证据，".repeat(9).slice(0, 160);
  await counterevidence(root, S01, run, bare, 12, item);
  const review = JSON.parse(await readFile(join(runDir, "counterevidence.json"), "utf8"));
  // A real counterevidence artifact carries claims too: four at their cap.
  await writeArtifact(runDir, "counterevidence", { ...review, claims: claims(80).slice(0, 4), items: review.items.map((entry: any) => ({ ...entry, evidence_ids: cited })) });

  const text = await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE));
  const size = Buffer.byteLength(text, "utf8");
  assert.ok(size <= MAX_CONTEXT_BYTES, `${size} bytes`);
  const context = JSON.parse(text);
  // Measured 2026-10-26: 30,233 bytes - leader 1,958, counterevidence 7,407, sentiment 221, theme 1,558, the three candidate
  // quotes, the previous card 2,207; the environment (586, filled after the quotes) skipped, derived and other rows cut.
  assert.equal(context.status_expected, "OK");
  assert.deepEqual(context.missing, []);
  const modules = context.artifacts.map((row: any) => row.module);
  for (const module of ["leader", "counterevidence", "sentiment", "theme"]) assert.ok(modules.includes(module), `${module} shown: ${modules}`);
  assert.deepEqual(modules.slice(0, 2), ["leader", "counterevidence"]);
  const shown = context.artifacts[1].headline.items;
  assert.equal(shown.length, 12);
  for (const entry of shown) assert.deepEqual([Array.from(entry.text).length, entry.evidence_ids.length, entry.ids_total], [120, 3, 16]);
  assert.equal(context.artifacts[0].headline.leader_candidates.length, 5);
  // The run's own: two claims of 60 characters; the market run's: headline-only, claims_total beside.
  for (const view of context.artifacts.slice(0, 2)) assert.deepEqual(view.claims.map((claim: any) => Array.from(claim.text).length), [60, 60]);
  for (const view of context.artifacts.slice(2)) assert.deepEqual([view.claims, view.claims_total], [[], 12]);
  // The environment is filled after the candidates' quotes: at these inputs it may be the view skipped, never required.
  assert.ok(modules.includes("environment") || context.truncated.some((row: any) => row.source === "market:environment" && row.kind === "artifact"));
  assert.equal(context.artifacts.find((row: any) => row.module === "sentiment").headline.state, "EXPANSION");
  assert.equal(context.artifacts.find((row: any) => row.module === "theme").headline.mainline_candidates.length, 5);
  assert.deepEqual(context.previous.expectation, card, "the 2,048-byte card is shown as stored");
  assert.ok(!("card_truncated" in context.previous));
  assert.equal(Buffer.byteLength(context.falsification, "utf8"), FALSIFICATION_BYTES);
  // The leader's candidates' quotes are filled before the derived items: the frozen ones (sh600519, sz000333, sh601318) are shown.
  const quotes = context.evidence.filter((row: any) => row.kind === "quote").map((row: any) => row.symbol).sort();
  assert.deepEqual(quotes, ["sh600519", "sh601318", "sz000333"]);
  // S01 on Monday built only from what this maximal context shows, grading Friday's card on a quote this run froze.
  const view = (module: string) => context.artifacts.find((row: any) => row.module === module).id as string;
  const quote = context.evidence.find((row: any) => row.kind === "quote" && row.symbol === "sh600519").id as string;
  const s01 = artifact(context, {
    mode: "S01",
    preconditions: [
      { id: "p1", name: "theme_gate", status: "met", evidence_ids: [view("theme")] },
      { id: "p2", name: "candidate_before_divergence", status: "met", evidence_ids: [view("leader"), quote] },
      { id: "p3", name: "theme_not_falsified", status: "met", evidence_ids: [view("theme")] },
      { id: "p4", name: "negative_tail_not_widening", status: "met", evidence_ids: [view("sentiment")] },
      { id: "p5", name: "minute_confirmation", status: "unmet: no source", evidence_ids: [] },
    ],
    expectation: { ...(registration(bare).expectation as any), frozen_version: context.snapshot_id },
    parameters_used: [{ name: "d_i", value: "未设定", note: "研究候选，没有生产值。" }],
    addressed: Array.from({ length: 12 }, (_, i) => ({ item: `x${i + 1}`, response: "记入限制说明，下一运行核对。" })),
    expectation_review: { previous_run: friday, grade: "弱于", evidence_ids: [quote] },
    claims: [{ id: "c1", text: "S01 登记：前提见所引工件，分钟确认缺少来源。", basis: "HISTORICAL", evidence_ids: [view("theme"), view("sentiment")] }],
    limitations: ["分钟确认缺少来源，只作每日登记。"],
  });
  // Every id the registration cites is one this context shows.
  const shownIds = new Set([...context.artifacts, ...context.derived, ...context.evidence].map((row: any) => row.id as string));
  const citedIds = [...JSON.stringify(s01).matchAll(/ev_[a-f0-9]{24}|[a-z]+@snap_[a-f0-9]{64}/gu)].map(([cited]) => cited);
  assert.ok(citedIds.length > 0);
  for (const cited of citedIds) assert.ok(shownIds.has(cited), `${cited} is shown`);
  assert.deepEqual(await submitted(submit, S01, run, s01), { accepted: true, module: "mode", run });
});

test("mode: a sentiment or theme view the cap leaves out is missing - NOT_EVALUABLE expected, its example accepted, an OK artifact refused", async (t) => {
  for (const module of ["sentiment", "theme"]) {
    const mounted = await setup(t);
    const { root, read, submit, market } = mounted;
    const run = await strategyRun(mounted, S01);
    const marketDir = await realpath(join(root, "cn-market", "analysis", market));
    const stored = JSON.parse(await readFile(join(marketDir, `${module}.json`), "utf8"));
    // A headline field past the cap, as a hand-written artifact can hold.
    const wide = module === "sentiment" ? { money_effect: "x".repeat(20 * 1024) } : { rotation: "x".repeat(20 * 1024) };
    await writeArtifact(marketDir, module, { ...stored, ...wide });
    const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
    assert.equal(context.status_expected, "NOT_EVALUABLE", module);
    assert.deepEqual(context.missing, [`market:${module}`]);
    assert.ok(!context.artifacts.some((row: any) => row.module === module));
    assert.ok(context.truncated.some((row: any) => row.source === `market:${module}` && row.kind === "artifact"));
    const ok = artifact(context, { claims: [{ id: "c1", text: "本运行登记为 WAIT。", basis: "CURRENT", evidence_ids: [ids(context).quote("sh600519")] }] });
    assert.match((await refusal(submit, S01, run, ok)).message, /^INVALID_ANALYSIS: \[SCHEMA\] /u);
    assert.equal((await submitted(submit, S01, run, context.example)).accepted, true);
  }
});
