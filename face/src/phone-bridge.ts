// face/src/phone-bridge.ts
/** The desk's phone bridge: the operator's phone, talking to the desk through the account's identity half
 * (account/src/portfolio/identity/, docs/superpowers/specs/2026-11-03-account-split-and-identity-design.md §5.5-§5.6;
 * before it, src/telegram.ts held the bot's token and polled Telegram itself).
 *
 * THE ACCOUNT HOLDS THE NETWORKS. Telegram's token, the operator's bound handle, the long poll, the outbox, the routing,
 * quiet hours, who is a stranger and what is not text are the account's. The face holds no network's token and names no
 * recipient: it long-polls the account's inbox (src/phone.ts `inbox`) - only the operator's own texts are ever in it -
 * and sends through the account's send route (src/phone.ts `send`), naming each send's kind.
 *
 * WHAT A MESSAGE DOES. A text goes to the desk conversation (src/desk-conversation.ts) with the telegram source - the
 * kind keeps its name for every network, and `network` says which (`telegram`, `slack`) - and the time the operator
 * wrote it (the inbox's `at`). A text that replies to one of the desk's messages carries that
 * message's alert, and its annotation when there is one, as the post's context (spec §16 H1b, src/watch.ts
 * `contextFor`, asked the reply's `<network>:<id>`). A post the conversation refuses is answered with its line, and an
 * opened turn's answer comes back through the outlet - the bridge is the conversation's outlet from install to dispose.
 * Five commands are the bridge's own: /status, /pause [duration], /mute <duration>, /new and /stop, in any case, with or
 * without the bot's name after them; any other /word is text for Gravit. There is no /resume and no /unmute: the phone
 * only ever makes the desk quieter (§5.8, D19). A post or a /new that takes more than 30 s is answered that the desk is
 * slow; a refusal that comes later is still answered when it does. Every line the bridge says is a `chat` reply to the
 * network the text came from.
 *
 * ONE TEXT, ONE TURN (spec §16 H3). A text is posted under {@link deliveryKey}: its inbox number, its network's message
 * id and when it was written. The conversation sends it as a message with that id, answers a key the desk session already
 * holds as a duplicate, and answers only once the session's log is flushed. The inbox number is unique on the account's
 * home, so a bot reconnected - whose message ids start again - is not taken for the old one; the message id and the time
 * keep a fresh account home, whose numbers start again, from being taken for the old one too.
 *
 * THE CURSOR. `inbox.cursor` in the desk's directory holds the highest inbox number the bridge has taken. A text is taken
 * once its post settled, whatever the slow line said first, or a command once answered; only then is the cursor set past
 * it and stored. So a crash before the desk holds a text on disk leaves it for the next read, and the text read again is
 * answered once; reading the inbox never changes it. The wait is bounded at five minutes, the phone turn's deadline
 * ({@link ACCEPT_BOUND_MS}): past it, one log line, and the cursor moves on and the read goes on, so a hung desk never
 * leaves /stop, /pause and /status unheard. A cursor past the account's highest number - a fresh account home - is said
 * in one line and starts again from 0.
 *
 * AN ACCOUNT THAT DOES NOT ANSWER. Every read is cut at its wait plus 10 s. A read that fails is one line at most once a
 * minute and a backoff from 5 s doubling to 60 s, which a read that answers resets; the status says `accountFailing`,
 * since the first read that failed after the last that answered and why the last one failed. The face queues nothing:
 * a send that does not reach the account is `send failed: …` at the conversation, and the watchdog reports it.
 *
 * MODULE WEIGHT. src/desk.ts loads this module on first use (`installDesk`, with the desk on and a phone client given),
 * so the pause switch and scripts/service.ts, which import src/desk.ts, never load it. It imports src/desk.ts's values
 * directly; the edge back is that dynamic import, so there is no static cycle.
 * @module
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import {
  MUTE_USAGE, deskDir, deskStatusLines, deskTime, muteReplyLine, parseDuration, writeMute, writeOff, type DeskStatus, type PhoneStatus,
} from "./desk.ts";
import type { DeskConversation, DeskOutlet, PostResult } from "./desk-conversation.ts";
import type { DeskClock } from "./desk-session.ts";
import type { AccountPhoneStatus, InboxMessage, PhoneClient } from "./phone.ts";

/** Diagnostic label, the one every `${BIN}:`-prefixed line in the face uses; the bridge's lines add `phone:`. */
const BIN = "gravit-face";

/** How long an inbox read waits for a message, in seconds: the account's longest (its routes.ts, 25). */
export const INBOX_WAIT_S = 25;
/** The backoff after a read that failed: 5 s, doubling to 60 s. */
const BACKOFF_FIRST_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
/** A failed read is said at most this often. */
const RECORD_EVERY_MS = 60_000;
/** How long a post or a /new may take before the bridge answers that the desk is slow; it still waits for it before the
 * cursor moves on. */
const POST_BOUND_MS = 30_000;
/** The longest the bridge waits for a message to be taken - a post or a /new to settle - before it says the desk did
 * not take it, moves the cursor on and reads again: five minutes, the phone turn's deadline. */
export const ACCEPT_BOUND_MS = 300_000;
/** How long {@link PhoneBridgeHandle.dispose} waits for the message in hand. */
const DISPOSE_MS = 2_000;

/** The cursor's file in the desk's directory (src/desk.ts `deskDir`), beside the retired bridge's `telegram.offset`. */
export const CURSOR_FILE = "inbox.cursor";

const RESUMES = "a terminal resumes it: npm run desk -- resume";
const PAUSE_USAGE = "/pause takes Nm, Nh or Nd - 30m, 2h, 1d - or nothing; nothing was paused";
const RENEWED = "a new desk conversation";
const SLOW = "the desk is slow to take this; it will answer when it can";
/** What `/stop` cancels the turn under way with. */
const STOP_REASON = "stopped from the phone";
const DIGITS = /^\d{1,16}$/;

const defaultClock: DeskClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** The key a text from the inbox is posted under: the id of the desk message it becomes, the same however often the
 * inbox hands it over - `<message id>#<inbox number>@<written at>`, e.g. `telegram:41#7@2026-11-04T19:03:00.000Z`. */
export const deliveryKey = (m: Pick<InboxMessage, "id" | "messageId" | "at">): string => `${m.messageId}#${m.id}@${m.at}`;

/** Who a phone command's pause or mute is by: the network it came through (src/desk.ts `OffState`, `MuteState`). */
type PhoneSetter = "telegram" | "slack" | "imessage";
/** `network` as a setter: the network itself when it is one of the three, `telegram` for anything else - the inbox admits only those
 * (src/phone.ts `WIRE_ID`). */
const setterOf = (network: string): PhoneSetter => (network === "slack" || network === "imessage" ? network : "telegram");

/** A command the bridge answers itself, and what followed it. */
export type Command = { cmd: "status" | "pause" | "mute" | "new" | "stop"; arg?: string };

/** The five commands, as Telegram sends them: the word in any case, then the bot's name when the operator
 * picked the command from the menu, then anything after a space. Slack's `!status` arrives here as `/status`: the
 * account's connector rewrites the `!` before it stores the text (Slack's composer keeps a leading `/` for itself). */
const COMMAND = /^\/(status|pause|mute|new|stop)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i;

/**
 * `text` as one of the bridge's own commands - `/status`, `/pause [duration]`, `/mute <duration>`, `/new`,
 * `/stop`, in any case (`/Status`, `/PAUSE@botname 2h`) - with what follows it as `arg`, trimmed, when
 * anything does; anything else, any other `/word` included, is `undefined`: text for Gravit. The argument is left as typed: a
 * duration stays exact (src/desk.ts `parseDuration`).
 * @param text - the message's text.
 */
export function parseCommand(text: string): Command | undefined {
  const match = COMMAND.exec(text.trim());
  if (match === null) return undefined;
  const cmd = match[1].toLowerCase() as Command["cmd"];
  const arg = match[2]?.trim();
  return arg === undefined || arg === "" ? { cmd } : { cmd, arg };
}

/** What {@link installPhoneBridge} needs: the account's client; the harness home, whose desk directory holds the
 * cursor; the desk conversation, as the bridge uses it; `status`, what `/status` reads (src/desk.ts `deskStatus`);
 * `log`, where a line goes (stderr); `clock`, the timers (the global ones); `contextFor`, what a reply to one of the desk's
 * messages carries to the conversation - the watch's alert and its annotation (src/watch.ts `contextFor`), `undefined`
 * for a message it does not know or while there is no watch. */
export interface PhoneBridgeDeps {
  phone: PhoneClient;
  home: string;
  conversation: Pick<DeskConversation, "post" | "renew" | "stop" | "setOutlet">;
  status: () => Promise<DeskStatus>;
  log?: (line: string) => void;
  clock?: DeskClock;
  contextFor?: (messageId: string) => string | undefined;
}

/** The running bridge: `status`, what the desk's status reports of it; `dispose`, its end. */
export interface PhoneBridgeHandle {
  status(): PhoneStatus;
  dispose(): Promise<void>;
}

/** A failure as one line: its message, and the code it or its cause carries when the message does not say it. */
function reasonOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const own = (err as { code?: unknown }).code;
  const code = typeof own === "string" ? own : (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
}

/** How a promise settled within a bound: with its value, with its error, or not yet. */
type Bounded<T> = { settled: true; value: T } | { settled: true; error: unknown } | { settled: false };

/**
 * Start the bridge: it is the conversation's outlet at once - a desk send goes to the account as its kind - and its loop
 * - load the cursor, then, until dispose, read the inbox - starts without being awaited. Never throws, and nothing it
 * starts can reject: a failure is a line.
 *
 * Each message is taken in turn (see the module header): a command is answered by the bridge - `/status` with the
 * desk's lines (src/desk.ts `deskStatusLines`) and `desk session <id>` and `turns today <n>` after them, `/pause [d]`
 * with the pause in force once it is written (src/desk.ts `writeOff`, set by the network the command came through,
 * `telegram` or `slack`), `/mute <d>` with the mute in force once it is written, by that network too (src/desk.ts `writeMute`, `muteReplyLine`; no or a bad duration is `MUTE_USAGE`), `/new` and
 * `/stop` with what the conversation did; and a text is posted to the conversation, a refusal answered with its line.
 * A post or a `/new` still under way after 30 s on the clock is answered `the desk is slow to take this; it will answer
 * when it can`, and what it comes to is answered when it settles. Then the cursor is set past the message.
 *
 * `dispose()` aborts the read under way, stops the loop and lets go of the outlet; it waits up to 2 s for the message in
 * hand, then settles, and a second call settles with the first. The conversation, not the bridge, cancels a turn under
 * way at shutdown.
 * @param deps - see {@link PhoneBridgeDeps}.
 */
export function installPhoneBridge(deps: PhoneBridgeDeps): PhoneBridgeHandle {
  const { home, conversation } = deps;
  /* the client's two calls, read once, at install: a client that cannot be read fails the install, as one line at the desk */
  const inbox = deps.phone.inbox.bind(deps.phone);
  const send = deps.phone.send.bind(deps.phone);
  const clock = deps.clock ?? defaultClock;
  const log = deps.log ?? ((line: string): void => { console.error(line); });
  const stamp = (): string => new Date(clock.now()).toISOString();
  const cursorPath = join(deskDir(home), CURSOR_FILE);

  let polling = true;
  let lastPollAt: string | undefined;
  /** While reads fail: since the first that failed after the last that answered, and why the last failed. */
  let accountFailing: { since: string; reason: string } | undefined;
  /** The account's phone, as its last answer gave it. */
  let account: AccountPhoneStatus = { networks: [], queued: 0, strangers: 0 };
  /** The highest inbox number taken. */
  let cursor = 0;
  let disposed = false;
  let disposing: Promise<void> | undefined;
  /** Aborted at dispose: the read under way is cut. */
  const stopping = new AbortController();
  /** Ends the loop's wait early, at dispose. */
  let wake: (() => void) | undefined;

  /** How `p` settled within `ms` on the clock; never rejects. */
  const bounded = <T>(ms: number, p: Promise<T>): Promise<Bounded<T>> => new Promise((settle) => {
    const timer = clock.setTimeout(() => { settle({ settled: false }); }, ms);
    p.then(
      (value) => { clock.clearTimeout(timer); settle({ settled: true, value }); },
      (error: unknown) => { clock.clearTimeout(timer); settle({ settled: true, error }); },
    );
  });

  /** A line to the operator, a `chat` reply to `network`: a refusal, a hold or no answer is one line here, never a
   * rejection. */
  const reply = async (line: string, network: string): Promise<void> => {
    try {
      const said = await send("chat", line, { network });
      if ("held" in said) log(`${BIN}: phone: a reply was not sent: the account held it (${said.held})`);
    } catch (err) {
      log(`${BIN}: phone: a reply could not be sent: ${reasonOf(err)}`);
    }
  };

  /* ---------- the cursor ---------- */

  const load = async (): Promise<void> => {
    let stored: string;
    try {
      stored = (await readFile(cursorPath, "utf8")).trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") log(`${BIN}: phone: ${cursorPath} could not be read: ${reasonOf(err)}; reading the inbox from 0`);
      return;
    }
    const n = Number(stored);
    if (DIGITS.test(stored) && Number.isSafeInteger(n)) cursor = n;
    else log(`${BIN}: phone: ${cursorPath} holds no inbox number; reading the inbox from 0`);
  };

  const persistCursor = async (): Promise<void> => {
    try {
      await writeFileAtomic(cursorPath, `${cursor}\n`, { mode: 0o600, dirMode: 0o700 });
    } catch (err) {
      log(`${BIN}: phone: ${cursorPath} could not be written: ${reasonOf(err)}; after a restart the inbox may hand these messages over again`);
    }
  };

  /* ---------- the commands ---------- */

  const statusReply = async (): Promise<string> => {
    try {
      const status = await deps.status();
      const lines = deskStatusLines(status, new Date(clock.now()));
      if (status.ledgerError !== undefined) lines.push(`ledger: unreadable (${status.ledgerError})`);
      lines.push(`desk session ${status.deskSession ?? "none yet"}`, `turns today ${status.turnsToday.count}`);
      return lines.join("\n");
    } catch (err) {
      return `the status could not be read: ${reasonOf(err)}`;
    }
  };

  const pauseReply = async (arg: string | undefined, by: PhoneSetter): Promise<string> => {
    const ms = arg === undefined ? undefined : parseDuration(arg);
    if (arg !== undefined && ms === undefined) return PAUSE_USAGE;
    const at = clock.now();
    try {
      const state = await writeOff(home, { by, ...(ms === undefined ? {} : { until: at + ms }) }, () => at);
      const until = state.until === undefined ? "" : ` until ${deskTime(new Date(state.until), new Date(at))}`;
      return `paused${until}; ${RESUMES}`;
    } catch (err) {
      return `the pause could not be set: ${reasonOf(err)}`;
    }
  };

  const muteReply = async (arg: string | undefined, by: PhoneSetter): Promise<string> => {
    const ms = arg === undefined ? undefined : parseDuration(arg);
    if (ms === undefined) return MUTE_USAGE;
    const at = clock.now();
    try {
      return muteReplyLine(await writeMute(home, { by, until: at + ms }, () => at), new Date(at));
    } catch (err) {
      return `the mute could not be written: ${reasonOf(err)}`;
    }
  };

  const stopReply = async (): Promise<string> => {
    try {
      return (await conversation.stop(STOP_REASON)) ? "stopped" : "nothing is running";
    } catch (err) {
      return `the desk could not be stopped: ${reasonOf(err)}`;
    }
  };

  /** Wait up to 30 s for `line`, the answer to a post or a `/new`: past that, answer that the desk is slow and answer
   * `line` when it settles - an empty one, as an opened turn's is, says nothing. Resolves once `line` has settled,
   * however long that takes; the message is taken then, or at {@link ACCEPT_BOUND_MS}, whichever comes first. */
  const answerWithin = async (line: Promise<string>, network: string): Promise<void> => {
    const answered = await bounded(POST_BOUND_MS, line);
    if (answered.settled) {
      if ("value" in answered && answered.value !== "") await reply(answered.value, network);
      return;
    }
    await reply(SLOW, network);
    const late = await line.catch(() => "");
    if (late !== "") await reply(late, network);
  };

  /** What a reply carries to the desk (spec §16 H1b): the context `contextFor` gives the message it replies to, none for
   * a text that replies to nothing or to a message the watch does not know. A lookup that throws is one line, and the
   * text goes without. */
  const replyContext = (m: InboxMessage): string | undefined => {
    if (deps.contextFor === undefined || m.replyTo === undefined) return undefined;
    try {
      return deps.contextFor(m.replyTo);
    } catch (err) {
      log(`${BIN}: phone: the message ${m.messageId} replies to could not be read: ${reasonOf(err)}`);
      return undefined;
    }
  };

  /** Handle one message; resolves once it is taken - a text's post or a `/new` settled, a command answered. */
  const handle = async (m: InboxMessage): Promise<void> => {
    const command = parseCommand(m.text);
    if (command?.cmd === "new") {
      await answerWithin(conversation.renew().then(() => RENEWED, (err: unknown) => `a new desk conversation could not be opened: ${reasonOf(err)}`), m.network);
      return;
    }
    if (command !== undefined) {
      await reply(command.cmd === "status" ? await statusReply()
        : command.cmd === "pause" ? await pauseReply(command.arg, setterOf(m.network))
        : command.cmd === "mute" ? await muteReply(command.arg, setterOf(m.network))
        : await stopReply(), m.network);
      return;
    }
    const at = Date.parse(m.at);
    const context = replyContext(m);
    const posted = conversation.post({
      text: m.text,
      source: { kind: "telegram", network: m.network, ...(Number.isFinite(at) && at > 0 ? { at } : {}) },
      message: { kind: "telegram", network: m.network, messageId: m.messageId },
      key: deliveryKey(m),
      ...(context === undefined ? {} : { context }),
    });
    await answerWithin(posted.then(
      (result: PostResult) => ("refused" in result ? result.line : ""),
      (err: unknown) => {
        log(`${BIN}: phone: the desk did not take ${m.messageId}: ${reasonOf(err)}`);
        return "";
      },
    ), m.network);
  };

  /** Take one message - waiting for its post to settle, up to {@link ACCEPT_BOUND_MS} - then set the cursor past it. */
  const take = async (m: InboxMessage): Promise<void> => {
    const handled = handle(m).catch((err: unknown) => {
      log(`${BIN}: phone: ${m.messageId} could not be handled: ${reasonOf(err)}`);
    });
    const taken = await bounded(ACCEPT_BOUND_MS, handled);
    if (!taken.settled) {
      /* a bound that ran out across a dispose moves nothing: the next boot reads the message again, answered once */
      if (disposed) return;
      log(`${BIN}: phone: the desk did not take ${m.messageId} (inbox ${m.id}) in ${ACCEPT_BOUND_MS / 60_000} min; the bridge goes on, and the text is answered once if it lands later`);
    }
    cursor = m.id;
    await persistCursor();
  };

  /* ---------- the loop ---------- */

  /** Wait `ms` on the clock, or until dispose. */
  const sleep = (ms: number): Promise<void> => new Promise((done) => {
    if (disposed) {
      done();
      return;
    }
    const end = (): void => {
      clock.clearTimeout(timer);
      wake = undefined;
      done();
    };
    const timer = clock.setTimeout(end, ms);
    wake = end;
  });

  const run = async (): Promise<void> => {
    await load();
    let backoff = 0;
    let failureSaidAt = Number.NEGATIVE_INFINITY;
    while (!disposed) {
      let answer: Awaited<ReturnType<PhoneClient["inbox"]>>;
      try {
        answer = await inbox(cursor, INBOX_WAIT_S, stopping.signal);
      } catch (err) {
        if (disposed) break;
        const at = clock.now();
        const reason = reasonOf(err);
        accountFailing = { since: accountFailing?.since ?? new Date(at).toISOString(), reason };
        backoff = backoff === 0 ? BACKOFF_FIRST_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
        if (at - failureSaidAt >= RECORD_EVERY_MS) {
          failureSaidAt = at;
          log(`${BIN}: phone: the account's inbox did not answer (${reason}); reading again in ${backoff / 1000} s`);
        }
        await sleep(backoff);
        continue;
      }
      if (disposed) break;
      backoff = 0;
      lastPollAt = stamp();
      accountFailing = undefined;
      account = answer.status;
      if (answer.last < cursor) {
        log(`${BIN}: phone: the account's inbox ends at ${answer.last}, below the cursor ${cursor} - a fresh account home; reading it again from 0`);
        cursor = 0;
        await persistCursor();
        continue;
      }
      for (const m of answer.messages) {
        if (disposed) break;
        if (m.id <= cursor) continue;
        await take(m);
      }
      /* the answer held every message numbered up to `last`: one left out as malformed is passed over with the rest */
      if (!disposed && answer.last > cursor) {
        cursor = answer.last;
        await persistCursor();
      }
    }
  };

  const loop = run()
    .catch((err: unknown) => { log(`${BIN}: phone: the bridge stopped: ${reasonOf(err)}`); })
    .finally(() => { polling = false; });

  /* The desk's outlet: every send goes to the account as its kind, which routes it; ids come back `<network>:<id>`. */
  const outlet: DeskOutlet = {
    send: (text, opts) => send(opts.kind, text, {
      ...(opts.replyTo === undefined ? {} : { replyTo: opts.replyTo }),
      ...(opts.network === undefined ? {} : { network: opts.network }),
    }),
  };
  conversation.setOutlet(outlet);

  return {
    status: () => ({
      configured: true,
      polling,
      ...(lastPollAt === undefined ? {} : { lastPollAt }),
      ...(accountFailing === undefined ? {} : { accountFailing: { ...accountFailing } }),
      networks: account.networks.map((n) => ({ ...n })),
      queued: account.queued,
      strangers: account.strangers,
    }),
    dispose() {
      disposing ??= (async () => {
        disposed = true;
        polling = false;
        conversation.setOutlet(undefined);
        stopping.abort(new Error("the bridge is shut down"));
        wake?.();
        await bounded(DISPOSE_MS, loop);
      })();
      return disposing;
    },
  };
}
