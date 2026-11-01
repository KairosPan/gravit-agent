# The Desk, P3 — the Watch (re-plan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The face watches the operator's price levels, urgent-event rules and US filings for US and A shares. It sends each alert to the phone itself, quoting the plan and naming the price's source and exchange time. A bounded desk turn then checks the plan, as a reply. Everything shows in the Markets screen's Desk view.

**Architecture:**
- **Prices are polled; there is no stream (M4).**
  - US: `UsQuoteSource.snapshot` (the Account's explore read, `src/us-quotes.ts`) every 20 s.
  - A shares: `QuoteHub.snapshot` (`src/quotes.ts`, Tencent) every 15 s.
  - Each poll runs only inside its market's session window, from the XNYS calendar or the new XSHG table.
- **The watch.** `src/watch.ts` reloads the book through `desk-book.ts`, judges each print with the pure evaluator in `watch-eval.ts`, and records every hit in `alerts.jsonl` through one chain. It sends the text from `alert-text.ts` through the conversation's `deliver`, then posts one annotation per pass, never awaited; the annotation's answer comes as a reply.
- **Filings.** `src/edgar.ts` reads EDGAR in Node every 5 minutes, 07:00–20:00 ET on XNYS session days. Its symbols are the US ones only, and it reads nothing without `ALPHA_EDGAR_USER_AGENT` (M2).
- **The Desk view.** A `desk` tab in Markets draws `/data/desk/status`: status, standing orders, the watch, today's alerts and refusals. A level shows on its market's row and page (M1).

**Tech Stack:** Node 22, TypeScript strict via `tsx`, `node:test`; js-yaml 4.3.2 (`CORE_SCHEMA`); global `fetch` (Node 22) for EDGAR, injected everywhere it is tested; the gravit-ui client (plain ESM, fake-DOM tests); dsh 0.2.0-rc.2 unchanged. No dependency added, no Python.

**Spec:** `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` — §5.5–§5.10, §6, §7, §9, §12 as amended by **§15 (M1–M8), which wins where they disagree**. Binding beside it: `.superpowers/research/desk-p1-p4/controller-notes.md` (the P1 and P2 rulings, and the P3 rulings this plan keeps — see "Rulings carried"), and `replan-brief.md`'s M9 and M10.

**Base:** `feat/desk-p1-p4` at `bae0b7f2` (main merged, P0–P2 re-landed, the desk's US quotes from the Account). Recurring facts:
- the outlet's `send(text, { replyTo })` resolves `{ sent: number[]; queued?: true } | { queued: true }`;
- `DeskConversationDeps.deadlineFor(kind)` already exists;
- `installDesk`'s `hub` is a `UsQuoteSource`, and `registerQuoteRoutes` builds the A-share hub itself today.
- **"The old Task N"** means Task N of `docs/superpowers/plans/2026-10-20-desk-p3-watch.md` (superseded, kept): its text binds where this plan says "as the old Task N", except for what this plan changes or drops.

**Done (§15 M6, P3) — the operator's drill, written by Task 13:**
- one real level crossing, on a US symbol and on an A-share symbol, reached the phone with its plan within one poll interval plus 10 s (US 30 s, A shares 25 s), read off the Desk view's `latencyMs` (from the quote's `as_of` to the send resolving);
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
- the old plan's rulings 1, 3–6, 11–14 and 16–17, re-numbered below.

## Rulings this plan makes

Each ends with the cost if wrong.

1. **What fires** (old 1, kept). A level or a `move_pct` key fires on a crossing between two judged observations of one session. It also fires once, labelled `gap`, when already past at its first judged observation of a session and not yet alerted for that session. A `gap` rule judges only that first observation, inside 30 minutes of its market's open. Cost: a `move_pct` and a `gap` rule on one symbol both fire on a large opening gap.
2. **What is judged (M5).**
   - **US.** A print whose `as_of` lies in `[open, close)` of the XNYS session of its own ET date.
   - **A shares.** A print whose `market_status` is `open`, whose Beijing date is the session's, and whose Beijing clock lies in `[09:30, 11:30)` or `[13:00, 15:00)`. So the 09:15–09:25 auction and the midday break are never judged.
   - **The poll windows.** Each market is polled from 10 minutes before its open to 1 minute after its close, and not at all on a closed day.
   - **Past the XSHG table** (after 2026-12-31) the A-share window is 09:20–15:01 Beijing on weekdays, and Tencent's word alone decides, with one line a day.

   Cost: a print after the close reaches the operator only through `desk_quotes` or the brief.
3. **Cadence (M4).**
   - **US:** `WATCH_US_POLL_MS = 20_000`. That is the proxy's explore cache (`ACCOUNT_TTL_MS.explore`), so polling faster only re-reads the cache. It is also the Account page's own explore cadence. The reads go through `accountUsQuotes` at `ACCOUNT_QUOTES_CONCURRENCY` (6).
   - **A shares:** `WATCH_CN_POLL_MS = 15_000`. That is the hub's own poll floor, and each poll is one batched Tencent GET.
   - **Caps:** `WATCH_US_MAX = 40`, because the proxy keeps 64 explore answers (`ACCOUNT_CACHE_KEYS`) and the Markets screen needs the rest. `WATCH_CN_MAX = 100` (`QUOTE_LIMIT`). The symbols past a cap are named on the phone once per distinct set, holdings first, then levels, then rule symbols.
   - **The tick:** `WATCH_TICK_MS = 5_000` decides which polls are due.

   Cost: a US crossing can wait up to 20 s for the cache, plus the reads.
4. **No server subscription on the hub (a change from M4's wording).** The watch calls `QuoteHub.snapshot` on its own cadence and adds nothing to the hub.
   - **Why.** `snapshot` makes the same one Tencent request, holds a client slot only while it runs (`QUOTE_CLIENT_LIMIT`), and needs no listener isolation. A `subscribe` would take one of the eight browser slots and run at the hub's 30 s default.
   - **What changes.** Only `main.ts`, which now owns the hub and hands it to both `registerQuoteRoutes` and `installDesk`.

   Cost: none measured; a later need for a pushed A-share price adds `subscribeServer` then.
5. **Repeats, gates, batch, annotation** (old 3–6, kept).
   - **Cooldowns.** A price hit inside its cooldown is counted, not recorded. A filing hit inside its cooldown is recorded `suppressed: cooldown`.
   - **Gates.** They run OFF, then MUTE, then the cap. The budget stops only annotations. A suppressed alert is never annotated.
   - **The batch.** Only `cap` alerts are batched. A batch goes at the first tick in a later ET hour; it is dropped and recorded when it falls due under OFF or MUTE. It lists at most 20 items.
   - **The annotation.** One post per pass, replying to the first delivered alert's first message id. Rules default to `annotate: false`, and `annotate: true` needs a `plan`.

   Cost as before.
6. **The state inject** (old 11, kept). It goes before a phone post only while the desk session is idle. It holds every holding, the levels within 2% (at most 10, nearest first), and today's counts. It is priced by one snapshot per market, each raced at 3,000 ms. Cost: a text queued behind a turn carries no state.
7. **One watch per home** (old 12, changed only in cadence). `watch.lease` (`{ pid, since, beat }`) is rewritten every `LEASE_BEAT_MS = 30_000`. It is stale when its pid is gone (`ESRCH`/`EPERM`) or its beat is `LEASE_STALE_MS = 120_000` old, and a stale lease is taken over. Cost: a second face waits up to 2 minutes.
8. **Load lines** (old 14, kept). The watch re-reads `desk/levels.yml`, every `strategies/<name>/levels.yml`, `desk/holdings.yml` and `desk/rules.yml` on an mtime or size change and on each new ET date. It sends one line per distinct `(file, sha256 or error, refusals)`. A broken file keeps its last good load. Strategy files are read unpinned: this is recorded as charter D28, not held. Cost: each edit sends a line.
9. **Filings (M2).**
   - **Symbols.** The filing rules' resolved **US** symbols, at most `FILINGS_SYMBOLS_MAX = 60`, holdings first. A-share symbols are skipped and counted.
   - **Window.** Polled every 5 minutes, 07:00–20:00 ET, on XNYS session days. A filing pings only when accepted on today's ET date inside that window; any other is `suppressed: window`.
   - **Baseline.** Each symbol's first good poll seeds silently.
   - **Acceptance time.** `acceptanceDateTime`'s wall time is read in America/New_York despite its `Z` (old ruling 10; the drill checks one filing).
   - **Requests.** One ticker map per ET date. Requests are spaced 200 ms apart. No symbol starts after 90 s, and a poll is aborted at 120 s.
   - **Refusals.** A poll whose every symbol is refused (401 or 403) sends one line, and filings stay off until the next ET date.
   - **No contact.** Without `ALPHA_EDGAR_USER_AGENT`, filings are `off` and nothing is fetched.

   Cost: a `Z` that is true UTC shifts times by 4–5 hours.
10. **Halts stay refused, with a new reason:** `halts need a trading-status feed; neither the Account's read nor Tencent's carries one`. Cost: none.
11. **The brief stays US and the desk's own book (M8, the P2 fix wave's I3).**
    - It prices only US entries and counts the A-share ones in `aShares: { holdings; levels }`.
    - `notYet` becomes `scope`: `desk/ only; A shares and each strategy's levels.yml are the watch's and their reports'`.
    - It gains the alerts and filings blocks (old 13, kept).
    - `desk/STANDING.md` changes, so the armed `preclose` is `refused-hash` until `npm run desk -- rearm preclose`.

    Cost: one rearm.
12. **`desk_quotes` speaks both markets (M1).** Six digits are asked of the A-share hub, a ticker of the Account. Each line names its source. Cost: the tool's schema grows by one pattern.
13. **Names.**
    - `installDesk` gains `cnHub` and `watchRow`, and `DeskHandle.watchRow` resolves the watch's handle.
    - `ALERT_DEADLINE_MS = 90_000` lives in `desk.ts`, with `alertDeadlineMs` as the smokes' seam.
    - Ids are `a-`, `p-` or `b-` plus 12 lowercase hex characters.

    Cost: none.

## Global Constraints

- **B2.** Nothing in P3 places, cancels or proposes an order. An alert quotes the plan verbatim and stops. `edgar.ts` imports nothing from `account-seat.ts`, `orders.ts` or `account-proxy.ts` (a grep test).
- **Ledger.**
  - Files live under `$DSH_HOME/face/desk/`, mode `0600`, through P0's lock, and a failure is one `gravit-face:` line. New files: `alerts.jsonl`, `filings.jsonl`, `MUTE` and `watch.lease`.
  - `events.jsonl` gains `mute-set`, `mute-cleared` and `watch-load`.
  - The watch appends `alerts.jsonl`, `filings.jsonl` and its events each through one `appendChain`.
- **YAML.** `rules.yml` is read through `readDeskYaml` (CORE_SCHEMA). Every rule has `kind:` (`move_pct`, `gap`, `filing`) and `symbols:`, never `on:`. An unknown key or kind is refused.
- **No live network in any test (P3-18, M2).**
  - No test, smoke or browser check reaches the SEC, the Account or Tencent.
  - `edgar.ts` takes `fetch` as a dependency; the watch's tests and the smoke pass fakes.
  - The smoke and the browser check boot without `ALPHA_EDGAR_USER_AGENT`, with `FACE_ACCOUNT_URL=http://127.0.0.1:9`, and with no A-share symbol in any book file the real hub would poll.
- **Starting (P3-19, reworded).**
  - The watch starts only when `installDesk` is given `watchRow` (main.ts passes `{}`), with the desk conversation and at least one quote source. A face without `cnHub` watches US only, and one without a US source watches A shares only. A source whose `unavailable` is set counts as absent.
  - With nothing to watch, it asks no calendar, polls nothing and sends no line.
  - P1's and P2's tests and smokes stay green, unchanged.
- **Module weight.** Importing `src/desk.ts` or `scripts/desk.ts` loads none of `watch.ts`, `watch-eval.ts`, `alert-text.ts`, `edgar.ts`, `filings.ts` or `xshg-clock.ts`. `installDesk` imports `./watch.ts` on first use.
- **Phone lines, exact.** `<HH:MM ET>` comes from `deskTime`; `<file>` is repo-relative.

  | When | Line |
  |---|---|
  | an alert | `alertText` (Task 7) |
  | the overflow | `<n> more alerts suppressed: <SYMBOL> <label> <HH:MM ET>, …[, and <k> more]` (`1 more alert suppressed: …`) |
  | a file refused | `<file> is refused, so the watch keeps its last good load: <error>` |
  | a file loaded with refusals | `<file>: <n> loaded, <k> refused - #<i>[ <SYMBOL>]: <reason>; …` (cut at 500 characters with `…`) |
  | a file changed, nothing refused | `<file> changed (sha256 <8 hex>): <n> loaded` |
  | over a market's cap | `the watch covers <n> <US | A-share> symbols; not watched: <SYMBOL>, …` (cut at 500) |
  | a US source unavailable at a poll's first failure of the day | `the watch has no US prices today: <reason>` |
  | A shares past the XSHG table (once per Beijing date) | `the A-share calendar ends <last date>; the watch judges A shares on Tencent's word alone until face/src/xshg-clock.ts is extended` |
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

1. **A restart, a crash, or a second face.** Expected: no second `gap`; cooldowns and the hour's count kept; a dead face's lease taken over. Tests: Task 5 "rebuildDay restores the day across both markets' session dates"; Task 9 "a restart over the same ledger fires no second gap" and "a stale lease is taken over".
2. **A burst at the open while an annotation is slow.** Expected: twelve levels past in one poll give twelve records, six sends in order, six held for the next hour, and one `[alerts · 6 · …]` post; a hanging post never delays the next alert. Tests: Task 5 "a burst of twelve gap hits sends six and holds six"; Task 9 "an annotation post that hangs 5 s does not delay the next pass's alert".
3. **An A-share print in the auction, at lunch, or on a holiday.** Expected: never judged. A Tencent `open` at 09:20 Beijing, or at 11:45, makes no hit, and a closed XSHG day polls nothing. Tests: Task 5 "an A-share print is judged only inside 09:30-11:30 and 13:00-15:00 Beijing with Tencent open"; Task 9 "a closed XSHG day polls no A share".
4. **The Account slow, refusing or busy.** Expected: a 429 or an unreachable Account makes no hit and no thrown tick. A delayed feed's alert says its feed; one line a day says the US prices are gone. Tests: Task 9 "the Account busy or unreachable sends one line a day and judges nothing"; Task 7 "a delayed US quote's stamp names its feed".
5. **A levels file edited while the face runs, or a six-digit symbol typo.** Expected: the next tick reloads it. `60051` is refused as a symbol; an edited plan keeps its cooldown; a broken edit keeps the last good load. Tests: Task 1 "marketOf reads six digits as an A share and refuses five"; Task 9 "levels.yml edited while the face runs is reloaded on the next tick".

---

### Task 1: Two markets in the book, `desk_quotes` and the brief

**Files:**
- Modify: `face/src/desk-book.ts`, `face/src/desk-tools.ts`, `face/src/desk.ts` (`installDesk`'s `cnHub`, passed to the tools only), `face/src/brief.ts`, `face/src/main.ts`, `desk/levels.example.yml`
- Test: `face/tests/desk-book.test.ts`, `face/tests/desk-tools.test.ts`, `face/tests/brief.test.ts`

**Interfaces:**
- Consumes: `SYMBOL_RE`, `loadLevels`, `loadHoldings`, `Level`, `Holding` (desk-book.ts); `QuoteHub`, `createQuoteHub`, `registerQuoteRoutes` (quotes.ts); `UsQuoteSource` (us-quotes.ts); `BriefDeps`, `Brief` (brief.ts); `DeskToolDeps` (desk-tools.ts).
- Produces, `desk-book.ts`:
  - `type Market = "us" | "cn"`; `CN_SYMBOL_RE = /^\d{6}$/`;
  - `marketOf(symbol: unknown): Market | undefined` — `cn` for `CN_SYMBOL_RE`, `us` for `SYMBOL_RE`, else `undefined`;
  - `Level.market: Market` and `Holding.market: Market`. A symbol neither grammar takes is refused with `symbol must be a US ticker (NVDA, BRK.B) or six digits for an A share (600519)`.
- Produces, `desk-tools.ts`:
  - `DeskToolDeps.cnHub?: Pick<QuoteHub, "snapshot">`.
  - `desk_quotes` takes 1–20 symbols, each matching `SYMBOL_RE` or `CN_SYMBOL_RE`. US symbols go to `hub` and A shares to `cnHub`: one snapshot per market, in parallel, answered in the order asked.
  - A quote gains `market` and `source` (`"Account"` | `"Tencent"`).
  - An A share without `cnHub` is `unavailable` with reason `no A-share quote source in this face`.
  - A line reads `600519 1452.3, +0.85% vs prev close 1440.06 | Tencent 14:03:12 Beijing | live`. The Beijing time comes from `bjClock`, defined in desk-tools.ts until Task 2 moves it into `xshg-clock.ts`.
- Produces, `desk.ts`: `installDesk` deps gain `cnHub?: Pick<QuoteHub, "snapshot">`, which reaches `deskToolDefinitions`.
- Produces, `main.ts`: `const quoteHub = createQuoteHub()`, passed as `registerQuoteRoutes(…, { hub: quoteHub })` and as `installDesk(…, { cnHub: quoteHub })`. The data routes' disposer still closes it, after `desk.dispose`.
- Produces, `brief.ts`:
  - `Brief.aShares: { holdings: number; levels: number }`, placed after `levels`;
  - `notYet` replaced by `scope: typeof BRIEF_SCOPE`, with `BRIEF_SCOPE = "desk/ only; A shares and each strategy's levels.yml are the watch's and their reports'"`;
  - A-share entries are neither priced nor listed.
- `desk/levels.example.yml` gains a fourth entry: `symbol: "600519"` (quoted, so YAML keeps it a string), `kind: watch`, `price: 1400`, `when: cross_down`, a one-line plan, `expires: 2026-12-31`. A comment says six digits is an A share. The comment is needed because YAML would read an unquoted `600519` as a number, and the loader refuses a number.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/desk-book.test.ts (append)
test("marketOf reads six digits as an A share and refuses five", () => {
  assert.equal(marketOf("600519"), "cn"); assert.equal(marketOf("NVDA"), "us"); assert.equal(marketOf("BRK.B"), "us");
  assert.equal(marketOf("60051"), undefined); assert.equal(marketOf(600519), undefined); assert.equal(marketOf("sh600519"), undefined);
});
test("levels and holdings carry their market; an unquoted 600519 is refused, not coerced", async () => {
  // "- symbol: \"600519\" …" → entries[0].market "cn"; "- symbol: 600519 …" → refusal reason "symbol must be a US ticker (NVDA, BRK.B) or six digits for an A share (600519) (got 600519)"
});
test("the shipped levels.example.yml loads with no refusal and one A share", async () => { /* markets ["us","us","us","cn"] */ });
// face/tests/desk-tools.test.ts (append)
test("desk_quotes asks each market's source once and answers in the order asked", async () => {
  // symbols ["600519", "NVDA", "000001"] → hub.snapshot([NVDA]) once, cnHub.snapshot([cn:600519, cn:000001]) once;
  // quotes[0] { symbol: "600519", market: "cn", source: "Tencent" }; the line "600519 1452.3, +0.85% vs prev close 1440.06 | Tencent 14:03:12 Beijing | live"
});
test("desk_quotes without cnHub answers an A share unavailable and still prices the US one", async () => { /* reason "no A-share quote source in this face" */ });
// face/tests/brief.test.ts (append; P2's tests lose only the notYet assertion)
test("the brief prices only US entries and counts the A shares", async () => {
  // holdings NVDA + 600519, levels AAPL + 000001 → hub asked for no six-digit symbol; aShares { holdings: 1, levels: 1 }; scope === BRIEF_SCOPE
});
```

- [ ] **Step 2: Run them to verify they fail** — `cd face && npx tsx --test tests/desk-book.test.ts tests/desk-tools.test.ts tests/brief.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The loaders take the symbol through `marketOf`. `desk_quotes` splits by `marketOf` and maps an A-share `LiveQuote` to the desk's quote shape. `main.ts` builds the hub once.
- [ ] **Step 4: Run them to verify they pass**, then `npm test && npm run typecheck` and `FACE_SMOKE=1 npx tsx --test tests/desk-smoke.test.ts tests/smoke.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add face/src/desk-book.ts face/src/desk-tools.ts face/src/desk.ts face/src/brief.ts face/src/main.ts desk/levels.example.yml face/tests/desk-book.test.ts face/tests/desk-tools.test.ts face/tests/brief.test.ts`, message `feat(face): the desk's book and desk_quotes take A shares as six digits; the brief stays US and counts them`.

---

### Task 2: The XSHG clock, and a calendar per market

**Files:**
- Create: `face/src/xshg-clock.ts`, `face/tests/xshg-clock.test.ts`
- Modify: `face/src/market-clock.ts` (`createMarketCalendar`'s `dateOf`, `DeskCalendars`), `face/src/desk-tools.ts` (imports `bjClock`), `face/tests/market-clock.test.ts`

**Interfaces:**
- Consumes: `MarketSession`, `MarketWindow`, `MarketClock`, `createMarketCalendar`, `MAX_WINDOW_DAYS` (market-clock.ts).
- Produces, `xshg-clock.ts` (imports only `market-clock.ts` types):
  - `XSHG_CLOCK = "builtin XSHG table (face/src/xshg-clock.ts)"`.
  - `XSHG_CLOSURES: Readonly<Record<string, string>>` — every weekday the SSE closes, keyed by date and naming the holiday. It is copied from `face/plugins/lunhui/lib/calendar/2026.json`'s seven ranges (元旦 01-01..01-03, 春节 02-15..02-23, 清明节 04-04..04-06, 劳动节 05-01..05-05, 端午节 06-19..06-21, 中秋节 09-25..09-27, 国庆节 10-01..10-07), with their SSE notice URLs in the header comment.
  - `XSHG_COVERED = { from: "2026-01-01", through: "2026-12-31" }`.
  - `bjDate(d: Date): string` and `bjClock(d: Date): string` (`HH:MM:SS`), both in Asia/Shanghai.
  - `xshgSession(date: string): MarketSession | "closed" | "uncovered"` — a weekday not in the table is `{ date, open: <date>T01:30:00Z, close: <date>T07:00:00Z, early: false }`.
  - `xshgWindow(from: string, days: number): MarketWindow` — the window's `days` are cut to end at `XSHG_COVERED.through`. A `from` past that throws `the A-share calendar covers 2026-01-01 to 2026-12-31; <from> is past it`.
  - `xshgMarketClock(): MarketClock`.
- Produces, `market-clock.ts`:
  - `createMarketCalendar(opts)` gains `dateOf?: (now: number) => string`, `etDate` by default; `today(now)` asks for `dateOf(now)`.
  - `interface DeskCalendars { us: MarketCalendar; cn: MarketCalendar }`.
  - `deskCalendars(seams?: Partial<DeskCalendars>): DeskCalendars`. Its default cn calendar is `createMarketCalendar({ ask: xshgMarketClock(), clock: XSHG_CLOCK, dateOf: (n) => bjDate(new Date(n)) })`, and `market-clock.ts` imports `xshg-clock.ts` lazily inside it, so the pause switch never loads the table.

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
test("bjDate and bjClock read Beijing time, which keeps no daylight time", () => {
  assert.equal(bjDate(new Date("2026-11-01T16:30:00Z")), "2026-11-02"); assert.equal(bjClock(new Date("2026-07-01T06:03:12Z")), "14:03:12");
});
// face/tests/market-clock.test.ts (append)
test("a calendar asks for its own market's date", async () => {
  // dateOf bj: now 2026-11-02T00:30:00Z (ET 2026-11-01, Beijing 2026-11-02) → asked "2026-11-02", session 01:30Z-07:00Z
});
```

- [ ] **Step 2: Run them to verify they fail** — `cd face && npx tsx --test tests/xshg-clock.test.ts tests/market-clock.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `xshg-clock.ts`, `dateOf` and `deskCalendars`, and move `bjClock` out of desk-tools.ts.
- [ ] **Step 4: Run them to verify they pass**, then `npm test && npm run typecheck`. `desk-weight.test.ts` gains `src/xshg-clock.ts` in the list that `src/desk.ts` must not load. Expected: PASS.
- [ ] **Step 5: Commit** — the five files plus `face/tests/desk-weight.test.ts`, message `feat(face): the XSHG clock - the SSE's 2026 closures in Node, a calendar per market, nothing guessed past the table`.

---

### Task 3: `rules.yml` and its loader

**Files:**
- Modify: `face/src/desk-book.ts`, `face/src/brief.ts` (imports the moved `levelDistancePct`; output unchanged)
- Create: `desk/rules.yml`
- Test: `face/tests/desk-book.test.ts`

**Interfaces:**
- Consumes: `readDeskYaml`, `LoadResult`, `LoadRefusal`, `Level`, `marketOf`, `PLAN_MAX_CHARS`, and the level loader's `cooldown` grammar together with its missing, oversized, not-YAML and not-a-list results.
- Produces, `desk-book.ts`, exactly as the old plan's Task 2 except:
  - `RULE_KINDS = ["move_pct", "gap", "filing"] as const`; `FILING_FORMS = ["8-K", "8-K/A", "4"] as const`; `RULES_MAX = 20`; `RULE_PCT_MAX = 50`;
  - `interface SymbolSet { holdings: boolean; levels: boolean; symbols: string[] }` — `symbols` takes US tickers and six-digit A shares;
  - `type Rule = { file; index; id; symbols: SymbolSet; annotate: boolean; plan?: string } & ({ kind: "move_pct"; movePct: number; cooldownMs: number } | { kind: "gap"; gapPct: number } | { kind: "filing"; forms: FilingForm[]; cooldownMs: number })`;
  - `loadRules(path: string, file: string): Promise<LoadResult<Rule>>`, with the old refusal table and two rows changed:

    | Entry | Reason |
    |---|---|
    | `kind: halt` | `halts need a trading-status feed; neither the Account's read nor Tencent's carries one` |
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
- **Consumes:** Task 1 (`Market`, `marketOf`); Task 2 (`bjDate`, `bjClock`); Task 3 (`Rule`, `resolveSymbols`, `levelDistancePct`); `Level`, `LevelKind`, `Holding`; `MarketSession`; `DeliverResult`; `etDate`; `UsLiveQuote`; `LiveQuote` (quote-types.ts).
- **Produces** (pure, but for the ids' randomness):
  - **Constants:** `ALERTS_PER_HOUR = 6`, `HOUR_MS = 3_600_000`, `GAP_RULE_WINDOW_MS = 1_800_000`.
  - **The quote the watch judges.**
    - `interface WatchQuote { market: Market; symbol: string; price: number | null; prevClose: number | null; changePct: number | null; asOf: string | null; receivedAt: string | null; source: "Account" | "Tencent"; feed: string; status: string; open: boolean | null }`.
    - `open` is Tencent's `market_status === "open"`, and `null` for a US quote.
    - `watchQuoteOfUs(q: UsLiveQuote): WatchQuote` and `watchQuoteOfCn(q: LiveQuote): WatchQuote`.
  - **Sessions:** `interface WatchSessions { us?: MarketSession; cn?: MarketSession & { uncovered?: true } }`.
  - **`judgedDate(q: WatchQuote, sessions: WatchSessions): string | undefined`** — the session date a print is judged in (ruling 2), else `undefined`.
  - **Keys:**
    - `KeyTrigger` and `FilingTrigger` as the old Task 4.
    - `PriceKey` gains `market: Market`.
    - `priceKeys(book: { levels; rules; holdings }): PriceKey[]`, with the old key strings.
  - **Readings:** `pastOf(k: PriceKey, q: WatchQuote): boolean | undefined`, as the old one.
  - **The day:**
    - `interface KeyDay { date: string; side?: boolean; lastHitAt?: number; alerted: boolean; repeats: number }`, where `date` is the session date it belongs to; a key judged on another date starts afresh.
    - `interface WatchDay { keys: Map<string, KeyDay>; sends: number[]; pending: { id: string; t: number }[] }`, from `emptyDay()`.
  - **Evaluation:** `type Hit = { key: PriceKey; quote: WatchQuote; gap: boolean; date: string }`. `evaluatePass(day, keys, quotes: WatchQuote[], sessions, now): Hit[]`:
    - steps 2–5 of the old Task 4, on `judgedDate`;
    - a gap rule's window is measured from its market's session open.
  - **The gate and the batch:** `gate(day, now, flags: { off: boolean; muted: boolean }, id): Gate`, `batchDue(day, now)` and `takeBatch(day)`, as the old Task 4.
  - **Records:**
    - `QuoteSnap = { market: Market; price; asOf; source: "Account" | "Tencent"; feed; status; prevClose; chgPct; receivedAt }`, from `snapOf(q)`.
    - `AlertHit`, `AlertDelivered`, `AlertBatch` and `AlertAnnotation` as the old Task 4. `AlertHit` gains `market` and `date`, and `QuoteSnap` replaces the old one.
    - `isAlertRecord(x)`.
  - **The rebuild:** `rebuildDay(records: unknown[], now: number): WatchDay` reads the `alert` records of the last 36 h.
    - A key is `alerted` for each session `date` its records name.
    - `lastHitAt` is its latest non-`cooldown` `t`.
    - `sends` are the `send` decisions within `HOUR_MS`.
    - `pending` holds the `cap` ids no `batch` lists.
  - **Ids:** `alertId()`, `passId()`, `batchId()`.
- **Dropped from the old Task 4:** `rankPriority`, `STREAM_SLOTS`, `RANK_MARGIN_PCT`, `WATCH_SYMBOLS_MAX` and `via`.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/watch-eval.test.ts — US S: 2026-11-30 14:30Z-21:00Z; CN C: 2026-12-01 01:30Z-07:00Z; u(sym, price, asOf, prev?), c(code, price, asOf, open, prev?)
test("a crossing between two judged prints fires, and only a crossing", () => { /* the old test, on u(...) */ });
test("past at the first judged observation fires once as gap - a level, a move rule - and a gap rule only within 30 minutes of its open", () => {
  // US as before; CN: 600519 below its stop at 01:31Z → gap; a gap rule at 02:05Z (09:35 Beijing → inside) fires, at 02:01Z+31min no
});
test("a US print is judged on as_of inside its own session, not on the clock", () => { /* the old session test, incl. 2026-11-02 DST and the 2026-11-27 early close */ });
test("an A-share print is judged only inside 09:30-11:30 and 13:00-15:00 Beijing with Tencent open", () => {
  // 01:20Z (09:20 auction, open true) no; 01:30Z yes; 03:30Z (11:30) no; 03:45Z (11:45, open true) no; 05:00Z (13:00) yes;
  // 06:59:59Z yes; 07:00Z no; open false at 02:00Z no; an as_of on 2026-11-30 Beijing while C is 2026-12-01 no
});
test("a key's day is its session's: a US gap and an A-share gap on one evening are both first observations", () => { /* … */ });
test("a repeat inside the cooldown is counted, not a hit; after it a crossing hits again", () => { /* … */ });
test("gate: OFF before MUTE before the cap, and the seventh send in a rolling hour is held for the batch", () => { /* … */ });
test("a burst of twelve gap hits sends six and holds six", () => { /* Review Focus 2 */ });
test("rebuildDay restores the day across both markets' session dates", () => { // Review Focus 1
  // a US gap sent 14:30:02Z on 2026-11-30 and an A-share gap sent 01:30:05Z on 2026-12-01 → both alerted for their dates; a third market-date record older than 36 h ignored
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
- **Consumes:** Task 5 (`AlertHit`, `QuoteSnap`, the triggers); Task 6 (`DeskSource`); Task 2 (`bjClock`, `bjDate`); `quoteTime`; `LoadRefusal`; `deskTime`, `etClock`.
- **Produces** (pure):
  - **`priceStamp(snap: QuoteSnap, now: number): string` (M4).**
    - A US quote is `Account <quoteTime(feed, asOf, now)>`, as in `Account ROBINHOOD 10:21:03 ET` or `Account CBOE DELAYED 10:05:00 ET`.
    - An A share is `Tencent <bjClock> Beijing`, dated `Tencent 2026-12-01 14:03:12 Beijing` when its Beijing date differs from now's.
  - **`alertText(hit, now, note: "follows" | "budget" | "none")`** keeps the old Task 6's line order and fields, with two changes:
    - line 1 is `<SYMBOL> <price> · <priceStamp>`;
    - line 5 is `day: <signed %, 2 dp> from the previous close <prevClose>`, or `day: no previous close yet`.
  - `batchText(hits, now)` and `BATCH_ITEMS_MAX = 20`, as the old Task 6.
  - `annotationPost(hits, pass, now): { text; source; message }`, as the old Task 6.
  - **The desk state:** `NearView` and `DeskStateView` as the old Task 6, each item gaining `market`; `stateBody(view)`.
  - **`WATCH_LINES`**, the rows of the Global Constraints table:
    - `fileRefused(file, error)`, `fileLoaded(file, loaded, refusals)`, `fileChanged(file, sha256, loaded)`;
    - `overCap(market, n, symbols)`, `usUnavailable(reason)`, `cnPastTable(last)`, `noCalendar(error)`, `heldElsewhere(pid)`;
    - `filingsNoContact()`, `filingsRefused(error)`, `filingsOverCap(symbols)`.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/alert-text.test.ts — NOW = Date.parse("2026-11-30T15:21:04Z")
test("a US level alert carries the §5.9 fields, the plan verbatim, its source and exchange time", () => {
  assert.equal(alertText(NVDA_STOP /* feed "robinhood", asOf 15:21:03.512Z, prevClose 174.05, held 100 @ 120.5 */, NOW, "follows"), [
    "NVDA 169.82 · Account ROBINHOOD 10:21:03 ET",
    "stop 170 cross_down · desk/levels.yml · THESIS.md §3",
    "held 100 @ 120.50 · day P&L -423.00",
    "plan: sell half on a close below 170",
    "day: -2.43% from the previous close 174.05",
    "annotation follows",
  ].join("\n"));
});
test("an A-share alert names Tencent and Beijing time", () => {
  assert.equal(alertText(MOUTAI_WATCH /* 600519 1398.5, asOf 2026-12-01T06:03:12Z, prev 1440.06, not held */, Date.parse("2026-12-01T06:03:20Z"), "none").split("\n")[0],
    "600519 1398.5 · Tencent 14:03:12 Beijing");
});
test("a delayed US quote's stamp names its feed", () => { /* feed "cboe delayed" → "Account CBOE DELAYED 10:05:00 ET" */ });
test("a move rule, a gap rule and a filing", () => { /* the old test's three expectations, line 1 stamps updated */ });
test("batchText lists at most twenty, then counts the rest", () => { /* the old test */ });
test("annotationPost: one alert keeps its rule's form, several become the alerts form", () => { /* … */ });
test("WATCH_LINES render the phone-line table exactly", () => {
  assert.equal(WATCH_LINES.cnPastTable("2026-12-31"), "the A-share calendar ends 2026-12-31; the watch judges A shares on Tencent's word alone until face/src/xshg-clock.ts is extended");
  // each other row; the 500-character cuts with "…"
});
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/alert-text.test.ts` FAIL, then implement, then PASS with `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** — `face/src/alert-text.ts face/tests/alert-text.test.ts`, message `feat(face): the alert copy - the plan verbatim, Account or Tencent with the exchange time, the holding, the day's move, the batch and the watch's lines`.

---

### Task 8: Filings — the EDGAR reader in Node and its decisions

**Files:**
- Create: `face/src/edgar.ts`, `face/tests/edgar.test.ts`, `face/src/filings.ts`, `face/tests/filings.test.ts`

**Interfaces:**
- **Consumes:** `SYMBOL_RE`; `etDate`; `MarketCalendar`'s `DayAnswer`.
- **Produces, `edgar.ts` (M2).**
  - **Constants:** `EDGAR_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"`; `EDGAR_SUBMISSIONS = (cik: number) => \`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json\``; `EDGAR_SPACING_MS = 200`; `EDGAR_RESPONSE_MAX = 16 * 1024 * 1024`; `EDGAR_REQUEST_TIMEOUT_MS = 20_000`.
  - **Types:**
    - `type EdgarFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>`.
    - `interface Filing { symbol; cik: number; accession; form; filingDate; accepted: string | null; items: string | null; primaryDocument: string | null; url }`.
  - **`createEdgar(deps: { fetch: EdgarFetch; userAgent: string; now?: () => number; sleep?: (ms: number) => Promise<void> })`** returns `{ recentFilings(symbols: string[], forms: readonly string[], since: string, opts: { stopAfterMs: number; signal: AbortSignal }): Promise<{ filings: Filing[]; errors: { symbol: string; error: string }[] }> }`.
    - **The ticker map** is read once per ET date and kept in memory. It maps `ticker` to `cik_str`.
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
  // a 403 → "refused: HTTP 403"; a fake clock past stopAfterMs → the rest "deadline"; an unknown ticker → no filing, no error
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
- **Consumes:** Tasks 1–8; `DeskCalendars`, `deskCalendars`; `readRecords`, `readBudget`, `readOffState`; `listChannelDirs` (channels.ts); `desk-fakes.ts` (`WallClock`, `fakeCalendar`).
- **Produces, `watch.ts`:**
  - **Constants:** `WATCH_TICK_MS = 5_000`, `WATCH_US_POLL_MS = 20_000`, `WATCH_CN_POLL_MS = 15_000`, `WATCH_US_MAX = 40`, `WATCH_CN_MAX = 100`, `WATCH_LEAD_MS = 600_000`, `WATCH_TAIL_MS = 60_000`, `LEASE_BEAT_MS = 30_000`, `LEASE_STALE_MS = 120_000`, `NEAR_MAX = 10`, `MARKS_MAX = 100`, `STATE_QUOTES_TIMEOUT_MS = 3_000`.
  - **`interface WatchDeps`:**
    - `home`, `root`;
    - `us?: UsQuoteSource` and `cn?: Pick<QuoteHub, "snapshot">`;
    - `calendars: DeskCalendars`, `clock: DeskClock`;
    - `deliver: (text: string, opts?: { replyTo?: number }) => Promise<DeliverResult>`, `post: DeskConversation["post"]`, `budget: () => Promise<BudgetState>`;
    - `edgar?: { fetch: EdgarFetch; userAgent: string }`;
    - `pid?: number`, `alive?: (pid: number) => boolean`, `tickMs?: number`, `log?`.
  - **The handle:** `interface WatchHandle { tick(): Promise<void>; status(): WatchStatus; stateText(): Promise<string | undefined>; dispose(): Promise<void> }`, from `installWatch(deps)`.
  - **`WatchStatus`:**
    - `state: "starting" | "idle" | "held-elsewhere" | "watching" | "stopped"`;
    - `markets: Record<Market, { state: "off" | "no-calendar" | "closed" | "waiting" | "polling" | "after-close"; session?: { date; open; close }; watched: number; notWatched: string[]; lastPollAt?: string; lastError?: string; uncovered?: true }>` — `off` means no source;
    - `holder?: { pid: number; since: string }`; `muted?: MuteState`; `files: WatchFileStatus[]`;
    - `near: NearView[]`; `marks: { market; symbol; kind: LevelKind; level: string; when; plan: string; file: string; distancePct: number | null }[]` (at most `MARKS_MAX`, nearest first);
    - `today: { sent: number; suppressed: Record<"cooldown" | "cap" | "muted" | "off" | "window", number>; repeats: number; pending: number }`;
    - `recent: AlertSummary[]`, newest first, at most 10, where `AlertSummary` is the old one with `via` replaced by `source: "Account" | "Tencent" | null` and with `market`;
    - `filings: { state: "off" | "no-contact" | "polling" | "refused-today"; symbols: number; aShares: number; seeded: number; lastPollAt?: string; lastError?: string }`;
    - `ledgerError?: string`.
  - **The lease, the boot and the passes:** as the old Task 8, with these changes.
    - **Each tick:**
      1. the lease, beating every `LEASE_BEAT_MS`;
      2. the ET-date line memories;
      3. the files (ruling 8);
      4. nothing to watch sets `idle` and stops there;
      5. per market with a source: its calendar's `today(now)`, its window (ruling 2), and a poll when due by its cadence (ruling 3) — never two in flight per market;
      6. a due batch;
      7. an expired mute lifted;
      8. filings (ruling 9): with a filing rule and no `edgar`, `no-contact` and its line; else `pollDue` starts one single-flight poll under an `AbortController` cut at `FILINGS_ABORT_MS`.
    - **A pass** is one market's poll, or one filings poll. It maps the payload through `watchQuoteOfUs` or `watchQuoteOfCn`, then runs `evaluatePass` with that market's session. Sends go before posts, as before.
    - **A poll's failure:** a US snapshot that rejects (429 busy, or unreachable) records the market's `lastError` and sends `usUnavailable` once per ET date. A source with `unavailable` set is `off`. Nothing is judged.
    - **A shares past the table:** the cn session is synthesised (09:30–15:00 Beijing on a weekday), with `uncovered: true` and `cnPastTable` once per Beijing date.
    - **`stateText()`:** at most one snapshot per market, each raced at 3,000 ms.
    - **`dispose()`:** it stops the ticks, aborts a filings poll, waits at most 2,000 ms for passes, posts and chains, and releases the lease.
- **Produces, `desk.ts`:**
  - `ALERT_DEADLINE_MS = 90_000`.
  - `installDesk` gains:
    - `alertDeadlineMs?`, which `deadlineFor("alert")` and `deadlineFor("alerts")` answer;
    - `watchRow?: { clock?: DeskClock; tickMs?: number; calendars?: Partial<DeskCalendars>; edgar?: { fetch: EdgarFetch; userAgent: string } | null; alive? }`. A `null` `edgar` means none; an absent one means production, which is `globalThis.fetch` with `process.env.ALPHA_EDGAR_USER_AGENT` when that is set.
  - **One `DeskCalendars`** is made on first use, as `deskCalendars({ us: schedule.calendar, ...watchRow.calendars })`. Its `us` reaches `createDeskSchedule` through `seams.calendar`.
  - **The watch starts** only when `watchRow` is given (main.ts passes `{}`; no existing test or smoke does), with the conversation and at least one usable source, once the outlet is set. Then `conversation.setState(() => watch.stateText())`. So no smoke booted in the primary checkout can poll the operator's real book.
  - `DeskHandle.watchRow?: Promise<WatchHandle | undefined>`.
  - `deskStatus`'s deps gain `watch?: () => WatchStatus | undefined`, and `DeskStatus` gains `watch?`.
  - `dispose` runs schedule → watch → bridge → conversation.
- **Checked green and unchanged:** every existing caller of `installDesk` (`desk.test.ts`, `desk-tools.test.ts`, `desk-smoke`, `smoke`, `telegram-smoke`, `schedule-smoke`, `schedule.test.ts`, `firing.test.ts`). None passes `watchRow`, so none starts a watch.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/watch.test.ts — a fake UsQuoteSource and a fake cn snapshot hub, each recording its calls and answering from a table the test edits;
// wall = new WallClock("2026-11-30T14:25:00Z"); calendars { us: fakeCalendar({ "2026-11-30": 14:30Z-21:00Z }), cn: fakeCalendar({ "2026-12-01": 01:30Z-07:00Z }) };
// deliver records { text, opts } and resolves { sent: [100 + n++] }; post resolves { opened: true, sessionId: "s" }; fixtures under face/tests/tmp/watch-<pid>/
test("a US crossing is recorded, sent with the Account's stamp and the plan, and one annotation post replies to it", async () => {
  // NVDA 171 then 169.82 at 15:21:03Z on two polls 20 s apart → one AlertHit, deliver opening "NVDA 169.82 · Account ROBINHOOD 10:21:03 ET"
  // and ending "annotation follows"; a delivered record whose tradeMs is the fake gap; post({ source: { kind: "alert", symbol: "NVDA", rule: "stop" }, replyTo: 100 })
});
test("an A-share crossing is sent with Tencent's stamp; the US poll is not asked outside its window", async () => {
  // wall 2026-12-01T01:25:00Z: cn polled from 01:20Z every 15 s, us not at all; 600519 1401 then 1398.5 at 02:03:12Z → "600519 1398.5 · Tencent 10:03:12 Beijing"
});
test("each market polls at its cadence, never two in flight, and only inside its window", async () => {
  // us: 14:20Z first poll, then +20 s; a poll that hangs 30 s → no second us poll until it settles; cn: +15 s; 21:01Z → us stops
});
test("a closed XSHG day polls no A share; past the table the watch says so once and judges on Tencent's word", async () => { /* … */ });
test("the Account busy or unreachable sends one line a day and judges nothing", async () => {
  // snapshot rejects HttpError(429) → markets.us.lastError "busy", "the watch has no US prices today: busy" once; unavailable set → markets.us.state "off", no poll
});
test("a symbol cap per market: past 40 US symbols the rest are named once", async () => { /* … */ });
test("a 09:30 burst records twelve, sends six, posts one annotation and batches six at 10:00", async () => { /* Review Focus 2 */ });
test("an annotation post that hangs 5 s does not delay the next pass's alert", async () => { /* … */ });
test("a restart over the same ledger fires no second gap and keeps the cooldown and the hour's count", async () => { /* Review Focus 1 */ });
test("a stale lease is taken over: its pid gone, EPERM, or its beat two minutes old", async () => { /* … */ });
test("a second watch on the same home stays off while the first face beats, and says so once", async () => { /* … */ });
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
  // no watchRow given → no watch; watchRow but no usable source → none; a fake US source and cnHub with watchRow → (await desk.watchRow)!.status().state; GET /data/desk/status → body.watch; alertDeadlineMs honoured
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
- **Consumes:** Task 5 (`isAlertRecord`); Task 7 (`priceStamp`); Task 8 (`isFilingRecord`); Task 9 (`WatchStatus`, `DeskStatus.watch`); `FIRINGS_FILE`, `isFiringRecord`.
- **Produces, `brief.ts`:** the old Task 9's `home?`, `briefSince`, the `alerts` and `filings` blocks and `BriefAlert` (with `stamp` from `priceStamp` and `market`) and `BriefFiling`, placed after the levels errors and before `scope`, newest first. A-share alerts are listed too: the brief's prices stay US, its alerts are the day's.
- **Produces, `desk/STANDING.md`:** the old Task 9's item 4 and closing rule, verbatim.
- **Produces, `desk.ts`:** `watchLines(w: WatchStatus, now: Date): string[]`, appended by `deskStatusLines` after P2's lines:
  - `watch: <starting | nothing to watch | stopped | another face (pid <n>) holds the watch on this home | watching>`;
  - per market with a source: `watch <US | A shares>: <no calendar today | closed today | the <date> session opens at <HH:MM ET> | polling the <date> session, <n> symbols, last poll <HH:MM ET> | the <date> session has closed>[; not watched: <k>][; <lastError>]`;
  - `alerts today: …` and `alerts: muted until …`, as the old Task 9;
  - `filings: <off | off: set ALPHA_EDGAR_USER_AGENT | polling, <n> symbols, last poll <HH:MM ET>[, <k> errors] | off until tomorrow: SEC refused the requests>`;
  - `watch files refused: …`, as the old Task 9.
- **Produces, `desk-tools.ts`:** `STATE_SCHEMA` gains `watch: { type: "object" }`.

- [ ] **Step 1: Write the failing tests** — the old Task 9's `brief.test.ts`, `desk.test.ts`, `service.test.ts` and `desk-tools.test.ts` cases, with these expected lines in `watchLines`:

```ts
// → ["watch: watching", "watch US: polling the 2026-11-30 session, 12 symbols, last poll 10:21 ET",
//    "watch A shares: the 2026-12-01 session opens at 20:30 ET", "alerts today: 5 sent, 3 suppressed (cap 2, muted 1), 4 repeats in a cooldown, 2 held for the next hour's batch",
//    "alerts: muted until 12:00 ET (npm run desk -- unmute)", "filings: off: set ALPHA_EDGAR_USER_AGENT", "watch files refused: desk/levels.yml 2 of 9"]
```

- [ ] **Step 2–4:** `cd face && npx tsx --test tests/brief.test.ts tests/desk.test.ts tests/service.test.ts tests/desk-tools.test.ts` FAIL, then implement, then PASS with `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** — the files above, message `feat(face): the watch made visible on the server - alerts and filings in the brief, the status lines, desk_state's watch block`.

---

### Task 11: The Markets screen's Desk view and level marks (M1)

**Files:**
- Create: `face/client/js/host/desk-view.js`, `face/client/js/host/desk.js`, `face/client/js/reducers/desk.js`, `face/client/js/render/desk.js`, `face/tests/client/desk-view.test.js`, `face/tests/client/host-desk.test.js`
- Modify: `face/client/js/host/market-view.js` (`tabsOf`), `face/client/js/reducers/markets.js` (`TABS`), `face/client/js/reducers/index.js`, `face/client/js/render/markets.js` (the tab, the row mark, the page's plan), `face/client/js/app.js` (starts `startDesk` beside `startMarkets`), `face/client/css/app.css`, `face/tests/client/markets.test.js`, `face/tests/client/market-view.test.js`

**Interfaces:**
- **Consumes:** `GET /data/desk/status` (`DeskStatus`, with Task 9's `watch` and P2's `standing`); `POST /data/desk/pause` (`{ until? }` → `{ off }`); the Markets store's `markets.tab`; row ids `stock:<SYM>` and `cn:<6>`.
- **Produces, `host/desk-view.js`** (pure):
  - `DESK_TAB = 'desk'`; `DESK_POLL_MS = 10_000`.
  - `deskViewOf(status, nowIso) → { head; off?; telegram; budget; markets: { name; line }[]; filings; today; alerts: { when; what; outcome; latency }[]; standing: { id; anchor; next; hash; last }[]; files: { file; note }[] }`. Its texts are Task 10's `watchLines` phrases and P2's `standingLines` phrases, re-spelt here, never sent from the server as prose. `when` is New York `HH:MM`, dated on another day; `latency` is `1.8 s` or `—`.
  - `markOf(status, rowId) → { label: string; plan: string; file: string } | null` — `stop 170 · -1.3%` from `status.watch.marks`, matching `stock:NVDA` to US NVDA and `cn:600519` to the A share; `null` without one.
- **Produces, `host/desk.js`:** `startDesk({ store, getJson, postJson, schedule, cancelTimer, now })` reads the status once Markets shows the Desk tab, then every `DESK_POLL_MS` while it shows, and stops when it leaves. `pause()` posts `{}` and then reads again. Nothing touches the DOM.
- **Produces, `reducers/desk.js`:** `deskLoading`, `deskLoaded({ data, at })`, `deskFailed({ at, message })` and `pauseAnswered({ off })`, all on `s.desk`.
- **Produces, `render/desk.js`:** `renderDeskTab(view)` — string HTML in the app's render style, with one **Pause** button and no Resume, since the phone and the page only pause (spec §5.7).
- **Produces, Markets:** `tabsOf` lists **Desk** last. A row whose `markOf` is non-null shows a small mark after its name, and a market's page shows the mark's plan and file under its price.

- [ ] **Step 1: Write the failing tests**

```js
// face/tests/client/desk-view.test.js
test('deskViewOf renders the head, both markets, today\'s alerts with their latency, standing orders and the refused files in ET', () => { /* a fixture DeskStatus */ });
test('markOf matches stock:NVDA and cn:600519 to their marks and nothing else', () => {
  assert.deepEqual(markOf(STATUS, 'stock:NVDA'), { label: 'stop 170 · -1.30%', plan: 'sell half on a close below 170', file: 'desk/levels.yml' });
  assert.equal(markOf(STATUS, 'coin:BTC'), null); assert.equal(markOf({ ok: true }, 'stock:NVDA'), null);
});
// face/tests/client/host-desk.test.js
test('the Desk tab reads the status at once and every 10 s while shown, and stops when it leaves', () => { /* fake schedule */ });
test('Pause posts once and reads the status again; a failed read keeps the last view with its message', () => { /* … */ });
// face/tests/client/markets.test.js (append): the Desk tab is listed last; a marked row draws its mark; a page draws the plan
```

- [ ] **Step 2: Run them to verify they fail** — `cd face && npx tsx --test tests/client/desk-view.test.js tests/client/host-desk.test.js tests/client/markets.test.js tests/client/market-view.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the four modules, the tab, the marks and the CSS.
- [ ] **Step 4: Verify.** First `npm test && npm run typecheck`. Then the browser check:
  - **The face.** A scratch face from the worktree: `FACE_PORT=3191`, a scratch `DSH_HOME` under `face/tests/tmp/`, `FACE_ACCOUNT_URL=http://127.0.0.1:9`, no Telegram names, no `ALPHA_EDGAR_USER_AGENT`, never `~/.dsh`.
  - **The seed.** In the scratch home: an `alerts.jsonl` (one US alert sent, one A-share alert sent, one capped, one muted), a `MUTE`, and a `desk/levels.yml` with one refusal and no A share, so Tencent is never asked.
  - **The check.** Open the printed URL and hard-reload. Markets › Desk shows the head, both markets' lines, `filings: off: set ALPHA_EDGAR_USER_AGENT`, the alerts and the refused file. A marked row draws its mark. Take a screenshot.
- [ ] **Step 5: Commit** — the files above, message `feat(face): the Desk view inside Markets - status, standing orders, the watch, today's alerts, a level's mark on its row and page`.

---

### Task 12: `watch-smoke` and the canary's annotation half

**Files:**
- Create: `face/tests/watch-smoke.test.ts`

**Interfaces:**
- **Consumes:** everything above; `setupFaceProfile`, `bootFace`, `StubAdapter` (with `desk-smoke`'s usage set), `populateBotsRoot`, `GRAVIT_PLUGIN_ABS`, `installModelSelection`, `desk-fakes.ts`.
- **The scaffold:** the old Task 10's, with these changes.
  - **Sources.** The hub is two fakes: a `UsQuoteSource` and a cn snapshot hub over in-memory tables. No `createQuoteHub`.
  - **Books.** `holdings.yml` adds `600519`, and `levels.yml` adds a `600519` stop.
  - **Filings.** `watchRow: { calendars, clock: wall, tickMs: 86_400_000, edgar: { fetch: fakeEdgar, userAgent: "smoke@example.invalid" } }`. The fake `EdgarFetch` serves a ticker map and one submissions body; nothing reaches the network.
- [ ] **Step 1: Write the smoke** — one boot, these cases in this order:
  1. **Before the open.** A 14:25Z tick polls no US symbol, because the window opens at 14:20Z (the open minus 10 minutes). A 14:21Z tick polls, and an NVDA print timed 14:29:59Z makes no record.
  2. **A US gap.** NVDA 168.50 at 14:30:01Z gives one `alert` (`gap`) and one `delivered`. The message opens `NVDA 168.5 · Account ROBINHOOD 09:30:01 ET` and ends `annotation follows`. The stub sees `[alert · NVDA · stop]` and answers as a reply.
  3. **A restart.** Re-install the watch: NVDA 168.40 makes no record.
  4. **The cooldown.** NVDA 171, then 169.5 inside 30 minutes, makes no record; `repeats` is 1.
  5. **The cap and the batch.** Six sends; the seventh is recorded `suppressed: cap`; at 15:00:05Z the batch line goes.
  6. **An A share.** `wall.set("2026-12-01T01:29:00Z")`; 600519 below its stop at 01:30:02Z (09:30:02 Beijing) gives a `gap` alert opening `600519 … · Tencent 09:30:02 Beijing`. A print at 03:45Z (lunch) makes none.
  7. **A cut and a failed model call:** the old case 7.
  8. **The phone's state:** the old case 8; the state names both NVDA and 600519.
  9. **A filing.** The first due poll at 07:00 ET seeds silently. The fake then adds an 8-K accepted 10:05:12 ET, and a poll 5 minutes later sends `NVDA 8-K · accepted 10:05:12 ET · …`. `600519` is never fetched.
  10. **The canary's annotation half:** the old case 10, unchanged.
- [ ] **Step 2: Run it** — `cd face && FACE_SMOKE=1 npx tsx --test tests/watch-smoke.test.ts`. Expected: PASS. A failure is fixed in the task that owns the behaviour.
- [ ] **Step 3: Run the whole suite with the real boots** — `FACE_SMOKE=1 npm test`. Expected: every file green, one real boot more than before.
- [ ] **Step 4: Commit** — `face/tests/watch-smoke.test.ts`, message `test(face): watch-smoke - a US and an A-share gap, restart, cooldown, cap and batch, a cut and a failed annotation, the phone's state, a filing, the canary's annotation half`.

---

### Task 13: The documents and the charter

**Files:**
- Modify: `Gravit-Design.md`, `DEVELOPMENT.md`, `face/README.md`, `CLAUDE.md`, `ROADMAP.md`, `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md`. Not `Gravit-Docs-and-Prompt-Loops.html` (P4-7).

- [ ] **Step 1: `Gravit-Design.md`.**
  - **§3:** the watch row; the A-share hub shared by the Markets screen and the desk.
  - **§4, the write map:**
    - `watch.ts` writes `alerts.jsonl`, `filings.jsonl`, `watch.lease` and its events;
    - `telegram.ts` writes `MUTE`;
    - the operator writes `rules.yml`.
  - **D17 and D18:** `/mute` from the phone, with what holds it (a required duration, never shortened from the phone, no phone unmute).
  - **D23:** it now also names the watch as a reader of the Account's market read, polled every 20 s.
  - **New row D28**, in the D20 role of the old plan:

    | D28 | A strategy's `levels.yml` sits in a directory its research sessions can write, and the watch sends its plans verbatim | the load caps, the alert caps, and the watch's `changed (sha256 <8 hex>)` line for every levels file it re-reads | the first levels change the operator did not make; P4 pins each strategy's `levels.yml` for that strategy's own firings |

  - **D26:** it names `edgar.ts` among the face code it covers (M2).
- [ ] **Step 2: `DEVELOPMENT.md`.**
  - **The module table:** `watch.ts`, `watch-eval.ts`, `alert-text.ts`, `edgar.ts`, `filings.ts` and `xshg-clock.ts`, and the changed rows for `desk-book.ts`, `desk-tools.ts`, `brief.ts`, `market-clock.ts` and `main.ts`.
  - **The desk files:** `alerts.jsonl`, `filings.jsonl`, `MUTE` and `watch.lease`.
  - **The env table:** `ALPHA_EDGAR_USER_AGENT`, now read by `watch.ts`.
  - **§5:** the Desk view in Markets.
  - **§7:** `watch-smoke`, fresh counts and the drill's P3 row.
  - **§10:** the desk item.
  - **§9 residuals, from R68:**
    - the US latency floor, the 20 s explore cache plus the reads;
    - a delayed US feed's alert lags its print;
    - `prev_close` is `price − change24h`, the Account's own;
    - first-observation semantics after a restart;
    - repeat counts are lost on a restart;
    - a mid-day `alerts.jsonl` rotation can fire a `gap` twice;
    - the SEC `Z` reading;
    - each filings poll downloads whole submissions JSON;
    - Telegram's flood limit can unthread a burst;
    - an annotation queued behind a long phone turn arrives late;
    - two desk-enabled faces with one token;
    - the XSHG table ends 2026-12-31, and extending it is a code edit;
    - A-share session edges rest on Tencent's word plus the Beijing clock;
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
    2. The same for an A share during Beijing hours: within 25 s.
    3. The annotation arrives within 90 s, as a reply.
    4. Send `/mute 30m`: a crossing is recorded muted. Then run `npm run desk -- unmute`.
    5. Run `npm run desk -- rearm preclose`.
    6. Set `ALPHA_EDGAR_USER_AGENT` and restart. Compare one filing's accepted time with its EDGAR index page (ruling 9), and record one poll's wall time and bytes.
- [ ] **Step 4: `CLAUDE.md`.** The desk row names `face/src/{watch,watch-eval,alert-text,edgar,filings,xshg-clock}.ts`, `desk/rules.yml` and the Desk view. The tests row's real-boot count follows a fresh `FACE_SMOKE=1 npm test`.
- [ ] **Step 5: `ROADMAP.md` and the spec.** ROADMAP: P0–P3 built, P4 to come, and the P3 entry. Under the spec's §5.5, an "As built (P3)" note pointing at §15 and naming:
  - the polled cadences;
  - the per-market judgement;
  - `move_pct` from the previous close;
  - `kind:` and `symbols:`;
  - halts refused;
  - one annotation per pass;
  - `/mute`;
  - filings in Node.
- [ ] **Step 6: Verify and commit** — `cd face && npm test && npm run typecheck`, then `FACE_SMOKE=1 npm test`; every count in the documents matches the run. Commit the six documents with `docs: the desk P3 - the watch in both markets, rules.yml, alerts, annotations, mute, filings in Node, the Desk view in Markets; charter D28`.

---

## Pre-flight conflict scan

### A. Task pairs that share a file or an interface

| Pair | Shared | Note |
|---|---|---|
| T1→T3, T5, T8, T9 | `Market`, `marketOf`, `Level.market`, `Holding.market` | the loaders set `market`; nothing else marks it (M3) |
| T1/T2 | `desk-tools.ts` | T1 adds `bjClock` locally, and T2 moves it to `xshg-clock.ts` — sequential |
| T1/T3/T10 | `brief.ts` | T1 `aShares` and `scope`, T3 the import of `levelDistancePct`, T10 the blocks — sequential and disjoint |
| T1/T9 | `desk.ts` `installDesk`, `main.ts` | T1 `cnHub` to the tools; T9 `cnHub` and `watchRow` to the watch — sequential |
| T2→T5, T7, T9 | `bjDate`, `bjClock`, `DeskCalendars`, `deskCalendars`, `XSHG_COVERED` | the watch's cn window and the stamps |
| T3→T5, T8, T9 | `Rule`, `resolveSymbols`, `levelDistancePct`, `loadRules` | |
| T4→T9 | `appendChain`, the file names, the mute, `watch-load` | |
| T4/T9/T10 | `desk.ts` | sequential, disjoint regions |
| T5→T7, T9, T10 | `WatchQuote`, `AlertHit` (with `market`, `date`), `QuoteSnap` (`source`), the evaluator, `rebuildDay` | |
| T6→T7, T9, T12 | the `DeskSource` forms, `post`'s `replyTo`, `setState`, the per-source end lines | |
| T7→T9, T10, T11 | `alertText`, `WATCH_LINES`, `priceStamp` | T11 re-spells the phrases on the client |
| T8→T9, T12 | `createEdgar`, `EdgarFetch`, `filingSymbols`, `diffFilings`, `pollDue` | the smoke's fake fetch |
| T9→T10, T11 | `WatchStatus` (`markets`, `marks`, `filings`), `DeskStatus.watch`, `AlertSummary` | |
| T9→existing callers | `installDesk`, with `cnHub` and `watchRow` optional | no book means `idle` |

### B. Each task against itself

- **T1:** quoting `"600519"` is required; an unquoted one is refused, not coerced.
- **T2:** the copy is pinned to the plugin's JSON by a test, and the face imports nothing from `plugins/`.
- **T5:** `judgedDate` alone decides what is judged.
- **T9:** sends go before posts; at most one poll per market is in flight; filings fetch only with `edgar`.
- **T11:** no prose comes from the server; Pause is the only write.
- **T12:** no network, and a fake EDGAR throughout.

### C. P3 changes to P1 and P2 files

| P3 task | P1/P2 file | Collision |
|---|---|---|
| T1 | `desk-book.ts`, `desk-tools.ts`, `brief.ts`, `main.ts` | the symbol grammar widens; `notYet` becomes `scope` |
| T2 | `market-clock.ts` | `dateOf` and `deskCalendars` are additions; the US default is unchanged |
| T4 | `desk.ts`, `scripts/desk.ts`, `desk-cli.test.ts`, `telegram.ts` | additions; the usage line grows |
| T6 | `desk-session.ts`, `desk-conversation.ts`, `desk.md`, `cycle.test.ts` | as the old T5 |
| T9 | `installDesk`, `desk-weight.test.ts` | optional deps; one calendar per market; the bridge in the dispose order |
| T10 | `brief.ts`, `STANDING.md`, `schedule.ts`, `deskStatusLines`, `service.test.ts` | the armed `preclose` must be re-armed |
| T11 | `market-view.js`, `reducers/markets.js`, `render/markets.js`, `app.css` | one tab and one mark added |
