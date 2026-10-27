/**
 * The Lunhui counterevidence module (modules spec §5.4, §5.6, A6, A21, A22): its contract
 * (`lib/contracts/counterevidence.mjs`) and its row (`review-row.mjs`), mounted on the stand-in
 * scope of tests/lunhui-rows.test.ts beside a real `lunhui-runs` service, the real freeze rows and
 * the real environment, sentiment, theme and leader rows over a temp copy of the Tencent and
 * Eastmoney fixtures, as the leader's tests do. In `cn-market` the reviewer reads the run's own
 * three artifacts and takes no `market_run`; in a strategy run it requires `market_run` and the
 * run's accepted leader artifact citing that same market run. Nothing reaches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as reviewRow from "../plugins/lunhui/review-row.mjs";
import * as leaderRow from "../plugins/lunhui/leader-row.mjs";
import * as environmentRow from "../plugins/lunhui/environment-row.mjs";
import * as sentimentRow from "../plugins/lunhui/sentiment-row.mjs";
import * as themeRow from "../plugins/lunhui/theme-row.mjs";
import * as modeRow from "../plugins/lunhui/mode-row.mjs";
import { contract, HYPOTHESES, KINDS } from "../plugins/lunhui/lib/contracts/counterevidence.mjs";
import { MAX_CONTEXT_BYTES, SCOPE_CLASSES, hypothesesVersion } from "../plugins/lunhui/lib/contract-core.mjs";
import { writeArtifact } from "../plugins/lunhui/lib/runs.mjs";
import {
  ROLE, type Cleanup, type ToolDef, exec, fakeScope, frozenRun, idWhere, mount, rejectsWith, rowsOf,
} from "./lunhui-contract-harness.ts";

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

const refusal = (submit: ToolDef, strategy: string, run: string, analysis: unknown) =>
  rejectsWith(submit.execute({ strategy, run, analysis: JSON.stringify(analysis) }, exec(ROLE)), "INVALID_ANALYSIS");

/**
 * A market run of the mounted service, frozen and (unless `artifacts` is false) its three artifacts
 * accepted, the theme naming `mainline`; `boards` is the boards freeze's argument (null for its own first ten).
 */
async function marketRun(service: unknown, freeze: Record<string, ToolDef>,
  { artifacts = true, mainline = MAINLINE, boards }: { artifacts?: boolean; mainline?: string[][]; boards?: string[] | null } = {}) {
  const market = await frozenRun(freeze, ["index", "limit-up", "boards"], boards === undefined ? {} : { boards });
  if (!artifacts) return market;
  for (const row of [environmentRow, sentimentRow]) {
    const [read, submit] = tools(service, row);
    const context = JSON.parse(await read.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
    assert.equal((await submitted(submit, "cn-market", market, context.example)).accepted, true);
  }
  const [themeRead, themeSubmit] = tools(service, themeRow);
  const themeContext = JSON.parse(await themeRead.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
  const breadth = idWhere(themeContext, (row) => row.measure === "breadth" && row.params.board === mainline[0][0]);
  assert.equal((await submitted(themeSubmit, "cn-market", market, {
    ...themeContext.example,
    mainline_candidates: mainline.map(([code, name]) => ({ board: code, name, evidence_ids: [
      idWhere(themeContext, (row) => row.kind === "board" && row.code === code),
      idWhere(themeContext, (row) => row.kind === "members" && row.board === code),
    ] })),
    claims: [{ id: "c1", text: `${mainline[0][1]}的上涨占比见所引派生证据。`, basis: "CURRENT", evidence_ids: [breadth] }],
  })).accepted, true);
  return market;
}

/** The review row mounted, with a market run whose three artifacts are accepted; `prepare` rewrites the fixture copy. */
async function setup(t: Cleanup, { prepare = addEquities, mainline, boards }: { prepare?: (dir: string) => Promise<void>; mainline?: string[][]; boards?: string[] | null } = {}) {
  const mounted = await mount(t, reviewRow, prepare);
  const market = await marketRun(mounted.service, mounted.freeze, { mainline, boards });
  return { ...mounted, market };
}

/** A strategy run in `alpha`: quotes, then (unless `leader` is false) a leader artifact citing `market`. */
async function strategyRun(mounted: Awaited<ReturnType<typeof setup>>,
  { leader = true, market = mounted.market, symbols = SYMBOLS }: { leader?: boolean; market?: string; symbols?: string[] } = {}) {
  const { service, freeze } = mounted;
  const run = JSON.parse(await freeze.quotes.execute({ strategy: "alpha", symbols }, exec())).run as string;
  if (leader) {
    const [read, submit] = tools(service, leaderRow);
    const context = JSON.parse(await read.execute({ strategy: "alpha", run, market_run: market }, exec(ROLE)));
    const quote = rowsOf(context).find((row) => row.kind === "quote" && row.symbol === "sh600519");
    const zt = idWhere(context, (row) => row.pool === "zt" && row.code === "600519");
    assert.equal((await submitted(submit, "alpha", run, {
      ...context.example,
      leader_candidates: [{ symbol: "sh600519", name: quote.name, rank: 1, board: null, evidence_ids: [quote.id, zt] }],
      claims: [{ id: "c1", text: `${quote.name}连板数见所引涨停池行。`, basis: "CURRENT", evidence_ids: [zt, quote.id] }],
    })).accepted, true);
  }
  return run;
}

/** An artifact over `context` with the envelope copied (the market fields only when the context has them) and `fields` over an OK default. */
function artifact(context: any, fields: Record<string, unknown>) {
  return {
    module: context.module, contract_version: context.contract_version, hypotheses_version: context.hypotheses_version,
    snapshot_id: context.snapshot_id, run: context.run, as_of: context.as_of, session: context.session,
    ...("market_run" in context ? { market_run: context.market_run, market_snapshot_id: context.market_snapshot_id } : {}),
    status: "OK", missing_sources: [], items: [], claims: [], limitations: [],
    ...fields,
  };
}

const artifactId = (context: any, module: string) => context.artifacts.find((row: any) => row.module === module).id as string;

test("review row: name, inject, the module's two tools, market_run optional in the schema; a mount without the backbone names the row", () => {
  assert.equal(reviewRow.name, "lunhui-review");
  assert.deepEqual(reviewRow.inject, ["tools", "lunhuiRuns"]);
  const scope = fakeScope({ lunhuiRuns: {} });
  reviewRow.apply(scope.ctx, {});
  assert.deepEqual(scope.tools.map((tool) => tool.name), ["lunhui_read_counterevidence_context", "lunhui_submit_counterevidence"]);
  assert.deepEqual(scope.tools[0].parameters.required, ["strategy", "run"]);
  assert.deepEqual(Object.keys(scope.tools[0].parameters.properties), ["strategy", "run", "market_run"]);
  assert.deepEqual(Object.keys(scope.tools[1].parameters.properties), ["strategy", "run", "analysis"]);
  assert.match(scope.tools[0].description, /cn-market 的运行不带 market_run/u);
  assert.match(scope.tools[0].description, /策略频道的运行须/u);
  assert.throws(() => reviewRow.apply(fakeScope().ctx, {}), { message: /^lunhui-review: .*lunhui-runs/ });
});

test("counterevidence contract: the ten rulings and §5 by topic with paragraph ids, the items schema, every class owned, a contract per channel", () => {
  assert.equal(contract.hypotheses, HYPOTHESES);
  for (const id of ["P0016", "P0534", "P0755", "P0780", "P0403", "P0874", "P0337", "P0205", "P0524", "P1694", "P0011"]) assert.match(HYPOTHESES, new RegExp(id));
  assert.match(HYPOTHESES, /§7/u);
  assert.match(HYPOTHESES, /§5/u);
  assert.deepEqual(KINDS, ["CONTRADICTS", "MISSING_EVIDENCE", "STALE", "RULING_CONFLICT", "OVERREACH"]);
  const items = (contract.schema.properties as any).items;
  assert.deepEqual([items.minItems, items.maxItems], [0, 12]);
  assert.deepEqual(items.items.required, ["id", "against", "kind", "text", "evidence_ids"]);
  assert.equal(items.items.properties.id.pattern, "^x\\d{1,2}$");
  assert.deepEqual(items.items.properties.kind.enum, KINDS);
  assert.equal(items.items.properties.text.maxLength, 160);
  assert.deepEqual([items.items.properties.evidence_ids.minItems, items.items.properties.evidence_ids.maxItems], [0, 16]);
  assert.deepEqual(contract.owns, Object.keys(SCOPE_CLASSES));
  assert.equal(contract.marketRun, "optional");
  const market = contract.forStrategy!("cn-market");
  assert.equal(market.marketRun, undefined);
  assert.deepEqual([market.sources, market.runArtifacts, market.required, market.requiredAny], [["index", "limit-up", "boards"], ["environment", "sentiment", "theme"], [], ["environment", "sentiment", "theme"]]);
  const strategy = contract.forStrategy!("alpha");
  assert.equal(strategy.marketRun, "required");
  assert.deepEqual([strategy.sources, strategy.marketSources, strategy.marketArtifacts, strategy.runArtifacts, strategy.required],
    [["quotes"], ["index", "limit-up", "boards"], ["environment", "sentiment", "theme"], ["leader"], ["leader", "market:sentiment", "market:theme"]]);
});

test("counterevidence in cn-market: the run's three artifacts shown, no market_run - an item against a shown artifact accepted, an owned-class sentence on its evidence; the refusals REFERENCE or SCHEMA", async (t) => {
  const { read, submit, market, service, root } = await setup(t);
  const text = await read.execute({ strategy: "cn-market", run: market }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.ok(!("market_run" in context) && !("market_snapshot_id" in context));
  assert.ok(!("market_run" in context.example));
  assert.equal(context.hypotheses_version, hypothesesVersion(HYPOTHESES));
  assert.deepEqual(context.artifacts.map((row: any) => row.module), ["environment", "sentiment", "theme"]);
  for (const word of ["160", "CONTRADICTS", "OVERREACH", "空列表", "mode"]) assert.match(JSON.stringify(context.hints), new RegExp(word, "u"));
  const breadth = idWhere(context, (row) => row.measure === "breadth" && row.params.board === "BK0715");
  const theme = artifactId(context, "theme");
  const item = { id: "x1", against: "theme", kind: "CONTRADICTS", text: "主线候选 BK0715 的上涨占比偏低，与所引派生证据相悖。", evidence_ids: [breadth, theme] };
  const claims = [{ id: "c1", text: "审查了三个工件，所引派生证据见各项。", basis: "CURRENT", evidence_ids: [breadth] }];
  const cases: Array<[unknown, RegExp]> = [
    [{ ...item, against: "mode" }, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.items\[0\]\.against/u],
    [{ ...item, against: "counterevidence" }, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.items\[0\]\.against/u],
    // The leader's artifact is not shown in cn-market.
    [{ ...item, against: "leader" }, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.items\[0\]\.against/u],
    [{ ...item, evidence_ids: [] }, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.items\[0\]\.evidence_ids/u],
    // Resting only on the artifact it is against.
    [{ ...item, evidence_ids: [theme] }, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.items\[0\]\.evidence_ids/u],
    [{ ...item, text: "证".repeat(161) }, /^INVALID_ANALYSIS: \[SCHEMA\] analysis\.items\[0\]\.text/u],
    [{ ...item, kind: "WRONG" }, /^INVALID_ANALYSIS: \[SCHEMA\] analysis\.items\[0\]\.kind/u],
  ];
  for (const [entry, pattern] of cases)
    assert.match((await refusal(submit, "cn-market", market, artifact(context, { items: [entry], claims }))).message, pattern);
  const twice = await refusal(submit, "cn-market", market, artifact(context, { items: [item, { ...item, against: "sentiment" }], claims }));
  assert.match(twice.message, /^INVALID_ANALYSIS: \[SCHEMA\] analysis\.items\[1\]\.id/u);
  assert.deepEqual(await submitted(submit, "cn-market", market, artifact(context, { items: [item, { ...item, id: "x2", text: "证".repeat(160), kind: "OVERREACH" }], claims })),
    { accepted: true, module: "counterevidence", run: market });
  const stored = JSON.parse(await readFile(join(root, "cn-market", "analysis", market, "counterevidence.json"), "utf8"));
  assert.ok(!("market_run" in stored));
  assert.deepEqual(stored.items.map((entry: any) => entry.id), ["x1", "x2"]);
  assert.equal((await service.readRun("cn-market", market)).metrics.calls.counterevidence, 10);
});

test("counterevidence in cn-market: an empty review is a result - the example accepted with no items", async (t) => {
  const { read, submit, market } = await setup(t);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
  assert.deepEqual([context.example.status, context.example.items], ["OK", []]);
  assert.deepEqual(await submitted(submit, "cn-market", market, context.example), { accepted: true, module: "counterevidence", run: market });
});

test("counterevidence in cn-market: a market_run given - another run or its own - is WRONG_CHANNEL, uncounted; a run with no accepted market artifact expects NOT_EVALUABLE naming the three", async (t) => {
  const mounted = await setup(t);
  const { read, submit, market, service, freeze } = mounted;
  const bare = await marketRun(service, freeze, { artifacts: false });
  for (const cited of [market, bare]) {
    const error = await rejectsWith(read.execute({ strategy: "cn-market", run: bare, market_run: cited }, exec(ROLE)), "WRONG_CHANNEL");
    assert.match(error.message, /market_run/u);
  }
  assert.equal((await service.readRun("cn-market", bare)).metrics.calls.counterevidence, undefined);
  const context = JSON.parse(await read.execute({ strategy: "cn-market", run: bare }, exec(ROLE)));
  assert.equal(context.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(context.missing, ["environment", "sentiment", "theme"]);
  assert.deepEqual(context.example.missing_sources, ["environment", "sentiment", "theme"]);
  const derived = context.derived[0].id;
  const ok = artifact(context, { claims: [{ id: "c1", text: "所引派生证据只示格式。", basis: "INSUFFICIENT", evidence_ids: [derived] }] });
  assert.match((await refusal(submit, "cn-market", bare, ok)).message, /^INVALID_ANALYSIS: \[SCHEMA\] /u);
  assert.deepEqual(await submitted(submit, "cn-market", bare, context.example), { accepted: true, module: "counterevidence", run: bare });
});

/* A review with accepted artifacts but no evidence row to cite (a sealed empty run): the channel's evidence
 * sources join `missing`, so the example is NOT_EVALUABLE and accepted - an OK review would need a claim
 * citing an item the context does not hold. In cn-market the run's three; in a strategy run its quotes and
 * the market run's three - the leader's and the mode's contexts likewise, over their own sources. The mode
 * over that NOT_EVALUABLE review cannot register S01: it WAITs. */
test("counterevidence over a sealed empty run: no evidence row shown - the channel's sources missing, the NOT_EVALUABLE example accepted, in cn-market and in a strategy run, the leader's and the mode's too; the mode refuses S01 and WAITs", async (t) => {
  const { root, service, read, submit } = await mount(t, reviewRow);
  const S01 = "lunhui-s01-repair";
  await mkdir(join(root, S01));
  await copyFile(fileURLToPath(new URL(`../../strategies/${S01}/THESIS.md`, import.meta.url)), join(root, S01, "THESIS.md"));
  type Meta = { received_at: string; session: string; host: string; delayed: boolean; truncated: boolean };
  const runs = service as {
    openRun(s: string, k: "market" | "strategy"): Promise<{ run: string }>;
    addEvidence(s: string, r: string, source: string, items: unknown[], meta: Meta): Promise<unknown>;
  };
  // A session but no item: an empty 涨停池 of the harness's Friday (a run with no evidence file has no session to cite).
  const meta: Meta = { received_at: "2026-10-23T07:00:00.000Z", session: "2026-10-23", host: "fixture", delayed: false, truncated: false };
  // The empty market run: sealed on the environment's read, its three artifacts accepted NOT_EVALUABLE.
  const { run: market } = await runs.openRun("cn-market", "market");
  await runs.addEvidence("cn-market", market, "limit-up", [], meta);
  for (const row of [environmentRow, sentimentRow, themeRow]) {
    const [moduleRead, moduleSubmit] = tools(service, row);
    const context = JSON.parse(await moduleRead.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
    assert.equal(context.status_expected, "NOT_EVALUABLE");
    assert.equal((await submitted(moduleSubmit, "cn-market", market, context.example)).accepted, true);
  }
  const marketContext = JSON.parse(await read.execute({ strategy: "cn-market", run: market }, exec(ROLE)));
  assert.deepEqual(marketContext.artifacts.map((row: any) => row.module), ["environment", "sentiment", "theme"]);
  assert.deepEqual([marketContext.evidence, marketContext.derived], [[], []]);
  assert.equal(marketContext.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(marketContext.missing, ["index", "limit-up", "boards"]);
  assert.deepEqual([marketContext.example.status, marketContext.example.missing_sources, marketContext.example.items], ["NOT_EVALUABLE", ["index", "limit-up", "boards"], []]);
  assert.deepEqual(await submitted(submit, "cn-market", market, marketContext.example), { accepted: true, module: "counterevidence", run: market });

  // An empty S01 strategy run citing it: the leader, the review, then the mode, each over no row to cite -
  // NOT_EVALUABLE naming its channel's sources, its example accepted.
  const { run } = await runs.openRun(S01, "strategy");
  await runs.addEvidence(S01, run, "quotes", [], meta);
  const [leaderRead, leaderSubmit] = tools(service, leaderRow);
  const leaderContext = JSON.parse(await leaderRead.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  assert.deepEqual([leaderContext.evidence, leaderContext.derived], [[], []]);
  assert.deepEqual([leaderContext.status_expected, leaderContext.missing], ["NOT_EVALUABLE", ["quotes", "market:limit-up", "market:boards"]]);
  assert.deepEqual(await submitted(leaderSubmit, S01, run, leaderContext.example), { accepted: true, module: "leader", run });
  const context = JSON.parse(await read.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  assert.deepEqual(context.artifacts.map((row: any) => row.module), ["leader", "environment", "sentiment", "theme"]);
  assert.deepEqual([context.evidence, context.derived], [[], []]);
  assert.equal(context.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(context.missing, ["quotes", "market:index", "market:limit-up", "market:boards"]);
  assert.deepEqual([context.example.status, context.example.missing_sources, context.example.market_run], ["NOT_EVALUABLE", context.missing, market]);
  assert.deepEqual(await submitted(submit, S01, run, context.example), { accepted: true, module: "counterevidence", run });
  // The mode over that NOT_EVALUABLE review: NOT_EVALUABLE itself, S01 refused, its WAIT example accepted.
  const [modeRead, modeSubmit] = tools(service, modeRow);
  const modeContext = JSON.parse(await modeRead.execute({ strategy: S01, run, market_run: market }, exec(ROLE)));
  assert.deepEqual([modeContext.evidence, modeContext.derived], [[], []]);
  assert.deepEqual([modeContext.status_expected, modeContext.missing], ["NOT_EVALUABLE", ["quotes", "market:index", "market:limit-up", "market:boards"]]);
  assert.match((await refusal(modeSubmit, S01, run, { ...modeContext.example, mode: "S01" })).message, /^INVALID_ANALYSIS: /u);
  assert.deepEqual([modeContext.example.status, modeContext.example.mode], ["NOT_EVALUABLE", "WAIT"]);
  assert.deepEqual(await submitted(modeSubmit, S01, run, modeContext.example), { accepted: true, module: "mode", run });
  assert.equal(JSON.parse(await readFile(join(root, S01, "analysis", run, "mode.json"), "utf8")).mode, "WAIT");
});

test("counterevidence in a strategy run: market_run required - refused at the read, uncounted, when absent; no leader artifact expects NOT_EVALUABLE naming leader", async (t) => {
  const mounted = await setup(t);
  const { read, submit, market, service } = mounted;
  const run = await strategyRun(mounted, { leader: false });
  const error = await rejectsWith(read.execute({ strategy: "alpha", run }, exec(ROLE)), "MISSING_EVIDENCE");
  assert.match(error.message, /market_run/u);
  assert.equal((await service.readRun("alpha", run)).metrics.calls.counterevidence, undefined);
  const context = JSON.parse(await read.execute({ strategy: "alpha", run, market_run: market }, exec(ROLE)));
  assert.equal(context.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(context.missing, ["leader"]);
  assert.deepEqual(context.example.missing_sources, ["leader"]);
  assert.equal(context.example.market_run, market);
  assert.deepEqual(await submitted(submit, "alpha", run, context.example), { accepted: true, module: "counterevidence", run });
});

test("counterevidence in a strategy run: a leader artifact citing another market run is MISSING_EVIDENCE at the read, naming the leader's", async (t) => {
  const mounted = await setup(t);
  const { read, market, service, freeze } = mounted;
  const other = await marketRun(service, freeze);
  const run = await strategyRun(mounted, { market: other });
  const error = await rejectsWith(read.execute({ strategy: "alpha", run, market_run: market }, exec(ROLE)), "MISSING_EVIDENCE");
  assert.match(error.message, new RegExp(other));
  assert.match(error.message, /counterevidence/u);
});

test("counterevidence in a strategy run: the leader and the market run's three artifacts shown, the envelope binds market_run - an item against the leader accepted, against mode REFERENCE", async (t) => {
  const mounted = await setup(t);
  const { read, submit, market, root } = mounted;
  const run = await strategyRun(mounted);
  const text = await read.execute({ strategy: "alpha", run, market_run: market }, exec(ROLE));
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.equal(context.market_run, market);
  assert.deepEqual(context.artifacts.map((row: any) => row.module), ["leader", "environment", "sentiment", "theme"]);
  // The cited run's counts row shows the six counts and their session, as the market modules' does.
  const countsRows = context.evidence.filter((row: any) => row.kind === "counts");
  assert.equal(countsRows.length, 1);
  assert.deepEqual(Object.keys(countsRows[0]).sort(), ["advancers", "decliners", "id", "kind", "limitDown", "limitUp", "qdate", "scope", "source", "total", "unchanged"]);
  assert.equal(countsRows[0].source, "market:index");
  const quote = idWhere(context, (row) => row.kind === "quote" && row.symbol === "sh600519");
  const item = { id: "x1", against: "leader", kind: "MISSING_EVIDENCE", text: "龙头候选只有一个交易日的报价，地位的持续性待核验。", evidence_ids: [quote, artifactId(context, "leader")] };
  const claims = [{ id: "c1", text: "审查了 leader 工件与所引报价。", basis: "CURRENT", evidence_ids: [quote] }];
  assert.match((await refusal(submit, "alpha", run, artifact(context, { items: [{ ...item, against: "mode" }], claims }))).message,
    /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.items\[0\]\.against/u);
  const unbound = await refusal(submit, "alpha", run, { ...artifact(context, { items: [item], claims }), market_run: "m_other_run" });
  assert.match(unbound.message, /^INVALID_ANALYSIS: \[REFERENCE\] analysis\.market_run/u);
  assert.deepEqual(await submitted(submit, "alpha", run, artifact(context, { items: [item, { ...item, id: "x2", against: "sentiment", kind: "STALE", text: "情绪状态读自前一个交易日之外的证据，需要本运行的报价核对。" }], claims })),
    { accepted: true, module: "counterevidence", run });
  const stored = JSON.parse(await readFile(join(root, "alpha", "analysis", run, "counterevidence.json"), "utf8"));
  assert.deepEqual([stored.market_run, stored.market_snapshot_id], [market, context.market_snapshot_id]);
});

test("counterevidence in a strategy run: the maximal pin - a live-size market run, the leader and the three market artifacts at their caps - fits 30 KiB with leader, sentiment and theme shown, OK expected", async (t) => {
  const CODES = Array.from({ length: 30 }, (_, i) => `BK${2000 + i}`);
  const EQUITIES = ["sh600519", "sz000333", "sh601318", "sz000001"];
  const widen = async (dir: string) => {
    for (const [pool, file, base] of [["zt", "zt-pool.json", 680000], ["zb", "zb-pool.json", 690000], ["yesterday", "yesterday-pool.json", 830000]] as const) {
      const reply = JSON.parse(await readFile(join(dir, file), "utf8"));
      const [row] = reply.data.pool;
      reply.data.pool = Array.from({ length: 500 }, (_, k) => ({ ...row, c: String(base + k), n: `示例${pool}${k}` }));
      if (pool === "zt") reply.data.pool[450] = { ...row, c: "600519", n: "示例600519", lbc: 4 };
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
      await writeFile(join(dir, `members-${code}.json`), JSON.stringify(members));
    }
  };
  const mainline = [["BK2000", "示例板块0"], ["BK2001", "示例板块1"], ["BK2002", "示例板块2"]];
  const mounted = await setup(t, { prepare: widen, mainline, boards: null });
  const { root, read, submit, market } = mounted;
  const run = await strategyRun(mounted, { symbols: EQUITIES });
  const sixteen = (seed: number) => Array.from({ length: 16 }, (_, i) => `ev_${(seed * 100 + i).toString(16).padStart(24, "0")}`);
  const claims = (seed: number) => Array.from({ length: 12 }, (_, i) => ({ id: `c${i + 1}`, text: `${i}`.padEnd(300, "证"), basis: "CURRENT", evidence_ids: sixteen(seed + i) }));
  // The market run's three artifacts at their caps, written over the accepted ones.
  const marketDir = await realpath(join(root, "cn-market", "analysis", market));
  const stored = async (dir: string, module: string) => JSON.parse(await readFile(join(dir, `${module}.json`), "utf8"));
  await writeArtifact(marketDir, "environment", { ...(await stored(marketDir, "environment")), cycle_anchor: "锚".repeat(120), claims: claims(1) });
  await writeArtifact(marketDir, "sentiment", { ...(await stored(marketDir, "sentiment")), claims: claims(2) });
  const theme = await stored(marketDir, "theme");
  await writeArtifact(marketDir, "theme", {
    ...theme, claims: claims(3),
    mainline_candidates: [...mainline.map(([code]) => code), "BK2003", "BK2004"].map((board, i) => ({ board, name: `示例${i}`.padEnd(40, "板"), evidence_ids: sixteen(40 + i) })),
  });
  // The run's leader at its cap: five candidates of sixteen ids, twelve 300-character claims.
  const runDir = await realpath(join(root, "alpha", "analysis", run));
  const leader = await stored(runDir, "leader");
  await writeArtifact(runDir, "leader", {
    ...leader, claims: claims(5), top_pattern_flags: ["ACCELERATING", "DIVERGENCE", "BROKEN_STREAK", "HIGH_POSITION", "FIRST_BOARD"],
    leader_candidates: ["sh600519", "sz000333", "sh601318", "sz000001", "sh600000"].map((symbol, i) => ({ symbol, name: `示例${i}`.padEnd(20, "股"), rank: i + 1, board: "BK2000", evidence_ids: sixteen(60 + i) })),
  });
  const text = await read.execute({ strategy: "alpha", run, market_run: market }, exec(ROLE));
  const size = Buffer.byteLength(text, "utf8");
  // Measured 2026-10-26: 30,703 bytes - leader 3,461, environment 2,593, sentiment 2,226, theme 3,565, the four quotes (a `first` entry, filled before the derived items), 69 derived rows.
  assert.ok(size <= MAX_CONTEXT_BYTES, `${size} bytes`);
  const context = JSON.parse(text);
  assert.equal(context.status_expected, "OK");
  assert.deepEqual(context.missing, []);
  assert.deepEqual(context.artifacts.map((row: any) => row.module), ["leader", "environment", "sentiment", "theme"]);
  assert.match(context.hints.against, /leader、environment、sentiment、theme/u);
  assert.deepEqual(context.evidence.filter((row: any) => row.kind === "quote").map((row: any) => row.symbol).sort(), [...EQUITIES].sort());
  // At the cap the cited run's counts row is among the rows left out; one shown is the slim view, as the market modules' is.
  for (const row of context.evidence.filter((row: any) => row.kind === "counts"))
    assert.deepEqual(Object.keys(row).sort(), ["advancers", "decliners", "id", "kind", "limitDown", "limitUp", "qdate", "scope", "source", "total", "unchanged"]);
  // A review standing on what it shows is accepted.
  const quote = idWhere(context, (row) => row.kind === "quote" && row.symbol === "sh600519");
  const leaderId = context.artifacts[0].id as string;
  assert.deepEqual(await submitted(submit, "alpha", run, artifact(context, {
    items: Array.from({ length: 12 }, (_, i) => ({ id: `x${i + 1}`, against: "leader", kind: "MISSING_EVIDENCE", text: "候选的地位只有一个交易日的冻结证据，".repeat(9).slice(0, 160), evidence_ids: [quote, leaderId] })),
    claims: [{ id: "c1", text: "审查了 leader 工件与所引报价。", basis: "CURRENT", evidence_ids: [quote] }],
  })), { accepted: true, module: "counterevidence", run });
});
