// face/tests/desk-tools.test.ts
/** The desk's two tools (src/desk-tools.ts), offline: which agents get them, what they answer, and how
 * `installDesk` carries them. Every root context, agent and hub here is a fake - the registration's own
 * contract is what is under test: one root `agent/created` listener that never throws, registering both
 * tools into a `gravit-desk` agent's own tool layer once. That a real tree shows them to the desk's
 * sessions and to nobody else's is the smokes' to prove. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESK_PRESET } from "../src/desk-preset.ts";
import { installDesk, type DeskStatus } from "../src/desk.ts";
import { deskToolDefinitions, installDeskTools, type DeskAgentLike, type DeskToolDefinition, type DeskToolsCtxLike } from "../src/desk-tools.ts";
import { HttpError } from "../src/http.ts";
import type { LiveQuote, QuoteIdentity, QuotePayload } from "../src/quote-types.ts";
import { recorder } from "./route-recorder.ts";

type Listener = (event: { agent: DeskAgentLike }) => undefined;

/** A root context with the one event the desk tools listen to, and a preset registry that reads a fake
 * agent's preset off its context, or throws `presetError` when one is given. `create` plays one agent's
 * creation through every listener and hands back what each answered. */
function fakeRoot(presetError?: Error) {
  const listeners: Listener[] = [];
  const ctx: DeskToolsCtxLike = {
    on(name, listener) {
      assert.equal(name, "agent/created");
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
        return at >= 0;
      };
    },
    agentPresets: {
      composedPreset(agentCtx) {
        if (presetError !== undefined) throw presetError;
        return (agentCtx as { preset?: string }).preset;
      },
    },
  };
  return { ctx, listeners, create: (agent: DeskAgentLike): unknown[] => listeners.map((listener) => listener({ agent })) };
}

/** An agent joined to `preset` (none when `undefined`), whose own tool layer records what is registered in it. */
function fakeAgent(id: string, preset: string | undefined) {
  const registered: DeskToolDefinition[] = [];
  const agent = { id, ctx: { preset, tools: { register(definition: DeskToolDefinition) { registered.push(definition); return () => {}; } } } };
  return { agent, registered, names: () => registered.map((definition) => definition.name) };
}

/** A hub whose snapshot answers `quotes`, recording every asset list it is asked for. */
function fakeHub(quotes: LiveQuote[] = []) {
  const asked: QuoteIdentity[][] = [];
  const hub = {
    async snapshot(assets: QuoteIdentity[]): Promise<QuotePayload> {
      asked.push(assets);
      return { ok: true, generated_at: "2026-10-20T19:21:04.000Z", quotes, providers: [] };
    },
  };
  return { hub, asked };
}

/** The hub's quote for NVDA as its payload carries one: every field set, and a UI message the tool leaves out. */
const NVDA: LiveQuote = {
  id: "us:NVDA", market: "us", symbol: "NVDA", transport: "stream",
  price: 182.31, prev_close: 180.15, change: 2.16, change_pct: 1.199, volume: 1_204_331,
  as_of: "2026-10-20T19:21:03.123456789Z", received_at: "2026-10-20T19:21:03.200Z", volume_as_of: "2026-10-20T19:21:00Z",
  source: "Alpaca", feed: "iex", basis: "previous_close", quote_status: "live", market_status: "open",
  message: "最近成交时间较早，请留意行情时间。",
};

const STATUS: DeskStatus = {
  ok: true, pid: 4242, version: "0.2.0-rc.2", bootedAt: "2026-10-20T13:00:00.000Z", uptimeMs: 3_600_000,
  desk: { enabled: true, dir: "/home/face/desk" }, asleep: [], runs: [],
  turnsToday: { count: 0, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
};

const readStatus = async (): Promise<DeskStatus> => STATUS;

/** A call's run context: only its cancellation, which is all the desk tools read. */
const exec = (signal: AbortSignal = new AbortController().signal) => ({ signal });

function byName(definitions: readonly DeskToolDefinition[], name: string): DeskToolDefinition {
  const found = definitions.find((definition) => definition.name === name);
  assert.ok(found, `no ${name} among ${definitions.map((definition) => definition.name).join(", ")}`);
  return found;
}

test("a gravit-desk agent gets both tools once; a Gravit agent gets none", () => {
  const root = fakeRoot();
  const definitions = deskToolDefinitions({ hub: fakeHub().hub, readState: readStatus });
  const dispose = installDeskTools(root.ctx, definitions);
  assert.equal(root.listeners.length, 1, "one root agent/created listener");

  const desk = fakeAgent("desk-1", DESK_PRESET);
  assert.deepEqual(root.create(desk.agent), [undefined], "the listener answers undefined: nothing for the serial dispatch to wait on");
  root.create(desk.agent);
  assert.deepEqual(desk.names(), ["desk_quotes", "desk_state"], "both tools, into the agent's own layer, exactly once");
  assert.deepEqual(desk.registered, definitions, "the definitions themselves");

  const gravit = fakeAgent("gravit-1", "gravit");
  const bare = fakeAgent("bare-1", undefined);
  root.create(gravit.agent);
  root.create(bare.agent);
  assert.deepEqual(gravit.names(), [], "Gravit's agents never get them");
  assert.deepEqual(bare.names(), [], "nor does an agent joined to no preset");

  dispose();
  assert.equal(root.listeners.length, 0, "the disposer removes the listener");
  const later = fakeAgent("desk-2", DESK_PRESET);
  root.create(later.agent);
  assert.deepEqual(later.names(), [], "and a desk agent created after it gets nothing");
});

test("the listener never throws: a failing register is swallowed and logged", () => {
  const root = fakeRoot();
  const lines: string[] = [];
  installDeskTools(root.ctx, deskToolDefinitions({ hub: fakeHub().hub, readState: readStatus }), { log: (line) => lines.push(line) });
  const broken = {
    id: "desk-broken",
    ctx: { preset: DESK_PRESET, tools: { register(): never { throw new Error('tool "desk_quotes" is already registered'); } } },
  };
  assert.deepEqual(root.create(broken), [undefined], "a throw would have failed the agent's creation");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^gravit-face: .*desk-broken.*tool "desk_quotes" is already registered/);

  /* A preset registry that cannot answer is the same: logged, never thrown. */
  const orphan = fakeRoot(new Error("agentPresets is not in the tree"));
  installDeskTools(orphan.ctx, deskToolDefinitions({ hub: fakeHub().hub, readState: readStatus }), { log: (line) => lines.push(line) });
  const agent = fakeAgent("desk-orphan", DESK_PRESET);
  assert.deepEqual(orphan.create(agent.agent), [undefined]);
  assert.deepEqual(agent.names(), []);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^gravit-face: .*desk-orphan.*agentPresets is not in the tree/);
});

test("desk_quotes validates, caps at 20, maps the hub's fields and survives 429", async () => {
  const { hub, asked } = fakeHub([NVDA]);
  const quotes = byName(deskToolDefinitions({ hub, readState: readStatus }), "desk_quotes");
  assert.equal(quotes.timeoutMs, 15_000);

  const refused: [unknown, RegExp][] = [
    [{ symbols: ["nvda"] }, /"nvda"/],
    [{ symbols: ["NVDA", "BRK B"] }, /"BRK B"/],
    [{ symbols: ["ABCDEFGHIJK"] }, /"ABCDEFGHIJK"/],
    [{ symbols: [7] }, /7/],
    [{ symbols: Array.from({ length: 21 }, (_, i) => `S${String.fromCharCode(65 + i)}`) }, /1 to 20/],
    [{ symbols: [] }, /1 to 20/],
    [{ symbols: "NVDA" }, /1 to 20/],
    [{}, /1 to 20/],
    [null, /1 to 20/],
  ];
  for (const [args, why] of refused) await assert.rejects(quotes.execute(args, exec()), why, JSON.stringify(args));
  assert.equal(asked.length, 0, "a refused call never reaches the hub");

  const value = await quotes.execute({ symbols: ["NVDA"] }, exec());
  assert.deepEqual(value, {
    quotes: [{ symbol: "NVDA", price: 182.31, as_of: "2026-10-20T19:21:03.123456789Z", change_pct: 1.199, prev_close: 180.15, feed: "iex", transport: "stream", status: "live" }],
  }, "the hub's fields, its quote_status as status, and none of its UI message");
  assert.deepEqual(asked, [[{ id: "us:NVDA", market: "us", symbol: "NVDA" }]]);
  assert.deepEqual(quotes.output.render({ symbols: ["NVDA"] }, value), [{ type: "text", text: JSON.stringify(value) }]);

  const twenty = ["BRK.B", "BF-B", ...Array.from({ length: 18 }, (_, i) => `S${String.fromCharCode(65 + i)}`)];
  await quotes.execute({ symbols: twenty }, exec());
  assert.deepEqual(asked[1].map((asset) => asset.id), twenty.map((symbol) => `us:${symbol}`), "twenty is the cap, dots and dashes included");
  await quotes.execute({ symbols: ["NVDA", "AAPL", "NVDA"] }, exec());
  assert.deepEqual(asked[2].map((asset) => asset.symbol), ["NVDA", "AAPL"], "a symbol named twice is asked for once");

  const busy = byName(deskToolDefinitions({
    hub: { async snapshot(): Promise<QuotePayload> { throw new HttpError(429, "行情请求过多，请稍后重试。"); } },
    readState: readStatus,
  }), "desk_quotes");
  assert.deepEqual(await busy.execute({ symbols: ["NVDA"] }, exec()),
    { error: "busy: the quote hub is serving its maximum of clients; try again shortly" });
  const failing = byName(deskToolDefinitions({
    hub: { async snapshot(): Promise<QuotePayload> { throw new HttpError(503, "quote service stopped"); } },
    readState: readStatus,
  }), "desk_quotes");
  await assert.rejects(failing.execute({ symbols: ["NVDA"] }, exec()), /quote service stopped/, "any other failure is the call's error");

  assert.deepEqual(quotes.presentCall({ symbols: ["NVDA", "AAPL"] }), { card: "generic", title: "Quotes: NVDA, AAPL", kind: "read" });
  assert.deepEqual(quotes.presentCall("junk"), { card: "generic", title: "Quotes", kind: "read" });
});

test("desk_state returns readState()", async () => {
  let reads = 0;
  const state = byName(deskToolDefinitions({ hub: fakeHub().hub, readState: async () => { reads += 1; return STATUS; } }), "desk_state");
  assert.equal(state.timeoutMs, 5_000);
  assert.deepEqual(state.parameters, { type: "object", properties: {}, additionalProperties: false }, "no parameters");
  assert.deepEqual(await state.execute({}, exec()), STATUS);
  assert.deepEqual(await state.execute({}, exec()), STATUS);
  assert.equal(reads, 2, "read afresh on every call");
  assert.deepEqual(state.output.render({}, STATUS), [{ type: "text", text: JSON.stringify(STATUS) }]);
  assert.deepEqual(state.presentCall({}), { card: "generic", title: "Desk state", kind: "read" });
});

test("a cancelled call settles at once, whatever the hub or the ledger is doing", async () => {
  let snapshots = 0;
  const never = new Promise<never>(() => {});
  const definitions = deskToolDefinitions({ hub: { snapshot: () => { snapshots += 1; return never; } }, readState: () => never });
  const controller = new AbortController();
  const pending = byName(definitions, "desk_quotes").execute({ symbols: ["NVDA"] }, exec(controller.signal));
  controller.abort(new Error("turn cancelled"));
  await assert.rejects(pending, /turn cancelled/);
  assert.equal(snapshots, 1);
  await assert.rejects(byName(definitions, "desk_quotes").execute({ symbols: ["NVDA"] }, exec(AbortSignal.abort(new Error("already cancelled")))), /already cancelled/);
  assert.equal(snapshots, 1, "a call cancelled before it starts never reaches the hub");
  await assert.rejects(byName(definitions, "desk_state").execute({}, exec(AbortSignal.abort(new Error("already cancelled")))), /already cancelled/);
});

test("installDesk installs the desk tools whatever enabled says, desk_state reads what the status route reads, and dispose removes the listener", async () => {
  const watch = { setInterval: () => 1, clearInterval: () => {} };
  for (const enabled of [false, true]) {
    const home = await mkdtemp(join(tmpdir(), "face-desk-tools-"));
    const root = fakeRoot();
    const rec = recorder();
    const at = Date.parse("2026-10-20T14:00:00.000Z");
    const desk = installDesk(rec, { home, enabled, now: () => at, version: "v", watch, ctx: root.ctx, hub: fakeHub().hub });
    assert.equal(root.listeners.length, 1, `the listener is installed (enabled: ${enabled})`);
    const agent = fakeAgent(`desk-${enabled}`, DESK_PRESET);
    root.create(agent.agent);
    assert.deepEqual(agent.names(), ["desk_quotes", "desk_state"]);
    await desk.ready;
    const fromTool = await byName(agent.registered, "desk_state").execute({}, exec());
    const fromRoute = JSON.parse(await rec.call("/data/desk/status")) as { status: number; body: unknown };
    assert.equal(fromRoute.status, 200);
    assert.deepEqual(fromTool, fromRoute.body, `the tool and GET /data/desk/status agree (enabled: ${enabled})`);
    await desk.dispose(0);
    assert.equal(root.listeners.length, 0, `dispose removes the listener (enabled: ${enabled})`);
  }
  /* Both are needed: a context with no hub installs nothing. */
  const root = fakeRoot();
  installDesk(recorder(), { home: await mkdtemp(join(tmpdir(), "face-desk-tools-")), enabled: false, ctx: root.ctx });
  assert.equal(root.listeners.length, 0);
});
