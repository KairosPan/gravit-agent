# The Account grafted into the face — stage 3: the removal of `alpaca_kit`, the PIT beds and backtests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The previous product's own market and account layer leaves the tree — `alpaca_kit` (library, PIT store, MCP server with Gate 1), its pytest suite and `pyproject.toml`, every Python script, the backtest rules and files, the AQR-era strategy and bots, the three roles and two skills, the face's producers and keyed quote providers, the thread's alpaca-kit renderers and the order gate's alpaca half — and the documents, the charter and `GRAVIT.md` say what is left: the Account through Gravit's seat, AKShare for A shares, the face's screens on the Account, and no lookahead guard anywhere. The beds are deleted last by the operator's own command.

**Architecture:** Deletion in dependency order so every commit leaves a green tree: first the face's server modules that read Python (the producers, bars, the keyed quote providers — the `/data` fence moves out of `data.ts` into `http.ts` first), then the thread's renderers and the order gate's alpaca half, then the Python package with its tests and scripts, the strategies' backtest files and the AQR-era directories, the roles with the skills and the profile row (the mirror re-rendered), the cycle contract's new text and `GRAVIT.md` rewritten, and last the documents and the charter. `FACE_SMOKE=1 npm test` is the suite at the end; no pytest remains.

**Tech Stack:** Node 22 + TypeScript (`tsx --test`), the vanilla ES-module client; `git rm` for the directories; `npm run render:roles` for Gravit's mirror.

**Spec:** `docs/superpowers/specs/2026-10-22-account-graft-design.md` — §12 (12.1 the inventory, 12.2 the replacements, 12.3 the operator's answers, 12.4 the consequence, 12.5 the order), §8 item 8 (the charter), §9 (the documents), §2 non-goals (the face's producers and keyed providers as the follow-up this plan takes), §11 ("The face's keyed market data retires from the screens"). Stages 1 and 2 landed on main @ 0011666; this branch (`feat/account-graft-3`) is cut from it.

## Global Constraints

- The product speaks English; screens carry no explanatory small print; a screen that loses a source says so in one muted line (the A-share wire is the face's one remaining quote source).
- Vanilla ES modules, no bundler; `tsx --test tests/*.test.ts tests/client/*.test.js`; `face/tests/fixtures/events.jsonl` untouched.
- Every commit leaves `cd face && npm test` and `npm run typecheck` green; `FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=~/buyer-agent-demo npm test` green at the end; no `python -m pytest` remains (no `pyproject.toml`, no `tests/`).
- Nothing of the face's `/data` fence weakens: `isLoopbackHost`, `isTrustedDataRequest`, `isJsonBody` keep their tests word for word, moved with them to `http.ts`; the proxy, the seat route, the quote routes and the symbol search import them from there.
- What stays of the face's own wire: `/data/quotes`, `/data/quotes/stream`, `/data/symbols/search` for `cn` ids alone (the iFinD provider, Tencent's search); `FACE_IFIND_POLL_MS`, `IFIND_ACCESS_TOKEN`, `IFIND_REFRESH_TOKEN` stay; `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`, `APCA_API_BASE_URL`, `ALPHA_DATA_FEED`, `ALPHA_PIT_ROOT`, `ALPHA_DATA_SOURCE`, `FACE_PYTHON`, `ALPACA_KIT_ENABLE_ORDERS` leave the face and every document; `.env.alpaca` leaves the start incantation (the `.gitignore`'s `.env*` line stays).
- The order gate (`face/src/orders.ts`, Gate 2) keeps the Account seat's twelve writes and the unclassified-seat-tool rule exactly as stage 1 left them; every card reads `Account seat`; the `(operator-gated)` marker audit and `place_order`/`cancel_order` go; "a gate that covers nothing must not look healthy" reads the seat's list.
- The role mechanism, `roles/_template`, `bots/_template`, `bots/gravit`, `bots/drill-bull`, `bots/drill-bear`, `bots/news-scout`, `strategies/_template` (minus its backtest files), `strategies/room-drill` (minus its backtest files), `dsh/skills/mechanics/account-seat-guide`, `dsh/skills/style-gravit` stay; `channels.ts` keeps reading a strategy's `backtests/` when one exists (the directory is optional now).
- `GRAVIT.md` ≤ 4 500 bytes (`face/tests/gravit-md.test.ts`), facts and rules only; the consequence of §12.4 in one line.
- `dsh/profile/cycle.md` is operator-only by the charter's write map: the text in Task 7 is the draft the spec's §12.3 asks for; the operator's approval of THIS PLAN is the approval to write it, verbatim.
- The PIT beds `data/pit/2yr`, `data/pit/broad`, `data/.screen_cache`, `data/.face_cache` are never touched by any task: the operator runs `rm -r data/pit data/.screen_cache data/.face_cache` in the primary checkout after the branch lands (12.5).
- `.claude/launch.json` is untracked and the operator's: a task notes its `.env.alpaca` line for the operator, never edits it.
- Commit messages are written to a file and committed with `git commit -F` (no backticks or parentheses on a `-m` line); one logical change per commit; the committed ledger `docs/superpowers/plans/2026-10-22-account-graft-ledger.md` gains a stage-3 section with a line per task.

## Review Focus

1. **A `us:` or `crypto:` star left in this browser's storage** (the face's own grammar, pre-graft): the Markets screen still asks the Account for it once and says `Not listed at the Account` when it is not found — never quotes it, never crashes on a market the face no longer speaks. Pinned in Task 2 (`host-markets.test.js`: "an old us star is asked of the Account, never quoted by the face").
2. **An old conversation whose thread holds an `mcp__alpaca-kit__*` tool result** (the sessions written before this stage): the thread draws it as any tool result — the call's name and its raw payload folded — never blank, never a crash. Pinned in Task 4 (`tool-result.test.js`: "an alpaca-kit result from an old session draws as a plain tool result").
3. **The Gate-2 card for a seat write after the alpaca half leaves**: `portfolio_live_order` still raises `Account seat - …`, a tool under the seat prefix the face has not classified still raises a card, and a seat read does not. Pinned in Task 4 (`orders.test.ts`: the three cases kept by name).
4. **A strategy directory without `backtests/`** (every new one from `_template`): the channel page draws its brief and journal and no error; one that still has the directory lists it. Pinned in Task 5 (`channels.test.ts`: "a strategy without backtests draws no backtests section").
5. **Gravit's preset without the three roles**: the rendered `bots/gravit/agent.cordis.yml` has no `role_*` rows, the face boots with Gravit's tools and no `role_screener`, and the cycle section mounted from the new `cycle.md` names no role. Pinned in Task 6 (`roles.test.ts`, `gravit-plugin.test.ts`) and Task 7 (`cycle.test.ts`).

---

## File structure

| What | Action |
|---|---|
| `face/src/data.ts`, `bars.ts`, `watchlist.ts`, `quote-streams.ts`, `face/client/market-catalog.js` | delete (the fence moves to `http.ts`; the symbol-search route registers itself) |
| `face/src/http.ts`, `symbol-search.ts`, `quotes.ts`, `quote-snapshots.ts`, `quote-types.ts`, `main.ts`, `orders.ts`, `setup.ts`, `agents.ts`; `face/scripts/check-home.ts`, `schema-sizes.ts` | modify |
| `face/client/js/render/tool-result.js`, `render/chart.js` (`chartSvg`), `host/kinds.js`, `wire/botSettings.js`, `wire/market-quotes.js`, `host/market-view.js`, `wire/account-model.js`, `wire/market-model.js` (what the grammar still needs) | modify (tool-result.js shrinks to the plain path) |
| `face/tests/data.test.ts` → `http.test.ts` (the fence), `bars.test.ts`, `quote-streams.test.ts`, `tests/test_*.py` | delete / move |
| `alpaca_kit/`, `tests/`, `pyproject.toml`, `scripts/`, `docs/backtest-rules.md`, `docs/aqr-room-orchestration.md`, `strategies/aqr-r1000/`, `bots/aqr-audit/`, `bots/aqr-data/`, `bots/aqr-method/`, `strategies/{_template,room-drill}/{screen.py,backtest.py,backtests/}`, `roles/{screener,backtester,reviewer}/`, `dsh/skills/mechanics/{backtest-rules,alpaca-kit-guide}/` | `git rm -r` |
| `dsh/profile/cordis.yml`, `dsh/profile/cycle.md`, `dsh/README.md`, `bots/gravit/agent.cordis.yml` (re-rendered), `GRAVIT.md`, `.gitignore` | modify |
| `Gravit-Design.md`, `CLAUDE.md`, `DEVELOPMENT.md`, `face/README.md`, `ROADMAP.md`, `Gravit-Docs-and-Prompt-Loops.html`, `docs/superpowers/plans/2026-10-22-account-graft-ledger.md` | modify |

---

### Task 1: The producers and the bars route leave; the fence moves

**Files:**
- Modify: `face/src/http.ts` (gains `isLoopbackHost`, `isTrustedDataRequest`, `isJsonBody` from `data.ts`, bodies unchanged), `face/src/symbol-search.ts` (gains `registerSymbolSearchRoute(webServer, search) → dispose`, the `/data/symbols/search` route `data.ts` registered), `face/src/main.ts` (no `registerDataRoutes`; registers the search route; nothing of `FACE_PYTHON`), the ten importers of `./data.ts` — `account-proxy.ts`, `seat.ts`, `sessions.ts`, `room.ts`, `panels.ts`, `channels.ts`, `bots.ts`, `bot-runtime.ts`, `main.ts`, `bars.ts` (deleted) — re-pointed at `./http.ts`; `face/tests/smoke.test.ts` (its `registerDataRoutes` block at ~403–425 becomes the search route's registration; the fence assertion there reads `http.ts`'s `isLoopbackHost`), `face/tests/quotes.test.ts` and `symbol-search.test.ts` (import the fence from `../src/http.ts`)
- Delete: `face/src/data.ts`, `face/src/bars.ts`, `face/src/watchlist.ts`, `face/client/market-catalog.js` (read by `watchlist.ts` alone), `face/tests/bars.test.ts`
- Move: the fence tests of `face/tests/data.test.ts` → `face/tests/http.test.ts` (an existing file with four `readBody`/`HttpError` tests; the producer-route and spawner tests of `data.test.ts` are deleted with the module)
- Test: `face/tests/http.test.ts`, `account-proxy.test.ts`, `seat.test.ts`, `quotes.test.ts`, `symbol-search.test.ts`, `smoke.test.ts` (`npm test`)

**Interfaces:**
- Consumes: stage 1's `isTrustedDataRequest(req)`, `isJsonBody(req)`, `isLoopbackHost(host)` (bodies unchanged).
- Produces: the same three from `http.ts`; `registerSymbolSearchRoute(webServer: RouteRegistrar, search: SymbolSearch): () => void`; `/data/account.json`, `/data/market.json`, `/data/watchlist.json`, `/data/bars` answer the face's ordinary 404.

- [ ] **Step 1: Write the failing tests** — `http.test.ts` holds the fence tests moved word for word plus `"the producer routes and bars are gone"` (a boot's web server has no `/data/account.json`, `/data/market.json`, `/data/watchlist.json`, `/data/bars` route; `/data/symbols/search` still answers a `cn` query through the search's fake fetch).
- [ ] **Step 2: Run** `cd face && npx tsx --test tests/http.test.ts` — Expected: FAIL (the fence not in `http.ts`; the routes still registered).
- [ ] **Step 3: Move the fence, delete the modules, register the search route from `symbol-search.ts`, fix every import.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: green.
- [ ] **Step 5: Commit** — "face: the producers, the bars route and the watchlist catalog leave; the fence lives in http.ts"

### Task 2: The keyed quote providers leave; the face's wire speaks cn alone

**Files:**
- Delete: `face/src/quote-streams.ts`, `face/tests/quote-streams.test.ts`
- Modify: `face/src/quote-types.ts` (`QuoteMarket = "cn"`, `QuoteProvider = "ifind"`), `face/src/quote-snapshots.ts` (iFinD only; the Alpaca and Coinbase branches, `coinbaseSpacingMs`, the APCA env reads go), `face/src/quotes.ts` (`PROVIDERS = { cn: "ifind" }`, no stream hub, `ALPHA_DATA_FEED` gone), `face/src/symbol-search.ts` (`SearchMarket = "cn"`; Tencent alone; `parseYahooSearch` gone; a `market` other than `cn`/`all` → 400 `invalid market`), `face/client/js/wire/market-quotes.js` (provider ids `["ifind"]`), `host/market-view.js` (`PROVIDERS = { ifind: 'iFinD' }`), `wire/account-model.js` (the `paper-api.alpaca.markets` host labels — dead since stage 1 — go), `wire/market-model.js` (the `us:`/`crypto:` grammar stays only where the Markets host's ask-once needs it — read `host/markets.js`'s `asked` path and keep exactly that), `face/README.md`'s "Market credentials" rows for APCA and the `.env.alpaca` line are Task 8's (leave for now)
- Test: `face/tests/quotes.test.ts`, `quote-snapshots.test.ts`, `market-quotes.test.ts`, `symbol-search.test.ts` (if present — else the tests live in `quotes.test.ts`), `face/tests/client/host-markets.test.js`, `market-view.test.js`

- [ ] **Step 1: Write the failing tests**: `"a us or crypto id is no longer quoted by the face"` (`/data/quotes?ids=us:AAPL` answers with no provider for it and `providers` names iFinD alone), `"the symbol search answers cn only"` (`market=us` → 400), and in `host-markets.test.js` `"an old us star is asked of the Account, never quoted by the face"` (Review Focus 1: a `us:AAPL` in `markets.watchlist` leads to `explore?q=AAPL`, and `createLiveQuotes` is never asked for it).
- [ ] **Step 2: Run** the named files — Expected: FAIL.
- [ ] **Step 3: Delete the streams, trim the snapshots, the types, the hub, the search, the client's provider words.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: green.
- [ ] **Step 5: Commit** — "face: the Alpaca and Coinbase quote providers and the US and crypto search leave; the wire speaks A shares alone"

### Task 3: The Python package, its tests, `pyproject.toml` and the scripts leave

**Files:**
- Delete (`git rm -r`): `alpaca_kit/`, `tests/`, `pyproject.toml`, `scripts/` (all seven files are Python), `docs/backtest-rules.md`
- Modify: `.gitignore` (both Python blocks — `__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `*.egg-info/`, `.pytest_cache/`, `.pytest-cache/`, `/snap/`, `/runs/`, `runs/`, the `/verdict_*` block, `/state/`, the Hermes spike line — and the PIT lines `/data/pit/`, `*.parquet`, `*.feather`, `checkpoints/`, `*.ckpt`, `*.safetensors` go; **`/data/` stays** until the operator's `rm` empties it — the ledger's last line names it as the one line left to drop; `.env*`, `.superpowers/`, `.bots-smoke-*`, `/GRAVIT.local.md`, the retired-docs block stay), `face/src/agents.ts` (`SCRUBBED_ENV` keeps the two `APCA_*` names — the operator's shell may still carry them; comment updated)
- Test: `cd face && npm test` (nothing of the face read Python after Tasks 1–2: `grep -rn "python\|FACE_PYTHON\|alpaca_kit" face/src face/client` is empty but for comments Task 8 rewrites)

- [ ] **Step 1: Verify nothing reads them** — `grep -rn "alpaca_kit\|FACE_PYTHON\|scripts/face_\|replay_days" face/src face/client/js face/tests` → Expected: no matches (else Task 1/2 missed one — fix there first).
- [ ] **Step 2: `git rm -r`** the five paths; edit `.gitignore`.
- [ ] **Step 3: Run** `cd face && npm test && npm run typecheck` — Expected: green; `ls alpaca_kit tests scripts pyproject.toml` → no such file.
- [ ] **Step 4: Commit** — "repo: alpaca_kit, its pytest suite, pyproject.toml, the scripts and the backtest rules leave"

### Task 4: The thread's alpaca-kit renderers and the order gate's alpaca half leave

**Files:**
- Modify: `face/client/js/render/tool-result.js` (the `mcp__alpaca-kit__*` dressings — tables, tiles, the bars chart — go; every tool result takes the plain path the module already has for other servers: the call's name, the payload folded; keep the module's generic shape), `face/client/js/render/chart.js` (`chartSvg` and its test go; `curveSvg`, `candlesSvg` stay), `host/kinds.js` (the dressing comment), `wire/botSettings.js` (the alpaca-kit tool labels — `daily_bars` etc. — go from the bot settings' tool words), `face/src/orders.ts` (`ALPACA_RAW_NAMES`, `OPERATOR_GATED_MARKER`, the operator-gated audit and the `PAPER order` wording go; `ORDER_RAW_NAMES` = the seat's twelve; the header rewritten: Gate 2 is the seat's gate; the "gate that covers nothing" check reads the seat's list), `face/src/setup.ts` (the comment at ~42), `face/scripts/check-home.ts` (`ALPACA_KIT_ROW_ID` and its disabled-by-id branch go), `face/scripts/schema-sizes.ts` (`GROUPS` without `mcp__alpaca-kit__`)
- Test: `face/tests/client/tool-result.test.js` (the alpaca dressings' tests → one plain-path test incl. Review Focus 2), `chart.test.js`, `orders.test.ts`, `order-gate.test.ts`, `order-gate-smoke.test.ts`, `order-gate-midboot-smoke.test.ts` + `fixtures/midboot-order-standin.js` (the stand-in exercises the seat's writes now), `check-home.test.ts`, `bot-settings-client.test.ts`

- [ ] **Step 1: Write the failing tests**: `"an alpaca-kit result from an old session draws as a plain tool result"` (Review Focus 2: a `tool/result` for `mcp__alpaca-kit__daily_bars` with rows → the generic folded payload, no table, no chart, no throw); `orders.test.ts`: the three cases of Review Focus 3 kept by name; `"no tool is a PAPER order any more"` (no card reason starts with `PAPER order`); `check-home.test.ts`: no alpaca row id expected.
- [ ] **Step 2: Run** the named files — Expected: FAIL where the dressings and the alpaca names still exist.
- [ ] **Step 3: Implement**; the midboot stand-in registers a seat write (`portfolio_live_order`) in place of `place_order`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, and `FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=~/buyer-agent-demo npx tsx --test tests/order-gate-smoke.test.ts tests/order-gate-midboot-smoke.test.ts` — Expected: green.
- [ ] **Step 5: Commit** — "face: the thread draws alpaca-kit results no more; Gate 2 is the seat's gate alone"

### Task 5: The strategies' backtest files, the AQR-era strategy and bots leave

**Files:**
- Delete (`git rm -r`): `strategies/aqr-r1000/`, `bots/aqr-audit/`, `bots/aqr-data/`, `bots/aqr-method/`, `docs/aqr-room-orchestration.md`, `strategies/_template/{screen.py,backtest.py,backtests/}`, `strategies/room-drill/{screen.py,backtest.py,backtests/}`
- Modify: `strategies/_template/THESIS.md` and `journal.md` where they name the files or the five rules (read them), `face/tests/bots-fixture.ts` / `bots.test.ts` / `channels.test.ts` where they name an AQR bot or a shipped backtest file. `face/src/channels.ts` already treats `backtests/` as optional (`readChannelBody`'s `catch { /* no backtests/ yet */ }`): no edit.
- Test: `face/tests/channels.test.ts` (`"a strategy without backtests draws no backtests section"` — Review Focus 4, a pin), `bots.test.ts`, `room-smoke` (FACE_SMOKE: the room drill's fixture channel still boots)

- [ ] **Step 1: Write the pin** in `channels.test.ts` (a strategy directory with `THESIS.md` + `journal.md` + `status.yaml` and no `backtests/` → the body answers `backtests: []`, `latest: null` and no error).
- [ ] **Step 2: Run** `npx tsx --test tests/channels.test.ts` — Expected: PASS (the pin guards the existing behaviour through the removal; say so in the report — this is the one test in the plan written to pass).
- [ ] **Step 3: `git rm -r`** the paths; fix the template's words and any test naming them.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=~/buyer-agent-demo npx tsx --test tests/room-smoke.test.ts tests/bots-smoke.test.ts` — Expected: green.
- [ ] **Step 5: Commit** — "repo: the backtest files, the AQR-era strategy and bots leave; backtests/ is optional"

### Task 6: The three roles, the two skills and the profile row leave; Gravit's mirror re-rendered

**Files:**
- Delete (`git rm -r`): `roles/screener/`, `roles/backtester/`, `roles/reviewer/`, `dsh/skills/mechanics/backtest-rules/`, `dsh/skills/mechanics/alpaca-kit-guide/`
- Modify: `dsh/profile/cordis.yml` (the `alpaca-kit` server row and its env go; the header comment names the face's own rows and the skill roots), `dsh/README.md` (steps 1–6 rewritten: install is `cd face && npm run setup` + the operator's rows; no Python, no keys for a server; the mechanics index names `account-seat-guide` alone; the "rename the server" paragraph goes), `bots/gravit/agent.cordis.yml` (re-rendered by `npm run render:roles`: no `role_*` rows), `face/src/roles.ts` (the comment at ~78). `face/plugins/gravit.js` names the `role_<id>` mechanism, not a role: no edit.
- Test: `face/tests/roles.test.ts`, `bot-presets.test.ts`, `gravit-plugin.test.ts`, `roles-smoke.test.ts`, `bots-smoke.test.ts` — the ones that read the shipped roles switch to a fixture role under the test's tmp root (`roles/_template` copied with a one-tool `allow`, e.g. `read`); `"Gravit's preset has no role rows"` (Review Focus 5)

- [ ] **Step 1: Write the failing tests** (`roles.test.ts`: the rendered preset over an empty `roles/` (only `_template`) has no `role_*` row; the fixture role renders one row).
- [ ] **Step 2: Run** — Expected: FAIL where the tests read the shipped three.
- [ ] **Step 3: `git rm -r`**, edit the profile and the README, `cd face && npm run render:roles`, fix the tests.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=~/buyer-agent-demo npx tsx --test tests/roles-smoke.test.ts tests/bots-smoke.test.ts` — Expected: green.
- [ ] **Step 5: Commit** — "roles, dsh: the three alpaca-kit roles, the two skills and the profile row leave; Gravit's mirror re-rendered"

### Task 7: The cycle contract's new text and `GRAVIT.md` rewritten

**Files:**
- Modify: `dsh/profile/cycle.md` (steps 2–5 and the blocking reasons — the text below, verbatim), `GRAVIT.md` (rewritten; ≤ 4 500 bytes), `face/src/cycle.ts` only if it pins a phrase of the old text (read `face/tests/cycle.test.ts` first)
- Test: `face/tests/cycle.test.ts` (the mounted section names no role — Review Focus 5), `face/tests/gravit-md.test.ts`

The cycle contract's steps 2 to 5, replacing the current paragraph headed "Steps 2 to 5 — work in rounds." (the operator's approval of this plan approves this text):

> Steps 2 to 5 — work in rounds. Write THESIS.md and set status researching. The evidence is
> the Account's own: its markets, quotes, candles and history read through the seat
> (`mcp__account__portfolio_*`), AKShare for A shares, and a forward paper trade placed on the
> paper venue the operator granted — nothing is backtested, and no read is guarded against
> lookahead: a number you read today is today's. Read, trade on paper, wait for the fill and the
> statement, journal every result as a dated entry with the Account's own figures as returned and
> the order ids; a figure you did not read from a tool result is not evidence. Iterate while the
> falsification terms are undecided and the cap has room: 24 rounds. The round header reads
> Round: n/24; in round 24 with the terms undecided, write the researching verdict and tell the
> operator — the goal then blocks itself with round-limit and prompts you no more. Do not commit
> inside the rounds (a commit outside the sandbox fence raises a card and stalls the run); commit
> once with the verdict, or leave it to the operator.

Three sentences elsewhere change, verbatim:

- Step 0: "the bed and window, warmup moving the honest start; what the operator wants measured" → "the paper venue and the window the forward trade runs over; what the operator wants measured".
- "Blocking and asking", first sentence: "child-limit, bed-window, data-missing or needs-operator" → "venue-window, data-missing or needs-operator" (there is no child cap without roles).
- "Blocking and asking", third sentence: "the bed cannot cover the window asked" → "the venue cannot cover the window asked".

Steps 0, 1 and 6 are otherwise untouched.

`GRAVIT.md`'s shape (the implementer writes the sentences; these facts must be in it and nothing of the removed layer): the three layers — MARKET and ACCOUNT are the operator's Account through Gravit's seat (`mcp__account__*`, paper venues only) and AKShare (`mcp__akshare__*`) for A shares; STRATEGY is `strategies/`; Where things are (`strategies/<name>/` with `THESIS.md`, `journal.md`, `status.yaml`, `_template` the copy source; `roles/`, `bots/` the operator's); Reads (the seat's and AKShare's reads are seconds old and unguarded — there is no lookahead guard in this tree since 2026-10-24, by the operator's decision; evidence is forward paper trading on the Account's paper venue; the AKShare notes kept); A strategy directory (the lifecycle and naming rules kept; "paper" no longer reserved: it means a forward paper trade is running); Rooms (kept); The Account seat (kept, plus the owner line); Tests (`cd face && npm test`); Never edit (kept, minus `data/pit/`).

- [ ] **Step 1: Write the failing tests**: `cycle.test.ts` — the mounted section contains no `role_` and contains `forward paper trade`; `gravit-md.test.ts` — ≤ 4 500 bytes and contains neither `alpaca_kit` nor `replay_days` nor `data/pit`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Write** the two files.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=~/buyer-agent-demo npx tsx --test tests/cycle-smoke.test.ts` (if a cycle smoke exists; else the cycle test alone) — Expected: green.
- [ ] **Step 5: Commit** — "dsh: the research cycle reads the Account and trades on paper; GRAVIT.md without the beds"

### Task 8: The documents, the charter and the ledger

**Files:**
- Modify: `Gravit-Design.md` (the spec's §8 item 8, verbatim: §3's MARKET line and ACCOUNT line's first sentence, the diagram's MARKET and ACCOUNT cells and the alpaca_kit row, §4's `data/pit/` and `paper orders` rows removed and the honesty notes' Gate 1 / paper-hostname sentences, D3 closed "resolved 2026-10-24: there is no Gate 1 to arm", D8 rewritten to the one gate, §8's two rows removed, §6's departure line "Rules 1–5 of `docs/backtest-rules.md` left with the beds on 2026-10-24; no rule replaces them"; §2's P3/P4 paragraphs that name `replay_days` and the five rules rewritten to what remains — say the evidence is forward paper trading, the fidelity rule stands), `CLAUDE.md` (the "What this is" paragraph; the map's four `alpaca_kit` rows go, the `strategies/ · data/ · scripts/` row → `strategies/` alone, the `tests/ · face/tests/` row → `face/tests/`, `docs/` without `backtest-rules.md`, `roles/` without the three, `dsh/` without the two skills; Commands without pip/pytest/the MCP server; Gotchas without corp actions, `ALPHA_DATA_FEED`, RAW prices, backtests, the two-gates paragraph → one gate (the seat's) in two sentences; about 60 lines), `DEVELOPMENT.md` (§1 the system in one page; §2 removed whole; §3.1 the profile without the alpaca-kit row, §3.2 the skills, §3.3 `GRAVIT.md`, §3.4 the directory contract without the backtest files, §3.5 removed, §3.6 what Gravit can call, §3.8 the roles (none ship); §4.2 the module table without `data.ts`/`bars.ts`/`watchlist.ts`/`quote-streams.ts`, `quotes.ts`/`quote-snapshots.ts`/`symbol-search.ts` cn-only, `http.ts` with the fence; §4.4 without the producer and bars routes; §4.6 without the APCA/ALPHA/FACE_PYTHON rows; §4.7 Gate 2 the seat's alone; §5.1–§5.5 where they name the removed modules; §6 paths; §7.2 removed; §7.3 the tests; §7.4 the drills (the order-approval drill gone; Gate-2's drill reads the seat); §9 residuals (the keyed providers no longer idle — gone); §10 forward; Appendix A), `face/README.md` ("Markets and Account" without the provider table; "The face's own routes no screen reads" section removed; the profile section; the env table without APCA/ALPHA/FACE_PYTHON; `.env.alpaca` out of the start incantation with a note that `.claude/launch.json` (the operator's, untracked) may still carry it; the order-approval drill removed; the Gate-2 drill's words read the seat; the market-data renderers section), `ROADMAP.md` (the alpaca line), `Gravit-Docs-and-Prompt-Loops.html` (the Chinese page's lines naming `alpaca_kit`, the roles and `pytest`: the Commands line, the GRAVIT.md summary lines, the three `role-*` table rows, the `mcp-alpaca-kit` insert line, the §1/§2 summaries, the schema attribution line — each rewritten to what is; the page's structure untouched), `docs/superpowers/plans/2026-10-22-account-graft-ledger.md` (a stage-3 section: a line per task, the rulings, the deferred minors, the operator's `rm` owed, "The final tree of stage 3")
- Test: `face/tests/gravit-md.test.ts`; `cd face && npm test && npm run typecheck`

- [ ] **Step 1: Write** the documents — every removed name gone from them (`grep -rn "alpaca_kit\|alpaca-kit\|replay_days\|backtest-rules\|ALPACA_KIT_ENABLE_ORDERS\|data/pit\|FACE_PYTHON\|face_data\|face_bars" *.md face/README.md dsh/README.md Gravit-Docs-and-Prompt-Loops.html docs/superpowers/plans/2026-10-22-account-graft-ledger.md` finds only the history in the ledger and the specs/plans under `docs/superpowers/` and `docs/research/`, which are dated records and stay as written).
- [ ] **Step 2: Run** `cd face && npm test && npm run typecheck` — Expected: green.
- [ ] **Step 3: Commit** — "docs: stage 3 of the graft — the three components' exit in the charter, CLAUDE.md, DEVELOPMENT, the README and the loops page"

---

## Self-review notes

- Spec coverage: §12.1 every bullet (Tasks 1–6 and 8); §12.2 said in `GRAVIT.md`, the cycle and the charter (7, 8); §12.3 the roles (6), the cycle's text (7, approved with this plan), the beds and AQR (5 and the operator's `rm`); §12.4 the consequence line (7, 8); §12.5 the order (the task order), the drills re-run under `FACE_SMOKE` (each task runs the smokes it touches; the finish runs them all); §8 item 8 (8); §9 (8); §2's follow-up — the producers and keyed providers (1, 2); §11's "feat/desk will meet a wire no screen subscribes" is that branch's landing question, noted in the ledger.
- Calls made here: the fence moves to `http.ts`; the symbol-search route registers itself; `market-catalog.js` goes with `watchlist.ts`, its only reader; `channels.ts` already reads an optional `backtests/` (pinned, not changed); `SCRUBBED_ENV` keeps the two APCA names; the cycle's `bed-window` becomes `venue-window` and `child-limit` leaves with the 12-role-calls cap; `/data/` stays ignored until the operator's `rm`; `.claude/launch.json` is noted, not edited.
- Open to the builder: the plain tool-result path's exact markup; which tests read the shipped roles and how the fixture role is laid out; the loops page's Chinese wording.
- Proportion: the plan names paths, exact deletions and the pins; the one prose block it carries is the cycle's text, which the spec says this plan must draft.
