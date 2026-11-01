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
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as leaderRow from "../plugins/lunhui/leader-row.mjs";
import * as environmentRow from "../plugins/lunhui/environment-row.mjs";
import * as sentimentRow from "../plugins/lunhui/sentiment-row.mjs";
import * as themeRow from "../plugins/lunhui/theme-row.mjs";
import * as quotesRow from "../plugins/lunhui/freeze-quotes-row.mjs";
import { contract, HYPOTHESES } from "../plugins/lunhui/lib/contracts/leader.mjs";
import { BOARD_CODE_PATTERN, MAX_CONTEXT_BYTES, hypothesesVersion } from "../plugins/lunhui/lib/contract-core.mjs";
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

/** The theme's mainline candidates by default: BK0715 and BK1716 under their frozen names. */
const MAINLINE = [["BK0715", "示例电网"], ["BK1716", "示例算力"]];

/**
 * A cn-market run frozen and its artifacts accepted through the real module tools: environment and
 * sentiment their examples, theme a hand-written one naming `mainline` as its mainline candidates
 * (`theme: false` leaves the theme artifact out); then a strategy run in `alpha` freezing `symbols`.
 * `prepare` rewrites the fixture copy (the two equities added by default); `boards` is the boards
 * freeze's argument (null for the freeze's own first ten).
 */
async function setup(t: Cleanup, {
  theme = true, prepare = addEquities, mainline = MAINLINE, symbols = SYMBOLS, boards, boardsConfig,
}: { boardsConfig?: Record<string, unknown>; theme?: boolean; prepare?: (dir: string) => Promise<void>; mainline?: string[][]; symbols?: string[]; boards?: string[] | null } = {}) {
  let fixtureDir = "";
  const mounted = await mount(t, leaderRow, async (dir) => { fixtureDir = dir; await prepare(dir); }, boardsConfig);
  const { service, freeze } = mounted;
  const market = await frozenRun(freeze, ["index", "limit-up", "boards"], boards === undefined ? {} : { boards });
  for (const row of [environmentRow, sentimentRow]) {
    const [read, submit] = tools(service, row);
    const context = JSON.parse(await read.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
    assert.equal((await submitted(submit, "cn-market", market, context.example)).accepted, true);
  }
  const [themeRead, themeSubmit] = tools(service, themeRow);
  const themeContext = JSON.parse(await themeRead.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
  if (theme) {
    const breadth = idWhere(themeContext, (row) => row.measure === "breadth" && row.params.board === mainline[0][0]);
    const analysis = {
      ...themeContext.example,
      mainline_candidates: mainline.map(([code, name]) => ({ board: code, name, evidence_ids: [
        idWhere(themeContext, (row) => row.kind === "board" && row.code === code),
        idWhere(themeContext, (row) => row.kind === "members" && row.board === code),
      ] })),
      claims: [{ id: "c1", text: `${mainline[0][1]}的上涨占比见所引派生证据。`, basis: "CURRENT", evidence_ids: [breadth] }],
    };
    assert.equal((await submitted(themeSubmit, "cn-market", market, analysis)).accepted, true);
  }
  const strategy = JSON.parse(await freeze.quotes.execute({ strategy: "alpha", symbols }, exec())).run as string;
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

/**
 * The id of a market-run item the context need not show, read from the frozen evidence file: the
 * digest keeps every item citable.
 */
async function frozenId(root: string, market: string, source: string, test: (item: any) => boolean): Promise<string> {
  const file = JSON.parse(await readFile(join(root, "cn-market", "analysis", market, `evidence-${source}.json`), "utf8"));
  const item = file.items.find(test);
  assert.ok(item, "the market run froze the item the test cites");
  return item.id;
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
  assert.equal(candidate.properties.board.pattern, BOARD_CODE_PATTERN);
  assert.deepEqual(contract.exemptPaths, ["leader_candidates[*].name", "leader_candidates[*].board"]);
  assert.deepEqual(properties.top_pattern_flags.items.enum, ["ACCELERATING", "DIVERGENCE", "BROKEN_STREAK", "HIGH_POSITION", "FIRST_BOARD", "NONE"]);
  assert.equal(properties.top_pattern_flags.maxItems, 5);
  assert.deepEqual(contract.schema.required, ["leader_candidates", "top_pattern_flags"]);
  assert.deepEqual(contract.owns, ["leader"]);
  assert.equal(contract.marketRun, "required");
  assert.deepEqual(contract.sources, ["quotes"]);
  assert.deepEqual(contract.marketSources, ["limit-up", "boards"]);
  assert.deepEqual(contract.marketArtifacts, ["theme", "sentiment"]);
  assert.deepEqual(contract.required, ["quotes", "market:theme"]);
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
  assert.match(context.hints.boards, /BK0715、BK1716/);
  // The rows: the run's equity quotes, then only what a candidate can stand on - the pool rows of the
  // run's equities (600519's 涨停 row) and the mainline boards' member lists.
  assert.deepEqual(context.evidence.map((row: any) => [row.source, row.kind ?? row.pool, row.code ?? row.board ?? row.symbol]), [
    ...["sh600519", "sh601318", "sz000333"].map((symbol) => ["quotes", "quote", symbol]),
    ["market:limit-up", "zt", "600519"], ["market:boards", "members", "BK0715"], ["market:boards", "members", "BK1716"],
  ]);
  assert.deepEqual(context.truncated.filter((row: any) => row.source.startsWith("market:")), [
    { source: "market:limit-up", kind: "zt", count: 6 }, { source: "market:limit-up", kind: "zb", count: 3 },
    { source: "market:limit-up", kind: "yesterday", count: 5 }, { source: "market:boards", kind: "board", count: 4 },
    { source: "market:boards", kind: "flow", count: 4 },
  ]);
  // A member list shows its first ten codes and any frozen equity further down; members_total the frozen count.
  const lists = context.evidence.filter((row: any) => row.kind === "members");
  assert.deepEqual(lists.map((row: any) => [row.board, row.members.length, row.members_total]), [["BK0715", 6, 6], ["BK1716", 10, 100]]);
  assert.deepEqual(lists[0].members, ["600101", "000102", "603103", "002104", "600519", "000333"]);
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
  const { root, service, read, submit, market, strategy } = await setup(t);
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE)));
  const id = ids(context);
  const claims = [{ id: "c1", text: "贵州茅台连板数见所引涨停池行。", basis: "CURRENT", evidence_ids: [id.zt("600519")] }];
  // 600101's 涨停 row is not shown - no equity of the run holds its code - but it stays citable.
  const unfrozen = await frozenId(root, market, "limit-up", (item) => item.pool === "zt" && item.code === "600101");
  const cases: Array<[unknown, RegExp]> = [
    // In the pools and the members, but the strategy run froze no quote of it.
    [{ symbol: "sh600101", name: "示例电力", rank: 1, board: null, evidence_ids: [unfrozen, id.members("BK0715")] }, /leader_candidates\[0\]\.symbol/],
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
    [{ symbol: "sh600519", name: "贵州茅台", rank: 1, board: "BK0493", evidence_ids: [id.quote("sh600519"), id.zt("600519")] }, /leader_candidates\[0\]\.board/],
    // A mainline board whose frozen member list does not hold the candidate's code.
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
  assert.deepEqual((await service.readRun("alpha", strategy)).metrics.rejections.leader, Array(9).fill("REFERENCE"));
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

test("leader: a 龙头 sentence must cite a listed candidate's quote - REFERENCE on another stock's pool row - and 龙头 is only 龙头候选 - UNSUPPORTED_SCOPE on a conclusion, even on its own quote", async (t) => {
  const { root, read, submit, market, strategy } = await setup(t);
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE)));
  const id = ids(context);
  const listed = { symbol: "sh600519", name: "贵州茅台", rank: 1, board: null, evidence_ids: [id.quote("sh600519"), id.zt("600519")] };
  const other = await frozenId(root, market, "limit-up", (item) => item.pool === "zt" && item.code === "600101");
  const reference: Array<Record<string, unknown>> = [
    // Another stock's pool row, not a frozen quote of the run.
    { leader_candidates: [listed], claims: [{ id: "c1", text: "示例电力连板数最高，列为龙头候选。", basis: "CURRENT", evidence_ids: [other] }] },
    // A 空间板 sentence on the pool row of a listed candidate, without its quote.
    { leader_candidates: [listed], claims: [{ id: "c1", text: "贵州茅台是空间板。", basis: "CURRENT", evidence_ids: [id.zt("600519")] }] },
    // A frozen quote that is not a listed candidate.
    { leader_candidates: [listed], claims: [{ id: "c1", text: "美的集团列为龙头候选。", basis: "CURRENT", evidence_ids: [id.quote("sz000333"), id.members("BK0715")] }] },
  ];
  for (const fields of reference) {
    const refusal = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(artifact(context, fields)) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.claims\[0\]/u);
  }
  const conclusions: Array<Record<string, unknown>> = [
    { leader_candidates: [listed], claims: [{ id: "c1", text: "贵州茅台是龙头。", basis: "CURRENT", evidence_ids: [id.quote("sh600519"), id.zt("600519")] }] },
    { leader_candidates: [listed], claims: [{ id: "c1", text: "贵州茅台是总龙头候选。", basis: "CURRENT", evidence_ids: [id.quote("sh600519")] }] },
    { leader_candidates: [listed], claims: [{ id: "c1", text: "贵州茅台连板数见所引涨停池行。", basis: "CURRENT", evidence_ids: [id.zt("600519")] }], limitations: ["缺少分时数据，龙头地位待补充。"] },
  ];
  for (const fields of conclusions) {
    const refusal = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(artifact(context, fields)) }, exec(ROLE)), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[UNSUPPORTED_SCOPE\] /u);
  }
  // 空间板 as a listed candidate's descriptor, on its quote and its pool row, passes.
  const descriptor = artifact(context, { leader_candidates: [listed], claims: [{ id: "c1", text: "贵州茅台连板数 4，是本运行的空间板，列为龙头候选。", basis: "CURRENT", evidence_ids: [id.quote("sh600519"), id.zt("600519")] }] });
  assert.equal((await submitted(submit, "alpha", strategy, descriptor)).accepted, true);
});

test("leader: a candidate whose quote has no last price is REFERENCE", async (t) => {
  // sz000333's last price emptied in the copy: the quote is frozen, unpriced.
  const unprice = async (dir: string) => {
    await addEquities(dir);
    const file = join(dir, "quotes.gb18030.txt");
    const text = (await readFile(file)).toString("latin1");
    assert.ok(text.includes("~000333~73.40~"));
    await writeFile(file, Buffer.from(text.replace("~000333~73.40~", "~000333~~"), "latin1"));
  };
  const { read, submit, market, strategy } = await setup(t, { prepare: unprice });
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE)));
  const id = ids(context);
  assert.equal(rowsOf(context).find((row) => row.kind === "quote" && row.symbol === "sz000333").last, null);
  const analysis = artifact(context, {
    leader_candidates: [{ symbol: "sz000333", name: "美的集团", rank: 1, board: null, evidence_ids: [id.quote("sz000333"), id.members("BK0715")] }],
    claims: [{ id: "c1", text: "美的集团是 BK0715 的成分股。", basis: "CURRENT", evidence_ids: [id.members("BK0715")] }],
  });
  const refusal = await rejectsWith(submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(analysis) }, exec(ROLE)), "INVALID_ANALYSIS");
  assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.leader_candidates\[0\]\.symbol/u);
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

test("leader: a live-size market run - three 500-row pools, thirty boards, ten 100-member lists - and four equities fit 30 KiB, every quote, every pool row of the equities and every mainline member list shown", async (t) => {
  const CODES = Array.from({ length: 30 }, (_, i) => `BK${2000 + i}`);
  const EQUITIES = ["sh600519", "sz000333", "sh601318", "sz000001"];
  /** Where the copy puts each equity's code: pool and row index, board list and member index. */
  const IN_POOLS: Array<[string, number, string]> = [["zt", 450, "600519"], ["zt", 499, "000001"], ["zb", 300, "000333"], ["yesterday", 200, "601318"], ["yesterday", 10, "600519"]];
  const IN_LISTS: Array<[string, number, string]> = [["BK2000", 50, "600519"], ["BK2000", 60, "000333"], ["BK2001", 99, "601318"], ["BK2002", 5, "000001"]];
  const widen = async (dir: string) => {
    for (const [pool, file, base] of [["zt", "zt-pool.json", 680000], ["zb", "zb-pool.json", 690000], ["yesterday", "yesterday-pool.json", 830000]] as const) {
      const reply = JSON.parse(await readFile(join(dir, file), "utf8"));
      const [row] = reply.data.pool;
      reply.data.pool = Array.from({ length: 500 }, (_, k) => ({ ...row, c: String(base + k), n: `示例${pool}${k}` }));
      for (const [where, k, code] of IN_POOLS) if (where === pool) reply.data.pool[k] = { ...row, c: code, n: `示例${code}` };
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
      for (const [list, j, equity] of IN_LISTS) if (list === code) members.data.diff[j] = { ...members.data.diff[j], f12: equity, f14: `示例${equity}` };
      await writeFile(join(dir, `members-${code}.json`), JSON.stringify(members));
    }
  };
  const mainline = [["BK2000", "示例板块0"], ["BK2001", "示例板块1"], ["BK2002", "示例板块2"]];
  const { read, submit, market, strategy } = await setup(t, { prepare: widen, mainline, symbols: EQUITIES, boards: null });
  const text = await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE));
  // Measured 2026-10-27: 21,307 bytes, nothing cut by the cap - every row left out is filtered out.
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES, `${Buffer.byteLength(text, "utf8")} bytes`);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.deepEqual(context.artifacts.map((row: any) => row.module), ["theme", "sentiment"]);
  assert.deepEqual(context.evidence.filter((row: any) => row.kind === "quote").map((row: any) => row.symbol).sort(), [...EQUITIES].sort());
  assert.deepEqual(context.evidence.filter((row: any) => row.source === "market:limit-up").map((row: any) => [row.pool, row.code]).sort(),
    IN_POOLS.map(([pool, , code]) => [pool, code]).sort());
  const lists = context.evidence.filter((row: any) => row.kind === "members");
  assert.deepEqual(lists.map((row: any) => [row.board, row.members.length, row.members_total]), [["BK2000", 12, 100], ["BK2001", 11, 100], ["BK2002", 10, 100]]);
  assert.deepEqual(lists[0].members.slice(10), ["600519", "000333"]);
  assert.deepEqual(context.truncated.filter((row: any) => row.source === "market:limit-up"), [
    { source: "market:limit-up", kind: "zt", count: 498 }, { source: "market:limit-up", kind: "zb", count: 499 }, { source: "market:limit-up", kind: "yesterday", count: 498 },
  ]);
  // A candidate on a far-down member stands on the list the context shows.
  const id = ids(context);
  const analysis = artifact(context, {
    leader_candidates: [{ symbol: "sh601318", name: "中国平安", rank: 1, board: "BK2001", evidence_ids: [id.quote("sh601318"), id.members("BK2001")] }],
    claims: [{ id: "c1", text: "中国平安是 BK2001 的成分股，列为龙头候选。", basis: "CURRENT", evidence_ids: [id.members("BK2001"), id.quote("sh601318")] }],
  });
  assert.equal((await submitted(submit, "alpha", strategy, analysis)).accepted, true);
});

/** The 问财 stand-in's fixture copy: no Eastmoney board list, 600519 and 000333 the first two members of 人形机器人. */
async function standInFixtures(dir: string) {
  await addEquities(dir);
  await rm(join(dir, "boards.json"));
  const file = join(dir, "wencai-universe.json");
  await writeFile(file, (await readFile(file, "utf8")).replace("300100.SZ", "600519.SH").replace("300101.SZ", "000333.SZ"));
}

test("leader: a stand-in market run - a candidate's board is a THS: mainline candidate of the theme artifact, REFERENCE when not frozen", async (t) => {
  const { service, market, strategy } = await setup(t, {
    prepare: standInFixtures, boards: null, mainline: [["THS:人形机器人", "人形机器人"]], boardsConfig: { env: { IFIND_REFRESH_TOKEN: "fixture-refresh" } },
  });
  const [read, submit] = tools(service, leaderRow);
  const context = JSON.parse(await read.execute({ strategy: "alpha", run: strategy, market_run: market }, exec(ROLE)));
  const id = ids(context);
  // The leader shows a member list as codes: no stand-in stamp reaches its context.
  const lists = context.evidence.filter((row: any) => row.kind === "members");
  assert.ok(lists.length > 0);
  for (const row of lists)
    for (const stamp of ["provider", "taxonomy", "pct_basis", "host", "delayed"]) assert.equal(Object.hasOwn(row, stamp), false, stamp);
  const candidate = (board: string | null) => ({ symbol: "sh600519", name: "贵州茅台", rank: 1, board, evidence_ids: [id.quote("sh600519"), id.members("THS:人形机器人")] });
  const claims = [{ id: "c1", text: "贵州茅台是示例成分股，列为龙头候选。", basis: "CURRENT", evidence_ids: [id.quote("sh600519"), id.members("THS:人形机器人")] }];
  const submit_ = (board: string | null) => submit.execute({ strategy: "alpha", run: strategy, analysis: JSON.stringify(artifact(context, { leader_candidates: [candidate(board)], claims })) }, exec(ROLE));
  for (const board of ["THS:白酒概念", "THS:未冻结"]) {
    const refusal = await rejectsWith(submit_(board), "INVALID_ANALYSIS");
    assert.match(refusal.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.leader_candidates\[0\]\.board/u);
  }
  // A malformed code is SCHEMA, not REFERENCE.
  const schema = await rejectsWith(submit_("THS:a  b"), "INVALID_ANALYSIS");
  assert.match(schema.message, /leader_candidates\[0\]\.board/u);
  assert.doesNotMatch(schema.message, /\[REFERENCE\]/u);
  assert.equal(JSON.parse(await submit_("THS:人形机器人")).accepted, true);
});
