# Lunhui run view, plan 2: the composed answer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gravit ends a market run by calling `lunhui_present`. The face checks the call against the
run and draws it in the thread as a composed answer: the summary, then the verdicts, breadth, indices,
ladder and sources blocks, then a footer, with the turn's working notes folded.

**Architecture:**
- A pure checker (`lib/present.mjs`) validates a composition against plan 1's view model and digest,
  including the rule that Gravit's numbers must come from the digest. A new row (`present-row.mjs`)
  exposes it as Gravit's `lunhui_present` tool and ends the turn on ok.
- The client lifts an ok call into a `composed` message, fetches the view model from plan 1's route,
  and draws each block with a pure string renderer. A slider and pointer cursor patch the drawn chart
  in place, without a store change.

**Tech Stack:**
- The plugin is plain ES modules (`face/plugins/lunhui/**/*.mjs`); `face/src` is TypeScript.
- The client is no-build ES modules (`face/client/js`).
- Tests use `node:test` through `npx tsx --test`; client tests use the fake DOM
  (`face/tests/client/helpers/fake-dom.js`).

**Spec:** `docs/superpowers/specs/2026-10-30-lunhui-run-view-design.md`. §5.1–§5.3, §5.8, §5.9, M1–M3,
M7–M11, M14–M16, M18–M21 and O10–O13 are this plan's. Plan 1 (merged, main `bedb5f7e`) built the
evidence, `lib/view.mjs`, `service.view()` and `GET /data/lunhui/view`.

## Global Constraints

**Catalog and copy**
- The catalog is face-owned (O10, M1). Gravit picks, orders, titles and focuses blocks, and the face
  draws every number from the view model. No model-written markup reaches the page.
- v1 covers market answers only (O11, M14, M16). Strategy-run answers keep their text report.
- Colour uses the face's tokens, green up and red down (O12): `--up`, `--down`, `--up-fill`,
  `--down-fill`, and the stress pair `--warn-fill`/`--warn-text`. `app.css` gets no hex colours
  (`css.test.js`).
- Times shown are China time (M7). Minute labels come from the grid via `minuteLabel`. ISO stamps are
  formatted with `Intl.DateTimeFormat(…, { timeZone: "Asia/Shanghai" })`, never the browser's zone.
- Face chrome (labels, buttons, readouts) is English. Gravit's summary, titles and choice labels are
  shown as written.
- Plan 3 owns the stock drawer, the clickable stock names, the drawn choices, and the `yesterday` and
  `signals` blocks (spec §10). In this plan, names render as escaped text, and choices are validated
  but not drawn.

**Limits and byte caps**
- Limits: summary 1–160 characters, titles ≤ 40, blocks 1–6 with no kind twice, choices 0–3 with
  labels ≤ 30. Characters are counted as code points. The dsh parameter DSL has no length or count
  keywords, so `lib/present.mjs` checks these.
- Byte caps: `dsh/profile/lunhui-run.md` ≤ 3,000 B (now 2,999), `lunhui-module.md` ≤ 1,500 B (now
  1,372), `GRAVIT.md` ≤ 4,500 B (now 3,459).

**Layering and process**
- `face/src` imports nothing from `face/plugins/`.
- Commits are English, written to a file and passed with `git commit -F <file>`. The branch
  ff-merges into local main at the end (O13), and nothing is pushed.
- Run one file with `cd face && npx tsx --test tests/<file>`. The suite is `npm test`, plus
  `npm run typecheck`.

## Review Focus

1. **Gravit writes a number in a different form from the digest.** "4,774 家", "跌 1.3%", "41%" for
   0.41 and the full-width "１４:００" are all accepted. A number the digest does not hold ("88.8%") is
   refused, and the refusal names it. Task 1.
2. **A refused call followed by an ok call in the same turn.** Only the ok one is drawn, the refused
   tool row stays hidden, and the turn ends after the ok call. Tasks 2 and 4.
3. **The view fetch fails** (run deleted, a 404, the face restarted mid-load). The composed answer
   still shows its summary, plus one error line with a Retry button, never a blank or a throw. Task 4.
4. **A redraw lands while the operator drags the minute slider** (live events arrive). The cursor
   stays at the slider's minute. Task 6.
5. **The browser runs in America/New_York.** Every time in a composed answer is China time: the grid
   09:30–15:00, and the footer's frozen time in CST. Tasks 5 and 6.

## File map

| File | Responsibility |
|---|---|
| `face/plugins/lunhui/lib/present.mjs` (new) | catalog, module blocks, limits, number check, `checkPresent` |
| `face/plugins/lunhui/lib/errors.mjs` | + `refuse.notMarketRun()`, `refuse.invalidPresent(field, reason)` |
| `face/plugins/lunhui/present-row.mjs` (new) | the `lunhui_present` tool |
| `face/src/lunhui.ts`, `face/src/lunhui-view.ts` | register the row; an empty `modules=` means none |
| `dsh/profile/lunhui-run.md`, `lunhui-module.md`, `GRAVIT.md`, `bots/gravit/agent.cordis.yml` | the protocol split and the follow-up sentence |
| `face/client/js/host/kinds.js` | `presentLift` |
| `face/client/js/host/lunhui.js` (new) | the view key and path, `ensureViews`, `cursorPatch`, `minuteAt`, `applyCursor`, `reapplyCursors` |
| `face/client/js/reducers/lunhui.js` (new), `data/empty.js`, `reducers/index.js` | the `lunhui` slice |
| `face/client/js/render/lunhui/` (new) | `composed.js`, `notes.js`, `verdicts.js`, `breadth.js`, `sources.js`, `footer.js`, `intraday.js`, `indices.js`, `ladder.js`, `time.js` |
| `face/client/js/render/thread.js`, `face/client/js/app.js`, `face/client/css/app.css` | wire it in |

---

### Task 1: The composition check

**Files:**
- Create: `face/plugins/lunhui/lib/present.mjs`
- Modify: `face/plugins/lunhui/lib/errors.mjs` (the `refuse` table, lines 23-122)
- Test: `face/tests/lunhui-present.test.ts` (new)

**Interfaces:**
- Consumes:
  - `buildView` and `viewDigest` from `lib/view.mjs`;
  - `syntheticSealedRun()` from `face/tests/lunhui-view-fixtures.ts`;
  - `minuteIndex` from `lib/market.mjs`.
- Produces:
  - `PRESENT_KINDS = ["verdicts", "breadth", "indices", "ladder", "sources"]`.
  - `MODULE_BLOCKS = { environment: ["verdicts","breadth","indices","sources"], sentiment: ["verdicts","ladder","sources"], theme: ["verdicts","sources"], counterevidence: ["verdicts","sources"] }`.
    Plan 3 adds `yesterday` and `signals` to both constants.
  - `PRESENT_LIMITS = { summary: 160, title: 40, blocks: 6, choices: 3, label: 30 }`.
  - `normaliseText(text: string): string`.
  - `unsupportedNumbers(texts: string[], digest: string, codes: Set<string>): string[]`.
  - `checkPresent(args, { view, digest, manifest }): { blocks: string[], modules: string[] }`.
    - It throws `LunhuiError`: `NOT_A_MARKET_RUN` (via `refuse.notMarketRun()`) or `INVALID_PRESENT`
      (via `refuse.invalidPresent(field, reason)`).
    - The message is `"<field>: <reason>"`, with the reason in Chinese like the other refusals.
  - `presentModules(args, manifest): string[]`. It returns `[args.module]` when a module is named,
    else `manifest.artifacts ∩ VIEW_MODULES` in `VIEW_MODULES` order.

**The number check.** This is the one algorithm the tests do not fully determine. Pin it as follows.

- `normaliseText` maps:
  - the full-width digits U+FF10–FF19 to 0–9;
  - `．` to `.`, `：` to `:`, `，` to `,`, `％` to `%`, `＋` to `+`, `－` to `-`;
  - U+2212 `−` to `-`.
- Tokens are read from normalised text, in this order:
  1. Remove exempt spans: run ids `/\d{8}T\d{6}Z-[0-9a-f]{8}/g`, and dates
     `/\d{4}-\d{1,2}-\d{1,2}|(?<!\d)\d{1,2}-\d{1,2}(?!\d)|\d{1,2}月\d{1,2}日/g`.
  2. Times `/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g`, zero-padded to "HH:MM", go into `times` and are
     removed from the text.
  3. Numbers match `/(?<![\d.])[+-]?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%?)/g`. Each gives
     `{ raw, value: |int,frac| with commas dropped, decimals: frac length, percent }`.
- The digest is read the same way. That gives its time set, and the absolute values of all its
  numbers.
- A text time is supported when it is in the digest's time set.
- A text number with `d` decimals is supported when some digest value `x` has `r(x, d) === value`.
  If the token carries `%`, `r(x × 100, d) === value` also counts. Here
  `r(x, d) = Math.round(x·10^d + 1e-9) / 10^d`, rounding half up on magnitude.
- A 6-digit token that is a key of `codes` (the view's stock codes) is skipped.
- `unsupportedNumbers` returns the unsupported raw tokens, and the times as "HH:MM", unique and in
  order of appearance.

**`checkPresent` applies, in order:**
1. `manifest.kind === "market"`, else `NOT_A_MARKET_RUN`.
2. `summary` is 1–160 code points.
3. `blocks` has 1–6 entries, each kind is in `PRESENT_KINDS`, and no kind repeats. With `module`, each
   kind is in `MODULE_BLOCKS[module]`.
4. Each block is drawable:
   - `breadth`, `indices` and `ladder` need `view[kind].unavailable === null`;
   - `verdicts` needs at least one verdict, or a reviewer;
   - `sources` is always drawable.
   An undrawable block's reason is the view's `unavailable` text.
5. `title` is required for `breadth`, `indices` and `ladder`, optional for `verdicts` and `sources`,
   and at most 40 code points.
6. `focus`:
   - only `ladder` (`{ rung }`, an integer equal to some `view.ladder.rungs[].n`) and `indices`
     (`{ from, to }`, both on the grid, `from < to`, `to ≤ view.through`) take one;
   - any other kind with a focus is refused.
7. `choices` has 0–3 entries, each label 1–30 code points, and any `stock` is a key of `view.stocks`.
8. `unsupportedNumbers([summary, …titles, …labels], digest, codes)` is empty. Otherwise the field is
   `numbers` and the reason lists the tokens, e.g. "这些数字不在 view 摘要里：88.8%".

- [ ] **Step 0: Set up the branch.** Use superpowers:using-git-worktrees to create branch
  `feat/run-view-2` from local `main` at `.claude/worktrees/run-view-2`. Run `cd face && npm ci`.
- [ ] **Step 1: Write the failing tests.** Use
  `const view = buildView(sealed); const digest = viewDigest(view)` with
  `const sealed = syntheticSealedRun()`.

```ts
const ok = (over = {}) => ({ strategy: "cn-market", run: sealed.run, summary: "普跌的一天：567 家上涨、4,774 家下跌。",
  blocks: [{ kind: "verdicts" }, { kind: "breadth", title: "近九成个股下跌" },
    { kind: "indices", title: "14:00 后放量跳水", focus: { from: "14:00", to: "15:00" } },
    { kind: "ladder", title: "断在 3 板：昨天 8 个 2 板", focus: { rung: 3 } }, { kind: "sources" }], choices: [], ...over });
test("an ok composition returns its kinds and the run's market modules", () => {
  assert.deepEqual(checkPresent(ok(), { view, digest, manifest: sealed.manifest }),
    { blocks: ["verdicts", "breadth", "indices", "ladder", "sources"], modules: ["environment", "sentiment", "theme", "counterevidence"] });
});
test("numbers in other forms are found in the digest", () => {
  assert.deepEqual(unsupportedNumbers(["上证跌 1.3%，跌 1.33%", "炸板率 41%", "成交约 1.5 万亿", "１４:００ 后"], digest, new Set()), []);
});
test("numbers the digest does not hold are named", () => {
  assert.deepEqual(unsupportedNumbers(["近九成 88.8%", "上证跌 2.1%", "１４:３７"], digest, new Set()), ["88.8%", "2.1%", "14:37"]);
});
test("run ids, dates and pool codes are exempt", () => {
  assert.deepEqual(unsupportedNumbers([`${sealed.run} 2026-10-27 10-27 10月27日 600001`], digest, new Set(Object.keys(view.stocks))), []);
});
test("each rule refuses with its field", () => {
  const refuse = (args: any, field: string) => assert.throws(() => checkPresent(args, { view, digest, manifest: sealed.manifest }),
    (e: any) => e.code === "INVALID_PRESENT" && e.message.startsWith(`INVALID_PRESENT: ${field}`));
  refuse(ok({ summary: "" }), "summary");
  refuse(ok({ blocks: [] }), "blocks");
  refuse(ok({ blocks: [{ kind: "sources" }, { kind: "sources" }] }), "blocks");
  refuse(ok({ module: "environment" }), "blocks[3].kind");
  refuse(ok({ blocks: [{ kind: "ladder", title: "x".repeat(41) }] }), "blocks[0].title");
  refuse(ok({ blocks: [{ kind: "ladder" }] }), "blocks[0].title");
  refuse(ok({ blocks: [{ kind: "ladder", title: "梯队", focus: { rung: 9 } }] }), "blocks[0].focus");
  refuse(ok({ blocks: [{ kind: "indices", title: "指数", focus: { from: "15:00", to: "14:00" } }] }), "blocks[0].focus");
  refuse(ok({ blocks: [{ kind: "breadth", title: "涨跌", focus: { rung: 1 } }] }), "blocks[0].focus");
  refuse(ok({ choices: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }] }), "choices");
  refuse(ok({ choices: [{ label: "打开", stock: "999999" }] }), "choices[0].stock");
  refuse(ok({ summary: "近九成个股下跌 88.8%" }), "numbers");
});
test("a strategy run is refused", () => {
  assert.throws(() => checkPresent(ok(), { view, digest, manifest: { ...sealed.manifest, kind: "strategy" } }), (e: any) => e.code === "NOT_A_MARKET_RUN");
});
test("an undrawable block is refused with the view's reason", () => {
  const noIndex = buildView({ ...sealed, manifest: { ...sealed.manifest, evidence: sealed.manifest.evidence.filter((e: any) => e.source !== "index") },
    evidence: sealed.evidence.filter((e: any) => e.source !== "index") });
  assert.throws(() => checkPresent(ok({ summary: "普跌" , blocks: [{ kind: "indices", title: "指数" }] }), { view: noIndex, digest: viewDigest(noIndex), manifest: sealed.manifest }),
    (e: any) => e.code === "INVALID_PRESENT" && /index not frozen/.test(e.message));
});
test("a card run's module narrows the modules", () => {
  assert.deepEqual(checkPresent(ok({ module: "sentiment", blocks: [{ kind: "ladder", title: "断在 3 板" }] }), { view, digest, manifest: sealed.manifest }).modules, ["sentiment"]);
});
```

- [ ] **Step 2:** Run `cd face && npx tsx --test tests/lunhui-present.test.ts`. Expected: FAIL, because
  the module is missing.
- [ ] **Step 3:** Implement the Produces list and the two refusals in `errors.mjs`, with Chinese
  reasons like the others.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: the composition check, its catalog and the digest number rule".

### Task 2: The `lunhui_present` tool

**Files:**
- Create: `face/plugins/lunhui/present-row.mjs`
- Modify: `face/src/lunhui.ts:23-38` (append `"lunhui-present"` and `"lunhui_present"`)
- Modify: `face/src/lunhui-view.ts:48-49` (an empty `modules=` means `[]`)
- Test:
  - `face/tests/lunhui-present.test.ts`
  - `face/tests/lunhui-view-route.test.ts`
  - pinned lists in `bots.test.ts:94-102`, `boot.test.ts:95-98,127,262-276`,
    `lunhui-rows.test.ts:723-727` (use `slice(5, 11)`) and `smoke.test.ts:256-266`
  - `roles.test.ts` (no role allows `lunhui_present`, the `:49` pattern)

**Interfaces:**
- Consumes:
  - `checkPresent` and `presentModules` (Task 1);
  - `viewDigest` (plan 1);
  - `service.view(strategy, run, { modules })` from the injected `lunhuiRuns`;
  - `callerIsChild(exec)` and `refuse.notGravit()` (`errors.mjs:130-132`);
  - `asToolError`;
  - the run's manifest, from the same service read `lunhui_read_run` uses (`service.readRun`).
- The order inside `execute`:
  1. Refuse a child caller.
  2. Read the manifest.
  3. `modules = presentModules(args, manifest)`.
  4. `view = await service.view(strategy, run, { modules })`.
  5. `checkPresent(args, { view, digest: viewDigest(view), manifest })`.
  6. `exec.concludeTurn()`, then return.
- Produces:
  - The row is `export const name = "lunhui-present"; export const inject = ["tools", "lunhuiRuns"];`.
    It registers `lunhui_present` with `ctx.effect(() => ctx.tools.register(tool))`.
  - **Parameters**, in the DSL. Every object node states `additionalProperties: false`.
    - `strategy` and `run`: required strings.
    - `module`: an optional string, `enum` of `VIEW_MODULES`.
    - `summary`: a required string.
    - `blocks`: required. An array of objects `{ kind: required string enum PRESENT_KINDS, title: string, focus: object { rung: integer, from: string, to: string } }`.
    - `choices`: an array of objects `{ label: required string, stock: string }`.
  - **Output** is `{ schema: { type: "string" }, render: (_a, r) => [{ type: "text", text: r }] }`.
  - **On ok**, `execute(args, exec)` calls `exec.concludeTurn()`, called as a method and never
    destructured, then returns `JSON.stringify({ ok: true, blocks, modules })`.
  - **On refusal** it throws `asToolError(error)`. `concludeTurn` is never called.
  - The description, in Chinese: "市场运行的作答：一两句结论 summary，按当天轻重排的 blocks（verdicts、breadth、indices、ladder、sources），每块一句 title，可标 focus（ladder 的 rung，indices 的 from/to），至多三个 choices。数字只能取自 lunhui_read_run 的 view 摘要。成功即结束本轮。"

- [ ] **Step 1: Write the failing tests.**
  - Freeze and seal a run the way `lunhui-rows.test.ts` does (FRIDAY fixtures, then a module context
    read).
  - With `exec = { concludeTurn: () => { calls++ } }` and a valid composition built from that run's
    digest, the result parses to `{ ok: true, blocks, modules }` and `calls === 1`.
  - A composition with "88.8%" rejects with code `INVALID_PRESENT`, and `calls === 0`.
  - A child caller (copy the freeze tests' child exec) rejects with `NOT_GRAVIT`.
  - An open run rejects with `MISSING_EVIDENCE`.
  - The route: `GET /data/lunhui/view?strategy=s&run=r&modules=` passes `{ modules: [] }` to the
    service, where it used to give a 400.
  - Update the pinned lists. The roles test asserts that no `roles/*/role.yml` allows
    `lunhui_present`.
- [ ] **Step 2:** Run
  `npx tsx --test tests/lunhui-present.test.ts tests/lunhui-view-route.test.ts tests/boot.test.ts tests/bots.test.ts tests/lunhui-rows.test.ts tests/roles.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement the row and the two one-line list edits in `lunhui.ts`. Make the route
  change, and update `lunhui.ts:8-18`'s comment from "eleven" to "twelve".
- [ ] **Step 4:** Run the same command, then `npm test` and
  `FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts`. Expected: PASS and 0 failing.
- [ ] **Step 5:** Commit: "feat: lunhui_present, Gravit's composed answer, ends the turn on ok".

### Task 3: The protocol split and the follow-up sentence

**Files:**
- Modify: `dsh/profile/lunhui-run.md` (line 31), `dsh/profile/lunhui-module.md` (line 12), `GRAVIT.md`
  (after line 38)
- Regenerate: `bots/gravit/agent.cordis.yml` with `cd face && npm run render:roles`
- Test: `face/tests/protocols.test.ts:26,32,106`, `face/tests/gravit-md.test.ts`,
  `face/tests/roles.test.ts:243-251`

**Interfaces:**
- Consumes: `lunhui_present` is registered (Task 2; `protocols.test.ts:73-80` requires it).
- Produces: the texts below. Tighten their wording only if a byte cap demands it, keep the named
  words, and record any change in the report.

`lunhui-run.md` line 31 (now 390 B) becomes:

> 最后：市场频道调用 lunhui_present 作答：一两句结论；按当天轻重选块排序，每块一句标题，可标重点；至多三个追问；数字只取自 lunhui_read_run 的 view 摘要，不要另写报告。策略频道给操作者的消息：leader、反证、mode 要点，哪些模块 NOT_EVALUABLE、缺哪些来源，行情是否 delayed。

`lunhui-module.md` line 12 becomes:

> - 最后：cn-market 的 environment、sentiment、theme、counterevidence 调用 lunhui_present 作答并写明 module；leader、mode 与策略频道的 counterevidence 只报本模块要点、是否 NOT_EVALUABLE 及缺哪些来源、行情是否 delayed。

`GRAVIT.md` gains this after the Lunhui line (38):

> After a Lunhui market run, answer with `lunhui_present`, and answer follow-ups about that run the same way; every number you write comes from `lunhui_read_run`'s view digest.

- [ ] **Step 1: Write the failing test changes.**
  - In `protocols.test.ts:32`, drop `"environment.json"`, `"sentiment.json"`,
    `"counterevidence.json"` and `"blocked"`, and add `"lunhui_present"`.
  - Append `"lunhui_present"` to the ordered tool list at line 26.
  - Add `"lunhui_present"` to the module words at line 106.
  - Add a `gravit-md.test.ts` assertion that `GRAVIT.md` contains `lunhui_present`.
- [ ] **Step 2:** Run `npx tsx --test tests/protocols.test.ts tests/gravit-md.test.ts`. Expected:
  FAIL, because the texts still lack `lunhui_present`.
- [ ] **Step 3:** Edit the three texts, then run `npm run render:roles`.
- [ ] **Step 4:** Run `npx tsx --test tests/protocols.test.ts tests/gravit-md.test.ts tests/roles.test.ts`,
  then `npm test`. Expected: PASS, with the byte caps intact.
- [ ] **Step 5:** Commit: "feat: the market channel answers with lunhui_present, the strategy channel keeps its report".

### Task 4: The composed message, its view and the working-notes fold

**Files:**
- Modify: `face/client/js/host/kinds.js` (beside `seatLift`, 84-113; applied at 169-172)
- Create: `face/client/js/host/lunhui.js`, `face/client/js/reducers/lunhui.js`,
  `face/client/js/render/lunhui/composed.js`, `face/client/js/render/lunhui/notes.js`
- Modify:
  - `face/client/js/data/empty.js` (slice `lunhui: { views: {}, ui: {} }`);
  - `face/client/js/reducers/index.js`;
  - `face/client/js/render/thread.js` (`body()` 58-78, `renderMessage` 95-111, `renderThread`
    117-129);
  - `face/client/js/app.js` (after the render at 357, call `ensureViews`; action `lunhuiRetry`);
  - `face/client/css/app.css`.
- Test:
  - `face/tests/client/kinds.test.js`, `thread.test.js`, `lunhui-host.test.js` (new) and
    `css.test.js`;
  - `face/tests/client/helpers/lunhui-view.js` (new):
    `export const VIEW_1027 = buildView(syntheticSealedRun())`, importing the plugin and fixture
    modules for test data only.

**Interfaces:**
- Produces:
  - `presentLift(name, args, text, isError, callId)` returns `{ kind: "composed", text: args.summary, data: { callId, strategy, run, module, summary, blocks, choices, modules } } | null`.
    - It is null unless `name === "lunhui_present"`, `!isError`, and the result parses to
      `ok: true`.
    - It is applied at the tool-result phase. The emitted message id is `p${callId}`, with
      `from: "gravit"`.
  - `viewKey({ strategy, run, modules })` returns `` `${strategy}/${run}/${modules.join(",")}` ``.
  - `viewPath({ strategy, run, modules })` returns
    `/data/lunhui/view?strategy=…&run=…&modules=…`, with each value `encodeURIComponent`-ed. An
    empty list gives `modules=`.
  - `wantedViews(state)` returns `{ key, strategy, run, modules }[]` for the open conversation's
    composed messages whose key has no entry in `state.lunhui.views`.
  - `ensureViews(store, getJson)` returns a `Promise<void>`. It dispatches `lunhuiViewLoading(key)`,
    then `lunhuiViewLoaded({ key, view })` or
    `lunhuiViewFailed({ key, error: "HTTP <status>" | message })`.
  - Reducer actions: `lunhuiViewLoading`, `lunhuiViewLoaded`, `lunhuiViewFailed`, `lunhuiRetry(key)`
    (deletes the entry), and `lunhuiUi({ id, patch })` (merges into `state.lunhui.ui[id]`).
  - `foldNotes(messages)` returns `Map<composedId, textMessageIds[]>`. For each composed message, it
    collects the Gravit `kind: "text"` messages after the latest `from: "you"` message that precedes
    it, up to the composed message.
  - `composedHtml(m, entry, ui, conv)` returns the summary through the markdown renderer.
    - The blocks follow in the call's order. In this task a block is a skeleton line, e.g.
      "Drawing the ladder…", until `entry.status === "loaded"`. Tasks 5–7 replace the skeletons.
    - On `failed`, it draws one line, `"The run view could not be loaded: <error>"`, and a
      `<button data-action="lunhuiRetry" data-key="…">Retry</button>`.
    - With no `modules`, it fetches with `modules=`.

- [ ] **Step 1: Write the failing tests.**
  - `kinds.test.js`: feed a `tool/call` and a `tool/result` frame (copy `seatCall` and
    `seatResult`, lines 60-63) for `lunhui_present`. An ok result yields a `composed` message with id
    `p<callId>` and the args' summary. An error result yields no composed message. A
    `lunhui_read_run` result yields none.
  - `lunhui-host.test.js`:
    - `viewPath` encodes `cn-market`, the run and `environment,sentiment`.
    - `wantedViews` skips keys already loading.
    - `ensureViews` with a `getJson` that resolves `{ ok: true, view: VIEW_1027 }` ends `loaded`.
    - One that rejects with `status: 404` ends `failed` with `"HTTP 404"` (Review Focus 3).
  - `thread.test.js`:
    - Three Gravit text messages after a user message, then a composed message, render as one
      `<details id="notes-c1-p7" class="notes">` whose summary reads `Working notes · 3`, followed by
      the composed body.
    - A text message after a later user message is not folded.
    - The composed body has class `msg-body composed` and shows the summary.
    - A `failed` entry shows the error line and a `data-action="lunhuiRetry"` button.
    - A refused call then an ok call render exactly one composed body (Review Focus 2).
  - `css.test.js`: add the composed message, in loading, loaded and failed states, to `KINDS` and
    `everyState`.
- [ ] **Step 2:** Run
  `npx tsx --test tests/client/kinds.test.js tests/client/thread.test.js tests/client/lunhui-host.test.js tests/client/css.test.js`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Generalise `kinds.js:170` so that seat writes lift through `seatLift` and `lunhui_present` lifts
    through `presentLift`.
  - In `renderMessage`, a `composed` message gets `cls('msg-body', 'composed')`.
  - In `renderThread`, the folded text messages render inside the notes `<details>` placed before
    their composed message, and nowhere else.
  - `app.js`: after the `root.innerHTML` write, call `lunhui.ensureViews(store, host.getJson)` when
    `wantedViews(state)` is non-empty. Wire `act.lunhuiRetry`.
  - CSS: `.msg-body.composed { max-width: min(820px, 100%) }`, the `.notes` details, and the
    skeleton and error lines, using tokens only.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS and 0 failing.
- [ ] **Step 5:** Commit: "feat: a lunhui_present call draws as a composed answer with its working notes folded".

### Task 5: Verdicts, breadth, sources and the footer

**Files:**
- Create:
  - `face/client/js/render/lunhui/time.js`
  - `face/client/js/render/lunhui/verdicts.js`
  - `face/client/js/render/lunhui/breadth.js`
  - `face/client/js/render/lunhui/sources.js`
  - `face/client/js/render/lunhui/footer.js`
- Modify: `composed.js` (draw these four), `app.js` (actions), `app.css`
- Test: `face/tests/client/lunhui-blocks.test.js` (new), `css.test.js`

**Interfaces:**
- Consumes: plan 1's view fields: `verdicts[]`, `reviewer`, `breadth`, `sources[]`, `frozenAt`, `run`
  and `session`.
- Produces:
  - `chinaStamp(iso)` returns `"MM-DD HH:MM CST"` via `Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", … })`.
  - `verdictsHtml(view, block, ui, id)`.
    - It draws one `<button data-action="lunhuiUi" data-id data-field="tile" data-value="<module>" aria-expanded>`
      tile per verdict: the module name, the state pill, the detail line, and "N challenged" when
      the reviewer holds items against it.
    - The tile named by `ui.tile` expands its `lines` (claims, then challenges with `x`-ids in the
      stress colour).
  - `breadthHtml(view, block, ui, id)`.
    - It has a `seg` (`render/controls.js:8-13`) with Counts and By change, where
      `data-field="breadth"`.
    - Counts: one split bar of three spans with `flex-grow` advancers / unchanged / decliners, the
      `↑ 567 up · 10.5%`, `34 unchanged` and `↓ 4774 down · 88.8%` row, and tiles for limit-up,
      limit-down and turnover.
    - By change: 23 bucket buttons, `data-field="bucket"`. A bucket's height is proportional to its
      count over the largest count.
    - The readout (`role="status"`):
      - Counts: `"Up/down ratio 0.12 · about 1 riser for every 8 fallers"`.
      - By change: `"Bucket −4: 1023 stocks · 19.0% of 5375"`.
      - The bucket names are `Limit-down`, `Limit-up` and `Unchanged` for −11, 11 and 0.
    - Defaults: Counts, and the bucket with the most stocks.
  - `sourcesHtml(view)` draws one row per source: `✓ frozen`, `✗ <codes joined, a repeated code as
    ×n>`, or `—` when the source was not asked. `missingIn` modules are named.
  - `footerHtml(view)` returns
    `"Evidence · index ✓ · limit-up ✓ · boards ✗ · frozen <chinaStamp(frozenAt)> · run <run>"`.

- [ ] **Step 1: Write the failing tests** on `VIEW_1027`.
  - `chinaStamp("2026-10-27T20:16:53.810Z")` is `"10-28 04:16 CST"` with `process.env.TZ` set to
    `"America/New_York"`. Use the save-and-restore pattern of `gravit-plugin.test.ts:82-101`
    (Review Focus 5).
  - The verdicts HTML holds three tiles in the order environment, sentiment, theme. The environment
    tile reads `WEAK` and `2 challenged`. With `ui.tile = "theme"`, the theme tile's lines appear,
    with id `—`.
  - The breadth HTML in Counts holds `flex-grow:567`, `flex-grow:34` and `flex-grow:4774`, and the
    readout reads `Up/down ratio 0.12 · about 1 riser for every 8 fallers`. With
    `ui = { breadth: "dist", bucket: -4 }`, the readout reads `Bucket −4: 1023 stocks · 19.0% of 5375`.
  - The sources HTML has a boards row reading `✗ UPSTREAM_TIMEOUT, UPSTREAM_INVALID ×2`, naming
    `theme`.
  - Each block's headline is `block.title`, escaped. A `<script>` title renders as text.
- [ ] **Step 2:** Run `npx tsx --test tests/client/lunhui-blocks.test.js tests/client/css.test.js`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `act.lunhuiUi` reads `data-id`, `data-field` and `data-value` (numeric for `bucket`) and
    dispatches `lunhuiUi`.
  - The CSS uses tokens only. The split bar takes `--up` and `--down`, and stress takes
    `--warn-fill` and `--warn-text`.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: verdict tiles, breadth, sources and the footer in the composed answer".

### Task 6: The indices block, minute by minute

**Files:**
- Create: `face/client/js/render/lunhui/intraday.js`, `face/client/js/render/lunhui/indices.js`
- Modify:
  - `face/client/js/host/lunhui.js` (cursor functions);
  - `face/client/js/app.js` (the `input` branch for `lunhuiMinute`, a `pointermove` listener on
    `[data-action="lunhuiHover"]`, and `reapplyCursors(root)` right after the inputs are restored at
    366-371);
  - `face/tests/client/helpers/fake-dom.js` (`setAttribute`, and assignable `textContent`, if
    missing);
  - `app.css`.
- Test: `face/tests/client/lunhui-indices.test.js` (new), `css.test.js`

**Interfaces:**
- Consumes: `view.indices.rows[]`, each with `minutes`, `prec`, `last`, `pct` and `amount`, and
  `view.through`. Minute arrays index the 242-point grid. `minuteLabel` is copied as a 6-line pure
  function into `intraday.js`, because the client cannot import the plugin.
- Produces:
  - `chartGeometry(minutes)` returns `{ X(i), Y(p), span }`.
    - The viewBox is `0 0 760 236`, with `X(i) = 56 + i/241·652`.
    - `span = max|p − prec|·1.08`, and `Y(p) = 118 − (p − prec)/span·108`.
  - `intradaySvg(minutes, { focus, minute, id })` returns the SVG string. It draws:
    - the dashed previous-close midline;
    - the price path and per-minute amount bars, coloured up or down by the minute's direction;
    - high and low marks with their grid times;
    - the focus band (`--warn-fill`) from `X(minuteIndex(from))` to `X(minuteIndex(to))`;
    - the cursor `<line id="cur-<id>">` and `<circle id="dot-<id>">`;
    - grid labels at 09:30, 10:30, 11:30/13:00, 14:00 and 15:00.
  - `sparklineSvg(minutes)`: viewBox `0 0 240 28`, `vector-effect="non-scaling-stroke"`.
  - `indicesHtml(view, block, ui, id)`.
    - Index rows are buttons with `data-field="index"`, each holding a sparkline. The selected row
      shows its chart.
    - `<input type="range" id="minute-<id>" data-action="lunhuiMinute" min="0" max="<last index>">`
      defaults to the last index.
    - The readout is `<div id="read-<id>" role="status">`, with the default text for the last
      minute.
    - With no minute line: `"No minute line frozen for <name>"`.
  - `cursorPatch(view, symbol, minute)` returns `{ x, y, readout }`. The readout is
    `"<name> · <HH:MM> · <price 2dp> · <±pct 2dp>% · ¥<amount/1e8, 1dp>亿 this minute"`, with U+2212
    for negatives.
  - `minuteAt(clientX, rect, last)` returns
    `clamp(round(((clientX − rect.left)/rect.width·760 − 56)/652·241), 0, last)`.
  - `applyCursor(doc, id, patch)` sets `x1`, `x2`, `cx` and `cy` on `cur-<id>` and `dot-<id>`, and
    `textContent` on `read-<id>`. It never dispatches.
  - `reapplyCursors(root)` calls `applyCursor` for every `input[data-action="lunhuiMinute"]` whose
    value is not its `max`.

- [ ] **Step 1: Write the failing tests** on `VIEW_1027`'s SSE line (`sh000001`).
  - `chartGeometry`: `X(0) === 56` and `X(241) === 708`, and `Y(prec) === 118`.
  - `intradaySvg` with focus `{ from: "14:00", to: "15:00" }` holds a band starting at `x="545.7"`,
    and the labels `09:30` and `15:00`.
  - `indicesHtml` holds four rows in index order, a range input with `max="241"`, and the readout
    for 15:00.
  - `cursorPatch(view, "sh000001", 241).readout` matches
    `/^上证指数 · 15:00 · 3648\.\d\d · −\d\.\d\d% · ¥[\d.]+亿 this minute$/`.
  - `minuteAt(156, { left: 100, width: 760 }, 241) === 0`, and `minuteAt(808, …) === 241`.
  - `applyCursor` on fake-DOM elements registered by id sets their attributes and text, and the
    store's dispatch count stays unchanged.
  - **Review Focus 4.** After a store-driven redraw, `reapplyCursors` restores the cursor for an
    input whose restored value is 120, so `cur-<id>` gets `x1 === X(120)`.
  - **Review Focus 5.** Under `TZ=America/New_York`, the grid labels still read `09:30` to `15:00`.
- [ ] **Step 2:** Run `npx tsx --test tests/client/lunhui-indices.test.js tests/client/css.test.js`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The `pointermove` listener is passive. It reads `getBoundingClientRect()` and calls `minuteAt`,
    `cursorPatch` and `applyCursor`, and it never dispatches.
  - The `input` branch calls the same three for the slider.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: the indices block draws each index minute by minute with a live cursor".

### Task 7: The ladder block

**Files:**
- Create: `face/client/js/render/lunhui/ladder.js`
- Modify: `composed.js`, `app.css`
- Test: `face/tests/client/lunhui-blocks.test.js`, `css.test.js`

**Interfaces:**
- Consumes: `view.ladder` = `{ unavailable, height, rungs: [{ n, sealed: Stock[], from, promoted, missed: Stock[], broke: Stock[], gap }], firstTries }`.
- Produces: `ladderHtml(view, block, ui, id)`.
  - It draws one row per rung, top down.
  - The rung number is a `<button data-action="lunhuiUi" data-field="rung" data-value="<n>" aria-pressed>`.
  - Sealed chips show the name, the first seal and `broke N` when N > 0.
  - After `missed` / `broke` labels, each name shows today's change, with U+2212 for negatives.
  - A gap row reads `gap · none of <from> sealed`.
  - The right column reads `<n−1>→<n> <promoted>/<from>`, and `1st try <sealed>/<tries>` for rung 1,
    with a meter whose width is `round(promoted/from·100)%`.
  - Stress: rows with `gap` and the `block.focus.rung` row take the `--warn` pair.
  - The selected rung defaults to `block.focus.rung`, else `height`.
  - The readout for the selected rung:
    - `"<n−1>→<n> · <promoted> of <from> · missed: <name ±pct, …> · broke: <name, …>"`;
    - for rung 1: `"First boards · <sealed> of <tries> tries sealed · <broke count> broke"`.
  - The label: `"Limit-up ladder · height <height> · <firstTries.sealed + higher sealed> sealed"`.

- [ ] **Step 1: Write the failing tests** on `VIEW_1027`.
  - Rungs render in the order 5, 4, 3, 2, 1.
  - Rung 3 has the stress class, reads `gap · none of 8 sealed`, and shows `2→3 0/8` with
    `width:0%`.
  - Rung 4's misses read `样本600014 −9.91%`.
  - With `block.focus = { rung: 3 }`, the default readout starts `2→3 · 0 of 8`.
  - With `ui.rung = 1`, the readout reads `First boards · 29 of 53 tries sealed · 24 broke`.
  - Names are escaped.
- [ ] **Step 2:** Run `npx tsx --test tests/client/lunhui-blocks.test.js tests/client/css.test.js`.
  Expected: FAIL.
- [ ] **Step 3:** Implement, with CSS from tokens.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: the ladder block, with promotions, gaps and the stressed rung".

### Task 8: Docs, verification, merge

**Files:**
- Modify: `DEVELOPMENT.md`, `CLAUDE.md`, `Gravit-Docs-and-Prompt-Loops.html`, `face/README.md`

- [ ] **Step 1: Write the docs.**
  - `DEVELOPMENT.md`:
    - the Lunhui rows: `lunhui_present`, its checks, the number rule, `concludeTurn`, and twelve rows
      and eighteen tools;
    - the protocols: the split;
    - the client: `composed`, `host/lunhui.js`, the blocks, the in-place cursor and the notes fold;
    - a residual: since no artifact has an acceptance time, a module re-submitted later on the same
      run draws its newer text in an old answer.
  - `CLAUDE.md`: "eleven in-process dsh rows" becomes twelve, and the `face/client` row gains one
    clause for the composed answer, within its line budget.
  - The loops page (Chinese):
    - loop 2, station 3 (≈437) and station 6 (≈458): the turn ends on an ok `lunhui_present`;
    - station 7 (≈467-472): the lifted composed answer;
    - counts at ≈271 and 380-381 become 十二行 and 十八个;
    - GRAVIT.md's size at ≈193 becomes the new byte count.
  - `face/README.md`: a short "The composed-answer drill". Start the face and the Account, ask
    Gravit for a cn-market run in its channel, and check that the thread ends in the composed answer
    with the notes folded, the slider moving the cursor, and the times in China time.
- [ ] **Step 2:** Run
  `cd face && npm test && npm run typecheck && FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts tests/gravit-client-smoke.test.ts`.
  Expected: all pass.
- [ ] **Step 3:** Commit: "docs: the composed answer, lunhui_present and the protocol split".
- [ ] **Step 4:** Run the whole-branch final review on `model: "fable"`, then fix what it confirms.
- [ ] **Step 5: Merge into local main (O13).** Work in the primary checkout, with no branch switch.
  1. Run `ListAgents` and `git reflog -5`.
  2. Run `git merge --ff-only feat/run-view-2`, then `git log --oneline -3`.

  Never push, and do not touch `strategies/`.
