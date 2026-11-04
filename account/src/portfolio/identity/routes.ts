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
 *
 * Every route answers 404 "the account layer is not mounted" when the service holds no identity. The token is held in memory only
 * (pending.ts); it is in no answer, no log line and no ledger row. */
import type express from "express";
import type { Refusal } from "../../core/errors.ts";
import { isRefusal } from "../../core/errors.ts";
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
} as const;

const NOT_MOUNTED = "the account layer is not mounted";

/** what the routes need of the service's identity */
export interface IdentityRoutesHost {
  readonly pending: PendingConnections;
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
