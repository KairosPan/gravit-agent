# dsh/ — the repo-side profile template and skill packs

STRATEGY runs on DeepSeek Harness (dsh). This directory is the repo's half of that setup:

| Path | What |
|---|---|
| `profile/cordis.yml` | profile TEMPLATE — the operator's half: the skill roots, the model, and the INTENDED approval list (see step 4); it names the rows the face composes itself |
| `profile/persona.md`, `profile/cycle.md` | Gravit's two prompt texts, read by the face at compose time (dsh itself reads nothing here): the persona, set as the `system-prompt` row's `personaPrefix`, and the research-cycle contract, mounted as the `gravit:cycle` section of Gravit's prompt (a bot's and a role child's carry none). `cycle.md` is at most 3,300 bytes (`CYCLE_MAX_BYTES`); after an edit, `cd face && npm run render:roles` regenerates the mirror that embeds it (`face/README.md` "The profile") |
| `profile/lunhui-run.md` | the A-share research runs' order (in `cn-market`: freeze, delegate to `cn-market-analyst`, read the run back; in a strategy channel: read the day's market run, freeze the candidates' quotes, delegate the leader and then the mode to `cn-stock-analyst`, read the run back), read by the face at compose time (`face/src/protocols.ts`) and mounted as the `lunhui:run` section of Gravit's prompt only while the Lunhui rows are mounted (a bot's and a role child's carry none); Chinese, at most 3,000 bytes (`PROTOCOL_MAX_BYTES`), no `{{`; after an edit, `cd face && npm run render:roles` regenerates the mirror that embeds it (`face/README.md` "Lunhui analysis") |
| `skills/mechanics/` | neutral mechanics, always apply: `account-seat-guide`, `analog-guide` (which analog tool answers which question, how to research an event through the source reader, how to report the result) |
| `skills/style-gravit/` | the operator's own style: `doctrine`, `signals`, `lessons` — converted from the retired `seeds_v2/` JSON packs |
| `../roles/` (the repo root's, not this directory's) | the role library the face renders into Gravit's preset (`face/src/roles.ts`, `DEVELOPMENT.md` §3.8); `_template` is the copy source and five roles ship: `cn-market-analyst`, `cn-reviewer` and `cn-stock-analyst`, the Lunhui modules' three, `pdf-page-reader` and `source-reader`; each `role.yml` names an MCP tool as `mcp__<serverName>__<raw>`, spelling the server name the installed profile mounts |

Mechanics vs style is the load-bearing split. Mechanics are how the tools and the venues
work — findings never overrule them. Style is the operator's preference: follow it by
default, but when research contradicts an entry, REPORT the conflict instead of silently
deferring. Every style-gravit SKILL.md carries that scope header at the top.

## Install

There is no Python side and no server of this repo's to mount: the face composes its own MCP
rows (the Account seat `mcp-account`, and the market's `mcp-market`, whose `market_akshare` is
AKShare) on every boot, and the operator adds two rows of their own.

1. **Create the harness home and the face profile.** `cd face && npm install && npm run setup`
   creates `$DSH_HOME/profiles/face/` (`$DSH_HOME` defaults to `~/.dsh`): a `package.json`
   bundling `dsh-base`, the operator's `cordis.patch.yml` and `pnpm-workspace.yaml`; it never
   overwrites an existing profile (see `face/README.md`). The dsh command line is not part of
   this install, and another dsh sharing the home changes it: a 0.2 CLI's first run (the
   installed `~/.local/bin/dsh` is 0.2.0-rc.2 and has never run on the home) imports
   `$DSH_HOME/settings.yaml` into ITS OWN active profile and renames the file
   `settings.yaml.imported`, and a 0.1.1-rc.2 CLI or face must never run again on a home that
   0.2.0 has written — it re-heals its module link farm under `profiles/node_modules` and forks
   the session history (`DEVELOPMENT.md` §4.8, PLAN D12 and D13). Nor does a 0.2.0 tool run on
   a home the face at 0.2.1-rc.5 has used: rc.5 writes event types 0.2.0 refuses (D26). A home
   a 0.1.1 face already uses moved to 0.2.0 by the go-live runbook
   (`docs/superpowers/runbooks/2026-09-30-dsh-0.2.0-rc.2-go-live.md`, done 2026-10-01): backup, a
   dry run on a copy (`face/scripts/check-home.ts`), the decisions, then the first boot; the move
   to 0.2.1-rc.5 follows the same shape (`docs/dsh-upgrade-guide.md` §2, §6.4).
2. **Add the operator's rows.** Put them in `$DSH_HOME/profiles/face/cordis.patch.yml` — that
   patch file is the only one to edit there, because `gravit-face` rewrites
   `<profile>/cordis.yml` on every boot (`face/README.md`). Translate
   `dsh/profile/cordis.yml` into rows: the skill roots become one `skill-filesystem` config
   patch (`customSkillDirs` = the two group roots, with every `<ABSOLUTE PATH TO THIS REPO>`
   filled in; the repo copy keeps the placeholders), and Gravit's default model is one row —
   the face reads no `settings.yaml`, so without it the face runs dsh-base's
   `deepseek-official/deepseek-flash`, and nothing in the running face saves a model choice back:
   ```yaml
   - id: agent-default-model
     config: { provider: deepseek-official, model: deepseek-v4-pro, reasoningEffort: max }
   ```
   Confirm what actually booted in the face's plugin panel (`/data/plugins.json`: every loader
   row with its phase, and the tools each MCP server registered). `dsh --profile face
   --dump-config` shows the profile's own layers only — never the face's policy,
   Account seat, market and host rows — and only a 0.2.0 CLI may run it on this home (step 1).
3. **Give it the model's key.** `source .env.deepseek` in the shell that launches the face
   (`DEEPSEEK_API_KEY`), or put the variable in the home profile's env block. The file is not
   loaded automatically and is not in git. Precedence since dsh 0.2.1 (`dsh-credentials-local`):
   a `refs` value stored in `$DSH_HOME/.credentials.yaml` wins, then the launch environment,
   then the project's `.env`, then `$DSH_HOME/.env` — at 0.2.0 the launch environment won. So a
   key stored in the home shadows the one you source: keep one copy, and delete the other. No server of this repo's needs a key: the Account
   seat signs with the Account's own seat key, and the market's row and its AKShare sidecar are keyless (`face/README.md`).
4. **Gate 2 — per-write human approval — is the face's, not the profile's.**
   `face/src/orders.ts` registers a `tools/pre-execute` listener that raises an approval card
   for every write of the Account seat, matched on the raw tool name so a renamed MCP server
   cannot slip one past, and a guard that admits the call only on a logged one-shot approval
   for that exact call; the Account's own Guard card follows on its side. It binds only while
   dsh runs inside the face. The template's `permissions: always_ask` block is inert — an
   unrecognised YAML key merges silently, which fails open — and stays in the template as the
   record of what did not work.
5. **Re-check the key names.** dsh is a developer preview and states that there will be
   compatibility-breaking changes. The shape in `profile/cordis.yml` is indicative, pinned
   against a survey frozen 2026-08-22
   (`docs/research/2026-08-22-deepseek-harness-dsh-survey.md`), not against a live install.
   Expect one adaptation pass; the content is the deliverable, the container is not.

## Installed state — the `face` profile (2026-08-31; re-checked for dsh 0.2.0-rc.2 on 2026-09-30; without the Alpaca MCP row since 2026-10-24; re-checked against the dsh 0.2.1-rc.5 packages on 2026-11-02)

The template above is realized, live and drilled, in the face's profile. The shapes that
actually bound, for the next install or the next pin bump:

- **The MCP bridge is `@deepseek-ai/dsh-mcp-client`, and it is NOT in dsh-base.** The face's
  Account seat row and market row use it. It is declared in `face/package.json` at the exact
  `DSH_PIN` (the lockstep sweep in `face/tests/version.test.ts` covers it automatically), not
  installed into the profile — rows resolve plugin names from the face's dependency closure
  through the runtime module resolution the face computes from `face/package.json` at every
  boot. There is no module fallback to heal any more: 0.1.1's link farm under
  `$DSH_HOME/profiles/node_modules` is written by nothing, and a stale one is consulted only
  for a row naming a package outside the face's closure — delete it once no 0.1.1 tool runs on
  the home (`DEVELOPMENT.md` §4.8, PLAN D13). Since 0.2.0 stdio negotiation starts a probe
  process before the serving one, so an MCP server is spawned twice per connect. Still true at
  0.2.1-rc.5: dsh-base mounts no `dsh-mcp-client` row, and the stdio keys the seat row uses are
  unchanged (the upgrade spec's seam ledger, row 25).
- **The operator's rows live in `$DSH_HOME/profiles/face/cordis.patch.yml`:** the
  `skill-filesystem` config patch (`customSkillDirs` = the two group roots — a patch REPLACES
  the addressed row's whole config, which is fine here because dsh-base mounts the row
  configless; the `customSkillDirs` / `includeDefaultRoots` keys are unchanged at 0.2.0-rc.2 and
  at 0.2.1-rc.5, where the row is still configless)
  and the default-model row (`agent-default-model`, step 2). 0.1.1 took the model from
  `$DSH_HOME/settings.yaml`; the face at 0.2.0 reads no settings file (it provides no
  `profileContext`), so the row is the only place Gravit's model is set. A home that still
  carries the Alpaca MCP row from before 2026-10-24 points at a server that no longer exists —
  its `python -m` command names the Python package the tree removed — so remove the row. Should
  any server still register `place_order` or `cancel_order`, the face refuses to boot until that
  row is gone (Gate 2's retired order tools, `face/src/orders.ts`).
- **The global instruction files.** dsh 0.2.1 reads `$DSH_HOME/AGENTS.md` and
  `<DSH_AGENTS_HOME or ~/.agents>/AGENTS.md` into every agent's instruction chain, with no row
  switch; the face names either on stderr at boot when it exists (D25). The face's contract is
  `GRAVIT.md` alone, so keep neither file on this machine.
- **An MCP child's env is scrubbed.** dsh drops every `KEY|PASSWORD|SECRET|TOKEN` name from a
  child's environment, a session's bash tool included; a row that needs a variable passes it
  explicitly (`!!js process.env...`).
- **The approval-channel drill (`face/README.md`'s "Gate-2 drill"): PASSED on the live face,
  2026-08-31, on dsh 0.1.1-rc.2.** A file write outside the workspace escalated to a card; both
  outcomes exercised — deny (command did not run, model saw a rejection result) and approve
  (`allowed-once`, one-shot) — with paired `approval/asked`/`approval/decided` records in the
  session log. At 0.2.0-rc.2 the channel is automated on a real tree (`face/tests/smoke.test.ts`,
  `order-gate-smoke.test.ts`), and its deny half ran live on 2026-09-30 on a scratch home; the
  approve half live is owed, and nothing has run live on 0.2.1-rc.5 yet.

## Notes

- **Skill roots are the group directories.** Discovery expects `<root>/<name>/SKILL.md`, so
  the profile lists `dsh/skills/mechanics` and `dsh/skills/style-gravit` separately rather
  than their shared parent.
- **SKILL.md frontmatter is mandatory.** dsh's skill discovery drops any SKILL.md whose
  YAML frontmatter is missing `name` and `description` — SILENTLY, at warn level in a log
  nobody reads. Every skill in this repo carries the block; a skill that goes missing from a
  session starts its diagnosis here.
- **Editing.** The repo copy under `dsh/` is the source of truth to edit. Installed copies
  under the harness home are operator territory — `GRAVIT.md` puts them on the never-edit list.
