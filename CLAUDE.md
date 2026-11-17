# CLAUDE.md

@AGENTS.md

<!-- Maintainer note, for whoever edits this file: the Map is one line per area; a feature adds no
row unless it adds a top-level folder, and its detail goes to that area's README section or to
DEVELOPMENT.md; face/tests/claude-md.test.ts holds the budgets. -->

This file is descriptive — present-tense facts about the tree, updated when the tree moves; the
rules are `AGENTS.md`'s, imported above. It is the only CLAUDE.md in the repo. Owner: the operator.
Last reviewed 2026-11-17.

## What this is
A market-strategy-account research workbench for one operator, one principal agent (gravit) and
operator-authored bots, reset 2026-08-29 from the previous product; the repo holds no Python since
2026-10-24. Three processes on loopback: the face (`face/`, 127.0.0.1:3090) hosts DeepSeek Harness
(dsh) in-process and serves the one page; the Account (`account/`, 4820) is the wallet; the Market
(`market/`, 4821) serves the public market reads, with AKShare (A shares and more) as its sidecar.
gravit is one conversation (`face/src/conversation.ts`) that runs its tasks as worker sessions;
both reach the Market through `mcp-market`, the Account through the seat (`mcp-account`, paper
venues only, its writes the workers' alone) and the owner's record of decisions and lessons through
`mcp-memory` (gravit-memory, a dependency of `face/`). The desk (`face/src/desk*.ts`) is the
always-on part: standing orders, the watch's alerts, routines and the phone's outlet. The face's
server holds no Account key and signs nothing itself: the owner's signed acts are signed in the
browser page, one of the Account's owner devices, and the seat signs with its own key, kept in
the Account's home with the phone networks' secrets.

## Map
| Where | What |
|---|---|
| `Gravit-Design.md` · `DEVELOPMENT.md` · `ROADMAP.md` · `Gravit-Docs-and-Prompt-Loops.html` | local only (`AGENTS.md`): the charter, which outranks everything on intent; the as-built reference, which follows the code on mechanism; the forward index and built log; who reads which document, and the two prompt loops |
| `AGENTS.md` · `GRAVIT.md` | the coding agents' rules, imported above; the one file every dsh agent in the tree reads on its first request (the face patches dsh to read it and `GRAVIT.local.md` alone) |
| `face/` | gravit-face, Node 22, dsh 0.2.1-rc.5 in-process from profile `face`: `src/` the server, `client/` the page, `plugins/` (the in-process rows `lunhui/`, `analog/`, `readthrough/`; the preset plugins `gravit.js`, `bot.js`, `role.mjs`), `scripts/` (the service, its watchdog, the desk's switch), `tests/` |
| `face/client/` | the page's screens: Messages, the Desk, Markets, Trade, Account, Discover, Memory, History, a task's and a strategy's page |
| `account/` | the Account service, its own package (from buyer-agent-demo, `NOTICE`; `account/README.md`): its API and the seat in `src/portfolio/`, the phone's networks in `src/portfolio/identity/` |
| `market/` | the Market service, its own package (`market/README.md`): the keyless public sources, China (Tencent), the AKShare sidecar, the Lunhui relay and iFinD; it writes nothing and holds no wallet |
| `dsh/` | the harness profile: gravit's persona and section contracts (`profile/*.md`; `profile/cordis.yml` is an indicative template, not a validated config) and skills; install is `npm run setup` in `face/`, then the operator's rows per `dsh/README.md` |
| `strategies/` | one directory per strategy (`_template` is the copy source) |
| `desk/` | `journal/` (the desk session's cwd, the only place gravit writes there), `STANDING.md`, `rules.yml`; the operator's book (`levels.yml`, `holdings.yml`, every `strategies/*/levels.yml`) is gitignored |
| `bots/` · `roles/` | the bots (dsh presets; `gravit` the default) and the role library (`ROLE.md` + `role.yml`, one `role_<id>` tool each) |
| `docs/` | `dsh-upgrade-guide.md`, `research/` (frozen inputs), `design/`, and `superpowers/` (local only: specs, plans, runbooks) |
| `compose.yml` | the optional isolated run, three boxes with the face's 3090 the only port published (`face/README.md` "The three-box drill"); the three host processes are the daily one |

## Commands
```bash
# face/
npm run setup               # once, after npm install: writes $DSH_HOME/profiles/face, never overwrites
npm test && npm run typecheck
FACE_SMOKE=1 npm test       # adds the smoke files (real boots); from a checkout outside /tmp and $TMPDIR
npm start                   # prints http://127.0.0.1:3090/?token=… — open that (see face/README.md)
npm run render:roles        # after a roles/ edit: regenerates bots/gravit/agent.cordis.yml
npm run desk -- pause|resume|arm|rearm|unmute   # the desk's switch, standing orders and mute
# account/ and market/ — each its own package: npm ci once; npm test && npm run typecheck in each
npm run account             # 127.0.0.1:4820; prints the pairing code the face pairs with
npm run market              # 127.0.0.1:4821
```

## Gotchas
- **Nothing guards against lookahead and nothing backtests** (since 2026-10-24): the Account's
  history is read as it is, and a strategy's evidence is forward paper trading on its paper venue.
- **One order gate: Gate 2, the face's card on every Account-seat write** (`face/src/orders.ts`,
  only when dsh runs inside the face; `place_order`/`cancel_order` under any server are denied and
  refuse the boot). It is not containment — a shell turn can read the seat's key file
  (`~/.buyer-agent-demo/seats/gravit.json`) and sign at the Account's door. The owner's hand orders
  from Trade pass no gate of this tree's, only the Account's cap (charter D18).
- **Paper venues only**: the seat trades under a `trade` limit the operator signs at Account ›
  Agents naming a paper venue, never a real one. `npm run account` writes to its home
  `~/.buyer-agent-demo` (`--read-only` refuses paper orders too) and serves no page.
- **`$DSH_HOME/profiles/face/cordis.yml` is rewritten to `[]` on every face boot.** The
  operator's file is `cordis.patch.yml`: the face's overlay rows (webserver, connection, the Remote
  controllers, the preset registry…) override it silently; `face/src/policy.ts` defaults yield to it.
- **The chat URL is tokenized.** Open the `…/?token=…` URL `npm start` prints: that visit sets a
  30-day cookie for the exact host:port (`localhost` is not `127.0.0.1`); `/api` 401s without it.
- **`face/client/*` is served with no cache headers** — hard-reload the browser after any client
  edit, or you drill a stale module.
- **The installed service holds 127.0.0.1:3090.** `npm run service` is the operator's LaunchAgent:
  it runs the checkout it was installed from, and `install` writes the installing shell's
  `DSH_HOME` into its plist, so it runs from the primary checkout on the operator's home, never
  from a worktree or a scratch home. The primary checkout's `face` preview cannot bind there
  either: a second face runs as `AGENTS.md` says, and on a scratch harness home naming no memory
  home it opens no memory at all.
- **The memory's home is outside the repository, and the face never makes it**: until
  `npx --no gravit-memory init` in `face/` makes it (`~/.gravit-memory`, its price source then set
  per `face/README.md` "The memory"), every memory tool answers "no memory here".

Reading order for a new session: `Gravit-Design.md` §1–§2 → the `DEVELOPMENT.md` section you are
touching (in a worktree or a clone, which have neither, the `face/README.md` section: its 8,200
lines' sections are listed by `grep -n '^##'`, most naming their files) → `GRAVIT.md` for what
gravit itself sees.
