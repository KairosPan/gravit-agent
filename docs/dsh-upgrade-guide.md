# dsh upgrade guide

**What this is.** The operator's entry point for the next DeepSeek Harness (dsh) upgrade, and
the record of every upgrade so far, so that a pin bump is a checklist and not a redesign.
Written 2026-10-15 at the 0.2.0-rc.2 pin; updated 2026-11-02 at the 0.2.1-rc.5 pin (§6.4) ·
**Owner:** the operator · **Rule:** this file
restates no mechanism. Every row points at code and at the section of `DEVELOPMENT.md` or the
README that carries the depth; when this file and the code disagree, the code is the fact and
this file is corrected. The complete seam inventory with the verbatim upstream citations it was
compiled from is frozen at `docs/research/2026-10-15-dsh-seams-inventory.md` (159 rows); the
row ids below (`A1`, `E12`…) are its.

**How to use it.** Before an upgrade: §1 (where we stand), §2 (the procedure), §3 (what to
re-check by hand and what a test will tell you), §4 (decisions to re-take), §5 (drills). After
it: append a record to §6, retire the §7 watch items that landed, update §1's pins. Each change
that adds a dependency on dsh adds its row to §3 in the same commit.

---

## 1. Where we stand (2026-11-02)

| Component | Version | Pinned where | Checked by |
|---|---|---|---|
| the dsh family, 34 `@deepseek-ai/dsh-*` packages (29 on 2026-10-15; `dsh-agent-instructions` added by plan 1, `dsh-tool-subagent` by plan 2, `dsh-tool-ralph` by the 0.2.1-rc.5 upgrade; 36 `@deepseek-ai/*` with the two cordis ones), every one exact | **0.2.1-rc.5** (0.2.0-rc.2 until 2026-11-02) | `face/package.json`; `face/src/version.ts` `DSH_PIN` | `face/tests/version.test.ts` sweeps manifest, installed tree and constant |
| `@deepseek-ai/cordis` (every dsh package peers it `~4.0.5`) | 4.0.5 | `package.json`; `CORDIS_PIN` | `version.test.ts` |
| `@deepseek-ai/cordis-plugin-include` (imported directly for `entryListSchema`; `dsh-app-boot` peers `~1.0.10`) | 1.0.10 | `package.json`; `CORDIS_INCLUDE_PIN` | `version.test.ts` |
| `cordis-plugin-loader` / `-group` / `-timer` | 1.0.6 / 1.0.5 / 1.1.7 (peered `~1.0.6` / `~1.0.5` / `~1.1.7`) | **lockfile only** | nothing: a lockfile-only move of these is an upgrade and gets the whole §2 |
| packages read by path but **not declared**: `dsh-api-gateway`, `dsh-user-approval`, `dsh-user-questions` | via dsh-base's exact deps | — | only `npm run check:fixture` fails loudly; the sweep is blind to them (A6; §7.4) |
| the CLI's boot chunk `boot.ts` mirrors | `lib/profile-boot-C14i-8IN.js` at 0.2.1-rc.5 (`lib/profile-boot-BZ2ZjNWi.js` at 0.2.0-rc.2; content-hashed, changes every release) | cited in `boot.ts` header, README "Upgrading dsh" step 4, `DEVELOPMENT.md` §4.1 and §6.7 | manual re-diff (A9), last 2026-11-02 |
| the global CLI `~/.local/bin/dsh` | 0.2.0-rc.2, installed 2026-10-01, **never run** (its first run would import `~/.dsh/settings.yaml` into its own profile); behind the face's pin now | — | D12, to re-take before the home moves (§6.4) |
| the operator's home `~/.dsh` | live on 0.2.0 since 2026-10-01 and NOT moved to 0.2.1-rc.5 yet; session format **v4** (unchanged at 0.2.1-rc.5); profile `face`; the `agent-default-model` row present (D2); the link farm deleted (D13) | backup `~/.dsh.bak-pre-0.2.0-20261001`; exports `~/dsh-session-exports-2026-10-01/` | the runbook §7 C checks, run 2026-10-01 |
| upstream | repo `deepseek-ai/deepseek-harness`, tag `dsh-v0.2.1-rc.5`; the meta package `@deepseek-ai/dsh`'s dist-tags (read 2026-11-02; the leaf packages' own `latest` tags are stale, read the meta package's): `latest` = `next` = 0.2.1-rc.5 (published 2026-10-29), `alpha` = 0.2.2-alpha.2 (2026-10-27, older than rc.5 and off its line) | — | §7.1 |

Three homes on disk and what each is for: `DEVELOPMENT.md` §1. The profile's operator rows
(the skill roots; the alpaca-kit MCP row left with the Python package on 2026-10-24) and the D2
model row: `dsh/README.md` "Installed state".

## 2. The procedure

Merged from `face/README.md` "Upgrading dsh — three pins, not one", `DEVELOPMENT.md` §6.7 and
§10 items 13–14, `dsh/README.md` step 2, and the go-live runbook
(`docs/superpowers/runbooks/2026-09-30-dsh-0.2.0-rc.2-go-live.md`; for the move to 0.2.1-rc.5,
`docs/superpowers/runbooks/2026-11-02-dsh-0.2.1-rc.5-go-live.md`, same sections). The numbering is the
inventory's PART 2, so a step can be cited.

**Read first**

1. Read the release before touching the tree: the new dist-tag version, the cordis peer range,
   the include peer, any new `dsh-session-format-vN-to-vN+1` package, dsh-base row renames or
   removals (`cordis.patch.yml`), the CLI's `profile-boot` rewrite. Trap: `gh release view`
   takes the TAG (`dsh-v0.2.1-alpha.3`); the release name alone answers "not found". Read the
   dist-tags of the META package `@deepseek-ai/dsh`; a leaf package's own `latest` is stale (it
   read 0.0.1-rc.x / 0.1.x on 2026-11-02), and an `alpha` tag can be older than `latest`.
   Diff the two installed trees' dsh-base `cordis.patch.yml` and each package the face imports
   (a scratch install of the whole set and a `tsc` of a copy of the sources against it found the
   0.2.1-rc.5 breaks in an hour; spec `docs/superpowers/specs/2026-11-02-dsh-0.2.1-rc.5-upgrade-design.md` §5).

**Freeze the home**

2. Stop everything on the harness home (`lsof`, `pgrep`), back it up
   (`cp -a ~/.dsh ~/.dsh.bak-pre-<ver>-<date>`, `diff -rq -x node_modules`, `.credentials.yaml`
   stays `0600`). The backup is stale the moment an older tool runs on the home again.

**Bump and prove offline** (`face/`)

3. Bump the pins together: `package.json` (every `dsh-*`, cordis, include, all exact) **and**
   `src/version.ts` (`DSH_PIN`, `CORDIS_PIN`, `CORDIS_INCLUDE_PIN`).
4. A fresh lockfile first: delete `package-lock.json` and `node_modules`, then `npm install`;
   the sweep reads the installed tree. An in-place `npm install` over the old lockfile failed
   `ERESOLVE` on the 0.2.1-rc.5 bump (the installed old packages' exact peers conflict). Commit
   the new lockfile; a fresh resolve also moves the three lockfile-only cordis plugins (A4).
5. `npm test`: `version.test.ts` fails first on any disagreement; `policy.test.ts` re-pins every
   policy target against the new dsh-base; `boot.test.ts` and `overlay.test.ts` re-pin the layer
   order and the thirteen overlay rows. Green is the precondition, not the evidence.
6. `npm run typecheck`: `skipLibCheck: false`, the overlay's `satisfies` checks against the
   plugins' own `Config` types, every named import (A11, A13).
7. Re-diff `src/boot.ts` against the CLI's current `profile-boot-*.js` chunk (`npm pack
   @deepseek-ai/dsh@<new>`, or the installed global CLI's `lib/`; at 0.2.1-rc.5
   `lib/profile-boot-C14i-8IN.js`, which moves the citation in four places, §1). The ten header divergences
   are deliberate; anything else is drift. Same pass: the `prepare` provides, `createAppReady`,
   the required-id set and the warn-only audit, `resolveTelemetryPatch`, the `hmr` and
   `settings` gating on `profileContext` (A9, B8, B10–B12).
8. Re-check the frame shapes: `client/js/wire/api.js`, `client/js/wire/mapper.js`, `tests/fixtures/events.jsonl`
   against the installed `.d.ts` of `dsh-api-gateway` (stream-protocol), `dsh-api-remotes`,
   `dsh-api-session-controller`, `dsh-session`, `dsh-llm`, `dsh-user-approval`,
   `dsh-user-questions`. The fixture is corrected by hand; there is no generator (E1–E9).
9. `npm run check:fixture`: the fixture through the installed dsh's own validators; a moved
   private path fails at load (E9).

**Prove on real boots**

10. `FACE_SMOKE=1 npm test`: the thirty-two real boots, **from a checkout outside `/tmp` and
    `$TMPDIR`** — dsh's `workspace-write` grants both, so a fence smoke there passes for the
    wrong reason (D24; `face/README.md` "Tests"; the room and bots fixtures refuse such a
    checkout, the desk, telegram, watch and schedule smokes do not check). A dropped
    `snapshotEvents()` fails Gate 2 and the room engine closed and loudly here (D7); a moved goal
    tool fails `goal-smoke` (C21). Leave `FACE_ACCOUNT_URL` unset for the suite: the Lunhui
    freeze tests reach the Account stand-in through it.

**Prove on a copy of the home** (never the live one)

11. Dry-run a COPY: `cp -a ~/.dsh $SCRATCH/dsh-dryrun`, `touch …/DRY-RUN-COPY`, `npx tsx
    scripts/check-home.ts $SCRATCH/dsh-dryrun` with `DSH_HOME` unset. Stop on exit 1, an
    `OTHER` refusal, any change under `sessions/`, or an MCP row still ENABLED. Delete the copy
    (it holds `.credentials.yaml`); re-run on a fresh copy after any profile edit (G11, I1).

**Decide**

12. Decide the operator decisions the new pin raises (§4), each a row in
    `~/.dsh/profiles/face/cordis.patch.yml` or a code change; refresh `PATCH_HEADER`'s prose
    in the installed patch file if the overlay's row set moved (B33).

**Rehearse on copies**

13. Rehearse the runbook §7 A checklist on a SECOND copy with the operator's MCP rows mounted
    (`DSH_HOME=$SCRATCH/dsh-drill FACE_PORT=3091 npm start`) — the README's role drill needs
    those rows too, so it runs here and not in step 14's fresh home — then delete it.
14. Run the README drills in a FRESH scratch home (`npm run setup`, `npm start` on 3092): Gate 2
    / approval channel (the approval card drill), ask-user, bots, room (§5).

**Go live**

15. Everything on `~/.dsh` stopped again; the backup re-taken or diffed; D12 settled; `cd face
    && npm start`; open the printed `?token=` URL; check the boot log's presets line and no
    warning (the presets line names the three `role-*` presets; no global `AGENTS.md` line on
    stderr, D25); `grep -c 'client-connection/browser-session' ~/.dsh/.credentials.yaml` = 1;
    `ls ~/.dsh/storages/session_projcache/sessions | wc -l` non-zero; a cold session opens with
    no `session.v4.jsonl.zstd` written; the agent panel shows the D2 model;
    `/data/plugins.json` lists the MCP servers mounted (the Account seat's `account` since
    2026-10-24), `ralph` registered and `working_directory` absent (D9, D19). Keep the backup until
    the live face is trusted. Before the first boot of a new pin, compare where the model key
    lives: since 0.2.1 a `refs` value in `~/.dsh/.credentials.yaml` beats the exported variable
    (I5).
16. Rollback = `mv ~/.dsh ~/.dsh.failed-<ver> && cp -a <backup> ~/.dsh`, then the OLD face only
    from an old checkout with its own `node_modules`. Never delete one session's v4 file and
    lock as a "rollback". From 0.2.1-rc.5 back to 0.2.0 it is lossy (D26): every rc.5 `bash`
    call writes event types 0.2.0 refuses, so what ran under rc.5 after the backup is lost.

**Document**

17. Update what cites the pin (none moves by itself): `version.ts` comments, the chunk name in
    `boot.ts` and in the three documents, `DEVELOPMENT.md` §4 header / §4.1 / §6.7 / §7.1 counts
    / Appendix A, `face/README.md` "Upgrading dsh" and "Tests", `dsh/README.md` "Installed
    state", `CLAUDE.md`, `ROADMAP.md`'s built log, `Gravit-Docs-and-Prompt-Loops.html` (the
    eyebrow and the loop diagram's box), `Gravit-Design.md`'s header when it is re-read, the
    runbook's expected-findings table, and §1, §6 and §7 of this file. The 2026-11-02 pass's grep:
    `grep -rn "<old pin>\|<old cordis>\|<old include>\|<old chunk hash>"` over those files and
    `face/src`, `face/scripts`, `face/plugins`; a hit is either dated history or moves.

## 3. What to re-check

### 3.1 By hand: the seams no test pins

These are the upgrade's real work. Everything else in §3.2 fails a test first.

| # | Re-check | Where | What moves it |
|---|---|---|---|
| A4 | the three transitive cordis plugins in the lockfile | `face/package-lock.json` | the Loader's row keying (last id wins), `group: true` nesting, `!!js` evaluation |
| A9 | `boot.ts` against the CLI's `profile-boot-*.js` (step 7) | `face/src/boot.ts` header | any new `provide`, required service or readiness rule boots a different tree with tsc green |
| B9, I7 | no proxy policy installed (D10); children still inherit `HTTP(S)_PROXY` | `boot.ts` divergence 3 | an upstream adapter that honours the variables on its own |
| B14 | `installFailLoud`, `StartupError`, the exit mapping | `face/src/main.ts` | a changed rejection or exit contract hangs or double-reports a startup failure |
| B15 | `process.chdir(<repo root>)`: SessionController's default dir and dsh-base's `sandbox-policy.workspaceRoot` both read `process.cwd()` | `main.ts`; installed `dsh-base/cordis.patch.yml` `sandbox-policy` | a config key for either, or a sandbox root off cwd (channel fencing changes) |
| B33 | `PATCH_HEADER` names every face-owned row and switch | `face/src/setup.ts` | the overlay's row set |
| D9 | `tools/execute` runs after the guard and re-resolves the tool by name (a gate, not containment) | `face/src/orders.ts` header | the recorded residual R2 changes if dispatch internals move |
| E12 | the face's own message sources survive the next format edge: `{kind:'room', …}` and the `@`'s `{kind:'user', mention:[…]}` | `face/src/room.ts` `say` | a v4→v5 edge enforcing key sets on known kinds refuses every room log with an `@` (§7.2) |
| G2 | stdio negotiation spawns a probe process before the serving one | behaviour | boot time and the mid-boot window |
| G3, H9 | a server's `instructions` become the unswitchable section `mcp:<server>`, seen by bots too; instructions over `maxInstructionBytes` fail the connection | behaviour; `face/src/akshare.ts` | a server whose instructions grow past the cap silently loses its tools |
| G7 | the MCP child's env is scrubbed (`KEY\|PASSWORD\|SECRET\|TOKEN`, `DSH_*`); the APCA keys ride the operator's row explicitly | `~/.dsh/profiles/face/cordis.patch.yml`; `dsh/README.md` step 5 | the account tools stop registering (7 tools, not 10), or keys leak into shell turns |
| G8 | `toolCallTimeoutMs: 300000` on the alpaca-kit row (a cold `screen` runs ~188 s; the 60 s default kills it) | the operator's row | a renamed key restores the default silently |
| G10 | the MCP server is a child of the face process; its writes bypass the sandbox | behaviour | residual R5 if dsh starts sandboxing MCP children |
| G12 | FastMCP (`mcp` 1.x) negotiates with dsh's `@modelcontextprotocol/client` 2.0 | `alpaca_kit/mcp/server.py`; the akshare-mcp install | both servers silently register zero tools (G4) |
| H2 | `SKILL.md` frontmatter `name` + `description`, or discovery drops the skill at warn level | `dsh/skills/*/*/SKILL.md` | a new required key empties the catalog with no error |
| H6 | the `agent-instructions` row's user-global files, outside the candidate lists the face sets: since 0.2.1 TWO, always read and never switchable by a row — `$DSH_HOME/AGENTS.md`, then `<agents home>/AGENTS.md` (`$DSH_AGENTS_HOME` or `~/.agents`, `resolveAgentsHome`); the per-row `dshHome` is gone | installed `dsh-agent-instructions`; `@deepseek-ai/dsh-home-paths` `resolveAgentsHome`; the candidates and the budget are the face's own patch, `face/src/instructions.ts` (H10); the boot audit `globalInstructionFiles` in `face/src/boot.ts` (D25) | a third root, a row switch (the face could then refuse instead of report), or `skill-filesystem` no longer reading `DSH_AGENTS_HOME` (the face could then pin it) |
| I5 | credential precedence: since 0.2.1 a `.credentials.yaml` `refs` value wins, then the launch environment, the project `.env`, the home `.env` (0.2.0: the inherited environment first); headless profiles keep the environment first | installed `dsh-credentials-local` README; `boot.ts` `loadLayeredEnv`; the operator's shell | a stored key shadows the one the operator sources: the go-live compares the two before the first boot (§2 step 15) |
| I12 | state outside `~/.dsh` and the repo is `tmpdir()` scratch only | `agents.ts`, `alpaca_kit/mcp/cache.py` | a new state directory the backup misses |
| — | the MCP server name, as a role would spell it: every `mcp__<server>__…` in `roles/*/role.yml` must equal `mcp__<serverName>__…` for the row that mounts it — the face's own `mcp-account` row mounts `account` (a role may not carry its tools: the never-list), an operator row its own `serverName`. No shipped role names an MCP tool today (they name `skill` and the Lunhui tools). Until 2026-10-24 this was the operator's `alpaca-kit` row | `face/src/account-seat.ts` (`ACCOUNT_SEAT_SERVER`); `~/.dsh/profiles/face/cordis.patch.yml` for an operator row; `roles/*/role.yml` | a renamed server, or a dsh that mints MCP tool names differently: each call of a role that names the missing tools is refused by the face's role tool — `role role_<id>: the tree has no tool …; no child was created` (K1) — and a role NONE of whose tools exists lists its `role-<id>` preset broken and refuses the boot (K2). At 0.2.0 the same rename failed each delegation at `tools.restrict()` and never the boot |
| — | the MCP live roster: `/data/plugins.json` lists `account` with the seat's 36 tools (`face/README.md` "The Account seat"); dated: `alpaca-kit active 10`, `akshare active 14` until those rows left the face (2026-10-24, 2026-11-01) | runbook §7 A | the only visible sign of G4 |
| J1 (2026-10-26) | the Lunhui rows' tools are `defineTool` objects from `@deepseek-ai/dsh-tools` (declared exactly in `face/package.json`): `parameters` as `{type, description, required?}` per key, `output.schema`, `execute(args, exec)`; a thrown `LunhuiError` reaches the model as `Error: <CODE> …` | `face/plugins/lunhui/runs-row.mjs`, `lib/freeze-tool.mjs`, `lib/module-tool.mjs` | a changed parameter grammar, a required-key spelling or a different error-to-text mapping: `lunhui-rows`, `lunhui-module-tool` and `smoke` (the seventeen tools registered) fail first, but the `Error: ` prefix the role personas and the protocol rely on is pinned only by the module tests' message matches |
| J2 (2026-10-26) | the backbone `ctx.provide("lunhuiRuns", service)` under `ctx.effect`, and ten rows `inject = ["tools", "lunhuiRuns"]` as a required service: without the backbone a row stays pending and the strict row audit refuses the boot | `face/plugins/lunhui/*-row.mjs`; `boot.ts`'s audit | a cordis that resolves an unprovided required service differently (a silent skip instead of pending) mounts rows with no service; the boot refusal is reasoned from the audit's code and not pinned by a boot (`DEVELOPMENT.md` §4.3) |
| J3 (2026-10-26) | the caller gate reads `exec.agent.session.header`: `origin === "subagent"` and not `isSeeded` is a delegated child (`NOT_GRAVIT` on a freeze), and the same predicate — since 2026-11-02 with `agentPreset` starting `role-` (K2) — admits a module submit (`NOT_A_ROLE` otherwise, A23) | `face/plugins/lunhui/lib/errors.mjs` `callerIsChild`, `callerIsRole` | a header that renames or drops `origin` or `isSeeded`, or an `exec` without `agent.session`: every submit refused, or every freeze admitted from a child; `roles-smoke` (a role child's submit lands, Gravit's is `NOT_A_ROLE`) fails first under `FACE_SMOKE=1` only |
| J4 (2026-10-26) | a module context is at most 30 KiB of UTF-8 JSON (A24), under dsh-base's spill cap `maxInlineTokens: 12500` (D18): a role has no file tool to read a spilled result | `face/plugins/lunhui/lib/contract-core.mjs` `MAX_CONTEXT_BYTES`; installed `dsh-base/cordis.patch.yml` `spill-policy` | a lower spill cap, or one counted in another unit, spills a maximal context (the mode's reads 30,233 bytes at every input's maximum) and the role sees a preview; no test boots a maximal context through the spill policy |
| J5 (2026-10-26) | the Lunhui rows compose as eleven file-plugin rows by absolute `file:` URL in one insert after the seat; `bootFace` structured-clones every patch, so a row's config carries data only (a freeze row's test `now` cannot cross, hence the smokes' `Date` shift) | `face/src/lunhui.ts` `lunhuiPatches`; `tests/boot.test.ts` | a Loader that resolves `file:` names differently, or keeps functions in config, changes what a patch can carry; `boot.test.ts` pins the insert |
| K1 (2026-11-02) | the role tool over `ctx.subagents.startActivation({provider: "spawn", label, request: {prompt, parent, agentPreset, agentOptions?, maxDepth}, signal, delivery: "caller"})`, awaiting `activation.result` (`stopReason`, `output`, `diagnostic`) and disposing it on every path; `getProvider`, `resolveMaxDepth`, `llm.resolveCallConfig`; `isConcurrencySafe: false` | `face/plugins/role.mjs` (D20); `tests/role-plugin.test.ts` offline over a fake, `roles-smoke` on a real boot | `delivery: "caller"` removed or renamed: D20 is re-taken (the role call would turn into a notice-reporting delegation, `DEVELOPMENT.md` §4.8); a changed result shape or stop-reason set; a service that starts preflighting routes (the face's check then doubles) |
| K2 (2026-11-02) | the role presets `role-<id>` declared after boot through the preset registry (eager activation; `bot.js` throws at a mount where none of the names exists, listing the preset broken), resolved by the request's `agentPreset` at the call; a role child's header names the preset | `face/src/roles.ts` `rolePresetDefinition`, `roleRosterProblem`; `face/src/bot-presets.ts` `declarePreset`; `plugins/lunhui/lib/errors.mjs` `callerIsRole` (the `role-` prefix) | a header that stops carrying `agentPreset` for a delegated child: every Lunhui submit is `NOT_A_ROLE` (`lunhui-rows.test.ts` pins the predicate; `roles-smoke` the live header) |
| K3 (2026-11-02) | dsh-base's `remote-access` row (method-level access control for non-owner peers): the cookie-signed browser is the owner and never checked; its HTTP calls and WebSocket share one peer | installed `dsh-api-remote-access`, `dsh-api-gateway` (upstream `rpc-host.ts`); no face row (D23) | a gateway that starts checking the owner, or splits the browser's two transports into two peers: every Remote the client calls would need a grant (`client-mux-smoke` fails first) |
| K4 (2026-11-02) | `session/projections` answers a kinded `SessionProjectionsValue`: `{kind: "sequenced", asOfSeq, values}`, `{kind: "migration-required", values}` (no `asOfSeq`), or `null`; `SessionSummary.formatStatus?` | `face/client/js/wire/summaries.js` `readProjections`, `summaryOf`; `js/host/live.js`; `js/wire/member-traces.js` | a fourth kind, or `asOfSeq` moving: a cold session fails to open (`summaries.test.ts`, `live.test.js`, `member-traces.test.ts` on the shapes; `client-mux-smoke` on a real host) |
| K5 (2026-11-02) | the temp-root precondition: dsh's `workspace-write` grants the session cwd, `/tmp` and `os.tmpdir()` by real path (`dsh-sandbox` `writableRoots`), so the fence smokes prove nothing from a checkout under either | `face/tests/fixture-root.ts` `assertOutsideTempRoots` (room and bots fixtures; D24); `face/README.md` "Tests" for the desk, telegram, watch and schedule smokes | `writableRoots` gaining or losing a root; a new fence smoke that does not call the guard |
| K6 (2026-11-02) | the webserver bind: any concrete address; every wildcard refused at load (`webserver` a required startup id); `port` `number \| undefined` before listen | `face/src/overlay.ts` `faceBind`; `face/docker-entrypoint.sh` (the container's own address); `tests/bind-smoke.test.ts`; `tests/remote.ts` `boundPort` | a webserver that admits the wildcard again (`bind-smoke` fails), or one that refuses the container's address |
| L1 (2026-11-04) | the dsh UI port's host facts the page's composer and attachments rest on: `commands/list` and `commands/execute` resume a cold session (the mounted `dsh-api-session-controller` sets the gateway's agent lookup to find-or-resume), and so does `POST /api/session/uploadFileBinary` (its `registerAgentResolver`); `session/prompt`'s `{type: 'image', mediaType, data, name}` and `{type: 'file', receiptId}` parts and `commands/execute`'s `submittedAttachments`; the refusals `session/attachment-invalid` with `details.reason` `FILE_NOT_STAGED` and `MODEL_DOES_NOT_SUPPORT_IMAGES`; a command's admission failure settled as `{kind: 'error', text}` whose dropped-receipt text is exactly `File upload receipt is unknown for this session.` (`dsh-commands` `admitCommandAttachments`); `session/projections`' `imageLimits`; `session/attachment`'s `{attachment, data}`; the stored `{type: 'image', attachment: {attachmentId, …}}` block | `face/client/js/host/actions.js` (`RECEIPT_UNKNOWN`), `js/host/attachments.js`, `js/composer/files.js` (`DEFAULT_LIMITS`, `contentParts`), `js/wire/api.js` (`uploadFile`), `js/wire/mapper.js`, `js/host/composer.js` (the `live` guard PLAN D16 rests on); `face/tests/dsh-ui-port-smoke.test.ts` (seventeen tests, `FACE_SMOKE=1` only; the upload route's resume is read, not booted) | a reworded receipt text: a command's dropped receipt is no longer uploaded again (the draft is still kept; `dsh-ui-port-smoke` fails first); a dsh that stops resuming a cold session for `commands/list`: opening the `/` menu still never activates (the `live` guard), but a cold conversation's command then needs the follow `live.activate` opens; a changed part, refusal code or block shape: the attachments tests offline and the smokes |
| L2 (2026-11-04) | the dsh UI port's host facts the page's thread rests on (plan 5): `session/follow`'s snapshot `{header, cursor, records, hasMore, projections}`, its records the tail window cut at 50 messages (`DEFAULT_MAX_MESSAGES`); `session/page`'s `beforeSeq` exclusive (`paginate`: the slice ends at `min(throughSeq + 1, beforeSeq)`, cut at a message group's earliest source) and `{records, hasMore}`, never activating; `turnOutline` (`[{turn, seq, prompt, response}]`, `prompt` ≤ 50 and `response` ≤ 120 characters with a `…`) and `sessionStats` (`{turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens}`) in `session/projections` and as `session/control` `projection` frames; the `job` namespace's `{request}` wire — `job/list` `rows` frames (the whole set: the session's own and every unowned job), `job/follow` `opened` / `output {chunks, next, lossy?}` / `status` with byte offsets, `job/kill` `{outcome: 'requested' \| 'already-finished'}` (a second kill of a settled job answers `already-finished` at rc.5) — and `dsh-tool-bash`'s `detail` strings the end line parses (`exit code: N`, `signal: X`, `killed before exit`, `; ` before the notes, `cancelled by the user` on a human kill) | `face/client/js/host/live.js` (`applySnapshot`, `earlier`, `EARLIER_PAGE`), `js/reducers/host.js` (`hostWindow`, `hostEarlier`, `hostProjection`'s shape checks), `js/host/turns-view.js`, `js/host/jobs.js`, `js/host/jobs-view.js` (`endLine`); `face/tests/dsh-ui-port-smoke.test.ts` (twenty-one tests, `FACE_SMOKE=1` only) | a follow snapshot without `cursor` or `hasMore`, or a changed window: no Earlier messages, or a page asked against the wrong cut; a `beforeSeq` made inclusive: one message drawn twice is still deduped by seq, but a changed cut can leave a gap; a reshaped outline or stats entry: `hostProjection` drops it and the rail or the pills go blank, never wrong; a reworded `detail`: the end line falls back to `exit` or `killed`; a changed job frame: `host-jobs` offline and the smoke's job test fail first |

### 3.2 By test: the pinned seams and what fails first

Each row: the seam, the file that pins it. Depth: the inventory's row, `DEVELOPMENT.md` §4.1
(boot), §4.3 (overlay and policy; the cycle section, C21), §4.7 (Gate 2), §5.2 (the wire), §6.8
(rooms), §3.7 (bots), §3.8 (roles, C20).

**A · pins and install.** A1–A3 the three constants vs manifest vs installed tree
(`version.test.ts`); A5 the retired packages never declared (`version.test.ts`); A6 the
fixture validator's private paths (`check:fixture`); A7–A8 the install anchor, `PluginPackages`
and its native addon (every `FACE_SMOKE` boot); A10 the profile manifest and patch-file shapes
`setup` writes (`setup.test.ts`); A11 the `satisfies` contract (tsc); A12 the structural `*Like`
types hide drift from tsc, so the real boots (thirty-two since 2026-11-02) are the contract; A14 `FiberState.ACTIVE`
as the literal `2` (`smoke.test.ts`, `panels.test.ts`); A15 Node 22's `zstdDecompress`
(`sessions.test.ts`).

**B · boot and composition.** B1 the layer order ending with the face overlay (`boot.test.ts`);
B2 `<profile>/cordis.yml` rewritten to `[]` every boot (`boot.test.ts`); B3 a skipped bundle
refused (`boot.test.ts`); B4 the telemetry switch (`boot.test.ts`, `policy.test.ts`); B5 `hmr`
disabled (`boot.test.ts`); B6 the persona patch restating every inherited `system-prompt` key
(`boot.test.ts`, `bot-plugin.test.ts`); B7 the strict template over the variables the loop
registers — `{{provider}}`/`{{model}}` since 0.2.1, whose loop dropped `{{cwd}}` (D21;
`persona.test.ts`); B8 no `profileContext` (`bot-runtime-smoke`, `subagents-smoke`); B10 what
`prepare` provides (every boot); B11 `appReady` last, unary `/api` live mid-boot
(`smoke.test.ts`, `order-gate-midboot-smoke`); B12 every enabled entry ACTIVE
(`smoke.test.ts`); B13 the four required service keys (`smoke.test.ts`); B16 `bootFace`
materializes `$DSH_HOME` once per process (`boot.test.ts`); B17 exactly thirteen overlay rows in
order, the thirteenth `preset-kairos`, the alias of the default (`overlay.test.ts`); B18 the four
storage rows composed once, from dsh-base (`boot.test.ts`); B19–B23 each overlay row's config and
inject (tsc, `overlay.test.ts`, every boot); B24–B30 the policy rows D3–D7, D9 and D19, each pinned
against the installed dsh-base — eight id patches and one insert of two rows since 0.2.1, `ralph`
an insert of the standalone package (`policy.test.ts`, `smoke.test.ts`); B31 the policy guard reports a
missing target on stderr (`policy.test.ts`); B32 the `extraPatches` seam the dry run uses
(`check-home.test.ts`); B34 every dsh-base row the face addresses by id (`boot.test.ts`,
`policy.test.ts`).

**C · agent plane.** C1 the registry row and its `Pick<Config, "default">` (tsc,
`overlay.test.ts`); C2 `defaultId` = the default preset (every boot refuses otherwise); C3 the
static default-preset row present before the first `session/create` (`boot.test.ts`,
`bots-smoke`); C4 `definitionFor`'s rebasing onto the bot directory (`bot-presets.test.ts`,
`bots-smoke`); C5 declarations after boot, eager activation, dispose-then-declare
(`bot-presets.test.ts`, `bot-runtime-smoke`); C6 the scoped `deployment:persona-prefix`
section shadowing the global prefix (`bot-plugin.test.ts`, `bots-smoke`); C7 `tools.restrict`,
the unmasked `schemas()` view, re-expansion on `tools/change` (`bot-plugin.test.ts`,
`bots-smoke`); C8 `mcp__*__<raw>` expansion (`bot-plugin.test.ts`); C9 `DEFAULT_ALLOW`'s names
(`bots-smoke`); C10 `renderComposition`'s two rows (`bots.test.ts`, `bot-presets.test.ts`); C11
the bot-id grammar (`botId.test.ts`); C12 `stateOf(session, "agentPreset")`
(`bot-runtime-smoke`, `room-engine.test.ts`); C13 `agent/created`, `system-prompt/assemble`,
`agent/request`, `requestHeader()` (`bot-runtime-smoke`); C14 the journal as a runtime-context
snapshot (`bot-runtime-smoke`); C15 `agentPresets/read` and `/select` exist and are not called
(`bot-runtime-smoke`); C16 `SessionHeader` fields (`bots-smoke`, `room-smoke`,
`channels.test.ts`); C17 the subagent plane the client composes: relays, catalog, interrupt
(`subagents-smoke`, `subagents.test.ts`, `mapper.test.ts`); C18 the default model route and
`installModelSelection` (`room-engine`, `room-smoke`, `bot-runtime-smoke`); C19 `tool-ask-user`
configless = the blocking `legacy` mode (`smoke.test.ts`); C20 the role library — until
2026-11-02 per-role `dsh-tool-subagent` rows (`provider` / `toolName` / `backgroundMode` /
`persona` / `toolFilter`, which 0.2.1 refuses at load); since, one `plugins/role.mjs` row per role
inside the default preset (`{tool, name, summary, agentPreset, allow, model?}`) and one
`role-<id>` preset per role declared after boot (the `gravit` row with `{}` and `bot.js` with
the persona and the mask), a missing or broken one refusing the boot (`roles.test.ts`,
`role-plugin.test.ts`, `roles-smoke`; §3.1 K1, K2); C21 the goal loop `cycle.md` rests on: `create_goal` (accepted
in a direct human turn; refused, `GOAL_ALREADY_EXISTS`, while a goal that is not complete
exists) and its `max_goal_rounds`, the `<goal_round>` message the driver queues at idle (source
`goal`, `Round: n/N`),
`update_goal`'s `action: resume` (accepted only in a direct human turn, refused for a paused goal
with `GOAL_TOOL_RESUME_PAUSED`) and `blocked_reason` (refused before round
`blockedAfterConsecutiveRounds`, 3, then the code `model-reported` and the `<goal_blocked>`
wrap-up), the driver's silent `round-limit`, Stop pausing the goal and `/goal resume` re-arming
it, a restart disarming it until "continue" (`goal-smoke`, the fifteenth real boot — which also
pins plan 3's Review Focus 3, the early-block refusal, that the plan left to the drill).
`cycle.test.ts` pins `max_goal_rounds 24`, `12 role calls`, `update_goal with action resume` and
the blocked vocabulary in `cycle.md`'s text; a real model's use of the loop is the cycle
drill's, and the re-check at a pin is §7.3's.

**D · gates and approvals.** D1 the prepended `tools/pre-execute` ask (`order-gate.test.ts`,
`orders.test.ts`); D2 the monotonic `tools.guard` reading the live description
(`order-gate.test.ts`, `order-gate-smoke`); D3 both halves armed inside `prepare` as inject
fibers (`order-gate-midboot-smoke`); D4 the effective approval policy reproduced from public
halves (`orders.test.ts`, `order-gate.test.ts`); D5 `never` denies in the gate's own words
(`orders.test.ts`); D6 the grant is the paired `approval/asked` + `approval/decided
allowed-once` in the log (`orders.test.ts`, `order-gate-smoke`, `smoke.test.ts`); D7
`snapshotEvents()` deprecated, the grant index its named successor (`orders.test.ts`,
`order-gate.test.ts`, `room-engine.test.ts`); D8 the `(operator-gated)` marker and the raw-name
suffix under dsh's `mcp__<server>__<raw>` minting (`orders.test.ts`, pytest); D10 an approval
needs an open turn (the four smokes); D11 `api-remotes` the sole `$events` source
(`smoke.test.ts`, `askuser-noclient-smoke`); D12 pending-gate replay, winner-never-cancelled,
late answers (`api.test.ts`, `client-mux-smoke`); D13 the client's answer vocabulary
(`api.test.ts`); D14 questions answered with the whole batch, agentless asks `NO_PROVIDER`
(`askuser-noclient-smoke`, `client-mux-smoke`); D15 `ask_user_question` in the live registry
(`smoke.test.ts`); D16 sandbox escalations as the other card producer, refusals inside tool
content (`bot-sandbox-smoke`, `mapper.test.ts`); D17 the `read-only` pin inside `setup` before
`session/created` (`room-smoke`, `room-engine`); D18 approval events in the catalog, questions
as plain tool pairs (`room-engine.test.ts`).

**E · sessions and the wire.** E1 the unary envelope and its refusals (`api.test.ts`,
`smoke.test.ts`); E2 every Remote method the page calls and its argument shape
(`client-mux-smoke`, `subagents-smoke`); E3 the `/api/remote.mux` frames (`api.test.ts`,
`client-mux-smoke`); E4 the `$events` stream, `ready` first (`api.test.ts`,
`client-mux-smoke`); E5 `session/control` projections (`client-mux-smoke`, `mapper.test.ts`);
E6 `session/follow` snapshot then gap-free events; a follow activates a cold session
(`client-mux-smoke`); E7 the two non-activating reads, `session/projections` kinded since 0.2.1 (§3.1 K4;
`client-mux-smoke`, `subagents-smoke`, `member-traces.test.ts`, `summaries.test.ts`); E8 the v4 event shapes the mapper renders (`mapper.test.ts` on
`tests/fixtures/events.jsonl`, `check:fixture`); E9 the fixture validator (`check:fixture`);
E10 the on-disk format grammar, generations, lease, zstd frames (`sessions.test.ts`,
`check-home.test.ts`); E11 the migration edges and their refusal names (`room-engine`,
`check-home.test.ts`); E13 `sessionPersistence.list()` returns snapshots (`channels.test.ts`,
`room-engine`); E14 `agentPreset` rides the projection block (`summaries.test.ts`,
`channels.test.ts`, `room-smoke`); E15 the per-record projection cache (`room-smoke`); E16 the
projection-unit registration shape (`room-projection.test.ts`); E17 the browser-session cookie
on `/` and the Host/Origin fence (`smoke.test.ts`, `static.test.ts`); E18 the credentials store
record (`smoke.test.ts`, runbook §7 C); E19 the `/data` trust fence (`data.test.ts`); E20 the
webserver route contract (`static.test.ts`, `smoke.test.ts`); E21 reconnect re-opens every
stream (`api.test.ts`); E22 client-minted `requestId` (`api.test.ts`); E23 no session DELETE
Remote, the host archive 409 (`sessions.test.ts`); E24 the workspace registry service
(`channels.test.ts`, `room-smoke`); E25 `/data/host.json` (`panels.test.ts`); E26 the plugin
panel from `loader.entries()` (`panels.test.ts`).

**F · rooms.** F1 member create/resume with `setup(agentCtx, agent)` before announcement
(`room-engine`, `room-smoke`); F2 the host's `composeAgent` restated: model selection, preset
join, read-only pin (`room-smoke`); F3 cold rooms resumed through `sessionController.resolveAgent`
(`room-engine`, `room-smoke`); F4 the root `session/event` bus, `followup`, `cancel` with
`keepInbox`, `append` with `surfaceOp` (`room-engine`, `room-smoke`); F5 `createUserMessage`
(`room-smoke`); F6 the tool-definition shape for `dispatch` and `agent_<bin>` (`room-engine`,
`agents.test.ts`, `panels.test.ts`); F7 `dispatch` refused for a session that runs a bot
(`room-engine`); F8 member discovery from persisted snapshots, resume-not-recreate
(`room-engine`); F9 room facts on known event types only (`room-projection.test.ts`,
`room-smoke`); F10 a member's pending gate read off its log (`room-engine`); F11 the channel's
instruction chain reaches a member (`room-smoke`; landed in plan 1 as the `GRAVIT.md` chain,
`dbbd19a` and the patch `8983555`); F12 members attached to the channel workspace (`room-smoke`);
F13 the legacy-format wording matched by error name (`room-engine`); F14 the caps sentence
generated from `ROOM_CAPS` (`room-rules.test.ts`).

**G · MCP.** G1 the stdio row config keys (tsc, `boot.test.ts`, `check-home.test.ts`); G4
`failOnStartupError: false` leaves a dead server's row ACTIVE with no tools
(`order-gate-midboot-smoke`; runbook §7 checks); G5 `mcp__<server>__<raw>` minting and hashing
(`orders.test.ts`, `bot-plugin.test.ts`); G6 mcp-client hard-injects only `tools`, which makes
D7 safe (`policy.test.ts`, `smoke.test.ts`); G9 Gate 1 in the MCP child's env only, the marker
on both order tools (pytest, `order-gate.test.ts`); G11 the dry run disables MCP rows by package
and id (`check-home.test.ts`).

**H · skills and instructions.** H1 the operator's `skill-filesystem` patch and the bots' own
`skills` row (`bot-presets.test.ts`); H3 the skill-name grammar (`panels.test.ts`); H4 the
in-process `ctx.skills` service shapes (`panels.test.ts`); H5 `tool-skill` loads one `SKILL.md`
by catalog name (`smoke.test.ts`); H7 the prompt sections the face relies on:
`deployment:persona-prefix`, `mcp:<server>`, the `bot-journal` context (`persona.test.ts`,
`bot-plugin.test.ts`, `bots-smoke`, `bot-runtime-smoke`); H8 the system prompt as the leading
`role:'system'` message, `request/header` as the durable proof a tool was offered
(`bot-runtime-smoke`, `room-discussion-smoke`); H10 the face's instructions patch: the two
candidate lists the face's over the inherited config, an operator's other keys and `disabled`
kept, no row and no patch (`boot.test.ts`, `instructions-smoke`); H11 the face's three section
registrations: `face/plugins/gravit.js`, the first row of the default preset's rendered
composition (`bots/gravit/agent.cordis.yml` is its mirror), registers `deployment:today` at
`getSectionOrder("DEPLOYMENT_PERSONA_PREFIX") + 1` with `interpolate: false` and a function text
re-evaluated at each assembly, in UTC when `TZ` is unusable, `gravit:roles` at
`getSectionOrder("TOOL_SUBAGENT") + 1`, listing only the roles whose tool the assembling scope
resolves (`ctx.tools.get(name, context.scope)`, the gate `dsh-tool-web` and
`dsh-tool-subagent` put on their own sections, so the plugin rests on `get` applying a scope's
restrictions and on `assembleContextFor` setting `scope` to the agent), and `gravit:cycle` at
`getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 50` with `interpolate: false` (the file's braces
stay literal), the contract when the assembling scope resolves `create_goal` AND the session is a
root or a fork (`origin !== "subagent" || isSeeded`; §7.3), nothing otherwise, so Gravit's
sessions and a `subagent_fork` child's read the same text, a plain `subagent` child's none, and a role
child's reads none; all three are scoped to the preset revision so a bot's prompt carries none
(`gravit-plugin.test.ts`: order, which must be finite, shape, unload, the `TZ` fallback, the
roles section's order, lines and visibility cases, the cycle section's order, literalness, gate
and unload; `bots-smoke`: Gravit's prompt has the date and the cycle contract, a bot's neither;
`roles-smoke`: Gravit's has the roles section and the cycle contract, a role child's has the date
and neither, a `subagent_fork` child's system text equals Gravit's, the cycle contract included).

**I · environment and home layout.** I1 `DSH_HOME` resolution and the dry run's live-home
refusal (`check-home.test.ts`, `boot.test.ts`); I2 `DSH_PERMISSION_MODE` and `danger-full-access`
= approval `never`, which does not disarm Gate 2 (`orders.test.ts`); I3 `DSH_TELEMETRY_DISABLED`
and dsh-base's own `DSH_TELEMETRY_MODE` (`boot.test.ts`, `policy.test.ts`); I4
`DSH_WEB_FETCH_PROVIDER`, the `web` row's fallback (`policy.test.ts`); I6 the face's own
variables (`setup.test.ts`, `data.test.ts`); I8 the local-agent child scrub (`agents.test.ts`);
I9–I10 every file under `$DSH_HOME` the face reads and writes (`sessions.test.ts`,
`roster.test.ts`, `check-home.test.ts`; runbook §5); I11 the 0.1.1 ↔ 0.2.0 home hazards
(`check-home.test.ts`).

## 4. Decisions to re-take at every pin

The 0.2.0 re-host's D1–D18 and the 0.2.1-rc.5 upgrade's D19–D27 (`DEVELOPMENT.md` writes them
`PLAN D<n>`; the charter's own D19–D28 are the desk's and another series), one line each with
what to re-check (`DEVELOPMENT.md` §4.8 is the table with the defaults and the way to choose
otherwise; `face/src/policy.ts` names D3–D7, D9 and D19 by id).

| # | Decision | Re-check when |
|---|---|---|
| D1 | no `profileContext` (no settings forms, no persisted model save, no hmr, no plugin manager) | upstream makes it required or un-gates `settings` (B8) |
| D2 | the default model is the operator's `agent-default-model` row | the DeepSeek catalog renames a model id (C18) |
| D3–D5 | telemetry, session-log upload, package inventory off | a policy target row is renamed: the face warns on stderr and the egress is ON (B24–B26) |
| D6 | `web_fetch` off, both configs written out in full | a new key on `tool-web` or `web` is dropped by the full-config patch (B27) |
| D7 | MCP resource tools off | mcp-client starts hard-injecting `mcpResources` (B28, G6) |
| D8 | the browser cookie only on `/` and `/api` | upstream's static posture changes (E17) |
| D9 | `ralph` kept — since 0.2.1 an INSERT of the standalone `@deepseek-ai/dsh-tool-ralph` with `{subagentProvider: spawn, maxRounds: 64}` (re-taken 2026-11-02); `str_replace_editor` inserted | dsh-base shipping either row again skips its insert (B29–B30); the standalone package no longer published or its injects (`workflowEngine` among them) leaving dsh-base: retire `ralph` (one commit) |
| D10 | no proxy policy | an adapter honours proxy variables on its own (B9, I7) |
| D11, D17 | the fourteen unreadable 0.1.1 sessions stay on disk, reported | a new migration edge, or an upstream fix for the descriptor-v2 refusal (E11) |
| D12, D13 | no older tool on the written home; the link farm deleted | every pin: the same hazard class between 0.2.0 and 0.2.x tools sharing a home (I11) |
| D14 | un-archiving a host archive refused | a session DELETE or unarchive Remote appears (E23) |
| D15 | telemetry opt-in is one operator row; the env switch still wins | the switch order in `composeFace` (B4) |
| D16 | a cold session opens page-only | `session/follow` or `session/page` activation semantics (E6–E7) |
| D18 | the spill budget stays dsh-base's `maxInlineTokens: 12500` | the row's key or default moves (B34) |
| D19 | `working_directory` off by the policy layer; the `working-directory` service and its context stay | the tool renamed or folded into another row (the policy guard warns on stderr); a contract that wants agents to move their cwd |
| D20 | one preset per role and the face's own blocking role tool over `startActivation` with `delivery: "caller"` | caller delivery removed or renamed upstream (§3.1 K1): then dsh's own tool with notices, and the run and module protocols gain wait rules |
| D21 | the persona names no directory; the `working-directory` context does | the loop registering a `cwd` variable again (harmless), or the context leaving dsh-base (then the model loses its directory) |
| D22 | `web-deepseek-api` mounted, unselected | the `web` row's defaults selecting its providers, or a new key on `tool-web`/`web` that D6's full restatements drop (B27) |
| D23 | `remote-access` is dsh-base's; the browser is the owner | access control reaching the owner (§3.1 K3) |
| D24 | the real boots run outside `/tmp` and `$TMPDIR`; the room and bots fixtures refuse otherwise | `writableRoots` changing (§3.1 K5); every new fence smoke calls the guard |
| D25 | a global `AGENTS.md` reported at boot, never overridden | a row switch for the global roots, or `skill-filesystem` no longer sharing `DSH_AGENTS_HOME` (H6) |
| D26 | the rollback from rc.5 to 0.2.0 is lossy; the backup is the way back | every pin: which new event types the old version refuses (a new format edge changes the answer) |
| D27 | dsh's own `subagent` / `subagent_fork` follow upstream (an id at once, a settlement notice, the fork continuable) | a drill showing Gravit relying on a blocking fork, or upstream adding a durable parent mailbox (then a dropped notice stops being a loss) |
| spec B8 | the cycle caps are `cycle.md`'s, not a dsh config: 24 rounds is the `max_goal_rounds` the contract passes to `create_goal`, 12 role calls a count Gravit keeps in the journal (charter D16, `DEVELOPMENT.md` R29) | dsh adds a per-session child total, or a dsh-side cap that overrides the model's `max_goal_rounds` argument (`dsh-goal`'s `defaultMaxGoalRounds`, 256, applies only when the argument is absent); the first overrun |

Decisions the 2026-10-15 agent redesign adds land here with their plans (§7.3).

## 5. Drills

Every drill named in `face/README.md` and `DEVELOPMENT.md` §7.4, with its runner and its state
at this pin (**automated** = a test; **manual** = a procedure with a recorded pass; **owed** =
named as still to run on 0.2.0).

| Drill | Runner | State |
|---|---|---|
| the upgrade drill (§2 steps 3–10) | tests and two manual re-diffs | last run 2026-11-02, to 0.2.1-rc.5 (§6.4); before, 2026-09-30 |
| the home dry run (§2 step 11) | `scripts/check-home.ts` on a copy; `check-home.test.ts` | run 2026-09-30 on a copy; fixture-verified (runbook Appendix A); at 0.2.1-rc.5 **owed**, the operator's (expected: the same fourteen refusals, §6.4) |
| Gate 2 / the approval channel | automated: `smoke.test.ts`, `client-mux-smoke`, `order-gate-smoke`; manual steps 1–7 | automated passes; deny half ran live 2026-09-30 on a scratch home; the approve half and the three card endings **owed** in a browser |
| order approval, automated half | `order-gate.test.ts`, `order-gate-smoke`, `order-gate-midboot-smoke` | passes; mutation-proven |
| order approval, manual half (a person reads the card against armed tools in a scratch home) | README steps 1–6 | **owed on every pin so far**; charter D3; the condition before the flag ever flips in `~/.dsh` |
| ask-user | automated: `smoke.test.ts`, `askuser-noclient-smoke`, `client-mux-smoke`; manual steps 1–7 | automated passes; manual **owed** on 0.2.0 (the instruction half never run) |
| client transport, automated | `client-mux-smoke`, `api.test.ts`, `mapper.test.ts`, `subagents.test.ts` | passes |
| transport, manual (sign-in, cold page-only, restart, `/compact`, agent panel, subagent dock, rename, fork, picker) | a browser | 2026-09-30 covered sign-in, cold page-only, restart, new session, agent panel; `/compact`, subagents, rename/fork/picker **owed** |
| bots, automated | `bots-smoke`, `bot-runtime-smoke`, `bot-sandbox-smoke`, `askuser-noclient-smoke` | passes |
| bots, manual (create, home conversation, tool list, `{{` refused, soul edit without restart) | README steps 1–7 | **owed** on 0.2.0 (last passed 2026-09-08 on 0.1.1) |
| room, automated | `room-smoke`, `room-discussion-smoke` + the offline room suites | passes |
| room, manual (a NEW round on `strategies/room-drill`) | README steps 1–8 | one round ran live 2026-09-30 on a scratch home; the `@`, an inline member question, a refused write, `left` and re-check, a restart **owed** |
| roles, automated | `roles-smoke`, `roles.test.ts`, `role-plugin.test.ts`, `gravit-plugin.test.ts` | passes (plan 2); on the role presets and the face's role tool at 0.2.1-rc.5, 2026-11-02 (`roles-smoke` 5/5) |
| roles, manual (a NEW round on `strategies/room-drill`, a backtester run past the 60 s bash default, then the alpaca-kit row disabled in a scratch copy) | README "The role drill", steps 1–6 | **not yet run** — the operator's, on a COPY of the real home |
| the cycle, automated | `cycle.test.ts`, `gravit-plugin.test.ts`, `boot.test.ts`, `roles.test.ts`; `goal-smoke` (the goal loop itself); the cycle assertions of `bots-smoke` and `roles-smoke` | passes (plan 3; `goal-smoke` since `fae4f61`) |
| the cycle, manual (a channel from `_template`, one thin idea, the batch answered, the rounds to a verdict, a restart and "continue") | README "The cycle drill", steps 1–5 | **not yet run** — the operator's, on the real face with its keys |
| the subagents dock | `subagents-smoke`; the panel in a browser | manual **owed** |
| the MCP live roster | `curl …/data/plugins.json` | 10 + 14 on 2026-09-30 (scratch) and 2026-10-01 (live) |
| the first-live-boot checks (runbook §7 C) | the six checks | done 2026-10-01 (§6.1) |
| the runbook §7 A checklist on a COPY of the real home | `DSH_HOME=$SCRATCH/dsh-drill … npm start` | **owed** in full (the 2026-09-30 pass used a fresh scratch home) |

## 6. Records

### 6.1 0.1.1-rc.2 → 0.2.0-rc.2 (2026-09-30 to 2026-10-01)

**Not a version bump.** `dsh-host-apiproxy` was removed upstream and the face's whole wire
with it; the replacement is the Typert gateway (`POST /api/<ns>/<method>`, the `$events`
stream over `/api/remote.mux`) and the three controller rows. `dsh-agent-presets` became
`dsh-agent-preset` + `dsh-agent-preset-registry` (declarations, no directory scan). dsh-base
began mounting `storage`, `storage-json`, `storage-domain` and `session-projection-cache`
itself; `hmr`, `settings`, `config-editor` and `plugin-manager` became gated on
`profileContext`; telemetry's default moved DISABLED → FEEDBACK_ONLY; `web_fetch` turned on;
`tool-ralph` shipped disabled; `tool-str-replace-editor` left the bundle; the CLI's
`profile-boot` was rewritten; the session format went v3 → v4 with on-read migration. The
operator's ask was "把产品更新到最新的dsh上"; the survey of the change is in the memory of that
arc and in `DEVELOPMENT.md` §4.

**What the face did** (branch `worktree-dsh-0.2.0-rc.2`, five commits 3bbaa25..a6a6f45,
merged to local `main @ 23827c0`, pushed 2026-10-06 as part of `a6126d1`): S0 the pins; S1 the
boot mirror with its ten divergences; S2 the overlay rows (now thirteen); S3 the browser-cookie
sign-in; S4 the policy layer restoring the 0.1.1 posture (D3–D7, D9); S5 the server modules on the
new services; S6 bots as face-declared presets with `bot.js` re-expanding its mask on
`tools/change`; S7 Gate 2 on `snapshotEvents()`, armed inside `prepare` after a review proved the
mid-boot window, its approved path automated; S8 the client transport; `scripts/check-home.ts` for
the dry run; the go-live runbook; the docs pass. Suite at the end: 654 tests, 642 pass / 12
skipped offline, `FACE_SMOKE=1` 654/654, tsc clean.

**Decisions:** D1–D18 (§4).

**Losses, attributed:** fourteen 0.1.1 sessions the 0.2 migration refuses. Ten room sessions
carry the face's own `kind:'room'` source in v0 logs, which the v2→v3 edge refuses — the face's
debt, not dsh's; at v4 that kind is a sanctioned extension slot. Three subagent children carry
the `subagent/descriptor` version 2 that 0.1.1's own writer stamped, which 0.2.0's v0→v1 edge
refuses — an upstream rc→rc break of its stated format policy. One log has a sequence gap. All
thirty-nine sessions were exported losslessly with the old persistence library to
`~/dsh-session-exports-2026-10-01/` before the first 0.2 boot. A lossy rewrite (`kind:'room'` →
`kind:'plugin'` plus stripping the `@`'s `mention` member) recovers all ten room sessions on a
copy, text preserved and room structure lost; two lossless paths are untested. Live-apply
preconditions, if ever: stop the face, replace only `session.jsonl.zstd` atomically, never leave
a plain `session.jsonl` or two v0 generations.

**Go-live, 2026-10-01** (recorded in the repo for the first time here; `DEVELOPMENT.md` §10
item 14, `ROADMAP.md` and the runbook's §1 still read as if pending, §7.4): `~/.dsh` backed up
to `~/.dsh.bak-pre-0.2.0-20261001`; the dry run on a copy confirmed the fourteen refusals and
nothing else; the D2 row (`deepseek-official/deepseek-v4-pro`, `reasoningEffort: max`) appended
to `~/.dsh/profiles/face/cordis.patch.yml` (backup `cordis.patch.yml.bak-20261001`); the global
CLI upgraded to 0.2.0-rc.2 and never run; D13's 433-symlink link farm deleted; first live boot
from the primary checkout passed every §7 C check (no refusals, nine presets, token → cookie,
`/api` 401 without the cookie, `dsh 0.2.0-rc.2 / deepseek-v4-pro / max`, alpaca-kit 10 +
akshare 14, thirty-two sessions listed, a cold session page-only with zero writes under
`sessions/`); the boot wrote exactly `.credentials.yaml`, `profiles/face/cordis.yml` and
seventeen projcache records, as the dry run predicted. A smoke prompt in a new session streamed
in under ten seconds. Still owed from that day: the runbook §7 drills on the live home (§5).

### 6.2 2026-10-14 — version check

`latest` = `next` = 0.2.0-rc.2 still; face pin and global CLI match. Alpha line 0.2.1-alpha.1,
.2, .3 (2026-10-03, 10-09, 10-14) with cordis 4.0.5-alpha.2 and include 1.0.10-alpha.2 tagged
`dsh-0-2-1-alpha-3`. No v4→v5 session-format edge. Face impact found and parked in §7.1.

### 6.3 2026-10-15 — this guide

The seam inventory compiled (159 rows, nine groups, frozen at
`docs/research/2026-10-15-dsh-seams-inventory.md`) and this guide written on
`feat/agent-redesign`, beside the agent redesign spec
(`docs/superpowers/specs/2026-10-15-gravit-agent-redesign-design.md`), whose new dsh seams are
listed in §7.3 and enter §3 as their plans merge. The doc debts the compilation found are §7.4.

Plans 1–3 of that redesign have landed on the branch: plan 1 (the map and the instructions seam —
`GRAVIT.md`, the `agent-instructions` patch, the date section) on 2026-10-18, `2ccbfb6..c1de931`;
plan 2 (the role library) on 2026-10-18..19, `c1de931..123d4d7`; plan 3 (the cycle contract and
its section) on 2026-10-19, `123d4d7..fae4f61` and the docs commit on it, through plan 3's final
commit (the final review's fix wave: the contract's goal facts, the sections' header gate, the
goal smoke). Their seams are H10,
H11, C20 and C21 in §3.2 and the watch items of §7.3; the roles and cycle drills and the
first-request measurements are still the operator's to run (§5, `DEVELOPMENT.md` §4.3).

### 6.4 0.2.0-rc.2 → 0.2.1-rc.5 (2026-11-02)

**Target and why.** The meta package `@deepseek-ai/dsh`'s dist-tags, read 2026-11-02: `latest`
= `next` = 0.2.1-rc.5 (published 2026-10-29); `alpha` = 0.2.2-alpha.2 (2026-10-27, older than rc.5
and off its line; there is no 0.2.2 release). cordis 4.0.5 and include 1.0.10 follow from the
peers. Why now: the always-on desk (PR KairosPan/gravit-agent#9), the heaviest user of dsh's agent
plane, was not merged yet, so the bump lands under it and its seams were verified on the version
it will run; and the DeepSeek Super-agent prototype peers `^0.2.1-alpha.2`. The design is
`docs/superpowers/specs/2026-11-02-dsh-0.2.1-rc.5-upgrade-design.md` (the seam ledger is its §9,
27 rows), the plan beside it in `docs/superpowers/plans/`.

**What the face did** (branch `claude/dsh-upgrade-51c9f0`, cut from `feat/desk-p1-p4` @ `a27355bb`,
commits `e770c610..8819cad7` and the docs commit on it; not merged, not pushed): the pins on a
fresh lockfile, `ralph` inserted standalone, `working_directory` off, the persona without
`{{cwd}}`; one preset per role; the face's own role tool; the native subagents smoke on managed
delegation; the client's kinded projections read; the host's loose ends (the agents-home audit,
the instructions smoke's wait, the temp-root guard, the docker box's bind); the docs.

**What broke, and the fix** (the spec's §7 has each in full):

- B1 — the role rows (`persona`, `toolFilter`) fail at load in 0.2.1's `dsh-tool-subagent`, so
  every boot refused: one `role-<id>` preset per role, declared after boot (D20).
- B2 — dsh's delegation tool now returns at once and reports by a notice: the face owns the
  role tool, `plugins/role.mjs`, blocking over caller delivery (D20).
- B3 — every request failed on `{{cwd}}`, which the loop no longer registers: the persona drops
  it; the `working-directory` context names the directory (D21).
- B4 — dsh-base dropped the `tool-ralph` row: the package is declared and inserted (D9).
- B5 — `webServer.port` is `number | undefined`: the tests read it through `boundPort`.
- B6 — the instructions smoke raced `whenIdle()`; a second global `AGENTS.md` root: the smoke
  waits for `turn/end`; the boot audits both roots (D25).
- B7 — closed: `remote-access` never checks the browser, the owner (D23).
- B8 — `session/projections` is kinded: the client reads it through `readProjections`.
- B9 — the bots roster listed the role presets: the readers filter the `role-` prefix.
- B10 — the native subagents smoke assumed foreground calls: rewritten to managed delegation (D27).
- B11 — the client's subagent plane: `external` reads as unsupported, a running role child shows
  Stop, `speakerFor` names `Role · <id>` (a tested helper; the live client draws no role child's
  page).
- B12 — five fence smokes passed for the wrong reason under `/tmp`: the precondition is loud (D24).
- B13 — the pins and counts in the tests followed their code.
- B14 — an in-place `npm install` failed `ERESOLVE`: delete the lockfile and `node_modules` first.
- B15 — closed: every seam the desk stands on is SAME at rc.5 (the spec's §9 rows 1–4, 6, 8–16).
- B16 — compose's `FACE_BIND: "0.0.0.0"` is refused at load: the entrypoint binds the container's
  own address.
- B17 — the CLI chunk is `lib/profile-boot-C14i-8IN.js`; `runProfile` unchanged; the citations move.

**Decisions:** D9 re-taken, D19–D27 (§4; `DEVELOPMENT.md` §4.8).

**Counts.** Before, at 0.2.0-rc.2 on `a27355bb`: 2,868 tests in 197 files, 2,838 pass + 30
skipped, 0 fail, typecheck clean; `FACE_SMOKE=1` 2,869/2,869. After, at 0.2.1-rc.5 on `8819cad7`:
2,903 tests in 200 files, 2,871 pass + 32 skipped, 0 fail, typecheck clean — the 32 skipped are the
real boots (`bind-smoke` and a fifth `roles-smoke` boot are new). Under `FACE_SMOKE=1` every smoke
passed during the build (2,883 of 2,888 at `ceb5df9d`, the four Account smokes skipped there for
want of `npm ci` in `account/`, the one red `subagents-smoke`, rewritten at `257c3439` and green
alone); the whole run on the final tree — the upgrade merged with the desk's hardening
(`feat/desk-p1-p4` @ `dd867f70`), `817ee2bb`: typecheck clean, 2,974 tests in 202 files, 2,942 pass + 32
skipped offline, 0 fail; `FACE_SMOKE=1` 2,975 / 2,975, 0 fail, the four Account smokes included; with the
desk's graceful-stop carry merged too (`feat/desk-p1-p4` @ `92994b47`, `ce4fc716`): 2,993 tests in 203 files,
2,960 pass + 33 skipped, `FACE_SMOKE=1` 2,994 / 2,994 (the new `desk-carry-smoke` is the 33rd boot). `npm run check:fixture` at rc.5: 26 lines, 23 validated, 0 rejected, the 3 with no upstream
validator named — the 0.2.0 baseline.

**The fourteen sessions.** No format edge was added (the format packages end at
`dsh-session-format-v3-to-v4`; the writer is still v4), so the fourteen 0.1.1 sessions 0.2.0
refuses (§6.1) stay refused for the same reasons, no more and no fewer, and nothing written since
2026-10-01 is a v0 log; `~/dsh-session-exports-2026-10-01/` still holds them. The dry run on a
copy at rc.5 is how the operator confirms the count; this session did not read `~/.dsh`. The
0.2.0 role children were one-shot and stay read-only history; rc.5's resume through their
`role-<id>` preset, so a renamed or removed role leaves its children unresumable.

**The rollback is lossy (D26).** rc.5's event vocabulary has 62 types where 0.2.0's had 59:
`job/registered` and `job/settled`, written by EVERY agent `bash` call, and
`working-directory/change`, written by a `cd`. 0.2.0 refuses a log carrying an event type it does
not know, so practically every session used under rc.5 becomes unreadable by 0.2.0. The way back
is the backup taken before the first rc.5 boot and a 0.2.0 checkout with its own `node_modules`,
never one session's files.

**The `/tmp` lesson.** The first probe ran in a worktree under `/private/tmp`, and five smokes
(desk, schedule, watch, room, telegram) failed on writes the sandbox should have fenced: dsh's
`workspace-write` grants the session cwd and `/tmp` and `os.tmpdir()` by real path
(`dsh-sandbox` `writableRoots`, unchanged byte for byte between the versions). The same five fail
at 0.2.0-rc.2 from a copy under `/private/tmp` and pass at rc.5 outside it. Not an upgrade break;
it cost a day of reading, so the suite now says so (D24, §2 step 10, §3.1 K5).

**For the operator, before the home moves:** the credentials precedence (a `refs` value in
`~/.dsh/.credentials.yaml` now beats the exported key, I5); D12 again for the global CLI
(0.2.0-rc.2, never run: upgrade it to rc.5 or keep it off the home); a global `AGENTS.md` in
`~/.dsh` or `~/.agents` (D25; the spec's probe found none); the profile patch needs no new row
(D19 and D22 are the face's; `deepseek-v4-pro` is still in rc.5's catalog). Still owed: the
operator's go-live on `~/.dsh` (the runbook beside the 0.2.0 one), the live drills on the new pin
(§5), the merge.

## 7. Watchlist for the next upgrade

### 7.1 Upstream changes already known (0.2.2-alpha.2, read 2026-11-02)

The next upgrade's breaks live here; none is the face's yet (the upgrade spec's §13 is the source):

- **Node ≥ 24.9.** The face runs Node 22 (its `engines`, the LaunchAgent's node, the agent box's
  image): the runtime moves first, and `zstdDecompress` (A15) and the native addon (A8) with it.
- **Tools activated per step**: "plugins must migrate `tools.resolve` / `executable`". Every face
  row that registers a tool — `plugins/role.mjs`, the Lunhui rows (J1), the desk's two tools,
  `dispatch`, `agent_<bin>` — and every `tools.get` the face makes (`role.mjs`'s allow check,
  `gravit.js`'s `canCall`) re-checks against it.
- **Native and PTC execution split into agent-scoped plugins** (`tools.mode`,
  `DSH_TOOLS_MODE`): Gate 2's `tools/pre-execute` listener and guard (D1–D3 of §3.2), the desk
  guard and the never-list's `run_code` entry re-check against the split.
- **`@deepseek-ai/dsh-official-bundles`** replacing app-boot's lists: the boot mirror (A9), the
  install anchor and the policy layer's row ids move with it.
- **Retained session-projection handles**: the room projection (E16) and the client's
  projections read (K4).
- "End the current turn when only a result remains pending": re-check the role call (K1), which
  holds a turn on purpose, and the goal driver's wait (C21).
- Not an upgrade item, a trap before anyone mounts it: `@deepseek-ai/dsh-schedule` delivers with
  message source kind `schedule`, the kind the desk already declares for its own firings
  (`face/src/desk-session.ts`, the client's `DESK_KINDS`); rename one of the two first.

Landed at 0.2.1-rc.5 (2026-11-02, §6.4), the items read on 2026-10-14 against 0.2.1-alpha.3:
`dsh-tool-ralph` left dsh-base — declared and inserted (D9); subagent notifications unified —
role calls are the face's own blocking tool (D20), dsh's own follow upstream (D27), the client's
subagent plane re-checked (C17, B11); `agent-instructions` dropped `dshHome` and reads a second
global root — audited (D25, H6); the API-key precedence moved — the operator compares (I5); the
chunk name moved — four places (§1).

### 7.2 Our own risks before the next session-format bump

- The operator's `@` is logged as `{kind:'user', mention:[…]}` (`room.ts` `say`): an extra
  member on a known kind, the pattern the v0→v1 edge refuses. Move `mention` into the face's own
  source kind before any v4→v5 edge exists, or every room log with an `@` in it becomes the next
  D11. Recorded nowhere else in the repo as of 2026-10-15. **Verdict at 0.2.1-rc.5 (2026-11-02):
  safe at this pin.** There is no v4→v5 edge (format version 4; nothing named `v4-to-v5` in the
  tree or the source); `dsh-llm`'s message module is byte-identical; no rc.5 validator reads a
  member set — `Session.append` reads no `source`, restore needs a non-empty string `kind`, the v4
  codec a non-empty kind that is not `plugin` — and upstream itself added `principal?` to its
  `user-rpc` source without a version bump (the spec's §9 row 8). The next-bump risk stands as
  written: the first v4→v5 edge is where it bites.
- The desk's own source kinds (`telegram`, `schedule`, `alert`, `desk`) ride the same
  merge-extensible map and are admitted the same way; `schedule` collides with
  `dsh-schedule`'s kind the day that package is mounted (§7.1).
- The room sources (`kind:'room'`, forms `answer` / `round-end` / `delta`) are admitted at v4 by
  the "any non-empty kind but `plugin`" rule; a stricter edge reopens D11 for 0.2-born rooms.
- Landed in plan 1 (`5d8c95d`): `dsh/profile/persona.md` named the `report` tool, deleted at
  0.2.0; the sentence is gone.
- Watch (2026-11-02, the rc.5 spec's B6): of the smokes that pair a Remote `session/prompt` with
  `agent.whenIdle()`, only `instructions-smoke` moved to the `turn/end` wait; `bot-runtime-smoke`,
  `goal-smoke`, the two Lunhui run smokes, `roles-smoke`, `room-discussion-smoke` and
  `subagents-smoke` still pair them, green in both full runs because each also waits on a request
  or a notice. A follow-up sweep moves them; until then a lone red in one of them is this race
  first.

### 7.3 Seams the 2026-10-15 agent redesign adds (spec §8 and §11), and the 0.2.1-rc.5 upgrade's keys

- the `agent-instructions` row patched by `composeFace`: `instructionFileCandidates` and
  `localInstructionFileCandidates` are the face's, applied last over the config the layers below
  left (a named config replaces the row's, so the patch spreads that config as the persona patch
  does; `maxBytes` is dsh-base's value only when no layer set one) — pinned by `boot.test.ts`
  and an instructions smoke. Landed in plan 1: the patch `8983555`, the smoke `2c494a1`, the
  `GRAVIT.md` it reads `dbbd19a` and `119c9da`; entered as H10 in §3.2;
- per-role `@deepseek-ai/dsh-tool-subagent` rows inside the default preset: `persona`,
  `toolFilter`, `backgroundMode: one-shot`, the `spawn` provider — the config keys, the
  capability flags the backend declares, and whether the row's persona shadows the global
  prefix for the child (spec §11 (a)). Landed in plan 2: the reader `2b88cfd`, the rows and the
  `gravit:roles` section `994ef5d`, the real-boot smoke `0ec19ab` (its equality assertions
  `f0d8b8d`); entered as C20 in §3.2, and §3.1 gains the server-name hand check. *Superseded
  2026-11-02:* 0.2.1 refuses `persona` and `toolFilter` on the row; the role rows are
  `plugins/role.mjs` and each role its own preset (D20; §3.1 K1, K2);
- preset-scoped tool rows under eager activation and the roster audit (spec §11 (b)). Landed in
  plan 2: `e2bab8b` renders the static `preset-gravit` row from `roles/` at compose time, so the
  role rows mount under eager activation and a row that fails to mount lists the preset broken
  (`bootFace` refuses it); `0ec19ab` boots it. Since 2026-11-02 the role presets are declared
  after boot under the same eager activation, and a broken one refuses the boot too (K2);
- the child's prompt still carries dsh's generic tool-policy sections (`create_goal`, `workflow`,
  `ralph`, the background-job `job_output` text) for tools `tools.restrict()` removed: those
  sections are global and ignore the restriction (measured in plan 2, `DEVELOPMENT.md` §3.8).
  Re-check whether a later dsh scopes tool sections to the agent's view, and drop the §3.8 caveat
  when it does;
- `face/plugins/gravit.js`: `ctx.systemPrompt.section` with `interpolate: false`, the orders
  `getSectionOrder` allocates for the first-party tail (spec §11 (d)). Landed in plan 1
  (`6af2eb2`): the date section at `getSectionOrder("DEPLOYMENT_PERSONA_PREFIX") + 1`, entered as
  H11 in §3.2; the `roles` section landed in plan 2 (`994ef5d`, at `getSectionOrder("TOOL_SUBAGENT")
  + 1`, also H11), gated on the assembling scope's tool view since `e389160`; the `cycle` section
  landed in plan 3 (`7cf3c57`, at `getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 50`, also H11),
  gated the same way on `create_goal`, its real-boot pins `4d93481`; since `fae4f61` both
  sections also read the session header (`isRootOrFork`), so a delegated child that is not a fork
  — a plain `subagent`, workflow or ralph child, which can call every tool Gravit can — reads
  neither (roles-smoke pins the spawn beside the fork). Re-check that a fork child's header still
  carries `isSeeded` and a delegated one `origin: subagent`;
- `dsh-goal` + `dsh-goal-round-driver` + `dsh-tool-goal` + `dsh-command-goal`: the `<goal_round>`
  prompt text, the `round-limit` blocker, the disarm-after-resume rule (spec §11 (e)), Stop
  pausing a goal, `/goal resume`. Landed in plan 3: `dsh/profile/cycle.md` is written against
  these facts (`7cf3c57`, amended in `fae4f61`; `cycle.test.ts` pins that it states
  `max_goal_rounds` 24, the `resume` path and the blocked vocabulary); the behaviour itself is
  pinned on a real boot by `goal-smoke.test.ts` (`fae4f61`), and a real model's use of it is the
  cycle drill's, not yet run; entered as C21 in §3.2, with `DEVELOPMENT.md` R30;
- `dsh-compaction-tool-result-pruner` thresholds (8,192 / 4,096 / 1,024) that role reports are
  sized under (spec §11 (f)). Not landed: the spec leaves it to the cycle drill, where a 24-round
  run is the first time compaction can bite, and that drill has not been run;
- the section gates are silent when the tool they probe goes away. `gravit:cycle` probes
  `create_goal`, `gravit:roles` each `role_<id>`: a profile patch that disables dsh-base's
  `tool-goal` row, or a dsh that moves or renames the goal tools (as 0.2.1-alpha.3 moves
  `tool-ralph` out of dsh-base, §7.1), blanks the cycle section from Gravit's prompt with no boot
  warning; until 2026-11-02 no `spawn` provider did the same to the roles section (since, the
  role tool registers regardless and refuses the call instead, K1); and with `goal-round-driver`
  disabled the contract stays and nothing re-prompts a round. A dsh change fails `bots-smoke`
  (Gravit's prompt carries `Step 0 — ask once`) and `goal-smoke` (`FACE_SMOKE=1` only), an
  operator's patch fails nothing. Re-check at every pin that the goal tools still register
  (`DEVELOPMENT.md` §4.3);
- the seam keys the 0.2.1-rc.5 upgrade added (2026-11-02; the spec's §9 is the ledger, 27 rows,
  each SAME or CHANGED with its note): `subagents.startActivation` with `delivery: "caller"`,
  `getProvider`, `resolveMaxDepth`, `maxActiveSubagents` and `llm.resolveCallConfig` (K1); the
  role presets' declaration and the header's `agentPreset` (K2); `remote-access` (K3); the kinded
  `SessionProjectionsValue` and `SessionSummary.formatStatus` (K4); `writableRoots` (K5); the
  webserver's wildcard refusal and optional `port` (K6); `resolveAgentsHome` and the two global
  instruction roots (H6); the credentials precedence (I5); the `working-directory` runtime context
  and the loop's registered prompt variables, `provider` and `model` (B7); `dsh-tool-ralph`'s
  standalone config, `subagentProvider` and `maxRounds` (B29); and the desk's seams the ledger
  found SAME — `followup`/`steer`/`inject`, the durable inbox, `cancel` with `keepInbox`,
  `whenIdle`, `freezeMessage` with a caller id, `sessionPersistence.flush()`,
  `maxConsecutiveWakes`, the goal rules, `deriveTurnTokenUsage` (rows 1–4, 6, 8–16). Re-read
  each at the next pin;
- the generated default composition (`bots/<agent>/agent.cordis.yml` as a mirror of `roles/`),
  which `definitionFor` no longer reads from disk. Landed in plan 2: the mirror and its drift test
  `994ef5d`, the in-memory render `e2bab8b`; plan 3 added the cycle text to the same render
  (`7cf3c57`), so an edit to `cycle.md` regenerates the mirror too. A face that ships `bots/` must
  ship `roles/` beside it: `composeFace` refuses a missing roles directory.

### 7.4 Doc debts found while compiling the inventory (fix in the next docs pass, after the rename lands)

- Fixed in plan 1: `face/README.md` "Tests" disagreed with itself on the number of real boots,
  and its table omitted `order-gate-midboot-smoke.test.ts`. It now says thirteen, the code's
  count with the instructions smoke, and its table lists thirteen files (fourteen since plan 2's
  roles smoke, fifteen since plan 3's goal smoke).
- The go-live of 2026-10-01 is recorded nowhere in the repo: `DEVELOPMENT.md` §10 item 14 and
  §7.4, `ROADMAP.md`, the runbook §1 (still "the global `dsh` (0.1.1-rc.2 …)") and
  `dsh/README.md` "Installed state" read as if pending; the runbook's §3 expected-findings table
  (39 / 25 / 14 sessions, 433 symlinks, `settings.yaml` present) is a 2026-09-30 snapshot a
  future dry run will not reproduce. §6.1 above is the record until those move.
- `dsh/README.md` says the approval-channel "live re-run is owed" without saying the deny half
  ran live on 2026-09-30 on a scratch home; `face/README.md` says so; `DEVELOPMENT.md` §7.4
  reconciles them.
- `DEVELOPMENT.md` Appendix A and §4.6 omit `DSH_WEB_FETCH_PROVIDER`, `DSH_TELEMETRY_MODE` and
  `PLAYWRIGHT_CLI_PATH`.
- Fixed in plan 1: `DEVELOPMENT.md` §4's size line (31 files, 9,759 lines measured on
  2026-10-15, one plain `.js` file) now reads 32 files, some 9,900 lines (9,866 measured on
  2026-10-18) and two plain `.js` files (33 files, some 10,200 lines since plan 2's
  `src/roles.ts`; 34 files, some 10,300 lines — 10,321 measured on 2026-10-19 — since plan 3's
  `src/cycle.ts`).
- `face/README.md` "What boot refuses" names three required rows "in this tree"; `boot.ts`
  cites upstream's seven; the three are a derived claim to re-derive at every pin.
- `face/README.md`'s "The Gate-2 drill" heading and its "Channels" line citations are the open
  doc debts `DEVELOPMENT.md` §10 item 4 already lists.
- `dsh-api-gateway`, `dsh-user-approval`, `dsh-user-questions` are named by the upgrade drill
  and imported by `scripts/validate-fixture.mjs` but not declared in `face/package.json`, so the
  pin sweep never sees them. Decide: declare them exact.
- The README "Run" sample boot line lists seven presets; the operator's live face declares nine
  (two untracked bots). Not an error; the sample will not match a real boot.

### 7.5 Seams the Lunhui rows use (dated 2026-10-26, plans 1–4 of the modules spec)

Entered as J1–J5 in §3.1 and in the seams inventory's 2026-10-26 addition. Re-check at every pin:

- `defineTool`'s object shape and the thrown-error text (J1): the role personas, the protocol and
  the repair lines all read refusals as `Error: <CODE> …`, and a module's `修复：` repair line rides
  in the same message;
- `ctx.provide` / `inject` of the `lunhuiRuns` service and the pending-service audit (J2): ten rows
  depend on one provider; a boot pinning the refusal is still owed;
- `exec.agent.session.header`'s `origin`, `isSeeded` and, since 2026-11-02, `agentPreset` (J3,
  K2): the fence between Gravit and a module submit. Until then it admitted any unseeded child
  (R44), since the header could not tell a role child from a plain spawn child; each role child
  now composes its own `role-<id>` preset and `callerIsRole` requires the prefix, which closed that
  half of R44;
- the spill cap against the 30 KiB contexts (J4): the mode's maximal context is 30,233 bytes and
  the reviewer's 30,703 (the module tests' pins), both under the cap in either unit today;
- the structured clone of patches (J5), which forced the smokes to shift `globalThis.Date` for a
  boot's lifetime instead of passing a clock.
