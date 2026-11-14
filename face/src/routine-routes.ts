/** The routines' routes, the Desk page's and nothing else's: `GET /data/desk/routines`, the clock row's status (src/
 * routine-clock.ts), or - with the desk off, or before the clock row has loaded - the store's alone, each routine with
 * its when line and no runs; and three acts through src/routines.ts, `POST /data/desk/routines/switch { id, enabled }`
 * → `{ routine }`, `POST /data/desk/routines/test { id }` → `{ result }` and `POST /data/desk/routines/delete { id }` →
 * `{}`. A test needs the clock row: with none it is `409 paused`, since nothing runs while the desk is off.
 *
 * Refusals: a body whose `id` is no string, or whose `enabled` is no boolean, is `400`; an act's {@link RoutineError}
 * answers by its code - `invalid` and `state` 400, `unknown` 404, `limit` 409, `unreadable` 503 - its message as
 * `error`; a test's word `paused` or `cap` is 409, `unknown` 404; anything else thrown (a lock that timed out) is
 * http.ts's fixed 500. An unreadable store is never written over: src/routines.ts refuses every act on it.
 *
 * Light by rule (tests/desk-weight.test.ts): src/desk.ts imports this module, so the clock row is named for its types
 * alone.
 * @module
 */
import type { IncomingMessage } from "node:http";
import { fencedGet, fencedPost, HttpError, isTrustedDataRequest } from "./http.ts";
import type { RoutineClock, RoutinesStatus } from "./routine-clock.ts";
import { whenText } from "./routine-schedule.ts";
import { DAILY_TOKENS_DEFAULT, loadRoutines, RoutineError, type RoutineOps } from "./routines.ts";
import type { RouteRegistrar } from "./static.ts";

/** The status an act's refusal answers, by its code. */
const STATUS_OF: Record<RoutineError["code"], number> = { invalid: 400, state: 400, unknown: 404, limit: 409, unreadable: 503 };

/** The status a test's refusal answers, by the clock row's word. */
const TEST_STATUS: Record<"paused" | "cap" | "unknown", number> = { paused: 409, cap: 409, unknown: 404 };

/** `act`'s answer, a {@link RoutineError} turned into its {@link HttpError}; any other throw passes on. */
async function mapped<T>(act: () => Promise<T>): Promise<T> {
  try {
    return await act();
  } catch (err) {
    if (err instanceof RoutineError) throw new HttpError(STATUS_OF[err.code], err.message);
    throw err;
  }
}

/** The body's `id`, which must be a string. */
function idOf(body: Record<string, unknown>): string {
  if (typeof body.id !== "string") throw new HttpError(400, "id must be a string");
  return body.id;
}

/**
 * The page's read while there is no clock row: the store's load, its routines with their when lines and no runs,
 * the store's cap - the default when the store cannot be read - with nothing used, nothing running, nothing queued.
 * @param home - the harness home.
 */
export async function storeStatus(home: string): Promise<RoutinesStatus> {
  const load = await loadRoutines(home);
  return {
    load: load.ok ? { ok: true } : { ok: false, error: load.error },
    routines: load.ok
      ? load.store.routines.map((r) => ({
        id: r.id, name: r.name, when: whenText(r.schedule), instruction: r.instruction, ...(r.note === undefined ? {} : { note: r.note }),
        enabled: r.enabled, sha256: r.sha256, confirmedAt: r.confirmedAt, runs: [],
      }))
      : [],
    cap: { dailyTokens: load.ok ? load.store.budget.dailyTokens : DAILY_TOKENS_DEFAULT, used: 0, spent: false },
    queued: [],
  };
}

/**
 * Mount the routines' read and its three acts behind the browser fence, through http.ts's {@link fencedGet} and
 * {@link fencedPost}.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - `ops`, the store's acts; `clock`, the clock row once it runs (`undefined` while the desk is off or
 *   before it has loaded), read on every request; `home`, the harness home the store-only read reads; `now`, unused
 *   by the routes themselves and kept for the deps' shape; `isTrusted`, the fence (default
 *   {@link isTrustedDataRequest}).
 * @throws when a path is already registered.
 */
export function registerRoutineRoutes(
  webServer: RouteRegistrar,
  deps: { ops: RoutineOps; clock: () => RoutineClock | undefined; home: string; now?: () => number; isTrusted?: (req: IncomingMessage) => boolean },
): void {
  const isTrusted = deps.isTrusted ?? isTrustedDataRequest;
  webServer.register({
    kind: "exact",
    path: "/data/desk/routines",
    handler: fencedGet(isTrusted, async () => {
      const clock = deps.clock();
      return clock === undefined ? storeStatus(deps.home) : clock.status();
    }),
  });
  webServer.register({
    kind: "exact",
    path: "/data/desk/routines/switch",
    handler: fencedPost(isTrusted, async (body) => {
      const id = idOf(body);
      if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be true or false");
      const enabled = body.enabled;
      return { routine: await mapped(() => deps.ops.setEnabled(id, enabled)) };
    }),
  });
  webServer.register({
    kind: "exact",
    path: "/data/desk/routines/test",
    handler: fencedPost(isTrusted, async (body) => {
      const id = idOf(body);
      const clock = deps.clock();
      const result = clock === undefined ? "paused" : await clock.test(id);
      if (result !== "queued") throw new HttpError(TEST_STATUS[result], result);
      return { result };
    }),
  });
  webServer.register({
    kind: "exact",
    path: "/data/desk/routines/delete",
    handler: fencedPost(isTrusted, async (body) => {
      const id = idOf(body);
      await mapped(() => deps.ops.remove(id));
      return {};
    }),
  });
}
