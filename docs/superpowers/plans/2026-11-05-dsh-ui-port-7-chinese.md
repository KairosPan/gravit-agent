# dsh UI port, plan 7: 中文 — zh.js and the switch on every screen at once, then the operator's correction pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings opens on a Language row, English · 中文; choosing 中文 redraws every word the face itself
writes in Chinese at once — every screen, every sheet, every line already on screen — sets `<html
lang="zh-CN">`, and is kept in the browser and applied on the next load with no English drawn first;
the English page stays byte-identical but for the new Language row; the plan ends with the operator reading the page in 中文 and
their corrections committed last (D30).

**Architecture:** Client only; the host does not change. Plan 6 left the seam: every face word is a
literal key in `js/i18n/en.js`, read by `t`/`th`/`tn`/`thn` (`js/i18n/words.js`) from the table
`setTable` puts in place. This plan first makes that seam hold a live switch — lines kept in the store
become key and params read when drawn (`said`, `sayOf`), what the face folds from the host is folded
again, sentences assembled in English word order become one key each — then writes `js/i18n/zh.js`
(every key, against a glossary the tests enforce), then turns the switch on. Two goldens hold it: the
English corpus' hashes (`fixtures/screens-en.json`, unchanged but for the merge's new states and the Language row) and a Chinese one
(`fixtures/screens-zh.json`, new). A review dump of every key, English beside Chinese, grouped by area
and naming the states that draw it, is what the operator corrects; a script applies the corrections.

**Tech Stack:** Vanilla ES modules in `face/client/js`, `face/client/index.html`; the fake-DOM client
suite (`face/tests/client/`, `node --test` via tsx); `typescript` (devDependency) in the scanner;
`node:crypto` for the goldens.

**Spec:** `docs/superpowers/specs/2026-11-03-dsh-ui-port-design.md` §5.10 (all of it), §7's Language
line and the keyed drill's 中文 item, §8 (the wording of `zh.js` before the operator's pass), §10 item
7, §11 (the per-browser residual), D27, D28, D30, D35, D36, D37, P6, O5, and above all §18 (plan 6's
build notes): its "What plan 7 inherits" list is this plan's task list's core. This plan's build notes
are the spec's §19 (Task 12).

**Precondition — D37 (Task 0, the operator's).** Local `main` has moved since plan 6's merge
(`df1e3230`): Slack in Account › Identity (`c8aeb987` and its fix `b05fdf5f`, docs `7eede3ff`) changes
thirteen client files — `app.js`, `host/identity-view.js`, `host/identity.js`, `host/sheet-identity.js`,
`reducers/identity.js`, `render/identity.js`, `render/owner.js`, `css/app.css`, and the tests
`app-dom`, `css`, `identity-host`, `identity-view`, `sheet-identity`. Main writes its words as English
literals (it has no table), and its `css.test.js` adds Identity states where the branch moved the corpus
to `helpers/screens.js`. By D37 plan 7 lands second and adapts: Task 0 merges, Task 1 moves Slack's
words into `en.js` and appends its states to the corpus, before any Chinese is written. If the operator
merges after plan 7 instead, skip Tasks 0–1 and run Task 1's steps at that merge, plus their Chinese
(Task 8's steps over the new keys) and a zh golden append; §19 records it.

**Where the code differs from the spec, this plan follows the code:**
- **"Applied before the first paint, like the theme."** The table cannot load in `index.html`'s inline
  script (a module runs after the first paint), and does not need to: `#app` is empty until `app.js`'s
  first `render()`. The inline script sets `<html lang>` from the saved `lang`; `startApp` calls
  `setTable` before `makeStore` (`emptyState` writes `connecting…` through `t`) and so before the first
  render. Nothing English is ever drawn under a saved 中文.
- **"A line written before a switch keeps its language until the next line"** (§18, R102) is not kept.
  §5.10 says a choice switches the face's words at once, and a status line in English under a Chinese
  page reads as broken (D35's reason). Lines the store holds become key and params (`said`) read at the
  draw; what the face folds from the host's records (a seat line, a receipt, a report, `Untitled`) is
  folded again on the switch. Text from the Account, dsh or a fixture stays a string and is drawn as
  it came.
- **"Every key in `en.js` has a `zh.js` entry or falls back by name"** (§7) is held stricter: every EN
  key has a ZH value at ship (D35, a whole 中文). The fallback in `words.js` stays for a key added later
  without its Chinese, and D37 (new words ship in both languages) is a test from Task 8 on.
- **Plurals in Chinese** are one form: a ZH value for an EN `{one, other}` is a string holding `{n}`.
  `words.js` `formOf` already reads a string for any count; nothing in `tn`/`thn` changes.
- **Dates (今天, 昨天, 11月3日).** `time.js` `fmtDate` joins `${month} ${day}` in code; it becomes the
  key `time.date` (`{month} {day}`), and ZH's months are numerals (`11`) with `time.date` `{month}月{day}日`.
- **The language's own names are not table words.** `English` and `中文` read the same in both tables
  (as dsh draws them); they live in `js/i18n/langs.js` as content, not in `en.js`/`zh.js`.
- **The Language row is a `seg`** (`render/controls.js`), first in Settings above Theme (plan 6 left the
  slot: §18 "plan 7 puts Language first"), its values the codes `en` and `zh`, never the labels — the
  theme trap §5.10 names, held by `words-probe`'s seg test.
- **The pref is `lang: 'en' | 'zh'`;** `<html lang>` is `en` or `zh-CN`.
- **The Account's codes drawn as words** (an open order's `pending`, `limit`, `open`; a limit's `payees`
  scope; a key's status `ok`) were left as the Account's content by plan 6's ruling. The spec is silent;
  a raw English code in a Chinese row reads as an untranslated word, so this plan draws a known code
  through a key and an unknown one as it came (Task 6). It is an operator question (below); the plan's
  default is to word them.

**Where the spec leaves it to this plan:**
- **The wording of `zh.js`** (§8): a draft, in one register, against a glossary (Task 7) the operator
  corrects with the rest (D30).
- **How the operator corrects:** a review dump (Task 11) — `zh-review.html` to read, English beside
  Chinese, grouped by area, each key with the corpus states that draw it — and `zh-review.tsv` with an
  empty `fix` column; the operator fills it (or says the fixes in chat and the controller fills it), and
  `zh-apply.js` writes them into `zh.js` (Task 14).
- **The order of the last commits:** the documents and §19 (Task 12) come before the operator's pass, so
  the corrections are the plan's last commit (D30); that commit adds §19's one line on what was corrected.

## Global Constraints

- **English byte-identical.** `face/tests/client/fixtures/screens-en.json` is re-pinned by no task but
  Task 1 (it appends the merge's new states) and Task 9 (the Settings states gain the Language row — new
  markup, the one English change; the dump's diff shows that row and nothing else). Every task dumps the English corpus before
  and after (`npx tsx tests/client/golden-write.js --dump <scratch>/before|after`) and the two are equal;
  the 954 `assert.match` and 245 `assert.doesNotMatch` over English HTML pass untouched. A task that
  cannot move a word without changing an English byte stops and reports to the controller.
- **The table grammar holds for both tables:** keys `<area>.<part>.<name>` in the 29 areas; a value a
  non-empty string (or, in EN only, `{one, other}`); no `<`, `>`, `"`; no `&` that starts an entity
  (`/&(#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/`) — and a value holding any `&` is read only by `t`/`tn`
  inside `esc`, never by `th`/`thn` (Task 6); ZH's params per key equal EN's (a plural's `{n}` included);
  ZH holds no key EN lacks; from Task 8, every EN key has a ZH value.
- **Escaping and the words calls** are plan 6's: literal keys at every call site, no words call at module
  top level, `th` for raw template text, `t` inside `esc`/`attrs` and for host-made text. New here:
  `said`/`saidn` for a line the store keeps, `sayOf` at its draw.
- **What stays as written in both languages (§5.10):** conversation and channel titles (a Run's title is
  the table's at its creation and persisted as written); the operator's, Gravit's and the bots' words;
  the Lunhui output and the modules' Chinese sub-titles; dsh's texts (a command's result, a refusal, an
  error code) and the Account's (its refusal sentences, a venue's name, What you sign's lines); tickers,
  symbols, skill and tool names, a bot's name and soul; numbers in `en-US` grouping (D28); the A-share
  units and the room's two notices in Chinese (D36); key names (`Enter`, `Esc`, `⌥⌘K`); up green and
  down red (O5).
- **Names kept in 中文 (the glossary's `keep`):** `Gravit`, `Account` (the service's name), `Lunhui`,
  `DeepSeek`, `dsh`, `MCP`, `Telegram`, `Slack`, `iMessage`, `iFinD`, `Tencent`, `AKShare`, `Alpaca`, a
  venue's and a wallet's name, `USDC`/`USDT`/`ETH` and every ticker, `px`, `tok/s`, `CST`, `ET`, the
  history ranges `1D…MAX`; the operator's questions below may move `Account` and `Lunhui`.
- **Fonts:** D29 already landed (Noto Sans SC 400–800 in `index.html`'s link; `--font-mono-base` falls back
  to Noto Sans SC, PingFang SC, Hiragino Sans GB). No CSS changes in this plan but what a task names.
- **The client rules:** one store, pure reducers (a reducer reads no table — Task 2), string renderers,
  one `innerHTML` per render, `data-action` delegation; prefs in `gravit-ui.prefs` only, every read and
  write in `try`; memoized renderers key on `wordsEpoch()`.
- `GRAVIT.md` is 4,494/4,500 bytes and is not touched; the prompt-loops page does not move (no prompt and
  no loop station changes: a Run's request and the stock drawer's follow-up are already Chinese).
- Never the live `~/.dsh`, never port 3090, never `npm run service`, no `FACE_SMOKE` run. Commit messages
  go in a file, `git commit -F <file>`. No push, stash, reset or branch switch.

## Review Focus

1. **A reload under 中文.** With `lang: 'zh'` saved, the first `render()` draws Chinese: no English
   frame, `<html lang="zh-CN">` before the first paint, `connecting…` in Chinese. Pinned in Task 9
   (`app-dom.test.js`, and `prefs.test.js` running the inline script).
2. **A switch with a draft open.** Choosing 中文 while the editor holds words, a chip, a caret and an open
   `/` menu keeps all four; the placeholder and the menu's footer redraw in Chinese. Pinned in Task 9.
3. **A line on screen before the switch.** A status line, a sheet's refusal, a field's error, a desk or
   Discover line written under English reads in Chinese after the switch; a refusal that came from the
   Account or dsh reads as it came. Pinned in Task 2 (`words-status.test.js` under `withTable`) and Task 9.
4. **The jobs' dropped-output marker after a switch.** A held output with the marker, then a re-opened
   follow under the other table, carries exactly one marker, in the table that stands when drawn.
   Pinned in Task 2.
5. **What you sign under 中文.** The sheet's frame (title, keys, countdown) is Chinese; its `shown` lines
   are the Account's, byte for byte, and the signature covers what is drawn. Pinned in Task 10 (a zh
   golden state of the owner sheet, and a test that `shown` is drawn unchanged under ZH).

---

### Task 0: The merge (the operator's, before Task 1)

The operator merges local `main` into `claude/cranky-bun-9f78c8` (the call is theirs, D37). The expected
conflicts: `face/tests/client/css.test.js` (main adds Identity states; the branch moved the states to
`helpers/screens.js` — main's new states go into `helpers/screens.js` `identityStates`, appended after the
last state so no pinned name shifts), `render/identity.js`, `host/identity*.js`, `host/sheet-identity.js`,
`reducers/identity.js`, `render/owner.js` and `app.js` (main's literals against the branch's `t()` calls:
keep the branch's calls and main's behaviour; main's new English stays a literal for Task 1). After the
merge `npm test && npm run typecheck` pass in `face/` except `words-guard` (main's literals) and
`words-golden` (new states not pinned). The controller records the merge SHA in §19. If the operator
merges later, skip Tasks 0–1 and follow the precondition's fallback.

### Task 1: The merge's words into the table

**Files:**
- Modify: the merged client files that `words-guard` reports (Slack's Identity: `render/identity.js`,
  `host/identity-view.js`, `host/identity.js`, `host/sheet-identity.js`, `reducers/identity.js`,
  `render/owner.js`, `app.js`), `face/client/js/i18n/en.js` (areas `identity`, `sheet`),
  `face/tests/client/helpers/screens.js`, `face/tests/client/fixtures/screens-en.json`

- [ ] **Step 1: Run the guard and the golden and see them fail:** `npx tsx --test
  tests/client/words-guard.test.js tests/client/words-golden.test.js` in `face/`. Expected: FAIL, the
  literals main brought, and the golden's new names. A reducer in that list that writes a word is moved
  by Task 2's rule (a `said` ref), not with `t`.
- [ ] **Step 2: Move every literal** by plan 6's escaping rule; the Slack app's manifest and token
  shapes, Slack's ids and the Account's sentences are `// en-kept:` with their reason (and `EN_KEPT`
  counted again).
- [ ] **Step 3: Append the new states** (`golden-write.js --pin`, no `--repin`); the pre-merge states keep
  their hashes — a pre-merge Identity state main redrew is re-pinned by name and the diff of its dump
  shown in the commit message. Run `npx tsx --test tests/client/words-*.test.js`, then `npm test && npm
  run typecheck`. Expected: PASS; `words-probe` empty.
- [ ] **Step 4: Commit** (`refactor(client): Slack's words in Account › Identity into the table, its
  states appended to the golden (plan 7 task 1)`).

### Task 2: Lines the store keeps, as key and params

**Files:**
- Modify: `face/client/js/i18n/words.js`, `face/tests/client/helpers/words-scan.js` (`WORDS_CALLS`
  gains `said`, `saidn`), every host module, reducer and `app.js` line that writes a words call into the
  store, and the renderers that draw those fields; `face/client/js/host/jobs.js`
- Test: `face/tests/client/words.test.js`, `face/tests/client/words-status.test.js`,
  `face/tests/client/jobs.test.js` (or the file that holds `startJobs`), `face/tests/client/words-guard.test.js`

**Interfaces:**
- Produces (`i18n/words.js`):

```js
export function said(key, params) {}      // → a frozen { key, params } (registered in a WeakSet), kept in state in place of t(key, params)
export function saidn(key, n, params) {}  // the same for a plural: read with tn
export function sayOf(v) {}               // → v when a string; t/tn of a said() under the table standing now; '' for anything else
```

- The fields: every place host code, a reducer or `app.js` stores a words call's result — the status
  lines (`fail`'s lines in `host/actions.js`, `NOT_SIGNED_IN`, `app.js`'s upload and job notes, `host/live.js`),
  a sheet's `message`/`said`/`why` (`reducers/owner.js` `sheetRefused`'s default, `host/owner-view.js`,
  `host/owner.js` `noAnswer`/`notSigning`, `host/sell-many.js`, `host/sheet*.js`), a field's `error` and an
  inline edit's error (`reducers/controls.js` `details.nameEmpty`), the composer's notes and
  `composer/files.js`'s constraint lines, a trace's `line` (`reducers/traces.js`), a view's `error`
  (`reducers/lunhui.js`, `host/lunhui.js`), the stored lines of Discover (`host/discover.js`), a channel
  (`host/channels.js`), the Run sheet (`host/run-sheet.js`), the desk (`host/desk.js`), Markets and Trade
  (`host/markets.js`, `host/trade.js`, China's provider `said`), the wallet and Identity hosts. The rule:
  a words call whose result is dispatched or assigned into state becomes `said`/`saidn`; the draw that
  reads the field reads `sayOf(field)` in the escaping it had.
- A reducer reads no table: `sheetRefused`, `traceFailed`, `lunhuiViewFailed` and `controls.js`'s edit
  error store `said(...)`, which their reducers may build (a `said` is a value, not a read).
- `host/jobs.js`: the held text carries a sentinel, not the table's word: `DROPPED = '\u0000dropped\u0000\n'`
  (no output can hold it: an output frame's NUL characters become U+FFFD on arrival); `mark`, `cap` and
  the `opened` branch test and write the sentinel; the renderer
  (`render/messages.js`, the open job's `pre` written by `textContent` in `app.js` `onOutput`) replaces a
  leading or line-start sentinel with `t('jobs.dropped')` at the write.

- [ ] **Step 1: Write the failing tests:**
  - `words.test.js`: `said reads the table standing at sayOf, not the one at said`
    (`said('jobs.dropped')` made under EN, read under a probe table → the probe's value);
    `saidn picks its form by its count`; `sayOf passes a string through and draws nothing for null`;
    `a said is frozen and its params are copied`;
  - `words-status.test.js`: each existing case reads its line through `sayOf` (bytes unchanged under EN),
    and gains its probe twin: `withTable(PROBE, () => sayOf(line))` is the probe's value — so a line
    written before a switch follows it (Review Focus 3); an Account or dsh refusal stored as a string
    reads the same under both tables;
  - `jobs.test.js`: `a re-opened follow after a table switch adds no second marker` (Review Focus 4: a
    held text with the marker, then an `opened` frame past `next` under another table → one marker);
    `the marker is drawn in the table that stands`;
  - `words-guard.test.js`: `no words call's result is stored in state`: a scanner rule in
    `words-scan.js`, `storedWords(source, file)`, reports a `t`/`tn` call that is an argument of
    `store.dispatch`, a value in an object literal passed to `dispatch` or returned by a reducer, or the
    right side of an assignment to a property; `en-kept` does not exempt it; the report is empty.
- [ ] **Step 2: Run them to see them fail.** `npx tsx --test tests/client/words.test.js
  tests/client/words-status.test.js tests/client/words-guard.test.js tests/client/jobs*.test.js` in
  `face/`. Expected: FAIL, `said` is missing and the scanner lists every stored line.
- [ ] **Step 3: Implement** `said`, `saidn`, `sayOf`, `storedWords`; move each reported site; the draws
  read `sayOf`; the jobs sentinel.
- [ ] **Step 4: Run** `npx tsx --test tests/client/words-*.test.js tests/client/jobs*.test.js`, then `npm
  test && npm run typecheck`. Dump and diff the English corpus. Expected: PASS; no byte moved.
- [ ] **Step 5: Commit** (`feat(client): lines the store keeps are key and params, read in the table that
  stands when drawn; the jobs' dropped marker a sentinel (plan 7 task 2)`).

### Task 3: What the face folds from the host, folded again

**Files:**
- Modify: `face/client/js/app.js` (an action `reword`), `face/client/js/host/live.js` (nothing new if
  `refresh` and `open` serve; see Step 3), `face/client/js/host/lunhui.js`
- Test: `face/tests/client/app-dom.test.js`, `face/tests/client/run-sheet.test.js` (or the file that
  holds `host/run-sheet.js`)

**Interfaces:**
- Consumes: `live.refresh()` (re-lists: `host/sessions.js` folds `title ?? t('list.untitled')` again),
  `live.open(id)` (a fresh snapshot or page, folded by `host/kinds.js` `toMessages`: seat lines, receipts,
  reports, a refusal's words, the gate cards).
- Produces: `act.reword()` in `app.js` — `live.refresh()`; when the route shows a conversation,
  `live.open(route.id)`; `store.dispatch('lunhuiForgetFailed')` (a new reducer in `reducers/lunhui.js`
  dropping every view whose `status` is `failed`, so a drawn run reads its view again); nothing else (a
  stored line is a `said` since Task 2). Task 9's `setLang` calls it after `setTable`.
- A Run's conversation title (`host/run-sheet-view.js` `titleOf`, sent as the conversation's title by
  `host/run-sheet.js`, kept in `moduleRuns`) is the table's at its creation and is never re-folded.

- [ ] **Step 1: Write the failing tests:**
  - `app-dom.test.js`: `reword re-lists and re-reads the open conversation` (with a fake `call`
    recording `session/list` and the open conversation's `session/follow` or `session/page`);
    `an untitled conversation is drawn in the table standing after reword` (a summary with no title,
    `withTable(PROBE)` around `reword` and the next render: the probe's `list.untitled`); `a seat line in
    the open thread is drawn in the new table after reword`; `a failed run view is read again after reword`;
  - `run-sheet.test.js`: `a Run sent under another table is titled in it and keeps that title after a
    switch back` (the title passed to `newConversation` and stored in `moduleRuns`).
- [ ] **Step 2: Run them to see them fail.** `npx tsx --test tests/client/app-dom.test.js
  tests/client/run-sheet*.test.js` in `face/`. Expected: FAIL, `reword` is missing.
- [ ] **Step 3: Implement.** `live.open` on the conversation already shown starts a fresh view (its
  earlier pages are dropped, as a turn at the tail drops them: §17); if `open` returns early for the same
  id, add `live.reopen(id)` with that one behaviour, and say so in the Interfaces of Task 9.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS; the English corpus unchanged.
- [ ] **Step 5: Commit** (`feat(client): reword - the list, the open conversation and a failed run view
  folded again under the table that stands (plan 7 task 3)`).

### Tasks 4–5: Sentences assembled in code order, made keys

A sentence whose words the code joins in English order (`${a} · ${venue}`, `[x, y].join(' ')`,
`` `${t('…')} ${n}` ``) cannot be reordered by a table. Each becomes one key whose value holds the
joins as params, in the escaping it had; a list of items (chips, clauses) keeps its order but its
separator, when it is prose (`, `, ` and `), becomes a key (`common.list.sep` `, ` and `common.list.and`
` and `; ZH `、` and `和`); the visual separator ` · ` is no word and stays.

Both tasks share the guard: `words-scan.js` gains `assembled(source, file)` → `[{ line, text }]`,
reporting a template literal or a `.join(…)` over an array in which a words call stands beside another
expression with only whitespace or punctuation between them, and a `+` concatenation of a words call
with a non-literal. `words-guard.test.js` gains `ASSEMBLED`, the sorted list of files that report one at
the start of Task 4, and two tests: `no client file outside ASSEMBLED assembles a sentence` and `every
ASSEMBLED file still does`. A join that is not a sentence (a CSS class list, a path, a key, a list of
codes) carries `// words-order: <reason>` and is not reported. Each task's steps are:

- [ ] **Step 1: Take the task's files out of `ASSEMBLED`;** run the guard, see it list their joins; dump
  the English corpus (`before`).
- [ ] **Step 2: Write the reorder tests.** For each join moved, one test in the file that tests its
  module renders it under `withTable({ '<key>': '<the params in reversed order>' })` and asserts the
  reversed order — proving the order is the table's.
- [ ] **Step 3: Move each join** into one key (EN value the exact English bytes) and run the tests.
- [ ] **Step 4: Run** `npx tsx --test tests/client/words-*.test.js` and the module tests, then `npm test
  && npm run typecheck`; dump `after` and diff: equal. Expected: PASS.
- [ ] **Step 5: Commit** (`refactor(client): <area>'s sentences one key each - their order the table's,
  nothing on screen changes (plan 7 task N)`).

### Task 4: The thread, the list and the clocks

- Files: `host/kinds.js` (`at`, `orderWords`, `typeWord`'s join, `seatLine`, `refusalWords`), `render/rail.js`
  (`previewOf`), `render/thread.js` (`imageMeta`), `render/messages.js` (Details' and Usage's joins),
  `host/turns-view.js`, `host/jobs-view.js`, `time.js` (`fmtDate` → `time.date` `{month} {day}`; the ages
  already keys), `composer/files.js`, `wire/speaker.js`, and any other Messages-side file `ASSEMBLED` lists.
- Areas: `thread`, `list`, `time`, `details`, `jobs`, `composer`.

### Task 5: Account, Markets, Trade, the desk, Discover and the modules

- Files: `render/account.js` and `host/account-view.js` (the limit clauses, the venue health line, the
  agent row, the key file's `Missing:` and `May send:`, the routes' lists, Devices' lines),
  `host/sheet-view.js`, `host/desk-view.js` and `render/desk.js` (the desk's lines, its standing),
  `host/trade-view.js` (the fill: `at`, `fillPrice`, `trade.fill.avg`), `host/modules-view.js` (a module
  chip's `<module>: <words>`, the legend rows, `withSource`, `DIR_CHANNEL`'s line — the path itself stays,
  `// words-order: a path`), `host/runs-view.js` and `render/lunhui/*.js` (the readouts, the stocks'
  `aria-label`s, the latest detail's joins), `host/market-view.js`, `render/markets.js`, `render/identity.js`.
- Areas: `account`, `money`, `venues`, `agents`, `rules`, `identity`, `sheet`, `markets`, `trade`, `desk`,
  `discover`, `modules`, `lunhui`.
- Task 5 ends with `ASSEMBLED` empty: the list and its second test are deleted, the first covers every file.

### Task 6: The table's loose ends

**Files:**
- Modify: `face/client/js/i18n/en.js`, `face/client/js/render/account.js` (`pnl`), `face/client/js/render/discover.js`
  (`item.kind.toUpperCase()`), `face/client/js/host/discover-view.js`, `face/client/js/render/trade.js`,
  `face/client/js/host/trade-view.js`, `face/client/js/host/market-view.js`, `face/client/js/host/run-sheet-view.js`,
  `face/client/js/host/modules-view.js`, `face/client/js/host/owner.js`, `face/client/js/host/account.js`,
  `face/client/js/host/owner-view.js`, `face/client/js/host/sell-many.js`, `face/client/js/reducers/owner.js`,
  the Account screen's order, limit and key rows (`render/account.js`, `host/account-view.js`)
- Test: `face/tests/client/words-table.test.js`, `face/tests/client/account.test.js` (or the Account
  screen's test), `face/tests/client/discover*.test.js`, `face/tests/client/money*.test.js`

**Interfaces:**
- `P&L` into the table: `account.pnl` `P&L`, read as `esc(t('account.pnl'))` (bytes `P&amp;L`, as
  today); the `en-kept` marker goes and `EN_KEPT` drops by one.
- Plurals: `sheet.earn.locked` `{ one: 'locked {n} day after you ask for it back', other: 'locked {n} days
  after you ask for it back' }` read by `tn` (the param `days` becomes `n`); `markets.chart.sessions`
  `{ one: 'The last session, {first} to {last}: low {low}, high {high}', other: 'The last {n} sessions,
  {first} to {last}: low {low}, high {high}' }`. No corpus state draws a count of 1 (checked: the English
  dump holds `The last 2 sessions` only), so the golden holds.
- Upper case: no `toUpperCase` on a words call's result. Discover's kind word becomes its own key per
  kind whose EN value is the upper case already drawn (`discover.kind.moduleUpper` `MODULE`, and each kind
  the corpus draws), read where `item.kind.toUpperCase()` stood; `host/discover-view.js` carries the kind's
  code for it. `trade-view.js`'s `${p.kind[0].toUpperCase()}…` capitalizes the Account's code: a known
  kind reads a key, an unknown one as it came.
- Keys split by meaning: `trade.field.orderType` (the field's label `Order`, and the table head in
  `render/trade.js` → `trade.head.order`); `markets.sort.volume` (a sort, and Trade's group heading in
  `render/trade.js` → `trade.group.mostTraded`); `modules.chip.noRun` (a chip, and the Run sheet's option
  note in `host/run-sheet-view.js` → `runSheet.on.noRun`). EN values unchanged.
- Duplicates of one meaning merged: `owner.noAnswer` and `account.noAnswer` → `account.noAnswer`;
  `owner.refused` and `money.sellMany.refused` stay two (a sheet's refusal, a leg's state) — each gets a
  comment naming its meaning. A test: `no two keys hold the same sentence of four words or more unless
  listed` (`SAME_WORDS`, each pair with its two meanings).
- The Account's codes drawn as words: `account.order.status.<code>` for `pending`, `open`, `filled`,
  `cancelled` (the codes the Account sends), `account.order.type.<code>` for `market`, `limit`,
  `account.limit.scope.<code>` for `trade`, `venues`, `payees`, `earn`, `account.key.status.ok`; a code
  with no key is drawn as it came. EN values are the codes as drawn today (`pending`, `limit`, …), so no
  byte moves. If the operator answers "leave them" (question 4), this item is skipped and §19 says so.
- Comments: `host/owner.js` `notSigning`'s comment names the key, not its English; the money sheet's test
  of the Account's proven sentence compares the Account's fixture string, not a table value.

- [ ] **Step 1: Write the failing tests:**
  - `words-table.test.js`: `a value holding & is read only by t or tn` (every `wordsCalls` site of such a
    key has `fn` `t`/`tn`); `no words call's result is upper- or lower-cased` (a scanner rule over
    `wordsCalls`' parents: `.toUpperCase()`/`.toLowerCase()` on a call, or on a variable a call assigned in
    the same function); `no two keys hold the same sentence of four words or more unless listed`;
  - the Account screen's test: `an order's status, type and a limit's scope are drawn from the table`
    (under a probe table) `and an unknown code as it came`;
  - `discover*.test.js`: `a kind is drawn in the table's upper case` (probe);
  - plurals: `locked 1 day` and `The last session` (each module's test).
- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`; dump and diff the English corpus: equal.
- [ ] **Step 5: Commit** (`refactor(client): the table's loose ends - P&L in it, two plurals, upper case
  as keys, keys split by meaning, the Account's codes worded (plan 7 task 6)`).

### Task 7: The glossary and the Chinese table's checks

**Files:**
- Create: `face/tests/client/fixtures/zh-glossary.json`, `face/client/js/i18n/zh.js` (`export const ZH =
  Object.freeze({})`, the header comment as `en.js`'s), `face/tests/client/words-zh.test.js`
- Modify: `face/tests/client/words-guard.test.js` (`KEPT_FILES` gains `i18n/zh.js` — the Chinese table),
  `face/tests/client/client-chinese.test.js` (`CONTENT` gains `i18n/zh.js` — the Chinese table)

**Interfaces:**
- `zh-glossary.json`: `{ "register": "…", "terms": [{ "en": "conversation", "zh": "对话", "note": "…",
  "except": { "<key>": "<reason>" } }, …], "keep": ["Gravit", …] }`. `en` matches an EN value's word
  case-insensitively at word edges with an optional plural `s`; `keep` is Global Constraints' list.
- The register (the plan's draft, the operator's question 2): concise product copy, no pronoun where the
  sentence stands without one, `你` where one is needed (never `您`); full-width Chinese punctuation
  (`，` `：` `。` `？`) between Chinese words, ASCII around Latin and numbers; one space between a Chinese
  character and a Latin word, a number or a `{param}` (`Gravit 正在运行`, `{n} 个任务`), none between two
  Chinese characters; `…` kept; no full stop on a label or a key.
- The terms (the draft; the board's terms where the spec gives them, `奶油` for Cream): Messages 消息 ·
  Markets 行情 · Trade 交易 · Discover 发现 · Settings 设置 · conversation 对话 · channel 频道 · room 群聊 ·
  bot 机器人 · role 角色 · skill 技能 · tool 工具 · background job 后台任务 · turn 轮 · step 步 · Details 详情 ·
  Usage 用量 · tokens token · pin 置顶 · archive 归档 · fork 分支 · rename 重命名 · search 搜索 · attach 附件 ·
  reference 引用 · secret 密钥 · Run 运行 · module 模块 · Research 研究 · Theme 主题 · Cream 奶油 · Black 黑 ·
  System 跟随系统 · Text size 字号 · shortcut 快捷键 · venue 交易场所 · wallet 钱包 · owner device 所有者设备 ·
  sign 签名 · What you sign 你签署的内容 · card 卡片 · limit 额度 (a limit you grant) / 限价 (an order type,
  `except` per key) · order 订单 · market order 市价单 · limit order 限价单 · position 持仓 · holdings 持仓 ·
  P&L 盈亏 · perp 永续合约 · event 事件合约 · shares 股 · watch list 自选 · movers 涨跌幅榜 · Most traded 成交最活跃 ·
  desk 值守台 · standing order 常设指令 · brief 简报 · alert 提醒 · paper 模拟 · Refused 已拒绝 · Retry 重试 ·
  Cancel 取消 · Save 保存 · Close 关闭 · Copy 复制 · Loading… 加载中…
- `words-zh.test.js` (over whatever `ZH` holds — empty here, whole from Task 8):
  - `ZH follows the grammar: frozen, keys in EN, values non-empty strings` (no plural objects);
  - `no ZH value holds <, > or ", nor an entity; a value with & is read only by t`;
  - `each ZH value carries exactly its EN key's params` (a plural's `{n}` included);
  - `ZH holds no Latin word but a kept name, a param or a key name` (every `/[A-Za-z]{2,}/` run outside
    `{…}` is in the glossary's `keep` or `KEY_NAMES`);
  - `the glossary is held`: for every term, every EN key whose value holds `en` has a ZH value holding
    `zh`, unless the term's `except` names the key; a glossary term's `zh` is never in `keep`;
  - `ZH's punctuation and spacing are the register's`: no ASCII `,` `:` `?` `!` between two CJK
    characters; no `。` at the end of a value whose EN ends with no `.`; a space at every CJK–Latin,
    CJK–digit and CJK–`{param}` boundary, none between two CJK characters;
  - `every glossary term is used`: each term's `en` occurs in some EN value (a term nothing uses is
    dropped).

- [ ] **Step 1: Write `words-zh.test.js`** and the glossary, and feed each check one bad value of its own
  (`withTable`-free: the checks are functions over a table, called on a small bad table) to see each fail.
- [ ] **Step 2: Run** `npx tsx --test tests/client/words-zh.test.js`, then `npm test`. Expected: PASS over
  the empty `ZH`.
- [ ] **Step 3: Commit** (`test(client): the Chinese table's checks and its glossary - grammar, params,
  no stray Latin, the terms held (plan 7 task 7)`).

### Task 8: zh.js, every key

**Files:**
- Modify: `face/client/js/i18n/zh.js`, `face/tests/client/words-zh.test.js`,
  `face/tests/client/fixtures/zh-glossary.json` (a term the writing finds missing, added with its use)

**Interfaces:**
- `ZH` holds every key of `EN` (its count after Tasks 1–6: 1,686 plus Slack's and the keys Tasks 4–6
  added, minus the merged duplicate), in `en.js`'s order and with its area comments in Chinese, each a
  string; a value's meaning is the English one *where it is drawn* — the writer reads the key's call
  site, never the English alone (`Order` the field is `订单类型`, the table head `订单`).
- Kept in both languages, so never a ZH key's text by translation: what Global Constraints lists. The
  room's two notices and the A-share units are not table keys (D36).

- [ ] **Step 1: Add the completeness test** to `words-zh.test.js`: `every EN key has a ZH value` (D35;
  and from now on D37's "new words ship in both languages"). Run it. Expected: FAIL, every key listed.
- [ ] **Step 2: Write the batches,** one per run of areas, each followed by `npx tsx --test
  tests/client/words-zh.test.js` (the completeness test failing only on later batches' keys) and a
  commit (`feat(client): zh.js - <areas> (plan 7 task 8, batch N)`):
  1. `common`, `time` (months `1`…`12`, `time.date` `{month}月{day}日`, `今天`, `昨天`, `刚刚`, ages
     `{n} 分钟前`), `status`, `nav`, `list`, `search`, `settings`, `shortcuts`;
  2. `thread`, `composer`, `details`, `jobs`;
  3. `owner`, `sheet`, `account`, `money`, `venues`, `agents`, `cards`, `rules`, `identity`;
  4. `markets`, `trade`, `desk`;
  5. `discover`, `channel`, `modules`, `runSheet`, `lunhui`.
- [ ] **Step 3: Render the corpus under ZH and read it:** `npx tsx tests/client/golden-write.js --lang zh
  --dump <scratch>/zh` (Task 10's flag; until then a one-off `withTable(ZH, corpus)` dump) and look at
  every state for a value that reads wrong where it is drawn (a label cut, a sentence that now reads in
  two orders, a param in the wrong place); fix in `zh.js`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS, completeness included; the
  English corpus unchanged (ZH is not active).
- [ ] **Step 5: Commit** the last batch (`feat(client): zh.js - every key in Chinese, the draft for the
  operator (plan 7 task 8)`).

### Task 9: The switch

**Files:**
- Create: `face/client/js/i18n/langs.js`
- Modify: `face/client/js/app.js` (`startApp`'s first lines, `prefsOf`, `initialState`, the action
  `setLang`), `face/client/js/data/empty.js` (`lang: 'en'`), `face/client/js/reducers/messages.js` (`setLang`
  beside `setTheme`), `face/client/js/render/account.js` (`renderSettings`: Language first),
  `face/client/index.html` (the inline script), `face/client/js/i18n/en.js` and `zh.js`
  (`settings.language`), `face/tests/client/helpers/screens.js` (two Settings states: under ZH, and the
  Language row pressed on 中文), `face/tests/client/fixtures/screens-en.json` (append only),
  `face/tests/client/words-guard.test.js`, `face/tests/client/client-chinese.test.js`
- Test: `face/tests/client/app-dom.test.js`, `face/tests/client/prefs.test.js`, `face/tests/client/words-probe.test.js`

**Interfaces:**
- Produces:

```js
// i18n/langs.js — content: each language's own name, the same in both tables
export const LANGS = Object.freeze([{ id: 'en', name: 'English', html: 'en' }, { id: 'zh', name: '中文', html: 'zh-CN' }]); // en-kept: a language's own name
export function tableOf(id) {}  // → EN for 'en', ZH for 'zh', EN for anything else
export function langOf(v) {}    // → 'zh' when v === 'zh', else 'en'
```

- `startApp`: `const lang = langOf(readPrefs(storage).lang); setTable(tableOf(lang));
  doc.documentElement.lang = …html` — before `makeStore`. `prefsOf` and `initialState` carry `lang`.
- `act.setLang(el)`: `const lang = langOf(el.dataset.value)`; nothing when it is the language standing;
  else `setTable(tableOf(lang))`, `store.dispatch('setLang', lang)` (the render follows),
  `doc.documentElement.lang = …`, `act.reword()` (Task 3).
- Settings, first section: `settings.language` (`Language` / `语言`) and `seg(LANGS.map(l => [l.name,
  l.id]), state.lang, 'setLang')`, then Theme and the rest as plan 6 left them.
- `index.html`: after the theme, `if (p.lang === 'zh') r.lang = 'zh-CN';` — nothing else (the words come
  with the first render).
- `client-chinese.test.js` `CONTENT` gains `i18n/langs.js` (a language's own name).

- [ ] **Step 1: Write the failing tests:**
  - `app-dom.test.js`: `choosing 中文 redraws Settings in Chinese, sets html lang zh-CN and keeps lang in
    gravit-ui.prefs`; `a boot with lang zh draws its first render in Chinese` (Review Focus 1: the first
    `#app` HTML holds no EN value of a key ZH words differently); `choosing the language standing does
    nothing` (no `reword` call, `wordsEpoch` unchanged); `the switch keeps a draft, its chip, its caret and
    an open / menu, and redraws the placeholder` (Review Focus 2); `a status line on screen before the
    switch reads in Chinese after it` (Review Focus 3); `a refusal from the Account reads as it came`;
    `back to English draws the corpus' English bytes` (a Messages state rendered after en → zh → en equals
    its golden html);
  - `prefs.test.js`: `the inline script sets html lang for a saved zh and leaves en alone`, run as plan 6
    runs the script (and for a hostile `lang`: `'zh"; x'` → `en`);
  - `words-probe.test.js`: the seg test now also finds the Language seg (values `en`, `zh`).
- [ ] **Step 2: Run them to see them fail.** `npx tsx --test tests/client/app-dom.test.js
  tests/client/prefs.test.js tests/client/words-probe.test.js` in `face/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-pin** — the English Settings states gain the Language row: the only English re-pin
  of the plan after Task 1, by name (`--repin` the Settings states), the dump's diff showing the one new
  `dsec` and nothing else; the two new states appended. Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** (`feat(client): Settings › Language, English · 中文 - every word at once, kept in
  the browser, html lang before the first paint (plan 7 task 9)`).

> The Language row is markup the English page did not have, so Task 9's Settings re-pin is the one
> English change the plan makes; every other English byte holds.

### Task 10: The Chinese golden and the Chinese probe

**Files:**
- Create: `face/tests/client/fixtures/screens-zh.json`
- Modify: `face/tests/client/golden-write.js` (`--lang zh`: entries rendered under `withTable(ZH)`, the
  fixture `screens-zh.json`; `--lang en` the default), `face/tests/client/words-golden.test.js`,
  `face/tests/client/words-probe.test.js`
- Test: `face/tests/client/owner-sheet*.test.js` (or the file that renders What you sign)

**Interfaces:**
- `goldenEntries()` unchanged; the writer and the test take the table: `withTable(tableOf(lang), () =>
  goldenEntries())` (the host-written lines in `hostCorpus` are rendered under it too).

- [ ] **Step 1: Write the failing tests:**
  - `words-golden.test.js`: `every screen state renders the bytes pinned in fixtures/screens-zh.json
    under ZH`; `fixtures/screens-en.json is the English golden, unchanged` (as today);
  - `words-probe.test.js`: `no English is drawn under ZH outside content`: render `corpus()` under ZH; every
    `/[A-Za-z]{2,}/` word in text and the read attributes must be in the known set (`corpusStrings`, the
    `en-kept` literals, the glossary's `keep`, `KEY_NAMES`); the report is empty — a hit is a word Tasks 1–6
    left outside the table, never an allowlist entry;
  - What you sign: `under ZH the sheet's frame is the table's and its shown lines are the Account's byte
    for byte` (Review Focus 5).
- [ ] **Step 2: Run them to see them fail.** Expected: FAIL, no `screens-zh.json`.
- [ ] **Step 3: Implement** `--lang`; pin `screens-zh.json` (`golden-write.js --lang zh --pin`); move what
  the probe reports into the table (its Chinese with it).
- [ ] **Step 4: Run** the golden twice more (stable), then `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** (`test(client): the Chinese golden and probe - every screen state under zh.js
  pinned, no English drawn outside content (plan 7 task 10)`).

### Task 11: The review dump

**Files:**
- Create: `face/tests/client/zh-review.js` (a script, not a test), `face/tests/client/zh-review.test.js`

**Interfaces:**
- `npx tsx tests/client/zh-review.js --out <dir>` writes:
  - `<dir>/zh-review.tsv`: a header `key	en	zh	states	fix`, one row per EN key in `en.js`'s order; a
    plural's `en` is `one | other`; `states` the corpus names that draw it (found by rendering the corpus
    under a marker table whose every value is `⟦<index>⟧`), or `—` for a key drawn only by host code; `fix`
    empty; tabs and newlines in a value written `\t` `\n`;
  - `<dir>/zh-review.html`: one standalone page (inline CSS, both themes, no script, no network), a
    section per area in the 29 areas' order, a row per key: the key, the English, the Chinese, and the
    states as links to `<dir>/states/<name>.zh.html` and `.en.html`, which it also writes (the corpus
    rendered under each table, wrapped in a page that links `face/client/css/tokens.css` and `app.css` by
    absolute path, so a state opens styled); the glossary first, as a table.
- `zh-review.test.js`: `the tsv has one row per key, in order, five columns`; `a key's states are the
  states that draw it` (a known key — `nav.messages` — lists Messages states); `a value with a tab or a
  newline survives the round trip`.

- [ ] **Step 1: Write the failing test;** run it. Expected: FAIL.
- [ ] **Step 2: Implement;** run it, then run the script into the scratchpad and open the HTML once.
- [ ] **Step 3: Commit** (`test(client): the 中文 review dump - every key, English beside Chinese, by
  area, with the states that draw it (plan 7 task 11)`).

### Task 12: The documents and the build notes

**Files:**
- Modify:
  - `DEVELOPMENT.md`: §5.1 (`i18n/zh.js`, `i18n/langs.js`), §5.4 (`said`/`sayOf` for state-held lines,
    the reorder rule, the Language row, `reword`), §5.5 (`lang` in `gravit-ui.prefs`; `<html lang>`),
    §7.3 (`words-zh`, the zh golden and probe, `zh-review`), §7.4 (the drill's 中文 step), §8 (the
    convention becomes D37's: a new word ships in `en.js` and `zh.js` at once, against the glossary; a line
    the store keeps is a `said`; no sentence joined in code order), R102 rewritten (a stored line now
    follows a switch; a switch re-reads the open conversation, dropping its earlier pages; an Account or
    dsh string stays as it came) and the 中文 residuals: the zh draft before the operator's pass; text
    wider or narrower than the layout planned for; per browser;
  - `face/README.md`: "The page (client/)" (the two tables, the switch); the dsh UI port drill gains
    step 25, the operator's, in Safari, Chrome and Firefox: Settings › Language › 中文 — every screen
    (Messages with a thread and Details, Markets with a market's page, Trade, Account's six tabs, an owner
    sheet with What you sign, Discover and a module page, a channel page, the desk) in Chinese with no
    English but names and content; a reload with no English frame; back to English;
  - `CLAUDE.md`: the `face/client/` line's clause names `js/i18n/zh.js` and Settings › Language;
  - `ROADMAP.md`: the built log;
  - the spec: `## 19. Build notes, plan 7`, in §18's form — the merge's SHA, the commits, the counts (a
    fresh `npm test` in `face/`), the table's key count in both languages, the golden counts, the rows
    of "Where the code differs" and "Where the spec leaves it" above among its clauses, and the operator's
    pass as owed (Task 13).
- [ ] **Step 1: Write the documents.**
- [ ] **Step 2: Commit** (`docs: the dsh UI port in 中文 - DEVELOPMENT, face/README, CLAUDE.md, ROADMAP
  and the spec's plan 7 build notes (plan 7 task 12)`).

### Task 13: The operator's correction pass (the operator's, D30)

The controller runs `zh-review.js --out <scratchpad>/zh-review` and gives the operator the absolute
paths of `zh-review.html` and `zh-review.tsv`. The operator reads the page in 中文 two ways:
- the review page, every key by area beside its English and the states that draw it;
- the live page on a scratch face, never 3090: in the operator's Terminal panel, from `face/`,
  `FACE_PORT=3091 DSH_HOME=<a scratch home> FACE_DESK=0 FACE_ACCOUNT_URL=http://127.0.0.1:9 npm start`
  (the Account address unreachable, so the page pairs no key with the real Account; its screens then
  show the not-answering state — to read them with data, the operator chooses whether to point the
  scratch face at their Account, question 5), Settings › Language › 中文.
The operator writes each correction into the TSV's `fix` column (or lists them in chat, key → words, and
the controller writes them in), and may change a glossary term (`zh-glossary.json`), which then holds
every key using it. Nothing else changes in the tree until the corrections come back.

### Task 14: The corrections applied (the plan's last commit)

**Files:**
- Create: `face/tests/client/zh-apply.js` (a script)
- Modify: `face/client/js/i18n/zh.js`, `face/tests/client/fixtures/zh-glossary.json` (if a term moved),
  `face/tests/client/fixtures/screens-zh.json`, `face/tests/client/zh-review.test.js`, the spec's §19

**Interfaces:**
- `npx tsx tests/client/zh-apply.js <tsv>`: for each row with a non-empty `fix`, the ZH value of `key`
  becomes `fix` (`\t` `\n` decoded); a key not in ZH, a `fix` whose params differ from EN's, or one the
  grammar refuses stops the run with every such row named and writes nothing; `zh.js` is rewritten in
  place, keys, order and comments kept, each value a single-quoted literal (`'` escaped); prints the keys
  changed.

- [ ] **Step 1: Write the failing test** in `zh-review.test.js`: `zh-apply writes a fix, keeps every other
  line byte for byte, and refuses a fix with other params` (over a copy of `zh.js` in a temporary
  directory under the scratchpad, never `/tmp`).
- [ ] **Step 2: Run it to see it fail;** implement; run it to see it pass.
- [ ] **Step 3: Apply** the operator's TSV; run `npx tsx --test tests/client/words-zh.test.js` — a moved
  glossary term lists every value to bring along: bring them, and show the operator that list.
- [ ] **Step 4: Re-pin the Chinese golden** for the states the corrections redraw (`golden-write.js --lang
  zh --pin --repin <the names it reports>`); the English golden untouched. Run `npm test && npm run
  typecheck`. Expected: PASS.
- [ ] **Step 5: Add §19's line** (how many keys the operator corrected, glossary terms moved, the drill's
  step 25 still owed or passed) and **commit** (`fix(client): zh.js - the operator's corrections (plan 7
  task 14, D30)`). Nothing is committed after it.

## Questions only the operator can answer

1. **Task 0's merge.** Merge local `main` (Slack in Identity, thirteen client and test files) into the
   branch before plan 7, as plan 6 did — or after, with Task 1's steps at that merge?
2. **The register.** `你` where a pronoun is needed (the draft), `您`, or none at all?
3. **Names in 中文.** `Account` (the nav tab, the screen's title and the service's name in sentences) and
   `Lunhui` (轮回?) — kept in Latin, or Chinese? And the nav words: 消息 · 行情 · 交易 · 发现 · 设置, or
   others (市场 for Markets)?
4. **The Account's codes on screen** (an open order's `pending`, `limit`, `open`, a limit's `payees`, a
   key's `ok`): worded in 中文 (the draft, Task 6), or left as the Account's content in both languages?
5. **The live reading.** On a scratch face with the Account unreachable (no pairing, empty Account
   screens), or pointed at the running Account (its screens with data, and the page asks to pair a new
   owner device)? And corrections by the TSV's `fix` column, or in chat?
