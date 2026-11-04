# dsh UI port, plan 1: the host side — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the face, with nothing visible changing yet, everything the page needs from the host
for the ten picks: four dsh rows mounted, the face's own search index and route, and the file
listing route.

**Architecture:** The four rows are configless overlay rows in `face/src/overlay.ts`, as the web-app
bundle mounts them. The search index is the face's own: SQLite through Node's built-in
`node:sqlite`, with an FTS5 `trigram` table. It is brought up to date lazily at each search from the
stored session logs (`sessionPersistence.list()` and `open(id, "read")`) and served at
`GET /data/search`. The file listing walks the repository once, caches the walk for 30 s, and is
served at `GET /data/files`. Both routes sit behind the face's `/data` fence.

**Tech Stack:** TypeScript on Node 22 (`tsx`), `node:sqlite` (SQLite 3.51.3 in this Node, measured),
dsh 0.2.1-rc.5, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-03-dsh-ui-port-design.md` (approved 2026-11-03): §5.1
(search; O7), §5.5 (the file listing; D14–D16), §6 (the host side), §7 (tests), §10 (this plan is
its plan 1).

## Global Constraints

- Every `@deepseek-ai/dsh-*` package is pinned EXACT at `0.2.1-rc.5` (`src/version.ts` `DSH_PIN`).
  The four new ones join with `--save-exact`; `tests/version.test.ts` sweeps them automatically.
- Node `^22.19.0 || >=24.0.0` (`face/package.json` engines). `node:sqlite` is built in: there is no
  new npm dependency beyond the four dsh packages, and no Python.
- The four overlay rows are configless: `job-controller` (`@deepseek-ai/dsh-api-job-controller`),
  `session-stats` (`@deepseek-ai/dsh-session-stats`), `session-turn-outline`
  (`@deepseek-ai/dsh-session-turn-outline`), `session-reference`
  (`@deepseek-ai/dsh-session-reference`). `dsh-file-reference-local` is NOT mounted (spec D14).
- Every new `/data` route answers 403 with `FORBIDDEN` (`src/http.ts`) unless
  `isTrustedDataRequest(req)`, bounds its input, and answers a fixed line on failure: nothing from
  an error reaches the body.
- Search: the query is trimmed, 1–500 characters (code points), with no NUL. At most 20 items, one
  per conversation. A snippet is at most 240 characters, with `match: [start, end]` as offsets into
  that snippet string. A query of 3 or more characters goes through FTS5 `MATCH` as one quoted
  phrase; a shorter one goes through `LIKE`, with `\`, `%` and `_` escaped.
- The index lives at `$DSH_HOME/face/search-index.sqlite`, beside the face's `archived.json`.
- File listing: at most 20 items, and a walk of at most 50,000 entries. It skips the names `.git`,
  `node_modules`, `dist` and `build`, the path `.claude/worktrees`, and every name beginning `.env`.
  It lists symbolic links as nothing and never descends them, and it reads names only. Gitignored
  files are listed.
- Nothing on the page changes in this plan.
- Never the live `~/.dsh` or port 3090, and never `npm run service`. Tests use a scratch
  `DSH_HOME` (`mkdtemp`). Real boots need `FACE_SMOKE=1` and run from a checkout outside `/tmp` and
  `$TMPDIR`.
- Commit messages are written to a file and committed with `git commit -F <file>`. No push, merge
  or PR.

## Review Focus

1. **A query that looks like syntax** (`a"b`, `50%`, `x_y`, a lone `\`, `NEAR(`, `-x`, `*`) is
   matched literally: never as FTS5 syntax, never as a `LIKE` wildcard, never a 500. Pinned in
   Task 2.
2. **Two searches at once on a cold index** run one reconcile, not two interleaved ones, and a log
   that throws mid-read leaves every other conversation indexed and is counted as skipped. Pinned
   in Task 4.
3. **A log that shrank** (its `eventCount` is below the index's read count) is indexed again from
   the start, not from a stale offset. Pinned in Task 4.
4. **Emoji and Chinese at a snippet's cut** never split a surrogate pair, and `match` indexes the
   string returned. Pinned in Task 2.
5. **A symlink loop or an unreadable folder** in the repository is skipped, and the walk goes on.
   Pinned in Task 5.

---

### Task 1: The four dsh rows

**Files:**
- Modify: `face/package.json`, `face/package-lock.json` (by `npm install`)
- Modify: `face/src/overlay.ts` (the `faceOverlay` insert list, in the block "workspace + the Remote
  controllers")
- Test: `face/tests/boot.test.ts`

**Interfaces:**
- Produces: the composed rows `job-controller`, `session-stats`, `session-turn-outline`,
  `session-reference`. Once they activate, the host serves `job/list` and `job/follow` (mux
  streams) and `job/kill`, the `turnOutline` and `sessionStats` projections, and the pre-step
  rewrite of `@[label](dsh-session:<id>)`.

- [ ] **Step 1: Install the tree.** The worktree has no `node_modules`. Run `npm ci` in `face/`.
  Expected: it exits 0.

- [ ] **Step 2: Write the failing test.** In `tests/boot.test.ts`, `OVERLAY_ROW_IDS` gains
  `"job-controller"`, `"session-reference"`, `"session-stats"` and `"session-turn-outline"`, keeping
  the list's order. Add:

```ts
test("the dsh UI port's four host rows: configless, from their own packages", () => {
  const rows = faceOverlay(0, { id: "gravit", plugins: [] } as never)[0].insert;
  const want = {
    "job-controller": "@deepseek-ai/dsh-api-job-controller",
    "session-stats": "@deepseek-ai/dsh-session-stats",
    "session-turn-outline": "@deepseek-ai/dsh-session-turn-outline",
    "session-reference": "@deepseek-ai/dsh-session-reference",
  };
  for (const [id, name] of Object.entries(want)) {
    const row = rows.find((r) => r.id === id);
    assert.equal(row?.name, name, id);
    assert.equal("config" in (row ?? {}), false, `${id} is configless`);
  }
  assert.equal(rows.some((r) => r.id === "file-reference-local"), false, "spec D14");
});
```

  (Adapt the `faceOverlay` call to how the file's other tests build a default preset.)

- [ ] **Step 3: Run it and see it fail.** Run `npx tsx --test tests/boot.test.ts`. Expected: FAIL,
  with the four ids missing.

- [ ] **Step 4: Install the four packages.** Run `npm install --save-exact
  @deepseek-ai/dsh-api-job-controller@0.2.1-rc.5 @deepseek-ai/dsh-session-stats@0.2.1-rc.5
  @deepseek-ai/dsh-session-turn-outline@0.2.1-rc.5 @deepseek-ai/dsh-session-reference@0.2.1-rc.5`
  in `face/`. If npm names a missing `@deepseek-ai/dsh-*` peer, add it the same way, at the same
  version. If it fails with `ERESOLVE`, follow `face/README.md` "Upgrading dsh — three pins, not
  one" step 1 (a fresh lockfile).

- [ ] **Step 5: Add the four rows** to `faceOverlay`'s insert list, after `workspace-controller`,
  each as `{ id, name }` with no config. Give them one comment block in the file's style: what each
  serves the page (the job streams, the two projections, the session reference rewrite), that the
  web-app bundle mounts them configless (`packages/bundle/web-app/cordis.patch.yml` at tag
  `dsh-v0.2.1-rc.5`), and why `file-reference-local` stays out (its `@`-is-a-path sentence would
  reach every agent's system prompt).

- [ ] **Step 6: Run the tests and the types.** Run `npx tsx --test tests/boot.test.ts
  tests/version.test.ts` and `npm run typecheck`. Expected: PASS, clean.

- [ ] **Step 7: Boot a real face.** Run `FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts` from this
  worktree. Expected: PASS. The strict row audit (`src/boot.ts`) refuses the boot if any of the four
  rows did not activate.

- [ ] **Step 8: Commit.** Write the message to a file, for example `feat(face): mount the dsh UI
  port's four host rows - job controller, session stats, turn outline, session reference`, then
  `git add face/package.json face/package-lock.json face/src/overlay.ts face/tests/boot.test.ts`
  and `git commit -F <file>`.

### Task 2: The search index

**Files:**
- Create: `face/src/search-index.ts`
- Test: `face/tests/search-index.test.ts`

**Interfaces:**
- Produces:

```ts
export const SEARCH_QUERY_MAX = 500;   // code points
export const SEARCH_ITEMS_MAX = 20;
export const SNIPPET_MAX = 240;        // code points
export interface IndexedLine { seq: number; at: number; text: string }
export interface SessionMark { revision: string; readCount: number }
export interface SearchHit { sessionId: string; snippet: string; match: [number, number]; at: number }
export interface SearchResult { items: SearchHit[]; hasMore: boolean }
export interface SearchIndex {
  marks(): Map<string, SessionMark>;
  append(sessionId: string, mark: SessionMark, lines: readonly IndexedLine[]): void; // one transaction: adds the lines, sets the mark
  reset(sessionId: string): void;   // drops the session's lines and its mark
  query(q: string, limit?: number): SearchResult;   // throws RangeError on an invalid query
  close(): void;
}
export function openSearchIndex(path: string): SearchIndex;   // ":memory:" in tests; creates the file and its tables
export function validQuery(q: string): string | null;         // trimmed query, or null when empty, over 500, or holding a NUL
export function snippetAround(text: string, q: string, max?: number): { snippet: string; match: [number, number] } | null;
```

- The tables: `CREATE VIRTUAL TABLE IF NOT EXISTS lines USING fts5(body, session_id UNINDEXED, seq
  UNINDEXED, at UNINDEXED, tokenize = 'trigram')` and `CREATE TABLE IF NOT EXISTS marks (session_id
  TEXT PRIMARY KEY, revision TEXT NOT NULL, read_count INTEGER NOT NULL)`.
- `query` gives one hit per session, from its newest matching line (the highest `at`, then the
  highest `seq`). Sessions are ordered by that line's `at`, newest first. It fetches `limit + 1`
  sessions to set `hasMore`. Latin letters match regardless of case.
- `snippetAround` finds the first case-insensitive occurrence. It returns at most `max` code points,
  centred on the match, with `…` added where it cut, and never splits a surrogate pair.

- [ ] **Step 1: Write the failing tests** in `tests/search-index.test.ts`, each on
  `openSearchIndex(":memory:")`:
  - `finds a Chinese word of one, two and four characters inside a sentence`: append
    `贵州茅台的估值很高，宁德时代下跌了` to session `a`. Querying `茅`, `茅台` and `估值很高` each gives
    `items.map(i => i.sessionId)` equal to `["a"]`.
  - `finds an English word in any case and a number`: from `Lunhui market read for 600519`,
    `MARKET` and `600519` each give `["a"]`.
  - `one hit per conversation, its newest line, newest conversation first`: two sessions with two
    matching lines each, at different `at`. The items are ordered by newest line, and each
    snippet's text is that newest line's.
  - `twenty at most, and hasMore past them`: 21 sessions match. 20 items, `hasMore: true`.
  - `a query that looks like syntax is literal` (Review Focus 1): lines `a"b`, `50% off`, `x_y`,
    `back\slash`, `NEAR(a b)`, `-x`, `*star`, plus a control line `plain`. Each query (`a"b`, `50%`,
    `x_y`, `\`, `NEAR(`, `-x`, `*`) gives exactly its own line's session, never `plain`'s, and none
    throws.
  - `the snippet holds the match within 240 characters`: a 1,000-character line with `needle` in
    the middle. The snippet is at most 240 code points, starts and ends with `…`, and
    `snippet.slice(...match).toLowerCase() === "needle"`.
  - `the snippet never splits a surrogate pair` (Review Focus 4): emoji (`😀`) and Chinese sit on
    both sides of every possible cut. No snippet matches
    `/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/`, and `match` still
    slices the query.
  - `validQuery refuses the empty, the over-long and the NUL`: `"  "`, 501 code points and
    `"a\u0000b"` give `null`; `"  x "` gives `"x"`; and `query` throws `RangeError` on each refused
    one.
  - `reset drops a conversation; marks round-trip; a file index survives a reopen`: on a path in a
    `mkdtemp` directory, append, close, reopen. The marks and hits are still there; after `reset`
    they are gone.

- [ ] **Step 2: Run them and see them fail.** Run `npx tsx --test tests/search-index.test.ts`.
  Expected: FAIL, `search-index.ts` not found.

- [ ] **Step 3: Implement `face/src/search-index.ts`** with `DatabaseSync` from `node:sqlite`.
  - A valid query of 3 or more code points: `WHERE lines MATCH ?`, bound to `"` + the query with
    each `"` doubled + `"`.
  - A shorter one: `WHERE body LIKE ? ESCAPE '\'`, bound to `%` + the query with `\`, `%` and `_`
    each prefixed by `\` + `%`.
  - `append` runs in one `BEGIN … COMMIT`.
  - Measured on this Node's SQLite (3.51.3) with exactly these two statements: every query in
    Review Focus 1 matched only its own line, and `茅`, `茅台`, `估值很高`, `market` and `600519` found
    theirs.
  - Import `node:sqlite` with a static import: the module is loaded only by the search route's file,
    which `main.ts` imports, so the ExperimentalWarning prints once per face start. Say so in the
    module's head comment.

- [ ] **Step 4: Run them and see them pass.** Run `npx tsx --test tests/search-index.test.ts` and
  `npm run typecheck`. Expected: PASS, clean.

- [ ] **Step 5: Commit.** The message, for example: `feat(face): the face's own search index -
  SQLite trigram for three characters or more, LIKE below, one hit per conversation`. Add the two
  files, then `git commit -F <file>`.

### Task 3: What a conversation said

**Files:**
- Create: `face/src/search-text.ts`
- Test: `face/tests/search-text.test.ts`

**Interfaces:**
- Consumes: `IndexedLine` (Task 2).
- Produces:

```ts
export interface StoredEvent { type: string; seq: number; time?: number; data?: unknown }
export const WORD_SOURCES: ReadonlySet<string>;   // "user", "telegram", "compact-checkpoint"
export function linesOf(events: readonly StoredEvent[]): IndexedLine[];
```

`linesOf` keeps what the face draws as words (spec §5.1, "What it holds"), one line per event, as
`{seq, at: time ?? 0, text}`:
- a `user/message` whose `data.message.source.kind` is absent or in `WORD_SOURCES`, or is `room`
  with `form: "answer"`; its text is the `type: "text"` blocks of `data.message.content`, joined
  with `\n` and trimmed, as `client/js/wire/mapper.js` `blocksText` joins them;
- an `assistant/message`: its text blocks the same way. `reasoning` blocks never count;
- a `tool/call` whose `data.name` is `lunhui_present` and whose `data.arguments.summary` is a
  non-empty string, unless a `tool/result` for the same call id in the same `events` is an error
  (`data.message.isError` or `data.error`) or its text does not parse to `{ok: true}`. The call id
  is `data.callId` on the call, and `data.message.toolCallId` (else `data.message.source.callId`) on
  the result, as the mapper reads them.

An empty text yields no line. Every other event type and source yields nothing: a room's `delta`, a
runtime snapshot, a plugin notice, a desk firing's `schedule` or `alert`, a tool call, a tool
result.

- [ ] **Step 1: Write the failing tests** in `tests/search-text.test.ts`, on hand-built events in the
  shapes `client/js/wire/mapper.js` reads:
  - `the operator's words, Gravit's answer, a phone message and a compaction summary are lines`;
  - `a room member's answer is a line; a room delta is not`;
  - `reasoning, a runtime snapshot, a plugin notice, a schedule or alert prompt and a plain tool
    call are not lines`;
  - `an ok lunhui_present call's summary is a line; one whose result in the same batch is an error
    or not ok is not`;
  - `seq and at come from the event, at 0 when time is absent; an empty text is no line`.

- [ ] **Step 2: Run them and see them fail.** Run `npx tsx --test tests/search-text.test.ts`.
  Expected: FAIL.

- [ ] **Step 3: Implement `face/src/search-text.ts`.** It is pure, with no dsh import.

- [ ] **Step 4: Run them and see them pass.** Run `npx tsx --test tests/search-text.test.ts` and
  `npm run typecheck`. Expected: PASS, clean.

- [ ] **Step 5: Commit.** The message, for example: `feat(face): what a conversation said, as the
  search index holds it`. Commit with `git commit -F <file>`.

### Task 4: The reconcile and `GET /data/search`

**Files:**
- Create: `face/src/search.ts`
- Modify: `face/src/main.ts` (open the index; register the route; close the index on the way out)
- Test: `face/tests/search.test.ts`

**Interfaces:**
- Consumes: `openSearchIndex`, `SearchIndex`, `validQuery`, `SEARCH_ITEMS_MAX` (Task 2);
  `linesOf`, `StoredEvent` (Task 3); `isHostPreset` (`src/overlay.ts`); `readMeta`
  (`src/sessions.ts`, its `deleted` list); `send`, `FORBIDDEN`, `isTrustedDataRequest`
  (`src/http.ts`); the `RouteRegistrar` type the other route modules take.
- Produces:

```ts
export interface StoredSession {
  header: { id: unknown; cwd?: string; parentSession?: unknown; origin?: string; agentPreset?: string };
  formatStatus?: "current" | "migration-required";
  revision: unknown;
  eventCount?: number;
}
export interface SearchDeps {
  root: string;                                                     // the workbench repo root
  list(): Promise<readonly StoredSession[]>;                        // sessionPersistence.list()
  read(sessionId: string, from: number): Promise<readonly StoredEvent[]>;  // the log from offset `from` to its end
  deleted(): Promise<ReadonlySet<string>>;                          // readMeta(home).deleted
  index: SearchIndex;
}
export function indexedIds(stored: readonly StoredSession[], root: string, deleted: ReadonlySet<string>): string[];
export function makeSearch(deps: SearchDeps): {
  reconcile(): Promise<{ sessions: number; skipped: number }>;
  search(q: string): Promise<SearchResult & { indexed: { sessions: number; skipped: number } }>;
};
export function readEventsFrom(persistence: { open(id: string, access: "read"): Promise<{ read(offset?: number, length?: number): Promise<{ events: readonly StoredEvent[] }>; [Symbol.asyncDispose](): Promise<void> }> }, sessionId: string, from: number): Promise<StoredEvent[]>;
export function registerSearchRoutes(webServer: RouteRegistrar, search: ReturnType<typeof makeSearch>): void;
```

- **`indexedIds`** keeps a stored session when all of these hold:
  - it has no `origin` (no subagent child);
  - its `cwd` resolves inside `root`;
  - it is not in `deleted`;
  - its `formatStatus` is not `migration-required`;
  - it is not a room member. A member, by `client/js/wire/room.js` `foldMembers`' rule, has a
    string `parentSession`, a non-host `agentPreset`, and a parent in the same list whose preset
    is the host's (absent or empty counts as the host).
- **`reconcile`** runs one at a time: a call made while one runs waits for it, then runs once more.
  For each kept session:
  - with no mark, read from 0;
  - with a mark whose `revision` (as a string) is unchanged, skip it;
  - when `eventCount` is known and below the mark's `readCount`, `reset` it and read from 0;
  - otherwise read from `readCount`.
  Then `append(id, {revision, readCount: readCount + events.length}, linesOf(events))`. A read that
  throws counts as skipped, and its mark stays. A marked session no longer kept is `reset`.
- **`readEventsFrom`** pages `read(offset, 512)` from `from` until an empty page, then disposes the
  handle, as `src/desk-session.ts` `readSessionEvents` does from 0.
- **`GET /data/search?q=`**:
  - 403 with `FORBIDDEN` when the request is untrusted;
  - 400 with `{"ok":false,"error":"query must be 1-500 characters"}` when `validQuery` refuses it;
  - else 200 with `{ok: true, items, hasMore, indexed}`, after one `reconcile` and
    `index.query(q, SEARCH_ITEMS_MAX)`;
  - a throw answers 500 with `{"ok":false,"error":"search failed"}`.
- **`main.ts`** opens `openSearchIndex(join(dshHome, "face", "search-index.sqlite"))`, creating the
  `face` directory first as `src/sessions.ts` does. It builds the deps from the booted
  `sessionPersistence`, widening the narrow type `main.ts` already declares to `list()` with
  `revision`, `formatStatus`, `eventCount` and the header fields above, plus `open`. It registers
  the route beside `registerSessionRoutes`, and closes the index on the face's way out, beside the
  other disposals.

- [ ] **Step 1: Write the failing tests** in `tests/search.test.ts`, over in-memory fakes of `list`,
  `read` and `deleted` and `openSearchIndex(":memory:")`:
  - `indexedIds keeps the face's own top-level conversations`: it drops a subagent child, a room
    member (a bot-preset child of a Gravit session), a deleted id, a `migration-required` log, and
    a session whose cwd is outside root. It keeps a Gravit session, a fork (Gravit preset, with a
    `parentSession`), a bot's home, the desk's and a room's own session.
  - `reconcile reads a new conversation whole, then only what was appended`: the second reconcile
    reads from the first's `readCount`, as recorded calls to `read` show.
  - `an unchanged revision is not read`.
  - `a log that shrank is read again from the start` (Review Focus 3): `eventCount` below
    `readCount` gives `reset`, then a read from 0.
  - `a log that throws is skipped and counted; the others are indexed` (Review Focus 2).
  - `two searches at once run one reconcile at a time` (Review Focus 2): `read` blocks on a gate;
    two `search()` calls overlap; the recorded reads never interleave, and both answer.
  - `a deleted conversation leaves the index at the next reconcile`.
  - The route, on a bare `node:http` server with the registrar the other route tests use: 403
    without the trusted header; 400 for `q=` and for 501 characters; 200 with `items[0].sessionId`
    for `q=%E8%8C%85%E5%8F%B0` (`茅台`) over a fake log holding `贵州茅台的估值很高`; 500 with the fixed
    line when `list` throws.

- [ ] **Step 2: Run them and see them fail.** Run `npx tsx --test tests/search.test.ts`. Expected:
  FAIL.

- [ ] **Step 3: Implement `face/src/search.ts`** and wire `main.ts` as stated above.

- [ ] **Step 4: Run them and see them pass.** Run `npx tsx --test tests/search.test.ts
  tests/search-index.test.ts tests/search-text.test.ts`, `npm test` and `npm run typecheck`.
  Expected: PASS, clean.

- [ ] **Step 5: Commit.** The message, for example: `feat(face): GET /data/search - the face's own
  index brought up to date from the stored logs at each search`. Commit with `git commit -F <file>`.

### Task 5: `GET /data/files`

**Files:**
- Create: `face/src/files.ts`
- Modify: `face/src/main.ts` (register the route with `root: process.cwd()`, the repo root after
  `main.ts`'s `chdir`)
- Test: `face/tests/files.test.ts`

**Interfaces:**
- Produces:

```ts
export const FILES_WALK_MAX = 50_000;
export const FILES_ITEMS_MAX = 20;
export const FILES_CACHE_MS = 30_000;
export interface FileEntry { path: string; kind: "file" | "directory" }   // repo-relative, "/"-separated, no trailing slash
export function walkRepository(root: string, max?: number): Promise<{ entries: FileEntry[]; truncated: boolean }>;
export function rankFiles(entries: readonly FileEntry[], q: string, dir?: string, limit?: number): FileEntry[];
export function folderEntries(entries: readonly FileEntry[], folder: string, prefix: string, limit?: number): FileEntry[];
export function registerFileRoutes(webServer: RouteRegistrar, deps: { root: string; now?: () => number }): void;
```

- **`walkRepository`**:
  - uses `lstat`, depth first, names sorted;
  - skips the names `.git`, `node_modules`, `dist` and `build` at any depth, the path
    `.claude/worktrees`, and every name beginning `.env`;
  - skips a symbolic link entirely, so it never descends one;
  - skips a folder it cannot read and goes on;
  - stops at `max` entries with `truncated: true`.
- **`rankFiles`** ranks case-insensitively in three tiers: the base name starts with the query, then
  the base name contains it, then the path contains it. Within a tier it orders entries under
  `dir` first, then fewer path segments, then the path alphabetically. It returns at most `limit`.
- **`folderEntries`** gives the direct children of `folder` (`""` is the root) whose names start
  with `prefix`: folders first, then files, each alphabetical, at most `limit`.
- **`GET /data/files?q=&dir=`**:
  - 403 with `FORBIDDEN` when untrusted;
  - 400 with `{"ok":false,"error":"bad query"}` when `q` is over 500 characters or holds a NUL, or
    `dir` is absolute or holds a `..` segment;
  - a `q` holding `/` gives `folderEntries(q up to its last "/", the rest)`;
  - an empty `q` gives `folderEntries(dir ?? "", "")`;
  - any other `q` gives `rankFiles(q, dir)`;
  - the answer is `{ok: true, items, truncated}`;
  - the walk is cached for `FILES_CACHE_MS` and taken again after it;
  - a throw answers 500 with `{"ok":false,"error":"listing failed"}`.

- [ ] **Step 1: Write the failing tests** in `tests/files.test.ts`, on a fixture tree under
  `mkdtemp`. The tree holds `strategies/cn-market/journal.md`, `strategies/cn-market/analysis/`,
  `desk/levels.yml`, `.env.ifind`, `.git/HEAD`, `node_modules/x/index.js`,
  `.claude/worktrees/w/file.md`, `face/dist/a.js`, a symlink loop (`ln -s .. loop` inside
  `desk/`), and an unreadable folder (`chmod 000`):
  - `the walk skips the key files, git, packages, build output and other worktrees`: no listed path
    contains `.env`, `.git`, `node_modules`, `dist` or `.claude/worktrees`; `desk/levels.yml` is
    listed.
  - `a symlink loop and an unreadable folder are skipped and the walk goes on` (Review Focus 5).
  - `the walk stops at its cap`: with `max` 3, there are 3 entries and `truncated: true`.
  - `ranking: name prefix, then name substring, then path; the conversation's folder first`: `jou`
    ranks `strategies/cn-market/journal.md` first, and with `dir: "strategies/cn-market"` its
    siblings lead.
  - `a query holding / lists that folder's children by prefix`: `strategies/cn-market/an` lists
    `strategies/cn-market/analysis` as a directory.
  - The route: 403 untrusted; 400 for `dir=/etc` and `dir=../x`; 200 `items` for `q=jou`; a second
    call inside 30 s does not walk again (count `readdir` calls through an injected `now`, or count
    walks), and a call after 30 s does.

- [ ] **Step 2: Run them and see them fail.** Run `npx tsx --test tests/files.test.ts`. Expected:
  FAIL.

- [ ] **Step 3: Implement `face/src/files.ts`** and register it in `main.ts`.

- [ ] **Step 4: Run them and see them pass.** Run `npx tsx --test tests/files.test.ts`, `npm test`
  and `npm run typecheck`. Expected: PASS, clean.

- [ ] **Step 5: Commit.** The message, for example: `feat(face): GET /data/files - the repository's
  files and folders for the @ picker, the key files and other worktrees skipped`. Commit with
  `git commit -F <file>`.

### Task 6: The real-boot smokes

**Files:**
- Create: `face/tests/dsh-ui-port-smoke.test.ts` (gated: `skip: process.env.FACE_SMOKE !== "1" &&
  "set FACE_SMOKE=1"`)

**Interfaces:**
- Consumes:
  - the boot the other smokes use: `setupFaceProfile`, the patch line `- id: mcp-account` /
    `disabled: true`, `bootFace({profileName: "face", port: 0, dshHome, botsRoot: await
    makeBotsRoot()})`, `mountClient` and `signIn` (`tests/remote.ts`), and
    `remote(base, cookie, endpoint, args)`;
  - the stub model (`tests/stub-llm.ts` `StubAdapter`, registered as `tests/goal-smoke.test.ts`
    does);
  - `makeSearch`, `registerSearchRoutes`, `readEventsFrom` (Task 4), wired to the booted
    `sessionPersistence` as `main.ts` wires them.

Each assertion below is one `test(…)` in the file, sharing one boot:
- **Pin:** `workspace/pinSession {request: {sessionId}}` answers `pinnedSessionIds` holding the id.
  A `workspace/follow` stream over `openMux` (as `tests/client-mux-smoke.test.ts` opens streams)
  shows `pinnedSessionIds` in its `baseline` and a `pinned` frame after the pin.
  `workspace/unpinSession` removes it.
- **Commands and skills:** `commands/list {agentId}` on a live conversation lists `compact`,
  `feedback`, `goal`, `permission` and `plan`. `skills/list {request: {sessionId}}` answers on a cold
  one, made cold as `tests/client-mux-smoke.test.ts` makes one, and does not activate it.
- **The projections:** after one stub turn, `session/projections {request: {sessionId}}` values hold
  `turnOutline` with one entry and `sessionStats.turns === 1`.
- **Jobs:** a `job/list {sessionId}` stream opens and its first frame is `{type: "rows"}`.
- **Earlier history:** `session/page` with `beforeSeq` answers `{records, hasMore}`.
- **An upload:** `POST /api/session/uploadFileBinary?sessionId=…&name=a.csv` (octet-stream, the
  cookie) answers `{ok: true, value: {receiptId}}`, and a `session/prompt` holding `{type: "file",
  receiptId}` is accepted on the stub model.
- **The session reference row is up:** `ctx.get("sessionReferenceResolver")` is defined.
- **Search:** after a stub turn whose prompt is `贵州茅台的估值很高，宁德时代下跌了`, `GET
  /data/search?q=茅台` (the trusted header and the cookie) lists that session.

- [ ] **Step 1: Write the smoke.** To see it fail first, run it once with the `job-controller` row
  commented out of the overlay (the jobs test fails), then restore the row.

- [ ] **Step 2: Run it.** Run `FACE_SMOKE=1 npx tsx --test tests/dsh-ui-port-smoke.test.ts` from
  this worktree. Expected: PASS.

- [ ] **Step 3: Run the whole suite.** Run `npm test`, then `FACE_SMOKE=1 npm test`. Expected: PASS.
  The smoke count rises by this file's tests. Record both counts for Task 7.

- [ ] **Step 4: Commit.** The message, for example: `test(face): the dsh UI port's host side on a
  real boot - pins, commands, projections, jobs, paging, an upload, the reference row, search`.
  Commit with `git commit -F <file>`.

### Task 7: The documents and the build notes

**Files:**
- Modify: `DEVELOPMENT.md`, `face/README.md`, `CLAUDE.md`,
  `docs/superpowers/specs/2026-11-03-dsh-ui-port-design.md`

- [ ] **Step 1: `DEVELOPMENT.md`.**
  - §4.2 module table: rows for `search-index.ts`, `search-text.ts`, `search.ts` and `files.ts`.
  - §4.3: the four overlay rows and what each serves, and why `file-reference-local` stays out.
  - §4.4 route table: `GET /data/search` and `GET /data/files`.
  - §4.5: `$DSH_HOME/face/search-index.sqlite` among the face's state, a copy of the conversations'
    text.
  - §7.3: the five new test files and the counts recorded in Task 6.
  - The dsh package count wherever it is stated (34 → 38).

- [ ] **Step 2: `face/README.md`.**
  - "Upgrading dsh — three pins, not one": 34 → 38 packages.
  - A short section, "Search and files (src/search*.ts, src/files.ts)": what each route answers and
    the index's file.
  - "Tests": the new files.

- [ ] **Step 3: `CLAUDE.md`.** One clause in the `face/` map line: the face's own search index
  (`src/search*.ts`) and the file listing (`src/files.ts`), for the dsh UI port.

- [ ] **Step 4: The spec's build notes.** Add "## 13. Build notes, plan 1" to the spec: the commits,
  the measured counts, and a table of every point where the tree differs from the spec's words and
  why, in the 10-28 spec's §12 form.

- [ ] **Step 5: Check and commit.** Run `npm test` and `npm run typecheck` in `face/`. Expected:
  PASS, clean. The message, for example: `docs: the dsh UI port's host side - two routes, four rows,
  the search index`. Commit with `git commit -F <file>`.
