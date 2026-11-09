/** The one roster's two routes (one-entry plan 4): the read Discover draws its
 * "Available to Gravit" switches from, and the switch itself.
 *
 * `GET /data/roster.json` answers `{ok: true, agents, bots}` - empty lists while
 * no file exists - or `{ok: false, corrupt: true}` for a file the face does not
 * understand, so the page can say the file needs repair rather than draw every
 * switch off. `POST /data/roster` takes `{kind: "agent" | "bot", id, on}` and
 * answers the roster as written; the store refuses a bot id outside the grammar
 * (400) and a corrupt or absent file (409), and each landed switch is one dated
 * line in the roster log.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError, fencedPost, isTrustedDataRequest, send } from "./http.ts";
import { logAvailable, readRoster, setAvailable } from "./roster.ts";
import type { RouteRegistrar } from "./static.ts";

/** Longest id a switch may carry: a bot id and an agent bin are both far shorter. */
const ID_MAX = 64;

/**
 * Mount `GET /data/roster.json` and `POST /data/roster`, both behind {@link isTrustedDataRequest}.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - `home`, the harness home holding `face/channels.json`.
 */
export function registerRosterRoutes(webServer: RouteRegistrar, deps: { home: string }): void {
  webServer.register({
    kind: "exact",
    path: "/data/roster.json",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
      try {
        const { roster, corrupt } = await readRoster(deps.home);
        if (corrupt) return send(res, 200, { ok: false, corrupt: true });
        return send(res, 200, { ok: true, agents: roster?.agents ?? [], bots: roster?.bots ?? [] });
      } catch {
        return send(res, 500, { ok: false, error: "request failed" });
      }
    },
  });

  webServer.register({
    kind: "exact",
    path: "/data/roster",
    handler: fencedPost(isTrustedDataRequest, async (body) => {
      const { kind, id, on } = body;
      if (kind !== "agent" && kind !== "bot") throw new HttpError(400, 'kind must be "agent" or "bot"');
      if (typeof id !== "string" || id.length < 1 || id.length > ID_MAX) {
        throw new HttpError(400, `id must be a string of 1 to ${ID_MAX} characters`);
      }
      if (typeof on !== "boolean") throw new HttpError(400, "on must be true or false");
      const roster = await setAvailable(deps.home, kind, id, on);
      await logAvailable(deps.home, kind, id, on);
      return { agents: roster.agents, bots: roster.bots };
    }),
  });
}
