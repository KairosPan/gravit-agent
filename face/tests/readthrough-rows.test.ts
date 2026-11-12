import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as serviceRow from "../plugins/readthrough/service-row.mjs";
import * as toolRow from "../plugins/readthrough/tool-row.mjs";
import { ReadThroughError } from "../plugins/readthrough/lib/errors.mjs";
import { ID_RE, createRecord } from "../plugins/readthrough/lib/record.mjs";
import { READ_THROUGH_ROW_IDS, READ_THROUGH_TOOL_NAMES, readThroughPatches } from "../src/readthrough.ts";

const AT = "2026-11-09T09:03:10.000Z";          // 04:03 ET, Monday
const FRIDAY_CLOSE = "2026-11-06T21:00:00.000Z"; // 16:00 ET
const code = (c: string) => (e: unknown) => e instanceof ReadThroughError && e.code === c;
const ARGS = {
  symbol: "NVDA", basis: "company", event: "董事会对 CEO 启动独立调查", sources: ["NVIDIA newsroom 11-08 18:00 ET"], logic: "供应不确定 → 客户找备选",
  peers: [{ symbol: "AMD", reason: "数据中心 GPU 的直接替代" }], counter: "调查针对个人", certainty: "medium",
};
const RUN = { pass: "p-1", asks: [{ symbol: "NVDA", ref: "2026-11-06" }] };

type ToolDef = { name: string; description: string; parameters: unknown; execute(args: unknown, exec: unknown): Promise<string> };
function fakeScope() {
  const provided = new Map<string, unknown>();
  const tools: ToolDef[] = [];
  const ctx: any = {
    effect(fn: () => unknown) { return fn(); },
    provide(key: string, value: unknown) { provided.set(key, value); ctx[key] = value; return () => {}; },
    tools: { register(def: ToolDef) { tools.push(def); return () => { tools.splice(tools.indexOf(def), 1); }; } },
  };
  return { ctx, provided, tools };
}
/** A mounted, wired service over a scratch record - or over `dir`, an earlier one's, as after a restart; `rows` are
 * the prices by symbol, changeable between calls. */
async function mounted(t: { after(fn: () => Promise<unknown>): unknown }, wire = true, dir?: string) {
  const recordDir = dir ?? join(await mkdtemp(join(tmpdir(), "readthrough-rows-")), "readthrough");
  if (dir === undefined) t.after(() => rm(join(recordDir, ".."), { recursive: true, force: true }));
  const scope = fakeScope();
  serviceRow.apply(scope.ctx, { recordDir, universe: ["NVDA", "AMD", "AVGO", "INTC"], now: () => new Date(AT) });
  const service = scope.provided.get("readThrough") as any;
  const tools = scope.tools;
  const rows: Record<string, { price: number | null; changePct: number | null; feed?: string; asOf?: string | null }> = {
    NVDA: { price: 173.07, changePct: -7.27 }, AMD: { price: 473.39, changePct: 5.42 }, SPY: { price: 740, changePct: -0.4 }, CRWV: { price: 90, changePct: 1 },
  };
  const asked: string[][] = [];
  const state = { on: true, fail: undefined as string | undefined };
  if (wire) service.wire({
    prices: async (symbols: string[]) => {
      asked.push(symbols);
      if (state.fail !== undefined) throw new Error(state.fail);
      return symbols.map((symbol) => ({ symbol, price: null, changePct: null, feed: "robinhood", asOf: AT, ...(rows[symbol] as Partial<(typeof rows)[string]> | undefined) }));
    },
    deskSymbols: async () => ["CRWV", "SPY"], usSessionOn: () => state.on, refClose: (date: string) => (date === "2026-11-06" ? FRIDAY_CLOSE : undefined),
  });
  return { service, rows, asked, state, recordDir, scope, tools };
}
/** `mounted(t)`, then the tool row applied on the same scope. */
async function mountedWithTool(t: { after(fn: () => Promise<unknown>): unknown }) {
  const m = await mounted(t);
  toolRow.apply(m.scope.ctx);
  return m;
}

test("the row is named, needs an absolute record directory, and provides readThrough", async (t) => {
  assert.deepEqual([serviceRow.name, serviceRow.inject], ["read-through-service", []]);
  assert.throws(() => serviceRow.apply(fakeScope().ctx, { recordDir: "relative" }), /read-through-service: recordDir must be an absolute path/);
  const { service } = await mounted(t, false);
  assert.equal(service.ready(), false);
  await assert.rejects(service.propose(ARGS, { sessionId: "s-task", desk: false }), code("NOT_READY"));   // Review Focus 5
});

test("under an alert: the call is priced, recorded and kept for the run's close", async (t) => {
  const { service, asked, recordDir } = await mounted(t);
  service.open("s-1", RUN);
  const { id, block } = await service.propose(ARGS, { sessionId: "s-1", desk: true });
  assert.match(id, ID_RE);
  assert.deepEqual(asked, [["NVDA", "AMD", "SPY"]]);
  assert.equal(block.split("\n")[3], "· 盘面：NVDA −7.3% · AMD +5.4% · SPY −0.4%（ROBINHOOD 04:03 ET）");
  assert.equal(block.includes("· 事件："), false, "the reason above the block names the event");
  assert.equal(await service.given("NVDA", "2026-11-06"), true);
  const [line] = (await createRecord(recordDir).all()) as any[];
  assert.deepEqual([line.kind, line.id, line.t], ["direction", id, AT]);
  assert.deepEqual(line.caller, { kind: "annotation", pass: "p-1", sessionId: "s-1", ref: "2026-11-06" });
  assert.deepEqual([line.stricken.changePct, line.peers[0].price, line.peers[0].traded, line.spy.symbol, line.shut], [-7.27, 473.39, true, "SPY", false]);
  assert.deepEqual(service.close("s-other"), [], "another run gets none of it");
  assert.deepEqual(service.close("s-1"), [{ id, text: block }]);
  assert.deepEqual(service.close("s-1"), [], "a run is forgotten once closed");
});

test("a run's refusals: another company, the same event twice, a desk agent with no run, no tape", async (t) => {
  const { service, rows, recordDir } = await mounted(t);
  await assert.rejects(service.propose(ARGS, { sessionId: "s-brief", desk: true }), code("ALERT_ONLY"));
  service.open("s-1", RUN);
  await assert.rejects(service.propose({ ...ARGS, symbol: "INTC" }, { sessionId: "s-1", desk: true }), code("NOT_ALERTED"));
  rows.NVDA = { price: 173.07, changePct: null };
  await assert.rejects(service.propose(ARGS, { sessionId: "s-1", desk: true }), code("NO_TAPE"));
  rows.NVDA = { price: 173.07, changePct: -7.27 };
  await service.propose(ARGS, { sessionId: "s-1", desk: true });
  await assert.rejects(service.propose(ARGS, { sessionId: "s-1", desk: true }), code("ALREADY_GIVEN"));
  service.close("s-1");
  service.open("s-2", RUN);   // a later alert's run, the same reference close
  await assert.rejects(service.propose(ARGS, { sessionId: "s-2", desk: true }), code("ALREADY_GIVEN"));
  const again = await mounted(t, true, recordDir);   // the face restarted: a new service over the same record
  again.service.open("s-3", RUN);
  await assert.rejects(again.service.propose(ARGS, { sessionId: "s-3", desk: true }), code("ALREADY_GIVEN"));
});

test("two calls arriving together for one company: one is accepted", async (t) => {   // Review Focus 1
  const { service } = await mounted(t);
  service.open("s-1", RUN);
  const both = await Promise.allSettled([service.propose(ARGS, { sessionId: "s-1", desk: true }), service.propose(ARGS, { sessionId: "s-1", desk: true })]);
  assert.deepEqual(both.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(service.close("s-1").length, 1);
});

test("the fence: the list, the desk's symbols, never SPY, QQQ or the company itself; the refusal names the symbol", async (t) => {
  const { service } = await mounted(t);
  const task = { sessionId: "s-task", desk: false };
  await service.propose({ ...ARGS, peers: [{ symbol: "CRWV", reason: "in the desk's files" }] }, task);
  for (const symbol of ["NBIS", "SPY", "QQQ"]) {
    await assert.rejects(service.propose({ ...ARGS, peers: [{ symbol, reason: "r" }] }, task),
      (e: unknown) => code("OUTSIDE_FENCE")(e) && (e as Error).message.includes(`${symbol} is not a name`));
  }
});

test("a rival's print older than the reference close, or with no change, reads 未成交 and stays", async (t) => {   // Review Focus 2
  const { service, rows } = await mounted(t);
  rows.AMD = { price: 449.04, changePct: 0.2, asOf: "2026-11-06T20:59:00.000Z" };   // Friday, before the close
  rows.SPY = { price: 740, changePct: null };
  service.open("s-1", RUN);
  const { block } = await service.propose(ARGS, { sessionId: "s-1", desk: true });
  assert.equal(block.split("\n")[3], "· 盘面：NVDA −7.3%（ROBINHOOD 04:03 ET） · AMD 未成交 · SPY 未成交");
});

test("a task: no run needed, the two extra lines, a shut market said, and no event opened", async (t) => {
  const { service, state } = await mounted(t);
  state.on = false;
  const { block } = await service.propose(ARGS, { sessionId: "s-task", desk: false });
  const lines = block.split("\n");
  assert.deepEqual([lines[1], lines[4], lines.at(-1)], ["· 事件：董事会对 CEO 启动独立调查", "· 盘面：休市，事件之后还没有成交", "来源：NVIDIA newsroom 11-08 18:00 ET"]);
  assert.equal(await service.given("NVDA", "2026-11-06"), false);
  assert.equal((await service.propose(ARGS, { sessionId: "s-task", desk: false })).block, block, "a task may ask again");
});

test("the Market down is a refusal by name, and nothing is recorded", async (t) => {   // Review Focus 5
  const { service, state } = await mounted(t);
  state.fail = "the Market read did not answer";
  service.open("s-1", RUN);
  await assert.rejects(service.propose(ARGS, { sessionId: "s-1", desk: true }),
    (e: unknown) => code("NOT_READY")(e) && (e as Error).message.includes("the Market read did not answer"));
  assert.equal(await service.given("NVDA", "2026-11-06"), false);
});

test("later re-prices a recorded direction; a no-direction, an unknown event and a failed read give no line", async (t) => {
  const { service, rows, state } = await mounted(t);
  service.open("s-1", RUN);
  await service.propose(ARGS, { sessionId: "s-1", desk: true });
  rows.AMD = { price: 502.8, changePct: 12 };
  assert.deepEqual(await service.later([{ symbol: "NVDA", ref: "2026-11-06" }, { symbol: "INTC", ref: "2026-11-06" }]), ["推演（04:03 ET 已给）：做多 AMD，此后 +6.2%"]);
  state.fail = "down";
  assert.deepEqual(await service.later([{ symbol: "NVDA", ref: "2026-11-06" }]), []);
});

test("sent writes one line an id", async (t) => {
  const { service, recordDir } = await mounted(t);
  service.open("s-1", RUN);
  const { id } = await service.propose(ARGS, { sessionId: "s-1", desk: true });
  await service.sent([id], true);
  assert.equal(await service.given("NVDA", "2026-11-06"), true);
  assert.ok((await createRecord(recordDir).all()).some((e: any) => e.kind === "sent" && e.id === id && e.sent === true));
});

test("a direction sent false is not given: later is silent and a new run may give one", async (t) => {
  const { service } = await mounted(t);
  service.open("s-1", RUN);
  const { id } = await service.propose(ARGS, { sessionId: "s-1", desk: true });
  service.close("s-1");
  await service.sent([id], false);
  assert.equal(await service.given("NVDA", "2026-11-06"), false);
  assert.deepEqual(await service.later([{ symbol: "NVDA", ref: "2026-11-06" }]), []);
  service.open("s-2", RUN);
  assert.match((await service.propose(ARGS, { sessionId: "s-2", desk: true })).id, ID_RE);
});

test("a run closed while its prices are read: ALERT_ONLY, nothing kept, nothing given", async (t) => {   // review fix
  const { service, recordDir } = await mounted(t);
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let asked = () => {};
  const reading = new Promise<void>((resolve) => { asked = resolve; });
  service.wire({
    prices: async (symbols: string[]) => { asked(); await held; return symbols.map((symbol) => ({ symbol, price: 100, changePct: -1, feed: "robinhood", asOf: AT })); },
    deskSymbols: async () => [], usSessionOn: () => true, refClose: () => FRIDAY_CLOSE,
  });
  service.open("s-1", RUN);
  const call = service.propose(ARGS, { sessionId: "s-1", desk: true });
  await reading;
  assert.deepEqual(service.close("s-1"), []);
  release();
  await assert.rejects(call, code("ALERT_ONLY"));
  assert.equal(await service.given("NVDA", "2026-11-06"), false);
  assert.equal((await createRecord(recordDir).given("NVDA", "2026-11-06")), undefined);
});

const ROOT = (id: string, agentPreset?: string) => ({ agent: { session: { header: { id, ...(agentPreset === undefined ? {} : { agentPreset }) } } } });
const CHILD = { agent: { session: { header: { id: "s-child", origin: "subagent" } } } };

test("the rows are named as the face composes them", () => {
  assert.deepEqual([serviceRow.name, toolRow.name], [...READ_THROUGH_ROW_IDS]);
  assert.deepEqual(toolRow.inject, ["tools", "readThrough"]);
  const [patch] = readThroughPatches("/home/dsh") as Array<{ insert: Array<{ id: string; name: string; config: object }> }>;
  assert.deepEqual(patch!.insert.map((row) => row.id), ["read-through-service", "read-through-tool"]);
  assert.deepEqual(patch!.insert.map((row) => row.config), [{ recordDir: "/home/dsh/face/readthrough" }, {}]);
  assert.ok(patch!.insert[0]!.name.endsWith("/face/plugins/readthrough/service-row.mjs") && patch!.insert[1]!.name.endsWith("/face/plugins/readthrough/tool-row.mjs"));
  assert.throws(() => toolRow.apply(fakeScope().ctx), /read-through-tool: readThrough is missing; mount the read-through-service row first/);
});

test("read_through: its schema, a task's answer, a desk agent's refusal outside the lane, a child's refusal", async (t) => {
  const { service, tools } = await mountedWithTool(t);
  assert.deepEqual(tools.map((tool) => tool.name), [...READ_THROUGH_TOOL_NAMES]);
  const schema = tools[0]!.parameters as { properties: object; required: string[] };
  assert.deepEqual(Object.keys(schema.properties), ["symbol", "basis", "event", "sources", "logic", "peers", "no_direction", "counter", "certainty"]);
  assert.deepEqual(schema.required, ["symbol", "basis", "event", "sources", "logic", "peers", "certainty"]);
  assert.ok(toolRow.READ_THROUGH_DESCRIPTION.startsWith("Which rivals a company's own bad news points to: your inference, not an order."));
  const answer = JSON.parse(await tools[0]!.execute(ARGS, ROOT("s-task")));
  assert.equal(answer.ok, true); assert.match(answer.id, ID_RE); assert.ok(answer.block.startsWith("推演 · Gravit 的推断，不是下单 · 确定度 中\n· 事件："));
  await assert.rejects(tools[0]!.execute(ARGS, ROOT("s-desk", "gravit-desk")), code("ALERT_ONLY"));
  await assert.rejects(tools[0]!.execute(ARGS, CHILD), code("NOT_GRAVIT"));
  service.open("s-run", RUN);
  assert.equal(JSON.parse(await tools[0]!.execute(ARGS, ROOT("s-run", "gravit-desk"))).block.includes("· 事件："), false);
});
