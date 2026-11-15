/** The memory gate's two routes (src/memory-gate.ts): the read an order card draws its lessons from, and the owner's
 * override of a red line, both behind the `/data` fence ({@link isTrustedDataRequest}).
 *
 * `GET /data/memory/gate?callId=` answers `{ok: true, gate}`, the kept view of that call's check; a callId missing,
 * repeated or outside the gate's grammar is a 400, a call the gate holds no view of (or no gate bound) a 404.
 * `POST /data/memory/gate/override` takes `{callId, reason, wrongIf?}` - `reason` trimmed, 1 to 500 characters;
 * `wrongIf` a string of at most 500, trimmed, left out when empty - and answers `{ok: true}` once the override is
 * kept; a card the gate does not hold is a 404, one with no red line or already answered a 409. Neither route
 * echoes anything the caller sent.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError, fencedPost, isTrustedDataRequest, send } from "./http.ts";
import { CALL_ID, type GateOverride, type MemoryGate } from "./memory-gate.ts";
import type { RouteRegistrar } from "./static.ts";

/** Longest `reason` and `wrongIf`, after the trim. */
const WORDS_MAX = 500;

/** Longest request URL the read parses. */
const URL_MAX = 1024;

/** The body's callId, checked against the gate's grammar. */
function callIdOf(value: unknown): string {
  if (typeof value !== "string" || !CALL_ID.test(value)) throw new HttpError(400, "callId is required");
  return value;
}

/** The override's words, trimmed and bounded. */
function overrideOf(body: Record<string, unknown>): GateOverride {
  const { reason, wrongIf } = body;
  if (typeof reason !== "string") throw new HttpError(400, `reason must be a string of 1 to ${WORDS_MAX} characters`);
  const said = reason.trim();
  if (said.length < 1 || said.length > WORDS_MAX) throw new HttpError(400, `reason must be a string of 1 to ${WORDS_MAX} characters`);
  if (wrongIf === undefined) return { reason: said };
  if (typeof wrongIf !== "string") throw new HttpError(400, `wrongIf must be a string of at most ${WORDS_MAX} characters`);
  const wrong = wrongIf.trim();
  if (wrong.length > WORDS_MAX) throw new HttpError(400, `wrongIf must be a string of at most ${WORDS_MAX} characters`);
  return wrong === "" ? { reason: said } : { reason: said, wrongIf: wrong };
}

/**
 * Mount `GET /data/memory/gate` and `POST /data/memory/gate/override`.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - `gate`, the memory gate as bound now (undefined: none, every answer a 404); `isTrusted`, the fence.
 */
export function registerMemoryGateRoutes(
  webServer: RouteRegistrar,
  deps: { gate: () => MemoryGate | undefined; isTrusted?: typeof isTrustedDataRequest },
): void {
  const isTrusted = deps.isTrusted ?? isTrustedDataRequest;

  webServer.register({
    kind: "exact",
    path: "/data/memory/gate",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isTrusted(req)) return send(res, 403, FORBIDDEN);
      if (req.method !== "GET") return send(res, 405, { ok: false, error: "GET only" });
      try {
        const rawUrl = req.url ?? "";
        if (rawUrl.length > URL_MAX || /%(?![a-f\d]{2})/i.test(rawUrl)) throw new HttpError(400, "callId is required");
        const ids = new URL(rawUrl, "http://localhost").searchParams.getAll("callId");
        if (ids.length !== 1) throw new HttpError(400, "callId is required");
        const callId = callIdOf(ids[0]);
        const view = deps.gate()?.view(callId);
        if (view === undefined) throw new HttpError(404, "no such card");
        return send(res, 200, { ok: true, gate: view });
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
        return send(res, 500, { ok: false, error: "request failed" });
      }
    },
  });

  webServer.register({
    kind: "exact",
    path: "/data/memory/gate/override",
    handler: fencedPost(isTrusted, (body) => {
      const callId = callIdOf(body.callId);
      const words = overrideOf(body);
      const gate = deps.gate();
      if (gate === undefined) throw new HttpError(404, "no such card");
      const kept = gate.override(callId, words);
      if (kept === "no such card") throw new HttpError(404, "no such card");
      if (kept === "no red line") throw new HttpError(409, "no red line applies to this card");
      if (kept === "answered") throw new HttpError(409, "the card is already answered");
      return {};
    }),
  });
}
