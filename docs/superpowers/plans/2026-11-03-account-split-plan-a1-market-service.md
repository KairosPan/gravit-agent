# The Account split, plan A1 — the market service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `market/` package runs the Market part as its own service on 127.0.0.1:4821: the keyless public sources, the stream hub, China, AKShare, the Lunhui relay and iFinD. The account becomes the market's client and still answers every route it answers today, with the same shapes. The face, the client, the seat and Lunhui do not change.

**Architecture:**
- **The code moves.** The keyless modules move out of `account/src/portfolio/live/` into `market/src/live/` with `git mv`. The shared modules they import are copied into the market and trimmed (Task 2).
- **The market serves two kinds of route.** A source protocol lets a remote caller use a `PublicSource`, the `MarketHub`, the `ChinaSource` and a `Price` (Task 3). Public reads with names that do not say "account" are for A2 (Task 6).
- **The account consumes the protocol through adapters.** They implement the same four interfaces the service already takes as options: `publicMarkets`, `streams`, `china` and `liveDeps.price` (Task 4). `service.ts` therefore keeps its explore, quotes, candles, book, trades, paper and desk code unchanged. It keeps its keyed-before-public order, and its stream keeps carrying quote, book and trades events.
- **Lunhui and AKShare are byte relays.** The account forwards its four `/api/cn/*` and `/api/akshare/*` routes to the market unchanged.

**Tech Stack:**
- Both packages: Node 22, TypeScript (NodeNext, `noEmit`), express 4, tsx, vitest (`npm test`, `npm run typecheck`).
- The market also uses ccxt 4.5.85 (keyless tickers) and `@modelcontextprotocol/sdk` (the AKShare child).
- The face: `node --test` via tsx, and `FACE_SMOKE=1` for its real boots.

**Spec:** `docs/superpowers/specs/2026-11-03-account-split-and-identity-design.md`. In scope: §4.1, §4.2, §4.3 items 1, 2, 4 and 8, §4.6, §4.7 A1 and §5.10's third LaunchAgent. Background: `docs/superpowers/specs/2026-11-01-account-two-parts-design.md`, and `DEVELOPMENT.md` §3.9. Part B and A2 are out of scope: `FACE_MARKET_URL`, the proxy split, the client joins, `mcp-market`, the tool renames and `market:mcp`.

## Global Constraints

- **Package.** `market/package.json`:
  - `"name": "gravit-market"`, `"private": true`, `"type": "module"`, `"engines": {"node": "^22.19.0 || >=24.0.0"}`.
  - Scripts: `market`, `market:service` (`tsx src/market-service.ts`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`).
  - The `market` script is `tsx --env-file-if-exists=../.env.ifind src/server.ts`. A terminal run then picks up the iFinD token from the repo's gitignored `.env.ifind` whenever that file exists. The flag needs Node ≥ 22.9.
  - If tsx does not pass the flag on to node, the script is `node --env-file-if-exists=../.env.ifind --import tsx src/server.ts` instead. Task 1 checks which form works, with a test that spawns node on a fixture env file.
  - It has its own `package-lock.json` (`npm ci` there).
  - Dependency versions match `account/package.json`: express `^4.22.0`, `@modelcontextprotocol/sdk` `^1.30.0`, ccxt `4.5.85` (exact). Dev: `@types/express` `^4.17.21`, `@types/node` `^22.0.0`, tsx `^4.19.0`, typescript `^5.6.0`, vitest `^2.1.0`.
  - `tsconfig.json` and `vitest.config.ts` are copies of `account/`'s.
- **Licence.**
  - `market/LICENSE` is a byte copy of `account/LICENSE` (Apache-2.0).
  - `market/NOTICE` names Linqi's buyer-agent-demo @ 133b9a7 (https://github.com/linqizhe07/buyer-agent-demo), says the files came from this tree's `account/` on 2026-11-03, and lists which files were moved and which were copied.
  - Every moved or copied file keeps its header comment.
- **Listening and fence.**
  - The market binds `MARKET_BIND` (default `127.0.0.1`) on `--port` (default `4821`).
  - It admits the loopback `Host` values plus the exact `host:port` entries in `MARKET_HOSTS` (comma-separated). It refuses a foreign `Origin` and `Sec-Fetch-Site` values `cross-site` and `same-site`, with 403 `{ok: false, error: "this server answers only programs on this machine"}`.
  - Every path outside `/api/` gets 404 `{ok: false, error: MARKET_NO_PAGE}`, where `MARKET_NO_PAGE = "The market serves no page: its screens are Gravit's face (Markets). This address answers its API under /api/."`.
  - Every answer carries `cache-control: no-store`.
  - This is the account's fence and NO_PAGE behaviour (`account/src/portfolio/server.ts` `LOCAL_HOST`, `parseHosts`, the fence middleware, `NO_PAGE`), mirrored.
- **The market holds no wallet and writes nothing to disk.**
  - It has no home, no ledger and no key file.
  - `market/src` contains no file named `home.ts`, `credentials.ts`, `keystore.ts`, `sign.ts`, `paper.ts`, `metamask.ts`, `writes.ts`, `earn.ts`, `polymarket-clob.ts`, `wallet-bridge.ts` or `ed25519.ts`.
  - It does not import `viem/accounts`.
  - It calls no fs write API outside `market-service.ts`, the operator's installer (`market/test/unit/no-wallet.test.ts`).
- **The account's market URL.** It is `PORTFOLIO_MARKET_URL`, default `MARKET_URL_DEFAULT = "http://127.0.0.1:4821"`. Only `server.ts`'s main and `account-check.ts` build a link. A service made anywhere else (tests, the stand-in) reaches no market unless one is handed in, the way `china` and `streams` are today.
- **The market is down: one sentence.** `MARKET_DOWN = "The market service is not answering, so prices here are not current."` The account never fills a paper order on a price older than the market's last answer.
- **Product copy.** It is English. Route names on the market do not say "account".
- **The AKShare command.** It is `MARKET_AKSHARE_BIN`, default `~/.local/bin/akshare-mcp`, renamed from `PORTFOLIO_AKSHARE_BIN` in Task 3. The pin and the install line stay as in `account/Dockerfile` today.
- **Every task leaves three suites green:**
  - `cd account && npm test && npm run typecheck`. The baseline is 155 files and 2,379 tests passing.
  - `cd market && npm test && npm run typecheck`.
  - `cd face && npm test && npm run typecheck`. The baseline at 38c281df is 2,993 tests: 2,960 pass, 33 skipped, 0 fail.
  - The account's tests may import `market/src` and read `market/test` (Task 2 on). `account/src` may do so only between Task 2 and Task 4, and Task 4 pins that it no longer does.
  - Install with `cd market && npm ci` before running the account's suite.
- **Where to work.**
  - Work on `feat/account-split-a1`, cut from local `main` at the commit that adds this plan, in the worktree `.claude/worktrees/account-split-a1`. Never push.
  - Never run `npm run service`, `npm run account:service` or `npm run market:service -- install` (the operator's launchd), `docker compose`, or a server outside a test.
  - Never open `.env*`, `~/.dsh/.credentials.yaml`, anything under `~/.buyer-agent-demo/`, or a key file.
  - `FACE_SMOKE=1` runs from the worktree, which is outside `/tmp` and `$TMPDIR`.
- **Commits.** Write each message to a file in the session scratchpad, by its literal absolute path, and commit with `git commit -F <that path>`. No backticks, no `$()`, no shell variables, no attribution lines. Each task's last step gives the message.
- **The compose run** (`compose.yml`) is broken from Task 2 until Task 8 restores it, because the account box's build context lacks `market/`. Nothing in this plan runs it.

## Review Focus

- **The account starts while the market is down, and the market comes up later.** The source list must fill in, and explore, paper pricing and the hub must start working, all without restarting the account. The service must not cache an empty list forever. Test in Task 4 (`sources fill in once the market answers`).
- **The market restarts during a session.** The account's hub stream drops. The mirror must go `live: false`, reconnect with backoff and re-send every hold and want, and a page's followed market must stream again with no new follow. Test in Task 4 (`the hub reconnects and holds again`).
- **A resting paper limit order while the market is down.** The last quote the mirror holds crosses the limit, but nothing fills, because `confirmed()` answers `undefined` and the mirror is not live. The order fills once the market is back. Test in Task 5.
- **Tencent's GBK bytes through two hops.** The relay through the account must hand back the same bytes, status, `content-type`, `location` and `x-cn-relay` header, with no text decoding anywhere. Test in Task 4 (`relays bytes unchanged`), with bytes that are not valid UTF-8.
- **The caller hangs up during a 120 s AKShare call.** The account must abort its request to the market, and the market must abort the child's call (`callerGone`), so a closed tab does not hold the sidecar. Test in Task 4 (`an aborted call aborts upstream`).

---

## File structure

**`market/` (new package):**

- `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `NOTICE`, `LICENSE` and `README.md`: Task 1.
- `src/server.ts`: `startMarketServer`, the fence, NO_PAGE, `/api/health` and the main. Task 1; routes are mounted in Tasks 3 and 6.
- `src/core/errors.ts`, `src/refuse.ts` and `src/calendar.ts`: copies of the account's `src/core/errors.ts`, `src/portfolio/refuse.ts` and `src/portfolio/account/calendar.ts`. Task 2.
- `src/live/*.ts`: the moved modules and the trimmed copies. Task 2.
- `src/read-cache.ts`: `ReadCache` and `keptSource`, the market's own read cache, ported from `service.ts`. Task 3.
- `src/core.ts`: `createMarketCore`, which holds the sources, the hub, China, the price, the relay, iFinD and AKShare. Task 3.
- `src/protocol.ts`: the source, hub, China and price routes the account consumes. Task 3.
- `src/routes-cn.ts`: `/api/cn/relay`, `/api/cn/ifind`, `/api/akshare/tools` and `/api/akshare/call`, moved from the account's `server.ts`. Task 3.
- `src/reads.ts`, `src/stream.ts` and `src/follows.ts`: the public reads and the market stream with follows. Task 6.
- `src/market-service.ts`: the LaunchAgent installer. Task 7.
- `Dockerfile`: Task 8.
- `test/unit/*.test.ts` and `test/fixtures/`: the moved tests and the new ones.

**`account/`:**

- `src/portfolio/market/client.ts`: the HTTP transport. Task 4.
- `src/portfolio/market/sources.ts`, `hub.ts`, `china.ts` and `price.ts`: the four adapters. Task 4.
- `src/portfolio/market/link.ts`: `connectMarket`, which joins the transport and the adapters. Task 4.
- `src/portfolio/market/shapes.ts`: the types and pure helpers the account still needs from the moved files, copied with their JSDoc. Task 4.
- `src/portfolio/server.ts`: the relays, the main's link, and `close`. Tasks 4 and 5.
- `src/portfolio/service.ts`: the default sources become `[]` and may be a function; the default price becomes none; the in-process `StreamHub` is removed; `marketOld` is added. Tasks 4 and 5.
- `src/portfolio/account-check.ts`, `src/portfolio/mcp.ts` and `src/portfolio/account-service.ts`: their imports are repointed, and the plist keeps `PORTFOLIO_MARKET_URL`. Tasks 4 and 7.
- `test/standin/ui-standin.ts`: an ephemeral port by default, and 4821 refused. Task 1.
- `test/unit/market-*.test.ts` and `test/unit/no-market-code.test.ts`: Tasks 4, 5 and 6.

**Root and face:**

- `compose.yml`, `account/Dockerfile` and `face/tests/compose.test.ts`: Task 8.
- `CLAUDE.md`, `DEVELOPMENT.md`, `account/README.md`, `market/README.md` and the comment in `face/tests/no-market-hosts.test.ts`: Task 9.

---

### Task 1: The market package, its server shell, and the stand-in off 4821

**Files:**
- Create: `market/package.json`, `market/package-lock.json` (by `npm install`), `market/.gitignore`, `market/tsconfig.json`, `market/vitest.config.ts`, `market/NOTICE`, `market/LICENSE`, `market/README.md` (five lines: what it is, `npm ci`, `npm run market`, `npm test`, and "design: the spec above").
- Create: `market/src/server.ts`.
- Create: `market/test/unit/server-guard.test.ts`, `market/test/unit/server-no-page.test.ts` and `market/test/unit/no-wallet.test.ts`.
- Modify: `account/test/standin/ui-standin.ts` (`startStandin` and the main's `--port` default, at about lines 99, 176 and 615) and `account/test/unit/ui-standin.test.ts`.

**Interfaces:**
- Produces (in `market/src/server.ts`):
  - `export const MARKET_PORT = 4821`
  - `export const MARKET_NO_PAGE` (the exact sentence in Global Constraints)
  - `export function parseHosts(raw: string | undefined): string[]`
  - `export interface MarketServerOptions { port: number; bind?: string | undefined; hosts?: readonly string[] | undefined; mount?: ((app: express.Express) => void) | undefined; close?: (() => Promise<void>) | undefined }`
  - `export interface MarketServerHandle { url: string; close(): Promise<void> }`
  - `export async function startMarketServer(o: MarketServerOptions): Promise<MarketServerHandle>`
- `mount` runs after the fence, NO_PAGE and the JSON parser (`express.json({ inflate: false })`), and before the unread-body handler. Tasks 3 and 6 mount their routes through it. `close` runs before the listener closes.
- `GET /api/health` answers `{ok: true, service: "market"}`. Task 3 extends it.

- [ ] **Step 1: Scaffold the package.**
  - Create `market/` with the package fields and dependency versions in Global Constraints. In this task install only express, `@types/express`, `@types/node`, tsx, typescript and vitest: `cd market && npm install express@^4.22.0 && npm install -D @types/express@^4.17.21 @types/node@^22.0.0 tsx@^4.19.0 typescript@^5.6.0 vitest@^2.1.0`.
  - Copy `tsconfig.json` and `vitest.config.ts` from `account/`.
  - `cp account/LICENSE market/LICENSE`.
  - Write `NOTICE` with its three facts.
  - Add `market/.gitignore` holding `node_modules/`, as `account/.gitignore` does. Check it with `git check-ignore -v market/node_modules`.

- [ ] **Step 2: Write the failing tests.**

`market/test/unit/server-guard.test.ts` (model it on `account/test/unit/server-guard.test.ts`, and use `fetch` with an explicit `host` header through `node:http` the way that file does):
```ts
it("refuses market:4821 by default, admits it when MARKET_HOSTS names it, refuses evil:4821 still", ...)
  // default: status 403, body.error === "this server answers only programs on this machine"
  // startMarketServer({ port: 0, hosts: ["market:4821"] }): /api/health under Host market:4821 → 200
it("refuses a foreign Origin and a cross-site or same-site fetch", ...)  // Origin http://evil.example → 403; sec-fetch-site cross-site → 403; same-site → 403
it("parseHosts trims, drops empties and changes nothing else", () =>
  expect(parseHosts(" market:4821, ,Other:1 ")).toEqual(["market:4821", "Other:1"]))
```

`market/test/unit/server-no-page.test.ts`:
```ts
it("answers 404 MARKET_NO_PAGE outside /api/", ...)  // GET / and GET /index.html → 404, body {ok:false, error: MARKET_NO_PAGE}
it("answers /api/health, never cached", ...)       // 200, body {ok:true, service:"market"}, header cache-control "no-store"
it("an unreadable JSON body is one fixed sentence", ...)  // POST /api/health with "{" → 400, error matches /could not be read as JSON/
```

`market/test/unit/no-wallet.test.ts`: walk `market/src` recursively.
```ts
it("market/src holds no wallet file", ...)  // no basename in ["home.ts","credentials.ts","keystore.ts","sign.ts","paper.ts","metamask.ts","writes.ts","earn.ts","polymarket-clob.ts","wallet-bridge.ts","ed25519.ts"]
it("market/src imports no signing library and writes no file", ...)
  // no file matches /from "viem\/accounts"/
  // except market-service.ts, no file matches /\b(writeFileSync|writeFile|appendFile|appendFileSync|mkdirSync|createWriteStream|rmSync|unlinkSync|renameSync)\b/
it("market/src names no wallet home", ...)  // no file matches /BUYER_HOME|\.buyer-agent-demo/
```

`account/test/unit/ui-standin.test.ts`: add
```ts
it("never starts on the market's port", async () => {
  await expect(startStandin({ port: 4821 })).rejects.toThrow(/4821 is the market's/);
});
```

- [ ] **Step 3: Run the tests and see them fail.**
  - Run `cd market && npx vitest run`. Expected: FAIL, because `src/server.ts` does not exist. The no-wallet test passes over the near-empty tree.
  - Run `cd account && npx vitest run test/unit/ui-standin.test.ts`. Expected: FAIL on the new case.

- [ ] **Step 4: Implement `startMarketServer` in `market/src/server.ts`.**
  - Port the account's `cache-control` middleware, the fence middleware, NO_PAGE, the JSON parser and the `unreadBody` handler from `account/src/portfolio/server.ts`. Use `MARKET_HOSTS` in place of `PORTFOLIO_HOSTS` and the market's NO_PAGE sentence.
  - The main runs when `fileURLToPath(import.meta.url) === process.argv[1]`. It reads `--port` (default 4821), `MARKET_BIND` and `MARKET_HOSTS`. On `EADDRINUSE` it prints `port <n> is already in use: a market is probably running already` and exits 1.
  - On start it prints `market at http://127.0.0.1:<port> · keyless public data · Ctrl-C to stop`, and on SIGINT or SIGTERM it closes.

  In `ui-standin.ts`:
  - Add `const MARKET_PORT = 4821`.
  - `startStandin` throws `port 4821 is the market's: the stand-in never starts there (use --port 0, an ephemeral port)`.
  - The main's `--port` defaults to `0`. It refuses 4821 with that same sentence.
  - Rewrite the file's header line `npx tsx test/standin/ui-standin.ts --port 4821` to `--port 0`, and every other "use 4821" mention the same way.

- [ ] **Step 5: Run the tests and see them pass.**
  - Run `cd market && npm test && npm run typecheck`. Expected: 3 files passed.
  - Run `cd account && npm test && npm run typecheck`. Expected: 155 files, 2,380 tests passed.
  - Run `cd face && npm test && npm run typecheck`. Expected: the face baseline. Then run `FACE_SMOKE=1 npm test`. Expected: 0 fail. `face/tests/helpers/standin.ts` already starts the stand-in on a `freePort()`.

- [ ] **Step 6: Commit.**
  `git add market account/test/standin/ui-standin.ts account/test/unit/ui-standin.test.ts`, then `git commit -F <message file>`. Message: `feat(market): the market package and its server shell on 4821 - fence, no page, health; the stand-in moves off 4821`.

---

### Task 2: The keyless code moves into the market

This task only moves code. The account still runs every source in-process, now importing the moved files from `market/src`. Task 4 ends that.

**Files:**
- Move with `git mv` from `account/src/portfolio/live/` to `market/src/live/` (the moved set, M): `akshare.ts`, `china.ts`, `cn-history.ts`, `cn-http.ts`, `cn-ifind.ts`, `cn-quotes.ts`, `cn-rank.ts`, `cn-relay.ts`, `cn-search.ts`, `cn-session.ts`, `public-markets.ts`, `public-rwa.ts`, `public-stocks.ts`, `us-quotes.ts`, `stream-hub.ts`, `prices.ts` and `history-stocks.ts`.
- Copy into `market/src/live/` (the shared set, S), with each original kept in the account: `trade.ts`, `types.ts`, `history.ts`, `history-crypto.ts`, `categories.ts`, `preipo.ts`, `hl-rules.ts`, `icons.ts`, `compare.ts`, `explore.ts`, `exchange.ts`, `kalshi.ts`, `polymarket-us.ts`, `robinhood.ts`, `dex.ts` and `chain.ts`.
- Copy `account/src/core/errors.ts` to `market/src/core/errors.ts`, `account/src/portfolio/refuse.ts` to `market/src/refuse.ts`, and `account/src/portfolio/account/calendar.ts` to `market/src/calendar.ts`.
- Move with `git mv` from `account/test/unit/` to `market/test/unit/` (the module tests, which construct no service): `akshare`, `china`, `cn-history`, `cn-http`, `cn-quotes`, `cn-rank`, `cn-relay`, `cn-search`, `cn-session`, `live-explore`, `live-explore-location`, `live-history-stocks`, `live-public-markets`, `live-public-markets-location`, `live-public-rwa`, `live-public-stocks`, `live-stream-hub` and `review2-public` (each `.test.ts`), plus the helper `live-public-markets-fixtures.ts`.
- Move with `git mv` `account/test/fixtures/fake-akshare-mcp.mjs` to `market/test/fixtures/`.
- Modify: every file in `account/src` and `account/test` that imports a file in M.
- Modify: `market/package.json`, adding ccxt `4.5.85` (`--save-exact`) and `@modelcontextprotocol/sdk@^1.30.0`.

**Interfaces:**
- Produces: `market/src/live/<m>.ts`, with each export it had at 20ead850 unchanged in name and signature.
- Imports inside the moved files are rewritten:
  - `../../core/errors.ts` becomes `../core/errors.ts`.
  - `../account/calendar.ts` becomes `../calendar.ts`.
  - `../refuse.ts` and `./x.ts` are unchanged.
  - In `market/src/calendar.ts`, `../live/trade.ts` becomes `./live/trade.ts`.
- Imports in the moved tests are rewritten:
  - `../../src/portfolio/live/` becomes `../../src/live/`.
  - `../../src/portfolio/refuse.ts` becomes `../../src/refuse.ts`.
  - `../../src/portfolio/account/calendar.ts` becomes `../../src/calendar.ts`.
  - `../../src/core/errors.ts` is unchanged.
  - The fixture path `../fixtures/fake-akshare-mcp.mjs` is unchanged.
- The account's transient imports of M, by the importer's directory:

| Importer | Old specifier | New specifier |
|---|---|---|
| `account/src/portfolio/live/*.ts` | `./<m>.ts` | `../../../../market/src/live/<m>.ts` |
| `account/src/portfolio/*.ts` | `./live/<m>.ts` | `../../../market/src/live/<m>.ts` |
| `account/test/unit/*.ts`, `test/attack/*.ts`, `test/standin/*.ts` | `../../src/portfolio/live/<m>.ts` | `../../../market/src/live/<m>.ts` |
| `account/test/*.ts` | `../src/portfolio/live/<m>.ts` | `../../market/src/live/<m>.ts` |

- Account tests that imported the moved helper `./live-public-markets-fixtures.ts` (`ip-audit-e`, `ip-audit-f2`, `live-us-quotes`) import `../../../market/test/unit/live-public-markets-fixtures.ts`.
- Tests that use `fake-akshare-mcp.mjs` (`akshare-seat`, `akshare-routes`, `portfolio-mcp-real`) point at `market/test/fixtures/fake-akshare-mcp.mjs`.

- [ ] **Step 1: Write the failing test.**

  Add a case to `market/test/unit/no-wallet.test.ts`:
```ts
it("the market carries the keyless modules", () => {
  for (const f of ["public-markets","stream-hub","china","akshare","cn-relay","cn-ifind","prices","us-quotes","public-stocks","public-rwa","history-stocks"])
    expect(existsSync(join(SRC, "live", `${f}.ts`))).toBe(true);
});
```
  Add `account/test/unit/market-moved.test.ts`:
```ts
it("the moved modules are no longer in account/src", () => {
  for (const f of ["public-markets","stream-hub","china","akshare","cn-relay","cn-ifind","cn-http","prices","us-quotes","public-stocks","public-rwa","history-stocks","cn-history","cn-quotes","cn-rank","cn-search","cn-session"])
    expect(existsSync(new URL(`../../src/portfolio/live/${f}.ts`, import.meta.url))).toBe(false);
});
```

- [ ] **Step 2: Run the tests and see them fail.**

  Run `cd market && npx vitest run test/unit/no-wallet.test.ts`, then `cd account && npx vitest run test/unit/market-moved.test.ts`. Expected: FAIL in both.

- [ ] **Step 3: Move, copy, trim and rewrite the imports.**
  1. Run the `git mv` commands for M, the module tests, the test helper and the fixture.
  2. Copy S and the three root files.
  3. Rewrite the imports per the Interfaces block.
  4. Install ccxt and the MCP SDK in `market/`.
  5. **Trim the copies.** Seven copies import account-only modules: `types.ts` (`../accounts.ts`, `./earn.ts`, `./paper.ts`, `./writes.ts`), `exchange.ts` (`./credentials.ts`, `./exchange-trade.ts`, `./writes.ts`), `kalshi.ts`, `polymarket-us.ts` (`./credentials.ts`, `../../core/ed25519.ts`), `robinhood.ts` (`./credentials.ts`, viem), `dex.ts` (viem) and `chain.ts` (`viem/accounts`, `viem/actions`, `viem/chains`).
     - In each, delete the exports that nothing under `market/src` imports, and the imports those exports alone used, until `cd market && npm run typecheck` passes and `no-wallet.test.ts` passes.
     - Never edit an export that is kept.
     - Add viem `^2.57.3` to `market/package.json` only if a kept export still needs it; `viem/accounts` stays out.
     - Add one line under each copy's header: `Trimmed copy of account/src/portfolio/live/<name>.ts at 20ead850 (account split, plan A1): the market's own from here.`
     - Add the same line to the three root copies, without the word "Trimmed".
  6. Record in `market/NOTICE` the moved list and the copied list.

- [ ] **Step 4: Run every suite and see it pass.**
  - Run `cd market && npm test && npm run typecheck`. Expected: 21 files passed: Task 1's 3 and the 18 moved test files.
  - Run `cd account && npm test && npm run typecheck`. Expected: 138 files passed (155 − 18 + `market-moved`).
  - **Check that no test was lost.** The account's test count plus the market's must equal 2,391. That is Task 1's account total of 2,380, plus Task 1's nine market cases, plus this task's two new cases.
  - Run `cd face && npm test && npm run typecheck`. Expected: the face baseline.
  - Run `git log --follow --oneline -2 market/src/live/public-markets.ts`. It must show the account-era history.

- [ ] **Step 5: Commit.**

  Message: `refactor: the keyless modules move into market/ with git mv, the shared ones are copied and trimmed; the account imports them from there until plan A1 task 4`.

---

### Task 3: The market's core and its source protocol

**Files:**
- Create: `market/src/read-cache.ts`, `market/src/core.ts`, `market/src/protocol.ts` and `market/src/routes-cn.ts`.
- Create: `market/test/fixtures/hub-covers.json`.
- Modify: `market/src/server.ts` (the main builds the real core and mounts the routes), `market/src/live/stream-hub.ts` (adds `ring`), and `market/src/live/akshare.ts` (`MARKET_AKSHARE_BIN`).
- Test: `market/test/unit/protocol.test.ts` and `market/test/unit/hub-protocol.test.ts`.
- Test: `market/test/unit/cn-routes.test.ts` and `market/test/unit/akshare-routes.test.ts`. These are copies of the account's two files, retargeted to `startMarketServer`. The account keeps its own until Task 4.

**Interfaces:**
- Consumes: Task 1's `startMarketServer` and its `mount`; Task 2's moved modules.
- Produces (in `market/src/core.ts`):
```ts
export interface MarketCoreOptions {
  sources?: PublicSource[] | undefined;      // absent: none (only the main builds publicSources())
  hub?: MarketHub | undefined;               // absent: none
  china?: ChinaSource | undefined;
  price?: Price | undefined;                 // absent: () => Promise.resolve(undefined)
  cn?: { relay: CnRelay; ifind: CnIfind } | undefined;
  akshare?: Akshare | undefined;
  clock?: (() => number) | undefined;
}
export interface MarketCore {
  sources(): PublicSource[];                 // each wrapped once by keptSource
  source(id: string): PublicSource | undefined;
  readonly hub: MarketHub | undefined;
  readonly china: ChinaSource | undefined;
  readonly price: Price;
  readonly cn: MarketCoreOptions["cn"];
  readonly akshare: Akshare | undefined;
  close(): Promise<void>;                    // hub.close(), then akshare?.close()
}
export function createMarketCore(o: MarketCoreOptions): MarketCore;
export function realMarketCore(): MarketCore;
```
  - `realMarketCore()` is the main's. It builds:
    - `sources` from `publicSources()`.
    - `hub` from `joinHubs(new StreamHub({ answers }), ...feeds)`, where `answers` is the port of `service.ts` `restAnswers` over the market's read cache.
    - `china` from `chinaSource()` and `price` from `publicPrices()`.
    - `cn` as `{ relay: createCnRelay(realCnHttp), ifind: createIfind({ env: () => process.env, http: cnHosts(realCnHttp, [IFIND_HOST]) }) }`.
    - `akshare` from `createAkshare({ command: akshareCommand() })`.
- Produces (in `market/src/read-cache.ts`):
  - `export class ReadCache` is a copy of `service.ts` `class ReadCache` (at about line 4487) and the helpers it uses (`thrownBy`, `isBan` and so on).
  - `export function keptSource(c: ReadCache, s: PublicSource, histories: HistoryKeep<Candle[] | CandlePage>): PublicSource` is the port of `service.ts` `keptPublic` plus `historyRead`, with the same keys, keep times (`PUBLIC_KEEP_MS`, `LINE_KEEP_MS`, `keepMsOf`) and part names (`public:<id>`, `#search`, `#history`, `#line`).
- Produces (`MarketHub.ring` in `market/src/live/stream-hub.ts`):
  - The optional member is `ring?(source: string, symbol: string, after: number): { trades: Array<{ seq: number; at: number; price: number; snap: boolean }>; evictedSeq: number }`.
  - `StreamHub` implements it from `mk.ring` and `mk.evictedSeq`, the fields `since` reads. `joinHubs` forwards it to the covering hub.
- Produces (`market/src/protocol.ts`, `export function mountProtocol(app: express.Express, core: MarketCore): void`):
  - **The answer shape.** Every route answers 200 with `{ok: true, value, readAt?}` or `{ok: false, refusal}`; a source's refusal is an answer, not an error. A bad parameter gets 400 `{ok:false, error}`, and an unknown source id 404.
  - **`readAt`** is `readAtOf(value)` for an object. For an array it is a parallel `Array<number | null>` of each item's `readAtOf`.
  - **Maps** go over the wire as an array of `[key, value]` entries.

| Route | Answers |
|---|---|
| `GET /api/sources` | `value: Array<{ id, name, kind, connectTo, connector, readOnly?, historyApart?, sessions?: string (the clock's zone), has: { line, stats, events, candles, book, trades, settlement, fundingHistory, notes } }>` |
| `GET /api/source/:id/listings?q=&limit=` | `value: Listing[]`, plus `notes: string[]` (from `s.notes?.({q})` after the listing) |
| `GET /api/source/:id/line?symbol=` | `value: Listing \| null` |
| `GET /api/source/:id/stats?symbols=a,b` | `value: [symbol, MarketStats][]` (no `symbols`: the well-known ones) |
| `GET /api/source/:id/events?category=&closingWithinMs=&limit=` | `value: Listing[]` |
| `GET /api/source/:id/candles?symbol=&interval=&since=&until=&limit=` | `value: Candle[] \| CandlePage` |
| `GET /api/source/:id/book?symbol=&depth=` · `/trades?symbol=&limit=` · `/settlement?symbol=` · `/funding?symbol=&from=&to=` | the method's own value |
| `POST /api/source/:id/reset` | `{ok:true}` |
| `GET /api/china/rank?sort=` · `/search?q=` · `/quotes?symbols=a,b` · `/history?symbol=&range=` | the `ChinaSource` method's value (quotes as entries); every answer also carries `status: ChinaStatus` |
| `GET /api/china/status` | `value: ChinaStatus` |
| `GET /api/price?asset=` | `value: number \| null` |
| `GET /api/hub/covers?source=&symbol=` | `value: { covers: boolean, pricesOnly: boolean }` |
| `GET /api/hub/confirmed?source=&symbol=&maxAgeMs=&waitMs=` | `value: HubQuote \| null` (waitMs at most 5000) |
| `GET /api/hub?client=` | Server-sent events, one JSON object per `data:` line: `{t:"quote", source, symbol, quote: HubQuote}` · `{t:"book", source, symbol, book: HubBook}` (only for a book hold) · `{t:"trades", source, symbol, ring: <ring() after the last seq sent to this client>, evictedSeq, recent: hub.trades(source, symbol, 100)}` · `{t:"live", source, symbol, live}` |
| `POST /api/hub/hold {client, source, symbol, book, held}` | `{ok:true}`. The market keeps holds per client and releases every one of them when that client's `/api/hub` connection closes. |
| `POST /api/hub/want {client, source, symbol}` | `value: boolean` (`hub.want`) |

  - `client` matches `CLIENT_ID` (`/^[A-Za-z0-9_-]{8,48}$/`, copied from `account/src/portfolio/account/stream.ts`).
  - A `trades` event is sent at most every 100 ms per market, and a `book` event at most every 250 ms (`COALESCE_MS`).
  - The `ring` sent to a client starts after the highest seq that client has already received.
- Produces (`market/src/routes-cn.ts`, `export function mountCn(app: express.Express, core: MarketCore, o?: { cnQueueMs?: number }): void`):
  - These are the four route bodies of `account/src/portfolio/server.ts` (`/api/cn/relay`, `/api/cn/ifind`, `/api/akshare/tools`, `/api/akshare/call`) with their status tables, moved verbatim. Where they read `opts.cn` and `opts.akshare`, they read `core.cn` and `core.akshare`.
  - The account's own copies stay until Task 4.
- `/api/health` becomes `{ok: true, service: "market", sources: core.sources().length, china: !!core.china, akshare: !!core.akshare, ifind: core.cn?.ifind.configured() ?? false}`. It names no token.
- `akshareCommand(env)` reads `MARKET_AKSHARE_BIN`, falling back to the default path. Update the moved `akshare.test.ts` case that names the variable.

- [ ] **Step 1: Write the failing tests.**

  In `market/test/unit/protocol.test.ts`, fake sources are plain `PublicSource` objects, built the way `account/test/unit/account-paper.test.ts` builds its own; one listing is stamped with `readLike(x, 1_700_000_000_000)`.
```ts
it("lists the sources and what each answers", ...)        // GET /api/sources → value[0] matches {id:"fake", kind:"exchange", has:{line:true, stats:true, candles:true, book:false}}
it("hands a listing back with its read time", ...)         // /api/source/fake/listings?q=BTC&limit=5 → value[0].symbol "BTC/USDT", readAt[0] === 1_700_000_000_000, notes ["fake note"]
it("hands a source's refusal back as an answer", ...)      // source refuses E_VENUE_GEOBLOCKED → 200 {ok:false, refusal:{code:"E_VENUE_GEOBLOCKED", message}}
it("sends a Map as entries", ...)                          // stats → value equals [["BTC/USDT", {changePct24h: 1.5, ...}]]
it("answers 404 for an unknown source and 400 for a bad limit", ...)
it("asks a refused source again only after its hold", ...) // a fake that refuses 429 once: a second ask within the hold returns the kept refusal without calling the fake (keptSource)
it("serves China and the price", ...)                      // /api/china/quotes?symbols=sh600519 → value [["sh600519", {currency:"CNY", ...}]], status.state "live"; /api/price?asset=BTC → 62000; unknown asset → null
it("names no token on health", ...)                        // a cn whose ifind.configured() is true → health.ifind === true, and the body has no "token" substring
```
  In `market/test/unit/hub-protocol.test.ts`, the fake hub is the `standinHub` shape or a hand-written `MarketHub` that counts holds and releases and implements `ring`.
```ts
it("covers as the hub covers, for every row of the fixture", ...)  // each {source, symbol, covers, pricesOnly} in test/fixtures/hub-covers.json equals GET /api/hub/covers, against realMarketCore's joined hub rule (StreamHub + UsQuoteFeed, no socket opened)
it("pushes a held market's quote, its book only for a book hold, and its trades with their ring", ...)
it("releases every hold of a client when its stream closes", ...)    // releases === holds after the SSE response is aborted
it("sends each ring entry once per client", ...)                     // two ticks → the second trades event's ring starts after the first's last seq
it("proxies confirmed, waiting no more than 5000 ms", ...)
```
  - Write `hub-covers.json` from `streamOf` and `US_TICKER` with at least twelve rows: coinbase `BTC/USD` true; kraken `ETH/USD` true; okx `BTC/USDT` true; okx `BTC` false; hyperliquid `BTC/USDC:USDC` true; hyperliquid-preipo with a HIP-3 symbol true; us-stocks `AAPL` true with pricesOnly; us-stocks `aapl` false; kalshi any false; polymarket any false; china `sh600519` false; empty symbol false.
  - Copy `account/test/unit/cn-routes.test.ts` and `akshare-routes.test.ts` to `market/test/unit/`, and replace `startPortfolioServer({ service, cn, akshare })` with `startMarketServer({ port: 0, mount: (app) => { mountCn(app, createMarketCore({ cn, akshare })) } })`. Every assertion stays.

- [ ] **Step 2: Run the tests and see them fail.**

  Run `cd market && npx vitest run test/unit/protocol.test.ts test/unit/hub-protocol.test.ts test/unit/cn-routes.test.ts test/unit/akshare-routes.test.ts`. Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement `read-cache.ts`, `core.ts`, `protocol.ts`, `routes-cn.ts` and `StreamHub.ring`.**
  - The main mounts `mountProtocol` and `mountCn` over `realMarketCore()` and passes `close: () => core.close()`.
  - The start line adds `· Lunhui's reach: /api/cn/relay · iFinD configured|not configured (IFIND_REFRESH_TOKEN or IFIND_ACCESS_TOKEN in this process's environment) · AKShare: <command>, started on first use`, worded like the account's lines today.
  - The hub SSE uses `res.write("data: " + JSON.stringify(e) + "\n\n")`, with a heartbeat comment every 15 s (`":\n\n"`) and `res.on("close")` releasing the holds.

- [ ] **Step 4: Run the tests and see them pass.**
  - Run `cd market && npm test && npm run typecheck`. Expected: all pass.
  - Run `cd account && npm test && npm run typecheck`, then `cd face && npm test`. Expected: unchanged. The account's `stream-hub` import now carries the optional `ring`, and nothing in the account calls it.

- [ ] **Step 5: Commit.**

  Message: `feat(market): the core, its read cache and the source protocol - sources, hub, China and price over HTTP, and the Lunhui and AKShare routes`.

---

### Task 4: The account uses the market

**Files:**
- Create: `account/src/portfolio/market/{shapes,client,sources,hub,china,price,link}.ts`.
- Modify: `account/src/portfolio/service.ts`:
  - `PortfolioServiceOptions.publicMarkets` (at about line 161).
  - `publicMarkets()` (at about 901).
  - `liveDeps()` (at about 1866): the default price becomes none.
  - `watchStreams()` (at about 2185): no `StreamHub` is made. `restAnswers` (at about 2224) is deleted.
  - The imports of M become `./market/shapes.ts`.
- Modify: `account/src/portfolio/server.ts`:
  - `PortfolioServerOptions` loses `cn`, `cnQueueMs` and `akshare` and gains `market`.
  - The four routes (at about 417–470) become relays.
  - `close` closes the link.
  - The main builds the link.
- Modify: every `account/src` file that imports `market/src`, so that it imports `./market/shapes.ts` at the right depth: `live/{index,paper,dex,reach,earn,metamask,history-crypto,explore,exchange-trade,hyperliquid-trade}.ts`, `account-check.ts`, `mcp.ts` (`AKSHARE_TOOLS`) and `service.ts`.
- Modify: `account/src/portfolio/account-check.ts`. Its default sources and price come from `connectMarket({ url: process.env.PORTFOLIO_MARKET_URL || MARKET_URL_DEFAULT })`, after one `await link.ready(3_000)`.
- Delete: `account/test/unit/cn-routes.test.ts` and `account/test/unit/akshare-routes.test.ts`. Their market copies are the tests now.
- Test: `account/test/unit/market-link.test.ts`, `market-account.test.ts`, `market-relay.test.ts` and `no-market-code.test.ts`.
- Modify: the account tests that relied on the in-process defaults: `account-live.test.ts`, `ip-audit-e.test.ts` and `account-backend-units.test.ts`. Each gets the real source it used, imported from `../../../market/src/live/public-markets.ts` and handed in as `publicMarkets`, and `publicPrices` from `market/src/live/prices.ts` as `liveDeps.price`.
- Modify: `akshare-seat.test.ts` and `portfolio-mcp-real.test.ts`. They start a market in-process (`startMarketServer` and `mountCn` over `createMarketCore({ akshare: createAkshare({ command: process.execPath, args: [<market fixture>] }) })`) and hand the account `market: connectMarket({ url })`.

**Interfaces:**
- Consumes: Task 3's protocol (the routes and wire shapes above). For tests only, `startMarketServer`, `createMarketCore`, `mountProtocol` and `mountCn` from `market/src`.
- Produces (in `shapes.ts`):
  - **Types:** `Listing`, `ListingsQuery`, `EventsQuery`, `Settlement`, `PublicSource`, `MarketHub`, `HubQuote`, `HubBook`, `HubTick`, `HubRange`, `SinceCut`, `Price`, `ChinaSource`, `ChinaMarket`, `ChinaHistory`, `ChinaRead`, `ChinaStatus`, `ChinaRange` and `ChinaSort`.
  - **Constants:** `BOOK_TOP`, `CHINA_ID`, `CHINA_NAME`, `CHINA_NOTE`, `RANK_ROWS`, `KEEP_MS`, `CBOE_DELAY_MS`, `US_STOCKS_ID`, `FRESH_MS` (exported as it is named, and imported by `paper.ts` as `US_FRESH_MS`), `AKSHARE_TOOLS` and `US_TICKER`.
  - **Pure functions:** `holdBackMs`, `readAtOf`, `readLike`, `publicNo`, `joinHubs`, `cboeQuoteInSession`, `usLineAt`, `usSession`, and `hubCovers(source, symbol): { covers: boolean; pricesOnly: boolean }`. `hubCovers` is `streamOf` plus `US_TICKER` on `US_STOCKS_ID`.
  - Each is copied from its moved file with its JSDoc, together with any unexported helper it calls. Nothing the account does not import is copied. The file header says the market's file is the original.
- Produces (in `client.ts`):
```ts
export const MARKET_URL_DEFAULT = "http://127.0.0.1:4821";
export const MARKET_DOWN = "The market service is not answering, so prices here are not current.";
export function marketDown(): Refusal;   // no("E_VENUE_UNREACHABLE", { venue: "market", message: MARKET_DOWN })
export interface MarketClient {
  readonly url: string;
  /** a protocol answer: value (restamped with readLike from readAt), the refusal it carried, or marketDown() — kept ttlMs, shared in flight */
  get<T>(path: string, ttlMs: number): Promise<{ value: T; extra: Record<string, unknown> } | Refusal>;
  post<T>(path: string, body: unknown): Promise<T | Refusal>;
  /** a relay: the market's Response as it came, or marketDown() — never parsed */
  raw(path: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal; timeoutMs: number }): Promise<Response | Refusal>;
  /** the first failure since the last answer, ms; undefined while it answers */
  staleSince(): number | undefined;
}
export function marketClient(o: { url: string; fetch?: typeof fetch; clock?: () => number; timeoutMs?: number /* 8000 */ }): MarketClient;
```
  - Requests go to `new URL(path, url)` with no `Origin` header.
  - A network error, a timeout, a non-JSON body or a 5xx answers `marketDown()` and sets `staleSince`. Any answered request clears it.
  - A refusal is never kept past 2 s.
- Produces (in `link.ts`):
```ts
export interface MarketLink {
  readonly client: MarketClient;
  sources(): PublicSource[];        // the latest list: [] until /api/sources answers; refetched every 60 s, and every 5 s while it has not answered
  readonly hub: MarketHub;          // RemoteHub
  readonly china: ChinaSource;      // remoteChina
  readonly price: Price;            // remotePrice
  marketOld(): { since: string; message: string } | undefined;   // from client.staleSince(), message MARKET_DOWN
  ready(ms: number): Promise<boolean>;  // resolves when /api/sources first answers, or false after ms
  start(): void;                    // begins the refetch and the hub stream
  close(): void;
}
export function connectMarket(o: { url: string; fetch?: typeof fetch; clock?: () => number; clientId?: string }): MarketLink;
```
  - **The source list** `sources()` returns a new array only when the list changes: compare ids and `has` flags.
  - **`remoteSource(c, row)`** in `sources.ts` builds a `PublicSource`:
    - It defines exactly the methods in `row.has`.
    - `listings` remembers the `notes` per `q` for `notes()`.
    - `sessions` is `usClock` from `account/calendar.ts` when `row.sessions === usClock.zone`, and absent otherwise.
    - `feed` is absent.
    - Keep times: listings, stats and events 5 s; line 2 s; candles 10 s; book and trades 1 s; settlement 30 s; funding 60 s.
  - **`RemoteHub implements MarketHub`** in `hub.ts`:
    - `covers` and `pricesOnly` use `hubCovers`.
    - `hold` and `want` POST to the market (a want renews at most every 10 s per market) and are remembered for re-sending.
    - It opens one `GET /api/hub?client=` stream (the link's `clientId`, a random 16 hex digits by default). From its events it keeps, per market, the last `HubQuote`, the last `HubBook`, `recent`, a ring of at most 200 entries (`RING_SIZE`) with the market's seq, and `evictedSeq`.
    - `quote`, `book` and `trades` answer from that store. `since` answers from it with the moved `StreamHub.since` loop (copy it).
    - `confirmed` calls `/api/hub/confirmed`, and answers `undefined` at once while the stream is down.
    - `onTick` fires a `HubTick` for each event.
    - **When the stream drops:** every kept quote and book gets `live: false` and fires a `live` tick. It reconnects with backoff from 500 ms to 30 s (`BACKOFF_MIN_MS`, `BACKOFF_MAX_MS`), then re-sends every hold and want.
  - **`remoteChina(c)`** in `china.ts`: `status()` is the last `status` received, or `{state: "unavailable", said: MARKET_DOWN}` while the client is stale.
  - **`remotePrice(c)`** in `price.ts`: each asset is kept 10 s. While the market is down it answers the last price it had for that asset, or `undefined` if it never had one.
- `PortfolioServiceOptions.publicMarkets` becomes `PublicSource[] | (() => PublicSource[]) | undefined`. `publicMarkets()` wraps each source with `keptPublic` again whenever the array it gets is a different object, and resets `publicRaw`. The default is `[]`.
- `PortfolioServerOptions.market?: MarketLink | undefined`. Without it, the four routes answer exactly as today's `off` branches do, with the same words and statuses.

| Account route | Relayed to the market | Market unreachable |
|---|---|---|
| `GET /api/cn/relay` | `/api/cn/relay?<query unchanged>`, with `accept`, `referer` and `user-agent`, `timeoutMs` 20 000 | 502 `{ok:false, relay:"unreachable"}`, `x-cn-relay: refused` |
| `POST /api/cn/ifind` | `/api/cn/ifind`, body `JSON.stringify(req.body)`, `timeoutMs` 20 000 | 502 `{ok:false, ifind:"unreachable"}`, `x-cn-ifind: refused` |
| `GET /api/akshare/tools` | same path, `timeoutMs` 125 000 | 503 `{ok:false, akshare:"unavailable", message: MARKET_DOWN}` |
| `POST /api/akshare/call` | same path and body, `timeoutMs` 125 000 | 503 `{ok:false, akshare:"unavailable", message: MARKET_DOWN}` |

  - Every relay passes the caller-gone `AbortSignal` (`callerGone(res)`).
  - The account answers the market's status and body bytes unchanged, plus these headers when present: `content-type`, `location`, `x-cn-relay`, `x-cn-ifind` and `x-content-type-options`.
- **The main.**
  - It builds `const market = connectMarket({ url: process.env.PORTFOLIO_MARKET_URL || MARKET_URL_DEFAULT })` and calls `market.start()` before `PortfolioService.create`.
  - It passes `publicMarkets: () => market.sources(), streams: market.hub, china: market.china, liveDeps: { price: market.price }` to the service and `market` to the server.
  - It replaces the Lunhui and AKShare start lines with `market: <url> · ${await market.ready(3_000) ? "answering" : "not answering yet: start it with cd market && npm run market"}`.
  - `close()` calls `market.close()` after `svc.closeStreams()`.

- [ ] **Step 1: Write the failing tests.**

  `account/test/unit/market-link.test.ts` starts a real market in-process with `startMarketServer` over `createMarketCore({ sources: [fake], hub: fakeHub, china: fakeChina, price })`, imported from `../../../market/src/`.
```ts
it("lists the market's sources and reads a listing with its read time", ...)  // link.sources()[0].id === "fake"; readAtOf((await s.listings({q:"BTC",limit:5}))[0]) === 1_700_000_000_000; s.notes!({q:"BTC"}) equals ["fake note"]
it("hands a source's refusal back unchanged", ...)                            // code and message equal the fake's
it("refuses with MARKET_DOWN while the market is down, and answers again when it is back", ...)  // close the market: refusal {code:"E_VENUE_UNREACHABLE", venue:"market", message: MARKET_DOWN}; link.marketOld()?.message === MARKET_DOWN; restart it on the same port: answers, and marketOld() is undefined
it("sources fill in once the market answers", ...)                            // connectMarket before the market listens: sources() is []; start it; within 6 s sources() has "fake", and service.explore({q:"BTC"}) lists it, with no new service
it("reads China and its status", ...)                                         // quotes() is a Map with sh600519; status().state "live"; down → status().state "unavailable"
it("prices an asset, and keeps its last price while the market is down", ...) // 62000; down → 62000 again; an asset never priced → undefined
it("mirrors a held market: quote, book for a book hold, trades and since", ...)  // fake hub emits; link.hub.quote(...)?.bid; link.hub.since(src, sym, 0).trades equals the fake's since over the same ring
it("the hub reconnects and holds again", ...)                                 // restart the market: the fake hub sees the hold again; a new quote reaches link.hub.quote
it("covers every row of the market's fixture", ...)                           // hubCovers over ../../../market/test/fixtures/hub-covers.json
```
  `account/test/unit/market-account.test.ts` builds the service as the main does (`publicMarkets: () => link.sources(), streams: link.hub, china: link.china, liveDeps: { price: link.price }`) and a paper venue, the way `account-paper.test.ts` opens one.
```ts
it("answers explore with the same body as the in-process source", ...)   // GET /api/account/explore?q=BTC over the link deepEquals the same over publicMarkets: [fake]
it("fills a paper market order at the market's price", ...)              // the fake's line price 100 → the fill's price is 100
it("pushes a followed public market's quote on the account stream", ...) // a fake source with id "coinbase"; follow "coinbase:BTC/USD" (hubCovers says yes); a fake hub quote → a `quote` event with that key and the bid
it("values with the market's price", ...)                                // the service's liveDeps().price("BTC") === 62000 (through link.price)
```
  `account/test/unit/market-relay.test.ts` uses a stub market: a plain `node:http` server in the test that records each request. It needs no market code.
```ts
it("relays bytes unchanged", ...)            // stub answers 200 with Uint8Array [0xb9,0xfa,0xc6,0xf3,0xff] and content-type "text/plain; charset=GBK", x-cn-relay upstream → the account answers the same five bytes, the same content-type and x-cn-relay; the stub saw the same query and the accept, referer and user-agent headers
it("relays a redirect's location", ...)      // stub 302 location http://qt.gtimg.cn/x → account 302, same location
it("relays iFinD's body and answers unreachable when the market is down", ...)  // POST body seen by the stub equals the caller's; stub closed → 502 {ok:false, ifind:"unreachable"}
it("relays AKShare and says the market is down in plain words", ...)            // tools pass through; stub closed → 503 {ok:false, akshare:"unavailable", message: MARKET_DOWN}
it("an aborted call aborts upstream", ...)    // the caller aborts a /api/akshare/call the stub holds open; the stub's request emits "close" within 1 s
it("answers off with no market, as before", ...)  // startPortfolioServer without market: /api/cn/relay → 503 {relay:"off"}; /api/akshare/tools → 503 {akshare:"off"}
```
  `account/test/unit/no-market-code.test.ts` (model it on `face/tests/no-market-hosts.test.ts`) walks `account/src`.
```ts
const MARKET_ONLY_HOST = /gtimg\.cn|finance\.qq\.com|eastmoney\.com|51ifind\.com|api\.nasdaq\.com|cdn-api\.cboe\.com|api-futures\.kucoin\.com|api\.bybit\.com|contract\.mexc\.com|fapi\.binance\.com|www\.deribit\.com|api\.gateio\.ws|ws\.kraken\.com|ws\.okx\.com|advanced-trade-ws\.coinbase\.com/;
it("account/src names no host only the market reads", ...)      // walked > 200 files; none matches MARKET_ONLY_HOST
it("account/src spawns no AKShare and holds no iFinD token", ...) // none matches /akshare-mcp|MARKET_AKSHARE_BIN|PORTFOLIO_AKSHARE_BIN|IFIND_(ACCESS|REFRESH)_TOKEN|quantapi/
it("account/src imports nothing from the market's tree", ...)     // none matches /market\/src\//
it("a service made without a link reads no public source", ...)  // PortfolioService.create({home: tmp, real: true, venues:"frontline", liveDeps:{http: recorder}}); explore({q:"BTC"}) and quotes([{venue:"coinbase",symbol:"BTC/USD"}]) → the recorder saw no request
```

- [ ] **Step 2: Run the tests and see them fail.**

  Run `cd account && npx vitest run test/unit/market-link.test.ts test/unit/market-account.test.ts test/unit/market-relay.test.ts test/unit/no-market-code.test.ts`. Expected: FAIL, because the modules do not exist and `market/src` imports remain.

- [ ] **Step 3: Implement the files and edits named above.**
  - Write `shapes.ts` first and repoint the imports. `npm run typecheck` names any symbol that is missing.
  - Then write the client, the adapters and the link, then the service and server edits.

- [ ] **Step 4: Run every suite and see it pass.**
  - Run `cd account && npm test && npm run typecheck`. Expected: all pass. The `market-moved` and `no-market-code` cases pass.
  - Run `cd market && npm test && npm run typecheck`.
  - Run `cd face && npm test && npm run typecheck`, then `FACE_SMOKE=1 npm test`. Expected: 0 fail. The stand-in passes its own `publicMarkets` and `streams`, and the seat and Lunhui smokes reach the account as before.

- [ ] **Step 5: Commit.**

  Message: `feat(account): the account reads the market through one link - sources, hub mirror, China and price over HTTP; Lunhui and AKShare relayed; account/src names no market-only host`.

---

### Task 5: The market is down: old prices are marked, prepare refuses, paper waits

**Files:**
- Modify: `account/src/portfolio/service.ts`:
  - `PortfolioServiceOptions` gains `marketOld`.
  - `holdings()` (at about 982) attaches it.
  - `snapshot()` (at about 1177) skips.
  - `HoldingsView` (find its declaration with `grep -n "HoldingsView" account/src/portfolio`) gains the field.
- Modify: `account/src/portfolio/server.ts` (the main passes `marketOld: () => market.marketOld()`).
- Test: `account/test/unit/market-down.test.ts`.

**Interfaces:**
- Consumes: Task 4's `connectMarket`, `MarketLink.marketOld()` and `MARKET_DOWN`.
- Produces:
  - `PortfolioServiceOptions.marketOld?: (() => { since: string; message: string } | undefined) | undefined`.
  - `HoldingsView.marketOld?: { since: string; message: string } | undefined` is present only while the market is not answering.
  - `snapshot()` returns `{ written: false, at }` while `marketOld()` is defined. A curve point at an old price would be a false record.

- [ ] **Step 1: Write the failing tests.**

  The test file sets up a market in-process with a fake source whose line price is 100, then a link, a service as in Task 4, a paper venue, and a paper buy at the market. Then the market is closed.
```ts
it("still shows the paper holdings while the market is down, at their last price, marked old", ...)
  // GET /api/account/holdings → 200; the paper line's usd === qty * 100; body.marketOld.message === MARKET_DOWN; Date.parse(body.marketOld.since) is finite
it("drops the mark once the market answers again", ...)   // market restarted on the same port; after one answered read, holdings has no marketOld
it("refuses a prepare that needs a price, in plain words", ...)
  // POST /api/account/prepare {draft:{type:"liveOrder", venue:<paper>, symbol, side:"buy", qty:1, orderType:"market"}} → 409, refusal.message contains "market service is not answering"
it("fills no resting paper order while the market is down", ...)
  // a limit buy at 95 rests; the fake hub's last mirrored quote showed ask 90 before the close; after svc.watchPaper ticks (step the clock as account-paper tests do), the order is still open
it("fills it once the market is back", ...)               // restart; the hub quote with ask 90 arrives live → the order fills at a price ≤ 95
it("takes no net-worth point while prices are old", ...)  // svc.snapshot() → {written:false}
```

- [ ] **Step 2: Run the tests and see them fail.**

  Run `cd account && npx vitest run test/unit/market-down.test.ts`. Expected: the `marketOld`, prepare-sentence and snapshot cases FAIL. The two paper cases may already pass (paper prices from `ref.last` and fills only on `confirmed()`). If so, they stay as pins.

- [ ] **Step 3: Implement `marketOld`.**
  - If the prepare refusal's message is not `MARKET_DOWN`'s sentence, follow the refusal from `liveMarket` → `kept(v).market` → paper's pricer back to `account.prepare` (`account/src/portfolio/account/exchange.ts` `prepare`). Make it carry the source's refusal message where it currently replaces it.
  - Never serve a kept listing past its keep time to make a price appear.

- [ ] **Step 4: Run every suite and see it pass.**

  Run all three suites. Expected: green.

- [ ] **Step 5: Commit.**

  Message: `feat(account): while the market is down, holdings keep their last price and say so, prepare refuses in plain words, paper waits, no curve point is taken`.

---

### Task 6: The market's public reads and its stream

**Files:**
- Create: `market/src/reads.ts`, `market/src/stream.ts` and `market/src/follows.ts`.
- Modify: `market/src/server.ts` (the main also mounts `mountReads`).
- Test: `market/test/unit/reads.test.ts` and `market/test/unit/market-stream.test.ts`.
- Test: `account/test/unit/market-parity.test.ts`, the one place both packages' read code is compared.

**Interfaces:**
- Consumes: Task 3's `MarketCore`.
- Produces (in `reads.ts`):
```ts
export interface MarketReads {
  explore(o: { tab?: string; q?: string; key?: string; sort?: string; limit?: number }): Promise<Exploration | Refusal>;
  quotes(pairs: Array<{ venue: string; symbol: string }>): Promise<Array<{ venue: string; symbol: string; market?: Market; refusal?: Refusal }> | Refusal>;
  candles(venue: string, symbol: string, interval: string, ask: { range?: string; before?: string | number; limit?: string | number }): Promise<CandlesView | ChinaHistory | Refusal>;
  book(venue: string, symbol: string, depth?: number): Promise<BookView | Refusal>;
  trades(venue: string, symbol: string, limit?: number): Promise<TradesView | Refusal>;
}
export function marketReads(core: MarketCore): MarketReads;
export function mountReads(app: express.Express, core: MarketCore, reads: MarketReads): void;
```
  - Each method is the public half of its `account/src/portfolio/service.ts` counterpart: `explore` (at about 915), `quotes` (1721), `candles` (1376), `marketBook` (1452) and `marketTrades` (1508). They run with no connected venue (`exploreAcross({ connected: [], public: core.sources() }, …)`, with China as `explore` merges it). `CandlesView`, `BookView` and `TradesView` are copied with them.
  - Routes, with the query parsing and status codes of the account routes they mirror (`server.ts` `/api/account/explore` at about 694, `/quotes` 740, `/candles` 807, `/book` 816, `/trades` 823): `GET /api/explore`, `GET /api/quotes`, `GET /api/candles`, `GET /api/book` and `GET /api/trades`.
- Produces (in `stream.ts`):
  - `MarketStream` is a copy of `account/src/portfolio/account/stream.ts` without `ACCOUNT_EVENTS`. Its events are `quote`, `trades` and `book` only, with the same `COALESCE_MS`, `MAX_FOLLOWS`, `CLIENT_ID` and `STREAM_ID`.
- Produces (in `follows.ts`):
  - `export function marketFollows(core: MarketCore, stream: MarketStream): { follow(client: string, keys: string[]): void; again(client: string, keys: string[]): void; close(): void }`.
  - It is the port of `service.ts` `pageFollows`, `followKey`, `pageAgain`, `unfollowKey`, `streamAt` (its public branch only: a key `<source id or public:id>:<symbol>` the hub covers), `marketTold` and `tellMarket`. The event payloads are byte-identical to the account's.
  - Routes: `GET /api/stream?client=&markets=&since=` and `POST /api/stream/markets {client, markets, n}`, with the account's checks and answers (`server.ts` at about 600–628), the "account" word removed.

- [ ] **Step 1: Write the failing tests.**

  `market/test/unit/reads.test.ts` uses fake sources, a fake China and a fake hub.
```ts
it("explores the public markets and finds China on a search", ...)   // /api/explore?q=BTC lists the fake's BTC/USDT; ?q=600519 has a china item
it("quotes a public pair and an A share", ...)                       // /api/quotes?pairs=fake|BTC/USDT,china|sh600519
it("answers candles, book and trades from the public source", ...)
it("refuses a venue that is not public", ...)                        // /api/book?venue=my-okx&symbol=BTC/USDT → the account's refusal code for an unknown venue
```
  `market/test/unit/market-stream.test.ts`:
```ts
it("pushes a followed market's quote, book and trades", ...)
it("tells a price-only market its quote alone", ...)                 // a "~" key, or a us-stocks key
it("refuses a navigation and a bad client name", ...)                // 403 and 400 with the account's words
```
  `account/test/unit/market-parity.test.ts` builds the same fakes as an in-process `PortfolioService` with no venue and as `createMarketCore`, then compares the HTTP bodies:
```ts
it("explore answers the same with no venue connected", ...)   // deepEqual(account /api/account/explore?q=BTC, market /api/explore?q=BTC), after deleting volatile asOf/at fields with one helper
it("quotes, candles, book and trades answer the same", ...)
it("a followed market's quote event is the same on both streams", ...)  // one fake hub tick → the same JSON data on both
```

- [ ] **Step 2: Run the tests and see them fail.**

  Run `cd market && npx vitest run test/unit/reads.test.ts test/unit/market-stream.test.ts`, then `cd account && npx vitest run test/unit/market-parity.test.ts`. Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement the files.**

  Copy each method from `service.ts` and delete its connected-venue branch. Do not rewrite what is kept. The parity test is the check.

  The account keeps its own copies until plan A2 switches the face to these routes and deletes the copies (see "Left for plan A2").

- [ ] **Step 4: Run every suite and see it pass.**

  Run all three suites. Expected: green.

- [ ] **Step 5: Commit.**

  Message: `feat(market): the public reads and the market stream under names without account - explore, quotes, candles, book, trades, follows; parity with the account pinned`.

---

### Task 7: `market:service`, the LaunchAgent installer

**Files:**
- Create: `market/src/market-service.ts`.
- Test: `market/test/unit/market-service.test.ts`.
- Modify: `account/src/portfolio/account-service.ts` (`plan`'s `keep`) and `account/test/unit/account-service.test.ts`.

**Interfaces:**
- Produces (in `market-service.ts`):
  - `export const LABEL = "com.gravit.market"`.
  - `export function plan(serverArgs: string[], o?: { node?: string; root?: string; repo?: string; logs?: string; env?: Record<string, string | undefined> }): ServicePlan`. `ServicePlan` has the same fields as the account's. `repo` defaults to `dirname(root)`.
  - The plist is the account's plist (`account-service.ts` at about lines 58–84) with:
    - args `[node, "--env-file-if-exists=<repo>/.env.ifind", <root>/node_modules/tsx/dist/cli.mjs, <root>/src/server.ts, ...serverArgs]`. The market reads the iFinD token from the repo's gitignored file at each start. The plist carries the file's path, never its contents, and the installer never reads the file;
    - logs `<logs>/market.log` and `<logs>/market.err.log`, where `logs` defaults to `~/Library/Logs/gravit-market`;
    - `keep` = `PATH` (npm's folders dropped, as the account does), `HOME` and `MARKET_AKSHARE_BIN`. `MARKET_BIND`, `MARKET_HOSTS`, `IFIND_*` and every other variable are dropped.
  - The commands `install`, `status` (it asks `GET /api/health` on the plist's `--port`, default 4821), `restart`, `logs` and `uninstall`. They are the account's commands without `code`.
  - Install refuses on any platform but macOS, with the account's sentence ending `npm run market`.
- `account-service.ts` `plan` also keeps `PORTFOLIO_MARKET_URL` when it is set.

- [ ] **Step 1: Write the failing tests.**

  Model them on `account/test/unit/account-service.test.ts`. The fixture env holds PATH (with npm's folders), HOME, `MARKET_AKSHARE_BIN: "/opt/x/akshare-mcp"`, `MARKET_BIND: "0.0.0.0"`, `IFIND_ACCESS_TOKEN: "ifind-fixture-token"` and `SECRET_TOKEN: "secret-fixture-value"`. The tests pass `root: "/r/market"`.
```ts
it("runs this folder's market server under node and tsx by their full paths", ...)  // args equal ["/opt/homebrew/bin/node","--env-file-if-exists=/r/.env.ifind","/r/market/node_modules/tsx/dist/cli.mjs","/r/market/src/server.ts","--port","4821"]; Label com.gravit.market
it("loads the iFinD token by its file's path at each start, never by value", ...)  // the plist text contains "--env-file-if-exists=/r/.env.ifind" and does not contain "ifind-fixture-token"
it("starts at login, again only after an exit by accident, logs only the user can read", ...)  // RunAtLoad, KeepAlive SuccessfulExit false, Umask 63, logs /l/market.log and /l/market.err.log
it("keeps PATH, HOME and the AKShare command; never the bind, a token or anything else", ...)  // contains MARKET_AKSHARE_BIN; not MARKET_BIND, IFIND_ACCESS_TOKEN or SECRET_TOKEN
it("writes what it is given as XML text", ...)
```
  In `account-service.test.ts`, add `PORTFOLIO_MARKET_URL: "http://127.0.0.1:4821"` to the fixture env and assert that the plist contains `<key>PORTFOLIO_MARKET_URL</key><string>http://127.0.0.1:4821</string>`.

- [ ] **Step 2: Run the tests and see them fail.**

  Run `cd market && npx vitest run test/unit/market-service.test.ts`. Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement `plan`, the main, and the account's `keep` line.**

  Do not run `install`.

- [ ] **Step 4: Run every suite and see it pass.**

  Run all three suites. Expected: green.

- [ ] **Step 5: Commit.**

  Message: `feat(market): market:service, the market as a LaunchAgent - installed by the operator, never by an agent; the account's keeps PORTFOLIO_MARKET_URL`.

---

### Task 8: The market box in compose

**Files:**
- Create: `market/Dockerfile`.
- Modify: `account/Dockerfile`, `compose.yml` and `face/tests/compose.test.ts`.

**Interfaces:**
- **`market/Dockerfile`:**
  - It starts `FROM node:22-bookworm-slim` and keeps the apt line for ca-certificates, curl and git.
  - Its uv and akshare-mcp layer is `account/Dockerfile`'s lines 10–21, moved verbatim with `PORTFOLIO_AKSHARE_BIN` renamed `MARKET_AKSHARE_BIN=/usr/local/bin/akshare-mcp`.
  - Then: `WORKDIR /app`, `COPY package.json package-lock.json ./`, `RUN npm ci`, `COPY . .`, `EXPOSE 4821`.
- **`account/Dockerfile`** loses the uv and akshare-mcp layer and the curl and git packages; ca-certificates stays. It keeps `EXPOSE 4820`.
- **`compose.yml`:**
  - A new `market` service: `build: ./market`, `command: ["npm", "run", "market"]`, `environment: {MARKET_BIND: "0.0.0.0", MARKET_HOSTS: "market:4821"}`, `env_file: [{path: .env.ifind, required: false}]` (moved from `account`), `expose: ["4821"]`, no volume, `healthcheck` probing `fetch('http://127.0.0.1:4821/api/health')` with the account's interval, retries and start period, and `networks: [gravit]`.
  - The `account` service loses `env_file`, gains `PORTFOLIO_MARKET_URL: "http://market:4821"` and `depends_on: {market: {condition: service_healthy}}`, and keeps its `/api/overview` health check.
  - The `agent` service is unchanged.
  - Update the header comments: "the market box runs AKShare and holds the iFinD token; the account box holds neither".

- [ ] **Step 1: Write the failing test.** Edit `face/tests/compose.test.ts`.

  In the first test:
```ts
assert.deepEqual(Object.keys(c.services).sort(), ["account", "agent", "market"]);
assert.deepEqual(c.services.market.expose, ["4821"]);
assert.equal(c.services.market.ports, undefined);
assert.ok(Object.values(c.services).every(s => (s.ports ?? []).every(p => !/482[01]/.test(String(p)))), "no service publishes 4820 or 4821");
assert.match(c.services.market.healthcheck.test.join(" "), /4821\/api\/health/);
assert.equal(c.services.market.environment.MARKET_BIND, "0.0.0.0");
assert.equal(c.services.market.environment.MARKET_HOSTS, "market:4821");
assert.deepEqual(c.services.market.env_file, [{ path: ".env.ifind", required: false }]);
assert.equal(c.services.account.env_file, undefined);
assert.equal(c.services.account.environment.PORTFOLIO_MARKET_URL, "http://market:4821");
assert.equal(c.services.account.depends_on.market.condition, "service_healthy");
assert.equal(c.services.market.volumes, undefined);
```
  Remove the old line that asserted `env_file` on the account box. The second test becomes "the agent image and the account image carry no AKShare, the market image carries it at the pin": the same three `includes` with `MARKET_AKSHARE_BIN`, the layer-order check, and `doesNotMatch(accountFile, /akshare|astral\.sh|uv tool/i)`.

- [ ] **Step 2: Run the test and see it fail.**

  Run `cd face && node --import tsx --test tests/compose.test.ts`. Expected: FAIL.

- [ ] **Step 3: Edit the three files.**

- [ ] **Step 4: Run every suite and see it pass.**

  Run all three suites. Expected: green. Do not run `docker compose`. The operator's two-box drill is A2's rewrite.

- [ ] **Step 5: Commit.**

  Message: `feat: compose runs the market as its own box - AKShare and the iFinD token move from the account box to it; the account reads it at market:4821`.

---

### Task 9: The docs say what is built

**Files:**
- Modify: `CLAUDE.md`, `DEVELOPMENT.md` (§3.9, plus a new §3.10 "The market service (`market/`)"), `account/README.md`, `market/README.md`, and the comment in `face/tests/no-market-hosts.test.ts`.

**Interfaces:** none. The docs describe present-tense facts only.

- [ ] **Step 1: Write the failing test.**

  Add a case to `market/test/unit/no-wallet.test.ts`:
```ts
it("the README names the port, the scripts and the AKShare command", () => {
  const r = readFileSync(join(ROOT, "README.md"), "utf8");
  for (const s of ["127.0.0.1:4821", "npm run market", "npm run market:service", "MARKET_AKSHARE_BIN", "MARKET_BIND", "MARKET_HOSTS", "NOTICE"]) expect(r).toContain(s);
});
```

- [ ] **Step 2: Run it and see it fail.**

  Run `cd market && npx vitest run test/unit/no-wallet.test.ts`.

- [ ] **Step 3: Write the docs.**
  - **`CLAUDE.md`:**
    - Add one map row after `account/`:
      > `market/` | the market service, its own package (`gravit-market`, Node 22, `npm ci` here), moved out of `account/` on 2026-11-03 (`NOTICE`, `LICENSE` Apache-2.0): the keyless public sources and their stream hub, China (Tencent), the AKShare sidecar (`akshare-mcp` as an MCP child, `MARKET_AKSHARE_BIN`), the Lunhui relay and iFinD, on 127.0.0.1:4821; it writes nothing and holds no wallet; the source protocol the account reads it by (`src/protocol.ts`) and the public reads A2's face will use (`/api/explore`, `/api/quotes`, `/api/candles`, `/api/book`, `/api/trades`, `/api/stream`); scripts `market`, `market:service` (a LaunchAgent the operator installs), `test`, `typecheck`; `MARKET_BIND` and `MARKET_HOSTS` for the compose box only
    - In the `account/` row, replace the AKShare and China clauses with: "it reads the market through one link (`src/portfolio/market/`, `PORTFOLIO_MARKET_URL`, default 127.0.0.1:4821) and relays `/api/cn/*` and `/api/akshare/*` to it".
    - In the gotcha "The Account is a second process", add: "and the market is a third: `cd market && npm ci && npm run market`".
    - Change the opening line from "with AKShare … as the Account's sidecar" to "as the market's sidecar".
    - Update "Last reviewed".
  - **`DEVELOPMENT.md` §3.10:**
    - The package and its origin.
    - The moved and copied file lists (pointing to `market/NOTICE`).
    - The fence and NO_PAGE, and `/api/health`.
    - The protocol table from Task 3, and the public reads from Task 6.
    - The hub mirror and its reconnect.
    - The read cache.
    - `MARKET_DOWN` and the Task 5 behaviours.
    - `market:service`, and the box.
    - The suite counts as run in Step 4.
  - **`DEVELOPMENT.md` §3.9** keeps the account's facts, with China and AKShare now described as relayed. Rewrite its "China, added to the copy" and "The AKShare sidecar" paragraphs as one-line pointers to §3.10.
  - **`account/README.md`:** the Markets, Lunhui and AKShare bullets now say the account relays these to the market (the URL variable, and the `unreachable`/`unavailable` answers). The "AKShare, the sidecar" section moves to `market/README.md`. "In the box" names the market box.
  - **`market/README.md`:** the install, the run, the LaunchAgent (the operator's step), AKShare's install line (moved from `account/README.md`), iFinD's environment, the box, and the test commands.
  - **The face comment:** in the `no-market-hosts.test.ts` header comment, "China is the Account's (account/src/portfolio/live/cn-*.ts)" becomes "China is the market's (market/src/live/cn-*.ts), reached through the Account".
  - `face/README.md`'s drills are A2's. Leave them as they are.

- [ ] **Step 4: Run every suite and see it pass.**

  Run all three suites, then `cd face && FACE_SMOKE=1 npm test`. Record the counts in §3.10.

- [ ] **Step 5: Commit.**

  Message: `docs: the market service as built - CLAUDE.md map row, DEVELOPMENT 3.10, the account and market READMEs`.

---

## For the operator, after the merge (not an agent's step)

1. `cd market && npm ci`.
2. Run the market: `npm run market` in a terminal, or install it with `npm run market:service -- install`. Either way it reads the iFinD token from the repo's `.env.ifind` at each start, when that file exists. The plist carries only the file's path.
3. Restart the account (`npm run account`, or `npm run account:service -- restart`). Its start line says whether the market is answering.

## Left for plan A2

- **The face:**
  - `FACE_MARKET_URL`.
  - The proxy split onto the market's public reads and stream (Task 6).
  - `market-quotes.ts` and the Lunhui plugin pointed at the market.
  - The client's joins: keyed-first, explore's venues, and the asset page.
  - The marker for `marketOld`.
- **Gravit:** the `mcp-market` row (`market:mcp`), and every tool rename in spec §4.4.
- **The account:** once the face reads the market directly, remove:
  - its Market routes;
  - the copies Task 6 duplicated: explore, quotes, candles, book, trades and the market follows;
  - the four relays.
- **Compose and drills:**
  - The agent box gets `FACE_MARKET_URL=http://market:4821`.
  - `face/README.md`'s two-box and two-parts drills are rewritten for three boxes.
