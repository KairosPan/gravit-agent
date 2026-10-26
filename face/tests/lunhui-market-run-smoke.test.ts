/** One whole cn-market run on a real boot (modules spec §10 item 2, A22, §5.10, §5.11): Gravit, played by
 * the stub, freezes the index (opening the run), the limit-up pools and the boards into that run, delegates to
 * role_cn_market_analyst, and reads the run back; the role child, played by the stub too, reads each market
 * module's context and submits an artifact it builds from that context's own text - ids from its derived and
 * evidence lists, envelope fields copied - so the run proves the contexts are usable as a role receives them.
 * Pinned: the run sealed with three evidence files; environment.json, sentiment.json and theme.json each an
 * OK artifact named in artifacts[] that passes its contract again when re-read against a digest rebuilt from
 * the sealed run's files; metrics.json's calls within budget and submitted listing the three; the channel's
 * runs card listing the run with three chips; Gravit's prompt carrying the run protocol.
 *
 * The boot: a temp DSH_HOME, port 0, AKShare and the seat off, the default model the stub, `lunhui-runs`
 * over a temp strategies root holding a copy of the shipped cn-market, the four freeze rows' `fetch` one
 * directory holding both fixture sets, and a fixture roles root whose cn-market-analyst is routed to the
 * stub. The clock: a freeze row's `config.now` is a function, and `bootFace` structured-clones every patch
 * (a function is a DataCloneError), so no patch can carry it into a booted row; the freezes read the
 * system clock instead, which this file shifts - `Date` replaced for the boot's lifetime by one whose
 * "now" starts at Friday 2026-10-23 15:00 China time, the session the Eastmoney fixtures carry, and
 * advances in real time. Own file, gated. */
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
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
import { contract as environmentContract } from "../plugins/lunhui/lib/contracts/environment.mjs";
import { contract as sentimentContract } from "../plugins/lunhui/lib/contracts/sentiment.mjs";
import { contract as themeContract } from "../plugins/lunhui/lib/contracts/theme.mjs";
import { MODULES as MODULE_TABLE } from "../plugins/lunhui/lib/modules.mjs";
import { makeBotsRoot } from "./bots-fixture.ts";
import { mountClient, remote, signIn } from "./remote.ts";
import { StubAdapter, type StubReply } from "./stub-llm.ts";

const gated = process.env.FACE_SMOKE !== "1";
const TESTS = dirname(fileURLToPath(import.meta.url));
const TENCENT = join(TESTS, "fixtures", "lunhui");
const EASTMONEY = join(TESTS, "fixtures", "lunhui-eastmoney");
const CN_MARKET = join(TESTS, "..", "..", "strategies", "cn-market");
/** Friday 2026-10-23, 15:00 in China: after the close of the session the Eastmoney fixtures carry. */
const FRIDAY = Date.parse("2026-10-23T07:00:00.000Z");
const FREEZE_ROWS = ["lunhui-freeze-quotes", "lunhui-freeze-limit-up", "lunhui-freeze-boards", "lunhui-freeze-index"];
const MODULES = ["environment", "sentiment", "theme"] as const;
type Module = (typeof MODULES)[number];
const CONTRACTS: Record<Module, any> = { environment: environmentContract, sentiment: sentimentContract, theme: themeContract };
/** The run protocol's first line (`dsh/profile/lunhui-run.md`, the `lunhui:run` section), read from the file. */
const RUN_HEADING = readProtocol(LUNHUI_RUN_PATH).split("\n")[0];

const sourceKind = (m: { source?: unknown }) => ((m.source ?? {}) as { kind?: string }).kind;
const textOf = (m: GenerateOptions["messages"][number]) => m.content.map((b) => "text" in b ? b.text : "").join("\n");
const lastHuman = (r: GenerateOptions) => [...r.messages].reverse().find((m) => ["user", "tool"].includes(String(sourceKind(m))));
/** The text of each tool result a request sends the model, in order. */
const toolTexts = (request: GenerateOptions) => request.messages.filter((m) => sourceKind(m) === "tool").map(textOf);
async function waitFor(label: string, check: () => boolean, ms = 60_000) {
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

/** One directory holding both fixture sets, and the members of every fixture board (the freeze reads all four). */
async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "face-market-run-fixtures-"));
  await cp(TENCENT, dir, { recursive: true });
  await cp(EASTMONEY, dir, { recursive: true });
  for (const code of ["BK0493", "BK1099"]) await cp(join(EASTMONEY, "members-BK0715.json"), join(dir, `members-${code}.json`));
  return dir;
}

/* The artifacts the role child builds: each from the parsed context text alone. */
type Context = { module: string; status_expected: string; missing: string[]; evidence: any[]; derived: any[]; example: any; [field: string]: any };

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

/** The index state from the sh000001 quote, the liquidity from the two markets' turnover: each its own claim. */
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

/** The money effect from yesterday's limit-ups, the freeze reading from the seal ratio, the state across both and the counts. */
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

/** One candidate, the board with the largest turnover share and a breadth; the stage on its breadth, the rotation on the runner-up's share. */
function themeArtifact(context: Context) {
  const shares = context.derived.filter((d) => d.measure === "turnover_share" && typeof d.value === "number").sort((a, b) => b.value - a.value);
  const top = need(shares.find((d) => typeof derivedOf(context, "breadth", d.params.board).value === "number"), "a board with a turnover share and a breadth");
  const second = need(shares.find((d) => d !== top), "a second board's turnover share");
  const code = top.params.board;
  const board = need(context.evidence.find((e) => e.kind === "board" && e.code === code), `the board item of ${code}`);
  const members = need(context.evidence.find((e) => e.kind === "members" && e.board === code), `the members item of ${code}`);
  const runnerUp = need(context.evidence.find((e) => e.kind === "board" && e.code === second.params.board), `the board item of ${second.params.board}`);
  const breadth = derivedOf(context, "breadth", code);
  return {
    ...envelopeOf(context),
    mainline_candidates: [{ board: code, name: board.name, evidence_ids: [board.id, members.id, breadth.id, top.id] }],
    theme_stage: "FERMENT",
    rotation: "ROTATING",
    claims: [
      { id: "c1", basis: "CURRENT", evidence_ids: [breadth.id], text: `${board.name}板块上涨占比约 ${breadth.value.toFixed(2)}，题材阶段记为 FERMENT。` },
      { id: "c2", basis: "CURRENT", evidence_ids: [second.id], text: `成交占比第二的板块为${runnerUp.name}，约 ${second.value.toFixed(2)}，轮动方向记为 ROTATING。` },
    ],
    limitations: [],
  };
}
const BUILD: Record<Module, (context: Context) => unknown> = { environment: environmentArtifact, sentiment: sentimentArtifact, theme: themeArtifact };

test("market run smoke: Gravit freezes three sources into one run, the analyst submits three OK artifacts built from its contexts, the run reads back sealed and on the runs card", { skip: gated && "set FACE_SMOKE=1", timeout: 180_000 }, async () => {
  const RealDate = Date;
  const bots = await makeBotsRoot();
  const fixtureRoles = await mkdtemp(join(tmpdir(), "face-market-run-roles-"));
  const strategies = await realpath(await mkdtemp(join(tmpdir(), "face-market-run-strategies-")));
  const root = await realpath(await mkdtemp(join(tmpdir(), "face-market-run-root-")));
  const home = await mkdtemp(join(tmpdir(), "face-market-run-home-"));
  const fixtures = await fixtureDir();
  let dispose: (() => Promise<void>) | undefined;
  try {
    globalThis.Date = shiftedDate(FRIDAY);
    for (const entry of readdirSync(ROLES_ROOT, { withFileTypes: true })) {
      if (entry.isDirectory()) await cp(join(ROLES_ROOT, entry.name), join(fixtureRoles, entry.name), { recursive: true });
    }
    const metaPath = join(fixtureRoles, "cn-market-analyst", "role.yml");
    writeFileSync(metaPath, readFileSync(metaPath, "utf8").replace(/^model: .*$/m, "model: stub/flash-standin"));
    assert.equal(readRoles(fixtureRoles).find((r) => r.id === "cn-market-analyst")!.model, "stub/flash-standin", "the fixture's analyst is routed to the stub");
    await cp(CN_MARKET, join(strategies, "cn-market"), { recursive: true });
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
    /** The child's run id, read from its brief; Gravit's, from the index freeze's reply. */
    const runFrom = (text: string) => need(/"run":"([^"]+)"/.exec(text)?.[1] ?? /run (\S+?)[。.]?$/m.exec(text)?.[1], "a run id");
    const script = (request: GenerateOptions): StubReply => {
      if (request.purpose !== undefined) return { kind: "text", text: "fixture" };
      const id = String(request.sessionId);
      requested.set(id, [...requested.get(id) ?? [], request]);
      const header = ctx.sessions.get(request.sessionId!)?.header;
      if (header !== undefined && !headers.has(id)) headers.set(id, { ...header });
      const results = toolTexts(request);
      if (header?.origin === "subagent") {
        /* The role child: read, then submit what it built from that read, module by module; then report. */
        const brief = request.messages.find((m) => sourceKind(m) !== "tool" && textOf(m).includes("MARKET_RUN"));
        if (brief === undefined) return { kind: "text", text: "UNEXPECTED_CHILD" };
        const run = runFrom(textOf(brief));
        const step = results.length;
        if (step >= MODULES.length * 2) return { kind: "text", text: "MARKET_REPORT: three artifacts submitted." };
        const module = MODULES[Math.floor(step / 2)];
        if (step % 2 === 0) return { kind: "tool", name: `lunhui_read_${module}_context`, args: { strategy: "cn-market", run } };
        const context = JSON.parse(results[step - 1]) as Context;
        return { kind: "tool", name: `lunhui_submit_${module}`, args: { strategy: "cn-market", run, analysis: JSON.stringify(BUILD[module](context)) } };
      }
      /* Gravit: the protocol's three steps, one tool per request. */
      const trigger = lastHuman(request);
      if (results.length === 0) return trigger && textOf(trigger) === "RUN_MARKET" ? { kind: "tool", name: "lunhui_freeze_index", args: { strategy: "cn-market" } } : { kind: "text", text: "PARENT_DONE" };
      const run = runFrom(results[0]);
      switch (results.length) {
        case 1: return { kind: "tool", name: "lunhui_freeze_limit_up", args: { strategy: "cn-market", run } };
        case 2: return { kind: "tool", name: "lunhui_freeze_boards", args: { strategy: "cn-market", run } };
        case 3: return { kind: "tool", name: "role_cn_market_analyst", args: { description: "Analyse the market run", prompt: `MARKET_RUN: cn-market run ${run}` } };
        case 4: return { kind: "tool", name: "lunhui_read_run", args: { strategy: "cn-market", run } };
        default: return { kind: "text", text: "RUN_DONE" };
      }
    };
    ctx.llm.registerAdapter(["stub"], new StubAdapter(script));
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    mountClient(ctx);
    const cookie = await signIn(ctx, base);
    const { sessionId } = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: { cwd: root } });
    const gravit = ctx.agents.get(SessionId(sessionId))!;
    await remote(base, cookie, "session/prompt", { request: { requestId: `market-run-${crypto.randomUUID()}`, sessionId, mode: "queue", content: [{ type: "text", text: "RUN_MARKET" }] } });
    const gravitRequests = () => requested.get(sessionId) ?? [];
    await waitFor("Gravit's last request", () => gravitRequests().some((r) => toolTexts(r).length >= 5));
    await gravit.whenIdle();

    /* Gravit's side: the protocol in its prompt, every tool result a success, the run read back last. */
    const gravitResults = toolTexts(gravitRequests().at(-1)!);
    assert.ok(textOf(gravitRequests()[0].messages[0]).includes(RUN_HEADING), "Gravit's prompt carried the lunhui:run protocol");
    assert.equal(gravitResults.length, 5, `five tool results came back to Gravit: ${gravitResults.map((t) => t.slice(0, 120)).join(" | ")}`);
    for (const text of gravitResults) assert.doesNotMatch(text, /^Error:/, `no tool call failed: ${text.slice(0, 300)}`);
    const run = runFrom(gravitResults[0]);
    assert.deepEqual(gravitResults.slice(0, 3).map((t) => [JSON.parse(t).run, JSON.parse(t).source, JSON.parse(t).session]),
      [[run, "index", "2026-10-23"], [run, "limit-up", "2026-10-23"], [run, "boards", "2026-10-23"]], "the three freezes landed in one run, on the fixtures' session");
    assert.match(gravitResults[3], /MARKET_REPORT/, "the analyst's report returned through the role tool");

    /* The child's side: three reads, three accepted submits. */
    const childId = [...headers.entries()].find(([, h]) => h.origin === "subagent")![0];
    const childResults = toolTexts(requested.get(childId)!.at(-1)!);
    assert.equal(childResults.length, 6, "three reads and three submits came back to the child");
    for (const [i, module] of MODULES.entries()) {
      const context = JSON.parse(childResults[i * 2]) as Context;
      assert.equal(context.status_expected, "OK", `the ${module} context expects OK: every source it needs was frozen`);
      assert.equal(childResults[i * 2 + 1], JSON.stringify({ accepted: true, module, run }), `the ${module} artifact was accepted: ${childResults[i * 2 + 1].slice(0, 400)}`);
    }

    /* The run on disk: sealed, three evidence files, three artifacts named and valid on a re-read. */
    const runDir = join(strategies, "cn-market", "analysis", run);
    const manifest = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
    assert.equal(typeof manifest.sealed_at, "string", "the run is sealed");
    assert.deepEqual(manifest.evidence.map((e: { source: string }) => e.source).sort(), ["boards", "index", "limit-up"]);
    const files = await readdir(runDir);
    assert.deepEqual(files.filter((f) => f.startsWith("evidence-")).sort(), ["evidence-boards.json", "evidence-index.json", "evidence-limit-up.json"]);
    assert.deepEqual([...manifest.artifacts].sort(), [...MODULES].sort(), "artifacts[] names the three modules");
    const evidence = await Promise.all(manifest.evidence.map(async (entry: { source: string; session: string }) => ({
      source: entry.source, session: entry.session, items: JSON.parse(await readFile(join(runDir, `evidence-${entry.source}.json`), "utf8")).items,
    })));
    for (const module of MODULES) {
      const text = await readFile(join(runDir, `${module}.json`), "utf8");
      const artifact = JSON.parse(text);
      assert.deepEqual([artifact.module, artifact.status, artifact.run, artifact.snapshot_id], [module, "OK", run, manifest.snapshot_id]);
      const contract = CONTRACTS[module];
      const { digest } = buildContext({
        module, run: manifest.run, manifest, evidence,
        sources: contract.sources, derivedFirst: contract.derivedFirst, derivedView: contract.derivedView, priority: contract.priority,
        hypotheses: contract.hypotheses, schema: contract.schema, hints: contract.hints, example: contract.example, required: contract.required,
      });
      assert.deepEqual(validateEnvelope(text, { module, context: digest, schema: contract.schema, owns: contract.owns, ownedBy: contract.ownedBy, exemptPaths: contract.exemptPaths, rules: contract.rules }),
        artifact, `${module}.json passes its contract again against the sealed run`);
      const headline = MODULE_TABLE.find((entry) => entry.name === module)!.headline;
      assert.ok(headline.some((field) => !["UNKNOWN", undefined].includes(artifact[field]) && !(Array.isArray(artifact[field]) && artifact[field].length === 0)), `${module}.json states a reading, not only UNKNOWN`);
    }
    const metrics = JSON.parse(await readFile(join(runDir, "metrics.json"), "utf8"));
    assert.equal(metrics.freezes, 3, "three freezes counted");
    for (const module of MODULES) assert.ok(metrics.calls[module] >= 1 && metrics.calls[module] <= 10, `${module} within its ten calls (${metrics.calls[module]})`);
    assert.deepEqual([...metrics.submitted].sort(), [...MODULES].sort(), "submitted lists the three");

    /* The runs card: the run listed, sealed, with a chip per artifact. */
    const body = await readChannelBody(join(strategies, "cn-market"));
    const row = body.runs.find((r) => r.run === run)!;
    assert.ok(row, "the runs card lists the run");
    assert.equal(row.sealed, true);
    assert.deepEqual(Object.keys(row.artifacts).sort(), [...MODULES].sort(), "three chips");
    for (const module of MODULES) assert.equal(row.artifacts[module].status, "OK");
    assert.equal(body.latestRun?.run, run, "and it is the latest run");
  } finally {
    globalThis.Date = RealDate;
    await dispose?.();
    await Promise.all([bots, fixtureRoles, strategies, root, home, fixtures].map((dir) => rm(dir, { recursive: true, force: true })));
  }
});

