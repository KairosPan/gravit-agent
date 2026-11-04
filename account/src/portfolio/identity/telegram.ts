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
import type { BotApi } from "./bot-api.ts";
import { BotApiError } from "./bot-api.ts";
import type { InboxRing } from "./inbox.ts";
import type { Network } from "./kinds.ts";
import { senderRef, writeIdentityFile, type Binding, type Strangers } from "./store.ts";

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
export const CHAT_OFF = "Chat with Gravit is off on Telegram: Account › Identity turns it on.";
/** the phone's five commands, as the face's bridge parses them (face/src/phone-bridge.ts `COMMAND`): stored for the desk
 * whatever the Chat row says, so the phone may always pause or mute (D19) */
const PHONE_COMMAND = /^\/(status|pause|mute|new|stop)(?:@[A-Za-z0-9_]+)?(?:\s+[\s\S]*)?$/i;

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

export class TelegramConnector {
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
