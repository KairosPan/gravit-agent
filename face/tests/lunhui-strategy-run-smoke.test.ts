/** An S01 registered on Friday and graded on Monday on a real boot, the reviewer in both channels (modules spec
 * §5.10, A5, A6, A12, A22, A27, §5.11). Each day Gravit, played by the stub, follows the run protocol: the cn-market
 * run - the index, limit-up and boards freezes, role_cn_market_analyst submitting three artifacts, role_cn_reviewer
 * without market_run, lunhui_read_run - then the strategy channel for lunhui-s01-repair: lunhui_read_run on cn-market
 * without a run (the listing) to find the day's market run, the same with that run, the quotes of two equities its
 * theme's mainline board holds frozen on the strategy (opening the strategy run), role_cn_stock_analyst for the
 * leader, role_cn_reviewer with both run ids, role_cn_stock_analyst for the mode, and the strategy run read back.
 * Each role child, played by the stub too, builds its artifact from the ids the context it received shows. Friday's
 * mode registers S01 with a card (preconditions met by class, the minute confirmation `unmet: no source`, every
 * counterevidence item addressed, the parameters used); Monday's grades it (`expectation_review.previous_run`
 * Friday's run). Pinned: every artifact of both days' four runs accepted and passing its contract again against a
 * digest rebuilt from the sealed runs as the read built it; the card at most 2,048 bytes; the runs card's latest run
 * Monday's, with its review line; Gravit's prompt carrying the run protocol with its strategy channel.
 *
 * The boot is the market smoke's: a temp DSH_HOME, port 0, AKShare and the seat off, the stub the default model,
 * `lunhui-runs` over a temp strategies root holding copies of the shipped cn-market and lunhui-s01-repair, the
 * freeze rows' `fetch` one directory holding both fixture sets, and a fixture roles root whose three roles are
 * routed to the stub. The clock: a patch cannot carry `config.now` into a booted row, so `Date` is replaced - its
 * "now" Friday 2026-10-23 15:00 China time for Friday's prompt, then Monday 2026-10-26 15:00, the next trading day,
 * for Monday's - each advancing in real time; the freezes stamp each day's session from it, so Monday's market run
 * is fresh for Monday's strategy run (A5) and Friday's is an earlier session. The fixtures are one set for both
 * days but the distribution, whose `qdate` is rolled to Monday before Monday's prompt, as the live endpoint
 * answers its latest session (spec §16). The fixture copy is the leader tests': 600519 sealed in the 涨停池, 600519 and 000333 members of BK0715,
 * so a candidate can stand. Own file, gated. */
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { SessionId, type Session } from "@deepseek-ai/dsh-session";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { ROLES_ROOT, readRoles } from "../src/roles.ts";
import { LUNHUI_RUN_PATH, readProtocol } from "../src/protocols.ts";
import { readChannelBody } from "../src/channels.ts";
import { buildContext, validateEnvelope } from "../plugins/lunhui/lib/contract-core.mjs";
import { createLunhuiRuns } from "../plugins/lunhui/runs-row.mjs";
import { contract as leaderContract } from "../plugins/lunhui/lib/contracts/leader.mjs";
import { CARD_BYTES, contract as modeContract } from "../plugins/lunhui/lib/contracts/mode.mjs";
import { contract as environmentContract } from "../plugins/lunhui/lib/contracts/environment.mjs";
import { contract as sentimentContract } from "../plugins/lunhui/lib/contracts/sentiment.mjs";
import { contract as themeContract } from "../plugins/lunhui/lib/contracts/theme.mjs";
import { contract as reviewContract } from "../plugins/lunhui/lib/contracts/counterevidence.mjs";
import { runsView } from "../client/js/host/runs-view.js";
import { makeBotsRoot } from "./bots-fixture.ts";
import { mountClient, remote, signIn } from "./remote.ts";
import { StubAdapter, type StubReply } from "./stub-llm.ts";

const gated = process.env.FACE_SMOKE !== "1";
const TESTS = dirname(fileURLToPath(import.meta.url));
const TENCENT = join(TESTS, "fixtures", "lunhui");
const EASTMONEY = join(TESTS, "fixtures", "lunhui-eastmoney");
const STRATEGIES = join(TESTS, "..", "..", "strategies");
const S01 = "lunhui-s01-repair";
/** Friday 2026-10-23, 15:00 in China: after the close of the session the Eastmoney fixtures carry. */
const FRIDAY = Date.parse("2026-10-23T07:00:00.000Z");
/** Monday 2026-10-26, 15:00 in China: the next trading day's close. */
const MONDAY = Date.parse("2026-10-26T07:00:00.000Z");
/** The real `Date`, captured before any shift, so each day's shift is from the real clock. */
const REAL_DATE = Date;
const FREEZE_ROWS = ["lunhui-freeze-quotes", "lunhui-freeze-limit-up", "lunhui-freeze-boards", "lunhui-freeze-index"];
const MARKET_MODULES = ["environment", "sentiment", "theme"] as const;
type MarketModule = (typeof MARKET_MODULES)[number];
const STOCK_MODULES = ["leader", "mode"] as const;
type StockModule = (typeof STOCK_MODULES)[number];
/** Every module's contract, by name; the reviewer's picks its channel's (`forStrategy`). */
const CONTRACTS: Record<string, any> = { environment: environmentContract, sentiment: sentimentContract, theme: themeContract, leader: leaderContract, mode: modeContract, counterevidence: reviewContract };
/** A market run's four artifacts and a strategy run's three, as each lands. */
const MARKET_ARTIFACTS = [...MARKET_MODULES, "counterevidence"];
const STRATEGY_ARTIFACTS = ["leader", "counterevidence", "mode"];
/** The equities Gravit chooses from BK0715's members, which the fixture copy makes hold them. */
const SYMBOLS = ["sh600519", "sz000333"];
/** The run protocol (`dsh/profile/lunhui-run.md`, the `lunhui:run` section), read from the file: its first line and its strategy channel. */
const PROTOCOL = readProtocol(LUNHUI_RUN_PATH);
const RUN_HEADING = PROTOCOL.split("\n")[0];
const STRATEGY_CHANNEL = PROTOCOL.includes("## 策略频道") ? PROTOCOL.slice(PROTOCOL.indexOf("## 策略频道"), PROTOCOL.indexOf("\n## ", PROTOCOL.indexOf("## 策略频道") + 1)).trim() : null;

const sourceKind = (m: { source?: unknown }) => ((m.source ?? {}) as { kind?: string }).kind;
const textOf = (m: GenerateOptions["messages"][number]) => m.content.map((b) => "text" in b ? b.text : "").join("\n");
const lastHuman = (r: GenerateOptions) => [...r.messages].reverse().find((m) => ["user", "tool"].includes(String(sourceKind(m))));
/** The text of each tool result a request sends the model, in order. */
const toolTexts = (request: GenerateOptions) => request.messages.filter((m) => sourceKind(m) === "tool").map(textOf);
async function waitFor(label: string, check: () => boolean, ms = 90_000) {
  const until = Date.now() + ms;
  while (!check()) { if (Date.now() >= until) throw new Error(`timed out: ${label}`); await new Promise((r) => setTimeout(r, 20)); }
}

/** `Date` with its "now" moved to `at`, advancing in real time; a date built from arguments is unchanged. */
function shiftedDate(at: number): DateConstructor {
  const Real = REAL_DATE;
  const offset = at - Real.now();
  const now = () => Real.now() + offset;
  return new Proxy(Real, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget),
    apply: () => new Real(now()).toString(),
    get: (target, key, receiver) => key === "now" ? now : Reflect.get(target, key, receiver),
  });
}

/**
 * One directory holding both fixture sets, a member list for every fixture board (the boards freeze reads all
 * four; the two copies made before the equities join BK0715), and the leader tests' copy: 600519 sealed in the
 * 涨停池, 600519 and 000333 members of BK0715.
 */
async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "face-strategy-run-fixtures-"));
  await cp(TENCENT, dir, { recursive: true });
  await cp(EASTMONEY, dir, { recursive: true });
  for (const code of ["BK0493", "BK1099"]) await cp(join(EASTMONEY, "members-BK0715.json"), join(dir, `members-${code}.json`));
  const zt = JSON.parse(await readFile(join(dir, "zt-pool.json"), "utf8"));
  zt.data.pool.push({ ...zt.data.pool[0], c: "600519", m: 1, n: "贵州茅台", lbc: 4, fbt: 93000, lbt: 93000, zttj: { days: 4, ct: 4 } });
  zt.data.tc = zt.data.pool.length;
  await writeFile(join(dir, "zt-pool.json"), JSON.stringify(zt));
  const members = JSON.parse(await readFile(join(dir, "members-BK0715.json"), "utf8"));
  members.data.diff.push({ f3: 0.76, f12: "600519", f14: "贵州茅台" }, { f3: -1.6, f12: "000333", f14: "美的集团" });
  members.data.total = members.data.diff.length;
  await writeFile(join(dir, "members-BK0715.json"), JSON.stringify(members));
  return dir;
}

/* The artifacts the role children build: each from the parsed context text alone. */
type Context = { module: string; status_expected: string; missing: string[]; evidence: any[]; derived: any[]; artifacts?: any[]; example: any; [field: string]: any };

/** The envelope fields, copied from the context, and the status it expects. */
function envelopeOf(context: Context) {
  const { module, contract_version, hypotheses_version, snapshot_id, run, as_of, session } = context;
  return { module, contract_version, hypotheses_version, snapshot_id, run, as_of, session, status: context.status_expected, missing_sources: [...context.missing] };
}
const need = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`the context lacks ${what}`);
  return value;
};
const derivedOf = (context: Context, measure: string, board?: string) =>
  need(context.derived.find((d) => d.measure === measure && (board === undefined || d.params?.board === board)), `the derived ${measure}${board ? ` of ${board}` : ""}`);

/** The market smoke's environment: the index state from the sh000001 quote, the liquidity from the turnover. */
function environmentArtifact(context: Context) {
  const quote = need(context.evidence.find((e) => e.kind === "index" && e.symbol === "sh000001"), "the sh000001 index quote");
  const turnover = derivedOf(context, "total_turnover");
  const index_state = quote.changePercent > 0.3 ? "STRONG" : quote.changePercent < -0.3 ? "WEAK" : "NEUTRAL";
  return {
    ...envelopeOf(context),
    index_state,
    liquidity_state: "STABLE",
    cycle_anchor: "单日读数给出的工作标签，待后续交易日的冻结证据复核。",
    claims: [
      { id: "c1", basis: "CURRENT", evidence_ids: [quote.id], text: `${quote.name}收于 ${quote.last}，较前收变动 ${quote.changePercent}%，指数状态记为 ${index_state}。` },
      { id: "c2", basis: "CURRENT", evidence_ids: [turnover.id], text: `两市成交额合计约 ${Math.round(turnover.value / 1e8)} 亿元，流动性状态记为 STABLE。` },
    ],
    limitations: ["缺少前后交易日的对比读数。"],
  };
}

/** The market smoke's sentiment: money effect, freeze reading and state from the limit-up derived items. */
function sentimentArtifact(context: Context) {
  const median = derivedOf(context, "yesterday_return_median");
  const seal = derivedOf(context, "seal_ratio");
  const streak = derivedOf(context, "streak_distribution");
  const counts = need(context.evidence.find((e) => e.kind === "counts"), "the market counts");
  const money_effect = median.value > 0 ? "POSITIVE" : median.value < 0 ? "NEGATIVE" : "MIXED";
  const freeze_type = seal.value >= 0.5 ? "NONE" : "ICE_POINT";
  const highest = Math.max(...Object.keys(streak.value).map(Number));
  return {
    ...envelopeOf(context),
    state: highest >= 3 && seal.value >= 0.5 ? "EXPANSION" : "CHAOS",
    money_effect,
    freeze_type,
    claims: [
      { id: "c1", basis: "CURRENT", evidence_ids: [median.id], text: `昨日涨停股本交易日涨跌幅中位数为 ${median.value}%，赚钱效应记为 ${money_effect}。` },
      { id: "c2", basis: "CURRENT", evidence_ids: [seal.id], text: `封板率约 ${seal.value.toFixed(2)}，冰点读数记为 ${freeze_type}。` },
      { id: "c3", basis: "CURRENT", evidence_ids: [streak.id, counts.id], text: `连板分布最高为 ${highest} 板；家数计数为上涨 ${counts.advancers} 家、下跌 ${counts.decliners} 家。` },
    ],
    limitations: [],
  };
}

/** BK0715, the board whose members the copy extends, as the one mainline candidate; the runner-up's share for the rotation. */
function themeArtifact(context: Context) {
  const code = "BK0715";
  const share = derivedOf(context, "turnover_share", code);
  const second = need(context.derived.filter((d) => d.measure === "turnover_share" && d.params.board !== code && typeof d.value === "number")
    .sort((a, b) => b.value - a.value)[0], "a second board's turnover share");
  const board = need(context.evidence.find((e) => e.kind === "board" && e.code === code), `the board item of ${code}`);
  const members = need(context.evidence.find((e) => e.kind === "members" && e.board === code), `the members item of ${code}`);
  const runnerUp = need(context.evidence.find((e) => e.kind === "board" && e.code === second.params.board), `the board item of ${second.params.board}`);
  const breadth = derivedOf(context, "breadth", code);
  return {
    ...envelopeOf(context),
    mainline_candidates: [{ board: code, name: board.name, evidence_ids: [board.id, members.id, breadth.id, share.id] }],
    theme_stage: "FERMENT",
    rotation: "ROTATING",
    claims: [
      { id: "c1", basis: "CURRENT", evidence_ids: [breadth.id], text: `${board.name}板块上涨占比约 ${breadth.value.toFixed(2)}，题材阶段记为 FERMENT。` },
      { id: "c2", basis: "CURRENT", evidence_ids: [second.id], text: `成交占比第二的板块为${runnerUp.name}，约 ${second.value.toFixed(2)}，轮动方向记为 ROTATING。` },
    ],
    limitations: [],
  };
}
const MARKET_BUILD: Record<MarketModule, (context: Context) => unknown> = { environment: environmentArtifact, sentiment: sentimentArtifact, theme: themeArtifact };

/**
 * The leader: every priced equity quote whose code a shown pool row or member list holds, ranked in the quotes'
 * order, its board the member list's; a claim each - on its 涨停池 row and quote, or on its member list and the
 * theme artifact.
 */
function leaderArtifact(context: Context) {
  const theme = need(context.artifacts?.find((a) => a.module === "theme"), "the theme artifact");
  const candidates: any[] = [];
  const claims: any[] = [];
  for (const quote of context.evidence.filter((e) => e.kind === "quote" && typeof e.last === "number")) {
    const code = quote.symbol.slice(2);
    const zt = context.evidence.find((e) => e.pool === "zt" && e.code === code);
    const list = context.evidence.find((e) => e.kind === "members" && e.members.includes(code));
    if (zt === undefined && list === undefined) continue;
    const id = `c${candidates.length + 1}`;
    candidates.push({ symbol: quote.symbol, name: quote.name, rank: candidates.length + 1, board: list?.board ?? null, evidence_ids: [quote.id, (zt ?? list).id] });
    claims.push(zt !== undefined
      ? { id, basis: "CURRENT", evidence_ids: [zt.id, quote.id], text: `${quote.name}连板数见所引涨停池行。` }
      : { id, basis: "CURRENT", evidence_ids: [list.id, theme.id], text: `${quote.name}是 ${list.board} 的成分股，所在板块见所引工件。` });
  }
  return {
    ...envelopeOf(context), market_run: context.market_run, market_snapshot_id: context.market_snapshot_id,
    leader_candidates: candidates, top_pattern_flags: [], claims, limitations: ["地位只按冻结的连板数与成分股读出。"],
  };
}

/** The run's artifact view of `module`, as the context shows it. */
const viewOf = (context: Context, module: string) => need(context.artifacts?.find((a: { module: string }) => a.module === module), `the ${module} artifact`);

/**
 * The mode: S01 - the strategy's own mode - built from the ids the context shows: the theme artifact for the
 * theme preconditions, the leader for the candidate, the sentiment for the negative tail, the minute
 * confirmation unmet for want of a source; every counterevidence item answered by its id; a card on the
 * leader's first candidate at the cited sentiment's state; and, when the context shows a previous card,
 * its grade on that candidate's quote this run froze.
 */
function modeArtifact(context: Context) {
  const theme = viewOf(context, "theme");
  const leader = viewOf(context, "leader");
  const sentiment = viewOf(context, "sentiment");
  const review = viewOf(context, "counterevidence");
  const symbol = need(leader.headline.leader_candidates?.[0]?.symbol, "the leader's first candidate");
  const quote = need(context.evidence.find((e) => e.kind === "quote" && e.symbol === symbol), `the quote of ${symbol}`);
  return {
    ...envelopeOf(context), market_run: context.market_run, market_snapshot_id: context.market_snapshot_id,
    mode: "S01",
    preconditions: [
      { id: "p1", name: "theme_gate", status: "met", evidence_ids: [theme.id] },
      { id: "p2", name: "candidate_before_divergence", status: "met", evidence_ids: [leader.id] },
      { id: "p3", name: "theme_not_falsified", status: "met", evidence_ids: [theme.id] },
      { id: "p4", name: "negative_tail_not_widening", status: "met", evidence_ids: [sentiment.id] },
      { id: "p5", name: "minute_confirmation", status: "unmet: no source", evidence_ids: [] },
    ],
    research_only_matches: [],
    expectation: {
      frozen_version: context.snapshot_id, candidates: [symbol], anchor: "本运行冻结报价的最新价，不事后换锚。", state: sentiment.headline.state,
      triggers: ["下一运行冻结的报价涨跌幅为正，且仍在涨停池中。"], vetoes: ["下一运行引用的市场状态为 CLIMAX、RETREAT 或 UNKNOWN。"],
      window: "下一个交易日。", price_band: "以锚点上下百分之五为观察区间。", holding_period: "一个交易日的观察。",
      branches: { 符合: "仍在涨停池且涨跌幅为正。", 强于: "连板数加一。", 弱于: "跌出涨停池或涨跌幅为负。" },
    },
    expectation_review: context.previous === null ? null : { previous_run: context.previous.run, grade: "符合", evidence_ids: [quote.id] },
    parameters_used: [{ name: "d_i", value: "未设定", note: "研究候选，没有生产值。" }],
    addressed: review.headline.items.map((item: { id: string }) => ({ item: item.id, response: "记入限制说明，下一运行核对。" })),
    claims: [{ id: "c1", basis: "CURRENT", evidence_ids: [quote.id], text: "S01 登记：前提见所引工件，分钟确认缺少来源。" }],
    limitations: ["分钟确认缺少来源，只作每日登记。"],
  };
}

/**
 * The reviewer's, in either channel: one item and a claim on a frozen item. In cn-market (no market_run in the
 * context) against the sentiment artifact on its seal ratio; in the strategy channel against the leader
 * artifact on its first candidate's quote, the envelope's market_run and market_snapshot_id copied.
 */
function reviewArtifact(context: Context) {
  if (!Object.hasOwn(context, "market_run")) {
    const sentiment = viewOf(context, "sentiment");
    const seal = derivedOf(context, "seal_ratio");
    return {
      ...envelopeOf(context),
      items: [{ id: "x1", against: "sentiment", kind: "MISSING_EVIDENCE", text: "封板率只有一个交易日的读数，缺少前一交易日的对照。", evidence_ids: [seal.id, sentiment.id] }],
      claims: [{ id: "c1", basis: "CURRENT", evidence_ids: [seal.id], text: "所引封板率是本运行冻结的单日读数。" }],
      limitations: [],
    };
  }
  const leader = viewOf(context, "leader");
  const quote = need(context.evidence.find((e) => e.kind === "quote" && e.symbol === leader.headline.leader_candidates?.[0]?.symbol), "the leader's first candidate's quote");
  return {
    ...envelopeOf(context), market_run: context.market_run, market_snapshot_id: context.market_snapshot_id,
    items: [{ id: "x1", against: "leader", kind: "MISSING_EVIDENCE", text: "候选的排序只按单日冻结的连板数读出，缺少前后交易日的对照。", evidence_ids: [quote.id, leader.id] }],
    claims: [{ id: "c1", basis: "CURRENT", evidence_ids: [quote.id], text: "所引报价是本运行冻结的单日读数。" }],
    limitations: [],
  };
}
const STOCK_BUILD: Record<StockModule, (context: Context) => unknown> = { leader: leaderArtifact, mode: modeArtifact };

test("strategy run smoke: an S01 registered on Friday and graded on Monday - each day a cn-market run reviewed, the listing finding it, a strategy run with leader, review and mode citing it - every artifact re-validates, the runs card shows the review line", { skip: gated && "set FACE_SMOKE=1", timeout: 300_000 }, async () => {
  const bots = await makeBotsRoot();
  const fixtureRoles = await mkdtemp(join(tmpdir(), "face-strategy-run-roles-"));
  const strategies = await realpath(await mkdtemp(join(tmpdir(), "face-strategy-run-strategies-")));
  const root = await realpath(await mkdtemp(join(tmpdir(), "face-strategy-run-root-")));
  const home = await mkdtemp(join(tmpdir(), "face-strategy-run-home-"));
  const fixtures = await fixtureDir();
  let dispose: (() => Promise<void>) | undefined;
  try {
    globalThis.Date = shiftedDate(FRIDAY);
    for (const entry of readdirSync(ROLES_ROOT, { withFileTypes: true })) {
      if (entry.isDirectory()) await cp(join(ROLES_ROOT, entry.name), join(fixtureRoles, entry.name), { recursive: true });
    }
    for (const role of ["cn-market-analyst", "cn-stock-analyst", "cn-reviewer"]) {
      const metaPath = join(fixtureRoles, role, "role.yml");
      writeFileSync(metaPath, readFileSync(metaPath, "utf8").replace(/^model: .*$/m, "model: stub/flash-standin"));
      assert.equal(readRoles(fixtureRoles).find((r) => r.id === role)!.model, "stub/flash-standin", `the fixture's ${role} is routed to the stub`);
    }
    for (const name of ["cn-market", S01]) await cp(join(STRATEGIES, name), join(strategies, name), { recursive: true });
    await mkdir(join(root, ".git"));
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
    const freezeRows = FREEZE_ROWS.map((id) => `- id: ${id}\n  config:\n    fetch: ${JSON.stringify(fixtures)}\n`).join("");
    writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: stub\n    model: echo\n- id: lunhui-runs\n  config:\n    strategiesRoot: ${JSON.stringify(strategies)}\n${freezeRows}`);
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: bots, rolesRoot: fixtureRoles });
    dispose = booted.dispose;
    const { ctx } = booted;

    const requested = new Map<string, GenerateOptions[]>();
    const headers = new Map<string, Session["header"]>();
    /** Each child's brief, by its session id: the market analyst's, the stock analyst's or the reviewer's. */
    const briefs = new Map<string, string>();
    /** The market run id, from the index freeze's reply or the market analyst's brief. */
    const runFrom = (text: string) => need(/"run":"([^"]+)"/.exec(text)?.[1] ?? /run (\S+?)[。.]?$/m.exec(text)?.[1], "a run id");
    /** The market run the listing gives for the day's session: the newest sealed run of that session. */
    const listedFor = (listing: string, session: string) =>
      need((JSON.parse(listing).runs as { run: string; session: string }[]).find((r) => r.session === session)?.run, `a sealed cn-market run of ${session} in the listing`);
    const script = (request: GenerateOptions): StubReply => {
      if (request.purpose !== undefined) return { kind: "text", text: "fixture" };
      const id = String(request.sessionId);
      requested.set(id, [...requested.get(id) ?? [], request]);
      const header = ctx.sessions.get(request.sessionId!)?.header;
      if (header !== undefined && !headers.has(id)) headers.set(id, { ...header });
      const results = toolTexts(request);
      if (header?.origin === "subagent") {
        const brief = request.messages.find((m) => sourceKind(m) !== "tool" && /MARKET_RUN|STOCK_RUN|REVIEW_RUN/.test(textOf(m)));
        if (brief === undefined) return { kind: "text", text: "UNEXPECTED_CHILD" };
        briefs.set(id, textOf(brief));
        const review = /REVIEW_RUN (\S+) run=(\S+)(?: market_run=(\S+))?/.exec(textOf(brief));
        if (review !== null) {
          /* The reviewer: read (with market_run outside cn-market), submit what it built from that read, report. */
          const [, strategy, run, market_run] = review;
          if (results.length === 0) return { kind: "tool", name: "lunhui_read_counterevidence_context", args: { strategy, run, ...(market_run === undefined ? {} : { market_run }) } };
          if (results.length === 1) return { kind: "tool", name: "lunhui_submit_counterevidence", args: { strategy, run, analysis: JSON.stringify(reviewArtifact(JSON.parse(results[0]) as Context)) } };
          return { kind: "text", text: `REVIEW_REPORT: counterevidence submitted on ${strategy}.` };
        }
        const stock = /STOCK_RUN (leader|mode) (\S+) run=(\S+) market_run=(\S+)/.exec(textOf(brief));
        if (stock !== null) {
          /* The stock analyst: one module - read with both run ids, submit what it built from that read, report. */
          const [, module, strategy, run, market_run] = stock as unknown as [string, StockModule, string, string, string];
          if (results.length === 0) return { kind: "tool", name: `lunhui_read_${module}_context`, args: { strategy, run, market_run } };
          if (results.length === 1) return { kind: "tool", name: `lunhui_submit_${module}`, args: { strategy, run, analysis: JSON.stringify(STOCK_BUILD[module](JSON.parse(results[0]) as Context)) } };
          return { kind: "text", text: `STOCK_REPORT: ${module} submitted.` };
        }
        /* The market analyst: read, then submit what it built from that read, module by module; then report. */
        const run = runFrom(textOf(brief));
        const step = results.length;
        if (step >= MARKET_MODULES.length * 2) return { kind: "text", text: "MARKET_REPORT: three artifacts submitted." };
        const module = MARKET_MODULES[Math.floor(step / 2)];
        if (step % 2 === 0) return { kind: "tool", name: `lunhui_read_${module}_context`, args: { strategy: "cn-market", run } };
        const context = JSON.parse(results[step - 1]) as Context;
        return { kind: "tool", name: `lunhui_submit_${module}`, args: { strategy: "cn-market", run, analysis: JSON.stringify(MARKET_BUILD[module](context)) } };
      }
      /* Gravit: the protocol's market channel, then its strategy channel, one tool per request. */
      const trigger = lastHuman(request);
      if (results.length === 0) return trigger && textOf(trigger) === "RUN_S01" ? { kind: "tool", name: "lunhui_freeze_index", args: { strategy: "cn-market" } } : { kind: "text", text: "PARENT_DONE" };
      const frozen = runFrom(results[0]);
      const session = JSON.parse(results[0]).session as string;
      // From the listing on, the market run is the one the listing gives for the day's session.
      const market = results.length > 6 ? listedFor(results[6], session) : frozen;
      const run = results.length > 8 ? JSON.parse(results[8]).run as string : "";
      const stock = (module: StockModule) => ({ kind: "tool" as const, name: "role_cn_stock_analyst", args: { description: `Write the ${module} artifact`, prompt: `STOCK_RUN ${module} ${S01} run=${run} market_run=${market}` } });
      switch (results.length) {
        case 1: return { kind: "tool", name: "lunhui_freeze_limit_up", args: { strategy: "cn-market", run: frozen } };
        case 2: return { kind: "tool", name: "lunhui_freeze_boards", args: { strategy: "cn-market", run: frozen } };
        case 3: return { kind: "tool", name: "role_cn_market_analyst", args: { description: "Analyse the market run", prompt: `MARKET_RUN: cn-market run ${frozen}` } };
        case 4: return { kind: "tool", name: "role_cn_reviewer", args: { description: "Review the market run", prompt: `REVIEW_RUN cn-market run=${frozen}` } };
        case 5: return { kind: "tool", name: "lunhui_read_run", args: { strategy: "cn-market", run: frozen } };
        case 6: return { kind: "tool", name: "lunhui_read_run", args: { strategy: "cn-market" } };
        case 7: return { kind: "tool", name: "lunhui_read_run", args: { strategy: "cn-market", run: market } };
        case 8: return { kind: "tool", name: "lunhui_freeze_quotes", args: { strategy: S01, symbols: SYMBOLS } };
        case 9: return stock("leader");
        case 10: return { kind: "tool", name: "role_cn_reviewer", args: { description: "Review the strategy run", prompt: `REVIEW_RUN ${S01} run=${run} market_run=${market}` } };
        case 11: return stock("mode");
        case 12: return { kind: "tool", name: "lunhui_read_run", args: { strategy: S01, run } };
        default: return { kind: "text", text: "RUN_DONE" };
      }
    };
    ctx.llm.registerAdapter(["stub"], new StubAdapter(script));
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    mountClient(ctx);
    const service = createLunhuiRuns(strategies);

    /** The digest a read built (lib/module-tool.mjs), rebuilt from the sealed runs, and the artifact validated against it again. */
    async function revalidate(strategy: string, run: string, module: string, market: string | null) {
      const contract = CONTRACTS[module].forStrategy?.(strategy) ?? CONTRACTS[module];
      const own = await service.readSealedRun(strategy, run);
      const cited = market === null ? null : await service.readSealedRun("cn-market", market);
      const citedRun = cited === null ? null : { run: cited.run, snapshot_id: cited.manifest.snapshot_id ?? null, session: cited.manifest.session ?? null, evidence: cited.evidence, artifacts: cited.artifacts };
      const extra = contract.extra === undefined ? undefined : await contract.extra(service, { strategy, run }, { manifest: own.manifest, artifacts: own.artifacts, market: citedRun });
      const { digest } = buildContext({
        module, run: own.manifest.run, manifest: own.manifest, evidence: own.evidence,
        sources: contract.sources, derivedFirst: contract.derivedFirst, derivedView: contract.derivedView, priority: contract.priority,
        hypotheses: contract.hypotheses, schema: contract.schema, hints: contract.hints, example: contract.example, required: contract.required,
        requiredAny: contract.requiredAny, evidenceRequired: contract.evidenceRequired, runArtifacts: contract.runArtifacts, artifacts: own.artifacts,
        derivedFilter: contract.derivedFilter, extra, artifactViews: contract.artifactViews,
        ...(contract.marketRun === undefined ? {} : { marketRun: contract.marketRun, market: citedRun, marketSources: contract.marketSources, marketArtifacts: contract.marketArtifacts }),
      });
      const text = await readFile(join(strategies, strategy, "analysis", run, `${module}.json`), "utf8");
      const artifact = JSON.parse(text);
      assert.deepEqual(validateEnvelope(text, { module, context: digest, schema: contract.schema, owns: contract.owns, ownedBy: contract.ownedBy,
        exemptPaths: contract.exemptPaths, unknownHeadline: contract.unknownHeadline, scopedFields: contract.scopedFields, rules: contract.rules }),
      artifact, `${strategy}/${run}/${module}.json passes its contract again against the sealed runs`);
      return artifact;
    }

    /** One day: the clock at `at`, a new Gravit session prompted, every tool result of both channels checked; the runs and artifacts it wrote. */
    async function day(label: string, at: number, session: string) {
      globalThis.Date = shiftedDate(at);
      // Signed in under the day's clock: the connection refuses a cookie whose issuedAt is after "now", and
      // Friday's clock restarts at 15:00, before a cookie issued at boot.
      const cookie = await signIn(ctx, base);
      const { sessionId } = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: { cwd: root } });
      const gravit = ctx.agents.get(SessionId(sessionId))!;
      await remote(base, cookie, "session/prompt", { request: { requestId: `strategy-run-${crypto.randomUUID()}`, sessionId, mode: "queue", content: [{ type: "text", text: "RUN_S01" }] } });
      const gravitRequests = () => requested.get(sessionId) ?? [];
      await waitFor(`${label}: Gravit's last request`, () => gravitRequests().some((r) => toolTexts(r).length >= 13));
      await gravit.whenIdle();

      /* Gravit's side: the protocol, with its strategy channel, in its prompt; every tool result a success. */
      const prompt = textOf(gravitRequests()[0].messages[0]);
      assert.ok(STRATEGY_CHANNEL !== null && STRATEGY_CHANNEL.includes("role_cn_stock_analyst") && STRATEGY_CHANNEL.includes("role_cn_reviewer"), "the run protocol has a strategy channel naming the stock analyst and the reviewer");
      assert.ok(prompt.includes(RUN_HEADING) && prompt.includes(STRATEGY_CHANNEL), `${label}: Gravit's prompt carried the lunhui:run protocol with its strategy channel`);
      const results = toolTexts(gravitRequests().at(-1)!);
      assert.equal(results.length, 13, `${label}: thirteen tool results came back to Gravit: ${results.map((t) => t.slice(0, 120)).join(" | ")}`);
      for (const text of results) assert.doesNotMatch(text, /^Error:/, `${label}: no tool call failed: ${text.slice(0, 300)}`);
      const market = runFrom(results[0]);
      assert.deepEqual(results.slice(0, 3).map((t) => [JSON.parse(t).run, JSON.parse(t).session]), [[market, session], [market, session], [market, session]], `${label}: the three market freezes landed in one run of ${session}`);
      assert.match(results[3], /MARKET_REPORT/, `${label}: the market analyst's report returned through its role tool`);
      assert.match(results[4], /REVIEW_REPORT: counterevidence submitted on cn-market/, `${label}: the market reviewer's report returned`);
      assert.deepEqual(JSON.parse(results[5]).artifacts.map((a: { module: string }) => a.module).sort(), [...MARKET_ARTIFACTS].sort(), `${label}: the market run read back with its four artifacts`);
      const listing = JSON.parse(results[6]);
      assert.equal(listing.runs[0].run, market, `${label}: the listing (lunhui_read_run without a run) gives the day's market run first`);
      assert.equal(listing.runs[0].session, session);
      assert.deepEqual([...listing.runs[0].artifacts].sort(), [...MARKET_ARTIFACTS].sort(), `${label}: the listing names its four accepted artifacts`);
      assert.equal(JSON.parse(results[7]).manifest.run, market, `${label}: the listed market run read back with its run id`);
      const quotes = JSON.parse(results[8]);
      const run = quotes.run as string;
      assert.deepEqual([quotes.source, quotes.session], ["quotes", session], `${label}: the strategy run's quotes are of the market run's session`);
      assert.notEqual(run, market);
      assert.match(results[9], /STOCK_REPORT: leader submitted/);
      assert.match(results[10], new RegExp(`REVIEW_REPORT: counterevidence submitted on ${S01}`));
      assert.match(results[11], /STOCK_REPORT: mode submitted/);
      const readBack = JSON.parse(results[12]);
      assert.deepEqual([readBack.manifest.run, readBack.artifacts.map((a: { module: string }) => a.module).sort()], [run, [...STRATEGY_ARTIFACTS].sort()], `${label}: the strategy run read back with its three artifacts`);

      /* The children of this day: each read once and submitted once, every context OK, every submit accepted. */
      const children = [...headers.entries()].filter(([id, h]) => h.origin === "subagent" && briefs.get(id)?.includes(run)).map(([id]) => id);
      assert.equal(children.length, 3, `${label}: the stock analyst twice and the reviewer once on the strategy run, each a child of its own`);
      for (const child of children) {
        const childResults = toolTexts(requested.get(child)!.at(-1)!);
        const module = /STOCK_RUN (leader|mode)/.exec(briefs.get(child)!)?.[1] ?? "counterevidence";
        assert.equal(childResults.length, 2, `${label}: the ${module} child read once and submitted once`);
        const context = JSON.parse(childResults[0]) as Context;
        assert.deepEqual([context.status_expected, context.market_run], ["OK", market], `${label}: the ${module} context expects OK, citing the day's market run`);
        assert.equal(childResults[1], JSON.stringify({ accepted: true, module, run }), `${label}: the ${module} artifact was accepted: ${childResults[1].slice(0, 400)}`);
      }

      /* Both runs on disk: sealed, every artifact re-validated against the digest its read built. */
      const marketManifest = JSON.parse(await readFile(join(strategies, "cn-market", "analysis", market, "run.json"), "utf8"));
      assert.equal(typeof marketManifest.sealed_at, "string");
      assert.deepEqual([...marketManifest.artifacts].sort(), [...MARKET_ARTIFACTS].sort(), `${label}: the market run's artifacts[] names the three modules and the review`);
      const marketArtifacts: Record<string, any> = {};
      for (const module of MARKET_ARTIFACTS) {
        marketArtifacts[module] = await revalidate("cn-market", market, module, null);
        assert.equal(marketArtifacts[module].status, "OK", `${label}: market ${module} OK`);
      }
      assert.deepEqual(marketArtifacts.theme.mainline_candidates.map((c: { board: string }) => c.board), ["BK0715"]);
      assert.deepEqual(marketArtifacts.counterevidence.items.map((i: { against: string }) => i.against), ["sentiment"], `${label}: the market review's item is against the sentiment`);
      const manifest = JSON.parse(await readFile(join(strategies, S01, "analysis", run, "run.json"), "utf8"));
      assert.equal(typeof manifest.sealed_at, "string", `${label}: the strategy run is sealed`);
      assert.deepEqual(manifest.evidence.map((e: { source: string }) => e.source), ["quotes"], "a strategy run freezes quotes only (A27)");
      assert.deepEqual((await readdir(join(strategies, S01, "analysis", run))).filter((f) => f.startsWith("evidence-")), ["evidence-quotes.json"]);
      assert.deepEqual([...manifest.artifacts].sort(), [...STRATEGY_ARTIFACTS].sort(), `${label}: artifacts[] names leader, counterevidence and mode`);
      const artifacts: Record<string, any> = {};
      for (const module of STRATEGY_ARTIFACTS) {
        const artifact = artifacts[module] = await revalidate(S01, run, module, market);
        assert.deepEqual([artifact.module, artifact.status, artifact.run, artifact.snapshot_id, artifact.market_run, artifact.market_snapshot_id],
          [module, "OK", run, manifest.snapshot_id, market, marketManifest.snapshot_id], `${label}: ${module}.json's envelope binds both runs`);
      }
      assert.deepEqual(artifacts.leader.leader_candidates.map((c: any) => [c.rank, c.symbol, c.board]), [[1, "sh600519", "BK0715"], [2, "sz000333", "BK0715"]],
        `${label}: both equities stand as candidates on the market run's pools and BK0715's members`);
      assert.deepEqual(artifacts.counterevidence.items.map((i: { id: string; against: string }) => [i.id, i.against]), [["x1", "leader"]], `${label}: the strategy review's item is against the leader`);
      const mode = artifacts.mode;
      assert.equal(mode.mode, "S01", `${label}: lunhui-s01-repair registers S01`);
      assert.deepEqual(mode.preconditions.map((p: any) => [p.name, p.status]), [
        ["theme_gate", "met"], ["candidate_before_divergence", "met"], ["theme_not_falsified", "met"], ["negative_tail_not_widening", "met"], ["minute_confirmation", "unmet: no source"],
      ], `${label}: the preconditions met by class, the minute confirmation with no source`);
      assert.deepEqual(mode.addressed.map((a: { item: string }) => a.item), ["x1"], `${label}: every counterevidence item addressed`);
      assert.ok(mode.parameters_used.length >= 1, `${label}: the parameters used`);
      assert.ok(Buffer.byteLength(JSON.stringify(mode.expectation), "utf8") <= CARD_BYTES, `${label}: the card within ${CARD_BYTES} bytes`);
      assert.deepEqual([mode.expectation.frozen_version, mode.expectation.state, mode.expectation.candidates], [manifest.snapshot_id, marketArtifacts.sentiment.state, ["sh600519"]],
        `${label}: the card frozen at the run, on the cited sentiment's state and the leader's candidate`);
      const metrics = JSON.parse(await readFile(join(strategies, S01, "analysis", run, "metrics.json"), "utf8"));
      for (const module of STRATEGY_ARTIFACTS) assert.ok(metrics.calls[module] >= 1 && metrics.calls[module] <= 10, `${label}: ${module} within its ten calls (${metrics.calls[module]})`);
      assert.deepEqual([...metrics.submitted].sort(), [...STRATEGY_ARTIFACTS].sort(), `${label}: submitted lists the three`);
      return { market, run, mode };
    }

    const friday = await day("Friday", FRIDAY, "2026-10-23");
    assert.equal(friday.mode.expectation_review, null, "Friday: no earlier card to grade");
    // The distribution answers its latest session whatever is asked, so on Monday it is Monday's (spec §16).
    const distribution = JSON.parse(await readFile(join(fixtures, "distribution.json"), "utf8"));
    await writeFile(join(fixtures, "distribution.json"), JSON.stringify({ ...distribution, data: { ...distribution.data, qdate: 20261026 } }));
    const monday = await day("Monday", MONDAY, "2026-10-26");
    assert.notEqual(monday.market, friday.market, "Monday: a new market run");
    assert.notEqual(monday.run, friday.run, "Monday: a new strategy run");
    assert.deepEqual([monday.mode.expectation_review.previous_run, monday.mode.expectation_review.grade], [friday.run, "符合"], "Monday's mode grades Friday's card");

    /* The runs card of lunhui-s01-repair: both strategy runs listed, Monday's the latest, citing Monday's market run, with the review line. */
    const body = await readChannelBody(join(strategies, S01));
    for (const { run, market } of [friday, monday]) {
      const row = need(body.runs.find((r) => r.run === run), `the strategy run ${run} on the runs card`);
      assert.deepEqual([row.sealed, row.kind, row.marketRun], [true, "strategy", market]);
      assert.deepEqual(Object.keys(row.artifacts).sort(), [...STRATEGY_ARTIFACTS].sort(), "three chips");
    }
    assert.deepEqual([body.latestRun?.run, body.latestRun?.marketRun], [monday.run, monday.market], "the latest run, Monday's, citing Monday's market run");
    const view = need(runsView(body).latest ?? undefined, "the runs card's latest run");
    assert.equal(view.marketRun, monday.market);
    assert.ok(view.chips.some((c: { text: string }) => c.text === "mode: S01"), "the mode chip shows the mode word alone");
    assert.equal(view.review, `review: 符合 of ${friday.run}`, "the latest run shows its review of Friday's card");
  } finally {
    globalThis.Date = REAL_DATE;
    await dispose?.();
    await Promise.all([bots, fixtureRoles, strategies, root, home, fixtures].map((dir) => rm(dir, { recursive: true, force: true })));
  }
});
