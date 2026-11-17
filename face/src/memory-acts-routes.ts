/** The owner's acts on the memory as routes (src/memory-acts.ts), each a POST behind the `/data` fence
 * ({@link isTrustedDataRequest}) with a JSON object body of at most {@link BODY_MAX} bytes:
 *
 * - `POST /data/memory/prepare` takes `{act, subject, words?}` and answers `{ok: true, show, draft}`: what the act acts
 *   on and the `attest` to sign;
 * - `POST /data/memory/act` takes `{act, subject, words?, envelope}` and answers `{ok: true, act, subject, ...}` once the
 *   Account said yes to the signed envelope and the memory did the act.
 *
 * The route parses and bounds the body; the acts check its fields. A method's refusal is answered with its own status
 * and `{ok: false, error}`, with `refusal` when it carries the Account's. Before a method runs: the fence's refusal a
 * 403, a method other than POST a 405, a body not declared JSON a 415, one past its bound a 413, one that is no JSON
 * object a 400, no acts bound a 503. A method that throws is a 500 with a fixed word and one log line. No route echoes
 * anything the caller sent or anything thrown.
 * @module
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError, isJsonBody, isTrustedDataRequest, readObject, send } from "./http.ts";
import { memoryFaultWords } from "./memory.ts";
import type { MemoryActs, Refused } from "./memory-acts.ts";
import type { RouteRegistrar } from "./static.ts";

/** Most bytes a route's body may carry. */
const BODY_MAX = 8_192;

const NOT_READY = "the memory's acts are not ready";
const FAILED = "the act failed";

/** A method's answer: its success, or its refusal. */
type Answer = { ok: true } | Refused;

/**
 * Mount `POST /data/memory/prepare` and `POST /data/memory/act`.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - `acts`, the acts as bound now (undefined: none, every answer a 503); `isTrusted`, the fence; `log`,
 *   one line a method that threw.
 */
export function registerMemoryActsRoutes(
  webServer: RouteRegistrar,
  deps: { acts: () => MemoryActs | undefined; isTrusted?: typeof isTrustedDataRequest; log?: (line: string) => void },
): void {
  const isTrusted = deps.isTrusted ?? isTrustedDataRequest;
  const log = deps.log ?? ((): void => {});

  const route = (path: string, run: (acts: MemoryActs, body: Record<string, unknown>) => Promise<Answer>): void => {
    webServer.register({
      kind: "exact",
      path,
      handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (!isTrusted(req)) return send(res, 403, FORBIDDEN);
        if (req.method !== "POST") return send(res, 405, { ok: false, error: "POST only" });
        if (!isJsonBody(req)) return send(res, 415, { ok: false, error: "application/json only" });
        let body: Record<string, unknown>;
        try {
          body = await readObject(req, BODY_MAX);
        } catch (err) {
          if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
          return send(res, 500, { ok: false, error: "request failed" });
        }
        const acts = deps.acts();
        if (acts === undefined) return send(res, 503, { ok: false, error: NOT_READY });
        let answer: Answer;
        try {
          answer = await run(acts, body);
        } catch (err) {
          log(`memory acts: ${path} - ${FAILED}: ${memoryFaultWords(err)}`);
          return send(res, 500, { ok: false, error: FAILED });
        }
        if (answer.ok) return send(res, 200, answer);
        const { status, error, refusal } = answer;
        return send(res, status, refusal === undefined ? { ok: false, error } : { ok: false, error, refusal });
      },
    });
  };

  route("/data/memory/prepare", (acts, body) => acts.prepare(body));
  route("/data/memory/act", (acts, body) => acts.perform(body));
}
