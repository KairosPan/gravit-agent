# Gravit — Product Charter

**Status:** living charter, written 2026-08-30; revised through 2026-09-09 for bots and rooms;
revised 2026-09-11 for bot settings, discussion evidence, journal context and temporary
subagents; §4, §5 and §7.3 pointers re-read 2026-09-30 for the dsh 0.2.0-rc.2 re-host; revised
2026-10-18..19 for the role library and the research cycle (§1, §3, §4, §5, §7.2, §8, §9; D13
now names `GRAVIT.md`; D16 added); revised 2026-10-21 for the desk's phone, the always-on
design's P1 (§1, §3, §4, §5 — the new D17, D18, D22, D23, D24 and D25 — §7.3, §8) ·
**Owner:** the operator ·
**Authority:** this charter carries intent and principles; mechanism lives in `DEVELOPMENT.md`,
`face/README.md` (the current face contracts and drills), and code. On a question of intent, the charter
wins; on a question of mechanism, the code is the fact and the documents follow it. The pointer
is one-way with one honest exception: §4 names gates and surfaces by their current shape so the
write map can be read alone, and those names are re-read against the mechanism references whenever
either changes. The 2026-09-04 revision exists because they had drifted.

**Scale discipline:** this charter stays readable in one sitting. If a section needs more than a
page, the content belongs in `DEVELOPMENT.md` or the docs, not here.

---

## 1. The product

Gravit is a market–strategy–account research workbench for **one operator, one machine, one
principal agent**. The agent, also called Gravit, runs on DeepSeek Harness (dsh) inside the
operator's chat face and works three layers. Gravit organizes work, checks returned evidence
and owns the research conclusion; the operator retains final judgment. Operator-authored bots
carry continuing research perspectives into rooms (§7.1). Temporary subagents perform bounded
delegated work (§7.2). The role library — three one-shot roles with their own persona and
tools — is the prebuilt form of that delegation (§7.2). One principal agent does not mean only
one execution context.

- **MARKET** — point-in-time US equities data (Alpaca bars and corporate actions, EDGAR
  filings, two offline PIT beds), guarded against lookahead in code. AKShare MCP adds
  public A-share queries for interactive research; those reads have no PIT guard.
- **STRATEGY** — Gravit's arena. A strategy is a directory under `strategies/`, meant to be
  git-versioned: a thesis with falsification terms, an executable screen, backtests, a journal,
  a lifecycle state. In the face, each strategy directory is a **channel**: its conversations,
  its landing page, its roster of helper agents. A channel with bots on its roster is a **room**:
  Gravit dispatches the voices, the operator argues with them, and the conclusion stays Gravit's.
  (As of 2026-09-04 only the template is committed; the three live strategies are untracked, so
  their ledger is not yet written — `DEVELOPMENT.md` §3.4.)
- **ACCOUNT** — an Alpaca paper account, read-only by default. Order capability exists in code
  behind two gates (§4); it has never been armed in the operator's real harness home.

**What a working day looks like.** The operator opens the face at `127.0.0.1:3090`, picks a
channel, and talks to Gravit. Gravit screens, backtests and reads the market through the
`alpaca_kit` tools, then writes thesis, journal and backtest artifacts into the strategy
directory. The operator reads the two read-only instruments (`/market`, `/account`), reads the
git diff, and teaches: trading style lives in an operator-owned skill pack; taste and judgment
arrive through conversation and review, not through machinery. One strategy has already been
carried from idea to a retirement verdict this way (2026-09-02, by its own pre-registered
falsification terms) — in the working tree; its directory has not yet been committed. Away from
the screen the operator has the desk: a private Telegram chat with Gravit on their phone, one
long-lived desk conversation that answers what they ask — the price now, the desk's own state —
and informs, never orders. The operator trades in their own broker app on what the desk tells
them.

**What it is not.** Not an automated trading system, not an autonomy ladder, not a hosted or
multi-user service. Nothing *starts* unattended. A research cycle the operator starts runs to
its verdict inside its strategy directory without further attention; the operator judges it
afterwards from the journal and the diff.

## 2. Founding principles

**P1 — Wide hands, no self-keys.** Gravit's action space is deliberately large: shell, code,
market tools, the whole strategy arena. Its authority over its own runtime is meant to be zero.
Where this is enforced by placement — the dsh profile patch and the order flag live in the
harness home, outside the agent's workspace, and no file effect or face route can write them —
placement holds. Where placement does not hold, the charter says so instead of pretending: the
credential files the documented run path sources sit at the repo root; the code of the second
order gate is inside the workspace; and the rest of the harness home (the face's own metadata,
the workspace registry) is writable from a shell turn over loopback, which can also register a
local CLI as a live tool (D10). Those are protected by review, tests, logs and the residual
ledger (§5), and they are named there.

**P2 — The operator is the only teacher.** The style pack (`style-gravit`) is operator-owned:
Gravit follows it by default, and when research findings conflict with a style entry, it
reports the conflict — never silently defers to style, never silently overrides it. Mechanics
skills are law, not style: findings never overrule them.

**P3 — Point-in-time honesty is enforced in code, not prose.** Every dated market read through
the two sanctioned `alpaca_kit` channels — `replay_days` for backtests, its MCP tools for interactive queries
— passes a lookahead guard in code; the library seam returns a RAW source by contract, and the
rule that backtests use the replay channel is the first backtest rule (P4). The guard surfaces
are pinned by name in meta-gate tests, so deleting one turns the suite red. A backtest that
cannot be honest must fail loudly rather than succeed approximately.

**P4 — Honest evaluation.** The five backtest rules (`docs/backtest-rules.md`) bind every
experiment: PIT channel only; a delisting during a hold is a terminal loss, never dropped;
returns are gross unless the strategy adds a cost model and declares it in its thesis; no
same-day round trip; missing data is discarded and counted, never fabricated. Evidence fidelity extends beyond backtests: every cited number states what
was actually measured, and vendor claims motivate but never carry load.

**P5 — The human is the steady state.** There is no autonomy ladder and no graduation
criteria. Operator attention is the scarcest resource in the system and its binding rate limit;
the design economizes it but never designs it away.

## 3. Architecture in one page

```
┌──────────────────────────────────────────────────────────────────┐
│ OPERATOR   teaches via skills · reviews via git · reads the two  │  outside the
│            instruments · owns ~/.dsh (profile patch, gate flag,  │  agent's reach
│            LLM and bot keys, the desk's pause); broker keys sit  │  (except the keys)
│            at the repo root (D8) · talks to the desk from the    │
│            phone · trades in their own broker app                │
├──────────────────────────────────────────────────────────────────┤
│ FACE       gravit-face, one Node process at 127.0.0.1:3090:      │  the operator's
│            hosts dsh in-process · chat per channel · /market ·   │  surface; also
│            /account · the per-order approval card (Gate 2)       │  where Gate 2 lives
│            bot settings · room comparisons · child task history  │
│            the desk: one desk session, its ledger and pause, the │
│            Telegram bridge (polls outbound; nothing listens)     │
├──────────────────────────────────────────────────────────────────┤
│ GRAVIT     dsh runtime · skills (mechanics + style) ·            │  the agent
│            works strategies/ ·                                   │
│            runs research cycles under a goal ·                   │
│            queries via MCP tools · consults room bots ·          │
│            delegates to the role library and to bounded          │
│            child tasks · may call rostered local CLIs as tools · │
│            on the desk (gravit-desk): informs, never orders; no  │
│            shell, no order tools; writes only desk/journal/,     │
│            reads only inside the repository                      │
├──────────────────────────────────────────────────────────────────┤
│ alpaca_kit one Python package, two faces: importable lib         │  the workbench
│            (backtests) + MCP server (interactive queries) ·      │  (this repo)
│            shared PIT guards · Gate 1 (registration)             │
├────────────────────────────────┬─────────────────────────────────┤
│ MARKET                         │ ACCOUNT                         │
│ Alpaca REST · EDGAR ·          │ Alpaca paper: account /         │
│ offline PIT beds               │ positions / orders queries      │
│                                │ (order tools double-gated)      │
└────────────────────────────────┴─────────────────────────────────┘
```

The desk is the face's always-on side: one desk session — the `gravit-desk` preset, its cwd
`desk/journal/` — that the operator's phone reaches through a private Telegram chat. The face
polls Telegram; nothing on this machine listens for the outside (§7.3). The face presents saved
bot settings, actual session configuration, room evidence and child task progress. dsh owns
execution, permissions and session history; the face adds no second task registry or execution
queue. Mechanism lives in `DEVELOPMENT.md`, `face/README.md` and code. This charter does not
restate tool tables, route tables, or bed windows.

## 4. The write map

Who may change what. This table is the charter's core; everything else supports it.

| Surface | Writer | Audit / gate |
|---|---|---|
| `strategies/` | **Gravit**, including the role children and bounded tasks it delegates to under inherited permissions | git history is the ledger; Gravit checks delegated results and the operator reviews diffs |
| `alpaca_kit/`, `face/`, `scripts/`, tests | normal engineering (operator and coding agents, reviewed) | offline suites, meta-gates, and the drills — this tier includes the code of both order gates |
| `dsh/skills/mechanics/` | operator only | law, not style: backtest rules and tool mechanics; Gravit treats them as binding |
| `dsh/skills/style-gravit/` | operator only | Gravit proposes changes in its journal or in conversation; it never edits the pack |
| `$DSH_HOME`: the profile patch, the order flag, keys, sessions | operator (the patch file); the face rewrites `cordis.yml` and its own metadata files | outside the workspace: no file effect can reach it; reachable over loopback from a shell turn (D10) |
| `$DSH_HOME/face/desk/`: the desk's ledger, its pause switch `OFF`, the Telegram bridge's records, offset and outbox | the face — `desk.ts` and the bridge; the operator sets the pause from the phone, the Desk panel or a terminal, and lifts it only from a terminal | outside the workspace, as the rest of the home; the phone and the page can only pause (D17); every pause and lift, desk conversation, desk turn — with its tokens — and refused turn is a ledger line |
| `desk/journal/` | **Gravit**, in the desk session (the `gravit-desk` preset, its cwd, `workspace-write`) | ignored by git (D22), so no history records it; the sandbox keeps the desk's writes in its cwd and the temp areas; the face's desk guard and pre-turn fence keep instruction files out of it (D23) |
| a channel's agent roster | operator, through the face | every write appends a dated line to `roster.log`; a menu, not a fence (D9) |
| Bot definitions: `preset.yml`, `SOUL.md`, composition and skills under `bots/` | operator, through the face's supported settings or file edits; Gravit and temporary subagents may propose changes, never author them | git and review; settings saves check revisions, and inspection distinguishes saved settings from mounted configuration (D13) |
| `bots/<id>/journal/notes.md` | operator; the bot in its own home session, subject to that session's permissions | home work is scoped to its own `journal/`; room sessions start read-only (D12). Context loading only reads notes and records the consumed snapshot; it never writes them |
| Role definitions: `roles/<id>/` (`ROLE.md`, `role.yml`), and the mirror `bots/gravit/agent.cordis.yml` generated from them | operator, by file edit; Gravit proposes a role in conversation and never authors one | git and review; the face refuses a malformed role at boot, a drift test fails while the mirror differs from the render, and the reader keeps the account and order tools, `ask_user_question` and the AKShare tools out of every role's `allow` |
| `dsh/profile/cycle.md`, `dsh/profile/desk.md` | operator only | the research-cycle contract and the desk's contract Gravit runs; Gravit proposes changes in conversation and never edits them; git |
| `data/pit/` beds | nobody — read-only captured artifacts | a `CHECKSUMS` manifest on the 2yr bed (the broad bed predates the manifest and carries none), checked by hand; recapture is the only legitimate write |
| paper orders | nobody today | **Gate 1** (registration; enforced, test-pinned): the order tools exist in a session only when the operator's flag AND broker keys are both present. **Gate 2** (per-order approval; built 2026-09-04, in the face): every call to an order tool stops for a card the operator must answer (under a `never` policy, or with no session to ask in, it is denied outright rather than asked), and a guard admits the call only on a logged one-shot approval for that exact call and tool. Its automated drill passed and is mutation-proven for the refusing half (the card is raised, the read-only listing is not gated, an unapproved order does not dispatch); the admitting half — a real logged grant letting an approved order through the live pipeline — is automated too (2026-09-30), over the browser's own answer channel as well; its human half — a person reading the card against armed tools in a scratch home — has not been run (D3). It binds only when dsh runs inside the face (D8) |

Three honesty notes the table depends on. First, both order gates hold the MCP tool *surface*,
not the account: the library's order function carries no flag, the broker key file is readable
from the workspace, and a shell turn could import the client directly — the paper-hostname pin
bounds what that can do, and D8 carries the rest. Second, Gate 2 is a gate, not containment: it
stops the model's ordinary tool calls; a wrapper on dsh's execute seam or an unrestricted shell
walks around it, and the same shell can answer its own card over loopback — the answer route's
browser cookie is signed by a secret stored in the harness home, which a shell turn can read —
leaving a genuine one-shot approval in the log, so the guard proves that a
grant was recorded, not who recorded it (D10; Rule 2 applied honestly). Third, the workspace
boundary protects the runtime,
not the repo: `alpaca_kit`, the face, the mechanics skills and Gate 2's own code are inside the
workspace and are protected by review and tests, not by placement — and the service starts the
face on whatever code is there, unattended after a crash (D24).

## 5. Debts, carried openly

Known gaps, each with why it is acceptable now and when it falls due. Pretending these are
solved would be worse than carrying them.

| # | Debt | Acceptable now because | Due when |
|---|---|---|---|
| D1 | The measured party writes its own measurements: Gravit produces its own `backtests/` and `journal.md` | operator reviews diffs; the rules skill binds method | before any strategy enters paper forward-testing |
| D2 | Agent commits and operator commits are indistinguishable in git | single operator, low volume | cheap fix (distinct commit identity for Gravit) on first confusion |
| D3 | Gate 2's human half is undrilled: no person has yet read the order card against armed tools | orders are unregistered by default; the automated half is drilled | before `ALPACA_KIT_ENABLE_ORDERS` ever flips in the real harness home |
| D4 | Mechanics skills are prose-protected only | single user; every edit reviewed | if skills ever get a second writer, including Gravit |
| D5 | Per-session LLM usage is visible, but there is no combined accounting across Gravit, room members and temporary descendants, nor complete LLM + data API spend accounting | operator reviews usage and provider bills | first surprise bill, or any scheduled autonomous runs, or the first cycle whose usage surprises the operator |
| D6 | The mechanics red-lines have no drill; no test reads the content of the skill packs | single user; every edit reviewed | carried rule: a new guard ships with its drill in the same change |
| D7 | No instrument for net-negative drift: nothing compares "now" against "never-evolved" | strategies are few; the operator still reads everything | when an independent evaluator exists (see D1) |
| D8 | Both order gates are prose against a shell: they hold the tool surface, the key file sits at the repo root, and Gate 2 exists only inside the face | paper account; hostname pin; the flag has never been armed | real-money intent, or any host other than the face running the profile with the flag set |
| D9 | The channel roster is a menu, not a fence: tool schemas are tree-wide, a session in no channel is never roster-checked, and a shell turn can call a CLI directly | it reduces noise and states intent; writes are logged | if a rostered agent ever gets a capability the operator would not grant every channel |
| D10 | The harness home and the face's own routes are reachable over loopback from inside the workspace — a fence, not authentication — and so is the approval-answer route, whose browser cookie (dsh 0.2) is signed by a secret in the harness home, so a shell turn can approve its own order card; and the MCP server, a child of the face process, writes outside the sandbox | one operator, one machine; the writes are small and visible; the paper pin bounds an answered card | a second human, a hosted deployment, real-money intent, or the first unexplained change to `$DSH_HOME/face/*` |
| D11 | *Resolved 2026-09-07.* The model is told it is Gravit: `dsh/profile/persona.md` is the `system-prompt` row's `personaPrefix`, set by the face at compose time; a bot's preset shadows it for that bot's sessions | — | — |
| D12 | Bot tool masks are visibility, not authority. dsh scopes and `tools.restrict` are "live visibility composition, not an authority boundary"; a bot with a shell writes whatever its session's sandbox mode allows and reaches whatever the network allows | held by: the `read-only` permission preset logged into every bot room session inside its creation (file effects, subject to an operator-granted escalation card), the `journal/`-scoped `cwd` of every bot home session, Gate 2 tree-wide (the account), and the room transcript naming every dispatch and every member not called. Not held by the mask, and not held for the network | if a bot's composition is ever given the account tools, or a room session is created other than read-only (§8) |
| D13 | Gravit's sessions and delegated tasks can work at the repository root, which includes `bots/`; their prohibition on editing bot files, including journals, is carried by `GRAVIT.md` and review, not by the sandbox | single operator; every edit reviewed; git is the ledger; a bot's own home-journal writes follow §4 | the first unauthorized edit under `bots/` |
| D14 | Structured room evidence, child-task results and role reports have no independent verification or result-acceptance mechanism; passing runtime drills does not establish better research | originals, request snapshots and task histories remain reviewable; Gravit checks results and the operator judges them | before claiming a research-quality gain or reducing review on the strength of these features |
| D15 | Bot journal context is a bounded read of historical notes; freshness, conflicts and note selection still depend on manual maintenance | each request records what it consumed and exposes missing or truncated notes | when stale, conflicting or omitted notes materially affect a conclusion |
| D16 | The per-cycle role-call cap (12) is a count Gravit keeps in the journal, not a threshold the harness enforces (Rule 1) | the round cap is enforced by the goal (the 24 is Gravit's argument to create_goal, as cycle.md instructs; dsh's own default is 256), every call is in the child history, and the operator reads the journal | the first overrun |
| D17 | The desk's pause switch is a hand-editable file in the harness home (`OFF`), and the Desk panel's Pause route is loopback-reachable like every `/data` route (D10) | the safe direction: the phone and the page can only pause, never resume or shorten a pause in force; only a terminal, the file's deletion or the pause's own expiry lifts one; every set and lift through the face or `npm run desk` is a ledger line (a hand edit is not) | a route or a phone command that resumes the desk, arms anything, or writes more than the pause |
| D18 | The Telegram token is a key file like the others (R1): whoever holds it can read what the operator sends — through `getUpdates`, or a webhook it sets — which the bridge sees only as a 409 conflict, and can message the operator as the bot. The bridge admits by the operator's user id, so a lost or compromised phone that is still signed in can chat with the desk — have it read inside the repository, write in its journal and spend tokens — and pause it | one allow-listed numeric user id in a private chat; every other sender dropped, counted and shown; outbound only, every message to the operator's chat with every secret value redacted; the desk orders nothing, and its guard keeps its reads inside the repository and off key files (D25); the phone can only pause | a lost phone: end its session from another device (Telegram → Settings → Devices), or unset `TELEGRAM_OPERATOR_ID` until then — rotating the token does not stop a device that is still signed in; rotate it when the token itself leaked. A second Telegram user or any group (§8) |
| D22 | The book — `desk/holdings.yml`, every `levels.yml`, the desk's journal — lives on this disk in files git ignores; the repository is public, so a `git add -A` by habit or a file tracked by mistake publishes it | the ignore rules, review, and — as the files arrive — a tracked `.example` sibling for each | the repository goes private, or the book moves into git (§8) |
| D23 | The desk's writable cwd sits on dsh's instruction chain: an instruction file (`GRAVIT.md`, `GRAVIT.local.md`), a `.git` or a skill root (`.dsh`, `.agents`) in `desk/journal/` — which the desk's sandbox lets it write and git ignores — or in `desk/` above it would steer every later desk turn. So would files other tools obey there: a `.gitignore` holding `!*` would have git list the journal for the next `git add -A` (D22), and a `CLAUDE.md` or `AGENTS.md` would reach the operator's coding agents, which load it from that folder and have a shell. The face holds this, not the sandbox | the desk guard — one listener and a deny-only backstop over every call a desk agent makes, its write check first — denies a desk turn's write of such a name, of any dot-file and of any `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` or `AGENTS.override.md` before it runs, and the pre-turn fence refuses every desk turn while one exists there, a `.dsh` or `.agents` sits at the repository root, or a symlink sits in the fenced tree — both code, drilled on a real tree, the fence failing closed. The desk has no shell: an unattended turn on untrusted text must not read key files and reach the network. Not held: the root `GRAVIT.local.md`, the operator's overlay, which every desk turn reads and a root workbench session can write (`DEVELOPMENT.md` §9, R33) | the desk given a shell, a job tool or a write outside its journal; the first fence refusal nobody can explain |
| D24 | The face runs from a tree its agent sessions can write: an edit to `face/` or `scripts/` from a workbench session takes effect at the face's next start, which launchd makes unattended after a crash | single operator; every edit reviewed in the diff; the desk session cannot write there without an approved card | the first unexplained change under `face/` or `scripts/`; anything that runs workspace code on a schedule without a pin |
| D25 | The desk reads what it is asked to, and what it reads goes to DeepSeek in the tool result. The sandbox lets every read through, so the face's desk guard holds the read side: its read check denies a read outside the repository (where the volume says the path lands) or of any dot-file in it — a `.env` or `.git` name, `.mcp.json`, `.claude/`, `.codex/` — and a search that could reach a dot-file; its secret check denies any call whose arguments carry the value of a key in the face's environment, as it is, JSON-escaped or URL-encoded, but not a lower-case `%3a`, base64 or a value split across arguments, so the read check is the line; the bridge redacts every such value from the phone. Not held: a key kept in a file whose name says nothing and starts with no dot, or returned by an MCP tool, still reaches DeepSeek in a tool result, which the face does not filter yet; a hard link, or a symlink swapped between the check and the open, is not seen | single operator; the keys live in `.env` files, dot-files and the harness home, which the read check refuses or keeps outside; the desk cannot make a link (no shell, its writes kept to its journal and the temp areas); the canary drills the read and the secret on a real tree (`DEVELOPMENT.md` §9, R34) | a key kept in the repository in a file whose name starts with no dot; the first secret seen in a desk turn's tool result or on the phone. The filter is a follow-up, not missing infrastructure: dsh-tools' `tools/post-execute` seam can already redact the face's secret values from a desk agent's tool results (`DEVELOPMENT.md` §10, item 5) |

## 6. Rules carried forward

Standalone rules this design treats as settled. They are stated without their histories; each
was expensive.

1. **Recording is not governing.** A reported number governs nothing until something
   thresholds it. A measurement plane the measured code can write is not a measurement plane.
2. **Enforce below the layer that runs arbitrary code** — or admit the gate is prose. A
   tool-wrapper guard that a shell command can walk around is documentation, not enforcement.
3. **Containment beats claimed secrecy.** State what actually holds and record the residuals;
   never ship a guarantee that fails at code level.
4. **A guard that has never been drilled is presumed broken.**
5. **What is never surfaced is never governed.** Anything filtered away silently — dropped
   candidates, discarded days, skipped checks — gets counted and shown.
6. **Codification always reads as an efficiency win** and hides what it removes. Prefer prose
   and conversation until code has earned its place with evidence.
7. **A self-extending library without lifecycle machinery is noise.** If Gravit ever authors
   reusable skills, lifecycle states and retirement come first, not later.
8. **Substrate decisions taken before there is content are taken blind.** Choose stores and
   schemas when real data demands them, never in anticipation.

## 7. Collaboration and design limits

### 7.1 Persistent bots and rooms

**The operator authors the perspective.** A bot is a named dsh preset with its own persona,
tool visibility, skills and journal. The face supports editing name, description, default model
and SOUL together, with an optional guide for perspective, evidence standards and conditions
for revising a view. These are operator choices; Gravit may propose a bot, never create or
rewrite one. Tool masks remain visibility, not authority (D12).

**Saved settings, mounted configuration and request facts are distinct.** Saving settings does
not replace the persona of a running session. A new test conversation uses saved settings;
seeding a bot's initial model does not change the host default. Inspection distinguishes the
live configuration preview from the last actual request and does not activate cold sessions.
A resume after host restart can mount current settings, so the saved revision alone cannot
prove what a historical request used.

**A journal supplies historical material.** Before each home or room request, a bot reads only
its own `journal/notes.md` through the journal-context hook. That bot's notes can inform its
work across rooms; they are separate from SOUL, carry no instruction authority and require
checking against current evidence. The next request sees edited notes. The consumed snapshot
and revision are recorded, with missing, unavailable or truncated context made visible. This
hook neither maintains notes nor retrieves other channels' conversations (D15).

**A room makes views comparable.** Gravit's dispatch brief can state the question, context,
evidence requirements, falsification terms and expected output. A fresh question starts with
independent parallel views; serial follow-ups can examine views already seen. Answers expose
position, evidence, uncertainty, conditions for changing the view and declared disagreements.
The original answer survives, including answers that cannot be parsed into that structure.
Evidence fields remain the speaker's claims. Initial parallel answers have not seen one
another; an empty disagreement list does not establish consensus. Gravit distinguishes factual,
interpretive and risk-preference disagreements before concluding and naming the next check.

Dispatch grants no permissions; room members start read-only and account tools meet the same
tree-wide gate. The operator's `@` reaches rostered voices directly. A bot's view is evidence
to weigh, with no adjudicative authority. Shared models can still converge, and runtime drills
do not establish the quality of the resulting research (D14).

### 7.2 Temporary delegated tasks

A subagent is a bounded piece of work attached to a parent conversation, such as checking
sources, reproducing a calculation or reviewing an implementation. Its brief identifies the
question, relevant context, expected result and scope; shared-directory work needs clear
write scopes. Creation adds a child conversation with durable history, not a bot definition,
room-roster entry or journal. dsh controls inherited sandbox scope and parent ownership;
the pinned runtime refuses approval-dependent operations in children. The face grants no
additional access and delegation adds no independent authority.

The native runtime supports continuable background children and one-shot work. A background
child can report progress; the runtime separately sends a settlement notice and any final
answer. Gravit continues independent work or ends its turn to await that notice, then checks
the result against the brief. A report, an ended turn and an accepted result are different
facts. In particular, `inactive` describes activity, not success or completion (D14).

The face exposes child history, recent output, continuation and interruption through dsh's
native controls. Reading history activates neither parent nor child. Continuation requires
the direct parent to be live; after a restart the current UI asks the operator to send in the
parent first. One-shot tasks remain read-only history. Interruption targets the current turn,
preserves unclaimed queued messages and descendants, and does not cancel the whole tree; a
later send can resume parked work. dsh owns this lifecycle, including recovery.

The role library is the prebuilt form of a delegated task: a role is an operator-authored
persona plus an exact tool allow-list (`roles/<id>/`) the dsh backend enforces at the child's
creation (a role with bash keeps the shell's reach — D12), surfaced to Gravit as a one-shot
tool. It is never a bot (no roster, no journal, no room) and never a bot's substitute: a role
has hands and no voice, a bot a voice and no hands. A role's report is a claim Gravit checks
(D14).

### 7.3 What this design deliberately does not build

- **No privileged second agent.** Teaching and final adjudication belong to the operator;
  Gravit remains responsible for the research conclusion across consulted voices and delegated
  work. Local CLIs remain callable tools. A remote voice, if reached over A2A, would contribute
  untrusted text, not authority in this tree; inbound access from outside this machine reopens
  §8. Delegation does not introduce an independent evaluator (D1, D14).
- **No proposal queue.** Change lands by editing; git is the ledger and the rollback. A
  deliberation pipeline is bureaucracy at this scale.
- **No bespoke harness.** dsh owns the runtime — sessions, tools, sandboxing, subagents, and
  the approval channel. The face hosts it in-process and registers the order producer and the
  desk's guard on dsh's published `tools/pre-execute` seam; that is configuration in code
  on a pinned version, not a fork, and the two pins make the dependence explicit. We do not fork
  it or wrap its loop.
- **No hosted face.** Loopback only, one machine, no authentication machinery of the face's own
  on the local surfaces — dsh 0.2's browser cookie on `/api` is dsh's (see D10 for what that
  costs).
- **No inbound.** The Telegram bridge polls; nothing on this machine listens for the outside; the
  browser card remains the only approval surface.
- **No multi-tenant, cryptographic, or kernel-level machinery.** One operator, one machine.
  The risks are named here in one line each instead of being built against: a hosted or
  multi-user deployment invalidates this charter rather than extending it.
- **No memory substrate beyond what exists.** Git, strategy artifacts, bot journals and dsh's
  own session histories are the memory. A dedicated store is chosen when content demands one.

## 8. Revisit triggers

Few and concrete. Each names the section it reopens.

| Trigger | Reopens |
|---|---|
| Arming `ALPACA_KIT_ENABLE_ORDERS` in the real harness home | D3 first (run the human half of the order drill in a scratch home) · D8 |
| Real-money intent (any non-paper order path) | §4 both gates · D1 · D3 · D8 · broker-key rotation |
| Running the profile in any host other than the face | D8 (Gate 2 is absent there) |
| Gravit begins authoring reusable skills | Rule 7 → lifecycle machinery · D4 |
| An independent evaluator is introduced | D1 · D7 (the measurement plane) |
| dsh leaves developer preview or ships a breaking change | the two pins · profile and skills format · the drills |
| A bot's composition is given the account tools, a bot room session is created other than read-only, or a bot home session's cwd widens past its `journal/` | §7.1 · D8 · D12 · run the order drill under that bot's preset |
| A role is given a bot's tools, the account tools, or ask_user_question | §7.2 · D12 · run the order drill with that role's child |
| Claiming better research or reducing review because rooms or delegation are available | D1 · D14 · real-task comparison and explicit result acceptance |
| Stale, conflicting or truncated journal notes affect a conclusion | §7.1 · D15 · maintenance and retrieval requirements before choosing a new memory store |
| Expanding the interface migration in §9 | §3 (the FACE row) · §7.3 "No bespoke harness" and "No hosted face" · the two pins · the row and RPC inventory against the CLI's |
| A second Telegram user id, or any group, on the desk's bridge | this charter is the wrong document; write the next one · D18 |
| Any order, approval or trade-proposal path from the phone or from a scheduled turn | §4 both gates · D3 · D8 · D10 |
| The desk's preset given a shell, a job tool, an account write tool, a role, or the browser watchlist's write path | §7.2 · D8 · D12 · D23 · D25 · run the order drill under that preset |
| A secret seen in a desk turn's tool result or on the phone, or a key kept in the repository in a file whose name starts with no dot | D25 · the post-execute redaction of what a desk tool returns, which dsh's `tools/post-execute` seam already allows |
| The repository going private, or the book moving into git | D22 · the desk's directory layout |
| A second human, or any hosted deployment | this charter is the wrong document; write the next one |

## 9. Forward

The bot settings, structured room discussion, journal context and native child-task surfaces
are implemented as of 2026-09-10. Their runtime and UI behavior has been checked with automated
drills and browser exercises; controlled model stubs do not establish research quality.
Remaining directions below are not completed capabilities. Further design remains subject to
§6 and §7.

- **The face absorbs dsh's operator surface; dsh's own frontends are retired** (set
  2026-09-08). Every interface dsh offers the operator today — the `dsh` command's terminal UI
  and `dsh web` — moves onto the face, and those frontends stop being used for this workbench.
  dsh stays the runtime, hosted in-process, exactly as §7.3 "No bespoke harness" says; what
  changes is that the face becomes the only client of dsh's gateway the operator ever opens.
  Recorded so the spec starts from the tree, not from the idea: the face's composition must
  account for every row the operator gets from the CLI's tree (the earlier missing projection
  cache showed why this inventory matters; the face now mounts it); every gateway RPC the
  retired frontends used needs a home in the face's client or a recorded reason it has none;
  the two-pin upgrade path stays; D10 and the roster-as-menu residuals are unchanged by the
  move. Open for the spec: whether the face keeps sharing `$DSH_HOME` with the dsh the operator
  runs in other projects, or gets a home of its own. Bot inspection and native child-task
  controls are implemented parts of this direction; complete frontend replacement and the
  shared-home decision remain open.
- **Evaluate real research and make acceptance explicit** (D14, D16). Compare representative
  research tasks for evidence accuracy, useful disagreement, revision of conclusions, operator
  effort, elapsed time and usage. Develop traceability from claims to source material and from
  delegated results to expected artifacts, checks and unresolved limits. Current comparison
  cards and task histories make review possible; they do not perform these checks themselves.
- **Maintain notes and account for the whole task** (D5, D15). Design operator-reviewed journal
  updates with sources and conflict handling, and combined usage across parent, room members
  and descendants. The current journal hook only reads, and current usage remains per session.
- **The next round: persona, memory, the teaching channel.** The persona's mechanics paragraphs
  move to the tool descriptions, scoped sections and skills dsh provides; the style pack moves
  into a memory substrate the operator designs; the teaching channel is designed with it.
  Deferred by the operator on 2026-10-15.
