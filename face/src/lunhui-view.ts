/** `GET /data/lunhui/view`: a sealed Lunhui run's view model for the browser client, read through the
 * plugin's `lunhuiRuns` service (`face/plugins/lunhui/runs-row.mjs`, `view`). The face imports nothing
 * from `plugins/`: the service arrives as a dep, and the module names it accepts are copied here.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";

/** The modules a view may be asked for. Copied, not imported, from `VIEW_MODULES` in
 * `face/plugins/lunhui/lib/view.mjs` (the face does not import from `plugins/`);
 * `tests/lunhui-view-route.test.ts` pins the copy to its source. */
export const LUNHUI_VIEW_MODULES: readonly string[] = Object.freeze(["environment", "sentiment", "theme", "counterevidence"]);

/** The slice of the `lunhuiRuns` service this route calls. */
export interface LunhuiViewService {
  view(strategy: string, run: string, options?: { modules?: string[] }): Promise<unknown>;
}

export interface LunhuiViewRouteDeps {
  isTrusted(req: IncomingMessage): boolean;
  /** The service as provided now, or undefined when the Lunhui rows are not mounted. */
  runs(): LunhuiViewService | undefined;
}

/** A service refusal's code word, as the status and fixed body it answers with. */
const REFUSALS: Record<string, [number, string]> = {
  NOT_A_STRATEGY: [404, "no such strategy"],
  NO_SUCH_RUN: [404, "no such run"],
  BAD_RUN_ID: [400, "bad run id"],
  MISSING_EVIDENCE: [409, "run not sealed"],
};

/** The query, checked: `strategy` and `run` exactly once each, `modules` at most once and every
 * comma-separated name one of {@link LUNHUI_VIEW_MODULES}; an empty `modules=` is no module at all
 * (`[]`), as a composition of a run with no market artifact records it. */
function parseViewRequest(rawUrl: string): { strategy: string; run: string; modules?: string[] } {
  if (rawUrl.length > 8192 || /%(?![a-f\d]{2})/i.test(rawUrl)) throw new HttpError(400, "invalid view request");
  const url = new URL(rawUrl, "http://localhost");
  const once = (name: string): string => {
    if (url.searchParams.getAll(name).length !== 1) throw new HttpError(400, `${name} is required once`);
    return url.searchParams.get(name)!;
  };
  const strategy = once("strategy");
  const run = once("run");
  const count = url.searchParams.getAll("modules").length;
  if (count === 0) return { strategy, run };
  if (count !== 1) throw new HttpError(400, "modules is given at most once");
  const raw = url.searchParams.get("modules")!;
  const modules = raw === "" ? [] : raw.split(",");
  if (!modules.every((name) => LUNHUI_VIEW_MODULES.includes(name))) throw new HttpError(400, "unknown module");
  return { strategy, run, modules };
}

/** Mount the route. The fence runs first; nothing the caller sent and no service message is ever
 * echoed — a refusal answers fixed text by its code, anything else a fixed 500. */
export function registerLunhuiViewRoute(webServer: RouteRegistrar, deps: LunhuiViewRouteDeps): () => void {
  /** Serialize first, then write the head (channels.ts's `send`): a body JSON.stringify refuses
   * answers one fixed 500 rather than a dead socket. */
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
    path: "/data/lunhui/view",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!deps.isTrusted(req)) return send(res, 403, FORBIDDEN);
      if (req.method !== "GET") return send(res, 405, { ok: false, error: "method not allowed" });
      try {
        const { strategy, run, modules } = parseViewRequest(req.url ?? "");
        const service = deps.runs();
        if (service === undefined) return send(res, 503, { ok: false, error: "lunhui not mounted" });
        const view = await service.view(strategy, run, modules === undefined ? {} : { modules });
        return send(res, 200, { ok: true, view });
      } catch (error) {
        if (error instanceof HttpError) return send(res, error.status, { ok: false, error: error.message });
        const code = (error as { code?: unknown } | null)?.code;
        const refusal = typeof code === "string" && Object.hasOwn(REFUSALS, code) ? REFUSALS[code] : undefined;
        if (refusal !== undefined) return send(res, refusal[0], { ok: false, error: refusal[1] });
        return send(res, 500, { ok: false, error: "view failed" });
      }
    },
  });
  return () => {};
}
