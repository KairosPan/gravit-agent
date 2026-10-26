# CLAUDE.md

Descriptive, not prescriptive — present-tense facts about the tree, updated when the tree
moves; the only CLAUDE.md in the repo. Owner: the operator. Last reviewed 2026-10-24. Depth
lives in `DEVELOPMENT.md`, `Gravit-Design.md`, `face/README.md`, docstrings, and `docs/`.

## What this is
A market-strategy-account research workbench for one operator, one principal agent (Gravit) and
operator-authored bots, reset 2026-08-29 from the previous product. MARKET + ACCOUNT are Linqi's
Account, an external program Gravit reaches through its seat and the face shows on its screens,
plus AKShare for A shares; the repo holds no Python since 2026-10-24. STRATEGY is `strategies/`,
the agent's arena, run on DeepSeek Harness (dsh) inside `face/`, the chat face.

## Map
| Where | What |
|---|---|
| `Gravit-Design.md` | the product charter — intent, principles, write map, debts, revisit triggers; outranks everything on intent |
| `DEVELOPMENT.md` | the as-built front/back-end reference — processes, contracts, gates, tests, drills, residuals, forward list; on mechanism the code is the fact and this document follows it |
| `Gravit-Docs-and-Prompt-Loops.html` | the documents-and-prompt-loops reference, a standalone Chinese HTML page beside the charter: who reads which document, the stock dsh persona and the system-prompt section orders, a section guide to `Gravit-Design.md` and `DEVELOPMENT.md`, and the two loops (operator prompt → `POST /anthropic/v1/messages`; model output → approval card, tool results, goal rounds, browser) station by station with the documents and prompts each passes — written 2026-10-19 against main @ b398dff and dsh 0.2.0-rc.2, updated when the loops move |
| `AGENTS.md` | for coding agents (Claude Code and Codex read it); Gravit does not — see `GRAVIT.md` |
| `GRAVIT.md` | the workspace instructions every dsh agent in the tree reads on its first request — facts and rules only, ≤ 4,500 bytes (`face/tests/gravit-md.test.ts`); the face patches dsh's agent-instructions row to read it and `GRAVIT.local.md`, nothing else |
| `ROADMAP.md` | the five-item forward index from the reset plus a built log; `DEVELOPMENT.md` §10 is the ordered detail and cites its items by number |
| `strategies/` | one directory per strategy (`_template` is the copy source, `room-drill` the room drill's fixture channel, `cn-market` the Lunhui market read's channel) |
| `dsh/` | the harness config: `profile/cordis.yml` template (indicative shape, not a validated dsh config) + `profile/{persona,cycle}.md` (Gravit's persona, and the research-cycle contract the face mounts as its `gravit:cycle` section — evidence from the Account through the seat, AKShare, and a forward paper trade; no role calls) + `profile/lunhui-run.md` (the A-share research run's order, mounted as Gravit's `lunhui:run` section) + `skills/mechanics` (`account-seat-guide`) + `skills/style-gravit` (operator style). Install is `cd face && npm run setup`, then the operator's rows per `dsh/README.md` |
| `face/` | gravit-face: Node 22, hosts dsh 0.2.0-rc.2 in-process from profile `face`, serves one page, the client, at 127.0.0.1:3090 (Messages with a page per channel, Markets, Trade, Discover and Account are its screens; `/market` and `/account` are gone); `strategies/*` are rostered channels; `face/plugins/lunhui/` are the Lunhui rows (`src/lunhui.ts`: eleven in-process dsh rows freezing, analysing and reviewing A-share research runs into `strategies/<name>/analysis/`); `src/orders.ts` is Gate 2, the per-order approval card; the face's own quote wire (`/data/quotes`, `/data/symbols/search`) speaks A shares alone (iFinD, Tencent) |
| `face/src/akshare.ts` | project-owned AKShare MCP connection for public A-share queries; composed below operator profile/home patches; no lookahead guard; install/version and live-query limits in `face/README.md` |
| `face/src/account-seat.ts` · `account-proxy.ts` | the Account seat: the project-owned `mcp-account` row (`@deepseek-ai/dsh-mcp-client`, stdio, composed beside AKShare) that spawns the MCP seat of Linqi's Account — [linqizhe07/buyer-agent-demo](https://github.com/linqizhe07/buyer-agent-demo), an external program the operator installs (`FACE_ACCOUNT_SEAT_DIR`, default `~/buyer-agent-demo`, `npm ci` there) and runs (`npm run account`, 127.0.0.1:4820; `FACE_ACCOUNT_URL`) — so Gravit's tools gain `mcp__account__portfolio_*`; paper venues only, by the operator's grants at the Account (its page, or the face's owner keys); every seat write passes Gate 2 here and the Account's Guard card there (answerable in the face's Cards); `face/src/account-proxy.ts` proxies the Account's reads and push channel under `/data/account…` for the Markets, Trade and Account screens, and the owner device's three writes — `pair`, `prepare`, `exchange`, their bodies passed through unparsed and unlogged (loopback, twenty exact routes, per-route TTLs; the face holds no key and signs nothing), and `face/src/seat.ts` serves `/data/seat.json` for the seat box through the proxy's reader; the seat's key is the Account's (`~/.buyer-agent-demo/seats/gravit.json`); nothing of the Account is vendored since 2026-10-20 (the `demo/` submodule is gone) |
| `bots/` | one directory per bot (`_template` is the copy source, `gravit` the default, whose composition the face renders from `roles/` — its `gravit.js` row plus one `dsh-tool-subagent` row per role, today `cn-market-analyst`'s, `cn-reviewer`'s and `cn-stock-analyst`'s, `agent.cordis.yml` being the generated mirror — `drill-bull`/`drill-bear` the room drill's two voices, `news-scout` an operator bot), declared by the face as a dsh agent preset (`face/src/bot-presets.ts`, re-declared on every save) — persona + allow-list mask via `face/plugins/bot.js`; in a room (a channel session with bots rostered) `face/src/room.ts` creates one `read-only` member session per bot and Gravit calls `dispatch` |
| `roles/` | the role library, one directory per role (`_template` is the copy source; three roles ship — `cn-market-analyst`, the Lunhui market modules' analyst, `cn-stock-analyst`, the leader and mode modules' analyst, and `cn-reviewer`, the counterevidence reviewer): `ROLE.md` (the child's persona) + `role.yml` (`name`, a one-line `description`, `allow` — exact tool names, optional `model`), operator-edited; `face/src/roles.ts` reads it at boot and renders Gravit's preset, one `role_<id>` one-shot child each — after an edit `cd face && npm run render:roles` regenerates the `bots/gravit/agent.cordis.yml` mirror (`DEVELOPMENT.md` §3.8) |
| `docs/` | `superpowers/{specs,plans,runbooks}` (per-feature decision history; everything dated 2026-06/07, and `runbooks/p-b-p-c-activation.md`, describes the retired product; `runbooks/2026-09-30-dsh-0.2.0-rc.2-go-live.md` is the operator's go-live procedure) · `research/` (frozen inputs) · `design/prototypes` (face rounds R1–R4) |
| `face/tests/` | `node --test` via tsx, offline, no keys; `FACE_SMOKE=1` adds the 23 real boots (`room-smoke`, `order-gate-smoke` and `account-graft-smoke` among them) |
| `face/client/` | gravit-ui, the face's browser client since 2026-10-19 (the settled design `docs/superpowers/specs/2026-10-09-demo-v2-gravit-frontend-design.md`, mounted on the face by `docs/superpowers/specs/2026-10-19-gravit-ui-on-face-design.md`, route A): `index.html` + `css/` + `js/` — the store and pure reducers, string renderers, a host layer (`js/host/`: the kind table, the session rows, the live follow-or-page policy, the actions, the markets, account, channel, Discover and trace layers and their pure views) over the wire modules (`js/wire/`: `api.js` and `mapper.js` from the old chat page, unchanged but for one field, and its pure modules — grouping, channel names, bot ids and settings, the subagent catalog, the member trace loader — in English; the quotes, search, watchlist and account models from the old instrument pages); stage 1 = Messages on dsh (the list, the thread, the three gate cards, rooms); stage 2 = Markets (the Account's markets by tab, the watch list, a market's page with its candles) and Account (the Account's Portfolio, Venues, Agents and Cards, the Statement drawer) on the face's proxy — and, since the graft's stage 2 (2026-10-24), the page as one of the Account's owner devices (`js/host/owner.js`: a P-256 key in the browser's IndexedDB, paired and signing the Account's envelope at its door; pairing, Settings › Devices, Sign out), every owner action prepare → What you sign → sign (`js/host/sheet.js`), Trade (`#/trade`, `js/host/trade.js`: the picker, the ticket, Under way with Cancel) and the owner's keys on Account and Markets, drawn only while the page signs; stage 3 = the list grouped by channel with a page per channel, the row actions, Discover (the MCP servers, bots, CLI agents and Gravit, skills — no shop), tool results drawn, a conversation's subagent children with Stop, a room member's trace; tests in `face/tests/client/` (fake DOM) and `face/tests/gravit-client-smoke.test.ts` (a real boot) |

## Commands
```bash
# face/ — the repo's only build and test
npm run setup               # once, after npm install: writes $DSH_HOME/profiles/face, never overwrites
npm test && npm run typecheck
npm start                   # prints http://127.0.0.1:3090/?token=… — open that (see face/README.md)
```

## Gotchas
- **Nothing guards against lookahead and nothing backtests** (since 2026-10-24): the Account's
  history is read as it is, and a strategy's evidence is forward paper trading on its paper venue.
- **One order gate: Gate 2, the face's card on every Account-seat write** (`face/src/orders.ts`,
  only when dsh runs inside the face; `place_order`/`cancel_order` under any server are denied and
  refuse the boot). It is not containment — a shell turn can read the seat's key file and sign at
  the Account's door; the drill uses `mcp__drill__*` stand-ins (`face/README.md`).
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
  here and the Account's there; re-run `account-seat-smoke` after pulling the checkout. The face's
  page is an owner device of the Account too (charter D18): the operator's hand orders from Trade
  pass no gate of this tree's, only the Account's cap — paper venues only in the owner drill
  (`face/README.md`), and `account-graft-smoke` after pulling the checkout as well.

Reading order for a new session: `Gravit-Design.md` §1–§2 → the `DEVELOPMENT.md` section you
are touching → `GRAVIT.md` for what Gravit itself sees.
