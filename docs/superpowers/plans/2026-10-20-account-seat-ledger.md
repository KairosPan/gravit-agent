# The Account seat — the ledger

The record of executing `2026-10-20-account-seat.md` (spec `../specs/2026-10-20-account-seat-design.md`)
on branch `feat/account-seat`, cut from `feat/gravit-face` @ b21da25 on 2026-10-20, inline
(executing-plans), one task after another, each under tests that failed first, with one fresh
whole-branch review at the end. Baseline on the branch's first commit: face 1027 tests (1011 pass,
16 skipped), pytest 400. The SDD workspace's `progress.md` was moved to the session scratchpad
afterwards, not deleted.

## Pre-flight

- Task 2 produces `ACCOUNT_SEAT_NAME` / `DEFAULT_SEAT_URL` (and `seatDir()` / `seatUrl()`); Task 6
  consumes them for the route's defaults — consistent.
- Task 3 produces the twelve raw names; Tasks 4 and 5 copy them by design (the roles test and the
  client keep their own lists), spelled identically in the plan's Global Constraints — consistent.
- Task 5 produces `onReceipt(m)` with `m.data.seat`; Task 7 consumes it to route the reload — consistent.
- Task 6 produces `SeatView`; Task 7's `seatWords` consumes it; Task 9 consumes
  `registerSeatRoute(webServer, {url, seatName})` — consistent.
- Task 2's row is replaced whole by an id patch in Task 9 (`extraPatches`, `config`) and in Task
  12's look (a home patch); the override mechanism is pinned by `boot.test.ts`'s AKShare override
  test — consistent.

## Tasks

| Task | Commits | Face suite after (tests / pass / skipped) |
|---|---|---|
| 1 The submodule leaves the tree | e4a26fd | 1027 / 1011 / 16 |
| 2 The `mcp-account` row | 0d0449f | 1029 / 1013 / 16 |
| 3 Gate 2 cards the seat's writes | cae5b42; after the security reviews 9ce45c5, 849b2e8 | 1043 / 1027 / 16 |
| 4 A role never carries a seat tool | 76f2a23 | 1043 / 1027 / 16 |
| 5 The client's seat card, seat line and receipts | 1a74940 | 1040 / 1024 / 16 |
| 6 `GET /data/seat.json` | a51296b | 1051 / 1035 / 16 |
| 7 The Account screen's seat box | 6485bcb | 1058 / 1042 / 16 |
| 8 GRAVIT.md, the mechanics guide, the records | cfa56bc | 1059 / 1043 / 16 |
| 9 The seat smoke | 1ad55a9 | 1060 / 1043 / 17; `FACE_SMOKE=1` with the seat dir 1060 / 1060 / 0 |
| 10 The measurements | (no files; §Measurements) | — |
| 11 The documents | 58993d3 | 1060 / 1043 / 17; typecheck clean |
| 12 The look and this ledger | the stamp fix, this file | 1060 / 1043 / 17 |

The spec is 82c88c5, the plan 3795873.

## Rulings

- Task 2: `account-seat.ts` also exports `seatDir()` and `seatUrl()` beside the constants — the route
  (Task 6) reads the same env through them — cost if wrong: two helpers.
- Task 2: the sixteenth smoke (`order-gate-midboot`) spells its patch as a string array, so the
  script changed fifteen and the sixteenth was edited by hand — cost if wrong: none, the count is 16.
- Task 3: a tool under the face's own seat prefix that is neither one of the twelve writes nor one of
  the thirty reads known at the pin is carded like a write (`isOrderTool` true), never a boot refusal
  — the Account moves fast and a card per call is the safe default until the read list grows; only
  the face's own server name gets the fallback (a renamed seat server keeps the twelve by raw suffix)
  — cost if wrong: a new read tool at the Account cards every call until `SEAT_READ_RAW_NAMES` names it.
- Task 3 (the first background security review flagged that the row, 0d0449f, landed one commit
  before the gate covered its writes): acknowledged — the gate commit followed at once on an unmerged
  branch; its "unknown seat tool" suggestion is the ruling above (a card, not a boot failure).
- Task 3 (the second review, MEDIUM "approval-card spoofing via truncation"), superseded by the third:
  a middle cut and a path cut were tried (9ce45c5) and withdrawn.
- Task 3 (the third review, three MEDIUMs on the card's cuts): a key field (venue, symbol, id,
  address, payee URL) is shown WHOLE up to 120 characters or the call is denied before a card; a URL
  must be http(s), carry no userinfo, parse and fit, and is shown as its parsed href; non-key fields
  keep the 40-character cut — the review's stricter line taken (849b2e8) — cost if wrong: a
  legitimate payee URL over 120 characters, or one with a non-http scheme, is refused with a reason
  (Gravit holds no payees limit in this round anyway).
- Task 5: a canceled order's answer lifts `Order canceled · …`, not `Order placed` — the Account
  answers a cancel with the order's status — cost if wrong: one word.
- Task 5: on the client any approval under the face's own seat prefix is a seat card, whatever its
  raw name — the host raises an approval only for a tool it gates, so the client follows the host
  without a read list of its own — cost if wrong: a generic approval drawn as a card.
- Task 5: `thread.js` needed no change (the card's dim line is data-driven), so its new test is a pin
  that passed on its first run — noted, not a finding.
- Task 6: an unreachable answer is cached for the same 30 s as a good one (the spec's "no stale
  re-serve" is about never serving an OLD good view) — a hanging service then costs one 7 s timeout
  per half-minute, and Refresh's `?fresh=1` asks again at once — cost if wrong: the box says not
  reachable for up to 30 s after the service comes up, until Refresh.
- Task 6: the Account's key status `unknown` reads as admitted (the owner let the key in; `unknown`
  is the Account's word for a key it has not yet seen act) — cost if wrong: one word on the box until
  the seat's first call.
- Task 6: the route's deps gained `timeoutMs` for the hanging-service test (the real timeout stays
  7 s) — cost if wrong: none.
- Task 7: the Account screen's "no Guard, Beast, Trading on …" pin now allows the Account's own mode
  and writes words INSIDE the seat box when a seat view was read (they are the Account's words about
  its state, drawn from its read, not a door of the face's) and keeps them out everywhere else — cost
  if wrong: two words on one box.
- Task 7: the seat box's stamp is the view's own `asOf` (the face's read time, served by the route),
  falling back to the read's time for an unreachable answer; a failed re-read keeps the last view
  stamped stale, as the account box does — cost if wrong: a stamp. (The fallback's number-vs-string
  slip was found in the look and fixed under a failing test — Task 12.)
- Task 7: an unreachable service still shows the Open the Account page link (the operator may have
  just started it) — cost if wrong: a dead link for a moment.
- Task 8: `ROADMAP.md`'s built-log line moved to Task 11 (the documents), so it is true the moment it
  is committed — cost if wrong: none, one task later.
- Task 8: `GRAVIT.md`'s budget needed two trims beside the seat paragraph — the rooms' "@ naming
  nobody" sentence loses its redundant second half, the tests line loses "Keep it green" — the facts
  stay — cost if wrong: two softer sentences.
- Task 8: the mechanics guide lives in `dsh/skills/mechanics` (the write map's operator-only tier):
  written by a coding agent under review, for the operator to read before it is landed.
- Task 9: the smoke expects exactly the NINE real-account writes gated (the simulated-only three never
  register against a real account), asserted as a deepEqual against `SEAT_WRITE_RAW_NAMES` minus those
  three — cost if wrong: the smoke fails the day the Account registers one of them on a real
  account, which is the canary's job.
- Task 9: the stand-in's temp home is removed after the run only when it is under the OS tmpdir (it
  is), so the smoke never deletes a path it did not make — cost if wrong: a stray temp directory.
- Task 11: the loops page's measured-request table (the 2026-10-10 numbers) stays historical and is
  not edited; the page's composition list already names the seat row (Task 2) — the tool block's
  growth is `DEVELOPMENT.md` §4.3's and R35's — cost if wrong: one stale table on a reference page, dated.
- Task 11: the README recommends `npm run account -- --live-cap 1` for the paper stage (the cap bounds
  any real order to a dollar should a real venue ever be connected and granted; a paper venue ignores
  it) — cost if wrong: an operator who later wants real trading changes one flag.
- Task 11: the charter's box gains two rows under ACCOUNT with the MARKET column left empty beside
  them (the diagram keeps its width; the script asserted the row lengths) — cost if wrong: two lines
  of ASCII.

## Measurements

Measured 2026-10-20 with `face/scripts/schema-sizes.ts` on a scratch home (`setupFaceProfile`;
`mcp-akshare` disabled; the seat row pointed at the scratchpad checkout of buyer-agent-demo @
133b9a7 with `FACE_ACCOUNT_URL=http://127.0.0.1:4`, no service — the seat registers its real-account
tools all the same): `mcp__account__` 35 tools · 63,221 bytes · 15,806 bytes/4 · 15,727 chars/4; the
host's own 26 · 23,468 · 5,867 · 5,857 (unchanged); `role_` 3 · 2,750 · 688 · 685; total 64 · 89,439 ·
22,360 · 22,268. The six largest seat tools (bytes · bytes/4 · chars/4): `portfolio_live_preview`
5,347 · 1,337 · 1,332; `portfolio_live_order` 4,987 · 1,247 · 1,244; `portfolio_explore` 4,106 · 1,027 ·
1,019; `portfolio_live_move` 3,432 · 858 · 854; `portfolio_account` 3,374 · 844 · 838;
`portfolio_live_batch` 3,194 · 799 · 797 — four of them larger than the host's largest, `workflow`
(3,405 · 852 · 848). The seat's block is 64% of AKShare's measured 24,426 chars/4. `GRAVIT.md` after
Task 8: 4,493 bytes.

The seat smoke (Task 9) passed on its first run, 7.2 s, against the stand-in of buyer-agent-demo @
133b9a7 (`npm ci` in the scratchpad clone, 292 packages); read line by line: the seat's own stderr
line (`up (stdio) … a key derived from its name`), the face's `order gate armed for` naming the nine
real-account writes, 35 tools, the admitted read with `paper-momentum`, the rejected order never
reaching the seat with the Account-seat reason, the allowed order answered `pending` with a `card-…`
id, the route reading admitted + the paper venue + that card; `~/.buyer-agent-demo/seats` absent
before and after. Then `FACE_SMOKE=1` with `FACE_ACCOUNT_SEAT_DIR`: 1060 tests, 1060 pass, 0 skipped.

## The look (2026-10-20, the browser pane)

A keyless face on port 3097 with a scratch harness home (the seat row replaced whole by a home patch:
the stand-in's URL, the seat named Gravit, a real key in a scratch `BUYER_HOME`), the Account's
stand-in on 4821 (`--no-desk`; no network, no money), and a scratchpad script driving the seat
process over stdio with the checkout's own MCP client, as dsh would.

1. The face booted with the stand-in DOWN: the seat's line `up (stdio) → 4821 · signs with its own
   key, kept in <home>/seats`, the boot line `order gate armed for` the nine writes. Account › Venues:
   the **Account seat** box read `127.0.0.1:4821 · not reachable` — and `As of earlier`, which was the
   slip: an unreachable view carries no `asOf` and the read's time is a number the clock formatter
   does not parse. Fixed under a failing test (`account.test.js`'s not-reachable case now asserts the
   read's time); after a hard reload the box stamped `As of 22:51`.
2. The stand-in started (pairing code printed); Refresh: `127.0.0.1:4821 · reachable`, `Guard · Trading
   on · $250 a move`, `Gravit · not on the account`, the seven venues with `Paper` chips on the two
   paper ones, no cards line (the seeded card is Claude Code's).
3. The script's `portfolio_account`: `authorised: false`, the seat's key `0xcae75e…6f97`, `paperVenues
   ["paper", "paper-momentum"]`; the key file appeared in the scratch `seats/`; Refresh: `Gravit ·
   knocking — admit it on the Account page`.
4. On the stand-in's page, paired with its code: Agents → `Gravit asks to be let in 0xcae75e…6f97` →
   Let it in… (name Gravit, 30 days) → `Gravit is in. Give it a limit next.`; Every agent › → Change
   limit → only `paper-momentum`, $25 an order, $100 in all → Save → `trading limit: paper-momentum ·
   up to $25 an order · $100 of orders in all`. Refresh on the face: `Gravit · admitted until Nov 19`
   (the find's text; the box line) with `trade · paper-momentum · $25 an order · $100 of $100 left`.
5. The script's `portfolio_live_order {venue: paper-momentum, symbol: BTC/USD, side: buy, usd: 10}`:
   `pending: true, card: card-0002` (`Gravit asks to PAPER · buy 0.00015 BTC at Momentum · paper ·
   market · about $9.42`, flight GR-0003). Refresh: `$90.38 of $100 left` (the card reserving $9.62),
   `1 card waiting · As of 22:54`.
6. On the stand-in's Portfolio, Waiting for you: Gravit's card, ✓ (one signature) → the toast `Bought
   0.00015 BTC / USD @ 62,763.8 · Momentum · paper`; the script's `portfolio_wait card-0002`: `done:
   true`, status `approved`, signer `0xcae75e…`. Refresh on the face: no cards line, `$90.59 of $100
   left`, the paper venue `$24,999.99`.
7. Discover: the Data shelf lists `account · 35 tools · MCP` by itself. The stand-in stopped; Refresh:
   `127.0.0.1:4821 · not reachable · As of 22:56`.

Not walked by the look: the face's own card from a conversation (a model is needed) — that is
`account-seat-smoke`'s half; and the real service (`npm run account`) with its egress — the
operator's drill (`face/README.md` "The account-seat drill").
