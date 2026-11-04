/** Gate 2, the per-order approval gate: what makes a write of the Account
 * seat raise a card.
 *
 * Gravit's only order path is its seat at Linqi's Account (`account-seat.ts`):
 * the seat's twelve writes — every tool that places, changes or cancels an
 * order, moves money, pays or sets leverage — and any tool under the face's
 * own seat prefix the face has not classified stop for a human here first,
 * and then again on the Account's own Guard card. Nothing else is gated: the
 * seat's reads and words, the market row's keyless reads (`mcp__market__*`,
 * src/market-row.ts; AKShare's passthrough among them, not under the seat's
 * prefix) and the host's tools pass untouched.
 *
 * The approval CHANNEL's only producer used to be a sandbox escalation, and an
 * MCP call never takes that path — so without this module an order tool would
 * run with no card and no `approval/asked` event. This module is the producer.
 *
 * WHAT IT IS NOT. `tools/execute` runs AFTER the guard below, is handed the
 * execution explicitly as mutable (NEW `packages/core/tools/src/index.ts:1601-1607`
 * — the declaration says only `exec.signal` may change, `:155-158`, but the
 * object is a plain unfrozen spread, `:1445`), and the body then re-resolves
 * the tool by its CURRENT name (`:1578`) — so a `tools/execute` wrapper can
 * rename a guard-approved call into a seat write after the fact. Nothing here
 * changes that, and Gravit has an unrestricted shell besides. Per charter
 * Rule 2 — enforce below the layer that runs arbitrary code, or admit the gate
 * is prose — this gates the model's ordinary tool calls. It is not
 * containment. `face/README.md` says so where an operator will read it.
 * @module
 */

import { SEAT_TOOL_PREFIX } from "./account-seat.ts";

/** The Account seat's write tools (src/account-seat.ts; spec 2026-10-20 §5.2):
 * everything that places, changes or cancels an order, moves money, pays or
 * sets leverage at Linqi's Account — read at buyer-agent-demo @ 133b9a7 — plus
 * the three the seat registers only against a simulated service. Its reads
 * (`portfolio_account`, `portfolio_holdings`, `portfolio_wait`, …) and its
 * signed words (`portfolio_ask`, `portfolio_report`, `portfolio_remember`,
 * `portfolio_forget`, `portfolio_desk_say`) grant nothing and move nothing, so
 * they are not here.
 *
 * Matched by their RAW names rather than by a full public name. dsh mints
 * `mcp__<serverName>__<rawName>` (NEW `packages/mcp/mcp-client/src/tools.ts:81-87`,
 * `publicToolName`), and an operator may mount the seat under a server name of
 * their own, so a constant list of full names would quietly stop matching the
 * day they rename the row. Anchoring on the raw suffix survives that rename;
 * a substring test for "order" would gate a harmless read. A rename on the
 * Account's side is caught by the seat smoke (`tests/account-seat-smoke.test.ts`),
 * and under the face's own prefix by the unclassified-tool rule below. */
export const SEAT_WRITE_RAW_NAMES = [
  "portfolio_live_order", "portfolio_live_batch", "portfolio_live_amend", "portfolio_live_cancel", "portfolio_live_close",
  "portfolio_live_leverage", "portfolio_live_move", "portfolio_live_earn", "portfolio_pay",
  "portfolio_order", "portfolio_execute", "portfolio_transfer",
] as const;

/** The seat's reads, waits and signed words at the same pin: the tools the
 * face has classified as NOT a write. A tool under the face's own seat prefix
 * (`mcp__account__`) that is in neither list — one the Account grew after the
 * pin — is carded like a write until it is classified here: a card per call
 * is the safe default, and it never refuses the boot (the Account moves fast;
 * a boot refusal for a new read would brick the operator's face). Only the
 * face's own server name gets this fallback; a renamed seat server keeps the
 * twelve by raw suffix and nothing more. The market's public reads left the
 * seat for the market row (`mcp__market__market_*`, src/market-row.ts), which
 * is not under this prefix and so is never carded; the seat keeps a connected
 * venue's own bars and book (`portfolio_live_candles`, `portfolio_live_book`). */
export const SEAT_READ_RAW_NAMES = [
  "portfolio_overview", "portfolio_read", "portfolio_markets", "portfolio_quote", "portfolio_account", "portfolio_approval",
  "portfolio_wait", "portfolio_statement", "portfolio_holdings", "portfolio_history", "portfolio_asset",
  "portfolio_live_candles", "portfolio_live_book", "portfolio_receive", "portfolio_venues", "portfolio_earn", "portfolio_watchlist",
  "portfolio_report", "portfolio_ask", "portfolio_memory", "portfolio_remember", "portfolio_forget", "portfolio_desk",
  "portfolio_desk_say", "portfolio_live_preview", "portfolio_live_markets", "portfolio_live_compare", "portfolio_live_positions",
  "portfolio_openness",
] as const;

/** The retired order tools: alpaca-kit's pair, which left the tree in stage 3
 * of the Account graft. The seat is the only order path, so one of these that
 * still registers — an operator's leftover row pointing at an install outside
 * this tree — is never carded and never approved: the guard denies it outright
 * under any server name, and the boot refuses a registry that carries one.
 * Residual: dsh hashes a tool name longer than 64 characters or carrying a
 * character outside [A-Za-z0-9_-], and neither the raw-suffix deny nor the boot
 * audit sees a retired tool under such a hashed name (unreachable for a
 * realistic server name). */
export const RETIRED_ORDER_RAW_NAMES = ["place_order", "cancel_order"] as const;

/** Whether `name` is a retired order tool, by raw suffix under any server name. */
export function isRetiredOrderTool(name: string): boolean {
  return prefixBefore(name, RETIRED_ORDER_RAW_NAMES) !== undefined;
}

/** The denial for a retired order tool: nobody is asked, nothing approves it. */
function retiredReason(name: string): string {
  return `${name} is a retired order tool - the Account seat is the only order path, so nothing approves it;` +
    ` remove its MCP row from the profile`;
}

/** A tool under the face's own seat prefix that is neither a known write nor a known read. */
function isUnclassifiedSeatTool(name: string): boolean {
  return name.startsWith(SEAT_TOOL_PREFIX) && !SEAT_READ_RAW_NAMES.some((raw) => name === `${SEAT_TOOL_PREFIX}${raw}`);
}

/** The `mcp__<server>__` prefix (or `""` when bare) under which `name` carries
 * one of `raws` as its raw suffix; `undefined` when it carries none. */
function prefixBefore(name: string, raws: readonly string[]): string | undefined {
  const raw = raws.find((r) => name === r || name.endsWith(`__${r}`));
  return raw === undefined ? undefined : name.slice(0, name.length - raw.length);
}

/** Every approval policy this gate distinguishes. `never` is the one that
 * matters: it auto-rejects without reaching an answerer, so no card appears. */
export type ApprovalPolicyLike = "ask" | "never" | (string & {});

/** The pre-dispatch decision, structurally — the face does not depend on
 * `@deepseek-ai/dsh-tools` (it is not in `package.json`), and states the shapes
 * it needs rather than importing them, the same way `panels.ts` does.
 *
 * Mirrors NEW `packages/core/tools/src/index.ts:607-611`. dsh 0.2.0 widened it:
 * `cancel` (the canonical aborted result, `:1516-1518`), `deny.info` (a
 * structured `ToolErrorInfo`, carried into the result's `error.info`,
 * `:1520-1529`) and `ask.displayReason` (localized presentation, never
 * persisted — `packages/interaction/user-approval/src/types.ts:63-76`). The gate
 * never RETURNS `cancel` itself, but its listener hands an inner listener's
 * `next()` result through verbatim (e.g. `packages/experimental/auto-review/src/index.ts:694`),
 * so the type must admit it. `info` stays opaque here: the face never builds
 * or reads one. */
export type PreToolDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string; info?: unknown }
  | { kind: "cancel" }
  | { kind: "ask"; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } };

/** One registered tool as the registry advertises it. */
export interface ToolSchemaLike {
  name: string;
  description?: string;
}

/** Is this the name of a tool Gate 2 cards: one of the seat's twelve writes —
 * the raw name itself or any `mcp__<server>__<raw>` minting of it, so an
 * operator's server rename cannot slip a write past — or a tool under the
 * face's own seat prefix the face has not classified. */
export function isOrderTool(name: string): boolean {
  return isSeatWriteTool(name) || isUnclassifiedSeatTool(name);
}

/** Whether `name` is one of the Account seat's twelve write tools (by the same
 * raw-suffix rule). */
export function isSeatWriteTool(name: string): boolean {
  return prefixBefore(name, SEAT_WRITE_RAW_NAMES) !== undefined;
}

/** Reconstruct the policy an ask would resolve under, from PUBLIC surface only.
 *
 * `ApprovalService.effectivePolicy` is private (`dsh-user-approval`'s
 * `lib/types/index.d.ts:143`), but its body is exactly
 * `overrideOf(session) ?? config.policy ?? "ask"` (NEW
 * `packages/interaction/user-approval/src/index.ts:243-245`), and both halves
 * are public (`overrideOf` `:252-259`, `config` `:155`). Since 0.2.0
 * `overrideOf` walks `session.seq` / `session.eventAt(seq)` rather than the
 * removed `session.events` getter; the face only forwards the session. Reproduced rather than reached into, so a future
 * change to the private method surfaces here as a behaviour difference under
 * test instead of a runtime crash.
 * @param approval - the approval service, structurally.
 * @param session - the calling agent's session.
 * @returns the policy in force for this session right now.
 */
export function effectiveApprovalPolicy(
  approval: {
    overrideOf(session: unknown): ApprovalPolicyLike | undefined;
    config?: { policy?: ApprovalPolicyLike };
  },
  session: unknown,
): ApprovalPolicyLike {
  return approval.overrideOf(session) ?? approval.config?.policy ?? "ask";
}

/**
 * The gate's decision for one pending call.
 *
 * Returns `null` for anything that is not an order tool — the caller delegates
 * to `next()`, leaving every other tool exactly as it was — and for a retired
 * order tool ({@link RETIRED_ORDER_RAW_NAMES}), even one under the seat prefix:
 * the guard denies it regardless, so no card is raised for a call that cannot run.
 *
 * Under policy `never` this DENIES rather than asking. Returning `ask` there
 * would be worse than useless: `ApprovalService.request` short-circuits on
 * `never` before any answerer runs (NEW
 * `packages/interaction/user-approval/src/index.ts:275`), and `serviceAsk` then
 * renders that as `the user rejected tool "<name>"`
 * (NEW `packages/core/tools/src/index.ts:1754-1757`) — a sentence that is false, because
 * nobody was asked. The model would learn the operator refused an order they
 * never saw. Denying in our own words keeps the transcript honest, and makes
 * the gate un-disarmable by `DSH_PERMISSION_MODE=danger-full-access` or by a
 * runtime switch to the `danger-full-access` preset.
 *
 * An order tool the calling scope cannot SEE is denied first, before the
 * policy - whether it is not registered in this tree at all or this
 * session's preset hides it. Spike 3 measured that dsh runs the
 * `tools/pre-execute` waterfall before it resolves visibility (dsh-tools
 * `prepareExecution`, and only then `dispatchToolBody`'s `ToolNotFoundError`),
 * so a model that names such a tool still reaches this gate: the desk's or a
 * bot's masked one, and in the default configuration - Gate 1 closed, no
 * order tool registered - Gravit's too. Asking there would raise a card that
 * can only park with no browser, and an approved call would then fail
 * `unknown tool` at dispatch. Denying instead means an unregistered order
 * tool called from Gravit no longer raises a card that could never dispatch,
 * and under `never` no policy sentence sends the operator to a setting that
 * cannot help.
 * @param name - the registered tool name (`exec.name`).
 * @param policy - the session's effective approval policy.
 * @param args - `exec.arguments`, rendered onto the card so the human can decide.
 * @param visible - whether the calling scope resolves this tool
 *   (`tools.get(name, agent) !== undefined`, src/boot.ts armOrderGate). It
 *   defaults to `true`, the decision as it was before the gate could tell.
 * @returns the decision, or `null` when this call is none of our business.
 */
export function orderApprovalDecision(
  name: string,
  policy: ApprovalPolicyLike,
  args?: unknown,
  visible = true,
): PreToolDecision | null {
  if (!isOrderTool(name) || isRetiredOrderTool(name)) return null;
  if (!visible) {
    return {
      kind: "deny",
      reason: `${name} is not available to this session - it is not registered here, or this session's preset hides it - so no approval card is raised and the order does not run`,
    };
  }
  if (policy === "never") {
    return {
      kind: "deny",
      reason:
        `${name} needs a per-order approval card, and this session's approval policy is "never" - ` +
        `no card can be raised, so the order does not run. Nobody has refused it; nobody was asked. ` +
        `Clear DSH_PERMISSION_MODE=danger-full-access, or switch off the danger-full-access preset, ` +
        `and try again.`,
    };
  }
  /* A key field the card could not show whole is not asked about: a cut could
   * hide an address's tail or a payee's host, and an operator approving what
   * they cannot read is a click-through. Denied in our own words, nobody asked. */
  const bad = unshowableKeyField(args);
  if (bad !== undefined) {
    return {
      kind: "deny",
      reason: `${name}: its ${bad.key} ${bad.why}, so nothing was asked and the call does not run.`,
    };
  }
  /* Every card is the seat's, and says so: the face does not know a venue's
   * kind, and the Account's own card says PAPER in its own words. */
  const reason = `Account seat - ${describeOrder(name, args)}`;
  /* `displayReason` is what a localized approval UI prefers to render - the
   * upstream panel draws it INSTEAD of `reason` whenever it is present
   * (NEW packages/client/ui-approval/src/client/ApprovalPanel.tsx:17, fed by
   * `ApprovalRequestEvent.displayReason`, user-approval/src/types.ts:63-76);
   * `reason` is what the audit log keeps
   * (`approval/asked`, index.ts:224-230). Both carry the SAME order line, so
   * whichever field a client draws, the human sees symbol, side and size -
   * never a bare tool name. Presentation only: never persisted (types.ts:72). */
  return { kind: "ask", reason, displayReason: { en: reason } };
}

/** The argument keys the operator decides on — where a cut could hide what
 * matters (an address's tail, an id's tail, a venue, a symbol); a URL is its
 * own case ({@link urlWord}). */
const WHOLE_KEYS = ["venue", "from", "to", "symbol", "order", "asset", "account", "base", "order_id", "product", "body"];

/** The shape of a key the line writes bare: a key is never quoted, so one that
 * is not a name — `x venue`, `a=b`, `legs;` — could pass itself off as another
 * pair when the client reads the line back for its card's title; the gate
 * denies such a call before any card, at any depth. */
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Most characters a key field may have and still be shown whole on a card;
 * past it the call is denied rather than carded with a cut ({@link unshowableKeyField}). */
const MAX_KEY_FIELD = 120;

/** A payee's URL as the card may show it: whole, when it is http or https,
 * carries no userinfo, parses, and fits {@link MAX_KEY_FIELD} — else why not.
 * The text shown is the parsed `href`, the form the consumer resolves, so the
 * card and the venue agree on what was approved. */
function urlShown(value: unknown): { shown: string } | { why: string } {
  let u: URL;
  try {
    u = new URL(String(value));
  } catch {
    return { why: "does not parse" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { why: "is not http or https" };
  if (u.username !== "" || u.password !== "") return { why: "carries userinfo" };
  if (u.href.length > MAX_KEY_FIELD) return { why: `is ${u.href.length} characters, too long to show whole on a card` };
  return { shown: u.href };
}

/** The most legs a card shows: the Account takes at most ten in one batch. */
const MAX_LEGS = 10;

/** One scalar the card could not show whole under `key`'s rule, at `at`:
 * a key field too long, or a URL the card cannot show. */
function unshowableScalar(key: string, value: unknown, at: string): { key: string; why: string } | undefined {
  if (key === "url") {
    const u = urlShown(value);
    return "why" in u ? { key: at, why: u.why } : undefined;
  }
  if (!WHOLE_KEYS.includes(key)) return undefined;
  const text = String(value);
  return text.length > MAX_KEY_FIELD ? { key: at, why: `is ${text.length} characters, too long to show whole on a card` } : undefined;
}

/** The first value in `row` the card could not show, its path prefixed by
 * `path`: a key field too long or a URL the card cannot show — under its own
 * key, or its parent key's rule inside a list (`to[2]`, `url[1]`); a value
 * nested deeper than the one level a card draws (`depth` 1 is already inside
 * a nested object or a list entry: a card draws it as `?`, and what a card
 * cannot show it must not approve); a list longer than a card shows. */
function unshowableIn(row: Record<string, unknown>, path: string, depth: number): { key: string; why: string } | undefined {
  for (const [key, value] of Object.entries(row)) {
    const at = `${path}${key}`;
    if (!KEY_NAME.test(key)) return { key: `${path}${JSON.stringify(key)}`, why: "is not a name a card can show" };
    if (value === undefined || value === null) continue;
    if (typeof value !== "object") {
      const bad = unshowableScalar(key, value, at);
      if (bad !== undefined) return bad;
      continue;
    }
    if (depth > 0) return { key: at, why: "is nested deeper than a card shows" };
    if (!Array.isArray(value)) {
      const bad = unshowableIn(value as Record<string, unknown>, `${at}.`, 1);
      if (bad !== undefined) return bad;
      continue;
    }
    if (value.length > MAX_LEGS) return { key: at, why: `has ${value.length} entries, more than the ten a card shows` };
    for (const [i, entry] of value.entries()) {
      const here = `${at}[${i + 1}]`;
      if (entry === undefined || entry === null) continue;
      if (typeof entry !== "object") {
        const bad = unshowableScalar(key, entry, here);
        if (bad !== undefined) return bad;
        continue;
      }
      if (Array.isArray(entry)) return { key: here, why: "is nested deeper than a card shows" };
      const bad = unshowableIn(entry as Record<string, unknown>, `${here}.`, 1);
      if (bad !== undefined) return bad;
    }
  }
  return undefined;
}

/** The first thing the card could not show whole — a key field too long, a
 * URL that is not http(s), carries userinfo or does not parse, a value nested
 * deeper than a card draws, a list longer than a card shows — at the top
 * level, inside a nested object (`intent.to`) or inside a list's entries
 * (`legs[2].symbol`, `to[1]`), so the gate denies the call instead of raising
 * a card with a cut or a `?` that could hide what matters; `undefined` when
 * everything can be shown. */
function unshowableKeyField(args: unknown): { key: string; why: string } | undefined {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return undefined;
  return unshowableIn(args as Record<string, unknown>, "", 0);
}

/** One line an operator can actually decide on.
 *
 * The approval card renders `reason` (or its `displayReason` twin) and nothing
 * else - `ApprovalRequestEvent` carries agent, toolName, callId, reason,
 * displayReason and signal and NO tool arguments (NEW
 * `packages/interaction/user-approval/src/types.ts:63-76`), and the `$events`
 * waterfall frame the face draws from projects the same minus agent and signal
 * (`packages/api/gateway/src/stream-protocol.ts:52-58, 146-173`). So if the order's symbol, side and size are not IN this
 * string, the human is approving a tool NAME, which is a click-through, not a
 * decision.
 *
 * Deliberately total and defensive: this runs inside a gate, and a throw here
 * would propagate out of the listener. Anything unexpected degrades to the tool
 * name rather than losing the card.
 * @param name - the registered tool name, the fallback when arguments are odd.
 * @param args - `exec.arguments`, already frozen and JSON-safe by the registry.
 * @returns a compact human-readable summary, never empty.
 */
export function describeOrder(name: string, args: unknown): string {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return name;
  const summary = pairsOf(args as Record<string, unknown>, 0);
  return summary === "" ? name : `${name}: ${summary}`;
}

/* The Account seat's keys (portfolio_live_order's venue, symbol, side, orderType, qty or
 * usd, limitPrice, stopPrice; amend and cancel's order; move's kind, from,
 * asset, amount; leverage; pay's url and maxAmount), with the snake_case
 * spellings an order key may also arrive in, in a readable order:
 * side, size, symbol, type, then the venue. The same order inside a batch's
 * legs and a nested object. Unknown keys are appended rather than dropped, so
 * a tool that grows a field still shows it (charter Rule 5: what is never
 * surfaced is never governed). */
const KNOWN_KEYS = [
  "side", "qty", "usd", "symbol", "order_type", "orderType", "limit_price", "limitPrice", "stopPrice", "order_id", "order",
  "venue", "kind", "from", "asset", "product", "amount", "leverage", "url", "maxAmount", "method", "body",
];

/** One scalar on the card. Model-controlled text on the operator's only line
 * of information: bound it so a crafted field cannot push a plausible
 * sentence past the real one — but never cut what the operator decides on: a
 * payee's URL, an address, an id, a venue or a symbol is shown WHOLE up to
 * MAX_KEY_FIELD, and a call whose key field cannot be shown whole is denied
 * before any card ({@link unshowableKeyField}); the cuts below those keys
 * never reach a card and only keep this function total. */
function scalarWord(key: string, value: unknown): string {
  if (key === "url") {
    const u = urlShown(value);
    return "shown" in u ? shown(u.shown) : "?";
  }
  const text = String(value);
  if (WHOLE_KEYS.includes(key)) return shown(text.length > MAX_KEY_FIELD ? `${text.slice(0, MAX_KEY_FIELD)}…` : text);
  return shown(text.length > 40 ? `${text.slice(0, 40)}…` : text);
}

/** A value as the line carries it: bare when it reads back as one word, else a
 * JSON string. The client titles its card from this line and nothing else
 * (`face/client/js/host/kinds.js` `reasonArgs`), so a value carrying
 * whitespace, a quote, a bracket or a semicolon — which could pass itself off
 * as another pair, a leg or the end of one — is quoted, cut first where it is cut. */
function shown(text: string): string {
  return /^[^\s"[\]{};]*$/.test(text) ? text : JSON.stringify(text);
}

/** A nested value on the card: a list as `[1: …; 2: …]` (a batch's legs, each
 * described as an order; a scalar entry by its parent key's rule), an object
 * as `{k=v …}`; one level only — deeper is `?`, which the gate never lets a
 * card approve ({@link unshowableKeyField}). */
function nestedWord(value: object, key: string): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry, i) => {
      const word = entry === null || entry === undefined ? "?"
        : typeof entry === "object" ? (Array.isArray(entry) ? "?" : pairsOf(entry as Record<string, unknown>, 1))
          : scalarWord(key, entry);
      return `${i + 1}: ${word}`;
    }).join("; ")}]`;
  }
  return `{${pairsOf(value as Record<string, unknown>, 1)}}`;
}

/** `key=value` pairs of one object, the known keys first in their readable
 * order, then the rest; a nested object or list one level deep at the top
 * (`depth` 0), `?` below that. */
function pairsOf(row: Record<string, unknown>, depth: number): string {
  const word = (key: string): string | undefined => {
    const value = row[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value === "object") return depth === 0 ? nestedWord(value, key) : "?";
    return scalarWord(key, value);
  };
  const parts = KNOWN_KEYS.map((key) => {
    const value = word(key);
    return value === undefined ? undefined : `${key}=${value}`;
  }).filter((part): part is string => part !== undefined);
  const extra = Object.keys(row)
    .filter((key) => !KNOWN_KEYS.includes(key))
    .map((key) => {
      const value = word(key);
      return value === undefined ? `${key}=?` : `${key}=${value}`;
    });
  return [...parts, ...extra].join(" ");
}

/** One session event, structurally - only the fields the grant check reads. */
export interface ApprovalEventLike {
  type: string;
  data?: { id?: unknown; callId?: unknown; outcome?: unknown; toolName?: unknown };
}

/**
 * Did THIS call actually receive an operator grant?
 *
 * `ApprovalService.request` appends `approval/asked` (carrying `callId` and a
 * fresh `id`) and then `approval/decided` (carrying that `id` and the outcome)
 * - NEW `packages/interaction/user-approval/src/index.ts:224-233`, payloads at
 * `src/types.ts:44-58`. Both appends are synchronous and complete before
 * `request` resolves, so they are in the log before the guard runs (tools
 * `index.ts:1509-1519`). `allowed-once` is the ONLY outcome the tools layer
 * turns into an allow (NEW `packages/core/tools/src/index.ts:1753`), so it is
 * the only one that counts as a grant here.
 *
 * This is what the guard asks instead of "did my listener SEE this call". A
 * sighting is not an approval: a `tools/pre-execute` listener registered outside
 * this gate can take our `ask` and return `allow`, and a sighting-based guard
 * would wave that through. Only the log proves a human said yes.
 * @param events - the session log, `exec.agent.session.snapshotEvents()` (the
 *   `session.events` getter was removed in dsh 0.2.0 — see {@link orderGuardReasonForSession}).
 * @param callId - `exec.callId`.
 * @param toolName - `exec.name`, so a grant for another tool cannot be replayed.
 * @returns true only when this call has a logged `allowed-once` for this tool.
 */
export function hasApprovalGrant(
  events: readonly ApprovalEventLike[],
  callId: unknown,
  toolName?: string,
): boolean {
  if (callId === undefined || callId === null) return false;
  const granted = new Set<unknown>();
  for (const event of events) {
    if (event.type !== "approval/asked") continue;
    if (event.data?.callId !== callId) continue;
    /* `callId` is the MODEL's tool-call id (`dsh-agent-loop` sets it from the
     * block id), so it is not by itself proof of WHICH tool was approved. The
     * asked event records the tool name; require it to match, so a grant won
     * for some other approval-requiring call cannot be replayed onto an order. */
    if (toolName !== undefined && event.data?.toolName !== toolName) continue;
    /* An id-less asked event cannot pair with anything: skipping it stops a
     * malformed pair from matching an equally id-less decided event. */
    if (event.data?.id === undefined) continue;
    granted.add(event.data.id);
  }
  if (granted.size === 0) return false;
  return events.some((event) =>
    event.type === "approval/decided" &&
    granted.has(event.data?.id) &&
    event.data?.outcome === "allowed-once"
  );
}

/** What {@link auditOrderTools} found in the live registry. */
export interface OrderToolAudit {
  /** Registered tools this gate covers. */
  gated: string[];
  /** Each server prefix (`mcp__<server>__`, `""` when bare) that carries the
   * seat's tools while the gate covers none of them — the seat is mounted and
   * Gate 2 would cover nothing of it. Boot refuses on any of these. */
  uncovered: string[];
  /** Registered retired order tools ({@link RETIRED_ORDER_RAW_NAMES}) under any
   * server name — an order path that is not the seat. Boot refuses on any of these. */
  retired: string[];
}

/**
 * Cross-check the live registry against the seat's lists.
 *
 * The REGISTRY is the only honest source of whether the seat's writes are
 * live, and this reads it. A server carrying the seat's tools — its classified
 * reads or writes by raw suffix, or anything under the face's own seat prefix
 * — is a mounted seat; one of them the gate covers none of means the Account
 * renamed its writes and they no longer match {@link SEAT_WRITE_RAW_NAMES}.
 * That is the failure this whole module exists to prevent, and it would
 * otherwise be invisible — the face would come up healthy with the gate quietly
 * covering nothing. (Under the face's own prefix a renamed write is carded as
 * unclassified, so only a seat under another server name can land here.) The
 * seat registers its writes with its reads, in one listing, so a seat with
 * reads and no write is never a normal state.
 * @param schemas - `ctx.tools.schemas()`, the live registry.
 * @returns the covered names, the seats the gate covers nothing of, and the retired order tools.
 */
export function auditOrderTools(schemas: readonly ToolSchemaLike[]): OrderToolAudit {
  const gated: string[] = [];
  const retired: string[] = [];
  const seats = new Set<string>();
  const covered = new Set<string>();
  for (const { name } of schemas) {
    if (isRetiredOrderTool(name)) retired.push(name);
    const seat = prefixBefore(name, [...SEAT_WRITE_RAW_NAMES, ...SEAT_READ_RAW_NAMES])
      ?? (name.startsWith(SEAT_TOOL_PREFIX) ? SEAT_TOOL_PREFIX : undefined);
    if (seat !== undefined) seats.add(seat);
    if (!isOrderTool(name)) continue;
    gated.push(name);
    if (seat !== undefined) covered.add(seat);
  }
  return { gated, uncovered: [...seats].filter((seat) => !covered.has(seat)), retired };
}

/**
 * The guard's whole decision, as a pure function.
 *
 * Extracted so it can be drilled: a guard is evaluated on every allow and is the
 * only monotonic layer here, which makes it the piece that most needs testing
 * and the piece hardest to reach through the pipeline. Charter Rule 4 - a guard
 * that has never been drilled is presumed broken. It reads the name alone,
 * per call, so a seat write that registered AFTER boot (dsh-mcp-client
 * activates even when its first connection failed) is guarded all the same,
 * and a retired order tool is denied outright, whatever the log holds.
 * @param name - `exec.name`.
 * @param events - the session log (`snapshotEvents()`), when there is a
 *   session. `undefined` means "no session", i.e. no log that could hold a
 *   grant; a session whose log cannot be READ is a different failure and is
 *   told apart by {@link orderGuardReasonForSession}, never passed here as undefined.
 * @param callId - `exec.callId`.
 * @returns a denial reason, or `undefined` to let the call through.
 */
export function orderGuardReason(
  name: string,
  events: readonly ApprovalEventLike[] | undefined,
  callId: unknown,
): string | undefined {
  if (isRetiredOrderTool(name)) return retiredReason(name);
  if (!isOrderTool(name)) return undefined;
  if (events !== undefined && hasApprovalGrant(events, callId, name)) return undefined;
  return `${name} reached dispatch without a logged allowed-once approval for this call`;
}

/** A calling session as the guard reads it, structurally. dsh 0.2.0 removed the
 * `Session.events` getter (commit 5660f44d29); the synchronous full-log read
 * is now `snapshotEvents()` (NEW `packages/core/session/src/index.ts:649-661`).
 * It is `@deprecated` for NEW production callers upstream
 * (`.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`);
 * the upstream-compliant successor is a live grant index fed by
 * `ctx.on('session/event', …)` (declared `session/src/index.ts:66-77`) — the
 * forward path if a later pin removes this method. Optional here ON PURPOSE:
 * its absence is exactly the drift this module must detect, not assume away. */
export interface GuardSessionLike {
  snapshotEvents?: () => readonly ApprovalEventLike[];
}

/** The denial for a gated call whose session log cannot be read.
 *
 * Distinct from "no grant" on purpose. At 0.2.0 the old read
 * (`exec.agent.session.events`) silently became `undefined`, and the guard
 * reported every APPROVED order as "reached dispatch without a logged
 * allowed-once approval" — true-sounding, fail-closed, and hiding the real
 * cause: the face could no longer read the log at all. An unreadable log and a
 * missing grant must never be the same sentence (PLAN S7 item 1, MAP gate2 §2(1)).
 * @param name - `exec.name`.
 * @param why - which way the read failed; the default is the 0.2.0 drift
 *   shape (the method is simply not there). This module is the sentence's
 *   ONLY producer: `boot.ts`'s `tools.guard` calls
 *   {@link orderGuardReasonForSession} directly, so the text a test pins here
 *   is the text the live guard denies with.
 * @returns the denial text. */
export function unreadableSessionLogReason(name: string, why = "no snapshotEvents"): string {
  return `${name}: cannot read this session's log to verify an allowed-once approval (dsh Session API changed: ${why})`;
}

/**
 * The guard's decision given the calling SESSION rather than its events:
 * the one function `boot.ts`'s `tools.guard` calls.
 *
 * A retired order tool is denied first, in its own sentence, whatever the
 * session. Then three cases, each with its own sentence:
 * - no session (an agentless call): no log could hold a grant, so a gated
 *   call gets {@link orderGuardReason}'s "without a logged allowed-once";
 * - a session with no `snapshotEvents` function, or one that throws: the
 *   log is UNREADABLE → {@link unreadableSessionLogReason} (fail closed, and
 *   say why);
 * - otherwise the ordinary grant check over `snapshotEvents()`.
 *
 * Non-gated tools return `undefined` before the session is touched, so a
 * drifted Session API can never brick a tool this gate does not own.
 * @param name - `exec.name`.
 * @param session - `exec.agent?.session`. Typed `unknown` on purpose: the
 *   caller must not have to assert a shape this function exists to CHECK
 *   (a `GuardSessionLike` parameter would also reject, at compile time, the
 *   very drifted session the runtime branch below handles).
 * @param callId - `exec.callId`.
 * @returns a denial reason, or `undefined` to let the call through.
 */
export function orderGuardReasonForSession(
  name: string,
  session: unknown,
  callId: unknown,
): string | undefined {
  if (isRetiredOrderTool(name)) return retiredReason(name);
  if (!isOrderTool(name)) return undefined;
  if (session === undefined || session === null) return orderGuardReason(name, undefined, callId);
  const read = typeof session === "object" || typeof session === "function"
    ? (session as GuardSessionLike).snapshotEvents
    : undefined;
  if (typeof read !== "function") return unreadableSessionLogReason(name);
  let events: readonly ApprovalEventLike[];
  try {
    events = read.call(session);
  } catch {
    return unreadableSessionLogReason(name, "snapshotEvents threw");
  }
  if (!Array.isArray(events)) return unreadableSessionLogReason(name, "snapshotEvents returned no event list");
  return orderGuardReason(name, events, callId);
}
