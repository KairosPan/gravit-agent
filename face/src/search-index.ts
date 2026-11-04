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
 * index cannot serve. Latin letters match regardless of case either way.
 *
 * `marks` records, per conversation, the revision and the count of log
 * entries already read, so the feeder appends only what is new and `reset`
 * rebuilds one conversation from nothing.
 *
 * `node:sqlite` is imported statically: this module is loaded only by the
 * search route's file, which `main.ts` imports, so Node's ExperimentalWarning
 * for it prints once per face start. Lengths here are code points, never
 * UTF-16 units. */

import { DatabaseSync } from "node:sqlite";

export const SEARCH_QUERY_MAX = 500;   // code points
export const SEARCH_ITEMS_MAX = 20;
export const SNIPPET_MAX = 240;        // code points

export interface IndexedLine { seq: number; at: number; text: string }
export interface SessionMark { revision: string; readCount: number }
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

export function openSearchIndex(path: string): SearchIndex {
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS lines USING fts5(body, session_id UNINDEXED, seq UNINDEXED, at UNINDEXED, tokenize = 'trigram');" +
    "CREATE TABLE IF NOT EXISTS marks (session_id TEXT PRIMARY KEY, revision TEXT NOT NULL, read_count INTEGER NOT NULL);",
  );
  const insertLine = db.prepare("INSERT INTO lines (body, session_id, seq, at) VALUES (?, ?, ?, ?)");
  const setMark = db.prepare(
    "INSERT INTO marks (session_id, revision, read_count) VALUES (?, ?, ?) " +
    "ON CONFLICT(session_id) DO UPDATE SET revision = excluded.revision, read_count = excluded.read_count",
  );
  const delLines = db.prepare("DELETE FROM lines WHERE session_id = ?");
  const delMark = db.prepare("DELETE FROM marks WHERE session_id = ?");
  const allMarks = db.prepare("SELECT session_id, revision, read_count FROM marks");
  const byPhrase = db.prepare(
    "SELECT session_id, at, body FROM lines WHERE lines MATCH ? ORDER BY at DESC, seq DESC",
  );
  const byLike = db.prepare(
    "SELECT session_id, at, body FROM lines WHERE body LIKE ? ESCAPE '\\' ORDER BY at DESC, seq DESC",
  );

  const tx = (fn: () => void): void => {
    db.exec("BEGIN");
    try { fn(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  };

  return {
    marks() {
      const out = new Map<string, SessionMark>();
      for (const r of allMarks.all() as unknown as { session_id: string; revision: string; read_count: number }[]) {
        out.set(r.session_id, { revision: r.revision, readCount: r.read_count });
      }
      return out;
    },
    append(sessionId, mark, lines) {
      tx(() => {
        for (const l of lines) insertLine.run(l.text, sessionId, l.seq, l.at);
        setMark.run(sessionId, mark.revision, mark.readCount);
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
    close() { db.close(); },
  };
}
