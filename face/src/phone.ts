// face/src/phone.ts
/**
 * The phone as the face reaches it: the account's identity half (account/src/portfolio/identity/), which holds the
 * networks, picks the recipients, the routing and quiet hours. Every desk send names its kind, and the account reads
 * the kind to route it; it cannot check who calls, so the face is exact:
 * - `chat` only for a reply to the operator's own text - it goes back to the network the text came from, and quiet
 *   hours never hold it;
 * - `watchdog` only from the watchdog (scripts/watchdog.ts) - it goes to every connected network;
 * - every other producer its own: `alert` (a watch alert, batch, late or lost line, annotation and the watch's own
 *   lines), `urgent` (an alert of a rule marked `urgent: true` - it goes through quiet hours), `brief` (the pre-close
 *   brief's firing), `report` (every other firing, the standing orders' lines, a wake turn's answer), `card` (Gate 2's
 *   notices), `fill` (the account's own).
 * A message id is `<network>:<the network's own id>` - `telegram:4821`, `slack:1730812345.001200`, `imessage:<chat GUID>` ({@link WIRE_ID}).
 *
 * THE CLIENT ({@link createPhoneClient}) is the face's server side's alone - the browser never reaches these two
 * routes (src/account-proxy.ts proxies neither): `GET /api/account/identity/inbox?after=<n>&wait=<s>`, the operator's
 * messages the account numbered above `n`, long-polled; and `POST /api/account/identity/send {kind, text, replyTo?,
 * network?}`. The face holds no network's token and names no recipient: the account does both. What a send came to is
 * read from the answer's body - `ok`, `sent`, `queued`, `held` - never from its HTTP status alone: a dead account and
 * the account's own refusal can both be a 502. Every text is redacted of the face's secrets (src/desk-tools.ts
 * `deskSecrets`) before it leaves, as `<secret>`: a desk turn that learned a key never carries it to a phone.
 * @module
 */
import { deskSecrets, secretSpellings } from "./desk-tools.ts";

/** What a desk send is, as the account routes it (the account's `PHONE_KINDS`). */
export type PhoneKind = "chat" | "alert" | "urgent" | "brief" | "report" | "card" | "fill" | "watchdog";

/** One message of the operator's, as the account's inbox keeps it: `id`, the account's own number for it - it grows
 * by one at each message and is never reused on that home; `network`; `messageId`, `<network>:<the network's id>`;
 * `replyTo`, the message it answers, when it answers one; `text`; `at`, when the operator wrote it (ISO). */
export interface InboxMessage { id: number; network: string; messageId: string; replyTo?: string; text: string; at: string }

/** A network as the account reports it: whether its poller runs, its last poll, its last 409, whether the operator
 * blocked the bot, and while its polls fail since when and why (the account's words, which carry no token). */
export interface AccountNetworkStatus {
  network: string;
  polling: boolean;
  lastPollAt?: string;
  conflictAt?: string;
  blocked?: true;
  pollFailing?: { since: string; reason: string };
}

/** The account's phone, as each inbox answer carries it: the networks connected, the messages its outbox holds, and
 * how many senders Not you lists. */
export interface AccountPhoneStatus { networks: AccountNetworkStatus[]; queued: number; strangers: number }

/** What a send came to: the ids of the parts sent - with `queued` when the rest waits in the account's outbox - or all
 * of it queued there, or held back by the account (`quiet hours`, `not routed`, `nothing connected`) and never sent
 * later. A send the account refused outright, or could not be asked, rejects. */
export type PhoneSendResult = { sent: string[]; queued?: true } | { queued: true } | { held: string };

/** The account's inbox and send, as the face uses them. */
export interface PhoneClient {
  /** Send `text` as `kind`; `replyTo`, the message it answers; `network`, a `chat` reply's network. Rejects when the
   * account refused it (its own words) or did not answer (why). */
  send(kind: PhoneKind, text: string, opts?: { replyTo?: string; network?: string }): Promise<PhoneSendResult>;
  /** The messages numbered above `after`, waiting up to `waitS` seconds when there are none; `last`, the account's
   * highest number; `status`, its phone. Rejects when the account did not answer, or answered something else. */
  inbox(after: number, waitS: number, signal?: AbortSignal): Promise<{ messages: InboxMessage[]; last: number; status: AccountPhoneStatus }>;
}

/** A send's deadline. */
export const SEND_DEADLINE_MS = 30_000;
/** How much longer than its wait an inbox read may take before it is cut. */
export const INBOX_SLACK_MS = 10_000;

const isRecord = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const optString = (x: unknown): boolean => x === undefined || typeof x === "string";
/** The networks a phone message comes through (the account's `NETWORKS`). */
export const PHONE_NETWORKS: readonly string[] = ["telegram", "slack", "imessage"];
/** Whether `x` names one of {@link PHONE_NETWORKS}. */
export const isPhoneNetwork = (x: unknown): x is string => typeof x === "string" && PHONE_NETWORKS.includes(x);
/** A message's id on the wire: Telegram's message_id, Slack's `ts`, iMessage's chat GUID. The account's rule (account/src/portfolio/identity/kinds.ts
 * `WIRE_ID`), redeclared here byte for byte - the face does not import the account's package - and tied to it by
 * tests/phone-bridge.test.ts. */
export const WIRE_ID = /^(?:telegram:\d{1,16}|slack:\d{9,12}\.\d{6}|imessage:[^\s]{1,128})$/;

/** A failure as one line: its message, and the code it or its cause carries when the message does not say it. */
function reasonOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const own = (err as { code?: unknown }).code;
  const code = typeof own === "string" ? own : (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
}

/** `x` as an inbox message, or `undefined` when it is not one. */
function messageOf(x: unknown): InboxMessage | undefined {
  if (!isRecord(x)) return undefined;
  const { id, network, messageId, replyTo, text, at } = x;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) return undefined;
  if (typeof network !== "string" || typeof messageId !== "string" || !WIRE_ID.test(messageId) || !messageId.startsWith(`${network}:`)) return undefined;
  if (replyTo !== undefined && (typeof replyTo !== "string" || !WIRE_ID.test(replyTo))) return undefined;
  if (typeof text !== "string" || typeof at !== "string" || Number.isNaN(Date.parse(at))) return undefined;
  return { id, network, messageId, ...(replyTo === undefined ? {} : { replyTo }), text, at };
}

/** `x` as the account's phone status; a malformed network is left out, a malformed count is 0. */
function statusOf(x: unknown): AccountPhoneStatus {
  const s = isRecord(x) ? x : {};
  const count = (n: unknown): number => (typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0);
  const networks: AccountNetworkStatus[] = [];
  for (const n of Array.isArray(s.networks) ? s.networks : []) {
    if (!isRecord(n) || typeof n.network !== "string" || typeof n.polling !== "boolean") continue;
    if (!optString(n.lastPollAt) || !optString(n.conflictAt)) continue;
    const failing = isRecord(n.pollFailing) && typeof n.pollFailing.since === "string" && typeof n.pollFailing.reason === "string"
      ? { since: n.pollFailing.since, reason: n.pollFailing.reason } : undefined;
    networks.push({
      network: n.network, polling: n.polling,
      ...(typeof n.lastPollAt === "string" ? { lastPollAt: n.lastPollAt } : {}),
      ...(typeof n.conflictAt === "string" ? { conflictAt: n.conflictAt } : {}),
      ...(n.blocked === true ? { blocked: true as const } : {}),
      ...(failing === undefined ? {} : { pollFailing: failing }),
    });
  }
  return { networks, queued: count(s.queued), strangers: count(s.strangers) };
}

/** Every spelling of each of `secrets` (src/desk-tools.ts `secretSpellings`) made `<secret>`, the longest first. */
function redactorOf(secrets: readonly string[]): (text: string) => string {
  const spellings = [...new Set(secrets.flatMap((s) => secretSpellings(s)))].sort((a, b) => b.length - a.length);
  return (text) => spellings.reduce((out, spelling) => out.split(spelling).join("<secret>"), text);
}

/**
 * The account's inbox and send at `url` (the `mcp-account` row's service, as src/account-proxy.ts reads it).
 * - `send` posts `{kind, text, replyTo?, network?}` - the text redacted of `secrets` first - cut at 30 s, and reads the
 *   body: `{ok: true, sent, queued?}`, `{ok: true, queued: true}` and `{ok: true, held}` are its answers; `{ok: false,
 *   error}` rejects with the account's words; anything else - no answer, a body that is none of these, whatever its
 *   status - rejects with why.
 * - `inbox` reads `?after=<after>&wait=<waitS>`, cut at `waitS` + 10 s or at `signal`; a message that is not one is
 *   left out (the caller's cursor still moves past it, to `last`).
 * @param o - `url`; `fetch`, the global one by default; `secrets`, the values redacted, src/desk-tools.ts `deskSecrets`
 *   of `process.env` taken now unless given.
 */
export function createPhoneClient(o: { url: string; fetch?: typeof fetch; secrets?: readonly string[] }): PhoneClient {
  const base = o.url.replace(/\/+$/, "");
  const fetchImpl = o.fetch ?? fetch;
  const redact = redactorOf(o.secrets ?? deskSecrets(process.env));

  /** One request to the account, cut at `deadlineMs` or at `signal`; resolves the parsed body and the status. */
  const call = async (path: string, init: RequestInit, deadlineMs: number, signal?: AbortSignal): Promise<{ status: number; body: unknown }> => {
    const request = new AbortController();
    const stop = (): void => { request.abort(signal?.reason); };
    if (signal?.aborted === true) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => { request.abort(new Error(`the account did not answer in ${deadlineMs / 1_000} s`)); }, deadlineMs);
    try {
      let res: Response;
      try {
        res = await fetchImpl(`${base}${path}`, { ...init, signal: request.signal });
      } catch (err) {
        throw request.signal.aborted && request.signal.reason instanceof Error ? request.signal.reason : err;
      }
      let body: unknown;
      try {
        body = JSON.parse(await res.text());
      } catch {
        if (request.signal.aborted && request.signal.reason instanceof Error) throw request.signal.reason;
        body = undefined;
      }
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  };

  return {
    async send(kind, text, opts = {}) {
      const body = JSON.stringify({
        kind, text: redact(text),
        ...(opts.replyTo === undefined ? {} : { replyTo: opts.replyTo }),
        ...(opts.network === undefined ? {} : { network: opts.network }),
      });
      let answer: { status: number; body: unknown };
      try {
        answer = await call("/api/account/identity/send", { method: "POST", headers: { "content-type": "application/json" }, body }, SEND_DEADLINE_MS);
      } catch (err) {
        throw new Error(`the account could not be asked: ${reasonOf(err)}`);
      }
      const b = answer.body;
      if (isRecord(b) && b.ok === true) {
        if (typeof b.held === "string") return { held: b.held };
        if (Array.isArray(b.sent) && b.sent.every((id) => typeof id === "string")) {
          return { sent: b.sent as string[], ...(b.queued === true ? { queued: true as const } : {}) };
        }
        if (b.queued === true) return { queued: true };
      }
      if (isRecord(b) && b.ok === false && typeof b.error === "string") throw new Error(b.error);
      throw new Error(`the account answered HTTP ${answer.status} with no send's answer`);
    },

    async inbox(after, waitS, signal) {
      const { status, body } = await call(`/api/account/identity/inbox?after=${after}&wait=${waitS}`, { method: "GET" }, waitS * 1_000 + INBOX_SLACK_MS, signal);
      if (!isRecord(body) || body.ok !== true || !Array.isArray(body.messages)
        || typeof body.last !== "number" || !Number.isSafeInteger(body.last) || body.last < 0) {
        const said = isRecord(body) && typeof body.error === "string" ? `: ${body.error}` : "";
        throw new Error(`the account answered HTTP ${status} with no inbox${said}`);
      }
      const messages = body.messages.flatMap((m) => {
        const read = messageOf(m);
        return read === undefined ? [] : [read];
      }).sort((a, b) => a.id - b.id);
      return { messages, last: body.last, status: statusOf(body.status) };
    },
  };
}
