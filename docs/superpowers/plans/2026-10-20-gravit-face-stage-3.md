# gravit-ui on the face, stage 3 — Discover, channels, row actions, the research surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover lists what Gravit actually runs — MCP servers and their tools, bots, the local CLI agents and Gravit itself, skills — with the face's few runtime actions; the conversation list groups by channel and every channel has its page; a conversation can be forked, archived, un-archived and deleted; tool results draw as tables and charts; a conversation's subagent children can be stopped and a room member's trace read; the demo's last pieces leave the tree.

**Architecture:** The old client's pure modules (grouping, channel names, bot ids, bot settings, the subagent catalog, the member trace loader) move under `js/wire/` with their words in English. New host layers (`host/channels.js`, `host/discover.js`, `host/traces.js`) and additions to `host/live.js` and `host/actions.js` read the `/data` routes and the Remotes into reducers; pure view modules (`host/list-view.js`, `host/discover-view.js`, `host/children-view.js`) turn the slices into what the screens draw; the renderers stay gravit-ui's strings and classes. The old DOM tool renderers (`js/wire/render.js`) are ported to strings (`render/tool-result.js`) and deleted.

**Tech Stack:** vanilla ES modules in the browser (no bundler), Node 22 + `node:test` via `tsx --test`, the face's TypeScript routes unchanged.

**Spec:** `docs/superpowers/specs/2026-10-19-gravit-ui-on-face-design.md` — §7 "Stage 3", §2 (goals 5–7, the anti-goals), §3, §4 (the module moves and deletions), §5 ("State"), §6 (the `card` row's renderers), §9. The look is `docs/superpowers/specs/2026-10-09-demo-v2-gravit-frontend-design.md` §7 and §13–§16, minus what route A leaves out. Stages 1–2: `docs/superpowers/plans/2026-10-19-gravit-face-stage-1.md`, `docs/superpowers/plans/2026-10-20-gravit-face-stage-2.md`, and their rulings in `docs/superpowers/plans/2026-10-19-gravit-face-ledger.md` (this stage appends its own section there).

## Global Constraints

- The product speaks English. Host strings that are Chinese are never drawn; the moved wire modules carry no Chinese at all. The operator's own data — a bot's or channel's name, a soul, a thesis, a journal — is drawn as written (spec §3).
- No explanatory small print. Allowed: the status line, a stale stamp, a tool result's muted `Partial` stamp, the muted state words (`Loading…`, `Running`, `Not running`) (spec §3 *call*).
- No new door (spec §2): Discover has no Install, Uninstall, Publish, shop, price, install count, review or Create-MCP dialog; nothing edits a bot's allow-list; no order route.
- The only writes this stage adds: `POST /data/bots`, `/data/bots/settings`, `/data/channels`, `/data/channels/agents`, `/data/channels/bots`, `/data/sessions/archive`, `/data/sessions/delete`, `/data/agents/connect`, `/data/agents/disconnect`, `/data/agents/rescan`; the Remotes `session/fork`, `session/create` (Talk to) and `subagents/interruptByParent`. No back-end change.
- Every untrusted string — Gravit-written channel files, bot souls and reasons, skill content, tool results, host error words — goes through `esc` or the DOM-built markdown (`wire/markdown.js`); never raw HTML.
- Cold sessions are never activated by a read (PLAN D16): the subagent catalog comes from projections the list already carries, member traces read `session/projections` then `session/page`, the channel overview is a `/data` read.
- `/data/sessions/archive` always carries an explicit boolean `archived`; the face's archive set stays face-local (D14).
- The per-viewer prefs (`gravit-ui.prefs`) gain `collapsed: {[groupKey]: boolean}`; nothing else new is persisted.
- Deleted at the stage that replaces them (spec §4): `face/client/channels.js`, `face/client/answer-traces.js`, `face/client/js/wire/render.js`, the demo Discover (`js/data/plugins.js`, its reducers), Mail, the memory slice, the seed fixture.
- Every commit leaves `npm test --prefix face` green and `npm start` bootable. No push. Commit messages through `git commit -F <file>`.

## Review Focus

1. **Archived conversations** are never the conversation opened by default — at boot, after Cancel, from the rail's Messages key, after a delete — yet open by their own id; only a face archive offers Un-archive — pinned in Tasks 2 and 3.
2. **A conversation deleted or archived while it is open**, in this tab or another: the page moves to the first open conversation and the live layer stops reading the old one; a running conversation offers no Delete or Archive and the action refuses it anyway — pinned in Task 3.
3. **Markup in untrusted text** (`<img src=x onerror=alert(1)>`, `<script>`) in a thesis, journal entry, file name, status field, soul, skill, tool description or tool result stays text — pinned in Tasks 5, 8 and 11.
4. **A stale bot revision** (another tab or the operator's editor saved first): the save is refused as `Changed elsewhere`, the bot is re-read, and the editor's boxes show the new revision's values, not the stale typing — pinned in Task 9.
5. **Partial reads**: a failed `/data/channels.json` or `/data/sessions-meta.json` read keeps the last good answer (the groups never blank, nothing is un-archived by a failure); a failed Discover listing marks its own shelf only — pinned in Tasks 2 and 7.

## Calls this plan makes

Each goes to the ledger as a ruling when its task lands, with what it costs if wrong.

- `botSettings.js`, `subagents.js` and `member-traces.js` move under `js/wire/` with their words in English instead of being deleted (spec §4 lists them for deletion): their decisions are pure and were earned in drills — the 0.2 catalog composition, the non-activating trace read, the revision-checked payload. `subagentControls` returns a state enum and loses its `note` sentences. `channels.js` and `answer-traces.js` (DOM) are deleted, replaced by string renderers.
- `wire/render.js` is ported to string renderers and deleted (spec §9 leaves the choice). Only `mcp__alpaca-kit__<tool>` names are dressed: another server's `account` is not Alpaca's.
- Archived conversations stay in the store and draw under an **Archived** group at the list's end, collapsed by default. The host's archive (`channels.json` `archived`) and the face's (`sessions-meta.json` `archived`) both archive; only the face's can be un-archived (the route refuses the host's with a 409).
- Groups: one per channel in `/data/channels.json` (an empty channel included, so a new channel's page is reachable), the root first, then by each group's newest conversation, empty groups by name; a bot's home sessions under the bot (grouping.js's rule); sessions in no channel under **No channel**; Archived last. A collapsed group still shows the conversation on screen. The old page's `face.collapsed-groups` key is not carried over.
- **New channel** is an option in New message's Where picker that opens an inline name editor (the spec's words); the list head keeps one key.
- The channel page is `#/channel/<workspaceId>` and is part of Messages (the list stays beside it, Messages stays current); its header in the list links to it.
- Discover's ids are namespaced — `mcp:<server>`, `bot:<id>`, `agent:gravit`, `agent:<bin>`, `skill:<name>`. `#/plugin/<id>` and `#/channel/<id>` take everything after the screen, decoded, as `#/markets/` does.
- **Create a bot** is a page, `#/discover/create`, not a modal.
- **Talk to <bot>** opens the bot's newest non-archived home conversation, else creates one (`session/create {request: {cwd: bot.homeCwd, agentPreset: bot.id}}`); a `broken` or unlisted bot offers no Talk to.
- The subagent dock is a **Children** section in Details: label, mode, state, and Stop (two-step) on a running continuable child. Reading a child's transcript and prompting it stay later items (the spec's own *call*).
- A room member's answer opens its **Trace** under the bubble, read non-activating; its tool rows draw with the same renderers.
- The **Gravit** item on Agents is the old main-agent page: model (provider, model, effort from `session/modelCatalog`'s `default`), host (cwd, home, attached sessions, dsh version from `/data/host.json`) and keys (`DEEPSEEK_API_KEY`, `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY` present or absent, from `credentials/describe`), each card failing alone.
- A soul and a skill's content draw as escaped pre-wrapped text, not markdown; a thesis draws as markdown (Gravit writes it as markdown).

---

### Task 1: The old client's pure modules move under `js/wire`, in English

**Files:**
- Move (`git mv`): `face/client/{grouping,channelName,botId,botSettings,subagents,member-traces}.js` → `face/client/js/wire/`
- Modify: `js/wire/member-traces.js` (imports `./mapper.js`; its eight error words in English), `js/wire/subagents.js` (the default label `Subagent`; the catalog error `The subagent catalog is unavailable: the host returned an invalid record.`; `subagentControls` as below)
- Test: `face/tests/{grouping,room-client,channelName,botId,bot-settings-client,subagents,member-traces}.test.ts` (import paths; English expectations), `face/tests/client/wire-words.test.js` (new)

**Interfaces:**
- Produces: `js/wire/grouping.js` (`ARCHIVED_KEY`, `UNGROUPED_KEY`, `BOT_KEY_PREFIX`, `isBotKey`, `bucketFor(channel, archived, bot, member=false)`), `channelName.js` (`foldChannelName`), `botId.js` (`proposeBotId`), `botSettings.js` (`normalizeBotModel`, `botModelChoices`, `draftBotSoul`, `botToolLabel`, `botSettingsPayload`), `subagents.js` (`isSubagentRow`, `normalizeSubagentCatalog`, `composeSubagentCatalog`, `subagentAddress`, `subagentResult`, and `subagentControls(row, parentAvailable, waiting=false) → {canRead, canPrompt, canInterrupt, state: 'unavailable'|'waiting'|'running'|'inactive'|'unknown', reason?}` — no `note`), `member-traces.js` (`loadMemberTrace(call, {sessionId, turn}) → Promise<FrameView[]>`).
- The trace errors: `This answer recorded no member turn.` · `The member session does not exist.` · `The trace's history is malformed.` · `No trace was found for this answer's turn.` · `The trace's history stopped loading; try again.` · `This answer's turn is incomplete; its trace cannot be read yet.`

- [ ] **Step 1: Write the failing tests** — the seven suites import from `../client/js/wire/`; subagents: `"subagentControls returns a state enum and no note"` (`running`, `inactive`, `unknown`, `waiting`, `unavailable` with its `reason`), the label default `Subagent`; member-traces: each error case asserts its English words; wire-words: `"the moved wire modules carry no Chinese"` — the six files' source never matches `/[㐀-鿿]/`.
- [ ] **Step 2: Run them** — `npx tsx --test tests/grouping.test.ts tests/room-client.test.ts tests/channelName.test.ts tests/botId.test.ts tests/bot-settings-client.test.ts tests/subagents.test.ts tests/member-traces.test.ts tests/client/wire-words.test.js`. Expected: FAIL (modules not found).
- [ ] **Step 3: Move and translate.**
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS; `ls face/client/*.js` → `market-catalog.js` and `answer-traces.js`, `channels.js` only.
- [ ] **Step 5: Commit** — "client: the old client's pure modules move under js/wire, in English".

### Task 2: The list keeps archived conversations, subagent children and the last good facts

**Files:**
- Modify: `face/client/js/host/sessions.js`, `face/client/js/host/live.js` (`refresh`), `face/client/js/reducers/host.js` (`hostList`, `hostProjection`), `face/client/js/reducers/messages.js` (`nav`, `cancelDraft`), `face/client/js/render/rail.js` (the Messages key), `face/client/js/app.js` (the boot open), `face/client/js/data/empty.js` (`childRows: []`)
- Test: `face/tests/client/sessions.test.js`, `live.test.js`, `host-reducers.test.js`, `reducers.test.js`, `rail.test.js`, `app-dom.test.js`

**Interfaces:**
- `conversationOf(summary, ctx, fold)` gains `archived: false|'host'|'face'` (`ctx.hostArchived` first, then `ctx.archived`). `listConversations(items, ctx)` keeps archived conversations; it still drops room members, `origin` rows and `ctx.deleted`.
- `childRowsOf(items) → Array<{sessionId: string, parentSessionId: string|undefined, running: boolean, origin: 'subagent'}>` — the raw rows with `origin: 'subagent'` (`isSubagentRow`).
- `firstOpen(conversations) → conv|null` — the first conversation with `archived === false`.
- `refresh()` reads `session/list`, `/data/channels.json`, `/data/bots.json` and `/data/sessions-meta.json` together; channels.json and sessions-meta each keep their last good answer when a read fails (never an empty set in place of a failure); a channel row in the store is `{workspaceId, name, title, dir, isRoot, missingDir, sessionIds}`; `hostList({conversations, channels, bots, childRows})`.
- `hostList` stores `childRows` and keeps `subagentCatalog` among a surviving conversation's fields; `hostProjection` takes `subagentCatalog` (any value; the view validates it).
- `nav`'s missing-id fallback, `cancelDraft`, the rail's Messages key and app.js's open-when-nothing-is-on-screen use `firstOpen`; an archived conversation still opens by its id.

- [ ] **Step 1: Write the failing tests** — sessions: `"archived conversations stay, marked host or face; deleted ones, children and members leave"`, `"childRowsOf keeps the subagent rows with their parent"`, `"firstOpen skips archived conversations"`; live: `"refresh reads sessions-meta; a failed channels or sessions-meta read keeps the last good answer"`, `"the subagentCatalog projection reaches the conversation"`; host-reducers: `"hostList keeps a conversation's subagentCatalog and stores the child rows"`; reducers: `"nav to a missing id and Cancel open the first open conversation, never an archived one"`; rail: `"the Messages key never points at an archived conversation"`; app-dom: `"boot opens the newest open conversation when the newest is archived"`.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/sessions.test.js tests/client/live.test.js tests/client/host-reducers.test.js tests/client/reducers.test.js tests/client/rail.test.js tests/client/app-dom.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** The list's rows are unchanged until Task 4 draws the groups: archived rows are filtered out of `renderList` here.
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: the list keeps archived conversations, subagent children and the last good facts".

### Task 3: Row actions — fork, archive, un-archive, delete

**Files:**
- Modify: `face/client/js/host/actions.js`, `face/client/js/render/messages.js` (`renderDetails`), `face/client/js/app.js` (data-actions; `confirmYes`; the subscribe), `face/client/css/app.css`
- Test: `face/tests/client/actions.test.js`, `messages-screen.test.js`, `app-dom.test.js`, `css.test.js`

**Interfaces:**
- `fork(sessionId) → Promise<string|null>` — `session/fork {request: {sessionId}}` → its `sessionId`; one in flight per source (a second press sends nothing); failure → status `fork: <code>`.
- `archive(sessionId, archived: boolean) → Promise<boolean>` — `POST /data/sessions/archive {sessionId, archived}`; refuses without a call while the conversation runs or a gate waits on it; a 409's words reach the status line.
- `remove(sessionId) → Promise<boolean>` — `POST /data/sessions/delete {sessionId}`; refuses without a call while the conversation runs (status `Stop Gravit first`).
- After a success: `live.refresh()`; a fork opens the new conversation; archiving or deleting the conversation on screen opens `firstOpen`. After every `hostList`, a messages route whose conversation left the list opens `firstOpen` (a delete in another tab).
- Details, under This task: `Change words`, `Fork`, `Archive` — or `Un-archive` for a face archive — and `Delete` (confirm `Yes, delete`); no Archive or Delete while running or while a gate waits; a host archive shows the fact `Archived · By the host` and no key. Data-actions `fork`, `archive`, `unarchive`, `deleteConv` (each `data-conv`); the confirm action `deleteConv`.

- [ ] **Step 1: Write the failing tests** — actions: `"fork returns the new id; a second press while one is in flight sends nothing"`, `"archive and un-archive post the explicit boolean"`, `"archive refuses a running conversation or one with a waiting gate without calling"`, `"delete posts; a running conversation is refused without calling"`, `"a 409 on un-archive puts the route's words on the status line"`; messages-screen: `"Details offers Fork, Archive and Delete on an idle conversation"`, `"no Archive or Delete while running or while a card waits"`, `"a face archive offers Un-archive; a host archive says so and offers nothing"`; app-dom: `"Fork opens the new conversation"`, `"Delete asks first, then the page moves to the first open conversation"`, `"a conversation deleted elsewhere leaves the screen at the next list"`; css: Details with the new keys.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/actions.test.js tests/client/messages-screen.test.js tests/client/app-dom.test.js tests/client/css.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: fork, archive, un-archive and delete a conversation".

### Task 4: The list groups by channel

**Files:**
- Create: `face/client/js/host/list-view.js`
- Modify: `face/client/js/render/rail.js` (`renderList`), `face/client/js/reducers/messages.js` (`toggleGroup`), `face/client/js/app.js` (`prefsOf`/`initialState` carry `collapsed`; data-action `toggleGroup`), `face/client/js/data/empty.js` (`collapsed: {}`), `face/client/css/app.css`
- Test: `face/tests/client/list-view.test.js` (new), `rail.test.js`, `app.test.js`, `app-dom.test.js`, `css.test.js`

**Interfaces:**
- `groupsOf(state) → Array<{key: string, label: string, kind: 'channel'|'bot'|'none'|'archived', workspaceId: string|null, conversations: conv[], collapsed: boolean}>` — `bucketFor(conv.channel, conv.archived !== false, conv.kind === 'bot' ? {id: conv.preset, label: botName} : null)`; labels: the channel's `title` (else `name`), the bot's name, `No channel`, `Archived`; collapsed = `state.collapsed[key]` when set, else `true` for Archived and `false` otherwise; the order of the calls above.
- `toggleGroup(s, key)` flips `collapsed[key]`.
- The list: the draft row first; per group a header — `<div class="grp-head">` with a collapse key (`data-action="toggleGroup" data-key`, `aria-expanded`, `aria-label` `Collapse <label>` / `Expand <label>`) and, for a channel, the name as a link to `#/channel/<workspaceId>` (else the name as text) — then its rows; a collapsed group shows only the conversation on screen.

- [ ] **Step 1: Write the failing tests** — list-view: `"every channel is a group, an empty one included, the root first, then by the newest conversation"`, `"a bot's home sessions group under the bot; sessions in no channel under No channel; Archived last and collapsed by default"`, `"a collapsed group keeps the conversation on screen"`; rail: `"a header per group with its collapse key and its channel link"`, `"group and channel names are escaped"`; app: `"the prefs carry collapsed"`; app-dom: `"collapsing a group hides its rows and the prefs remember it"`; css: the groups, one collapsed.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/list-view.test.js tests/client/rail.test.js tests/client/app.test.js tests/client/app-dom.test.js tests/client/css.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: the list groups by channel, collapsible, archived last".

### Task 5: The channel page

**Files:**
- Create: `face/client/js/host/channels.js`, `face/client/js/render/channel.js`, `face/client/js/reducers/channels.js`
- Modify: `face/client/js/reducers/index.js`, `face/client/js/router.js` (`channel`; the `plugin` id as the rest of the path, decoded), `face/client/js/reducers/messages.js` (`startDraft` takes `{where}`), `face/client/js/app.js` (`SCREENS` gains `channel`; entering a channel page reads its overview; data-action `newRound`), `face/client/js/render/rail.js` (the list on the channel screen too; Messages current there), `face/client/js/data/empty.js` (`channel: {id: null, status: 'idle', data: null, at: null}`), `face/client/css/app.css`
- Delete: `face/client/channels.js`
- Test: `face/tests/client/channel.test.js`, `host-channels.test.js` (new), `app.test.js`, `app-dom.test.js`, `rail.test.js`, `css.test.js`

**Interfaces:**
- `startChannels({store, postJson, getJson, refresh}) → {overview(workspaceId): Promise<void>}` (Task 6 adds the writes) — `POST /data/channels/overview {workspaceId}` → `channelLoaded({workspaceId, data, at})`; a failure → `channelFailed({workspaceId, at})`, which keeps the data it had for that id; a sequence number so only the latest-started read lands.
- Reducers `channelLoading(s, {workspaceId})`, `channelLoaded`, `channelFailed`.
- `renderChannelScreen(state, now) → string`: `<main class="main chan">`; the head — the channel's name, the status chip (`status.status`), `status.one_line` as the headline, `Next: <status.next>`, `status.numbers` as key-value rows; **Thesis** through the thread's markdown renderer (`No thesis yet` when `isTemplate` or absent); **Latest backtest** — the file name and up to 12 of its top-level scalar fields; **Backtests** — file and size; **Journal** — date and text, newest first, the last 20; **Files** — name, size, date; **Agents** and **Bots** — the rostered names; the `New round` key (`data-action="newRound"`, `data-id`). States: `Loading…`; `Channel unavailable` with Retry; `Channel not found` once the list holds no such channel.
- `newRound` → `startDraft({where: workspaceId})` and New message.

- [ ] **Step 1: Write the failing tests** — channel: `"the page draws the status headline, thesis, latest backtest, backtests, journal, files and rosters"`, `"a template thesis reads No thesis yet"`, `"markup in every field stays text"` (`<img src=x onerror=alert(1)>` in the status, numbers, journal, file names and a backtest field; the thesis through the real `renderMarkdown` under `withMiniDocument`): the HTML never contains `<img`; `"loading, unavailable with Retry, not found"`; host-channels: `"overview posts the workspace id and lands"`, `"a later read for another channel wins over an earlier one"`, `"a failed read keeps the last data and reads failed"`; app: `parseHash('#/channel/ws-1')` → `{screen: 'channel', id: 'ws-1'}` and `toHash` writes it back; `parseHash('#/plugin/skill%3Arules')` → id `skill:rules`; app-dom: `"a channel header opens its page and reads its overview once"`, `"New round opens New message with Where on the channel"`; rail: the list beside the channel page, Messages current; css: the page in each state.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/channel.test.js tests/client/host-channels.test.js tests/client/app.test.js tests/client/app-dom.test.js tests/client/rail.test.js tests/client/css.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**; delete `face/client/channels.js` (`grep -rn "client/channels.js" face` → empty).
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: the channel page — status, thesis, backtests, journal, files, rosters, New round".

### Task 6: The rosters and New channel

**Files:**
- Modify: `face/client/js/host/channels.js`, `face/client/js/render/channel.js` (the roster editors), `face/client/js/render/messages.js` (Where), `face/client/js/reducers/controls.js` (`editFailed`), `face/client/js/app.js`, `face/client/css/app.css`
- Test: `face/tests/client/host-channels.test.js`, `channel.test.js`, `messages-screen.test.js`, `app-dom.test.js`, `css.test.js`

**Interfaces:**
- `create(name) → Promise<{workspaceId}|{error}>` — `foldChannelName(name)`; a name failing `/^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,40}$/u` or equal to `_template` is refused before any post with `{error: 'Letters, digits, - or _'}`; `POST /data/channels {name}` → `{name, dir, isRoot}`; then `refresh()` and the new channel's `workspaceId` matched by `dir`; a route error → `{error: <its words>}`.
- `agentChoices() → Promise<Array<{bin, label}>>` — `/data/agents.json`'s connected, found `local` rows.
- `setAgents(workspaceId, bins) → Promise<boolean>` — `POST /data/channels/agents {workspaceId, agents: bins}`; `setBots(workspaceId, ids) → Promise<boolean>` — `POST /data/channels/bots {workspaceId, bots: ids}`, more than six refused before the post; each re-reads the overview on success.
- `editFailed(s, {error})` keeps the editor open with its error.
- Where: the channels, then `New channel…` (`value="__new"`); choosing it opens the edit `{kind: 'newChannel'}` (one box, `Name the channel`); ✓ creates and selects the new channel; × returns Where to the channel it held.
- The channel page: `Edit` on Agents and on Bots opens `{kind: 'roster', which: 'agents'|'bots', workspaceId}` — a checkbox per choice (the connected agents; every bot in the overview's `allBots`), ticked as rostered, the seventh bot box disabled while six are ticked; ✓ saves, × cancels.

- [ ] **Step 1: Write the failing tests** — host-channels: `"create folds the name, posts it and finds the new channel by its dir"`, `"an invalid name or _template is refused before any post"`, `"setAgents and setBots post and re-read the overview; a seventh bot is refused"`; channel: `"the roster editors tick what is rostered, offer the connected agents and every bot, and stop at six bots"`; messages-screen: `"Where offers New channel…; the edit asks for the name"`; app-dom: `"New channel… creates the channel and selects it in Where"`, `"the bots editor posts the ticked ids"`; css: both editors.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/host-channels.test.js tests/client/channel.test.js tests/client/messages-screen.test.js tests/client/app-dom.test.js tests/client/css.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: a channel's agent and bot rosters, and New channel in Where".

### Task 7: Discover's host layer and views

**Files:**
- Create: `face/client/js/host/discover.js`, `face/client/js/host/discover-view.js`
- Modify: `face/client/js/reducers/discover.js` (the host reducers beside the demo's, which leave in Task 8), `face/client/js/data/empty.js` (the `discover` fields below)
- Test: `face/tests/client/discover-view.test.js`, `host-discover.test.js` (new)

**Interfaces:**
- State: `discover.query`, `discover.shelves: {plugins, bots, agents, memory}`, each `{status: 'idle'|'loading'|'ready'|'failed', data, at}`; `discover.gravit: {host, model, keys}` (each `null` until read, `false` when its read failed); `discover.skills: {[name]: {status, detail}}`; `discover.status: {line, bad}|null` (Discover's own line).
- Reducers: `setDiscoverQuery(s, q)`, `shelfLoading(s, {shelf})`, `shelfLoaded(s, {shelf, data, at})`, `shelfFailed(s, {shelf, at})` (keeps `data`), `gravitLoaded(s, {host, model, keys})`, `skillLoading`, `skillLoaded(s, {name, detail})`, `skillFailed(s, {name})`, `discoverStatus(s, {line, bad})`.
- `startDiscover({store, getJson, postJson, call}) → {load(), gravit(), skill(name), connect(bin), disconnect(bin), rescan()}` — `load` reads `/data/plugins.json`, `/data/bots.json`, `/data/agents.json` and `/data/memory.json`, each alone, one flight each; `gravit` reads `/data/host.json`, `session/modelCatalog {}` and `credentials/describe {refs: ['DEEPSEEK_API_KEY', 'APCA_API_KEY_ID', 'APCA_API_SECRET_KEY']}`, each alone; `skill` posts `/data/memory/skill {name}` once per name; `connect` / `disconnect` post `{bin}` and `rescan` posts `{}`, then the agents shelf is re-read (rescan's answer is the listing itself); a failure's words go to `discoverStatus`.
- `itemsOf(discover) → {data: Item[], bots: Item[], agents: Item[], skills: Item[]}`, `Item = {id, shelf, name, line, mark: {type: 'letter'|'glyph', text?, icon?}, kind}`: an MCP server → `mcp:<server>`, line `<n> tools`; a bot → `bot:<id>` (the default `isDefault` bot is not an item), line its description; Gravit → `agent:gravit` first, line the main row's `runtime`; a connected local agent → `agent:<bin>`, line `Connected` or `Not found`; a candidate → `agent:<bin>`, line `Found · <version>`; a skill → `skill:<name>`, line its description. `searchItems(items, q)` over name and line; `itemById(discover, id) → Item|null`.

- [ ] **Step 1: Write the failing tests** — discover-view: `"MCP servers become Data items with their tool counts; the default bot is not a Bot item"`, `"Agents: Gravit first, then the connected agents, then the found candidates"`, `"skills from every group"`, `"search matches name and line across the shelves"`, `"ids are namespaced and itemById finds each"`; host-discover: `"load reads the four listings once each; one failing marks only its shelf and keeps its data"`, `"gravit reads the host, the model catalog and the three keys, each alone"`, `"skill reads its content once"`, `"connect posts the bin and re-reads the agents; a 404 puts its words on Discover's line"`.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/discover-view.test.js tests/client/host-discover.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: Discover's host layer and views over the face's inventory".

### Task 8: Discover on screen; the demo shop leaves

**Files:**
- Rewrite: `face/client/js/render/discover.js`, `face/client/js/reducers/discover.js` (the demo reducers leave)
- Modify: `face/client/js/render/rail.js` (Discover in the first level, current on Discover and plugin pages), `face/client/js/router.js` (shelves `data`, `bots`, `agents`, `skills`; `create`), `face/client/js/reducers/messages.js` (`nav` keeps an unknown plugin id; `closeOverlays` loses `discover.create`), `face/client/js/render/avatars.js` (no catalogue: a bot's letter from `state.bots`), `face/client/js/app.js` (`SCREENS` gains `discover`, `plugin`; entering Discover or a plugin page runs `load` once per visit, a Gravit page `gravit()`, a skill page `skill(name)`; data-actions `dq` (input `#dq`), `shelfRetry` (`data-shelf`), `connectAgent`, `disconnectAgent` (`data-bin`), `rescanAgents`), `face/client/js/data/empty.js` (the demo `discover` fields leave), `face/client/css/app.css`
- Delete: `face/client/js/data/plugins.js`
- Test: `face/tests/client/discover.test.js` (rewritten), `rail.test.js`, `app.test.js`, `app-dom.test.js`, `css.test.js`

**Interfaces:**
- `renderDiscover(state) → string` — `#/discover`: h1 `Discover`, the search box (`#dq`, placeholder `Search`), the `Create a bot` key (`#/discover/create`); shelves **Data**, **Bots**, **Agents**, **Skills**, each with `See all` and its cards (mark, name, one line, the kind tag); a failed shelf `Couldn't read <Shelf>` with Retry; a loading one `Loading…`; empty: `No MCP servers`, `No bots yet`, `No agents`, `No skills`. With a query, one grid of the matches. `#/discover/<shelf>`: that shelf as a grid with `‹ Discover`.
- `renderPlugin(state) → string` — `#/plugin/<id>`: `‹ Discover`, the head (mark, name, kind); by kind — **MCP**: State (`Pending`, `Loading`, `Active`, `Failed`, `Unloading`, `—`), Tools (name and description each); **bot**: Model (its route or `Default`), Description, Soul, Home, Skills, Setup issues and `Can't run · <broken>` when present (Task 9 adds its keys); **agent**: Version, Signed in (`ok` → `Signed in`, `none` → `Not signed in`, else `Unknown`), Tool, and `Connect` (a candidate) or `Disconnect` (connected); **Gravit**: Model (provider, model, effort), Host (cwd, home, attached sessions, version), Keys (`Present` / `Absent` per ref), each card `Couldn't read` alone on failure; **skill**: Group, Description, Content (`Loading…` until read). An unknown id: `Loading…` while its shelf loads, `Not found` after.

- [ ] **Step 1: Write the failing tests** — discover: `"the shelves draw from the host's listings, with See all and Create a bot"`, `"a failed shelf says so with Retry and leaves the others drawn"`, `"a query draws one grid of matches"`, `"an MCP page lists its tools with their descriptions"`, `"a bot page: model, description, soul, home, skills, setup issues"`, `"an agent page: version, sign-in, Connect for a candidate and Disconnect for a connected one"`, `"the Gravit page: model, host and keys, a failed card alone"`, `"a skill page shows Loading… then its content"`, `"no Install, Uninstall, Publish, review, installs, price or shop"`, `"markup in a soul, a skill, a tool description and a reason stays text"`; rail: Discover in the first level and current on Discover and plugin pages; app: `#/discover/agents`, `#/discover/create`, `#/plugin/agent:gravit` route as they read; app-dom: `"entering Discover reads the four listings once"`, `"Connect on a found agent posts its bin and the shelf re-reads"`; css: every Discover state.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/discover.test.js tests/client/rail.test.js tests/client/app.test.js tests/client/app-dom.test.js tests/client/css.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**; delete the demo shop (`grep -rn "data/plugins.js\|SHOP_MCP\|likeFor" face/client face/tests` → empty).
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: Discover lists what Gravit runs; the demo shop leaves".

### Task 9: Talk to a bot, its settings, Create a bot

**Files:**
- Modify: `face/client/js/host/discover.js` (`modelChoices`, `saveBot`, `createBot`), `face/client/js/host/actions.js` (`talkTo`), `face/client/js/render/discover.js` (the bot keys and editor; the Create page), `face/client/js/app.js` (data-actions `talkTo`, `editBot` (`data-id`), the editor's ✓, the Create form `createBot`), `face/client/css/app.css`
- Test: `face/tests/client/host-discover.test.js`, `actions.test.js`, `discover.test.js`, `app-dom.test.js`, `css.test.js`

**Interfaces:**
- `talkTo(bot) → Promise<string|null>` — the newest conversation with `kind === 'bot'`, `preset === bot.id` and `archived === false`; else `session/create {request: {cwd: bot.homeCwd, agentPreset: bot.id}}`, then `live.refresh()`; the caller opens it.
- `modelChoices() → Promise<string[]>` — `botModelChoices(await call('session/modelCatalog', {}))`, `[]` on failure.
- `saveBot(bot, fields) → Promise<'saved'|'stale'|'failed'>` — `POST /data/bots/settings` with `botSettingsPayload(bot, fields)`; a 409 whose words contain `changed since this view was loaded` → `stale` (Discover's line `Changed elsewhere — reloaded`); a 500 whose words begin `bots/<id> was saved, but` → `saved` with those words on the line; then `/data/bots.json` is re-read.
- `createBot({name, id, description, model, soul}) → Promise<string|{error}>` — blank fields omitted; a blank id with `proposeBotId(name) === ''` is refused before the post (`{error: 'Give it an id: a-z, 0-9, -'}`); `POST /data/bots` → the row; `listed: false` or not, `/data/bots.json` is re-read; resolves the new id.
- The bot page: `Talk to <name>` (absent when `broken` or `listed === false`) and `Edit` — the edit `{kind: 'bot', id, revision}`: Name, Description, Model (`Default` then the choices), Soul; every field's id carries the revision (`bot-<id>-<revision>-name`) so a re-read clears stale typing; ✓ saves, × cancels.
- `#/discover/create`: Name, Id (placeholder the proposed id), Description, Model, Soul (prefilled with `draftBotSoul`'s template), `Create`; success opens `#/plugin/bot:<id>`.

- [ ] **Step 1: Write the failing tests** — host-discover: `"saveBot posts the revision-checked payload and re-reads the bots"`, `"a stale revision reads stale and the line says Changed elsewhere"`, `"a saved-but 500 counts as saved"`, `"createBot omits blank fields; a name with no ASCII needs an id before any post"`; actions: `"talkTo opens the bot's newest open home conversation, else creates one in its home with its preset"`; discover: `"the editor's field ids carry the revision"`, `"a broken or unlisted bot offers no Talk to"`, `"the Create page"`; app-dom: `"Save posts and the editor shows the new revision"`, `"Create a bot creates it and opens its page"`, `"Talk to opens the bot's conversation"`; css: the editor and the Create page.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/host-discover.test.js tests/client/actions.test.js tests/client/discover.test.js tests/client/app-dom.test.js tests/client/css.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: Talk to a bot, edit its settings, create one".

### Task 10: The demo's last pieces leave

**Files:**
- Delete: `face/client/js/render/mail.js`, `face/tests/client/helpers/seed.js`, `face/tests/client/data.test.js`
- Modify: `face/client/js/router.js` (`mail` leaves), `face/client/js/reducers/messages.js` (`nav`'s mail branch; `stampMessage` and `append` when nothing imports them), `face/client/js/reducers/account.js` (the memory reducers), `face/client/js/messages.js` (`LEVELS` holds the host's kinds alone; `needsAnswer` is card, approval, question; `isClosed` when unused), `face/client/js/data/empty.js` (`plugins`, `memory`, `mail`, `banner`, `call`, `compose` leave), `face/client/css/app.css` (the dead rules), every test that built on the seed (`controls.test.js`, `reducers.test.js`) rebuilt over host-shaped states
- Test: `face/tests/client/controls.test.js`, `reducers.test.js`, `css.test.js`

**Interfaces:**
- No new names. After the task, `grep -rn "seed\|SEED_VERSION\|render/mail\|state\.mail\|state\.memory\|plugins\.installed\|stampMessage" face/client/js face/tests/client` → empty.

- [ ] **Step 1: Write the failing tests** — reducers: `"nav folds #/mail to Messages"`, `"the empty state carries no demo slice"` (no `plugins`, `memory`, `mail`, `banner`, `call`, `compose`); css: `"every rule's class is emitted by some screen"` (the stylesheet's class selectors against the classes of `everyState`, so dead rules fail).
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/reducers.test.js tests/client/css.test.js`. Expected: FAIL.
- [ ] **Step 3: Delete and rebuild** the seed-based tests over states made by the host reducers.
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS; the grep above is empty.
- [ ] **Step 5: Commit** — "client: Mail, Memory, the seed and the demo kinds leave".

### Task 11: The tool rows draw their results

**Files:**
- Create: `face/client/js/render/tool-result.js`
- Modify: `face/client/js/render/thread.js` (the `tool` body), `face/client/js/host/kinds.js` (a result row carries the call's `name` and `args`), `face/client/js/app.js` (`render()` keeps every `details[id][open]` open), `face/client/css/app.css`
- Delete: `face/client/js/wire/render.js`
- Test: `face/tests/client/tool-result.test.js` (new), `thread.test.js`, `kinds.test.js`, `app-dom.test.js`, `css.test.js`

**Interfaces:**
- `toolResultHtml(name: string, text: string) → string|null` — `null` unless `name` is `mcp__alpaca-kit__<tool>` and the payload parses with `ok: true`; the parse is `render.js`'s `parsePayload` and `salvageRows`, ported (whole JSON; up to the last `}`; whole rows salvaged), a partial parse stamped with the muted `Partial`; `market_snapshot` → a table Symbol · Close · Change · Volume sorted by change, the sign printed; `daily_bars` → `chartSvg` over the closes, else the table; `calendar` → `<n> trading days` and the days; `breadth`, `account` → tiles (≤ 8 fields) or key-value rows, decimal strings read through `number()`; `screen`, `positions`, `orders`, `earnings`, `corp_actions` → a table of the first 8 columns, `0 rows` when empty. Memoised per message `data` object (a `WeakMap`).
- The row: `<details id="tool-<callId>" class="tool">`; recognised → the pretty body and a nested `<details id="raw-<callId>" class="raw"><summary>Raw</summary><pre>…</pre></details>`; else the `<pre>`.

- [ ] **Step 1: Write the failing tests** — tool-result: `"market_snapshot is a table sorted by change, the sign printed"`, `"daily_bars is a chart"`, `"account tiles read decimal strings"`, `"a spilled result draws what parsed, stamped Partial"`, `"an unknown tool, another server's tool of the same name, an ok:false body or garbage draw nothing"`, `"every cell is escaped"`; thread: `"a recognised result draws pretty with Raw nested; another draws its pre"`; kinds: `"a result row carries the call's name and arguments"`; app-dom: `"an opened tool row stays open across the next render"`; css: the tables, tiles and chart in a tool row.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/tool-result.test.js tests/client/thread.test.js tests/client/kinds.test.js tests/client/app-dom.test.js tests/client/css.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**; delete `js/wire/render.js` (`grep -rn "wire/render.js" face` → empty).
- [ ] **Step 4: Run them again**, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: tool results draw as tables and charts, the raw text a click away".

### Task 12: Children and member traces

**Files:**
- Create: `face/client/js/host/children-view.js`, `face/client/js/host/traces.js`, `face/client/js/reducers/traces.js`
- Modify: `face/client/js/host/actions.js` (`stopChild`), `face/client/js/host/kinds.js` (a bot bubble carries `memberSessionId`, `memberTurn`), `face/client/js/render/messages.js` (Details: Children), `face/client/js/render/thread.js` (Trace), `face/client/js/reducers/index.js`, `face/client/js/data/empty.js` (`traces: {}`), `face/client/js/app.js` (data-actions `stopChild` → confirm, `openTrace`), `face/client/css/app.css`
- Delete: `face/client/answer-traces.js`, `face/tests/answer-traces.test.ts`
- Test: `face/tests/client/children-view.test.js`, `host-traces.test.js` (new), `actions.test.js`, `kinds.test.js`, `messages-screen.test.js`, `thread.test.js`, `app-dom.test.js`, `css.test.js`

**Interfaces:**
- `childrenOf(conv, childRows) → {children: Array<{id, label, mode: 'one-shot'|'continuable'|null, state: 'running'|'inactive'|'unknown'|'unavailable', canStop: boolean}>, unavailable: boolean}` — `composeSubagentCatalog({catalog: conv.subagentCatalog, parentSummary: {agentAvailable: conv.live}, rows: childRows})` through `normalizeSubagentCatalog` and `subagentControls`; `canStop` is `canInterrupt`; a malformed catalog → `{children: [], unavailable: true}`.
- `stopChild(parentSessionId, childSessionId) → Promise<boolean>` — `subagents/interruptByParent {childSessionId, parentSessionId, mode: 'continuable'}`, `{accepted: true}` → the line `Stopping <label>`.
- Details: **Children** when the conversation has catalog entries (or `Children unavailable`): label, `One-shot` / `Continuable`, `Running` / `Not running` / `Unknown` / `Unavailable`, and `Stop` (confirm `Yes, stop`) on a child that can stop.
- `startTraces({store, call, loadMemberTrace, mapFrame}) → {open(convId, msgId)}` — once per message: `traceLoading`, `loadMemberTrace(call, {sessionId: m.data.memberSessionId, turn: m.data.memberTurn})`, its views folded into messages through `toMessages` and `hostEvent` on a scratch conversation (as `windowOf` folds a window), `traceLoaded({msgId, messages})`; an error → `traceFailed({msgId, line: err.message})`.
- A member's bubble (`data.memberSessionId` and `data.memberTurn`) is followed by `<details id="trace-<msgId>" class="trace">` whose summary `Trace` carries `data-action="openTrace" data-conv data-msg`; its body `Loading…`, the trace's tool rows (Task 11's renderers) and context lines, or the loader's words.

- [ ] **Step 1: Write the failing tests** — children-view: `"catalog children with their states; a running continuable child can stop, a one-shot cannot"`, `"a malformed catalog reads unavailable, never an empty list"`, `"an unknown-mode entry reads unavailable"`; actions: `"stopChild sends interruptByParent in continuable mode"`; kinds: `"a member's answer carries its member session and turn"`; messages-screen: `"Details lists the children with Stop on the one that can"`; host-traces: `"open reads projections then pages back, once per message, and folds each call with its result"`, `"a loader error lands as its words"`; thread: `"a member's answer offers Trace; Gravit's and the operator's do not"`, `"a loaded trace draws its tool rows"`; app-dom: `"opening Trace reads the member's session without following it"`, `"Stop on a child asks first, then interrupts it"`; css: Children and a loaded trace.
- [ ] **Step 2: Run them** — `npx tsx --test tests/client/children-view.test.js tests/client/host-traces.test.js tests/client/actions.test.js tests/client/kinds.test.js tests/client/messages-screen.test.js tests/client/thread.test.js tests/client/app-dom.test.js tests/client/css.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**; delete `answer-traces.js` and its test (`ls face/client/*.js` → `market-catalog.js` alone).
- [ ] **Step 4: Run them again**, then `npm test`, `npm run typecheck` and `FACE_SMOKE=1 npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — "client: a conversation's children with Stop, and a room member's trace".

### Task 13: Documents and the manual look

**Files:**
- Modify: `DEVELOPMENT.md` (§5 — Discover, the list's groups, the channel page, the row actions, the tool rows, Children and Trace, the new host layers and views, the moved wire modules; §7 — the new tests and the counts), `face/README.md` (the chat surface's Discover, channels, row actions and research sections rewritten for the new screens; the counts), `CLAUDE.md` (the `face/client/` row: Discover, channels, row actions and the research surfaces on the face; the old modules gone), `Gravit-Docs-and-Prompt-Loops.html` (only where a station names the old client's modules), `docs/superpowers/plans/2026-10-19-gravit-face-ledger.md` (a "Stage 3" section: the rulings, the manual look, deferred minors)

- [ ] **Step 1: Update the documents**; `grep -rn "channels.js\|subagents.js\|member-traces.js\|answer-traces.js\|botSettings.js\|wire/render.js" CLAUDE.md DEVELOPMENT.md face/README.md` → only the new `js/wire/` paths and history.
- [ ] **Step 2: The manual look** — a scratch face (no keys), in the browser pane: Discover's four shelves, an MCP page, the Gravit page, a skill's content; Create a bot in the scratch home and its page; Edit and Save it; Talk to it; the list's groups (a channel, the bot, No channel), collapse one; the `room-drill` channel page; New channel from Where; fork, archive, un-archive and delete a scratch conversation. Record it in the ledger; stop the server.
- [ ] **Step 3: Commit** — "docs: Discover, channels and the research surfaces on the face, stage 3".
