/** THE IDENTITY ROUTES — the account's side of Account › Identity on the face.
 *
 *   POST /api/account/identity/telegram/token {token, keyHash, salt}   sheet 1's Next: the bot's token, ONCE, beside the fingerprint the
 *                                                                      page made (keyHash = hex sha256(salt ‖ token)). Read by its own
 *                                                                      reader, at most 1,024 bytes of application/json — the server's
 *                                                                      JSON parser skips this route in every spelling express routes to it
 *                                                                      (isIdentityTokenPath), so a body it could not read never becomes an
 *                                                                      error line carrying the token. Answers {ok: true, pending} or one of
 *                                                                      IDENTITY_WORDS' fixed sentences, none of which repeats what was sent
 *   POST /api/account/identity/slack/token {appToken, botToken,        the same for Slack: the app-level token and the bot token together,
 *                                     keyHash, salt}                   beside their one fingerprint (keyHash = hex sha256(salt ‖ appToken ‖
 *                                                                      NUL ‖ botToken)), under the same reader, limit and fence, answered
 *                                                                      in Slack's own fixed sentences
 *   POST /api/account/identity/imessage/token {projectId,              the same for iMessage through Photon: the project's ID and secret and
 *                       projectSecret, phone, keyHash, salt}           the operator's number, beside one fingerprint (keyHash = hex sha256(salt
 *                                                                      ‖ projectId ‖ NUL ‖ projectSecret)), under the same reader, limit and
 *                                                                      fence, answered in iMessage's own fixed sentences
 *   GET  /api/account/identity/pending?id=                             sheets 2 and 3: the pending connection as it stands
 *   POST /api/account/identity/pending/not-me {id}                     sheet 3's "Not me": the sender counted as a stranger, waiting again
 *   POST /api/account/identity/pending/drop {id}                       the sheet closed: the token forgotten at once
 *   GET  /api/account/identity                                         the Identity tab: networks, routing, quiet hours, Not you, and the
 *                                                                      Slack app manifest the owner pastes into Slack (slack-api.ts)
 *   GET  /api/account/identity/inbox?after=<n>&wait=<s>                the face's desk: the operator's messages numbered above n, waiting
 *                                                                      up to s seconds (0 to 25) for one; {ok, messages, last, status}.
 *                                                                      Unsigned, behind the account's fence; reading never changes it
 *   POST /api/account/identity/send {kind, text, replyTo?, network?}   the face's desk and watchdog: a message for the operator's phone —
 *                                                                      the account picks who receives it (identity.ts send): nothing in the
 *                                                                      body can name a chat. At most 65,536 bytes. Answers {ok, sent} (and
 *                                                                      queued when the rest waits), {ok, queued}, {ok, held}, or 502 when
 *                                                                      every network refused it outright. Unsigned, behind the fence
 *
 * Every route answers 404 "the account layer is not mounted" when the service holds no identity. The token is held in memory only
 * (pending.ts); it is in no answer, no log line and no ledger row. */
import type express from "express";
import type { Refusal } from "../../core/errors.ts";
import { isRefusal } from "../../core/errors.ts";
import type { InboxAnswer, IdentityView, SendAnswer, SendMessage } from "./identity.ts";
import { NETWORK_NAME, NETWORKS, PHONE_KINDS, WIRE_ID, type Network, type PhoneKind } from "./kinds.ts";
import type { PendingConnections, PendingView } from "./pending.ts";

export const IDENTITY_TOKEN_PATH = "/api/account/identity/telegram/token";
/** Slack's token route: the app-level token and the bot token, together, beside their one fingerprint */
export const SLACK_TOKEN_PATH = "/api/account/identity/slack/token";
/** iMessage's token route: the Photon project's ID and secret and the operator's number, beside one fingerprint */
export const IMESSAGE_TOKEN_PATH = "/api/account/identity/imessage/token";
const TOKEN_PATHS: ReadonlySet<string> = new Set([IDENTITY_TOKEN_PATH, SLACK_TOKEN_PATH, IMESSAGE_TOKEN_PATH]);
/** whether a request's path is one of the three token routes as express would match it: case and a trailing slash do not matter to
 * express, so they do not matter here either (as brain-keys.ts isBrainKeyPath) */
export const isIdentityTokenPath = (path: string): boolean => TOKEN_PATHS.has(path.toLowerCase().replace(/\/+$/, ""));
/** the most a token route reads of a body: two tokens, a 64-hex fingerprint and a 32-hex salt fit in a fraction of it */
export const IDENTITY_TOKEN_BODY_LIMIT = 1024;

/** a network connected already: a second connection to it is refused */
const connectedOn = (network: Network): string => `${NETWORK_NAME[network]} is connected already: Disconnect… it in Account › Identity first.`;
/** a network not connected: there is nothing to disconnect */
const notConnectedOn = (network: Network): string => `${NETWORK_NAME[network]} is not connected: there is nothing to disconnect.`;

const TELEGRAM_UNREACHABLE = "Telegram did not answer: nothing was kept. Try again in a minute.";
const SLACK_UNREACHABLE = "Slack did not answer: nothing was kept. Try again in a minute.";
const TELEGRAM_MISMATCH = "The token does not match its fingerprint: nothing was kept. Paste the token again.";
const SLACK_MISMATCH = "The two tokens do not match their fingerprint: nothing was kept. Paste both tokens again.";
const TELEGRAM_BOT_MISMATCH = "The bot signed is not the bot this connection checked with Telegram: nothing was written. Start again.";
const SLACK_BOT_MISMATCH = "The bot signed is not the bot this connection checked with Slack: nothing was written. Start again.";
const PHOTON_UNREACHABLE = "Photon did not answer: nothing was kept. Try again in a minute.";
const IMESSAGE_MISMATCH = "The project ID and secret do not match their fingerprint: nothing was kept. Paste them again.";
const IMESSAGE_BOT_MISMATCH = "The number signed is not the one this connection got from Photon: nothing was written. Start again.";

/** the identity routes' fixed sentences: none repeats anything that was sent (`connectedOn` and `notConnectedOn` name only the network;
 * the `…On(network)` ones pick the network's own sentence — Telegram's as B1 wrote them, Slack's beside them) */
export const IDENTITY_WORDS = {
  malformed: "This route takes one JSON object, {token, keyHash, salt}: what was sent is not that, and it was not kept.",
  tokenShape: "That is not a bot token: BotFather's token is digits, a colon, then letters. Nothing was kept.",
  mismatch: TELEGRAM_MISMATCH,
  refusedByTelegram: "Telegram does not know this token: nothing was kept. Copy it from BotFather again.",
  connectedOn,
  /** Telegram's connectedOn, by B1's name */
  connected: connectedOn("telegram"),
  noPending: "This connection is gone: it expired or was closed. Start again.",
  unreachable: TELEGRAM_UNREACHABLE,
  type: "This route takes application/json, sent as it is (no content encoding).",
  large: `This route takes at most ${IDENTITY_TOKEN_BODY_LIMIT} bytes: what was sent is larger, and it was not kept.`,
  needId: "This route takes {id}: the pending connection's id.",
  // the four owner types' refusals (identity.ts): at prepare and at the door alike
  networkUnknown: `That is not a network the account speaks on (${NETWORKS.join(", ")}).`,
  botMismatch: TELEGRAM_BOT_MISMATCH,
  senderMismatch: "The person signed is not the one heard on Say hi: nothing was written. Start again.",
  hashShape: "The signed fingerprint is 64 hex characters and its salt 32 (16 bytes), both lower-case: nothing was written.",
  tokenInField: "A bot token is never a signed field: only its fingerprint is. Nothing was written.",
  notConnectedOn,
  /** Telegram's notConnectedOn, by B1's name */
  notConnected: notConnectedOn("telegram"),
  routedNotConnected: "The routing ticks a network that is not connected: connect it first, or untick it.",
  quietTime: "Quiet hours are two times of day, HH:MM on New York's clock (23:00 and 07:00), or both empty for off.",
  quietEqual: "Quiet hours start and end at different times: both empty turns them off.",
  blockShape: "A sender is blocked by the reference Not you shows (12 hex characters) and their masked id (… and up to three digits or capitals).",
  blockMismatch: "That masked id is not the one Not you shows for this sender.",
  noIdentity: "This account keeps no identity: it is the account layer's.",
  inboxQuery: "This route takes after=<a whole number, 0 or more> and wait=<whole seconds, 0 to 25>.",
  send: `This route takes {kind, text, replyTo?, network?}: kind one of chat, alert, urgent, brief, report, card, fill, watchdog; replyTo <network>:<id>; network ${NETWORKS.join(" or ")}. The account picks who receives it.`,
  sendLarge: `This route takes at most ${65_536} bytes.`,
  // Slack's: its token route, its check (auth.test, bots.info, a socket's hello) and its signed fields
  slackMalformed: "This route takes one JSON object, {appToken, botToken, keyHash, salt}: what was sent is not that, and it was not kept.",
  slackTokenShape: "Those are not a Slack app's tokens: the first starts xapp-, the second xoxb-. Nothing was kept.",
  refusedBySlack: "Slack does not know this bot token: nothing was kept. Copy it from Install App again.",
  slackNoSocket: "Slack would not open a socket for the app-level token: give it the connections:write scope and turn Socket Mode on. Nothing was kept.",
  slackPairMismatch: "The two tokens belong to two different Slack apps: nothing was kept. Copy both from the same app.",
  slackUnreachable: SLACK_UNREACHABLE,
  slackMismatch: SLACK_MISMATCH,
  slackBotMismatch: SLACK_BOT_MISMATCH,
  slackTokenInField: "A Slack token is never a signed field: only the two tokens' fingerprint is. Nothing was written.",
  // iMessage's, through Photon: its token route, its check (the project, the number's registration) and its signed fields
  imessageMalformed: "This route takes one JSON object, {projectId, projectSecret, phone, keyHash, salt}: what was sent is not that, and it was not kept.",
  imessageShape: "That is not a Photon project and a phone number: the project ID and secret come from the project's Settings, and the number is written +, the country code, then the number (+14155550100). Nothing was kept.",
  refusedByPhoton: "Photon does not know this project and secret: nothing was kept. Copy both from the project's Settings again.",
  photonDedicated: "This Photon project has dedicated lines: Gravit uses the shared pool only. Use a project on the Free or Pro plan. Nothing was kept.",
  photonUserLimit: "This Photon project has no room for another user: remove one in Photon, or use another project. Nothing was kept.",
  photonNoNumber: "Photon has no free shared number for this phone: nothing was kept. Try again later.",
  photonUnreachable: PHOTON_UNREACHABLE,
  imessageMismatch: IMESSAGE_MISMATCH,
  imessageBotMismatch: IMESSAGE_BOT_MISMATCH,
  unreachableOn: (network: Network): string => (network === "slack" ? SLACK_UNREACHABLE : network === "imessage" ? PHOTON_UNREACHABLE : TELEGRAM_UNREACHABLE),
  mismatchOn: (network: Network): string => (network === "slack" ? SLACK_MISMATCH : network === "imessage" ? IMESSAGE_MISMATCH : TELEGRAM_MISMATCH),
  botMismatchOn: (network: Network): string => (network === "slack" ? SLACK_BOT_MISMATCH : network === "imessage" ? IMESSAGE_BOT_MISMATCH : TELEGRAM_BOT_MISMATCH),
} as const;

const NOT_MOUNTED = "the account layer is not mounted";

/** what the routes need of the service's identity */
export interface IdentityRoutesHost {
  readonly pending: PendingConnections;
  view(): IdentityView;
  inbox(after: number, waitMs: number, signal?: AbortSignal): Promise<InboxAnswer>;
  send(m: SendMessage): Promise<SendAnswer>;
}

export interface IdentityRoutesDeps {
  identity: () => IdentityRoutesHost | undefined;
  wrap: (fn: (req: express.Request, res: express.Response) => Promise<void> | void) => (req: express.Request, res: express.Response) => void;
  readSmall: (req: express.Request, limit: number) => Promise<Buffer | "large" | "broken">;
}

type TokenBody = { ok: true; token: string; keyHash: string; salt: string } | { ok: false };

/** the token route's body: exactly {token, keyHash, salt}, three strings — the buffer zeroed whatever it held */
export function parseTokenBody(raw: Buffer): TokenBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false };
  } finally {
    raw.fill(0);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
  const b = parsed as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.length !== 3 || !keys.every((k) => k === "token" || k === "keyHash" || k === "salt")) return { ok: false };
  if (typeof b.token !== "string" || typeof b.keyHash !== "string" || typeof b.salt !== "string") return { ok: false };
  return { ok: true, token: b.token, keyHash: b.keyHash, salt: b.salt };
}

type SlackTokenBody = { ok: true; appToken: string; botToken: string; keyHash: string; salt: string } | { ok: false };

/** Slack's token route's body: exactly {appToken, botToken, keyHash, salt}, four strings — the buffer zeroed whatever it held */
export function parseSlackTokenBody(raw: Buffer): SlackTokenBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false };
  } finally {
    raw.fill(0);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
  const b = parsed as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.length !== 4 || !keys.every((k) => k === "appToken" || k === "botToken" || k === "keyHash" || k === "salt")) return { ok: false };
  if (typeof b.appToken !== "string" || typeof b.botToken !== "string" || typeof b.keyHash !== "string" || typeof b.salt !== "string") return { ok: false };
  return { ok: true, appToken: b.appToken, botToken: b.botToken, keyHash: b.keyHash, salt: b.salt };
}

type ImessageTokenBody = { ok: true; projectId: string; projectSecret: string; phone: string; keyHash: string; salt: string } | { ok: false };
const IMESSAGE_KEYS: ReadonlySet<string> = new Set(["projectId", "projectSecret", "phone", "keyHash", "salt"]);

/** iMessage's token route's body: exactly {projectId, projectSecret, phone, keyHash, salt}, five strings — the buffer zeroed whatever it
 * held */
export function parseImessageTokenBody(raw: Buffer): ImessageTokenBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false };
  } finally {
    raw.fill(0);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
  const b = parsed as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.length !== IMESSAGE_KEYS.size || !keys.every((k) => IMESSAGE_KEYS.has(k))) return { ok: false };
  if (typeof b.projectId !== "string" || typeof b.projectSecret !== "string" || typeof b.phone !== "string" || typeof b.keyHash !== "string" || typeof b.salt !== "string") return { ok: false };
  return { ok: true, projectId: b.projectId, projectSecret: b.projectSecret, phone: b.phone, keyHash: b.keyHash, salt: b.salt };
}

/** the status a begin's refusal is answered with: a token of the wrong shape is the request's own fault (400), the network not answering
 * is a gateway's (502), everything else a conflict with what the account holds (409) */
function statusOf(r: Refusal): number {
  if (r.message === IDENTITY_WORDS.tokenShape || r.message === IDENTITY_WORDS.slackTokenShape || r.message === IDENTITY_WORDS.imessageShape) return 400;
  if (r.message === IDENTITY_WORDS.unreachable || r.message === IDENTITY_WORDS.slackUnreachable || r.message === IDENTITY_WORDS.photonUnreachable) return 502;
  if (r.message === IDENTITY_WORDS.noPending) return 404;
  return 409;
}

const idOf = (body: unknown): string | undefined => {
  const id = (body as { id?: unknown } | undefined)?.id;
  return typeof id === "string" && id !== "" && id.length <= 64 ? id : undefined;
};

/** the most a send's body may hold */
export const IDENTITY_SEND_LIMIT = 65_536;
const SEND_KEYS: ReadonlySet<string> = new Set(["kind", "text", "replyTo", "network"]);

/** a send's body: exactly the four keys a caller may give (no recipient), each of its type — or undefined */
function sendOf(body: unknown): SendMessage | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const b = body as Record<string, unknown>;
  if (!Object.keys(b).every((k) => SEND_KEYS.has(k))) return undefined;
  if (typeof b.kind !== "string" || !(PHONE_KINDS as readonly string[]).includes(b.kind) || typeof b.text !== "string") return undefined;
  if (b.replyTo !== undefined && (typeof b.replyTo !== "string" || !WIRE_ID.test(b.replyTo))) return undefined;
  if (b.network !== undefined && !(NETWORKS as readonly unknown[]).includes(b.network)) return undefined;
  return { kind: b.kind as PhoneKind, text: b.text, ...(b.replyTo !== undefined ? { replyTo: b.replyTo as string } : {}), ...(b.network !== undefined ? { network: b.network as Network } : {}) };
}

/** the longest an inbox read waits, in seconds */
const INBOX_WAIT_MAX_S = 25;

/** a query value as a whole number from `min` to `max` (absent: `min`), or undefined for anything else */
function wholeOf(v: unknown, min: number, max: number): number | undefined {
  if (v === undefined) return min;
  if (typeof v !== "string" || !/^\d{1,16}$/.test(v)) return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined;
}

export function registerIdentityRoutes(app: express.Express, deps: IdentityRoutesDeps): void {
  const { identity, wrap, readSmall } = deps;

  /** a token route: the type and encoding, its own reader of at most 1,024 bytes, its body's parser, then the network's begin (which
   * checks the shapes, then the fingerprint, then asks the network) */
  const tokenRoute = <B extends { ok: true }>(path: string, malformed: string, parse: (raw: Buffer) => B | { ok: false }, begin: (host: IdentityRoutesHost, body: B) => Promise<PendingView | Refusal>) =>
    app.post(path, wrap(async (req, res) => {
      const id = identity();
      if (!id) {
        req.resume();
        return void res.status(404).json({ ok: false, error: NOT_MOUNTED });
      }
      const type = String(req.headers["content-type"] ?? "").toLowerCase();
      const encoding = String(req.headers["content-encoding"] ?? "identity").toLowerCase();
      if (!/^application\/json\s*(;\s*charset="?utf-8"?\s*)?$/.test(type) || encoding !== "identity") {
        req.resume();
        return void res.status(415).json({ ok: false, error: IDENTITY_WORDS.type });
      }
      const raw = await readSmall(req, IDENTITY_TOKEN_BODY_LIMIT);
      if (raw === "large") return void res.status(413).json({ ok: false, error: IDENTITY_WORDS.large });
      if (raw === "broken") return void res.status(400).json({ ok: false, error: malformed });
      const body = parse(raw);
      if (!body.ok) return void res.status(400).json({ ok: false, error: malformed });
      const r = await begin(id, body as B);
      if (isRefusal(r)) return void res.status(statusOf(r)).json({ ok: false, error: r.message });
      res.json({ ok: true, pending: r });
    }));

  tokenRoute(IDENTITY_TOKEN_PATH, IDENTITY_WORDS.malformed, parseTokenBody, (id, b) => id.pending.begin(b.token, b.keyHash, b.salt));
  tokenRoute(SLACK_TOKEN_PATH, IDENTITY_WORDS.slackMalformed, parseSlackTokenBody, (id, b) => id.pending.beginSlack(b.appToken, b.botToken, b.keyHash, b.salt));
  tokenRoute(IMESSAGE_TOKEN_PATH, IDENTITY_WORDS.imessageMalformed, parseImessageTokenBody, (id, b) => id.pending.beginImessage(b.projectId, b.projectSecret, b.phone, b.keyHash, b.salt));

  // the Identity tab: the networks connected (no bot id, no operator id, no token), the routing, quiet hours and Not you
  app.get("/api/account/identity", wrap((_req, res) => {
    const id = identity();
    if (!id) return void res.status(404).json({ ok: false, error: NOT_MOUNTED });
    res.json(id.view());
  }));

  // the face's desk: the operator's messages, long-polled — the request gone, the wait ends
  app.get("/api/account/identity/inbox", wrap(async (req, res) => {
    const id = identity();
    if (!id) return void res.status(404).json({ ok: false, error: NOT_MOUNTED });
    const after = wholeOf(req.query.after, 0, Number.MAX_SAFE_INTEGER);
    const wait = wholeOf(req.query.wait, 0, INBOX_WAIT_MAX_S);
    if (after === undefined || wait === undefined) return void res.status(400).json({ ok: false, error: IDENTITY_WORDS.inboxQuery });
    const gone = new AbortController();
    res.on("close", () => gone.abort());
    const answer = await id.inbox(after, wait * 1000, gone.signal);
    if (!res.writableEnded && !res.destroyed) res.json(answer);
  }));

  // the face's desk and watchdog: a message for the operator's phone, its recipients the account's to pick
  app.post("/api/account/identity/send", wrap(async (req, res) => {
    const id = identity();
    if (!id) return void res.status(404).json({ ok: false, error: NOT_MOUNTED });
    const declared = Number(req.headers["content-length"]);
    const size = Number.isFinite(declared) && declared > 0 ? declared : Buffer.byteLength(JSON.stringify(req.body ?? null), "utf8");
    if (size > IDENTITY_SEND_LIMIT) return void res.status(413).json({ ok: false, error: IDENTITY_WORDS.sendLarge });
    const m = sendOf(req.body);
    if (!m) return void res.status(400).json({ ok: false, error: IDENTITY_WORDS.send });
    const answer = await id.send(m);
    if (!answer.ok) return void res.status(answer.error === IDENTITY_WORDS.send ? 400 : 502).json(answer);
    res.json(answer);
  }));

  app.get("/api/account/identity/pending", wrap((req, res) => {
    const id = identity();
    if (!id) return void res.status(404).json({ ok: false, error: NOT_MOUNTED });
    const q = req.query.id;
    const pid = typeof q === "string" ? idOf({ id: q }) : undefined;
    const view = pid ? id.pending.view(pid) : undefined;
    if (!view) return void res.status(404).json({ ok: false, error: IDENTITY_WORDS.noPending });
    res.json({ ok: true, pending: view });
  }));

  app.post("/api/account/identity/pending/not-me", wrap((req, res) => {
    const id = identity();
    if (!id) return void res.status(404).json({ ok: false, error: NOT_MOUNTED });
    const pid = idOf(req.body);
    if (!pid) return void res.status(400).json({ ok: false, error: IDENTITY_WORDS.needId });
    const view = id.pending.notMe(pid);
    if (!view) return void res.status(404).json({ ok: false, error: IDENTITY_WORDS.noPending });
    res.json({ ok: true, pending: view });
  }));

  app.post("/api/account/identity/pending/drop", wrap((req, res) => {
    const id = identity();
    if (!id) return void res.status(404).json({ ok: false, error: NOT_MOUNTED });
    const pid = idOf(req.body);
    if (!pid) return void res.status(400).json({ ok: false, error: IDENTITY_WORDS.needId });
    id.pending.drop(pid);
    res.json({ ok: true });
  }));
}
