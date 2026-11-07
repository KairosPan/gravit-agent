# Why it moved — Gravit explains a big US move on the phone

**Status:** approved by the operator 2026-11-07; §4, §5.2, §5.5 and §5.6 corrected the same day by the plan's
code check (`docs/superpowers/plans/2026-11-07-why-it-moved.md`) · **Owner:** the operator ·
**Builds on:** `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` (the desk, the watch, the
annotation lane of its §16 H1) and `docs/superpowers/specs/2026-11-03-account-split-and-identity-design.md`
(the phone through the account) · **Charter:** adds the first-read risk of §6 and debt D29.

## 1. Why

The operator, 2026-11-07: when the US market, CoreWeave or Intel falls hard, Gravit should tell them why, on
its own. Twice in the last three weeks they saw the fall themselves and then asked an AI chatbot for the
reason (Intel last week, CoreWeave the week before). The pain is both halves: noticing, and having to ask.

The watch already notices. A rule in `desk/rules.yml` fires, the phone gets a numbers-only alert, and one
annotation turn follows as a reply. But that turn only checks the operator's plan and stops
(`dsh/profile/desk.md`: "An alert check quotes the plan, states each condition as met or not met with its
measurement, and stops"). Nothing looks for the cause; the desk can search but cannot open a page; and the watch
sees nothing outside 09:20–16:01 ET, which is where an earnings move happens (Intel's Q3 results came after the
close on 2026-10-29; the stock closed −28.6% the next day).

**Success:** within a few minutes of a big move — in pre-market, the regular session or after-hours — the phone
shows, under the alert, why it moved, in the shape of §5.4, with its sources and how sure the answer is; or a
plain "no clear reason found" naming what was checked. The operator no longer has to notice and ask.

## 2. What the operator decided (2026-11-07)

1. **Proactive.** The reason comes unasked, as the reply under the alert the watch already sends.
2. **Which names.** The index (SPY, QQQ — the shipped `index-move` rule, ±1.5%), the holdings (`holding-move`,
   ±4%), and a watch list of names the operator follows whether held or not, CRWV and INTC first. The watch
   list is ordinary `move_pct` rules in `desk/rules.yml`, each name with its own threshold — CoreWeave's ordinary
   day is big, so about 8% for it.
3. **Both directions.** A big rise gets its reason too (the move rules already fire either way).
4. **Hours.** Pre-market and after-hours too, not only the regular session — knowing that thin extended-hours
   prints are noisier.
5. **Speed and honesty.** Within minutes of the alert. When no cause is found, say so; never invent one.
6. **Shape B, "标准"** — chosen from three mockups (one line / standard / full, `.superpowers/brainstorm/`,
   built on the Intel 2026-10-29 and CoreWeave 2026-10-14 falls): the head line, how sure, two or three facts,
   itself or its group, the sources with their times (§5.4). Not chosen: the full version's "what it means for
   you" and "what to watch next" lines and its later follow-up message.
7. **The desk opens web pages.** Search snippets alone are not enough to explain a move, so the desk gets
   dsh's `web_fetch`, with no allow-list of sites. The operator weighed it against search only and against a
   short list of news sites, chose the open web, and asked that the risk be written at the top of
   `Gravit-Design.md` (§6).

## 3. Goals, non-goals, anti-goals

**Goals.** G1 a reason for every US price alert that asks for an annotation, under the alert, within minutes;
G2 the watch in pre-market and after-hours for US move rules; G3 the reason's shape (§5.4), its certainty label
always present; G4 the desk able to read the page behind a headline; G5 the risk of G4 named first in the charter
and every page a desk turn opens on the record.

**Non-goals.** A shares (their alerts keep today's plan check). Explaining a filing or a level hit (those keep
today's check). The full version's extra lines and follow-ups. Managing the watch list from the face's
screens (`rules.yml` stays the operator's file; the desk never writes it). The overnight session (20:00–04:00).
A news screen in the face. Any order, or any "buy" or "sell" in the reply — the desk informs (D19 to D28 hold).

**Anti-goals** — each a failure even if the message arrives on time:
- a made-up cause, or one outlet's claim stated as the company's own;
- an old story told as today's cause without saying it is background;
- a storm of reasons from single thin prints at 18:40;
- a reason that comes after the operator has already found it elsewhere (past about ten minutes it is worth
  little);
- a wall of text on a phone screen.

## 4. What the tree gives — constraints

- **The watch** (`face/src/watch.ts` over `watch-eval.ts`): it polls the Market for the book's symbols in each
  market's window — ruling 2, ten minutes before the open to a minute after the close — a US share by its
  `explore` read, cached 20 s and polled every 20 s (charter D23). Rules: `move_pct`, `gap`, `filing`, with
  `symbols` (`holdings`, `levels`, a list), `cooldown`, `annotate`, `urgent`, `plan` (`face/src/desk-book.ts`). A
  rule's `annotate` defaults to false and `annotate: true` needs a `plan`; a level's defaults to true. So today the
  shipped `holding-move` and `index-move` raise no annotation at all. A `move_pct` key fires once per crossing between two judged prints (ruling 1); six
  alerts an hour, the rest batched. EDGAR is polled every 5 minutes, 07:00–20:00 ET on session days, for the
  filing rule's symbols (`edgar.ts`, `filings.ts`).
- **The alert and its annotation.** The alert text is the face's own, deterministic and English
  (`alert-text.ts`). Its pass is posted to the annotation lane (`annotator.ts`): one fresh desk agent, one pass at
  a time, a deadline of 90 s (`ALERT_DEADLINE_MS` in `desk.ts`) plus `FIRING_SLACK_MS`, its final text delivered
  through the account as a reply to the pass's first alert — threaded on Telegram; on Slack the next message,
  since Slack messages carry no threads (plan B2).
- **The desk's tools** (`DESK_ALLOW`, `face/src/desk-preset.ts`, pinned by `tests/desk-preset.test.ts`): file
  read and edit inside its rules, `web_search`, `todo_write`, plus `desk_quotes` (1–20 US tickers or A shares,
  the Market's prices) and `desk_state`. No shell, no `web_fetch` — and no `web_fetch` anywhere: the tree turns it
  off (`face/src/policy.ts`, its three "D6 web_fetch" rows: `tool-web` with `fetch: false`, the `web-fetch-http`
  provider disabled), so naming it in `DESK_ALLOW` alone would expose nothing. The desk guard (`installDeskGuard`,
  `desk-tools.ts`) refuses a read outside the repository or of any dot-file, a write of an instruction file, and
  any call whose arguments carry the value of a key, password, secret or token in the face's environment.
- **`web_search`** is DeepSeek's hosted search (`@deepseek-ai/dsh-web-search-deepseek`, through
  `api.deepseek.com`): URLs, titles, ages and a cited snippet. How fresh it is for news minutes old is unknown.
- **`web_fetch`** (`@deepseek-ai/dsh-web-fetch-http`) fetches http(s) only, refuses a hostname that resolves to a
  loopback, private or other non-public address (the face, the account and the market on 127.0.0.1 are out of
  reach), refuses credentials in a URL, follows only same-origin redirects, and caps time (30 s) and size.
- **US prices outside the regular session exist.** The Market's US quotes (`market/src/live/us-quotes.ts`) read
  Robinhood in pre-market, the regular session and after-hours, and Nasdaq in the same three; Nasdaq's change in
  pre-market and after-hours is from the last regular close. But a Robinhood-priced row — Robinhood comes first for
  its 194 tokens — carries no change outside the regular session, nor early in it before Cboe's file has the day's
  first trade, so the watch cannot judge such a name there today. The face's quote carries no session either; the
  watch derives the phase from the print's time against its own XNYS calendar.
- **`desk.md` fits 3,000 bytes** (`tests/cycle.test.ts`); it holds 2,620.
- **The day's token budget** (`standing.yml` `budget.dailyTokens`) counts every desk turn; spent, an alert says
  so and no annotation runs.
- **Data interfaces are the Market's.** A new read of outside data goes in `market/`, keyless, behind its
  fixed-host guard (`public-markets.ts` `PUBLIC_HOSTS`), and the face reads it over `FACE_MARKET_URL`.
- **Live edits elsewhere.** On 2026-11-07 the primary checkout holds another session's uncommitted edits to
  `DEVELOPMENT.md`, `face/README.md`, `CLAUDE.md` and Market files; build in a worktree and merge after they land.

## 5. The design

### 5.1 The flow

A US price crosses a move rule's threshold → the alert goes to the phone, as today → the pass is posted to the
annotation lane with its context (§5.3) → the desk agent reads the headlines and filings, searches, opens the
pages it needs, prices the comparison set with `desk_quotes`, and writes shape B → the reply goes under the alert.
A pass with several alerts (a market-wide fall firing SPY, QQQ and CRWV together) is one post and one reply.

### 5.2 Triggers

- **The watch list** is two new rules in the shipped `desk/rules.yml` — `watch-crwv` at 8% and `watch-intc` at
  5%, both `move_pct`. `rules.yml` is tracked and the repository is public, so the names on it are public; the
  file says so in its header comment.
- **Sessions.** A US `move_pct` rule judges in pre-market (04:00–09:30 ET), the regular session and after-hours
  (16:00–20:00 ET; 13:00–17:00 on an early-close day), by default. A new optional rule key, `sessions`, takes
  `regular` to keep a rule to the regular session as today. `gap` and `filing` rules are unchanged, as are A-share
  rules and levels.
- **The reference.** Pre-market and the regular session measure from the previous regular close; after-hours
  measures from that day's regular close (the Market's `us-quotes.ts` already measures it so). A new reference
  starts a new crossing, so a name that fell 6% in the session and falls another 10% after the close alerts twice,
  each with its own reference named in the alert.
- **One event, one alert (my call).** A crossing belongs to its reference, not to the ET date. After-hours, the
  next pre-market and the next regular session all measure from the same close, so one event alerts once across
  them: Intel's fall alerts after the close on 10-29 and not again at 04:00 or 09:30 on 10-30. The crossing state is
  keyed by the reference close (its date), rebuilt from the ledger after a restart. A key first judged already past
  its threshold — the watch was down, or the rule is new — alerts at that first print, labelled `gap` as today, and
  gets its why turn like any other move.
- **Thin prints (my call).** Outside the regular session a move fires on the second distinct print (a new
  `as_of`) past the threshold, at least 20 s after the first; if no second print comes within 2 minutes, the first
  fires alone and its alert says it rests on one print. A poll that shows the same print again does not count.
- **The US window** of the watch becomes 04:00–20:00 ET on a session day (17:00 on an early-close day); the
  A-share window is unchanged. The ledger is read back five days for the crossing state, so a long weekend does not
  forget Friday's after-hours alert.
- **The Market's rows outside the regular session.** Every US row the watch reads carries its change from the
  reference close of its print's session, whichever source priced it; a Robinhood-priced row takes that close from
  the Market's other reads of the symbol.
- **Annotations on move rules (my call, after the code check).** A `move_pct` or `gap` rule annotates by default
  and needs no plan — a why turn needs none; a plan, when given, adds the plan line. An A-share hit from such a rule
  with no plan gets no annotation. A filing rule keeps `annotate: true` needing a plan. So the shipped
  `holding-move` and `index-move` get why turns with no edit, and the watch-list rules need no plan.

### 5.3 The "why" turn

- **Which alerts.** A US alert on a price move — a `move_pct` hit, labelled `gap` or not, or a `gap` rule's hit —
  whose rule asks for an annotation gets a why turn. Levels, filings and A shares keep today's plan check.
- **Folding (my call).** Passes that queue behind a running turn are folded into one post when the lane frees:
  one turn and one reply for all of them, so a market-wide fall whose names cross on different polls is explained
  together, at most one turn late. No wait is added before a post. Alerts the hourly cap holds back and later sends
  as a batch line get no why turn — by then the reason is late; the operator can still reply to ask.
- **The post** — composed by the face, in `alert-text.ts`'s style, under the alert's provenance line
  (`[alert · <symbol> · <rule>]` or `[alerts · <n> · <HH:MM ET>]`):
  - the alert text or texts, as today;
  - for each alerted symbol, its recent headlines from the Market's headline read (§5.5) since the reference
    close, each with its time, its outlet and its URL, at most ten; or `headlines unavailable: <reason>`;
  - for each alerted symbol, its EDGAR filings of the last 24 hours (form, items, accepted time, URL), looked up
    when the post is composed (`edgar.ts`), whatever the filing rule names;
  - the shape of §5.4, with its labels, and the instruction to find the cause, to check the alert's plan when it
    quotes one, and to say plainly when nothing explains the move.
- **The contract.** `desk.md`'s alert line changes from "Check the plan it quotes" to explaining the move in the
  shape the message gives, and checking the plan it quotes. The shape lives in the post, not in `desk.md`, which
  has 380 bytes left.
- **The comparison set.** The face gives the index (QQQ and SPY); Gravit picks the sector ETF and two or three
  peers and prices them all with `desk_quotes` (one call, at most 20 symbols).
- **The deadline** of an annotation turn becomes 240 s (from 90 s), the lane's other bounds scaling with it as
  `annotator.ts` derives them. One deadline for every annotation turn — a plan check finishes well inside it.
- **The alert's last line** says what follows: `reason follows` before a why turn, `annotation follows` before a
  plan check, as today.
- **Delivery, pause, mute, quiet hours and budget** are the lane's, as today. A reply carries its alert's urgency.

### 5.4 The reply's shape (B)

Chinese, plain text, one message — well inside Telegram's 4,096 characters, about 600 characters for one symbol:

```
<SYMBOL> <盘前|盘中|盘后> <±x.x%> · <the cause in a few words>
<one certainty label>
· <a fact, with its numbers>
· <a fact, with its numbers>
· <它自己 | 整个板块 | 大盘>：<QQQ ±x.x%>，<sector ETF ±x.x%>，<peer ±x.x%>…
· 计划：<the alert's plan> → <满足 | 未满足>（<the measurement>）      — only when the alert quotes a plan
来源：<outlet or filing> <HH:MM ET> · <outlet or filing> <HH:MM ET>
```

The certainty label, exactly one of:

| Label | When |
|---|---|
| `公司公布 · 确定` | the company's own filing, release or statement says what happened (results, guidance, an offering, a deal, a departure) |
| `媒体报道` | a named outlet reports a concrete event the company has not confirmed (a downgrade, a lost customer, an investigation) |
| `媒体解读 · 公司没发公告` | outlets attribute the move to sentiment, flows, a sector theme or a macro event; no event at the company |
| `没找到明确原因` | nothing fits; the reply then names what it checked — the headline read, the filings, its searches |

For an index alert the group line names the sectors leading the move instead of peers. A pass of several alerts
gets one reply: the shared cause first when there is one, then one block per symbol. Every number carries its
source and time, as the desk contract already requires.

### 5.5 The Market's headline read (new)

- A keyless read in `market/`: `GET /api/news?symbols=<A,B>&since=<ISO time>` answers, per symbol, at most ten
  headlines `{ time, outlet, title, url }`, newest first, from fixed hosts behind the Market's guard.
- **The source: Nasdaq's per-symbol RSS** (`https://www.nasdaq.com/feed/rssoutbound?symbol=<SYM>`), chosen by the
  probe of 2026-11-07: keyed by ticker, each item's exact time, outlet and a direct nasdaq.com article URL, newest
  first, with the Market's Nasdaq user-agent. Market wraps tagging many tickers are dropped. Yahoo's feeds answered
  404 or 429 keyless; Google News links are wrappers neither a fetch nor the desk can follow. How many minutes a
  headline lags a company's release is measured on the first live weekday event (§7).
- The face reads it server-side for the post only; nothing new reaches the browser, and no new seat or MCP tool.
- An outage or a slow answer (past 10 s) leaves the post saying so; the turn goes on with search and pages.

### 5.6 The desk opens pages

- **The desk alone gets it.** The tree still registers no `web_fetch`; it enables dsh's `web-fetch-http` provider,
  and the face registers dsh's own `web_fetch` tool (`applyWebFetchTool`) in each desk agent's own layer, as it does
  `desk_quotes`. Gravit's other sessions, the bots and the roles stay without it.
- **What still holds:** no shell; reads inside the repository only and never a dot-file; no call carrying a
  secret of the face's environment — so no URL carries a key; writes only in `desk/journal/`; no order tool, and
  Gate 2; `web_fetch`'s own refusal of every non-public address.
- **What is newly open:** anything a desk turn can read — the book (`desk/holdings.yml` with quantities and
  costs, every `levels.yml` with its plans), the journal, the rules, today's alerts — can be put into a URL by a
  turn that follows text planted in a page it opened, and the page's owner reads it in their logs.
- **On the record (my call):** every `web_fetch` a desk turn makes is a line in the desk's ledger
  (`events.jsonl`: the time, the turn, the URL as asked), and the Desk view lists a turn's opened pages. Nothing
  is refused for it; it is how the operator sees what was opened.

### 5.7 Cost

A why turn is a desk turn: its tokens count in the day's budget. Search, a few pages and the quotes make it
several times a plan check; the drill measures it, and the operator may raise `budget.dailyTokens`.

### 5.8 Failure behaviour

| Event | What happens |
|---|---|
| The headline read fails or is slow | the post says `headlines unavailable: <reason>`; the turn searches and opens pages |
| EDGAR does not answer | the post says so; the turn goes on |
| `web_search` or a `web_fetch` fails | the turn uses what it has; a reply short of sources names the one that failed |
| The turn passes its deadline | the lane's timed-out line, as today, with the answer so far when there is one |
| The budget is spent | the alert says so, as today; no why turn |
| The desk is paused or muted | as today |
| One thin print past the threshold after hours | no alert until a second print stands past it, or 2 minutes pass |
| Several names fire in one pass, or while a turn runs | one post, one reply |
| The same event seen again at 04:00 or 09:30 the next day | no alert: the same reference, the same crossing |

## 6. The charter

**First, before §1** — a block the operator reads before anything else, at the top of `Gravit-Design.md`:

> **Read first — the risks the operator has accepted**
>
> **R1 · The desk reads the open web unattended** (since <the build's date>; spec 2026-11-07). Desk turns — an
> alert's reason, a standing order, a phone message — can open any public web page (`web_fetch`) while nobody
> watches. A page can carry text written to steer the model; a turn that follows it could put what the desk can
> read — the book (holdings with quantities and costs, levels and their plans), the journal, the rules — into a
> URL it opens, and that page's owner would read it. Keys stay out: the desk reads no dot-file, and the guard
> refuses any call that carries a secret. Accepted because search snippets alone cannot explain a move. Every page
> a desk turn opens is in the desk's ledger and the Desk view. Revisit: when a desk turn can do anything beyond
> informing; when the book holds something worth more than its privacy; at the first sign a page steered a turn
> (D29).

**Also:** a debt row **D29** in §5's table carrying the same — what is open, what holds (the guard's read and
secret checks, `web_fetch`'s refusal of non-public addresses, the ledger lines), and the revisit triggers — and
a matching row in the revisit table. §1's sentence on unattended turns names the why turn and its 240 s deadline.
D25's "an unattended turn on untrusted text must not read key files and reach the network" is re-read: the desk
now reaches the network through `web_fetch`, and still reads no key file.

## 7. Tests, drills and what to measure

- **Unit:** the `sessions` key in the rule loader; the US window and the reference close in each session; the
  second-print rule and its 2-minute cap; a new reference as a new crossing, and one event across after-hours, the
  next pre-market and the next session as one alert (after a restart too); folding queued passes into one post;
  the post's composition (headlines, filings, the shape,
  `reason follows`); the headline read's parser on recorded answers; the `web_fetch` ledger line; the pinned
  `DESK_ALLOW`; `desk.md` still within 3,000 bytes.
- **The Market's extended-hours row:** its fix (§5.2) is tested on recorded answers; a real pre-market and
  after-hours confirm that every watched name, Robinhood-priced or not, is judged from the right close.
- **The operator's drill:** a real move on a watch-list name — after-hours if one comes — read on the phone:
  minutes from the crossing to the reply (target ≤ 5), the label right, every source opening, the group line's
  numbers matching the Markets screen. One reply with nothing to find, to see `没找到明确原因` with what it
  checked. The ledger lists the pages the turn opened.
- **Measure:** minutes to the reply, tokens per why turn, and how often the label is `没找到明确原因`.

## 8. Left to the builder

The headline parser and its wrap filter; the polling cadence outside the regular session; how the
reference close is read in after-hours if the Market's row does not carry it; the post's wording and its exact
Chinese beyond the four labels; the lane's bounds around the 240 s deadline; where in the ledger the `web_fetch`
lines go and how the Desk view shows them; the documents that follow (`DEVELOPMENT.md`, `face/README.md` "The
desk", the `CLAUDE.md` map line, `Gravit-Docs-and-Prompt-Loops.html`'s alert loop, the always-on spec's
pointers).

## 9. Calls I made, for the operator to check

1. The reply is in Chinese; the alert itself stays English, as today.
2. Only US price-move alerts (`move_pct` and `gap`) get a why turn; levels, filings and A shares keep today's plan
   check — a plan the alert quotes gets one line inside B, so a held name keeps its check.
3. Extended hours are on by default for every US move rule, `sessions: regular` turning a rule back.
4. Outside the regular session a move alerts on a second distinct print, or on the first alone after 2 minutes.
5. One event alerts once across after-hours, the next pre-market and the next session (one reference, one
   crossing).
6. Passes queued behind a running turn fold into one reply; alerts the hourly cap batches get no why turn.
7. Gravit picks the sector ETF and peers; the face gives only the index.
8. Every page a desk turn opens goes on the record, refused nothing.
9. Headlines come from a new keyless read in the Market, over Nasdaq's per-symbol RSS.
10. One 240 s deadline for every annotation turn; the cost counts in the existing daily budget.
11. The watch list starts at CRWV 8% and INTC 5%.
