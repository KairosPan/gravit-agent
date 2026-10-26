# Lunhui modules — the manuscript's chapters as dsh rows

**Status:** design, written 2026-10-25 against `main @ a89502f` and dsh `0.2.0-rc.2`; **approved
by the operator 2026-10-25** after the builder check (§11) · **Owner:** the operator · **Supersedes:** the plugin form of
`docs/superpowers/specs/2026-10-19-lunhui-plugin-graft-design.md` (its D1, D3, D5–D9, D17–D19);
that spec's build, `feat/lunhui-graft @ 0de97cf`, is **stage 0** of this design and its pure
modules are reused (§5.13). What the graft spec decided about data, knowledge and language (its
D2, D4, D10–D16, D18) stands and is restated here where it binds.

## 0. What changed, and why a new document

The graft put the whole Lunhui agent behind **one MCP server with four tools**, because the new
front end's Discover defined a plugin as one MCP server plus one manifest (gravit-ui spec §7.7).
On 2026-10-25 the operator re-examined that unit against dsh's own: in dsh a plugin is a cordis
row, a tool is what a row registers in-process (`ctx.tools.register(defineTool(...))`), rows share
state through services (`ctx.provide`, `inject`), and dsh itself ships one tool per package
(`dsh-tool-bash`, `dsh-tool-skill`, `dsh-tool-subagent`…). The MCP unit bought one thing, runtime
install through `dsh-mcp-client`'s `apply()`, which the graft spec listed as a non-goal. The
operator chose dsh's unit, and chose to **split by the manuscript's chapters**: five analysis
modules, each its own row, over per-source freeze rows and one shared backbone, with the
market-wide modules living in a **dedicated channel**. Three operator decisions, E1–E3 (§4).

The manuscript 《轮回》 (`docs/research/lunhui/corpus/`, out of git; its paragraph ids `Pxxxx`
as `docs/research/lunhui/README.md` §8 cites them) is organized in nine parts (P0001–P0009):
一、大周期; 二、情绪周期; 三、葵花宝典; 四、龙头与接力模式; 五、容量模式 (moved to another
document); 六、切换、轮动、挖掘、套利; 七、预期; 八、周期(补充); 九、大基金 (numbers without a
source). The 题材 material (P0075–P0153: 题材的时间和空间, 题材启动, 催化/发散, 多题材关系,
题材轮转, 混沌期题材, 消息面) sits between parts one and two without a number of its own. The
source's own design already separates the layers — environment, 情绪, 题材, 个股, 预期 and
discipline (`design/docs/strategy-spec.md` §1) — and keeps "the index and liquidity environment,
market-wide 情绪, 题材 stage and 个股 standing" apart (`design/docs/system-design.md` §4), with
one coordinator and three constrained analysts (§3 there). The five modules below follow the
chapters; the roles follow the source's three analysts.

## 1. Intent

Give Gravit an A-share research run that reads the market the way the manuscript does, one
chapter per module, each module's finding a validated artifact that cites frozen evidence, with
the mode chosen last and only from accepted findings. Keep everything the graft proved: a
host-frozen, hashed sample the model never widens; a fail-closed validator; Chinese for the
model, English for the tree; no trading, no account language, nothing unattended. Make every
piece a dsh row, so the operator can disable one module in a patch line, a role can be masked to
exactly its tools, and no child process is spawned for it.

## 2. Goals, non-goals, anti-goals

**Goals**

- G1. One run reads the market in the manuscript's order. In the market channel: environment and
  大周期, 情绪周期, 题材与轮动. In a strategy channel: 龙头与个股地位, then 模式选择与预期, which
  reads the market run's accepted artifacts and the strategy's prior expectation card and may
  conclude only `S01`, `S02` or `WAIT`.
- G2. Every module artifact is validated under its own contract before it lands: schema, evidence
  ids that exist in the sealed run, CURRENT/HISTORICAL wording, no trading or account language,
  a byte budget, the run's snapshot id; the mode artifact additionally cites the artifacts it
  rests on, and a conclusion resting on a missing or stale market run is refused.
- G3. The reviewer's counterevidence is a first-class artifact of the run, written by its own
  role, which the mode module must address before it concludes.
- G4. Each row is pinned as the tree pins rows: a test, a documentation row, and a sentence on
  what breaks if upstream moves the seam; the three roles are pinned on a real boot.
- G5. The channel page shows a run as a pipeline: which modules landed, each one's headline, the
  mode and expectation at the end, the counterevidence beside them, the full artifacts a click
  away — in the market channel and in each strategy channel.
- G6. The two 2026-10-19 strategies, `lunhui-s01-repair` and `lunhui-s02-rotation`, become
  evaluable in the research sense: their runs cite a market run, a frozen 题材 pool and a frozen
  涨停 pool, so S01's 分歧修复 and S02's 新方向确认 can be judged ex ante and reviewed ex post
  through the expectation card, with no trade.

**Non-goals (this spec)**

- No trading, no order tool, no position, no paper trade of an A share: the Account's venues
  carry no A shares, and the expectation card is reviewed against later frozen facts, not fills.
- No minute bars, 竞价 detail, 封单 or 分时: the modes that need them — 一进二, 竞价战法, T板,
  首阴反包 (R02, R04, R05) — stay `research_only` labels the mode module may name and never
  select.
- No point-in-time history before the first freeze: the Eastmoney pools and boards are live
  queries; a run freezes them, and the record grows forward from the day the freezes begin.
- No scheduler, no unattended run (charter P5); the daily rhythm the source describes
  (`system-design.md` §5) is the operator's, started by hand.
- No MCP server and no manifest for Lunhui; Discover shows the rows as the face's own
  (`/data/plugins.json` lists composed rows by id and phase). A manifest form for in-process rows
  is open (§9).
- No runtime install; rows compose at boot, a row is disabled by an operator patch line.
- No change to the seat, Gate 2, the cycle contract `dsh/profile/cycle.md`, or any bot.

**Anti-goals (a failure even if it works)**

- A path by which the model moves the as-of, widens a sample, adds evidence after the run is
  sealed, or names a path: every freeze is host code over an allow-listed source, every tool
  takes names and ids, and a run seals on its first context read.
- A mode conclusion that does not rest on accepted artifacts of the same sealed run and a cited
  market run, or that ignores an accepted counterevidence artifact.
- A module artifact that reads as a trade, or a 打法 label used as an instruction.
- A section or tool that a bot can see: the rows register tools tree-wide as dsh does, bots mask
  them through their allow lists (no bot names a `lunhui_` tool), and the run protocol is a
  section scoped to Gravit's preset.
- Any change to `dsh/profile/cycle.md`, `dsh/profile/persona.md`, `bots/` (save the generated
  mirror `bots/gravit/agent.cordis.yml`), or the corpus's git status (out of git, hashes in).

## 3. Constraints the design lives under

| Constraint | Where it is enforced | Consequence here |
|---|---|---|
| dsh pinned at `0.2.0-rc.2`, no fork (charter §7.3) | `face/package.json`, `DEVELOPMENT.md` §4.1 | file plugins and services only, the pieces `face/plugins/gravit.js` and `bot.js` already are |
| The global layer order: bundle → policy → AKShare → seat → profile → home → extra → overlay | `face/src/boot.ts` `composeFace` | the Lunhui rows are inserted after `accountSeatPatches()`; an operator row with the same id replaces one, `disabled: true` removes it |
| A file plugin is a row `{id, name: <path>, config}`; the loader imports its file URL; it exports `name`, `inject`, `apply(ctx, config)` | `cordis-plugin-loader`; `face/plugins/gravit.js` | each row is one file under `face/plugins/lunhui/`; a plugin file may import the shared library beside it (the loader uses `import()`) |
| A service is provided with `ctx.provide(name, value)` and read by rows that list it in `inject` | `@deepseek-ai/cordis` | the backbone row provides `lunhuiRuns`; freeze and module rows inject it; a module row mounted without the backbone refuses to mount, loudly |
| Tools are registered in-process with `ctx.tools.register(defineTool({name, description, parameters, execute}))`; an exclusive tool runs one call at a time per agent step; a thrown error is a failed call the model sees | `@deepseek-ai/dsh-tools` | tool names are plain (`lunhui_…`, no dots: a dotted name is hashed); refusals throw `LunhuiError` whose message opens with the code word; the service serializes writes per run across agents |
| `tools.restrict` masks by exact name; a role's `allow` is exact names checked against the never-list; `mcp__akshare__` and the account tools are refused to roles | `face/plugins/bot.js`, `face/src/roles.ts` `NEVER` | per-module tool pairs, so each analyst's `allow` is exactly its modules; the freezes are Gravit's alone; no role fetches |
| A system-prompt section registered from Gravit's preset row is scoped to that preset and gated on what the assembling scope can call and on root-or-fork | `face/plugins/gravit.js` (`canCall`, `isRootOrFork`) | the run protocol is such a section, probe `lunhui_read_run`; a role child and a bot never see it |
| `ROLE.md` ≤ 2,000 bytes, no `{{`; `role.yml` description ≤ 300 characters; `GRAVIT.md` ≤ 4,500 bytes (now 3,300); `cycle.md` ≤ 3,300 bytes | `face/src/roles.ts`, `face/tests/gravit-md.test.ts`, `face/src/cycle.ts` | three short personas; one `GRAVIT.md` line; the protocol file has its own cap, 3,000 bytes |
| The AKShare tools dominate the tool-schema block (134 KB of 167 KB on 2026-10-20) | `face/scripts/schema-sizes.ts` | seventeen small tools (§5.5) add an estimated 12–15 KB; measured and recorded |
| Nothing starts unattended (charter §1, P5) | — | no timer, no watcher; a run is one operator-started session |
| The channel page is built from the directory's own files, every block independent, every read bounded | `face/src/channels.ts` `readChannelBody`, `readBoundedJson` (stage 0) | the runs card is one block read from `analysis/`, bounded as stage 0 bounds it |
| `strategies/<name>` is the channel grammar's name (a letter or digit in any script first, then letters, digits, `-`, `_`; ≤ 41 code points) | `face/src/channels.ts`, `GRAVIT.md` | `cn-market` is a valid channel; a `strategy` argument is validated by the same grammar |
| The repository is public; the manuscript stays out of git | `.gitignore` `/docs/research/lunhui/corpus/` | contexts carry paragraph ids and short hypotheses in the tree's own words, never the manuscript's text; the evidence files stay out too (A26) |
| A tool result over `maxInlineTokens: 12500` (about 50,000 characters) is spilled to a file with a preview | dsh-base's spill policy (`cordis.patch.yml`) | a role has no file tool, so every context stays a digest under 30 KiB (A24) |
| The Eastmoney hosts answer this location with delayed quotes through a redirect | measured 2026-10-25 (A28) | the freezes follow one redirect to `push2delay.eastmoney.com`, stamp `host` and `delayed`, and never call the numbered hosts |

## 4. Decisions, as decided

The operator's are E1–E4 and the carried D2, D4, D10–D16; the rest are the author's calls, each
overturnable at review without redesign.

| # | Decision | Why |
|---|---|---|
| E1 | **dsh rows, not an MCP server.** Every Lunhui piece is a cordis row that registers its tools in-process; the stage-0 `server.mjs` and `manifest.json` retire | operator, 2026-10-25: dsh's plugin unit is the row; the MCP unit bought only runtime install, a non-goal |
| E2 | **Five analysis modules, by the manuscript's chapters:** 环境与大周期 (一, 八), 情绪周期 (二), 题材与轮动 (the 题材 pages and 六), 龙头与个股地位 (四), 模式选择与预期 (三, 七, and 模式选择 at P0159) | operator, 2026-10-25 |
| E3 | **A dedicated channel for the market-wide modules:** `strategies/cn-market/`, a tracked strategy directory whose thesis is the market read itself; its runs hold the environment, 情绪 and 题材 artifacts, and a strategy's run cites one of them | operator, 2026-10-25: market reads belong to no single strategy; the runs card and the write map keep their shape |
| E4 | **An `S01` or `S02` conclusion is a daily registration with an expectation card, not a decision:** the preconditions the daily evidence can show, a frozen expectation card graded in the next run, the minute-level confirmation the theses describe named as unmet for want of a source, the parameters used listed as research candidates. **`S02` stays `WAIT`-only until an announcements source is frozen** — a fifth freeze row and a new egress host, a later plan — because a frozen board's surge is not the catalyst the thesis names. The theses' falsification sections are re-fitted to the daily frame by the builder and reviewed by the operator | operator, 2026-10-25 (builder check Q1); the alternative, a proxy catalyst from board and pool data, was declined as weaker |
| D2′ | **The freeze rows fetch for themselves**, from the face process: Tencent for quotes and daily bars (stage 0), Eastmoney for the 涨停 pools and the boards (§5.3); the model never sees unfrozen data | carried from the graft's D2 (operator, 2026-10-19); the egress is the face's now |
| D4′ | Every tool is anchored on a **`strategy` argument** under the strategies root the row config names, by the channel grammar and the stage-0 anchoring (`runs.mjs`: `lstat`, realpath under the root, `stillResolved`); a cited market run is anchored the same way under `cn-market` | carried from D4 |
| D10′ | The doctrine is a **research input**: the module contexts carry each chapter's hypotheses as short statements with paragraph ids and the conflict rulings that bind the module; no style skill, no manuscript text in the tree | carried from D10 (operator) |
| D11′, D12′, D13′, D14′ | The corpus stays out of git with its hashes in; the two strategy directories stay; the artifact is validated and THESIS.md is not; Chinese for descriptions, hints, personas and artifacts, English for code, tests and docs | carried |
| A1 | **One shared backbone row**, `lunhui-runs`, provides the service `lunhuiRuns`: strategy and run anchoring, the run directory and its states, evidence ids, the validator plumbing, the per-run budgets and the write mutex. It registers one tool, `lunhui_read_run` | one home for state and anchoring; the module rows stay small |
| A2 | **Per-source freeze rows**, each one tool: `lunhui-freeze-quotes`, `lunhui-freeze-limit-up`, `lunhui-freeze-boards`, `lunhui-freeze-index` (§5.3). A freeze adds evidence to an open run of the named strategy, or opens one | a row per source is a patch line per source; a source that fails leaves the others |
| A3 | **Per-module tool pairs**, `lunhui_read_<module>_context` and `lunhui_submit_<module>`, twelve tools for the five modules and the reviewer's counterevidence | `tools.restrict` masks by exact name, so each role's `allow` is exactly its modules; a generic pair with a `module` argument could not be masked per role |
| A4 | **A run seals on its first context read.** A sealed run accepts no more evidence (`RUN_SEALED`); its `snapshot_id` is the hash over its evidence files' hashes and is computed at seal | every analyst of a run reads the same frozen set, the source's "same `snapshot_id`" rule (system-design §3) |
| A5 | **The mode module reads a cited market run.** `lunhui_read_mode_context({strategy, run, market_run})` requires a sealed run of `cn-market` whose `as_of` is the same trading day as the strategy run's, or the previous session's; else `STALE_MARKET_RUN`. The mode artifact records `market_run` and its `snapshot_id` | a strategy's mode rests on the market's state of the same day; an older read is not "current" |
| A6 | **The reviewer's artifact** is `counterevidence.json`, written by the third role through its own pair; the mode validator refuses a conclusion when an accepted counterevidence artifact exists in the run and the mode artifact does not address each of its items by id | the source's 反证审查员 cannot be voted away (system-design §3) |
| A7 | **Budgets per run and module:** eight freeze calls per run; ten calls per module per run (reads and submits, the refused ones counted); past either, `TOOL_BUDGET` with the stop instruction in its text; a missing or corrupt `metrics.json` at restart resets the counts, fail-open and pinned | stage 0's R41, widened to modules |
| A8 | **Three roles**, the source's: `cn-market-analyst` (市场与题材分析员; the environment, 情绪 and 题材 pairs), `cn-stock-analyst` (个股与预期分析员; the leader and mode pairs), `cn-reviewer` (反证审查员; the counterevidence pair); each `allow` is `skill` plus its pairs; model `deepseek-official/deepseek-flash`; Gravit coordinates and never submits an artifact | one hand per module group; the reviewer shares no tool with the analysts |
| A9 | **The run protocol is a scoped section**, `lunhui:run`, from `dsh/profile/lunhui-run.md` (≤ 3,000 bytes), registered by `face/plugins/gravit.js` from a new `protocols` config entry that `composeFace` fills as it fills `cycle`, gated on `canCall(lunhui_read_run)` and root-or-fork, ordered just before `gravit:cycle` | what Gravit alone is told, visible only when the rows mounted; an MCP `instructions` section would have reached bots |
| A10 | **Artifacts are files of the run**, one per module: `environment.json`, `sentiment.json`, `theme.json`, `leader.json`, `mode.json`, `counterevidence.json`; the evidence files `evidence-<source>.json`; `run.json` the run's manifest; `metrics.json` the counters. One artifact per module per run; a second submit is `ALREADY_SUBMITTED` | the channel page and git read files; the source's one-decision-per-snapshot rule |
| A11 | **Contexts are built, not stored:** `lunhui_read_<module>_context` assembles the module's context from the run's evidence files, the module's hypotheses and rulings, its schema, its hints and example, and — for mode — the cited market artifacts, the strategy's THESIS.md falsification terms and its previous accepted `mode.json` | fewer files to drift; a context is a function of the sealed run |
| A12 | **The expectation card lives in `mode.json`** as `expectation` (the source's `ExpectationPlan`, strategy-spec §2.2); the next run's mode context carries the previous card, and the mode artifact's `expectation_review` grades it 符合/强于/弱于 against the frozen facts, by evidence ids | the research loop closes without a trade |
| A13 | **The market channel is committed**, like `strategies/room-drill`: `strategies/cn-market/` with a THESIS.md stating the market-read hypotheses by chapter and paragraph id, status `researching` once a run exists, and its `analysis/` runs tracked | a channel the face finds at boot, with a page from day one |
| A14 | **The runs card generalizes** stage 0's: `ChannelBody.runs[]` carries `{run, asOf, snapshotId, sealed, artifacts: {<module>: {accepted, headline}}, marketRun?, bytes}`, `latestRun` the newest sealed run with any accepted artifact and its artifacts' summaries; the client's channel screen gains a "Research runs" section after "Latest backtest"; reads bounded as stage 0 | the field is the channel (graft D18) |
| A15 | **Fixture mode is row config**, not an environment variable: a freeze row's `config.fetch` names a recorded-replies directory, used by tests only; production rows set none | stage 0's R21 trap disappears with the child process |
| A16 | **Stage 0's pure modules are reused** under `face/plugins/lunhui/lib/`: `market.mjs` (Tencent, calendar, assessment), `runs.mjs` (anchoring, atomic writes, bounded reads), `contract.mjs` split into a shared core (wording rules, evidence binding, byte budget, repairs) and per-module contracts | the graft's reviews hold for this code |
| A17 | **Egress from the face process:** `qt.gtimg.cn`, `web.ifzq.gtimg.cn` (stage 0), `push2ex.eastmoney.com` (the pools), `push2.eastmoney.com` (board lists, constituents, fund flow, the all-shares counts) and its redirect target `push2delay.eastmoney.com` (A28); 7-second timeout, 512 KiB per response, at most four requests in flight; documented beside the AKShare server's | the hosts AKShare itself calls for the same data |
| A18 | **The mode set is `S01`, `S02`, `WAIT`.** The R01–R14 families are labels the module may report as `research_only` matches with the reason they cannot be selected (data, ruling, or registration) | the graft's D10 and the source's §6 registration |
| A19 | **Versions in the artifact:** every artifact carries `module`, `contract_version`, `hypotheses_version` (the context's doctrine excerpt), `snapshot_id`, `run`, `as_of`; the runs card shows `contract_version` so a changed rule is visible in history | labels are never rewritten (system-design §4) |
| A20 | **Evidence items and derived measures** (builder check Q2). An evidence item is one row: a pool entry (one stock), one board's summary, one board's member list (≤ 100 symbols, one item), one index quote, one daily bar series. At freeze, host code also writes **derived items**, each with its own id and the ids of its inputs: 连板高度 distribution, 封板 and 炸板 ratios by unique stock, 昨日涨停 today's returns and their negative tail, each frozen board's breadth (advancers over members) and turnover share, the exchanges' advance/decline counts. The model never computes these; a context carries derived items first, then the rows that fit | the source forbids the model re-deriving market-wide measures (`design/docs/contracts.md` §3); a 30 KiB context cannot carry 500 rows |
| A21 | **Assertion allowances per module** (Q2). The shared core keeps stage 0's rule — no affirmative sentence on 全市场, 市场广度, 题材, 主线, 龙头 or 情绪周期 — as the default, and each module contract opens exactly the assertions it owns when they cite a derived item: sentiment may assert 情绪 and 全市场 statements; theme may name 题材 and 主线 candidates; leader may name 龙头 candidates as `leader_candidate` hypotheses; environment may assert 指数 and 流动性 states; mode opens nothing and only cites artifacts; counterevidence may deny any of them | the modules' outputs are the sentences stage 0 refused; the evidence binding is what makes them claims |
| A22 | **The reviewer runs before the mode, in both channels** (Q3). cn-market: freezes → `cn-market-analyst` (three artifacts) → `cn-reviewer`. Strategy: freeze quotes → `cn-stock-analyst` for the leader artifact → `cn-reviewer`, whose context takes `market_run` and carries the leader artifact and the cited market artifacts → `cn-stock-analyst` again for the mode artifact. An `S01` or `S02` conclusion requires an accepted counterevidence artifact in the run and addresses each item by id (`UNADDRESSED_COUNTEREVIDENCE`); `WAIT` requires none | otherwise the reviewer's artifact never exists when the mode is validated, and G3 is empty |
| A23 | **Caller checks in code** (Q7): a submit tool refuses a caller whose session is a root or a seeded fork (`NOT_A_ROLE`), reading `exec.agent.session.header` as `gravit.js`'s `isRootOrFork` does; a freeze tool refuses a delegated child (`NOT_GRAVIT`). Pinned on a real boot | "Gravit never submits" and "no role fetches" become code paths, not protocol sentences |
| A24 | **Contexts are digests, capped at 30 KiB** (Q6). A context carries artifact **digests** — headline fields, every claim's id, text and evidence ids, the expectation card, the counterevidence items — never whole artifacts; derived items first, then rows by priority until the cap, with a `truncated` list naming what was left out. dsh-base's spill policy replaces a tool result over `maxInlineTokens: 12500` (about 50,000 characters) with a preview and a file path no role can read, so no context may approach it | a role that cannot read its context cannot work |
| A25 | **Calendar tables per year, fail closed** (Q8): `lib/calendar/<year>.json` from the SSE notices, 2026 shipped; a session date outside every table refuses the freeze with `CALENDAR_UNCOVERED`, and A5's same-day rule refuses too. The 2027 table is a task of plan 1, added when the SSE notice is out (usually December) | guessing weekdays would mint CURRENT evidence on a holiday |
| A26 | **Evidence files stay out of git** (Q9): `.gitignore` gets `strategies/*/analysis/*/evidence-*.json`; `run.json` (with every evidence file's sha256), `metrics.json` and the artifacts are tracked. A fresh clone reads the artifacts and the hashes, and cannot rebuild a context | a public repository; about 2 MiB a run, daily |
| A27 | **A strategy run freezes quotes only** (Q5): pools and boards come from the cited market run, so one snapshot of each pool stands per day. `lunhui_read_leader_context` takes `market_run` too, so 顺位 is ranked within the market run's mainline candidates, and the leader validator requires each candidate to be a member of a frozen board or pool of the cited market run (`REFERENCE` otherwise). Gravit chooses the candidate symbols within that set | two snapshots of one pool in one decision would disagree |
| A28 | **Eastmoney over its plain hosts, redirects followed** (Q4). Probed from the face's host on 2026-10-25: `push2ex.eastmoney.com/getTopicZTPool` answers directly (200, the 2026-10-23 pool); `push2.eastmoney.com/api/qt/clist/get` answers 302 to `push2delay.eastmoney.com`, which serves the boards (200, 516 boards) with `dlmkts` set — **delayed quotes for this location**; the numbered hosts (`17.`, `29.push2…`) redirect or time out. So the freezes call the plain hosts, follow one redirect only to `push2delay.eastmoney.com`, record the serving host and the delay flag in every item, and the exchanges' advance/decline counts come from the clist of all A shares with one field (`f3`), 1,000 a page, counts and page hashes stored, no rows — not from the Tencent snapshot's 27 pages | the data path works from here, delayed; the design stamps the delay rather than hide it |

## 5. The design

### 5.1 The run

A run is a directory `strategies/<name>/analysis/<run>/`, `<run>` in stage 0's form
`<YYYYMMDD>T<HHMMSS>Z-<8 hex>`, created by the first freeze of that run. Its states:

- **open** — freezes add `evidence-<source>.json` files; `run.json` lists them with their
  sha256; no context has been read.
- **sealed** — the first `lunhui_read_<module>_context` seals it: `run.json` gains `sealed_at`
  and `snapshot_id` (sha256 over the sorted evidence hashes, `snap_<hex>` as stage 0), and every
  later freeze on it is refused `RUN_SEALED`. Artifacts land only in a sealed run.

`run.json`: `{ run, strategy, kind: "market" | "strategy", as_of, opened_at, sealed_at,
snapshot_id, evidence: [{source, file, sha256, bytes, received_at, host, delayed}], artifacts:
[<module>…] }`.
`as_of` is the latest `received_at` among the evidence at seal. `metrics.json`: `{ freezes,
calls: {<module>: n}, rejections: {<module>: [categories]}, submitted: [<module>…] }`, mirrored
after every change as stage 0 mirrors it.

Evidence ids are stage 0's `ev_<sha256-24>` over the canonical evidence item; an artifact's
claims cite them, and a mode claim may also cite an artifact as `<module>@<snapshot_id>`.

### 5.2 The backbone row: `lunhui-runs`

`face/plugins/lunhui/runs-row.mjs`, `name: "lunhui-runs"`, `inject: ["tools"]`, config
`{ strategiesRoot }`. It provides `lunhuiRuns` with: `resolveStrategy`, `openRun`, `addEvidence`,
`sealRun`, `readRun`, `buildContext(module, run, …)`, `submit(module, run, text)`, `budget`,
`mutex(run)`. It registers `lunhui_read_run({strategy, run})`, which returns `run.json` with
each artifact's headline — the Gravit-facing view, so Gravit coordinates without reading files.
Without this row mounted, every other Lunhui row refuses to mount with a reason naming it.

### 5.3 The freeze rows

| Row | Tool | Source and what is frozen | Bound |
|---|---|---|---|
| `lunhui-freeze-quotes` | `lunhui_freeze_quotes({strategy, run?, symbols})` | Tencent quotes and 60-day daily bars for 1–8 symbols (indices among `sh000001 sz399001 sz399006 sh000300`, main-board equities; stage 0's rule) | stage 0's |
| `lunhui-freeze-limit-up` | `lunhui_freeze_limit_up({strategy, run?})` | Eastmoney 涨停池, 炸板池, 昨日涨停表现 for the current session: symbol, name, 连板数, 封板时间, 炸板次数, turnover, board tags | ≤ 500 rows per pool, ≤ 256 KiB per file |
| `lunhui-freeze-boards` | `lunhui_freeze_boards({strategy, run?, boards?})` | Eastmoney concept boards ranked by turnover, the top 30 with change and turnover; constituents for the named boards or the top 10, ≤ 100 symbols each; board fund-flow rank | ≤ 256 KiB per file |
| `lunhui-freeze-index` | `lunhui_freeze_index({strategy, run?})` | the four indices' quotes and 120-day daily bars (Tencent); the two exchanges' total turnover and advance/decline counts from the Eastmoney clist of all A shares, counts and page hashes only (A28) | ≤ 256 KiB per file |

A freeze with `run` omitted opens a new run and returns its id; with `run` it adds to that open
run (`RUN_SEALED` otherwise). Each source's items get evidence ids, and host code adds the
derived items of A20 beside the rows. A source that fails is a refusal (`UPSTREAM_TIMEOUT`,
`UPSTREAM_TOO_LARGE`, `UPSTREAM_INVALID`, `NO_MARKET_DATA`) that writes nothing for that source;
the run keeps what other sources froze. A session date no calendar table covers refuses with
`CALENDAR_UNCOVERED` (A25). The whole run is bounded at 2 MiB of evidence, and the evidence
files are gitignored (A26). The Eastmoney replies are JSON; the parsers are new, with recorded
fixtures as stage 0 records Tencent's; every Eastmoney item records the host that served it and
whether the quote was delayed (A28). In a strategy channel only `lunhui_freeze_quotes` is used
(A27).

### 5.4 The five modules, and the reviewer

| Module | Row | Chapters and paragraphs | Requires evidence of | Headline fields |
|---|---|---|---|---|
| environment (环境与大周期) | `lunhui-environment` | 一 (P0019–P0074), 八 (P1652–P1708) | index, quotes | `index_state`, `liquidity_state`, `cycle_anchor` |
| sentiment (情绪周期) | `lunhui-sentiment` | 二 (P0156–P0163), P0020–P0056 | limit-up, index | `state` (one of the seven), `money_effect`, `freeze_type` |
| theme (题材与轮动) | `lunhui-theme` | P0075–P0153, 六 (P1345–P1464) | boards, limit-up | `mainline_candidates[]`, `theme_stage`, `rotation` |
| leader (龙头与个股地位) | `lunhui-leader` | 四, P0654–P1340 | the strategy run's quotes; the cited market run's limit-up and boards (A27) | `leader_candidates[]` with 顺位, `top_pattern_flags` |
| mode (模式选择与预期) | `lunhui-mode` | 三 (P0164–P0452), 七 (P1610–P1650), P0159 | the strategy run's leader and counterevidence artifacts, the cited market run's three artifacts, the previous `mode.json` | `mode` (`S01`, `S02`, `WAIT`), `preconditions`, `research_only_matches[]`, `expectation`, `expectation_review` |
| counterevidence (反证) | `lunhui-review` | the ten rulings (strategy-spec §7) and §5 | every accepted artifact of the run, and of the cited market run when `market_run` is given | `items[]` each with `against: <module>`, `evidence_ids`, `kind` |

The environment, sentiment and theme modules accept only a run of `cn-market`
(`WRONG_CHANNEL` otherwise); leader and mode only a run of another strategy; counterevidence
either. The seven states (`UNKNOWN CHAOS IGNITION EXPANSION CLIMAX RETREAT REPAIR`) are the
sentiment module's `state`, with the environment module reporting index and liquidity apart, as
system-design §4 insists. A module whose required evidence is absent from the run returns a
context that says so and whose only valid submission is `NOT_EVALUABLE` with the missing
sources named.

### 5.5 Tool names and arguments

Seventeen tools, all plain names:

- backbone: `lunhui_read_run({strategy, run})`
- freezes: `lunhui_freeze_quotes({strategy, run?, symbols})`, `lunhui_freeze_limit_up({strategy,
  run?})`, `lunhui_freeze_boards({strategy, run?, boards?})`, `lunhui_freeze_index({strategy,
  run?})`
- modules: `lunhui_read_environment_context({strategy, run})`,
  `lunhui_submit_environment({strategy, run, analysis})`, and the same pair for `sentiment` and
  `theme`; `lunhui_read_leader_context({strategy, run, market_run})` and
  `lunhui_submit_leader({strategy, run, analysis})`;
  `lunhui_read_counterevidence_context({strategy, run, market_run?})` and
  `lunhui_submit_counterevidence({strategy, run, analysis})`;
  `lunhui_read_mode_context({strategy, run, market_run})` and
  `lunhui_submit_mode({strategy, run, analysis})`

A submit refuses a root or forked caller (`NOT_A_ROLE`); a freeze refuses a delegated child
(`NOT_GRAVIT`); both read the caller's session header (A23).

`analysis` is the artifact as a JSON string, as stage 0 (its §7 item 2). Descriptions are
Chinese and state every bound in prose; schemas use the keyword subset stage 0 settled on (R22).
Nothing takes a path, a URL, a date or a number that selects data beyond the run.

### 5.6 Contracts

A shared core (`lib/contract-core.mjs`, from stage 0's `contract.mjs`): the evidence-id binding,
the CURRENT/HISTORICAL wording rule, the forbidden trading and account words, the whole-market
and leadership assertion rules, the 24 KiB budget on the compact JSON, the repair hints by
category, the snapshot-id binding, and the classifier. Per module (`lib/contracts/<module>.mjs`):
the JSON schema, the enumerations above, the module's extra rules, its hints and its built
example. Module-specific rules the core cannot know:

- sentiment: `state` requires at least two cited evidence ids from the limit-up pools and one
  from the index evidence; `UNKNOWN` needs a `conflict` field naming the indicators that
  disagree (system-design §4).
- theme: every `mainline_candidates[]` entry cites a frozen board and its members; a 题材 named
  without a frozen board is `REFERENCE`.
- leader: a `leader_candidates[]` entry is a `leader_candidate` hypothesis with 顺位 and the
  evidence of its 地位; the artifact may not name a 龙头 outside the frozen quotes.
- mode: `mode` ∈ {`S01`, `S02`, `WAIT`}; `S01`/`S02` require the cited market run's sentiment
  `state` to be in that strategy's admitted set (strategy-spec §3–§4: `REPAIR`/`EXPANSION` for
  both, `IGNITION`/`CHAOS` for S02 only, never `CLIMAX`/`RETREAT`/`UNKNOWN`), every precondition
  cited, an accepted counterevidence artifact in the run with every item addressed by id (A22),
  and — E4 — an `S01`/`S02` is a **daily registration**: the preconditions the daily evidence can
  show, a frozen expectation card, the minute-level confirmation the theses describe named under
  `preconditions` as `unmet: no source`, and the card graded in the next run; the artifact lists
  the parameter values it used as research candidates (`parameters_used`), since no production
  value exists. `S02` is refused until an announcements source exists in the run
  (`preconditions.catalyst: unmet: no source`, so the conclusion is `WAIT`). 打法 names from
  R01–R14 may appear only under `research_only_matches`.
- the leader validator requires each `leader_candidates[]` symbol to be a member of a frozen board
  or pool of the cited market run (A27).
- counterevidence: each item names the module it is against and cites evidence; an item with no
  evidence id is `REFERENCE`.

The forbidden-word list keeps a short allow-list of 打法 names as labels (the R-index's family
names), so the mode module can say "一进二 matches, research_only" without tripping the
execution-content rule; a sentence that instructs is still refused.

### 5.7 Budgets, refusals, retry

A refusal throws `LunhuiError`; the model sees `Error: <CODE> …` and retries, as the first
pre-plan had it and stage 0's MCP form emulated. Codes: stage 0's (`NOT_A_STRATEGY`, `BAD_RUN_ID`,
`NO_SUCH_RUN`, `RUN_EXISTS`, `INVALID_SYMBOL`, `NO_MARKET_DATA`, `UPSTREAM_*`, `READ_FIRST`,
`ALREADY_SUBMITTED`, `SUBMIT_IN_PROGRESS`, `TOOL_BUDGET`, `INTERNAL`) plus `RUN_SEALED`,
`WRONG_CHANNEL`, `STALE_MARKET_RUN`, `MISSING_EVIDENCE`, `UNADDRESSED_COUNTEREVIDENCE`. A
validation rejection is `[<category>] <reason>\n修复：<repair>` as stage 0. No refusal names a
path; `INTERNAL` logs its detail to the face's stderr only.

Budgets as A7. `READ_FIRST` replaces stage 0's `READ_BOTH_FIRST`: a module's submit requires its
own context read in this process; a restart resets reads, keeps counts.

### 5.8 The market channel: `strategies/cn-market/`

Committed, from `_template`: `THESIS.md` states the market-read hypotheses by chapter with
paragraph ids (大周期 and 周期补充 for environment; 情绪周期 for sentiment; the 题材 pages and 六
for theme), with a falsification section saying what a later run must show for a state label to
have been wrong; `status.yaml` `researching` once the first run lands; `journal.md` dated entries
the operator or Gravit write after a run. Its `analysis/` holds the market runs. A strategy run's
`mode.json` cites one of them (A5).

### 5.9 Roles

| Role | Tools (`allow`) | Model | Reads | Writes |
|---|---|---|---|---|
| `cn-market-analyst` | `skill`, the environment, sentiment and theme pairs | `deepseek-official/deepseek-flash` | the market run's contexts | three artifacts of a `cn-market` run |
| `cn-stock-analyst` | `skill`, the leader and mode pairs | same | the strategy run's contexts, the cited market run through the mode context | `leader.json`, `mode.json` |
| `cn-reviewer` | `skill`, the counterevidence pair | same | every accepted artifact through its context | `counterevidence.json` |

`ROLE.md` ≤ 2,000 bytes each: the persona trimmed to the role's job, the four-heading report
(status, what was measured, paths, limits), the blocked exit after a read failure or the third
rejection, and the rule that the artifact goes only into `analysis`, never into the message. No
role carries a freeze, a file tool or an AKShare tool. The mirror `bots/gravit/agent.cordis.yml`
is regenerated by `npm run render:roles`.

### 5.10 The run protocol

`dsh/profile/lunhui-run.md` (≤ 3,000 bytes, Chinese, no `{{`), mounted by A9. It tells Gravit
the order (A22): in `cn-market`, freeze index, limit-up and boards (quotes optional), call
`cn-market-analyst` once with the run id, then `cn-reviewer` with the run id; in a strategy
channel, freeze quotes for the candidates (chosen from the cited market run's boards and pools),
call `cn-stock-analyst` with the run id and the market run id for the leader artifact, then
`cn-reviewer` with both ids, then `cn-stock-analyst` again for the mode artifact, then
`lunhui_read_run` to read the headlines; a `WAIT` or a refused mode is a result, not a failure; a
run with `NOT_EVALUABLE` artifacts is journaled as such; never freeze after a role has read; never
edit `analysis/`; never submit an artifact yourself (the tool refuses it); the final message to
the operator cites artifact ids and says what was not evaluable and whether the quotes were
delayed. `GRAVIT.md` gains one line under "A strategy directory":
`analysis/<run>/` holds frozen A-share research runs the Lunhui rows write; never edit them by
hand.

### 5.11 The runs card

`face/src/channels.ts`: `ChannelBody` gains `runs`, `runsOmitted`, `latestRun` in A14's shape,
read by `readAnalysisRuns` from `analysis/` as stage 0 reads them — run directories by the id
form, newest first, at most 50, every file through `readBoundedJson` (caps: `run.json` 8 KiB,
`metrics.json` 8 KiB, each artifact 24 KiB on the compact JSON, depth 32, `O_NOFOLLOW`, one link).
`latestRun` is the newest sealed run with an accepted artifact; it carries each artifact's
headline fields (§5.4) and `mode.json`'s `expectation` when present.

`face/client/js/render/channel.js`: a "Research runs" section after "Latest backtest": the
latest run's line (`run`, as-of, snapshot id, `cn-market` run cited), one chip per module with
its headline (`state`, `mode`…) or `not evaluable`, the counterevidence count, the expectation
card's fields as a key-value table, and the full artifacts in a collapsed details per module;
then one dim line per run with its artifacts' names, and the omitted count. The shaping is a pure
module beside the view (`js/host/runs-view.js`), tested with the fake DOM as the client's other
views are.

### 5.12 Composition and visibility

`face/src/lunhui.ts` returns the rows, inserted by `composeFace` after `accountSeatPatches()`:
`lunhui-runs` first, then the four freeze rows, then the six module rows (`lunhui-environment`,
`lunhui-sentiment`, `lunhui-theme`, `lunhui-leader`, `lunhui-mode`, `lunhui-review`), each
`name: <absolute file URL>` and `config: { strategiesRoot }` (the freeze rows also `fetch`,
unset). An operator patch row with one of these ids replaces that row's config, so a replacement
restates `strategiesRoot`; `disabled: true` removes a module and its pair, and a role whose
`allow` names a missing tool fails at `tools.restrict()`, never the boot (as today).

The tools are registered tree-wide, as dsh's own are. Bots see none: `DEFAULT_ALLOW` and the
shipped bots' allow lists name no `lunhui_` tool, pinned by extending stage 0's bots test. The
run protocol section is scoped to Gravit's preset (A9). `/data/plugins.json` lists the eleven
rows by id and phase as it lists every composed row; a tools column for face rows is a forward
item (§9).

### 5.13 Reuse of stage 0

From `feat/lunhui-graft @ 0de97cf`: `face/plugins/lunhui/market.mjs`, `runs.mjs`,
`fixture-fetch.mjs` and the test fixtures move under `face/plugins/lunhui/lib/` and
`face/tests/fixtures/lunhui/` unchanged but for imports; `contract.mjs` splits as §5.6;
`face/src/channels.ts`'s bounded reads and the `send()` fix land as they are; the two strategy
directories and `docs/research/lunhui/` land as they are; `server.mjs`, `manifest.json`,
`face/src/lunhui.ts`'s MCP row, `roles/cn-analyst`, the skill `cn-market-facts` and the stage-0
tests that drove the server over stdio retire. The graft's ledger
(`docs/superpowers/plans/2026-10-19-lunhui-plugin-graft-ledger.md`) lands as history.

## 6. Tests and documentation to pin

| Seam | Test |
|---|---|
| each row mounts, provides or injects, registers exactly its tools; a module row without the backbone refuses | `face/tests/lunhui-rows.test.ts` with a stand-in scope as `gravit-plugin.test.ts` uses |
| the run: open, add, seal, `RUN_SEALED`, `snapshot_id` over the evidence hashes, restart from `run.json` + `metrics.json`, budgets per module, fail-open | `face/tests/lunhui-runs.test.ts` (stage 0's, extended) |
| each freeze with recorded fixtures: items, ids, caps, each refusal; the Eastmoney parsers on recorded replies and on malformed ones | `face/tests/lunhui-freeze-*.test.ts` |
| each contract: the shared core's eight invalid structures (stage 0) plus the module's own rules above; `NOT_EVALUABLE` when evidence is missing | `face/tests/lunhui-contract-*.test.ts` |
| the mode module: `STALE_MARKET_RUN`, `WRONG_CHANNEL`, an inadmissible state for `S01`/`S02`, `UNADDRESSED_COUNTEREVIDENCE`, a 打法 label allowed under `research_only_matches` and refused as an instruction | `face/tests/lunhui-mode.test.ts` |
| the runs card: shapes, caps, the headline per module, `latestRun`, a linked or oversized file unread, the client view | `face/tests/channels.test.ts`, `face/tests/client/runs-view.test.ts` |
| the three roles read, their `allow` lists exactly, the mirror regenerated; on a real boot each child's first request carries exactly its tools and `GRAVIT.md` | `roles.test.ts`, `roles-smoke.test.ts` |
| the protocol section: registered scoped, gated, blank for a role child and a bot, under the cap | `gravit-plugin.test.ts`, `bots-smoke.test.ts` |
| the rows in a real boot: the seventeen tools in Gravit's scope, none in a bot's; `/data/plugins.json` lists the rows | `smoke.test.ts`, `bots-smoke.test.ts` |
| the caller checks: a submit from a root or fork refused `NOT_A_ROLE`, from a role child accepted; a freeze from a child refused `NOT_GRAVIT` | `roles-smoke.test.ts` on a real boot, plus the rows test with stand-in headers |
| the calendar: a date outside every table refuses `CALENDAR_UNCOVERED`; A5's same-day and previous-session rule over a holiday; a second year's table loads | `lunhui-runs.test.ts`, `lunhui-mode.test.ts` |
| the Eastmoney path: one redirect followed to `push2delay.eastmoney.com` only, a second refused, `host` and `delayed` stamped, a numbered host never called | `lunhui-freeze-*.test.ts` with a fake fetch |
| the evidence files are ignored and the artifacts tracked | a test that `git check-ignore` holds for `evidence-*.json` under a run and not for `run.json` |
| schema sizes: the `lunhui_` group measured and recorded | `face/scripts/schema-sizes.ts` (prefix `lunhui_`) |

Documentation rows: `DEVELOPMENT.md` §3.6 (the seventeen tools), §3.8 (three roles), §4.3 (the
eleven rows after the seat), §4.4–§4.6, §5.2 (the runs card wire), §9 (residuals), §10
(forward); `face/README.md` "Lunhui analysis" rewritten for rows, with the egress hosts, the
disable lines and a drill; `GRAVIT.md` one line; `CLAUDE.md` the `face/` and `roles/` rows and
`strategies/` naming `cn-market`; the charter re-fit (§8); the loops page; the upgrade guide's
re-check rows and the seams inventory (dated additions).

## 7. Left to the builder

- The exact Eastmoney query strings and field maps for the three pools, the board list, the
  constituents and the fund-flow rank, read from the installed `akshare` sources
  (`stock_feature/stock_ztb_em.py`, `stock/stock_board_concept_em.py`, `stock/stock_fund_em.py`).
- The module schemas' field names beyond the headline fields and enumerations above, in the
  source's vocabulary where the source has one (`design/contracts/*.schema.json` are the shape
  references).
- The per-module hypotheses excerpts: the tree's own words, each with its paragraph ids; a byte
  cap per module context (stage 0's 30 KiB holds).
- `lunhui-run.md`'s wording within 3,000 bytes; the three `ROLE.md` within 2,000.
- The `protocols` plumbing in `gravit.js`, `roles.ts`'s render and `composeFace`, following how
  `cycle` travels today.
- The tracked `strategies/cn-market/THESIS.md`.
- The order of the plans (§10) and where stage 0's tests are ported versus retired.

## 8. Charter and residuals

- §1 MARKET: main's bullet gains the Lunhui sentence re-fitted: the Lunhui rows freeze hashed
  Tencent and Eastmoney samples into a strategy directory for read-only research; like the
  AKShare reads they carry no lookahead guard and are never evidence of a trade.
- §4 `strategies/` row: the writer clause names the Lunhui rows — writing only under
  `strategies/<name>/analysis/`, from the face process, outside any session sandbox, when a
  non-bot session holding their tools calls them: Gravit, its forks and plain subagents, or the
  three roles.
- D10: the face's own rows now write outside the sandbox too (the Lunhui runs), beside the seat's
  key file.
- Residuals for `DEVELOPMENT.md` §9: the writes from the face process (stage 0's R32, re-worded);
  the calendar tables by year, fail-closed outside them (R33, re-worded; A25); the Eastmoney
  endpoints are unofficial and may change shape or refuse, which the parsers turn into
  `UPSTREAM_INVALID`; the quotes they serve this location are delayed, stamped on every item
  (A28); point-in-time only from the first freeze; a run's freshness is the freeze's, and a
  market run cited the next session is a day old by design (A5); the evidence files are not in
  git, so a clone holds the artifacts and the hashes, not the contexts (A26).

## 9. Open items

- An announcements source for `S02`'s catalyst: which feed, its egress host, and what an
  announcement item freezes (E4 makes it the gate to `S02`).
- A manifest or card for in-process rows in Discover, and whether a tools column for face rows
  belongs in `/data/plugins.json`.
- Whether `cn-market` runs should be opened by the operator's hand each session or by the
  always-on desk when that arc lands (charter P5 governs).
- Whether the analysts run on `deepseek-flash` or on Gravit's route; the source ran at low effort.
- Which of R01–R14 is promoted next to a selectable mode, and on what evidence; each is its own
  module or a mode-module extension, decided per family.

## 10. Order of plans

1. The backbone and the freezes: `lunhui-runs`, the four freeze rows with fixtures, the run
   states, `strategies/cn-market/`, the runs card's wire and view. Stage 0's library moves.
2. Sentiment and theme, with `cn-market-analyst`, the protocol section and the environment
   module; the first market run on a real boot.
3. Leader and mode, with `cn-stock-analyst`; the expectation card and its review.
4. Counterevidence, with `cn-reviewer`; the docs pass and the schema-size measurement.

Each plan ends with the suites green and a reviewed branch; nothing merges without the
operator's word.

## 11. Builder check, 2026-10-25

A fresh subagent read §0–§10 as a builder and returned nine questions. Each is answered in the
document or sent to the operator:

| # | Question | Pile | Where |
|---|---|---|---|
| 1 | What may `S01`/`S02` claim; registration or decision; thresholds; S02 without a catalyst source | the operator's — decided 2026-10-25 | E4, §5.6 |
| 2 | What an evidence item is; who computes the market-wide measures; the scope rule refusing the modules' own sentences | the author's | A20, A21 |
| 3 | When the reviewer runs and whether the mode waits for it | the author's | A22, §5.10 |
| 4 | Whether the Eastmoney endpoints answer from this machine | measured | A28, §3 |
| 5 | What the leader reads in a strategy run | the author's | A27, §5.4, §5.5 |
| 6 | Which budget gives way in the mode and counterevidence contexts; dsh's spill cap | the author's | A24, §3 |
| 7 | Whether "Gravit never submits" is enforced in code | the author's | A23, §5.5, §6 |
| 8 | What happens from 2027-01-01 | the author's | A25, §8 |
| 9 | Whether the evidence files are committed | the author's | A26, §3, §8 |

## 12. Build notes, plan 1 (2026-10-25)

Where plan 1's build measured or ruled against this document's text. The clauses above stand as
approved; the tree does what this table says, and the operator may fold any line back into its
clause or reverse it (`DEVELOPMENT.md` §10 item 21). The rulings are in the plan's SDD ledger.

| Clause | The text | What the tree does | Why |
|---|---|---|---|
| A28 | the all-shares counts read "1,000 a page" | 100 rows a page, at most 64 pages, page 1 first for the total and the rest concurrently under the four-slot limiter | measured 2026-10-25: the live clist answers a `pz=1000` request, through its 302 to `push2delay`, with 100 rows of 5,925 — the page cap is the host's |
| §5.3 | concept boards "ranked by turnover" | the top 30 ranked by change (`fid=f3`), each row keeping turnover (`f6`) so turnover share is still derived; the default constituents are the first 10 of that list | measured 2026-10-25: the turnover ranking leads with 融资融券, 昨日高振幅, 深股通, 基金增仓, 富时罗素 — membership and screen boards, not 题材 |
| §5.12 | every row `config: { strategiesRoot }` | only `lunhui-runs` carries `strategiesRoot`; the four freeze rows' config is `{}` and they reach the root through the `lunhuiRuns` service | one source of truth: a patch that moves the root restates it on one row |
| §5.7 | the refusal codes | `SOURCE_FROZEN` joins them: a second freeze of one source in one run is refused | one snapshot per source per run — two snapshots of one pool would disagree (A27's rule) |
| A20 | board breadth "advancers over members" | advancers / (advancers + decliners), from the board's own counts, never from the cut member list | an unchanged member (suspended or flat) carries no direction, and the board's reply gives no member total |
| §5.3 | a null or empty pool refuses `NO_MARKET_DATA` | only the 涨停 pool's null or empty reply refuses; an empty 炸板 or 昨日涨停 pool is an empty list | a day with no 炸板 is a market state; a holiday or pre-market date already refuses through the same date's 涨停 pool |
| A28, §5.3 | "every Eastmoney item records the host that served it" | every Eastmoney item — pool rows, boards, member lists, flow rows, the counts item — carries its own reply's `host` and `delayed`; the file's meta joins the distinct hosts and is `delayed` when any reply was | the review found the stamp at file level only; per item is the clause |
| §5.3 | a freeze with `run` omitted opens a run and returns its id | when such a freeze then fails, its refusal names the run it opened | the retry passes that id instead of opening a second empty run (an id, never a path) |
| §5.11 | the runs card's "Research runs" section | drawn only for a channel whose overview lists a run; "no sealed run with an artifact yet" shows inside a channel that has runs | otherwise every channel — the workbench root, `room-drill`, the bots' — would carry an empty section |
| §5.1, A5 | `run.json`'s `as_of` is "the latest `received_at` among the evidence at seal" | every evidence file and its `run.json` entry also record `session` — `getMarketSession(now).expectedQuoteDate`, `YYYY-MM-DD`, the trading day the data belongs to; the quotes freeze too — and `sealRun` writes `run.json` `session`, the latest evidence session (null for a run with none, null while open), beside `as_of`; the freeze's reply and the runs card's latest line carry it | a weekend, holiday or pre-open freeze stores the previous session's data stamped only with the wall clock; A5's same-day rule and the CURRENT/HISTORICAL wording must read a trading day |
| §5.3 | an evidence file is at most 256 KiB | `limit-up` has its own cap of 1 MiB (`EVIDENCE_CAPS` in `runs.mjs`); the other sources stay at 256 KiB and a run at 2 MiB; `EVIDENCE_TOO_LARGE` says the source's frozen reply passed the file cap and nothing was written | a stamped pool row is about 390 bytes, so three full 500-row pools come to about 585 KB; the derived ratios keep reading every row; no freeze takes a range to narrow |
| A10, A14 | the card's `accepted` | a module file counts as an accepted artifact only when `run.json`'s `artifacts[]` names its module; any other file is left out as an unreadable one is | `artifacts[]` is A10's record of what a submit landed; plan 2's submit must append to it |
| A17 | at most four requests in flight | the four-slot limiter is Eastmoney's; the index freeze's Tencent quote request and its four bar reads run beside it unthrottled, so one index freeze can hold up to nine requests at once | the Tencent reads are five fixed requests to two hosts stage 0 already called; the limiter guards Eastmoney's paged counts |

## 13. Build notes, plan 2 (2026-10-26)

Where plan 2's build ruled against this document's text. As with plan 1's table, the clauses above
stand as approved, the tree does what this table says, and the operator may fold any line back
into its clause or reverse it (`DEVELOPMENT.md` §10 item 21). The rulings are in the plan's SDD
ledger (`.superpowers/sdd/2026-10-26-lunhui-modules-plan-2/progress.md`).

| Clause | The text | What the tree does | Why |
|---|---|---|---|
| §5.4, A19 | a module without its required evidence submits `NOT_EVALUABLE` "with the missing sources named" | a `NOT_EVALUABLE` artifact may carry `claims: []` (and then cites nothing), and its `missing_sources` must equal the context's `missing` as a set; every headline stays `UNKNOWN` or empty | a module whose sources froze nothing has no evidence id to cite, so a one-claim minimum made the only valid submission impossible; binding the list to the context keeps a role from naming sources the run holds |
| §5.4 | environment "requires evidence of index, quotes" | `required: ["index"]`; quotes are read when the run froze them and are optional | quotes are optional in a `cn-market` run (§5.10), so requiring them would make every run without a quotes freeze `NOT_EVALUABLE` |
| A21 | an owned class's sentence cites "a derived item" | a contract may name, per owned class, which cited items carry it (`ownedBy` in `contract-core.mjs`; the default stays a derived item): environment's `index` class accepts an index quote, a bars item or a derived item; sentiment's `market` class the all-shares counts or an index derived item; sentiment's `sentiment` and theme's `theme` keep the derived default (theme's: a derived item of the boards source) | with the derived default every 指数 sentence had to cite turnover or breadth — the index-and-liquidity coupling system-design §4 forbids |
| §5.6, A21 | the theme module may name 题材 and 主线 candidates | a candidate's `name` must equal its cited board's frozen name and is exempt from the forbidden-word and scope rules (`exemptPaths: ["mainline_candidates[*].name"]`); its evidence ids still bind | a board's name is data of the freeze, and a frozen name may carry an owned or forbidden word |
| §5.6 | theme: "a 题材 named without a frozen board is `REFERENCE`" | built as the scope rule: a 题材, 主线 or 轮动 sentence that cites no boards-source derived item is `UNSUPPORTED_SCOPE`; a candidate citing a board, members item or name the run did not freeze is `REFERENCE` | the scope rule already sees every sentence; the candidate binding covers the structured names |
| A24 | what a context leaves out is named in `truncated` | `truncated` names whole rows left out; a view's cut of a shown row is carried on the row — `bars_total` beside an index's last 20 bars, `members_total` beside a board's first 10 members | the core adds rows whole; a cut row is still citable whole by its id |
| A24, A28 | the theme context's rows | the theme view shows ten members a list, and board, member-list and flow rows without their per-item `host`, `delayed` (and a board's `leader`); the hints state the boards source's hosts and delay once, from the digest; the evidence file keeps every stamp | all ten frozen member lists must fit 30 KiB at live size, so every candidate can cite its board's members item |
| A20, A24 | a derived item carries "the ids of its inputs" | every market module's context shows a derived item as one row shape, `{id, measure, value, params?, partial?, inputs_total}`; the evidence file and the digest keep the full input lists | thirty `turnover_share` items listing thirty ids each filled the theme context |
| §5.6 | sentiment's `state` needs two limit-up ids and one index id | each headline value other than `UNKNOWN` stands on a non-`INSUFFICIENT` claim of its own citing its kind of evidence (`ownClaims` in `lib/contracts/shared.mjs`): environment's `index_state` an index quote or bars, `liquidity_state` `total_turnover` or `advance_decline_ratio`; sentiment's `state` two limit-up ids and one index id across such claims, `money_effect` and `freeze_type` a limit-up derived item each; theme's `theme_stage` and `rotation` a boards derived item each | one broad claim could otherwise carry every headline at once |
| A7 | ten calls per module per run, "the refused ones counted" | the refusals counted are those inside a resolved run — `READ_FIRST`, `ALREADY_SUBMITTED`, `INVALID_ANALYSIS`, `TOOL_BUDGET`; the gates before the run resolves (`NOT_A_ROLE`, `WRONG_CHANNEL`, `NOT_A_STRATEGY`, `BAD_RUN_ID`) count nothing | there is no run to count against, and Gravit's mistaken root submit must not spend the role's ten calls |
| §5.7 | "a module's submit requires its own context read in this process" | a read counts toward `READ_FIRST` only once its context is built; a read whose evidence file is unusable or whose build throws still counts a call and seals, but leaves the submit `READ_FIRST`; a submit whose definition holds no digest (a row reloaded while the service lives) is `READ_FIRST` too | `READ_FIRST` must mean the role received a context |
| §5.7 | `SUBMIT_IN_PROGRESS` among the codes | never thrown: submits of one run serialize under the run's mutex, so a concurrent second submit of a module is `ALREADY_SUBMITTED` | one mutex per run already orders every write |
| §5.10 | "a run with `NOT_EVALUABLE` artifacts is journaled as such"; "the final message cites artifact ids" | the protocol has Gravit append a dated entry to `strategies/cn-market/journal.md` naming the run, the `NOT_EVALUABLE` modules and the missing sources; the final message names each artifact's file and headline, the modules with no artifact at all, and whether the quotes were delayed; `cn-reviewer` is not named, since it is plan 4's | an artifact has no id of its own beyond its run and file; a protocol naming a tool the tree lacks would send Gravit to call it |
| A10, A14 | `lunhui_read_run` reports each artifact's headline | it marks an artifact accepted only when `run.json` `artifacts[]` names the module, as the runs card does (plan 1's row) | a module file the submit did not record never reads as accepted |
| §5.9 | "the blocked exit after a read failure or the third rejection" | a failed read still stops the role; a module's third rejection stops that module only — the role goes on to the next module, names each blocked module under limits, and reports status `blocked` | the three market artifacts are independent; one module's failure should not cost the run the other two |
| §10 item 2 | the first market run on a real boot | `tests/lunhui-market-run-smoke.test.ts` runs it on fixtures and a stub model, with `globalThis.Date` shifted for the boot's lifetime to Friday 2026-10-23 15:00 China time, the session the fixtures carry; the live run on the operator's face is owed (`face/README.md` "Lunhui analysis") | a freeze row's `config.now` is a function, and the boot structured-clones every patch, so no patch can carry a clock into a booted row |

## 14. Build notes, plan 3 (2026-10-26)

Where plan 3's build ruled against this document's text, or fixed what the text left open. As with
§12 and §13, the clauses above stand as approved, the tree does what this table says, and the
operator may fold any line back into its clause or reverse it (`DEVELOPMENT.md` §10 item 21). The
rulings are in the plan's SDD ledger (`.superpowers/sdd/2026-10-26-lunhui-modules-plan-3/progress.md`).

| Clause | The text | What the tree does | Why |
|---|---|---|---|
| §5.5, A5 | the read takes `market_run`; "the mode artifact records `market_run` and its `snapshot_id`" | as §5.5 has it: only the leader and mode reads take `market_run`, and both submits take `{strategy, run, analysis}`; both artifacts carry `market_run` and `market_snapshot_id` as envelope fields, bound to the read's digest like `snapshot_id` | the plan had the submit take `market_run` too; the digest already binds the cited run, so a second argument would only add a way to be refused |
| A5, A25 | a cited run "whose `as_of` is the same trading day as the strategy run's, or the previous session's" | freshness reads `session` (§12's field), not `as_of`: the cited run's equal to the strategy run's or `previousTradingDay` of it, by the calendar tables; a strategy session no table covers, or a null session on either side, is `STALE_MARKET_RUN`; applied to the leader as to the mode; the strategy run is sealed before the cited run is checked, so a refused cited run leaves it sealed and the protocol opens a new one | `as_of` is the wall clock, which a weekend or pre-open freeze puts on another day than the data's; A25 fails closed outside the tables |
| A24 | a context carries artifact digests: "headline fields, every claim's id, text and evidence ids" | an artifact view is bounded: its id, module and headline fields, its first six claims with each text cut to 120 characters and cited ids whole, `claims_total` when cut; the digest keeps the artifact whole; an artifact the 30 KiB cap leaves out is counted in `truncated`, is not citable, and when the contract requires it enters `missing`, so the expected status is `NOT_EVALUABLE` | five artifacts of twelve long claims each could push the evidence a module must cite out of its context; an artifact the role never saw cannot be cited |
| A27, §5.6 | the leader validator requires each candidate "to be a member of a frozen board or pool of the cited market run" | the leader context shows of the cited run only the pool rows of the strategy run's equities and the mainline boards' member lists, each its first ten codes plus any frozen equity further down; a candidate is a priced equity quote of the strategy run whose code a pool row or member list holds, citing the quote and that row or list, its name the quote's; a `board`, when given, must be a mainline candidate of the cited theme artifact whose frozen member list holds the code — null may stand on any pool row or member list | a live-size market run would otherwise push the rows a candidate needs out of 30 KiB (measured: 21,307 bytes with the filters); 顺位 is ranked within the market run's mainline candidates (A27) |
| A21, §5.6 | the leader "may name 龙头 candidates as `leader_candidate` hypotheses"; it "may not name a 龙头 outside the frozen quotes" | 龙头 is written only as 龙头候选 — 总龙头 or a bare 龙头 anywhere but a candidate's frozen name is `UNSUPPORTED_SCOPE` — and a claim's 龙头候选 or 空间板 sentence must cite the quote of a listed candidate (`REFERENCE` otherwise) | a 龙头 sentence could otherwise stand on another stock's evidence or read as a conclusion; the label is revisable by the next day's freeze |
| A6, §5.4 | the counterevidence artifact's `items[]` "each with `against: <module>`, `evidence_ids`, `kind`" | fixed now, for plan 4 to build to: `items` 0–12 of `{id: x<1–2 digits>, against: one of the six module names, kind: CONTRADICTS, MISSING_EVIDENCE, STALE, RULING_CONFLICT or OVERREACH, text ≤ 300 characters, evidence_ids 1–16 (evidence ids or <module>@<snapshot_id>)}`; the mode reads the ids and answers each in `addressed: [{item, response, evidence_ids?}]` | the mode must address items by id before the reviewer exists; changing the shape later means a mode change |
| §5.6 | `S01`/`S02` require "every precondition cited" | each precondition the mode lists by name; a `met` one cites its own class — `theme_gate` and `theme_not_falsified` the theme artifact with a mainline candidate, a mainline board's row or member list, or a boards derived item; `candidate_before_divergence` and `candidates_pooled` the leader artifact or a candidate's quote or pool row; `negative_tail_not_widening` the `yesterday_negative_tail` derived item or the sentiment artifact; `old_theme_retreat` the theme or sentiment artifact or a boards derived item — `REFERENCE` otherwise; an `unmet: no source` one cites nothing | any known id would otherwise mark any precondition met |
| A22 | an `S01`/`S02` "requires an accepted counterevidence artifact in the run" | the artifact must be accepted with status `OK` and an `items` array; an `OK` review with no items passes; a `NOT_EVALUABLE` or malformed one is `UNADDRESSED_COUNTEREVIDENCE` | a review that evaluated nothing has not reviewed the conclusion |
| A27, A5 | leader and mode each take `market_run` | the mode read refuses `MISSING_EVIDENCE`, naming the leader's run, when the run's accepted leader artifact cites another market run than the one given | leader and mode must stand on one market snapshot, as A27's one pool a day has it |
| A12 | "the next run's mode context carries the previous card" | the previous card is the card of the strategy's newest accepted `mode.json` of a strictly earlier session, sought among its last 50 earlier runs; a same-session run is a re-run, not the next; when that artifact is a `WAIT` there is no card and no review is required, so an old card is never re-graded; a grade other than `NOT_EVALUABLE` cites an item the strategy run froze itself, of its session | the card is graded once, against the next session's frozen facts |
| A12, strategy-spec §2.2 | the card is the source's `ExpectationPlan` | `expectation` binds `frozen_version` to the run's `snapshot_id`, `state` to the cited sentiment artifact's state and `candidates` to the leader artifact's; strings at most 200 characters, lists at most five, the three branches 符合, 强于, 弱于; `price_band` is an observation band relative to the anchor, never a target price; a `WAIT` carries `null` | a card the run did not freeze, or one whose state differs from the cited sentiment, cannot be graded against frozen facts |
| A11 | the mode reads "the strategy's THESIS.md falsification terms" | the context shows the `## Falsification` section up to the next heading, at most 1,500 bytes cut on a character with `falsification_truncated`, `falsification_unreadable` when the file cannot be read, null when there is no section; the file keeps all of it | an operator's longer section must not push evidence out of the 30 KiB context; the two theses' sections read 1,445 and 1,421 bytes, whole, and the E4 paragraph, last, would be cut first |
| §5.4, §5.6 | the mode's `preconditions` | the schema admits 0–8 preconditions; `S01` and `S02` require their lists through the contract's rules; `WAIT` and `NOT_EVALUABLE` carry none; `WAIT` and a review graded `NOT_EVALUABLE` count as asserting nothing for the all-`INSUFFICIENT` and `NOT_EVALUABLE` rules (`unknownHeadline`) | a `WAIT` lists no preconditions, so a schema minimum would refuse the only conclusion available today |
| E4 | "the theses' falsification sections are re-fitted to the daily frame by the builder" | each thesis's Falsification section gains a closing `**Daily registration (E4)**` paragraph in Chinese, and its stale line "Not evaluable today: no A-share point-in-time bed, …" is reworded to the daily frame (a run is a daily registration and observation, never a trade; minute-level confirmation and announcements have no source) | the bed the line named left the tree on 2026-10-24; both texts await the operator's review (`DEVELOPMENT.md` §10 item 19) |
| §5.10, A22 | the strategy channel's order calls `cn-reviewer` between the leader and the mode | the protocol's strategy channel reads the day's market run, freezes the candidates' quotes, calls `cn-stock-analyst` for the leader and again for the mode, and reads the run back; it names no reviewer and says the counterevidence step comes later; on `STALE_MARKET_RUN` it has Gravit freeze a new market run and open a new strategy run | a protocol naming a tool the tree lacks would send Gravit to call it; the reviewer's step is plan 4's, so every strategy run concludes `WAIT` until then |

## 15. Build notes, plan 4 (2026-10-26)

Where plan 4's build ruled against this document's text, or against plan 3's rulings in §14. As
with §12–§14, the clauses above stand as approved, the tree does what this table says, and the
operator may fold any line back into its clause or reverse it (`DEVELOPMENT.md` §10 item 21). The
rulings are in the plan's SDD ledger (`.superpowers/sdd/2026-10-26-lunhui-modules-plan-4/progress.md`).

| Clause | The text | What the tree does | Why |
|---|---|---|---|
| A6, §14 | a counterevidence item's `text` "≤ 300 characters" | at most 160 characters; the mode's view shows each item's `id`, `against`, `kind`, its first 120 characters and its first three ids with `ids_total` | twelve 300-character items could not fit the mode context beside the evidence its grade needs; at 160 shown whole the candidates' quotes were cut |
| A24, §14 | an artifact view: six claims of 120 characters, "cited ids whole" | four claims of 120 characters, every `evidence_ids` list — a claim's or a headline entry's — its first three ids with `ids_total`, a headline item's `text` cut to 120; a contract may set a module's claims and characters (`artifactViews`); an artifact view that does not fit is skipped and the smaller views after it are still tried, never latching as evidence rows do; the digest keeps every artifact whole, and a module cites the artifact id or an item id, never an artifact's inner evidence through its view | at every input's maximum the mode context measured about 37.6 KB with ids whole; the views are what a module reads, the digest is what it is checked against |
| A24, §5.4 | the mode's context carries the three market artifacts' digests | the run's own leader and counterevidence views first, two claims of 60 characters each; then the market run's sentiment and theme headline-only (`claims_total`, no claims); then the leader candidates' quotes (a priority entry marked `first`, filled before the derived items); then the environment view headline-only, marked `late`, so at maximal inputs it is the view skipped; environment stays optional | the mode cites an artifact by its id and reads state and mainline boards from the headlines; the grade of a previous card stands on the candidates' quotes, which must outrank derived rows; no precondition reads the environment (option b of the ledger) |
| A24, §5.4 | "Which budget gives way" in the mode context (§11, question 6) | measured: a live-size market run with a previous card and twelve 160-character items reads 29,293 bytes; every input at its maximum at once — a 2,048-byte card, twelve items of sixteen ids, a five-candidate leader of sixteen ids each, five mainline candidates, a 1,500-byte falsification — reads 30,233 of 30,720 bytes, environment skipped, `OK`; about 1.1 KB of margin before the environment view, then the theme's, is skipped; items in 4-byte characters could take 1.5–2 KB of it | the cap is fixed (A24); what gives way first is the view no precondition reads, and next a view whose absence makes the run `NOT_EVALUABLE` (below), never an `S01` over an unseen state |
| §5.4 | the mode "requires `leader`" (§14) | the mode requires `leader`, `market:sentiment` and `market:theme`: a view the cap skips, or an artifact not yet accepted, is missing and the expected status `NOT_EVALUABLE` | a skipped sentiment view would otherwise let a role register on a state it never saw |
| A12, §14 | the expectation card's strings ≤ 200, lists ≤ 5 | also at most 2,048 bytes of compact JSON (`CARD_BYTES`, `BYTE_LIMIT` past it); a previous card stored larger is shown cut — every string but its ids and `state` to 120 characters, halved until it fits — with `card_truncated`, the artifact keeping it whole | a maximal card of five 200-character lists measured about 10 KB, enough to push the required leader out of the next run's context |
| A22, §14 | the `S01`/`S02` gate wants the run's counterevidence accepted `OK` with an `items` array | and its `market_run` equal to the mode's (`UNADDRESSED_COUNTEREVIDENCE` otherwise), the gate met before any `addressed` answer is checked | an `OK` review of another market run, or one read before the leader, must not let a registration through |
| §5.5 | the reviewer's read takes `market_run` (optional) | one row, channel `any`; the contract is picked by the strategy (`forStrategy`): in `cn-market` the run is the market run and a `market_run` given is `WRONG_CHANNEL`; in any other strategy `market_run` is required in code (`MISSING_EVIDENCE`, `refuse.marketRunMissing`), both uncounted — the schema leaves it optional for the market channel's sake | one tool for both channels, with each channel's binding exact |
| A22, §5.4 | the reviewer reads the run's accepted artifacts | in `cn-market` its environment, sentiment and theme, one of them required (`requiredAny`: none shown, all three missing); in a strategy channel the leader and the market run's three, `leader`, `market:sentiment` and `market:theme` required (the mode's list), and the read refuses `MISSING_EVIDENCE` when the run's leader cites another market run | an `OK` review must have seen what the mode stands on; leader, review and mode stand on one market run |
| A6, A21 | the reviewer "may deny any of" the readings | it owns every scope class, each carried by any cited evidence item; each item's strings are scoped by the item's own `evidence_ids` (`scopedFields`), and an item citing no `ev_` id is `REFERENCE`; an item `against` the mode, the review itself or a module whose view the context did not show is `REFERENCE` | a denial still stands on evidence, and only on what the reviewer saw |
| A19 | a module without its required evidence submits `NOT_EVALUABLE` | also when the context shows no evidence or derived row at all (a sealed empty run): the contract's `evidenceRequired` sources enter `missing` — the reviewer's channel sources, the leader's and the mode's quotes and market sources — and the example is rebuilt as `NOT_EVALUABLE`; the missing list then names every listed source, even one that froze rows the cap left out | an `OK` example whose one claim had nothing to cite was a context with no accepted path |
| A5, §5.10 | Gravit finds "the day's market run" | `lunhui_read_run` without `run` lists the strategy's newest sealed runs: at most five of its last 50 run ids, newest first, each `{run, session, sealed_at, snapshot_id, artifacts}`, open or unusable runs passed over, nothing counted or written; the protocol has Gravit take one of the day's or the previous trading day's session | plan 3's protocol left the market run's id to be found by hand |
| §5.10 | on `STALE_MARKET_RUN` "freeze a new market run and open a new strategy run" (§14) | the remedy is a whole sealed `cn-market` run made by the market section's order, re-read as `market_run`, and a new strategy run only when the strategy run itself is stale; until its leader is accepted a sealed strategy run may be re-read with a fresher market run | a fresh freeze not yet sealed is refused `MISSING_EVIDENCE`, so "freeze a new market run" sent Gravit to a second refusal |
| §5.10, A9 | the protocol carries the reviewer in both channels | `lunhui-run.md` at 2,999 of its 3,000 bytes: `cn-market` freezes, the analyst, the reviewer with no `market_run`, the read back; a strategy channel's listing read, candidates, quotes, the leader, the reviewer, the mode once the leader is accepted, the read back; `WAIT`, `NOT_EVALUABLE` and a refused mode are results | A9's cap; the reviewer must run before the mode (A22) |
| §5.9 | "the blocked exit after a read failure or the third rejection" (§13: a third rejection stops that module only) | `cn-reviewer` has one module, so its third rejection stops the role, as a failed read does; its persona has each item name a shown module, never the mode, and cite at least one `ev_` id; its route is `deepseek-flash`, and it shares only `skill` with each analyst | A23: the reviewer is not the writer |
| §10 item 4 | "the schema-size measurement" | measured 2026-10-26 at `d77bcd3` on a fresh scratch home made by `npm run setup` — no copy of the operator's home — with the Account service answering: 95 tools, 247,432 bytes, 49,885 chars/4; the seventeen `lunhui_` tools 23,523 bytes, 3,188 chars/4; the three `role_` tools 2,768 bytes, 689 chars/4 (`DEVELOPMENT.md` §4.3) | the face composes its AKShare and seat rows itself, so a fresh home measures what the live one does when the operator adds no MCP row, and no key store or session log is touched |
| §10 item 4, A12 | an `S01` registration and the next session's grading of its card on a real boot | `tests/lunhui-strategy-run-smoke.test.ts` runs two days on one boot — Friday 2026-10-23 and Monday 2026-10-26, `globalThis.Date` replaced for each day's prompt — each a reviewed market run and a strategy run; Friday registers `S01`, Monday grades it; the fixtures are one set, so Monday's grade reads Friday's quote bytes under Monday's session | a freeze row's clock cannot cross the boot's clone of patches (§13); a second fixture set for new prices is a deferred minor (`DEVELOPMENT.md` §10 item 19) |
