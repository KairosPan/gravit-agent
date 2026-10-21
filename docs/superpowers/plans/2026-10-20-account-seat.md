# The Account seat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gravit becomes a seat at Linqi's Account through one project-owned MCP row; the face's Gate 2 cards every seat write; the Account screen draws the seat's standing; the `demo/` submodule leaves the tree.

**Architecture:** `face/src/account-seat.ts` composes the `mcp-account` row beside the AKShare row over an externally installed checkout; `orders.ts`, `kinds.js` and `roles.ts` learn the seat's twelve write tools; `face/src/seat.ts` reduces the Account's `GET /api/account` into `/data/seat.json`, which a new client slice draws as the **Account seat** box on Account › Venues; a seat tool's result lifts a card-raised / placed / refused line. An env-gated real-boot smoke drives the whole chain — the seat process, the stand-in Account, Gate 2 with a logged grant, the stand-in's own card.

**Tech Stack:** Node 22, TypeScript via `tsx --test`, dsh 0.2.0-rc.2 (`@deepseek-ai/dsh-mcp-client` stdio rows), the vanilla-ES-module client with its fake DOM, Linqi's buyer-agent-demo @ 133b9a7 as an installed program (its `test/standin/ui-standin.ts` for the smoke).

**Spec:** `docs/superpowers/specs/2026-10-20-account-seat-design.md` (the calls are marked there; the charter `Gravit-Design.md` outranks it on intent).

## Global Constraints

- The branch is `feat/account-seat` in the worktree `.claude/worktrees/account-seat`; commits go through `git commit -F <file>` (no backticks, `$()` or parentheses in a `-m`); push only on the operator's word.
- Nothing in the tree imports, pins or vendors the Account's code; the installed checkout is read only by the seat process dsh spawns and by the smoke (`FACE_ACCOUNT_SEAT_DIR`), never at build or test time otherwise.
- The seat's write tools, exactly twelve, everywhere they are named: `portfolio_live_order`, `portfolio_live_batch`, `portfolio_live_amend`, `portfolio_live_cancel`, `portfolio_live_close`, `portfolio_live_leverage`, `portfolio_live_move`, `portfolio_live_earn`, `portfolio_pay`, `portfolio_order`, `portfolio_execute`, `portfolio_transfer`.
- The seat's name is `Gravit`; the row id `mcp-account`; the server name `account`; the tool prefix `mcp__account__`; the env `FACE_ACCOUNT_SEAT_DIR` (default `~/buyer-agent-demo`) and `FACE_ACCOUNT_URL` (default `http://127.0.0.1:4820`).
- The product speaks English; screens carry no explanatory small print; the Account's own refusal text is drawn as its words.
- Every one of the sixteen existing `FACE_SMOKE` boots disables `mcp-account` as it disables `mcp-akshare`; only the seat smoke mounts it.
- `GRAVIT.md` stays within 4,500 bytes (`face/tests/gravit-md.test.ts`).
- The face suite is `cd face && npm test` (1027 tests at the base: 1011 pass, 16 skipped) and `npm run typecheck`; `FACE_SMOKE=1 npm test` for the real boots; `python -m pytest` at the root (400) is untouched by this plan.

## Review Focus

1. A seat order whose `venue` the operator never granted: the face's card still shows the venue; the Account refuses with `E_MANDATE_RECIPIENT`; the receipt line is that refusal in the Account's words, never "accepted" — Task 5's refusal test.
2. The Account service hanging or answering slowly: `/data/seat.json` aborts at 7 s and answers `reachable: false, error: "timeout"`; the chat is untouched — Task 6's timeout test.
3. A seat admitted under a name other than `Gravit`: the block says `knocking` or `not on the account`, never `admitted` — Task 6's name test; the README says to admit it as Gravit.
4. The Account's JSON changing shape (fields missing, non-arrays, a key with an unknown status): `seatView` never throws and draws empty lists and `absent` — Task 6's odd-shape test.
5. A seat write tool renamed on the Account's side (so the gate's raw list misses it): no face test can see it offline; the seat smoke's gated-list assertion against the installed checkout is the canary — Task 9, and the README's "re-run the seat smoke after pulling the checkout".

---

### Task 1: The submodule leaves the tree

**Files:**
- Delete: `.gitmodules`, the `demo` gitlink
- Modify: `CLAUDE.md` (the Map row `| \`demo/\` | git submodule → … |`, line 34)

**Interfaces:**
- Consumes: nothing.
- Produces: a tree with no `demo/` path; `CLAUDE.md` without the row (Task 2 adds the seat's row).

- [ ] **Step 1: Remove the gitlink and the modules file**

Run: `git rm -q demo && git rm -q --cached .gitmodules 2>/dev/null; rm -f .gitmodules; git status --short`
Expected: `D  .gitmodules` and `D  demo` (if `git rm demo` already removed `.gitmodules`'s section and left the file empty, delete the empty file; `ls demo` must say no such file).

- [ ] **Step 2: Drop the `demo/` row from CLAUDE.md**

Delete the whole table row that starts `| \`demo/\` |` (one line). Nothing else in `CLAUDE.md` names the submodule.

- [ ] **Step 3: Verify nothing tracked names the submodule**

Run: `git ls-files demo .gitmodules; git grep -n "submodule\|linqizhe07\|demo/" -- CLAUDE.md .gitmodules ':!docs/research' ':!docs/superpowers' | head`
Expected: no output from `git ls-files`; no hit in `CLAUDE.md` (the loops page's summary line is Task 2's).

- [ ] **Step 4: Commit**

Message file: `tree: the demo submodule leaves; Linqi's Account is an external program now` with a body naming 0ef5131 as the last pin and that the face's seat row follows in the next commit.

---

### Task 2: The `mcp-account` row

**Files:**
- Create: `face/src/account-seat.ts`
- Modify: `face/src/boot.ts:336-344` (compose the row after `marketPatches`), `face/scripts/schema-sizes.ts:35` (`GROUPS`), `CLAUDE.md` (the new Map row and the `face/` row's "hosts dsh" sentence), `Gravit-Docs-and-Prompt-Loops.html:181` (the CLAUDE.md summary bullet) and its `5.3` composition list item 3 (the AKShare connection line gains the seat row), the sixteen `FACE_SMOKE` test files (the scratch-profile patch string)
- Test: `face/tests/boot.test.ts`

**Interfaces:**
- Consumes: `FacePatchList` (`boot.ts:201`), `StdioConfig` from `@deepseek-ai/dsh-mcp-client`, the AKShare row as the pattern (`face/src/akshare.ts`).
- Produces: `export const ACCOUNT_SEAT_ROW_ID = "mcp-account"`, `ACCOUNT_SEAT_SERVER = "account"`, `ACCOUNT_SEAT_NAME = "Gravit"`, `DEFAULT_SEAT_DIR = join(homedir(), "buyer-agent-demo")`, `DEFAULT_SEAT_URL = "http://127.0.0.1:4820"`, `SEAT_TOOL_PREFIX = "mcp__account__"`, and `accountSeatPatches(dir = process.env.FACE_ACCOUNT_SEAT_DIR || DEFAULT_SEAT_DIR, url = process.env.FACE_ACCOUNT_URL || DEFAULT_SEAT_URL): FacePatchList` returning one insert whose config is `{ transport: "stdio", serverName: "account", command: process.execPath, args: [join(dir, "node_modules", "tsx", "dist", "cli.mjs"), "src/portfolio/mcp.ts"], cwd: dir, env: { PORTFOLIO_URL: url, PORTFOLIO_AGENT: "Gravit" }, toolCallTimeoutMs: 90_000, failOnStartupError: false } satisfies StdioConfig`.

- [ ] **Step 1: Write the failing tests in `face/tests/boot.test.ts`**

Change "composeFace stacks exactly the layers it means to": `patches.length === 7 + policy.length`, and add `assert.equal((patches[2 + policy.length] as InsertPatch).insert?.[0]?.id, ACCOUNT_SEAT_ROW_ID, "the seat row sits right after the AKShare row")`; update its comment (dsh-base + policy + AKShare + the Account seat + hmr + persona + instructions + overlay). Change "every face row lands in the composed tree exactly once": `assert.equal(counts.get(ACCOUNT_SEAT_ROW_ID), 1, "the Account seat must be registered exactly once")`. Add:

```ts
test("composeFace mounts the Account seat from FACE_ACCOUNT_SEAT_DIR and FACE_ACCOUNT_URL", () => {
  // set both env vars inside try/finally as the AKShare test does
  process.env.FACE_ACCOUNT_SEAT_DIR = "/tmp/face-test-seat"; process.env.FACE_ACCOUNT_URL = "http://127.0.0.1:4899";
  const row = composeEntries([composeFace({ profileName: "face", port: 3090, dshHome: freshHome() }).patches]).find((r) => r.id === ACCOUNT_SEAT_ROW_ID);
  assert.ok(row); assert.equal(row.name, "@deepseek-ai/dsh-mcp-client");
  const c = row.config as { serverName?: string; transport?: string; command?: string; args?: string[]; cwd?: string; env?: Record<string, string>; toolCallTimeoutMs?: number; failOnStartupError?: boolean };
  assert.equal(c.serverName, "account"); assert.equal(c.transport, "stdio"); assert.equal(c.command, process.execPath);
  assert.deepEqual(c.args, ["/tmp/face-test-seat/node_modules/tsx/dist/cli.mjs", "src/portfolio/mcp.ts"]);
  assert.equal(c.cwd, "/tmp/face-test-seat");
  assert.deepEqual(c.env, { PORTFOLIO_URL: "http://127.0.0.1:4899", PORTFOLIO_AGENT: "Gravit" });
  assert.equal(c.toolCallTimeoutMs, 90_000); assert.equal(c.failOnStartupError, false);
});
test("the profile can disable the repo's Account seat row", () => { /* `- id: mcp-account\n  disabled: true` → the one row is disabled */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd face && npx tsx --test tests/boot.test.ts 2>&1 | tail -20`
Expected: FAIL — `ACCOUNT_SEAT_ROW_ID` is not exported (import error), or the layer count reads `6 + policy.length`.

- [ ] **Step 3: Write `face/src/account-seat.ts` and compose it**

A header comment in `akshare.ts`'s style: what the row is, that the checkout is the operator's install, the LaunchAgent's own command shape, that dsh spreads the row's `env` over a scrubbed parent env (`dsh-mcp-client/lib/index.js:26-31`), the double spawn and the lazy key. In `boot.ts:336` add `const seatPatches = accountSeatPatches();` and spread `...seatPatches` right after `...marketPatches` in the `patches` list (L342-344) and in the `below`/`rows` composition (L354-355); import it at L128.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/boot.test.ts 2>&1 | tail -8`
Expected: PASS, all boot tests.

- [ ] **Step 5: Disable the row in the sixteen real-boot smokes; add the group**

Write a scratchpad Python script that, in every `face/tests/*.test.ts` containing the exact text `- id: mcp-akshare\n  disabled: true\n` (as it appears inside a template literal: `\\n- id: mcp-akshare\\n  disabled: true\\n`), inserts `- id: mcp-account\\n  disabled: true\\n` right after it; it must report 16 files changed. In `schema-sizes.ts:35` make `GROUPS = ["mcp__alpaca-kit__", "mcp__akshare__", "mcp__account__", "agent_", "role_"]`.

Run: `grep -l "id: mcp-account" face/tests/*.test.ts | wc -l`
Expected: `16`.

- [ ] **Step 6: The CLAUDE.md row and the loops page**

`CLAUDE.md` Map: a new row after `face/src/akshare.ts`: `| \`face/src/account-seat.ts\` | the Account seat: the project-owned \`mcp-account\` row (\`@deepseek-ai/dsh-mcp-client\`, stdio) that spawns the MCP seat of Linqi's Account — [linqizhe07/buyer-agent-demo](https://github.com/linqizhe07/buyer-agent-demo), an external program the operator installs (\`FACE_ACCOUNT_SEAT_DIR\`, default \`~/buyer-agent-demo\`, \`npm ci\` there) and runs (\`npm run account\`, 127.0.0.1:4820; \`FACE_ACCOUNT_URL\`) — so Gravit's tools gain \`mcp__account__portfolio_*\`; paper venues only by the operator's grants on the Account page; every seat write passes Gate 2 here and the Account's Guard card there; \`face/src/seat.ts\` serves \`/data/seat.json\` for the Account screen; the seat's key is the Account's (\`~/.buyer-agent-demo/seats/gravit.json\`); nothing of the Account is vendored since 2026-10-20 (the \`demo/\` submodule is gone) |`. In the loops page: the CLAUDE.md summary bullet (L181) drops `demo/ 子模块（buyer-agent-demo @ 0ef5131）` for `Account 席位行（face/src/account-seat.ts）`, and the §5.3 composition list's item 3 reads `项目的 AKShare 连接 src/akshare.ts（…）和 Account 席位行 src/account-seat.ts（mcp-account，Linqi 的账户程序的 MCP 席位，操作员自装的 checkout，启动失败不停机）`.

- [ ] **Step 7: Run the suite and typecheck**

Run: `cd face && npm test 2>&1 | tail -8 && npm run typecheck`
Expected: `# pass 1013` or more, `# fail 0`; typecheck clean.

- [ ] **Step 8: Commit**

`face: the Account seat row, mcp-account, composed beside AKShare`.

---

### Task 3: Gate 2 cards the seat's writes

**Files:**
- Modify: `face/src/orders.ts:35` (`ORDER_RAW_NAMES`), `:140` (the reason), `:186` (`describeOrder`'s known keys)
- Test: `face/tests/orders.test.ts`, `face/tests/order-gate.test.ts:84-130` (the FACE_SMOKE case)

**Interfaces:**
- Consumes: Task 2's `SEAT_TOOL_PREFIX` is not needed here — the gate matches raw suffixes.
- Produces: `export const SEAT_WRITE_RAW_NAMES` (the twelve), `ORDER_RAW_NAMES = [...ALPACA_RAW_NAMES, ...SEAT_WRITE_RAW_NAMES]` (both unexported except the seat list), `export function isSeatWriteTool(name: string): boolean` (raw suffix match on the twelve), and the reason `Account seat - <describeOrder(name, args)>` for a seat tool, `PAPER order - …` for the Alpaca ones.

- [ ] **Step 1: Write the failing tests in `orders.test.ts`**

```ts
const SEAT = ["portfolio_live_order", "portfolio_live_batch", "portfolio_live_amend", "portfolio_live_cancel", "portfolio_live_close", "portfolio_live_leverage", "portfolio_live_move", "portfolio_live_earn", "portfolio_pay", "portfolio_order", "portfolio_execute", "portfolio_transfer"];
test("isOrderTool: the Account seat's twelve write tools match, raw and as dsh mints them; its reads, waits and words never", () => {
  for (const raw of SEAT) { assert.ok(isOrderTool(raw), raw); assert.ok(isOrderTool(`mcp__account__${raw}`), raw); assert.ok(isSeatWriteTool(`mcp__broker__${raw}`), raw); }
  for (const read of ["portfolio_account", "portfolio_holdings", "portfolio_venues", "portfolio_live_preview", "portfolio_live_markets", "portfolio_live_positions", "portfolio_wait", "portfolio_approval", "portfolio_ask", "portfolio_report", "portfolio_remember", "portfolio_desk_say"]) {
    assert.equal(isOrderTool(`mcp__account__${read}`), false, read); assert.equal(isSeatWriteTool(`mcp__account__${read}`), false, read);
  }
  assert.equal(isSeatWriteTool("mcp__alpaca-kit__place_order"), false);
});
test("describeOrder: a seat order reads side, size, symbol, type and venue in that order, then the rest", () => {
  assert.equal(describeOrder("mcp__account__portfolio_live_order", { venue: "paper-1", symbol: "AAPL", side: "buy", usd: 100, orderType: "market", tif: "day" }),
    "mcp__account__portfolio_live_order: side=buy usd=100 symbol=AAPL orderType=market venue=paper-1 tif=day");
  assert.equal(describeOrder("mcp__account__portfolio_live_cancel", { venue: "paper-1", order: "ord-0001" }), "mcp__account__portfolio_live_cancel: order=ord-0001 venue=paper-1");
});
test("orderApprovalDecision: a seat tool's reason opens with Account seat, never PAPER", () => {
  const d = orderApprovalDecision("mcp__account__portfolio_live_order", "ask", { venue: "paper-1", symbol: "AAPL", side: "buy", usd: 100 });
  assert.equal(d?.kind, "ask"); assert.match(d.reason, /^Account seat - mcp__account__portfolio_live_order: side=buy usd=100 symbol=AAPL venue=paper-1$/); assert.doesNotMatch(d.reason, /PAPER/);
  assert.deepEqual(d.displayReason, { en: d.reason });
});
test("auditOrderTools: the seat's write tools are gated, its reads are not", () => { /* schemas named mcp__account__portfolio_live_order and mcp__account__portfolio_account → gated has the first only, ungated empty */ });
```

In `order-gate.test.ts`'s FACE_SMOKE case add, after the `cancel_order` assertion: `const seat = await fire(pending("mcp__drill__portfolio_live_order", { venue: "paper-1", symbol: "AAPL", side: "buy", usd: 100 })); assert.equal(seat.kind, "ask"); assert.match(seat.kind === "ask" ? seat.reason ?? "" : "", /^Account seat - .*venue=paper-1/);` and `assert.equal((await fire(pending("mcp__drill__portfolio_account", {}))).kind, "allow");`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd face && npx tsx --test tests/orders.test.ts 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `isSeatWriteTool` is not exported (import fails) — or the four new tests `not ok`.

- [ ] **Step 3: Implement in `orders.ts`**

`const ALPACA_RAW_NAMES = ["place_order", "cancel_order"] as const; export const SEAT_WRITE_RAW_NAMES = [...] as const; const ORDER_RAW_NAMES = [...ALPACA_RAW_NAMES, ...SEAT_WRITE_RAW_NAMES];` `isSeatWriteTool` with the same suffix rule over the seat list. In `orderApprovalDecision`: `const reason = \`${isSeatWriteTool(name) ? "Account seat" : "PAPER order"} - ${describeOrder(name, args)}\`;`. `describeOrder`'s `known = ["side", "qty", "usd", "symbol", "order_type", "orderType", "limit_price", "limitPrice", "stopPrice", "order_id", "order", "venue", "kind", "from", "asset", "amount", "leverage", "url", "maxAmount"]`. Update the header comments (L26-34: the seat's names, and why `PAPER` is not claimed for them).

- [ ] **Step 4: Run to verify they pass; the whole suite**

Run: `cd face && npx tsx --test tests/orders.test.ts 2>&1 | tail -4 && npm test 2>&1 | tail -6`
Expected: PASS; `# fail 0` (the pinned Alpaca texts `PAPER order - …` unchanged).

- [ ] **Step 5: Commit**

`face: Gate 2 cards the Account seat's twelve write tools`.

---

### Task 4: A role never carries a seat tool

**Files:**
- Modify: `face/src/roles.ts:99-101` (the "an account or order tool" rule)
- Test: `face/tests/roles.test.ts:8-16, 172-184`

**Interfaces:**
- Consumes: Task 3's twelve names (copied, as the test file keeps its own copy by design).
- Produces: the rule `{ what: "an account or order tool", because: "orders stay behind the two order gates, the Account seat is Gravit's, and a role has no reason to read the account", names: [], prefixes: ["mcp__account__"], rawNames: ["account", "positions", "orders", "place_order", "cancel_order", ...the twelve] }`.

- [ ] **Step 1: Write the failing test**

In `roles.test.ts`: extend `ACCOUNT_OR_ORDER` to `/(^|__)(account|positions|orders|place_order|cancel_order|portfolio_live_order|portfolio_live_batch|portfolio_live_amend|portfolio_live_cancel|portfolio_live_close|portfolio_live_leverage|portfolio_live_move|portfolio_live_earn|portfolio_pay|portfolio_order|portfolio_execute|portfolio_transfer)$/` and the shipped-roles test's prefix list with `mcp__account__`; extend `RENAMED_SERVER` with `mcp__broker__portfolio_live_order` and `mcp__broker__portfolio_pay`; add `"mcp__account__portfolio_holdings"` and `"portfolio_live_close"` to the refusal loop's list.

- [ ] **Step 2: Run to verify it fails**

Run: `cd face && npx tsx --test tests/roles.test.ts 2>&1 | grep -E "^not ok|^# fail"`
Expected: `not ok` — `readRoles` accepts `mcp__account__portfolio_holdings`.

- [ ] **Step 3: Implement the rule in `roles.ts`**

- [ ] **Step 4: Run to verify it passes**

Run: `cd face && npx tsx --test tests/roles.test.ts 2>&1 | tail -4`
Expected: PASS.

- [ ] **Step 5: Commit**

`face: a role never carries an Account seat tool`.

---

### Task 5: The client's seat card, seat line and receipts

**Files:**
- Modify: `face/client/js/host/kinds.js` (`ORDER_TOOLS`, `gate`, `toolMessages`), `face/client/js/host/live.js:78` (`onReceipt(m)`), `face/client/js/app.js:159` (`onReceipt: m => …`, routed in Task 7)
- Test: `face/tests/client/kinds.test.js`, `face/tests/client/thread.test.js:60`, `face/tests/client/live.test.js:292`

**Interfaces:**
- Consumes: Task 3's names.
- Produces: `export const SEAT_TOOLS` (the twelve), `ORDER_TOOLS = Object.freeze(['place_order', 'cancel_order', ...SEAT_TOOLS])`, `export const isSeatTool = name => …` (suffix match on `SEAT_TOOLS`), `export function seatLine(name, args = {})` — `buy $100 of AAPL · market · paper-1` (usd), `sell 10 AAPL · limit 187.4 · paper-1` (qty), `cancel ord-0001 · paper-1`, `amend ord-0001 · paper-1`, `close AAPL · paper-1`, `leverage AAPL 5x · paper-1`, `move 50 USDC · withdraw from okx`, `earn supply 100 USDC · okx`, `pay up to $2 · api.example.com` (the URL's host), `batch · 3 legs`, else `<raw tool name> · <venue>` or the raw name; `export function seatLift(name, args, text, isError)` → the receipt/refusal message data or null: `{ kind: 'receipt', text: 'Card raised on the Account page · card-0007 · answer it there', data: { seat: true, cardId } }` when the parsed answer has `pending === true` and `card.id`; `{ kind: 'receipt', text: 'Order placed · <seatLine> · ord-0001 · paper', data: { seat: true, orderId } }` when it has `order.id` (` · paper` only when `order.paper === true`); `{ kind: 'receipt', text: 'Batch · 2 of 3 legs placed', data: { seat: true } }` for `legs`; `{ kind: 'refusal', text: '<code> · <message>' | text, data: { seat: true, toolName, callId } }` when `isError` or `ok === false`; null otherwise. The gate card for a seat tool: `text: \`Your call: ${seatLine(name, args)}\``, `data.venue = args.venue ?? 'Account seat'`. `live.js` calls `onReceipt(m)` with the lifted message.

- [ ] **Step 1: Write the failing tests**

`kinds.test.js`: change the exact-list test to `assert.deepEqual([...ORDER_TOOLS], ['place_order', 'cancel_order', ...SEAT])`; add `seatLine` cases (each line above, exact); "a seat order approval is the orange card with the seat line and the venue from its arguments" (a `tool/call` frame for `mcp__account__portfolio_live_order` with `{venue:'paper-1', symbol:'AAPL', side:'buy', usd:100, orderType:'market'}` and an `approval/request` with reason `Account seat - …` → `card.text === 'Your call: buy $100 of AAPL · market · paper-1'`, `card.data.venue === 'paper-1'`, `card.data.line` matches `/^Account seat/`); "a seat tool without a venue is a card at the Account seat" (`portfolio_pay` → venue `Account seat`, text `Your call: pay up to $2 · api.example.com`); "a seat order result lifts a card-raised line, a placed order, the Account's refusal, or a batch count" (four results, the texts above, `data.seat === true`; the refusal from `{ok:false, code:'E_MANDATE_RECIPIENT', message:'paper-1 is not in your limit'}` with `isError` true reads `E_MANDATE_RECIPIENT · paper-1 is not in your limit`); "a seat read's result lifts nothing" (`portfolio_account` → one row only).
`thread.test.js:60`: a second render of a seat card asserts `/paper-1 · Account seat - portfolio_live_order: side=buy/`.
`live.test.js:292`: the receipt test's `onReceipt` records its argument; add "a seat result's receipt reaches onReceipt flagged seat" (`mcp__account__portfolio_live_order` result `{ok:true, pending:true, card:{id:'card-0007'}}` → one call with `m.data.seat === true`).

- [ ] **Step 2: Run to verify they fail**

Run: `cd face && npx tsx --test tests/client/kinds.test.js tests/client/thread.test.js tests/client/live.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `not ok` on each new test (`SEAT_TOOLS`/`seatLine` undefined; the venue reads `Alpaca paper`).

- [ ] **Step 3: Implement in `kinds.js`, `live.js`, `app.js`**

`toolMessages`: when `isSeatTool(known.name)` use `seatLift` for the second message (an `isError` result with unparsable text is the refusal with the raw text); the Alpaca path unchanged. `live.js:78`: `if (m.kind === 'receipt') onReceipt(m);`. `app.js:159`: `onReceipt: m => { if (!m?.data?.seat) void account.load({ fresh: true }); }` (Task 7 adds the seat reload).

- [ ] **Step 4: Run to verify they pass; the suite**

Run: `cd face && npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

`client: the seat's card, seat line and receipts`.

---

### Task 6: `GET /data/seat.json`

**Files:**
- Create: `face/src/seat.ts`
- Modify: `face/src/main.ts:168` (mount after `registerDataRoutes`)
- Test: `face/tests/seat.test.ts` (mirror `tests/data.test.ts`'s registrar and request fakes)

**Interfaces:**
- Consumes: `isTrustedDataRequest` (`data.ts:131`), `FORBIDDEN` and `HttpError` (`http.ts`), `RouteRegistrar` (`static.ts:101`), Task 2's `ACCOUNT_SEAT_NAME`, `DEFAULT_SEAT_URL`.
- Produces: `export const SEAT_TTL_MS = 30_000`, `SEAT_TIMEOUT_MS = 7_000`; `export interface SeatView { ok: true; url: string; reachable: boolean; error?: string; asOf?: string; mode?: "guard" | "open"; writes?: { on: boolean; capUsd?: number }; cardMinutes?: number; seat?: { name: string; status: "absent" | "knocking" | "admitted" | "expired" | "revoked"; address?: string; validUntil?: number; limits: SeatLimit[] }; venues?: SeatVenue[]; cards?: SeatCard[]; others?: number }` with `SeatLimit = { scope, allow: string[], perOrderUsd, budgetUsd, spentUsd, reservedUsd, leftUsd, validUntil, expired }`, `SeatVenue = { id, name, paper: boolean, usd?: number, frontLine?: string, stale?: boolean, notServed?: string }`, `SeatCard = { id, usd?, reason?, expiresAt? }`; `export function seatView(account: unknown, seatName: string, url: string, nowMs: number): SeatView` (pure, total: a non-object or a missing list gives empty lists and `absent`; `keys[]` by case-insensitive `name` → `ok`/`unknown` = admitted, `expired`, `revoked`; else `requests[]` by name → `knocking`; `leftUsd = max(0, budget − spent − reserved)`; `cards` whose `agentName` matches, `others` the rest; `paper = venue.paper === true`); `export function registerSeatRoute(webServer: RouteRegistrar, deps: { url?: string; seatName?: string; fetch?: typeof fetch; now?: () => number } = {}): void` — `GET /data/seat.json`: fence first (403 `FORBIDDEN`), then the cache (`SEAT_TTL_MS`, `?fresh=1` skips it, one flight), then `fetch(\`${url}/api/account\`, { signal, redirect: "error" })` with an `AbortController` at `SEAT_TIMEOUT_MS`; a non-2xx answers `{ ok: true, url, reachable: false, error: \`http ${status}\` }`, unparsable JSON `error: "unreadable"`, an abort `error: "timeout"`, any other failure `error: <err.cause?.code ?? err.code ?? "unreachable">` — never the error's text; a good answer is `seatView(json, seatName, url, now())` served as JSON with `content-type: application/json; charset=utf-8`.

- [ ] **Step 1: Write the failing tests in `face/tests/seat.test.ts`**

`seatView`: "admitted: the key by name, its limit with what is left, the paper venue marked, this seat's cards and the others' count" (an `/api/account` body with `keys:[{address:'0xab', name:'Gravit', status:'ok', validUntil: 1_800_000_000_000}]`, `spend:[{agentName:'Gravit', scope:'trade', allow:['paper-1'], perPaymentUsd:100, budgetUsd:1000, spentUsd:100, reservedUsd:50, validUntil, expired:false}, {agentName:'Desk', …}]`, `venues:[{id:'paper-1', name:'Paper account · paper', paper:true, usd:10000}, {id:'okx', name:'OKX', usd:0}]`, `cards:[{id:'card-7', agentName:'Gravit', usd:56, reason:'…'}, {id:'card-8', agentName:'Desk'}]`, `mode:'guard'`, `connectLive:{writes:{on:true, capUsd:100}}`, `modeRules:{cardMinutes:30}` → status `admitted`, `limits[0].leftUsd === 850`, one limit, `venues[0].paper === true`, `cards.length === 1`, `others === 1`, `writes.capUsd === 100`, `cardMinutes === 30`); "knocking, expired, revoked, and a seat admitted under another name is absent"; "an odd shape never throws" (`seatView({}, …)`, `seatView(null, …)`, `seatView({keys: 'x', venues: [null]}, …)` → `seat.status === 'absent'`, empty lists). The route: "the fence refuses a foreign Origin with the fixed body"; "two reads within the TTL fetch once; ?fresh=1 fetches again"; "an unreachable service answers reachable:false with the error's code, never its text" (fetch rejects with `Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4820 secret'), { cause: { code: 'ECONNREFUSED' } })` → body has no `secret`, `error === 'ECONNREFUSED'`); "a hanging service is cut at the timeout" (a fetch that resolves only when its signal aborts → `error === 'timeout'`; use a fake `now` and a real but short timeout via `deps` — add `timeoutMs?: number` to deps for the test, default `SEAT_TIMEOUT_MS`); "a 403 and unparsable JSON say so".

- [ ] **Step 2: Run to verify they fail**

Run: `cd face && npx tsx --test tests/seat.test.ts 2>&1 | tail -4`
Expected: FAIL — cannot find module `../src/seat.ts`.

- [ ] **Step 3: Implement `seat.ts`; mount in `main.ts`**

`main.ts:168`: `registerSeatRoute(booted.ctx.webServer);` right after `disposeData = registerDataRoutes(...)`, with a comment that its defaults come from `account-seat.ts` and that `/data/seat.json` touches no key and no home.

- [ ] **Step 4: Run to verify they pass; typecheck**

Run: `cd face && npx tsx --test tests/seat.test.ts 2>&1 | tail -4 && npm run typecheck`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

`face: /data/seat.json, the Account seat's standing for the screen`.

---

### Task 7: The Account screen's seat box

**Files:**
- Create: `face/client/js/host/seat.js`
- Modify: `face/client/js/reducers/account.js` (`seatLoading`, `seatLoaded`, `seatFailed`), `face/client/js/data/empty.js:37` (`seat: { status: 'idle', data: null, at: null }`), `face/client/js/host/account-view.js` (`seatWords`), `face/client/js/render/account.js` (`venues()`), `face/client/js/app.js` (`startSeat`, the triggers at `:159`, `:309-310`, `:495-497`)
- Test: `face/tests/client/host-seat.test.js`, `face/tests/client/account-view.test.js`, `face/tests/client/account.test.js:106, 128`, `face/tests/client/app-dom.test.js`

**Interfaces:**
- Consumes: Task 6's `SeatView` shape; Task 5's `onReceipt(m)` with `m.data.seat`.
- Produces: `startSeat({ store, getJson, now })` → `{ load({ fresh } = {}) }` (one flight, the latest-started wins, as `startAccount.load`); the reducers; `seatWords(data, now)` → `{ service: '127.0.0.1:4820 · reachable' | '127.0.0.1:4820 · not reachable', mode: 'Guard' | 'Beast' | '', writes: 'Trading on · $100 a move' | 'Read-only' | '', seat: 'Gravit · admitted until Nov 19' | 'Gravit · knocking — admit it on the Account page' | 'Gravit · not on the account' | 'Gravit · expired' | 'Gravit · revoked', limits: ['trade · paper-1 · $100 an order · $850 of $1,000 left'], venues: [{ name, paper, usd: '$10,000' }], cards: '2 cards waiting' | '1 card waiting' | '', url }` (the host:port from `url`); the box in `venues()` after the Alpaca box: `<section class="cardbox" aria-label="Account seat"><div class="cardbox-title">Account seat</div><div class="venues">…rows…</div><div class="btn-row"><a class="btn-sm" href="<url>" target="_blank" rel="noopener">Open the Account page</a><button … data-action="refreshAccount">Refresh</button></div></section>`, a `Loading…` note while idle/loading, `As of 14:32 · stale` on error with data.

- [ ] **Step 1: Write the failing tests**

`host-seat.test.js` (mirror `host-account.test.js`'s rig): "load reads /data/seat.json once even when asked twice", "a fresh load reads ?fresh=1", "a failed read is error with the last data kept". `account-view.test.js`: "seatWords: each standing in its words" (the strings above, from `SeatView` fixtures). `account.test.js`: a `seat` option on `screen()` dispatching `seatLoaded`; "Venues: the Account seat box — not reachable; knocking; admitted with its limit, the paper venue, the cards and the link" (exact rows; `href="http://127.0.0.1:4820" target="_blank" rel="noopener"`; a `Paper` chip on `paper-1`, none on `okx`); change "no Guard, Beast, Trading on, Move, Receive, Connect or Memory" to assert the words absent with no seat read, and with a seat read `Guard` and `Trading on` only inside the `aria-label="Account seat"` section while `Beast`, `Move`, `Receive`, `Connect`, `Memory`, `openPanel` stay absent (a ruling: the Account's own mode words, from its read). `app-dom.test.js`: "entering Venues reads /data/seat.json; Refresh there reads it fresh; a seat receipt reloads it fresh and not the account" (the receipt via a `tool/call` + `tool/result` for `mcp__account__portfolio_live_order` answering `{ok:true, pending:true, card:{id:'card-1'}}`; assert the `getJson` paths).

- [ ] **Step 2: Run to verify they fail**

Run: `cd face && npx tsx --test tests/client/host-seat.test.js tests/client/account-view.test.js tests/client/account.test.js tests/client/app-dom.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `not ok` on the new tests.

- [ ] **Step 3: Implement**

`app.js`: `const seat = startSeat({ store, getJson, now });` beside `account`; `onReceipt: m => { if (m?.data?.seat) void seat.load({ fresh: true }); else void account.load({ fresh: true }); }`; in `follow()`: entering Venues also `void seat.load()`; `refreshAccount` on Venues also `void seat.load({ fresh: true })`.

- [ ] **Step 4: Run to verify they pass; the suite**

Run: `cd face && npm test 2>&1 | tail -6`
Expected: `# fail 0` (the reverse stylesheet check in `css.test.js` stays green: only existing classes).

- [ ] **Step 5: Commit**

`client: the Account seat box on Venues`.

---

### Task 8: What the agents read — GRAVIT.md, the mechanics guide, the records

**Files:**
- Modify: `GRAVIT.md` (one paragraph; the PIT paragraph's AKShare sentence), `ROADMAP.md` (the built log), `docs/superpowers/plans/2026-10-05-venue-plugins-unification-handoff.md` (the status line), `docs/superpowers/specs/2026-10-02-venue-plugins-design.md` (the status block)
- Create: `dsh/skills/mechanics/account-seat-guide/SKILL.md`
- Test: `face/tests/gravit-md.test.ts`

**Interfaces:**
- Consumes: nothing from the code.
- Produces: `GRAVIT.md` ≤ 4,500 bytes naming `mcp__account__`; the skill `name: account-seat-guide`, `description: How the Account seat's MCP tools behave — paper venues only, the two cards on every write, waiting on a card, what to ask the owner for and what never, the refusal codes that mean stop.`

- [ ] **Step 1: Write the failing test**

In `gravit-md.test.ts` add `test("GRAVIT.md names the Account seat and its rule", () => { assert.match(text, /mcp__account__/); assert.match(text, /paper/i); })`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd face && npx tsx --test tests/gravit-md.test.ts 2>&1 | grep -E "^not ok|^# fail"`
Expected: `not ok`.

- [ ] **Step 3: Write the paragraph and the guide**

`GRAVIT.md`: in "Point-in-time reads" make the AKShare sentence `The AKShare (\`mcp__akshare__*\`) and Account seat (\`mcp__account__*\`) tools are public, unguarded queries — never backtest evidence.` and add a section `## The Account seat` — `\`mcp__account__*\` is Gravit's seat at the operator's Account: paper venues only; every write stops for a card here and one there; after a \`card\` answer, \`portfolio_wait\`; read \`account-seat-guide\`.` Measure (`wc -c`) and trim elsewhere only if over 4,500. The guide (about 2 KB): the loop, the paper rule (name the paper venue; never a real one; never ask for `mode`, `leverage`, a `topup`, a real `venue`), the two cards and the 30-minute expiry, `portfolio_wait` (55 s at most, poll again), the codes that mean stop (`E_ACCOUNT_UNKNOWN_SIGNER` = not admitted, `E_MANDATE_*` = outside the limit, `E_WALLET_LIVE_WRITES_OFF` = the service is read-only, `E_ACCOUNT_CARD_EXPIRED`), the quotes' honesty (public, seconds old, no PIT guard, `paper: true` on paper orders and positions), what never (no key, no address of the operator's, no `portfolio_live_move`/`portfolio_pay`/`portfolio_live_earn` — the operator signs no such limit).
`ROADMAP.md` Part II: `2026-10-20 the Account seat (spec \`docs/superpowers/specs/2026-10-20-account-seat-design.md\`): Gravit as a seat at Linqi's Account through the \`mcp-account\` row, paper venues only, Gate 2 on every seat write, the seat box on Venues; the \`demo/\` submodule gone`. The handoff's status line and the v1 spec's status block gain one sentence: posture A taken on 2026-10-20 for paper venues only (the account-seat spec); C1–C5 for real money stay the next charter's.

- [ ] **Step 4: Run to verify it passes**

Run: `cd face && npx tsx --test tests/gravit-md.test.ts 2>&1 | tail -4 && wc -c ../GRAVIT.md`
Expected: PASS; ≤ 4500.

- [ ] **Step 5: Commit**

`docs: GRAVIT.md and the account-seat guide name the seat; the records`.

---

### Task 9: The seat smoke — the whole chain but the human

**Files:**
- Create: `face/tests/account-seat-smoke.test.ts`
- Modify: `face/package.json` (nothing: `npm test` globs `tests/*.test.ts`)
- Test: itself

**Interfaces:**
- Consumes: Task 2's row (replaced whole by an `extraPatches` id patch), Task 3's `auditOrderTools`, Task 6's `registerSeatRoute`, the order-gate smoke's session/answerer pattern (`order-gate-smoke.test.ts:150-262`), `tests/remote.ts` (`mountClient`, `signIn`, `remote`).
- Produces: a test gated `skip` unless `FACE_SMOKE === "1"` and `FACE_ACCOUNT_SEAT_DIR` names a directory holding `node_modules/tsx/dist/cli.mjs` and `test/standin/ui-standin.ts` (the skip reason says which is missing).

- [ ] **Step 1: Install the checkout the smoke reads**

Run (from the scratchpad clone, Linqi's main @ 133b9a7): `npm --prefix <scratchpad>/buyer-agent-demo ci 2>&1 | tail -3 && ls <scratchpad>/buyer-agent-demo/node_modules/tsx/dist/cli.mjs`
Expected: the install's summary line (about 292 packages) and the `cli.mjs` path printed. This is the operator's cofounder's repo the operator ran on this machine on 2026-10-07; its install scripts (ccxt, esbuild, optional bufferutil/fsevents) run here.

- [ ] **Step 2: Write the smoke**

```ts
test("account seat smoke: the seat mounts, its writes are gated, a read answers, an order without a grant is refused and with one becomes the Account's card", { skip, timeout: 240_000 }, async () => {
  // 1 the stand-in: spawn(process.execPath, [cli, "test/standin/ui-standin.ts", "--port", String(port), "--no-desk"], { cwd: dir }); read stdout until a line starts with "  page" (the URL) — also keep the "  home" line to rm it after
  // 2 a scratch DSH_HOME (setupFaceProfile), the sixteen-smoke patch (mcp-akshare and agent-default-model stub) WITHOUT disabling mcp-account
  // 3 bootFace({ profileName: "face", port: 0, dshHome: home, extraPatches: [{ id: ACCOUNT_SEAT_ROW_ID, config: { transport: "stdio", serverName: "account", command: process.execPath, args: [cli, "src/portfolio/mcp.ts"], cwd: dir, env: { PORTFOLIO_URL: url, PORTFOLIO_AGENT: "ui-standin-claude-code", PORTFOLIO_SEAT_KEYS: "sim", BUYER_HOME: seatHome }, toolCallTimeoutMs: 90_000, failOnStartupError: false } }] })
  // 4 poll tools.schemas() up to 90 s for "mcp__account__portfolio_account"; then assert 35 names start with mcp__account__ and auditOrderTools(schemas).gated contains all twelve mcp__account__ write names and no read
  // 5 session/create + turn/start as order-gate-smoke does; execute mcp__account__portfolio_account {} → parse the text: seat.authorised === true, paperVenues includes "paper-momentum"
  // 6 execute mcp__account__portfolio_live_markets { venue: "ex" } → the first market's symbol
  // 7 answer = "rejected": execute mcp__account__portfolio_live_order { venue: "ex", symbol, side: "buy", usd: 10 } → isError, text matches /the user rejected tool "mcp__account__portfolio_live_order"/; the card seen carries reason /^Account seat - .*venue=ex/
  // 8 answer = "allowed-once": the same → not isError; parsed text has pending === true and card.id matching /^card-/
  // 9 registerSeatRoute(ctx.webServer, { url, seatName: "Claude Code" }); GET /data/seat.json over the booted server (Host 127.0.0.1) → seat.status === "admitted", a venue "paper-momentum" with paper === true, cards.length >= 1
  // cleanup: dispose, SIGINT the stand-in, rm the scratch home and the stand-in's home
});
```

- [ ] **Step 3: Run it to see it fail first**

Run: `cd face && FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=<scratchpad>/buyer-agent-demo npx tsx --test tests/account-seat-smoke.test.ts 2>&1 | tail -20`
Expected: the first run fails somewhere real (the seat not connected within the wait, a wrong stand-in line, a venue id) — read the failure, fix the TEST's mechanics (a longer wait, the right line), never the assertions; a run that passes at once is read line by line for what it proved.

- [ ] **Step 4: Run it to pass; then the sixteen with the seat disabled**

Run: `cd face && FACE_SMOKE=1 FACE_ACCOUNT_SEAT_DIR=<scratchpad>/buyer-agent-demo npm test 2>&1 | tail -8`
Expected: `# fail 0`, `# skipped 0`, the seat smoke among the passes; the operator's real `~/.buyer-agent-demo` untouched (`ls ~/.buyer-agent-demo/seats` shows no new file — check before and after).

- [ ] **Step 5: Commit**

`face: the Account seat smoke against the stand-in`.

---

### Task 10: The measurements

**Files:**
- Modify: nothing yet (the numbers go into Task 11's documents); the SDD ledger records them.

- [ ] **Step 1: Price the seat's tool block**

Run: `SCRATCH=$(mktemp -d); cd face && npx tsx -e "import('./src/setup.ts').then(m => m.setupFaceProfile('$SCRATCH'))"` — or the equivalent scratchpad script — then `DSH_HOME=$SCRATCH FACE_ACCOUNT_SEAT_DIR=<scratchpad>/buyer-agent-demo FACE_ACCOUNT_URL=http://127.0.0.1:4 npx tsx scripts/schema-sizes.ts | tail -9` (no service at port 4: the seat registers its 35 tools and reaches nothing; the scratch profile's patch must disable `mcp-akshare` as the smokes do, so only the seat is measured beside the host).
Expected: a `mcp__account__` group line with 35 tools and its bytes, bytes/4 and chars/4; the host group unchanged (26 tools, 23,468 bytes); the total.

- [ ] **Step 2: Record**

Append to the ledger: the three numbers, the largest five seat tools, the date, and `GRAVIT.md`'s byte count after Task 8.

---

### Task 11: The documents

**Files:**
- Modify: `DEVELOPMENT.md` (§3.1 the row prose beside AKShare's at L383-393; §3.6 a tools row after L522; §4.2 rows for `account-seat.ts` and `seat.ts`; §4.3 the group table L1137-1144 gains the measured `mcp__account__` row and a sentence; §4.4 a route row for `GET /data/seat.json`; §4.6 and Appendix A the two env vars; §4.7 the seat's names and reason; §5.1 rows for `host/seat.js` and the Venues box; §5.3 the kind table's `approval` row and a `receipt` sentence; §7.3 the two smokes; §7.4 drill rows — `**Account seat** — automated` (the seat smoke: passes <date> against buyer-agent-demo @ 133b9a7's stand-in) and `**Account seat** — manual` (the operator's keyed drill, not yet run); §9 R32 (two cards per write), R33 (the Account moves fast; the gate's raw list and the smoke canary), R34 (the seat's key written outside the workspace by a child of the face; name-matching the seat), R35 (the service's own egress); §10 item 17; the §3.3 `GRAVIT.md` byte count; the test counts), `Gravit-Design.md` (§1 ACCOUNT, §3 box, §4 a row, §5 D17, §7.3, §8, §9), `face/README.md` ("The Account seat" after "AKShare MCP": the install — clone, `npm ci`, `npm run account` with no real venue connected and `--live-cap 1` as a belt for the paper stage, the pairing code, open a paper venue, admit the seat as **Gravit** when it knocks, sign it a `trade` limit naming the paper venue; the env; what the service does on its own — the venue probes every thirty minutes, the location lookups, the public quotes; `/data/plugins.json` as the check; the seat smoke and when to re-run it; "The account-seat drill" with the steps and what is proved), the Account section (the seat box), `Gravit-Docs-and-Prompt-Loops.html` (the tool block's station names the seat's 35 schemas)
- Test: `cd face && npm test` (the test counts in DEVELOPMENT.md must match)

- [ ] **Step 1: Write the documents** (the exact words are the implementer's; the facts come from the tasks above and Task 10's numbers)

- [ ] **Step 2: Check**

Run: `grep -c "mcp-account\|seat.json\|R32\|R35\|account-seat" DEVELOPMENT.md face/README.md Gravit-Design.md; cd face && npm test 2>&1 | tail -6 && npm run typecheck`
Expected: every file counts > 0; `# fail 0`; typecheck clean; the counts written in DEVELOPMENT.md §7.3 equal the run's.

- [ ] **Step 3: Commit**

`docs: the Account seat — DEVELOPMENT, the charter's amendments, the install and the drill`.

---

### Task 12: The look, and the ledger

**Files:**
- Create: `docs/superpowers/plans/2026-10-20-account-seat-ledger.md` (pre-flight, rulings, the tasks' commits and counts, the look, the measurements)

- [ ] **Step 1: The look** — the stand-in on 4821 (`--no-desk`) from the scratchpad checkout; a keyless face on a scratch home (`FACE_PORT` free, `FACE_ACCOUNT_SEAT_DIR` the checkout, `FACE_ACCOUNT_URL` the stand-in, and a home patch `- id: mcp-account` whose `config` is the row's with `BUYER_HOME` pointed at a scratch directory, so the seat's real key lands there and never in `~/.buyer-agent-demo`) in the background; the browser pane at the tokenized URL. Account › Venues first reads `not reachable` (the stand-in not yet up) → start it → `reachable` and `Gravit · not on the account`. The seat knocks only on a tool call and a keyless face makes none, so a scratchpad script (the checkout's own `@modelcontextprotocol/sdk` client over stdio, the same command, env and `BUYER_HOME` as the row's) calls `portfolio_account` once: the box reads `knocking — admit it on the Account page`; on the stand-in's page (paired with its printed code) admit **Gravit** and sign it a `trade` limit on `paper-momentum`: the box reads `admitted until …` with the limit, the paper venue chip and the link; then the script places a $10 paper order there: the stand-in's Guard card appears on its Portfolio, the box counts `1 card waiting`, approving it fills the order and `portfolio_wait` returns — the Account-side human half, rehearsed on the stand-in with real signatures. Discover's MCP shelf lists `account` with 35 tools. Stop the stand-in → Refresh → `not reachable`. The knock script stays in the scratchpad.
- [ ] **Step 2: The ledger**, then the final review (executing-plans: a fresh reviewer on the most capable model over the whole branch; re-grade; one fix pass; the deferred minors).
