// face/tests/analog-rows.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as viewsRow from "../plugins/analog/views-row.mjs";
import * as eventsRow from "../plugins/analog/events-row.mjs";
import { AnalogError } from "../plugins/analog/lib/errors.mjs";
import { VIEW_ID_RE } from "../plugins/analog/lib/views.mjs";
import { ANALOG_ROW_IDS, ANALOG_TOOL_NAMES, analogPatches } from "../src/analog.ts";
import { EVENT, EVENT_MARKET, fakeMarket } from "./analog-fixtures.ts";

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
const ROOT = { agent: { session: { header: {} } } };
const CHILD = { agent: { session: { header: { origin: "subagent" } } } };
const code = (c: string) => (e: unknown) => e instanceof AnalogError && e.code === c && e.message.startsWith(`${c} `);

test("the rows are named as the face composes them", () => {
  assert.deepEqual([viewsRow.name, eventsRow.name], [...ANALOG_ROW_IDS]);
  assert.deepEqual(eventsRow.inject, ["tools", "analogViews"]);
  const [patch] = analogPatches("/home/dsh") as Array<{ insert: Array<{ id: string; name: string; config: object }> }>;
  assert.deepEqual(patch!.insert.map((row) => row.id), ["analog-views", "analog-events"]);
  assert.deepEqual(patch!.insert.map((row) => row.config), [{ viewsDir: "/home/dsh/face/analog/views" }, {}]);
  assert.ok(patch!.insert[0]!.name.endsWith("/face/plugins/analog/views-row.mjs"));
  assert.ok(patch!.insert[1]!.name.endsWith("/face/plugins/analog/events-row.mjs"));
});

test("the backbone needs an absolute views directory; the tool row needs the backbone", () => {
  assert.throws(() => viewsRow.apply(fakeScope().ctx, {}), /analog-views: viewsDir must be an absolute path/);
  assert.throws(() => viewsRow.apply(fakeScope().ctx, { viewsDir: "relative/views" }), /absolute path/);
  assert.throws(() => eventsRow.apply(fakeScope().ctx), /analog-events: analogViews is missing; mount the analog-views row first/);
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
  viewsRow.apply(scope.ctx, { viewsDir, ask: market.ask, now: () => new Date("2020-06-22T20:00:00Z") });
  eventsRow.apply(scope.ctx);
  return { ...scope, viewsDir, service: scope.provided.get("analogViews") as EventsService };
}
const EVENT_IN = { symbol: "EVT", label: "CEO out", group: "hired", date: "2020-04-10", timing: "pre", source: "https://example.com/a", verified: true };

test("the service holds the event scan, the page record and the store, and no chart scan", async (t) => {
  const { service } = await mountedEvents(t);
  assert.deepEqual(Object.keys(service).sort(), ["notePage", "pageOpened", "readView", "scanEvents", "writeView"]);
});

test("analog_events answers a digest and the id of a stored view", async (t) => {
  const { tools, viewsDir, service } = await mountedEvents(t);
  assert.deepEqual(tools.map((tool) => tool.name), [...ANALOG_TOOL_NAMES]);
  assert.deepEqual([...ANALOG_TOOL_NAMES], ["analog_events"]);
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

test("the events schema says what each timing means and requires a query's anchors", async (t) => {
  const { tools } = await mountedEvents(t);
  const schema = tools.find((tool) => tool.name === "analog_events")!.parameters as any;
  assert.deepEqual(schema.properties.query.required, ["symbol", "anchors"]);
  for (const timing of [schema.properties.events.items.properties.timing, schema.properties.query.properties.anchors.items.properties.timing]) {
    for (const word of ["09:30", "16:00", "weekend or a market holiday", "New York"]) assert.ok(timing.description.includes(word), `${word}: ${timing.description}`);
  }
});

test("the events description says what the tool is and is not", () => {
  for (const word of ["Past events like this one, measured.", "role_source_reader", "analog-guide", "never verified", "against SPY", "quote numbers from the digest only", "never evidence for a trade"]) assert.ok(eventsRow.EVENTS_DESCRIPTION.includes(word), word);
});
