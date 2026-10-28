# Lunhui Module Cards — Plan 2 (The Research Shelf and the Module Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover shows a Research shelf of six Lunhui module cards, each with today's headline from the listing plan 1 built, and each card opens its own page `#/module/<name>`; the Run key is drawn but disabled until plan 3.

**Architecture:** The client's Discover layer gains a fifth listing (`/data/modules.json`) and a pure view module, `host/modules-view.js`, that owns the six modules' static table and turns the listing into cards, chips and page rows; `render/discover.js` draws the shelf, a new `render/modules.js` the page, and a small impure `host/modules.js` reads the latest artifact's JSON through the existing channel overview. No server change; nothing Gravit sees changes.

**Tech Stack:** The face's browser client (ES modules, string renderers over a store, no framework), `node --test` with the fake DOM under `face/tests/client/`, tsx for the two `.ts` tests; no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-28-lunhui-module-cards-design.md` — §4 F1, F3, G2, G7, G9, G17, G19, G20; §5.1, §5.3, §5.8; §6; Appendix A; §11 plan 2. Plan 1 (`…-plan-1-backend.md`) built the listing this plan reads; plan 3 adds Run.

## Global Constraints

- Branch from `main` after plan 1 is merged (its branch `claude/lunhui-module-cards-plan-1-b5dbd0`, or `main` once fast-forwarded): the listing's shape is plan 1's `ModulesChannel` / `ModuleRunRow` in `face/src/channels.ts`.
- No server change in this plan; no contract, row, artifact or role change (spec F4).
- Product copy on screen in English; Chinese only inside the six cards' 副题 strings and the manuscript's own terms; the manuscript cited by paragraph id only, never its text (Appendix A is the source of every legend).
- The client is served with no cache headers; every client edit is verified with the fake-DOM tests, not by eye; `cd face && npm test && npm run typecheck` green before each commit.
- Static strings the six cards share with the server live in ONE client table (`host/modules-view.js` `MODULES`) and a test pins it in step with `face/src/channels.ts` `MODULE_HEADLINES`, `face/plugins/lunhui/lib/modules.mjs` and the roles' `role.yml` names.
- Commit messages: plain words, no backticks, no parentheses, no `$()`; a long message goes to a file and `git commit -F`. Work in your own worktree; never touch the operator's primary checkout.

## Review Focus

1. A listing whose `channels` is empty, or where `cn-market` is missing → the market cards read `no run yet`, nothing throws (Task 1 test "an empty listing: six cards, every chip no run yet").
2. A run whose artifact headline carries the wrong types — `mainline_candidates` not an array, `items` missing, `mode` not a string, `top_pattern_flags` empty — → the words degrade (`0 candidates`, `0 items`, the module's name alone), never `undefined` or a throw (Task 1 test "malformed headlines read as empty counts and names, never undefined").
3. `mounted: false` with runs present → the cards still show their last headline but dim, with the line `rows not mounted` and Run disabled (Task 2 test "rows not mounted").
4. Two strategies with runs → a strategy card reads the NEWER run across them (by run id), with that channel's name as the prefix, not the first channel listed (Task 1 test "a strategy card reads the newest run across strategies").
5. The module page for a name that is not a module (`#/module/foo`) → the plugin page's "Not found" line and the back link, no throw; while the listing is still loading, `Loading…` (Task 3 test "an unknown module name").

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `face/client/js/host/modules-view.js` | create | `MODULES` (the six modules' static facts and legends), `latestOf`, `chipOf`, `researchItems`, `runsOf`, `pageOf` — pure |
| `face/client/js/host/modules.js` | create | `startModules`: the latest artifact's JSON through `/data/channels/overview` — impure, into the store |
| `face/client/js/host/discover.js` | modify | the fifth listing `modules` |
| `face/client/js/host/discover-view.js` | modify | the Research shelf between Data and Bots; `itemsOf().research`; `itemById` for `module:<name>` |
| `face/client/js/render/discover.js` | modify | the research card and the shelf's grid; `#/discover/research`; `ID_SOURCE.module` |
| `face/client/js/render/modules.js` | create | `renderModule(state)`: the page |
| `face/client/js/render/rail.js` | modify | Discover lit on the `module` screen |
| `face/client/js/router.js`, `app.js`, `reducers/messages.js`, `reducers/discover.js`, `data/empty.js` | modify | the `module` screen, its reads on navigation, `lastDiscover`, the artifact slice |
| `face/client/js/icons.js` | modify | `layers`, `pulse`, `podium`, `switch` (flame and shield exist) |
| `face/client/css/app.css` | modify | `.pcard.research`, `.pcard-meta`, `.pcard-foot`, `.chip.ok`, `.chip.warn`, the page's legend table |
| `face/tests/client/helpers/inventory.js` | modify | the `modules` listing fixture |
| `face/tests/client/modules-view.test.js`, `host-modules.test.js` | create | Tasks 1 and 3 |
| `face/tests/lunhui-modules-table.test.ts` | create | the client table in step with the server tables and the roles |
| `face/tests/client/discover-view.test.js`, `host-discover.test.js`, `app.test.js`, `app-dom.test.js`, `rail.test.js`, `css.test.js` | modify | Tasks 2 and 3 |
| `face/tests/gravit-client-smoke.test.ts` | modify | the two new client modules served |
| `face/README.md` "Discover", `DEVELOPMENT.md` §5.1, §5.3, §5.4, §5.5, §7.3, `CLAUDE.md` (the `face/client/` line), the spec (build notes) | modify | the documents each task touches |

---

### Task 1: The modules' table and its pure view

**Files:**
- Create: `face/client/js/host/modules-view.js`
- Modify: `face/tests/client/helpers/inventory.js` (export `modulesListing()`)
- Test: `face/tests/client/modules-view.test.js` (create), `face/tests/lunhui-modules-table.test.ts` (create)

**Interfaces:**
- Consumes: the listing as `GET /data/modules.json` answers it (plan 1): `{ ok, mounted, root, channels: [{ channel, workspaceId, kind: 'market'|'strategy', runs: [{ run, session, asOf, openedAt, sealedAt, frozen, artifacts: { [module]: { status, missingSources, headline, marketRun } } }], runsOmitted, unreadable? }] }`.
- Produces (all exported, all pure):
  - `MODULES`: a frozen array of six, in the order environment · sentiment · theme · leader · mode · counterevidence, each `{ name, title, subtitle, role, roleId, route, channels: 'market'|'strategy'|'either', channelWords, file, headline: string[], tools: [read, submit], reads: string, icon, legend: null | { title: string, rows: { label: string, text: string }[] } }` with the values of the table below.
  - `MODULE_NAMES`: `new Set(MODULES.map(m => m.name))`; `moduleOf(name)` → the entry or `null`.
  - `latestOf(listing, module)` → `null`, or `{ channel, workspaceId, run, session, openedAt, sealedAt, artifact: null | { status, missingSources, headline, marketRun } }`: a market module reads `cn-market`'s `runs[0]`; a strategy module the `runs[0]` with the greatest run id among channels of kind `strategy`; `either` the greatest across all channels. A channel with no runs contributes nothing.
  - `headlineWords(module, headline)` → the chip's words for an OK artifact, by module: environment `index_state · liquidity_state`; sentiment `state · money_effect · freeze_type`; theme `<n> candidates · theme_stage · rotation`; leader `<n> candidates · <first flag>` or `no candidate` when none; mode the `mode` word, plus ` · card frozen` when `expectation` is a non-null object; counterevidence `<n> items`. Counts use `countWord` from `host/runs-view.js` (`1 candidate`, `2 items`). A missing or wrongly typed field reads as `0` for a count and is left out of a joined list; when nothing is left the words are the module's title.
  - `chipOf(listing, module, mounted = true)` → `{ text, tone: 'ok'|'warn'|'grey' }` by spec §5.1's table: no listing or no run → `no run yet` grey; the latest run lacks the artifact → `not run` grey; `status === 'NOT_EVALUABLE'` → `not evaluable · <missingSources joined by ' · '>` warn (`not evaluable` alone when the list is empty); otherwise `headlineWords`, tone `grey` when the words are `no candidate`, `WAIT` or `0 items`, else `ok`; a strategy or either module prefixes `<channel> · `; `mounted === false` → the text as above, tone `grey`, and the item carries `dim: true`.
  - `researchItems(listing, mounted)` → six items `{ id: 'module:<name>', shelf: 'research', kind: 'Module', name: title, line: subtitle, meta: '<role> · <channelWords>', mark: { type: 'glyph', icon }, chip, dim, source: <MODULES entry> }`, always six, listing or not.
  - `runsOf(listing, module)` → the page's rows across every channel the module accepts, newest first by run id, at most 24: `{ channel, workspaceId, run, session, openedAt, sealedAt, status, words }` where `words` is `headlineWords` for OK, `not evaluable · …` otherwise; runs that lack the artifact are left out.
  - `pageOf(listing, module, mounted)` → `{ module: <entry>, chip, latest: latestOf(...), rows: runsOf(...), kv: { reads: [[label, value]…], writes: […], runsOn: […] } }` with the three boxes' rows: Reads → `Freezes`/`Artifacts`/`Channel`; Writes → `File`, `Headline` (the fields joined by ` · `), `Under` (`strategies/<channelWords or cn-market>/analysis/<run>/`); Runs on → `Role`, `Route`, `Budget` = `10 calls per run · one artifact per run`.

The six entries (from the spec's Appendix A; the legends' rows are Appendix A's bullets verbatim, split at ` · `):

| name | title | subtitle | role / roleId | channels / channelWords | reads | icon | legend |
|---|---|---|---|---|---|---|---|
| environment | Environment | `环境与大周期 · index · liquidity · cycle anchor` | CN market analyst / cn-market-analyst | market / `cn-market` | `index freeze; quotes when frozen · no artifact` | layers | none |
| sentiment | Sentiment | `情绪周期 · state · money effect · 冰点` | CN market analyst / cn-market-analyst | market / `cn-market` | `limit-up and index freezes · no artifact` | pulse | "The text's stages beside the seven labels": CHAOS, IGNITION, EXPANSION, CLIMAX, RETREAT, REPAIR, UNKNOWN rows (A.2) |
| theme | Theme | `题材与轮动 · mainline · stage · rotation` | CN market analyst / cn-market-analyst | market / `cn-market` | `boards and limit-up freezes · no artifact` | flame | none |
| leader | Leader | `龙头与个股地位 · candidates · 顺位 · pattern flags` | CN stock analyst / cn-stock-analyst | strategy / `a strategy` | `the run's quotes · the cited market run's limit-up pools, mainline member lists, theme and sentiment artifacts` | podium | "The flags, as the contract words them": the six flags (A.4) |
| mode | Mode | `模式选择与预期 · mode · preconditions · expectation` | CN stock analyst / cn-stock-analyst | strategy / `a strategy` | `the run's leader and counterevidence · the cited market run's three artifacts · the previous mode card` | switch | "The preconditions, as the contract names them": the eight (A.5) |
| counterevidence | Counterevidence | `反证 · items against the accepted artifacts` | CN reviewer / cn-reviewer | either / `cn-market or a strategy` | `the run's accepted artifacts and evidence rows · a strategy: the cited market run's too` | shield | "The ten rulings and the five kinds": ten ruling rows then five kind rows (A.6) |

`route` is `deepseek-official/deepseek-flash` for all six; `file` is `<name>.json`; `headline` and `tools` are the server's (`MODULE_HEADLINES`; `lunhui_read_<name>_context`, `lunhui_submit_<name>`).

- [ ] **Step 1: Add the listing fixture** to `face/tests/client/helpers/inventory.js`: `export function modulesListing()` returning `{ ok: true, mounted: true, root: '/r', channels: [cnMarket, s01, s02] }` where `cnMarket` is kind `market` with one sealed run `20261028T020953Z-f3b89ce6` (session `2026-10-28`, `frozen: ['index','limit-up']`, artifacts: environment OK `{ index_state: 'WEAK', liquidity_state: 'STABLE', cycle_anchor: '低位反抽' }`, sentiment OK `{ state: 'IGNITION', money_effect: 'POSITIVE', freeze_type: 'NONE' }`, theme `NOT_EVALUABLE` `missingSources: ['boards']` `{ mainline_candidates: [], theme_stage: 'UNKNOWN', rotation: 'UNKNOWN' }`, counterevidence OK `{ items: [{}, {}, {}, {}] }`), `s01` kind `strategy` (`lunhui-s01-repair`) with one sealed run `20261028T021514Z-ecbf72e6` (artifacts: leader OK `{ leader_candidates: [], top_pattern_flags: [] }` `marketRun` the market run, mode OK `{ mode: 'WAIT', preconditions: [], research_only_matches: [], expectation: null, expectation_review: null }`, counterevidence OK `{ items: [{}, {}, {}, {}, {}] }`), `s02` kind `strategy` (`lunhui-s02-rotation`) with `runs: []`; every `workspaceId` `ws-<channel>`.

- [ ] **Step 2: Write the failing tests** in `face/tests/client/modules-view.test.js`:

```js
test('MODULES: six, in the chain order, each with its file, tools and headline fields', () => {
  assert.deepEqual(MODULES.map(m => m.name), ['environment', 'sentiment', 'theme', 'leader', 'mode', 'counterevidence']);
  assert.deepEqual(MODULES.map(m => m.channels), ['market', 'market', 'market', 'strategy', 'strategy', 'either']);
  assert.deepEqual(moduleOf('theme').tools, ['lunhui_read_theme_context', 'lunhui_submit_theme']);
  assert.equal(moduleOf('nope'), null);
  assert.equal(MODULES.filter(m => m.legend).map(m => m.name).join(','), 'sentiment,leader,mode,counterevidence');
});

test('chipOf: the fixture day — the six chips of spec §5.1', () => {
  const l = modulesListing();
  assert.deepEqual(chipOf(l, 'environment'), { text: 'WEAK · STABLE', tone: 'ok' });
  assert.deepEqual(chipOf(l, 'sentiment'), { text: 'IGNITION · POSITIVE · NONE', tone: 'ok' });
  assert.deepEqual(chipOf(l, 'theme'), { text: 'not evaluable · boards', tone: 'warn' });
  assert.deepEqual(chipOf(l, 'leader'), { text: 'lunhui-s01-repair · no candidate', tone: 'grey' });
  assert.deepEqual(chipOf(l, 'mode'), { text: 'lunhui-s01-repair · WAIT', tone: 'grey' });
  assert.deepEqual(chipOf(l, 'counterevidence'), { text: 'lunhui-s01-repair · 5 items', tone: 'ok' }, 'the strategy run is newer than the market run');
});

test('chipOf: headlines with content — candidates, flags, a frozen card, one item', () => {
  // a listing built from the fixture with theme OK {mainline_candidates:[{},{}], theme_stage:'FERMENT', rotation:'ROTATING'},
  // leader OK {leader_candidates:[{},{}], top_pattern_flags:['HIGH_POSITION','DIVERGENCE']}, mode OK {mode:'S01', expectation:{}},
  // counterevidence OK {items:[{}]}
  assert.equal(chipOf(l, 'theme').text, '2 candidates · FERMENT · ROTATING');
  assert.deepEqual(chipOf(l, 'leader'), { text: 'lunhui-s01-repair · 2 candidates · HIGH_POSITION', tone: 'ok' });
  assert.deepEqual(chipOf(l, 'mode'), { text: 'lunhui-s01-repair · S01 · card frozen', tone: 'ok' });
  assert.equal(chipOf(l, 'counterevidence').text, 'lunhui-s01-repair · 1 item');
});

test('chipOf: not run, no run yet, an empty listing, rows not mounted', () => {
  // the market run without a sentiment artifact → 'not run' grey; cn-market with runs: [] → 'no run yet' grey
  assert.deepEqual(chipOf({ ok: true, mounted: true, channels: [] }, 'leader'), { text: 'no run yet', tone: 'grey' });
  assert.deepEqual(chipOf(null, 'environment'), { text: 'no run yet', tone: 'grey' });
  assert.deepEqual(chipOf(modulesListing(), 'environment', false), { text: 'WEAK · STABLE', tone: 'grey' });
  assert.equal(researchItems(modulesListing(), false)[0].dim, true);
});

test('latestOf: a strategy card reads the newest run across strategies, an either card across all channels', () => {
  // s02 given a run 20261029T010000Z-aaaaaaaa with a leader artifact → leader's latest is s02's; counterevidence's latest stays s01's (s02's run lacks one)
});

test('headlineWords: malformed headlines read as empty counts and names, never undefined', () => {
  assert.equal(headlineWords('theme', { mainline_candidates: 'x' }), '0 candidates');
  assert.equal(headlineWords('counterevidence', {}), '0 items');
  assert.equal(headlineWords('leader', { leader_candidates: [{}], top_pattern_flags: [] }), '1 candidate');
  assert.equal(headlineWords('mode', { mode: 7 }), 'Mode');
  assert.equal(headlineWords('environment', {}), 'Environment');
  assert.doesNotMatch(headlineWords('sentiment', { state: 'CHAOS' }), /undefined/);
});

test('researchItems: six items, ids, lines, meta and marks; an empty listing: six cards, every chip no run yet', () => {
  const items = researchItems(modulesListing(), true);
  assert.deepEqual(items.map(i => i.id), ['module:environment', 'module:sentiment', 'module:theme', 'module:leader', 'module:mode', 'module:counterevidence']);
  assert.deepEqual(items.map(i => i.meta), ['CN market analyst · cn-market', 'CN market analyst · cn-market', 'CN market analyst · cn-market', 'CN stock analyst · a strategy', 'CN stock analyst · a strategy', 'CN reviewer · cn-market or a strategy']);
  assert.deepEqual(items[0].mark, { type: 'glyph', icon: 'layers' });
  assert.ok(researchItems(null, true).every(i => i.chip.text === 'no run yet'));
});

test('runsOf and pageOf: the rows across channels newest first, the three boxes', () => {
  const rows = runsOf(modulesListing(), 'counterevidence');
  assert.deepEqual(rows.map(r => [r.channel, r.words]), [['lunhui-s01-repair', '5 items'], ['cn-market', '4 items']]);
  const page = pageOf(modulesListing(), 'theme', true);
  assert.deepEqual(page.kv.writes, [['File', 'theme.json'], ['Headline', 'mainline_candidates · theme_stage · rotation'], ['Under', 'strategies/cn-market/analysis/<run>/']]);
  assert.deepEqual(page.kv.runsOn, [['Role', 'CN market analyst'], ['Route', 'deepseek-official/deepseek-flash'], ['Budget', '10 calls per run · one artifact per run']]);
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].status, 'NOT_EVALUABLE');
});
```

And `face/tests/lunhui-modules-table.test.ts`:

```ts
test("the client's MODULES table is in step with the server's MODULE_HEADLINES, modules.mjs and the roles", () => {
  assert.deepEqual(MODULES.map((m) => [m.name, m.file, [...m.headline]]), MODULE_HEADLINES.map((m) => [m.name, m.file, [...m.headline]]));
  assert.deepEqual(MODULES.map((m) => m.name), [...LUNHUI_MODULES.map((m) => m.name)]);          // plugins/lunhui/lib/modules.mjs
  const roles = new Map(readRoles(ROLES_ROOT).map((r) => [r.id, r.name]));
  for (const m of MODULES) assert.equal(roles.get(m.roleId), m.role, m.name);
  for (const m of MODULES) assert.ok(LUNHUI_TOOL_NAMES.includes(m.tools[0]) && LUNHUI_TOOL_NAMES.includes(m.tools[1]), m.name);
  assert.equal(new Set(MODULES.map((m) => m.icon)).size, 6, "six distinct glyphs");
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/client/modules-view.test.js tests/lunhui-modules-table.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Implement `face/client/js/host/modules-view.js`** with the exports and rules above; `countWord` imported from `./runs-view.js`; run ids compared as strings (they open with the UTC second, so string order is time order).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/client/modules-view.test.js tests/lunhui-modules-table.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add face/client/js/host/modules-view.js face/tests/client/modules-view.test.js face/tests/lunhui-modules-table.test.ts face/tests/client/helpers/inventory.js
git commit -m "feat: the six Lunhui modules as a client table with their chips, latest runs and page rows"
```

---

### Task 2: The Research shelf in Discover

**Files:**
- Modify: `face/client/js/host/discover.js` (`SHELF_PATHS`, `VALID`), `face/client/js/host/discover-view.js` (`SHELVES`, `SOURCE`, `itemsOf`, `itemById`), `face/client/js/render/discover.js` (the shelf and grid, `ID_SOURCE`), `face/client/js/icons.js`, `face/client/css/app.css`, `face/client/js/data/empty.js` (the shelves list)
- Test: `face/tests/client/host-discover.test.js`, `discover-view.test.js`, `app-dom.test.js`, `css.test.js`
- Docs: `face/README.md` "Discover" (one paragraph after the four shelves: the Research shelf, its listing, the chip rule, "Run comes with plan 3")

**Interfaces:**
- Consumes: `researchItems`, `chipOf` from Task 1.
- Produces:
  - `SHELF_PATHS.modules = '/data/modules.json'`; `VALID.modules = d => Array.isArray(d?.channels)`; `load()` reads five.
  - `SHELVES` = data, **research** (`{ id: 'research', title: 'Research', empty: 'No research modules' }`), bots, agents, skills; `SOURCE.research = 'modules'`.
  - `itemsOf(discover).research` = `researchItems(sh.modules?.data ?? null, sh.modules?.data?.mounted !== false)`; `itemById` finds `module:<name>`; `searchItems` covers them (nothing to change: it reads `name` and `line`).
  - `render/discover.js`: `researchCard(item)` — `<div class="pcard research in-grid">` holding `<a class="pcard-link" href="#/module/<name>">` around the mark, the name and the 副题 line, a `<span class="pcard-meta">` with `item.meta`, the kind label `MODULE`, and a `<span class="pcard-foot"><span class="chip <tone>">text</span><button type="button" class="btn-sm" data-action="runModule" data-module="<name>" disabled title="Run comes with plan 3">Run</button></span>`; `dim` adds class `dim`. The Research shelf renders `<div class="grid">` of the six (no `shelf-row`, no horizontal scroll) with the head's subtitle `<span class="dim">Lunhui · 6 modules</span>` and, when `mounted === false`, one line `Lunhui rows not mounted` above the grid; `#/discover/research` renders the same six through `grid(...)`; `ID_SOURCE.module = 'modules'`.
  - `icons.js`: `layers`, `pulse`, `podium`, `switch` as 24-box line paths (the canvas's: layers `M12 3l9 5-9 5-9-5z M3 13l9 5 9-5`; pulse `M3 12h4l3-7 4 14 3-7h4`; podium `M4 18h16L18 8l-4 4-2-6-2 6-4-4z`; switch `rect 3 8 18 8 r4` + `circle 15 12 r2.5`).
  - CSS: `.pcard.research` a column layout (`flex-direction: column; gap: 12px`), `.pcard-meta` dim 12px, `.pcard-foot` a row with the chip left and the key right, `.chip.ok { background: var(--up-fill); color: var(--up) }`, `.chip.warn { background: var(--warn-fill); color: var(--warn-text) }`, `.pcard.dim { opacity: .55 }`.

- [ ] **Step 1: Write the failing tests**

`discover-view.test.js`: change "the four shelves" to five — `['data', 'research', 'bots', 'agents', 'skills']` / titles — and add:

```js
test('Research: six module items from the modules listing, with chips; six still when the listing never came', () => {
  const items = itemsOf(discover({ modules: shelf(modulesListing()) })).research;
  assert.deepEqual(items.map(i => [i.id, i.chip.text]), [['module:environment', 'WEAK · STABLE'], ['module:sentiment', 'IGNITION · POSITIVE · NONE'], ['module:theme', 'not evaluable · boards'], ['module:leader', 'lunhui-s01-repair · no candidate'], ['module:mode', 'lunhui-s01-repair · WAIT'], ['module:counterevidence', 'lunhui-s01-repair · 5 items']]);
  assert.equal(itemsOf(discover()).research.length, 6);
  assert.equal(itemById(discover({ modules: shelf(modulesListing()) }), 'module:theme').name, 'Theme');
  assert.ok(searchItems(Object.values(itemsOf(discover({ modules: shelf(modulesListing()) }))).flat(), '题材').some(i => i.id === 'module:theme'));
});
```

`host-discover.test.js`: the first test reads FIVE listings (`'/data/modules.json'` among the sorted paths, `shelves.modules.status === 'ready'`); the `ok` fixture gains `'/data/modules.json': { ok: true, mounted: true, root: '/r', channels: [] }`; a malformed answer (`{ ok: true }`) marks `modules` failed and no other shelf.

`app-dom.test.js` (the `host()` rig's `inventory` gains `'/data/modules.json': modulesListing()`; navigate with `f.win.location.hash = '#/discover'` as other tests change the hash, then `await settle()`):

```js
test('Discover draws the Research shelf: six module cards with their chips, Run disabled; rows not mounted dims them', async () => {
  // boot at '#/discover'; after settle: root.innerHTML contains six 'pcard research', 'Lunhui · 6 modules', the chip texts of the fixture,
  // 'href="#/module/theme"', and six 'data-action="runModule"' each with 'disabled'
  // re-serve the listing with mounted:false (the rig's inventory is mutable), dispatch a shelf re-read (fire the shelfRetry action for 'modules'), settle:
  // 'Lunhui rows not mounted' present and the six cards carry class dim
});
```

`css.test.js`: whatever that file pins (the classes the renderers emit exist in the sheet, or the reverse) now covers `pcard research`, `pcard-meta`, `pcard-foot`, `chip ok`, `chip warn`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/client/discover-view.test.js tests/client/host-discover.test.js tests/client/app-dom.test.js tests/client/css.test.js`
Expected: FAIL — four shelves, four listings, no research cards.

- [ ] **Step 3: Implement** the changes listed under Produces; in `empty.js` the shelves list gains `'modules'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/client/*.test.js && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Document** — `face/README.md` "Discover": after the four shelves' sentence, one paragraph: **Research**, the six Lunhui modules in the chain's order (`GET /data/modules.json`, plan 1), each card its 副题, its role and channel, and a chip reading the channel's latest run — the headline words, `not evaluable · <sources>`, `not run` or `no run yet`, never an older run; a strategy card names its channel; `Lunhui rows not mounted` dims the shelf; Run is disabled until plan 3; a card opens `#/module/<name>`.

- [ ] **Step 6: Commit**

```bash
git add face/client/js/host/discover.js face/client/js/host/discover-view.js face/client/js/render/discover.js face/client/js/icons.js face/client/css/app.css face/client/js/data/empty.js face/tests/client/discover-view.test.js face/tests/client/host-discover.test.js face/tests/client/app-dom.test.js face/tests/client/css.test.js face/README.md
git commit -m "feat: Discover gains a Research shelf of the six Lunhui module cards, each with today's headline"
```

---

### Task 3: The module page `#/module/<name>`

**Files:**
- Create: `face/client/js/render/modules.js`, `face/client/js/host/modules.js`
- Modify: `face/client/js/router.js` (`case 'module'`), `face/client/js/app.js` (`SCREENS`, the render switch, the navigation effects, the host layer's start, the `runModule` action as a no-op until plan 3), `face/client/js/reducers/messages.js` (`lastDiscover`), `face/client/js/reducers/discover.js` (the artifact slice), `face/client/js/data/empty.js` (`discover.artifacts: {}`), `face/client/js/render/rail.js` (Discover lit on `module`), `face/client/css/app.css` (the legend table)
- Test: `face/tests/client/host-modules.test.js` (create), `face/tests/client/app.test.js` (`routeOf('#/module/theme')`), `face/tests/client/app-dom.test.js`, `face/tests/client/rail.test.js`, `face/tests/client/reducers.test.js` or `host-reducers.test.js` (the three reducers)
- Docs: `DEVELOPMENT.md` §5.1 (the two new files and the modules-view), §5.3 (the host layer: the fifth listing, `startModules`), §5.4 (the Research shelf and the module page), §5.5 (`discover.shelves.modules`, `discover.artifacts`), §7.3 (the new tests)

**Interfaces:**
- Consumes: `pageOf`, `latestOf`, `moduleOf` from Task 1; `discover.read('modules')` from Task 2; `postJson('/data/channels/overview', { workspaceId })` as `host/channels.js` posts it.
- Produces:
  - `router.js`: `case 'module': return { screen: 'module', id: restOf(path) }`; `toHash` unchanged (`#/module/<id>`).
  - `app.js`: `SCREENS` gains `module`; the render switch calls `renderModule(s)`; `inDiscover` includes `module` (entering reads the listings); on a `module` route whose id changed, `void modules.latestArtifact(r.id)`; `actions.runModule` registered as a no-op that dispatches `discoverStatus({ line: 'Run comes with plan 3' })` (plan 3 replaces it).
  - `reducers/messages.js` `nav`: `module` behaves as `plugin` for `lastDiscover`.
  - `reducers/discover.js`: `moduleArtifactLoading(s, { module })`, `moduleArtifactLoaded(s, { module, run, json })`, `moduleArtifactFailed(s, { module })` writing `discover.artifacts[module] = { status: 'loading'|'ready'|'failed', run, json }`.
  - `host/modules.js`: `startModules({ store, postJson, readListing, now = Date.now })` → `{ latestArtifact(module) }`: awaits `readListing()` (Task 2's `discover.read('modules')`), computes `latestOf(listing, module)`; none → nothing; else dispatches loading, posts the overview for `workspaceId`, and dispatches loaded with `json = data?.body?.latestRun?.run === run ? data.body.latestRun.artifacts?.[module]?.json ?? null : null`; a rejected post → failed; only the latest-started read per module lands.
  - `render/modules.js`: `renderModule(state)` → `<main class="main disc plugin-page">` with the plugin page's back link (`state.lastDiscover`), then for a known module: `<header class="plug-head">` (the glyph at 72, `<h1 class="plug-name">Title</h1>`, the line `<role> · deepseek-flash · <channelWords>`, the kind `MODULE`, the chip, the disabled Run key), then `kv` boxes `Reads` / `Writes` / `Runs on` from `pageOf().kv`, a `Runs` section — a table `session · channel · run · status · words` from `pageOf().rows` or the line `No run yet`, a `Latest artifact` section — `<details><summary>…</summary><pre class="disc-text">compact JSON</pre></details>` when `discover.artifacts[module]` is ready with json, `Loading…` while loading, `open the channel page to read older runs` when ready with null, `Couldn't read` when failed — and the legend section (`legend.title`, a two-column `kv`-style list of `label → text`) when the module has one. An unknown name: the plugin page's `Loading…` while the modules listing is idle or loading, else `Not found`.
  - `rail.js`: the Discover item is lit for `screen === 'module'` as for `plugin`.

- [ ] **Step 1: Write the failing tests**

`app.test.js`: `assert.deepEqual(routeOf('#/module/theme'), { screen: 'module', id: 'theme' })` and `parseHash('#/module/theme').id === 'theme'`.

`host-modules.test.js` (a `rig` like `host-discover.test.js`'s):

```js
test('latestArtifact: reads the listing, posts the overview of the latest run's channel, keeps the json when the runs match', async () => {
  // readListing resolves modulesListing(); postJson answers { ok: true, body: { latestRun: { run: '20261028T020953Z-f3b89ce6', artifacts: { theme: { headline: {}, json: { module: 'theme', status: 'NOT_EVALUABLE' } } } } } }
  await r.modules.latestArtifact('theme');
  assert.deepEqual(r.posted, [['/data/channels/overview', { workspaceId: 'ws-cn-market' }]]);
  assert.deepEqual(r.d().artifacts.theme, { status: 'ready', run: '20261028T020953Z-f3b89ce6', json: { module: 'theme', status: 'NOT_EVALUABLE' } });
});
test('latestArtifact: another run as the overview's latest → json null; a failed post → failed; no run → nothing posted', async () => { /* … */ });
test('latestArtifact: only the latest-started read lands', async () => { /* two calls, the first answering last: the store holds the second's json */ });
```

`app-dom.test.js`:

```js
test('the module page: head, the three boxes, the runs table, the legend, the latest artifact after the overview answers; an unknown name', async () => {
  // boot at '#/module/sentiment'; settle: the markup holds 'plug-name">Sentiment', 'CN market analyst · deepseek-flash · cn-market', the chip 'IGNITION · POSITIVE · NONE',
  // 'Reads', 'Writes', 'Runs on', 'sentiment.json', the runs table row with '20261028T020953Z-f3b89ce6', the legend title 'The text's stages beside the seven labels' and 'P0161',
  // a disabled Run key; the overview was posted once for 'ws-cn-market'; with the rig's overview answering a latestRun of that run holding sentiment json, the details appear
  // then '#/module/foo' → 'Not found' and the back link; the Discover rail item carries the active class on both
});
```

`rail.test.js`: Discover active when `screen === 'module'`. The reducers test: the three artifact reducers' shapes.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/client/app.test.js tests/client/host-modules.test.js tests/client/app-dom.test.js tests/client/rail.test.js`
Expected: FAIL — no `module` route, no page, no host layer.

- [ ] **Step 3: Implement** the files and changes under Produces. In `app.js`, start the layer beside the others: `const modules = startModules({ store, postJson, readListing: () => discover.read('modules'), now })`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/client/*.test.js && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Document** — `DEVELOPMENT.md` §5.1: rows for `js/host/modules-view.js`, `js/host/modules.js`, `js/render/modules.js`; §5.3: the fifth listing and `startModules` (one overview read per page, the latest-started lands); §5.4: the Research shelf (the card, the chip rule, the grid, `mounted`) and the module page (its sections); §5.5: `discover.shelves.modules`, `discover.artifacts`; §7.3: the new test files and the extended ones.

- [ ] **Step 6: Commit**

```bash
git add face/client/js/render/modules.js face/client/js/host/modules.js face/client/js/router.js face/client/js/app.js face/client/js/reducers/messages.js face/client/js/reducers/discover.js face/client/js/data/empty.js face/client/js/render/rail.js face/client/css/app.css face/tests/client/host-modules.test.js face/tests/client/app.test.js face/tests/client/app-dom.test.js face/tests/client/rail.test.js face/tests/client/reducers.test.js DEVELOPMENT.md
git commit -m "feat: a page per Lunhui module under module slash name, with its runs across channels and the latest artifact"
```

(If the reducers' test lives in `host-reducers.test.js`, add that file instead.)

---

### Task 4: The served modules, the map line, the whole suite, the build note

**Files:**
- Modify: `face/tests/gravit-client-smoke.test.ts` (the served-modules list gains `/client/js/host/modules-view.js`, `/client/js/host/modules.js`, `/client/js/render/modules.js`, each `text/javascript`), `CLAUDE.md` (the `face/client/` map line: one clause — "stage 3 … Discover (the MCP servers, bots, CLI agents and Gravit, skills, and since 2026-10-2x a Research shelf of the six Lunhui modules with a page each, `#/module/<name>`)"), the spec (a "Build notes, plan 2" section)

- [ ] **Step 1: Extend the smoke's served-modules list** and run the suites:

Run: `cd face && npm test && npm run typecheck && FACE_SMOKE=1 npx tsx --test tests/gravit-client-smoke.test.ts`
Expected: every test passes, `tsc` silent, the smoke green (a bare `bootFace` mounts no `/data` route, so the listing itself is pinned by plan 1's route test, not here).

- [ ] **Step 2: Hard-reload check, by test only** — nothing to do by eye: the client is served without cache headers; the fake-DOM tests are the proof. (The live drill comes with plan 3.)

- [ ] **Step 3: Write the build note** — "## 13. Build notes, plan 2 (2026-10-2x)" in the spec: the commits, the decisions the plan left open that were made (the tones' CSS, the legend table's markup, the `runModule` no-op line), and nothing else. Update `CLAUDE.md`'s line.

- [ ] **Step 4: Commit**

```bash
git add face/tests/gravit-client-smoke.test.ts CLAUDE.md docs/superpowers/specs/2026-10-28-lunhui-module-cards-design.md
git commit -m "docs: plan 2 build notes, the client smoke serves the module page's files, the map names the Research shelf"
```
