// face/src/telegram.ts
/** The Telegram bridge: the operator's phone, talking to the desk through one private chat with a bot
 * (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md §5.3, §5.6, §5.8; the plan's Global
 * Constraints, docs/superpowers/plans/2026-10-20-desk-p1-bridge.md).
 *
 * ONE OPERATOR. The bridge long-polls the Bot API's getUpdates and takes one kind of update: a message from
 * TELEGRAM_OPERATOR_ID in the operator's private chat. Anything else - a stranger, a group, an edited
 * message, a channel post, a message with no sender - is dropped: counted, recorded in `telegram.jsonl`,
 * never answered. Every message the bridge sends goes to the operator's chat, whatever chat an update came
 * from.
 *
 * WHAT A MESSAGE DOES. A text goes to the desk conversation (src/desk-conversation.ts) with the telegram
 * source and the time the operator wrote it - Telegram's own `date`, not the time it arrived, which after a
 * night the Mac slept can be hours later. A post the conversation refuses is answered with its line, and an
 * opened turn's answer comes back through the outlet - the bridge is the conversation's outlet from install
 * to dispose. Four commands are the bridge's own: /status, /pause [duration], /new and /stop, in any case,
 * with or without the bot's name after them; any other /word is text for Gravit. There is no /resume: the
 * phone only ever makes the desk quieter (§5.8). A message with no text gets one line. A post or a /new
 * that takes more than 30 s is answered that the desk is slow, and the bridge goes on to the next update;
 * a refusal that comes later is still answered when it does.
 *
 * THE OFFSET. After each update, whatever happened to it, the offset is set past it and stored in
 * `telegram.offset`, so an update is taken once across restarts, and one the bridge cannot use is never
 * delivered again. Every update a poll answers is taken, in order - one numbered below the stored offset
 * too, with one line: after about a week with no update Telegram may number them afresh, and passing those
 * over would leave the phone unheard while the status read healthy.
 *
 * THE OUTBOX. Plain text, no parse mode, split at 4,000 UTF-16 code units ({@link splitMessage}). A send that
 * fails - unreachable, past its 15 s, any answer but a refusal - goes to `outbox.json`, at most 100 messages
 * long, with the time it was written; a send that got part of the way queues only what did not go. The
 * outbox is flushed, in order, before each poll and before any later send, so what waits there always goes
 * first, and a message it sends more than 2 minutes after it was written opens with a line that says so.
 * A message Telegram refuses outright - HTTP 400, or 403 for a bot the operator blocked - is never queued: a
 * queued one is dropped with one line, so it cannot hold up the rest, and a fresh one rejects; after a 403
 * the status reads `blocked` until a send goes through.
 *
 * THE POLL'S FAILURES. Every Bot API request has its own deadline: the long poll plus 15 s for getUpdates
 * (65 s), 15 s for sendMessage. HTTP 409 - another poller holds the token, a second face started without
 * `FACE_DESK=0`, or a webhook is set - is a `conflict` record, carrying Telegram's own description, at most
 * once a minute and a 30 s wait; any other failure, a `poll-error` record at most once a minute and a
 * backoff from 5 s doubling to 60 s, which a poll that answers resets. The loop never stops on a failure.
 *
 * THE TOKEN appears in one place: the path of each request's URL (`/bot<token>/<method>`). Every line this
 * module writes, every reason and description it records, every error it rejects with and every text it
 * sends or queues passes through a redactor first, so no log line, record, file or status field carries it.
 * The same redactor takes out every SECRET in the face's environment (src/desk-tools.ts `deskSecrets`, taken
 * at install): a desk turn's answer, or a line, that carries the model's key, Alpaca's or any other reaches the
 * operator's chat - and Telegram's cloud - as `<secret>`; the token stays `<token>`. It is the second line
 * behind the desk guard's secret check: whatever a turn learned, the phone never carries it out. A text is
 * redacted before it is sent or queued, and the outbox is redacted again as it is read back, so one an earlier
 * run wrote is too.
 *
 * MODULE WEIGHT. src/desk.ts loads this module on first use (`installDesk`, with the desk on and Telegram
 * configured), so the pause switch and scripts/service.ts, which import src/desk.ts, never load it; the face
 * itself (src/main.ts) imports it for {@link telegramConfigFromEnv}. It imports src/desk.ts's values
 * directly; the edge back is that dynamic import, so there is no static cycle. It imports src/desk-tools.ts,
 * which src/desk.ts loads already, for the secrets.
 * @module
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { appendRecord, deskDir, deskStatusLines, deskTime, parseDuration, writeOff, type DeskStatus, type TelegramStatus } from "./desk.ts";
import type { DeskConversation, DeskOutlet, PostResult } from "./desk-conversation.ts";
import type { DeskClock } from "./desk-session.ts";
import { deskSecrets, secretSpellings } from "./desk-tools.ts";

/** Diagnostic label, the one every `${BIN}:`-prefixed line in the face uses; the bridge's lines add `telegram:`. */
const BIN = "gravit-face";

/** The Bot API unless the config names another address (the tests' fake, the smokes' stub). */
const API_BASE = "https://api.telegram.org";
/** The long poll's `timeout`, in seconds: how long Telegram holds a getUpdates that has nothing to deliver. */
const POLL_TIMEOUT_S = 50;
/** How much longer than the long poll a getUpdates may take before it is cut. */
const POLL_SLACK_MS = 15_000;
/** A sendMessage's deadline. */
const SEND_DEADLINE_MS = 15_000;
/** The wait after Telegram answers a poll with 409. */
const CONFLICT_WAIT_MS = 30_000;
/** The backoff after any other failed poll: 5 s, doubling to 60 s. */
const BACKOFF_FIRST_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
/** A conflict, or a failed poll, is recorded at most this often. */
const RECORD_EVERY_MS = 60_000;
/** How long an update's post or /new may take before the bridge answers that the desk is slow and goes on. */
const POST_BOUND_MS = 30_000;
/** How long {@link BridgeHandle.dispose} waits for the update in hand and the sends under way. */
const DISPOSE_MS = 2_000;
/** The longest part a message is sent in: 4,000 UTF-16 code units, under Telegram's 4,096. */
const PART_MAX = 4_000;
/** The most messages the outbox holds; one more drops the oldest. */
const OUTBOX_MAX = 100;
/** A message flushed later than this after it was written says so. */
const LATE_MS = 120_000;

/** The bridge's files in the desk's directory (src/desk.ts `deskDir`). */
const RECORDS_FILE = "telegram.jsonl";
const OFFSET_FILE = "telegram.offset";
const OUTBOX_FILE = "outbox.json";

/** The phone's lines. */
const TEXT_ONLY = "text only on the desk";
const RESUMES = "a terminal resumes it: npm run desk -- resume";
const PAUSE_USAGE = "/pause takes Nm, Nh or Nd - 30m, 2h, 1d - or nothing; nothing was paused";
const RENEWED = "a new desk conversation";
const SLOW = "the desk is slow to take this; it will answer when it can";
/** What `/stop` cancels the turn under way with. */
const STOP_REASON = "stopped from the phone";

const defaultClock: DeskClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

/* ---------- configuration ---------- */

/** What the bridge needs: the bot's `token` and the operator's numeric Telegram user id - both from the
 * environment ({@link telegramConfigFromEnv}) - and, for the tests and the smokes, the Bot API's address
 * (`apiBase`, default `https://api.telegram.org`), `fetch` (the global one), the long poll in seconds
 * (`pollTimeoutS`, 50) and `clock` (the global timers). */
export interface TelegramConfig {
  token: string;
  operatorId: number;
  apiBase?: string;
  fetch?: typeof fetch;
  pollTimeoutS?: number;
  clock?: DeskClock;
}

/** The operator's id as `TELEGRAM_OPERATOR_ID` spells it: digits only. */
const OPERATOR_ID = /^\d+$/;

/**
 * The bridge's configuration from the environment - `$DSH_HOME/.env`, which dsh reads into it at boot - or
 * `undefined`, and with it no bridge: unless `TELEGRAM_BOT_TOKEN` is set and not blank, and
 * `TELEGRAM_OPERATOR_ID` is digits only - no sign, no space - naming an id a number holds exactly.
 * @param env - the environment, `process.env` in main.ts.
 */
export function telegramConfigFromEnv(env: NodeJS.ProcessEnv): TelegramConfig | undefined {
  const token = env.TELEGRAM_BOT_TOKEN;
  const id = env.TELEGRAM_OPERATOR_ID;
  if (token === undefined || token.trim() === "" || id === undefined || !OPERATOR_ID.test(id)) return undefined;
  const operatorId = Number(id);
  return Number.isSafeInteger(operatorId) ? { token, operatorId } : undefined;
}

/* ---------- what is said, and how it is cut ---------- */

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * `text` in parts of at most `max` UTF-16 code units, which joined back are `text` itself. Each part ends
 * after the last line end that fits, when that leaves it at least half full; else after the last space,
 * on the same terms; else where it is full - and never between the two halves of a surrogate pair, so
 * every part is valid UTF-16. An empty text is no parts.
 * @param text - what is sent.
 * @param max - the longest part, 4,000 by default; at least 2, so a pair always fits.
 * @throws RangeError for a `max` that is not a whole number of at least 2.
 */
export function splitMessage(text: string, max = PART_MAX): string[] {
  if (!Number.isInteger(max) || max < 2) throw new RangeError(`splitMessage cuts parts of at least 2 code units, not ${max}`);
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max - 1) + 1;
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max - 1) + 1;
    if (cut < max / 2) cut = max;
    if (isHighSurrogate(rest.charCodeAt(cut - 1)) && isLowSurrogate(rest.charCodeAt(cut))) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

/** A command the bridge answers itself, and what followed it. */
export type Command = { cmd: "status" | "pause" | "new" | "stop"; arg?: string };

/** The four commands, as Telegram sends them: the word in any case, then the bot's name when the operator
 * picked the command from the menu, then anything after a space. */
const COMMAND = /^\/(status|pause|new|stop)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i;

/**
 * `text` as one of the bridge's own commands - `/status`, `/pause [duration]`, `/new`, `/stop`, in any case
 * (`/Status`, `/PAUSE@botname 2h`) - with what follows it as `arg`, trimmed, when anything does; anything
 * else, any other `/word` included, is `undefined`: text for Gravit. The argument is left as typed: a
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

/* ---------- the bridge ---------- */

/** What {@link installTelegramBridge} needs: the configuration; the harness home, whose desk directory
 * holds the bridge's files; the desk conversation, as the bridge uses it; `status`, what `/status` reads
 * (src/desk.ts `deskStatus`); `log`, where a line goes (stderr); `secrets`, the values redacted as `<secret>`
 * beside the token (src/desk-tools.ts `deskSecrets` of `process.env`, taken at install, unless given). */
export interface BridgeDeps {
  config: TelegramConfig;
  home: string;
  conversation: Pick<DeskConversation, "post" | "renew" | "stop" | "setOutlet">;
  status: () => Promise<DeskStatus>;
  log?: (line: string) => void;
  secrets?: readonly string[];
}

/** The running bridge. `status` is what the desk's status reports of it; `send` sends `text` to the
 * operator, as a reply to `replyTo` when given, and resolves the message id of every part it sent - with
 * `queued: true` too when the rest of the text went to the outbox - or `{ queued: true }` when all of it
 * did, rejecting only when Telegram refuses it outright; `dispose` ends the bridge (see
 * {@link installTelegramBridge}). */
export interface BridgeHandle {
  status(): TelegramStatus;
  send(text: string, opts?: { replyTo?: number }): Promise<{ sent: number[]; queued?: true } | { queued: true }>;
  dispose(): Promise<void>;
}

/** The parts of a Bot API update the bridge reads, each checked before it is used. */
interface TgMessage {
  message_id?: unknown;
  from?: { id?: unknown } | null;
  chat?: { id?: unknown; type?: unknown } | null;
  date?: unknown;
  text?: unknown;
}
type TgUpdate = { update_id?: unknown; message?: TgMessage | null } & Record<string, unknown>;

/** One message waiting in the outbox: when it was written, its text, and the message it answers, if any. */
interface OutboxEntry {
  t: string;
  text: string;
  replyTo?: number;
}

/** A Bot API answer that was not `ok`: its HTTP status - or Telegram's `error_code` - and what it said. */
class BotApiError extends Error {
  constructor(readonly status: number, readonly description: string) {
    super(`HTTP ${status}${description === "" ? "" : ` ${description}`}`);
  }
}

/** A send that stopped at a part: the ids and the size of the parts that went before it, the text that did
 * not go, and the error it stopped on. */
class SendFailure extends Error {
  constructor(readonly ids: number[], readonly parts: number, readonly chars: number, readonly rest: string, readonly error: unknown) {
    super(reasonOf(error));
  }
}

/** A failure as one line: its message, and the code it or its cause carries when the message does not say
 * it (`fetch failed (ECONNREFUSED)`). */
function reasonOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const own = (err as { code?: unknown }).code;
  const code = typeof own === "string" ? own : (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
}

/** Telegram refused the message outright - 400, the request itself; 403, a bot the operator blocked or
 * never started: sending it again cannot help. */
const isRefused = (err: unknown): boolean => err instanceof BotApiError && (err.status === 400 || err.status === 403);
/** The operator blocked the bot, or never started it (403). */
const isBlocked = (err: unknown): boolean => err instanceof BotApiError && err.status === 403;
/** Another poller holds the token, or a webhook is set (409). */
const isConflict = (err: unknown): err is BotApiError => err instanceof BotApiError && err.status === 409;

/** Every spelling of `token` and of each of `secrets` a line could carry - as it is, as JSON escapes it, as a URL
 * encodes it (src/desk-tools.ts `secretSpellings`) - made `<token>` and `<secret>`, the token's label winning where a
 * spelling is both. The longest spelling goes first, so a secret that holds another is taken out whole. */
function redactorOf(token: string, secrets: readonly string[]): (text: string) => string {
  const labels = new Map<string, string>();
  for (const spelling of secretSpellings(token)) labels.set(spelling, "<token>");
  for (const secret of secrets) {
    for (const spelling of secretSpellings(secret)) if (!labels.has(spelling)) labels.set(spelling, "<secret>");
  }
  const order = [...labels].sort(([a], [b]) => b.length - a.length);
  return (text) => order.reduce((out, [spelling, label]) => out.split(spelling).join(label), text);
}

/** `outbox.json`'s text as entries - those that are `{ t, text }`, `t` a time, with a whole-number
 * `replyTo` if any - and how many were not; `undefined` when it is not a JSON list at all. */
function outboxOf(text: string): { entries: OutboxEntry[]; skipped: number } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const entries: OutboxEntry[] = [];
  for (const item of parsed as unknown[]) {
    const { t, text: body, replyTo } = (item ?? {}) as { t?: unknown; text?: unknown; replyTo?: unknown };
    if (typeof t !== "string" || Number.isNaN(Date.parse(t)) || typeof body !== "string") continue;
    if (replyTo !== undefined && !Number.isSafeInteger(replyTo)) continue;
    entries.push({ t, text: body, ...(replyTo === undefined ? {} : { replyTo: replyTo as number }) });
  }
  return { entries, skipped: parsed.length - entries.length };
}

/** An update's own object: its message, or, for any other kind of update, its first field that is an
 * object - an edited message, a channel post. */
function payloadOf(update: TgUpdate): TgMessage | undefined {
  if (update.message !== null && typeof update.message === "object") return update.message;
  for (const [key, value] of Object.entries(update)) {
    if (key !== "update_id" && value !== null && typeof value === "object") return value as TgMessage;
  }
  return undefined;
}

/** How a promise settled within a bound: with its value, with its error, or not yet. */
type Bounded<T> = { settled: true; value: T } | { settled: true; error: unknown } | { settled: false };

/**
 * Start the bridge: it is the conversation's outlet at once, and its loop - load the offset and the outbox,
 * then, until dispose, flush the outbox and poll - starts without being awaited. Never throws, and nothing
 * it starts can reject: a failure is a line, a record, or both.
 *
 * Each update is taken in turn (see the module header): dropped unless it is the operator's message in
 * their private chat; then a message with no text gets `text only on the desk`; a command is answered by
 * the bridge - `/status` with the desk's lines (src/desk.ts `deskStatusLines`) and `desk session <id>` and
 * `turns today <n>` after them, `/pause [d]` with the pause in force once it is written (src/desk.ts
 * `writeOff`, set by `telegram`), `/new` and `/stop` with what the conversation did; and a text is posted to
 * the conversation, a refusal answered with its line. A post or a `/new` still under way after 30 s on the
 * clock is answered `the desk is slow to take this; it will answer when it can`, and what it comes to is
 * answered when it settles. Then the offset is set past the update.
 *
 * `dispose()` aborts the poll and the sends under way - a send cut short waits in the outbox - stops the
 * loop, lets go of the outlet, and keeps the outbox; it waits up to 2 s for the update in hand and the
 * sends under way, then settles, and a second call settles with the first. The conversation, not the
 * bridge, cancels a turn under way at shutdown. After dispose, `send` queues without a request.
 * @param deps - see {@link BridgeDeps}.
 */
export function installTelegramBridge(deps: BridgeDeps): BridgeHandle {
  const { config, home, conversation } = deps;
  const { token, operatorId } = config;
  const apiBase = (config.apiBase ?? API_BASE).replace(/\/+$/, "");
  const fetchImpl = config.fetch ?? fetch;
  const pollTimeoutS = config.pollTimeoutS ?? POLL_TIMEOUT_S;
  const clock = config.clock ?? defaultClock;
  const redact = redactorOf(token, deps.secrets ?? deskSecrets(process.env));
  const sink = deps.log ?? ((line: string): void => { console.error(line); });
  const log = (line: string): void => { sink(redact(line)); };
  const stamp = (): string => new Date(clock.now()).toISOString();
  const offsetPath = join(deskDir(home), OFFSET_FILE);
  const outboxPath = join(deskDir(home), OUTBOX_FILE);
  const record = (r: object): Promise<void> => appendRecord(home, RECORDS_FILE, r, { log });

  let polling = true;
  let lastPollAt: string | undefined;
  let dropped = 0;
  let lastDroppedFrom: number | undefined;
  let conflictAt: string | undefined;
  /** Whether the last answer to a send was a 403, with no send through since. */
  let blocked = false;
  /** The next update the bridge has not taken; `undefined` until it has a stored one or takes one. */
  let offset: number | undefined;
  let outbox: OutboxEntry[] = [];
  let disposed = false;
  let disposing: Promise<void> | undefined;
  /** Aborted at dispose: every request under way is cut. */
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

  /* ---------- the Bot API ---------- */

  /** One Bot API call: `method`, with `body` as JSON, cut at `deadlineMs` or at dispose. Resolves the
   * answer's `result`; rejects with a {@link BotApiError} for an answer that is not `ok`, or with whatever
   * stopped the request. */
  const call = async (method: string, body: object, deadlineMs: number): Promise<unknown> => {
    const request = new AbortController();
    const stop = (): void => { request.abort(stopping.signal.reason); };
    if (stopping.signal.aborted) stop();
    else stopping.signal.addEventListener("abort", stop, { once: true });
    const timer = clock.setTimeout(() => { request.abort(new Error(`no answer in ${deadlineMs / 1000} s`)); }, deadlineMs);
    try {
      const res = await fetchImpl(`${apiBase}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: request.signal,
      });
      let answer: { ok?: unknown; result?: unknown; error_code?: unknown; description?: unknown } | undefined;
      try {
        answer = (await res.json()) as typeof answer;
      } catch {
        if (request.signal.aborted) throw request.signal.reason;
        answer = undefined;
      }
      if (res.ok && answer?.ok === true) return answer.result;
      const status = typeof answer?.error_code === "number" ? answer.error_code : res.status;
      throw new BotApiError(status, typeof answer?.description === "string" ? answer.description : res.statusText);
    } finally {
      clock.clearTimeout(timer);
      stopping.signal.removeEventListener("abort", stop);
    }
  };

  /** Send `text` to the operator's chat in parts, the first as a reply to `replyTo` when given. Resolves
   * the ids and the size of what went; rejects with a {@link SendFailure} at the first part that does not.
   * A part that goes ends a 403's `blocked`; a 403 sets it. */
  const deliver = async (text: string, replyTo: number | undefined): Promise<{ ids: number[]; parts: number; chars: number }> => {
    const parts = splitMessage(text).filter((part) => part.trim() !== "");
    const ids: number[] = [];
    let chars = 0;
    for (const [i, part] of parts.entries()) {
      const reply = i === 0 && replyTo !== undefined ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
      let result: unknown;
      try {
        result = await call("sendMessage", { chat_id: operatorId, text: part, ...reply }, SEND_DEADLINE_MS);
      } catch (err) {
        if (isBlocked(err)) blocked = true;
        throw new SendFailure(ids, i, chars, parts.slice(i).join(""), err);
      }
      blocked = false;
      const id = (result as { message_id?: unknown } | null | undefined)?.message_id;
      if (typeof id === "number") ids.push(id);
      chars += part.length;
    }
    return { ids, parts: parts.length, chars };
  };

  /* ---------- the outbox: every send and the flush, one at a time ---------- */

  let chain: Promise<unknown> = Promise.resolve();
  const outbound = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };

  const persistOutbox = async (): Promise<void> => {
    try {
      await writeFileAtomic(outboxPath, `${JSON.stringify(outbox)}\n`, { mode: 0o600, dirMode: 0o700 });
    } catch (err) {
      log(`${BIN}: telegram: ${outboxPath} could not be written: ${reasonOf(err)}; ${outbox.length} queued message(s) are held in memory only`);
    }
  };

  /** Queue `entry` - the oldest message dropped, with one line, when the outbox would hold more than 100. */
  const enqueue = async (entry: OutboxEntry): Promise<void> => {
    outbox.push(entry);
    if (outbox.length > OUTBOX_MAX) {
      const oldest = outbox.shift() as OutboxEntry;
      log(`${BIN}: telegram: the outbox holds ${OUTBOX_MAX} messages; the oldest, written ${deskTime(new Date(oldest.t), new Date(clock.now()))}, is dropped`);
    }
    await persistOutbox();
    await record({ t: stamp(), kind: "queued", chars: entry.text.length });
  };

  /** The line a message written at `t` opens with when it is sent more than 2 minutes later - the time as
   * src/desk.ts `deskTime` shows it - and nothing otherwise. */
  const lateLine = (t: string): string => {
    const now = clock.now();
    return now - Date.parse(t) > LATE_MS ? `(written ${deskTime(new Date(t), new Date(now))}, sent late)\n` : "";
  };

  /** Send what waits in the outbox, in order, until it is empty or a message does not go - that one stays
   * at the head, cut to what did not go - or one is refused outright, which is dropped. */
  const flush = async (): Promise<void> => {
    while (outbox.length > 0 && !disposed) {
      const head = outbox[0];
      /* the late line rides in the first part, so what does not go is always the head's own text */
      const late = lateLine(head.t);
      try {
        const done = await deliver(`${late}${head.text}`, head.replyTo);
        outbox.shift();
        await persistOutbox();
        if (done.parts > 0) await record({ t: stamp(), kind: "sent", parts: done.parts, chars: done.chars });
      } catch (err) {
        const failure = err as SendFailure;
        if (failure.parts > 0) await record({ t: stamp(), kind: "sent", parts: failure.parts, chars: failure.chars });
        if (isRefused(failure.error)) {
          outbox.shift();
          await persistOutbox();
          log(`${BIN}: telegram: Telegram refused a queued message (${failure.message}); it is dropped from the outbox`);
          continue;
        }
        if (failure.parts > 0) {
          outbox[0] = { t: head.t, text: failure.rest };
          await persistOutbox();
        }
        return;
      }
    }
  };

  const send = (text: string, opts: { replyTo?: number } = {}): Promise<{ sent: number[]; queued?: true } | { queued: true }> => outbound(async () => {
    const t = stamp();
    const body = redact(text);
    const { replyTo } = opts;
    if (body.trim() === "") return { sent: [] };
    if (outbox.length > 0) await flush();
    if (disposed || outbox.length > 0) {
      await enqueue({ t, text: body, ...(replyTo === undefined ? {} : { replyTo }) });
      return { queued: true };
    }
    try {
      const done = await deliver(body, replyTo);
      if (done.parts > 0) await record({ t: stamp(), kind: "sent", parts: done.parts, chars: done.chars });
      return { sent: done.ids };
    } catch (err) {
      const failure = err as SendFailure;
      if (failure.parts > 0) await record({ t: stamp(), kind: "sent", parts: failure.parts, chars: failure.chars });
      if (isRefused(failure.error)) throw new Error(redact(`Telegram refused the message: ${failure.message}`));
      log(`${BIN}: telegram: a message could not be sent (${failure.message}); it waits in the outbox`);
      await enqueue({ t, text: failure.rest, ...(failure.parts === 0 && replyTo !== undefined ? { replyTo } : {}) });
      return failure.parts > 0 ? { sent: failure.ids, queued: true } : { queued: true };
    }
  });

  /** A line to the operator; a refusal is one line here, never a rejection. */
  const reply = async (line: string): Promise<void> => {
    try {
      await send(line);
    } catch (err) {
      log(`${BIN}: telegram: a reply could not be sent: ${reasonOf(err)}`);
    }
  };

  /* ---------- the stored state ---------- */

  /** A file's text, or `undefined` when there is none - or, with a line, when it cannot be read. */
  const readText = async (path: string): Promise<string | undefined> => {
    try {
      return await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") log(`${BIN}: telegram: ${path} could not be read: ${reasonOf(err)}`);
      return undefined;
    }
  };

  const load = async (): Promise<void> => {
    const stored = (await readText(offsetPath))?.trim();
    if (stored !== undefined) {
      const next = Number(stored);
      if (OPERATOR_ID.test(stored) && Number.isSafeInteger(next)) offset = next;
      else log(`${BIN}: telegram: ${offsetPath} holds no offset; the first poll takes what Telegram has not had confirmed`);
    }
    const queued = await readText(outboxPath);
    if (queued === undefined) return;
    const read = outboxOf(queued);
    if (read === undefined) {
      log(`${BIN}: telegram: ${outboxPath} is not an outbox; nothing in it is sent, and the next message queued replaces it`);
      return;
    }
    if (read.skipped > 0) log(`${BIN}: telegram: ${read.skipped} entr${read.skipped === 1 ? "y" : "ies"} in ${outboxPath} are not messages and are not sent`);
    /* an earlier run may have queued what this one redacts: the next write of the outbox holds it redacted */
    outbox = read.entries.map((entry) => ({ ...entry, text: redact(entry.text) }));
  };

  const persistOffset = async (): Promise<void> => {
    try {
      await writeFileAtomic(offsetPath, `${offset}\n`, { mode: 0o600, dirMode: 0o700 });
    } catch (err) {
      log(`${BIN}: telegram: ${offsetPath} could not be written: ${reasonOf(err)}; after a restart Telegram may deliver these updates again`);
    }
  };

  /* ---------- the updates ---------- */

  const drop = async (update: TgUpdate): Promise<void> => {
    const payload = payloadOf(update);
    const from = payload?.from?.id;
    const chatType = payload?.chat?.type;
    dropped += 1;
    lastDroppedFrom = typeof from === "number" ? from : undefined;
    await record({
      t: stamp(), kind: "drop",
      ...(typeof from === "number" ? { from } : {}),
      ...(typeof chatType === "string" ? { chatType } : {}),
    });
  };

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

  const pauseReply = async (arg: string | undefined): Promise<string> => {
    const ms = arg === undefined ? undefined : parseDuration(arg);
    if (arg !== undefined && ms === undefined) return PAUSE_USAGE;
    const at = clock.now();
    try {
      const state = await writeOff(home, { by: "telegram", ...(ms === undefined ? {} : { until: at + ms }) }, () => at);
      const until = state.until === undefined ? "" : ` until ${deskTime(new Date(state.until), new Date(at))}`;
      return `paused${until}; ${RESUMES}`;
    } catch (err) {
      return `the pause could not be set: ${reasonOf(err)}`;
    }
  };

  const stopReply = async (): Promise<string> => {
    try {
      return (await conversation.stop(STOP_REASON)) ? "stopped" : "nothing is running";
    } catch (err) {
      return `the desk could not be stopped: ${reasonOf(err)}`;
    }
  };

  /** Wait up to 30 s for `line`, the answer to a post or a `/new`: past that, answer that the desk is slow
   * and leave `line` to be answered when it settles - an empty one, as an opened turn's is, says nothing. */
  const answerWithin = async (line: Promise<string>): Promise<void> => {
    const answered = await bounded(POST_BOUND_MS, line);
    if (answered.settled) {
      if ("value" in answered && answered.value !== "") await reply(answered.value);
      return;
    }
    await reply(SLOW);
    void line.then((late) => (late === "" ? undefined : reply(late)), () => undefined);
  };

  const handle = async (update: TgUpdate): Promise<void> => {
    const message = update.message;
    const chat = message?.chat;
    const messageId = message?.message_id;
    if (message?.from?.id !== operatorId || chat?.type !== "private" || chat.id !== operatorId || typeof messageId !== "number") {
      await drop(update);
      return;
    }
    if (typeof message.text !== "string") {
      await reply(TEXT_ONLY);
      return;
    }
    const command = parseCommand(message.text);
    if (command?.cmd === "new") {
      await answerWithin(conversation.renew().then(() => RENEWED, (err: unknown) => `a new desk conversation could not be opened: ${reasonOf(err)}`));
      return;
    }
    if (command !== undefined) {
      await reply(command.cmd === "status" ? await statusReply() : command.cmd === "pause" ? await pauseReply(command.arg) : await stopReply());
      return;
    }
    const { date } = message;
    const at = typeof date === "number" && Number.isSafeInteger(date) && date > 0 ? date * 1_000 : undefined;
    const posted = conversation.post({
      text: message.text,
      source: { kind: "telegram", ...(at === undefined ? {} : { at }) },
      message: { kind: "telegram", from: operatorId, chat: operatorId, messageId },
    });
    await answerWithin(posted.then(
      (result: PostResult) => ("refused" in result ? result.line : ""),
      (err: unknown) => {
        log(`${BIN}: telegram: the desk did not take update ${String(update.update_id)}: ${reasonOf(err)}`);
        return "";
      },
    ));
  };

  /** Take one update, whatever it is, then set the offset past it. An update numbered below the stored
   * offset is taken too - Telegram has numbered its updates afresh - with one line. */
  const take = async (raw: unknown): Promise<void> => {
    const update = (raw !== null && typeof raw === "object" ? raw : {}) as TgUpdate;
    const id = update.update_id;
    const numbered = typeof id === "number" && Number.isSafeInteger(id) && id >= 0;
    if (numbered && offset !== undefined && id < offset) {
      log(`${BIN}: desk: Telegram update ${id} is below the stored offset ${offset}: Telegram has numbered its updates afresh, so the bridge takes it and goes on from ${id + 1}`);
    }
    try {
      await handle(update);
    } catch (err) {
      log(`${BIN}: telegram: update ${numbered ? id : "without an id"} could not be handled: ${reasonOf(err)}`);
    }
    if (!numbered) return;
    offset = id + 1;
    await persistOffset();
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

  const poll = async (): Promise<unknown[]> => {
    const result = await call("getUpdates", {
      ...(offset === undefined ? {} : { offset }),
      timeout: pollTimeoutS,
      allowed_updates: ["message"],
    }, pollTimeoutS * 1_000 + POLL_SLACK_MS);
    if (!Array.isArray(result)) throw new Error("getUpdates answered something that is not a list");
    return result as unknown[];
  };

  const run = async (): Promise<void> => {
    await outbound(load);
    let backoff = 0;
    let conflictRecordedAt = Number.NEGATIVE_INFINITY;
    let failureRecordedAt = Number.NEGATIVE_INFINITY;
    while (!disposed) {
      await outbound(flush);
      if (disposed) break;
      let updates: unknown[];
      try {
        updates = await poll();
      } catch (err) {
        if (disposed) break;
        const at = clock.now();
        const t = new Date(at).toISOString();
        if (isConflict(err)) {
          conflictAt = t;
          if (at - conflictRecordedAt >= RECORD_EVERY_MS) {
            conflictRecordedAt = at;
            const description = redact(err.description);
            await record({ t, kind: "conflict", description });
            log(`${BIN}: telegram: getUpdates got HTTP 409 (${description}): another poller holds the bot's token - a second face without `
              + `FACE_DESK=0? - or a webhook is set; polling again in ${CONFLICT_WAIT_MS / 1000} s`);
          }
          await sleep(CONFLICT_WAIT_MS);
          continue;
        }
        backoff = backoff === 0 ? BACKOFF_FIRST_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
        if (at - failureRecordedAt >= RECORD_EVERY_MS) {
          failureRecordedAt = at;
          const reason = redact(reasonOf(err));
          await record({ t, kind: "poll-error", reason });
          log(`${BIN}: telegram: the poll failed (${reason}); polling again in ${backoff / 1000} s`);
        }
        await sleep(backoff);
        continue;
      }
      backoff = 0;
      lastPollAt = stamp();
      for (const update of updates) {
        if (disposed) break;
        await take(update);
      }
    }
  };

  const loop = run()
    .catch((err: unknown) => { log(`${BIN}: telegram: the bridge stopped: ${reasonOf(err)}`); })
    .finally(() => { polling = false; });

  const outlet: DeskOutlet = { send: (text, opts) => send(text, opts) };
  conversation.setOutlet(outlet);

  return {
    status: () => ({
      configured: true,
      polling,
      ...(lastPollAt === undefined ? {} : { lastPollAt }),
      dropped,
      ...(lastDroppedFrom === undefined ? {} : { lastDroppedFrom }),
      queued: outbox.length,
      ...(conflictAt === undefined ? {} : { conflictAt }),
      ...(blocked ? { blocked: true } : {}),
    }),
    send,
    dispose() {
      disposing ??= (async () => {
        disposed = true;
        polling = false;
        conversation.setOutlet(undefined);
        stopping.abort(new Error("the bridge is shut down"));
        wake?.();
        await bounded(DISPOSE_MS, Promise.all([loop, chain]));
      })();
      return disposing;
    },
  };
}
