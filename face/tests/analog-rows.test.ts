// face/tests/analog-rows.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as viewsRow from "../plugins/analog/views-row.mjs";
import * as chartRow from "../plugins/analog/chart-row.mjs";
import * as eventsRow from "../plugins/analog/events-row.mjs";
import { AnalogError } from "../plugins/analog/lib/errors.mjs";
import { VIEW_ID_RE } from "../plugins/analog/lib/views.mjs";
import { ANALOG_ROW_IDS, ANALOG_TOOL_NAMES, analogPatches } from "../src/analog.ts";
import { EVENT, EVENT_MARKET, MARKET, PAST, SELLOFF, fakeMarket } from "./analog-fixtures.ts";

type ToolDef = { name: string; description: string; parameters: unknown; execute(args: unknown, exec: unknown): Promise<string> };
function fakeScope() {
  const provided = new Map<string, unknown>();
  const tools: ToolDef[] = [];
  const ctx: any = {
    effect(fn: () => unknown) { return fn(); },
    provide(key: string, value: unknown) { provided.set(key, value); ctx[key] = value; return () => { provided.delete(key); }; },
    tools: { register(def: ToolDef) { tools.push(def); return () => { tools.splice(tools.indexOf(def), 1); }; } },
  };
  return { ctx, provided, tools };
}
async function mounted(t: { after(fn: () => Promise<unknown>): unknown }) {
  const viewsDir = join(await mkdtemp(join(tmpdir(), "analog-rows-")), "views");
  t.after(() => rm(join(viewsDir, ".."), { recursive: true, force: true }));
  const scope = fakeScope();
  const market = fakeMarket({ QRY: { bars: SELLOFF }, PAST: { bars: PAST }, SPY: { bars: MARKET }, EXTRA: { bars: PAST } }); // EXTRA: outside the universe
  viewsRow.apply(scope.ctx, { viewsDir, ask: market.ask, universe: ["PAST"], now: () => new Date("2020-11-26T20:00:00Z") });
  chartRow.apply(scope.ctx);
  return { ...scope, viewsDir, market };
}
const ROOT = { agent: { session: { header: {} } } };
const CHILD = { agent: { session: { header: { origin: "subagent" } } } };
const code = (c: string) => (e: unknown) => e instanceof AnalogError && e.code === c && e.message.startsWith(`${c} `);

test("the rows are named as the face composes them", () => {
  assert.deepEqual([viewsRow.name, chartRow.name, eventsRow.name], [...ANALOG_ROW_IDS]);
  assert.deepEqual(chartRow.inject, ["tools", "analogViews"]);
  assert.deepEqual(eventsRow.inject, ["tools", "analogViews"]);
  const [patch] = analogPatches("/home/dsh") as Array<{ insert: Array<{ id: string; name: string; config: object }> }>;
  assert.deepEqual(patch!.insert.map((row) => row.id), ["analog-views", "analog-chart", "analog-events"]);
  assert.deepEqual(patch!.insert.map((row) => row.config), [{ viewsDir: "/home/dsh/face/analog/views" }, {}, {}]);
  assert.ok(patch!.insert[0]!.name.endsWith("/face/plugins/analog/views-row.mjs") && patch!.insert[1]!.name.endsWith("/face/plugins/analog/chart-row.mjs"));
  assert.ok(patch!.insert[2]!.name.endsWith("/face/plugins/analog/events-row.mjs"));
});

test("the backbone needs an absolute views directory; the tool row needs the backbone", () => {
  assert.throws(() => viewsRow.apply(fakeScope().ctx, {}), /analog-views: viewsDir must be an absolute path/);
  assert.throws(() => viewsRow.apply(fakeScope().ctx, { viewsDir: "relative/views" }), /absolute path/);
  assert.throws(() => chartRow.apply(fakeScope().ctx), /analog-chart: analogViews is missing; mount the analog-views row first/);
  assert.throws(() => eventsRow.apply(fakeScope().ctx), /analog-events: analogViews is missing; mount the analog-views row first/);
});

test("analog_chart answers a digest and the id of a stored view", async (t) => {
  const { tools, viewsDir, provided } = await mounted(t);
  assert.deepEqual(tools.map((tool) => tool.name), ["analog_chart"]);
  const schema = tools[0]!.parameters as { properties: object; required: string[] }; // defineTool turns the DSL into a JSON schema, as the Lunhui rows' tests read it
  assert.deepEqual(Object.keys(schema.properties), ["symbol", "as_of", "also"]); assert.deepEqual(schema.required, ["symbol"]);
  const answer = JSON.parse(await tools[0]!.execute({ symbol: "qry" }, ROOT));
  assert.equal(answer.ok, true); assert.match(answer.view, VIEW_ID_RE); assert.ok(answer.digest.includes(`view ${answer.view}`));
  assert.deepEqual(await readdir(viewsDir), [`${answer.view}.json`]);
  const service = provided.get("analogViews") as { readView(id: string): Promise<{ id: string; query: { symbol: string } }> };
  assert.equal((await service.readView(answer.view)).query.symbol, "QRY");
});

test("as_of and also reach the scan; a delegated child and a bad symbol are refused", async (t) => {
  const { tools, market } = await mounted(t);
  const asked = JSON.parse(await tools[0]!.execute({ symbol: "QRY", as_of: "2020-11-22", also: ["EXTRA"] }, ROOT));
  assert.ok(asked.digest.includes("QRY as of 2020-11-22 (as asked)"));
  assert.ok(market.calls.some((c) => c.symbol === "EXTRA"), "the market was asked for the ticker also named");
  assert.ok(asked.digest.split("\n")[0].startsWith("read 3 of 3 companies"));
  await assert.rejects(tools[0]!.execute({ symbol: "QRY" }, CHILD), code("NOT_GRAVIT"));
  await assert.rejects(tools[0]!.execute({ symbol: "not a ticker" }, ROOT), code("BAD_SYMBOL"));
  await assert.rejects(tools[0]!.execute({ symbol: "PAST", as_of: "2020-08-01" }, ROOT), code("NOT_A_SELLOFF"));
});

test("the description says what the tool is and is not", () => {
  for (const word of ["sell-off", "depth, speed, gaps and volume", "60 sessions", "NOT_A_SELLOFF", "digest", "never evidence for a trade", "a few minutes"]) assert.ok(chartRow.CHART_DESCRIPTION.includes(word), word);
});

type EventsService = {
  notePage(url: unknown): void;
  pageOpened(url: unknown): boolean;
  readView(id: string): Promise<{ kind: string }>;
};
async function mountedEvents(t: { after(fn: () => Promise<unknown>): unknown }) {
  const viewsDir = join(await mkdtemp(join(tmpdir(), "analog-events-rows-")), "views");
  t.after(() => rm(join(viewsDir, ".."), { recursive: true, force: true }));
  const scope = fakeScope();
  const market = fakeMarket({ EVT: { bars: EVENT }, SPY: { bars: EVENT_MARKET } });
  viewsRow.apply(scope.ctx, { viewsDir, ask: market.ask, universe: [], now: () => new Date("2020-06-22T20:00:00Z") });
  chartRow.apply(scope.ctx);
  eventsRow.apply(scope.ctx);
  return { ...scope, viewsDir, service: scope.provided.get("analogViews") as EventsService };
}
const EVENT_IN = { symbol: "EVT", label: "CEO out", group: "hired", date: "2020-04-10", timing: "pre", source: "https://example.com/a", verified: true };

test("analog_events answers a digest and the id of a stored view", async (t) => {
  const { tools, viewsDir, service } = await mountedEvents(t);
  assert.deepEqual(tools.map((tool) => tool.name), [...ANALOG_TOOL_NAMES]);
  const events = tools.find((tool) => tool.name === "analog_events")!;
  const schema = events.parameters as { properties: object; required: string[] };
  assert.deepEqual(Object.keys(schema.properties), ["title", "events", "query"]); assert.deepEqual(schema.required, ["title", "events"]);
  service.notePage("https://example.com/a");
  const answer = JSON.parse(await events.execute({ title: "CEO scandals", events: [EVENT_IN] }, ROOT));
  assert.equal(answer.ok, true); assert.match(answer.view, VIEW_ID_RE);
  assert.ok(answer.digest.includes(`view ${answer.view}`), answer.digest);
  assert.ok(answer.digest.includes("1 verified, 0 unverified"), answer.digest);
  assert.deepEqual(await readdir(viewsDir), [`${answer.view}.json`]);
  assert.equal((await service.readView(answer.view)).kind, "events");
  await assert.rejects(events.execute({ title: "CEO scandals", events: [EVENT_IN] }, CHILD), code("NOT_GRAVIT"));
  await assert.rejects(events.execute({ title: "CEO scandals", events: [] }, ROOT), code("INVALID_EVENTS"));
  assert.equal(service.pageOpened("http://www.example.com/a/"), true);
  assert.equal(service.pageOpened("https://example.com/b"), false);
});

test("the events description says what the tool is and is not", () => {
  for (const word of ["Past events like this one, measured.", "role_source_reader", "analog-guide", "never verified", "against SPY", "quote numbers from the digest only", "never evidence for a trade"]) assert.ok(eventsRow.EVENTS_DESCRIPTION.includes(word), word);
});
