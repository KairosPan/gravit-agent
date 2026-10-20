# gravit-ui on the face, stages 1 and 2 — the ledger

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
   `live.test.js` re-pins the policy ones against a fake host — all but two, the final review
   found: a failed open still drawing its gates, and a new conversation followed before its first
   prompt, are not pinned by name (DEVELOPMENT §7.3 says so). The dock's tests return
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
| 1 Move gravit-ui into `face/client`, serve it at `/` | 0ab3b00 (the move itself — `gravit-ui/` → `face/client`, the wire modules into `js/wire`, the tests into `face/tests/client`, `chat.js` and gravit-ui's own files deleted — staged by Task 1's `git mv` steps and swept into the builder-check answers' `docs:` commit by mistake), 41ac86d (the import rewires, the test script, the page) | green |
| 2 `mapper.js` gains `time` | 8feca59 | green |
| 3 The kind table (`js/host/kinds.js`) | 77cc873 | green |
| 4 Rows → conversations (`js/host/sessions.js`) | 385dbf1 | green |
| 5 The host reducers | 7bb057a | green |
| 6 Actions | bc49726 | green |
| 7 The live layer | 692b1c9 | green |
| 8 The thread | e608d5f | green |
| 9 + 10 Rail, head, Details, composer, New message; the app boots on the host | f92de9b | green |
| 11 The client smoke on a real boot (+ the boot smoke's page assertions) | e083bec | green; `FACE_SMOKE=1` 887/887 after the fix |
| 12 Documents and the manual look | b2d6477, be5ab99 | green |
| Final review: the fix pass (below) | 7c268b3, and the docs commit after it | 891/891; `FACE_SMOKE=1` 907/907 |

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
  (`js/wire/render.js`) are in the tree and uncalled until stage 3 (spec §7, the research surfaces).
- Gravit's reasoning text (the mapper's `thinking`) is dropped by the kind table — no `think` row
  yet; a later stage decides where it goes.
- From the final review (below), each confirmed by its verifier and graded minor by effect:
  a slash command on a cold conversation does not promote the paged view at once (the next
  list refresh does, ~1.2 s later); a failed rename after a successful create in New message
  aborts the first prompt and leaves an empty Untitled session; a 401 on the list or an open
  reads `list: HTTP 401` / `open: HTTP 401` rather than the sign-in sentence; the operator's
  bubble collapses newlines (no `white-space: pre-wrap`); a room member's answer is drawn as
  escaped text, not markdown; a gate replayed after a reconnect takes the replay time, so its
  divider can lie; a gate raised in a bot's home session is drawn with Gravit's avatar; a turn
  that ends without a message (an error or a cancel mid-stream) can leave the thinking row on
  screen; a subagent report is a full centred line, not one folded past two lines (spec §6), and
  doubles its prefix — `Report from child-7: Agent child-7 sent a message: …` — while calling a
  runtime settlement notice a report too.
- Test coverage the final review listed, nothing broken today: the Change-words glue
  (`.inline-edit [name]` → `session/rename`), Enter/Escape in an inline editor and Escape on a
  confirm, the empty state's chips and `cancelDraft`, the rows' and the page's scroll bookkeeping,
  a failed open (`open: <code>`, the view never promoted or reconciled), the control stream's
  re-open timers, a bot home's window spoken as the bot through the live layer and its Details
  Agent row. The fix pass covered the composer's restored words, the thread's place and a
  double-clicked key.

## Final review (2026-10-19..20)

A fresh whole-branch review of `fc38d1f..be5ab99`: five independent reviewers, one lens each
(plan alignment and the plan's Review Focus; the host layer; the wire and the actions against
the old `chat.js`; rendering and safety; tests and documents), and every finding put to one
skeptic prompted to refute it against the code. The first run lost 11 of its verifiers to a
usage limit; it was resumed, and the resume re-verified more than those 11, since the run's cache
covers only an unchanged prefix of agent calls. The first run confirmed 36 findings, which come to
14 distinct defects, one critical; all 14 were fixed in one pass (`7c268b3`), each under a test
that failed first. The resumed run confirmed 38 and refuted 9 (four of those as already fixed at
`7c268b3`); it agreed with the first on every defect and added a re-grade (fix 15) and the
documents' findings (below). After both fix commits the face suite is 891/891 (16 real boots
skipped), `npm run typecheck` is clean, and `FACE_SMOKE=1` is 907/907.

**Fixed** (the failing-first test in brackets):

1. **Critical — every Gravit bubble read `undefined`.** The markdown hook read `.outerHTML` on
   `renderMarkdown`'s `{node, doc}`; it reads `.node.outerHTML` (`gravitMarkdown`). Nothing had
   drawn a Gravit bubble on a real page: the manual look ran without a model key. [app.test.js
   "the markdown the app installs for Gravit's words is the rendered HTML, never the word
   undefined", on a small DOM, `tests/client/helpers/mini-dom.js`, that runs the real
   `markdown.js`]
2. **The markdown had no styles**, and the sheet's global `a { color: inherit }` hid every link;
   `app.css` gains the `.md*` and `.viz-table` rules, links coloured and underlined. [css.test.js
   "Gravit's markdown has its rules"]
3. **A gate this tab answered came back answerable** on every re-open and reconnect: the live
   layer dropped a gate only on a mux report the winner never gets. `live.answer` settles it on
   the win. [app-dom.test.js "a gate this tab answered stays answered"]
4. **A lost race read as this tab's outcome**: a `cancel` trailing this tab's resolved answer
   (api.js reports it) now reads `Settled elsewhere`. [app-dom.test.js "a lost race … relabels
   the card Settled elsewhere"; host-reducers.test.js "hostGateGone 'elsewhere' overrides"]
5. **A room member's gate replayed before the list landed was lost** when the room's window
   loaded: a gate is placed by its session at every dispatch (`placeGate`). [live.test.js "a room
   member's gate replayed before the list lands survives the room's window load"]
6. **A double-click on ✓ painted `answer: gate-gone` red** over an approval that stood: one
   answer per gate in flight. Re-graded from minor (Ruling F1 below). [actions.test.js "a second
   press while the first answer is in flight sends nothing"]
7. **Two pending question cards with the same question id shared a radio group** and traded
   answers: inputs are named and id'd `q-<eventId>-<questionId>`, the app reads the pressed card
   alone and matches by name. [app.test.js "answersFrom reads only its own card"; thread.test.js
   the question card]
8. **No free answer beside a menu**: dsh's `custom` was reachable only for a question without
   options (the plan's `allowCustom` is not a dsh field); every question has the box. [thread.test.js
   the question card]
9. **A re-render wiped a question card's pick, typed answer and focus**: ticked inputs with an id
   are kept across the rebuild, and the card's inputs carry ids. [app-dom.test.js "a question
   card's pick, free answer and focus survive a re-render"]
10. **A bare press on Answer settled the gate with an empty batch**: refused on the status line,
    `Answer every question first`. [app-dom.test.js "a bare press on a question's Answer sends
    nothing"]
11. **A failed `/data/rooms/say` re-sent the @-line to Gravit as a prompt**: `postJsonVia`
    rejects a failed status or the route's `{ok:false}` with its words, as the old page's
    `panelData` did. [app-dom.test.js "an @ goes through the room route"]
12. **The bots' names never reached the store**, so every screen showed bot ids: `hostList`
    carries them. [live.test.js "the bots' display names from /data/bots.json reach the store"]
13. **Row previews never refreshed**, the open conversation's included: a row is re-read when its
    session moves (`updatedAt > previewAt`) and only then, and the conversation on screen
    previews from its own window. [live.test.js "previews: a row is re-read when its session
    moves, and only then"; rail.test.js "the conversation on screen previews its own window";
    host-reducers.test.js "hostList keeps when a surviving row's preview was read"]
14. **The thread jumped to the bottom on every new event** while the operator read up: it keeps
    their place unless they were at the bottom or the conversation changed. [app-dom.test.js
    "the thread keeps the reader's place"]
15. **A room member's answer was drawn as raw text**: its bold, tables and `[name](url)` sources
    showed as syntax on one line, while the same bot's words in its home session were markdown
    and the old client drew both; the bot branch of the kind table sets the markdown flag
    (`4d5f541`). Re-graded from minor (Ruling F5). [kinds.test.js "Gravit's words are a text
    message flagged for markdown, the bot's words carry the bot's name"]

**The documents** (re-graded, Ruling F4), corrected in the docs commit: DEVELOPMENT §7.3 and §5.1
claimed `live.test.js` re-pins "a failed open still drawing its gates" and the whole old policy
by name — two cases are not pinned, and both sections now say which; the suite's totals were the
base's (708 tests in 64 files, 15 skipped, "fifteen real boots" in eight places, CLAUDE.md's
"15 real boots", the README's 15) — now 907 tests in 88 files, 891 pass, 16 skipped, sixteen boots;
§5.1 filed the Settings drawer's reducers under `messages.js`/`controls.js` — they live in
`reducers/account.js`; the README's "Temporary subagents" and "The master rail" sections described
the old page's panel and rail in the present tense — each now opens with a stage-1 note; the task
table filed Task 1 under `1c8903d..41ac86d` — the move itself is in `0ab3b00`, a `docs:` commit
that swept up the staged renames (the table now says so; the branch's history is not rewritten).

**Resolved by those fixes, no separate change:** answersFrom built attribute selectors from the
model's question id, so a quote in an id threw inside the click handler (gone with fix 7: inputs
are matched by name); rows read and found silent were re-paged on every refresh (gone with fix
13, pinned by its test's silent half); DEVELOPMENT §5 cited a spec file that does not exist (a
`10-09` typo, corrected with the docs).

**Rulings on the review:**

- **F1.** A double-clicked gate key painting `answer: gate-gone` red after the card reads
  `Approved` was graded minor by its reviewer and verifier; re-graded Important: on an order card
  the red refusal says the approval was not applied when it was, a double-click is an ordinary
  slip, and the operator might ask Gravit to place the order again. Cost if wrong: one Set and one
  test.
- **F2.** The bots'-names defect was confirmed four times, twice graded important and twice
  minor; graded Important: every room head, Details and avatar showed `drill-bull` where the
  operator named the bot `看多派`, and ruling 15 had promised the names. Cost if wrong: none.
- **F3.** An answered card now leaves its conversation on the next window load (a re-open, a
  reconnect), like a closed or withdrawn one, rather than staying with its chip: the old client
  did the same, the store holds no gate the host has settled, and the record survives in the
  transcript (an order's receipt or refusal, a tool row's result). Cost if wrong: a chip the
  operator might want to see again.
- **F4.** The documents' findings were graded minor by their verifiers; re-graded Important on the
  operator's standing rule that the English design documents are a first-class deliverable and
  must be accurate — a sentence in the as-built reference that names a test that does not exist,
  or counts the base's suite, misleads the next session as surely as a code defect misleads a user.
  Cost if wrong: one docs commit.
- **F5.** A room member's answer drawn as raw text was graded minor by the first run and important
  by the resumed run's verifier; graded Important: rooms are a stage-1 surface, a tracked bot
  (`news-scout`) writes its sources as markdown links, and the same bot rendered markdown in its
  home session. Cost if wrong: one flag and one assertion.
- **F6.** The list refresh coalesces in a fixed 1.2 s window that its first trigger opens, where
  the old client's debounce re-armed on every trigger: through a sustained burst this one refreshes
  every 1.2 s instead of once at the end — never staler than 1.2 s, a few more requests to
  127.0.0.1. Not decided in Task 7, found by the review; it stands and DEVELOPMENT §5.2 now says
  so. Cost if wrong: one line (clear and re-arm the timer).
- **F7.** Not walked on a real host: the Gate-2, ask-user, transport and room-`@` drills — the new
  host layer's gates and rooms are proven against fake hosts and fixture frames, and the real-boot
  smokes prove the wire and one session opened through the host layer, no gate and no room. A
  review finding called stage 1's "Done when" unmet on that ground; its verifier refuted the
  finding (nothing calls stage 1 done, every drill-status line marks the live drills as still to
  run, the branch lands only after stage 3) while agreeing on the fact. The drills stay the
  operator's, on a copy of the real home, before the branch lands.
- **F8.** The review's "declined to judge" lines, de-duplicated across the five lenses, each
  stand: the empty state's demo chips (spec §7 keeps them; the copy is the operator's); the Google
  Fonts link (ruling 18); the raw tool `<pre>` and the dropped reasoning text (deferred, spec §6–§7);
  `api-session/error` shown only for the conversation on screen, a plain withdrawal reading
  `Closed`, `reconcile` trusting a list up to 1.2 s old, a list row resetting `running`, a refused
  follow being terminal for its open, an off-screen order card keeping its tool-name fallback,
  and a cross-session order card lacking the order line (each the old client's behaviour); a
  room member's turn not lighting the room's Working chip (spec §5's accepted loss: members are
  not followed); Tasks 9 and 10 in one commit, `GATE_REPLAY_GRACE_MS` not exported, `hostList`
  taking channels and bots, `toMessages` returning an array, origin rows not listed, New message
  without a To: row (rulings 1, 5, 11, 13, 15); a missing `time` drawing a NaN divider and an
  empty title projection looping the refresh (both unreachable on the pinned host: `time` is
  required, a title is ≥ 1 character or null); `open()` bumping its token before the guard and
  `go()` calling `follow()` twice (unreachable through `app.js`, guarded by `openedId`); the
  whole-page `innerHTML` render per dispatch (the settled architecture; no measured scenario —
  a watch item for long threads); `messages.js` keeping the demo kinds and `isClosed` (stage 2's
  screens still import it); no `@ → <names>` line after a successful say, a failed send restoring
  the words into whatever conversation is on screen, `fail()` showing the host's code, the
  slash-before-@ order, trimmed prompt text (polish or by design); `focusKey`'s unescaped data
  attributes (host-minted values only); the New message placeholder, the Settings drawer
  overlaying the composer, the old `doc` widening dropped (the front-end spec governs); the
  Settings splice through `String.replace` (renderSettings takes no host text); the narrow layout's
  scroll bookkeeping and a Safari Enter after pinyin (outside this stage's desktop target; a drill
  item); `static.test.ts` unchanged (its own fixture); the always-empty `deleted` set (stage 3's
  row actions); an optimistic rename reverted by a lagging list (the transport drill's step 6
  observes it); a gate's `at` being its arrival time (the waterfall carries no time); the open
  conversation marked seen on every refresh (intended); the market watchlist's legacy key
  (stage 2). The one declined line the fix pass overturned is fix 6's: two clicks on a gate key.

## Stage 2 (2026-10-20)

The rulings made while executing `2026-10-20-gravit-face-stage-2.md` (spec §7 Stage 2 and §8):
Markets and Account on the face, `GET /data/bars`, the old `/market` and `/account` pages and
Trade removed. Executed inline (superpowers:executing-plans) on 2026-10-20 in the same worktree,
`feat/gravit-face` from 21d2a69 (stage 1's final 87c6dc3 plus the plan); the operator's words
were still "先做完A" and "按A做吧", so every answer below is again the executor's. Baselines
before Task 1: face 891 pass / 16 skipped (`FACE_SMOKE=1` 907/907), pytest 381, typecheck clean.

### Pre-flight

The shared interfaces checked before Task 1 — the four wire modules' paths, the route's
`[SYMBOL, DAYS]` argv against `face_bars.py`'s, the bars payload against `barsWord` and
`chartSvg`, the views' state fields against the host reducers, `startMarkets` / `startAccount` /
`onReceipt` against the boot wiring, the page's Statement key against the Account route, and the
order in which `trade.js`, `data/markets.js` and `market-fmt.js` lose their last importers: no
conflicts.

### Rulings, in the order made

Each with what it costs if wrong.

1. **Task 2.** markStale moves from data.ts to http.ts (the shared HTTP primitives), so data.ts and bars.ts share it without bars.ts importing a runtime value from data.ts (data.ts imports bars.ts); the plan's file list did not name http.ts — cost if wrong: none.
2. **Task 2.** a repeated days parameter is a 400 like a repeated id (the plan's contract named only a repeated id) — one value per key, no guessing which wins — cost if wrong: one condition.
3. **Task 4.** a notional order adds "· <n> filled" once it has fills; the brief's "Buy $500 AAPL · market" is the unfilled case — a filled notional order would otherwise hide how much it bought — cost if wrong: one clause dropped.
4. **Task 4.** the allocation buckets keep the fixed order cash, equity, crypto, stable and omit empty ones — colour follows the bucket, never its rank — cost if wrong: a reorder.
5. **Task 4.** while searching, a watched hit shows its live quote over the one REST hit quote; with no query a row never shows a hit quote — the stream is fresher, and an old hit quote must not read Live on a watched row — cost if wrong: one fallback line.
6. **Task 4.** sourceWord names the provider by the quote's market (us Alpaca, crypto Coinbase, cn iFinD), not by the wire's source string — the cn source string is Chinese — cost if wrong: a cn quote served by another source reads iFinD.
7. **Task 4.** positionId lives in market-view.js and account-view.js imports it — one mapping from a position to a face id — cost if wrong: none.
8. **Task 5.** a market page's own asset joins the live subscription first (page, watchlist, holdings) — the spec's page shows a price that moves, and a page opened from a hit would otherwise read No quote — cost if wrong: one more id in the stream.
9. **Task 5.** wire/market-quotes.js exports its parsePayload — the hits' REST read and the Venues probe pass the stream's own validation — cost if wrong: one export on a wire module.
10. **Task 5.** startMarkets pauses the live quotes at start and keeps the subscription current while hidden — a paused wire opens no connection, and show(true) resumes on the set already chosen — cost if wrong: none.
11. **Task 5.** startAccount takes an optional now (default Date.now) for the read's at — the plan's signature has none and the test needs a clock — cost if wrong: none.
12. **Task 5.** an ok:false body from /data/account.json reads as a failure, like a rejection — only ok:true is an answer — cost if wrong: none.
13. **Task 5.** barsLoading keeps the previous payload while a reload is in flight, barsFailed drops it, and a later call's answer wins over an earlier one — no blink on reload, no chart without a current answer — cost if wrong: a chart blinks on reload.
14. **Task 6.** venueConnected (reducers/controls.js) drops its ticket hand-off with the trade slice — the ticket is gone and the Connect panel itself leaves in Task 8 — cost if wrong: none.
15. **Task 6.** data/markets.js loses TABS, KINDS, SORTS, INTERVALS, instrumentOf, listed, kindOf, fnv and seriesOf now, keeping only what the Account panels read until Task 8 deletes the file — the brief's grep pins INTERVALS gone — cost if wrong: none.
16. **Task 6.** the quote's state is its own muted column (mk-c-st); a narrow table (620px) drops Volume and the state, a phone (440px) the change too — the brief names the columns, not their narrow behaviour — cost if wrong: CSS only.
17. **Task 6.** with a query the one-liner is the search's word, without one the quotes' connection word; the watchlist's word shows in both — the connection is about the list, not the hits — cost if wrong: a connection word hidden while searching.
18. **Task 6.** #/markets/<id> draws a stub page (the way back and the head) until Task 7 fills it, and an id no list knows opens by its symbol — cost if wrong: none.
19. **Task 6.** the router decodes a percent-encoded market id (crypto:BTC%2FUSD) and settle writes the raw form back — a pasted link reads the same — cost if wrong: none.
20. **Task 6.** boot's default quote and search factories bind to win.fetch and win.EventSource, so a test window without them never connects — cost if wrong: none.
21. **Task 7.** You hold and On the statement are drawn only once /data/account.json answered with an account; keyless or unread, both are absent rather than saying "You don’t hold any." — an unknown is not a none — cost if wrong: two sections missing on a keyless face.
22. **Task 7.** the page's quote is the live one, else the hit's REST quote; with none the price reads — and the state No quote, and Source still names the market's provider — cost if wrong: none.
23. **Task 7.** the as-of time reads HH:MM today, else "Oct 17 14:30", in the viewer's zone through time.js (the wire's quoteTime writes Chinese) — cost if wrong: format only.
24. **Task 7.** the chart's dates are the bars' own ISO days, like barsWord's as-of — cost if wrong: format only.
25. **Task 7.** the page matches statement fills to the asset by positionId over the order's symbol, so BTC/USD and BTCUSD both land on crypto:BTC/USD — cost if wrong: none.
26. **Task 7.** Hand to Gravit names the symbol, and the name when it differs ("Look at AAPL (Apple)", "Look at MSFT"), and focus lands in the composer — cost if wrong: none.
27. **Task 7.** a page reads its bars once per opening; leaving and coming back reads again, a re-render never does — the route caches for ten minutes, so a reopen is cheap — cost if wrong: one extra read per reopen.
28. **Task 8.** the Statement omits Export CSV when it has no filled rows (No filled orders) — there is nothing to export — cost if wrong: a key that exports a header only.
29. **Task 8.** Loading… shows while the first read is in flight and nothing is loaded — a status word, like the connecting line — cost if wrong: one word.
30. **Task 8.** any unreadable answer that reaches the store reads Account unavailable, and the keyless one reads the face's own words, never the wire's reason or error text — cost if wrong: none.
31. **Task 8.** Refresh on Venues reads the account only; the venue facts are read on each entry into Venues — they change rarely — cost if wrong: key or tool facts stale until the next entry.
32. **Task 8.** Export CSV revokes its object URL on the next tick rather than synchronously — some browsers cancel a download whose URL is revoked in the same task — cost if wrong: none.
33. **Task 8.** the allocation legend rounds each bucket to a whole percent while the bar keeps two decimals — cost if wrong: a legend summing to 99 or 101.
34. **Task 8.** render/discover.js still reads state.account.wallet, which the empty state no longer carries; Discover is not routed until stage 3 rewrites it — cost if wrong: Discover throws if routed before stage 3.
35. **Task 8.** thread.js keeps ticker and withTickers (the demo's #/markets/<SYMBOL> links, no caller on screen now, pinned by thread.test.js) for stage 3's tool-row renderers to replace — cost if wrong: one dead helper.
36. **Task 9.** scripts/serve-research-demo.mjs leaves with the pages — it served chat.css and navigation.js, both deleted here, so it could no longer draw its fixture; the landing image it produced stays — cost if wrong: the research screenshot fixture has to be rebuilt on the new client.
37. **Task 9.** chgHtml drops its cents unit with the prediction cards, and market-fmt.js keeps chgHtml alone — cost if wrong: none.
38. **Task 9.** client/channels.js and the old chat page's other tested modules stay (DEVELOPMENT.md keeps them for stage 3), although the research fixture was channels.js's only importer — cost if wrong: one more orphan until stage 3.

### Tasks

| Task | Commits | Result |
|---|---|---|
| 1 The market and account wire modules move under `js/wire` | 0bb9deb | green |
| 2 `parseInstrumentId` and `GET /data/bars` | ba9e2df | green |
| 3 `scripts/face_bars.py` | 37e47d4 | pytest 400 passed |
| 4 The market and account views (pure) | fa75ba3 | green |
| 5 The markets and account host layers | bb099fc | green |
| 6 Markets on screen; the demo Markets and Trade leave | 4315232 | green |
| 7 The Market page and its chart | e00c5ab | green |
| 8 Account on screen; the demo Account leaves | 5ac3772 | green |
| 9 The old pages leave | fca1814 | green; `FACE_SMOKE=1` 933/933 |
| 10 Documents and the manual look | ca8355b (the manual look's fix), and the docs commit | 918 pass / 16 skipped; `FACE_SMOKE=1` 934/934 |

### The manual look (2026-10-20)

A face on a scratch `DSH_HOME` under the worktree's ignored `.superpowers/look` (profile set up,
the operator's rows absent, no APCA, DeepSeek or iFinD key, `ALPHA_PIT_ROOT` pointed at a missing
directory so no bed), on port 3091, started in a Terminal tab — the browser pane's own process
cannot read inside the worktree — and opened in the pane through the printed `?token=` URL at
1280 × 800:

1. Markets: `Nothing watched yet` under the search box and the three tabs.
2. Search `AAPL`: `5 markets for “AAPL”`, Apple Inc. first; every row `—` and `No quote` (no
   Alpaca keys). The star watched Apple.
3. Search `BTC`: `4 markets for “BTC”`; Bitcoin USD `$82,710.53 ▲ 1.1% 5.2k BTC Live` from its one
   REST read (Coinbase). The star watched it. Clear brought the watchlist back — Bitcoin first
   under Most traded, its price moving on the stream, Apple last with `No quote` — but left `BTC`
   in the search box: the render loop keeps what an input holds. Fixed under a test that failed
   first (ca8355b) and re-checked on the page: the box empty, focus in it, the watchlist's two
   rows.
4. The Apple page: `Stock · AAPL · NASDAQ`, Hand to Gravit and Watching, the price `—`, `No
   quote`, the facts (`—`, `—`, `Alpaca · IEX`) and no Price history:
   `/data/bars?id=us%3AAAPL&days=120` answered 503 with the producer's own `{"ok": false,
   "error": "no bar source"}`. No You hold or On the statement on a keyless face (ruling 21).
5. Hand to Gravit: New message, Where `workbench`, `Look at AAPL (Apple Inc.)` in the composer —
   cancelled, never sent.
6. Account: `No APCA keys in the environment`, no chip, Account current in the rail. Venues: the
   `Alpaca` row reading `No keys · Order tools off` (the scratch home has no alpaca-kit row), and
   Quotes `Alpaca · Not configured`, `Coinbase · Connected`, `iFinD · Not configured`.
7. `/market`, `/account` and `/client/market.html` answered 404, `/client/js/host/markets.js`
   200; the console held only those probes and the two bars 503s, no script error.
8. A reload kept the watchlist. One reload made while the pane was hidden booted `Paused`
   (`document.hidden` at boot) and resumed on the next `visibilitychange` — the screen follows
   `document.hidden` by design; a reload in a visible pane streamed at once.

Not walked: a keyed account (holdings, the Statement, Export CSV through a real download), live
US quotes and Alpaca bars, the bed-served chart (no bed in the worktree). Each is pinned by
tests; the keyed look is the operator's, on a copy of the real home, with the drills before the
branch lands.

