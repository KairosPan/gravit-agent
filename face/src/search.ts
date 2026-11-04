/** `GET /data/search`: the face's own index (`search-index.ts`) brought up to
 * date from the stored session logs at each search, then queried.
 *
 * The reconcile walks `sessionPersistence.list()`, keeps the face's own
 * top-level conversations ({@link indexedIds}) and reads each one's log only
 * from where the index last stopped: the mark's `readCount`, unless the
 * revision is unchanged (nothing to read) or the log is now shorter than what
 * was read (it was rewritten: `reset`, then read from 0). What a log said is
 * `search-text.ts` `linesOf`. A log that cannot be read is skipped and
 * counted, its mark kept, so one bad log never fails a search; a conversation
 * no longer kept (deleted, or gone from the listing) leaves the index.
 *
 * Reconciles run one at a time — each call waits for the one before it, then
 * runs once itself — so two searches at once never append the same events
 * twice. Nothing here imports dsh: `main.ts` hands in the persistence's
 * `list` and {@link readEventsFrom}. */

import { resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isHostPreset } from "./overlay.ts";
import { FORBIDDEN, isTrustedDataRequest, send } from "./http.ts";
import type { RouteRegistrar } from "./static.ts";
import { SEARCH_ITEMS_MAX, validQuery, type SearchIndex, type SearchResult } from "./search-index.ts";
import { linesOf, type StoredEvent } from "./search-text.ts";

/** One snapshot of `sessionPersistence.list()`, narrowed to what the reconcile reads. */
export interface StoredSession {
  header: { id: unknown; cwd?: string; parentSession?: unknown; origin?: string; agentPreset?: string };
  formatStatus?: "current" | "migration-required";
  revision: unknown;
  eventCount?: number;
}

export interface SearchDeps {
  /** The workbench repo root: a session whose cwd falls outside it is another project's. */
  root: string;
  list(): Promise<readonly StoredSession[]>;
  /** The log from offset `from` to its end. */
  read(sessionId: string, from: number): Promise<readonly StoredEvent[]>;
  /** The face's deleted ids (`sessions.ts` `readMeta(home).deleted`). */
  deleted(): Promise<ReadonlySet<string>>;
  index: SearchIndex;
}

/** How many events {@link readEventsFrom} asks for at a time, as `desk-session.ts`'s `LOG_PAGE`. */
const LOG_PAGE = 512;

const BAD_QUERY = '{"ok":false,"error":"query must be 1-500 characters"}';
const FAILED = '{"ok":false,"error":"search failed"}';

/** The host's preset: absent or empty counts as the host, as `client/js/wire/room.js` `isHost`. */
const isHost = (preset: unknown): boolean => typeof preset !== "string" || preset === "" || isHostPreset(preset);

const inside = (cwd: string | undefined, root: string): boolean => {
  if (typeof cwd !== "string") return false;
  const r = resolve(root);
  const c = resolve(cwd);
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
};

/**
 * The ids the index holds, in listing order: no subagent child (`origin`), a cwd inside `root`, not deleted, not a
 * log awaiting migration, and not a room member — by `client/js/wire/room.js` `foldMembers`' rule, a session with a
 * string `parentSession`, a bot preset, and a parent in the same list that runs the host. A fork keeps the source's
 * host preset, so it stays; a bot's home has no parent, so it stays.
 */
export function indexedIds(stored: readonly StoredSession[], root: string, deleted: ReadonlySet<string>): string[] {
  const byId = new Map(stored.map((s) => [String(s.header.id), s]));
  const kept: string[] = [];
  for (const s of stored) {
    const id = String(s.header.id);
    const h = s.header;
    if (h.origin !== undefined) continue;
    if (!inside(h.cwd, root)) continue;
    if (deleted.has(id)) continue;
    if (s.formatStatus === "migration-required") continue;
    if (typeof h.parentSession === "string" && !isHost(h.agentPreset)) {
      const parent = byId.get(h.parentSession);
      if (parent !== undefined && isHost(parent.header.agentPreset)) continue;
    }
    kept.push(id);
  }
  return kept;
}

/**
 * The search over `deps`: `reconcile` brings the index up to date, `search` reconciles and then queries.
 * `sessions` counts the kept conversations the index is current for, `skipped` the ones whose read threw.
 */
export function makeSearch(deps: SearchDeps): {
  reconcile(): Promise<{ sessions: number; skipped: number }>;
  search(q: string): Promise<SearchResult & { indexed: { sessions: number; skipped: number } }>;
} {
  const { index } = deps;

  const once = async (): Promise<{ sessions: number; skipped: number }> => {
    const stored = await deps.list();
    const kept = indexedIds(stored, deps.root, await deps.deleted());
    const keptSet = new Set(kept);
    const byId = new Map(stored.map((s) => [String(s.header.id), s]));
    const marks = index.marks();
    let skipped = 0;
    for (const id of kept) {
      const s = byId.get(id)!;
      const revision = String(s.revision);
      const mark = marks.get(id);
      let from = 0;
      let reset = false;
      if (mark !== undefined) {
        if (mark.revision === revision) continue;
        if (s.eventCount !== undefined && s.eventCount < mark.readCount) reset = true;
        else from = mark.readCount;
      }
      let events: readonly StoredEvent[];
      try {
        events = await deps.read(id, from);
      } catch {
        skipped += 1;
        continue;
      }
      if (reset) index.reset(id);
      index.append(id, { revision, readCount: from + events.length }, linesOf(events));
    }
    for (const id of marks.keys()) if (!keptSet.has(id)) index.reset(id);
    return { sessions: kept.length - skipped, skipped };
  };

  let tail: Promise<unknown> = Promise.resolve();
  const reconcile = (): Promise<{ sessions: number; skipped: number }> => {
    const run = tail.then(once, once);
    tail = run.catch(() => undefined);
    return run;
  };

  return {
    reconcile,
    async search(q) {
      const indexed = await reconcile();
      return { ...index.query(q, SEARCH_ITEMS_MAX), indexed };
    },
  };
}

/**
 * Session `sessionId`'s log from offset `from` to its end: opened for reading and read in pages of {@link LOG_PAGE}
 * until a page comes back empty, then closed — `desk-session.ts` `readSessionEvents` from an offset.
 * @throws when the open or a read rejects.
 */
export async function readEventsFrom(
  persistence: {
    open(id: string, access: "read"): Promise<{
      read(offset?: number, length?: number): Promise<{ events: readonly StoredEvent[] }>;
      [Symbol.asyncDispose](): Promise<void>;
    }>;
  },
  sessionId: string,
  from: number,
): Promise<StoredEvent[]> {
  const handle = await persistence.open(sessionId, "read");
  try {
    const events: StoredEvent[] = [];
    for (;;) {
      const page = await handle.read(from + events.length, LOG_PAGE);
      if (page.events.length === 0) return events;
      events.push(...page.events);
    }
  } finally {
    await handle[Symbol.asyncDispose]();
  }
}

/**
 * Mount `GET /data/search?q=`: 403 when the request is untrusted, 400 when the query is empty or over 500 code
 * points, else `{ok: true, items, hasMore, indexed}`; any throw is a 500 with a fixed line, so no log's error
 * reaches a body.
 * @param webServer - the host webserver service, or a test recorder.
 * @param search - {@link makeSearch}'s.
 */
export function registerSearchRoutes(webServer: RouteRegistrar, search: ReturnType<typeof makeSearch>): void {
  webServer.register({
    kind: "exact",
    path: "/data/search",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
      const q = validQuery(new URL(req.url ?? "", "http://localhost").searchParams.get("q") ?? "");
      if (q === null) return send(res, 400, BAD_QUERY);
      try {
        return send(res, 200, { ok: true, ...(await search.search(q)) });
      } catch {
        return send(res, 500, FAILED);
      }
    },
  });
}
