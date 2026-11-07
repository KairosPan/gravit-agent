# Why it moved — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a US price move crosses a rule — in pre-market, the regular session or after-hours — the phone gets,
under the alert and within minutes, Gravit's answer in the spec's shape B: why it moved, how sure, its sources.

**Architecture:**
- **The watch widens and measures from a reference close.** US move rules judge 04:00–20:00 ET. After-hours
  measures from that day's close, pre-market and the session from the previous close; one crossing per reference
  (so one event alerts once across after-hours, the next pre-market and the next session), and outside the
  regular session a second print or two minutes. The Market makes every US row carry its change from that close,
  whoever priced it.
- **A US move alert's annotation becomes the why turn.** The watch composes a why post — the alerts, each symbol's
  Nasdaq headlines from the Market's new `GET /api/news`, its EDGAR filings of the last 24 hours, and the exact
  instruction block — folds passes that queue behind a running turn into one post, and the annotation lane runs it
  with a 240 s deadline, the reply carrying its alerts' urgency.
- **The desk alone opens pages, on the record.** The tree enables dsh's `web-fetch-http` provider but registers no
  global `web_fetch`; the face registers dsh's own tool in each desk agent's layer. Every desk fetch is a
  `desk-fetch` line in the ledger and on the Desk view, and the charter names the risk first (R1, D29).

**Tech Stack:** Node 22, TypeScript. `face/`: `node --test` via tsx. `market/`: express 4 and vitest. dsh
0.2.1-rc.5's `@deepseek-ai/dsh-tool-web` (`applyWebFetchTool`, `DEFAULT_WEB_TOOL_TIMEOUT_MS`,
`DEFAULT_FETCH_MAX_OUTPUT_CHARS`) and `@deepseek-ai/dsh-web-fetch-http` (`LOCAL_FETCH_PROVIDER_ID`). No new
dependency: the RSS is read with a small parser of its own.

**Spec:** `docs/superpowers/specs/2026-11-07-why-it-moved-design.md` — approved 2026-11-07, its §4, §5.2, §5.5 and
§5.6 corrected the same day by this plan's code check. Read it whole first. Then: the always-on spec
(`docs/superpowers/specs/2026-10-19-always-on-gravit-design.md`) §5.5 and §16 H1, `DEVELOPMENT.md`'s desk section,
`face/README.md` "The desk", and the files each task names. Out of scope: A shares, levels and filings explained,
the overnight session, the full shape's extra lines, a news screen, any order.

## Global Constraints

- **Where to work.**
  - Branch `feat/why-it-moved`, cut from local `main` at `236f4917` (equal to `origin/main` on 2026-11-07), in the
    worktree `.claude/worktrees/why-it-moved`. Its first commit adds the spec and this plan, copied in from the
    primary checkout, where both are untracked. Never push. Never `git switch` in the primary checkout.
  - The primary checkout holds another session's uncommitted edits (93 files on 2026-11-07, among them
    `market/src/{core,reads,mcp}.ts`, `market/src/live/*`, the face's Markets client, `DEVELOPMENT.md`,
    `face/README.md` and `CLAUDE.md`). Never touch, stash, reset or commit them. Merging this branch back is the
    operator's call, after they land.
  - Never run `npm run service`, `account:service`, `market:service`, `docker compose`, or a server outside a test.
    Never touch `~/.dsh`, `~/.buyer-agent-demo`, a real Telegram or a real Slack. Never open `.env*`,
    `~/.dsh/.credentials.yaml` or a key file.
  - No test reaches the network: Nasdaq's feed is read from Task 3's recorded fixtures, SEC through `edgar.ts`'s
    stubbed fetch, the Market through a stub.
  - `FACE_SMOKE=1` runs from the worktree, outside `/tmp` and `$TMPDIR`.
- **Commits.** Write each message to a file in the session scratchpad and commit with `git commit -F <its literal
  absolute path>`. No backticks, no `$()`, no shell variables, no attribution lines. English. Each task's last step
  gives the message's first line; the body says what changed and why.
- **Suites, green after every task.** `cd face && npm test && npm run typecheck`; and `cd market && npm test &&
  npm run typecheck` in a task that touches `market/`. `cd face && FACE_SMOKE=1 npm test` after Tasks 1, 9 and 10.
  Record each suite's counts at the start of Task 1. Known flakes — rerun alone before calling one red: face
  `lunhui-market`, `annotator`, `order-gate-midboot-smoke`, and producer's "aborted run". One face test file:
  `cd face && npx tsx --test tests/<file>`; one market file: `cd market && npx vitest run test/unit/<file>`.
- **Size budgets.** `dsh/profile/desk.md` ≤ 3,000 bytes (2,620 now; `tests/cycle.test.ts`). `GRAVIT.md` is not
  edited.
- **Copy.** The alert text stays English. The why reply is the model's, in Chinese, shaped by Task 4's
  `WHY_INSTRUCTIONS`. The four certainty labels, verbatim everywhere: `公司公布 · 确定`, `媒体报道`,
  `媒体解读 · 公司没发公告`, `没找到明确原因`.
- **Names fixed by this plan.**
  - The ledger event `{ t: string; kind: "desk-fetch"; sessionId: string; url: string }`;
    `DeskStatus.fetchesToday: { t: string; sessionId: string; url: string }[]`; `DESK_FETCH_URL_MAX = 2_000`.
  - The rule key `sessions`, whose one value is `regular`; `Rule`'s `move_pct` branch gains
    `sessions: "all" | "regular"`; `PriceKey.sessions: "all" | "regular"` (`"regular"` for levels and gap keys).
  - `type UsPhase = "pre" | "regular" | "after"`; `type UsSession = MarketSession & { prev: string }` (the previous
    session's date); `usPhaseOf(asOf: number, s: UsSession): UsPhase | undefined`;
    `referenceOf(phase: UsPhase, s: UsSession): string` (`after` → `s.date`, else `s.prev`).
  - `KeyDay.ref` replaces `KeyDay.date` for the reset; `Hit` gains `ref: string`, `phase?: UsPhase`,
    `onePrint?: true`; `AlertHit` gains `ref?: string`, `phase?: UsPhase`, `onePrint?: true` (absent on old
    records).
  - `THIN_SECOND_MS = 20_000`, `THIN_ALONE_MS = 120_000`, `REBUILD_WINDOW_MS = 432_000_000` (five days).
  - The US window: from 04:00 ET of the session date to the close plus 4 h (20:00, or 17:00 on an early close).
  - `alertText`'s note gains `"why"`, whose last line is `reason follows`.
  - `type Headline = { time: string; outlet: string; title: string; url: string }`, `time` ISO UTC;
    `GET /api/news?symbols=<A,B>&since=<ISO time>` → `{ ok: true, news: Record<string, Headline[]>,
    unavailable?: Record<string, string> }`.
  - The face: `marketNews` in `face/src/market-news.ts`; `type NewsAnswer`; `whyPost`, `WhyContext`,
    `WHY_INSTRUCTIONS` and `WHY_POST_MAX = 12_000` in `face/src/alert-text.ts`.
  - `ALERT_DEADLINE_MS = 240_000`; `Annotator.idle(): Promise<void>`; the post input's `urgent?: boolean`.
- **Rulings from the code check, not to be reopened.**
  1. The desk alone gets `web_fetch`, through `applyWebFetchTool` in each desk agent's own layer. `tool-web` keeps
     `fetch: false`, so the tree registers no `web_fetch`; `web-fetch-http` is enabled and `web.fetchProvider` set
     to `LOCAL_FETCH_PROVIDER_ID`. `DESK_ALLOW` is unchanged.
  2. A `move_pct` or `gap` rule annotates by default and needs no plan. An A-share hit from such a rule with no plan
     gets no annotation. A filing rule keeps `annotate: true needs a plan`.
  3. Only US `move_pct` keys judge pre-market and after-hours. Levels, gap keys, filing rules and A shares keep
     their windows.
  4. Headlines come from Nasdaq's per-symbol RSS; not Yahoo (404 and 429 keyless), not Google News (wrapper links).
  5. A thin print waiting for its second is not recorded: a restart forgets it, and the next print starts again.
  6. `desk_state` does not show `fetchesToday` to the model.
  7. The Desk view shows an opened URL as text, never as a link.

## Review Focus

1. **A long weekend or a holiday** between an after-hours alert and the next pre-market (Friday 16:05 to Monday
   04:00; Thanksgiving Thursday closed, Friday closing at 13:00): no second alert for the same event, after a
   restart too. → Task 7 test 8, Task 8 test 3.
2. **An early-close day:** after-hours runs 13:00–17:00 and measures from the 13:00 close; the watch stops at 17:00.
   → Task 7 test 9, Task 8 test 1.
3. **The week daylight saving ends:** 04:00 ET is 08:00Z on Friday 2026-10-30 and 09:00Z on Monday 2026-11-02.
   → Task 8 test 2.
4. **A Robinhood-priced name** in pre-market, after-hours and at 09:35 before Cboe's first trade: judged against the
   right close, never silent. → Task 6 tests 1–3.
5. **Nasdaq's feed refusing or slow** (403, 429, an HTML page, no answer in 10 s): the post says headlines
   unavailable and the why turn still runs. → Task 3 test 6, Task 10 test 5.

---

### Task 1: The desk opens pages, on the record, and the charter names the risk first

**Files:**
- Modify: `face/src/policy.ts` (the three "D6 web_fetch" rows and their comment)
- Modify: `face/src/desk-tools.ts` (register `web_fetch` beside `desk_quotes` and `desk_state`; the fetch recorder)
- Modify: `face/src/desk.ts` (the `desk-fetch` member of `DeskEvent`, `KINDS`, `isDeskEvent`)
- Modify: `face/src/desk-preset.ts` (its header: what a desk turn sees, `web_fetch` and where it lives)
- Modify: `Gravit-Design.md` (R1 before §1, D25's sentence, D29, a revisit row, the status line)
- Test: `face/tests/policy.test.ts`, `face/tests/desk-tools.test.ts`, `face/tests/desk.test.ts`

**Interfaces:**
- Consumes: `applyWebFetchTool(ctx, timeoutMs, maxOutputChars)` from `@deepseek-ai/dsh-tool-web`, which needs
  `tools`, `systemPrompt` and `web` on the context it is given; `LOCAL_FETCH_PROVIDER_ID` from
  `@deepseek-ai/dsh-web-fetch-http`.
- Produces: the `desk-fetch` event, appended through `appendEvent` for every `web_fetch` call of a desk agent that
  reaches dispatch, its URL cut at `DESK_FETCH_URL_MAX`. Task 2 reads it.

- [ ] **Step 1: Record the suites' counts, then write the failing tests**

```ts
// face/tests/policy.test.ts — replaces the three D6 asserts
test("D6: the tree registers no web_fetch; the http fetch provider is on for the desk's own tool", () => {
  assert.deepEqual(patchOf("tool-web").config, { fetch: false, searchTimeoutMs: 60000 });
  assert.deepEqual(patchOf("web").config, { searchProvider: "deepseek-official", fetchProvider: LOCAL_FETCH_PROVIDER_ID });
  assert.equal(POLICY_ID_PATCHES.some((p) => p.patch.id === "web-fetch-http"), false);
});
```

In `face/tests/desk-tools.test.ts`, with the harness that registers `desk_quotes`:
- "a desk agent's own layer offers web_fetch beside desk_quotes and desk_state; another agent's offers none of
  them";
- "each web_fetch a desk agent makes is one desk-fetch line, its URL as asked, cut at 2,000 characters";
- "a web_fetch the guard refuses — a secret of the environment in its URL — writes no line, and another agent's
  calls write none".

In `face/tests/desk.test.ts`: "readEvents keeps a desk-fetch line and skips one without a sessionId or url".

- [ ] **Step 2: Run them and see them fail**

Run: `cd face && npx tsx --test tests/policy.test.ts tests/desk-tools.test.ts tests/desk.test.ts`
Expected: FAIL — the D6 assert, no `web_fetch` in the desk layer, no `desk-fetch` kind.

- [ ] **Step 3: Implement**

- `policy.ts`: `web` gains `fetchProvider: LOCAL_FETCH_PROVIDER_ID`; drop the `web-fetch-http` row; the comment
  says the provider is on so the desk's own `web_fetch` can fetch, and the tree registers none (spec §5.6).
- `desk-tools.ts`: where the desk tools go into each desk agent's own layer, also call
  `applyWebFetchTool(layer, DEFAULT_WEB_TOOL_TIMEOUT_MS, DEFAULT_FETCH_MAX_OUTPUT_CHARS)`. If that layer cannot
  reach `web`, register it through a child plugin that injects `web`. Add a root `tools/execute` listener beside
  the guard: for a desk agent (judged as `judge` judges one) and the name `web_fetch`, append the event, then call
  `next`. It sits at `execute`, not `pre-execute`, because the backstop can still deny there. Widen
  `DeskGuardCtxLike.on` for it.
- `desk.ts`: the union member, `KINDS`, and `isDeskEvent`'s check (two strings).
- `desk-preset.ts`: the header's "NO SHELL" and "WHAT THE MASK IS NOT" paragraphs name `web_fetch`, its layer and
  D29.
- `Gravit-Design.md`:
  - Insert spec §6's R1 block verbatim after the header's `---` and before `## 1.`, its "since" the date of this
    commit.
  - D25's "an unattended turn on untrusted text must not read key files and reach the network" becomes "must not
    read key files; it reaches the network only through `web_fetch` (D29)".
  - Add D29 after D28 in the debts table:
    - what is open: a desk turn opens any public page unattended, and a page's planted text can have it put what
      it reads — the book with quantities, costs and plans, the journal, the rules — into a URL;
    - what holds: the guard's read check and secret check; dsh's fetch refusing non-public addresses, credentials
      in a URL and cross-origin redirects; every fetch a `desk-fetch` line and on the Desk view; no other session
      has `web_fetch`;
    - revisit: a desk turn able to do more than inform; the book holding something worth more than its privacy;
      the first sign a page steered a turn.
  - Add a revisit-table row naming R1 and D29: "The first sign a page steered a desk turn, or the desk given a tool
    that acts" → "R1 · D29 · take `web_fetch` back out of the desk's layer".
  - The status line gains "revised 2026-11-07 for why it moved: R1, D25, D29".

- [ ] **Step 4: Run the tests, then the suites**

Run: the Step 2 command; then `cd face && npm test && npm run typecheck && FACE_SMOKE=1 npm test`
Expected: PASS, the counts up by the new tests.

- [ ] **Step 5: Commit** — `feat(face): the desk opens web pages, each on the record, and the charter names the risk first (why-it-moved task 1)`

### Task 2: The Desk view lists the pages the desk opened today

**Files:**
- Modify: `face/src/desk.ts` (`deskStatus` fills `fetchesToday`)
- Modify: `face/src/desk-tools.ts` (`desk_state` leaves `fetchesToday` out)
- Modify: `face/client/js/host/desk-view.js`, `face/client/js/render/desk.js`, `face/client/js/i18n/en.js`,
  `face/client/js/i18n/zh.js`, and the word fixtures the client tests pin (`face/tests/client/fixtures/`)
- Test: `face/tests/desk.test.ts`, `face/tests/desk-tools.test.ts`, `face/tests/client/desk-view.test.js`

**Interfaces:**
- Consumes: Task 1's `desk-fetch` event.
- Produces: `DeskStatus.fetchesToday` — today's ET date, newest first, at most 50; `deskViewOf(status, nowIso)`
  gains `pages: { time: string; url: string }[]` (`time` as `HH:MM ET`); the words `desk.tab.pages` = "Pages opened
  today" / "今天打开的网页" and `desk.tab.pagesNone` = "None today" / "今天没有".

- [ ] **Step 1: Write the failing tests**
  - `desk.test.ts`: "deskStatus lists today's desk-fetch lines newest first, at most 50, none from yesterday".
  - `desk-tools.test.ts`: "desk_state does not show fetchesToday".
  - `desk-view.test.js`: "the Desk tab lists today's opened pages as escaped text, newest first, and says None today
    when there are none". It asserts the URL's escaped text is in the HTML and no `<a` wraps it.
- [ ] **Step 2: Run them and see them fail** — `cd face && npx tsx --test tests/desk.test.ts tests/desk-tools.test.ts tests/client/desk-view.test.js`
- [ ] **Step 3: Implement** — the status field from `readEvents`; the view key; a section in `renderDeskTab` after
  the alerts; the two words in both tables, and the client fixtures that pin every word updated the way plan 7 did.
- [ ] **Step 4: Run them, then the face suite** — PASS.
- [ ] **Step 5: Commit** — `feat(client): the Desk view lists the pages the desk opened today (why-it-moved task 2)`

### Task 3: The Market's headline read

**Files:**
- Create: `market/src/live/news.ts`
- Modify: `market/src/live/public-markets.ts` (`PUBLIC_HOSTS` gains `www.nasdaq.com`, inserted before the last two,
  which `live-public-markets-location.test.ts` pins)
- Modify: `market/src/live/history.ts` (`HOST_LIMITS` gains the lane `nasdaq-www`: `{ max: 4, perMs: 2_000 }`)
- Modify: `market/src/reads.ts` (`MarketReads.news`, the route), and wherever the core's sources are composed
- Create: `market/test/fixtures/news/nasdaq-rss-INTC.xml`, `market/test/fixtures/news/nasdaq-rss-CRWV.xml`, copied
  from the probe's recordings,
  `/private/tmp/claude-501/-Users-pan-Desktop-self-evolve-gravit-agent/8e4fd7da-c23c-4124-812f-4fe60569b285/scratchpad/why-it-moved/nasdaq-rss-{INTC,CRWV}.xml`
- Create: `market/test/unit/live-news.test.ts`; Modify: `market/test/unit/reads.test.ts`

**Interfaces:**
- Produces: `Headline`; `parseNasdaqRss(xml: string, symbol: string): Headline[]`;
  `nasdaqNews(deps: PublicDeps): NewsSource`, where `NewsSource = { headlines(symbol: string): Promise<Headline[] | Refusal> }`;
  the route, as Global Constraints names it: 1 to 10 symbols, each a US ticker by the Market's own rule; `since`
  optional, an ISO 8601 time; at most `NEWS_PER_SYMBOL = 10` per symbol, each `time ≥ since`; a malformed query is
  400 `{ ok: false, error }`; a symbol whose feed refuses goes under `unavailable` with the refusal's message.
- Constants: `NEWS_URL = "https://www.nasdaq.com/feed/rssoutbound?symbol="`, `NEWS_MAX_BYTES = 524_288`,
  `NEWS_TIMEOUT_MS = 6_000`, `NEWS_KEEP_MS = 60_000`, `WRAP_TICKERS = 5`.

- [ ] **Step 1: Write the failing tests**
  1. "parseNasdaqRss reads the recorded INTC feed newest first, with exact times, outlets and nasdaq.com article
     URLs": the first item's `time` equals the feed's newest `pubDate` as ISO; times descend; every `url` starts with
     `https://www.nasdaq.com/`.
  2. "a market wrap naming more than five tickers is dropped unless the symbol leads its ticker list".
  3. "an item missing its date, title, link or outlet is skipped; the five XML entities and CDATA are decoded".
  4. "GET /api/news answers each symbol at most ten headlines since the time asked".
  5. "GET /api/news refuses a bad symbol, more than ten symbols, or a since that is not a time, with 400".
  6. "a feed answering 403, 429 or an HTML page puts its symbol under unavailable with the reason, and the others
     answer" (Review Focus 5).
- [ ] **Step 2: Run them and see them fail** — `cd market && npx vitest run test/unit/live-news.test.ts test/unit/reads.test.ts`
- [ ] **Step 3: Implement**
  - The fetch is its own text read, not `realHttp`, which cuts text at 2,000 characters and parses only JSON:
    https only, the `PUBLIC_HOSTS` check, the header `user-agent: NASDAQ_UA`, the whole body up to
    `NEWS_MAX_BYTES`, `NEWS_TIMEOUT_MS`, paced on the `nasdaq-www` lane.
  - A non-200, a redirect or a body that is not RSS maps to a refusal by `publicNo`'s rules.
  - Cached per symbol for `NEWS_KEEP_MS` through `core.cache`.
  - The parser reads each `<item>`'s `<pubDate>` (RFC 822 to ISO UTC), `<dc:creator>`, `<title>`, `<link>` and
    `<nasdaq:tickers>`.
- [ ] **Step 4: Run them, then `cd market && npm test && npm run typecheck`** — PASS; the location test's last-two
  pin still holds.
- [ ] **Step 5: Commit** — `feat(market): a keyless headline read, GET /api/news, from Nasdaq's per-symbol RSS (why-it-moved task 3)`

### Task 4: The face reads headlines and composes the why post

**Files:**
- Create: `face/src/market-news.ts`; Test: `face/tests/market-news.test.ts`
- Modify: `face/src/alert-text.ts`; Test: `face/tests/alert-text.test.ts`

**Interfaces:**
- Consumes: Task 3's route; `Filing` from `face/src/edgar.ts`.
- Produces:
  - `type NewsAnswer = { headlines: Headline[] } | { unavailable: string }`, with `Headline` redeclared in the face.
  - `marketNews(deps?: { fetch?: typeof fetch; baseUrl?: string; abortMs?: number }): (symbols: readonly string[], since: string) => Promise<Map<string, NewsAnswer>>`.
    It makes one GET of `<FACE_MARKET_URL>/api/news`, aborted at 10 s, and is mounted for no browser. A refusal, a
    non-200 or no answer marks every symbol `{ unavailable: <reason> }`.
  - `interface WhyContext { news: Map<string, NewsAnswer>; filings: Map<string, Filing[]> | { unavailable: string } }`.
  - `whyPost(hits: readonly AlertHit[], pass: string, now: number, ctx: WhyContext): { text: string; source: DeskSource; message: AlertMessageSource }`.
    Its `source` and `message` are `annotationPost`'s. Its `text`, in order:
    1. the alerts, `alertText(h, now, "none")` joined by blank lines;
    2. per symbol, `Headlines for <SYM>:` with lines `- <HH:MM ET> · <outlet> · <title> · <url>`, or `: none`, or
       `: unavailable: <reason>`;
    3. per symbol, `Filings for <SYM> in the last 24 h:` with lines
       `- <form> · items <items> · accepted <HH:MM ET> · <url>`, or `: none`, or `: unavailable: <reason>`;
    4. `WHY_INSTRUCTIONS`.

    The whole is cut to `WHY_POST_MAX` by dropping headlines, each symbol's oldest first in turn, never an alert or
    the instructions.
  - `WHY_INSTRUCTIONS`, verbatim:

```
Explain why this moved. Answer in Chinese, plain text, at most 4,000 characters. For each symbol, in this shape (a shared cause first when several moved together):
<SYMBOL> <盘前|盘中|盘后> <±x.x%> · <the cause in a few words>
<one label>
· <a fact, with its numbers>
· <a fact, with its numbers>
· <它自己|整个板块|大盘>：QQQ <±x.x%>，<its sector ETF> <±x.x%>，<two or three peers> <±x.x%>
· 计划：<the plan the alert quotes> → <满足|未满足>（<the measurement>） — only when the alert quotes a plan
来源：<outlet or filing> <HH:MM ET> · <outlet or filing> <HH:MM ET>
The label is exactly one of: 公司公布 · 确定 — the company's own filing, release or statement says what happened; 媒体报道 — a named outlet reports a concrete event the company has not confirmed; 媒体解读 · 公司没发公告 — outlets put the move down to sentiment, flows, a sector or a macro event; 没找到明确原因 — nothing fits, and then say what you checked.
For an index, name the sectors leading the move instead of peers. Price QQQ, SPY, the sector ETF and the peers in one desk_quotes call. Open a page with web_fetch when a headline is not enough. Never state a cause without a source, an outlet's claim as the company's, or an older story as today's cause, and never advise a trade.
```

- [ ] **Step 1: Write the failing tests**
  - `alert-text.test.ts`:
    1. "whyPost carries each alert, each symbol's headlines and filings, and ends with WHY_INSTRUCTIONS verbatim";
    2. "an unavailable headline or filing read is said, and the instructions still follow";
    3. "a post of twelve alerts with ten headlines each stays within 12,000 characters, dropping the oldest
       headlines first and keeping every alert";
    4. "whyPost's source and message are annotationPost's for the same hits".
  - `market-news.test.ts`:
    1. "marketNews asks /api/news once for all the symbols with since, and maps each symbol's headlines";
    2. "a 409, a 500 or no answer in 10 s marks every symbol unavailable with the reason";
    3. "a symbol the answer lists under unavailable stays unavailable".
- [ ] **Step 2: Run them and see them fail** — `cd face && npx tsx --test tests/alert-text.test.ts tests/market-news.test.ts`
- [ ] **Step 3: Implement** — `marketNews` follows `face/src/upstream-proxy.ts` `askUpstream` and `market-row.ts`
  `marketUrl()`; `whyPost` beside `annotationPost`.
- [ ] **Step 4: Run them, then the face suite** — PASS.
- [ ] **Step 5: Commit** — `feat(face): the why post - each alert's headlines from the Market, its filings and the reply's shape (why-it-moved task 4)`

### Task 5: Rules — the sessions key, a move rule's reason by default, the watch list

**Files:**
- Modify: `face/src/desk-book.ts`, `desk/rules.yml`
- Test: `face/tests/desk-book.test.ts`, and the expectations in `face/tests/watch.test.ts` whose rules now annotate

**Interfaces:**
- Produces: `Rule`'s `move_pct` branch `{ kind: "move_pct"; movePct: number; cooldownMs: number; sessions: "all" | "regular" }`;
  on `move_pct` and `gap` rules `annotate` defaults to true and needs no plan (ruling 2). Task 7 carries `sessions`
  into `PriceKey`.

- [ ] **Step 1: Write the failing tests**
  1. "a move_pct rule takes sessions: regular, defaults to all, and refuses any other value", the refusal reading
     `sessions must be regular; leave it out for all three sessions`.
  2. "sessions is not a key of a gap or filing rule", by the loader's existing wording
     (`sessions is not a key of a gap rule`).
  3. "a move_pct or gap rule annotates by default and needs no plan; a filing rule's annotate: true still needs
     one".
  4. "the shipped desk/rules.yml loads with no refusal": the want gains `watch-crwv` and `watch-intc`, `sessions:
     "all"` on the move rules and `annotate: true` on the move and gap rules.
  5. The not-a-mapping refusal's key list gains `sessions`.
- [ ] **Step 2: Run them and see them fail** — `cd face && npx tsx --test tests/desk-book.test.ts`
- [ ] **Step 3: Implement** — `sessions` in `RULE_KEYS`, `KIND_ONLY_KEYS` and `KIND_KEYS.move_pct`; parsed after
  the pct block in `ruleVerdict`; the annotate default and the plan refusal by kind.
  - `desk/rules.yml` gains `watch-crwv` (`move_pct: 8`, `symbols: [CRWV]`) and `watch-intc` (`move_pct: 5`,
    `symbols: [INTC]`).
  - Its header comment gains three facts:
    - a US `move_pct` rule also judges pre-market from 04:00 and after-hours to 20:00 ET, and `sessions: regular`
      keeps it to the session;
    - a move or gap rule's alert gets Gravit's reason unless `annotate: false`, and a plan, when given, is checked
      too;
    - this file is public, and so are the names on it.
  - Update the watch tests whose rules now annotate by default. Until Task 10, such a hit posts today's plan check;
    the branch is not merged before Task 11.
- [ ] **Step 4: Run them, then the face suite** — PASS.
- [ ] **Step 5: Commit** — `feat(face): a move rule's sessions key and its reason by default, and the watch list's first two names (why-it-moved task 5)`

### Task 6: The Market's US rows in pre-market and after-hours

**Files:**
- Modify: `market/src/live/public-stocks.ts` (and `market/src/live/us-quotes.ts` where the Robinhood line is built)
- Test: `market/test/unit/live-public-stocks.test.ts`

**Interfaces:**
- Produces: no new field. The row's existing `change24h` and `changePct24h` are now also set outside the regular
  session, measured from the reference close of `quoteAt`'s session: pre-market and regular → the previous regular
  close; after-hours → that day's regular close. Whichever source priced it. The face keeps reading
  `prev_close = price − change` (`face/src/market-quotes.ts` `usQuoteOf`).

- [ ] **Step 1: Write the failing tests**, on recorded answers in the file's style
  1. "a Robinhood-priced row in after-hours carries its change from that day's close" (Review Focus 4).
  2. "a Robinhood-priced row in pre-market carries its change from the previous close".
  3. "a Robinhood-priced row at 09:35, before Cboe's first trade of the day, carries its change from the previous
     close".
  4. "a Nasdaq-priced after-hours row keeps Nasdaq's change from that day's close".
  5. "a row whose reference close no source answers has no change, as today".
- [ ] **Step 2: Run them and see them fail** — `cd market && npx vitest run test/unit/live-public-stocks.test.ts`
- [ ] **Step 3: Implement** — a Robinhood-priced row, which has a mid of bid and ask and no change of its own, takes
  the reference close from the Market's other reads of the same symbol. The sources are Nasdaq's quote (in
  after-hours its `secondaryData` close; otherwise its change's base) or Cboe's file (`prev_day_close`; in
  after-hours the day's last regular trade). With none, the row carries no change, as today. Choose the cheapest
  reads that answer in time; say in the code which wins when they disagree.
- [ ] **Step 4: Run them, then `cd market && npm test && npm run typecheck`** — PASS.
- [ ] **Step 5: Commit** — `fix(market): a US row outside the regular session carries its change from the right close, whoever priced it (why-it-moved task 6)`

### Task 7: The evaluator in pre-market and after-hours

**Files:**
- Modify: `face/src/watch-eval.ts`; `face/src/market-clock.ts` (export `nyInstant`)
- Test: `face/tests/watch-eval.test.ts`

**Interfaces:**
- Consumes: Task 5's `Rule.sessions`.
- Produces: the Global Constraints' `UsPhase`, `UsSession`, `usPhaseOf`, `referenceOf`, `THIN_SECOND_MS`,
  `THIN_ALONE_MS`, `REBUILD_WINDOW_MS`, and `Hit` and `AlertHit` with `ref`, `phase` and `onePrint`;
  `WatchSessions.us?: UsSession`; `PriceKey.sessions`. `evaluatePass`, `rebuildDay` and `gate` keep their
  signatures.

The rules the code follows:
- **Phase.** From the print's `as_of`: `pre` from 04:00 ET of `s.date` to the open, `regular` from the open to the
  close, `after` from the close to the close plus 4 h. Any other print is not judged. `ref` is
  `referenceOf(phase, s)`.
- **Who judges which phase.** A US move key with `sessions: "all"` judges all three phases. A `"regular"` key, a
  level and a gap key judge only `regular`; a gap key's first observation stays the first regular one within
  `GAP_RULE_WINDOW_MS` of the open.
- **Reset.** A print whose `ref` differs from its key's `KeyDay.ref` starts a fresh `KeyDay` (side unknown, not
  alerted). As today, the first past print of a fresh one hits with `gap: true`.
- **Thin prints**, outside `regular` only:
  - a past print with nothing pending is held as `pending: { asOf, firstAt, quote }`, with no hit;
  - a later print with a new `as_of`, still past and at least `THIN_SECOND_MS` after the pending `as_of`, hits;
  - a print no longer past clears `pending`;
  - on every pass, before the unchanged-`as_of` skip, a `pending` older than `THIN_ALONE_MS` (by `now − firstAt`)
    hits alone with `onePrint: true`.
- **Rebuild.** `rebuildDay` takes per key the newest record's `ref` (a record without one: its `date`) with
  `alerted: true`, reading back `REBUILD_WINDOW_MS`. A-share keys keep their Beijing session date as their `ref`.

- [ ] **Step 1: Write the failing tests** — each with sessions built by the file's helpers:
  1. "a US move key judges pre-market, regular and after-hours prints; a sessions: regular key, a level and a gap
     key judge only the regular session".
  2. "after-hours measures from that day's close and starts a new crossing: a 6% fall in the session and another
     after the close alert twice, each with its ref".
  3. "one event alerts once across after-hours, the next pre-market and the next session".
  4. "a key first judged already past its threshold hits at that print with gap: true, its ref and its phase".
  5. "outside the regular session a move hits on a second distinct print 20 s or more after the first; a print back
     under the threshold clears the first; the same as_of again does not count".
  6. "a lone print past the threshold hits alone after 2 minutes with onePrint: true".
  7. "a gap rule never judges a pre-market print".
  8. "rebuildDay keeps a crossing from Friday's after-hours to Monday's pre-market, and from Wednesday's after-hours
     across Thanksgiving to Friday's early close" (Review Focus 1).
  9. "on an early-close day after-hours runs 13:00 to 17:00 and measures from the 13:00 close" (Review Focus 2).
  10. "a record without ref rebuilds by its date, as before".
- [ ] **Step 2: Run them and see them fail** — `cd face && npx tsx --test tests/watch-eval.test.ts`
- [ ] **Step 3: Implement** — `usPhaseOf` and `referenceOf` beside `judgedDate`; `KeyDay`'s `ref` and `pending`;
  the pass loop's order as the rules above say; `priceKeys` carries `sessions`.
- [ ] **Step 4: Run them, then the face suite** — PASS.
- [ ] **Step 5: Commit** — `feat(face): the watch's evaluator judges US moves in pre-market and after-hours, one crossing per reference close (why-it-moved task 7)`

### Task 8: The watch's US window and the alert's words

**Files:**
- Modify: `face/src/watch.ts`, `face/src/alert-text.ts`
- Test: `face/tests/watch.test.ts`, `face/tests/alert-text.test.ts`, `face/tests/market-clock.test.ts` if a clock
  helper is added

**Interfaces:**
- Consumes: Task 7.
- Produces:
  - The US window: polls on `WATCH_US_POLL_MS` from 04:00 ET of the session date to the close plus 4 h.
  - The session handed to `evaluatePass` as `{ ...session, prev }`, `prev` being the session before it in the
    calendar's window.
  - The rebuild reads `alerts.jsonl` back `REBUILD_WINDOW_MS`; the reply context keeps its 48 h `MEMORY_MS`.
  - `alertText(hit, now, note: "why" | "follows" | "budget" | "none")`, its move line by phase:
    - regular, as today: `day: -6.1% from the previous close 92.07`;
    - pre-market: `pre-market: -25.0% from the 2026-10-29 close 92.07`;
    - after-hours: `after hours: -23.8% from today's close 92.07`;
    - a one-print alert adds the line `one print: no second print within 2 minutes`;
    - note `"why"` ends `reason follows`.
  - The watch gives `"why"` to a sent US move or gap hit whose key annotates, `"follows"` to another annotated hit
    with a plan, and `"budget"` or `"none"` as today. Which hits are posted is Task 10.

- [ ] **Step 1: Write the failing tests**
  1. "the US watch polls from 04:00 ET to 20:00 ET on a session day, and to 17:00 ET on an early close". This
     replaces the 14:20Z first-poll expectation.
  2. "in the week daylight saving ends, the first US poll is 08:00Z on Friday 2026-10-30 and 09:00Z on Monday
     2026-11-02" (Review Focus 3).
  3. "a restart at Monday 04:00 remembers Friday's after-hours alert and stays quiet".
  4. "an after-hours alert names today's close, a pre-market alert names its reference date's close, and a
     one-print alert says so".
  5. "the why note ends reason follows".
- [ ] **Step 2: Run them and see them fail** — `cd face && npx tsx --test tests/watch.test.ts tests/alert-text.test.ts`
- [ ] **Step 3: Implement** — the window at `marketStep`'s US branch, `nyInstant` from Task 7; `prev` from the
  calendar; the rebuild's read-back apart from the context's memory; the words in `alertText`.
- [ ] **Step 4: Run them, then the face suite** — PASS.
- [ ] **Step 5: Commit** — `feat(face): the watch's US window runs 04:00-20:00 ET, and an alert names its session and its close (why-it-moved task 8)`

### Task 9: The annotation lane — 240 s, idle, and the reply's urgency

**Files:**
- Modify: `face/src/desk.ts` (`ALERT_DEADLINE_MS`), `face/src/annotator.ts`, `face/src/desk-conversation.ts` (the
  post input's type)
- Modify: `Gravit-Design.md` §1's sentence on unattended turns
- Test: `face/tests/annotator.test.ts`, `face/tests/desk.test.ts`

**Interfaces:**
- Produces:
  - `ALERT_DEADLINE_MS = 240_000`, so the making bound and the watchdog become 300 s.
  - `Annotator.idle(): Promise<void>`. It resolves once no post is running or waiting in the annotator's chain: at
    once when idle, and at once after `dispose`.
  - The post input's `urgent?: boolean`. The reply goes with `{ kind: urgent ? "urgent" : "alert", replyTo }`;
    today it always goes `alert`.

- [ ] **Step 1: Write the failing tests**
  - `desk.test.ts`: `assert.equal(ALERT_DEADLINE_MS, 240_000)`.
  - `annotator.test.ts`:
    - its 90 s and 150 s expectations become 240 s and 300 s;
    - "idle resolves at once with nothing posted, waits for a running post's delivered reply, and for a queued
      one";
    - "an urgent post's reply goes urgent; another's goes alert".
- [ ] **Step 2: Run them and see them fail** — `cd face && npx tsx --test tests/annotator.test.ts tests/desk.test.ts`
- [ ] **Step 3: Implement**, and update `Gravit-Design.md` §1. Its "the watch's annotation of an alert that a level
  or rule asking for one raised, under a 90 s deadline" becomes "the watch's annotation of an alert that a level or
  rule asking for one raised — for a US price move, why it moved — under a 240 s deadline".
- [ ] **Step 4: Run them, then the face suite and `FACE_SMOKE=1 npm test`** — PASS.
- [ ] **Step 5: Commit** — `feat(face): the annotation lane gives a turn 240 s, says when it is idle, and replies with its alerts' urgency (why-it-moved task 9)`

### Task 10: The why post in the watch

**Files:**
- Modify: `face/src/watch.ts`, `face/src/desk.ts` (wiring the news client, the annotator's `idle` and the watch's
  EDGAR reader), `dsh/profile/desk.md`
- Test: `face/tests/watch.test.ts`, `face/tests/cycle.test.ts`, `face/tests/desk-session.test.ts`,
  `face/tests/watch-smoke.test.ts`

**Interfaces:**
- Consumes: Task 4 (`marketNews`, `whyPost`), Task 8 (the `"why"` note; `ref` and `phase`), Task 9 (`idle`,
  `urgent`), and `Edgar.recentFilings(symbols, forms, since, { stopAfterMs, signal })` on the watch's own `Edgar`.
- Produces: `WatchDeps` gains `news?: (symbols: readonly string[], since: string) => Promise<Map<string, NewsAnswer>>`
  and `idle?: () => Promise<void>`.

How it behaves:
- **What is posted.** A sent hit whose key annotates. A post with any US move or gap hit is a why post; any other
  post is `annotationPost`, as today. An A-share move hit from a rule with no plan is not posted.
- **Folding.** `queuePost` puts `{ pass, hits, replyTo, urgent }` on a buffer, drained by one loop at a time:
  1. `await deps.idle?.()`;
  2. take the whole buffer;
  3. compose one post over all its hits: the first entry's pass and `replyTo`, `urgent` if any entry's is;
  4. post it, and record one annotation naming every alert id;
  5. go round again while entries wait.

  No wait comes before the first post. A batch the hourly cap held gets no post.
- **The context.**
  - Headlines for the post's US symbols, since the earliest of their reference closes (that session's close instant
    from the calendar).
  - Filings: `recentFilings(symbols, ["8-K", "8-K/A"], <the ET date before today>, { stopAfterMs: 10_000 })`, kept
    when accepted within 24 h. With no SEC contact, the filings are
    `{ unavailable: "no SEC contact: ALPHA_EDGAR_USER_AGENT is not set" }`.
  - Each read is bounded at 10 s, and a failure is said in the post.
- **`desk.md`.** The `[alert ·` and `[alerts ·` lines and the line on alert checks become these three, the file
  staying within 3,000 bytes:
  - `- [alert · <symbol> · <rule>] is an alert the face has already sent. When it brings headlines and a shape,
    explain the move in that shape; check any plan it quotes.`
  - `- [alerts · <n> · <HH:MM ET>] is several alerts the face has already sent at once. Answer them in one reply, a
    shared cause first.`
  - `- A plan check quotes the plan and states each condition as met or not met with its measurement. The decision
    is the operator's.`

- [ ] **Step 1: Write the failing tests**
  1. "a US move alert's post is a why post: its alert, its headlines since its reference close, its filings of the
     last 24 hours and the instructions".
  2. "an A-share move alert from a rule with no plan gets no post; a level alert's post is the plan check as
     before".
  3. "passes that come while a turn runs are folded into one post when the lane is idle, and share one annotation
     record".
  4. "alerts the hourly cap batches get no post".
  5. "a headline read that fails or times out leaves the post saying headlines unavailable, and the post still
     goes" (Review Focus 5).
  6. "a filings read with no SEC contact, or one that fails or passes 10 s, is said in the post, and the post still
     goes".
  7. In `cycle.test.ts`, "the shipped desk.md fits 3,000 bytes" still passes with the new lines. The phrases it and
     `desk-session.test.ts` require stay.
- [ ] **Step 2: Run them and see them fail** — `cd face && npx tsx --test tests/watch.test.ts tests/cycle.test.ts tests/desk-session.test.ts`
- [ ] **Step 3: Implement** — `queuePost`'s buffer and drain; the post's choice and context; the wiring in
  `installDesk`; `desk.md`.
- [ ] **Step 4: Run them, then the face suite and `FACE_SMOKE=1 npm test`** — PASS. `watch-smoke` keeps its 1.5 s
  deadline.
- [ ] **Step 5: Commit** — `feat(face): a US move alert's annotation is the why turn - headlines, filings and the shape, passes folded while a turn runs (why-it-moved task 10)`

### Task 11: The documents

**Files:**
- Modify: `DEVELOPMENT.md`, `face/README.md`, `CLAUDE.md`, `Gravit-Docs-and-Prompt-Loops.html`, `ROADMAP.md`,
  `Gravit-Design.md` (D23; the status line), `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` (a
  dated pointer under §16)

- [ ] **Step 1: Write them** — what each file says, in its own register:
  - **`DEVELOPMENT.md`'s desk section:**
    - the why turn: which alerts, the post, folding, 240 s;
    - the desk's `web_fetch` in its layer and the `desk-fetch` line, and the Desk view's pages;
    - the US window, references and the second-print rule;
    - the Market's `/api/news`;
    - a why turn's tokens count in the day's budget (`standing.yml` `budget.dailyTokens`);
    - residuals: R1 and D29, and the headline lag not yet measured.
  - **`face/README.md` "The desk"**, in the operator's words, and a new "The why drill" (spec §7):
    - a real move on a watch-list name, after-hours if one comes;
    - minutes from the crossing to the reply, ≤ 5;
    - the label right, and every source opening;
    - the group line against the Markets screen;
    - one `没找到明确原因` reply;
    - the Desk view's pages;
    - the tokens one why turn spends, from the Desk view's budget line;
    - on the first live event, the lag of Nasdaq's `pubDate` behind the company's release.
  - **`CLAUDE.md`:**
    - the market row lists `/api/news` among its public reads;
    - the desk row: the watch's 04:00–20:00 ET for US moves, the why turn, the desk's own `web_fetch` on the
      record;
    - "Last reviewed 2026-11-07".
  - **`Gravit-Docs-and-Prompt-Loops.html`:** the alert loop's why post, the desk's `web_fetch`, 240 s; its update
    line.
  - **`ROADMAP.md`'s built log**, and **the always-on spec's pointer:** "Amended 2026-11-07 by the why-it-moved
    spec: the US window, the why turn, the desk's web_fetch".
  - **`Gravit-Design.md`:**
    - D23: the watch polls US shares 04:00–20:00 ET and judges a move from its reference close;
    - the status line.
- [ ] **Step 2: Run the face suite** (some tests read documents) — PASS.
- [ ] **Step 3: Commit** — `docs: why it moved - the desk, the watch's hours, the Market's headlines and the drill (why-it-moved task 11)`
