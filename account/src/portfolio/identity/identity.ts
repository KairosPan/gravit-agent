/** ACCOUNT › IDENTITY — the service the rest of the account talks to about the networks Gravit speaks on.
 *
 * It holds the pending connection of Connect's sheets 1 to 3 (pending.ts), the strangers (store.ts Strangers), the identity state
 * (store.ts: bindings, routing, quiet hours, blocked), each connected network's connector (`Connector`: telegram.ts TelegramConnector,
 * slack.ts SlackConnector) and transport (`Transport`: telegram.ts TelegramTransport), and the inbox the connectors fill (inbox.ts
 * InboxRing), which the face's desk long-polls (`inbox`). Slack's transport is a later task's: until then the account hears on Slack
 * (and answers its own fixed lines there) but sends nothing else on it. The poller starts when the service is created on a home that holds a
 * binding and its token file, and at a connect; a disconnect stops it. The four owner types land here once the
 * door (account/exchange.ts) has checked the signature, the owner, the nonce and, for a connect, the ten minutes:
 *
 *   connectNetwork     the pending connection named is checked — the token held since sheet 1 (Slack's two, joined by a NUL) against the
 *                      fingerprint signed (keyMatches),
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
 * SENDING (`send`, POST /api/account/identity/send): the caller gives a kind, a text, and — for a reply — the message it answers and its
 * network; the account picks who receives it. Only the bound operator's private chat on a connected network ever does: a `chat` that names
 * its network goes back there; a `watchdog` notice to every connected network; every other kind to the networks its routing row ticks.
 * Quiet hours (kinds.ts quietHolds) hold back the proactive kinds — a held message is answered `{held}` and never sent later; a reply, an
 * urgent alert and the watchdog always go. Each text has the account's own tokens taken out, in every spelling (`<token>`), and every link
 * to this machine (the face's own address among them) made `<local link>`, before it is cut into parts. What a network cannot take waits
 * in the outbox (outbox.ts), flushed in order before each poll and each send; what it refuses outright is dropped with one line — a 403
 * makes the status read `blocked` until a line goes. A network disconnected takes its queued messages with it: whoever connects next never
 * receives them. The account's own notices (notices.ts) go the same way: `onFill` for each fill the pages are told of, `onLedgerRow` for
 * each Guard card raised.
 *
 * `problem` is what the door and /api/account/prepare both refuse, in IDENTITY_WORDS' fixed words, never repeating what was sent. The token
 * is in no answer, no summary, no log line and no ledger row: the summary of a connect names the token by its fingerprint only. */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { fingerprintOf, keyMatches } from "../account/brain-keys.ts";
import type { Outcome } from "../account/exchange.ts";
import type { OwnerAction } from "../account/sign.ts";
import { no } from "../refuse.ts";
import type { LedgerRow } from "../../agent/ledger.ts";
import { formatRouting, isClock, NETWORK_NAME, NETWORKS, parseRouting, PHONE_KINDS, quietHolds, rowOf, SLACK_TOKEN_ANYWHERE, WIRE_ID, type Network, type PhoneKind, type Routing } from "./kinds.ts";
import { redactorOf, splitMessage } from "./bot-api.ts";
import { cardNotice, fillNotice, type FillFields } from "./notices.ts";
import { lateLine, Outbox, OUTBOX_MAX, OUTBOX_MAX_AGE_MS } from "./outbox.ts";
import { InboxRing, type InboxMessage } from "./inbox.ts";
import { operatorHandleOf, PendingConnections, type PendingResume } from "./pending.ts";
import { IDENTITY_WORDS } from "./routes.ts";
import { readNetworkSecret, removeNetworkSecret, secretsOf, writeNetworkSecret, type SlackSecret, type TelegramSecret } from "./secret-file.ts";
import { CURSOR_FILE, SlackConnector } from "./slack.ts";
import { escapeSlack, SLACK_API, SLACK_MANIFEST, SlackApi } from "./slack-api.ts";
import { SlackSocket, type OpenSocket } from "./slack-socket.ts";
import { BLOCKED_MAX, loadIdentity, MASKED, saveIdentity, Strangers, writeIdentityFile, type Binding, type IdentityState, type Stranger } from "./store.ts";
import { OFFSET_FILE, realClock, TelegramConnector, TelegramTransport, type IdentityClock, type NetworkStatus } from "./telegram.ts";

export type IdentityAction = Extract<OwnerAction, { type: "connectNetwork" | "disconnectNetwork" | "setRouting" | "blockSender" }>;
export const IDENTITY_TYPES: ReadonlySet<string> = new Set(["connectNetwork", "disconnectNetwork", "setRouting", "blockSender"]);
export const isIdentityAction = (a: { type: string }): a is IdentityAction => IDENTITY_TYPES.has(a.type);

export interface IdentityDeps {
  home: string;
  /** Telegram's Bot API */
  apiBase: string;
  /** Slack's Web API (slack-api.ts slackApiBase: Slack's own unless set) and how its sockets are opened (Node's WebSocket unless set) */
  slackApiBase?: string | undefined;
  openSocket?: OpenSocket | undefined;
  fetch?: typeof fetch | undefined;
  pollTimeoutS?: number | undefined;
  now?: (() => number) | undefined;
  log?: ((l: string) => void) | undefined;
  /** a read-only account (started --read-only): it keeps the identity but polls no network, so nothing it hears moves an offset */
  readOnly?: boolean | undefined;
  /** the connected poller's clock (real timers on `now` by default) and its long poll in seconds (50) */
  clock?: IdentityClock | undefined;
  connectedPollTimeoutS?: number | undefined;
}

/** what the face's desk reads: how the phone stands beside the messages */
export interface PhoneStatusWire {
  networks: NetworkStatus[];
  /** messages waiting in the outbox to be sent */
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

/** what a caller may ask the account to send: a kind, a text, and for a reply the message it answers and its network — never a recipient */
export interface SendMessage {
  kind: PhoneKind;
  text: string;
  replyTo?: string | undefined;
  network?: Network | undefined;
}

export type HeldReason = "quiet hours" | "not routed" | "nothing connected";
/** what a send came to: the ids of the parts sent (`<network>:<id>`), with `queued` when the rest waits in the outbox — or all of it
 * queued; or held, and never sent later; or refused outright by every network it was for (`ok: false`, nothing kept) */
export type SendAnswer = { ok: true; sent: string[]; queued?: true } | { ok: true; queued: true } | { ok: true; held: HeldReason } | { ok: false; error: string };

export type IdentityView = {
  ok: true;
  networks: Array<Omit<Binding, "botId" | "operatorId"> & { state: "connected"; polling: boolean; lastPollAt?: string; conflictAt?: string; blocked?: true; pollFailing?: { since: string; reason: string } }>;
  routing: Routing;
  quiet: { from: string; to: string; zone: "America/New_York" } | null;
  strangers: Stranger[];
  /** the Slack app manifest the owner pastes into Slack's "From a manifest" (slack-api.ts SLACK_MANIFEST): JSON, as text */
  slackManifest: string;
};

const HASH = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{32}$/;
const REF = /^[0-9a-f]{12}$/;
/** a Telegram bot token anywhere in a text (pending.ts TOKEN_SHAPE, unanchored); Slack's are kinds.ts SLACK_TOKEN_ANYWHERE */
const TOKEN_ANYWHERE = /\d{5,16}:[A-Za-z0-9_-]{30,}/;

const isNetwork = (s: string): s is Network => (NETWORKS as readonly string[]).includes(s);
const isKind = (s: unknown): s is PhoneKind => typeof s === "string" && (PHONE_KINDS as readonly string[]).includes(s);
/** a link to this machine — the face's own address (its chat URL carries its token), or any other service on loopback: never sent */
// a path runs to the next space, less the punctuation that ends a sentence (as a chat app's link does)
const LOCAL_LINKS: readonly RegExp[] = [
  /\b(?:https?|wss?):\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|[a-z0-9.-]+\.localhost)(?::\d{1,5})?(?:[/?#](?:[^\s]*[^\s,.;:!?)\]'"])?)?/gi,
  // bare: [::1], 0.0.0.0 and 127.x with or without a port or a path; localhost with a port or a path
  /(?:\[::1\]|\b0\.0\.0\.0\b|\b127(?:\.\d{1,3}){3}\b)(?::\d{1,5})?(?:[/?#](?:[^\s]*[^\s,.;:!?)\]'"])?)?/gi,
  /\blocalhost(?::\d{1,5}(?:[/?#](?:[^\s]*[^\s,.;:!?)\]'"])?)?|[/?#](?:[^\s]*[^\s,.;:!?)\]'"])?)/gi,
];
const withoutLocalLinks = (text: string): string => LOCAL_LINKS.reduce((out, re) => out.replace(re, "<local link>"), text);
const codeOf = (err: unknown): string => (err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.name) : "error");

/** what a transport's failure means: sent again later (`retry`), refused outright (`refused`), a bot the operator blocked (`blocked`),
 * or tokens the network no longer takes (`auth`) — the last three dropped, since sending them again cannot help */
type Verdict = ReturnType<Transport["classify"]>;

/** a send that stopped at a part: the ids of the parts that went before it, how many, the text that did not go, why, and what it means */
class SendFailure extends Error {
  constructor(
    readonly ids: string[],
    readonly parts: number,
    readonly rest: string,
    readonly error: unknown,
    readonly verdict: Verdict,
  ) {
    super(error instanceof Error ? error.message : String(error));
  }
}

/** One network the account sends on, bound to the operator's one chat there: a part at a time (at most `partMax` code units), answering
 * the part's wire id; `classify` says what a failure of `send` means; `secrets` are its tokens, taken out of every text; `dispose` cuts
 * it (and whatever shares its client) */
export interface Transport {
  network: Network;
  secrets: readonly string[];
  partMax: number;
  send(part: string, replyTo?: string): Promise<string>;
  classify(err: unknown): "retry" | "refused" | "blocked" | "auth";
  dispose(): void;
}

/** One network's listening, once connected: what it hears goes to the inbox; its status is what the desk and the tab read */
export interface Connector {
  start(): void;
  status(): NetworkStatus;
  setBlocked(b: boolean): void;
  dispose(): Promise<void>;
}

/** A bot token pasted into any field of the four types: refused before the door writes its "taken" row, which carries the signed fields to
 * the ledger (hash-chained, never cleaned) — and before /prepare says the fields back. Fixed words; the value is never repeated */
export function identitySignedProblem(a: IdentityAction): string | null {
  // search, not test: the Slack pattern is global, and search neither reads nor moves its lastIndex. Each network's token in its own words
  for (const [k, v] of Object.entries(a)) {
    if (k === "type" || typeof v !== "string") continue;
    if (v.search(SLACK_TOKEN_ANYWHERE) >= 0) return IDENTITY_WORDS.slackTokenInField;
    if (TOKEN_ANYWHERE.test(v)) return IDENTITY_WORDS.tokenInField;
  }
  return null;
}

const refusal = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { message });

export class Identity {
  readonly pending: PendingConnections;
  readonly inboxRing: InboxRing;
  readonly outbox: Outbox;
  private readonly home: string;
  private readonly now: () => number;
  private readonly store: Strangers;
  private readonly log: (l: string) => void;
  private readonly clock: IdentityClock;
  private readonly connectors = new Map<Network, Connector>();
  private readonly transports = new Map<Network, Transport>();
  /** each Slack client's signal, aborted when its connector stops (until Slack has a transport that holds it) */
  private readonly cuts = new Map<Network, AbortController>();
  /** a 403 on a send, for a network with no poller running (a read-only account) */
  private readonly sendBlocked = new Map<Network, boolean>();
  /** a send the network refused for its tokens (`auth`): the status reads pollFailing until a part goes */
  private readonly sendAuthFailing = new Map<Network, { since: string; reason: string }>();
  private disposed = false;
  /** every send and every flush, one at a time */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: IdentityDeps) {
    this.home = deps.home;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((l) => console.error(l));
    this.clock = deps.clock ?? realClock(this.now);
    this.store = new Strangers(deps.home);
    this.inboxRing = new InboxRing(deps.home);
    this.outbox = new Outbox(deps.home, OUTBOX_MAX, this.log);
    this.pending = new PendingConnections({ apiBase: deps.apiBase, slackApiBase: deps.slackApiBase, openSocket: deps.openSocket, clock: this.clock, strangers: this.store, bound: (network) => this.bound(network) !== undefined, blocked: () => this.state.blocked, fetch: deps.fetch, pollTimeoutS: deps.pollTimeoutS, now: deps.now, log: deps.log });
    this.resume();
    // an earlier run may have queued what this one takes out
    this.outbox.rewrite((t) => this.clean(t));
  }

  /** Send `m` as the account decides (see the top of this file). Never throws */
  async send(m: SendMessage): Promise<SendAnswer> {
    if (!m || typeof m !== "object" || !isKind(m.kind) || typeof m.text !== "string") return { ok: false, error: IDENTITY_WORDS.send };
    if (m.network !== undefined && !isNetwork(m.network)) return { ok: false, error: IDENTITY_WORDS.send };
    if (m.replyTo !== undefined && (typeof m.replyTo !== "string" || !WIRE_ID.test(m.replyTo))) return { ok: false, error: IDENTITY_WORDS.send };
    let s: IdentityState;
    try {
      s = this.state;
    } catch {
      return { ok: true, held: "nothing connected" };
    }
    const connected = s.bindings.map((b) => b.network).filter((n) => this.transports.has(n));
    if (connected.length === 0) return { ok: true, held: "nothing connected" };
    const row = rowOf(m.kind);
    const networks = m.kind === "chat" && m.network !== undefined ? connected.filter((n) => n === m.network) : row === "always" ? connected : s.routing[row].filter((n) => connected.includes(n));
    if (networks.length === 0) return { ok: true, held: "not routed" };
    if (quietHolds(m.kind, this.now(), s.quiet)) return { ok: true, held: "quiet hours" };
    const body = this.clean(m.text);
    if (body.trim() === "") return { ok: true, sent: [] };
    return this.outbound(async (): Promise<SendAnswer> => {
      const t = new Date(this.now()).toISOString();
      if (this.outbox.length > 0) await this.flush();
      const sent: string[] = [];
      let queued = false;
      let refused: { network: Network; message: string } | undefined;
      for (const network of networks) {
        const transport = this.transports.get(network);
        if (!transport) continue;
        const replyTo = m.replyTo !== undefined && m.replyTo.startsWith(`${network}:`) ? m.replyTo : undefined;
        if (this.disposed || this.outbox.length > 0) {
          this.outbox.push({ t, network, kind: m.kind, text: body, ...(replyTo ? { replyTo } : {}) });
          queued = true;
          continue;
        }
        try {
          sent.push(...(await this.deliver(network, transport, body, replyTo)));
        } catch (err) {
          const f = err as SendFailure;
          sent.push(...f.ids);
          if (f.verdict !== "retry") {
            refused = { network, message: f.message };
            this.log(`identity: ${NETWORK_NAME[network]} refused a message (${f.message}); it is dropped`);
            continue;
          }
          this.log(`identity: a message could not be sent on ${NETWORK_NAME[network]} (${f.message}); it waits in the outbox`);
          this.outbox.push({ t, network, kind: m.kind, text: f.rest, ...(f.parts === 0 && replyTo ? { replyTo } : {}) });
          queued = true;
        }
      }
      if (sent.length === 0 && queued) return { ok: true, queued: true };
      if (sent.length === 0 && refused !== undefined) return { ok: false, error: `${NETWORK_NAME[refused.network]} refused the message (${refused.message}): it was not sent, and it is not kept.` };
      return { ok: true, sent, ...(queued ? { queued: true as const } : {}) };
    }).catch((err: unknown): SendAnswer => {
      this.log(`identity: a send failed (${codeOf(err)})`);
      return { ok: false, error: "The account could not send this: it was not sent, and it is not kept." };
    });
  }

  /** a fill the pages are told of (service.ts paperSaid, toldFill): the fill notice sent as `fill`. Never throws */
  onFill(f: Partial<FillFields> | undefined): void {
    try {
      if (!f || typeof f !== "object" || typeof f.side !== "string" || typeof f.symbol !== "string" || !(typeof f.qty === "number" || typeof f.qty === "string")) return;
      const venueName = typeof f.venueName === "string" && f.venueName !== "" ? f.venueName : "a venue";
      const price = typeof f.price === "number" || typeof f.price === "string" ? f.price : undefined;
      const text = fillNotice({ side: f.side, qty: f.qty, symbol: f.symbol, price, venueName, paper: f.paper === true });
      this.notify("fill", text);
    } catch (err) {
      this.log(`identity: a fill notice could not be made (${codeOf(err)})`);
    }
  }

  /** every row the ledger takes (service.ts toldRow): a Guard card raised is sent as `card`. Never throws */
  onLedgerRow(row: LedgerRow): void {
    try {
      const text = cardNotice(row);
      if (text !== undefined) this.notify("card", text);
    } catch (err) {
      this.log(`identity: a card notice could not be made (${codeOf(err)})`);
    }
  }

  /** The face's desk: the operator's messages numbered above `after`, waiting up to `waitMs` for one when there is none past it — at once
   * when `after` is past the last (a cursor ahead of a fresh home's ring, which the face starts again from). Never changes the inbox */
  async inbox(after: number, waitMs: number, signal?: AbortSignal): Promise<InboxAnswer> {
    if (after === this.inboxRing.last() && waitMs > 0) await this.inboxRing.wait(after, waitMs, signal);
    return { ok: true, messages: this.inboxRing.after(after), last: this.inboxRing.last(), status: this.phoneStatus() };
  }

  phoneStatus(): PhoneStatusWire {
    return { networks: this.state.bindings.map((b) => this.statusOf(b.network)), queued: this.outbox.length, strangers: this.store.list().length };
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
      slackManifest: SLACK_MANIFEST,
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
        if (!isNetwork(a.network)) return IDENTITY_WORDS.networkUnknown;
        if (!HASH.test(a.keyHash) || !SALT.test(a.salt)) return IDENTITY_WORDS.hashShape;
        const routing = parseRouting(a.routing);
        if (typeof routing === "string") return routing;
        if (this.bound(a.network)) return IDENTITY_WORDS.connectedOn(a.network);
        if (Object.values(routing).some((nets) => nets.some((x) => x !== a.network && !this.bound(x)))) return IDENTITY_WORDS.routedNotConnected;
        const p = this.pending.peek(a.pending);
        // a pending connection to another network is not the one signed for
        if (!p || p.network !== a.network) return IDENTITY_WORDS.noPending;
        if (!keyMatches(a.salt, p.keyInput, a.keyHash)) return IDENTITY_WORDS.mismatchOn(p.network);
        if (a.botId !== p.bot.id || a.speaksAs !== `@${p.bot.username}`) return IDENTITY_WORDS.botMismatchOn(p.network);
        if (a.operatorId !== p.sender.id || a.talksOnlyWith !== operatorHandleOf(p.sender)) return IDENTITY_WORDS.senderMismatch;
        return null;
      }
      case "disconnectNetwork":
        if (!isNetwork(a.network)) return IDENTITY_WORDS.networkUnknown;
        return this.bound(a.network) ? null : IDENTITY_WORDS.notConnectedOn(a.network);
      case "setRouting": {
        const routing = parseRouting(a.routing);
        if (typeof routing === "string") return routing;
        if (Object.values(routing).some((nets) => nets.some((x) => !this.bound(x)))) return IDENTITY_WORDS.routedNotConnected;
        if (a.quietFrom === "" && a.quietTo === "") return null;
        if (!isClock(a.quietFrom) || !isClock(a.quietTo)) return IDENTITY_WORDS.quietTime;
        return a.quietFrom === a.quietTo ? IDENTITY_WORDS.quietEqual : null;
      }
      case "blockSender": {
        if (!isNetwork(a.network)) return IDENTITY_WORDS.networkUnknown;
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
    this.disposed = true;
    this.pending.dispose();
    await Promise.all([...new Set([...this.transports.keys(), ...this.connectors.keys(), ...this.cuts.keys()])].map((n) => this.stopConnector(n)));
  }

  // ---- inside ----

  /** a notice of the account's own, sent; what it came to is a line only when it did not go or wait */
  private notify(kind: PhoneKind, text: string): void {
    void this.send({ kind, text }).then((a) => {
      if (!a.ok) this.log(`identity: a ${kind} notice was not sent: ${a.error}`);
    });
  }

  /** the account's tokens out of `text` in every spelling, then every Slack token's shape, then every link to this machine */
  private clean(text: string): string {
    const tokens = [...this.transports.values()].flatMap((t) => t.secrets);
    const own = tokens.length > 0 ? redactorOf(tokens, "<token>")(text) : text;
    return withoutLocalLinks(own.replace(SLACK_TOKEN_ANYWHERE, "<token>"));
  }

  private outbound<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** `text` to the operator's chat in parts of the transport's size, the first as a reply to `replyTo` when given; the wire ids of the
   * parts sent, or a SendFailure at the first that did not go, with the transport's verdict on it. A part that goes ends `blocked` and an
   * `auth` failure; a `blocked` sets the one, an `auth` the other (the status's pollFailing) with one line */
  private async deliver(network: Network, transport: Transport, text: string, replyTo: string | undefined): Promise<string[]> {
    const parts = splitMessage(text, transport.partMax).filter((p) => p.trim() !== "");
    const ids: string[] = [];
    for (const [i, part] of parts.entries()) {
      let id: string;
      try {
        id = await transport.send(part, i === 0 ? replyTo : undefined);
      } catch (err) {
        const verdict = transport.classify(err);
        if (verdict === "blocked") this.setBlocked(network, true);
        if (verdict === "auth") {
          const reason = err instanceof Error ? err.message : String(err);
          this.sendAuthFailing.set(network, { since: this.sendAuthFailing.get(network)?.since ?? new Date(this.now()).toISOString(), reason });
          this.log(`identity: ${NETWORK_NAME[network]} no longer takes the account's tokens (${reason}): the message is dropped`);
        }
        throw new SendFailure(ids, i, parts.slice(i).join(""), err, verdict);
      }
      this.setBlocked(network, false);
      this.sendAuthFailing.delete(network);
      ids.push(id);
    }
    return ids;
  }

  /** quiet hours as the state says them now (off when it cannot be read: a queued message is then dropped only by its age) */
  private quietNow(): IdentityState["quiet"] {
    try {
      return this.state.quiet;
    } catch {
      return null;
    }
  }

  private setBlocked(network: Network, blocked: boolean): void {
    this.connectors.get(network)?.setBlocked(blocked);
    if (blocked) this.sendBlocked.set(network, true);
    else this.sendBlocked.delete(network);
  }

  /** what waits in the outbox sent, in order, until it is empty or a message does not go — that one stays at the head, cut to what did not
   * go — or one is refused outright, which is dropped with one line */
  private async flush(): Promise<void> {
    while (this.outbox.length > 0 && !this.disposed) {
      const head = this.outbox.head()!;
      const transport = this.transports.get(head.network);
      if (!transport) {
        this.outbox.shift();
        this.log(`identity: a queued message for ${NETWORK_NAME[head.network]} is dropped: it is not connected`);
        continue;
      }
      // quiet hours are asked again now: a message held now is never sent later, whenever it was queued
      if (quietHolds(head.kind ?? "chat", this.now(), this.quietNow())) {
        this.outbox.shift();
        this.log(`identity: a queued ${head.kind ?? "chat"} message for ${NETWORK_NAME[head.network]} is dropped: quiet hours hold it now`);
        continue;
      }
      if (this.now() - Date.parse(head.t) > OUTBOX_MAX_AGE_MS) {
        this.outbox.shift();
        this.log(`identity: a queued message for ${NETWORK_NAME[head.network]} is dropped: it waited more than ${OUTBOX_MAX_AGE_MS / 3_600_000} hours`);
        continue;
      }
      // the late line rides in the first part, so what does not go is always the head's own text
      try {
        await this.deliver(head.network, transport, `${lateLine(head.t, this.now())}${head.text}`, head.replyTo);
        this.outbox.shift();
      } catch (err) {
        const f = err as SendFailure;
        if (f.verdict !== "retry") {
          this.outbox.shift();
          this.log(`identity: ${NETWORK_NAME[head.network]} refused a queued message (${f.message}); it is dropped from the outbox`);
          continue;
        }
        if (f.parts > 0) this.outbox.cutHead(f.rest);
        return;
      }
    }
  }

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
    if (!taken || taken.network !== network) return refusal(IDENTITY_WORDS.noPending);
    if (!keyMatches(a.salt, taken.keyInput, a.keyHash)) return refusal(IDENTITY_WORDS.mismatchOn(network));
    // the operator's handle as signed: problem() checked it is the one sheet 3 showed
    const written = writeNetworkSecret(this.home, network, { ...taken.secret, operatorHandle: a.talksOnlyWith });
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
    // nothing queued before this binding ever goes to it
    this.dropQueued(network);
    this.startConnector(binding, { ...taken.secret, operatorHandle: a.talksOnlyWith }, taken.resume);
    // Slack's fingerprint is of its two tokens together
    return { ok: true, kind: "account", summary: `${NETWORK_NAME[network]} connected: Gravit speaks as ${a.speaksAs} and talks only with ${a.talksOnlyWith} · ${network === "slack" ? "tokens" : "token"} ${fingerprint}` };
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
    this.dropQueued(network);
    const left = this.removeSecret(network);
    if (left) return refusal(`${NETWORK_NAME[network]} is disconnected and its poller stopped, but ${left}`);
    return { ok: true, kind: "account", summary: `${NETWORK_NAME[network]} disconnected: its token removed from the account` };
  }

  /** the network's queued messages dropped, with one line when there were any */
  private dropQueued(network: Network): void {
    const dropped = this.outbox.dropNetwork(network);
    if (dropped > 0) this.log(`identity: ${dropped} queued message(s) for ${NETWORK_NAME[network]} are dropped: it was disconnected`);
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

  /** at service creation: a binding whose token file is there listens again from where its connector kept (its own resumeFrom) */
  private resume(): void {
    for (const b of this.state.bindings) {
      const secret = readNetworkSecret(this.home, b.network);
      if (!secret || secret.operatorId !== b.operatorId || secret.botId !== b.botId) continue;
      this.startConnector(b, secret);
    }
  }

  /** the network's transport and connector, by network: from `resume` after a connect (where the pending connection stood after the
   * message heard), else from where the connector's own file says it stopped */
  private startConnector(binding: Binding, secret: TelegramSecret | SlackSecret, resume?: PendingResume): void {
    if (this.transports.has(binding.network) || this.connectors.has(binding.network) || this.cuts.has(binding.network)) return;
    if (binding.network === "telegram" && "token" in secret) {
      const offset = resume?.network === "telegram" ? resume.offset : TelegramConnector.resumeFrom(this.home);
      return this.startTelegram(binding, secret, offset);
    }
    if (binding.network === "slack" && "appToken" in secret) {
      const cursor = resume?.network === "slack" && resume.cursor !== "" ? resume.cursor : SlackConnector.resumeFrom(this.home);
      return this.startSlack(binding, secret, cursor);
    }
    this.log(`identity: ${NETWORK_NAME[binding.network]}'s binding and its token file do not agree: nothing is heard or sent on it`);
  }

  /** Slack's socket and connector, from `cursor` on: the cursor written first — after a connect, the ts of the DM the operator was heard
   * by, so their first words are not taken into the inbox. A read-only account opens no socket and writes nothing */
  private startSlack(binding: Binding, secret: SlackSecret, cursor: string | undefined): void {
    // a read-only account neither listens nor writes the cursor: what a later run with writes on reads is left as it was
    if (this.deps.readOnly) return;
    if (cursor !== undefined) {
      try {
        writeIdentityFile(this.home, CURSOR_FILE, `${cursor}\n`);
      } catch (err) {
        this.log(`identity: Slack's cursor could not be written (${err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.name) : "error"}); the socket starts from it all the same`);
      }
    }
    const stop = new AbortController();
    const apiBase = this.deps.slackApiBase ?? SLACK_API;
    const api = new SlackApi({ token: secret.botToken, appToken: secret.appToken, apiBase, fetch: this.deps.fetch, signal: stop.signal });
    // both tokens' exact spellings, and every Slack token's shape, out of every line
    const log = (l: string) => this.log(api.redact(l));
    const socket = new SlackSocket({ api, apiBase, open: this.deps.openSocket, clock: this.clock, log });
    const connector = new SlackConnector({
      home: this.home,
      api,
      socket,
      binding,
      secret,
      inbox: this.inboxRing,
      strangers: this.store,
      blocked: () => this.state.blocked,
      chatOn: () => this.state.routing.chat.includes(binding.network),
      reply: async (text) => {
        await api.postMessage(secret.channel, escapeSlack(text));
      },
      cursor,
      clock: this.clock,
      log,
    });
    this.cuts.set(binding.network, stop);
    this.connectors.set(binding.network, connector);
    connector.start();
  }

  /** Telegram's poller, from `offset` on: the offset written first — after a connect, the one after the message the operator was heard by,
   * so their /start is not taken into the inbox */
  private startTelegram(binding: Binding, secret: TelegramSecret, offset: number | undefined): void {
    const token = secret.token;
    if (offset !== undefined) {
      try {
        writeIdentityFile(this.home, OFFSET_FILE, `${offset}\n`);
      } catch (err) {
        this.log(`identity: Telegram's offset could not be written (${err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.name) : "error"}); the poll starts from it all the same`);
      }
    }
    // the account sends on it either way: only the operator's chat, the one it is bound to
    const transport = new TelegramTransport({ token, apiBase: this.deps.apiBase, fetch: this.deps.fetch, chatId: Number(binding.operatorId) });
    this.transports.set(binding.network, transport);
    // a read-only account polls nothing: the offset is kept for a later run with writes on
    if (this.deps.readOnly) return;
    const redact = redactorOf(secretsOf(secret));
    const log = (l: string) => this.log(redact(l));
    const connector = new TelegramConnector({
      home: this.home,
      api: transport.api,
      binding,
      inbox: this.inboxRing,
      strangers: this.store,
      blocked: () => this.state.blocked,
      chatOn: () => this.state.routing.chat.includes(binding.network),
      reply: async (text) => {
        await transport.send(text);
      },
      offset,
      clock: this.clock,
      log,
      pollTimeoutS: this.deps.connectedPollTimeoutS,
      beforePoll: () => (this.outbox.length > 0 ? this.outbound(() => this.flush()) : Promise.resolve()),
    });
    this.connectors.set(binding.network, connector);
    connector.start();
  }

  private async stopConnector(network: Network): Promise<void> {
    const transport = this.transports.get(network);
    const connector = this.connectors.get(network);
    const cut = this.cuts.get(network);
    this.transports.delete(network);
    this.connectors.delete(network);
    this.cuts.delete(network);
    this.sendBlocked.delete(network);
    this.sendAuthFailing.delete(network);
    transport?.dispose();
    cut?.abort();
    await connector?.dispose();
  }

  private statusOf(network: Network): NetworkStatus {
    const st = this.connectors.get(network)?.status() ?? { network, polling: false, ...(this.sendBlocked.get(network) ? { blocked: true as const } : {}) };
    const auth = this.sendAuthFailing.get(network);
    return auth && st.pollFailing === undefined ? { ...st, pollFailing: { ...auth } } : st;
  }
}
