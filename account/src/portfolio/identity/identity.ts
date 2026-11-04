/** ACCOUNT › IDENTITY — the service the rest of the account talks to about the networks Gravit speaks on.
 *
 * It holds the pending connection of Connect's sheets 1 to 3 (pending.ts), the strangers (store.ts Strangers), the identity state
 * (store.ts: bindings, routing, quiet hours, blocked) and — from Task 4 — the connected poller. The four owner types land here once the
 * door (account/exchange.ts) has checked the signature, the owner, the nonce and, for a connect, the ten minutes:
 *
 *   connectNetwork     the pending connection named is checked — the token held since sheet 1 against the fingerprint signed (keyMatches),
 *                      the bot against the bot signed, the person heard against the person signed — and only then taken: the token
 *                      written to <home>/credentials/networks/<network>.json (secret-file.ts), then the binding and the routing signed to
 *                      the state, then the connector started at the offset after the message heard. A refusal leaves the pending
 *                      connection where it was, so the owner can still sign the right one.
 *   disconnectNetwork  the connector stopped, the token file removed, the binding and the network's routing ticks gone.
 *   setRouting         the routing string (kinds.ts parseRouting) and quiet hours; both times "" turns quiet hours off, stored as null
 *                      (the store reads an empty pair as the 23:00–07:00 default, so an empty pair would turn them on after a restart).
 *   blockSender        a stranger out of Not you, their reference kept blocked.
 *
 * `problem` is what the door and /api/account/prepare both refuse, in IDENTITY_WORDS' fixed words, never repeating what was sent. The token
 * is in no answer, no summary, no log line and no ledger row: the summary of a connect names the token by its fingerprint only. */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { fingerprintOf, keyMatches } from "../account/brain-keys.ts";
import type { Outcome } from "../account/exchange.ts";
import type { OwnerAction } from "../account/sign.ts";
import { no } from "../refuse.ts";
import { formatRouting, isClock, NETWORKS, parseRouting, type Network, type Routing } from "./kinds.ts";
import { PendingConnections } from "./pending.ts";
import { IDENTITY_WORDS } from "./routes.ts";
import { removeNetworkSecret, writeNetworkSecret } from "./secret-file.ts";
import { loadIdentity, maskId, saveIdentity, Strangers, type Binding, type IdentityState, type Stranger } from "./store.ts";

export type IdentityAction = Extract<OwnerAction, { type: "connectNetwork" | "disconnectNetwork" | "setRouting" | "blockSender" }>;
export const IDENTITY_TYPES: ReadonlySet<string> = new Set(["connectNetwork", "disconnectNetwork", "setRouting", "blockSender"]);
export const isIdentityAction = (a: { type: string }): a is IdentityAction => IDENTITY_TYPES.has(a.type);

export interface IdentityDeps {
  home: string;
  apiBase: string;
  fetch?: typeof fetch | undefined;
  pollTimeoutS?: number | undefined;
  now?: (() => number) | undefined;
  log?: ((l: string) => void) | undefined;
}

export type IdentityView = {
  ok: true;
  networks: Array<Omit<Binding, "botId" | "operatorId"> & { state: "connected"; polling: boolean; lastPollAt?: string; conflictAt?: string; blocked?: true; pollFailing?: { since: string; reason: string } }>;
  routing: Routing;
  quiet: { from: string; to: string; zone: "America/New_York" } | null;
  strangers: Stranger[];
};

const HASH = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{32}$/;
const REF = /^[0-9a-f]{12}$/;
const MASKED = /^…\d{1,3}$/;
/** a bot token anywhere in a text (pending.ts TOKEN_SHAPE, unanchored) */
const TOKEN_ANYWHERE = /\d{5,16}:[A-Za-z0-9_-]{30,}/;

const isNetwork = (s: string): s is Network => (NETWORKS as readonly string[]).includes(s);
const NETWORK_NAME: Record<Network, string> = { telegram: "Telegram" };

/** A bot token pasted into any field of the four types: refused before the door writes its "taken" row, which carries the signed fields to
 * the ledger (hash-chained, never cleaned) — and before /prepare says the fields back. Fixed words; the value is never repeated */
export function identitySignedProblem(a: IdentityAction): string | null {
  for (const [k, v] of Object.entries(a)) if (k !== "type" && typeof v === "string" && TOKEN_ANYWHERE.test(v)) return IDENTITY_WORDS.tokenInField;
  return null;
}

const refusal = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { message });

export class Identity {
  readonly pending: PendingConnections;
  private readonly home: string;
  private readonly now: () => number;
  private readonly store: Strangers;

  constructor(deps: IdentityDeps) {
    this.home = deps.home;
    this.now = deps.now ?? Date.now;
    this.store = new Strangers(deps.home);
    this.pending = new PendingConnections({ apiBase: deps.apiBase, strangers: this.store, bound: () => this.bound("telegram") !== undefined, fetch: deps.fetch, pollTimeoutS: deps.pollTimeoutS, now: deps.now, log: deps.log });
  }

  /** the Identity tab: the bindings without their numeric ids, the routing, quiet hours on New York's clock, Not you */
  view(): IdentityView {
    const s = this.state;
    return {
      ok: true,
      networks: s.bindings.map(({ botId: _b, operatorId: _o, ...b }) => ({ ...b, state: "connected" as const, polling: this.polling(b.network) })),
      routing: s.routing,
      quiet: s.quiet ? { ...s.quiet, zone: "America/New_York" } : null,
      strangers: this.store.list(),
    };
  }

  strangers(): Stranger[] {
    return this.store.list();
  }

  /** Why the account would refuse this action now, or null — at /api/account/prepare and again at the door. Nothing is taken or changed */
  problem(a: IdentityAction): string | null {
    const signed = identitySignedProblem(a);
    if (signed) return signed;
    switch (a.type) {
      case "connectNetwork": {
        if (!isNetwork(a.network)) return IDENTITY_WORDS.network;
        if (!HASH.test(a.keyHash) || !SALT.test(a.salt)) return IDENTITY_WORDS.hashShape;
        const routing = parseRouting(a.routing);
        if (typeof routing === "string") return routing;
        if (this.bound(a.network)) return IDENTITY_WORDS.connected;
        if (Object.values(routing).some((nets) => nets.some((x) => x !== a.network && !this.bound(x)))) return IDENTITY_WORDS.routedNotConnected;
        const p = this.pending.peek(a.pending);
        if (!p) return IDENTITY_WORDS.noPending;
        if (!keyMatches(a.salt, p.token, a.keyHash)) return IDENTITY_WORDS.mismatch;
        if (a.botId !== p.bot.id || a.speaksAs !== `@${p.bot.username}`) return IDENTITY_WORDS.botMismatch;
        if (a.operatorId !== p.sender.id || a.talksOnlyWith !== operatorHandleOf(p.sender)) return IDENTITY_WORDS.senderMismatch;
        return null;
      }
      case "disconnectNetwork":
        if (!isNetwork(a.network)) return IDENTITY_WORDS.network;
        return this.bound(a.network) ? null : IDENTITY_WORDS.notConnected;
      case "setRouting": {
        const routing = parseRouting(a.routing);
        if (typeof routing === "string") return routing;
        if (Object.values(routing).some((nets) => nets.some((x) => !this.bound(x)))) return IDENTITY_WORDS.routedNotConnected;
        if (a.quietFrom === "" && a.quietTo === "") return null;
        if (!isClock(a.quietFrom) || !isClock(a.quietTo)) return IDENTITY_WORDS.quietTime;
        return a.quietFrom === a.quietTo ? IDENTITY_WORDS.quietEqual : null;
      }
      case "blockSender": {
        if (!isNetwork(a.network)) return IDENTITY_WORDS.network;
        if (!REF.test(a.sender) || !MASKED.test(a.masked)) return IDENTITY_WORDS.blockShape;
        const listed = this.store.list().find((s) => s.network === a.network && s.sender === a.sender);
        return listed && listed.masked !== a.masked ? IDENTITY_WORDS.blockMismatch : null;
      }
    }
  }

  /** The four owner types, once the door has checked the signature: refused as `problem` says, else done and said in one line */
  async apply(a: IdentityAction): Promise<Outcome> {
    const wrong = this.problem(a);
    if (wrong) return refusal(wrong);
    switch (a.type) {
      case "connectNetwork":
        return this.connect(a);
      case "disconnectNetwork":
        return this.disconnect(a);
      case "setRouting": {
        const routing = parseRouting(a.routing) as Routing;
        // quiet hours off is null — never {from: "", to: ""}, which the store would read back as the default
        const quiet = a.quietFrom === "" && a.quietTo === "" ? null : { from: a.quietFrom, to: a.quietTo };
        const saved = this.save({ ...this.state, routing, quiet });
        if (saved) return saved;
        return { ok: true, kind: "account", summary: `routing saved: ${formatRouting(routing)} · ${quiet ? `quiet hours ${quiet.from}–${quiet.to} New York time` : "quiet hours off"}` };
      }
      case "blockSender": {
        const s = this.state;
        const saved = this.save({ ...s, blocked: s.blocked.includes(a.sender) ? s.blocked : [...s.blocked, a.sender] });
        if (saved) return saved;
        try {
          this.store.remove(a.sender);
        } catch {
          // blocked all the same: the state file says so, and the row is taken out of Not you at the next write of the strangers file
        }
        return { ok: true, kind: "account", summary: `sender ${a.masked} on ${NETWORK_NAME[a.network as Network]} blocked` };
      }
    }
  }

  async dispose(): Promise<void> {
    this.pending.dispose();
  }

  // ---- inside ----

  /** the state as its file says it now: read each time, so the file is the one record (cheap — a few hundred bytes) */
  private get state(): IdentityState {
    return loadIdentity(this.home);
  }

  private bound(network: string): Binding | undefined {
    return this.state.bindings.find((b) => b.network === network);
  }

  /** the state written whole, or the refusal that says it could not be (the file left as it was) */
  private save(next: IdentityState): Refusal | undefined {
    try {
      saveIdentity(this.home, next);
    } catch (err) {
      return refusal(`the identity state could not be written (${err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.name) : "error"}): nothing changed`);
    }
    return undefined;
  }

  private async connect(a: Extract<IdentityAction, { type: "connectNetwork" }>): Promise<Outcome> {
    const network = a.network as Network;
    const taken = this.pending.take(a.pending);
    // problem() peeked this very connection a moment ago, in the door's one line: checked again on what was taken, whatever happened between
    if (!taken) return refusal(IDENTITY_WORDS.noPending);
    if (!keyMatches(a.salt, taken.token, a.keyHash)) return refusal(IDENTITY_WORDS.mismatch);
    const written = writeNetworkSecret(this.home, network, { token: taken.token, botId: taken.bot.id, username: taken.bot.username, operatorId: taken.sender.id, operatorHandle: a.talksOnlyWith });
    if (isRefusal(written)) return written;
    const fingerprint = fingerprintOf(a.keyHash);
    const binding: Binding = { network, speaksAs: a.speaksAs, botId: a.botId, talksOnlyWith: a.talksOnlyWith, operatorId: a.operatorId, since: new Date(this.now()).toISOString(), fingerprint };
    const s = this.state;
    const saved = this.save({ ...s, bindings: [...s.bindings.filter((b) => b.network !== network), binding], routing: parseRouting(a.routing) as Routing });
    if (saved) {
      // no binding, no token: the file just written is taken away again
      removeNetworkSecret(this.home, network);
      return saved;
    }
    this.startConnector(binding, taken.token, taken.offset);
    return { ok: true, kind: "account", summary: `${NETWORK_NAME[network]} connected: Gravit speaks as ${a.speaksAs} and talks only with ${a.talksOnlyWith} · token ${fingerprint}` };
  }

  private async disconnect(a: Extract<IdentityAction, { type: "disconnectNetwork" }>): Promise<Outcome> {
    const network = a.network as Network;
    this.stopConnector(network);
    const removed = removeNetworkSecret(this.home, network);
    if (isRefusal(removed)) return removed;
    const s = this.state;
    const routing = { ...s.routing };
    for (const row of Object.keys(routing) as Array<keyof Routing>) routing[row] = routing[row].filter((x) => x !== network);
    const saved = this.save({ ...s, bindings: s.bindings.filter((b) => b.network !== network), routing });
    if (saved) return saved;
    return { ok: true, kind: "account", summary: `${NETWORK_NAME[network]} disconnected: its token removed from the account` };
  }

  /** the connected poller (Task 4): started at the offset after the message the operator was heard by. Until then, nothing polls */
  private startConnector(_binding: Binding, _token: string, _offset: number): void {}

  private stopConnector(_network: Network): void {}

  private polling(_network: Network): boolean {
    return false;
  }
}

/** the operator's handle as sheet 3 showed it: their @username, or their masked id when they have none */
const operatorHandleOf = (sender: { id: string; handle: string }): string => (sender.handle !== "" ? sender.handle : maskId(sender.id));
