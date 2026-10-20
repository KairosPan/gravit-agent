# gravit-ui on the face — Design (route A)

**Status:** the operator's decision of 2026-10-19 ("先不用管Linqi那一版，先做完A。接好账户和交易所connector是后面的事，之后再做B"); the design calls below are mine, made because the operator chose to skip the questions ("按A做吧") — each is marked *call*, and each is reversible by a word.
**Inputs:** the settled front-end design `2026-10-09-demo-v2-gravit-frontend-design.md` (§1–§16, the boards), the fit analysis `docs/research/2026-10-19-gravit-ui-vs-face-backend-fit.md` (+ `.html`), `DEVELOPMENT.md` §4–§6 (the face as built), `Gravit-Design.md` (the charter; outranks everything here on intent).
**Pins:** main @ f6e7ca9 (face on dsh 0.2.0-rc.2), feat/gravit-ui @ 2418df7 (the pure front end, 264/264).

## 1. Intent

Replace `face/client` — the operator's chat face, market watchlist and account console — with gravit-ui, the settled design, as the face's one browser client. The back end is the face as it stands: dsh in-process (sessions, the approval and question channels, rooms, bots, presets), alpaca-kit through Gravit's tools, the `/data/*` routes. Nothing about what Gravit can do, what leaves the machine, or how an order is approved changes; this is a new face on the same body.

Why now: the operator wants the working tool to look and behave like the design they settled, and the fit analysis showed the core — conversations, the Gate 2 card, rooms — fits the face better than it fitted the demo it was drawn for (the card is real here).

## 2. Goals · non-goals · anti-goals

**Goals**
1. The operator opens `127.0.0.1:3090/?token=…` and gets gravit-ui: the two-level rail, Messages as the home, the conversation list fed by the host, a thread that is the session's real transcript, the composer that prompts the session.
2. Every gate the host raises reaches the operator as a card they can answer: an order (Gate 2) as the orange "Your call" card with exact arguments, any other approval as a generic card, an `ask_user_question` batch as a question card. No gate is lost or mis-drawn.
3. Rooms work: a channel session with bots on its roster shows the members, their answers in their own voice, the round lines, and the operator's `@`.
4. Markets and Account are real: the face's search, quotes and watchlist; the paper account's equity, positions and orders.
5. Discover becomes an honest inventory of what Gravit runs (MCP servers and their tools, bots, local CLI agents, skills), with the few runtime actions the face has (create a bot, roster it; connect a CLI).
6. The strategy layer survives the swap: a conversation is created in a channel, the list groups by channel, the channel's page is reachable.
7. Nothing on screen is a door that does not exist: every key does what it says on this back end.

**Non-goals (later rounds, by the operator's order)**
- Route B (Linqi's account server), the account and exchange connectors, Connect an account, multi-venue prices.
- The mandate layer (a per-conversation limit, Give a limit, End limit, spent-of-total) — no back end, and the charter's posture is one card per order.
- Hand trading from the UI (Trade's ticket, Cancel) — the only order path stays Gravit's tools behind the two gates.
- Memory (charter §7.3; DEVELOPMENT §10 item 16), Mail, the phone line, the morning brief, breaking news, monitor pushes — no producers exist.
- Perps, predictions, RWAs.

**Anti-goals (a failure even if it works)**
- A new door around Gate 1 or Gate 2 (an operator order route, an allow-always, a "Beast" mode).
- A screen that shows stand-in or scripted data as if it were the host's.
- Losing the operator's research view: tool calls and results, usage, the channel's artifacts must remain reachable.
- Any change to dsh's pins, rows or policy decisions (PLAN D1–D18) beyond what a route needs.

## 3. Constraints

- The charter: one operator, loopback only, no authentication machinery of the face's own, no memory substrate, nothing starts unattended, the two gates on the MCP tool surface.
- The product speaks English (front-end spec decision 10); host strings that are Chinese (quote provider messages) are not shown, their enums are.
- Screens carry no explanatory small print (decision 9). *Call:* host status is not small print — a muted one-line status under the composer (not signed in, reconnecting, a host error) and a muted stamp on stale data are allowed, because without them the page lies.
- Vanilla ES modules, no bundler, no framework (as both the old client and gravit-ui are); the face's `static.ts` serves the page; `npm test` in `face/` runs everything with `tsx --test`.
- dsh 0.2.0-rc.2's wire as `client/api.js` and `client/mapper.js` speak it; the frame fixture `face/tests/fixtures/events.jsonl` stays the contract.
- Cold sessions are paged, never followed (PLAN D16); the archive set stays face-local (D14).
- The gravit-ui tokens, radii, sizes and board states stay as the front-end spec fixed them (§3–§5, §13–§16); only what has no back end leaves the screens.

## 4. Where it lives (*calls*)

- **Branch:** `feat/gravit-face`, cut from main @ f6e7ca9, with `feat/gravit-ui` merged in (gravit-ui/ arrives as a directory; no conflicts expected outside docs). Worktree `.claude/worktrees/gravit-face`. PR #7 stays as the pure front end's record until this branch supersedes it.
- **Placement:** the client is `face/client/index.html` + `face/client/css/` + `face/client/js/` (gravit-ui's tree, moved). The old client's reusable modules move under `face/client/js/wire/` (`api.js`, `mapper.js`, `summaries.js`, `room.js`, `speaker.js`, `grouping.js`, `channelName.js`, `botId.js`, `markdown.js`, `render.js`, `market-quotes.js`, `market-model.js`, `market-search.js`, `account-model.js`) — unmodified where possible, their tests moved with them. The old `chat.js`, `channels.js`, `navigation.js`, `subagents.js`, `member-traces.js`, `answer-traces.js`, `botSettings.js`, `market.js`, `account.js`, `account-view.js`, `market.html`, `account.html`, `chat.css`, `market.css`, `account.css` are deleted at the stage that replaces them. `gravit-ui/` itself is removed from the tree once moved (its README's content folds into `face/README.md`).
- **Serving:** `static.ts` keeps `exact /` (gated) → `index.html` and `prefix /client` → the client directory; `index.html` references `/client/css/…` and `/client/js/app.js`; the `/market` and `/account` page routes are removed at stage 2. The `TYPES` table gains nothing the page does not ship (fonts come from Google Fonts, as the design has them; the G mark is CSS).
- **Tests:** gravit-ui's node:test suite and `tests/helpers/fake-dom.js` move to `face/tests/client/` and run under `tsx --test tests/*.test.ts tests/client/*.test.js`; the adapter's tests use the frame fixture; `client-mux-smoke` keeps proving `api.js` + `mapper.js` against a real boot. The static smoke (`static.test.ts`) learns the new paths.

## 5. The shape of the client

gravit-ui keeps its architecture — one store, pure reducers, render functions returning HTML, `data-action` delegation, hash routes — and gains a **host layer** between the wire and the store:

```
 browser
 ┌─ js/wire/api.js ── POST /api/<ns>/<method> · /api/remote.mux ($events · session/control · session/follow)
 ├─ js/wire/mapper.js ── frame → view (bubble · card · approval · question · gate-resolved · pulse · projection · room-line · subagent-message · turn)
 ├─ js/host/kinds.js ── view → gravit-ui message record (pure; the kind table of §6)
 ├─ js/host/sessions.js ── session/list row + channels.json → conversation record (pure)
 ├─ js/host/live.js ── the impure half: openMux, follow/page policy, list refresh, previews, gates, errors → store.dispatch(host*)
 ├─ js/host/actions.js ── data-action → Remote (send · command · say · answer · stop · rename · newMessage · …)
 ├─ js/host/data.js ── /data/* reads (channels, account, quotes, symbols, plugins, bots, agents, memory) with the stale stamp
 └─ store + reducers + render (gravit-ui as built), minus the scripted pieces
```

**State:** `conversations[]` is host-fed and never persisted; a conversation is `{id: sessionId, title, kind: 'gravit'|'bot'|'group', members[], channel: {workspaceId, name}, preset, running, cold, unread, archived, messages[], usage}`; a message carries `seq` (the host's) and `at` (the event's `time`). The store persists only per-viewer conveniences: `gravit-ui.theme`, the rail's collapse, `lastConv`, the market watchlist (the face's key `gravit.market.watchlist.v1`, so the old page's list carries over), the collapsed channel groups, and a `lastSeen` map (sessionId → seq) for the unread dot. No seed, no `SEED_VERSION`, no Reset demo.

**Reducers gain** (pure, tested): `hostList` (replace the conversation set, keep per-conversation windows), `hostWindow` (a follow snapshot or a page replaces a conversation's messages), `hostEvent` (append by `seq`, deduped; never dropped for a closed conversation), `hostReplace` (a compaction checkpoint's `{start, end}` removes that range), `hostGate` / `hostGateGone`, `hostProjection` (title, usage, room members, running), `hostStatus` (connection and error lines). The old `send`, `answer`, `stopGravit`, `rename` become optimistic hints only where the host echoes the result at once (a sent message is drawn on `user/message`, not before).

**Follow policy** = `chat.js`'s: the open conversation is followed when live (`agentAvailable`), paged when cold; a page becomes a follow when the operator writes to it or the host reports it live; a socket drop suspends follows and re-decides on `ready`; the room's member sessions are not followed in stage 1 (their answers arrive in the room's own log; their pulses are the loss). The list is re-fetched 1.2 s after `api-session/*`, `agent-preset/selected`, turn frames and gate settlements, as today.

## 6. The kind table (the heart of the adapter)

| host view | gravit-ui message | level | keys | notes |
|---|---|---|---|---|
| `bubble` role operator | kind `text`, from `you` | blue | — | `mention` kept for the room's `@` styling |
| `bubble` role gravit | kind `text`, from `gravit` | grey | — | **markdown rendered** (`wire/markdown.js`, DOM-built then serialized) — *call*: Gravit's research answers carry tables and code |
| `bubble` role bot (`bot`, `name`) | kind `text`, from the bot | grey | — | kind 15: the sender's name over the bubble; the room's `displayText` when it has one |
| `room-line` | from `system` (the centred line) | — | — | round ends |
| `turn` | — | — | — | drives `running`, the Working chip and the list refresh |
| `pulse` | a transient thinking row | grey | — | the three-dot row while a turn runs; the pulse text is not shown (*call*) |
| `approval` whose `toolName` ends in `__place_order` / `__cancel_order` | kind `card` ("Your call: buy 0.00008 BTC") | orange | ✗ ✓ | the arguments come from the `tool/call` event with the same `callId` on the follow stream (exact), the host line as the fallback; venue reads "Alpaca paper"; no "answer by" chip (the host has no deadline) |
| any other `approval` | kind `approval` (new) | orange | ✗ ✓ | tool name + `displayReason` (and `reason` when it differs); sandbox escalations and a bot's write live here |
| `question` | kind `question` (new) | orange | Answer | one card per batch: header, detail, options (single / multi), a free-text box when allowed; one Answer sends `{answers:[…]}` naming every question once |
| `gate-resolved` | marks the card | — | — | answered · approve/deny; closed; closed · no longer pending; closed · settled elsewhere — as the old client's four end states, drawn as the card's chip |
| `card` tool/call + tool/result | kind `tool` (new, collapsed) | grey | ▸ | one row per call: the tool's name (its `bash` command when it is one), opens to the result — the old `render.js` pretty renderers (snapshot table, bars chart, calendar, breadth/account tiles, generic table) and the raw `<pre>` always |
| `card` tool/result of `place_order` with `ok:true` | kind `receipt` | green | — | "Order accepted · buy 0.00008 BTC · market · <order id>"; a fill is read later from the account (stage 2 refreshes `/data/account.json` right after) |
| `card` tool/result with `isError` of a gated tool, or a `deny` | kind `refusal` | red | — | the host's own sentence verbatim |
| `subagent-message` / `agent-message` | from `system` | — | — | "Report from <child>: …", collapsed past two lines |
| `projection` title / tokenUsage / contextPressure / room / permissions | — | — | — | title → the row and head; usage → Details' Usage rows (*call*); room → the group head's members and the avatar cluster |
| anything the mapper calls `ignore` | — | — | — | nothing |

Kinds removed with their producers: 4 limit, 5 install, 6 proposal, 7 monitor, 12 brief, 13 breaking, 14 call, 16 alert (a red one-liner has no host marker; Gravit's text is text). Kind 11 (technicals) returns in stage 2 as the `daily_bars` tool row's chart.

## 7. The screens, stage by stage

### Stage 1 — the frame and Messages (replaces `/`)

- **Sign-in:** unchanged (`GET /?token=` → cookie); a 401 on any call shows the status line "Not signed in — open the URL gravit-face printed".
- **Rail:** Messages (with the count of conversations holding an unanswered gate as the badge, *call*), Markets and Account as links to the old `/market` and `/account` pages until stage 2 replaces them; Discover hidden until stage 3; Trade, the phone key and the mail key removed. Account's foot button shows "Account" alone until stage 2 brings the equity line.
- **List:** every non-member session, newest first (`updatedAt`); the row's avatar by kind (G, the bot's mark, the cluster); the preview from the session's last message once its window has been read (a non-activating `session/projections` + `session/page{maxMessages:1}` per visible row, cached and refreshed on activity, *call*); the unread dot from `lastSeen`; archived sessions hidden (a row action to archive comes in stage 3).
- **Head:** the avatar(s), the title, the members line for a room, the Working chip from `running`; Details toggles the drawer.
- **Thread:** the kind table of §6; time dividers after a 15-minute gap from the events' `time`; Escape and focus bookkeeping as built.
- **Composer:** text → `session/prompt` (queue, a client-minted `requestId`, the time zone); a `/` line → `commands/execute` first, then prompt if no command claims it; in a channel session a text carrying `@` → `POST /data/rooms/say` first; Send during a turn queues (the host's `queue` mode). The + (files) and the mic are removed in this stage (*call*: files need a session before the upload; nothing on either side sends them today). The empty state keeps its three suggestion chips as plain prompts.
- **Cards:** order, generic approval, question — answered through `api.js`'s `answer()` under the current generation; a second answer is refused; the end states drawn.
- **New message:** title, **Where** (a select of the channels from `/data/channels.json`, default the host's default directory = the `workbench` channel, *call*), the first message. The To: row lists the chosen channel's rostered bots as information (a group is what a channel with bots becomes); adding a bot to the roster is stage 3's. Sent = `session/create{workspaceId}` → `session/rename{title}` → `session/prompt`.
- **Details:** This task (title, created, channel, the preset), Members (the roster, for a room), Usage (input / output tokens, context pressure; *call*), Stop (= `session/cancel`, shown while running; a cancel during a goal round pauses the goal, and the status line says so with "/goal resume"), Rename (Change words). No limit, mode, wallet or Withdraw rows.
- **Status line:** connection (reconnecting…), not signed in, a host error (`api-session/error`), the command result's text.
- **Theme:** cream / black / system as built.
- **Removed:** the director, the driver, the seed, Reset demo, the banner, calls, Mail, the limit chips, Beast.

Done when: the operator can do a working session end to end on the real face — open, read a cold session, start a conversation in a channel, be asked a question, approve an order card raised by Gate 2 (the drill of `face/README.md` "The Gate-2 drill" rerun against the new page), see a room answer in the bot's voice and `@` a member — and `FACE_SMOKE=1 npm test` passes with the new static and client smokes.

### Stage 2 — Markets and Account (replaces `/market` and `/account`)

- **Markets:** tabs All · Crypto · Stocks (us and cn together; *call*: Stocks is widened rather than adding a cn tab), sort by Most traded / Biggest moves over the quote wire's `volume` and `change_pct` (cn volume is null and sorts last), search through `/data/symbols/search` with a follow-up `/data/quotes?ids=` for the hits, the list = watchlist ∪ holdings ∪ search hits (*call*: no "list the market" route exists), live quotes over `/data/quotes/stream` with `wire/market-quotes.js` (the polling fallback included) — quotes move, as the face's page has them move.
- **Market page** (`#/markets/<id>` with the face's id grammar `us:AAPL` / `crypto:BTC/USD` / `cn:600519`): price, change (vs previous close for stocks, 24h for crypto — labelled by the wire's `basis`), as-of and status; facts = previous close, volume, source; a 1d chart from a new route **`GET /data/bars?id=&days=`** (the face spawns `scripts/face_bars.py` over `alpaca_kit` daily bars for `us` ids — RAW bars, the bed when present, else Alpaca with keys; crypto and cn charts are hidden until a source exists; *call*); You hold and On the statement from `/data/account.json`; Gravit on it = the sessions whose title names the symbol (and `session/search` snippets when the Remote answers, *call*); keys: Hand to Gravit (opens New message with the words), Watch. No Buy/Sell, no venues, no bid/ask until the two-field wire change (left to the builder as optional).
- **Account:** Portfolio = net worth (`equity`), today (`equity − last_equity`), the allocation bar by `asset_class` plus cash, holdings (with `change_today`), the orders list bucketed by Alpaca status; Venues = one row "Alpaca paper · <host> · keys present/absent (`credentials/describe`) · orders registered yes/no (`orders_gate`)" plus the quote providers' state chips; Statement = filled orders with Export CSV (client-side); Settings = theme. Memory and Connect an account are not drawn (later rounds). The keyless state draws honestly ("No APCA keys in the environment"). The stale stamp when `stale:true`.
- **Removed:** `market.html`, `account.html`, their scripts and sheets, the two page routes, Trade (the screen and the rail item), `chat.css`.

### Stage 3 — Discover as inventory, channels, the research surfaces

- **Discover = My plugins:** shelves Data (MCP servers from `/data/plugins.json` with their tools), Bots (`/data/bots.json`), Agents (`/data/agents.json`: found / connected, Connect / Disconnect / Rescan), Skills (`/data/memory.json`, read-only); a plugin page per item (what it exposes; for a bot its SOUL, model and settings with the revision-checked save; "Talk to <bot>" opens or creates its home session). Create = a bot (name, description, soul → `POST /data/bots`). No shop, no counts, no review, no Create-MCP dialog.
- **Channels:** the list groups by channel (collapsible headers, the collapse local); a channel header opens the channel page (status headline, thesis, latest backtest, journal, files, the agent and bot rosters with their editors, New round); + New channel (`POST /data/channels`); New message's Where is this picker.
- **Row actions:** rename, fork, archive / un-archive, delete (not while running), as the old client.
- **Research surfaces:** the `tool` rows' renderers; the subagent dock in its minimal form (the child list with Stop; member traces read non-activating) — *call*: the full dock from `subagents.js` is kept as a later item if stage 3's budget runs out.

## 8. Back-end changes (all small, all inside the charter)

| Change | Where | Stage |
|---|---|---|
| `static.ts`: the page file and the client tree (paths only); the two page routes removed | `face/src/static.ts`, `static.test.ts` | 1, 2 |
| `GET /data/bars?id=&days=` — daily bars for a `us` id, through the existing fence, TTL cache and producer pattern (`face_data.py`'s shape) | `face/src/data.ts`, `scripts/face_bars.py`, tests | 2 |
| (optional) bid/ask on the quote wire from the Alpaca snapshot's `latestQuote` and Coinbase's ticker | `quote-snapshots.ts`, `quote-types.ts` | 2 |
| nothing else: no order route, no approval policy, no scheduler, no MCP server | | |

## 9. What stays the builder's

- The exact module boundaries inside `js/host/` and how the optimistic hints are kept honest.
- The preview strategy's limits (how many rows read at once; a budget, not a design).
- The question card's layout for long batches; the generic approval card's wording.
- Whether `render.js`'s renderers are ported to string-returning functions or mounted as DOM nodes after render.
- The `face_bars.py` producer's cache and window.
- The order of deletions within a stage, as long as every commit leaves `npm test` green and the face bootable.

## 10. Risks named

- The follow/page policy is the one piece of real behaviour the old client earned through drills; it moves over as logic, and the transport drill (`face/README.md`) is rerun at the end of stage 1.
- The kind table hides process by design; stage 1's `tool` rows and Details' Usage are the minimum that keeps the research view; if the operator misses more, it is a kind-table change, not an architecture one.
- Rooms depend on channel rosters the new UI only shows until stage 3; a group chat is therefore started from an existing channel with bots in stage 1.
