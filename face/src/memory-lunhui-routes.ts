/** `GET /data/memory/lunhui?strategy=&run=`: a Lunhui run's lessons for the browser client, through the store of
 * src/memory-lunhui.ts - kept, or asked now when the run is fresh and was never asked. The query is checked as
 * src/lunhui-view.ts checks its own, and the runs service's refusals answer that route's fixed texts.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError } from "./http.ts";
import type { LunhuiLessonsStore } from "./memory-lunhui.ts";
import type { RouteRegistrar } from "./static.ts";

export interface MemoryLunhuiRouteDeps {
  /** The store, or undefined when there is none. */
  store: () => LunhuiLessonsStore | undefined;
  isTrusted: (req: IncomingMessage) => boolean;
}

/** A refusal's code word, as the status and fixed body it answers with. */
const REFUSALS: Record<string, [number, string]> = {
  NOT_A_STRATEGY: [404, "no such strategy"],
  NO_SUCH_RUN: [404, "no such run"],
  BAD_RUN_ID: [400, "bad run id"],
  MISSING_EVIDENCE: [409, "run not sealed"],
  NOT_MOUNTED: [503, "lunhui not mounted"],
};

/** The query, checked: `strategy` and `run` exactly once each. */
function parseLessonsRequest(rawUrl: string): { strategy: string; run: string } {
  if (rawUrl.length > 8192 || /%(?![a-f\d]{2})/i.test(rawUrl)) throw new HttpError(400, "invalid lessons request");
  const url = new URL(rawUrl, "http://localhost");
  const once = (name: string): string => {
    if (url.searchParams.getAll(name).length !== 1) throw new HttpError(400, `${name} is required once`);
    return url.searchParams.get(name)!;
  };
  return { strategy: once("strategy"), run: once("run") };
}

/** Mount the route. The fence runs first; nothing the caller sent and no error's message is ever echoed - a refusal
 * answers fixed text by its code, anything else a fixed 500. */
export function registerMemoryLunhuiRoute(webServer: RouteRegistrar, deps: MemoryLunhuiRouteDeps): void {
  const send = (res: ServerResponse, status: number, body: unknown): void => {
    let code = status;
    let text: string;
    try {
      text = typeof body === "string" ? body : JSON.stringify(body);
    } catch {
      code = 500;
      text = JSON.stringify({ ok: false, error: "response could not be serialized" });
    }
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(text);
  };
  webServer.register({
    kind: "exact",
    path: "/data/memory/lunhui",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!deps.isTrusted(req)) return send(res, 403, FORBIDDEN);
      if (req.method !== "GET") return send(res, 405, { ok: false, error: "method not allowed" });
      try {
        const { strategy, run } = parseLessonsRequest(req.url ?? "");
        const store = deps.store();
        if (store === undefined) return send(res, 503, { ok: false, error: "lunhui not mounted" });
        const lessons = await store.get(strategy, run);
        return send(res, 200, { ok: true, lessons });
      } catch (error) {
        if (error instanceof HttpError) return send(res, error.status, { ok: false, error: error.message });
        const code = (error as { code?: unknown } | null)?.code;
        const refusal = typeof code === "string" && Object.hasOwn(REFUSALS, code) ? REFUSALS[code] : undefined;
        if (refusal !== undefined) return send(res, refusal[0], { ok: false, error: refusal[1] });
        return send(res, 500, { ok: false, error: "lessons failed" });
      }
    },
  });
}
