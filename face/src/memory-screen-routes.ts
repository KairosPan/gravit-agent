/** The memory screen's four reads as routes (src/memory-screen.ts), each a GET behind the `/data` fence
 * ({@link isTrustedDataRequest}) answering `{ok: true, ...read}`:
 *
 * - `GET /data/memory/lessons` - the lesson cards;
 * - `GET /data/memory/decisions?symbol=&before=&limit=` - the decisions, `symbol` of the package's shape
 *   (`MEMORY_SYMBOL`), `before` a decision id, `limit` 1 to 200, each at most once and only when given;
 * - `GET /data/memory/review` - the proposals and the decisions that wait for the owner;
 * - `GET /data/memory/status` - the home's health.
 *
 * Not connected is an answer, `ok: true` with `connected: false`. A parameter that does not fit, a repeated one or an
 * unknown one is a 400; a method other than GET a 405; no screen bound a 503; a `before` the memory does not know (the
 * package's `E_NOT_FOUND`) a 404. A read that faulted is a 502, with `why` - the package's sentence in
 * `memoryFaultWords`' words, one line of at most 200 characters - when its cause is an error that carries a code (a
 * file error such as `EACCES` among them); one past
 * its bound a 504; anything else thrown a 500 with a fixed word. A 502, a 504 and a 500 each log one line, logged again
 * for a path only when its words change or after a read of that path succeeded. No route echoes anything the caller
 * sent.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError, isTrustedDataRequest, send } from "./http.ts";
import { memoryFaultWords } from "./memory.ts";
import { MEMORY_SYMBOL } from "./memory-order.ts";
import { ScreenFault, type MemoryScreen } from "./memory-screen.ts";
import type { RouteRegistrar } from "./static.ts";

/** Longest request URL a route parses. */
const URL_MAX = 1024;
/** A decision id, as `before` names one. */
const DECISION_SHAPE = /^d-\d{8}-[0-9a-f]{8}$/;
/** A limit's digits: 1 to 200, no leading zero. */
const LIMIT_SHAPE = /^[1-9]\d{0,2}$/;
/** The most decisions one read asks for, as the package allows. */
const LIMIT_MAX = 200;

const BAD_QUERY = "the request's parameters do not fit";
const NOT_READY = "the memory screen is not ready";
const NO_SUCH_DECISION = "no such decision";
const DECISIONS_PATH = "/data/memory/decisions";

/** The code a fault's cause carries (the package's `E_…`, or a file error's), when it carries a string one. */
function codeOf(cause: unknown): string | undefined {
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** The query's parameters by name, each at most once and among `allowed`; anything else a 400. */
function paramsOf(req: IncomingMessage, allowed: readonly string[]): Map<string, string> {
  const rawUrl = req.url ?? "";
  if (rawUrl.length > URL_MAX || /%(?![a-f\d]{2})/i.test(rawUrl)) throw new HttpError(400, BAD_QUERY);
  let params: URLSearchParams;
  try {
    params = new URL(rawUrl, "http://localhost").searchParams;
  } catch {
    throw new HttpError(400, BAD_QUERY);
  }
  const out = new Map<string, string>();
  for (const [name, value] of params) {
    if (!allowed.includes(name) || out.has(name)) throw new HttpError(400, BAD_QUERY);
    out.set(name, value);
  }
  return out;
}

/** The decisions' filter from the query, each key only when given and fitting its shape. */
function decisionsFilter(req: IncomingMessage): { symbol?: string; before?: string; limit?: number } {
  const params = paramsOf(req, ["symbol", "before", "limit"]);
  const filter: { symbol?: string; before?: string; limit?: number } = {};
  const symbol = params.get("symbol");
  if (symbol !== undefined) {
    if (!MEMORY_SYMBOL.test(symbol)) throw new HttpError(400, BAD_QUERY);
    filter.symbol = symbol;
  }
  const before = params.get("before");
  if (before !== undefined) {
    if (!DECISION_SHAPE.test(before)) throw new HttpError(400, BAD_QUERY);
    filter.before = before;
  }
  const limit = params.get("limit");
  if (limit !== undefined) {
    if (!LIMIT_SHAPE.test(limit) || Number(limit) > LIMIT_MAX) throw new HttpError(400, BAD_QUERY);
    filter.limit = Number(limit);
  }
  return filter;
}

/**
 * Mount the four reads.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - `screen`, the screen as bound now (undefined: none, every answer a 503); `log`, one line a refusal;
 *   `isTrusted`, the fence.
 */
export function registerMemoryScreenRoutes(
  webServer: RouteRegistrar,
  deps: { screen: () => MemoryScreen | undefined; log: (line: string) => void; isTrusted?: typeof isTrustedDataRequest },
): void {
  const isTrusted = deps.isTrusted ?? isTrustedDataRequest;
  /** The last line logged for each path, kept until a read of that path succeeds. */
  const logged = new Map<string, string>();
  /** Logs `line` for `path` unless it is the line logged last for it. */
  const logOnce = (path: string, line: string): void => {
    if (logged.get(path) === line) return;
    logged.set(path, line);
    deps.log(line);
  };

  const route = (path: string, read: (screen: MemoryScreen, req: IncomingMessage) => Promise<object>): void => {
    webServer.register({
      kind: "exact",
      path,
      handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (!isTrusted(req)) return send(res, 403, FORBIDDEN);
        if (req.method !== "GET") return send(res, 405, { ok: false, error: "GET only" });
        try {
          const screen = deps.screen();
          if (screen === undefined) throw new HttpError(503, NOT_READY);
          const answer = await read(screen, req);
          logged.delete(path);
          return send(res, 200, { ok: true, ...answer });
        } catch (err) {
          if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
          if (err instanceof ScreenFault) {
            if (err.why === "late") {
              logOnce(path, `memory screen: ${path} - ${err.message}`);
              return send(res, 504, { ok: false, error: err.message });
            }
            const code = codeOf(err.cause);
            if (code === "E_NOT_FOUND" && path === DECISIONS_PATH) return send(res, 404, { ok: false, error: NO_SUCH_DECISION });
            const why = memoryFaultWords(err.cause);
            logOnce(path, `memory screen: ${path} - ${err.message}: ${why}`);
            return send(res, 502, code === undefined ? { ok: false, error: err.message } : { ok: false, error: err.message, why });
          }
          logOnce(path, `memory screen: ${path} - request failed: ${memoryFaultWords(err)}`);
          return send(res, 500, { ok: false, error: "request failed" });
        }
      },
    });
  };

  route("/data/memory/lessons", (screen, req) => { paramsOf(req, []); return screen.lessons(); });
  route(DECISIONS_PATH, (screen, req) => screen.decisions(decisionsFilter(req)));
  route("/data/memory/review", (screen, req) => { paramsOf(req, []); return screen.waiting(); });
  route("/data/memory/status", (screen, req) => { paramsOf(req, []); return screen.health(); });
}
