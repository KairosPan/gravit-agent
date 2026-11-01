# Lunhui run view, plan 1: evidence and the view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze minute lines with each market run, record freeze refusals, and serve a run's view
model (blocks' data) to the client and its digest to Gravit. Server only.

**Architecture:**
- The plugin gains:
  - minute parsing in `lib/market.mjs`;
  - `ladderCodes()` and `promotion()` in `lib/derive.mjs`;
  - a pure `lib/view.mjs` that builds the view model and its digest.
- The index and limit-up freezes append `minutes` items.
- The freeze path records refusals in `metrics.json`.
- The runs service gains `view()`, and `lunhui_read_run` returns the digest.
- `face/src/lunhui-view.ts` serves `GET /data/lunhui/view` through the `lunhuiRuns` service, never
  by importing the plugin.

**Tech Stack:**
- Node 22.
- The plugin is plain ES modules (`face/plugins/lunhui/**/*.mjs`); `face/src` is TypeScript run
  by tsx.
- Tests use `node:test` through `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-lunhui-run-view-design.md`. §5.5–§5.7 and the calls M5,
M6, M15, M17, M18 and M22 are this plan's.

## Global Constraints

**Evidence and contexts**
- Evidence caps stay as they are: 256 KiB per file (limit-up 1 MiB), 2 MiB per run, one file per
  source. The eight-freeze budget is unchanged.
- No contract names `minutes` or `minutes_missing`. Every role context stays byte-identical.
- `face/src` imports nothing from `face/plugins/` (`face/src/channels.ts:153-156`). The route
  reaches the plugin through the `lunhuiRuns` service.

**Minute lines**
- The minute grid has 242 points: 09:30–11:30 is indices 0–120, and 13:00–15:00 is 121–241.
  Points after 15:00 are dropped.
- Times are China-time strings (`"HH:MM"`), never computed from a host or browser clock.

**Ladder names and limits**
- Ladder names (M6): zt rows with boards ≥ 2, zb rows whose tried height is ≥ 2, and yesterday rows
  with `yesterdayBoards` ≥ 2. At most 40. First boards get no minute line.
- Limits are ±10%, or ±20% for codes starting `30`/`68`, rounded half up to the fen from `prec`.
  Names containing `ST` take ±5%, and BSE codes (`4`, `8`, `92`) take ±30%.

**Fixtures and process**
- Fixtures are synthetic (A26). Nothing fetched is committed, and generators are committed beside
  their outputs.
- Commit messages are English, written to a file and passed with `git commit -F <file>`. No
  backticks in `-m`.
- The branch ff-merges into local `main` at the end (Task 11). Nothing is pushed (O13).
- Run one file with `cd face && npx tsx --test tests/<file>`. The suite is `npm test`, plus
  `npm run typecheck`.

## Review Focus

1. **A mid-session freeze (10:09).** Minute arrays end at `through: "10:09"`, and the digest says
   "through 10:09", never "closed". Pinned in Task 1 (the partial parse) and Task 8 (the digest).
2. **Tencent's reply lacks the session's day** (a holiday, or a stale reply). The item becomes
   `minutes_missing` with reason `INVALID_RESPONSE`, and the freeze still succeeds. Pinned in Task 2.
3. **A BSE or unknown-exchange code on the ladder.** It becomes `minutes_missing` with
   `NO_EXCHANGE`, and nothing is fetched for it. Pinned in Task 1 (`minuteItems`).
4. **One code in both zt and zb.** It is counted once, as sealed. Pinned in Task 6.
5. **A run frozen before this change** (no minutes, no `refusals`). The view still builds: index
   rows carry `minutes: null` with `minutesMissing: "NOT_FROZEN"`, sources have empty refusals, and
   the ladder is intact. Pinned in Task 7 and through the service in Task 9.

## File map

| File | Responsibility |
|---|---|
| `face/plugins/lunhui/lib/market.mjs` | + the minute grid, `parseTencentMinutes`, `fetchMinutes`, `minuteItems`, `exchangeOf`, `limitRate`, `limitPrices` |
| `face/plugins/lunhui/lib/derive.mjs` | + `ladderCodes`, `promotion` |
| `face/plugins/lunhui/lib/view.mjs` (new) | `evidenceView`, `buildView`, `mostMoved`, `viewDigest` |
| `face/plugins/lunhui/freeze-index-row.mjs` | append the four indices' `minutes` items |
| `face/plugins/lunhui/freeze-limit-up-row.mjs` | append the ladder names' `minutes` items |
| `face/plugins/lunhui/lib/contract-core.mjs` | skip `minutes` and `minutes_missing` in the digest loop |
| `face/plugins/lunhui/lib/freeze-tool.mjs`, `runs-row.mjs` | `recordRefusal`, `service.view`, the digest on `lunhui_read_run` |
| `face/plugins/lunhui/lib/fixture-fetch.mjs` | route `day/query?code=` to `minutes-<code>.json` |
| `face/src/lunhui-view.ts` (new), `face/src/main.ts` | the route and its registration |
| `face/tests/lunhui-view-fixtures.ts` (new) | `syntheticPools1027()`, `syntheticSealedRun()` |
| `face/tests/fixtures/lunhui/make-minutes.mjs` (new) | writes the synthetic `minutes-*.json` for both fixture dirs |

---

### Task 0: Work branch and the baseline commit

**Files:**
- Modify (copied from the primary checkout's working tree):
  - `CLAUDE.md`, `DEVELOPMENT.md`, `Gravit-Docs-and-Prompt-Loops.html`, `face/README.md`
  - `face/client/css/app.css`, `face/client/js/render/thread.js`
  - `face/tests/client/app-dom.test.js`, `face/tests/client/css.test.js`,
    `face/tests/client/thread.test.js`
- Delete: `face/client/js/render/tool-result.js`, `face/tests/client/tool-result.test.js`
- Modify, stale comments only: `face/client/css/app.css:220`, `face/client/js/host/kinds.js:151`,
  `face/client/js/host/traces.js:4`, `face/client/js/app.js:348`

**Interfaces:**
- Produces: branch `feat/run-view-1` whose first commit carries the tool-row change (spec §3, O13).

- [ ] **Step 1:** Create the worktree with superpowers:using-git-worktrees. The branch is
  `feat/run-view-1` from local `main` (`c34a347a` or later), at `.claude/worktrees/run-view-1`.
  Then run `cd face && npm ci`.
- [ ] **Step 2:** Copy the nine files above from `/Users/pan/Desktop/self-evolve/evolving-alpha-us`
  into the worktree, and `git rm` the two deleted files. Copy nothing under `strategies/`.
- [ ] **Step 3:** Make the four comments that still describe tool rows say that tool calls are
  stored but not drawn. No behaviour changes.
- [ ] **Step 4:** Run `cd face && npm test && npm run typecheck`. Expected: all pass, with 0
  failing.
- [ ] **Step 5:** Commit with `-F`: "feat: hide tool rows in the thread and member Trace, pin the
  narrow composer". Record the commit hash for Task 11.

### Task 1: Minute lines from Tencent

**Files:**
- Modify: `face/plugins/lunhui/lib/market.mjs`
- Test: `face/tests/lunhui-market.test.ts`

**Interfaces:**
- Consumes: `fetchBytes`, `numeric`, `providerError` and `SYMBOL`, all already in `market.mjs`.
- Produces:
  - `MINUTES_URL = "https://web.ifzq.gtimg.cn/appstock/app/day/query"`
  - `minuteIndex(hhmm: string): number | null`
  - `minuteLabel(index: number): string`
  - `parseTencentMinutes(payload: string | object, symbol: string, session: string): Minutes`
    - `Minutes = { symbol, session, prec: number, through: "HH:MM", price: number[], volume: number[], amount: number[], provider: "tencent" }`
    - `session` is `YYYY-MM-DD`.
    - Each array runs from index 0 up to `minuteIndex(through)` inclusive.
  - `fetchMinutes(symbol, session, { fetchImpl = fetch, timeoutMs = 7000 } = {}): Promise<Minutes>`
  - `exchangeOf(code: string): "sh" | "sz" | null`
  - `limitRate(code: string, name = ""): number`
  - `limitPrices(prec: number, rate: number): { up: number, down: number }`
  - `minuteItems(entries: { code?: string, symbol: string | null }[], session, { fetchImpl, inFlight = 4 }): Promise<Item[]>`
    - Each entry yields one item, in entry order.
    - Success: `{ kind: "minutes", code?, ...Minutes }`.
    - Failure: `{ kind: "minutes_missing", code?, symbol, reason }`.
    - `reason` is the thrown error's `code`, or `"NO_EXCHANGE"` when `symbol` is null (no fetch is
      made).

- [ ] **Step 1: Write the failing tests**

```ts
test("minuteIndex maps the session grid and nothing else", () => {
  assert.deepEqual(["0930", "1130", "1300", "1500"].map(minuteIndex), [0, 120, 121, 241]);
  assert.deepEqual(["0925", "1200", "1505"].map(minuteIndex), [null, null, null]);
  assert.deepEqual([0, 120, 121, 241].map(minuteLabel), ["09:30", "11:30", "13:00", "15:00"]);
});
test("parseTencentMinutes picks the session day, fills gaps, drops after-hours", () => {
  const reply = { code: 0, data: { sz000678: { data: [
    { date: "20261028", prec: "16.01", data: ["0930 16.50 100 165000.00"] },
    { date: "20261027", prec: "14.55", data: ["0930 15.24 1000 1524000.00", "0931 15.60 1500 2304000.00",
      "1500 16.01 4000 6300000.00", "1505 16.01 4100 6460000.00"] }] } } };
  const m = parseTencentMinutes(JSON.stringify(reply), "sz000678", "2026-10-27");
  assert.equal(m.prec, 14.55); assert.equal(m.through, "15:00"); assert.equal(m.price.length, 242);
  assert.deepEqual(m.price.slice(0, 3), [15.24, 15.6, 15.6]);
  assert.deepEqual(m.volume.slice(0, 3), [1000, 500, 0]);
  assert.equal(m.price[241], 16.01); assert.equal(m.volume[241], 2500); assert.equal(m.amount[1], 780000);
});
test("a mid-session day ends at through", () => {
  const rows = Array.from({ length: 40 }, (_, i) => `${minuteLabel(i).replace(":", "")} 10.00 ${100 * (i + 1)} ${1000 * (i + 1)}.00`);
  const m = parseTencentMinutes({ data: { sh600838: { data: [{ date: "20261028", prec: "13.31", data: rows }] } } }, "sh600838", "2026-10-28");
  assert.equal(m.through, "10:09"); assert.equal(m.price.length, 40);
});
test("a reply without the session's day is INVALID_RESPONSE", () => {
  assert.throws(() => parseTencentMinutes({ data: { sh600838: { data: [] } } }, "sh600838", "2026-10-27"),
    (e: any) => e.code === "INVALID_RESPONSE");
});
test("limits round half up to the fen", () => {
  assert.deepEqual(limitPrices(12.10, 0.1), { up: 13.31, down: 10.89 });
  assert.equal(limitPrices(8.95, 0.1).up, 9.85); assert.equal(limitPrices(14.55, 0.1).up, 16.01);
  assert.deepEqual(limitPrices(56.14, 0.2), { up: 67.37, down: 44.91 });
  assert.equal(limitPrices(77.76, 0.2).down, 62.21); assert.equal(limitPrices(3.33, 0.1).down, 3.00);
  assert.deepEqual([["600838", "上海九百"], ["301314", ""], ["688001", ""], ["000001", "*ST样本"], ["830001", ""]]
    .map(([c, n]) => limitRate(c, n)), [0.1, 0.2, 0.2, 0.05, 0.3]);
  assert.deepEqual(["600838", "000678", "301314", "830001", "920001"].map(exchangeOf), ["sh", "sz", "sz", null, null]);
});
test("minuteItems marks a code without an exchange and never fetches it", async () => {
  let calls = 0;
  const items = await minuteItems([{ code: "830001", symbol: null }], "2026-10-27", { fetchImpl: async () => { calls++; throw new Error("no"); } });
  assert.deepEqual(items, [{ kind: "minutes_missing", code: "830001", symbol: null, reason: "NO_EXCHANGE" }]);
  assert.equal(calls, 0);
});
```

- [ ] **Step 2:** Run `cd face && npx tsx --test tests/lunhui-market.test.ts`. Expected: FAIL,
  because the new names are not exported.
- [ ] **Step 3:** Implement the Produces list in `lib/market.mjs`.
  - `parseTencentMinutes` mirrors `parseTencentKlines`: the size cap, `JSON.parse` in a try that
    raises `INVALID_RESPONSE`, `numeric()`, and Chinese messages.
  - Per-minute volume and amount are differences of the cumulative fields. A grid gap repeats the
    last price, with 0 volume and 0 amount.
  - `fetchMinutes` mirrors `fetchDailyBars`: the `SYMBOL` check, `fetchBytes`, then a fatal UTF-8
    decode.
  - `limitPrices` works in integer fen: `Math.floor(cents * (1 ± rate) + 0.5 + 1e-9) / 100`.
  - `minuteItems` runs `inFlight` fetches at a time, the way `freezeSample` groups them.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: Tencent minute lines, limit prices and exchange for the Lunhui rows".

### Task 2: The index freeze writes minute lines

**Files:**
- Modify: `face/plugins/lunhui/freeze-index-row.mjs` (after the items at line 77)
- Modify: `face/plugins/lunhui/lib/fixture-fetch.mjs:57-79`
- Create: `face/tests/fixtures/lunhui/make-minutes.mjs`
- Create: `face/tests/fixtures/lunhui/minutes-{sh000001,sz399001,sz399006,sh000300}.json`
- Modify: `face/tests/fixtures/lunhui/README.md`
- Test: `face/tests/lunhui-freeze.test.ts`

**Interfaces:**
- Consumes: `minuteItems` and `INDICES` (`freeze-index-row.mjs:27`).
- Produces: `evidence-index.json` items gain one `minutes` or `minutes_missing` per index, after the
  quotes, bars and counts and before the derived items.

- [ ] **Step 1: Write the generator, run it, then write the failing tests.**
  - The generator `make-minutes.mjs` writes each index file as a five-day reply with dates
    20261019–20261023. Each day has 242 points.
  - Each price is `prec × (1 + 0.004·sin(i/19))` up to i = 180, then a straight line to
    `prec × 0.9867` at i = 241.
  - Cumulative volume grows by `1000 + (i % 7)·100`, and cumulative amount by
    `volume × price × 100`.
  - `prec` values are 3697.52, 11534.38, 2638.23 and 4103.54.
  - The README notes that the files are synthetic and that `make-minutes.mjs` writes them.
  - The tests: the FRIDAY index freeze (session 2026-10-23) writes four `minutes` items in `INDICES`
    order, each with `session: "2026-10-23"`, `through: "15:00"`, 242 prices and an `id`.
  - With `minutes-sz399006.json` removed from the temp fixture dir, that index is
    `{ kind: "minutes_missing", symbol: "sz399006", reason: "PROVIDER_HTTP_ERROR" }`, and the
    freeze's reply is still ok.
  - A reply whose days lack 20261023 gives reason `INVALID_RESPONSE` (Review Focus 2).
  - Update the item-count and kind pins at `lunhui-freeze.test.ts:158-159, 416-418, 467, 471-473,
    486, 537` by four items.
- [ ] **Step 2:** Run `cd face && npx tsx --test tests/lunhui-freeze.test.ts`. Expected: FAIL. The
  fixture fetch 404s `day/query`, and no minutes items exist.
- [ ] **Step 3:** Implement.
  - In `fixture-fetch.mjs`, add a route: when the host is `web.ifzq.gtimg.cn` and the pathname is
    `/appstock/app/day/query`, serve `file(\`minutes-${searchParams.get("code")}.json\`)`, or a 404
    when the file is missing.
  - In `freeze-index-row.mjs`, append
    `await minuteItems(INDICES.map((symbol) => ({ symbol })), session, { fetchImpl })` to the items.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: the index freeze keeps each index's minute line".

### Task 3: The limit-up freeze writes minute lines for the ladder's names

**Files:**
- Modify: `face/plugins/lunhui/lib/derive.mjs` (after `deriveLimitUp`, line 118)
- Modify: `face/plugins/lunhui/freeze-limit-up-row.mjs` (after the derive call, lines 55-62)
- Modify: `face/tests/fixtures/lunhui/make-minutes.mjs`
- Create: `face/tests/lunhui-view-fixtures.ts`
- Test: `face/tests/lunhui-derive.test.ts`, `face/tests/lunhui-freeze.test.ts`

**Interfaces:**
- Consumes: `minuteItems` and `exchangeOf` (Task 1), and the parsed pool rows (`pool`, `code`,
  `boards`, `firstSealAt`, `yesterdayBoards`).
- Produces:
  - `ladderCodes({ zt, zb, yesterday }, cap = 40): string[]`. The order is:
    1. zt rows with boards ≥ 2, by boards descending, then `firstSealAt`, then code;
    2. zb rows not in zt whose tried height is ≥ 2, where tried = `(yesterdayBoards of the same code
       ?? 0) + 1`, by tried descending, then code;
    3. yesterday rows with `yesterdayBoards` ≥ 2 not yet listed, by `yesterdayBoards` descending,
       then code.

    The result is unique and cut at `cap`.
  - `syntheticPools1027()` in `face/tests/lunhui-view-fixtures.ts`, returning parsed-shape rows with
    the `pool` field:
    - **yesterday:** `600001` (yb 4); `600011`–`600016` (yb 3); `000021`–`000028` (yb 2);
      `000101`–`000140` (yb 1). The `pct` values are −9.91, −10.02 and −2.65 for `600014`–`600016`,
      +2.78 for `000021`, and +1.00 for the rest.
    - **zt:** `600001` (boards 5, `firstSealAt "093026"`, breaks 0, `sealFunds 150000000`);
      `600011`–`600013` (boards 4, `firstSealAt "092501" | "092502" | "093409"`, breaks 1);
      `000101`–`000108` (boards 2, `"092500"`); `002001`–`002029` (boards 1).
    - **zb:** `000021` (`limitPrice 47.51`, `firstSealAt "093629"`); `000109`–`000111`;
      `003001`–`003024`; and `002001` again, the overlap (Review Focus 4).
    - Names are `样本` plus the code, except `600001`, which is `上海九百`.

- [ ] **Step 1: Write the failing tests.**
  - `ladderCodes(syntheticPools1027())` deep-equals `["600001","600011","600012","600013",
    "000101",…,"000108","000021","000109","000110","000111","600014","600015","600016",
    "000022",…,"000028"]`, 26 codes.
  - `ladderCodes(pools, 3)` has length 3.
  - The FRIDAY limit-up freeze writes one `minutes` item per `ladderCodes(parsed fixture pools)`
    code, each with `code` and `symbol`. The test computes the expected list with `ladderCodes`.
  - The generator writes stock files for every ladder code of the eastmoney fixture except the last,
    and that code is `minutes_missing` with `PROVIDER_HTTP_ERROR`.
  - `evidence-limit-up.json` stays under 1 MiB.
  - The freeze reply's and the file's `host` now include `web.ifzq.gtimg.cn`. Update the host pin
    in `lunhui-freeze.test.ts`.
- [ ] **Step 2:** Run `npx tsx --test tests/lunhui-derive.test.ts tests/lunhui-freeze.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement `ladderCodes`.
  - In the freeze, after `deriveLimitUp`, append `await minuteItems(codes.map((code) => ({ code,
    symbol: exchangeOf(code) && exchangeOf(code) + code })), session, { fetchImpl })` to `items`.
    Derive must see pool rows only.
  - Add `web.ifzq.gtimg.cn` to the meta `host` through the row's existing host-joining code.
  - Extend `make-minutes.mjs` to write `fixtures/lunhui-eastmoney/minutes-<symbol>.json`.
    - zt prices ramp from `prec × 1.03` to the limit-up at `firstSealAt`'s minute and stay there.
    - zb prices ramp to the limit-up minus 0.01, then decay.
    - Yesterday prices drift to their `pct`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: the limit-up freeze keeps the ladder's minute lines".

### Task 4: Keep minute lines out of role contexts

**Files:**
- Modify: `face/plugins/lunhui/lib/contract-core.mjs` (the digest loop, lines 628-633)
- Test: `face/tests/lunhui-contract-core.test.ts`

**Interfaces:**
- Consumes: the item kinds `minutes` and `minutes_missing` (Tasks 2–3).
- Produces: no new names. Contexts are unchanged.

- [ ] **Step 1: Write the failing test.** For each contract in `lib/contracts/` (environment,
  sentiment, theme, leader, mode, counterevidence), build the context through
  `tests/lunhui-contract-harness.ts` twice: once from the harness evidence, and once with three
  `minutes` items and one `minutes_missing` item appended to the index and limit-up evidence.
  `assert.deepEqual` the two contexts. That covers the bytes, `truncated`, `evidenceIds` and digest
  items.
- [ ] **Step 2:** Run `npx tsx --test tests/lunhui-contract-core.test.ts`. Expected: FAIL, because
  `truncated` gains `{kind:"minutes"}` entries.
- [ ] **Step 3:** In the digest loop, skip items whose `rowKind` is `minutes` or `minutes_missing`,
  with a one-line comment citing spec M5.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npm test`. Expected: 0 failing.
- [ ] **Step 5:** Commit: "fix: minute lines never enter a role's context".

### Task 5: Record freeze refusals in `metrics.json`

**Files:**
- Modify: `face/plugins/lunhui/runs-row.mjs` (the service, near `countFreeze` at 243-250)
- Modify: `face/plugins/lunhui/lib/freeze-tool.mjs` (the `withRun` callback, lines 131-135)
- Test: `face/tests/lunhui-freeze.test.ts`

**Interfaces:**
- Produces:
  - `service.recordRefusal(strategy, run, source, code): Promise<void>` appends `code` to
    `metrics.refusals[source]`.
  - The key `metrics.refusals` is `{ [source: string]: string[] }`. It is absent until the first
    refusal.

- [ ] **Step 1: Write the failing test.**
  - A boards freeze whose fixture fetch returns 500 three times, each refused, leaves
    `metrics.refusals.boards` deep-equal to the three refusal codes the replies carried.
  - A freeze after the seal adds `RUN_SEALED` under its source.
  - A run with no refusal has no `refusals` key, so the exact-shape pins at
    `lunhui-runs.test.ts:397, 531` and `lunhui-rows.test.ts:196` stay as they are.
- [ ] **Step 2:** Run it. Expected: FAIL, with `refusals` undefined.
- [ ] **Step 3:** Implement `recordRefusal`: read with `runs.readRun(dir)`, then write with
  `runs.writeMetrics(dir, { ...metrics, refusals: … })`.
  - In `freeze-tool.mjs`, wrap the steps after `countFreeze` in `try { … } catch (error) { if
    (error?.code) await service.recordRefusal(strategy, run, source, error.code); throw error; }`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: a refused freeze leaves its code in the run's metrics".

### Task 6: `promotion()`

**Files:**
- Modify: `face/plugins/lunhui/lib/derive.mjs`
- Test: `face/tests/lunhui-derive.test.ts`

**Interfaces:**
- Consumes: the pool rows; `syntheticPools1027()` (Task 3).
- Produces: `promotion({ zt, zb, yesterday }): { height, rungs: Rung[], firstTries: { sealed, tries } }`.
  - `Rung = { n, sealed: string[], from: number | null, promoted: number | null, missed: string[], broke: string[], gap: boolean }`
  - `n` is today's boards.
  - Rungs run from `max(height, maxYesterdayBoards + 1)` down to 1.
  - A zb row whose code is in zt is ignored.
  - `sealed` is ordered by `firstSealAt`, then code. `missed` and `broke` are ordered by code.
  - For n = 1, `from` and `promoted` are null, and `broke` is the zb rows of tried height 1.
  - `gap` is true when the rung has no sealed row and n < height.

- [ ] **Step 1: Write the failing tests** on `syntheticPools1027()`.

  `height` is 5 and `firstTries` deep-equals `{ sealed: 29, tries: 53 }`. The rungs:

  | n | sealed | from | promoted | missed | broke | gap |
  |---|---|---|---|---|---|---|
  | 5 | `["600001"]` | 1 | 1 | — | — | — |
  | 4 | `600011`–`600013` | 6 | 3 | `["600014","600015","600016"]` | — | — |
  | 3 | `[]` | 8 | 0 | `000022`–`000028` | `["000021"]` | true |
  | 2 | `000101`–`000108` | 40 | 8 | 29 codes `000112`–`000140` | `["000109","000110","000111"]` | — |
  | 1 | 29 codes | null | null | — | 24 codes `003001`–`003024` | — |

  - In rung 1, `002001` appears in `sealed` but not in `broke` (Review Focus 4).
  - A second test adds a yesterday 5-board `600099` with `pct` 7.81 and no zt row. It yields a top
    rung `n: 6` with `from: 1`, `promoted: 0`, `missed: ["600099"]` and `gap: false`, and `height`
    stays 5.
- [ ] **Step 2:** Run `npx tsx --test tests/lunhui-derive.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `promotion`. Tried height for zb is
  `(yesterdayBoards of the code ?? 0) + 1`, the same rule as `ladderCodes`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: the ladder's promotions from yesterday's pool".

### Task 7: The evidence view

**Files:**
- Create: `face/plugins/lunhui/lib/view.mjs`
- Modify: `face/tests/lunhui-view-fixtures.ts`
- Test: `face/tests/lunhui-view.test.ts`

**Interfaces:**
- Consumes:
  - `promotion`, `limitRate`, `limitPrices` and `minuteLabel`;
  - `sealed = { strategy, run, manifest, metrics, evidence: [{ source, session, items }], artifacts }`,
    as `readSealedRun` returns it plus `metrics`, with artifacts keyed by module.
- Produces:
  - `evidenceView(sealed): { session, through, breadth, indices, ladder, yesterday, stocks }`. Each
    block carries `unavailable: string | null`.
    - **breadth:** `{ advancers, unchanged, decliners, limitUp, limitDown, total, turnover, ratio, buckets }`.
    - **indices:** `{ rows: [{ symbol, name, prec, last, pct, change, amount, minutes: Minutes | null, minutesMissing: string | null }] }`.
      The rows follow index order.
    - **ladder:** `{ height, rungs: [{ n, sealed: Stock[], from, promoted, missed: Stock[], broke: Stock[], gap }], firstTries }`.
    - **yesterday:** `{ count, median, belowMinus5Share, rows }`. The rows are those with
      `yesterdayBoards` ≥ 2, ordered by boards descending, then `pct`.
    - **stocks:** `{ [code]: { code, symbol, name, industry, pool, price, pct, boards, tried, yesterdayBoards, firstSeal: "HH:MM" | null, lastSeal, breaks, sealFunds, limitPrice, turnover, amount, limitUp, limitDown, minutes, minutesMissing } }`.
      - `minutesMissing` is the item's reason, or `"NOT_FROZEN"`.
      - `limitUp` and `limitDown` are computed from `minutes.prec`, or null without minutes.
    - `Stock = { code, name, pct, firstSeal, breaks, sealFunds }`.
  - `mostMoved(minutes, span = 60): { from: "HH:MM", to: "HH:MM", change: number } | null`. `change`
    is in percentage points of `prec`, over the window with the largest |change|.
  - `syntheticSealedRun()` is the 10-27 shape:
    - the four index quotes from spec Appendix A, with the SSE at last 3648.30, prev 3697.52 and
      −1.33%;
    - counts 567 / 34 / 4774 / 41 / 22 / 5375 and the 23 buckets from the 10-27 run;
    - derived `total_turnover` 1460958320000 and `advance_decline_ratio` 0.1187683284457478;
    - the four index minute lines from `make-minutes.mjs`'s formula;
    - `syntheticPools1027()`, with `yesterday_return_median` 0.816 and `yesterday_negative_tail`
      0.164 derived;
    - `minutes` for `600001` and `600011`, and `minutes_missing` for `600012`;
    - the limit-up derived items `seal_ratio` 0.594, `break_ratio` 0.406 and `streak_distribution`
      `{1:29, 2:8, 4:3, 5:1}`, and the index-derived `limit_down_count` 22;
    - the manifest:
      - `run "20261027T201627Z-6937d208"`, `kind "market"`, `session "2026-10-27"`,
        `sealed_at "2026-10-27T20:16:53.810Z"`;
      - evidence for index and limit-up, both with `delayed false`;
      - artifacts `["environment","sentiment","theme","counterevidence"]`;
    - the metrics: `{ freezes: 5, calls: {}, rejections: {}, submitted: [the four modules], refusals:
      { boards: ["UPSTREAM_TIMEOUT","UPSTREAM_INVALID","UPSTREAM_INVALID"] } }`;
    - the artifacts:
      - environment: `{ status "OK", index_state "WEAK", liquidity_state "CONTRACTING", claims c1–c4 }`.
      - sentiment: `{ status "OK", state "UNKNOWN", money_effect "MIXED", conflict, claims c1–c4 }`.
        `conflict` is the 10-27 sentence. Claim c3's text is
        "涨停梯队为 29 家首板、8 家二板、3 家四板、1 家五板，三板断层，最高连板 5 板为上海九百。".
      - theme: `{ status "NOT_EVALUABLE", missing_sources ["boards"], claims [], limitations [two strings] }`.
      - counterevidence: items x1 and x2 against environment, and x3, x4 and x5 against sentiment.

- [ ] **Step 1: Write the failing tests.**
  - `breadth` deep-equals the counts above with `unavailable: null`, and `buckets.length` is 23.
  - `indices.rows` has 4 rows in index order, each with 242 prices. `through` is "15:00".
  - `mostMoved(SSE minutes)` gives `from "14:00"` and `to "15:00"`, with change < −1.
  - `ladder.rungs[1]` (n = 4) `missed[0]` deep-equals
    `{ code: "600014", name: "样本600014", pct: -9.91, … }`. Rung 3 has `gap: true`.
  - `yesterday.count` is 55, `median` is 0.816, and `rows.length` is 15.
  - `stocks["600001"]` has `pool "zt"`, `boards 5`, `firstSeal "09:30"`, a non-null `minutes` and
    `limitUp` 13.31 when prec is 12.10.
  - `stocks["600012"].minutesMissing` is the item's reason. `stocks["002005"].minutesMissing` is
    `"NOT_FROZEN"`.
  - **Old run** (Review Focus 5): with the minutes items stripped, every index row has
    `minutes: null` and `minutesMissing: "NOT_FROZEN"`, `through` is null, and `ladder` is unchanged.
  - **Mid-session** (Review Focus 1): with the SSE minutes cut to 40 points, `through` is "10:09".
  - **Index not frozen** (the 10-26 shape): with the index source removed from the manifest and the
    evidence, `breadth.unavailable` and `indices.unavailable` are both `"index not frozen"`.
    `ladder.unavailable` stays null.
- [ ] **Step 2:** Run `npx tsx --test tests/lunhui-view.test.ts`. Expected: FAIL, because the
  module is missing.
- [ ] **Step 3:** Implement `evidenceView` and `mostMoved`.
  - `through` is the latest `through` among the index minute lines.
  - Seal times `"HHMMSS"` become `"HH:MM"`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: the evidence half of the run view".

### Task 8: The full view and the digest

**Files:**
- Modify: `face/plugins/lunhui/lib/view.mjs`
- Test: `face/tests/lunhui-view.test.ts`

**Interfaces:**
- Consumes: `evidenceView` (Task 7).
- Produces:
  - `VIEW_MODULES = ["environment", "sentiment", "theme", "counterevidence"]`.
  - `buildView(sealed, { modules } = {}): View`. `View` is `evidenceView`, plus:
    - `strategy, run, frozenAt` (`manifest.sealed_at`).
    - `sources`: `[{ source, frozen, delayed, refusals: string[], missingIn: string[] }]`, for
      index, limit-up, boards and quotes.
    - `verdicts`: `[{ module, status, state, detail, challenged, lines: [{ id, text }] }]`, for the
      listed modules among environment, sentiment and theme.
    - `reviewer`: `{ items: [{ id, against, kind, text }] } | null`.
    - `signals`: `{ state, moneyEffect, conflict, measures: [{ measure, value, side }], challenges } | null`.
    - each stock's `cited`: `[{ module, id, text }]`.
  - `modules` defaults to `manifest.artifacts ∩ VIEW_MODULES`, and unknown names are ignored.
  - `viewDigest(view): string`, at most 2,048 UTF-8 bytes.

- [ ] **Step 1: Write the failing tests** on `syntheticSealedRun()`.

  **Sources.** `boards` deep-equals
  `{ source: "boards", frozen: false, delayed: false, refusals: ["UPSTREAM_TIMEOUT","UPSTREAM_INVALID","UPSTREAM_INVALID"], missingIn: ["theme"] }`.

  **Verdicts.**
  - `verdicts.map(v => [v.module, v.state])` gives `[["environment","WEAK"],["sentiment","UNKNOWN"],["theme","NOT_EVALUABLE"]]`.
  - The `detail` values are `"liquidity CONTRACTING"`, `"money effect MIXED"` and `"missing boards"`.
  - `challenged` is 2, 3 and 0.
  - The theme lines are its limitations, with id `"—"`.

  **Modules.** `buildView(s, { modules: ["environment"] })` has one verdict, and `reviewer` and
  `signals` are null.

  **Signals.** The measures map to sides by this fixed table, pinned:

  | measure | side |
  |---|---|
  | `break_ratio` | contraction |
  | `limit_down_count` | contraction |
  | `yesterday_negative_tail` | contraction |
  | `seal_ratio` | relay |
  | `yesterday_return_median` | relay |
  | `max_streak` | relay |

  **Cited.** `stocks["600001"].cited` holds the sentiment claim whose text names `上海九百`.

  **Digest.**
  - `viewDigest` contains the lines
    `"breadth: 567 up · 34 unchanged · 4774 down · ratio 0.12 · limit-up 41 · limit-down 22 · turnover 1.46万亿"`,
    `"verdicts: environment WEAK · sentiment UNKNOWN · theme NOT_EVALUABLE"` and
    `"sources: index ✓ · limit-up ✓ · boards ✗ UPSTREAM_TIMEOUT, UPSTREAM_INVALID×2 · quotes —"`.
  - It contains a ladder line that starts `"ladder: height 5 · 5: 1 sealed, from 4 1/1 · 4: 3 sealed, from 3 3/6"`
    and includes `"3: gap, from 2 0/8"`.
  - It contains an SSE line matching `/^上证指数 3648\.30 −1\.33% · high [\d.]+ \d\d:\d\d · low [\d.]+ \d\d:\d\d · most moved 14:00–15:00 −\d\.\d\d%$/m`.
  - With the minutes cut to 10:09, the first line ends `"through 10:09"`, and no line contains
    "closed".
  - A view whose rungs carry 40 long names stays within 2,048 bytes and ends with `"…"`. Name lists
    are dropped before counts.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `buildView` and `viewDigest`.
  - The detail strings and the side table are as in the test.
  - `max_streak` is the largest key of `streak_distribution`.
  - Numbers are formatted as the tests show: two decimals for prices and percentages, and `万亿`
    for turnover at ≥ 1e12.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: the run view's artifact half and its digest".

### Task 9: The runs service serves the view; `lunhui_read_run` carries the digest

**Files:**
- Modify: `face/plugins/lunhui/runs-row.mjs` (the service; the `lunhui_read_run` reply at 448)
- Test: `face/tests/lunhui-rows.test.ts`

**Interfaces:**
- Consumes: `buildView`, `evidenceView` and `viewDigest` (Tasks 7–8); `readSealedRun`
  (`runs-row.mjs:155-160`).
- Produces:
  - `service.view(strategy, run, { modules } = {}): Promise<View>`.
    - It refuses exactly as `readSealedRun` does: `NOT_A_STRATEGY`, `BAD_RUN_ID`, `NO_SUCH_RUN`,
      and `MISSING_EVIDENCE` for an open run.
    - It caches `evidenceView` by strategy and run, and reads artifacts and metrics on every call.
  - `lunhui_read_run` with a run replies `{ manifest, metrics, artifacts, view: string | null }`,
    where `view` is `viewDigest(...)` when the run is sealed.
  - The tool description gains: "带 run 时另附 view：face 画图用的同一份数字的摘要；作答时标题与结论里的数字只取自这里。"

- [ ] **Step 1: Write the failing tests.**
  - Freeze the FRIDAY fixtures (index and limit-up), then seal with a module context read.
  - `service.view("…", run)` returns `ladder.height` equal to `promotion(parsed pools).height`.
  - A second call reuses the cached evidence part: the two views' `ladder` objects are
    `assert.strictEqual`.
  - The `lunhui_read_run` reply's `view` contains `"ladder:"` and is at most 2,048 bytes.
  - An open run gives `view: null`, and `service.view` refuses it with `MISSING_EVIDENCE`.
  - The view of a run written with the pre-change fixtures (no minutes) builds, with index rows
    carrying `"NOT_FROZEN"` (Review Focus 5).
- [ ] **Step 2:** Run `npx tsx --test tests/lunhui-rows.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as the Produces list says. `metrics` comes from
  `runs.readRun(dir).metrics`.
- [ ] **Step 4:** Run it, then `npm test`. Expected: PASS and 0 failing.
- [ ] **Step 5:** Commit: "feat: the runs service serves the run view, and lunhui_read_run its digest".

### Task 10: `GET /data/lunhui/view`

**Files:**
- Create: `face/src/lunhui-view.ts`
- Modify: `face/src/main.ts` (beside `registerQuoteRoutes`, line 180)
- Test: `face/tests/lunhui-view-route.test.ts`, `face/tests/smoke.test.ts`

**Interfaces:**
- Consumes: `isTrustedDataRequest` (`face/src/http.ts:111-122`), and `booted.ctx.get("lunhuiRuns")`.
- Produces: `registerLunhuiViewRoute(registry, deps: { isTrusted(req): boolean; runs(): { view(strategy: string, run: string, options?: { modules?: string[] }): Promise<unknown> } | undefined }): () => void`.
  It registers the exact route `GET /data/lunhui/view`.

- [ ] **Step 1: Write the failing tests.** Use the fake-registry pattern of
  `tests/lunhui-modules-listing.test.ts:250-298` and requests built with `url`, as in
  `tests/quotes.test.ts:46-49`.

  | Request | Response |
  |---|---|
  | untrusted | 403 `{ ok: false, error: "FORBIDDEN" }` |
  | `runs()` undefined | 503 `{ ok: false, error: "lunhui not mounted" }` |
  | `strategy` or `run` missing or repeated, or an unknown `modules` name | 400 |
  | service throws `NOT_A_STRATEGY` or `NO_SUCH_RUN` | 404 |
  | service throws `BAD_RUN_ID` | 400 |
  | service throws `MISSING_EVIDENCE` | 409 `{ error: "run not sealed" }` |
  | success | 200 `{ ok: true, view }`, and the service received `modules` split on commas |

  In `smoke.test.ts` (FACE_SMOKE), a real boot answers
  `GET /data/lunhui/view?strategy=cn-market&run=20990101T000000Z-00000000` with 404, not 503. That
  proves `main.ts` reaches the service.
- [ ] **Step 2:** Run `npx tsx --test tests/lunhui-view-route.test.ts`. Expected: FAIL, because the
  module is missing.
- [ ] **Step 3:** Implement.
  - Parse the query the way `face/src/quotes.ts:26-30` does.
  - Read the refusal code from the thrown error's `code`.
  - In `main.ts`:
    `registerLunhuiViewRoute(booted.ctx.webServer, { isTrusted: isTrustedDataRequest, runs: () => booted.ctx.get("lunhuiRuns") as … })`.
- [ ] **Step 4:** Run the route test, then
  `FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: "feat: GET /data/lunhui/view serves a run's view model".

### Task 11: Docs, verification, merge

**Files:**
- Modify: `DEVELOPMENT.md` (the Lunhui rows section; the `/data` routes section)
- Modify: `CLAUDE.md` (the `face/plugins/lunhui/` map line: one clause naming `lib/view.mjs`)
- Modify: `docs/superpowers/specs/2026-10-25-lunhui-modules-design.md:72-74` (a pointer: minute lines
  are frozen for display since 2026-10-30)
- Modify: `face/tests/fixtures/lunhui-eastmoney/README.md`

- [ ] **Step 1:** Write the docs.
  - DEVELOPMENT.md: the `minutes` and `minutes_missing` items, `metrics.refusals`, `ladderCodes`,
    `promotion`, `lib/view.mjs` and its digest, `service.view`, and the route with its codes.
  - Keep CLAUDE.md within its line budget.
- [ ] **Step 2:** Run `cd face && npm test && npm run typecheck && FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts`.
  Expected: all pass, with 0 failing.
- [ ] **Step 3:** Commit: "docs: the run view's evidence, the view route and the digest".
- [ ] **Step 4:** Run the whole-branch final review on `model: "fable"`, then fix what it confirms.
- [ ] **Step 5: Merge into local main (O13).** Work in the primary checkout, with no branch switch.
  1. Run `ListAgents` and `git reflog -5`.
  2. Confirm `git diff --quiet <Task 0 hash> -- <the eleven baseline paths>`.
  3. Run `git checkout HEAD -- <the eleven paths>`. That restores the two deleted files as well.
  4. Run `git merge --ff-only feat/run-view-1`, then `git log --oneline -3`.

  Do not touch `strategies/`. Never push.
