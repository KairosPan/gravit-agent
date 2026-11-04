# dsh UI port, plan 3: the composer — the editor and its drafts, the `/` menu, `@` references — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The one-line composer becomes a multi-line editor with one draft per conversation, a `/`
menu of the host's commands and Gravit's skills, and an `@` picker whose bot, file, folder and
conversation picks sit in the draft as atomic chips and reach their readers in the right form.

**Architecture:** A draft is a model, not the DOM: runs of text and chips (`js/composer/draft.js`,
pure, with its serializer). The editor is a `contenteditable` `#say` that `render()` leaves empty
and `app.js` writes from the current draft after every render through a small DOM adapter
(`js/composer/dom.js`), putting the caret back by model offset — as `say.value = composerText`
does today. The menus' state lives beside the drafts in `app.js`; their items are pure
(`js/composer/menus.js`), their markup pure (`js/composer/view.js`), and a keystroke redraws only
`#composer-menu`. Their reads (`commands/list`, `skills/list`, `GET /data/files`,
`POST /data/rooms/state`) live in a new impure `host/composer.js`. A `/` line on a cold
conversation first opens a follow of it (`live.activate`) and then runs.

**Tech Stack:** Vanilla ES modules in `face/client/js`, the fake-DOM client suite
(`face/tests/client/`, `node --test` via tsx), plan 1's `GET /data/files`, the room engine's
`POST /data/rooms/state`, dsh 0.2.1-rc.5's `commands/*`, `skills/list` and the
`session-reference` row; the smokes in `face/tests/dsh-ui-port-smoke.test.ts`.

**Spec:** `docs/superpowers/specs/2026-11-03-dsh-ui-port-design.md` §5.3, §5.4, §5.5 and the
composer's keys of §5.12; P3; O9; D8–D17 and the Escape order of D34. Plans 1 and 2's build notes
are its §13 and §14; this plan's are its §15 (Task 10).

**Where the code differs from the spec, this plan follows the code:**
- **The conversation markup.** §5.5 writes `@[<title>](dsh-session:<id>)`. rc.5's
  `formatSessionReferenceMention` (`@deepseek-ai/dsh-session-reference`) writes
  `@[<label>](dsh-session:<payload>)`: the payload is `base64url(UTF-8 JSON.stringify(sessionId))`
  with no padding, and the label escapes `\` and `]` with a backslash. A bare id fails the row's
  canonical check and ends the turn. The page's serializer matches the package's output byte for
  byte, and a test pins that.
- **A bot's description.** §5.5 gives each bot "its mark and description". The roster read,
  `POST /data/rooms/state`, answers `{roster: [{id, name, model?, broken?}], …}`, with no
  description. The description comes from `/data/bots.json`, which carries one; `host/live.js`
  drops it today, and Task 6 keeps it.
- **Where the commands read lives.** §5.4 puts it in `host/live.js`. It goes in the new
  `host/composer.js` with the other menu reads, and only the activation (D13) goes in `live.js`.
- **A skill by its literal `/name`** (§5.4, open item 4). rc.5's `dsh-tool-skill` loads one at the
  agent's pre-step: `SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`, for
  user-invocable skills only. Task 9's smoke pins it on a real boot; if it fails there, the Skills
  group is not drawn (A5).
- The rest checks out against the code: `renderComposer`'s three callers (`draftScreen`,
  `emptyScreen` and `renderMessagesScreen`, all in `render/messages.js`); a `/` line that fails
  on a cold conversation today (`actions.command` calls `commands/execute` straight away);
  `commands/list {agentId}` answering a bare array of names without the slash (the smoke);
  `skills/list {request: {sessionId}}` reading cold.

## Global Constraints

- **Copy, verbatim (English):**
  - the placeholders as today: `Tell Gravit…`, and in a group `Tell Gravit… @ a bot by name`;
  - the `/` menu's groups `Commands` and `Skills`; the `@` menu's groups `Bots in this room`,
    `Files and folders` and `Conversations`;
  - the menu's footer: `↑↓` `Move` · `Enter` `Choose` · `Esc` `Close`, each key in a `kbd`;
  - a command's title: its name with the first letter capitalized (`compact` → `Compact`);
  - a conversation's age: `Just now`, `1 minute ago`, `<n> minutes ago`, `1 hour ago`,
    `<n> hours ago`, `1 day ago`, `<n> days ago`;
  - the refusal (O9): `Conversations go to Gravit, not to a room's bots`;
  - an activation that fails: `command: the conversation did not open` (from the menu), or
    `send: the conversation did not open` (from a sent `/` line).
- **Wire:**
  - `commands/list {agentId: <sessionId>}` (a live agent) answers an array of
    `{definitionId?, name, description, input?: {hint, attachments?}}`, where `name` has no
    slash; on a cold session it throws `gateway/lookup-not-found`;
  - `commands/execute {agentId, line, submittedAttachments: []}`, as `actions.command` sends it
    today;
  - `skills/list {request: {sessionId}}` answers `{skills: [{path?, name, description,
    whenToUse?, modelInvocable}]}` and reads a cold session without activating it;
  - `GET /data/files?q=<encoded>&dir=<repo-relative>` answers `{ok, items: [{path, kind:
    'file'|'directory'}], truncated}`. A `q` holding `/` lists that folder's entries; an empty
    `q` lists `dir` (or the root). `q` is at most 500 characters, and a 400 or 500 has a fixed
    line;
  - `POST /data/rooms/state {sessionId}` answers `{roster: [{id, name, model?, broken?}],
    members, caps}`;
  - a bot chip serializes to `@<id>`; a file chip to `@<path>` (D15: relative to the
    conversation's working directory when under it, `.` for the directory itself, absolute
    otherwise, `@"<path>"` when it holds whitespace); a conversation chip to
    `formatSessionReferenceMention({sessionId, label: title})`'s exact text.
- **Paths:** the repository root is the root channel's `dir` (`state.channels`, `isRoot`). It is
  absolute, and it is the same `process.cwd()` that `src/main.ts` gives both `/data/files` and
  the channel routes. A conversation's working directory is its channel's `dir`. A conversation
  in no channel has no known directory, so its file chips serialize absolute. With no root
  channel in the list, the Files group is not drawn.
- **Keys:**
  - Enter in the editor sends, except while a menu shows rows (it chooses), while an IME composes
    (`isComposing` or `keyCode === 229`: the composition's own Enter), and with Shift held (a new
    line, the browser's own);
  - in a menu: ↑ and ↓ move, wrapping; Enter or Tab chooses; Tab on a folder opens it in place;
    Esc or Shift+Tab closes it and keeps the draft. Focus never leaves the editor;
  - the Escape order is: an open menu first (D34), then the search box, then today's chain. The
    lightbox and the shortcut sheet join in plans 4 and 6.
- **The client rules:**
  - a keystroke never renders the page (`f.writes` unchanged), and opening, filtering or moving
    in a menu writes only `#composer-menu`;
  - one draft per conversation, in memory, keyed by the conversation's id, or `new` on New
    message (D8);
  - every host string passes through `esc()`, and a chip's `data-chip` attribute goes through
    `attrs`;
  - `app.css` names no hex: the chip's pale blue is the tokens `--ref-fill` / `--ref-text` in all
    three theme blocks of `tokens.css` (cream `#eef1fb` / `#3b5bdb`, black and the dark media
    block `#1e2541` / `#9db0ff`);
  - `css.test.js` holds both ways: every class has a rule, and every rule's class is emitted.
- **Out of this plan:** attachments and the paperclip, D12 and D20 (plan 4); masking (plan 5);
  the shortcut sheet and the words tables (plan 6). The draft model leaves room for plan 4's
  `files` beside `runs`, and adds nothing for it.
- Never the live `~/.dsh`, never port 3090, never `npm run service`. A smoke runs from a checkout
  outside `/tmp` and `$TMPDIR`. Commit messages go in a file and are committed with
  `git commit -F <file>`. No push.

## Review Focus

1. **A render mid-word.** A stream frame lands while the operator types, with a chip in the
   draft: the words, the chip and the caret come back. While an IME composition is open nothing
   renders until `compositionend` (A7). Pinned in Task 5.
2. **Two drafts.** The operator writes in A, opens B, writes there, and goes back: each has its
   own words. Sending in B sends B's words and leaves A's (D8). Pinned in Task 5.
3. **A late menu answer.** A files or skills answer for `@stra` lands after the query reads
   `@strategies/` or the menu was closed with Esc: it draws nothing. Pinned in Task 7.
4. **A file path that reads like a bot.** A file chip `@news-scout.md` in a channel conversation
   with no bot chip and no typed `@word` goes to Gravit as a prompt and is never posted to
   `/data/rooms/say` on its own account. Pinned in Task 8.
5. **A title with `]`, `\` or Chinese.** A conversation chip on `估值 [v2] a\b` serializes to
   exactly dsh's mention and parses back to the same id and label. Pinned in Task 1.

---

### Task 1: The draft model and its serializer (pure)

**Files:**
- Create: `face/client/js/composer/draft.js`
- Test: `face/tests/client/composer-draft.test.js`

**Interfaces:**
- Produces:

```js
// Run = {type: 'text', text} | {type: 'chip', chip}
// Chip = {kind: 'bot', id, label} | {kind: 'file', path, dir: boolean, label} | {kind: 'conversation', id, label}
export const emptyDraft = () => ({ runs: [] });
export const textDraft = text => ({ runs: [] /* one text run when text is non-empty */ });
export function normalize(runs) {}                    // adjacent text runs merged, empty ones dropped
export function lengthOf(runs) {}                     // caret units: a text run's UTF-16 length, 1 for a chip
export function isBlank(runs) {}                      // no chip, and the text only whitespace
export function plainText(runs) {}                    // text runs as written, a chip as its label
export function hasChip(runs, kind) {}
export function replaceRange(runs, from, to, insert) {} // → normalized runs; an edge inside no chip splits it
export function triggerAt(runs, at) {}                // → {kind: '/' | '@', from, query, atStart} | null
export function sessionUri(sessionId) {}              // 'dsh-session:' + base64url(UTF-8 JSON.stringify(id)), unpadded
export function filePathFor(path, { repoRoot, cwd }) {} // D15, before quoting
export function serialize(runs, ctx) {}               // the text sent
export function serialContext({ channels, workspaceId }) {} // → {repoRoot, cwd}: the root channel's dir, the channel's dir, each or null
export function sessionRefRuns(text) {}               // → [{type: 'text', text} | {type: 'ref', label}] for the operator's bubble (D17)
```

- **The trigger rule.** The token is the run of non-whitespace characters before the caret, inside
  the caret's text run; a chip ends it as whitespace does.
  - An `@` token matches `/^@([^\s@]*)$/u`. Its query may hold `/`, for a folder.
  - A `/` token matches `/^[^\p{L}\p{N}\s@/]*\/([^\s/]*)$/u`: at the draft's start, after a space,
    or after punctuation, but not after a letter or a digit (`and/or` is not one).
  - `from` is the trigger character's offset in caret units. `atStart` is `from === 0`.
- **The serializer.** Use `btoa` over the UTF-8 bytes from `TextEncoder`; replace `+` with `-` and
  `/` with `_`; drop the padding. A label escapes `\` and `]` as `\\` and `\]`.

- [ ] **Step 1: Write the failing tests:**
  - `runs normalize, and the caret counts a chip as one`;
  - `a blank draft is whitespace with no chip`;
  - `replaceRange swaps the trigger's token for a chip and a space, and never splits a chip`;
  - `the trigger: / at the start, after a space, after punctuation, not after a letter; @ at the start or after a space, not in an e-mail; nothing after whitespace`:
    `triggerAt(t('/com'), 4)` → `{kind: '/', from: 0, query: 'com', atStart: true}`;
    `t('see (/go')` at 8 → `/`, `from: 5`; `t('and/or')` at 6 → null; `t('a@b.c')` at 5 → null;
    `t('@strategies/cn')` at 15 → `{kind: '@', query: 'strategies/cn'}`; `t('/goal ')` at 6 → null;
  - `a bot chip is @id; a file chip relative under the cwd, . for the cwd, absolute outside it, quoted with a space`:
    with `{repoRoot: '/r', cwd: '/r/strategies/cn-market'}`, `strategies/cn-market/thesis.md` →
    `@thesis.md`, `strategies/cn-market` → `@.`, `desk/levels.yml` → `@/r/desk/levels.yml`,
    `docs/a b.md` → `@"/r/docs/a b.md"`; with `cwd: null` every path is absolute;
  - `a conversation chip is exactly dsh's mention` (Review Focus 5): for the ids `s1` and
    `session-6f1c…` and the labels `估值 [v2] a\b`, `T` and `]`, `serialize` equals
    `formatSessionReferenceMention({sessionId, label})` imported from
    `@deepseek-ai/dsh-session-reference`. `parseSessionReferenceText` reads it back to the same
    `{sessionId, label}`;
  - `the bubble's runs: a mention becomes a ref with its unescaped label, a malformed one stays text`;
  - `serialContext reads the root channel and the conversation's channel, null when missing`.
- [ ] **Step 2: Run them and see them fail.** Run `npx tsx --test tests/client/composer-draft.test.js`
  in `face/`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement `composer/draft.js`.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -F <file>`.

### Task 2: The menus' items (pure)

**Files:**
- Create: `face/client/js/composer/menus.js`
- Modify: `face/client/js/time.js` (`ago`)
- Test: `face/tests/client/composer-menus.test.js`, `face/tests/client/time.test.js`

**Interfaces:**
- Consumes: Task 1's `Chip`.
- Produces:

```js
export const HIDDEN_COMMANDS = ['plan', 'permission', 'feedback'];   // D11
export const CONVERSATION_ITEMS = 8;
// Menu = {kind: '/' | '@', from, query, groups: [{label, crumb?, items}], active}
export function rankByLetters(items, query, keyOf) {}   // letters in order, case-insensitive; prefix matches first; input order within a tier
export function slashItems({ commands, skills, query, atStart }) {}   // → groups
export function atItems({ bots, files, conversations, query }) {}     // → groups
export function conversationChoices(conversations, { exceptId, workspaceId, now }) {} // → conversation items
export function flatItems(menu) {}         // the rows in drawn order
export function moveActive(menu, delta) {} // → menu, wrapping
export function chipOf(item) {}            // a bot, file or conversation item → its Chip
export function ago(ts, now) {}            // in time.js: the age words of Global Constraints
```

- Items:
  - `{kind: 'command', name, title, description, takesArgs, hint}`;
  - `{kind: 'skill', name, description}`;
  - `{kind: 'bot', id, name, description}`;
  - `{kind: 'file', path, dir, name, folder}`, where `name` is the base name and `folder` the
    parent path (`''` at the root);
  - `{kind: 'conversation', id, title, age}`.
- **`slashItems`:**
  - `commands === null` draws no Commands group (D13: cold, nothing read for the preset);
  - the hidden three are left out;
  - a command whose `input` is set (`takesArgs`) is listed only when `atStart`;
  - Skills come from `skills`. Both groups go through `rankByLetters` on `name`;
  - with a non-empty query, the groups keep their order but lose their `label` (headings hide);
  - an empty group is dropped.
- **`atItems`:**
  - groups in the spec's order: Bots (only when `bots` is non-empty), Files and folders,
    Conversations;
  - bots are ranked on `` `${name} ${id}` ``; files come in the route's order, as the route
    ranks them; conversations through `rankByLetters` on the title, at most `CONVERSATION_ITEMS`;
  - a query holding `/` is a folder walk: the Files group alone, with
    `crumb: <query up to its last '/'>`;
  - `@` headings show even with a query.
- **`conversationChoices`:** drops the archived ones and `exceptId`; the conversations in
  `workspaceId`'s channel come first; newest first in each part.
- **`chipOf`:**
  - a bot's label is its name;
  - a file's label is its base name, with a trailing `/` on a folder;
  - a conversation's label is its title.

- [ ] **Step 1: Write the failing tests:**
  - `letters in order, case-insensitive, prefix matches first` (`gl` finds `goal` before
    `toggle-log`; `xz` finds nothing);
  - `the slash menu hides plan, permission and feedback, and lists an argument command only at the start`;
  - `a cold conversation with nothing read for its preset has no Commands group, and Skills still draw`;
  - `a command's title is its name capitalized`;
  - `headings hide while a query is typed in the slash menu, and stay in the @ menu`;
  - `the @ groups in order, bots only in a room, a folder walk shows the files alone under its crumb`;
  - `conversations: the current one, archived ones and those beyond eight left out; the channel's own first`;
  - `the active row wraps both ways`;
  - `chips: a bot by its name, a folder with a slash, a conversation by its title`;
  - in `time.test.js`: `ago reads just now, minutes, hours and days, one of each in the singular`
    (`ago(now - DAY, now)` is `1 day ago`; `ago(now - 3 * HOUR, now)` is `3 hours ago`).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement `composer/menus.js` and `ago`.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 3: The composer's markup, the menu's view, the chip in the bubble

**Files:**
- Create: `face/client/js/composer/view.js`
- Modify: `face/client/js/render/messages.js` (`renderComposer`, `draftScreen`, `emptyScreen`,
  `renderMessagesScreen`), `face/client/js/render/thread.js` (the `you` bubble),
  `face/client/css/app.css`, `face/client/css/tokens.css`
- Test: `face/tests/client/composer-view.test.js`, `face/tests/client/messages-screen.test.js`,
  `face/tests/client/thread.test.js`, `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 1's runs and `sessionRefRuns`, and Task 2's `Menu`.
- Produces:

```js
export function editorHtml(runs) {}  // text escaped (newlines kept under pre-wrap); a chip as below
export function renderMenu(menu) {}  // '' for null or a menu with no rows
// render/messages.js
export function renderComposer({ placeholder = 'Tell Gravit…', above = '', menu = null } = {}) {}
export function renderMessagesScreen(state, now, composer = { menu: null }) {}
```

- **The composer.** `form.composer` (unchanged: `data-action="send"`) holds:
  - `div.composer-menu#composer-menu` with `renderMenu(menu)` inside;
  - then `div.composer-box`, which holds `span#say-label.sr-only` reading `Tell Gravit`, the
    editor and today's `send-key`;
  - the editor is `div#say.composer-input` with `contenteditable="true"`, `role="textbox"`,
    `aria-multiline="true"`, `aria-labelledby="say-label"`, `aria-controls="composer-menu"`,
    `aria-expanded="false"` and `data-placeholder` set to the placeholder. It is empty: `app.js`
    fills it (Task 5).
  - The three screens pass `composer.menu` on to `renderComposer`.
- **A chip in the editor:** `span.ref-chip` with `contenteditable="false"` and `data-chip` set to
  `JSON.stringify(chip)` (through `attrs`), holding an icon (`agent` for a bot, `file` for a
  file, `layers` for a folder, `chat` for a conversation, at 13 px) and `span.ref-chip-label`.
- **A chip in the bubble:** `span.ref-chip` with the `chat` icon and the label, and no
  `contenteditable`.
- **The menu:** `div.cmenu` with `role="listbox"` and `aria-label` set to `Commands and skills`
  or `References`. It holds:
  - per group, a `div.cmenu-group` heading when the group has a label, and a `div.cmenu-crumb`
    when it has a crumb;
  - one `div.cmenu-row` per item: `role="option"`, `id="cm-<i>"`, `aria-selected`,
    `data-action="menuPick"`, `data-index="<i>"`, and `active` on the active row. A row holds an
    icon, `span.cmenu-title`, `span.cmenu-name` and `span.cmenu-desc`:
    - a command: `Compact`, `/compact` in mono, its description;
    - a skill: its name, `/<name>`, its description;
    - a bot: its avatar glyph, its name, `@<id>`, its description;
    - a file: its base name, its folder, nothing;
    - a conversation: its title, nothing, its age;
  - then `div.cmenu-foot` with the footer of Global Constraints.
- **CSS:**
  - `.composer` gains `position: relative`;
  - `.composer-box` replaces `.composer-pill`: radius `var(--radius-l)`, the send key aligned to
    the box's bottom;
  - `.composer-input` grows from one line up to eight (`max-height` about `calc(8 * 1.45em)`)
    and then scrolls (`overflow-y: auto`), with `white-space: pre-wrap` and
    `overflow-wrap: anywhere`. `.composer-input:empty::before` shows `attr(data-placeholder)` in
    `--dim`;
  - `.composer-menu` sits absolutely above the box, `width: min(520px, 100%)`. `.cmenu` has
    `max-height: 400px` and scrolls;
  - `.cmenu-name` uses `--font-mono` in `--dim`; `.cmenu-row.active` uses `--surface-2`;
  - `.ref-chip` is inline, on `--ref-fill`, in `--ref-text`, radius `var(--radius-pill)`.

- [ ] **Step 1: Write the failing tests:**
  - in `composer-view.test.js`:
    - `the editor draws text escaped and a chip atomic with its data` (a label `<b>` comes out as
      text; `contenteditable="false"`; `data-chip` parses back to the chip);
    - `the slash menu draws Commands and Skills with their names in mono, the active row marked, the footer's keys`;
    - `the @ menu draws a bot's glyph and id, a file's folder, a folder walk's crumb, a conversation's age`;
    - `no rows draws nothing`;
  - in `messages-screen.test.js`, the no-files test becomes
    `the composer is the menu slot, the editor and Send: no files, no mic`: `id="say"` with
    `contenteditable="true"`, `role="textbox"`, `aria-multiline="true"`,
    `data-placeholder="Tell Gravit…"`; `id="composer-menu"`; the old `<input id="say"` is gone,
    and the `attachFiles`, `toggleMic`, `pickFile` and `attach-input` guard stays until plan 4;
  - `a group's composer keeps its @ placeholder, and a menu handed in is drawn in the slot`;
  - in `thread.test.js`: `the operator's bubble draws a conversation mention as a chip, and a file or bot reference as its text` (D17);
  - in `css.test.js`, the class harvest gains the composer's states (a menu of each kind, a folder
    walk, a draft with each chip kind, a bubble with a mention), and it asserts `.ref-chip` reads
    `var(--ref-fill)` and that `--ref-fill` and `--ref-text` are declared in each `tokens.css`
    block.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `.composer-pill` leaves `app.css` with its last user.
- [ ] **Step 4: Run them and see them pass,** then `npm test`. `app-dom.test.js` still passes
  here: it registers `say` by id, and nothing in it parses the markup.
- [ ] **Step 5: Commit.**

### Task 4: The editor's DOM adapter

**Files:**
- Create: `face/client/js/composer/dom.js`, `face/tests/client/helpers/editable-dom.js`
- Test: `face/tests/client/composer-dom.test.js`

**Interfaces:**
- Consumes: Task 1's runs; Task 3's `editorHtml` and the chip's `data-chip`.
- Produces:

```js
// the only code that reads or writes the editor's nodes; app.js takes it as host.editor ?? makeEditor(doc)
export function makeEditor(doc) {
  return {
    read(el) {},           // → normalized runs
    caret(el) {},          // → caret units, or null when the selection is not inside el
    place(el, at) {},      // collapse the selection at caret units `at`, clamped to the draft
    write(el, runs, at) {}, // el.innerHTML = editorHtml(runs), then place(el, at) unless at is null
  };
}
```

- **`read`** walks `el.childNodes` in depth:
  - a text node gives its text, with `​` stripped;
  - an element with `dataset.chip` gives that chip. One whose JSON does not parse, or that names
    no known kind, is dropped;
  - a `BR` gives `\n`, but a last `BR` that ends the editor gives nothing (the browser's trailing
    one);
  - a `DIV` or `P` block after the first child begins with `\n`.
- **`caret` and `place`** count as `lengthOf` does. An anchor on an element counts its child
  offset; an anchor inside a chip counts as after the chip.
- **The helper** builds node trees by hand: `text(s)`, `el(tag, {dataset, children})`, an editor
  root, and a document whose `getSelection()` answers `{anchorNode, anchorOffset, rangeCount,
  collapse(node, offset), removeAllRanges(), addRange(range)}` with a `createRange()` that
  records `setStart`. It parses no HTML.

- [ ] **Step 1: Write the failing tests:**
  - `read gives text and chips in order, merging what the browser split`;
  - `Shift+Enter's BR is a newline, the browser's trailing BR is not, a block starts a line`;
  - `a chip with bad data is dropped, not thrown`;
  - `the caret counts a chip as one, inside a text node and on the editor itself`;
  - `place puts the caret after a chip and inside a text, clamped past the end`;
  - `write sets the editor's markup from the runs and places the caret, or leaves it with at null`;
  - `a selection outside the editor reads as no caret`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement `composer/dom.js`.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 5: Drafts in the page: the editor survives renders, Enter sends

**Files:**
- Modify: `face/client/js/app.js` (`composerText` becomes `drafts`; `render()`'s write-back and
  caret; `typed`; `sendNow`; the `suggest` and `handToGravit` actions; Enter and paste on `#say`)
- Create: `face/tests/client/helpers/value-editor.js`
- Test: `face/tests/client/app-dom.test.js`

**Interfaces:**
- Consumes: Tasks 1, 3 and 4.
- Produces:
  - `boot(win, host)` takes `host.editor`, which defaults to `makeEditor(doc)`.
  - In `app.js`:
    - `drafts` is a `Map<string, {runs}>`;
    - `draftKey(s)` is `'new'` while `s.draft` stands, else `currentConversation(s)?.id`, else
      `'empty'`;
    - `currentRuns()` and `setRuns(runs)` work on the current key.
  - `render()`:
    - before the write, it reads the caret with `editor.caret(say)` when `#say` has focus, and
      notes the key;
    - after it, it calls `editor.write(say, currentRuns(), sameKey && caret !== null ? caret :
      null)`, in place of today's `say.value = composerText`.
  - `typed(el)` with `el.id === 'say'` calls `setRuns(editor.read(el))`.
  - `sendNow()`:
    - it does nothing on a blank draft;
    - it serializes with `serialContext` (the conversation's channel, or `draft.where`), clears
      the key and renders;
    - on a failure it puts the whole draft back under the key it came from.
  - `suggest` and `handToGravit` put their words in the current key with `textDraft`.
  - **The test helper** `valueEditor`:
    - `read(el)` gives the text runs of `el.value`;
    - `caret(el)` gives `el.selectionStart`;
    - `place(el, at)` sets the selection range;
    - `write(el, runs, at)` sets `el.value = plainText(runs)` and places the caret. A test can
      set `el.chips` to make `read` add chips at the end.
    - Every `boot(f.win, …)` in `app-dom.test.js` (twelve today, `started` among them) passes
      `editor: valueEditor`, so the existing composer tests keep their `say.value` steps
      unchanged.
- **Keys on `#say`** (the `keydown` handler, before the Enter of the inline editors):
  - Enter with no Shift and no open IME: `preventDefault`, then `sendNow()`;
  - Shift+Enter is left to the browser.
- **Paste on `#say`:** `preventDefault`; read `text/plain`; then `setRuns(replaceRange(read,
  caret, caret, text run))` and `editor.write` with the caret after the text. A paste of files is
  plan 4's, and does nothing here.

- [ ] **Step 1: Write the failing tests:**
  - `a stream frame mid-typing keeps the words, the chip and the caret` (Review Focus 1): the
    fake editor records `write(say, runs, 7)` with the chip after a host event's render;
  - `nothing renders while an IME composes; compositionend takes the words, then renders`;
  - `Enter sends; Shift+Enter does not; Enter during a composition (isComposing, or keyCode 229) does not`;
  - `each conversation keeps its own draft, and sending in one leaves the other's` (Review
    Focus 2);
  - `a failed send keeps the whole draft, chips included, under its own conversation`;
  - `New message keeps its draft under new, and a created conversation clears it`;
  - `a paste arrives as plain text at the caret`;
  - every existing composer test passes unchanged through `valueEditor`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `composerText` leaves `app.js`. The focus fallback to `say` stays.
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 6: The menus' reads

**Files:**
- Create: `face/client/js/host/composer.js`
- Modify: `face/client/js/host/live.js` (`refresh` keeps each bot's `description`)
- Test: `face/tests/client/host-composer.test.js`, `face/tests/client/live.test.js`

**Interfaces:**
- Consumes: `call`, `getJson` and `postJson`, as `app.js` hands them to its layers.
- Produces:

```js
export const presetKey = conv => conv?.preset ?? 'gravit';
export function startComposerReads({ call, getJson, postJson }) {
  return {
    keptCommands(conv) {},        // the rows last read for presetKey(conv), or null
    async commands(conv) {},      // live: commands/list {agentId: conv.id}, kept by preset; cold: keptCommands(conv). A throw or a non-array keeps the old rows
    keptSkills(sessionId) {},
    async skills(sessionId) {},   // skills/list {request: {sessionId}} → .skills, kept per session; [] on a throw
    async files(q, dir) {},       // GET /data/files?q=&dir= (both encoded, dir only when set) → {items, truncated}; null for a superseded or failed call
    async roster(sessionId) {},   // POST /data/rooms/state {sessionId} → roster, kept per session; [] on a throw
  };
}
```

- The store's `bots` entries become `{id, name, description}`. `description` is `''` when
  `/data/bots.json` has none.

- [ ] **Step 1: Write the failing tests:**
  - `commands are read on a live conversation and kept by preset; a cold one gets the kept rows and calls nothing` (D13);
  - `a cold conversation of a preset never read has no commands`;
  - `a failed commands read keeps the rows it had`;
  - `skills are read cold, and a throw is none`;
  - `the files read sends q and dir encoded, and only the latest call answers` (`茅台` gives
    `q=%E8%8C%85%E5%8F%B0`; an older call resolves to null);
  - `the roster is the room state's, and none on a throw`;
  - in `live.test.js`: `the list keeps each bot's description`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 7: The menus in the page: open, filter, move, choose, close

**Files:**
- Modify: `face/client/js/app.js` (the menu state and `drawMenu`, `menuTick` after `typed`, the
  menu's keys, the `menuPick` action, the Escape order, `focusSearch`)
- Test: `face/tests/client/app-dom.test.js`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces, in `app.js`:
  - `let menu = null` and `let menuSeq = 0`;
  - `drawMenu()` writes `renderMenu(menu)` into `#composer-menu` and sets `#say`'s
    `aria-expanded` and `aria-activedescendant` (`cm-<active>`). It never calls `render()`;
  - a full render passes `{menu}` to `renderMessagesScreen`.
- **`menuTick()`** runs after every `typed` of `#say` and on a caret move (`keyup` of the arrows,
  Home and End when no menu is open):
  - It takes `triggerAt(currentRuns(), caret)`. With no trigger, it closes the menu.
  - On `/`, it opens only on a conversation (not on New message or the empty screen; D10). It
    builds `slashItems` from `keptCommands` and `keptSkills` at once, then reads `commands` and
    `skills`.
  - On `@`, it builds `atItems` at once and reads:
    - `files(query, cwdRel)`, where `cwdRel` is the channel's `dir` relative to the root, and
      only when the root is known;
    - `roster(id)` when the conversation has a channel; the bots are the roster joined to
      `store.bots`' descriptions;
    - the conversations from `conversationChoices(state.conversations, {exceptId,
      workspaceId})`.
  - Each read's answer rebuilds the menu only while `menuSeq` and the query are unchanged (Review
    Focus 3).
  - A menu whose rows come to nothing is closed. A trigger that is still standing reopens it when
    rows arrive.
- **Choosing an item** (`chooseItem(item)`):
  - a command with `takesArgs`, or a skill: the token becomes `/<name> `;
  - a bot, file or conversation: the token becomes the chip and a space. Then
    `editor.write(say, runs, caret after the space)`, and the menu closes;
  - a command without arguments is Task 8's.
  - Tab on a folder sets the token to `@<path>/`, and the menu follows the new query.
  - `menuPick` (a pointer on a row) chooses that row. A `pointerdown` inside `.cmenu` calls
    `preventDefault`, so the editor keeps focus and its caret.
- **Keys while a menu shows rows**, in `keydown` before every other branch except ⌥⌘K: ↑ and ↓
  call `moveActive` and `drawMenu`; Enter and Tab choose; Esc and Shift+Tab close. Each calls
  `preventDefault` and does nothing else. Esc closes the menu before the search box and today's
  chain (D34).
- **⌥⌘K on a medium window** (spec §14's parked item). The rule in `focusSearch` widens from
  `s.detailsOpen` to `s.detailsOpen || s.lunhui?.stock`. It closes the stock drawer
  (`lunhuiStockClose`) and Details (`toggleDetails`), each only if it is open. Then the box takes
  focus once the list is drawn, as with Details today.

- [ ] **Step 1: Write the failing tests:**
  - `typing / on a live conversation opens the menu with no page render, and each letter redraws only the menu`
    (`f.writes` is unchanged; `#composer-menu`'s `innerHTML` holds `Compact`);
  - `/ on New message opens nothing; @ there lists files and conversations`;
  - `↑ ↓ move and wrap, Enter chooses, Tab chooses, Esc closes and keeps the draft, Shift+Tab closes`;
  - `Esc with a menu open closes the menu, not Details` (Details stays open);
  - `Enter with a trigger whose menu has no rows sends the draft`;
  - `choosing a skill or an argument command puts /name and a space in the draft`;
  - `choosing a file, a folder, a bot or a conversation puts its chip and a space, the caret after them`;
  - `Tab on a folder walks into it and shows its crumb`;
  - `a files answer for an older query, or after Esc, draws nothing` (Review Focus 3);
  - `a click on a row chooses it and the editor keeps focus`;
  - `⌥⌘K with the stock drawer open on a medium window closes it first, then focuses the box; on a wide one it stays`
    (the plan 2 test's form, with `lunhuiStockOpen` in place of Details, plus one with both
    open).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 8: Commands that run, a cold conversation, and what reaches whom

**Files:**
- Modify: `face/client/js/host/live.js` (`activate`), `face/client/js/host/actions.js`
  (`command`, `runCommand`, `send`'s `room` option, `makeActions`' `activate`),
  `face/client/js/app.js` (a command chosen from the menu; `sendNow`'s routing and refusal)
- Test: `face/tests/client/live.test.js`, `face/tests/client/actions.test.js`,
  `face/tests/client/app-dom.test.js`

**Interfaces:**
- Consumes: Task 1's `hasChip`, `plainText` and `serialize`; Task 7's `chooseItem`.
- Produces:
  - `live.activate(id) → Promise<boolean>`:
    - true at once for a live conversation;
    - for the view paged on `id`, it follows it (as `promote` does) and resolves true on the
      follow's first `snapshot` item, or false on its end, its error, or after
      `ACTIVATE_MS = 10_000`;
    - false when the view is on another conversation.
  - `makeActions({…, activate = async () => true})`.
  - `command(sessionId, line)` awaits `activate(sessionId)` first. A false throws
    `new Error('the conversation did not open')`, so `send` says
    `send: the conversation did not open`.
  - `runCommand(sessionId, line) → boolean` calls `command` and says
    `command: <code or message>` on a throw.
  - `send(text, { room } = {})` posts to `/data/rooms/say` when the conversation has a channel and
    `room`, which defaults to `isMentionText(words)` as today. It is otherwise unchanged.
  - A command without arguments chosen from the menu removes its token, writes the editor, closes
    the menu, and calls `actions.runCommand(id, '/<name>')`. The rest of the draft stays.
  - `sendNow` refuses a draft that has both a bot chip and a conversation chip: it says
    `Conversations go to Gravit, not to a room's bots` (bad) and keeps the draft (O9). Otherwise
    it sends with `room: hasChip(runs, 'bot') || isMentionText(text runs only)`. A file or
    conversation chip never routes to the room on its own (Review Focus 4).

- [ ] **Step 1: Write the failing tests:**
  - in `live.test.js`:
    - `activate follows a paged conversation and answers once its snapshot lands`;
    - `activate is true at once for a live conversation, false when the follow fails or never answers`;
  - in `actions.test.js`:
    - `a slash line on a cold conversation opens it before commands/execute` (the order of the
      calls);
    - `a conversation that does not open sends nothing and says so`;
    - `runCommand says the command's result, or its failure`;
    - `room: false sends a line with @ straight to Gravit; true posts it to the room`;
    - the existing slash-line test still passes;
  - in `app-dom.test.js`:
    - `Compact from the menu runs /compact at once, and the draft keeps its other words`;
    - `a bot chip with a conversation chip is refused before sending, and the draft stays`;
    - `a bot chip with a file chip goes to the room with the bot's @id and the file's path`;
    - `a file chip that reads like a bot, with no bot chip, is prompted to Gravit and never posted to the room`
      (Review Focus 4);
    - `a typed @buffett with no chip still tries the room, as today`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test` and `npm run typecheck`.
- [ ] **Step 5: Commit.**

### Task 9: The smokes on a real boot

**Files:**
- Modify: `face/tests/dsh-ui-port-smoke.test.ts` (its `before`, its stub `script`, three tests)

**Interfaces:**
- Consumes: Task 1's `serialize` (the browser module, imported as it ships), the file's
  `openReadyMux`, `rpc`, `open`, `turn` and `agentOf`.
- The stub's `script` records every request in a `requests: GenerateOptions[]`. `before()` writes
  `<root>/.dsh/skills/ui-port-probe/SKILL.md` before the boot, with frontmatter
  `name: ui-port-probe` and a `description`, and the body `UI_PORT_PROBE_BODY`. The builder checks
  the frontmatter against `dsh-skill-filesystem` if the skill does not list.

- [ ] **Step 1: Write the three tests:**
  - `a cold conversation: commands/execute is refused with gateway/lookup-not-found, and answers once a session/follow has opened`:
    - the cold session is made as the skills test makes one;
    - `commands/execute {agentId, line: '/goal', submittedAttachments: []}` rejects with that
      code;
    - then `mux.stream('session/follow', {request: {address: {kind: 'session', sessionId},
      assistantStream: true}})` runs until its snapshot, and the same call no longer rejects
      with it;
  - `a skill by its literal name: skills/list names ui-port-probe, and a prompt "/ui-port-probe hello" reaches the model with its skill_content`:
    the last request's messages hold `<skill_content name="ui-port-probe">` and
    `UI_PORT_PROBE_BODY`;
  - `a conversation chip: the page's serialized mention brings a Referenced sessions message`:
    - one turn in session A;
    - then a turn in B whose text is
      `serialize([{type: 'chip', chip: {kind: 'conversation', id: A, label: 'A'}}], {})`;
    - B's request holds `## Referenced sessions`.
- [ ] **Step 2: Run them.** Run `FACE_SMOKE=1 npx tsx --test tests/dsh-ui-port-smoke.test.ts` in
  `face/`, from this checkout (outside `/tmp`). Expected: the file's eleven tests pass. If the
  skill test fails on rc.5, stop and report: the Skills group must then not be drawn (A5), and
  Task 2's `slashItems` loses it.
- [ ] **Step 3: Run `npm test` and `npm run typecheck`.**
- [ ] **Step 4: Commit.**

### Task 10: The documents and the build notes

**Files:**
- Modify:
  - `DEVELOPMENT.md`: §5.1 the `js/composer/` files and `host/composer.js`; §5.2 the four reads
    and the mention's wire form; §5.3 `activate` and the reads; §5.4 the composer, the menus and
    the bubble's chip; §5.5 the drafts and the menu state outside the store; §5.6 `--ref-fill`
    and `--ref-text`; §7.3 the tests; §7.4 the drills;
  - `face/README.md`: "The page (client/)" for the editor, `/` and `@`. The room drill gains the
    step of spec §7: a bot chip with a file chip reaches the bot with the path, and adding a
    conversation chip is refused before sending. The keyed drill's composer steps: `/compact`
    from the menu, a skill from the menu, `@` a file that Gravit reads, and `@` a conversation
    that brings its snapshot. Two editor steps that the fake DOM cannot prove go there too: the
    caret steps over a chip, and Backspace after a chip removes it whole, in the operator's
    browser, with a pinyin composition left open across a stream frame;
  - the spec: `## 15. Build notes, plan 3`, in the §13 and §14 form, with the four rows of
    "Where the code differs" above among its clauses.

- [ ] **Step 1: Write the documents.** The counts come from a fresh `npm test` and
  `FACE_SMOKE=1 npm test`, run in `face/`.
- [ ] **Step 2: Commit.**
