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
import type { IncomingMessage } from "node:http";

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
