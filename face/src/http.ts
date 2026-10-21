/** The HTTP primitives every `/data/*` route family shares: one error shape,
 * one body reader, one refusal body, one JSON answer, and the fenced GET and
 * POST shells.
 *
 * These lived in strategies.ts because that was the first route family; they
 * were never about strategies. sessions.ts, panels.ts and channels.ts all
 * throw the same error and read bodies the same way, so the home is here.
 * The module imports nothing of the face's own, so that every route module
 * can import it; a route's fence is therefore a parameter ({@link fencedGet}).
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
 * data.ts's `isTrustedDataRequest`, and data.ts reaches this module through
 * quotes.ts and symbol-search.ts, so importing it here would close a cycle.
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

/** Whether a request declares a JSON body - data.ts's `isJsonBody`, restated for the reason
 * {@link fencedGet} takes its fence as a parameter: importing data.ts here would close a cycle. */
function declaresJson(req: IncomingMessage): boolean {
  return (req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json");
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
    if (!declaresJson(req)) return send(res, 415, { ok: false, error: "application/json only" });
    try {
      return send(res, 200, { ok: true, ...(await act(await readObject(req))) });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
      return send(res, 500, { ok: false, error: "request failed" });
    }
  };
}
