# Lunhui Module Cards — Plan 3 (Run) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Run key on a module card or its page opens a sheet, and Run sends Gravit one message in the chosen channel — a new conversation titled `<Module> · <date>` — so Gravit runs that module alone; the card reads Running until the artifact lands, then settles on the listing.

**Architecture:** A pure view `host/run-sheet-view.js` turns the modules listing into each card's sheet — Where, On, Cites, Stocks, Note, their greying and the Chinese message — and an impure `host/run-sheet.js` sends it through the client's existing `newConversation` (session/create → rename → prompt). A `moduleRuns` slice remembers the session each card started (mirrored in `localStorage` as a convenience); `host/modules.js` watches those sessions' `running` flag and re-reads the listing when one stops. No server change; Gravit acts on the message by the `lunhui:module` section plan 1 shipped.

**Tech Stack:** The face's browser client (ES modules, string renderers over a store), `node --test` with the fake DOM under `face/tests/client/`; no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-28-lunhui-module-cards-design.md` — §4 F2, F6, G1, G3, G5, G6, G10–G16, G18, G21; §5.4–§5.7, §5.9; §6; Appendix B; §11 plan 3. Plans 1 and 2 are merged on `main`; this plan builds on `host/modules-view.js` (`MODULES`, `latestOf`, `chipOf`, `researchItems`, `pageOf`), `host/modules.js` (`startModules`), `render/discover.js` (`researchCard`), `render/modules.js` and `host/actions.js` (`newConversation`).

## Global Constraints

- Branch from `main` after plan 2 is merged (`claude/lunhui-module-cards-plan-2-34dcd7` at 09d2eb4, or `main` once fast-forwarded).
- No server change; no change to any Lunhui row, contract, artifact, freeze, role or protocol file (plan 1 shipped `dsh/profile/lunhui-module.md`; it is not edited here).
- The message to Gravit is Chinese, from Appendix B's templates verbatim; every other string on screen is English (the modules' 副题 and the manuscript's own terms excepted).
- The face starts no role and calls no Lunhui tool: Run is `newConversation` and nothing else (spec F2, G6).
- `localStorage` is a per-browser convenience only: every read and write in `try`/`catch`, the page correct without it (spec G10).
- The client is served without cache headers and is verified by the fake-DOM tests; the live drill at the end is the operator's (it needs a DeepSeek key and the face run from the operator's terminal) — this plan writes its procedure and does not run it.
- `cd face && npm test && npm run typecheck` green before each commit. Commit messages: plain words, no backticks, no parentheses, no `$()`; a long message to a file and `git commit -F`. Work in your own worktree; never touch the operator's primary checkout.

## Review Focus

1. A Where whose channel has no run at all (`lunhui-s02-rotation`, `runs: []`) → Leader offers New run alone; Mode and Counterevidence grey their Latest run with `no run yet`; nothing throws (Task 1 test "a channel with no runs").
2. The listing moves while the sheet is open (a re-read lands with a newer latest run) → the options recompute from the store; a run the sheet had chosen that is no longer the channel's latest reads `run no longer the latest` and Run is disabled until On is chosen again (Task 2 test "the listing moves under an open sheet").
3. Stocks typed as `SH600000，sz000001 sh600000` (upper case, a Chinese comma, a duplicate) → normalised to `['sh600000', 'sz000001']`; `sz300750` and `600000` are named as not main-board / not a code (Task 1 test "stocksOf").
4. `session/create` answers but the rename or the prompt rejects → `newConversation` returns `null`, the sheet stays open with the line `Couldn't send — the conversation may exist untitled in the channel`, no running record is written (Task 2 test "a failed send keeps the sheet").
5. A running record whose session never appears in the list (the create failed after the record, or another browser's record) → cleared at the next tracker pass once it is 60 s old; a record 60 minutes old is cleared regardless (Task 3 test "stale records").

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `face/client/js/host/run-sheet-view.js` | create | `newSheet`, `sheetOf`, `stocksOf`, `titleOf`, `messageOf`, `canRun` — pure |
| `face/client/js/host/run-sheet.js` | create | `startRunSheet`: open, set a field, close, run (through `newConversation`) — impure |
| `face/client/js/render/run-sheet.js` | create | `renderRunSheet(state)`: the drawer |
| `face/client/js/reducers/run-sheet.js` | create | `runSheetOpen`, `runSheetSet`, `runSheetSaid`, `runSheetClose`, `moduleRunStarted`, `moduleRunCleared`, `moduleRunsLoaded` |
| `face/client/js/host/modules-view.js` | modify | `chipOf` and `researchItems` take the active runs; `activeRuns(moduleRuns, conversations, now)` |
| `face/client/js/host/modules.js` | modify | `trackRuns` beside `latestArtifact`; the `localStorage` mirror |
| `face/client/js/render/discover.js`, `render/modules.js` | modify | the Run key enabled; the live chip as a link |
| `face/client/js/app.js`, `data/empty.js`, `reducers/index.js` | modify | the layer, the actions, Escape, the drawer, the slices |
| `face/client/css/app.css` | modify | `.chip.live`, the sheet's option rows |
| `face/tests/client/run-sheet-view.test.js`, `host-run-sheet.test.js` | create | Tasks 1 and 2 |
| `face/tests/client/modules-view.test.js`, `host-modules.test.js`, `app-dom.test.js`, `host-reducers.test.js`, `css.test.js` | modify | Tasks 2 and 3 |
| `face/tests/gravit-client-smoke.test.ts` | modify | the three new client modules served |
| `face/README.md`, `DEVELOPMENT.md`, `CLAUDE.md`, `Gravit-Docs-and-Prompt-Loops.html`, the spec (build notes) | modify | Task 4 |

---

### Task 1: The sheet's pure view

**Files:**
- Create: `face/client/js/host/run-sheet-view.js`
- Test: `face/tests/client/run-sheet-view.test.js` (create; `modulesListing()` from `helpers/inventory.js`)

**Interfaces:**
- Consumes: `MODULES`, `moduleOf`, `latestOf` from `host/modules-view.js`; the listing shape of `/data/modules.json`.
- Produces (exported, pure):
  - `newSheet(listing, module)` → the slice's initial value or `null` for an unknown module: `{ module, where, on, cites, stocks: '', note: '', said: null }` with `where` the preselected channel (`cn-market` for a market module; for Leader and Mode the channel of `latestOf(listing, module)` else the first strategy channel; for Counterevidence the channel of `latestOf`, else `cn-market`), `on` the preselected option id (`'latest'` when enabled, else `'new'` when the card has one, else `null`), `cites` the preselected market run id (Leader: the newest sealed `cn-market` run; the others `null`).
  - `sheetOf(listing, sheet)` → the render model:
    `{ title: 'Run <Title>', where: { options: [{ value, label }], value, fixed: boolean }, on: { options: [{ id: 'latest'|'new', label, detail, enabled, reason }], value }, cites: null | { readOnly: boolean, options: [{ value, label, warning }], value, line }, stocks: null | { value, error, hint }, source: null | string, note: { value }, via: string, writes: string, canRun: boolean, blocker: string | null }`.
    - **Where**: market modules → `cn-market` alone, `fixed: true`; Leader and Mode → every channel of kind `strategy`, in the listing's order; Counterevidence → `cn-market` first, then the strategies.
    - **On**, from the chosen channel's `runs[0]` (`latest`):
      - market modules: `latest` label `Latest run · <run> · session <session | opened date>`, detail `frozen: <frozen joined ' · '>`, enabled unless the run holds the module's artifact (reason `<module> already there`); `new` label `New run`, detail `Gravit freezes index · limit-up · boards, then the CN market analyst writes <Title> alone; the other two market modules stay not run on that run until run from their cards`, always enabled; no run at all → `latest` absent.
      - Leader: `latest` of the strategy, enabled unless it holds `leader` (reason `leader already there`); `new` detail `Gravit freezes quotes for the stocks, which opens the run`.
      - Mode: `latest` only; enabled when the run's artifacts hold `leader` and `counterevidence` and not `mode`; reasons `needs Leader, then Counterevidence, on this run` / `mode already registered on this run` / `no run yet`.
      - Counterevidence: `latest` only; `cn-market`: enabled when at least one of environment, sentiment, theme is present and `counterevidence` is not; detail `reviews: <present modules joined ' · '>` plus ` — <missing titles> not run on this run` when any is missing; reason `no market artifact yet on this run` / `review already there`; a strategy: enabled when `leader` is present and `counterevidence` is not; detail gains `warning: mode already registered on this run — this review would go unanswered` when `mode` is present.
    - **Cites**: Leader → the two newest `cn-market` runs with `sealedAt` set, newest first, labels `<run> · session <session> · frozen: <…> · theme <words>` where `<words>` is `headlineWords` for an OK theme, `not evaluable` otherwise, `not run` when absent; `line` = `theme not evaluable: the pick comes from the limit-up pool alone` when the chosen cite's theme is `NOT_EVALUABLE`; each option's `warning` = `Mode and Counterevidence on this cite would be not evaluable` when the run lacks a sentiment or theme artifact. Mode and strategy-Counterevidence → `readOnly: true`, the one option = the chosen run's `artifacts.leader.marketRun` (label `<run> · the run's leader cites it`), and when that is null `blocker` = `the run's leader names no market run`. Market modules and `cn-market`-Counterevidence → `null`.
    - **Stocks**: Leader only — `{ value, error: stocksOf(value).error, hint: 'optional · 1–4 main-board codes, sh60… or sz00…; empty: Gravit picks from the cited run's mainline members and pool; a code outside them is REFERENCE at the contract' }`.
    - **Source**: Theme only — among `cn-market`'s listed runs, those whose `frozen` lacks `boards`: `boards missing in the last run` / `… in the last <n> runs` when all of them lack it, `boards missing in <n> of the last <m> runs` otherwise, `null` when none lacks it or there are no runs.
    - **via** `Gravit in <where> → <role>, <name> alone`; **writes** `<file> · a conversation "<Title> · <date>"` (the date as `titleOf` gives it).
    - **canRun**: `where` chosen, `on` chosen and enabled, Leader's `new` with a cite chosen, a read-only cite present, Stocks error-free; else `blocker` names the first failing one.
  - `stocksOf(text)` → `{ codes: string[], error: string | null }`: split on whitespace, `,`, `，`, `、`; lower-cased; each must match `^(sh60|sz00)\d{4}$` — otherwise error `not a main-board code: <token>` (the first offender); duplicates folded; more than four → error `at most 4 codes`; empty text → `{ codes: [], error: null }`.
  - `titleOf(listing, sheet, now)` → `<Title> · MM-DD`: for `on === 'latest'` the chosen run's `session` (its `MM-DD`), falling back to the opened date; for `new` the browser's local date from `now` (a `Date` or epoch ms).
  - `messageOf(listing, sheet)` → Appendix B's text with the slots filled, the Note appended as `\n备注：<note>` when non-blank.

- [ ] **Step 1: Write the failing tests** in `face/tests/client/run-sheet-view.test.js` (the fixture day: `modulesListing()`; a `fixed` `now` = `Date.UTC(2026, 9, 28, 14, 0)`):

```js
test('newSheet: the preselections per card', () => {
  const l = modulesListing();
  assert.deepEqual(newSheet(l, 'theme'), { module: 'theme', where: 'cn-market', on: 'new', cites: null, stocks: '', note: '', said: null }, 'theme.json is there, so New run');
  assert.equal(newSheet(l, 'sentiment').on, 'new');
  assert.deepEqual(newSheet(l, 'leader'), { module: 'leader', where: 'lunhui-s01-repair', on: 'new', cites: MARKET_RUN, stocks: '', note: '', said: null });
  assert.equal(newSheet(l, 'mode').on, null, 'mode is already registered: nothing selectable');
  assert.equal(newSheet(l, 'counterevidence').where, 'lunhui-s01-repair', 'the newest review run is the strategy\'s');
  assert.equal(newSheet(l, 'nope'), null);
});

test('sheetOf: a market card — Where fixed, Latest run greyed with its reason, New run preselected with the whole-set line', () => {
  const v = sheetOf(l, newSheet(l, 'theme'));
  assert.deepEqual(v.where, { options: [{ value: 'cn-market', label: 'cn-market' }], value: 'cn-market', fixed: true });
  assert.deepEqual(v.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'theme already there'], ['new', true, null]]);
  assert.match(v.on.options[0].label, /Latest run · 20261028T020953Z-f3b89ce6 · session 2026-10-28/);
  assert.equal(v.on.options[0].detail, 'frozen: index · limit-up');
  assert.match(v.on.options[1].detail, /writes Theme alone; the other two market modules stay not run/);
  assert.equal(v.source, 'boards missing in the last run', 'the fixture run froze no boards');
  assert.equal(v.cites, null); assert.equal(v.stocks, null);
  assert.equal(v.canRun, true);
});

test('sheetOf: a market card whose latest run lacks the artifact offers Latest run enabled', () => { /* drop sentiment from the fixture run → on.options[0].enabled true, on preselected latest */ });

test('sheetOf: Leader — Where the strategies, Cites the two newest sealed market runs with the theme line, Stocks optional', () => {
  const v = sheetOf(l, newSheet(l, 'leader'));
  assert.deepEqual(v.where.options.map(o => o.value), ['lunhui-s01-repair', 'lunhui-s02-rotation']);
  assert.deepEqual(v.on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'leader already there'], ['new', true, null]]);
  assert.equal(v.cites.readOnly, false);
  assert.deepEqual(v.cites.options.map(o => o.value), [MARKET_RUN]);
  assert.match(v.cites.options[0].label, /theme not evaluable/);
  assert.equal(v.cites.line, 'theme not evaluable: the pick comes from the limit-up pool alone');
  assert.equal(v.cites.options[0].warning, null, 'sentiment and theme are both there');
  assert.equal(v.stocks.error, null);
  assert.equal(v.canRun, true);
});

test('sheetOf: a channel with no runs — Leader New run alone; Mode and Counterevidence grey with no run yet', () => {
  const s = { ...newSheet(l, 'leader'), where: 'lunhui-s02-rotation' };
  assert.deepEqual(sheetOf(l, s).on.options.map(o => o.id), ['new']);
  const m = { ...newSheet(l, 'mode'), where: 'lunhui-s02-rotation', on: null };
  assert.deepEqual(sheetOf(l, m).on.options.map(o => [o.id, o.enabled, o.reason]), [['latest', false, 'no run yet']]);
  assert.equal(sheetOf(l, m).canRun, false);
});

test('sheetOf: Mode — Latest run only, its three reasons, the read-only cite', () => {
  // the fixture run holds leader, counterevidence and mode → reason 'mode already registered on this run'
  // without mode → enabled, cites { readOnly: true, options: [{ value: MARKET_RUN, label: /the run's leader cites it/ }], value: MARKET_RUN }
  // without counterevidence → reason 'needs Leader, then Counterevidence, on this run'
  // leader.marketRun null → blocker "the run's leader names no market run", canRun false
});

test('sheetOf: Counterevidence — cn-market reviews line and names the modules not run; a strategy warns when mode is there', () => {
  // cn-market with the fixture (environment, sentiment, theme present, counterevidence present) → enabled false, reason 'review already there'
  // cn-market without counterevidence and without theme → enabled true, detail 'reviews: environment · sentiment — Theme not run on this run'
  // the strategy run (leader, counterevidence, mode) → reason 'review already there'; without counterevidence → enabled, detail contains 'warning: mode already registered on this run'
});

test('stocksOf: normalises, folds duplicates, names the first offender, caps at four', () => {
  assert.deepEqual(stocksOf('SH600000，sz000001 sh600000'), { codes: ['sh600000', 'sz000001'], error: null });
  assert.deepEqual(stocksOf('sz300750'), { codes: [], error: 'not a main-board code: sz300750' });
  assert.deepEqual(stocksOf('600000'), { codes: [], error: 'not a main-board code: 600000' });
  assert.deepEqual(stocksOf('sh600000、sh600001、sh600002、sh600003、sh600004').error, 'at most 4 codes');
  assert.deepEqual(stocksOf('  '), { codes: [], error: null });
});

test('titleOf: the run\'s session for a latest run, the browser\'s date for a new one', () => {
  assert.equal(titleOf(l, { ...newSheet(l, 'leader'), on: 'latest' }, fixed), 'Leader · 10-28');
  assert.equal(titleOf(l, newSheet(l, 'theme'), new Date('2026-10-29T03:00:00+08:00')), 'Theme · 10-29');
});

test('messageOf: Appendix B, slot by slot', () => {
  assert.equal(messageOf(l, { ...newSheet(l, 'theme'), on: 'new' }), '请只跑 Lunhui 的 theme 模块：频道 cn-market，开新运行——先按 lunhui:run 第 1 步冻结整套（index、limit-up、boards），再只写 theme。');
  assert.equal(messageOf(l, { ...newSheet(l, 'sentiment'), on: 'latest' }), `请只跑 Lunhui 的 sentiment 模块：频道 cn-market，运行 ${MARKET_RUN}（已有运行，不要再冻结）。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'leader'), on: 'new', stocks: 'sh600000 sz000001' }), `请只跑 Lunhui 的 leader 模块：策略 lunhui-s01-repair，开新运行，引用 cn-market 运行 ${MARKET_RUN}；股票 sh600000、sz000001。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'leader'), on: 'new' }), `请只跑 Lunhui 的 leader 模块：策略 lunhui-s01-repair，开新运行，引用 cn-market 运行 ${MARKET_RUN}；股票 由你从该市场运行的主线成分股与涨停池里选 1–4 只主板个股。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'leader'), on: 'latest' }), `请只跑 Lunhui 的 leader 模块：策略 lunhui-s01-repair，运行 ${S01_RUN}（已有运行），引用 cn-market 运行 ${MARKET_RUN}。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'counterevidence'), where: 'cn-market', on: 'latest' }), `请只跑 Lunhui 的 counterevidence 模块：频道 cn-market，运行 ${MARKET_RUN}（已有运行）。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'counterevidence'), on: 'latest' }), `请只跑 Lunhui 的 counterevidence 模块：策略 lunhui-s01-repair，运行 ${S01_RUN}（已有运行），引用 cn-market 运行 ${MARKET_RUN}。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'mode'), on: 'latest' }), `请只跑 Lunhui 的 mode 模块：策略 lunhui-s01-repair，运行 ${S01_RUN}（已有运行），引用 cn-market 运行 ${MARKET_RUN}。`);
  assert.equal(messageOf(l, { ...newSheet(l, 'theme'), on: 'new', note: ' boards 再失败就报 ' }), '请只跑 Lunhui 的 theme 模块：频道 cn-market，开新运行——先按 lunhui:run 第 1 步冻结整套（index、limit-up、boards），再只写 theme。\n备注：boards 再失败就报');
});
```

(`MARKET_RUN` and `S01_RUN` are the fixture's two run ids, exported from `helpers/inventory.js` if not already.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/client/run-sheet-view.test.js`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `face/client/js/host/run-sheet-view.js`** per the Interfaces; the templates as string constants at the top of the file, one per Appendix B line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/client/run-sheet-view.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add face/client/js/host/run-sheet-view.js face/tests/client/run-sheet-view.test.js face/tests/client/helpers/inventory.js
git commit -m "feat: the run sheet as a pure view, each module card's fields, greying, stocks check, title and message"
```

---

### Task 2: The sheet opens, fills, and sends one message

**Files:**
- Create: `face/client/js/host/run-sheet.js`, `face/client/js/render/run-sheet.js`, `face/client/js/reducers/run-sheet.js`
- Modify: `face/client/js/reducers/index.js` (the slice joins the table), `face/client/js/data/empty.js` (`runSheet: null`, `moduleRuns: {}`), `face/client/js/app.js` (the layer, the actions, Escape, the drawer), `face/client/js/render/discover.js` and `render/modules.js` (the Run key enabled), `face/client/css/app.css`
- Test: `face/tests/client/host-run-sheet.test.js` (create), `face/tests/client/host-reducers.test.js`, `face/tests/client/app-dom.test.js`, `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 1's view; `actions.newConversation({ title, workspaceId, text })` → the session id or `null`; `discover.read('modules')`; `go(route)` in `app.js`.
- Produces:
  - `reducers/run-sheet.js`: `runSheetOpen(s, sheet)` sets `s.runSheet = sheet` (and closes the other overlays as `startDraft` does); `runSheetSet(s, sheet)` replaces the sheet whole — the host recomputes it on every field change (a `where` change resets `on` and `cites` to `newSheet`'s picks for that channel, `stocks` and `note` kept); `runSheetSaid(s, { line })` sets `s.runSheet.said`; `runSheetClose(s)` sets `null`; `moduleRunStarted(s, { module, sessionId, title, startedAt })`, `moduleRunCleared(s, { module })`, `moduleRunsLoaded(s, { runs })` on `s.moduleRuns`.
  - `host/run-sheet.js`: `startRunSheet({ store, actions, readListing, go, now = Date.now })` → `{ open(module), field(name, value), close(), run() }`: `open` awaits `readListing()`, dispatches `runSheetOpen(newSheet(listing, module))` (a null sheet → `discoverStatus` `Not a module`); `field` recomputes (`where` → `newSheet` for the new channel keeping `stocks` and `note`) and dispatches; `run` — when `sheetOf(...).canRun`: `title = titleOf`, `text = messageOf`, `workspaceId` = the chosen channel's `workspaceId` from the listing; `const id = await actions.newConversation({ title, workspaceId, text })`; `null` → `runSheetSaid({ line: "Couldn't send — the conversation may exist untitled in the channel" })` and the sheet stays; else `moduleRunStarted({ module, sessionId: id, title, startedAt: now() })`, `runSheetClose`, `go({ screen: 'messages', id })`.
  - `render/run-sheet.js`: `renderRunSheet(state)` → `''` without a sheet, else a drawer in the owner sheet's chrome: `<div class="drawer sheet run-sheet" role="dialog" aria-label="Run <Title>">`, `.drawer-head` with `<h2>Run <Title></h2>` and a close key (`data-action="runSheetCancel"`), `.drawer-body` with: Where as a `<select class="input" name="where" data-action="runSheetField">` (disabled when `fixed`); On as a radio group — one `<label class="opt [on|off]">` per option with `<input type="radio" name="on" value=<id> [checked] [disabled] data-action="runSheetField">`, the label, the detail or the reason; Cites as a select (or a read-only line) with the `line` and the chosen option's `warning` under it; Stocks as `<input class="input" name="stocks">` with the hint and the error in red; the Theme `source` line; Note as `<textarea class="textarea" name="note" rows="3">`; a `kv` with `Runs via` / `Writes`; `said` as a red line; `.btn-row` with Cancel (`runSheetCancel`) and `Run` (`btn-primary`, `data-action="runSheetRun"`, `disabled` unless `canRun`, `title` = `blocker` when disabled).
  - `app.js`: `const runSheet = startRunSheet({ store, actions, readListing: …(as modules uses)…, go, now })`; actions `runModule: el => { void runSheet.open(el.dataset.module); }`, `runSheetField: el => runSheet.field(el.name, el.type === 'radio' ? el.value : el.value)` (the change event's target), `runSheetCancel: () => runSheet.close()`, `runSheetRun: () => { void runSheet.run(); }`; Escape closes the run sheet first (before `sheetUp`); the drawer is appended inside `<main>` like the owner sheet's (`drawers += s.runSheet ? renderRunSheet(s) : ''`), and `overlayOf` / `drawerOf` count it so focus moves into it when it opens.
  - `render/discover.js` and `render/modules.js`: the Run key loses `disabled` and its title; it is disabled only when `item.dim` (rows not mounted) or the card is Running (Task 3); `researchCard` keeps `data-action="runModule" data-module=<name>`.

- [ ] **Step 1: Write the failing tests**

`host-run-sheet.test.js` (a rig with a store, a fake `actions.newConversation` recording its argument and answering `'s-run'` or `null`, `readListing` answering `modulesListing()`, `go` recording):

```js
test('open: reads the listing and opens the module\'s sheet with its preselections; an unknown module says so', async () => { /* runSheet.open('theme') → store.get().runSheet deepEqual newSheet(listing, 'theme'); open('nope') → discover.status.line 'Not a module', runSheet null */ });
test('field: where resets on and cites for the new channel, stocks and note stay', async () => { /* open leader; field('stocks', 'sh600000'); field('where', 'lunhui-s02-rotation') → on 'new', cites MARKET_RUN, stocks 'sh600000' */ });
test('run: sends one conversation with the title, the channel\'s workspaceId and the message, records the run, closes, navigates', async () => {
  // open theme (on 'new'); run() → newConversation called once with { title: 'Theme · <MM-DD of now>', workspaceId: 'ws-cn-market', text: <Appendix B new-run theme line> }
  // moduleRuns.theme = { sessionId: 's-run', title, startedAt: now }; runSheet null; go called with { screen: 'messages', id: 's-run' }
});
test('run: a failed send keeps the sheet with the line and writes no record', async () => { /* newConversation → null: runSheet.said line "Couldn't send — the conversation may exist untitled in the channel", moduleRuns {} , go not called */ });
test('run: refused while the sheet cannot run', async () => { /* mode on the fixture (on null) → run() sends nothing, said the blocker */ });
test('the listing moves under an open sheet: a chosen latest run that is no longer the latest disables Run with its reason', async () => { /* open sentiment with on 'latest' (fixture without sentiment); readListing now answers a listing whose cn-market runs[0] is a newer run; field('note','x') recomputes → sheetOf(...).canRun false, blocker 'run no longer the latest' */ });
```

`app-dom.test.js`:

```js
test('Run on a card opens the sheet; Escape closes it; Run sends the message, the page moves to the new conversation', async () => {
  // boot at '#/discover'; click { action: 'runModule', module: 'theme' }; settle → html has 'role="dialog" aria-label="Run Theme"', the option 'theme already there' disabled, 'New run' checked, the source line, the message's 'Runs via'
  // fire keydown Escape → the dialog is gone; open again; click { action: 'runSheetRun' } → h.calls carry ['session/create', { request: { workspaceId: 'ws-cn-market' } }], a 'session/rename' with title 'Theme · <date>', and the prompt call with the Appendix B text (as the existing 'a new message creates the session…' test reads them); route is messages/s-new; moduleRuns.theme.sessionId === 's-new'
});
```

`host-reducers.test.js`: the seven reducers' shapes. `css.test.js`: `run-sheet`, `opt`, `chip live`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/client/host-run-sheet.test.js tests/client/app-dom.test.js tests/client/host-reducers.test.js tests/client/css.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** the files and changes under Produces. The `workspaceId` comes from the listing's channel row for the chosen `where`; the `prompt` of `newConversation` is `actions.js`'s own (session/prompt), untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/client/*.test.js && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add face/client/js/host/run-sheet.js face/client/js/render/run-sheet.js face/client/js/reducers/run-sheet.js face/client/js/reducers/index.js face/client/js/data/empty.js face/client/js/app.js face/client/js/render/discover.js face/client/js/render/modules.js face/client/css/app.css face/tests/client/host-run-sheet.test.js face/tests/client/host-reducers.test.js face/tests/client/app-dom.test.js face/tests/client/css.test.js
git commit -m "feat: Run on a module card opens its sheet and sends Gravit one message in the channel as a new conversation"
```

---

### Task 3: Running, then landed

**Files:**
- Modify: `face/client/js/host/modules-view.js` (`activeRuns`, `chipOf`'s and `researchItems`'s active argument), `face/client/js/host/modules.js` (`trackRuns`, the `localStorage` mirror), `face/client/js/app.js` (the tracker started with the live layer's timers; the mirror loaded at boot), `face/client/js/render/discover.js` and `render/modules.js` (the live chip as a link, Run disabled while running), `face/client/css/app.css` (`.chip.live`)
- Test: `face/tests/client/modules-view.test.js`, `host-modules.test.js`, `app-dom.test.js`

**Interfaces:**
- Consumes: `moduleRuns` and `conversations` (`running`, `id`) from the store; `discover.read('modules', { fresh: true })`; `timers.after(ms, fn)` as `host/live.js` uses it; `storage` as `app.js` resolves `win.localStorage` (`null` when it throws).
- Produces:
  - `activeRuns(moduleRuns, conversations, now)` → `{ [module]: { sessionId, title } }` for records whose conversation exists with `running === true`, or whose record is younger than 60 s (the create just happened); nothing else.
  - `chipOf(listing, module, mounted = true, active = null)` → with `active`: `{ text: 'Running · <title>', tone: 'live', href: '#/messages/<sessionId>' }`; `researchItems(listing, mounted, actives = {})` passes `actives[m.name]` and sets `item.running = Boolean(actives[m.name])`; `pageOf(listing, module, mounted, actives = {})` likewise.
  - `host/modules.js`: `startModules({ store, postJson, readListing, refreshListing = async () => {}, timers = null, storage = null, now = Date.now })` — the three new arguments optional, so plan 2's `host-modules.test.js` rig still constructs it — keeps `latestArtifact` and adds `trackRuns()`: a `store.subscribe` pass (guarded against re-entry) that, for each record in `moduleRuns`: clears it when older than 60 minutes; when its conversation is missing and the record is older than 60 s, clears it and calls `refreshListing()`; when its conversation has `running === false` and the record is older than 60 s, clears it, calls `refreshListing()` now and once more after 5 s (`timers.after(5000, …)`). Every change of `moduleRuns` is mirrored to `storage` under `gravit-face.module-runs` as JSON (`try`/`catch`); at boot `moduleRunsLoaded` from the same key when it parses to the shape (`{ [module]: { sessionId: string, title: string, startedAt: number } }`), else `{}`.
  - Rendering: a live chip is `<a class="chip live" href=…>Running · <title> ›</a>`; the card's and the page's Run key is `disabled` while running (`title="Running"`).

- [ ] **Step 1: Write the failing tests**

`modules-view.test.js`:

```js
test('activeRuns: running, or younger than a minute; chipOf and researchItems read it', () => {
  const now = 1_000_000;
  const runs = { theme: { sessionId: 's-a', title: 'Theme · 10-28', startedAt: now - 120_000 }, leader: { sessionId: 's-b', title: 'Leader · 10-28', startedAt: now - 10_000 }, mode: { sessionId: 's-c', title: 'Mode · 10-28', startedAt: now - 120_000 } };
  const convs = [{ id: 's-a', running: true }, { id: 's-c', running: false }];
  assert.deepEqual(activeRuns(runs, convs, now), { theme: { sessionId: 's-a', title: 'Theme · 10-28' }, leader: { sessionId: 's-b', title: 'Leader · 10-28' } });
  assert.deepEqual(chipOf(modulesListing(), 'theme', true, { sessionId: 's-a', title: 'Theme · 10-28' }), { text: 'Running · Theme · 10-28', tone: 'live', href: '#/messages/s-a' });
  const items = researchItems(modulesListing(), true, activeRuns(runs, convs, now));
  assert.equal(items.find(i => i.id === 'module:theme').running, true);
  assert.equal(items.find(i => i.id === 'module:mode').running, false);
});
```

`host-modules.test.js`:

```js
test('trackRuns: a session that stops clears its record and re-reads the listing now and 5 s later', async () => { /* a record 2 min old, conversations with running true → nothing; flip to false → moduleRuns cleared, refreshListing called once, timers hold one 5000 ms call; run it → called twice */ });
test('trackRuns: stale records — a missing session after 60 s, any record after 60 minutes', async () => { /* … */ });
test('the mirror: records are written to storage on change and read back at boot; a throwing storage changes nothing', async () => { /* storage.setItem throws → no throw, store still updated; getItem returns garbage → {} */ });
```

`app-dom.test.js`:

```js
test('after Run the card reads Running and links to the conversation; when the session stops the listing is re-read and the chip settles', async () => {
  // Run theme as Task 2's test does; back to '#/discover': the theme card holds 'chip live' with 'Running · Theme · ' and href '#/messages/s-new', its Run key disabled
  // advance: h.rows s-new running false (the host rig's rows), trigger a list refresh (the mux onEvent / live.refresh as other tests do), move the clock past 60 s; settle → '/data/modules.json' read again (count +1), moduleRuns.theme gone, the chip back to the listing's words
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/client/modules-view.test.js tests/client/host-modules.test.js tests/client/app-dom.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** per Produces. In `app.js`, `startModules` gains `refreshListing: () => discover.read('modules', { fresh: true })`, `timers` (the app's `Timers` instance the live layer uses), `storage`; `modules.trackRuns()` is started right after the store subscribes to render.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/client/*.test.js && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add face/client/js/host/modules-view.js face/client/js/host/modules.js face/client/js/app.js face/client/js/render/discover.js face/client/js/render/modules.js face/client/css/app.css face/tests/client/modules-view.test.js face/tests/client/host-modules.test.js face/tests/client/app-dom.test.js
git commit -m "feat: a module card reads Running while its conversation runs and settles on the listing when it stops"
```

---

### Task 4: The documents, the drill procedure, the suites, the build note

**Files:**
- Modify: `face/tests/gravit-client-smoke.test.ts` (served modules: `/client/js/host/run-sheet-view.js`, `/client/js/host/run-sheet.js`, `/client/js/render/run-sheet.js`), `face/README.md` ("Discover": the Run paragraph replaces "Run is disabled until plan 3"; "Lunhui analysis": a new subsection **The card drill** after the strategy run's steps), `DEVELOPMENT.md` (§5.1 the three files; §5.3 `startRunSheet`, `trackRuns`; §5.4 the sheet and the live chip; §5.5 `runSheet`, `moduleRuns`; §7.3 the tests; §7.4 a drill row **Module cards** — manual, owed), `CLAUDE.md` (the `face/client/` line: "… a Research shelf of the six Lunhui modules with a page each and Run, which sends Gravit one message in the channel"), `Gravit-Docs-and-Prompt-Loops.html` (loop 1's first station gains one line: a card's Run is the same `session/create` + prompt the composer sends, the message from Appendix B, read by the `lunhui:module` section), the spec (a "Build notes, plan 3" section)

- [ ] **Step 1: Write the card drill** in `face/README.md` under "Lunhui analysis", after the strategy run's steps, titled **The card drill** (run after any change under `face/client/js/host/modules*.js`, `run-sheet*.js` or `dsh/profile/lunhui-module.md`; keyed, the face from the operator's terminal):

1. Discover → Research: six cards, the chips reading the latest runs (`not evaluable · boards` on Theme on a day boards failed). Open Theme's page: the three boxes, the runs table, the latest artifact.
2. Theme → Run: Where `cn-market` fixed, Latest run greyed `theme already there`, New run checked, the source line counting the boards failures. Run. Expected: a conversation `Theme · <MM-DD>` in `cn-market` whose first message is Appendix B's new-run line; Gravit freezes index, limit-up, boards (three tries if it fails), calls the CN market analyst for theme alone, reports; the card reads `Running · Theme · <MM-DD> ›` meanwhile and settles on the new run's chip when the session stops; on disk exactly one artifact, `theme.json`, in the new run; the Environment and Sentiment cards now read `not run`.
3. Environment → Run on that run (Latest run enabled, New run not preselected) and Sentiment likewise: two more conversations; the run now holds three artifacts; the chips show them.
4. Leader → Run: Where `lunhui-s01-repair`, New run, Cites the run from step 2 (the theme line says whether the pick is from the pool alone), Stocks two codes from that run's `evidence-limit-up.json`. Expected: a conversation `Leader · <MM-DD>` in the strategy channel, `lunhui_freeze_quotes` for the two codes, the stock analyst for leader alone, `leader.json` alone in the new strategy run; the card names the strategy.
5. Counterevidence → Run: Where `lunhui-s01-repair`, Latest run enabled (leader there, no review), the cite read-only. Expected: `counterevidence.json` lands; the card reads `lunhui-s01-repair · <n> items`.
6. Mode → Run: Latest run enabled now (leader and counterevidence there). Expected: `mode.json` (WAIT in all likelihood); Run then greys `mode already registered on this run`.
7. The fences: Mode on a run without a review → the sheet greys with `needs Leader, then Counterevidence, on this run`; a second Theme Run on today's run → `theme already there`; Stocks `sz300750` → the error line, Run disabled.
8. The runs card on each channel page agrees with the cards; the journal gained a dated line for any `NOT_EVALUABLE`.

Record the outcome under the drill (date, run ids, what differed), as the two Lunhui drills record theirs.

- [ ] **Step 2: Update the other documents** as the Files line says; in DEVELOPMENT §7.4 the row reads `| **Module cards** — manual (face/README.md "The card drill") | Run on each card sends one message, Gravit runs that module alone, the chips move from Running to the listing, the fences grey | nothing about a second browser; the Gate-free path (no Account write) | owed: the operator's keyed run after plan 3 lands |`.

- [ ] **Step 3: Run the suites**

Run: `cd face && npm test && npm run typecheck && FACE_SMOKE=1 npx tsx --test tests/gravit-client-smoke.test.ts`
Expected: every test passes, `tsc` silent, the smoke green.

- [ ] **Step 4: Write the build note** — "## 14. Build notes, plan 3 (2026-10-2x)" in the spec: the commits, the decisions the plan left open that were made (the drawer's markup, the date word, the tracker's intervals if changed), the drill owed, and nothing else.

- [ ] **Step 5: Commit**

```bash
git add face/tests/gravit-client-smoke.test.ts face/README.md DEVELOPMENT.md CLAUDE.md Gravit-Docs-and-Prompt-Loops.html docs/superpowers/specs/2026-10-28-lunhui-module-cards-design.md
git commit -m "docs: plan 3 build notes, the card drill, the client smoke serves the run sheet, the map and the loops page name Run"
```
