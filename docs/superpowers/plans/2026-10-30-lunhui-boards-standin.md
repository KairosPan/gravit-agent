# The Lunhui Boards Stand-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When any of Eastmoney's three board reads refuses, `lunhui_freeze_boards` lands the boards from one 同花顺问财 all-market query, derived in host code and stamped as 同花顺 concepts, in the same freeze call.

**Architecture:** A new iFinD client (`lib/wencai.mjs`) fetches one universe reply; a pure deriver (`lib/wencai-boards.mjs`) turns it into the three lists Eastmoney's freeze writes; the boards row falls back to them inside its `freeze`. Contracts, the run listings and three client chips learn the `THS:` code and the `provider` stamp.

**Tech Stack:** Node 22 ESM (`.mjs` plugin rows, JSDoc types), TypeScript in `face/src`, `node --test` via tsx, recorded fixtures through `lib/fixture-fetch.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-30-lunhui-boards-standin-design.md` (S1–S11, §5, §6, §10). Read it first.

## Global Constraints

- Eastmoney first, always; no QuantAPI request on a freeze whose three Eastmoney reads succeeded (G4).
- One freeze call counts once against the run's eight (A7), whichever source lands (G3).
- One taxonomy per evidence file: a fallback replaces all three lists (S1).
- QuantAPI: `https://quantapi.51ifind.com/api/v1/get_access_token` (POST, header `refresh_token`) and `…/smart_stock_picking` (POST, header `access_token`, body `{"searchstring": …, "searchtype": "stock"}`); 15-second timeout, 4 MiB response cap, for this source only (S11). Other sources keep 7 s and 512 KiB.
- The query: `A股 YYYY年MM月DD日涨跌幅 成交额 主力资金流向 所属概念`, the date from `sessionOf(now)` (S2).
- Credentials: `IFIND_ACCESS_TOKEN`, else `IFIND_REFRESH_TOKEN`, from the face's `process.env`; access token cached in memory only; the token never appears in evidence, `run.json`, a refusal, a reply or stderr (S9).
- Stamps on every stand-in item: `provider: "同花顺问财"`, `taxonomy: "同花顺概念"`, `host: "quantapi.51ifind.com"`, `delayed: false`; board items also `pct_basis: "equal_weight"` (S6).
- Board code `THS:<concept name>`; member codes six digits (S5).
- Eligibility: ≥ 10 members and not in the named exclusion list; lists: top 30 by `pct`, members of the first 10 (≤ 100 each, by change descending, `truncated`), top 30 by `mainNet` (S3, S4).
- `CONTRACT_VERSION` "2" → "3" (S7).
- Client copy is English; the suffix is exactly ` · boards: iFinD (THS concepts)` (S8). Wire and evidence words stay Chinese.
- Commit messages: no backticks; write the message to a file and `git commit -F`.

## Review Focus

- A universe reply whose `所属概念` is null or empty for some rows → those rows count in no concept, the rest still derive (Task 2 test).
- A concept whose name holds a scope or trading word (e.g. 「ST板块」 survives exclusion only if not listed; 「龙头」 in a name) → the `board` field passes the wording rules in both contracts (Task 4 test).
- A stale cached access token (QuantAPI answers errorcode for the token) → one re-exchange, then the query once more, never a loop (Task 1 test).
- `boards` given as BK codes on a stand-in day → ignored, and the reply says so; never `INVALID_SYMBOL` from the stand-in path (Task 3 test).
- An older run's `run.json` with no `provider` → cards draw no suffix and nothing throws (Task 5 test).

---

### Task 1: The 问财 client

**Files:**
- Create: `face/plugins/lunhui/lib/wencai.mjs`
- Modify: `face/plugins/lunhui/lib/errors.mjs:144` (`PROVIDERS` gains `"同花顺问财"`), `face/plugins/lunhui/lib/fixture-fetch.mjs` (two QuantAPI routes)
- Create: `face/tests/fixtures/lunhui/wencai-token.json`, `face/tests/fixtures/lunhui/wencai-universe.json`
- Test: `face/tests/lunhui-wencai.test.ts`

**Interfaces:**
- Produces: `fetchWencaiUniverse({ session, env, fetchImpl, timeoutMs = 15000, maxBytes = 4 * 1024 * 1024 }) → Promise<{ rows: { code: string, name: string|null, pct: number|null, amount: number|null, mainNet: number|null, concepts: string[] }[], host: "quantapi.51ifind.com", query: string, sha256: string, dataVol: number }>`; `session` is `YYYY-MM-DD`. `code` is six digits (suffix `.SH/.SZ/.BJ` dropped). Column keys are matched by prefix (`涨跌幅`, `成交额`, `主力资金流向`, `所属概念`), never by the dated suffix.
- Produces: `hasWencaiCredentials(env) → boolean`; `WENCAI_PROVIDER = "同花顺问财"`.
- Refusals are `LunhuiError` via `upstreamError(error, "同花顺问财")` or `new LunhuiError("UPSTREAM_INVALID", …)` with these reasons in the message: `未配置` (no token; but callers check `hasWencaiCredentials` first), `凭据被拒` (token exchange errorcode ≠ 0), `超时`, `响应过大`, `errorcode <n>`, `缺少列`, `没有可用行`. No message contains the token or the reply body.
- `fixture-fetch.mjs`: host `quantapi.51ifind.com`, path `/api/v1/get_access_token` → `wencai-token.json`; `/api/v1/smart_stock_picking` → `wencai-universe.json`.

- [ ] **Step 1: Record the fixtures.** `wencai-token.json` = `{"errorcode":0,"errmsg":"","data":{"access_token":"fixture-access"}}`. `wencai-universe.json` = a trimmed real reply shape (`{"errorcode":0,"tables":[{"table":{"股票代码":[…],"股票简称":[…],"股票市场类型":[…],"涨跌幅:前复权[20261030]":[…],"成交额[20261030]":[…],"主力资金流向[20261030]":[…],"所属概念":[…]}}],"dataVol":…}`) of 40 rows: 12 members of 「人形机器人」, 11 of 「白酒概念」, 10 of 「CRO概念」, 9 of 「青蒿素」 (below the minimum), every row also in 「融资融券」, two rows with `所属概念` null, one BJ code. Values chosen by hand so Task 2's expectations are computable.
- [ ] **Step 2: Write the failing tests** in `lunhui-wencai.test.ts`: `"a universe is one token exchange and one query, the session's date in it"` (asserts the two POST paths in order, header `refresh_token` then `access_token: fixture-access`, body `searchstring` = `A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念`); `"rows carry six-digit codes and split concepts"` (`"603890"`, `concepts` arrays, null concepts → `[]`); `"the access token is cached; a refused one is exchanged once more"` (second call makes one query request only; a query answering errorcode for the token re-exchanges once, then refuses `凭据被拒` on a second refusal); `"no token, an errorcode, missing columns, no rows, oversize and timeout refuse naming 同花顺问财 and never the token"` (each case asserts `error.code`, `/同花顺问财/`, and that `"fixture-access"`/the refresh value is absent from `error.message`); `"sha256 is over the reply's data and the query is recorded"`.
- [ ] **Step 3: Run** `cd face && node --import tsx --test tests/lunhui-wencai.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `wencai.mjs` over `fetchBytes` from `lib/market.mjs` (pass `maxBytes`, `timeoutMs`, method POST, JSON body), the token cache a module-level `{ value, until }` (until = now + 6 days), the two fixture routes, the provider in `errors.mjs`.
- [ ] **Step 5: Run** the test file — Expected: PASS; then `npm test` — Expected: 0 failures.
- [ ] **Step 6: Commit** — `feat: a 问财 client for the Lunhui boards stand-in`.

### Task 2: Boards from the universe

**Files:**
- Create: `face/plugins/lunhui/lib/wencai-boards.mjs`, `face/plugins/lunhui/lib/wencai-excluded.mjs`
- Test: `face/tests/lunhui-wencai-boards.test.ts`

**Interfaces:**
- Consumes: Task 1's `rows`.
- Produces: `deriveStandInBoards(rows, { minMembers = 10, excluded = EXCLUDED_CONCEPTS, top = 30, memberBoards = 10, maxMembers = 100 }) → { boards: Board[], members: { board: string, truncated: boolean, members: { code, name, pct }[] }[], flow: { code, name, pct, mainNet, mainShare }[] }` where `Board = { code: "THS:<name>", name, pct, amount, advancers, decliners, leader }` — the same keys Eastmoney's `boardRow` / `flowRow` / members carry, so `deriveBoards` and the theme context read them unchanged. Stamps are Task 3's.
- `EXCLUDED_CONCEPTS: ReadonlyMap<string, string>` — concept → reason; compile it from the 389 names in the probe's universe reply (primary checkout `.superpowers/ifind-probe/out/round2/universe/adhoc.stock.json`): memberships (融资融券, 深股通, 沪股通, 转融券标的…), house indices (同花顺漂亮100, 同花顺出海50…), screens and reports (ST板块, `\d{4}(年报|中报|三季报)预增` by pattern…). Keep a test that every entry has a reason.

- [ ] **Step 1: Write the failing tests:** `"eligible concepts have ten members and are not excluded"` (fixture: 人形机器人, 白酒概念, CRO概念 in; 青蒿素 and 融资融券 out); `"a board's numbers come from its members"` (equal-weight `pct`, `advancers`/`decliners`, `amount` sum, `leader` = largest change, ties to the larger turnover); `"three lists in the spec's order and bounds"` (boards by `pct` desc ≤ 30; members of the first 10, by change desc, ≤ 100, `truncated`; flow by `mainNet` desc ≤ 30, `mainShare` = `mainNet / amount * 100`); `"rows without concepts or numbers count nowhere they cannot"` (null `pct` member excluded from the mean and counts but kept in members); `"every exclusion has a reason"`.
- [ ] **Step 2: Run** `node --import tsx --test tests/lunhui-wencai-boards.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** both files; pure functions, no I/O.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat: the stand-in's boards, members and flow from one universe`.

### Task 3: The fallback in the boards freeze

**Files:**
- Modify: `face/plugins/lunhui/freeze-boards-row.mjs` (`freeze`, the tool description), `face/plugins/lunhui/lib/runs.mjs:578-602` (`addEvidence` meta), `face/plugins/lunhui/lib/freeze-tool.mjs` (`Frozen` typedef)
- Test: `face/tests/lunhui-freeze.test.ts` (new cases), `face/tests/lunhui-runs.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `addEvidence` meta admits optional `provider` (non-empty string), `fallback_from` (`{ provider: "东方财富", code: string }`), `query` (string), `reply_sha256` (64 hex); each is written into the evidence file and `provider` (and `fallback_from` when present) into `run.json`'s evidence entry. Absent → absent.
- The boards row's freeze: Eastmoney path sets `meta.provider = "东方财富"`. On a `LunhuiError` from any Eastmoney read: no credentials → throw `LunhuiError(<eastmoney code>, "东方财富板块请求失败（<code>）；同花顺问财备用未配置；本次未写入任何文件。")`; else the stand-in: items stamped (Global Constraints), `deriveBoards` over the stand-in boards, meta `{ host: "quantapi.51ifind.com", delayed: false, truncated, provider: "同花顺问财", fallback_from, query, reply_sha256 }`, `summary: { provider: "同花顺问财", taxonomy: "同花顺概念", fallback_from, boards_ignored: <the given BK codes or absent> }`; a stand-in refusal → throw with Eastmoney's code and a message naming both reasons.
- `config.now` and `fetchImpl` unchanged; the env read is `process.env` unless the row config names `env` (tests pass one).

- [ ] **Step 1: Write the failing tests** (fixture dir with Eastmoney files plus the Task 1 fixtures; Eastmoney failure by a fixture dir lacking `boards.json` → 404 → `UPSTREAM_INVALID`): `"Eastmoney answering never reaches QuantAPI"` (spy fetch: no `quantapi` URL; meta provider `东方财富`); `"a refused board list lands the stand-in whole"`, and the same for a missing `members-BK….json` and a missing `board-flow.json` (every item stamped, codes `THS:`, `run.json` entry `provider: "同花顺问财"` and `fallback_from.code`); `"no token refuses naming both and makes no QuantAPI request"`; `"a failing stand-in refuses naming both"`; `"the freeze counts once"` (`metrics.json` freezes = 1 after a stand-in landing); `"boards given as BK codes are ignored by the stand-in and the reply says so"`; `"the token is in no file of the run and no reply"` (scan every file under the run dir and the reply text); `addEvidence` accepts meta with and without `provider`.
- [ ] **Step 2: Run** `node --import tsx --test tests/lunhui-freeze.test.ts tests/lunhui-runs.test.ts` — Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the meta fields in `addEvidence`, then the fallback in `freeze-boards-row.mjs`; the tool description gains one sentence: 东方财富板块请求失败时改用同花顺问财（同花顺概念，涨跌幅为成分股等权平均），回复写明来源。
- [ ] **Step 4: Run** the two files, then `npm test` — Expected: 0 failures.
- [ ] **Step 5: Commit** — `feat: the boards freeze falls back to 问财 when Eastmoney refuses`.

### Task 4: The contracts read THS boards

**Files:**
- Modify: `face/plugins/lunhui/lib/contracts/theme.mjs` (schema pattern line 65, the `board` hint line 35, `served` hint lines 80-90, `exemptPaths` line 160), `face/plugins/lunhui/lib/contracts/leader.mjs` (`BOARD_RE` line 32, schema line 89, `board` hint line 58, `exemptPaths` line 254), `face/plugins/lunhui/lib/contract-core.mjs:206`
- Test: `face/tests/lunhui-contract-theme.test.ts`, `face/tests/lunhui-contract-leader.test.ts` (its pattern pin near line 153), `face/tests/lunhui-contract-core.test.ts`

**Interfaces:**
- One board-code grammar, exported from `contract-core.mjs`: `BOARD_CODE = /^(?:BK\d{4}|THS:[^\s"]{1,40})$/` and its schema string; both contracts use it. The membership rule is unchanged: a code the run did not freeze is `REFERENCE`.
- `exemptPaths` gain `mainline_candidates[*].board` and `leader_candidates[*].board`.
- `served`, when any boards row has `provider === "同花顺问财"`: `板块来自同花顺问财（同花顺概念；涨跌幅为成分股等权平均，不是指数）；各行来自 quantapi.51ifind.com，均非延时行情。`; otherwise today's text.
- `CONTRACT_VERSION = "3"`.

- [ ] **Step 1: Write the failing tests:** theme accepts a `THS:人形机器人` candidate the run froze and refuses `THS:未冻结`; a candidate board `THS:ST板块` passes the wording rules; leader accepts a `THS:` board of the cited market run's theme candidates and refuses one not frozen; the served hint for a stand-in run; `CONTRACT_VERSION` is `"3"`; update the leader pattern pin.
- [ ] **Step 2: Run** the three files — Expected: the new cases FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then `npm test` — Expected: 0 failures (update any test pinning `"2"`).
- [ ] **Step 5: Commit** — `feat: the theme and leader contracts read THS boards, contract version 3`.

### Task 5: Where the operator sees the source

**Files:**
- Modify: `face/src/channels.ts` (`RunRow` and `ModuleRunRow` gain `boardsProvider: string | null`, read from `run.json`'s evidence entry whose `source` is `boards`), `face/client/js/host/runs-view.js` (`chipText` for `theme`), `face/client/js/host/modules-view.js` (`chipOf`, `headlineWords` for the theme card and page), `face/src/agents.ts:103` (`SCRUBBED_ENV` gains `IFIND_REFRESH_TOKEN`, `IFIND_ACCESS_TOKEN`)
- Test: `face/tests/channels.test.ts`, `face/tests/client/runs-view.test.js`, `face/tests/client/modules-view.test.js`, `face/tests/agents.test.ts`

**Interfaces:**
- `boardsProvider`: the string or null; null for a missing field, an older run, a non-object entry.
- Suffix: when `boardsProvider === "同花顺问财"`, the theme chip and the theme card/page headline end with ` · boards: iFinD (THS concepts)`; otherwise unchanged.

- [ ] **Step 1: Write the failing tests:** a run whose `run.json` boards entry has `provider: "同花顺问财"` reads `boardsProvider` so; an older run reads null; the runs chip, the Discover theme card and the module page show the suffix only then; `scrubbedEnv({ IFIND_REFRESH_TOKEN: "x", IFIND_ACCESS_TOKEN: "y", PATH: "p" })` keeps `PATH` alone of the three.
- [ ] **Step 2: Run** them — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then `npm test && npm run typecheck` — Expected: 0 failures, typecheck clean.
- [ ] **Step 5: Commit** — `feat: the runs card, the theme card and its page say when boards came from iFinD`.

### Task 6: Documents and the live check

**Files:**
- Modify: `face/README.md` (Run: `set -a; [ ! -f ../.env.ifind ] || source ../.env.ifind; set +a` back after `source ../.env.deepseek` — if the quote change is merged first, else it is still there; "Lunhui analysis": the stand-in paragraph, the egress row `quantapi.51ifind.com`, the two `IFIND_*` variables), `DEVELOPMENT.md` (the freeze rows' table, refusals, egress, environment rows; a residual beside R1: Gravit's tools can read `../.env.ifind`), `docs/superpowers/specs/2026-10-25-lunhui-modules-design.md` (§18, "Revision, 2026-10-30: the boards stand-in", pointing to the new spec)
- Create: `face/scripts/lunhui-standin-check.mjs` (a one-shot live check: `fetchWencaiUniverse` for the latest session plus `deriveStandInBoards`, printing counts and the top five boards; never prints the token; exits non-zero on refusal)

- [ ] **Step 1: Write the docs**; each sentence present-tense and checkable against Tasks 1–5.
- [ ] **Step 2: Run** `cd face && set -a && . ../.env.ifind && set +a && node scripts/lunhui-standin-check.mjs` (from the primary checkout's root `.env.ifind`, copied or sourced by path) — Expected: `rows ≈ 5,500`, `eligible concepts > 100`, five boards printed, exit 0.
- [ ] **Step 3: Run** `npm test && npm run typecheck` — Expected: 0 failures.
- [ ] **Step 4: Commit** — `docs: the boards stand-in in the README, DEVELOPMENT and the modules spec`.

### After the tasks

Final whole-branch review on `model: "fable"` (the operator's standing rule). Merge order: `feat/quotes-tencent` first; this branch rebases onto `main` (and onto `feat/run-view-1` if that merged first, adding `boards ✓ via iFinD` to its sources line — spec §8, O5).
