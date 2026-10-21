// face/tests/desk-tools.test.ts
/** The desk's two tools (src/desk-tools.ts), offline: which agents get them, what they answer, and how
 * `installDesk` carries them. Every root context, agent and hub here is a fake - the registration's own
 * contract is what is under test: one root `agent/created` listener that never throws, and one sweep of
 * the agents already live, registering both tools into a `gravit-desk` agent's own tool layer once. That
 * a real tree shows them to the desk's sessions and to nobody else's is the smokes' to prove. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESK_PRESET } from "../src/desk-preset.ts";
import { appendEvent, installDesk, type DeskRun, type DeskStatus } from "../src/desk.ts";
import { deskToolDefinitions, installDeskTools, type DeskAgentLike, type DeskGuardCtxLike, type DeskToolDefinition } from "../src/desk-tools.ts";
import { HttpError } from "../src/http.ts";
import type { LiveQuote, QuoteIdentity, QuotePayload } from "../src/quote-types.ts";
import { recorder } from "./route-recorder.ts";

type Listener = (event: { agent: DeskAgentLike }) => undefined;

/** A root context with the event the desk tools listen to, the live agents `live`, and a preset registry
 * that reads a fake agent's preset off its context. `presetError` makes the registry throw and `listError`
 * the agent listing. `calls` records `on("agent/created")` and `list` in the order they came; `create` plays
 * one agent's creation through every listener and hands back what each answered. The desk guard, which
 * `installDesk` installs beside the tools, lands apart - its `tools/pre-execute` listener in `guards`, its
 * backstop's `tools.guard`, armed through `inject`, in `backstops` - and tests/desk-guard.test.ts drives it. */
function fakeRoot(options: { presetError?: Error; listError?: Error; live?: DeskAgentLike[] } = {}) {
  const listeners: Listener[] = [];
  const guards: unknown[] = [];
  const backstops: unknown[] = [];
  const calls: string[] = [];
  const ctx: DeskGuardCtxLike = {
    on(name: string, listener: (...args: never[]) => unknown) {
      const list: unknown[] = name === "tools/pre-execute" ? guards : listeners;
      if (name !== "tools/pre-execute") {
        calls.push("on");
        assert.equal(name, "agent/created");
      }
      list.push(listener);
      return () => {
        const at = list.indexOf(listener);
        if (at >= 0) list.splice(at, 1);
        return at >= 0;
      };
    },
    inject(_deps, callback) {
      const owned: unknown[] = [];
      callback({ get: () => ({ guard: (check: unknown) => { backstops.push(check); owned.push(check); return () => {}; } }) });
      return {
        dispose: async () => {
          for (const check of owned.splice(0)) backstops.splice(backstops.indexOf(check), 1);
        },
      };
    },
    agents: {
      list() {
        calls.push("list");
        if (options.listError !== undefined) throw options.listError;
        return options.live ?? [];
      },
    },
    agentPresets: {
      composedPreset(agentCtx) {
        if (options.presetError !== undefined) throw options.presetError;
        return (agentCtx as { preset?: string }).preset;
      },
    },
  };
  return { ctx, listeners, guards, backstops, calls, create: (agent: DeskAgentLike): unknown[] => listeners.map((listener) => listener({ agent })) };
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

/* bootFace serves unary `/api` - `session/create` among it - before main.ts reaches `installDesk`, so a
 * desk agent can be live before the listener exists. */
test("a desk agent live before install gets both tools from the sweep, once; one created after install gets them from the listener", () => {
  const before = fakeAgent("desk-before", DESK_PRESET);
  const gravit = fakeAgent("gravit-before", "gravit");
  const composing = fakeAgent("desk-composing", undefined);
  const root = fakeRoot({ live: [before.agent, gravit.agent, composing.agent] });
  installDeskTools(root.ctx, deskToolDefinitions({ hub: fakeHub().hub, readState: readStatus }));
  assert.deepEqual(root.calls, ["on", "list"], "the listener first, then the sweep, in the same tick: no agent falls between them");
  assert.deepEqual(before.names(), ["desk_quotes", "desk_state"], "a desk agent already live is swept");
  assert.deepEqual(gravit.names(), [], "a Gravit agent is not");
  assert.deepEqual(composing.names(), [], "nor one whose preset is not mounted yet");

  root.create(before.agent);
  assert.deepEqual(before.names(), ["desk_quotes", "desk_state"], "its creation landing after the sweep adds nothing: exactly once");
  composing.agent.ctx.preset = DESK_PRESET;
  root.create(composing.agent);
  assert.deepEqual(composing.names(), ["desk_quotes", "desk_state"], "the listener equips it once its creation is announced");
  const after = fakeAgent("desk-after", DESK_PRESET);
  root.create(after.agent);
  assert.deepEqual(after.names(), ["desk_quotes", "desk_state"], "and one created after install gets them from the listener");
});

test("the listener never throws: a failing register is swallowed and logged", () => {
  const root = fakeRoot();
  const lines: string[] = [];
  const log = (line: string): void => void lines.push(line);
  installDeskTools(root.ctx, deskToolDefinitions({ hub: fakeHub().hub, readState: readStatus }), { log });
  const broken = {
    id: "desk-broken",
    ctx: { preset: DESK_PRESET, tools: { register(): never { throw new Error('tool "desk_quotes" is already registered'); } } },
  };
  assert.deepEqual(root.create(broken), [undefined], "a throw would have failed the agent's creation");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^gravit-face: .*desk-broken.*tool "desk_quotes" is already registered/);

  /* A preset registry that cannot answer is the same: logged, never thrown. */
  const orphan = fakeRoot({ presetError: new Error("agentPresets is not in the tree") });
  installDeskTools(orphan.ctx, deskToolDefinitions({ hub: fakeHub().hub, readState: readStatus }), { log });
  const agent = fakeAgent("desk-orphan", DESK_PRESET);
  assert.deepEqual(orphan.create(agent.agent), [undefined]);
  assert.deepEqual(agent.names(), []);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^gravit-face: .*desk-orphan.*agentPresets is not in the tree/);

  /* And so is a sweep that cannot list the live agents; the listener stays for what is created after. */
  const blind = fakeRoot({ listError: new Error("agents is not in the tree") });
  assert.doesNotThrow(() => installDeskTools(blind.ctx, deskToolDefinitions({ hub: fakeHub().hub, readState: readStatus }), { log }));
  assert.equal(lines.length, 3);
  assert.match(lines[2], /^gravit-face: .*agents is not in the tree/);
  const late = fakeAgent("desk-late", DESK_PRESET);
  blind.create(late.agent);
  assert.deepEqual(late.names(), ["desk_quotes", "desk_state"]);
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

  const twenty = ["BRK.B", "BF-B", ...Array.from({ length: 18 }, (_, i) => `S${String.fromCharCode(65 + i)}`)];
  await quotes.execute({ symbols: twenty }, exec());
  assert.deepEqual(asked[1].map((asset) => asset.id), twenty.map((symbol) => `us:${symbol}`), "twenty is the cap, dots and dashes included");
  await quotes.execute({ symbols: ["NVDA", "AAPL", "NVDA"] }, exec());
  assert.deepEqual(asked[2].map((asset) => asset.symbol), ["NVDA", "AAPL"], "a symbol named twice is asked for once");

  const busy = byName(deskToolDefinitions({
    hub: { async snapshot(): Promise<QuotePayload> { throw new HttpError(429, "行情请求过多，请稍后重试。"); } },
    readState: readStatus,
  }), "desk_quotes");
  const refusal = await busy.execute({ symbols: ["NVDA"] }, exec());
  assert.deepEqual(refusal, { error: "busy: the quote hub is serving its maximum of clients; try again shortly" });
  assert.deepEqual(busy.output.render({ symbols: ["NVDA"] }, refusal),
    [{ type: "text", text: "busy: the quote hub is serving its maximum of clients; try again shortly" }]);
  const failing = byName(deskToolDefinitions({
    hub: { async snapshot(): Promise<QuotePayload> { throw new HttpError(503, "quote service stopped"); } },
    readState: readStatus,
  }), "desk_quotes");
  await assert.rejects(failing.execute({ symbols: ["NVDA"] }, exec()), /quote service stopped/, "any other failure is the call's error");

  assert.deepEqual(quotes.presentCall({ symbols: ["NVDA", "AAPL"] }), { card: "generic", title: "Quotes: NVDA, AAPL", kind: "read" });
  assert.deepEqual(quotes.presentCall("junk"), { card: "generic", title: "Quotes", kind: "read" });
});

test("desk_quotes renders one line per quote, its time as the desk quotes it: the feed, New York's clock, a date when not today", async () => {
  /* 23:00 ET on Tuesday 2026-10-20 (EDT) - already the 21st in UTC. */
  const now = Date.parse("2026-10-21T03:00:00.000Z");
  const quote = (symbol: string, fields: Partial<LiveQuote>): LiveQuote => ({ ...NVDA, id: `us:${symbol}`, symbol, ...fields });
  const { hub } = fakeHub([
    NVDA,
    quote("AAPL", { price: 229.5, prev_close: 230.7, change_pct: -0.52, as_of: "2026-10-19T19:59:59Z", transport: "poll", quote_status: "stale" }),
    quote("MSFT", { price: 410.25, prev_close: null, change_pct: null, as_of: "2026-10-21T02:30:00Z", feed: "delayed_sip", quote_status: "delayed" }),
    quote("ZZZ", { price: null, prev_close: null, change_pct: null, as_of: null, feed: "", transport: "poll", quote_status: "unavailable" }),
  ]);
  const quotes = byName(deskToolDefinitions({ hub, readState: readStatus, now: () => now }), "desk_quotes");
  const value = await quotes.execute({ symbols: ["NVDA", "AAPL", "MSFT", "ZZZ"] }, exec());
  assert.deepEqual(quotes.output.render({ symbols: ["NVDA", "AAPL", "MSFT", "ZZZ"] }, value), [{
    type: "text",
    text: [
      "NVDA 182.31, +1.20% vs prev close 180.15 | IEX 15:21:03 ET | stream | live",
      "AAPL 229.5, -0.52% vs prev close 230.7 | IEX 2026-10-19 15:59:59 ET | poll | stale",
      "MSFT 410.25 | DELAYED_SIP 22:30:00 ET | stream | delayed",
      "ZZZ no price | poll | unavailable",
    ].join("\n"),
  }], "today is New York's: MSFT's 02:30 UTC on the 21st is 22:30 on the 20th there, and carries no date");
  assert.deepEqual((value as { quotes: { as_of: string | null }[] }).quotes.map((q) => q.as_of),
    ["2026-10-20T19:21:03.123456789Z", "2026-10-19T19:59:59Z", "2026-10-21T02:30:00Z", null], "the value keeps the hub's own times");
});

test("desk_state returns readState(), its runs cut to the last ten and counted in runsInLedger", async () => {
  let reads = 0;
  const runs: DeskRun[] = Array.from({ length: 12 }, (_, i) => ({ bootedAt: `2026-10-${String(i + 1).padStart(2, "0")}T13:00:00.000Z`, pid: 100 + i, lost: false }));
  const status: DeskStatus = { ...STATUS, runs };
  const state = byName(deskToolDefinitions({ hub: fakeHub().hub, readState: async () => { reads += 1; return status; } }), "desk_state");
  assert.equal(state.timeoutMs, 5_000);
  assert.deepEqual(state.parameters, { type: "object", properties: {}, additionalProperties: false }, "no parameters");
  const value = await state.execute({}, exec());
  assert.deepEqual(value, { ...status, runs: runs.slice(-10), runsInLedger: 12 });
  assert.equal(status.runs.length, 12, "the status read is not cut in place");
  await state.execute({}, exec());
  assert.equal(reads, 2, "read afresh on every call");
  const few = byName(deskToolDefinitions({ hub: fakeHub().hub, readState: readStatus }), "desk_state");
  assert.deepEqual(await few.execute({}, exec()), { ...STATUS, runsInLedger: 0 }, "ten or fewer: every one");
  assert.deepEqual(state.output.render({}, value), [{ type: "text", text: JSON.stringify(value) }]);
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

/* main.ts's `installFailLoud` turns an unhandled rejection into a process exit: a snapshot that fails
 * after its call gave up must still be consumed. */
test("a hub that fails after its call was cancelled leaves no unhandled rejection", async () => {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown): void => void seen.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    let fail!: (error: unknown) => void;
    const late = new Promise<QuotePayload>((_, reject) => { fail = reject; });
    const quotes = byName(deskToolDefinitions({ hub: { snapshot: () => late }, readState: readStatus }), "desk_quotes");
    const controller = new AbortController();
    const pending = quotes.execute({ symbols: ["NVDA"] }, exec(controller.signal));
    controller.abort(new Error("turn cancelled"));
    await assert.rejects(pending, /turn cancelled/);
    fail(new HttpError(503, "the hub failed after the call was cancelled"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(seen, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("installDesk installs the desk tools whatever enabled says, desk_state reads what the status route reads, and dispose removes the listener", async (t) => {
  const watch = { setInterval: () => 1, clearInterval: () => {} };
  /* Every home made here is removed after the test; the guard's install line goes to a log that drops it. */
  const homes: string[] = [];
  t.after(() => Promise.all(homes.map((dir) => rm(dir, { recursive: true, force: true }))));
  const freshHome = async (): Promise<string> => {
    const made = await mkdtemp(join(tmpdir(), "face-desk-tools-"));
    homes.push(made);
    return made;
  };
  const quiet = (): void => {};
  for (const enabled of [false, true]) {
    const home = await freshHome();
    /* Twelve runs already in the ledger, so the tool's cut shows. */
    for (let i = 0; i < 12; i++) {
      const pid = 100 + i;
      await appendEvent(home, { t: `2026-10-${String(i + 1).padStart(2, "0")}T13:00:00.000Z`, kind: "boot", pid, version: "v", deskEnabled: true });
      await appendEvent(home, { t: `2026-10-${String(i + 1).padStart(2, "0")}T21:00:00.000Z`, kind: "shutdown", pid, code: 0 });
    }
    const root = fakeRoot();
    const rec = recorder();
    const at = Date.parse("2026-10-20T14:00:00.000Z");
    const desk = installDesk(rec, { home, enabled, now: () => at, version: "v", watch, ctx: root.ctx, hub: fakeHub().hub, root: "/repo", log: quiet });
    assert.equal(root.listeners.length, 1, `the listener is installed (enabled: ${enabled})`);
    assert.equal(root.guards.length, 1, `and the desk guard beside it (enabled: ${enabled})`);
    assert.equal(root.backstops.length, 1, `with its backstop (enabled: ${enabled})`);
    const agent = fakeAgent(`desk-${enabled}`, DESK_PRESET);
    root.create(agent.agent);
    assert.deepEqual(agent.names(), ["desk_quotes", "desk_state"]);
    await desk.ready;
    const fromTool = await byName(agent.registered, "desk_state").execute({}, exec()) as DeskStatus & { runsInLedger: number };
    const fromRoute = JSON.parse(await rec.call("/data/desk/status")) as { status: number; body: DeskStatus };
    assert.equal(fromRoute.status, 200);
    const { runs: toolRuns, runsInLedger, ...toolRest } = fromTool;
    const { runs: routeRuns, ...routeRest } = fromRoute.body;
    assert.deepEqual(toolRest, routeRest, `the tool and GET /data/desk/status agree on every field but runs (enabled: ${enabled})`);
    assert.equal(routeRuns.length, enabled ? 13 : 12, "the route answers every run");
    assert.deepEqual(toolRuns, routeRuns.slice(-10), "the tool, the route's last ten");
    assert.equal(runsInLedger, routeRuns.length);
    await desk.dispose(0);
    assert.equal(root.listeners.length, 0, `dispose removes the listener (enabled: ${enabled})`);
    assert.equal(root.guards.length, 0, `and the guard (enabled: ${enabled})`);
    assert.equal(root.backstops.length, 0, `and its backstop (enabled: ${enabled})`);
  }
  /* The tools need both: a context with no hub installs no tools - only the desk guard, which needs no hub. */
  const root = fakeRoot();
  const guardOnly = installDesk(recorder(), { home: await freshHome(), enabled: false, ctx: root.ctx, root: "/repo", log: quiet });
  assert.equal(root.listeners.length, 0, "no tools without a hub");
  assert.equal(root.guards.length, 1, "but the guard");
  assert.equal(root.backstops.length, 1, "and its backstop");
  await guardOnly.dispose(0);
});
