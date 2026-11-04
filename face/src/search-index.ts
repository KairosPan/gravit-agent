/** The face's own search index over conversation text: one SQLite file, one
 * row per indexed line, one hit per conversation.
 *
 * dsh's session search is not relied on (it matches by word, which fits
 * neither Chinese nor numbers); the face keeps its own index and feeds it
 * from the session logs (a later task) and serves it (the search route). The
 * `lines` table is FTS5 with the trigram tokenizer: a query of three code
 * points or more is one quoted phrase (so `"`, `*`, `-`, `NEAR(` and the rest
 * of FTS5's syntax are literal text), and a shorter one — a single Chinese
 * character, a two-character word — goes through `LIKE`, which a trigram
 * index cannot serve. ASCII letters match regardless of case either way
 * (SQLite's `LIKE` folds ASCII only, so a short non-ASCII query is
 * case-sensitive).
 *
 * `marks` records, per conversation, the revision, the count of log entries
 * already read and the log's size in bytes when the listing gave one, so the
 * feeder appends only what is new, sees a log that shrank, and `reset`
 * rebuilds one conversation from nothing.
 *
 * The file is a cache, never a reason to keep the face down: its schema is
 * stamped with `PRAGMA user_version` ({@link SEARCH_INDEX_VERSION}), and
 * {@link openSearchIndexOrFresh} replaces a file it cannot open or whose stamp
 * differs (the next reconcile reads every log again). The file holds a copy of
 * every indexed conversation, so it is chmod 0600 once open.
 *
 * `node:sqlite` is imported statically: this module is loaded only by the
 * search route's file, which `main.ts` imports, so Node's ExperimentalWarning
 * for it prints once per face start. Lengths here are code points, never
 * UTF-16 units. */

import { chmodSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** The schema's `user_version`: 2 adds `marks.size` (an unstamped file, 0, predates both). */
export const SEARCH_INDEX_VERSION = 2;

export const SEARCH_QUERY_MAX = 500;   // code points
export const SEARCH_ITEMS_MAX = 20;
export const SNIPPET_MAX = 240;        // code points

export interface IndexedLine { seq: number; at: number; text: string }
/** `size` is the log's size in bytes at `readCount`, absent when the listing gave none. */
export interface SessionMark { revision: string; readCount: number; size?: number }
export interface SearchHit { sessionId: string; snippet: string; match: [number, number]; at: number }
export interface SearchResult { items: SearchHit[]; hasMore: boolean }
export interface SearchIndex {
  marks(): Map<string, SessionMark>;
  /** One transaction: adds the lines, sets the mark. */
  append(sessionId: string, mark: SessionMark, lines: readonly IndexedLine[]): void;
  /** Drops the session's lines and its mark. */
  reset(sessionId: string): void;
  /** Throws RangeError on an invalid query. */
  query(q: string, limit?: number): SearchResult;
  /** Idempotent: a second close does nothing. */
  close(): void;
}

/** The trimmed query, or null when empty, over 500 code points, or holding a NUL. */
export function validQuery(q: string): string | null {
  const t = q.trim();
  if (t === "" || t.includes("\u0000")) return null;
  if ([...t].length > SEARCH_QUERY_MAX) return null;
  return t;
}

/** The first case-insensitive occurrence of `q` in `text`, with at most `max`
 * code points around it (centred, `…` where it cut), and its `[start, end)` in
 * the returned string's UTF-16 units. Null when `q` does not occur. */
export function snippetAround(
  text: string, q: string, max: number = SNIPPET_MAX,
): { snippet: string; match: [number, number] } | null {
  const cps = [...text];
  const qs = [...q].map((c) => c.toLowerCase());
  if (qs.length === 0) return null;
  const lower = cps.map((c) => c.toLowerCase());
  let at = -1;
  for (let i = 0; i + qs.length <= lower.length && at < 0; i++) {
    let ok = true;
    for (let j = 0; j < qs.length; j++) if (lower[i + j] !== qs[j]) { ok = false; break; }
    if (ok) at = i;
  }
  if (at < 0) return null;
  const qn = qs.length;
  let start = 0;
  let end = cps.length;
  if (cps.length > max) {
    const w = Math.max(1, max - 2);   // room for an ellipsis on each side
    start = Math.max(0, Math.min(at - Math.floor((w - qn) / 2), cps.length - w));
    if (start > at) start = at;
    end = Math.min(cps.length, start + w);
  }
  const left = start > 0 ? "…" : "";
  const right = end < cps.length ? "…" : "";
  const before = cps.slice(start, at).join("");
  const matched = cps.slice(at, Math.min(at + qn, end)).join("");
  const snippet = left + before + matched + cps.slice(at + qn, end).join("") + right;
  const from = left.length + before.length;
  return { snippet, match: [from, from + matched.length] };
}

interface LineRow { session_id: string; at: number; body: string }

/**
 * Open (or create) the index at `path`, or `":memory:"`.
 * @throws when the file is not a SQLite database, or its `user_version` is not {@link SEARCH_INDEX_VERSION} (an
 * unstamped empty database is stamped instead).
 */
export function openSearchIndex(path: string): SearchIndex {
  const db = new DatabaseSync(path);
  try {
    const version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    if (version === 0) {
      const tables = Number((db.prepare("SELECT count(*) AS n FROM sqlite_master").get() as { n: number }).n);
      if (tables !== 0) throw new Error(`search index schema is unstamped (want ${SEARCH_INDEX_VERSION})`);
    } else if (version !== SEARCH_INDEX_VERSION) {
      throw new Error(`search index schema is version ${version} (want ${SEARCH_INDEX_VERSION})`);
    }
    db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS lines USING fts5(body, session_id UNINDEXED, seq UNINDEXED, at UNINDEXED, tokenize = 'trigram');" +
      "CREATE TABLE IF NOT EXISTS marks (session_id TEXT PRIMARY KEY, revision TEXT NOT NULL, read_count INTEGER NOT NULL, size INTEGER);" +
      `PRAGMA user_version = ${SEARCH_INDEX_VERSION};`,
    );
    if (path !== ":memory:" && path !== "") chmodSync(path, 0o600);
  } catch (e) {
    db.close();
    throw e;
  }
  const insertLine = db.prepare("INSERT INTO lines (body, session_id, seq, at) VALUES (?, ?, ?, ?)");
  const setMark = db.prepare(
    "INSERT INTO marks (session_id, revision, read_count, size) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(session_id) DO UPDATE SET revision = excluded.revision, read_count = excluded.read_count, size = excluded.size",
  );
  const delLines = db.prepare("DELETE FROM lines WHERE session_id = ?");
  const delMark = db.prepare("DELETE FROM marks WHERE session_id = ?");
  const allMarks = db.prepare("SELECT session_id, revision, read_count, size FROM marks");
  const byPhrase = db.prepare(
    "SELECT session_id, at, body FROM lines WHERE lines MATCH ? ORDER BY at DESC, seq DESC",
  );
  const byLike = db.prepare(
    "SELECT session_id, at, body FROM lines WHERE body LIKE ? ESCAPE '\\' ORDER BY at DESC, seq DESC",
  );

  let closed = false;
  const tx = (fn: () => void): void => {
    db.exec("BEGIN");
    try { fn(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  };

  return {
    marks() {
      const out = new Map<string, SessionMark>();
      for (const r of allMarks.all() as unknown as { session_id: string; revision: string; read_count: number; size: number | null }[]) {
        const mark: SessionMark = { revision: r.revision, readCount: Number(r.read_count) };
        if (r.size !== null) mark.size = Number(r.size);
        out.set(r.session_id, mark);
      }
      return out;
    },
    append(sessionId, mark, lines) {
      tx(() => {
        for (const l of lines) insertLine.run(l.text, sessionId, l.seq, l.at);
        setMark.run(sessionId, mark.revision, mark.readCount, mark.size ?? null);
      });
    },
    reset(sessionId) {
      tx(() => { delLines.run(sessionId); delMark.run(sessionId); });
    },
    query(q, limit = SEARCH_ITEMS_MAX) {
      const v = validQuery(q);
      if (v === null) throw new RangeError("invalid search query");
      const cap = Math.max(1, Math.min(limit, SEARCH_ITEMS_MAX));
      const rows = [...v].length >= 3
        ? byPhrase.iterate('"' + v.replaceAll('"', '""') + '"')
        : byLike.iterate("%" + v.replace(/[\\%_]/g, "\\$&") + "%");
      const items: SearchHit[] = [];
      const seen = new Set<string>();
      let hasMore = false;
      for (const row of rows as Iterable<unknown>) {
        const r = row as LineRow;
        if (seen.has(r.session_id)) continue;
        if (items.length === cap) { hasMore = true; break; }
        seen.add(r.session_id);
        const snip = snippetAround(r.body, v) ?? { snippet: [...r.body].slice(0, SNIPPET_MAX).join(""), match: [0, 0] as [number, number] };
        items.push({ sessionId: r.session_id, snippet: snip.snippet, match: snip.match, at: Number(r.at) });
      }
      return { items, hasMore };
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

/**
 * {@link openSearchIndex}, but a cache that will not open never keeps the face down: on a failure (a corrupt file, a
 * stamp from another schema) `log` gets one line, the file and its `-wal`/`-shm` are removed and a fresh index is
 * opened; when that fails too, `log` gets a second line and the answer is undefined (the face boots without search).
 * @param open - the opener, {@link openSearchIndex} unless a test injects one.
 */
export function openSearchIndexOrFresh(
  path: string,
  log: (line: string) => void,
  open: (path: string) => SearchIndex = openSearchIndex,
): SearchIndex | undefined {
  try {
    return open(path);
  } catch (e) {
    log(`search index at ${path} could not be opened (${e instanceof Error ? e.message : String(e)}); rebuilding it`);
  }
  try {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
    return open(path);
  } catch (e) {
    log(`search index at ${path} could not be rebuilt (${e instanceof Error ? e.message : String(e)}); search is off until a restart`);
    return undefined;
  }
}
