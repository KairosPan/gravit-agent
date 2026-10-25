# The Account grafted into the face, stage 1 (the reads) — the ledger

*Stage 2 (the owner device and Trade) is recorded after stage 1, under "Stage 2"; its rulings
continue the numbering at 46 and its deferred minors at 45. Stage 3 (the removal of `alpaca_kit`,
the PIT beds and backtests) follows it, under "Stage 3" at the end of this file; its rulings
continue at 74 and its deferred minors at 68.*

The record of executing `2026-10-22-account-graft-1-reads.md` (the plan, committed at 8d019bf;
spec `../specs/2026-10-22-account-graft-design.md`, §5.1–§5.2, §6.1–§6.2, §6.5 and §10) on branch
`feat/account-graft`, cut from main @ 0481ee2, in the worktree `.claude/worktrees/account-graft`,
on 2026-10-22. Executed subagent-driven by the operator's choice ("Subagent-driven（opus），开始"):
every implementer and every reviewer on the opus model (the final review on fable, below), one
task after another, each task's tests seen failing first, a task review after each task and a
scoped re-review after each fix round. The Account is Linqi's buyer-agent-demo @ 133b9a7,
installed at `~/buyer-agent-demo`; nothing of it is vendored. The SDD workspace's `progress.md` is
the working copy this file records. Baseline before Task 1: face 1081 tests (1064 pass, 17
skipped).

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
    price is its source's listing") — one line in `sourceWordOf`, deferred (not in the final
    wave). Cost if wrong: a misleading source word on paper-only markets.
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
    `<host> · not reachable`; for a reply that parses but has moved shape the reduction falls to
    its defaults, which the box draws as `<host> · reachable`, `Read-only` and
    `Gravit · not on the account`; the box never draws the word itself.)
44. **Task 13 (review):** deferred minor 37 is fixed in code too (spec §6.1: a market's page polls
    quotes for a market the Account does not stream) — when the page's key is not among the tab's
    rows, the host derives its pair from the page's own view (`pageOf`'s item through
    `followOf`/`pairsOf`), so a deep link, a Back onto another tab or an un-starred page still rides
    the poll; pinned in `host-markets.test.js`; the documents' sentence then stands. Cost if wrong:
    one more quotes pair a call. (As built: `pairsOf` over the page view's lines — its most traded
    connected line, the one `followOf` gives when there is one; a public listing alone asks
    nothing, as the Account's `quotes` refuses public venues.)
45. **Final review:** a seat receipt reloads the seat's standing AND the Account's page, both past
    the cache, as the plan's Task 12 says (spec §6.2: the page is read after a seat receipt);
    carry 5's "as today" for `onReceipt` was the controller's own and is withdrawn, the plan's word
    stands; the `app-dom` pin moves with it (8fcf47c). Cost if wrong: one extra page read per seat
    receipt.

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
- Task 13 → the final wave: pin (a) in `host-account.test.js` (a warm session, an unrecognised page,
  the recognised page again) landed an empty body at its last step — its `inTurn` list had three
  answers — so a "re-read the lens on every poll" regression passed; a fourth `page({ totalUsd: 0 })`
  answer catches it (the round-3 re-review's M1, verified by the reviewer on HEAD; the final
  review's M6). Done in the final wave (8fcf47c).

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
| 13 The documents for stage 1 | c6608eb (three tidies: the seat's 15 s comment, the stream's unread `now`, the seat stamp's comment), 08ea070 (the documents and this ledger), 8f42306 (CLAUDE.md's two other rows, Ruling 42); fix round 1 e86cad4 (code, Rulings 43–44), bef028d (documents), ab2ffe2 (this ledger); fix round 2 c54e6b1 (code), a32856f (documents), 82995c5 (this ledger); fix round 3 6c07a5a (code), 034f65d (documents), dc90ad8 (this ledger) | spec ✅, quality ❌ — 1 Critical (an unrecognised page documented as `Account unreadable`, which the host never drew: it kept the last page as a failure), 1 Important (this ledger lacked Ruling 42 and 8f42306), 5 Minor (CLAUDE.md's `face_data.py`; the iFinD line on Venues, drawn only once the wire has quoted an A share; the curve read after some holdings reads, not all; §4.2's stream routes over `ACCOUNT_QUERY`; a page's own pair off the tab's rows, deferred minor 37); round 1 addressed the seven, the Critical and Minor 5 in code. Re-review of round 1: C1, I1, M1, M3–M5 addressed, the Open orders extension fair; M2 partial (a cn page alone does not keep the A-share line); N1, Important by effect (an unrecognised page naming paper venues read the paper lens and the real curve, and the recognised page after it never re-read: real money's change and curve under the Paper figure); N2, Minor (You hold fell back to the real book under such a page); N3, Minor (Ruling 43's as-built note named the wrong word). Round 2 fixed the four: `hasPaper` gated on `pageOk`, You hold `Account unreadable` too, the README's condition, the note. Re-review of round 2: N2, M2 addressed; N1 partial (warm: with the lens read before the unrecognised page, a snapshot or a Portfolio entry under it still left real money's change and curve under the Paper figure); N3 partial (the clause added to the note, a moved shape turning the box into blanks, false); B1, Important by effect (after c54e6b1 a money event under an unrecognised page read no lens and the recognised page after it read nothing, so Paper drew the total from before the event as current). Round 3: the recognised page after an unrecognised one reads the lens again, past the face's cache, then the curve; the note says what the box draws. Re-review of round 3: both addressed — the normal path reads the lens once, plain, a recognised page after a recognised one re-reads nothing, the refusal path unchanged; `fresh` right (a plain read in a burst takes the proxy's 8 s copy, trails a plain read in the air once, joins a fresh one in the air, never piles up); R33 fair; nothing new Critical or Important; scoped 108/108, suite 1152 / 1134 / 18, typecheck clean, `git diff --check` clean. Carried to the final wave: the round-3 pin's empty last step; three minors deferred (39–41) | 1152 / 1134 / 18; typecheck clean |

## Final review

HEAD dc90ad8: 42 commits over 0481ee2, 66 files, +17 919 / −1 912. Dispatched on opus, stopped
before it wrote anything, and dispatched again on fable on the operator's word, 2026-10-23
("用fable审核最终的").

- **Verdict (fable):** ready to merge with fixes — 0 Critical, 1 Important, 8 Minor. I1: this
  ledger lacked Task 13's round-3 verdict, three deferred minors and the final-wave carry. M1: the
  capture script carried a third copy of the stand-in spawn, with the weaker rm guard. M2: a seat
  receipt reloaded only the seat, an unrecorded deviation from the plan's "seat and account". M3:
  every boot reads the Account twice over — the boot's reads, then the first-frame snapshot's
  `loadAll`. M4: deferred minor 26, kept; the trailing-read flag in stage 2. M5: `streamQuote`
  computes a middle price from the bid and ask — to be checked against the Account's own rule. M6:
  the round-3 pin's empty last step (the carry above). M7: "in view" is every drawn row, the first
  twelve priced — a documented UX limit. M8: deferred minor 36 stands. Review Focus 1–5 pinned —
  RF4's seat-box clause not as built (deferred, the note under Ruling 43); RF5 as amended by Ruling
  6. All forty-four rulings sound; nothing of stage 2 or 3 in the tree; suite 1152 / 1134 / 18,
  typecheck clean.
- **Re-graded:** I1 Important stands (the ledger is the record); M1 enters the wave (an rm guard is
  a safety edge, and the helper exists); M2 enters the wave as the plan's text (Ruling 45); M5
  enters the wave as a check (match the Account's own quote rule or document why not); M6 enters the
  wave (the carried pin). Deferred: M3 (the boot's double read; stage 2 may skip a snapshot that
  lands while the boot's reads are in flight), M7 (the first twelve drawn rows priced;
  scroll-tracking later), M4 and M8 as they stand (deferred minors 26 and 36, below; 42 and 43 are
  M3 and M7).
- **The fix wave** — one, a fresh implementer on opus at BASE dc90ad8, a scoped re-review on fable
  after it: 8fcf47c (code: M1, M2, M5, M6) and the commit that adds these lines (I1). M1: the
  capture script imports `freePort`, `startStandin` and `stopStandin` from
  `tests/helpers/standin.ts`, so its rm takes only a stand-in's own home (`isStandinHome`); the
  helper gains `standinPaths(dir)` and `startStandin(port, dir)`, so the script keeps its own
  checkout (`seatDir()`, `~/buyer-agent-demo` when `FACE_ACCOUNT_SEAT_DIR` is unset); what it
  captures and where it writes are unchanged; tsc over the script with the face's options is clean
  (the face's typecheck does not include `scripts/`). M2: Ruling 45, the pin seen to fail first; the
  documents follow — README's Account paragraph and cadence table, DEVELOPMENT §5.2's reads, §5.3's
  card-result row and §7.3's `app-dom` line now say the seat's receipt reloads the page too. M5:
  kept as it is — the Account's page prices a pushed quote by `ui/stream.js`'s `stPrice`: its last
  trade, else the middle of its bid and ask, for anything but a perpetual or a future, which it
  prices at the middle, then the mark, then the last; a frame with a bid and an ask and no last is
  drawn at the middle either way; one comment line names the rule and the perpetual's exception,
  which the reducer does not take — a frame names no kind (the Account's page takes it from the
  market's row or its venue's market), so a perpetual's frame with a last trade is priced at that
  trade here. M6: the
  fourth answer, and a line asserting the page landed; with the host re-reading the lens on
  every landing the pin passed on three answers and fails on four, and the host was then restored
  exactly. Suite 1152 / 1134 / 18, typecheck clean.

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
- Task 13, round 3: the gate closed the cold path only. When the lens had been read before the
  unrecognised page, the recognised page after it still read nothing, because its landing read the
  lens only when the lens had no data. Two things followed: a curve chosen under the unrecognised
  page stayed real money's, and after c54e6b1 a money event under it left the lens from before the
  event. The landing now also reads the holdings, then the curve, when the page before it was one
  `pageOk` refused. It reads them past the face's cache, which keeps a holdings answer 8 s and
  inside a burst would hand back the lens from before the event; the round-2 pin's two holdings
  reads gain `&fresh=1` with it. Each of the two new pins was seen to fail first, the second also
  against a plain re-read (6c07a5a). The note under Ruling 43 now says what the seat box draws for
  a moved shape that parses, and DEVELOPMENT's R33 drops the same false "blanks".
- Task 13: FACE_SMOKE was not re-run in this task; the documents cite 1145/1145 at 0f9855f and
  count the seven offline tests added since.

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
    pending trailing read" flag would close it; the final review triages. *Triaged at the final
    review (its M4): kept for stage 1 — the Account's page has the same join; stage 2 adds the flag
    before a hand order's fill is what Portfolio must show at once.*
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
    wave, if cheap). *Stands after the final review (its M8).*
37. Task 12: a page whose market is not a row of the current tab polls no quote — the page's key is
    looked up among the tab's rows only (`host/markets.js`, `readQuotes`): a deep link to a
    movers-only market, a coin page reached by Back while on Stocks, a market un-starred from its
    own page on Watching; its price then moves with the stream's follow and the explore refresh
    alone. *Done in Task 13's fix round (e86cad4, Ruling 44).*
38. Task 13's review, outside its scope: `face/src/data.ts`'s comment still names Refresh and the
    read right after a fill as the account route's `?fresh=1` callers; no screen reads that route
    now — deferred (not in the final wave).
39. Task 13 (round 3): the seat box under a moved shape that parses draws defaults that read like a
    real standing (`<host> · reachable`, `Read-only`, `Gravit · not on the account`) — older than
    the graft, now documented (the note under Ruling 43, DEVELOPMENT R33); an `unreadable` word
    would be the honest one (`seat.ts`'s `seatView` and the box).
40. Task 13 (round 3), W1: a gap of two reads before the paper curve lands after an unrecognised
    page.
41. Task 13 (round 3), W2 (older than the graft's rounds): a page moving real money to zero switches
    the lead with no curve read.
42. Final review, M3: every boot reads the Account twice over — the page at boot (and, for a page
    naming a paper venue with the lens unread, both lenses and the curve), then the stream's first
    frame, a `snapshot` for a source opened with no resume point, whose `loadAll` reads the page,
    both lenses and the statement again past the proxy's caches, then the agents and the curve: the
    final review counts seven to nine upstream reads before anything is on screen. Stage 2 may skip
    a snapshot that lands while the boot's reads are in flight.
43. Final review, M7: "in view" is every row the table drew — the first twelve by the sort get the
    5 s quotes and the rest move with the 20 s explore read, so a row far down may show a 20-second
    price under a `real time` word; documented (README's cadence table, DEVELOPMENT §5.3);
    scroll-tracking later (an `IntersectionObserver` behind `rowsInView`).
44. Final wave, M5's check: the Account's `stPrice` (`ui/stream.js`) also leads a perpetual with the
    middle, then the mark, and ignores zero or negative figures and a crossed book (its `ttLiveFor`
    drops non-live frames before that); ours takes the middle only where a frame carries no last
    trade — stage 2, with the market's kind in the reducer (~5 lines), beside the trailing-read
    flag (26).

## The final tree

- HEAD `9f1885a` (46 commits over main `0481ee2`), the tree clean.
- `cd face && npm test` 1152 tests, 1134 pass, 18 skipped; `npm run typecheck` clean.
- `cd face && FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=~/buyer-agent-demo npm test` on 2026-10-23: 1152 / 1152,
  none skipped, no stand-in home left under the OS tmpdir.
- `python -m pytest` at the repo root: 400 passed (alpaca_kit is untouched this stage; it leaves in
  stage 3).
- The final whole-branch review ran on the Fable model at the operator's word; its one Important and
  the four Minors ruled into the wave are fixed above; the rest are the deferred minors 42–44.

---

## Stage 2 — the owner device and Trade

The record of executing `2026-10-23-account-graft-2-owner-trade.md` (the plan, committed at
e2627fd; spec `../specs/2026-10-22-account-graft-design.md` §5.1's stage-2 rows, §6.2–§6.4, §7,
§8 items 1–6 and 9, §10; the owner path map `../../research/2026-10-22-account-owner-path-map.md`)
on branch `feat/account-graft-2`, cut from main @ d227316 (stage 1 landed), in the worktree
`.claude/worktrees/account-graft-2`, on 2026-10-23..24. Subagent-driven as stage 1: implementers
and task reviewers on opus, the final whole-branch review on fable (the operator's word,
2026-10-23/24). The SDD workspace's `progress.md` is the working copy this section records.
Baseline before Task 1: face 1152 tests (1134 pass, 18 skipped).

### Pre-flight

Every producer–consumer pair across the fifteen tasks was checked before Task 1 (the proxy's route
names, the key arithmetic, the owner host's calls, the sheet's hooks, the views each later task
consumes): they agreed but for two, ruled below (Rulings 46–47); one hook was handed to Task 13
(`startAccount` gains `onPage`, so `owner.standing(page)` runs on every page landing), and Task 15
was told `GRAVIT.md` stood at 4,496 of its 4,500 bytes.

### Rulings, in the order made

46. **Pre-flight:** the `order` sheet's seed carries the ticket view — `seed = { id, ticket:
    ticketOf(state, now) }`, set by the trade host on a pick and a venue change — so
    `draftOf('order', fields, seed, now)` keeps its four arguments and reads `seed.ticket`. Cost if
    wrong: a leg changed mid-sheet re-seeds only on the next open.
47. **Pre-flight:** Task 9's Watching group is `markets.watch` alone; Task 12, which defines
    `watchKeysOf(page)`, extends `pickerOf` to the union. Cost if wrong: one function touched twice.
48. **Task 1:** the `prepared-*.json` and `venues.json` fixtures keep their arrays whole (a
    twelve-entry trim would cut an order's eighteen signed lines, and Task 8 needs every venue
    kind); the fixture test's cap exempts them. Cost if wrong: four larger fixtures.
49. **Task 3:** the review's Important (a page landing during `signOut()` re-paired and its late
    answer overwrote `signed-out`) and all six Minors enter round 1 — one-line correctness fixes in
    the file every later task builds on. Cost if wrong: one larger round.
50. **Task 4:** `whyOf` and `refusedAt` are exported from `host/owner-view.js` and `host/owner.js`
    imports them — one source for reading the Account's refusals. Cost if wrong: one import.
51. **Task 4:** `draftOf` has no `order` branch in Task 4; Task 9 adds it (importing
    `tradeDraftOf`). Cost if wrong: one file touched twice.
52. **Task 4:** the limit sheet's seed carries the venues and the agent's standing limit —
    `grantOf(ask, page)` seeds `venues` from `venuesOf(page)` and `current` from the agent's
    `scope: 'trade'` row in `page.spend`; `fieldsOf('limit')` starts from `current` and ticks the
    asked venue; the `openSheet` handler (Task 13) seeds `limit`/`endLimit` the same way, through
    the one export `limitSeedOf(page, address, name)` round 1 added. Cost if wrong: one argument.
53. **Task 4:** round 1 takes I1 (an exchange connect signs `live:exchange:<id>`), I2 (Let it sign
    with no owner ids would drop every owner), I3 (as Ruling 52), M1 (`standing` on a 401 only) and
    M2 (paper ids that collide); M3 stands as the brief wrote it, M4 is the brief's, M5 accepted.
    Cost if wrong: one round.
54. **Task 5:** `asked` is the draft at time zero (clock-free), so a draft whose `validUntil` reads
    the clock compares equal a minute on — the plan's literal rule would never sign `letIn`,
    `limit` or `endLimit`. Cost if wrong: a change that only moves the clock would not re-prepare
    (none exists).
55. **Task 5:** round 1 takes I1 (three safety guards unpinned), m1 and m2 (pins, and a `finally`
    around `afterAction`); m3 stands (the Account's own shape); m4 is carried to Task 9
    (`tradeDraftOf` reads `now` additively or not at all). Cost if wrong: one round.
56. **Task 6 (correcting the controller's own):** the go key's rule is the engine's —
    `status === 'ready' && sheet.asked !== null && askedOf(sheet) === sheet.asked` — and What you
    sign dims while the two differ. Cost if wrong: none; the pins show a changed field turns the
    key off and back on.
57. **Task 9 (the implementer's, ratified):** Trade's search reducers are
    `tradeResultsLoading/Loaded/Failed` — `results*` are the Markets search's in the one reducer
    table. Cost if wrong: none.
58. **Task 9:** `extendedHours: 'true'` rides a limit order alone (the Account's `tkOrderDraft`;
    the controller's carry had dropped the limit condition). Cost if wrong: a market order the
    Account would refuse.
59. **Task 9:** round 1 takes I1, I2 (a $0 fee drawn where the Account says "as <venue> charges
    it") and M1–M5; M6 stands (`DECIMAL` refusing `.5` is safe). Cost if wrong: one round.
60. **Task 10:** the quiet re-prepare runs only on a live quote frame for the followed leg whose
    price differs from the shown preparation's, while the form is not mid-edit — superseded in part
    by Ruling 62. Cost if wrong: a stale quote shown until the next frame that moves.
61. **Task 10:** round 1 takes I1, M2–M4, M6–M10; M5 (a re-seed once a read lists an unlisted
    pick) is deferred. Cost if wrong: one round.
62. **Task 10 (correcting Ruling 60):** the moved test is the Account's own — a frame's side price
    against the side price the stream pushed when the shown preparation landed (`preparedTop`;
    none yet, the first frame sets it and asks nothing), never against `quote.order.price`, which
    on a limit is the limit. Cost if wrong: a stale quote until the next moved frame.
63. **Task 11:** on a page that does not sign, Trade still draws the picker and Under way, and the
    ticket draws the device line in place of the form; Sign and place never appears without a
    signing page; Buy and Sell on a market's page only when it signs. Cost if wrong: a picker the
    operator cannot act on, said honestly.
64. **Task 11:** a market is tradeable from the face only when its kind is one of `TRADE_KINDS`
    (`tradeableOf`); Buy and Sell only for it; `ticketOf` null for any other kind; a pick on one
    does nothing (Task 13). Cost if wrong: a perpetual ticket against the spec's word.
65. **Task 11:** the whole quote box dims with What you sign while a quiet re-ask is in the air.
    Cost if wrong: none.
66. **Task 12:** `startMarkets` gains `owner` and `afterAction` — a star on an Account row on a
    page that signs acts `setWatch` and, taken, calls `afterAction('setWatch', body)`; otherwise
    the face's list as before. Cost if wrong: two deps.
67. **Task 13:** a done sheet closes itself after `afterAction` (no Cancel beside a disabled go
    word), except the `order` sheet, whose words stay on the ticket until the next pick. Cost if
    wrong: the operator misses a sheet's done line (the Account's own sheets close on done too).
68. **Task 13:** `owner.submit` of this page's own `signOut` ends the device — flag set, key
    deleted, role `signed-out` — exactly as `signOut()` does; the two paths are one rule. Cost if
    wrong: none.
69. **Task 13:** the connect sheet's key-file and reach checks run after the sheet's 300 ms quiet,
    not per keystroke (the proxy keeps an answer 5 s and each distinct path is a new upstream
    read). Cost if wrong: a late check line.
70. **Task 13:** round 1 takes I1 (the per-keystroke check, confirmed), I2 (a re-seed after a
    Settings sheet came back as a sell at the best venue with the amount gone), M1, M3, M4, M6
    (a 200 that is a refusal ended the device) and M7; M2 deferred (a cold `#/trade/<id>`), M5 the
    controller's lens corrected, M8 stands (a sheet left open when the page stops signing is
    honest). Cost if wrong: one round.
71. **Task 14 (before review):** the smoke watches a market the page's `watch[]` does not list at
    run time — the first unwatched `ex` market from `explore` — then signs `on: ''` and sees it
    gone; the controller's BTC/USDT was already on the stand-in's seeded list. Cost if wrong:
    none.
72. **Task 14:** the review's Important (the holdings check proved nothing: the stand-in starts
    with ETH at `ex`) and its first two Minors (the cancel's id, the leak check looking for the
    signatures sent) enter round 1. Cost if wrong: one round.
73. **Task 14:** ETH's cost-basis `coveredQty` rising by the fill's `filledQty` (within 1 %)
    stands in for a venue-line delta — the Account's own immediate count of its orders' fills; the
    venue line is a 30 s read the stand-in's seeds also move. Cost if wrong: the smoke proves the
    order was counted, not that the venue booked it (the fill frame proves that).

### Carried between tasks

- Task 1 → 4, 7: the seeded card's hash differs per stand-in run, so a test joins a card and its
  draft within one fixture, never across `account.json` and `prepared-card.json`.
- Task 1 → 8: the stand-in yields no `not-served` venue and an empty `paper/books`; Task 8's tests
  build those rows by hand.
- Task 3 → 4, 6: an empty refusal needs a fallback word on the screen (`Refused`, done in Task 4).
- Task 4 → 7, 13: `limitSeedOf` seeds `limit`/`endLimit`; an exchange connect's exchange pick; the
  paper sheet's seed carries the page's venue ids beside `books` (`paperSeedOf`, Task 13).
- Task 5 → 6: the renderer uses `askedOf(sheet)` for the key and dims What you sign while a quiet
  ask is in the air. Task 5 → 9: `tradeDraftOf` reads no clock (done).
- Task 6 → 13: the sheet mount skips `kind === 'order'`; a checkbox's field reads `checked`; a done
  sheet closes (Ruling 67) — all done in Task 13.
- Task 8 → 13: the connect sheet asks `checkKeyfile(keyfileAskOf(sheet))` and
  `reach(reachAskOf(sheet))` on opening and when what they ask changes, never `reach('')` (done,
  after the quiet of Ruling 69).
- Task 9 → 10, 11: the reducer names of Ruling 57; `data-outcome` on a held prediction's row; the
  extended-hours box with the limit field; a null fee drawn `as <venue> charges it`; no Cancel for
  a null `cancel` (done).
- Task 10 → 13: after `sheet.change('venue', id)` call `trade.venue(id)`, after
  `sheet.change('outcome', i)` call `trade.outcome(i)`; the order of `markets.page(null)` and the
  trade calls on a route change (done).
- Task 11 → 13: a pick on a market `tradeableOf` refuses does nothing (done, `pickTicket`).
- Task 12 → 13: `toggleWatch` passes the page to `watchedOf`; `startMarkets({…, owner,
  afterAction})` (done).

### Tasks

| Task | Commits | Review | Face suite after (tests / pass / skipped) |
|---|---|---|---|
| 1 The proxy's stage-2 rows and the fixtures | af7440e | spec ✅, quality ✅, the security pass clean | 1159 / 1141 / 18 |
| 2 The owner key module and the key store | 0b64b3a | spec ✅, quality ✅ — the bytes checked against the Account's own `sign.ts` (the kid matched, 200 signatures passed `es256Verify`) | 1169 / 1151 / 18 |
| 3 The device host | f23731b; fix round 1 ab80886 | quality ❌ — 1 Important (a late pair answer over `signed-out`), 6 Minor; round 1 addressed seven, re-review clean | 1182 / 1164 / 18 |
| 4 The owner views and the sheet kinds | e938476; fix round 1 43530c4 | quality ❌ — 3 Important (the exchange connector, Let it sign's owners, the limit seed), 5 Minor; round 1 addressed five, re-review clean | 1208 / 1190 / 18 |
| 5 The sheet engine | 82fe66a; fix round 1 38ef48e | quality ❌ — 1 Important in the tests alone (three guards unpinned), 4 Minor; round 1 addressed three, re-review clean | 1221 / 1203 / 18 |
| 6 The owner's screen pieces | 77655cd | spec ✅, quality ✅, Minor only | 1230 / 1212 / 18 |
| 7 The Agents', Cards' and Asks' keys | 08bf00b | spec ✅, quality ✅, Minor only | 1232 / 1214 / 18 |
| 8 The Venues' keys and the Connect reads | 28b2cff | spec ✅, quality ✅, Minor only | 1241 / 1223 / 18 |
| 9 Trade's views and slice | ddb8ce1; fix round 1 a9fb05a | quality ❌ — 2 Important (`extendedHours` on a market order, a $0 fee), 6 Minor; round 1 addressed seven, re-review clean but one Minor deferred | 1260 / 1242 / 18 |
| 10 Trade's host | 1e0906d; fix round 1 532d469; fix round 2 d4de487 | quality ❌ — 1 Important (re-prepare on a still market), 9 Minor; round 1 addressed nine, its re-review found the limit case (N1, Important, from the controller's wording); round 2 addressed it, re-review clean | 1271 / 1253 / 18 |
| 11 The Trade screen, the rail, the route, Buy and Sell | 1c7182a; fix round 1 8234f19 | spec ✅ with one Important gap (Buy and Sell on a perpetual's page), quality ✅ once fixed; round 1 addressed three, re-review clean | 1284 / 1265 / 18 as the SDD ledger records it (one short of adding up; not re-run) |
| 12 The star signs `setWatch` | 0c9fc2f | spec ✅, quality ✅ (its Important was Task 13's carry) | 1291 / 1273 / 18 |
| 13 The wiring | bb7fe8f (the hosts' hooks), 9e460a7 (the wiring); fix round 1 1b15177 | spec ✅ with one Important, quality ❌ — 2 Important (the per-keystroke check, the re-seed after a Settings sheet), 8 Minor; round 1 addressed seven, re-review clean | 1310 / 1292 / 18 |
| 14 The smoke's owner half | b45c5cc; before review 3f74a67; fix round 1 e111c27 | quality ❌ — 1 Important (a holdings check that proved nothing), 4 Minor; round 1 addressed three, re-review clean | 1310 / 1292 / 18; `FACE_SMOKE=1` with `FACE_ACCOUNT_SEAT_DIR` 1310 / 1310 at b45c5cc, the graft smoke 1 / 1 again at 3f74a67 and e111c27 |
| 15 The documents and the charter | 1a08ec6 (the charter's seven amendments dated 2026-10-24, `DEVELOPMENT.md`, `face/README.md`, `CLAUDE.md`, `GRAVIT.md` at 4,496 bytes, the seat design's two superseded marks); this section in the commit after it (461c50a) | spec ✅ (the seven charter edits word for word), quality ✅ with 11 Minor (32 of 32 sampled claims true) — the eleven fixed in place in the final wave (a554f82) | 1310 / 1292 / 18; typecheck clean |

### Deferred minors

45. Task 1: a write's body is decoded as UTF-8 text and re-encoded (`account-proxy.ts` via
    `http.ts`'s `readBody`), so a body that is not valid UTF-8 would be altered — forward the Buffer;
    the documents say "text" (Task 15, R37).
46. Task 1: the capture script's `WHOLE` comment names the prepared files, which a separate
    `prepared.has(name)` check keeps whole.
47. Task 1: no pin for stale-on-error on a stage-2 read (the shared path is pinned by the stage-1
    reads).
48. Task 2: `key-store.js`'s `tx` resolves on the request's success, not the transaction's
    completion (the Account's does the same); each call opens a connection never closed, with no
    `onversionchange`; no test fires a request's `onerror`.
49. Task 3: a 401 on the sign-out's own exchange does not re-read the standing (the refusal is said,
    the key and the role kept).
50. Task 5: a store subscriber throwing at `sheetSigning` leaves the sheet `signing` until closed.
51. Task 6: a pending device with an empty kid draws an empty row; the "no raw JSON" test can never
    match escaped output and the escaped `signers` line is untested; the checkbox field and
    busy-disables-Sign-in are untested.
52. Task 7: End limit is drawn again on the $0 row the Account keeps for a day after an End limit
    (`limitOf` could carry `ended`); which limits get End limit is decided in the renderer (the
    view could own `endAllow`); a knocking Gravit's seat box reads `knocking — admit it on the
    Account page` while Agents › Knocking offers Let in… for the same key — said in the documents
    (Task 15: either admits it, named Gravit), the one message still open.
53. Task 8: Details and Disconnect are not grouped in a venue's row; a refused reach shows no
    message and an unreachable key-file check leaves the line blank; a not-connectable verdict
    without `said` shows nothing, and the picked exchange's own verdict is not looked up; header
    comments overrun.
54. Task 9: `fillWords` draws a size-less `Bought ETH @ …` for a fill frame with no or zero
    quantity, where the Account's toast draws nothing — return `''` (the final wave).
55. Task 10: a pick on an id no read lists is never re-seeded once a read lists it (the review's
    M5; one with deferred minor 61's cold deep link).
56. Task 10: the ticket's venue read and the stream can price from different sources (N2).
57. Task 10: frames switching between a side price and `last` can trigger one bounded extra
    re-prepare; a stale last frame becomes the top (the Account's own does the same).
58. Task 10: the landing listener's removal in `close()` has no committed test (a scratch probe
    confirmed it).
59. Task 11: the ticket's form falls back to the view's side, outcome and venue where the sheet
    lacks them (latent: the host seeds all three).
60. Task 12: a market's page draws no watch note, so a refused `setWatch` pressed there is said
    nowhere; on a page that does not sign, a row watched only at the Account shows an enabled Stop
    watching that does nothing (the Account's page disables it and says why); a page watch entry no
    read lists is left out of Watching (the Account draws a placeholder); a taken `setWatch` clears
    any watchlist word, the boot read's error included; `watches()` is quadratic over the rows; no
    test for a refused un-star on both lists; a 230-column comment.
61. Task 13: a done or signing order sheet replaced by a Settings sheet comes back as a ready form
    for the same order (the receipt gone; nothing signs without a press — N1); the close pin does
    not test the cancel alone (N2); a cold `#/trade/<id>` opens its ticket only once a read lists
    the market (M2); `app.js` is 978 lines — a split weighed at the final review.
62. Task 14: two statements on one line, and a 170-column header, in the smoke.
63. Task 15: `render/account.js`'s seat-box comment still calls the Account page "the only place a
    card is signed" — the documents no longer do; the comment is code, left for the final wave.
    **Closed** in the final wave (26c45b2): the comment says the cards are answered on the face's
    Cards tab, or on the Account page.
64. Final review M1: renderers import from an impure host module — `render/owner.js` and
    `render/trade.js` take `askedOf` from `host/sheet.js`, `reducers/trade.js` and `data/empty.js`
    take `TRADE_KINDS` from `host/trade-view.js`; nothing impure runs, but the pure-view /
    impure-host / renderer shape is crossed both ways. Move `askedOf` into `sheet-view.js` and
    `TRADE_KINDS` into a data module — `TRADE_KINDS` first, before stage 3 removes modules.
65. Final review M4: no `storage` listener on `gravit.owner.signedOut.v1` — a second face tab
    keeps `signs` in memory up to one page read (20 s; 80 s with the stream open) after another
    tab signed out, and draws keys meanwhile; a signature in that window is 401 at the door and
    re-reads the standing, which then lands `signed-out`. Honest and bounded; the fix is a
    `storage` listener in `app.js` calling `owner.standing`, pinned by a host-owner case.
66. Final review M5: Review Focus 3 (a rejected card on a 200) is pinned at `refusedAt` and the
    device host, not at the sheet; `sheet.submit` calls `refusedAt` directly, so the rule holds
    transitively — one `submitWith` case answering a 200 `kind: 'result'` with `result.ok ===
    false`, asserting `sheetRefused` and no `afterAction`, would pin the wiring.
67. Final review M6: `app.js` is 978 lines (980 after the final wave) — split the owner-sheet
    wiring (`afterAction`, `checkConnect*`, `openSheetFrom`, `openOnRead`, `pickTicket`,
    `resumeTicket`, `changeField`, `fieldValueOf` and their `act` entries) into
    `host/owner-wiring.js` before stage 3 touches the file (deferred minor 61's `app.js` clause).

### The drill owed to the operator

The owner drill (`face/README.md` "The owner drill", the design's §10): the real Account on 4820
with **paper venues only** and the operator's browser already its owner — the face's head
`Waiting to be let in`; Let it sign on the Account's page; a `setWatch` signed from the face; Open a
paper account from the face; a paper order from Trade and its fill seen; Gravit's seat order carded
by Gate 2 in the thread and by the Guard in the face's Cards, approved there; the statement naming
"You" and "Gravit, approved by you"; Sign out from the face and the head's line; then
`account-seat-smoke` and `account-graft-smoke` again. **Not yet run.** The account-seat drill's
keyed run against the real service (the seat arc's) is still owed beside it.

### The tree at Task 15

- HEAD: this section's commit, over 1a08ec6 (the documents) and e111c27 (Task 14), on
  `feat/account-graft-2` over main `d227316`.
- `cd face && npm test` 1310 tests, 1292 pass, 18 skipped; `npm run typecheck` clean.
- `FACE_SMOKE=1` with `FACE_ACCOUNT_SEAT_DIR`: 1310 / 1310 at b45c5cc; the graft smoke 1 / 1 at
  e111c27; not re-run for the documents.
- The final whole-branch review (on fable) is next; not merged, not pushed.

### Final review

HEAD 461c50a: 27 commits over e2627fd, 65 files, +9 353 / −338; merge-base with main d227316.
Dispatched on fable (the operator's word).

- **Verdict (fable):** ready to merge with fixes — 0 Critical, 1 Important, 6 Minor. I1: this
  ledger omitted Task 15's eleven deferred document minors, two of which touch the owner drill.
  M1: renderers and reducers import from `host/`. M2: the pair box is not a form — Enter does
  nothing. M3: spec §6.4's Under way → Cards clause is not built, dropped by the plan's Task 11.
  M4: no `storage` listener on the sign-out flag. M5: Review Focus 3 has no sheet-level pin. M6:
  `app.js` at 978 lines. Review Focus 1–5 pinned where the plan said; the 28 rulings 46–73
  weighed, none reversed; the envelope, `refusedAt`, `tkOrderDraft` and `preparedTop` compared
  against the Account's own source; suite 1310 / 1292 / 18, typecheck clean, the owner smoke 1 / 1.
- **Re-graded**, as the SDD ledger records it: "Final: re-graded — I1 Important stands, fixed by
  fixing Task 15's eleven document minors in place (not by listing them) + closing deferred 63 (the
  stale comment); M2 enters the wave (Enter in the pair box is a first-day stumble); M3 enters the
  wave (a spec §6.4 item the plan dropped — a link from an Under way card row to
  `#/account/cards`); M1, M4, M5, M6 deferred (M6: split `app.js`'s owner-sheet wiring before
  stage 3)." The four deferred are minors 64–67 above.
- **Ruling**, as the SDD ledger records it: "Final: Ruling: M3 is built in the wave as the spec
  says — the cards Gravit waits on, listed under Under way from `cardsOf(page)` with a link to
  Cards — the plan's Task 11 omitted it by my oversight — cost if wrong: one list the operator also
  sees on Cards."
- **The fix wave** — one, a fresh implementer on opus at BASE 461c50a, a scoped re-review on fable
  after it: 26c45b2 (code: M2, M3, deferred minor 63), a554f82 (documents: I1's eleven, and the two
  code changes said) and the commit that adds these lines. M2: the pair box is a
  `<form class="pair-box" data-action="pairDevice">`; Enter in its one box submits it (implicit
  submission — the Pair key stays `type="button"`, so a click is never counted twice), routed in
  the submit listener to the same `pairDevice`, held while a pairing is in the air as the key is;
  the `app-dom` pin failed first on the markup, the held clause was seen to fail without its guard.
  M3: Under way draws **Cards waiting** under the orders when the page has cards — every card of
  `cardsOf(page)` (the stand-in's is Claude Code's, so the rows are the page's cards, Gravit's
  among them, not Gravit's alone), each `reason · value · answer by` in the Cards tab's words
  (`cardFactsOf`, now exported from `render/account.js` and read by both) with **Review →** to
  `#/account/cards`, rows only; none, nothing added; the `trade` pin failed first. I1: the eleven
  fixed where they stood — the charter header's clause (§1, §5 added), README's intro (Trade,
  Discover), the browser's keys (three, and two more once paired), the cadence's `pair` (each
  load's first page), *What you sign* a fold in the sheet and on the ticket, `paper-<the name,
  slugged>`, the drill's origin (the operator's own profile will do), its read (20 s, 80 s while
  the stream is open), its step 7 (the paper venue the seat's `trade` limit names), DEVELOPMENT's
  map row (the owner device, Trade) and the proxy row (`keyfile` at `/data/account/keyfile`).
  Suite 1312 / 1294 / 18, typecheck clean; `FACE_SMOKE=1` left to the controller on the final tree.

### The final tree of stage 2

- HEAD `4c8378b` (30 commits over the plan's `e2627fd`; main's `d227316` the merge base), the tree clean.
- `cd face && npm test` 1312 tests, 1294 pass, 18 skipped; `npm run typecheck` clean.
- `cd face && FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=~/buyer-agent-demo npm test` on 2026-10-24: 1312 / 1312,
  none skipped, no stand-in home left under the OS tmpdir.
- `python -m pytest` at the repo root: 400 passed (alpaca_kit untouched this stage; it leaves in stage 3).
- The final whole-branch review and its re-review ran on the Fable model at the operator's word; the
  one Important and the two Minors ruled into the wave are fixed above; deferred minors 45–67 stand.
- Owed to the operator: the manual drill of the spec's §10 on the real Account at 4820 with paper
  venues only (`face/README.md`, "The Account in the face").

## Stage 3 — the removal of `alpaca_kit`, the PIT beds and backtests

The record of executing `2026-10-24-account-graft-3-removal.md` (the plan, committed at f1b165b;
spec `../specs/2026-10-22-account-graft-design.md` §12, §8 item 8, §9 and §11) on branch
`feat/account-graft-3`, cut from main @ 0011666 (stage 2 landed), in the worktree
`.claude/worktrees/account-graft-3`, on 2026-10-24. Subagent-driven as stages 1 and 2:
implementers and task reviewers on opus, the final whole-branch review on fable (the operator's
standing word). The SDD workspace's `progress.md` is the working copy this section records.
Baseline before Task 1: face 1312 tests (1294 pass, 18 skipped) after `npm ci`; `python -m pytest`
400 passed (it leaves with Task 3).

### Pre-flight

Every producer–consumer pair across the eight tasks was checked before Task 1 (the fence's move
to `http.ts` and the search route registering itself, which Task 2 then trims to `cn`; the face's
last reads of Python gone before Task 3 deletes the package; the client files Tasks 2 and 4 split
between them; the roles Task 6 removes and the cycle text Task 7 writes; `GRAVIT.md` touched in
Task 7 alone): they agreed, each task was self-consistent, and no pre-flight ruling was needed.

### Rulings, in the order made

74. **Task 2:** `/data/quotes?ids=us:AAPL` answers 200 with no quote and `providers` iFinD alone,
    not 400 — an old client holding `us:` ids must not error; the brief said "no provider for it".
    Cost if wrong: one status code, one line.
75. **Task 2:** `client/js/host/discover.js`'s `GRAVIT_KEYS` still listed the two APCA key names
    (no brief owned them) — Task 4 drops them and their tests, since the face reads no Alpaca key
    after Task 2 and Discover must not advertise keys nothing reads. Cost if wrong: two rows on
    Discover.
76. **Task 3:** `gravit-md.test.ts`'s row-for-row check of the beds table against
    `docs/backtest-rules.md` leaves with the rules file (ENOENT otherwise); Task 7 rewrites
    `GRAVIT.md` and the test anyway. Cost if wrong: nothing — the table leaves in Task 7.
77. **Task 3:** `setup.ts`'s `PATCH_HEADER` (the text the face writes into a new operator
    `cordis.patch.yml`) still told the operator to mount the Python package's server — Task 4 owns
    `setup.ts` and rewrites that text. Cost if wrong: a stale paragraph in a new patch file.
78. **Task 3 (the review's Important, plan-level):** the plan's `.gitignore` list was wrong for the
    primary checkout — removing the lines would expose about 230 MB of untracked leftovers there
    after the merge (the Hermes spike 177 MB, `verdict_pit_2yr` 41 MB, `verdict_pit_broad` 10 MB,
    `verdict_screenON/OFF.json`, `state/`, `.pytest_cache`, `alpaca_kit.egg-info`,
    `alpaca_kit/__pycache__`, `tests/__pycache__`). The lines whose targets still exist on the
    operator's disk are restored under one comment naming them leftovers to drop once removed
    (`__pycache__/`, `*.pyc`, `*.egg-info/`, `.pytest_cache/`, `.pytest-cache/`, `/verdict_pit*/`,
    `/verdict_*.json`, `/verdict_universe.txt`, `/state/`, the Hermes spike line); the PIT lines
    (`/data/pit/`, `*.parquet`, `*.feather`, `checkpoints/`, `*.ckpt`, `*.safetensors`), `.venv/`,
    `venv/`, `runs/`, `/runs/`, `/snap/` stay removed; `/data/` stays until the operator's `rm`.
    The operator's `rm` list below grows to name the leftovers (their call). Cost if wrong: a few
    ignore lines linger.
79. **Task 4 (before review):** the client's `kinds.js` card branch for the retired pair
    (`place_order`/`cancel_order`, "Alpaca paper", its receipts) and `bots.ts` `DEFAULT_ALLOW`'s
    seven dead `mcp__*__<raw>` read patterns are this task's scope (spec §12.1: the alpaca half of
    the gate and every face remnant) — the branch goes, the seven names go (they already resolved
    to no tool, so the bots see no change); "PAPER order" strings inside test fixtures that imitate
    old sessions stay. Cost if wrong: an old session's order card draws as a plain approval.
80. **Task 4:** `bots/_template/agent.cordis.yml` (the generated mirror `bots.test.ts` pins to
    `renderComposition`) is edited to match `DEFAULT_ALLOW` despite the brief's "do not touch
    `bots/`" — the mirror follows the code by construction; `drill-bull`, `drill-bear` and
    `news-scout` still naming the dead patterns (harmless) are swept by Task 6. Cost if wrong:
    stale names in three fixture bots for two commits.
81. **Task 4 (the review's Important, confirmed by the automated security review):** add the
    backstop — the plan said the alpaca names go and the spec says the seat is the ONLY order path,
    so a retired order tool that still appears from an operator's leftover MCP row must be refused,
    not passed: the guard DENIES a tool whose raw name is `place_order` or `cancel_order` under any
    server (no card; the reason tells the operator to remove the MCP row), `auditOrderTools`
    returns `{gated, uncovered, retired}` and the boot refuses a non-empty `retired`, naming the
    tool. Cost if wrong: six lines and two constants naming the old tools. The operator's
    heads-up: a live harness home still mounting the Alpaca MCP row that registers those tools
    will not boot until the row is removed (and that row's server cannot start anyway: its package
    is gone).
82. **Task 6:** `cycle.test.ts`'s cross-check (every `role_*` the cycle names is a shipped role)
    marked `todo` for one commit, because `cycle.md` (operator-only, Task 7) still named the three
    roles; Task 7 restores it with the new text (done at 04229a3, no todo). Cost if wrong: Gravit's
    prompt named three dead tools for one commit on the branch.
83. **Task 7:** `CYCLE_MAX_BYTES` in `face/src/cycle.ts` rises 3,000 → 3,300 — the
    operator-approved text is 3,161 bytes, 161 over the old cap, and reflowing cannot shrink it; the
    cap is the face's own bloat guard, not a contract with dsh. Task 8 updates `DEVELOPMENT.md`'s
    citations (the 3,000 cap, 2,985 bytes, the 12-call caps, role delegation). Cost if wrong: 300
    bytes more system prompt per request.

### Carried between tasks

- Task 1 → 2: Task 2 edits the same `registerSymbolSearchRoute` Task 1 adds and keeps its fence
  import from `http.ts` (done).
- Task 2 → 4: `GRAVIT_KEYS`' two APCA names (Ruling 75) and the stale comments `boot.ts:35` (the
  face's Alpaca fetches) and `panels.ts:577` (APCA keys) — all done in Task 4.
- Task 3 → 4: `PATCH_HEADER`'s Python-server paragraph (Ruling 77, done).
- Task 3 → 8: the leftovers `rm` list (Ruling 78, below).
- Task 4 → 6: sweep the seven dead `mcp__*__<raw>` patterns from `drill-bull`, `drill-bear` and
  `news-scout` (Ruling 80, done).
- Task 4 → 8: the operator's heads-up of Ruling 81, written into `face/README.md` ("What boot
  refuses", "The profile") and `dsh/README.md` (the installed state).
- Task 6 → 7: un-todo the cycle cross-check and re-render Gravit's mirror after `cycle.md` (the
  drift test pins it) — both done.
- Task 6 → 8: `dsh/README.md`'s unreachable refusal and its stale heading date, `face/README.md`'s
  "steps 3-6", `DEVELOPMENT.md`'s role web-tool reason — all closed in Task 8 (deferred minors
  87–89 below).
- Task 7 → 8: the cycle's cap and size in the documents (Ruling 83, done).

### Tasks

| Task | Commits | Review | Face suite after (tests / pass / skipped) |
|---|---|---|---|
| 1 The producers, the bars route and the watchlist catalog leave; the fence lives in `http.ts` | 627d7a1 | spec ✅, quality ✅ — the four removed paths' 404 asserted in `smoke.test.ts` and run under `FACE_SMOKE` (1/1) | 1290 / 1272 / 18 |
| 2 The Alpaca and Coinbase providers and the US and crypto search leave; the wire speaks A shares alone | 7f4b790 | spec ✅, quality ✅ — Review Focus 1 already held before the change (a pin) | 1267 / 1249 / 18 |
| 3 `alpaca_kit`, its pytest suite, `pyproject.toml`, the scripts and the backtest rules leave | a21406d (92 files deleted); fix round 1 78dc70d | quality ✅ with 1 Important, plan-level (the leftovers' ignore lines, Ruling 78); round 1 addressed it, review clean | 1266 / 1248 / 18 |
| 4 Gate 2 is the seat's alone; the thread draws plain results; the retired pair is denied | 0d6d7fb; before review fc07e7f (Ruling 79); fix round 1 29fb880 | quality ❌ — 1 Important (the retired-order backstop, Ruling 81, also flagged by the automated security review), 4 Minor; round 1 addressed it, re-review clean | 1261 / 1243 / 18; the gate smokes 5/5 and `FACE_SMOKE=1` 1261 / 1261 at 29fb880 |
| 5 The backtest files, the AQR-era strategy and bots leave; `backtests/` is optional | 883b0f5 | spec ✅, quality ✅ — `channels.ts` already read an optional `backtests/` (the pin passed first, as planned) | 1262 / 1244 / 18; room and bots smokes 2/2 |
| 6 The three roles, the two skills and the profile row leave; Gravit's mirror re-rendered | e77900a | spec ✅, quality ✅ | 1264 / 1245 / 18 + 1 todo (Ruling 82); `FACE_SMOKE=1` 1263 pass + 1 todo |
| 7 The research cycle reads the Account and trades on paper; `GRAVIT.md` without the beds | 04229a3 (`cycle.md` 3,161 bytes verbatim as approved; `GRAVIT.md` 3,300 bytes) | spec ✅, quality ✅ | 1266 / 1248 / 18, no todo; roles, bots and goal smokes 3/3 |
| 8 The documents, the charter and the ledger | the commit that adds this section (the charter's §8 item 8 dated 2026-10-24, `CLAUDE.md`, `AGENTS.md`, `DEVELOPMENT.md`, `face/README.md`, `dsh/README.md`, `ROADMAP.md`, the loops page) | — (the final review follows) | 1266 / 1248 / 18 (documents only); typecheck clean |

### Notes

Task 8's calls, written down for the final review:

- `DEVELOPMENT.md` §2, §3.5 and §7.2 keep their numbers as one-paragraph "removed 2026-10-24"
  markers rather than renumbering the document, so the many `§3.x`–`§10` citations in the charter,
  `CLAUDE.md`, `face/README.md` and the code still resolve; §6.3 likewise.
- The charter's dates are the landing's (2026-10-24) where the spec's item 8 wrote 2026-10-22; the
  MARKET line reads "since 2026-10-24, by the operator's decision". The §6 departure line keeps the
  literal file name the brief gave verbatim — the one hit of the stage's grep outside this ledger
  and the dated specs and plans.
- Beyond the spec's list, the charter's remaining descriptions of the removed layer move with it:
  §1's role-library count and working day, P1's placement sentence, §3's operator and Gravit cells
  and the `alpaca_kit` row replaced by an MCP-rows row, §4's engineering, mechanics and
  `$DSH_HOME` rows; D1's trigger (paper forward-testing is every cycle's method now: due before a
  paper record is taken as grounds for a real venue), D10's MCP-server clause, and D16 resolved
  with the role-call cap; the seat's §8 row gains D1. The operator may want to read D1's new
  trigger: it is the one change of intent the spec did not word.
- `DEVELOPMENT.md` resolves R8, R29 and R36 by removal and rewrites R1, R5, R7, R9 to the seat;
  §10 items 1 and 7 close, item 6 becomes the cycle's method; Appendix A drops the Python
  package's variables into one closing sentence. `ROADMAP.md` items (4) and (5) close and its
  built log gains the graft.
- `face/README.md`'s order-approval drill is gone; its still-true Gate 2 paragraphs (the listener
  and guard, `snapshotEvents()`, the automated and positive halves, policy `never`, the gated
  cancel, the shell answering its own card, gate not containment) move into the Gate-2 drill as
  "Gate 2 on the seat's writes", reworded to the seat; the human half is the account-seat drill.
  The role drill is rewritten to wait for a role (the automated half on the fixture roles), the
  cycle drill to the new cycle on the real Account's paper venue. "Markets and Account" had no
  provider table left to drop (only iFinD's environment table, which stays); "The face's own
  routes no screen reads" is gone.
- The loops page (Chinese) is re-read where it summarised the removed layer — the eyebrow, the
  documents table (`GRAVIT.md` 3,300, `cycle.md` 3,161 / 3,300, four skills, the rules file's row
  gone), the AGENTS, CLAUDE and GRAVIT.md summaries, the three role rows marked retired, the
  profile's template, cycle and insert lines, the charter's §1–§6 and §8 summaries, the
  DEVELOPMENT §1, §2, §3, §7, §9 and §10 rows, the tool-schema and tool-execution lines, the
  browser line and the operator's owed list; its structure is untouched and its tags balance.
- `face/src/roles.ts`'s `NEVER` reason strings still say "orders stay behind the two order
  gates" and "no point-in-time guard and are never backtest evidence" — code, left as it is and
  said in the documents (deferred minor 96).

### Deferred minors

68. Task 1: `http.test.ts`'s "routes are gone" loop cannot fail (the recorder sees only the search
    route); the 404 evidence is the gated smoke.
69. Task 1: `registerSymbolSearchRoute`'s dispose is never exercised against a registrar that
    returns a disposer.
70. Task 1: the moved fence test's lead comment reworded `/data/account.json` → `/data/account`
    (the assertions verbatim).
71. Task 1: the smoke probes `/data/bars` with `?symbol=` where the old route took `id=`.
72. Task 2: `/data/quotes` with no `cn` id reports iFinD as `connecting` forever (`initialProvider`,
    no poll runs); external callers only.
73. Task 2: the client's `parsePayload` still accepts `basis: 24h` and `transport: stream`, which
    the server can no longer send.
74. Task 2: `symbol-search.test.ts`'s "distinguishes market" title with `cn` alone; the cache keyed
    on a constant market.
75. Task 2: `host-markets`' Review Focus 1 test's `/data/quotes` reads assertion is vacuous (the
    fake live quotes never fetch).
76. Task 2: the stale comments `boot.ts:35` and `panels.ts:577` — **Closed** in Task 4.
77. Task 3: `.gitignore`'s secrets comment still reads "(Alpaca + LLM keys)".
78. Task 3: `agents.ts:111-113`'s comment cites "the removed Python layer" (history wording, and
    the reason the two APCA names stay on `SCRUBBED_ENV`).
79. Task 4: `thread.js:67-68`'s dressed-result branch is dead (the `.raw` rule removed,
    `toolResultFor` never returns).
80. Task 4: `orders.ts`'s `KNOWN_KEYS` keeps snake_case `order_type`/`limit_price`/`order_id`
    with a misleading comment.
81. Task 4: the audit's `uncovered` flags only a seat prefix with NO covered write; a partial
    rename under a foreign server name passes the boot (the seat smoke catches it).
82. Task 4: the swallow-listener cast copied into three smokes; a fixture helper would do.
83. Task 4: a post-boot `mcp__account__place_order` (an unclassified seat tool) draws a card
    before the guard denies it; one clause (`!isRetiredOrderTool` in `isOrderTool`) would skip it.
84. Task 4: no listener-level pin that a retired tool under a non-seat prefix draws no card.
85. Task 4: the boot refusal on `retired[]` has no test (the audit is tested; the guard denies
    regardless).
86. Task 5: the pin's title says "draws no backtests section" but checks `readChannelBody`'s data,
    not the page.
87. Task 6: `dsh/README.md`'s installed-state bullet described a refusal the leftover row cannot
    reach (its server no longer starts) — **Closed** in Task 8 (reworded: remove the row; the
    boot refuses only should anything still register the retired pair), with the heading's date.
88. Task 6: `face/README.md`'s "per `../dsh/README.md` steps 3-6" — **Closed** in Task 8 (steps
    1–5, step 2 the rows).
89. Task 6: `DEVELOPMENT.md`'s role web-tool reason ("no as-of guard") no longer matched
    `roles.ts` — **Closed** in Task 8 (a role works with the tree's own tools, never the open web).
90. Task 6: `roles.test.ts`'s second RF5 test re-creates `probe` redundantly; a one-tool fixture
    whose tool differs from `_template`'s default would pin `allow` honoured.
91. Task 6: `roles.ts:80-82`'s parenthetical "none ships today" will go stale.
92. Task 6: `dsh/profile/cordis.yml:4`'s header says the file names the model; the model row
    lives in the patch file.
93. Task 7: `GRAVIT.md:20`'s tense, "has no lookahead guard since 2026-10-24".
94. Task 7: `face/src/cycle.ts:3`'s doc-comment line is 154 characters.
95. Task 7: the cwd fact (a channel session's shell runs in `strategies/<name>/`) now reaches
    Gravit only through the cycle, not the bots or a role through `GRAVIT.md`.
96. Task 8: `roles.ts`'s `NEVER` reason strings — "orders stay behind the two order gates, the
    Account seat is Gravit's…" and "the AKShare tools carry no point-in-time guard and are never
    backtest evidence" — are older than stage 3; true in effect (a role holds neither), stale in
    wording. Code, left for the final wave or a later round.

Stage 2's deferred minors 64–67 (renderers importing from `host/`, the `storage` listener, the
sheet-level pin, the `app.js` split) still stand.

### The operator's commands after the branch lands

In the PRIMARY checkout, in the operator's own terminal, once the branch has merged and nothing
reads them (spec §12.3: deleted, not archived — "床和aqr都删了"):

```bash
rm -r data/pit data/.screen_cache data/.face_cache
```

Then, the previous product's leftovers the Task 3 review found on the operator's disk (Ruling 78;
the operator's call, each is untracked and ignored today):

```bash
rm -rf spikes/2026-06-26-hermes-vendor-feasibility/_hermes verdict_pit_2yr verdict_pit_broad \
  verdict_screenON.json verdict_screenOFF.json state .pytest_cache alpaca_kit.egg-info \
  alpaca_kit/__pycache__ tests/__pycache__
```

and, once both are gone, drop the leftovers block (`__pycache__/` through the Hermes spike line)
and `/data/` from `.gitignore` in a commit of their own. A harness home that still mounts the
Alpaca MCP row of before 2026-10-24 drops it from `$DSH_HOME/profiles/face/cordis.patch.yml`
(Ruling 81); the operator's untracked `.claude/launch.json` may drop its `../.env.alpaca` line.

### The drill owed to the operator

The owner drill of stage 2 (`face/README.md` "The owner drill", the design's §10) is still owed:
the real Account on 4820 with **paper venues only** and the operator's browser already its owner —
Let it sign, a `setWatch`, a paper account, a paper order from Trade and its fill, Gravit's seat
order carded by Gate 2 in the thread and by the Guard in the face's Cards, the statement naming
"You" and "Gravit, approved by you", Sign out; then `account-seat-smoke` and `account-graft-smoke`
again. **Not yet run.** Beside it, the account-seat drill's keyed run against the real service,
and — new with this stage — the cycle drill on the new text (`face/README.md` "The cycle drill":
a forward paper trade through the seat, both cards answered), which no model has yet run.
