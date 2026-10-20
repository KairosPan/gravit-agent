// face/src/desk-tools.ts
/** The desk's two tools: `desk_quotes`, the price now, and `desk_state`, what the desk knows about itself
 * (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md §5.3, §8). Every agent on the `gravit-desk`
 * preset has them; no other agent does.
 *
 * WHERE THEY REGISTER: into each desk agent's OWN tool layer, from one root `agent/created` listener
 * ({@link installDeskTools}). The desk's preset carries an allow mask (src/desk-preset.ts), and a mask
 * filters every layer an agent inherits - the global one and its preset's alike - so a tool registered in
 * either would be hidden from the desk by its own mask, and `tools.restrict` refuses to name a tool its
 * scope does not inherit. An agent's own registrations are the one layer no restriction filters
 * (dsh-tools `view`). So `DESK_ALLOW` does not list these two, Gravit's agents never see them, and the
 * global view - `/data/plugins.json` - never lists them, as with the role tools. They unwind with the
 * agent.
 *
 * WHAT THEY CLOSE OVER: process state main.ts owns, as `agent_<bin>` and `dispatch` close over theirs
 * (src/agents.ts, src/room.ts) - the quote hub main.ts creates once and shares with `/data/quotes`, and
 * the desk's status reader, which src/desk.ts `installDesk` binds to the deps of `GET /data/desk/status`,
 * so the tool and the route agree. `desk_quotes` asks the hub for a snapshot: a REST call for any symbol
 * the hub has not refreshed in the last five seconds. `desk_state` reads the ledger and `OFF` afresh.
 *
 * Both follow the call's cancellation: a cancelled call settles at once. What it started runs on - the
 * hub's refresh is shared with every other reader and keeps its own deadline, so it is not one call's
 * to stop.
 * @module
 */
import { DESK_PRESET } from "./desk-preset.ts";
import type { DeskStatus } from "./desk.ts";
import { HttpError } from "./http.ts";
import type { QuoteHub } from "./quotes.ts";
import type { LiveQuote, QuoteIdentity, QuotePayload } from "./quote-types.ts";

/** Diagnostic label, the same string every other `${BIN}:`-prefixed line in this program uses. */
const BIN = "gravit-face";

/** What a desk tool reads off dsh's ToolRunContext: the call's cancellation. Stated structurally, as
 * src/agents.ts states its own, so the face does not declare dsh-tools as a dependency. */
export interface DeskToolExec {
  signal: AbortSignal;
}

/** The shape `agent.ctx.tools.register` takes - src/agents.ts `AgentToolDefinition`, stated the way
 * src/room.ts states its own; the registry validates the real contract at registration. */
export interface DeskToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: Record<string, unknown>;
    render(args: unknown, value: unknown): { type: "text"; text: string }[];
  };
  timeoutMs: number;
  execute(args: unknown, exec: DeskToolExec): Promise<unknown>;
  presentCall(args: unknown): { card: "generic"; title: string; kind: "read"; rawInput?: unknown };
}

/** What the two tools close over: the quote hub's snapshot, and the desk's status, read on every call. */
export interface DeskToolDeps {
  hub: Pick<QuoteHub, "snapshot">;
  readState: () => Promise<DeskStatus>;
}

/** An agent as {@link installDeskTools} sees it: its id, for the log, and its own context, which the
 * preset registry reads and the tools register through. */
export interface DeskAgentLike {
  id: string;
  ctx: { tools: { register(definition: DeskToolDefinition): unknown } };
}

/** The slice of the booted ROOT context {@link installDeskTools} uses: the `agent/created` event, a
 * serial dispatch that fires on every agent's create and resume once its setup - its preset's mount
 * included - is done, and the preset registry (`composedPreset`, dsh-agent-preset-registry). */
export interface DeskToolsCtxLike {
  on(name: "agent/created", listener: (event: { agent: DeskAgentLike }) => undefined): () => unknown;
  agentPresets: { composedPreset(agentCtx: unknown): string | undefined };
}

/** The most symbols one `desk_quotes` call takes. */
const QUOTES_MAX = 20;

/** A US ticker as `desk_quotes` takes it: a capital, then up to nine capitals, digits, dots or dashes. */
const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** `desk_quotes`' answer when the hub refuses with 429 - its own message is the page's, in Chinese. */
const BUSY = "busy: the quote hub is serving its maximum of clients; try again shortly";

const NUMBER_OR_NULL = { oneOf: [{ type: "number" }, { type: "null" }] };
const STRING_OR_NULL = { oneOf: [{ type: "string" }, { type: "null" }] };

/** One quote as `desk_quotes` answers it: the hub's own fields, its `quote_status` as `status`. */
const QUOTE_SCHEMA = {
  type: "object",
  properties: {
    symbol: { type: "string" },
    price: NUMBER_OR_NULL,
    as_of: STRING_OR_NULL,
    change_pct: NUMBER_OR_NULL,
    prev_close: NUMBER_OR_NULL,
    feed: { type: "string" },
    transport: { type: "string", enum: ["stream", "poll"] },
    status: { type: "string", enum: ["live", "delayed", "stale", "unavailable"] },
  },
  required: ["symbol", "price", "as_of", "change_pct", "prev_close", "feed", "transport", "status"],
  additionalProperties: false,
};

/** The fields of {@link DeskStatus} every status carries, and those it carries when there is something
 * to say. Open, so a field the status gains later is no failure. */
const STATE_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean", const: true },
    pid: { type: "integer" },
    version: { type: "string" },
    bootedAt: { type: "string" },
    uptimeMs: { type: "number" },
    desk: { type: "object" },
    asleep: { type: "array" },
    runs: { type: "array" },
    off: { type: "object" },
    deskSession: { type: "string" },
    turnsToday: { type: "object" },
    telegram: { type: "object" },
    ledgerError: { type: "string" },
  },
  required: ["ok", "pid", "version", "bootedAt", "uptimeMs", "desk", "asleep", "runs", "turnsToday"],
};

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** A value as a refusal names it: JSON, cut at 40 characters - it is the model's own input, echoed back. */
function shown(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** `desk_quotes`' symbols, each once in the order first named. Throws - the registry's error result - on
 * anything but 1 to {@link QUOTES_MAX} tickers that match {@link SYMBOL_RE}. */
function symbolsOf(args: unknown): string[] {
  const symbols: unknown = args !== null && typeof args === "object" ? (args as { symbols?: unknown }).symbols : undefined;
  if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > QUOTES_MAX) {
    throw new Error(`desk_quotes takes symbols: 1 to ${QUOTES_MAX} US tickers`);
  }
  for (const symbol of symbols) {
    if (typeof symbol !== "string" || !SYMBOL_RE.test(symbol)) {
      throw new Error(`desk_quotes takes US tickers in capitals (NVDA, BRK.B); ${shown(symbol)} is not one`);
    }
  }
  return [...new Set(symbols as string[])];
}

/** One hub quote as the desk reads it. `transport` is always set on a payload's quotes; `poll`, the hub's
 * own word for a symbol it is not streaming, stands in should one come without. */
function deskQuote(quote: LiveQuote) {
  return {
    symbol: quote.symbol,
    price: quote.price,
    as_of: quote.as_of,
    change_pct: quote.change_pct,
    prev_close: quote.prev_close,
    feed: quote.feed,
    transport: quote.transport ?? "poll",
    status: quote.quote_status,
  };
}

/**
 * `work()`'s outcome, or `signal`'s reason the moment it aborts: at once, and without starting `work`,
 * when it already has. Whatever `work` started runs on to its own end (see the module header); its
 * outcome is consumed here either way, so a rejection after the abort is never an unhandled one.
 */
function untilCancelled<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const cancel = (): void => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    const settle = (): void => signal.removeEventListener("abort", cancel);
    let pending: Promise<T>;
    try {
      pending = work();
    } catch (error) {
      settle();
      reject(error);
      return;
    }
    pending.then((value) => { settle(); resolve(value); }, (error: unknown) => { settle(); reject(error); });
  });
}

/** The text a desk tool's value is rendered as for the model: the value itself, as JSON. */
const asJson = (_args: unknown, value: unknown): { type: "text"; text: string }[] => [{ type: "text", text: JSON.stringify(value) }];

/**
 * The two desk tools over `deps`, in this order:
 * - `desk_quotes` (`timeoutMs` 15,000): `{ symbols }`, 1 to 20 tickers, each `^[A-Z][A-Z0-9.-]{0,9}$`,
 *   asked of the hub as `us:` assets; answers `{ quotes: [{ symbol, price, as_of, change_pct, prev_close,
 *   feed, transport, status }] }` from the hub's quotes, `status` being its `quote_status` and its UI
 *   `message` left out. A 429 from the hub answers `{ error: "busy: …" }`; a refused argument, and any
 *   other failure, is the call's error.
 * - `desk_state` (`timeoutMs` 5,000): no parameters; answers `await deps.readState()`.
 * @param deps - the quote hub and the status reader.
 */
export function deskToolDefinitions(deps: DeskToolDeps): DeskToolDefinition[] {
  const quotes: DeskToolDefinition = {
    name: "desk_quotes",
    description:
      "The price now for 1 to 20 US stocks, from the face's live quote hub (Alpaca). Each quote: price (null when unavailable); " +
      "as_of, the price's exchange time in ISO-8601 UTC; change_pct and prev_close, against the previous close; feed (iex, sip or " +
      "delayed_sip); transport (stream or poll); status (live, delayed, stale or unavailable). The price now, never backtest evidence.",
    parameters: {
      type: "object",
      properties: {
        symbols: {
          type: "array",
          items: { type: "string", pattern: SYMBOL_RE.source },
          minItems: 1,
          maxItems: QUOTES_MAX,
          description: "US tickers in capitals, e.g. NVDA, BRK.B",
        },
      },
      required: ["symbols"],
      additionalProperties: false,
    },
    output: {
      schema: {
        oneOf: [
          { type: "object", properties: { quotes: { type: "array", items: QUOTE_SCHEMA } }, required: ["quotes"], additionalProperties: false },
          { type: "object", properties: { error: { type: "string" } }, required: ["error"], additionalProperties: false },
        ],
      },
      render: asJson,
    },
    timeoutMs: 15_000,
    async execute(args, exec) {
      const assets: QuoteIdentity[] = symbolsOf(args).map((symbol) => ({ id: `us:${symbol}`, market: "us", symbol }));
      let payload: QuotePayload;
      try {
        payload = await untilCancelled(exec.signal, () => deps.hub.snapshot(assets));
      } catch (error) {
        if (error instanceof HttpError && error.status === 429) return { error: BUSY };
        throw error;
      }
      return { quotes: payload.quotes.map(deskQuote) };
    },
    presentCall(args) {
      const symbols = (args !== null && typeof args === "object" ? (args as { symbols?: unknown }).symbols : undefined);
      const named = Array.isArray(symbols) ? symbols.filter((symbol): symbol is string => typeof symbol === "string") : [];
      return { card: "generic", title: named.length === 0 ? "Quotes" : `Quotes: ${named.join(", ")}`, kind: "read" };
    },
  };
  const state: DeskToolDefinition = {
    name: "desk_state",
    description:
      "What the desk knows about itself, read afresh: this face's pid, version, boot time and uptime; whether the desk is enabled, " +
      "and its directory; this run's sleep gaps; every run in the ledger (a lost run ended without a clean shutdown); the pause in " +
      "force (off), if any; the desk conversation's session id; today's desk turns and their tokens.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: STATE_SCHEMA, render: asJson },
    timeoutMs: 5_000,
    execute: (_args, exec) => untilCancelled(exec.signal, () => deps.readState()),
    presentCall: () => ({ card: "generic", title: "Desk state", kind: "read" }),
  };
  return [quotes, state];
}

/**
 * Give every `gravit-desk` agent `definitions`, in its own tool layer: one listener on the ROOT
 * context's `agent/created`, which sees every agent's create and resume - the face's, a browser's
 * `session/create` with `agentPreset: "gravit-desk"`, a controller's resume.
 *
 * The listener is synchronous and never throws: `agent/created` is a serial, awaited dispatch, and a
 * throw or rejection there fails the agent's creation (src/bot-runtime.ts says the same). An agent whose
 * preset `ctx.agentPresets.composedPreset(agent.ctx)` reads as `gravit-desk` - the registry read late,
 * so a reloaded registry is followed - and that it has not seen gets `agent.ctx.tools.register(d)` for
 * each definition. It is marked seen first, in a `WeakSet`, so a registration that fails is logged once
 * and never retried, and none is made twice; any failure, the registry's included, is one
 * `gravit-face:` line through `log`.
 * @param ctx - the booted ROOT context.
 * @param definitions - the tools to give, {@link deskToolDefinitions}'s.
 * @param options - `log`, where a failure is written (default `console.error`), for tests.
 * @returns the disposer that removes the listener. Tools already registered stay with their agents and
 *   unwind with them.
 */
export function installDeskTools(
  ctx: DeskToolsCtxLike,
  definitions: DeskToolDefinition[],
  options: { log?: (line: string) => void } = {},
): () => void {
  const log = options.log ?? ((line: string) => console.error(line));
  const equipped = new WeakSet<DeskAgentLike>();
  const off = ctx.on("agent/created", ({ agent }) => {
    try {
      if (equipped.has(agent) || ctx.agentPresets.composedPreset(agent.ctx) !== DESK_PRESET) return undefined;
      equipped.add(agent);
      for (const definition of definitions) agent.ctx.tools.register(definition);
    } catch (error) {
      log(`${BIN}: the desk tools were not registered for agent ${agent.id}: ${messageOf(error)}`);
    }
    return undefined;
  });
  return () => {
    off();
  };
}
