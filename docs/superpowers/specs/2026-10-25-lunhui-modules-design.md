# Lunhui modules — the manuscript's chapters as dsh rows

**Status:** design, written 2026-10-25 against `main @ a89502f` and dsh `0.2.0-rc.2`, for the
operator's approval · **Owner:** the operator · **Supersedes:** the plugin form of
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
| The repository is public; the manuscript stays out of git | `.gitignore` `/docs/research/lunhui/corpus/` | contexts carry paragraph ids and short hypotheses in the tree's own words, never the manuscript's text |

## 4. Decisions, as decided

The operator's are E1–E3 and the carried D2, D4, D10–D16; the rest are the author's calls, each
overturnable at review without redesign.

| # | Decision | Why |
|---|---|---|
| E1 | **dsh rows, not an MCP server.** Every Lunhui piece is a cordis row that registers its tools in-process; the stage-0 `server.mjs` and `manifest.json` retire | operator, 2026-10-25: dsh's plugin unit is the row; the MCP unit bought only runtime install, a non-goal |
| E2 | **Five analysis modules, by the manuscript's chapters:** 环境与大周期 (一, 八), 情绪周期 (二), 题材与轮动 (the 题材 pages and 六), 龙头与个股地位 (四), 模式选择与预期 (三, 七, and 模式选择 at P0159) | operator, 2026-10-25 |
| E3 | **A dedicated channel for the market-wide modules:** `strategies/cn-market/`, a tracked strategy directory whose thesis is the market read itself; its runs hold the environment, 情绪 and 题材 artifacts, and a strategy's run cites one of them | operator, 2026-10-25: market reads belong to no single strategy; the runs card and the write map keep their shape |
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
| A17 | **Egress from the face process:** `qt.gtimg.cn`, `web.ifzq.gtimg.cn` (stage 0), `push2ex.eastmoney.com` (the pools), `push2.eastmoney.com` (board lists, constituents, fund flow); 7-second timeout, 512 KiB per response, at most four requests in flight; documented beside the AKShare server's | the hosts AKShare itself calls for the same data |
| A18 | **The mode set is `S01`, `S02`, `WAIT`.** The R01–R14 families are labels the module may report as `research_only` matches with the reason they cannot be selected (data, ruling, or registration) | the graft's D10 and the source's §6 registration |
| A19 | **Versions in the artifact:** every artifact carries `module`, `contract_version`, `hypotheses_version` (the context's doctrine excerpt), `snapshot_id`, `run`, `as_of`; the runs card shows `contract_version` so a changed rule is visible in history | labels are never rewritten (system-design §4) |

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
snapshot_id, evidence: [{source, file, sha256, bytes, received_at}], artifacts: [<module>…] }`.
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
| `lunhui-freeze-index` | `lunhui_freeze_index({strategy, run?})` | the four indices' quotes and 120-day daily bars; the two exchanges' total turnover; advance/decline counts from the Tencent snapshot | ≤ 256 KiB per file |

A freeze with `run` omitted opens a new run and returns its id; with `run` it adds to that open
run (`RUN_SEALED` otherwise). Each source's items get evidence ids. A source that fails is a
refusal (`UPSTREAM_TIMEOUT`, `UPSTREAM_TOO_LARGE`, `UPSTREAM_INVALID`, `NO_MARKET_DATA`) that
writes nothing for that source; the run keeps what other sources froze. The whole run is bounded
at 2 MiB of evidence. The Eastmoney replies are JSON; the parsers are new, with recorded fixtures
as stage 0 records Tencent's.

### 5.4 The five modules, and the reviewer

| Module | Row | Chapters and paragraphs | Requires evidence of | Headline fields |
|---|---|---|---|---|
| environment (环境与大周期) | `lunhui-environment` | 一 (P0019–P0074), 八 (P1652–P1708) | index, quotes | `index_state`, `liquidity_state`, `cycle_anchor` |
| sentiment (情绪周期) | `lunhui-sentiment` | 二 (P0156–P0163), P0020–P0056 | limit-up, index | `state` (one of the seven), `money_effect`, `freeze_type` |
| theme (题材与轮动) | `lunhui-theme` | P0075–P0153, 六 (P1345–P1464) | boards, limit-up | `mainline_candidates[]`, `theme_stage`, `rotation` |
| leader (龙头与个股地位) | `lunhui-leader` | 四, P0654–P1340 | quotes, limit-up, boards | `leader_candidates[]` with 顺位, `top_pattern_flags` |
| mode (模式选择与预期) | `lunhui-mode` | 三 (P0164–P0452), 七 (P1610–P1650), P0159 | the strategy run's leader artifact, the cited market run's three artifacts, the previous `mode.json` | `mode` (`S01`, `S02`, `WAIT`), `preconditions`, `research_only_matches[]`, `expectation`, `expectation_review` |
| counterevidence (反证) | `lunhui-review` | the ten rulings (strategy-spec §7) and §5 | every accepted artifact of the run | `items[]` each with `against: <module>`, `evidence_ids`, `kind` |

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
  `lunhui_submit_environment({strategy, run, analysis})`, and the same pair for `sentiment`,
  `theme`, `leader`, `counterevidence`; `lunhui_read_mode_context({strategy, run, market_run})`,
  `lunhui_submit_mode({strategy, run, analysis})`

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
  cited, and every item of an accepted counterevidence artifact addressed by id; 打法 names from
  R01–R14 may appear only under `research_only_matches`.
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
the order: in `cn-market`, freeze index, limit-up and boards (quotes optional), then call
`cn-market-analyst` once with the run id; in a strategy channel, freeze quotes and limit-up for
the candidates, call `cn-stock-analyst` with the run id and the market run id, then
`cn-reviewer`, then `lunhui_read_run` to read the headlines; a `WAIT` or a refused mode is a
result, not a failure; a run with `NOT_EVALUABLE` artifacts is journaled as such; never freeze
after a role has read; never edit `analysis/`; the final message to the operator cites artifact
ids and says what was not evaluable. `GRAVIT.md` gains one line under "A strategy directory":
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
  the 2026-only calendar (R33); the Eastmoney endpoints are unofficial and may change shape or
  refuse, which the parsers turn into `UPSTREAM_INVALID`; point-in-time only from the first
  freeze; a run's freshness is the freeze's, and a market run cited the next session is a day
  old by design (A5).

## 9. Open items

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
