# Lunhui → Gravit: the plugin graft — design

**Status:** draft for operator review, written 2026-10-19, revised the same day for the MCP
form ·
**Owner:** the operator ·
**Authority:** `Gravit-Design.md` on intent, `DEVELOPMENT.md` and the code on mechanism; this
spec records the decisions of 2026-10-19 and what the builder is left to settle ·
**Source material:** the sibling repository `/Users/pan/Desktop/self-evolve/evolving-alpha`,
branch `codex/lunhui-agent-design` at `2ae4df0` (an orphan branch, four commits 2026-10-01..10-12),
read on 2026-10-19; the plugin-first pre-plan canvas
<https://claude.ai/artifact/YXtbu6APTziP2sZhinzzng>; the gravit-ui front-end spec's plugin model
(`docs/superpowers/specs/2026-10-09-demo-v2-gravit-frontend-design.md` §7.7 on `feat/gravit-ui`).

## 1. Intent

The Lunhui branch designed an A-share research agent on DeepSeek Harness and built one thing
that runs: a read-only research turn that freezes public Tencent quotes, lets the model read the
frozen evidence through two tools, and accepts a report only through a fail-closed validator.
Everything else there — a multi-role coordinator, a trading kernel, a risk engine, an order state
machine, a standalone web workbench, an intraday coordinator — is design text.

The operator's framing for the migration is dsh's own: **everything is a plugin**. So this is
not a port of an application into the face; it is a translation of each Lunhui piece into one
kind of dsh row, placed at one of the layers the face already composes, on the seams the face
already uses (`DEVELOPMENT.md` §3.6, §3.8, §4.3; `docs/research/2026-10-15-dsh-seams-inventory.md`).
Both sides run the same pinned dsh, `0.2.0-rc.2`.

The operator's decisions of 2026-10-19, which this spec is built on:

- **The tool rows go in the global layer**, as the AKShare row does (`face/src/akshare.ts`):
  project-owned, composed below the operator's profile patch, disabled by one operator line.
- **The freeze is done by the plugin itself** fetching Tencent. The model never touches
  unfrozen market data.
- **The plugin takes the product's own plugin form: one MCP server plus one manifest**, the
  shape the gravit-ui spec gives a plugin (§7.7: `id, name, kind, blurb, icon, tools, writes,
  needs, visibility, by`), in Node, so that it is visible where the product shows plugins — the
  face's plugin panel today, the Discover and Installed screens of the new front end later — and
  installable there without a second mechanism.
- **The field is the channel.** A strategy directory is the channel; the plugin's runs land in
  `strategies/<name>/analysis/`, and the channel page gains a runs card that shows them.

**Builder check, 2026-10-19.** A fresh reviewer read the first version of this document against
both trees. Its corrections are folded in. The two questions only the operator could answer —
the corpus in a public repository, the playbook against the existing doctrine skill — were
answered the same day: the corpus stays out of git (D11), the playbook is a research input and
no style skill (D10). The MCP form (D3–D5, D17–D19) came after the check; §7 names what it
re-opens for the builder.

## 2. Goals, non-goals, anti-goals

**Goals**

- G1. Gravit can run one Lunhui-style read-only research turn inside a strategy channel: freeze a
  bounded sample of A-share quotes and daily bars into the strategy directory, delegate the
  analysis to a one-shot role, and get back a structurally validated WATCH/WAIT report whose every
  number cites a frozen evidence id.
- G2. The validator's guarantees survive the move intact: schema, real evidence references,
  CURRENT/HISTORICAL wording separation, no trading or account language, no whole-market or
  leadership assertions, a byte budget, an immutable snapshot id.
- G3. The Lunhui knowledge enters the tree where Gravit's existing contracts put it: strategy
  directories for the two hypotheses, a mechanics skill for the fact rules, a frozen research
  corpus (its hashes in the tree, its text out of git) for the source paragraphs.
- G4. Every new row is pinned the way the seams inventory pins the existing ones: a test, a
  documentation row, and a sentence on what breaks if upstream moves the seam.
- G5. The plugin is visible as a plugin: the face's plugin panel lists the `lunhui` server with
  its four tools and its phase the moment the row mounts, with no panel change; the manifest
  beside the server is the card the new front end's Discover renders.
- G6. The plugin's output is visible in the field: the channel page shows the latest run's
  conclusion, sample and gaps, and lists every run, next to the backtests it already shows.

**Non-goals (this spec)**

- No A-share point-in-time bed, no `replay_days` for A shares, no backtest of S01/S02. The two
  strategy directories carry status `idea` and say so. A bed is a later spec, gated on the
  operator's still-open decisions (§9).
- No trading kernel, risk engine, permit, order state machine, paper account. Gate 1 and Gate 2
  remain the only order machinery; nothing here registers an order tool.
- No headless worker, no external event coordinator, no `schedule`. The face tree has neither
  the `dsh-headless` nor the `dsh-schedule` package installed; a research run starts when the
  operator starts it, inside a channel session.
- No second workbench UI. Lunhui's `frontend/` app, its synthetic `SIM.*` demo and its
  `/api/analysis/*` routes are not ported; the face is the only surface.
- No step budget on the child (`agent/pre-step`): the run is bounded by the server's call cap,
  not by a dsh step budget — ten calls on an unsubmitted run, the freeze counted (D7) — beside the
  one-shot role's `toolFilter` and dsh's own timeouts (amended 2026-10-20, ruling R41).
- No runtime install. The row is composed at boot like the AKShare row; enabling and disabling
  it is an operator patch line and a restart. The Discover install flow (`shop.install`) is the
  new front end's and a later spec's (§9).
- No Discover rendering in this spec: the manifest is written and the plugin panel lists the
  server; wiring the manifest into the new front end's shelves is that front end's work.

**Anti-goals (a failure even if it works)**

- A path by which the model's prose, a tool argument or an evidence payload moves the as-of,
  widens the sample or names a path: the snapshot is frozen by host code and hashed; the tools
  take a strategy name, a run id and a symbol list, and nothing else.
- A report that reads as a trade: the forbidden-text rule stays, applied to the report artifact
  only.
- Any change to `data/pit/`, `dsh/profile/`, `bots/`, or the `alpaca_kit` firewall surfaces —
  save `bots/gravit/agent.cordis.yml`, the generated mirror of Gravit's composition, which
  `cd face && npm run render:roles` regenerates from `roles/` whenever a role changes (D8, §5.3;
  amended 2026-10-20, final review).
- A row Gravit's roles could not see or a bot could: visibility follows the existing allow-list
  mechanics, nothing bespoke.

## 3. Constraints the design lives under

| Constraint | Where it is enforced | Consequence here |
|---|---|---|
| dsh pinned at `0.2.0-rc.2`, no fork, no loop wrapping (charter §7.3) | `face/package.json`, `DEVELOPMENT.md` §4.1 | a `dsh-mcp-client` row and an MCP server, the same two pieces the AKShare and alpaca-kit rows are |
| The global layer order: bundle → policy → AKShare → profile patch → home patch → overlay (seam B1) | `face/src/boot.ts:composeFace` | the Lunhui row source is inserted beside `aksharePatches()`; an operator row with the same id wins |
| Public MCP tool names are minted `mcp__<serverName>__<rawName>` (seam G5) | `dsh-mcp-client` | the four tools are `mcp__lunhui__freeze_market_snapshot`, `…__read_market_snapshot`, `…__read_strategy_context`, `…__submit_analysis`; roles name them exactly so |
| A role's `allow` is exact tool names, checked against the never-list at read time, against the live tree at call time (`DEVELOPMENT.md` §3.8) | `face/src/roles.ts` (`NEVER`, `TOOL_NAME_RE`) | the four names pass; `mcp__akshare__` stays refused; an MCP tool exists only while its server is mounted and connected, so a missing server fails that delegation, never the boot |
| An MCP server's `instructions` become an unswitchable prompt section `mcp:<serverName>` that bots see too (seams G3, H9) | `dsh-mcp-client` | the server sends no instructions (D19); the tool descriptions carry everything |
| `failOnStartupError: false` leaves a row ACTIVE with no tools when the server cannot start; the plugin panel is the check (seam G4) | `dsh-mcp-client`, `face/src/panels.ts` | the README names the panel line to look for; the smoke pins the four tools on a real boot |
| The MCP child's environment is scrubbed; stdio negotiation spawns the server twice per connect (seams G7, G2) | dsh | the server needs no secret and starts in well under a second; it reads `LUNHUI_STRATEGIES_ROOT`, which the row sets, and `LUNHUI_FETCH_FIXTURES`, which the row sets empty (tests only; Ruling R21) |
| `ROLE.md` ≤ 2,000 bytes, no `{{`; `role.yml` description ≤ 300 characters | `face/src/roles.ts` | the Lunhui persona (1,044 bytes) fits; the hints (3,291 bytes) go in the tool payload |
| `GRAVIT.md` ≤ 4,500 bytes, now 4,321 | `face/tests/gravit-md.test.ts` | at most one short line about `analysis/`; A-share rules go in the skill |
| The operator's `skill-filesystem` row mounts exactly two roots, `dsh/skills/mechanics` and `dsh/skills/style-gravit` (seam H1) | the operator's `cordis.patch.yml` | the new skill is a directory under the mechanics root; no patch change |
| `SKILL.md` needs `name` + `description` frontmatter or is dropped silently (seam H2) | dsh discovery | the skill carries the block |
| The AKShare tools are 77% of the tool-schema block (R31) | `face/scripts/schema-sizes.ts` | the four new tools are measured and recorded; their schemas stay small |
| Nothing starts unattended (charter §1, P5) | — | no timer, no cron, no watcher in the server |
| The channel page is built from the directory's own files, every block independent (`face/src/channels.ts:readChannelBody`) | `face/src/channels.ts`, `face/client/channels.js` | the runs card is one more independent block, read from `analysis/` |

## 4. Decisions, as decided

The operator's are D1, D2, D3, D10, D11, D17 and D18. The rest are the author's calls; each can
be overturned at review without redesign.

| # | Decision | Why |
|---|---|---|
| D1 | The plugin is a **global-layer** project row, `id: mcp-lunhui`, a `@deepseek-ai/dsh-mcp-client` stdio row with `serverName: lunhui`, inserted by `lunhuiPatches()` in `face/src/lunhui.ts` immediately after `aksharePatches()` in `composeFace` | operator, 2026-10-19: precedent, one-line disable, masked tools cost a bot nothing |
| D2 | **The server freezes**: `freeze_market_snapshot` fetches `qt.gtimg.cn` (quotes) and `web.ifzq.gtimg.cn` (daily bars) from the MCP child process | operator, 2026-10-19: the model never sees unfrozen data; the egress is the child's, as AKShare's is |
| D3 | **One MCP server in Node plus one manifest**, under `face/plugins/lunhui/`: `server.mjs` (the entry: the four tools over stdio), `contract.mjs` (the validator and the hints, a port of `analysis-contract.mjs`), `market.mjs` (the Tencent parsers and fetchers, the 2026 calendar, and the pure assessment functions of `market-service.mjs` that `buildAnalysisContext` consumes — `normalizeQuotes`, `assessQuote`, `completedSessionBoundary`, `normalizeHistory`), `runs.mjs` (the strategy and run-directory contract), `manifest.json` (D17), `README.md`. Dependency added to `face/package.json`, pinned exactly: `@modelcontextprotocol/server` `2.0.0`, whose `./stdio` export carries the stdio transport (corrected at build time, 2026-10-20: `@modelcontextprotocol/node`, first listed here, is HTTP middleware and is not needed) — the same major and minor as the `@modelcontextprotocol/client` `2.0.0` the face's dsh-mcp-client already pins, and the versions dsh-mcp-client's own tests run against | operator, 2026-10-19 (MCP, Node): the modules are dependency-free JavaScript already covered by ~1,500 lines of node tests on the source branch; a Python port would rewrite the 629-line validator and its tests |
| D4 | Every tool is anchored on a **`strategy` argument**, not on a session: the row sets `LUNHUI_STRATEGIES_ROOT` to `<repo>/strategies`; a strategy name is validated by the channel grammar (a letter or digit in any script first, then letters, digits, `-` and `_`, at most 41 code points); the directory must hold a readable `THESIS.md`; runs live under `<strategies>/<name>/analysis/<run>/`; every path the server touches is `lstat`ed and must be a real file or directory, never a symbolic link, and must resolve under the root | the MCP child is a child of the face process and knows no session; a name validated against the arena is as safe as a cwd and lets Gravit name the channel it is in |
| D5 | Parameters, and nothing that selects data beyond them: `freeze_market_snapshot({strategy, symbols})`; `read_market_snapshot({strategy, run})`; `read_strategy_context({strategy, run})`; `submit_analysis({strategy, run, analysis})`. A run id matches `^[A-Za-z0-9_-]{1,64}$` and is the one `freeze_market_snapshot` returned | the source plugin took no parameters because each run was its own process; one long-lived server needs a locator and must never accept a path |
| D6 | The validation–retry loop is kept as an **MCP error result**: a rejected `submit_analysis` returns `isError: true` with the field-level reason and the fixed repair hint; dsh-mcp-client turns that into a thrown error (`lib/index.js:236`), ToolRuntime records a failed call, the child sees `Error: [<category>] …` and retries. Success writes `analysis.json` atomically, marks the run submitted and returns `{accepted: true}`; the child then writes its four-heading report as its last message, which is what a one-shot child returns. After acceptance the reads stay allowed, past the call budget too, and a second submit is refused (amended 2026-10-20, ruling R41: D7's budget binds only an unsubmitted run) | the source's `concludeTurn` ended a headless process; a tool cannot end a dsh turn from an MCP server, and the builder check showed that ending it would have lost the child's report anyway |
| D7 | No guard and no step budget in the server, but a per-run call budget (amended 2026-10-20, ruling R41, the shape of R26): a run not yet submitted takes ten calls, the freeze counted as its first, and each later call on it is refused `TOOL_BUDGET` before its tool runs, still counted, the refusal's text carrying the stop instruction; an accepted run's reads stay open (D6). The count is the per-run tool-call counter, in the server's memory and in `metrics.json`, so the budget holds across a restart; a missing or corrupt `metrics.json` at a restart starts it again at zero, fail-open by design. Not bounded: calls that never resolve a run, and freezes, each a new run with a budget of its own. The allow list is the role's `toolFilter`; the submitted flag lives beside the counter | a step budget is a non-goal; dsh caps no child's turns (Ruling R24) and the role runs a small model, so the server gives a stuck child a deterministic stop that the `blocked` report follows, at the source's own ten calls |
| D8 | The role is `roles/cn-analyst/` (`role_cn_analyst`): `ROLE.md` = the Lunhui persona prefix, trimmed to the role contract; `allow` = `skill`, `mcp__lunhui__read_market_snapshot`, `mcp__lunhui__read_strategy_context`, `mcp__lunhui__submit_analysis` (no file tools: amended at build time, 2026-10-20, Ruling R23, after a security review flagged `read`/`glob`/`grep` as needless scope for a child reading untrusted market data); `model: deepseek-official/deepseek-flash`, the route the source validated its runs on (a role's `agentOptions` carry provider and model only) | the role needs no `bash`, no `write` (the server writes the artifact), no file read (everything it analyses arrives through the two read tools, as in the source, whose analysis turn had exactly its three tools), no other MCP tool; without the pin the child would inherit Gravit's `deepseek-v4-pro` at effort `max` on every run |
| D9 | The contract hint and the fact-check hint (3,291 bytes together) have **one home**, `contract.mjs`, and reach the child inside the `read_strategy_context` result as the source did. The mechanics skill `dsh/skills/mechanics/cn-market-facts/` is a short restatement (≤ 1,500 bytes) for Gravit's own writing and for any role; it points at the tool text and does not duplicate it | a skill body that mirrors a tool payload drifts; persona plus hints would exceed `ROLE.md`'s 2,000 bytes |
| D10 | The doctrine — `strategy-spec.md` §1–§2 and §7 (the conflict rulings), the seven market states, the R01–R14 index — is a **research input, not a style skill** (operator, 2026-10-19): the hypotheses live in the two THESIS.md files (D12); the rulings, the market states and the R-index live in `docs/research/lunhui/README.md` beside the corpus; `cn-market-facts` carries one line saying S01/S02 are hypotheses under test, not preferences. No `lunhui-playbook` skill, no amendment to `doctrine` | the existing `doctrine` skill already carries the operator's market vocabulary and an `intraday_burial` entry that demotes intraday sentiment reading; a second style skill saying the opposite would be followed by default too |
| D11 | The branch's eight design documents, three schemas and two synthetic examples go under `docs/research/lunhui/design/` byte-identical and are committed. The corpus — the five extraction files and `轮回.docx` (1.3 MB) — **stays out of git** (operator, 2026-10-19): `docs/research/lunhui/corpus/` is gitignored; the tree keeps `manifest.json` as the branch wrote it (the docx and media hashes) and, in the `README.md`, the sha256 of each extraction file; the local copy is restored by hand from the sibling branch, and every citation in the tree is a paragraph id | `docs/research/` is the never-edit frozen-inputs directory; `KairosPan/Evolving-Alpha-US` is a PUBLIC repository and 《轮回》 is a third party's text |
| D12 | Two strategy directories, `strategies/lunhui-s01-repair/` and `strategies/lunhui-s02-rotation/`, copied from `_template`, status `idea`; THESIS.md carries the hypothesis, the joint triggers and the failure terms of `strategy-spec.md` §3 and §4 with their Pxxxx citations, and the falsification section says plainly that no bed can decide them yet; `screen.py` and `backtest.py` stay the template's placeholders | the cycle contract is one idea per directory; an `idea` directory with honest terms is the arena's way of parking a hypothesis |
| D13 | The report artifact is validated under the Lunhui rules, including the forbidden trading words; **THESIS.md is not** — it carries entry and exit rules by contract | the two documents answer different questions |
| D14 | Tool descriptions, the hints, the persona and the report stay in **Chinese**; this spec, the code, the tests and the documentation rows are English like the rest of the tree | the validator's word rules are Chinese; the operator researches A shares in Chinese |
| D15 | `GRAVIT.md` gains one line under "A strategy directory": `analysis/` holds frozen A-share research runs written by the Lunhui server, never edited by hand | 179 bytes of headroom |
| D16 | Charter §1's MARKET bullet gains one sentence beside the AKShare carve-out: the Lunhui server freezes hashed Tencent samples into a strategy directory for read-only research; like the AKShare reads they carry no PIT guard and are never backtest evidence. P3's two sanctioned channels are unchanged | the author's call, for the operator to veto |
| D17 | **The manifest** `face/plugins/lunhui/manifest.json`, in the gravit-ui spec's shape: `id: "lunhui"`, `name: "轮回 A 股研究"`, `kind: "Quant"`, `blurb` (one line: freezes a bounded A-share sample and submits a validated WATCH/WAIT report), `icon: null` (initials), `tools`: the four raw names, `writes: ["analysis/<run>/"]`, the run directory the plugin writes (amended 2026-10-20, ruling R40: the card tells an installer no less than the plugin does), `needs: "Nothing"`, `visibility: "private"`, `by: "@you"`. Today's face does not read it (the plugin panel lists the server from the live tree); the new front end's Discover reads it | operator, 2026-10-19: the product's plugin is one MCP server plus one manifest |
| D18 | **The runs card**: `ChannelBody` gains `runs` and `latestRun` (§5.7), read from `analysis/`, and the channel page renders a "latest analysis" section between "latest evidence" and the journal | operator, 2026-10-19: the field is the channel |
| D19 | The server sends **no `instructions`** on initialize; every rule the child needs is in the tool descriptions and the `read_strategy_context` payload | an MCP server's instructions enter every prompt, bots' included (seams G3, H9) |

## 5. The design

### 5.1 The server: `face/plugins/lunhui/server.mjs`

A stdio MCP server on `@modelcontextprotocol/server` 2.0.0 with the Node stdio transport, started
by the row with `command: process.execPath` (the face's own Node) and `args: [<absolute path to
server.mjs>]`, `cwd: <repo root>`, `env: { LUNHUI_STRATEGIES_ROOT: <repo>/strategies, LUNHUI_FETCH_FIXTURES: "" }`. It
registers the four tools with their Chinese descriptions and JSON-schema inputs, sends no
instructions, and holds per-run state in memory (`reads`, `submitted`, `toolCalls`) mirrored to
`metrics.json`.

**Anchoring (D4).** `runs.mjs` resolves `strategy` under `LUNHUI_STRATEGIES_ROOT`: the grammar
check, `lstat` (a real directory, not a link), a readable `THESIS.md`, the resolved path under the
root. A run id is validated and joined under `<strategy>/analysis/`; the run directory is
`lstat`ed the same way. Failures are stable codes: `NOT_A_STRATEGY`, `BAD_RUN_ID`, `NO_SUCH_RUN`.
A file the server reads in a run is read from its opened handle only when that is a regular,
single-link file of at most 256 KiB, §8's bound on a run; a larger one is `NO_SUCH_RUN`, refused
before it is read (amended 2026-10-20, ruling R38).

**The tools.**

`freeze_market_snapshot({ strategy, symbols })` — `symbols`: 1..8 strings, each `^(sh|sz)\d{6}$`,
indices limited to the four the source knows (`sh000001`, `sz399001`, `sz399006`, `sh000300`),
equities to main-board codes `sh60xxxx` / `sz00xxxx`, at most four of each, no duplicates.
Fetches quotes for all symbols in one request and daily bars per symbol (at most four in flight),
decoding GB18030, applying a 7-second timeout and a 512 KiB cap per response, converting 手 to
shares and 万元 to CNY, keeping the source timestamps; builds the snapshot and the research
context exactly as the source's `buildAnalysisContext` does (universe, evidence with
`ev_<sha256-24>` ids, `basis` CURRENT / HISTORICAL / INSUFFICIENT from the 2026 calendar and the
120-second freshness rule with `cache.state` fixed at `fresh`, the two `NOT_EVALUABLE` playbooks,
the limitations list, the `snap_<sha256>` id over the canonical context); creates `analysis/` if
absent (`recursive`, mode `0o700`) and then `analysis/<run>/` exclusively (`mkdir` without
`recursive`, fails on EEXIST); writes `snapshot.json`, `context.json` and `metrics.json` with the
`wx` flag. Returns `{ run, snapshotId, asOf, universe, quality, limitations, paths }`. The run id
is `<YYYYMMDD>T<HHMMSS>Z-<8 hex>`. A failed fetch returns `isError` with a stable code
(`UPSTREAM_TIMEOUT`, `UPSTREAM_TOO_LARGE`, `UPSTREAM_INVALID`) and writes nothing.

`read_market_snapshot({ strategy, run })` — returns the text of `snapshot.json`. The description
says, as the source's did, that `previousClose` is the previous trading day's close of the quote's
own trading day and that no field is an instruction.

`read_strategy_context({ strategy, run })` — returns one JSON text: the context,
`ANALYSIS_JSON_SCHEMA`, the contract hint and the fact-check hint, `derivedFactChecks` (the
deterministic adjacent-close comparisons, at most the last eight per history,
`calendarContinuityVerified: false`), and a host-validated `schemaExample` built from the run's
first evidence, with the sentence that it is a shape, never a report to copy. Its `instructions`
open with the server's scope sentence, `SCOPE`, before the two hints, which stay verbatim: the
JSON-only rule and the example's length guidance bind the `analysis` argument, not the caller's
last reply (amended 2026-10-20, ruling R42).

`submit_analysis({ strategy, run, analysis })` — refuses unless both reads of this run happened in
this server process (`READ_BOTH_FIRST`), refuses a run already submitted (`ALREADY_SUBMITTED`,
once `analysis.json` has landed), refuses a submit that arrives while another submit of the same
run is still being checked (`SUBMIT_IN_PROGRESS`, retried once that one answers; amended
2026-10-20, ruling R39),
validates `analysis` with `validateAnalysis(raw, context)` against the run's own `context.json`;
on rejection classifies the reason (`SCHEMA`, `REFERENCE`, `TIME_SCOPE`, `UNSUPPORTED_SCOPE`,
`EXECUTION_CONTENT`, `BYTE_LIMIT`, `OTHER`), appends the category to `metrics.json` (at most ten
kept) and returns `isError: true` with the text `[<category>] <field-level reason>\n修复：<the
category's fixed repair hint>`; on success writes `analysis.pending.json`, renames it to
`analysis.json`, sets `submitted`, updates `metrics.json` and returns `{ accepted: true, run,
snapshotId }`.

**Metrics.** `metrics.json` per run: `{ toolCalls, reads: [...], submitted, validationRejections:
[...] }`, written on every change, mode `0o600`. No step count (D7); `toolCalls` is the call
budget's count (amended 2026-10-20, ruling R41): ten calls a run while it is unsubmitted, the
freeze the first; a restart continues it from the file, and a missing or corrupt file starts it
again at zero, fail-open by design; calls that never resolve a run and freezes are not bounded.

**Errors.** Every failure is an `isError` result whose text opens with a stable code word; no
upstream body, no path outside the run directory, no stack reaches the model. `TOOL_BUDGET` is the
refusal of every call on an unsubmitted run past its ten, before its tool runs, and its text
carries the stop instruction: report `blocked`, and Gravit freezes anew to start again (amended
2026-10-20, ruling R41).

**Egress.** `qt.gtimg.cn` and `web.ifzq.gtimg.cn`, from the MCP child, HTTPS only; documented in
`face/README.md` beside the AKShare server's, which reaches the same vendor. The face process
itself gains no outbound host (the face already reaches `smartbox.gtimg.cn` for symbol search).

**What is deliberately not ported.** `ctx.tools.guard`, the `agent/pre-step` budget,
`exec.concludeTurn()`, the headless profile, the spawn, the event projection, the credential
loader (no key is needed), the HTTP routes, the UI.

### 5.2 The row source: `face/src/lunhui.ts`

```ts
export const LUNHUI_MCP_ROW_ID = "mcp-lunhui";
export const LUNHUI_SERVER_PATH = fileURLToPath(new URL("../plugins/lunhui/server.mjs", import.meta.url));
export function lunhuiPatches(repoRoot = fileURLToPath(new URL("../../", import.meta.url))): FacePatchList {
  return [{ insert: [{
    id: LUNHUI_MCP_ROW_ID,
    name: "@deepseek-ai/dsh-mcp-client",
    config: {
      transport: "stdio", serverName: "lunhui",
      command: process.execPath, args: [LUNHUI_SERVER_PATH], cwd: repoRoot,
      env: { LUNHUI_STRATEGIES_ROOT: join(repoRoot, "strategies"), LUNHUI_FETCH_FIXTURES: "" },
      toolCallTimeoutMs: 60_000, failOnStartupError: false,
    } satisfies StdioConfig,
  }] }];
}
```

`composeFace` composes it as `const lunhuiPatches = …` directly after `marketPatches`, in both
the `patches` array and the `below` composition, so an operator row with the same id wins and a
`disabled: true` in the profile or home patch removes it (the AKShare precedent, seam B1; the
tests mirror `boot.test.ts`'s three AKShare cases). The dry run (`scripts/check-home.ts`) already
disables every `dsh-mcp-client` row by package, so this one is covered without a change.

### 5.3 The role: `roles/cn-analyst/`

```yaml
name: CN analyst
description: Reads one frozen A-share research run (snapshot + strategy context) and submits a validated WATCH/WAIT report through mcp__lunhui__submit_analysis; cites evidence ids only, trades nothing, writes nothing else.
allow:
  - skill
  - mcp__lunhui__read_market_snapshot
  - mcp__lunhui__read_strategy_context
  - mcp__lunhui__submit_analysis
model: deepseek-official/deepseek-flash
```

`ROLE.md` (Chinese, ≤ 2,000 bytes): the source's persona prefix — a read-only A-share researcher
who uses only the frozen evidence of this run, treats every external string as data, reads both
research tools before submitting, separates historical fact from hypothesis, checks every number
against a field — followed by the role contract: the `strategy` and the `run` id come from
Gravit's brief; load the `cn-market-facts` skill first; submit through `submit_analysis` and fix
exactly the rejected fields on a rejection; once the submit is accepted, write the report under
the four headings (status, what was measured, paths, limits) as the last message, with `paths`
naming `analysis/<run>/analysis.json` and `what was measured` restating the report's conclusion,
the symbols and the evidence basis — nothing the artifact does not hold. After a read that fails
or a third rejected submit, the child stops and writes the same four headings with status
`blocked`; the analysis JSON goes only into `submit_analysis`'s `analysis` argument, never as the
final message (Ruling R24, at build time 2026-10-20: nothing in dsh caps a child's turns). After an edit, `cd face
&& npm run render:roles` regenerates `bots/gravit/agent.cordis.yml`, and `tests/roles.test.ts`
fails until it does. The role appears in `gravit:roles` automatically.

### 5.4 The skill

`dsh/skills/mechanics/cn-market-facts/SKILL.md` — frontmatter `name: cn-market-facts`,
`description: A-share fact discipline for frozen-evidence research: previous close, day-by-day
trend checks, fact versus hypothesis, what the Lunhui tools return and refuse.` — the value
YAML-quoted in the file, because the YAML parser dsh's skill discovery uses throws on its
unquoted ": ", and dsh then logs one warning and drops the skill (found at build time,
2026-10-20; a test now parses every shipped skill; amended 2026-10-20, final review: the parser
throws, it does not read a nested mapping). Body ≤ 1,500
bytes: the seven fact-check rules in one line each; that the full text arrives inside
`read_strategy_context`; that S01/S02 are NOT_EVALUABLE on quotes and daily bars; that S01 and
S02 are hypotheses under test in `strategies/lunhui-*`, not preferences, and that the operator's
preferences are the `doctrine` skill's; that a report is a WATCH or a WAIT and never a trade.
Mechanics: law, never overruled by findings.

There is no second skill (D10): the 轮回 doctrine enters the tree as the two theses and as the
`README.md` of §5.5, never as something Gravit follows by default.

### 5.5 The knowledge

`docs/research/lunhui/` (committed): `README.md` — what this is and the source commit
(`2ae4df0` on `codex/lunhui-agent-design` in the sibling repository); the sha256 of the docx and
of each of the five extraction files; the 三层分离 rule (原文 / 观测代理 / 工程裁决); the seven
market states as revisable hypotheses; the R01–R14 table (code, family, what is unsolved); the
ten conflict rulings; the sentence that every number in the source (情绪 1500/3500, 封单
8/10/15 亿) is a research candidate, not a parameter; how to cite a paragraph
(`grep -n '^\[P0243\]' corpus/extracted.txt`); and how to restore `corpus/` by hand from the
branch. `manifest.json` as the branch wrote it. `design/` holding the branch's `README.md`,
`docs/*.md` (eight), `contracts/*.schema.json` (three), `examples/*.json` (two), each with a
one-line header comment naming the source commit where the format allows one (Markdown yes, JSON
no — the `README.md` lists the commit for all).

`docs/research/lunhui/corpus/` (gitignored, D11): `extracted.txt`, `paragraphs.json`,
`tables.json`, `image-anchors.tsv`, `轮回.docx`, copied by hand; a `.gitignore` line
`docs/research/lunhui/corpus/` in the repository root, verified by `git check-ignore` before the
knowledge commit. GRAVIT.md's never-edit rule for `docs/research/` covers the local copy too.

`strategies/lunhui-s01-repair/` and `strategies/lunhui-s02-rotation/` as D12 says. `status.yaml`:
`status: idea`, `one_line: "S01 主线核心分歧修复 — not evaluable: no A-share bed, no minute bars,
no frozen theme membership"` (and the S02 twin), `next: "a Lunhui read-only run on a frozen
sample; a bed is a later spec"`. The journal's first entry records the copy and the source
commit.

### 5.6 The manifest: `face/plugins/lunhui/manifest.json`

The gravit-ui spec's shape (D17), one JSON object, UTF-8, no code: `id`, `name`, `kind`, `blurb`,
`icon`, `tools` (the four raw tool names, the same strings `server.mjs` registers), `writes`,
`needs`, `visibility`, `by`. A test keeps `tools` equal to the server's registered names, so the
card can never advertise a tool the server does not have. Nothing in today's face reads the file;
the plugin panel (`/data/plugins.json`, **Plugin → lunhui**) already lists the server with its
phase and its four tools from the live tree, which is this spec's visibility. The new front end
reads the manifest for its Discover card and Installed grid; that wiring is its own change.

### 5.7 The runs card

**Wire (`face/src/channels.ts`).** `ChannelBody` gains two independent blocks, read like the
others — a missing or broken file yields the block's empty value and never fails the rest:

```ts
runs: { run: string; asOf: string | null; conclusion: "WATCH" | "WAIT" | null; bytes: number }[];
latestRun: { run: string; analysis: unknown; context: { asOf: string; universe: unknown[]; quality: unknown; limitations: string[] } | null } | null;
```

`runs` lists every `analysis/<run>/` directory (run ids by the grammar, newest first by id),
with `asOf` and `conclusion` read from `context.json` and `analysis.json` when both parse;
`latestRun` is the newest run among the listed ones whose `analysis.json` parses (Ruling R30), with the context's four summary
fields. A run directory without `analysis.json` (frozen, not yet submitted) still lists, with
`conclusion: null`.

**Page (`face/client/channels.js`).** A new section "latest analysis" between "latest evidence"
and the journal: the run id and `asOf`; the conclusion as a chip; the universe (symbol · name ·
kind) and the quality status; `summary`, then the observations as a table (symbol, stance, basis,
thesis), then `risks`, `missingData`, `nextChecks` as lists; a `details` with the full
`analysis.json`; then every run as a dim file line `analysis/<run> · <conclusion or "frozen,
not submitted"> · <bytes>`. Empty states: "no analysis runs yet" when `runs` is empty; "the newest
run has no accepted report yet" when `runs` has entries and `latestRun` is null. The new front
end on `feat/gravit-ui` renders the same wire fields when it lands; this spec changes only the
shipped client.

### 5.8 What Gravit does with it

Inside a channel session of either Lunhui strategy:

1. The operator asks for a read-only look at a list of codes.
2. Gravit calls `mcp__lunhui__freeze_market_snapshot` with the channel's name and the codes; it
   reads the returned universe, quality and limitations, and writes nothing yet.
3. Gravit calls `role_cn_analyst` with a brief: the strategy name, the run id, the question, the
   expected four-heading report, and that `analysis/<run>/analysis.json` is the artifact.
4. The child loads `cn-market-facts`, reads both tools, submits, retries on a field-level
   rejection, and after the acceptance writes its four-heading report as its last message, which
   is what the tool call returns to Gravit.
5. Gravit checks the report against the artifact (every number, every evidence id), journals the
   run with the artifact paths, and consults `role_reviewer` when the report claims more than the
   artifact holds. The channel page shows the run under "latest analysis" on its next load.

This is a research turn, not a cycle verdict: the cycle contract (`dsh/profile/cycle.md`) decides
`validated` / `retired` by pre-registered falsification terms, which no bed can decide here; the
two directories stay `idea` or `researching` and the journal says what each run measured.

Gravit may call the four tools itself (they are global); nothing in this spec gives it a reason
to call `submit_analysis` directly, and the role is the intended path. Bots never see the tools:
no bot's allow list names them (`face/src/bots.ts` `DEFAULT_ALLOW`), and the mask admits only what
an allow list names.

## 6. Tests and documentation to pin

Each new seam gets the three things the inventory records: a test, a documentation row, a line on
what breaks when upstream moves. The builder adds them in the same change as the code.

| Pin | What it establishes |
|---|---|
| `face/tests/lunhui-contract.test.ts` | the port of `test/analysis-contract.test.ts`: the eight invalid structures rejected (zero evidence, a WAIT carrying a CURRENT claim, an unknown evidence id, a symbol outside the universe, a forbidden trading word, an unsupported whole-market sentence, the byte budget, a context whose snapshot id no longer matches), the CURRENT-word rule under HISTORICAL basis, the schema example validating, `buildAnalysisContext` refusing a ninth symbol, a fifth index, a later-than-snapshot history |
| `face/tests/lunhui-market.test.ts` | the port of `test/market-provider.test.ts`, `test/market-calendar.test.ts` and the pure half of `test/market-service.test.ts` on fixture responses: GB18030 decoding, field order, unit conversion, the 2026 holidays, the session states, the quote assessment, no network |
| `face/tests/lunhui-server.test.ts` | offline and over the real protocol: the test spawns `server.mjs` with the face's own `@modelcontextprotocol/client` 2.0.0 over stdio, with `LUNHUI_STRATEGIES_ROOT` pointing at a fixture tree and `LUNHUI_FETCH_FIXTURES` pointing at recorded Tencent responses (the server reads fixtures instead of the network when the variable is non-empty; the row sets it to the empty string so an inherited value can never reach production, Ruling R21): the four tools listed with their schemas; a strategy outside the grammar, a missing `THESIS.md`, a symlinked directory, a bad run id and an unknown run each refused with their code; `freeze` creates `analysis/`, writes the three files with `wx`, refuses an existing run, returns the run id; `submit` before both reads refused; a rejection returned as `isError` with its category and counted in `metrics.json`; an accepted submit writes `analysis.json`, sets `submitted`, returns `accepted`; a second submit refused; a read after acceptance allowed; no `instructions` on initialize |
| `face/tests/lunhui-manifest.test.ts` | `manifest.json` parses, carries the ten keys, and its `tools` equal the server's registered names |
| `face/tests/boot.test.ts` | `mcp-lunhui` composes exactly once, below the operator layers, directly after the AKShare row, with `serverName: lunhui`, the face's Node as `command` and the strategies root in `env`; the profile can override its config or disable it (the three AKShare cases, mirrored) |
| `face/tests/smoke.test.ts` (`FACE_SMOKE=1`) | a real boot negotiates with the Node server (the first non-Python server in the tree) and the four `mcp__lunhui__*` tools are in the live registry; `/data/plugins.json` lists server `lunhui` with four tools and phase `active` |
| `face/tests/channels.test.ts` | `readChannelBody` on a fixture directory: two runs sorted newest first, `latestRun` from the newest accepted one, a frozen-only run listed with `conclusion: null`, a broken `analysis.json` not blanking the other blocks, no `analysis/` at all yielding empty blocks |
| `face/tests/roles.test.ts`, `roles-smoke.test.ts` | the mirror carries `role-cn-analyst`; on a real boot the child's tools equal its allow list exactly (the three `mcp__lunhui__` names among them, under the stand-in names the smoke registers), its persona shadows Gravit's, `GRAVIT.md` reaches it |
| `face/tests/gravit-md.test.ts` | still ≤ 4,500 bytes after D15 |
| `face/scripts/schema-sizes.ts` | a `mcp__lunhui__` group; the four tools' bytes recorded in `DEVELOPMENT.md` §4.3 beside the other groups |
| `python -m pytest` | unchanged and green: nothing here touches `alpaca_kit` or `tests/` |

Documentation rows: `DEVELOPMENT.md` §3.6 (the four tools under the project `mcp-lunhui` row,
cwd-free, writing under `analysis/`), §3.8 (the fourth role), §4.3 (the row in the composition,
the measured sizes), §4.4 (the channel overview's two new fields), §4.6 (`LUNHUI_STRATEGIES_ROOT`
is the row's, not an operator variable), §5.1–§5.2 (the runs section and its wire fields), §9 (a
residual: like the other MCP children, the server writes from outside any session's sandbox,
bounded to `<strategies>/<name>/analysis/` by its own anchoring), §10 (the bed and the Discover
install as forward items); `face/README.md` (a "Lunhui analysis" section: the row, the server,
the two outbound hosts of the child, how to disable, the plugin-panel line to look for, the role,
the drill); `docs/research/2026-10-15-dsh-seams-inventory.md` (B: the row source; C: the role; G:
the second project MCP row and the first Node server, the `isError` mapping the retry loop stands
on; H: the skill); `CLAUDE.md` (the `roles/` row names four roles; `face/plugins/lunhui/` in the
`face/` row); `ROADMAP.md` built log when it lands; `GRAVIT.md` (D15); `Gravit-Design.md` §1
(D16).

## 7. Left to the builder

1. **The first Node MCP server in the tree.** The two Python servers negotiate with dsh's 2.0
   client (seam G12); a `@modelcontextprotocol/server` 2.0.0 server with the `node` stdio
   transport is the same protocol from the same SDK family, and the smoke proves it on a real
   boot. The server test runs the same negotiation offline with the face's client package.
2. **The SDK's tool API.** Register the four tools with the 2.0 server API (tool name,
   description, JSON-schema input, a handler returning `content` and `isError`); keep the
   descriptions Chinese and the schemas minimal (three strings, one string array).
3. **Fixture injection.** `LUNHUI_FETCH_FIXTURES` names a directory of recorded responses the
   server reads in place of `fetch`; the row sets it to the empty string, which the server treats
   as unset, so an inherited value can never reach production (Ruling R21), and the server refuses
   a non-empty value naming a path outside the repository.
4. **Per-run state after a restart.** Per-run state lives in a `Map` in the server; after a
   server restart (every face boot, and dsh's reconnect) `metrics.json` is the record, and a run
   that was frozen but not submitted may be submitted after both reads again. Pick the simplest
   consistent rule and test it.
5. **The calendar.** The source's calendar is 2026-only by design (the SSE notices); outside a
   covered year no quote is ever CURRENT: the session's `status` is `unknown` with its reason,
   and `calendarCoverage` keeps naming the covered year, `2026` (corrected at build time,
   2026-10-20: this item first said the context reads `calendarCoverage: unknown`; the source's
   code, ported verbatim, keeps the year). Keep that and record it as a residual (§8); extending
   it is a one-table change with its notice as the source.
6. **Fetch implementation.** Node's global `fetch` with `AbortSignal.timeout`, a streamed byte
   cap, GB18030 via `TextDecoder` (Node 22 ships full ICU); the source's parsers are the
   reference.
7. **The schema example and the hints** are ported verbatim; only names change where a source
   name was `LUNHUI_*`.
8. **The run-id sort and the runs card's limits.** Newest first by id; cap the listing at the
   newest 50 runs and say so in the page when more exist.
9. **The drill.** A manual run on the real face (keys, a real model): freeze four indices and
   four stocks in a Lunhui channel, delegate, read the artifact, reload the channel page and see
   the card; record it in `face/README.md` beside the role drill with the session id. The
   automated tests never call a model and never reach the network.
10. **The order of landing.** Knowledge (D11, D12) may land first and alone; the server, the row,
    the manifest, the role and the skill land together with their tests; the runs card may land
    with them or just after; the documentation rows land with each.

## 8. Charter and residuals

- §7.3 "No bespoke harness": an MCP server behind a `dsh-mcp-client` row is the same class as
  the AKShare and alpaca-kit rows; nothing touches the loop.
- P3: point-in-time honesty in code — the freeze stamps `receivedAt` and `asOf`, the validator
  binds every claim to a frozen evidence id and refuses CURRENT wording over HISTORICAL evidence.
  These runs are not backtest evidence and the AKShare rule is unchanged.
- P2: the fact rules are mechanics; the doctrine is a research input (D10).
- §1 MARKET: the one sentence of D16, for the operator to veto.
- New residual for `DEVELOPMENT.md` §9: the server writes from the MCP child, outside any
  session sandbox, bounded by its own anchoring and the `wx` flag; the same class as the MCP
  child's cache writes (R5).
- New residual: the calendar covers 2026 only; in any other year the freeze still works but no
  quote is CURRENT (§7 item 5).
- New residual: a server that fails to start leaves the row ACTIVE with no tools (seam G4); the
  plugin panel line and the smoke are the checks.
- `analysis/<run>/` directories are git-tracked research artifacts like `backtests/`; a run is
  small (≤ 256 KiB of JSON); the operator may prune old runs.
- A doc debt noticed on the way: the seams inventory's H1 row still spells `style-kairos`.

## 9. Open items

Nothing blocks this spec: the builder check's two operator questions were answered on
2026-10-19 (D10, D11), and the MCP form (D3–D5, D17–D19) is the operator's.

**For later specs:**

- The Discover install flow: `shop.install` as a runtime mount of the `mcp-lunhui` row (the way
  bots are declared after boot, `ctx.plugin` + a disposer) with its state under `$DSH_HOME/face/`,
  or the dsh-native `profileContext` + plugin-manager + hmr route the face deliberately does not
  mount (PLAN D1, seam B8, `DEVELOPMENT.md` §10 item 12). The author's lean: the runtime mount,
  never `profileContext`.
- Whether S01/S02 are to become backtestable: an A-share point-in-time bed captured day by day
  (the usable window begins the day capture begins; the source's own minimum observation span
  is 60 trading days), its package shape beside `alpaca_kit` sharing the firewall, its MCP row
  under the operator's patch, the charter §1 wording. The operator's decision.
- Whether the per-run freezes should also feed that bed (they carry `receivedAt` and are
  content-hashed; a harvester could read them).
- A child step budget on `agent/pre-step`, if a real run shows the need.
- The youzi snapshot code in the sibling repository's main branch: a format reference only, by
  the operator's earlier lean; nothing here depends on it.
