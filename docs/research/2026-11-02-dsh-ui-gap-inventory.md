# dsh UI gap inventory — what DeepSeek Harness Desktop shows that gravit-face does not

**Date:** 2026-11-02 · **Status:** a first-pass inventory for the operator to react to; the input of
the dsh UI port brainstorm, not a decision. Nothing here is designed or built.

**Sources.** Upstream `deepseek-ai/deepseek-harness` at tag `dsh-v0.2.1-rc.5`: every
`packages/client/*/README.md` Summary, the web-app bundle patch
(`packages/bundle/web-app/cordis.patch.yml`, the official roster and its host rows),
`packages/api/*/src/index.ts` (the Remote methods), `apps/desktop/README.md` and `apps/desktop/src`,
`apps/desktop-host/src`. The face: `face/src/overlay.ts` and `face/src/policy.ts` as they stand on
`claude/dsh-upgrade-51c9f0` (the rc.5 face), dsh-base's rc.5 rows from that branch's install, the
page under `face/client/js`, `DEVELOPMENT.md` §5 and `face/README.md`.

**What Desktop is.** DeepSeek Harness Desktop is an Electron shell around the complete dsh Web app:
the window loads the same packaged Web client, served by the same Host. So the gap is (1) the Web
client's features plus (2) a short list of shell-only pieces (§7). Desktop's own profile also turns
on the right Sidebar's Browser tab and the Office skills.

**Reading the verdicts.**

- **A** — portable on the face's current composition: the Remote or projection is already served
  (the face mounts `session-controller`, `workspace-controller`, `file-upload`, `api-remotes`,
  `settings-controller` for `credentials/describe` only, and dsh-base's host rows).
- **B** — needs a host row the face does not mount, or a standing decision re-taken; the operator's
  call, named in the row.
- **C** — not applicable to this product, or Electron-only.
- *verify* marks a claim read from a README or a method name and not yet proven on a boot.

Host rows the web app mounts and the face does not (each a B below): `workspace-files`,
`terminal-controller`, `job-controller`, `schedule`, `workspace-changes`, `session-stats`,
`session-turn-outline`, `message-feedback`, `session-log-download`, `open-in-app`,
`session-reference`, `file-reference-local`, `office-to-pdf`, `plugin-inventory`,
`account-controller`, `cordis-host-runner`, `harness-dev-context`, `client-hmr`, `modules`,
`web-runtime`. The face mounts no `profileContext` (D1), so dsh-base's `settings` and
`config-editor` rows stay off and every settings form is blocked.

## 1. The thread and the composer

| Feature (package) | What dsh shows | The face today | Verdict |
|---|---|---|---|
| Work-details modes and reasoning (`ui-chat`) | reasoning previews and process rows under a per-view mode (Verbose keeps completed turns' process rows); local and steering submissions shown at once, queued ones outside the chat; restored scroll | a thinking indicator, final answers only; no tool rows by the 2026-10-28 decision | A for reasoning text and the mode; tool rows conflict with 2026-10-28 |
| Tool call cards (`ui-tool`, `ui-primitives` cards: terminal, read, diff, search, web, JSON) | every tool call as a card, nested subcalls, a generic card for unknown tools | none drawn since 2026-10-28 (seat writes worded as lines, `lunhui_present` as the composed answer) | A technically; reverses a standing product decision |
| Attachments (`ui-attachment`, `file-upload`) | a draft rail under the composer, drop target, images in history, lightbox | none: the composer sends text only | A: `file-upload` and `session/attachment` are mounted (*verify* the prompt's attachment parts) |
| `/` candidate menu (`ui-input-trigger`, `ui-commands`, `ui-skill`) | a grouped popup under the caret: host commands, skills by `/name`, popups such as `/model` and `/permission`; a line is never downgraded to a prompt | a typed `/` line goes to `commands/execute`; no menu, no candidates | A: `commands` catalog and `skills/list` are served |
| `@` references (`ui-reference`, `ui-subagent` `@`) | `@file`, `@folder`, `@session` atomic references; a running child's label | `@` is a room mention of a bot only | B: `file-reference-local`, `session-reference` |
| Model and effort per session (`ui-model-selection`, `ui-deepseek-model-label-1017`) | the composer's model seat and `/model`: provider-grouped models, effort names, applies to the next request | the model routes are read for Discover (`session/modelCatalog`); no per-session pick | A for the per-session pick over `session/selectModel` (*verify* it needs no settings service); a persisted default is D1 |
| Permission preset per session (`ui-permission-presets`) | Read Only · Workspace Write · Full access (+ Auto review, experimental), composer and `/permission` | none; every session runs the face's policy and Gate 2 | B: a security decision (Full access per session sits beside Gate 2 and the desk guard) |
| Agent questions (`ui-user-questions`) | the question card plus a timed wait with a countdown, drafts kept across reload, late replies, the plan-review approval card | the question card in the blocking `legacy` mode | A: the timed mode is a `tool-ask-user` config, plan review rides plan mode (§4) |
| Approvals (`ui-approval`) | the approval card in the composer with the tool's detail | the order card (Gate 2) and the approval card | has it |
| Message feedback (`ui-message-feedback`) | Like/Dislike on a final answer, a dialog with category and note, `/feedback`; log-only events | none | B: `message-feedback` row; low value for one operator |
| Secret masking (`ui-secret-mask`) | a pasted key or token drawn masked in sent text, reveal per value | none | A: pure client |
| Stats strip and turn rail (`ui-chat` over `session-stats`, `session-turn-outline`) | whole-log turn and step counts; a rail to jump between turns of a long session | Usage in Details (tokens) | B: two projection rows, no egress |

## 2. The session list and navigation

| Feature (package) | What dsh shows | The face today | Verdict |
|---|---|---|---|
| Search over sessions (`ui-workspace` search, `session/search`) | full-text search across sessions | none | B: `session-query-sqlite` ships `openAt: never`; one row patch (`first-search`) turns it on (*verify* the Remote's shape) |
| Pin and reorder (`ui-workspace`) | pin a session, reorder sessions and workspaces, add/rename/delete workspaces | channels group the list; no pin | A for pin (`workspace/pinSession` is served); workspaces are C (one repo) |
| Status words (`SessionSummary.formatStatus`, `ui-session`) | why a session cannot open (`migration-required`), running and pending marks, completion reminders | unread and seen marks; the rc.5 branch carries `formatStatus` on summaries but no screen draws it | A |
| Session export (`session-log-download`) | `/export` and a download dialog for a session's log | none | B: the row |
| Open in an app (`ui-open-in-app`) | a header split button opening the workspace (or a previewed file) in Finder, an editor, a terminal | none | B: `open-in-app` host row; loopback only |

## 3. The right Sidebar (the workbench panes)

| Feature (package) | What dsh shows | The face today | Verdict |
|---|---|---|---|
| The Sidebar itself (`ui-sidebar-right`, `ui-dockkit`, `ui-layout`) | one docking surface per session: tabbed panes, split, expand, two presentations | no right pane; drawers per screen | A as a layout; useless without the tabs below |
| File tree (`ui-sidebar-files`) | the session's workspace tree, live refresh, files open into previews | a channel page lists its files | B: `workspace-files` |
| Document preview (`ui-sidebar-documentpreview`, `office-to-pdf`) | Markdown, code, image, PDF, HTML, spreadsheet, Word/PowerPoint converted locally to PDF; reload | none (Markdown drawn in the thread only) | B: `workspace-files` (+ `office-to-pdf` for Office) |
| Terminal (`ui-sidebar-terminal`) | interactive shells in the session's directory, recovered after reload; runs as the system user, outside agent permissions | none | B: `terminal-controller`; a security decision (a shell in the page, no Gate) |
| Browser tab (`ui-sidebar-browser`) | HTTP(S) pages, loopback services included, in a sandboxed tab (Web: iframe; Desktop: webview) | none | C in a browser page (open a tab); Desktop-only in the official build |

## 4. What the agent is doing

| Feature (package) | What dsh shows | The face today | Verdict |
|---|---|---|---|
| Goal strip (`ui-goal`) | the current goal and its activation above the composer; edit, pause, resume, clear; `/goal` runs kept as bubbles | the cycle uses `create_goal`; the page only says `/goal resume` after a Stop | A: the goal projection (key `goal`, dsh-goal) rides `session/projections` |
| Plan mode (`ui-plan`, plan review in `ui-user-questions`) | `/plan`, a composer chip, the submitted plan opened for review, approve or reject, cards in the turn | none drawn (dsh-base's `plan-mode` row is mounted) | A over the plan projection (key `plan`, dsh-plan-mode); review needs a pane or drawer |
| Background jobs (`ui-jobs`) | a header list of the session's jobs: running/finished, elapsed, streaming output, kill | none | B: `job-controller` |
| Subagents (`ui-subagent`) | children from the parent header with activity, tokens and duration; follow-up prompts to continuable children; Stop; external tasks | Children in Details with states and Stop | A for tokens, duration and follow-ups (`subagents/prompt` is in the wire, no page calls it) |
| Workflow runs (`ui-workflow-run`) | a durable workflow run as its own node: phases, members, statuses | none | A if Gravit runs workflows (`tool-workflow` is dsh-base's); low value today |
| Trajectory (`ui-trajectory`) | a turn-aware ledger of every record with a timing overview and an inspector (tokens, duration, input, output) | a room member's Trace only | A over `session/page`; an inspector, not the thread, so the 2026-10-28 decision holds |
| Changed files and deliveries (`ui-deliverables`, `workspace-changes`) | a finished turn's changed-files card with line counts, a review tab per file, delivered-file cards, file links in the prose | none | B: `workspace-changes` (git snapshots per turn) + `workspace-files` |
| Schedule (`ui-schedule`) | an Automation page, a task tab, a reminder clock on sessions | the desk's standing orders on Markets › Desk | B and a conflict: `schedule` delivers with source kind `schedule`, the desk's own (upgrade spec §13) |

## 5. Settings and configuration

| Feature (package) | What dsh shows | The face today | Verdict |
|---|---|---|---|
| Settings shell, General (`ui-settings`, `ui-settings-general`) | a Settings panel, connection retry, onboarding ledger, the local config file link | Settings with the theme and Devices | B: D1 (`settings` service) |
| Models (`ui-settings-models`) | API keys write-only, model lists per provider, custom routes, first-run dialogs | the operator's rows and `.env` | B: D1 for the lists; keys go through `credentials/set` (*verify* it stands without settings) |
| Theme and fonts (`ui-theme`) | light/dark/system plus text, code and terminal fonts and sizes | Cream · Black · System, no font control | A on the page alone (dsh persists through settings, D1; the face keeps its own prefs) |
| Shortcuts (`shortcuts`, `ui-shortcuts`) | a command reference (Mod+/), record and restore bindings per device | none | A on the page alone |
| Language (`locale`) | zh/en switch | English by the operator's rule | C |
| Agent preset default (`ui-agent-preset`) | the new-task default preset and what each declares | presets are chosen by channel and bot; Discover shows them | C (D1 for a persisted default) |
| Plugin pages: shell, agent loop, subagent, web search, session log (`ui-settings-*`) | per-namespace forms with save and reset | the operator's patch file | B: D1 |
| Plugin manager, market, inventory, entry customization (`ui-plugin-manager`, `ui-plugin-market`, `ui-settings-plugin-inventory`, `ui-entry-customization`) | install, enable, configure bundles; browse markets; a read-only inventory; Creator drafts | Discover's inventory of what Gravit runs (`/data`) | C: D1 by design |
| DeepSeek account (`ui-settings-account`, `account-controller`) | sign-in, credit, sign-out | API keys only | B: rows; low value |

## 6. The shell plumbing

`connection`, `modules`, `web`, `ui-renderer`, `ui-slots`, `store`, `resources`, `hmr`,
`ui-primitives`, `ui-conversation`, `ui-session`, `ui-brand-official`, the two directory pickers:
the machinery of a React client the face does not use. Nothing to port as a feature (C), except
what the rows above name.

## 7. Desktop-only (the Electron shell)

| Feature | What Desktop gives | The face today | Verdict |
|---|---|---|---|
| Background running and the tray | closing the window hides it; tasks continue; tray or Dock brings it back | a LaunchAgent service, the desk, the Telegram bridge | has it (more) |
| Quit confirmation | quitting asks when agents, approvals, queued messages, jobs or armed reminders would be interrupted | the service has graceful stop and the desk's carry | C |
| Welcome and onboarding | API-key page, DeepSeek browser sign-in, first-run dialogs | the operator's setup | C |
| Office skills and the bundled runtime (`desktop-office`: `dsh-skill-office`, `dsh-tool-workspace-dependencies`) | offline Word/PowerPoint/Excel authoring and LibreOffice operations; a bundled Python with numpy, pandas, python-docx, python-pptx, openpyxl | none | B: two packages and a runtime payload; the only Desktop piece with a research use (reports as Excel or slides) |
| Platform documents | DeepSeek Platform pages in an embedded view with the account's session | none | C |
| Updates, `dsh` command install, crash report, fatal recovery | signed updates, CLI link, crash logs, disable third-party plugins | npm pins, boot refusals | C |
| Login-shell environment | the Host reads `~/.zprofile` / `~/.zshrc` | the face is started from a shell or the service's env | C |
| Native directory dialog, `dsh://open`, microphone grant, analytics | as named; no voice-input UI found in the rc.5 client packages | — | C |

## 8. Already in the face

The session list with fork, archive, un-archive, delete and rename; a live or paged transcript; the
composer with `/` to `commands/execute`; the approval, question and order cards; Stop; children with
Stop; unread marks; usage in Details; theme. And what dsh has no counterpart for: rooms, channels,
Markets, Trade, Account, Discover, the Lunhui modules and composed answer, the desk.
