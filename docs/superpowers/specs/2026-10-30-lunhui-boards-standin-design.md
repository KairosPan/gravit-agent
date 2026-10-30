# The boards stand-in: 同花顺问财 behind the Lunhui boards freeze

Status: design, 2026-10-30, awaiting the operator's approval. Branch `feat/boards-standin` from
`main` at `6ecb2e9a`. It amends the Lunhui modules design
(`2026-10-25-lunhui-modules-design.md`, §5.3, §5.6, A17, A20, A28) the way its §16 and §17 did.
A separate change of the same day moved the face's own A-share quotes from iFinD to Tencent
(`feat/quotes-tencent`, committed, not merged) so that the iFinD account's quota serves this.

## 1. Intent

The boards freeze, `lunhui_freeze_boards`, reads Eastmoney's `push2` clist three times: the concept
boards ranked by change, the members of ten of them, and the boards' fund flow. In the three live
drills of 2026-10-26, 27 and 28 that host failed every morning — three refusals a day — so the
theme module came back `NOT_EVALUABLE` every day, while the pools and the up/down distribution on
`push2ex` held. The operator's words, in order: "接 iFinD"; "在东方财富像今早那样挂掉时顶上，相当于一个
备用的MCP"; after the probe below, that on a day Eastmoney's boards fail a theme judgment on 同花顺's
concepts is acceptable — "可以，标明来源"; and the scope — "只做板块".

So: when Eastmoney's boards fail, the same freeze call lands the boards from 同花顺问财 (the iFinD
QuantAPI's `smart_stock_picking`), in 同花顺's own concept taxonomy, stated as such everywhere the
operator, Gravit or a module reads the run.

## 2. What the probe established (2026-10-30, live, the operator's account)

Twenty 问财 calls on 2026-10-30, after Friday's close (raw replies under the primary checkout's
gitignored `.superpowers/ifind-probe/out/`):

- **One call is enough.** 「A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念」 (searchtype `stock`)
  returned 5,578 rows — SH 2,318, SZ 2,905, BJ 355 — each with `涨跌幅:前复权[20261030]`,
  `成交额[20261030]`, `主力资金流向[20261030]` and `所属概念`, a `;`-joined list. Across the rows the
  list names 389 同花顺 concepts; 「人形机器人」 has 488 members by that list and 489 by its own query.
  The reply is about 1.37 MB of compact JSON.
- **No board rows.** A board-level query (「同花顺概念指数 … 上涨家数 下跌家数 领涨股」, searchtype `zhishu`)
  answers errorcode -4001, "no data."; `zhishu` changes nothing for stock wording. A board's change,
  breadth, turnover, flow and leader must be computed from its members.
- **Dates pin.** 「2026年10月29日涨停」 returned `涨停[20261029]`, the same 39 codes as Eastmoney's pool for
  that day. 今日 and 昨日 collapse onto the latest session on a weekend, so a query always names its
  date.
- **The concept lists mix themes with memberships and screens**: 融资融券, 深股通, 同花顺漂亮100,
  同花顺出海50, 2026中报预增, ST板块 and the like stand beside 人形机器人 or 白酒概念.
- **Quota.** 智能选股 is counted by call (the free tier's 4,000 a month, the permission page as read on
  2026-10-26); the access token is exchanged from the refresh token and lasts seven days.
- **The counts agree in shape** (893 up / 4,602 down against Eastmoney's 856 / 4,447 that day), and
  the pools match Eastmoney's but for ST names — facts for a later decision, not this design.

## 3. Goals, non-goals, anti-goals

Goals:

- **G1** A failure of Eastmoney's boards no longer leaves the theme module without boards when 问财
  answers.
- **G2** The source is stated wherever the run is read: the evidence rows, `run.json`, the freeze's
  reply to Gravit, the theme module's context, and the runs card.
- **G3** One freeze call, one count against the run's eight (A7), whichever source lands.
- **G4** iFinD is called only when Eastmoney failed.

Non-goals: a stand-in for the pools, the counts or the quotes (the operator: 只做板块; the quotes are
Tencent's since the quote change); iFinD's 数据 MCP for Gravit; Tushare; a mapping of 同花顺 concepts
to Eastmoney's BK codes; any change to Gravit's run protocol (`dsh/profile/lunhui-run.md`, 2,999 of
its 3,000 bytes).

Anti-goals:

- one evidence file holding both Eastmoney's and 同花顺's boards;
- a 同花顺 board read as Eastmoney's, or a members' mean read as a board index's change;
- the iFinD token reaching Gravit, a role, the browser, a log line, a refusal or any file of a run;
- a 问财 call on a run whose Eastmoney reads succeeded.

## 4. Decisions

The operator's:

| # | Decision | When |
|---|---|---|
| O1 | 同花顺's concept taxonomy is acceptable for the theme module when Eastmoney's boards fail, with the source stated | 2026-10-30, "可以，标明来源" |
| O2 | The boards freeze alone | 2026-10-30, "只做板块" |
| O3 | A stand-in, not a replacement: Eastmoney first, always | 2026-10-26, "在东方财富…挂掉时顶上" |
| O4 | iFinD's quota is kept for this; the face's quotes moved to Tencent | 2026-10-30, "照这样改" |
| O5 | Build now from `main`, not after the run view; the second to merge adds the run view's sources line | 2026-10-30, "不等，现在就建" |

The author's, each overturnable at review without redesign:

| # | Decision | Why |
|---|---|---|
| S1 | **The fallback lives inside the boards freeze.** The row reads Eastmoney as today; when any of its three reads refuses (`UPSTREAM_TIMEOUT`, `UPSTREAM_TOO_LARGE`, `UPSTREAM_INVALID`, `NO_MARKET_DATA`), the whole boards evidence comes from 问财 instead. Eastmoney's refusal is kept in the evidence as `fallback_from: { provider: "东方财富", code }` | G3, and one taxonomy per file (anti-goal 1); Gravit's protocol already calls the freeze without `boards` |
| S2 | **One 问财 call per stand-in freeze**, the query of §2 with the freeze's session date (`sessionOf`, so before 09:15 the previous session, as the pools read it), plus a token exchange when the cached access token is missing or refused | one call is the quota's cost; everything else is host code |
| S3 | **Host code derives the boards** from the members (A20: the model never derives). Eligible concepts have at least 10 members and are not on a named list of membership, index, screen and report tags kept beside the code, each entry with its reason (the builder compiles it from the 389 names the probe saw). Per eligible concept: `members`, `advancers` and `decliners` (members up and down), `pct` the members' equal-weight mean change, `amount` their turnover's sum, `leader` the member with the largest change, `mainNet` the sum of their main net flow and `mainShare` that sum over `amount`, in percent | there are no board rows (§2); the tags would top any flow ranking by sheer size |
| S4 | **The same three lists, the same bounds as Eastmoney's**: the top 30 eligible concepts by `pct`; the members of the first ten, at most 100 each, ordered by change descending, `truncated` when cut; the top 30 by `mainNet` as the flow list. The `boards` argument names Eastmoney's BK codes, which the stand-in cannot honour: it takes its own first ten and the reply says so | the file keeps its size class (≤ 256 KiB) and the theme context its shape |
| S5 | **A stand-in board's code is `THS:<concept name>`**; its members' codes are six digits, as Eastmoney's are (`603890.SH` → `603890`) | the theme and leader rules and Gravit's stock pick read codes; six digits keep the leader's membership check and the protocol's pick working unchanged |
| S6 | **Stamps.** Every stand-in item carries `provider: "同花顺问财"`, `taxonomy: "同花顺概念"`, `host: "quantapi.51ifind.com"` and `delayed: false`; a board item also `pct_basis: "equal_weight"`. The evidence meta and `run.json`'s evidence entry gain an **optional** `provider`, set by the boards freeze alone on both paths (`东方财富` or `同花顺问财`) and absent from the other sources and from older runs, where a reader takes the source's usual provider; `addEvidence` admits it, and for the stand-in `fallback_from`, the query string and a sha256 of the reply's data. The 1.37 MB reply itself is not stored | G2; only the boards can switch provider, so only they need the field (builder check Q3); the hash ties the derived rows to one reply, as the counts' hash does (§16) |
| S7 | **The theme and leader contracts accept a frozen board's code in either form**, BK or `THS:` (`lib/contracts/theme.mjs` and `lib/contracts/leader.mjs` both pin BK today, in a regex and a schema pattern). A theme candidate still cites that board's `board` and `members` items; a leader candidate's `board` may name a `THS:` board of the cited market run; a code the run did not freeze is still `REFERENCE`. Both `board` fields join the paths exempt from the wording rules, since a `THS:` code carries a concept name. `CONTRACT_VERSION` goes from 2 to 3, so the runs card shows which artifacts were written under the new rule (A19) | O1 accepts the taxonomy for the day's analysis, and the leader's hint already copies the theme's boards (builder check Q1) |
| S8 | **Where the operator sees the source.** The runs card's theme chip, and Discover's theme card and `#/module/theme` page (`/data/modules.json`), gain `· boards: iFinD (THS concepts)` when that run's boards came from the stand-in (`channels.ts` reads `run.json`'s evidence `provider`); the freeze's reply names the provider, the taxonomy and why (Eastmoney's refusal code), so Gravit's answer can say it; the theme context's `served` hint says 「板块来自同花顺问财（同花顺概念；涨跌幅为成分股等权平均，不是指数）」. The run view's sources line is §8's | O1's "标明来源", where each reader already looks (builder check Q4) |
| S9 | **Credentials.** The face process reads `IFIND_REFRESH_TOKEN` (or `IFIND_ACCESS_TOKEN`) from its environment, as the face's iFinD quotes did until 2026-10-30: the README's Run sources `../.env.ifind` again (the quote change removed that line). The access token is exchanged at `get_access_token` and cached in memory only. dsh scrubs `*TOKEN*` names from the children it spawns; the face's own CLI-agent children are scrubbed by `face/src/agents.ts`'s enumerated `SCRUBBED_ENV`, which gains both `IFIND_*` names. No token: the stand-in step is skipped without a request. Gravit's file tools and shell can still read `../.env.ifind` itself, as they can `.env.deepseek` — an accepted residual of the same kind as DEVELOPMENT's R1 for the seat key, recorded beside it | anti-goal 3 as far as env inheritance reaches; the refresh token lasts as long as the account (builder check Q5) |
| S10 | **One refusal when both fail**, naming both: Eastmoney's code and the stand-in's reason (未配置, token refused, timeout, errorcode, too large, no usable rows). `errors.mjs` gains the provider 同花顺问财. Nothing is written for the source, as today | the model retries on the code; the operator reads why |
| S11 | **Egress and bounds.** `quantapi.51ifind.com` joins the Lunhui egress table: two POST endpoints, a 15-second timeout and a 4 MiB response cap for this source alone (the others keep 7 s and 512 KiB) | the reply is about 1.37 MB and travels from China |

## 5. The flow

1. `lunhui_freeze_boards` runs as today up to the fetch: budget counted once, the run resolved, the
   calendar checked.
2. Eastmoney: the board list, then the members and the flow. All three answer → the evidence lands
   as today, now with `provider: "东方财富"` in its meta. No iFinD call.
3. Any of the three refuses → if no iFinD token is configured, refuse with both reasons. Otherwise:
   the access token (cached, or exchanged), then the one 问财 query with the session's date.
4. The reply is checked (errorcode 0, the four columns present, at least one row with a usable code
   and change); the boards, members and flow are derived (S3, S4), stamped (S6) and written as
   `evidence-boards.json` through the same `addEvidence`, with `deriveBoards`' breadth and turnover
   share over the derived boards.
5. The reply to Gravit: the run's summary as today, plus the provider, the taxonomy, Eastmoney's
   refusal code and, when `boards` was given, that it was not honoured.
6. A failure in steps 3–4 → one refusal naming both sources (S10).

## 6. Tests and documentation to pin

Offline tests, fixture-served (A15): `fixture-fetch.mjs` learns the two QuantAPI paths (a recorded
token reply and a trimmed universe reply of a few dozen rows across a handful of concepts, a
membership tag among them).

- Eastmoney answers → no QuantAPI request at all.
- The board list refuses; the members refuse; the flow refuses → each lands the stand-in's boards,
  whole, with every stamp of S6.
- Derivation: eligibility (the minimum and the named list), the three lists and their order, the
  mean, the sums, the leader, `mainShare`, the members' six-digit codes and `truncated`.
- No token → refusal naming both, and no QuantAPI request; a refused token, a nonzero errorcode, a
  timeout, an oversize reply, a reply without the four columns → refusal naming both.
- The token appears in no evidence file, `run.json`, refusal, reply or stderr line.
- One freeze call counts once whichever source landed.
- The theme contract accepts `THS:` codes the run froze and refuses one it did not; the leader
  contract accepts a `THS:` board of the cited market run and refuses one it did not freeze; a
  concept name with a scope or trading word passes in either `board` field; the leader's
  membership check accepts a stand-in member; `CONTRACT_VERSION` is 3.
- `addEvidence` accepts a meta without `provider` and one with it; a boards entry records it.
- The runs card, Discover's theme card and the module page draw the suffix for a stand-in run and
  none for an Eastmoney run or an older run.
- `scrubbedEnv` drops both `IFIND_*` names.

One live check of the stand-in path against the real QuantAPI before merge; how the builder forces
the fallback for it is the builder's (§7). Documentation: `face/README.md` ("Lunhui analysis": the
stand-in, the egress row, the two `IFIND_*` variables back in the table and the Run), `DEVELOPMENT.md`
(the freeze rows' table, refusals, egress, environment), and a revision note in the modules spec
(§18, as §16 and §17 are).

## 7. Left to the builder

The named list's contents and the minimum of 10, both adjustable with a test; the iFinD client's
module and shape under `face/plugins/lunhui/lib/`; the fixtures' contents; how `fallback_from` and
the query's record are laid out; how the live check forces the fallback (never a production switch
that skips Eastmoney); the chip suffix's exact words within the client's English; whether the
token-exchange code is shared with anything else (nothing in the face reads iFinD after the quote
change).

## 8. Coordination and order

- **The run view** (its spec of 2026-10-30, plan 1 on `main` at `6ecb2e9a`) changes
  `fixture-fetch.mjs`, records each source's refusals in `metrics.json` and freezes minute lines in
  the index and limit-up freezes; it is being built on `feat/run-view-1`, not merged. This design
  touches `fixture-fetch.mjs`, `errors.mjs`, `runs.mjs` (`addEvidence`), `freeze-boards-row.mjs`,
  `contract-core.mjs`, the theme and leader contracts, `channels.ts`, `runs-view.js`,
  `modules-view.js` and `agents.ts`. A stand-in that landed is not a refusal of the boards source;
  the run view's sources line should read `boards ✓ via iFinD`, with Eastmoney's code beside it.
  The operator: build now, from `main`, without waiting (2026-10-30, "不等，现在就建"); whichever of the
  two merges second rebases onto the other and adds that sources line.
- **The quote change** (`feat/quotes-tencent`) removed `.env.ifind` from the README's Run; this
  design puts the line back for the stand-in. Merge the quote change first.
- One plan, I expect: the iFinD client and the derivation, the row's fallback and stamps, the
  contract and the card, the documents.

## 9. Residuals

- A trial account's refresh token dies with the trial: the stand-in then refuses as "token
  refused" until the operator renews the account and the token.
- Whether 问财 serves an open session's numbers live (a run after 09:15 Beijing) is unmeasured; the
  stand-in stamps the session it asked for and its receipt time.
- `涨跌幅:前复权` is a total-return change on an ex-dividend day, not the price change Eastmoney's
  members report.
- 同花顺's concept names differ from Eastmoney's, so a stand-in day's theme candidates do not compare
  name for name with another day's.

## 10. Builder check, 2026-10-30

A fresh builder read this document and the code and asked five questions; four are settled in the
document as the author's calls, one was the operator's.

| # | Question | Settled |
|---|---|---|
| Q1 | On a stand-in day, may a leader candidate's `board` be a `THS:` code? `contracts/leader.mjs` pins BK too, and its hint copies the theme's boards | yes, S7: both contracts widen together, both `board` fields exempt from the wording rules |
| Q2 | Does this plan add `provider` to the run view, and must it wait for the run view's plan 1? | the operator: build now, no wait; the second to merge adds the sources line (§8) |
| Q3 | Does every source's evidence gain `provider`, or only boards? `addEvidence` admits only the fields it names | the boards alone, optional, S6 |
| Q4 | Should Discover's theme card and the module page show the marker too? | yes, S8 |
| Q5 | Gravit can read `../.env.ifind`; and `agents.ts`'s scrub list lacks `IFIND_*` | a residual of R1's kind, recorded; both names join `SCRUBBED_ENV`, S9 |
