# dsh UI port, plan 6: words into the table, fonts and sizes, the keys and the shortcut sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every word the face itself writes on the page is read from one English table, with not one
byte of any screen changed by the move; Settings gains a text size, a code size and the two font
families, applied before the first paint; ⌥⌘N, ⌥⌘, and ⌘/ join ⌥⌘K, and ⌘/ opens a sheet that lists
the keys; plan 5's owed screen-reader carries are paid.

**Architecture:** Client only; the host does not change. A pure words module (`js/i18n/words.js`)
reads `js/i18n/en.js`, a flat table of literal keys; renderers call it where the literal stood, in
the escaping the literal had (`t` inside `esc`/`attrs`, `th` for raw template text, which inserts
the value verbatim). Two test harnesses hold the move to zero visible change: a golden of every
screen state `css.test.js` already renders (a SHA-256 per state, pinned before the first move), and
a source scanner that finds English literals outside the table, ratcheted file by file until no
file is pending; a probe render closes it. Sizes are two root variables (`--fs`, `--fm`) every
`font-size` in `app.css` multiplies; the fonts and sizes live in `gravit-ui.prefs` beside the theme
and are applied by `index.html`'s inline script and by a pure `js/prefs.js`. The keys are one table
(`js/keys.js`) that both the `keydown` handler and the sheet read.

**Tech Stack:** Vanilla ES modules in `face/client/js`, `face/client/css`, `face/client/index.html`;
the fake-DOM client suite (`face/tests/client/`, `node --test` via tsx); `typescript` (already a
devDependency, `face/package.json`) as the scanner's parser, in tests only; `node:crypto` for the
golden.

**Spec:** `docs/superpowers/specs/2026-11-03-dsh-ui-port-design.md` §3.3, §5.10 (the mechanism
paragraphs that plan 6 owns: the table, `t`, the plurals, `time.js`, the theme trap, the fonts, the
wire-words rule re-taken), §5.11, §5.12, §7's language, fonts and keys lines, §10 item 6, §11
(the per-browser residual), D27–D29, D31–D37, P6, P7, and the carries §17 owes to plan 6. Plans 1–5's
build notes are its §13–§17; this plan's are its §18 (Task 16).

**Precondition — D37 (Task 0, the operator's).** Local `main` (`df1e3230` at this writing) carries
the Account split's client work, which this branch does not: Part A's two upstreams
(`host/explore-join.js`, `host/explore-halves.js`, `wire/market-stream.js`, changes to
`host/markets.js`, `render/markets.js`, `host/trade.js`, `render/account.js`) and B1's Identity tab
(`render/identity.js`, `host/identity-view.js`, `host/identity.js`, `host/sheet-identity.js`,
`reducers/identity.js`; Connect Telegram's drawer in `app.js`'s Escape chain after the owner
sheet). Main's `app.js` does not carry plans 2–5. By D37 the arc that lands second adapts, and plan
6 lands second. This plan is written against the branch with local `main` merged in: the corpus
(Task 1) is `css.test.js` as merged, so it holds `identityStates` and `renderConnectDrawer`, and
the Identity files are moved in Tasks 6 and 7 like any other. A word move made before that merge
would rewrite the same lines main changed in `render/account.js`, `render/markets.js`,
`host/markets.js` and `host/trade.js`. If the operator merges after instead, Tasks 1–16 run as
written over the files present and, after the merge, the guard (Task 2) fails on every Identity and
two-upstream file not yet moved; those files then go through Tasks 6–8's steps, the golden is pinned
again at the merge, and §18 records it. The merge also has to renumber `DEVELOPMENT.md`'s
residuals: this branch's R96 (attachments) and R97 (the thread) collide with main's R96 (the
retired bridge's files) and R97 (two notices for one seat write), and main adds R98.

**Where the code differs from the spec, this plan follows the code:**
- **`t(key, params)` is four functions.** Renderers write the face's words both as raw template text
  (`<div class="dsec-label">Theme</div>`) and inside `esc()`/`attrs()` (`'aria-label': 'Close'`);
  host strings are escaped where they are interpolated. A byte-identical move needs `t` (plain
  text, for the second kind and for state-held lines) and `th` (HTML text: the table's value
  verbatim, its params escaped). Plurals are `tn` and `thn`. A param that is markup is wrapped in
  `rawHtml()`.
- **Top-level word tables become functions.** `TABS`, `RANGES`, `MONTHS`, `SEARCH_LINE`, `DAYS`
  and their kind are module constants evaluated at import; a word read there would never follow a
  table change (plan 7). They become functions of no argument returning the same arrays, and the
  scanner refuses a words call outside a function body.
- **The escape chain already has its D34 head.** §3.3 lists today's chain; plans 2–4 put an open
  menu, the lightbox and the search box before it (`app.js`'s `keydown`), and main adds Connect
  Telegram's drawer after the owner sheet. The shortcut sheet takes D34's one free slot, after the
  lightbox and before the search box.
- **⌥⌘K is built** (plan 2, matched on `ev.code`, `isMac`); this plan moves its match into the key
  table and adds three keys beside it.
- **The sizes are not all px.** `app.css` has 202 `font-size` declarations and eight `font:`
  shorthands that set a size; one `font-size` is `0.875em` (`.secret`, plan 5), two shorthands are 12.5 px and 10.5 px. Avatars
  write their letter size inline (`render/avatars.js`, `font-size: size × k px`): a letter is part
  of the avatar's box, which D32 keeps unscaled.
- **Only one `seg` uses labels as values.** Theme (`renderSettings`); every other `seg` passes pairs
  already (`render/owner.js`'s fields, `breadth.js`, `yesterday.js`, the history ranges, `mkSort`).
  `CANDLE_RANGES` passes `[r, r]`: `1D`, `1W` are symbols and stay.
- **Chrome's `focusout` on a removed tick is built** (`app.js`, the `isConnected !== false` guard,
  pinned by `app-dom.test.js`'s focusout case, `62397ea2`). Arrow keys on the rail (Task 11) redraw
  the rail under a focused tick, so the case is pinned again there.
- **§3.3's counts moved.** The client suite is 81 files on the branch (more after the merge); the
  954 and 245 assertions keep testing English unchanged and are not recounted.

**Where the spec leaves it to this plan:**
- **The key grammar.** `<area>.<part>.<name>`, lower camel segments, the name from the English
  (`details.usage.tokensIn`). Areas: `common` (Save, Cancel, Close, No, Copy, Retry — a control
  word with one meaning everywhere), `time`, `status`, `nav`, `list`, `search`, `thread`, `composer`,
  `details`, `jobs`, `settings`, `shortcuts`, `owner`, `sheet`, `account`, `money`, `venues`,
  `agents`, `cards`, `rules`, `identity`, `markets`, `trade`, `desk`, `discover`, `channel`,
  `modules`, `runSheet`, `lunhui`. The same English under two meanings takes two keys.
- **State-held lines.** A status line, a sheet's `said`, a field's `error` are written into the
  store as text by host code; they move to `t()` where they are produced. Under plan 7 a line
  written before a language switch keeps its language until the next line (§18 records it).
- **The Settings order.** Theme, Text size, More font settings (folded: Text font, Code font, Code
  size), Keyboard shortcuts, then Devices; plan 7 puts Language first.
- **⌘/ toggles** the sheet. The three new General keys do nothing while the lightbox or an owner
  sheet stands (a signing flow is never navigated away by a key); ⌥⌘K keeps its plan 2 behaviour.
- **The fonts.** D29's Noto Sans SC 800 and §5.10's CJK fallback for `--font-mono` land here, with
  the font settings.

## Global Constraints

- **Zero visible change for the words (D35).** With the English table, every state of the corpus
  renders the same bytes before and after Tasks 3–9 (Task 1's golden); the 954 `assert.match` and
  245 `assert.doesNotMatch` over English HTML pass untouched. Tasks 10, 11, 13 and 15 change markup
  on purpose and re-pin the golden for the states they name, no others.
- **The table:** `face/client/js/i18n/en.js`, `export const EN = Object.freeze({...})`; a value is a
  non-empty string or `{one, other}`; no value holds `<`, `>`, `"` or an `&` followed by `[#A-Za-z]`;
  params are `{name}` (`{n}` in a plural); keys are literal at every call site; no words call at
  module top level; every key used exists and every key exists because it is used.
- **Escaping:** a literal moves into the escaping it had. One inside `esc(…)` or an `attrs` value
  becomes `t(…)` there; raw template text becomes `${th(…)}`; a sentence with interpolations becomes
  one key with params in source order, its markup params `rawHtml(…)`. Every host string still
  passes through `esc()`: `th` escapes every param it is not told is markup.
- **What stays as written (§5.10):** titles; the operator's, Gravit's and bots' words; Lunhui output
  and the modules' Chinese sub-titles; dsh's and the Account's texts (refusals, venue names, What you
  sign's lines); tickers, symbols, skill and tool names, a bot's name and soul; numbers in `en-US`
  (D28); the A-share units and the room's two notices in Chinese (D36); key names (`Enter`, `Esc`,
  `⌥⌘K`); colours (O5). `GRAVIT.md` is not touched (4,489/4,500 bytes).
- **Cost:** renders run 10–20 a second while a turn streams. `t` is a property read, plus one
  replace with a module-level regex only when the value holds `{`; `th` of a value with no params is
  the value itself; memoized renderers (`railHtml`) add `wordsEpoch()` to their keys.
- **Copy, verbatim (English), new in this plan:**
  - Settings: `Text size`; the steppers' keys `aria-label="Smaller text"` / `"Larger text"` and
    `"Smaller code"` / `"Larger code"`, their readout `15 px`; `More font settings`; `Text font`
    with `placeholder="Default: Manrope, Noto Sans SC"`; `Code font` with
    `placeholder="Default: IBM Plex Mono"`; `Code size`; `Keyboard shortcuts`, `Show all`, and the
    platform's chord for the sheet;
  - the sheet: title `Keyboard shortcuts`; the box `placeholder="Search shortcuts"`
    `aria-label="Search shortcuts"`; sections `General` and `Composer`; the rows of §5.12's table,
    their action words as written there; the line `⌘ is Ctrl off a Mac. Keys follow dsh's web
    bindings.`; no row matching `No shortcut matches`; Close `aria-label="Close"`;
  - a pill: `aria-label="<its text>, open Usage"`;
  - a finished job with no output: `.job-end` reads `(no output)` alone; its end line (`exit 0`,
    `signal TERM`, `killed`, `failed`) only in the meta line.
- **Ranges (D31):** text 12–20 px, default 15; code 10–16 px, default 12; a step of 1 px. A font
  family is at most 64 characters of letters, digits, spaces, `_`, `.` and `-`, else cleaned to that.
- **Keys (§5.12):** matched on `ev.code` and the modifier flags, never `ev.key`; ⌘ is `metaKey` on a
  Mac and `ctrlKey` elsewhere (`isMac`); no General key fires while an IME composes (`isComposing` or
  keyCode 229); the four General keys work from any focus, the editor and every input included;
  dsh's ⌥⌘G, ⇧⌘F, ⌥⌘A and Esc twice stay unbound (D33). The sheet lists only rows marked `bound`.
- **The Escape order (D34):** an open `/` or `@` menu; the lightbox; the shortcut sheet; the search
  box while it has focus; then the chain as built (an inline edit, a confirm, the Run sheet, the owner
  sheet, Connect Telegram's drawer, Sell many, the stock drawer, Details, Settings, the statement, a
  venue's details, Trade's ticket).
- **The client rules:** one store, pure reducers, string renderers, one `innerHTML` per render,
  `data-action` delegation; `app.css` names no hex and `css.test.js` holds every class both ways;
  preferences live in `gravit-ui.prefs` only, every read and write in `try`.
- Never the live `~/.dsh`, never port 3090, never `npm run service`, no `FACE_SMOKE` run. Commit
  messages go in a file and are committed with `git commit -F <file>`. No push, stash, reset or
  branch switch.

## Review Focus

1. **A literal that was raw template text with an apostrophe or an ampersand.** `Can't run ·
   ${esc(b.broken)}` must still emit `Can't`, not `Can&#39;t`, and the reason still escaped: the move
   is `th`, never `esc(t(…))`. Pinned by the golden (Task 1) and `words.test.js` (Task 3).
2. **A word read at import.** A module-level `TABS` built with `t()` would freeze English for good
   once plan 7 switches tables. Pinned by the scanner's top-level rule (Task 2) and a test that
   renders under a probe table after import (Task 10).
3. **A typed font family carrying CSS.** `Inter"; } body { display:none` in Text font must land as a
   cleaned family name in one custom property, in the inline script and in `js/prefs.js` alike.
   Pinned in Task 13.
4. **A General key over a signing sheet or inside an IME.** ⌥⌘, or ⌥⌘N pressed while What you sign
   stands, or while pinyin composes in the editor, does nothing. Pinned in Task 14.
5. **The shortcut sheet over Settings.** Show all opens it over the drawer; Esc closes the sheet
   first, focus goes back to Show all, a second Esc closes Settings; Tab stays inside the sheet.
   Pinned in Task 15.

---

### Task 0: The merge (the operator's, before Task 1)

Local `main` is merged into `claude/cranky-bun-9f78c8` by the operator (the merge is the operator's
call, with the residual numbers settled), and `npm test && npm run typecheck` pass in `face/` at the
merge. The controller records the merge's SHA in §18. If the operator chooses to merge after plan 6,
skip this task and follow the precondition's fallback.

### Task 1: The zero-change harness — the corpus and its golden

**Files:**
- Create: `face/tests/client/helpers/screens.js`, `face/tests/client/words-golden.test.js`,
  `face/tests/client/golden-write.js` (not a `*.test.js`: a script),
  `face/tests/client/fixtures/screens-en.json`
- Modify: `face/tests/client/css.test.js` (imports the corpus instead of defining it)

**Interfaces:**
- Produces:

```js
// helpers/screens.js — every state css.test.js draws, named; unchanged builders moved from css.test.js
export const NOW;                       // the corpus' clock, as css.test.js's
export function everyState() {}         // → state[] (moved as is: the market, account, identity, sell-many, owner, trade,
                                        //   channel, discover, module, run-sheet and search builders with it)
export function screenOf(state, now) {} // moved as is
export function pageHtml(state, { mac = true } = {}) {} // renderRail + screenOf + Settings + stock drawer + Sell many + the
                                        //   owner sheet + Connect Telegram's drawer + the Run sheet, as css.test.js concatenates
export function composerPieces() {}    // → [name, html][]: 'menu-0'…'menu-3', 'mention', 'attached', 'history', 'secrets',
                                        //   'paging', 'rail', 'jobs', 'editor' — composerHtml's parts, each its own entry
export function corpus() {}             // → [name, html][]: 'state-<i>' for everyState()[i], 'state-<i>-pc' for the same
                                        //   state with { mac: false } when it draws a list, then 'composer-<name>' for each piece
```

- `golden-write.js`: `npx tsx tests/client/golden-write.js --pin` writes
  `fixtures/screens-en.json` as `{ "<name>": "<sha256 hex of the html>" }`, keys in corpus order;
  `--dump <dir>` writes `<dir>/<name>.html` for each entry. Both set `process.env.TZ =
  'America/New_York'` before importing the corpus (dynamic `import()`), so a clock in any state
  prints the same on any machine.

- [ ] **Step 1: Write the failing test** `words-golden.test.js` (TZ set first, the corpus imported
  dynamically):
  - `every screen state renders the bytes pinned in fixtures/screens-en.json`: the names equal the
    fixture's keys, in order, and each hash equals the fixture's; a failure names every state that
    differs and says `npx tsx tests/client/golden-write.js --dump <dir>` before and after to diff;
  - `the corpus covers the screens`: it holds a Messages state, a Settings state, a Markets, an
    Account, a Trade, a channel, a Discover, a module, a
    Run sheet, an owner sheet, Sell many, the stock drawer and Connect Telegram's drawer — each found
    by a class the screen emits (`mkts`, `acct`, `trade`, `research`, …).
- [ ] **Step 2: Run it to see it fail.** Run `npx tsx --test tests/client/words-golden.test.js` in
  `face/`. Expected: FAIL, `helpers/screens.js` is missing.
- [ ] **Step 3: Move the corpus.** Cut `everyState`, its builders, `composerHtml` (split into
  `composerPieces`) and `screenOf` from `css.test.js` into `helpers/screens.js` without changing a
  state; `css.test.js` imports them and joins `corpus()`'s html where it joined `everyState()`'s and
  `composerHtml()`'s. Write `golden-write.js`.
- [ ] **Step 4: Pin.** Run `npx tsx tests/client/golden-write.js --pin` once, then
  `npx tsx --test tests/client/words-golden.test.js tests/client/css.test.js`. Expected: PASS; run
  the golden test twice more: the hashes are stable.
- [ ] **Step 5: Run the suite** `npm test && npm run typecheck`. Expected: 0 fail.
- [ ] **Step 6: Commit** (`test(face): the zero-change harness - every screen state css.test.js
  draws, named, and its golden (plan 6 task 1)`).

### Task 2: The guard — English literals outside the table, ratcheted

**Files:**
- Create: `face/tests/client/helpers/words-scan.js`, `face/tests/client/words-guard.test.js`
- Modify: `face/tests/client/wire-words.test.js` (its head comment: the reason is now that the face's
  words live in the tables, §5.10); Create: `face/tests/client/client-chinese.test.js`

**Interfaces:**
- Produces:

```js
// helpers/words-scan.js — parses a client source with typescript's createSourceFile (ScriptKind.JS)
export const WORDS_CALLS = ['t', 'th', 'tn', 'thn'];
export const KEY_NAMES;          // Set: Enter, Escape, Esc, Tab, Backspace, Delete, Home, End, Shift, Meta, Control, Alt, Space
export function englishLiterals(source, file) {} // → [{ line, text }]
export function wordsCalls(source, file) {}      // → [{ line, fn, key /* string | null when not literal */, topLevel: boolean }]
```

- **What `englishLiterals` reports.** Every `StringLiteral`, `NoSubstitutionTemplateLiteral` and
  template head, middle and tail, except: a module specifier; the first argument of a words call; a
  property name (`'aria-label':`); a literal on a line carrying `// en-kept: <reason>`, or on the line
  after one that stands alone. The text is the literal's, with every HTML tag removed and the values
  of `aria-label`, `title`, `placeholder` and `alt` written literally in a tag kept. It is reported
  when it holds two letter words separated by whitespace (`/\b[A-Za-z][a-z]+\s+[A-Za-z][a-z]*\b/`),
  or is one capitalized word with optional end punctuation (`/^[A-Z][a-z]+[.…!?:]*$/`) not in
  `KEY_NAMES`.
- **The ratchet** (`words-guard.test.js`): `KEPT_FILES` maps a file to its reason (`wire/api.js`
  — transport errors read by code; `wire/markdown.js` — Gravit's words; `keys.js` from Task 14 —
  key names); `PENDING` is the sorted list of every other client file under `face/client/js` that
  reports a literal at the start of this task, written into the test by Step 3. Each later words
  task removes its files from `PENDING`; Task 10 deletes the list.

- [ ] **Step 1: Write the failing tests:**
  - in `words-guard.test.js`, the scanner on snippets:
    - `a capitalized word and a phrase are found; an identifier, a class list, a selector and a key name are not`
      (`'Close'`, `'Not signed in'` found; `'seg-item pressed'`, `'#say'`, `'Escape'`, `'BUTTON'`,
      `'content-type'` not);
    - `a template's text and its aria-label are found, its tags and attribute names are not`
      (`` `<div class="dsec-label">Theme</div>` `` reports `Theme`; `` `<b aria-label="Copy">` ``
      reports `Copy`);
    - `a words call's key, an import and a property name are not reported`;
    - `en-kept on the line or the line before exempts it`;
    - `wordsCalls finds a literal key, a computed key and a call at module top level`;
  - the tree:
    - `no client file outside PENDING and KEPT_FILES has an English literal`;
    - `every PENDING file still has one` (a moved file must leave the list);
    - `no words call has a computed key or runs at module top level`;
  - in `client-chinese.test.js`:
    - `no client source holds Chinese but the content files §3.3 names` — the CJK range
      `/[㐀-鿿]/` found only in `host/modules-view.js`, `host/runs-view.js`,
      `host/run-sheet-view.js`, `wire/room.js`, `wire/market-model.js`, `render/discover.js`,
      `render/markets.js`, `render/lunhui/{block,sources,stock}.js` and any Chinese the merge brings
      (listed by name with its reason), and later `i18n/zh.js` (plan 7).
- [ ] **Step 2: Run them to see them fail.** Run
  `npx tsx --test tests/client/words-guard.test.js tests/client/client-chinese.test.js` in `face/`.
  Expected: FAIL, the scanner is missing.
- [ ] **Step 3: Implement `words-scan.js`;** run the scanner over `face/client/js` once and write
  `PENDING` from what it reports. Mark the deliberate literals the scan finds in files that are not
  the face's words with `// en-kept:` and a reason (a provider's name such as `Alpaca`, a zone such as
  `America/New_York` when it is one capitalized word, an error code). Every marker is reviewed.
- [ ] **Step 4: Run them to see them pass,** then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** (`test(face): the words guard - English literals outside the table, a
  pending list to empty (plan 6 task 2)`).

### Task 3: The words module, and the first words moved

**Files:**
- Create: `face/client/js/i18n/words.js`, `face/client/js/i18n/en.js`,
  `face/tests/client/words.test.js`, `face/tests/client/words-table.test.js`
- Modify: `face/client/js/time.js`, `face/client/js/render/controls.js`,
  `face/client/js/html.js` (only if the scan reports it), `face/tests/client/words-guard.test.js`
  (`PENDING` loses these files)

**Interfaces:**
- Produces:

```js
// i18n/words.js
export function t(key, params) {}         // plain text: the active table's value, else EN's, else the key; {name} → String(params.name)
export function th(key, params) {}        // HTML text: the value verbatim; each param esc()'d unless rawHtml()
export function tn(key, n, params) {}     // plural plain text: value.one when n === 1, else value.other; {n} = String(n) unless params.n
export function thn(key, n, params) {}    // plural HTML text, th's escaping
export function rawHtml(markup) {}        // → a frozen { html } that th/thn insert verbatim
export function withTable(table, fn) {}   // tests and plan 7: fn() under table (missing keys fall back to EN), then back; → fn()'s result
export function wordsEpoch() {}           // a number that changes whenever the active table does
```

- `time.js`'s words: `time.today` `Today`, `time.yesterday` `Yesterday`, `time.justNow`
  `Just now`, the months `time.month.jan` … `time.month.dec` (`MONTHS` becomes a function),
  `time.ago.minutes` `{one: '{n} minute ago', other: '{n} minutes ago'}`, `time.ago.hours`,
  `time.ago.days` alike. `controls.js`: `common.save` `Save`, `common.cancel` `Cancel`, `common.no`
  `No`.

- [ ] **Step 1: Write the failing tests:**
  - in `words.test.js`:
    - `t reads the value and fills its params raw`; `a missing key reads as the key`;
      `a missing param leaves its {name}`;
    - `th inserts the value verbatim and escapes each param` (`Can't run · {why}` with `why: '<b>'`
      → `Can't run · &lt;b&gt;`);
    - `rawHtml passes markup through th`;
    - `tn and thn pick one for 1 and other otherwise, {n} the count unless given`;
    - `withTable reads another table, falls back to EN for a missing key, restores EN after, and moves wordsEpoch`;
  - in `words-table.test.js`:
    - `every key follows the grammar and every value is a string or {one, other}`;
    - `no value holds <, > or ", nor an entity`;
    - `a plural's two forms carry the same named params, and other holds {n}` (one may spell its count: `1 job running`);
    - `every key a client file uses exists in EN, and every EN key is used by some file` (through
      `wordsCalls`);
  - in `time.test.js` (unchanged assertions): they keep passing.
- [ ] **Step 2: Run them to see them fail.** Run
  `npx tsx --test tests/client/words.test.js tests/client/words-table.test.js` in `face/`.
  Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement `words.js` and `en.js`;** move `time.js` and `controls.js` (and `html.js`
  if listed); take them out of `PENDING`.
- [ ] **Step 4: Run** `npx tsx --test tests/client/words*.test.js tests/client/time.test.js
  tests/client/controls.test.js`, then `npm test && npm run typecheck`. Expected: PASS; the golden
  unchanged.
- [ ] **Step 5: Commit** (`feat(client): the words table - t, th, tn, en.js; time and the shared
  controls read it (plan 6 task 3)`).

### Tasks 4–9: the words moved, area by area

Each of these six tasks has the same steps. Its **Files** are the client files named and
`face/client/js/i18n/en.js`, `face/tests/client/words-guard.test.js`; its test is the guard, the
golden and the suite. No test file but the guard's `PENDING` changes.

- [ ] **Step 1: Take the task's files out of `PENDING`** in `words-guard.test.js`.
- [ ] **Step 2: Run the guard and see it fail** —
  `npx tsx --test tests/client/words-guard.test.js` in `face/`: it lists every literal left in those
  files. Dump the golden before editing: `npx tsx tests/client/golden-write.js --dump <scratch>/before`.
- [ ] **Step 3: Move every listed literal** by the escaping rule (Global Constraints), adding its key
  to `en.js` under the task's areas; a literal that is not the face's word gets `// en-kept: <reason>`
  (the Account's, dsh's, a symbol). Module-level word tables become functions.
- [ ] **Step 4: Run** `npx tsx --test tests/client/words-guard.test.js
  tests/client/words-golden.test.js tests/client/words-table.test.js`, then `npm test && npm run
  typecheck` in `face/`. Expected: PASS. On a golden failure, dump `after` and diff against `before`;
  fix the move, never the fixture.
- [ ] **Step 5: Commit** (`refactor(client): <area>'s words into the table - nothing on screen
  changes (plan 6 task N)`).

### Task 4: The list and the rail

- Files: `render/rail.js` (the nav words, `groupHead`'s `Expand`/`Collapse {name}`, the search box,
  `SEARCH_LINE`, the empty and error lines), `render/avatars.js` (`You`), `host/list-view.js`,
  `host/search-view.js`, `host/search.js`, `host/sessions.js`, `wire/speaker.js` (`Role · {name}`),
  `wire/grouping.js` and `wire/channelName.js` if listed.
- Areas: `nav`, `list`, `search`. The ⌥⌘K and Ctrl+Alt+K hints stay (key names).

### Task 5: The thread, the composer, Details and the status lines

- Files: `render/messages.js` (the head, Details, `usageRows`, `statsPills`, the jobs' section and
  rows, `(no output)`, `Yes, stop`, `Stopping`, `Copy`), `render/thread.js` (`Turn {n}`, `Turn {n} ·
  jump`, the earlier key, the cards), `composer/view.js` (`FOOT`'s `Move`, `Choose`, `Close` — the
  `kbd` names stay), `composer/menus.js`, `composer/files.js` (the constraint lines), `host/turns-view.js`
  (the pill sentences as `tn`), `host/jobs-view.js` (the chip, the end lines), `host/children-view.js`,
  `host/kinds.js`, `host/traces.js`, `host/composer.js`, `host/actions.js` (`fail`'s verbs `command`,
  `stop`, `rename`, `fork`, `archive`, `un-archive` and the rest, `NOT_SIGNED_IN`), `host/attachments.js`,
  `host/live.js`, `reducers/*.js` (the lines they write), `data/empty.js` (`connecting…`), and the
  lines `app.js` writes (`Files uploaded again; the message was not sent`, `Answer every question
  first`, …). `railHtml`'s memo key gains `wordsEpoch()`.
- Areas: `thread`, `composer`, `details`, `jobs`, `status`.
- The lowercase single words the scanner cannot see are moved by reading: `fail`'s verbs, the end
  lines `exit`, `signal`, `killed`, `failed`, `thinking` (`aria-label`), `stale`, `failed` as a word.

### Task 6: The Account screen, Settings and Identity

- Files: `render/account.js` (the seven tabs as a function, `RANGES` as a function, Settings'
  `Theme`, `Cream`, `Black`, `System` — the Theme `seg` keeps its labels as values here; Task 10 pairs
  them), `render/wallet-row.js`, `host/account-view.js`, `host/money-view.js`, `host/rules-view.js`,
  `host/account.js`, `host/sell-many.js`, `host/wallet-send.js`, `wire/wallet.js`, and from the merge
  `render/identity.js` (`READ_ONLY` and its siblings as functions), `host/identity-view.js`,
  `host/identity.js`.
- Areas: `account`, `money`, `venues`, `agents`, `cards`, `rules`, `identity`, `settings`.
- The Account's own words stay: a refusal's sentence, a venue's name, the identity read's handles.

### Task 7: The owner device and its sheets

- Files: `host/sheet-view.js` (`DAYS` as a function with `tn`), `host/sheet-money.js`,
  `host/sheet-market.js`, `host/sheet-rules.js`, `host/sheet.js`, `host/owner-view.js`,
  `host/owner.js`, `render/owner.js`, `reducers/owner.js`, and from the merge `host/sheet-identity.js`.
- Areas: `owner`, `sheet`.
- What you sign's lines are the Account's `quoteDialog` and stay; a field's label, its options'
  labels and a sheet's title and go word are the face's and move (the options' values do not).

### Task 8: Markets, Trade and the desk

- Files: `render/markets.js`, `render/chart.js`, `host/market-view.js`, `host/market-depth-view.js`,
  `host/markets.js`, `render/trade.js`, `host/trade-view.js`, `host/trade.js`, `render/desk.js`,
  `host/desk-view.js`, `host/desk.js`, and from the merge `host/explore-join.js` and
  `host/explore-halves.js` if listed.
- Areas: `markets`, `trade`, `desk`.
- The A-share units (万, 亿, 万股, 亿股) stay in Chinese (D36); `CANDLE_RANGES` stays.

### Task 9: Discover, channels, modules, the Run sheet and Lunhui

- Files: `render/discover.js`, `host/discover-view.js`, `host/discover.js`, `render/channel.js`,
  `host/channels.js`, `render/modules.js`, `host/modules-view.js`, `host/modules.js`,
  `render/run-sheet.js`, `host/run-sheet-view.js`, `host/run-sheet.js`, `host/runs-view.js`,
  `host/lunhui.js`, `render/lunhui/*.js`.
- Areas: `discover`, `channel`, `modules`, `runSheet`, `lunhui`.
- The modules' Chinese sub-titles, the messages sent to Gravit and the room's two notices stay
  (D36, §3.3); the face's English around a run moves.

### Task 10: The table closed — the probe, the pending list gone, the Theme pairs

**Files:**
- Create: `face/tests/client/words-probe.test.js`
- Modify: `face/tests/client/words-guard.test.js` (`PENDING` deleted), `face/client/js/render/account.js`
  (`renderSettings`), `face/client/js/app.js` (`setTheme`), `face/tests/client/fixtures/screens-en.json`,
  `face/tests/client/account.test.js` or the test that holds Settings

**Interfaces:**
- Consumes: `withTable`, `corpus()`.
- Produces: the Theme `seg` as `[[t('settings.theme.cream'), 'cream'], [t('settings.theme.black'),
  'black'], [t('settings.theme.system'), 'system']]` pressed on `state.theme`; `setTheme` reads
  `el.dataset.value` as it is, no `toLowerCase`.

- [ ] **Step 1: Write the failing tests:**
  - in `words-probe.test.js`:
    - `no English is drawn outside the table`: under a probe table (every EN value wrapped `⟦…⟧`,
      both plural forms), render `corpus()`; take every text node and every `aria-label`, `title`,
      `placeholder` and `alt` value, decode the five entities, cut every `⟦…⟧` run; every letter word
      (`/[A-Za-z]{2,}/`) left must occur in a string of the corpus' own states and fixtures (a deep
      walk of `everyState()` and the pieces' inputs, exported by `helpers/screens.js` as
      `corpusStrings()`), else it is reported; the report is empty;
    - `a word table read after import follows the table` (Review Focus 2): the Account tabs, the
      history ranges and the months render probed;
  - in `words-guard.test.js`: `PENDING` is gone, and the tree test covers every file;
  - Settings: `no seg draws a label of the table as its value` (over `corpus()`, every `.seg-item`
    whose text is an EN value has a `data-value` that is not that text); `Theme's keys carry cream,
    black and system, and pressing Black stores black`.
- [ ] **Step 2: Run them to see them fail.** Run `npx tsx --test tests/client/words-probe.test.js
  tests/client/words-guard.test.js` and the Settings test. Expected: FAIL on Theme, and on any word
  the six tasks missed.
- [ ] **Step 3: Pair Theme's labels** and move whatever the probe reports (each a word the six tasks
  missed, or content `corpusStrings` does not see: then the walk is widened, never an allowlist of
  words).
- [ ] **Step 4: Re-pin the golden.** Dump before and after; the only states that differ are those
  drawing Settings (`data-value="Cream"` → `"cream"`), and nothing else in them. Run
  `golden-write.js --pin`, then `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** (`feat(client): the words table closed - a probe finds no English outside
  it, Theme's values are keys (plan 6 task 10)`).

### Task 11: The screen-reader carries from plan 5

**Files:**
- Modify: `face/client/js/render/messages.js` (`statsPills`, `jobDetails`),
  `face/client/js/render/thread.js` (`railHtml`), `face/client/js/app.js` (`keydown`: the rail's
  arrows; `drawRail`'s focus), `face/client/js/i18n/en.js`, `face/tests/client/fixtures/screens-en.json`
- Test: `face/tests/client/thread.test.js`, `face/tests/client/messages-screen.test.js` or
  `jobs-view.test.js`, `face/tests/client/app-dom.test.js`

**Interfaces:**
- Produces:
  - a pill: `aria-label` `t('thread.pill.open', {text})` → `<text>, open Usage`; its id and action
    unchanged;
  - the rail: `#turn-rail` gains `role="toolbar"` and `aria-orientation="vertical"`
    (`aria-label="Turns"` kept); one tick is `tabindex="0"` — the focused tick's, else the active
    turn's, else the last — every other `tabindex="-1"`; the tick whose card is drawn has
    `aria-describedby="turn-card-<turn>"` and the card `id="turn-card-<turn>"`; the pulse tick
    `aria-busy="true"`;
  - `railHtml(conv, { active, hover, pulse, focus })` — `focus` the tick that has focus, part of the
    memo key;
  - `app.js`: on a `.turn-tick`, ↑ and ↓ move focus to the previous and next tick, Home and End to the
    first and last, each showing its card as a focus does today (`hoverRail`), the rail redrawn
    alone; Enter and Space press the tick as a click does;
  - a finished job: the meta line keeps its end line; `.job-end` is drawn only for `(no output)`.

- [ ] **Step 1: Write the failing tests:**
  - `thread.test.js`: `one tick is in the Tab order: the active turn's, else the last`;
    `the hovered tick is described by its card`; `the pulse tick is busy`;
  - `messages-screen.test.js`: `a pill names its action` (`aria-label="7 turns · 41 steps, open
    Usage"`); `a finished job's end line is drawn once` (`exit 0` once in its `details`; `(no output)`
    in `.job-end` for an empty one);
  - `app-dom.test.js`: `↓ on a tick focuses the next one and shows its card; Home and End go to the
    ends`; `an arrow's redraw removes the focused tick and its focusout hides no card` (the removed
    node fires `focusout` with `isConnected: false`, as Chrome does); `the arrows do nothing outside
    the rail` (↓ in the editor with no menu moves nothing).
- [ ] **Step 2: Run them to see them fail.** Run `npx tsx --test tests/client/thread.test.js
  tests/client/messages-screen.test.js tests/client/app-dom.test.js` in `face/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-pin the golden** for the states that draw pills, ticks or finished jobs only
  (`composer-rail`, `composer-jobs`, the state with `s1`'s stats); dump and diff to show it. Then
  `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** (`fix(client): plan 5's screen-reader carries - the pills name their
  action, the rail one Tab stop with arrows, the card describes its tick, the pulse busy, a job's end
  once (plan 6 task 11)`).

### Task 12: The two size scales and the fonts in CSS

**Files:**
- Modify: `face/client/css/tokens.css`, `face/client/css/app.css`, `face/client/index.html` (the
  font link), `face/tests/client/css.test.js`

**Interfaces:**
- Produces:
  - `tokens.css` `:root`: `--fs: 1; --fm: 1;` `--font-sans-base` (today's `--font-sans` stack),
    `--font-mono-base: "IBM Plex Mono", "SF Mono", Menlo, Consolas, "Noto Sans SC", "PingFang SC",
    "Hiragino Sans GB", monospace`, `--font-sans: var(--font-sans-base)`, `--font-mono:
    var(--font-mono-base)`;
  - `app.css`: every `font-size: <n>px` is `font-size: calc(<n>px * var(--fs))`, and every `font:`
    shorthand's size `calc(<n>px * var(--fs))`; in a rule whose block names `var(--font-mono)` (and
    `.mono`) the factor is `var(--fm)`; `em`, `%` and `inherit` stay; `html, body`'s base is
    `calc(15px * var(--fs))/1.45`;
  - the Google Fonts link: `Noto+Sans+SC:wght@400;500;700;800` (D29).

- [ ] **Step 1: Write the failing tests** in `css.test.js`:
  - `no fixed font size is left outside the two scales`: every `font-size` value and every `font:`
    shorthand's size is `calc(<n>px * var(--fs))`, `calc(<n>px * var(--fm))`, or relative;
  - `a mono rule scales with the code size and every other rule with the text size`;
  - `the base is 15 px times the text scale`; `--fs and --fm are 1 at the root`;
  - `the mono stack falls back to Chinese after its mono faces`; `the font link loads Noto Sans SC
    800` (read from `index.html`).
- [ ] **Step 2: Run them to see them fail.** Run `npx tsx --test tests/client/css.test.js` in
  `face/`. Expected: FAIL.
- [ ] **Step 3: Rewrite the sizes** (mechanically: each value multiplied, none changed).
- [ ] **Step 4: Run** `npm test`. Expected: PASS, the golden unchanged (no markup moved).
- [ ] **Step 5: Commit** (`feat(client): the text and code scales - every size times --fs or --fm;
  the mono stack's Chinese fallback and Noto Sans SC 800 (plan 6 task 12)`).

### Task 13: Text size, code size and fonts in Settings, before the first paint

**Files:**
- Create: `face/client/js/prefs.js`, `face/tests/client/prefs.test.js`
- Modify: `face/client/js/app.js` (`prefsOf`, `initialState`, the actions `stepPref` and `setFont`,
  applying on boot and on change), `face/client/js/data/empty.js`, `face/client/js/reducers/messages.js`
  (`setPref`), `face/client/js/render/account.js` (`renderSettings`), `face/client/index.html` (the
  inline script), `face/client/css/app.css`, `face/client/js/i18n/en.js`,
  `face/tests/client/helpers/screens.js` (three Settings states), `face/tests/client/fixtures/screens-en.json`
- Test: `face/tests/client/prefs.test.js`, `face/tests/client/app-dom.test.js`,
  `face/tests/client/css.test.js`

**Interfaces:**
- Produces:

```js
// prefs.js — pure
export const SIZES = { textSize: { min: 12, max: 20, base: 15 }, codeSize: { min: 10, max: 16, base: 12 } };
export function sizeOf(name, v) {}   // → an integer in range, the base for anything else
export function cleanFont(v) {}      // → '' or at most 64 chars of [\p{L}\p{N} _.-], spaces collapsed, trimmed
export function cssOf(prefs) {}      // → { '--fs': string|null, '--fm': string|null, '--font-sans': string|null, '--font-mono': string|null }
                                     //   null at the default; '--fs' = String(textSize / 15); '--font-sans' = `"<clean>", var(--font-sans-base)`
export function applyPrefs(rootEl, prefs) {} // setProperty for each non-null, removeProperty for each null
```

- State: `textSize: 15, codeSize: 12, textFont: '', codeFont: ''` in `emptyState`; `prefsOf` adds
  the four; `initialState` reads them through `sizeOf` and `cleanFont`; `setPref(s, {name, value})`
  stores `sizeOf`/`cleanFont`'s result for those four names and ignores any other name.
- Settings, after Theme: `Text size` with `−`, `<output id="pref-textSize">15 px</output>`, `+`
  (`data-action="stepPref"`, `data-pref`, `data-step="-1"`/`"1"`; a key at its end `disabled`);
  `<details id="more-fonts">` `More font settings` holding Text font (`input#pref-textFont`,
  `data-action="setFont"`, `data-pref="textFont"`, committed on `change`), Code font
  (`#pref-codeFont`), Code size (its stepper, `pref-codeSize`). The fold stays open across renders
  by its id (the page's `details[id][open]` keep).
- `index.html`'s script: after the theme, the same `cssOf` logic on the saved prefs, inline (a module
  loads after the first paint). `prefs.test.js` runs that script's text against `cssOf`.

- [ ] **Step 1: Write the failing tests:**
  - `prefs.test.js`: `sizes clamp to their ranges and take the base for a non-number`; `a font
    is cleaned: quotes, semicolons, braces and newlines go, 64 characters at most` (Review Focus 3:
    `Inter"; } body { display:none` → `Inter body display none` or the like, never a `"` or `;`);
    `cssOf is all null at the defaults`; `the inline script in index.html sets the same properties
    as applyPrefs` (the script's text run with a fake `localStorage` and a recording `style`, for the
    defaults, both maxima, both fonts set, and a hostile font);
  - `app-dom.test.js`: `+ on Text size reads 16 px, sets --fs and survives a reload`
    (`gravit-ui.prefs` holds `textSize: 16`; a new boot reads it); `− stops at 12 and its key is
    disabled`; `a typed code font is applied on change and cleared by an empty field`; `the fold
    stays open across a render`;
  - `css.test.js`: the Settings states' classes have rules (`stepper`, `stepper-out`, `fold` or the
    builder's names).
- [ ] **Step 2: Run them to see them fail.** Run `npx tsx --test tests/client/prefs.test.js
  tests/client/app-dom.test.js tests/client/css.test.js` in `face/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-pin the golden** for the Settings states only (the new rows; the three added
  states are new names). Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** (`feat(client): text size, code size and the two fonts in Settings, kept
  in the browser and applied before the first paint (plan 6 task 13)`).

### Task 14: The keys

**Files:**
- Create: `face/client/js/keys.js`, `face/tests/client/keys.test.js`
- Modify: `face/client/js/app.js` (`keydown`), `face/client/js/render/rail.js` (the search hint
  reads its chord from the table), `face/tests/client/words-guard.test.js` (`KEPT_FILES` gains
  `keys.js`), `face/client/js/i18n/en.js`
- Test: `face/tests/client/keys.test.js`, `face/tests/client/app-dom.test.js`

**Interfaces:**
- Produces:

```js
// keys.js
export const SHORTCUTS; // [{ id, section: 'general' | 'composer', words /* an EN key */, mac, other, code?, mods?, bound }]
                        // general: newConversation ⌥⌘N KeyN alt-cmd; searchConversations ⌥⌘K KeyK alt-cmd; settings ⌥⌘, Comma alt-cmd;
                        // shortcuts ⌘/ Slash cmd; composer: send Enter; newLine ⇧Enter / Shift+Enter; commands /; references @;
                        // close Esc — every row bound: true until the drill finds otherwise
export function chordOf(ev, mac) {} // → a general row's id or null: ev.code equal; 'alt-cmd' = altKey && !shiftKey && (mac ? metaKey && !ctrlKey
                                    //   : ctrlKey && !metaKey); 'cmd' = !altKey && !shiftKey && the same ⌘ rule; never while
                                    //   ev.isComposing or keyCode 229; only rows with bound true
export function chordLabel(row, mac) {} // → row.mac or row.other
```

- `app.js`'s `keydown`, first: `chordOf(ev, mac)`; `searchConversations` is plan 2's branch as it is;
  `newConversation` runs `act.startDraft()`; `settings` dispatches `openSettings`; `shortcuts` toggles
  the sheet (Task 15 draws it; until then it dispatches `openShortcuts`/`closeShortcuts` into a
  `shortcuts` slice, `null` in `emptyState`). Each `preventDefault`s. The three new ones do nothing
  while the lightbox or an owner sheet (`sheetUp`) stands; with the shortcut sheet open, a key
  other than ⌘/ closes the sheet first.

- [ ] **Step 1: Write the failing tests:**
  - `keys.test.js`: `each general key matches on its code with ⌘ as Meta on a Mac and Ctrl
    elsewhere`; `⌥ turning the key into another character still matches` (`key: 'ñ'`, `code:
    'KeyN'`); `Shift, the other platform's ⌘ or a missing ⌥ is not the key`; `nothing matches
    while an IME composes`; `a row marked unbound is never matched`; `dsh's rename, fork and archive
    chords are not in the table`;
  - `app-dom.test.js`: `⌥⌘N from the editor opens New message`; `⌥⌘, opens Settings from an
    input`; `⌘/ opens the sheet and ⌘/ again closes it`; `Ctrl+Alt+N on a Mac does nothing`;
    `⌥⌘, while What you sign stands, and ⌥⌘N while pinyin composes, do nothing` (Review Focus 4);
    the plan 2 ⌥⌘K tests keep passing.
- [ ] **Step 2: Run them to see them fail.** Run `npx tsx --test tests/client/keys.test.js
  tests/client/app-dom.test.js` in `face/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS, the golden unchanged.
- [ ] **Step 5: Commit** (`feat(client): the keys - one table matched on code, ⌥⌘N, ⌥⌘, and ⌘/
  beside ⌥⌘K (plan 6 task 14)`).

### Task 15: The shortcut sheet and Settings › Keyboard shortcuts

**Files:**
- Create: `face/client/js/render/shortcuts.js`, `face/tests/client/shortcuts.test.js`
- Modify: `face/client/js/app.js` (`render()` draws the sheet; `overlayOf`, `closeKeyOf` and the
  focus logic; the Escape slot; Tab inside the sheet; `typed` for the box), `face/client/js/reducers/`
  (`openShortcuts`, `closeShortcuts`, `setShortcutsQuery` beside `openSettings`),
  `face/client/js/render/account.js` (`renderSettings(state, { mac })`'s Keyboard shortcuts row),
  `face/client/css/app.css`, `face/client/js/i18n/en.js`, `face/tests/client/helpers/screens.js` (the
  sheet open, with a query, with no match, off a Mac), `face/tests/client/fixtures/screens-en.json`
- Test: `face/tests/client/shortcuts.test.js`, `face/tests/client/app-dom.test.js`,
  `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: `SHORTCUTS`, `chordLabel`.
- Produces:
  - `renderShortcuts(state, { mac })` → `''` when `state.shortcuts` is `null`; else a scrim
    (`data-action="closeShortcuts"`) and `<section class="shortcuts" role="dialog" aria-modal="true"
    aria-labelledby="sc-title">`: the head (`h2#sc-title`, a close key `.close-key`), the box
    (`input#sc-q`, `type="search"`, `data-action="scQuery"`), the bound rows by section, each the
    action's words and a `kbd` with `chordLabel`, the footnote; a query keeps the rows whose words or
    chord hold it, any case; none left draws `No shortcut matches`;
  - the state: `shortcuts: null | { q: string }`;
  - `app.js`: the sheet is drawn after the drawers and before the drop overlay and the lightbox;
    opening it focuses `#sc-q`; closing puts focus back on what opened it (Show all, or what had
    focus when ⌘/ was pressed), the drawer under it kept as an owner sheet keeps its drawer today;
    while it stands, Tab and Shift+Tab move between its box and its close key only; Esc closes it after
    a menu and the lightbox and before the search box (D34).
  - Settings: `Keyboard shortcuts` with `Show all` (`data-action="openShortcuts"`) and the sheet's
    chord (`⌘/`, `Ctrl+/` off a Mac).

- [ ] **Step 1: Write the failing tests:**
  - `shortcuts.test.js`: `the sheet lists the bound rows of each section with the platform's
    chords`; `an unbound row is not listed`; `a query keeps the matching rows, any case, and none
    left says No shortcut matches`; `the query is escaped`; `nothing is drawn while closed`;
  - `app-dom.test.js`: `Show all opens the sheet over Settings with focus in its box; Esc closes the
    sheet, focus back on Show all, a second Esc closes Settings` (Review Focus 5); `Tab stays inside
    the sheet`; `Esc with the lightbox over the sheet closes the lightbox first`; `typing in the box
    filters and keeps the words across the render`; `the scrim closes it`;
  - `css.test.js`: the sheet's classes have rules; it is 440 px wide and centred over `--scrim`.
- [ ] **Step 2: Run them to see them fail.** Run `npx tsx --test tests/client/shortcuts.test.js
  tests/client/app-dom.test.js tests/client/css.test.js` in `face/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-pin the golden** for the Settings states (the new row) and add the sheet's four
  states. Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** (`feat(client): the shortcut sheet on ⌘/ and Settings › Keyboard
  shortcuts (plan 6 task 15)`).

### Task 16: The documents and the build notes

**Files:**
- Modify:
  - `DEVELOPMENT.md`: §5.1 (`i18n/words.js`, `i18n/en.js`, `prefs.js`, `keys.js`,
    `render/shortcuts.js`), §5.4 (the words calls and their escaping rule; the Settings rows; the
    sheet; the rail's toolbar), §5.5 (`textSize`, `codeSize`, `textFont`, `codeFont` in
    `gravit-ui.prefs`; the `shortcuts` slice), §5.6 (`--fs`, `--fm`, the two `*-base` stacks), §7.3
    (the golden, the guard, the probe, `prefs.test.js`, `keys.test.js`, `shortcuts.test.js`), §7.4
    (the drill's new steps), §8 (the convention: a new client word goes into `en.js`, keys literal,
    no words call at import — D37), and one residual, numbered after the merge's renumbering: the
    language, the sizes and the fonts are per browser; a state-held line keeps the language it was
    written in; the scanner cannot see a lowercase single word, which the probe catches only in the
    corpus' states;
  - `face/README.md`: "The page (client/)" (the words table, the sizes and fonts, the keys and the
    sheet); the dsh UI port drill's heading names `client/js/i18n/`, `client/js/prefs.js`,
    `client/js/keys.js` and `index.html`'s script, and gains, in the operator's browser (Safari,
    Chrome and Firefox): each of ⌥⌘N, ⌥⌘K, ⌥⌘, and ⌘/ (Ctrl+Alt and Ctrl+/ off a Mac) from the
    editor, an input and a page with no focus — a key the browser keeps is marked `bound: false` in
    `keys.js` and leaves the sheet; Text size at 12 and 20 with a reload (no flash at the old size),
    a code font typed and cleared, the sheet over Settings with Esc twice; a screen reader on a pill
    and on the rail's arrows;
  - `CLAUDE.md`: the `face/client/` line gains one clause (the words in `js/i18n/en.js`, text and
    code sizes and fonts in Settings, the keys and the ⌘/ sheet);
  - `Gravit-Docs-and-Prompt-Loops.html`: nothing changes (no prompt, no loop station moves); the
    page's "last updated" line is left as it is;
  - `ROADMAP.md`: the built log;
  - the spec: `## 18. Build notes, plan 6`, in the §13–§17 form: the merge (or not) and its SHA,
    the commits, the counts, the rows of "Where the code differs" and "Where the spec leaves it to
    this plan" above among its clauses, the golden's re-pins and why, the keys the drill unbound, and
    what plan 7 inherits (`withTable` as its switch's seam, `wordsEpoch` in memo keys, the state-held
    lines).
- [ ] **Step 1: Write the documents.** The counts come from a fresh `npm test` run in `face/`.
- [ ] **Step 2: Commit** (`docs: the dsh UI port's words, sizes and keys - DEVELOPMENT, face/README,
  CLAUDE.md, ROADMAP and the spec's plan 6 build notes (plan 6 task 16)`).
