# The Account's two parts, plan 3 — AKShare in the Account box and the seat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent box runs no AKShare: the Account runs `akshare-mcp` as its own MCP child over stdio and answers two reads (`GET /api/akshare/tools`, `POST /api/akshare/call`), the seat gains one read tool (`portfolio_akshare`, `tool` plus `arguments`) that Gravit's 14 `mcp__akshare__*` tools become, and the face loses the `mcp-akshare` row, its wiring, its tests and the uv / Python 3.12 / `akshare-mcp` install in `face/Dockerfile`.

**Architecture:** One new Account module, `account/src/portfolio/live/akshare.ts`, holds the sidecar: an MCP SDK `Client` over `StdioClientTransport` (the SDK is already the Account's dependency, `account/package.json`; its client is what `test/portfolio-mcp-real.test.ts` already uses), started on first use, forgotten when the child exits and started again on the next use, every ask bounded by one 120 s deadline. `server.ts` mounts it as an injected option (`PortfolioServerOptions.akshare`, the way plan 2 mounted `cn`): absent, both routes answer `off` and never spawn. The seat (`mcp.ts`) posts to the call route and hands the sidecar's own `content` back unwrapped. The face classifies the new tool as a read (`SEAT_READ_RAW_NAMES`), keeps it from the roles (the `NEVER` table), widens the seat row's call timeout past the Account's deadline, and deletes everything that mounted AKShare itself.

**Tech Stack:** `account/`: Node 22, TypeScript, express, `@modelcontextprotocol/sdk` 1.32 (client and server), zod 4, vitest (`npm test`, `npm run typecheck`). `face/`: Node 22, dsh 0.2.0-rc.2, `node --test` via tsx (`npm test`, `npm run typecheck`; `FACE_SMOKE=1` for the real boots). Docker files read offline by `face/tests/compose.test.ts`.

**Spec:** `docs/superpowers/specs/2026-11-01-account-two-parts-design.md` (§4.3; §3 goals 1 and 4; §4.5's done lines on the agent image and on Gravit through the seat; §6; §9 calls 4 and 11; §10 "the sidecar's supervision details"). Conventions from plans 1 and 2: `docs/superpowers/plans/2026-11-01-account-two-parts-plan-1-china.md`, `-plan-2-lunhui.md`.

## Global Constraints

- The sidecar is `akshare-mcp` at `xiaozhozho/akshare-mcp @ 9b6a22b6d83cce2a996a5072743bb06686040ce0`, installed with `uv tool install --python 3.12 --with 'mcp<2'` (the face image's line today, `face/Dockerfile:12-14`). Its 14 tools, read from that pin's `akshare_mcp/server.py` and `tools/registry.py`: `akshare_discover`, `akshare_stock_a`, `akshare_stock_fundamental`, `akshare_stock_hk_us`, `akshare_stock_board_flow`, `akshare_stock_margin_other`, `akshare_macro`, `akshare_futures`, `akshare_fund`, `akshare_bond`, `akshare_index`, `akshare_option`, `akshare_fx_commodity`, `akshare_other`. A category tool takes `method`, `params_json` (a JSON string, default `"{}"`), `symbol`, `start_date`, `end_date`, `period`, `adjust`, `date`; `akshare_discover` takes `query` (empty: the whole index).
- The command is `PORTFOLIO_AKSHARE_BIN` from the Account's environment (the `PORTFOLIO_MM_BIN` precedent, `live/metamask.ts:175`), default `join(homedir(), ".local", "bin", "akshare-mcp")`; argv only, no shell, no arguments. The account image sets `PORTFOLIO_AKSHARE_BIN=/usr/local/bin/akshare-mcp`.
- The child's environment is the Account's own with every name matching `/KEY|SECRET|TOKEN|PASSWORD/i` dropped (the rule the face's dsh-mcp-client applied to it, `face/src/account-seat.ts:31-33`), plus `PYTHONUNBUFFERED=1` and `AKSHARE_MCP_MAX_ROWS=500`. The iFinD token the Account holds since plan 2 (`IFIND_ACCESS_TOKEN` / `IFIND_REFRESH_TOKEN`) never reaches it. Its stderr is inherited (the Account's terminal, or `docker compose logs account`).
- Every ask — a cold start, the tool listing, the call — is bounded by one deadline, `AKSHARE_CALL_MS = 120_000`; a reply whose `content` serializes past `AKSHARE_REPLY_MAX = 4 MiB` is refused `too-large`; `arguments` serializing past `AKSHARE_ARGS_MAX = 16 KiB` are refused `bad-arguments`.
- The two routes are reads: no write, no ledger line, no card; they work on a `--read-only` Account and sit behind the Host fence (`server.ts:474-492`) like every `/api/` route. Refusals are the routes' own words, `{ ok: false, akshare: <word>, message }`, with no new code in `account/src/core/errors.ts` (plan 2's rule).
- The seat gains exactly one tool, `portfolio_akshare`, `annotations: { readOnlyHint: true }`; no seat tool is renamed or removed; the seat smoke's count goes 35 → 36. The face classifies it as a read (`face/src/orders.ts` `SEAT_READ_RAW_NAMES`): no Gate 2 card, and Gate 2 is otherwise unchanged.
- A role never carries AKShare: the `NEVER` rule (`face/src/roles.ts:109-111`) names `portfolio_akshare` under any server name and keeps the `mcp__akshare__` prefix (an operator's own AKShare row).
- The face composes no AKShare row and runs no AKShare process; the agent image carries no `akshare-mcp`, no uv and no `--python 3.12` install (the base image's own `python3` stays, §9 call 11). Nothing falls back to a face-side AKShare when the Account is down (§3 anti-goal).
- `GRAVIT.md` stays within 4,500 bytes (`face/tests/gravit-md.test.ts`); `bots/gravit/agent.cordis.yml` is regenerated by `cd face && npm run render:roles`, never hand-edited.
- Tests are offline and need no Python: the Account's tests run a stand-in MCP child (`account/test/fixtures/fake-akshare-mcp.mjs`, plain `.mjs` on `process.execPath` over the Account's own SDK); the face's tests never spawn AKShare.
- `account/` suite green but for the known red `test/unit/ui-superagent.test.ts`; `face/` suite and typecheck green; the `FACE_SMOKE=1` boots green.
- Work on `feat/two-parts-3` from local `main` (4ca91592) in a worktree; never push; never touch `strategies/*` or a sealed run; never edit `~/.dsh` or `.claude/launch.json` (the docs say what the operator changes); commit messages written to a file in the session scratchpad and committed with `git commit -F <file>`, no backticks, no attribution lines.
- `feat/desk-p1-p4` overlaps this plan in `face/src/boot.ts`, `face/src/orders.ts` and `GRAVIT.md` (the spec's six-file overlap, §7): whichever lands second resolves them. `face/src/agents.ts`, `http.ts` and `main.ts` are not edited. Plans 4–5 are out of scope: the charter (`Gravit-Design.md`) and the loops page (`Gravit-Docs-and-Prompt-Loops.html`) move with plan 5's documents (spec §8).

## Review Focus

- **The sidecar dies** — a Python crash, an OOM kill, or the operator killing the process: a call in flight must come back `unavailable` (never a promise that hangs until the 120 s deadline or forever), and the next call must start a fresh child and answer. Test in Task 1 (`exit` method, then a second call on a new pid).
- **`akshare-mcp` not installed where the Account runs** — the host Mac without `~/.local/bin/akshare-mcp`, or an account image built before Task 6: every ask refuses `unavailable` within a second, naming the command, and the Account serves everything else on; nothing is cached, so installing it and asking again works without a restart. Tests in Task 1 (ENOENT) and Task 2 (the route).
- **The Account's secrets reaching the child** — since plan 2 the Account's environment holds the iFinD token; a Python package with network access must not inherit it. Test in Task 1 (a `IFIND_ACCESS_TOKEN` and a `SOME_API_KEY` set in the parent are absent from the child's environment; `PATH`, `HOME`, `AKSHARE_MCP_MAX_ROWS=500` present).
- **Two calls at once on a cold sidecar** — Gravit issues parallel tool calls (drill 3 caught it running two modules at once): one child is started, not two, and both calls are answered. Test in Task 1.
- **An Account started before this plan** — the face no longer mounts AKShare, but the operator's running Account (4820) is an older process with no `/api/akshare/*`: the seat tool must say to restart the Account from this tree, not fail to parse express's 404 page or answer an empty result. Test in Task 3.

---

## File structure

| File | Responsibility |
|---|---|
| `account/src/portfolio/live/akshare.ts` (new) | the sidecar: the tool list, the command, the child's environment, start-on-use, forget-on-exit, the deadline and the caps — `createAkshare` |
| `account/test/fixtures/fake-akshare-mcp.mjs` (new) | the stand-in MCP child (two of the real tool names, plus methods that sleep, exit, flood, report their pid and environment) |
| `account/test/unit/akshare.test.ts`, `akshare-routes.test.ts`, `account/test/akshare-seat.test.ts` (new) | vitest |
| `account/src/portfolio/server.ts` (modify) | `PortfolioServerOptions.akshare`, the two routes, `close()`, the real entry's wiring and its start line |
| `account/src/portfolio/mcp.ts` (modify) | the seat's `portfolio_akshare` |
| `account/test/portfolio-mcp-real.test.ts` (modify) | the passthrough on a server without the sidecar |
| `face/src/orders.ts`, `face/src/roles.ts`, `face/src/account-seat.ts` (modify) | the read, the never-list, the seat row's timeout and comments |
| `face/src/akshare.ts` (delete); `face/src/boot.ts`, `setup.ts`, `policy.ts`, `face/scripts/check-home.ts`, `schema-sizes.ts` (modify) | the row leaves |
| `face/tests/*` (modify) | `boot`, `check-home`, `orders`, `roles`, `bots`, `compose`, `account-seat-smoke`, and the smokes that disable `mcp-akshare` |
| `face/Dockerfile`, `account/Dockerfile`, `compose.yml` (modify) | the install moves box |
| `GRAVIT.md`, `dsh/profile/cycle.md`, `bots/gravit/agent.cordis.yml` (rendered), `dsh/README.md`, `dsh/profile/cordis.yml`, `roles/_template/README.md`, `CLAUDE.md`, `DEVELOPMENT.md`, `face/README.md`, `account/README.md` (modify) | the prompts and the documents |

---

### Task 1: The sidecar in the Account

**Files:**
- Create: `account/src/portfolio/live/akshare.ts`
- Create: `account/test/fixtures/fake-akshare-mcp.mjs`
- Test: `account/test/unit/akshare.test.ts`

**Interfaces:**
- Consumes: `Client` (`@modelcontextprotocol/sdk/client/index.js`), `StdioClientTransport` (`@modelcontextprotocol/sdk/client/stdio.js`); `McpServer`, `StdioServerTransport` and `zod` in the fixture.
- Produces:
  ```ts
  export const AKSHARE_TOOLS: readonly string[]; // the 14 names of Global Constraints, in that order
  export const AKSHARE_CALL_MS = 120_000, AKSHARE_REPLY_MAX = 4 * 1024 * 1024, AKSHARE_ARGS_MAX = 16 * 1024;
  export function akshareCommand(env?: NodeJS.ProcessEnv): string;          // PORTFOLIO_AKSHARE_BIN || ~/.local/bin/akshare-mcp
  export function sidecarEnv(env: NodeJS.ProcessEnv): Record<string, string>; // the scrub, then PYTHONUNBUFFERED=1, AKSHARE_MCP_MAX_ROWS=500
  export type AkshareWord = "off" | "unknown-tool" | "bad-arguments" | "unavailable" | "timeout" | "too-large";
  export interface AkshareTool { name: string; description?: string; inputSchema: unknown }
  export type AkshareAnswer<T> = { kind: "ok"; value: T } | { kind: "refused"; word: AkshareWord; message: string };
  export interface AkshareCall { isError: boolean; content: unknown[] }
  export interface Akshare {
    tools(signal?: AbortSignal): Promise<AkshareAnswer<AkshareTool[]>>;
    call(tool: string, args: unknown, signal?: AbortSignal): Promise<AkshareAnswer<AkshareCall>>;
    close(): Promise<void>;
  }
  export function createAkshare(opts: { command: string; args?: string[]; env?: NodeJS.ProcessEnv; callMs?: number }): Akshare;
  ```

- [ ] **Step 1: Write the stand-in child** `fake-akshare-mcp.mjs`: an `McpServer` named `akshare MCP Server` with instructions, over `StdioServerTransport`, registering `akshare_discover({ query?: string })` → text `JSON.stringify({ query, pid: process.pid, env: Object.keys(process.env).sort(), maxRows: process.env.AKSHARE_MCP_MAX_ROWS })`, and `akshare_stock_a({ method: string, params_json?: string, symbol?: string })` whose methods are: `stock_zh_a_spot_tx` → text `JSON.stringify({ rows: [{ 代码: "600519", 名称: "贵州茅台" }], row_count: 1, truncated: false })`; `fails` → `{ isError: true, content: [{ type: "text", text: "{\"error\":\"upstream refused\"}" }] }`; `sleep` → never answers within 10 s; `exit` → `process.exit(3)` before answering; `flood` → a text of 5 MiB. If `FAKE_AKSHARE_START_LOG` is set, it appends one line (its pid) to that file at start.
- [ ] **Step 2: Write the failing tests** in `akshare.test.ts` (vitest; the fixture run as `{ command: process.execPath, args: [<fixture path>] }`; every `createAkshare` closed in `afterEach`):
  - `AKSHARE_TOOLS names the pin's fourteen tools` — deepEqual to the list of Global Constraints.
  - `akshareCommand reads PORTFOLIO_AKSHARE_BIN, else ~/.local/bin/akshare-mcp` — `{ PORTFOLIO_AKSHARE_BIN: "/opt/x" }` → `"/opt/x"`; `{}` → `join(homedir(), ".local", "bin", "akshare-mcp")`; `{ PORTFOLIO_AKSHARE_BIN: "" }` → the default.
  - `the child inherits no secret` — with the parent env holding `IFIND_ACCESS_TOKEN`, `IFIND_REFRESH_TOKEN`, `SOME_API_KEY`, `DB_PASSWORD`, `X_SECRET` (passed as `opts.env`), `call("akshare_discover", {})`'s text: `env` contains `PATH`, `HOME`, `PYTHONUNBUFFERED`, `AKSHARE_MCP_MAX_ROWS` and none of the five; `maxRows === "500"`. Also `sidecarEnv` unit: the same five dropped, case-insensitively (`ifind_access_token`).
  - `tools lists the child's tools` — `kind: "ok"`, names `["akshare_discover", "akshare_stock_a"]`, each with an `inputSchema`.
  - `a call answers the child's content unchanged` — `call("akshare_stock_a", { method: "stock_zh_a_spot_tx" })` → `{ kind: "ok", value: { isError: false, content: [{ type: "text", text }] } }`, `JSON.parse(text).rows[0].名称 === "贵州茅台"`; `method: "fails"` → `kind: "ok"`, `isError: true` (a tool's own error is an answer, not a refusal).
  - `an unknown tool or bad arguments are refused before the child is asked` — `call("akshare_nope", {})` → `unknown-tool` (the message names the tool); `call("akshare_stock_a", [])`, `call("akshare_stock_a", "x")` and arguments of 17 KiB → `bad-arguments`; `call("akshare_discover", undefined)` is `{}` and answers.
  - `two calls on a cold sidecar start one child` — `FAKE_AKSHARE_START_LOG` set to a temp file; `Promise.all` of two `call("akshare_discover", {})`: both `ok`, the same `pid`, the log has one line.
  - `a child that exits mid-call is unavailable, and the next call starts a new one` — `call("akshare_stock_a", { method: "exit" })` → `unavailable` within 2 s; then `call("akshare_discover", {})` → `ok` with a different `pid`; the log has two lines.
  - `a missing command is unavailable, quickly, and is tried again next time` — `command: "/nonexistent/akshare-mcp"`: `tools()` and `call(...)` each → `unavailable` within 1 s, message containing `/nonexistent/akshare-mcp`; a second `call` refuses the same way (no cached state that would outlive an install).
  - `the deadline bounds the whole ask` — `callMs: 300`: `call("akshare_stock_a", { method: "sleep" })` → `timeout` within 1 s; a following `call("akshare_discover", {})` answers.
  - `an abort ends the ask` — an `AbortController` aborted 50 ms into `method: "sleep"` → `timeout` within 500 ms.
  - `a reply past 4 MiB is refused` — `method: "flood"` → `too-large`.
  - `close ends the child` — after `close()`, the fixture's pid is gone (`process.kill(pid, 0)` throws within 2 s); a `call` after `close()` starts again (the server's lifetime owns it).
- [ ] **Step 3: Run them and see them fail.** `cd account && npx vitest run test/unit/akshare.test.ts` — FAIL: the module does not exist.
- [ ] **Step 4: Implement `createAkshare`.** One `Promise<Connected>` shared by every caller while a child lives; `client.onclose` (the child's exit) forgets it, so the next ask starts a new child — no eager restart, no restart loop. A start that fails forgets itself too. The tool listing is cached per child; `call` checks `tool` against it (`unknown-tool`) after the shape checks (`tool` a string of at most 64 characters, `args` a plain object or `undefined`, at most `AKSHARE_ARGS_MAX` serialized). The deadline is one `AbortSignal.timeout(callMs)` combined with the caller's signal (`AbortSignal.any`) and handed to `connect` and to `client.callTool(params, undefined, { signal, timeout: callMs })`; an abort or the SDK's `RequestTimeout` is `timeout`; a spawn error, a closed connection or any other transport failure is `unavailable` with the command in the message. `StdioClientTransport` gets `{ command, args, env: sidecarEnv(opts.env ?? process.env), stderr: "inherit" }` (it merges the SDK's default environment, which the scrub already contains). Header comment: what the sidecar is, where the pin and the install line live (`account/README.md`), and that a timeout leaves the Python call running in the child.
- [ ] **Step 5: Run them and see them pass**, then `npm run typecheck`.
- [ ] **Step 6: Commit.** Message: `feat(account): the AKShare sidecar - akshare-mcp as the Account's MCP child, started on use, bounded`.

---

### Task 2: The two routes

**Files:**
- Modify: `account/src/portfolio/server.ts` (`PortfolioServerOptions` :288-303; the routes beside `/api/cn/*`, :506-537; `close` :1142-1160; the real entry :1180-1185 and its start lines)
- Test: `account/test/unit/akshare-routes.test.ts`

**Interfaces:**
- Consumes: `Akshare`, `AkshareWord`, `createAkshare`, `akshareCommand` (Task 1).
- Produces (the wire the seat reads in Task 3):
  - `PortfolioServerOptions.akshare?: Akshare | undefined` — absent (every existing test, the demos): both routes refuse `off`, no child is ever spawned.
  - `GET /api/akshare/tools` → `200 { ok: true, tools: AkshareTool[] }`.
  - `POST /api/akshare/call` body `{ tool: string, arguments?: object }` → `200 { ok: true, tool, isError, content }` (the child's content unchanged; `isError` the tool's own).
  - Refusals → `{ ok: false, akshare: word, message }` at `AKSHARE_STATUS = { off: 503, "unknown-tool": 400, "bad-arguments": 400, unavailable: 503, timeout: 504, "too-large": 502 }`.
  - The handle's `close()` awaits `opts.akshare?.close()`.
  - The real entry passes `akshare: createAkshare({ command: akshareCommand() })` and prints one start line: `AKShare: <command> · started on first use (/api/akshare/tools, /api/akshare/call)`.

- [ ] **Step 1: Write the failing tests** (the `cn-routes.test.ts` style: `PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: … })`, `startPortfolioServer({ port: 0, service, akshare })` with a recording stub `Akshare`, and one case on the real `createAkshare` over the fixture):
  - `the call route passes the tool's answer through` — stub answers `{ kind: "ok", value: { isError: false, content: [{ type: "text", text: "{\"row_count\":1}" }] } }`: `200`, body `{ ok: true, tool: "akshare_stock_a", isError: false, content: [...] }`; the stub saw `("akshare_stock_a", { method: "stock_zh_a_spot_tx" })`; a body with no `arguments` reaches the stub as `undefined`.
  - `the tools route lists the sidecar's tools` — stub `tools()` answer comes back as `{ ok: true, tools }`.
  - `refusals carry their word and status` — each `AkshareWord` from the stub maps to `AKSHARE_STATUS`; a body whose `tool` is not a string → `400 bad-arguments` without asking the stub.
  - `without a sidecar both routes answer off, and nothing is spawned` — no `akshare` option: `GET` and `POST` → `503 { ok: false, akshare: "off" }`.
  - `are behind the fence` — `Host: evil.example:4820` → `403` for both; an `Origin: https://evil.example` POST → `403`; the stub never called.
  - `answer on a read-only service` — the read-only service of `cn-routes.test.ts` (no `liveWrites`): both answer.
  - `a caller that goes away aborts the ask` — the request destroyed mid-call: the stub's `signal` is aborted.
  - `the server's close ends the sidecar` — on the real `createAkshare` over the fixture: one call answered through the route, then `srv.close()`; the fixture's pid is gone within 2 s.
- [ ] **Step 2: Run them and see them fail.** `cd account && npx vitest run test/unit/akshare-routes.test.ts` — FAIL: 404.
- [ ] **Step 3: Implement** the option, the two routes (after the `/api/cn/*` pair, under a comment: two reads, nothing written, the sidecar's answer unchanged), the `res.on("close")` abort as the relay route does, `close()`, the real entry and its line. `--classic` gets the sidecar too (it is a read the seat may ask in either mode).
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck` — green but the known red `ui-superagent`.
- [ ] **Step 5: Commit.** Message: `feat(account): two AKShare reads - the sidecar's tools and a call, behind the Host fence`.

---

### Task 3: The seat's passthrough

**Files:**
- Modify: `account/src/portfolio/mcp.ts` (one `registerTool` after `portfolio_candles`, :888-913, in the market reads)
- Modify: `account/test/portfolio-mcp-real.test.ts`
- Create: `account/test/akshare-seat.test.ts`

**Interfaces:**
- Consumes: `AKSHARE_TOOLS` (Task 1); `POST /api/akshare/call` (Task 2); the seat's `call()` (:71-76) and `text()` (:78).
- Produces: the seat tool `portfolio_akshare`, `inputSchema: { tool: z.string().max(64), arguments: z.record(z.string(), z.unknown()).optional() }`, `annotations: { readOnlyHint: true }`. On `{ ok: true }` it returns `{ isError: body.isError === true, content: body.content }` — the sidecar's content as is, never re-stringified inside the seat's JSON. On `{ ok: false, akshare }` it returns `text({ ok: false, akshare, message }, true)`. On a 404 it returns `text({ ok: false, error: "this Account has no AKShare sidecar (/api/akshare): restart it from this tree" }, true)`; any other status ≥ 400 `text({ ok: false, error: \`HTTP ${status}\` }, true)`.
- The description (exact copy, the tool list joined from `AKSHARE_TOOLS` with `", "`):
  > AKSHARE — public Chinese market data through the Account's AKShare sidecar (akshare-mcp): A shares, Hong Kong and US listings, boards and fund flows, margin, fundamentals, macro, futures, funds, bonds, indices, options, FX and commodities. `tool` is one of the sidecar's tools — {AKSHARE_TOOLS} — and `arguments` are that tool's own. Find a function first with akshare_discover (`{query: "spot"}`; an empty query lists every tool and its functions), then call its tool with `{method: "<function>", params_json?: "<its parameters as JSON>", symbol?, start_date?, end_date?, period?, adjust?, date?}`: `{tool: "akshare_stock_a", arguments: {method: "stock_zh_a_spot_tx"}}` is Tencent's whole A-share snapshot. At most 500 rows come back — check `truncated` and `row_count`; each call is bounded at 120 s. Live and unguarded, never evidence of a trade: check each result's errors and timestamps; retrieval time is not exchange time. A read: nothing is ordered.

- [ ] **Step 1: Write the failing tests.**
  - `portfolio-mcp-real.test.ts`, new case `the seat passes AKShare through, and says so where the Account runs none` — `listTools()` holds `portfolio_akshare` with `annotations.readOnlyHint === true`, its description containing every name of `AKSHARE_TOOLS`, `akshare_discover`, `500 rows` and `120 s`; `tool("portfolio_akshare", { tool: "akshare_discover" })` → `error: true`, `body` `{ ok: false, akshare: "off" }` (this file's server has no sidecar). In the file's first case, the `arrayContaining` list gains `portfolio_akshare`.
  - `akshare-seat.test.ts` — a server built as `portfolio-mcp-real.test.ts` builds one (no venues needed), `akshare: createAkshare({ command: process.execPath, args: [<fixture>] })`, the seat spawned over stdio as there (`node_modules/.bin/tsx src/portfolio/mcp.ts`, `PORTFOLIO_URL`, `BUYER_HOME` a temp home):
    - `Gravit asks AKShare through the seat` — `callTool({ name: "portfolio_akshare", arguments: { tool: "akshare_stock_a", arguments: { method: "stock_zh_a_spot_tx" } } })` → `isError` false, `content[0].text` parses to the fixture's rows (the 名称 intact — one JSON layer, not two).
    - `a tool's own error stays the tool's` — `method: "fails"` → `isError: true`, `content[0].text` the fixture's error text.
    - `a refusal is the Account's word` — `{ tool: "akshare_nope" }` → `isError: true`, body `{ ok: false, akshare: "unknown-tool" }`.
  - `akshare-seat.test.ts`, `an Account without the routes says to restart it` — the seat pointed (`PORTFOLIO_URL`) at a bare `http.createServer` answering every request `404` with an HTML body: `portfolio_akshare` → `isError: true`, body `error` matching `/restart it from this tree/`.
- [ ] **Step 2: Run them and see them fail.** `cd account && npx vitest run test/akshare-seat.test.ts test/portfolio-mcp-real.test.ts` — FAIL: no such tool.
- [ ] **Step 3: Implement the tool.**
- [ ] **Step 4: Run them and see them pass**, then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(account): the seat's portfolio_akshare - one read passing a tool and its arguments to the sidecar`.

---

### Task 4: The face takes the passthrough as a read, keeps it from the roles

**Files:**
- Modify: `face/src/orders.ts` (`SEAT_READ_RAW_NAMES` :61-68; the header's "the seat's reads and words, AKShare," :9)
- Modify: `face/src/roles.ts` (the `NEVER` table :88-112, its header :27)
- Modify: `face/src/account-seat.ts` (`toolCallTimeoutMs` :117; the header's "35 real-account tools" :21 and "Composed beside the AKShare row" :12)
- Test: `face/tests/orders.test.ts`, `roles.test.ts`, `bots.test.ts:104`, `boot.test.ts:240`, `account-seat-smoke.test.ts:74-89`

**Interfaces:**
- Consumes: the seat tool `portfolio_akshare` (Task 3).
- Produces: `SEAT_READ_RAW_NAMES` ends `..., "portfolio_openness", "portfolio_akshare"`; the `NEVER` AKShare rule `{ what: "an AKShare tool", because: <unchanged>, names: [], prefixes: ["mcp__akshare__"], rawNames: ["portfolio_akshare"] }`, moved ABOVE the account rule so `neverCarries` gives the AKShare reason for `mcp__account__portfolio_akshare` (the first matching rule's words are the refusal's); the seat row's `toolCallTimeoutMs: 130_000` (the Account's 120 s AKShare deadline plus margin; `portfolio_wait`'s 55 s still fits).

- [ ] **Step 1: Write the failing tests.**
  - `orders.test.ts`: `the seat's AKShare passthrough is a read: no card, covered` — `isOrderTool("mcp__account__portfolio_akshare") === false`; `auditOrderTools([{ name: "mcp__account__portfolio_akshare" }])` has `gated: []` and `uncovered: []`.
  - `roles.test.ts`: in `readRoles refuses every tool a role never carries…` the entry list gains `"mcp__account__portfolio_akshare"` and `"mcp__broker__portfolio_akshare"`, and a new assertion that both refusals' messages contain `a role never carries an AKShare tool`; the shipped-roles check (:167) also refuses a name ending `__portfolio_akshare`.
  - `bots.test.ts:104`: `mcp__akshare__stock_zh_a_hist` in `known` becomes `mcp__account__portfolio_akshare` (the assertions are unchanged).
  - `boot.test.ts:240`: `toolCallTimeoutMs` `130_000`.
  - `account-seat-smoke.test.ts`: `seatNames.length` `36` (the message and the comment at :74 say 36); `portfolio_akshare` among `seatNames`; the existing `gatedSeat` and `uncovered` assertions unchanged (they now prove the new tool is not carded).
- [ ] **Step 2: Run them and see them fail.** `cd face && node --import tsx --test tests/orders.test.ts tests/roles.test.ts tests/boot.test.ts` — FAIL.
- [ ] **Step 3: Implement** the list entry, the moved rule, the timeout, and the comments (orders.ts: the seat's reads — AKShare's passthrough among them — pass untouched; account-seat.ts: 36 tools, the 130 s timeout and why; roles.ts header: the AKShare tools, the seat's passthrough included).
- [ ] **Step 4: Run them and see them pass**; then `FACE_SMOKE=1 node --import tsx --test tests/account-seat-smoke.test.ts` — PASS with 36 (it spawns the seat from this worktree's `account/`, so Task 3 is in it); then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(face): the seat's AKShare passthrough is a read - no Gate 2 card, never a role's, a 130 s seat call`.

---

### Task 5: The `mcp-akshare` row leaves the face

**Files:**
- Delete: `face/src/akshare.ts`
- Modify: `face/src/boot.ts` (the import :129, `composeFace`'s JSDoc :286, `marketPatches` :346-348 and its two uses :359, :370)
- Modify: `face/scripts/check-home.ts` (:30, :60, :69-70, `mcpRowIdsToDisable` :470-475), `face/scripts/schema-sizes.ts` (:3, :14, `GROUPS` :33)
- Modify: `face/src/setup.ts` (`PATCH_HEADER` :43-44), `face/src/policy.ts` (:10), `face/tests/fixtures/midboot-slow-row.js` (:5-6, the comment)
- Test: `face/tests/boot.test.ts` (:11, :166-213), `check-home.test.ts` (:26, :291-310), and every test that patches `- id: mcp-akshare\n  disabled: true` (`grep -ln "mcp-akshare" face/tests` — twenty smokes and `order-gate.test.ts`; `check-home.test.ts` is above)

**Interfaces:**
- Consumes: `ACCOUNT_SEAT_ROW_ID` (`face/src/account-seat.ts`).
- Produces: `composeFace`'s stack is `[...bundlePatches, ...policyPatches, ...seatPatches, ...lunhuiRows, ...profile.patches, ...homePatches, ...extraPatches]`; `mcpRowIdsToDisable(rows)` returns the composition's MCP row ids plus `ACCOUNT_SEAT_ROW_ID` (the face's one remaining MCP row, kept by id as AKShare's was); `GROUPS = ["mcp__account__", "lunhui_", "agent_", "role_"]`.

- [ ] **Step 1: Rewrite the tests first.**
  - `boot.test.ts`: the two AKShare tests become `composeFace mounts no AKShare: no mcp-akshare row and no MCP row serving akshare` — with `FACE_AKSHARE_MCP_COMMAND` set (restored after), no composed row has id `mcp-akshare` and no `@deepseek-ai/dsh-mcp-client` row has `config.serverName === "akshare"`; and `a profile or home patch still naming mcp-akshare composes, and mounts nothing for it` — the profile patch writes the old override (`- id: mcp-akshare` with a stdio config) and the home patch `- id: mcp-akshare\n  disabled: true`: `composeFace` does not throw and composes no `mcp-akshare` row.
  - `check-home.test.ts`: `mcpRowIdsToDisable([])` → `[ACCOUNT_SEAT_ROW_ID]`; the rows case → `["mcp-account", "mcp-mine"]`, the name of the test saying "the face's seat row by id"; the `mcpRowsIn` fixture keeps its shape with `mcp-akshare` renamed `mcp-mine` (it tests the walk, not AKShare).
  - The smokes and `order-gate.test.ts`: drop the `- id: mcp-akshare\n  disabled: true` lines (and the two-line form in `order-gate-midboot-smoke.test.ts:314-315`); comments that say "AKShare and the seat off" say "the seat off".
- [ ] **Step 2: Run the unit tests and see them fail.** `cd face && node --import tsx --test tests/boot.test.ts tests/check-home.test.ts` — FAIL: the row still composes.
- [ ] **Step 3: Delete the row and its wiring** as listed under Files. `PATCH_HEADER` says the face composes its Account seat row (`mcp-account`) itself; AKShare is the Account's (`account/README.md`). `policy.ts`'s "BELOW everything the operator writes — AKShare, the profile's…" becomes "— the project rows, the profile's…".
- [ ] **Step 4: Verify nothing is left.** `grep -rn "akshare.ts\|aksharePatches\|AKSHARE_MCP_ROW_ID\|FACE_AKSHARE_MCP_COMMAND\|mcp-akshare" face/src face/scripts face/tests face/plugins face/client face/package.json` — only the two `boot.test.ts` cases of Step 1. `grep -rn "mcp__akshare__" face/src face/tests` — only the `NEVER` prefix and the roles tests that refuse it.
- [ ] **Step 5: Run the suites.** `npm test && npm run typecheck`, then `FACE_SMOKE=1 npm test` — green.
- [ ] **Step 6: Commit.** Message: `refactor(face): the face mounts no AKShare - the mcp-akshare row, its wiring and its tests leave`.

---

### Task 6: The install moves box

**Files:**
- Modify: `face/Dockerfile`, `account/Dockerfile`, `compose.yml` (the agent's `FACE_AKSHARE_MCP_COMMAND` :73)
- Test: `face/tests/compose.test.ts`

**Interfaces:**
- Produces: the account image installs `ca-certificates curl git` (bookworm-slim has none; uv's installer needs curl, a git source needs git), then uv and `akshare-mcp` exactly as `face/Dockerfile:7-14` does today (`UV_INSTALL_DIR`, `UV_TOOL_DIR=/opt/uv-tools`, `UV_TOOL_BIN_DIR=/usr/local/bin`, `UV_PYTHON_INSTALL_DIR=/opt/uv-python`, the same `RUN` line and pin), before `COPY package.json …`, and `ENV PORTFOLIO_AKSHARE_BIN=/usr/local/bin/akshare-mcp`; the face image keeps `FROM node:22-bookworm`, the entrypoint and `CMD`, with its header saying it runs no data source (AKShare is the Account box's).

- [ ] **Step 1: Write the failing assertions** in `compose.test.ts`: `c.services.agent.environment.FACE_AKSHARE_MCP_COMMAND === undefined` (replacing :35); and a new test `the agent image carries no AKShare, the account image carries it at the pin` reading both Dockerfiles: `face/Dockerfile` does not match `/akshare|astral\.sh|uv tool|--python/`; `account/Dockerfile` contains `uv tool install --python 3.12 --with 'mcp<2'`, `git+https://github.com/xiaozhozho/akshare-mcp.git@9b6a22b6d83cce2a996a5072743bb06686040ce0` and `PORTFOLIO_AKSHARE_BIN=/usr/local/bin/akshare-mcp`, and its install line comes before `COPY package.json` (the layer survives a source change).
- [ ] **Step 2: Run it and see it fail.** `cd face && node --import tsx --test tests/compose.test.ts` — FAIL.
- [ ] **Step 3: Change the three files.** `compose.yml`: drop the agent's `FACE_AKSHARE_MCP_COMMAND`; the header comment's box list says the account box runs AKShare.
- [ ] **Step 4: Run it and see it pass**, then `npm test`. (No image is built here: `docker compose build` needs the network and is part of the two-box drill, `DEVELOPMENT.md` §10 item 24.)
- [ ] **Step 5: Commit.** Message: `build: akshare-mcp moves from the agent image to the account image, at the same pin`.

---

### Task 7: The prompts and the documents

**Files:**
- Modify: `GRAVIT.md` (:6-8, :22), `dsh/profile/cycle.md` (:21), then `cd face && npm run render:roles` (writes `bots/gravit/agent.cordis.yml`)
- Modify: `dsh/README.md` (:22, :50, :55, :76), `dsh/profile/cordis.yml` (:17-18, comment), `roles/_template/README.md` (:16)
- Modify: `CLAUDE.md`, `DEVELOPMENT.md`, `face/README.md`, `account/README.md`
- Test: `face/tests/gravit-md.test.ts`

**Interfaces:**
- Consumes: everything above; changes no code path.

- [ ] **Step 1: Write the failing assertion** in `gravit-md.test.ts`: a test `GRAVIT.md reaches AKShare through the seat` — matches `/mcp__account__portfolio_akshare/` and `/akshare_discover/`, and does not contain `mcp__akshare__`.
- [ ] **Step 2: Run it and see it fail.** `cd face && node --import tsx --test tests/gravit-md.test.ts` — FAIL.
- [ ] **Step 3: Edit the prompts.**
  - `GRAVIT.md` :6-8: "…reached through Gravit's seat (`mcp__account__*`, paper venues only), AKShare for A shares among its reads (`mcp__account__portfolio_akshare`)." :22: "`mcp__account__portfolio_akshare` passes one AKShare tool and its `arguments` to the Account's sidecar: `akshare_discover` finds a method and its category tool; `stock_zh_a_spot_tx` (under `akshare_stock_a`) is the verified…" — the rest of the paragraph stays.
  - `cycle.md` :21: "AKShare for A shares" → "AKShare for A shares (`portfolio_akshare`)"; then `npm run render:roles`; `git diff bots/gravit/agent.cordis.yml` shows only that line.
- [ ] **Step 4: Run** `node --import tsx --test tests/gravit-md.test.ts tests/cycle.test.ts` — PASS, and `wc -c ../GRAVIT.md` ≤ 4,500.
- [ ] **Step 5: Rewrite the documents**, present tense; dated measurements and history stay as written:
  - `account/README.md`: a section "AKShare, the sidecar" — the host install (the `uv tool install` line and the pin, `mcp<2` kept, the Git source because PyPI's `akshare-mcp` is another project), `PORTFOLIO_AKSHARE_BIN` and its default, started on first use and again after it exits, the 120 s deadline, 500 rows, 4 MiB, the child's scrubbed environment, the two routes and their words, the image's install; the live check `curl -s 127.0.0.1:4820/api/akshare/tools` lists 14 tools.
  - `face/README.md`: the env table loses `FACE_AKSHARE_MCP_COMMAND` (:119); "AKShare MCP — A-share queries in Gravit" (:258-321) becomes a short "AKShare — through the Account" — Gravit's one seat tool, `{tool: "akshare_stock_a", arguments: {method: "stock_zh_a_spot_tx"}}`, `truncated`/`row_count`, no `mcp:akshare` prompt section any more, the install and the routes in `account/README.md`, and **what the operator removes**: a `- id: mcp-akshare` entry in `$DSH_HOME/profiles/face/cordis.patch.yml` or `$DSH_HOME/cordis.patch.yml` is now inert and is deleted by hand (the face never edits the home); a `FACE_AKSHARE_MCP_COMMAND` in a start line is unread; the face's `.claude/launch.json` line no longer needs `~/.local/bin` on its `PATH` (the account line keeps it), and the Account must be restarted from this tree before Gravit's AKShare works (an older 4820 answers "restart it from this tree"); the "dsh 0.2.0 changed for every MCP row" list speaks of the seat's row alone; the seat counts 36 tools wherever 35 is a present-tense count (:315, the two-box drill :3747); the layer list (:913), Gate 2 (:1920), the roles' refusal (:2251, :2268), the smokes' "AKShare and the seat off" lines (:1420, :2696, :2698) and the two-box drill's box list (:3713) follow.
  - `DEVELOPMENT.md`: the box diagram (:112), the composition paragraphs (:163, :197-211, :836, :1168, :1194, :3499), the tools table row `mcp__akshare__*` (:346) → `mcp__account__portfolio_akshare` (the seat row, a read, no card), the prompt-section note (:357), the roles' never-list (:570), the module table (:923 goes; `account-seat.ts`'s row gains the 130 s timeout), the env tables (:1773, :5046 go; `PORTFOLIO_AKSHARE_BIN` added beside the Account's other variables; `FASTMCP_LOG_LEVEL` :5049 now reaches the Account's sidecar), the compose lines (:3782), R31 (:4527-4535: the fourteen AKShare schemas leave the tool block, one seat description replaces them — the lever is pulled; not re-measured, `npm run schema-sizes` on the next live boot does), the 0.2.0 residual (:4480), §10 item 22 (AKShare built; the item moves to the built log when plan 1's and plan 2's halves are also in), the forward note (:5003-5005); the `cd account && npm test` counts as measured.
  - `CLAUDE.md`: the `face/src/akshare.ts` row is deleted; "What this is" says AKShare is the Account's; the `dsh/` row's "AKShare" says "AKShare through the seat"; the `account/` row names the sidecar and `/api/akshare/*`; the seat row loses "composed beside AKShare" and its tools gain `portfolio_akshare`. One clause each; the file stays its length.
  - `dsh/README.md`, `dsh/profile/cordis.yml`, `roles/_template/README.md`: the face composes the seat's row (AKShare is the Account's); the roles never carry the AKShare passthrough.
  - Find stragglers: `grep -rn -i "mcp-akshare\|mcp__akshare__\|FACE_AKSHARE\|mcp:akshare\|akshare\.ts" CLAUDE.md DEVELOPMENT.md GRAVIT.md face/README.md account/README.md dsh roles bots face/src face/scripts` — every hit left is dated history, a measurement, or the never-list's prefix for an operator's own row.
- [ ] **Step 6: Verify.** `cd account && npm test && npm run typecheck`; `cd face && npm test && npm run typecheck && FACE_SMOKE=1 npm test` — green (the account suite but its known red).
- [ ] **Step 7: Commit.** Message: `docs: AKShare is the Account's sidecar, reached through the seat's portfolio_akshare`.

---

## Owed after the build (the operator's, or mine on the operator's go-ahead)

The live drill (spec §4.5, §8): restart the host Account from this tree (`~/.local/bin/akshare-mcp` is installed on the Mac) and the face on 3090; `curl -s 127.0.0.1:4820/api/akshare/tools` lists 14 tools; Discover's Data shelf shows `account` with 36 tools and no `akshare` card; in a channel, Gravit answers an A-share question with `portfolio_akshare` (`akshare_discover`, then `akshare_stock_a` `stock_zh_a_spot_tx`), no Gate 2 card raised; `npm run schema-sizes` records the smaller tool block. The image half (`docker compose build`, AKShare from the account box) rides the two-box drill (§10 item 24).

## Self-review notes (run 2026-11-01)

- Spec §4.3 coverage: the sidecar over stdio with the SDK, started on first use, restarted after an exit, 120 s and 500 rows (Task 1); the command from the Account's environment with the `~/.local/bin` default (Task 1); the image at the pin (Task 6); two reads under the Host fence, nothing written (Task 2); one seat read tool, `tool` plus `arguments`, the description naming the tools and `akshare_discover` (Task 3); classified as a read, no card, the smoke's count up by one (Task 4); the row, its prompt section, boot and check-home wiring and tests leave, uv/Python/akshare-mcp out of `face/Dockerfile` (Tasks 5, 6); every live document and prompt names the seat tool, `GRAVIT.md` within budget, the roles still get none (Tasks 4, 7). §4.5's two done lines: the image (Task 6's Dockerfile test), Gravit through the seat (Task 3's end-to-end test offline; the live drill owed). §3 goal 1's agent-image line and §9 call 11 (base `python3` stays): Task 6.
- Calls made where the spec left them (§10 and silences): restart is lazy — the next ask after an exit starts the child, never a loop; one 120 s deadline covers start, listing and call; the call route is `POST` with a JSON body (a read, as `/api/cn/ifind` is) and the listing `GET`; the route checks `tool` against the live listing, the seat's schema takes any short string and names the pin's fourteen in its description; the seat returns the sidecar's content unwrapped (one JSON layer for CJK-heavy rows); refusals are route words, no `core/errors.ts` code; the child's environment uses the face's old scrub rule, so the iFinD token never reaches Python and proxies and `FASTMCP_LOG_LEVEL` still do; stderr inherited; the seat row's timeout 90 s → 130 s, or a slow AKShare call would be cut by the face before the Account's deadline; `PORTFOLIO_AKSHARE_BIN` is the variable's name; Discover needs no code (it lists what dsh mounts: the `akshare` card goes, the `account` card carries the passthrough), and its fixtures keep `akshare` as a sample server as they keep the retired `alpaca-kit`; the charter and the loops page wait for plan 5's documents.
- Types: `Akshare`, `AkshareWord`, `AkshareAnswer`, `AkshareCall`, `AKSHARE_TOOLS`, `AKSHARE_STATUS`, `portfolio_akshare` and `130_000` are spelled the same in every task.
