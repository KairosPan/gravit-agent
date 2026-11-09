/** THE CONNECTED POLLER — Telegram, once the owner signed connectNetwork: the long poll of getUpdates for the bot Gravit speaks as, the
 * loop of the face's old bridge (face/src/telegram.ts installTelegramBridge: run, poll, take, its backoff and its once-a-minute lines)
 * without anything the desk does — the desk reads the inbox (inbox.ts) through the account.
 *
 * Each update, in order:
 *   - a text from the bound operator (`from.id` and the chat's id both the operator's id, in a private chat): if the Chat with Gravit row
 *     ticks Telegram, appended to the inbox as `telegram:<message_id>` (with the message it replies to); else answered "Chat with Gravit
 *     is off on Telegram: Account › Identity turns it on." and kept nowhere;
 *   - anything else from the operator in a private chat (a photo, a sticker, a file) is answered "text only, please" and kept nowhere;
 *   - a person who is not the operator, in a private chat: counted in Not you (store.ts Strangers — a reference, a masked id, a count and a
 *     time; never a name, a handle or a text) unless the owner blocked them, and never answered;
 *   - everything else (a group, a channel post, an edited message, a bot) is dropped.
 * Only then does the offset move past it — written to `<home>/identity/telegram.offset`, and confirmed to Telegram by the next poll. A text
 * the inbox could not store stops the batch where it is: the offset stays before it, and the poll backs off and reads it again. An update
 * numbered below the offset (Telegram numbered its updates afresh) is taken all the same, with one line. An update with no update_id is
 * dropped unhandled (a line at most once a minute): it has no number to confirm, so handling it would answer or count it again at every
 * poll that hands it over; the offset moves past the numbered ones around it.
 *
 * A 409 (another poller holds the token, or a webhook is set) is `conflictAt` and a 30 s wait; any other failure backs off 5 s doubling to
 * 60 s, which a poll that answers resets, and is `pollFailing` until one does. Each is said in a line at most once a minute. The loop never
 * stops on a failure; only dispose stops it. The token is in none of this: the Bot API client redacts what it says (bot-api.ts), and the
 * log the connector is given is the identity's, which redacts again. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Refusal } from "../../core/errors.ts";
import { no } from "../refuse.ts";
import { BotApi, BotApiError, redactorOf } from "./bot-api.ts";
import type { Connector, Transport } from "./identity.ts";
import type { InboxRing } from "./inbox.ts";
import { chatOffLine, type Network } from "./kinds.ts";
import type { PendingBot, PendingResume, PendingSender, PendingSource } from "./pending.ts";
import { IDENTITY_WORDS } from "./routes.ts";
import { identityDir, maskId, senderRef, writeIdentityFile, type Binding, type Strangers } from "./store.ts";

/** the connected long poll's `timeout`, in seconds (the face's bridge's) */
export const CONNECTED_POLL_TIMEOUT_S = 50;
/** the wait after a 409 */
export const CONFLICT_WAIT_MS = 30_000;
/** the backoff after any other failed poll: 5 s, doubling to 60 s */
export const BACKOFF_FIRST_MS = 5_000;
export const BACKOFF_MAX_MS = 60_000;
/** a conflict, or a failed poll, is said at most this often */
export const RECORD_EVERY_MS = 60_000;
/** how long dispose waits for the update in hand */
const DISPOSE_MS = 2_000;
export const OFFSET_FILE = "telegram.offset";

/** what the operator is answered */
export const TEXT_ONLY = "text only, please";
export const CHAT_OFF = chatOffLine("telegram");
/** the phone's five commands, as the face's bridge parses them (face/src/phone-bridge.ts `COMMAND`): stored for the desk
 * whatever the Chat row says, so the phone may always pause or mute (D19) */
export const PHONE_COMMAND = /^\/(status|pause|mute|new|stop)(?:@[A-Za-z0-9_]+)?(?:\s+[\s\S]*)?$/i;

export interface IdentityClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export const realClock = (now: () => number = Date.now): IdentityClock => ({
  now,
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
});

export interface NetworkStatus {
  network: Network;
  polling: boolean;
  lastPollAt?: string;
  conflictAt?: string;
  blocked?: true;
  pollFailing?: { since: string; reason: string };
  /** iMessage: Photon could not reach back to the cursor, so messages may have been missed while the account was down */
  gapAt?: string;
  /** iMessage: Photon names another line for the operator than the one signed; the connector stopped */
  movedAt?: string;
  /** iMessage: Photon refused to write to the line */
  refusedAt?: string;
}

export interface TelegramConnectorDeps {
  home: string;
  api: BotApi;
  binding: Binding;
  inbox: InboxRing;
  strangers: Strangers;
  /** the senders' references the owner blocked */
  blocked: () => string[];
  /** whether the Chat with Gravit row ticks Telegram */
  chatOn: () => boolean;
  /** a line to the operator */
  reply: (text: string) => Promise<void>;
  /** the first update not taken yet; undefined: whatever Telegram holds */
  offset: number | undefined;
  clock: IdentityClock;
  log: (l: string) => void;
  /** the long poll's timeout in seconds (CONNECTED_POLL_TIMEOUT_S); tests shorten it */
  pollTimeoutS?: number | undefined;
  /** before each poll: what waits in the outbox sent (identity.ts flush); never rejects */
  beforePoll?: (() => Promise<void>) | undefined;
}

interface TgMessage {
  message_id?: unknown;
  from?: { id?: unknown; is_bot?: unknown };
  chat?: { id?: unknown; type?: unknown };
  date?: unknown;
  text?: unknown;
  reply_to_message?: { message_id?: unknown };
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

export class TelegramConnector implements Connector {
  /** where a connector of this home starts after a restart: the offset kept in `<home>/identity/telegram.offset`, or undefined */
  static resumeFrom(home: string): number | undefined {
    try {
      const n = Number(readFileSync(join(identityDir(home), OFFSET_FILE), "utf8").trim());
      return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
    } catch {
      return undefined;
    }
  }

  private offset: number | undefined;
  private polling = false;
  private lastPollAt: string | undefined;
  private conflictAt: string | undefined;
  private pollFailing: { since: string; reason: string } | undefined;
  private blockedBySender = false;
  private disposed = false;
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;
  private unnumberedSaidAt = Number.NEGATIVE_INFINITY;
  private readonly operatorId: number;

  constructor(private readonly deps: TelegramConnectorDeps) {
    this.offset = deps.offset;
    this.operatorId = Number(deps.binding.operatorId);
  }

  start(): void {
    if (this.loop || this.disposed) return;
    this.polling = true;
    this.loop = this.run()
      .catch((err: unknown) => this.deps.log(`identity: the Telegram poller stopped (${reasonOf(err)})`))
      .finally(() => {
        this.polling = false;
      });
  }

  status(): NetworkStatus {
    return {
      network: this.deps.binding.network,
      polling: this.polling,
      ...(this.lastPollAt === undefined ? {} : { lastPollAt: this.lastPollAt }),
      ...(this.conflictAt === undefined ? {} : { conflictAt: this.conflictAt }),
      ...(this.blockedBySender ? { blocked: true as const } : {}),
      ...(this.pollFailing === undefined ? {} : { pollFailing: { ...this.pollFailing } }),
    };
  }

  /** a send of the account's own (identity.ts send) went through (false) or met a 403 (true): the status says so until the next line goes */
  setBlocked(blocked: boolean): void {
    this.blockedBySender = blocked;
  }

  /** the loop stopped: the wait under way ended, the update in hand finished (up to 2 s). The caller aborts the Bot API client's signal,
   * which cuts the poll under way */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.polling = false;
    this.wake?.();
    if (!this.loop) return;
    await new Promise<void>((done) => {
      const t = this.deps.clock.setTimeout(done, DISPOSE_MS);
      void this.loop!.then(() => {
        this.deps.clock.clearTimeout(t);
        done();
      });
    });
  }

  // ---- inside ----

  private stamp(): string {
    return new Date(this.deps.clock.now()).toISOString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((done) => {
      if (this.disposed) return done();
      const end = () => {
        this.deps.clock.clearTimeout(timer);
        this.wake = undefined;
        done();
      };
      const timer = this.deps.clock.setTimeout(end, ms);
      this.wake = end;
    });
  }

  private async run(): Promise<void> {
    let backoff = 0;
    let storeBackoff = 0;
    let conflictSaidAt = Number.NEGATIVE_INFINITY;
    let failureSaidAt = Number.NEGATIVE_INFINITY;
    const timeoutS = this.deps.pollTimeoutS ?? CONNECTED_POLL_TIMEOUT_S;
    while (!this.disposed) {
      try {
        await this.deps.beforePoll?.();
      } catch {
        // the outbox says its own failures; the poll goes on
      }
      if (this.disposed) break;
      let updates: unknown[];
      try {
        updates = await this.deps.api.getUpdates(this.offset, timeoutS);
      } catch (err) {
        if (this.disposed) break;
        const at = this.deps.clock.now();
        const t = new Date(at).toISOString();
        this.pollFailing = { since: this.pollFailing?.since ?? t, reason: reasonOf(err) };
        if (err instanceof BotApiError && err.status === 409) {
          this.conflictAt = t;
          if (at - conflictSaidAt >= RECORD_EVERY_MS) {
            conflictSaidAt = at;
            this.deps.log(`identity: Telegram's getUpdates got HTTP 409 (${err.description}): another poller holds the bot's token, or a webhook is set; polling again in ${CONFLICT_WAIT_MS / 1000} s`);
          }
          await this.sleep(CONFLICT_WAIT_MS);
          continue;
        }
        backoff = backoff === 0 ? BACKOFF_FIRST_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
        if (at - failureSaidAt >= RECORD_EVERY_MS) {
          failureSaidAt = at;
          this.deps.log(`identity: the Telegram poll failed (${reasonOf(err)}); polling again in ${backoff / 1000} s`);
        }
        await this.sleep(backoff);
        continue;
      }
      if (this.disposed) break;
      backoff = 0;
      this.lastPollAt = this.stamp();
      this.pollFailing = undefined;
      this.conflictAt = undefined;
      let stored = true;
      for (const update of updates) {
        if (this.disposed) break;
        if (!(await this.take(update))) {
          stored = false;
          break;
        }
      }
      if (stored) storeBackoff = 0;
      else {
        // the inbox could not store a text: the offset stays before it, and Telegram hands it over again after the backoff
        storeBackoff = storeBackoff === 0 ? BACKOFF_FIRST_MS : Math.min(storeBackoff * 2, BACKOFF_MAX_MS);
        await this.sleep(storeBackoff);
      }
    }
  }

  /** one update handled, then the offset past it; false when a text could not be stored, and the offset was left where it was */
  private async take(raw: unknown): Promise<boolean> {
    const update = (raw !== null && typeof raw === "object" ? raw : {}) as { update_id?: unknown; message?: TgMessage };
    const id = update.update_id;
    const numbered = whole(id) && id >= 0;
    if (!numbered) {
      // no number to move the offset past: never handled — so it cannot be answered or stored again at every poll that hands it over —
      // and the offset moves past the numbered updates around it
      if (this.deps.clock.now() - this.unnumberedSaidAt >= RECORD_EVERY_MS) {
        this.unnumberedSaidAt = this.deps.clock.now();
        this.deps.log("identity: Telegram handed over an update without an update_id: it is dropped");
      }
      return true;
    }
    if (this.offset !== undefined && id < this.offset) {
      this.deps.log(`identity: Telegram update ${id} is below the stored offset ${this.offset}: Telegram has numbered its updates afresh, so it is taken and the poll goes on from ${id + 1}`);
    }
    if (!(await this.handle(update.message))) return false;
    this.offset = id + 1;
    try {
      writeIdentityFile(this.deps.home, OFFSET_FILE, `${this.offset}\n`);
    } catch (err) {
      // the inbox has it, and the next poll confirms the offset to Telegram: a restart before the file is written reads the update again,
      // and the inbox does not keep a network id twice
      this.deps.log(`identity: Telegram's offset could not be written (${(err as NodeJS.ErrnoException).code ?? reasonOf(err)})`);
    }
    return true;
  }

  /** false only when the operator's text could not be stored */
  private async handle(m: TgMessage | undefined): Promise<boolean> {
    if (!m || typeof m !== "object") return true;
    const from = m.from;
    const chat = m.chat;
    if (!from || !chat || chat.type !== "private" || !whole(from.id) || from.is_bot === true) return true;
    if (from.id !== this.operatorId || chat.id !== this.operatorId) {
      this.stranger(String(from.id));
      return true;
    }
    if (!whole(m.message_id)) return true;
    if (typeof m.text !== "string") {
      await this.say(TEXT_ONLY);
      return true;
    }
    if (!this.deps.chatOn() && !PHONE_COMMAND.test(m.text.trim())) {
      await this.say(CHAT_OFF);
      return true;
    }
    const replied = m.reply_to_message?.message_id;
    const at = whole(m.date) && m.date > 0 ? new Date(m.date * 1000).toISOString() : this.stamp();
    try {
      this.deps.inbox.append({ network: "telegram", messageId: `telegram:${m.message_id}`, ...(whole(replied) ? { replyTo: `telegram:${replied}` } : {}), text: m.text, at }, this.deps.binding.botId);
    } catch (err) {
      this.deps.log(`identity: the operator's Telegram message could not be stored in the inbox (${(err as NodeJS.ErrnoException).code ?? reasonOf(err)}); it is read again from Telegram`);
      return false;
    }
    return true;
  }

  /** a stranger counted — unless the owner blocked them; never answered. A store that cannot write is one line (no id) */
  private stranger(id: string): void {
    const network = this.deps.binding.network;
    if (this.deps.blocked().includes(senderRef(network, id))) return;
    try {
      this.deps.strangers.note(network, id, this.deps.clock.now());
    } catch (err) {
      this.deps.log(`identity: a stranger could not be counted (${(err as NodeJS.ErrnoException).code ?? reasonOf(err)}); the poll goes on`);
    }
  }

  /** a line to the operator; a bot the operator blocked (403) shows as `blocked` until a line goes through */
  private async say(text: string): Promise<void> {
    try {
      await this.deps.reply(text);
      this.blockedBySender = false;
    } catch (err) {
      if (err instanceof BotApiError && err.status === 403) this.blockedBySender = true;
      this.deps.log(`identity: a line to the operator on Telegram did not go (${reasonOf(err)})`);
    }
  }
}

// ---- the transport ------------------------------------------------------------------------------------------------------------------

/** the most a Telegram message part holds: 4,000 UTF-16 code units, under Telegram's 4,096 (bot-api.ts splitMessage's default) */
export const TELEGRAM_PART_MAX = 4_000;

export interface TelegramTransportOptions {
  token: string;
  apiBase: string;
  fetch?: typeof fetch | undefined;
  /** the bound operator's private chat: the one chat this transport sends to */
  chatId: number;
}

/** Telegram as the account sends on it: one part at a time to the operator's private chat, as a reply when asked; its Bot API client cut
 * at dispose (which cuts the connector's poll too: they share it) */
export class TelegramTransport implements Transport {
  readonly network = "telegram" as const;
  readonly secrets: readonly string[];
  readonly partMax = TELEGRAM_PART_MAX;
  /** the Bot API client, which the connected poller polls with */
  readonly api: BotApi;
  private readonly stop = new AbortController();
  private readonly chatId: number;

  constructor(o: TelegramTransportOptions) {
    this.secrets = [o.token];
    this.chatId = o.chatId;
    this.api = new BotApi({ token: o.token, apiBase: o.apiBase, fetch: o.fetch, signal: this.stop.signal });
  }

  /** one part sent; answers its wire id, `telegram:<message_id>`. `replyTo` is a wire id of Telegram's, or nothing */
  async send(part: string, replyTo?: string): Promise<string> {
    const reply = replyTo !== undefined && replyTo.startsWith("telegram:") ? Number(replyTo.slice("telegram:".length)) : undefined;
    const id = await this.api.sendMessage(this.chatId, part, reply !== undefined && Number.isSafeInteger(reply) ? reply : undefined);
    return `telegram:${id}`;
  }

  /** a 400 is refused outright, a 403 a bot the operator blocked; anything else may go later */
  classify(err: unknown): "retry" | "refused" | "blocked" | "auth" {
    if (err instanceof BotApiError && err.status === 400) return "refused";
    if (err instanceof BotApiError && err.status === 403) return "blocked";
    return "retry";
  }

  dispose(): void {
    this.stop.abort();
  }
}

// ---- the pending source -------------------------------------------------------------------------------------------------------------

/** the pending long poll's timeout, in seconds */
const PENDING_POLL_TIMEOUT_S = 25;
/** the wait after a 409 while pending */
const PENDING_CONFLICT_WAIT_MS = 5_000;

export interface TelegramPendingSourceOptions {
  token: string;
  apiBase: string;
  fetch?: typeof fetch | undefined;
  pollTimeoutS?: number | undefined;
  log: (l: string) => void;
}

/** a private text's sender, as sheet 3 shows them; undefined for anything that is not a private chat's message from a person */
function senderOf(update: unknown): PendingSender | undefined {
  const m = (update as { message?: unknown } | null)?.message as { from?: unknown; chat?: unknown; text?: unknown; caption?: unknown } | undefined;
  if (!m || typeof m !== "object") return undefined;
  const chat = m.chat as { type?: unknown } | undefined;
  const from = m.from as { id?: unknown; is_bot?: unknown; first_name?: unknown; last_name?: unknown; username?: unknown } | undefined;
  if (!chat || chat.type !== "private" || !from || typeof from.id !== "number" || from.is_bot === true) return undefined;
  const id = String(from.id);
  const name = [from.first_name, from.last_name].filter((p): p is string => typeof p === "string" && p !== "").join(" ");
  return { id, name, handle: typeof from.username === "string" && from.username !== "" ? `@${from.username}` : "", masked: maskId(id), text: typeof m.text === "string" ? m.text : "" };
}

const pendingSleep = (signal: AbortSignal, ms: number): Promise<void> =>
  new Promise((done) => {
    if (signal.aborted) return done();
    const end = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", end);
      done();
    };
    const t = setTimeout(end, ms);
    t.unref();
    signal.addEventListener("abort", end, { once: true });
  });

/** Telegram's side of Connect's sheets 1 to 3: getMe for who the bot is, then the long poll of getUpdates (messages only) for the first
 * private message to the bot — a group's message skipped, a 409 a conflict and a 5 s wait, any other failure a backoff of 5 s doubling to
 * 60 s, said in a line without the token. The offset after the update heard is where the connected poller starts */
export class TelegramPendingSource implements PendingSource {
  readonly network = "telegram" as const;
  readonly secrets: readonly string[];
  private offset: number | undefined;
  private api: BotApi | undefined;
  private apiSignal: AbortSignal | undefined;
  private readonly pollTimeoutS: number;

  constructor(private readonly o: TelegramPendingSourceOptions) {
    this.secrets = [o.token];
    this.pollTimeoutS = o.pollTimeoutS ?? PENDING_POLL_TIMEOUT_S;
  }

  async check(signal: AbortSignal): Promise<PendingBot | Refusal> {
    let me: { id: number; username: string; first_name: string };
    try {
      me = await this.apiFor(signal).getMe();
    } catch (err) {
      if (err instanceof BotApiError && (err.status === 401 || err.status === 403 || err.status === 404)) return no("E_ACCOUNT_BAD_ACTION", { message: IDENTITY_WORDS.refusedByTelegram });
      this.o.log(`identity: Telegram's getMe did not answer (${redactorOf(this.secrets)(err instanceof Error ? err.message : String(err))})`);
      return no("E_ACCOUNT_BAD_ACTION", { message: IDENTITY_WORDS.unreachable });
    }
    return { id: String(me.id), username: me.username, name: me.first_name, link: `https://t.me/${me.username}` };
  }

  async listen(ctx: Parameters<PendingSource["listen"]>[0]): Promise<void> {
    const redact = redactorOf(this.secrets);
    const reason = (err: unknown) => redact(err instanceof Error ? err.message : String(err));
    const api = this.apiFor(ctx.signal);
    let backoff = 0;
    while (!ctx.signal.aborted) {
      let updates: unknown[];
      try {
        updates = await api.getUpdates(this.offset, this.pollTimeoutS);
      } catch (err) {
        if (ctx.signal.aborted) return;
        if (err instanceof BotApiError && err.status === 409) {
          ctx.conflict(true);
          await pendingSleep(ctx.signal, PENDING_CONFLICT_WAIT_MS);
          continue;
        }
        backoff = backoff === 0 ? BACKOFF_FIRST_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
        ctx.log(`identity: the pending Telegram connection's poll failed (${reason(err)}); polling again in ${backoff / 1000} s`);
        await pendingSleep(ctx.signal, backoff);
        continue;
      }
      if (ctx.signal.aborted) return;
      backoff = 0;
      ctx.conflict(false);
      for (const u of updates) {
        const uid = (u as { update_id?: unknown } | null)?.update_id;
        if (typeof uid !== "number" || !Number.isSafeInteger(uid)) continue;
        this.offset = uid + 1;
        const s = senderOf(u);
        if (!s) continue;
        if (ctx.admit(s.id) !== "hear") continue;
        ctx.heard(s);
        return;
      }
    }
  }

  resume(): PendingResume {
    return { network: "telegram", offset: this.offset ?? 0 };
  }

  /** the Bot API client for this signal: one per pending connection, cut when its signal aborts */
  private apiFor(signal: AbortSignal): BotApi {
    if (!this.api || this.apiSignal !== signal) {
      this.api = new BotApi({ token: this.o.token, apiBase: this.o.apiBase, fetch: this.o.fetch, signal });
      this.apiSignal = signal;
    }
    return this.api;
  }
}
