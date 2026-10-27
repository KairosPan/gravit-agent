/**
 * The four Lunhui freeze rows (modules spec §5.3, §5.5, §5.7, A7, A15, A20, A23, A25, A27, A28):
 * `lunhui-freeze-quotes`, `-limit-up`, `-boards` and `-index`, each mounted on the stand-in scope of
 * tests/lunhui-rows.test.ts beside a real `lunhui-runs` service over a temp strategies root holding
 * `cn-market` and `alpha`. A row's `config.fetch` is a temp copy of the Tencent and Eastmoney
 * fixtures, or, where a case must watch or stall the requests, unset, with `globalThis.fetch`
 * mocked over the same fixtures; nothing reaches the network. `config.now` fixes the clock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply as applyRuns } from "../plugins/lunhui/runs-row.mjs";
import { hash } from "../plugins/lunhui/lib/contract-core.mjs";
import * as quotesRow from "../plugins/lunhui/freeze-quotes-row.mjs";
import * as limitUpRow from "../plugins/lunhui/freeze-limit-up-row.mjs";
import * as boardsRow from "../plugins/lunhui/freeze-boards-row.mjs";
import * as indexRow from "../plugins/lunhui/freeze-index-row.mjs";
import { createFixtureFetch } from "../plugins/lunhui/lib/fixture-fetch.mjs";
import { LunhuiError } from "../plugins/lunhui/lib/runs.mjs";

type Cleanup = { after(fn: () => unknown): unknown };
type ToolDef = { name: string; description: string; parameters: any; execute(args: unknown, exec: unknown): Promise<string> };

const TENCENT = fileURLToPath(new URL("./fixtures/lunhui/", import.meta.url));
const EASTMONEY = fileURLToPath(new URL("./fixtures/lunhui-eastmoney/", import.meta.url));
/** Friday 2026-10-23, 15:00 in China: after the close of a covered trading day. */
const FRIDAY = new Date("2026-10-23T07:00:00.000Z");
const ROWS = { quotes: quotesRow, "limit-up": limitUpRow, boards: boardsRow, index: indexRow } as const;
type Source = keyof typeof ROWS;

/** A strategies root holding `cn-market` and `alpha`, each with its THESIS.md. */
async function strategiesRoot(t: Cleanup): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lunhui-freeze-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const strategy of ["cn-market", "alpha"]) {
    await mkdir(join(root, strategy));
    await writeFile(join(root, strategy, "THESIS.md"), `# ${strategy}\n`);
  }
  return root;
}

/** One directory holding both fixture sets, the members of every fixture board, and `edit`'s changes. */
async function fixtures(t: Cleanup, edit: (dir: string) => Promise<unknown> = async () => {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lunhui-freeze-fixtures-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(TENCENT, dir, { recursive: true });
  await cp(EASTMONEY, dir, { recursive: true });
  // The boards' fixture lists four boards; the default constituents read all four.
  for (const code of ["BK0493", "BK1099"]) await cp(join(EASTMONEY, "members-BK0715.json"), join(dir, `members-${code}.json`));
  await edit(dir);
  return dir;
}

/** The stand-in scope, `lunhuiRuns` among its injections once the backbone is mounted. */
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

/** The backbone over `root` and the four rows over it, each with `configs[source]` (fixtures `dir` by default). */
function mount(root: string, dir: string | undefined, configs: Partial<Record<Source, Record<string, unknown>>> = {}, now = FRIDAY) {
  const backbone = fakeScope();
  applyRuns(backbone.ctx, { strategiesRoot: root });
  const service = backbone.provided[0][1];
  const tools = {} as Record<Source, ToolDef>;
  for (const [source, row] of Object.entries(ROWS) as Array<[Source, any]>) {
    const scope = fakeScope({ lunhuiRuns: service });
    row.apply(scope.ctx, { ...(dir === undefined ? {} : { fetch: dir }), now: () => now, ...configs[source] });
    assert.equal(scope.tools.length, 1);
    tools[source] = scope.tools[0];
  }
  return { service, tools };
}

/** An `exec` as dsh hands a tool: the caller's session header, a root session's by default. */
function exec(header: Record<string, unknown> = {}) {
  return { agent: { session: { header } }, signal: new AbortController().signal };
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: any) => {
    assert.ok(error instanceof LunhuiError, `a LunhuiError, not ${error?.stack ?? error}`);
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(`^${code}: `));
    assert.doesNotMatch(error.message, /\/|\\/);
    return true;
  });
}

async function readJson(...parts: string[]) {
  return JSON.parse(await readFile(join(...parts), "utf8"));
}

const runDir = (root: string, strategy: string, run: string) => join(root, strategy, "analysis", run);

/** A `globalThis.fetch` mock serving `dir`, recording each URL; `stall(url)` true leaves a request hanging until aborted. */
function mockFetch(t: any, dir: string, stall: (url: URL) => boolean = () => false) {
  const serve = createFixtureFetch(dir);
  const urls: URL[] = [];
  let stalled!: () => void;
  const reached = new Promise<void>((resolve) => { stalled = resolve; });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const target = new URL(url);
    urls.push(target);
    if (!stall(target)) return serve(url, init);
    stalled();
    return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  });
  return { urls, reached };
}

test("freeze rows: names, inject and one tool each; apply refuses a missing backbone and a bad fetch directory, naming the row", async (t) => {
  const root = await strategiesRoot(t);
  const expected: Record<Source, [string, string]> = {
    quotes: ["lunhui-freeze-quotes", "lunhui_freeze_quotes"],
    "limit-up": ["lunhui-freeze-limit-up", "lunhui_freeze_limit_up"],
    boards: ["lunhui-freeze-boards", "lunhui_freeze_boards"],
    index: ["lunhui-freeze-index", "lunhui_freeze_index"],
  };
  const { tools } = mount(root, undefined);
  for (const [source, row] of Object.entries(ROWS) as Array<[Source, any]>) {
    const [rowName, toolName] = expected[source];
    assert.equal(row.name, rowName);
    assert.deepEqual(row.inject, ["tools", "lunhuiRuns"]);
    assert.equal(tools[source].name, toolName);
    assert.deepEqual(tools[source].parameters.required, source === "quotes" ? ["strategy", "symbols"] : ["strategy"]);
    assert.match(tools[source].description, /8 次/);
    assert.match(tools[source].description, /Gravit/);
    if (source !== "quotes") assert.match(tools[source].description, /cn-market/);
    assert.throws(() => row.apply(fakeScope().ctx, {}), (error: any) => error.message.startsWith(`${rowName}: `) && /lunhui-runs/.test(error.message));
    for (const fetch of ["fixtures", join(root, "missing"), join(root, "alpha", "THESIS.md"), 7]) {
      assert.throws(() => row.apply(fakeScope({ lunhuiRuns: {} }).ctx, { fetch }), { message: `${rowName}: fetch must be an absolute path to an existing directory` });
    }
  }
  assert.match(tools.quotes.description, /1–8/);
  assert.match(tools.boards.description, /10/);
});

test("freeze: lunhui_freeze_limit_up opens a run in cn-market, writes evidence-limit-up.json with rows and derived items, and returns the summary", async (t) => {
  const root = await strategiesRoot(t);
  const { tools } = mount(root, await fixtures(t));
  const text = await tools["limit-up"].execute({ strategy: "cn-market" }, exec());
  assert.doesNotMatch(text, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const reply = JSON.parse(text);
  assert.equal(reply.strategy, "cn-market");
  assert.equal(reply.source, "limit-up");
  assert.equal(reply.as_of, FRIDAY.toISOString());
  assert.equal(reply.items, 6 + 3 + 5);
  assert.equal(reply.host, "push2ex.eastmoney.com");
  assert.equal(reply.delayed, false);
  assert.equal(reply.truncated, false);
  assert.deepEqual(reply.derived.map((d: any) => d.measure), ["streak_distribution", "seal_ratio", "break_ratio", "yesterday_return_median", "yesterday_negative_tail"]);
  for (const derived of reply.derived) assert.match(derived.id, /^ev_[0-9a-f]{24}$/);
  const dir = runDir(root, "cn-market", reply.run);
  const manifest = await readJson(dir, "run.json");
  assert.equal(manifest.kind, "market");
  assert.deepEqual(manifest.evidence.map((e: any) => e.source), ["limit-up"]);
  const evidence = await readJson(dir, "evidence-limit-up.json");
  const rows = evidence.items.filter((item: any) => item.kind !== "derived");
  assert.deepEqual(rows.map((row: any) => row.pool), [...Array(6).fill("zt"), ...Array(3).fill("zb"), ...Array(5).fill("yesterday")]);
  for (const row of rows) assert.deepEqual([row.host, row.delayed], ["push2ex.eastmoney.com", false]);
  const derived = evidence.items.filter((item: any) => item.kind === "derived");
  assert.equal(derived.length, 5);
  // Every derived input is the id of a row in the file: zt and zb rows of one code are told apart.
  const rowIds = new Set(rows.map((row: any) => row.id));
  for (const item of derived) for (const input of item.inputs) assert.ok(rowIds.has(input), `${item.measure} cites ${input}`);
  const seal = derived.find((item: any) => item.measure === "seal_ratio");
  assert.equal(seal.inputs.length, 9);
  assert.deepEqual(reply.derived.map((d: any) => d.id), derived.map((item: any) => item.id));
  assert.equal((await readJson(dir, "metrics.json")).freezes, 1);
});

test("freeze: a second limit-up freeze on the same run is SOURCE_FROZEN; a freeze on a sealed run is RUN_SEALED", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tools } = mount(root, await fixtures(t));
  const { run } = JSON.parse(await tools["limit-up"].execute({ strategy: "cn-market" }, exec()));
  await rejectsWith(tools["limit-up"].execute({ strategy: "cn-market", run }, exec()), "SOURCE_FROZEN");
  await service.sealRun("cn-market", run);
  await rejectsWith(tools.index.execute({ strategy: "cn-market", run }, exec()), "RUN_SEALED");
  const dir = runDir(root, "cn-market", run);
  assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith("evidence-")), ["evidence-limit-up.json"]);
  // Refused calls count: the freeze, the frozen source, the sealed run.
  assert.equal((await readJson(dir, "metrics.json")).freezes, 3);
  await rejectsWith(tools.index.execute({ strategy: "cn-market", run: "nope" }, exec()), "NO_SUCH_RUN");
  await rejectsWith(tools.index.execute({ strategy: "cn-market", run: "../x" }, exec()), "BAD_RUN_ID");
});

test("freeze: limit-up, boards and index refuse a strategy channel with WRONG_CHANNEL; quotes accepts both", async (t) => {
  const root = await strategiesRoot(t);
  const { tools } = mount(root, await fixtures(t));
  for (const source of ["limit-up", "boards", "index"] as const) {
    await rejectsWith(tools[source].execute({ strategy: "alpha" }, exec()), "WRONG_CHANNEL");
  }
  assert.deepEqual(await readdir(join(root, "alpha")), ["THESIS.md"]);
  const inStrategy = JSON.parse(await tools.quotes.execute({ strategy: "alpha", symbols: ["sh600519", "sh000001"] }, exec()));
  assert.equal((await readJson(runDir(root, "alpha", inStrategy.run), "run.json")).kind, "strategy");
  const inMarket = JSON.parse(await tools.quotes.execute({ strategy: "cn-market", symbols: ["sh000001"] }, exec()));
  assert.equal((await readJson(runDir(root, "cn-market", inMarket.run), "run.json")).kind, "market");
  await rejectsWith(tools.quotes.execute({ strategy: "../alpha", symbols: ["sh000001"] }, exec()), "NOT_A_STRATEGY");
});

test("freeze: a delegated child caller is NOT_GRAVIT; a fork and a root pass", async (t) => {
  const root = await strategiesRoot(t);
  const { tools } = mount(root, await fixtures(t));
  const args = { strategy: "cn-market" };
  for (const tool of Object.values(tools)) {
    await rejectsWith(tool.execute({ ...args, symbols: ["sh000001"] }, exec({ origin: "subagent", isSeeded: false })), "NOT_GRAVIT");
  }
  await rejectsWith(tools["limit-up"].execute(args, exec({ origin: "subagent" })), "NOT_GRAVIT");
  assert.deepEqual(await readdir(join(root, "cn-market")), ["THESIS.md"]);
  await tools["limit-up"].execute(args, exec({ origin: "subagent", isSeeded: true }));
  await tools["limit-up"].execute(args, exec({}));
});

test("freeze: the ninth freeze on one run is TOOL_BUDGET", async (t) => {
  const root = await strategiesRoot(t);
  const { tools } = mount(root, await fixtures(t));
  const { run } = JSON.parse(await tools.quotes.execute({ strategy: "cn-market", symbols: ["sh000001"] }, exec()));
  for (let i = 2; i <= 8; i++) await rejectsWith(tools.quotes.execute({ strategy: "cn-market", run, symbols: ["sh000001"] }, exec()), "SOURCE_FROZEN");
  await rejectsWith(tools.index.execute({ strategy: "cn-market", run }, exec()), "TOOL_BUDGET");
  const dir = runDir(root, "cn-market", run);
  assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith("evidence-")), ["evidence-quotes.json"]);
  assert.equal((await readJson(dir, "metrics.json")).freezes, 9);
});

test("freeze: a date no table covers is CALENDAR_UNCOVERED before any fetch", async (t) => {
  const root = await strategiesRoot(t);
  const { urls } = mockFetch(t, await fixtures(t));
  const { tools } = mount(root, undefined, {}, new Date("2027-01-05T07:00:00.000Z"));
  for (const tool of Object.values(tools)) {
    await rejectsWith(tool.execute({ strategy: "cn-market", symbols: ["sh000001"] }, exec()), "CALENDAR_UNCOVERED");
  }
  assert.equal(urls.length, 0);
  assert.deepEqual(await readdir(join(root, "cn-market")), ["THESIS.md"]);
});

test("freeze: a NO_MARKET_DATA pool writes nothing and leaves the run open with its other evidence", async (t) => {
  const root = await strategiesRoot(t);
  const empty = await fixtures(t, (dir) => writeFile(join(dir, "zt-pool.json"), JSON.stringify({ rc: 0, data: null })));
  const { tools } = mount(root, await fixtures(t), { "limit-up": { fetch: empty } });
  const { run } = JSON.parse(await tools.index.execute({ strategy: "cn-market" }, exec()));
  await rejectsWith(tools["limit-up"].execute({ strategy: "cn-market", run }, exec()), "NO_MARKET_DATA");
  const dir = runDir(root, "cn-market", run);
  const manifest = await readJson(dir, "run.json");
  assert.deepEqual(manifest.evidence.map((e: any) => e.source), ["index"]);
  assert.equal(manifest.sealed_at, null);
  assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith("evidence-")), ["evidence-index.json"]);
  // The run still takes the other sources.
  await tools.boards.execute({ strategy: "cn-market", run, boards: ["BK0715"] }, exec());
});

test("freeze: a refusal after a freeze opened its own run names the run id, and a retry with that run is accepted", async (t) => {
  const root = await strategiesRoot(t);
  const empty = await fixtures(t, (dir) => writeFile(join(dir, "zt-pool.json"), JSON.stringify({ rc: 0, data: null })));
  const broken = mount(root, empty);
  let message = "";
  await assert.rejects(broken.tools["limit-up"].execute({ strategy: "cn-market" }, exec()), (error: any) => {
    assert.ok(error instanceof LunhuiError);
    assert.equal(error.code, "NO_MARKET_DATA");
    message = error.message;
    return true;
  });
  assert.match(message, /^NO_MARKET_DATA: 东方财富/);
  assert.doesNotMatch(message, /\//);
  const run = /已开启运行 (\S+)，重试时请传入 run。$/.exec(message)?.[1];
  assert.ok(run, message);
  assert.deepEqual(await readdir(join(root, "cn-market", "analysis")), [run]);
  assert.deepEqual((await readJson(runDir(root, "cn-market", run), "run.json")).evidence, []);
  const { tools } = mount(root, await fixtures(t));
  const retry = JSON.parse(await tools["limit-up"].execute({ strategy: "cn-market", run }, exec()));
  assert.equal(retry.run, run);
  assert.equal((await readJson(runDir(root, "cn-market", run), "metrics.json")).freezes, 2);
  // A refusal on a run the caller named carries no id: the caller has it.
  await assert.rejects(tools["limit-up"].execute({ strategy: "cn-market", run }, exec()), (error: any) => error.code === "SOURCE_FROZEN" && !error.message.includes(run));
});

test("freeze: on a Saturday the limit-up pools are asked for the previous trading day's date", async (t) => {
  const root = await strategiesRoot(t);
  const { urls } = mockFetch(t, await fixtures(t));
  const { service, tools } = mount(root, undefined, {}, new Date("2026-10-24T02:00:00.000Z"));
  const saturday = JSON.parse(await tools["limit-up"].execute({ strategy: "cn-market" }, exec()));
  assert.equal(urls.length, 3);
  for (const url of urls) assert.equal(url.searchParams.get("date"), "20261023");
  // The run records the trading day the pools belong to, the previous Friday, beside the wall clock.
  assert.equal(saturday.session, "2026-10-23");
  assert.equal(saturday.as_of, "2026-10-24T02:00:00.000Z");
  const dir = runDir(root, "cn-market", saturday.run);
  assert.equal((await readJson(dir, "evidence-limit-up.json")).session, "2026-10-23");
  assert.deepEqual((await readJson(dir, "run.json")).evidence.map((e: any) => e.session), ["2026-10-23"]);
  const sealed = await service.sealRun("cn-market", saturday.run);
  assert.deepEqual([sealed.session, sealed.as_of], ["2026-10-23", "2026-10-24T02:00:00.000Z"]);
  // Before 09:15 on a trading day, the previous session too: Monday 2026-10-26 08:00 in China.
  const early = mount(root, undefined, {}, new Date("2026-10-26T00:00:00.000Z"));
  urls.length = 0;
  await early.tools["limit-up"].execute({ strategy: "cn-market" }, exec());
  for (const url of urls) assert.equal(url.searchParams.get("date"), "20261023");
});

test("freeze: a Tencent timeout on the quotes freeze is UPSTREAM_TIMEOUT and writes nothing", async (t) => {
  const root = await strategiesRoot(t);
  const { reached } = mockFetch(t, await fixtures(t), (url) => url.host === "qt.gtimg.cn");
  const { tools } = mount(root, undefined);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = tools.quotes.execute({ strategy: "alpha", symbols: ["sh600519", "sh000001"] }, exec());
  await reached;
  t.mock.timers.tick(7000);
  await rejectsWith(pending, "UPSTREAM_TIMEOUT");
  t.mock.timers.reset();
  const [run] = await readdir(join(root, "alpha", "analysis"));
  const dir = runDir(root, "alpha", run);
  assert.deepEqual((await readJson(dir, "run.json")).evidence, []);
  assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith("evidence-")), []);
});

test("freeze: quotes refuses a bad symbol list with INVALID_SYMBOL before any fetch, and freezes quotes and histories", async (t) => {
  const root = await strategiesRoot(t);
  const { urls } = mockFetch(t, await fixtures(t));
  const { tools } = mount(root, undefined);
  const nine = ["sh000001", "sz399001", "sz399006", "sh000300", "sh600519", "sh601318", "sz000001", "sz000333", "sh600000"];
  for (const symbols of [[], nine, ["SH000001"], ["sh000001", "sh000001"], ["sh688001"], ["sh000001", "sz399001", "sz399006", "sh000300", "sh000016"]]) {
    await rejectsWith(tools.quotes.execute({ strategy: "alpha", symbols }, exec()), "INVALID_SYMBOL");
  }
  assert.equal(urls.length, 0);
  assert.deepEqual(await readdir(join(root, "alpha")), ["THESIS.md"]);
  const reply = JSON.parse(await tools.quotes.execute({ strategy: "alpha", symbols: ["sh600519", "sh000001"] }, exec()));
  assert.equal(reply.items, 4);
  assert.deepEqual(reply.derived, []);
  assert.equal(reply.host, "qt.gtimg.cn,web.ifzq.gtimg.cn");
  const evidence = await readJson(runDir(root, "alpha", reply.run), "evidence-quotes.json");
  assert.deepEqual(evidence.items.map((item: any) => [item.kind, item.symbol, item.instrument]), [
    ["quote", "sh000001", "index"], ["quote", "sh600519", "equity"], ["history", "sh000001", undefined], ["history", "sh600519", undefined],
  ]);
  assert.ok(evidence.items[2].bars.length > 0);
});

test("freeze: boards cuts a long member list at 100 with truncated true, and breadth comes from the board's own counts", async (t) => {
  const root = await strategiesRoot(t);
  const { tools } = mount(root, await fixtures(t));
  await rejectsWith(tools.boards.execute({ strategy: "cn-market", boards: ["BK07150"] }, exec()), "INVALID_SYMBOL");
  await rejectsWith(tools.boards.execute({ strategy: "cn-market", boards: [] }, exec()), "INVALID_SYMBOL");
  await rejectsWith(tools.boards.execute({ strategy: "cn-market", boards: ["BK0715", "BK0715"] }, exec()), "INVALID_SYMBOL");
  await rejectsWith(tools.boards.execute({ strategy: "cn-market", boards: Array.from({ length: 11 }, (_, i) => `BK${String(i).padStart(4, "0")}`) }, exec()), "INVALID_SYMBOL");
  assert.deepEqual(await readdir(join(root, "cn-market")), ["THESIS.md"]);
  const reply = JSON.parse(await tools.boards.execute({ strategy: "cn-market", boards: ["BK1716", "BK0715"] }, exec()));
  assert.equal(reply.truncated, true);
  assert.equal(reply.host, "push2.eastmoney.com");
  const evidence = await readJson(runDir(root, "cn-market", reply.run), "evidence-boards.json");
  const members = evidence.items.filter((item: any) => item.kind === "members");
  assert.deepEqual(members.map((item: any) => [item.board, item.members.length, item.truncated]), [["BK1716", 100, true], ["BK0715", 4, false]]);
  const boards = evidence.items.filter((item: any) => item.kind === "board");
  assert.equal(boards.length, 4);
  assert.equal(evidence.items.filter((item: any) => item.kind === "flow").length, 4);
  const raw = (await readJson(EASTMONEY, "boards.json")).data.diff.find((row: any) => row.f12 === "BK1716");
  const breadth = evidence.items.find((item: any) => item.measure === "breadth" && item.params.board === "BK1716");
  assert.equal(breadth.value, raw.f104 / (raw.f104 + raw.f105));
  assert.deepEqual(breadth.inputs, [boards.find((board: any) => board.code === "BK1716").id]);
  // Without `boards`, the first ten boards of the list (all four here) give their members.
  const top = JSON.parse(await tools.boards.execute({ strategy: "cn-market" }, exec()));
  const topEvidence = await readJson(runDir(root, "cn-market", top.run), "evidence-boards.json");
  assert.deepEqual(topEvidence.items.filter((item: any) => item.kind === "members").map((item: any) => item.board), boards.map((board: any) => board.code));
});

test("freeze: each Eastmoney item records the host that served it; a members reply redirected to push2delay is delayed alone", async (t) => {
  const root = await strategiesRoot(t);
  const serve = createFixtureFetch(await fixtures(t));
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const target = new URL(url);
    if (target.host === "push2.eastmoney.com" && (target.searchParams.get("fs") ?? "").startsWith("b:BK0715")) {
      target.host = "push2delay.eastmoney.com";
      return new Response(null, { status: 302, headers: { location: target.href } });
    }
    if (target.host === "push2delay.eastmoney.com") target.host = "push2.eastmoney.com";
    return serve(target.href, init);
  });
  const { tools } = mount(root, undefined);
  const reply = JSON.parse(await tools.boards.execute({ strategy: "cn-market", boards: ["BK1716", "BK0715"] }, exec()));
  assert.equal(reply.delayed, true);
  assert.equal(reply.host, "push2.eastmoney.com,push2delay.eastmoney.com");
  const evidence = await readJson(runDir(root, "cn-market", reply.run), "evidence-boards.json");
  assert.equal(evidence.delayed, true);
  const stamps: any[][] = evidence.items.filter((item: any) => item.kind !== "derived").map((item: any) => [item.kind, item.board ?? item.code, item.host, item.delayed]);
  for (const [kind, code, host, delayed] of stamps) {
    const redirected = kind === "members" && code === "BK0715";
    assert.deepEqual([host, delayed], redirected ? ["push2delay.eastmoney.com", true] : ["push2.eastmoney.com", false], `${kind} ${code}`);
  }
  assert.equal(stamps.filter(([kind]) => kind === "members").length, 2);
});

test("freeze: every row refuses CALENDAR_UNCOVERED before any run when the previous session lies outside the calendar", async (t) => {
  const root = await strategiesRoot(t);
  const { urls } = mockFetch(t, await fixtures(t));
  // 2026-01-01 is a covered holiday; the session before it, 2025-12-31, no table covers.
  const { tools } = mount(root, undefined, {}, new Date("2026-01-01T04:00:00.000Z"));
  for (const tool of Object.values(tools)) {
    await rejectsWith(tool.execute({ strategy: "cn-market", symbols: ["sh000001"] }, exec()), "CALENDAR_UNCOVERED");
  }
  assert.equal(urls.length, 0);
  assert.deepEqual(await readdir(join(root, "cn-market")), ["THESIS.md"]);
});

test("freeze: index stores the up/down distribution as one counts item - counts, buckets, the data hash, no row - and derives the ratio and the limit counts from it, each naming its definition", async (t) => {
  const root = await strategiesRoot(t);
  const { urls } = mockFetch(t, await fixtures(t));
  const { tools } = mount(root, undefined);
  const reply = JSON.parse(await tools.index.execute({ strategy: "cn-market" }, exec()));
  assert.equal(reply.host, "qt.gtimg.cn,web.ifzq.gtimg.cn,push2ex.eastmoney.com");
  const klines = urls.filter((url) => url.host === "web.ifzq.gtimg.cn").map((url) => url.searchParams.get("param")).sort();
  assert.deepEqual(klines, ["sh000001,day,,,120,qfq", "sh000300,day,,,120,qfq", "sz399001,day,,,120,qfq", "sz399006,day,,,120,qfq"]);
  // One Eastmoney request, the distribution; the clist is never asked.
  assert.deepEqual(urls.filter((url) => url.host.endsWith("eastmoney.com")).map((url) => url.pathname), ["/getTopicZDFenBu"]);
  const evidence = await readJson(runDir(root, "cn-market", reply.run), "evidence-index.json");
  assert.deepEqual(evidence.items.filter((item: any) => item.kind === "index").map((item: any) => item.symbol), ["sh000001", "sz399001", "sz399006", "sh000300"]);
  assert.equal(evidence.items.filter((item: any) => item.kind === "bars").length, 4);
  const counts = evidence.items.find((item: any) => item.kind === "counts");
  const fixture = JSON.parse(await readFile(join(EASTMONEY, "distribution.json"), "utf8"));
  const { id, ...fields } = counts;
  assert.match(id, /^ev_/);
  assert.deepEqual(fields, {
    kind: "counts", qdate: 20261023,
    advancers: 15, decliners: 12, unchanged: 3, limitUp: 6, limitDown: 2, total: 30,
    buckets: [
      { bucket: -11, count: 2 }, { bucket: -10, count: 1 }, { bucket: -3, count: 4 }, { bucket: -1, count: 5 },
      { bucket: 0, count: 3 }, { bucket: 1, count: 6 }, { bucket: 5, count: 2 }, { bucket: 10, count: 1 }, { bucket: 11, count: 6 },
    ],
    hash: hash(fixture.data), host: "push2ex.eastmoney.com", delayed: false,
  });
  for (const item of evidence.items.filter((item: any) => item.kind === "index" || item.kind === "bars")) assert.equal(item.host, undefined);
  const derived = evidence.items.filter((item: any) => item.kind === "derived");
  assert.deepEqual(derived.map((item: any) => item.measure), ["total_turnover", "advance_decline_ratio", "limit_up_count", "limit_down_count"]);
  assert.deepEqual(derived.slice(1).map((item: any) => item.value), [15 / 12, 6, 2]);
  // Each counts measure names its definition and cites the one counts item (spec §17).
  assert.deepEqual(derived.slice(1).map((item: any) => item.params), [
    { endpoint: "getTopicZDFenBu" }, { endpoint: "getTopicZDFenBu", bucket: 11 }, { endpoint: "getTopicZDFenBu", bucket: -11 },
  ]);
  for (const item of derived.slice(1)) {
    assert.ok(!("partial" in item), item.measure);
    assert.deepEqual(item.inputs, [counts.id]);
  }
  assert.equal(typeof derived[0].value, "number");
});

test("freeze: index refuses a distribution of another session as NO_MARKET_DATA, naming both dates, and writes nothing", async (t) => {
  const root = await strategiesRoot(t);
  const stale = await fixtures(t, async (dir) => {
    const reply = JSON.parse(await readFile(join(dir, "distribution.json"), "utf8"));
    await writeFile(join(dir, "distribution.json"), JSON.stringify({ ...reply, data: { ...reply.data, qdate: 20261022 } }));
  });
  const { service, tools } = mount(root, stale);
  const { run } = await service.openRun("cn-market", "market");
  let message = "";
  await assert.rejects(tools.index.execute({ strategy: "cn-market", run }, exec()), (error: any) => {
    assert.equal(error.code, "NO_MARKET_DATA");
    message = error.message;
    return true;
  });
  assert.match(message, /^NO_MARKET_DATA: 东方财富.*20261022.*20261023/);
  const dir = runDir(root, "cn-market", run);
  assert.deepEqual((await readJson(dir, "run.json")).evidence, []);
  assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith("evidence-")), []);
  // On a Saturday the session is Friday's, the fixture's: the same distribution is accepted.
  const saturday = mount(root, await fixtures(t), {}, new Date("2026-10-24T02:00:00.000Z"));
  const landed = JSON.parse(await saturday.tools.index.execute({ strategy: "cn-market" }, exec()));
  assert.equal(landed.session, "2026-10-23");
});

test("freeze: two freezes of different sources on one run at once both land", async (t) => {
  const root = await strategiesRoot(t);
  const { service, tools } = mount(root, await fixtures(t));
  const { run } = await service.openRun("cn-market", "market");
  await Promise.all([
    tools["limit-up"].execute({ strategy: "cn-market", run }, exec()),
    tools.boards.execute({ strategy: "cn-market", run, boards: ["BK0715"] }, exec()),
  ]);
  const dir = runDir(root, "cn-market", run);
  const manifest = await readJson(dir, "run.json");
  assert.deepEqual(manifest.evidence.map((e: any) => e.source).sort(), ["boards", "limit-up"]);
  assert.equal((await readJson(dir, "metrics.json")).freezes, 2);
});

test("freeze: every row records the session its data belongs to in the evidence file, its run.json entry and the reply", async (t) => {
  const root = await strategiesRoot(t);
  const { tools } = mount(root, await fixtures(t));
  const { run } = JSON.parse(await tools.index.execute({ strategy: "cn-market" }, exec()));
  await tools["limit-up"].execute({ strategy: "cn-market", run }, exec());
  await tools.boards.execute({ strategy: "cn-market", run, boards: ["BK0715"] }, exec());
  const quotes = JSON.parse(await tools.quotes.execute({ strategy: "cn-market", run, symbols: ["sh000001"] }, exec()));
  assert.equal(quotes.session, "2026-10-23");
  const dir = runDir(root, "cn-market", run);
  const manifest = await readJson(dir, "run.json");
  assert.deepEqual(manifest.evidence.map((e: any) => [e.source, e.session]), [
    ["index", "2026-10-23"], ["limit-up", "2026-10-23"], ["boards", "2026-10-23"], ["quotes", "2026-10-23"],
  ]);
  for (const source of ["index", "limit-up", "boards", "quotes"]) assert.equal((await readJson(dir, `evidence-${source}.json`)).session, "2026-10-23", source);
});

test("freeze: a code repeated inside one pool reply keeps its first row and counts the duplicates", async (t) => {
  const root = await strategiesRoot(t);
  const doubled = await fixtures(t, async (dir) => {
    const reply = JSON.parse(await readFile(join(dir, "zt-pool.json"), "utf8"));
    const first = reply.data.pool[0];
    reply.data.pool.push({ ...first, n: "后来的重复行" }, { ...first, n: "又一个重复行" });
    await writeFile(join(dir, "zt-pool.json"), JSON.stringify(reply));
  });
  const { tools } = mount(root, doubled);
  const reply = JSON.parse(await tools["limit-up"].execute({ strategy: "cn-market" }, exec()));
  assert.equal(reply.duplicates, 2);
  assert.equal(reply.items, 6 + 3 + 5);
  const evidence = await readJson(runDir(root, "cn-market", reply.run), "evidence-limit-up.json");
  const zt = evidence.items.filter((item: any) => item.pool === "zt");
  assert.equal(zt.length, 6);
  assert.equal(new Set(zt.map((row: any) => row.code)).size, 6);
  assert.ok(!zt.some((row: any) => /重复行/.test(row.name)), "the first occurrence is the one kept");
  // A clean reply says so.
  const clean = JSON.parse(await mount(root, await fixtures(t)).tools["limit-up"].execute({ strategy: "cn-market" }, exec()));
  assert.equal(clean.duplicates, 0);
});
