/** THE IDENTITY ROUTES — the account's side of Account › Identity on the face.
 *
 *   POST /api/account/identity/telegram/token {token, keyHash, salt}   sheet 1's Next: the bot's token, ONCE, beside the fingerprint the
 *                                                                      page made (keyHash = hex sha256(salt ‖ token)). Read by its own
 *                                                                      reader, at most 1,024 bytes of application/json — the server's
 *                                                                      JSON parser skips this route in every spelling express routes to it
 *                                                                      (isIdentityTokenPath), so a body it could not read never becomes an
 *                                                                      error line carrying the token. Answers {ok: true, pending} or one of
 *                                                                      IDENTITY_WORDS' fixed sentences, none of which repeats what was sent
 *   GET  /api/account/identity/pending?id=                             sheets 2 and 3: the pending connection as it stands
 *   POST /api/account/identity/pending/not-me {id}                     sheet 3's "Not me": the sender counted as a stranger, waiting again
 *   POST /api/account/identity/pending/drop {id}                       the sheet closed: the token forgotten at once
 *   GET  /api/account/identity                                         the Identity tab: networks, routing, quiet hours, Not you
 *   GET  /api/account/identity/inbox?after=<n>&wait=<s>                the face's desk: the operator's messages numbered above n, waiting
 *                                                                      up to s seconds (0 to 25) for one; {ok, messages, last, status}.
 *                                                                      Unsigned, behind the account's fence; reading never changes it
 *
 * Every route answers 404 "the account layer is not mounted" when the service holds no identity. The token is held in memory only
 * (pending.ts); it is in no answer, no log line and no ledger row. */
import type express from "express";
import type { Refusal } from "../../core/errors.ts";
import { isRefusal } from "../../core/errors.ts";
import type { InboxAnswer, IdentityView } from "./identity.ts";
import type { PendingConnections } from "./pending.ts";

export const IDENTITY_TOKEN_PATH = "/api/account/identity/telegram/token";
/** whether a request's path is the token route as express would match it: case and a trailing slash do not matter to express, so they do
 * not matter here either (as brain-keys.ts isBrainKeyPath) */
export const isIdentityTokenPath = (path: string): boolean => path.toLowerCase().replace(/\/+$/, "") === IDENTITY_TOKEN_PATH;
/** the most the token route reads of a body: a token, a 64-hex fingerprint and a 32-hex salt fit in a fraction of it */
export const IDENTITY_TOKEN_BODY_LIMIT = 1024;

/** the identity routes' fixed sentences: none repeats anything that was sent */
export const IDENTITY_WORDS = {
  malformed: "This route takes one JSON object, {token, keyHash, salt}: what was sent is not that, and it was not kept.",
  tokenShape: "That is not a bot token: BotFather's token is digits, a colon, then letters. Nothing was kept.",
  mismatch: "The token does not match its fingerprint: nothing was kept. Paste the token again.",
  refusedByTelegram: "Telegram does not know this token: nothing was kept. Copy it from BotFather again.",
  connected: "Telegram is connected already: Disconnect… it in Account › Identity first.",
  noPending: "This connection is gone: it expired or was closed. Start again.",
  unreachable: "Telegram did not answer: nothing was kept. Try again in a minute.",
  type: "This route takes application/json, sent as it is (no content encoding).",
  large: `This route takes at most ${IDENTITY_TOKEN_BODY_LIMIT} bytes: what was sent is larger, and it was not kept.`,
  needId: "This route takes {id}: the pending connection's id.",
  // the four owner types' refusals (identity.ts): at prepare and at the door alike
  network: "Telegram is the one network the account speaks on for now.",
  botMismatch: "The bot signed is not the bot this connection checked with Telegram: nothing was written. Start again.",
  senderMismatch: "The person signed is not the one heard on Say hi: nothing was written. Start again.",
  hashShape: "The signed fingerprint is 64 hex characters and its salt 32 (16 bytes), both lower-case: nothing was written.",
  tokenInField: "A bot token is never a signed field: only its fingerprint is. Nothing was written.",
  notConnected: "Telegram is not connected: there is nothing to disconnect.",
  routedNotConnected: "The routing ticks a network that is not connected: connect it first, or untick it.",
  quietTime: "Quiet hours are two times of day, HH:MM on New York's clock (23:00 and 07:00), or both empty for off.",
  quietEqual: "Quiet hours start and end at different times: both empty turns them off.",
  blockShape: "A sender is blocked by the reference Not you shows (12 hex characters) and their masked id (… and up to three digits).",
  blockMismatch: "That masked id is not the one Not you shows for this sender.",
  noIdentity: "This account keeps no identity: it is the account layer's.",
  inboxQuery: "This route takes after=<a whole number, 0 or more> and wait=<whole seconds, 0 to 25>.",
} as const;

const NOT_MOUNTED = "the account layer is not mounted";

/** what the routes need of the service's identity */
export interface IdentityRoutesHost {
  readonly pending: PendingConnections;
  view(): IdentityView;
  inbox(after: number, waitMs: number, signal?: AbortSignal): Promise<InboxAnswer>;
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

/** the status a begin's refusal is answered with: a token of the wrong shape is the request's own fault (400), Telegram not answering is a
 * gateway's (502), everything else a conflict with what the account holds (409) */
function statusOf(r: Refusal): number {
  if (r.message === IDENTITY_WORDS.tokenShape) return 400;
  if (r.message === IDENTITY_WORDS.unreachable) return 502;
  if (r.message === IDENTITY_WORDS.noPending) return 404;
  return 409;
}

const idOf = (body: unknown): string | undefined => {
  const id = (body as { id?: unknown } | undefined)?.id;
  return typeof id === "string" && id !== "" && id.length <= 64 ? id : undefined;
};

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

  app.post(IDENTITY_TOKEN_PATH, wrap(async (req, res) => {
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
    if (raw === "broken") return void res.status(400).json({ ok: false, error: IDENTITY_WORDS.malformed });
    const body = parseTokenBody(raw);
    if (!body.ok) return void res.status(400).json({ ok: false, error: IDENTITY_WORDS.malformed });
    const r = await id.pending.begin(body.token, body.keyHash, body.salt);
    if (isRefusal(r)) return void res.status(statusOf(r)).json({ ok: false, error: r.message });
    res.json({ ok: true, pending: r });
  }));

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
