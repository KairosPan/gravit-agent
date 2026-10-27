# The Account's service in this tree — ledger

- Plan: `docs/superpowers/plans/2026-10-27-account-in-repo.md`
- Spec: `docs/superpowers/specs/2026-10-27-account-in-repo-design.md` (its Status line still reads DRAFT;
  the session that started this build reports the operator approved it on 2026-10-27, and the build
  stands on that word)
- Branch: `claude/account-in-repo-415034` (the app named the worktree's branch; the plan's
  `feat/account-in-repo` is not used), from local `main` @ f36c78c, in the worktree
  `.claude/worktrees/account-in-repo-415034`
- Origin: `~/buyer-agent-demo` @ 133b9a7, read-only
- Baseline (spec §8, the origin checkout, 2026-10-27): 164 files, 163 passed, 1 failed
  (`test/unit/ui-superagent.test.ts`); 2,883 tests, 2,882 passed; 144 s wall
- Execution: superpowers:subagent-driven-development — per task a fresh implementer and a fresh
  reviewer on the session's model (opus); the final whole-branch review on `fable`

## Pre-flight scan (controller, 2026-10-27, before Task 1)

Measured on the origin before ruling: `src/portfolio` holds 157 files (54 under `public/`, every
other file `.ts`); `src/core` 8, `src/agent` 10, `src/contract` 4; no file of the four imports a
dropped directory (`src/{runner,control-room,venues,wallet,plugins}`); `test/` holds 169 files, 164
of them `*.test.ts`. Run-time reach the import closure cannot see: `test/e2e.test.ts` spawns
`src/runner/run-demo.ts`; `test/portfolio-demo.test.ts` spawns `src/portfolio/demo.ts` (no entry
imports it); `test/account-demo.test.ts` spawns `src/portfolio/account-demo.ts`;
`test/unit/site-numbers.test.ts` imports `scripts/site-numbers.ts` and reads `site/index.html`;
`test/unit/review2-contracts.test.ts` reads `README.md` and `COOKBOOK.md` at module scope and
`docs/account.md` in two tests; `test/unit/mode-rules.test.ts` reads `README.md` and `COOKBOOK.md`
in one test. The seat's child env is the face's scrubbed parent env plus the row's own
(`@deepseek-ai/dsh-mcp-client` `buildChildEnv`), so `BUYER_HOME` set on the agent box reaches the
seat. On this Mac the operator's face holds 127.0.0.1:3090 and the Account 127.0.0.1:4820; the
suite's simulator ports (4701–4705, 4800) are free; Docker Compose v5.1.4 CLI present, daemon off.

### Pairs of tasks sharing a file or an interface

| Tasks | Produced → consumed | Found |
|---|---|---|
| 1 → 2 | `account/node_modules/tsx/dist/cli.mjs`, `account/src/portfolio/mcp.ts`, `account/test/standin/ui-standin.ts` → the seat row's default and the stand-in helper | agree; `node_modules` is ignored, so the smokes need Task 1's `npm ci` in this worktree (present) |
| 1 → 3 | the copied `server.ts`, `server-guard.test.ts`, the suite's counts → Task 3's edit and its "matches Task 1's recorded counts" gate | Task 3 adds tests, so the count cannot match literally — **R5** |
| 1 → 5 | `account/package.json` → `account/Dockerfile`'s `COPY package.json package-lock.json` + `npm ci` | Task 1's file list has no `account/package-lock.json` — **R4** |
| 1 → 5 | `account/README.md` (Task 1 writes, Task 5 extends "In the box") | agree |
| 2 → 5 | `DEFAULT_SEAT_DIR` resolved from `face/src` → the box finds `account/` through the bind mount, no `FACE_ACCOUNT_SEAT_DIR` in compose | agree |
| 3 → 5 | `PORTFOLIO_BIND`, `PORTFOLIO_HOSTS` → the `account` service's environment | agree; `agentSetupOf` prints `http://account:4820` in the box |
| 4 → 5 | `FACE_BIND` → the `agent` service's environment | agree |
| 4 → 5 → 6 | `face/README.md`: "The profile" sentence (4), "The two-box drill" + the compose first run (5), "The Account seat" install (6) | sequential edits of different sections; agree |
| 3, 4 → 6 | the three variables → DEVELOPMENT §4.3/§4.6, CLAUDE.md's `account/` row | agree |
| 1–5 → 6 | the final tree, both suites' counts → the ledger's close | agree |

### Each task against itself

| Task | Found |
|---|---|
| 1 | Step 3 expects stderr to name `test/e2e.test.ts` reaching `src/runner`, but Step 2's rules follow imports only and that test reaches `src/runner` by `spawn` — **R2**. Step 4 copies the closure plus `public/`, while the spec §4 brings all of `src/portfolio/` (157 files) and `test/portfolio-demo.test.ts` spawns `src/portfolio/demo.ts`, which no entry imports — **R1**. Step 2's dropped set lacks `scripts/`, which the spec keeps out and `test/unit/site-numbers.test.ts` imports — **R3**. Step 7's ENOENT rule covers `fixtures/` only, not the docs two kept tests read — **R2**. Step 5 runs `npm ci` with no lock file in the file list — **R4**. Step 8's `--home $(mktemp -d)` is a check, not a run line of the tree: agrees with the home constraint |
| 2 | tests and code agree (`join(dirname(…src…), "..", "..", "account")` equals `resolve(…tests…/../../account)`); the module header of `face/src/account-seat.ts`, the header of `face/src/account-proxy.ts` and the two smokes' headers still present the Account as an install at `~/buyer-agent-demo`, which Step 3 does not name — **R6** |
| 3 | agrees with itself; the new tests need their own `PortfolioService.create` (the existing one is inside its `it`); the plan's test binds `0.0.0.0` for one port-0 server on a scratch home — kept |
| 4 | the test's `preset` is the file's `GRAVIT` — trivial; Step 4 starts `npm start` with `FACE_BIND=0.0.0.0` on the operator's Mac, where the operator's face holds 3090 and the live `~/.dsh` and the live Account would be the defaults — **R7** |
| 5 | the bind target and `working_dir` as a literal absolute path make `compose.test.ts` pass in one checkout only (this worktree's path is not the primary checkout's, and the suite runs in both) — **R8**; `docker compose config` prints `env_file` values resolved — only ever `> /dev/null`; the drill publishes 3090 and 4820, which the host dev loop holds — the README says to stop the host pair first (R8) |
| 6 | agrees with itself; the spec's Status line ("DRAFT … nothing built") is stale once built — **R9** |

### Rulings

- **R1** Ruling: every `src/portfolio/**/*.ts` is a closure entry beside the plan's six, so
  `src/portfolio/` comes whole as the spec §4 table says (157 files with `public/`), the script's
  exit-2 rule checks the spec's claim that none of it reaches a dropped directory, and
  `test/portfolio-demo.test.ts` finds `src/portfolio/demo.ts`; Step 4's count check becomes: `find
  account/src -type f | wc -l` = 157 + the `core`/`agent`/`contract` files the closure lists — the
  spec is the authority over the plan's closure-only copy — if wrong, a few unreached portfolio
  modules sit in the tree unused (removable by a later trim).
- **R2** Ruling: a copied test file is byte-identical to the origin or left out whole, never edited
  in Task 1; left out besides `test/unit/wallet.test.ts` (imports `src/wallet`) are the files whose
  run reaches what the spec keeps out: `test/e2e.test.ts` (spawns `src/runner/run-demo.ts`),
  `test/unit/site-numbers.test.ts` (imports `scripts/`, reads `site/`),
  `test/unit/review2-contracts.test.ts` (reads `README.md`, `COOKBOOK.md`, `docs/account.md`) and
  `test/unit/mode-rules.test.ts` (reads `README.md`, `COOKBOOK.md`); a run-time reach found by the
  Step 7 run or a grep is handled the same way (ENOENT under `fixtures/` or `manifests/` brings the
  file along, as the plan says; anything else leaves the test file out), each named in this ledger
  with the path it reaches — the spec §10 leaves the test selection to the builder, and whole-file
  selection keeps a later by-hand diff against 133b9a7 clean — if wrong, the code-only checks
  inside the two doc-reading files (about nine in `review2-contracts`, three in `mode-rules`) are
  missing from `account/`'s suite until those files are trimmed of their doc assertions and
  restored.
- **R3** Ruling: the closure script's dropped set is `src/runner`, `src/control-room`, `src/venues`,
  `src/wallet`, `src/plugins` and the origin's top-level `scripts`, `site`, `docs`, `examples` (the
  spec §4 keeps `scripts/` and `docs/` out and brings neither `site/` nor `examples/`) — a `src/`
  entry reaching one is still an error, a `test/` entry reaching one is excluded — if wrong, a test
  of a demo script is lost that nothing in the service needs.
- **R4** Ruling: Task 1 copies the origin's `package-lock.json` to `account/package-lock.json` and
  brings its root entry (`packages[""]`: name, version, engines) in line with the new
  `package.json` without moving any resolved version; `npm ci` in `account/` must pass on it, and
  it is committed with the copy (Task 5's `account/Dockerfile` copies it) — the plan's file list
  omits a file its own Steps 5 and Task 5 need — if wrong, one regenerated lock file.
- **R5** Ruling: Task 3's "the suite matches Task 1's recorded counts" means the same files pass and
  the same one fails (`ui-superagent`), and the test count is Task 1's plus the tests Task 3 adds —
  a literal match is impossible once tests are added — if wrong, nothing: it is the plan's evident
  intent.
- **R6** Ruling: Task 2 also rewrites the comments in `face/src/account-seat.ts` (module header),
  `face/src/account-proxy.ts` (header) and the headers of `account-seat-smoke.test.ts` and
  `account-graft-smoke.test.ts` that present the Account as an external install at
  `~/buyer-agent-demo`, so they name the repo's `account/` (attribution lines such as "read at
  buyer-agent-demo @ 133b9a7" stay) — CLAUDE.md is descriptive of the tree and these comments would
  be false after the default moves — if wrong, a few comment lines to revert.
- **R7** Ruling: Task 4's boot-line check runs on a scratch `DSH_HOME` (`npm run setup` into it
  first), a free `FACE_PORT`, `FACE_ACCOUNT_SEAT_DIR=/nonexistent` and
  `FACE_ACCOUNT_URL=http://127.0.0.1:9`, and with a loopback `FACE_BIND` other than `127.0.0.1`
  (`::1`, or `localhost` if the webserver row refuses `::1`) instead of `0.0.0.0`; the expected
  line ends ` · listening on <that value>` — the plan's command would collide with the operator's
  face on 3090, rewrite the live `~/.dsh` profile's `cordis.yml`, reach the live Account and open a
  listener to the LAN; `overlay.test.ts` still pins `0.0.0.0` in the row — if wrong, the line is
  seen for a loopback value rather than for `0.0.0.0`.
- **R8** Ruling: `compose.yml` mounts the repo as `.:${PWD}` (the source is the compose file's own
  directory, so always the repo root; the target is the shell's `PWD`, the repo's own host path
  when `docker compose` runs at the root, which `account/README.md` and the drill say to do) and
  writes every other container path of the repo from `${PWD}` (`working_dir: ${PWD}/face`,
  `face-modules:${PWD}/face/node_modules`, `account-modules:${PWD}/account/node_modules`), so the
  box is consistent from any directory and the spec's same-absolute-path holds at the root;
  `compose.test.ts` asserts those raw strings instead of `endsWith(":" + repoRoot)`; the drill
  says to stop the host face and Account first (both ports are published on the host's loopback)
  and never to paste `docker compose config` output (it prints `env_file` values) — a literal
  path makes the face suite red in one of the two checkouts it runs in — if wrong, a run from
  another directory mounts the repo at that directory's path (still consistent inside the box).
- **R9** Ruling: Task 6 sets the spec's Status line to "approved by the operator on 2026-10-27;
  built on `claude/account-in-repo-415034`" with the plan and this ledger named — the line would
  otherwise say "nothing built" of a built design — if wrong, one line to revert.

## Tasks

### The face before any change (this worktree @ f36c78c, `npm ci` in `face/`)

`npm test`: 1,649 tests, 1,626 pass, 0 fail, 23 skipped, 10.4 s. `npm run typecheck`: clean.
`FACE_SMOKE=1 npm test`: 1,649 tests, 1,647 pass, 0 fail, 2 skipped — `account-seat-smoke` and
`account-graft-smoke`, "set FACE_ACCOUNT_SEAT_DIR" — 18.0 s.

### Task 1

**Closure.** `node account/scripts/import-closure.mjs ~/buyer-agent-demo --copy account <entries>`,
268 entries after de-duplication, in this order: the plan's six (`src/portfolio/{server,mcp,
account-demo,account-service,account-check}.ts`, `test/standin/ui-standin.ts`), every
`src/portfolio/**/*.ts` (103, R1), every `test/**/*.test.ts` but the four R2 hand exclusions (160),
the five non-test helpers (`test/attack/account-runs.ts`, `test/standin/{model,ui-standin,
venues}.ts`, `test/unit/live-public-markets-fixtures.ts` — the last one the plan's list misses).
Exit 0; stdout 279 paths (103 `src/portfolio`, 5 `src/core`, 3 `src/agent`, 4 `src/contract`,
164 `test/`); no `src/` entry errors; stderr, verbatim:

    excluded test/unit/wallet.test.ts: test/unit/wallet.test.ts imports "../../src/wallet/catalog.ts" (src/wallet)

`test/account-demo.test.ts` and `test/portfolio-demo.test.ts` reach `src/runner` by no import and
spawn only `src/portfolio/*`, so both are kept; `test/e2e.test.ts` reaches it by `spawn` (R2).

**Left out** (six of the origin's 164 test files; none edited, every kept file byte-identical):
- `test/unit/wallet.test.ts` — imports `src/wallet/catalog.ts` (the script)
- `test/e2e.test.ts` — spawns `src/runner/run-demo.ts` (R2)
- `test/unit/site-numbers.test.ts` — imports `scripts/site-numbers.ts`, reads `site/index.html` (R2)
- `test/unit/review2-contracts.test.ts` — reads `README.md`, `COOKBOOK.md`, `docs/account.md` (R2)
- `test/unit/mode-rules.test.ts` — reads `README.md`, `COOKBOOK.md` (R2)
- `test/unit/env-scrub.test.ts` — "the host never imports the identity resolver" walks
  `src/agent` and `src/runner` (`readdirSync`), ENOENT `account/src/runner` in the first Step 7 run;
  found by the run, not by the pre-flight scan

A grep of the kept tests for `runner`, `control-room`, `venues`, `wallet`, `plugins`, `scripts`,
`site`, `docs`, `examples`, `README.md`, `COOKBOOK.md` as paths finds nothing else (only venue ids).

**Brought along at run time:** none (no ENOENT under `fixtures/` or `manifests/`).

**Baseline after the copy** (`BUYER_HOME=$(mktemp -d) caffeinate -i npm test` in `account/`): 158
files, 157 passed, 1 failed; 2,837 tests, 2,836 passed, 1 failed — the known red,
`test/unit/ui-superagent.test.ts` "mounts the floor once…", the `data-sg-clock` `\d\d:\d\d:\d\d`
match against `322:02:56`; 160.7 s vitest, 161 s wall. Against the origin's 164 / 2,883: six files
and 46 tests left out. `npm run typecheck`: exit 0, no output — no closure miss.

**Boot** (`npm run account -- --port 48201 --home $(mktemp -d) --read-only`, stopped after): the
server prints `read-only: nothing is traded or moved…`; `GET /api/overview` 200, first 200 bytes:

    {"now":"2026-10-27T23:08:26.533Z","live":false,"mode":"guard","session":{"expiresAt":"2026-11-26T23:08:26.369Z","expired":false},"portfolio":{"totalUsd":0,"byClass":[],"byAccount":[]},"liquidity":{"mo

The plan's `"ok":true` is not in that route's body at 133b9a7 (`server.ts` `/api/overview` spreads
the overview, no `ok`); `/api/now` and `/api/account` answer `{"ok":true,…` on the same boot, and the
home gets `portfolio/ledger-….jsonl` + `networth.jsonl`.

**Count:** `find account/src -type f | wc -l` = 169 = R1's 157 + the closure's 12 core/agent/contract
files. `account/src/{runner,control-room,venues,wallet,plugins}` absent.

**Lock (R4):** `diff ~/buyer-agent-demo/package-lock.json account/package-lock.json` — three lines,
top-level `name`, `packages[""].name`, `packages[""].engines.node`; no resolved version moved
(`version` is 0.1.0 in both). `npm ci` in `account/` passes on it.

**Licence:** `account/LICENSE` fetched from the origin's `main`, 202 lines, sha256 `cfc7749b…3d30`
(the stock Apache-2.0 text); the file's first line is blank, so `Apache License` is line 2 and
`Version 2.0, January 2004` line 3 — the plan's "second non-blank line" reads as "second line".

**Face gate** before each commit: 1,649 tests, 1,626 pass, 23 skipped; typecheck clean.

**Deferred:** the code-only checks inside `env-scrub.test.ts` (three of its four `it`s scrub env
without touching `src/runner`) are out with the file, as R2 says of the doc-reading pair.

### Task 1 — review (controller)

- R10 Ruling: Step 8's expected `"ok":true` does not hold for `GET /api/overview` at 133b9a7 (the route spreads the overview without `ok`; `/api/now` and `/api/account` carry it); a 200 JSON body from `/api/overview` is the boot check, and Task 5's health check keys on the HTTP status (`r.ok`), not the body — the plan misread the route — if wrong, nothing: the route answers as on the host.
- Task 1: complete (commits f36c78c..f74c0ee, review clean — spec ✅, quality approved; byte-identity of all 341 copied files checked, lock differs only in its root name and engines).
- Task 1: minor (deferred): `account/src/contract/env-scrub.ts` is an orphan — reached only by the left-out `test/unit/env-scrub.test.ts`; the closure without it is 277 paths and 168 files under `account/src`, not 279 and 169.
- Task 1: minor (deferred): `account/NOTICE` line 2 says the core/agent/contract files are those `src/portfolio/` imports; most are reached only from the kept tests ("that the copied source and tests import").
- Task 1: minor (deferred): `import-closure.mjs` names the first dropped reach in its depth-first stack order, not source order, and without a line number.
- Task 1: minor (deferred): `import-closure.mjs` scans raw text, so commented-out imports are followed too (fails safe: a missing target exits 2); worth a comment.

### Task 2

**RED:** `cd face && npx tsx --test tests/account-seat.test.ts tests/standin-helper.test.ts` — 3
tests, 1 pass, 2 fail: `DEFAULT_SEAT_DIR` was `/Users/pan/buyer-agent-demo`, not the worktree's
`account/`; `standin-helper.test.ts` failed to load (`./helpers/standin.ts` does not provide an
export named `standinDir`).

**GREEN:** the same command — 6 tests, 6 pass. `DEFAULT_SEAT_DIR` = `join(dirname(fileURLToPath(
import.meta.url)), "..", "..", "account")`; the helper exports `standinDir(env)` and
`standinSkipFor(env, dir)`, and `STANDIN_DIR`/`standinSkip()` derive from them. R6's comments
rewritten (seat and proxy headers, both smoke headers) plus the capture script's header; the
`~/.buyer-agent-demo` mentions (the Account's home, not its install) stay.

**Face gate:** `npm test` = 1,652 tests, 1,629 pass, 23 skipped, 0 fail (1,649 + the 3 new);
typecheck clean.

**Smokes:** with `FACE_ACCOUNT_SEAT_DIR` unset, `FACE_SMOKE=1 npx tsx --test
tests/account-seat-smoke.test.ts tests/account-graft-smoke.test.ts` = 2 pass, 0 skipped (they run
from the in-tree `account/`); the full `FACE_SMOKE=1 caffeinate -i npm test` = 1,652 tests, 1,652
pass, 0 skipped, 0 fail (Task 1's two skips now run). `git status` shows nothing under
`face/tests/fixtures/account/` modified.

### Task 2 — review (controller)

- Task 2: complete (commits f74c0ee..772fca1, review clean — spec ✅, quality approved).
- Task 2: minor (deferred, carried to Task 6's sweep): `face/scripts/capture-account-fixtures.ts` ~182–183, the run-time error still says "run npm ci in the checkout" / "(FACE_ACCOUNT_SEAT_DIR names the checkout)".
- Task 2: minor (deferred, carried to Task 6's sweep): `face/tests/boot.test.ts` ~212–217, the comment above "mounts the Account seat from FACE_ACCOUNT_SEAT_DIR" still says the checkout the operator installs.
- Task 2: minor (deferred): `standinDir(env)` falls back to `seatDir()`, which reads `process.env`, so `standinDir({}) === seatDir()` holds under any environment and pins less than it reads (the brief's interface says `|| seatDir()`).
- Task 2: minor (deferred): the tsx-missing line advises `npm ci in account/` even when `FACE_ACCOUNT_SEAT_DIR` names another install (brief's text verbatim; the `${dir}` prefix disambiguates).
- Task 2: minor (deferred): `capture-account-fixtures.ts` 15–16, the new header lines are not reflowed to the block's width.

### Task 3

**RED:** `cd account && npx vitest run test/unit/server-guard.test.ts` — 4 tests, 2 pass, 2 fail:
`parseHosts is not a function` (the hosts test and the parseHosts test). The bind test passed
vacuously: before the change `bind` was ignored and the server listened on 127.0.0.1 anyway, which
is all a port-0 test can observe (`srv.url`, a loopback request, `account:4820` refused).

**GREEN:** the same command — 4 tests, 4 pass. `LOCAL_HOST` hoisted from the inline regex;
`local = LOCAL_HOST.test(host) || hosts.includes(host)`; `app.listen(opts.port, opts.bind ??
"127.0.0.1", …)`; `origin` unchanged; `/api/account`'s `agentSetup` uses `http://<hosts[0]>` when
`hosts` is non-empty (asserted in both new server tests, no extra `it`); the main block passes
`bind: process.env.PORTFOLIO_BIND || undefined, hosts: parseHosts(process.env.PORTFOLIO_HOSTS)`.
The file's `raw` helper is hoisted to module scope as `rawOf(base)`, the `PortfolioService.create`
call as `service()`.

**Account suite:** `BUYER_HOME=$(mktemp -d) caffeinate -i npm test` = 158 files, 157 pass, 1 fail
(`test/unit/ui-superagent.test.ts`, the known red); 2,840 tests, 2,839 pass (2,837 + the 3 new);
142.8 s. `npm run typecheck` clean.

**Face gate:** `npm test` = 1,652 tests, 1,629 pass, 23 skipped, 0 fail; typecheck clean.

### Security note on Task 3 (controller)

- R11 Ruling: an automated security review flagged the `Host`-header fence as spoofable once `PORTFOLIO_BIND` is non-loopback (a peer that can reach the port can send `Host: 127.0.0.1`). The code stands as the spec §6 designs it: the `Host` rule was never authentication (it is the DNS-rebinding defence; writes are authorised by the owner's signed envelope and the seat's key at the door, unchanged), and in the compose topology the only peers that reach 0.0.0.0:4820 are the agent box on the private `gravit` network and the host's loopback (the port is published on 127.0.0.1 only). The residual is real on a misconfiguration — `PORTFOLIO_BIND=0.0.0.0` on the host Mac would admit any LAN peer that forges `Host` to every read and to the unauthenticated routes — so Task 5 says in `account/README.md` that `PORTFOLIO_BIND` is for the box only, and Task 6 records it in DEVELOPMENT §9 beside the seat's-key residual; a peer-address check or a shared token for non-loopback peers is a forward item, not built here (it would change the door's admission, which this project keeps as is) — if wrong, the hardening is one middleware condition on `req.socket.remoteAddress`, later.

### Task 3 — review (controller)

- Task 3: complete (commits 772fca1..46eb7d0, review clean — spec ✅, quality approved).
- Task 3: minor (deferred): the "binds where told" test cannot fail — under port 0 nothing observable separates `0.0.0.0` from `127.0.0.1`; exposing the bound address on the handle would make it bite (the compose health check exercises the real bind).
- Task 3: minor (deferred, carried to Task 5's README): `hosts.includes(host)` is case-sensitive while `LOCAL_HOST` is `/i` — exact per the spec; the README row says entries are exact, lowercase as compose sends them.
- Task 3: minor (deferred, carried to Task 5's README): under an admitted extra host the host-derived URLs (`/api/account/wallet/challenge`, `/api/account/signin/start`) are built on `account:4820`; only a compose peer sends that host, never the owner's browser.
- Task 3: minor (deferred): a programmatic `hosts: [""]` would admit a request with no `Host`; `parseHosts` drops empties, so the env path cannot.

### Task 4

- RED: `cd face && npx tsx --test tests/overlay.test.ts` = 1 test, 0 pass, 1 fail ("does not provide an export named 'faceBind'"). GREEN: 10 tests, 10 pass.
- `faceBind(env)` = `env.FACE_BIND || "127.0.0.1"`; `faceOverlay(port, preset, host = faceBind())`; the webserver row's `host` is cast to the row's `"127.0.0.1" | "0.0.0.0"` union, checked by the row's schema at boot. `main.ts` keeps the URL on `127.0.0.1` and appends ` · listening on <bind>` when the bind is widened. README "The profile" sentence as the brief words it.
- R7 boot check (scratch `DSH_HOME`, `FACE_PORT=3197`, `FACE_ACCOUNT_SEAT_DIR=/nonexistent`, `FACE_ACCOUNT_URL=http://127.0.0.1:9`): `FACE_BIND=::1` and `FACE_BIND=localhost` both fail the boot loud, `webserver (required) … $.host expected "127.0.0.1" | "0.0.0.0" but got "::1"` (resp. `"localhost"`) — the row admits only the two literals, so no loopback value other than `127.0.0.1` exists and the suffixed line was not seen live (`0.0.0.0` withheld per R7). Unset: `gravit-face: http://127.0.0.1:3197/?token=… (profile: face)`, no suffix. Every process stopped, nothing left on 3197.
- Face gate: `npm test` = 1,653 tests, 1,630 pass, 23 skipped, 0 fail; `FACE_SMOKE=1` = 1,653/1,653 pass; typecheck clean.

- R12 Ruling: the webserver row's schema takes only `"127.0.0.1" | "0.0.0.0"` for `host`, so R7's loopback alternatives (`::1`, `localhost`) stop the boot and the ` · listening on 0.0.0.0` line is not seen live on this Mac; it is left to the two-box drill (the box sets `0.0.0.0`), and the unset case was seen unchanged — a `0.0.0.0` listener on the operator's Mac is not opened for a print check — if wrong, the suffix is first seen in the drill instead of here.
- R13 Ruling: an automated review of a3bdc93 flagged the same shape on the face: with `FACE_BIND=0.0.0.0` the `/data` routes' Host-based fence (`isTrustedDataRequest`) can be forged by any peer that reaches the port. The code stands as the spec §5 designs it (`/api` still needs the token cookie; inside compose the only peer on the `gravit` network is the account box, and 3090 is published on the host's loopback only); the misconfiguration residual (`FACE_BIND=0.0.0.0` on the host Mac exposes `/data` to the LAN with a forged `Host`) goes into the README sentence Task 5 writes ("for the box only") and DEVELOPMENT §9 with R11's in Task 6; a cookie gate on `/data` when the bind is widened is a forward item — if wrong, one condition in the `/data` fence, later.

### Task 4 — review (controller)

- Task 4: complete (commits 46eb7d0..a3bdc93, review clean — spec ✅, quality approved).
- Task 4: minor (deferred): `face/src/main.ts` reads `FACE_BIND` a second time through `faceBind()`; spec §5 says the overlay row is its only reader — the boot line could print `booted.ctx.webServer.host` instead (the brief asked for `faceBind()` there).
- Task 4: minor (deferred): the boot line's suffix logic has no test (top-level script code); a pure line-builder with two asserts would cover what R12 leaves to the drill.
- Task 4: minor (deferred): `face/README.md` ~785, a rewrapped line runs to 128 columns.
- Task 4: minor (deferred): `faceBind` returns `string` where the schema takes two values (the brief's interface; the boot fails loudly on anything else).

### Task 5

- RED: `cd face && npx tsx --test tests/compose.test.ts` = 1 test, 0 pass, 1 fail (ENOENT, `compose.yml` missing). GREEN: 1 test, 1 pass.
- Files: `compose.yml` (root), `face/Dockerfile`, `face/docker-entrypoint.sh` (mode 755, POSIX sh, `sh -n` clean), `face/.dockerignore`, `account/Dockerfile`, `account/.dockerignore`, `face/tests/compose.test.ts`; `account/README.md` "In the box"; `face/README.md` the agent box under "The profile" and "The two-box drill".
- R8 applied: the repo mounts as `.:${PWD}`, `working_dir: ${PWD}/face`, the module volumes at `${PWD}/face/node_modules` and `${PWD}/account/node_modules`; the test asserts those raw strings in place of the brief's `endsWith(":" + repoRoot)`, every other assertion as the brief writes it.
- `docker compose config > /dev/null` at the repo root: exit 0 (output never printed).
- daemon off on 2026-10-27: build and drill not run (`docker info` exit 1).
- Face gate: `npm test` = 1,654 tests, 1,631 pass, 23 skipped, 0 fail; typecheck clean; `FACE_SMOKE=1` = 1,654/1,654 pass.

### Security findings on Task 5 (controller)

- R14 Ruling: an automated review of 565d8c3 flagged that `.:${PWD}` hands the agent box the whole working tree. Confirmed and load-bearing: the primary checkout's root holds `.env.alpaca` (a venue's keys) and `.env.deepseek`, which the spec §3 anti-goal names ("an env file with the venue keys handed to the face"), and `account/` (the Account box's build context and the seat's code) would be writable from Gravit's shell, so a later `docker compose build` could bake an agent's edit into the money box. Fixed in Task 5's fix round 1: the agent mounts an allowlist instead of the root — read-write `face/`, `strategies/`, `bots/`, `roles/`; read-only `account/` (its `node_modules` stays the writable `account-modules` volume), `dsh/`, `docs/`, and the tracked root documents (`GRAVIT.md`, `CLAUDE.md`, `AGENTS.md`, `Gravit-Design.md`, `DEVELOPMENT.md`, `ROADMAP.md`), each at `${PWD}/<name>`; nothing at the root of the box but those, so no `.env*`, no `compose.yml`; `GRAVIT.local.md` (untracked, optional) is not in the box, said in the drill. `compose.test.ts` asserts no root mount, no `.env` path, `account` read-only. The `env_file`'s `DEEPSEEK_API_KEY` stays in the face's process env: dsh's `scrubbedParentEnv` drops `KEY|PASSWORD|SECRET|TOKEN` names from every child it spawns, so the shell never inherits it — recorded, not changed. — the spec's "the repo bind-mounted" is narrowed to the paths the face and Gravit use, the anti-goal outranks it — if wrong, a path Gravit needs in the box is missing (one line to add).

### Task 5 — review (controller)

- Task 5: review 1 — Needs fixes: Important `.env.*` and a writable `account/` through the root bind (R14), Important the README's `docker compose cp` before any container exists; fix round 1 sent with both plus four cheap drill lines (stale module volumes after a lock change, macOS Desktop access, `exec` not `run`, the seat box on an empty `seat-home`) and two test asserts (`env_file`, `FACE_AKSHARE_MCP_COMMAND`).
- Task 5: minor (deferred): `face/Dockerfile` pulls the latest uv installer, unpinned.
- Task 5: minor (deferred): the agent container runs as root — Gravit's writes land root-owned on a Linux host (Docker Desktop for Mac maps them to the host user).
- Task 5: minor (deferred): `account/Dockerfile` has no `CMD` (compose supplies it; a bare `docker run` drops into the node REPL).

### Task 5 — fix round 1

- R14 applied: the agent mounts the allowlist (rw `face`, `strategies`, `bots`, `roles`; ro `account`, `dsh`, `docs`, the six root documents), no root bind; `account-modules` stays over `account/node_modules`. Seat writes checked: `src/portfolio` has no `process.cwd()` and its writes (`keystore.ts`, `desk.ts`) resolve under `defaultHome()` (`BUYER_HOME` = `/seat-home`); tsx caches under the OS temp dir. Nothing at run time writes under `account/` but `node_modules`.
- R15 Ruling: an allowlist without `.git` makes dsh's agent-instructions row (`findProjectRoot`, default marker `.git`, "the discovered project root, or `cwd` when no marker exists") take the session's cwd as root, so the root `GRAVIT.md` would not reach a session in `strategies/<name>`. The agent box gets an empty read-only tmpfs at `${PWD}/.git` as the marker — no history, no git config (a remote URL with a token) in the box; asserted in `compose.test.ts` — if wrong, `git` in the box errors on an empty `.git` (it never had a usable one).
- Gates: `compose.test.ts` 1/1; face `npm test` 1,654 tests, 1,631 pass, 23 skipped, 0 fail; typecheck clean; `FACE_SMOKE=1` 1,654/1,654; `docker compose config -q` exit 0. Daemon still off: no build.
