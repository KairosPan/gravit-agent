# Gravit — Product Charter

**Status:** living charter, written 2026-08-30; revised through 2026-09-09 for bots and rooms;
revised 2026-09-11 for bot settings, discussion evidence, journal context and temporary
subagents; §4, §5 and §7.3 pointers re-read 2026-09-30 for the dsh 0.2.0-rc.2 re-host; revised
2026-10-18..19 for the role library and the research cycle (§1, §3, §4, §5, §7.2, §8, §9; D13
now names `GRAVIT.md`; D16 added); revised 2026-10-24 for the face's page as an owner device
of the Account (§1, §3, §4, §5, §7.3, §8, §9; D18 added), and again 2026-10-24 for the exit of
the Python package, the PIT beds and backtests (§1, §2, §3, §4, §5 — D3 and D16 resolved, D1, D8
and D10 rewritten — §6, §7.2, §8, §9); revised 2026-10-26 for the Lunhui rows and their three
roles (§1, §4, D10, §7.2); revised 2026-10-27 for the Account service in this tree and its two
boxes (§1, §3, D17, §7.3, §9); revised 2026-11-01 for the Account's two parts — A shares,
Lunhui's reach and AKShare in the Account box, the wallet and Market halves on the face, the
Account's page retired (§1, §3, §4, §5 — D17, D18 — §7.3, §8, §9); revised 2026-11-01 for the
desk merged onto main - its phone (the always-on design's P1) and its clock (P2): §1, §3, §4, §5
(D5, and the desk's D19-D27, its D17-D25 renumbered past main's D18), §7.3, §8, §9; revised
2026-11-01 for the desk's watch (P3), in both markets on the Market's reads: §1, §3, §4, §5 (D19,
D20, D23 and D26; D28 added); revised 2026-11-02 for the desk's per-strategy pre-market report
(P4), on each strategy's market's calendar: §3, §4, §5 (D28 held for a strategy's own firings); revised
2026-11-02 for the desk's hardening (the annotation lane and the watchdog): §1, §3;
revised 2026-11-04 for Identity in the account (plan B1a; the split-and-identity spec's §5.9,
approved with it): Telegram's token, poll, inbox and outbox move from the face to the account,
the desk reaches the phone through it — §1, §3, §4, §5 (D18, D19, D20), §7.3, §8; revised
2026-11-04 for Slack in the account (plan B2; the same spec's §5.9 as it applies to Slack): Slack
beside Telegram, its app's two tokens in the account, its connection an outbound Socket Mode
socket — §1, §3, §4, §5 (D20), §7.3; revised 2026-11-05 for the product as a personal
agent for investors and traders, with persona and growth, and an outbound external identity,
both stated as direction and not built (§1, §7.3, §9);
§7.2 re-read 2026-11-02 for the dsh 0.2.1-rc.5 upgrade (a role is a preset of its own behind
the face's blocking tool; a native child reports by notice; the upgrade's own decisions are PLAN
D19–D27, `DEVELOPMENT.md` §4.8, not this charter's D19–D28) ·
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

Gravit is a personal agent for investors and traders: **one operator, one machine**, and the
operator retains final judgment. Gravit is the product name. The principal agent runs on
DeepSeek Harness (dsh) inside the operator's chat face and works three layers. It organizes
work, checks returned evidence and owns the research conclusion. The prompt it runs with today
is the research persona in `dsh/profile/persona.md`.

Two directions are named and not built. Persona and growth: an agent with its own name and
character, that understands the user and grows with their investing experience, including
proactive contact on top of the desk's phone, watch and reports, and a dedicated memory module
that is not yet designed. User-preference modelling, personality formation and autonomous growth
are not implemented. Git, strategy directories, bot journals and session histories are a
persistent record of decisions and interactions, not that module. An external identity: the
product discovers and calls other agents, outbound only, as the approved first step toward a
wider agent network. No such interface is built, and no agent network exists here. Inbound
calls from other agents remain unbuilt and would reopen §8.

Operator-authored bots carry
continuing research perspectives into rooms (§7.1). Temporary subagents perform bounded
delegated work (§7.2). The role library — one-shot roles with their own persona and tools, three
shipped since 2026-10-26, the Lunhui analysts and reviewer — is the prebuilt form of that
delegation (§7.2). One principal agent
does not mean only one execution context.

- **MARKET** — the Account provides every market — crypto, US stocks, RWAs, perpetuals,
  predictions and A shares (China, view-only, in CNY) — read keyless and server-side by the
  Account, and Gravit reads them through its seat; AKShare is the Account's sidecar, reached
  through the seat's `portfolio_akshare`. No beds, no replay and no lookahead firewall since
  2026-10-24, by the operator's decision: the Account's history is read as it is, and a
  strategy's evidence is forward paper trading on the Account's paper venue. The Lunhui rows
  freeze hashed Tencent and Eastmoney samples into a strategy directory for read-only research
  (since 2026-10-25), fetched through the Account's relay (the boards stand-in through its iFinD
  route), the evidence saying `via: "account"`; like the AKShare reads they carry no lookahead
  guard and are never evidence of a trade. The face's routes, the Lunhui rows and Gravit's tools
  reach no market host, and the agent box keeps only the DeepSeek key and the seat's own — but
  its network is not internal, so a shell turn there still reaches any host.
- **STRATEGY** — Gravit's arena. A strategy is a directory under `strategies/`, meant to be
  git-versioned: a thesis with falsification terms, a journal of its evidence (forward paper
  trades among it), a lifecycle state. In the face, each strategy directory is a **channel**:
  its conversations, its landing page, its roster of helper agents. A channel with bots on its
  roster is a **room**: Gravit dispatches the voices, the operator argues with them, and the
  conclusion stays Gravit's. (As of 2026-09-04 only the template is committed; the three live
  strategies are untracked, so their ledger is not yet written — `DEVELOPMENT.md` §3.4.)
- **ACCOUNT** — since 2026-10-20 a seat at the operator's Account through one MCP row, on its
  paper venues only. The Account is the Account service in this tree (`account/`, copied from
  Linqi's buyer-agent-demo @ 133b9a7 on 2026-10-27), run as its own process — and, under
  `docker compose`, as its own box. Every seat write passes Gate 2 here and the Account's own
  card there (D17). The face is the Account's only face, read through a loopback proxy: its
  Markets and Trade are the Account's Market part, its Account screen the wallet part
  (Portfolio · Money · Venues · Agents · Cards · Rules); the Account serves no page of its own
  since 2026-11-01. The face's page is the Account's owner device: the operator acts there by
  hand, each act signed with the browser's device key at the Account's door, under the
  Account's own cap (D18). The Account is the account: the operator's own Alpaca paper account,
  when wanted, is one of its venues.

**What a working day looks like.** The operator opens the face at `127.0.0.1:3090`, picks a
channel, and talks to Gravit. Gravit reads the market, AKShare included, through its Account seat,
trades on the Account's paper venue under both cards, and writes thesis and journal into the
strategy directory. The operator reads the face's Markets, Trade and Account screens, reads the
git diff, and teaches: trading style lives in an operator-owned skill pack; taste and judgment
arrive through conversation and review, not through machinery. One strategy was carried from
idea to a retirement verdict on 2026-09-02, by its own pre-registered falsification terms and
the backtests of the time — in the working tree; its directory has not been committed. Away from
the screen the operator has the desk: a private Telegram chat or Slack DM with Gravit on their phone, one
long-lived desk conversation that answers what they ask — the desk's own state, its standing
orders, and the price now, from the Market's reads (D23) — and, between turns, sends the
watch's alerts on their levels and rules in US shares and A shares, each with its plan; it informs,
never orders. The operator trades in their own broker app on what the desk tells them.

**What it is not.** Not an automated trading system, not an autonomy ladder, not a hosted or
multi-user service.
Nothing starts unattended except a standing order the operator armed in the harness home, with a cap and an expiry, and the watch's annotation of an alert that a level or rule asking for one raised, under a 90 s deadline and the same budget; a standing or annotation turn informs the operator — it never orders, asks, opens a goal or edits what it runs.
Beside the face's own LaunchAgent a second one runs unattended, the watchdog (`com.gravit.face.watchdog`, every five minutes, no model): it tells the phone when the desk stops answering or degrades and restarts a face that does not answer, once per outage, and tells it when the account or the market stops answering, restarting neither; its lines go through the account, and only the one that says the account is down goes to Telegram directly, or to Slack when Telegram is not connected (D20) — it informs and restarts, nothing more.
A research cycle the operator starts runs to
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
│            key) and the Account's grants and cap (D17, D18) ·    │  (except key files)
│            the desk's pause and its standing orders, armed       │
│            from a terminal · talks to the desk from the phone ·  │
│            trades in their own broker app                        │
├──────────────────────────────────────────────────────────────────┤
│ FACE       gravit-face, one Node process at 127.0.0.1:3090:      │  the operator's
│            hosts dsh in-process · chat per channel · Markets ·   │  surface; also
│            Trade · Account · the per-order approval card         │  where Gate 2 lives
│            (Gate 2) · bot settings · room comparisons ·          │
│            child task history · the desk: one desk session,      │
│            its ledger and pause, the phone bridge (polls the     │
│            account; nothing listens), the clock (standing        │
│            orders on the XNYS calendar, each a fresh desk turn   │
│            with a deadline, under the desk's daily budget)       │
│            · the watch: levels, rules and filings on polled      │
│            prices in both markets, each alert to the phone       │
├──────────────────────────────────────────────────────────────────┤
│ GRAVIT     dsh runtime · skills (mechanics + style) ·            │  the agent
│            works strategies/ ·                                   │
│            runs research cycles under a goal ·                   │
│            queries via MCP tools · consults room bots ·          │
│            delegates bounded child tasks (and roles, when        │
│            one ships) · may call rostered local CLIs as tools ·  │
│            on the desk (gravit-desk): informs, never orders; no  │
│            shell, no order tools; writes only desk/journal/,     │
│            reads only inside the repository                      │
├──────────────────────────────────────────────────────────────────┤
│ MCP ROWS   composed by the face: the Account seat alone          │  the workbench
│            (mcp__account__*, AKShare through it) ·               │  (this repo)
│            no lookahead guard                                    │
├────────────────────────────────┬─────────────────────────────────┤
│ MARKET                         │ ACCOUNT                         │
│ the Account's markets: crypto, │ the Account (account/, its own  │
│ US stocks, RWAs, perpetuals,   │ process, no page): both halves  │
│ predictions, A shares —        │ on the face, signed by hand     │
│ keyless, server-side by the    │ from it; Gravit's seat there,   │
│ Account · AKShare in its box   │ carded, on paper venues only    │
└────────────────────────────────┴─────────────────────────────────┘
```

The desk is the face's always-on side: one desk session — the `gravit-desk` preset, its cwd
`desk/journal/` — that the operator's phone reaches through a private Telegram chat or Slack DM,
which the account holds (D20): the account polls Telegram and holds Slack's outbound socket, and
keeps the operator's texts in its inbox, the
face polls the account and sends through it, naming each message's kind, never its recipient;
nothing on this machine listens for the outside (§7.3). The desk's clock fires
the standing orders the operator armed in the harness home (`standing.yml`) on the exchange
calendar, a rule table in the face's own code — each order on its own market's, XNYS or the XSHG
table: each firing is one turn in a fresh `gravit-desk` session in the order's directory, under
its own deadline and the desk's daily token budget, and its final text goes to the phone — the
pre-close brief is the first, and each strategy's pre-market report (`builtin:report`: its Lunhui
run as the screen line, its status, and its levels against the last prints) the second. The desk's watch
(`face/src/watch.ts`) keeps an eye on the operator's book between turns: the US shares and A
shares that `desk/holdings.yml`, the desk's and each strategy's `levels.yml` and the rules in
`desk/rules.yml` name, priced from the Market part's reads through the face's proxy, as the
Markets screen reads them — US shares by its `explore` read every 20 s, A shares by its `quotes`
read every 10 s — and judged inside each market's own session. An alert goes to the phone from
the face itself through the account's send, the plan quoted verbatim and no model in its path, and, when the level or rule
asks for one, one annotation turn follows as a reply, in a fresh desk session of its own so it never waits on the operator's turns; a new 8-K or Form 4 of
a US name a filing rule covers, read from SEC in the face's own code, alerts the same way. The phone's `/mute` silences the alerts for a while;
detection and the ledger go on. The face presents saved bot
settings, actual session configuration, room evidence and child task progress. dsh owns execution, permissions and session history; the face adds no second
task registry or execution queue. Mechanism lives in `DEVELOPMENT.md`, `face/README.md` and
code. This charter does not restate tool tables or route tables.

## 4. The write map

Who may change what. This table is the charter's core; everything else supports it.

| Surface | Writer | Audit / gate |
|---|---|---|
| `strategies/` | **Gravit**, including any role children and the bounded tasks it delegates to under inherited permissions; and the Lunhui rows, writing only under `strategies/<name>/analysis/`, from the face process, outside any session sandbox, when a non-bot session holding their tools calls them — Gravit, its forks and plain subagents, or the three roles | git history is the ledger (a run's evidence files are not in it, only their hashes); Gravit checks delegated results and the operator reviews diffs; the Lunhui rows anchor every write to a strategy name and a run id, never a path, take a module's artifact only from a role child, and fetch every upstream sample through the Account, its evidence saying `via: "account"`. A strategy's report firing (the `gravit-desk` preset, `workspace-write`, its cwd `strategies/<name>`) writes `reports/` (gitignored) by its order and can write anything in its strategy: its outside-reports line names whatever it wrote outside `reports/` and outside `analysis/`, which its walk leaves to the Lunhui rows unnamed, and its arming pins refuse the next firing over a changed `STANDING.md` or `levels.yml` (D28) |
| `face/` and its tests | normal engineering (operator and coding agents, reviewed) | the offline suite, the gated smokes and the drills — this tier includes the code of the order gate |
| `dsh/skills/mechanics/` | operator only | law, not style: tool mechanics (today the Account seat's guide); Gravit treats them as binding |
| `dsh/skills/style-gravit/` | operator only | Gravit proposes changes in its journal or in conversation; it never edits the pack |
| `$DSH_HOME`: the profile patch, keys, sessions | operator (the patch file); the face rewrites `cordis.yml` and its own metadata files | outside the workspace: no file effect can reach it; reachable over loopback from a shell turn (D10) |
| a channel's agent roster | operator, through the face | every write appends a dated line to `roster.log`; a menu, not a fence (D9) |
| Bot definitions: `preset.yml`, `SOUL.md`, composition and skills under `bots/` | operator, through the face's supported settings or file edits; Gravit and temporary subagents may propose changes, never author them | git and review; settings saves check revisions, and inspection distinguishes saved settings from mounted configuration (D13) |
| `bots/<id>/journal/notes.md` | operator; the bot in its own home session, subject to that session's permissions | home work is scoped to its own `journal/`; room sessions start read-only (D12). Context loading only reads notes and records the consumed snapshot; it never writes them |
| Role definitions: `roles/<id>/` (`ROLE.md`, `role.yml`), and the mirror `bots/gravit/agent.cordis.yml` generated from them | operator, by file edit; Gravit proposes a role in conversation and never authors one | git and review; the face refuses a malformed role at boot, a drift test fails while the mirror differs from the render, and the reader keeps the account and order tools, `ask_user_question` and the AKShare tools out of every role's `allow` |
| `$DSH_HOME/face/desk/`: the desk's ledger, its pause switch `OFF` and its mute `MUTE`, the phone bridge's `inbox.cursor`, the firing ledger `firings.jsonl`, and the watch's `alerts.jsonl`, `filings.jsonl` and `watch.lease` | the face — `desk.ts`, the bridge (`phone-bridge.ts`, which writes `MUTE` on the phone's `/mute` and moves `inbox.cursor` past a text only once the desk holds it), the clock (`schedule.ts`, with `firing.ts`), which writes `firings.jsonl` and its events in the ledger, and the watch (`watch.ts`), which writes `alerts.jsonl`, `filings.jsonl`, `watch.lease` and its events in the ledger; the operator sets the pause from the phone, `POST /data/desk/pause` or a terminal, and lifts it only from a terminal, and sets the mute from the phone and lifts it only from a terminal (`npm run desk -- unmute`) | outside the workspace, as the rest of the home; the phone and the page can only pause or mute (D19); every pause and lift, mute and lift, desk conversation, desk turn — with its tokens, a firing's too — refused turn and distinct load of a watch file is a ledger line, every firing a line per step in `firings.jsonl`, and every alert, its delivery, its batch and its annotation a line in `alerts.jsonl` |
| `$DSH_HOME/face/desk/standing.yml`: the standing orders and the desk's daily token budget | operator only: `npm run desk -- arm` and `rearm` from a terminal, or a hand edit | outside the workspace, as the rest of the home: no route or phone command writes it, nor a desk turn without an approved card (D19); arming pins the order's text — and a script producer's bytes — by sha256, and a pinned file that changed is refused at its anchor, with one phone line, until the operator reviews it and re-arms; any fault in the file stops every order until it is fixed |
| `desk/STANDING.md`, the watch's `desk/rules.yml`, and the book: `desk/holdings.yml`, `desk/levels.yml` | operator only, by file edit | `STANDING.md` is tracked, and pinned by its order in `standing.yml`; `rules.yml` is tracked (it holds no position and no price), read by the watch with every refusal named and one phone line per change; the book is ignored by git (D24), loaded with every refusal named, and stale the moment the operator trades (D21); a desk turn's sandbox keeps its writes in `desk/journal/`, and `GRAVIT.md` puts all four of the desk's control files on Gravit's never-edit list. A strategy's own `STANDING.md` and `levels.yml` are the operator's to write and to arm in `standing.yml` (its research sessions can write them too); its report firings read them pinned, and the watch reads its `levels.yml` unpinned (D28) |
| `desk/journal/` | **Gravit**, in the desk session and in each standing order's firing (the `gravit-desk` preset, its cwd, `workspace-write`); the pre-close brief's turn saves its message under `briefs/` | ignored by git (D24), so no history records it; the sandbox keeps the desk's writes in its cwd and the temp areas; the face's desk guard and pre-turn fence keep instruction files out of it (D25) |
| `dsh/profile/cycle.md`, `dsh/profile/desk.md` | operator only | the research-cycle contract and the desk's contract Gravit runs; Gravit proposes changes in conversation and never edits them; git |
| orders at the Account seat (`mcp__account__*` writes) — Gravit's only order path | nobody today — Gravit, under both cards, once the operator admits the seat as Gravit on the face (Account › Agents) and signs it a `trade` limit naming a paper venue | **Gate 2** cards every seat write before it leaves dsh (the twelve writes, and any seat tool the face has not classified), and the Account's Guard cards it again under the owner's device key — answered in the face's Cards; the seat's reach is exactly the limits the operator signs — the face process holds no key and signs nothing, and draws the Account's venues as the Account reports them (D17, D18); under a `never` policy, or with no session to ask in, a seat write is denied rather than asked, and `place_order`/`cancel_order` under any server are denied outright and refuse the boot (the retired tools); the automated drill runs on `mcp__drill__*` stand-ins of the seat's writes; a limit on a real venue is the real-money trigger (§8) |
| the owner's hand acts at the Account, both halves on the face (since 2026-10-24; all of them since 2026-11-01) — orders, close, change, leverage, Money's moves and Earn, venues, agent wallets and limits, cards, Rules | the operator, by hand, each act signed with the browser's device key at the Account's door (`POST /api/exchange`, carried by the face's proxy); Guard and Close to agents are the only acts taken unsigned, both the Account's safer direction | no gate of this tree's: the Account's live cap on each order and movement, its venues' rules, and *What you sign* drawn before every signature; no card — the owner's act is not the agent's; the face process carries bytes, holds no key and signs nothing (D18). On a real venue this is the owner's own money by the owner's own hand (§8) |
| `<account home>/credentials/networks/`: each network's tokens beside its binding (`telegram.json`; `slack.json`, the app's two tokens) | the account, by the owner's signature at its door (`POST /api/exchange`): `connectNetwork` writes it, `disconnectNetwork` removes it | outside the workspace, in the account's home (under compose a volume the agent box does not mount), `0600` in a `0700` folder, never through a link; the signature carries the token's fingerprint, never the token, and the door checks the token the account has held since the Connect sheet against it before anything is written; the host watchdog reads it only to say the account is down (D20) |
| `<account home>/identity/`: the bindings, the routing and quiet hours, the blocked senders and Not you's counts, the inbox, the outbox, Telegram's poll offset and Slack's cursor (`identity/slack.cursor`) | the account: the bindings, the routing, quiet hours and the blocks by the owner's signature (`connectNetwork`, `disconnectNetwork`, `setRouting`, `blockSender`); the inbox, the offset, the cursor and Not you's counts by its own poller and socket; the outbox by its own send | outside the workspace, as above; the inbox keeps only the bound operator's texts, the last 500, stored before the network's offset or cursor moves, and reading it changes nothing; a stranger is a count and a time, never a text, a name or a handle; the account, not its caller, picks every recipient (D20) |

Three honesty notes the table depends on. First, Gate 2 holds the MCP tool *surface*, not the
account: the seat's key file in the Account's home is readable from a shell turn, which can sign
at the Account's door with no card here; D8 and D17 carry the rest. Second, Gate 2 is a gate,
not containment: it stops the model's ordinary tool calls; a wrapper on dsh's execute seam or an
unrestricted shell walks around it, and the same shell can answer its own card over loopback —
the answer route's browser cookie is signed by a secret stored in the harness home, which a
shell turn can read — leaving a genuine one-shot approval in the log, so the guard proves that a
grant was recorded, not who recorded it (D10; Rule 2 applied honestly). Third, the workspace
boundary protects the runtime, not the repo: the face, the mechanics skills and Gate 2's own
code are inside the workspace and are protected by review and tests, not by placement — and the service starts the
face on whatever code is there, unattended after a crash (D26).

## 5. Debts, carried openly

Known gaps, each with why it is acceptable now and when it falls due. Pretending these are
solved would be worse than carrying them.

| # | Debt | Acceptable now because | Due when |
|---|---|---|---|
| D1 | The measured party writes its own measurements: Gravit writes its own `journal.md`, the record of its paper trades | operator reviews diffs; the cycle contract binds method; the Account's own statement records every paper fill and names who placed it, and Gravit cannot write it | reached 2026-10-24 by the operator's decision: the trigger was "before any strategy enters paper forward-testing", and since then every cycle trades on paper; the next trigger is the operator's to set (proposed, awaiting the operator: before a strategy's paper record is taken as grounds for a real venue) |
| D2 | Agent commits and operator commits are indistinguishable in git | single operator, low volume | cheap fix (distinct commit identity for Gravit) on first confusion |
| D3 | *Resolved 2026-10-24: there is no Gate 1 to arm.* The order flag and its tools left with the Python package; a person reading a seat write's card is the account-seat drill's, owed with D17 | — | — |
| D4 | Mechanics skills are prose-protected only | single user; every edit reviewed | if skills ever get a second writer, including Gravit |
| D5 | Per-session LLM usage is visible, but there is no combined accounting across Gravit, room members and temporary descendants, nor complete LLM + data API spend accounting. Since the desk's P2 (2026-11-01) it is partially closed: desk sessions have a thresholded daily budget; interactive sessions still have per-session usage only | operator reviews usage and provider bills; the desk's spend — its standing orders' firings and its phone turns, though not a turn opened in the browser — stops for the rest of the New York day once `budget.dailyTokens` in `standing.yml` is spent, the cap set after the first measured week | first surprise bill, or any scheduled autonomous run outside the desk's budget, or the first cycle whose usage surprises the operator |
| D6 | The mechanics red-lines have no drill; no test reads the content of the skill packs | single user; every edit reviewed | carried rule: a new guard ships with its drill in the same change |
| D7 | No instrument for net-negative drift: nothing compares "now" against "never-evolved" | strategies are few; the operator still reads everything | when an independent evaluator exists (see D1) |
| D8 | Gate 2 is prose against a shell: it holds the seat's tool surface, and the seat's key file in the Account's home can be read by a shell turn, which signs at the Account's door with no card here — the seat's R1; and Gate 2 exists only inside the face | paper venues only by the operator's rule; the Account's own Guard card and cap | real-money intent (D17's and D18's triggers), or any host other than the face running the profile with the seat mounted |
| D9 | The channel roster is a menu, not a fence: tool schemas are tree-wide, a session in no channel is never roster-checked, and a shell turn can call a CLI directly | it reduces noise and states intent; writes are logged | if a rostered agent ever gets a capability the operator would not grant every channel |
| D10 | The harness home and the face's own routes are reachable over loopback from inside the workspace — a fence, not authentication — and so is the approval-answer route, whose browser cookie (dsh 0.2) is signed by a secret in the harness home, so a shell turn can approve its own order card; and the MCP servers, children of the face process, write outside the sandbox (the seat its key file in the Account's home, D17), as do the face's own rows (the Lunhui runs under `strategies/<name>/analysis/`) | one operator, one machine; the writes are small and visible; the seat's paper-only limits bound an answered card | a second human, a hosted deployment, real-money intent, or the first unexplained change to `$DSH_HOME/face/*` |
| D11 | *Resolved 2026-09-07.* The model is told it is Gravit: `dsh/profile/persona.md` is the `system-prompt` row's `personaPrefix`, set by the face at compose time; a bot's preset shadows it for that bot's sessions | — | — |
| D12 | Bot tool masks are visibility, not authority. dsh scopes and `tools.restrict` are "live visibility composition, not an authority boundary"; a bot with a shell writes whatever its session's sandbox mode allows and reaches whatever the network allows | held by: the `read-only` permission preset logged into every bot room session inside its creation (file effects, subject to an operator-granted escalation card), the `journal/`-scoped `cwd` of every bot home session, Gate 2 tree-wide (the account), and the room transcript naming every dispatch and every member not called. Not held by the mask, and not held for the network | if a bot's composition is ever given the account tools, or a room session is created other than read-only (§8) |
| D13 | Gravit's sessions and delegated tasks can work at the repository root, which includes `bots/`; their prohibition on editing bot files, including journals, is carried by `GRAVIT.md` and review, not by the sandbox | single operator; every edit reviewed; git is the ledger; a bot's own home-journal writes follow §4 | the first unauthorized edit under `bots/` |
| D14 | Structured room evidence, child-task results and role reports have no independent verification or result-acceptance mechanism; passing runtime drills does not establish better research | originals, request snapshots and task histories remain reviewable; Gravit checks results and the operator judges them | before claiming a research-quality gain or reducing review on the strength of these features |
| D15 | Bot journal context is a bounded read of historical notes; freshness, conflicts and note selection still depend on manual maintenance | each request records what it consumed and exposes missing or truncated notes | when stale, conflicting or omitted notes materially affect a conclusion |
| D16 | *Resolved 2026-10-24:* the research cycle calls no role and keeps no role-call count; the round cap stays the goal's (the 24 is Gravit's argument to create_goal, as cycle.md instructs; dsh's own default is 256) | — | — |
| D17 | The Account seat's fence is the operator's grants at the Account, signed from the face, not code in this tree: a limit signed on a real venue would reach real money through the same two cards, and the face cannot tell a paper venue from a real one; two cards per seat write meanwhile; the seat's key file is written by a child of the face outside the workspace, in the Account's home, and a shell turn can read it and sign at the Account's door with no card here (the seat's R1); under compose the Account's home is a volume the agent box does not mount, the iFinD token and `akshare-mcp` live in the Account box, and 4820 is published to nobody but the agent box; the seat's own key stays with the seat in the agent box, and the Account's card on every seat write stands against a shell that signs with it; the seat is matched by the name the owner typed | paper venues only by the operator's rule; the Account's own Guard, `--live-cap` and limits; both cards; one operator, one machine | the first limit signed on a non-paper venue, or a real venue connected to that Account with the seat granted reach — the real-money trigger (§8); a second human |
| D18 | The face's page is an owner device of the Account (2026-10-24), and since 2026-11-01 the Account's only page: the browser profile that holds the key can sign anything the owner can — hand orders up to the Account's cap on every venue the operator connected there, money moves, seats' limits, cards, venue connections. The key is the browser's (WebCrypto, non-extractable, the page's origin); a browser wallet signs in its own extension; the pairing code and the envelopes pass through the face process unlogged; the proxy is an allow-list of forty-three exact routes — since 2026-11-04 the identity routes among them, the Identity tab's two reads and its Connect sheets' three writes, the pasted token's among them, passed through unparsed and unlogged; the account's inbox and send are not on it, the face's server alone calling them — and a venue's OAuth callback is the one navigation, forwarded through the face; the signing client is the Account's door protocol reproduced in `face/client`, which this tree keeps in step with the Account by hand (the smoke is the canary). With one owner device, a lost browser profile leaves the Account with no device that can sign and no code (a code is printed only while it has no owner) — only `--fresh`, which loses the owner, venues, agents and limits | held by: loopback only; the Account's own cap and *What you sign*; the Account's fence covers everything the allow-list does not carry; a local process reaches the proxied owner routes as it reaches the Account's own and does nothing that widens reach without an admitted key (the unsigned acts only narrow it); a second face browser kept paired (Settings › Devices) against the lost profile; one operator, one machine | a real venue connected to the Account and an order placed on it, or money moved on it (Move, Earn, a browser wallet's send), by hand from the face (the owner's money; the first real-money surface in the face); a second human or machine; a change in the Account's envelope (every signature refused until the client follows) |
| D19 | The desk's pause switch (`OFF`), its mute (`MUTE`, since P3) and its arming file (`standing.yml`) are hand-editable files in the harness home, and the pause route (`POST /data/desk/pause`) is loopback-reachable like every `/data` route (D10). This holds on every network the account connects (Telegram today; Slack and iMessage when they come): the phone, on any of them, writes more than the pause: `/mute <duration>` writes `MUTE`, which stops the watch's alerts from being sent | the safe direction: the phone and the page can only pause, never resume or shorten a pause in force; only a terminal, the file's deletion or the pause's own expiry lifts one; the mute holds the same way — `/mute` needs a duration (`/mute 30m`, `2h`, `1d`), so a mute from the phone always ends, a shorter one never replaces a longer one in force, and the phone has no unmute: only `npm run desk -- unmute`, the file's deletion or the mute's own end lifts it, and while it holds the watch still detects and records every alert; every set and lift through the face or `npm run desk` is a ledger line (a hand edit is not). The operator's `standing.yml` in the harness home is written only from a terminal — `npm run desk -- arm` and `rearm`, or a hand edit — never by a route or the phone, and a standing turn cannot write it without an approved card: the file lies outside the turn's cwd and outside its sandbox's writable roots | a route or a phone command, on any network, that resumes the desk, unmutes it, arms anything, or writes more than the pause and the mute |
| D20 | The networks' tokens are keys like the others (R1), held by the account under its home (`credentials/networks/telegram.json`, and beside it `credentials/networks/slack.json`, the Slack app's two tokens; `0600` in a `0700` folder; since 2026-11-04), not in `$DSH_HOME/.env`: whoever holds the Telegram token can read what the operator sends — through `getUpdates`, or a webhook it sets — which the account sees only as a 409 conflict, and can message the operator as the bot; whoever holds Slack's two tokens can likewise open the app's socket and read the DM's history — the account sees a second socket only as a conflict — and post as the bot. Slack's connection is an outbound Socket Mode socket. Each network has one bound handle, and the account admits by the operator's own user id in their private chat, so a lost or compromised phone that is still signed in can chat with the desk — have it read inside the repository, write in its journal and spend tokens — and pause it or mute its alerts. The token travels once, pasted on the face's Connect sheet, through the agent box unparsed and unlogged and never stored there (§7.3); the owner's signature names only its fingerprint. The host watchdog may read Telegram's token from the account's home only to report that the account is down, once per outage, and Slack's bot token only when Telegram is not connected, for the same one line | one bound handle per network, in a private chat; every other sender dropped, never answered, counted in Not you with no text, name or handle kept; connections outbound only; the account, not the caller, picks every recipient — the face names a message's kind, never a chat — and takes its own tokens out of every text it sends, beside the face's redaction of every secret value in its environment; tokens are redacted from every line, record, answer and file but their own; card and fill notices carry no link and no button; the desk orders nothing, and its guard keeps its reads inside the repository and off key files (D27); the phone can only pause and mute, each lifted only from a terminal or at its own end (D19) | a lost phone: end its session from another device (Telegram → Settings → Devices), or Disconnect… Telegram (or Slack) in Account › Identity until then — rotating the token does not stop a device that is still signed in; rotate it when the token itself leaked, and connect again. A second person or any group, on any network (§8) |
| D21 | `desk/holdings.yml`: holdings are what the operator typed — the desk's book is stale the moment they trade | the pre-close brief names the file's last edit beside the holdings it prices, and `desk/STANDING.md` has the message say it; the desk informs and orders nothing, and the operator, who trades in their own broker app, knows when they last did | any broker read |
| D23 | The desk's prices are the Market's reads, in both markets: the face holds no market wire of its own (since 2026-11-01), and the desk asks the Market part in-process through the face's proxy, as the Markets screen does (`face/src/market-quotes.ts` over `face/src/account-proxy.ts`) — a US share by its `explore` read, which the proxy keeps 20 s and the watch polls every 20 s, an A share by its `quotes` read, twelve a read, which the proxy keeps 3 s and the watch polls every 10 s. One source serves every reader: the watch, `desk_quotes`, the pre-close brief (US shares only) and the phone's desk state; each price names its feed (`ROBINHOOD`, `NASDAQ`, `CBOE DELAYED`, `TENCENT`) and its exchange's time, never a process | a price only with its feed and its time; the Account process not running, timed out or busy, a symbol the Market lists no share for, a row with no timed price or a refused read is said (`unavailable: …`, `quotes unavailable: …`, `busy`), never priced; a `stale` or `unavailable` quote is never judged, and a market whose poll fails is said on the phone once per session date (`the watch has no <US \| A-share> prices today: …`) | the Market's `explore` or `quotes` rows change shape; the desk wants a stream rather than a poll, or a US crossing must reach the phone faster than the 20 s cache allows; the Market's US or A-share sources stop answering |
| D24 | The book — `desk/holdings.yml`, every `levels.yml`, the desk's journal — lives on this disk in files git ignores; the repository is public, so a `git add -A` by habit or a file tracked by mistake publishes it | the ignore rules, review, and — as the files arrive — a tracked `.example` sibling for each | the repository goes private, or the book moves into git (§8) |
| D25 | The desk's writable cwd sits on dsh's instruction chain: an instruction file (`GRAVIT.md`, `GRAVIT.local.md`), a `.git` or a skill root (`.dsh`, `.agents`) in `desk/journal/` — which the desk's sandbox lets it write and git ignores — or in `desk/` above it would steer every later desk turn. So would files other tools obey there: a `.gitignore` holding `!*` would have git list the journal for the next `git add -A` (D24), and a `CLAUDE.md` or `AGENTS.md` would reach the operator's coding agents, which load it from that folder and have a shell. The face holds this, not the sandbox | the desk guard — one listener and a deny-only backstop over every call a desk agent makes, its write check first — denies a desk turn's write of such a name, of any dot-file and of any `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` or `AGENTS.override.md` before it runs, and the pre-turn fence refuses every desk turn while one exists there, a `.dsh` or `.agents` sits at the repository root, or a symlink sits in the fenced tree — both code, drilled on a real tree, the fence failing closed. The desk has no shell: an unattended turn on untrusted text must not read key files and reach the network. Not held: the root `GRAVIT.local.md`, the operator's overlay, which every desk turn reads and a root workbench session can write (`DEVELOPMENT.md` §9, R56) | the desk given a shell, a job tool or a write outside its journal; the first fence refusal nobody can explain |
| D26 | The face runs from a tree its agent sessions can write: an edit to `face/` or `scripts/` from a workbench session takes effect at the face's next start, which launchd makes unattended after a crash | single operator; every edit reviewed in the diff; the desk session cannot write there without an approved card. A standing order's script producer runs only the bytes its arming pinned — the pin covers the script's bytes, and nothing is imported from the tree (a research package is installed into the interpreter, never put on `sys.path` from the repository) — and the market clocks (XNYS and the XSHG table) and the watch's SEC reader (`face/src/edgar.ts`, with `face/src/filings.ts`) are the face's own code, under this same hold (`DEVELOPMENT.md` §9, R63, R64) | the first unexplained change under `face/` or `scripts/`; anything that runs workspace code on a schedule without a pin |
| D27 | The desk reads what it is asked to, and what it reads goes to DeepSeek in the tool result. The sandbox lets every read through, so the face's desk guard holds the read side: its read check denies a read outside the repository (where the volume says the path lands) or of any dot-file in it — a `.env` or `.git` name, `.mcp.json`, `.claude/`, `.codex/` — and a search that could reach a dot-file; its secret check denies any call whose arguments carry the value of a key in the face's environment, as it is, JSON-escaped or URL-encoded, but not a lower-case `%3a`, base64 or a value split across arguments, so the read check is the line; the bridge redacts every such value from the phone. Not held: a key kept in a file whose name says nothing and starts with no dot, or returned by an MCP tool, still reaches DeepSeek in a tool result, which the face does not filter yet; a hard link, or a symlink swapped between the check and the open, is not seen | single operator; the keys live in `.env` files, dot-files and the harness home, which the read check refuses or keeps outside; the desk cannot make a link (no shell, its writes kept to its journal and the temp areas); the canary drills the read and the secret on a real tree (`DEVELOPMENT.md` §9, R57) | a key kept in the repository in a file whose name starts with no dot; the first secret seen in a desk turn's tool result or on the phone. The filter is a follow-up, not missing infrastructure: dsh-tools' `tools/post-execute` seam can already redact the face's secret values from a desk agent's tool results (`DEVELOPMENT.md` §10, item 5) |
| D28 | A strategy's `levels.yml` sits in a directory its research sessions can write, and the watch sends its plans verbatim; since P4 its report firings quote them too | for a strategy's own firings (every order that wakes in `strategies/<name>`), the arming pin: `arm` pins its `STANDING.md` and `levels.yml`, a firing refuses a `levels.yml` whose sha256 differs from the armed one until `npm run desk -- rearm`, and the report quotes only the bytes it checked. For the pre-close brief it is moot: the brief reads `desk/` only. The watch reads every strategy's `levels.yml` unpinned: for it D28 is recorded, not held. Every change to such a file is announced with one phone line naming the file and its new short sha256 (the watch's load line, `<file> changed (sha256 <8 hex>): <n> loaded`), and a report turn that rewrites its own `levels.yml` is named at once, after the turn, by its outside-reports line; the load caps and the alert caps bound the rest | the first levels change the operator did not make; the brief or the watch reading a strategy's armed bytes |

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

The native runtime runs every delegated child as a managed, continuable child (since dsh
0.2.1; one-shot children of earlier versions remain as history). A child can report progress;
the runtime separately sends a settlement notice and any final answer. Gravit continues independent work or ends its turn to await that notice, then checks
the result against the brief. A report, an ended turn and an accepted result are different
facts. In particular, `inactive` describes activity, not success or completion (D14).

The face exposes child history, recent output, continuation and interruption through dsh's
native controls. Reading history activates neither parent nor child. Continuation requires
the direct parent to be live; after a restart the current UI asks the operator to send in the
parent first. One-shot tasks remain read-only history. Interruption targets the current turn,
preserves unclaimed queued messages and descendants, and does not cancel the whole tree; a
later send can resume parked work. dsh owns this lifecycle, including recovery.

The role library is the prebuilt form of a delegated task: a role is an operator-authored
persona plus an exact tool allow-list (`roles/<id>/`), composed as the role's own agent preset
whose mask dsh enforces on the child (a role with bash keeps the shell's reach — D12), surfaced
to Gravit as a one-shot tool the face owns: the call blocks and returns the role's report, so a
research run reads a role's work in the turn that asked for it. It is never a bot (no roster, no journal, no room) and never a bot's substitute: a role
has hands and no voice, a bot a voice and no hands. A role's report is a claim Gravit checks
(D14). Three ship since 2026-10-26, after the three earlier roles retired with their tools on
2026-10-24: `cn-market-analyst` and `cn-stock-analyst`, which write the Lunhui market and strategy
artifacts, and `cn-reviewer`, which writes their counterevidence and shares no module tool with
either — the reviewer is not the writer; the next are the operator's to design (`roles/_template`
is the copy source).

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
- **No inbound.** Nothing on this machine listens for the outside. The account polls Telegram and holds Slack's
  outbound socket. The face polls the account. A pasted token passes through the agent box unparsed and unlogged,
  and is never stored there. The browser card remains the only approval surface; the phone is
  told of a card, never asked to answer one. The single-operator, single-machine boundary stands.
  The approved first step toward an agent network is outbound only, and it is not built: Gravit
  holding its own external identity and discovering and calling other agents. Inbound calls from
  other agents remain unbuilt and would still require reopening §8.
- **No hosted face.** Loopback only, one machine, no authentication machinery of the face's own
  on the local surfaces — dsh 0.2's browser cookie on `/api` is dsh's (see D10 for what that
  costs).
- **No multi-tenant, cryptographic, or kernel-level machinery.** One operator, one machine.
  The risks are named here in one line each instead of being built against: a hosted or
  multi-user deployment invalidates this charter rather than extending it. The Account seat's key
  is the Account's — the service in `account/`, its home — and the owner's device key is the
  browser's, on the face's page alone (the Account's own page retired 2026-11-01), where
  `face/client` speaks the Account's door protocol as a client speaks it (a P-256
  key the browser holds, the Account's envelope and nonce) and designs none of its own. The face
  process holds no key and signs nothing; Gate 2 stays the face's only gate for the agent; the
  owner's hand orders pass through no gate of this tree's (D18).
- **No memory substrate beyond what exists.** Git, strategy directories, bot journals and dsh's
  own session histories are a persistent record of decisions and interactions, not a memory
  module. A dedicated memory module is planned and not yet designed; until that design lands,
  this limit stays. A dedicated store is chosen when content demands one.

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
| A real venue connected to the Account and an order placed on it, or money moved on it (Move, Earn, a browser wallet's send), by hand from the face | D18 · the Account's cap and *What you sign* · the next charter (the handoff's §12.1 stays the agenda for the agent's path) |
| A second human, or any hosted deployment | this charter is the wrong document; write the next one |
| A second person, or any group, on any network the account connects — Slack and iMessage are new networks, not a second user | this charter is the wrong document; write the next one · D20 |
| Any order, approval or trade-proposal path from the phone or from a scheduled turn | §4 Gate 2 · D8 · D10 |
| The desk's preset given a shell, a job tool, an account write tool, a role, or the browser watchlist's write path | §7.2 · D8 · D12 · D25 · D27 · run the order drill under that preset |
| A secret seen in a desk turn's tool result or on the phone, or a key kept in the repository in a file whose name starts with no dot | D27 · the post-execute redaction of what a desk tool returns, which dsh's `tools/post-execute` seam already allows |
| The repository going private, or the book moving into git | D24 · the desk's directory layout |

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
  content is the face's Markets, Trade and Account and the face's page is an owner device
  (`docs/superpowers/specs/2026-10-22-account-graft-design.md`). Closed 2026-11-01 (plans 4a
  and 4b): Guard · Beast and the cap on the face; the venues that connected only on the
  Account's own page; leverage, set on a perpetual's market page and its positions. Open: perpetuals
  on Trade's ticket (it trades crypto, stocks, RWAs and predictions alone); the face's keyed sources as wallets — accounts connected with a key — offered as MCP
  servers (the operator's direction of 2026-10-22, the next step of 借鉴 Account 完善 Gravit).
  The face's own producers and keyed quote providers retired on 2026-10-24, with the Python
  package, the PIT beds and the backtests (the design's §12). Since 2026-10-27 the Account
  service is this tree's `account/`, runnable as two boxes under `docker compose`
  (`docs/superpowers/specs/2026-10-27-account-in-repo-design.md`). Built 2026-11-01: A shares
  into the Account box, then the Account's own page retired — the face holds no market wire of
  its own, the Lunhui rows and AKShare reach the market through the Account, and both halves
  live on the face (`docs/superpowers/specs/2026-11-01-account-two-parts-design.md`); the live
  drills are owed (`face/README.md` "The three-parts drills").
- **Evaluate real research and make acceptance explicit** (D14, D16). Compare representative
  research tasks for evidence accuracy, useful disagreement, revision of conclusions, operator
  effort, elapsed time and usage. Develop traceability from claims to source material and from
  delegated results to expected artifacts, checks and unresolved limits. Current comparison
  cards and task histories make review possible; they do not perform these checks themselves.
- **Maintain notes and account for the whole task** (D5, D15). Design operator-reviewed journal
  updates with sources and conflict handling, and combined usage across parent, room members
  and descendants. The current journal hook only reads, and outside the desk's daily budget
  current usage remains per session.
- **The next round: persona, memory, the teaching channel.** The persona's mechanics paragraphs
  move to the tool descriptions, scoped sections and skills dsh provides; the style pack moves
  into a memory substrate the operator designs; the teaching channel is designed with it.
  Deferred by the operator on 2026-10-15.
- **Persona and growth** (not built; set 2026-11-05). A named agent with its own character,
  proactive contact building on the desk that already phones, watches and reports, and a
  dedicated memory module. The module is undesigned. User-preference modelling, personality
  formation and autonomous growth are not implemented. Git, strategy directories, bot journals
  and session histories remain a persistent record (§7.3). This entry is the operator's current
  direction; the 2026-10-15 deferral above stays as the earlier note.
- **An external identity, outbound only** (not built; set 2026-11-05). Gravit holds an identity
  of its own and discovers and calls other agents. Inbound calls from other agents are out of
  scope and would reopen §8. No such interface is built, and no agent network exists in this tree.
