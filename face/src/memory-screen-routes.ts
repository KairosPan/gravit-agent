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
 * unknown one is a 400; a method other than GET a 405; no screen bound a 503. A read that faulted is a 502 and one log
 * line in `memoryFaultWords`' words; one past its bound a 504 and one log line. No route echoes anything the caller
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
          return send(res, 200, { ok: true, ...(await read(screen, req)) });
        } catch (err) {
          if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
          if (err instanceof ScreenFault) {
            deps.log(err.why === "late"
              ? `memory screen: ${path} - ${err.message}`
              : `memory screen: ${path} - ${err.message}: ${memoryFaultWords(err.cause)}`);
            return send(res, err.why === "late" ? 504 : 502, { ok: false, error: err.message });
          }
          return send(res, 500, { ok: false, error: "request failed" });
        }
      },
    });
  };

  route("/data/memory/lessons", (screen, req) => { paramsOf(req, []); return screen.lessons(); });
  route("/data/memory/decisions", (screen, req) => screen.decisions(decisionsFilter(req)));
  route("/data/memory/review", (screen, req) => { paramsOf(req, []); return screen.waiting(); });
  route("/data/memory/status", (screen, req) => { paramsOf(req, []); return screen.health(); });
}
