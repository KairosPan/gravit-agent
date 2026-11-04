/** ACCOUNT › IDENTITY — the service the rest of the account talks to about the networks Gravit speaks on.
 *
 * It holds the pending connection of Connect's sheets 1 to 3 (pending.ts), the strangers (store.ts Strangers), the identity state
 * (store.ts: bindings, routing, quiet hours, blocked), the connected poller (telegram.ts TelegramConnector) and the inbox it fills
 * (inbox.ts InboxRing), which the face's desk long-polls (`inbox`). The poller starts when the service is created on a home that holds a
 * binding and its token file, and at a connect; a disconnect stops it. The four owner types land here once the
 * door (account/exchange.ts) has checked the signature, the owner, the nonce and, for a connect, the ten minutes:
 *
 *   connectNetwork     the pending connection named is checked — the token held since sheet 1 against the fingerprint signed (keyMatches),
 *                      the bot against the bot signed, the person heard against the person signed — and only then taken: the token
 *                      written to <home>/credentials/networks/<network>.json (secret-file.ts), then the binding and the routing signed to
 *                      the state, then the connector started at the offset after the message heard. A refusal leaves the pending
 *                      connection where it was, so the owner can still sign the right one.
 *   disconnectNetwork  the binding and the network's routing ticks gone from the state first, then the connector stopped and the token
 *                      file removed — so a state that cannot be written leaves everything as it was, the poller still running.
 *   setRouting         the routing string (kinds.ts parseRouting) and quiet hours; both times "" turns quiet hours off, stored as null
 *                      (the store reads an empty pair as the 23:00–07:00 default, so an empty pair would turn them on after a restart).
 *   blockSender        a stranger out of Not you, their reference kept blocked.
 *
 * `problem` is what the door and /api/account/prepare both refuse, in IDENTITY_WORDS' fixed words, never repeating what was sent. The token
 * is in no answer, no summary, no log line and no ledger row: the summary of a connect names the token by its fingerprint only. */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fingerprintOf, keyMatches } from "../account/brain-keys.ts";
import type { Outcome } from "../account/exchange.ts";
import type { OwnerAction } from "../account/sign.ts";
import { no } from "../refuse.ts";
import { formatRouting, isClock, NETWORKS, parseRouting, type Network, type Routing } from "./kinds.ts";
import { BotApi, redactorOf } from "./bot-api.ts";
import { InboxRing, type InboxMessage } from "./inbox.ts";
import { PendingConnections } from "./pending.ts";
import { IDENTITY_WORDS } from "./routes.ts";
import { readNetworkSecret, removeNetworkSecret, writeNetworkSecret } from "./secret-file.ts";
import { BLOCKED_MAX, identityDir, loadIdentity, maskId, saveIdentity, Strangers, writeIdentityFile, type Binding, type IdentityState, type Stranger } from "./store.ts";
import { OFFSET_FILE, realClock, TelegramConnector, type IdentityClock, type NetworkStatus } from "./telegram.ts";

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
  /** the connected poller's clock (real timers on `now` by default) and its long poll in seconds (50) */
  clock?: IdentityClock | undefined;
  connectedPollTimeoutS?: number | undefined;
}

/** what the face's desk reads: how the phone stands beside the messages */
export interface PhoneStatusWire {
  networks: NetworkStatus[];
  /** messages waiting to be sent (the outbox, Task 5): none yet */
  queued: number;
  /** how many strangers Not you lists */
  strangers: number;
}

export interface InboxAnswer {
  ok: true;
  messages: InboxMessage[];
  last: number;
  status: PhoneStatusWire;
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
  readonly inboxRing: InboxRing;
  private readonly home: string;
  private readonly now: () => number;
  private readonly store: Strangers;
  private readonly log: (l: string) => void;
  private readonly clock: IdentityClock;
  private readonly connectors = new Map<Network, { connector: TelegramConnector; stop: AbortController }>();

  constructor(private readonly deps: IdentityDeps) {
    this.home = deps.home;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((l) => console.error(l));
    this.clock = deps.clock ?? realClock(this.now);
    this.store = new Strangers(deps.home);
    this.inboxRing = new InboxRing(deps.home);
    this.pending = new PendingConnections({ apiBase: deps.apiBase, strangers: this.store, bound: () => this.bound("telegram") !== undefined, fetch: deps.fetch, pollTimeoutS: deps.pollTimeoutS, now: deps.now, log: deps.log });
    this.resume();
  }

  /** The face's desk: the operator's messages numbered above `after`, waiting up to `waitMs` for one when there is none past it — at once
   * when `after` is past the last (a cursor ahead of a fresh home's ring, which the face starts again from). Never changes the inbox */
  async inbox(after: number, waitMs: number, signal?: AbortSignal): Promise<InboxAnswer> {
    if (after === this.inboxRing.last() && waitMs > 0) await this.inboxRing.wait(after, waitMs, signal);
    return { ok: true, messages: this.inboxRing.after(after), last: this.inboxRing.last(), status: this.phoneStatus() };
  }

  phoneStatus(): PhoneStatusWire {
    return { networks: this.state.bindings.map((b) => this.statusOf(b.network)), queued: 0, strangers: this.store.list().length };
  }

  /** the Identity tab: the bindings without their numeric ids, the routing, quiet hours on New York's clock, Not you */
  view(): IdentityView {
    const s = this.state;
    return {
      ok: true,
      networks: s.bindings.map(({ botId: _b, operatorId: _o, ...b }) => {
        const { network: _n, ...st } = this.statusOf(b.network);
        return { ...b, state: "connected" as const, ...st };
      }),
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
        // the one blocked longest ago leaves first past BLOCKED_MAX
        const saved = this.save({ ...s, blocked: s.blocked.includes(a.sender) ? s.blocked : [...s.blocked, a.sender].slice(-BLOCKED_MAX) });
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
    await Promise.all([...this.connectors.keys()].map((n) => this.stopConnector(n)));
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
      const left = this.removeSecret(network);
      return left ? refusal(`${saved.message}; and ${left}`) : saved;
    }
    this.startConnector(binding, taken.token, taken.offset);
    return { ok: true, kind: "account", summary: `${NETWORK_NAME[network]} connected: Gravit speaks as ${a.speaksAs} and talks only with ${a.talksOnlyWith} · token ${fingerprint}` };
  }

  private async disconnect(a: Extract<IdentityAction, { type: "disconnectNetwork" }>): Promise<Outcome> {
    const network = a.network as Network;
    const s = this.state;
    const routing = { ...s.routing };
    for (const row of Object.keys(routing) as Array<keyof Routing>) routing[row] = routing[row].filter((x) => x !== network);
    // the state first: one that cannot be written leaves the binding, the token file and the poller as they were
    const saved = this.save({ ...s, bindings: s.bindings.filter((b) => b.network !== network), routing });
    if (saved) return saved;
    await this.stopConnector(network);
    const left = this.removeSecret(network);
    if (left) return refusal(`${NETWORK_NAME[network]} is disconnected and its poller stopped, but ${left}`);
    return { ok: true, kind: "account", summary: `${NETWORK_NAME[network]} disconnected: its token removed from the account` };
  }

  /** the token file taken away; what went wrong in words (no token, no path outside the home), or undefined when it is gone */
  private removeSecret(network: Network): string | undefined {
    try {
      const r = removeNetworkSecret(this.home, network);
      return isRefusal(r) ? `its token file could not be removed: ${r.message}` : undefined;
    } catch (err) {
      return `its token file could not be removed (${err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.name) : "error"})`;
    }
  }

  /** at service creation: a binding whose token file is there polls again from the offset kept */
  private resume(): void {
    for (const b of this.state.bindings) {
      const secret = readNetworkSecret(this.home, b.network);
      if (!secret || secret.operatorId !== b.operatorId || secret.botId !== b.botId) continue;
      this.startConnector(b, secret.token, this.readOffset(b.network));
    }
  }

  private readOffset(network: Network): number | undefined {
    if (network !== "telegram") return undefined;
    try {
      const n = Number(readFileSync(join(identityDir(this.home), OFFSET_FILE), "utf8").trim());
      return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
    } catch {
      return undefined;
    }
  }

  /** the connected poller, from `offset` on: the offset written first — after a connect, the one after the message the operator was heard
   * by, so their /start is not taken into the inbox */
  private startConnector(binding: Binding, token: string, offset: number | undefined): void {
    if (this.connectors.has(binding.network)) return;
    if (offset !== undefined) {
      try {
        writeIdentityFile(this.home, OFFSET_FILE, `${offset}\n`);
      } catch (err) {
        this.log(`identity: Telegram's offset could not be written (${err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.name) : "error"}); the poll starts from it all the same`);
      }
    }
    const redact = redactorOf([token]);
    const log = (l: string) => this.log(redact(l));
    const stop = new AbortController();
    const api = new BotApi({ token, apiBase: this.deps.apiBase, fetch: this.deps.fetch, signal: stop.signal });
    const chatId = Number(binding.operatorId);
    const connector = new TelegramConnector({
      home: this.home,
      api,
      binding,
      inbox: this.inboxRing,
      strangers: this.store,
      blocked: () => this.state.blocked,
      chatOn: () => this.state.routing.chat.includes(binding.network),
      reply: async (text) => {
        await api.sendMessage(chatId, text);
      },
      offset,
      clock: this.clock,
      log,
      pollTimeoutS: this.deps.connectedPollTimeoutS,
    });
    this.connectors.set(binding.network, { connector, stop });
    connector.start();
  }

  private async stopConnector(network: Network): Promise<void> {
    const c = this.connectors.get(network);
    if (!c) return;
    this.connectors.delete(network);
    c.stop.abort();
    await c.connector.dispose();
  }

  private statusOf(network: Network): NetworkStatus {
    return this.connectors.get(network)?.connector.status() ?? { network, polling: false };
  }
}

/** the operator's handle as sheet 3 showed it: their @username, or their masked id when they have none */
const operatorHandleOf = (sender: { id: string; handle: string }): string => (sender.handle !== "" ? sender.handle : maskId(sender.id));
