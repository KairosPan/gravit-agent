/** The routines' routes, the Desk page's and the routine card's and nothing else's: `GET /data/desk/routines`, the
 * clock row's status (src/routine-clock.ts), or - with the desk off, or before the clock row has loaded - the store's
 * alone, each routine with its when line and no runs; both forms carry every proposal the store holds
 * ({@link proposalViews}). Three acts through src/routines.ts on a routine, `POST /data/desk/routines/switch { id,
 * enabled }` → `{ routine }`, `POST /data/desk/routines/test { id }` → `{ result }` and `POST
 * /data/desk/routines/delete { id }` → `{}`; and the card's two answers on a proposal, `POST
 * /data/desk/routines/confirm { proposal }` → `{ routine, proposal }` - a second confirm of a confirmed proposal
 * answers the same, changing nothing - and `POST /data/desk/routines/dismiss { proposal }` → `{ proposal }`. A test
 * needs the clock row: with none it is `409 paused`, since nothing runs while the desk is off; a confirmed routine
 * needs none, the clock row picking it up at its next tick.
 *
 * Refusals: a body whose `id` is not a routine's id, or whose `proposal` is not a proposal's id, is `400` with a fixed
 * message that does not echo it; one whose `enabled` is no boolean `400`; an act's {@link RoutineError} answers by its
 * code - `invalid` and `state` 400, `unknown` 404, `limit` 409, `unreadable` 503 - its message as `error`, but a
 * confirm's `limit` says `limit` alone, the card wording it; a test's word `paused` or `cap` is 409, `unknown` 404;
 * anything else thrown (a lock that timed out) is http.ts's fixed 500. An unreadable store is never written over:
 * src/routines.ts refuses every act on it.
 *
 * Light by rule (tests/desk-weight.test.ts): src/desk.ts imports this module, so the clock row is named for its types
 * alone.
 * @module
 */
import type { IncomingMessage } from "node:http";
import { fencedGet, fencedPost, HttpError, isTrustedDataRequest } from "./http.ts";
import type { ProposalView, RoutineClock, RoutinesStatus, RoutineView } from "./routine-clock.ts";
import { whenText } from "./routine-schedule.ts";
import {
  DAILY_TOKENS_DEFAULT, isProposalId, isRoutineId, loadRoutines, RoutineError, type RoutineOps, type RoutineStore,
} from "./routines.ts";
import type { RouteRegistrar } from "./static.ts";

/** The status an act's refusal answers, by its code. */
const STATUS_OF: Record<RoutineError["code"], number> = { invalid: 400, state: 400, unknown: 404, limit: 409, unreadable: 503 };

/** The status a test's refusal answers, by the clock row's word. */
const TEST_STATUS: Record<"paused" | "cap" | "unknown", number> = { paused: 409, cap: 409, unknown: 404 };

/** `act`'s answer, a {@link RoutineError} turned into its {@link HttpError} - a `limit` saying `limit` alone when
 * `limitWord` is set; any other throw passes on. */
async function mapped<T>(act: () => Promise<T>, limitWord = false): Promise<T> {
  try {
    return await act();
  } catch (err) {
    if (err instanceof RoutineError) throw new HttpError(STATUS_OF[err.code], limitWord && err.code === "limit" ? "limit" : err.message);
    throw err;
  }
}

/** The body's `id`, which must be a routine's id; the refusal never echoes it. */
function idOf(body: Record<string, unknown>): string {
  if (!isRoutineId(body.id)) throw new HttpError(400, "id must be a routine's id");
  return body.id;
}

/** The body's `proposal`, which must be a proposal's id; the refusal never echoes it. */
function proposalOf(body: Record<string, unknown>): string {
  if (!isProposalId(body.proposal)) throw new HttpError(400, "proposal must be a proposal's id");
  return body.proposal;
}

/**
 * Every proposal `store` holds, as the page shows it, newest first by `proposedAt` (of two at one instant, the later
 * in the store first): its when line, the name of the routine it replaces while the store holds it, and - confirmed,
 * its routine held and on - that routine's next slot from `routines`. Light, so the clock row and the store-only read
 * share it.
 * @param store - the loaded store.
 * @param routines - the store's routines as the page shows them; a view with no `next` gives none.
 */
export function proposalViews(store: RoutineStore, routines: readonly RoutineView[]): ProposalView[] {
  const nameOf = new Map(store.routines.map((r) => [r.id, r.name]));
  const viewOf = new Map(routines.map((v) => [v.id, v]));
  return store.proposals
    .map((p, order) => ({ p, order }))
    .sort((a, b) => (a.p.proposedAt < b.p.proposedAt ? 1 : a.p.proposedAt > b.p.proposedAt ? -1 : b.order - a.order))
    .map(({ p }) => {
      const replacesName = p.replaces === undefined ? undefined : nameOf.get(p.replaces);
      const view = p.state === "confirmed" && p.routine !== undefined ? viewOf.get(p.routine) : undefined;
      const next = view?.enabled === true ? view.next : undefined;
      return {
        id: p.id, name: p.name, when: whenText(p.schedule), instruction: p.instruction,
        ...(p.note === undefined ? {} : { note: p.note }),
        ...(p.replaces === undefined ? {} : { replaces: p.replaces }),
        ...(replacesName === undefined ? {} : { replacesName }),
        state: p.state, proposedAt: p.proposedAt,
        ...(p.settledAt === undefined ? {} : { settledAt: p.settledAt }),
        ...(p.routine === undefined ? {} : { routine: p.routine }),
        ...(next === undefined ? {} : { next }),
      };
    });
}

/**
 * The page's read while there is no clock row: the store's load, its routines with their when lines and no runs, its
 * proposals with no next runs,
 * the store's cap - the default when the store cannot be read - with nothing used, nothing running, nothing queued.
 * @param home - the harness home.
 */
export async function storeStatus(home: string): Promise<RoutinesStatus> {
  const load = await loadRoutines(home);
  const routines: RoutineView[] = load.ok
    ? load.store.routines.map((r) => ({
      id: r.id, name: r.name, when: whenText(r.schedule), instruction: r.instruction, ...(r.note === undefined ? {} : { note: r.note }),
      enabled: r.enabled, sha256: r.sha256, confirmedAt: r.confirmedAt, runs: [],
    }))
    : [];
  return {
    load: load.ok ? { ok: true } : { ok: false, error: load.error },
    routines,
    proposals: load.ok ? proposalViews(load.store, routines) : [],
    cap: { dailyTokens: load.ok ? load.store.budget.dailyTokens : DAILY_TOKENS_DEFAULT, used: 0, spent: false },
    queued: [],
  };
}

/**
 * Mount the routines' read, its three acts and the card's two answers behind the browser fence, through http.ts's {@link fencedGet} and
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
  webServer.register({
    kind: "exact",
    path: "/data/desk/routines/confirm",
    handler: fencedPost(isTrusted, async (body) => {
      const proposal = proposalOf(body);
      return mapped(() => deps.ops.confirm(proposal), true);
    }),
  });
  webServer.register({
    kind: "exact",
    path: "/data/desk/routines/dismiss",
    handler: fencedPost(isTrusted, async (body) => {
      const proposal = proposalOf(body);
      return { proposal: await mapped(() => deps.ops.dismiss(proposal)) };
    }),
  });
}
