/** THE PENDING CONNECTION — Connect's sheets 1 to 3, on the account's side, for any network the account speaks on.
 *
 *   Sheet 1, Next: the page sends the network's token(s) once, beside the fingerprint it made (keyHash = hex sha256(salt ‖ keyInput), the
 *     brain-key recipe; keyInput is Telegram's token, or Slack's app-level token, a NUL and its bot token). begin() checks the key against
 *     the fingerprint (keyMatches, constant time), refuses while that network is connected already, and asks the network's PendingSource
 *     to check who the bot is (Telegram's getMe; Slack's auth.test, bots.info and a socket's hello). A key the network does not know is
 *     refused; nothing is kept of a refused one. Telegram's route calls the short form, begin(token, keyHash, salt), which checks the
 *     token's shape first (TOKEN_SHAPE); Slack's calls beginSlack(appToken, botToken, keyHash, salt), which checks both tokens' shapes
 *     (slack.ts) and joins them with a NUL. Every refusal is in the network's own fixed words (IDENTITY_WORDS).
 *   Sheet 2, Say hi: the key is held in this process's memory — never a file, a log line, an answer or a ledger row — and the source
 *     listens for the first private message to the bot (Telegram: getUpdates, messages only; a group's message is skipped).
 *   Sheet 3, Is this you?: the sender heard — their name, @handle, their id masked to its last three characters, and what they wrote. "Not
 *     me" counts them as a stranger (store.ts Strangers) and waits again; a later message from the same person is counted, never heard.
 *     "Yes" is the signed connectNetwork, whose door handler takes the pending connection (take) and checks it against what was signed.
 *
 * One pending connection at a time, whatever its network: a second replaces the first, whose listening is cut and whose key is forgotten.
 * A pending connection lasts PENDING_MS (ten minutes, a signed instruction's life): past it the key and the source that holds it are
 * dropped and the view says "expired" until the page starts again or drops it. drop forgets it at once. A conflict the source reports
 * (Telegram's 409: another poller holds the token, or a webhook is set) shows as "conflict" until it reports none again.
 *
 * Where the source stood after the message heard (`resume`: Telegram's offset after the update) is handed over with the rest, so that the
 * connected connector starts after the message the operator was heard by.
 *
 * What is network-shaped lives behind PendingSource (telegram.ts TelegramPendingSource, slack.ts SlackPendingSource): this file keeps the
 * shell — the one entry, its expiry, view, notMe, drop, peek and take. */
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { Refusal } from "../../core/errors.ts";
import { isRefusal } from "../../core/errors.ts";
import { keyMatches } from "../account/brain-keys.ts";
import { no } from "../refuse.ts";
import { redactorOf } from "./bot-api.ts";
import { NETWORK_NAME, type Network } from "./kinds.ts";
import { IDENTITY_WORDS } from "./routes.ts";
import type { SlackSecret, TelegramSecret } from "./secret-file.ts";
import { SLACK_APP_TOKEN_SHAPE, SLACK_BOT_TOKEN_SHAPE, SlackPendingSource } from "./slack.ts";
import { SLACK_API } from "./slack-api.ts";
import type { OpenSocket } from "./slack-socket.ts";
import { maskId, senderRef, type Strangers } from "./store.ts";
import { realClock, TelegramPendingSource, type IdentityClock } from "./telegram.ts";

/** how long a pending connection lasts: ten minutes, the life of the connectNetwork that ends it (sign.ts BRAIN_KEY_TTL_MS) */
export const PENDING_MS = 600_000;
/** BotFather's token: digits, a colon, then letters */
export const TOKEN_SHAPE = /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/;
/** the wait before listening again after the source itself stopped on a fault */
const RELISTEN_MS = 5_000;

/** the bot a source checked: its id, handle and name, the link to it, and on Slack the workspace it is in */
export interface PendingBot {
  id: string;
  username: string;
  name: string;
  link: string;
  workspace?: string;
}

/** a sender heard: `id` the network's own id, which the page signs as connectNetwork's operatorId and draws only masked */
export interface PendingSender {
  id: string;
  name: string;
  handle: string;
  /** their id masked to its last three characters (what Not you shows) */
  masked: string;
  text: string;
  /** on Slack: their full user id (U…, not a secret), which sheet 3 shows beside the name and handle — a display name is anyone's to set,
   * the id is not */
  userId?: string;
}

/** where the source stood after the message heard, for the connected connector to start from */
export type PendingResume = { network: "telegram"; offset: number } | { network: "slack"; appId: string; channel: string; cursor: string };

/** A network's side of a pending connection: the key it was made with (its token strings, for every line to take out), the check of who
 * the bot is, and the listening for the first sender — which asks the shell about each sender (`admit`), tells it whom it heard (`heard`)
 * and whether another holder is in the way (`conflict`), and stops when `signal` aborts or once it has heard someone */
export interface PendingSource {
  network: Network;
  secrets: readonly string[];
  check(signal: AbortSignal): Promise<PendingBot | Refusal>;
  listen(ctx: { signal: AbortSignal; admit(senderId: string): "hear" | "stranger" | "drop"; stranger(senderId: string): void; heard(s: PendingSender): void; conflict(on: boolean): void; log(l: string): void }): Promise<void>;
  resume(): PendingResume;
}

export interface PendingView {
  id: string;
  network: Network;
  bot: { id: string; username: string; name: string; workspace?: string };
  /** on Slack: the workspace the app is installed in */
  workspace?: string;
  /** the bot's page at the network: https://t.me/<username> on Telegram, Slack's app_redirect to the app's DM on Slack */
  link: string;
  /** the link as a QR code: `data:image/svg+xml;base64,` and the SVG qrcode draws, which the page shows as an <img> */
  qr: string;
  expiresAt: string;
  state: "waiting" | "heard" | "conflict" | "expired";
  /** the sender heard: `id` their network id, which the page signs as connectNetwork's operatorId and draws only masked */
  sender?: PendingSender;
}

/** the QR code of a bot's link, as the pending view carries it */
export const qrOf = async (link: string): Promise<string> =>
  `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(link, { type: "svg", margin: 1 }), "utf8").toString("base64")}`;

export interface PendingTaken {
  network: Network;
  /** the string the fingerprint hashes: Telegram's token; Slack's app-level token, a NUL and its bot token */
  keyInput: string;
  keyHash: string;
  salt: string;
  bot: PendingBot;
  sender: { id: string; handle: string };
  resume: PendingResume;
  /** the token file the connect writes */
  secret: TelegramSecret | SlackSecret;
  /** B1's names, on Telegram's alone: its token (keyInput) and the getUpdates offset after the update heard (resume.offset) */
  token?: string;
  offset?: number;
}

export interface PendingDeps {
  /** Telegram's Bot API, for the short form of begin */
  apiBase: string;
  /** Slack's Web API (slack-api.ts slackApiBase), for beginSlack: Slack's own unless set */
  slackApiBase?: string | undefined;
  /** how a Slack socket is opened (Node's WebSocket unless set) and the clock its waits run on (real timers unless set) */
  openSocket?: OpenSocket | undefined;
  clock?: IdentityClock | undefined;
  strangers: Strangers;
  /** whether `network` is connected already: a connection is refused while it is */
  bound: (network: Network) => boolean;
  /** the senders' references the owner blocked: neither heard nor counted, as the connected connector drops them */
  blocked?: (() => string[]) | undefined;
  fetch?: typeof fetch | undefined;
  /** Telegram's pending long poll, in seconds (25) */
  pollTimeoutS?: number | undefined;
  now?: (() => number) | undefined;
  log?: ((l: string) => void) | undefined;
}

interface Entry {
  id: string;
  network: Network;
  /** the key the fingerprint hashes (keyInput): blanked with the source when the entry is cut */
  token: string;
  keyHash: string;
  salt: string;
  bot: PendingBot;
  qr: string;
  expiresAt: number;
  state: PendingView["state"];
  sender?: PendingSender;
  /** who said "Not me" during this connection: counted as strangers if they write again, never heard */
  notMe: Set<string>;
  /** the source, which holds the key: dropped with it (cut), so an expired tombstone holds neither */
  api: PendingSource | undefined;
  stop: AbortController;
  looping: boolean;
  /** asked to listen again while the last listening had not yet returned: it listens again as soon as it does */
  again: boolean;
  /** which listening is the current one: a listening that has returned is not heard from again */
  gen: number;
  timer: NodeJS.Timeout | undefined;
}

const refusal = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { message });

/** the operator's handle as sheet 3 showed it: their @handle, or their masked id when they have none */
export const operatorHandleOf = (sender: { id: string; handle: string }): string => (sender.handle !== "" ? sender.handle : maskId(sender.id));

/** Slack's key, its two halves: the app-level token and the bot token either side of the one NUL — or undefined when it is not two
 * non-empty halves (a key without its NUL, with a second, or with a half empty is never split) */
export function slackPairOf(keyInput: string): { appToken: string; botToken: string } | undefined {
  const halves = keyInput.split("\u0000");
  if (halves.length !== 2 || halves[0] === "" || halves[1] === "") return undefined;
  return { appToken: halves[0] as string, botToken: halves[1] as string };
}

/** the token file a connect writes, from what the pending connection holds; undefined when the key and the network do not agree */
function secretOf(network: Network, keyInput: string, bot: PendingBot, sender: { id: string; handle: string }, resume: PendingResume): TelegramSecret | SlackSecret | undefined {
  const operatorHandle = operatorHandleOf(sender);
  if (network === "slack") {
    const pair = slackPairOf(keyInput);
    if (!pair || resume.network !== "slack" || resume.channel === "") return undefined;
    return { appToken: pair.appToken, botToken: pair.botToken, appId: resume.appId, channel: resume.channel, botId: bot.id, username: bot.username, operatorId: sender.id, operatorHandle };
  }
  return { token: keyInput, botId: bot.id, username: bot.username, operatorId: sender.id, operatorHandle };
}

export class PendingConnections {
  private current: Entry | undefined;
  private disposed = false;
  private readonly now: () => number;
  private readonly log: (l: string) => void;

  constructor(private readonly deps: PendingDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((l) => console.error(l));
  }

  /** Sheet 1's Next: the key checked and held, the bot named, the listening begun — or a refusal in IDENTITY_WORDS' fixed words. The
   * short form is Telegram's: the token's shape checked, then the token held by a TelegramPendingSource */
  begin(token: string, keyHash: string, salt: string): Promise<PendingView | Refusal>;
  begin(network: Network, source: PendingSource, keyInput: string, keyHash: string, salt: string): Promise<PendingView | Refusal>;
  async begin(...args: [string, string, string] | [Network, PendingSource, string, string, string]): Promise<PendingView | Refusal> {
    if (args.length === 3) {
      const [token, keyHash, salt] = args;
      if (this.disposed) return refusal(IDENTITY_WORDS.noPending);
      if (!TOKEN_SHAPE.test(token)) return refusal(IDENTITY_WORDS.tokenShape);
      const source = new TelegramPendingSource({ token, apiBase: this.deps.apiBase, fetch: this.deps.fetch, pollTimeoutS: this.deps.pollTimeoutS, log: this.log });
      return this.beginWith("telegram", source, token, keyHash, salt);
    }
    return this.beginWith(...args);
  }

  /** Slack's Sheet 1 Next: both tokens' shapes checked (an app-level token, then a bot token), then joined with a NUL and held by a
   * SlackPendingSource — the fingerprint checked against that join before Slack is asked */
  async beginSlack(appToken: string, botToken: string, keyHash: string, salt: string): Promise<PendingView | Refusal> {
    if (this.disposed) return refusal(IDENTITY_WORDS.noPending);
    if (!SLACK_APP_TOKEN_SHAPE.test(appToken) || !SLACK_BOT_TOKEN_SHAPE.test(botToken)) return refusal(IDENTITY_WORDS.slackTokenShape);
    const source = new SlackPendingSource({ appToken, botToken, apiBase: this.deps.slackApiBase ?? SLACK_API, fetch: this.deps.fetch, open: this.deps.openSocket, clock: this.deps.clock ?? realClock(), log: this.log });
    return this.beginWith("slack", source, `${appToken}\u0000${botToken}`, keyHash, salt);
  }

  /** the pending connection `id` as sheets 2 and 3 show it, or undefined when there is none by that id */
  view(id: string): PendingView | undefined {
    const e = this.entry(id);
    return e ? this.viewOf(e) : undefined;
  }

  /** Sheet 3's "Not me": the sender heard counted as a stranger, and the connection waits again */
  notMe(id: string): PendingView | undefined {
    const e = this.entry(id);
    if (!e) return undefined;
    if (e.state === "heard" && e.sender) {
      this.noteStranger(e.network, e.sender.id);
      e.notMe.add(e.sender.id);
      delete e.sender;
      e.state = "waiting";
      this.listen(e);
    }
    return this.viewOf(e);
  }

  /** forget the pending connection `id` at once: its listening cut, its key dropped */
  drop(id: string): void {
    if (this.current && this.current.id === id) this.forget();
  }

  /** what the connectNetwork door checks before it takes: the heard connection `id` as take would hand it over, left where it is — so a
   * signature that does not match it is refused and the owner can still sign the right one; undefined unless it is heard and in time */
  peek(id: string): PendingTaken | undefined {
    const e = this.entry(id);
    if (!e || e.state !== "heard" || !e.sender || !e.api) return undefined;
    const resume = e.api.resume();
    if (resume.network !== e.network) return undefined;
    const bot = { ...e.bot };
    const sender = { id: e.sender.id, handle: e.sender.handle };
    const secret = secretOf(e.network, e.token, bot, sender, resume);
    if (!secret) return undefined;
    return {
      network: e.network,
      keyInput: e.token,
      keyHash: e.keyHash,
      salt: e.salt,
      bot,
      sender,
      resume,
      secret,
      ...(resume.network === "telegram" ? { token: e.token, offset: resume.offset } : {}),
    };
  }

  /** the connectNetwork door's: the heard connection `id` handed over and forgotten here; undefined unless it is heard and in time */
  take(id: string): PendingTaken | undefined {
    const taken = this.peek(id);
    if (taken) this.forget();
    return taken;
  }

  dispose(): void {
    this.disposed = true;
    this.forget();
  }

  // ---- inside ----

  private async beginWith(network: Network, source: PendingSource, keyInput: string, keyHash: string, salt: string): Promise<PendingView | Refusal> {
    if (this.disposed) return refusal(IDENTITY_WORDS.noPending);
    if (source.network !== network) return refusal(IDENTITY_WORDS.networkUnknown);
    // Slack's key is two tokens either side of one NUL: anything else is not split, and not taken
    if (network === "slack" && !slackPairOf(keyInput)) return refusal(IDENTITY_WORDS.slackTokenShape);
    if (!keyMatches(salt, keyInput, keyHash)) return refusal(IDENTITY_WORDS.mismatchOn(network));
    if (this.deps.bound(network)) return refusal(IDENTITY_WORDS.connectedOn(network));
    const stop = new AbortController();
    let bot: PendingBot | Refusal;
    try {
      bot = await source.check(stop.signal);
    } catch (err) {
      // a source answers its refusals; anything it throws is said without its key, as the network not answering
      bot = refusal(IDENTITY_WORDS.unreachableOn(network));
      this.log(`identity: ${NETWORK_NAME[network]}'s check did not answer (${redactorOf(source.secrets)(err instanceof Error ? err.message : String(err))})`);
    }
    if (isRefusal(bot)) {
      stop.abort();
      return bot;
    }
    // the link's QR code (a link qrcode cannot draw is drawn as none: the link itself is on the sheet)
    const qr = await qrOf(bot.link).catch(() => "");
    if (this.disposed) {
      stop.abort();
      return refusal(IDENTITY_WORDS.noPending);
    }
    // one pending connection at a time: the one before is cut and forgotten
    this.forget();
    const e: Entry = { id: randomBytes(16).toString("hex"), network, token: keyInput, keyHash, salt, bot: { ...bot }, qr, expiresAt: this.now() + PENDING_MS, state: "waiting", notMe: new Set(), api: source, stop, looping: false, again: false, gen: 0, timer: undefined };
    // the key is dropped at its time even if nobody looks again
    e.timer = setTimeout(() => this.expire(e), PENDING_MS);
    e.timer.unref();
    this.current = e;
    this.listen(e);
    return this.viewOf(e);
  }

  private entry(id: string): Entry | undefined {
    const e = this.current;
    if (!e || e.id !== id) return undefined;
    this.expireIfPast(e);
    return e;
  }

  private expireIfPast(e: Entry): void {
    if (e.state !== "expired" && this.now() >= e.expiresAt) this.expire(e);
  }

  private viewOf(e: Entry): PendingView {
    return {
      id: e.id,
      network: e.network,
      bot: { id: e.bot.id, username: e.bot.username, name: e.bot.name, ...(e.bot.workspace !== undefined ? { workspace: e.bot.workspace } : {}) },
      ...(e.bot.workspace !== undefined ? { workspace: e.bot.workspace } : {}),
      link: e.bot.link,
      qr: e.qr,
      expiresAt: new Date(e.expiresAt).toISOString(),
      state: e.state,
      ...(e.state === "heard" && e.sender ? { sender: { id: e.sender.id, name: e.sender.name, handle: e.sender.handle, masked: e.sender.masked, text: e.sender.text, ...(e.sender.userId !== undefined ? { userId: e.sender.userId } : {}) } } : {}),
    };
  }

  /** past its time: the listening cut, the key and the sender dropped; the view says "expired" until it is dropped or replaced */
  private expire(e: Entry): void {
    if (e.state === "expired") return;
    e.state = "expired";
    this.cut(e);
  }

  private forget(): void {
    const e = this.current;
    this.current = undefined;
    if (e) this.cut(e);
  }

  private cut(e: Entry): void {
    e.stop.abort();
    if (e.timer) clearTimeout(e.timer);
    e.timer = undefined;
    e.api = undefined;
    e.token = "";
    e.keyHash = "";
    e.salt = "";
    delete e.sender;
    e.notMe.clear();
  }

  private live(e: Entry): boolean {
    return this.current === e && e.api !== undefined && !e.stop.signal.aborted && (e.state === "waiting" || e.state === "conflict");
  }

  /** a stranger counted; a store that cannot write is said in one line (no id, no key) and the connection goes on */
  private noteStranger(network: Network, id: string): void {
    try {
      this.deps.strangers.note(network, id, this.now());
    } catch (err) {
      this.log(`identity: a stranger could not be counted (${err instanceof Error ? (err as NodeJS.ErrnoException).code ?? err.name : "error"}); the connection goes on`);
    }
  }

  private sleep(e: Entry, ms: number): Promise<void> {
    return new Promise((done) => {
      if (e.stop.signal.aborted) return done();
      const end = () => {
        clearTimeout(t);
        e.stop.signal.removeEventListener("abort", end);
        done();
      };
      const t = setTimeout(end, ms);
      t.unref();
      e.stop.signal.addEventListener("abort", end, { once: true });
    });
  }

  /** what the shell says of a sender the source has in hand: neither heard nor counted when blocked (or when the connection is no longer
   * waiting), counted when they said "Not me" before, else heard */
  private admit(e: Entry, senderId: string): "hear" | "stranger" | "drop" {
    this.expireIfPast(e);
    if (!this.live(e)) return "drop";
    if (this.deps.blocked?.().includes(senderRef(e.network, senderId))) return "drop";
    if (e.notMe.has(senderId)) {
      this.noteStranger(e.network, senderId);
      return "stranger";
    }
    return "hear";
  }

  /** the source listening: until a sender is heard, or the connection is dropped, taken, replaced or expired */
  private listen(e: Entry): void {
    const source = e.api;
    if (!source) return;
    if (e.looping) {
      e.again = true;
      return;
    }
    e.looping = true;
    const gen = ++e.gen;
    const current = () => e.gen === gen && this.live(e);
    // the key's spellings, taken now: every line this listening says is redacted with them, even after cut() has dropped the source
    const redact = redactorOf(source.secrets);
    const log = (l: string) => this.log(redact(l));
    void source
      .listen({
        signal: e.stop.signal,
        admit: (senderId) => (e.gen === gen ? this.admit(e, senderId) : "drop"),
        // a sender the source itself will never hear (on Slack: another team, a guest, a deactivated account): counted in Not you unless
        // blocked, as a "Not me" sender is
        stranger: (senderId) => {
          if (e.gen !== gen || !this.live(e) || this.deps.blocked?.().includes(senderRef(e.network, senderId))) return;
          this.noteStranger(e.network, senderId);
        },
        heard: (s) => {
          if (!current()) return;
          e.sender = { id: s.id, name: s.name, handle: s.handle, masked: s.masked, text: s.text, ...(s.userId !== undefined ? { userId: s.userId } : {}) };
          e.state = "heard";
        },
        conflict: (on) => {
          this.expireIfPast(e);
          if (!current()) return;
          if (on) e.state = "conflict";
          else if (e.state === "conflict") e.state = "waiting";
        },
        log,
      })
      .finally(() => {
        e.gen += 1;
        e.looping = false;
        if (e.again) {
          e.again = false;
          if (this.live(e)) this.listen(e);
        }
      })
      .catch(async (err: unknown) => {
        // a fault in the source itself, said without the key; a connection still waiting listens again after a pause
        log(`identity: the pending ${NETWORK_NAME[e.network]} connection's poll stopped (${redact(err instanceof Error ? err.message : String(err))}); polling again in ${RELISTEN_MS / 1000} s`);
        await this.sleep(e, RELISTEN_MS);
        if (this.live(e) && !e.looping) this.listen(e);
      });
  }
}
