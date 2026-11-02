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
 * (src/agents.ts, src/room.ts) - the quote source main.ts creates once over the Market's reads
 * (src/market-quotes.ts, through src/account-proxy.ts's caches), and
 * the desk's status reader, which src/desk.ts `installDesk` binds to the deps of `GET /data/desk/status`,
 * so the tool and the route agree on all but `runs`, which the tool cuts to the last ten. `desk_quotes`
 * asks the source for one snapshot over both markets: one explore read per US symbol, kept by the proxy for 20
 * seconds, and one quotes read per twelve A shares, kept 3 seconds. `desk_state` reads the ledger and `OFF` afresh.
 * The market of a symbol is src/symbols.ts's grammar, never desk-book.ts's: the book brings js-yaml.
 *
 * WHAT THE MODEL READS: `desk_quotes` renders one line per quote, its time as the desk contract quotes
 * one - the feed and the exchange's own clock (`NASDAQ 15:21:03 ET`, `TENCENT 14:03:12 Beijing`) - so the model
 * never converts a UTC time itself; its value keeps the source's own fields, times in UTC. `desk_state` renders
 * its value as JSON.
 *
 * THE GUARD. This module also holds the desk's guard ({@link installDeskGuard}): one root `tools/pre-execute`
 * listener, and a `tools.guard` behind it that no listener can talk out of a denial, that judge every call a desk
 * agent makes, in three checks, before it runs:
 * - the write check ({@link deskWriteDecision}) denies a `write`, `edit` or `str_replace_editor` (a `view`
 *   excepted) whose path names an instruction file, a project root or a skill root (src/desk-names.ts
 *   `FENCE_NAMES`) at any depth below the repository root, or below a path's common ancestor with it - and every
 *   write from a desk whose cwd sits under one - so a desk turn cannot steer the rest of itself; and, the same way,
 *   one that names another agent's instruction file (`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`,
 *   `AGENTS.override.md`) or any dot-file - a `.gitignore` git obeys, an ignore file ripgrep obeys;
 * - the read check ({@link deskReadDecision}) denies a `read`, `read_image`, `grep`, `glob` or `str_replace_editor`
 *   (every command) that reaches outside the repository - after the volume's own realpath, so a symlink cannot
 *   smuggle a path out - or names a key file (`.env`, `.env.<anything>`, `.git`) or any other dot-file below the
 *   root (`.mcp.json`, `.claude/`, `.codex/`), or searches dot-files; dsh's sandbox lets every read through, and what
 *   a desk turn reads goes to DeepSeek in the tool result;
 * - the secret check ({@link deskSecretDecision}) denies any call, of any tool, whose arguments carry the value of
 *   a key, password, secret or token in the face's environment ({@link deskSecrets}): to DeepSeek's search, to an
 *   MCP server, or to a file.
 * src/desk.ts `installDesk` installs it beside the tools, anchored on its `root`. The Telegram bridge
 * (src/telegram.ts) is the second line on the way out: it redacts the same secrets from everything it sends.
 *
 * MODULE WEIGHT: the preset id, the guard's names and their fold come from src/desk-names.ts, a leaf, not from
 * src/desk-preset.ts or src/desk-session.ts. This module is loaded wherever src/desk.ts is - by `npm run
 * desk` and scripts/service.ts too - and src/desk-preset.ts would bring src/roles.ts, src/bots.ts and
 * js-yaml with it. The guard adds `node:crypto` (a session's spill directory is named by a hash of its id),
 * `node:fs`, `node:os` (the temp directory spills lie under) and `node:path`, all built in, which the face loads
 * already.
 *
 * Both tools follow the call's cancellation: a cancelled call settles at once. What it started runs on - the
 * proxy's read is shared with every other reader and keeps its own deadline, so it is not one call's
 * to stop.
 * @module
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { agentFileNameOf, DESK_PRESET, fenceNameOf, foldName, isDotName, type AgentFileName, type FenceName } from "./desk-names.ts";
import type { DeskStatus } from "./desk.ts";
import { bjStamp, etClock, etDate } from "./et.ts";
import { HttpError } from "./http.ts";
import type { MarketQuote, MarketQuoteIdentity, MarketQuotePayload, MarketQuoteSource } from "./market-quotes.ts";
import { CN_SYMBOL_RE, idOf, marketOf, SYMBOL_RE } from "./symbols.ts";

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

/** What the two tools close over: the Market's quote source, the desk's status, read on every call, and
 * `now` (default `Date.now`), the clock a quote's time is dated against, for tests. */
export interface DeskToolDeps {
  quotes: Pick<MarketQuoteSource, "snapshot" | "unavailable">;
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

/** A symbol as `desk_quotes`' schema takes it: a US ticker or an A share's six digits (src/symbols.ts). */
const QUOTE_SYMBOL_PATTERN = `${SYMBOL_RE.source}|${CN_SYMBOL_RE.source}`;

/** `desk_quotes`' answer when the source refuses with 429. */
const BUSY = "busy: the Market read refused for now; try again shortly";

const NUMBER_OR_NULL = { oneOf: [{ type: "number" }, { type: "null" }] };
const STRING_OR_NULL = { oneOf: [{ type: "string" }, { type: "null" }] };

/** One quote as `desk_quotes` answers it: the source's own fields, its `quote_status` as `status`. */
const QUOTE_SCHEMA = {
  type: "object",
  properties: {
    symbol: { type: "string" },
    market: { type: "string", enum: ["us", "cn"] },
    price: NUMBER_OR_NULL,
    as_of: STRING_OR_NULL,
    change_pct: NUMBER_OR_NULL,
    prev_close: NUMBER_OR_NULL,
    feed: { type: "string" },
    transport: { type: "string", enum: ["stream", "poll"] },
    status: { type: "string", enum: ["live", "delayed", "stale", "unavailable"] },
  },
  required: ["symbol", "market", "price", "as_of", "change_pct", "prev_close", "feed", "transport", "status"],
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

/** `desk_quotes`' symbols, each once in the order first named, as the source is asked for them. Throws - the
 * registry's error result - on anything but 1 to {@link QUOTES_MAX} symbols that match {@link SYMBOL_RE} or
 * {@link CN_SYMBOL_RE}. */
function symbolsOf(args: unknown): MarketQuoteIdentity[] {
  const symbols: unknown = args !== null && typeof args === "object" ? (args as { symbols?: unknown }).symbols : undefined;
  if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > QUOTES_MAX) {
    throw new Error(`desk_quotes takes symbols: 1 to ${QUOTES_MAX} US tickers or six-digit A shares`);
  }
  const assets: MarketQuoteIdentity[] = [];
  for (const symbol of symbols) {
    const market = marketOf(symbol);
    if (market === undefined) {
      throw new Error(`desk_quotes takes US tickers in capitals (NVDA, BRK.B) or six digits for an A share (600519); ${shown(symbol)} is not one`);
    }
    if (!assets.some((asset) => asset.symbol === symbol)) assets.push({ id: idOf(market, symbol as string), market, symbol: symbol as string });
  }
  return assets;
}

/** One quote as the desk reads it. `transport` is always set on a payload's quotes; `poll`, the source's
 * own word for a symbol it is not streaming, stands in should one come without. */
function deskQuote(quote: MarketQuote) {
  return {
    symbol: quote.symbol,
    market: quote.market,
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
 * A US quote's time as the desk contract quotes one (`NASDAQ 15:21:03 ET`): the feed upper-cased, then New
 * York's clock to the second, with the New York date before it when that is not `now`'s - a quote from
 * before midnight in New York is dated, whatever the UTC date says. A time `Date` cannot read stays as
 * the source gave it.
 * @param feed - the quote's feed, `robinhood`, `nasdaq` or `cboe delayed`; empty when the source has none.
 * @param asOf - the quote's time, as the source gave it.
 * @param now - the time the call is answered at, in ms since the epoch.
 */
export function quoteTime(feed: string, asOf: string, now: number): string {
  const at = new Date(asOf);
  const clock = Number.isNaN(at.getTime()) ? asOf
    : etDate(at) === etDate(new Date(now)) ? `${etClock(at)} ET` : `${etDate(at)} ${etClock(at)} ET`;
  return feed === "" ? clock : `${feed.toUpperCase()} ${clock}`;
}

/** An A share's quote time as the desk quotes one (`TENCENT 14:03:12 Beijing`): the feed upper-cased, then
 * src/et.ts `bjStamp`, dated when not `now`'s Beijing date. A time `Date` cannot read stays as the source gave it. */
export function cnQuoteTime(feed: string, asOf: string, now: number): string {
  const at = new Date(asOf);
  const clock = Number.isNaN(at.getTime()) ? asOf : bjStamp(at, new Date(now));
  return feed === "" ? clock : `${feed.toUpperCase()} ${clock}`;
}

/** One quote as one line of `desk_quotes`' text -
 * `NVDA 182.31, +1.20% vs prev close 180.15 | NASDAQ 15:21:03 ET | poll | live`,
 * `600519 1452.3, +0.85% vs prev close 1440.06 | TENCENT 14:03:12 Beijing | poll | live` - its change only with a
 * previous close, its time only with one, and `no price` when it has none. */
function quoteLine(quote: DeskQuote, now: number): string {
  const head = quote.price === null ? `${quote.symbol} no price`
    : quote.change_pct === null || quote.prev_close === null ? `${quote.symbol} ${quote.price}`
    : `${quote.symbol} ${quote.price}, ${quote.change_pct > 0 ? "+" : ""}${quote.change_pct.toFixed(2)}% vs prev close ${quote.prev_close}`;
  const stamp = quote.market === "cn" ? cnQuoteTime : quoteTime;
  const time = quote.as_of === null ? [] : [stamp(quote.feed, quote.as_of, now)];
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
 * - `desk_quotes` (`timeoutMs` 15,000): `{ symbols }`, 1 to 20 symbols, each a US ticker
 *   (`^[A-Z][A-Z0-9.-]{0,9}$`) or an A share's six digits, asked of the source in one snapshot as `us:` and `cn:`
 *   assets; answers `{ quotes: [{ symbol, market, price, as_of, change_pct, prev_close, feed, transport, status }] }`
 *   from the source's quotes in the order asked, `status` being its `quote_status` and its `message` left out. A
 *   429 from the source answers `{ error: "busy: …" }`; a refused argument, and any other failure, is the call's
 *   error. The model reads one line per quote ({@link quoteLine}), its time on its exchange's clock as the desk
 *   quotes one, or the `error` as it is.
 * - `desk_state` (`timeoutMs` 5,000): no parameters; answers `deps.readState()`'s status with `runs` cut
 *   to the last {@link STATE_RUNS} and `runsInLedger`, how many the ledger holds - the route
 *   `GET /data/desk/status` answers them all.
 * @param deps - the quote source, the status reader and the clock.
 */
export function deskToolDefinitions(deps: DeskToolDeps): DeskToolDefinition[] {
  const now = deps.now ?? Date.now;
  const quotes: DeskToolDefinition = {
    name: "desk_quotes",
    description:
      "The price now for 1 to 20 US stocks or A shares (six digits, e.g. 600519), one line each: the price and its change on " +
      "the previous close; the feed and the exchange time (NASDAQ 15:21:03 ET, TENCENT 14:03:12 Beijing, dated when not today); " +
      "transport (stream or poll); status (live, delayed, stale or unavailable). The price now, never evidence. The source is " +
      "the Market's read; when the Account cannot be asked it answers unavailable and why.",
    parameters: {
      type: "object",
      properties: {
        symbols: {
          type: "array",
          items: { type: "string", pattern: QUOTE_SYMBOL_PATTERN },
          minItems: 1,
          maxItems: QUOTES_MAX,
          description: "US tickers in capitals, e.g. NVDA, BRK.B, or A shares as six digits, e.g. 600519",
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
      const assets = symbolsOf(args);
      if (deps.quotes.unavailable !== undefined) return { error: `unavailable: ${deps.quotes.unavailable}` };
      let payload: MarketQuotePayload;
      try {
        payload = await untilCancelled(exec.signal, () => deps.quotes.snapshot(assets));
      } catch (error) {
        if (error instanceof HttpError && error.status === 429) return { error: BUSY };
        if (exec.signal.aborted) throw error;
        return { error: `unavailable: ${error instanceof Error ? error.message : String(error)}` };
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

/* ---------- the guard's write check ---------- */

/** The desk's tools that write a file: of `DESK_ALLOW` (src/desk-preset.ts), exactly these three. Every other
 * name there writes nothing (tests/desk-guard.test.ts holds the list, so a name added there is judged here first). */
export const DESK_WRITE_TOOLS = Object.freeze(["write", "edit", "str_replace_editor"] as const);

/** One of {@link DESK_WRITE_TOOLS}. */
export type DeskWriteTool = (typeof DESK_WRITE_TOOLS)[number];

/**
 * The arguments of each of {@link DESK_WRITE_TOOLS} that name a path, as the installed dsh 0.2.0-rc.2 tools
 * declare them (tests/desk-smoke.test.ts pins every parameter each takes, off a real tree's schemas):
 * - `write` and `edit` (dsh-tool-fs): `file_path`, which the tool resolves against the calling session's cwd,
 *   `exec.agent.session.header.cwd` - or the sandbox policy's workspace root, which is that same cwd;
 * - `str_replace_editor` (dsh-tool-str-replace-editor): `path`, which must be absolute, for each of its four
 *   commands, `view`, `create`, `str_replace` and `insert` (desk-smoke pins the enum). `view` reads, and
 *   passes ({@link deskWriteDecision}); every other command, a missing or unknown one too, is judged.
 *
 * Their other parameters - the content, the edit strings, the sandbox's escalation pair - name no path.
 */
export const DESK_WRITE_PATH_ARGS: Readonly<Record<DeskWriteTool, readonly string[]>> = Object.freeze({
  write: Object.freeze(["file_path"]),
  edit: Object.freeze(["file_path"]),
  str_replace_editor: Object.freeze(["path"]),
});

/** The guard's refusal, of a write, a read or a secret alike: dsh-tools' deny decision, its reason what the model
 * reads as the call's error. */
export interface DeskDeny {
  kind: "deny";
  reason: string;
}

const deny = (reason: string): DeskDeny => ({ kind: "deny", reason });

/** The refusal of a write whose path the guard could not read. */
const UNCHECKED = "the desk could not check this write's path; nothing was written";

const isDeskWriteTool = (name: unknown): name is DeskWriteTool => (DESK_WRITE_TOOLS as readonly unknown[]).includes(name);

/** The names a path spells, split at `/` and at `\` - a name with a backslash in it is judged in parts rather
 * than guessed at - leaving out the empty and the `.` ones, which name nothing. */
const namesOf = (path: string): string[] => path.split(/[\\/]/).filter((name) => name !== "" && name !== ".");

/** `names` past their longest common prefix with `base`: what a path names below its common ancestor with the
 * repository root. Compared exactly, so a spelling that differs from the root's only in case is judged whole: the
 * safe side. */
function below(names: readonly string[], base: readonly string[]): readonly string[] {
  let common = 0;
  while (common < names.length && common < base.length && names[common] === base[common]) common += 1;
  return names.slice(common);
}

/** The first of `names` that is a fence name, in its `FENCE_NAMES` spelling, or `undefined`. */
function fencedName(names: readonly string[]): FenceName | undefined {
  for (const name of names) {
    const fenced = fenceNameOf(name);
    if (fenced !== undefined) return fenced;
  }
  return undefined;
}

/** The first of `names` that is another agent's instruction file, in its `AGENT_FILE_NAMES` spelling, or `undefined`. */
function agentFileName(names: readonly string[]): AgentFileName | undefined {
  for (const name of names) {
    const found = agentFileNameOf(name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The write check's refusal of a write that reaches `names`, or `undefined`: a fence name first, wherever it sits
 * among them; then another agent's instruction file; then the first dot-led name. */
function writeRefusal(names: readonly string[]): string | undefined {
  const fenced = fencedName(names);
  if (fenced !== undefined) return `the desk never writes ${fenced}: it would steer every desk turn after it`;
  const agent = agentFileName(names);
  if (agent !== undefined) return `the desk never writes ${agent}: another agent reads it`;
  const dotted = names.find(isDotName);
  return dotted === undefined ? undefined : `the desk never writes dot-files: ${dotted}`;
}

/**
 * The write guard's decision for one call: a deny, or `null` to leave the call alone. Pure and synchronous.
 *
 * `null` for any tool that is not one of {@link DESK_WRITE_TOOLS}, and for `str_replace_editor`'s `view`, which
 * reads. Every other call to a write tool - every other command of `str_replace_editor`, a missing or unknown one
 * too - is judged against `root`, the repository the face runs from, never against the session's cwd:
 * - first the cwd itself: when any of its names below its longest common ancestor with `root` is a fence name,
 *   every write is denied, whatever its path, with `the desk does not write while its directory sits under
 *   <name>` - a desk session opened in the harness home (`~/.dsh/...`), say, or inside a project root;
 * - then each of the call's {@link DESK_WRITE_PATH_ARGS}, by the names it reaches below its longest common
 *   ancestor with `root`, in two spellings: placed against `cwd` as `path.resolve` places it, `..` collapsed -
 *   inside the repository, every name below the root; outside it, the names below where it leaves the root's
 *   ancestors, so `~/.dsh/...` and `~/.agents/...` count - and as the argument spells it, every name of a
 *   relative one and those below the same common ancestor of an absolute one, so a name that a `..` leaves
 *   behind counts too, as dsh-fs-local keeps a path with `..` as spelled and lets the volume walk it. Of those
 *   names, in this order:
 *   - any fence name denies the call with `the desk never writes <name>: it would steer every desk turn after
 *     it` - in the journal, above it (`../GRAVIT.md`), at the repository's skill roots (`../../.agents/...`) and
 *     in the harness home alike - `<name>` its `FENCE_NAMES` spelling;
 *   - then any instruction file another agent loads from the folder it works in - Claude Code's `CLAUDE.md` and
 *     `CLAUDE.local.md`, Codex's `AGENTS.md` and `AGENTS.override.md` (`AGENT_FILE_NAMES`) - with `the desk never
 *     writes <name>: another agent reads it`, `<name>` its `AGENT_FILE_NAMES` spelling: those agents have a shell,
 *     and the journal is ignored, so git would never show one there;
 *   - then any name that begins with a dot, `..` aside, with `the desk never writes dot-files: <name>`, `<name>`
 *     as found: a `.gitignore` holding `!*` in the journal would un-ignore it - the operator's book - for the next
 *     `git add -A`, and an ignore file's negation would lift ripgrep's hidden-file skip; nothing the desk does
 *     needs a dot-file.
 *
 * Names are compared as the volume compares them (src/desk-names.ts `fenceNameOf`, `agentFileNameOf`). The root's
 * own ancestors are never judged, in the cwd or in a path: they are not the desk's to write. So a repository checked
 * out under a directory named `.git`, or any dot-led one, still writes its journal, and what a path reaches below its
 * root - or, outside it, below where the path leaves the root's ancestors - is judged as any other repository's. dsh
 * reads the instruction files in every directory from the cwd to any file a tool touches, so a desk turn that wrote
 * `GRAVIT.md` would steer the rest of that same turn, before the fence (src/desk-session.ts) checks again.
 *
 * It fails closed: a write tool whose arguments are no object, whose path argument is missing or is not a
 * string, or a `cwd` or `root` that is not a string, is denied with `the desk could not check this write's
 * path; nothing was written`. The arguments are the model's as sent; the tool validates them after this.
 * @param toolName - the call's tool name (`exec.name`).
 * @param args - the call's arguments (`exec.arguments`).
 * @param cwd - the calling session's cwd, which a relative path is placed against.
 * @param root - the repository root (src/desk.ts `installDesk`'s `root`), which the names are judged below.
 */
export function deskWriteDecision(toolName: string, args: unknown, cwd: string, root: string): DeskDeny | null {
  if (!isDeskWriteTool(toolName)) return null;
  if (args === null || typeof args !== "object") return { kind: "deny", reason: UNCHECKED };
  if (toolName === "str_replace_editor" && (args as { command?: unknown }).command === "view") return null;
  if (typeof cwd !== "string" || typeof root !== "string") return { kind: "deny", reason: UNCHECKED };
  const base = namesOf(resolve(root));
  const sitsUnder = fencedName(below(namesOf(resolve(cwd)), base));
  if (sitsUnder !== undefined) return { kind: "deny", reason: `the desk does not write while its directory sits under ${sitsUnder}` };
  for (const arg of DESK_WRITE_PATH_ARGS[toolName]) {
    const path: unknown = (args as Record<string, unknown>)[arg];
    if (typeof path !== "string") return { kind: "deny", reason: UNCHECKED };
    const spelled = namesOf(path);
    const refusal = writeRefusal([...below(namesOf(resolve(cwd, path)), base), ...(isAbsolute(path) ? below(spelled, base) : spelled)]);
    if (refusal !== undefined) return deny(refusal);
  }
  return null;
}

/* ---------- the guard's read check ---------- */

/** The desk's tools that read a file, list a directory or search one: of `DESK_ALLOW` (src/desk-preset.ts), exactly
 * these five - `str_replace_editor` with every command, `view` included, so its writing commands meet both checks.
 * Every other name there names no path, and the secret check alone judges it (tests/desk-guard.test.ts holds the
 * list, so a name added there is weighed here first). */
export const DESK_READ_TOOLS = Object.freeze(["read", "read_image", "grep", "glob", "str_replace_editor"] as const);

/** One of {@link DESK_READ_TOOLS}. */
export type DeskReadTool = (typeof DESK_READ_TOOLS)[number];

/**
 * The argument of each of {@link DESK_READ_TOOLS} that names a path, as the installed dsh 0.2.0-rc.2 tools declare it
 * (tests/desk-smoke.test.ts pins every parameter each takes, off a real tree's schemas):
 * - `read` and `read_image` (dsh-tool-fs): `file_path`, required. dsh-fs-local places it against the calling
 *   session's cwd - a path with a `..` in it as spelled, for the volume to walk, any other one normalized - and
 *   realpaths it;
 * - `grep` and `glob` (dsh-tool-fs-search): `path`, optional. Ripgrep runs in the session's cwd with the path behind
 *   `--`, so a relative one is the cwd's and none at all searches the cwd itself ({@link DESK_READ_CWD_TOOLS});
 * - `str_replace_editor` (dsh-tool-str-replace-editor): `path`, required and absolute, for every command.
 *
 * None of them expands `~`: no shell stands between the model and a tool.
 */
export const DESK_READ_PATH_ARGS: Readonly<Record<DeskReadTool, readonly string[]>> = Object.freeze({
  read: Object.freeze(["file_path"]),
  read_image: Object.freeze(["file_path"]),
  grep: Object.freeze(["path"]),
  glob: Object.freeze(["path"]),
  str_replace_editor: Object.freeze(["path"]),
});

/** The read tools whose path may be left out: ripgrep's two, which then search the session's cwd. */
export const DESK_READ_CWD_TOOLS = Object.freeze(["grep", "glob"] as const);

/** The argument each ripgrep tool hands ripgrep as `--glob=<value>`: `grep`'s `include`, optional, and `glob`'s
 * `pattern`, required. */
export const DESK_READ_GLOB_ARGS = Object.freeze({ grep: "include", glob: "pattern" } as const);

/** The read check's refusals. */
const READ_UNCHECKED = "the desk could not check this read's path; nothing was read";
const DOT_FILES = "the desk never searches dot-files: search with no include, or one that starts with a name";
const outsideRefusal = (path: string): string => `the desk reads only inside the repository; ${path} is outside it`;
const keyRefusal = (name: string): string => `the desk never reads ${name}: it can hold a key`;
const dotRefusal = (name: string): string => `the desk never reads dot-files: ${name}`;

const isDeskReadTool = (name: unknown): name is DeskReadTool => (DESK_READ_TOOLS as readonly unknown[]).includes(name);
const searchesCwd = (name: DeskReadTool): boolean => (DESK_READ_CWD_TOOLS as readonly string[]).includes(name);

/** A `..` segment at either separator: dsh-fs-local's own test for a path it leaves as spelled. */
const PARENT_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

/** Whether `name` can hold a key: `.env`, `.env.<anything>` or `.git`, compared as the volume compares names
 * (src/desk-names.ts `foldName`). */
function isKeyName(name: string): boolean {
  const folded = foldName(name);
  return folded === ".env" || folded.startsWith(".env.") || folded === ".git";
}

/**
 * Where `path` really is: the realpath of its deepest existing ancestor - the path itself when it exists - with the
 * names below that ancestor appended, a `..` among them collapsed, since nothing on the volume can follow it.
 * `realpathSync.native` asks the volume, so a symlink anywhere on the way, and a `..` after one, is followed as the
 * volume follows it - Node's own `realpathSync` collapses a `..` first, which the volume does not - and an existing
 * name comes back in its on-disk case. Synchronous. Throws when an ancestor cannot be resolved for any reason but its
 * absence: a symlink loop, a permission, a NUL in the path.
 */
function realTarget(path: string): string {
  const missing: string[] = [];
  let at = path;
  for (;;) {
    try {
      const real = realpathSync.native(at);
      return missing.length === 0 ? real : join(real, ...missing);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(at);
      if (parent === at) throw error;
      missing.unshift(basename(at));
      at = parent;
    }
  }
}

/** Whether `target` is `root` or lies below it; both real. */
function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!isAbsolute(rel) && rel.split(sep)[0] !== "..");
}

/** The names `target` reaches below `root`, both real: none for the root itself. */
const namesBelow = (root: string, target: string): string[] => relative(root, target).split(sep).filter((name) => name !== "");

/** A spill root as dsh-spill-local creates one (`mkdtempSync(join(tmpdir(), "dsh-spill-"))`) and its own startup sweep
 * recognises one (`DEFAULT_ROOT_RE`): `dsh-spill-` and the six characters `mkdtemp` appends, in the OS temp directory. */
const SPILL_ROOT = /^dsh-spill-[A-Za-z0-9]{6}$/;

/** The read tools a spilled result is retrieved with: the spill notice tells the model to `read` it with offset and
 * limit, or to `grep` it. */
const SPILL_READERS: readonly DeskReadTool[] = Object.freeze(["read", "grep"]);

/** Where one session's spilled results lie: the realpath of the OS temp directory, and the name of the session's own
 * directory under a spill root there. */
interface SpillHome {
  tmp: string;
  session: string;
}

/**
 * The {@link SpillHome} of the session `sessionId`: dsh-spill-local keeps every result too large to show inline - a
 * result over the spill policy's 12,500 tokens, a `grep` past 250 matches, a `glob` past 100 paths - in a file under
 * `<os.tmpdir()>/dsh-spill-XXXXXX/session-<the first 12 hex digits of sha256(session id)>/`, the session being the
 * calling agent's (`exec.agent.session.header.id`, dsh-spill-policy and dsh-tool-fs-search alike), and names that
 * directory so (dsh-spill-local `sessionDir`). Throws when the temp directory cannot be resolved.
 */
function spillHomeOf(sessionId: string): SpillHome {
  return {
    tmp: realTarget(tmpdir()),
    session: `session-${createHash("sha256").update(sessionId).digest("hex").slice(0, 12)}`,
  };
}

/** Whether `target`, real, is the session's own spill directory or lies below it - `<tmp>/<spill root>/<session>/...` -
 * and so never the temp directory, never a spill root itself, never another session's directory. */
function inOwnSpill(home: SpillHome, target: string): boolean {
  const [spillRoot, session] = relative(home.tmp, target).split(sep);
  return session === home.session && SPILL_ROOT.test(spillRoot);
}

/**
 * One path's verdict, by {@link deskReadDecision}'s rules: outside the repository, a key name, a dot-file below the
 * root, or `null`.
 * @param path - the path as the model spelled it, or the cwd ripgrep searches.
 * @param cwd - the session's cwd, absolute.
 * @param base - the root's names, as given.
 * @param realRoot - the root's realpath.
 * @param spill - the calling session's {@link SpillHome}, asked only for a path outside the repository; absent when
 *   the call may not read spilled results.
 * @throws when the volume cannot resolve the path.
 */
function judgeReadPath(path: string, cwd: string, base: readonly string[], realRoot: string, spill?: () => SpillHome): DeskDeny | null {
  if (!isAbsolute(path) && path.startsWith("~")) return deny(outsideRefusal(path));
  const placed = resolve(cwd, path);
  const spelled = isAbsolute(path) ? path : `${cwd}${sep}${path}`;
  const walked = PARENT_SEGMENT.test(spelled) ? spelled : placed;
  const physical = realTarget(walked);
  const lexical = walked === placed ? physical : realTarget(placed);
  /* the names each placement reaches are judged below the place it was let into: the repository, or the temp
   * directory that holds the session's own spills */
  let anchor = realRoot;
  if (!within(realRoot, physical) || !within(realRoot, lexical)) {
    const home = spill?.();
    if (home === undefined || !inOwnSpill(home, physical) || !inOwnSpill(home, lexical)) return deny(outsideRefusal(path));
    anchor = home.tmp;
  }
  const names = [
    ...(isAbsolute(path) ? below(namesOf(path), base) : namesOf(path)),
    ...namesBelow(anchor, physical),
    ...namesBelow(anchor, lexical),
  ];
  const key = names.find(isKeyName);
  if (key !== undefined) return deny(keyRefusal(key));
  /* below the root, no dot-file at all; the session's own spills lie outside it, and keep only the key rule */
  const dotted = anchor === realRoot ? names.find(isDotName) : undefined;
  return dotted === undefined ? null : deny(dotRefusal(dotted));
}

/** A glob's segments, split at `/`, the one separator ripgrep's globs take, leaving out the empty ones. */
const globSegments = (glob: string): string[] => glob.split("/").filter((segment) => segment !== "");

/** Whether a glob segment is led by a dot, a backslash-escaped one included: it matches only names that begin with one. */
const dotLed = (segment: string): boolean => segment.startsWith(".") || segment.startsWith("\\.");

/** Whether a glob segment can match a name that begins with a dot: one led by a dot, or by a wildcard - `*`, `?`, a
 * class `[...]` or an alternation `{...}` - each of which ripgrep lets match a leading dot. */
const mayMatchDotName = (segment: string): boolean => dotLed(segment) || "*?[{".includes(segment.charAt(0));

/**
 * The read check's decision for one call: a deny, or `null` to leave the call alone. Pure, but for the volume's
 * realpath of the root and of each path's deepest existing ancestor, made synchronously.
 *
 * `null` for any tool that is not one of {@link DESK_READ_TOOLS}. For one that is, each of its
 * {@link DESK_READ_PATH_ARGS} - or, for `grep` and `glob` given none, the cwd ripgrep then searches - is judged against
 * `root`, the repository the face runs from, never against the session's cwd:
 * - a path spelled from `~` names a home directory, as a shell would take it - dsh never expands it, and would read
 *   `<cwd>/~/...` - so it is outside the repository;
 * - the path is placed as the tool places it - against the cwd, a `..` left for the volume to walk, so through a
 *   symlink before it - and as `path.resolve` places it, `..` collapsed; each placement is realpathed
 *   ({@link realTarget}), and when either lies outside the root's own realpath the call is denied with
 *   `the desk reads only inside the repository; <path> is outside it`, `<path>` as spelled. That is the harness home,
 *   `~/.ssh`, `~/.config` and every checkout outside the repository, however they are reached - those under
 *   `.claude/worktrees/`, inside it, are dot-files (below);
 * - but for one place outside it: a `read` or a `grep` whose two placements both lie in the calling session's own spill
 *   directory - `<the realpath of os.tmpdir()>/dsh-spill-XXXXXX/session-<sha256(sessionId)[:12]>/`, the directory itself
 *   or below it ({@link spillHomeOf}) - goes on, since the spill notice of a result too large to show inline tells the
 *   model to read it so. Never the temp directory, never a spill root itself, never another session's directory - those
 *   hold Gravit's spills, which can hold a key file's text - and only for the session the call comes from, by the
 *   `sessionId` the guard reads off its header; given none, nothing outside the repository is read;
 * - inside either, when a name the path spells - every name of a relative one; those below its common ancestor with
 *   the root of an absolute one, as the write check counts them - or a name either placement reaches below the root,
 *   or below the temp directory for a spill, case-folds to `.env`, `.env.<anything>` or `.git`, the call is denied
 *   with `the desk never reads <name>: it can hold a key`, `<name>` as found. A symlink with an innocent name and a key
 *   file behind it is found by its target;
 * - inside the repository, when any of those names begins with a dot, `..` aside, the call is denied with `the desk
 *   never reads dot-files: <name>`, `<name>` as found: the checkout the service runs from holds `.mcp.json`,
 *   `.claude/settings.local.json` and `.codex/` - formats made to carry tokens, which the secret check knows only by
 *   the values in the face's environment - and the `.claude/worktrees/*` checkouts, and nothing the desk does needs a
 *   dot-file. ripgrep keeps a `grep` or `glob` with no such name in its path off them already. The session's own
 *   spill directory lies outside the repository, so its read keeps the key rule alone.
 *
 * Then the glob the tool hands ripgrep as `--glob=<value>` ({@link DESK_READ_GLOB_ARGS}) is judged segment by segment,
 * split at `/`. Ripgrep skips hidden files and directories by default, but a `--glob` that matches one lifts the skip,
 * and its `*`, `?`, `[...]` and `{...}` all match a leading dot. Measured with rg 15.0.0, the binary dsh packages, on a
 * scratch tree: with grep's argv (`--glob` and no `--hidden`), `*.md` searched `.hidden.md`; `*.alpaca` and
 * `*.{md,alpaca}` searched `.env.alpaca`; `sub/*` searched `sub/.env`; `*env*`, `?env*` and `[.]env*` searched
 * `.env.alpaca` and `sub/.env`; `*.Upper` searched `.ENV.Upper`. glob's argv adds `--hidden --no-ignore`, so a
 * doublestar `*.md` pattern listed `.hidden.md` and `.dsh/x.md` - by name, never their contents. So:
 * - `grep`'s `include`, which reads contents: a segment led by a dot (an escaped one, `\.`, too) or by `*`, `?`, `[`
 *   or `{` is denied with `the desk never searches dot-files: search with no include, or one that starts with a name` -
 *   `*.md` included, since no rule that lets `*.md` through can stop `*.alpaca`. A literal-led include (`notes*.md`)
 *   goes, and so does a `grep` with none, narrowed by its `path`, which ripgrep keeps off hidden files - unless an
 *   ignore file it reads whitelists one: a negation such as `!.env.alpaca`, or a doublestar that ends one, in a
 *   `.gitignore`, `.ignore` or `.rgignore` lifts the hidden-file skip for what it matches (measured: a `.ignore`
 *   holding `!.env.alpaca` made a grep with no include search `.env.alpaca`), and ripgrep reads those files in the tree
 *   it searches and in the directories above it - the repository's root for a grep in the journal, and above the
 *   repository too. tests/desk-guard.test.ts keeps the repository's tracked ignore files free of a negation that can
 *   match a key name; an untracked one, git's own exclude files and those above the repository it does not see. The
 *   desk cannot write one: each is a dot-file, which the write check refuses;
 * - `glob`'s `pattern`, which lists names only: a segment led by a dot is denied, so `.*` is, and so is a doublestar
 *   `.env*`, and a doublestar `*.md` goes.
 *
 * It fails closed: a read tool whose arguments are no object; whose required path is missing or not a string; whose
 * `grep` or `glob` path, or `grep` include, is there but not a string; or whose `glob` pattern is missing or not a
 * string; a `cwd` or `root` that is not a string; and a path, or a root, the volume cannot resolve - a loop, a NUL -
 * is denied with `the desk could not check this read's path; nothing was read`. A path's refusal comes before its
 * glob's.
 * @param toolName - the call's tool name (`exec.name`).
 * @param args - the call's arguments (`exec.arguments`).
 * @param cwd - the calling session's cwd, which a relative path is placed against and ripgrep runs in.
 * @param root - the repository root (src/desk.ts `installDesk`'s `root`), which every read must stay inside.
 * @param sessionId - the calling session's id (its header's `id`), whose own spill directory a `read` or a `grep` may
 *   read; absent, or empty, when the guard has none.
 */
export function deskReadDecision(toolName: string, args: unknown, cwd: string, root: string, sessionId?: string): DeskDeny | null {
  if (!isDeskReadTool(toolName)) return null;
  if (args === null || typeof args !== "object" || typeof cwd !== "string" || typeof root !== "string") return deny(READ_UNCHECKED);
  const given = args as Record<string, unknown>;
  try {
    const at = isAbsolute(cwd) ? cwd : resolve(cwd);
    const realRoot = realTarget(resolve(root));
    const base = namesOf(resolve(root));
    /* worked out once, and only for a path outside the repository */
    let home: SpillHome | undefined;
    const spill = typeof sessionId === "string" && sessionId !== "" && SPILL_READERS.includes(toolName)
      ? (): SpillHome => (home ??= spillHomeOf(sessionId))
      : undefined;
    for (const arg of DESK_READ_PATH_ARGS[toolName]) {
      const path = given[arg];
      if (path !== undefined && typeof path !== "string") return deny(READ_UNCHECKED);
      if (path === undefined && !searchesCwd(toolName)) return deny(READ_UNCHECKED);
      const verdict = judgeReadPath(path ?? at, at, base, realRoot, spill);
      if (verdict !== null) return verdict;
    }
  } catch {
    return deny(READ_UNCHECKED);
  }
  if (toolName !== "grep" && toolName !== "glob") return null;
  const glob = given[DESK_READ_GLOB_ARGS[toolName]];
  if (glob === undefined && toolName === "grep") return null;
  if (typeof glob !== "string") return deny(READ_UNCHECKED);
  return globSegments(glob).some(toolName === "grep" ? mayMatchDotName : dotLed) ? deny(DOT_FILES) : null;
}

/* ---------- the guard's secret check ---------- */

/** The names whose values are secrets: any that names a key, a password, a secret or a token. */
const SECRET_NAME = /KEY|PASSWORD|SECRET|TOKEN/i;
/** The fewest characters a secret has, trimmed: a shorter value turns up by chance too easily. */
const SECRET_MIN_LENGTH = 8;

/** The variables of `env` the secret check covers, each as its name and its value trimmed, in the environment's
 * order: every one whose name matches {@link SECRET_NAME} and whose value, trimmed, is at least
 * {@link SECRET_MIN_LENGTH} characters. */
function secretVariables(env: NodeJS.ProcessEnv): (readonly [string, string])[] {
  const found: (readonly [string, string])[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || !SECRET_NAME.test(name)) continue;
    const secret = value.trim();
    if (secret.length >= SECRET_MIN_LENGTH) found.push([name, secret]);
  }
  return found;
}

/**
 * The secrets in `env`: the value of every variable whose name matches `/KEY|PASSWORD|SECRET|TOKEN/i` and whose value,
 * trimmed, is at least 8 characters - trimmed, so a blank value is none and a padded one is looked for as it is used
 * - each once, in the order first found. The face takes them once, at install, from `process.env`, which by then
 * holds `$DSH_HOME/.env` (src/desk.ts `installDesk`, which installs the guard, and src/telegram.ts): the model's key,
 * Alpaca's pair, the bot's token.
 * @param env - the environment.
 */
export function deskSecrets(env: NodeJS.ProcessEnv): string[] {
  return [...new Set(secretVariables(env).map(([, secret]) => secret))];
}

/**
 * The names of the variables whose values {@link deskSecrets} takes from `env`, in the environment's order - for the
 * line the guard writes at install, which names what the secret check covers and never a value.
 * @param env - the environment.
 */
export function deskSecretNames(env: NodeJS.ProcessEnv): string[] {
  return secretVariables(env).map(([name]) => name);
}

/**
 * Every spelling a secret travels in: as it is, as JSON writes it inside a string - a quote or a backslash escaped -
 * and as a URL encodes it; each once, none empty.
 * @param value - the secret.
 */
export function secretSpellings(value: string): string[] {
  let encoded: string[] = [];
  try {
    encoded = [encodeURIComponent(value)];
  } catch {
    /* a lone surrogate, which no URL can carry */
  }
  return [...new Set([value, JSON.stringify(value).slice(1, -1), ...encoded])].filter((spelling) => spelling !== "");
}

/** The secret check's refusals. */
const CARRIES_SECRET = "the desk never sends a secret: this call carries one";
const SECRET_UNCHECKED = "the desk could not check this call for a secret; nothing was sent";

/**
 * The secret check's decision for one call: a deny, or `null` to leave the call alone. Pure. It judges every tool
 * alike - the search, an MCP tool, a write, the desk's own tools - since any argument can carry a value out: to
 * DeepSeek's search as a query, to Alpaca as a symbol, to a file the next turn reads back. The call is denied with
 * `the desk never sends a secret: this call carries one` when its arguments, as JSON, hold any spelling of any of
 * `secrets` ({@link secretSpellings}), and with `the desk could not check this call for a secret; nothing was sent`
 * when JSON cannot write them. Arguments JSON writes as nothing - none at all - carry nothing.
 * @param args - the call's arguments (`exec.arguments`).
 * @param secrets - the values to look for: {@link deskSecrets}'s.
 */
export function deskSecretDecision(args: unknown, secrets: readonly string[]): DeskDeny | null {
  if (secrets.length === 0) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(args);
  } catch {
    return deny(SECRET_UNCHECKED);
  }
  if (json === undefined) return null;
  const text = json;
  return secrets.some((secret) => secretSpellings(secret).some((spelling) => text.includes(spelling))) ? deny(CARRIES_SECRET) : null;
}

/* ---------- the guard ---------- */

/** A `tools/pre-execute` decision as the guard sees one: dsh-tools' `PreToolDecision`, stated structurally as
 * src/orders.ts states its own, `deny.info` spelled as dsh's `ToolErrorInfo` so that the booted root context
 * is a {@link DeskGuardCtxLike}. The guard makes only the deny; any other it hands on from `next()`. */
export type DeskPreDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string; info?: { name: string; code: string; reason?: string } }
  | { kind: "cancel" }
  | { kind: "ask"; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } };

/** The slice of dsh-tools' `ToolExecution` the guard reads: the tool's name, its arguments as the model sent
 * them, and the calling agent - its context, for the preset registry, and its session's header: the preset the
 * session was created with, fixed then, its cwd, and its id, which names the session's own spill directory. */
export interface DeskGuardExecution {
  name: string;
  arguments?: unknown;
  agent?: { id: string; ctx: unknown; session: { header: { id?: string; cwd?: string; agentPreset?: string } } };
}

/** The tool registry's guard seam as the backstop uses it - dsh-tools `ToolRuntime.guard`, a monotonic
 * `ToolGuard`: a synchronous check run after the whole `tools/pre-execute` waterfall, and only on a call it
 * allowed (`prepareExecution`), whose returned string denies the call; no guard can force-allow a call another
 * denied. A guard registered through a context is that context's effect, withdrawn with it. */
export interface DeskGuardToolsLike {
  guard(check: (exec: DeskGuardExecution) => string | undefined): () => unknown;
}

/** The context an `inject` callback runs in, as the backstop reads it: the tool registry, through `get`. */
export interface DeskGuardInjectCtxLike {
  get(name: "tools"): unknown;
}

/** The booted ROOT context as {@link installDeskGuard} uses it: {@link DeskToolsCtxLike}, since
 * `installDesk` hands both installers one context; the `tools/pre-execute` waterfall (dsh-tools), run before
 * every call dispatches - a listener takes the pending call and `next`, and answers a decision, and one that
 * answers without calling `next` vetoes every listener behind it, and the call; and cordis's `inject`, which
 * runs a callback in a fiber of its own once the services it names are live, again whenever one is replaced,
 * and withdraws what the callback registered when the fiber is disposed. */
export type DeskGuardCtxLike = DeskToolsCtxLike & {
  on(
    name: "tools/pre-execute",
    listener: (exec: DeskGuardExecution, next: () => Promise<DeskPreDecision>) => Promise<DeskPreDecision>,
    options?: { prepend?: boolean },
  ): () => unknown;
  inject(deps: ["tools"], callback: (ctx: DeskGuardInjectCtxLike) => void): { dispose(): Promise<void> };
};

/** A thrown value as a line shows it; it cannot throw. */
function shownError(error: unknown): string {
  try {
    return messageOf(error);
  } catch {
    return "an error that cannot be shown";
  }
}

/** The guard's line for a call it could not judge, and denied; it cannot throw. */
function unjudgedLine(exec: DeskGuardExecution, error: unknown): string {
  try {
    return `${BIN}: desk: the desk guard could not judge a ${String(exec.name)} call from agent ${String(exec.agent?.id)}, and denied it: ${shownError(error)}`;
  } catch {
    return `${BIN}: desk: the desk guard could not judge a call, and denied it`;
  }
}

/** The guard's line for a call it let go on the session's own word, the registry having failed; it cannot throw. */
function headerLine(exec: DeskGuardExecution, error: unknown): string {
  try {
    return `${BIN}: desk: the desk guard could not read agent ${String(exec.agent?.id)}'s preset (${shownError(error)}); its session was not created as ${DESK_PRESET}, so its ${String(exec.name)} call goes on`;
  } catch {
    return `${BIN}: desk: the desk guard could not read an agent's preset; its session was not created as ${DESK_PRESET}, so the call goes on`;
  }
}

/** The fail-closed reason for a call the guard could not judge: that of the first check that would have judged it -
 * the write check's for a write tool, the read check's for a read tool, else the secret check's. It cannot throw. */
function uncheckedFor(exec: unknown): string {
  let name: unknown;
  try {
    name = (exec as { name?: unknown } | null | undefined)?.name;
  } catch {
    /* a name that cannot be read: the secret check's reason, which every call meets */
  }
  return isDeskWriteTool(name) ? UNCHECKED : isDeskReadTool(name) ? READ_UNCHECKED : SECRET_UNCHECKED;
}

/** What {@link installDeskGuard} takes beside the context and the root: `log`, where a line is written (default
 * `console.error`), and `env`, the environment the secret check takes its secrets from, once, at install (default
 * `process.env`) - both for tests. */
export interface DeskGuardOptions {
  log?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

/**
 * Judge every call a desk agent makes, before it runs - its write ({@link deskWriteDecision}), then its read
 * ({@link deskReadDecision}), then the secrets it carries ({@link deskSecretDecision}), the first deny the answer - with
 * two registrations, as src/boot.ts `armOrderGate` arms Gate 2:
 * - one listener on the ROOT context's `tools/pre-execute` waterfall, registered in front (`prepend`). A root
 *   listener sees every agent's calls - dsh filters by scope, and the root is every scope's - so it covers the
 *   desk conversation, a browser's desk session and P2's and P4's firings alike, in whatever cwd they run;
 * - the backstop, one `tools.guard` armed through `ctx.inject(["tools"])`, so a registry that is replaced gets it
 *   again. A listener registered later in front of this one could answer `allow` without calling `next`, and
 *   dsh consults its guards only on an allowed call - which is exactly when the backstop runs, and no guard can
 *   force-allow. It judges the call afresh, as the waterfall left it: a listener behind this one may have
 *   changed the call's name or arguments since, so it never reuses the listener's verdict.
 *
 * Both judge alike. A call that no check could deny - a tool outside {@link DESK_WRITE_TOOLS} and
 * {@link DESK_READ_TOOLS} whose arguments carry no secret - is handed on at the cost of a name check and a look for
 * the secrets, and never reaches the registry. A desk agent is one whose preset
 * `ctx.agentPresets.composedPreset(agent.ctx)` reads as `gravit-desk` - read at the call, so a reloaded registry is
 * followed - or whose session was created as `gravit-desk` (its header's `agentPreset`, fixed then): its call gets
 * the three checks' answer, the write and the read over the session's cwd and `root`. Anyone else's call - Gravit's
 * workbench sessions, a bot's - is handed on unjudged.
 *
 * Neither ever throws. A failure to judge - an agent whose session or cwd cannot be read, or a registry that throws
 * for a session created as the desk's - is the fail-closed deny of the first check that would have judged the call
 * (`the desk could not check this write's path; nothing was written`, `...this read's path; nothing was read`, or
 * `the desk could not check this call for a secret; nothing was sent`), with one `gravit-face: desk:` line through
 * `log`. A registry that throws for any other session leaves the session's own word: its call goes on, with one
 * line. One call is one line, however many of the two judge it, and a `log` that throws costs the line, never the
 * decision. A malformed call from the desk is denied without a line: nothing failed. Given no `root`, the guard can
 * judge no path: every desk write and read is its check's could-not-check deny, said once, at install, rather than
 * once a call; the secret check needs no root. At install it also writes one line naming the variables whose values
 * the secret check took ({@link deskSecretNames}) - `gravit-face: desk: the secret check covers DEEPSEEK_API_KEY,
 * APCA_API_KEY_ID, ...` - by name, never by value, or saying that it covers none.
 *
 * The read check is given the calling session's id, its header's `id`, so a desk turn's `read` or `grep` can retrieve
 * its own spilled results, and nobody else's ({@link deskReadDecision}).
 *
 * The fence (src/desk-session.ts) stays behind both, for a file another session plants.
 * @param ctx - the booted ROOT context.
 * @param root - the repository root the face runs from (src/desk.ts `installDesk`'s `root`, main.ts's
 *   `process.cwd()`), which every desk write is judged below and every desk read must stay inside; `undefined` when
 *   the face has none.
 * @param options - see {@link DeskGuardOptions}.
 * @returns the disposer. It removes the listener at once, then disposes the backstop's fiber, which withdraws
 *   the guard, and settles once it has. Each step is guarded on its own: a listener that cannot be removed, or a
 *   fiber that cannot be disposed, is one line, the other step runs regardless, and the disposer never rejects.
 */
export function installDeskGuard(
  ctx: DeskGuardCtxLike,
  root: string | undefined,
  options: DeskGuardOptions = {},
): () => Promise<void> {
  const log = options.log ?? ((line: string) => console.error(line));
  const env = options.env ?? process.env;
  const secrets: readonly string[] = deskSecrets(env);
  const covered = deskSecretNames(env);
  /** The calls already given a line: the listener and the backstop can judge one call alike. */
  const told = new WeakSet<object>();
  const tell = (exec: unknown, line: string): void => {
    if (typeof exec === "object" && exec !== null) {
      if (told.has(exec)) return;
      told.add(exec);
    }
    try {
      log(line);
    } catch {
      /* the decision stands without its line */
    }
  };
  /** The guard's decision for `exec`, read afresh: `null` when the call is not its to judge, else the deny. Never throws. */
  const judge = (exec: DeskGuardExecution): DeskDeny | null => {
    try {
      const name = exec?.name;
      const writes = isDeskWriteTool(name);
      const reads = isDeskReadTool(name);
      /* looked for in every call, first: a call that no check could deny never costs a registry read */
      const secret = deskSecretDecision(exec?.arguments, secrets);
      if (!writes && !reads && secret === null) return null;
      const agent = exec.agent;
      if (agent === undefined) return null;
      const header = agent.session.header;
      let composed: string | undefined;
      try {
        composed = ctx.agentPresets.composedPreset(agent.ctx);
      } catch (error) {
        if (header.agentPreset !== DESK_PRESET) {
          tell(exec, headerLine(exec, error));
          return null;
        }
        throw error;
      }
      if (composed !== DESK_PRESET && header.agentPreset !== DESK_PRESET) return null;
      if (writes || reads) {
        const cwd: unknown = header.cwd;
        if (typeof cwd !== "string") throw new Error("its session has no cwd");
        /* the header's id names the session's own spill directory, which its read and grep may read */
        const id: unknown = header.id;
        /* no root: each check's own fail-closed deny, without a line - the install said it once */
        const decided = (writes ? deskWriteDecision(exec.name, exec.arguments, cwd, root as string) : null)
          ?? (reads ? deskReadDecision(exec.name, exec.arguments, cwd, root as string, typeof id === "string" ? id : undefined) : null);
        if (decided !== null) return decided;
      }
      return secret;
    } catch (error) {
      tell(exec, unjudgedLine(exec, error));
      return deny(uncheckedFor(exec));
    }
  };
  /* what the secret check covers, by name and never by value: the operator reads which keys are kept in */
  tell(undefined, covered.length === 0
    ? `${BIN}: desk: the secret check covers no variable in the environment; no call will be denied for a secret`
    : `${BIN}: desk: the secret check covers ${covered.join(", ")}`);
  if (root === undefined) tell(undefined, `${BIN}: desk: the desk guard was given no repository root; every desk write and read will be denied, unjudged`);
  const off = ctx.on("tools/pre-execute", async (exec, next) => judge(exec) ?? next(), { prepend: true });
  const backstop = ctx.inject(["tools"], function deskGuardBackstop(injected) {
    const tools = injected.get("tools") as DeskGuardToolsLike | undefined;
    if (tools === undefined) throw new Error(`${BIN}: desk: the tools service vanished before the desk guard's backstop armed`);
    tools.guard((exec) => judge(exec)?.reason);
  });
  return async () => {
    try {
      off();
    } catch (error) {
      tell(undefined, `${BIN}: desk: the desk guard's listener could not be removed: ${shownError(error)}`);
    }
    try {
      await backstop.dispose();
    } catch (error) {
      tell(undefined, `${BIN}: desk: the desk guard's backstop could not be withdrawn: ${shownError(error)}`);
    }
  };
}
