import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import {
  abilityListing, abilityState, registerAbilityRoutes,
  type AbilityDeps, type AbilityFile, type AbilityRow,
} from "../src/abilities.ts";
import { registerPanelRoutes, type PanelDeps } from "../src/panels.ts";

/** One declaration as the reader keeps it; `fields` replaces any of it. */
function ability(fields: Partial<AbilityFile> = {}): AbilityFile {
  return {
    id: "event-analogs",
    name: "Event analogs",
    blurb: "What stocks did after past events like this one, measured against the market",
    icon: "rewind",
    about: "Give Gravit a stock and what just happened to it.\nThe answer is a table of the cases.",
    asks: ["TSLA announced a large recall. Find past events like it and measure them"],
    limits: ["Historical statistics, not a forecast and not a basis for a trade"],
    tools: ["analog_events"],
    rows: ["analog-views", "analog-events"],
    roles: ["source-reader"],
    skills: ["analog-guide"],
    zh: { name: "事件对标", asks: ["TSLA 宣布大规模召回，帮我找历史上类似的事件并量一下"] },
    ...fields,
  };
}

type Entry = ReturnType<PanelDeps["loaderEntries"]> extends Iterable<infer E> ? E : never;

/** An active (fiber state 2) row of the face's, `include:<id>`. */
const active = (id: string, extra: Partial<Entry> = {}): Entry =>
  ({ id: `include:${id}`, options: { name: `file:///face/plugins/${id}.mjs` }, fiber: { state: 2 }, ...extra });

/** Deps over fixed data: both analog rows active, `analog_events` registered, the
 *  `source-reader` role read, the `analog-guide` skill listed. */
function fakeDeps(fields: Partial<AbilityDeps> = {}): AbilityDeps {
  return {
    abilities: [ability()],
    roleIds: new Set(["source-reader"]),
    loaderEntries: () => [
      { id: "include", options: { name: "cordis:include" } },
      active("analog-views"),
      active("analog-events"),
    ],
    toolSchemas: () => [
      { name: "analog_events", description: "Measure past events." },
      { name: "bash", description: "run a command" },
    ],
    skills: {
      list: async () => [{ name: "analog-guide", description: "how to read an analog table" }],
      get: async () => undefined,
    },
    cwd: "/repo",
    ...fields,
  };
}

/** The listing's one ability, failing the test when there is not exactly one. */
async function only(deps: AbilityDeps): Promise<AbilityRow> {
  const { abilities } = await abilityListing(deps);
  assert.equal(abilities.length, 1);
  return abilities[0]!;
}

/* ====================================================================== */
/* the state                                                               */
/* ====================================================================== */

const row = (id: string, enabled: boolean, phase: string | null) => ({ id, enabled, phase });
const tool = (name: string, registered: boolean) => ({ name, registered });

test("abilityState: off first - a disabled row or a row with no phase, even beside a failed row", () => {
  assert.equal(abilityState([row("a", false, "active"), row("b", true, "failed")], [tool("t", true)]), "off");
  assert.equal(abilityState([row("a", true, null), row("b", true, "failed")], [tool("t", true)]), "off");
  assert.equal(abilityState([row("a", false, null)], [tool("t", false)]), "off", "a row with no entry");
});

test("abilityState: failed - a failed row, or every row active with a tool not registered", () => {
  assert.equal(abilityState([row("a", true, "active"), row("b", true, "failed")], [tool("t", true)]), "failed");
  assert.equal(abilityState([row("a", true, "loading"), row("b", true, "failed")], [tool("t", true)]), "failed");
  assert.equal(abilityState([row("a", true, "active"), row("b", true, "active")], [tool("t", true), tool("u", false)]), "failed");
});

test("abilityState: on - every row active and every tool registered", () => {
  assert.equal(abilityState([row("a", true, "active"), row("b", true, "active")], [tool("t", true), tool("u", true)]), "on");
});

test("abilityState: starting - otherwise: a loading, pending or unloading row", () => {
  assert.equal(abilityState([row("a", true, "active"), row("b", true, "loading")], [tool("t", true)]), "starting");
  assert.equal(abilityState([row("a", true, "loading")], [tool("t", false)]), "starting",
    "a tool not yet registered while a row loads is not a failure");
  assert.equal(abilityState([row("a", true, "pending")], [tool("t", true)]), "starting");
  assert.equal(abilityState([row("a", true, "unloading")], [tool("t", true)]), "starting");
});

/* ====================================================================== */
/* the listing                                                             */
/* ====================================================================== */

test("abilityListing: a declaration with its rows active and its tool registered is on, every part listed", async () => {
  assert.deepEqual(await only(fakeDeps()), {
    id: "event-analogs",
    name: "Event analogs",
    blurb: "What stocks did after past events like this one, measured against the market",
    icon: "rewind",
    about: "Give Gravit a stock and what just happened to it.\nThe answer is a table of the cases.",
    asks: ["TSLA announced a large recall. Find past events like it and measure them"],
    limits: ["Historical statistics, not a forecast and not a basis for a trade"],
    zh: { name: "事件对标", asks: ["TSLA 宣布大规模召回，帮我找历史上类似的事件并量一下"] },
    state: "on",
    rows: [
      { id: "analog-views", enabled: true, phase: "active" },
      { id: "analog-events", enabled: true, phase: "active" },
    ],
    tools: [{ name: "analog_events", registered: true }],
    roles: [{ id: "source-reader", present: true }],
    skills: [{ name: "analog-guide", present: true }],
  });
});

test("abilityListing: icon and zh are null when the declaration gives none", async () => {
  const listed = await only(fakeDeps({ abilities: [ability({ icon: null, zh: null })] }));
  assert.equal(listed.icon, null);
  assert.equal(listed.zh, null);
});

test("abilityListing: a declared row with no entry is off, enabled false and phase null", async () => {
  const listed = await only(fakeDeps({ loaderEntries: () => [active("analog-views")] }));
  assert.deepEqual(listed.rows, [
    { id: "analog-views", enabled: true, phase: "active" },
    { id: "analog-events", enabled: false, phase: null },
  ]);
  assert.equal(listed.state, "off");
});

test("abilityListing: a disabled entry is enabled false; an entry with no fiber, or a disposed one, has phase null", async () => {
  const disabled = await only(fakeDeps({
    loaderEntries: () => [active("analog-views"), active("analog-events", { disabled: true })],
  }));
  assert.deepEqual(disabled.rows[1], { id: "analog-events", enabled: false, phase: "active" });
  assert.equal(disabled.state, "off");

  const fiberless = await only(fakeDeps({
    loaderEntries: () => [active("analog-views"), { id: "include:analog-events", options: { name: "x" } }],
  }));
  assert.deepEqual(fiberless.rows[1], { id: "analog-events", enabled: true, phase: null });
  assert.equal(fiberless.state, "off");

  const disposed = await only(fakeDeps({
    loaderEntries: () => [active("analog-views"), active("analog-events", { fiber: { state: 4 } })],
  }));
  assert.deepEqual(disposed.rows[1], { id: "analog-events", enabled: true, phase: null });
  assert.equal(disposed.state, "off");
});

test("abilityListing: a row is the entry whose id ends with :<row id>, not one that merely contains it", async () => {
  const listed = await only(fakeDeps({
    loaderEntries: () => [
      active("analog-views-old", { fiber: { state: 3 } }),
      active("group-core:analog-views"),
      active("analog-events"),
    ],
  }));
  assert.deepEqual(listed.rows.map((r) => [r.id, r.phase]), [["analog-views", "active"], ["analog-events", "active"]]);
});

test("abilityListing: a failed row reads failed, and an active ability missing its tool reads failed", async () => {
  const failed = await only(fakeDeps({
    loaderEntries: () => [active("analog-views"), active("analog-events", { fiber: { state: 3 } })],
  }));
  assert.equal(failed.rows[1]!.phase, "failed");
  assert.equal(failed.state, "failed");

  const unregistered = await only(fakeDeps({ toolSchemas: () => [{ name: "bash", description: "run a command" }] }));
  assert.deepEqual(unregistered.tools, [{ name: "analog_events", registered: false }]);
  assert.equal(unregistered.state, "failed");
});

test("abilityListing: a role the face read is present and another is not; likewise a skill the registry lists", async () => {
  const listed = await only(fakeDeps({
    abilities: [ability({ roles: ["source-reader", "cn-reviewer"], skills: ["analog-guide", "read-through-guide"] })],
  }));
  assert.deepEqual(listed.roles, [{ id: "source-reader", present: true }, { id: "cn-reviewer", present: false }]);
  assert.deepEqual(listed.skills, [{ name: "analog-guide", present: true }, { name: "read-through-guide", present: false }]);
  assert.equal(listed.state, "on", "a missing role or skill does not change the state");
});

test("abilityListing: a skill listing that rejects still answers, every skill not present", async () => {
  const listed = await only(fakeDeps({
    skills: { list: async () => { throw new Error("skill registry down"); }, get: async () => undefined },
  }));
  assert.deepEqual(listed.skills, [{ name: "analog-guide", present: false }]);
  assert.equal(listed.state, "on");
});

test("abilityListing: nothing of a row's options and no tool's description reaches the answer", async () => {
  const answer = await abilityListing(fakeDeps({
    loaderEntries: () => [
      { id: "include:analog-views", options: { name: "file:///secret/row.mjs", config: { token: "sk-live-x" } }, fiber: { state: 2 } },
      { id: "include:analog-events", options: { name: "file:///secret/row.mjs", config: { token: "sk-live-x" } }, fiber: { state: 2 } },
    ],
    toolSchemas: () => [{ name: "analog_events", description: "Peers are longs only" }],
  }));
  const wire = JSON.stringify(answer);
  for (const word of ["secret", "sk-live-x", "longs", "description"]) {
    assert.equal(wire.includes(word), false, `the answer holds ${word}`);
  }
  assert.equal(answer.abilities[0]!.state, "on");
});

test("abilityListing: the abilities keep the order given; none answers an empty list", async () => {
  const listed = await abilityListing(fakeDeps({
    abilities: [ability({ id: "zeta" }), ability({ id: "alpha" }), ability({ id: "mid" })],
  }));
  assert.deepEqual(listed.abilities.map((a) => a.id), ["zeta", "alpha", "mid"]);
  assert.deepEqual(await abilityListing(fakeDeps({ abilities: [] })), { abilities: [] });
});

/* ====================================================================== */
/* the route                                                               */
/* ====================================================================== */

function fakeRes(): { out: { status: number; body: string }; res: ServerResponse } {
  const out = { status: 0, body: "" };
  const res = {
    writeHead(status: number) { out.status = status; return res; },
    end(body?: string | Buffer) { out.body = String(body ?? ""); return res; },
  };
  return { out, res: res as unknown as ServerResponse };
}

const getReq = (host = "127.0.0.1:3090", headers: Record<string, string> = {}): IncomingMessage =>
  ({ headers: { host, ...headers }, method: "GET" }) as unknown as IncomingMessage;

/** Panel deps for the plugins route beside it: the reads the fence test touches, inert seams. */
function panelDeps(): PanelDeps {
  const deps = fakeDeps();
  return {
    skills: deps.skills,
    toolSchemas: deps.toolSchemas,
    loaderEntries: deps.loaderEntries,
    cwd: deps.cwd,
    home: "/face-abilities-nowhere",
    registerTool: () => () => {},
    probeAgent: async () => null,
    probeAuth: async () => ({ state: "unknown" }),
    runAgent: async () => { throw new Error("runAgent not injected"); },
  };
}

test("route: one exact GET /data/abilities.json, fenced as /data/plugins.json is, answering the listing", async () => {
  const routes: WebRoute[] = [];
  registerAbilityRoutes({ register: (route) => routes.push(route) }, fakeDeps());
  assert.deepEqual(routes.map((route) => [route.kind, route.path]), [["exact", "/data/abilities.json"]]);
  const abilities = routes[0]!;

  const panels: WebRoute[] = [];
  await registerPanelRoutes({ register: (route) => panels.push(route) }, panelDeps());
  const plugins = panels.find((route) => route.path === "/data/plugins.json")!;

  for (const [req, label] of [
    [getReq("evil.example.com"), "forged Host"],
    [getReq("127.0.0.1:3090", { origin: "http://evil.example.com" }), "cross-origin page, loopback Host"],
    [getReq("127.0.0.1:3090", { "sec-fetch-site": "cross-site" }), "Fetch-Metadata cross-site"],
  ] as const) {
    const refused = fakeRes();
    await abilities.handler(req, refused.res);
    const pluginsRefused = fakeRes();
    await plugins.handler(req, pluginsRefused.res);
    assert.equal(refused.out.status, 403, label);
    assert.equal(pluginsRefused.out.status, 403, label);
    assert.equal(refused.out.body, pluginsRefused.out.body, `${label}: the same refusal body`);
  }

  const served = fakeRes();
  await abilities.handler(getReq(), served.res);
  assert.equal(served.out.status, 200);
  const body = JSON.parse(served.out.body) as { ok: boolean; abilities: AbilityRow[] };
  assert.equal(body.ok, true);
  assert.deepEqual(body.abilities, (await abilityListing(fakeDeps())).abilities);
  assert.deepEqual(Object.keys(body), ["ok", "abilities"]);
});
