/** SLACK'S SIDE OF CONNECT'S SHEETS 1 TO 3 — the pending connection's source for a Slack app (pending.ts PendingSource), holding the app's
 * two tokens in memory for its ten minutes and nowhere else.
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
 * them) is the shell's conflict until a hello counts one again. Whatever ends the pending connection — dropped, replaced, expired, taken —
 * aborts its signal, which closes the socket and cuts every call under way. */
import type { Refusal } from "../../core/errors.ts";
import { no } from "../refuse.ts";
import { redactorOf } from "./bot-api.ts";
import { SLACK_TOKEN_ANYWHERE } from "./kinds.ts";
import type { PendingBot, PendingResume, PendingSource } from "./pending.ts";
import { IDENTITY_WORDS } from "./routes.ts";
import { SlackApi, SlackApiError, slackAppLink, socketUrlOk } from "./slack-api.ts";
import { SlackSocket, type Envelope, type OpenSocket } from "./slack-socket.ts";
import { maskId } from "./store.ts";
import type { IdentityClock } from "./telegram.ts";

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

  constructor(private readonly o: SlackPendingSourceOptions) {
    this.secrets = [o.appToken, o.botToken];
    this.redactOwn = redactorOf(this.secrets, "<token>");
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
      else if (this.connections > 0) ctx.conflict(this.connections > 1);
    });
    if (this.ctx === ctx) this.ctx = undefined;
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
        else this.ctx?.conflict(h.connections > 1);
      },
      envelope: (e) => (this.socket === socket ? this.envelope(e) : Promise.resolve("hold" as const)),
      down: () => {
        if (this.socket === socket) this.connections = 0;
      },
    });
  }

  private async closeSocket(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.connections = 0;
    if (socket) await socket.dispose();
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
    if (user.isBot) return "ack";
    if (this.ctx !== ctx || ctx.signal.aborted) return "hold";
    // only a full member of the bot's own team is ever heard: someone of another team (a shared channel's DM), a guest or a deactivated
    // account is counted in Not you, and the sheet waits on
    if (user.teamId !== who.teamId || user.restricted || user.deleted) {
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
  if (e.type !== "events_api") return undefined;
  const p = e.payload as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object" || p.team_id !== who.teamId || p.api_app_id !== who.appId) return undefined;
  const ev = p.event as Record<string, unknown> | null | undefined;
  if (!ev || typeof ev !== "object" || ev.type !== "message" || ev.channel_type !== "im") return undefined;
  if (ev.subtype !== undefined || ev.bot_id !== undefined || ev.bot_profile !== undefined) return undefined;
  const { user, channel, ts, text } = ev;
  if (typeof user !== "string" || !/^[UW][A-Z0-9]{2,20}$/.test(user)) return undefined;
  if (typeof channel !== "string" || !/^D[A-Z0-9]{2,20}$/.test(channel)) return undefined;
  if (typeof ts !== "string" || !/^\d{9,12}\.\d{6}$/.test(ts)) return undefined;
  return { user, channel, ts, text: typeof text === "string" ? text : "" };
}
