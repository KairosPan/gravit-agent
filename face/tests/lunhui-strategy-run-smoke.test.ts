/** One strategy run on a real boot, citing the day's market run (modules spec §5.10, A22, A27, §5.11): Gravit,
 * played by the stub, does the cn-market run as plan 2's market smoke does - the index, limit-up and boards
 * freezes, role_cn_market_analyst submitting three artifacts, lunhui_read_run - then the strategy channel the run
 * protocol now states for lunhui-s01-repair: the market run read, the quotes of two equities its theme's mainline
 * board holds frozen on the strategy (opening the strategy run), role_cn_stock_analyst for the leader with both
 * run ids, again for the mode, and the strategy run read back. Each role child, played by the stub too, builds its
 * artifact from the context it received. S01 needs an accepted counterevidence artifact, the reviewer's (plan 4),
 * so the mode concludes WAIT with a null card; the card's grading is pinned by tests/lunhui-mode.test.ts.
 * Pinned: leader.json and mode.json accepted and each passing its contract again against a digest rebuilt from the
 * sealed runs; the mode WAIT, its card and review null, its market_run the market run; the channel's runs card
 * listing the strategy run with that market run cited and a mode chip of the mode word; Gravit's prompt carrying
 * the run protocol with its strategy channel.
 *
 * The boot is the market smoke's: a temp DSH_HOME, port 0, AKShare and the seat off, the stub the default model,
 * `lunhui-runs` over a temp strategies root holding copies of the shipped cn-market and lunhui-s01-repair, the
 * freeze rows' `fetch` one directory holding both fixture sets, a fixture roles root whose two analysts are routed
 * to the stub, and `Date` shifted to Friday 2026-10-23 15:00 China time for the boot's lifetime (a patch cannot
 * carry `config.now` into a booted row). The fixture copy is the leader tests': 600519 sealed in the 涨停池, 600519
 * and 000333 members of BK0715, so a candidate can stand. Own file, gated. */
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
import { contract as modeContract } from "../plugins/lunhui/lib/contracts/mode.mjs";
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
const FREEZE_ROWS = ["lunhui-freeze-quotes", "lunhui-freeze-limit-up", "lunhui-freeze-boards", "lunhui-freeze-index"];
const MARKET_MODULES = ["environment", "sentiment", "theme"] as const;
type MarketModule = (typeof MARKET_MODULES)[number];
const STOCK_MODULES = ["leader", "mode"] as const;
type StockModule = (typeof STOCK_MODULES)[number];
const STOCK_CONTRACTS: Record<StockModule, any> = { leader: leaderContract, mode: modeContract };
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
  const Real = Date;
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
  const counts = need(context.evidence.find((e) => e.kind === "counts"), "the all-shares counts");
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

/** The mode: WAIT - S01 waits for the reviewer's counterevidence - the minute confirmation unmet for want of a source. */
function modeArtifact(context: Context) {
  const quote = need(context.evidence.find((e) => e.kind === "quote"), "a quote");
  return {
    ...context.example,
    mode: "WAIT",
    preconditions: [{ id: "p1", name: "minute_confirmation", status: "unmet: no source", evidence_ids: [] }],
    claims: [{ id: "c1", basis: "CURRENT", evidence_ids: [quote.id], text: "本运行登记为 WAIT：分钟确认缺少来源。" }],
  };
}
const STOCK_BUILD: Record<StockModule, (context: Context) => unknown> = { leader: leaderArtifact, mode: modeArtifact };

test("strategy run smoke: after the market run, Gravit freezes two equities' quotes on lunhui-s01-repair, the stock analyst submits a leader and a WAIT mode citing the market run, both re-validate, the runs card cites the market run", { skip: gated && "set FACE_SMOKE=1", timeout: 240_000 }, async () => {
  const RealDate = Date;
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
    for (const role of ["cn-market-analyst", "cn-stock-analyst"]) {
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
    /** Each child's brief, by its session id: the market analyst's or the stock analyst's. */
    const briefs = new Map<string, string>();
    /** The market run id, from the index freeze's reply or the market analyst's brief. */
    const runFrom = (text: string) => need(/"run":"([^"]+)"/.exec(text)?.[1] ?? /run (\S+?)[。.]?$/m.exec(text)?.[1], "a run id");
    const script = (request: GenerateOptions): StubReply => {
      if (request.purpose !== undefined) return { kind: "text", text: "fixture" };
      const id = String(request.sessionId);
      requested.set(id, [...requested.get(id) ?? [], request]);
      const header = ctx.sessions.get(request.sessionId!)?.header;
      if (header !== undefined && !headers.has(id)) headers.set(id, { ...header });
      const results = toolTexts(request);
      if (header?.origin === "subagent") {
        const brief = request.messages.find((m) => sourceKind(m) !== "tool" && /MARKET_RUN|STOCK_RUN/.test(textOf(m)));
        if (brief === undefined) return { kind: "text", text: "UNEXPECTED_CHILD" };
        briefs.set(id, textOf(brief));
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
      const market = runFrom(results[0]);
      const run = results.length > 6 ? JSON.parse(results[6]).run as string : "";
      const stock = (module: StockModule) => ({ kind: "tool" as const, name: "role_cn_stock_analyst", args: { description: `Write the ${module} artifact`, prompt: `STOCK_RUN ${module} ${S01} run=${run} market_run=${market}` } });
      switch (results.length) {
        case 1: return { kind: "tool", name: "lunhui_freeze_limit_up", args: { strategy: "cn-market", run: market } };
        case 2: return { kind: "tool", name: "lunhui_freeze_boards", args: { strategy: "cn-market", run: market } };
        case 3: return { kind: "tool", name: "role_cn_market_analyst", args: { description: "Analyse the market run", prompt: `MARKET_RUN: cn-market run ${market}` } };
        case 4: return { kind: "tool", name: "lunhui_read_run", args: { strategy: "cn-market", run: market } };
        case 5: return { kind: "tool", name: "lunhui_read_run", args: { strategy: "cn-market", run: market } };
        case 6: return { kind: "tool", name: "lunhui_freeze_quotes", args: { strategy: S01, symbols: SYMBOLS } };
        case 7: return stock("leader");
        case 8: return stock("mode");
        case 9: return { kind: "tool", name: "lunhui_read_run", args: { strategy: S01, run } };
        default: return { kind: "text", text: "RUN_DONE" };
      }
    };
    ctx.llm.registerAdapter(["stub"], new StubAdapter(script));
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    mountClient(ctx);
    const cookie = await signIn(ctx, base);
    const { sessionId } = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: { cwd: root } });
    const gravit = ctx.agents.get(SessionId(sessionId))!;
    await remote(base, cookie, "session/prompt", { request: { requestId: `strategy-run-${crypto.randomUUID()}`, sessionId, mode: "queue", content: [{ type: "text", text: "RUN_S01" }] } });
    const gravitRequests = () => requested.get(sessionId) ?? [];
    await waitFor("Gravit's last request", () => gravitRequests().some((r) => toolTexts(r).length >= 10));
    await gravit.whenIdle();

    /* Gravit's side: the protocol, with its strategy channel, in its prompt; every tool result a success. */
    const prompt = textOf(gravitRequests()[0].messages[0]);
    assert.ok(STRATEGY_CHANNEL !== null && STRATEGY_CHANNEL.includes("role_cn_stock_analyst"), "the run protocol has a strategy channel naming the stock analyst");
    assert.ok(prompt.includes(RUN_HEADING) && prompt.includes(STRATEGY_CHANNEL), "Gravit's prompt carried the lunhui:run protocol with its strategy channel");
    const gravitResults = toolTexts(gravitRequests().at(-1)!);
    assert.equal(gravitResults.length, 10, `ten tool results came back to Gravit: ${gravitResults.map((t) => t.slice(0, 120)).join(" | ")}`);
    for (const text of gravitResults) assert.doesNotMatch(text, /^Error:/, `no tool call failed: ${text.slice(0, 300)}`);
    const market = runFrom(gravitResults[0]);
    assert.match(gravitResults[3], /MARKET_REPORT/, "the market analyst's report returned through its role tool");
    const quotes = JSON.parse(gravitResults[6]);
    const run = quotes.run as string;
    assert.deepEqual([quotes.source, quotes.session], ["quotes", "2026-10-23"], "the strategy run's quotes are of the market run's session");
    assert.notEqual(run, market);
    assert.match(gravitResults[7], /STOCK_REPORT: leader submitted/);
    assert.match(gravitResults[8], /STOCK_REPORT: mode submitted/);
    const readBack = JSON.parse(gravitResults[9]);
    assert.deepEqual([readBack.manifest.run, readBack.artifacts.map((a: { module: string }) => a.module).sort()], [run, ["leader", "mode"]], "the strategy run read back with its two artifacts");

    /* The market run: its three artifacts accepted, BK0715 the theme's mainline candidate. */
    const marketDir = join(strategies, "cn-market", "analysis", market);
    const marketManifest = JSON.parse(await readFile(join(marketDir, "run.json"), "utf8"));
    assert.equal(typeof marketManifest.sealed_at, "string");
    assert.deepEqual([...marketManifest.artifacts].sort(), [...MARKET_MODULES].sort());
    assert.deepEqual(JSON.parse(await readFile(join(marketDir, "theme.json"), "utf8")).mainline_candidates.map((c: { board: string }) => c.board), ["BK0715"]);

    /* The stock analyst's two children: one read, one accepted submit each, every context OK. */
    const children = [...headers.entries()].filter(([, h]) => h.origin === "subagent").map(([id]) => id).filter((id) => briefs.get(id)?.includes("STOCK_RUN"));
    assert.equal(children.length, 2, "the stock analyst was called twice, each a child of its own");
    for (const module of STOCK_MODULES) {
      const child = need(children.find((id) => briefs.get(id)!.includes(`STOCK_RUN ${module} `)), `the ${module} child`);
      const childResults = toolTexts(requested.get(child)!.at(-1)!);
      assert.equal(childResults.length, 2, `the ${module} child read once and submitted once`);
      const context = JSON.parse(childResults[0]) as Context;
      assert.deepEqual([context.status_expected, context.market_run], ["OK", market], `the ${module} context expects OK, citing the market run`);
      assert.equal(childResults[1], JSON.stringify({ accepted: true, module, run }), `the ${module} artifact was accepted: ${childResults[1].slice(0, 400)}`);
    }

    /* The strategy run on disk: sealed, its quotes only, two artifacts named and valid on a re-read. */
    const runDir = join(strategies, S01, "analysis", run);
    const manifest = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
    assert.equal(typeof manifest.sealed_at, "string", "the strategy run is sealed");
    assert.deepEqual(manifest.evidence.map((e: { source: string }) => e.source), ["quotes"], "a strategy run freezes quotes only (A27)");
    assert.deepEqual((await readdir(runDir)).filter((f) => f.startsWith("evidence-")), ["evidence-quotes.json"]);
    assert.deepEqual([...manifest.artifacts].sort(), [...STOCK_MODULES].sort(), "artifacts[] names leader and mode");
    const service = createLunhuiRuns(strategies);
    const own = await service.readSealedRun(S01, run);
    const cited = await service.readSealedRun("cn-market", market);
    const citedRun = { run: cited.run, snapshot_id: cited.manifest.snapshot_id ?? null, session: cited.manifest.session ?? null, evidence: cited.evidence, artifacts: cited.artifacts };
    const artifacts: Record<StockModule, any> = {} as Record<StockModule, any>;
    for (const module of STOCK_MODULES) {
      const text = await readFile(join(runDir, `${module}.json`), "utf8");
      const artifact = artifacts[module] = JSON.parse(text);
      assert.deepEqual([artifact.module, artifact.status, artifact.run, artifact.snapshot_id, artifact.market_run, artifact.market_snapshot_id],
        [module, "OK", run, manifest.snapshot_id, market, marketManifest.snapshot_id], `${module}.json's envelope binds both runs`);
      /* The digest as the read built it (lib/module-tool.mjs): the strategy run, the cited run, the contract's extra. */
      const contract = STOCK_CONTRACTS[module];
      const located = { strategy: S01, run };
      const extra = contract.extra === undefined ? undefined : await contract.extra(service, located, { manifest: own.manifest, artifacts: own.artifacts, market: citedRun });
      const { digest } = buildContext({
        module, run: own.manifest.run, manifest: own.manifest, evidence: own.evidence,
        sources: contract.sources, derivedFirst: contract.derivedFirst, derivedView: contract.derivedView, priority: contract.priority,
        hypotheses: contract.hypotheses, schema: contract.schema, hints: contract.hints, example: contract.example, required: contract.required,
        runArtifacts: contract.runArtifacts, artifacts: own.artifacts, derivedFilter: contract.derivedFilter, extra,
        marketRun: contract.marketRun, market: citedRun, marketSources: contract.marketSources, marketArtifacts: contract.marketArtifacts,
      });
      assert.deepEqual(validateEnvelope(text, { module, context: digest, schema: contract.schema, owns: contract.owns, ownedBy: contract.ownedBy,
        exemptPaths: contract.exemptPaths, unknownHeadline: contract.unknownHeadline, rules: contract.rules }),
      artifact, `${module}.json passes its contract again against the sealed runs`);
    }
    assert.deepEqual(artifacts.leader.leader_candidates.map((c: any) => [c.rank, c.symbol, c.board]), [[1, "sh600519", "BK0715"], [2, "sz000333", "BK0715"]],
      "both equities stand as candidates on the market run's pools and BK0715's members");
    assert.deepEqual([artifacts.mode.mode, artifacts.mode.expectation, artifacts.mode.expectation_review], ["WAIT", null, null],
      "S01 without the reviewer's counterevidence registers WAIT, with no card and nothing to grade");
    const metrics = JSON.parse(await readFile(join(runDir, "metrics.json"), "utf8"));
    for (const module of STOCK_MODULES) assert.ok(metrics.calls[module] >= 1 && metrics.calls[module] <= 10, `${module} within its ten calls (${metrics.calls[module]})`);
    assert.deepEqual([...metrics.submitted].sort(), [...STOCK_MODULES].sort(), "submitted lists the two");

    /* The runs card of lunhui-s01-repair: the strategy run listed, sealed, the market run cited; the mode chip its word. */
    const body = await readChannelBody(join(strategies, S01));
    const row = need(body.runs.find((r) => r.run === run), "the strategy run on the runs card");
    assert.deepEqual([row.sealed, row.kind, row.marketRun], [true, "strategy", market]);
    assert.deepEqual(Object.keys(row.artifacts).sort(), [...STOCK_MODULES].sort(), "two chips");
    assert.deepEqual([body.latestRun?.run, body.latestRun?.marketRun], [run, market], "the latest run, citing the market run");
    const view = need(runsView(body).latest ?? undefined, "the runs card's latest run");
    assert.equal(view.marketRun, market);
    assert.ok(view.chips.some((c: { text: string }) => c.text === "mode: WAIT"), "the mode chip shows the mode word alone");
    assert.equal(view.review, null);
  } finally {
    globalThis.Date = RealDate;
    await dispose?.();
    await Promise.all([bots, fixtureRoles, strategies, root, home, fixtures].map((dir) => rm(dir, { recursive: true, force: true })));
  }
});
