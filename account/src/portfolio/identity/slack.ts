/** SLACK'S SIDE OF CONNECT'S SHEETS 1 TO 3 — the pending connection's source for a Slack app (pending.ts PendingSource), holding the app's
 * two tokens in memory for its ten minutes and nowhere else — and, once connectNetwork is signed, SlackConnector (below): the operator's
 * DM into the inbox. Both read a DM's messages, a sender's kind (memberKind) and each hello's count (ConflictWatch) the same way.
 *
 *   Sheet 1's Next (check), in the plan's ruling 7's order: auth.test with the bot token (who the bot is, and its workspace), bots.info for
 *     the bot's app, apps.connections.open with the app-level token, the socket that URL opens — taken only if socketUrlOk — and its hello,
 *     waited for up to HELLO_WAIT_MS, whose app must be the bot's. A bot token Slack does not know is refusedBySlack; an app-level token it
 *     will not open a socket for (no connections:write, Socket Mode off) slackNoSocket; a hello for another app slackPairMismatch; Slack not
 *     answering, a socket URL off Slack's host or no hello slackUnreachable, with one line that names neither token nor URL.
 *   Sheet 2 (listen): on that same socket, the first `message` event in a DM (`channel_type: "im"`, no subtype, no bot_id) from a person,
 *     for this team and this app. Everything else — a channel, a group or an mpim, a bot, an edit or a deletion, another team or app — is
 *     acked at once and dropped. The person's names are asked of users.info (a user that is a bot is dropped); a sender the shell holds
 *     blocked or counts as a stranger is acked and not heard.
 *   Sheet 3: the person heard — their display name (else real name, else username), their @handle (the username, which they cannot
 *     change), their full user id (U…: a display name anyone can copy, the id no one can), the `<team>:<user>` id masked to its last three
 *     characters for Not you, and what they wrote. Only a full member of the bot's own team is heard: one whose users.info team is
 *     another, a guest (restricted or ultra_restricted) or a deactivated account is counted in Not you and the sheet waits on. The DM's
 *     channel and the message's ts are kept as `resume`, the envelope is acked, and the socket closed; "Not me" listens again on a fresh
 *     one.
 *
 * A hello that counts more than one socket for the app (another process holds its Socket Mode link, and Slack spreads the events across
 * them) is the shell's conflict until a hello counts one again — read by ruling 8 (ConflictWatch): such a reading within 30 s of this
 * source's own close (after a Not me, say) waits for the next hello, or a recheck on a fresh socket 30 s later. Whatever ends the pending connection — dropped, replaced, expired, taken —
 * aborts its signal, which closes the socket and cuts every call under way. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Refusal } from "../../core/errors.ts";
import { no } from "../refuse.ts";
import { redactorOf } from "./bot-api.ts";
import type { Connector } from "./identity.ts";
import { INBOX_MAX, type InboxRing } from "./inbox.ts";
import { chatOffLine, SLACK_TOKEN_ANYWHERE } from "./kinds.ts";
import type { PendingBot, PendingResume, PendingSource } from "./pending.ts";
import { IDENTITY_WORDS } from "./routes.ts";
import type { SlackSecret } from "./secret-file.ts";
import { SlackApi, SlackApiError, slackAppLink, socketUrlOk } from "./slack-api.ts";
import { SlackSocket, type Envelope, type OpenSocket } from "./slack-socket.ts";
import { identityDir, maskId, senderRef, writeIdentityFile, type Binding, type Strangers } from "./store.ts";
import { PHONE_COMMAND, RECORD_EVERY_MS, TEXT_ONLY, type IdentityClock, type NetworkStatus } from "./telegram.ts";

/** an app-level token (Socket Mode): xapp-, a digit, the app id, a number and hex */
export const SLACK_APP_TOKEN_SHAPE = /^xapp-[0-9]-[A-Z0-9]{8,14}-[0-9]{6,16}-[a-f0-9]{32,80}$/;
/** a bot token (the Web API): xoxb-, two numbers and letters */
export const SLACK_BOT_TOKEN_SHAPE = /^xoxb-[0-9]{6,16}-[0-9]{6,16}-[A-Za-z0-9]{20,40}$/;
/** how long sheet 1's Next waits for the socket's hello */
export const HELLO_WAIT_MS = 10_000;

/** Slack's codes for a failure that may pass: the network not answering is said as Slack not answering, not as a token it refused */
const PASSING = new Set(["ratelimited", "service_unavailable", "request_timeout", "fatal_error", "internal_error"]);
const passing = (err: unknown): boolean => !(err instanceof SlackApiError) || err.status === 429 || err.status >= 500 || PASSING.has(err.code);
const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const refused = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { message });

/** a client whose next apps.connections.open answers the URL sheet 1's check already took and checked — one ticket for the first socket,
 * not two; every later socket asks Slack afresh */
class PrimedApi extends SlackApi {
  private primed: string | undefined;
  prime(url: string): void {
    this.primed = url;
  }
  override async connectionsOpen(): Promise<string> {
    const url = this.primed;
    this.primed = undefined;
    return url ?? super.connectionsOpen();
  }
}

export interface SlackPendingSourceOptions {
  appToken: string;
  botToken: string;
  /** the Web API's base (slack-api.ts slackApiBase), which also says which socket URLs are taken */
  apiBase: string;
  fetch?: typeof fetch | undefined;
  open?: OpenSocket | undefined;
  clock: IdentityClock;
  log: (l: string) => void;
}

type ListenCtx = Parameters<PendingSource["listen"]>[0];
/** the app the check found: the workspace, the bot user and the app its bot belongs to */
interface Who {
  teamId: string;
  userId: string;
  appId: string;
}
/** a DM from a person, as sheet 2 hears it */
interface Dm {
  user: string;
  channel: string;
  ts: string;
  text: string;
}

export class SlackPendingSource implements PendingSource {
  readonly network = "slack" as const;
  readonly secrets: readonly string[];
  private readonly redactOwn: (text: string) => string;
  private api: PrimedApi | undefined;
  private apiSignal: AbortSignal | undefined;
  private socket: SlackSocket | undefined;
  private who: Who | undefined;
  /** the listening under way, and how to end it */
  private ctx: ListenCtx | undefined;
  private finish: (() => void) | undefined;
  /** what the open socket's last hello counted (0: none yet) */
  private connections = 0;
  /** sheet 1's wait for the first hello */
  private helloWait: ((h: { appId: string; connections: number } | undefined) => void) | undefined;
  private heardAt: { channel: string; cursor: string } | undefined;
  /** ruling 8's reading of each hello's count while listening */
  private readonly watch: ConflictWatch;

  constructor(private readonly o: SlackPendingSourceOptions) {
    this.secrets = [o.appToken, o.botToken];
    this.redactOwn = redactorOf(this.secrets, "<token>");
    this.watch = new ConflictWatch({ clock: o.clock, recheck: () => void this.recheck(), verdict: (on) => this.ctx?.conflict(on) });
  }

  async check(signal: AbortSignal): Promise<PendingBot | Refusal> {
    const api = this.apiFor(signal);
    signal.addEventListener("abort", () => void this.closeSocket(), { once: true });
    let me: Awaited<ReturnType<SlackApi["authTest"]>>;
    try {
      me = await api.authTest();
    } catch (err) {
      return this.failed(err, "auth.test", IDENTITY_WORDS.refusedBySlack);
    }
    let app: Awaited<ReturnType<SlackApi["botsInfo"]>>;
    try {
      app = await api.botsInfo(me.botId);
    } catch (err) {
      return this.failed(err, "bots.info", IDENTITY_WORDS.refusedBySlack);
    }
    let url: string;
    try {
      url = await api.connectionsOpen();
    } catch (err) {
      return this.failed(err, "apps.connections.open", IDENTITY_WORDS.slackNoSocket);
    }
    if (signal.aborted) return refused(IDENTITY_WORDS.slackUnreachable);
    if (!socketUrlOk(url, this.o.apiBase)) {
      this.log("identity: Slack's apps.connections.open answered a socket URL that is not on Slack's own host, so it is refused and no socket is opened");
      return refused(IDENTITY_WORDS.slackUnreachable);
    }
    this.who = { teamId: me.teamId, userId: me.userId, appId: app.appId };
    api.prime(url);
    const hello = await this.firstHello(signal);
    if (!hello) {
      await this.closeSocket();
      if (!signal.aborted) this.log(`identity: Slack's socket sent no hello in ${HELLO_WAIT_MS / 1000} s`);
      return refused(IDENTITY_WORDS.slackUnreachable);
    }
    if (hello.appId !== app.appId) {
      await this.closeSocket();
      return refused(IDENTITY_WORDS.slackPairMismatch);
    }
    return { id: `${me.teamId}:${me.userId}`, username: me.user, name: app.name !== "" ? app.name : me.user, link: slackAppLink(app.appId, me.teamId), workspace: me.team };
  }

  async listen(ctx: ListenCtx): Promise<void> {
    if (ctx.signal.aborted || !this.who) return;
    this.ctx = ctx;
    await new Promise<void>((done) => {
      const end = () => {
        ctx.signal.removeEventListener("abort", end);
        if (this.finish === end) this.finish = undefined;
        done();
      };
      this.finish = end;
      ctx.signal.addEventListener("abort", end, { once: true });
      // the check's socket listens on; after a Not me (the last one closed once its sender was heard) a fresh one is opened
      if (!this.socket) this.startSocket();
      else if (this.connections > 0) this.watch.hello(this.connections);
    });
    if (this.ctx === ctx) this.ctx = undefined;
    this.watch.cancel();
    // heard, or the connection ended: the socket is closed either way
    await this.closeSocket();
  }

  resume(): PendingResume {
    return { network: "slack", appId: this.who?.appId ?? "", channel: this.heardAt?.channel ?? "", cursor: this.heardAt?.cursor ?? "" };
  }

  // ---- inside ----

  private redact(text: string): string {
    return this.redactOwn(text).replace(SLACK_TOKEN_ANYWHERE, "<token>");
  }

  private log(line: string): void {
    this.o.log(this.redact(line));
  }

  /** a call that failed: Slack not answering (one line, its reason without a token), or `words` — a token Slack refused */
  private failed(err: unknown, method: string, words: string): Refusal {
    if (!passing(err)) return refused(words);
    if (!this.apiSignal?.aborted) this.log(`identity: Slack's ${method} did not answer (${reasonOf(err)})`);
    return refused(IDENTITY_WORDS.slackUnreachable);
  }

  /** the client for this signal: one per pending connection, cut when its signal aborts */
  private apiFor(signal: AbortSignal): PrimedApi {
    if (!this.api || this.apiSignal !== signal) {
      this.api = new PrimedApi({ token: this.o.botToken, appToken: this.o.appToken, apiBase: this.o.apiBase, fetch: this.o.fetch, signal });
      this.apiSignal = signal;
    }
    return this.api;
  }

  /** the socket opened and its first hello waited for, up to HELLO_WAIT_MS; undefined when none came or the signal aborted */
  private firstHello(signal: AbortSignal): Promise<{ appId: string; connections: number } | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      const end = (h: { appId: string; connections: number } | undefined) => {
        if (settled) return;
        settled = true;
        this.o.clock.clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        if (this.helloWait === end) this.helloWait = undefined;
        resolve(h);
      };
      const aborted = () => end(undefined);
      const timer = this.o.clock.setTimeout(() => end(undefined), HELLO_WAIT_MS);
      signal.addEventListener("abort", aborted, { once: true });
      this.helloWait = end;
      this.startSocket();
    });
  }

  private startSocket(): void {
    if (this.socket || !this.api) return;
    const socket = new SlackSocket({ api: this.api, apiBase: this.o.apiBase, open: this.o.open, clock: this.o.clock, log: (l) => this.log(l) });
    this.socket = socket;
    this.connections = 0;
    socket.run({
      hello: async (h) => {
        if (this.socket !== socket) return;
        this.connections = h.connections;
        if (this.helloWait) this.helloWait(h);
        else if (this.ctx) this.watch.hello(h.connections);
      },
      envelope: (e) => (this.socket === socket ? this.envelope(e) : Promise.resolve("hold" as const)),
      down: () => {
        if (this.socket !== socket) return;
        this.connections = 0;
        this.watch.closed();
      },
    });
  }

  private async closeSocket(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.connections = 0;
    if (!socket) return;
    await socket.dispose();
    this.watch.closed();
  }

  /** ruling 8's recheck while listening: the socket closed and a fresh one opened, whose hello says how many Slack holds now */
  private async recheck(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.signal.aborted || !this.socket) return;
    await this.closeSocket();
    if (this.ctx === ctx && !ctx.signal.aborted) this.startSocket();
  }

  /** one envelope while pending: the first DM from a person heard (and acked, then the socket closed); everything else acked and dropped;
   * held (so Slack sends it again) only while nothing listens, or when users.info did not answer */
  private async envelope(e: Envelope): Promise<"ack" | "hold"> {
    const ctx = this.ctx;
    const who = this.who;
    const api = this.api;
    if (!ctx || ctx.signal.aborted || !who || !api) return "hold";
    const m = dmOf(e, who);
    if (!m || m.user === who.userId) return "ack";
    const id = `${who.teamId}:${m.user}`;
    if (ctx.admit(id) !== "hear") return "ack";
    let user: Awaited<ReturnType<SlackApi["usersInfo"]>>;
    try {
      user = await api.usersInfo(m.user);
    } catch (err) {
      if (ctx.signal.aborted) return "hold";
      ctx.log(`identity: Slack's users.info did not answer (${this.redact(reasonOf(err))}); the message is not acked, so Slack sends it again`);
      return "hold";
    }
    const kind = memberKind(user, who.teamId);
    if (kind === "bot") return "ack";
    if (this.ctx !== ctx || ctx.signal.aborted) return "hold";
    // only a full member of the bot's own team is ever heard: someone of another team (a shared channel's DM), a guest or a deactivated
    // account is counted in Not you, and the sheet waits on
    if (kind === "stranger") {
      ctx.stranger(id);
      return "ack";
    }
    this.heardAt = { channel: m.channel, cursor: m.ts };
    // the handle is the immutable username; a display name is anyone's to set, so it is only ever the name shown beside the full user id
    ctx.heard({ id, userId: m.user, name: user.displayName || user.realName || user.name, handle: `@${user.name}`, masked: maskId(id), text: m.text });
    // the listening ends after this envelope's ack has gone: the socket's close waits its turn
    const finish = this.finish;
    setImmediate(() => finish?.());
    return "ack";
  }
}

/** an envelope's DM from a person to this app in this team, or undefined for anything else: a channel, a group or an mpim, a bot's
 * message, an edit or a deletion (any subtype), another team or app, or ids not of Slack's shapes */
function dmOf(e: Envelope, who: Who): Dm | undefined {
  const m = imMessageOf(envelopeEvent(e, who.teamId, who.appId));
  if (!m || m.bot || m.subtype !== undefined || m.user === undefined) return undefined;
  return { user: m.user, channel: m.channel, ts: m.ts, text: m.text };
}

// ---- what the pending source and the connector both read ---------------------------------------------------------------------------

/** a Slack message ts: seconds, a dot, six digits */
const TS_SHAPE = /^\d{9,12}\.\d{6}$/;
const USER_SHAPE = /^[UW][A-Z0-9]{2,20}$/;
const DM_SHAPE = /^D[A-Z0-9]{2,20}$/;

/** a message event in a DM (channel_type im), as both Socket Mode and conversations.history carry it: who wrote (absent for some bots'),
 * where, its ts, its text, its subtype, whether a bot wrote it, and the thread it was written in */
interface ImMessage {
  user?: string;
  channel: string;
  ts: string;
  text: string;
  subtype?: string;
  bot: boolean;
  threadTs?: string;
}

/** the event of an `events_api` envelope sent for this team and this app, or undefined */
function envelopeEvent(e: Envelope, teamId: string, appId: string): unknown {
  if (e.type !== "events_api") return undefined;
  const p = e.payload as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object" || p.team_id !== teamId || p.api_app_id !== appId) return undefined;
  return p.event;
}

/** a DM's message event read, or undefined for anything that is not one: another type, a channel, a group or an mpim, ids not of Slack's
 * shapes. A user id of another shape reads as no user (and the message is never anyone's) */
function imMessageOf(raw: unknown): ImMessage | undefined {
  const ev = raw as Record<string, unknown> | null | undefined;
  if (!ev || typeof ev !== "object" || ev.type !== "message" || ev.channel_type !== "im") return undefined;
  const { user, channel, ts, text, subtype, thread_ts } = ev;
  if (typeof channel !== "string" || !DM_SHAPE.test(channel)) return undefined;
  if (typeof ts !== "string" || !TS_SHAPE.test(ts)) return undefined;
  return {
    ...(typeof user === "string" && USER_SHAPE.test(user) ? { user } : {}),
    channel,
    ts,
    text: typeof text === "string" ? text : "",
    ...(subtype !== undefined ? { subtype: typeof subtype === "string" ? subtype : "?" } : {}),
    bot: ev.bot_id !== undefined || ev.bot_profile !== undefined || subtype === "bot_message",
    ...(typeof thread_ts === "string" && TS_SHAPE.test(thread_ts) ? { threadTs: thread_ts } : {}),
  };
}

/** what users.info says a DM's sender is, by sheet 3's one rule: a bot (dropped); someone sheet 3 never hears — a member of another team,
 * a guest (restricted or ultra_restricted), a deactivated account — (a stranger); or a full member of the bot's own team */
export function memberKind(user: Awaited<ReturnType<SlackApi["usersInfo"]>>, teamId: string): "bot" | "stranger" | "member" {
  if (user.isBot) return "bot";
  if (user.teamId !== teamId || user.restricted || user.deleted) return "stranger";
  return "member";
}

/** how long after the link's own close a reading of more than one socket is not taken at once (Slack can count the closed one for a few
 * seconds), and how long after it the count is read again */
export const CONFLICT_RECHECK_MS = 30_000;

/** The plan's ruling 8, for the pending source and the connector alike: what each hello's num_connections says. One: no conflict. More
 * than one, read more than CONFLICT_RECHECK_MS after the owner's own last close (`closed`), or read twice running: a conflict — another
 * process holds a socket for the app. More than one read within that window of the owner's own close, for the first time: nothing yet —
 * the next hello, or `recheck` (a fresh socket) CONFLICT_RECHECK_MS later, decides */
export class ConflictWatch {
  private closedAt = Number.NEGATIVE_INFINITY;
  private suspect = false;
  private timer: unknown;

  constructor(private readonly o: { clock: IdentityClock; recheck: () => void; verdict: (conflict: boolean, connections: number) => void }) {}

  /** the owner's own socket closed (or the owner has just started, after a socket of an earlier holder of its own) */
  closed(): void {
    this.closedAt = this.o.clock.now();
  }

  hello(connections: number): void {
    this.cancel();
    if (connections <= 1) {
      this.suspect = false;
      return this.o.verdict(false, connections);
    }
    if (!this.suspect && this.o.clock.now() - this.closedAt < CONFLICT_RECHECK_MS) {
      this.suspect = true;
      this.timer = this.o.clock.setTimeout(() => {
        this.timer = undefined;
        this.o.recheck();
      }, CONFLICT_RECHECK_MS);
      return;
    }
    this.suspect = false;
    this.o.verdict(true, connections);
  }

  cancel(): void {
    if (this.timer !== undefined) this.o.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

// ---- the connected connector -------------------------------------------------------------------------------------------------------

/** where the connector keeps the ts of the last DM message it handled: `<home>/identity/slack.cursor`, the analogue of telegram.offset */
export const CURSOR_FILE = "slack.cursor";
/** what the operator is answered when Chat with Gravit does not tick Slack */
export const SLACK_CHAT_OFF = chatOffLine("slack");
/** the backfill's page: conversations.history's limit */
export const BACKFILL_PAGE = 100;
/** Slack's codes for tokens it no longer takes: the status's pollFailing until a call goes through */
const AUTH_CODES = new Set(["invalid_auth", "token_revoked", "account_inactive", "not_authed"]);
/** how far back the backfill looks for threads with a reply after the cursor (conversations.history never carries a reply) */
export const THREAD_LOOKBACK_MS = 24 * 3_600_000;
/** the most pages of history read for that look back */
const THREAD_PAGES_MAX = 5;
/** how many answered messages are remembered, so a live envelope and the backfill do not answer the same one twice */
const ANSWERED_MAX = 200;

/** the phone's five commands as the operator types them on Slack, whose composer takes a leading `/` as its own (ruling 5) */
const BANG_COMMAND = /^(\s*)!(status|pause|mute|new|stop)(?=\s|$)/i;

/** `!status`, `!pause …`, `!mute …`, `!new` and `!stop` (any case, after any leading space) as the same text with `/` — what the face's
 * parseCommand and the Chat-off pass-through read; every other text as it is */
export const normalizeCommand = (text: string): string => text.replace(BANG_COMMAND, "$1/$2");

/** a ts's place in time: its seconds and its microseconds, compared as numbers (a ts has more digits than a double keeps) */
const tsCompare = (a: string, b: string): number => {
  const [as, au] = a.split(".");
  const [bs, bu] = b.split(".");
  return Number(as) - Number(bs) || Number(au) - Number(bu);
};
/** `ts` as an ISO time: its seconds and milliseconds */
const atOf = (ts: string): string => {
  const [sec, micro] = ts.split(".");
  return new Date(Number(sec) * 1000 + Math.floor(Number(micro) / 1000)).toISOString();
};
/** a time as a ts */
const tsAt = (ms: number): string => `${Math.floor(ms / 1000)}.${String((ms % 1000) * 1000).padStart(6, "0")}`;

export interface SlackConnectorDeps {
  home: string;
  /** the bot token's client (and the app-level token's, which the socket opens with) */
  api: SlackApi;
  socket: SlackSocket;
  binding: Binding;
  secret: SlackSecret;
  inbox: InboxRing;
  strangers: Strangers;
  /** the senders' references the owner blocked */
  blocked: () => string[];
  /** whether the Chat with Gravit row ticks Slack */
  chatOn: () => boolean;
  /** a line to the operator, in the DM */
  reply: (text: string) => Promise<void>;
  /** the ts of the last DM message handled; undefined: the connector's start (nothing earlier is read) */
  cursor: string | undefined;
  clock: IdentityClock;
  log: (l: string) => void;
}

/**
 * SLACK, ONCE CONNECTED: one Socket Mode link for the app (slack-socket.ts), and what it hears.
 *
 * At every hello — before any live envelope is handled, which waits unacked in the link — the DM's history after the cursor
 * (conversations.history, not inclusive, 100 a page) and the replies after the cursor of each thread whose latest reply is after it
 * (conversations.replies; its parent among those rows, or in the last 24 h of history), at most INBOX_MAX messages (the newest, when
 * there are more, with one line), oldest first, each row read as the event it would have been. A backfill that fails throws: the link closes the socket, backs off and opens
 * another, whose hello backfills again from the cursor where it stayed.
 *
 * Each message, live or backfilled:
 *   - the bound operator's text (an events_api envelope of this app and this team, a message in the DM `secret.channel`, from the
 *     operator's user id, no bot and no subtype): `!` commands rewritten to `/` (normalizeCommand); with Chat with Gravit not ticking
 *     Slack and no command, answered SLACK_CHAT_OFF and kept nowhere; else appended to the inbox as `slack:<ts>` (with `slack:<thread_ts>`
 *     as replyTo in a thread), and only then acked and the cursor moved past it. A text the inbox cannot store is held (not acked) and
 *     ends its socket, so nothing after it is handled there and the cursor stays before it: the next hello's backfill reads it again.
 *     A live text the inbox holds already, or Slack's retry of one at or before the cursor, is acked and skipped;
 *   - the operator's file (subtype file_share): answered "text only, please";
 *   - anyone else's DM: by sheet 3's rule (memberKind) a bot is dropped, and anyone else — another team's member, a guest, a deactivated
 *     account, a full member who is not the operator — is a stranger: counted in Not you unless blocked, never stored, never answered;
 *   - everything else (a channel, a group or an mpim, a bot, an edit or a deletion, another team or app, a slash command): dropped.
 * Everything but a held text is acked at once. Each hello's num_connections is read by ruling 8 (ConflictWatch): a conflict is the
 * status's conflictAt and a line at most once a minute.
 */
export class SlackConnector implements Connector {
  /** where a connector of this home starts after a restart: the ts kept in `<home>/identity/slack.cursor`, or undefined */
  static resumeFrom(home: string): string | undefined {
    try {
      const ts = readFileSync(join(identityDir(home), CURSOR_FILE), "utf8").trim();
      return TS_SHAPE.test(ts) ? ts : undefined;
    } catch {
      return undefined;
    }
  }

  private cursor: string | undefined;
  private started = false;
  private disposed = false;
  private conflictAt: string | undefined;
  private conflictSaidAt = Number.NEGATIVE_INFINITY;
  private authFailing: { since: string; reason: string } | undefined;
  private blockedBySender = false;
  private readonly answered = new Set<string>();
  private readonly team: string;
  private readonly operator: string;
  private readonly watch: ConflictWatch;

  constructor(private readonly d: SlackConnectorDeps) {
    this.cursor = d.cursor !== undefined && TS_SHAPE.test(d.cursor) ? d.cursor : undefined;
    const at = d.binding.operatorId.indexOf(":");
    this.team = d.binding.operatorId.slice(0, at);
    this.operator = d.binding.operatorId.slice(at + 1);
    this.watch = new ConflictWatch({ clock: d.clock, recheck: () => d.socket.reopen("a recheck of how many sockets Slack holds for the app"), verdict: (on, n) => this.verdict(on, n) });
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    // nothing before the start is read when no cursor was kept
    this.cursor ??= tsAt(this.d.clock.now());
    // an earlier socket of this app's own (the pending connection's, or a run before a restart) may still be counted for a few seconds
    this.watch.closed();
    this.d.socket.run({
      hello: async (h) => {
        if (this.disposed) return;
        this.watch.hello(h.connections);
        await this.backfill();
      },
      envelope: (e) => this.envelope(e),
      down: () => this.watch.closed(),
    });
  }

  status(): NetworkStatus {
    const s = this.d.socket.status();
    const failing = s.failing ?? this.authFailing;
    return {
      network: "slack",
      polling: !this.disposed && s.open,
      ...(s.lastFrameAt === undefined ? {} : { lastPollAt: s.lastFrameAt }),
      ...(this.conflictAt === undefined ? {} : { conflictAt: this.conflictAt }),
      ...(this.blockedBySender ? { blocked: true as const } : {}),
      ...(failing === undefined ? {} : { pollFailing: { ...failing } }),
    };
  }

  setBlocked(blocked: boolean): void {
    this.blockedBySender = blocked;
  }

  /** the link stopped and its socket closed; the caller aborts the client's signal, which cuts a call under way */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.watch.cancel();
    await this.d.socket.dispose();
  }

  // ---- inside ----

  private stamp(): string {
    return new Date(this.d.clock.now()).toISOString();
  }

  private verdict(on: boolean, connections: number): void {
    if (!on) {
      this.conflictAt = undefined;
      return;
    }
    this.conflictAt = this.stamp();
    const at = this.d.clock.now();
    if (at - this.conflictSaidAt < RECORD_EVERY_MS) return;
    this.conflictSaidAt = at;
    this.d.log(`identity: Slack counts ${connections} sockets for this app: another process holds its Socket Mode link, and Slack spreads the DM's messages across them`);
  }

  /** a Web API call that failed: Slack's codes for tokens it no longer takes are the status's pollFailing */
  private failed(err: unknown): void {
    if (err instanceof SlackApiError && AUTH_CODES.has(err.code)) this.authFailing = { since: this.authFailing?.since ?? this.stamp(), reason: err.code };
  }

  /** the cursor moved to `ts` (never back), and written; a file that cannot be written is one line — the next hello reads from the last
   * one written, and the inbox keeps a network id once */
  private advance(ts: string): void {
    if (this.cursor !== undefined && tsCompare(ts, this.cursor) <= 0) return;
    this.cursor = ts;
    try {
      writeIdentityFile(this.d.home, CURSOR_FILE, `${ts}\n`);
    } catch (err) {
      this.d.log(`identity: Slack's cursor could not be written (${(err as NodeJS.ErrnoException).code ?? reasonOf(err)})`);
    }
  }

  /** pages of `read` until there is no next page, `max` rows or the connector's stop: the rows, and whether there were more */
  private async pages(read: (next?: string) => Promise<{ messages: unknown[]; next?: string }>, max: number): Promise<{ rows: unknown[]; more: boolean }> {
    const rows: unknown[] = [];
    let next: string | undefined;
    do {
      let page: { messages: unknown[]; next?: string };
      try {
        page = await read(next);
      } catch (err) {
        this.failed(err);
        throw new Error(`the backfill could not read the DM (${reasonOf(err)})`);
      }
      this.authFailing = undefined;
      rows.push(...page.messages);
      next = page.next;
    } while (next !== undefined && rows.length < max && !this.disposed);
    return { rows, more: rows.length > max || next !== undefined };
  }

  /** The DM after the cursor, oldest first, each message handled and the cursor moved past it: the top-level messages
   * (conversations.history), and the replies (conversations.replies) of each thread whose latest reply is after the cursor, its parent
   * found among those or in the history of the last THREAD_LOOKBACK_MS. Throws when a page cannot be read or a text cannot be stored,
   * the cursor left before it */
  private async backfill(): Promise<void> {
    const channel = this.d.secret.channel;
    const oldest = this.cursor ?? tsAt(this.d.clock.now());
    const read = (raw: unknown): ImMessage | undefined => imMessageOf(raw !== null && typeof raw === "object" ? { ...(raw as object), channel, channel_type: "im" } : undefined);
    const after = (m: ImMessage | undefined): m is ImMessage => m !== undefined && tsCompare(m.ts, oldest) > 0;
    const top = await this.pages((next) => this.d.api.history(channel, oldest, BACKFILL_PAGE, next), INBOX_MAX);
    let over = top.more;
    // a parent: a top-level message whose thread's latest reply is after the cursor
    const parents = new Set<string>();
    const noteParents = (rows: unknown[]) => {
      for (const row of rows) {
        const r = row as { ts?: unknown; latest_reply?: unknown } | null;
        if (!r || typeof r.ts !== "string" || !TS_SHAPE.test(r.ts) || typeof r.latest_reply !== "string" || !TS_SHAPE.test(r.latest_reply)) continue;
        if (tsCompare(r.latest_reply, oldest) > 0) parents.add(r.ts);
      }
    };
    noteParents(top.rows);
    // a parent before the cursor is not in that read: the last day's history is read for it (bounded)
    const dayAgo = tsAt(Math.max(0, this.d.clock.now() - THREAD_LOOKBACK_MS));
    if (tsCompare(dayAgo, oldest) < 0) {
      const day = await this.pages((next) => this.d.api.history(channel, dayAgo, BACKFILL_PAGE, next), THREAD_PAGES_MAX * BACKFILL_PAGE);
      noteParents(day.rows);
      if (day.more) this.d.log(`identity: the Slack DM has more than ${THREAD_PAGES_MAX * BACKFILL_PAGE} messages in the last day: the threads of the older ones were not searched for replies`);
    }
    const byTs = new Map<string, ImMessage>();
    for (const m of top.rows.slice(0, INBOX_MAX).map(read).filter(after)) byTs.set(m.ts, m);
    for (const parent of parents) {
      if (this.disposed) return;
      const thread = await this.pages((next) => this.d.api.replies(channel, parent, oldest, BACKFILL_PAGE, next), INBOX_MAX);
      over ||= thread.more;
      // Slack answers the parent too: a top-level message, read (or not) as one
      for (const m of thread.rows.map(read).filter(after)) if (m.ts !== parent && !byTs.has(m.ts)) byTs.set(m.ts, m);
    }
    const all = [...byTs.values()].sort((a, b) => tsCompare(a.ts, b.ts));
    if (over || all.length > INBOX_MAX) this.d.log(`identity: more than ${INBOX_MAX} messages in the Slack DM since the cursor: the newest ${INBOX_MAX} are read, the older ones are not`);
    for (const m of all.slice(-INBOX_MAX)) {
      if (this.disposed) return;
      if ((await this.handle(m, undefined)) !== "ok") throw new Error("the backfill stopped at a text the inbox could not store");
      this.advance(m.ts);
    }
  }

  private async envelope(e: Envelope): Promise<"ack" | "hold"> {
    if (this.disposed) return "hold";
    const m = imMessageOf(envelopeEvent(e, this.team, this.d.secret.appId));
    if (!m) return "ack";
    const done = await this.handle(m, e.retryAttempt);
    if (done === "ok") return "ack";
    // the operator's text could not be stored: nothing after it is handled on this socket, so the cursor cannot pass it - the next
    // hello's backfill reads it again from the cursor (and, while the inbox still cannot store, fails and backs off)
    if (done === "stop") this.d.socket.reopen("a text of the operator's could not be stored");
    return "hold";
  }

  /** one message handled: "ok"; "hold" for a stranger users.info did not answer for; "stop" for the operator's text the inbox could not
   * store */
  private async handle(m: ImMessage, retryAttempt: number | undefined): Promise<"ok" | "hold" | "stop"> {
    // live: an envelope's (with how many times Slack sent it before); undefined: a backfilled row
    const live = retryAttempt !== undefined;
    if (m.bot || m.user === undefined) return "ok";
    if (m.user !== this.operator) {
      // the operator's DM holds only the operator and the bot: anyone else is heard live, in their own DM with the app
      if (!live || m.subtype !== undefined) return "ok";
      return (await this.stranger(m.user)) ? "ok" : "hold";
    }
    if (m.channel !== this.d.secret.channel) return "ok";
    if (m.subtype === "file_share") {
      await this.answer(m.ts, TEXT_ONLY);
      this.advance(m.ts);
      return "ok";
    }
    if (m.subtype !== undefined) return "ok";
    const text = normalizeCommand(m.text);
    if (!this.d.chatOn() && !PHONE_COMMAND.test(text.trim())) {
      await this.answer(m.ts, SLACK_CHAT_OFF);
      this.advance(m.ts);
      return "ok";
    }
    const replyTo = m.threadTs !== undefined && m.threadTs !== m.ts ? `slack:${m.threadTs}` : undefined;
    const messageId = `slack:${m.ts}`;
    // taken already: the ring holds it — or, past the ring's last 500, Slack's retry of a text at or before the cursor. A first delivery at
    // or before the cursor is a text Slack sent out of order, and is stored
    if (live && (this.d.inbox.has(messageId, this.d.binding.botId) || (retryAttempt > 0 && this.cursor !== undefined && tsCompare(m.ts, this.cursor) <= 0))) return "ok";
    try {
      this.d.inbox.append({ network: "slack", messageId, ...(replyTo ? { replyTo } : {}), text, at: atOf(m.ts) }, this.d.binding.botId);
    } catch (err) {
      this.d.log(`identity: the operator's Slack message could not be stored in the inbox (${(err as NodeJS.ErrnoException).code ?? reasonOf(err)}); it is not acked, and it is read again from the DM`);
      return "stop";
    }
    this.advance(m.ts);
    return "ok";
  }

  /** someone other than the operator in a DM with the app: dropped when blocked or a bot, else counted; held when users.info does not
   * answer, so Slack sends it again */
  private async stranger(user: string): Promise<boolean> {
    const id = `${this.team}:${user}`;
    if (this.d.blocked().includes(senderRef("slack", id))) return true;
    let info: Awaited<ReturnType<SlackApi["usersInfo"]>>;
    try {
      info = await this.d.api.usersInfo(user);
    } catch (err) {
      this.failed(err);
      this.d.log(`identity: Slack's users.info did not answer (${reasonOf(err)}); the message is not acked, so Slack sends it again`);
      return false;
    }
    this.authFailing = undefined;
    if (memberKind(info, this.team) === "bot") return true;
    try {
      this.d.strangers.note("slack", id, this.d.clock.now());
    } catch (err) {
      this.d.log(`identity: a stranger could not be counted (${(err as NodeJS.ErrnoException).code ?? reasonOf(err)}); the socket goes on`);
    }
    return true;
  }

  /** a line to the operator about the message `ts`, once for that message however often it is read */
  private async answer(ts: string, text: string): Promise<void> {
    if (this.answered.has(ts)) return;
    this.answered.add(ts);
    if (this.answered.size > ANSWERED_MAX) this.answered.delete(this.answered.values().next().value as string);
    try {
      await this.d.reply(text);
      this.authFailing = undefined;
      this.blockedBySender = false;
    } catch (err) {
      this.failed(err);
      this.d.log(`identity: a line to the operator on Slack did not go (${reasonOf(err)})`);
    }
  }
}
