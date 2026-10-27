# The Account's service in this tree — Design (one repo, two boxes)

Written 2026-10-27 against main @ 92c5a0c and Linqi's buyer-agent-demo @ 133b9a7 (the checkout
installed at `~/buyer-agent-demo`). Project 1 of three (§2). Status: approved by the operator on
2026-10-27; built on `claude/account-in-repo-415034` (plan `docs/superpowers/plans/2026-10-27-account-in-repo.md`, ledger beside it).

## 1. Intent — the operator's words

On 2026-10-27, after a seat read drill had proved that Gravit reaches a US quote only by walking out
to an external program, the operator said what they want: **"我要的是统一起来，包括后端也放进这个 git 仓库"**
— unify, the back end included, in this repository. Two reasons, in their words:

- **防钥匙.** The agent and the money live in different boxes at run time: "我这里是 agent，linqi 那边
  是交易所，那么我是不是应该有两个 docker 隔离开". Asked whether this is to keep Gravit's shell away
  from the exchange side's keys rather than to move the exchange to another machine: "对，防钥匙".
- **主动权.** "我们可以掌握交易所这个数据提供和钱包提供的主动权": the market data and the wallet
  provision become this tree's to evolve, instead of a moving target in someone else's repository.

Two further rulings on the same day: Linqi's future development is not designed around ("先不管他吧":
the code comes in as a copy and is maintained here; no sync mechanism is a requirement), and the
A-share data moves into the Account box now, not later ("现在搬过去" — that is project 2, §2).

This reverses one non-goal of the 2026-10-22 graft design ("vendoring the Account's page or modules,
pinning a commit, a submodule"), by the operator's word. The reasons that design gave — a second
product inside the first, 26 pull requests in twelve days — were reasons not to *track* Linqi's
repository; they do not apply to *owning* a copy, which is what is wanted now. What that design built
stays as it is: the face's screens fed by the Account's routes through a loopback proxy, the face's
page as an owner device, Gravit's seat as the agent's only order path, Gate 2 on every seat write.

## 2. Three projects, in order

| # | Project | This document |
|---|---|---|
| 1 | **The Account's service in this tree, and the two boxes.** `account/` at the repo root, a copy of the service and its tests; the face's seat and proxy pointed at it by default; the Account's fence taught a second address; a compose file that runs the agent box and the Account box apart; the dev loop still two host processes | **designed here** |
| 2 | **A shares into the Account box.** The Account grows an A-share market (quotes, candles, the lists the Lunhui rows freeze) from Tencent, Eastmoney and AKShare; AKShare runs as a sidecar of the Account box and reaches Gravit only through the seat (a passthrough tool); the Lunhui freeze rows fetch through the Account's HTTP API; the face's own cn quote wire (`/data/quotes`, iFinD, Tencent) retires; the agent box holds no data source of its own | named only; its own design next |
| 3 | **The Account's own page retired.** `account/src/portfolio/public` leaves; Guard, Beast and the live cap, the only owner settings still changed on that page, get controls on the face's Account screen | named only; its own design after 2 |

Project 1 leaves room for 2 and 3 and does not start them: the Account box's image may later carry
Python (AKShare), so the compose file is written per service with its own Dockerfile; the Account's
page keeps being served and published to the host until 3.

## 3. Goals, non-goals, anti-goals

**Goals.**
1. After this project, a clone of this repository holds everything the face needs: `cd face && npm
   run setup && npm start` and `cd account && npm run account` bring up the whole product; nothing
   points at `~/buyer-agent-demo`.
2. The two boxes can be run apart with one command (`docker compose up`), and Gravit's shell inside
   the agent box cannot read the Account's home.
3. Every existing drill and smoke still passes against the in-tree Account (`account-seat-smoke`,
   `account-graft-smoke`, the owner drill's steps, the seat read drill of 2026-10-27).
4. The Account's service behaves exactly as it does today on the host — same routes, same door
   protocol, same cards — so the face's client and the seat need no change but their defaults.

**Non-goals.**
- Tracking Linqi's repository (no subtree, no submodule, no scheduled pull). A later pull, if ever
  wanted, is a by-hand diff against the origin commit named in `account/NOTICE`.
- Changing the Account's door protocol, its envelope, its Guard, its venues or its paper book.
- A shares (project 2), the Account's page (project 3), the face's cn quote wire (goes with 2).
- Hosting elsewhere. The boxes run on the operator's Mac; the compose file is written so that
  moving one box to another machine later is a matter of addresses, but that is not done or tested.
- A second human, a second machine, a real venue — the charter's §8 triggers stand as they are.

**Anti-goals** (a failure even if it technically works).
- The agent box reaching the Account's secrets by another road: a docker socket mounted into the
  agent box, the Account's volume mounted into it, a host path shared by both, an env file with the
  venue keys handed to the face. The whole point is that one box cannot open the other.
- The dev loop getting heavier for the operator's daily work. Two host processes stay the default
  way to run; the compose file is the isolated way, used when wanted. If the operator has to start
  Docker Desktop to answer Gravit, the project failed.
- A copy that silently drifts from what the smokes test: the fixtures captured from the stand-in
  (`face/tests/fixtures/account/`, captured from 133b9a7's stand-in) and the in-tree service must agree, or the smoke fails
  loudly. The smoke stays the canary.
- Losing the Account's data the operator already has (the paper book, the statement, the owner
  devices) by a surprise home change. The host service keeps its home; the compose volume starts
  empty unless the operator copies the old home in, and the design says how (§7).

## 4. The tree — `account/`

**What comes in** (from buyer-agent-demo @ 133b9a7, the installed checkout; a plain copy, my call —
the operator said not to design around Linqi):

| From `~/buyer-agent-demo` | To | Why |
|---|---|---|
| `src/portfolio/` (157 files: `server.ts`, `mcp.ts`, `service.ts`, `account/`, `live/`, `adapters/`, `public/`, the rest) | `account/src/portfolio/` | the service, the seat, the page (until project 3) |
| `src/core/`, `src/agent/`, `src/contract/` | `account/src/core/` … | `portfolio` imports `core` (67 places) and `agent`; `core` and `agent` import `contract` (8), `contract` imports `core` (2); none of the four reaches `venues`, `wallet`, `plugins`, `runner` or `control-room`. The builder verifies the closure with a script before copying; anything else the closure pulls in comes too |
| `test/unit/*` that exercise the above, `test/standin/`, `test/attack/`, the fixtures they read, and the seat's own tests at the top level (`test/portfolio-mcp.test.ts`, `test/portfolio-mcp-real.test.ts`, which import only `core` and `portfolio`) | `account/test/` | the service's own tests; `test/unit/wallet.test.ts` stays out (it reaches `src/wallet`); the other top-level tests (`account-demo`, `e2e`, `portfolio-demo`) come only if the closure script finds them clean of the dropped directories |
| `fixtures/home/portfolio/{accounts,connectable,frontline,openness}.json`, `manifests/` | `account/fixtures/home/portfolio/`, `account/manifests/` | **run-time inputs, not test fixtures**: `service.ts` reads `fixtures/home/portfolio` at every start (`FIXTURES = join(ROOT, …)`; `loadOpenness()` in `server.ts`), and `manifests/` is read by `test/unit/constraints.test.ts`. The closure script must follow `join(ROOT, …)` reads, not only imports, or the Account dies at boot |
| `package.json` (trimmed), `tsconfig.json`, `vitest` config if any | `account/` | its own package |
| the repository's LICENSE (Apache-2.0; GitHub shows it on the default branch — the shallow checkout at 133b9a7 has no LICENSE file, so the builder fetches the text from the origin repository, not from the checkout) | `account/LICENSE` + `account/NOTICE` | attribution: the origin URL, the commit, the date, the copied paths |

**What stays out:** `src/runner`, `src/control-room`, `src/wallet`, `src/venues`, `src/plugins`
(the demo's runner and its venue connectors; the service does not import them), `scripts/`,
`docs/`, `fixtures/home` beyond `fixtures/home/portfolio` and what the kept tests read, `README.md`/`COOKBOOK.md` (replaced by
`account/README.md`, short, pointing at this design and at `face/README.md` "The Account seat").

**`account/package.json`** — name `gravit-account`, private, `"type": "module"`, scripts kept:
`account` (= `tsx src/portfolio/server.ts`), `portfolio:mcp`, `account:demo`, `account:service`,
`account:check`, `test` (`vitest run`), `typecheck`. Dependencies: `express`, `@anthropic-ai/sdk`,
`@modelcontextprotocol/sdk`, `ccxt`, `viem`, `zod`; dev: `tsx`, `typescript`, `vitest`, `@types/express`,
`@types/node`. **`ccxt` stays** (my first draft dropped it on a `from "ccxt"` grep; the builder check found the
two dynamic `import("ccxt")` in `live/exchange.ts` and `live/hyperliquid-trade.ts`, behind `GET
/api/account/exchanges`, the `keyfile` route for an exchange, the reach probes, the Hyperliquid trader and
`account-check.ts` — goal 4 keeps those routes as they are, so the 63 MB stay). Node `^22.19.0 || >=24`, as
the face. Its own `node_modules`
(`npm ci` in `account/`); not a workspace of `face/` — the two are different boxes with different
images, and the face's `package.json` stays a dsh host's.

**The face's defaults move.** `face/src/account-seat.ts`: `DEFAULT_SEAT_DIR` becomes the repo's
`account/` (resolved from the face's own location, not `homedir()`); `FACE_ACCOUNT_SEAT_DIR` still
overrides. The seat is still spawned the same way (`process.execPath` + the checkout's
`node_modules/tsx/dist/cli.mjs` + `src/portfolio/mcp.ts`, cwd `account/`). `DEFAULT_SEAT_URL` stays
`http://127.0.0.1:4820` for the host dev loop; the compose file sets `FACE_ACCOUNT_URL`.
`.claude/launch.json`'s `account` entry runs `npm run account` in `account/`. `face/README.md` "The
Account seat" loses its clone-and-`npm ci` step and gains `cd account && npm ci`.

## 5. The two boxes

```
 operator's browser ──► 127.0.0.1:3090 ──► [agent box]  face · dsh · Gravit's shell · AKShare (until 2) · seat (mcp.ts)
                                                 │  /data/account/* proxy, seat's HTTP     volumes: dsh-home, seat-home
                                                 │  bind: the repo (strategies/ rw)         env: DEEPSEEK_API_KEY
                                                 ▼
 127.0.0.1:4820 (page, until 3) ◄──────── [account box]  account/src/portfolio/server.ts --home /data
                                                 volume: account-home (seats of the desk, paper, portfolio, agent-wallets, logs)
                                                 env: PORTFOLIO_BIND=0.0.0.0, PORTFOLIO_HOSTS=account:4820
```

**The agent box** runs the face as today, from the repo bind-mounted at its own path (dsh's
workspace is the tree: channels are `strategies/*`, Gravit writes journals and analysis runs there,
`GRAVIT.md` and `roles/` are read at boot). Its homes are volumes: `$DSH_HOME` (profiles, sessions,
credentials written by dsh) and the seat's `BUYER_HOME` (`account/`'s `home.ts` default is
`~/.buyer-agent-demo`; in the box it is `/seat-home`, holding `seats/gravit.json` and nothing else).
It gets one env file: the model key(s) the face needs (`DEEPSEEK_API_KEY`; `IFIND_*` until project 2).
It publishes 3090 on the host's loopback only. Inside the box the face must listen on the container's
interface: `face/src/overlay.ts` pins the webserver row to `127.0.0.1` so that no operator patch can
widen it; this project adds one env, `FACE_BIND` (default `127.0.0.1`; the compose file sets
`0.0.0.0`), read by that overlay row and by nothing else — a process-env switch, not a patch row, so
the README's sentence that a patch cannot widen the binding stays true; the port is published on the
host's loopback, and the Host-based fence (`isTrustedDataRequest`) is unchanged (my call; the
alternative, host networking for the agent service, has no compose network and a weaker box).
**It mounts no docker socket and no path of the Account's.** Gravit's shell, the CLI-agent tools and the str-replace editor see the repo and the two
volumes, nothing else of the host — the confinement that matters is this box's, not the other's
(a shell with the docker CLI could otherwise open any container).

**The account box** runs `account/src/portfolio/server.ts` with `--home /data` on a volume; it
publishes 4820 on the host's loopback (the Account's own page, for Guard/Beast/cap and for the
operator's pairing on an ownerless Account, until project 3). It needs no env file at first: the
venues the operator connects (a key file, a paper account) land in its home through its own routes.
A key-file venue's file must be *inside* the box's volume: the `keyfile` route reads a path on the
service's filesystem, so the operator copies the file into the volume (`docker compose cp`) and names
that path — the builder documents the procedure in `account/README.md`.

**Between them** a compose network; the face reaches `http://account:4820`, the seat (a child of
the face, same box) reaches the same URL through `PORTFOLIO_URL`. The Account's stream, the proxy's
twenty routes, the owner's three writes and the seat's thirty-five tools all travel over that one
TCP connection family, unchanged.

**What the split buys, said plainly** (for the charter's D17/D18 rows): the Account's home —
the desk seats' keys, `agent-wallets`, the paper book, the owner-device registry — is no longer on
a filesystem Gravit's shell can read. **What it does not buy:** the seat's own key stays with the
seat, in the agent box, because the seat is the face's child; a shell turn in that box can still
sign at the Account's door without a Gate 2 card here. The Account's own card on every seat write is
what stands against that, as today; D17's R1 is narrowed, not closed. Closing it means moving the
seat into the Account box (an HTTP MCP transport instead of stdio) — out of scope, noted in §10.

## 6. The fence — one change in `account/src/portfolio/server.ts`

Today the server listens on `127.0.0.1` only (`app.listen(opts.port, "127.0.0.1")`) and refuses any
request whose `Host` is not `127.0.0.1`, `localhost` or `[::1]` (with or without a port), any request
with an `Origin` other than its own, and any cross-site Fetch-Metadata request that is not a
top-level navigation. From the agent box, the face's and the seat's requests arrive with `Host:
account:4820` and are refused before any route sees them.

Two env variables, both unset on the host dev loop so nothing changes there:

- `PORTFOLIO_BIND` — the address to listen on; default `127.0.0.1`; the compose file sets `0.0.0.0`
  (the container's interfaces; the host sees only the published loopback port).
- `PORTFOLIO_HOSTS` — a comma-separated list of extra `Host` values accepted as local, exact match,
  `host:port`; the compose file sets `account:4820`. The `Origin` and Fetch-Metadata rules are
  untouched: the face's proxy sends no `Origin` (its upstream requests carry only `accept` and
  `content-type`, verified in `face/src/account-proxy.ts`), nor does the seat's `fetch`; a browser
  reaching the published 4820 directly still sends a same-origin `Origin` and passes as today.

`agentSetupOf(origin)` (the `claude mcp add` line the page prints) uses the origin the server builds
after it listens — `http://127.0.0.1:<port>` whatever the bind address — which is right on the host
and wrong from inside the agent box; the builder prints the first `PORTFOLIO_HOSTS` entry there when
one is set. A unit test in
`account/test/unit/` covers: default refuses `account:4820`; with `PORTFOLIO_HOSTS=account:4820` it
is accepted; `evil:4820` still refused; a foreign `Origin` still refused with the host accepted.

## 7. Running it

**The dev loop (unchanged, the default).** Two host processes, as today: `cd account && npm run
account [-- --read-only | --live-cap 1 | --home …]` and `cd face && npm start` with the env sourced
in the operator's terminal. The face's defaults find `../account` and `127.0.0.1:4820`. Docker is
not involved. (This Mac has Docker Desktop installed; its daemon is not running by default — the
isolated run is started on purpose.)

**The isolated run.** `compose.yml` at the repo root with two services, `agent` and `account`, each
with a `Dockerfile` in its directory (`face/Dockerfile`, `account/Dockerfile`), `node:22` images;
named volumes `dsh-home`, `seat-home`, `account-home`, `face-modules`, `account-modules`; the repo
bind-mounted into `agent` at the same absolute path it has on the host (dsh records absolute paths in
its session store; a different path in the box would make the host's and the box's session stores
disagree — my call: same path, and the two runs never share `dsh-home` anyway). The bind mount
shadows anything the image installed, and the host's `node_modules` are macOS binaries
(`@esbuild/darwin-arm64`, sharp, fsevents), so `face-modules` and `account-modules` are mounted over
`face/node_modules` and `account/node_modules` and the agent image's entrypoint runs `npm ci` in both
when its volume is empty (Linux binaries; the first `up` needs the network); the agent image installs
nothing at build. The `account` service has no bind mount: its image copies `account/` and runs `npm
ci` at build. The agent box carries `account/`'s dependency tree only for the seat (my call). Ports `127.0.0.1:3090:3090` and
`127.0.0.1:4820:4820`. `agent` depends on `account` with a health check on `GET /api/overview`.
First run: `docker compose run agent npm run setup` writes the profile into `dsh-home`; the
operator's `cordis.patch.yml` rows (the skill roots, the model row — paths inside the box) are
documented in `face/README.md` next to the host procedure. `agent`'s image installs `akshare-mcp`
(Python, `~/.local/bin/akshare-mcp` today) until project 2 removes it; the face's
`FACE_AKSHARE_MCP_COMMAND` names it. The CLI-agent tools (`claude`, `codex`) are **not** installed
in the agent image in this project: Discover lists them as unavailable there; the host dev loop has
them as today (my call; a later project may add them with their own credentials volume).

**The operator's data — the home is `~/.buyer-agent-demo`** (the operator's ruling, 2026-10-27: the
code's default from `home.ts`, the older and fuller home with `agent-wallets/`, `credentials/`,
`ledger/`, `mandates/`, `signer/`, `wallet/` and the desk's `seats/`). Every host run line in this
design runs the service on that default (`npm run account`, no `--home`, `BUYER_HOME` unset), and the
seat's key home is the same directory on the host, as today. The service on 4820 at the time of
writing was started with `--home ~/.openpaper` (`paper/`, `portfolio/`, `seats/`): that home is not
the Account going forward, its paper book is not carried over, and restarting the host service on
the default home is the operator's step, named in the plan's hand-over and never done by the
builder. The compose volume `account-home` starts empty: the first owner pairs with the code the box
prints, the paper venue is opened again. If the operator wants the host's book in the box, `docker
compose cp ~/.buyer-agent-demo/. account:/data` before the first start — written in
`account/README.md` as an optional step, never done by the builder.

## 8. Tests, smokes, drills

- `account/`: `npm test` (vitest) and `npm run typecheck` pass on the copied subset; the one test
  reaching `src/wallet` is left out; a test that needs a fixture under `fixtures/home` brings that
  fixture along.
- `face/`: `npm test && npm run typecheck` unchanged; `FACE_SMOKE=1` with no `FACE_ACCOUNT_SEAT_DIR`
  now finds `../account` and runs `account-seat-smoke` and `account-graft-smoke` against the
  in-tree stand-in (`account/test/standin`): `face/tests/helpers/standin.ts` skips today unless
  `FACE_ACCOUNT_SEAT_DIR` is set, so it and `face/scripts/capture-account-fixtures.ts` fall back to
  the face's `seatDir()`; the smokes' captured fixtures stay the canary.
- `account/`'s suite has a measured baseline before the copy: the operator's checkout at 133b9a7, run
  on 2026-10-27 with `npm test` against a scratch `BUYER_HOME`, no network stub — **164 files, 163
  passed, 1 failed; 2,883 tests, 2,882 passed; 144 s wall** (collect 42 s, tests 87 s; vitest runs the
  files one at a time). The one failure is `test/unit/ui-superagent.test.ts` (the page's floor view,
  a clock regex against rendered HTML — the Account's own page, which project 3 removes), and it is
  the baseline's known red, not the copy's. No test needed the network or the port 4820 the host
  service holds. The plan's per-task gate is the subset touching the copied files; the whole suite
  runs once per plan and must match this baseline exactly.
- The new fence test (§6).
- A compose smoke, manual (`face/README.md` "The two-box drill"): `docker compose up`, the boot line
  `[agent-portfolio-manager] up (stdio) → http://account:4820`, Venues reading `reachable`, Gravit's
  read-only AAPL quote through `portfolio_explore` as in the 2026-10-27 drill, and the negative
  observation: `docker compose exec agent ls /data` fails (no such mount) and the agent box has no
  `/var/run/docker.sock`. Recorded in `DEVELOPMENT.md` §7.4 when run.
- `face/tests/gravit-md.test.ts` (GRAVIT.md ≤ 4,500 bytes) stays green: GRAVIT.md does not change
  in this project (the seat paragraph already says "the operator's Account").

## 9. Documents

Charter (`Gravit-Design.md`): §3 the ACCOUNT line — "Linqi's buyer-agent-demo, an external program
on this machine" becomes "the Account service in this tree (`account/`, copied from Linqi's
buyer-agent-demo @ 133b9a7 on 2026-10-27), run as its own box"; D17 — the fence sentence gains the
two-box fact (the Account's home out of the agent box's reach; the seat's key with the seat, the
Account's card against it); D18 unchanged but for "an external program"; §8 unchanged; §9 a line.
`CLAUDE.md`: the `face/src/account-seat.ts · account-proxy.ts` row names `account/` and drops
"nothing of the Account is vendored since 2026-10-20"; a new `account/` row; the Gotchas' "The
Account seat is an external install" paragraph rewritten. `DEVELOPMENT.md`: §3 (a section for
`account/`), §4.2/§4.7 (the seat row's defaults), §7.3/§7.4 (the suites and the two-box drill), §9 a
residual (the seat's key in the agent box), §10 the forward items. `face/README.md`: "The Account
seat" install, "The two-box drill", the compose first run. `Gravit-Docs-and-Prompt-Loops.html`:
wherever it names `~/buyer-agent-demo`. `ROADMAP.md`: the built log line. `account/README.md`: new,
short.

## 10. Constraints, residuals, what is left to the builder

**Constraints.** Apache-2.0: the LICENSE and NOTICE travel with the copy and name the origin; this
repository itself is public and has no licence file of its own — whether to add one is the
operator's open item, outside this project. Node 22 on both boxes. The compose run is the isolated
topology; the host run is the daily one; both must pass the smokes. No change to the Account's
routes, envelope, cards or venues in this project.

**Residuals (recorded, not fixed here).** The seat's key in the agent box (§5). The Account's page
still served and published (project 3). The CLI-agent tools absent from the agent image. Docker
Desktop's daemon off by default on the operator's Mac. The `mcp-alpaca-kit` row still in the live
`~/.dsh` patch (unrelated; the operator's to drop).

**Asked of the operator on 2026-10-27.**
1. *Which home is the Account's* — **answered: the code's default, `~/.buyer-agent-demo`** (§7). The
   service running on `~/.openpaper` that day is not the Account going forward.
2. *The untracked `demo/` leftover* — **answered: delete; done 2026-10-27** before the plan. The
   stale buyer-agent-demo checkout at 0ef5131 (242 MB, clean, nothing unpushed), `.git/modules/demo`
   (12 MB) and the two `submodule.demo.*` lines in `.git/config` are gone; nothing for the plan.

**Left to the builder.** The exact import closure and test selection (script it, print it in the
plan's ledger); the Dockerfiles' layers and the compose health checks; the NOTICE text; the names
of the two env variables are fixed above, their parsing is the builder's; the order of the docs
pass; whether `account/tsconfig.json` is the origin's or a trimmed one.

## 11. The operator's decisions recorded in this design, and my calls

Theirs: one repository with the back end; two run-time boxes, agent and Account; the purpose is
keeping the money side's keys out of the agent's reach, not moving machines; owning the data and
wallet provision; not designing around Linqi; A shares into the Account box next (project 2); the
Account's home is the code's default `~/.buyer-agent-demo`.

Mine (marked where they appear): a plain copy, not a subtree; the subset (§4), `ccxt` kept;
`account/` as its own package, not a workspace; the two env names and the exact-match host rule
(§6); `FACE_BIND` as the face's one widening (§5); the bind-mount at the same absolute path with the
two `node_modules` volumes and the first-run `npm ci` (§7); the stand-in helper's fallback (§8); the
CLI-agent tools left out of the agent image; the compose volume starting empty with the copy as an
optional operator step; the three-project cut and its order.
