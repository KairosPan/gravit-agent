# The Account grafted into the face, stage 1 (the reads) — the ledger

The record of executing `2026-10-22-account-graft-1-reads.md` (the plan, committed at 8d019bf;
spec `../specs/2026-10-22-account-graft-design.md`, §5.1–§5.2, §6.1–§6.2, §6.5 and §10) on branch
`feat/account-graft`, cut from main @ 0481ee2, in the worktree `.claude/worktrees/account-graft`,
on 2026-10-22. Executed subagent-driven by the operator's choice ("Subagent-driven（opus），开始"):
every implementer and every reviewer on the opus model, one task after another, each task's
tests seen failing first, a task review after each task and a scoped re-review after each fix
round. The Account is Linqi's buyer-agent-demo @ 133b9a7, installed at `~/buyer-agent-demo`;
nothing of it is vendored. The SDD workspace's `progress.md` is the working copy this file
records. Baseline before Task 1: face 1081 tests (1064 pass, 17 skipped).

## Pre-flight

The shared interfaces were checked plan-wide before Task 1 — the reader and the proxy's
registration, the stream's query names and client grammar, the stream client's deps and events,
the views and slices each later task consumes: seven producer–consumer pairs agreed, six tasks
were self-consistent, three conflicts were ruled (Rulings 1–3 below), and two document facts were
handed forward — DEVELOPMENT's 30 s seat cache to Task 13, and `gravit-client-smoke`'s supposed
`/data/account.json` assertion to Task 12, which found the premise stale.

## Rulings, in the order made

1. **Pre-flight, Ruling 1:** `rowsOf(markets)` takes the markets slice alone; the cn rows come
   from its own `watchlist`, `quotes`, `search`, `hitQuotes` and `asked` — the plan's second
   argument `cn` named no shape. Cost if wrong: one signature rename across Tasks 9–11.
2. **Pre-flight, Ruling 2:** Task 8 owns `account.detailsVenue` (null or a venue id) and the
   reducers `openVenueDetails(id)` / `closeVenueDetails` in `reducers/account.js` and
   `data/empty.js` — the renderer's drawer state. Cost if wrong: a field moved between two tasks.
3. **Pre-flight, Ruling 3:** Task 10 adds the reducer `forgetAsked(faceId)` (drops the key from
   `markets.asked`); Task 12's `removeAsked` action calls `markets.unwatch(faceId)` and the
   reducer follows (as built, `unwatch` dispatches it). Cost if wrong: a reducer name.
4. **Task 1:** the `candles` and `market` fixtures are the Stand-in Broker's NVDA, the first
   connected leg, not the paper venue the plan's Step 3 named — a candles fixture from any
   connected venue serves the views. Cost if wrong: one recapture.
5. **Task 1 (review):** the stream fixture's `data:` payloads are stripped of `native` and `icon`
   like the JSON fixtures (structure verbatim, arrays whole) and captured again — the views never
   read `native`, and the constraint is the fixtures' hygiene; the brief's "frames verbatim" is
   overridden here and the plan keeps its wording. Cost if wrong: a recapture. Graded Important in
   the same round: the recursive rm's `startsWith(tmpdir())` guard (a `home` line equal to
   `tmpdir()` would pass) tightened to the `ui-standin-` prefix; a second guard test pins the strip
   and the cut.
6. **Task 2:** the face validates query names, repetition and length only; a value the Account
   refuses (`limit=abc`, `q` over 60, `pairs` over 12) passes through and the Account's own 400 or
   409 is the answer — one validator, the Account's, as spec §5.1 says; the plan's Review Focus 5
   example `limit=abc` is amended to the names, length and `force=1` cases. Cost if wrong: a
   per-name value table in `rebuildQuery`.
7. **Task 2 (review):** a code-less fetch error answers the code `unreachable` (seat.ts's own
   convention), which joins `timeout`, `unreadable`, `disabled` and an error's own code. Cost if
   wrong: one word in a test.
8. **Task 2 (review):** on a disabled row a malformed query or a non-GET gets its 400 or 405 before
   `disabled` — the order fence → 405 → 400 → disabled stands. Cost: none.
9. **Task 2 (carried into Task 4):** `account-proxy.ts` exports `codeOf` and `seat.ts` imports it,
   deleting its copy.
10. **Task 2 (carried into Task 4):** `deps.reader` and the `through` adapter go;
    `registerAccountProxy` always makes its own reader and returns it, and `main.ts` hands that
    reader to the seat route. Cost if wrong: a small re-add.
11. **Task 3 (a plan defect the implementer caught):** the browser's `Last-Event-ID` wins over the
    query's `since` — on an auto-reconnect the URL keeps the open-time `since` while the header
    carries the newest id; the plan's "a since in the query wins" is reversed. Cost if wrong:
    duplicate frames or a snapshot after a reconnect. Ruled in with it: 415 for a non-JSON body on
    the follow POST, the house convention of every other face POST route.
12. **Task 3 (review):** any query name on `stream/markets` is 400 (the spec's "an unknown name is
    400", the table's "—"); stage 2's POST rows copy the handler. Cost if wrong: one check.
13. **Task 4:** the reader keeps 2xx answers only, so `/data/seat.json` no longer caches an
    unreachable answer (the old route kept one 30 s, so a hanging service cost one timeout a
    half-minute); no negative cache is added — the producer routes retry at once too, the page's
    reads are single-flighted per route and polled at 20 s, and the seat is read on entry, Refresh
    and receipt only. Cost if wrong: a 7 s hang per poll of each route while the Account is down;
    the final review triages a short negative cache.
14. **Task 5 (accepted at review):** a backing-off stream reads `closed` and a never-opened one
    `connecting` (the controller's status table); `onopen` re-arms the stale and dead clocks, as
    the Account's own client does; the retry delay holds at 30 s past the table; the follow set is
    posted on every open, even empty.
15. **Task 6, Ruling 4 (keeping every commit green):** the legacy `portfolioOf`, `orderLine`,
    `statementOf`, `csvOf` and `venueOf` stay until Tasks 8 and 11 delete them with their last
    callers, and the new statement views are named `statementLinesOf(statementBody)` and
    `statementCsvOf(rows)`. Cost if wrong: two renames.
16. **Task 6, Ruling 5:** every new view takes the route's body as the store keeps it; `agentsOf`
    leaves out of the Account's list the agent Gravit's row already stands for. **Amended** after a
    background security review: that agent is matched by the seat's `address` when the seat view
    carries one, by name only when it does not (the seat's own rule, D17), so a row is never hidden
    on a name alone. Cost if wrong: a duplicate row.
17. **Task 6 (the same security review):** an agent's order reads `Agent · <name>`, so an agent
    named "You" cannot pass as the owner; a statement CSV text cell starting with `=`, `+`, `-`,
    `@`, a tab or a carriage return is led by an apostrophe, the numeric columns untouched.
18. **Task 6 (the implementer's concerns):** `Watched` leaves `does` — the Account puts
    `watchOnly: "Live · read-only"` on every live connection — and stays in Details; an order's
    `who` resolves the agent's name through `page.keys[]` by address, else `An agent`;
    `changePct`/`changePct24h` are percents already and are never scaled (carried into Task 8);
    Gravit's row takes its cards and orders counts from the Account's matching agent instead of 0.
    Accepted: `missingWords` names a venue once; Gravit's row only while the seat view gives a
    standing; the mode, writes and limit words shared with `seatWords`.
19. **Task 6 (review):** the other agents' and Gravit's `orders` count open orders only (the
    spec's word); `venuesOf.what` and `changeOf.sinceStartUsd`/`rebuilt` added (the spec names
    them); a card's shown fields through `str()`; `limitWords` null-safe (no `$0` for an absent
    `leftUsd`); `cardsOf` groups by the card's agent address.
20. **Task 7, Ruling 6:** the app's `getJson` rejected a non-OK answer with the status alone,
    losing the Account's refusal sentence; Task 7 reads `err.body?.refusal?.message ??
    err.body?.error` when a rejection carries a body, and Task 12 makes `getJson` attach the parsed
    body as `error.body`. Cost if wrong: one field name.
21. **Task 7, Ruling 7:** `describe()` and its three reducers leave in Task 7 with `app.js`'s one
    call, so the page never calls a missing method between two tasks.
22. **Task 7:** `loadAll` stays ordered — the page with the statement and the agents, then the
    holdings, then the history — so a cold snapshot's history read sees the paper lens. Cost if
    wrong: one serial hop. Carried into Task 12: on entering Portfolio, `loadHoldings()` then
    `loadHistory()`, never both at once.
23. **Task 7 (review):** event-driven holdings and statement reads went through the proxy's 8 s and
    10 s caches and joined a read begun before the event — `loadHoldings({fresh})` and
    `loadStatement({fresh})` now take the page's plain/fresh rule and the stream events read fresh
    (one trailing read after a plain flight settles). Cost if wrong: one extra upstream read per
    event. Ruled in with it: a page landing with a paper venue while the lens was never read
    triggers one `loadHoldings()`, so the Paper figure is never absent while a paper venue exists.
    Ratified: the Account's sentence read only when it is text; `loadAll` ordered.
24. **Task 8, Ruling 8:** Task 8 deletes `orderLine`, `venueOf` and `csvOf`, which have no caller
    left after it, and keeps `portfolioOf` and `statementOf` for `render/markets.js` until Task 11.
    Cost if wrong: a dangling import, caught by the suite.
25. **Task 8:** the paper change line also draws `since start <signed usd>` when `sinceStartUsd` is
    a number and `rebuilt` when the Account rebuilt the curve (the spec names both). Accepted beyond
    the brief: Export CSV re-pointed at `statementCsvOf(statementLinesOf(…))`; `seg` takes
    label/value pairs; `closeOverlays` and `nav` clear `detailsVenue`; Positions gains a Value
    column.
26. **Task 8 (review):** Assets and Positions draw the leading lens's rows (the paper body when
    Paper leads) — cost if wrong: one condition; the rail's Account key carries the waiting-cards
    badge (spec §6.2; no task had named it); `curveSvg` takes a label (Paper or Net worth) and drops
    a point whose time does not parse; the Statement drawer draws `status` and `feeUsd`; the change
    line is one run joined with ` · `.
27. **Task 9, Ruling 9 (keeping every commit green):** the legacy `MARKET_TABS`, `MARKET_SORTS`,
    `marketRows`, `assetFor`, `holdingAssets`, `listAssets` and `positionId` stay until Tasks 10
    and 11 delete them with their callers; the new constants are `ACCOUNT_TABS` and
    `ACCOUNT_SORTS` (three sorts); `canonicalId` and `mentionsOf` are shared. Cost if wrong: two
    renames.
28. **Task 9, Ruling 10 (the markets slice):** `explore` and `results` (the `explore?q=` body while
    searching), `accountQuotes` by `venue|symbol` (from the quotes poll and the stream's `quote`
    events), `candles` by key with its range, `compare` by base, `watch` (the Account keys
    starred), `asked` (an old star → its key or null), the cn fields as they were, and `tab`,
    `sort`, `q`; an un-asked old `us:`/`crypto:` star draws nothing, an asked-and-missed one the
    "Not listed at the Account" line, an asked-and-found one the Account's row. **Amended at
    review:** `explore` is a map by tab — `all` is `explore?limit=200`, a kind's
    `explore?tab=<kind>&limit=200`, each read while its tab is on screen, the current tab refreshed
    every 20 s — because a tab's rows may lie past All's cut; `tabsOf(allBody, cnCount, {watching,
    searching})` puts All results first and Watching last; `rowsOf` reads the current tab's read,
    else All's.
29. **Task 9 (the implementer's concerns):** `isAccountKey` knows `event:` and `preipo:` keys (the
    Account's `keyOf` makes both); `sourceWordOf` falls back to the venue of the row's 24-hour
    change before the first connected line, so a coin priced at a public exchange is not
    attributed to the paper venue; `rowsOf` and `pageOf` take an optional trailing clock. Accepted:
    whole-word statement matching (ETH's page misses a WETH line), `barsWord` kept as a legacy
    import, a temporary import cycle with `account-view.js` (ended by Task 11).
30. **Task 9 (review):** cn rows carry `unit: 'cny'` and `volumeUnit: 'shares'`, rank after the
    Account's rows under Most traded and are the cn search's hits alone while searching; a starred
    key outside the read's four lists draws a placeholder that can be un-starred; `pageOf`'s `live`
    is the line Task 10 follows (the first connected, else the first public), and the source word
    comes from it when it names one; an event's page matches every outcome's lines; `best` only
    among connected lines that trade and are not closed; candles only when `ok`; a pre-IPO sub
    reads `Pre-IPO · Perpetual`; icons stripped from every pass-through. Cost if any is wrong: a
    view rule, caught by Task 11's renders.
31. **Task 9 (re-review):** ratified — the cn rows rank among themselves by turnover (price ×
    volume), the legacy rule, which is what "relative order by price × volume" meant; no change.
    Parked with a ruling: a market only a paper venue lists names the paper venue as its source;
    to be refined so that a paper line carrying a `quoteFrom` gives that word ("a paper venue's
    price is its source's listing") — one line in `sourceWordOf`, deferred to the final review's
    fix wave. Cost if wrong: a misleading source word on paper-only markets.
32. **Task 10:** the proxy's 240-character value cap refused twelve Kalshi or Polymarket pairs
    (measured 263–311 characters for exchange pairs, far more for prediction markets) — `pairs`
    gets a bound of 2 000, the 8 192 raw-target cap still holding; **amended at review** to land in
    Task 10's own fix round, not Task 12's. Accepted beyond the brief: the Markets polls on the
    app's `Timers` (with a `cancel`), the `bars()` call removed, `app-dom.test.js` clearing its
    timers. Ruled in at review: `saveKeys` returns its error and the cn entry stays when the
    store's write fails (no silent star loss); a poll answer stamped before the kept pair's
    `quoteAt` leaves the stream's fresher price.
33. **Task 10 (accepted):** "asked once" means once per boot — a star the Account does not list is
    asked again on each boot (bounded, sequential, healing itself when the Account lists it).
34. **Task 10 (re-review, ratified):** an unstamped poll answer replaces a stamped pair — the
    Account's own page keeps a pushed price only while followed and live; the bounded alternative.
35. **Task 11:** `chartSvg` stays with its test — `render/tool-result.js` still draws an
    `mcp__alpaca-kit__daily_bars` result with it; it leaves with the tool in stage 3. Cost if
    wrong: one dead export for a stage.
36. **Task 11:** `assetFor` is deleted as ruled; Hand to Gravit's words come from a new pure view,
    `handWordsOf` (an Account key → its page's item's base and name; a face id → the watchlist's or
    the search's asset, else `normalizeAsset`), with its own test, `app.js` only calling it. Cost
    if wrong: a few lines in Task 12.
37. **Task 11:** the nav reducer keeps an Account key as it is (`isAccountKey`) and canonicalises a
    face id as before, pinned through `R.nav` — without it no Account page opens. Cost if wrong:
    one line.
38. **Task 11 (before review):** `searchWord` keeps its caller — the cn search's error or partial
    answer is the one muted line while searching, not deleted; an honest state must not vanish.
    Cost if wrong: one line.
39. **Task 11 (before review):** the source word is drawn once, under the price with its age, and
    the `Source` fact goes — the Account shows it beside the price. Cost if wrong: one fact line.
40. **Task 12 (review):** two cross-task gaps are Important by effect and the wiring task's own: a
    market's page puts its own key in the 5 s quotes poll (`rowsInView`; spec §6.1 — a page polls
    quotes for what the stream does not carry), and a `snapshot` frame drops the stream-kept quotes
    (`streamSnapshot`, keeping the poll's pairs, dispatched beside `account.onStreamEvent`) because
    market events are never resumed. Cost if wrong: a page's price stale between explore
    refreshes; a dead pair's last pushed price shown after a gap.
41. **Task 12 (review):** the holdings' and the paper lens's refusal sentence reaches Portfolio's
    Assets box (`paperFailed` keeps `message`; the view and the renderer draw it as the holdings'
    word) — Task 11's carry in spirit, one family of honest states. Cost if wrong: two lines.
42. **Task 13 (before review):** CLAUDE.md's two other stale rows are fixed too — row 34 "17 real
    boots" → 18 (`account-graft-smoke` among them), row 26's `face_bars.py` no longer "a market
    page's daily bars" but the legacy producer no screen reads — a present-tense fact file must not
    lie. Cost if wrong: two phrases.
43. **Task 13 (review):** the Critical is fixed in code, not reworded — the spec (§3, §11) and Review
    Focus 4 want `Account unreadable`: an Account 2xx body the face does not recognise lands as the
    page (so the view draws `Account unreadable`, no figure, and the seat box its own
    `unreadable`), while a refusal or a non-2xx stays `accountFailed` keeping the last page; pinned
    in `host-account.test.js`. Cost if wrong: a version bump of the Account reads as an outage
    instead of an unreadable page. (As built: the screens draw `Account unreadable` where the
    figures would be; the seat box reads `/data/seat.json`, whose reduction is total — for a body
    that does not parse the route carries the code `unreadable`, which the box draws as
    `<host> · not reachable`, and a moved shape that parses turns the box into blanks; the box
    never draws the word itself.)
44. **Task 13 (review):** deferred minor 37 is fixed in code too (spec §6.1: a market's page polls
    quotes for a market the Account does not stream) — when the page's key is not among the tab's
    rows, the host derives its pair from the page's own view (`pageOf`'s item through
    `followOf`/`pairsOf`), so a deep link, a Back onto another tab or an un-starred page still rides
    the poll; pinned in `host-markets.test.js`; the documents' sentence then stands. Cost if wrong:
    one more quotes pair a call. (As built: `pairsOf` over the page view's lines — its most traded
    connected line, the one `followOf` gives when there is one; a public listing alone asks
    nothing, as the Account's `quotes` refuses public venues.)

## Carried between tasks

- Task 2 → 3: the module header and the `disabled` doc say "every valid read" answers `disabled`
  (done in 84a4ea5). Task 3 → 4: the header names the 415 and the 413 on `stream/markets` as
  refused before the row's state too (done in fc8935b).
- Task 3 → 5: the follow POST answers 415 to a body not declared JSON and 400 to any query name,
  so the stream client sends `content-type: application/json` to the bare path; its test asserts
  both (b5d2eeb).
- Task 3 and 4 → 12: `dispose()` sets no `disposed` flag, so the shutdown order settles it —
  `main.ts` disposes the proxy after the tree's dispose has stopped the web server (0f9855f).
- Task 4 → 13: the documents' 30 s seat cache (now 15 s through the proxy's reader).
- Task 6 → 8: the Account's percents drawn as percents; Gravit's `cards`/`orders` are a number or
  null (the agents unread) and null is drawn `—`; two agents named alike still read alike on Cards
  and Agents (the groups carry no address to show).
- Task 7 → 8: the dead legacy readers of `creds`, `tools` and `probe` deleted with the legacy
  views (6971f14).
- Tasks 1, 7, 8, 10 and 11 → 12: the poll re-armed on every stream open or dead transition; only
  `loadHistory` moves the range; `app-dom.test.js`'s hybrid account shape replaced by the
  `account.json` fixture; `schedule`, `cancelTimer`, `streamOpen` and the stream passed to the
  hosts; a paper lens read for the first time followed by the leading curve; `setHistoryRange`,
  `openVenueDetails`, `closeVenueDetails` wired, `detailsVenue` in the overlay and the Escape
  chain, the seat read on entering Agents; `streamQuote` dispatched from the event; `page`,
  `range` and `rowsInView` wired; `toggleWatch` reworked for Account keys; the Account search
  debounced (300 ms); `getJson` carrying the body (Ruling 6); a market page's entry reading the
  holdings and the statement; `holdingsFailed`/`statementFailed` keeping the Account's sentence;
  `tests/helpers/standin.ts` shared by both smokes with the `ui-standin-` guard (a84d65b, 0f9855f).
- Task 9 → 10: Watching needs `explore.all` read and kept while on screen; `setMarketsQuery` moves
  the tab to `results` when a query is typed and back to `all` when cleared there (f351504).
- Task 9 → 11: an event row's sub is its category; a cn row carries the stock's Chinese name, the
  one Chinese string the face draws on purpose, so the "no CJK" render test runs over an
  English-named cn asset (3c4e69e).
- Task 10 → 11: an older poll row is dropped whole, so a page draws its 24 hours and volume from
  the explore read, never from the live quote (3c4e69e).

## Tasks

| Task | Commits | Review | Face suite after (tests / pass / skipped) |
|---|---|---|---|
| 1 The Account's answers as fixtures | 4ae4ced; fix round 1 aa06e3c | spec ❌ — the stream fixture carried `native` — and the rm guard graded Important; round 1 addressed the three, re-review clean | 1083 / 1066 / 17 |
| 2 The proxy's reader and GET routes | fcfbdca | spec ✅ under the rulings, quality approved, no Critical or Important | 1094 / 1077 / 17 |
| 3 The stream pipe and `stream/markets` | 84a4ea5; fix round 1 10ba850 | spec ❌ on the two rulings and a third, as expected; round 1 addressed the three, re-review clean | 1100 / 1083 / 17 |
| 4 The seat route through the shared reader; the proxy registered in `main.ts` | fc8935b | spec ✅, quality approved, no Critical or Important | 1102 / 1085 / 17 |
| 5 The browser's stream client | b5d2eeb | spec ✅, quality approved, no Critical or Important | 1108 / 1091 / 17 |
| 6 The Account's pure views | ac30cdd; fix round 1 20e4920 | a background security review (three MEDIUM) and the task review (spec ❌ on the five rulings); round 1 addressed ten, re-review clean | 1119 / 1102 / 17 |
| 7 The Account host layer and slices | 65c6a8d; fix round 1 24bccc4 | spec ✅ for the brief, one Important plan-mandated (event reads through the caches); round 1 addressed two, re-review clean | 1123 / 1106 / 17 |
| 8 The Account screen, the rail's worth line, the tabs | 6971f14; fix round 1 64e982c | spec ❌ on the post-report ruling, quality strong; round 1 addressed five, re-review clean | 1123 / 1106 / 17 |
| 9 The Markets pure view | 21c677f; fix round 1 6f55da0 | spec ❌ — the three rulings and seven behaviours ruled at review; round 1 addressed thirteen, re-review clean with one parked (Ruling 31) | 1132 / 1115 / 17 |
| 10 The Markets host layer and slices | f351504; fix round 1 be1a43d | spec ✅ against the amended contract, one Important (the 240 cap on `pairs`); round 1 addressed three, re-review clean | 1133 / 1116 / 17 |
| 11 The Markets screen and the chart | 3c4e69e; before review 90b9c54; fix round 1 310a23f | spec ✅, quality ❌ (one Important, eight Minor); round 1 addressed nine, re-review clean | 1128 / 1111 / 17 |
| 12 The wiring, the A-share line, the smoke | a84d65b, 0f9855f; fix round 1 e81eed7 | spec ✅, quality ✅, four Minor and two cross-task gaps ruled Important; round 1 addressed three, re-review clean | 1147 / 1129 / 18; `FACE_SMOKE=1` with `FACE_ACCOUNT_SEAT_DIR` 1145 / 1145 at 0f9855f, not re-run after e81eed7 (neither the smoke nor the helper changed) |
| 13 The documents for stage 1 | c6608eb (three tidies: the seat's 15 s comment, the stream's unread `now`, the seat stamp's comment), 08ea070 (the documents and this ledger), 8f42306 (CLAUDE.md's two other rows, Ruling 42); fix round 1 e86cad4 (code, Rulings 43–44), bef028d (documents), ab2ffe2 (this ledger); fix round 2 c54e6b1 (code), a32856f (documents), and the commit that adds these lines | spec ✅, quality ❌ — 1 Critical (an unrecognised page documented as `Account unreadable`, which the host never drew: it kept the last page as a failure), 1 Important (this ledger lacked Ruling 42 and 8f42306), 5 Minor (CLAUDE.md's `face_data.py`; the iFinD line on Venues, drawn only once the wire has quoted an A share; the curve read after some holdings reads, not all; §4.2's stream routes over `ACCOUNT_QUERY`; a page's own pair off the tab's rows, deferred minor 37); round 1 addressed the seven, the Critical and Minor 5 in code. Re-review of round 1: C1, I1, M1, M3–M5 addressed, the Open orders extension fair; M2 partial (a cn page alone does not keep the A-share line); N1, Important by effect (an unrecognised page naming paper venues read the paper lens and the real curve, and the recognised page after it never re-read: real money's change and curve under the Paper figure); N2, Minor (You hold fell back to the real book under such a page); N3, Minor (Ruling 43's as-built note named the wrong word). Round 2 fixed the four: `hasPaper` gated on `pageOk`, You hold `Account unreadable` too, the README's condition, the note; re-review to come | 1150 / 1132 / 18; typecheck clean |

## Notes

- Task 1: the stream gave four frames in 20 s (retry, a snapshot, a statement line, a heartbeat);
  `account.json` keeps the Account's own path fields (`connectLive.home`, `agentSetup.command`);
  the capture script's extra guards (60 s per read, SIGKILL after SIGINT, the temporary home
  removed, a non-ok answer stopping the capture) accepted as capture hygiene.
- Task 3: the Account caps `since` at 64 characters, and its own 400 passes through for a longer
  one; undici's `sec-fetch-mode: cors` passes the stream route's navigate/document check; the plan's
  Task 3 text (since over `Last-Event-ID`, no 415, no query refusal) is superseded by Rulings 11–12.
- Task 4: `main.ts`'s wiring is covered by the typecheck and the proxy's wiring-shaped test — no
  test boots `main.ts`, the smokes register the routes themselves — so the first `npm start`
  against a running Account is the operator's look.
- Task 8: a correction of the controller's own words — on the captured `account.json` real money
  leads (`totalUsd` 29,138.10); the paper-only operator is a zero-real variant in the tests.
- Task 10: the implementer's first run died on a network error (ENOTFOUND, the Mac's idle sleep);
  keep-awake was requested for the session and the run resumed.
- Task 11: a candles answer without `range` would draw old closes under a new range; the Account
  always sends `range` on these reads, the fixture too.
- Task 12: its brief's two premises were stale — `gravit-client-smoke` never asserted
  `/data/account.json`, and `actions.js` needed no change; the stand-in takes a free port in place
  of 4821.
- Task 13: the root of the review's Critical was a gap between Task 7 (the host turned a page
  `pageOk` refuses into a failure) and Task 8 (the renderer drew `Account unreadable` only for a
  page held as data) that no review caught. Fixing it had a knock-on: with an unrecognised page
  landed, a market's page would have said `Loading…` under Open orders for a read that had
  answered, so the orders read gains `unreadable` and says `Account unreadable` (e86cad4). An
  empty 2xx body stays a failure — there is nothing to draw as a page.
- Task 13, round 2: the paper lens's gate (`hasPaper`) read only a page's `venues`, safe while only
  recognised pages landed. Once an unrecognised page could land, one naming paper venues read the
  lens and then real money's curve (`worthOf`, `pageOk`-gated, cannot say Paper leads without the
  page), and the recognised page after it found the lens read and never read the curve again. The
  gate is `pageOk` now, as `worthOf`'s is; and You hold reads `Account unreadable` under such a
  page, as Open orders do, never the real book in its place (c54e6b1).
- Task 13: FACE_SMOKE was not re-run in this task; the documents cite 1145/1145 at 0f9855f and
  count the five offline tests added since.

## Deferred minors

1. Task 1: machine paths in `account.json` (`connectLive.home`, `agentSetup.command` with the
   operator's home) — the Account's own data; the maps already name the path.
2. Task 1: the SIGKILL fallback reaches only the tsx CLI (the stand-in child may survive); the
   start-timeout path neither waits nor cleans up; no `'error'` listener on the child.
3. Task 1: `connectedLeg` reads the untrimmed explore answer; a missing `items` or `at` throws a
   bare TypeError.
4. Task 1: `freePort`/`startStandin` copied from the seat smoke — extract
   `face/tests/helpers/standin.ts` before a third copy. *Done in Task 12 (a84d65b).*
5. Task 1: the stream fixture holds four frames (retry, snapshot, statement, hb) — no order or card
   frames for later tests; hand-built frames serve those.
6. Task 1: two `MockTimers` ExperimentalWarnings in the suite output, pre-existing, from other
   tests.
7. Task 1: the script rewrites only `data: ` with a space (a `data:{…}` line would keep `native`);
   an unparsable `data:` line makes the guard test throw a bare SyntaxError instead of naming the
   line.
8. Task 1 (out of scope, carried into Task 12): `account-seat-smoke`'s recursive rm guarded by
   `startsWith(tmpdir())`, the pattern graded Important above — tighten to the `ui-standin-`
   prefix. *Done in Task 12 (`isStandinHome`, a84d65b).*
9. Task 2: a non-2xx answer does not evict an older kept 2xx for the same key, so within one TTL a
   plain read may serve the older rows after a fresh read's refusal (seat.ts replaced its cache on
   every outcome) — `answers.delete(query)` on a non-2xx would settle it.
10. Task 2: untested edges — a `%`-malformed value is normalised (`q=%E4%B8` → `q=%EF%BF%BD`),
    `fresh=0`/`fresh=true` read as plain, `?&&` is an empty query.
11. Task 2: `dispose()` clears kept answers, not flights (harmless at shutdown).
12. Task 3 (plan-mandated): `readBody` returns a UTF-8 string and fetch re-encodes it, so "passed
    as bytes" holds for valid UTF-8 only — fine for JSON; stage 2's plan may choose a Buffer reader
    for the envelopes.
13. Task 3: the 7 000 ms POST abort is not pinned (no injection seam without mock-timer warnings;
    `abortMs` could take a `stream/markets` key).
14. Task 3: no face-side time limit on the Account's stream headers or a non-200 body (undici's
    300 s default; the browser's stale/dead policy covers the page).
15. Task 3: the ECONNREFUSED fake is written three times in the test file.
16. Task 3: the MockTimers ExperimentalWarnings (`quotes.test.ts`, `market-search.test.ts`),
    pre-existing.
17. Task 3: the 405-before-415 and 415-before-400 orders on the POST are not pinned by a test.
18. Task 4: the seat view's `asOf` is stamped with the request time, so a read served from the
    reader's 15 s cache overstates freshness by up to 15 s (drawn as HH:MM) — pass the kept
    answer's time through the reader, or correct the client comment. *The comment corrected in
    Task 13; the stamp is as it was.*
19. Task 4: the ruled "a failure is never kept" has no seat-level test (unreachable, then two
    fetches).
20. Task 4: `seat.test.ts`'s message about `SEAT_TIMEOUT_MS` is stale (the real abort is
    `ACCOUNT_ABORT_MS.account`); a disabled seat route still builds an unused reader;
    `SeatDeps.url`'s doc does not say it only labels the view when a reader is given; the sharing
    test's fake keeps a `json()` nothing reads.
21. Task 5: no test asserts the follow set is absent from the open URL after a follow-before-open;
    the `n !== told` and `if (connected)` retell guards are untested (mutations pass); a rejecting
    (not throwing) fetcher is untested; `now` was accepted and never read. *`now` removed in Task
    13.*
22. Task 6: `limitWords` says `an order` for every scope (`venues`/`payees` caps are per payment);
    `venuesOf.stale` is `false` or a string (the wire always sends a string); the file's size
    (397 lines, some 135 of them the legacy views Tasks 8 and 11 deleted).
23. Task 6: no non-Gravit agent in the tests has a non-open order (the open-only count for other
    agents unpinned); `nameAt` takes the first key at an address (a re-approved key's newer name
    would not show); `perOrderUsd` still through `isNum`; CSV hardening for `;`-separated locales;
    `openCount` can undercount past the Account's 20-per-agent and 60-per-page caps.
24. Task 7: `beat` arms after `load()` — a subscriber calling `poll(true)` inside that dispatch
    could leave two timer chains (latent; nothing does it).
25. Task 7: `holdingsDue += 1` runs before `load()`, whose synchronous `accountLoading` dispatch
    could throw in a subscriber and leave the guard stuck (latent); `paper.data === null` asks the
    lens again on every page landing while the lens keeps failing (bounded, at the poll's cadence;
    the comment says "never read" and means "has no data").
26. Task 7 (from the ruling itself): a money event arriving after a fresh holdings read has gone
    upstream joins it and can miss its own change until the next event or snapshot — a "one
    pending trailing read" flag would close it; the final review triages.
27. Task 8: `render/account.js` reads `a.data.now`, `a.data.stale` and `history.data.range` off the
    raw bodies (guarded, not figures) — the "draws from the views" rule would put them in
    `headOf`/`changeOf`; `render/thread.js`'s `ticker`/`withTickers` emit a class with no rule now
    (dead, test-only); the pre-existing suite noise.
28. Task 8: the curve's label and the paper words follow the page's lead while the history slot
    holds whichever curve `loadHistory` last picked — between a lead flip and the next history read
    the curve is named for the new lead; keying both on `history.data.paper === true` closes it; the
    paper words take the range change's tone; the badge narrows the expanded Account key (a
    six-figure Paper line may wrap); `gone` keeps merging the paper lens's `missing` after the page
    stops naming a paper venue.
29. Task 9: Kalshi contracts rank by their raw count under Most traded (the Account weighs them by
    price); statement lines and held assets match across kinds (a perpetual's page lists spot
    lines, an RWA's the shares); the icon test does not cover `live`, `compare` or `candles` (no
    fixture carries one); `market-view.js` long until Tasks 10 and 11 deleted the legacy half.
30. Task 9: the item's aged word is untested through `rowsOf`/`pageOf` (no fixture item carries
    `quoteAt`); a placeholder's `kind` is the key's prefix word (`kalshi`, `pm`, `preipo`), which
    Task 11 must not read as an Account kind; a deep link to a market only a kind's own read lists
    gets `null` from `pageOf` (as ruled; the page falls back to Markets).
31. Task 10: the rewrite dropped tests for unchanged cn paths (the `HIT_QUOTES` cap, a malformed
    hits answer, a late hits answer, the storage listener on close); duplicated constants
    (`ACCOUNT_KEY` = `isAccountKey`'s pattern, the watch limit, a private `RANGES` the range
    control needs, `fly` re-implemented from `host/account.js`); `pageOf` runs `legsOf` twice and
    `open`/`range` build a whole page view for its item; a page waiting on an unlisted id runs
    `pageOf` again on every dispatch; `host/markets.js` long (the stores and the ask-once would
    split out).
32. Task 10: the `pairs` bound of 2 000 is just under the Account's own ceiling (12 × 160-character
    symbols with separators = 2 063) — raise it to 2 100 or trim client-side; the
    unstamped-replaces-stamped rule is unpinned; the ask-once's `includes` branch trusts the
    in-memory `watch` even after a failed write (very rare); the spec's "≤ 240 characters each"
    line is stale. *The spec's line corrected in Task 13.*
33. Task 11: after a later Account page failure with no sentence, a market with no open orders
    draws an empty `Open orders` heading — draw the heading only with rows or a word. (Carried into
    Task 12, left undone.)
34. Task 12: a boot straight onto `#/account/cards` reads the page twice — a plain read, then a
    fresh one queued behind it.
35. Task 12: `tests/helpers/standin.ts` keeps Task 1's deferred minors — the SIGKILL reaches only
    the tsx CLI, the start-timeout path neither waits for the exit nor removes the stand-in's home,
    no `'error'` listener on the child — and in the graft smoke a `dispose()` that throws skips
    stopping the stand-in.
36. Task 12: before any answer the Assets box shows the Account's sentence alone while the
    Statement drawer shows the sentence and `Statement unavailable` — one shape for both (the final
    wave, if cheap).
37. Task 12: a page whose market is not a row of the current tab polls no quote — the page's key is
    looked up among the tab's rows only (`host/markets.js`, `readQuotes`): a deep link to a
    movers-only market, a coin page reached by Back while on Stocks, a market un-starred from its
    own page on Watching; its price then moves with the stream's follow and the explore refresh
    alone. *Done in Task 13's fix round (e86cad4, Ruling 44).*
38. Task 13's review, outside its scope: `face/src/data.ts`'s comment still names Refresh and the
    read right after a fill as the account route's `?fresh=1` callers; no screen reads that route
    now — the final wave.
