# dsh UI port, plan 2: the list — search and pin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The conversation list gains a search box that finds any word in any conversation, and
pins that keep a conversation first in its group in every browser.

**Architecture:** Search is a pure view (`host/search-view.js`) over the store's conversations
plus the answers of plan 1's `GET /data/search`, driven by an impure layer (`host/search.js`)
that waits 250 ms of quiet and drops stale answers. Pins come from a `workspace/follow` stream
that `host/live.js` opens on the page's mux; `host/list-view.js` `groupsOf` sorts pinned rows
first inside each group. The page stays one string render per store change.

**Tech Stack:** Vanilla ES modules in `face/client/js`, the fake-DOM client suite
(`face/tests/client/`, `node --test` via tsx), and plan 1's `GET /data/search` route.

**Spec:** `docs/superpowers/specs/2026-11-03-dsh-ui-port-design.md` §5.1, §5.2 and §5.12 (keys);
P1, P2; O7; D1–D4, D6, D7. Plan 1's build notes are its §13.

## Global Constraints

- **Copy, verbatim (English):**
  - the box: placeholder `Search conversations` and the hint `⌥⌘K`;
  - the head over results: `<n> conversations` (`1 conversation` for one);
  - the states: `Searching every conversation…`, `No matching conversations`,
    `Showing the first 20. Narrow your search.` and `Could not search inside conversations`;
  - the chip `Archived` and the key `Un-archive`;
  - the row keys `Pin` and `Unpin`, and the status line `Pin failed. Try again later.`
- **Wire:**
  - `GET /data/search?q=` answers `{ok, items: [{sessionId, snippet, match: [start, end], at}],
    hasMore, indexed}`, or 400 or 500 with a fixed line.
  - `workspace/pinSession {request: {sessionId}}` and `workspace/unpinSession {request:
    {sessionId}}` answer `{pinnedSessionIds}`.
  - `workspace/follow` is opened with `{}` over the mux (as `tests/dsh-ui-port-smoke.test.ts`
    opens it). Its first frame is `{type: "baseline", value: {items, archivedSessionIds,
    pinnedSessionIds}}`, and later frames include `{type: "pinned", pinnedSessionIds}`.
- **Timing:** content search runs 250 ms after typing stops (`SEARCH_CONTENT_MS = 250`). Title
  matches show at once. At most 20 results.
- **Keys:** ⌥⌘K (Ctrl+Alt+K off a Mac) focuses the box from anywhere. Match it on
  `KeyboardEvent.code === "KeyK"` with `altKey`, plus `metaKey` on a Mac or `ctrlKey` elsewhere,
  never on `key`. Esc in the box clears the query; a second Esc blurs the box. That second Esc
  comes before today's Escape chain (spec D34).
- **The client rules:**
  - every host string passes through `esc()`;
  - `app.css` names no hex, and the highlight is `--warn-fill` / `--warn-text`;
  - `css.test.js` holds both ways: every class has a rule, and every rule's class is emitted;
  - the composer's words still never render on typing;
  - with no query and nothing pinned, the list's HTML is what it is today, except for the box.
- **Masking:** none in this plan. Plan 5 masks snippets and previews.
- Never the live `~/.dsh` or port 3090. Commit messages go in a file and are committed with
  `git commit -F <file>`. No push.

## Review Focus

1. **A fast typist:** an answer for `茅` landing after the box already reads `茅台` is dropped,
   never drawn. Pinned in Task 2.
2. **Search while the list refreshes:** a `hostList` arriving mid-search keeps the query, the
   results and the box's focus and caret. Pinned in Task 3.
3. **A pinned conversation that no longer exists** (deleted, or never in this list): it is
   ignored, and no empty group or ghost row appears. Pinned in Task 4.
4. **The pin key on a row:** pressing it pins and does not open the conversation (the link
   sibling is untouched), and it is reachable by keyboard. Pinned in Task 5.
5. **The mux reconnects:** the workspace follow opens again, and the pin set is re-read from its
   new baseline, not kept stale. Pinned in Task 4.

---

### Task 1: The search view (pure)

**Files:**
- Create: `face/client/js/host/search-view.js`
- Test: `face/tests/client/search-view.test.js`

**Interfaces:**
- Produces:

```js
export const SEARCH_ITEMS = 20;
// [{id, title, channelLabel, at, archived, snippet}] — newest first, case-insensitive substring on title or channel label
export function titleMatches(conversations, channels, q) {}
// one list of at most 20: title matches first, then content items whose sessionId is a listed conversation and not already
// shown; an item names {id, title, channelLabel, at, archived: false|'face'|'host', snippet, match|null}
export function mergeResults({ titles, content, conversations, channels }) {}
// [{text, mark: boolean}] for a snippet and a [start, end] match; a missing or out-of-range match is one unmarked run
export function highlightRuns(snippet, match) {}
// 'idle' | 'searching' | 'results' | 'empty' | 'failed' from {query, titles, contentPhase: 'idle'|'loading'|'done'|'failed', merged}
export function searchPhase(state) {}
export const moreThanTwenty = (merged, hasMore) => {};   // true when hasMore or the merge overflowed
```

- A title match with no content hit takes the conversation's preview line as its snippet (D2),
  with `match` null.
- `channelLabel` uses `channelLabel` from `host/list-view.js`. A conversation in no channel reads
  `No channel`, and one on the desk reads `Desk`, as the groups read.
- A content item whose `sessionId` the store does not hold is dropped (D1).

- [ ] **Step 1: Write the failing tests:**
  - `a title matches at once, case-insensitive, by title or channel label, newest first`;
  - `content items join after the title matches, without repeating one`;
  - `an item the list does not know is dropped`;
  - `twenty at most, and more-than-twenty when hasMore or the merge overflowed`;
  - `a title match with no content hit shows its preview as the snippet`;
  - `highlight runs mark exactly the match, and a bad match marks nothing`;
  - `the phase: idle with no query, searching while content loads with no title hit, results, empty, failed keeps the title matches`.
- [ ] **Step 2: Run them and see them fail.** Run `npx tsx --test tests/client/search-view.test.js`
  in `face/`. Expected: FAIL.
- [ ] **Step 3: Implement `host/search-view.js`.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -F <file>`.

### Task 2: The search layer and its slice

**Files:**
- Create: `face/client/js/host/search.js`
- Modify: `face/client/js/reducers/host.js` (or a new `reducers/search.js`, added to
  `reducers/index.js`), `face/client/js/data/empty.js` (the slice's empty value)
- Test: `face/tests/client/host-search.test.js`

**Interfaces:**
- Consumes: `getJson`, the `timers` object `app.js` already passes to its layers.
- Produces:
  - the store slice `search: {query: '', contentPhase: 'idle', content: [], hasMore: false}`;
  - the reducers `setSearchQuery(q)`, `searchContent({query, items, hasMore})` (ignored unless
    `query` equals the slice's current query) and `searchFailed({query})`;
  - `startSearch({store, getJson, timers}) → {type(q), clear()}`. `type` dispatches
    `setSearchQuery` at once. When the trimmed query is non-empty, `type` waits
    `SEARCH_CONTENT_MS` (250) of quiet, then reads `/data/search?q=<encodeURIComponent>` and
    dispatches the answer under that query. A blank query cancels the wait and sets
    `contentPhase: 'idle'`. A 400, a 500 or a throw dispatches `searchFailed`.

- [ ] **Step 1: Write the failing tests** with fake timers and a fake `getJson`:
  - `typing waits 250 ms of quiet before reading`;
  - `an answer for an older query is dropped` (Review Focus 1);
  - `a blank box clears at once and reads nothing`;
  - `a failed read keeps the query and marks the content failed`;
  - `the query is sent encoded` (`茅台` gives `?q=%E8%8C%85%E5%8F%B0`).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 3: The box, the results and the keys

**Files:**
- Modify: `face/client/js/render/rail.js` (`renderList`), `face/client/js/app.js` (the `typed`
  input path for `data-action="convQuery"`, the ⌥⌘K and Esc keys, an `unarchive` from a result
  reusing `archiveNow`), `face/client/css/app.css`
- Test: `face/tests/client/rail.test.js`, `face/tests/client/app-dom.test.js`,
  `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 1's view and Task 2's `startSearch` and slice.
- Produces: the markup.
  - `div.conv-search` sits between `.list-head` and `.rail-rows`. It holds the `search` icon, an
    `input#cq` (`type="search"`, `data-action="convQuery"`, placeholder `Search conversations`,
    `aria-label="Search conversations"`) and a `kbd.conv-search-key` reading `⌥⌘K` (`Ctrl+Alt+K`
    off a Mac).
  - While a query stands, `div.conv-results` replaces `.rail-rows`. It holds the count head
    `div.conv-results-count`, then one `a.conv-hit` per item (`href="#/messages/<id>"`,
    `data-action="open"`, `data-id`). An item shows `span.row-title`, `span.row-time`, then
    `span.conv-hit-line` holding `b.conv-hit-channel` and the snippet's runs, with `mark` for the
    marked run. An archived hit adds `conv-hit archived` and a chip `Archived`.
  - A face-archived hit also gets a `button.btn-sm` `Un-archive` (`data-action="unarchive"`,
    `data-conv`). It is a sibling after the link, never inside it.
  - The states render as `div.conv-results-state`: the searching line with three skeleton bars
    (`div.sk`), the empty line, the more-than-twenty line, the failed line.

- [ ] **Step 1: Write the failing tests.**
  - In `rail.test.js`:
    - `the box sits under the list head with its placeholder and key hint`;
    - `a query replaces the groups with the results and their count`;
    - `the snippet's match is marked, and every host word is escaped` (a title `<b>` comes out
      as text);
    - `an archived hit is dim with its chip, and a face-archived one carries Un-archive beside the
      link`;
    - each state's line, word for word.
  - In `app-dom.test.js`:
    - `⌥⌘K focuses the box from the composer` (dispatch `keydown` with `code: "KeyK"`,
      `altKey`, `metaKey`, on a Mac platform);
    - `Esc clears the query, then a second Esc leaves the box, before any drawer closes`;
    - `a list refresh mid-search keeps the query, the results, the focus and the caret` (Review
      Focus 2).
  - In `css.test.js`: the new classes have rules, and `mark` uses the warn tokens.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - The box's value comes from the store, as Markets' does. The page's typed-value restore keeps
    the caret.
  - A query hides the draft row and the groups. It does not touch the groups' collapse
    preferences.
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 4: The pin set

**Files:**
- Modify: `face/client/js/host/live.js` (open `workspace/follow` beside `session/control`; reopen
  on its end or after a reconnect), `face/client/js/reducers/host.js` (`hostPins`),
  `face/client/js/data/empty.js` (`pinned: []`), `face/client/js/host/list-view.js` (`groupsOf`),
  `face/client/js/host/actions.js` (`pin`, `unpin`; `archive` unpins after it succeeds)
- Test: `face/tests/client/live.test.js`, `face/tests/client/list-view.test.js`,
  `face/tests/client/actions.test.js`

**Interfaces:**
- Produces:
  - the store field `pinned: string[]`, set by `hostPins(ids)`;
  - `actions.pin(sessionId) → boolean` and `actions.unpin(sessionId) → boolean`. Each calls its
    remote, dispatches `hostPins` with the answer's `pinnedSessionIds`, and on a throw says `Pin
    failed. Try again later.` (bad) and returns false. `actions.archive(id, true)` calls `unpin`
    after the archive succeeds when `id` is pinned, and un-archiving pins nothing (D7);
  - `groupsOf`: inside each group, pinned conversations come first, newest first, then the rest
    newest first (D6). An archived conversation is never sorted as pinned. Each conversation
    record the view hands the renderer gains `pinned: boolean`.

- [ ] **Step 1: Write the failing tests:**
  - in `live.test.js`, against its fake mux:
    - `the workspace follow's baseline sets the pin set and a pinned frame replaces it`;
    - `the follow opens again after the mux reconnects, and the new baseline wins` (Review
      Focus 5);
  - in `list-view.test.js`:
    - `pinned rows lead their group, newest first among themselves`;
    - `a pinned id the list does not hold is ignored` (Review Focus 3);
    - `an archived conversation is not sorted as pinned`;
  - in `actions.test.js`:
    - `pin and unpin send their remotes and set the pin set from the answer`;
    - `a failed pin says so on the status line and changes nothing`;
    - `archiving a pinned conversation unpins it after the archive succeeds; a failed archive
      unpins nothing`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 5: The pin on the row and in Details

**Files:**
- Modify: `face/client/js/render/rail.js` (`row`), `face/client/js/render/messages.js`
  (`rowKeys`), `face/client/js/icons.js` (`pin`), `face/client/js/app.js` (the `pin` and `unpin`
  actions), `face/client/css/app.css`
- Test: `face/tests/client/rail.test.js`, `face/tests/client/messages-screen.test.js`,
  `face/tests/client/app-dom.test.js`, `face/tests/client/css.test.js`

**Interfaces:**
- Produces: the markup.
  - A row becomes `div.row-wrap` holding today's `a.row` unchanged, followed by a sibling
    `button.pin-key` (`data-action="pin"` or `"unpin"`, `data-conv`, `aria-label` `Pin` or
    `Unpin`, with the `pin` icon). The key shows on `.row-wrap:hover` and `:focus-within`, in the
    place of the time.
  - A pinned row puts `span.row-pin` (the filled `pin` icon, 11 px) before its time.
  - An archived row has no pin key.
  - `rowKeys` gains `Pin` / `Unpin` (`btn-sm`) between Fork and Archive, absent for an archived
    conversation.

- [ ] **Step 1: Write the failing tests:**
  - `a pinned row carries the pin glyph before its time`;
  - `the pin key sits beside the row's link, never inside it, and an archived row has none`;
  - `pressing the pin key pins and does not open the conversation` (Review Focus 4, in
    `app-dom.test.js`: the route is unchanged after the click);
  - `the key is reachable by Tab` (it is a button with an accessible name);
  - `Details offers Pin between Fork and Archive, Unpin once pinned, nothing when archived`;
  - the CSS rules for `.row-wrap`, `.pin-key` and `.row-pin`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Keep every existing row assertion passing: the `a.row` markup inside
  the wrap is today's.
- [ ] **Step 4: Run them and see them pass,** then `npm test` and `npm run typecheck`.
- [ ] **Step 5: Commit.**

### Task 6: The documents and the build notes

**Files:**
- Modify: `DEVELOPMENT.md` (§5.1 files, §5.2 the wire for search, pins and the follow, §5.3 the
  host layer, §5.4 rendering, §5.5 the slice, §7.3 tests), `face/README.md` ("The page
  (client/)": search and pin; the transport drill gains a step that searches a Chinese word and
  pins a conversation in one browser, then sees it pinned in another), the spec
  (`## 14. Build notes, plan 2`, in the §13 form)

- [ ] **Step 1: Write the documents.** The counts come from a fresh `npm test` and
  `FACE_SMOKE=1 npm test`, run in `face/`.
- [ ] **Step 2: Commit.**
