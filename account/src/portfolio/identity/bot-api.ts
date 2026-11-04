/** THE TELEGRAM BOT API, as the account speaks it: three methods (getMe, getUpdates, sendMessage) over fetch, each a POST of JSON to
 * `<apiBase>/bot<token>/<method>`, each under its deadline (a long poll its own timeout and 15 s more, everything else 15 s) and cut at once
 * when the caller's signal aborts. An answer that is not `ok` is a BotApiError: its HTTP status — or Telegram's error_code — and what
 * Telegram said. The token is in the URL alone: no error, description or message this module makes carries it (redactorOf).
 *
 * The address is https://api.telegram.org. ACCOUNT_TELEGRAM_API overrides it for the tests and the smokes, and only with an
 * http://127.0.0.1:<port> value: anything else is ignored with one line, so that no setting can send the token to another host
 * (telegramApiBase). This file is the only one in account/src that names Telegram's host.
 *
 * splitMessage and redactorOf came from the face's bridge (face/src/telegram.ts), with its cases: the face keeps the desk side, the account
 * the transport. */

/** Telegram's own address: the only one a token is sent to outside a test */
const TELEGRAM_API = "https://api.telegram.org";
/** the one override taken: plain http to this machine's 127.0.0.1, a port and nothing else */
const LOOPBACK_BASE = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/;
/** how much longer than the long poll a getUpdates may take before it is cut */
const POLL_SLACK_MS = 15_000;
/** every other call's deadline */
const CALL_DEADLINE_MS = 15_000;
/** the longest part a message is sent in: 4,000 UTF-16 code units, under Telegram's 4,096 */
const PART_MAX = 4_000;

/**
 * The Bot API's address for this run: Telegram's own, unless `ACCOUNT_TELEGRAM_API` is exactly `http://127.0.0.1:<port>` (a fake Bot API
 * in a test or a smoke). A value that is set and is not that is ignored, and `log` is told so in one line that does not repeat it.
 */
export function telegramApiBase(env: NodeJS.ProcessEnv, log: (l: string) => void): string {
  const v = env.ACCOUNT_TELEGRAM_API;
  if (v === undefined || v === "") return TELEGRAM_API;
  const m = LOOPBACK_BASE.exec(v);
  if (m && Number(m[1]) <= 65_535) return v;
  log(`identity: ACCOUNT_TELEGRAM_API is not an http://127.0.0.1:<port> address, so it is ignored: the Bot API is ${TELEGRAM_API}`);
  return TELEGRAM_API;
}

// ---- what is said, and how it is cut --------------------------------------------------------------------------------------------

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * `text` in parts of at most `max` UTF-16 code units, which joined back are `text` itself. Each part ends after the last line end that
 * fits, when that leaves it at least half full; else after the last space, on the same terms; else where it is full — and never between
 * the two halves of a surrogate pair, so every part is valid UTF-16. An empty text is no parts.
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

/** a value's spellings a line could carry: as it is, as JSON escapes it, as a URL encodes it (face/src/desk-tools.ts secretSpellings) */
function spellings(value: string): string[] {
  let encoded: string[] = [];
  try {
    encoded = [encodeURIComponent(value)];
  } catch {
    /* a lone surrogate, which no URL can carry */
  }
  return [...new Set([value, JSON.stringify(value).slice(1, -1), ...encoded])].filter((s) => s !== "");
}

/** Every spelling of each of `secrets` a line could carry, made `<secret>`; the longest spelling goes first, so a secret that holds
 * another is taken out whole */
export function redactorOf(secrets: readonly string[]): (text: string) => string {
  const all = new Set<string>();
  for (const secret of secrets) for (const s of spellings(secret)) all.add(s);
  const order = [...all].sort((a, b) => b.length - a.length);
  return (text) => order.reduce((out, s) => out.split(s).join("<secret>"), text);
}

// ---- the client -------------------------------------------------------------------------------------------------------------------

/** A Bot API answer that was not `ok`: its HTTP status — or Telegram's error_code — and what Telegram said (the token taken out) */
export class BotApiError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
  ) {
    super(`HTTP ${status}${description === "" ? "" : ` ${description}`}`);
    this.name = "BotApiError";
  }
}

/** A failure as one line: its message, and the code it or its cause carries when the message does not say it (`fetch failed
 * (ECONNREFUSED)`) */
function reasonOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const own = (err as { code?: unknown }).code;
  const code = typeof own === "string" ? own : (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
}

export interface BotApiOptions {
  token: string;
  apiBase: string;
  fetch?: typeof fetch | undefined;
  /** aborted: every call under way is cut, and every later one refused at once */
  signal?: AbortSignal | undefined;
}

export class BotApi {
  private readonly token: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly signal: AbortSignal | undefined;
  private readonly redact: (text: string) => string;

  constructor(o: BotApiOptions) {
    this.token = o.token;
    this.base = o.apiBase.replace(/\/+$/, "");
    this.fetchImpl = o.fetch ?? fetch;
    this.signal = o.signal;
    this.redact = redactorOf([o.token]);
  }

  /** who the bot is: the token's own account at Telegram */
  async getMe(): Promise<{ id: number; username: string; first_name: string }> {
    const r = (await this.call("getMe", {}, CALL_DEADLINE_MS)) as { id?: unknown; username?: unknown; first_name?: unknown } | null;
    if (!r || typeof r.id !== "number" || typeof r.username !== "string" || r.username === "") throw new Error("getMe answered something that is not a bot");
    return { id: r.id, username: r.username, first_name: typeof r.first_name === "string" ? r.first_name : "" };
  }

  /** the updates from `offset` on (all Telegram holds when undefined), long-polled for `timeoutS` seconds; messages only */
  async getUpdates(offset: number | undefined, timeoutS: number): Promise<unknown[]> {
    const r = await this.call("getUpdates", { ...(offset === undefined ? {} : { offset }), timeout: timeoutS, allowed_updates: ["message"] }, timeoutS * 1000 + POLL_SLACK_MS);
    if (!Array.isArray(r)) throw new Error("getUpdates answered something that is not a list");
    return r as unknown[];
  }

  /** send `text` (plain, no parse mode) to `chatId`, as a reply to `replyTo` when given; answers the new message's id */
  async sendMessage(chatId: number, text: string, replyTo?: number): Promise<number> {
    const reply = replyTo !== undefined ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
    const r = (await this.call("sendMessage", { chat_id: chatId, text, ...reply }, CALL_DEADLINE_MS)) as { message_id?: unknown } | null;
    if (!r || typeof r.message_id !== "number") throw new Error("sendMessage answered no message id");
    return r.message_id;
  }

  /** One call: `method` with `body` as JSON, cut at `deadlineMs` or when the caller's signal aborts. Resolves the answer's `result`;
   * rejects with a BotApiError for an answer that is not `ok`, or with an Error that says what stopped the request — never the token */
  private async call(method: string, body: object, deadlineMs: number): Promise<unknown> {
    const deadline = AbortSignal.timeout(deadlineMs);
    const signal = this.signal ? AbortSignal.any([this.signal, deadline]) : deadline;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/bot${this.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    } catch (err) {
      if (this.signal?.aborted) throw new Error("stopped");
      if (deadline.aborted) throw new Error(`no answer in ${deadlineMs / 1000} s`);
      throw new Error(this.redact(reasonOf(err)));
    }
    let answer: { ok?: unknown; result?: unknown; error_code?: unknown; description?: unknown } | undefined;
    try {
      answer = (await res.json()) as typeof answer;
    } catch {
      if (this.signal?.aborted) throw new Error("stopped");
      if (deadline.aborted) throw new Error(`no answer in ${deadlineMs / 1000} s`);
      answer = undefined;
    }
    if (res.ok && answer?.ok === true) return answer.result;
    const status = typeof answer?.error_code === "number" ? answer.error_code : res.status;
    throw new BotApiError(status, this.redact(typeof answer?.description === "string" ? answer.description : res.statusText));
  }
}
