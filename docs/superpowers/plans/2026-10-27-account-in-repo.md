# The Account's service in this tree (one repo, two boxes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Account's service (Linqi's buyer-agent-demo, the portfolio part) into this repository as `account/`, point the face at it by default, and give both programs the two switches that let them run as two separate boxes under `docker compose` while the two-host-process dev loop stays exactly as it is.

**Architecture:** `account/` is a plain copy (no subtree, no submodule) of `src/portfolio`, `src/core`, `src/agent`, `src/contract`, the page, the run-time fixtures and the tests of buyer-agent-demo @ 133b9a7, with its own `package.json`; the face's seat row and smokes default to `../account`; the Account learns `PORTFOLIO_BIND` + `PORTFOLIO_HOSTS` and the face learns `FACE_BIND`, all unset on the host; a root `compose.yml` runs `agent` (the face, the repo bind-mounted, no docker socket, no Account path) and `account` (its own volume) on a private network. Nothing in the Account's routes, envelope, cards or venues changes.

**Tech Stack:** Node 22 (tsx, ESM), express, @modelcontextprotocol/sdk, vitest (the Account), `node --test` via tsx (the face), Docker Compose v2, Apache-2.0 attribution.

**Spec:** `docs/superpowers/specs/2026-10-27-account-in-repo-design.md`

**Branch:** `feat/account-in-repo` from local `main`'s tip, in the worktree `.claude/worktrees/account-in-repo` (superpowers:using-git-worktrees). The ledger is `docs/superpowers/plans/2026-10-27-account-in-repo-ledger.md`, created in Task 1 and appended by every task: rulings, measured numbers, deferred minors, the final review.

## Global Constraints

- Node `^22.19.0 || >=24.0.0` on both packages (the face's `engines`; `account/package.json` says the same).
- `account/` is a copy of buyer-agent-demo @ **133b9a7** from `~/buyer-agent-demo`; `account/LICENSE` is the Apache-2.0 text from the origin repository's default branch (the checkout has none), `account/NOTICE` names the origin URL, the commit, the date 2026-10-27 and the copied paths.
- `ccxt` **stays** in `account/package.json` (dynamic `import("ccxt")` in `live/exchange.ts` and `live/hyperliquid-trade.ts`).
- No change to the Account's routes, door protocol, envelope, cards, venues or paper book; the face's client and the seat change nothing but defaults.
- Every new switch is unset on the host and then changes nothing: `PORTFOLIO_BIND` → `127.0.0.1`, `PORTFOLIO_HOSTS` → none, `FACE_BIND` → `127.0.0.1`. `PORTFOLIO_HOSTS` is matched **exactly** (`host:port`, trimmed) against the `Host` header; the `Origin` and Fetch-Metadata rules are untouched.
- The Account's home on the host is the code's default (`~/.buyer-agent-demo`, `home.ts`): no run line in this tree names `--home`; `BUYER_HOME` is set only inside the agent box (`/seat-home`). The builder never touches `~/.openpaper` or `~/.buyer-agent-demo`.
- The agent box mounts **no** docker socket and **no** path of the Account's; both services publish their port on `127.0.0.1` only; `agent` waits for `account` to be healthy.
- `GRAVIT.md` does not change (`face/tests/gravit-md.test.ts`, ≤ 4,500 bytes). Docs stay English. Commit messages: lowercase `feat:`/`fix:`/`test:`/`docs:` sentences, no backticks, no attribution lines.
- The face's suites (`cd face && npm test && npm run typecheck`) stay green at every commit; `FACE_SMOKE=1` suites green at the end of Tasks 2 and 5. The final whole-branch review runs on the `fable` model (the operator's rule of 2026-10-23).

## Review Focus

1. `PORTFOLIO_HOSTS` entries are compared exactly to the `Host` header: `http://account:4820`, `account` (no port) and `account:4820/` never admit `Host: account:4820`; ` account:4820 ` (spaces) does after trimming — Task 3, `server-guard.test.ts` "an extra host".
2. A foreign `Origin` from an accepted extra host is still refused (the two rules stack) — Task 3, same test.
3. A fresh clone with no `npm ci` in `account/`: the seat row still composes, the face still boots (`failOnStartupError: false`), the smokes skip with a message naming `cd account && npm ci` — Task 2, `standin-helper.test.ts` "skips with the install line".
4. `FACE_BIND` unset keeps the webserver row byte-for-byte as pinned today; set, it replaces `host` and nothing else — Task 4, `overlay.test.ts`.
5. `agent` started before `account` answers hangs the seat's startup `GET /api/account` for two minutes (the README's hang drill): the compose file must carry `depends_on: account: condition: service_healthy` and a health check on `GET /api/overview` — Task 5, the `docker compose config` assertions.

---

### Task 1: `account/` — the copy, its package, its licence, its tests

**Files:**
- Create: `account/scripts/import-closure.mjs`
- Create: `account/package.json`, `account/tsconfig.json`, `account/vitest.config.ts`, `account/LICENSE`, `account/NOTICE`, `account/README.md`, `account/.gitignore`
- Create (copied): `account/src/portfolio/**`, `account/src/core/**`, `account/src/agent/**`, `account/src/contract/**`, `account/fixtures/home/portfolio/*.json`, `account/manifests/*.json`, `account/test/**` (the kept subset)
- Create: `docs/superpowers/plans/2026-10-27-account-in-repo-ledger.md`

**Interfaces:**
- Consumes: `~/buyer-agent-demo` at `133b9a7` (verify with `git -C ~/buyer-agent-demo rev-parse --short HEAD`), read-only.
- Produces: the package `account/` with scripts `account`, `portfolio:mcp`, `account:demo`, `account:service`, `account:check`, `test`, `typecheck`; `account/node_modules/tsx/dist/cli.mjs` and `account/src/portfolio/mcp.ts` at the paths Task 2's seat row names; `account/test/standin/ui-standin.ts` at the path the face's stand-in helper names.

- [ ] **Step 1: The ledger**

The design and this plan are already committed on `main` (2026-10-27), so the branch starts with them. Create the ledger with a header naming the plan, the branch, `~/buyer-agent-demo`'s pin and the baseline from the spec §8 (164 files, 163 passed, 1 failed `ui-superagent`, 2,883 tests, 144 s).

- [ ] **Step 2: Write the closure script**

`account/scripts/import-closure.mjs`, run as `node account/scripts/import-closure.mjs <sourceRoot> [--copy <dest>] <entry>...`. It prints to stdout the sorted list of source-relative paths in the import closure of the entries, and to stderr one line per entry it **excluded** with the first import that reached a dropped directory. Rules: follow relative specifiers in `import … from "…"`, `export … from "…"` and `import("…")`, resolved against the importing file with the extension as written (the tree imports `.ts` explicitly); a bare specifier is a package and is not followed; the dropped directories are `src/runner`, `src/control-room`, `src/venues`, `src/wallet`, `src/plugins` — a `src/` entry reaching one is an error (exit 2), a `test/` entry reaching one is excluded, not followed. `--copy` copies every listed file to `<dest>` keeping relative paths (`mkdir -p` as needed). No dependencies beyond `node:fs`, `node:path`, `node:url`.

- [ ] **Step 3: Run the closure and record it**

Entries, in this order: `src/portfolio/server.ts src/portfolio/mcp.ts src/portfolio/account-demo.ts src/portfolio/account-service.ts src/portfolio/account-check.ts test/standin/ui-standin.ts` plus every `test/**/*.test.ts` and every non-test helper under `test/` (`test/attack/account-runs.ts`, `test/standin/*.ts`). Expected: exit 0; stderr names `test/unit/wallet.test.ts` (reaches `src/wallet`) and whichever of `test/account-demo.test.ts`, `test/e2e.test.ts`, `test/portfolio-demo.test.ts` reach `src/runner`; no `src/` entry errors. Paste stdout's count and stderr's lines into the ledger under "Closure".

- [ ] **Step 4: Copy**

Run the script with `--copy account/`, then copy wholesale (not imports): `src/portfolio/public/**` → `account/src/portfolio/public/`, `fixtures/home/portfolio/*.json` → `account/fixtures/home/portfolio/`, `manifests/*.json` → `account/manifests/`. Verify `find account/src -type f | wc -l` is within the closure's count plus `public/`'s 54, and that `account/src/{runner,control-room,venues,wallet,plugins}` do not exist.

- [ ] **Step 5: The package files**

`account/package.json`: `name` `gravit-account`, `version` `0.1.0`, `private` true, `type` `module`, `engines.node` `^22.19.0 || >=24.0.0`, scripts exactly `account`, `portfolio:mcp`, `account:demo`, `account:service`, `account:check`, `test`, `typecheck` with the origin's commands, `dependencies` and `devDependencies` copied verbatim from the origin (ccxt included). `account/tsconfig.json`: the origin's with `include` reduced to `src/**/*.ts`, `test/**/*.ts`, `vitest.config.ts`. `account/vitest.config.ts`: the origin's as is (`fileParallelism: false`, `testTimeout: 90_000`). `account/.gitignore`: `node_modules/`. `account/LICENSE`: `curl -sL https://raw.githubusercontent.com/linqizhe07/buyer-agent-demo/main/LICENSE` — verify the second non-blank line reads `Apache License` and the next `Version 2.0, January 2004`. `account/NOTICE`: three sentences — the origin URL and commit `133b9a7`, the copy date `2026-10-27` and the copied paths, "Licensed under the Apache License, Version 2.0 (see LICENSE); modified in this tree since." `account/README.md`: ten lines — what the directory is, the run line `npm run account` (flags `--read-only`, `--live-cap <usd>`, `--port`, `--fresh`; the home is the code's default `~/.buyer-agent-demo`), the seat line (`npm run portfolio:mcp`), `npm test`, a pointer to the design and to `face/README.md` "The Account seat". Then `cd account && npm ci`.

- [ ] **Step 6: Typecheck**

Run: `cd account && npm run typecheck`
Expected: exit 0, no output. (A missing file is a closure miss: add it to the copy, note it in the ledger.)

- [ ] **Step 7: Run the suite**

Run: `cd account && BUYER_HOME=$(mktemp -d) npm test 2>&1 | tail -8`
Expected: every kept file passes except `test/unit/ui-superagent.test.ts` (the baseline's known red, the same assertion); the file count is 164 minus the excluded files. A failure that is an `ENOENT` under `fixtures/` is a run-time fixture the closure cannot see: copy that file and re-run. Record the counts and the time in the ledger under "Baseline after the copy".

- [ ] **Step 8: Boot the service once**

Run: `cd account && npm run account -- --port 48201 --home $(mktemp -d) --read-only &` then `curl -s http://127.0.0.1:48201/api/overview | head -c 200`, then stop it.
Expected: a JSON body with `"ok":true` (the fixtures under `account/fixtures/home/portfolio` are found from `src/portfolio/service.ts`'s `ROOT`).

- [ ] **Step 9: Commit**

Two commits: `feat: account/ — the Account service copied from buyer-agent-demo at 133b9a7 with its licence` (the copy, LICENSE, NOTICE, package files, README) and `test: the import closure script and the copied suite's baseline in the ledger` (the script, the ledger).

---

### Task 2: The face finds `account/` by default

**Files:**
- Modify: `face/src/account-seat.ts` (lines 50–57: `DEFAULT_SEAT_DIR`, `seatDir()`)
- Modify: `face/tests/helpers/standin.ts` (lines 20–41)
- Modify: `face/scripts/capture-account-fixtures.ts` (the header comment, lines 14–20)
- Test: `face/tests/account-seat.test.ts`, `face/tests/standin-helper.test.ts`, `face/tests/boot.test.ts` (existing, unchanged, must stay green)

**Interfaces:**
- Consumes: `account/node_modules/tsx/dist/cli.mjs`, `account/src/portfolio/mcp.ts`, `account/test/standin/ui-standin.ts` (Task 1).
- Produces: `DEFAULT_SEAT_DIR: string` = the absolute path of the repo's `account/`, resolved from `face/src/account-seat.ts`'s own location (`join(dirname(fileURLToPath(import.meta.url)), "..", "..", "account")`, the pattern `face/src/roles.ts` uses for `ROLES_ROOT`); `seatDir()` unchanged in shape (`FACE_ACCOUNT_SEAT_DIR || DEFAULT_SEAT_DIR`); `STANDIN_DIR` in the helper = `process.env.FACE_ACCOUNT_SEAT_DIR || seatDir()`.

- [ ] **Step 1: Write the failing tests**

In `face/tests/account-seat.test.ts`:
```ts
test("the seat's default directory is the repo's account/, not a home directory", () => {
  assert.equal(DEFAULT_SEAT_DIR, resolve(fileURLToPath(new URL("../../account", import.meta.url))));
  assert.ok(!DEFAULT_SEAT_DIR.startsWith(homedir() + "/buyer-agent-demo"));
});
```
In `face/tests/standin-helper.test.ts`:
```ts
test("the stand-in's directory falls back to the face's seatDir() when FACE_ACCOUNT_SEAT_DIR is unset", () => {
  assert.equal(standinDir({}), seatDir());
  assert.equal(standinDir({ FACE_ACCOUNT_SEAT_DIR: "/tmp/x" }), "/tmp/x");
});
test("skips with the install line when the directory has no tsx", () => {
  assert.match(String(standinSkipFor({ FACE_SMOKE: "1" }, "/nonexistent/account")), /npm ci in account\//);
});
```
(`standinDir(env)` and `standinSkipFor(env, dir)` are the pure forms the helper exports beside the existing constants; `STANDIN_DIR` and `standinSkip()` call them with `process.env`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd face && npx tsx --test tests/account-seat.test.ts tests/standin-helper.test.ts`
Expected: FAIL — the default still ends in `buyer-agent-demo`; `standinDir`/`standinSkipFor` not exported.

- [ ] **Step 3: Implement**

`DEFAULT_SEAT_DIR` as the Interfaces block says; the doc comment above it names `account/` and `FACE_ACCOUNT_SEAT_DIR` as the override. In `standin.ts`: `export function standinDir(env: NodeJS.ProcessEnv): string` and `export function standinSkipFor(env: NodeJS.ProcessEnv, dir: string): string | false` with the existing checks; the "set FACE_ACCOUNT_SEAT_DIR" line becomes `"<dir>/node_modules/tsx is missing: run npm ci in account/ (or set FACE_ACCOUNT_SEAT_DIR to another checkout)"`; `STANDIN_DIR`, `STANDIN_CLI`, `STANDIN_SCRIPT`, `standinSkip()` keep their names and derive from the two. `capture-account-fixtures.ts`'s header: the env var is now optional, the default the repo's `account/`.

- [ ] **Step 4: Run the face suites**

Run: `cd face && npm test && npm run typecheck`
Expected: PASS (`boot.test.ts`'s "mounts the Account seat from FACE_ACCOUNT_SEAT_DIR" still passes: it sets the env).

- [ ] **Step 5: Run the smokes with no env but FACE_SMOKE**

Run: `cd face && FACE_SMOKE=1 npx tsx --test tests/account-seat-smoke.test.ts tests/account-graft-smoke.test.ts`
Expected: both run (not skipped) against `account/test/standin/ui-standin.ts` and PASS; the captured fixtures under `face/tests/fixtures/account/` are unchanged (`git status` shows none of them modified).

- [ ] **Step 6: Commit**

`git commit -m "feat: the face's seat row and stand-in default to the repo's account/"`

---

### Task 3: The Account's fence learns a bind address and extra hosts

**Files:**
- Modify: `account/src/portfolio/server.ts` (`PortfolioServerOptions` ~276, `agentSetupOf` ~271, the fence middleware ~447–463, `app.listen` ~1052, `origin` ~1055, the main block ~1096–1125)
- Test: `account/test/unit/server-guard.test.ts`

**Interfaces:**
- Produces: `PortfolioServerOptions.bind?: string` (default `"127.0.0.1"`) and `PortfolioServerOptions.hosts?: readonly string[]` (default `[]`); `export function parseHosts(raw: string | undefined): string[]` (split on commas, trim, drop empties, no other normalisation); the main block passes `bind: process.env.PORTFOLIO_BIND || undefined` and `hosts: parseHosts(process.env.PORTFOLIO_HOSTS)`; `agentSetupOf(origin)` is called with `http://<hosts[0]>` when `hosts` is non-empty, else the server's own origin.

- [ ] **Step 1: Write the failing tests**

Append to `describe("who the server answers")` in `server-guard.test.ts`, reusing the file's `home`, `PortfolioService.create` call and a `raw(path, headers)` helper over `node:http` (fetch may not set `Host`):
```ts
it("an extra host named in hosts is local; anything else, and any foreign origin, is not", async () => {
  const srv = await startPortfolioServer({ port: 0, service: svc, hosts: parseHosts(" account:4820 ,, http://evil:4820") });
  // Host header exactly as a compose peer sends it
  expect(await raw("/api/overview", { host: "account:4820" })).toBe(200);
  expect(await raw("/api/overview", { host: "account" })).toBe(403);
  expect(await raw("/api/overview", { host: "account:4820/" })).toBe(403);
  expect(await raw("/api/overview", { host: "evil:4820" })).toBe(403);           // the scheme-carrying entry never matches a Host
  expect(await raw("/api/overview", { host: "account:4820", origin: "https://evil.example" })).toBe(403);
  expect(await raw("/api/overview", { host: "127.0.0.1:1" })).toBe(200);         // the loopback rule still stands
});
it("parseHosts trims and drops empties", () => {
  expect(parseHosts(undefined)).toEqual([]);
  expect(parseHosts(" a:1 , ,b:2")).toEqual(["a:1", "b:2"]);
});
it("binds where told and keeps its origin on 127.0.0.1", async () => {
  const srv = await startPortfolioServer({ port: 0, service: svc, bind: "0.0.0.0" });
  expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(await raw("/api/overview", {})).toBe(200);
  expect(await raw("/api/overview", { host: "account:4820" })).toBe(403);   // no hosts given: the default refuses it
});
```
(each `it` closes its server in `finally`, as the existing one does.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd account && npx vitest run test/unit/server-guard.test.ts`
Expected: FAIL — `parseHosts` is not exported; `hosts`/`bind` are not options.

- [ ] **Step 3: Implement**

The middleware's `local` becomes `LOCAL_HOST.test(host) || hosts.includes(host)` with `hosts` from the options; `app.listen(opts.port, opts.bind ?? "127.0.0.1", …)`; `origin` stays `http://127.0.0.1:<port>`; the page's setup line uses the Interfaces block's rule. The main block reads the two env variables and passes them; nothing else in the block changes.

- [ ] **Step 4: Run the file, then the whole suite**

Run: `cd account && npx vitest run test/unit/server-guard.test.ts && BUYER_HOME=$(mktemp -d) npm test 2>&1 | tail -4 && npm run typecheck`
Expected: the file passes; the suite matches Task 1's recorded counts; typecheck clean.

- [ ] **Step 5: Commit**

`git commit -m "feat: the Account listens where PORTFOLIO_BIND says and admits the hosts PORTFOLIO_HOSTS names"`

---

### Task 4: `FACE_BIND` — the face's one widening

**Files:**
- Modify: `face/src/overlay.ts` (`faceOverlay`, the `webserver` row at ~131–132)
- Modify: `face/src/main.ts` (the boot line that prints `http://127.0.0.1:<port>/?token=…`)
- Modify: `face/README.md` ("The profile", the sentence at ~777 "loopback-only binding surviving an operator patch is the point")
- Test: `face/tests/overlay.test.ts`

**Interfaces:**
- Produces: `export function faceBind(env: NodeJS.ProcessEnv = process.env): string` in `overlay.ts` (`env.FACE_BIND || "127.0.0.1"`); `faceOverlay(port, defaultPreset, host = faceBind())` — the third parameter new, defaulted; the webserver row's `config.host` = `host`.

- [ ] **Step 1: Write the failing tests**

In `overlay.test.ts`, next to the existing line-51 assertion (which stays):
```ts
test("FACE_BIND replaces the webserver host and nothing else", () => {
  const rows = new Map(faceOverlay(3090, preset, "0.0.0.0").flatMap(e => e.insert ?? []).map(r => [r.id, r]));
  assert.deepEqual(rows.get("webserver")!.config, { host: "0.0.0.0", port: 3090, compression: "none" });
  assert.equal(faceBind({}), "127.0.0.1");
  assert.equal(faceBind({ FACE_BIND: "0.0.0.0" }), "0.0.0.0");
  assert.equal(faceBind({ FACE_BIND: "" }), "127.0.0.1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd face && npx tsx --test tests/overlay.test.ts`
Expected: FAIL — `faceBind` not exported; `faceOverlay` takes two arguments.

- [ ] **Step 3: Implement, and the boot line**

As the Interfaces block says. In `main.ts`, where the token URL is printed, append ` · listening on <bind>` only when `faceBind()` is not `127.0.0.1` (the URL printed stays `http://127.0.0.1:<port>/?token=…`: that is where the published port is). README "The profile": the sentence becomes "loopback-only binding surviving an operator patch is the point: the one way to widen it is the process environment, `FACE_BIND` (the compose file's `0.0.0.0` for the agent box, whose port is published on the host's loopback) — never a patch row".

- [ ] **Step 4: Run the face suites and see the line**

Run: `cd face && npm test && npm run typecheck`, then `cd face && FACE_BIND=0.0.0.0 timeout 60 npm start 2>&1 | grep -m1 "listening on"` (if `timeout` is absent on the Mac, run `npm start` in the background and kill it after the line).
Expected: suites PASS; the grep prints a line ending ` · listening on 0.0.0.0`.

- [ ] **Step 5: Commit**

`git commit -m "feat: FACE_BIND widens the face's webserver bind from the process environment, loopback unless set"`

---

### Task 5: The two boxes — Dockerfiles, compose, entrypoint, procedures

**Files:**
- Create: `compose.yml` (repo root), `face/Dockerfile`, `face/docker-entrypoint.sh`, `face/.dockerignore`, `account/Dockerfile`, `account/.dockerignore`
- Modify: `account/README.md` (the box run, the home, key files into the volume, the optional `cp`), `face/README.md` (new section "The two-box drill", and the compose first run under "The profile")
- Test: `face/tests/compose.test.ts` (new, offline: parses `compose.yml` with `js-yaml` and asserts the facts below)

**Interfaces:**
- Consumes: `FACE_BIND` (Task 4), `PORTFOLIO_BIND`/`PORTFOLIO_HOSTS` (Task 3), `FACE_ACCOUNT_URL`/`FACE_ACCOUNT_SEAT_DIR` (`face/src/account-seat.ts`), `BUYER_HOME` (`account/src/portfolio/home.ts`), `DSH_HOME` (`face/src/setup.ts`), `FACE_AKSHARE_MCP_COMMAND` (`face/src/akshare.ts`).
- Produces: `compose.yml` with services `agent` and `account`, network `gravit`, volumes `dsh-home`, `seat-home`, `account-home`, `face-modules`, `account-modules`.

- [ ] **Step 1: Write the failing test**

`face/tests/compose.test.ts` loads `../../compose.yml` with `js-yaml` and asserts:
```ts
assert.deepEqual(Object.keys(c.services).sort(), ["account", "agent"]);
assert.deepEqual(c.services.agent.ports, ["127.0.0.1:3090:3090"]);
assert.deepEqual(c.services.account.ports, ["127.0.0.1:4820:4820"]);
assert.equal(c.services.agent.depends_on.account.condition, "service_healthy");
assert.match(c.services.account.healthcheck.test.join(" "), /\/api\/overview/);
assert.equal(c.services.account.environment.PORTFOLIO_BIND, "0.0.0.0");
assert.equal(c.services.account.environment.PORTFOLIO_HOSTS, "account:4820");
assert.equal(c.services.agent.environment.FACE_BIND, "0.0.0.0");
assert.equal(c.services.agent.environment.FACE_ACCOUNT_URL, "http://account:4820");
assert.equal(c.services.agent.environment.BUYER_HOME, "/seat-home");
assert.equal(c.services.agent.environment.DSH_HOME, "/dsh-home");
const agentMounts = c.services.agent.volumes.map(String);
assert.ok(agentMounts.some(v => v.endsWith(":" + repoRoot)));            // the repo at its host path
assert.ok(agentMounts.every(v => !v.includes("docker.sock") && !v.includes("account-home")));
assert.ok(agentMounts.some(v => v.startsWith("face-modules:")) && agentMounts.some(v => v.startsWith("account-modules:")));
assert.deepEqual(Object.keys(c.volumes).sort(), ["account-home", "account-modules", "dsh-home", "face-modules", "seat-home"]);
```
(`repoRoot` = `resolve(fileURLToPath(new URL("../..", import.meta.url)))`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd face && npx tsx --test tests/compose.test.ts`
Expected: FAIL — `compose.yml` missing.

- [ ] **Step 3: Write the files**

`compose.yml`: the two services as the test pins; `account`: `build: ./account`, `command: ["npm", "run", "account", "--", "--home", "/data"]`, `volumes: ["account-home:/data"]`, `healthcheck` with `test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4820/api/overview').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]`, `interval: 10s`, `retries: 12`; `agent`: `build: ./face`, `working_dir: <repoRoot>/face`, `volumes: ["<repoRoot>:<repoRoot>", "dsh-home:/dsh-home", "seat-home:/seat-home", "face-modules:<repoRoot>/face/node_modules", "account-modules:<repoRoot>/account/node_modules"]`, `env_file: [{ path: .env.deepseek, required: false }]` (relative to the compose file at the repo root; absent is fine), `environment` as the test pins plus `FACE_AKSHARE_MCP_COMMAND: /usr/local/bin/akshare-mcp`; `networks: [gravit]` on both. `<repoRoot>` is written as `${PWD}` for the bind source and the literal absolute path for the target so the test's `endsWith` holds on this machine (document in a comment that another checkout path means editing that one line). `account/Dockerfile`: `FROM node:22-bookworm-slim`, `WORKDIR /app`, `COPY package.json package-lock.json ./`, `RUN npm ci`, `COPY . .`, `EXPOSE 4820`. `face/Dockerfile`: `FROM node:22-bookworm`, `uv` installed (the official standalone installer), then the README's AKShare line verbatim (`face/README.md` ~263–264: `uv tool install --python 3.12 --with 'mcp<2' 'git+https://github.com/xiaozhozho/akshare-mcp.git@9b6a22b6d83cce2a996a5072743bb06686040ce0'`) with `UV_TOOL_BIN_DIR=/usr/local/bin` so `/usr/local/bin/akshare-mcp` exists, `COPY docker-entrypoint.sh /usr/local/bin/`, `ENTRYPOINT ["docker-entrypoint.sh"]`, `CMD ["npm", "start"]`; no `COPY` of the tree, no `npm ci` at build. `face/docker-entrypoint.sh`: for each of `../face` and `../account` relative to `$PWD`, `[ -f node_modules/.package-lock.json ] || npm ci`; then `[ -d "$DSH_HOME/profiles/face" ] || npm run setup`; `exec "$@"`. `.dockerignore` files: `node_modules`, `.git`.

- [ ] **Step 4: Validate**

Run: `cd face && npx tsx --test tests/compose.test.ts && cd .. && docker compose config > /dev/null`
Expected: the test passes; `docker compose config` exits 0 (it needs the CLI, not the daemon). Then: `docker info > /dev/null 2>&1 && docker compose build` — if the daemon is up, both images build; if not, write `daemon off on <date>: build and drill not run` in the ledger and go on.

- [ ] **Step 5: The procedures**

`account/README.md` gains "In the box": `docker compose up`, the home is the volume `account-home` at `/data`, the first owner pairs with the code the box prints (`docker compose logs account`), a key-file venue's file goes into the volume with `docker compose cp <file> account:/data/<name>` and is named by that path, and the optional `docker compose cp ~/.buyer-agent-demo/. account:/data` before the first start. `face/README.md` gains "The two-box drill" with the observations from the spec §8 (the boot line `→ http://account:4820`, Venues `reachable`, the AAPL read as on 2026-10-27, `docker compose exec agent ls /data` failing, no `/var/run/docker.sock` in the agent box) and, under "The profile", how the first `up` writes the profile by itself (the entrypoint runs `npm run setup` when `dsh-home` has none) and where the operator's patch rows go (`/dsh-home/profiles/face/cordis.patch.yml`, reached with `docker compose run agent sh`); the CLI-agent tools (`claude`, `codex`) are not in the agent image, so Discover lists them unavailable there.

- [ ] **Step 6: Commit**

`git commit -m "feat: compose runs the face and the Account as two boxes, the agent box without the Account's home or a docker socket"`

---

### Task 6: The documents

**Files:**
- Modify: `CLAUDE.md` (the `face/src/account-seat.ts · account-proxy.ts` row; a new `account/` row above it; the Gotchas paragraph "The Account seat is an external install")
- Modify: `Gravit-Design.md` (§3 the ACCOUNT line; D17; D18's "an external program"; §9 one line)
- Modify: `DEVELOPMENT.md` (§3 a new 3.9 "The Account service (`account/`)"; §4.2 the `account-seat.ts` row; §4.3 `FACE_BIND` beside the webserver row; §4.6 the three variables; §7.3 the `account/` suite and `compose.test.ts`; §7.4 the two-box drill row; §9 a residual R50 "the seat's key in the agent box"; §10 the forward items for projects 2 and 3)
- Modify: `face/README.md` ("The Account seat" install: `cd account && npm ci`, no clone), `Gravit-Docs-and-Prompt-Loops.html` (its three `~/buyer-agent-demo` mentions), `ROADMAP.md` (the built-log line)
- Modify: `docs/superpowers/plans/2026-10-27-account-in-repo-ledger.md` (the final-tree lines)

**Interfaces:**
- Consumes: everything Tasks 1–5 produced; the spec's §9 lists the sentences.

- [ ] **Step 1: The charter and CLAUDE.md**

§3 ACCOUNT: "Linqi's buyer-agent-demo, an external program on this machine" → "the Account service in this tree (`account/`, copied from Linqi's buyer-agent-demo @ 133b9a7 on 2026-10-27), run as its own process — and, under `docker compose`, as its own box". D17's fence sentence gains: "under compose the Account's home is a volume the agent box does not mount; the seat's own key stays with the seat in the agent box, and the Account's card on every seat write stands against a shell that signs with it". D18: "an external program" → "the Account service". CLAUDE.md: the row as the spec §9 says, plus a Map row `| \`account/\` | the Account service … |` naming its scripts, the two env variables and `compose.yml`; the Gotchas paragraph rewritten: `cd account && npm ci`, `npm run account` on the default home, the two boxes optional.

- [ ] **Step 2: DEVELOPMENT.md, the README, the loops page, the roadmap**

Each section named in Files, in the document's own voice (present tense, the symbol not the line). The §7.4 row for the two-box drill records "not yet run" or the run's date. The loops page's three mentions name `account/` (the seat's command line changes from the checkout's path to the repo's).

- [ ] **Step 3: Check the tree's words**

Run: `grep -rnE "buyer-agent-demo|external program" CLAUDE.md Gravit-Design.md DEVELOPMENT.md face/README.md ROADMAP.md GRAVIT.md Gravit-Docs-and-Prompt-Loops.html | grep -vE "133b9a7|2026-10-2[0-7]|NOTICE|copied from|origin"`
Expected: no line left that presents the Account as an install outside the tree (dated history lines and the origin attribution remain). Then `cd face && npm test && npm run typecheck` (the GRAVIT.md size test among them).

- [ ] **Step 4: Commit and close the ledger**

`git commit -m "docs: the Account service in this tree through the charter, CLAUDE.md, DEVELOPMENT.md, the README, the loops page and the roadmap"`. The ledger's last section lists: the final tree (`git ls-files account | wc -l`, the suite counts of both packages), the deferred minors, and the hand-over items for the operator — restart the host service on the default home (the one on `~/.openpaper` is not the Account); update `.claude/launch.json`'s `account` entry to `cd …/account && npm run account`; run the two-box drill when Docker Desktop is up; the `mcp-alpaca-kit` row in the live patch (unrelated, still theirs).
