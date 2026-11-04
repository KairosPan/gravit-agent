# dsh UI port, plan 5: the thread — secret masking, the turn rail and stats with earlier history, background jobs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A key pasted into a message is drawn masked wherever the face quotes it and still reaches
Gravit whole; a long conversation has a rail of its turns, a line of what it has spent and an
"Earlier messages" key that pages back without activating it; a conversation that runs a background
job shows the job, its output and a Stop.

**Architecture:** Three client-only pieces over host rows plan 1 already mounted (`job-controller`,
`session-stats`, `session-turn-outline`; nothing changes on the host). Masking is one pure text
module (`js/mask.js`) whose excerpt form keeps every string's length, drawn by the thread for the
operator's bubbles and by the list, the search results and the rail card for excerpts; what is
revealed is page state in `app.js`. Earlier history is a conversation `window` (`start`,
`through`, `hasMore`, `replaced`) that `host/live.js` keeps beside the messages, paged back with
`session/page {beforeSeq}` and prepended by a reducer; the two projections land on the conversation
as `outline` and `stats`, and a pure `host/turns-view.js` derives the ticks, the active turn and the
figures. The rail is its own container, `#turn-rail`, redrawn alone on a scroll or a hover. Jobs are
a pure `host/jobs-view.js` and an impure `host/jobs.js` (the `job/list` stream of the open
conversation into a `jobs` slice, one `job/follow` stream whose output stays in its memory and is
written into its `<pre>` by `textContent`, `job/kill`).

**Tech Stack:** Vanilla ES modules in `face/client/js`, the fake-DOM client suite
(`face/tests/client/`, `node --test` via tsx), dsh 0.2.1-rc.5's `session/page`, `session/follow`'s
snapshot, `session/projections` and `session/control` (`turnOutline` from
`@deepseek-ai/dsh-session-turn-outline`, `sessionStats` from `@deepseek-ai/dsh-session-stats`,
`tokenUsage` from `dsh-token-meter`), the `job` namespace of `@deepseek-ai/dsh-api-job-controller`
over `dsh-jobs`; the smokes in `face/tests/dsh-ui-port-smoke.test.ts`.

**Spec:** `docs/superpowers/specs/2026-11-03-dsh-ui-port-design.md` §5.7, §5.8, §5.9, §6 rows 6–8,
§7's masking, rail, jobs and drill lines, §9 item 7, §11, and A1, A2, A5, A8, P4, P5, D21–D26,
PLAN D16. Plans 1–4's build notes are its §13–§16; this plan's are its §17 (Task 11).

**Where the code differs from the spec, this plan follows the code** (read in `face/node_modules`
at rc.5):
- **The job wire takes `{request}`.** `job/list {request: {sessionId}}`, `job/follow {request:
  {sessionId?, jobId, from?}}`, `job/kill {request: {sessionId, jobId}}` (§13 found it for
  `job/list`; the other two are the same Remote). `job/list` and `job/follow` are streams on the
  page's mux; `job/kill` is a plain `call`.
- **A session sees its own jobs and every unowned one.** `JobController.list` streams "its own plus
  every unowned job" (`streamJobRows`); §5.8 says owner-fenced. The page draws what the stream gives;
  a `JobView` without `owner` is followed with `sessionId` omitted, as `JobFollowRequest` says.
  Nothing in the face starts an unowned job today.
- **A job's end is its `detail`.** `dsh-tool-bash` settles `completed` with `exit code: N`, or
  `killed` with `signal: X` or `killed before exit`; sandbox notes follow after `; `, and a human
  kill records `cancelled by the user` (`JobController.kill`), merged into `detail`. The page derives
  §5.8's end lines from it (Task 8).
- **The mux re-opens a stream after a reconnect** (`openMux`: every registry entry is opened again
  on the new socket, with its first args). A re-opened `job/list` starts with a whole-set `rows`
  frame, so jobs gone with a face restart vanish by themselves; a re-opened `job/follow` starts
  again from the oldest retained byte, so the page drops every chunk whose `at` is below the `next`
  it already holds.
- **A follow's snapshot is a window too.** `session/follow`'s snapshot is `{header, cursor, records,
  hasMore, projections}`, cut like a page at 50 messages (`DEFAULT_MAX_MESSAGES`), so a live
  conversation has earlier history as a cold one does. It is paged with `throughSeq` = the
  snapshot's `cursor`; a paged one with `throughSeq` = the cut's `asOfSeq`.
- **A page is a contiguous slice.** `paginate` returns `events.slice(cut, end)` with
  `end = min(throughSeq + 1, beforeSeq)` and the cut at a message group's earliest source, so a page
  asked with `beforeSeq` = the window's first seq ends just before it. Deduplication by seq stays a
  guard. A compaction's replace op in the loaded window can name seqs of a page loaded later: the
  window keeps every replace range it has seen, and a prepended page drops the messages they cover.
- **Turns are counted two ways.** `sessionStats.turns` counts turns with a closed step;
  `turnOutline` lists every started turn. The pills read `sessionStats`, the rail `turnOutline`.
- **`tokenUsage` is four totals** (`uncachedInputTokens`, `outputTokens`, `cacheReadTokens`,
  `cacheWriteTokens`). The tokens pill is Usage's Tokens in (uncached + cache reads) plus Tokens out,
  as `usageRows` counts them today; cache writes count in neither, as today.
- The rest checks out: `turnOutline` is `[{turn, seq, prompt, response}]`, strictly increasing by
  turn, `seq` the `turn/start`'s, `prompt` at most 50 and `response` at most 120 characters with a
  trailing `…` when cut, `response` `''` until `turn/end`; `sessionStats` is `{turns, steps, llmMs,
  toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens}`, all 0 until their first event; `JobView` and
  the three `JobFollowFrame`s are §5.8's; `job/kill` answers `{outcome: 'requested' |
  'already-finished'}` or throws `job/not-found`; `session/page` never activates a session.

**Where the spec leaves it to this plan:**
- **The shapes' bodies.** dsh's `ui-secret-mask` is not installed (no dsh client-ui package is), so
  its own cases cannot be run here. The shapes are §5.9's list with the bodies Task 1 fixes, and the
  tests are those shapes, D25's two and the non-matches.
- **Excerpts mask whoever spoke.** §5.9 names the list's preview line, a search snippet and the rail
  card without a speaker; a preview or a snippet is often Gravit's words. The plan masks every
  excerpt whole and keeps bubbles to the operator's own (operator question 1).
- **A copy carries the original by markup, not by a handler.** A masked value is drawn as its
  original text, transparent and selectable, laid exactly over its mask (the same mono font and the
  same number of characters), the mask itself unselectable; a selection across it copies the
  original with no `copy` listener (Task 2). The drill checks it in a browser.

## Global Constraints

- **Copy, verbatim (English):**
  - the eye key: `aria-label="Show secret"`, then `aria-label="Hide secret"`;
  - the earlier key: `Earlier messages`; while it loads `Loading…` (disabled);
  - the rail: `aria-label="Turns"`; a tick `aria-label="Turn <n>"`; the card's head `Turn <n> · jump`
    (drawn in capitals by CSS);
  - the pills: `<t> turn(s) · <s> step(s) · <v> tok/s` (singular for 1; the speed part only when
    `decodeMs > 0`) and `<k> tokens · cache <p>%` (the cache part only when its denominator is not
    0); tokens as `compactTokens`: under 1,000 the number, under 10,000 one decimal and `k` (`4.2k`),
    under 1,000,000 rounded `k` (`182k`), else one decimal and `M`;
  - Usage's rows, in this order: `Tokens in`, `Tokens out`, `Context` (as today), then `Cache hit`
    (`63%`), `Turns · steps` (`7 · 41`), `Model time`, `Tool time`, `First token` (the average),
    `Speed` (`38 tok/s`); each new row only when its figure exists;
  - durations: `durationText` (Usage): under 10 s one decimal (`1.4 s`), under 60 s whole (`42 s`),
    under an hour `4m 12s`, else `1h 04m`; `clockText` (a job): `42s`, `3m 04s`, `1h 04m`;
  - the jobs chip: `1 job running`, `2 jobs running` (running and stopping count), `2 jobs finished`
    when none runs; the section `Background jobs`; a stopping job's key slot `Stopping`; the fold
    `Finished · <n>` with `Clear`; the confirm `Yes, stop`; the dropped line `… earlier output
    dropped …`; the empty output `(no output)`; the end lines `exit <n>`, `signal <x>`, `killed`,
    `failed`; Copy `aria-label="Copy command"`; a failed kill on the status line `stop: <code>`
    (`host/actions.js`'s `fail` format).
- **Wire:**
  - `session/page {request: {address: {kind: 'session', sessionId}, throughSeq, beforeSeq,
    maxMessages: 50}}` → `{records, hasMore}`;
  - the follow snapshot's `cursor` and `hasMore`; `session/projections`' `values.turnOutline` and
    `values.sessionStats`; `session/control`'s `{type: 'projection', sessionId, key, value, seq}`;
  - `job/list`, `job/follow` over `mux.stream`, `job/kill` over `call`, each with `{request}`.
- **Masking is display only (A2).** `maskSpans` and `maskExcerpt` never change what is sent, stored
  or copied; the draft is never masked; Gravit's, a bot's and the host's bubbles, context rows, the
  composed answer, titles and a job's command and output are never masked (§5.9).
- **The client rules:** every host string passes through `esc()`, an attribute through `attrs`;
  `app.css` names no hex; `css.test.js` holds both ways. No read is issued from `render()`; a read
  starts from an action, a route change or a stream. Nothing large rides the store: a job's output
  stays in `host/jobs.js`. Stream renders run 10–20 a second: the masking of a text is memoized, the
  rail's markup is memoized on its inputs, and a scroll or a hover redraws `#turn-rail` alone, never
  the page.
- **PLAN D16 / A8:** earlier history and the job list never activate a session; `viewFor`, `open`,
  `reconcile` and `promote` do not change. Plan 3's rc.5 finding stands: `commands/*` resume a cold
  session, so the `/` menu's guard (`host/composer.js`, `conv.live`) is untouched here.
- **The Escape order** is unchanged: an open menu, the lightbox, the search box, then today's chain
  (an open confirm, then Details). No new key is bound.
- **A1:** no tool call is drawn; a job is drawn in Details, as a job.
- **Out of this plan:** the words tables, fonts, sizes and the shortcut sheet (plan 6); 中文 (plan 7).
- Never the live `~/.dsh`, never port 3090, never `npm run service`. A smoke runs from a checkout
  outside `/tmp` and `$TMPDIR`. Commit messages go in a file and are committed with
  `git commit -F <file>`. No push.

## Review Focus

1. **A compaction across a page boundary.** The loaded window holds a compaction whose replace op
   names seqs the next earlier page brings back: those messages are not drawn, in the page loaded
   now or after a reconnect's snapshot. Pinned in Task 3.
2. **A reconnect while reading earlier history.** The follow ends and a new snapshot lands while the
   operator reads two pages up: the earlier pages stay, the thread does not jump to the tail, and
   "Earlier messages" still pages on from where it was. Pinned in Tasks 3 and 4.
3. **A key cut by an excerpt's ellipsis.** The rail card's 50-character prompt or a 240-character
   snippet ends in the middle of a key, below its shape's minimum body: the visible part past its
   first 8 characters is still masked, and the excerpt keeps its length so the snippet's match
   still marks the right characters. Pinned in Task 1.
4. **Streaming output while a job is open.** Output frames arrive at the host's 100 ms cadence and
   stream renders at 10–20 a second: the job's `<pre>` is written by `textContent` on each frame
   and after each render, the page is not rendered by a frame, and a reconnect's re-opened follow
   repeats no chunk. Pinned in Tasks 8 and 9.
5. **A rail click on an unloaded turn when the conversation changes mid-paging.** The operator
   clicks an early tick, then opens another conversation before the pages land: nothing is
   prepended to either, the pulse clears, and the new conversation's thread starts at its tail.
   Pinned in Tasks 3 and 7.

---

### Task 1: The masking module (pure)

**Files:**
- Create: `face/client/js/mask.js`
- Test: `face/tests/client/mask.test.js`

**Interfaces:**
- Produces:

```js
// Run = {type: 'text', text} | {type: 'secret', text /* the original */, masked /* same length */}
export const KEEP = 8;
export function maskSpans(text) {}   // → Run[]; memoized by text (a Map of at most 500 entries, cleared when full)
export function maskExcerpt(text) {} // → string, the masked form of every run, with the clip rule; length === text.length
```

- **The shapes**, each bounded on both sides by a character outside `[A-Za-z0-9_]` (or the text's
  edge):
  - `sk-[A-Za-z0-9_-]{20,}` with a digit in its body; `AIza[0-9A-Za-z_-]{35}`;
    `gh[pousr]_[A-Za-z0-9]{36,}`; `github_pat_[A-Za-z0-9_]{22,}`; `glpat-[A-Za-z0-9_-]{20,}`;
    `npm_[A-Za-z0-9]{36}`; `hf_[A-Za-z0-9]{30,}`; `(AKIA|ASIA)[A-Z0-9]{16}`; `LTAI[A-Za-z0-9]{12,}`;
    `AKID[A-Za-z0-9]{13,}`; `xox[abprs]-[A-Za-z0-9-]{10,}`; `(sk|rk)_(live|test)_[A-Za-z0-9]{16,}`;
    `whsec_[A-Za-z0-9+/=]{20,}`;
  - a JWT: `eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`;
  - D25: a Telegram bot token `\d{8,10}:[A-Za-z0-9_-]{35}`; an Alpaca key id `(PK|AK)[A-Z0-9]{18}`;
  - each keeps its first `KEEP` characters; every later character is `*`;
  - a private-key block `-----BEGIN [A-Z ]*PRIVATE KEY-----` … `-----END [A-Z ]*PRIVATE KEY-----`:
    the BEGIN and END lines and every line break kept, every other character `*`;
  - the password of `<scheme>://<user>:<password>@`: the password alone, every character `*`.
- **Not masked:** `password=…`, a password in prose, a shape short of its body, `sk-` with no digit.
- **The clip rule (Review Focus 3), excerpts only:** when the text ends with `…`, the token just
  before it (back to whitespace) that starts with one of the prefixes (`sk-`, `AIza`, `gh?_`,
  `github_pat_`, `glpat-`, `npm_`, `hf_`, `AKIA`, `ASIA`, `LTAI`, `AKID`, `xox?-`, `sk_live_`,
  `sk_test_`, `rk_live_`, `rk_test_`, `whsec_`, `eyJ`) keeps `KEEP` characters (or its prefix, if
  shorter) and the rest is `*`.

- [ ] **Step 1: Write the failing tests:**
  - `each prefix shape keeps 8 characters and masks the rest, one asterisk per character` (one
    sample per shape, `masked.length === text.length`, `masked.slice(0, 8) === text.slice(0, 8)`);
  - `sk- needs 20 characters with a digit` (`sk-abcdefghijklmnopqrstuv` not masked);
  - `a JWT, a Telegram token and an Alpaca key id are masked; a 17-character PK… is not`;
  - `a private-key block keeps its BEGIN and END lines and its line breaks`;
  - `a URL password is masked whole and the user kept` (`postgres://app:hunter2@db/x` →
    `postgres://app:*******@db/x`);
  - `password=… and a password in prose are not masked`;
  - `a key inside a longer word is not masked, one beside punctuation is` (`xsk-…` no; `(sk-…)` yes);
  - `maskSpans gives text and secret runs in order, the originals untouched`;
  - `maskExcerpt keeps the length for every shape and for a text with none`;
  - `the clip rule masks a key cut by the trailing ellipsis below its shape's minimum`
    (`… key sk-proj-12ab…` masks after `sk-proj-`; the same without `…` is not masked);
  - `the same text twice returns the same runs (memoized)`.
- [ ] **Step 2: Run them and see them fail.** Run `npx tsx --test tests/client/mask.test.js` in
  `face/`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement `mask.js`.** One combined scan, left to right; overlapping matches take
  the earliest start, then the longest.
- [ ] **Step 4: Run them and see them pass,** then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -F <file>`.

### Task 2: Masking on screen: the operator's bubbles, the preview line, the search snippet

**Files:**
- Modify: `face/client/js/render/thread.js` (`youText`, `youMessage`, `renderMessage`,
  `renderThread` gain a `page` argument), `face/client/js/render/messages.js`
  (`renderMessagesScreen(state, now, composer, page = {})`), `face/client/js/render/rail.js` (the
  row's preview, a result's snippet), `face/client/js/app.js` (`revealed`, the `toggleSecret`
  action, `render()` passing `{revealed}`), `face/client/js/icons.js` (`eye`, `eyeOff`),
  `face/client/css/app.css`
- Test: `face/tests/client/thread.test.js`, `face/tests/client/rail.test.js`,
  `face/tests/client/app-dom.test.js`, `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 1's `maskSpans`, `maskExcerpt`.
- Produces:
  - `renderThread(conv, state, now, page = {})`; `page.revealed` is a `Set` of
    `<convId>|<msgId>|<n>` (`n` counts the message's secrets from 0, across its runs);
  - a masked value: `span.secret` (`data-secret="<msgId>-<n>"`) holding `span.secret-raw` (the
    original, escaped) and `span.secret-mask` (`aria-hidden="true"`, the masked text), then
    `button.secret-eye` (`type="button"`, `id="secret-<msgId>-<n>"`, `data-action="toggleSecret"`,
    `data-secret="<msgId>-<n>"`, `aria-label="Show secret"`, the `eye` icon at 14 px); revealed, the
    span carries `revealed`, has no mask and the key reads `Hide secret` with `eyeOff`;
  - excerpts draw `esc(maskExcerpt(text))` with no eye: the row's preview line, and a result's
    snippet, masked before `highlightRuns` (the length is kept, so the match's offsets stand).
- **`app.js`:** `revealed` is a `Set` outside the store; `toggleSecret` adds or removes
  `<openId>|<data-secret with its last '-' as '|'>` and renders; leaving the conversation on screen
  (its id differs from `last.thread` at a render) clears it (D26). Focus stays on the eye by its id.
- **CSS:** `.secret` `display: inline-block; max-width: 100%; position: relative; font-family:
  var(--font-mono); font-size: 0.875em; word-break: break-all; white-space: pre-wrap` on
  `--surface-2` at `var(--radius-s)`; `.secret-raw` absolute over the box, `color: transparent`;
  `.secret-mask` `user-select: none`; `.secret.revealed .secret-raw` static and in `--text`;
  `.secret-eye` a 20 px icon key.

- [ ] **Step 1: Write the failing tests:**
  - in `thread.test.js`:
    - `the operator's key is drawn masked with its eye, the original in the raw run`
      (`sk-proj-…` → `secret-mask` holds `sk-proj-` and asterisks; `secret-raw` the key);
    - `two keys in one message are secrets 0 and 1; a revealed one draws Hide secret and no mask`;
    - `a key in Gravit's bubble, a bot's, a context row and a composed answer is not masked`;
    - `a conversation chip beside a key keeps its chip, and a secret's text is escaped`
      (`<b>` inside a URL password comes out as text);
  - in `rail.test.js`:
    - `the preview line is masked, with no eye`;
    - `a snippet holding a key is masked and its match still marks the same characters`;
  - in `app-dom.test.js`:
    - `Show secret reveals the value, a render keeps it, and opening another conversation masks it again`;
    - `the eye keeps focus as its label flips`;
  - in `css.test.js`, the harvest gains a masked and a revealed bubble; `.secret-mask` carries
    `user-select: none`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 3: The history window in the live layer: earlier pages, prepended by seq

**Files:**
- Modify: `face/client/js/host/live.js` (`windowOf`, `applySnapshot`, `follow`, `page`, a new
  `earlier`), `face/client/js/reducers/host.js` (`hostWindow`, `hostEvent`, `hostList`, new
  `hostEarlier`, `hostEarlierLoading`)
- Test: `face/tests/client/live.test.js`, `face/tests/client/host-reducers.test.js`

**Interfaces:**
- Produces:
  - a conversation's `window = {start, through, hasMore, replaced: Array<[number, number]>,
    loading?: true}`: `start` the first record's seq (0 with none), `through` the follow's `cursor`
    or the page's `asOfSeq`, `hasMore` the host's (false when absent), `replaced` every replace range
    the window has folded or the stream has delivered;
  - `windowOf(convId, records) → {messages, start, replaced}` (inside `live.js`);
  - `hostWindow {convId, messages, created, window}`: with no `window`, as today (the whole window,
    replaced). With one, the old messages whose seq is below the new `start`, not a gate and in no
    range of the union of the old and new `replaced`, are kept before the new ones, and
    `window.start` is the lower of the two (Review Focus 2);
  - `hostEvent`: a message carrying `replace` also appends `[start, end]` to `window.replaced`;
  - `hostEarlier {convId, messages, start, hasMore}`: prepends the messages whose seq is below the
    current `window.start`, whose id is not drawn and which no `replaced` range covers; sets
    `start` to the lower and `hasMore` to the page's; clears `loading`;
  - `hostEarlierLoading {convId, on}`;
  - `hostList` keeps `window`, `outline` and `stats` on a surviving conversation;
  - `live.earlier(id, {toSeq} = {}) → Promise<boolean>`: only for the conversation on screen, with a
    window, not `failed` and `hasMore`; one `session/page` of `maxMessages: 50` with
    `throughSeq: window.through` and `beforeSeq: window.start`, repeated while `toSeq` is given, the
    pages' start is still above it and `hasMore` holds (at most 200 pages); the pages are folded with
    `windowOf` and land in one `hostEarlier`; true when they landed. The open token (`openSeq`) is
    read before and after each page: another conversation opened meanwhile drops the pages, clears
    `loading` and answers false (Review Focus 5). A refused page says `earlier: <code>` and answers
    false. A second call while one runs answers the first's promise.

- [ ] **Step 1: Write the failing tests:**
  - in `host-reducers.test.js`:
    - `a window without a window field replaces the messages whole, as before`;
    - `a new snapshot keeps the earlier pages below its start and the lower start`;
    - `a kept or prepended message a replace range covers is dropped` (a compaction in the window
      naming seqs 3–9; a page bringing 1–9 prepends 1 and 2 only) (Review Focus 1);
    - `hostEarlier prepends below the start, drops a duplicate id, and takes the page's hasMore`;
    - `a streamed replace op joins the window's ranges`;
    - `hostList keeps the window, the outline and the stats`;
  - in `live.test.js`:
    - `a follow's snapshot sets the window from its records, cursor and hasMore; a page from asOfSeq and its hasMore`;
    - `earlier pages with beforeSeq at the window's start and throughSeq at its through, maxMessages 50`;
    - `earlier with toSeq pages until the start reaches it, and dispatches once`;
    - `earlier on a conversation with no more history, or not on screen, calls nothing`;
    - `a conversation opened mid-paging drops the pages and clears loading` (Review Focus 5);
    - `a refused page says earlier: code and keeps the window`;
    - `earlier never opens a follow` (the mux's streams are unchanged after it).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `follow` keeps the snapshot's `cursor` and `hasMore`; `page` keeps
  `asOfSeq` and the page's `hasMore`; both reach `applySnapshot`, which dispatches the window.
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 4: The thread box, the earlier key and the scroll kept on a prepend

**Files:**
- Modify: `face/client/js/render/messages.js` (`renderMessagesScreen`: `div.thread-box` around the
  thread and an empty `nav#turn-rail`; the earlier key), `face/client/js/app.js` (the `earlier`
  action; `render()`'s thread scroll), `face/client/css/app.css` (`.thread-box`, `.earlier-key`, and
  the `with-drawer` margins and the 860 px rule naming `.thread-box`)
- Test: `face/tests/client/messages-screen.test.js`, `face/tests/client/app-dom.test.js`,
  `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 3's `window`, `live.earlier`.
- Produces:
  - a conversation draws `<div class="thread-box"><div class="thread" id="thread">…</div><nav
    class="turn-rail" id="turn-rail" aria-label="Turns">…</nav></div>`; New message and the empty
    state keep their bare `.thread`;
  - first inside the thread while `window.hasMore`: `button.earlier-key` (`type="button"`,
    `id="earlier-<convId>"`, `data-action="earlier"`, `data-conv`) reading `Earlier messages`, or
    `Loading…` with `disabled` while `window.loading` (D22);
  - `earlier` calls `live.earlier(id)`;
  - `render()`'s `threadAt` also keeps `scrollHeight`; on the same conversation, when its
    `window.start` is below the one last drawn, `scrollTop = threadAt.top + (scrollHeight −
    threadAt.height)`, whether or not the thread stood at the bottom; otherwise the rule is today's.
- **CSS:** `.thread-box` takes the thread's old flex place (`flex: 1 1 auto; min-height: 0;
  position: relative; display: flex; flex-direction: column`), `.thread` keeps its rules and gains
  `position: relative` (the marks' offset parent, Task 7); `.main.with-drawer > .thread-box` takes
  the 400 px and 460 px margins beside `.head` and `.composer`; at 860 px or narrower `.thread-box`
  is a block and `.turn-rail` is not drawn; `.earlier-key` a quiet centred `btn-sm`.

- [ ] **Step 1: Write the failing tests:**
  - in `messages-screen.test.js`:
    - `a conversation's thread sits in its box beside an empty rail; New message keeps a bare thread`;
    - `Earlier messages shows while the window has more, Loading… disabled while it loads, nothing without more`;
  - in `app-dom.test.js`:
    - `Earlier messages pages back, and the thread keeps its place as the page lands above it`
      (the fake `#thread` at `scrollTop` 0 and `scrollHeight` 1000, then 1600 after the prepend:
      `scrollTop` 600);
    - `a reconnect's snapshot while reading up keeps the place and the earlier pages` (Review Focus 2);
    - `at the tail, a streamed message still follows the tail`;
  - in `css.test.js`: the harvest gains the box and the key; `.main.with-drawer > .thread-box`
    carries the 400 px margin.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`. The existing selectors on `.thread`
  in `app-dom.test.js` still pass.
- [ ] **Step 5: Commit.**

### Task 5: The outline and the stats in the store, and their pure view

**Files:**
- Modify: `face/client/js/reducers/host.js` (`hostProjection`: `turnOutline`, `sessionStats`)
- Create: `face/client/js/host/turns-view.js`
- Test: `face/tests/client/host-reducers.test.js`, `face/tests/client/turns-view.test.js`

**Interfaces:**
- Produces:
  - `hostProjection` `turnOutline` → `conv.outline`: the array kept when every entry has an integer
    `turn` and `seq` and string `prompt` and `response`, else unchanged; `sessionStats` →
    `conv.stats` when all eight fields are finite numbers, else unchanged;

```js
// host/turns-view.js
export function railView(conv) {}   // → {show, ticks: [{turn, seq, loaded, prompt, response}]}
export function activeTurn(marks, scrollTop) {} // marks [{turn, top}] in order → the last whose top ≤ scrollTop + 8, else the first's, or null
export function statsView(stats, tokenUsage) {} // → null until stats.steps ≥ 1, else
//   {turns, steps, speed /* tok/s or null */, tokens, cache /* 0..1 or null */, modelMs, toolMs, firstTokenMs /* or null */}
export function pillsText(view) {}  // → [string, string]
export function compactTokens(n) {}
export function durationText(ms) {}
export function clockText(ms) {}
```

- **`railView`:** `show` when the conversation is `loaded` and `outline` holds two or more turns; a
  tick is `loaded` when the window has no more history or `seq >= window.start`.
- **`statsView`:** speed `decodeTokens / (decodeMs / 1000)`, rounded, null when `decodeMs` is 0;
  first token `ttftMs / ttftSteps`, null when `ttftSteps` is 0; tokens `uncachedInputTokens +
  cacheReadTokens + outputTokens`; cache `cacheReadTokens / (uncachedInputTokens + cacheReadTokens)`,
  null when that is 0; model and tool time `llmMs`, `toolMs`.

- [ ] **Step 1: Write the failing tests:**
  - in `host-reducers.test.js`: `the outline and the stats land on the conversation; a malformed value keeps what was`;
  - in `turns-view.test.js`:
    - `the rail shows from two turns, on a loaded conversation only`;
    - `a tick is loaded at or after the window's start, every tick when nothing is earlier`;
    - `the active turn is the last mark at or above the view's top, the first above them all`;
    - `no stats until the first step has finished`;
    - `the figures: 38 tok/s, cache 63%, first token the average, no speed without decode time`;
    - `the pills read singular and plural, and drop a part with no figure`
      (`7 turns · 41 steps · 38 tok/s`, `182k tokens · cache 63%`, `1 turn · 1 step`);
    - `tokens, durations and clocks read as the constraints write them` (`compactTokens(4210)` →
      `4.2k`, `182400` → `182k`, `1_250_000` → `1.3M`; `durationText(1400)` → `1.4 s`, `42000` →
      `42 s`, `252000` → `4m 12s`, `3_840_000` → `1h 04m`; `clockText(184000)` → `3m 04s`).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 6: The pills and Usage, and Details opened at a section

**Files:**
- Modify: `face/client/js/render/messages.js` (`usageRows` gains the stats; `renderDetails`'
  Usage section `id="dsec-usage"`; a new `statsPills(conv)`; the conversation's foot),
  `face/client/js/reducers/controls.js` (`openDetails`), `face/client/js/app.js` (the `openUsage`
  action, `detailsAt`), `face/client/css/app.css`
- Test: `face/tests/client/messages-screen.test.js`, `face/tests/client/reducers.test.js`,
  `face/tests/client/app-dom.test.js`, `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 5's `statsView`, `pillsText`, `durationText`.
- Produces:
  - `usageRows(conv)` (it takes the conversation now): today's three rows, then D21's six from
    `statsView(conv.stats, conv.usage?.tokenUsage)`; the section draws when any row exists;
  - in a conversation, after the composer: `div.thread-foot` holding `renderStatus(state.status)`
    and, when `statsView` is not null, `button.stats-pill` × 2 (`type="button"`,
    `data-action="openUsage"`) with `pillsText`; nothing when both are empty; New message and the
    empty state keep `renderStatus` alone;
  - `openDetails` opens Details and never closes it;
  - `app.js`: `openUsage` dispatches `openDetails` and sets `detailsAt = 'dsec-usage'`; after a
    render, an element with that id is scrolled into view (`scrollIntoView({block: 'start'})`, after
    the drawer's own scroll restore) and `detailsAt` clears (Task 9 sets `dsec-jobs` the same way).

- [ ] **Step 1: Write the failing tests:**
  - in `messages-screen.test.js`:
    - `Usage keeps its three rows and gains cache hit, turns and steps, model and tool time, first token and speed`
      (the existing `59,323` and `2,411` rows still pass);
    - `the pills show after the first step, right of the status line, and open Usage`;
    - `no stats, no pills: the foot is the status line alone, or nothing`;
  - in `reducers.test.js`: `openDetails opens Details and leaves it open`;
  - in `app-dom.test.js`: `a pill opens Details scrolled to Usage` (a fake `#dsec-usage` records
    its `scrollIntoView`);
  - in `css.test.js`: the harvest gains the foot and the pills.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 7: The turn rail in the page: the marks, the ticks, the card, the jump

**Files:**
- Modify: `face/client/js/render/thread.js` (the marks in `renderThread`; `railHtml`),
  `face/client/js/render/messages.js` (the rail's container filled), `face/client/js/app.js`
  (`rail` page state; the `jumpTurn` action; the capturing `scroll` listener; `mouseover`,
  `mouseout` and `focusin` on a tick; the pending jump after a render), `face/client/css/app.css`
- Test: `face/tests/client/thread.test.js`, `face/tests/client/app-dom.test.js`,
  `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 1's `maskExcerpt`; Task 3's `live.earlier`; Task 5's `railView`, `activeTurn`.
- Produces:
  - **the marks:** before drawing a message with a numeric seq (and before its divider), one
    `div.turn-mark` (`id="turn-<convId>-<turn>"`, `data-turn`) for each loaded tick whose seq is
    below that message's and not yet marked; the loaded ticks left go at the end. A mark has no
    height and cancels the thread's gap (`margin-bottom: -6px`);
  - **`railHtml(conv, {active, hover, pulse}) → string`** (the inside of `#turn-rail`; `''` when
    `railView` does not show), memoized on `(conv.outline, conv.window, active, hover, pulse)` in a
    one-entry cache: per tick a `div.turn-row` holding `button.turn-tick` (`type="button"`,
    `id="turn-tick-<turn>"`, `data-action="jumpTurn"`, `data-turn`, `aria-label="Turn <n>"`,
    classes `loaded`, `active`, `pulse`); the hovered tick's row also holds `div.turn-card`
    (`role="tooltip"`): `div.turn-card-head` `Turn <n> · jump`, `div.turn-card-prompt`
    (`maskExcerpt(prompt)`, one line) and, when `response` is not empty, `div.turn-card-reply`
    (`maskExcerpt(response)`, up to three lines);
  - **`app.js`'s `rail = {active, hover, pulse, jump}`**, reset when the conversation on screen
    changes (Review Focus 5); `render()` passes it on. A scroll on `#thread`, coalesced to one
    `timers.after(80)`, reads the `.turn-mark` elements' `offsetTop`, computes `activeTurn`, and on a
    change writes `railHtml` into `#turn-rail` alone (the page is not rendered), keeping focus on a
    tick by its id. After a render whose rail inputs changed, the same measure runs once. A hover or
    a focus on a tick sets `hover` and redraws `#turn-rail` alone; leaving the rail clears it;
  - **`jumpTurn`:** a loaded tick scrolls its mark into view (`scrollIntoView({behavior: 'smooth',
    block: 'start'})`). An unloaded one sets `pulse` and `jump` to it and calls `live.earlier(id,
    {toSeq: tick.seq})`; after the render that draws its mark, the mark is scrolled into view and
    `pulse` and `jump` clear; an answer of false clears them and redraws the rail.
- **CSS:** `.turn-rail` absolute on the box's right edge, 28 px wide, from the thread's top to its
  bottom, a column of `.turn-row`s (`flex: 0 1 10px; min-height: 3px`), centred; a tick's line 2 px
  tall, 40 % wide and faint, `loaded` 60 %, `active` full width in `--primary`; `pulse` an opacity
  animation; `.turn-card` absolute left of the rail, at most 300 × 100, on `--surface` with
  `--border`; `.turn-card-head` capitals; `.turn-rail:empty` not drawn; not drawn at 860 px or
  narrower.

- [ ] **Step 1: Write the failing tests:**
  - in `thread.test.js`:
    - `a mark precedes each loaded turn's first message, an unloaded turn has none`;
    - `the rail draws a tick per turn, loaded and active as told, nothing under two turns`;
    - `the hovered tick's card reads its turn, its masked prompt and, once finished, its reply`
      (a prompt holding a key comes out masked; a turn with `response: ''` has no reply line);
    - `the rail's markup is the same string for the same inputs` (`railHtml` twice →
      `Object.is`-equal strings, and a different `active` a different one);
  - in `app-dom.test.js`:
    - `a scroll redraws the rail alone with the active turn, and the page is not rendered`
      (the fake's `writes` count unchanged; `#turn-rail`'s `innerHTML` holds `active` on the
      mark the scroll passed);
    - `hovering a tick draws its card in the rail alone`;
    - `a loaded tick scrolls its mark into view`;
    - `an unloaded tick pulses, pages back to it and scrolls to its mark once drawn`;
    - `a conversation opened while the pages load clears the pulse and the jump` (Review Focus 5);
  - in `css.test.js`: the harvest gains a rail with each tick state and a card.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 8: Background jobs: the pure view and the host layer

**Files:**
- Create: `face/client/js/host/jobs-view.js`, `face/client/js/host/jobs.js`,
  `face/client/js/reducers/jobs.js`
- Modify: `face/client/js/reducers/index.js`, `face/client/js/data/empty.js` (`jobs: {convId: null,
  rows: [], open: null, cleared: {}}`)
- Test: `face/tests/client/jobs-view.test.js`, `face/tests/client/host-jobs.test.js`,
  `face/tests/client/host-reducers.test.js`

**Interfaces:**
- Consumes: Task 5's `clockText`.
- Produces:

```js
// host/jobs-view.js
export const isLive = job => {};             // 'running' | 'stopping'
export function jobsView(slice, convId) {}   // → {running: JobView[], finished: JobView[] /* not cleared */, chip: string | null}
export function chipText(running, finished) {}
export function endLine(job) {}              // 'exit 3' | 'signal SIGTERM' | 'killed' | 'failed' | '' while live
export function metaLine(job, now) {}        // `${kind} · ${progress | endLine} · ${clock}`, empty parts left out
// reducers/jobs.js
// watchJobs(convId | null): a new conversation empties rows and open; hostJobs({convId, jobs}): rows replaced whole, for the watched one only;
// openJob(id) / closeJob(); clearJobs(convId): the finished ids join cleared[convId]
// host/jobs.js
export const JOB_OUTPUT_KEEP = 262144;      // characters of output kept in memory per open job, the head dropped first
export function startJobs({ store, mux, call, onOutput = () => {} }) {
  return {
    watch(convId) {},          // cancels the list stream it had; opens job/list for convId (none for null); rows → hostJobs
    follow(convId, job) {},    // cancels the follow it had; opens job/follow, sessionId omitted for a job with no owner
    unfollow() {},
    outputOf(jobId) {},        // → {text, ended} for the followed job, else null
    async kill(convId, jobId) {}, // job/kill; true on requested or already-finished; a throw says stop: <code> (or the sign-in line on a 401) and answers false
  };
}
```

- **`endLine`:** `completed` → `exit <n>` from `exit code: <n>` (else `exit`); `killed` →
  `signal <x>` from `signal: <x>` (else `killed`); `failed` → `failed`.
- **The output:** `opened` resets the text, starting with `… earlier output dropped …` and a line
  break when its `job.output.earliest` is above 0; each `output` frame appends its chunks in order,
  skipping a chunk whose `at` is below the `next` already held (Review Focus 4), the dropped line
  before a chunk carrying `gapBefore` and before the frame's chunks when `lossy`; past
  `JOB_OUTPUT_KEEP` the head is cut and the text starts with the dropped line. `status` marks it
  ended. Each frame calls `onOutput(jobId)`; nothing is dispatched for output.
- **The chip:** `chipText` reads the constraints' words; null when the conversation shows no job.

- [ ] **Step 1: Write the failing tests:**
  - in `jobs-view.test.js`:
    - `running and stopping are live; finished jobs leave out the cleared`;
    - `the chip: 1 job running, 2 jobs running, 2 jobs finished, none`;
    - `the end lines from bash's details, sandbox notes and a human kill's reason included`
      (`exit code: 3; <note>` → `exit 3`; `signal: SIGTERM` → `signal SIGTERM`; `killed before exit`
      → `killed`; `failed` → `failed`);
    - `the meta line: kind, progress while live, the end once finished, the clock`
      (`bash · page 7 of 12 · 3m 04s`);
  - in `host-reducers.test.js`: `rows land for the watched conversation only; watching another empties them; clear hides the finished`;
  - in `host-jobs.test.js` (a fake mux recording streams and their args):
    - `watch opens job/list with {request: {sessionId}}, replaces it on another conversation, and opens none for null`;
    - `rows frames replace the slice whole; a re-opened stream's empty rows empty it`;
    - `follow opens job/follow with {request: {sessionId, jobId}}, without sessionId for an unowned job`;
    - `output appends in order, marks a head the host dropped, a gap and a lossy frame, and calls onOutput without dispatching`;
    - `a re-opened follow repeats no chunk` (an `opened` from 0 after 300 bytes, then the same
      chunks again: the text unchanged) (Review Focus 4);
    - `the kept output is capped from the head and starts with the dropped line`;
    - `kill calls job/kill with {request: {sessionId, jobId}}; a throw says stop: job/not-found and answers false`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 9: Background jobs on screen: the chip, Details' section, the output, Stop

**Files:**
- Modify: `face/client/js/render/messages.js` (`headRight`, `renderDetails`, a new
  `jobsSection`), `face/client/js/app.js` (`startJobs` from `host.jobs` or with `live.mux` and
  `call`; `jobs.watch` in `follow()`; the `openJobs`, `openJob`, `stopJob` and `clearJobs`
  actions; `confirmYes`'s `stopJob`; the output written after a render and on `onOutput`; the
  clocks), `face/client/css/app.css`
- Test: `face/tests/client/messages-screen.test.js`, `face/tests/client/app-dom.test.js`,
  `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 8's `jobsView`, `metaLine`, `endLine`, `startJobs`; Task 6's `openDetails` and
  `detailsAt`; `confirmPair`; the `copyText` action.
- Produces:
  - **the chip** in `headRight`, before Working, while `jobsView(...).chip`: `button.jobs-chip`
    (`type="button"`, `data-action="openJobs"`) with a dot (`live` while one runs), the chip's words
    and `chevDown`; `openJobs` dispatches `openDetails` and sets `detailsAt = 'dsec-jobs'`;
  - **the section** `section.dsec#dsec-jobs` (`Background jobs`) right after This task, while the
    conversation shows a job (P4): per running job a `div.job` holding `details#job-<id>` (`open`
    while `jobs.open` is it) whose `summary` (`data-action="openJob"`, `data-job`) holds a dot,
    `code.job-cmd` (the label, escaped, one line) and `span.job-meta` (`metaLine`, the clock in
    `span[data-job-clock="<startedAt>"]` while live); inside, `pre.job-out#job-out-<id>` (empty in
    the markup), `div.job-end` (`endLine`, and `(no output)` when the job settled with
    `output.total` 0) and the Copy key (`data-action="copyText"`, `data-text` the label,
    `aria-label="Copy command"`); beside the details, Stop (`button.btn-sm`, `data-action="stopJob"`,
    `data-conv`, `data-job`) or `confirmPair('Yes, stop')` while `confirm` is `{action: 'stopJob',
    id}` (D23), or `Stopping` while it stops; the finished in `details#jobs-finished-<convId>` whose
    summary reads `Finished · <n>`, holding the same rows without Stop and `Clear`
    (`data-action="clearJobs"`, `data-conv`);
  - **`app.js`:** `follow()` calls `jobs.watch(id)` with the conversation on Messages, else
    `jobs.watch(null)`; `openJob` toggles `jobs.open` and follows or unfollows; `confirmYes` runs
    `jobs.kill(c.conv, c.id)`; after each render and on each `onOutput`, the open job's
    `#job-out-<id>` gets `outputOf(id).text` by `textContent` when it differs (Review Focus 4);
    while Details shows a live job, a 1 s `timers.after` loop writes each `[data-job-clock]` span's
    `textContent` (`clockText(now − startedAt)`) and stops when none is drawn; a job leaving the rows
    (or the conversation left) unfollows it.
- **CSS:** the chip a `btn-sm` with a dot (`--up` live, `--dim` finished); `.job-cmd` mono,
  ellipsed; `.job-out` mono 12 px, `white-space: pre-wrap`, at most 320 px tall, scrolling, on
  `--surface-2`.

- [ ] **Step 1: Write the failing tests:**
  - in `messages-screen.test.js`:
    - `the chip shows while the conversation has a job, with its words, and none without`;
    - `Background jobs sits right after This task: a running job's command, meta and Stop; a stopping one Stopping`;
    - `Stop asks twice with Yes, stop`;
    - `finished jobs fold under Finished · n with Clear, their end lines and (no output) for an empty one`;
    - `a job's command is escaped and never masked`;
  - in `app-dom.test.js`:
    - `opening a conversation watches its jobs, another conversation moves the watch, Markets stops it`;
    - `the chip opens Details at Background jobs`;
    - `opening a job follows it and its output fills the pre without a render; a render writes it again`
      (the fake's `writes` count unchanged across an output frame);
    - `Yes, stop kills the job; No asks nothing`;
    - `the clock ticks without a render while a live job is drawn, and stops with none`;
    - `Clear hides the finished until the page reloads`;
  - in `css.test.js`: the harvest gains the chip and a section with each job state.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test` and `npm run typecheck`.
- [ ] **Step 5: Commit.**

### Task 10: The smokes on a real boot

**Files:**
- Modify: `face/tests/dsh-ui-port-smoke.test.ts` (four tests; the header's list)

**Interfaces:**
- Consumes: the file's `open`, `turn`, `rpc`, `rpcResult`, `agentOf`, `openReadyMux`; `ctx.jobs`
  (`dsh-jobs`' `JobRegistry`, whose `start(spec)` the builder reads in
  `node_modules/@deepseek-ai/dsh-jobs/lib/types/types.d.ts` and `dsh-jobs-local`).

- [ ] **Step 1: Write the four tests:**
  - `a follow's snapshot carries its cursor and hasMore, and a page before its first record holds the turn the outline names`:
    three stub turns; a `session/follow` with `maxMessages: 2` over the mux; its snapshot's
    `hasMore` is true and its records start after the first turn's `turn/start`; `turnOutline[0].seq`
    is below that start; a `session/page` with `throughSeq` = the snapshot's `cursor` and `beforeSeq`
    = its first record's seq ends at that seq − 1 and holds a `user/message` whose text is the first
    prompt;
  - `the stats count steps after a turn, and the projections reach session/control live`: a
    `session/control` stream sees `turnOutline` and `sessionStats` frames for the session during a
    stub turn; `steps` ≥ 1 and `llmMs` ≥ 0;
  - `job/list on a cold session answers rows and does not make it live`: a session created, its
    agent disposed (as the cold-conversation smoke does), then `job/list`; after its first frame
    `agentOf(id)` is still undefined;
  - `a job: listed, followed to its output and its end, and stopped by job/kill`: a job started on
    `ctx.jobs` (owned by a live stub session, or unowned when the registry requires no controller for
    it) that appends a known line and waits for its cancel; `job/list` shows it `running`;
    `job/follow` gives `opened`, an `output` frame holding the line, and, after `job/kill` answers
    `{outcome: 'requested'}`, a `status` frame whose `job.status` is `killed` and whose `detail`
    holds `cancelled by the user`; a second `job/kill` answers `already-finished` or throws
    `job/not-found`, and the test records which.
- [ ] **Step 2: Run them.** Run `FACE_SMOKE=1 npx tsx --test tests/dsh-ui-port-smoke.test.ts` in
  `face/`, from this checkout (outside `/tmp`). Expected: the file's 21 tests pass. If no job can be
  started on `ctx.jobs` from the test (a controller the scratch composition does not attach), stop
  and report: the job's follow and kill are then pinned only by the keyed drill.
- [ ] **Step 3: Run the gated suite.** Run `FACE_SMOKE=1 npm test` in `face/`. Expected: 0 fail.
- [ ] **Step 4: Commit.**

### Task 11: The documents and the build notes

**Files:**
- Modify:
  - `DEVELOPMENT.md`: §5.1 (`mask.js`, `host/turns-view.js`, `host/jobs-view.js`, `host/jobs.js`,
    `reducers/jobs.js`), §5.2 (`session/page` with `beforeSeq`, the snapshot's `cursor` and
    `hasMore`, `turnOutline`, `sessionStats`, the `job` namespace and its frames), §5.3
    (`live.earlier`, the window, `startJobs`), §5.4 (the masked bubble and excerpts, the thread box,
    the earlier key, the rail and its card, the pills and Usage, the chip and Background jobs), §5.5
    (`window`, `outline`, `stats`, the `jobs` slice; `revealed`, `rail` and a job's output outside
    the store), §5.6, §7.3 (the tests), §7.4 (the drills), and a residual R100 (R97 when this plan ran) — the thread at its
    edges: masking is display only (the key in the log and the model's context), Gravit's replies are
    not masked, a key cut short of its prefix in an excerpt is not masked, jobs vanish on a face
    restart, earlier pages live in the page's memory until a reload;
  - `face/README.md`: "The page (client/)" (masking, the rail, the pills, earlier history, jobs);
    the transport drill re-run after the paging (a step: a live conversation with more than 50
    messages, Earlier messages, then a face restart mid-read: the place and the earlier pages kept);
    the dsh UI port drill's heading names `client/js/mask.js`, `client/js/host/turns-view.js`,
    `client/js/host/jobs*.js` and `client/js/host/live.js`, and gains, keyed, from spec §7: ask
    Gravit for a background job (`sleep 120; echo done` in the background), then the chip, Details
    at Background jobs, its output streaming, its clock, Stop asked twice and its end line; the rail
    on a long conversation, a hover's card, a click on a loaded and on an unloaded turn; a pasted key
    drawn masked in the bubble, the list's preview and a search snippet, revealed and hidden by its
    eye, a selection copied across it carrying the original (pasted into a text editor);
  - `CLAUDE.md`: the `face/client/` line gains one clause (masking, the turn rail and stats with
    earlier history, background jobs in Details);
  - `Gravit-Docs-and-Prompt-Loops.html`: loop 2's browser station names what the page now draws from
    the host (the jobs from `job/list`, the rail from `turnOutline`, the pills from `sessionStats`);
    no prompt section changes;
  - `ROADMAP.md`: the built log;
  - the spec: `## 17. Build notes, plan 5`, in the §13–§16 form, with the rows of "Where the code
    differs" and "Where the spec leaves it to this plan" above among its clauses, and §9 item 7
    still open.
- [ ] **Step 1: Write the documents.** The counts come from a fresh `npm test` and
  `FACE_SMOKE=1 npm test`, run in `face/`.
- [ ] **Step 2: Commit.**
