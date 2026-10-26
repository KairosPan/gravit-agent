/**
 * The Lunhui leader module (modules spec §5.4, §5.6, A21, A27): its contract
 * (`lib/contracts/leader.mjs`) and its row (`leader-row.mjs`), mounted on the stand-in scope of
 * tests/lunhui-rows.test.ts beside a real `lunhui-runs` service, the real freeze rows and the real
 * environment, sentiment and theme rows over a temp copy of the Tencent and Eastmoney fixtures: a
 * cn-market run is frozen and its three artifacts accepted through the module tools, then a
 * strategy run freezes quotes and the leader reads it citing that market run. The copy closes the
 * fixtures' gap - no Tencent equity is among the Eastmoney codes - by adding 600519 to the 涨停池
 * and 600519 and 000333 to BK0715's members; plan 1's fixtures stay as they are. Nothing reaches
 * the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as leaderRow from "../plugins/lunhui/leader-row.mjs";
import * as environmentRow from "../plugins/lunhui/environment-row.mjs";
import * as sentimentRow from "../plugins/lunhui/sentiment-row.mjs";
import * as themeRow from "../plugins/lunhui/theme-row.mjs";
import * as quotesRow from "../plugins/lunhui/freeze-quotes-row.mjs";
import { contract, HYPOTHESES } from "../plugins/lunhui/lib/contracts/leader.mjs";
import { MAX_CONTEXT_BYTES, hypothesesVersion } from "../plugins/lunhui/lib/contract-core.mjs";
import {
  ROLE, type Cleanup, type ToolDef, exec, fakeScope, frozenRun, idWhere, mount, rejectsWith, rowsOf,
} from "./lunhui-contract-harness.ts";

/** Tuesday 2026-10-27, 15:00 in China: two trading days after the harness's Friday. */
const TUESDAY = new Date("2026-10-27T07:00:00.000Z");
/** The strategy run's symbols: two equities the copy puts in the market run, one it does not. */
const SYMBOLS = ["sh600519", "sz000333", "sh601318"];

/** The fixture copy: 600519 sealed in the 涨停池, 600519 and 000333 members of BK0715. */
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

/** A module row's two tools on the service. */
function tools(service: unknown, row: { apply(ctx: any, config: unknown): void }): ToolDef[] {
  const scope = fakeScope({ lunhuiRuns: service });
  row.apply(scope.ctx, {});
  return scope.tools;
}

async function submitted(submit: ToolDef, strategy: string, run: string, analysis: unknown) {
  return JSON.parse(await submit.execute({ strategy, run, analysis: JSON.stringify(analysis) }, exec(ROLE)));
}

/**
 * A cn-market run frozen and its artifacts accepted through the real module tools: environment and
 * sentiment their examples, theme a hand-written one naming BK0715 as its one mainline candidate
 * (`theme: false` leaves the theme artifact out); then a strategy run in `alpha` freezing `SYMBOLS`.
 */
async function setup(t: Cleanup, { theme = true }: { theme?: boolean } = {}) {
  let fixtureDir = "";
  const mounted = await mount(t, leaderRow, async (dir) => { fixtureDir = dir; await addEquities(dir); });
  const { service, freeze } = mounted;
  const market = await frozenRun(freeze, ["index", "limit-up", "boards"]);
  for (const row of [environmentRow, sentimentRow]) {
    const [read, submit] = tools(service, row);
    const context = JSON.parse(await read.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
    assert.equal((await submitted(submit, "cn-market", market, context.example)).accepted, true);
  }
  const [themeRead, themeSubmit] = tools(service, themeRow);
  const themeContext = JSON.parse(await themeRead.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
  if (theme) {
    const board = idWhere(themeContext, (row) => row.kind === "board" && row.code === "BK0715");
    const members = idWhere(themeContext, (row) => row.kind === "members" && row.board === "BK0715");
    const breadth = idWhere(themeContext, (row) => row.measure === "breadth" && row.params.board === "BK0715");
    const analysis = {
      ...themeContext.example,
      mainline_candidates: [{ board: "BK0715", name: "示例电网", evidence_ids: [board, members] }],
      claims: [{ id: "c1", text: "示例电网的上涨占比见所引派生证据。", basis: "CURRENT", evidence_ids: [breadth] }],
    };
    assert.equal((await submitted(themeSubmit, "cn-market", market, analysis)).accepted, true);
  }
  const strategy = JSON.parse(await freeze.quotes.execute({ strategy: "alpha", symbols: SYMBOLS }, exec())).run as string;
  return { ...mounted, market, strategy, fixtureDir };
}

/** An artifact over `context` with the envelope copied and `fields` over an OK default. */
function artifact(context: any, fields: Record<string, unknown>) {
  return {
    module: context.module, contract_version: context.contract_version, hypotheses_version: context.hypotheses_version,
    snapshot_id: context.snapshot_id, run: context.run, as_of: context.as_of, session: context.session,
    market_run: context.market_run, market_snapshot_id: context.market_snapshot_id,
    status: "OK", missing_sources: [], leader_candidates: [], top_pattern_flags: [],
    claims: [], limitations: [],
    ...fields,
  };
}

/** The ids a candidate cites: its quote, its 涨停池 row, its board's member list; the theme artifact. */
function ids(context: any) {
  return {
    quote: (symbol: string) => idWhere(context, (row) => row.kind === "quote" && row.symbol === symbol),
    zt: (code: string) => idWhere(context, (row) => row.pool === "zt" && row.code === code),
    members: (board: string) => idWhere(context, (row) => row.kind === "members" && row.board === board),
    theme: () => context.artifacts.find((row: any) => row.module === "theme").id as string,
  };
}

test("leader row: name, inject, the module's two tools; a mount without the backbone names the row", () => {
  assert.equal(leaderRow.name, "lunhui-leader");
  assert.deepEqual(leaderRow.inject, ["tools", "lunhuiRuns"]);
  const scope = fakeScope({ lunhuiRuns: {} });
  leaderRow.apply(scope.ctx, {});
  assert.deepEqual(scope.tools.map((tool) => tool.name), ["lunhui_read_leader_context", "lunhui_submit_leader"]);
  assert.deepEqual(scope.tools[0].parameters.required, ["strategy", "run", "market_run"]);
  assert.deepEqual(Object.keys(scope.tools[1].parameters.properties), ["strategy", "run", "analysis"]);
  for (const tool of scope.tools) assert.match(tool.description, /策略频道/);
  assert.throws(() => leaderRow.apply(fakeScope().ctx, {}), { message: /^lunhui-leader: .*lunhui-runs/ });
});

test("leader contract: Chinese hypotheses of chapter 四 with its paragraph ids, the headline schema, the sources, the name carve-out", () => {
  assert.equal(contract.hypotheses, HYPOTHESES);
  assert.match(HYPOTHESES, /四 P0654–P1340/);
  assert.match(HYPOTHESES, /龙头候选/);
  assert.match(HYPOTHESES, /可修订/);
  const properties = contract.schema.properties as any;
  assert.equal(properties.leader_candidates.minItems, 0);
  assert.equal(properties.leader_candidates.maxItems, 5);
  const candidate = properties.leader_candidates.items;
  assert.deepEqual(candidate.required, ["symbol", "name", "rank", "board", "evidence_ids"]);
  assert.equal(candidate.properties.symbol.pattern, "^(sh|sz)\\d{6}$");
  assert.equal(candidate.properties.name.maxLength, 20);
  assert.deepEqual(candidate.properties.rank.enum, [1, 2, 3, 4, 5]);
  assert.equal(candidate.properties.board.pattern, "^BK\\d{4}$");
  assert.deepEqual(properties.top_pattern_flags.items.enum, ["ACCELERATING", "DIVERGENCE", "BROKEN_STREAK", "HIGH_POSITION", "FIRST_BOARD", "NONE"]);
  assert.equal(properties.top_pattern_flags.maxItems, 5);
  assert.deepEqual(contract.schema.required, ["leader_candidates", "top_pattern_flags"]);
  assert.deepEqual(contract.owns, ["leader"]);
  assert.equal(contract.marketRun, "required");
  assert.deepEqual(contract.sources, ["quotes"]);
  assert.deepEqual(contract.marketSources, ["limit-up", "boards"]);
  assert.deepEqual(contract.marketArtifacts, ["theme", "sentiment"]);
  assert.deepEqual(contract.required, ["quotes", "market:theme"]);
  assert.deepEqual(contract.exemptPaths, ["leader_candidates[*].name"]);
});

test("leader: a context over a strategy run's quotes citing the day's market run - OK expected, the market's pools and members, the theme and sentiment artifacts, at most 30 KiB - whose example is accepted", async (t) => {
  const { read, submit, market, strategy } = await setup(t);
  const text = await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.deepEqual(context.missing, []);
  assert.equal(context.market_run, market);
  assert.equal(context.hypotheses_version, hypothesesVersion(HYPOTHESES));
  assert.deepEqual(context.artifacts.map((row: any) => row.module), ["theme", "sentiment"]);
  assert.match(context.hints.boards, /BK0715/);
  // The rows: the run's equity quotes, then the market's pools and member lists.
  assert.deepEqual(context.evidence.map((row: any) => [row.source, row.kind ?? row.pool]), [
    ...SYMBOLS.map(() => ["quotes", "quote"]),
    ...Array(7).fill(["market:limit-up", "zt"]), ...Array(3).fill(["market:limit-up", "zb"]), ...Array(5).fill(["market:limit-up", "yesterday"]),
    ["market:boards", "members"], ["market:boards", "members"],
  ]);
  // A member list shows its codes, every one the freeze kept; no stamps, no validity block.
  const grid = context.evidence.find((row: any) => row.kind === "members" && row.board === "BK0715");
  assert.deepEqual(grid.members, ["600101", "000102", "603103", "002104", "600519", "000333"]);
  for (const row of context.evidence) assert.ok(!("host" in row) && !("delayed" in row) && !("validity" in row), `${row.source} ${row.kind ?? row.pool}`);
  const example = context.example;
  assert.equal(example.status, "OK");
  assert.deepEqual([example.leader_candidates, example.top_pattern_flags], [[], []]);
  assert.equal(example.market_run, market);
  assert.equal(example.claims[0].basis, "INSUFFICIENT");
  assert.ok(rowsOf(context).some((row) => row.id === example.claims[0].evidence_ids[0]));
  assert.deepEqual(await submitted(submit, "alpha", strategy, example), { accepted: true, module: "leader", run: strategy });
});

test("leader: a hand-written artifact with two candidates - one on its 涨停池 row, one on its board's members - is accepted", async (t) => {
  const { root, read, submit, market, strategy } = await setup(t);
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE)));
  const id = ids(context);
  const analysis = artifact(context, {
    leader_candidates: [
      { symbol: "sh600519", name: "贵州茅台", rank: 1, board: "BK0715", evidence_ids: [id.quote("sh600519"), id.zt("600519")] },
      { symbol: "sz000333", name: "美的集团", rank: 2, board: null, evidence_ids: [id.quote("sz000333"), id.members("BK0715")] },
    ],
    top_pattern_flags: ["HIGH_POSITION"],
    claims: [
      { id: "c1", text: "贵州茅台连板数 4，首次封板 09:30，列为龙头候选，顺位 1。", basis: "CURRENT", evidence_ids: [id.zt("600519"), id.quote("sh600519")] },
      { id: "c2", text: "美的集团是 BK0715 的成分股，所在板块见所引工件。", basis: "CURRENT", evidence_ids: [id.members("BK0715"), id.theme()] },
    ],
    limitations: ["地位只按冻结的连板数、封板时间与成分股读出。"],
  });
  assert.equal((await submitted(submit, "alpha", strategy, analysis)).accepted, true);
  const stored = JSON.parse(await readFile(join(root, "alpha", "analysis", strategy, "leader.json"), "utf8"));
  assert.deepEqual([stored.market_run, stored.market_snapshot_id], [market, context.market_snapshot_id]);
  assert.deepEqual(stored.leader_candidates.map((candidate: any) => [candidate.rank, candidate.symbol]), [[1, "sh600519"], [2, "sz000333"]]);
});

test("leader: a candidate must be a frozen quote whose code the cited market run froze in a pool or a member list - REFERENCE otherwise, both ways", async (t) => {
  const { service, read, submit, market, strategy } = await setup(t);
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE)));
  const id = ids(context);
  const claims = [{ id: "c1", text: "贵州茅台连板数见所引涨停池行。", basis: "CURRENT", evidence_ids: [id.zt("600519")] }];
  const cases: Array<[unknown, RegExp]> = [
    // In the pools and the members, but the strategy run froze no quote of it.
    [{ symbol: "sh600101", name: "示例电力", rank: 1, board: null, evidence_ids: [id.zt("600101"), id.members("BK0715")] }, /leader_candidates\[0\]\.symbol/],
    // A frozen quote whose code no pool row or member list of the market run holds.
    [{ symbol: "sh601318", name: "中国平安", rank: 1, board: null, evidence_ids: [id.quote("sh601318"), id.members("BK0715")] }, /leader_candidates\[0\]\.symbol/],
    // Its quote only.
    [{ symbol: "sh600519", name: "贵州茅台", rank: 1, board: null, evidence_ids: [id.quote("sh600519")] }, /leader_candidates\[0\]/],
    // A member list that does not hold its code.
    [{ symbol: "sz000333", name: "美的集团", rank: 1, board: null, evidence_ids: [id.quote("sz000333"), id.members("BK1716")] }, /leader_candidates\[0\]/],
    // Another quote's id beside its own home.
    [{ symbol: "sh600519", name: "贵州茅台", rank: 1, board: null, evidence_ids: [id.quote("sz000333"), id.zt("600519")] }, /leader_candidates\[0\]/],
    // A name that is not the quote's.
    [{ symbol: "sh600519", name: "示例电力", rank: 1, board: null, evidence_ids: [id.quote("sh600519"), id.zt("600519")] }, /leader_candidates\[0\]\.name/],
    // A board the market run's theme artifact does not name among its mainline candidates.
    [{ symbol: "sh600519", name: "贵州茅台", rank: 1, board: "BK1716", evidence_ids: [id.quote("sh600519"), id.zt("600519")] }, /leader_candidates\[0\]\.board/],
  ];
  for (const [candidate, path] of cases) {
    const analysis = artifact(context, { leader_candidates: [candidate], claims });
    const refusal = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(analysis) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] /u);
    assert.match(refusal.message, path);
  }
  // One symbol, two candidates.
  const twice = { symbol: "sh600519", name: "贵州茅台", board: null, evidence_ids: [id.quote("sh600519"), id.zt("600519")] };
  const refusal = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(artifact(context, {
    leader_candidates: [{ ...twice, rank: 1 }, { ...twice, rank: 2 }], claims,
  })) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.leader_candidates\[1\]\.symbol/u);
  assert.deepEqual((await service.readRun("alpha", strategy)).metrics.rejections.leader, Array(8).fill("REFERENCE"));
});

test("leader: ranks run 1 to n without gaps; a board is BK and four digits or null - SCHEMA otherwise", async (t) => {
  const { read, submit, market, strategy } = await setup(t);
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE)));
  const id = ids(context);
  const first = { symbol: "sh600519", name: "贵州茅台", rank: 1, board: null, evidence_ids: [id.quote("sh600519"), id.zt("600519")] };
  const second = { symbol: "sz000333", name: "美的集团", rank: 2, board: null, evidence_ids: [id.quote("sz000333"), id.members("BK0715")] };
  const claims = [{ id: "c1", text: "贵州茅台连板数见所引涨停池行。", basis: "CURRENT", evidence_ids: [id.zt("600519")] }];
  for (const candidates of [[first, { ...second, rank: 3 }], [first, { ...second, rank: 1 }], [{ ...first, rank: 2 }], [{ ...first, board: "电网" }], [{ ...first, board: 715 }]]) {
    const refusal = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(artifact(context, { leader_candidates: candidates, claims })) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[SCHEMA\] analysis\.leader_candidates/u);
  }
});

test("leader: pattern flags other than NONE stand on a claim of their own citing a market pool row; NONE stands alone and needs none", async (t) => {
  const { read, submit, market, strategy } = await setup(t);
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE)));
  const id = ids(context);
  const onQuote = [{ id: "c1", text: "贵州茅台的涨跌幅见所引报价。", basis: "CURRENT", evidence_ids: [id.quote("sh600519")] }];
  for (const claims of [onQuote, [{ id: "c1", text: "贵州茅台连板数见所引涨停池行。", basis: "INSUFFICIENT", evidence_ids: [id.zt("600519")] }, ...onQuote.map((claim) => ({ ...claim, id: "c2" }))]]) {
    const refusal = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(artifact(context, { top_pattern_flags: ["ACCELERATING"], claims })) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.top_pattern_flags/u);
  }
  const mixed = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(artifact(context, { top_pattern_flags: ["NONE", "FIRST_BOARD"], claims: onQuote })) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(mixed.message, /^INVALID_ANALYSIS: \[SCHEMA\] analysis\.top_pattern_flags/u);
  assert.equal((await submitted(submit, "alpha", strategy, artifact(context, { top_pattern_flags: ["NONE"], claims: onQuote }))).accepted, true);
});

test("leader: a 龙头 sentence cites a quote, a pool row or a member list - the theme artifact alone is UNSUPPORTED_SCOPE, as is a 主线 sentence", async (t) => {
  const { read, submit, market, strategy } = await setup(t);
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE)));
  const id = ids(context);
  for (const claim of [
    { id: "c1", text: "贵州茅台是龙头候选。", basis: "CURRENT", evidence_ids: [id.theme()] },
    { id: "c1", text: "主线集中在 BK0715。", basis: "CURRENT", evidence_ids: [id.members("BK0715"), id.theme()] },
  ]) {
    const refusal = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(artifact(context, { claims: [claim] })) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[UNSUPPORTED_SCOPE\] /u);
  }
});

test("leader: a market run without a theme artifact expects NOT_EVALUABLE naming market:theme - an OK artifact refused, the example accepted", async (t) => {
  const { read, submit, market, strategy } = await setup(t, { theme: false });
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE)));
  assert.equal(context.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(context.missing, ["market:theme"]);
  assert.deepEqual(context.example.missing_sources, ["market:theme"]);
  assert.deepEqual(context.example.leader_candidates, []);
  const id = ids(context);
  const ok = artifact(context, { claims: [{ id: "c1", text: "贵州茅台连板数见所引涨停池行。", basis: "CURRENT", evidence_ids: [id.zt("600519")] }] });
  const refusal = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(ok) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[SCHEMA\] /u);
  assert.equal((await submitted(submit, "alpha", strategy, context.example)).accepted, true);
});

test("leader: a cn-market run is WRONG_CHANNEL; a market run two trading days before the strategy run is STALE_MARKET_RUN at the read", async (t) => {
  const { read, market, service, fixtureDir } = await setup(t);
  await rejectsWith(read.execute({ strategy: "cn-market", run: market, market_run: market }, exec(ROLE)), "WRONG_CHANNEL");
  const scope = fakeScope({ lunhuiRuns: service });
  quotesRow.apply(scope.ctx, { fetch: fixtureDir, now: () => TUESDAY });
  const tuesday = JSON.parse(await scope.tools[0].execute({ strategy: "alpha", symbols: SYMBOLS }, exec())).run;
  await rejectsWith(read.execute({ strategy: "alpha", run: tuesday, market_run: market }, exec(ROLE)), "STALE_MARKET_RUN");
});
