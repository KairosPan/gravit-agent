# Lunhui run view, plan 3: the stock panel and the rest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 3 finishes the composed answer. Stock names become links that open a stock drawer on
the right, with the stock's minute line against its limit. Gravit's follow-ups draw as buttons. The
catalog gains the `yesterday` and `signals` blocks, the footer gains "Open run ›", and one real boot
draws the whole answer.

**Architecture:**
- **Server.** The server change is small. Plan 1's view model already carries `yesterday`, `signals`
  and `stocks`, each stock with its facts, limits, minute line and citations. So `lib/present.mjs`
  only opens the catalog to the two new kinds.
- **Client, the drawer.** The drawer is a new overlay under the one-overlay rule. Its state is
  `state.lunhui.stock = { key, code }`, the view key of the answer it was opened from plus the
  stock's code, so it draws the answer's own view (M18).
- **Client, the chart.** The drawer reuses the indices block's intraday chart, extended with limit
  lines and seal marks, and the in-place minute cursor.
- **Client, rendering.** Links, choices and the two blocks are pure string renderers, as in plan 2.

**Tech Stack:** the same as plan 2.
- The plugin is ES modules (`face/plugins/lunhui/**/*.mjs`).
- The client is no-build ES modules (`face/client/js`).
- Tests are `node:test` through `npx tsx --test`.
- Client tests use the fake DOM (`face/tests/client/helpers/fake-dom.js`) and the `VIEW_1027` helper
  (`face/tests/client/helpers/lunhui-view.js`).

**Spec:** `docs/superpowers/specs/2026-10-30-lunhui-run-view-design.md`.
- This plan implements §5.3 (the `yesterday` and `signals` rows), §5.4, §5.9 (links, code mapping,
  open stock), §6 (the client, smoke and docs rows left by plan 2) and M6, M10–M12 and M20 (the
  sentiment row).
- Plans 1 and 2 are merged into local main at `c303f5be`.

## Global Constraints

**Carried from plan 2**
- The catalog is face-owned (O10, M1). Gravit picks, orders, titles and focuses. The face draws every
  number from the view model, and no model-written markup reaches the page. Every label, title and
  name is escaped.
- Colours are the face's tokens, green up and red down (O12): `--up`, `--down`, `--up-fill`,
  `--down-fill`, `--warn-fill`, `--warn-text`.
  - `app.css` gets no hex colours.
  - `css.test.js` requires every emitted class to be styled, and every styled class to be emitted.
- Times are China time (M7). Minute labels come from the 242-point grid (`minuteLabel`). ISO stamps
  go through `chinaStamp`.
- Face-drawn numbers follow plan 1's digest grammar, through the shared helpers in
  `face/client/js/render/lunhui/block.js`:
  - `yuan` for amounts (X.XX万亿 / X.XX亿 / whole yuan);
  - `signedPct`/`fix2` for percentages and prices (U+2212, "+" on non-zero positive, no −0.00);
  - `count` for counts.
  - Never write a second formatter.
- Face chrome is English. Gravit's summary, titles and choice labels are shown as written.
- The fake DOM has no `querySelector`. Renderers are pure functions of `(view, block, ui, id)`, and
  app wiring is tested in `face/tests/client/app-dom.test.js`.

**New in this plan**
- **One overlay at a time** (`reducers/messages.js` `closeOverlays`). Opening the stock drawer
  closes Details, Settings, the sheets and the Account drawers, and opening any of them closes the
  stock drawer. `nav` and Escape close it too.
- **The drawer draws the answer's view.**
  - `state.lunhui.stock.key` is the opening answer's `viewKey`, and `state.lunhui.views[key]` is
    what it draws.
  - A view still loading draws "Loading {code}…". A failed view draws its error. A code the view
    does not hold draws "{code} is not in this run's pools."
- **Code mapping.** `sh600838`, `600838` and `cn:600838` map to one another in one helper module
  (`host/lunhui.js`).
- **Links.**
  - A name is a link only when its code is a key of `view.stocks`.
  - In the summary and in headlines, a name is linked only where it matches a pool name exactly, in
    text outside any tag and outside `<a>…</a>`. The longest name matches first.
- **Limits.**
  - The drawer's limit lines are the view's `limitUp`/`limitDown`, never recomputed in the client.
    They are null without a minute line.
  - "At the limit-up" means `price >= limitUp − 0.005`, and the limit-down mirrors it.
- **Byte caps.** Nothing in this plan touches `dsh/profile/*.md` or `GRAVIT.md`.
  `lunhui-module.md` sits at 1,500 of its 1,500 B.
- **Two cuts from the spec, decided here.**
  - `yesterday`'s control sorts its rows, and each name opens the drawer, which draws that name's
    line. The spec's pointer readout of "the pointed name's line" (§5.3) is not built.
  - The ladder's streak note, for a row whose `boards` disagrees with its streak (§5.3, 海洋王), is
    not drawn. `StockFacts` carries no streak field.

**Layering and process**
- `face/src` imports nothing from `face/plugins/`.
- Commits are English, written to a file and passed with `git commit -F <file>`.
- Work happens on `feat/run-view-3`, in the worktree `.claude/worktrees/run-view-3`, cut from local
  main. When done it ff-merges into local main, and nothing is pushed (O13). Do not touch
  `strategies/`.
- Run one file with `cd face && npx tsx --test tests/<file>`. The suite is `npm test` plus
  `npm run typecheck`.

## Review Focus

1. **A name inside a longer name or inside a link.** Say the summary holds "上海九百" while "九百" is
   also a pool name, or a name appears inside an http(s) link that `markdownHtml` drew.
   - Expected: the longest name links once, nothing inside `<a>` or inside a tag's attribute
     changes, and the rest of the summary is byte-identical to `markdownHtml`'s output.
   - Owner: Task 2.
2. **The drawer is open when something else happens.** The cases are a live event redrawing the
   thread, opening Details, pressing Escape, or navigating to another conversation.
   - Expected: the drawer survives the redraw with its slider at the same minute. Details replaces
     it. Escape and navigation close it.
   - Owner: Task 4.
3. **A stock with no minute line.** This covers a first board (M6) and a name whose minute freeze
   failed.
   - Expected: the drawer still opens with its header, pool line, tiles and citations, plus one note
     line, and no chart and no slider.
   - Owner: Task 4.
4. **A 20%-limit code and an ST name.** The cases are `300xxx`/`688xxx` and an `*ST` name at 5%.
   - Expected: the limit line sits at the view's `limitUp`. The readout says "at the limit-up" only
     at that price. A limit-down outside the drawn range is not drawn.
   - Owner: Task 4.
5. **A follow-up clicked while Gravit is still answering, or clicked twice.**
   - Expected: each click sends the label once, by the composer's own send path. A label with
     markup arrives as plain text.
   - Owner: Task 5.

## File map

| File | Responsibility |
|---|---|
| `face/plugins/lunhui/lib/present.mjs`, `present-row.mjs` | `yesterday` and `signals` in the catalog, sentiment's blocks, the titles rule, the row's description |
| `face/client/js/host/lunhui.js` | `stockCode`, `marketKey`, `boardOf`; `cursorFor` unchanged in shape |
| `face/client/js/render/lunhui/block.js` | `stockLink`, `linkNames` |
| `face/client/js/reducers/lunhui.js`, `reducers/messages.js` | `lunhui.stock`, `lunhuiStockOpen` and `lunhuiStockClose`; `closeOverlays` and `nav` clear it |
| `face/client/js/render/lunhui/yesterday.js`, `signals.js` (new) | the two blocks |
| `face/client/js/render/lunhui/stock.js` (new) | the drawer, its headline and note derivations |
| `face/client/js/render/lunhui/intraday.js` | limit lines, seal marks, volume bars, stock lines in `cursorPatch` |
| `face/client/js/render/lunhui/composed.js`, `footer.js`, `ladder.js` | links in the summary, titles and chips; the choices row; "Open run ›" |
| `face/client/js/app.js`, `render/messages.js`, `face/client/css/app.css` | the actions, the drawer in the drawers string, the overlay and Escape rules, the room the thread makes for the drawer |
| `face/tests/lunhui-answer-smoke.test.ts` (new) | one real boot draws the synthetic composed answer |

---

### Task 1: `yesterday` and `signals` in the catalog

**Files:**
- Modify: `face/plugins/lunhui/lib/present.mjs` (`PRESENT_KINDS`, `MODULE_BLOCKS`, `TITLED`, `undrawable`)
- Modify: `face/plugins/lunhui/present-row.mjs` (`PRESENT_DESCRIPTION`, the `title` description)
- Test: `face/tests/lunhui-present.test.ts`, plus whichever test pins `PRESENT_DESCRIPTION` (grep)

**Interfaces:**
- Produces:
  - `PRESENT_KINDS = ["verdicts","breadth","indices","ladder","yesterday","signals","sources"]`;
  - `MODULE_BLOCKS.sentiment = ["verdicts","ladder","yesterday","signals","sources"]` (spec M20), with
    the other modules unchanged.
- Consumes: `view.yesterday` (`{ count, median, belowMinus5Share, rows, unavailable }`) and
  `view.signals` (a `SignalsBlock`, or `null` when sentiment was not read), both from
  `lib/view.mjs` `buildView`.

- [ ] **Step 0: Make the workspace.** From the primary checkout, run
  `git worktree add .claude/worktrees/run-view-3 -b feat/run-view-3 main`, then
  `cd .claude/worktrees/run-view-3/face && npm ci`.
- [ ] **Step 1: Write the failing tests** in `lunhui-present.test.ts`:
  - `"yesterday and signals are in the catalog, and sentiment's card may draw them"`. It asserts the
    two arrays above verbatim.
  - `"yesterday and signals need a title"`. A block without a title is refused with the message
    `INVALID_PRESENT: blocks[0].title: …`.
  - `"signals on a run without sentiment is refused by reason"`. The view is built with
    `modules: ["environment"]`, and the refusal text contains `sentiment`.
  - `"yesterday on a run whose limit-up pools were not frozen is refused with the view's reason"`.
    The refusal contains `limit-up not frozen`.
  - `"an ok call may draw yesterday and signals"`. This uses a composition whose titles hold only
    digest numbers.
- [ ] **Step 2:** Run `cd face && npx tsx --test tests/lunhui-present.test.ts`. Expect the new cases
  to fail.
- [ ] **Step 3: Implement.**
  - Add `yesterday` and `signals` to `TITLED`.
  - In `undrawable`, `signals` with `view.signals === null` gives
    `"这个运行没有读到 sentiment，画不了 signals"`. `yesterday` uses `view.yesterday.unavailable`, as
    the other blocks do.
  - Update `PRESENT_DESCRIPTION` to list
    `verdicts、breadth、indices、ladder、yesterday、signals、sources`.
  - Update the `title` description to `breadth、indices、ladder、yesterday、signals 必填`. Update the
    test that pins the description.
- [ ] **Step 4:** Run the file, then `npm test && npm run typecheck`. Expect everything to pass.
- [ ] **Step 5:** Commit: "feat: yesterday and signals join the composed answer's catalog".

### Task 2: Stock links and the drawer's state

**Files:**
- Modify:
  - `face/client/js/host/lunhui.js`;
  - `face/client/js/render/lunhui/block.js`;
  - `face/client/js/render/lunhui/ladder.js` (`chip`, `named`);
  - `face/client/js/render/lunhui/composed.js`;
  - `face/client/js/reducers/lunhui.js`, `reducers/messages.js` (`closeOverlays`, `nav`), `data/empty.js`;
  - `face/client/js/app.js` (act `lunhuiStock`);
  - `face/client/css/app.css`.
- Test: `face/tests/client/lunhui-host.test.js`, `lunhui-blocks.test.js`, `thread.test.js`,
  `app-dom.test.js`, `css.test.js`

**Interfaces:**
- Produces:
  - `stockCode(raw: string): string | null`.
    - `"sh600838"`, `"sz000001"`, `"bj830799"`, `"600838"` and `"cn:600838"` each give the six
      digits.
    - Anything else gives null.
  - `marketKey(code): string`, which gives `cn:<code>`.
  - `boardOf(code): string | null`:
    - `60` gives `SH main board`;
    - `688`/`689` give `STAR`;
    - `000`/`001`/`002`/`003` give `SZ main board`;
    - `300`/`301` give `ChiNext`;
    - `4`, `8` and `92` give `BSE`;
    - anything else gives null.
  - `stockLink(stock, key): string`.
    - With a code it draws
      `<button type="button" class="lh-stock" data-action="lunhuiStock" data-key="<key>" data-code="<code>">name</button>`,
      every value escaped.
    - Without a code it draws the escaped name alone.
  - `linkNames(html, view, key): string`:
    - It replaces every exact escaped pool name found in text segments of `html`, outside tags and
      outside `<a>…</a>`, with `stockLink`.
    - Names are tried longest first, and only names of length ≥ 2 that are keys of `view.stocks`
      count.
    - The output is otherwise byte-identical to the input.
  - Drawers receive the view key as a fifth argument: `DRAWERS[kind](view, block, ui, id, key)`.
    `composed.js` passes `viewOf(m).key`.
  - Store state is `lunhui.stock: { key, code } | null` (empty `null`), with these reducers:
    - `lunhuiStockOpen(s, { key, code })` returns `{ ...closeOverlays(s), lunhui: { …, stock: { key, code } } }`.
    - `lunhuiStockClose(s)` sets `stock` to null.
    - `closeOverlays` and `nav` set `lunhui.stock` to null, guarding a state with no `lunhui`.
  - `act.lunhuiStock(el)` dispatches `lunhuiStockOpen` with `{ key: el.dataset.key, code: el.dataset.code }`.
- Consumes: `view.stocks` (each with `code`, `name`), and ladder rungs' `sealed`, `missed` and
  `broke` as `Stock` objects carrying `code`.

- [ ] **Step 1: Write the failing tests.**
  - In `lunhui-host.test.js`, cover each mapping in `stockCode`, `marketKey` and `boardOf` above,
    plus null cases (`"cn:AAPL"`, `""`, `"60083"`).
  - In `lunhui-blocks.test.js`, add these cases:
    - `"a ladder chip is a stock link"`: on `VIEW_1027`, the rung-5 chip HTML contains
      `data-action="lunhuiStock"`, `data-code=` with the rung's code, and `data-key="K"` when
      `ladderHtml(view, block, {}, id, "K")`.
    - `"linkNames links the longest name once and never inside a link"`:
      - the input `'<p>上海九百涨停，见 <a href="https://x/上海九百">上海九百</a></p>'` with stocks
        `{600838:{name:'上海九百'}, 600001:{name:'九百'}}` yields exactly one `lh-stock` button,
        before the `<a>`;
      - the `<a>` element is unchanged;
      - with no stocks, the output equals the input.
    - `"a name not in the view's stocks stays text"`.
  - In `thread.test.js`, add `"a composed answer links pool names in its summary and its titles"`.
  - In `app-dom.test.js`, add three cases:
    - `"clicking a stock link opens the drawer state and closes Details"`;
    - `"navigating away clears the open stock"`;
    - `"Escape clears the open stock"`. This needs the Escape branch, `lunhuiStockClose`, added in
      app.js here.
- [ ] **Step 2:** Run the four client files. Expect the new cases to fail.
- [ ] **Step 3: Implement the Produces list.**
  - `ladder.js` draws chips and missed/broke names through `stockLink`.
  - `composed.js` applies `linkNames` to the summary HTML and to each drawer output's
    `<div class="lh-title">…</div>` inner HTML, and only there.
  - `.lh-stock` is styled as an inline text button: `color: inherit`, a dotted underline in
    `var(--dim)`, and `var(--primary)` on hover. No hex.
- [ ] **Step 4:** Run the files, then `npm test && npm run typecheck`. Expect everything to pass.
- [ ] **Step 5:** Commit: "feat: stock names in a composed answer are links to an open stock".

### Task 3: The `yesterday` and `signals` blocks

**Files:**
- Create: `face/client/js/render/lunhui/yesterday.js`, `face/client/js/render/lunhui/signals.js`
- Modify: `composed.js` (`DRAWERS`, `SKELETON`), `app.css`
- Test: `face/tests/client/lunhui-blocks.test.js`, `css.test.js`

**Interfaces:**
- Consumes:
  - `view.yesterday = { count, median, belowMinus5Share, rows: [{ code, name, yesterdayBoards, pct }], unavailable }`;
  - `view.signals = { state, moneyEffect, conflict, measures: [{ measure, value, side }], challenges: [{ id, against, kind, text }] } | null`;
  - `stockLink` (Task 2).
- Produces:
  - `yesterdayHtml(view, block, ui, id, key)`:
    - the label `Yesterday's limit-ups · <count(count)>`;
    - the headline;
    - the segmented switch `By change | By boards`, as
      `data-action="lunhuiUi" data-field="ysort" data-value="pct|boards"`. The default is `pct`.
      `pct` sorts by change ascending. `boards` sorts by boards descending, then change ascending.
    - two tiles: `Median` (`signedPct(median)`) and `Below −5%` (`fix2(share·100)%`);
    - one row per `rows` entry: the `stockLink` name, `<n>b`, and the change as `signedPct` with a
      bar of width `|pct| / max|pct|` toned up or down;
    - the readout `<count> limit-ups yesterday · median <m> · <s> below −5%`.
    - Unavailable gives `Yesterday's limit-ups were not frozen for this run.` No rows gives
      `No name at two boards or more yesterday.`
  - `signalsHtml(view, block, ui, id)`:
    - the label `Sentiment signals`;
    - the headline;
    - a pill with `state` (the verdicts' pill tones) and `money effect <moneyEffect>`;
    - the `conflict` sentence as written;
    - two columns, `Contraction` and `Relay`, each listing its measures in the view's order;
    - the reviewer's challenges against sentiment as `.lh-line.stress` lines (`id` and text).
    - Measure names map as follows:
      - `break_ratio` → `Break ratio`;
      - `limit_down_count` → `Limit-downs`;
      - `yesterday_negative_tail` → `Yesterday below −5%`;
      - `seal_ratio` → `Seal ratio`;
      - `yesterday_return_median` → `Yesterday median`;
      - `max_streak` → `Highest streak`.
    - Values are written as the digest writes them: `limit_down_count` and `max_streak` whole,
      every other value `fix2`.
    - `signals === null` gives `Sentiment was not read in this run.`
  - Skeletons: `Drawing yesterday…` and `Drawing the signals…`.

- [ ] **Step 1: Write the failing tests** on `VIEW_1027`, and read the fixture's values from the
  view itself, not by hand.
  - `"yesterday sorts by change by default and by boards on the switch"`: the first row's code, with
    `ui.ysort` absent and with `ui.ysort = 'boards'`.
  - `"yesterday's readout and tiles read the view's numbers"`: an exact readout string built from
    `view.yesterday` through the block.js helpers.
  - `"yesterday's names are stock links"`.
  - `"signals splits its measures by side, in order, written as the digest writes them"`.
  - `"signals draws the reviewer's challenges against sentiment, escaped"`: a challenge text with
    `<b>` arrives as `&lt;b&gt;`.
  - `"signals without sentiment says so"`.
- [ ] **Step 2:** Run `npx tsx --test tests/client/lunhui-blocks.test.js tests/client/css.test.js`.
  Expect the new cases to fail.
- [ ] **Step 3: Implement** the two renderers. Register them in `DRAWERS`, add the skeletons, and add
  the CSS with tokens only.
- [ ] **Step 4:** Run the files, then `npm test`. Expect everything to pass.
- [ ] **Step 5:** Commit: "feat: the yesterday and signals blocks".

### Task 4: The stock drawer

**Files:**
- Create: `face/client/js/render/lunhui/stock.js`
- Modify:
  - `render/lunhui/intraday.js` (`chartGeometry`, `intradaySvg`, `bars`, `cursorPatch`);
  - `face/client/js/app.js`:
    - the drawers string at about line 357;
    - `overlayOf` and `drawerOf` at about lines 177–178;
    - the Escape branch;
    - the acts `lunhuiStockClose`, `lunhuiAsk` and `lunhuiMarkets`;
    - a shared `sendText(text)`, which `sendNow` now calls;
  - `render/messages.js` (`with-drawer` while a stock is open);
  - `app.css` (the thread makes room for the 460 px drawer at ≥ 861 px, as for Details).
- Test: `face/tests/client/lunhui-stock.test.js` (new), `lunhui-indices.test.js`, `app-dom.test.js`,
  `css.test.js`

**Interfaces:**
- Consumes:
  - `state.lunhui.stock` and `state.lunhui.views` (Task 2);
  - `view.stocks[code]`, a `StockFacts & { cited }` with these fields: `code`, `symbol`, `name`,
    `industry`, `pool` (`zt`|`zb`|`yesterday`), `price`, `pct`, `boards`, `tried`,
    `yesterdayBoards`, `firstSeal` (`"HH:MM"`), `lastSeal`, `breaks`, `sealFunds`, `limitPrice`,
    `turnover` (the turnover rate, a percent), `amount`, `limitUp`, `limitDown`, `minutes` (with
    `prec`, `price[]`, `volume[]`, `amount[]`), `minutesMissing`, and `cited: [{ module, id, text }]`;
  - `view.frozenAt`;
  - `chinaStamp`, and `stockCode`/`marketKey`/`boardOf`.
- Produces:
  - `chartGeometry(minutes, limits = null)`:
    - With `limits`, `span = max(max|p − prec|, |limits.up − prec|) · 1.08`.
    - Without `limits` it is unchanged, so the indices tests stay green.
  - `intradaySvg(minutes, { focus, minute, id, limits, seals, bars })`. Each new option defaults to
    off.
    - `limits = { up, down }` draws `<line class="lh-limit up">` at `Y(up)`. It draws
      `<line class="lh-limit down">` only when `|down − prec| ≤ span`.
    - `seals = { first, last }` (`"HH:MM"` or null) draws `<circle class="lh-seal">` at
      `X(minuteIndex(t)), Y(up)`.
    - `bars: 'volume'` scales bars to `minutes.volume`. The default stays `amount`.
  - `cursorPatch(view, symbol, minute)` finds the line among `view.indices.rows` and then among
    `Object.values(view.stocks)` by `symbol`.
    - The stock readout is `<name> · <HH:MM> · <price> · <pct>`.
    - It adds ` · at the limit-up` when `price ≥ limitUp − 0.005`, or ` · at the limit-down` when
      `price ≤ limitDown + 0.005`.
    - The index readout is unchanged.
  - `stockHeadline(facts): string`, derived from the minute line when one exists:
    - `zt` with `breaks > 0`: `Sealed <firstSeal>, broke <breaks>×, held from <t> to the close`.
      `t` is the grid time of the first minute from which every later minute is at the limit-up.
    - `zt` with no breaks: `Sealed <firstSeal> and held to the close`.
    - `zb` with a minute at the limit: `Touched the limit at <first such minute>, broke, open at the close`.
    - `zb` with no minute at the limit: `Touched the limit at <firstSeal> and broke`.
    - `yesterday`: `Yesterday's <n>-board: high <signedPct> at <t>, closed <signedPct>`, plus
      ` at the limit-down` when the last price is at the limit-down.
    - With no minute line, the headline is the pool tag (below).
  - `stockNote(facts): string | null`:
    - A first board (`pool === 'zt' && boards === 1`, or `pool === 'zb' && tried === 1`) with no
      line gives `no minute line frozen for first boards`.
    - Any other stock with no line gives `no minute line frozen (<minutesMissing>)`.
    - `zt`/`zb` with `breaks > 0` and every minute from `firstSeal` on at the limit gives
      `each break fell inside a minute, so the minute line never leaves the limit`.
    - `zb` with no minute at the limit gives `touched <firstSeal> and broke; no minute closed at the limit`.
    - Otherwise null.
  - `stockDrawerHtml(state): string` returns `''` when no stock is open. Otherwise it draws
    `<aside class="drawer stock">` with these parts, in order:
    - **Header:** the name; `<code> · <boardOf> · <industry>`; and the Close key, as
      `data-action="lunhuiStockClose"`, `class="close-key"`.
    - **Pool line:** the price, the change pill, and the tag:
      - `limit-up · <boards> boards`;
      - `broke · <tried>-board try`;
      - `yesterday's <n>-board`.

      It ends with `From the limit-up pool frozen <chinaStamp(frozenAt)> by the market run`.
    - **The minute line:**
      - the headline;
      - `intradaySvg` with `limits`, `seals`, `bars: 'volume'` and `id: 's-<code>'`;
      - the slider `<input type="range" id="minute-s-<code>" data-action="lunhuiMinute">`, and the
        chart as `data-action="lunhuiHover"`. Both carry `data-id`, `data-strategy`, `data-run` and
        `data-symbol`, exactly as `indices.js` does.
      - the readout `id="read-s-<code>"`;
      - the note line.
    - **Tiles:**
      - `zt`: `Seal funds` (`yuan`) and `Limit price` (`fix2`);
      - `zb`: `Limit price`;
      - `yesterday`: `Yesterday's boards`;
      - every pool: `Turnover` (`fix2(turnover)%`) and `Amount` (`yuan`).
    - **In this run:** one line per citation, `<module> · <id>` with its text as written. With none,
      `No claim cites it; it is in the limit-up pool only.`
    - **Buttons:**
      - `Ask Gravit about <name>` sends `说说 <name>（<code>）在这次运行里的情况。` through
        `sendText`.
      - `Open in Markets` goes to `#/markets/cn:<code>` via `go({ screen: 'markets', id: marketKey(code) })`.
    - **States:** a view still loading gives `Loading <code>…`. A failed view gives its error words.
      A missing code gives `<code> is not in this run's pools.`
- One overlay:
  - `overlayOf` and `drawerOf` count the stock (`drawer`, `stock:<code>`).
  - Escape closes it after the sheets and before Details.
  - The drawer is drawn inside `<main>` like the other drawers. `reapplyCursors` already covers its
    slider.

- [ ] **Step 1: Write the failing tests** in `lunhui-stock.test.js`, on `VIEW_1027` and on small
  hand-made `StockFacts`:
  - `stockHeadline` and `stockNote`, one case per rule above, with exact strings.
  - `"a 20% code's limit line sits at the view's limitUp"`: a `300xxx` facts with `limitUp` set.
    Assert that the `lh-limit up` line's y equals `chartGeometry(minutes, limits).Y(limitUp)`, and
    that no `lh-limit down` line is drawn when the limit-down is out of range.
  - `"the stock readout says at the limit-up only at that price"`: `cursorPatch` at a minute at
    `limitUp` and at one 0.02 below.
  - `"a stock with no minute line opens with facts, tiles, citations and the note, and no chart"`.
  - `"the drawer's states: loading, failed, not in this run"`.
  - `"In this run lists citations as written, escaped; none says the pool-only line"`.
  - `"the drawer under New York time reads China time"`. `TZ=America/New_York` is set as in plan 2's
    test, and the pool line's stamp is checked.
  - In `lunhui-indices.test.js`, add `"chartGeometry without limits is unchanged"`.
  - In `app-dom.test.js`, add these cases:
    - `"the drawer survives a live redraw with its slider minute"`;
    - `"opening Details replaces the stock drawer"`;
    - `"Ask Gravit sends one message through the composer's path"`;
    - `"Open in Markets routes to cn:<code>"`.
- [ ] **Step 2:** Run the files. Expect the new cases to fail.
- [ ] **Step 3: Implement** the Produces list and the app wiring.
  - Refactor `sendNow` so the composer and every new button share `sendText(text)`. It returns what
    `actions.send` returns and never touches `composerText`.
  - CSS: `.drawer.stock` is 460 px. At ≥ 861 px, `.main.with-drawer.with-stock` gives the thread
    `margin-right: 460px`. Tokens only.
- [ ] **Step 4:** Run the files, then `npm test && npm run typecheck`. Expect everything to pass.
- [ ] **Step 5:** Commit: "feat: the stock drawer, its minute line against the limit".

### Task 5: Follow-ups and "Open run ›"

**Files:**
- Modify: `render/lunhui/composed.js`, `render/lunhui/footer.js`, `app.js` (the acts `lunhuiChoice`
  and `lunhuiOpenRun`), `app.css`
- Test: `face/tests/client/thread.test.js`, `lunhui-blocks.test.js`, `app-dom.test.js`, `css.test.js`

**Interfaces:**
- Consumes:
  - `m.data.choices: [{ label, stock? }]`;
  - `stockCode` and `lunhuiStockOpen` (Task 2), and `sendText` (Task 4);
  - `state.channels: [{ name, workspaceId }]`.
- Produces:
  - **The choices row.** After the blocks and before the footer, in every state (loading, loaded,
    failed), `composedHtml` draws `<div class="lh-choices">` with one
    `<button type="button" class="lh-choice" data-action="lunhuiChoice" data-key=… data-label=… [data-code=…]>label</button>`
    per choice. The label is escaped, and `data-code` appears only when `stockCode(stock)` is
    non-null.
  - **`act.lunhuiChoice`.** With `data-code` it opens the stock drawer. Otherwise it calls
    `sendText(el.dataset.label)` once.
  - **The footer.** `footerHtml(view, channels)` appends
    `<button type="button" class="lh-open-run" data-action="lunhuiOpenRun" data-id="<workspaceId>">Open run ›</button>`
    when a channel's `name` equals `view.strategy`, and nothing otherwise. `composed.js` passes
    `state.channels`, so `thread.js` hands `state` through.
  - **`act.lunhuiOpenRun`** calls `go({ screen: 'channel', id })`. The channel page's runs card
    shows the run.

- [ ] **Step 1: Write the failing tests.**
  - `"choices draw after the blocks and before the footer, escaped, in the call's order"`.
  - `"a stock choice carries its code; a plain one does not"`.
  - `"choices draw while the view is loading and after it failed"`.
  - `"Open run appears only for a known channel"`.
  - In `app-dom.test.js`, add these cases:
    - `"a plain choice sends its label once per click"`, with two clicks giving two sends and the
      text exactly equal to the label;
    - `"a choice with markup in its label sends it as plain text"`;
    - `"a stock choice opens the drawer"`;
    - `"Open run goes to the channel page"`.
- [ ] **Step 2:** Run the files. Expect the new cases to fail.
- [ ] **Step 3: Implement** the Produces list. CSS uses tokens only.
- [ ] **Step 4:** Run the files, then `npm test && npm run typecheck`. Expect everything to pass.
- [ ] **Step 5:** Commit: "feat: a composed answer's follow-ups and Open run".

### Task 6: Smoke, docs, verification, merge

**Files:**
- Create: `face/tests/lunhui-answer-smoke.test.ts`
- Modify:
  - `DEVELOPMENT.md`, `CLAUDE.md`, `Gravit-Docs-and-Prompt-Loops.html`, `face/README.md`;
  - `docs/superpowers/specs/2026-10-25-lunhui-modules-design.md` (one pointer under its non-goal on
    分时, about line 74).

- [ ] **Step 1: Write the smoke.**
  - It is gated by `FACE_SMOKE=1` and is one boot per process, as `gravit-client-smoke.test.ts`
    explains in its header.
  - **Boot.** Use a scratch `mkdtemp` home with AKShare and the Account disabled, as that smoke
    does. Point the `lunhui-runs` row's `strategiesRoot` at a scratch root through
    `cordis.patch.yml` (`face/src/lunhui.ts` notes that a replacement restates `strategiesRoot`).
  - **The run.** Write the synthetic sealed run from `tests/lunhui-view-fixtures.ts`
    (`syntheticSealedRun`) under that root, the way `tests/lunhui-rows.test.ts` writes its view
    fixtures (around line 874).
  - **The route.** Register the view route as `face/src/main.ts` does
    (`registerLunhuiViewRoute(ctx.webServer, …)` with `ctx.get("lunhuiRuns")`). Then fetch
    `/data/lunhui/view?strategy=…&run=…&modules=environment,sentiment,theme,counterevidence` over
    HTTP with the signed-in cookie.
  - **The client.** Build the client store, lift a `lunhui_present` tool call and its ok result
    through `host/kinds.js`, dispatch `lunhuiViewLoaded` with the fetched view, and render the
    thread.
  - **Assertions:**
    - each of the seven kinds' labels appears, in the call's order;
    - the footer appears;
    - at least one `lh-stock` link appears;
    - `stockDrawerHtml` for a ladder name draws its minute chart.
- [ ] **Step 2: Write the docs.**
  - `DEVELOPMENT.md`:
    - the catalog's seven kinds and sentiment's card blocks;
    - the client's links, the drawer and its state, the follow-ups, "Open run ›" and `sendText`;
    - the smoke.
  - `CLAUDE.md`: the `face/client` row's composed-answer clause gains "with stock links, a stock
    drawer and follow-ups", within its line budget.
  - The loops page, in Chinese: the first loop's last station (the final message) says the market
    channel's turn ends in a composed answer, with what the operator can click.
  - `face/README.md`: extend "The composed-answer drill" with these steps:
    - click a ladder name and check the drawer and its limit line;
    - press Escape;
    - click a follow-up;
    - click "Open run ›".
  - The 10-25 spec: one line under the 分时 non-goal pointing to the run view spec §5.4 and §5.6.
- [ ] **Step 3: Verify.** Run
  `cd face && npm test && npm run typecheck && FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts tests/gravit-client-smoke.test.ts tests/lunhui-answer-smoke.test.ts`.
  Expect all of it to pass.
- [ ] **Step 4:** Commit: "docs: the stock drawer, follow-ups and the answer smoke".
- [ ] **Step 5:** Run the whole-branch final review on `model: "fable"`, then fix what it confirms.
- [ ] **Step 6: Merge into local main (O13).** Work in the primary checkout, with no branch switch.
  1. Run `ListAgents` and `git reflog -5`.
  2. Run `git merge --ff-only feat/run-view-3`, then `git log --oneline -3`.

  Never push, and do not touch `strategies/`.
