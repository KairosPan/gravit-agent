# Gravit — Product Charter

**Status:** living charter, written 2026-08-30; revised through 2026-09-09 for bots and rooms;
revised 2026-09-11 for bot settings, discussion evidence, journal context and temporary
subagents; §4, §5 and §7.3 pointers re-read 2026-09-30 for the dsh 0.2.0-rc.2 re-host; revised
2026-10-18..19 for the role library and the research cycle (§1, §3, §4, §5, §7.2, §8, §9; D13
now names `GRAVIT.md`; D16 added); revised 2026-10-24 for the face's page as an owner device
of the Account (§1, §3, §4, §5, §7.3, §8, §9; D18 added), and again 2026-10-24 for the exit of
the Python package, the PIT beds and backtests (§1, §2, §3, §4, §5 — D3 and D16 resolved, D1, D8
and D10 rewritten — §6, §7.2, §8, §9) ·
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
operator's chat face and works three layers. Gravit organizes work, checks returned evidence and
owns the research conclusion; the operator retains final judgment. Operator-authored bots carry
continuing research perspectives into rooms (§7.1). Temporary subagents perform bounded
delegated work (§7.2). The role library — one-shot roles with their own persona and tools, none
shipped since 2026-10-24 — is the prebuilt form of that delegation (§7.2). One principal agent
does not mean only one execution context.

- **MARKET** — the Account's markets through Gravit's seat — crypto, US stocks, RWAs,
  perpetuals, predictions, read keyless and server-side by the Account — and AKShare for A
  shares; no beds, no replay and no lookahead firewall since 2026-10-24, by the operator's
  decision: the Account's history is read as it is, and a strategy's evidence is forward paper
  trading on the Account's paper venue.
- **STRATEGY** — Gravit's arena. A strategy is a directory under `strategies/`, meant to be
  git-versioned: a thesis with falsification terms, a journal of its evidence (forward paper
  trades among it), a lifecycle state. In the face, each strategy directory is a **channel**:
  its conversations, its landing page, its roster of helper agents. A channel with bots on its
  roster is a **room**: Gravit dispatches the voices, the operator argues with them, and the
  conclusion stays Gravit's. (As of 2026-09-04 only the template is committed; the three live
  strategies are untracked, so their ledger is not yet written — `DEVELOPMENT.md` §3.4.)
- **ACCOUNT** — since 2026-10-20 a seat at the operator's Account — Linqi's buyer-agent-demo, an
  external program on this machine — through one MCP row, on its paper venues only: every seat
  write passes Gate 2 here and the Account's own card there (D17). Since 2026-10-24 the Account
  is also what the face's Markets and Account screens show — read through a loopback proxy — and
  the face's page is one of the Account's owner devices: the operator trades there by hand, each
  order signed with the browser's device key at the Account's door, under the Account's own cap
  (D18). The Account is the account: the operator's own Alpaca paper account, when wanted, is
  one of its venues.

**What a working day looks like.** The operator opens the face at `127.0.0.1:3090`, picks a
channel, and talks to Gravit. Gravit reads the market through its Account seat and AKShare,
trades on the Account's paper venue under both cards, and writes thesis and journal into the
strategy directory. The operator reads the face's Markets, Trade and Account screens, reads the
git diff, and teaches: trading style lives in an operator-owned skill pack; taste and judgment
arrive through conversation and review, not through machinery. One strategy was carried from
idea to a retirement verdict on 2026-09-02, by its own pre-registered falsification terms and
the backtests of the time — in the working tree; its directory has not been committed.

**What it is not.** Not an automated trading system, not an autonomy ladder, not a hosted or
multi-user service. Nothing *starts* unattended. A research cycle the operator starts runs to
its verdict inside its strategy directory without further attention; the operator judges it
afterwards from the journal and the diff.

## 2. Founding principles

**P1 — Wide hands, no self-keys.** Gravit's action space is deliberately large: shell, code,
market tools, the whole strategy arena. Its authority over its own runtime is meant to be zero.
Where this is enforced by placement — the dsh profile patch lives in the harness home, outside
the agent's workspace, and no file effect or face route can write it — placement holds. Where
placement does not hold, the charter says so instead of pretending: the credential file the
documented run path sources sits at the repo root; the code of the order gate is inside the
workspace; the seat's key file in the Account's home is readable from a shell turn (D17); and
the rest of the harness home (the face's own metadata,
the workspace registry) is writable from a shell turn over loopback, which can also register a
local CLI as a live tool (D10). Those are protected by review, tests, logs and the residual
ledger (§5), and they are named there.

**P2 — The operator is the only teacher.** The style pack (`style-gravit`) is operator-owned:
Gravit follows it by default, and when research findings conflict with a style entry, it
reports the conflict — never silently defers to style, never silently overrides it. Mechanics
skills are law, not style: findings never overrule them.

**P3 — Point-in-time honesty comes from forward time.** Nothing in code guards against
lookahead since 2026-10-24: the PIT beds, the replay channel and its guard left the tree by the
operator's decision, and the Account's history is read as it is. A strategy's evidence is a
forward paper trade on the Account's paper venue — placed after the thesis and its
falsification terms are written, its fills and statement recorded by the Account as time
passes — so the evidence cannot have seen its own future; a number read from the Account's
history is today's reading of the past and is cited as that. A result that cannot be honest
must fail loudly rather than succeed approximately.

**P4 — Honest evaluation.** The five backtest rules left with the beds (§6). Evidence fidelity
stands: every cited number states what was actually measured — for a paper trade, the Account's
own figures as returned, with the order ids — missing data is counted, never fabricated, and
vendor claims motivate but never carry load.

**P5 — The human is the steady state.** There is no autonomy ladder and no graduation
criteria. Operator attention is the scarcest resource in the system and its binding rate limit;
the design economizes it but never designs it away.

## 3. Architecture in one page

```
┌──────────────────────────────────────────────────────────────────┐
│ OPERATOR   teaches via skills · reviews via git · reads the      │  outside the
│            face's screens · owns ~/.dsh (profile patch, LLM      │  agent's reach
│            key) and the Account's grants and cap (D17, D18)      │  (except key files)
├──────────────────────────────────────────────────────────────────┤
│ FACE       gravit-face, one Node process at 127.0.0.1:3090:      │  the operator's
│            hosts dsh in-process · chat per channel · Markets ·   │  surface; also
│            Trade · Account · the per-order approval card         │  where Gate 2 lives
│            (Gate 2) · bot settings · room comparisons ·          │
│            child task history                                    │
├──────────────────────────────────────────────────────────────────┤
│ GRAVIT     dsh runtime · skills (mechanics + style) ·            │  the agent
│            works strategies/ ·                                   │
│            runs research cycles under a goal ·                   │
│            queries via MCP tools · consults room bots ·          │
│            delegates bounded child tasks (and roles, when        │
│            one ships) · may call rostered local CLIs as tools    │
├──────────────────────────────────────────────────────────────────┤
│ MCP ROWS   composed by the face: the Account seat                │  the workbench
│            (mcp__account__*) · AKShare (A shares) ·              │  (this repo)
│            no lookahead guard on either                          │
├────────────────────────────────┬─────────────────────────────────┤
│ MARKET                         │ ACCOUNT                         │
│ the Account's markets: crypto, │ the Account: an external        │
│ US stocks, RWAs, perpetuals,   │ program's venues, read by the   │
│ predictions — keyless, read    │ face, traded by hand from it;   │
│ server-side by the Account ·   │ Gravit's seat there, carded,    │
│ AKShare: public A shares       │ on paper venues only            │
└────────────────────────────────┴─────────────────────────────────┘
```

The face presents saved bot settings, actual session configuration, room evidence and child
task progress. dsh owns execution, permissions and session history; the face adds no second
task registry or execution queue. Mechanism lives in `DEVELOPMENT.md`, `face/README.md` and
code. This charter does not restate tool tables or route tables.

## 4. The write map

Who may change what. This table is the charter's core; everything else supports it.

| Surface | Writer | Audit / gate |
|---|---|---|
| `strategies/` | **Gravit**, including any role children and the bounded tasks it delegates to under inherited permissions | git history is the ledger; Gravit checks delegated results and the operator reviews diffs |
| `face/` and its tests | normal engineering (operator and coding agents, reviewed) | the offline suite, the gated smokes and the drills — this tier includes the code of the order gate |
| `dsh/skills/mechanics/` | operator only | law, not style: tool mechanics (today the Account seat's guide); Gravit treats them as binding |
| `dsh/skills/style-gravit/` | operator only | Gravit proposes changes in its journal or in conversation; it never edits the pack |
| `$DSH_HOME`: the profile patch, keys, sessions | operator (the patch file); the face rewrites `cordis.yml` and its own metadata files | outside the workspace: no file effect can reach it; reachable over loopback from a shell turn (D10) |
| a channel's agent roster | operator, through the face | every write appends a dated line to `roster.log`; a menu, not a fence (D9) |
| Bot definitions: `preset.yml`, `SOUL.md`, composition and skills under `bots/` | operator, through the face's supported settings or file edits; Gravit and temporary subagents may propose changes, never author them | git and review; settings saves check revisions, and inspection distinguishes saved settings from mounted configuration (D13) |
| `bots/<id>/journal/notes.md` | operator; the bot in its own home session, subject to that session's permissions | home work is scoped to its own `journal/`; room sessions start read-only (D12). Context loading only reads notes and records the consumed snapshot; it never writes them |
| Role definitions: `roles/<id>/` (`ROLE.md`, `role.yml`), and the mirror `bots/gravit/agent.cordis.yml` generated from them | operator, by file edit; Gravit proposes a role in conversation and never authors one | git and review; the face refuses a malformed role at boot, a drift test fails while the mirror differs from the render, and the reader keeps the account and order tools, `ask_user_question` and the AKShare tools out of every role's `allow` |
| `dsh/profile/cycle.md` | operator only | the research-cycle contract Gravit runs; Gravit proposes changes in conversation and never edits it; git |
| orders at the Account seat (`mcp__account__*` writes) — Gravit's only order path | nobody today — Gravit, under both cards, once the operator admits the seat as Gravit on the Account page and signs it a `trade` limit naming a paper venue | **Gate 2** cards every seat write before it leaves dsh (the twelve writes, and any seat tool the face has not classified), and the Account's Guard cards it again under the owner's device key — answered in the face's Cards since 2026-10-24; the seat's reach is exactly the limits the operator signs — the face process holds no key and signs nothing, and draws the Account's venues as the Account reports them (D17, D18); under a `never` policy, or with no session to ask in, a seat write is denied rather than asked, and `place_order`/`cancel_order` under any server are denied outright and refuse the boot (the retired tools); the automated drill runs on `mcp__drill__*` stand-ins of the seat's writes; a limit on a real venue is the real-money trigger (§8) |
| the owner's hand orders at the Account (the face's Trade screen, since 2026-10-24) | the operator, by hand, each order signed with the browser's device key at the Account's door (`POST /api/exchange`, carried by the face's proxy) | no gate of this tree's: the Account's live cap on each order and movement, its venues' rules, and *What you sign* drawn before every signature; no card — the owner's act is not the agent's; the face process carries bytes, holds no key and signs nothing (D18). On a real venue this is the owner's own money by the owner's own hand (§8) |

Three honesty notes the table depends on. First, Gate 2 holds the MCP tool *surface*, not the
account: the seat's key file in the Account's home is readable from a shell turn, which can sign
at the Account's door with no card here; D8 and D17 carry the rest. Second, Gate 2 is a gate,
not containment: it stops the model's ordinary tool calls; a wrapper on dsh's execute seam or an
unrestricted shell walks around it, and the same shell can answer its own card over loopback —
the answer route's browser cookie is signed by a secret stored in the harness home, which a
shell turn can read — leaving a genuine one-shot approval in the log, so the guard proves that a
grant was recorded, not who recorded it (D10; Rule 2 applied honestly). Third, the workspace
boundary protects the runtime, not the repo: the face, the mechanics skills and Gate 2's own
code are inside the workspace and are protected by review and tests, not by placement.

## 5. Debts, carried openly

Known gaps, each with why it is acceptable now and when it falls due. Pretending these are
solved would be worse than carrying them.

| # | Debt | Acceptable now because | Due when |
|---|---|---|---|
| D1 | The measured party writes its own measurements: Gravit writes its own `journal.md`, the record of its paper trades | operator reviews diffs; the cycle contract binds method; the Account's own statement records every paper fill and names who placed it, and Gravit cannot write it | reached 2026-10-24 by the operator's decision: the trigger was "before any strategy enters paper forward-testing", and since then every cycle trades on paper; the next trigger is the operator's to set (proposed, awaiting the operator: before a strategy's paper record is taken as grounds for a real venue) |
| D2 | Agent commits and operator commits are indistinguishable in git | single operator, low volume | cheap fix (distinct commit identity for Gravit) on first confusion |
| D3 | *Resolved 2026-10-24: there is no Gate 1 to arm.* The order flag and its tools left with the Python package; a person reading a seat write's card is the account-seat drill's, owed with D17 | — | — |
| D4 | Mechanics skills are prose-protected only | single user; every edit reviewed | if skills ever get a second writer, including Gravit |
| D5 | Per-session LLM usage is visible, but there is no combined accounting across Gravit, room members and temporary descendants, nor complete LLM + data API spend accounting | operator reviews usage and provider bills | first surprise bill, or any scheduled autonomous runs, or the first cycle whose usage surprises the operator |
| D6 | The mechanics red-lines have no drill; no test reads the content of the skill packs | single user; every edit reviewed | carried rule: a new guard ships with its drill in the same change |
| D7 | No instrument for net-negative drift: nothing compares "now" against "never-evolved" | strategies are few; the operator still reads everything | when an independent evaluator exists (see D1) |
| D8 | Gate 2 is prose against a shell: it holds the seat's tool surface, and the seat's key file in the Account's home can be read by a shell turn, which signs at the Account's door with no card here — the seat's R1; and Gate 2 exists only inside the face | paper venues only by the operator's rule; the Account's own Guard card and cap | real-money intent (D17's and D18's triggers), or any host other than the face running the profile with the seat mounted |
| D9 | The channel roster is a menu, not a fence: tool schemas are tree-wide, a session in no channel is never roster-checked, and a shell turn can call a CLI directly | it reduces noise and states intent; writes are logged | if a rostered agent ever gets a capability the operator would not grant every channel |
| D10 | The harness home and the face's own routes are reachable over loopback from inside the workspace — a fence, not authentication — and so is the approval-answer route, whose browser cookie (dsh 0.2) is signed by a secret in the harness home, so a shell turn can approve its own order card; and the MCP servers, children of the face process, write outside the sandbox (the seat its key file in the Account's home, D17) | one operator, one machine; the writes are small and visible; the seat's paper-only limits bound an answered card | a second human, a hosted deployment, real-money intent, or the first unexplained change to `$DSH_HOME/face/*` |
| D11 | *Resolved 2026-09-07.* The model is told it is Gravit: `dsh/profile/persona.md` is the `system-prompt` row's `personaPrefix`, set by the face at compose time; a bot's preset shadows it for that bot's sessions | — | — |
| D12 | Bot tool masks are visibility, not authority. dsh scopes and `tools.restrict` are "live visibility composition, not an authority boundary"; a bot with a shell writes whatever its session's sandbox mode allows and reaches whatever the network allows | held by: the `read-only` permission preset logged into every bot room session inside its creation (file effects, subject to an operator-granted escalation card), the `journal/`-scoped `cwd` of every bot home session, Gate 2 tree-wide (the account), and the room transcript naming every dispatch and every member not called. Not held by the mask, and not held for the network | if a bot's composition is ever given the account tools, or a room session is created other than read-only (§8) |
| D13 | Gravit's sessions and delegated tasks can work at the repository root, which includes `bots/`; their prohibition on editing bot files, including journals, is carried by `GRAVIT.md` and review, not by the sandbox | single operator; every edit reviewed; git is the ledger; a bot's own home-journal writes follow §4 | the first unauthorized edit under `bots/` |
| D14 | Structured room evidence, child-task results and role reports have no independent verification or result-acceptance mechanism; passing runtime drills does not establish better research | originals, request snapshots and task histories remain reviewable; Gravit checks results and the operator judges them | before claiming a research-quality gain or reducing review on the strength of these features |
| D15 | Bot journal context is a bounded read of historical notes; freshness, conflicts and note selection still depend on manual maintenance | each request records what it consumed and exposes missing or truncated notes | when stale, conflicting or omitted notes materially affect a conclusion |
| D16 | *Resolved 2026-10-24:* the research cycle calls no role and keeps no role-call count; the round cap stays the goal's (the 24 is Gravit's argument to create_goal, as cycle.md instructs; dsh's own default is 256) | — | — |
| D17 | The Account seat's fence is the operator's grants on the Account page, not code in this tree: a limit signed on a real venue would reach real money through the same two cards, and the face cannot tell a paper venue from a real one; two cards per seat write meanwhile; the seat's key file is written by a child of the face outside the workspace, in the Account's home, and a shell turn can read it and sign at the Account's door with no card here (the seat's R1); the seat is matched by the name the owner typed | paper venues only by the operator's rule; the Account's own Guard, `--live-cap` and limits; both cards; one operator, one machine | the first limit signed on a non-paper venue, or a real venue connected to that Account with the seat granted reach — the real-money trigger (§8); a second human |
| D18 | The face's page is an owner device of the Account (2026-10-24): the browser profile that holds the key can sign anything the owner can — hand orders up to the Account's cap on every venue the operator connected there, seats' limits, cards, venue connections. The key is the browser's (WebCrypto, non-extractable, the page's origin), lost with the profile and admitted again by another device; the pairing code and the envelopes pass through the face process unlogged; the signing client is the Account's door protocol reproduced in `face/client`, which this tree keeps in step with the Account by hand (the smoke is the canary) | held by: loopback only; the Account's own cap and *What you sign*; the proxied rows are an allow-list and the Account's fence covers everything else; a local process reaches the proxied owner routes as it reaches the Account's own and does nothing without an admitted key; one operator, one machine | a real venue connected to the Account and an order placed on it by hand from the face (the owner's money; the first real-money surface in the face); a second human or machine; a change in the Account's envelope (every signature refused until the client follows) |

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

Rules 1–5 of `docs/backtest-rules.md` left with the beds on 2026-10-24; no rule replaces them.

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
(D14). None ships since 2026-10-24, when the three roles retired with their tools; the next are
the operator's to design (`roles/_template` is the copy source).

### 7.3 What this design deliberately does not build

- **No privileged second agent.** Teaching and final adjudication belong to the operator;
  Gravit remains responsible for the research conclusion across consulted voices and delegated
  work. Local CLIs remain callable tools. A remote voice, if reached over A2A, would contribute
  untrusted text, not authority in this tree; inbound access from outside this machine reopens
  §8. Delegation does not introduce an independent evaluator (D1, D14).
- **No proposal queue.** Change lands by editing; git is the ledger and the rollback. A
  deliberation pipeline is bureaucracy at this scale.
- **No bespoke harness.** dsh owns the runtime — sessions, tools, sandboxing, subagents, and
  the approval channel. The face hosts it in-process and registers the order producer on dsh's
  published `tools/pre-execute` seam; that is configuration in code on a pinned version, not a
  fork, and the two pins make the dependence explicit. We do not fork it or wrap its loop.
- **No hosted face.** Loopback only, one machine, no authentication machinery of the face's own
  on the local surfaces — dsh 0.2's browser cookie on `/api` is dsh's (see D10 for what that
  costs).
- **No multi-tenant, cryptographic, or kernel-level machinery.** One operator, one machine.
  The risks are named here in one line each instead of being built against: a hosted or
  multi-user deployment invalidates this charter rather than extending it. The Account seat's key
  is the Account's — Linqi's program, its home — and the owner's device key is the browser's: on
  the Account's page, and since 2026-10-24 on the face's page as a second owner device, where
  `face/client` speaks the Account's door protocol as a client speaks it (a P-256 key the browser
  holds, the Account's envelope and nonce) and designs none of its own. The face process holds no
  key and signs nothing; Gate 2 stays the face's only gate for the agent; the owner's hand orders
  pass through no gate of this tree's (D18).
- **No memory substrate beyond what exists.** Git, strategy artifacts, bot journals and dsh's
  own session histories are the memory. A dedicated store is chosen when content demands one.

## 8. Revisit triggers

Few and concrete. Each names the section it reopens.

| Trigger | Reopens |
|---|---|
| Running the profile in any host other than the face | D8 (Gate 2 is absent there) |
| Gravit begins authoring reusable skills | Rule 7 → lifecycle machinery · D4 |
| An independent evaluator is introduced | D1 · D7 (the measurement plane) |
| dsh leaves developer preview or ships a breaking change | the two pins · profile and skills format · the drills |
| A bot's composition is given the account tools, a bot room session is created other than read-only, or a bot home session's cwd widens past its `journal/` | §7.1 · D8 · D12 · run the order drill under that bot's preset |
| A role is given a bot's tools, the account tools, or ask_user_question | §7.2 · D12 · run the order drill with that role's child |
| Claiming better research or reducing review because rooms or delegation are available | D1 · D14 · real-task comparison and explicit result acceptance |
| Stale, conflicting or truncated journal notes affect a conclusion | §7.1 · D15 · maintenance and retrieval requirements before choosing a new memory store |
| Expanding the interface migration in §9 | §3 (the FACE row) · §7.3 "No bespoke harness" and "No hosted face" · the two pins · the row and RPC inventory against the CLI's |
| A limit signed for the Account seat on a venue that is not a paper account, or a real venue connected to that Account with the seat granted reach there | §4 Gate 2 and the Account's card · D8 · D17 · D1, should the operator adopt its proposed trigger · the next charter (the venue-plugins handoff's §12.1, C1–C5) |
| A real venue connected to the Account and an order placed on it by hand from the face | D18 · the Account's cap and *What you sign* · the next charter (the handoff's §12.1 stays the agenda for the agent's path) |
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
- **The Account seat** (built 2026-10-20; `docs/superpowers/specs/2026-10-20-account-seat-design.md`):
  Gravit sits at Linqi's Account through one MCP row, on paper venues only, every write carded
  twice. Open: real venues (the venue-plugins handoff's C1–C5, the next charter); one card per write
  (a per-seat paper autonomy on the Account's side); the seat's tool block (`DEVELOPMENT.md` §4.3,
  15,727 heuristic tokens) against the mask on Gravit's preset. Since 2026-10-24 the Account's
  content is the face's Markets and Account and the face's page is an owner device
  (`docs/superpowers/specs/2026-10-22-account-graft-design.md`). Open: Guard · Beast and the cap
  on the face (the operator's "先不管"); the venues that connect only on the Account's page;
  perpetuals and leverage from the ticket; the face's keyed sources as wallets — accounts connected with a key — offered as MCP
  servers (the operator's direction of 2026-10-22, the next step of 借鉴 Account 完善 Gravit).
  The face's own producers and keyed quote providers retired on 2026-10-24, with the Python
  package, the PIT beds and the backtests (the design's §12); the face's own quote wire speaks A
  shares alone.
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
