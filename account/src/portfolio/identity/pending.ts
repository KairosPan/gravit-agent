/** THE PENDING CONNECTION — Connect Telegram's sheets 1 to 3, on the account's side.
 *
 *   Sheet 1, Next: the page sends the bot's token once, beside the fingerprint it made (keyHash = hex sha256(salt ‖ token), the brain-key
 *     recipe), to POST /api/account/identity/telegram/token (routes.ts). begin() checks the token's shape, then the token against the
 *     fingerprint (keyMatches, constant time), refuses while Telegram is connected already, and asks Telegram who the bot is (getMe). A
 *     token Telegram does not know is refused; nothing is kept of a refused one.
 *   Sheet 2, Say hi: the token is held in this process's memory — never a file, a log line, an answer or a ledger row — and the account
 *     long-polls getUpdates (messages only) for the first private message to the bot. A group's message is skipped.
 *   Sheet 3, Is this you?: the sender heard — their name, @handle, their id masked to its last three digits, and what they wrote. "Not me"
 *     counts them as a stranger (store.ts Strangers) and waits again; a later message from the same person is counted, never heard. "Yes"
 *     is the signed connectNetwork, whose door handler takes the pending connection (take) and checks it against what was signed.
 *
 * One pending connection at a time: a second token replaces the first, whose poll is cut and whose token is forgotten. A pending connection
 * lasts PENDING_MS (ten minutes, a signed instruction's life): past it the token and the client that holds it are dropped and the view says "expired" until the page
 * starts again or drops it. drop forgets it at once. A 409 from getUpdates (another poller holds the token, or a webhook is set) shows as
 * "conflict" until a poll answers again.
 *
 * The offset after the update heard is kept, so that the connected poller (Task 4) starts after the message the operator was heard by. */
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { Refusal } from "../../core/errors.ts";
import { keyMatches } from "../account/brain-keys.ts";
import { no } from "../refuse.ts";
import { BotApi, BotApiError, redactorOf } from "./bot-api.ts";
import { IDENTITY_WORDS } from "./routes.ts";
import { maskId, senderRef, type Strangers } from "./store.ts";

/** how long a pending connection lasts: ten minutes, the life of the connectNetwork that ends it (sign.ts BRAIN_KEY_TTL_MS) */
export const PENDING_MS = 600_000;
/** BotFather's token: digits, a colon, then letters */
export const TOKEN_SHAPE = /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/;
/** the long poll's timeout while pending, in seconds */
const POLL_TIMEOUT_S = 25;
/** the wait after a 409 */
const CONFLICT_WAIT_MS = 5_000;
/** the backoff after any other failed poll: 5 s, doubling to 60 s */
const BACKOFF_FIRST_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

export interface PendingView {
  id: string;
  network: "telegram";
  bot: { id: string; username: string; name: string };
  /** the bot's page at Telegram: https://t.me/<username> */
  link: string;
  /** the link as a QR code: `data:image/svg+xml;base64,` and the SVG qrcode draws, which the page shows as an <img> */
  qr: string;
  expiresAt: string;
  state: "waiting" | "heard" | "conflict" | "expired";
  /** the sender heard: `id` their numeric Telegram id, which the page signs as connectNetwork's operatorId and draws only masked */
  sender?: { id: string; name: string; handle: string; masked: string; text: string };
}

/** the QR code of a bot's link, as the pending view carries it */
export const qrOf = async (link: string): Promise<string> =>
  `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(link, { type: "svg", margin: 1 }), "utf8").toString("base64")}`;

export interface PendingTaken {
  token: string;
  keyHash: string;
  salt: string;
  bot: { id: string; username: string; name: string };
  sender: { id: string; handle: string };
  /** the getUpdates offset after the update heard */
  offset: number;
}

export interface PendingDeps {
  apiBase: string;
  strangers: Strangers;
  /** whether Telegram is connected already: a connection is refused while it is */
  bound: () => boolean;
  /** the senders' references the owner blocked: neither heard nor counted, as the connected poller drops them */
  blocked?: (() => string[]) | undefined;
  fetch?: typeof fetch | undefined;
  pollTimeoutS?: number | undefined;
  now?: (() => number) | undefined;
  log?: ((l: string) => void) | undefined;
}

interface Entry {
  id: string;
  token: string;
  keyHash: string;
  salt: string;
  bot: PendingView["bot"];
  qr: string;
  expiresAt: number;
  state: PendingView["state"];
  sender?: { id: string; name: string; handle: string; masked: string; text: string };
  offset: number | undefined;
  /** who said "Not me" during this connection: counted as strangers if they write again, never heard */
  notMe: Set<string>;
  /** the client, which holds the token: dropped with it (cut), so an expired tombstone holds neither */
  api: BotApi | undefined;
  stop: AbortController;
  looping: boolean;
  timer: NodeJS.Timeout | undefined;
}

/** a private text's sender, as sheet 3 shows them; undefined for anything that is not a private chat's message from a person */
function senderOf(update: unknown): Entry["sender"] | undefined {
  const m = (update as { message?: unknown } | null)?.message as { from?: unknown; chat?: unknown; text?: unknown; caption?: unknown } | undefined;
  if (!m || typeof m !== "object") return undefined;
  const chat = m.chat as { type?: unknown } | undefined;
  const from = m.from as { id?: unknown; is_bot?: unknown; first_name?: unknown; last_name?: unknown; username?: unknown } | undefined;
  if (!chat || chat.type !== "private" || !from || typeof from.id !== "number" || from.is_bot === true) return undefined;
  const id = String(from.id);
  const name = [from.first_name, from.last_name].filter((p): p is string => typeof p === "string" && p !== "").join(" ");
  return { id, name, handle: typeof from.username === "string" && from.username !== "" ? `@${from.username}` : "", masked: maskId(id), text: typeof m.text === "string" ? m.text : "" };
}

const refusal = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { message });

export class PendingConnections {
  private current: Entry | undefined;
  private disposed = false;
  private readonly now: () => number;
  private readonly pollTimeoutS: number;
  private readonly log: (l: string) => void;

  constructor(private readonly deps: PendingDeps) {
    this.now = deps.now ?? Date.now;
    this.pollTimeoutS = deps.pollTimeoutS ?? POLL_TIMEOUT_S;
    this.log = deps.log ?? ((l) => console.error(l));
  }

  /** Sheet 1's Next: the token checked and held, the bot named, the long poll begun — or a refusal in IDENTITY_WORDS' fixed words */
  async begin(token: string, keyHash: string, salt: string): Promise<PendingView | Refusal> {
    if (this.disposed) return refusal(IDENTITY_WORDS.noPending);
    if (!TOKEN_SHAPE.test(token)) return refusal(IDENTITY_WORDS.tokenShape);
    if (!keyMatches(salt, token, keyHash)) return refusal(IDENTITY_WORDS.mismatch);
    if (this.deps.bound()) return refusal(IDENTITY_WORDS.connected);
    const stop = new AbortController();
    const api = new BotApi({ token, apiBase: this.deps.apiBase, fetch: this.deps.fetch, signal: stop.signal });
    let me: { id: number; username: string; first_name: string };
    try {
      me = await api.getMe();
    } catch (err) {
      stop.abort();
      if (err instanceof BotApiError && (err.status === 401 || err.status === 403 || err.status === 404)) return refusal(IDENTITY_WORDS.refusedByTelegram);
      this.log(`identity: Telegram's getMe did not answer (${redactorOf([token])(err instanceof Error ? err.message : String(err))})`);
      return refusal(IDENTITY_WORDS.unreachable);
    }
    // the link's QR code (a link qrcode cannot draw is drawn as none: the link itself is on the sheet)
    const qr = await qrOf(`https://t.me/${me.username}`).catch(() => "");
    if (this.disposed) {
      stop.abort();
      return refusal(IDENTITY_WORDS.noPending);
    }
    // one pending connection at a time: the one before is cut and forgotten
    this.forget();
    const e: Entry = { id: randomBytes(16).toString("hex"), token, keyHash, salt, bot: { id: String(me.id), username: me.username, name: me.first_name }, qr, expiresAt: this.now() + PENDING_MS, state: "waiting", offset: undefined, notMe: new Set(), api, stop, looping: false, timer: undefined };
    // the token is dropped at its time even if nobody looks again
    e.timer = setTimeout(() => this.expire(e), PENDING_MS);
    e.timer.unref();
    this.current = e;
    this.loop(e);
    return this.viewOf(e);
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
      this.noteStranger(e.sender.id);
      e.notMe.add(e.sender.id);
      delete e.sender;
      e.state = "waiting";
      this.loop(e);
    }
    return this.viewOf(e);
  }

  /** forget the pending connection `id` at once: its poll cut, its token dropped */
  drop(id: string): void {
    if (this.current && this.current.id === id) this.forget();
  }

  /** what the connectNetwork door checks before it takes: the heard connection `id` as take would hand it over, left where it is — so a
   * signature that does not match it is refused and the owner can still sign the right one; undefined unless it is heard and in time */
  peek(id: string): PendingTaken | undefined {
    const e = this.entry(id);
    if (!e || e.state !== "heard" || !e.sender || e.offset === undefined) return undefined;
    return { token: e.token, keyHash: e.keyHash, salt: e.salt, bot: { ...e.bot }, sender: { id: e.sender.id, handle: e.sender.handle }, offset: e.offset };
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

  private entry(id: string): Entry | undefined {
    const e = this.current;
    if (!e || e.id !== id) return undefined;
    if (e.state !== "expired" && this.now() >= e.expiresAt) this.expire(e);
    return e;
  }

  private viewOf(e: Entry): PendingView {
    return {
      id: e.id,
      network: "telegram",
      bot: { ...e.bot },
      link: `https://t.me/${e.bot.username}`,
      qr: e.qr,
      expiresAt: new Date(e.expiresAt).toISOString(),
      state: e.state,
      ...(e.state === "heard" && e.sender ? { sender: { id: e.sender.id, name: e.sender.name, handle: e.sender.handle, masked: e.sender.masked, text: e.sender.text } } : {}),
    };
  }

  /** past its time: the poll cut, the token and the sender dropped; the view says "expired" until it is dropped or replaced */
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

  /** a stranger counted; a store that cannot write is said in one line (no id, no token) and the connection goes on */
  private noteStranger(id: string): void {
    try {
      this.deps.strangers.note("telegram", id, this.now());
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

  /** the long poll: until a private message is heard, or the connection is dropped, taken, replaced or expired */
  private loop(e: Entry): void {
    if (e.looping) return;
    e.looping = true;
    // the token's spellings, taken now: every line this loop says is redacted with them, even after cut() has blanked the entry's token
    const redact = redactorOf([e.token]);
    const reason = (err: unknown) => redact(err instanceof Error ? err.message : String(err));
    void (async () => {
      let backoff = 0;
      try {
        while (this.live(e)) {
          if (this.now() >= e.expiresAt) return this.expire(e);
          let updates: unknown[];
          try {
            updates = await e.api!.getUpdates(e.offset, this.pollTimeoutS);
          } catch (err) {
            if (!this.live(e)) return;
            if (err instanceof BotApiError && err.status === 409) {
              e.state = "conflict";
              await this.sleep(e, CONFLICT_WAIT_MS);
              continue;
            }
            backoff = backoff === 0 ? BACKOFF_FIRST_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
            this.log(`identity: the pending Telegram connection's poll failed (${reason(err)}); polling again in ${backoff / 1000} s`);
            await this.sleep(e, backoff);
            continue;
          }
          if (!this.live(e)) return;
          backoff = 0;
          if (e.state === "conflict") e.state = "waiting";
          for (const u of updates) {
            const uid = (u as { update_id?: unknown } | null)?.update_id;
            if (typeof uid !== "number" || !Number.isSafeInteger(uid)) continue;
            e.offset = uid + 1;
            const s = senderOf(u);
            if (!s) continue;
            if (this.deps.blocked?.().includes(senderRef("telegram", s.id))) continue;
            if (e.notMe.has(s.id)) {
              this.noteStranger(s.id);
              continue;
            }
            e.sender = s;
            e.state = "heard";
            return;
          }
        }
      } finally {
        e.looping = false;
      }
    })().catch(async (err: unknown) => {
      // a fault in the loop itself, said without the token; a connection still waiting polls again after the first backoff
      this.log(`identity: the pending Telegram connection's poll stopped (${reason(err)}); polling again in ${BACKOFF_FIRST_MS / 1000} s`);
      await this.sleep(e, BACKOFF_FIRST_MS);
      if (this.live(e)) this.loop(e);
    });
  }
}

