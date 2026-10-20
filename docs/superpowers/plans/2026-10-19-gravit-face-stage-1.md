# gravit-ui on the face, stage 1 — the frame and Messages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `127.0.0.1:3090/` serves gravit-ui as the face's client, with Messages fed by dsh: the session list, a session's real transcript, the composer that prompts, the three gate cards (order, approval, question) and rooms.

**Architecture:** gravit-ui's store + pure reducers + string renderers stay; a host layer (`js/host/`) sits between the old client's wire modules (`js/wire/api.js`, `mapper.js`, reused unmodified but for one field) and the store, translating frames into gravit-ui messages (the kind table) and data-actions into Remotes. The follow/page policy is `chat.js`'s, ported as pure decisions plus a thin live glue. Scripted pieces (seed, driver, director) go.

**Tech Stack:** vanilla ES modules in the browser (no bundler), Node 22 + `node:test` via `tsx --test`, the face's `static.ts` for serving, dsh 0.2.0-rc.2's wire as `api.js` speaks it.

**Spec:** `docs/superpowers/specs/2026-10-19-gravit-ui-on-face-design.md` (route A; stage 1 = its §7 "Stage 1", the kind table §6, the shape §5). The front-end look is `docs/superpowers/specs/2026-10-09-demo-v2-gravit-frontend-design.md` §3–§5, §13, §16.

## Global Constraints

- The product speaks English: every label, placeholder, status line and message the client writes (spec §3). Host strings arrive as they are.
- No explanatory small print; the one exception is the muted status line under the composer and the muted stale stamp (spec §3).
- No new door: no order route, no allow-always, no "Beast"; the only order path is Gravit's tools behind the two gates (spec §2 anti-goals).
- Cold sessions are paged, never followed (PLAN D16); a follow is opened only for a session the list reports `agentAvailable` or one this tab just prompted; a socket drop suspends every follow (spec §5).
- `api.js` and `mapper.js` are moved, not rewritten; `mapper.js` gains exactly one field (`time`); their tests keep passing; `client-mux-smoke` keeps driving them against a real boot.
- Every commit leaves `npm test` (face) green and `npm start` bootable; no push; commit messages through `-F <file>` (no backticks in `-m`).
- Tokens, sizes and board states of the front-end spec stay; only what has no back end leaves the screens.
- `gravit-ui/` leaves the tree in this stage; its tests move with it.

## Review Focus

1. A list row with no title projection (a blank or pre-0.2 session) must render as "Untitled" with its time, never throw — pinned in Task 4.
2. A reconnect while a session is open must replace the window with the re-opened follow's snapshot, never append a second copy; and a `session/event` seen twice (snapshot + stream) must draw once — pinned in Tasks 5 and 7.
3. A gate for a session that is not on screen (another conversation, or a room member) must land on its conversation and show in the rail; a gate replayed after a reconnect dedupes by `eventId` — pinned in Tasks 5 and 9.
4. A compaction checkpoint (`surfaceOp replace`) must remove exactly the shadowed seq range and keep the summary line — pinned in Tasks 3 and 5.
5. Opening a cold session must issue `session/projections` + `session/page` and no `session/follow`; prompting it must then open the follow — pinned in Task 7.

---

### Task 1: Move gravit-ui into `face/client` and serve it at `/`

**Files:**
- Move: `gravit-ui/index.html` → `face/client/index.html` (replacing the old); `gravit-ui/css/*` → `face/client/css/`; `gravit-ui/js/**` → `face/client/js/`; `gravit-ui/tests/*.test.js` + `tests/helpers/fake-dom.js` → `face/tests/client/`
- Move: `face/client/{api,mapper,summaries,room,speaker,markdown,render}.js` → `face/client/js/wire/`
- Delete: `face/client/chat.js`, `gravit-ui/{package.json,serve.js,.gitignore,README.md}`, `face/tests/client/serve.test.js`
- Modify: `face/package.json` (`test` script), every test importing a moved module (`face/tests/{api,mapper,summaries,room-client,speaker,markdown,render,client-mux-smoke,member-traces,answer-traces,subagents}.test.ts` and `face/client/{member-traces,subagents,answer-traces,channels,account-view,market}.js` import paths as needed)
- Create: `face/tests/client-page.test.ts`

**Interfaces:**
- Produces: the page at `/` is gravit-ui as built (still scripted — the host layer comes in later tasks); `face/client/js/wire/api.js` exports `call`, `openMux`, `randomUuid`; `face/client/js/wire/mapper.js` exports `mapFrame`.

- [ ] **Step 1: Write the failing page test** — `face/tests/client-page.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const page = readFileSync(join(import.meta.dirname, "..", "client", "index.html"), "utf8");
test("index.html loads its assets under /client/ and speaks English", () => {
  const refs = [...page.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 3);
  for (const ref of refs) assert.ok(ref.startsWith("/client/") || ref.startsWith("https://fonts.g"), ref);
  assert.match(page, /<html lang="en">/);
  assert.match(page, /<title>Gravit<\/title>/);
});
```

- [ ] **Step 2: Run it to verify it fails** — `cd face && npx tsx --test tests/client-page.test.ts` → FAIL (the old index.html has no `/client/js`… wait: it fails on `lang` or on the refs — either way FAIL).

- [ ] **Step 3: Move the trees** with `git mv` (gravit-ui's `index.html`, `css/`, `js/`, `tests/` as listed; the wire modules into `js/wire/`), delete the listed files, and edit `face/client/index.html`: `lang="en"`, `<title>Gravit</title>`, `./css/tokens.css` → `/client/css/tokens.css`, `./css/app.css` → `/client/css/app.css`, `./js/app.js` → `/client/js/app.js`.

- [ ] **Step 4: Fix imports and the test script** — in the moved client tests `../js/` → `../../client/js/`; in `css.test.js` the stylesheet path → `../../client/css/app.css` (via `import.meta.dirname`); in the face tests `../client/<x>.js` → `../client/js/wire/<x>.js` for the seven moved modules; in the old client modules that import a moved module (`member-traces.js`, `subagents.js`, `answer-traces.js`, `channels.js`, `account-view.js`, `market.js` — grep `from "./(api|mapper|summaries|room|speaker|markdown|render)\.js"`) → `./js/wire/<x>.js`; `face/package.json` `"test": "tsx --test tests/*.test.ts tests/client/*.test.js"`.

- [ ] **Step 5: Run the whole suite** — `cd face && npm test` → every test passes (693 + the moved 264 − the deleted serve tests); `npm run typecheck` → clean.

- [ ] **Step 6: Boot check** — `cd face && npm start` in a scratch `DSH_HOME` (as `tests/smoke.test.ts` does, or `FACE_SMOKE=1 npx tsx --test tests/static.test.ts tests/client-mux-smoke.test.ts`) → `/` answers the new page past the sign-in; `/client/js/app.js` 200.

- [ ] **Step 7: Commit** — `git add -A face gravit-ui && git commit -q -F <msg>` ("face: gravit-ui moves into face/client and is served at /; the old chat page goes").

### Task 2: `mapper.js` carries the event's time

**Files:**
- Modify: `face/client/js/wire/mapper.js` (the `FrameView` typedef and the two places a session event becomes a bubble/card/room-line/subagent-message view)
- Test: `face/tests/mapper.test.ts`

**Interfaces:**
- Produces: every view built from a `session/event` carries `time` (the event's unix-ms `time`, a number) beside `seq`; gate, pulse, projection and turn views carry none.

- [ ] **Step 1: Write the failing test** (in `mapper.test.ts`, with the fixture's line 1 — the operator bubble at `seq 4`):

```ts
test("a session event's view carries the event time", () => {
  const view = mapFrame(fixtureLine(0));
  assert.equal(view.kind, "bubble");
  assert.equal(view.seq, 4);
  assert.equal(view.time, 1756512000000);
});
```

- [ ] **Step 2: Run it** — `npx tsx --test tests/mapper.test.ts` → FAIL (`time` undefined).
- [ ] **Step 3: Implement** — where the mapper reads `event.seq` into the view, also copy `event.time` when it is a finite number.
- [ ] **Step 4: Run the mapper suite and `client-mux-smoke`** (`FACE_SMOKE=1`) → PASS.
- [ ] **Step 5: Commit** — "mapper: a session event's view carries its time".

### Task 3: The kind table — `js/host/kinds.js`

**Files:**
- Create: `face/client/js/host/kinds.js`
- Test: `face/tests/client/kinds.test.js` (reads `face/tests/fixtures/events.jsonl` through `mapFrame`)

**Interfaces:**
- Consumes: `mapFrame` (Task 2's views), `renderMarkdown` from `js/wire/markdown.js`.
- Produces:
  - `export const ORDER_TOOLS = Object.freeze(["place_order", "cancel_order"]); export function isOrderTool(name: string): boolean` — raw or `mcp__<server>__<raw>`.
  - `export function parseArgs(raw: string|undefined): Record<string, unknown>` — JSON or `{}`.
  - `export function orderLine(args): string` — `"buy 0.00008 BTC · market"` / `"sell 10 AAPL · limit 187.40"` / `"cancel <order_id>"` from `side`, `qty`, `symbol`, `order_type`, `limit_price`, `order_id`.
  - `export function toMessage(view, calls: Map<string, {name: string, args: object}>, now: number): Message | null` where `Message = {id, seq?, at, from, kind, text, data, replace?: {start, end}, merge?: true}`:
    - bubble operator → `{from: "you", kind: "text", text, data: {mention}}`; bubble gravit → `{from: "gravit", kind: "text", text, data: {html: renderMarkdown(text).outerHTML, interrupted}}`; bubble bot → `{from: view.bot, kind: "text", text: view.displayText ?? view.text, data: {name}}`; a bubble whose `source` is neither `user`, `model`, `room` nor `tool` (a context note: `compact-checkpoint`, `plugin:*`, `runtime-context`…) → `{from: "system", kind: "text"}`;
    - room-line → `{from: "system", kind: "text", text: roundEndLine(view)}` (`js/wire/room.js`);
    - subagent-message → `{from: "system", kind: "text", text: "Report from <childSessionId>: <text>"}`;
    - card with a tool/call → `calls.set(callId, {name, args})` and `{id: "t" + callId, kind: "tool", from: "gravit", data: {callId, name, command: args.command, args}}`; a tool/result → `{id: "t" + callId, merge: true, kind: "tool", data: {result: text, isError}}`, and when the call was an order tool: `isError` → a second message `{id: "r" + callId, kind: "refusal", from: "gravit", text: <result text>}`, else `{id: "r" + callId, kind: "receipt", from: "gravit", text: "Order accepted · " + orderLine(args) + " · " + <result.id>, data: {orderId}}`;
    - approval of an order tool → `{id: eventId, kind: "card", from: "gravit", at: now, text: "Your call: " + orderLine(args), data: {eventId, sessionId, toolName, callId, venue: "Alpaca paper", line: view.displayReason ?? view.reason}}` with `args` from `calls.get(callId)` else `{}` (then `text` = `"Your call: " + toolName`); any other approval → `{id: eventId, kind: "approval", data: {eventId, sessionId, toolName, reason, displayReason}}`;
    - question → `{id: eventId, kind: "question", data: {eventId, sessionId, questions}}`;
    - a view with `surfaceOp.op === "replace"` → the message carries `replace: {start: surfaceOp.start, end: surfaceOp.end}`;
    - pulse, projection, turn, gate-resolved, ignore → `null` (the live layer reads those itself).
    - `at` = `view.time` for events, `now` for gates; `seq` = `view.seq`.

- [ ] **Step 1: Write the failing tests** — `kinds.test.js`, one `test` per bullet above, driven by the fixture lines: line 1 (operator, `mention` absent), line 2 (gravit, markdown html contains `<p>Both pivots`), lines 3+4 (tool call then result merge: id `tc1`, `data.command === "python -m alpaca_kit.breadth"`, result text), line 7 (approval of `bash` → kind `approval`, `displayReason` undefined, `reason` "shell command outside the allowlist"), line 8 (question → `questions.length === 1`), line 15 (error result of `read` → a `tool` merge with `isError: true` and NO refusal message, since `read` is not an order tool), line 16 (compaction: `from "system"`, `replace: {start: 4, end: 11}`), line 21 (bot bubble: `from "buffett"`, `data.name === "巴菲特型"`), line 22 (room-line text starts with "Round 1"); plus three synthetic frames: a tool/call of `mcp__alpaca-kit__place_order` with arguments `{"symbol":"BTC/USD","qty":0.00008,"side":"buy","order_type":"market"}` followed by an `approval/request` naming that `callId` → kind `card`, text `"Your call: buy 0.00008 BTC/USD · market"`, `data.venue === "Alpaca paper"`; its `ok:true` result `{"ok":true,"id":"ord-1","status":"accepted"}` → a `receipt` with `data.orderId === "ord-1"`; its `isError` result → a `refusal`.

- [ ] **Step 2: Run** — `npx tsx --test tests/client/kinds.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `kinds.js`** per the interface; keep it dependency-free beyond `markdown.js` and `room.js`.
- [ ] **Step 4: Run** → PASS; `npm test` → green.
- [ ] **Step 5: Commit** — "client: the kind table, frames to gravit-ui messages".

### Task 4: Session rows — `js/host/sessions.js`

**Files:**
- Create: `face/client/js/host/sessions.js`
- Test: `face/tests/client/sessions.test.js`

**Interfaces:**
- Consumes: `summaryOf` (`js/wire/summaries.js`), `foldMembers` (`js/wire/room.js`), `isHostPreset` (`js/wire/speaker.js`).
- Produces:
  - `export function kindOf(summary, room): "gravit" | "bot" | "group"` — `room?.kind === "room"` → group; a non-host `agentPreset` → bot; else gravit.
  - `export function conversationOf(summary, ctx): Conversation` with `ctx = {bots: Map<id, {name}>, channelOf: (sessionId) => {workspaceId, name} | null, rooms: Map<sessionId, unknown>, lastSeen: Record<sessionId, number>}` and `Conversation = {id, title, kind, members, channel, preset, running, live, updatedAt, created, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen}`; `title` = `projections.values.title` when a non-empty string, else `"Untitled"`; `members` = `["gravit"]` + the room value's member ids (group) or `[preset]` (bot); `live = agentAvailable === true`.
  - `export function listConversations(items, ctx): Conversation[]` — rows through `summaryOf(row, ctx.presets)`, members (the fold) and `ctx.archived`/`ctx.deleted` ids dropped, sorted by `updatedAt` desc.
  - `export function unreadOf(conv): boolean` — `conv.updatedAt > conv.lastSeen`.

- [ ] **Step 1: Write the failing tests** — a bare row `{sessionId: "s1", updatedAt: 5, agentAvailable: false, running: false, blank: false}` → title "Untitled", kind gravit, live false (Review Focus 1); a row with `projections.values.title = "BTC"` and `agentPreset = "buffett"` → kind bot, members `["buffett"]`, title "BTC"; a room (`rooms.get("s1").kind === "room"`, members `[{id:"buffett"}]`) → kind group, members `["gravit","buffett"]`; a member row (`parentSessionId: "s1"`, preset buffett, no origin) is dropped by `listConversations`; ordering by `updatedAt`; `unreadOf` true when `updatedAt > lastSeen`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm test` green.
- [ ] **Step 5: Commit** — "client: session rows become conversations".

### Task 5: Host reducers — `js/reducers/host.js`

**Files:**
- Create: `face/client/js/reducers/host.js`
- Modify: `face/client/js/reducers/index.js` (spread `host`), `face/client/js/reducers/messages.js` (remove `send`'s message push, `append`'s closed-conversation drop; `stopGravit` and `withdraw` go; `answer` marks a gate `pending` instead of resolving it), `face/client/js/messages.js` (`needsAnswer` = card | approval | question without `answer`; `isClosed` removed)
- Test: `face/tests/client/host-reducers.test.js`; `reducers.test.js` adjusted for the removed reducers

**Interfaces:**
- Produces (every reducer `(state, payload) => state`, pure):
  - `hostStatus(s, {line: string, bad?: boolean, connected?: boolean})` → `s.status = {line, bad, connected}`;
  - `hostList(s, {conversations})` → replaces `s.conversations` keeping, per surviving id, the previous `messages`, `loaded`, `preview`, `usage`, `thinking`, `lastSeen`;
  - `hostWindow(s, {convId, messages, usage?})` → the conversation's `messages` replaced (not appended), `loaded: true` (Review Focus 2);
  - `hostEvent(s, {convId, message})` → if `message.replace`, first drop messages with `start <= seq <= end`; then if a message with the same `id` exists: `merge` → merge `data`, else ignore (seen twice, Review Focus 2); else append in `seq` order; an `assistant` or `system` message clears `thinking`;
  - `hostGate(s, {convId, message})` → upsert by `id` (replay dedupes, Review Focus 3); a gate for an unknown `convId` is kept in `s.orphanGates[id]` and re-tried by the live layer on the next list;
  - `hostGateGone(s, {eventId, outcome})` → the gate message's `answer` = `outcome` (`"approved" | "rejected" | "closed" | "elsewhere"`) in whichever conversation holds it;
  - `hostProjection(s, {convId, key, value})` → `title` → `conv.title`; `tokenUsage`/`contextPressure` → `conv.usage[key]`; `room` → `conv.members` + kind group; `running` → `conv.running`;
  - `hostThinking(s, {convId, mode})` → `conv.thinking = mode`;
  - `hostPreview(s, {convId, preview, at})`;
  - `markSeen(s, {convId, seq})` → `conv.lastSeen = max(lastSeen, seq)` and `s.lastSeen[convId]` likewise.
  - `emptyState(now)` in `js/data/empty.js`: the gravit-ui state with `conversations: []`, `status: {line: "connecting…", bad: false, connected: false}`, `orphanGates: {}`, `lastSeen: {}`, no `counters`, no demo slices for mail/discover/trade beyond what their reducers need (keep `discover`, `markets`, `trade`, `account`, `plugins`, `memory` as empty shapes so later stages' render code still boots).

- [ ] **Step 1: Write the failing tests** — one per reducer: `hostEvent` ignores a duplicate `id`, merges a `tool` result into its call, honours `replace: {start: 4, end: 11}` (messages at seq 4, 7, 9, 10, 11 gone, 13 kept, the summary appended); `hostWindow` replaces; `hostGate` upserts by id and parks an orphan; `hostGateGone` marks; `hostList` keeps a surviving conversation's messages; `markSeen` and `unreadOf`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm test` green (adjust `reducers.test.js` for the removed `stopGravit`/`withdraw`/closed-drop).
- [ ] **Step 5: Commit** — "client: host reducers, the store becomes a cache of the host".

### Task 6: Actions — `js/host/actions.js`

**Files:**
- Create: `face/client/js/host/actions.js`
- Test: `face/tests/client/actions.test.js`

**Interfaces:**
- Consumes: `call(endpoint, args)` and `randomUuid` (`js/wire/api.js`), a `postJson(path, body)` for `/data/rooms/say`, `isMentionText` (`js/wire/room.js`).
- Produces: `export function makeActions({store, call, answerGate, postJson, requestId = randomUuid, timeZone}) → {send(text), newConversation({title, workspaceId, text}), answer(eventId, value), stop(sessionId), rename(sessionId, title), command(sessionId, line)}`:
  - `send(text)`: the open conversation is `state.route.id`; a line starting with `/` → `call("commands/execute", {agentId, line, submittedAttachments: []})` and, when it returns `undefined`/`null`, falls through to the prompt; a text matching `isMentionText` in a conversation with a `channel` → `postJson("/data/rooms/say", {sessionId, text})` and returns when `addressed.length > 0`; else `call("session/prompt", {request: {requestId, sessionId, mode: "queue", content: [{type: "text", text}], clientTimeZone}})`; dispatches `hostStatus` on failure with the host's `code` or the HTTP status, and `"Not signed in — open the URL gravit-face printed"` on a 401.
  - `newConversation({title, workspaceId, text})`: `call("session/create", {request: workspaceId ? {workspaceId} : {}})` → `sessionId`; `call("session/rename", {request: {sessionId, title}})` when `title` is non-empty; then the prompt as above; returns `sessionId`.
  - `answer(eventId, value)`: `answerGate(eventId, value)` (`api.js`'s `mux.answer`), `value` one of `"allowed-once"`, `"rejected"`, or `{answers: [...]}`; on an `AnswerError` the status line carries its `code`.
  - `stop(sessionId)`: `call("session/cancel", {request: {sessionId}})`; status "Stopped. A paused goal resumes with /goal resume".
  - `rename(sessionId, title)`: `call("session/rename", …)`.

- [ ] **Step 1: Write the failing tests** with a recording `call` (returns canned values per endpoint): a plain send → one `session/prompt` with the exact request shape (`mode: "queue"`, `content[0].text`, a `requestId` string, `clientTimeZone`); `/goal resume` → `commands/execute` first and no prompt when it returns `{result: {kind: "ok"}}`; `@buffett hi` in a channel conversation → `postJson` to `/data/rooms/say`, no prompt when `addressed: ["buffett"]`, a prompt when `addressed: []`; `newConversation` → create, rename, prompt in that order with `workspaceId`; `stop` → `session/cancel`; a `call` that rejects with `{status: 401}` → `hostStatus` line "Not signed in — open the URL gravit-face printed".
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — "client: actions, data-actions become Remotes".

### Task 7: The live layer — `js/host/live.js`

**Files:**
- Create: `face/client/js/host/live.js`
- Test: `face/tests/client/live.test.js`

**Interfaces:**
- Consumes: `openMux(options)` (`js/wire/api.js`: `onReady`, `onEvent(event, args)`, `onGate(frame)`, `onGateGone(eventId)`, `onDown(reason)`; the handle's `stream(name, args, {onItem, onEnd, onError}) → {cancel()}` and `answer`), `call`, `mapFrame`, `toMessage`, `listConversations`, `getJson(path)`.
- Produces: `export function startLive({store, openMux, call, mapFrame, getJson, timers, now}) → {open(id), refresh(), close(), mux}` and the constants `LIST_REFRESH_MS = 1200`, `PREVIEW_ROWS = 12`, `FOLLOW_RETRY_MS = 2000`, `GATE_REPLAY_GRACE_MS = 4000`. Behaviour, each a pure decision where it can be:
  - `refresh()`: `call("session/list", {_request: {}})`, `getJson("/data/channels.json")`, `getJson("/data/bots.json")` together → `listConversations` → `hostList`; then `reconcile()`; then previews for the first `PREVIEW_ROWS` conversations with `loaded === false` and `preview === null`: `session/projections` then `session/page {request: {address, throughSeq: asOfSeq, maxMessages: 1}}` → the last `user`/`assistant` text → `hostPreview` (non-activating).
  - `open(id)`: `markSeen`; `viewFor(conv) = conv.live ? "follow" : "page"` (`export function viewFor`): follow = `stream("session/follow", {request: {address: {kind: "session", sessionId: id}, assistantStream: true}})`, the snapshot → `hostWindow` (records through `mapFrame` + `toMessage`), events → `hostEvent`, `assistant-stream` `block-start` → `hostThinking`; page = `session/projections` + `session/page {request: {address, throughSeq}}` → `hostWindow`. A follow the host ends is re-decided after `FOLLOW_RETRY_MS`; an error marks the view failed and sets the status line.
  - `promote(id)` (after this tab prompts a paged session, called by the app after `actions.send`): opens the follow.
  - `onEvent`: `api-session/added` → `refresh` (debounced `LIST_REFRESH_MS`); `removed` → `hostProjection running false` + stop that follow; `status` → `hostProjection {key: "running"}`; `activity` → debounced refresh; `error` → `hostStatus`; `agent-preset/selected` → debounced refresh.
  - `onGate`: `mapFrame(frame)` → `toMessage(view, calls, now())` → `hostGate` on the conversation whose id is `view.sessionId`, else the room whose `members` list that id (the member's session) — the room is found by scanning `state.conversations` for a group whose `memberSessions` includes it (the fold's `rooms` map, kept by `refresh`); else parked as an orphan and retried after the next `refresh`.
  - `onGateGone(eventId)` → `hostGateGone({eventId, outcome: "closed"})` unless this tab answered it (then `"approved"`/`"rejected"` was set by `answer`).
  - control stream `session/control` opened at start: `baseline` → `hostProjection` per session per key; `projection` frames → `hostProjection`; re-opened after `FOLLOW_RETRY_MS` on end, 10 s on error.
  - `onDown` → `hostStatus({line: "Reconnecting…", bad: true, connected: false})` and `suspend()` (cancel the open follow, mark it stale); `onReady` → `hostStatus({line: "", connected: true})`, `refresh()` then `reconcile()` (a stale or paged view that is live now is followed; a stale one that is cold is re-paged).

- [ ] **Step 1: Write the failing tests** with a fake mux (`openMux` returns `{stream(name, args, cbs) {streams.push({name, args, cbs}); return {cancel(){…}}}, answer(){}, close(){}}` and exposes the captured options) and a fake `call`/`getJson` map: (a) start → `session/control` opened; `onReady` → `session/list` called, `hostList` dispatched with the rows; (b) `open("cold")` (row `agentAvailable: false`) → `session/projections` then `session/page` called, no `session/follow` (Review Focus 5); (c) `open("live")` → `session/follow` with `assistantStream: true`; delivering a `snapshot` then an `event` draws the window then appends; delivering a second `snapshot` (after `onDown` + `onReady`) replaces the window, the same `seq` not duplicated (Review Focus 2); (d) `promote("cold")` → a follow opens; (e) `onGate` with the fixture's approval for `s1` while `s1` is listed → `hostGate` on `s1`; for a member session `s-b` of room `s1` → on `s1` (Review Focus 3); (f) `onDown` cancels the follow; (g) `onEvent("api-session/status", ["s1", true])` → `running` true on `s1`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** — port the policy of `chat.js` 2028–2296 and 4321–4461 (the file is deleted; read it from `git show main:face/client/chat.js`), with the `openSeq`-token guard against superseded opens.
- [ ] **Step 4: Run** → PASS; `npm test` green.
- [ ] **Step 5: Commit** — "client: the live layer, follow or page by liveness, gates and projections to the store".

### Task 8: Thread renderers for the kind table

**Files:**
- Modify: `face/client/js/render/thread.js` (`renderMessage`, `renderThread`), `face/client/js/messages.js` (`LEVELS`: text grey, tool grey, card/approval/question orange, receipt green, refusal red), `face/client/css/app.css` (the `.tool` row, the question card's form, the end-state chips, the thinking row)
- Test: `face/tests/client/thread.test.js` (rewritten on host-shaped messages), `css.test.js`

**Interfaces:**
- Consumes: messages as Task 3 shapes them; `conv.thinking`.
- Produces: `renderMessage(m, conv, state)` draws: `text` from `you` (blue bubble), `gravit` (grey; `data.html` when present, else escaped text), a bot (grey with the name line), `system` (the centred `.sysline`); `tool` as a collapsed `<details class="tool">` whose summary is the name or `command` and whose body is `data.result` (escaped `<pre>`, `.danger` when `isError`) — the pretty renderers of `js/wire/render.js` are mounted by the app after render for rows whose `data.name` it recognises (stage 1 keeps the raw `<pre>` only; the renderers are stage 3's); `card` (orange, title, the line "Alpaca paper · <orderLine>", keys ✗ ✓ `data-action="answer" data-value="rejected|allowed-once"`, the chip for `answer`: `Approved` / `Declined` / `Closed` / `Settled elsewhere`); `approval` (orange, `toolName` 700, `displayReason` and `reason` when different, the same keys); `question` (orange, one block per question: `header`, `detail`, radio or checkbox options by `multiSelect`, a text box when `allowCustom`/no options, one `Answer` key `data-action="answerQuestion"`); `receipt` (green); `refusal` (red); the thinking row `<div class="thinking">` after the last message while `conv.thinking`.
- Removed: kinds `limit`, `install`, `proposal`, `signal`, `call`, `brief`, `ta`, `breaking`, `alert`, `candles` (stage 2 brings K-lines back on the tool row).

- [ ] **Step 1: Rewrite `thread.test.js`** as failing tests, one per kind above (presence of the class, the keys' `data-action`/`data-value`, the chip text per `answer`, the question card's inputs named `q-<id>`), and a test that `renderThread` draws the thinking row only while `conv.thinking`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm test` green (remove the deleted kinds' tests from `canvas-round.test.js`, `messages-screen.test.js`).
- [ ] **Step 5: Commit** — "client: the thread draws the kind table".

### Task 9: Rail, head, Details, composer, new message, status line

**Files:**
- Modify: `face/client/js/render/rail.js` (nav: Messages with the badge = conversations holding an unanswered gate, Markets → `href="/market"`, Account → `href="/account"`; no Discover/Trade/phone/mail; rows: avatar by kind, title, `rowTime(updatedAt)`, `preview`, unread dot from `unreadOf`), `face/client/js/render/messages.js` (head: Working chip from `running`; Details: This task — title, created, channel, preset; Members; Usage — input/output/cache tokens and context pressure when present; Stop while `running`; Change words; composer without + and mic; the status line `<div class="status[ bad]">`; the new-message screen: title, Where `<select name="where">` from `state.channels`, the first message), `face/client/js/render/controls.js` (unchanged), `face/client/css/app.css`
- Test: `face/tests/client/rail.test.js`, `messages-screen.test.js`, `controls.test.js` (adjusted)

**Interfaces:**
- Consumes: `state.channels: [{workspaceId, name, isRoot}]` (set by the live layer's refresh from `/data/channels.json`), `state.status`, `unreadOf`, `needsAnswer`.
- Produces: the data-actions the app handles: `send`, `startDraft`, `draftTitle`, `draftWhere`, `cancelDraft`, `answer`, `answerQuestion`, `stopGravit`, `toggleDetails`, `commitEdit`/`cancelEdit` (rename), `toggleRail`, `openSettings`/`closeSettings`, `suggest`.

- [ ] **Step 1: Write the failing tests** — the nav has no `discover`/`trade`/`phone`/`mail` items and its Markets/Account are links to `/market`/`/account`; the Messages badge counts conversations with an unanswered gate (Review Focus 3); a row shows "Untitled" for a conversation without a title and the unread dot when `unreadOf`; Details shows Stop only when `running` and shows the Usage rows when `usage.tokenUsage` exists; the composer has no `attachFiles`/`toggleMic` actions; the new-message screen has a `where` select listing the channels with the root first; the status line renders `state.status.line` with `.bad`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm test` green.
- [ ] **Step 5: Commit** — "client: the rail, head, Details, composer and new-message screen on the host's facts".

### Task 10: `app.js` boots on the host

**Files:**
- Modify: `face/client/js/app.js` (boot: `emptyState`, the persisted conveniences `{theme, railCollapsed, lastConv, lastSeen, markets.watch}` under key `gravit-ui.prefs`, `startLive`, `makeActions`, the data-action switch for Task 9's actions, `answerQuestion` reading the card's inputs into `{answers: [{id, selected: [...], custom?}]}`, focus bookkeeping as built, theme as built; the director, driver flows, banner, calls, mic, files, the seed, Reset demo removed)
- Delete: `face/client/js/driver.js`, `face/client/js/data/seed.js`, `face/tests/client/driver.test.js`, the demo-flow tests in `app.test.js`/`app-dom.test.js`/`canvas-round.test.js` (replaced below)
- Test: `face/tests/client/app.test.js`, `app-dom.test.js` (rewritten with the fake mux/call of Task 7 and the fake DOM)

**Interfaces:**
- Consumes: Tasks 5–9.
- Produces: `export function boot(win, {openMux, call, getJson, postJson} = wireDefaults)`; `export function answersFrom(root, questions)` (pure: the card's inputs → the answer batch).

- [ ] **Step 1: Write the failing tests** — boot with the fake host: the empty state renders the Messages screen with the empty-state chips; after `onReady` and a list with two rows, two rows render; clicking a row opens it (`open` called) and clears its unread; typing + Send on an open live conversation → `session/prompt`; Send on `#/messages/new` with a title and a `where` → create → rename → prompt, then the route moves to the new id; an approval card's ✓ → `answer(eventId, "allowed-once")` and the chip reads Approved; `answersFrom` builds `{answers: [{id: "q1", selected: ["Yes, pin it"]}]}` from a checked radio; the persisted prefs survive a reboot and a stray `gravit-ui.state` key is ignored; the `d` key opens nothing.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm test` green; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — "client: the app boots on the host; the demo machinery goes".

### Task 11: The client smoke on a real boot

**Files:**
- Create: `face/tests/gravit-client-smoke.test.ts` (`FACE_SMOKE=1` only, one boot per process as `smoke.test.ts` says)
- Modify: `face/tests/client-mux-smoke.test.ts` (import paths only, done in Task 1 — verify)

- [ ] **Step 1: Write the smoke** — boot the face on a scratch home (as `client-mux-smoke.test.ts` does: `setupFaceProfile`, `bootFace`, `mountClient`, `signIn`), then: `GET /` with the cookie → 200 and the body contains `/client/js/app.js`; `GET /client/js/host/live.js` → 200 `text/javascript`; `GET /client/css/app.css` → 200; run `listConversations` over the real `session/list` answer (`remoteResult`) plus `/data/channels.json` → an array (empty or not) without throwing; create a session through `session/create` and open it through the live layer's page path (`session/projections` + `session/page`) → `hostWindow` dispatched with `loaded: true`.
- [ ] **Step 2: Run** — `FACE_SMOKE=1 npx tsx --test tests/gravit-client-smoke.test.ts` → PASS; `FACE_SMOKE=1 npm test` → all real boots pass.
- [ ] **Step 3: Commit** — "face: the client smoke, the new page on a real boot".

### Task 12: Documents and the manual look

**Files:**
- Modify: `DEVELOPMENT.md` §4.4 (the page row), §5 (rewritten: the new client's files, the host layer, the kind table, the follow policy, state), §1's diagram line for the face routes; `CLAUDE.md` (the `gravit-ui/` row → "`face/client/` — gravit-ui, the face's client…"; `face/` row loses `/market` + `/account` only in stage 2); `face/README.md` (the client section replaces the gravit-ui README's content: run, what is scripted → what is host-fed; the Gate-2 and transport drills name the new page); `docs/superpowers/plans/2026-10-19-gravit-face-ledger.md` (this stage's rulings and the drill record)

- [ ] **Step 1: Update the documents** as listed; `grep -rn "gravit-ui/" CLAUDE.md DEVELOPMENT.md face/README.md` → only historical mentions remain.
- [ ] **Step 2: The manual look** — boot the face on a scratch home without keys (`DSH_HOME=<scratch> npm start` after `npm run setup` there), open the printed URL in the browser pane: the empty state; New message in the `workbench` channel with a first line → the session appears, the prompt is accepted (the model call fails without keys: the status line says so, nothing crashes); reload → the cold session opens paged (no follow in the server log); record the result in the ledger. Stop the server.
- [ ] **Step 3: Commit** — "docs: the face's client is gravit-ui, stage 1".
