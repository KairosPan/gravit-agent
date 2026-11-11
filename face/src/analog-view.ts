/** `GET /data/analog/view`: one stored analog view for the browser client, read through the plugin's
 * `analogViews` service (`face/plugins/analog/views-row.mjs`, `readView`). The face imports nothing
 * from `plugins/`: the service arrives as a dep, and the id pattern it accepts is copied here.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";

/** A view id. Copied, not imported, from `VIEW_ID_RE` in `face/plugins/analog/lib/views.mjs`
 * (the face does not import from `plugins/`); `tests/analog-view-route.test.ts` pins the copy to its source. */
export const ANALOG_VIEW_ID_RE = /^an-\d{8}-[0-9a-f]{8}$/;

/** The slice of the `analogViews` service this route calls. */
export interface AnalogViewService {
  readView(id: string): Promise<unknown>;
}

export interface AnalogViewRouteDeps {
  isTrusted(req: IncomingMessage): boolean;
  /** The service as provided now, or undefined when the analog rows are not mounted. */
  views(): AnalogViewService | undefined;
}

/** A service refusal's code word, as the status and fixed body it answers with. */
const REFUSALS: Record<string, [number, string]> = {
  NO_SUCH_VIEW: [404, "no such view"],
  BAD_VIEW_ID: [400, "bad view id"],
};

/** The query, checked: `id` exactly once, matching {@link ANALOG_VIEW_ID_RE}. */
function parseViewRequest(rawUrl: string): { id: string } {
  if (rawUrl.length > 8192 || /%(?![a-f\d]{2})/i.test(rawUrl)) throw new HttpError(400, "invalid view request");
  const url = new URL(rawUrl, "http://localhost");
  if (url.searchParams.getAll("id").length !== 1) throw new HttpError(400, "id is required once");
  const id = url.searchParams.get("id")!;
  if (!ANALOG_VIEW_ID_RE.test(id)) throw new HttpError(400, "bad view id");
  return { id };
}

/** Mount the route. The fence runs first; nothing the caller sent and no service message is ever
 * echoed — a refusal answers fixed text by its code, anything else a fixed 500. */
export function registerAnalogViewRoute(webServer: RouteRegistrar, deps: AnalogViewRouteDeps): () => void {
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
    path: "/data/analog/view",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!deps.isTrusted(req)) return send(res, 403, FORBIDDEN);
      if (req.method !== "GET") return send(res, 405, { ok: false, error: "method not allowed" });
      try {
        const { id } = parseViewRequest(req.url ?? "");
        const service = deps.views();
        if (service === undefined) return send(res, 503, { ok: false, error: "analog not mounted" });
        const view = await service.readView(id);
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
