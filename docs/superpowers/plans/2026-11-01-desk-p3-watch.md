# The Desk, P3 — the Watch (re-plan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The face watches the operator's price levels, urgent-event rules and US filings for US and A shares. It sends each alert to the phone itself, quoting the plan and naming the price's feed and exchange time. A bounded desk turn then checks the plan, as a reply. Everything shows in the Markets screen's Desk view.

**Architecture:**
- **Prices are polled; there is no stream (M4). Both markets are the Market part's reads (M11).** One source, `MarketQuoteSource.snapshot` (`src/market-quotes.ts`, Task 1), reads the Market through the face's proxy (`src/account-proxy.ts`): US symbols by its `explore` read, one a symbol, every 20 s; A shares by its `quotes` read, `pairs=china|<code>` twelve a read, every 10 s. The face holds no market wire of its own.
  - Each poll runs only inside its market's session window, from the XNYS calendar or the new XSHG table.
  - The market grammar is `src/symbols.ts` (import-free), Beijing time is `src/et.ts`'s, and `src/xshg-clock.ts` holds the closure table alone, so the pause switch stays light.
- **The watch.** `src/watch.ts` reloads the book through `desk-book.ts`, judges each print with the pure evaluator in `watch-eval.ts`, and records every hit in `alerts.jsonl` through one chain. It sends the text from `alert-text.ts` through the conversation's `deliver`, then posts one annotation per pass, never awaited; the annotation's answer comes as a reply. It starts in the schedule's chain, after the bridge settles, on the one `DeskCalendars` the schedule shares.
- **Filings.** `src/edgar.ts` reads EDGAR in Node every 5 minutes, 07:00–20:00 ET on XNYS session days. Its symbols are the US ones only, and it reads nothing without `ALPHA_EDGAR_USER_AGENT` (M2).
- **The Desk view.** A `desk` tab in Markets draws `/data/desk/status`: status, runs, firings and sleep gaps, standing orders, the watch with its levels, today's alerts per market, and refusals. The page reads the status while Markets shows, so a level shows on its market's row and page (M1).

**Tech Stack:** Node 22, TypeScript strict via `tsx`, `node:test`; js-yaml 4.3.2 (`CORE_SCHEMA`); global `fetch` (Node 22) for EDGAR, injected everywhere it is tested; the gravit-ui client (plain ESM, fake-DOM tests); dsh 0.2.0-rc.2 unchanged. No dependency added, no Python.

**Spec:** `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` — §5.5–§5.10, §6, §7, §9, §12 as amended by **§15 (M1–M8, M11), which wins where they disagree**. Binding beside it: `.superpowers/research/desk-p1-p4/controller-notes.md` (the P1 and P2 rulings, the P3 rulings this plan keeps — see "Rulings carried" — and "Plan review rulings, 2026-11-01 evening", which this revision applies), and `replan-brief.md`'s M9 and M10. A "review" tag (review S4) cites a finding of `.superpowers/research/desk-p1-p4/p3-plan-review-2026-11-01-evening.md`.

**Base:** `feat/desk-p1-p4` at `e36649a8` (main `7f15917f` merged at `635dea7d`: the face's own market wire is gone, every market is the Account's Market part read through `src/account-proxy.ts`; P0–P2 on that tree, the desk's US quotes already from the proxy's `explore` read). Recurring facts, each checked on that tree:
- the outlet's `send(text, { replyTo })` resolves `{ sent: number[]; queued?: true } | { queued: true }`;
- `DeskConversationDeps.deadlineFor(kind)` already exists;
- `installDesk`'s `hub` is a `UsQuoteSource` from `src/us-quotes.ts` (`accountUsQuotes` over the proxy's `explore` reader): Task 1 renames all three for both markets (M11), and no later task uses the old names;
- `registerAccountProxy` returns `{ reader, explore, dispose }`; its in-process `AccountRouteRead` never re-serves a stale answer ("a failure is the failure");
- the proxy's `quotes` route (`ACCOUNT_QUERY.quotes = ["pairs"]`, `ACCOUNT_TTL_MS.quotes` 3 s) serves `GET /api/account/quotes?pairs=china|<code>,…`, at most twelve pairs a read (the Account's own cap). It answers `{ ok: true, quotes: [{ venue, symbol, market?, refusal? }] }`, `market.cn.phase` one of `trading | midday | closed`, or a whole-read refusal `409 { ok: false, refusal }` (`the account layer is not mounted`); a `market` row has no `price` or `quoteAt` when Tencent had none;
- today's US quote keeps the Account's raw `quoteFrom` (`Robinhood · real time`, …) as its `feed`;
- `src/desk.ts` imports `src/desk-tools.ts` statically, and desk-tools.ts keeps its own `SYMBOL_RE` so as not to load `desk-book.ts`; `market-clock.ts` is already outside the pause switch's graph (`desk-weight.test.ts`'s `HEAVY`);
- `fakeCalendar` (`face/tests/desk-fakes.ts`) keys its days by `etDate`;
- **"The old Task N"** means Task N of `docs/superpowers/plans/2026-10-20-desk-p3-watch.md` (superseded, kept): its text binds where this plan says "as the old Task N", except for what this plan changes or drops.

**Done (§15 M6, P3) — the operator's drill, written by Task 13:**
- one real level crossing, on a US symbol and on an A-share symbol, reached the phone with its plan within one poll interval plus 10 s (US 30 s, A shares 20 s), read off the Desk view's `latencyMs` (from the quote's `as_of` to the send resolving; an alert sent while the outlet queues has none);
- an annotation followed inside 90 s, as a reply;
- one live EDGAR filing alert, or a recorded `suppressed:` filing line, arrived.

## Rulings carried (M9)

The kept/changed/dropped table for every old P3 ruling is in `.superpowers/research/desk-p1-p4/replan-report.md` §1. These stand unchanged:
- P3-5, the day rebuilt from `alerts.jsonl`;
- P3-6, one pass makes one annotation, and the `[alerts · <n> · <HH:MM ET>]` form;
- P3-8, `rules.yml` under `CORE_SCHEMA`, with `kind:` and `symbols:`;
- P3-9, halts refused;
- P3-10, the mute;
- P3-11 with P3-22, the desk-state inject, idle only;
- P3-12, 90 s annotations as replies; the budget stops annotations; OFF stops sending;
- P3-13, six an hour, the overflow batched, a 30-minute cooldown;
- P3-15, an annotation's own failure line;
- P3-21's lease and its send-before-post order;
- the old plan's rulings 1, 3–6, 11–14 and 16–17, re-numbered below;
- by number, the old plan's ruling 15 (`desk_state` carries the ten nearest levels and the last ten alerts, never `watch.marks`; Task 10), 20 (ruling 13 here) and 21 (no pre-step hook for wakes: the watch opens turns only through `post`, which checks the fence).

## Rulings this plan makes

Each that can be wrong ends with its cost.

1. **What fires** (old 1, kept; review R3). A level or a `move_pct` key fires on a crossing between two judged observations of one session. It also fires once, labelled `gap`, when already past at its first judged observation of a session and not yet alerted for that session. A key that reads the previous close (`move_pct`, `gap`) observes only prints that carry one. A `gap` rule judges only its first such observation, and only inside 30 minutes of its market's open: a Robinhood-priced US row carries no `change24h` until Cboe's first trade, about 09:45 New York. Cost: a `move_pct` and a `gap` rule on one symbol both fire on a large opening gap; a gap whose previous close comes after 30 minutes is never said.
2. **What is judged (M5).**
   - **US.** A print whose `as_of` lies in `[open, close)` of the XNYS session of its own ET date.
   - **A shares.** A print whose `cn.phase` is `trading` (the Market's own phase, M5), whose Beijing date is the session's, and whose Beijing clock lies in `[09:30, 11:30)` or `[13:00, 15:00)`. So the 09:15–09:25 auction and the midday break are never judged.
   - **The A-share close (review R4).** A print stamped inside `[15:00:00, 15:00:30]` Beijing on the session's date is judged as the session's close print whatever its phase says, once per `as_of`.
   - **Never judged,** in either market: a print whose `quote_status` is `stale` or `unavailable`.
   - **The poll windows.** Each market is polled from 10 minutes before its open to 1 minute after its close, and not at all on a closed day.
   - **Past the XSHG table** (after 2026-12-31) the A-share window is 09:20–15:01 Beijing on weekdays, and the Market's phase alone decides, with one line a Beijing date. A failed cn calendar answer while `bjDate(now) > XSHG_COVERED.through` is this case, never `no-calendar`. P4's anchors still refuse past the table (§15 M5, amended by Task 13).
   - **Dates.** The cn lines (`noPrices`, `overCap`, `unpriced`) and `markets.cn` key on the Beijing session date, the US ones on the ET session date, so one A-share session is one day though its window crosses New York's midnight; `today` counts by each market's session date (review S4).

   Cost: a print after the close reaches the operator only through `desk_quotes` or the brief, and a close print stamped after 15:00:30 is not judged.
3. **Cadence (M4).**
   - **US:** `WATCH_US_POLL_MS = 20_000`. That is the proxy's explore cache (`ACCOUNT_TTL_MS.explore`), so polling faster only re-reads the cache. The reads go through the one source at `QUOTES_CONCURRENCY` (6).
   - **A shares:** `WATCH_CN_POLL_MS = 10_000`: two of the Account's 5 s China quote lives, so each poll is a fresh read; the proxy's `quotes` cache is 3 s. A poll is `ceil(n / CN_QUOTES_BATCH)` reads of twelve pairs, the Account's cap on one `quotes` read.
   - **Caps:** `WATCH_US_MAX = 40`, because the proxy keeps 64 explore answers (`ACCOUNT_CACHE_KEYS`) and the Markets screen needs the rest. `WATCH_CN_MAX = 60`: five reads a poll, five of the proxy's 64 `quotes` keys. The symbols past a cap are named on the phone once per distinct set per session date, holdings first, then levels, then rule symbols.
   - **The tick:** `WATCH_TICK_MS = 5_000` decides which polls are due.

   Cost: a US crossing can wait up to 20 s for the cache, plus the reads; an A-share one up to 10 s plus five reads.
4. **One source for both markets (M4 re-based, M11).** `src/us-quotes.ts` becomes `src/market-quotes.ts`, and `accountUsQuotes` becomes `marketQuotes`, grown to A shares through the proxy's `quotes` reader beside its `explore` reader; `installDesk`, the tools, the brief and the schedule take it as `quotes: MarketQuoteSource`. There is no second type, no hub and nothing of the face's own.
   - **Why.** The face's A-share wire is gone with main `7f15917f`; the Market part answers every market the same way (M11).
   - **The market grammar** is `src/symbols.ts`, import-free (`Market`, `SYMBOL_RE`, `CN_SYMBOL_RE`, `marketOf`, `idOf`). desk-book.ts, market-quotes.ts and desk-tools.ts import it, so `desk_quotes` routes six digits without loading the book (review B3).
   - **Feeds (review B2).** `feedOf(quoteFrom)` names a quote's feed in the Market's words: `robinhood`, `nasdaq`, `cboe delayed`, `tencent`. `quote_status` is `delayed` when the raw word matches `/delay/i`, as today.
   - **Stale.** A body with `stale: true`, which the in-process read never returns, is marked `stale` and never judged.

   Cost: a face with no Account read has no price in either market, said once per session date per market (`noPrices`).
5. **Repeats, gates, batch, annotation** (old 3–6, kept).
   - **Cooldowns.** A price hit inside its cooldown is counted, not recorded. A filing hit inside its cooldown is recorded `suppressed: cooldown`.
   - **Gates.** They run OFF, then MUTE, then the cap. The budget stops only annotations. A suppressed alert is never annotated.
   - **The batch.** Only `cap` alerts are batched. A batch goes at the first tick in a later ET hour; it is dropped and recorded when it falls due under OFF or MUTE. It lists at most 20 items.
   - **The annotation.** One post per pass, replying to the first delivered alert's first message id. Rules default to `annotate: false`, and `annotate: true` needs a `plan`.

   Cost: a capped alert waits up to an hour, and an alert under MUTE is never sent.
6. **The state inject** (old 11, kept). It goes before a phone post only while the desk session is idle. It holds every holding, the levels within 2% (at most 10, nearest first), and today's counts. It is priced by one snapshot per market, each raced at 3,000 ms. Cost: a text queued behind a turn carries no state.
7. **One watch per home** (old 12, changed only in cadence). `watch.lease` (`{ pid, since, beat }`) is rewritten every `LEASE_BEAT_MS = 30_000`. It is stale when its pid is gone (`ESRCH`/`EPERM`) or its beat is `LEASE_STALE_MS = 120_000` old, and a stale lease is taken over: a check-and-write under P0's lock (`withFileLock`) with a re-read after the write, so of two faces only the pid the re-read names holds it (review R2). Cost: a second face waits up to 2 minutes.
8. **Load lines** (old 14, kept). The watch re-reads `desk/levels.yml`, every `strategies/<name>/levels.yml`, `desk/holdings.yml` and `desk/rules.yml` on an mtime or size change and on each new ET date. It sends one line per distinct `(file, sha256 or error, refusals)`. A broken file keeps its last good load. Strategy files are read unpinned: this is recorded as charter D28, not held. Cost: each edit sends a line.
9. **Filings (M2).**
   - **Symbols.** The filing rules' resolved **US** symbols, at most `FILINGS_SYMBOLS_MAX = 60`, holdings first. A-share symbols are skipped and counted.
   - **Window.** Polled every 5 minutes, 07:00–20:00 ET, on XNYS session days. A filing pings only when accepted on today's ET date inside that window; any other is `suppressed: window`.
   - **Baseline.** Each symbol's first good poll seeds silently.
   - **Acceptance time.** `acceptanceDateTime`'s wall time is read in America/New_York despite its `Z` (old ruling 10; the drill checks one filing).
   - **Requests.** One ticker map per ET date, a symbol looked up with `.` as `-` (`BRK.B` → `BRK-B`, SEC's spelling). Requests are spaced 200 ms apart. No symbol starts after 90 s, and a poll is aborted at 120 s.
   - **Refusals.** A poll whose every symbol is refused (401 or 403) sends one line, and filings stay off until the next ET date.
   - **No contact.** Without `ALPHA_EDGAR_USER_AGENT`, filings are `off` and nothing is fetched.

   Cost: a `Z` that is true UTC shifts times by 4–5 hours.
10. **Halts stay refused, with a new reason:** `halts need a trading-status feed; the Market's read carries none`.
11. **The brief stays US and the desk's own book (M8, the P2 fix wave's I3).**
    - It prices only US entries and counts the A-share ones in `aShares: { holdings; levels }`.
    - `notYet` becomes `scope`: `desk/ only; A shares and each strategy's levels.yml are the watch's and their reports'`.
    - It gains the alerts and filings blocks (old 13, kept).
    - `desk/STANDING.md` changes, so the armed `preclose` is `refused-hash` until `npm run desk -- rearm preclose`.

    Cost: one rearm.
12. **`desk_quotes` speaks both markets (M1).** Six digits and tickers go to the one source in one snapshot, which asks the Market's `quotes` read for the former and its `explore` read for the latter. Each line names the quote's feed and exchange time (`TENCENT 14:03:12 Beijing`, `ROBINHOOD 10:21:03 ET`), dated when not today's (`bjStamp` for an A share, `quoteTime` for a US one), never a process (M11). Its output schema gains `market`. Cost: the tool's schema grows by one pattern and one field.
13. **Names.**
    - `installDesk`'s `hub` becomes `quotes` (Task 1); it gains `watchRow` and `schedule.calendars` (Task 9); `DeskHandle.watchRow` resolves the watch's handle.
    - **One `DeskCalendars`** is built whenever the schedule starts, in its lazily imported chain: `deskCalendars({ ...(deps.schedule?.calendar && { us: deps.schedule.calendar }), ...deps.schedule?.calendars, ...deps.watchRow?.calendars })`. The schedule takes its `us` as `seams.calendar`, and the watch takes the whole.
    - `ALERT_DEADLINE_MS = 90_000` lives in `desk.ts`, with `alertDeadlineMs` as the smokes' seam.
    - Ids are `a-`, `p-` or `b-` plus 12 lowercase hex characters.
14. **Names are the Market's (M11).** The desk's data interfaces are named for the Market part in code, copy and documents: `market-quotes.ts`, `MarketQuoteSource`, `marketQuotes`, "the Market's read"; a quote's `source` is `market` and its stamp names its feed. Its messages (review S5): `the Market read refused: <message>`, `the Market read lists no US share <SYM>`, `the Market read lists no A share <code>`, `the Market read has no timed price for <SYM|code>`, `the Market read answered <status> with no JSON`, `busy: the Market read refused for now; try again shortly`. The process keeps its own: `the Account is not reachable`, `the Account is busy`, `the Account did not answer in time`, `the Account seat row is disabled`. Cost: one rename across the desk's P2 files and tests, in Task 1.
15. **Built as asked, pending the operator's answers** (the five questions of `replan-report.md` §3, unanswered at this revision). Each is built as this plan reads it, and the review may flip any with one ruling: the Desk view is a tab in Markets (M1); A-share alerts are sent in New York's night, the mute (Task 4) being the operator's lever; the US floor is the 20 s explore cache plus the reads; an unquoted six-digit symbol is refused, not coerced (M3); P4's drill strategy is `lunhui-s01-repair`. The Desk view carries §5.7's status, runs, firings, sleep gaps, standing orders, the levels as loaded, the watch and today's alerts; §5.7's "since you last looked" is dropped, because the page keeps no reader state and today's alerts stand in for it (review S16). Cost: a flipped answer re-opens one task's copy or one test.
16. **Blind is said, once (spec §5.10; review S2, R1, R5).**
    - A market's poll that rejects, or whose every quote is `unavailable`, is a failed poll: `noPrices(market, reason)` once per session date per market, the reason being the rejection's message or the first quote's.
    - A watched symbol `unavailable` on its first `UNPRICED_POLLS = 3` polls of a session date, priced on none, sends `unpriced(symbol, reason)` once per (symbol, reason) per session date.
    - An alert whose send answers `{ queued: true }` records `latency: { tradeMs: null, receivedMs: null }` (the Desk view's `latencyMs` null), and its annotation posts without `replyTo`.

    Cost: a symbol that prices on its fourth poll was said blind once.

## Global Constraints

- **B2.** Nothing in P3 places, cancels or proposes an order. An alert quotes the plan verbatim and stops. `edgar.ts` imports nothing from `account-seat.ts`, `orders.ts` or `account-proxy.ts` (a grep test).
- **Ledger.**
  - Files live under `$DSH_HOME/face/desk/`, mode `0600`, through P0's lock, and a failure is one `gravit-face:` line. New files: `alerts.jsonl`, `filings.jsonl`, `MUTE` and `watch.lease`.
  - `events.jsonl` gains `mute-set`, `mute-cleared` and `watch-load`.
  - The watch appends `alerts.jsonl`, `filings.jsonl` and its events each through one `appendChain`.
- **YAML.** `rules.yml` is read through `readDeskYaml` (CORE_SCHEMA). Every rule has `kind:` (`move_pct`, `gap`, `filing`) and `symbols:`, never `on:`. An unknown key or kind is refused.
- **No live network in any test (P3-18, M2).**
  - No test, smoke or browser check reaches the SEC or the Account, and so no market host.
  - `edgar.ts` takes `fetch` as a dependency; the watch's tests and the smoke pass fakes.
  - The smoke and the browser check boot without `ALPHA_EDGAR_USER_AGENT` and with `FACE_ACCOUNT_URL=http://127.0.0.1:9`, so no read leaves the host; their sources are fakes.
- **Starting (P3-19, reworded).**
  - The watch starts only when `installDesk` is given `watchRow` (main.ts passes `{}`), with the desk conversation, the schedule's wiring and a `quotes` source whose `unavailable` is unset. It starts in the schedule's chain after `bridging` settles, whether or not a bridge runs. One source serves both markets, so a face with no Account read watches neither.
  - With nothing to watch, it asks no calendar, polls nothing and sends no line.
  - P1's and P2's tests and smokes stay green, unchanged but for the assertions each task names.
- **Module weight.** Importing `src/desk.ts` or `scripts/desk.ts` loads none of `watch.ts`, `watch-eval.ts`, `alert-text.ts`, `edgar.ts`, `filings.ts` or `xshg-clock.ts`, nor any module `desk-weight.test.ts` already calls heavy. `src/symbols.ts` imports nothing; desk-tools.ts takes P3's names from `symbols.ts` and `et.ts` alone, never from `desk-book.ts` or `xshg-clock.ts`. `installDesk` imports `./watch.ts` on first use, after `./schedule.ts`.
- **Phone lines, exact.** `<HH:MM ET>` comes from `deskTime`; `<file>` is repo-relative.

  | When | Line |
  |---|---|
  | an alert | `alertText` (Task 7) |
  | the overflow | `<n> more alerts suppressed: <SYMBOL> <label> <HH:MM ET>, …[, and <k> more]` (`1 more alert suppressed: …`) |
  | a file refused | `<file> is refused, so the watch keeps its last good load: <error>` |
  | a file loaded with refusals | `<file>: <n> loaded, <k> refused - #<i>[ <SYMBOL>]: <reason>; …` (cut at 500 characters with `…`) |
  | a file changed, nothing refused | `<file> changed (sha256 <8 hex>): <n> loaded` |
  | over a market's cap | `the watch covers <n> <US | A-share> symbols; not watched: <SYMBOL>, …` (cut at 500) |
  | a market's first failed poll of its session date (rejected, or every quote `unavailable`) | `the watch has no <US | A-share> prices today: <reason>` |
  | a watched symbol unpriced on its first three polls of a session date (once per symbol and reason) | `the watch has no price for <SYMBOL> this session: <reason>` |
  | A shares past the XSHG table (once per Beijing date) | `the A-share calendar ends <last date>; the watch judges A shares on the Market's phase alone until face/src/xshg-clock.ts is extended` |
  | no XNYS calendar (once per ET date) | `the watch is off for US shares today: the market calendar failed (<error>)` |
  | held elsewhere (once per ET date) | `this face does not watch: another face (pid <n>) holds the watch on this home` |
  | filings with no contact (once per ET date, only with a filing rule) | `the watch's filings are off: set ALPHA_EDGAR_USER_AGENT to a contact email (SEC asks for one)` |
  | every symbol refused by SEC (once per ET date) | `the watch's filings are off until tomorrow: SEC refused every request (<error>); check ALPHA_EDGAR_USER_AGENT` |
  | filings over the cap | `the watch's filings cover 60 symbols; not polled: <SYMBOL>, …` (cut at 500) |
  | `/mute <d>` | `alerts muted until <HH:MM ET>; detection and the ledger go on. A terminal lifts it: npm run desk -- unmute` |
  | `/mute` with no or a bad duration | `mute needs a duration: /mute 30m, /mute 2h or /mute 1d` |
  | an annotation post refused | the post's own line, as a reply, once per ET date per line |
  | an annotation cut at its deadline | `timed out after 90 s; a card or a long tool was pending`, as a reply |
  | an annotation whose model call failed | `the desk could not annotate this alert: <error>`, as a reply |
  | an annotation that ended with no text | `the desk's check of this alert ended with no text`, as a reply |

- **Tests.** Never `~/.dsh`, `launchctl` or `npm run service`. Real boots happen only in `FACE_SMOKE=1` smokes, one per file, with fixtures under `face/tests/tmp/<file>-<pid>/`.
- **Conventions.** `||` for env defaults; the `gravit-face:` prefix; strict `npm run typecheck`; module headers in the face's voice; hand-written validators with key-first refusals. Commit with explicit pathspecs; never `git add -A`.

## Review Focus

1. **A restart, a crash, or a second face.** Expected: no second `gap`; cooldowns and the hour's count kept; a dead face's lease taken over. Tests: Task 5 "rebuildDay restores the day across both markets' session dates"; Task 9 "a restart over the same ledger fires no second gap", "a stale lease is taken over" and "two watches started together over a stale lease: one holds it, the other says held-elsewhere once".
2. **A burst at the open while an annotation is slow.** Expected: twelve levels past in one poll give twelve records, six sends in order, six held for the next hour, and one `[alerts · 6 · …]` post; a hanging post never delays the next alert. Tests: Task 5 "a burst of twelve gap hits sends six and holds six"; Task 9 "an annotation post that hangs 5 s does not delay the next pass's alert".
3. **An A-share print in the auction, at lunch, at the close, or on a holiday.** Expected: never judged in the auction or at lunch. A `trading` phase at 09:20 Beijing, or at 11:45, makes no hit; the 15:00:01 close print is judged once whatever its phase; a closed XSHG day polls nothing. Tests: Task 5 "an A-share print is judged only inside 09:30-11:30 and 13:00-15:00 Beijing with the phase trading" and "an A-share print stamped 15:00:01 Beijing with phase closed is judged once; at 15:00:31 it is not"; Task 9 "a closed XSHG day polls no A share".
4. **The Market's read slow, refusing or busy.** Expected: a 429, an unreachable Account or a read refusing every pair makes no hit and no thrown tick. A delayed feed's alert says its feed; one line per session date per market says its prices are gone. Tests: Task 9 "the Market's read busy or unreachable sends one line per session date per market and judges nothing" and "a poll whose every A-share quote is refused sends noPrices once"; Task 7 "a delayed US quote's stamp names its feed".
5. **A levels file edited while the face runs, or a six-digit symbol typo.** Expected: the next tick reloads it. `60051` is refused as a symbol; an edited plan keeps its cooldown; a broken edit keeps the last good load. Tests: Task 1 "marketOf reads six digits as an A share and refuses five" (symbols.test.ts); Task 9 "levels.yml edited while the face runs is reloaded on the next tick".

---

### Task 1: Two markets in the book, the Market's one quote source, `desk_quotes` and the brief

**Files:**
- Create: `face/src/symbols.ts`, `face/tests/symbols.test.ts`
- Rename (`git mv`): `face/src/us-quotes.ts` → `face/src/market-quotes.ts`; `face/tests/us-quotes.test.ts` → `face/tests/market-quotes.test.ts`
- Modify: `face/src/et.ts`, `face/src/account-proxy.ts` (the `quotes` reader beside `explore`), `face/src/desk-book.ts`, `face/src/desk-tools.ts`, `face/src/desk.ts` (`installDesk`'s `hub` becomes `quotes`), `face/src/brief.ts`, `face/src/schedule.ts` (`createDeskSchedule`'s `hub` becomes `quotes`), `face/src/main.ts`, `face/scripts/schema-sizes.ts`, `desk/levels.example.yml`
- Test: `face/tests/symbols.test.ts`, `face/tests/et.test.ts`, `face/tests/market-quotes.test.ts`, `face/tests/account-proxy.test.ts`, `face/tests/desk-book.test.ts`, `face/tests/desk-tools.test.ts`, `face/tests/brief.test.ts`; renamed in place (`hub` → `quotes`), behaviour unchanged: `desk.test.ts`, `desk-guard.test.ts`, `firing.test.ts`, `desk-smoke.test.ts`, `telegram-smoke.test.ts`, `schedule-smoke.test.ts`

**Interfaces:**
- Consumes: `SYMBOL_RE`, `loadLevels`, `loadHoldings`, `Level`, `Holding` (desk-book.ts); `AccountAnswer`, `AccountRouteRead`, `registerAccountProxy`, `ACCOUNT_QUERY`, `ACCOUNT_TTL_MS` (account-proxy.ts); at the base, `UsQuoteIdentity`, `UsLiveQuote`, `UsQuotePayload`, `UsProviderState`, `UsQuoteSource`, `accountUsQuotes`, `unwiredUsQuotes`, `NO_US_QUOTES`, `ACCOUNT_QUOTES_CONCURRENCY` (us-quotes.ts); `BriefDeps`, `Brief` (brief.ts); `DeskToolDeps`, `quoteTime` (desk-tools.ts); `etDate`, `etClock` (et.ts); `HttpError`.
- Produces, `symbols.ts` (imports nothing):
  - `type Market = "us" | "cn"`; `SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/`, moved from desk-book.ts, which re-exports it; `CN_SYMBOL_RE = /^\d{6}$/`;
  - `marketOf(symbol: unknown): Market | undefined` — `cn` for `CN_SYMBOL_RE`, `us` for `SYMBOL_RE`, else `undefined`;
  - `idOf(market: Market, symbol: string): string` — `us:NVDA`, `cn:600519`.
- Produces, `et.ts`: `bjDate(d: Date): string` (`YYYY-MM-DD`) and `bjClock(d: Date): string` (`HH:MM:SS`), both in Asia/Shanghai; `bjStamp(asOf: Date, now: Date): string` — `HH:MM:SS Beijing`, or `YYYY-MM-DD HH:MM:SS Beijing` when `bjDate(asOf) !== bjDate(now)`.
- Produces, `account-proxy.ts`: `registerAccountProxy` returns `{ reader; explore; quotes: AccountRouteRead; dispose }` — the `quotes` route's in-process read, through the same cache (`ACCOUNT_TTL_MS.quotes`, 3 s) and flights its `/data/account/quotes` is served from, exactly as `explore` is today.
- Produces, `desk-book.ts`: `Level.market: Market` and `Holding.market: Market`, from `marketOf`. A symbol neither grammar takes is refused with `symbol must be a US ticker (NVDA, BRK.B) or six digits for an A share (600519)`, which replaces `BAD_SYMBOL`'s text.
- Produces, `market-quotes.ts` — the renamed module, every name the Market's (M11); it imports `Market` and `idOf` from symbols.ts:
  - `interface MarketQuoteIdentity { id: string; market: Market; symbol: string }` (was `UsQuoteIdentity`).
  - `feedOf(quoteFrom: string): string` — `Robinhood · real time` → `robinhood`, `Nasdaq · real time` → `nasdaq`, `Cboe · 15 min delayed` → `cboe delayed`, `Tencent` → `tencent`; any other word lower-cased, `·` dropped, spaces collapsed and trimmed, at most 40 characters.
  - `interface MarketQuote extends MarketQuoteIdentity` (was `UsLiveQuote`): the same fields; `source` is the constant `"market"`; `feed` is `feedOf(quoteFrom)`; `quote_status: "live" | "delayed" | "stale" | "unavailable"`, a US quote `delayed` when its raw `quoteFrom` matches `/delay/i`; `market_status` is `open` for an A share in `trading`, `closed` for `midday` and `closed`, `unknown` for a US quote; `cn?: { phase: "trading" | "midday" | "closed"; lastSession: string | null }` on an A share alone.
  - `interface MarketQuotePayload` (was `UsQuotePayload`), its `providers` one `MarketProviderState` (was `UsProviderState`) per market asked, `id` and `source` `"market"`.
  - `interface MarketQuoteSource { snapshot(assets: MarketQuoteIdentity[]): Promise<MarketQuotePayload>; readonly unavailable?: string }` (was `UsQuoteSource`).
  - `NO_QUOTES = "no quote source is wired: this face has no Market read to ask"` (was `NO_US_QUOTES`); `unwiredMarketQuotes(): MarketQuoteSource` (was `unwiredUsQuotes`).
  - `QUOTES_CONCURRENCY = 6` (was `ACCOUNT_QUOTES_CONCURRENCY`); `CN_QUOTES_BATCH = 12`, the Account's cap on one `quotes` read.
  - `marketQuotes(deps: { explore: AccountRouteRead; quotes: AccountRouteRead; now?: () => number; concurrency?: number }): MarketQuoteSource` (was `accountUsQuotes`). A snapshot splits its assets by `market` and keeps the order asked:
    - US, as today: one `explore?q=<SYM>&key=stock:<SYM>&limit=1` per symbol, at most `QUOTES_CONCURRENCY` in flight, its messages the Market read's (ruling 14);
    - A shares: the codes sorted and cut into reads of at most `CN_QUOTES_BATCH`, each `quotes?pairs=china|<code>,…`, the reads in the same lanes. A row with `market` and a timed price is the quote: `price`; `quoteAt` → `as_of`; `change24h` → `change`; `changePct24h` → `change_pct`; `cn.prevClose` → `prev_close`; `cn.volume` → `volume`; `cn.quoteStatus` → `quote_status`; `cn.phase` and `cn.lastSession` → `cn`; `feedOf(quoteFrom)` → `feed`;
    - the A-share failures, in ruling 14's words as `quoteOf` says a US one's: a row with `refusal` is `unavailable` with its `message`; a code the answer lacks is `lists no A share`; a `market` row without `price` or `quoteAt` is `has no timed price`; a read answered non-2xx or `ok` not `true` is `refused` (`<refusal.message | status N>`) for every pair of it, and a body with no JSON `answered <status> with no JSON` for every pair;
    - a body with `stale: true`, which the in-process read never returns, marks every quote of that read `quote_status: "stale"`;
    - the snapshot rejects — an `HttpError` 429 when busy — only when no read of any market was answered, as today.
- Produces, `desk-tools.ts`. It imports `SYMBOL_RE`, `CN_SYMBOL_RE`, `marketOf` and `idOf` from symbols.ts (its own `SYMBOL_RE` goes) and `bjStamp` from et.ts; never desk-book.ts.
  - `DeskToolDeps.hub` becomes `quotes: Pick<MarketQuoteSource, "snapshot" | "unavailable">`.
  - `desk_quotes` takes 1–20 symbols, each matching `SYMBOL_RE` or `CN_SYMBOL_RE` (the schema's pattern `^[A-Z][A-Z0-9.-]{0,9}$|^\d{6}$`). Its refusals read `desk_quotes takes symbols: 1 to 20 US tickers or six-digit A shares` and `desk_quotes takes US tickers in capitals (NVDA, BRK.B) or six digits for an A share (600519); <value> is not one`.
  - It asks one snapshot (the source splits the markets) and answers in the order asked. `QUOTE_SCHEMA` gains `market: { type: "string", enum: ["us", "cn"] }` in its properties and its `required` (review S6).
  - A line reads `600519 1452.3, +0.85% vs prev close 1440.06 | TENCENT 14:03:12 Beijing | poll | live`: `quoteTime` for a US quote, the feed upper-cased and `bjStamp(as_of, now)` for an A share.
  - `BUSY` becomes `busy: the Market read refused for now; try again shortly`; the description names both markets and "the Market's read".
- Produces, `desk.ts` and `schedule.ts`: `installDesk`'s `hub` is `quotes: MarketQuoteSource`, handed to the tools, the brief and (Task 9) the watch; `createDeskSchedule`'s `hub` is `quotes?: MarketQuoteSource`, still optional, handed to `briefProducer`.
- Produces, `brief.ts`:
  - `BriefDeps.hub` becomes `quotes`;
  - `Brief.aShares: { holdings: number; levels: number }`, placed after `levels`;
  - `notYet` replaced by `scope: typeof BRIEF_SCOPE`, with `BRIEF_SCOPE = "desk/ only; A shares and each strategy's levels.yml are the watch's and their reports'"`;
  - A-share entries are neither priced nor listed; the snapshot is asked for `us:` ids alone.
- Produces, `main.ts`: `installDesk(…, { quotes: marketQuotes({ explore: proxy.explore, quotes: proxy.quotes }) })`; its comment says the Market's reads, not the Account's (M11).
- `desk/levels.example.yml` gains a fourth entry: `symbol: "600519"` (quoted, so YAML keeps it a string), `kind: watch`, `price: 1400`, `when: cross_down`, a one-line plan, `expires: 2026-12-31`. A comment says six digits is an A share. The comment is needed because YAML would read an unquoted `600519` as a number, and the loader refuses a number.
- **Stale comments (the revision's residual).** Every module header and doc comment in market-quotes.ts, desk-tools.ts, brief.ts, desk.ts, desk-book.ts and schedule.ts that names the hub, `/data/quotes` or `src/quotes.ts` is rewritten for the Market's read.
- Nothing under `face/` names `UsQuoteSource`, `accountUsQuotes`, `unwiredUsQuotes`, `us-quotes` or a desk `hub` afterwards; Step 4's greps pin it.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/symbols.test.ts
test("marketOf reads six digits as an A share and refuses five", () => {
  assert.equal(marketOf("600519"), "cn"); assert.equal(marketOf("NVDA"), "us"); assert.equal(marketOf("BRK.B"), "us");
  assert.equal(marketOf("60051"), undefined); assert.equal(marketOf(600519), undefined); assert.equal(marketOf("sh600519"), undefined);
  assert.equal(idOf("cn", "600519"), "cn:600519"); assert.equal(idOf("us", "NVDA"), "us:NVDA");
});
test("symbols.ts imports nothing", () => { /* its source matches no /^import /m */ });
// face/tests/et.test.ts (append)
test("bjDate, bjClock and bjStamp read Beijing time, which keeps no daylight time", () => {
  assert.equal(bjDate(new Date("2026-11-01T16:30:00Z")), "2026-11-02"); assert.equal(bjClock(new Date("2026-07-01T06:03:12Z")), "14:03:12");
  assert.equal(bjStamp(new Date("2026-12-01T06:03:12Z"), new Date("2026-12-01T06:03:20Z")), "14:03:12 Beijing");
  assert.equal(bjStamp(new Date("2026-11-27T07:00:00Z"), new Date("2026-11-30T01:00:00Z")), "2026-11-27 15:00:00 Beijing");
});
// face/tests/market-quotes.test.ts — the renamed us-quotes.test.ts, its fixture's quoteFrom the Account's words (NVDA "Nasdaq · real time", SPY "Cboe · 15 min delayed").
// Its US assertions stand under the new names but: nvda.feed "nasdaq", spy.feed "cboe delayed", the line's "| NASDAQ 15:21:03 ET |", /the Market read refused: …/. Then:
test("feedOf names each of the Account's feeds in the Market's words", () => {
  assert.equal(feedOf("Robinhood · real time"), "robinhood"); assert.equal(feedOf("Nasdaq · real time"), "nasdaq");
  assert.equal(feedOf("Cboe · 15 min delayed"), "cboe delayed"); assert.equal(feedOf("Tencent"), "tencent");
  assert.equal(feedOf("  Some · New   Feed "), "some new feed"); assert.equal(feedOf("X".repeat(60)).length, 40);
});
test("an A-share snapshot asks the quotes read twelve pairs at a time, sorted, and maps the China row", async () => {
  // 13 codes → quotes("pairs=china|000001,…" twelve pairs) then quotes("pairs=china|…" one); a row { venue: "china", symbol: "600519",
  //   market: { price: 1452.3, quoteAt: "2026-12-01T06:03:12Z", quoteFrom: "Tencent", change24h: 12.24, changePct24h: 0.85,
  //   cn: { prevClose: 1440.06, phase: "trading", quoteStatus: "live", lastSession: "2026-12-01", volume: 31200 } } }
  // → { id: "cn:600519", market: "cn", symbol: "600519", price: 1452.3, prev_close: 1440.06, change_pct: 0.85, as_of: "2026-12-01T06:03:12Z",
  //     feed: "tencent", source: "market", quote_status: "live", market_status: "open", cn: { phase: "trading", lastSession: "2026-12-01" } }
});
test("a refused pair, a missing code, an untimed row, a refused read and a body with no JSON are said, never priced", async () => {
  // { refusal: { message: "no A-share quote for 000000" } } → unavailable, message that; a code the answer lacks → "the Market read lists no A share 000002";
  // a market row with neither price nor quoteAt → "the Market read has no timed price for 000003";
  // a 409 { ok: false, refusal: { message: "the account layer is not mounted" } } → every pair of that read "the Market read refused: the account layer is not mounted";
  // a 200 body "<html>" → every pair "the Market read answered 200 with no JSON"
});
test("one snapshot over both markets keeps the order asked and rejects only when no read answered", async () => {
  // ["600519", "NVDA"] asked as [cn, us] → quotes[0].symbol "600519", quotes[1].symbol "NVDA"; explore and quotes both unreachable →
  //   rejects "the Account is not reachable"; one answered → resolves, the other's quotes unpriced with that reason
});
// face/tests/account-proxy.test.ts (append)
test("the quotes reader reads through the quotes route's cache", async () => { /* two reads of one query inside 3 s → one upstream GET /api/account/quotes?pairs=…; a disabled row → { unreachable: "disabled" } */ });
// face/tests/desk-book.test.ts (append; P2's three `symbol must be a ticker: …` expectations, at :194, :280 and :317, read the new reason with their own `(got …)`)
test("levels and holdings carry their market; an unquoted 600519 is refused, not coerced", async () => {
  // "- symbol: \"600519\" …" → entries[0].market "cn"; "- symbol: 600519 …" → refusal reason "symbol must be a US ticker (NVDA, BRK.B) or six digits for an A share (600519) (got 600519)"
});
test("the shipped levels.example.yml loads with no refusal and one A share", async () => { /* markets ["us","us","us","cn"] */ });
// face/tests/desk-tools.test.ts (append; P2's "desk_quotes validates, caps at 20…" gains market: "us" in its deep-equal value, and its BUSY text reads
// "busy: the Market read refused for now; try again shortly")
test("desk_quotes asks one snapshot over both markets and answers in the order asked", async () => {
  // ["600519", "NVDA", "000001"] → quotes.snapshot([cn:600519, us:NVDA, cn:000001]) once; quotes[0] { symbol: "600519", market: "cn", feed: "tencent" };
  // the line "600519 1452.3, +0.85% vs prev close 1440.06 | TENCENT 14:03:12 Beijing | poll | live"; at 2026-12-02T02:00:00Z the same quote reads "TENCENT 2026-12-01 14:03:12 Beijing"
});
test("desk_quotes' output schema requires market", () => {
  // the tool's output.schema.oneOf[0].properties.quotes.items: properties.market deep-equals { type: "string", enum: ["us", "cn"] }, and required includes "market"
});
test("desk_quotes on an unwired source answers NO_QUOTES for every symbol", async () => { /* error "unavailable: no quote source is wired: this face has no Market read to ask" */ });
// face/tests/brief.test.ts (append; P2's assertions at :151 and :350 move from notYet to scope === BRIEF_SCOPE, :187's expected value names scope, and
// :191's key order is ["date", "takenAt", "session", "indexes", "sectors", "holdings", "levels", "aShares", "scope"])
test("the brief prices only US entries and counts the A shares", async () => {
  // holdings NVDA + 600519, levels AAPL + 000001 → the snapshot asked for [us:NVDA, us:AAPL] alone; aShares { holdings: 1, levels: 1 }; scope === BRIEF_SCOPE
});
```

- [ ] **Step 2: Run them to verify they fail** — `cd face && npx tsx --test tests/symbols.test.ts tests/et.test.ts tests/market-quotes.test.ts tests/account-proxy.test.ts tests/desk-book.test.ts tests/desk-tools.test.ts tests/brief.test.ts`. Expected: FAIL (`symbols.ts`, the Beijing clock, `feedOf`, the `quotes` reader).
- [ ] **Step 3: Implement.** `git mv` the two files first, then the rename across `face/`; `symbols.ts` and the Beijing clock; the loaders take the symbol through `marketOf`; `marketQuotes` splits by `market`; `desk_quotes` maps an A share's `MarketQuote` to the desk's quote shape; `main.ts` passes both readers; the stale comments.
- [ ] **Step 4: Run them to verify they pass**, then `npm test && npm run typecheck` (`desk-weight.test.ts` green unchanged), and these, each printing nothing: `grep -rnE "accountUsQuotes|UsQuoteSource|unwiredUsQuotes|us-quotes|NO_US_QUOTES" face/src face/scripts face/tests`, `grep -rnw "hub" face/src` and `grep -rnE "/data/quotes|src/quotes\.ts" face/src`. Then `FACE_SMOKE=1 npx tsx --test tests/desk-smoke.test.ts tests/smoke.test.ts tests/schedule-smoke.test.ts tests/telegram-smoke.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add face/src/symbols.ts face/tests/symbols.test.ts face/src/et.ts face/tests/et.test.ts face/src/market-quotes.ts face/tests/market-quotes.test.ts face/src/account-proxy.ts face/src/desk-book.ts face/src/desk-tools.ts face/src/desk.ts face/src/schedule.ts face/src/brief.ts face/src/main.ts face/scripts/schema-sizes.ts desk/levels.example.yml face/tests/account-proxy.test.ts face/tests/desk-book.test.ts face/tests/desk-tools.test.ts face/tests/brief.test.ts face/tests/desk.test.ts face/tests/desk-guard.test.ts face/tests/firing.test.ts face/tests/desk-smoke.test.ts face/tests/telegram-smoke.test.ts face/tests/schedule-smoke.test.ts` (the `git mv` staged the deletions), message `feat(face): the desk's quotes are the Market's reads in both markets - market-quotes.ts over the proxy's explore and quotes reads; six digits are an A share; the brief stays US and counts them`.

---

### Task 2: The XSHG clock, and a calendar per market

**Files:**
- Create: `face/src/xshg-clock.ts`, `face/tests/xshg-clock.test.ts`
- Modify: `face/src/market-clock.ts` (`createMarketCalendar`'s `dateOf`, `DeskCalendars`, `deskCalendars`), `face/src/schedule.ts` (re-exports them), `face/tests/desk-fakes.ts` (`fakeCalendar`'s `dateOf`), `face/tests/market-clock.test.ts`, `face/tests/desk-weight.test.ts`

**Interfaces:**
- Consumes: `MarketSession`, `MarketWindow`, `MarketClock`, `MarketCalendar`, `createMarketCalendar`, `MAX_WINDOW_DAYS` (market-clock.ts); `bjDate` (et.ts, Task 1); `etDate`.
- Produces, `xshg-clock.ts` — the table alone; it imports only `market-clock.ts` types:
  - `XSHG_CLOCK = "builtin XSHG table (face/src/xshg-clock.ts)"`.
  - `XSHG_CLOSURES: Readonly<Record<string, string>>` — every weekday the SSE closes, keyed by date and naming the holiday. It is copied from `face/plugins/lunhui/lib/calendar/2026.json`'s seven ranges (元旦 01-01..01-03, 春节 02-15..02-23, 清明节 04-04..04-06, 劳动节 05-01..05-05, 端午节 06-19..06-21, 中秋节 09-25..09-27, 国庆节 10-01..10-07), with their SSE notice URLs in the header comment.
  - `XSHG_COVERED = { from: "2026-01-01", through: "2026-12-31" }`.
  - `xshgSession(date: string): MarketSession | "closed" | "uncovered"` — a weekday not in the table is `{ date, open: <date>T01:30:00Z, close: <date>T07:00:00Z, early: false }`.
  - `xshgWindow(from: string, days: number): MarketWindow` — the window's `days` are cut to end at `XSHG_COVERED.through`. A `from` past that throws `the A-share calendar covers 2026-01-01 to 2026-12-31; <from> is past it`.
  - `xshgMarketClock(): MarketClock`.
- Produces, `market-clock.ts`, which imports `xshg-clock.ts` and `bjDate` statically (it is already outside the pause switch's graph):
  - `createMarketCalendar(opts)` gains `dateOf?: (now: number) => string`, `etDate` by default; `today(now)` asks for `dateOf(now)`.
  - `interface DeskCalendars { us: MarketCalendar; cn: MarketCalendar }`.
  - `deskCalendars(seams?: Partial<DeskCalendars>): DeskCalendars` — the seams' calendars, else `createMarketCalendar()` for `us` and `createMarketCalendar({ ask: xshgMarketClock(), clock: XSHG_CLOCK, dateOf: (n) => bjDate(new Date(n)) })` for `cn`.
- Produces, `schedule.ts`: `export { deskCalendars, type DeskCalendars } from "./market-clock.ts"`, so desk.ts builds the one `DeskCalendars` from the module it already imports lazily (Task 9).
- Produces, `desk-fakes.ts`: `fakeCalendar(days, clock = "fake clock", dateOf = (n: number) => etDate(new Date(n)))`, its `today(now)` asking for `dateOf(now)`. Every cn fake in Tasks 9 and 12 passes `(n) => bjDate(new Date(n))`.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/xshg-clock.test.ts
test("the closure table is the Lunhui 2026 table's ranges, weekdays only", () => {
  const table = JSON.parse(readFileSync(join(REPO, "face/plugins/lunhui/lib/calendar/2026.json"), "utf8"));
  // every weekday inside each range is in XSHG_CLOSURES with its name; every key is such a weekday; nothing else
});
test("a weekday session opens 09:30 and closes 15:00 Beijing; a holiday and a weekend are closed; 2027 is uncovered", () => {
  assert.deepEqual(xshgSession("2026-11-02"), { date: "2026-11-02", open: "2026-11-02T01:30:00Z", close: "2026-11-02T07:00:00Z", early: false });
  assert.equal(xshgSession("2026-10-05"), "closed"); assert.equal(xshgSession("2026-11-01"), "closed"); assert.equal(xshgSession("2027-01-04"), "uncovered");
});
test("a window is cut at the table's end and refused past it", () => {
  assert.equal(xshgWindow("2026-12-28", 10).days, 4);
  assert.throws(() => xshgWindow("2027-01-01", 10), /covers 2026-01-01 to 2026-12-31; 2027-01-01 is past it/);
});
// face/tests/market-clock.test.ts (append)
test("a calendar asks for its own market's date", async () => {
  // dateOf bj: now 2026-11-02T00:30:00Z (ET 2026-11-01, Beijing 2026-11-02) → asked "2026-11-02", session 01:30Z-07:00Z
});
test("deskCalendars' cn calendar is the XSHG table on Beijing dates, and a seam replaces either", async () => {
  // deskCalendars().cn.clock === XSHG_CLOCK; its today(Date.parse("2026-11-02T00:30:00Z")) → { ok: true, date: "2026-11-02", session.open "2026-11-02T01:30:00Z" };
  // deskCalendars({ us: fake }).us === fake
});
test("fakeCalendar asks by its dateOf", async () => {
  // fakeCalendar({ "2026-12-01": C }, "fake XSHG", (n) => bjDate(new Date(n))).today(Date.parse("2026-12-01T01:25:00Z")) → ok, date "2026-12-01", asked ["2026-12-01"];
  // the same days without dateOf → ok: false for "2026-11-30"
});
```

- [ ] **Step 2: Run them to verify they fail** — `cd face && npx tsx --test tests/xshg-clock.test.ts tests/market-clock.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `xshg-clock.ts`, `dateOf`, `deskCalendars` with its re-export, and `fakeCalendar`'s `dateOf`.
- [ ] **Step 4: Run them to verify they pass**, then `npm test && npm run typecheck`. `desk-weight.test.ts`'s `HEAVY` gains `/src/xshg-clock.ts`, which `src/desk.ts` must not load. Expected: PASS.
- [ ] **Step 5: Commit** — `face/src/xshg-clock.ts face/tests/xshg-clock.test.ts face/src/market-clock.ts face/src/schedule.ts face/tests/desk-fakes.ts face/tests/market-clock.test.ts face/tests/desk-weight.test.ts`, message `feat(face): the XSHG clock - the SSE's 2026 closures in Node, a calendar per market, nothing guessed past the table`.

---

### Task 3: `rules.yml` and its loader

**Files:**
- Modify: `face/src/desk-book.ts`, `face/src/brief.ts` (imports the moved `levelDistancePct`; output unchanged)
- Create: `desk/rules.yml`
- Test: `face/tests/desk-book.test.ts`

**Interfaces:**
- Consumes: `readDeskYaml`, `LoadResult`, `LoadRefusal`, `Level`, `PLAN_MAX_CHARS` (desk-book.ts); `marketOf` (symbols.ts, Task 1); and the level loader's `cooldown` grammar together with its missing, oversized, not-YAML and not-a-list results.
- Produces, `desk-book.ts`, exactly as the old plan's Task 2 except:
  - `RULE_KINDS = ["move_pct", "gap", "filing"] as const`; `FILING_FORMS = ["8-K", "8-K/A", "4"] as const`; `RULES_MAX = 20`; `RULE_PCT_MAX = 50`;
  - `interface SymbolSet { holdings: boolean; levels: boolean; symbols: string[] }` — `symbols` takes US tickers and six-digit A shares;
  - `type Rule = { file; index; id; symbols: SymbolSet; annotate: boolean; plan?: string } & ({ kind: "move_pct"; movePct: number; cooldownMs: number } | { kind: "gap"; gapPct: number } | { kind: "filing"; forms: FilingForm[]; cooldownMs: number })`;
  - `loadRules(path: string, file: string): Promise<LoadResult<Rule>>`, with the old refusal table and two rows changed:

    | Entry | Reason |
    |---|---|
    | `kind: halt` | `halts need a trading-status feed; the Market's read carries none` |
    | a filing rule listing a six-digit symbol | `filings are SEC's: <SYMBOL> is an A share` |

  - `resolveSymbols(set: SymbolSet, book: { holdings: string[]; levels: string[] }): string[]` — the union, each once, sorted;
  - `levelDistancePct(level: Pick<Level, "price" | "range">, last: number): number`, moved unchanged from brief.ts.
- `desk/rules.yml` (tracked), exactly:

```yaml
# The operator's urgent-event rules: what the watch (face/src/watch.ts) sends besides price levels.
# Tracked - it holds no position and no price. Kinds: move_pct, gap, filing; a halt rule is refused.
# A symbol is a US ticker or six digits for an A share; filings are US only.
- id: holding-move
  kind: move_pct           # the move from the previous close reaches move_pct, either way
  symbols: holdings
  move_pct: 4
  cooldown: 60m
- id: index-move
  kind: move_pct
  symbols: [SPY, QQQ]
  move_pct: 1.5
- id: filing
  kind: filing             # a new 8-K, 8-K/A or Form 4: polled every 5 minutes, 07:00-20:00 ET on session days
  symbols: [holdings, levels]
  forms: [8-K, 8-K/A, 4]
# - id: holding-gap        # gap: the session's first judged print is gap_pct or more from the previous close
#   kind: gap
#   symbols: holdings
#   gap_pct: 2
```

- [ ] **Step 1: Write the failing tests** — the old Task 2's six tests, unchanged but for the halt text, plus:

```ts
test("a filing rule refuses an A share it lists, and resolves holdings that hold one", async () => {
  // symbols: [600519] on kind filing → "filings are SEC's: 600519 is an A share"; symbols: holdings loads
});
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/desk-book.test.ts` FAIL, then implement, then PASS with `npm test && npm run typecheck`; `git check-ignore desk/rules.yml` prints nothing.
- [ ] **Step 5: Commit** — `face/src/desk-book.ts face/src/brief.ts desk/rules.yml face/tests/desk-book.test.ts`, message `feat(face): rules.yml - move_pct, gap and filing kinds, symbols in both markets, halts refused`.

---

### Task 4: The mute, one append chain per file, `/mute` and `unmute`

Unchanged from the old plan's Task 3: its Files, Interfaces, tests and commit. The `DeskEvent` kinds lose `stream-down` and `stream-up`, so it adds three: `mute-set`, `mute-cleared` and `watch-load`. The test `events.jsonl takes the five new kinds` becomes `… the three new kinds`.

- **Produces** (for the tasks below): `ALERTS_FILE`, `FILINGS_FILE`, `MUTE_FILE`, `WATCH_LEASE_FILE`; `MuteState`, `readMuteState`, `writeMute`, `clearMute`; `appendChain(home, file, opts?): AppendChain` (`append`, `settled`); `muteReplyLine`; `MUTE_USAGE`; `parseCommand`'s `{ cmd: "mute"; arg?: string }`; `scripts/desk.ts`'s `unmute`. `USAGE` ends `| rearm ID [--expires YYYY-MM-DD] | unmute`.
- **Verify:** `npm test && npm run typecheck` and `FACE_SMOKE=1 npx tsx --test tests/telegram-smoke.test.ts`.
- **Commit message:** `feat(face): the mute - MUTE beside OFF, /mute from the phone, npm run desk -- unmute - and one append chain per ledger file`.

---

### Task 5: The watch's evaluator

**Files:**
- Create: `face/src/watch-eval.ts`, `face/tests/watch-eval.test.ts`

**Interfaces:**
- **Consumes:** Task 1 (`Market`, `marketOf` from symbols.ts; `MarketQuote`; `bjDate`, `bjClock` from et.ts); Task 3 (`Rule`, `resolveSymbols`, `levelDistancePct`); `Level`, `LevelKind`, `Holding`; `MarketSession`; `DeliverResult`; `etDate`.
- **Produces** (pure, but for the ids' randomness):
  - **Constants:** `ALERTS_PER_HOUR = 6`, `HOUR_MS = 3_600_000`, `GAP_RULE_WINDOW_MS = 1_800_000`.
  - **The quote the watch judges.**
    - `interface WatchQuote { market: Market; symbol: string; price: number | null; prevClose: number | null; changePct: number | null; asOf: string | null; receivedAt: string | null; feed: string; status: "live" | "delayed" | "stale" | "unavailable"; phase: "trading" | "midday" | "closed" | null }`.
    - `phase` is the Market's `cn.phase`, and `null` for a US quote. Only `live` and `delayed` prints are judged (ruling 2).
    - `watchQuoteOf(q: MarketQuote): WatchQuote`.
  - **Sessions:** `interface WatchSessions { us?: MarketSession; cn?: MarketSession & { uncovered?: true } }`.
  - **`judgedDate(q: WatchQuote, sessions: WatchSessions): string | undefined`** — the session date a print is judged in (ruling 2, the A-share close print included), else `undefined`.
  - **Keys:**
    - `KeyTrigger` and `FilingTrigger` as the old Task 4.
    - `PriceKey` gains `market: Market`.
    - `priceKeys(book: { levels; rules; holdings }): PriceKey[]`, with the old key strings.
  - **Readings:** `pastOf(k: PriceKey, q: WatchQuote): boolean | undefined`, as the old one.
  - **The day:**
    - `interface KeyDay { date: string; side?: boolean; lastHitAt?: number; lastAsOf?: string; alerted: boolean; repeats: number }`, where `date` is the session date it belongs to; a key judged on another date starts afresh. A print whose `asOf` is the key's `lastAsOf` is not judged again (ruling 2's once per `as_of`).
    - `interface WatchDay { keys: Map<string, KeyDay>; sends: number[]; pending: { id: string; t: number }[] }`, from `emptyDay()`.
  - **Evaluation:** `type Hit = { key: PriceKey; quote: WatchQuote; gap: boolean; date: string }`. `evaluatePass(day, keys, quotes: WatchQuote[], sessions, now): Hit[]`:
    - steps 2–5 of the old Task 4, on `judgedDate`;
    - a gap rule's window is measured from its market's session open, and it judges only its first judged print with a `prevClose` (ruling 1).
  - **The gate and the batch:** `gate(day, now, flags: { off: boolean; muted: boolean }, id): Gate`, `batchDue(day, now)` and `takeBatch(day)`, as the old Task 4.
  - **Records:**
    - `QuoteSnap = { market: Market; price; asOf; feed; status; prevClose; chgPct; receivedAt }`, from `snapOf(q)`.
    - `AlertHit`, `AlertDelivered`, `AlertBatch` and `AlertAnnotation` as the old Task 4. `AlertHit` gains `market`, and `QuoteSnap` replaces the old one.
    - `isAlertRecord(x)`.
  - **The rebuild:** `rebuildDay(records: unknown[], now: number): WatchDay` reads the `alert` records of the last 36 h.
    - A key's `KeyDay.date` is its newest record's `date`, with `alerted: true`; its older dates are ignored.
    - `lastHitAt` is its latest non-`cooldown` `t`.
    - `sends` are the `send` decisions within `HOUR_MS`.
    - `pending` holds the `cap` ids no `batch` lists.
  - **Ids:** `alertId()`, `passId()`, `batchId()`.
- **Dropped from the old Task 4:** `rankPriority`, `STREAM_SLOTS`, `RANK_MARGIN_PCT`, `WATCH_SYMBOLS_MAX`, `via` and the `source` word (M11): a quote names its `feed`.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/watch-eval.test.ts — US S: 2026-11-30 14:30Z-21:00Z; CN C: 2026-12-01 01:30Z-07:00Z; u(sym, price, asOf, prev?), c(code, price, asOf, phase, prev?)
test("a crossing between two judged prints fires, and only a crossing", () => { /* the old test, on u(...) */ });
test("past at the first judged observation fires once as gap - a level, a move rule - and a gap rule only within 30 minutes of its open", () => {
  // US as before; CN: 600519 below its stop at 01:31Z → gap; a gap rule's first print at 01:35Z (09:35 Beijing) fires; one first seen at 02:01Z (10:01) does not
});
test("a US print is judged on as_of inside its own session, not on the clock", () => { /* the old session test, incl. 2026-11-02 DST and the 2026-11-27 early close */ });
test("an A-share print is judged only inside 09:30-11:30 and 13:00-15:00 Beijing with the phase trading", () => {
  // 01:20Z (09:20 auction, phase trading) no; 01:30Z yes; 03:30Z (11:30) no; 03:45Z (11:45, phase midday) no; 03:45Z (11:45, phase trading) no;
  // 05:00Z (13:00) yes; 06:59:59Z yes; phase closed at 02:00Z no; an as_of on 2026-11-30 Beijing while C is 2026-12-01 no
});
test("an A-share print stamped 15:00:01 Beijing with phase closed is judged once; at 15:00:31 it is not", () => {
  // after c("600519", 1401, "2026-12-01T06:59:50Z", "trading") above a 1400 stop, c("600519", 1398.5, "2026-12-01T07:00:01Z", "closed") → judgedDate "2026-12-01", and the crossing hits; the same as_of on the next poll → no second judgement;
  // "2026-12-01T07:00:31Z" → undefined
});
test("a gap rule whose first judged prints have no previous close fires on the first with one inside 30 minutes, and not after", () => {
  // NVDA gap_pct 2: prints at 14:30:05Z and 14:40Z with prevClose null → no hit; 14:45Z with prevClose 174.05 and price 169.82 → gap;
  // the same rule whose first previous close arrives at 15:01Z → no hit
});
test("a stale or unavailable print is never judged, in either market", () => { /* status stale at 14:31Z inside S → no observation and no hit; the next live print is the first observation */ });
test("a key's day is its session's: a US gap and an A-share gap on one evening are both first observations", () => { /* … */ });
test("a repeat inside the cooldown is counted, not a hit; after it a crossing hits again", () => { /* … */ });
test("gate: OFF before MUTE before the cap, and the seventh send in a rolling hour is held for the batch", () => { /* … */ });
test("a burst of twelve gap hits sends six and holds six", () => { /* Review Focus 2 */ });
test("rebuildDay restores the day across both markets' session dates", () => { // Review Focus 1
  // a US gap sent 14:30:02Z on 2026-11-30 and an A-share gap sent 01:30:05Z on 2026-12-01 → both alerted for their dates; a third market-date record older than 36 h ignored;
  // one key with records on 2026-11-27 and 2026-11-30 → KeyDay.date "2026-11-30"
});
test("isAlertRecord accepts the four kinds and rejects a torn or kindless line", () => { /* … */ });
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/watch-eval.test.ts` FAIL, then implement, then PASS with `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** — `face/src/watch-eval.ts face/tests/watch-eval.test.ts`, message `feat(face): the watch's evaluator - crossings and gap judged per market session, cooldowns, the hourly cap and its batch, the day rebuilt from alerts.jsonl`.

---

### Task 6: Annotations through the conversation, the phone's desk state, and a turn's name

Unchanged from the old plan's Task 5: its Files, Interfaces, tests, `desk.md` edits and commit. One wording changes: `desk.md`'s `desk_state` sentence gains `, and the watch: its files, its symbols and today's alerts` — "its symbols" replaces "its streamed symbols".

- **Produces** (used below):
  - in `desk-session.ts`: `DeskSource`'s `{ kind: "alerts"; count }` and `{ kind: "state" }`; `DeskStateMessageSource`; turn naming by the first non-`desk` message;
  - in `desk-conversation.ts`: `post`'s `replyTo`; `setState(provider)`; `STATE_WAIT_MS = 3_500`; the per-source end lines (P3-15).
- **Verify:** `npm test && npm run typecheck` and `FACE_SMOKE=1 npx tsx --test tests/desk-smoke.test.ts tests/telegram-smoke.test.ts`. `cycle.test.ts` pins `desk.md` at ≤ 3,000 bytes and the three phrases.

---

### Task 7: The alert copy

**Files:**
- Create: `face/src/alert-text.ts`, `face/tests/alert-text.test.ts`

**Interfaces:**
- **Consumes:** Task 5 (`AlertHit`, `QuoteSnap`, the triggers); Task 6 (`DeskSource`); Task 1 (`bjStamp`, `Market`); `quoteTime`; `LoadRefusal`; `deskTime`, `etClock`.
- **Produces** (pure):
  - **`priceStamp(snap: QuoteSnap, now: number): string` (M4, M11).** The feed, upper-cased, then the exchange time; no process is named.
    - A US quote is `quoteTime(feed, asOf, now)`: `ROBINHOOD 10:21:03 ET`, `NASDAQ 10:21:03 ET` or `CBOE DELAYED 10:05:00 ET` (the feeds `feedOf` names); with no feed, the clock alone.
    - An A share is its feed upper-cased and `bjStamp(asOf, now)`: `TENCENT 14:03:12 Beijing`, or `TENCENT 2026-12-01 14:03:12 Beijing` when its Beijing date differs from now's.
  - **`alertText(hit, now, note: "follows" | "budget" | "none")`** keeps the old Task 6's line order and fields, with two changes:
    - line 1 is `<SYMBOL> <price> · <priceStamp>`;
    - line 5 is `day: <signed %, 2 dp> from the previous close <prevClose>`, or `day: no previous close yet`.
  - `batchText(hits, now)` and `BATCH_ITEMS_MAX = 20`, as the old Task 6.
  - `annotationPost(hits, pass, now): { text; source; message }`, as the old Task 6.
  - **The desk state:** `NearView` and `DeskStateView` as the old Task 6, each item gaining `market`; `stateBody(view)`.
  - **`WATCH_LINES`**, the rows of the Global Constraints table:
    - `fileRefused(file, error)`, `fileLoaded(file, loaded, refusals)`, `fileChanged(file, sha256, loaded)`;
    - `overCap(market, n, symbols)`, `noPrices(market, reason)`, `unpriced(symbol, reason)`, `cnPastTable(last)`, `noCalendar(error)`, `heldElsewhere(pid)`;
    - `filingsNoContact()`, `filingsRefused(error)`, `filingsOverCap(symbols)`.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/alert-text.test.ts — NOW = Date.parse("2026-11-30T15:21:04Z")
test("a US level alert carries the §5.9 fields, the plan verbatim, its feed and exchange time", () => {
  assert.equal(alertText(NVDA_STOP /* feed "robinhood", asOf 15:21:03.512Z, prevClose 174.05, held 100 @ 120.5 */, NOW, "follows"), [
    "NVDA 169.82 · ROBINHOOD 10:21:03 ET",
    "stop 170 cross_down · desk/levels.yml · THESIS.md §3",
    "held 100 @ 120.50 · day P&L -423.00",
    "plan: sell half on a close below 170",
    "day: -2.43% from the previous close 174.05",
    "annotation follows",
  ].join("\n"));
});
test("an A-share alert names its feed and Beijing time", () => {
  assert.equal(alertText(MOUTAI_WATCH /* 600519 1398.5, asOf 2026-12-01T06:03:12Z, feed "tencent", prev 1440.06, not held */, Date.parse("2026-12-01T06:03:20Z"), "none").split("\n")[0],
    "600519 1398.5 · TENCENT 14:03:12 Beijing");
});
test("a delayed US quote's stamp names its feed", () => { /* feed "cboe delayed" → "CBOE DELAYED 10:05:00 ET"; no stamp holds the word Account */ });
test("a move rule, a gap rule and a filing", () => { /* the old test's three expectations, line 1 stamps updated */ });
test("batchText lists at most twenty, then counts the rest", () => { /* the old test */ });
test("annotationPost: one alert keeps its rule's form, several become the alerts form", () => { /* … */ });
test("WATCH_LINES render the phone-line table exactly", () => {
  assert.equal(WATCH_LINES.cnPastTable("2026-12-31"), "the A-share calendar ends 2026-12-31; the watch judges A shares on the Market's phase alone until face/src/xshg-clock.ts is extended");
  assert.equal(WATCH_LINES.noPrices("cn", "busy"), "the watch has no A-share prices today: busy");
  assert.equal(WATCH_LINES.unpriced("699999", "no A-share quote for 699999"), "the watch has no price for 699999 this session: no A-share quote for 699999");
  // each other row; the 500-character cuts with "…"
});
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/alert-text.test.ts` FAIL, then implement, then PASS with `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** — `face/src/alert-text.ts face/tests/alert-text.test.ts`, message `feat(face): the alert copy - the plan verbatim, the feed with the exchange time, the holding, the day's move, the batch and the watch's lines`.

---

### Task 8: Filings — the EDGAR reader in Node and its decisions

**Files:**
- Create: `face/src/edgar.ts`, `face/tests/edgar.test.ts`, `face/src/filings.ts`, `face/tests/filings.test.ts`

**Interfaces:**
- **Consumes,** `edgar.ts`: `etDate` alone; its symbols arrive validated. `filings.ts`: `Rule`, `resolveSymbols` (Task 3); `Holding`, `Level` (desk-book.ts); `marketOf` (symbols.ts, Task 1); `etDate`; `MarketCalendar`'s `DayAnswer`.
- **Produces, `edgar.ts` (M2).**
  - **Constants:** `EDGAR_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"`; `EDGAR_SUBMISSIONS = (cik: number) => \`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json\``; `EDGAR_SPACING_MS = 200`; `EDGAR_RESPONSE_MAX = 16 * 1024 * 1024`; `EDGAR_REQUEST_TIMEOUT_MS = 20_000`.
  - **Types:**
    - `type EdgarFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>`.
    - `interface Filing { symbol; cik: number; accession; form; filingDate; accepted: string | null; items: string | null; primaryDocument: string | null; url }`.
  - **`createEdgar(deps: { fetch: EdgarFetch; userAgent: string; now?: () => number; sleep?: (ms: number) => Promise<void> })`** returns `{ recentFilings(symbols: string[], forms: readonly string[], since: string, opts: { stopAfterMs: number; signal: AbortSignal }): Promise<{ filings: Filing[]; errors: { symbol: string; error: string }[] }> }`.
    - **The ticker map** is read once per ET date and kept in memory. It maps `ticker` to `cik_str`; a symbol is looked up with `.` replaced by `-` (`BRK.B` → `BRK-B`, SEC's spelling).
    - **Headers:** every request sends `User-Agent: <userAgent>` and `Accept: application/json`.
    - **Pace:** requests are spaced `EDGAR_SPACING_MS` apart.
    - **Size:** a body over `EDGAR_RESPONSE_MAX` is that symbol's error, `response over 16 MiB`.
    - **Per-symbol errors:** a 401 or 403 is `refused: HTTP <code>`; any other non-2xx is `HTTP <code>`; a symbol not started within `stopAfterMs` is `deadline`; an unknown ticker is `[]`, not an error; anything else is the first line of the error, at most 200 characters.
    - **A failed ticker map** makes every symbol's error that map's error.
  - **The parse:** `parseSubmissions(symbol, cik, json, forms, since): Filing[]` (pure; a test seam) reads `filings.recent`'s parallel arrays, as the old Python reader specified:
    - `accepted` is the wall time read in America/New_York (`2026-11-30T10:05:12-05:00`), or `null`;
    - an empty `items` or `primaryDocument` is `null`;
    - `url` is `https://www.sec.gov/Archives/edgar/data/<cik>/<accession without dashes>/<primaryDocument>`, or `…/<accession>-index.htm` without one;
    - entries are kept in SEC's order.
  - **Isolation:** `edgar.ts` imports nothing but `et.ts`.
- **Produces, `filings.ts`:**
  - **Constants:** `FILINGS_POLL_MS = 300_000`; `FILINGS_STOP_AFTER_MS = 90_000`; `FILINGS_ABORT_MS = 120_000`; `FILINGS_LOOKBACK_DAYS = 7`; `FILINGS_WINDOW_MIN = [420, 1200]`; `FILINGS_SYMBOLS_MAX = 60`.
  - **Records:** `FilingRecord`, `isFilingRecord`, `baselineFrom(records)` and `diffFilings(base, result, symbols)`, as the old Task 7.
  - **Decisions:** `allRefused(result)`, `pollDue(now, lastPollAt, sessionToday)` and `inFilingWindow(accepted, sessionToday, now)`, as the old Task 7.
  - **Symbols:** `filingSymbols(rules: Rule[], book: { holdings: Holding[]; levels: Level[] }): { polled: string[]; overCap: string[]; aShares: number }`, holdings first.
- **Dropped:** `scripts/desk_filings.py`, `alpaca_kit/feeds/edgar.py`, `runFilingsPoll`'s script runner, the `watch:` pin, and `arm-watch` and `rearm-watch` (M2).

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/edgar.test.ts — a fake fetch over in-memory bodies; it records each URL and its headers; nothing reaches sec.gov
const FILINGS = { filings: { recent: { form: ["4", "8-K", "10-Q", "8-K/A", "S-3", "8-K"], filingDate: ["2026-11-30", "2026-11-30", "2026-11-27", "2026-11-25", "2026-11-24", "2026-11-10"],
  accessionNumber: ["0001-26-000009", "0001045810-26-000123", "x3", "x4", "x5", "x6"],
  acceptanceDateTime: ["2026-11-30T16:31:02.000Z", "2026-11-30T10:05:12.000Z", "2026-11-27T16:00:00.000Z", "2026-11-25T17:45:00.000Z", "", "2026-11-10T08:00:00.000Z"],
  items: ["", "2.02,9.01", "", "5.02", "", "7.01"], primaryDocument: ["xslF345X05/form4.xml", "nvda-20261130.htm", "q.htm", "", "s3.htm", "old.htm"] } } };
test("parseSubmissions keeps the forms since the date and reads acceptance in New York", () => {
  const got = parseSubmissions("NVDA", 1045810, FILINGS, ["8-K", "8-K/A", "4"], "2026-11-20");
  assert.deepEqual(got.map((f) => [f.form, f.accession]), [["4", "0001-26-000009"], ["8-K", "0001045810-26-000123"], ["8-K/A", "x4"]]);
  assert.equal(got[1].accepted, "2026-11-30T10:05:12-05:00"); assert.equal(got[0].items, null);
  assert.equal(got[1].url, "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000123/nvda-20261130.htm");
  assert.equal(got[2].url, "https://www.sec.gov/Archives/edgar/data/1045810/x4/x4-index.htm");
});
test("acceptance in summer is EDT and a missing one is null", () => { /* "2026-07-01T10:00:00.000Z" → "2026-07-01T10:00:00-04:00" */ });
test("recentFilings sends the contact header, reads the ticker map once a day, spaces requests and names each symbol's error", async () => {
  // User-Agent "ops@example.com" on every request; two calls on one ET date → one company_tickers fetch; sleep(200) between symbols;
  // a 403 → "refused: HTTP 403"; a fake clock past stopAfterMs → the rest "deadline"; an unknown ticker → no filing, no error;
  // BRK.B resolves through a map entry "BRK-B" → CIK0001067983's submissions URL
});
test("edgar.ts reaches nothing that can order", () => { /* its source names none of account-seat, orders, account-proxy, place_order */ });
// face/tests/filings.test.ts — the old Task 7's face tests, without runFilingsPoll:
test("the first poll of a symbol seeds silently; a later unseen accession is fresh; a failed symbol stays unseeded", () => { /* … */ });
test("allRefused names the error only when every symbol was refused", () => { /* … */ });
test("inFilingWindow and pollDue", () => { /* the old expectations */ });
test("filingSymbols polls US symbols only, holdings first, at most 60", () => { /* 600519 counted in aShares; 61 → overCap names the 61st */ });
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/edgar.test.ts tests/filings.test.ts` FAIL, then implement, then PASS with `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** — the four files, message `feat(face): filings for the desk - an EDGAR 8-K and Form 4 reader in Node with acceptance times, the contact header, a seeded per-symbol baseline`.

---

### Task 9: The watch row

**Files:**
- Create: `face/src/watch.ts`, `face/tests/watch.test.ts`
- Modify: `face/src/desk.ts` (`installDesk`, `DeskHandle`, `deskStatus`, `ALERT_DEADLINE_MS`), `face/src/main.ts` (passes `watchRow: {}`, the production defaults), `face/tests/desk.test.ts`, `face/tests/desk-weight.test.ts`

**Interfaces:**
- **Consumes:** Tasks 1–8; `DeskCalendars`, `deskCalendars` (Task 2, re-exported by schedule.ts), `XSHG_COVERED` (Task 2), `bjDate` (Task 1); `readRecords`, `readBudget`, `readOffState`; P0's lock (`withFileLock`, `@deepseek-ai/dsh-atomic-write`); `listChannelDirs` (channels.ts); `desk-fakes.ts` (`WallClock`, `fakeCalendar` with its `dateOf`).
- **Produces, `watch.ts`:**
  - **Constants:** `WATCH_TICK_MS = 5_000`, `WATCH_US_POLL_MS = 20_000`, `WATCH_CN_POLL_MS = 10_000`, `WATCH_US_MAX = 40`, `WATCH_CN_MAX = 60`, `WATCH_LEAD_MS = 600_000`, `WATCH_TAIL_MS = 60_000`, `LEASE_BEAT_MS = 30_000`, `LEASE_STALE_MS = 120_000`, `NEAR_MAX = 10`, `MARKS_MAX = 100`, `STATE_QUOTES_TIMEOUT_MS = 3_000`, `UNPRICED_POLLS = 3`.
  - **`interface WatchDeps`:**
    - `home`, `root`;
    - `quotes?: MarketQuoteSource` (Task 1), the one source for both markets;
    - `calendars: DeskCalendars`, `clock: DeskClock`;
    - `deliver: (text: string, opts?: { replyTo?: number }) => Promise<DeliverResult>`, `post: DeskConversation["post"]`, `budget: () => Promise<BudgetState>`;
    - `edgar?: { fetch: EdgarFetch; userAgent: string }`;
    - `pid?: number`, `alive?: (pid: number) => boolean`, `tickMs?: number`, `log?`.
  - **The handle:** `interface WatchHandle { tick(): Promise<void>; status(): WatchStatus; stateText(): Promise<string | undefined>; dispose(): Promise<void> }`, from `installWatch(deps)`.
  - **`WatchStatus`:**
    - `state: "starting" | "idle" | "held-elsewhere" | "watching" | "stopped"`;
    - `markets: Record<Market, { state: "off" | "no-calendar" | "closed" | "waiting" | "polling" | "after-close"; session?: { date; open; close }; watched: number; notWatched: string[]; lastPollAt?: string; lastError?: string; uncovered?: true; today: { sent: number; suppressed: Record<"cooldown" | "cap" | "muted" | "off" | "window", number>; repeats: number } }>` — `off` means the source is `unavailable`, or the market has no symbol; `today` counts that market's records on its own session date (ruling 2), the filings in `us`;
    - `holder?: { pid: number; since: string }`; `muted?: MuteState`; `files: WatchFileStatus[]`;
    - `near: NearView[]`; `marks: { market; symbol; kind: LevelKind; level: string; when; plan: string; file: string; distancePct: number | null }[]` (at most `MARKS_MAX`, nearest first);
    - `pending: number`, the cap's held alerts across both markets;
    - `recent: AlertSummary[]`, newest first, at most 10, where `AlertSummary` is the old one with `via` replaced by `feed: string | null`, with `market`, and with `latencyMs: number | null` (`null` when the send was queued);
    - `filings: { state: "off" | "no-contact" | "polling" | "refused-today"; symbols: number; aShares: number; seeded: number; lastPollAt?: string; lastError?: string }`;
    - `ledgerError?: string`.
  - **The lease, the boot and the passes:** as the old Task 8, with these changes.
    - **The lease (ruling 7).** Taking a stale lease is a check-and-write under P0's lock on `watch.lease`, then a re-read after the write; a face whose pid the re-read does not name is `held-elsewhere`.
    - **Each tick:**
      1. the lease, beating every `LEASE_BEAT_MS`;
      2. the ET-date line memories;
      3. the files (ruling 8);
      4. nothing to watch sets `idle` and stops there;
      5. per market with a source: its calendar's `today(now)` — a failed cn answer while `bjDate(now) > XSHG_COVERED.through` is past the table, never `no-calendar` — its window (ruling 2), and a poll when due by its cadence (ruling 3) — never two in flight per market;
      6. a due batch;
      7. an expired mute lifted;
      8. filings (ruling 9): with a filing rule and no `edgar`, `no-contact` and its line; else `pollDue` starts one single-flight poll under an `AbortController` cut at `FILINGS_ABORT_MS`.
    - **A pass** is one market's poll — `quotes.snapshot` over that market's ids alone — or one filings poll. It maps the payload through `watchQuoteOf`, then runs `evaluatePass` with that market's session. Sends go before posts, as before; a queued send as ruling 16 says.
    - **A failed poll and a symbol never priced:** ruling 16, the reason also that market's `lastError`. Nothing is judged. A source with `unavailable` set is `off` for both markets.
    - **A shares past the table:** the cn session is synthesised (09:30–15:00 Beijing on a weekday), with `uncovered: true` and `cnPastTable` once per Beijing date.
    - **`stateText()`:** at most one snapshot per market, each raced at 3,000 ms.
    - **`dispose()`:** it stops the ticks, aborts a filings poll, waits at most 2,000 ms for passes, posts and chains, and releases the lease.
- **Produces, `desk.ts`:**
  - `ALERT_DEADLINE_MS = 90_000`.
  - `installDesk` gains:
    - `alertDeadlineMs?`, which `deadlineFor("alert")` and `deadlineFor("alerts")` answer;
    - `schedule.calendars?: Partial<DeskCalendars>`, beside P2's `schedule.calendar`;
    - `watchRow?: { clock?: DeskClock; tickMs?: number; calendars?: Partial<DeskCalendars>; edgar?: { fetch: EdgarFetch; userAgent: string } | null; alive? }`. A `null` `edgar` means none; an absent one means production, which is `globalThis.fetch` with `process.env.ALPHA_EDGAR_USER_AGENT` when that is set.
  - **One `DeskCalendars`** (ruling 13) is built inside the schedule's lazily imported chain, from `import("./schedule.ts")`'s re-export, with no other lazy import. `createDeskSchedule` gets its `us` as `seams.calendar`, and the watch gets the whole.
  - **The watch starts** only when `watchRow` is given (main.ts passes `{}`; no existing test or smoke does), with the conversation, the schedule's wiring and a `quotes` source whose `unavailable` is unset. It starts in the same chain, after `bridging` settles and the schedule is created, whether or not a bridge runs: `import("./watch.ts")`, then `installWatch`. Then `conversation.setState(() => watch.stateText())`. So no smoke booted in the primary checkout can poll the operator's real book.
  - `DeskHandle.watchRow?: Promise<WatchHandle | undefined>`.
  - `deskStatus`'s deps gain `watch?: () => WatchStatus | undefined`, and `DeskStatus` gains `watch?`.
  - `dispose` runs schedule → watch → bridge → conversation.
- **Checked green and unchanged:** every existing caller of `installDesk` (`desk.test.ts`, `desk-tools.test.ts`, `desk-smoke`, `smoke`, `telegram-smoke`, `schedule-smoke`, `schedule.test.ts`, `firing.test.ts`). None passes `watchRow`, so none starts a watch.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/watch.test.ts — one fake MarketQuoteSource over two tables, one per market, recording each snapshot's ids and answering from the table the test edits;
// wall = new WallClock("2026-11-30T14:25:00Z"); calendars { us: fakeCalendar({ "2026-11-30": 14:30Z-21:00Z }),
//   cn: fakeCalendar({ "2026-11-30": 2026-11-30 01:30Z-07:00Z, "2026-12-01": 01:30Z-07:00Z }, "fake XSHG", (n) => bjDate(new Date(n))) };
// deliver records { text, opts } and resolves { sent: [100 + n++] }; post resolves { opened: true, sessionId: "s" }; fixtures under face/tests/tmp/watch-<pid>/
test("a US crossing is recorded, sent with its feed's stamp and the plan, and one annotation post replies to it", async () => {
  // NVDA 171 then 169.82 at 15:21:03Z on two polls 20 s apart → one AlertHit, deliver opening "NVDA 169.82 · ROBINHOOD 10:21:03 ET"
  // and ending "annotation follows"; a delivered record whose tradeMs is the fake gap; post({ source: { kind: "alert", symbol: "NVDA", rule: "stop" }, replyTo: 100 })
});
test("an A-share crossing is sent with the TENCENT stamp; the US poll is not asked outside its window", async () => {
  // wall 2026-12-01T01:25:00Z: cn polled at once (its window opened 01:20Z) and every 10 s, us not at all (its 2026-11-30 session closed); 600519 1401 then 1398.5 at 02:03:12Z → "600519 1398.5 · TENCENT 10:03:12 Beijing";
  // each cn poll is one snapshot over the cn ids alone (the twelve-pair split is Task 1's, tested there)
});
test("each market polls at its cadence, never two in flight, and only inside its window", async () => {
  // wall 2026-11-30T14:19:00Z: no us poll at 14:19Z, the first at 14:20Z, then +20 s; a poll that hangs 30 s → no second us poll until it settles; 21:01Z → us stops;
  // wall 2026-12-01T01:19:00Z: the first cn poll at 01:20Z, then +10 s
});
test("a closed XSHG day polls no A share; past the table the watch says so once and judges on the Market's phase", async () => {
  // past the table: wall 2027-01-04T01:25:00Z with deskCalendars' own cn calendar (its answer ok: false) → markets.cn.state "polling", uncovered true, never "no-calendar"; cnPastTable once
});
test("the Market's read busy or unreachable sends one line per session date per market and judges nothing", async () => {
  // snapshot rejects HttpError(429) → markets.us.lastError "busy", "the watch has no US prices today: busy" once, and the cn poll's own line once for the
  // 2026-12-01 session though its polls span New York's midnight (20:20–02:01 ET); unavailable set → both markets "off", no poll
});
test("a poll whose every A-share quote is refused sends noPrices once", async () => {
  // every cn quote unavailable "the Market read refused: the account layer is not mounted" on three polls → markets.cn.lastError that, one "the watch has no A-share prices today: …"
});
test("a watched symbol unpriced on every poll of a session sends one line per (symbol, reason) per session date", async () => {
  // "699999" unavailable "no A-share quote for 699999" while 600519 prices: no line after two polls, one after the third, none after the fourth; the next session date one again
});
test("an alert sent while the outlet queues records latency null and posts its annotation without replyTo", async () => {
  // deliver resolves { queued: true } → the delivered record's latency { tradeMs: null, receivedMs: null }; status().recent[0].latencyMs null; post called with no replyTo
});
test("a symbol cap per market: past 40 US symbols the rest are named once", async () => { /* … */ });
test("a 09:30 burst records twelve, sends six, posts one annotation and batches six at 10:00", async () => { /* Review Focus 2 */ });
test("an annotation post that hangs 5 s does not delay the next pass's alert", async () => { /* … */ });
test("a restart over the same ledger fires no second gap and keeps the cooldown and the hour's count", async () => { /* Review Focus 1 */ });
test("a stale lease is taken over: its pid gone, EPERM, or its beat two minutes old", async () => { /* … */ });
test("a second watch on the same home stays off while the first face beats, and says so once", async () => { /* … */ });
test("two watches started together over a stale lease: one holds it, the other says held-elsewhere once", async () => {
  // a lease naming a dead pid; installWatch twice at once (pids 11 and 12) → exactly one status().state "watching", the other "held-elsewhere" and heldElsewhere once
});
test("levels.yml edited while the face runs is reloaded on the next tick; a broken edit keeps the last good load with one line", async () => {
  // `desk/levels.yml changed (sha256 ${sha.slice(0, 8)}): 4 loaded`; strategies/demo/levels.yml written → its own changed line
});
test("nothing to watch: no calendar ask, no poll, no line", async () => { /* … */ });
test("OFF and MUTE record suppressed and send nothing; the tick lifts a mute at its end", async () => { /* … */ });
test("a spent budget: the alert says so and is sent, and nothing is posted; a pass with no hit reads no budget", async () => { /* … */ });
test("a refused annotation post sends its line once a day as a reply", async () => { /* … */ });
test("filings: no contact says so once; seeded silently; a new 8-K today alerts; one at 06:30 is suppressed window; all refused off until tomorrow", async () => {
  // the fake EdgarFetch never touches the network; an A share in holdings is counted, never fetched
});
test("an unreadable alerts.jsonl judges nothing and says why once", async () => { /* … */ });
test("stateText lists both markets' holdings, the levels within 2% and today's counts; a source slower than 3 s gives the counts without its prices", async () => { /* … */ });
test("status carries marks nearest first, at most 100, for the Markets rows", async () => { /* … */ });
// face/tests/desk.test.ts (append)
test("installDesk starts the watch with a source, shares the US calendar with the schedule, and disposes schedule, watch, bridge, conversation in order", async () => {
  // no watchRow given → no watch; watchRow with unwiredMarketQuotes() → none; a fake quotes with watchRow → (await desk.watchRow)!.status().state; GET /data/desk/status → body.watch; alertDeadlineMs honoured;
  // no telegram config → the watch still starts once bridging settles; schedule.calendars' cn reaches the watch, and the schedule and the watch share one us calendar
});
// face/tests/desk-weight.test.ts: the list gains src/watch.ts, src/watch-eval.ts, src/alert-text.ts, src/edgar.ts, src/filings.ts
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/watch.test.ts tests/desk.test.ts tests/desk-weight.test.ts` FAIL, then implement, then PASS with `npm test && npm run typecheck` and `FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts tests/desk-smoke.test.ts tests/telegram-smoke.test.ts tests/schedule-smoke.test.ts`, the checked files unchanged.
- [ ] **Step 5: Commit** — the five files plus `face/src/main.ts`, message `feat(face): the watch row - levels, rules and filings on polled prices in both markets, alerts sent before annotations, caps, mute, a beating lease per home`.

---

### Task 10: The watch in the brief, the status lines and `desk_state`

**Files:**
- Modify: `face/src/brief.ts`, `face/src/schedule.ts` (`createDeskSchedule` passes `home` to `briefProducer`), `desk/STANDING.md`, `face/src/desk.ts` (`deskStatusLines`), `face/src/desk-tools.ts` (`STATE_SCHEMA`)
- Test: `face/tests/brief.test.ts`, `face/tests/desk.test.ts`, `face/tests/service.test.ts`, `face/tests/desk-tools.test.ts`

**Interfaces:**
- **Consumes:** Task 5 (`isAlertRecord`); Task 7 (`priceStamp`); Task 8 (`isFilingRecord`); Task 9 (`WatchStatus` with `markets[m].today` and `pending`, `DeskStatus.watch`); `FIRINGS_FILE`, `isFiringRecord`.
- **Produces, `brief.ts`:** the old Task 9's `home?`, `briefSince`, the `alerts` and `filings` blocks and `BriefAlert` (with `stamp` from `priceStamp` and `market`) and `BriefFiling`, placed after the levels errors and before `scope`, newest first. A-share alerts are listed too: the brief's prices stay US, its alerts are the day's.
- **Produces, `desk/STANDING.md`:** the old Task 9's item 4 and closing rule, verbatim.
- **Produces, `desk.ts`:** `watchLines(w: WatchStatus, now: Date): string[]`, appended by `deskStatusLines` after P2's lines:
  - `watch: <starting | nothing to watch | stopped | another face (pid <n>) holds the watch on this home | watching>`;
  - per market with a source: `watch <US | A shares>: <no calendar today | closed today | the <date> session opens at <HH:MM ET> | polling the <date> session, <n> symbols, last poll <HH:MM ET> | the <date> session has closed>[; not watched: <k>][; <lastError>]`;
  - per market with a record today: `alerts today (<US | A shares>): <n> sent[, <k> suppressed (<reason> <k>, …)][, <r> repeats in a cooldown]`, counted on that market's session date;
  - `alerts: <k> held for the next hour's batch` when `pending` is above 0, and `alerts: muted until …`, as the old Task 9;
  - `filings: <off | off: set ALPHA_EDGAR_USER_AGENT | polling, <n> symbols, last poll <HH:MM ET>[, <k> errors] | off until tomorrow: SEC refused the requests>`;
  - `watch files refused: …`, as the old Task 9.
- **Produces, `desk-tools.ts`:** `STATE_SCHEMA` gains `watch: { type: "object" }`, and `desk_state`'s value carries `watch` without `marks` (old ruling 15: the ten nearest levels are `near`, the last ten alerts `recent`); the Desk view reads `marks` from the route.

- [ ] **Step 1: Write the failing tests** — the old Task 9's `brief.test.ts`, `desk.test.ts`, `service.test.ts` and `desk-tools.test.ts` cases, with these expected lines in `watchLines`:

```ts
// → ["watch: watching", "watch US: polling the 2026-11-30 session, 12 symbols, last poll 10:21 ET",
//    "watch A shares: the 2026-12-01 session opens at 20:30 ET", "alerts today (US): 5 sent, 3 suppressed (cap 2, muted 1), 4 repeats in a cooldown",
//    "alerts today (A shares): 1 sent", "alerts: 2 held for the next hour's batch", "alerts: muted until 12:00 ET (npm run desk -- unmute)",
//    "filings: off: set ALPHA_EDGAR_USER_AGENT", "watch files refused: desk/levels.yml 2 of 9"]
// desk-tools.test.ts: desk_state over a status whose watch has 3 marks → the value's watch has no marks key, and keeps near and recent
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/brief.test.ts tests/desk.test.ts tests/service.test.ts tests/desk-tools.test.ts` FAIL, then implement, then PASS with `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** — the files above, message `feat(face): the watch made visible on the server - alerts and filings in the brief, the status lines, desk_state's watch block`.

---

### Task 11: The Markets screen's Desk view and level marks (M1)

**Files:**
- Create: `face/client/js/host/desk-view.js`, `face/client/js/host/desk.js`, `face/client/js/reducers/desk.js`, `face/client/js/render/desk.js`, `face/tests/client/desk-view.test.js`, `face/tests/client/host-desk.test.js`
- Modify: `face/client/js/host/market-view.js` (`tabsOf`), `face/client/js/reducers/markets.js` (`TABS`), `face/client/js/reducers/index.js`, `face/client/js/render/markets.js` (the tab, the row mark, the page's plan), `face/client/js/app.js` (starts `startDesk` beside `startMarkets`, and `showMarkets` shows both), `face/client/css/app.css`, `face/tests/client/markets.test.js`, `face/tests/client/market-view.test.js`

**Interfaces:**
- **Consumes:** `GET /data/desk/status` (`DeskStatus`: its `runs` and `asleep`, Task 9's `watch`, P2's `standing` with its `recent`); `POST /data/desk/pause` (`{ until? }` → `{ off }`); the Markets store's `markets.tab`; row ids `stock:<SYM>` and `cn:<6>`.
- **Produces, `host/desk-view.js`** (pure):
  - `DESK_TAB = 'desk'`; `DESK_POLL_MS = 10_000`.
  - `deskViewOf(status, nowIso) → { head; off?; telegram; budget; markets: { name; line; today }[]; pending; filings; alerts: { when; what; outcome; latency }[]; levels: { market; symbol; label; plan; file }[]; standing: { id; anchor; next; hash; last }[]; firings: { order; when; kind; outcome }[]; runs: { bootedAt; pid; lost }[]; asleep: { from; to; gap }[]; files: { file; note }[] }` (ruling 15). Its texts are Task 10's `watchLines` phrases and P2's `standingLines` phrases, re-spelt here, never sent from the server as prose. Each market's `today` is its own session date's counts. `levels` are `watch.marks`; `firings` are `standing.recent`; `runs` are the last ten. `when` is New York `HH:MM`, dated on another day; `latency` is `1.8 s` or `—` (a queued send).
  - `markOf(status, rowId) → { label: string; plan: string; file: string } | null` — `stop 170 · -1.30%` (2 dp) from `status.watch.marks`, matching `stock:NVDA` to US NVDA and `cn:600519` to the A share; `null` without one.
- **Produces, `host/desk.js`:** `startDesk({ store, getJson, postJson, schedule, cancelTimer, now })` returns `{ show(on), pause(), dispose() }`. Once `show(true)` — Markets on screen, any tab or a market's page, as `startMarkets`'s own `show` — it reads the status at once, then every `DESK_POLL_MS` while Markets shows, and stops on `show(false)`; so the marks on the rows stay fresh (review B6). `pause()` posts `{}` and then reads again. Nothing touches the DOM.
- **Produces, `reducers/desk.js`:** `deskLoading`, `deskLoaded({ data, at })`, `deskFailed({ at, message })` and `pauseAnswered({ off })`, all on `s.desk`.
- **Produces, `render/desk.js`:** `renderDeskTab(view)` — string HTML in the app's render style, with one **Pause** button and no Resume, since the phone and the page only pause (spec §5.7).
- **Produces, Markets:** `tabsOf` lists **Desk** last. A row whose `markOf` is non-null shows a small mark after its name, and a market's page shows the mark's plan and file under its price.

- [ ] **Step 1: Write the failing tests**

```js
// face/tests/client/desk-view.test.js
test('deskViewOf renders the head, both markets with their own today, the alerts with their latency, the levels, standing orders, firings, runs, sleep gaps and the refused files in ET', () => { /* a fixture DeskStatus; a queued alert's latency is — */ });
test('markOf matches stock:NVDA and cn:600519 to their marks and nothing else', () => {
  assert.deepEqual(markOf(STATUS, 'stock:NVDA'), { label: 'stop 170 · -1.30%', plan: 'sell half on a close below 170', file: 'desk/levels.yml' });
  assert.equal(markOf(STATUS, 'coin:BTC'), null); assert.equal(markOf({ ok: true }, 'stock:NVDA'), null);
});
// face/tests/client/host-desk.test.js
test('the desk status is read at once and every 10 s while Markets shows, and stops when it leaves', () => { /* fake schedule: show(true) on the Stocks tab reads at once; +10 s again; show(false) stops; a market page counts as shown */ });
test('Pause posts once and reads the status again; a failed read keeps the last view with its message', () => { /* … */ });
// face/tests/client/markets.test.js (append): the Desk tab is listed last; a marked row draws its mark; a page draws the plan
```

- [ ] **Step 2: Run them to verify they fail** — `cd face && npx tsx --test tests/client/desk-view.test.js tests/client/host-desk.test.js tests/client/markets.test.js tests/client/market-view.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the four modules, the tab, the marks and the CSS.
- [ ] **Step 4: Verify.** First `npm test && npm run typecheck`. Then the browser check:
  - **The face.** A scratch face from the worktree: `FACE_PORT=3191`, a scratch `DSH_HOME` under `face/tests/tmp/`, `FACE_ACCOUNT_URL=http://127.0.0.1:9`, no Telegram names, no `ALPHA_EDGAR_USER_AGENT`, never `~/.dsh`.
  - **The seed.** In the scratch home: an `alerts.jsonl` dated within 36 h of the wall clock, so `rebuildDay` lists it (one US alert sent, one A-share alert sent, one capped, one muted), and a `MUTE`. In the worktree, `desk/levels.yml` (gitignored) with a US level, an A-share level and one refusal, removed after the check. `FACE_ACCOUNT_URL=http://127.0.0.1:9` makes every read fail at once, so nothing leaves the host. The watch starts with no Telegram, once `bridging` settles.
  - **The check.** Open the printed URL and hard-reload. Markets › Desk shows the head, both markets' lines with their own today, `filings: off: set ALPHA_EDGAR_USER_AGENT`, the alerts, the levels and the refused file. The browser's network log shows `/data/desk/status` read every 10 s on the Stocks tab, opened without visiting Desk. With no Market read the screen has no rows, so the row and page marks are `markets.test.js`'s alone. Take a screenshot.
- [ ] **Step 5: Commit** — the files above, message `feat(face): the Desk view inside Markets - status, standing orders, the watch, today's alerts, a level's mark on its row and page`.

---

### Task 12: `watch-smoke` and the canary's annotation half

**Files:**
- Create: `face/tests/watch-smoke.test.ts`

**Interfaces:**
- **Consumes:** everything above; `setupFaceProfile`, `bootFace`, `StubAdapter` (with `desk-smoke`'s usage set), `populateBotsRoot`, `GRAVIT_PLUGIN_ABS`, `installModelSelection`, `desk-fakes.ts`.
- **The scaffold:** the old Task 10's, with these changes.
  - **Sources.** One fake `MarketQuoteSource` over two in-memory tables, one per market, as `installDesk`'s `quotes`.
  - **Books.** `holdings.yml` adds `600519`, and `levels.yml` adds a `600519` stop.
  - **Calendars.** `{ us: fakeCalendar({ "2026-11-30": 14:30Z-21:00Z, "2026-12-01": 14:30Z-21:00Z }), cn: fakeCalendar({ "2026-11-30": 01:30Z-07:00Z, "2026-12-01": 01:30Z-07:00Z }, "fake XSHG", (n) => bjDate(new Date(n))) }`.
  - **Filings.** `watchRow: { calendars, clock: wall, tickMs: 86_400_000, edgar: { fetch: fakeEdgar, userAgent: "smoke@example.invalid" } }`. The fake `EdgarFetch` serves a ticker map and one submissions body; nothing reaches the network.
- [ ] **Step 1: Write the smoke** — one boot, these cases in this order:
  1. **Before the open.** A 14:15Z tick polls no US symbol, because the window opens at 14:20Z (the open minus 10 minutes). A 14:21Z tick polls, and an NVDA print timed 14:29:59Z makes no record.
  2. **A US gap.** NVDA 168.50 at 14:30:01Z gives one `alert` (`gap`) and one `delivered`. The message opens `NVDA 168.5 · ROBINHOOD 09:30:01 ET` and ends `annotation follows`. The stub sees `[alert · NVDA · stop]` and answers as a reply.
  3. **A restart.** Re-install the watch: NVDA 168.40 makes no record.
  4. **The cooldown.** NVDA 171, then 169.5 inside 30 minutes, makes no record; `repeats` is 1.
  5. **The cap and the batch.** Six sends; the seventh is recorded `suppressed: cap`; at 15:00:05Z the batch line goes.
  6. **An A share.** `wall.set("2026-12-01T01:29:00Z")`; 600519 below its stop at 01:30:02Z (09:30:02 Beijing, phase `trading`) gives a `gap` alert opening `600519 … · TENCENT 09:30:02 Beijing`. A print at 03:45Z (lunch, phase `midday`) makes none.
  7. **A cut and a failed model call:** the old case 7.
  8. **The phone's state:** the old case 8; the state names both NVDA and 600519.
  9. **A filing.** `wall.set("2026-12-01T12:00:00Z")` (07:00 ET): the first due poll seeds silently. The fake then adds an 8-K accepted 07:02:12 ET, and the 07:05 ET poll sends `NVDA 8-K · accepted 07:02:12 ET · …`. `600519` is never fetched.
  10. **The canary's annotation half:** the old case 10, unchanged.
- [ ] **Step 2: Run it** — `cd face && FACE_SMOKE=1 npx tsx --test tests/watch-smoke.test.ts`. Expected: PASS. A failure is fixed in the task that owns the behaviour.
- [ ] **Step 3: Run the whole suite with the real boots** — `FACE_SMOKE=1 npm test`. Expected: every file green, one real boot more than before.
- [ ] **Step 4: Commit** — `face/tests/watch-smoke.test.ts`, message `test(face): watch-smoke - a US and an A-share gap, restart, cooldown, cap and batch, a cut and a failed annotation, the phone's state, a filing, the canary's annotation half`.

---

### Task 13: The documents and the charter

**Files:**
- Modify: `Gravit-Design.md`, `DEVELOPMENT.md`, `face/README.md`, `CLAUDE.md`, `ROADMAP.md`, `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md`. Not `Gravit-Docs-and-Prompt-Loops.html` (P4-7).

- [ ] **Step 1: `Gravit-Design.md`.**
  - **§3:** the watch row; both markets read from the Market part through the proxy, as the Markets screen reads them (M11's words).
  - **§4, the write map:**
    - `watch.ts` writes `alerts.jsonl`, `filings.jsonl`, `watch.lease` and its events;
    - `telegram.ts` writes `MUTE`;
    - the operator writes `rules.yml`.
  - **D17 and D18:** `/mute` from the phone, with what holds it (a required duration, never shortened from the phone, no phone unmute).
  - **D23:** rewritten for both markets in M11's words: the desk's prices are the Market's reads through the proxy (`market-quotes.ts`), US by `explore` every 20 s, A shares by `quotes` every 10 s, the watch and `desk_quotes` among the readers; no sentence calls a price's source the Account.
  - **New row D28**, in the D20 role of the old plan:

    | D28 | A strategy's `levels.yml` sits in a directory its research sessions can write, and the watch sends its plans verbatim | the load caps, the alert caps, and the watch's `changed (sha256 <8 hex>)` line for every levels file it re-reads | the first levels change the operator did not make; P4 pins each strategy's `levels.yml` for that strategy's own firings |

  - **D26:** it names `edgar.ts` among the face code it covers (M2).
- [ ] **Step 2: `DEVELOPMENT.md`.**
  - **The module table:** `symbols.ts`, `market-quotes.ts` (for `us-quotes.ts`), `watch.ts`, `watch-eval.ts`, `alert-text.ts`, `edgar.ts`, `filings.ts` and `xshg-clock.ts`, and the changed rows for `et.ts`, `desk-book.ts`, `desk-tools.ts`, `brief.ts`, `market-clock.ts`, `account-proxy.ts` and `main.ts`.
  - **The desk files:** `alerts.jsonl`, `filings.jsonl`, `MUTE` and `watch.lease`.
  - **The env table:** `ALPHA_EDGAR_USER_AGENT`, now read by `watch.ts`.
  - **§5:** the Desk view in Markets.
  - **§7:** `watch-smoke`, fresh counts and the drill's P3 row.
  - **§10:** the desk item.
  - **§9 residuals, from R68:**
    - the US latency floor, the 20 s explore cache plus the reads;
    - a delayed US feed's alert lags its print;
    - `prev_close` is `price − change24h`, the Market read's own;
    - US `move_pct` and `gap` rules are blind until a previous close arrives, about 09:45 New York for a Robinhood-priced row (Cboe's first trade);
    - an A-share close print stamped after 15:00:30 Beijing is not judged;
    - first-observation semantics after a restart;
    - repeat counts are lost on a restart;
    - a mid-day `alerts.jsonl` rotation can fire a `gap` twice;
    - the SEC `Z` reading;
    - each filings poll downloads whole submissions JSON;
    - Telegram's flood limit can unthread a burst;
    - an annotation queued behind a long phone turn arrives late;
    - two desk-enabled faces with one token;
    - the XSHG table ends 2026-12-31, and extending it is a code edit;
    - A-share session edges rest on the Market's `cn.phase` plus the Beijing clock;
    - an A-share poll is up to five `quotes` reads of twelve pairs, each one Tencent read at the Account;
    - the watch's lines under OFF are not retried (alerts are in the ledger).
- [ ] **Step 3: `face/README.md`.**
  - **"The desk" gains "The watch":**
    - `rules.yml` and the alert format;
    - `/mute` and `unmute`;
    - `ALPHA_EDGAR_USER_AGENT` set in the home's `.env`;
    - both markets' cadences and caps;
    - one watch per home;
    - the Desk view in Markets.
  - **"The desk drill" gains its P3 half:**
    1. A level a few cents from a liquid US share's price: the alert arrives within 30 s with its plan; read `latencyMs` in Markets › Desk.
    2. The same for an A share during Beijing hours: within 20 s.
    3. The annotation arrives within 90 s, as a reply.
    4. Send `/mute 30m`: a crossing is recorded muted. Then run `npm run desk -- unmute`.
    5. Run `npm run desk -- rearm preclose`.
    6. Set `ALPHA_EDGAR_USER_AGENT` and restart. Compare one filing's accepted time with its EDGAR index page (ruling 9), and record one poll's wall time and bytes.
- [ ] **Step 4: `CLAUDE.md`.** The desk row names `market-quotes.ts` in place of `us-quotes.ts`, `face/src/{watch,watch-eval,alert-text,edgar,filings,xshg-clock}.ts`, `desk/rules.yml` and the Desk view, and says the desk's prices are the Market's reads. The tests row's real-boot count follows a fresh `FACE_SMOKE=1 npm test`.
- [ ] **Step 5: `ROADMAP.md` and the spec.** ROADMAP: P0–P3 built, P4 to come, and the P3 entry. Under the spec's §5.5, an "As built (P3)" note pointing at §15 and naming:
  - the polled cadences;
  - the per-market judgement;
  - `move_pct` from the previous close;
  - `kind:` and `symbols:`;
  - halts refused;
  - one annotation per pass;
  - `/mute`;
  - filings in Node.

  Spec §15 M5 is amended in place: past the XSHG table the watch judges A shares on the Market's phase alone, with one line a Beijing date, while P4's anchors still refuse a date past it.
- [ ] **Step 6: Verify and commit** — `cd face && npm test && npm run typecheck`, then `FACE_SMOKE=1 npm test`; every count in the documents matches the run. Commit the six documents with `docs: the desk P3 - the watch in both markets, rules.yml, alerts, annotations, mute, filings in Node, the Desk view in Markets; charter D28`.

---

## Pre-flight conflict scan

### A. Task pairs that share a file or an interface

| Pair | Shared | Note |
|---|---|---|
| T1→T3, T5, T8, T9 | `Market`, `marketOf`, `idOf` (symbols.ts), `Level.market`, `Holding.market` | the loaders set `market`; nothing else marks it (M3) |
| T1→T2, T5, T7, T9 | `bjDate`, `bjClock`, `bjStamp` (et.ts) | T2 no longer touches `desk-tools.ts` |
| T1/T3/T10 | `brief.ts` | T1 `aShares` and `scope`, T3 the import of `levelDistancePct`, T10 the blocks — sequential and disjoint |
| T1/T9 | `desk.ts` `installDesk`, `main.ts` | T1 renames `hub` to `quotes`, one source for the tools, the brief and the schedule; T9 `watchRow`, `schedule.calendars` and the same `quotes` to the watch — sequential |
| T2→T9, T12 | `DeskCalendars`, `deskCalendars` (re-exported by schedule.ts), `XSHG_COVERED`, `fakeCalendar`'s `dateOf` | the watch's cn window; every cn fake passes `bjDate` |
| T3→T5, T8, T9 | `Rule`, `resolveSymbols`, `levelDistancePct`, `loadRules` | |
| T4→T9 | `appendChain`, the file names, the mute, `watch-load` | |
| T4/T9/T10 | `desk.ts` | sequential, disjoint regions |
| T5→T7, T9, T10 | `WatchQuote`, `AlertHit` (with `market`), `QuoteSnap` (`market`, `feed`, `status`), the evaluator, `rebuildDay` | |
| T6→T7, T9, T12 | the `DeskSource` forms, `post`'s `replyTo`, `setState`, the per-source end lines | |
| T7→T9, T10, T11 | `alertText`, `WATCH_LINES` (with `unpriced`), `priceStamp` | T11 re-spells the phrases on the client |
| T8→T9, T12 | `createEdgar`, `EdgarFetch`, `filingSymbols`, `diffFilings`, `pollDue` | the smoke's fake fetch |
| T9→T10, T11 | `WatchStatus` (`markets` with their `today`, `pending`, `marks`, `filings`), `DeskStatus.watch`, `AlertSummary` (`latencyMs`) | |
| T9→existing callers | `installDesk`, with `quotes` (renamed in T1, every caller updated there), `watchRow` and `schedule.calendars` optional | no book means `idle` |

### B. Each task against itself

- **T2:** the copy is pinned to the plugin's JSON by a test, and the face imports nothing from `plugins/`.

### C. P3 changes to P1 and P2 files

| P3 task | P1/P2 file | Collision |
|---|---|---|
| T1 | `us-quotes.ts` → `market-quotes.ts`, `et.ts`, `account-proxy.ts`, `desk-book.ts`, `desk-tools.ts`, `desk.ts`, `schedule.ts`, `brief.ts`, `main.ts`, their tests | the source and its names are the Market's (M11); the symbol grammar moves to `symbols.ts` and widens; `notYet` becomes `scope`; the assertions Task 1 names change |
| T2 | `market-clock.ts`, `schedule.ts`, `desk-fakes.ts`, `desk-weight.test.ts` | `dateOf`, `deskCalendars` and its re-export are additions; the US default and every fake's ET default are unchanged |
| T4 | `desk.ts`, `scripts/desk.ts`, `desk-cli.test.ts`, `telegram.ts` | additions; the usage line grows |
| T6 | `desk-session.ts`, `desk-conversation.ts`, `desk.md`, `cycle.test.ts` | as the old T5 |
| T9 | `installDesk`, `desk-weight.test.ts` | optional deps; one calendar per market; the bridge in the dispose order |
| T10 | `brief.ts`, `STANDING.md`, `schedule.ts`, `deskStatusLines`, `service.test.ts` | the armed `preclose` must be re-armed |
| T11 | `market-view.js`, `reducers/markets.js`, `render/markets.js`, `app.css` | one tab and one mark added |
