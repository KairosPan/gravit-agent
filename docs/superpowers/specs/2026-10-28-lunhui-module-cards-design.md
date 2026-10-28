# Lunhui module cards — each module a Discover card, run alone through Gravit

**Date:** 2026-10-28 · **Status:** design, awaiting the operator's approval · **Supersedes:** nothing;
extends `2026-10-25-lunhui-modules-design.md` (its §9 open item "a manifest or card for in-process
rows in Discover") · **Canvas:** the brainstorm's boards, "Lunhui module cards",
https://claude.ai/artifact/GVV7rYe84E48rkkW77yJcL (private; rows 1–4 the shelf, the page, the sheet
and the trigger flow; rows 6–11 the six cards; row 5 a rejected re-cut, kept as the alternative).

## 0. What changed, and why a new document

The 10-25 spec gave the Lunhui read its shape: eleven dsh rows, five analysis modules cut by the
manuscript's chapters (E2), a reviewer, one run protocol (`lunhui:run`) that Gravit follows end to
end, and a runs card on the channel page. Three live drills (10-26, 10-27, 10-28) ran it as designed.
Two things stayed open. The modules are reachable only through the chain — to re-run Theme after the
boards source comes back, the operator asks Gravit for a whole new round — and Discover, the page
that lists what Gravit runs, shows the MCP servers and nothing of the Lunhui rows (the 10-25 spec's
non-goal "no manifest for Lunhui" and its §9 open item).

On 2026-10-28 the operator asked for the missing piece: **每个分析模块在 Discover 里各自一张卡、能单独
触发，不只是 Gravit 串着跑**. The brainstorm first drifted into re-cutting the modules by the
manuscript's analysis steps; the operator rewound it: **先从轮回.docx的文档出发，按切分的五个模块，一张
一张地建卡** — the cards are the five modules as the 10-25 spec cut them, plus the reviewer's, each
designed from the manuscript's chapters it was cut from, one per round with the operator's nod. The
six cards were nodded through on the canvas (rows 6–11). This document is what they add up to.

What this document decides is how a module is reached, shown and triggered on its own. What it does
not touch: the rows, their contracts, fields, artifacts and freezes — the operator's Q7 = A (§4 F4) —
so the drilled behaviour of the chain stays exactly as it is. One role gains one sentence: the
market analyst, which today writes its three modules in one call, learns to write the one a brief
names (F6, decided after the builder check); an unnamed brief — the chain's — still writes all three.

## 1. Intent

Any one Lunhui module can be reached from Discover: a Research shelf with one card per module, each
card showing the module's latest headline and a Run key. Run opens a small sheet (where, on which run,
what it cites) and sends Gravit **one message** in that channel asking for that module alone; Gravit
freezes if a new run is asked for and calls the module's role once; the artifact lands where the
chain's would, and the card, its page and the channel's runs card update. The operator gets a
re-runnable, inspectable unit per module; Gravit keeps every discipline the chain has — only Gravit
freezes, only roles submit, a run seals at its first read, the reviewer comes before the mode.

## 2. Goals, non-goals, anti-goals

**Goals**

- G1 A **Research** shelf in Discover, between Data and Bots, with six cards in the chain's order:
  Environment, Sentiment, Theme, Leader, Mode, Counterevidence (§5.1).
- G2 Each card carries **today's headline** of its module from the channel's latest run, the
  module's role and channel, and a **Run** key; a card opens the module's own page (§5.1, §5.3).
- G3 **Run** = a sheet → one message → a new conversation in the chosen channel titled
  `<Module> · <date>` → Gravit runs that module alone through its role (road B, §5.4–§5.6).
- G4 A short protocol section, `lunhui:module`, teaching Gravit the single-module request beside the
  untouched chain protocol (§5.6).
- G5 The card's three states — idle, running, landed — visible without a reload (§5.7).
- G6 A **candidates table**: what the manuscript asks of each module that the tree does not read
  today, recorded per card for a later contract round (§8).
- G7 **One sentence in the market analyst's role**, so a brief that names one of its three modules
  gets that module alone (§5.9); the chain's brief, which names none, gets all three as today.

**Non-goals**

- N1 No change to any row, contract, schema, field, artifact, freeze or budget (operator, Q7 = A); of
  the roles, only the market analyst's one sentence (F6). A document-versus-contract gap becomes a
  line in §8, never a code change here.
- N2 No new data source and no source replacement: the boards source's failures stay what they are
  (the iFinD / Tushare line is its own arc); the Theme card shows the truth and offers the retry.
- N3 The face starts no role itself (road A, out by Q1): every module run is Gravit's, in a
  conversation the operator can read.
- N4 No second artifact of a module in one run: `ALREADY_SUBMITTED` stands; the sheet greys the run
  that already holds the artifact (G1 in §4).
- N5 No re-review: one counterevidence per run (the contract's rule); the sheet says what a review
  would cover and names the module cards not yet run.
- N6 No scheduling, no always-on trigger (the desk arc), no install, no shop, no manifest registry.
- N7 No Gate: a module run writes nothing at the Account; Gate 2 is not involved.

**Anti-goals** — a failure even if it works

- A1 A card that runs a module around the chain's discipline: a freeze after a read, a submit by
  Gravit, a mode without its reviewer.
- A2 A card that quietly shows an older run's headline as today's.
- A3 The face reading evidence files (gitignored, megabytes) or inferring a state the run files do
  not say: the page reads `run.json` and the artifacts, bounded, as the runs card does.
- A4 The manuscript's text in the tree: the cards and pages cite paragraph ids only (graft spec D11).

## 3. Constraints the design lives under

- **A run seals at its first context read** (10-25 A4). A new run opened from any market card
  therefore freezes the whole market set — index, limit-up, boards, quotes optional — before the
  requested module runs, or the other cards cannot run on that run later. The sheet says so; the
  protocol section repeats it.
- **Submit tools accept role children only** (`NOT_A_ROLE`, A23); freezes accept Gravit only
  (`NOT_GRAVIT`). Road B is the only road that keeps both.
- **One artifact per module per run** (`ALREADY_SUBMITTED`); the mode needs the run's accepted
  leader and an accepted counterevidence of the same market run (A6, A22); the reviewer needs an
  accepted leader in a strategy run, at least one accepted market artifact in a `cn-market` run.
- **The strategy run's only freeze is quotes** (A27); it is opened by `lunhui_freeze_quotes`, so a
  Leader "new run" is that call, and Mode and Counterevidence have no new run of their own.
- **Protocols**: a file under `dsh/profile/`, trimmed, ≤ 3,000 raw bytes (`PROTOCOL_MAX_BYTES`,
  `face/src/protocols.ts`), no `{{`, a section name matching `^[a-z]+:[a-z-]+$`, gated on a probe
  tool so it reaches Gravit and a fork child only (`face/plugins/gravit.js`); the rendered preset
  mirror `bots/gravit/agent.cordis.yml` embeds the protocol texts, so `cd face && npm run render:roles`
  follows any protocol edit. `lunhui-run.md` is at 2,999 of 3,000 bytes and is not edited.
- **The client**: string renderers over a store, pure views beside impure host layers, tests on a
  fake DOM (`face/tests/client/`), no cache headers (hard reload after an edit); product copy in
  English, the message to Gravit in the protocols' language (Chinese).
- **`/data` routes** are same-origin fenced (`isTrustedDataRequest`), read JSON with bounds
  (`readBoundedJson`: `run.json` 8 KiB, an artifact 24 KiB, `O_NOFOLLOW`), and never reach an
  evidence file.
- **Channel = directory**: a tool's `strategy` argument is the channel's directory name; the client
  addresses a channel by its `workspaceId` (`/data/channels.json`), and `session/create
  {workspaceId}` opens a conversation in it (`js/host/actions.js` `newConversation`).
- **Cost**: one module run is one Gravit round on deepseek-v4-pro plus one role on deepseek-flash,
  a few minutes; the operator can start as many as they like — the only brake is their own. A press
  is one module: a refusal the run cannot cure (a stale cited run, say) is reported, not cured by a
  second read inside the same conversation (G21).
- **The drill is keyed**: a face that must answer runs with the env in the operator's terminal
  (`face/README.md` "Run"); the suites run offline.

## 4. Decisions, as decided

The operator's are F1–F5; G1–G20 are the author's, each overturnable at review without redesign.

| # | Decision | Why |
|---|---|---|
| F1 | **One card per module of the 10-25 cut, plus the reviewer's**: Environment 环境与大周期 (一, 八), Sentiment 情绪周期 (二 + P0020–P0056), Theme 题材与轮动 (the 题材 pages, 六), Leader 龙头与个股地位 (四), Mode 模式选择与预期 (三's 模式选择 column, 七), Counterevidence 反证 (the ten rulings). **The cards do not re-cut the modules** | operator, 2026-10-28 ("按切分的五个模块，一张一张地建卡", rewinding a re-cut by analysis steps) |
| F2 | **Road B**: Run sends one message to the channel; Gravit runs that module through its role. Road A — the face dispatching a role itself — is out | operator, 2026-10-28 (Q1): Gravit stays the one who freezes and dispatches; the operator reads it in a conversation |
| F3 | **One card each for Leader, Mode and Counterevidence**; the sheet's Where picks the strategy; Counterevidence's Where lists `cn-market` too; a strategy card's chip names the channel of its newest run | operator, 2026-10-28 (Q5) |
| F4 | **Cards only, this round**: contracts, fields, artifacts, freezes and roles untouched; the manuscript's extras recorded as candidates (§8) for a later contract round | operator, 2026-10-28 (Q7 = A): ship Discover and one protocol section fast; review contract changes card by card afterwards |
| F5 | **The six cards as drawn and nodded** (canvas rows 6–11; Appendix A): their reads by paragraph id, their headlines, their sheets — New run on the three market cards and on Leader, none on Mode and Counterevidence — and their chip rules | operator, 2026-10-28 (Q8–Q12) |
| F6 | **The market analyst's role takes a one-module brief**: a task description that names environment, sentiment or theme writes that module alone; one that names none writes the three in order, as today. **Partial market runs are accepted**: a new run opened from one market card holds one artifact until the other cards run on it; the sheet warns where that matters (the sibling cards' `not run`, a strategy citing a run without sentiment or theme) | operator, 2026-10-28 (the builder check's question): without it "run Theme alone" would write three artifacts on a new run and trip `ALREADY_SUBMITTED` twice on an existing one; the stock analyst already takes a per-module brief (leader or mode), the reviewer writes one artifact |
| G1 | **A run that already holds the module's artifact is greyed** in the sheet, New run preselected where a card has one; no loosening of `ALREADY_SUBMITTED` | Q3; the contract's one-per-run is what makes a run's artifacts one snapshot |
| G2 | **The shelf is named Research**, sits after Data and before Bots, lays its six cards in a 2 × 3 grid without horizontal scroll; its subtitle "Lunhui · 6 modules" | Q4; it is neither data nor a bot: what Gravit's research consists of |
| G3 | **A new market run freezes the whole set first** — index, limit-up, boards, quotes optional — then the one module | the seal at first read (§3); the sheet and the protocol section both say it |
| G4 | **The protocol section is a second file**, `dsh/profile/lunhui-module.md`, mounted as `lunhui:module`, probed on `lunhui_read_run` like the chain's, **at most 1,500 bytes** (a test pins it under the loader's 3,000); `lunhui-run.md` unchanged | one byte of headroom in the chain file; two short sections read better than one long one; the same probe keeps both out of every child's prompt |
| G5 | **The message is Chinese, from a fixed template per module** (Appendix B), the slots filled from the sheet; the operator's Note is appended verbatim | Gravit reads Chinese protocols; a template keeps the request unambiguous for the section to act on |
| G6 | **One conversation per Run**, created with the client's existing `newConversation` — `session/create {workspaceId}`, `session/rename` to `<Module> · <date>`, then the prompt — never the composer | the chain's New round already works this way; the sheet's Run sends directly (B-details on the canvas) |
| G7 | **The chip is the channel's latest run, never an older one**: a headline when the module's artifact is there, `not evaluable · <sources>` when it is `NOT_EVALUABLE`, `not run` when the latest run lacks it, `no run yet` when the channel has none; a strategy card reads the newest run across the strategies | anti-goal A2; the page's runs table carries history |
| G8 | **One read-only listing, `GET /data/modules.json`**: every channel with its kind, `workspaceId` and recent runs, each run's artifacts by module with status, `missing_sources` and headline; plus `mounted` (whether the Lunhui rows are up). The client derives the cards, the sheet's options and the page from it with a pure view | one route, one bounded read, one place to test; the channel overview keeps its own shape |
| G9 | **The module page is `#/module/<name>`**, a screen like a plugin's page: head (name, 副题, role, route, channel, today's chip, Run), Reads / Writes / Runs on, the runs table across its channels, the latest artifact's compact JSON in a details, and the card's legend block where it has one (Appendix A) | the canvas's Module-Page board; the legends are reading aids, static client copy with paragraph ids only |
| G10 | **Running is the client's knowledge**: the Run it sent is remembered per module (in memory, mirrored in `localStorage` as a convenience) and shown as `Running · <title> ›` while that session is running; the listing is re-read when the session's turn ends and the chip settles on what the files say | the face has no event for "an artifact landed"; the session's turn end is the signal it does have |
| G11 | **The sheet's Stocks field takes 1–4 main-board codes** (`sh60xxxx`, `sz00xxxx`), checked for shape and uniqueness only; membership in the cited run's pools and lists is the contract's rule (`REFERENCE`), stated on the sheet, not enforced by the face | the face does not read evidence files (A3) |
| G12 | **Cites offers the two newest sealed `cn-market` runs**, newest preselected, each labelled with its session date and its theme state; staleness (A5's same-day rule) is left to the tool's `STALE_MARKET_RUN` | the client has no trading calendar; the tool has |
| G13 | **Where lists every channel the module accepts**: `cn-market` alone for the three market cards; every strategy channel but `cn-market` (the fixture included) for Leader and Mode; `cn-market` first, then the strategies, for Counterevidence; the newest relevant run's channel preselected | the module tools' `WRONG_CHANNEL` is the rule; the sheet mirrors it |
| G14 | **"Latest run" rather than "Today's run"**: the On option names the channel's newest run with its session date; the client does not decide what today is | honesty over the canvas's word; the Beijing session and the operator's New York day differ |
| G15 | **Mode and Counterevidence have no New run**; their Latest run is enabled only when its prerequisites hold (Mode: accepted leader and counterevidence, no mode; Counterevidence: an accepted leader in a strategy run, at least one accepted market artifact in a `cn-market` run, no review), the reason shown when greyed; the Counterevidence sheet lists what the review would cover and warns when `mode.json` already exists | A22, A6; one review per run |
| G16 | **The Theme sheet carries a source line** — "boards missing in the last N runs" — read from the runs' `missing_sources` | the card's regular state so far; the runs already say it |
| G17 | **The shelf exists when nothing has run** (every card `no run yet`) and **when the rows are down** (`mounted: false`: the cards drawn dim, Run disabled, one line "Lunhui rows not mounted") | Discover is an inventory, not a status page; the rows' absence is still a fact to show |
| G18 | **The three strategy cards share one run a day**: Leader's New run opens it, Counterevidence runs second on it, Mode closes it; the sheets steer that way, the tools enforce it | A22; the drill-3 deviation (reviewer and mode in parallel) is answered by the section's order lines, not by a chain edit |
| G19 | **Search covers the Research cards** as it covers the other shelves; the shelf's "See all" opens the same six in the grid view | one Discover |
| G20 | **Only the face's client gets the cards**; `lunhui_read_run`, the runs card and `GRAVIT.md` do not change | the page is the operator's surface; Gravit's surface is the tools and the two sections |
| G21 | **A single-module request stops at a refusal it cannot cure without another run**: `STALE_MARKET_RUN`, `MISSING_EVIDENCE` on the cited run and `ALREADY_SUBMITTED` are reported in the thread and the message ends; the operator presses again with a fresh run (the market cards first) | one module per press (G5); the chain's cure — a whole new market read — would run three freezes, an analyst and a reviewer inside a "single-module" conversation, against the promise and the cost line of §3 |
| G22 | **The listing carries each run's frozen sources** (`run.json` `evidence[].source`) and the `market_run` of every artifact that has one (leader, counterevidence, mode) | the sheet says what a run holds and which market run binds it without the face reading an evidence file |
| G23 | **`lunhui:module` registers one order step after `lunhui:run`** | `plugins/gravit.js` gives every protocol the same order and dsh breaks ties by name; the chain reads first, its single-module variant after |
| G24 | **The repo root is not a channel of the listing** (`listChannelDirs`'s `isRoot` row is skipped); **an open run's `session` is null until it seals**, so its labels fall back to the date of `opened_at` | the root is no `strategy` argument; `runs.mjs` sets `session` at seal |

## 5. The design

### 5.1 The Research shelf

Discover (`face/client/js/render/discover.js`, `host/discover.js`, `host/discover-view.js`) gains a
fifth listing and a fifth shelf:

- `host/discover.js`: `SHELF_PATHS.modules = '/data/modules.json'`, `VALID.modules = d =>
  Array.isArray(d?.channels)`; the shelf joins `load()` like the others (a failed read shows the
  shelf's Retry; the other shelves are untouched).
- `host/discover-view.js`: `SHELVES` gains `{ id: 'research', title: 'Research', empty: 'No research
  modules' }` between `data` and `bots`; `SOURCE.research = 'modules'`; `itemsOf` gains
  `researchItems(listing)` — six items, always, in the order Environment · Sentiment · Theme ·
  Leader · Mode · Counterevidence, from a static module table (`host/modules-view.js` §5.2) joined
  with the listing; the search includes them.
- `render/discover.js`: the Research shelf renders a `grid` of six research cards rather than a
  `shelf-row` — the card variant `pcard research`: a `<div>` (not an `<a>`, since it holds a button)
  with the glyph, the name, the 副题 line (`环境与大周期 · index · liquidity · cycle anchor`), the meta
  line (role · channel), the kind label `MODULE`, a foot with the chip and a `<button data-action=
  "runModule" data-module="theme">Run</button>`; the name and glyph are an `<a href="#/module/
  theme">`. The shelf head carries the subtitle `Lunhui · 6 modules`; no "See all" link is needed
  for six, but the grid route `#/discover/research` works like the others (G19).

The chip (G7), computed in the pure view from the listing:

| State of the channel's latest run | Chip | Tone |
|---|---|---|
| holds the artifact, `OK` | the headline words, as the runs card's `chipText` joins them (`WEAK · STABLE`; `IGNITION · POSITIVE · NONE`; `2 candidates · FERMENT · ROTATING`; `<n> candidates · <first flag>` or `no candidate`; `S01 · card frozen` or `WAIT`; `<n> items`) | ok |
| holds the artifact, `NOT_EVALUABLE` | `not evaluable · <missing_sources joined>` | warn |
| sealed, no artifact of this module | `not run` | neutral |
| the channel has no run | `no run yet` | neutral |
| the client sent a Run and that session is running | `Running · <title> ›` (a link to the conversation), Run disabled | live |
| `mounted: false` | the card dim, `rows not mounted`, Run disabled | neutral |

A market card (Environment, Sentiment, Theme) reads `cn-market`'s latest run. A strategy card
(Leader, Mode) reads the newest run across every channel but `cn-market` and prefixes the chip with
that channel's name (`lunhui-s01-repair · no candidate`). Counterevidence reads the newest run across
all channels and prefixes it likewise (`lunhui-s01-repair · 5 items`); its page shows the newest of
each channel side by side.

The 副题 lines and glyphs are the canvas's (Appendix A). The static module table is the single
source of the six cards' names, 副题, role, channels, headline fields, tool names and legend copy;
it mirrors `face/plugins/lunhui/lib/modules.mjs` and `face/src/channels.ts` `MODULE_HEADLINES`, and a
test pins the three in step (§6).

### 5.2 The listing: `GET /data/modules.json`

A read-only route in `face/src/channels.ts` `registerChannelRoutes`, beside `/data/channels.json`,
same fence (`isTrustedDataRequest`), same reconcile for the `workspaceId` map:

```jsonc
{
  "ok": true,
  "mounted": true,                       // the loader row include:lunhui-runs is enabled and active
  "root": "/…/strategies",
  "channels": [
    {
      "channel": "cn-market", "workspaceId": "…", "kind": "market",
      "runs": [                           // newest first, at most 12 (MODULES_RUNS_CAP), run dirs only
        {
          "run": "20261028T020953Z-f3b89ce6", "session": "2026-10-28", "asOf": "2026-10-28T02:09:59.229Z",
          "openedAt": "…", "sealedAt": "…",                      // sealedAt null while open; session null until sealed
          "frozen": ["index", "limit-up"],                           // run.json evidence[].source, the freezes this run holds
          "artifacts": {
            "environment": { "status": "OK", "missingSources": [], "headline": { "index_state": "WEAK", "liquidity_state": "STABLE", "cycle_anchor": "…" } },
            "theme": { "status": "NOT_EVALUABLE", "missingSources": ["boards"], "headline": { "mainline_candidates": [], "theme_stage": "UNKNOWN", "rotation": "UNKNOWN" } },
            "mode": { "status": "OK", "missingSources": [], "headline": { "mode": "WAIT", "…": "…" }, "marketRun": "…" }   // marketRun on every artifact that carries market_run: leader, counterevidence, mode
          }
        }
      ],
      "runsOmitted": 0
    },
    { "channel": "lunhui-s01-repair", "workspaceId": "…", "kind": "strategy", "runs": [ … ], "runsOmitted": 0 },
    { "channel": "lunhui-s02-rotation", "workspaceId": "…", "kind": "strategy", "runs": [], "runsOmitted": 0 }
  ]
}
```

- Built from `readAnalysisRuns` (exported, given a cap) over `listChannelDirs(root)` minus its
  `isRoot` row (G24); `kind` is `market` for `cn-market`, `strategy` for every other channel;
  `_template` is not a channel. A channel with no `analysis/` directory has `runs: []`. A run's
  `frozen` is the `source` of each entry of `run.json`'s `evidence` (within the 8 KiB manifest
  already read); an open run has `sealedAt: null` and `session: null` (G24).
- Per artifact, the fields `readAnalysisRuns` already parses (`status`, `contract_version`, the
  headline by `MODULE_HEADLINES`) plus `missing_sources` (an array of strings, else `[]`) and
  `market_run` wherever the artifact carries it — leader, counterevidence, mode (G22); nothing else of the artifact leaves the server through this route — the
  page's "latest artifact" details read the channel overview's `latestRun`, which already carries the
  whole artifact (24 KiB bound), when the module's latest run is that channel's latest sealed run;
  otherwise the details say which run to open on the channel page.
- `mounted`: from `pluginListing`'s rows (`face/src/panels.ts`): the row `include:lunhui-runs`
  present, `enabled: true`, `phase: "active"`.
- Bounds: the same `readBoundedJson` caps as the runs card; 12 runs per channel; a channel whose
  directory vanished mid-read is skipped, never a 500. Failures answer `{ok:false}` with fixed text.

### 5.3 The card's page: `#/module/<name>`

`router.js` gains `case 'module'`; `app.js` `SCREENS` gains `module`; `render/modules.js` renders
it (`renderModule(state)`), with the plugin page's chrome (`main.disc.plugin-page`, the back link to
Discover, the `lastDiscover` behaviour of a plugin page). Unknown names render the plugin page's
"nothing here" line. Sections, top to bottom:

1. **Head**: glyph, name, `MODULE`, the meta line `CN market analyst · deepseek-flash · cn-market`,
   the chip (as on the card), the Run key.
2. **Reads / Writes / Runs on** — three small key-value boxes from the static table: the freezes and
   artifacts the module reads, the channel(s); the file, the headline fields, the directory
   `strategies/<channel>/analysis/<run>/`; the role, its route, the budget "10 calls per run · one
   artifact per run".
3. **Runs** — a table across the module's channels, newest first: session, channel (strategy cards),
   run id, status chip, headline words; from the listing.
4. **Latest artifact** — the compact JSON in a collapsed details when available (§5.2), else the
   line "open the channel page to read older runs".
5. **The card's legend**, where Appendix A gives one: Sentiment's stages-to-labels table, Leader's
   flags, Mode's preconditions, Counterevidence's rulings and kinds. Static copy, English, paragraph
   ids only.

### 5.4 Run: the sheet

`runModule` opens a centred sheet (scrim + panel, the canvas's Run-Sheet boards) over Discover or
the module page; `Escape` and Cancel close it; Run is disabled until the sheet is complete. State in
a `runSheet` slice (`reducers/modules.js`): `{ module, where, on, cites, stocks, note, error }`;
the pure view `host/modules-view.js` derives the options and the greying from the listing; the impure
`host/modules.js` opens, validates, sends (§5.5) and tracks (§5.7).

Fields per card (the operator's F5; the canvas rows 6–11):

| Field | Environment · Sentiment · Theme | Leader | Mode | Counterevidence |
|---|---|---|---|---|
| **Where** | `cn-market`, fixed | every strategy channel but `cn-market`; the newest leader run's preselected | likewise; the newest mode run's preselected | `cn-market` first, then every strategy channel; the newest review run's channel preselected |
| **On** | **Latest run** `<run id> · session <date> · frozen: index · limit-up · boards` (the session date, or the opened date while the run is open; greyed with "<module> already there" when it holds the artifact) · **New run** (preselected when the latest is greyed or absent): "Gravit freezes index · limit-up · boards, then the CN market analyst writes <Module> alone; Environment and Sentiment (the other two) stay `not run` on that run until run from their cards" | **Latest run** of the strategy (greyed when it holds `leader.json`) · **New run**: "Gravit freezes quotes for the stocks, which opens the run" | **Latest run** only, enabled when it holds an accepted leader and counterevidence and no mode; else greyed with the reason ("needs Leader, then Counterevidence, on this run" / "mode already registered on this run") | **Latest run** only: `cn-market` enabled with ≥ 1 accepted market artifact and no review, the line "reviews: environment · sentiment · theme" or "reviews: environment only — Sentiment and Theme have not run on this run"; a strategy enabled with an accepted leader and no review, a warning when `mode.json` exists |
| **Cites** | — | the two newest sealed `cn-market` runs, newest preselected, each `<run id> · session <date> · frozen: … · theme <state>`; the line "theme not evaluable: the pick comes from the limit-up pool alone" when so; a run missing a sentiment or theme artifact says "Mode and Counterevidence on this cite would be not evaluable" | read-only: the run's leader's `market_run` | `cn-market`: — · a strategy: read-only, the leader's `market_run` |
| **Stocks** | — | optional, 1–4 codes `sh60xxxx` / `sz00xxxx`, deduplicated; the hint "empty: Gravit picks from the cited run's mainline members and pool; a code outside them is REFERENCE at the contract" | — | — |
| **Source line** | Theme only: "boards missing in the last N runs" (G16) | — | — | — |
| **Note to Gravit** | optional free text, appended to the message | same | same | same |
| **Runs via / Writes** | "Gravit in cn-market → CN market analyst · <module>.json · a conversation `<Module> · <date>`" | "Gravit in <strategy> → CN stock analyst · leader.json · …" | "… → CN stock analyst · mode.json · …" | "… → CN reviewer · counterevidence.json · …" |

"Accepted" means the artifact file is present and parsed (the runs card's `accepted: true`);
"latest run" is the channel's newest run directory whether sealed or open (an open run with its
freezes done is a valid target; the role's read seals it).

### 5.5 Run: the message and the conversation

Run calls `actions.newConversation({ title, workspaceId, text })` — `session/create` in the chosen
channel, `session/rename` to the title, the message as the first prompt — exactly what New round
does for the chain, then navigates to the conversation (the messages screen) and marks the card
Running (§5.7). The title is `<Module> · <date>`: the run's session date for a Latest run, the
browser's date for a New run (builder's call to refine; the list's time stamps disambiguate).

The message is the module's template (Appendix B) with the slots filled: the module, the channel,
the run (id, or 开新运行), the cited market run, the stocks, the Note. Gravit acts on it by the
`lunhui:module` section (§5.6) and the tools; the role writes the artifact; Gravit reports the
module's headline in the thread, journals a `NOT_EVALUABLE` as the chain does, and stops — no other
module, no second attempt to change a result.

### 5.6 The protocol section: `lunhui:module`

A second protocol file, `dsh/profile/lunhui-module.md` (Chinese, ≤ 1,500 bytes, no `{{`), read by
`face/src/protocols.ts` `readProtocols` beside `lunhui-run.md` (`LUNHUI_MODULE_FILE`,
`LUNHUI_MODULE_SECTION = "lunhui:module"`, the same `PROTOCOL_MAX_BYTES` loader cap, a test pinning
the 1,500 budget), handed to `gravitRows` as a second entry of the `gravit` row's `protocols` and
registered by `plugins/gravit.js` as a section gated on the same probe, `lunhui_read_run`, one order
step after `lunhui:run` (G23) — in the prompt only when the Lunhui rows mounted, for Gravit and a
fork child, never a role, a bot or a spawn child. `npm run render:roles` regenerates the mirror `bots/gravit/agent.cordis.yml`, which
embeds both texts. `lunhui-run.md` is not edited.

The section says (Appendix C is the text plan 1 ships, 1,372 bytes):

- what a single-module message carries, and that everything else follows `lunhui:run`;
- a new market run freezes the whole set first (the seal at first read), then one role for the one
  module — the brief to `role_cn_market_analyst` names the module (F6), the role writes that one; an
  existing run gets no freeze;
- a Leader new run is `lunhui_freeze_quotes` with the message's codes, else Gravit's own 1–4 by the
  chain's step 2; then `role_cn_stock_analyst` for the leader alone;
- Counterevidence only on a run with an accepted leader (strategy) or at least one market artifact
  (`cn-market`); Mode only after both the leader and the counterevidence; **the reviewer before the
  mode, never in parallel** (the drill-3 deviation);
- one module per message — the role is told which; nothing else is filled in or re-run;
  `ALREADY_SUBMITTED`, `STALE_MARKET_RUN` and `MISSING_EVIDENCE` are reported as they are and the
  message ends — no new market run is opened to cure them (G21); the closing report covers this
  module's headline, its `NOT_EVALUABLE` sources and `delayed`.

### 5.7 States: idle, running, landed

- **Idle**: the chip from the listing (§5.1).
- **Running**: when Run sends, `host/modules.js` records `{ module, sessionId, title, startedAt }` in
  the `modules.running` slice and mirrors it to `localStorage` (`gravit-face.module-runs`, a
  per-browser convenience; read at boot, every read in try/catch). The chip shows `Running · <title>
  ›` and Run is disabled while the conversation list (`hostList`, `summary.running`) says that
  session is running. When it flips to not running — or the session is gone — the host re-reads
  `/data/modules.json` (once at the flip, once more 5 s later as a backstop for the file write) and
  drops the record; a record older than 60 minutes is dropped at the next read regardless.
- **Landed**: the chip settles on what the listing says. The page's runs table and the channel's
  runs card already read the same files, so they agree.

No new event, no poll beyond the backstop; a reload lands on the listing's truth.

### 5.8 What does not change

- The eleven rows, the six contracts, the freeze rows, the budgets, the stock analyst's and the
  reviewer's roles, `lunhui-run.md`, `GRAVIT.md`, the runs card's reader and view, `lunhui_read_run`.
- The chain: New round on a channel page and the operator's prompts in `face/README.md` work as
  before; a run opened by a card is a run like any other, and the chain can continue on it.
- The Account seat, Gate 2, the owner device: untouched; nothing here writes at the Account.

### 5.9 The market analyst's brief (F6)

`roles/cn-market-analyst/ROLE.md` keeps its order and its rules and gains one sentence after the
"按顺序做三个模块" paragraph, in the tree's own words:

> Gravit 的任务说明点名只写环境、情绪或题材中的某一个模块时，只做那一个模块，读它的上下文、提交它的工件，其余两个不读不写；
> 没有点名时照上面的顺序做三个。

`roles/cn-market-analyst/role.yml` `description` says the same in one clause ("…in that order, or
the one module the brief names…"), since the description is what Gravit's `gravit:roles` summary
shows. `cd face && npm run render:roles` regenerates `bots/gravit/agent.cordis.yml`. The allow list,
the model and the three tool pairs do not change; the chain's brief (`lunhui-run.md` step 2, "它提交
环境、情绪、题材三份工件") names no module and keeps writing three.

What follows from a one-module market run, and where the page says it: a new run opened from the
Theme card holds `theme.json` alone — the Environment and Sentiment cards read `not run` for
`cn-market`'s latest run until they are run on it (G7, two more presses); a strategy run that cites
such a run gets a Leader (which needs the theme artifact) but a Mode and a Counterevidence that are
`NOT_EVALUABLE` until the cited run also holds sentiment and theme (`required:
["leader","market:sentiment","market:theme"]` in both contracts) — the Leader sheet's Cites line says so
(§5.4), the Mode and Counterevidence sheets grey their Latest run with the reason when the cited
run lacks them.

## 6. Tests and documentation to pin

**Face suite (`node --test` via tsx, offline)**

- `tests/lunhui-modules-listing.test.ts`: over a fixture strategies root (a `cn-market` with three
  runs — OK, NOT_EVALUABLE theme, an open run — a strategy with a WAIT run, a strategy with none,
  a `_template`): the shape of §5.2, newest first, the 12-run cap and `runsOmitted`, `missingSources`,
  the mode's `marketRun`, `kind`, a vanished directory skipped, the fence (403 without the trusted
  header), `mounted` true/false from the loader rows.
- `tests/protocols.test.ts`: `readProtocols` returns the two sections in order, both on
  `lunhui_read_run`; `lunhui-module.md` ≤ 1,500 bytes, Chinese, no `{{`, names only tools the rows
  register and roles the library has; the section names agree with `plugins/gravit.js`.
- `tests/gravit-plugin.test.ts` / `tests/roles.test.ts`: two protocol sections register and are
  gated alike; the rendered mirror embeds both; `render:roles` is idempotent on it.
- `tests/channels.test.ts`: `readAnalysisRuns` with a cap.
- `tests/roles.test.ts` / `tests/roles-smoke.test.ts`: the market analyst's `ROLE.md` carries the
  one-module sentence and its `role.yml` description the clause; the rendered mirror is in step
  (`render:roles` idempotent); the library's three roles otherwise unchanged.

**Client suite (fake DOM)**

- `tests/client/modules-view.test.js`: the static table in step with `MODULE_HEADLINES` and
  `modules.mjs` (the test imports the listing's module names and headline fields from the server
  side as the runs-view test does); the six items and their order; every chip row of §5.1's table;
  the sheet's options and greying per card from a listing fixture (Mode's three reasons, the
  reviewer's "reviews:" line and mode warning, Theme's source line, Cites' two runs and theme line,
  Where per card, the preselections); Stocks validation (shape, count, duplicates); the message
  builder against Appendix B for each module and each On choice, the Note appended, Chinese words
  present.
- `tests/client/host-modules.test.js`: the listing read into the store; Run → the three Remote calls
  in order with the right `workspaceId`, title and text; the running record, the flip-to-idle re-read
  (twice) and the 60-minute expiry; `localStorage` failing without harm; `mounted: false` disables.
- `tests/client/discover-view.test.js`, `discover.test.js`: the fifth shelf and listing; the search.
- `tests/client/app-dom.test.js`: `#/module/theme` renders the page; the Run key opens the sheet;
  Escape closes it; `#/discover/research` grids the six.
- `tests/gravit-client-smoke.test.ts` (`FACE_SMOKE=1`): on a real boot the Research shelf lists six
  cards and `/data/modules.json` answers with `mounted: true`.

**Documents**

- `DEVELOPMENT.md`: §4.4 the route; §5.1 the new files; §5.3 the host layer; §5.4 the rendering;
  §7.3 the tests; §7.4 the card drill; §3.1 the second protocol file.
- `face/README.md`: "Discover" (the Research shelf), "Lunhui analysis" (the card drill: Run Theme
  alone on a new run; Run Leader with two codes; Mode greyed until the reviewer ran; the message and
  the thread to expect), "The profile" (two protocol files, `render:roles`).
- `CLAUDE.md`: the `face/` map line names the Research shelf in one clause; `dsh/` names the second
  profile file.
- `Gravit-Docs-and-Prompt-Loops.html`: the second section in the system-prompt order and in loop 2.
- `ROADMAP.md`: the built log.
- `docs/superpowers/specs/2026-10-25-lunhui-modules-design.md` §9: a one-line pointer to this document
  on the card item.

## 7. Left to the builder

- The sheet's and cards' CSS within `css/app.css`'s tokens; the glyphs from the icon set (the canvas
  names them: layers, pulse, flame, podium, switch, shield).
- The exact empty-state and greying sentences within §5.4's meaning; the conversation's date word.
- Whether `readAnalysisRuns` takes its cap as an option or a second function wraps it.
- The order of plans' internal task split; the fixture root for the listing test.
- The byte-exact wording of `lunhui-module.md` within Appendix C's rules and budget.

## 8. Candidates: what the manuscript asks that the tree does not read

Recorded per card for the next contract round (F4). None is built here; each names the module it
would land on, the paragraphs, and what it would take.

| Card | Candidate | Paragraphs | What it would take |
|---|---|---|---|
| Environment | a daily two-exchange turnover series, so the liquidity state can say EXPANDING / CONTRACTING | P1689–P1691 | a derived series from the index freeze's bars, if they carry amount; else a source |
| Environment | a large-versus-small spread, 沪深300 against 创业板指 | P1680, P1690–P1691, P1702 | a host-derived measure over bars already frozen |
| Environment | 深证成指 as the preferred read | P1681 | a hint line |
| Environment | mainline turnover | P1689 | boards (Theme's ground) |
| Environment | index divergence (MACD / WR / KDJ) | P1665–P1675 | closed by R14 (chart-pattern timing research_only): no field |
| Sentiment | the indicator table cited under H2 | P1297–P1329 | a citation change in the hypotheses |
| Sentiment | the previous sessions' pools as series — height, 炸板率, the money effect | P0038, P1305, P1317 | a freeze of the previous session's pools or a read across runs |
| Sentiment | the 昨日涨停 / 昨日连板 index series | P0039 | a source |
| Sentiment | the capacity share: stocks over 15亿 turnover ÷ all A | P1326–P1328 | a market-wide per-stock turnover source |
| Sentiment | the 你看到的 column's intraday signs | P0157–P0451 | minute-level data (design-only per the README) |
| Sentiment | the new-cycle day's resonance | P0046–P0047 | boards plus a turnover series |
| Sentiment | the sole rebound, the small cycle | P0048–P0054 | closed by R14 |
| Theme | a theme's history: the prior theme's height, days since start | P0077–P0080, P0119–P0122 | reads across runs |
| Theme | the rotation chart's nodes (open, midday, close) | P1358–P1360 | more than one snapshot a session |
| Theme | catalysts, news, announcements | P0099–P0134, P1404–P1412 | the announcements source (the 10-25 spec's first open item) |
| Theme | the five resonances | P1432 | a judgment with no source; stays a label |
| Theme | 龙虎榜 | P1368, P1373 | a source |
| Leader | minute bars, 分时, 竞价, 盘口 — the relay patterns | P0771–P1099 | a minute source; R02 / R04 / R05 stay research_only |
| Leader | seal funds through the day | P0719–P0726 | more than one snapshot |
| Leader | 龙虎榜 and seats | P0760–P0770, P1368 | a source |
| Leader | the volume-peak rule's long history | P0656 | bars beyond 60 days |
| Leader | an old leader's prior cycles | P1120–P1169, P1212 | long history |
| Leader | attribute and linkage relations | P0706, P0736, P1333–P1340 | members plus judgment; R07 |
| Mode | an announcements source (S02's catalyst) | — | the 10-25 spec's first open item |
| Mode | the minute-level confirmation | — | a minute source; by design unmet until then |
| Mode | the premium chain's intraday items | P1613–P1616, P1637–P1643 | intraday data |
| Mode | 龙虎榜 | P1619 | a source |
| Counterevidence | a second review on a run after a late artifact | — | a contract change (one review per run) |
| Counterevidence | a wider digest for the reviewer | — | the 30 KiB cap, A24 |
| Counterevidence | the reviewer on another route than the analysts | — | the 10-25 spec's §9 open item |

## 9. Charter and residuals

- The write map holds: `strategies/<channel>/analysis/<run>/` is written by the rows alone; the
  face adds one read route and no write.
- Gravit stays the principal: every module run is Gravit's conversation, in the operator's sight; no
  role is dispatched by the face (F2).
- The public-repo rule holds: the cards, pages and this document cite the manuscript by paragraph id
  (graft spec D11); the legends are the design's own readings and say so.
- Residual: a card is a cheap way to spend a Gravit round; nothing but the operator's judgment limits
  how many; the conversation per run keeps each visible.
- Residual: the Running state is the client's memory; another browser sees the card idle until the
  artifact lands — accepted (one operator).
- Residual: a Theme retry on a day the boards source is down costs a full market freeze each time
  (G3); the source line on the sheet says how often it failed.
- Residual (F6): a market run can be partial — one artifact, then more as the cards are pressed —
  so "the latest `cn-market` run" no longer implies three artifacts; every reader of a market run
  (the sheet's Cites, the runs card, the strategy tools) already reads the artifacts present and
  says what is missing.

## 10. Open items

- Q3's other half: whether a run should ever accept a replacement artifact (a contract change);
  left closed here.
- Whether the always-on desk opens the `cn-market` run each session, with the cards as the manual
  path (charter P5; the desk arc).
- The reviewer's route and digest (§8), and the announcements source — the 10-25 spec's items, still
  open.
- The 7-step re-cut (canvas row 5) is recorded as rejected; if the modules are ever re-cut, the cards
  follow the modules, not the other way round.

## 11. Order of plans

1. **Backend first**: the listing route (§5.2) with `readAnalysisRuns` exported and capped; the
   second protocol file, `readProtocols`; the market analyst's sentence (§5.9); the mirror; the
   tests (§6, face suite). Nothing visible changes; the chain keeps working.
2. **The shelf and the page**: the fifth listing, the six cards, the chip rules, `#/module/<name>`,
   the legends, the client tests; Run opens nothing yet (a disabled key) — the inventory ships.
3. **Run**: the sheet per card, the message templates, `newConversation`, the running state, the
   docs and the card drill (§6).

A live drill closes plan 3: Run Theme alone on a new run in `cn-market` (boards failing or not) —
exactly one artifact lands in the new run and the Environment and Sentiment chips read `not run`;
then Environment and Sentiment on that run from their cards; Run Leader with two codes on
`lunhui-s01-repair` citing it, then Counterevidence and Mode on that run from their cards; the
conversations, the artifacts and the chips checked against each other; recorded in
`face/README.md` and `DEVELOPMENT.md` §7.4.

## 12. Build notes, plan 1 (2026-10-28)

Plan 1 (backend) built on `claude/lunhui-module-cards-plan-1-b5dbd0` over `e32a4fd`: `6534f19`
(run rows' opened and sealed times, `frozen`, `missingSources`, `marketRun`; `readAnalysisRuns`
exported with a cap), `80ad9a1` (`GET /data/modules.json`), `96354b1` (a non-directory
`analysis/` lists as unreadable), `c6d447d` (the `lunhui:module` section), `ca8de04` (the market
analyst's sentence). Measured: `dsh/profile/lunhui-module.md` 1,372 bytes (budget 1,500),
`roles/cn-market-analyst/ROLE.md` 1,675 bytes (cap 2,000). The face suite 1667 tests, 1644 pass
and 23 skipped, typecheck clean; the four Lunhui, roles and instructions smokes 7/7 under
`FACE_SMOKE=1`.

| Clause | The text | What the tree does | Why |
|---|---|---|---|
| §7 | the cap "as an option or a second function" | an option: `readAnalysisRuns(dir, { cap })` | one reader; the runs card calls it without one |
| §5.2 | `missing_sources` "an array of strings, else `[]`" | all or nothing: an array mixing any non-string reads as `[]` | a card never shows a partial list the artifact did not state whole |
| §5.2 | no `analysis/` has `runs: []` | an `analysis/` that is a file or a link throws `ENOTDIR`, so the listing marks the channel `unreadable`; the runs card's overview still swallows it and shows no runs | a misplaced `analysis/` is not "no runs yet" |
| §5.2 | `mounted` from `pluginListing` | `main.ts` reads the loader as `boot.ts` does, `ctx.get("loader")` | the loader is the one source of the rows' state |
| §6 | the protocol tests | `tests/boot.test.ts`'s fixture also writes `lunhui-module.md` | `readProtocols` reads both entries at boot |
| §5.9 | the sentence "after the 按顺序做三个模块 paragraph" | placed after that whole paragraph, which ends 后面的模块不再做 | the plan quoted the paragraph's ending wrong; the placement is its intent |
| Appendix C | the protocol text | retitled "the shipped text", mirroring the file byte for byte | §7 left the wording to the builder |

## Appendix A — the six cards

Each card as nodded on the canvas (rows 6–11): what the shelf shows, what the page explains, and
where the module reads in the manuscript. Paragraph ids only; the legends are the design's readings.

### A.1 Environment · 环境与大周期

- **Shelf**: glyph layers; 副题 `环境与大周期 · index · liquidity · cycle anchor`; meta `CN market analyst ·
  cn-market`; chip `index_state · liquidity_state` (today `WEAK · STABLE`).
- **Reads**: Part 一 大周期 P0019–P0074, the anchoring half — P0061–P0074: sentiment anchored on the
  index and the prior high board P0063–P0065, the phase vocabulary P0027–P0034, a new cycle's four
  stages P0069–P0072, index and cycle kept apart P0073; the evidence half P0020–P0056 is Sentiment's
  (its hypothesis carries it). Part 八 P1651–P1708 entirely: index structure P1652–P1662, turning
  points P1665–P1675, the rules of thumb P1677–P1686 (the index as the systemic-risk gate P1682,
  深证成指 P1681, big styles draining small caps P1680), the liquidity cycle P1689–P1691, the ecology
  cycle P1693–P1703, 次新 and 超跌 P1704–P1708.
- **Says**: `index_state`, `liquidity_state`, `cycle_anchor` (≤ 120 characters), each state on a claim
  of its own kind of evidence; never merged into a score.
- **Evidence**: the index freeze — four indices' quotes and 120-day bars, two-exchange turnover (one
  intraday reading), advance / decline and limit counts; quotes optional. Gaps: §8.
- **Page legend**: none.

### A.2 Sentiment · 情绪周期

- **Shelf**: glyph pulse; 副题 `情绪周期 · state · money effect · 冰点`; meta `CN market analyst · cn-market`;
  chip `state · money_effect · freeze_type` (today `IGNITION · POSITIVE · NONE`); an UNKNOWN state's
  `conflict` shows on the page.
- **Reads**: Part 二 P0156–P0163 and the stage table P0157–P0451 by its 阶段 and 你看到的 columns (the
  模式选择 column P0159 is Mode's; 备注 is background); the evidence half of 一, P0020–P0056; by
  substance the indicator table P1297–P1329 (a candidate, §8).
- **Says**: `state` (UNKNOWN · CHAOS · IGNITION · EXPANSION · CLIMAX · RETREAT · REPAIR, two limit-up
  ids and one index id across its claims), `money_effect`, `freeze_type`, `conflict` when UNKNOWN.
- **Needs no other artifact**: with the limit-up and index freezes in a run it runs first, last or
  alone.
- **Page legend** (the design's mapping, not the text's; labels revisable, any state may move to
  UNKNOWN or RETREAT): CHAOS ← 混沌期 / 情绪冰点 P0161, the retreat's late leg P0372 · IGNITION ← 修复启动
  P0165, 拐点 P0179, 情绪回暖 P0185, 题材启动日 P0191 · EXPANSION ← 题材启动次日 P0202, 题材发酵 P0208, 主升
  P0198, P0213 · CLIMAX ← 加速高潮 P0253, P0337–P0352 · RETREAT ← 分化弱分歧 P0243, 大分歧 P0258,
  周期转变信号 P0291, 退潮期 P0372, 方向切换 P0382 · REPAIR ← 修复 P0268, P0294, 转点 P0283, 超跌反抽 P0391 ·
  UNKNOWN ← the measures disagree.

### A.3 Theme · 题材与轮动

- **Shelf**: glyph flame; 副题 `题材与轮动 · mainline · stage · rotation`; meta `CN market analyst ·
  cn-market`; chip `<n> candidates · theme_stage · rotation`, or `not evaluable · boards` — its
  regular state in all three drills.
- **Reads**: the 题材 pages P0075–P0153 (time and space P0076–P0080, four ways a new theme switches in
  P0082–P0094, where a theme starts P0096–P0097, catalysts P0099–P0110, several themes and rotation
  P0112–P0117, new cycle against transition P0119–P0122, chaos-period themes P0124–P0125, news
  P0127–P0134, the rule of 势 P0146–P0150); Part 六 P1345–P1464 (board rotation and the danger signs
  P1345–P1348, internal rotation P1352–P1354, the rotation chart P1356–P1362, picking inside a theme
  P1363–P1374, 挖掘 P1376–P1401, theme discovery and the five resonances P1404–P1433; the arbitrage
  pages P1435–P1464 are stock-level, R07 / R08 / R10, Leader's and Mode's ground).
- **Says**: `mainline_candidates` (0–5, each on a frozen board with its members, the name as frozen),
  `theme_stage` (START · FERMENT · DIVERGE · CLIMAX · FADE · CHAOS · UNKNOWN), `rotation` (NONE ·
  HIGH_LOW_SWITCH · NEW_DIRECTION · ROTATING · UNKNOWN).
- **Sheet**: the source line (G16); Latest run greys once any `theme.json` exists; New run is the
  retry. Downstream: a not-evaluable theme leaves Leader's pick to the limit-up pool alone.
- **Page legend**: none.

### A.4 Leader · 龙头与个股地位

- **Shelf**: glyph podium; 副题 `龙头与个股地位 · candidates · 顺位 · pattern flags`; meta `CN stock
  analyst · a strategy`; chip `<strategy> · <n> candidates · <first flag>` or `<strategy> · no
  candidate` (today `lunhui-s01-repair · no candidate`).
- **Reads**: Part 四 P0654–P1340 — the leader and its derived patterns P0654–P0770 (P0655–P0658,
  P0659, P0663, P0665–P0668, P0669–P0677, P0678–P0683, P0684–P0693, P0694, P0698, P0706, P0712,
  P0719–P0726, P0764–P0770); the relay patterns P0771–P1169 as vocabulary for the flags only (R02–R06
  research_only); 补涨 P1172–P1263 (R07 / R10); P1275–P1277 (leading in time is not causation);
  P1333–P1340; the indicator table inside this range is Sentiment's by substance.
- **Says**: `leader_candidates` (0–5 × symbol, frozen name, rank 1…n, board | null, evidence ids;
  龙头 only as 龙头候选), `top_pattern_flags` ⊂ ACCELERATING · DIVERGENCE · BROKEN_STREAK ·
  HIGH_POSITION · FIRST_BOARD · NONE; the envelope carries `market_run`.
- **Sheet**: Where every strategy but `cn-market`; New run = the quotes freeze that opens the
  strategy run; Cites with the theme state; Stocks optional (G11).
- **Page legend**: the six flags as the contract words them.

### A.5 Mode · 模式选择与预期

- **Shelf**: glyph switch; 副题 `模式选择与预期 · mode · preconditions · expectation`; meta `CN stock
  analyst · a strategy`; chip `<strategy> · <mode>` plus `card frozen` on S01 / S02 (today
  `lunhui-s01-repair · WAIT`, WAIT in all three drills); Run greyed once the run holds its mode.
- **Reads**: Part 三 = the stage table's 模式选择 column P0159 cell by cell, the text's mode menu, of
  which the first version admits S01 (P0243–P0265, P0292–P0308, P0780–P0784, P0901–P0902,
  P1639–P1642) and S02 (P0186–P0196, P0401–P0403, P0672–P0675, P0855–P0860, P1333–P1343,
  P1405–P1426) and keeps the rest as R01–R14 labels (E4); Part 七 P1610–P1650 (premium expectation
  P1612–P1619, logic expectation P1621–P1633, the expectation gap and chain P1634–P1643); discipline
  P0011–P0012 is the operator's, never the module's output.
- **Says**: `mode` (S01 · S02 · WAIT), `preconditions` (met · unmet · unmet: no source),
  `research_only_matches`, `expectation` (the frozen card) or null, `expectation_review`,
  `parameters_used`, `addressed`.
- **Sheet**: no New run; Latest run only with the prerequisites (G15); Cites read-only.
- **Page**: the runs card's expectation table reused, plus the preconditions list and the addressed
  items. **Legend**: the eight preconditions as the contract names them, each with its evidence class.

### A.6 Counterevidence · 反证

- **Shelf**: glyph shield; 副题 `反证 · items against the accepted artifacts`; meta `CN reviewer ·
  cn-market or a strategy`; chip `<channel> · <n> items` (today `lunhui-s01-repair · 5 items`;
  `cn-market · 4 items` beside it on the page); `0 items`, never blank.
- **Reads**: not a chapter — the ten rulings and the general management (README §6, strategy-spec
  §7 and §5): P0016 vs P0574, P0782, P0855 · P0536 vs P0534, P0454 · P0755–P0757 · P0780–P0784 vs
  P0822–P0823, P1272 · P0403 vs P0285–P0288 · P0874, P0888, P0819 · P0337–P0348 · P0205–P0217 vs
  P1110 · P0524, P0744–P0745, P1093–P1094, P1525 · P0068, P1157, P1694–P1697 · §5: P0011–P0012,
  P0302, P0440–P0441, P0013, P0378; every number a research candidate (README §7).
- **Says**: `items` (0–12 × id, against, kind ∈ CONTRADICTS · MISSING_EVIDENCE · STALE ·
  RULING_CONFLICT · OVERREACH, text ≤ 160, evidence ids with at least one evidence id).
- **Sheet**: no New run; Latest run with the prerequisites; the "reviews:" line; the mode warning
  (G15).
- **Page legend**: the ten rulings and the five kinds.

## Appendix B — the message templates

Chinese, one per module, the slots in braces; the Note appended on its own line when given. The
builder keeps the sentences; the words "只跑" and "开新运行 / 已有运行" are what the section keys on.

- Environment · Sentiment · Theme, latest run:
  `请只跑 Lunhui 的 {module} 模块：频道 cn-market，运行 {run}（已有运行，不要再冻结）。`
- Environment · Sentiment · Theme, new run:
  `请只跑 Lunhui 的 {module} 模块：频道 cn-market，开新运行——先按 lunhui:run 第 1 步冻结整套（index、limit-up、boards），再只写 {module}。`
- Leader, new run:
  `请只跑 Lunhui 的 leader 模块：策略 {strategy}，开新运行，引用 cn-market 运行 {market_run}；股票 {codes}。`
  with `{codes}` the codes joined by `、`, or `由你从该市场运行的主线成分股与涨停池里选 1–4 只主板个股`.
- Leader, latest run:
  `请只跑 Lunhui 的 leader 模块：策略 {strategy}，运行 {run}（已有运行），引用 cn-market 运行 {market_run}。`
- Counterevidence, `cn-market`:
  `请只跑 Lunhui 的 counterevidence 模块：频道 cn-market，运行 {run}（已有运行）。`
- Counterevidence, a strategy:
  `请只跑 Lunhui 的 counterevidence 模块：策略 {strategy}，运行 {run}（已有运行），引用 cn-market 运行 {market_run}。`
- Mode:
  `请只跑 Lunhui 的 mode 模块：策略 {strategy}，运行 {run}（已有运行），引用 cn-market 运行 {market_run}。`
- The Note: a final line `备注：{note}`.

## Appendix C — `dsh/profile/lunhui-module.md`, the shipped text

The text plan 1 shipped (plan 1, Task 3), byte for byte: 1,372 bytes as `wc -c` counts it, trailing
newline included, against the 1,500 budget (`LUNHUI_MODULE_MAX_BYTES`, pinned by
`face/tests/protocols.test.ts`); 709 characters trimmed. Every tool and role name it uses exists;
an edit to the file is mirrored here.

```
# 单模块请求

面从模块卡发来的消息写明：模块、频道、运行（已有运行或开新运行），策略模块还有 market_run 与可选代码。只做这一个模块，其余照 lunhui:run。

- cn-market 的 environment、sentiment、theme 调 role_cn_market_analyst，任务说明点名只写哪个模块；它没点名时会写三份。
- 开新运行（cn-market）：先按 lunhui:run 第 1 步冻结整套——运行一被角色读过即封存，不先冻整套，别的卡就不能再用它；再调角色只写所请求的模块。
- 已有运行：不再冻结，直接调角色。
- leader 开新运行：先调用 lunhui_freeze_quotes 开运行（代码用消息给的，没给就按 lunhui:run 第 2 步自选 1–4 只），再调 role_cn_stock_analyst 只写 leader。
- counterevidence 只在已有接受的 leader（策略频道）或至少一份市场工件（cn-market）的运行上调 role_cn_reviewer。
- mode 只在 leader 与反证都被接受后调 role_cn_stock_analyst；反证在 mode 之前，两者不并行。
- 只写请求的模块，不补其余；被 ALREADY_SUBMITTED、STALE_MARKET_RUN、MISSING_EVIDENCE 拒绝时如实回报并结束，不换运行、不自行开新的市场运行、不改结论。
- 最后的消息只报本模块的要点、是否 NOT_EVALUABLE 及缺哪些来源、行情是否 delayed。
```
