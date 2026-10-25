# Gravit Workbench — Development Reference

**Status:** living, as-built · **Owner:** the operator · **Last full pass:** 2026-09-09 on
`feat/rooms` @ `ce07925`. **Last reviewed:** 2026-09-30 on the `worktree-dsh-0.2.0-rc.2` branch
(`8f0dedb` and the go-live tooling beside it), for the dsh 0.2.0-rc.2 re-host: every section that
re-host moved (§1, §3.1, §3.6–§3.7, §4–§10, Appendix A) was re-read against the code — 381 pytest
in a clean checkout; 654 face tests, 642 pass + 12 skipped without `FACE_SMOKE`, 654/654 under
`FACE_SMOKE=1`; typecheck clean; `npm run check:fixture` clean. The features built
2026-09-09..15 (bot settings and runtime inspection, structured room discussion, bot journals,
temporary subagents, the market watchlist and its live quotes) are named here by module and
route; their operational depth is `face/README.md`'s, and they have had no full pass here.
**Re-read 2026-10-24** for stage 3 of the Account graft (spec
`docs/superpowers/specs/2026-10-22-account-graft-design.md` §12): the Python package, its MCP
server and Gate 1, the PIT beds, the backtests, the three roles and the face's producers and
keyed quote providers left the tree; §2, §3.5 and §7.2 keep their numbers as one-line markers so
the section citations elsewhere still resolve; the face suite is the repo's only suite (1266
tests, 1248 pass + 18 skipped without `FACE_SMOKE`).

**Authority.** `Gravit-Design.md` (the charter) outranks this document on intent. This document
describes mechanism *as built*: where it disagrees with the code, the code is the fact and this
document is the bug. The per-feature specs under `docs/superpowers/specs/` are decision history —
each is frozen once its post-build amendments land — and this document is where their as-built
truth is consolidated. `face/README.md` keeps the face's operational depth (run, profile, drills);
this document points into it rather than repeating it. `GRAVIT.md` is written for Gravit and
`AGENTS.md` and `CLAUDE.md` for coding agents; dsh's instruction loader reads only the first (§3.3).

**Citation rule.** Files and named symbols, not line numbers. The 2026-09-04 drift audit found
line citations in `face/README.md` stale within days of being written; a symbol name survives an
edit above it.

**Two D-number series.** A bare `D<n>` is a debt of the charter (`Gravit-Design.md` §5). `PLAN
D<n>` is an operator decision of the dsh 0.2.0-rc.2 re-host, numbered as the re-host plan and the
code comments that cite it number them; the plan lived in the build session and is not in the
repository, so §4.8 is where those decisions are recorded now.

**The other documents a developer will meet.**

| Document | What it is |
|---|---|
| `ROADMAP.md` | the five-item forward index from the 2026-08-29 reset plus a built log; §10 below is the ordered detail and cites its items by number — move both together |
| `docs/superpowers/specs/`, `plans/`, `runbooks/` | only the five specs and eight plans dated 2026-08-29 or later (skeleton, face chat-light, face instruments, channels, bots-and-rooms) describe this system, and none of them the dsh 0.2.0 re-host; the 54 earlier specs, 50 earlier plans and `runbooks/p-b-p-c-activation.md` are the retired product's history, filed unmarked in the same directories. `runbooks/2026-09-30-dsh-0.2.0-rc.2-go-live.md` is current: the operator's procedure for taking the harness home to 0.2.0 (§4.8, §10 item 14) |
| `docs/design/prototypes/` | the face prototypes (`BRIEF.md`, rounds a/b/c and r2–r4) that §5.5 refers to; the R2 instrument grammar and the R4 palette live here |
| `docs/research/` | frozen inputs, never edited: `2026-08-22-deepseek-harness-dsh-survey.md` is the survey the profile template cites, `2026-08-30-dsh-wiring-recon.md` the 0.1.1-era wiring recon; the rows the face composes today, and its MCP tools, are read live from `/data/plugins.json` (§4.4), whose MCP servers and their tools Discover's Data shelf draws (§5.4) |
| `dsh/README.md` | the profile install path, the operator's two profile rows and the default-model row |
| `face/README.md` | run and sign-in, profile and policy layer, AKShare, the Account seat, Markets and Account (the Account's markets and a market's page, the A shares on the face's wire, the Account's page), the Account in the face (the proxy's routes, the cadence, the fixtures, the smoke, the owner device, Trade), channels, Discover, bots, rooms, temporary subagents, tests, upgrade order, the drills |

---

## 1. The system in one page

One long-lived process (the face) with three kinds of child, one browser tab, and one external
service of its own (the LLM) — plus Linqi's Account on loopback, whose markets and page
the Markets, Trade and Account screens read through the face's proxy (§4.4), at whose door the
page signs as one of its owner devices (§5.3), and whose own egress `face/README.md` lists, the A shares' quote and search providers (iFinD, Tencent) and AKShare's
upstreams.

```
 browser (operator) ── http://127.0.0.1:3090/?token=… once, then a 30-day cookie ──────┐
                                                                                       │
 ┌─ gravit-face  (Node 22, `tsx src/main.ts`, cwd = repo root) ────────────────────────┴──┐
 │  hosts DeepSeek Harness (dsh 0.2.0-rc.2) IN-PROCESS from profile `face`                │
 │  ├─ dsh-base bundle: LLM (deepseek), sessions, storage + projection cache, tools       │
 │  │   (§3.6), sandbox, approvals, skills, the `/api` gateway (`typert-gateway`)         │
 │  ├─ face policy layer (§4.3): the 0.1.1 tool roster, egress and telemetry restored     │
 │  ├─ face overlay rows (13, §4.3): webserver · connection (sign-in) · api-remotes ·     │
 │  │   file-upload · workspace · three Remote controllers · directory-picker ·           │
 │  │   ask-user · agent-preset-registry · preset-gravit · preset-kairos                  │
 │  ├─ bots: each `bots/<id>/` declared as a dsh preset after boot (§3.7)                 │
 │  ├─ face routes: `/` (sign-in; Messages, Markets, Trade, Account) `/client/*` `/data/*`│
 │  ├─ Gate 2: armed inside boot's `prepare` (`armOrderGate`) on `tools/pre-execute` +   │
 │  │   `tools.guard`, the moment those services exist; the rules live in `src/orders.ts` │
 │  └─ children:                                                                          │
 │       ├─ MCP servers: akshare-mcp, the Account seat (project rows); stdio              │
 │       ├─ sandboxed shell turns  (dsh-bash-sandbox; env less KEY|PASSWORD|SECRET|TOKEN) │
 │       └─ `claude` / `codex` runs  (`agent_<bin>` tools; roster-gated per channel)      │
 └────────────────────────────────────────────────────────────────────────────────────────┘
        │                                  │
        ▼                                  ▼
 api.deepseek.com                  127.0.0.1:4820 — Linqi's Account (the seat's service, the
 (the LLM; also `web_search`       proxied reads, the owner's door); its venues and feeds are
  via /anthropic/v1)               its own egress
```

Three homes on disk:

| Home | What lives there | Who writes |
|---|---|---|
| the repo root | `face/`, `strategies/`, `bots/`, `roles/`, `dsh/` (the profile *template* and skill packs), `docs/`; also the session project directory and the sandbox workspace root | operator, coding agents, Gravit (in `strategies/`) |
| `$DSH_HOME` (default `~/.dsh`) | `profiles/face/` (the installed profile; its `cordis.patch.yml` holds the operator's rows — and, once the operator adds it, `agent-default-model`: the provider, model id and reasoning effort Gravit runs with, §3.1, PLAN D2), `sessions/` (per session a 0.1.1 `session.jsonl.zstd` and/or, once 0.2.0 has write-opened it, `session.v4.jsonl.zstd` + `session.lock`), `storages/` (workspace registry; the projection cache, one record per session), `face/` (`archived.json`, `channels.json`, `roster.log`, `agents.json`), `.env`, `.credentials.yaml` (dsh's own key store, mode 0600; since 0.2.0 also the browser-session signing secret), `.anonymous-user-id`; `settings.yaml` is 0.1.1's settings file, which the face no longer reads (PLAN D1) | the operator (the patch file, keys) and the face — including the dsh plugins it hosts (`credentials-local`, `connection`, the session persistence and the storage chain) — for everything else |
| `~/.buyer-agent-demo` (`BUYER_HOME`) | the Account's own home: its store, the seat's key (`seats/gravit.json`) | the Account and its seat; never this tree |

Credentials: `.env.deepseek` is a gitignored file at the repo root that the operator `source`s
before `npm start`; `$DSH_HOME/.env` is the equivalent placement-safe option (dsh's layered env
load reads `<cwd>/.env` then `$DSH_HOME/.env` at boot, filling only names the process environment
lacks). dsh also keeps its own writable key store, `$DSH_HOME/.credentials.yaml`
(`dsh-credentials-local`, mounted by `dsh-base`): a ref → string map that holds the literal
`DEEPSEEK_API_KEY` once anything stores it there, and that outranks both `.env` layers (the
inherited environment still wins) — so "where are the keys" has three answers, not two. Since
0.2.0 the same file also holds a `records:` grant, `client-connection/browser-session`: the secret
that signs the browser cookie (§4.4), written by the first boot on a home and kept across
restarts. An MCP child's environment is scrubbed; the seat needs no key from this tree (it signs
with the Account's own seat key). Shell turns are scrubbed too: dsh's subprocess layer drops every
variable whose name matches `KEY|PASSWORD|SECRET|TOKEN` (case-insensitive) and every `DSH_*` name
before the spawn's explicit env is merged, so a shell child does not inherit the keys — but it can
read the key files, which is residual R1 in §9 (and, for the signing secret, R3a).

---

## 2. (removed 2026-10-24)

The Python package that was this tree's MARKET and ACCOUNT — the library, the PIT beds, the
lookahead firewall, the replay channel, its MCP server and Gate 1, the paper-pinned trading host —
left with stage 3 of the Account graft (the design's §12). The section keeps its number so
citations resolve; the history is the design, the plan
`docs/superpowers/plans/2026-10-24-account-graft-3-removal.md` and git.

---

## 3. Backend: the harness configuration

### 3.1 The profile — template versus installed

`dsh/profile/cordis.yml` is the *content* of the profile in indicative shape: the deepseek LLM row
and the two skill **group** roots; it names no MCP server (the face composes AKShare and the
Account seat itself, below), and since 2026-10-24 no server of this repo's exists to mount. It is
not a validated dsh config; a real profile is a list of plugin rows, and an unrecognised key
merges silently — its `permissions.always_ask` block is inert and stays as the record of what did
not work. The install path is `dsh/README.md`; the installed state is `$DSH_HOME/profiles/face/`,
created by `cd face && npm run setup` (three files: `package.json` bundling `dsh-base` only,
`cordis.patch.yml` with a load-bearing trailing `[]` under a header — `PATCH_HEADER` in
`src/setup.ts` — that names the rows the face owns, `pnpm-workspace.yaml`; the command refuses an
existing directory, so a profile created before 0.2.0 keeps its older header, which is prose
only). The operator mounts the skill roots and the model row below into `cordis.patch.yml`;
`<profile>/cordis.yml` is face-managed and rewritten to `[]` on every boot (§4.1). A home that
still carries the retired Alpaca MCP row should drop it: its command names the removed Python
package, so the server never starts, and should anything register `place_order` or `cancel_order`
the boot refuses (§4.7).

The same file carries Gravit's default model. The face provides no `profileContext` (PLAN D1),
so it reads no `$DSH_HOME/settings.yaml`, and without an `agent-default-model` row Gravit runs
dsh-base's `deepseek-official/deepseek-flash`. Nothing in the running face writes the default
back either: `agentDefaultModel.saveSelection` needs a config editor, which only `profileContext`
brings, so `session/selectModel` — a Remote the face client does not call — would change one
session and save nothing. The row (PLAN D2; `deepseek-v4-pro` and `deepseek-flash` are the
0.2.0 catalog's two DeepSeek models, `deepseek-v4-flash` is gone):

```yaml
- id: agent-default-model
  config: { provider: deepseek-official, model: deepseek-v4-pro, reasoningEffort: max }
```

No module link farm any more: every bare row name resolves through the runtime resolution the
face computes from its own `package.json` at each boot (§4.1). A row naming a package outside
that closure falls through to `$DSH_HOME/profiles/` itself, where a stale 0.1.1
`profiles/node_modules` farm would answer with a 0.1.1 package — harmless for the operator's
rows, and the reason PLAN D13 deletes the farm once no 0.1.1 tool runs on the home.

AKShare is a project-owned default in `face/src/akshare.ts`: a separate stdio `mcp-akshare` row,
inserted after the bundle and policy layers and before operator profile/home patches, which can
override or disable it. It launches the separately installed `~/.local/bin/akshare-mcp` (override:
`FACE_AKSHARE_MCP_COMMAND`), passes a 500-row response limit and uses a 120-second tool timeout.
Startup failure is logged and does not stop the host (`failOnStartupError: false`: the row is
ACTIVE either way). These vendor reads have no lookahead guard (no read in the tree has one since
2026-10-24). Since 0.2.0 an MCP server's `instructions` enter the system prompt as a
`mcp:<serverName>` section with no switch — akshare-mcp sets them, so Gravit's prompt and every
bot's carry an `mcp:akshare` section — and instructions over 32 KiB fail the connection; stdio
negotiation starts a probe process before the serving one, so each MCP server is spawned twice per
connect. Installation, source limitations and the live-roster check are in `face/README.md`.

The Account seat is the second project-owned row, `face/src/account-seat.ts` (spec
`docs/superpowers/specs/2026-10-20-account-seat-design.md`): a stdio `mcp-account` row composed right
after AKShare, below the operator's patches, that spawns the MCP seat of Linqi's Account
(`linqizhe07/buyer-agent-demo`, an external program the operator installs at `FACE_ACCOUNT_SEAT_DIR`,
default `~/buyer-agent-demo`, and runs at `FACE_ACCOUNT_URL`, default `http://127.0.0.1:4820`) with
this process's node and the checkout's `tsx`, never `npx`; the seat is named `Gravit`
(`PORTFOLIO_AGENT`), its key the Account's (`$BUYER_HOME/seats/gravit.json`, made by the seat on its
first tool call), the call timeout 90 s (`portfolio_wait` runs 55 s at most), startup failure logged
and not fatal. The seat sets no `instructions`; it registers its 35 real-account tools even with no
service to reach (§4.3 prices them). A missing checkout is a spawn failure dsh logs: the row stays
ACTIVE with no tools and the Account screen's seat box says the service is not reachable. The seat's
twelve writes are Gate 2's (§4.7); its standing reaches the screen through `/data/seat.json` (§4.4);
a role never carries a seat tool (§3.8's never-list). The install, what the service does on its own
and the drill are in `face/README.md` "The Account seat". A service half-open at boot — accepting the connection, never answering — stalls `bootFace` for two
MCP `initialize` timeouts (measured 123 s against a listener that never answers: dsh-mcp-client's probe
process and its serving process each wait the MCP SDK's 60 s), after which the row is active with no
tools and `/data/seat.json` says `timeout` within 7 s; the seat's startup GET has no timeout of its own
(`src/portfolio/mcp.ts:71` at 133b9a7), a change that is Linqi's (`face/README.md`, the drill's step 7).

### 3.2 Skill packs

| Pack | Owner (charter §4) | Content |
|---|---|---|
| `dsh/skills/mechanics/account-seat-guide` | operator | the Account seat's mechanics (§3.1): paper venues only, the two cards and their thirty minutes, waiting on a card, what to ask the owner for and never, the codes that mean stop, the quotes unguarded |
| `dsh/skills/style-gravit/doctrine` | operator; Gravit proposes in journal or conversation, never edits | 39 entries, 9 tagged `(red-line)` |
| `dsh/skills/style-gravit/signals` | operator | six named setups |
| `dsh/skills/style-gravit/lessons` | operator | 21 entries, 20 `(principle)`, one `(loss)` |

The seat guide is the one mechanics skill since 2026-10-24 (the backtest rules skill and the Alpaca
package guide left with the package). Every `SKILL.md` needs `name` + `description` frontmatter
or dsh drops it silently. The three style packs were emitted once from the retired `seeds_v2`
JSON by a converter script that left with the Python layer (git history keeps both). Mechanics bind:
findings never overrule them. Style yields to findings, but the conflict is reported.

### 3.3 `GRAVIT.md`

The workspace map every dsh agent in the tree reads on its first request — Gravit, its role
children (§3.8) and the bots alike — so it states facts and rules only, never identity or persona:
the three layers and where each lives (the Account through the seat, AKShare), that no read is
guarded against lookahead and the evidence is forward paper trading, the strategy directory
contract and lifecycle, the room caps sentence (pinned to `ROOM_CAPS`), the seat's paragraph, the
never-edit list (`dsh/profile/` on it since plan 3). Its commit rule is "between cycles; a cycle
commits once, with its verdict": a session's sandbox root is its own cwd (dsh-base's
`sandbox-policy` takes the header's `cwd`), so a commit from a channel session writes `.git` above
it and raises an approval card, which inside the rounds would stall the run (`cycle.md` says the
same). Budget 4,500 bytes — 3,300 used since the rewrite of 2026-10-24 — no `{{`, and none of the
removed layer's names (`face/tests/gravit-md.test.ts`). The Step 0 rule — a new strategy starts
with one batched `ask_user_question` and no code — is not among them: it lives in
`dsh/profile/cycle.md` (§4.3), not in the file every agent reads, so `GRAVIT.md` carries the facts
and rules of the tree only.

Discovery is dsh's (`dsh-agent-instructions`, the `agent-instructions` row dsh-base mounts,
64 KiB budget), but the candidates are the face's: `composeFace` sets the row's two lists
(`src/instructions.ts`: `instructionFileCandidates: ["GRAVIT.md"]`,
`localInstructionFileCandidates: ["GRAVIT.local.md"]`) after the operator's layers, keeping every
other key they left on the row, so `AGENTS.md` and `CLAUDE.md` are never read by any agent in the
tree — `AGENTS.md` is the coding agents' file now, `CLAUDE.md` Claude Code's. The loader walks
from the `.git` root down to the session's cwd, so a channel session also reads any
`strategies/<name>/GRAVIT.md`; a gitignored `GRAVIT.local.md` beside the root file is the
operator's machine-local overlay (`tests/instructions-smoke.test.ts` pins all three readers and
both exclusions; `tests/roles-smoke.test.ts` pins the root file in a role child's first-request
baseline). Two dsh facts the patch does not change (installed
`dsh-agent-instructions/lib/index.js`, `USER_GLOBAL_FILE` and the baseline identity): the
user-global file is hard-coded `$DSH_HOME/AGENTS.md` and still loads when the operator has one,
and the candidate list is part of the baseline's identity, so a session resumed across this
change receives one replacement baseline. The seat's facts `GRAVIT.md` carries are repeated in
`account-seat-guide`, `CLAUDE.md` and `face/README.md` "The Account seat"; when the seat changes,
all of them move.

### 3.4 The strategy directory contract

`strategies/<name>/` = `THESIS.md` (thesis, rules, falsification terms), `journal.md` (a dated
entry per result: the Account's own figures as returned, with the order ids), `status.yaml`.
`strategies/_template/` is the copy source. A `backtests/` directory is optional and nothing
writes one since 2026-10-24: `channels.ts` reads one when it exists (an old strategy's) and draws
no backtests section without it. Trap: a channel session's shell runs in `strategies/<name>/`
(the `bash` tool defaults to the session cwd), so a relative path Gravit types resolves inside
the strategy directory.

`status.yaml`: `status` ∈ `idea | researching | validated | paper | retired` (`paper`: a forward
paper trade is running on the Account), plus optional `one_line`, `next`, `numbers` that the
channel page renders (§5.4). The face reads `status` through a regex floor first, tolerates
malformed YAML, and does **not** validate the vocabulary — status is a badge, not a gate.

Naming: the create box accepts `NAME_RE` — first code point a letter or digit, then letters,
digits, combining marks, `_`, `-`, at most 41 code points, NFC-normalized; the browser folds
whitespace runs to one dash before posting. `_template`, dot-leading and `__`-leading
directories are never channels. Spaces stay refused on purpose: the name becomes a path Gravit
writes into shell by hand, and by the Trap above — a channel session's cwd is `strategies/<name>` —
`cd` is the command it has to write, where two words are zsh's two-argument form (word 1 replaced by
word 2 in `$PWD`), an error most of the time but exit 0 in the WRONG directory whenever the
substituted path exists.

State on 2026-09-04: three real strategies exist, all **untracked** in git — `市场情绪` (went
idea → researching → retired on 2026-09-02 by its pre-registered falsification terms; carries an
extra `sentiment.py`, a rewritten screen and backtest, and an untracked pytest file beside the
removed suite — scripts of the removed Python layer, which no longer run), `storage-chain` and
`Bloom-Energy营收预期分析` (byte-identical template copies at `idea`). "git log is the audit
trail" holds nothing for them yet (§10).

### 3.5 Scripts (removed 2026-10-24)

`scripts/` left with the Python package: the bed captures, the live probe, the face's three
producers and the style-pack converter. The face's own scripts are `face/scripts/` (§7.1).

### 3.6 What Gravit can call

Everything below is registered tree-wide except the `role_<id>` tools, which belong to Gravit's
preset alone (§3.8); only the MCP rows, `agent_<bin>`, `dispatch` and the role tools are
operator- or face-specific. The host roster is dsh-base's plus the face's policy layer (§4.3),
and on the pinned tree it equals the 0.1.1 face's name for name: 26 tools before any MCP server,
local agent or room (measured 2026-09-30 against a boot of the 0.1.1 composition); Gravit's own
sessions see that roster plus the role tools. dsh-base 0.2.0 alone would differ — `web_fetch` and
three MCP resource tools on, `ralph` and `str_replace_editor` gone — and the policy layer undoes
each (PLAN D6, D7, D9). The rows a running face actually composed, and its MCP and `agent_<bin>`
tools, are listed by `/data/plugins.json` (Discover's Data shelf draws its MCP servers and their
tools). The `role_<id>` tools never are: they are scoped to Gravit's preset and the listing reads
the global tool view. They show in the
`tools` of each `request/header` event in Gravit's own session log, and the boot's `agent
presets:` line lists `gravit` only when every role row mounted (a row that fails lists the
default broken, and the boot refuses).

| Tool(s) | Row (`dsh-base` unless noted) | Note |
|---|---|---|
| `bash` (and `pwsh` on Windows) | `tool-bash`, `tool-pwsh` | sandboxed to the calling session's cwd (§4.1); env scrubbed as in §1 |
| `read`, `write`, `edit`, `read_image`, `glob`, `grep` | `tool-fs`, `tool-fs-search` | same sandbox boundary |
| `str_replace_editor` | `tool-str-replace-editor`, inserted by the face's policy layer (PLAN D9) | dsh-base 0.2.0 dropped the row; same sandbox boundary |
| `job_output`, `job_list`, `job_kill` | `tool-jobs` | a job outlives the turn that started it; owner-fenced — a session lists, reads and stops only its own — and cancelled with its owner, which is why a `bash` role carries them for its own jobs (§3.8) |
| `subagent`, `subagent_fork`, `send_message`, `interrupt_agent`, `list_agents` | `tool-subagent` (continuable), `tool-subagent-fork` (one-shot), `tool-subagent-control`, `tool-subagent-list-agents` (in-process spawn/fork) | a continuable child reaches its parent with `send_message`, delivered as an `agent-message` relay (0.1.1's `report` tool is gone); Gate 2's `tools.guard` is tree-wide, so a gated tool stays gated inside a subagent |
| `ralph` | `tool-ralph`, re-enabled by the policy layer (PLAN D9) | fresh-subagent iteration, up to 64 rounds per call; dsh-base 0.2.0 ships the row disabled |
| `todo_write`, `workflow`, `exit_plan_mode` | `tool-todo`, `tool-workflow`, `plan-mode` | |
| `create_goal` / `get_goal` / `update_goal` | `tool-goal`, over dsh-base's `goal`, `goal-round-driver` and `command-goal` | the cycle's loop (`dsh/profile/cycle.md`, §4.3): `create_goal` with `max_goal_rounds` 24, refused while a goal that is not complete exists (one cycle per session); the round driver re-prompts at idle while the goal is active and armed and, at the cap, blocks it with `round-limit` and prompts nothing more, so the contract has Gravit write the researching verdict in round 24; `get_goal` gives the id and revision `update_goal` needs; `update_goal` `resume` on the operator's message after a restart or an errored or max-tokens round (both only disarm), which dsh accepts only in a direct human turn on a root agent (R30); the face's Stop during a round PAUSES the goal, and a paused goal is the operator's `/goal resume` alone (`GOAL_TOOL_RESUME_PAUSED` for the model); the model's `blocked` always carries the code `model-reported` and is refused before an automatic round 3 (`blockedAfterConsecutiveRounds`), so `cycle.md` has Gravit lead the reason with `venue-window`, `data-missing` or `needs-operator`; `complete` also accepts a blocked goal and would erase its blocker, so the contract completes only a validated or retired cycle; `goal-smoke` pins most of these on a real boot (§7.3) — the errored/max-tokens disarm and `complete` accepting a blocked goal are read from the installed packages; a role never carries them (§3.8) |
| `skill` | `tool-skill` + `skill-filesystem` | loads one `SKILL.md` by catalog name; the catalog (name + description) is what the model chooses from |
| `web_search` | `tool-web` (`fetch: false`, PLAN D6) over `web-search-deepseek` | outbound to `https://api.deepseek.com/anthropic/v1` with `DEEPSEEK_API_KEY`; no page fetch |
| `ask_user_question` | `tool-ask-user` (face overlay; the blocking `legacy` mode) | §4.3; the answer is model-visible, so not a gate |
| `mcp__akshare__*` | project `mcp-akshare` row | public A-share/other market queries, unguarded; check source errors and truncation |
| `mcp__account__*` | project `mcp-account` row (§3.1) | the Account seat: Linqi's Account at `127.0.0.1:4820`, an external program; 35 real-account tools (42 against a simulated service); the twelve writes carded by Gate 2 (§4.7), the reads public, seconds old and unguarded — read as they are, with no lookahead guard; `portfolio_wait` polls a card or an order for 55 s at most |
| `agent_<bin>` | face `agents.ts` | roster-gated per channel (§6.5) |
| `dispatch` | face `room.ts` (`installRoom`) | Gravit's own: refused in any session whose header or `agentPreset` projection names a bot (§6.8) |
| `role_<id>` (one per `roles/<id>/`; none today, `roles/` ships only `_template`) | one `dsh-tool-subagent` row per role inside Gravit's preset, rendered by `src/roles.ts` (§3.8) | scoped: a bot never sees one, and a role child removes them through its own allow list (a `subagent_fork` child, restricted by nothing, keeps them, and so does a plain `subagent` child, though neither its roles section nor the cycle contract reaches it, §3.8); a one-shot `spawn` child with the role's persona and exactly the role's tools; the arguments are `description` (its label in Details' Children, §5.4) and `prompt`, and the call waits unless `run_in_background` is set |

Not tools, but in the same prompt: a connected MCP server's `instructions` (the `mcp:akshare`
section, §3.1). The MCP resource tools and their prompt section are off by policy (PLAN D7).

### 3.7 The bot directory contract

`bots/<id>/` = `agent.cordis.yml` (GENERATED by `renderComposition`: two rows — the face-owned
`gravit-bot` plugin, named by the relative path `../../face/plugins/bot.js` and carrying
`persona` + `allow`, and `dsh-skill-filesystem` rooted at `./skills` with
`includeDefaultRoots: false`), `preset.yml` (`name`, `description`, optional `order` — what the
roster shows — and the face-only `model`), `SOUL.md` (the persona SOURCE the face copies into
the composition), `README.md` (the contract, for whoever opens the directory), `skills/` (the
bot's stance pack, `skills/<skill>/SKILL.md` with `name` + `description` frontmatter),
`journal/` (the only directory the bot may write, and its home session's cwd; its
`notes.md` is read into each of the bot's requests, `src/bot-journal.ts`). `bots/_template/` is
the copy source.

dsh 0.2.0 reads none of these files: its preset registry scans no directory. The face turns
each directory into a `PresetDefinition` (`definitionFor` in `src/bot-presets.ts`): `preset.yml`'s
`name`, `description` and `order`, read exactly as 0.1.1's dsh read them (trimmed, a blank value
omitted; an absent or malformed file is empty metadata and the bot still declares), and the
composition's rows REBASED onto the bot directory, because dsh resolves a preset's rows against
the declaring context's base (the profile directory), where 0.1.1 resolved them from the
preset's own. A `./`, `../` or absolute path row becomes an escaped absolute `file:` URL, a
`group: true` row rebases recursively, and a relative `customSkillDirs` entry of the
skill-filesystem row becomes `bots/<id>/…` — a behaviour change: 0.1.1 resolved `./skills`
against the process cwd, `face/`, so no bot ever scanned its own `skills/` (today those hold only
a README). `bots/gravit` is the static `preset-gravit` overlay row (§4.3), built by the same
`definitionFor` but handed its rows in memory — rendered from `roles/` (§3.8) — so the directory
supplies only `preset.yml`'s display metadata and its `agent.cordis.yml` is a generated mirror the
face never reads (a missing roles directory or an unreadable role refuses the compose instead).
A second static row, `preset-kairos`, declares the same definition under `kairos`, the agent's id
before the 2026-10-08 rename. Sessions created before it persist that id, and dsh refuses to
resume a session whose preset no row declares (`agent-preset/not-found`,
`AgentPresetRegistry.retain`). The alias has no directory, so `/data/bots.json` never lists it,
and `RESERVED_IDS` keeps both ids from naming a bot.
Every other bot is declared by `declareBots` once the tree has settled (§4.1): activation is
eager, and a declaration at row time would mount `plugins/bot.js` before the MCP tools exist. A
composition the face cannot read (missing, unreadable, not YAML) is not declared — the reason,
with the file path, is logged and shown as `broken` on `/data/bots.json` — while a readable
non-list IS declared and the registry lists it broken in its own words.

The face is the only writer, and every write re-declares: a create, a settings save or a soul
save (`src/bots.ts`) rewrites the files, then `redeclare(id)` disposes the bot's declaration and
registers the new one before the route answers, serialized per id. Running conversations keep
the revision they joined; new ones get the saved files. A re-declaration that fails answers 500,
naming what was saved. There is no on-disk generation stamp — a revision is one declaration —
so a hand edit to `SOUL.md`, the composition or `skills/` reaches nothing until the next save
through the face or a restart.

Naming: the face keeps the retired dsh-agent-presets grammar `[a-z0-9][a-z0-9-]*`, bounded to 64
code points (`BOT_ID_RE`), as its own gate — dsh 0.2.0 asks only for a non-blank id; the display
name folds to a proposal through `proposeBotId` (`src/bots.ts`, twinned in `client/js/wire/botId.js`) and
the field stays editable. `gravit` is refused by name (`RESERVED_IDS`), `_template` by the
grammar, which admits no leading underscore — both through `isBotId`. A soul carrying `{{` is
refused twice, at `rejectSoul` and again at the plugin's `validateBotConfig`: the system prompt
is a strict template with no escape.

State on 2026-09-30: eight directories are tracked. `bots/gravit` is the default preset every
session that names no preset joins; since the role library its composition is rendered from
`roles/` at compose time (§3.8): the `gravit` row (the face's `gravit.js`, whose
`deployment:today`, `gravit:roles` and `gravit:cycle` sections are scoped to Gravit's
sessions), then one `dsh-tool-subagent` row per role — none since 2026-10-24, so the render is
the `gravit` row alone (`roles: []`). It masks no host tool, so Gravit's tools are the host's
plus any `role_<id>` tools, and its `agent.cordis.yml` is the generated mirror of that render.
`bots/_template` is the copy source, never declared and refused as an id.
`bots/drill-bull/` (看多派) and `bots/drill-bear/` (看空派) are the room drill's two voices, kept
as tracked fixtures with their channel `strategies/room-drill`; `news-scout` is the operator's
own (the AQR room's three bots and their strategy left the tree on 2026-10-24). A created bot is the
operator's to commit; the operator's tree holds untracked ones too.

`preset.yml` may carry one key beyond `name`, `description` and `order`: `model:
<provider>/<model>` (`MODEL_ROUTE_RE`, written by `renderPresetMeta`). It is **face-only**: a
preset definition carries no route, and the face copies only the three display keys into it.
The room engine resolves it per bot, once per room (`selectionFor` in `src/room.ts`), and falls
back to the tree's default route with a logged, model-visible note when the route is not one
`provider/model` pair or the tree does not serve it; a bot's HOME session takes it on its first
request (`src/bot-runtime.ts`).

A bot in a room gets a member session **per room** — one per (room, bot) pair, not one per bot.
Its header is the whole membership rule: `parentSession` = the room session, `agentPreset` = the
bot, `cwd` = the channel directory, and the `read-only` permission preset pinned inside creation
setup — on `setup(agentCtx, agent)`'s own agent, before the session is announced — so it is the
member's first permission fact and no create→set window exists. `src/room.ts` creates it
(`materializeMember`) and resumes it; nothing creates one by hand, and a session that only looks
like one is not a member (§9, R16).

### 3.8 The role directory contract

`roles/<id>/` = `ROLE.md` (the child's persona, trimmed; never empty, at most 2,000 bytes as
`wc -c` counts them, no `{{` — the system prompt is a strict template with no escape) and
`role.yml` (`name`; `description`, the ONE line Gravit reads when it chooses a role, at most 300
characters; `allow`, a non-empty list of exact tool names; an optional `model:
<provider>/<model>` in `MODEL_ROUTE_RE`'s grammar; keys it does not know are ignored).
`roles/_template/` is the copy source and carries a `README.md`, the contract for whoever opens
the directory; it is never a role. A hidden entry or a plain file under `roles/` is skipped; a
symbolic link, or a directory whose name is not an id, is refused (below). No role ships since
2026-10-24: the three that did (a screener, a backtester and a reviewer, their allow lists the
removed package's tools) retired with their tools, and the next are the operator's to design;
`_template`'s `ROLE.md` keeps the report's four headings (status, what was measured, paths,
limits). The operator is
the only writer, by file edit; Gravit proposes a role in conversation and never creates or edits
one (charter §4), and nothing in the face writes under `roles/`, so, unlike a bot, a role has no
save and no re-declaration: `composeFace` reads the directory once per boot, and an edit reaches
the next restart.

The id is the directory name in the bots' grammar `[a-z0-9][a-z0-9-]*` (`ROLE_ID_RE`, 64
characters, as `BOT_ID_RE`); the tool Gravit calls is `role_` plus the id with `-` as `_`
(`toolNameFor`: `data-check` is `role_data_check`). A tool name over 64 characters
(`TOOL_NAME_MAX`) is refused, which makes an id over 59 characters one the reader will not take:
dsh caps nothing, a model API may cap a function name there, and `role_` plus a 64-character id
reaches 69. The summary is one line because `plugins/gravit.js` emits one bullet per role.

`readRoles(root)` (`src/roles.ts`) reads and validates every role synchronously, sorted by id, and
returns plain data (`RoleFile`). The first problem throws an `Error` whose message opens with the
absolute path of the file or directory at fault: the roles directory missing or not a directory,
a symbolic link in it or a directory there whose name is not an id, `ROLE.md` or `role.yml`
missing or unreadable, a persona empty, over its budget or carrying `{{`, YAML that does not
parse or is not a mapping, a blank `name` or `description`, a description on two lines or over
its cap, an `allow` that is not a non-empty list of strings in the tool-name grammar, an entry
listed twice, an entry the never-list below refuses, a `model` that is not a route.
`composeFace` calls it last but for the cycle file (`readCycle`, §4.3), just before the overlay is
pushed, and does not catch: one bad role, or no `roles/` at all, ends the compose and so the boot
(the fail-loud contract of spec §5.1, as 0.1.1's roster check refused a boot), and a face that
ships `bots/` therefore ships `roles/` beside it.
`FaceBootOptions.rolesRoot` points a test at a fixture. `gravitRows(roles, {plugin, cycle})` then
renders the default preset's composition: the `gravit` plugin row — named by `GRAVIT_PLUGIN_URL`, an
absolute `file:` URL that `definitionFor`'s rebase passes through — whose config `roles: [{tool,
summary}]` the plugin turns into the `gravit:roles` section (order `TOOL_SUBAGENT` + 1; a sentence
on what a role is and why its report is a claim to check, then `- role_<id> — <description>` per
role: `dsh-tool-subagent` has no description key, which is why the summaries ride on this row) and
whose `cycle` — the text of `dsh/profile/cycle.md`, which `composeFace` reads right after the roles
(`readCycle`, `src/cycle.ts`) — it turns into the `gravit:cycle` section (§4.3); then one
`@deepseek-ai/dsh-tool-subagent` row per role, id `role-<id>`, `config` =
`provider: spawn`, `toolName: role_<id>`, `backgroundMode: one-shot`, `persona` (the `ROLE.md`
text), `toolFilter: {allow: […]}`, and `agentOptions: {provider, model}` only when `role.yml` names
a route (otherwise the child inherits its parent's). The rows go to `definitionFor(botsRoot,
"gravit", rows)`, which rebases them as a file's would be and reads only `bots/gravit/preset.yml`
(the display metadata); the `preset-kairos` alias carries the same definition (§4.3). A role row
that fails to mount marks the default preset `broken`, and the roster audit (§4.1 step 8) refuses
the boot. A row whose `spawn` provider is absent has not failed: `dsh-tool-subagent` logs at info
level that the tool will register when the provider appears and mounts without it, so the preset
is not broken and the boot does not refuse; the visibility gate below then leaves that role out
of Gravit's prompt until its tool exists.

`bots/gravit/agent.cordis.yml` is a GENERATED mirror: `renderGravitComposition` dumps the same
rows — the plugin spelled by its shipped relative path, `GRAVIT_PLUGIN_RELATIVE`, as a bot's
composition spells its own — in the Loader's dialect (`entryListSchema`) under a three-line header
saying so, and `cd face && npm run render:roles` (`scripts/render-roles.ts`, outside `tsc`'s
include like the other scripts) writes it. Nothing reads it at boot; its job is to show whoever
opens `bots/gravit` what the preset is. `tests/roles.test.ts` renders the repository's `roles/`
and byte-compares it with the committed file, and fails while they differ, so an edit under
`roles/` that skipped the script cannot land. The header names `dsh/profile/cycle.md` too: the
mirror embeds the cycle text as the `gravit` row's `cycle` (a YAML block scalar), so an edit to
that file needs the script run as well, or the same test fails.

`allow` entries are EXACT: a host tool name (`read`, `grep`) or `mcp__<server>__<raw>`, letters,
digits, `_` and `-` only (a `*` is refused where the file is read), under the server name the
operator's profile mounts the server with, so a server under another name means editing every
role that names its tools (the never-list matches the account and order names under any server
name). The
reason is the backend's, not a taste: dsh's spawn backend applies a child's `toolFilter` inside
the child's creation window — `applyChildComposition` in the installed `dsh-subagent` calls the
child context's `tools.restrict(filter)` — and `restrict()` in `dsh-tools` checks every name by
set membership against the tools the child inherits, throwing `tools.restrict() names unknown
global tool "…"; known global tools: …` for a name outside the set. There is no glob and no
prefix match. The spec's §5.2–§5.3 still say a `mcp__*__<raw>` wildcard expands against the live
tree as `plugins/bot.js` does for a bot; its own §11.1 (a) is the correction, and the code follows
§11.1 (a). Whether a named tool exists is a fact about the tree at the moment the role is CALLED
— an MCP tool is there only while its server is mounted, started and not given up on (§4.1 step
7) — not about the file, so the reader checks nothing of it: a missing tool fails THAT delegation
(the tool result is the `restrict()` error and no child is created), never the boot
(`roles-smoke.test.ts`).

A role also never carries what a delegated child cannot use or must not hold, and the reader
refuses such an `allow` entry with the reason in the message (`NEVER` in `src/roles.ts`;
`tests/roles.test.ts` keeps an independent copy of the names): a tool that needs a human
(`ask_user_question`, `exit_plan_mode` — dsh refuses `ask_user_question` to a delegated caller
with `DELEGATED_CALLER`, so a role that needs the operator says so in its report); the open web
(`web_search`, `web_fetch` — a role works with the tree's own tools, never the open web);
delegation (`subagent`, `subagent_fork`, `send_message`, `interrupt_agent`, `list_agents`,
`workflow`, `ralph`, `dispatch`, and any `role_*` or `agent_*` name — Gravit alone delegates);
goal and todo tools (Gravit tracks them); `run_code`, the reserved PTC transport, which
`tools.restrict()` refuses to name, so a role naming it would fail every delegation; the account
and order tools under any server name — the `mcp__account__` prefix, the seat's twelve writes, and
`account`, `positions`, `orders`, `place_order`, `cancel_order`, bare or as any
`mcp__<server>__<raw>`, matched by raw suffix as Gate 2's `isOrderTool` matches the seat's writes
(the Account seat is Gravit's, §4.7); and the `mcp__akshare__` prefix.

The job tools are a `bash` role's own. A child's `bash` command runs under the deadline of
dsh-base's `bash-sandbox` row, 60,000 ms by default; a call may pass `timeoutMs`, capped at
600,000 by `LocalBashExecutor` (which `SandboxBashExecutor` extends). A command still running at
its deadline is not killed: `dsh-tool-bash`'s `promoteOnTimeout` (on by default) moves it to a
background job. Jobs are owner-fenced — a session lists, reads and stops only its own, so Gravit
cannot read a child's — and an owner's disposal cancels them, so a one-shot child's jobs end with
it. A role with `bash` therefore carries `job_output`, `job_list` and `job_kill` (the reader's
tests hold "jobs only beside bash"), and its `ROLE.md` should say to pass `timeoutMs` for a long
run and to read or stop a moved job before finishing; a role without `bash` carries none of the
three.

What a delegated child sees (spec §5.4 as corrected by §11.1 (a)). It JOINS the preset it was
delegated from (`applyChildComposition` calls `agentPresets.composeFrom(childCtx, parent.ctx)`), so
it inherits Gravit's preset layer — the `role_<id>` tools and the `gravit` plugin's sections — and
then, in its creation window, dsh applies its own composition: the fixed `subagent:delegation`
statement (its permission scope was fixed when it started, and an operation that needs approval is
rejected, so it states the limit in its reply); the row's `persona` as a child-scoped
`deployment:persona-prefix` that shadows Gravit's at order 0; and `tools.restrict({allow})`, which
removes everything the role does not name, the preset layer's `role_<id>` tools included, so a
role cannot delegate to a role. The `gravit:roles` section would reach it as well — a scoped
section cannot be filtered by an allow list — so its text is a function of the assembly context:
it lists only the roles whose tool the assembling scope resolves (`canCall` in
`plugins/gravit.js`: `ctx.tools.get(name, context.scope)`, the gate `dsh-tool-web` and
`dsh-tool-subagent` put on their own sections), and a role child, whose allow list removed every
role tool, gets `''` (dsh drops an empty section): it is never told of roles it cannot call. A
`subagent_fork` child is seeded with Gravit's completed turns and restricted by nothing, so it
resolves every role tool and is assembled Gravit's system text byte for byte — the prefix its
inherited history was cached under; a gate on the header's `origin` alone blanked the section for
forks too and broke that reuse. `gravit:cycle` is gated the same way, on `create_goal` (§4.3): a
goal tool is on the never-list, so a role child reads none of it and a fork child all of it.
Visibility alone admits every UNRESTRICTED child, though, so both sections also read the header,
with the fork kept: `canCall(…) && isRootOrFork(context)`, where `isRootOrFork` is true for a
session with no `origin` or with `isSeeded`. A plain `subagent` spawn, a workflow or a ralph
worker resolves every role tool and `create_goal` as Gravit does, yet inherits no prefix and
cannot open a goal (`create_goal` needs a direct human turn on a top-level agent), so it reads
neither section; `roles-smoke` pins that spawn beside the fork.
`deployment:today` is left on for every child, and `GRAVIT.md` reaches it as it reaches every
agent (§3.3). Its cwd is its parent's. It has no
`ask_user_question`, by the never-list and by dsh. Two limits are upstream's. dsh exempts a
scope's own registrations from `restrict()`, so `roles-smoke.test.ts` compares the child's tool
list to `allow` exactly rather than checking a subset. And the child's prompt still carries
dsh's generic tool-policy paragraphs for tools it lacks (`create_goal`, `workflow`, `ralph`, and
for a role without `bash` the background-job `job_output` text), because those sections are global and
ignore the restriction: a small model may be told of a tool it cannot call
(`docs/dsh-upgrade-guide.md` §7.3 watches for a dsh that scopes them to the child's view).

Pinned by `tests/roles.test.ts` (the reader, the render, the mirror — the shipped library is
`_template` alone and the mirror has no role row; a fixture role `probe`, copied from `_template`,
renders exactly one), `tests/gravit-plugin.test.ts` (the section, listing exactly the roles the
assembling scope can call, and nothing for a delegated child that is not a fork),
`tests/boot.test.ts` and `tests/bot-presets.test.ts` (the default rendered in memory and never
read from the file — `["gravit"]` with `roles: []`; a missing roles directory refusing the
compose), `tests/bots-smoke.test.ts` (over the repository's `roles/`, Gravit's roster is the
host's and no `role_*` tool; a bot sees none) and `tests/roles-smoke.test.ts` (a real boot over
two fixture roles made from `_template` under the test's own roles root, `auditor` and `worker`,
with `mcp__fixture__*` stand-ins: persona, exact tools, the result, the auditor child's
`GRAVIT.md` baseline, a fork child's system text and tools equal to Gravit's, a spawn child's
blank sections, the loud failure); the live check is the role drill (`face/README.md`, §7.4),
which waits for a role to exist.

---

## 4. Frontend: the face server (`face/src`)

Some 11,500 lines of TypeScript across 38 files, run directly by `tsx` — no build step, plus two
plain `.js` files outside `src/` (`face/plugins/bot.js` and `face/plugins/gravit.js`, §3.7–§3.8 —
a composition names each by a path the loader reaches as an absolute `file:` URL, which the face
rebases from a relative one for a bot, and each must import nothing). Pins:
`DSH_PIN = 0.2.0-rc.2` (every `@deepseek-ai/dsh-*` dependency, declared exactly and installed),
`CORDIS_PIN = 4.0.4` (`@deepseek-ai/cordis` rides its own 4.x track; the dsh packages peer it with
a tilde range) and `CORDIS_INCLUDE_PIN = 1.0.9` (the one cordis plugin the face imports itself);
all three are asserted by `tests/version.test.ts`, which also refuses the three package names
0.2.0 retired. `face/README.md` carries the run table, the profile rules, the instruments,
channels, Discover, bots, roles, the upgrade order, and the drills. Beside the server,
`face/scripts/` holds four operator tools — `check-home.ts`, the go-live dry run that boots the
face on a COPY of a harness home and read-opens every session (it refuses the live home by
device and inode, and a copy without its `DRY-RUN-COPY` marker), `validate-fixture.mjs`
(`npm run check:fixture`, §6.7), `render-roles.ts` (`npm run render:roles`, §3.8), which
regenerates the mirror `bots/gravit/agent.cordis.yml` from `roles/`, and `schema-sizes.ts`
(§4.3), which boots a COPY with its MCP rows as the copy mounts them and prices a Gravit
request's tools one by one (it refuses the default live home, `~/.dsh`, by device and inode; a
live home set elsewhere is not detected) — and, with `face/landing/`, the static
product landing page (`npm run build` → `face/dist/`) and its demo-asset tooling; nothing there
runs in the face process.

### 4.1 Boot sequence (`main.ts` → `boot.ts`)

`boot.ts` mirrors the dsh 0.2.0-rc.2 CLI's `runProfile` (the `@deepseek-ai/dsh` chunk
`lib/profile-boot-BZ2ZjNWi.js`, also published as `@deepseek-ai/dsh/profile-boot` — a reading
aid, not a dependency) with ten divergences, each stated in the file's header: no `--patch`
files; no `profileContext` (PLAN D1 — with it dsh-base's `settings` row would import and rename
the operator's shared `settings.yaml`, and `config-editor`, `plugin-manager` and `dsh-hmr` would
recompose the live tree from files that do not carry the face's layers); no proxy policy (PLAN
D10 — `installProxyFromEnvironment` would reroute the face's own quote, search and Account fetches too);
no signal handlers, shutdown controller or fail-loud inside `bootFace`; `appReady` committed
last; the face's own `package.json` as the install anchor; a skipped bundle refused; a strict
row audit; and the policy layer.

1. Read `FACE_PORT` (default 3090) and `FACE_PROFILE` (default `face`) with `||`, so an empty
   export means the default rather than a moving port or the profiles root itself. Resolve the
   client directory module-relative.
2. **`process.chdir(<repo root>)`** before boot: `SessionController`, which replaced 0.1.1's
   `ApiProxyService`, takes every session's default project directory from `process.cwd()` and
   offers no config key, and dsh-base's `sandbox-policy.workspaceRoot` is `!!js process.cwd()`.
   The client directory and boot's `INSTALL_ANCHOR` are module-relative; the channel root, the session-delete fence root and the panels' cwd are read
   from `process.cwd()` after this chdir, so they are the repo root only because of it.

   `process.cwd()` is only the *fallback* boundary. `dsh-sandbox-policy` resolves the writable
   root per call from the calling session's `cwd`: a channel session is fenced to
   `strategies/<name>/` (plus platform temp areas), and a write outside it — `face/`,
   another strategy, `docs/` — is denied and escalates to a card; a root session (`+ new` with
   no folder chosen) is fenced to the whole repo, where `face/`, `dsh/skills/` and `roles/` are
   all writable with no card (§9, R9).
3. Install SIGINT (exit 130) / SIGTERM (exit 0) handlers and app-boot's own `installFailLoud`,
   before the boot it guards. It covers `unhandledRejection` and `uncaughtException`, skips the
   rejections boot's startup audit already reported, prints one labelled diagnostic, releases
   the room engine, the quote and search routes, the tree and then the Account proxy under a 2 s bound, and
   exits 1; a signal's shutdown releases the same four in the same order.
4. `bootFace({profileName, port, deferReady: true})`: dsh's layered env load
   (`$DSH_HOME/.env`, `<cwd>/.env`) → `composeFace`: resolve `$DSH_HOME`, load the profile
   anchored on the face's own `package.json` (a bundle `loadProfile` could not load is now
   skipped, not thrown — the face refuses the compose), **rewrite `<profile>/cordis.yml` to
   `[]`** (the loader's write-back would otherwise bake composed rows in and double every
   bundle insert next boot), stack the patches — bundle layers (`dsh-base`) → the face policy
   layer (§4.3) → project AKShare → the profile's `cordis.patch.yml` → the home's
   `cordis.patch.yml` → a caller's in-memory `extraPatches` (`main.ts` passes none;
   `scripts/check-home.ts` disables a home copy's MCP rows with it) — apply the guarded
   switches (`session-telemetry-otel` disabled when `DSH_TELEMETRY_DISABLED` is non-empty and
   the row is composed; `hmr` disabled whenever composed), patch Gravit's persona into
   `system-prompt` (`personaPrefix` only, §4.3), set the `agent-instructions` row's two
   candidate lists after it (`instructionsPatch`, §4.3), then push **the face overlay last** — its
   default preset rendered here, in memory, from `roles/` and `dsh/profile/cycle.md` (`readRoles`
   and then `readCycle` run as the very last steps before the push; a missing roles directory, a
   role the reader refuses, or a cycle file that is missing, unreadable, empty or over 3,300
   bytes ends the compose with that path, and a face that ships `bots/` ships `roles/` beside it,
   §3.8). This
   inverts the CLI's layering deliberately: loopback-only binding must survive an operator
   patch, so face rows win silently; the policy layer is the other way round and yields to an
   operator row with the same id.
5. Compute the runtime module resolution (`createRuntimeResolution`, anchored on
   `face/package.json`, pure) and boot. `prepare` provides the launch environment, installs
   `PluginPackages` with that resolution before any row imports — without it a fresh home
   resolves no dsh-base row, and it needs the native `node-addon-require-builtin` — and provides
   the command line (`args: []`) with the face's own `appReady`. Nothing writes
   `$DSH_HOME/profiles/node_modules` any more. A required dsh entry that does not activate
   throws dsh's `StartupError`, whose grouped diagnostic `main.ts` prints before exiting 1.
6. Audit the settled tree, disposing it and throwing on the first failure: **every enabled
   Loader entry ACTIVE** (dsh 0.2's own boot fails only on its required ids and merely warns on
   the rest; the face refuses a partial tree, naming each `id (package): state`); the services
   `approval`, `userQuestions`, `typertGateway` and `permissionPresets` present, each refusal
   naming its consequence; an ACTIVE `@deepseek-ai/dsh-api-remotes` entry — the answerer: a
   tree without it boots clean and passes every other check while every order is denied "no
   approval channel is available" and every question rejects `NO_PROVIDER`; and
   `ask_user_question` in the **live** tool registry (service and tool fail independently — that
   was the 2026-08-31 → 09-02 silent outage).
7. Audit Gate 2 (§4.7) — it was ARMED inside `prepare`, before any row mounted, by
   `armOrderGate`: two `hostCtx.inject` fibers, the guard waiting on `tools` and the prepended
   `tools/pre-execute` listener on `approval`, so both exist the moment their service does and
   re-arm exactly once if that service restarts. That is the tenth divergence, added 2026-09-30
   after a review proved the window it closes: dsh-base's `typert-gateway` activates DURING
   `boot()` and its unary `/api` is not readiness-gated (only the mux upgrade waits on
   `appReady`), so a slow row let `session/create` + `session/prompt` run, and an order tool
   dispatch, seconds before a post-boot registration existed (`order-gate-midboot-smoke` pins
   the closed window). The audit refuses the boot if either fiber is not ACTIVE, then runs
   `auditOrderTools` and logs `order gate armed for …` or refuses — when a server carries the
   seat's tools and the gate covers none of its writes (`uncovered`), or when any server
   registers a retired order tool, `place_order` or `cancel_order` (`retired`; the refusal names
   the tool and says to remove its MCP row). A third outcome is silence: `dsh-mcp-client`
   defaults `failOnStartupError: false`, so a seat child that cannot start (no checkout at
   `FACE_ACCOUNT_SEAT_DIR`) leaves the row ACTIVE and the tree healthy with no
   `mcp__account__*` tools, no `order gate armed` line and no error from the face — only
   `mcp-client(account): connection failed … no tools were registered` on stdout; reconnect
   exhaustion unregisters the tools for the life of the process. Check the server's page on
   Discover (Data → the server: its tools), the seat box, or that stdout line; the fix is the
   install and a restart.
8. The preset roster: the registry present and its default `gravit`; every other bot declared
   (`declareBots`, §3.7) — a bot that cannot be declared does not fail the boot, its reason is
   kept for `/data/bots.json`; the default listed and not broken; every declared bot listed. Log
   `agent presets: …` (with `N bot(s) not declared, see above` when a declaration failed).
9. `main.ts` mounts the routes (§4.4): `/` behind `ctx.connection.authorizeIndex` and
   `/client/*`; the quote routes (`registerQuoteRoutes`) and the search route
   (`registerSymbolSearchRoute`), both behind the `/data` fence from `http.ts`; the Account proxy and the seat
   route, both on the `mcp-account` row as composed and the second reading through the first's
   `account` reader; channel routes; session
   routes; bot routes (every save re-declares); the bot runtime; the room engine; and panel
   routes (awaited, because their registration runs `syncAgentTools`, so every connected agent
   that has an exec recipe — `claude`, `codex` — becomes an `agent_<bin>` tool before the face
   reports up; a connected bin without a recipe stays a roster row and gets no tool).
10. `booted.commitReady()`: only now does the gateway register `/api/remote.mux`. A tab still
    holding its 30-day cookie reconnects the moment the upgrade is admitted and must find every
    route mounted. It re-checks that the root is still active and throws otherwise — into
    `installFailLoud`, never a face that would not stream.
11. Print `gravit-face: http://<host>:<port>/?token=… (profile: …)` from the bound service —
    the per-process launch token that mints the browser cookie (§4.4) — then one line
    explaining it, and the room caps.

One `bootFace` per process: given a `dshHome` (as the tests do; `main.ts` passes none) it sets
`process.env.DSH_HOME` permanently, which is why the eighteen real-boot tests live in separate
files. Without `deferReady` it commits `appReady` itself as its last step, which is what every
smoke that boots without `main.ts` relies on.

### 4.2 Module table

| File | Responsibility |
|---|---|
| `main.ts` | entry: chdir, signal handlers and `installFailLoud`, boot with `deferReady`, the sign-in route and every route family (the room engine, the bot runtime and the Account proxy included — the proxy's `dispose` runs after the tree's at shutdown, once the web server has stopped), `commitReady`, the tokenized URL |
| `boot.ts` | the mirror of the dsh CLI's `runProfile` (§4.1): `composeFace` (its last step renders the default preset from `roles/` and `dsh/profile/cycle.md`), the runtime resolution, the strict row audit, the required-service and answerer checks, `ask_user_question` in the live registry, Gate 2 registration, the preset-roster checks, `declareBots`, `commitReady` |
| `overlay.ts` | the thirteen host rows `dsh-base` does not mount (§4.3), `satisfies`-checked against each plugin's own config type; `BOTS_ROOT`, `DEFAULT_PRESET`, `GRAVIT_PLUGIN_RELATIVE`, `presetRowId` |
| `policy.ts` | the policy layer (§4.3): `POLICY_ID_PATCHES`, `POLICY_INSERTS`, `facePolicyPatches` — each row a PLAN decision; a missing target is reported on stderr, never skipped silently |
| `akshare.ts` | project AKShare MCP defaults, composed below operator profile/home patches |
| `account-seat.ts` | the Account seat row (§3.1): `ACCOUNT_SEAT_ROW_ID`, `ACCOUNT_SEAT_SERVER`, `SEAT_TOOL_PREFIX`, `ACCOUNT_SEAT_NAME`, `seatDir`/`seatUrl` (the env or the defaults), `accountSeatPatches` — this process's node, the checkout's `tsx`, the seat's env, 90 s, failing soft; composed right after AKShare — and `composedSeatRow` (the row AS COMPOSED, read off the Loader's entries: disabled by a patch, or its service URL and seat name), which `main.ts` hands the seat route so the box follows an operator's patch, never the environment alone |
| `orders.ts` | Gate 2 decision logic, pure: `isOrderTool` (the seat's twelve writes — `SEAT_WRITE_RAW_NAMES` — and any tool under the face's own seat prefix outside `SEAT_READ_RAW_NAMES`), `isSeatWriteTool`, `RETIRED_ORDER_RAW_NAMES` and `isRetiredOrderTool` (`place_order`, `cancel_order` under any server: denied, never carded), `effectiveApprovalPolicy`, `orderApprovalDecision` (with the `displayReason` twin), `describeOrder` (the seat's keys in a readable order; a key field shown whole or the call denied), `hasApprovalGrant`, `orderGuardReason`, `orderGuardReasonForSession` (the guard's one producer; a retired tool denied first; reads `snapshotEvents()`, a distinct denial for an unreadable log), `auditOrderTools` (`{gated, uncovered, retired}`) — depends on nothing (structural types only) |
| `setup.ts` | one-shot `$DSH_HOME/profiles/<name>` creation with `PATCH_HEADER`; refuses to overwrite |
| `http.ts` | `HttpError`, `readBody` (4,096 B cap → 413), `markStale`, the fixed `FORBIDDEN` body, and **the trust fence every `/data` route reuses** — `isLoopbackHost`, `isTrustedDataRequest`, and `isJsonBody` for a POST |
| `static.ts` | `/` behind `IndexAuth` (`ctx.connection.authorizeIndex`) and `/client/*` with a traversal-safe resolver — the one page since stage 2; the `RouteRegistrar` contract |
| `account-proxy.ts` | the Account's reads, push channel and owner writes for the Markets, Trade and Account screens (§4.4; spec `docs/superpowers/specs/2026-10-22-account-graft-design.md` §5.1): `registerAccountProxy(webServer, deps) → {reader, dispose}` mounts twenty `exact` routes — the fifteen reads of `ReadRoute` (`facePath`; stage 2 added `venues`, `reach` at `/data/account/connect/reach`, `keyfile` at `/data/account/keyfile`, and `books` at `/data/account/paper/books`), `/data/account/stream`, `/data/account/stream/markets` and the three writes of `WriteRoute` (`pair`, `prepare`, `exchange` → the Account's `/api/account/pair`, `/api/account/prepare`, `/api/exchange`) — each fence first, then 405; then the fifteen reads' query rebuilt by `rebuildQuery` over `ACCOUNT_QUERY` (the whitelist; a value at most 240 characters decoded, `quotes`' `pairs` 2,000, the request target at most 8,192; `fresh` stripped) or 400, while the two stream routes keep rules of their own (§4.4): `stream` rebuilds `since`, `client` and `markets` under its own bounds (`STREAM_CLIENT`, `markets` 4,000, the browser's `Last-Event-ID` as `since`), and `stream/markets` answers 415 for a body not declared JSON before it refuses any query name with 400; `askAccount` is the plain loopback fetch (no Origin, no `Sec-Fetch-Site`, no cookie, `redirect: "error"`, the route's `ACCOUNT_ABORT_MS` on the headers and the body) answering the Account's status and body or the failure's code (`codeOf`, bounded to `/^[A-Z][A-Z0-9_]{1,31}$/`, else `unreachable`); per route a cache of 2xx answers by rebuilt query (`ACCOUNT_TTL_MS`, `ACCOUNT_CACHE_KEYS` 64, least recently used out first), one flight per query, `?fresh=1` never joining a plain flight; `pipeStream` writes the Account's SSE through chunk by chunk and drops a browser 256 KiB behind; `STREAM_CLIENT`, `STREAM_BODY_LIMIT` (4,096 bytes); the POST routes share `readJsonPost` (fence, 405, 415 for a body not declared JSON, 400 for any query name, then `readBody` under the route's limit, 413 past it) and `postHandler`, which forwards the body as the UTF-8 text it read, with `content-type: application/json`, never parsed, kept, logged or echoed, cut at the route's abort, the Account's status and body back as they are, never kept and never stale — `WRITE_BODY_LIMIT` `pair` 4,096 · `prepare` 16,384 · `exchange` 65,536 bytes, `WRITE_ABORT_MS` 7,000 · 30,000 · 30,000 ms; `disabled` answers 503 everywhere; `reader` is the `account` route's reads, which `main.ts` hands the seat route, and `createAccountReader` the same reads with no route; `dispose` forgets every kept answer and aborts every open stream's upstream |
| `seat.ts` | `/data/seat.json` (§4.4): `seatView` (the Account's `/api/account` reduced to the seat's standing, total over any shape) and `registerSeatRoute` (the fence, then every read through an `AccountReader` — the proxy's, as `main.ts` hands it, else one it makes with `createAccountReader` (`SEAT_TIMEOUT_MS`, 7 s) — keeping no cache and no flight of its own: a 2xx answer served for `SEAT_TTL_MS` (`ACCOUNT_TTL_MS.account`, 15 s), `?fresh=1` never joining a plain read in flight but asking again after it, a failure never kept; `disabled` for a row a patch disabled; the failure's code and never its text) |
| `quotes.ts`, `quote-snapshots.ts`, `quote-types.ts` | the A shares' live quotes on the Markets screen: `/data/quotes` (JSON) and `/data/quotes/stream` (server-sent events), `registerQuoteRoutes`, one shared iFinD poll for every subscribed `cn:` id, a bounded latest-value cache; `QuoteMarket = "cn"`, `QuoteProvider = "ifind"`, `parseInstrumentId` admitting `cn:` and six digits alone — a well-formed `us:` or `crypto:` id from before the graft is answered without a quote (200), anything else 400; no credential reaches the browser |
| `symbol-search.ts` | `/data/symbols/search`, which `registerSymbolSearchRoute` mounts itself (fence, 405, then the search): on-demand A-share search from Tencent (`market` absent, `all` or `cn`; any other — `us` among them — 400), a per-query memory cache, no market directory kept |
| `sessions.ts` | session delete (on disk, cwd-fenced to the repo; the header read from the highest canonical log generation, `pickGenerationLog`) and the reversible archive set with tombstones in `$DSH_HOME/face/archived.json` |
| `roster.ts` | `$DSH_HOME/face/channels.json`, the per-channel agent AND bot rosters: locked, atomic, fail-closed; `roster.log` append, one line kind per roster |
| `channels.ts` | channel = `strategies/<dir>` + workspace-registry identity; reconcile dirs ↔ registry ↔ sessions (durable and live heads, `{header}` snapshots at 0.2); `status.yaml` / `THESIS.md` / `journal.md` readers, and an optional `backtests/` one (an old strategy's; none is written now); create-from-template; five routes — the overview answers `bots` (this channel's roster) and `allBots` (every preset dsh reports) beside the agent roster, and the listing's `presets` maps each session to its header's `agentPreset` (`presetHintsOf`) |
| `agents.ts` | exec recipes for `claude` and `codex` (fixed argv, prompt on stdin, scrubbed env, `--restricted` / `--sandbox read-only`), the spawn runner, the `agent_<bin>` tool with the roster check on execute, tool sync |
| `bots.ts` | bots = `bots/<id>/` directories: `isBotId`, `renderComposition` (the persona text written into the composition), `createBot`, `updateBotSettings`, `updateSoul`, `listBots` (dsh's roster and the face's declaration failures merged in, `broken`/`listed`); four routes, each save calling `onBotChanged` → `redeclare` |
| `bot-presets.ts` | bots as face-declared presets (§3.7): `definitionFor` (the rebased `PresetDefinition`; its rows come from the composition file, or are handed in — the default's, rendered from `roles/`, whose file is then not read), `declareBots` (after boot; `redeclare` serialized per id, `errors`, `ids`) |
| `roles.ts` | the role library (§3.8): `readRoles` (the grammar, the exact-name rule and the never-list, every refusal opening with an absolute path), `toolNameFor`, `gravitRows` (the `gravit` plugin row, then one `dsh-tool-subagent` row per role), `renderGravitComposition` (the mirror's text), `GRAVIT_PLUGIN_URL`, `ROLES_ROOT`; plain data in, plain rows out, nothing mounted |
| `bot-runtime.ts` | a bot HOME session's saved model route on its first request, the journal as a runtime-context snapshot on every request, and `/data/bots/runtime` (a live bot session's mounted persona, model and tools, or its last request's; never resumes one); reads the preset a session RUNS from the `agentPreset` projection (`sessionPresetReader`) |
| `bot-journal.ts` | a bounded, fresh read of one bot's own `journal/notes.md` (12 KiB); never writes |
| `room-rules.ts` | the room's pure rules: `ROOM_CAPS`, `resolveMentions` (by id, by one-token name), `finalTextOf` + `isPass`, `validateDispatch` (names the roster), `dispatchResultText` (names who was not called), `roomLinesOf` + `formatDelta` + `memberPrompt` (the attributed delta and the four standing rules), `roundEndText`, `parseModelRoute`; the `room` message-source vocabulary |
| `room-contract.ts` | the room's optional contracts: the structured `dispatch` brief (`BRIEF_SCHEMA`, bounded) and a member's view block, with the discussion summary; plain prose stays valid |
| `room-projection.ts` | the `room` projection unit: a pure fold of the known events that carry room facts (`dispatch` calls and their `role:'tool'` results, room-sourced messages, turn boundaries) into `{kind, round, members, organizing}`; zod schemas; `stateVersion` (`ROOM_STATE_VERSION` 2) |
| `room.ts` | the engine on the root context: `installRoom` (the `dispatch` tool, the unit, the bus); `RoomEngine` — members created with `ctx.agents.create` (`parentSession`, `agentPreset`, the model ref, `read-only` pinned inside `setup(agentCtx, agent)`) or resumed, and a member whose log dsh 0.2 cannot open is a `failed` turn naming the legacy format, never a crashed round or a silent fresh member; logs read through `eventsOf` (`snapshotEvents()`), failing closed without it; a cold room resumed through `sessionController.resolveAgent`; `driveTurn` with the extending deadline and the hard-cap cancel (`keepInbox`); rounds parallel/serial, peer continuations, the three caps, `settled`/`capped`/`superseded`; answers appended to a quiet room log, the round-end `followup`; `say` (the operator's `@`), `describe`; two routes |
| `persona.ts` | Gravit's deployment persona (`personaPrefix`): `readPersona` validates the strict `{{}}` template and refuses the boot on a bad file |
| `cycle.ts` | Gravit's research-cycle contract (§4.3): `readCycle` reads `dsh/profile/cycle.md` (`CYCLE_PATH`, resolved from the module) — trimmed, braces literal because the section does not interpolate, refused with its absolute path first when missing, unreadable, empty or over `CYCLE_MAX_BYTES` (3,300 raw bytes since 2026-10-24, the limit inclusive); dependency-free |
| `instructions.ts` | the instructions patch (§4.3): `AGENT_INSTRUCTIONS_ROW_ID`, `INSTRUCTION_FILE` and `LOCAL_INSTRUCTION_FILE` (`GRAVIT.md`, `GRAVIT.local.md`), `INSTRUCTIONS_CONFIG` (`satisfies` the package's own `Config`) and `instructionsPatch(inherited?)`, which spreads the inherited row config and applies the two lists last, a fresh object on every call; imports the package's type only |
| `plugins/bot.js` | the `gravit-bot` composition plugin: a scoped `deployment:persona-prefix` section (shadows Gravit's prefix; no suffix) + an allow-list `tools.restrict`, re-expanded after each burst of `tools/change` — coalesced to one timer turn, so a tool that registers after the declaration is admitted when the allow list names it (`expandAllow` resolves `mcp__*__<raw>` against the live tree); dependency-free |
| `plugins/gravit.js` | the `gravit` composition plugin, the first row of the default preset's rendered composition (`gravitRows` in `src/roles.ts`; `bots/gravit/agent.cordis.yml` is its generated mirror): a scoped `deployment:today` section (`Today is YYYY-MM-DD, Weekday (Zone).`), its text a function re-evaluated at every assembly, in the process's own zone — `resolveZone()` falls back to `UTC`, labelled `(UTC)`, when `TZ` is empty or not a zone Intl can format in, so an unusable `TZ` cannot throw at assembly — ordered right after the persona prefix, `interpolate: false`; and, only when its `roles` config is present, a scoped `gravit:roles` section at `getSectionOrder("TOOL_SUBAGENT") + 1` (the role intro and one `- role_<id> — <summary>` line per role, `interpolate: false`, listing only the roles whose tool the assembling scope resolves — `canCall`, `ctx.tools.get(name, context.scope)`, so a role child reads none and a `subagent_fork` child Gravit's whole list, §3.8); only when its `cycle` config is present, a scoped `gravit:cycle` section at `getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 50` (`interpolate: false`; the contract's text when the assembling scope can call `create_goal`, `''` otherwise, §4.3); both sections also `''` for a delegated child that is not a fork (`isRootOrFork`, read from `context.agent.session.header`: no `origin`, or `isSeeded`); `inject` is `systemPrompt` and `tools`, the registry only read, so it masks no tool; `validateGravitConfig` accepts `{}` and checks `cycle` and `roles` when present; dependency-free |
| `panels.ts` | Discover's feeds (§5.3): host facts (`/data/host.json`), the local-agent roster (probe, auth, connect, disconnect), memory (skills), plugins (loader rows + tool schemas); builds `PanelDeps` (it requires `skills`, `tools`, `loader`, `workspaceRegistry` and `agents`), whose `channelFor` answers `{workspaceId, name, dir}` — the `dir` is what the room engine gives a member as its `cwd` |
| `version.ts` | the three pins |

The smokes share one client for the host's wire, `tests/remote.ts`: `mountClient(ctx)` mounts
the real `/` (a bare `bootFace` mounts no page), `signIn` trades the launch token for the cookie,
`remote` / `remoteResult` call `POST /api/<ns>/<method>` with it.

### 4.3 The overlay rows and the policy layer

Thirteen rows, composed last, winning silently over the operator's patch and the home layer —
`faceOverlay(port, definitionFor(bots, "gravit", rows))`, with `rows` rendered from `roles/` and
`dsh/profile/cycle.md` by `composeFace` (§3.8), in this order:

| Row | Package | Why the face mounts it |
|---|---|---|
| `webserver` | `dsh-host-webserver` | `127.0.0.1:<port>`, `compression: none` — loopback-only is the contract |
| `connection` | `dsh-client-connection` | `trustedHosts: []`: the `/api` Host/Origin fence and, since 0.2.0, the browser sign-in (§4.4); its first activation on a home writes the cookie's signing secret into `$DSH_HOME/.credentials.yaml` |
| `api-remotes` | `dsh-api-remotes` | the gateway's only `$events` source: forwards `approval/request` and `user-questions/request` to every connected browser; without it every approval resolves `unavailable` — boot refuses (§4.1) |
| `file-upload` | `dsh-client-file-upload` | provides `fileUploads`, which the session controller hard-injects |
| `workspace` | `dsh-workspace` | the workspace registry the channels, attach and archive run on (§6.4) |
| `session-controller` | `dsh-api-session-controller` | the `session/*` Remotes and the in-process `sessionController` the room engine resumes cold rooms through |
| `workspace-controller` | `dsh-api-workspace-controller` | the `workspace/*` and `directoryPicker/*` Remotes |
| `settings-controller` | `dsh-api-settings-controller` | `credentials/describe`; its `settings/describe` has no service without `profileContext`, and the client does not call it |
| `directory-picker` | `dsh-host-directory-picker-auto` | the native folder dialog; since 0.2.0 it fails the row when either of its two runtime entries cannot load, hence the four picker packages in `package.json` |
| `tool-ask-user` | `dsh-tool-ask-user` | the model-facing half of `userQuestions`, in no upstream bundle; configless = the blocking `legacy` mode |
| `agent-preset-registry` | `dsh-agent-preset-registry` | `{default: gravit}`. The registry scans no directory and serves only `list`, `read` and `select` Remotes, so 0.1.1's `trust: system` posture — no authoring RPCs over a git-tracked directory — holds with nothing to configure |
| `preset-gravit` | `dsh-agent-preset` | the default preset, static so it exists before the first `session/create`: `definitionFor` over the rows `composeFace` renders from `roles/` and `dsh/profile/cycle.md` (§3.8) — the face's `gravit.js` row (the `deployment:today`, `gravit:roles` and `gravit:cycle` sections) by an absolute `file:` URL (`GRAVIT_PLUGIN_URL`), then one `dsh-tool-subagent` row per role; `bots/gravit` supplies only the display metadata, its `agent.cordis.yml` being a generated mirror that is not read (`GRAVIT_PLUGIN_RELATIVE` is how the mirror spells the plugin); it masks no host tool, so Gravit's roster is the host's plus the `role_<id>` tools |
| `preset-kairos` | `dsh-agent-preset` | the legacy alias: the default's definition under `kairos`, Gravit's id before 2026-10-08, so archived sessions resolve; `bootFace` refuses a boot where it is absent or broken; every host test goes through `isHostPreset` (`src/overlay.ts`, `client/speaker.js`) |

Gone from the overlay since 0.1.1: `storage`, `storage-json`, `storage-domain` and
`session-projection-cache` — dsh-base mounts all four, so a patch in the profile file now
REACHES them (a same-id insert here would silently replace base's row and swallow that patch);
`api-gateway` (`dsh-host-apiproxy`, deleted upstream: dsh-base's `typert-gateway` serves `/api`
and the three controller rows carry its business methods); `cordis-host-runner` (its consumers
are not mounted); `agent-presets` (deleted: presets are declarations, §3.7). Web-app's
agent-plane disable set is deliberately not followed: Gravit keeps dsh-base's flat host roster
and gains only the `role_<id>` tools of its preset (§3.8).
A patch of the operator's aimed at an overlay row is accepted, overridden, and never reported
(`PATCH_HEADER` says so where the operator looks); a patch matching no row is also silent —
hence the `rows.has(…)` guards around the switches.

**The persona patch** is `composeFace`'s, not an overlay row: it restates `system-prompt`'s
config as the layers below left it and sets `personaPrefix` from `dsh/profile/persona.md`
(section `deployment:persona-prefix`, order 0 — 0.1.1's `persona`, renamed without moving; the
face sets no suffix), so an operator's `includeRuntimeContext`, `includeHarnessIdentity`,
`personaSuffix` or `toolOrder` on that row survives.

**The instructions patch** is `composeFace`'s too, pushed right after the persona patch. Like the
persona patch it spreads the `agent-instructions` row's config (`dsh-agent-instructions`) as the
layers below left it, then applies the two candidate lists last —
`instructionFileCandidates: ["GRAVIT.md"]` and
`localInstructionFileCandidates: ["GRAVIT.local.md"]` — because a named config replaces the row's
whole config and the candidates must be exactly the face's. `maxBytes: 65536`, dsh-base's own
value, applies only when no layer set one; the three values are `INSTRUCTIONS_CONFIG` in
`src/instructions.ts`, `satisfies` the package's own `Config` (so
`@deepseek-ai/dsh-agent-instructions` is among `face/package.json`'s exact pins). It is guarded on
`rows.has(AGENT_INSTRUCTIONS_ROW_ID)` like the persona patch, so a tree without the row gets no
patch and boot says nothing (`boot.test.ts` pins it on a profile that bundles nothing), and
`instructionsPatch(inherited?)` clones what it is given and returns a fresh object every call
because the include algorithm assigns into rows by reference. The row is host-plane: Gravit, a bot
and a room's member read the same candidates (`instructions-smoke`, `room-smoke`). An operator's
patch aimed at the row is accepted, and only the two lists are overridden, silently:
`projectRootMarkers` (the fix that lets a checkout with no `.git` read the root `GRAVIT.md` at
all), `maxSourceBytes`, `dshHome`, a `maxBytes` of their own and `disabled` all survive —
`disabled` because the include assigns only the keys a patch carries. `PATCH_HEADER`
(`src/setup.ts`) says so where the operator looks ("its two candidate lists are the face's:
GRAVIT.md and GRAVIT.local.md; every other key of yours and disabled are kept"). The user-global
`$DSH_HOME/AGENTS.md` is a name hard-coded upstream, which the patch neither renames nor
suppresses; the operator's home has none (checked 2026-10-18).

**The cycle section** is a key of the default preset's `gravit` row, not a patch or an overlay
row. `composeFace` reads `dsh/profile/cycle.md` with `readCycle` (`src/cycle.ts`) right after
`readRoles` and hands the text to `gravitRows` as the row's `cycle`; `FaceBootOptions.cyclePath`
points a test at a fixture, and a missing, unreadable, empty or oversized file (over
`CYCLE_MAX_BYTES`, 3,300 raw bytes since 2026-10-24) ends the compose with its absolute path first.
`plugins/gravit.js` mounts the text as `gravit:cycle` at
`getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 50` — 10150 on the pinned dsh, whose suffix is
10200: after every dsh-ordered tool and policy section, just before the persona suffix — with
`interpolate: false`, so a brace in the file is literal prose and not a template group
(`cycle.test.ts` pins that braces are allowed). The section is scoped to the preset revision, so
a bot, which is its own preset, never sees it, and its text is a function of the assembly
context, gated like the roles list (§3.8): the contract when the assembling scope can call
`create_goal` (`canCall`) and the session is a root or a fork (`isRootOrFork`), `''` otherwise,
which dsh drops. Gravit's sessions resolve `create_goal`; a `subagent_fork` child, restricted by
nothing, does too and reads the identical text, so the prefix its inherited history was cached
under stays byte for byte; a plain `subagent`, workflow or ralph child resolves it as well but is
a delegated child that is not a fork, so it reads nothing (§3.8); a role child's allow list can
never name a goal tool (the never-list, §3.8), so the face's contract is withheld from it — dsh's
own global `tool:goal` paragraph still reaches every child, as the other generic tool-policy
paragraphs do (§3.8).

The file is the only place that tells Gravit how to run a cycle — 3,161 bytes against its 3,300
since the operator-approved rewrite of 2026-10-24 (the cap rose from 3,000 with it; it is the face's
own bloat guard, not a dsh limit), which keeps the goal facts the installed goal packages allow (most
pinned by `goal-smoke`, §7.3): one cycle, in the strategy's channel session (whose cwd is the
strategy directory); Step 0, one batched `ask_user_question` before any code unless the brief
already answers it — the thesis, the falsification terms, the paper venue and the window the
forward trade runs over, what the operator wants measured; `create_goal` with `max_goal_rounds` 24
— refused while a goal that is not complete exists, so a new idea takes a new channel session —
after which dsh's round driver prompts Gravit again at idle until it completes or blocks the goal;
`get_goal` for the id and revision `update_goal` needs; after a restart or an errored or max-tokens
round the goal is only disarmed and "continue" re-arms it (`update_goal` `resume`), while the
face's Stop during a round pauses it and only the operator's `/goal resume` reopens it (R30);
rounds in which Gravit itself reads the Account through the seat (`mcp__account__portfolio_*`) and
AKShare, places a forward paper trade on the paper venue the operator granted, waits for the fill
and the statement, and journals every result as a dated entry with the Account's own figures and
the order ids — nothing is backtested, no read is guarded against lookahead, and no role is called;
no commit inside the rounds (a commit from the channel session raises an approval card, §3.3); in
round 24 with the terms undecided, the researching verdict, since the driver then blocks with
`round-limit` and prompts nothing more; the verdict in `status.yaml`, the goal completed only on
`validated` or `retired` (`complete` also accepts a blocked goal and would erase its blocker: a
researching verdict's record is the blocked goal), the journal's last entry ending in a usage line
the operator copies from the session-usage card (nothing the model sees carries usage); the
blocking vocabulary (`venue-window`, `data-missing`, `needs-operator`), and an answer given inside
a round as a tool result, not the operator's turn; and one cap, 24 rounds, enforced by the goal.
It names no role tool, and `cycle.test.ts` would catch one it named that the library does not ship.
No face code drives a round. The gate is silent when the tool
goes away: a profile patch that disables dsh-base's `tool-goal` row makes `create_goal`
invisible, so the section vanishes from Gravit's prompt and the boot says nothing — the same
silence as the roles section when a role's tool never registered, as with no `spawn` provider
(§3.8) — and with `goal-round-driver` disabled the section stays while nothing re-prompts a
round. Pinned by `tests/cycle.test.ts` (the shipped file's size, steps, cap and vocabulary; that it
names no role and runs on a forward paper trade; the reader's refusals, the cap on raw bytes, em
dashes included), `gravit-plugin.test.ts`
(order, literalness, the gate on both halves, unload), `boot.test.ts`, `roles.test.ts` (the mirror
carries the text) and, on real boots, `bots-smoke`, `roles-smoke` and `goal-smoke` (§7.3).

**The policy layer** (`src/policy.ts`) composes directly above the bundle layer and BELOW
AKShare, the profile and the home, so an operator row with the same id wins — the opposite of
the overlay, on purpose: these are defaults, not the face's contract. Each row restores a 0.1.1
posture dsh-base 0.2.0 changed, and each is an operator decision (§4.8):

| PLAN | Row(s) | Policy | dsh-base 0.2.0 on its own |
|---|---|---|---|
| D3 telemetry | `session-telemetry-otel` | disabled | `FEEDBACK_ONLY`: a session-log prefix uploaded after `/feedback`, with `.anonymous-user-id` |
| D4 session-log upload | `session-log-deepseek` | disabled | up to 8 MiB of session events on every DeepSeek request |
| D5 package inventory | `plugin-package-inventory-deepseek` | disabled | the active package list on every DeepSeek request |
| D6 `web_fetch` | `tool-web` `{fetch: false, searchTimeoutMs: 60000}`, `web` `{searchProvider: deepseek-official}`, `web-fetch-http` disabled | 0.1.1's values, each config written out in full | `web_fetch` on |
| D7 MCP resource tools | `mcp-resources` | disabled | three model-facing tools and a prompt section |
| D9 `ralph` | `tool-ralph` | `disabled: false`, base config kept | disabled |
| D9 `str_replace_editor` | `tool-str-replace-editor` | inserted, configless (0.1.1's 16,000-character cap is now the default) | row removed |

`facePolicyPatches` guards every id patch on the row being in the bundle composition and
reports a missing target on stderr (`gravit-face: warning: policy D…`); `tests/policy.test.ts`
pins every target against the installed dsh-base. Overriding one is a row in
`profiles/face/cordis.patch.yml`: `- id: session-log-deepseek` / `disabled: false` restores the
upload; `web_fetch` takes `- id: tool-web` / `config: { fetch: true, searchTimeoutMs: 60000 }`
plus re-enabling `web-fetch-http` and restating `web` with `fetchProvider: http`.
`DSH_TELEMETRY_DISABLED` still wins over an operator's telemetry re-enable: its patch composes
after the operator layers. Outside the layer, and undecided (PLAN D18): dsh-base's spill budget
moved from `maxInlineBytes: 50000` to `maxInlineTokens: 12500` (§9, R27).

**The first request, measured.** The instrument is the projection cache: after a session's first
request, `$DSH_HOME/storages/session_projcache/sessions/<id>.json` holds its `contextBreakdown`
row in heuristic tokens and, beside it, `tokenUsage`, the provider's own usage samples (the billed
count, which differs). `<id>` is the session's `session-<uuid>`, the name of its directory under
`$DSH_HOME/sessions/<project-slug>/` — the newest by mtime right after the prompt, as the cycle
drill's step 5 finds it. Sizes recorded now, from the shipped files at stage 3 of the Account graft
(2026-10-24): `dsh/profile/cycle.md` is 3,161 bytes, ≈ 790 heuristic tokens at four bytes a token
(at `fae4f61` it was 2,985 bytes, ≈ 747, against the 1.5 KB the design spec estimated in its §7);
the `gravit:roles` section is empty, since no role ships (for the three that did it was 992
characters, about 250 tokens; each role adds its tool name and a summary of at most 300
characters); `GRAVIT.md` is 3,300 bytes (budget 4,500; 4,283 at `fae4f61`). The first-request totals
are the operator's to take, in one sitting — plan 1's, plan 3's and a role child's — on the real
face with its keys:

| First request | Expected (system · messages · tools) | Measured (`contextBreakdown`, with `tokenUsage` beside it), with date and session id |
|---|---|---|
| Gravit's, 2026-10-10 (the go-live smoke session, before the redesign) | — | 1,622 · 4,040 (3,443 of it the `AGENTS.md` + `CLAUDE.md` baseline) · 32,003; DeepSeek billed 55,635 input tokens |
| Gravit's, a one-word session in the repo root: plan 1's measurement, taken once the branch has merged (`<id>`: the newest `session-<uuid>` directory under `$DSH_HOME/sessions/<project-slug>/` after the one word, as the cycle drill finds its own) | messages well under 4,040 (`GRAVIT.md` ≈ 1,070 tokens for the 3,443 baseline). Plan 1's own system and tools clauses (the date line only; unchanged) were written before plans 2 and 3 and no longer hold: read them against the next row | not yet measured |
| Gravit's, the first request of the cycle drill (`face/README.md`, step 5): the composition after stage 3 | ≈ 2,420 · ≈ 1,650 · ≈ 46,000 (system: the 2026-10-10 1,622 plus the cycle ≈ 790 and the date line ≈ 12, no roles list; messages: spec §7's ≈ 1,900 less the smaller `GRAVIT.md`; tools: the host's, AKShare's and the seat's groups priced below, no role tool) | not yet measured |
| one role child's | — | none ships; taken when the operator writes one |

Plan 1 specified its one-word session for after the branch merges, so with plans 2 and 3 landed
first the two Gravit rows are the same composition seen from two sessions.

**The tool-schema block, attributed** (R31). The block is the largest part of the first request;
`face/scripts/schema-sizes.ts` prices it per tool. It boots the face's own composition on a COPY of
a harness home with the MCP rows as the copy mounts them, opens one Gravit session and prints what
`tools.schemas(agent)` returns for it — one line per tool, largest first, then a line per prefix
group and the total — in two units: `chars/4`, dsh's own heuristic (the UTF-16 length of the JSON
over four: the unit of the 2026-10-10 figure and of `contextBreakdown`), and `bytes/4`, which
reads higher wherever the text is not ASCII. The same session's prompt assembly
(`systemPrompt.assemble`) carries the same tools with identical JSON (compared on the first,
43-tool run), so these are the objects the request carries. The script refuses the default live
home, `~/.dsh` — the path itself, inside it or above it, through a symlink or in another letter
case, by device and inode after both paths are canonicalized (`face/tests/schema-sizes.test.ts`)
— with exit 2, before any dsh plugin loads; a live home set elsewhere is not detected (below).
Measured 2026-10-19 at `fae4f61`, on a scratch home made by `setupFaceProfile` with two MCP rows:
the face's own `mcp-akshare` (`akshare-mcp` 0.1.0 by `uv tool list` — the git revision
`9b6a22b` that `face/README.md` "AKShare MCP" installs, over akshare 1.18.94 and `mcp` 1.30.0 —
started: 13 tools covering 1,090 functions, plus `akshare_discover`) and the operator's row for
the Alpaca server of the time, keyless, whose seven keyless read tools registered. Both that
server and the three roles left the tree on 2026-10-24; their two rows below are the record of
what they cost, and the block today is the host's 26, AKShare's 14 and the seat's 35 — 75 tools,
≈ 46,010 chars/4 (5,857 + 24,426 + 15,727), summed from the runs below, not re-measured together.
The host, AKShare and `role_` group totals equal the first run's to the byte (at `5a7e69d`,
without the Alpaca row):

| Group | Tools | Bytes | bytes/4 | chars/4 |
|---|---|---|---|---|
| `mcp__akshare__` | 14 | 134,452 | 33,613 | 24,426 |
| `mcp__account__` — the Account seat, its own run of 2026-10-20 (AKShare off, no service to reach; not in the total below) | 35 | 63,221 | 15,806 | 15,727 |
| the host's own | 26 | 23,468 | 5,867 | 5,857 |
| `role_` (Gravit's preset; the three retired roles) | 3 | 2,750 | 688 | 685 |
| the retired Alpaca server, keyless: `screen`, `market_snapshot`, `corp_actions`, `daily_bars`, `earnings`, `calendar`, `breadth` | 7 | 2,613 | 654 | 654 |
| `agent_` | 0 | 0 | 0 | 0 (no CLI agent is rostered in a scratch home) |
| measured total | 50 | 163,283 | 40,821 | 31,620 |

The five largest tools are all AKShare's (bytes · bytes/4 · chars/4): `akshare_stock_a`
25,727 · 6,432 · 4,435; `akshare_macro` 23,081 · 5,771 · 3,886; `akshare_futures` 15,641 · 3,911 ·
3,253; `akshare_fund` 11,173 · 2,794 · 1,913; `akshare_index` 9,135 · 2,284 · 1,661 — together
15,148 chars/4, 48% of the measured block. The largest tool outside the group is `workflow`
(3,405 · 852 · 848), then `str_replace_editor` and `bash`; the Alpaca server's largest was
`screen` (476 · 119 · 119). **The 2026-10-10 hypothesis — AKShare's fourteen tools dominate — held
on what was measured:** 77% of the measured tokens, against 19% for the host's 26 tools, 2% for the
three `role_*` tools and 2% for the Alpaca server's seven keyless tools. Against the 2026-10-10
figure of 32,003, the groups that request also carried — the host's, AKShare's and those seven —
came to 30,937, the remaining 1,066 that server's keyed account tools plus whatever the host's
roster had gained or lost: a residual, never measured, and moot since the server left.

**The Account seat's block**, measured on 2026-10-20 on a scratch home of its own (`setupFaceProfile`,
`mcp-akshare` disabled, the seat row pointed at a checkout of buyer-agent-demo @ 133b9a7 with
`FACE_ACCOUNT_URL=http://127.0.0.1:4` — no service: the seat registers its real-account tools all the
same): 35 tools, 63,221 bytes, 15,806 bytes/4, 15,727 chars/4 — 64% of AKShare's 24,426, and the
second-largest group the prompt can carry. Its six largest (bytes · bytes/4 · chars/4):
`portfolio_live_preview` 5,347 · 1,337 · 1,332; `portfolio_live_order` 4,987 · 1,247 · 1,244;
`portfolio_explore` 4,106 · 1,027 · 1,019; `portfolio_live_move` 3,432 · 858 · 854; `portfolio_account`
3,374 · 844 · 838; `portfolio_live_batch` 3,194 · 799 · 797 — four of them larger than `workflow`.
With AKShare and the seat mounted and nothing else, the heuristic block reads about 46,010
chars/4 (R35).

The two units part by 9,187 tokens on the AKShare group alone: its JSON holds 18,375 non-ASCII
characters (18,211 of them CJK ideographs) among some 97,700, and the heuristic prices every UTF-16
unit at a quarter of a token. On 2026-10-10 DeepSeek billed 55,635 input tokens for a request the
heuristic put at 37,665 (1,622 + 4,040 + 32,003), 48% more; how much of that gap is this group is
not measured, and one request with the row disabled, read in billed tokens, would say.

The live composition — AKShare and the seat together, the seat against the real service, and
`agent_` if a CLI agent is rostered — is the operator's run, in the shell the face starts from, and
sends no prompt. The guard knows
only the default `~/.dsh`: if your live home is elsewhere (a `DSH_HOME` your shell exports, which
the command line below overrides), nothing refuses it, so copy THAT home and point `DSH_HOME` at
the copy. A copy holds `.credentials.yaml` and every session log, hence the last line:

```bash
SCRATCH=$(mktemp -d)
cp -a ~/.dsh "$SCRATCH/dsh-sizes"
cd face && DSH_HOME="$SCRATCH/dsh-sizes" npx tsx scripts/schema-sizes.ts | tail -8
rm -rf "$SCRATCH/dsh-sizes"
```

`tail -8` is the group lines, the total and the smallest tool; a group that reads 0 tools means
its row did not connect (stderr says why). Done when the table carries one live run of the two
groups together, with a date (§10, item 15).

### 4.4 Route table

All face routes register on dsh's webserver as `exact` or `prefix`; a duplicate `(kind, path)`
throws, and the fallback seat is left empty. dsh's own surface is the `connection` row's
`prefix /api` — the Typert gateway's unary Remotes, `POST /api/<ns>/<method>`, and the gate
answer `POST /api/$events/result` — and the upgrade seat `/api/remote.mux`, which the gateway
registers only once `appReady` commits (§4.1). Both pass Connection's admission: the Host/Origin
fence (403: a loopback `Host`, and a same-origin `Origin` when one is sent), then the signed
browser-session cookie (401). The cookie — `dsh-auth-<hash of the authority>`, `HttpOnly;
SameSite=Strict; Path=/`, 30 days, bound to the exact `host:port`, so `127.0.0.1:3090` and
`localhost:3090` are two sign-ins — is minted in one place: `GET /?token=<launch token>`
through `authorizeIndex`, answered `303 ./` + `Set-Cookie`. The launch token is new on every
start and appears only in the printed URL; the signing secret persists in
`$DSH_HOME/.credentials.yaml`, so a cookie outlives restarts.

**The fence** (`isTrustedDataRequest` in `http.ts`, every `/data` route): loopback `Host`
(`isLoopbackHost`: `localhost`, `127.x.x.x`, `[::1]`; missing or unparsable → refuse) AND
`Sec-Fetch-Site ≠ cross-site` AND (`Origin` absent OR its host equals `Host`). Refusal is the
fixed `FORBIDDEN` string, echoing nothing. `/data` takes no cookie (PLAN D8). POST shells add 405
for other methods, 415 for a non-JSON content type, 400 for an unparsable body (the sessions and
panels shells also 400 a valid-JSON non-object; the channels shell reads one as `{}` and answers
by route: 404 `no such channel`, or 400 `invalid channel name`), 413 over 4,096 bytes. A request
with no `Origin` passes on `Host` alone — `curl` works, which is residual R3 in §9.

| Route | Module | Does |
|---|---|---|
| `GET /` | `static.ts` | the sign-in and the app page (gravit-ui, §5): `authorizeIndex` first — a valid `?token=` is answered `303 ./` with the cookie, a cookie gets `index.html`, anything else a 401, and on a refusal the face writes nothing itself |
| `/client/*` | `static.ts` | the client's assets; public (PLAN D8), no cache headers; path containment on the resolved absolute path. `/market` and `/account` left with stage 2 (Markets and Account are screens of the client at `/`) and reach no route: 404 |
| `GET /data/account`, `/data/account/explore`, `/market`, `/quotes`, `/compare`, `/candles`, `/holdings`, `/positions`, `/statement`, `/history`, `/agents` | `account-proxy.ts` | Linqi's Account's own reads (`GET /api/account`, `GET /api/account/<route>`) for the Markets and Account screens (§5.3), at the URL of the `mcp-account` row AS COMPOSED (`composedSeatRow`; `FACE_ACCOUNT_URL`, default `http://127.0.0.1:4820`, when no row is composed); each an `exact` route, so the table is the allow-list. Fence first (403), then 405 for any method but GET, then the query rebuilt from the route's names in `ACCOUNT_QUERY` — `account` `fresh`; `explore` `tab`, `q`, `key`, `limit`; `market` `venue`, `symbol`; `quotes` `pairs`; `compare` `base`, `side`, `usd`, `asset`; `candles` `venue`, `symbol`, `interval`, `range`, `before`, `limit`; `holdings` `cost`, `paper`, `fresh`; `positions` `venue`; `statement` `fresh`; `history` `range`, `paper`, `venue`; `agents` `fresh` — in the order they came, each once, a value at most 240 characters decoded (`pairs` 2,000), the request target at most 8,192, `fresh=1` the face's own flag and never forwarded; anything else is 400 `invalid account request` with nothing asked. A disabled row answers 503 `{"ok":false,"unreachable":"disabled"}` and asks nothing. Then the route's cache — `ACCOUNT_TTL_MS`: account 15 s, explore 20 s, market and quotes 3 s, compare 15 s, candles 30 s, holdings 8 s, positions 10 s, statement 10 s, history 60 s, agents 15 s; only a 2xx answer kept, by rebuilt query, at most 64 a route, the least recently used out first; reads of one query share one fetch, and `?fresh=1` skips the TTL and never joins a plain flight — then a plain loopback `fetch` (no Origin, no `Sec-Fetch-Site`, no cookie, `redirect: "error"`; `ACCOUNT_ABORT_MS` on the headers and the body: 7 s, explore 10 s, holdings and history 12 s, candles 25 s). The Account's status and body pass through unparsed as `application/json` with `no-store`; a fetch failure is 503 `{"ok":false,"unreachable":"<CODE>"}` (`ECONNREFUSED`, `timeout`, `unreadable`, `unreachable` for a code-less error) — never its text — or the query's last kept answer re-served flagged `stale: true`. The screens read nine of the eleven: `market` and `positions` have no reader yet |
| `GET /data/account/stream?client=&since=&markets=` | `account-proxy.ts` | the Account's push channel (`GET /api/account/stream`), piped: fence, GET only, the query rebuilt from `since` (≤ 240), `client` (required, `STREAM_CLIENT`: 8–48 of `[A-Za-z0-9_-]`) and `markets` (≤ 4,000), each once — the browser's `Last-Event-ID` (≤ 240), when it sends one, is the `since` passed on in place of the query's, as the Account reads it — else 400; a disabled row 503 `disabled`. One upstream request per browser connection (`accept: text/event-stream`, `redirect: "error"`): the Account's 200 written through chunk by chunk under the face's SSE headers, never buffered, re-framed or read, the response ended when the Account ends it; aborted when the browser's response closes or errors, when the browser falls 256 KiB behind (the response then destroyed, as `quotes.ts` does) and on `dispose`; any other answer is the Account's status and body (its refusal past 32 streams among them), a fetch failure 503 with its code; never kept |
| `POST /data/account/stream/markets` | `account-proxy.ts` | the markets a tab's stream follows (`POST /api/account/stream/markets`): fence, POST only (405), 415 for a body not declared `application/json`, 400 for any query name (both before the body is read), the body read under `STREAM_BODY_LIMIT` (4,096 bytes, else 413) and posted as it came with `content-type: application/json` under a 7 s abort — never parsed, kept or echoed; a disabled row answers `disabled` once the body is read; the Account's status and body come back as they are |
| `GET /data/account/venues`, `/data/account/connect/reach?connector=`, `/data/account/keyfile?kind=&venue=&ref=&exchange=`, `/data/account/paper/books` | `account-proxy.ts` | the stage-2 reads behind the owner's Connect an account and Open a paper account (`GET /api/account/venues`, `/connect/reach`, `/keyfile`, `/paper/books`; `ReadRoute` `venues`, `reach`, `keyfile`, `books`), under every rule of the eleven above: `venues` takes no query name (never the Account's `force`), `reach` `connector`, `keyfile` `kind`, `venue`, `ref`, `exchange`, `books` none; TTL `venues` 60 s, the other three 5 s; abort 30 s each (a cold catalog or reach probes every venue). `keyfile` answers a path and which fields are there or missing, never a value |
| `POST /data/account/pair`, `/data/account/prepare`, `/data/account/exchange` | `account-proxy.ts` | the owner device's three writes (`WriteRoute`; the Account's `POST /api/account/pair`, `/api/account/prepare`, `/api/exchange`): the `stream/markets` rules — fence, POST only (405), 415 for a body not declared `application/json`, 400 for any query name, the body read under `WRITE_BODY_LIMIT` (`pair` 4,096 · `prepare` 16,384 · `exchange` 65,536 bytes, else 413) and forwarded as the UTF-8 text read, with `content-type: application/json`, under `WRITE_ABORT_MS` (7 s · 30 s · 30 s: a prepare quotes at the venue, an exchange places there) — never parsed, kept, logged or echoed, so the pairing code and the signed envelope pass through the face once and leave no trace; the Account's status and body come back as they are, never kept and never served stale; a fetch failure 503 with its code; a disabled row `disabled` once the body is read. The face holds no key, mints no envelope and signs nothing: the browser does (§5.3, `host/owner.js`) |
| `GET /data/seat.json` (`?fresh=1`) | `seat.ts` | the Account seat's standing (§3.1) at the URL and under the seat name of the `mcp-account` row AS COMPOSED (`composedSeatRow`: an operator's patch counts, and a disabled row answers `reachable: false, error: "disabled"` with no read at all): fence first, then the Account's own `GET /api/account` read through the proxy's `account` reader (`registerAccountProxy`'s `reader`, which `main.ts` hands the route; a route handed none makes its own with `createAccountReader`), so `/data/seat.json` and `/data/account` share one upstream read: a 2xx answer served for `SEAT_TTL_MS` (15 s, `ACCOUNT_TTL_MS.account`), `?fresh=1` skipping it and never joining a plain read in flight — it asks again once that one settles, so the read after a receipt sees the card the receipt announced; plain reads share one fetch, fresh reads share one — and a failure never kept; the read itself is a plain loopback `fetch` (7 s abort on the headers or the body, `redirect: "error"`, no Origin — the Account's fence answers a bare local request); the answer reduced by `seatView` to the service, its mode and writes, the seat by the name the owner typed (`absent` · `knocking` · `admitted` · `expired` · `revoked` · `unknown`) with its limits and what is left of them, the venues with the paper ones marked and the stale ones flagged (the Account's `stale` is its words, or `true`), this seat's cards and the others' count; an unreachable, refusing, hanging or unreadable service is `reachable: false` with the failure's CODE (`ECONNREFUSED`, `http 403`, `timeout`, `unreadable`), never its text, and nothing is served stale; touches no key and no home |
| `GET /data/symbols/search?q=&market=` | `symbol-search.ts` | A-share search from Tencent's smartbox, cached per query in memory: fence (403), GET only (405), `q` once (at most 80 characters, 240 bytes), `market` absent, `all` or `cn` — any other, `us` and `crypto` among them, is 400 `invalid market` |
| `GET /data/quotes?ids=`, `/data/quotes/stream?ids=` | `quotes.ts` | the selected `cn:` ids' live quotes from iFinD (at most 100), as JSON or as server-sent events; empty selections reach no upstream; a well-formed `us:` or `crypto:` id from before the graft is answered without a quote (200, `providers` iFinD alone), any other id 400 |
| `GET /data/channels.json` | `channels.ts` | **reconciles on every GET**: registry `create` per directory, `attachSession`, `seedRoster`; returns `{root, channels, ungrouped, archived, presets}` — `presets` maps a session id to its header's `agentPreset`, the client's fallback where a 0.2 list row names none |
| `POST /data/channels/overview` `{workspaceId}` | `channels.ts` | reconcile + `status.yaml`, thesis, the whole journal newest-first (the channel page draws the newest 20), an old strategy's `backtests/` newest-first with the newest dated one parsed as `latest` (empty when the directory is absent, as it is for every strategy since 2026-10-24), file list, roster |
| `POST /data/channels/agents` `{workspaceId, agents[]}` | `channels.ts` | `setRoster` → `channels.json` (409 on a corrupt file), then a dated line to `roster.log` and stdout |
| `POST /data/channels/bots` `{workspaceId, bots[]}` | `channels.ts` | `setBots` → `channels.json` (`bots[]` beside `agents[]`; 400 an id outside the bot grammar or more than `ROOM_CAPS.maxMembers` ids, 404 no such channel, 409 a corrupt file), then a dated `bots` line to `roster.log`. The overview answers `bots` (the roster) and `allBots` (every preset dsh reports, `broken` reasons included) |
| `POST /data/channels` `{name}` | `channels.ts` | `NAME_RE` + NFC; copies `_template` (409 if exists); a reconcile failure after the copy is a warning, not a 500 — the directory exists and a 500 would make the retry 409 |
| `GET /data/sessions-meta.json`; `POST /data/sessions/archive`, `/delete` | `sessions.ts` | the archive set (409 on un-archiving a host-archived id: the face does not un-archive host archives, PLAN D14 — the host can, but a host-archived session runs no model step until restored); delete reads the session header's `cwd` from the first zstd frame of the highest canonical log generation (`session.v4.jsonl.zstd` over a 0.1.1 `session.jsonl.zstd`; `.zstd` wins a tie; the lock and temps never count) and `rm -rf`s **only if it is inside the repo root** (ids are unique across every project under `$DSH_HOME/sessions`); an unreadable header is a 404, never "safe" |
| `GET /data/host.json` | `panels.ts` | `{cwd, home, attachedSessions, version}`: the host facts 0.1.1's `host.describe` gave (dsh 0.2 has no such Remote); `version` is `DSH_PIN` |
| `GET /data/memory.json`, `POST /data/memory/skill` | `panels.ts` | the skill catalog grouped by pack; one skill's content |
| `GET /data/plugins.json` | `panels.ts` | loader rows with their phase (config never serialized) + `mcp__*` / `agent_*` tool schemas |
| `GET /data/agents.json`; `POST /data/agents/connect`, `/disconnect`, `/rescan` | `panels.ts` | probe fifteen known CLIs (`--version` 3 s, auth 10 s, 60 s cache); connect writes `agents.json` and registers `agent_<bin>` live; disconnect disposes it |
| `GET /data/bots.json` | `bots.ts` | every directory under `bots/` in the id grammar, `listBots` merging dsh's roster and the face's declaration failures in: `broken` carries dsh's reason or the face's, `listed:false` marks a directory the roster did not report |
| `POST /data/bots` `{name?, id?, description?, soul?, model?}` | `bots.ts` | `createBot`: id = the one given or `proposeBotId(name)`; copies `_template` and writes `preset.yml`, `SOUL.md` and the rendered composition, then re-declares. 400 an id outside the grammar or reserved, 400 a soul carrying `{{` or empty, 409 the directory exists (never overwritten), 500 `_template` missing. The returned row reads `listed:false` — it is built without the roster, which is re-read on the next GET |
| `POST /data/bots/settings` `{id, name?, description?, model?, soul?, revision?}` | `bots.ts` | `updateBotSettings`: a partial update — every value validated and every file staged before any is replaced, 409 when `revision` is not the saved one — then re-declares |
| `POST /data/bots/soul` `{id, soul}` | `bots.ts` | the older soul route, through the same update. All three POSTs take a 64 KiB body cap, not the shared 4,096 B — a soul is prose — and answer 500 `bots/<id> was saved, but the running face could not re-declare it …` when the re-declaration fails |
| `GET /data/bots/runtime?id=&sessionId=` | `bot-runtime.ts` | an attached bot session's mounted persona, model, tools, skills and journal snapshot (the last request's facts while a turn runs); a cold one is reported unattached, never resumed |
| `POST /data/rooms/say` `{sessionId, text}` | `room.ts` | the operator's `@`: mentions resolved against the roster (by id, by one-token display name); nobody named → `addressed: []` and the client sends an ordinary prompt; else the message is appended to the room as the operator's own (never a prompt), a cold room is resumed through `sessionController.resolveAgent` — the host's own composition, model selection and preset join — and each named member turns. 400 a bad id or empty text, 404 not in a channel or `session/not-found`, 409 a corrupt roster or any other resolve failure, with dsh's code and message and, when the log predates dsh 0.2, the legacy-format note |
| `POST /data/rooms/state` `{sessionId}` | `room.ts` | the roster, the members the engine drove this boot, the caps left; never resumes |

### 4.5 Persistent state the face writes

| Path | Writer | Note |
|---|---|---|
| `$DSH_HOME/profiles/<profile>/cordis.yml` | `composeFace` | rewritten to `[]` every boot; edit `cordis.patch.yml` |
| `$DSH_HOME/profiles/<profile>/{package.json, cordis.patch.yml, pnpm-workspace.yaml}` | `setupFaceProfile` | only when the profile *directory* is absent; an existing directory is left untouched even if one of the three files is missing |
| `$DSH_HOME/.credentials.yaml` | the `connection` row the face mounts | a `client-connection/browser-session` grant — the cookie's signing secret — written by the first boot on a home; the 0.1.1 CLI still reads the file's keys past it |
| `$DSH_HOME/storages/**` | dsh-base's storage rows | workspace registry records (`registry.create`, `attachSession`) |
| `$DSH_HOME/storages/session_projcache/sessions/<id>.json` | dsh-base's projection cache | one checkpoint record per session, written behind the log and throttled by `writeEveryEvents: 200` / `writeIntervalMs: 5000`; what `session/list` reads for a cold session's projections; bootstrapped once from 0.1.1's single `session_projcache.json`, which stays in place |
| `$DSH_HOME/sessions/<slug>/<id>/session.v4.jsonl.zstd`, `session.lock` | dsh's session persistence | published by a session's first WRITE-open under 0.2.0 — a prompt, a command, a fork, a room turn, any resume — beside a 0.1.1 `session.jsonl.zstd`, which stays byte-identical; never rolled back. A read-open migrates in memory and writes nothing, and opening a cold session in the chat pages it without activating it (§5.4) |
| `$DSH_HOME/face/archived.json` | `sessions.ts` | `{archived[], deleted[]}`; plain write |
| `$DSH_HOME/face/channels.json` | `roster.ts` | `{version:1, channels:{<wsId>:{agents[], bots[]}}}`; file lock + atomic write, mode 0600; the one file that needs a cross-process lock because the reconcile writes on GET |
| `$DSH_HOME/face/roster.log` | `roster.ts` | append-only, one dated line per operator roster write |
| `$DSH_HOME/face/agents.json` | `panels.ts` | `{connected:[{bin,label}]}` |
| `$DSH_HOME/sessions/<slug>/<id>/` | `deleteSession` | removed with every generation, the lock and the temps, cwd-fenced |
| `strategies/<name>/` | `createChannel` | copied from `_template`, never overwritten |
| `bots/<id>/` | `createBot`, `updateBotSettings`, `updateSoul` | copied from `_template`; `preset.yml`, `SOUL.md` and the composition's persona row rewritten together, staged then renamed; never overwritten by create |
| `bots/<id>/journal/` | a bot's HOME session | workspace-write, cwd = the journal; the only directory a bot writes (the write to `../SOUL.md` is refused, proven in `room-smoke`) |
| `roles/<id>/` (`ROLE.md`, `role.yml`) | the operator | not written by the face — read once per boot by `composeFace` (`readRoles`) and rendered into Gravit's preset (§3.8); a missing roles directory or a malformed role refuses the boot |
| `bots/gravit/agent.cordis.yml` | `npm run render:roles` (the operator runs it) | the generated mirror of that render, for readers; the face composes nothing from it (`listBots` hashes it into the row's `revision` and parses nothing), and `tests/roles.test.ts` fails while it differs from the render |
| `dsh/profile/persona.md` | the operator | not written by the face — read by `composeFace` into `system-prompt`'s `personaPrefix`, and a malformed template refuses the boot |

Not written any more: `$DSH_HOME/profiles/node_modules`, 0.1.1's module link farm (a stale one
answers only for a row outside the face's closure, §3.1; PLAN D13). Never written by the face:
`$DSH_HOME/settings.yaml` (PLAN D1).

Deleting a session does **not** detach it from its channel: `deleteSession` removes the
persistence directory and tombstones the id but never touches the registry, although in-process
the workspace entity does expose one (`WorkspaceEntity.detachSession`, reachable through
`ctx.workspaceRegistry.list()`; not a registry method, not a Remote, and not declared by the
face's `WorkspaceLike`). Recorded, not fixed.

### 4.6 Environment

| Variable | Read by | Default | Effect |
|---|---|---|---|
| `FACE_PORT` | `main.ts` | `3090` | `"0"` asks the OS; `""` means default |
| `FACE_PROFILE` | `main.ts`, `setup.ts` | `face` | honored by both `setup` and `start` |
| `FACE_AKSHARE_MCP_COMMAND` | `akshare.ts` | `~/.local/bin/akshare-mcp` | the AKShare server's executable |
| `FACE_ACCOUNT_SEAT_DIR` | `account-seat.ts` | `~/buyer-agent-demo` | the installed checkout of Linqi's Account (buyer-agent-demo, `npm ci` there) the seat process runs from |
| `FACE_ACCOUNT_URL` | `account-seat.ts` (`seatUrl`), for the seat, `seat.ts` and `account-proxy.ts` | `http://127.0.0.1:4820` | the running Account service the seat, `/data/seat.json` and the proxy's `/data/account…` reads and owner writes reach, unless a patch composed the `mcp-account` row with another URL |
| `FACE_IFIND_POLL_MS`, `IFIND_ACCESS_TOKEN`, `IFIND_REFRESH_TOKEN` | the quote routes | `30000`, —, — | the A shares' live quotes on the Markets screen (`face/README.md`, "Markets and Account") |
| `DSH_HOME` | `main.ts`, `boot.ts`, `sessions.ts`, `panels.ts` and dsh itself via `resolveDshHome`; `setup.ts` reads it raw (`?? ~/.dsh`) | `~/.dsh` | written by `bootFace` when a test passes an override; `resolveDshHome` treats an empty or whitespace value as unset and expands `~`, `setup.ts` does neither, so such a value sends `setup` and `start` to different homes |
| `DSH_TELEMETRY_DISABLED` | `boot.ts` | unset | any non-empty value (`0`, `false` included) disables the telemetry row, and its patch composes after the operator layers, so it wins over an operator's re-enable; the policy layer disables the row by default anyway |
| `DSH_PERMISSION_MODE` | dsh, not the face | `workspace-write` | `danger-full-access` sets approval policy `never`: it disarms the sandbox-escalation card but **not** Gate 2, which then denies in its own words |
| `FACE_SMOKE` | tests | unset | `=1` enables the eighteen real-boot tests; the seat and graft smokes also need `FACE_ACCOUNT_SEAT_DIR` |
| `DEEPSEEK_API_KEY` | dsh's credential seam | — | not auto-loaded from the repo's `.env.*` files |

Every child the face spawns for a local agent run or probe has these scrubbed — an enumerated list
(`SCRUBBED_ENV` in `agents.ts`), not a prefix glob: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
`CODEX_API_KEY`, the Bedrock/Vertex/Foundry switches, both APCA keys (read nowhere in the tree
since 2026-10-24, still scrubbed so an operator shell's Alpaca keys never reach a CLI agent),
`DEEPSEEK_API_KEY`. Every other variable is inherited, `ANTHROPIC_MODEL` included; deliberately so
for `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` (the CLI logs itself in; the face
never handles its credentials).

### 4.7 Gate 2: the per-order approval producer

Until 2026-09-04 nothing in the composed tree could raise an approval card for an MCP tool
call: the only producer of `{kind:"ask"}` was a sandbox escalation (a shell or file write
outside the workspace under `workspace-write`), and an MCP call never takes that path. The
approval *channel* — request, answerer, card, outcome, the paired `approval/asked` /
`approval/decided` events — was real and drilled; the producer for orders was absent.
`face/src/orders.ts` is that producer, armed by `boot.ts`'s `armOrderGate` inside boot's
`prepare` — before any row mounts, each half on its own `hostCtx.inject` fiber — in two parts,
because neither alone suffices:

1. A **`tools/pre-execute` listener**, registered `prepend` so it is outermost in the waterfall
   and an inner listener cannot swallow its answer. Non-order tools pass through. For the
   Account seat's twelve writes (`SEAT_WRITE_RAW_NAMES`, §3.1) and
   any tool under the face's own `mcp__account__` prefix that is neither one of them nor one of the
   thirty reads the gate knows (`SEAT_READ_RAW_NAMES`; carded until classified, so an Account that grows
   a tool cannot grow an ungated write) — matched on the **raw name suffix**
   (`name === raw || name.endsWith("__" + raw)`), so an operator renaming the MCP server row
   cannot slip a tool past — it returns `{kind:"ask", reason:"Account seat - <tool>: side=… usd=…
   symbol=… venue=…", displayReason:{en: <the same line>}}` under policy `ask` (the face does not
   know a venue's kind, and the Account's own card says PAPER
   (`describeOrder`: `key=value` pairs in a readable order, values capped at 40 characters, unknown keys
   appended; a key that is not a name (`x venue`, `a=b`) is denied before any card, at any depth, since
   keys are written bare; a value that carries whitespace, a quote, a bracket or a semicolon is drawn as a JSON
   string, cut first where it is cut, so the line reads back pair by pair — the client's card is
   titled from it — and no value can pass itself off as another pair; the key fields the operator
   decides on — a venue, a symbol, an id, an address, a payee's URL, an earn product, a pay's body —
   are shown WHOLE up to 120 characters, and a call whose key field cannot be shown whole is
   **denied** before any card: too long, or a URL that is not http(s), carries userinfo or does not
   parse; a batch's `legs` are each described as one order and a nested object is shown one level
   deep, with the same key fields whole or denied, a list's scalars under their parent key's rule
   (`to[2]`, `url[1]`), anything nested deeper than that one level denied, and more than ten legs
   denied — a card that read `legs=?`, or `extra=?` inside a leg, would approve blind). The retired
   order tools, `place_order` and `cancel_order` under any server name (`RETIRED_ORDER_RAW_NAMES`,
   the removed Python package's pair), are never carded: the guard denies them outright, its reason
   telling the operator to remove the MCP row that registers them. The approval
   request carries no arguments — only the
   tool name, the call id, `reason` and `displayReason` — and `api-remotes` forwards it to every
   connected browser's `$events` stream as an `approval/request` waterfall keyed by `eventId`.
   The card shows the tool name, the order line and two buttons; an upstream-style panel draws
   `displayReason` instead of `reason`, so both carry the line, and the order details reach the
   human only if they are inside it. Under policy `never` (`danger-full-access`, or a runtime
   preset switch) it returns **`deny`** in its own words rather than `ask`, because dsh would
   otherwise render the false `the user rejected tool …` when nobody was asked. No `approval`
   service or no session → deny. (`PreToolDecision` is stated structurally, widened with 0.2:
   `deny.info`, `cancel`, `ask.displayReason`.)
2. A **`tools.guard`**, deny-only and evaluated on *every* allow, including the allow that
   `allowed-once` becomes. It asks the calling session's **event log** — not "did my listener
   see this call" — for an `approval/asked` carrying this exact `callId` **and this tool's
   name** paired with an `approval/decided` whose outcome is `allowed-once`. A sighting is not a
   grant; only the log is. The log is read through `snapshotEvents()`, and only for a gated tool
   (a snapshot copies the whole log): 0.2.0 removed the `events` getter this guard used to read,
   the read went `undefined` without a word, and every approved order was denied. An UNREADABLE
   log — no `snapshotEvents`, a throw, a non-list — is denied with its own sentence,
   `cannot read this session's log to verify an allowed-once approval (dsh Session API changed:
   …)`, never with the "without a logged allowed-once approval" one; `orderGuardReasonForSession`
   is the one producer of both. The guard reads the name alone, per call, so a seat write that
   registers after boot is guarded all the same; a retired order tool is denied first, whatever
   the log holds.
3. A **boot audit** (`auditOrderTools` over the live registry, `{gated, uncovered, retired}`): a
   server carrying the seat's tools of which the gate covers no write (`uncovered`), or any
   registered retired order tool (`retired`), makes the face dispose the tree and throw — a gate
   that covers nothing must not look healthy, and the seat is the only order path. A home still
   mounting the Alpaca MCP row of before 2026-10-24 that registers the pair does not boot until the
   row is removed (that row's server cannot start anyway: its package is gone). A write the
   Account renames under the face's own prefix is carded as unclassified, and under a renamed
   server it is the audit's `uncovered`; `tests/account-seat-smoke.test.ts` against the installed
   checkout is the canary (§7.3). Boot
   also refuses a tree with no ACTIVE `api-remotes` entry (§4.1), without which every ask
   resolves `unavailable` and every order is denied at once, with no card anywhere.

Consequences worth knowing: a card with no connected browser **blocks**, it does not deny —
the gateway holds the request and replays it, same `eventId`, to the next `$events` client;
grants are one-shot (`allowed-once`, no allow-always); the seat's `portfolio_live_cancel` is gated
like every other write (the Account itself never cards it), so under policy `never` the
risk-reducing action is refused too; and the gate binds only when dsh runs inside the face — a dsh
tree composed without the face has only the Account's own Guard card. The answer is the
browser's `POST /api/$events/result` under its `$events` clientId (§5.2); the host would accept
any outcome of the approval vocabulary from a client, so keeping the operator to
`allowed-once` / `rejected` is `client/js/wire/api.js`'s job. **It is a gate, not containment** (§9,
R2), and the log proves a grant was recorded, not who recorded it (§9, R3a). Drill status is in
§7.4: the refusing half and the admitting half are automated on a real tree over `mcp__drill__*`
stand-ins of the seat's writes, the admitting half through the real `$events` channel too; a
person reading a seat card against the real service is the account-seat drill's, not yet run.

### 4.8 The re-host's operator decisions

The dsh 0.2.0-rc.2 re-host (2026-09-30) defaulted every decision that changes what Gravit can
do, what leaves the machine, or which operator data survives; each stays the operator's. The
numbers are the re-host plan's, which the code comments cite as `PLAN D<n>`. The go-live runbook
(`docs/superpowers/runbooks/2026-09-30-dsh-0.2.0-rc.2-go-live.md`, §4) walks each one that
needs an answer before the operator's home moves.

| PLAN | Decision | Default in the tree | To choose otherwise |
|---|---|---|---|
| D1 | a `profileContext` (settings forms, a live model save, `dsh-hmr`, `plugin-manager`) | none (§4.1) | a code change: every face layer moves into `profileContext.overlays`, and the first boot imports and renames the shared `settings.yaml` |
| D2 | Gravit's default model | dsh-base's `deepseek-official/deepseek-flash` until the operator adds the `agent-default-model` row (§3.1) | that row in `profiles/face/cordis.patch.yml` |
| D3–D7, D9 | telemetry, session-log upload, package inventory, `web_fetch`, MCP resource tools, `ralph` and `str_replace_editor` | the 0.1.1 posture (§4.3) | one operator row each |
| D8 | the browser cookie on `/data` (and, until stage 2 removed them, the `/market` and `/account` pages) | fence-only, as at 0.1.1 | a code change behind `isTrustedDataRequest` (Connection's `requestRejection`) |
| D10 | an HTTP proxy policy | none: the face's own fetches go direct; children still inherit proxy variables | a code change (`installProxyFromEnvironment`), which reroutes every fetch |
| D11 | the ten 0.1.1 room sessions the 0.2 migration refuses | left on disk and reported, never rewritten (§9, R20) | archive them in the face, or rewrite COPIES — never the originals — to a source kind the migration admits |
| D12 | the 0.1.1 global CLI and the 0.1.1 face on the shared home | never again once 0.2.0 has written it: 0.1.1 re-heals its link farm, forks history away from `session.v4`, and on its next workspace write detaches every 0.2-born session from its channel in `workspace.json`; a full restore of the backup is the only rollback | upgrade the CLI (its first run imports `settings.yaml` into its OWN profile) or give 0.1.1 tools their own `DSH_HOME` |
| D13 | `$DSH_HOME/profiles/node_modules` | delete once D12 holds | keep it: a mixed-version hazard for any row outside the face's closure |
| D14 | un-archiving host archives | refused with a 409 naming why (§4.4) | route it to `workspaceRegistry.unarchiveSession` |
| D15 | telemetry opt-in | the policy row off; `DSH_TELEMETRY_DISABLED` still works | `- id: session-telemetry-otel` / `disabled: false` |
| D16 | opening a cold session in the chat | page-only, never activating (§5.4) | follow on open, as the upstream client does — every browsed session then gets a v4 log and a lock |
| D17 | three subagent children with a version-2 descriptor and one log with a sequence gap, unreadable under 0.2 | left on disk and reported, like D11 (§9, R20) | export their transcripts while a 0.1.1 face can still render them, or wait for an upstream migration edge |
| D18 | the spill budget | dsh-base's `maxInlineTokens: 12500` (§9, R27) | one row restating `spill-policy`; about 4,200 tokens restores the old CJK budget and spills ASCII three times earlier |

---

## 5. Frontend: the browser client (`face/client`)

Since 2026-10-19 the page at `/` is **gravit-ui** — the settled front end of
`docs/superpowers/specs/2026-10-09-demo-v2-gravit-frontend-design.md`, mounted on the face by
`docs/superpowers/specs/2026-10-19-gravit-ui-on-face-design.md`'s route A (all three of its
stages are built; the plans are `docs/superpowers/plans/2026-10-19-gravit-face-stage-1.md`,
`docs/superpowers/plans/2026-10-20-gravit-face-stage-2.md` and
`docs/superpowers/plans/2026-10-20-gravit-face-stage-3.md`, their rulings and the drill record
`docs/superpowers/plans/2026-10-19-gravit-face-ledger.md`). Vanilla ES modules, no bundler, no
framework: one store, pure reducers, string renderers, one `innerHTML` per render with
`data-action` delegation. Every host string passes through `esc()` (`js/html.js`) before it
reaches the page; the one HTML the page builds from host text is markdown — Gravit's answers, a
room member's, a channel's thesis — DOM-built by `js/wire/markdown.js` and serialized. Stage 1
serves **Messages** — the session list, a session's real transcript, the composer, the three gate
cards, rooms; stage 2 **Markets** and **Account**, which replaced the old `/market` and
`/account` pages and since the graft's stage 1 (2026-10-22,
`docs/superpowers/specs/2026-10-22-account-graft-design.md` §6.1–§6.2, its plan
`docs/superpowers/plans/2026-10-22-account-graft-1-reads.md` and ledger
`docs/superpowers/plans/2026-10-22-account-graft-ledger.md`) read Linqi's Account through the
face's proxy (§4.4) — Markets the Account's markets by its tabs, the stars and a search, a
market's page with its candles and venues, the A shares on the face's own wire; Account the
Account's Portfolio, Venues, Agents and Cards and the Statement drawer — and since the graft's
stage 2 (2026-10-24, the same design's §6.3–§6.4, its plan
`docs/superpowers/plans/2026-10-23-account-graft-2-owner-trade.md`) the page is one of the
Account's owner devices (a P-256 key the browser holds, paired and signing at the Account's door
through the proxy's three writes), **Trade** (`#/trade`) places the owner's hand orders, and
the owner's other keys sign from Account and Markets, each drawn only while the page signs;
stage 3 the list
grouped by channel with a page per channel (its status, thesis, backtests, journal, files and
agent and bot rosters), the row actions (fork, archive, un-archive, delete), **Discover** — the
inventory of what Gravit runs: the MCP servers, the bots, the local CLI agents and Gravit itself,
the skills, with the face's few runtime actions and no shop — and the research surfaces (tool
results drawn as tables, tiles and charts; a conversation's subagent children, with Stop; a room
member's trace). The product speaks English, and the wire's Chinese prose (a quote's or a
provider's message, a search note) never reaches a screen: a state is worded
from the wire's enums, and the old chat page's pure modules moved under `js/wire/` with their
words in English; what the operator and Gravit wrote (a channel's files, a bot's name and soul, a
skill) and what a server says of its tools are drawn as written, escaped. The muted lines that
say what something is doing — the status line under the composer, Discover's own line, the A
shares' quote connection, a search's state, the watchlist's trouble, the Account's own refusal
sentence drawn as its words, the Account's and a channel's stale stamps, a tool result's
`Partial` — are the only explanatory lines a screen carries.

### 5.1 Pages and files

| File | Role |
|---|---|
| `index.html` | the shell: `<title>Gravit</title>`, `#app`, the two sheets, a three-line script that applies the saved theme before first paint, `js/app.js` as a module. Holds not one byte of host data. The Google Fonts link (Manrope · Noto Sans SC · IBM Plex Mono) is the browser's own fetch — offline the system stack stands in |
| `js/app.js` | `boot(win, host)`: the store, the live layer, the actions, the markets, account, seat, channel, Discover and trace host layers, the owner device, the owner sheet and Trade (stage 2 of the graft), the tab's Account stream and the render loop (§5.4); `makeStore`, `initialState`, `prefsOf`, `routeOf`, `settle`, `answersFrom`, `complete`, `gravitMarkdown`, `getJsonVia` (a refusal rejects with its status and, when it parses, the face's body as `error.body`, where the hosts read the Account's sentence), `postJsonVia`, `Timers`, `SEARCH_QUIET_MS` (300) are exported for the tests |
| `js/store.js`, `js/reducers/index.js` | `createStore({initial, reducers, storage, key, accept, persist})` — `dispatch(type, payload)`, `get()`, `subscribe(fn)`; the reducer table is the merge of the per-slice modules |
| `js/reducers/host.js` | the host reducers (§5.3): `hostStatus`, `hostList`, `hostWindow`, `hostEvent`, `hostGate`, `hostGateGone`, `hostProjection`, `hostThinking`, `hostPreview`, `markSeen` |
| `js/reducers/messages.js`, `controls.js` | what the operator does with the page: `nav` (a market's Account key kept whole, a face id canonicalised; a missing conversation id becomes `firstOpen`'s; `lastDiscover`, the Discover view a plugin page goes back to), `toggleGroup`, the draft (`startDraft` — Where on the channel New round names, else the root —, `cancelDraft`, `setDraftTitle`, `setDraftWhere`), the optimistic `rename`, `toggleDetails`, `toggleRail`, `setTheme`; the inline editors (`startEdit`/`commitEdit`/`cancelEdit` — a rename, New channel…, a roster, a bot —, `editFailed`, which keeps an editor open with the refusal, `toggleRosterTick`), the two-step confirms (`askConfirm`/`cancelConfirm`) |
| `js/reducers/markets.js`, `account.js` | the host's markets (§5.5): the Account's explore reads by tab (`exploreLoading`/`exploreLoaded`/`exploreFailed`) and the search's (`resultsLoading`/`resultsLoaded`/`resultsFailed`), each failure keeping its rows with the Account's sentence (`message`); the quotes by `venue\|symbol` — `accountQuotesLoaded` (an answer stamped before the price kept leaves the pair), `streamQuote` (a `quote` frame: the last trade, else the middle of the bid and ask, marked `streamed`, the 24-hour figures kept), `streamSnapshot` (a `snapshot` drops the pairs the stream priced); a page's candles by key under their range (`candlesLoading`/`candlesLoaded`/`candlesFailed`, `setRange`) and compare rows by base (`compareLoading`/`compareLoaded`/`compareFailed`); the stars (`accountWatchLoaded`, `askedOfAccount`, `forgetAsked`); the face's wire for the A shares (`watchlistLoaded`, `quotesUpdated`, `searchUpdated`, `hitQuotesLoaded`); and the screen's `setMarketsTab`, `setMarketsSort`, `setMarketsQuery` (a query typed from nothing opens All results, cleared there it goes back to All). The host's account: the page (`accountLoading`/`accountLoaded`/`accountFailed`, the failure keeping the last page with the Account's sentence), `holdings*`, `paper*` and `statement*` (each failure keeping the sentence), `history*`, `agents*`, the connect and paper sheets' reads — `venuesHere*`, `paperBooks*`, `keyfile*` (its `keyfileLoading` records what it asked), `reach*`, each failure keeping the sentence —, `setHistoryRange` (`1d`, `1w`, `1m`, `all`); the Account seat's (`seatLoading`/`seatLoaded`/`seatFailed`, a failure keeping the last view); the drawers' `openStatement`/`closeStatement`, `openVenueDetails`/`closeVenueDetails` (a venue's Details, one drawer at a time through `closeOverlays`) and `openSettings`/`closeSettings` |
| `js/reducers/owner.js`, `trade.js` | stage 2 of the graft (§5.5): the owner device (`ownerStanding` — a role it does not know changes nothing —, `ownerRefusal`, `ownerBusy`) and the open sheet (`sheetOpen`, `sheetField`, `sheetIncomplete`, `sheetAsking` — a quiet ask keeps a ready sheet's preparation —, `sheetPrepared`, `sheetRefused`, `sheetSigning`, `sheetDone`, `sheetTick`, `sheetClose`); Trade (`tradeKind`, `tradeQuery`, `picksLoading`/`picksLoaded`/`picksFailed` by kind, `tradeResultsLoading`/`tradeResultsLoaded`/`tradeResultsFailed` — named apart from the Markets search's —, `ticketOpen`, `ticketClose`, `tradeSaid`) |
| `js/reducers/channels.js`, `discover.js`, `traces.js` | the channel page's read (`channelLoading`, `channelLoaded`, `channelFailed` — a failure keeps that channel's data, a 404 reads `missing`); Discover's (`setDiscoverQuery`, `shelfLoading`/`shelfLoaded`/`shelfFailed` — a failed shelf keeps its data —, `gravitLoaded`, `skillLoading`/`skillLoaded`/`skillFailed`, `modelsLoaded`, `discoverStatus`); a member's trace by the answer it explains, under its conversation (`traceLoading`, `traceLoaded`, `traceFailed`) |
| `js/data/empty.js` | `emptyState()`: the state the page boots into — no conversations, `status.line = "connecting…"`, every slice at its empty shape (§5.5), the `seat` slice among them (`{status, data, at}`), and no demo slice: no `plugins`, `memory`, `mail`, `banner`, `call` or `compose` |
| `js/host/kinds.js` | the kind table (spec §6, §5.3): a mapper view → zero, one or two messages; `SEAT_TOOLS` (the seat's twelve writes), `isSeatWriteTool`, `parseArgs`, `seatLine` (a seat write in words), `seatLift` (a seat write's answer as a receipt, a refusal or nothing), `rememberCall`, `toMessages`, `reasonArgs` |
| `js/host/sessions.js` | `session/list` rows → conversation records: `kindOf`, `conversationOf`, `listConversations`, `unreadOf`; `childRowsOf` (the subagent rows the list leaves out, kept for their parent's Children) and `firstOpen` (the conversation every default opens, never an archived one) |
| `js/host/live.js` | the impure half: the mux, the follow-or-page policy, the list and its previews, gates, projections, host facts — all into the store, nothing into the DOM |
| `js/host/actions.js` | a `data-action` → the Remote or face route the old client sent: `send`, `newConversation`, `answer`, `stop`, `rename`, `command`; the row actions `fork`, `archive`, `remove`; `talkTo` (a bot's home conversation), `stopChild` |
| `js/host/list-view.js`, `discover-view.js`, `children-view.js` | stage 3's pure views (§5.3): `groupsOf` (the list's groups); `SHELVES`, `SOURCE`, `itemsOf`, `searchItems`, `itemById` (Discover's items under namespaced ids); `childrenOf` (a conversation's subagent children and their states) |
| `js/host/channels.js`, `discover.js`, `traces.js` | stage 3's impure halves: `startChannels` (a channel's overview, a new channel, the two roster writes; `MAX_BOTS`), `startDiscover` (the four listings, the Gravit item's three reads, a skill's content, the CLI agents' writes, the model routes, a bot's save and create; `SHELF_PATHS`, `GRAVIT_KEYS`), `startTraces` (a room member's trace, read once per answer) |
| `js/host/market-view.js`, `account-view.js` | the pure views (§5.3): the Account's markets (`ACCOUNT_TABS`, `ACCOUNT_SORTS`, `CANDLE_RANGES`, `isAccountKey`, `tabsOf`, `priceOf`, `sourceWordOf`, `legsOf`, `followOf`, `sortsOf`, `tableOf`, `rowsOf`, `watchedOf`, `watchKeysOf`, `setWatchOf`, `matchKey`, `pairsOf`, `pageOf`, `handWordsOf`, `volumeWordOf`), the face's ids and the A shares' words (`canonicalId`, `faceAssetOf`, `mentionsOf`, `quoteWord`, `connectionWord`, `providerWord`, `basisWord`, `sourceWord`, `volumeWord`, `searchWord`, `watchWord`); the Account's page (`pageOk`, `headOf`, `worthOf`, `changeOf`, `assetsOf`, `positionsOf`, `openOrdersOf`, `missingWords`, `statementLinesOf`, `statementCsvOf`, `venuesOf`, `agentsOf`, `cardsOf`, `asksOf`, `requestsOf`, and for the connect and paper sheets `connectOptionsOf`, `paperBooksOf`, `keyfileWords`) and `seatWords` (the seat's standing in the Venues box's words) |
| `js/host/markets.js`, `account.js`, `seat.js` | the impure halves: `startMarkets` (the Account's explore, quotes, candles and compare through the face's proxy, a market page's follow on the stream, the stars in this browser's two stores — an Account market's, on a page that signs, the Account's own signed `setWatch` —, each old `us:`/`crypto:` star asked once; the face's wire for the A shares), `startAccount` (the Account's page, holdings and paper lens, history, statement and agents, and the connect and paper sheets' four reads, each one flight; the page polled and handed to `onPage`; the stream's events as reads) and `startSeat` (`/data/seat.json` in one flight, fresh on Refresh, a card raised or answered and after a seat receipt) |
| `js/wire/owner-key.js`, `key-store.js` | the owner key (§5.3): `canonical`, `b64u`, `signingInput`, `kidOf`, `publicJwkOf`, `signPrepared`, `makeKey` — the Account's envelope arithmetic, `subtle` always the caller's; `indexedDbKeys` (database `gravit-face-owner`, version 1, store `keys`, record `device`), `memoryKeys` (its twin for tests and a browser without IndexedDB), `signedOutFlag` (`gravit.owner.signedOut.v1`) |
| `js/host/owner.js`, `owner-view.js` | the owner device (§5.3): `startOwner`, `postVia`; its pure words — `standingWords`, `devicesOf`, `whatYouSignLines`, `goodForWords`, `refusedAt`, `whyOf`, `refusalOf`, `saidOf` |
| `js/host/sheet.js`, `sheet-view.js` | the owner sheet (§5.3): `startSheet`, `askedOf`, `PREPARE_QUIET_MS` (300), `RESIGN_UNDER_MS` (30,000), `FRESH_MS` (3,000); every kind's pure shape — `SHEET_KINDS`, `goWord`, `titleOf`, `fieldsOf`, `draftOf`, `limitSeedOf`, `letDeviceSeedOf`, `paperSeedOf`, `grantOf`, `keyfileAskOf`, `reachAskOf`, `connectCheckOf` |
| `js/host/trade.js`, `trade-view.js` | Trade (§5.3): `startTrade`, `PICKS_MS` (20,000), `PICK_LIMIT` (12); its pure view — `TRADE_KINDS`, `tradeableOf`, `pickerOf`, `ticketOf`, `tradeFieldsOf`, `tradeDraftOf`, `quoteOf`, `underWayOf`, `fillWords` |
| `js/wire/account-stream.js` | the Account's push channel in the browser (§5.3): `createAccountStream`, `mintClientId`, `STALE_MS`, `DEAD_MS`, `RETRY_MS`, `FOLLOW_LIMIT` — one `EventSource` per tab through the proxy, the resume point, the follow POSTs, stale and dead |
| `js/wire/api.js`, `mapper.js` | the old client's wire, moved unmodified but for one field: `call(endpoint, args)`, `openMux({onReady, onEvent, onGate, onGateGone, onDown})` with `stream()` and `answer()`, `randomUuid()`; `mapFrame` (frame → view-model), whose session-event views now carry `time` (the record's clock, the message's `at`) |
| `js/wire/summaries.js`, `room.js`, `speaker.js`, `markdown.js` | moved with them: `summaryOf` (restores `agentPreset` on a list row — the projection first, `/data/channels.json`'s `presets` second, never a guess), the pure room rules (`foldMembers`, `isMentionText`, `roundEndLine`, …), `isHostPreset`/`speakerFor`, the DOM-built markdown |
| `js/wire/grouping.js`, `channelName.js`, `botId.js`, `botSettings.js`, `subagents.js`, `member-traces.js` | the old chat page's other pure modules, moved in stage 3 with their words in English (`tests/client/wire-words.test.js` greps the six for Chinese): `bucketFor` and its sentinel keys (`ARCHIVED_KEY`, `UNGROUPED_KEY`, `BOT_KEY_PREFIX`); `foldChannelName`; `proposeBotId`; `normalizeBotModel`, `botModelChoices`, `botSettingsPayload`; `isSubagentRow`, `composeSubagentCatalog`, `normalizeSubagentCatalog` and `subagentControls`, which returns a state enum (`unavailable`, `waiting`, `running`, `inactive`, `unknown`) with a diagnostic's `reason` and no sentence; `loadMemberTrace`. `draftBotSoul`, `botToolLabel`, `isBotKey`, `subagentAddress` and `subagentResult` moved too, and no page calls them |
| `js/wire/market-model.js`, `market-quotes.js`, `market-search.js`, `account-model.js` | moved from the old instrument pages in stage 2: `normalizeAsset`, `readWatchlist`/`saveWatchlist` (the face's key, the kairos key read until the first save), `readAccountWatch`/`saveAccountWatch` (the Account's keys under `ACCOUNT_WATCH_KEY`, `gravit.account.watch.v1`, a hundred at most), `price`, `number`; `createLiveQuotes` (the SSE stream with its 15 s polling fallback, handed `cn:` ids alone; `parsePayload` exported for the hit read); `createSymbolSearch` (250 ms debounce, a 10 s timeout); `money`, `signedMoney`, `pct`, `sign`, `orderMatches`. Their Chinese labels and notes stay in the wire and never reach a screen |
| `js/render/rail.js`, `messages.js`, `thread.js`, `avatars.js`, `controls.js` | the two-level rail (Discover in the first level) and the list's groups; the Messages screen (head, Details with the row actions and Children, composer, status line, new message with New channel…, empty state); the thread's kinds, a tool row's dressed result and its Raw, a member's Trace; avatars and clusters (a bot's letter from the host's bot names); the segs, the key-value rows, the inline editor and confirm pair |
| `js/render/markets.js`, `chart.js`, `account.js`, `js/market-fmt.js` | stage 2's screens (§5.4), on the Account's reads since the graft's stage 1: Markets — the Account's rows by tab beside the A shares — and a market's page (`renderMarketsScreen`, `marketPage`, `mkAv`, the face's own letter tile); the charts, one drawing in one box — `candlesSvg` (a market's closes from the Account's candles, the page's chart), `curveSvg` (the Portfolio's curve from its history); Account (`renderAccountScreen` — Portfolio, Venues with a venue's Details drawer and the Account seat box, Agents, Cards — the Statement drawer `renderStatement`, `orderWords`) and the Settings drawer (`renderSettings`); `chgHtml`, a change with its arrow (the A-share page's) |
| `js/render/owner.js`, `trade.js` | stage 2 of the graft (§5.4): the device line under the Account head (`renderDeviceLine`), Settings › Devices (`renderDevices`), the owner sheet's drawer (`renderSheet`); the Trade screen (`renderTradeScreen`: the kinds, the picker, Under way, the ticket) |
| `js/render/channel.js`, `discover.js`, `tool-result.js` | stage 3's screens (§5.4): a channel's page (`renderChannelScreen`, `bytesWord`); Discover, a shelf's grid, the Create page and an item's page (`renderDiscover`, `renderPlugin`); a tool row's result seam (`toolResultHtml`, `toolResultFor` — `null` for every call since 2026-10-24, so every result draws plain) |
| `js/html.js`, `icons.js`, `time.js`, `router.js`, `messages.js` | `esc`/`attrs`/`cls`; the inline SVG icon set; `rowTime`/`divider`/`fmtDate`/`fmtClock`; `parseHash`/`toHash`; `LEVELS` — the host's kinds alone: text and tool grey, card, approval and question orange, refusal red, receipt green — `levelOf`/`needsAnswer` |
| `css/tokens.css`, `css/app.css` | the tokens (Linqi's Cream and Black values, demo @ 0ef5131) and the one sheet |

The old `/market` and `/account` pages are gone too (stage 2): their documents, scripts
(`market.js`, `account.js`, `account-view.js`, `navigation.js`) and sheets (`chat.css`,
`market.css`, `account.css`), with the two landing-page capture helpers that served them.
`chat.js` is gone, and with it the two test groups that ran its own source through `vm`
(`api.test.ts`'s reconnect race, `subagents.test.ts`'s follow/page and dock controllers); most of
the policy they proved is re-pinned in `tests/client/live.test.js` against a fake host (§7.3 names
the two cases that are not), and `tests/client-mux-smoke.test.ts` still drives `api.js` +
`mapper.js` against a real boot. Stage 3 deleted the rest of the old page — `channels.js` and
`answer-traces.js` (DOM, replaced by string renderers), `js/wire/render.js` (ported to
`render/tool-result.js`) — and the demo's last pieces: the shop's catalogue (`js/data/plugins.js`),
Mail (`js/render/mail.js`), the page-made ids (`js/ids.js`), the seed fixture
(`tests/client/helpers/seed.js`) and the tests that stood on them (`tests/client/data.test.js`,
`tests/answer-traces.test.ts`).

### 5.2 Wire contracts

The client speaks dsh 0.2.0-rc.2's Typert Remote wire through `js/wire/api.js`; 0.1.1's
apiproxy wire (`POST /api/<dotted.method>`, `POST /api/respond`, the downlink-only
`/api/events.mux`) was deleted upstream, and `call` refuses a dotted name before any fetch. Every
`/api` request and the mux upgrade carry the browser cookie (§4.4) with no code of the page's; a
401 is reported as `Not signed in — open the URL gravit-face printed`.

**Unary** — `call(endpoint, args)`: `POST /api/<ns>/<method>` with
`{type:"client-request", rpcId, method:"<ns>/<method>", payload:{args}}` — the method repeats the
path, the payload is exactly `{args}`, and `content-type: application/json` is load-bearing (the
host 415s anything else). The answer is `{type:"server-response", rpcId, result:{ok:true,
value?}}` or `{ok:false, error:{code, message, details}}`; `call` checks the echoed `rpcId`,
resolves the value, and rejects with the host's `code` (`session/not-found`,
`gateway/arguments-invalid`, …) or the HTTP `status`. Every wire parameter is sent
(`{_request:{}}`, `{request:{…}}`): an unknown top-level key is `gateway/arguments-invalid`. The
Remotes stage 1 calls: `session/list`; `session/create` (`{workspaceId}` for a channel, `{}` for
the host's default project directory — the repo root; `cwd` only for Talk to, below); `session/prompt`
(`mode:"queue"`, a client-minted `requestId` — a retry with the same id is admitted once — one
text part, the browser's `clientTimeZone`); `commands/execute` (a slash line, which 0.2.0's
prompt would hand to the model as text; `undefined` — no command claims the line — falls back to
a prompt); `session/cancel`; `session/rename`; `session/projections` and `session/page`, the two
non-activating reads. Stage 2 adds no Remote: Markets and Account read the face's `/data` routes
(below) — the Venues tab's `credentials/describe` left with the graft's stage 1. Stage 3 adds
`session/fork` (`{request:{sessionId}}` → the child's `sessionId`; the host
refuses `session/fork-unavailable` for a session with no completed turn, which is why an empty
conversation offers no Fork); `session/create` with `{cwd: <the bot's homeCwd>, agentPreset:
<its id>}` for Talk to; `session/modelCatalog` (`{}`: its `default` selection on the Gravit item,
its groups as a bot's model routes); `credentials/describe` on the Gravit item, with
`{refs: ["DEEPSEEK_API_KEY"]}` (per ref `{configured,
source?, writable}`, never a value); and `subagents/interruptByParent`
(`{childSessionId, parentSessionId, mode:"continuable"}`, bare, as the old client sent it) for a
child's Stop. Not called: `subagents/prompt`, `workspace/rename`, `directoryPicker/pick`. The
surface stays closed by design: `session/selectModel`, `agentPresets/*` and `settings/describe`
are not called.

**Streams** — one WebSocket, `/api/remote.mux`, carries any number of logical streams keyed by a
client-chosen `streamId`: client frames `open` / `cancel`, host frames `item` / `end` / `error`,
exact keys. Three kinds ride it:
- `$events`, internal to `api.js`, one per socket generation and opened with exactly `{args:{}}`:
  `ready` first (the `clientId` every answer is bound to, and the host's `home`), then `emit`
  (host facts: `api-session/added|removed|status|activity|error`, `agent-preset/selected`),
  `waterfall` (an `approval/request` or a `user-questions/request` waiting on the operator:
  `{event, eventId, agentId, request}` — `agentId` is the session id; `request` carries the tool
  name, call id, `reason` and `displayReason`, or the questions) and `cancel` (that wait is over;
  it carries no outcome). Any other waterfall is handed straight back with `next`. Every pending
  gate is replayed, same `eventId`, right after each `ready`.
- `session/control`: a `baseline` of every attached session's projections, then `projection`
  frames — `tokenUsage`, `contextPressure`, `title`, the `room` unit's whole value,
  `subagentCatalog` and the rest. The live layer re-opens it 2 s after the host ends it, 10 s
  after an error (`live session state unavailable: <code>` on the status line meanwhile).
- `session/follow`: one session's transcript — a `snapshot` (header, cursor, the tail window of
  records, projections), then gap-free `event` records and, opened with `assistantStream: true`,
  `assistant-stream` frames whose `block-start` chunks are the pulses (0.2.0 logs no
  `assistant/chunk`). A follow item names no session; the live layer re-addresses it.

**Reconnect** — there is no resume cursor. A socket close, a frame outside the stream grammar,
and an `$events` end, error or non-`ready` opening all lose the generation the same way: `onDown`
runs while only the lost socket exists (the live layer suspends the follow there — the view
drops to `page` with `stale` set — and the status line reads `Reconnecting… (<reason>)`), a fixed
1.5 s later a new socket re-opens every registered stream under fresh ids (`$events` first), and
`onReady` clears the line and re-reads the list, which `reconcile` reads to re-decide the open
conversation: followed again if live, re-paged if cold. A follow the host itself ends is
re-decided 2 s later the same way — never blindly re-followed.

**Answering a gate** — through the live layer's `answer` (§5.3), which calls `mux.answer(eventId,
value)`: it POSTs `$events/result`
`{clientId, eventId, outcome:{kind:"result", value}}` under the CURRENT generation's clientId: an
approval with the bare `"allowed-once"` or `"rejected"` (the host itself would take any value of
the approval vocabulary, so `api.js` is where `cancelled` and `unavailable` stay host-side), a
question with `{answers:[{id, selected, custom?}…]}`, the whole batch (`answersFrom` in `app.js`
reads the pressed card's inputs, matched by name; a batch with a question left blank is refused
on the status line, `Answer every question first`, before anything is sent). The host answers a settled or undelivered gate with a silent `ok`, so
`api.js` tracks the gates each generation was delivered and refuses: `not-ready` (no clientId
yet), `not-pending` (this connection does not hold the gate), `gate-gone` (withdrawn while the
answer was in flight), `bad-value`. A `cancel` that lands after this tab's answer resolved means
the answer lost a race — the host never cancels the winner — and is reported too (the last 64
answered ids per generation are remembered); the live layer turns that report into the card's
`Settled elsewhere`. A gate not replayed within 1 s of a reconnect's
`ready` was settled while the page was away: `api.js` retires it through `onGateGone`, and the
live layer owns no grace timer of its own.

**Room routes** — `/data/rooms/say` is called **before** `session/prompt` whenever the composer's
text carries `(^|\s)@` and the conversation is in a channel; an answer of `addressed: []` means
the text named nobody on the roster and it goes out as an ordinary prompt instead.
`/data/rooms/state` is not called: a room's members come from the `room` projection and the
list fold (§5.3), and a member's gate is attributed through that fold.

**`/data` routes** — fence only, no cookie. Every list refresh reads `/data/channels.json` (the
channel index, `presets`, the host's `archived`), `/data/bots.json` (the bots' display names) and
`/data/sessions-meta.json` (the face's own `archived` and `deleted` ids) beside `session/list`;
a failed or malformed one keeps its last good answer — the groups never blank and nothing is
un-archived by a failure — and before any good answer the list still lands, with no channels, no
names and nothing archived (a bare `bootFace` mounts no `/data` route, as `gravit-client-smoke`
pins). The list is
re-polled at the trailing edge of a fixed 1.2 s window that its first trigger opens — the old
client's debounce re-armed on every trigger; through a sustained burst this one refreshes every
1.2 s rather than once at its end — and its triggers are the `$events` facts
`api-session/added|removed|status|activity` and `agent-preset/selected`, the followed
session's turn frames, and a control-stream `title` the list does not show yet.

**Markets and Account's `/data` reads** (the Account's through the proxy since the graft's
stage 1, §4.4; `fresh=1` is the face's own flag, past the proxy's cache) — Markets: `GET
/data/account/explore?limit=200` (All, Watching, and All results with no query) or
`?tab=<kind>&limit=200` (a kind's tab) on showing and every 20 s while Markets is on screen in a
visible tab, a tab changed while shown read at once;
`GET /data/account/quotes?pairs=<venue|symbol,…>` every 5 s for the drawn rows' most traded
connected lines (twelve a call, none while one is out; on a market's page its own market's line,
from the page's own view when that market is no row of the tab on screen); the search
`GET /data/account/explore?q=<q>&limit=200` once the
box has been quiet for 300 ms; each old `us:`/`crypto:` star `GET
/data/account/explore?q=<its symbol, a coin's base>&limit=12` once per boot, one at a time; a
market's page `GET /data/account/candles?venue=&symbol=&range=` for its range and, for a coin, a
perpetual or a stock, `GET /data/account/compare?base=<base>&side=buy`. Account: `GET
/data/account` at boot, on entering Account, every 20 s while it is on screen in a visible tab
(80 s while the stream is open), on Refresh and right after a receipt, the seat's too
(those two `?fresh=1`); `holdings?cost=1` — and while the page, one the face recognises, names a
paper venue its paper lens `holdings?cost=1&paper=1` beside it — on entering Portfolio, on Refresh,
on a market's page, and when a page naming a paper venue lands with the lens never read or after a
page the face did not recognise (then `&fresh=1`);
`history?range=<1d|1w|1m|all>` (`&paper=1` when Paper leads) after the holdings on entering
Portfolio, after that page landing's holdings read and in a snapshot's re-read, and on a range —
not after Refresh's or a market page's holdings read;
`statement` on opening the drawer and on a market's page; `agents` on entering Agents. The stream:
one `EventSource` per tab at `/data/account/stream?client=face-<24 hex>` (`&since=<the last id>`
on a new source), open while the tab is visible, and `POST /data/account/stream/markets`
`{client, markets, n}` for the market a page follows; an event reads again what it names, past the
cache — `order`, `fill`, `paper`, `balance`, `position` the holdings and the page, `statement` the
statement, `card` the page (and `/data/seat.json?fresh=1` for a card raised or answered),
`snapshot` everything; a `quote` frame is the followed market's price. The A shares stay on the
face's own wire, for `cn:` ids alone, through `wire/market-quotes.js` and `wire/market-search.js`:
`GET /data/quotes/stream?ids=` (server-sent `quotes` events, each a whole payload, a heartbeat
every 15 s; 35 s without one is a dead stream), and while the stream is down a `GET
/data/quotes?ids=` every 15 s, every payload validated whole (`parsePayload`) before it can
replace good quotes; the search `GET /data/symbols/search?q=&market=cn` after the wire's own
250 ms pause, then one `GET /data/quotes?ids=` for up to 30 of its hits.

**Stage 3's `/data` reads and writes** — a channel's page: `POST /data/channels/overview
{workspaceId}` on entering it and on Retry; its editors: `GET /data/agents.json` for the agent
choices, then `POST /data/channels/agents {workspaceId, agents}` or `POST /data/channels/bots
{workspaceId, bots}` (at most six, refused before the post), each followed by the overview again;
New channel…: `POST /data/channels {name}` (the name folded by `foldChannelName` and checked
against the face's `NAME_RE` first), then a list refresh and the new channel found by the `dir`
the route answered — it answers no workspace id. Discover: on entering it, `GET /data/plugins.json`,
`/data/bots.json`, `/data/agents.json` and `/data/memory.json`, each alone; a skill's page `POST
/data/memory/skill {name}` once; the Gravit item `GET /data/host.json`; `POST
/data/agents/connect|disconnect {bin}` and `/data/agents/rescan {}`, then the agents listing again
(rescan answers the listing itself); `POST /data/bots` (a new bot — the route answers `{ok, bot:
<the row>}`) and `POST /data/bots/settings {id, revision, name, description, model, soul}` (a
stale revision is a 409 `changed since this view was loaded`; a 500 `bots/<id> was saved, but …`
kept the files), each followed by `/data/bots.json` again. The row actions: `POST
/data/sessions/archive {sessionId, archived}` (an explicit boolean both ways; the host's own
archive cannot be undone there — a 409) and `POST /data/sessions/delete {sessionId}`.

### 5.3 The host layer

**Rows → conversations** (`js/host/sessions.js`, pure). `listConversations(items, ctx)` runs
every row through `summaryOf` (the preset restored), folds a room's member sessions under their
host session (`foldMembers`), drops the members, every row with an `origin` (a subagent child —
`childRowsOf(items)` keeps those rows' `{sessionId, parentSessionId, running}` for their parent's
Children) and every id `/data/sessions-meta.json` lists as deleted, and sorts newest first; an
archived conversation stays, marked. A conversation is `{id, title, kind, members,
memberSessions, channel, archived, preset, running, live, updatedAt, created, messages, loaded,
preview, usage, thinking, lastSeen}` (and `subagentCatalog` once its projection arrives):
`archived` is `'host'` when `/data/channels.json`'s `archived` lists it (the host's archive, which
the face cannot undo), `'face'` when `/data/sessions-meta.json`'s does, else `false`; `title` is the
`title` projection or `Untitled`; `kind` is `group` when the `room` projection reads
`kind:"room"` or the fold found members, `bot` when the preset names a bot (its home session —
the assistant bubbles are the bot's words), else `gravit`; `members` is `['gravit', …bots]`,
`[preset]` or `['gravit']`; `live` is the row's `agentAvailable`, `running` its `running`;
`channel` is `{workspaceId, name}` from the index or `null`; `created` is filled by a follow
snapshot's header. `unreadOf(conv)` is `updatedAt > lastSeen`. `firstOpen(conversations)` is the
first conversation not archived — the one every default opens: boot, Cancel, a missing id, the
rail's Messages key (which skips a `lastConv` since archived), the screen's fallback, the page
after an archive or a delete; an archived conversation opens by its own id alone.

**Views → messages** (`js/host/kinds.js`, pure). `toMessages(view, calls, now, speaker)` turns
one mapper view into zero, one or two messages `{id, seq?, at, from, kind, text, data, replace?,
merge?}`, ids minted from the host's own: `e<seq>` for a record, `t<callId>` for a tool row,
`r<callId>` for a receipt or refusal, the `eventId` for a gate.

| View | Message(s) |
|---|---|
| `bubble` role `operator`, source `user` or none | `from:"you"`, `kind:"text"` (the `mention` list rides in `data`) |
| `bubble` role `operator`, any other source (a compaction checkpoint, a plugin notice, a runtime snapshot, a member's delta) | `from:"system"` with `data.source` — drawn as a collapsed `context · <source>` details, never as the operator's bubble |
| `bubble` role `gravit` | `from: speaker` (`gravit`, or the bot in its home session), `data.markdown = true`, `interrupted` carried; an empty text that is not interrupted (a tool-only step) yields nothing — the tool row carries it |
| `bubble` role `bot` (a member's answer) | `from: <bot id>`, `data.name` the display name, `data.markdown = true` — a member writes the same markdown Gravit does; `data.memberSessionId` and `data.memberTurn` when the record names the member turn that produced it (its Trace reads them) |
| `room-line` | a system line, `roundEndLine(view)` |
| `subagent-message` | a system line, `Report from <child>: …` (no link yet) |
| `card` phase `call` | `kind:"tool"`, text = the mapper's title (a `bash` command) or the tool name, `data.args` from the `calls` map |
| `card` phase `result` | the same id with `merge: true` — `data.result`, `data.isError` fill the row, and the call's `name` and `args` when its `tool/call` was seen (the row draws the name and the payload folded; no result is dressed); for a seat write (the twelve, raw or minted) `seatLift` follows: `Card raised on the Account page · card-… · answer it there` (pending), `Order placed` / `Order canceled · <seat line> · ord-… [· paper]`, `Batch · n of m legs placed · k cards raised on the Account page · j refused` (in Guard the Account answers a leg with a card of its own, which is not a fill), or `kind:"refusal"` with `<code> · <message>` in the Account's words (dsh's `Error: ` prefix on a failed call's text stripped first) — each flagged `data.seat`, which adds the seat's standing to the app's reload of the page; a seat read lifts nothing |
| `approval` | `kind:"approval"` (tool name, `reason`, `displayReason`) for anything not the seat's, an old session's order of the retired pair included — or, for a seat tool (the twelve under any server, or anything under the face's own `mcp__account__` prefix, which the host cards) `Your call: <seat line>` with the line's venue as the chip, or `Account seat` when the tool names none. The title is made from the host's OWN reason line and nothing else — `reasonArgs` parses Gate 2's `<prefix> - <tool>: key=value …` back pair by pair (scalars coerced, `{k=v}` and `[1: …; 2: …]` read, a JSON-quoted value read as one value), and titles nothing when the line names another tool or no pair — never from a `tool/call` frame: the approval waterfall and the session's follow stream are two streams on one socket, so the call can reach the page after the gate, and a later call under the same id must never change a card the operator may be reading (the security reviews of 2026-10-21) |
| `question` | `kind:"question"` with the batch's questions |

The mapper's card keeps a title and not the arguments, so `rememberCall(calls, frame)` reads
every RAW `tool/call` frame first and keeps `{name, args}` by session and `callId` — the order line a card
and a receipt are joined on. A compaction checkpoint's `surfaceOp` becomes `replace: {start,
end}` on the message, and `hostEvent` removes every drawn message in that seq range except the
gates before inserting the summary.

**The store as a cache of the host** (`js/reducers/host.js`). `hostList` installs the list as
given, with the channel index (each row `{workspaceId, name, title, dir, isRoot, missingDir,
sessionIds}`), the bots' names (`[{id, name}]`, which every screen names a bot by) and the child
rows (kept when a list carries none), a surviving conversation keeping its window, its preview and
when that was read (`previewAt`), usage, thinking, its `subagentCatalog` and what the viewer saw; `hostWindow` installs a window WHOLE — a follow's snapshot or a page — never
appended to what was drawn; `hostEvent` inserts by `seq` (a `merge` message updates the row it
names, a repeated id draws once) and clears `thinking` for anything but the operator's own line;
`hostGate` lands a gate on its conversation after the last event it arrived behind (`seq =
max + 0.5`), keeps a replayed gate's answer, and parks a gate for a conversation the list does
not know yet in `orphanGates` (retried after every refresh); `hostGateGone` writes the end state
(`approved` / `rejected` / `answered` for this tab's own answer, `closed` for a withdrawal,
`elsewhere` for a lost race) — a withdrawal never overwrites this tab's answer, a lost race
always does; `hostProjection` takes `title`, `tokenUsage`,
`contextPressure`, `room` (the members, and the kind becomes `group`), `subagentCatalog` (kept as
the host sent it — the Children section validates it) and the face's own `running`; `markSeen`
records what the operator looked at.

**The live layer** (`js/host/live.js`). `startLive({store, openMux, call, mapFrame, getJson,
timers, now, onReceipt})` opens the mux and the control stream and returns `{open, promote,
refresh, reconcile, retryOrphans, answer, leave, close, mux}` (`leave` stops reading the
conversation that was on screen when the last open one was deleted and nothing took its place):
- **the list** — `refresh()` reads `session/list`, `/data/channels.json`, `/data/bots.json` and
  `/data/sessions-meta.json` together (each of the three `/data` reads keeping its last good
  answer through a failure), builds the member → bot map from the fold, dispatches `hostList`
  with the child rows, seeds every row's
  projection block (never a `cached` one — its watermark is not comparable), marks the open
  conversation seen, re-decides the open view (`reconcile`), re-lands the orphan gates, and
  fetches **previews**: for up to 12 rows other than the one on screen that were never read or
  whose session moved past the read (`updatedAt > previewAt`), one non-activating
  `session/projections` + `session/page` with `maxMessages: 1`, whose last SPOKEN line (through
  the kind table: never a context row) becomes the row's preview — a row read and found silent
  waits for activity, and the conversation on screen previews from its own window (`previewOf`
  in `render/rail.js`);
- **follow or page** — `open(id)` marks the conversation seen and reads it by `viewFor`: a LIVE
  one (`agentAvailable`) is FOLLOWED with the assistant stream, a COLD one is PAGED (upgrade
  decision D16: a follow activates a cold session, and a resume write-opens its log —
  `session.v4.jsonl.zstd`, `session.lock` — irreversibly). The snapshot or the page is folded
  through `hostEvent` on a scratch state and installed by `hostWindow`, its projections seeded,
  then the pending gates that belong to this conversation now re-dispatched behind it. `promote(id)` turns a paged
  view into a follow once this tab WROTE to it (`app.js` calls it after a prompt, a say, or a
  new conversation's first words — the write already activated it); the host's
  `api-session/added` or a list refresh showing it live does the same through `reconcile`;
  `api-session/removed` stops a follow and keeps the window; `onDown` suspends a follow (a
  re-open could activate); a follow the host ends is re-decided 2 s later; one it refuses is
  reported once (`<code> — <message>`, red) and not retried;
- **frames** — a pulse sets `thinking`; a `turn` frame sets `running` and schedules a refresh;
  a projection goes to `hostProjection`; everything else goes through `rememberCall` and
  `toMessages` to `hostEvent`, and a streamed `receipt` then calls `onReceipt()` — `app.js`
  reads the account again right after a fill (spec §6); a receipt folded into a window is
  history and calls nothing;
- **gates** — `onGate` maps the waterfall and keeps the gate in `pending` until it is over; every
  dispatch places it afresh (`placeGate`) — on its session's own conversation, on the room whose
  fold lists that session (in the member's bot name), or, while the list does not know the
  session, parked as an orphan: a gate replayed after a reload arrives before the list does.
  `answer(eventId, value)` answers through the mux, and once the answer wins the gate leaves
  `pending` (api.js reports nothing for a winner), so no later window load puts its keys back.
  `onGateGone` ends a gate `closed`, or `elsewhere` when this tab's answer had won — api.js
  reports such a gate only for a `cancel` that trailed the win, so another answer or a Stop
  settled it first;
- **host facts** — `added`, `activity`, `agent-preset/selected` schedule a refresh; `removed`
  clears `running` and stops the follow; `status` sets `running`; `error` reaches the status
  line when it names the conversation on screen.

**Actions** (`js/host/actions.js`). `send(text)` on the conversation on screen: a line starting
with `/` goes to `commands/execute` first (its result's text, or kind, on the status line — red
for an error; `undefined` means no command claimed it and the line continues as a prompt); an
`@` inside a channel goes to `/data/rooms/say` first (`addressed` non-empty means sent); else
`session/prompt`. `newConversation({title, workspaceId, text})` creates, renames when a title
was typed, prompts the first words, and returns the id. `answer(eventId, value)` answers
through the mux and writes this tab's outcome on the card at once. `stop(sessionId)` is
`session/cancel` and the line `Stopped. A paused goal resumes with /goal resume`;
`rename(sessionId, title)` is `session/rename`. The row actions: `fork(sessionId)` is
`session/fork`, one in flight per source, and resolves the child's id (`app.js` refreshes and
opens it); `archive(sessionId, archived)` posts the explicit boolean and refuses, without a call,
to archive while the conversation runs (`Stop Gravit first`) or a card waits on it (`Answer the
waiting card first`); `remove(sessionId)` deletes and refuses a running conversation (`Stop Gravit
first`); archiving or deleting the conversation on screen opens `firstOpen`, and after any list a
messages route whose conversation left it (deleted in another tab) does the same. `talkTo(bot)`
answers `{id}` — the bot's newest home conversation that is not archived, else a new one from
`session/create {cwd: bot.homeCwd, agentPreset: bot.id}` — or `{error}`, which `app.js` puts on
Discover's own line. `stopChild(parent, child, label)` sends `subagents/interruptByParent` in
continuable mode and says `Stopping <label>`. Every failure is one status line: `<what>: <code |
HTTP status | message>`, or `Not signed in — open the URL gravit-face printed` on a 401.

**Markets** (`js/host/markets.js`). `startMarkets({store, getJson, createLiveQuotes,
createSymbolSearch, storage, win, stream, schedule, cancelTimer, now, owner, afterAction})` returns `{show, search,
watch, unwatch, page, range, rowsInView, close}` — the Account's markets through the face's proxy
(§4.4) and the face's own wire for the A shares. `show(on)` (`app.js`: Markets on screen in a
visible tab) reads the explore read of the tab on screen at once and every `EXPLORE_MS` (20 s) —
All, Watching and All results with no query read All's `explore?limit=200`, a kind's tab its own
`explore?tab=<kind>&limit=200`, landing by tab — a tab changed while shown read at once, its poll
over from then; and every `QUOTES_MS` (5 s) `quotes?pairs=` for the most traded connected lines
(`pairsOf`) of the rows `rowsInView(ids)` last named — and for a market page's own key, which
`rowsInView` names on a page, when that market is no row of the tab on screen, the line its page's
view (`pageOf`) gives — `QUOTE_PAIRS` (twelve) a call, none while one is out; `show(false)` cancels
both and pauses the wire. Each kind of read is one flight: an
ask for the path in the air joins it, another path starts a read whose answer alone lands, and
nothing lands after `close()`; a read lands as data only when the body is `ok: true` with the list
the views read, and a refusal keeps the last rows with the Account's sentence (`message`), which
the next answer clears. `search(q)` reads `explore?q=<q>&limit=200` into `results`, the latest
search landing, and runs the face's symbol search for `cn` alone — once it succeeds, one
`/data/quotes?ids=` for up to `HIT_QUOTES` (30) hits through `parsePayload`, an older search's
late answer dropped; a blank query drops the read in the air, cancels the search and, through
`setMarketsQuery`, leaves All results for All. `page(id)` — the market page on screen, or `null`
— for an Account key reads `candles?venue=&symbol=&range=` at `followOf`'s line for the range
kept (1D until one is chosen; an answer for a range the page has left lands nowhere),
`compare?base=<base>&side=buy` for a coin's, a perpetual's or a stock's base, and follows that line on the
stream (`stream.follow(['<venue>:<symbol>'])`); a page whose market no read lists yet waits for
the read that does; leaving, or a page that is not the Account's, lets the follow go. `range(id,
value)` keeps the page's range (`setRange`) and reads its candles again. The stars: `watch(id)` /
`unwatch(id)` keep an Account key in the Account's store (`saveAccountWatch`,
`gravit.account.watch.v1`) and a `cn:` id on the face's list (`saveWatchlist`,
`gravit.market.watchlist.v1`, the asset as the screen knows it), at most `WATCH_LIMIT` (100) each:
a failed save keeps the new list in the store and reads `unsaved`, the 101st reads `full`, an
unreadable store reads `read`; `unwatch` of an Account key also takes off an old star found as it
(`forgetAsked`), and another tab's `storage` event reloads both stores. On a page that signs
(`owner.role === 'signs'`, stage 2 of the graft) a star on an Account key is the Account's own
watch list instead: `watch` signs `setWatch {venue, symbol, on: 'true'}` through
`owner.act` at the line `setWatchOf` names (the page's followed line when it is connected, else
a public listing by the venue it connects to), one click, no sheet, one in the air per market —
a key already starred on either list stays as it is, and one no line names goes to this
browser's store as before; `unwatch` signs `on: ''` for the page's own entry and takes the key
off this browser's store too; taken, `afterAction('setWatch', body)` reads the page again and
the star follows it; refused, the Account's sentence is the watchlist's words and neither list
changes. The Watching tab is the union: this browser's keys and the page's own `watch` as the
keys the reads list it under (`watchKeysOf`). On boot each old
`us:`/`crypto:` star is asked of the Account once, one at a time (`matchKey`: `explore?q=<symbol,
a coin's base>&limit=12`): a row of its kind with that base, in any case, is the star found
(`askedOfAccount`), and it moves to the Account's store when the write holds — else it stays on
the cn list, starred as that key; none is `Not listed at the Account`; a read that fails asks
nothing, for the next boot to ask again. The face's wire is handed the `cn:` ids alone — a cn
page's own first, then the cn list's — and its state reaches the store without its note
(`quotesUpdated`: the quotes, the providers, the connection).

**Account** (`js/host/account.js`). `startAccount({store, getJson, now, schedule, cancelTimer,
streamOpen, onPage})` returns `{load, loadHoldings, loadHistory, loadStatement, loadAgents, loadAll,
loadVenuesHere, loadPaperBooks, checkKeyfile, reach, poll, onStreamEvent, close}`, the Account's reads through the proxy into the `account` slice. Each kind
of read is one flight, the proxy's own rule: a plain ask joins the flight in the air for the same
path, a fresh one (`fresh=1`) joins only a fresh one and otherwise runs once the plain read settles
— one trailing read, never a pile; only the latest-started read of a kind lands, and nothing
after `close()`. `load({fresh})` reads `/data/account`: any 2xx answer that is not a refusal is
`accountLoaded` — one `pageOk` does not recognise too (the Account moved its API), which the
screens then draw as `Account unreadable`, never a figure from it; a refusal (an `ok: false` body,
on a 200 or not), any other non-2xx, an empty 2xx body or a rejection (with the body `getJsonVia`
carries on it, when it does) is `accountFailed` with the Account's sentence (`refusal.message`,
else `error`, when they are text), the last page kept. An unrecognised page leads no read, its
venues choosing no lens (`hasPaper` is `pageOk`-gated, as `worthOf` is). A recognised page naming a
paper venue reads the holdings and then the leading curve, unless a `loadAll` is about to, when its
lens has no data, or when the page before it was one `pageOk` did not recognise, whether the lens
was read before that or not: under that page no lens was read, whatever moved the money, and any
curve read was chosen without the page. After such a page the holdings are read past the face's
cache (`fresh`), which keeps a holdings answer 8 s and could hand back the lens from before a money
event.
`loadHoldings({fresh})` reads `holdings?cost=1` and, while the page — one the face recognises —
names a paper venue, its paper lens `holdings?cost=1&paper=1` beside it; `loadHistory(range)` sets the
range (`1d`, `1w`, `1m`, `all`; an unknown one leaves the slice's) and reads the leading curve —
`history?range=<r>&paper=1` when `worthOf` says Paper leads, else `history?range=<r>` — a read
for a range the screen has left dropped; `loadStatement({fresh})`; `loadAgents()`. `loadAll()`,
the snapshot's, reads the page fresh with the statement fresh and the agents, then the holdings
fresh once the page is in, then the history once the holdings are in. Every page that lands,
recognised or not, is handed to `onPage` after the slice takes it — `app.js` hands it
`owner.standing`. The connect and paper sheets' reads (stage 2): `loadVenuesHere()`
(`/data/account/venues`, where this account can connect), `loadPaperBooks()`
(`/data/account/paper/books`), `checkKeyfile({kind, venue, ref, exchange})`
(`/data/account/keyfile`, recording what it asked, so its words are drawn only for the form they
answer) and `reach(connector)` (`/data/account/connect/reach`), each one flight, a refusal
keeping the Account's sentence. `poll(true)` reads the page
every `ACCOUNT_POLL_MS` (20 s), `ACCOUNT_POLL_STREAM_MS` (80 s) while `streamOpen()`, decided as
each interval is armed, one timer however often it is called; `poll(false)` and `close()` cancel
it. `onStreamEvent({type})`: `order`, `fill`, `paper`, `balance`, `position` read the holdings and
the page fresh; `statement` the statement fresh; `card` the page fresh; `snapshot` `loadAll()`; a
burst in one tick joins the reads in the air.

**The stream** (`js/wire/account-stream.js`). `createAccountStream({createEventSource, fetcher,
schedule, cancelTimer, random, onStatus}, onEvent)` returns `{clientId, open, close, follow,
status, lastId}`: one `EventSource` per tab at `/data/account/stream?client=<id>`
(`&since=<the last frame id>` once one is known), the id minted once (`mintClientId`: `face-` and
twelve random bytes as 24 lower-case hex, the Account's grammar and the proxy's `STREAM_CLIENT`).
Each named frame of the Account's — `snapshot`, `order`, `fill`, `position`, `balance`, `paper`,
`statement`, `card`, `desk`, `quote`, `trades`, `book`, `hb` — reaches `onEvent` as `{type, id,
data}`; a frame whose data does not parse is dropped, its id still the resume point, and the
browser's own reconnects are left to it (it re-sends the newest id as `Last-Event-ID`). No sign
of life — the open or any frame, the Account's heartbeat among them — for `STALE_MS` (20 s) is
`stale`; for `DEAD_MS` (45 s) the source is dropped and opened again after the next `RETRY_MS`
step (1, 2, 5, 10, then 30 s, held at the last), as is a source the face refused (the browser's
`CLOSED`) or one that could not be made — back to the first step at the first frame. `follow(keys)`
keeps the set, deduplicated and cut at `FOLLOW_LIMIT` (16), and POSTs it to the bare
`/data/account/stream/markets` with `content-type: application/json` as `{client, markets, n}`,
`n` rising, on every open and on every change while open; a POST that is not 2xx, or throws, is
told once more a second later. `status()` is `idle`, `connecting`, `open`, `stale` or `closed`,
each change told to `onStatus` once (`app.js` re-arms the page's poll on a change to or from
`open`). `close()` drops the source and every timer and forgets neither the last id nor the set,
so the next `open()` resumes and tells it again. No DOM, no store, no visibility handling.

**The views** (`js/host/market-view.js`, `account-view.js`, pure; no icon the Account names
reaches anything they return). The Account's markets: `ACCOUNT_TABS` (All, Crypto, Stocks, RWAs,
Perps, Pre-IPO, Predictions), `ACCOUNT_SORTS` (Most traded, Biggest moves, Closing soonest),
`CANDLE_RANGES` (1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX); `isAccountKey` (`coin:`, `stock:`,
`perp:`, `rwa:`, `event:`, `preipo:`, `kalshi:`, `pm:`, `pmus:` — never a face id); `tabsOf` (All
first with the Account's count and the cn rows', the kinds the Account lists in `ACCOUNT_TABS`'s
order, All results leading while searching and Watching closing while anything is starred);
`priceOf` (a row's figures by kind: an event's price and 24-hour change in cents with no percent,
Kalshi's volume in contracts, a pre-IPO perpetual's implied valuation beside the contract's price,
dollars and the Account's 24-hour percent otherwise); `sourceWordOf` (the row's `quoteFrom`, else
the venue of its 24-hour change, else the first connected line's word — never a public line for
itself — with the age once more than five seconds old); `legsOf` (the lines, the connected ones
first, `best` the lowest ask among those that take an order now); `followOf` (the line a page
follows: the first connected, else the first public); `sortsOf`, `tableOf(markets, now)` (the
rows sorted by the sort in effect — the kept one when offered, else Most traded — the sorts
offered, the tabs, counted once All's read has answered, and the read the rows are from with the
Account's sentence) and `rowsOf` (its rows: the Account's with their tile word, figures, the price
shown — the latest quote at the most traded connected line where that says one, else the explore
read's — source word and lines; a tab's rows its own read's once answered, else All's of its kind;
the cn watchlist, or while searching the cn hits; an old star the Account's row or `Not listed at
the Account`; on Watching a starred key no read lists a placeholder, `Not in this read`);
`watchedOf`, `matchKey`, `pairsOf`; `pageOf(markets, account, id, now)` (a market's page: its item,
figures, price shown and source word, its lines in its unit, name, tile, sub, close, outcomes in
cents, whether it is a pre-IPO perpetual or starred, the candles for its range and that read's
state, the compare rows, what is held of it — the leading lens's assets of its base, the positions
at its lines — its open orders and statement lines, and what each part stands on, `reads.held`,
`reads.orders`, `reads.lines`, the first two `unreadable` under a page the face does not recognise);
`faceAssetOf`, `handWordsOf` (what Hand to Gravit names a market
by), `mentionsOf` (the conversations whose titles name it as a whole word, case-sensitive: its
symbol, a coin by its base, or a market with none by its name), `volumeWordOf` (`$1.9B`, `412k
contracts`, `2M shares`). The face's ids and the A shares' words from the wire's enums alone, as
before: `canonicalId` (`us:aapl` → `us:AAPL`, `crypto:btc-usd` → `crypto:BTC/USD`, anything else
`null`), `quoteWord`, `connectionWord`, `providerWord`, `basisWord`, `sourceWord`, `volumeWord`,
`searchWord`, `watchWord`. The Account's page, each view over the route's body as the store keeps
it and answering its empty shape for one it does not recognise (an amount that does not parse is
`null`, never `NaN` or 0): `pageOk` (the body is the page: `ok`, its venues, cards and orders, its
signers and `connectLive`), `headOf` (the mode, `Guard` or `Beast`, and the writes, `Trading on ·
$250 a move` or `Read-only`), `worthOf` (Net worth leads unless it is zero or does not parse while
a paper venue is connected and the paper lens has a total — then Paper leads), `changeOf`,
`assetsOf` (the largest value first, the unpriced last), `positionsOf` (the Account's order), `openOrdersOf` (open,
partial, pending; `You`, `Agent · <name>` by the page's keys, `An agent`), `missingWords`,
`statementLinesOf` (newest first), `statementCsvOf` (RFC 4180, CRLF, a `by` column, a text cell
that a spreadsheet would run as a formula led by an apostrophe), `venuesOf` (health from
`health[id]`, what it does, the paper flag, the Details facts with the key file's path only),
`agentsOf` (Gravit's row first from the seat view, its own agent matched by address — by name only
while the seat carries none — then the others), `cardsOf` (grouped by agent, What it asks as
sent), `asksOf`, `requestsOf`, and `seatWords` (the seat box's words). Stage 2 adds
`watchKeysOf(page, rows)` (the page's own watch list as the keys of the rows whose lines name each
entry), `setWatchOf(markets, page, id)` (`on`, the line a star would watch; `off`, the page's
own entry), `watchedOf`'s `page` (a market the page watches at any line is starred), and for the
connect and paper sheets `connectOptionsOf(page, venuesHere)` (the page's `connectLive.options`
with the venues read's verdict and words, `elsewhere` for one connected only on the Account's
page), `paperBooksOf` and `keyfileWords` (ready, the path, the names missing — never a value).

**The owner device** (`js/host/owner.js` over `js/wire/owner-key.js` and `key-store.js`; spec
§6.3, the owner path map `docs/research/2026-10-22-account-owner-path-map.md` §1–§2). The
Account's own `owner.js` under the face's names, its store, `post`, `subtle`, key store and flag
injected so the same module runs under Node in the tests and the graft smoke.
`startOwner({store, post, subtle, keys, flag, label = 'Gravit face'})` returns `{ready, standing,
prepare, submit, act, signOut, signIn, close}`; `postVia(fetch)` is the POST that never throws
(`{status, body}`, a thrown fetch the refusal `The account did not answer. Try again.` at status
0). The key: `makeKey` — `crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false,
['sign', 'verify'])`, never extractable — made on first need and kept in IndexedDB (database
`gravit-face-owner`, version 1, store `keys`, record `device`; `memoryKeys` where the browser has
none); its id `kidOf`, the first 16 hex of SHA-256 over the public JWK's `x ‖ y`, checked against
the pair answer (another kid is `The account named another key`). `ready(code?)` pairs:
`POST /data/account/pair {jwk: {kty, crv, x, y}, label, code?}` → the Account's role, `owner` ·
`pending` · `needs-code`, dispatched as `signs` · `pending` · `needs-code`; a code clears the
sign-out flag; signed out with no code, the role is `signed-out` and nothing is made or sent; no
WebCrypto, or a key that cannot be made, is `none`; one pairing at a time (a plain ask joins the
one in the air, a code or a sign-in runs after it). `standing(page)` reads every page the face
recognises: this key's `device:<kid>` among `signers.owners` signs, among
`signers.pendingDevices` waits; in neither after it signed or waited (the Account restarted and
lost its pending list, or an owner dropped the device) it pairs again — never while a sign-out is
in the air; a page that never paired asks the door once while that ask stands. The roles are
`unknown | signs | pending | needs-code | signed-out | none`. `prepare(draft)` is
`POST /data/account/prepare {draft}`, the answer as it came. `submit(prepared)` signs only on a
page that signs with a kept key: `signingInput` — `message = {accountChain, …every shown field's
name → value}`, `canonical({domain, primaryType, message})` with keys sorted recursively,
`undefined` dropped, no whitespace — ECDSA P-256 / SHA-256 over its UTF-8 bytes, the raw `r ‖ s`
as base64url without padding (`signPrepared` → `{kid, es256}`), then `POST /data/account/exchange
{action: prepared.action, nonce: prepared.action.nonce, signature}`; the nonce is prepare's, on the
Account's clock. A 401 `E_ACCOUNT_BAD_SIGNATURE` on a page that signs pairs again (the standing
read anew) and keeps the Account's words on the device line; an exchange the Account takes clears
them. `act(draft)` is prepare, then sign only a preparation that came back with fields to show.
`signOut()` acts `signOut {device: 'device:<kid>'}` and, taken (`refusedAt` false — a 200 that is
a refusal leaves the device as it was), sets the flag (`gravit.owner.signedOut.v1` = `1`) and
deletes the key; a sign-out signed through a sheet ends the device the same way; nothing pairs
while one is in the air, and a pair answer from before it is dropped. `signIn()` clears the flag
and pairs a new key. The host dispatches `ownerStanding`, `ownerRefusal` and `ownerBusy`, owns no
screen words, and logs nothing of a key, a code or an envelope. The face process holds no key and
signs nothing; `threshold` is never raised.

**The owner sheet** (`js/host/sheet.js` over `sheet-view.js` and `owner-view.js`). Every owner
action but a star and a Cancel is prepare → *What you sign* → sign: the Account's own
`quoteDialog` as a face drawer. `startSheet({store, owner, schedule, cancelTimer, now,
afterAction, onChange})` returns `{open, change, prepareNow, submit, again, close}`.
`open(kind, seed, fields?)` opens a sheet of one of `SHEET_KINDS` (`letIn`, `limit`, `endLimit`,
`revoke`, `connect`, `paper`, `topUp`, `resetPaper`, `disconnect`, `approveCard`, `declineAsk`,
`letDevice`, `signOut`, `order`) with `fieldsOf(kind, seed)` and prepares it at once when
`draftOf(kind, fields, seed, now)` is a draft — else the sheet is `incomplete` with the words for
what is missing. The drafts are the Account's own types, nothing added: `approveAgent` (Let in, 1
· 7 · 30 · 90 days; Revoke with the zero address and `validUntil: 0`), `approveSpend {agent,
scope: 'trade', allow, perPayment, budget, windowHours: 0, validUntil}` (Give a limit — `allow` a
pick of the seed's venues, paper first, `*` never; End limit at `'0'`, `'0'` for a day),
`connectVenue` (a key-file connector with its venue, label and key file's path — an exchange
account signs `live:exchange:<exchange>`, and anything not connected by a key file reads `Connect
on the Account page`; a paper account `live:paper` with its starting dollars, a new id
`paper-<slug of its name>` with `-2`, `-3`… past one in use, or `''` to continue a kept book),
`topUpPaper`, `resetPaper`, `disconnectVenue`, `approveCard {card, action: hash, decision}`,
`answerAsk {ask, decision: 'decline'}`, `convertToMultiSigUser {signers: JSON of {authorizedUsers:
the owners and the new device sorted without repeats, threshold: 1}}` (Let it sign; with no owner
device to keep, nothing is drafted), `signOut`, and the Trade ticket's `liveOrder`
(`tradeDraftOf`). The seeds from the page: `limitSeedOf(page, address, name)` (the venues and the
agent's standing trade limit, which the form starts from), `letDeviceSeedOf(page, owner, kid)`
(the page's owners and this page's own device, once each), `paperSeedOf(page, books)`,
`grantOf(ask, page)` (an ask for a limit or a venue → `limit`, a knock → `letIn`, a top-up →
`topUp`; a session, leverage or the mode is the Account page's: none), and for a connect sheet
`keyfileAskOf` and `reachAskOf`, the checks `app.js` asks after the sheet's quiet.
`change(name, value)` takes the field at once and prepares again after `PREPARE_QUIET_MS` (300 ms)
without another change — a quiet ask, which keeps the shown preparation until the new one lands.
`askedOf(sheet)` is the form's draft read at time zero (a `validUntil` is an offset of `now`, so
the same form is the same string a minute on); the go key is on only while the sheet is `ready` and
`askedOf(sheet) === sheet.asked`, and *What you sign* (every `shown[]` field verbatim, `name:
value`, the nonce among them) dims while they differ. `submit()` signs the shown preparation —
never one whose draft is not the form's (that prepares again instead), never one with less than
`RESIGN_UNDER_MS` (30 s) left on its `deadline` (that prepares again and signs the fresh one in
the same press, while it is still the form's). A deadline counts down every second
(`goodForWords`: `Your signature is good for m:ss more.`) and prepares again at zero. The answer is
read as the Account's page reads it (`refusedAt`: no answer, a 4xx or 5xx, `ok: false`, or a
`kind: 'result'` whose `result.ok === false` — a rejected card answers so on a 200): a refusal is
`sheetRefused` with the Account's sentence (`Refused` when it gave none) and `again` for
`E_ACCOUNT_REQUOTE` or `E_ACCOUNT_EXPIRED` (the Prepare again key); a taken one `sheetDone` with
what it said (`saidOf`: `ord-0011 · open on the book`, the Account's summary, `Done`), then
`afterAction(kind, body)` — run whether or not the sheet is still open, whatever a subscriber did.
Only the latest ask lands; an ask in the air never lands over a sign; `close()` cancels every
timer and drops every answer in the air. `FRESH_MS` (3 s) is the Trade ticket's.

**Trade** (`js/host/trade.js` over `trade-view.js`; spec §6.4). `startTrade({store, getJson,
owner, sheet, stream, schedule, cancelTimer, now, afterAction})` returns `{show, kind, query, pick,
resume, venue, outcome, closeTicket, cancel, onStreamEvent, close}`. `show(on)` (Trade on screen
in a visible tab) reads the kind's picks, `explore?tab=<kind>&limit=12` (`PICK_LIMIT`), at once
and every `PICKS_MS` (20 s), one flight per kind; `kind(k)` is one of `TRADE_KINDS` — Crypto ·
Stocks · RWAs · Predictions, the Account's own tabs; perpetuals and pre-IPO contracts are listed,
not traded from the face (`tradeableOf`); `query(q)` is the trade search's own read
(`explore?q=<q>&limit=12`, into `trade.results`, apart from the Markets search). `pick(id, {side,
venue, outcome})` opens the ticket (`ticketOf`: the market's lines, connected first, `able` where
the venue trades at the Account, `best` the able line that takes an order now with the lowest ask;
a prediction's outcomes in cents with their lines) and the `order` sheet seeded with it
(`seed.ticket`), at the venue given where it takes the order, else the best able line, nothing
typed; that line — a prediction's, the picked outcome's — is followed on the tab's stream. A venue
or outcome change re-seeds the sheet with its fields kept and re-follows; `resume(fields)` seeds the
open ticket again after another sheet took its place. The draft (`tradeDraftOf`) is the Account's
`liveOrder`: `type`, `venue`, `symbol`, `side`, `orderType`, `qty` or `usd` as typed,
`limitPrice` (a prediction's typed in cents, sent in dollars to six places), `extendedHours: 'true'`
only on a limit, ticked, where the line offers it, and `stopPrice`, `tif`, `postOnly`,
`reduceOnly`, `trailPercent`, `trailPrice`, `takeProfit`, `stopLoss` always `''` — no clock in it;
prepare adds `maxNotional` and `deadline` (ten minutes out), so the signature covers seventeen
fields and the nonce. A live `quote` frame for the followed line prepares again, quietly, only once
the market moved from the top the shown preparation landed at (the Account's `preparedTop`: a
buy's ask, a sell's bid, else the last trade, else the mark — never the order's own price, a
limit's being the limit), while that preparation is ready, at least `FRESH_MS` old and still the
form's, one at a time per ticket; with no frame seen when it landed, the first frame sets the top
and asks nothing. A `fill` frame is said (`fillWords`: `Bought 0.04 ETH @ 3,120.50 · Stand-in
Exchange`, `· Paper account` from a paper book). `cancel(venue, order)` is one click —
`liveCancel {venue, order}` through `owner.act`, no sheet, once while it is in the air — its
answer said (`tradeSaid`) and, taken, `afterAction('cancel', body)`. `closeTicket()` closes the
sheet with it and releases the follow this host holds; `close()` stops the poll, and nothing lands
after. Under way is `underWayOf(page)`: the page's working orders, anyone's, each with its
`liveCancel` seed or none.

**Channels** (`js/host/channels.js`). `startChannels({store, postJson, getJson, refresh, now})`
returns `{overview, create, agentChoices, setAgents, setBots}`. `overview(workspaceId)` posts the
overview and lands it as `channelLoaded`, only the latest-started read landing; a failure is
`channelFailed`, which keeps that channel's data (stamped stale by the page), a 404 reading
`missing`. `create(name)` folds the name (`foldChannelName`), refuses one the face's `NAME_RE`
would refuse (or `_template`) before any post with `Letters, digits, - or _`, posts it, refreshes
the list and answers `{workspaceId}` of the channel whose `dir` the route answered, or `{error}`.
`agentChoices()` is the connected CLI agents that answered (`/data/agents.json`'s `local` rows
with `found`), `[]` on a failure. `setAgents` and `setBots` post the roster (`setBots` refuses more
than `MAX_BOTS`, six, before the post) and re-read the overview: each answers `{ok: true}` or
`{error: <the route's words>}` for the editor that asked.

**Discover** (`js/host/discover.js`). `startDiscover({store, getJson, postJson, call, now})`
returns `{load, read, gravit, skill, connect, disconnect, rescan, modelChoices, saveBot,
createBot}`. `load()` reads the four listings (`SHELF_PATHS`: plugins, bots, agents, memory), each
alone — a plain read joins its shelf's flight, a read after a write (`read(shelf, {fresh:
true})`) starts a fresh one, and only the latest-started read of a shelf lands; a listing without
its array is a failure, and `shelfFailed` keeps the last good one. `gravit()` makes the Gravit
item's three reads, each failing alone (`gravitLoaded {host, model, keys}`, each the value, or
`false` when its read failed; the model is the catalog's `default`, `null` when it names none);
`GRAVIT_KEYS` is `DEEPSEEK_API_KEY` alone (the face reads no other key since 2026-10-24). `skill(name)`
reads a skill's content once. `connect(bin)`, `disconnect(bin)` and `rescan()` post, put a
refusal on Discover's line (`connect: binary did not answer on this machine`), and read the
agents again (rescan answers the listing itself). `modelChoices()` reads `session/modelCatalog`
once into `discover.models` (`botModelChoices`: `{value: 'provider/model', label}` pairs).
`saveBot(bot, fields)` posts `botSettingsPayload(bot, fields)` (a model route that is not one is
refused before the post, in `normalizeBotModel`'s words) and answers `'saved'`, `'stale'` (the
face's `changed since this view was loaded`: the line says `Changed elsewhere — reloaded`) or
`'failed'`; a `bots/<id> was saved, but …` 500 counts as saved with those words on the line; every
outcome but a plain failure re-reads the bots. `createBot({name, id, description, model, soul})`
leaves blank fields to the face, refuses a nameless bot (`Give it a name`) and a name with no ASCII
letters and no id (`Give it an id: a-z, 0-9, -`) before the post, re-reads the bots, and answers
the new id (from the route's `{ok, bot}`) or `{error}`.

**Traces** (`js/host/traces.js`). `startTraces({store, call, loadMemberTrace, now})` returns
`{open(convId, msgId)}`: once per answer — an answer is its conversation and message id, since a
message id is its log's sequence and two rooms repeat them (a failed one may be opened again),
`loadMemberTrace(call, {sessionId: data.memberSessionId, turn: data.memberTurn})` — the projections
cut, then the history paged back until the turn is found, never a follow — and its views folded
through `toMessages` and `hostEvent` on a scratch conversation, as a window is, into
`traceLoaded {convId, msgId, messages}`; a loader error lands as its English words (`traceFailed`).

**Stage 3's views** (pure). `groupsOf(state)` (`js/host/list-view.js`) orders grouping.js's
buckets: every channel a group, an empty one too (a new channel's page is reachable from the
list), the root first, then each group by its newest conversation, the empty channels by name; a
bot's home sessions under the bot (`bot:<id>`), the rest under `No channel`; `Archived` last. Each
group is `{key, label, kind, workspaceId, isRoot, conversations, collapsed, shown}`: a channel goes
by `channelLabel` (its display title, else its name — the label New message's Where and Details
use too), `collapsed` is the viewer's `collapsed[key]`, else true for Archived alone, and a
collapsed group shows only the conversation on screen. `itemsOf(discover)` (`discover-view.js`)
turns the listings into cards under namespaced ids — `mcp:<server>` with its tool count on Data,
`bot:<id>` on Bots (never the default composition), `agent:gravit` first then the connected and
the found CLI agents (`agent:<bin>`, `Connected`, `Not found`, `Found · <version>`) on Agents,
`skill:<name>` with its group on Skills; `searchItems` matches name and line, `itemById` finds an
item for its page. `childrenOf(conv, childRows)` (`children-view.js`) composes the parent's
`subagentCatalog` with the child rows (`composeSubagentCatalog` → `normalizeSubagentCatalog` →
`subagentControls`): `{children: [{id, label, mode, state, canStop}], unavailable}` — a malformed
catalog is unavailable, never an empty list; an unknown-mode entry is `unavailable` and never
stoppable; `canStop` is a running continuable child.

### 5.4 Rendering

`boot(win, host)` builds the store (`makeStore`: the prefs, never a saved state), starts the live
layer and the actions, sets the markdown hook (`setMarkdown` in `render/thread.js` — the DOM-built
`gravitMarkdown` — `renderMarkdown(text).node.outerHTML`; tests hand in a stub or none, and with none set Gravit's text is
escaped), makes the tab's Account stream (`createAccountStream` over `win.EventSource`,
`win.fetch`, the app's timers and `win.crypto`; opened at boot while the tab is visible, closed
while it is hidden), starts `startAccount` (and reads the page at once) and `startSeat`, then
`startMarkets` (the Account's reads on the app's timers, the stream, the wire's quote and search
factories over `win.fetch` and `win.EventSource` for the A shares, the browser's storage),
`startChannels`, `startDiscover` and `startTraces`, and renders on every store change. Since the
graft's stage 2 it starts the owner device first (`startOwner` over `win.crypto.subtle`,
`indexedDbKeys(win.indexedDB)` — `memoryKeys()` where there is none — `signedOutFlag(storage)` and
`postVia(win.fetch)`; `startAccount`'s `onPage` hands every page to `owner.standing`, so the first
page pairs it once), then `startSheet` (its `afterAction` reads the page, the holdings and the
statement past the cache, the seat too after `letIn`, `limit`, `endLimit` or `revoke`, and closes a
done sheet but the order's; its `onChange` runs a connect sheet's key-file and reach checks after
the sheet's 300 ms quiet, each only when what it asks changed), hands `startMarkets` the owner and
`afterAction`, and starts `startTrade` over the sheet and the stream; a stream event reaches the
trade host too. One render is one string — `renderRail(state)` + the screen
(`renderMessagesScreen`, `renderChannelScreen`, `renderMarketsScreen`, `renderTradeScreen`,
`renderDiscover`, `renderPlugin` or `renderAccountScreen`) (+ `renderSettings` when the drawer is
open, + `renderSheet` while a sheet other than the ticket's is open) — written to
`#app.innerHTML`; the loop first records and then restores what the person had: focus and caret
(by element id, else the control's data attributes), the typed value of every input with an id
(an editor's box only while the same editor stays open; New message's Where select never — its
channel is the store's), the ticked radios and checkboxes with an id (a question card's picks, the
person's own until they press Answer), every `<details>` with an id the person had open (a tool
row, its Raw, a Trace — open again by id), the composer's words (kept in a closure,
`composerText`, never in the store), the scroll of the rows, the main pane on the same screen, a
drawer body while it is the same drawer, and the thread's position while the person reads up,
however much arrives (at the bottom, or on another conversation, the thread follows the tail).
After a Markets render the ids of the rows drawn go to `markets.rowsInView` — on a market's page,
which draws none, the page's own key — so the quotes poll asks for what is on screen. While an IME composes (pinyin), renders
are held until `compositionend`; while a primary press is down they are held too — at most
`POINTER_HOLD_MS` (1 s), a `pointercancel` or a blur ends it — so a quote tick (the page renders on
each, about twice a second while a coin streams) cannot replace the element a click is aimed at,
and the held render lands after the click. Clicks are delegated by `data-action` (`open`, `startDraft`,
`cancelDraft`, `toggleRail`, `toggleGroup`, `changeWords`/`commitEdit`/`cancelEdit`,
`stopGravit`/`confirmYes`/`cancelConfirm`, `suggest`, `answer`, `answerQuestion`,
`toggleDetails`, `openSettings`/`closeSettings`, `setTheme`; the row actions `fork`, `archive`,
`unarchive`, `deleteConv`; the research surfaces' `stopChild` and `openTrace`; a channel page's
`newRound`, `channelRetry`, `editRoster`; Discover's `shelfRetry`, `connectAgent`,
`disconnectAgent`, `rescanAgents`, `talkTo`, `editBot`; Markets' `mkTab`, `mkSort`, `mkClear`,
`toggleWatch` (on or off as the star is drawn, `watchedOf`), `removeAsked`, `openMarket`,
`setRange`, `handToGravit`; Account's `refreshAccount` (the page and the seat past the cache, the
holdings), `setHistoryRange`, `openVenueDetails`/`closeVenueDetails`,
`openStatement`/`closeStatement`, `exportStatement`; the owner device's `pairDevice` (the code in
`#pair-code`, on Pair or on the pair form's submit — Enter in the box — held while a pairing is in the
air), `signIn`, `signOut` and `letDevice` (each a sheet but Sign in), `openSheet` (an
owner key's sheet, its seed built from the store by `data-kind` and the key's data — the connect
and paper sheets once their read lands), `askRevoke`/`askDisconnect` (asked in place, then their
sheet on `confirmYes`), `grant` (`grantOf`'s sheet), the sheet's `sheetField`, `sheetSubmit`,
`sheetAgain`, `sheetClose`; Trade's `tradeKind`, `pickMarket`, `openTicket` (a market page's Buy or
Sell: `#/trade/<id>` with the ticket on that side), `ticketVenue`, `ticketSide`, `ticketOutcome`,
`closeTicket`, `toggleSigns`, `cancelOrder` — every owner key acting only while the page signs); a
disclosure's own key (Trace's `<summary>`)
toggles its `<details>` itself and cancels the browser's toggle — the action's first dispatch
re-renders inside the click, so the browser would toggle the element the render replaced — and
its action runs on opening only; typing in `#mq` (`mkQuery`) sets the query at once
and searches once the box has been quiet for `SEARCH_QUIET_MS` (300 ms; a blank box at once), in
`#dq` (`dq`) Discover's query; choosing `New channel…` in Where opens its name
box, any other channel is `setDraftWhere`; a roster box's change is `toggleRosterTick`; a sheet's
or the ticket's field (`sheetField`, `ticketField`) changes the sheet (a box by `checked`, a pick's
boxes as the values ticked), and the ticket's venue or outcome re-seeds it at the new line; typing
in `#tq` (`tradeQuery`) searches Trade after the same quiet; the composer's `submit` is `send`, a
bot editor's `saveBot`, the Create page's `createBot`, the ticket's `placeOrder` the sheet's
submit; Escape cancels an editor, a confirm, or closes the sheet first, then a drawer (Details,
Settings, the Statement, a venue's Details), then Trade's ticket; Enter commits an inline editor.

**Routes** — `#/messages/<sessionId>`, `#/messages/new`; `#/markets` and `#/markets/<id>` with
an Account key (`coin:BTC`, `stock:NVDA`, `event:<venue>:<market>`, kept whole) or a face id
(`cn:600519`, canonicalised; an old `us:AAPL` or `crypto:BTC/USD` too) — the id is everything
after `#/markets/`, so a coin keeps its slash; a percent-encoded link is decoded; one that is
neither opens Markets; `#/channel/<workspaceId>`; `#/discover`, `#/discover/<shelf>` (`data`,
`bots`, `agents`, `skills`), `#/discover/create`; `#/plugin/<id>` (a channel's and a plugin's id
are read like a market's: everything after the screen, decoded); `#/account/portfolio`,
`#/account/venues`, `#/account/agents`, `#/account/cards` (an unknown tab is Portfolio);
`#/trade` and `#/trade/<id>` (since the graft's stage 2: Trade, `<id>` an Account key read like a
market's, whose ticket opens on entering — a buy, or the side a market page's Buy or Sell asked
for; a market the ticket does not trade opens none). `routeOf` folds every other route to
Messages (`#/mail` included), and `settle` rewrites the address bar when it normalised one.
Leaving Trade closes its ticket and lets its line go before a market's page follows its own;
Trade's picks are read only on Trade in a visible tab (`trade.show`). `hashchange` →
`follow()`: the conversation the route names is handed to `live.open` once; a deep link the list
has not answered yet waits for the `hostList` that carries it, and with no conversation on screen
the list's first open conversation (`firstOpen`) is opened; when the last open conversation was
deleted and nothing took its place, `live.leave()`; Markets' reads and the A shares' wire run only
on Markets in a visible tab (`markets.show`), and the Account's page is polled only on Account in
a visible tab (`account.poll`); entering Account reads the page (past the cache when it opens on
Cards), and each tab what it draws on entering it — Portfolio the holdings and then the curve,
Venues the seat, Agents the agents and the seat, Cards the page past the cache; a market's page
(an Account key) is handed to `markets.page` and reads the holdings and the statement, and leaving
it hands `null`; `visibilitychange` re-decides both screens and closes the Account stream while the
tab is hidden, opening it again when the tab returns; entering a channel's page reads its overview
once; entering Discover from outside it (a shelf or an item's page included) reads the four
listings; an item's page reads its own cards on opening (the Gravit item's three reads, a skill's
content), the Create page the model routes.

**The rail** (`render/rail.js`) — the first level: the brand, Messages (its badge counts the
conversations with a card waiting on you; current on a channel's page too), Markets (`#/markets`,
current on Markets and a market's page), Trade (`#/trade`), Discover (`#/discover`, current on Discover and an item's
page), Settings at the foot, Account (`#/account/portfolio`, current on Account, with the
Account's leading figure under it once its page has answered — `· Paper` when Paper leads — and a
badge counting the cards waiting there); it collapses to a strip of icons. The second level, on
Messages and beside a channel's page: the new-message key, then the groups (`groupsOf`, §5.3) —
each a head (its fold key, `Collapse <label>` / `Expand <label>`; a channel's name a link to its
page, marked while that page is open) and its rows, newest first — the unread dot (`unreadOf`),
the avatar by kind (a bot's letter, a cluster for a group), the title, `rowTime`, the preview (the
host's one-message page; until it lands, the last message drawn). A folded group shows only the
conversation on screen; Archived is last and folded until opened.

**The screen** (`render/messages.js`) — the head (the title; a centred cluster, the member
names and count for a group; `Working` while `running`; the Details key), the thread, the
composer (`Tell Gravit…`, `… @ a bot by name` in a group) and the status line (`role="status"`,
`.bad` red). **Details** carries This task (the title with `Change words` → an inline editor →
`session/rename`; Created from the snapshot header; Where — the channel by its title, or `Default
directory`; Agent — Gravit or the bot; `Archived · By the host` for the host's own archive) and
its row keys — `Change words`; `Fork` once there is something to fork (dsh forks from a completed
turn); `Archive`, or `Un-archive` for the face's own archive; `Delete`, asked twice (`Yes,
delete`) — Archive and Delete absent while Gravit runs or a card waits; Members for a group;
**Children** when the conversation's catalog names any (`childrenOf`: the label, `One-shot` or
`Continuable`, `Running` / `Not running` / `Unknown` / `Unavailable`, and `Stop` — asked twice,
`Yes, stop` — on a running continuable child; `Children unavailable` for a malformed catalog);
Usage from the projections (Tokens in = uncached input + cache reads, Tokens out, Context as a
percentage) and `Stop Gravit` while running, a two-step confirm. **New message** is a title
(`Name this (or your first line is the name)`), Where — a select of the channels by their titles,
the root first, then `New channel…`, which opens a name box under it (a refusal stays in the box;
the new channel is selected once it exists) — and the composer; the first words create, name and
prompt, then the new conversation is opened and promoted to a follow. The **empty
state** (no conversations) offers three suggestion chips that fill the composer. **Settings** is
the theme (Cream · Black · System).

**The thread** (`render/thread.js`) — the operator's words right in the primary bubble, Gravit's
left in grey through the markdown hook (headings, lists, code, quotes, GFM tables in the
`.viz-table` style, links coloured and underlined; an interrupted answer is cut-marked
`Interrupted`); a
bot's words in a group under its sender name, through the same markdown hook; a system line centred; a context row a collapsed
`<details class="sysline ctx">` headed `context · <source>`; a tool row a collapsed `<details
id="tool-<callId>" class="tool">` titled by the call, `running` until the result fills it,
`.danger` on error — the result its `<pre>` (no result is dressed, below); a room member's answer that names
its member turn followed by a `Trace` disclosure (`trace-<sessionId>-<msgId>`), read on opening: `Loading…`,
the turn's steps (its tool rows drawn as the thread draws them, its context lines), the loader's
words, or `No steps`; the seat's card (`Your call: …`, the venue chip and the reason, ✗ Decline then ✓ Approve →
`rejected` / `allowed-once`); the approval card (the tool name, the display reason, the audit
reason only when it differs, the same two keys); the question card (`data-gate="<eventId>"`;
every question with its inputs named and id'd `q-<eventId>-<questionId>`, so two pending cards
never share a radio group, radio or checkbox by `multiSelect`, and a free-answer box beside
every question — `Other…` beside a menu, `Your answer` without — which is dsh's `custom`; one
Answer key for the batch); a receipt a green bubble; a refusal a red card
with the code. An answered or closed gate shows its end state as a chip — `Approved`,
`Declined`, `Answered`, `Closed`, `Settled elsewhere` — and no keys. Dividers after a
15-minute gap; the three-dot thinking row at the tail while the host streams a turn.

**Markets** (`render/markets.js`, every figure and word about a market a view's — `tableOf`'s,
`pageOf`'s) — the head (`Markets`, the
search box `#mq`, `Search markets`); the tabs (`tabsOf`: All, the Account's kinds where it lists
something, each with the Account's count once All's read has answered; All results while
searching, Watching once anything is starred); the sort seg Most traded · Biggest moves, and
Closing soonest where a row closes (two or more rows); and one table — the star (`Watch BTC` /
`Stop watching BTC`; `Remove` for an old star `Not listed at the Account`), the name (`mkAv`'s tile
of the face's own letters, the name over its sub, `Closed` past its end, `Paper` where only a
paper account trades it first; a market no read lists, `Not in this read`, and a star not listed
open no page), the price in its unit (`$63,226.60`, `62¢`, `¥1,688.00`), the 24 hours (the arrow,
`up`/`down` for a screen reader, the percent or an event's cents), the volume (`$1.9B`, `412k
contracts`, `2M shares`) and Source (the Account's words for where the price is from, with its
age); with a query, `N markets for “q”` and Clear. With no rows: `Nothing watched yet`, `No
markets`, `Loading…` or `Searching…`, `Markets unavailable` or `Search is unavailable`. The muted
lines: the Account's sentence from the read the rows are from, the A-share search's failure or
partial answer while searching, the face's wire's connection where an A share is drawn, the
watchlist's trouble (a refused `setWatch` among it, in the Account's words). On a page that signs
the star of an Account row signs the Account's own watch (§5.3). No image the Account names.

**A market's page** (`#/markets/<id>`, `marketPage` over `pageOf`) — `‹ Markets`; the head (the
tile, the name, the kind and the symbol at the line it follows, or an event's category and
`closes <date>`; `Closed` past its end) with — on a page that signs, for a market of a Trade kind
(`tradeableOf`) — **Buy**, and **Sell** where something of it is held, each `openTicket` (Trade on
the market, the ticket on that side), then Hand to Gravit (a new message in the root channel
with `Look at <base> (<name>)` in the composer, `handWordsOf`) and Watch / Watching; the price (the
stream's or the quotes poll's for the line it follows, else the explore read's) with the explore
read's 24 hours, an event's outcomes in cents, where the price is from with its age, and the facts
24h volume and Venues. **Price history**: the `CANDLE_RANGES` seg (`setRange`, naming the page),
the range's closes once a candles read answered (`candlesSvg`: the closes as an area and a line in
the box the three charts share, the low and the high touching the margins, the axis at the first
and last bars' times on the operator's clock, an event's in cents; the Account's `ends` and `note`
under it), `No history` for fewer than two, `Loading…` while a range not drawn yet is read, the
Account's sentence or `History unavailable` over a failed read, the closes kept while the range is
read again. **Across venues**: each line with its price in the market's unit, `Best`, `Paper`, and
for a public listing `Connect to trade` (a link to `#/account/venues`). **You hold**, **Open
orders** (no section once the page has answered with none), **Gravit on it** (the conversations
naming it, as links, when there are any) and **On the statement** (`✓` on a filled or settled
line; `Open the Statement →`), each on its own read (`reads`): `Loading…` until it answers, its
empty words — `You don’t hold any.`, `Nothing on the statement about it yet.` — only after an
answer, `Holdings unavailable`, `Account unavailable` or `Statement unavailable` under the
Account's sentence when it failed before any answer, and the lines it read kept under a later
refusal; You hold and Open orders read `Account unreadable` while the Account's page is one the
face does not recognise (`reads.held.unreadable`, `reads.orders.unreadable`: which lens leads, and
what is working, are the page's to say). The compare rows are read and not drawn. A `cn:` page is the face's own quote: the
price, the change with its basis, `as of 14:30 · Live`, the facts Previous close, Volume, Source,
Gravit on it.

**Account** (`render/account.js`, every figure and word a view's) — the head (`Account`, the mode
and writes chips from `headOf`, Refresh, Settings) and under it the device line (`renderDeviceLine`,
below), the Account's refusal sentence as a muted line when it gave one, and the tabs Portfolio ·
Venues · Agents · Cards (`Cards · N` while cards wait). The owner's keys below are drawn only
while `owner.role === 'signs'` — absent, not disabled, otherwise: the device line says why.
**Portfolio**: the leading figure with its label (`Net worth`, or `Paper` when Paper leads) and the
second beside it, smaller; the change line in one run (the change — `—` when the Account gave none
— the range, `partial`, since when on All, and on the paper curve `since start <signed dollars>`
and `rebuilt`); the 1D · 1W · 1M · All seg (`setHistoryRange`); the curve (`curveSvg`, labelled by
the leading figure); the venues a read could not reach; the stale stamp and Retry after a failure,
and the Statement key; **Assets** (each asset's venues under it; Asset · Amount · Price · 24h ·
Value) and **Positions** (Position · Value · Entry · Mark · P&L, `Paper`), the leading lens's —
the lens's refusal sentence where `Holdings unavailable` would be; **Open orders** (`orderWords`,
with whose each is; `No open orders`). Before the page: `Loading…`, `Account unavailable` with
Retry, `Account unreadable` for a page the face does not recognise. **Venues**: each venue's
value, front line and what it trades, its health (`Not answering since 14:02`), what it does,
`Paper`, stale, and **Details** — a drawer (`venueDetails`: its holdings and the Account's facts
under their labels, the key file by its path, `No details`; a paper venue's **Top up** and
**Start over**) that takes focus and closes on Escape — and **Disconnect…** (asked in place,
`Yes, disconnect`; none on an agent wallet); under the list **Connect an account** and **Open a
paper account**; the `A-share quotes` line from the face's iFinD provider (`markets.providers`, which the
wire fills once it has quoted an A share and empties when it is handed none — so the line stands
only while an A share is on the cn list, once Markets has been opened); the Account seat box (the
service with the Account's own mode and writes, the seat and its limits, the venues with `Paper`
chips, the cards waiting, the stamp, and the link to the Account page). **Agents**: Gravit's seat
first (its standing and limits in the seat box's words, `Cards N · Open orders N`, `—` while the
agents are unread; no keys — the seat is admitted at the Account), then the others with their
status, until when and limits — each with **Give a limit…**, **End limit** on each standing trade
limit, **Revoke…** (asked in place, `Yes, revoke`) — and `Knocking` keys, each with **Let in…**;
`Loading…`, `Agents unavailable`, `No agents`. **Cards**: `Waiting for you` grouped by agent — each
card's reason, value, answer-by time and `What it asks` (a disclosure of every signed field
verbatim), with **✓ Approve** and **✗ Reject** (one card, one signature) — or `Nothing waiting`,
and the `Asks`, each with **Grant** where `grantOf` opens a sheet for it and **Decline**. **The Statement** is a drawer (`renderStatement`): the lines newest first, each with its
time, the Account's description, who it was by, its status and fee, its amount; Export CSV (a
`statement.csv` blob of `statementCsvOf`, its URL revoked a tick after the click); `Loading…`,
`No statement lines yet`, `Statement unavailable`, the Account's sentence over the lines kept. The
Settings drawer gains **Devices** (`renderDevices`). No Guard · Beast switch, no cap, no Move,
Receive, Earn, leverage, perpetuals or Memory, no sign-in or wallet venue's connection: those stay
on the Account's page.

**The owner device on screen** (`render/owner.js`; every word `owner-view.js`'s, `sheet-view.js`'s
or the Account's) — the device line under the Account head's chips, one muted sentence by role:
`This page signs for the account`; `Waiting to be let in — Let it sign on the Account page, under
Devices`; `Pair with the code the Account printed in its terminal` with the pair box (a form:
`#pair-code`, **Pair**, Enter submits it); `Signed out` with **Sign in**; `This browser cannot
sign for the account`; nothing while
`unknown` — the Account's last refusal to the device joined on with ` · `, Pair and Sign in off
while a pairing is in the air. **Devices** in Settings (`devicesOf`): each owner `label · id`, this
page's own marked `this page`; each device waiting `kid · since <date>`, with **Let it sign** — and
this page's **Sign out** — only on a page that signs. **The sheet** (`renderSheet`, a drawer over any
screen, `aria-label` its title): its title (`titleOf`), its fields by type (a seg, a pick as
checkboxes, a box, a select whose nothing-picked is an empty option, text — a number typed as
text), a connect sheet's check under them (`connectCheckOf`: `Key file found: <path>`, `Missing: a,
b`, the venue's words, `Connect on the Account page`), the quote box (`Fill it in to see what it
would be.` or the missing words, `Asking…`, the Account's refusal with **Prepare again** when that
is the answer, the quote's words), the countdown, **What you sign** (a fold of every shown line,
dimmed while the form is not the draft asked for), what the Account said once done, **Cancel** and
the go key (`goWord`: `Let it in`, `Give the limit`, `End the limit`, `Revoke`, `Connect`, `Open the
account`, `Top up`, `Start over`, `Disconnect`, `Approve` or `Reject`, `Decline`, `Let it sign`,
`Sign out`), on only while the sheet is ready and current.

**Trade** (`render/trade.js`, `#/trade`; after gravit-ui's Trade at `feat/gravit-ui @ 2418df7`, its
stand-in logic replaced by the Account's prepare) — the head (`Trade`, the Account's writes chip),
the kinds seg (Crypto · Stocks · RWAs · Predictions), the picker (`pickerOf`: **You hold** — the
leading lens's rows matched to an Account key, a prediction held opening as a sell of its outcome —
**Watching** and **Most traded**, or `Results for “q”` while the search box `#tq` holds a query;
`Loading…`, `No markets`, `Markets unavailable`, `Searching…`, `Nothing matches “q” under Crypto.`),
**Under way** (`underWayOf`: each working order in `orderWords`, its id, and **Cancel** — one click
— where the Account knows what cancels it, on a page that signs; `Nothing under way.`; what was
said on Trade, a cancel's answer or a fill, over them; under them **Cards waiting** when the page
has cards — `cardsOf`, each `reason · value · answer by` in the Cards tab's words (`cardFactsOf`)
with **Review →** to `#/account/cards`, rows only, no key that signs), and the ticket panel:
`Pick a market`
with none open; else the head (`Buy ETH` / `Sell ETH`, the close key), the market picked, a
prediction's outcomes in cents, **Where** (the able lines as keys, `Best` and `Paper` marked; the
other lines dim, a public listing with `Public` and **Connect to trade** → `#/account/venues`),
Buy or Sell, **Amount** and **In** (Dollars or the market's unit — Shares, Contracts, the base),
**Order** (Market or Limit; a limit's price field, a prediction's in cents), **Extended hours** on a
limit where the picked line offers them, the quote box (`quoteOf`: the Account's words with
`Paper`, `≈ <dollars>`, `up to <dollars> if the price moves`, `fee <dollars>` or `fee as <venue>
charges it`;
dimmed with What you sign while the form is not the draft asked for), the countdown, **What you
sign** (`#tk-signs`, closed until opened, the seventeen fields and the nonce verbatim), the
Account's refusal or what it placed (`Placing it…` while signing), **Prepare again** when that is
the answer, **Sign and place** — on only while the shown preparation is the form's — and **Hand to
Gravit instead**. On a page that does not sign the screen still draws the picker and Under way,
and the ticket panel draws the device line where the form would be: no Sign and place, no
Cancel.

**A channel's page** (`render/channel.js`, `#/channel/<workspaceId>`) — part of Messages: the list
stays beside it. The head (the channel by its title, its status chip, `New round` — a new message
with Where on the channel); the one-line headline, `Next: …` and the numbers as rows; **Thesis**
through the markdown hook (`No thesis yet` for the template or none); **Latest backtest** — its
file and up to twelve of its scalar fields — and **Backtests** (file and size), both only for an
old strategy that carries a `backtests/` directory (none is written since 2026-10-24); **Journal** (the newest
twenty, date before text), **Files** (name, size, date); **Agents** and **Bots** — the rostered
names, each with `Edit`: a box per choice (the connected CLI agents; every bot but the host's own
composition), ticked as rostered, a seventh bot box shut while six are ticked, ✓ and ×. `Loading…`,
`Channel unavailable` with Retry, a failed re-read keeping the page under `As of HH:MM · stale` and
Retry, `Channel not found`. Every channel-written string is text.

**Discover** (`render/discover.js`) — the head (`Discover`, the search box `#dq`, `Search`, the
`Create a bot` key); the shelves **Data**, **Bots**, **Agents** (with `Rescan`), **Skills**, each
with `See all` and its cards (the mark, the name, one line, the kind tag), a failed listing saying
`Couldn't read <Shelf>` with Retry beside the others, `Loading…`, or the shelf's empty words; a
search draws one grid (`N results`); `#/discover/<shelf>` the shelf as a grid with `‹ Discover`.
**An item's page** (`#/plugin/<id>`, `‹ Discover` back to the view it came from): an MCP server's
State (`Pending`, `Loading`, `Active`, `Failed`, `Unloading`) and its tools, each description
clamped to two lines (a server may describe a tool with a whole method list); a bot's model
(`Default` when it names none), home, description, soul (pre-wrapped text), skills, setup issues
and `Can't run · <reason>`, with `Talk to <name>` (absent for a broken or unlisted bot) and `Edit`
— Name, Description, Model (Default, the catalog's routes, a route it lacks still offered), Soul,
each box's id carrying the revision it was drawn from; a CLI agent's version, sign-in (`Signed
in`, `Not signed in`, `Unknown`) and tool, with Connect or Disconnect; Gravit's Model, Host and
Keys cards, each `Loading…`, `Couldn't read` or its rows (`Present` / `Absent` per key); a skill's
group, description and content. An unknown id reads `Loading…` while its listing is read, then
`Not found`. **The Create page** (`#/discover/create`): Name, Id, Description, Model, Soul,
`Create`; the new bot's page opens. Discover's own status line carries its refusals. No Install,
Uninstall, Publish, review, install count or price.

**Tool results** (`render/tool-result.js`) — no result is dressed since 2026-10-24: the
the Alpaca server's renderers (its tables, tiles and close chart, `chartSvg`, and `parsePayload`) left
with it, so every result — one in a conversation written before then included — draws the plain
row, the call's name and its payload folded under it. `toolResultHtml(name, text)` stays as the
seam (it returns `null`), so a server's result can be dressed again by its name; `toolResultFor`
never dresses an error.

### 5.5 State

The store holds the host's facts (§5.3) and the page's own: `route`, `draft`, `detailsOpen`,
`settingsOpen`, `edit`, `confirm`, `railCollapsed`, `collapsed` (the list groups the viewer
folded), `theme`, `lastConv`, `lastSeen`, `status`, `orphanGates`, `channels`, `bots`,
`conversations`, `childRows`, `traces` (a member's trace by the answer it explains, `traces[convId][msgId]`); `channel`
(`id`, `status`, `data`, `at` — the page's overview); `discover` (`query`, `shelves` — `plugins`,
`bots`, `agents`, `memory`, each `{status, data, at}` —, `gravit`, `skills`, `models`, `status`);
`markets` — the screen's `tab` (an `ACCOUNT_TABS` id, `watching` or `results`), `sort`
(`volume`, `movers`, `closing`) and `q`; the Account's `explore` reads by tab (`all`, a kind's own;
each `{status, data, at, message}`) and the search's `results`; `accountQuotes` by `venue|symbol`
(`{price, bid, ask, quoteAt, quoteFrom, changePct24h, volumeUsd24h}`, `streamed` on the stream's);
`candles` by key (a read and its `range`) and `compare` by base; `watch` (the Account keys
starred), `watchError`, `asked` (an old `us:`/`crypto:` star → the key it was found as, or `null`);
and the face's wire for the A shares, `watchlist`, `quotes`, `providers`, `connection`, `search`,
`hitQuotes` — and `account` — the page (`status`, `data`, `at`, `message`, the Account's sentence
of its last refusal), its other reads `holdings`, `paper` (the paper lens), `history` (with its
`range`, `1d` by default), `statement` and `agents` (each `{status, data, at}`, a failure keeping
the last data — `holdings`, `paper` and `statement` with the Account's `message` too), the connect
and paper sheets' reads `venuesHere`, `paperBooks`, `keyfile` (with what it `asked`) and `reach`
(each `{status, data, at, message}`), `statementOpen` and
`detailsVenue` (the venue whose Details drawer is open) — beside `seat` (`/data/seat.json` as
read). Since the graft's stage 2: `owner` — `role` (`unknown | signs | pending | needs-code |
signed-out | none`), `kid` (this key's id at the Account, `''` while none), `refusal` (the
Account's last refusal to the device as words, or `null`), `busy` (a pairing or sign-out in the
air) — and never key material; `sheet`, `null` while none is open, else its `kind`, `seed`,
`fields`, `status` (`incomplete` with its `words`, `asking`, `ready`, `refused` with the Account's
`message` and `again`, `signing`, `done` with what it `said`), `prepared`, `preparedAt`, `asked`
(the draft the shown preparation was asked for) and `deadline`; `trade` — `kind` (a `TRADE_KINDS`
id, `crypto` at boot), `q`, `picks` by kind and the trade search's `results` (each `{status, data,
at, message}`), `ticket` (`{id, side, venue, outcome}` or `null`; the order sheet keeps the
fields) and `said` (a cancel's answer or a fill, as words). The editors keep their own state in `edit`: a rename, New channel…, a roster
(`which`, `workspaceId`, `choices`, `ticked`), a bot (`id`). It never loads a saved state
(`accept: () => false` — the host is the state) and persists one key,
`localStorage["gravit-ui.prefs"]`: `{theme, railCollapsed, lastConv, lastSeen, collapsed}` — the per-viewer
conveniences, every access in try/catch, written only when it changed (a quote tick rewrites
nothing). The stars keep two keys of their own, read and written by `host/markets.js`: the
Account's keys under `gravit.account.watch.v1`, and the A shares under
`gravit.market.watchlist.v1` — the key the old market page wrote, so a browser's list carries over
(one that saved before the rename is read from `kairos.market.watchlist.v1` until its first save),
its old `us:`/`crypto:` stars asked of the Account. The owner device keeps two things of its own,
outside the store: its key pair in IndexedDB (`gravit-face-owner` › `keys` › `device`, a
structured clone, so the private half stays non-extractable — clearing the face's site data loses
it, and the Account keeps the old device's row) and the sign-out flag,
`localStorage["gravit.owner.signedOut.v1"] === "1"`. A reload
restores only those — the transcript comes back from the host on the next open, the pending gates
on the new `$events` generation — and archive/delete metadata lives host-side so it survives any
browser.

### 5.6 Styling

`css/tokens.css` declares Cream (`:root`, `[data-theme="cream"]`), Black (`[data-theme="black"]`)
and, with no `data-theme` set, the system's choice through `prefers-color-scheme`; `index.html`'s
head script applies the saved theme before first paint, `setTheme` at runtime. Two type stacks,
`--font-sans` (Manrope, Noto Sans SC) and `--font-mono` (IBM Plex Mono); radii `--radius-s/m/l/pill`;
the rail `--rail: 248px`. `css/app.css` is the one sheet: the rail and its mini strip, the list,
the thread's bubbles and cards, the drawers, the responsive breaks (the list hides beside an open
drawer between 861 and 1399 px), Markets' table narrowing (Volume and Source leave at 620 px,
the 24 hours at 440 px), the Account's tables and two figures, the list's group heads, a channel's page, Discover's shelves,
cards and item pages (a tool description clamped to two lines), a tool result's tables, tiles
and stamp (`.viz-*`), `prefers-reduced-motion`. The sheet and the screens are checked both ways
(`tests/client/css.test.js`): every class a screen emits has a rule, and every class the sheet
styles is emitted by some state (the page shell and a markdown sample included), so a rule cannot
outlive its screen. Client assets carry **no cache headers**:
hard-reload after any client edit, or you drill a stale module.

---

## 6. Paths end to end

**6.1 A paper order from Gravit.** The operator has admitted the seat as Gravit on the Account
and signed it a `trade` limit naming a paper venue → Gravit calls `mcp__account__portfolio_live_order`
→ the prepended listener returns `ask` naming the order (`reason`, `Account seat - <tool>: …`, and
the same line as `displayReason`) → dsh's `ApprovalService` logs `approval/asked{callId}` and runs
the `approval/request` waterfall → `api-remotes` forwards it to every connected browser's `$events`
stream, keyed by `eventId` (no browser: it waits, and is replayed to the next one) → the operator
answers; the page POSTs `$events/result` → `approval/decided{outcome}` is logged and every other
tab holding the card gets `cancel` → the guard reads the log through `snapshotEvents()` and admits
the call only on a logged `allowed-once` for that `callId` and tool → the seat signs with its key at
the Account's door → in Guard the Account raises its own card, answered on the face's Cards tab or
the Account page → the order placed on the paper venue; the thread draws the seat's receipt
(`seatLift`). Deny: the model reads `the user rejected tool "…"` and nothing reached the Account.
Under `danger-full-access` the listener denies outright. A retired `place_order`, under any server,
is denied by the guard before any card, and a home that registers one does not boot (§4.7).

**6.2 A dated market read.** There is no guarded read since 2026-10-24: the seat's market reads
(`portfolio_markets`, `portfolio_quote`, `portfolio_candles`, `portfolio_history`, …) and AKShare's
answer what their sources hold now, and Gravit's evidence is the forward paper trade of 6.1 with
the Account's statement (`dsh/profile/cycle.md`).

**6.3 An instrument read** (removed 2026-10-24): the producers and `/data/bars` left with the
Python package; the screens read the Account through the proxy (6.3a, §4.4).

**6.3a The operator opens Markets.** The rail's Markets key → `#/markets` → `follow()` →
`markets.show(true)` (Markets on screen in a visible tab): the face's wire resumes for the cn ids,
and the tab on screen is read at once — `GET /data/account/explore?limit=200` → the face's fence →
405 unless GET → `rebuildQuery` over the `explore` row's names → the explore route's cache (20 s)
or one loopback fetch of the Account's `GET /api/account/explore?limit=200` (10 s abort) → the
answer passed through → `exploreLoaded {tab: 'all'}` → `tableOf` → the table drawn, and after the
render `markets.rowsInView` names the drawn rows' ids → every 5 s `GET
/data/account/quotes?pairs=<the drawn rows' most traded connected lines, twelve>` (3 s TTL, 7 s
abort; none while one is out) → `accountQuotesLoaded` (a pair stamped before the price kept stays
as it is) → each row's price and source word; every 20 s the explore read again. A star on a row
→ `toggleWatch` (`watchedOf`) → `markets.watch(<key>)` → `saveAccountWatch` under
`gravit.account.watch.v1` → `accountWatchLoaded` → the Watching tab appears. A row's name →
`openMarket` → `#/markets/<key>` → `nav` keeps the key whole → `follow()` → `markets.page(<key>)`
and `account.loadHoldings()` + `account.loadStatement()` → `pageOf` finds the item in a read →
`GET /data/account/candles?venue=&symbol=&range=1D` at `followOf`'s line, `GET
/data/account/compare?base=<base>&side=buy` for a coin, a perpetual or a stock, and
`stream.follow(['<venue>:<symbol>'])` → `POST /data/account/stream/markets {client, markets, n}`
(the fence, POST, a JSON body on a bare path, at most 4,096 bytes) → the Account follows the market
for this tab's client; the page draws no table rows, so `rowsInView` names its own key and the
quotes poll asks for its pair — the tab's row's, or, when the market is no row of the tab on screen
(a deep link, Back onto another tab), the line the page's own view gives. The Account pushes the market: a `quote` frame on the tab's
`/data/account/stream` → `streamQuote` (its last trade, else the middle of its bid and ask, marked
`streamed`) → the page's price and source word, the 24 hours staying the explore read's; a range
→ `setRange` → the candles for it (`candlesSvg`). Back → `#/markets` → `markets.page(null)` →
`stream.follow([])` → told; another screen → `markets.show(false)` → both polls cancelled and the
wire paused; a hidden tab closes the stream as well, and a `snapshot` after a reconnect drops the
prices the stream kept (`streamSnapshot`) while `account.loadAll()` reads the Account again.

**6.3b The operator places an order** (since the graft's stage 2). First the page signs: at boot
`account.load()` → the page lands → `onPage` → `owner.standing(page)` → this browser has no key in
`gravit-face-owner` yet → `makeKey` (P-256, not extractable) → `POST /data/account/pair {jwk,
label: "Gravit face"}` → the proxy (fence, POST, JSON, no query, ≤ 4,096 bytes, the body passed on
as read, never logged) → the Account's `POST /api/account/pair` → `pending` (the Account has an
owner: its own page lists the face under Settings › Devices, `A browser asked to sign`, and an owner
presses Let it sign there once; the face's next page finds `device:<kid>` among `signers.owners`) or
`needs-code` (an ownerless Account: the code it printed in its terminal typed into the pair box →
`ready(code)` → `owner`) → `ownerStanding {role: 'signs', kid}` → the device line reads `This page
signs for the account` and every owner key is drawn. Then the order: a market page's **Buy** →
`openTicket` → `#/trade/coin:ETH` → `follow()` → `pickTicket` → `trade.pick('coin:ETH', {side:
'buy'})` → `ticketOpen` → `ticketOf` rules the lines (the best able line) → `sheet.open('order',
{id, ticket}, fields)` (nothing typed: `incomplete`, `Type an amount`) and `stream.follow(['ex:ETH/USDT'])`
→ the operator types `25` in Amount → `sheetField` → the form takes it → after 300 ms of quiet
`prepareNow({quiet: true})` → `tradeDraftOf` → `{type: 'liveOrder', venue: 'ex', symbol:
'ETH/USDT', side: 'buy', orderType: 'market', usd: '25', limitPrice: '', …the nine others ''}` →
`owner.prepare(draft)` → `POST /data/account/prepare {draft}` (≤ 16,384 bytes, 30 s abort) → the
Account's `POST /api/account/prepare` → `Prepared {action (qty in the market's units,
maxNotional, deadline ten minutes out, nonce), primaryType, domain, accountChain, shown[],
quote.order}` → `sheetPrepared {prepared, at, asked, deadline}` → the ticket draws the quote's
words and figures, the countdown and **What you sign** (eighteen lines verbatim, the nonce among
them), and Sign and place turns on. A `quote` frame for `ex:ETH/USDT` that moved from the top the
preparation landed at, three seconds or more after it, prepares again quietly. **Sign and place**
→ `placeOrder` → `sheet.submit()` → the form is still the draft asked for and more than 30 s are
left (else it prepares again first) → `sheetSigning` → `owner.submit(prepared)` → `signingInput`
→ ECDSA P-256 / SHA-256 in the browser → `POST /data/account/exchange {action, nonce:
action.nonce, signature: {kid, es256}}` (≤ 65,536 bytes, 30 s abort) → the Account's `POST
/api/exchange` verifies the signature, holds the order to its live cap and places it at the venue
→ `200 {kind: 'order', order: {id: 'ord-0007', status: 'filled'}}` → `sheetDone {said:
'ord-0007 · filled'}` → `afterAction('order', body)` → the page, the holdings and the statement read
past the cache → the Account pushes `fill` on the tab's stream → `account.onStreamEvent` reads the
holdings and the page, `trade.onStreamEvent` says `Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange`
→ Portfolio and Under way follow; the statement line reads `You`. A refusal at prepare or at the
door is the Account's sentence on the ticket, nothing signed or nothing placed (`E_ACCOUNT_REQUOTE`
and `E_ACCOUNT_EXPIRED` offer Prepare again; a 401 `E_ACCOUNT_BAD_SIGNATURE` re-reads the
standing). A resting order's **Cancel** in Under way → `trade.cancel(venue, order)` →
`owner.act({type: 'liveCancel', venue, order})` → prepare, then sign at once (no sheet) → the
order's line `canceled` → `tradeSaid`. The face process carried bytes three times and kept none
of them.

**6.4 A channel listing.** Browser → `GET /data/channels.json` → the repo root first (always
a channel, named `workbench`, `isRoot: true`, listed even when `strategies/` does not exist),
then walk `strategies/*` (directories only, skipping `_template`, dot- and `__`-prefixed) → for
each directory, `registry.create` (create-or-reuse by real path) → attach every session whose
header `cwd` is that directory (persisted ∪ live, live wins) → seed a roster entry if absent
(inside the file lock) → report missing directories rather than deleting channels →
`{channels, ungrouped, archived, presets}`, `presets` naming each session's header preset for
the client's `summaryOf`. The client groups the list by these channels (`groupsOf`, §5.3) — a
channel by its display title — and opening a channel's head posts `/data/channels/overview` for
its page (§5.4).

**6.5 A local agent call.** Operator connects `claude` on Discover (Agents → its page → Connect:
probe → `agents.json` → `agent_claude` registered tree-wide) and rosters it on a channel's page
(Agents → Edit) → Gravit calls `agent_claude`
in a session → `execute` resolves the session's channel by `cwd`; on the roster → spawn with a
fixed argv, prompt on stdin, scrubbed env, the session's cwd, one run per bin at a time (hard
limits: prompt ≤ 32,000 characters, 600 s per run — SIGTERM, then SIGKILL 5 s later — 16 MiB of
collected output, and a resume id must be a UUID; a run cut by any of these comes back to Gravit
as a flagged partial result, not an error); not on the roster → refused; **no channel → fails
open**. `channelFor` is a real-path lookup of the session's `cwd` over the registered workspaces
(`resolveByPath`, never `create`), so a `choose a local folder…` session is roster-checked only
when the picked folder is itself an adopted channel directory (the repo root — always the
`workbench` channel — or a reconciled `strategies/<name>`); any other folder resolves to no
channel and every connected agent is callable there. The CLI logs itself in; the face never
reads its credentials.

**6.6 The loopback fence and the sign-in.** `webserver` binds `127.0.0.1`; `connection` trusts
no extra hosts; every `/data` route and dsh's `/api` refuse a non-loopback `Host`, a cross-site
fetch, or a mismatched `Origin` (403). `/` and `/api` then want the browser cookie (401): `/`
mints it from the printed token, `/api` and the mux upgrade check it. `/data` and `/client/*`
stay fence-only (PLAN D8). The fence is a reachability policy, not
authentication (§9, R3); the cookie authenticates only as far as its signing secret is out of
reach, and a shell turn can read the file that holds it (§9, R3a).

**6.7 Pins and upgrades.** Bump `DSH_PIN`, `CORDIS_PIN` and `CORDIS_INCLUDE_PIN` together with
`package.json` (every dsh package exact; the cordis peers are tilde ranges, `~4.0.4`); `npm
install` → `npm test` → `npm run typecheck` (it checks the dependencies' `.d.ts` too,
`skipLibCheck: false`) → re-diff `boot.ts` against the CLI's `profile-boot` chunk (at 0.2.0-rc.2
`lib/profile-boot-BZ2ZjNWi.js`, also published as `@deepseek-ai/dsh/profile-boot`) and let
`tests/policy.test.ts` re-pin every policy target against the new dsh-base → re-check the frame
shapes — `client/js/wire/api.js`, `client/js/wire/mapper.js` and the hand-kept `tests/fixtures/events.jsonl` —
against the gateway's `stream-protocol`, `api-remotes`' event list, the session controller's
`types` and the user-approval and user-questions request types, in their installed
`lib/types/*.d.ts` (there is no generator; correct the fixture by hand, then `npm run
check:fixture` validates every line it can against the installed dsh's own acceptance code —
the session controller's `assertSessionWireEvent`, the gateway's frame parser and `$events` id
predicates; on 2026-09-30, 23 of 26 lines validated, 0 rejected, and the 3 with no upstream
validator named) → `FACE_SMOKE=1 npm test` — the eighteen real boots, `order-gate-smoke` and
`client-mux-smoke` above all, are the contract the structural `*Like` types cannot be → the
drills. `cordis-plugin-include` is pinned; `loader` and `group` arrive as app-boot peers and
`timer` through dsh-base, held by the lockfile alone; `cordis-plugin-hmr` is gone.

**6.8 A room round.** Operator ticks two bots on a channel's page (Bots → Edit → `POST
/data/channels/bots` → `channels.json` `bots[]`) → asks a question in a channel session → Gravit
calls `dispatch` with
a brief (`tool/call`) → the engine refuses a session whose header or `agentPreset` projection
names a bot, validates against the roster, starts the round and returns at once (`tool/result`
naming who was not called) → per bot: find the member session (the room log's record of it,
then the persisted `{header}` snapshots) or create it (`ctx.agents.create`, `parentSession` =
the room, `agentPreset` = the bot; the model ref, the preset join and the `read-only` pin inside
`setup(agentCtx, agent)`; attached to the channel workspace) — a member session dsh 0.2 cannot
open is that member's `failed` turn, named in the round-end text and on the console, and the
round goes on → `followup` the delta prompt (its `messageIds` are the member's cursor, in its
own log) → await that turn's `turn/end` under the extending deadline (a pending gate, read off
the member's log, holds it open) → final text after the last tool result; empty or `(pass)` →
`passed`; an error → `failed` → an answer is appended to the room log while no Gravit turn is
open (else held until its `turn/end`) → peer `@`s queue continuations (≤ 2) → round end: every
held answer flushed, then ONE `followup` naming who answered and who passed → Gravit's synthesis
turn. A cold room the operator `@`s is resumed through `sessionController.resolveAgent`, the
host's own composition. Every step is a known event; the `room` projection folds them; the
client draws each answer in the bot's voice as it lands, the room's members from the projection
and the list's fold, and under an answer that names its member turn a Trace that reads that turn
from the member's own log without activating it (§5.4) — it follows no member session.

---

## 7. Tests and drills

### 7.1 Commands that work

| Command | From | Needs | Measured 2026-09-30 |
|---|---|---|---|
| `cd face && npm test` | `face/` | nothing — no port, no key | 1266 tests, 1248 pass, 18 skipped (2026-10-24, stage 3 of the graft; the repo's only suite since the Python one left) |
| `cd face && npm run typecheck` | `face/` | | clean, the dependencies' `.d.ts` included (`skipLibCheck: false`) |
| `cd face && FACE_SMOKE=1 npm test` | `face/` | boots eighteen real trees into `mkdtemp` homes and binds ports; still no LLM or key (four of the smokes also create, and remove, a gitignored `.bots-smoke-*` bots root at the repo root) | the eighteen skipped tests; 1263/1263 with one todo at stage 3's Task 6 (2026-10-24, `e77900a`), 1310/1310 at stage 2's `b45c5cc`, each with `FACE_ACCOUNT_SEAT_DIR` naming a checkout of buyer-agent-demo @ 133b9a7 — without it the seat and graft smokes stay skipped |
| `cd face && npm run check:fixture` | `face/` | the installed dsh | 26 fixture lines: 23 validated, 0 rejected, 3 with no upstream validator |

### 7.2 The Python suite (removed 2026-10-24)

The 400 offline pytest cases left with the Python package, `pyproject.toml` and the scripts
(the design's §12); the face suite below is the repo's only suite.

### 7.3 The face suite

1266 tests in 116 files (1248 pass, 18 skipped without `FACE_SMOKE=1`), run by `node --test`
through `tsx`:

- **Composition and boot** — `boot` (the layer order ending with the overlay; the policy layer
  between bundle and AKShare, the Account seat row right after AKShare with its config from
  `FACE_ACCOUNT_SEAT_DIR` and `FACE_ACCOUNT_URL` and an operator's disable kept; the storage chain and projection cache composed once, from
  dsh-base, and reachable by an operator patch; the persona patch setting `personaPrefix` and
  keeping the operator's other `system-prompt` keys; the instructions patch setting
  `agent-instructions`' two candidate lists to `GRAVIT.md` and `GRAVIT.local.md`, after the
  persona patch and before only the overlay, keeping an operator's other keys on the row and its
  `disabled`, cloning what it is given, and absent from a composition that has no such row; a
  skipped bundle refused; the static `preset-gravit` row rendered from `roles/` in memory — the
  `gravit` row by absolute URL, carrying the text of `dsh/profile/cycle.md`, one `spawn` row per
  role (none for the shipped library) — and never read from the mirror, the `preset-kairos` alias equal to it under the legacy
  id, a roles root with a bad role refusing the compose with the file's path, a missing roles
  directory refusing it with the directory's, and an empty or missing cycle file refusing it with
  the file's), `overlay` (exactly the thirteen rows, in order;
  loopback config; the rows dsh-base owns now and the retired ones never inserted), `policy`
  (every target a row the installed dsh-base composes; the composed posture; an operator row
  overriding a default; `DSH_TELEMETRY_DISABLED` winning over an operator re-enable), `setup`,
  `static` (exactly `exact /` and `prefix /client`, so `/market` and `/account` reach no route;
  `/` asks the index gate first and writes nothing on a refusal; `/client` never consults it), `version` (the three pins, the retired names), `persona`
  (cross-checked against the installed strict renderer), `cycle` (the shipped `cycle.md` reads,
  fits its 3,300 bytes, and carries the six steps, the 24-round cap, the resume path and the
  blocked vocabulary — `venue-window`, `data-missing`, `needs-operator`; it names no role and runs
  on a forward paper trade, and every `role_*` it would name must be a shipped role; `readCycle`
  trims, allows braces, and refuses an empty, an oversized, a missing and an unreadable file with
  the absolute path first, the limit inclusive and counted on raw bytes, em dashes included; temp
  directories removed), `gravit-md` (`GRAVIT.md` within its 4,500 bytes and free of `{{`; the
  Account seat and its rule named; none of the removed layer's names, and the sentence that no
  read is guarded; no line that tells the reader who it is),
  `gravit-plugin` (`name` and `inject`; `validateGravitConfig` accepting `{}` and checking
  `cycle` and `roles` when present; `todayText` rendering the zone's local date, ISO then
  weekday; `apply` registering one scoped, uninterpolated section right after the persona slot
  — whose order must be finite, so a missing slot cannot pass as `NaN` — which unload removes; a
  bad config refused with its reason; an empty or non-zone `TZ` rendered in UTC and labelled,
  never thrown at assembly; the `gravit:roles` section only when `roles` is configured, one past
  dsh's subagent section, read at assembly and never at mount, listing exactly the roles whose
  tool the assembling scope resolves — all, none, one of two — through `canCall`, whose lookup
  is handed the context's own scope; an empty list rendering nothing; the `gravit:cycle`
  section only when `cycle` is configured, 50 before the persona suffix, uninterpolated, the
  contract for a scope that can call `create_goal` and `''` for one that cannot, gone on
  unload; both sections Gravit's text for a root session, a `subagent_fork` child and an
  operator-forked session, `''` for a delegated child that is not a fork although its scope
  resolves every tool — `isRootOrFork`), `roles` (the reader: the shipped library `_template` alone,
  so Gravit's preset and its mirror carry no role row, while a fixture role copied from `_template`
  renders exactly one; every shipped role — none today — with exact names and nothing forbidden, the
  job tools only beside `bash`; `_template`, hidden entries and plain files skipped; every refusal — a missing root or file, a symbolic
  link or a misnamed directory, an oversize persona, bad YAML, a wildcard, an entry listed
  twice, a blank or two-line description, a never-list entry checked against an independent
  copy of the names (the account and order names under a renamed server too), a 65-character
  tool name — opening with an absolute path, the limits inclusive at 2,000 bytes / 300
  characters / 64; `gravitRows`, whose `agentOptions` appear only with a model; the committed
  mirror byte-equal to the render, the cycle text included, so drift fails), `check-home` (the
  go-live dry run's pieces, offline: the live-home refusal by device and inode — through a
  symlink, in another letter case, inside or above the home — and the marker; the refusal classes;
  the multi-frame log reader; the inventory diff; the MCP row walk; the `extraPatches` seam
  composing after the operator's layers and before the face's own), `schema-sizes` (the size
  script's guard, offline: the live home refused as the same path, with a trailing slash, through
  `..`, through a symlink to it or to a directory inside it, inside it, above it — also above a
  symlinked live home's real directory — and in another letter case; a separate copy allowed; a
  home with no `profiles/face` refused).
- **Gate 2** — `orders` (pure gate logic: the seat's twelve writes raw and minted, a renamed
  server caught, the unclassified fallback, a name that merely mentions an order not gated, the
  retired pair no order tool yet denied outright under any server name whatever the log holds, no
  tool a PAPER order any more, deny under `never`, one-shot grants for this `callId` and tool only,
  the audit's `gated`, `uncovered` and `retired`, the `displayReason` twin, the widened decision
  type, and `orderGuardReasonForSession`'s distinct denial for a session whose log cannot be read —
  the 0.1.1 `{events}` shape with a real grant among them), `order-gate` (offline: a session
  without `snapshotEvents` denied with that distinct reason).
- **The client's wire and pure halves** — `api` (the unary envelope and its failures, dotted
  names refused before fetch, `randomUuid`; the mux: `$events` first with exactly `{args:{}}`,
  every reconnect re-opening every stream under new ids, a `cancel` after reconnect naming the
  current id, `onDown` running before the next socket exists, gates answered only under the
  generation that holds them, the refusal codes, a late `cancel` reporting a lost race, retirement
  of unreplayed gates, an `$events` failure losing the generation), `mapper` (against
  `tests/fixtures/events.jsonl`, rewritten to the v4 wire and checked against upstream's
  `assertSessionWireEvent`: every 0.1.1 shape maps to `ignore`; the room's views — a member's
  answer as a bot bubble, the round-end line, the operator's `@`, a member's delta, a turn
  boundary for a session not on screen; gate frames by `eventId`; tool titles from the call;
  `agent-message` relays), `summaries`, `member-traces` (the non-activating trace read, its
  English errors), `subagents` (the catalog composition, the state enum;
  the dock's controllers went with `chat.js`; `tests/client/live.test.js` re-pins against a fake
  host what they proved of the follow/page policy — a cold open paged, a live one followed, a
  prompt promoting a paged view, a socket drop suspending and the fresh list re-deciding, the
  host's alive and gone reports, a refused follow reported once, an ended follow re-decided —
  and of gates across reconnects: a replay is the same card, a member's gate replayed before
  the list survives the room's window load. Two cases are NOT pinned by name: a failed open still
  drawing its conversation's gates, and a new conversation followed before its first prompt
  (app-dom's New message test runs that path without asserting the follow)), `room-client`,
  `speaker`, `grouping`, `channelName`, `botId`, `bot-settings-client` — these six import their
  modules from `client/js/wire/` — and the client wire modules' `market-model`, `market-quotes`,
  `market-search`, `account-model`.
- **The gravit-ui client** (`tests/client/*.test.js`, `node:test` through tsx, a fake DOM in
  `tests/client/helpers/fake-dom.js`) — `kinds` (the kind table, the seat line, the seat's receipts and
  refusals, a result row's call name, an old session's order of the retired pair drawn as a plain
  approval, a member's turn), `sessions` (rows → conversations, the
  fold, `Untitled`, the archived marks, the child rows, `firstOpen`), `host-reducers` (windows
  replace, events dedupe by id and insert by seq, a checkpoint's replace range, gates and
  orphans, the catalog kept across a list), `actions` (the Remotes and routes each data-action
  sends: the row actions and their refusals, Talk to, a child's Stop), `live` (follow or page,
  promote, suspend and re-decide, gates by `eventId`, previews, host facts, the last good
  channels, sessions-meta and bots), `thread` (a tool result drawn plain, a member's
  Trace), `rail` (the groups and their heads, Discover in the first level, the Account's leading
  figure with `Paper` when Paper leads, the cards-waiting badge), `list-view` (the
  groups' order and folds), `messages-screen` (Details' row keys, Children, Where's channels by
  their titles and New channel…), `channel` and `host-channels` (a channel's page in every state —
  markup in every field stays text — its editors, the overview's latest-wins read, New channel,
  the roster writes), `discover-view`, `host-discover` and `discover` (Discover's items under
  namespaced ids, the four listings each alone, the Gravit item, a skill, the agent writes, a
  bot's revision-checked save and a new bot, the shelves and every kind of page, no shop words),
  `tool-result` (no result dressed, an old session's Alpaca result
  included; an error never), `children-view` and `host-traces` (a conversation's children and their
  states; a member's trace read once per conversation and message, non-activating), `wire-words`
  (no Chinese in the six moved
  wire modules), `app` and `app-dom` (the boot: routes, the render loop, every data-action against
  the store, a press holding renders until it ends, the open disclosures kept across a render, the
  prefs' folds, fork, archive and delete moving the page, a deletion elsewhere, a channel's page
  and New round, New channel… in Where, the roster editors, Discover's reads, Connect, Talk to, a
  bot's save and a new bot, a member's trace never followed and opened by one click, a child's
  Stop; the Markets search after 300 ms of quiet and Clear at once, a star on an A share and on an
  Account market (its own store, an old star's find taken off in one press, Remove), a market's
  page — its follow, its holdings and statement reads, a range's candles, its own pair in the
  quotes poll — the polls paused off Markets and in a hidden tab, Hand to
  Gravit; the Account's page read at boot and on entering Account, every 20 s on screen in a
  visible tab and 80 s while the stream is open, each tab's reads on entering it, Refresh, the
  stream opened at boot, closed while the tab is hidden and its events the reads they name, a
  range's curve, a venue's Details drawer and Escape back to its opener, Export CSV, a receipt
  reloading the page and a seat receipt the seat too, Open the Statement from a market's page — the
  account host answering with the stand-in's fixtures), `market-view` and `account-view` (the pure
  views over the stand-in's fixtures and hand-built edges: the tabs, prices by kind, the source
  words and their age, the lines and the best, the Account's rows beside the cn rows, the three
  sorts with nulls last, `tableOf`, `pageOf`'s words, history state and the read each part stands
  on — the orders and what is held unreadable under a page the face does not recognise, never the
  real book in its place — `watchedOf`, `handWordsOf`,
  no icon through any view, every word English from every enum;
  the page, the head, the two figures, the change, assets and positions, open orders and whose,
  the statement and its CSV, the venues' health and Details facts, Gravit's agent row first, the
  cards and asks, an unrecognised page answered empty, never a number), `host-markets` and
  `host-account` (the two host layers over the stand-in's fixtures with recorded timers, a fake
  stream and a recording `getJson`: explore at once and every 20 s, the quotes every 5 s twelve a
  call, a refusal keeping its rows and the Account's sentence, the search, the stars in their two
  stores with the cn wire handed cn ids alone, the page's candles, compare and follow, a page whose
  market is no row of the tab still polling its pair, the old stars asked once, a stream quote; the
  page in one flight and its fresh read, a refusal's sentence, an unrecognised page landing and
  reading `Account unreadable` — leading no paper read, so the recognised page after it reads the
  lens past the cache and the paper curve, the lens read before or not, and a money event under it
  leaves no paper total from before it — the holdings and the paper lens, the leading curve, the stream's
  events as fresh reads, the poll at 20 s and 80 s), `account-stream` (the client id, the resume point and
  `since`, every named frame to `onEvent`, stale and dead with the retry steps, `onStatus` told
  each change once, the follow POSTs with a rising `n` and the one retell, `close` cancelling every
  timer — over a fake EventSource, recorded timers and a recording fetcher, the captured stream
  fixture replayed), `markets` and `chart` (the table — the Account's tabs, rows with their source
  words, cents, contracts, `Closed` — the sorts, a cn row beside the Account's and the Not listed
  line, the empty states and the A-share search's line, a market's page and each part on its own
  read, a failed history read, the Account's words drawn as text, no CJK or icon URL in any
  rendered string; the geometry of `chartSvg`, `candlesSvg` and `curveSvg`), `account` (the head
  and its chips, Portfolio with Paper leading on the stand-in, an unrecognised page and a refusal's
  words, Venues with Details and the seat box, Agents, Cards, the Statement drawer and its CSV, the
  router's tabs, no CJK, icon URL or raw JSON; since stage 2 the owner's keys drawn only on a page
  that signs and absent otherwise); the graft's stage 2 — `owner-key` (the canonical bytes equal
  the owner path map's SetWatch input character for character, `undefined` dropped and `null`
  kept, a signature verifying under Node's `crypto.verify` with `dsaEncoding: "ieee-p1363"`, the
  kid as the first sixteen hex of SHA-256 over `x ‖ y`, base64url unpadded), `key-store` (the
  memory twin, IndexedDB's store created on upgrade and a value round-tripped, a rejection — never
  a throw — without IndexedDB or on a failed open, the sign-out flag over a storage that throws),
  `host-owner` (against a fake door that verifies each envelope as the Account's `es256Verify`
  does: a fresh page pairing with the code and signing, the standing from the page's signers, a
  bad-signature 401 re-reading the standing, a refusal at prepare handed back unsigned, sign-out
  deleting the key and setting the flag and sign-in making a new key, no WebCrypto as `none`, a
  page landing during a sign-out pairing nothing, this page's sign-out signed on a sheet ending the
  device as `signOut()` does, a 200 that is a refusal leaving the device as it was, a thrown
  pairing not wedging the next, a first pairing refused letting the next page ask), `owner-view`
  (the six standings' words, Devices, What you sign in the Account's order, the countdown, a result
  that is a refusal refused on a 200, `refusalOf`'s Prepare again and standing, `saidOf`),
  `sheet-view` (every kind's draft in the Account's own types — `allow` never `*` nor a venue the
  seed does not list, an exchange account's `live:exchange:<id>`, a new paper id past one in use,
  Let it sign's sorted signers with threshold 1 — and the seeds `limitSeedOf`, `letDeviceSeedOf`,
  `paperSeedOf`, `grantOf`), `host-sheet` (on recorded timers: a complete sheet prepared at once, a
  change after 300 ms of quiet, a changed form prepared again and not signed, a submit under thirty
  seconds prepared again before signing, a preparation prepared again at zero, a quiet ask keeping
  the shown preparation, a refusal and Prepare again, `afterAction` once — even when a subscriber
  throws at done —, an ask in the air never landing over a sign, `close` cancelling the timers),
  `owner` (the device line's six standings, Devices, a sheet's fields by type, What you sign
  verbatim and the key off on a changed field, the countdown, a connect sheet's check, every Account
  string escaped), `trade-view` (the kinds, the picker's groups — Watching the union —, the
  ticket's lines, the best of the able ones, a venue given that does not take the order,
  `tradeableOf` refusing a perpetual and a pre-IPO one, a prediction in cents, `tradeDraftOf`'s
  market and limit drafts with `extendedHours` only on a limit, the order sheet reading no clock,
  `quoteOf`, `underWayOf`, `fillWords`), `host-trade` (the picks on screen and their poll, the trade
  search apart, a pick opening the ticket and its sheet on the best able line and following it, a
  venue change re-seeding, `resume`, the quiet re-prepare only once the market moved from the
  preparation's top — never on a still market for a limit —, a fill said, one-click Cancel, nothing
  after close) and `trade` (the screen without a ticket, a search, the ticket's Where, side,
  amount, order type and extended hours, a ready ticket's quote, its eighteen What-you-sign lines
  and Sign and place, a refusal and done, a prediction, a page that does not sign drawing the
  picker and Under way with its device line and no Sign or Cancel, Under way's cards waiting and their
  Review → (none, nothing added), no CJK, icon URL, `undefined`,
  `NaN` or raw JSON); `app-dom` gains the wiring (the device at boot, Enter in the pair box, every key to its sheet, Trade
  on its route, the reads after an action), `markets` and `host-markets` the star that signs
  `setWatch` and the Watching union; `market-fmt`, `css`
  (every emitted class has a rule and every class the sheet styles is emitted by some state —
  every screen's states included — no hex colour, every token read is declared, a tool
  description clamped), `controls`, `reducers` and `store` (the editors and confirms, the routes
  and defaults, the empty state without a demo slice, the message model's host kinds), all on
  host-shaped states — the seed fixture is gone; `client-page.test.ts` pins `index.html`'s assets
  under `/client/` and its language.
- **Server modules** — `channels` (the `presets` hints among the rest), `panels`
  (`/data/host.json`), `http` (the body reader, the fixed `FORBIDDEN`, and the `/data` fence moved
  here from the removed `data.ts` — `isTrustedDataRequest`'s Host, `Sec-Fetch-Site` and `Origin`,
  `isLoopbackHost`'s spellings),
  `sessions` (`pickGenerationLog`; a v4-only session
  deleted and fenced; a migrated v0 + v4 directory decided by the v4 header; a lock-and-temps
  directory never deletable; the host-archive 409), `roster`, `agents`, `bots`, `bot-presets`
  (the rebasing of every shipped bot onto the real `face/plugins/bot.js` and its own `skills/`;
  the default's definition taking the rows it is handed — rebased as a file's would be — and never
  reading the composition file; the shipped default being the rendered `roles/`;
  `preset.yml` read as 0.1.1 read it; `declareBots` never declaring `_template` or `gravit`;
  `redeclare` disposing before registering, following the disk, serialized; the root's disposal
  taking every declaration with it), `bot-plugin` (the persona-prefix slot, a late tool admitted,
  the mask shrinking and re-admitting, a failed re-expansion contained), `bot-journal`,
  `quotes` and `quote-snapshots` (the `cn` grammar, a retired `us:`/`crypto:` id answered without
  a quote, iFinD alone), `symbol-search` (Tencent, `market=us` 400, the route's fence),
  `account-proxy` (against a fake Account: the twenty exact routes and the fence
  before any fetch; 405; the whitelist — each name once, 240 characters, `pairs`' own 2,000 with
  twelve realistic markets passing whole, the raw-target cap, `fresh` stripped; the upstream
  request bare — no Origin, no `Sec-Fetch-Site`, no cookie, `redirect: "error"`, the rebuilt
  query alone; the TTLs, one fetch per key, `?fresh=1` never joining a plain flight, the 65th key
  evicting the least recently used; 503 with the code and never the text, a kept answer re-served
  `stale: true`; a disabled row; `createAccountReader` and the seat route sharing one upstream
  read with `/data/account`; the stream's client grammar, frames passed byte for byte,
  `Last-Event-ID` winning over `since`, the Account's 503 passed on, the upstream aborted when the
  browser leaves; `stream/markets`' body as sent with its JSON content type, 413 past 4,096, 415
  before the body is read, 405; the four stage-2 reads with their names and never `force`; a
  write's body forwarded as sent with the Account's status, 413 past its limit, 415 for a body not
  declared JSON, 400 for a query, never cached or served stale, 503 with the code when the Account
  is unreachable, cut at its own abort), `account-fixtures` (the captured files carry what the
  views read, the stage-2 ones — `venues`, `keyfile`, `paper-books`, the three `prepared-*` — among
  them; no `native` or `icon` key at any depth, no array past twelve but in `venues` and a prepared
  action, the stream's data lines stripped too), `standin-helper` (the stand-in's home guard takes a `ui-standin-` directory
  directly under `tmpdir()` and nothing else; no stand-in on 4820), and the room suites below.
- **The eighteen `FACE_SMOKE` boots**, below.

The room suites are `room-rules` (the caps block verbatim, `GRAVIT.md`'s caps sentence pinned to
`ROOM_CAPS`, mention resolution, `isPass`, `finalTextOf`, dispatch validation and its two result
texts, the delta and the member prompt, the round-end text, the model route), `room-contract`,
`room-projection` (each fold in isolation, a refused `dispatch` restoring exactly what it
displaced, an `@` folded into an open round, the schema accepting every state the fold produces,
0.1.1's tool-result wrapper neither settling nor rolling back a dispatch), `room-engine` —
against a fake tree held to the engine's contract (`room-fake.ts`, in dsh 0.2's shapes: a
scriptable agent per member, `setup(agentCtx, agent)`, `snapshotEvents()`, `{header}`
snapshots, `sessionController.resolveAgent`, a manual clock, a root `session/event` bus)
covering member creation with the read-only pin in force at publication and refusal when it does
not take, `Context.agent` never read, resume-not-recreate, a legacy member session as a failed
turn while the other voice answers, a reader-less session failing closed, parallel isolation and
serial accumulation, continuations bounded to one turn per member per round, the three caps,
`settled` / `capped` / `superseded`, the deadline that extends while a member runs or has a gate
open and the hard cap that cancels with `keepInbox`, an `@` queued behind a running turn, the
cold-room resume and its 404/409 mapping, a re-selected session refused `dispatch`, and the two
routes under the fence — and `room-client` (the header fold, the strip and its state
precedence, the glyph, the mention anchor, the round-end line, the gate speaker, against
`js/wire/room.js` and `js/wire/grouping.js`).

The eighteen boots each own a file, because `bootFace` sets `process.env.DSH_HOME` for good, and
each speaks the browser's wire through `tests/remote.ts` (`mountClient`, `signIn`, `remote`):

- `smoke.test.ts` — the sign-in (`/` 401 without the cookie, the token's 303 and `dsh-auth-*`
  cookie, the page with it), `session/list` over the Remote wire, `/api` 401 without the cookie,
  a forged `Host` 403 even WITH a valid cookie (the fence runs first; sent through `node:http`,
  because `fetch` silently drops a forged `Host`), the mux upgrade refused before `commitReady()`
  and then 401 without / 101 with the cookie, `/data` fence-only (the search route, a forged
  `Host` 403), the four removed producer and bars addresses an ordinary 404; the Gate-2
  answer channel end to end — two signed-in `$events` tabs, a real `approval/request` reaching
  both, `$events/result` from one settling `allowed-once`, `cancel` to the other, the grant in
  `snapshotEvents()`; and the live tree itself: zero inactive entries, `str_replace_editor` and
  `ralph` registered, `web_fetch` and the three MCP resource tools not.
- `order-gate.test.ts`'s real-tree case — fires `tools/pre-execute` at
  `mcp__drill__portfolio_live_order` with a bare session so the real approval service's policy
  lookup runs: `ask` with a decidable `Account seat - …` reason, `portfolio_live_cancel` asked, a
  seat read and the names that merely mention an order allowed, an agentless call denied, a renamed
  server still caught, `bash` and `ask_user_question` left alone; then the guard through the
  registry's real `execute` path — the stand-in registered after boot with its ask swallowed by an
  outer listener comes back `isError` `without a logged allowed-once approval` with its body never
  run, and a session without `snapshotEvents` is denied with the distinct reason.
- `order-gate-smoke.test.ts` — Gate 2's positive path: a stand-in answerer on
  `approval/request` → the real `ApprovalService` → the logged `approval/asked` /
  `approval/decided` pair → the guard reading it → the body RAN for `allowed-once` and did not
  for `rejected` (`the user rejected tool "…"`); then, the stand-in removed, the real browser
  channel — two `$events` streams on one cookie-admitted socket, `$events/result`, the body
  running, `cancel` to the other stream.
- `order-gate-midboot-smoke.test.ts` — the window a 2026-09-30 review proved and `armOrderGate`
  closed: a fixture row (`tests/fixtures/midboot-slow-row.js`) holds `boot()` open on a latch
  while a second fixture row registers a seat-write stand-in, `mcp__drill__portfolio_live_order`,
  as soon as `tools` exists; with `bootFace` still pending and unary `/api` already serving
  `session/create`, the order call is HELD with `approval/asked` logged and its body not run, an
  agentless call is denied by the listener, and the same order with its ask swallowed by an outer
  listener is denied by the guard alone; after the latch releases, the held card reaches the first `$events`
  tab and `allowed-once` dispatches exactly once; a restart of the real `approval` row re-arms the
  listener exactly once (outermost again); after dispose no `tools/pre-execute` record remains.
- `account-seat-smoke.test.ts` — the Account seat end to end but for the human (skipped unless
  `FACE_ACCOUNT_SEAT_DIR` names an installed checkout of buyer-agent-demo): the Account's own stand-in
  started on a free port (no network, a fresh temp home, writes on), the face booted on a scratch home
  with the `mcp-account` row replaced whole by an id patch — the operator's own override path — pointed
  at the stand-in as its seeded agent (a key derived from the name, `PORTFOLIO_SEAT_KEYS=sim`; a
  scratch `BUYER_HOME`, so nothing lands in `~/.buyer-agent-demo`), then: the seat's 35 real-account
  tools registered and exactly its nine real-account writes in `auditOrderTools().gated`, nothing
  ungated; `portfolio_account` answering as the admitted seat with `paper-momentum`; a
  `portfolio_live_order` at the stand-in's exchange `rejected` at the face's card never reaching the
  seat, the card's reason `Account seat - … venue=ex`; the same order `allowed-once` reaching the seat,
  signed, and answered by the stand-in in Guard with `pending: true` and a `card-…` id; and
  `registerSeatRoute` against the stand-in reading the seat admitted, the paper venue marked and that
  card waiting. `order-gate.test.ts`'s real-tree case also asks about `mcp__drill__portfolio_live_order`
  with the seat's reason and lets `mcp__drill__portfolio_account` pass. Offline, the seat is `seat`
  (`seatView` over the Account's shapes and odd ones; the route's fence, `SEAT_TTL_MS`'s 15 s,
  `?fresh=1`, one fetch, the code never the text, the timeout, and every read through a reader it is
  given, fresh as asked), `orders` (the twelve, the unclassified fallback, the seat's
  reason and order, the key fields whole or denied), `roles` (the seat refused to a role), and the
  client's `kinds`, `thread`, `live`, `host-seat`, `account-view`, `account` and `app-dom` (the seat
  line, the card's venue, the receipts, the slice, the words, the box, the reads on Venues, Agents,
  Refresh and a seat receipt). The stand-in's start and stop are `tests/helpers/standin.ts`'s, which
  `account-graft-smoke` shares.
- `account-graft-smoke.test.ts` — the Account's reads through the face's proxy on a real boot
  (skipped unless `FACE_ACCOUNT_SEAT_DIR` names an installed checkout of buyer-agent-demo): the
  Account's own stand-in on a free port (never 4820), the face booted on a scratch home with AKShare
  and the `mcp-account` row disabled — no seat process, nothing written under `~/.buyer-agent-demo`
  — and `FACE_ACCOUNT_URL` at the stand-in; the proxy and the seat route registered on the booted web
  server as `main.ts` registers them (a bare `bootFace` mounts no `/data` route), and then, over the
  face's own port: `/data/account` 200 with `ok` and its venues, `/data/account/explore` listing
  items, `explore?force=1` refused 400 `invalid account request` and never asked of the Account,
  `/data/account/stream` answering `text/event-stream` with a named frame carrying JSON within 5 s,
  and `/data/seat.json` reading the Account reachable through the proxy's reader. Then the owner's
  half (stage 2): the client's own `host/owner.js` run under Node by `tests/helpers/owner-node.ts`
  (the client's store and reducers, Node 22's `crypto.subtle`, `memoryKeys()`, a flag in memory,
  `postVia` over Node's `fetch` to the face's port — never the stand-in's) pairs with the code the
  stand-in printed and signs; a `setWatch` on the first `ex` market the page does not watch, seen in
  `account.watch`, then `on: ''` and seen gone; with the stream opened first, a $25 market buy of
  ETH/USDT at `ex` placed as an `order`, its `fill` heard within 10 s, and ETH's cost-basis
  `coveredQty` in `holdings` risen by the fill's `filledQty` to within 1 %; a limit buy of SOL/USDT
  10 % under the ask resting `open`, then `liveCancel` answering that id `canceled`; the stand-in's
  seeded card (Claude Code's market buy of ETH) approved through `/data/account/exchange` and its
  `card` frame heard `approved`; an exchange from a foreign `Origin` fenced 403; and neither the pairing code
  nor any of the six signatures sent in what the face's process wrote. Torn down in
  `main.ts`'s order: the face, then the proxy's `dispose`, then the stand-in and its home (removed
  only when `isStandinHome` says it is one).
- `gravit-client-smoke.test.ts` — the new page on a real boot: `/` with its title and script,
  the modules under `/client` with their types, the old `chat.js` gone (404); then the host
  layer (`js/host/live.js` over the page's own `api.js` + `mapper.js`) on the real wire —
  `ready`, the list carrying a session just created, the pure reader over the raw list, the
  created session (live, its agent attached) opened into a loaded window with a clean status
  line; a bare `bootFace` mounts no `/data` route, which the live layer tolerates (the list
  lands with no channels).
- `client-mux-smoke.test.ts` — the page's own `client/js/wire/api.js` and `client/js/wire/mapper.js`,
  unmodified, against a booted face: `ready` and `host.home`, the envelope and business codes,
  `api-session/added`, the control baseline, a follow snapshot mapped raw and normalized alike, a
  real approval answered through `answer()`, the gap-free tail, a rejection, a second tab's
  `cancel` and `not-pending`, a Stop that withdraws a gate, a question answered with its batch, a
  gate replayed to a late tab, the non-activating `session/projections` + `session/page` reads,
  and a follow `cancel()`.
- `askuser-noclient-smoke.test.ts` (S7) — an agent-scoped `ask` with no client BLOCKS (it
  parks until the caller aborts); an agentless one rejects `NO_PROVIDER`. Prints one `observed:`
  line.
- `bots-smoke.test.ts` — roster listing with a broken fixture and never `_template`; the
  header's `agentPreset`; mask = allow ∩ tree, and a tool registered after the declaration
  admitted by the re-expansion; the persona shadow; over the repository's `roles/` the default's
  tool set equal to the host's, with no `role_*` tool (the gravit plugin masks nothing; no bot sees
  one either) and its
  prompt carrying the date and the cycle contract (`Step 0 — ask once`), neither of which a
  bot's does — the probe bot's mask admits `create_goal`, so its missing contract is the
  preset's scoping and not the `create_goal` gate; the SHIPPED relative plugin path rebased
  onto the real `face/plugins/bot.js` — its bots root is `mkdtemp`'d inside the repository as
  `.bots-smoke-*`, gitignored and removed in `finally` — beside an absolute one; **Gate 2 from
  a bot session**, both outcomes (a bot whose own mask NAMES the `mcp__drill__portfolio_live_order`
  stand-in still meets the tree-wide guard, and the same stand-in fired with that bot's agent returns
  `ask` with the symbol on the card, so the refusal cannot be credited to the mask); a `session/create` naming the broken
  preset refused with dsh's own `agent-preset` error.
- `bot-runtime-smoke.test.ts` — a saved bot route reaching the real model request without
  moving the host default (set by the profile's `agent-default-model` row, since nothing saves
  one); a save re-declaring, so an old conversation keeps its soul and a new one gets the saved
  one; the journal as a runtime-context snapshot.
- `bot-sandbox-smoke.test.ts` (S4) — a `read-only` session's write refused inside the tool's
  content, the command having run (§9, R10). Prints one `observed:` line.
- `room-smoke.test.ts` — a stub model route, three bots in a temp channel, one operator prompt
  → Gravit dispatches all three in parallel → alpha answers, beta passes, gamma's model fails →
  the answer is on the room log before the round-end wake, the wake is one turn, Gravit's
  synthesis is in it; every member is parented, preset-joined, `read-only` as its only
  `permission/preset` before its first turn, carries the channel's `GRAVIT.md` chain and lacks
  `dispatch`; the `room` value rides the session row and the per-record cache file; an `@` turns
  alpha, whose write into the channel is refused inside the tool content (D12) and never woke
  Gravit; a home session writes its journal and is refused on `../SOUL.md`.
- `room-discussion-smoke.test.ts` — the structured brief and member views, and each bot's
  journal, through the real request and log path; a member's persona is its own soul.
- `subagents-smoke.test.ts` — the native subagent lifecycle through the Remotes the page uses:
  the catalog composed from the parent's `subagentCatalog` projection and `session/list`,
  history as `session/page` on a subagent address, `subagents/prompt` and
  `subagents/interruptByParent`, a continuable child's `send_message` arriving as an
  `agent-message` relay, the slash-namespaced `subagent/*` errors.
- `instructions-smoke.test.ts` — what `dsh-agent-instructions` publishes onto a first request's
  log on a real tree after the instructions patch, from a fixture root holding `.git`,
  `GRAVIT.md`, `GRAVIT.local.md`, `AGENTS.md`, `CLAUDE.md` and `strategies/x/GRAVIT.md`: Gravit
  at the root reads the first two, a channel session in `strategies/x` reads the root file and
  the channel's own, a bot session reads the root file (the row is host-plane); `AGENTS.md`
  reaches none of the three, `CLAUDE.md` neither Gravit nor the channel session.
- `roles-smoke.test.ts` — role delegation on a real tree over two fixture roles made from
  `roles/_template` under the test's own roles root (no role ships): `role_auditor` (reads only)
  and `role_worker` (bash, its jobs, write) each spawn a one-shot child whose tool list EQUALS the
  role's `allow` (every `role_*` tool and the forbidden tools gone — an exact comparison, because
  dsh exempts a scope's own registrations from `restrict()`). For the auditor's child it also
  asserts the system prompt
  — the role's persona shadowing Gravit's, the date line, no `gravit:roles` section and no cycle
  contract (`Step 0 — ask once`) — the header
  (`origin: subagent`, `agentPreset: gravit`, its parent's cwd), the root `GRAVIT.md` in its
  `agent-instructions` baseline (a marker planted in the fixture root's file; Gravit's own
  baseline is the positive pair), and its text returning through the tool, while Gravit's own
  prompt carries the roles section and the cycle contract. A `subagent_fork` child (`isSeeded`)
  is then asserted to open its first request with Gravit's system text, whole — the cycle
  contract included, so the gate cannot be the header's `origin` alone — and to offer Gravit's
  tools in order. A plain `subagent` child (`origin: subagent`, not seeded) is the fork's pair:
  its tools include `create_goal` and every role tool, yet its system text carries neither the
  cycle contract nor the roles section, only the date — the header half of the gate
  (`isRootOrFork`), which visibility alone would not supply.
  Last, a role naming a tool the tree lacks fails at delegation with `tools.restrict() names
  unknown global tool "…"` (anchored on the quoted name) and no child is created. The MCP tools
  the roles name are `mcp__fixture__*` stand-ins; a foreground one-shot child leaves
  `ctx.sessions` as its result returns, so the smoke copies each session's header while serving
  its request.
- `goal-smoke.test.ts` — the goal loop `dsh/profile/cycle.md` rests on (the guide's C21),
  through the face's own wire on a stub model, in four sessions and two boots of one home.
  `create_goal` in a human turn returns the id and revision 1, `active` and `armed`; each round
  arrives at idle as a user message whose source is `{kind: goal, goalId, revision, round}`, its
  text `<goal_round>`, the objective and `Round: n/N`. The model's `blocked` in round 1 comes back
  `Error: blocked requires at least 3 consecutive goal rounds; current round is 1`
  (`GOAL_TOOL_BLOCK_THRESHOLD`); in round 3 it is accepted, the goal `blocked` with
  `{code: model-reported, message: <the reason>}`, and the next request carries the
  `<goal_blocked>` wrap-up (source `tool-goal`); a second `create_goal` in that session is
  refused, `goal "…" already exists with phase "blocked"` (`GOAL_ALREADY_EXISTS`). A goal of two
  rounds is blocked by the driver with `round-limit` (`Goal reached its configured limit of 2
  rounds.`) and the model gets no request after its second round. `session/cancel` (the Stop
  button) during round 1 leaves the goal `paused` (revision 2, disarmed); on "continue" the
  model's `get_goal` reads it paused and its `update_goal` resume comes back `Error: the model
  cannot resume a paused goal; the user must resume it` (`GOAL_TOOL_RESUME_PAUSED`), while
  `commands/execute` with `/goal resume` answers `Goal resumed`, `Status: active`, `Activation:
  armed`, and round 2 follows under revision 3. Last, the face is disposed during a round and
  booted again on the same home: for a second the model gets no request, `session/projections`
  shows the goal still `active` with one round started, and on "continue" `get_goal` reads it
  `active` and `disarmed`, `update_goal` resume returns revision 2 `armed`, and round 2 follows.

The gate drills use `mcp__drill__*` stand-ins of the seat's writes, so no real order is ever placed.

### 7.4 Drills (`face/README.md`)

The live browser drills below ran on dsh 0.1.1-rc.2. At 0.2.0-rc.2 their automated halves pass
(2026-09-30), and a first live pass ran the same day on a face at `8f0dedb` booted against a
SCRATCH `DSH_HOME` with the operator's Alpaca MCP row of the time, AKShare and a real model (never
the operator's home): the tokenized sign-in and the 401 without it; a new conversation streaming
its reply without a sidebar click; the approval channel's deny half (card with `displayReason`
and `reason` → `answered · deny` → the command did not run); a restart with the page open — the
old tab reconnected, the cookie survived (the plain URL loaded), the redrawn window carried no
duplicate bubbles, and the session stayed cold (`attachedSessions: 0`, `session.v4.jsonl.zstd`
and `session.lock` mtimes unchanged) until a prompt resumed it (attached 1, the log grew); the
agent panel (`dsh 0.2.0-rc.2`, model, host, keys `set · env`); `/data/plugins.json` listing
that server's ten tools and fourteen `mcp__akshare__*` tools (both FastMCP servers negotiated with
the 0.2 MCP client; the Alpaca server left the tree on 2026-10-24); and a room round in
`strategies/room-drill` (two bots checked in through `/data/channels/bots`, one prompt → `dispatch` → both members answered → the strip read
`round 1 · settled`, the discussion card attributed each voice, Gravit's synthesis followed,
and the member sessions carried `drill-bull` / `drill-bear` in `/data/channels.json`'s
`presets`). Every other manual row is still owed a re-run on the new pin, along with the checks
the re-host added (§10, item 14).

| Drill | Proves | Does not prove | Status |
|---|---|---|---|
| **Approval channel** (the README heading still reads "The Gate-2 drill"; its PASSED line calls it the approval-channel drill) — a file write outside the workspace escalates | request → answerer → card → outcome → paired `approval/asked` / `decided`; deny blocks, approve runs once | a producer for an MCP tool call | passed live 2026-08-31; re-run 2026-09-08 on `main`, passed. At 0.2.0 the channel itself — `api-remotes`, `$events`, `$events/result`, a second holder's `cancel` — is automated (`smoke`, `order-gate-smoke`, `client-mux-smoke`); the live browser re-run is owed |
| **Gate 2 on the seat's writes** — automated (`order-gate`, `order-gate-smoke`, `order-gate-midboot-smoke`, over `mcp__drill__portfolio_live_order` stand-ins) | the listener is registered, reaches the live approval service, defaults to `ask`, catches renamed servers, leaves the seat's reads and the names that merely mention an order alone (mutation-proven: removing the registration fails it); a retired `place_order`/`cancel_order` denied under any server; the positive path — a grant logged by the real approval service, the guard finding it through `snapshotEvents()`, the order dispatching, a rejection not — and the same answer over the real `$events` channel | that a human can read the card (the account-seat drill's); containment | passes 2026-09-30; on the seat's stand-ins since 2026-10-24 (stage 3's Task 4, the gate smokes 5/5) |
| **Account seat** — automated (`account-seat-smoke`; `orders`, `seat`, `roles`, the client's `kinds`, `account`, `host-seat`, `app-dom`) | on a real tree against the Account's own stand-in: the seat mounts with its 35 tools, exactly its nine real-account writes gated, a read answers as the admitted seat, a seat order rejected at the face's card never reaches the seat, the same order allowed once is signed by the seat and answered by the Account with a card of its own, and `/data/seat.json` reads that standing | that a human signs the Account's card; a real venue; the real service's own egress; the two-card flow from a conversation with a model | passes 2026-10-20 against buyer-agent-demo @ 133b9a7's stand-in (`FACE_SMOKE=1` with `FACE_ACCOUNT_SEAT_DIR`) |
| **Account seat** — manual (`face/README.md` "The account-seat drill") | the operator's keyed run: the real service with a paper venue, the seat admitted as Gravit, a `trade` limit on that venue, Gravit asked to buy on paper → the face's card → ✓ → the Account's card → signed → `portfolio_wait` → the receipt in the conversation, the order on the Account's statement, the seat box on Venues counting the card then not | run 2026-10-21 on the Account's stand-in (133b9a7, `--no-desk`, 4821) with `deepseek-flash` through a scratch-home face on 3097: all six steps observed (`face/README.md` records them), two client defects fixed from it (§4.5: a card drawn before its `tool/call`; dsh's `Error: ` prefix on a refusal) | **the real service: not yet run** — the condition before the branch lands |
| **The Account in the face** — automated (`account-graft-smoke`; `account-proxy`, `account-fixtures`, `seat`, the client's `account-stream`, `host-account`, `host-markets`, `account-view`, `market-view`, `account`, `markets`, `chart`, `rail`, `app-dom`; since stage 2 also `owner-key`, `key-store`, `host-owner`, `owner-view`, `sheet-view`, `host-sheet`, `owner`, `trade-view`, `host-trade`, `trade`) | on a real tree against the Account's own stand-in, over the face's own port: the Account's page and its markets through the proxy, a query the whitelist refuses never asked of the Account, the push channel piped with a named frame within 5 s, the seat box through the proxy's reader; and the owner's half — the client's own `host/owner.js` paired with the code, a watch signed and unsigned, a market buy filled on the stream and counted in the holdings, a resting limit cancelled, the seeded card approved, a foreign origin fenced, no code or signature in the face's output; offline, every route rule, the stream client, the device against a door that verifies like the Account's, the sheet's re-prepare rules, the views, the host layers and the wiring over fixtures captured from that stand-in | the real service's own shapes and pace (the stand-in's simulated venues; the fixtures are 133b9a7's); a browser drawing the screens, holding its key in IndexedDB and signing with WebCrypto; the second-device admission (the stand-in admits the first browser on the code) — the manual drill's; the stream's quote frames for a followed market and its reconnects on a live page | passes 2026-10-23 against buyer-agent-demo @ 133b9a7's stand-in (`FACE_SMOKE=1` with `FACE_ACCOUNT_SEAT_DIR`, at `9f1885a`); the owner's half 2026-10-24 (the suite at `b45c5cc`, the smoke again at `e111c27`) |
| **The Account in the face** — manual (`face/README.md` "The owner drill", run before the branch lands and after pulling the checkout) | the operator's run on the real Account at 4820 with paper venues only and the operator's browser already its owner: the face's head *waiting to be let in*, Let it sign on the Account's page, a `setWatch` signed from the face, Open a paper account from the face, a paper order from Trade and its fill, Gravit's seat order carded by Gate 2 in the thread and by the Guard in the face's Cards and approved there, the statement naming "You" and "Gravit, approved by you", Sign out and the head's line; then both smokes again | a real (non-paper) venue — the charter's D18 trigger | **not yet run** — owed to the operator |
| **Client transport** — automated (`client-mux-smoke`) | the page's own `api.js` + `mapper.js` against a real host: gates, replays, withdrawals, follows, the non-activating reads | the DOM: the page's rendering and its view modes run on a fake DOM (`tests/client/app-dom`, `live`), and `gravit-client-smoke` opens one real session through the host layer, not a browser | passes 2026-09-30; `gravit-client-smoke` 2026-10-19 |
| **Transport** — manual (`face/README.md`) | the browser half of the wire: the tokenized sign-in and the per-authority cookie; a cold session opened page-only, gaining no `session.v4.jsonl.zstd` or `session.lock` until it is prompted; a reconnect redrawing the window once; a new session's reply streaming without a click; `/compact` answered by `commands/execute`; the agent panel; the subagent dock; rename, fork, the directory picker, a channel rename (on the gravit-ui client Discover's Gravit item stands for the agent panel, Details' Children for the dock and Details' Fork for fork; the directory picker and a channel rename are not on it) | the approval card's endings, which are the Gate-2 drill's | **not yet run** on 0.2.0 against the real home — a headless load of the page on a scratch home reached `connected` with no console errors; the stage-1 page was walked 2026-10-19 on a scratch home without keys (the ledger): sign-in, a New message in `workbench` created, named and prompted, the missing-key error on the status line, a restart then a reload opening the cold session paged |
| **Bots** — automated (`bots-smoke`, `bot-runtime-smoke`, `bot-sandbox-smoke`, `askuser-noclient-smoke`) | roster listing incl. broken; header `agentPreset`; mask = allow ∩ tree, following late tools; persona shadow; the default's roster equal to the host's (no role ships, so no role tool; never a bot's), its date section and its cycle contract (`Step 0 — ask once`) scoped to Gravit (never a bot, though the probe bot can call `create_goal`); the shipped relative plugin path, rebased; a save re-declaring; Gate 2 refusing an order tool the bot's own mask admits; the S4/S7 observations | that the approval CARD renders (no client) — a bot in a room and a home session's write to `../SOUL.md` were this row's two gaps until `room-smoke` closed both | passes 2026-09-30; re-run 2026-10-19 with the role tools in the default's roster and the cycle contract in its prompt; 2026-10-24 with none |
| **Bots** — manual (`face/README.md`) | create → home → persona → tools named and not named → `{{` refused; the sidebar buckets the home session under the bot; a restart's boot line lists the id; the transcript names the speaker on all four surfaces (second run) | no automated test pins the four naming surfaces or the reconnect path; per-message attribution in a room is the Room rows below | passed 2026-09-07; re-run 2026-09-08 on `main` with the R12 fix in, passed; owed on 0.2.0 |
| **Room** — automated (`room-smoke`, `room-discussion-smoke`) | a real round on a stub model: dispatch → three members (answered / passed / failed) → answers on the log before one wake → synthesis in one turn; members parented, preset-joined, `read-only` first, `GRAVIT.md` chain, no `dispatch`; the projection on the row and in the cache; the `@` route with a member's write refused in content; a home refused on `../SOUL.md`; the structured brief and views; the journal | that a human can read the strip; a real model's behaviour on the four standing rules | passes 2026-09-30 |
| **Room** — manual (`face/README.md`, eight parts) | check-in → dispatch line → attributed bubbles and the strip → the fold → `@` → an inline member question with the needs-you mark → a member's write refused → `left` and re-check → a restart keeps states and titles | per-message attribution across a reconnect; convergence of four voices on one model (spec §12, R3); the peer-`@` continuation, which the operator's next `@` superseded before it ran (by design) — that path stands on the engine tests | **Drilled and PASSED 2026-09-09** on the operator's own face (`feat/rooms` @ `31b2e68`, two fresh template bots, DeepSeek as the model); one client finding (F1, the strip missing on a session's first round) fixed the same day and re-verified; owed on 0.2.0, whose 0.1.1 room sessions no longer open (§9, R20) |
| **Ask-user** — `ask_user_question` offered, called, answered, cancelled | the seam | that it is a gate (the answer is model-visible); the instruction half (README step 6 — on a thin brief that does not name the tool, Gravit asks before it builds, per Step 0 of `dsh/profile/cycle.md`), left to the operator and not run | passed 2026-09-03 with a real model, 26 tools offered; re-run 2026-09-08 on `main`, passed (34 tools offered; answered, then Stop → `closed · cancelled`); owed on 0.2.0 |
| **Role** — automated (`roles-smoke`; `roles`, `gravit-plugin`, `boot`, `bot-presets`) | on a real tree over two fixture roles made from `_template` (no role ships), `role_auditor` and `role_worker` each spawn a one-shot child with exactly the role's tools (compared as sets, not as a subset); the auditor's child carries the role's persona shadowing Gravit's, the date, no roles section, no cycle contract (`Step 0 — ask once`) and the root `GRAVIT.md` in its baseline, its text coming back through the tool; a `subagent_fork` child gets Gravit's system text — the cycle contract included — and tools unchanged, a plain `subagent` child neither section though it can call every role tool; a role naming a tool the tree lacks failing at delegation, naming it, with no child; the gate on the roles section, visibility and header; the reader's refusals, the render and the mirror's drift | that a real model chooses and calls a role sensibly; what the child's log shows on a live home; a `bash` run long enough to be moved to a job; the generic tool paragraphs the child's prompt still carries | passes 2026-10-19; on the fixture roles since 2026-10-24 |
| **Role** — manual (`face/README.md`, five steps and a clean-up) | on a scratch copy of the operator's home, once a role ships: Gravit calls it; the child's log shows exactly the role's tools and its persona, not Gravit's; a `bash` role's run past bash-sandbox's 60 s default either passes `timeoutMs` or reads its moved job before reporting; a role naming an unmounted server's tool fails the delegation with `tools.restrict()` naming it and creates no child; Gravit's own log shows the role tool and the roles paragraph | a real model's judgement over several delegations | **not yet run** — and not runnable until the operator writes a role (none ships since 2026-10-24) |
| **Cycle** — automated (`cycle`, `gravit-plugin`, `boot`, `roles`; `bots-smoke`, `roles-smoke`, `goal-smoke`) | the shipped `cycle.md` reads, fits its 3,300 bytes and carries the steps, the 24-round cap, the resume path and the blocked vocabulary, names no role and runs on a forward paper trade; the reader's refusals, path first; the `gravit:cycle` section's order, literalness and gate; the mirror carrying the text; on a real tree Gravit's prompt carries `Step 0 — ask once`, a probe bot's (which can call `create_goal`), a role child's and a plain `subagent` child's do not, a `subagent_fork` child's does and equals Gravit's; the goal loop itself (`goal-smoke`): `create_goal` in a human turn, the round message at idle, blocked refused in round 1 and accepted in round 3 with the `<goal_blocked>` wrap-up, a second goal refused, the silent `round-limit` cap, Stop pausing the goal with the model's resume refused and `/goal resume` re-arming it, a restart disarming it until "continue" | that a real model asks once, opens the goal, runs rounds by itself, trades on paper through the seat, is resumed by "continue" after a restart and ends in a verdict; a cycle's rounds, wall time and usage | passes 2026-10-19 (`goal-smoke` since `fae4f61`); the text checks on the new cycle 2026-10-24 |
| **Cycle** — manual (`face/README.md` "The cycle drill", five steps) | on the operator's face with a real model and a channel from `_template`: one batched `ask_user_question` naming the paper venue and the window, and no file before it; `create_goal`, then rounds with no question (no commit inside the rounds) that read the Account through the seat and AKShare, place a forward paper trade — Gate 2's card and the Account's Guard card, each answered — and journal dated entries with the Account's figures and order ids; a verdict in `status.yaml` and the journal's last entry with the usage line to fill, the goal complete on `validated` or `retired` and blocked on `researching`, on a named code; a restart that continues only on "continue"; the rounds, wall time, usage and first-request figures recorded in §4.3 | whether the verdict is better research (charter D14); a model's handling of a paused goal (R30) beyond what the run happens to meet — the mechanism itself is `goal-smoke`'s | **not yet run** — the operator's, on the real face |

Owed besides, from the re-host, never yet run in a browser: the Gate-2 drill's new card endings
— a second tab's `closed`, a lost race's `closed · settled elsewhere`, a stale card's `closed ·
no longer pending`; the approve half of the approval channel;
the room drill's `@`, an inline member question, a member's refused write, and a member trace
that does not activate its member; the bots drill (create, soul edit, re-declare without a
restart); the ask-user drill; rename, fork and the directory picker. The go-live runbook's §7
stages all of them, with the transport drill, on a copy of the operator's home.

---

## 8. Conventions

- **An offline suite, no keys.** The face suite runs with nothing configured; a test that needs the
  network monkeypatches the seam. The real-boot tests are opt-in behind `FACE_SMOKE=1`.
- **A real boot speaks the browser's wire.** Each smoke owns one `bootFace` in its own file,
  mounts the real `/` and signs in through it (`tests/remote.ts`: `mountClient`, `signIn`,
  `remote`) before any `/api` call; `client-mux-smoke` drives the page's own `api.js` and
  `mapper.js`. The structural `*Like` types hide most dsh drift from `tsc`, so after every pin
  bump the eighteen real boots are the contract.
- **An arc is** brainstorm → spec (`docs/superpowers/specs/`) → plan → build with tests → a
  whole-branch review → a post-build amendments block on the spec. The block is what freezes the
  spec; the Status line is left as written. Of the five post-reset specs, chat-light,
  instruments and bots-and-rooms carry the block — the last for all four of its plans; the
  skeleton and channels specs have none and still read "pending user review" (§10). Three
  pre-reset specs say the same and are retired, not open. The dsh 0.2.0 re-host was built from
  a plan kept outside the repository; its decisions are §4.8.
- **A guard ships with its drill in the same change** (charter Rule 4). A guard that has never
  been pulled is presumed broken.
- **Never edit**: the installed profile copies under `$DSH_HOME` (operator territory; the face rewrites `cordis.yml`), anything under
  `bots/` (the operator's voices; Gravit proposes one in conversation and creates none), anything
  under `docs/research/` (frozen inputs).
- **No custom session-event types.** dsh's persistence refuses to reload a log carrying an
  unknown type; a room fact rides a known event with a room `source` — `kind: 'room'`, a native
  v4 message source since 0.2.0 (the 0.1.1 logs that carry it are the ones the 0.2 migration
  refuses, §9 R20).
- **A bot's mask is visibility, not authority.** Write sentences that say so; the session's
  sandbox mode and Gate 2 are the fences, and neither is containment.
- **Channel names do not admit spaces.** They become shell paths Gravit types by hand.
- **Line numbers in prose go stale in days.** Cite files and symbols.
- **Credentials never enter the repo**; `.env*` is gitignored; error bodies never echo child
  stderr.
- **Commit messages with code go through a file** (`git commit -F`): backticks and `$()` in
  `-m` are shell.
- **Descriptive docs.** This file, `CLAUDE.md` and `face/README.md` state what is; when the
  code moves, the doc is fixed, not defended.

---

## 9. Recorded residuals

What actually holds, stated once (charter Rule 3). None is a guarantee; each is a known gap.

- **R1 — Gate 2 holds the MCP tool surface, not the account.** The seat signs with a key file in
  the Account's home (`$BUYER_HOME/seats/gravit.json`), which a shell turn can read and use at the
  Account's door with no Gate 2 card (R34); dsh scrubs keys from the shell's *environment*, not
  from files. The Account's own Guard card and the paper-only limits the operator signs bound the
  damage. (Until 2026-10-24 this row named the Python package's flagless order function and its
  key file at the repo root; both left with the package.)
- **R2 — Gate 2 is a gate, not containment.** `tools/execute` runs after the guard, is handed
  the execution as mutable, and re-resolves the tool by its current name; Gravit has an
  unrestricted shell. It stops the model's ordinary tool calls.
- **R3 — The face's loopback surfaces are reachability fences, not authentication.** One
  un-escalated shell turn can `curl` `POST /data/channels/agents` (or `/data/agents/connect`): no
  card, no diff, no session event — `/data` takes no cookie (PLAN D8). The sandbox confines file
  effects; network stays unrestricted. Mitigation is visibility (`roster.log`), not prevention.
  dsh's own `/api` (`workspace/*` among it) wants the browser cookie since 0.2.0, which puts it
  one step further off, not out of reach (R3a).
- **R3a — The approval answer itself is forgeable from the workspace.** Since 0.2.0 the answer
  is `POST /api/$events/result` under an `$events` clientId, and both want the browser cookie.
  But the cookie is an HMAC over a signing secret stored in `$DSH_HOME/.credentials.yaml`, and
  the sandbox fences file writes, not reads: one un-escalated shell turn can read the secret,
  sign a cookie for `127.0.0.1:3090`, open its own `$events` stream — every pending approval is
  replayed to it — and answer the order it just asked for; the log then holds a genuine
  `approval/asked` + `approval/decided{allowed-once}` pair and the guard admits it correctly.
  The gate asked; the wrong party answered. Read from the code, not executed (0.1.1's version of
  this hole — `/api/respond` with a readable `rpcId` — was `face/README.md`'s "The shell can
  answer its own card").
- **R4 — The channel roster is a menu, not a fence.** Tool registration is tree-wide (schemas
  visible everywhere, only the call refused); a session in no channel is never roster-checked;
  a shell turn can invoke the CLI directly.
- **R5 — The MCP servers' writes bypass the sandbox.** They are children of the face process, not
  of a session; the seat writes its key file into the Account's home with no card (R34).
- **R6 — The charter recorded a seat the tree now fills.** *Resolved 2026-09-09.* The charter's
  D11 now names the persona mechanism (plan 4). As of 2026-09-07 the model IS told it is Gravit:
  `composeFace` patches the `system-prompt` row's persona — `personaPrefix` since 0.2.0, the
  same order-0 slot 0.1.1 called `persona` — from `dsh/profile/persona.md` through `readPersona`,
  which refuses the boot on a template the strict renderer would throw on.
- **R7 — Gate 2 exists only inside the face.** A dsh tree composed without it has only the
  Account's own Guard card; the profile's `always_ask` block is inert.
- **R8 — Registration is not readiness.** *Resolved 2026-10-24 by removal* for the case it named
  (the Python package's snapshot-backed tools). The shape remains in the seat: it registers its 35
  tools with no service to reach (§3.1), so a listed tool is not a reachable Account — the seat box
  (`/data/seat.json`) says which.
- **R9 — The never-edit list is prose, not a fence.** No sandbox deny path and no test protect
  the skill packs, `roles/`, `bots/` or `docs/research/`; from a root session Gravit can rewrite
  any of them with no card (§4.1). Detection is `git diff`.
- **R10 — A sandboxed write is refused inside the tool's own content, not as an error.** Measured
  on a real tree (`bot-sandbox-smoke.test.ts`, spike S4): under the `read-only` permission preset a
  `bash` write returns `isError: false` with no `approval/asked` event, and the refusal appears in
  the result text as `[sandbox: file access denied under read-only mode]`, followed at 0.2.0 by
  `[sandbox: escalation available — retry this exact command once with sandbox_permissions …]`.
  The file does not exist. A caller that reads only `isError` sees a success, so any rule about a
  bot's writes is worded off the CONTENT. The escalation the content offers is real: a retry
  with `sandbox_permissions` raises an approval card, so the operator can grant a room member the
  write the preset refuses, and the grant is logged on that member's own session (observed and
  denied in the room drill's part six). The bot/Gravit asymmetry is
  enforced-with-a-human-exception, not absolute.
- **R11 — A question with no client connected blocks; it never fails.** Measured
  (`askuser-noclient-smoke.test.ts`, spike S7): `userQuestions.ask()` from an agent-owned session
  with no browser attached neither answers nor rejects — `api-remotes` parks it in the gateway
  until the caller aborts, exactly as the approval card does. An agentless (host) ask is the other
  branch and is rejected up front: `NO_PROVIDER` at 0.2.0, since `api-remotes` forwards only a
  scoped ask (0.1.1's apiproxy said `web user interaction requires an agent-owned session`). In a
  room the abort has an owner: a member's turn holds its deadline open while a gate is pending
  (`gatePending`) and the hard cap (`turnHardCapMs`, 20 minutes) is what finally cancels the turn,
  so an unanswered member question ends the round `timed-out` rather than hanging it.
- **R12 — The transcript labels a bot's reply as Gravit.** *Resolved.* Observed in the manual bots
  drill (2026-09-07): a home session's replies open in the bot's persona, the sidebar buckets the
  session under the bot's name, but the speaker label over each assistant turn is the fixed
  `Gravit` the message renderer in `chat.js` writes into the `who` element, not the session's
  `agentPreset`. Cosmetic today (one voice per session); it becomes a truth problem the moment a
  room shows several voices in one log (plan 3). Fixed 2026-09-07: the label is per SESSION
  (`speakerFor` in `client/speaker.js` — since 2026-10-19 `client/js/wire/speaker.js`, read per
  conversation by `speakerOf` in `js/host/live.js`, which hands the kind table a bot's id for its
  home session — from the summary's `agentPreset`), carried on the old page by all four
  naming surfaces alike — the `who` element, the ask card's head, the composer placeholder and the
  status pulse, whose phrases (`PULSE_PHRASE`) no longer carry a name at all (§5.1). It is also
  re-derived from every `session/list` that lands (`refreshSessions`; since 0.2.0 each row's
  `agentPreset` is restored by `summaryOf`), so neither a reconnect nor a roster that arrives late
  can leave a stale name over a live transcript. Per-message attribution — several voices in one
  room log — stays plan 3. Browser-proven 2026-09-08 (manual bots drill, second run): the bot's
  name held on all four surfaces across session switches, a reload and a face restart with the tab
  parked on the bot's session. Still, `speaker.test.ts` and `summaries.test.ts` pin only the
  decision; no automated test pins the four surfaces or the reconnect path.
- **R13 — Every cold session lists as `untitled`.** *Resolved 2026-09-08.* Measured before that on
  a fresh boot: `session.list` returned 24 sessions with no projections block, because dsh-base
  0.1.1 composed `session-projection` without a persisted cache, so a title showed only while its
  session stayed attached; the face closed it with an overlay row of its own. At 0.2.0 dsh-base
  mounts `dsh-session-projection-cache` itself and the face's row is gone: one record per session
  under `storages/session_projcache/sessions/`, bootstrapped from 0.1.1's single
  `session_projcache.json`; a cold session's `session/list` row carries a `cached` projection
  block, from which the sidebar reads the title. A record carried over from 0.1.1
  yields the title alone, so the row's `agentPreset` comes from `/data/channels.json`'s header
  hint until the session runs under 0.2.0 (§5.1, `summaries.js`).
- **R14 — A room's answers are appended to Gravit's log by the face, not spoken by Gravit's
  driver.** Honest and necessary (plan 2, deviation 2), but it means a room log can gain user-role
  messages while no client watches and while Gravit is idle; the persistence write path records
  them like any event. The `quiet` rule (no open turn) is what keeps a running request intact.
- **R15 — Fine states are presence, not truth.** `thinking` / `writing` / `tool` on the strip
  come from the `block-start` frames of each LIVE member's own `session/follow` (a member not
  followed gets only `thinking`, from `api-session/status`), held in the client's memory and
  cleared at turn boundaries; a reload loses them; the log never held them.
- **R16 — The membership rule is a header rule.** A session is a member of `P` when its header
  names `P`, has no `origin`, and a bot preset, and `P` runs the host. A fork of a room keeps the
  host preset and a subagent child carries `origin`, so both stay out; a session re-linked to
  another preset through `agentPresets/select` (a Remote the face never calls) could masquerade
  in the sidebar's fold, though not at `dispatch`, which since 0.2.0 refuses any session whose
  header OR `agentPreset` projection names a bot.
- **R17 — `superseded` is a third outcome.** The spec named two; a round the operator's next
  message cut short is neither settled nor capped, and the log says so.
- **R18 — The channel landing page lists a room's member sessions as plain `untitled` rows.**
  Observed in the room drill (2026-09-09): the member sessions are shown and counted, so Rule 5
  holds — nothing is hidden — but the rows carry no voice, while the sidebar's own fold labels
  each member with its bot's name. Polish, not a truth problem; a member's transcript names its
  voice the moment it is opened. Closed with the old page: the gravit-ui client has no landing
  list of sessions — the conversation list folds a room's members under the room (§5.3) and a
  channel's page lists none.
- **R19 — Dispatch is Gravit's judgment, and nothing checks it.** Gravit chooses whom to call and
  in which mode; it can under-call or over-call a voice, and no rule in the engine says otherwise.
  Three things push against it and none removes it: the tool result names who was NOT called, the
  operator's `@` reaches any rostered voice directly, and the round-end text asks for the
  disagreements before the conclusion.
- **R20 — Logs the 0.2 migration refuses stay unreadable.** Measured 2026-09-30 by read-opening a
  COPY of the operator's home with the installed 0.2.0 persistence (a read-open writes nothing;
  `face/scripts/check-home.ts` repeats the measurement and classifies each refusal):
  14 of 39 sessions refused, holding 64.8% of all logged events — the ten 0.1.1 room sessions,
  whose `kind: 'room'` user messages the v2→v3 edge does not admit (PLAN D11), three subagent
  children with a version-2 `subagent/descriptor`, and one ordinary session with a sequence gap
  (PLAN D17). Nothing rewrites them. The face reports instead of crashing: a legacy member is
  that member's `failed` turn, naming the legacy format, on every round until the operator
  deletes the member session (archiving does not help: an archived session is still found);
  `/data/rooms/say` on a legacy room answers 409 with dsh's message; an ordinary legacy session
  fails its page read with dsh's error; a child the migration marks `unknown` shows as the dock's
  `unsupported` diagnostic. Detection is by error name or text, so a corrupt v4 log would also
  read "looks like a log written before dsh 0.2" — the message hedges.
- **R21 — Gate 2 and the room engine read `snapshotEvents()`, which upstream deprecates for new
  callers.** It replaced the `events` getter 0.2.0 removed without a word. A later pin may remove
  it too; both then fail closed and say so (the `orders`, `order-gate` and `room-engine` suites
  pin the sentences). The successor upstream names is a grant index fed by `session/event`
  (§10, item 11).
- **R22 — Following can still activate.** A cold session is never followed on purpose (§5.4), but
  liveness is a snapshot: a member, or the session on screen, that goes cold between the list's
  `agentAvailable` and a follow's open is promoted — its log write-opened, `session.v4.jsonl.zstd`
  and `session.lock` published. The reconnect path depends on `api.js` calling `onDown` before
  the next socket re-opens the registered streams (`api.test.ts` pins that order). Stop on a
  paged session answers the host's live-only `session/not-found … (not attached)`.
- **R23 — MCP servers spawn twice and speak into every prompt.** At 0.2.0 stdio negotiation
  starts a probe process before the serving one, doubling each server's start cost per connect;
  a server's `instructions` become an unswitchable `mcp:<server>` prompt section that bots see
  too (sections are not masked like tools), and instructions over 32 KiB fail the connection. A
  one-tool FastMCP server on the operator's interpreter (`mcp` 1.28.1) negotiated with the 0.2
  client; AKShare's install and live listing are a drill still owed (§7.4).
- **R24 — `agentPresets/read` hands any signed-in client a bot's composition**: its persona text
  and the absolute rebased paths (the face's install path). 0.1.1 had no such Remote; `/api` is
  cookie-gated, which R3a qualifies.
- **R25 — A subagent's `activity` now means mid-turn.** 0.1.1's `running` meant "resident"; at
  0.2.0 the dock reads `running` only while the child is in a turn, so an idle resident child
  reads 未运行 and offers no interrupt.
- **R26 — The redeclare window.** A save disposes a bot's declaration before registering the new
  one (the registry refuses a duplicate id); in between, a `session/create` or a room mount
  naming that bot fails `agent-preset/not-found`. Saves of one bot are serialized; running
  conversations keep the revision they joined.
- **R27 — The spill budget moved (PLAN D18).** dsh-base's `spill-policy` now takes only
  `maxInlineTokens` — 12,500, estimated as UTF-16 length / 4 — where 0.1.1 had `maxInlineBytes:
  50000`. ASCII results spill where they did; CJK-heavy AKShare results stay inline about three
  times longer (about 50,000 characters, some 150 KB), which is context and cost per call. No
  single value reproduces 0.1.1; the policy row is one line once the operator chooses.
- **R28 — The default model is a patch row, and nothing saves it** (PLAN D1, D2). Without
  `profileContext` there is no config editor, so `agentDefaultModel.saveSelection` writes nothing:
  a model selection changes one session only, and the route is the profile's
  `agent-default-model` row or dsh-base's `deepseek-official/deepseek-flash`.
- **R29 — The role-call count.** *Resolved 2026-10-24:* the research cycle calls no role and
  keeps no count (charter D16); the 24 rounds still end in the goal's own `round-limit` (the 24 is
  Gravit's argument to `create_goal`, as `cycle.md` instructs; dsh's own default is 256). Should a
  role come back into the cycle, dsh still bounds no one-shot child (`maxActiveSubagents` limits
  only live continuable ones), and the count would again be Gravit's to keep.
- **R30 — A goal survives a restart disarmed; the operator's next message is the resume path,
  and a paused goal is the operator's alone.** After a restart the goal is still active and
  nothing continues it; a round that errored or stopped at max tokens leaves it disarmed the same
  way (the round driver's `agent/error` and `max-tokens` handlers), and so does the Stop button
  in a human turn. `cycle.md` tells Gravit to read the ref with `get_goal` and call `update_goal`
  with `resume` when the operator asks to continue, in any wording, and dsh accepts the model's
  `resume` only in a direct human turn on a root agent. The face's Stop during a ROUND does more:
  the driver sees its round cancelled and PAUSES the goal (a new revision, disarmed). A *paused*
  goal is the operator's alone: the model's `resume` of one is refused (`GOAL_TOOL_RESUME_PAUSED`)
  and `edit` leaves the phase as it is, so `cycle.md` has Gravit ask the operator to type
  `/goal resume` — `client/js/host/actions.js` sends every line that starts with `/` to `commands/execute`
  before it is a prompt, and dsh-base's `command-goal` answers it. `/goal resume` also re-arms a
  restarted goal (dsh-goal's `resume()` accepts an active goal that is not armed): a
  deterministic fallback should the model not call `update_goal` on "continue". `goal-smoke`
  (§7.3) pins the three paths on a real boot — the restart until "continue", Stop's pause with
  the model's resume refused, `/goal resume` re-arming — so a pin that moves one fails there.
  Nothing inside the rounds may wait on the operator: a commit from the channel session raises
  an approval card (§3.3), so the contract allows one commit, with the verdict — that commit
  raises the card after the rounds are over, when the operator is back. The design
  spec's §11 (e) took the client to send no slash commands; it does, since the 0.2.0 port. The
  cycle drill's restart step runs a real model's path on an active goal; a real model meeting a
  paused goal has not been drilled.
- **R31 — The tool-schema block is AKShare's fourteen tools; the lever is not pulled.** 32,003 of
  the 2026-10-10 first request's heuristic tokens were schemas (§4.3), the largest part.
  `face/scripts/schema-sizes.ts` priced it per tool on 2026-10-19 (a scratch home; §4.3 has the
  table): AKShare's fourteen tools, whose descriptions enumerate every method, were 24,426 of the
  31,620 heuristic tokens measured (77%), the host's 26 tools 5,857, the three role tools 685 and
  the Alpaca server's seven keyless tools 654 — those last two gone since 2026-10-24, the seat's
  15,727 come since (R35). AKShare's price in billed tokens is not measured: AKShare's schemas hold 18,211 CJK ideographs, which the heuristic prices at a quarter
  of a token each. Which tools Gravit may lose — the
  lever is a mask on its own preset, `tools.restrict` in `gravit.js`, as `plugins/bot.js` does
  for a bot — is the operator's decision on those numbers, in the next round (§10).
- **R32 — Two cards per seat write.** A seat order stops for the face's Gate 2 card in the conversation
  and then for the Account's own Guard card, signed with an owner's device key: since the graft's
  stage 2 the second card is answered in the face's Cards too (✓ Approve / ✗ Reject on a page that
  signs, the face's page being one of the Account's owner devices — the key the browser's, never the
  face process's), but it is still a second card, and the Account's per-seat paper autonomy covers
  only its Desk, never an outside seat (`src/portfolio/account/desk.ts:1129-1137` at 133b9a7).
  Accepted for the paper stage; one card per write is a request to Linqi, not a change here.
- **R33 — The Account moves under the face, and the face pins nothing of it.** Twenty-six pull requests
  landed in the twelve days before the pin. The gate's twelve write names and thirty read names are
  spelled at 133b9a7; a write the Account renames falls out of the list — under the face's own
  prefix it is carded as an unclassified seat tool, under another server name the boot audit
  refuses only when none of that server's seat writes is covered (`uncovered`), and
  `account-seat-smoke` against the installed checkout is the canary (re-run it after pulling the
  checkout). A changed `/api/account` shape never puts a wrong number in the seat box
  (`seatView` is total), but the box does not say unreadable either: a body that does not parse reads
  `<host> · not reachable`, and one that parses but has moved shape falls to the view's defaults —
  `<host> · reachable`, `Read-only`, `Gravit · not on the account` — words the Account did not say.
  The seat is matched by the name the owner typed: admitted under another name, it shows as knocking
  or absent. Since the graft's stage 1 the two screens read the Account's
  shapes too: a page `pageOk` does not recognise reads `Account unreadable`, every other view answers
  its empty shape, and the fixtures (`face/tests/fixtures/account/`, 133b9a7's) and
  `account-graft-smoke` are the canary — recapture and re-run after pulling the checkout
  (`face/README.md` "The Account in the face"). Since stage 2 the face also speaks the Account's
  door protocol (the owner path map at 133b9a7: the pair answer, `canonical`, the envelope, the
  action types and their fields): a change there refuses every signature
  (`E_ACCOUNT_BAD_SIGNATURE`, which re-reads the standing and says so on the device line) or a
  draft (the Account's words at prepare) — never signs something else — and the smoke's owner half
  is the canary for it too.
- **R34 — The seat's key is written outside the workspace, and the seat's reach is the owner's grants.**
  The seat process, a child of the face, writes `$BUYER_HOME/seats/gravit.json` into the Account's home
  (D10's clause, a second writer); the face never reads it. What the seat may do is exactly the limits
  the operator signs at the Account (on its page, or since stage 2 from the face's Give a limit…,
  whose venue pick is the Account's venues, paper first, never `*`): the face draws the Account's
  venues as the Account reports them and cannot tell a paper venue from a real one beyond its flag,
  so a limit signed on a real venue would reach real money through the same two cards — the
  charter's §8 trigger and D17, not a fence in this tree. The service's own egress — venue probes every thirty minutes, the
  location lookups, the public quotes — is Linqi's program's (`face/README.md` lists the hosts); the
  face's loopback posture is unchanged. And the seat has R1's shape: a shell turn can read
  `$BUYER_HOME/seats/gravit.json` and sign an instruction at the Account's door with no Gate 2 card —
  the Account's own Guard card and the limits the operator signed bound it (R1), and nothing in
  this tree can.
- **R35 — The seat's tool block is the second lever.** 15,727 heuristic tokens for 35 tools (§4.3),
  64% of AKShare's; four seat tools are larger than the host's largest. Mounted together they put the
  block near 46,010 chars/4 before any mask; the mask on Gravit's preset (R31) is still the lever, and
  still the operator's decision.
- **R36 — The face's keyed quote providers and its own producers.** *Resolved 2026-10-24 by
  removal* (stage 3 of the graft, the design's §12): the Alpaca stream and snapshots, the Coinbase
  provider, the US and crypto half of `/data/symbols/search`, `/data/bars` and the three producer
  routes left with `data.ts`, `bars.ts`, `watchlist.ts`, `quote-streams.ts` and the Python package.
  The face's own quote wire speaks A shares alone (iFinD, Tencent): a well-formed `us:` or
  `crypto:` id is answered without a quote, a `market=us` search is 400. `APCA_*`, `ALPHA_*` and
  the producers' interpreter variable are read nowhere (`agents.ts` still scrubs the two APCA
  names from a CLI agent's environment). A keyed source comes back, if wanted, as a wallet — an account the owner connects
  to the Account, Alpaca's key file as a venue — and later as an MCP server of its own for Gravit,
  as the seat is. An unmerged branch that reads `/data/quotes` for US ids (`feat/desk`) meets a
  wire that no longer quotes them — that branch's landing question (the design's §11).
- **R37 — The face's page is an owner device of the Account (charter D18).** Since the graft's stage
  2 the browser profile that holds the face's key can sign anything an owner can — hand orders up to
  the Account's live cap on every venue connected there, seats' limits, cards, venue connections,
  other devices. The key is the browser's (WebCrypto, not extractable, IndexedDB at the face's
  origin): clearing the face's site data loses it, the Account keeps the old device's row, and the
  new key is admitted like any other; no export, no backup (the Account's posture). The owner's hand
  orders pass through no gate of this tree's — Gate 2 is the agent's — only the Account's cap and
  *What you sign*; the face tells a paper venue from a real one only by the Account's flag. The
  proxied owner routes are as open as the Account's own: a local process without the face's cookie
  reaches `/data/account/pair`, `prepare` and `exchange` as it reaches the Account's door, and does
  nothing without an admitted key — but a local process could pair a key of its own and wait in the
  Account's pending list for an owner's Let it sign, so a device waiting there that the operator does
  not recognise is refused, not let in. The pairing code and the envelopes pass through the face
  process once, unparsed and unlogged (the smoke greps the face's output for the code and every
  signature sent), and the body is forwarded as the UTF-8 text the proxy read — a body that is not
  valid UTF-8 would be altered (JSON is UTF-8; the browser sends nothing else). The face's signing
  client is the Account's protocol reproduced by hand (R33). The last device out makes the Account
  print a new pairing code in its own terminal, which the face cannot read.
- **R38 — Stage 2's known gaps, recorded and deferred** (the ledger
  `docs/superpowers/plans/2026-10-22-account-graft-ledger.md`, stage 2, keeps every one). On the
  screen: a refused `setWatch` pressed on a market's page is said nowhere there (the page draws no
  watchlist words); on a page that does not sign, a row watched only at the Account shows a Stop
  watching that does nothing (the Account's own page disables it and says why); a page watch entry no
  read lists is left out of Watching (the Account draws a placeholder); End limit is drawn again on
  the $0 row the Account keeps for a day after an End limit; a knocking Gravit's seat box reads
  `knocking — admit it on the Account page` while Agents › Knocking offers Let in… for the same key
  (either admits it; name it **Gravit**); a connect sheet's refused reach and an unreachable key-file
  check draw no line, and an exchange account's own verdict is not looked up; a fill frame with no
  quantity draws a size-less `Bought ETH @ …` where the Account's toast draws nothing; a done or
  signing order sheet replaced by a Settings sheet comes back as a ready form for the same order
  (nothing signs without a press); a cold `#/trade/<id>` opens its ticket only once a read lists the
  market. In the engine: a store subscriber throwing at `sheetSigning` leaves the sheet `signing`
  until closed; a 401 on the sign-out's own exchange keeps the key and the role without re-reading
  the standing; `key-store.js` resolves on the request's success rather than the transaction's
  completion and opens a connection per call, never closed (the Account's own does the same); the
  ticket's venue read and the stream can price from different sources. In the proxy: no pin for
  stale-on-error on a stage-2 read (the shared path is pinned by the stage-1 reads). And `app.js` is
  978 lines — a split weighed at the final review.

---

## 10. Forward

In order; each with what "done" is and which charter row it reopens.

1. **Run the manual half of the order-approval drill.** *Closed 2026-10-24 by removal:* there is
   no Gate 1 to arm (charter D3 resolved); a person reading a seat write's card against the real
   service is the account-seat drill's (§7.4, item 17).
2. **Track the strategies.** Commit `strategies/市场情绪` (its thesis, journal and status; its
   `sentiment.py`, screen, backtest and `tests/strategies/` are scripts of the removed Python
   layer and no longer run), `storage-chain`, `Bloom-Energy营收预期分析` and the
   channel-name client fold. Done when `git log` is the audit trail it claims to be; this also
   turns ROADMAP item (1) into a built entry.
3. **Carry D11 into the charter.** *Done 2026-09-09* (plan 4 of the bots-and-rooms arc): the
   charter's D11 row names the decision that shipped — `composeFace` sets the `system-prompt`
   persona (`personaPrefix` since 0.2.0) from `dsh/profile/persona.md`, and a bot's preset
   shadows it for that bot's sessions — so R6 is closed on both sides. R3, R3a and R5 were
   already answered by the 2026-09-04 charter revision: §7 rules out loopback authentication and
   D10 carries the loopback fence, the forgeable answer and the MCP server's out-of-sandbox
   writes as an accepted debt with a revisit trigger. The admit path's automated test — R3a's
   positive twin, a test answerer on `approval/request`, the guard admitting, the order
   dispatching — landed 2026-09-30 (`order-gate-smoke`, §7.3); what was left of item 1 is the
   account-seat drill's now.
4. **Close the doc debts**: post-build blocks on the skeleton and channels specs (both still
   "pending user review"; the skeleton spec's Gate 2 paragraph describes a mechanism that never
   bound), and in `face/README.md` the "Gate-2 drill" heading, the dangling "§7.4" charter
   citation, and the stale line citations. (`dsh/README.md`'s steps 2 and 6 and its installed-state
   bullets were brought to the tree on 2026-09-30.)
5. **Daily cadence** via dsh `schedule` — deferred until a strategy is worth running daily;
   reopens D5 (spend metering) the day anything starts unattended.
6. **Paper forward-testing** — since 2026-10-24 every cycle's evidence (`dsh/profile/cycle.md`):
   a forward paper trade on the Account's paper venue through the seat, under both cards
   (`status: paper` while one runs). That reached the charter's D1 trigger ("before any strategy
   enters paper forward-testing") on 2026-10-24, by the operator's decision; D1's next trigger is
   the operator's to set (proposed, awaiting the operator: before a strategy's paper record is
   taken as grounds for a real venue, item 17). The independent evaluator (D1, D7) is still
   unbuilt.
7. **FINRA and float live endpoints, a second data vendor.** *Closed 2026-10-24:* they were the
   Python package's, and left with it; the Account's feeds and AKShare are the market.
8. **Distinct commit identity for Gravit** (D2) on the first confusion.
9. **Rooms** — built 2026-09-08/09 (plans 2–4); the live room drill passed 2026-09-09.
   Remaining from the spec's §11: nothing planned.
10. **A2A voices** — the charter's §7.1 admits an agent reached over A2A as a voice; no spec,
   nothing built; the day anything outside this machine can call in, the last row of the
   charter's §8 revisit table fires ("A second human, or any hosted deployment").
11. **A grant index for Gate 2.** Replace the guard's `snapshotEvents()` read — and the room
   engine's — with an index of `approval/asked` / `approval/decided` pairs fed by
   `ctx.on('session/event', …)`, the successor upstream names for the deprecated synchronous
   read. Done when both run on a Session without `snapshotEvents` (R21).
12. **`profileContext`, if ever** (PLAN D1): settings forms, a model save that persists, live
   reload. It means moving every face layer into `profileContext.overlays` and letting the first
   boot import and rename the shared `settings.yaml`. Nothing planned; taking it would close R28.
13. **Take the CLI's `runProfile` instead of mirroring it** (`@deepseek-ai/dsh/profile-boot`),
   the day upstream offers the seams the face's ten divergences need (§4.1) — above all an
   `appReady` the caller commits and no `profileContext`. Until then every pin bump re-diffs
   `boot.ts` by hand.
14. **Take the operator's home to 0.2.0**, by the go-live runbook
   (`docs/superpowers/runbooks/2026-09-30-dsh-0.2.0-rc.2-go-live.md`): stop every 0.1.1 CLI and
   face on it; back it up (a full restore is the only rollback, PLAN D12); dry-run a copy with
   `face/scripts/check-home.ts`, which boots the face on the copy and read-opens every session;
   add the D2 row; decide PLAN D11, D12, D13, D17 and D18; rehearse the drills §7.4 owes on a
   second copy; then boot on the home. Done when those drills pass on the real home.
15. **Take the redesign's owed measurements and drills**, on the real face, in one sitting: the
   first-request totals of §4.3 (plan 1's one-word session, the cycle's first request), one live
   run of its tool-schema table with AKShare and the seat together (`face/scripts/schema-sizes.ts`
   on a copy of the home; no prompt is sent) and the cycle drill (`face/README.md`; the real face,
   the real Account with a paper venue, and keys — a cycle's usage is real); the role drill once a
   role ships. Done when the "not yet measured" rows of §4.3, its live row and the manual **Cycle**
   row of §7.4 carry their date (and the session id where a session was involved). This is where
   the 24-round cap, a forward paper trade and the restart path (R30) first meet a model.
16. **The next round: persona, memory, the teaching channel.** Deferred by the operator on
   2026-10-15 (charter §9): the persona's mechanics paragraphs move to the tool descriptions,
   scoped sections and skills dsh provides; the style pack moves into a memory substrate the
   operator designs; the teaching channel is designed with it. The design spec's §13 lists what
   it inherits — the persona's size, the style pack under compaction, the rooms' unattributed
   answers, the schema block (R31) — and the persona's `subagent` paragraph (review the returned
   evidence and state its limits), which overlapped the reviewer role until that role retired on
   2026-10-24. Done when the operator has approved a spec for it; reopens
   charter §7.3 ("No memory substrate beyond what exists"), Rule 8 and P2.
17. **Real venues at the Account seat.** The seat sits at the Account's paper venues only, by the
   operator's rule and the limits they sign there (R34). Connecting a real venue to that Account with
   the seat granted reach, or signing it a limit on one, is the charter's real-money trigger (§8) and
   the venue-plugins handoff's agenda (§12.1, C1–C5 for real money): the next charter, before any such
   grant. One card per write (R32) and the tool block (R35) wait on the same round.

---

## Appendix A — Environment variable index

| Variable | Layer | Meaning |
|---|---|---|
| `FACE_ACCOUNT_SEAT_DIR`, `FACE_ACCOUNT_URL` | `account-seat.ts`, `seat.ts`, `account-proxy.ts` | the Account seat's checkout and the service the seat, the seat box and the proxy read (§4.6) |
| `DEEPSEEK_API_KEY` | dsh credential seam | the LLM and `web_search` |
| `DSH_HOME` | dsh, face | harness home |
| `DSH_PERMISSION_MODE` | dsh | sandbox preset; `danger-full-access` ⇒ approval policy `never` |
| `DSH_TELEMETRY_DISABLED` | face boot | any non-empty value disables telemetry; composed after the operator layers, it still wins over an operator's re-enable of the row the policy layer disables |
| `FACE_PORT`, `FACE_PROFILE` | face | port, profile name |
| `FACE_AKSHARE_MCP_COMMAND` | face (`akshare.ts`) | the AKShare MCP executable, default `~/.local/bin/akshare-mcp` |
| `FACE_IFIND_POLL_MS`, `IFIND_ACCESS_TOKEN`, `IFIND_REFRESH_TOKEN` | face (quote routes) | the A-share quote provider's refresh period and credentials |
| `FACE_SMOKE` | face tests | enables the eighteen real boots |
| `FASTMCP_LOG_LEVEL` | an MCP row (AKShare's server is FastMCP) | `WARNING` silences FastMCP's INFO noise |

The Python package's variables — the two APCA keys and `APCA_API_BASE_URL`, `ALPHA_DATA_SOURCE`,
`ALPHA_PIT_ROOT`, `ALPHA_DATA_FEED`, `ALPHA_DATA_COMPOSITE*`, `ALPHA_UNIVERSE_SCREEN`, the three
`ALPHA_*_USER_AGENT`, the order flag — and the producers' interpreter variable are read nowhere
since 2026-10-24; `agents.ts` keeps the two APCA names on its scrub list (§4.6).
