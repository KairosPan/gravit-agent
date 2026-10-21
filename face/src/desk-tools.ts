// face/src/desk-tools.ts
/** The desk's two tools: `desk_quotes`, the price now, and `desk_state`, what the desk knows about itself
 * (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md §5.3, §8). Every agent on the `gravit-desk`
 * preset has them; no other agent does.
 *
 * WHERE THEY REGISTER: into each desk agent's OWN tool layer, from one root `agent/created` listener and
 * one sweep of the agents already live ({@link installDeskTools}). The desk's preset carries an allow mask
 * (src/desk-preset.ts), and a mask filters every layer an agent inherits - the global one and its
 * preset's alike - so a tool registered in either would be hidden from the desk by its own mask, and
 * `tools.restrict` refuses to name a tool its scope does not inherit. An agent's own registrations are
 * the one layer no restriction filters (dsh-tools `view`). So `DESK_ALLOW` does not list these two,
 * Gravit's agents never see them, and the global view - `/data/plugins.json` - never lists them, as with
 * the role tools. They unwind with the agent.
 *
 * WHAT THEY CLOSE OVER: process state main.ts owns, as `agent_<bin>` and `dispatch` close over theirs
 * (src/agents.ts, src/room.ts) - the quote hub main.ts creates once and shares with `/data/quotes`, and
 * the desk's status reader, which src/desk.ts `installDesk` binds to the deps of `GET /data/desk/status`,
 * so the tool and the route agree on all but `runs`, which the tool cuts to the last ten. `desk_quotes`
 * asks the hub for a snapshot: a REST call for any symbol the hub has not refreshed in the last five
 * seconds. `desk_state` reads the ledger and `OFF` afresh.
 *
 * WHAT THE MODEL READS: `desk_quotes` renders one line per quote, its time as the desk contract quotes
 * one (dsh/profile/desk.md: `IEX 15:21:03 ET`), so the model never converts a UTC time itself; its value
 * keeps the hub's own fields, times in UTC. `desk_state` renders its value as JSON.
 *
 * THE WRITE GUARD. This module also holds the desk's write guard ({@link installDeskWriteGuard}): one root
 * `tools/pre-execute` listener that denies a `gravit-desk` agent's `write`, `edit` or `str_replace_editor`
 * whose path names an instruction file, a project root or a skill root (src/desk-names.ts `FENCE_NAMES`)
 * at any depth - before the write, so a desk turn cannot steer the rest of itself. src/desk.ts `installDesk`
 * installs it beside the tools.
 *
 * MODULE WEIGHT: the preset id and the fence names come from src/desk-names.ts, a leaf, not from
 * src/desk-preset.ts or src/desk-session.ts. This module is loaded wherever src/desk.ts is - by `npm run
 * desk` and scripts/service.ts too - and src/desk-preset.ts would bring src/roles.ts, src/bots.ts and
 * js-yaml with it. The guard adds `node:path`, which src/desk.ts loads already.
 *
 * Both tools follow the call's cancellation: a cancelled call settles at once. What it started runs on - the
 * hub's refresh is shared with every other reader and keeps its own deadline, so it is not one call's
 * to stop.
 * @module
 */
import { resolve } from "node:path";
import { DESK_PRESET, fenceNameOf, type FenceName } from "./desk-names.ts";
import type { DeskStatus } from "./desk.ts";
import { etClock, etDate } from "./et.ts";
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

/** What the two tools close over: the quote hub's snapshot, the desk's status, read on every call, and
 * `now` (default `Date.now`), the clock a quote's time is dated against, for tests. */
export interface DeskToolDeps {
  hub: Pick<QuoteHub, "snapshot">;
  readState: () => Promise<DeskStatus>;
  now?: () => number;
}

/** An agent as {@link installDeskTools} sees it: its id, for the log, and its own context, which the
 * preset registry reads and the tools register through. */
export interface DeskAgentLike {
  id: string;
  ctx: { tools: { register(definition: DeskToolDefinition): unknown } };
}

/** The slice of the booted ROOT context {@link installDeskTools} uses: the `agent/created` event, a
 * serial dispatch that fires on every agent's create and resume once its setup - its preset's mount
 * included - is done; the agent registry's live agents (`agents.list()`, dsh-agent); and the preset
 * registry (`composedPreset`, dsh-agent-preset-registry). */
export interface DeskToolsCtxLike {
  on(name: "agent/created", listener: (event: { agent: DeskAgentLike }) => undefined): () => unknown;
  agents: { list(): readonly DeskAgentLike[] };
  agentPresets: { composedPreset(agentCtx: unknown): string | undefined };
}

/** The most symbols one `desk_quotes` call takes. */
const QUOTES_MAX = 20;

/** The most runs `desk_state` answers - the ledger's last ones. Every face start adds a run, and the
 * ledger keeps them until it rotates at 50 MB, so all of them would grow every call's tokens. */
const STATE_RUNS = 10;

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

/** `desk_state`'s value: the fields of {@link DeskStatus} every status carries - `runs` cut to the last
 * {@link STATE_RUNS} - with `runsInLedger`, and those it carries when there is something to say. Open,
 * so a field the status gains later is no failure. */
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
    runsInLedger: { type: "integer" },
    off: { type: "object" },
    deskSession: { type: "string" },
    turnsToday: { type: "object" },
    telegram: { type: "object" },
    ledgerError: { type: "string" },
  },
  required: ["ok", "pid", "version", "bootedAt", "uptimeMs", "desk", "asleep", "runs", "runsInLedger", "turnsToday"],
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

/** One quote in `desk_quotes`' value. */
type DeskQuote = ReturnType<typeof deskQuote>;

/**
 * A quote's time as the desk contract quotes one (`IEX 15:21:03 ET`): the feed upper-cased, then New
 * York's clock to the second, with the New York date before it when that is not `now`'s - a quote from
 * before midnight in New York is dated, whatever the UTC date says. A time `Date` cannot read stays as
 * the hub gave it.
 * @param feed - the quote's feed, `iex`, `sip` or `delayed_sip`; empty when the hub has none.
 * @param asOf - the quote's time, as the hub gave it.
 * @param now - the time the call is answered at, in ms since the epoch.
 */
function quoteTime(feed: string, asOf: string, now: number): string {
  const at = new Date(asOf);
  const clock = Number.isNaN(at.getTime()) ? asOf
    : etDate(at) === etDate(new Date(now)) ? `${etClock(at)} ET` : `${etDate(at)} ${etClock(at)} ET`;
  return feed === "" ? clock : `${feed.toUpperCase()} ${clock}`;
}

/** One quote as one line of `desk_quotes`' text -
 * `NVDA 182.31, +1.20% vs prev close 180.15 | IEX 15:21:03 ET | stream | live` - its change only with a
 * previous close, its time only with one, and `no price` when it has none. */
function quoteLine(quote: DeskQuote, now: number): string {
  const head = quote.price === null ? `${quote.symbol} no price`
    : quote.change_pct === null || quote.prev_close === null ? `${quote.symbol} ${quote.price}`
    : `${quote.symbol} ${quote.price}, ${quote.change_pct > 0 ? "+" : ""}${quote.change_pct.toFixed(2)}% vs prev close ${quote.prev_close}`;
  const time = quote.as_of === null ? [] : [quoteTime(quote.feed, quote.as_of, now)];
  return [head, ...time, quote.transport, quote.status].join(" | ");
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
 *   other failure, is the call's error. The model reads one line per quote ({@link quoteLine}), its time
 *   in New York as the desk quotes one, or the `error` as it is.
 * - `desk_state` (`timeoutMs` 5,000): no parameters; answers `deps.readState()`'s status with `runs` cut
 *   to the last {@link STATE_RUNS} and `runsInLedger`, how many the ledger holds - the route
 *   `GET /data/desk/status` answers them all.
 * @param deps - the quote hub, the status reader and the clock.
 */
export function deskToolDefinitions(deps: DeskToolDeps): DeskToolDefinition[] {
  const now = deps.now ?? Date.now;
  const quotes: DeskToolDefinition = {
    name: "desk_quotes",
    description:
      "The price now for 1 to 20 US stocks, from the face's live quote hub (Alpaca), one line each: the price and its change on " +
      "the previous close; the feed and the exchange time in New York (IEX 15:21:03 ET, dated when not today); transport (stream " +
      "or poll); status (live, delayed, stale or unavailable). The price now, never backtest evidence.",
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
      render(_args, value) {
        const answer = value as { quotes?: DeskQuote[]; error?: string };
        const at = now();
        const text = answer.error ?? (answer.quotes ?? []).map((quote) => quoteLine(quote, at)).join("\n");
        return [{ type: "text", text: text === "" ? "no quotes" : text }];
      },
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
      "and its directory; this run's sleep gaps; the last 10 runs in the ledger (a lost run ended without a clean shutdown) and " +
      "runsInLedger, how many it holds; the pause in force (off), if any; the desk conversation's session id; today's desk turns " +
      "and their tokens.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: STATE_SCHEMA, render: asJson },
    timeoutMs: 5_000,
    execute: (_args, exec) => untilCancelled(exec.signal, async () => {
      const status = await deps.readState();
      return { ...status, runs: status.runs.slice(-STATE_RUNS), runsInLedger: status.runs.length };
    }),
    presentCall: () => ({ card: "generic", title: "Desk state", kind: "read" }),
  };
  return [quotes, state];
}

/**
 * Give every `gravit-desk` agent `definitions`, in its own tool layer: one listener on the ROOT
 * context's `agent/created`, which sees every agent's create and resume - the face's, a browser's
 * `session/create` with `agentPreset: "gravit-desk"`, a controller's resume - and, in the same tick, one
 * sweep of `ctx.agents.list()`, the agents already live. bootFace serves unary `/api` before main.ts
 * reaches `installDesk`, so a desk agent can be created before the listener exists; an agent created
 * after the listener is the listener's, one created before it is in the list.
 *
 * The listener is synchronous and never throws: `agent/created` is a serial, awaited dispatch, and a
 * throw or rejection there fails the agent's creation (src/bot-runtime.ts says the same). An agent whose
 * preset `ctx.agentPresets.composedPreset(agent.ctx)` reads as `gravit-desk` - the registry read late,
 * so a reloaded registry is followed - and that it has not seen gets `agent.ctx.tools.register(d)` for
 * each definition, by the listener or the sweep alike. It is marked seen first, in a `WeakSet`, so an
 * agent both reach is equipped once, a registration that fails is logged once and never retried, and
 * none is made twice; any failure, the registry's and the sweep's own included, is one `gravit-face:`
 * line through `log`. An agent still composing when swept - its preset not mounted yet - is not marked,
 * and the listener equips it when its creation is announced.
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
  const equip = (agent: DeskAgentLike): void => {
    try {
      if (equipped.has(agent) || ctx.agentPresets.composedPreset(agent.ctx) !== DESK_PRESET) return;
      equipped.add(agent);
      for (const definition of definitions) agent.ctx.tools.register(definition);
    } catch (error) {
      log(`${BIN}: the desk tools were not registered for agent ${agent.id}: ${messageOf(error)}`);
    }
  };
  const off = ctx.on("agent/created", ({ agent }) => {
    equip(agent);
    return undefined;
  });
  try {
    for (const agent of ctx.agents.list()) equip(agent);
  } catch (error) {
    log(`${BIN}: the desk tools could not reach the agents already live: ${messageOf(error)}`);
  }
  return () => {
    off();
  };
}

/* ---------- the write guard ---------- */

/** The desk's tools that write a file: of `DESK_ALLOW` (src/desk-preset.ts), exactly these three. Every other
 * name there reads (tests/desk-guard.test.ts holds the list, so a name added there is judged here first). */
export const DESK_WRITE_TOOLS = Object.freeze(["write", "edit", "str_replace_editor"] as const);

/** One of {@link DESK_WRITE_TOOLS}. */
export type DeskWriteTool = (typeof DESK_WRITE_TOOLS)[number];

/**
 * The arguments of each of {@link DESK_WRITE_TOOLS} that name a path, as the installed dsh 0.2.0-rc.2 tools
 * declare them (tests/desk-smoke.test.ts pins every parameter each takes, off a real tree's schemas):
 * - `write` and `edit` (dsh-tool-fs): `file_path`, which the tool resolves against the calling session's cwd,
 *   `exec.agent.session.header.cwd` - or the sandbox policy's workspace root, which is that same cwd;
 * - `str_replace_editor` (dsh-tool-str-replace-editor): `path`, which must be absolute, for every command.
 *   `view` reads, and is judged with the rest: the guard judges the tool, not the command, and a desk that
 *   wants to read one of these names has `read`.
 *
 * Their other parameters - the content, the edit strings, the sandbox's escalation pair - name no path.
 */
export const DESK_WRITE_PATH_ARGS: Readonly<Record<DeskWriteTool, readonly string[]>> = Object.freeze({
  write: Object.freeze(["file_path"]),
  edit: Object.freeze(["file_path"]),
  str_replace_editor: Object.freeze(["path"]),
});

/** The guard's refusal: dsh-tools' deny decision, its reason what the model reads as the call's error. */
export interface DeskWriteDeny {
  kind: "deny";
  reason: string;
}

/** The refusal of a write whose path the guard could not read. */
const UNCHECKED = "the desk could not check this write's path; nothing was written";

const isDeskWriteTool = (name: unknown): name is DeskWriteTool => (DESK_WRITE_TOOLS as readonly unknown[]).includes(name);

/** The first of `path`'s names that is a fence name, in its `FENCE_NAMES` spelling, or `undefined`. The names
 * are split at `/`, and at `\` too: a name with a backslash in it is refused rather than guessed at. */
function fencedName(path: string): FenceName | undefined {
  for (const name of path.split(/[\\/]/)) {
    const fenced = fenceNameOf(name);
    if (fenced !== undefined) return fenced;
  }
  return undefined;
}

/**
 * The write guard's decision for one call: a deny, or `null` to leave the call alone. Pure and synchronous.
 *
 * `null` for any tool that is not one of {@link DESK_WRITE_TOOLS}. For a write tool, each of its
 * {@link DESK_WRITE_PATH_ARGS} is placed against `cwd` - as `path.resolve` places it, `..` collapsed - and the
 * call is denied when any name on that path is a fence name (src/desk-names.ts `FENCE_NAMES`, compared as the
 * volume compares names, `fenceNameOf`), with `the desk never writes <name>: it would steer every desk turn
 * after it`, `<name>` in its `FENCE_NAMES` spelling. Any name the argument spells counts too, though a `..`
 * leaves it behind: dsh-fs-local keeps a path with `..` as spelled and lets the volume walk it. dsh reads the
 * instruction files in every directory from the cwd to any file a tool touches, so a desk turn that wrote
 * `GRAVIT.md` would steer the rest of that same turn, before the fence (src/desk-session.ts) checks again.
 *
 * It fails closed: a write tool whose arguments are no object, whose path argument is missing or is not a
 * string, or a `cwd` that is not a string, is denied with `the desk could not check this write's path;
 * nothing was written`. The arguments are the model's as sent; the tool validates them after this.
 * @param toolName - the call's tool name (`exec.name`).
 * @param args - the call's arguments (`exec.arguments`).
 * @param cwd - the calling session's cwd, which a relative path is placed against.
 */
export function deskWriteDecision(toolName: string, args: unknown, cwd: string): DeskWriteDeny | null {
  if (!isDeskWriteTool(toolName)) return null;
  if (typeof cwd !== "string" || args === null || typeof args !== "object") return { kind: "deny", reason: UNCHECKED };
  for (const arg of DESK_WRITE_PATH_ARGS[toolName]) {
    const path: unknown = (args as Record<string, unknown>)[arg];
    if (typeof path !== "string") return { kind: "deny", reason: UNCHECKED };
    const fenced = fencedName(resolve(cwd, path)) ?? fencedName(path);
    if (fenced !== undefined) return { kind: "deny", reason: `the desk never writes ${fenced}: it would steer every desk turn after it` };
  }
  return null;
}

/** A `tools/pre-execute` decision as the guard sees one: dsh-tools' `PreToolDecision`, stated structurally as
 * src/orders.ts states its own, `deny.info` spelled as dsh's `ToolErrorInfo` so that the booted root context
 * is a {@link DeskWriteGuardCtxLike}. The guard makes only the deny; any other it hands on from `next()`. */
export type DeskPreDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string; info?: { name: string; code: string; reason?: string } }
  | { kind: "cancel" }
  | { kind: "ask"; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } };

/** The slice of dsh-tools' `ToolExecution` the guard reads: the tool's name, its arguments as the model sent
 * them, and the calling agent - its context, for the preset registry, and its session's cwd. */
export interface DeskGuardExecution {
  name: string;
  arguments?: unknown;
  agent?: { id: string; ctx: unknown; session: { header: { cwd?: string } } };
}

/** The booted ROOT context as {@link installDeskWriteGuard} uses it: {@link DeskToolsCtxLike}, since
 * `installDesk` hands both installers one context, and the `tools/pre-execute` waterfall (dsh-tools), run
 * before every call dispatches. A listener takes the pending call and `next`, and answers a decision; one
 * that answers without calling `next` vetoes every listener behind it, and the call. */
export type DeskWriteGuardCtxLike = DeskToolsCtxLike & {
  on(
    name: "tools/pre-execute",
    listener: (exec: DeskGuardExecution, next: () => Promise<DeskPreDecision>) => Promise<DeskPreDecision>,
    options?: { prepend?: boolean },
  ): () => unknown;
};

/** The guard's one line for a call it could not judge; it cannot throw. */
function unjudgedLine(exec: DeskGuardExecution, error: unknown): string {
  try {
    return `${BIN}: desk: the write guard could not judge a ${String(exec.name)} call from agent ${String(exec.agent?.id)}, and denied it: ${messageOf(error)}`;
  } catch {
    return `${BIN}: desk: the write guard could not judge a call, and denied it`;
  }
}

/**
 * Deny every `gravit-desk` agent's write of an instruction file, before it happens: one listener on the ROOT
 * context's `tools/pre-execute` waterfall, registered in front (`prepend`), as src/boot.ts `armOrderGate`
 * registers Gate 2's. A root listener sees every agent's calls - dsh filters by scope, and the root is every
 * scope's - so it covers the desk conversation, a browser's desk session and P2's and P4's firings alike,
 * in whatever cwd they run.
 *
 * For a call to one of {@link DESK_WRITE_TOOLS} from an agent whose preset
 * `ctx.agentPresets.composedPreset(agent.ctx)` reads as `gravit-desk` - read at the call, so a reloaded
 * registry is followed - it answers {@link deskWriteDecision}'s deny, over the agent's session cwd, without
 * calling `next`; anything else it hands on to `next` unjudged, and a call to a tool that writes nothing never
 * reaches the registry. It never throws: a failure to judge - the registry's, an agent whose session or cwd
 * cannot be read - is the fail-closed deny, `the desk could not check this write's path; nothing was
 * written`, with one `gravit-face: desk:` line through `log`. Where the registry fails it cannot tell whose
 * write it is, so it denies whoever's; a malformed call from the desk is denied the same way, with no line.
 *
 * The fence (src/desk-session.ts) stays behind it, for a file another session plants.
 * @param ctx - the booted ROOT context.
 * @param options - `log`, where a failure is written (default `console.error`), for tests.
 * @returns the disposer that removes the listener.
 */
export function installDeskWriteGuard(ctx: DeskWriteGuardCtxLike, options: { log?: (line: string) => void } = {}): () => void {
  const log = options.log ?? ((line: string) => console.error(line));
  /** The guard's decision for `exec`; `null` when the call is not its to judge. Throws when it cannot tell. */
  const judge = (exec: DeskGuardExecution): DeskWriteDeny | null => {
    if (!isDeskWriteTool(exec.name)) return null;
    const agent = exec.agent;
    if (agent === undefined || ctx.agentPresets.composedPreset(agent.ctx) !== DESK_PRESET) return null;
    const cwd: unknown = agent.session.header.cwd;
    if (typeof cwd !== "string") throw new Error("its session has no cwd");
    return deskWriteDecision(exec.name, exec.arguments, cwd);
  };
  const off = ctx.on("tools/pre-execute", async (exec, next) => {
    let decision: DeskWriteDeny | null;
    try {
      decision = judge(exec);
    } catch (error) {
      decision = { kind: "deny", reason: UNCHECKED };
      try {
        log(unjudgedLine(exec, error));
      } catch {
        /* the denial stands without its line */
      }
    }
    return decision ?? next();
  }, { prepend: true });
  return () => {
    off();
  };
}
