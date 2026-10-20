# gravit-ui on the face, stage 1 — the ledger

The rulings made while executing `2026-10-19-gravit-face-stage-1.md` (spec
`docs/superpowers/specs/2026-10-19-gravit-ui-on-face-design.md`, route A), the manual look, and
what was deferred. Executed inline (superpowers:executing-plans) on 2026-10-19 in the worktree
`.claude/worktrees/gravit-face`, branch `feat/gravit-face` from main @ 6fdca54 with `feat/gravit-ui`
merged (fc38d1f); the operator opted out of the brainstorm questions ("按A做吧"), so every answer
below is the executor's. Baselines before Task 1: face 693 pass / 15 skipped, gravit-ui exit 0.

## Pre-flight

Shared interfaces checked plan-wide before Task 1 (wire module paths, `FrameView.time`,
`toMessage` → `Message`, `listConversations(items, ctx)`, the reducer names and `emptyState`,
`makeActions` and the mux handle, the data-action set): no conflicts.

## Rulings, in the order made

1. **Subagent children are not listed** (rows with `origin`), and "Report from <child>" rows carry
   no link — the old client never rowed them; the dock is stage 3's. Cost if wrong: one filter line.
2. **A bot's home session speaks in the bot's voice**: `toMessages` takes the conversation's
   speaker, so `from` is the preset when it names a bot, else `gravit`; gravit-ui's kind `bot`
   means that home session (members `[botId]`), not "Gravit plus one bot" — R12 would otherwise
   return. Cost if wrong: one ctx field.
3. **A member session's gate folds into the parent room's thread** in the member's bot name; the
   Messages badge counts the room. Cost if wrong: a gate drawn under the wrong row.
4. **A `user/message` whose source is not the operator's** (a compaction checkpoint, a plugin
   notice, runtime context, a member's delta) is a system row, never a You bubble. Cost if wrong:
   a compaction summary read as the operator's words.
5. **`group` = the `room` projection reads `kind:"room"` OR the fold lists members**; members =
   projection ∪ fold; a fresh channel session with rostered bots stays `gravit` until its first
   dispatch or `@`; the New-message `To:` row is dropped from stage 1 (channels.json carries no
   roster). Cost if wrong: the cluster avatar appears one turn late.
6. **The branch lands ONCE, after stage 3**; no transitional route for the old client; main's face
   stays the daily one meanwhile; PR #7 is superseded then. Cost if wrong: a longer-lived branch.
7. **Stage 2, recorded now: `/data/bars`** passes a validated symbol on a fixed `execFile` argv
   (the quote grammar), keys-first with the bed as fallback and an as-of stamp; data.ts's "no
   request data reaches the child" becomes "no unvalidated request data". Cost if wrong: a
   producer rewrite.
8. **Gravit's model/provider/effort readout and the host facts move to stage 3** (a Gravit item on
   Discover's Agents shelf); stage 1's Details carries no Model row. Cost if wrong: one row later.
9. **Task 1:** two test groups executed `chat.js`'s own source through `vm` (`api.test.ts`'s
   reconnect race, `subagents.test.ts`'s follow/page, gates-across-reconnects and dock
   controllers); `chat.js` is deleted by the spec, so they were removed, and Task 7's
   `live.test.js` re-pins the policy ones by name against a fake host. The dock's tests return
   with the dock (stage 3). Cost if wrong: a behaviour the old suite proved slips until Task 7's
   tests run.
10. **Task 1 (a recorded trap, not a decision):** the moved tests' dynamic `import('../js/…')`
    and `new URL('../css/…')` reads needed a second rewrite pass — the first matched static
    `from` lines only.
11. **Task 3:** the plan's `toMessage(view, calls, now)` is `toMessages(view, calls, now,
    speaker)` returning an array (an order tool's result yields the row AND a receipt or refusal);
    `rememberCall(calls, frame)` reads the RAW frame, because the mapper's card carries a title,
    not the arguments; a Gravit bubble is flagged `data.markdown = true` rather than pre-rendered
    (kinds.js stays DOM-free; the renderer turns the flag into HTML); a Gravit bubble with no text
    (a tool-only step) yields nothing. Cost if wrong: one call-site change in Tasks 7 and 8.
12. **Task 5:** the host reducers, `emptyState` and the wider `needsAnswer` were ADDED beside the
    demo reducers, which stayed until Task 10 swapped the boot; a gate message carries `seq = max
    event seq + 0.5` so it sits after the event it arrived behind. Cost if wrong: the removal list
    moves one task.
13. **Task 7:** `hostList` also takes the channel list; the plan's `GATE_REPLAY_GRACE_MS` is not
    exported — `api.js` already retires a gate the new generation did not re-deliver
    (`retireUnreplayed` → `onGateGone`), so the live layer owns no grace timer; `turn` frames set
    `running` beside `api-session/status`; a window is folded through `reducers.hostEvent` on a
    scratch state so backfill and stream share one merge rule. Cost if wrong: one reducer
    parameter and one constant.
14. **Task 8:** Gravit's markdown comes through `setMarkdown(fn)`, a hook the app sets at boot
    with the DOM-built `wire/markdown.js` (`node.outerHTML`) and tests stub — thread.js stays
    DOM-free; the gate keys carried both `data-value` and the demo's `data-answer` until Task 10;
    an unknown kind still falls to a plain bubble; six demo tests that drew removed kinds were
    dropped. Cost if wrong: one attribute to delete in Task 10.
15. **Tasks 9+10 were executed as ONE change set and one commit** — the renderers read host-shaped
    state the demo boot could not produce, so a green suite between them was impossible without a
    throwaway shim; each renderer still got its test first. `state.bots` rides the hostList
    payload; the seed moved to `tests/client/helpers/seed.js` as a fixture for the stage 2/3
    screen tests; VENUES and CONNECTABLE moved to `js/data/markets.js`; routes outside Messages
    normalise to Messages. Record: the new `app.test.js` / `app-dom.test.js` were written in the
    same turn as the new `app.js` and first ran against it — their RED against the old boot was
    certain but not observed; two of them failed on wrong expectations (list order, follow count)
    and were corrected. Cost if wrong: one commit to split; a dent in the TDD record.
16. **Tasks 9+10:** Settings (the theme) is reachable from a key at the rail's foot; the demo's
    Reset demo left the Settings drawer; the Markets/Trade DOM tests (boot-based on the demo) were
    deleted and return with stage 2's host-fed screens; the demo tests whose reducers left were
    dropped, the stage 2/3 screen tests keep running on the seed fixture.
17. **Task 11:** the smoke asserts what a bare `bootFace` can show — the `/data` routes are
    `main.ts`'s, so the channel index is unreachable there and the smoke pins that the live layer
    tolerates it; a session `session/create` just made is LIVE, so its open is a follow whose
    snapshot is the window, and the paged path stays pinned by `live.test.js` against the fake
    host. Cost if wrong: a smoke that proves one path less than the plan's wording.
18. **The Google Fonts link stays** as the front-end design has it (the browser's fetch, the
    system stack offline); vendoring is a one-commit change if the operator wants no egress from
    the page.
19. **Task 11:** the one `FACE_SMOKE` failure after Task 10 was `smoke.test.ts`'s boot smoke still
    asserting the old page (its `GRAVIT` brand text, its `chat.css`); its page assertions now
    follow the new `index.html`. Cost if wrong: none.
20. **Task 12:** the manual look showed three defects, each fixed under a test that failed first:
    injected user-role records (the agent-instructions reminder, the runtime-context snapshot)
    were drawn as full system lines and are now a collapsed `context · <source>` details
    (`thread.test.js`); the row preview read those records as the last line — `live.js`'s
    `lastText` now goes through the kind table and takes the last SPOKEN line (`live.test.js`),
    and `rail.js`'s fallback `previewOf` skips system and tool rows (`rail.test.js`); `app.css`
    read `--mono`, a token nobody declares, so the tool row's font fell back to sans —
    `--font-mono`, pinned by a css test that every token read is declared (`css.test.js`). Cost if
    wrong: one renderer, one reader, one token.

## Tasks

| Task | Commit(s) | Suite |
|---|---|---|
| 1 Move gravit-ui into `face/client`, serve it at `/` | 1c8903d..41ac86d | green |
| 2 `mapper.js` gains `time` | 8feca59 | green |
| 3 The kind table (`js/host/kinds.js`) | 77cc873 | green |
| 4 Rows → conversations (`js/host/sessions.js`) | 385dbf1 | green |
| 5 The host reducers | 7bb057a | green |
| 6 Actions | bc49726 | green |
| 7 The live layer | 692b1c9 | green |
| 8 The thread | e608d5f | green |
| 9 + 10 Rail, head, Details, composer, New message; the app boots on the host | f92de9b | green |
| 11 The client smoke on a real boot (+ the boot smoke's page assertions) | e083bec | green; `FACE_SMOKE=1` 887/887 after the fix |
| 12 Documents and the manual look | this commit and the one before it | green |

## The manual look (2026-10-19)

A face on a scratch `DSH_HOME` (profile set up, AKShare and the operator's rows absent, no model
key), opened in the browser pane through the printed `?token=` URL:

1. The empty state: `Nothing handed to Gravit yet`, the composer, no status line (connected).
2. **New message**, Where = `workbench` (the root channel, first in the select; `aqr-r1000` and
   `room-drill` listed after it), a first line → `session/create` with that `workspaceId`,
   `session/prompt`; dsh titled the session from the first words; the row appeared on the list
   and the conversation opened as a follow.
3. The model's failure reached the status line in red — `llm-deepseek: no API key for provider
   route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service …` — and
   nothing crashed; the thread showed the operator's line and, folded, the two injected context
   rows (`context · agent-instructions`, `context · runtime-context`). Before the Task 12 fixes
   those two rows were walls of text and the row's preview read the runtime snapshot.
4. The face restarted, the page reloaded with the new token: the now-cold session opened PAGED —
   `session/projections` + `session/page` on the wire, no follow — and `session/list` after the
   open still reported it `agentAvailable: false`; the window was redrawn whole, the preview read
   the operator's line.

Not walked (no key on the scratch home): a reply streaming, a gate card raised by a real turn, a
reconnect mid-view — the Gate-2, ask-user and transport drills in `face/README.md`, on a copy of
the real home.

## Deferred minors

- The empty state's three suggestion chips keep the demo's prompts (Buy a little BTC · Follow
  Pelosi · Check an address) — the front-end spec's copy; they only fill the composer.
- The tool row shows the raw result `<pre>`; the pretty alpaca-kit renderers
  (`js/wire/render.js`) are in the tree and uncalled until stage 2.
- Gravit's reasoning text (the mapper's `thinking`) is dropped by the kind table — no `think` row
  yet; a later stage decides where it goes.
