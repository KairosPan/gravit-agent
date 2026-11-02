# Desk hardening (spec §16, H1–H4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four gaps the 2026-11-02 Super-agent review found in the desk:
- alert annotations queue behind the operator's turns;
- an alert a restart caught between its decision and its send is lost;
- a phone text can go unanswered across a restart;
- nothing outside the face notices it is down.

**Architecture:**
- Annotations move to fresh desk agents on a lane of their own, built from the parts firings already use: `createDeskAgent`, `superviseDeskTurns`, `deskTurnEvent`, and the conversation's `deliver`.
- The two restart gaps are closed by finishing the store-first protocol the ledgers already half follow:
  - the watch replays orphans at its first read;
  - the bridge posts under a stable message id and stores its offset only after the session's log is flushed.
- A second LaunchAgent runs `status --check` every five minutes and pages the phone itself.

**Tech Stack:**
- Node 22 and TypeScript, tests with `node --test` via `tsx`.
- dsh 0.2.0-rc.2 seams: `createDeskAgent`, `superviseDeskTurns`, `MessageId`, `freezeMessage`, `ctx.sessionPersistence.open/flush`, the durable `Agent.inbox`.
- launchd.

**Spec:** `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` §16 (H1, H1b, H2, H3, H4). The mechanisms it builds on are §5.3–§5.8 and §15. The reference pattern is `deepseek-ai/dsh-superagent-prototype` `src/app/delivery.ts`.

## Global Constraints

**dsh, dependencies and module weight**
- dsh stays `0.2.0-rc.2`; no new npm dependency. A separate branch (`claude/dsh-upgrade-51c9f0`) upgrades dsh. Use only seams that exist in 0.2.0-rc.2.
- Module weight, as `src/desk-conversation.ts`'s header states it:
  - `src/desk.ts`, `scripts/service.ts` and the pause switch load no dsh runtime at module level.
  - `src/annotator.ts` imports only types at its top and loads `desk-session.ts` and `dsh-llm` on first use.
  - `scripts/watchdog.ts` loads no dsh runtime (no `dsh-agent`, `dsh-llm` or cordis). `@deepseek-ai/dsh-atomic-write` is allowed.

**Ledger and state**
- The ledgers stay append-only JSONL, written through `appendChain`, `appendEvent` and `appendRecord`.
- The one new file is `$DSH_HOME/face/desk/watchdog.json`, written with `writeFileAtomic` (mode `0o600`, dirMode `0o700`).

**What reaches the phone**
- Every refusal, loss or cut is one ledger record and at most one phone line.
- Every phone line from the face leaves through the desk conversation's `deliver`, so the pause holds it.
- The watchdog sends nothing while `OFF` is in force.
- Times on the phone use `deskTime` (New York) as the desk prints them. Alert texts keep `alert-text.ts`'s per-market stamps.
- Copy is plain English text with no parse mode.

**The alert path and the annotation turn**
- No model in the alert path.
- An annotation is the plan check: its deadline is `ALERT_DEADLINE_MS` (90 s, `src/desk.ts`), and its watchdog fires at the deadline plus `FIRING_SLACK_MS`.

**Constants**
- `ALERT_REPLAY_MS = 600_000`.
- Annotated text kept: 2,000 characters.
- Reply context: 4,000 characters.
- Health retry: 10 s.
- Watchdog `StartInterval`: 300.
- Watchdog label: `com.gravit.face.watchdog`.
- A market's poll is stale past three intervals: `3 * WATCH_US_POLL_MS`, `3 * WATCH_CN_POLL_MS`.

**Tests and commits**
- Tests run offline: `cd face && npx tsx --test tests/<file>.test.ts`; the whole suite is `npm test`; real boots run under `FACE_SMOKE=1 npm test`.
- `npm run typecheck` is clean before every commit.
- Commits are in English, written with `git commit -F <file>`. No push.

## Review Focus

These are the conditions most likely to bite the operator. Each line names the task whose tests pin it.
1. **A restart while `OFF` is in force.** The replayed alert, the lost line and the cut-turn line are held by `deliver` like any other text, never sent through the pause. (Tasks 1, 3)
2. **Telegram delivering a batch again after a crash in which only some texts were flushed.** Each text is answered once, in update order. (Task 2)
3. **Two alert passes 15 s apart while the operator's phone turn runs.** Neither check waits on the conversation; the second waits only for the first. (Task 4)
4. **The first health check after the Mac wakes.** A face that does not answer the first try but answers the second, 10 s later, is not `2`. (Task 6)
5. **The operator's own face holding the port.** The check reads `1` ("another face holds the port"), and the watchdog never restarts or kills it. (Tasks 6, 7)

---

### Task 1: Orphaned alerts replayed or reported at the ledger's first read (H2)

**Files:**
- Modify: `face/src/watch-eval.ts` — `rebuildDay` (≈ line 414); add `findOrphans` and `ALERT_REPLAY_MS`.
- Modify: `face/src/watch.ts` — the `AlertDelivered` type, and `ledgersStep` (≈ line 1037).
- Modify: `face/src/alert-text.ts` — add `lateAlertText` and `lostAlertsLine`.
- Test: `face/tests/watch-eval.test.ts`, `face/tests/watch.test.ts`, `face/tests/alert-text.test.ts`.

**Interfaces:**
- Produces:
  - `export const ALERT_REPLAY_MS = 600_000`
  - `export function findOrphans(records: readonly unknown[], now: number): { replay: AlertHit[]; lost: AlertHit[] }`
    - An orphan is an `alert` record with `decision: "send"`, inside `REBUILD_WINDOW_MS`, with no `delivered` record for its `id`.
    - It goes to `replay` when `now - t < ALERT_REPLAY_MS`, otherwise to `lost`.
  - `rebuildDay(records, now, lost?: ReadonlySet<string>)`: an id in `lost` is left out of `day.sends` but still sets its key's `lastHitAt`.
  - `AlertDelivered` gains `replayed?: true`.
  - `lateAlertText(hit: AlertHit, now: number): string`
    - First line: `late: the face restarted before this alert was sent (raised <deskTime>)`.
    - Then `alertText(hit, now, "none")`.
  - `lostAlertsLine(hits: readonly AlertHit[], now: number): string`
    - Format: `<n> alert(s) raised before a restart were never sent: <SYMBOL> <label> <deskTime>, …`.
    - At most five are named, then `and <k> more`.

- [ ] **Step 1: Write the failing tests**

```ts
// watch-eval.test.ts
test("findOrphans splits a send with no delivered record by its age", () => {
  const now = Date.parse("2026-11-03T15:00:00Z");
  const recs = [
    hit("a1", now - 5 * 60_000, "send"), hit("a2", now - 20 * 60_000, "send"),
    hit("a3", now - 1 * 60_000, "send"), delivered("a3"), hit("a4", now - 60_000, "suppressed"),
  ];
  const { replay, lost } = findOrphans(recs, now);
  assert.deepEqual(replay.map((r) => r.id), ["a1"]);
  assert.deepEqual(lost.map((r) => r.id), ["a2"]);
});
test("rebuildDay leaves a lost send out of the hour's count and keeps its cooldown", () => {
  const day = rebuildDay(recs, now, new Set(["a2"]));
  assert.equal(day.sends.length, 2);                       // a1 and a3, not a2
  assert.equal(typeof day.keys.get(keyOf("a2"))?.lastHitAt, "number");
});
// alert-text.test.ts
test("lateAlertText opens with the late line and keeps the alert's text", …);
test("lostAlertsLine names five and counts the rest", …);   // 7 hits → "… and 2 more"
// watch.test.ts (the fakes the file already has: fake ledger home, fake deliver, fake clock)
test("an orphan younger than ten minutes is delivered once at the first read, recorded replayed, with no annotation post", …);
test("an orphan older than ten minutes is one line and a delivered record 'lost to a restart'", …);
test("a replay while OFF is in force records deliver's answer and sends nothing else", …); // fake deliver → { undelivered: "paused" }
test("a later ledger read in the same run replays nothing", …);
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd face && npx tsx --test tests/watch-eval.test.ts tests/alert-text.test.ts tests/watch.test.ts`. Expected: FAIL, because `findOrphans`, `lateAlertText` and `lostAlertsLine` are not defined.

- [ ] **Step 3: Implement**

`findOrphans`, the `rebuildDay` parameter and the two text builders are as above. In `ledgersStep`, after `merged`:
1. `const orphans = findOrphans(merged, at)`.
2. `day = rebuildDay(merged, at, new Set(orphans.lost.map((r) => r.id)))`.
3. Queue one job on `onSendChain`:
   - each `replay` hit: `deps.deliver(lateAlertText(hit, clock.now()))`, then append a `delivered` record with `replayed: true` and `latency` nulls;
   - then, if any hits are `lost`: one `deps.deliver(lostAlertsLine(lost, clock.now()))`, and per lost id a `delivered` record with `delivery: { undelivered: "lost to a restart" }`.

Records go through `alerts.append` and `deliveries.set`, as the pass does. A replay never calls `queuePost`.

- [ ] **Step 4: Run the three files, then `npm test` and `npm run typecheck`** — PASS.
- [ ] **Step 5: Commit** — `fix(face): the watch replays an alert a restart caught between its decision and its send, and names older ones lost (spec §16 H2)`.

---

### Task 2: A phone text reaches the desk session once (H3a)

**Files:**
- Modify: `face/src/desk-session.ts` — `DeskSessionCtxLike` gains `sessionPersistence`.
- Modify: `face/src/desk-conversation.ts`:
  - the `post` input gains `key`;
  - the machinery gains `freezeMessage` and `MessageId`;
  - add the seen set and the flush.
- Modify: `face/src/telegram.ts` — `handle` posts with a key, and `take` stores the offset after acceptance.
- Modify: `face/src/desk.ts` — hand the booted ctx's `sessionPersistence` to the session slice if that slice lacks it.
- Test: `face/tests/desk-conversation.test.ts`, `face/tests/telegram.test.ts`, and the fakes in `face/tests/desk-fakes.ts` / `face/tests/inbox-fake.ts`.

**Interfaces:**
- Produces:
  - `DeskConversation.post(input: { text; source; message; replyTo?; key?: string })`.
  - `PostResult`'s opened arm becomes `{ opened: true; sessionId: string; duplicate?: true }`.
  - `export const deliveryKey = (updateId: number): string => \`telegram:${updateId}\`` in `telegram.ts`.
  - `DeskSessionCtxLike.sessionPersistence` with this shape:

    ```ts
    {
      open(id: string, access: "read"): Promise<{
        read(offset?: number, length?: number): Promise<{ events: readonly EventLike[] }>;
        [Symbol.asyncDispose](): Promise<void>;
      }>;
      flush(): Promise<void>;
    }
    ```

    These are dsh-session-persistence's `open` (`handle.d.ts` `read`) and `flush`.
  - `export async function readSessionEvents(ctx: DeskSessionCtxLike, sessionId: string): Promise<EventLike[]>` in `desk-session.ts`. It does `open(sessionId, "read")` and reads pages of 512 until `events` is empty. The seen set uses it, and so does Task 3.
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing tests**

```ts
// desk-conversation.test.ts
test("a keyed post builds its message with the key as its id", …);          // followup got message.id === "telegram:42"
test("a key already in the session's log opens nothing and answers duplicate", …); // fake open/read returns a user/message event with id telegram:42
test("a key already waiting in the inbox opens nothing and answers duplicate", …);
test("a keyed post answers opened only once the persistence flush has resolved", …);
test("an unkeyed post is built by createUserMessage as before", …);
// telegram.test.ts
test("the offset is stored only after the post is accepted, even when the 30 s slow line went first", …); // post resolves at 45 s on the fake clock
test("an update delivered again after a restart is posted with the same key and answered once", …);
test("a batch delivered again is answered once each, in update order", …);    // Review Focus 2
```

- [ ] **Step 2: Run them and see them fail** — `npx tsx --test tests/desk-conversation.test.ts tests/telegram.test.ts`.

- [ ] **Step 3: Implement**

The keyed message:
- Built with `freezeMessage({ id: MessageId(key), role: "user", content, source })`.
- The seen set is per session id, loaded once: `sessionPersistence.open(id, "read")`, read in pages of 512 until `events` is empty, collecting the `data.id` of every `user/message` event. It is then kept current from the conversation's `session/event` listener on `user/message`.
- The set and both `inbox.nextTurn` and `inbox.nextStep` are checked before `followup`.
- After `followup`, `await ctx.sessionPersistence.flush()` runs before the post resolves `opened`.

In `telegram.ts`:
- `handle` returns the acceptance promise (the post's settlement, or the command's reply).
- `take` awaits it before `persistOffset()`.
- `answerWithin`'s 30-second slow reply is unchanged and still goes to the phone first.

- [ ] **Step 4: Run both files, then `npm test` and `npm run typecheck`** — PASS.
- [ ] **Step 5: Commit** — `fix(face): a phone text is posted under its update's key, flushed before it counts as taken, and answered once across a restart (spec §16 H3)`.

---

### Task 3: What a restart left in the desk session (H3b)

**Files:**
- Modify: `face/src/desk-session.ts`:
  - extract `requeuePending` from `cancelKeepingQueue` (≈ line 774), which then calls it;
  - add `cutPhoneTurn` and `cutPhoneTurnLine`.
- Modify: `face/src/desk-conversation.ts` — `start()`.
- Test: `face/tests/desk-session.test.ts`, `face/tests/desk-conversation.test.ts`.

**Interfaces:**
- Consumes: Task 2's log reader, as one helper `readSessionEvents(ctx, sessionId): Promise<EventLike[]>` in `desk-session.ts`. Task 2 creates it there.
- Produces:
  - `requeuePending(agent: AgentLike, log: (line: string) => void): number`
    - Each message on `inbox.nextTurn` whose source kind is `telegram`, `alert` or `alerts` is removed and followed up again, in order.
    - A message `remove` reports as taken is skipped.
    - Returns the count.
  - `cutPhoneTurn(events: readonly EventLike[]): { turn: number; at: string } | undefined` — the last `turn/start` that has no `turn/end` after it and whose naming user message's source kind is `telegram`.
  - `cutPhoneTurnLine(at: Date, now: Date): string` — `a restart cut your message of <deskTime> before it was answered; send it again`.

- [ ] **Step 1: Measure first (not committed).**
  - Under `face/tests/tmp/`, on the stub route, with a scratch `DSH_HOME` and `FACE_DESK=0` apart from the desk rows under test:
    - boot a child face;
    - queue a phone text behind a long turn;
    - `SIGKILL` the child;
    - resume the desk session in a new child.
  - Record two answers in the SDD ledger and in this task's commit message:
    - Does resume run the pending text by itself?
    - What does the log show for the cut turn?
  - If resume runs the pending text itself, keep `requeuePending` as written: `inbox.remove` then skips a message a turn already took. Pin that with a test.

- [ ] **Step 2: Write the failing tests**

```ts
test("requeuePending takes out and follows up again the telegram and alert messages left on the inbox, in order", …);
test("cancelKeepingQueue still answers what waited behind the cut turn", …);  // the existing tests keep passing
test("cutPhoneTurn finds a telegram turn with a start and no end, and ignores a browser turn", …);
test("start, after a resume, requeues what the restart left pending", …);
test("start answers a phone turn the restart cut with one line, once per session and turn, recorded as a desk-turn cancelled by 'restart'", …);
test("the cut-turn line goes through deliver, so OFF holds it", …);           // Review Focus 1
```

- [ ] **Step 3: Implement.**
  - In `start()`, only when `ensure` resumed an existing session (not when it created one):
    1. Run `requeuePending(agent, log)`.
    2. Then `cutPhoneTurn(await readSessionEvents(...))`.
  - For a cut turn:
    1. Append a `desk-turn` event with `outcome: "cancelled"`, `cancel: "restart"`, `wallMs: 0`, `source: "telegram"` and the turn number.
    2. Then `deliver(cutPhoneTurnLine(...))`.
  - It happens once per (session, turn): a `desk-turn` already in `events.jsonl` for that session and turn skips both steps.

- [ ] **Step 4: Run both files, then `npm test` and `npm run typecheck`** — PASS.
- [ ] **Step 5: Commit** — `fix(face): at boot the desk wakes what its resumed session still had queued and answers a phone turn the restart cut (spec §16 H3)`.

---

### Task 4: The annotation lane (H1)

**Files:**
- Create: `face/src/annotator.ts`.
- Modify: `face/src/desk.ts` — `installDesk`:
  - the watch's `post` goes to the annotator;
  - stop passing `deadlineFor` for alerts;
  - the annotator is disposed before the conversation.
- Modify: `face/src/desk-conversation.ts`:
  - the alert paths move out: `replies`, `remember`, `alertOf`, `notAnnotatedLine`, `NO_CHECK`, and the alert branches of `replyOf`;
  - the generic `deadlineFor` seam stays.
- Modify: `face/src/watch.ts` — the `AnnotatedRecord` type, and `WatchHandle.noteAnnotated`.
- Test:
  - Create `face/tests/annotator.test.ts`.
  - Move the alert cases out of `face/tests/desk-conversation.test.ts` into it.
  - Update `face/tests/watch.test.ts`, `face/tests/desk.test.ts` and `face/tests/watch-smoke.test.ts`.

**Interfaces:**
- Produces:

```ts
export interface AnnotatorDeps {
  session: DeskSessionDeps;            // for createDeskAgent, as the conversation's ensure gets it
  home: string; root: string; on: SessionEventsOn;
  deliver: DeskConversation["deliver"];
  budget?: () => Promise<BudgetState>;
  deadlineMs?: number;                 // ALERT_DEADLINE_MS
  onAnnotated?: (r: AnnotatedRecord) => void;
  clock?: DeskClock; log?: (line: string) => void;
}
export interface Annotator { post: DeskConversation["post"]; dispose(): Promise<void> }
export function createAnnotator(deps: AnnotatorDeps): Annotator;
// watch.ts
export type AnnotatedRecord = { t: string; kind: "annotated"; pass: string; sessionId: string;
  outcome: DeskTurnRecord["outcome"]; sent: number[]; text: string };   // text ≤ 2,000 chars
// WatchHandle gains: noteAnnotated(r: AnnotatedRecord): void   (appends to alerts.jsonl, keeps it in memory)
```

- Behavior of `post(input)`:
  - It runs on the annotator's own chain: one run at a time, and the next post starts after the previous run's delivery.
  - Checks, in order:
    1. the pause (`readOffState`): refused `paused`, with the same line the conversation gives;
    2. the budget: refused `budget` with `budgetReplyLine`;
    3. `findDeskFenceViolation(root)`: refused `fence`.
  - Then:
    - `createDeskAgent(session, { cwd: <root>/desk/journal, route })` — the desk's route, as the conversation's;
    - `superviseDeskTurns({ …, deadlineMs })`;
    - the message (`createUserMessage`, provenance line, `input.message` as its source);
    - `followup`;
    - resolve `{ opened: true, sessionId }`.
  - The run goes on after `post` resolves:
    1. its turn's end: `appendEvent(deskTurnEvent(r, stamp, "desk/journal"))`;
    2. `deliver(reply, { replyTo: input.replyTo })`, where `reply` is the final text or the alert lines moved from the conversation;
    3. `onAnnotated({ … })`;
    4. dispose the agent, bounded by `FIRING_DISPOSE_MS`.
  - A turn that never starts or never ends is cut by a watchdog at `deadlineMs + FIRING_SLACK_MS`.

- [ ] **Step 1: Write the failing tests** (`annotator.test.ts`, with fakes for `createDeskAgent` and the bus)

```ts
test("an annotation opens at once in its own session while the desk conversation's turn is under way", …);
test("its 90 s deadline runs from its own turn's start, and the cut is answered as a reply to the alert", …);
test("its text is delivered as a reply, recorded as a desk-turn with source alert, noted annotated with the sent ids, and its agent disposed", …);
test("the pause, the budget and the fence refuse before any agent is made", …);
test("a second pass posted 15 s later waits only for the first run's delivery", …);   // Review Focus 3
test("a turn that never starts is cut by the watchdog at the deadline plus the slack, with the no-text line as a reply", …);
// desk.test.ts
test("installDesk wires the watch's post to the annotator, not to the conversation", …);
```

- [ ] **Step 2: Run them and see them fail** — `npx tsx --test tests/annotator.test.ts tests/desk.test.ts`.
- [ ] **Step 3: Implement `createAnnotator`**, then the wiring in `installDesk`, then the removal of the alert paths from `desk-conversation.ts`, moving its alert tests to `annotator.test.ts`.
  - `watch.ts` keeps `queuePost` unchanged; only its `post` dependency changes.
  - `desk-conversation.ts` exports the lines both owners print, `pausedLine` and `timedOutLine`.
  - The alert-only lines, `notAnnotatedLine` and `NO_CHECK`, move to `annotator.ts`.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`, then `FACE_SMOKE=1 npx tsx --test tests/watch-smoke.test.ts tests/desk-smoke.test.ts`** — PASS. The smoke's annotation now appears as a session of its own under `desk/journal`.
- [ ] **Step 5: Commit** — `feat(face): alert annotations run in their own desk agents on a lane of their own, never queued behind the operator (spec §16 H1)`.

---

### Task 5: A reply keeps its alert (H1b)

**Files:**
- Modify: `face/src/watch.ts` — `WatchHandle.contextFor`.
- Modify: `face/src/telegram.ts`:
  - `TgMessage` gains `reply_to_message?: { message_id?: unknown } | null`;
  - the bridge deps gain `contextFor?`;
  - `handle` posts `context`.
- Modify: `face/src/desk-conversation.ts` — the `post` input gains `context?: string`.
- Modify: `face/src/desk.ts` — wire the bridge's `contextFor` to the watch handle.
- Test: `face/tests/watch.test.ts`, `face/tests/telegram.test.ts`, `face/tests/desk-conversation.test.ts`.

**Interfaces:**
- Consumes: Task 4's `AnnotatedRecord`.
- Produces:
  - `WatchHandle.contextFor(messageId: number): string | undefined`. It looks over the watch's records within `MEMORY_MS`:
    - a `delivered` record whose `delivery.sent` holds the id gives that alert's `alertText(hit, now, "none")`, plus the annotation of its pass when an `annotation` record lists the alert and an `annotated` record names that pass;
    - an `annotated` record whose `sent` holds the id gives the pass's alerts and the annotation's text;
    - the result is cut at 4,000 characters;
    - an unknown id gives `undefined`.
  - `DeskConversation.post(input: { …; context?: string })`. The context goes as its own text part after the provenance line and before the operator's text, headed `the message this replies to:`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a reply to an alert's message carries that alert's text", …);
test("a reply to an annotation's message carries its alerts and the annotation", …);
test("a reply to a message the watch does not know carries nothing", …);
test("the bridge resolves reply_to_message.message_id through contextFor and posts it as context", …);
test("the context is its own part between the provenance line and the operator's text", …);
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement as the Interfaces block says.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`** — PASS.
- [ ] **Step 5: Commit** — `feat(face): a phone reply to an alert or its check reaches the desk conversation with that alert and its annotation (spec §16 H1b)`.

---

### Task 6: `npm run service -- status --check` (H4, the check)

**Files:**
- Modify: `face/scripts/service.ts` — add `checkHealth`; `status` gains `--check`.
- Test: `face/tests/service.test.ts`.

**Interfaces:**
- Produces:
  - `export type HealthCode = 0 | 1 | 2 | 3`
  - `export async function checkHealth(ctx: ServiceCtx, opts?: { retryMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number }): Promise<{ code: HealthCode; reason: string }>`
  - `ServiceCtx` is the context `status` already gets: deps, port, installed, home.
- Rules, the first that holds wins:
  - **`3`** — not installed (`not installed`), or installed and not loaded (`stopped`).
  - **`2`** — `fetchStatus` answers nothing on two tries `retryMs` (10 s) apart: `no answer on <port>`.
  - **`1`** — any of these:
    - the answering face's pid is not the job's: `another face holds the port`;
    - `telegram.pollFailing`: `telegram poll failing since …`;
    - `telegram.blocked`;
    - a `telegram.conflictAt` within 10 minutes;
    - `watch.state` is `lease-failed` or `held-elsewhere`;
    - a market whose `state` is `polling` and whose `lastPollAt` is older than three of its intervals;
    - `ledgerError` or `watch.ledgerError`.
  - **`0`** — otherwise, `healthy`.
- `status --check` prints the block `status` prints, then `health: <code> <reason>`, and returns the code. Plain `status` still returns 0.

- [ ] **Step 1: Write the failing tests** — one per rule, and:

```ts
test("a face that misses the first try and answers the second is not down", …);   // Review Focus 4
test("another face on the port reads 1 and nothing else", …);                     // Review Focus 5
test("status --check returns the code and prints the health line; plain status still returns 0", …);
```

- [ ] **Step 2: Run them and see them fail** — `npx tsx --test tests/service.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`** — PASS.
- [ ] **Step 5: Commit** — `feat(face): npm run service -- status --check exits by the desk's health - 0 healthy, 1 degraded, 2 down, 3 stopped (spec §16 H4)`.

---

### Task 7: The watchdog LaunchAgent (H4, the watchdog)

**Files:**
- Create: `face/scripts/watchdog.ts`.
- Modify: `face/scripts/service.ts`:
  - `WATCHDOG_LABEL`;
  - the watchdog plist;
  - `install` and `uninstall` handle both jobs;
  - `status` prints the watchdog's last state.
- Modify: `face/package.json` — add the script `"watchdog": "tsx scripts/watchdog.ts"`.
- Test: create `face/tests/watchdog.test.ts`; modify `face/tests/service.test.ts`.

**Interfaces:**
- Consumes: Task 6's `checkHealth` and `HealthCode`, and the service's restart routine.
- Produces:

```ts
export const WATCHDOG_LABEL = "com.gravit.face.watchdog";
export interface WatchdogState { outageSince?: string; degradedChecks: number; degradedSaid?: boolean; restartedAt?: string }
export interface WatchdogDeps {
  home: string;
  check(): Promise<{ code: HealthCode; reason: string }>;
  restart(): Promise<number>;                // the service's restart, its exit code
  send(text: string): Promise<void>;         // Bot API sendMessage to TELEGRAM_OPERATOR_ID, 15 s, never throws
  offInForce(): Promise<boolean>;
  now(): number; log(line: string): void;
}
export async function runWatchdog(deps: WatchdogDeps): Promise<number>;  // one check per launchd run
```

- Transitions. The state lives in `$DSH_HOME/face/desk/watchdog.json`.
  - **`0`**:
    - after an outage, the line `the desk answers again (down since <deskTime>)`;
    - the state is cleared.
  - **`1`**:
    - `degradedChecks += 1`;
    - at 2, and once per episode, the line `the desk is degraded since <deskTime>: <reason>`.
  - **`2`**:
    - the first time, set `outageSince`, run `restart()` once per outage, and send the line `the desk has not answered since <deskTime> (<reason>); the watchdog restarted it`;
    - when the restart fails, the line ends `the restart failed: <reason>` instead.
  - **`3`**: the state is cleared; nothing is sent.
- While `offInForce()` holds, no line is sent; the state and the restart go on.
- The token never appears in a line or a log: redact it as `telegram.ts` does.
- The plist:
  - `Label`: `WATCHDOG_LABEL`.
  - `StartInterval`: 300. `RunAtLoad`: false.
  - `ProgramArguments`: as the face's, ending in `face/scripts/watchdog.ts`.
  - Environment: `PATH`, `HOME`, `DSH_HOME` only.
  - Logs: `watchdog.log` and `watchdog.err.log` in the face's logs directory.
  - `Umask`: 077.

- [ ] **Step 1: Write the failing tests**

```ts
test("down once: one restart and one line; down again in the next run: neither again", …);
test("degraded twice in a row: one line; a third: none", …);
test("back to healthy after an outage: one line and a cleared state", …);
test("stopped on purpose: nothing sent, the state cleared", …);
test("OFF in force: no line, the restart still runs", …);
test("the bot token appears in no line and no log", …);
test("another face on the port reads 1, so the watchdog never restarts it", …);   // Review Focus 5
// service.test.ts
test("the watchdog plist carries its label, StartInterval 300, RunAtLoad false and the watchdog script", …);
test("install and uninstall bootstrap and boot out both jobs", …);
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`** — PASS.
- [ ] **Step 5: Commit** — `feat(face): a watchdog LaunchAgent checks the desk every five minutes, restarts a face that does not answer and tells the phone (spec §16 H4)`.

---

### Task 8: Docs, drills and the whole-branch check

**Files:**
- Modify: `DEVELOPMENT.md`:
  - §4.2: rows for `src/annotator.ts` and `scripts/watchdog.ts`;
  - §4.5: the `alerts.jsonl` kinds `annotated` and `replayed`, the cut-turn `desk-turn`, `watchdog.json`, and the second plist;
  - §7.4: the drills;
  - §9: new residuals, continuing the desk's numbering.
- Modify: `face/README.md`, "The desk drill", with three new steps:
  - **busy-desk check:** start a long phone turn, then cross a level; the check arrives as a reply within 90 s of the alert;
  - **restart:** queue a text behind a long turn, run `npm run service -- restart`, and the text is answered;
  - **watchdog:** `kill -STOP` the face's pid; within ten minutes, one line and a restart; then `kill -CONT` the stray pid if launchd has not replaced it.
- Modify: `Gravit-Docs-and-Prompt-Loops.html` — the alert loop: the check runs in its own session.
- Modify: the spec §16 — an as-built note per H.
- Modify: `Gravit-Design.md` — name the watchdog beside the service's entry (a second unattended process; it informs and restarts, nothing more).
- `CLAUDE.md` changes only if a Map row's facts move.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run `npm test`, `npm run typecheck` and `FACE_SMOKE=1 npm test`** — all pass; record the counts.
- [ ] **Step 3: Commit** — `docs: the desk hardening - the annotation lane, the restart rules, the watchdog (spec §16)`.
- [ ] **Step 4: Final whole-branch review on Fable** over the plan's range; fix what it finds and re-review.
