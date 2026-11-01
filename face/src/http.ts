/** The HTTP primitives every `/data/*` route family shares: the browser-trust
 * fence ({@link isTrustedDataRequest}, {@link isLoopbackHost},
 * {@link isJsonBody}), one error shape, one body reader, one refusal body.
 *
 * These lived in strategies.ts because that was the first route family; they
 * were never about strategies. sessions.ts, panels.ts and channels.ts all
 * throw the same error and read bodies the same way, so the home is here. The
 * fence lived in data.ts beside the face's own producer routes until those
 * left (graft stage 3); every `/data` route imports it from here.
 *
 * These routes sit behind the same DNS-rebinding fence the harness's `/api`
 * routes get from dsh-client-connection, restated here because that fence
 * covers `/api` only and `/data/account` carries the operator's positions and
 * orders.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/** Body of a refused (non-loopback) request. Fixed text: a refusal never
 * echoes anything the caller sent, including the Host it forged. */
export const FORBIDDEN = '{"ok":false,"error":"forbidden"}';

/** Most bytes a POST body may carry by default; ids and names need far
 * fewer, and a route carrying prose (an agent prompt) names its own. */
const BODY_LIMIT = 4096;

/** An http status plus a fixed, operator-facing reason. Route handlers catch
 * it and answer with `{status, message}`; anything else becomes a generic
 * 500 so a filesystem error never reaches a response body. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Re-serve a cached body flagged `stale: true`, so the client can say so.
 * An unparseable body is passed through unchanged rather than replaced by an
 * error: it was served as a good payload once, and the flag is the only thing
 * being added. The Account proxy's kept answers (account-proxy.ts) use it. */
export function markStale(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    parsed.stale = true;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

/** Collect a request body up to `limit` bytes (default {@link BODY_LIMIT});
 * longer is refused with a 413 before the bytes are kept. */
export async function readBody(req: IncomingMessage, limit: number = BODY_LIMIT): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new HttpError(413, "body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Answer JSON: `status` with the JSON content type, and `body` written as it
 * is when it is a string (a fixed body such as {@link FORBIDDEN}), else
 * `JSON.stringify`'d. */
export function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/**
 * The fenced GET shell: a route handler that answers `{ ok: true, ...read() }`.
 *
 * The fence runs first, so a refused request reads nothing; it is answered
 * `403` with the fixed {@link FORBIDDEN} body. A read that throws an
 * {@link HttpError} answers its status and message; anything else is a `500`
 * with a fixed message, so a filesystem error never reaches a body. This is
 * panels.ts's `get` with the fence as a parameter: the face's fence is
 * {@link isTrustedDataRequest} in this module, a parameter so a test can pass its own.
 * @param isTrusted - the fence: true when the request may be served.
 * @param read - the answer's fields, sync or async.
 * @returns the `(req, res)` handler a route registers.
 */
export function fencedGet(
  isTrusted: (req: IncomingMessage) => boolean,
  read: () => Promise<object> | object,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!isTrusted(req)) return send(res, 403, FORBIDDEN);
    try {
      return send(res, 200, { ok: true, ...(await read()) });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
      return send(res, 500, { ok: false, error: "request failed" });
    }
  };
}

/** What a POST body that is no JSON object is answered with. */
const NOT_AN_OBJECT = "body must be a JSON object";

/** The request's body as the JSON object it must be: {@link readBody}'s `413` past its limit, and a
 * `400` for a body that does not parse, or parses as anything but an object - `null`, an array, a
 * number, a string, a boolean. */
async function readObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, NOT_AN_OBJECT);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, NOT_AN_OBJECT);
  return parsed as Record<string, unknown>;
}

/**
 * The fenced POST shell: a route handler that answers `{ ok: true, ...act(body) }`.
 *
 * Refusals come in order, each before the body is read: the fence, `403` with the fixed
 * {@link FORBIDDEN} body; a method other than `POST`, `405`; a body not declared
 * `application/json`, `415` - a cross-site "simple" POST can carry only text/plain or form media
 * types without a preflight the face never answers, so the media type is the fence's other half,
 * as it is on every POST route the face has (channels.ts `guardPost`, room.ts, sessions.ts). Then
 * the body: past {@link readBody}'s limit, `413`; not a JSON object, `400`. `act` runs on the
 * parsed object only after all of that; an {@link HttpError} it throws answers its status and
 * message, anything else a `500` with a fixed message, so no error text reaches a body.
 * @param isTrusted - the fence: true when the request may be served.
 * @param act - what the route does with the body, sync or async; its answer's fields follow `ok`.
 * @returns the `(req, res)` handler a route registers.
 */
export function fencedPost(
  isTrusted: (req: IncomingMessage) => boolean,
  act: (body: Record<string, unknown>) => Promise<object> | object,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!isTrusted(req)) return send(res, 403, FORBIDDEN);
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "POST only" });
    if (!isJsonBody(req)) return send(res, 415, { ok: false, error: "application/json only" });
    try {
      return send(res, 200, { ok: true, ...(await act(await readObject(req))) });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
      return send(res, 500, { ok: false, error: "request failed" });
    }
  };
}
/**
 * Whether a `Host` header names this loopback face.
 *
 * The DNS-rebinding fence: a rebound page reaches this socket while its Host
 * header still names the attacker's domain, and Host is the one header that
 * rebinding cannot forge. Deliberately the SAME hostname predicate
 * dsh-client-connection applies to `/api` (`isLoopbackHostname`, 0.1.1-rc.2
 * lib/index.js:100-104) — `localhost`, `[::1]`, any `127.x.x.x` — so the face
 * has one trust boundary rather than two that can drift apart. It is HALF of
 * that boundary: the `/api` gate (`isTrustedApiRequest`) also refuses
 * cross-site browser requests, and {@link isTrustedDataRequest} restates that
 * half for every `/data` route. Parsing is WHATWG's, which strips the
 * port, lowercases, and brackets IPv6 for us; anything unparsable, and a
 * MISSING Host, is refused (fail closed).
 * @param host - the raw `Host` header, or `undefined` when absent.
 * @returns true when the request may be served.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  /* An unbracketed `::1` is not legal on the wire and does not survive URL
   * parsing; accepted anyway rather than left as a spelling that fails closed
   * for a genuinely local caller. */
  if (host.trim() === "::1") return true;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127"
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * The face's browser-trust fence for `/data` — the harness's
 * `isTrustedApiRequest` (dsh-client-connection lib/index.js:184-198) restated:
 * a loopback Host, no Fetch-Metadata `cross-site`, and a present `Origin`
 * whose authority matches the Host. The second confused-deputy path the
 * hostname check alone leaves open is a cross-site page on the operator's
 * own browser POSTing to 127.0.0.1:3090 — the browser sets the loopback Host
 * itself, so only Origin / Sec-Fetch-Site tell that request from the face's
 * own page. A request with no Origin (curl, the tests, same-origin GETs in
 * older browsers) passes on Host alone, as the harness's does.
 * @param req - the incoming request; only its headers are read.
 */
export function isTrustedDataRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!isLoopbackHost(host)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === new URL(`http://${host}`).host;
  } catch {
    return false;
  }
}

/**
 * The fence for the one route a venue's page sends the browser back to, the
 * OAuth sign-in's callback (`/data/account/signin/callback`, account-proxy.ts):
 * a loopback Host, a GET, a top-level document navigation (`Sec-Fetch-Mode:
 * navigate`, `Sec-Fetch-Dest: document`) and no `Origin` — a browser sends
 * none on a top-level GET navigation, while a script's `fetch()` or a form's
 * POST carries its mode, its destination or its Origin. Any `Sec-Fetch-Site`
 * passes: the venue's page sends `cross-site`. Used by that route alone;
 * {@link isTrustedDataRequest} is every other route's fence.
 * @param req - the incoming request; only its method and headers are read.
 */
export function isTrustedNavigation(req: IncomingMessage): boolean {
  return isLoopbackHost(req.headers.host)
    && req.method === "GET"
    && req.headers["sec-fetch-mode"] === "navigate"
    && req.headers["sec-fetch-dest"] === "document"
    && req.headers.origin === undefined;
}

/**
 * Whether a request declares a JSON body. The POST shells refuse anything else
 * with 415: a cross-site "simple" POST can carry only text/plain or form
 * media types without a CORS preflight the face never answers, so requiring
 * `application/json` is the other half of the browser fence — the same reason
 * the harness's `/api` answers 415 to other media types (fetch/handler.js).
 * The face's own client sends it on every POST.
 * @param req - the incoming request; only its content-type is read.
 */
export function isJsonBody(req: IncomingMessage): boolean {
  return (req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json");
}
