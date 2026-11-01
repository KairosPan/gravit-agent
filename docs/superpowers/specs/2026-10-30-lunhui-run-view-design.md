# Lunhui run view: a short answer built from live components

**Date:** 2026-10-30 · **Status:** design, awaiting the operator's approval · **Extends:**
`2026-10-25-lunhui-modules-design.md` (lifts its non-goal on 分时 for display only, lines 72–74) and
`2026-10-28-lunhui-module-cards-design.md` (a market module's card run answers the same way) ·
**Canvas:** "Lunhui Run View", https://claude.ai/artifact/Mgn4q4aGv6STGWDU4QvWop (private). Sketch 4,
`Components.dc.html` (the 10-27 answer), is the accepted direction. Sketches 1–3 and the stickies
record the rounds that led to it.

## 0. What changed, and why a new document

The Lunhui read runs as the 10-25 spec designed it, and three live drills (10-26, 10-27, 10-28) show
the result. What the operator reads at the end is the weak part:
- The protocol's last paragraph (`dsh/profile/lunhui-run.md:31`) asks Gravit to restate the run id,
  the snapshot hash, every artifact's points, the NOT_EVALUABLE modules, the delayed flags and the
  counts.
- The thread then shows each model step as its own bubble (`face/client/js/wire/mapper.js:147-154`).
  The 10-28 drill left seven progress bubbles and a report of about a thousand characters.
- No sentence says what the day was, and no stock name can be clicked.

On 2026-10-28 the operator asked: **你看看lunhui这几版的输出，就很verbose，我喜欢能结合图表，以及点击链接就能在右侧
看到相关股票运行，可以用claude design和我交互** (the output is too verbose; combine it with charts; a stock link
should open that stock's movement on the right; iterate on a Claude Design canvas). Eight rounds on
the canvas followed (§4.1). They ended on sketch 4: one opening sentence and four live components
for the 10-27 run, then a stock panel drawn from the stock's own minute line. The operator closed the
rounds with **挺好了已经** (it's already pretty good).

This document decides three things:
- how a run's answer is composed and carried (a structured call, §5.2);
- what the face draws (a catalog of components fed from the run's files, §5.3–§5.5);
- the one piece of evidence the drawing needs and the runs do not keep today: minute lines (§5.6).

It changes no role contract, no artifact and no rule of the chain (§5.10).

## 1. Intent

A Lunhui run ends in an answer the operator reads at a glance:
- Gravit writes one or two sentences, picks a few components from a fixed catalog, orders them by
  what mattered that day, gives each a one-line headline, marks what to look at, and offers up to
  three follow-ups.
- The face draws every number from the run's frozen files: verdict tiles, the advance/decline split,
  the indices minute by minute, the limit-up ladder with yesterday's promotions, and the rest of the
  catalog.
- Each component reads like a small instrument: a headline that states the reading, one control, a
  visual, and a readout line that answers the control.
- Any stock name opens a panel on the right with that stock's minute line against its limit prices,
  its seal moments, its pool facts and the claims that cite it.
- The working notes fold away.

## 2. Goals, non-goals, anti-goals

**Goals**

- G1 One structured call, `lunhui_present`, carries the answer: a summary, the blocks in order with
  their headlines and focus, and the follow-ups. It is validated against the run's files and
  rendered by the face as the answer (§5.2).
- G2 A catalog of components (§5.3): verdicts, breadth, indices (intraday), ladder, yesterday,
  signals and sources. Each has the anatomy *label · headline · control · visual · readout*.
- G3 A stock panel on the right, opened from any stock name in the answer (§5.4).
- G4 A read route that serves a run's view model to the client (§5.5).
- G5 Minute lines frozen with the run: the four indices in the index freeze, and the ladder's
  2-board-and-up names in the limit-up freeze (§5.6).
- G6 The ladder's promotions (晋级), derived from the limit-up evidence (§5.7).
- G7 The protocol's last paragraph rewritten to ask for the call instead of a report, within the
  3,000-byte cap (§5.8). The market module's line in `lunhui-module.md` follows.
- G8 The working notes before a composed answer fold into one collapsed row (§5.9).
- G9 Gravit composes from a digest of the facts the face will draw, and every number it writes must
  come from that digest (M15).

**Non-goals**

- N1 Strategy-run answers (leader, mode) keep their text report in this round. Their blocks (leader
  cards, the mode's rule check) are a later round.
- N2 Live data. A run's view is drawn only from what the run froze. "Now" is a new run, not a refresh.
- N3 Per-block streaming. The client keeps no text or tool-call deltas
  (`face/client/js/wire/mapper.js:385-395`), so a composed answer appears whole when its call lands.
  Canvas sticky c_3 showed blocks appearing one by one; that waits for a later round that handles
  deltas.
- N4 Role contracts. No role sees minute lines, and the promotion measure for the sentiment role is
  a separate task (the canvas's finding s_7: the role sees only 3 of the yesterday rows under the
  30 KiB cap).
- N5 Any change to the up/down colour. The components use the face's tokens, green up and red down
  (O12).
- N6 The Markets screen's A-share charts (`face/client/js/render/markets.js:241-255` draws none).

**Anti-goals** (failures even if everything "works")

- A1 Gravit typing numbers the face also draws: two sources of truth, and the typed one can be wrong.
- A2 Model-written interface code running in the face's page.
- A3 Charts side by side. The operator's words were **图表不要并列，一张一张来** (no charts side by side,
  one at a time).
- A4 A component that shows anything the run did not freeze. Every view must be reproducible from the
  run's files.
- A5 Breaking a drilled rule: only Gravit freezes, only roles submit, a run seals at its first read,
  and the reviewer comes before the mode.

## 3. Constraints the design lives under

**Protocols**
- `lunhui-run.md` is at 2,999 of 3,000 bytes, and `lunhui-module.md` at 1,372 of 1,500
  (`face/src/protocols.ts:37,41,71`). An oversized file refuses the boot (`boot.ts:426-446`).
- Words are pinned by `face/tests/protocols.test.ts`: environment.json, sentiment.json,
  counterevidence.json and blocked in the run file (line 33); NOT_EVALUABLE and delayed in the module
  file (line 106).
- `bots/gravit/agent.cordis.yml` mirrors both files and is re-rendered with `npm run render:roles`.

**Evidence** (all in `face/plugins/lunhui/lib/runs.mjs`)
- Caps: one file per source, 256 KiB per file (1 MiB for limit-up) and 2 MiB per run (453-474,
  585-592).
- Eight freezes per run, refused ones counted (`lib/errors.mjs:12`).
- An item id is `ev_` plus 24 hex of the sha256 over the canonical item (520-526). `run.json` records
  each file's sha256.

**Role contexts** (`lib/contract-core.mjs`)
- The cap is 30 KiB (`MAX_CONTEXT_BYTES`, line 30).
- Only sources a contract names enter a context (622-625). Item kinds that no priority entry names
  only count toward `truncated` (664-762).
- `contentsOf` parses every listed file on every context read, and one unusable file fails them all
  with NO_SUCH_RUN (`runs-row.mjs:155-160, 353-360`).

**Freeze rows**
- `freeze(fetchImpl, args, now)` cannot see the run's other evidence, and `withRun` is not reentrant
  (`freeze-tool.mjs:130-134`; `runs-row.mjs:39-53, 216-221`).
- Tencent has no shared limiter, Eastmoney runs four requests at once, and each reply is capped at
  512 KiB and 7 s (`lib/market.mjs:57, 270-290`; `lib/eastmoney.mjs:14-19`).

**Minute data**
- Tencent's five-day minute endpoint keeps five trading days (Appendix B), so a run's minute lines
  must be frozen at run time or they are gone within a week.
- A minute keeps only its last price, so a break and reseal inside one minute does not show. 多伦科技
  and 赛福天 each broke once on 10-27, yet sit at the limit all 242 minutes.
- Nothing in the tree fetches minutes today.

**Client** (paths under `face/client/js/`)
- There is no build step. The app redraws `root.innerHTML` from one string on every store change
  (`app.js:357`).
- Charts are pure SVG strings (`render/chart.js`). Its `drawn()` is private, and the exports are
  pinned by `face/tests/client/chart.test.js:19`.
- One overlay is open at a time (`reducers/messages.js:8-11`). A `.drawer` is fixed at the right,
  `min(460px,100%)` wide (`face/client/css/app.css:249`).
- `.msg-body` is capped at 66% of the thread (`app.css:168`).
- Time labels use the browser's clock (`time.js:8-11`). The operator's browser runs in
  America/New_York.
- Up/down colour is green-up, set in `face/client/css/tokens.css:8,26,40`.
- A-share Markets pages route as `#/markets/cn:<code>`, while the Lunhui files use `sh`/`sz` codes.

**Routes** (`face/src/http.ts:25, 111-135`)
- The `/data` routes are fenced by a loopback Host, Sec-Fetch-Site and an Origin that matches the
  Host.
- POST bodies are JSON of at most 4,096 bytes.
- No route serves a run's evidence files today (`face/src/channels.ts:393`).

**Tool lists**
- New Lunhui tools are added to `LUNHUI_ROW_IDS` and `LUNHUI_TOOL_NAMES`
  (`face/src/lunhui.ts:23-55`).
- Those lists are pinned in `boot.test.ts:96-98`, `bots.test.ts:94-102`,
  `lunhui-rows.test.ts:716-719` (positionally) and `smoke.test.ts:249-258`.
- Gravit sees every tool (`face/plugins/gravit.js:83-85`). Roles see only the names they
  allow-list, and no bot sees a `lunhui_` tool.
- Gate 2 does not touch `lunhui_` names (`face/src/orders.ts:47-51`).

**Charter**
- The Lunhui rows write only under `strategies/<name>/analysis/`, anchored to a strategy name and a
  run id (`Gravit-Design.md` §4).

**Runs after the seal**
- Evidence files never change after the seal. Artifacts, `run.json`'s `artifacts` list and
  `metrics.json` do change:
  - On 10-27, counterevidence landed about a minute after the seal at 20:16:53Z.
  - Under the cards spec's F6, other cards add artifacts to the same run days later.
- A refused freeze writes nothing. Only `metrics.freezes` counts it (`runs-row.mjs:243-250`), and
  `metrics.rejections` holds module submit categories only.
- `lunhui_read_run` with a run returns the manifest, the metrics and each artifact's headline fields
  (`runs-row.mjs`, `artifactsOf`). No role sees minutes, and the freeze replies carry only derived
  measures.
- `lunhui-run.md:31` closes both chains: the cn-market chain and the strategy chain (leader,
  reviewer, mode).
- The Counterevidence card also runs on strategy channels (`T_REVIEW_STRATEGY`,
  `face/client/js/host/run-sheet-view.js`). A strategy run holds only `evidence-quotes.json`.

**The loop and the fixtures**
- dsh calls the model again after every tool result unless the result sets `concludesTurn`
  (`face/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:573, 1154-1155`).
- Evidence files are gitignored because the repo is public (A26, `face/tests/lunhui-ignore.test.ts`).
  The existing fixtures are synthetic (`face/tests/fixtures/lunhui/README.md`).
- The design builds on the uncommitted change that hides tool rows: `thread.js`, the deleted
  `tool-result.js`, the CSS, tests and docs. A worktree cut from `main` at b2f4dbc still draws them.

## 4. Decisions

### 4.1 The operator's, round by round

| # | Round | The operator's words | What it decided |
|---|---|---|---|
| O1 | 10-28 | 就很verbose，我喜欢能结合图表，以及点击链接就能在右侧看到相关股票运行 | fewer words, visuals, a stock panel on the right |
| O2 | 10-29 | 图表不要并列，一张一张来 | one component per row, never side by side (A3) |
| O3 | 10-29 | ladder | the limit-up ladder is the reading they take every run |
| O4 | 10-29 | 你可以先参考下codex的智慧UI的设计，可以动态编排呈现的效果 | compose per run, after Codex's in-conversation interface (see "Reference") |
| O5 | 10-29 | 10/27那一版 | the 10-27 composition: the day's story sets the order (breadth, then the indices, the ladder last) |
| O6 | 10-29 | 其实我觉得不一定是图片，而是一种更好的UI组件，更直观地展示 | components, not pictures: each block an instrument you can operate |
| O7 | 10-30 | 这一块还不够好，我想要当日走势运行图 | the indices block is the session minute by minute |
| O8 | 10-30 | 好，也换 | the stock panel is the stock's minute line against its limit prices |
| O9 | 10-30 | 挺好了已经 | sketch 4 is the direction |
| O10 | 10-30 | face 先备好一套固定组件，Gravit 只负责挑、排顺序、写标题，数字不会错，样子也统一。 | the catalog (M1), answering Q1 |
| O11 | 10-30 | 第一版只管市场研究的回答 … 龙头和模式（策略频道）先照旧用文字汇报，等它们有了自己的组件再说。 | v1 is the market answers (M14, M16), answering Q3 |
| O12 | 10-30 | 绿涨红跌 | the components use the face's tokens, green up and red down, answering Q2 |
| O13 | 10-30 | 做完合并到本地main即可 | the work, the tool-row change included, merges into local main when done; nothing is pushed (Q5) |

**Reference.** The operator's own Codex visualizations under `~/.codex/visualizations/2026/…`
(fsq-grid, flamingo-attention, pca-projection) are inline widgets. Each has:
- an h3 that states the idea;
- a few controls (segmented buttons with `aria-pressed`, sliders, selects);
- a small SVG;
- an `aria-live` status line that spells out the current reading;
- the host's tokens and form classes.

Codex writes each widget's code itself. OpenAI's Intelligent UI, launched with GPT-6 on 10-07 and
known from coverage only, instead has the model describe components that the host renders. This
design takes the second form (M1).

### 4.2 Mine, each open to the operator

- **M1 Catalog, not model-written code.** The face owns the components, and Gravit only picks,
  orders, titles and focuses them. This holds A1 and A2: every number comes from a frozen file, and
  no model text becomes script. The cost is that Gravit cannot invent a new component; a new kind is
  a face change. Confirmed by the operator (O10).
- **M2 Gravit composes each answer.** It sets which blocks appear, their order and their focus. The
  face validates against the catalog and the run's data, and refuses what does not fit (§5.2). This
  is canvas sticky c_4's first option. The second, a face default order that Gravit only adjusts,
  would make the 10-27 order a rule rather than a judgement.
- **M3 The answer travels as a tool call, `lunhui_present`, not as markdown directives.** A
  directive that the model mistypes renders as raw text. A call is schema-checked, refused with a
  reason, and retried.
  - There is precedent for drawing one tool's call as UI: `seatLift` turns the seat's writes into
    receipts (`host/kinds.js:84-113`).
  - The call is durable in the session log, so a reopened conversation redraws it.
- **M4 The face derives; the client draws.** The new route returns a view model (counts, rungs,
  promotions, minute series, pool facts) computed in Node from the run's files. The client keeps
  only drawing. Derivations then have one home with Node tests, and the client never parses 60 KB
  evidence files.
- **M5 Minute lines ride the existing freezes.**
  - The index freeze adds the four indices' lines, and the limit-up freeze adds the ladder's names.
  - No new freeze row, no new protocol step, and no new call against the eight-freeze budget.
  - Both hosts are already the freezes' own: `web.ifzq.gtimg.cn` serves the index freeze's klines.
- **M6 The ladder's names, not every pool row, get minute lines.**
  - These are today's rows with boards ≥ 2, broken tries at ≥ 2 boards, and yesterday's rows with
    `yesterdayBoards` ≥ 2. That was about 24 names on 10-27, with a cap of 40.
  - First boards open the panel with their pool facts and the line "no minute line frozen for first
    boards".
  - Every pool row would not fit:
    - 10-26 had 160 rows, about 1.2 MB of minute lines, over the 1 MiB limit-up cap.
    - An oversized file refuses the whole freeze (`EVIDENCE_TOO_LARGE`).
    - Covering every row means raising that cap first.
- **M7 China time everywhere in these components.** Minute labels come from the session grid
  (09:30 + i), never from a `Date` in the browser's zone.
- **M8 The composed answer renders when its call's result is ok.** It does not render on the call
  alone, so a refused call never flickers in. A refused call stays hidden like today's tool rows.
- **M9 The working notes fold.**
  - In a turn whose answer is composed, the turn's earlier text bubbles fold into one collapsed row,
    "Working notes · N", and expand on click.
  - Gravit keeps writing them; only the thread folds them.
- **M10 Follow-ups are `{label, stock?}`.** A choice with `stock` opens the panel. Any other choice
  sends its label as the next message in the conversation.
- **M11 Stock names link wherever they appear.** That covers chips inside blocks, and any exact pool
  name in the summary or a headline, matched against the run's limit-up evidence.
- **M12 The panel's buttons are "Ask Gravit about {name}" and "Open in Markets".**
  - "Ask Gravit about {name}" sends a message.
  - "Open in Markets" goes to `#/markets/cn:<code>`.
  - The canvas's "Watch" is dropped; the watch list belongs to Markets.
- **M13 Promotion is a pure derivation in `lib/derive.mjs`**, used by the view route. The sentiment
  role does not read it in this round (N4).
- **M14 v1 covers market answers.** That means the cn-market run's answer and the card runs of the
  four market-side modules: Environment, Sentiment, Theme and Counterevidence. Leader and Mode answer
  as today (N1). Confirmed by the operator (O11).

Settled after the builder check:

- **M15 Gravit composes from a digest of what the face will draw.** Nothing Gravit reads today
  carries the minute lines, the promotions or the gaps.
  - `lunhui_read_run` with a run gains a `view` field: a compact digest, at most about 2 KB, of the
    facts each block would show:
    - the breadth split and its ratio;
    - per index: the close, the change, high and low with their times, and the hour that moved most,
      with its window and change;
    - the ladder's height, rungs, promotions, gaps and misses;
    - yesterday's median;
    - per source, frozen or not.
  - The protocol's step 4 already calls `lunhui_read_run`, so no step is added.
  - A1 restated: a number in `summary` or in a `title` must appear in the digest, and the validator
    refuses one it cannot find (§5.2).
- **M16 Market runs only.** `lunhui_present` refuses a run whose `run.json` kind is not `market`.
  - The closing paragraph of `lunhui-run.md` splits: the market channel calls `lunhui_present`, and
    the strategy channel keeps a short report (§5.8).
  - A Counterevidence card on a strategy channel ends in that report too.
  - This follows M14, which the operator confirmed (O11).
- **M17 Refusals are recorded from now on.** The freeze path adds `refusals: { <source>: [code, …] }`
  to `metrics.json`, so the sources block can say "boards ✗ UPSTREAM_TIMEOUT, UPSTREAM_INVALID ×2".
  Runs from before this change show frozen or not, the artifacts' missing sources and the freeze
  count.
- **M18 An answer draws the run as it was at the call.** Artifacts keep landing after the seal.
  - The ok result records which modules' artifacts were present (module → accepted time).
  - The client asks the route for exactly those modules, and only evidence-derived parts are cached.
  - A reopened Environment answer never grows a Sentiment tile its summary never spoke to, and a
    later Sentiment card is not refused `signals` by a stale cache.
- **M19 An ok call ends the turn.** The result sets `concludesTurn`, so no text follows the
  components. The limits Gravit would state go in the summary or the sources block, before the call.
- **M20 A card run names its module.** The call takes an optional `module`. With it, only that
  module's blocks are allowed, and `verdicts` shows that module's tile alone:

  | module | blocks allowed |
  |---|---|
  | environment | verdicts, breadth, indices, sources |
  | sentiment | verdicts, ladder, yesterday, signals, sources |
  | theme | verdicts, sources |
  | counterevidence | verdicts, sources |

  No theme block in v1: boards failed on every drill day, and a theme block comes with a working
  boards source.
- **M21 Follow-ups about a run may compose.** One sentence tells Gravit so (§5.8), and Appendix A's
  `signals` answer is the example.
- **M22 Fixtures are synthetic.** The repo is public and evidence files are gitignored (A26).
  - Plan 1 builds a synthetic pool set that reproduces §5.7's numbers, and synthetic minute lines
    shaped like 10-27's.
  - The real 10-27 replies fetched on 10-30 are not committed, and no drill depends on them: the
    first run after plan 1 freezes its own minutes.

## 5. The design

### 5.1 The shape of an answer

A composed answer is one message in the thread, drawn from one `lunhui_present` call:

```
G  普跌的一天：四个指数都几乎收在全天最低，连板断在 3 板，情绪方向不明。     ← summary (Gravit)
   ┌ This run · three modules ───────────────────────────────┐            ← verdicts
   ├ Breadth · 5,375 stocks — 近九成个股下跌 ─────────────────┤            ← breadth
   ├ Indices · minute by minute — 14:00 后放量跳水… ──────────┤            ← indices, focus 14:00–15:00
   ├ Limit-up ladder — 断在 3 板：昨天 8 个 2 板，今天一个都没晋级 ┤         ← ladder, focus rung 3
   [打开 上海九百] [为什么情绪是 UNKNOWN？] [接着跑策略模块]                  ← choices
   Evidence index ✓ limit-up ✓ boards ✗ 3 tries · Open run ›                ← footer (always)
```

- The blocks stack one per row.
- The summary and every headline are Gravit's. The label, the numbers, the controls and the readouts
  are the face's.
- The footer is always drawn and is not a block.
- A run whose sources failed composes to the summary plus a sources block. The 10-26 run, whose
  index and boards failed, would show only that.

### 5.2 `lunhui_present`

A new in-process row beside the eleven. It is Gravit's only; no role allow-lists it, and no bot
sees it. It writes nothing. Its job is to check a composition against the run and say yes or why
not.

```
lunhui_present({
  strategy: "cn-market",                    // the channel, as every Lunhui tool takes it
  run: "20261027T201627Z-6937d208",         // a sealed market run of that strategy (M16)
  // module: "sentiment",                   // a card run names its module (M20); the chain's answer omits it
  summary: "…",                             // 1–2 sentences, ≤ 160 characters
  blocks: [                                 // 1–6, in Gravit's order, no kind twice
    { kind: "verdicts" },
    { kind: "breadth",  title: "近九成个股下跌" },
    { kind: "indices",  title: "14:00 后放量跳水，四个指数都几乎收在全天最低",
                        focus: { from: "14:00", to: "15:00" } },
    { kind: "ladder",   title: "断在 3 板：昨天 8 个 2 板，今天一个都没晋级",
                        focus: { rung: 3 } }
  ],
  choices: [                                // 0–3
    { label: "打开 上海九百", stock: "600838" },
    { label: "为什么情绪是 UNKNOWN？" },
    { label: "接着跑策略模块" }
  ]
})
```

**Validation** (refusals name the field and the reason, the way the freeze rows' refusals do)
- The strategy is a known channel, the run is one of its sealed runs, and its `run.json` kind is
  `market` (M16).
- Every kind is in the catalog (§5.3), with no repeats. With `module`, only that module's blocks are
  allowed (M20).
- A block whose data the run lacks is refused with the reason. For example, `indices` on a run whose
  index freeze failed is refused with "the index source was not frozen".
- `title` is at most 40 characters and optional for `verdicts` and `sources`.
- `focus` must make sense for its kind: a rung between 1 and the ladder's height, or a time window
  inside the session's grid and before the minute line's `through`.
- A choice's `stock` must be in the run's pools. A label is at most 30 characters.
- Every number in `summary` and in a `title` appears in the run's digest (M15). Numbers are compared
  as tokens after full-width digits are normalised, and a refusal names the number it could not find.

**The result**
- An ok result is `{ ok: true, blocks: [kinds], modules: { <module>: <accepted time> } }`.
- It sets `concludesTurn`, so the turn ends on the components (M18, M19).
- A refusal names the field and the reason.
- The validation reads the same view model the route serves (§5.5), so "drawable" means one thing.

**The protocol** asks for one call per answer (§5.8). Refused calls before the ok one stay hidden.

### 5.3 The catalog

Every component has the same anatomy:
- a **label** (face, English, small grey: what the block is and its scope);
- a **headline** (Gravit, the block's `title`);
- one **control**: a segmented switch, rung buttons, index rows or a minute slider;
- the **visual**;
- a **readout**: one `aria-live` line that answers the control.

Gravit's `focus` is drawn in the stress colour (canvas: #fdf0e3 / #94480c). The table below is
sketch 4's content, generalised.

| kind | data (view model) | control → readout | focus |
|---|---|---|---|
| `verdicts` | Each market module's status and state from its artifact (environment `index_state`/`liquidity_state`; sentiment `state`/`money_effect`; theme `status`/`missing_sources`), plus the reviewer's items counted per module from counterevidence | A tile toggles its claims and the reviewer's items, the artifacts' texts as written, two lines each | — |
| `breadth` | Advancers, unchanged and decliners, limit-up and limit-down, total turnover, and the 23 buckets as Eastmoney keys them (−11…11) | Counts \| By change; a bucket → its count and share | — |
| `indices` | The four indices: previous close, close, change, day turnover, and the minute line (§5.6) | An index row (each with a sparkline) picks the chart; the slider or the pointer picks the minute → time · price · change · turnover that minute · day turnover | `{from,to}` shades that window and labels the change inside it |
| `ladder` | Rungs from the height down to 1. Each rung has its sealed names (first seal, breaks), its misses (yesterday's names at that height minus today's promoted, with today's change), its breaks at that height, its gaps, and promotion `a/b` from yesterday (§5.7). First tries are `sealed/(sealed+broke)` | A rung's number → that rung's promotion, misses and breaks in words | `{rung}` shades the rung |
| `yesterday` | Yesterday's limit-ups today: the median, the share below −5%, and the names at ≥ 2 boards with today's change | Sort by change \| by boards → the pointed name's line | — |
| `signals` | Sentiment's `state`, `conflict` sentence and measures (break ratio, limit-down count, yesterday median, the highest streak, seal ratio), each placed on the contraction side or the relay side by a fixed table, plus the reviewer's items against sentiment | — (static) | — |
| `sources` | Per source: frozen or not (from `run.json`), the refusal codes where `metrics.json` records them, and the artifacts' missing sources. Runs before M17 show only frozen or not and the freeze count | — (static) | — |

The indices visual is the 分时 chart in sketch 4:
- The previous close is the dashed midline, on a symmetric scale.
- High and low are marked with their times.
- Turnover per minute shows as bars, coloured by the minute's direction.
- The 11:30/13:00 seam is one tick, and the grid is 09:30–11:30 and 13:00–15:00, 242 points.
- A mid-session run's line stops at `through`, and the rest of the axis stays empty.

**Shape of the ladder rungs**
- On 10-27 the rungs are 5 (4→5 1/1), 4 (3→4 3/6), 3 (2→3 0/8, a gap) and 2 (1→2 8/40). First
  tries are 29/53.
- When a row's `boards` disagrees with its streak (the reviewer's x3: 海洋王, "8 天 7 板"), the rung
  uses `boards` (consecutive), and the panel states the streak.

### 5.4 The stock panel

A drawer of a new kind, `stock`, 460 px wide, under the one-overlay rule
(`reducers/messages.js:8-11`). At ≥ 861 px the thread makes room, as it does for Details
(`app.css:256-258`). Any linked name opens it (M11), and so does a choice with `stock` (M10). Its
contents, top to bottom:

1. **Header:** the name; the code, market (SZ/SH main board, ChiNext, STAR, BSE) and industry; Close.
2. **The pool line:** price, change pill and tag (limit-up · n boards / broke · n-board try /
   yesterday's n-board), with "From the limit-up pool frozen … by the market run".
3. **The minute line:**
   - The headline is derived. For example, "Sealed 09:34, broke 1×, held from 09:36 to the close",
     "Touched the limit at 09:36, broke, open at the close", or "Yesterday's 3-board: high +6.61% at
     09:31, closed −9.91% at the limit-down".
   - The limit-up is a solid line. The limit-down is drawn only when it is in range. Limits are ±10%,
     or ±20% for `30`/`68` codes, rounded half up to the fen from the minute line's `prec`.
   - The first and last seal from the pool row are circles on the limit line.
   - Volume bars are scaled to the day's busiest minute. A slider and pointer readout show time ·
     price · change, and "at the limit-up" or "at the limit-down" where it applies.
   - A note line closes the chart:
     - When the pool records breaks the minute line does not show: "each break fell inside a minute,
       so the minute line never leaves the limit".
     - When no minute closed at the limit: "touched … and broke; no minute closed at the limit".
     - For first boards (M6): "no minute line frozen for first boards".
4. **Tiles:** seal funds, limit price or yesterday's boards; turnover; amount.
5. **In this run:** the claims and reviewer items whose text names the stock, or whose evidence ids
   cite its pool row, with module · id · two lines each. If none: "No claim cites it; it is in the
   limit-up pool only."
6. **Buttons:** Ask Gravit about {name}; Open in Markets (M12).

### 5.5 The view route

`GET /data/lunhui/view?strategy=<name>&run=<id>&modules=<list>` sits behind the same fence as the
other `/data` routes. `modules` is the list the answer's ok result recorded (M18). The strategy must be a channel that `GET /data/modules.json` would list. The run must match
the run-id form and be one of that strategy's runs. Nothing is taken as a path.

**What the route does**
- It reads `run.json`, `metrics.json`, the accepted artifacts of the listed modules,
  `evidence-index.json` and `evidence-limit-up.json` with the plugin's readers.
- It returns the view model: `{ strategy, run, session, frozenAt, through, sources, verdicts,
  breadth, indices, ladder, yesterday, signals, stocks }`.
  - `stocks` is keyed by code and holds each pool row's facts and limits.
  - It also holds the minute line where one was frozen, and the claims citing the stock.
- Evidence never changes after the seal, so the evidence-derived parts may be cached by
  `(strategy, run)`.
- Artifact-derived parts (verdicts, signals, citations) are read per request for the listed modules,
  so a reopened answer draws the run as it was at the call (M18).
- The `view` digest on `lunhui_read_run` (M15) is a compact text rendering of the same model. What
  Gravit writes from and what the face draws come from one computation.

**Failures**
- An unknown strategy or run gives 404 JSON.
- A source that was not frozen, or a file that cannot be read, marks only the blocks that need it as
  `unavailable`, with the reason. The rest still draw.

**Size and shape**
- For 10-27, about 200 KB of JSON, most of it minute series.
- Arrays stay compact: prices to the fen, per-minute volume and amount as numbers, and times
  implicit in the session grid.

### 5.6 Minute lines in the evidence

**The index freeze**
- After its quotes, klines and counts, the index freeze fetches
  `web.ifzq.gtimg.cn/appstock/app/day/query?code=<symbol>` for the four index symbols it already
  quotes.
- It takes the day whose `date` is the run's session. It writes one item per symbol:
  `{ kind: "minutes", symbol, session, prec, through, price[], volume[], amount[] }`.
  - The points cover the 242-minute grid up to `through`.
  - Volume is in lots and amount in CNY, both per minute (differences of the reply's cumulative
    fields).
  - Points after 15:00 are dropped.

**The limit-up freeze**
- After its pools, the limit-up freeze picks the ladder's names (M6) from the rows it just fetched,
  so it needs no new service method.
- It fetches each one's minutes, four in flight, and writes the same item shape keyed by code.
- A name whose fetch fails is left out and recorded as `{ kind: "minutes_missing", symbol, reason }`.
  It does not fail the freeze.

**Effect on the files**
- On 10-27 the index file would grow from 56 KB to about 90 KB (cap 256 KiB). The limit-up file
  would grow from 63 KB to about 240 KB (cap 1 MiB). The run stays under 2 MiB.
- The host lists gain `web.ifzq.gtimg.cn` where they lack it.
- Each item gets its `ev_` id as every item does.

**Effect on roles**
- No contract names `minutes` or `minutes_missing`, so no role context carries them.
- The builder makes sure these kinds do not inflate the `truncated` count that a context shows its
  role (`contract-core.mjs:664-762`).
- The builder also makes sure every file still parses, because `contentsOf` reads them all on every
  context read.

### 5.7 Promotion (晋级)

`promotion(pools)` is a pure function in `lib/derive.mjs`. For each height n ≥ 1, it reads:

| Field | From |
|---|---|
| `from` | Yesterday's rows with `yesterdayBoards = n` |
| `promoted` | Today's limit-up rows with `boards = n+1` whose code is in `from` |
| `broke` | Today's broken rows with `boards = n+1` among `from` |
| `missed` | `from` minus `promoted`, each with today's change from its yesterday row |
| `gap` | True where today has no row at n+1 and n+1 is below the height |

First tries are today's `boards = 1` sealed against those broken.

The plan-1 fixture is synthetic and reproduces the 10-27 run (M22). On the real 10-27 files:
- 4→5 is 1/1.
- 3→4 is 3/6, with 林州重机 −9.91%, 正裕工业 −10.02% and 华阳智能 −2.65% missing.
- 2→3 is 0/8, with 杰克科技 broken.
- 1→2 is 8/40.
- First tries are 29/53.
- Yesterday's pool has 55 rows, 15 of them with `yesterdayBoards` ≥ 2.

### 5.8 The protocol text

**`lunhui-run.md`**
- Line 31 (about 330 bytes) closes both chains today. Within the same bytes, it splits into the
  market channel's call and the strategy channel's short report (M16). For example, before the
  builder tightens it to fit:

  > 市场频道最后调用 lunhui_present 作答：一两句结论；按当天轻重选块排序，每块一句标题，可标重点；至多三个追问；数字只取自 lunhui_read_run 的摘要。策略频道最后报 leader、反证、mode 要点与缺失来源。

- The pinned words in `protocols.test.ts:33` move with it. The new pins are `lunhui_present` and
  `lunhui_read_run`, and the builder drops the four artifact words from that pin.

**`lunhui-module.md`**
- Line 12 becomes the market modules' call, naming `module` ("市场侧模块最后调用 lunhui_present 并写明
  module").
- Leader and mode, and Counterevidence on a strategy channel, keep the text report (M14, M16).
- NOT_EVALUABLE and delayed stay pinned.

**Follow-ups (M21)**
- Add one sentence, in `GRAVIT.md` if its 4,500-byte cap has room (`face/tests/gravit-md.test.ts`),
  else in the run protocol: 关于某次运行的追问，也用 lunhui_present 作答。

**Afterwards**
- Re-render `bots/gravit/agent.cordis.yml`.
- Update `GRAVIT.md` only if its tool notes name the report.

### 5.9 The client

**The call and its data**
- `host/kinds.js` gains a lift beside `seatLift`. A `lunhui_present` call whose result is ok becomes
  a message of kind `composed`: `{ strategy, run, summary, blocks, choices, callId }` (M8). A refused
  call stays hidden.
- `render/thread.js` `body()` draws `composed`:
  - the summary through the markdown renderer, with stock names linked (M11);
  - each block through a pure string renderer under `render/lunhui/`, in the call's order;
  - then the choices and the footer.
- The composed message is not held to `.msg-body`'s 66%. It has its own cap, about 820 px.
- On first draw, the client fetches the view model through `getJsonVia`, passing the modules the ok
  result recorded (M18). It caches the model in the store by `(strategy, run, modules)`. Until it
  lands, each block is a skeleton line ("Drawing the ladder…").

**Charts**
- One intraday-chart function, shared by `indices` and the panel, returns an SVG string.
- `render/chart.js`'s exports stay as pinned.

**Working notes (M9)**
- In a turn with a composed answer, the earlier assistant text bubbles render as one `<details>`
  titled "Working notes · N".

**Interaction state**
- Switches, rung choice, the picked index and the open stock are store state, so a redraw is fine.
- The minute cursor (slider and pointer) updates in place. It patches the cursor and the readout
  nodes without a store change, because a store change redraws `root.innerHTML` (`app.js:357`) and
  would replace the slider mid-drag.

**Time and colour**
- Times are China time from the grid (M7).
- Colour is the face's tokens, green up and red down (O12, `tokens.css:8,26,40`). The canvas drew red
  up; the build does not.

**Links and code mapping**
- Stock names render as buttons with a `data-action` the app handles. Today only `open` acts on an
  `<a>` (`app.js:882`).
- Codes map `sh600838` ↔ `600838` ↔ `cn:600838` in one helper.

### 5.10 What does not change

- The rows' rules: only Gravit freezes, only roles submit, the first read seals, and refusals stay
  as they are.
- The contracts, the artifacts, the reviewer's place in the order, and the chain's protocol steps 1–4.
- The runs card and the module cards' Run sheet. Their conversations now end in a composed answer.
- Gate 2, the Account seat and the order cards.
- Tool rows other than `lunhui_present` stay hidden, as the uncommitted thread change already does.

## 6. Tests and documentation to pin

**Plugin**
- The minutes items' shape.
- A mid-session `through`, a failed name as `minutes_missing`, and points after 15:00 dropped.
- The file caps hold.
- Contexts are unchanged by minutes: the same bytes, and the same `truncated` for every contract.
- `promotion()` on the synthetic fixture gives the numbers in §5.7.
- The freeze budget is unchanged, and a refused freeze records its code under `refusals`.
- `lunhui_read_run` with a run carries the `view` digest, within its size.

**`lunhui_present`**
- Each refusal in §5.2, including:
  - a strategy run;
  - a block outside the named module;
  - a number absent from the digest.
- No write under `analysis/`.
- An ok result names the drawable blocks, records the modules present, and concludes the turn.
- Gravit has the tool; no role and no bot does. Update the pinned tool lists.

**Route**
- The synthetic fixture's view model.
- Unknown strategy or run gives 404, and a cross-site request is refused.
- An unfrozen source marks only its blocks `unavailable`.
- The modules parameter limits verdicts, signals and citations to those modules.
- Evidence-derived parts are cached by run.

**Client** (fake DOM)
- A composed message draws its blocks in the call's order.
- A refused call draws nothing.
- Working notes fold.
- The drawer opens from a name and from a choice, and only one overlay is open at a time.
- Moving the minute cursor does not re-create the slider.
- Labels read China time under a New York `TZ`.
- `chart.test.js` stays green.

**Protocols**
- Byte caps and the new pins. The mirror is re-rendered.

**Smoke**
- One real boot draws the synthetic fixture's composed answer.

**Docs**
- `DEVELOPMENT.md`: the Lunhui rows, the `/data` routes and the client.
- `CLAUDE.md`: the map's `face/client` and `face/plugins/lunhui` lines.
- `Gravit-Docs-and-Prompt-Loops.html`: the last station of the first loop (the final message).
- The 10-25 spec's non-goal on 分时 gets a pointer here.

## 7. Left to the builder

- Exact field names and encodings in the view model and the minutes items.
- The CSS.
- The skeleton text.
- The fixed table that places sentiment measures on the contraction or relay side.
- How "In this run" matches a stock (names in claim text, evidence ids of its pool row).
- The caching policy beyond "sealed runs are immutable".
- The order of blocks inside the composed message's DOM for screen readers (the call's order).
- Whether the minute fetches in the limit-up freeze share Eastmoney's four-at-once limiter or have
  their own.

## 8. Charter and residuals

**Writes and fences**
- No new write surface. `lunhui_present` writes nothing, and minute lines go into the two existing
  evidence files under `strategies/<name>/analysis/<run>/`.
- One new read route under the existing `/data` fence. D10's description of the face's own rows
  still holds.

**Residuals**
- Minute closes hide breaks inside a minute. The panel says so where the pool shows it.
- Tencent's five-day window means a run frozen without minutes, as every run before this change
  was, can never gain them. Earlier runs draw their indices as "unavailable: no minute line frozen".
- The intraday chart reads only one host. A Tencent minute outage leaves that block unavailable for
  the run.

## 9. Open items

None. The operator answered the four questions on 2026-10-30 (O10–O13):
- Q1, the catalog: yes (O10).
- Q2, colour: green up, red down (O12).
- Q3, the market-only cut: yes (O11).
- Q5, the baseline: the tool-row change goes in with the work, and the whole merges into local main
  when done (O13).

Q4 was settled after the builder check: minute lines for every pool row would break the 1 MiB
limit-up cap, so v1 keeps the ladder's names (M6).

## 10. Order of plans

0. **Baseline.** The uncommitted tool-row change is the work branch's first commit. All plans merge
   into local main when done, and nothing is pushed (O13).
1. **Evidence and the view.** Plan 1 is server-only and can be tested without the client. It covers:
   - minutes in the index and limit-up freezes;
   - the refusal record in `metrics.json`;
   - `promotion()`;
   - `GET /data/lunhui/view`, and the `view` digest on `lunhui_read_run`;
   - the synthetic fixtures (M22).
2. **The composed answer.** Plan 2 covers:
   - `lunhui_present`, with its checks and `concludesTurn`;
   - the protocol split and the follow-up sentence;
   - `composed` in the client;
   - the verdicts, breadth, indices, ladder and sources blocks, and the footer;
   - the working-notes fold.
3. **The panel and the rest.** The stock drawer, choices, `yesterday` and `signals`, the docs and the
   smoke.

## Appendix A: the 10-27 answer as a call

The call in §5.2 is the 10-27 answer of sketch 4. Its summary:

> 普跌的一天：四个指数都几乎收在全天最低，连板断在 3 板，情绪方向不明。

What the face draws from the run's files:
- **Verdicts:** environment WEAK and liquidity CONTRACTING (2 reviewer items); sentiment UNKNOWN
  with money effect MIXED (3 items); theme NOT_EVALUABLE, boards missing.
- **Breadth:** 567 up, 34 unchanged, 4,774 down; limit-up 41, limit-down 22; turnover ¥1.46万亿.
- **Indices:** the four lines, with the focus window 14:00–15:00 carrying the session's loss. The SSE
  lost 1.17 of its 1.33% after 14:00, the SZ Component 1.97 of 2.50%, ChiNext 2.55 of 3.41% and the
  CSI 300 1.28 of 1.32%. Per-minute turnover in 14:31–14:56 ran about 1.9× its 13:01–14:00 level.
- **Ladder:** as §5.7, with rung 3 stressed.

The follow-up "为什么情绪是 UNKNOWN？" would be answered by a second composed answer:

```
{ summary: "四条读数两两打架，所以记 UNKNOWN。反证员补了一条：41 家涨停盖不过 4774 家下跌。",
  blocks: [ { kind: "signals", title: "两条说收缩，两条说接力还在" } ] }
```

## Appendix B: Tencent's minute line, as measured on 10-30

- **Endpoint:** `https://web.ifzq.gtimg.cn/appstock/app/day/query?code=<sh|sz><code>`.
- **Reply:** `data.<code>.data` is five trading days, newest first. Each day is `{ date: "YYYYMMDD",
  prec: "<previous close>", data: ["HHMM price cumVolume cumAmount", …] }`.
- **Points:** an index day has 242 points (0930–1130, then 1300–1500). A stock day also carries
  after-hours points to 1530, which are dropped.
- **Units:** cumulative volume is in lots, and ×100 matches the frozen `volumeShares`. Cumulative
  amount is in CNY and matches `amountCny`.
- **Checks:**
  - All four indices' 10-27 open and close match `evidence-index.json`.
  - All 16 ladder stocks' 15:00 prices match the 10-27 pool.
  - The limits computed from `prec` (±10% / ±20%, rounded half up to the fen) equal the pool's
    sealed prices.
