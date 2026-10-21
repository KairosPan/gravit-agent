# CLAUDE.md

Descriptive, not prescriptive — present-tense facts about the tree, updated when the tree
moves; the only CLAUDE.md in the repo. Owner: the operator. Last reviewed 2026-09-30. Depth
lives in `DEVELOPMENT.md`, `Gravit-Design.md`, `face/README.md`, docstrings, and `docs/`.

## What this is
A market-strategy-account research workbench for one operator, one principal agent (Gravit) and
operator-authored bots, reset 2026-08-29 from the previous product. MARKET + ACCOUNT
are `alpaca_kit` — one Python package, two faces: importable library and MCP server. STRATEGY is
`strategies/`, the agent's arena, run on DeepSeek Harness (dsh) inside `face/`, the chat face.

## Map
| Where | What |
|---|---|
| `Gravit-Design.md` | the product charter — intent, principles, write map, debts, revisit triggers; outranks everything on intent |
| `DEVELOPMENT.md` | the as-built front/back-end reference — processes, contracts, gates, tests, drills, residuals, forward list; on mechanism the code is the fact and this document follows it |
| `Gravit-Docs-and-Prompt-Loops.html` | the documents-and-prompt-loops reference, a standalone Chinese HTML page beside the charter: who reads which document, the stock dsh persona and the system-prompt section orders, a section guide to `Gravit-Design.md` and `DEVELOPMENT.md`, and the two loops (operator prompt → `POST /anthropic/v1/messages`; model output → approval card, tool results, goal rounds, browser) station by station with the documents and prompts each passes — written 2026-10-19 against main @ b398dff and dsh 0.2.0-rc.2, updated when the loops move |
| `AGENTS.md` | for coding agents (Claude Code and Codex read it); Gravit does not — see `GRAVIT.md` |
| `GRAVIT.md` | the workspace instructions every dsh agent in the tree reads on its first request — facts and rules only, ≤ 4,500 bytes (`face/tests/gravit-md.test.ts`); the face patches dsh's agent-instructions row to read it and `GRAVIT.local.md`, nothing else |
| `ROADMAP.md` | the five-item forward index from the reset plus a built log; `DEVELOPMENT.md` §10 is the ordered detail and cites its items by number |
| `alpaca_kit/{source,firewall}.py` | MarketDataSource Protocol + FakeSource; the AsOfGuard/GuardedSource lookahead firewall (six surfaces pinned by name in `tests/test_us0_firewall_surfaces.py`) |
| `alpaca_kit/{alpaca,registry,composite,account}.py` | Alpaca REST + corp-action normalization · source selection · per-capability routing · the paper-pinned trading host (the order functions live here; Gate 1 is in `mcp/tools.py`) |
| `alpaca_kit/{pit,feeds,features}/` + `{replay,universe,stock,integrity}.py` | PIT store/capture/CHECKSUMS · EDGAR (live) + FINRA/float (stubs) · trend_template/gainer screens + breadth · backtest day iterator · daily screen + its snapshot models · canonical hasher |
| `alpaca_kit/mcp/` | the MCP tool surface, read-only by default; order tools register only under `ALPACA_KIT_ENABLE_ORDERS=1` AND keys; screen/breadth disk cache in `data/.screen_cache`, never inside a bed |
| `strategies/` · `data/` · `scripts/` | one directory per strategy (`_template` is the copy source, `room-drill` the room drill's fixture channel) · gitignored PIT beds + caches · capture_window / capture_broad / smoke_alpaca / `face_data.py` (the account's and the legacy market producer) / `face_bars.py` (a market page's daily bars, keys first, the PIT bed behind) / convert_seeds |
| `dsh/` | the harness config: `profile/cordis.yml` template (indicative shape, not a validated dsh config) + `profile/{persona,cycle}.md` (Gravit's persona, and the research-cycle contract the face mounts as its `gravit:cycle` section; the roles it calls are `roles/`, below) + `skills/mechanics` (rules, tool guide) + `skills/style-gravit` (operator style). Install is `cd face && npm run setup`, then the operator's rows per `dsh/README.md` |
| `face/` | gravit-face: Node 22, hosts dsh 0.2.0-rc.2 in-process from profile `face`, serves one page, the client, at 127.0.0.1:3090 (Messages with a page per channel, Markets, Discover and Account are its screens; `/market` and `/account` are gone); `strategies/*` are rostered channels; `src/orders.ts` is Gate 2, the per-order approval card |
| `face/src/akshare.ts` | project-owned AKShare MCP connection for public A-share queries; composed below operator profile/home patches; no PIT guard; install/version and live-query limits in `face/README.md` |
| `face/src/account-seat.ts` | the Account seat: the project-owned `mcp-account` row (`@deepseek-ai/dsh-mcp-client`, stdio, composed beside AKShare) that spawns the MCP seat of Linqi's Account — [linqizhe07/buyer-agent-demo](https://github.com/linqizhe07/buyer-agent-demo), an external program the operator installs (`FACE_ACCOUNT_SEAT_DIR`, default `~/buyer-agent-demo`, `npm ci` there) and runs (`npm run account`, 127.0.0.1:4820; `FACE_ACCOUNT_URL`) — so Gravit's tools gain `mcp__account__portfolio_*`; paper venues only, by the operator's grants on the Account page; every seat write passes Gate 2 here and the Account's Guard card there; `face/src/seat.ts` serves `/data/seat.json` for the Account screen's seat box; the seat's key is the Account's (`~/.buyer-agent-demo/seats/gravit.json`); nothing of the Account is vendored since 2026-10-20 (the `demo/` submodule is gone) |
| `bots/` | one directory per bot (`_template` is the copy source, `gravit` the default, whose composition the face renders from `roles/` — its `gravit.js` row plus one `dsh-tool-subagent` row per role, `agent.cordis.yml` being the generated mirror — `drill-bull`/`drill-bear` the room drill's two voices), declared by the face as a dsh agent preset (`face/src/bot-presets.ts`, re-declared on every save) — persona + allow-list mask via `face/plugins/bot.js`; in a room (a channel session with bots rostered) `face/src/room.ts` creates one `read-only` member session per bot and Gravit calls `dispatch` |
| `roles/` | the role library, one directory per role (`_template` is the copy source; `screener`, `backtester`, `reviewer` ship): `ROLE.md` (the child's persona) + `role.yml` (`name`, a one-line `description`, `allow` — exact tool names, optional `model`), operator-edited; `face/src/roles.ts` reads it at boot and renders Gravit's preset, one `role_<id>` one-shot child each — after an edit `cd face && npm run render:roles` regenerates the `bots/gravit/agent.cordis.yml` mirror (`DEVELOPMENT.md` §3.8) |
| `docs/` | `backtest-rules.md` (the five honest-eval rules) · `superpowers/{specs,plans,runbooks}` (per-feature decision history; everything dated 2026-06/07, and `runbooks/p-b-p-c-activation.md`, describes the retired product; `runbooks/2026-09-30-dsh-0.2.0-rc.2-go-live.md` is the operator's go-live procedure) · `research/` (frozen inputs) · `design/prototypes` (face rounds R1–R4) |
| `tests/` · `face/tests/` | offline pytest, no keys · `node --test` via tsx; `FACE_SMOKE=1` adds the 16 real boots (`room-smoke` and `order-gate-smoke` among them) |
| `face/client/` | gravit-ui, the face's browser client since 2026-10-19 (the settled design `docs/superpowers/specs/2026-10-09-demo-v2-gravit-frontend-design.md`, mounted on the face by `docs/superpowers/specs/2026-10-19-gravit-ui-on-face-design.md`, route A): `index.html` + `css/` + `js/` — the store and pure reducers, string renderers, a host layer (`js/host/`: the kind table, the session rows, the live follow-or-page policy, the actions, the markets, account, channel, Discover and trace layers and their pure views) over the wire modules (`js/wire/`: `api.js` and `mapper.js` from the old chat page, unchanged but for one field, and its pure modules — grouping, channel names, bot ids and settings, the subagent catalog, the member trace loader — in English; the quotes, search, watchlist and account models from the old instrument pages); stage 1 = Messages on dsh (the list, the thread, the three gate cards, rooms); stage 2 = Markets (the watchlist, holdings and search with the face's live quotes, a market's page with `/data/bars`) and Account (the paper account's Portfolio, Statement and Venues); stage 3 = the list grouped by channel with a page per channel, the row actions, Discover (the MCP servers, bots, CLI agents and Gravit, skills — no shop), tool results drawn, a conversation's subagent children with Stop, a room member's trace; tests in `face/tests/client/` (fake DOM) and `face/tests/gravit-client-smoke.test.ts` (a real boot) |

## Commands
```bash
# repo root
pip install -e ".[dev]"     # extras: [live] adds alpaca-py + market calendars
python -m pytest            # offline, no keys (-q is already the default addopts)
python -m alpaca_kit.mcp    # the MCP server, stdio
# face/
npm run setup               # once, after npm install: writes $DSH_HOME/profiles/face, never overwrites
npm test && npm run typecheck
npm start                   # prints http://127.0.0.1:3090/?token=… — open that (see face/README.md)
```

## Gotchas
- Corp actions key on **`announce_date := process_date`** — Alpaca has no true announce field.
- **`ALPHA_DATA_FEED` defaults to `iex`** — SIP 403s on free/paper keys.
- Prices are stored **RAW/unadjusted**; `make_source()` returns a RAW source by contract, so
  wrapping it in `GuardedSource` + `AsOfGuard` is the caller's job (`replay_days` and the MCP
  tools do it for you).
- Backtests run **only through `alpaca_kit.replay.replay_days`**, bounded with both `start=` and
  `end=` to a bed's usable window (2yr 2024-06-03..2026-07-09, broad 2025-11-17..2026-03-27) —
  outside it a snapshot read raises `SnapshotMissingError`, but bar and corp-action reads just
  return empty, so bounding is on you. Neither bed carries **warmup**: long indicators mature
  only from mid-2025 on 2yr and never on broad. Exact dates and the five honest-eval rules:
  `docs/backtest-rules.md` (`GRAVIT.md` carries the same table).
- **Two order gates, both on the MCP tool surface.** Gate 1 = registration (flag AND keys, in
  `alpaca_kit/mcp/tools.py`); Gate 2 = the face's per-order card (`face/src/orders.ts`), which
  exists only when dsh runs inside the face. Neither is containment — a shell turn can read
  `.env.alpaca` and import `alpaca_kit.account`; the paper-hostname pin bounds it. Never arm
  `ALPACA_KIT_ENABLE_ORDERS` in the real harness home: the automated drill uses `mcp__drill__*`
  stand-ins, the manual half arms Gate 1 in a scratch home only (`face/README.md`).
- **`$DSH_HOME/profiles/face/cordis.yml` is rewritten to `[]` on every face boot.** The
  operator's file is `cordis.patch.yml`: the face's overlay rows (webserver, connection, the Remote
  controllers, the preset registry…) override it silently; `face/src/policy.ts` defaults yield to it.
- **The chat URL is tokenized.** Open the `…/?token=…` URL `npm start` prints: that visit sets a
  30-day cookie for the exact host:port (`localhost` is not `127.0.0.1`); `/api` 401s without it.
- **`face/client/*` is served with no cache headers** — hard-reload the browser after any client
  edit, or you drill a stale module.
- **The Account seat is an external install.** `face/src/account-seat.ts` spawns the MCP seat of
  Linqi's Account from `FACE_ACCOUNT_SEAT_DIR` (default `~/buyer-agent-demo`: clone it, `npm ci`
  there) and talks to the service you run (`npm run account`, writes on — `--read-only` refuses
  paper orders too); paper venues only: admit the seat as **Gravit** on the Account page and sign
  it a `trade` limit naming a paper venue, never a real one. Every seat write is two cards, Gate 2
  here and the Account's there; re-run `account-seat-smoke` after pulling the checkout.

Reading order for a new session: `Gravit-Design.md` §1–§2 → the `DEVELOPMENT.md` section you
are touching → `GRAVIT.md` for what Gravit itself sees.
