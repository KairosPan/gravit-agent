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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fingerprintOf, keyMatches } from "../account/brain-keys.ts";
import type { Outcome } from "../account/exchange.ts";
import type { OwnerAction } from "../account/sign.ts";
import { no } from "../refuse.ts";
import type { LedgerRow } from "../../agent/ledger.ts";
import { formatRouting, isClock, NETWORKS, parseRouting, PHONE_KINDS, quietHolds, rowOf, type Network, type PhoneKind, type Routing } from "./kinds.ts";
import { BotApi, BotApiError, redactorOf, splitMessage } from "./bot-api.ts";
import { cardNotice, fillNotice, type FillFields } from "./notices.ts";
import { lateLine, Outbox, OUTBOX_MAX, OUTBOX_MAX_AGE_MS } from "./outbox.ts";
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
};

const HASH = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{32}$/;
const REF = /^[0-9a-f]{12}$/;
const MASKED = /^…\d{1,3}$/;
/** a bot token anywhere in a text (pending.ts TOKEN_SHAPE, unanchored) */
const TOKEN_ANYWHERE = /\d{5,16}:[A-Za-z0-9_-]{30,}/;

const isNetwork = (s: string): s is Network => (NETWORKS as readonly string[]).includes(s);
const isKind = (s: unknown): s is PhoneKind => typeof s === "string" && (PHONE_KINDS as readonly string[]).includes(s);
/** a reply-to on the wire: `<network>:<the network's own id>` */
export const REPLY_TO = /^[a-z]{1,16}:\d{1,16}$/;
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

/** a send that stopped at a part: the ids of the parts that went before it, how many, the text that did not go, and why */
class SendFailure extends Error {
  constructor(
    readonly ids: string[],
    readonly parts: number,
    readonly rest: string,
    readonly error: unknown,
  ) {
    super(error instanceof Error ? error.message : String(error));
  }
}
/** a network refused the message outright (Telegram's 400, or 403 for a bot the operator blocked): sending it again cannot help */
const isRefused = (err: unknown): boolean => err instanceof BotApiError && (err.status === 400 || err.status === 403);

/** one network the account can send on: its Bot API client (cut at a disconnect), the operator's chat, and its token, to take out of texts */
interface Link {
  api: BotApi;
  stop: AbortController;
  chatId: number;
  token: string;
}
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
  readonly outbox: Outbox;
  private readonly home: string;
  private readonly now: () => number;
  private readonly store: Strangers;
  private readonly log: (l: string) => void;
  private readonly clock: IdentityClock;
  private readonly connectors = new Map<Network, TelegramConnector>();
  private readonly links = new Map<Network, Link>();
  /** a 403 on a send, for a network with no poller running (a read-only account) */
  private readonly sendBlocked = new Map<Network, boolean>();
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
    this.pending = new PendingConnections({ apiBase: deps.apiBase, strangers: this.store, bound: () => this.bound("telegram") !== undefined, blocked: () => this.state.blocked, fetch: deps.fetch, pollTimeoutS: deps.pollTimeoutS, now: deps.now, log: deps.log });
    this.resume();
    // an earlier run may have queued what this one takes out
    this.outbox.rewrite((t) => this.clean(t));
  }

  /** Send `m` as the account decides (see the top of this file). Never throws */
  async send(m: SendMessage): Promise<SendAnswer> {
    if (!m || typeof m !== "object" || !isKind(m.kind) || typeof m.text !== "string") return { ok: false, error: IDENTITY_WORDS.send };
    if (m.network !== undefined && !isNetwork(m.network)) return { ok: false, error: IDENTITY_WORDS.send };
    if (m.replyTo !== undefined && (typeof m.replyTo !== "string" || !REPLY_TO.test(m.replyTo))) return { ok: false, error: IDENTITY_WORDS.send };
    let s: IdentityState;
    try {
      s = this.state;
    } catch {
      return { ok: true, held: "nothing connected" };
    }
    const connected = s.bindings.map((b) => b.network).filter((n) => this.links.has(n));
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
      let refused: string | undefined;
      for (const network of networks) {
        const link = this.links.get(network);
        if (!link) continue;
        const replyTo = m.replyTo !== undefined && m.replyTo.startsWith(`${network}:`) ? m.replyTo : undefined;
        if (this.disposed || this.outbox.length > 0) {
          this.outbox.push({ t, network, kind: m.kind, text: body, ...(replyTo ? { replyTo } : {}) });
          queued = true;
          continue;
        }
        try {
          sent.push(...(await this.deliver(network, link, body, replyTo)));
        } catch (err) {
          const f = err as SendFailure;
          sent.push(...f.ids);
          if (isRefused(f.error)) {
            refused = f.message;
            this.log(`identity: ${NETWORK_NAME[network]} refused a message (${f.message}); it is dropped`);
            continue;
          }
          this.log(`identity: a message could not be sent on ${NETWORK_NAME[network]} (${f.message}); it waits in the outbox`);
          this.outbox.push({ t, network, kind: m.kind, text: f.rest, ...(f.parts === 0 && replyTo ? { replyTo } : {}) });
          queued = true;
        }
      }
      if (sent.length === 0 && queued) return { ok: true, queued: true };
      if (sent.length === 0 && refused !== undefined) return { ok: false, error: `Telegram refused the message (${refused}): it was not sent, and it is not kept.` };
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
    this.disposed = true;
    this.pending.dispose();
    await Promise.all([...new Set([...this.links.keys(), ...this.connectors.keys()])].map((n) => this.stopConnector(n)));
  }

  // ---- inside ----

  /** a notice of the account's own, sent; what it came to is a line only when it did not go or wait */
  private notify(kind: PhoneKind, text: string): void {
    void this.send({ kind, text }).then((a) => {
      if (!a.ok) this.log(`identity: a ${kind} notice was not sent: ${a.error}`);
    });
  }

  /** the account's tokens out of `text` in every spelling, then every link to this machine */
  private clean(text: string): string {
    const tokens = [...this.links.values()].map((l) => l.token);
    return withoutLocalLinks(tokens.length > 0 ? redactorOf(tokens, "<token>")(text) : text);
  }

  private outbound<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** `text` to the operator's chat in parts, the first as a reply to `replyTo` when given; the ids of the parts sent, or a SendFailure at
   * the first that did not go. A part that goes ends a 403's `blocked`; a 403 sets it */
  private async deliver(network: Network, link: Link, text: string, replyTo: string | undefined): Promise<string[]> {
    const parts = splitMessage(text).filter((p) => p.trim() !== "");
    const reply = replyTo !== undefined ? Number(replyTo.slice(network.length + 1)) : undefined;
    const ids: string[] = [];
    for (const [i, part] of parts.entries()) {
      let id: number;
      try {
        id = await link.api.sendMessage(link.chatId, part, i === 0 && reply !== undefined && Number.isSafeInteger(reply) ? reply : undefined);
      } catch (err) {
        if (err instanceof BotApiError && err.status === 403) this.setBlocked(network, true);
        throw new SendFailure(ids, i, parts.slice(i).join(""), err);
      }
      this.setBlocked(network, false);
      ids.push(`${network}:${id}`);
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
      const link = this.links.get(head.network);
      if (!link) {
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
        await this.deliver(head.network, link, `${lateLine(head.t, this.now())}${head.text}`, head.replyTo);
        this.outbox.shift();
      } catch (err) {
        const f = err as SendFailure;
        if (isRefused(f.error)) {
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
    // nothing queued before this binding ever goes to it
    this.dropQueued(network);
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
    if (this.links.has(binding.network)) return;

    if (offset !== undefined) {
      try {
        writeIdentityFile(this.home, OFFSET_FILE, `${offset}\n`);
      } catch (err) {
        this.log(`identity: Telegram's offset could not be written (${err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.name) : "error"}); the poll starts from it all the same`);
      }
    }
    const stop = new AbortController();
    const api = new BotApi({ token, apiBase: this.deps.apiBase, fetch: this.deps.fetch, signal: stop.signal });
    const chatId = Number(binding.operatorId);
    // the account sends on it either way: only the operator's chat, the one it is bound to
    this.links.set(binding.network, { api, stop, chatId, token });
    // a read-only account polls nothing: the offset is kept for a later run with writes on
    if (this.deps.readOnly) return;
    const redact = redactorOf([token]);
    const log = (l: string) => this.log(redact(l));
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
      beforePoll: () => (this.outbox.length > 0 ? this.outbound(() => this.flush()) : Promise.resolve()),
    });
    this.connectors.set(binding.network, connector);
    connector.start();
  }

  private async stopConnector(network: Network): Promise<void> {
    const link = this.links.get(network);
    const connector = this.connectors.get(network);
    this.links.delete(network);
    this.connectors.delete(network);
    this.sendBlocked.delete(network);
    link?.stop.abort();
    await connector?.dispose();
  }

  private statusOf(network: Network): NetworkStatus {
    return this.connectors.get(network)?.status() ?? { network, polling: false, ...(this.sendBlocked.get(network) ? { blocked: true as const } : {}) };
  }
}

/** the operator's handle as sheet 3 showed it: their @username, or their masked id when they have none */
const operatorHandleOf = (sender: { id: string; handle: string }): string => (sender.handle !== "" ? sender.handle : maskId(sender.id));
