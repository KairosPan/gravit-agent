# dsh UI port: ten DeepSeek Harness Desktop features on the face — design

**Date:** 2026-11-03.

**Status:** approved by the operator, 2026-11-03 ("批准设计"), with the builder check's three
questions answered (§12). Nothing is built; the plans come next (§10).

**Canvas:** https://claude.ai/artifact/1TvrCZKjovYnwTQprMmqwh (private, the operator's). Six boards:
*Where the ten picks land* (Main), *Search and pin in the list* (List), *The composer: / menu, @
references, attachments* (Composer), *The thread: turn rail and stats, jobs, masked secrets*
(Thread), *Settings: language, fonts and sizes, shortcuts* (Settings) and *Every gap, decided*
(Catalog). A board's numbered note is cited as "List ③", "Composer ②" and so on.

**Read with:**
- `docs/research/2026-11-02-dsh-ui-gap-inventory.md` (a32a292b): the first-pass inventory the
  brainstorm started from.
- `Gravit-Design.md` §2, P1: no face route writes the dsh profile patch.
- `DEVELOPMENT.md` §4.3 (the overlay rows and the policy layer), §4.8 (PLAN D1, D14, D16) and §5
  (the browser client).
- `docs/superpowers/specs/2026-10-19-gravit-ui-on-face-design.md` §3: "the product speaks
  English", the rule pick 9 re-takes for the face's own words.

**Pins:** `claude/cranky-bun-9f78c8` @ bf5fde7f (local main merged in: the face on dsh
0.2.1-rc.5).

**Who decided what.**
- The operator chose the picks, the drops and the colours (§4.1).
- The parent session ran the brainstorm and handled the front-end visuals only ("只负责前端视觉").
  It drew seven calls on the boards. The operator has seen them and not objected, but has not
  approved them one by one (§4.2).
- The calls this document makes are mine (§4.3).

Every fact about dsh and the face below was re-read in the code on 2026-11-03: the face's tree at
the pin, the installed rc.5 packages, and the upstream sources at tag `dsh-v0.2.1-rc.5`. Where a
fact could not be checked, the text says so.

## 1. Intent

The face (`face/`, the operator's one console at 127.0.0.1:3090) hosts DeepSeek Harness 0.2.1-rc.5
in-process and draws its own page, gravit-ui. dsh's Desktop app draws a richer client over the
same kind of host. On 2026-11-02 the parent session listed what Desktop shows and the face does
not. On 2026-11-03 the operator went through that list in rounds on the canvas and picked ten for
this round:

1. **Search every conversation**: full text, from the list.
2. **Pin a conversation**: keep it at the top of its group.
3. **The `/` menu**: the host's commands and Gravit's skills, listed under the caret.
4. **Attachments**: drop, paste or pick files and images into a message, and see them in the
   thread.
5. **`@file` / `@session` references**: point Gravit at a file, a folder or another
   conversation. The `@` is shared with a room's `@bot`.
6. **Secret masking**: a pasted key or token drawn masked, revealed one value at a time.
7. **Background jobs**: what runs behind a conversation, with its output and a Stop.
8. **The turn rail and session stats**: jump between the turns of a long conversation; see its
   turns, steps, speed and tokens.
9. **中文 / English**: the face's own words in either language.
10. **Fonts, sizes and a shortcut sheet**: text and code fonts and sizes, and a sheet that lists
    the keys.

The operator dropped eighteen others. The plugin manager, the plugin market and the dsh settings
forms moved to their own session, and three things were judged not for this product (§2).

**Why.** The operator gave the picks, not a reason for each; this paragraph is my reading. The
face is where the operator holds long research conversations with Gravit, day after day. The ten
are comforts dsh already built for that kind of work:
- find a conversation again, and keep the important ones close;
- say more than one typed line;
- see what Gravit has running behind a conversation, and what a conversation has spent;
- move through a long conversation;
- read the face in Chinese, at a comfortable size, with the keys at hand.

None of them widens what Gravit is allowed to do or changes how an order is approved. Gravit gains
one read-only role, for reading PDF pages (O8). Nothing goes anywhere new: what the operator
attaches or references travels to the same model provider as their words (§6). The operator's one instruction on looks: up stays green and down stays red in both
languages ("不用切换，还是绿涨红跌").

**What success looks like:**
- A word typed in the list's search box finds every conversation whose title or text holds it,
  each with the snippet that holds it.
- A pinned conversation stays first in its group, in every browser.
- `/` lists what the host offers. `@` lists the room's bots, the repository's files and folders,
  and the conversations. A pick sits in the draft as a chip.
- A file or an image dropped on a conversation reaches Gravit as far as Gravit's model and tools
  can take it, and the page says plainly where they cannot.
- A key pasted into a message is drawn masked wherever the face quotes it, and still reaches
  Gravit whole.
- A conversation that runs a background job shows the job, its output and a Stop.
- A long conversation has a rail of its turns and a line of what it has spent.
- 中文 switches every word the face itself writes, and nothing anyone else wrote.
- Text and code sizes and fonts follow the operator's settings, and ⌘/ shows every key.
- With English chosen and every new setting at its default, each screen draws what it draws
  today; `npm test` stays green, and every drill in `face/README.md` still passes.

## 2. Goals, non-goals, anti-goals

**Goals.** G1–G10 are the ten picks as §5 designs them:
- G1, search: §5.1.
- G2, pin: §5.2.
- G3, the `/` menu: §5.4 (on the editor of §5.3).
- G4, attachments: §5.6.
- G5, references: §5.5.
- G6, masking: §5.9.
- G7, background jobs: §5.8.
- G8, the turn rail and stats: §5.7.
- G9, the language switch: §5.10.
- G10, fonts, sizes and the shortcut sheet: §5.11 and §5.12.

**Non-goals.**
- N1. The eighteen the operator dropped: the right-hand workbench (file tree, preview, terminal,
  browser); model and effort per conversation; plan mode; the reasoning fold and the
  work-details modes; changed files per turn; the goal strip; timed questions (the question card
  stays blocking); the trajectory tab; children's tokens, time and follow-up; the "why it cannot
  open" rows; tool cards; exporting a conversation; the permission preset per conversation; open
  in Finder or an editor; Office authoring; dsh's schedule (the desk's standing orders do that
  job); message feedback; the DeepSeek account.
- N2. The plugin manager and market, and the dsh settings forms (subagent, web search, agent loop,
  shell). The session "Discover and the dsh plugin market" carries them.
- N3. Not for this product: workspaces and folder pickers (the face runs one repository), the
  default agent preset (channels and bots choose the preset), and the Electron shell.
- N4. No rebinding of keys: the sheet lists them (P7).
- N5. No language preference on the host: the choice is the browser's (P6).
- N6. No change to Gate 2 or the order path. Nothing here writes at the Account.
- N7. No dsh client package imported into the page. dsh's UI packages are React and TypeScript
  for its own bundle; the face ports their behaviour into its own vanilla modules and names the
  package each rule comes from.
- N8. No new tool for Gravit but the PDF role's `role_pdf-page-reader` (O8), and no new sentence
  in any agent's system prompt (D14). `GRAVIT.md` gains one line about PDFs (§5.6).

**Anti-goals.** Each of these is a failure even if everything else works:
- A1. A tool call drawn in the thread or in a member's Trace (the 2026-10-28 rule). A background
  job is drawn in Details, as a job.
- A2. Masking that changes what Gravit receives, what a copy carries, or what is stored; or a page
  that suggests a masked key is protected. Masking is display only: the key is in the log and in
  the model's context.
- A3. The 中文 switch translating what someone else wrote: a title, Gravit's or a bot's words, the
  Lunhui output, dsh's or the Account's own sentences, the lines of What you sign, a ticker, a
  number.
- A4. Red for up or green for down, in either language.
- A5. A door that does not exist: a search box that claims full text when the index is off, an
  image taken and silently dropped, a PDF said to be read, a Stop that stops nothing, a command in
  the menu that the host does not run.
- A6. A page action or a face route that writes `$DSH_HOME` or the profile's `cordis.patch.yml`
  (charter P1).
- A7. A draft lost (its words, its chips or its files) to a re-render, a failed send, a
  conversation switch or an IME composition.
- A8. The follow-or-page policy's drilled behaviour changed by the paging this round adds (§5.7).

## 3. Constraints

### 3.1 The charter and the standing rules

- **P1.** Placement holds: the profile patch lives in the harness home, outside the workspace, and
  no face route writes it. A back-end setting this round needs goes into the face's code (the
  overlay or the policy layer, §3.2) or into the operator's own rows; never into a route.
- **PLAN D14.** The archive is the face's own (`POST /data/sessions/archive`, kept in the face's
  session metadata). The host's archive is shown here and never undone. **PLAN D16.** A cold
  conversation is paged, never followed.
- **The 2026-10-28 rule.** No tool call is drawn in the thread or in a member's Trace.
- **"The product speaks English"** (the 10-19 spec §3; the front-end spec's decision 10). Pick 9
  re-takes it for the face's own words (§5.10). Its other half stands: the wire's Chinese prose (a
  quote's or a provider's message, a search note) never reaches a screen, and a state is worded
  from the wire's enums (`DEVELOPMENT.md` §5).
- **No explanatory small print** (the front-end spec's decision 9). The muted status lines are the
  exceptions `DEVELOPMENT.md` §5 lists. This round's new lines are of that kind: a search's state,
  an attachment's refusal, a job's end.
- **Up green, down red**, in both languages (the operator, 2026-11-03).

### 3.2 The host the face runs

- dsh 0.2.1-rc.5, every package pinned exactly in `face/package.json`. A new dsh package joins at
  the same exact version, and only when it is published at that version (§6).
- The face composes, in order: dsh-base's rows; its policy layer (`face/src/policy.ts`: defaults
  that the operator's `cordis.patch.yml` overrides, each one a decision the operator owns); the
  operator's rows; its overlay (`face/src/overlay.ts`: rows the face owns, composed last, which
  override a patch silently).
- The overlay mounts `session-controller` (the `session`, `skills` and `fileReferences`
  namespaces), `workspace-controller` (`workspace`, `directoryPicker`), `file-upload` (the
  `fileUploads` service, which the session controller hard-injects), `api-remotes` and
  `settings-controller` (used for `credentials/describe` only). The face provides no
  `profileContext` (PLAN D1), so dsh-base's `settings` and `config-editor` rows stay off.
- The page calls the host as `POST /api/<namespace>/<method>` and streams over one
  `/api/remote.mux` WebSocket (`face/client/js/wire/api.js`: `call`, and `openMux()`'s `stream`).

### 3.3 The client

- **Architecture.** Vanilla ES modules, no bundler and no framework: one store, pure reducers,
  string renderers, one `innerHTML` per render, `data-action` delegation. Every host string passes
  through `esc()`.
- **The composer.** Its words live outside the store (`composerText` in `app.js`), so typing never
  renders. A render waits while an IME composition is open or a press is down (`composing`,
  `pressed`, `pending`), and after a render the page puts back focus, caret, typed values, ticked
  options and open disclosures by id.
- **Preferences.** `localStorage` `gravit-ui.prefs` (`prefsOf`: theme, rail collapse, the last
  conversation, last-seen, collapsed groups). A script in `index.html` applies the theme before
  the first paint.
- **Keys bound today.** Escape closes the topmost layer, in this order: an inline edit, a confirm,
  the run sheet, the owner sheet, Sell many, the stock drawer, Details, Settings, the statement, a
  venue's details, Trade's ticket. Enter commits an inline editor. Nothing else is bound.
- **Layout.** Nav 220 px (68 px folded), list 300 px, Details 400 px, the stock drawer and the
  other drawers 460 px. Details makes room: the head, the thread and the composer take a 400 px
  right margin (460 px with the stock drawer). From 861 to 1,399 px the list folds away while a
  drawer is open. At 860 px or narrower the page stacks into one column, and the page scrolls, not
  the thread.
- **Type.** `--font-sans` is Manrope, Noto Sans SC, PingFang SC, Hiragino Sans GB, Segoe UI,
  system-ui. `--font-mono` is IBM Plex Mono, SF Mono, Menlo, Consolas, with no CJK fallback. Google
  Fonts loads Manrope 400–800, Noto Sans SC 400, 500 and 700, and IBM Plex Mono 400 and 500. The
  base is `15px/1.45`, and every size in `app.css` is a fixed px value.
- **Tokens** (`css/tokens.css`), the values the boards use:

  | Token | Cream | Black |
  |---|---|---|
  | `--bg` | #f6f4ef | #0e0f11 |
  | `--surface` | #ffffff | #17191c |
  | `--surface-2` | #ece8e0 | #212429 |
  | `--border` | #e6e1d7 | #2b2e34 |
  | `--text` | #121417 | #f2f3f5 |
  | `--dim` | #5d5a53 | #a3a9b4 |
  | `--primary` | #121417 | #f2f3f5 |
  | `--alloc-equity` (the blue: your bubble, the send key, the unread dot) | #3b5bdb | #5c7cfa |
  | `--up` / `--up-fill` | #0d7a52 / #e4efe6 | #4cc38a / #16301f |
  | `--down` / `--down-fill` / `--down-edge` | #b4441c / #f6e6df / #e8c2b4 | #f08a6c / #35201a / #f08a6c |
  | `--warn` / `--warn-text` / `--warn-fill` / `--warn-edge` | #d9741e / #94480c / #fdf0e3 / #f3d2b4 | #f0a040 / #f5b866 / #2b2112 / #f0a040 |

  Radii 10, 16, 20 and 999 px. Bubbles are 18 18 18 4; yours is 18 18 4 18.
- **Icons** (`js/icons.js`). `search`, `upload`, `file`, `fileCheck` and `link` exist and are
  unused. There is no pin, eye or paperclip glyph yet.
- **Tests.** `node --test` via tsx, offline. The client suite runs on a fake DOM
  (`face/tests/client/`, 66 files); 33 of them hold 954 `assert.match` and 245
  `assert.doesNotMatch` over exact English HTML. `css.test.js` holds that every class the screens
  emit has a rule, every rule is emitted, `app.css` names no colour by hex, every `var(--x)` is
  declared, and the braces balance. `wire-words.test.js` finds no Chinese in six moved wire
  modules. `messages-screen.test.js` asserts the composer has no attach keys; pick 4 reverses
  that.
- **Chinese already in the client source:** `host/modules-view.js`, `runs-view.js` and
  `run-sheet-view.js`; `wire/room.js` and `wire/market-model.js`; `render/discover.js`,
  `render/markets.js` and `render/lunhui/{block,sources,stock}.js`. Most of it is content (the
  Lunhui modules' sub-titles, the messages sent to Gravit). Some is the face's own words, drawn in
  Chinese in English today: the A-share figures' units (万, 亿, 万股, 亿股; the 2026-10-31 spec §5)
  and two notices in a room's discussion (`wire/room.js`).
- **Formatting.** `js/time.js` holds English month names and Today/Yesterday; 13 files format
  numbers with `en-US`.

### 3.4 Running and drilling

- Never the live `~/.dsh` or port 3090, and never `npm run service`. A scratch face takes its own
  `FACE_PORT`, a scratch `DSH_HOME`, `FACE_DESK=0` and `FACE_ACCOUNT_URL=http://127.0.0.1:9` (a
  scratch page would otherwise pair with the operator's Account).
- `face/client/*` is served with no cache headers: hard-reload after an edit.
- A drill in which Gravit must answer runs keyed, in the operator's terminal (`face/README.md`
  "Run").

## 4. Decisions

### 4.1 The operator's (2026-11-03)

| # | Decision |
|---|---|
| O1 | The ten picks of §1, in this round. |
| O2 | The eighteen of N1 are dropped. |
| O3 | The plugin manager and market and the dsh settings forms move to the session "Discover and the dsh plugin market". |
| O4 | Not for this product: workspaces and folder pickers, the default agent preset, the Electron shell. |
| O5 | Up stays green and down stays red in both languages: "不用切换，还是绿涨红跌". 中文 does not switch to red-up. |
| O6 | The 2026-10-28 rule stands (no tool cards), and the question card stays blocking (no timed questions). |
| O7 | Search runs on the face's own index, which finds any word in any language (§12, Q1). dsh's `session-query-sqlite` stays closed. |
| O8 | PDFs: Poppler extracts the text first; when the layout matters, the page is rendered to an image and read by a role that runs a model taking images (§12, Q2). The operator's own proposal. |
| O9 | A conversation chip in a message to a room's bots is refused this round (§12, Q3). |

### 4.2 The parent session's calls

The parent session drew these on the boards. The operator has seen them and not objected, but has
not approved them one by one. Each stands in this design, and each is a word to change.

| # | Call | Board |
|---|---|---|
| P1 | The search box is always visible under the list head. ⌥⌘K focuses it (dsh's web key; the browser owns ⌘K). The page highlights the query inside the snippet; dsh does not. | List ①③ |
| P2 | Pin is a hover key on the row, plus Pin in Details › This task. Pinned rows sort first within their own group. | List ⑤ |
| P3 | The one-line composer `<input>` becomes a multi-line editor (Shift+Enter for a new line), so references can sit in the draft as chips. | Composer ② |
| P4 | Background jobs are a Details section beside Children, opened from a header chip. dsh uses a popover. | Thread ④ |
| P5 | Secret masking also applies to the list's preview line; dsh leaves previews alone. It is display only. | Thread ⑤ |
| P6 | The language choice is remembered in the browser, like the theme; dsh keeps it on the host. The Chinese terms on the board are a draft for the operator. | Settings ①④ |
| P7 | The shortcut sheet lists keys and does not rebind them. | Settings ③ |

### 4.3 This document's calls

These are mine. Each settles something the boards leave open, or something the code forced, and
each can be overturned at review without a redesign. §5 gives each in context.

| # | Call | Why |
|---|---|---|
| D1 | The index holds the list's own conversations, a room's log among them; a subagent child's session is not indexed, and a deleted conversation leaves it. | A member's words are drawn in its room's thread; a child's are drawn nowhere the list reaches. |
| D2 | A title match with no content hit shows the conversation's preview line as its snippet. | Every result then reads the same way. |
| D3 | An archived result opens as its Archived row opens today. | List ④ drew dsh's "not until it is back"; the face's own rule already opens archived conversations. |
| D4 | A failed content search keeps the title matches and says "Could not search inside conversations". | dsh's silence would read as "no match" (A5). |
| D5 | Withdrawn: it opened dsh's index with a policy entry. O7 replaces it. | dsh's index finds no Chinese word inside a sentence (§5.1). |
| D6 | Pinned rows sort newest first among themselves. | The order the rest of the group already uses. |
| D7 | Archiving a pinned conversation in the face unpins it; un-archiving does not pin again. | The host drops the pin only for its own archive, and PLAN D14 keeps the face's archive apart. |
| D8 | One draft per conversation, in memory. | Uploads belong to one session. |
| D9 | The menus redraw only their own container on a keystroke. | Typing never renders the page (§3.3). |
| D10 | On New message, `@` and attachments work (files upload after the conversation is created, before its first prompt); the `/` menu opens once the conversation exists. | Commands need a live agent; the listing and the references need no session. |
| D11 | The `/` menu hides `/plan`, `/permission` and `/feedback`. Typed by hand they still reach the host. | The operator dropped plan mode, the permission preset and message feedback (O2). The board drew `/compact` and `/goal`. |
| D12 | Files go with a command only when its `input.attachments` takes them; otherwise the page refuses before sending. | The host refuses them anyway; the page says so first. |
| D13 | On a cold conversation the Commands group shows the commands last read for the same preset, and sending a `/` line promotes the conversation to a follow before the command runs. | Reading must not activate (PLAN D16). `commands/*` need a live agent, which today makes a `/` line on a cold conversation fail. |
| D14 | The file listing is a face route, not dsh's `file-reference-local` row. | That row adds an "@ means a path" sentence to every agent's system prompt on every request, and so frames every `@bot` as a path. |
| D15 | A file chip serializes to `@<path>`: relative under the conversation's working directory, absolute otherwise, quoted when it holds a space. | Unambiguous for Gravit's tools from where Gravit runs. |
| D16 | The listing includes gitignored files and skips `.env*`, `.git`, `node_modules`, `dist`, `build` and `.claude/worktrees`. It reads names only and follows no link. | The operator's book is worth pointing at; the key files should not be one click from the model; the worktrees are other checkouts' copies. |
| D17 | In a sent bubble a conversation reference is a chip; a file or bot reference is drawn as its text. | Only the conversation markup is unambiguous in history. |
| D18 | The page keeps a file's bytes until the message is sent, and uploads again when the host has dropped the receipt. | Receipts die with the session's agent. |
| D19 | A conversation whose model refused an image is remembered as refusing images until a reload; the next image added there shows the line at once. | The host has no read that says whether a model takes images. |
| D20 | A draft with files and a bot chip is refused before sending ("Files go to Gravit, not to a room's bots"). | The room path carries text only. |
| D21 | Details › Usage keeps Tokens in, Tokens out and Context, and gains Cache hit and the stats rows. | The board drew two rows as existing that do not exist. |
| D22 | A quiet "Earlier messages" key at the top of the thread while older history exists. | The window's start is otherwise a silent cliff, and the rail needs the same paging. |
| D23 | A job's Stop asks twice with `confirmPair`, as Children's Stop does. | The board's note ④, and one confirm pattern in Details. |
| D24 | Masking also covers a search snippet and the turn rail's card. | P5's reason (an excerpt quotes the words out of context) holds for both; dsh leaves both alone. |
| D25 | Two shapes join dsh's list: a Telegram bot token and an Alpaca key id. | Keys this tree holds. |
| D26 | A revealed value stays revealed while its conversation is open. | The face renders on every host event, so dsh's re-mask on every render would hide the value at once. |
| D27 | The language defaults to English. | Today's page. dsh follows the browser's language list when nothing is chosen. |
| D28 | Numbers keep `en-US` grouping in both languages. | zh-CN groups the same way; one number format. |
| D29 | Noto Sans SC 800 joins the font link. | 800-weight titles draw at 700 in Chinese today. |
| D30 | The 中文 plan ends with the operator correcting `zh.js` on the live page. | The board's terms are a draft (P6). |
| D31 | Code size from 10 to 16 px, default 12. | dsh's range, and the face's usual mono size. |
| D32 | The text and code sizes scale text, not layout. | dsh's behaviour; the columns stay usable. |
| D33 | dsh's rename, fork, archive and double-Escape keys are not bound. | They are not on the board. |
| D34 | The Escape order: a menu, the lightbox, the shortcut sheet, the search box, then today's chain. | Innermost first, as today's chain is ordered. |
| D35 | The words become table keys with English only first; 中文 arrives whole in a later plan (§10). | A half-English 中文 page would read as broken. |
| D36 | The face's words that are Chinese today (the A-share units 万 and 亿, two room notices) keep their Chinese in both languages. | Nothing changes in English, and the units were chosen in Chinese (the 2026-10-31 spec §5). |
| D37 | Once plan 6 has landed, new client words go into the tables; once plan 7 has, they ship in both languages. Plans 6 and 7 rebase onto whatever client work lands before them, the Account split's Identity tab included. | The Account split adds a tab, four sheets and a routing editor to the client. Whichever arc lands second adapts, so neither waits on the other and no screen stays English under 中文. |

## 5. The design

The sections follow the boards: the list (5.1, 5.2), the composer (5.3–5.6), the thread (5.7–5.9),
Settings (5.10–5.12). Each section says what the operator sees, how it behaves, what it needs
from the host, and where it lands in `face/client`. "D<n>" marks one of my calls (§4.3).

### 5.1 Search every conversation (pick 1)

**What the operator sees** (List A–C; P1):
- A search box sits under the list head, between "Messages" and the groups: a 36 px pill with
  the search glyph, the placeholder "Search conversations" and the hint ⌥⌘K. It is always there
  (P1), and ⌥⌘K focuses it from anywhere.
- A non-blank query replaces the groups with one flat list of at most 20 results, headed by their
  count ("4 conversations"). Each result has two lines. The first holds the title and its time;
  the second holds the channel's label in bold and the snippet, with the query highlighted by the
  page (P1; a `mark` in the warn fill and text colours, as the board draws it).
- An archived result is drawn dim with an "Archived" chip. A conversation the face archived
  carries Un-archive (List ④).
- Esc in the box clears the query and puts the groups back. A second Esc leaves the box (§5.12).
- The edge states (List C):
  - **Searching:** skeleton rows and "Searching every conversation…".
  - **Nothing found:** "No matching conversations".
  - **More than 20:** "Showing the first 20. Narrow your search."

  The board's fourth state ("Titles only. Searching inside conversations is off on this face")
  goes: the face's own index is always on (O7).

**Behaviour:**
- **Title matches show at once.** The page matches the query, case-insensitive, against the titles
  and channel labels of the conversations it holds, as dsh's sidebar does.
- **Content matches follow** 250 ms after typing stops, from the face's own index (below). Its
  route answers `{items: [{sessionId, snippet, match: [start, end]}], hasMore}`: at most 20 items,
  each snippet at most 240 characters around the first match, with the match's place in it, so the
  page highlights exactly what matched (P1). The page drops any answer that is not the latest
  query's (the face's sequence-token pattern).
- **The query** is trimmed and capped at 500 characters.
- **Merge:** title matches first (newest first), then the content matches not already listed,
  newest first, at most 20 in all. "More than 20" shows when the route says `hasMore` or the merge
  overflows.
- **What a hit opens** (D1). The index holds the list's own conversations: the root channel's and
  each channel's, the desk's, a bot's home, and a room's own log, where its members' answers are
  drawn. So a hit opens its conversation. A subagent child's session is not indexed, and a
  conversation leaves the index when it is deleted.
- **A title match with no content hit** shows the conversation's preview line as its snippet (D2).
  Snippets and previews pass through the masking of §5.9.
- **An archived result opens** as its row in the Archived group opens today (D3). List ④ drew
  "not offered until it is back", which is dsh's behaviour; the face already opens archived
  conversations from their group, and the search keeps the face's rule.
- **A failed content search** keeps the title matches and adds the muted line "Could not search
  inside conversations" (D4). dsh stays silent.

**Why not dsh's index** (measured 2026-11-03 by the builder check, re-run here):
- dsh-base's `session-query-sqlite` row ships closed, `{path: ':memory:', openAt: never}`, and a
  `session/search` call answers `gateway/internal` ("session search failed: …disabled…").
- Opened, it would still fall short of §1's first success line for the operator's largely Chinese
  conversations:
  - It uses SQLite FTS5's `unicode61` tokenizer, which does nothing special for Chinese: a run of
    Chinese characters with no space or punctuation in it counts as one word. In
    "贵州茅台的估值很高，宁德时代下跌了", "茅台" and "估值" find nothing; only a whole clause matches.
    English words and numbers do match.
  - It searches the current surface only. Compaction marks every message it summarizes as shadowed
    (the face's thread then drops them too), so what a conversation said before a `/compact` is
    not found, and the `/` menu makes `/compact` one click.
  - It indexes user and assistant messages only, so a Lunhui composed answer (a `lunhui_present`
    tool result) is not found.
- It stays closed: no policy entry, and no field in `/data/host.json` (O7, replacing D5).

**The face's own index** (O7):
- **What it holds:** what each of the list's conversations said, as the face draws words: the
  operator's messages, Gravit's and the bots' answers, a room's lines, the words of a Lunhui
  composed answer, and the messages a compaction has since folded away, with its summary. It holds
  nothing the face does not draw as words: tool calls, context rows, reasoning.
- **How it matches:** SQLite FTS5 with the `trigram` tokenizer for a query of three characters or
  more, and a `LIKE` scan of the stored text for one or two characters. So any word in any language
  is found, "茅台" inside "贵州茅台的估值很高" included (measured on this Node's SQLite, 3.51.3). Latin
  letters match regardless of case.
- **A hit in folded history** opens its conversation. The thread draws the compaction's place, not
  the folded message, so the snippet is where the operator reads it.
- **Where it lives:** one SQLite file in the face's own directory under the harness home, beside the
  face's other state. It is one more copy of the conversations' text (§11).
- **How it stays current:** lazily, at each search. Every conversation whose log changed since it
  was last indexed is read again from where the index left off, through the face's in-process read
  of a stored log (as `desk-session.ts` `readSessionEvents` reads one), never activating a session.
  The first search after the index is created reads the whole history; later ones read only what
  changed, across restarts too. A log the host cannot open (the sessions written before 0.2.0) is
  skipped and counted.
- **The route:** a `/data` route, fenced by `isTrustedDataRequest` and bounded (500 characters, 20
  items), answering a fixed line when it fails. Plan 1 builds it (§10).

**Where it lands:**
- `render/rail.js` `renderList`: the box between `.list-head` and `.rail-rows`. While a query
  stands, the results replace the rows; the rows keep their scroll position for when it clears.
- A pure `host/search-view.js` (the merge, the hits' mapping, the highlight runs, the edge state)
  beside an impure `host/search.js` (the quiet timer, the call, the token). Markets' `searchSoon`
  and Discover's local filter are the models.
- The index and its route: a new face module in `face/src/`, registered with the other `/data`
  routes.
- The query lives in the store, as Markets' does, and the box keeps its focus and caret across the
  render.

### 5.2 Pin a conversation (pick 2)

**What the operator sees** (List A and C; P2):
- A pinned row is an ordinary row with a filled pin glyph before its time. There is no "Pinned"
  header.
- Hovering a row, or focusing it from the keyboard, shows a round pin key in place of the time.
  Pressing it pins or unpins.
- Details › This task gains Pin / Unpin between Fork and Archive.
- Pinned rows lead their own group (the root channel, Desk, a channel, a bot's home, No channel:
  P2). Among themselves they sort newest first, as the group does (D6). An archived row is never
  pinned.

**Behaviour:**
- `workspace/pinSession {request: {sessionId}}` answers the whole pin set, `{pinnedSessionIds}`.
  `workspace/unpinSession` answers the same and never fails. Pinning a session the host archived
  fails with `gateway/bad-request`, and an unknown one with `session/not-found`.
- The page learns the pin set by following `workspace/follow` over the mux. Its first frame is
  `{type: 'baseline', value: {items, archivedSessionIds, pinnedSessionIds}}`; later
  `{type: 'pinned', pinnedSessionIds}` frames carry each change, made in any browser. There is no
  unary read, and `session/list` rows carry no pin. The follow opens again when the mux
  reconnects.
- The pin set lives on the host (`$DSH_HOME/storages/workspace.json`, `global.pinnedSessionIds`),
  so every browser sees the same pins.
- Archiving drops the pin. The host does this for its own archive. The face's archive is the face's
  own (PLAN D14), so archiving a pinned conversation in the face also unpins it: one
  `unpinSession` after the archive succeeds (D7). Un-archiving does not pin again.
- A failed pin leaves the row as it was and puts "Pin failed. Try again later." on the status line
  (dsh's words).
- A key inside the row's `<a>` would be invalid HTML. The row becomes a container that holds the
  link and the key side by side, the way a module card holds its Run key (the 10-28 spec §5.1).

**Where it lands:** `host/list-view.js` `groupsOf` (pinned first within a group);
`render/rail.js` `row` (the glyph and the hover key); `render/messages.js` `rowKeys` (Pin /
Unpin); `host/actions.js` (`pin`, `unpin`; `archive` unpins); `host/live.js` (the workspace follow,
and the pin set into the store).

### 5.3 The composer becomes an editor (P3)

Three picks share the composer: the `/` menu, `@` references and attachments.

**What the operator sees** (Composer A–C):
- The one-line pill becomes a box with a 20 px radius. It holds the paperclip key on the left
  (§5.6), the editor, and the 36 px blue send key on the right.
- The editor starts one line tall and grows with its text to about eight lines, then scrolls.
  Shift+Enter starts a new line, and Enter sends (§5.12).
- Attachments sit in a rail inside the box, above the text (§5.6).
- A pick from the `@` menu sits in the text as a chip: an icon and a label on a pale blue fill
  (`#eef1fb` on the board; it becomes a token pair, since `app.css` names no hex). A chip is
  atomic: the caret steps over it, and Backspace after it removes it whole.
- The `/` and `@` menus open above the box, and so does the refusal line for an image the model
  cannot take.

**The draft:**
- A draft is a model, not the DOM: a list of runs (text and chips) and a list of attachments. It
  lives outside the store, as `composerText` does today, so typing still never renders the page.
- There is one draft per conversation, in memory only (D8). Today one string follows the operator
  from conversation to conversation, which cannot hold uploads: they belong to the session they
  were sent to (§5.6). A reload clears the drafts, as it does today.
- A render either rebuilds the editor from the draft and puts the caret back, or keeps the editor's
  node across renders; that is the builder's choice. Either way, the tests prove that a render
  during typing keeps the words, the chips, the caret and an open IME composition (A7). Renders
  still wait while a composition is open (`composing`).
- The menus update on every keystroke without rendering the page. Their state (`kind`, `query`,
  `items`, `active`) lives beside the draft; a keystroke redraws only the menu's own container,
  and a full render redraws it from that state (D9).
- A failed send keeps the whole draft, chips and files included. Today it keeps the words.
- Pasted text arrives as plain text. Pasted files and images become attachments (§5.6).

**On New message**, where no session exists yet (D10):
- `@` works, since the file listing and the conversations need no session.
- Attachments work: the files upload after the conversation is created and before its first
  prompt.
- The `/` menu opens once the conversation exists, because commands need a live agent.

**Where it lands:** `render/messages.js` `renderComposer` and the three screens that call it; a new
`js/composer/` holding the draft model, its serializer and the menus (pure); the editor's glue in
`app.js` (`sendNow`, `typed`, the key handler).

### 5.4 The `/` menu (pick 3)

**What the operator sees** (Composer A ①):
- Typing `/` at the start of the draft, or after a space or punctuation, opens a menu above the
  box: at most 400 px tall, 520 px wide on the board.
- It has a Commands group and a Skills group. Each row shows an icon, the title, the `/name` in
  grey mono, and the description at the right. A command's title is its name, capitalized; the host
  gives no other.
- Filtering matches letters in order, case-insensitive, with prefix matches first. The group
  headings hide while a query is typed.
- Keys: ↑ and ↓ move, Enter or Tab chooses, Esc or Shift+Tab closes. Focus stays in the editor,
  and the menu's footer lists the keys.

**What it lists:**
- **Commands:** `commands/list {agentId: <sessionId>}` answers rows `{definitionId?, name,
  description, input?: {hint, attachments?}}`, sorted by name. A row with `input` takes arguments;
  there is no other kind or group field.
- On this face the host lists `/compact`, `/goal`, `/plan`, `/permission` and `/feedback`, all
  dsh-base rows; there is no `/model` and no `/export`. The menu hides `/plan`, `/permission` and
  `/feedback` (D11): they are plan mode, the permission preset per conversation and message
  feedback, all three dropped by the operator (O2). The board drew exactly `/compact` and `/goal`.
  Typed by hand, the hidden three still reach the host, as today.
- **Skills:** `skills/list {request: {sessionId}}` answers `{skills: [{path?, name, description,
  whenToUse?, modelInvocable}]}`: the user-invocable skills of the conversation's composition
  (`account-seat-guide` and `style-gravit` among them). It reads a cold conversation without
  activating it.
- A command that takes arguments is listed only when `/` begins the draft (dsh's rule).

**Choosing:**
- A command with no arguments (`/compact`) runs at once: `commands/execute {agentId, line:
  '/compact', submittedAttachments: []}`. Its result goes on the status line, as today. The draft
  keeps whatever else it held.
- A command with arguments puts `/name ` into the draft for the operator to finish; sending runs
  it.
- A skill puts `/name ` into the draft. Sending sends that literal text: no command claims it, so
  it goes as a prompt, and the host loads the skill from the literal `/name` (dsh's rule: a menu
  pick and a hand-typed token load alike, and a name shared with a command stays the command). The
  builder pins this with a real boot. If rc.5 does not load a skill that way, the Skills group is
  not drawn (A5).
- Files in the draft go with a command as its `submittedAttachments` only when the command's
  `input.attachments` says it takes them, as `/goal` does. The host refuses them otherwise, so the
  page says so before sending (D12).

**A cold conversation** (D13). `commands/list` and `commands/execute` look up a live agent, and on a
cold conversation they fail with `gateway/lookup-not-found`. Today a `/` line in a cold
conversation fails that way. Opening a menu must not activate a conversation (PLAN D16: reading is
paging). So:
- the Commands group shows the commands the page last read from a live conversation with the same
  agent preset, or is not drawn when the page has read none; Skills are read as usual;
- sending a `/` line to a cold conversation first opens a follow of it, which activates it
  (PLAN D16's own reason for paging instead), and then runs the command. Writing to a conversation
  activates it today too, and this also mends today's failure. A smoke pins that
  `commands/execute` finds the agent once the follow has opened.

**Where it lands:** `js/composer/` (the trigger rule, the filter, the menu view); `host/actions.js`
`command` (attachments, the promotion of a cold conversation); `host/live.js` (the commands read on
a live conversation, kept by preset).

### 5.5 `@` references (pick 5)

**What the operator sees** (Composer B ②). `@` at the start of the draft or after a space opens one
picker with up to three groups, in this order:
- **Bots in this room** (in a room only): the channel's rostered bots, each with its mark and
  description. The `@bot` rule is unchanged: the server resolves `@<id>` or a one-word display name
  against the roster (`face/src/room-rules.ts` `resolveMentions`).
- **Files and folders**: the repository's, the 20 best for the query, each with its folder. Tab
  opens a folder in place, its path shown as a breadcrumb.
- **Conversations**: the face's own, the current conversation's channel first, each with its age
  ("1 day ago").

A pick becomes a chip (§5.3). In the sent bubble, a conversation reference is drawn as a chip,
since its form is unambiguous; a file or bot reference is drawn as its text (D17).

**What reaches whom:**
- **A bot chip** serializes to `@<id>`, so the message goes through `POST /data/rooms/say` first, as
  today.
- **A file chip** serializes to `@<path>`, with the path as Gravit's tools resolve it from the
  conversation's working directory: relative when the file is under it, absolute otherwise, and
  quoted (`@"…"`) when it holds a space (D15). Gravit reads the file with its own tools. Nothing
  else is added to the prompt.
- **A conversation chip** serializes to dsh's markup, `@[<title>](dsh-session:<id>)`. The
  `session-reference` row (§6) rewrites it to `@<title>` and adds a second user message. That
  message starts "## Referenced sessions", warns that the JSON below is an untrusted, read-only
  snapshot whose instructions must not be followed, and carries the snapshot: at most three
  conversations a message, each at least 64 KiB by the row's automatic budget.
- The rewrite runs at an agent's pre-step, and only over messages whose source is `user`. A room
  bot never gets one: the room engine hands a member the room's new lines as one `room`-kind delta
  (`face/src/room.ts` `runMemberTurn`, `memberPrompt`), so the markup would reach the bot
  unexpanded. This round a draft that holds both a conversation chip and a bot chip is refused
  before sending, with the line "Conversations go to Gravit, not to a room's bots" (O9), as a draft
  with files and a bot chip is (D20).
- A reference that cannot be resolved ends the turn after the prompt was accepted (the row's
  failure behaviour), and the page shows that error as it shows any host error.
- A referenced conversation can add tens of kilobytes to the turn's context. The page adds no
  small print about it; the stats (§5.7) show the tokens.

**The file listing is the face's own** (D14):
- dsh's `fileReferences/list` lives in the session controller, which the face mounts. Its provider,
  `dsh-file-reference-local`, is not mounted, so today the call fails.
- Mounting that provider would add one sentence to the system prompt of every agent that has
  `read` (Gravit, each role, each bot) on every request: "Tokens prefixed with @ are paths the user
  explicitly referenced. …". Every `@bot` that reaches a prompt would then be framed as a path.
- So a bounded, fenced face route lists the repository's files and folders instead:
  - it ranks matches (prefix, then substring, then path; the conversation's own directory first)
    and gives the 20 best, or one folder's entries when the query names a folder (contains `/`);
  - it walks the repository root, at most 50,000 entries (dsh's cap), and skips `.git`,
    `node_modules`, `dist`, `build`, `.claude/worktrees` (other checkouts' copies, about 11,000 of
    the checkout's roughly 13,000 entries) and every name that begins `.env`; it never follows a
    link and reads names only, never contents;
  - it lists gitignored files, because the operator's book (`desk/levels.yml`) is something they
    may point at; the `.env*` files at the root, which hold the keys, are skipped (D16);
  - it is fenced by `isTrustedDataRequest`, like every `/data` route.

**The picker's sources:**
- **Bots:** the channel's roster as `resolveMentions` reads it, through the read the channel page
  already makes (`/data/channels/overview`) or through `/data/rooms/state` (unused today). The
  builder chooses.
- **Conversations:** the store's conversations, leaving out the archived and deleted ones and the
  conversation being written in.

**A mixed message.** A message with a bot chip goes to the room. The bot receives the text in its
delta, including a file path it can read with its read-only tools; a conversation chip cannot go
with it (O9). A message with no bot chip in a channel conversation is tried at `/data/rooms/say`
and falls through to Gravit when it addresses no bot, as today.

**"In a room"** means a conversation whose channel rosters at least one bot. That is where the
server's `@bot` rule applies (`/data/rooms/say`), whether or not a bot has answered there yet.

**Where it lands:** `js/composer/` (the trigger, the three sources, the chips and their
serializer); a new face module for the listing route (`face/src/`, registered with the other
`/data` routes); `render/thread.js` (the conversation chip in the operator's bubble).

### 5.6 Attachments (pick 4)

**What the operator sees** (Composer C and D, ③ and ④):
- **Adding:** the paperclip key opens the file picker. Files can also be dropped anywhere on the
  page, onto a full-page overlay ("Drop files or images here", with "Images: up to 20 a message,
  20 MB each"), or pasted.
- **In the draft:** a rail inside the composer box. Images are 64 px squares; other files are
  240 × 64 cards with an icon, the name and "EXT · size". The remove key (×) shows on hover. While a
  file uploads, its card shows progress ("1.1 / 2.8 MB"); a failed one is drawn in the down colours
  with "Upload failed · Retry".
- **In the thread:** the attachments sit right-aligned above the operator's bubble. A lone image
  draws up to 240 px wide; with others, images shrink to 64 px squares. Clicking an image opens
  the lightbox; Esc, a click outside or × closes it. A file is drawn as its card. The host cannot
  give a file back (`session/attachment` returns images only), so a file card opens nothing.
- **Refusal** (Composer C): when Gravit's model takes no images, the line "Gravit's model takes no
  images. Remove the image, or run Gravit on a model that does." sits above the box in the down
  colour, and the draft stays.

**Images:**
- They travel inline in the prompt, `{type: 'image', mediaType, data, name}` with base64 data:
  PNG, JPEG, WebP or GIF.
- The host enforces every limit: at most 20 a message, 20 MiB each and 200 MiB a message, 64
  megapixels, 8,192 px a side, and the declared type must match the bytes. A violation refuses the
  whole prompt as `session/attachment-invalid`, with the reason in `details.reason`.
- The page pre-checks count and bytes from the session's `imageLimits` projection
  (`maxImageBytes`, `maxImagesPerMessage`, `maxMessageImageBytes`, `maxImagePixels`,
  `maxImageDimension`, `mediaTypes`), as dsh's composer does, and leaves pixels to the host.

**Other files:**
- They upload at once to `POST /api/session/uploadFileBinary?sessionId=&name=` as
  `application/octet-stream`, under the owner's cookie. The answer is `{ok: true, value:
  {receiptId, file: {attachmentId, name, bytes}}}`, and the prompt carries `{type: 'file',
  receiptId}`.
- The host sets no type or size limit on files. The session must exist (live, or persisted and
  resumable); a subagent child's session is refused.
- Receipts are fragile. The host holds them in memory on the session and drops them when the
  session's agent is disposed, or once the prompt is in the history. So the page keeps each file's
  bytes in memory until the message is sent, and uploads again when the host refuses a receipt it
  no longer knows (D18). A reload drops the draft and its files.

**What reaches the model for a file** is never its bytes:
- The host saves a read-only copy under the harness home (`$DSH_HOME/attachments/v1/files/…`) and
  gives the model one line: the file's name, size and hash, then "verbatim read-only copy saved at
  "<path>". Read that path with your file tools when its contents are needed…". When the tool world
  cannot reach the copy, the line says so instead.
- Gravit's `read` reads UTF-8 text only (`FS_NOT_TEXT` otherwise), and `read_image` takes PNG,
  JPEG, WebP or GIF. So a CSV, a Markdown file or a log can be read with `read`. A PDF cannot, and
  no PDF tool ships; the next part says how Gravit reads one (O8).
- The builder confirms on a keyed drill that Gravit's tools reach the saved copy at all. The host
  maps the path into the tool world.

**How Gravit reads a PDF** (O8, the operator's proposal): the text first with Poppler, and the
layout, when it matters, as a rendered page that a role reads.
- **Poppler** is installed on the operator's Mac through Homebrew (26.04: `pdftotext`, `pdftoppm`,
  `pdfinfo`). Gravit runs it from its own shell, so the face writes no PDF code and Gravit gains no
  PDF tool:
  - `pdfinfo <file>` for the page count;
  - `pdftotext -layout -f <first> -l <last> <file> -` for a range of pages' text, columns kept;
  - `pdftoppm -png -r 110 -f <n> -l <n> <file> <$TMPDIR/name>` to render a page when its layout
    matters: a table, a chart, a multi-column page, a scanned page with no text layer.
  - Renders go to `$TMPDIR`, which the sandbox grants; never into a strategy directory.
- **Gravit's model takes no images** (deepseek-v4-pro), so a rendered page goes to a role whose
  model does. A new role, `roles/pdf-page-reader/` (the name is a draft): `model:
  deepseek-official/deepseek-flash`, `allow: [read_image]`, and a persona that transcribes and
  describes. Given page images, it returns their tables, figures and layout in text, quoting what
  it reads and saying what it cannot read. Like every role, it appears in Gravit's preset as one
  tool, `role_pdf-page-reader`, and `cd face && npm run render:roles` regenerates the mirror.
- **`GRAVIT.md` gains one line** saying so: a PDF is read with `pdftotext`, and a page whose layout
  matters is rendered with `pdftoppm` and given to `role_pdf-page-reader`. It is 4,168 of its 4,500
  bytes today, and the line must fit (`face/tests/gravit-md.test.ts`).
- **On the card:** a PDF is an ordinary file card. The page claims nothing about whether Gravit
  read it (A5); what Gravit read, it says in the thread.
- **The agent box** of the two-box run (`compose.yml`) installs `poppler-utils`, so the same
  commands work there.
- **Measured before the choice** (2026-11-03, one generated Chinese sample): macOS's PDFKit gave
  the text exactly, and `pdftotext` misplaced one character. The operator chose Poppler: it is
  installed already, it works in the agent box too, and the rendered page covers what its text gets
  wrong.
- The role's `ROLE.md` and `role.yml` keep within the role library's caps and tests (§3.8 of
  `DEVELOPMENT.md`).

**Images and the model** (§9, open item 2):
- dsh's catalog marks `deepseek-flash` as taking text and images and `deepseek-v4-pro` as text only
  (`inputModalities`). On the account route, DeepSeek's live model list can override that.
- For a text-only model the host refuses a message with an image (`session/attachment-invalid`,
  `reason: MODEL_DOES_NOT_SUPPORT_IMAGES`). A later turn on such a model sees `[image omitted
  because this model accepts text only; …]`.
- Gravit's model is the operator's `agent-default-model` row, deepseek-v4-pro by the 10-28 spec's
  cost line. On that model every image to Gravit is refused.
- The page cannot ask in advance, since `session/modelCatalog` carries no modalities. It learns from
  the refusal: it draws the line, keeps the draft, and remembers that the conversation refused
  images until the page reloads, so the next image added there shows the line at once (D19).
- `dsh-compaction-image-offload` (a dsh-base row) swaps the oldest images for placeholders when the
  context is over budget. An image the host can no longer give back draws as a placeholder card.

**History:**
- The mapper keeps the image and file blocks of a user message. Today `blocksText` keeps text only,
  and an image-only message is dropped.
- An image block is `{type: 'image', attachment: {attachmentId, mediaType, bytes, width, height,
  name?}, offloaded?}`; a file block is `{type: 'file', attachment: {attachmentId, name, bytes}}`.
- Thumbnails load lazily through `session/attachment {sessionId, attachmentId}`, which answers
  `{attachment, data}`, and are kept in memory.

**In a room** (D20): `/data/rooms/say` carries text only. A draft that holds files and a bot chip is
refused before sending, with the line "Files go to Gravit, not to a room's bots"; the operator
removes one or the other.

`messages-screen.test.js`'s guard against attach keys is replaced by tests of the new keys.

**Where it lands:** `js/composer/` (the attachment list and its checks); `app.js` (the picker,
drop and paste listeners; the lightbox layer); `wire/api.js` (an upload helper with progress);
`wire/mapper.js` (image and file blocks beside `blocksText`); `host/kinds.js` (attachments on the
operator's message); `render/thread.js` (the bubble's attachments); `icons.js` (a paperclip;
`upload` and `file` exist).

### 5.7 The turn rail and session stats (pick 8)

**What the operator sees** (Thread ①②③):
- **The rail:** a 28 px strip on the thread's right edge, one tick per turn. A tick is 2 px tall,
  about 10 px from the next. A turn not yet loaded is 40% wide and faint, a loaded one 60%, and
  the turn in view full width in `--primary`.
- **Hovering a tick** shows a card at most 300 × 100: "TURN 5 · jump", the prompt on one line, and
  the reply on up to three lines once the turn has finished.
- **A click** scrolls smoothly to the turn. For a turn not yet loaded, the thread first loads
  earlier history up to it, and the tick pulses meanwhile.
- The rail is hidden under two turns and when the page stacks (860 px or narrower). It sits inside
  the thread, so it moves with Details' margin (400 px, or 460 px with the stock drawer).
- **Stats:** two pills right of the status line, under the composer, hidden until the
  conversation's first step has finished: "7 turns · 41 steps · 38 tok/s" and "182k tokens · cache
  63%". A click opens Details, scrolled to Usage.
- **Details › Usage** keeps Tokens in, Tokens out and Context, and gains Cache hit, Turns · steps,
  Model time, Tool time, First token (average) and Speed (D21; the board drew "Tokens" and "Cache
  hit" as though they existed already).

**The data:**
- Two dsh rows, `session-turn-outline` and `session-stats` (§6), add two projections:
  - `turnOutline`: `[{turn, seq, prompt, response}]`, one entry for every turn of the whole log,
    with `seq` the turn's `turn/start`. The previews are cut to 50 and 120 characters, as dsh's UI
    cuts them.
  - `sessionStats`: `{turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens}`.
- They reach the page as every projection does: in `session/projections` (a cold conversation's
  cut), in the follow snapshot, and live over `session/control` (`{type: 'projection', sessionId,
  key, value, seq}`), which `host/live.js` `acceptProjection` already reads.
- Derived values: speed is `decodeTokens` ÷ `decodeMs`, in tokens a second; first token is `ttftMs`
  ÷ `ttftSteps`; model time is `llmMs`; tool time is `toolMs`; cache hit is cache reads ÷ (uncached
  input + cache reads), from the `tokenUsage` the page already reads.

**Loading earlier history:**
- Today the page shows a window: a follow's snapshot for a live conversation, or one `session/page`
  (50 messages by default) for a cold one. There is no way to see further back.
- `session/page {request: {address, throughSeq, beforeSeq, maxMessages}}` pages backwards without
  activating the session. `beforeSeq` is exclusive, and the answer is `{records, hasMore}`.
- A rail click on an unloaded turn pages back, `beforeSeq` set to the window's first seq, until the
  turn's `seq` is in the window, then scrolls to it.
- A quiet "Earlier messages" key sits at the top of the thread while `hasMore` holds, so the
  window's start is never a silent cliff (D22).
- Earlier pages are prepended and deduplicated by seq, in both views, and the thread keeps its
  scroll position when a page lands above it. A live follow keeps appending as before.
- The follow-or-page policy itself does not change (A8), and the transport drill
  (`face/README.md`) runs again.

**Where it lands:** `host/live.js` (earlier pages; the two projections into the conversation);
`reducers/host.js` (prepend by seq); a pure `host/turns-view.js` (the ticks, which are loaded, the
active one from the scroll); `render/thread.js` (the rail and its card); `render/messages.js` (the
pills and Usage's rows).

### 5.8 Background jobs (pick 7)

**What the operator sees** (Thread ④; P4):
- **The chip:** in the head, beside Working, shown only while the conversation has a job. It
  carries a dot, "1 job running" ("2 jobs running"; "2 jobs finished" when none runs) and a
  chevron, and opens Details at Background jobs.
- **Details › Background jobs**, between This task and Children (P4):
  - A running job shows a dot and its command in mono on one line. Under it are the job's kind, its
    progress or detail and a ticking time ("bash · page 7 of 12 · 3m 04s"), and Stop.
  - Stop asks twice, the way Children's Stop does (`confirmPair`, "Yes, stop"), as the board's
    note ④ says (D23). The board's drawing showed dsh's "Click again to stop".
  - Opening a job shows its output in a mono block, streaming while it runs. "… earlier output
    dropped …" marks output the host dropped. The end reads "(no output)", "exit N" or "signal X".
    A Copy key copies the command.
  - Finished jobs fold under "Finished · N", with Clear. Clear is the page's own; the host keeps
    them.
- Jobs are forgotten when the face restarts, because the host keeps them in memory only.

**Where jobs come from:** Gravit's `bash` (or `pwsh`) with `run_in_background: true`, or a command
that outlives its timeout. The model reads and stops them with `job_output`, `job_list` and
`job_kill` (dsh-base's `tool-jobs`, already Gravit's tools). They are owner-fenced: a session
sees only its own jobs.

**The data.** One new dsh row, `job-controller` (`@deepseek-ai/dsh-api-job-controller`, §6), serves
the `job` namespace:
- `job/list {sessionId}`, a stream of `{type: 'rows', jobs: JobView[]}`. A JobView is `{id, kind,
  label, owner?, outputLimitBytes?, status: 'running' | 'stopping' | 'completed' | 'killed' |
  'failed', progress?, detail?, startedAt, finishedAt?, output: {total, earliest, spillPaths?}}`.
- `job/follow {sessionId, jobId, from?}`, a stream of `opened {job, from}`, then `output {chunks:
  [{at, text, channel?, gapBefore?}], next, lossy?}`, then `status {job}`.
- `job/kill {sessionId, jobId}`, answering `{outcome: 'requested' | 'already-finished'}`, or
  `job/not-found`.

The two streams ride the page's mux (`openMux().stream`); the gateway refuses a stream method over
POST. The page lists the open conversation's jobs only, and follows a job's output only while that
job is open.

**Where it lands:** `host/jobs.js` (the two streams and kill) and a pure `host/jobs-view.js`;
`render/messages.js` (the chip in `headRight`, the section in `renderDetails`).

### 5.9 Secret masking (pick 6)

**What the operator sees** (Thread ⑤). In the operator's own message, a value of a known key shape
keeps its first 8 characters and draws the rest as asterisks, in an inline monospace box with an
eye key. The eye's label is "Show secret", then "Hide secret".

**Where it applies:**
- the operator's own bubbles (`render/thread.js` `renderMessage`, the `from === 'you'` branch), as
  in dsh;
- the list's preview line (`render/rail.js` `previewOf`): P5;
- every other excerpt the face quotes from a conversation: a search result's snippet (§5.1) and
  the turn rail's hover card (§5.7). This is my call (D24): they quote the same words out of
  context, which is P5's reason. dsh leaves both alone.

It does not apply to Gravit's, a bot's or the host's bubbles, to context rows, to the Lunhui
composed answer, to titles, to a job's command line or output, or to the draft being typed. That is
dsh's scope and the board's.

**The shapes** (ported from dsh's `ui-secret-mask` credential formats, and tested against its
cases):
- these prefixes, each followed by the key's body: `sk-` (at least 20 characters with a digit),
  `AIza`, `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`, `glpat-`, `npm_`, `hf_`, `AKIA`,
  `ASIA`, `LTAI`, `AKID`, `xoxa-`, `xoxb-`, `xoxp-`, `xoxr-`, `xoxs-`, `sk_live_`, `sk_test_`,
  `rk_live_`, `rk_test_`, `whsec_`;
- JWTs;
- a private-key block, which keeps its BEGIN and END lines and its line breaks;
- the password in a `scheme://user:password@host` URL, masked whole.

My call (D25): the list gains the shapes of two keys this tree holds, a Telegram bot token
(`<digits>:<35 characters>`) and an Alpaca key id (`PK` or `AK` and 18 capitals or digits). Not
masked, as in dsh: `password=…` and passwords in prose.

**Drawing.** As in dsh: the box is `--font-mono` at 0.875em, one centred asterisk per hidden
character, so revealing never moves the line. Excerpt lines draw the masked form with no eye key.

**State.** A revealed value stays revealed while its conversation stays open, and masks again when
the conversation is left or the page reloads. My call (D26): dsh masks again on every render, but
the face renders on every host event, so dsh's rule would hide a value a second after the operator
showed it. Revealed values are page state, like the open disclosures the render already restores.

**What masking never touches.** The model, the log and a copy get the original. A selection copied
across a masked value carries the original characters, as in dsh. The masking is one pure module
over the text (`maskSpans(text)` → text and secret runs); every run still passes through `esc()`.

### 5.10 中文 / English (pick 9)

**What the operator sees** (Settings ①④). Language is the first row of Settings: a segmented pair,
English · 中文. A choice switches the face's own words at once and sets `<html lang>` to `en` or
`zh-CN`. The choice is remembered in this browser (P6) and applied before the first paint, like the
theme, so a reload never flashes the other language. The default is English (D27).

**What changes:** every word the face itself writes. That covers the navigation, screen and
section titles, buttons and keys, labels, placeholders, empty and error lines, the status lines
the face writes (such as `Not signed in — open the URL gravit-face printed`), aria labels and
titles, the shortcut sheet, times and dates (今天, 昨天, 11月3日), and the face's own labels on every
screen: Messages, Markets, Trade, Account, Discover, the channel pages, and around the Lunhui runs.

**What stays as written:**
- conversation and channel titles;
- the operator's, Gravit's and the bots' words;
- the Lunhui output: artifacts' values and verdict words, Gravit's notes, the modules' Chinese
  sub-titles;
- dsh's own texts (a command's result, a refusal, an error code) and the Account's (its refusal
  sentences, a venue's name, the lines of What you sign, which are what the signature covers);
- tickers, symbols, skill and tool names, a bot's name and soul;
- numbers: grouping stays `en-US` in both languages, which is also how zh-CN groups (D28);
- the face's words that are Chinese today, the A-share units and the room's two notices (§3.3),
  which keep their Chinese in both languages (D36);
- colours: up green and down red (O5).

**Mechanism:**
- One string table per language: `js/i18n/en.js` holds today's exact words, and `js/i18n/zh.js`
  the Chinese. A pure `t(key, params)` reads the active language. A key missing from `zh` falls back
  to English, as dsh falls back along its chain.
- With English chosen, every screen's HTML is what it is today, so the 954 and 245 assertions keep
  testing English. New tests cover 中文.
- English plurals take a count form in the table ("1 job running", "2 jobs running"); Chinese has
  one form.
- `js/time.js` takes its words from the table.
- The theme trap: `seg` (`render/controls.js`) uses a plain label as its `data-value`, and
  `setTheme` lowercases that value (`render/account.js` `renderSettings`, `app.js`). A translated
  label would store `奶油` as the theme. Every `seg` that carries a value passes `[label, value]`
  pairs whose value is an English key, and a test finds any `seg` whose values are its labels.
- Fonts (Settings ②): Chinese already falls back to Noto Sans SC and PingFang SC. `--font-mono`
  gains the same Chinese fallback after its mono faces. My call (D29): the Google Fonts link adds
  Noto Sans SC 800, so an 800-weight title keeps its weight in Chinese; today it draws at 700.

**The wire-words rule, re-taken.** `wire-words.test.js` keeps its six modules free of Chinese, but
its reason changes: the face's words live in the string tables, not in the modules that produce
states. A sibling test holds that no other client source gains Chinese outside `zh.js`; the files
that already carry Chinese as content (§3.3) are listed by name.

**The Chinese copy.** The board's terms are a draft for the operator (P6), and `zh.js` ships as a
draft too. The plan that turns the switch on ends with the operator reading the page in 中文 and
correcting `zh.js`. Their corrections are that plan's last commit (D30).

### 5.11 Fonts and sizes (pick 10)

**What the operator sees** (Settings ②):
- **Text size**: a stepper, `− 15 px +`, from 12 to 20, default 15.
- **More font settings**, folded:
  - **Text font**: a free field, empty for the default ("Default: Manrope, Noto Sans SC").
  - **Code font**: a free field, empty for the default ("Default: IBM Plex Mono").
  - **Code size**: a stepper, `− 12 px +`. My call (D31): from 10 to 16, default 12. The range is
    dsh's; 12 px is the face's usual mono size today.

**Behaviour.**
- The text size scales every text size in `app.css` in proportion: a size drawn at 14 px by
  default draws at 14 × size ÷ 15.
- The code size scales every `--font-mono` size the same way, against 12.
- Layout does not scale: the nav, list and drawer widths, avatars, keys, radii and gaps stay as
  they are. This is my call (D32), and it is what dsh does.
- A typed font family goes in front of the default stack, so a name the machine lacks falls back
  to the default.
- The four values are stored in `gravit-ui.prefs` beside the theme (`textSize`, `codeSize`,
  `textFont`, `codeFont`; `lang` joins them for §5.10) and applied before the first paint by
  `index.html`'s script.
- At the defaults the page measures as it does today.

**Mechanism** (the builder's form): `app.css`'s fixed sizes become relative to two root variables.

### 5.12 Keys and the shortcut sheet (pick 10)

**What the operator sees** (Settings ③). Settings › Keyboard shortcuts carries "Show all" and the
key ⌘ /. The sheet opens on ⌘/ (Ctrl+/ off a Mac) from anywhere: a centred sheet, 440 px wide on
the board, over the scrim. It has a "Search shortcuts" box, two sections (General and Composer)
and the line "⌘ is Ctrl off a Mac. Keys follow dsh's web bindings." It lists keys and rebinds
nothing (P7).

| Section | Action | On a Mac | Elsewhere |
|---|---|---|---|
| General | New conversation | ⌥⌘N | Ctrl+Alt+N |
| General | Search conversations | ⌥⌘K | Ctrl+Alt+K |
| General | Settings | ⌥⌘, | Ctrl+Alt+, |
| General | This sheet | ⌘/ | Ctrl+/ |
| Composer | Send | Enter | Enter |
| Composer | New line | ⇧Enter | Shift+Enter |
| Composer | Commands and skills | / | / |
| Composer | Files, conversations, bots | @ | @ |
| Composer | Close a menu, sheet or drawer | Esc | Esc |

Inside a `/` or `@` menu: ↑ and ↓ move, Enter or Tab chooses, Esc closes (the menu's own footer,
Composer A).

**Rules:**
- Keys match on `KeyboardEvent.code` and the modifier flags, never on `key`: on a Mac, ⌥ turns `key`
  into another character (⌥N is a dead key). "⌘" is Meta on a Mac and Ctrl elsewhere.
- The four General keys work from anywhere, the editor included.
- The page binds a key only where the browser lets a page take it. The builder checks each in the
  operator's browser, and the sheet lists only keys that work.
- Not bound this round: dsh's rename (⌥⌘G), fork (⇧⌘F), archive (⌥⌘A), and Escape twice to stop a
  turn. None is on the board (D33).

**Enter in the editor** sends, except in three cases:
- while a menu is open, Enter chooses the highlighted item;
- while an IME composition is open, Enter confirms the candidate (`isComposing`, keyCode 229, as
  the inline editors already check);
- Shift+Enter inserts a new line.

**The Escape order**, innermost first (D34): an open `/` or `@` menu (the draft stays); the
lightbox; the shortcut sheet; the search box while it has focus (the first Esc clears the query,
the next leaves the box). After those comes today's chain: an inline edit, a confirm, the run
sheet, the owner sheet, Sell many, the stock drawer, Details, Settings, the statement, a venue's
details, Trade's ticket.

## 6. The host side, pick by pick

Read on 2026-11-03 in the installed rc.5 packages, dsh-base's `cordis.patch.yml`, the web-app
bundle at tag `dsh-v0.2.1-rc.5`, and `face/src/overlay.ts` and `policy.ts`.

| Pick | What the page calls | The face today | This design |
|---|---|---|---|
| 1 Search | the face's own search route | dsh-base's `session-query-sqlite` ships `{path: ':memory:', openAt: never}`, so `session/search` answers `gateway/internal`. | The face's own index and route (O7); dsh's row stays closed. |
| 2 Pin | `workspace/pinSession`, `workspace/unpinSession`, the `workspace/follow` stream | Mounted (`workspace`, `workspace-controller`); unused. | Nothing on the host. |
| 3 `/` menu | `commands/list` (a live agent), `skills/list` (reads a cold session), `commands/execute` | Mounted (`session-controller` and dsh-base's command rows). | Nothing on the host. |
| 4 Attachments | `POST /api/session/uploadFileBinary`; image and file blocks in `session/prompt`; `session/attachment`; the `imageLimits` projection | Mounted (`file-upload`, `session-controller`, dsh-base's attachment rows). The client sends text only. | Nothing on the host. For PDFs (O8): Poppler on the machine (installed on the Mac; `poppler-utils` in the agent box), one `GRAVIT.md` line, and the role `pdf-page-reader`. |
| 5 Conversation references | the rewrite of `@[…](dsh-session:…)` at an agent's pre-step | `@deepseek-ai/dsh-session-reference` is not installed; it is published at 0.2.1-rc.5. | Install it, pinned, and add an overlay row `session-reference`. |
| 5 File references | a face route | `fileReferences/list` fails: it has no provider. | The face's listing route (D14). `dsh-file-reference-local` stays out. |
| 6 Masking | — | — | Nothing. |
| 7 Jobs | the `job/list` and `job/follow` streams, `job/kill` | dsh-base mounts `jobs`, `tool-bash` and `tool-jobs`. There is no job remote: a call answers `gateway/invocation-unavailable`. | Install `@deepseek-ai/dsh-api-job-controller`, pinned, and add an overlay row `job-controller`. |
| 8 Rail and stats | the `turnOutline` and `sessionStats` projections; `session/page` with `beforeSeq` | The two rows are absent. Paging backwards is served and unused. | Install `@deepseek-ai/dsh-session-turn-outline` and `@deepseek-ai/dsh-session-stats`, pinned, and add two overlay rows. |
| 9 Language | — | `dsh-client-locale` has a host half, but it is not mounted; the face inherits nothing. | Nothing on the host. |
| 10 Fonts and keys | — | — | Nothing. |

- **Publication.** The four new packages are published at 0.2.1-rc.5 (checked on the npm
  registry, 2026-11-03). They join `face/package.json` pinned exactly, with a lockfile made by
  the upgrade's rules (`face/README.md` "Upgrading dsh — three pins, not one"). Their peers are
  installed already or arrive in the same change; the builder checks with `npm ci`.
- **Why overlay rows.** The page depends on them as it depends on the other controllers, and an
  operator patch that turned one off would break a screen silently.
- **What each changes for Gravit.** `job-controller`, `session-stats` and `session-turn-outline`
  change nothing: they serve the page. `session-reference` adds the snapshot message, and only when
  a message names a conversation. The face's search index changes nothing for Gravit. No row here
  adds a sentence to any agent's system prompt (D14). The PDF role adds one `role_*` tool, and
  `GRAVIT.md` one line (O8).
- **What leaves the machine.** An attached image, a referenced conversation's snapshot and a
  rendered PDF page go to the model provider with the turn, as the operator's words do. Nothing
  goes to a new destination. The face's search index lives in its own directory under the harness
  home; the attachment copies are dsh's own storage there.

## 7. Tests and documents

**The face suite** (`node --test` via tsx, offline):
- The search index, over a fixture of session logs: a Chinese word of one, two and three or more
  characters inside a sentence; an English word in any case; a message a compaction folded away; a
  composed answer's words; a room's lines; a deleted conversation gone; a log that cannot be opened
  skipped and counted; a new message found after the next search reads it; the snippet's 240
  characters and the match's place; the route's fence (403 without the trusted header) and bounds.
- The overlay's tests: the four new rows are composed, each named for its installed package; a
  missing package refuses the boot by name, as the other required rows do.
- `tests/roles.test.ts`: the library's four roles, `pdf-page-reader` allowing `read_image` alone on
  `deepseek-official/deepseek-flash`, and the rendered mirror in step.
- `tests/gravit-md.test.ts`: `GRAVIT.md` with its PDF line still within 4,500 bytes.
- The listing route: the ranking, a folder's entries, the 50,000-entry cap, the skips (`.git`,
  `node_modules`, `dist`, `build`, `.env*`), no link followed, names only, and a 403 without the
  trusted header.
- Under `FACE_SMOKE=1`, on a real boot: the search route finds a seeded session by a Chinese word
  inside a sentence; pin and unpin move the `workspace/follow` frames; `commands/list` answers on a live conversation
  and `skills/list` on a cold one; a `job/list` stream opens; the two projections appear on a
  session with turns; `session/page` with `beforeSeq` pages back; an upload answers a receipt that
  a prompt accepts.

**The client suite** (fake DOM):
- **Search:** the merge, the hits' mapping (a member to its room, a child dropped), the highlight
  runs, every edge state, the 500-character cap, a stale answer dropped.
- **Pin:** pinned rows first in each group, an archived row never pinned, archiving unpins.
- **The editor:** the draft model (text runs, atomic chips, the serializer per chip kind), one
  draft per conversation, a render during typing that keeps the words, chips, caret and an open
  composition, Enter during IME composition, Shift+Enter, a failed send that keeps the draft.
- **The `/` menu:** the trigger rule, letters-in-order filtering with prefixes first, the hidden
  commands, a cold conversation, what each kind of choice does.
- **References:** the three sources, Tab into a folder, the serialized forms (relative and absolute
  paths, quoting, the conversation markup), the room path unchanged.
- **Attachments:** the pre-checks from `imageLimits`, progress and Retry, a dropped receipt sent
  again, the refusal line and its memory, history blocks drawn in the bubble, the lightbox closed
  by Esc. `messages-screen.test.js`'s no-attach guard gives way to these.
- **Masking:** dsh's cases and the two added shapes, the 8 kept characters, a key block, a URL
  password, the non-matches, the asterisk count, excerpts without an eye, a reveal that survives a
  render and resets when the conversation is left, a copy that carries the original, `esc()` on
  every run.
- **The rail and stats:** the ticks and which are loaded, hidden under two turns, the derived
  figures, Usage's rows, earlier pages prepended by seq without a duplicate.
- **Jobs:** the chip's words, the section's rows by status, Stop asked twice, the finished fold and
  Clear, the dropped-output line, the end lines.
- **Language:** with English chosen, every screen's HTML is unchanged; every key in `en.js` has a
  `zh.js` entry or falls back by name; placeholders match across the two; no `seg` uses labels as
  values; no Chinese outside `zh.js` but the content files §3.3 names; `<html lang>` and the
  preferences are applied before the first paint.
- **Fonts and keys:** no fixed font size left outside the two scales; matching by `code` (⌥ dead
  keys); the Escape order; the sheet lists only bound keys.
- **`css.test.js`** as today: every new class has a rule, and the chip's pale blue is a token, not
  a hex.

**Drills:**
- The transport drill (`face/README.md`) runs again after the paging change.
- The room drill gains one step: a message with a bot chip and a file chip reaches the bot with the
  file's path, and one that adds a conversation chip is refused before sending (O9).
- A new keyed drill, run in the operator's terminal on a scratch face, walks the ten:
  - search a word, pin a conversation and archive it;
  - `/compact` from the menu, then a skill from the menu;
  - `@` a file, which Gravit reads, and `@` a conversation, which brings its snapshot;
  - attach a CSV, which Gravit reads; attach an image, refused on deepseek-v4-pro with the line;
    send the same image in the conversation of a scratch bot whose route takes images
    (deepseek-flash), which accepts it and draws it in the thread; attach a broker report's PDF and
    ask about its text, which Gravit reads with `pdftotext`, then about a table on one page, which
    Gravit renders with `pdftoppm` and hands to `role_pdf-page-reader`;
  - ask for a background job, then follow its chip, its output and its Stop;
  - the rail on a long conversation, including loading earlier history;
  - a pasted key drawn masked;
  - 中文, the text size, ⌘/.

**Documents:**
- `DEVELOPMENT.md`: §3.3 (`GRAVIT.md`'s PDF line), §3.8 (the fourth role), §4.2 (the search and
  listing modules), §4.3 (the four overlay rows), §4.4 (the two routes), §4.5 (the search index
  among the face's state), §5.1–§5.6 (the new client files, wire contracts, host layer, rendering,
  state and styling), §7.3 (the tests), §7.4 (the drills).
- `face/README.md`: "The page (client/)", "Roles", "Upgrading dsh" (four more pins), "The two-box
  drill" (`poppler-utils` in the agent box), and the drills.
- `CLAUDE.md`: one clause in the `face/` map line, and the `roles/` line names the fourth role.
- `Gravit-Docs-and-Prompt-Loops.html`: loop 1 gains the image and file blocks and the
  referenced-sessions message; the system prompt's sections do not change.
- `ROADMAP.md`: the built log.

## 8. Left to the builder

- The CSS, within the tokens; the new glyphs (a pin, an eye and its crossed twin, a paperclip).
- How the editor survives a render, within D9 and A7.
- The search box's exact place in the list head, and its skeleton rows.
- The upload helper. `fetch` reports no upload progress, so an `XMLHttpRequest` is the likely
  form.
- The form of the two size scales in `app.css`.
- The listing route's name and its ranking details, within §5.5.
- The index file's name in the face's directory under the harness home.
- The read that gives the `@` picker its room's roster.
- Whether `call` learns to abort a request, or a stale answer is simply dropped.
- The wording of `zh.js` before the operator's pass, and of the new English lines within their
  meaning.
- The split of each plan into tasks.

## 9. Open items

1. **The PDF role's model and images.** dsh's catalog says deepseek-flash takes images; DeepSeek's
   live model list has not been read (it needs a key). The keyed drill confirms that
   `role_pdf-page-reader` reads a rendered page, and that Gravit's shell reaches Poppler and the
   saved copy.
2. **Images on Gravit's model.** On deepseek-v4-pro every image to Gravit is refused. A bot whose
   route takes images (deepseek-flash) takes them in its own conversations. Changing Gravit's model
   is the operator's `agent-default-model` row, not this design: model per conversation was
   dropped (O2).
3. **Gravit's tools and the saved copy.** The keyed drill confirms that Gravit reads an attached
   CSV from its saved copy.
4. **A skill by its literal `/name`.** The smoke confirms it; otherwise the Skills group is not
   drawn.
5. **A room bot and a conversation reference.** Refused this round (O9). A later round can have the
   room engine build the snapshot for the addressed bots.
6. **The room message's `{kind: 'user', mention}` source** stays a risk at the next dsh bump, and
   now carries references too.
7. **Masking a job's command line or Gravit's replies.** Not this round (§5.9).

## 10. Order of plans

Every plan leaves main working and ends with its drill.

1. **The host side** (nothing visible): the four packages and their overlay rows; the face's search
   index and its route; the file listing route; the smokes.
2. **The list:** search and pin.
3. **The composer:** the editor and its drafts, the `/` menu, `@` references.
4. **Attachments**, with PDFs: the `GRAVIT.md` line, the `pdf-page-reader` role and its mirror, and
   `poppler-utils` in the agent box.
5. **The thread:** masking, the rail and stats with earlier history, background jobs.
6. **Words into the table** (English only, so nothing visible changes), fonts and sizes, the keys
   and the shortcut sheet.
7. **中文:** `zh.js` and the switch on every screen at once (D35), then the operator's correction
   pass (D30).

Plans 6 and 7 meet the Account split's client work by D37: whichever lands second adapts.

## 11. The charter, and what stays imperfect

- **P1 holds.** No route writes the profile patch. The search route reads logs, and the listing
  route reads names.
- **The write map gains no writer of the tree.** The face writes its search index in its own
  directory under the harness home; the host writes the attachment copies there, as its own
  storage; Gravit's rendered pages go to `$TMPDIR`. The page writes pins through the host and
  preferences in the browser. `GRAVIT.md` and the new role are files the operator owns, changed by
  the plan they approve.
- **Gate 2 and the owner device are untouched.** Nothing here writes at the Account.
- **Residuals:**
  - Masking is display only (A2): the key stays in the log and in the model's context.
  - Gravit's replies are not masked, so a key Gravit repeats shows in its bubble.
  - Jobs vanish when the face restarts.
  - A referenced conversation can cost tens of kilobytes of context for each reference.
  - The search index is one more copy of the conversations' text in the harness home.
  - `/plan`, `/permission` and `/feedback` still work when typed by hand.
  - The language, the sizes and the fonts are per browser: another browser keeps its own, and the
    phone's messages are untouched.

## 12. The operator's questions and answers (2026-11-03)

The builder check left three questions that only the operator can answer, and each answer changes
what gets built. My recommendation came first in each; the operator's answer follows it.

**Q1. Search and Chinese.** dsh's index cannot find a Chinese word inside a sentence, a compacted
conversation's older messages, or a Lunhui composed answer (§5.1).
- **A (recommended): the face keeps its own search index.**
  - It indexes every message the thread draws, compacted ones and composed answers included.
  - It uses SQLite's `trigram` tokenizer plus a `LIKE` pass for one- and two-character words, so it
    finds any word in any language.
  - dsh's `session-query-sqlite` stays closed: D5's policy entry and `/data/host.json`'s field go,
    and a face route serves the search.
  - Plan 1 grows by the index and its route. The index reads the session logs as the room engine
    does, and lives in the face's directory under the harness home.
- **B: dsh's index as it is.** It finds titles in any language, English words and numbers, and
  Chinese only as whole phrases between punctuation. The first success line and the "Searching
  every conversation…" line change to say what it finds.

**Answer: A**, the face's own index (O7, §5.1).

**Q2. PDFs.** Gravit cannot read a PDF: `read` reads UTF-8 text only, and no PDF tool ships (§5.6).
- **A (recommended): the face extracts the text.** When a PDF is attached, the face extracts its text
  layer and sends it with the PDF as a text file Gravit can read. It needs one new dependency
  (pdf.js, Apache-2.0) and no Gravit tool, so N8 holds. Whether the page or the face's server runs
  it is the builder's choice. A scanned PDF with no text layer stays unreadable, and its card says
  so.
- **B: accept PDFs as they are.** The card says that Gravit cannot read it yet.
- **C: refuse PDFs** at the paperclip, with a line.

**Answer:** the operator asked back whether a good PDF tool exists ("有没有什么好用的读pdf的工具").
Three were put to them:
- macOS PDFKit with Vision: exact on a generated Chinese sample;
- pdf.js: not measured;
- Poppler: installed; it misplaced one character on the sample.

They proposed their own way: "先用 poppler 提文字，需要看版式的时候再把页面渲染成图片看" (extract the text with
Poppler first; when the layout needs looking at, render the page to an image). Gravit's model takes
no images, so the rendered page goes to a role on deepseek-flash, and the operator agreed to that
(O8, §5.6). The role is one `role_*` tool in Gravit's preset, as every role is.

**Q3. A conversation chip in a message to a room's bots.** dsh expands a conversation reference for
Gravit only (§5.5).
- **A (recommended): refuse it this round.** A draft that holds both a conversation chip and a bot
  chip is refused before sending, as files are (D20). Gravit can still brief a bot from a
  conversation, and plan 3 stays a client change.
- **B: the room engine expands it.** The face builds the same snapshot for each addressed bot in
  `face/src/room.ts`. That is host work in plan 1, and every round a bot is named, it costs that
  bot the snapshot's tokens.

**Answer: A**, refused this round (O9, §5.5).

## 13. Build notes, plan 1 (2026-11-03)

Plan 1 (the host side) built on `claude/cranky-bun-9f78c8` over `2321a8b0`: `5b1b380b` (the four
overlay rows: `job-controller`, `session-stats`, `session-turn-outline`, `session-reference`),
`4c8d8886` (`search-index.ts`), `0cab6723` and `512140e8` (`search-text.ts`, and the fix that a
stored `user/message`'s data is the message itself), `458e9162` (`search.ts`, `GET /data/search`,
the index at `$DSH_HOME/face/search-index.sqlite`), `bfc8848d` (`files.ts`, `GET /data/files`),
`ca3287fa` (`tests/dsh-ui-port-smoke.test.ts`, eight tests on one stub boot), and this note's
commit (DEVELOPMENT.md, face/README.md, CLAUDE.md). Measured at `512140e8`: the face suite 3,031
tests, 2,990 pass, 41 skipped, 0 fail; under `FACE_SMOKE=1` 3,032 tests, 3,028 pass, 4 skipped,
0 fail; the smoke file 8/8; typecheck clean.

| Clause | The text | What the tree does | Why |
|---|---|---|---|
| §5.8, §6 | `job/list` called with a `sessionId` | it takes `{request: {sessionId}}` | the Remote's wire arguments, found on the real boot |
| §6 | a stored `user/message` read like the other messages | its `data` is the message itself; `assistant/message` and `tool/result` wrap it as `data.message` | the first reading indexed Gravit's answers and none of the operator's words; the real boot showed it, and the fixtures were corrected with the code |
| §5.1 | a snippet of 240 characters | the two ellipses count inside the 240; when the case fold finds no match the snippet is the first 240 code points with `match` `[0, 0]` | one bound the page can rely on, and a fold mismatch never drops a hit |
| §5.1 | `limit` | clamped to 1..20 | the route's cap is the index's |
| §5.1 | the reply's `indexed` | `indexed.sessions` is the kept conversations less the skipped, `skipped` the logs that would not read | the plan did not say whether an unchanged conversation counted |
| §5.1 | a shrunk log is reset and read again | the reset runs after the re-read succeeds | a failing re-read keeps the old lines and mark |
| §5.1 | reconciles that overlap | each waits for the one before and runs once itself; they queue, they do not merge | two searches never append the same events twice |
| §5.1 | a log rewritten | one rewritten to the same length, or from a backend that gives no `eventCount`, is not seen as changed; dsh compares revisions only inside one service instance and the index outlives restarts | recorded, not fixed; the index lags until the length changes (DEVELOPMENT.md §4.4) |
| §5.1 | what is indexed | a `lunhui_present` call with no result in the batch is still indexed; a room's round-end lines and a subagent's report relays are not | the controller's ruling: the first is the composed answer, the others are not words anyone said |
| §5.5 | the file listing | an unreadable folder is listed but not descended; an unreadable root is an empty walk; matching is case-insensitive | one bad folder never fails the picker |
| §6 | `tests/overlay.test.ts` untouched | edited: it pins the row list, now seventeen | outside Task 1's brief, forced by the four rows |
