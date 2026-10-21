/** The desk session: the one long-lived conversation the operator's phone talks to, the sessions
 * cut from the same cloth for the clock's firings, and the supervision every turn on the desk gets
 * (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md §5.3, §5.8, §5.9, §7; the plan's
 * Global Constraints, docs/superpowers/plans/2026-10-20-desk-p1-bridge.md).
 *
 * WHERE IT LIVES. A runtime-root session of the `gravit-desk` preset (src/desk-preset.ts) whose cwd
 * is `<repo>/desk/journal/` ({@link deskJournalDir}), with `workspace-write` pinned inside creation
 * setup, so its sandbox confines its writes to the journal and the temp areas (spike 6). The face
 * finds it again through the ledger, not a header scan: P2's firings share its cwd and its preset, so
 * {@link ensureDeskSession} records every conversation it opens as a `desk-session` event and resumes
 * the newest one the ledger names (src/desk.ts `lastDeskSession`). A firing comes from
 * {@link createDeskAgent}, the same create path, which records nothing - a firing must never become
 * the phone conversation.
 *
 * THE FENCE (§7). dsh reads `GRAVIT.md` and `GRAVIT.local.md` in every directory from the project root
 * - the nearest ancestor holding a `.git` - down to the session's cwd, and in the directories below it
 * whenever a turn touches a file there; under a project root, `.dsh/skills` and `.agents/skills` are
 * skill roots. So one of those names in `desk/journal/`, or in `desk/` above it, would steer every later
 * desk turn, and git never shows it: the journal is ignored. A symlink would put another tree's files
 * where the desk reads, so every symlink in the journal counts too, as do a symlinked `desk/` or journal
 * and the repository's own skill roots. {@link findDeskFenceViolation} looks for one;
 * {@link superviseDeskTurns} runs the check at every turn's start and cuts a turn that starts over a
 * violation, and an owner can check before it opens a turn at all, {@link fenceRefusalLine} being its
 * reply. The check fails closed: what it cannot read counts as found. It is the second line: a file that
 * a desk turn writes steers the rest of that same turn, which no check at a turn's start can see, so
 * src/desk-tools.ts's write guard denies a desk agent's write of any of these names before it happens.
 * The fence is for what another session plants.
 *
 * PROVENANCE (§5.9). The model never sees a message's `source` (spike 4): the DeepSeek adapter puts no
 * user-message source on the wire. So every message the face sends the desk opens with one bracketed
 * line ({@link provenanceLine}) saying where it came from; the `source` object ({@link
 * DeskMessageSource}) is for the log, the ledger and the client.
 *
 * SUPERVISION (§5.8). {@link superviseDeskTurns} watches EVERY turn on the session, not only the turns
 * the face opens: a background job can wake the desk after a phone turn's deadline has cut that turn.
 * Each turn gets a fixed deadline from its `turn/start` - never extended, card or no card, the opposite
 * of the room's policy (src/room.ts `driveTurn`), because a parked card is exactly the turn to end - and
 * its end is one record: who opened it, how it ended, its final text and its tokens, from
 * `deriveTurnTokenUsage` (spike 2).
 *
 * Nothing here knows Telegram. The phone's bridge is one owner of the desk among others, and a
 * supervisor that any owner installs gives every turn its deadline, Telegram configured or not.
 * @module
 */
import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection as installDshModelSelection } from "@deepseek-ai/dsh-agent";
import { deriveTurnTokenUsage } from "@deepseek-ai/dsh-token-meter/client";
import { appendEvent, deskTime, lastDeskSession, readEvents, type TurnUsage } from "./desk.ts";
import { FENCE_NAMES, fenceNameOf } from "./desk-names.ts";
import { DESK_PRESET } from "./desk-preset.ts";
import type { AgentLike, MemberSetup, ResumeMemberOptions, RoomContextLike, RoomDeps, SessionLike } from "./room.ts";
import { finalTextOf, parseModelRoute, type EventLike, type MessageLike } from "./room-rules.ts";

/** Diagnostic label, the one every `${BIN}:`-prefixed line in the face uses; desk lines add `desk:`. */
const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): unknown => (err as { code?: unknown } | null | undefined)?.code;
/** Where the desk's lines go unless an owner passes its own `log`: stderr, as src/desk.ts's do. */
const defaultLog = (line: string): void => { console.error(line); };

/** The desk session's cwd under the repository root `root`: `<root>/desk/journal`. */
export function deskJournalDir(root: string): string {
  return join(root, "desk", "journal");
}

/* ---------- the instruction-chain fence ---------- */

/** The names that steer a desk session from inside its own tree, compared as a case-insensitive volume
 * compares them (`fenceNameOf`). They live in src/desk-names.ts, a leaf, because src/desk-tools.ts's write
 * guard - which denies a desk turn's write of one before it happens - matches them too, and src/desk.ts
 * loads that module statically; they are re-exported here for this module's importers. */
export { FENCE_NAMES };

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
const byName = (a: Dirent, b: Dirent): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The first entry under `journalDir` that would steer a desk session, as a path relative to
 * `journalDir` (`a/b/GRAVIT.md`), or `undefined` when there is none.
 *
 * Walks every depth, depth first, each directory's entries in code-unit order, and answers with the
 * first entry that is a symlink - any symlink, whatever its name, dangling or not: one is never
 * followed, and what it points at is not the journal's - or that is named like a {@link FENCE_NAMES}
 * entry, the name compared as a case-insensitive volume compares it (src/desk-names.ts
 * `fenceNameOf`). The journal itself is `"."` when it is a symlink. It fails closed: a missing journal (ENOENT at the root) holds nothing,
 * but a journal it cannot read for any other reason is `"."`, and a directory under it that it cannot
 * list is itself the answer, by its path - unless that directory went away or stopped being one between
 * the listing and the descent (ENOENT, ENOTDIR), which is skipped as gone. Never rejects.
 * @param journalDir - the desk's journal ({@link deskJournalDir}).
 */
export async function findFenceViolation(journalDir: string): Promise<string | undefined> {
  let entries: Dirent[];
  try {
    if ((await lstat(journalDir)).isSymbolicLink()) return ".";
    entries = await readdir(journalDir, { withFileTypes: true });
  } catch (err) {
    return codeOf(err) === "ENOENT" ? undefined : ".";
  }
  return walkFence(journalDir, "", entries);
}

/** {@link findFenceViolation}'s walk over one listed directory, `dir`, at `rel` under the journal. */
async function walkFence(dir: string, rel: string, entries: Dirent[]): Promise<string | undefined> {
  for (const entry of [...entries].sort(byName)) {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isSymbolicLink() || fenceNameOf(entry.name) !== undefined) return path;
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    let children: Dirent[];
    try {
      children = await readdir(child, { withFileTypes: true });
    } catch (err) {
      const code = codeOf(err);
      if (code === "ENOENT" || code === "ENOTDIR") continue; // gone, or no directory any more, since the listing
      return path;
    }
    const found = await walkFence(child, path, children);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The journal, repo-relative: what a fence check that could not run refuses as. */
const JOURNAL = "desk/journal";

/** The repository's own project skill roots: dsh-skill-filesystem reads `<root>/.dsh/skills` and
 * `<root>/.agents/skills` for every session whose project root is the repository. This repository has
 * neither, so either one there is a violation. */
const ROOT_SKILL_ROOTS = [".dsh", ".agents"] as const;

/**
 * The first thing in the repository that would steer a desk session from where the desk can be steered,
 * as a path relative to `root` - `.agents`, `desk`, `desk/GRAVIT.md`, `desk/journal/a/.git` - or
 * `undefined` when there is none. Every lookup is an `lstat`, so a symlink is judged as itself, dangling
 * or not, and the volume's own case rule applies. In this order:
 * - the repository's skill roots ({@link ROOT_SKILL_ROOTS}): either one present, or not known to be
 *   absent, is its own name;
 * - `desk/` itself: a symlink is `desk`; a missing `desk/` holds nothing, and anything else it cannot
 *   tell is `desk`;
 * - the five {@link FENCE_NAMES} directly in `desk/`, in that order, without recursion: dsh reads the
 *   instruction files at every level from the project root down to the cwd, so `desk/GRAVIT.md` reaches
 *   every desk session, and a `.git` at `desk/` would make it the project root with its own skill roots.
 *   The desk's sandbox cannot write there; a workbench session at the repository root can. One there is
 *   `desk/<name>`; a `desk/` that cannot be searched is `desk`;
 * - the journal, through {@link findFenceViolation}: its answer under `desk/journal/`, and
 *   `desk/journal` for its `"."` - the journal a symlink, or unreadable.
 *
 * Never rejects.
 * @param root - the repository root.
 */
export async function findDeskFenceViolation(root: string): Promise<string | undefined> {
  for (const name of ROOT_SKILL_ROOTS) {
    try {
      await lstat(join(root, name));
      return name;
    } catch (err) {
      if (codeOf(err) !== "ENOENT") return name;
    }
  }
  const desk = join(root, "desk");
  try {
    if ((await lstat(desk)).isSymbolicLink()) return "desk";
  } catch (err) {
    return codeOf(err) === "ENOENT" ? undefined : "desk";
  }
  for (const name of FENCE_NAMES) {
    try {
      await lstat(join(desk, name));
      return `desk/${name}`;
    } catch (err) {
      if (codeOf(err) !== "ENOENT") return "desk";
    }
  }
  const found = await findFenceViolation(deskJournalDir(root));
  if (found === undefined) return undefined;
  return found === "." ? JOURNAL : `${JOURNAL}/${found}`;
}

/**
 * The phone's line for a turn the fence refused: `refused: <path> exists; it would steer every later
 * desk turn. Remove it, then write again.` For a journal violation `path` is `desk/journal/<rel>`, so
 * the line reads as the plan's Global Constraints spell it.
 * @param path - the violation, relative to the repository root ({@link findDeskFenceViolation}).
 */
export function fenceRefusalLine(path: string): string {
  return `refused: ${path} exists; it would steer every later desk turn. Remove it, then write again.`;
}

/* ---------- provenance and the desk's message sources ---------- */

/** Where a message the face sends the desk came from, as its provenance line names it. A phone's text
 * carries `at`, when the operator wrote it in ms since the epoch (Telegram's own `date`), when the bridge
 * has it. */
export type DeskSource =
  | { kind: "telegram"; at?: number }
  | { kind: "schedule"; order: string; date: string }
  | { kind: "alert"; symbol: string; rule: string };

/**
 * The bracketed first line of every message the face sends the desk:
 * `[telegram · operator · 14:03 ET]`, `[schedule · <order> · <YYYY-MM-DD>]`, `[alert · <SYMBOL> · <rule>]`.
 * A phone's time is when the operator wrote it - the source's `at`, else `now` - in America/New_York as
 * src/desk.ts `deskTime` shows it: dated when it falls on another New York date than `now`'s, as a text
 * written before a night the Mac slept through does. A schedule line carries its firing's own date.
 * `dsh/profile/desk.md` tells the model how to read each form (tests/desk-session.test.ts ties the two).
 * @param source - where the message came from.
 * @param now - when the face sends it.
 */
export function provenanceLine(source: DeskSource, now: Date): string {
  switch (source.kind) {
    case "telegram":
      return `[telegram · operator · ${deskTime(source.at === undefined ? now : new Date(source.at), now)}]`;
    case "schedule":
      return `[schedule · ${source.order} · ${source.date}]`;
    case "alert":
      return `[alert · ${source.symbol} · ${source.rule}]`;
  }
}

/* `type`, not `interface`, for the reason src/room-rules.ts gives: an interface is not assignable to
 * `Record<string, unknown>`, and `MessageLike.source` is one. */
/** A text from the operator's phone: the Telegram sender, the chat and the message's id there. */
export type TelegramMessageSource = { kind: "telegram"; from: number; chat: number; messageId: number };
/** A standing order's firing: the order, the firing's key and the trading date it fires for. */
export type ScheduleMessageSource = { kind: "schedule"; order: string; firing: string; date: string };
/** An alert the face has already sent: the alert's id and its symbol. */
export type AlertMessageSource = { kind: "alert"; alert: string; symbol: string };
/** The `source` of a message the face sends the desk: the log's, the ledger's and the client's record of
 * what {@link provenanceLine} tells the model. */
export type DeskMessageSource = TelegramMessageSource | ScheduleMessageSource | AlertMessageSource;

/* Declared kinds, so `createUserMessage` takes them (dsh-llm's map is merge-extensible; src/room-rules.ts
 * adds the room's the same way). dsh 0.2's v4 log admits any non-empty kind but `plugin`; spike 4
 * measured all three written, replayed and re-booted. */
declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    telegram: TelegramMessageSource;
    schedule: ScheduleMessageSource;
    alert: AlertMessageSource;
  }
}

/* ---------- the desk's route ---------- */

/** The desk's model route when `FACE_DESK_MODEL` names none. */
export const DESK_DEFAULT_ROUTE = "deepseek-official/deepseek-flash";

/**
 * The desk's route: `raw` (`FACE_DESK_MODEL`), or {@link DESK_DEFAULT_ROUTE} when it is unset or empty,
 * validated as a bot's route is (src/room.ts `selectionFor`): one `provider/model` pair
 * (`parseModelRoute`) that the tree serves (`llm.resolveCallConfig`). Anything else - not one pair, or a
 * route no adapter serves - is the tree's default selection, with one line to `log`: `gravit-face:
 * desk: model route <route> is not usable (<reason>); the desk uses the default <provider/model>`.
 * @param ctx - the booted ROOT context, or its slice.
 * @param raw - `FACE_DESK_MODEL`.
 * @param log - where the fallback line goes, whole.
 */
export async function resolveDeskRoute(
  ctx: Pick<RoomContextLike, "agentDefaultModel" | "llm">,
  raw: string | undefined,
  log: (line: string) => void,
): Promise<{ provider: string; model: string }> {
  const wanted = raw || DESK_DEFAULT_ROUTE;
  const route = parseModelRoute(wanted);
  let reason = "not one provider/model route";
  if (route !== undefined) {
    try {
      await ctx.llm.resolveCallConfig(route);
      return route;
    } catch (err) {
      reason = errText(err);
    }
  }
  const fallback = ctx.agentDefaultModel.currentSelection();
  log(`${BIN}: desk: model route ${wanted} is not usable (${reason}); the desk uses the default ${fallback.provider}/${fallback.model}`);
  return { provider: fallback.provider, model: fallback.model };
}

/* ---------- the desk session ---------- */

/** The permission preset every desk session runs under: writes confined to its cwd and the temp areas
 * (spike 6). */
const WORKSPACE_WRITE = "workspace-write";

/** dsh-agent's `CreateAgentOptions` as the desk fills it. No `parentAgent` and no `parentSession`: a
 * desk session is a runtime root that the face owns, and no room's member. */
export interface CreateDeskAgentOptions {
  sessionId: string;
  meta: { cwd: string; agentPreset: string };
  agentOptions: { provider: string; model: string };
  setup: MemberSetup;
}

/** What the desk session reads of the booted ROOT context, stated structurally as src/room.ts states its
 * own: the agent registry, the preset join and the permission fact. `create` and `resume` answer
 * dsh-agent's `AgentHandle`, `{ agent, dispose }` - the disposer only its holder has (dsh-agent
 * lib/types/index.d.ts:129-146); `get` answers a bare agent, someone else's to dispose. */
export interface DeskSessionCtxLike {
  agents: {
    get(id: string): AgentLike | undefined;
    create(options: CreateDeskAgentOptions): Promise<{ agent: AgentLike; dispose(): Promise<void> }>;
    resume(options: ResumeMemberOptions): Promise<{ agent: AgentLike; dispose(): Promise<void> }>;
  };
  agentPresets: RoomContextLike["agentPresets"];
  permissionPresets: RoomContextLike["permissionPresets"];
}

/** What {@link ensureDeskSession} and {@link createDeskAgent} need. `root` is the repository root, `home`
 * the harness home (the ledger's); `route`, the desk's ({@link resolveDeskRoute}); `installModelSelection`,
 * dsh-agent's, injected as src/room.ts's is (its own import when `undefined`); `now`, the clock a
 * `desk-session` event is stamped with (`Date.now`); `log`, where a failure line goes (stderr). */
export interface DeskSessionDeps {
  ctx: DeskSessionCtxLike;
  root: string;
  home: string;
  route: { provider: string; model: string };
  installModelSelection: RoomDeps["installModelSelection"];
  now?: () => number;
  log?: (line: string) => void;
}

/** The desk's composition, restating the host's own `composeAgent` as src/room.ts does: the model
 * selection, then the `gravit-desk` join - and, for a new session, the `workspace-write` pin, inside
 * setup and on setup's own agent, so it is the session's first permission fact: dsh-permission-presets
 * pins the user default on `session/created` only when there is none yet. */
function deskSetup(deps: DeskSessionDeps, route: { provider: string; model: string }, pin: boolean): MemberSetup {
  const install = deps.installModelSelection ?? ((agentCtx, ref) => installDshModelSelection(agentCtx as unknown as Context, ref));
  return async (agentCtx, agent) => {
    install(agentCtx, { current: { provider: route.provider, model: route.model }, assembled: undefined });
    await deps.ctx.agentPresets.mount(agentCtx, DESK_PRESET);
    if (pin) deps.ctx.permissionPresets.set(agent.session, WORKSPACE_WRITE);
  };
}

/** Throws unless the session runs `workspace-write` - read from the session itself, after publication,
 * whatever the announcement's listeners or the operator's browser did to it. */
function requireWorkspaceWrite(deps: DeskSessionDeps, agent: AgentLike, sessionId: string): void {
  const effective = deps.ctx.permissionPresets.current(agent.session);
  if (effective !== WORKSPACE_WRITE) throw new Error(`desk session ${sessionId} is "${effective}", not ${WORKSPACE_WRITE}; the face will not prompt it`);
}

/**
 * Create a desk agent - the `gravit-desk` preset, `workspace-write` pinned, a fresh `session-<uuid>` - in
 * `opts.cwd`, made first (`agents.create` does not make it), on `opts.route` or else the desk's. It writes
 * no ledger record: this is how P2's firings get the desk's setup without becoming the conversation
 * {@link ensureDeskSession} resumes. Rejects when creation does, and when the pin does not hold after
 * publication - the agent is disposed first, so nothing is left live that the face will not prompt.
 * @param deps - see {@link DeskSessionDeps}.
 * @param opts - `cwd`, the session's working directory; `route`, its model route.
 * @returns the agent, its session id, and `dispose`, which disposes the handle `agents.create` returned:
 *   once however often it is called, never rejecting - a failure is one `gravit-face: desk:` line.
 */
export async function createDeskAgent(
  deps: DeskSessionDeps,
  opts: { cwd: string; route?: { provider: string; model: string } },
): Promise<{ agent: AgentLike; sessionId: string; dispose(): Promise<void> }> {
  const route = opts.route ?? deps.route;
  const log = deps.log ?? defaultLog;
  await mkdir(opts.cwd, { recursive: true });
  const sessionId = `session-${randomUUID()}`;
  const handle = await deps.ctx.agents.create({
    sessionId,
    meta: { cwd: opts.cwd, agentPreset: DESK_PRESET },
    agentOptions: { provider: route.provider, model: route.model },
    setup: deskSetup(deps, route, true),
  });
  let disposing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposing ??= disposeQuietly(handle, sessionId, log);
    return disposing;
  };
  try {
    requireWorkspaceWrite(deps, handle.agent, sessionId);
  } catch (err) {
    await dispose();
    throw err;
  }
  return { agent: handle.agent, sessionId, dispose };
}

/**
 * The desk conversation: the one the ledger names last, live or resumed, while it still is a desk
 * session; else a new one.
 *
 * Makes the journal first (`mkdir -p`). Unless `opts.fresh`, it takes the newest `desk-session` the
 * ledger names: the live agent when there is one (`agents.get`), else a resume on the desk's route with
 * the desk's setup (never re-pinned); a resume that fails is one `gravit-face: desk:` line. The ledger
 * is a file in the harness home, so the id read from it is checked, never trusted: the session must be
 * a desk session by its header - the preset it was created with is `gravit-desk` (the resume's own
 * setup mounts that preset whatever the session was, so the mounted one proves nothing) and its cwd is
 * the journal. One that is not is one line and is not used. One that is must run `workspace-write`, or
 * this rejects. An agent this call resumed and does not hand back is disposed again; a live agent is
 * someone else's and never is. With no id, no usable session, or `fresh`, it creates one in the journal
 * ({@link createDeskAgent}) and records it as a `desk-session` event, `created`, or `new` when `fresh`.
 * Only a creation is recorded. Rejects too when the ledger cannot be read (src/desk.ts `readEvents`): a
 * conversation the face could not find again is not opened.
 *
 * ONE CALLER AT A TIME. Two calls at once would both find no conversation in the ledger and both open
 * one. The desk's one owner, src/desk-conversation.ts, runs each call once the one before has settled;
 * any other caller must do the same.
 * @param deps - see {@link DeskSessionDeps}.
 * @param opts - `fresh`, for another conversation (the phone's `/new`).
 */
export async function ensureDeskSession(
  deps: DeskSessionDeps,
  opts: { fresh?: boolean } = {},
): Promise<{ agent: AgentLike; sessionId: string; created: boolean }> {
  const journal = deskJournalDir(deps.root);
  await mkdir(journal, { recursive: true });
  const log = deps.log ?? defaultLog;
  if (opts.fresh !== true) {
    const id = lastDeskSession((await readEvents(deps.home)).events);
    const found = id === undefined ? undefined : await reopenDesk(deps, id, journal, log);
    if (found !== undefined) return found;
  }
  const { agent, sessionId } = await createDeskAgent(deps, { cwd: journal });
  const t = new Date((deps.now ?? Date.now)()).toISOString();
  await appendEvent(deps.home, { t, kind: "desk-session", sessionId, reason: opts.fresh === true ? "new" : "created" }, { log });
  return { agent, sessionId, created: true };
}

/** The ledger's desk conversation `id`, live or resumed, when it is a desk session in `journal` that runs
 * `workspace-write`; `undefined`, with a line, when it cannot be had or is not a desk session; a
 * rejection when it runs anything but `workspace-write`. What this resumed and does not return, it
 * disposes. */
async function reopenDesk(
  deps: DeskSessionDeps,
  id: string,
  journal: string,
  log: (line: string) => void,
): Promise<{ agent: AgentLike; sessionId: string; created: false } | undefined> {
  const live = deps.ctx.agents.get(id);
  const resumed = live === undefined ? await resumeDesk(deps, id, log) : undefined;
  const agent = live ?? resumed?.agent;
  if (agent === undefined) return undefined;
  const wrong = notTheDesk(agent.session.header, journal);
  if (wrong !== undefined) {
    log(`${BIN}: desk: session ${id}, the ledger's desk conversation, is not a desk session (${wrong}); opening a new one`);
    if (resumed !== undefined) await disposeQuietly(resumed, id, log);
    return undefined;
  }
  try {
    requireWorkspaceWrite(deps, agent, id);
  } catch (err) {
    if (resumed !== undefined) await disposeQuietly(resumed, id, log);
    throw err;
  }
  return { agent, sessionId: id, created: false };
}

/** The cold desk conversation `id`, resumed - its handle, so the face can dispose what it resumed - or
 * `undefined`, with its line, when it cannot be. */
async function resumeDesk(
  deps: DeskSessionDeps,
  id: string,
  log: (line: string) => void,
): Promise<{ agent: AgentLike; dispose(): Promise<void> } | undefined> {
  try {
    const route = { provider: deps.route.provider, model: deps.route.model };
    return await deps.ctx.agents.resume({ resumeSessionId: id, agentOptions: route, setup: deskSetup(deps, route, false) });
  } catch (err) {
    log(`${BIN}: desk: desk session ${id} could not be resumed (${errText(err)}); opening a new one`);
    return undefined;
  }
}

/** A header value as a line quotes it: `"gravit"`, or `unset`. */
const quoted = (value: string | undefined): string => (value === undefined ? "unset" : JSON.stringify(value));

/** Why `header` is not a desk session's, or `undefined` when it is one: created with the `gravit-desk`
 * preset, in `journal`. */
function notTheDesk(header: SessionLike["header"], journal: string): string | undefined {
  if (header.agentPreset !== DESK_PRESET) return `its preset is ${quoted(header.agentPreset)}, not ${DESK_PRESET}`;
  if (header.cwd === undefined || resolve(header.cwd) !== resolve(journal)) return `its cwd is ${quoted(header.cwd)}, not ${journal}`;
  return undefined;
}

/** Dispose a handle the face holds; a failure is one line, never a rejection. */
async function disposeQuietly(handle: { dispose(): Promise<void> }, id: string, log: (line: string) => void): Promise<void> {
  try {
    await handle.dispose();
  } catch (err) {
    log(`${BIN}: desk: desk session ${id} could not be disposed: ${errText(err)}`);
  }
}

/* ---------- supervision ---------- */

/** The root bus as src/room.ts listens to it: every event of every session, `(session, event)`. */
export type SessionEventsOn = (event: "session/event", listener: (session: { id: string }, event: EventLike) => void) => () => void;

/** The supervisor's clock, injected as src/room.ts's `RoomClock` is. */
export interface DeskClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}
const defaultClock: DeskClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** One supervised turn, as its owner records it. `source` is the kind of the turn's first
 * `user/message` (`telegram`, `schedule`, `alert`, ...), or `wake` for a background job's notice
 * (`tool-jobs`) and for a turn that claimed no message. `outcome` is `timed-out` when the supervisor's
 * deadline cut the turn, or `refused` when its fence check found `violation` (repo-relative) while the
 * turn ran - the supervisor's own cut wins over whatever the turn ended in; else `cancelled` when
 * something else cancelled it - a shutdown, the phone's `/stop`, the browser's stop - `cancel` saying
 * what ({@link cancelOf}); else `failed` when the turn ended on an error or a blocked pre-step, `error`
 * saying which ({@link failureOf}); else `ended`. `finalText` is the turn's final assistant text
 * (src/room-rules.ts `finalTextOf`), empty when it ended on a tool; `interrupted` is there, `true`, when
 * that text ends in the answer a cut interrupted mid-stream (dsh writes it as an `assistant/message`
 * marked `interrupted`). `usage`, its tokens in the ledger's four buckets with every route as
 * `provider/model`, absent when the harness could not account for the turn. `startedAt` is ISO-8601
 * UTC; `wallMs`, from `turn/start` to `turn/end`; `deadlineMs`, the deadline that applied. */
export interface DeskTurnRecord {
  sessionId: string;
  turn: number;
  source: string;
  outcome: "ended" | "timed-out" | "refused" | "cancelled" | "failed";
  finalText: string;
  interrupted?: true;
  usage?: TurnUsage;
  startedAt: string;
  wallMs: number;
  deadlineMs: number;
  violation?: string;
  cancel?: string;
  error?: string;
}

/** What {@link superviseDeskTurns} needs. `deadlineMs` is every turn's deadline - a whole number of
 * milliseconds in 1..2147483647, the longest a timer holds - and the ceiling of any shorter one
 * `deadlineFor` gives a source; `onTurnEnd`, the owner's hand for each record, synchronous or async;
 * `fence`, the instruction-chain check run at every turn's start (none when absent); `clock`, the timers
 * (the global ones by default); `log`, where a failure line goes (stderr). */
export interface SuperviseDeskTurnsDeps {
  on: SessionEventsOn;
  sessionId: string;
  agent: AgentLike;
  deadlineMs: number;
  clock?: DeskClock;
  onTurnEnd: (record: DeskTurnRecord) => void | Promise<void>;
  fence?: () => Promise<string | undefined>;
  deadlineFor?: (sourceKind: string) => number | undefined;
  log?: (line: string) => void;
}

/** A turn between its `turn/start` and its `turn/end`. */
interface OpenTurn {
  readonly turn: number;
  readonly startedAt: number;
  /** Every event of the session from `turn/start` on: the slice `deriveTurnTokenUsage` folds. */
  readonly events: EventLike[];
  source?: string;
  deadlineMs: number;
  timer?: unknown;
  /** Why the supervisor cancelled it, once it has. */
  cut?: { by: "deadline" } | { by: "fence"; violation: string };
}

/** A source kind as a record names it: a job's notice and a turn that claimed no message are `wake`. */
const sourceName = (kind: unknown): string => (typeof kind !== "string" || kind === "" || kind === "tool-jobs" ? "wake" : kind);

/** The longest `error` a record carries, in characters (code points, so a surrogate pair is never cut). */
const ERROR_MAX_CHARS = 200;

/**
 * Why a turn failed, from its `turn/end` reason as dsh-agent-loop writes it (lib/index.js: the reason
 * is appended at 1027): `blocked` for `{ kind: "blocked" }`, a pre-step that rejected the step (959);
 * for `{ kind: "error", error }` (1017-1023), where `error` is an `LlmFailure` or `{ message:
 * errorChain(error), code: "UNKNOWN" }`, the error's message - its first line, at most
 * {@link ERROR_MAX_CHARS} characters - or its `code` when the message is empty. Any other reason -
 * `completed`, `aborted`, ... - is no failure: `undefined`.
 * @param reason - the `turn/end` event's `reason`.
 */
function failureOf(reason: unknown): string | undefined {
  const r = reason as { kind?: unknown; error?: { message?: unknown; code?: unknown } } | null | undefined;
  if (r?.kind === "blocked") return "blocked";
  if (r?.kind !== "error") return undefined;
  const message = typeof r.error?.message === "string" ? r.error.message : "";
  const line = (message.split(/\r?\n/, 1)[0] ?? "").trim();
  const code = typeof r.error?.code === "string" && r.error.code !== "" ? r.error.code : "error";
  return Array.from(line === "" ? code : line).slice(0, ERROR_MAX_CHARS).join("");
}

/**
 * What cancelled a turn, from its `turn/end` reason as dsh-agent-loop writes an aborted one (lib/index.js:
 * `{ kind: "aborted", reason }`, the reason copied from the cancel's cause, 731-744 and 1009-1014): a hook's
 * own words (`shutdown`, `stopped from the phone`), `stopped in the browser` for the operator's stop button
 * (`user`), `its parent cancelled it` (`parent`) and `its agent was disposed` (`disposed`); `unknown` for an
 * aborted turn that names no cause. `undefined` for any reason that is no abort.
 * @param reason - the `turn/end` event's `reason`.
 */
function cancelOf(reason: unknown): string | undefined {
  const r = reason as { kind?: unknown; reason?: { kind?: unknown; reason?: unknown } } | null | undefined;
  if (r?.kind !== "aborted") return undefined;
  const cause = r.reason;
  switch (cause?.kind) {
    case "hook":
      return typeof cause.reason === "string" && cause.reason !== "" ? cause.reason : "unknown";
    case "user":
      return "stopped in the browser";
    case "parent":
      return "its parent cancelled it";
    case "disposed":
      return "its agent was disposed";
    default:
      return "unknown";
  }
}

/**
 * Whether turn `turn`'s final text ends in an answer a cut interrupted: its last `assistant/message` after the
 * last `tool/result` - the message the final text ends in - is one dsh marked `interrupted`, which it writes
 * only for a stream an abort cut short (dsh-agent-loop lib/index.js 1083-1100), and the final text is not empty.
 * @param events - the turn's events.
 * @param turn - its number.
 * @param finalText - its final text (src/room-rules.ts `finalTextOf`).
 */
function cutMidAnswer(events: readonly EventLike[], turn: number, finalText: string): boolean {
  if (finalText === "") return false;
  let last: { interrupted?: unknown } | undefined;
  for (const event of events) {
    const data = event.data as { turn?: unknown; interrupted?: unknown } | undefined;
    if (data === undefined || data.turn !== turn) continue;
    if (event.type === "tool/result") last = undefined;
    else if (event.type === "assistant/message") last = data;
  }
  return last?.interrupted === true;
}

/** dsh-agent's `Agent.inbox` as the desk reads it, which the structural {@link AgentLike} leaves out: the messages
 * waiting for turns of their own, oldest first, and taking one out (dsh-agent `Inbox`). */
type InboxAware = { inbox?: { readonly nextTurn: readonly MessageLike[]; remove(id: string): boolean } };

/**
 * Cancel the turn under way on `agent` with `cause` - and only that turn: what waits in its inbox is kept, and every
 * message queued for a turn of its own is answered.
 *
 * dsh's `cancel(cause, { keepInbox: true })` keeps the inbox, but a message queued while the turn ran then waits
 * there, unanswered, until something else wakes the agent: once the cut turn has unwound, the driver goes idle
 * without looking at the inbox (dsh-agent-loop lib/index.js `kick`; tests/desk-smoke.test.ts measures it on a real
 * tree). A message sent after the cancel, though, is queued for the next turn and runs once the cut turn has
 * unwound (dsh-agent `Agent.send`). So, in the same tick as the cancel, each message on the inbox's next-turn list
 * is taken out and sent again with `followup`, oldest first: the list ends as it began, in the order the operator
 * sent them, and each is answered in its own turn - with its own deadline, fence check and record. The input waiting
 * for the next step (a browser's steer) is kept and not sent again: dsh's own stop leaves it so. An agent without an
 * inbox is only cancelled.
 *
 * The phone's `/stop` (src/desk-conversation.ts) and the supervisor's deadline ({@link superviseDeskTurns}) cut this
 * way. The fence's cut keeps the inbox but sends nothing again: a turn opened that way would start over the violation
 * before its own check ran, so a queued message waits for the next post, which the owner's fence check refuses first.
 * Shutdown keeps nothing (src/desk-conversation.ts `dispose`).
 * @param agent - the desk agent.
 * @param cause - the cancel's cause.
 * @param log - where the line goes for a message that could not be sent again: taken out, it is lost.
 * @returns how many messages it sent again.
 * @throws what `agent.cancel` throws; then nothing is sent again.
 */
export function cancelKeepingQueue(agent: AgentLike, cause: { kind: "hook"; reason: string }, log: (line: string) => void): number {
  agent.cancel(cause, { keepInbox: true });
  const inbox = (agent as AgentLike & InboxAware).inbox;
  if (inbox === undefined) return 0;
  let sent = 0;
  for (const message of [...inbox.nextTurn]) {
    if (!inbox.remove(message.id)) continue; // taken by a turn since: it is answered there
    try {
      agent.followup(message);
      sent += 1;
    } catch (err) {
      log(`${BIN}: desk: a message queued on desk session ${agent.id} could not be queued again after the cut, and is lost: ${errText(err)}`);
    }
  }
  return sent;
}

/** The longest delay a timer keeps: 2^31 - 1 ms, about 24.8 days. Node fires a longer one at once. */
const MAX_TIMER_MS = 2_147_483_647;
/** Whether `ms` is a deadline a timer can hold: a whole number of milliseconds in 1..{@link MAX_TIMER_MS}. */
const isTimerMs = (ms: number): boolean => Number.isInteger(ms) && ms >= 1 && ms <= MAX_TIMER_MS;

/** A turn's tokens as the ledger keeps them, or `undefined` when `deriveTurnTokenUsage` cannot prove
 * them. A bucket it leaves out is 0 and absent routes are `[]`; `totalTokens` and `reasoningTokens` are
 * not kept. */
function turnUsage(events: readonly EventLike[]): TurnUsage | undefined {
  const usage = deriveTurnTokenUsage(events as unknown as Parameters<typeof deriveTurnTokenUsage>[0]);
  if (usage === undefined) return undefined;
  return {
    uncachedInputTokens: usage.uncachedInputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    routes: (usage.routes ?? []).map((route) => `${route.provider}/${route.model}`),
  };
}

/**
 * Supervise every turn on the desk session `sessionId`, whoever opened it, until the returned disposer
 * is called.
 *
 * At each `turn/start` on that session: a timer of exactly `deadlineMs`, never extended - not for a
 * running tool, not for a pending card - that cancels the turn with `{ kind: "hook", reason: "desk
 * deadline" }`, keeping the inbox and waking the agent for what waits there ({@link cancelKeepingQueue}),
 * so a cut turn never leaves the operator's later messages queued in silence; and, when `fence` is given,
 * the fence check, which cancels the turn with `{ kind: "hook", reason: "desk fence" }`, keeping the inbox
 * for the next post, if it finds a violation while the turn still runs. A
 * check that rejects while its turn runs counts as a violation at `desk/journal`, with one line; a check
 * that settles after the turn ended, either way, changes nothing and says nothing, and the next turn's
 * check runs again. When the turn's first `user/message` arrives, `deadlineFor` is asked by the
 * source's name as the record gives it. An answer below `deadlineMs` moves the deadline to that long
 * after `turn/start` - or cancels at once, when that moment has passed. No answer, or a non-finite one,
 * changes nothing; a finite one that is not a deadline a timer can hold (a whole number of milliseconds
 * in 1..2147483647) changes nothing either, with one line, and so does a `deadlineFor` that throws.
 * Only the first cancel of a turn is sent; a cancel that throws is one line.
 *
 * Every event of the turn is collected from the bus, and at its `turn/end` the turn is one
 * {@link DeskTurnRecord}, handed to `onTurnEnd` in a microtask: the bus calls this listener inside the
 * session's own append, which refuses reentry, so nothing an owner does in reply - a followup, a cancel -
 * runs there; for the same reason a cancel that is due at once waits for a microtask. A throw from
 * `onTurnEnd`, or the rejection of the promise it returns, is one line - never an exception in the
 * append, never an unhandled rejection, which ends the face (main.ts `installFailLoud`). A turn already
 * running when the supervisor is installed is not this supervisor's; a `turn/start` while a turn is open
 * drops that turn, unrecorded, with one line.
 * @param deps - see {@link SuperviseDeskTurnsDeps}.
 * @returns the disposer: it clears every timer and the listener, and is idempotent.
 * @throws a `RangeError`, before anything is installed, unless `deadlineMs` is a whole number of
 *   milliseconds in 1..2147483647.
 */
export function superviseDeskTurns(deps: SuperviseDeskTurnsDeps): () => void {
  if (!isTimerMs(deps.deadlineMs)) {
    throw new RangeError(`superviseDeskTurns: deadlineMs must be a whole number of milliseconds in 1..${MAX_TIMER_MS}, got ${String(deps.deadlineMs)}`);
  }
  const clock = deps.clock ?? defaultClock;
  const log = deps.log ?? defaultLog;
  const where = `desk session ${deps.sessionId}`;
  let open: OpenTurn | undefined;
  let disposed = false;

  const disarm = (turn: OpenTurn): void => {
    if (turn.timer === undefined) return;
    clock.clearTimeout(turn.timer);
    turn.timer = undefined;
  };

  /** Cancel `turn` for `why`, if it is still the open turn and nothing has cancelled it yet. Runs from a
   * timer or a promise, never from the bus listener: a throw there would be uncaught. */
  const cut = (turn: OpenTurn, why: NonNullable<OpenTurn["cut"]>): void => {
    if (disposed || open !== turn || turn.cut !== undefined) return;
    turn.cut = why;
    try {
      /* the deadline's later messages are answered; the fence's wait for a post the fence check refuses first */
      if (why.by === "deadline") cancelKeepingQueue(deps.agent, { kind: "hook", reason: "desk deadline" }, log);
      else deps.agent.cancel({ kind: "hook", reason: "desk fence" }, { keepInbox: true });
    } catch (err) {
      log(`${BIN}: desk: turn ${turn.turn} on ${where} could not be cancelled: ${errText(err)}`);
    }
  };

  const arm = (turn: OpenTurn, ms: number): void => {
    disarm(turn);
    turn.timer = clock.setTimeout(() => {
      turn.timer = undefined;
      cut(turn, { by: "deadline" });
    }, ms);
  };

  const begin = (n: number, event: EventLike): void => {
    if (open !== undefined) {
      disarm(open);
      log(`${BIN}: desk: turn ${open.turn} on ${where} saw no turn/end before turn ${n} began; it goes unrecorded`);
    }
    const turn: OpenTurn = { turn: n, startedAt: clock.now(), events: [event], deadlineMs: deps.deadlineMs };
    open = turn;
    arm(turn, deps.deadlineMs);
    const fence = deps.fence;
    if (fence === undefined) return;
    void Promise.resolve()
      .then(() => fence())
      .then(
        (path) => {
          if (path !== undefined) cut(turn, { by: "fence", violation: path });
        },
        (err: unknown) => {
          if (disposed || open !== turn) return; // the turn is over: nothing to refuse, nothing to say
          log(`${BIN}: desk: the fence check for turn ${turn.turn} on ${where} failed (${errText(err)}); it counts as a violation at ${JOURNAL}`);
          cut(turn, { by: "fence", violation: JOURNAL });
        },
      );
  };

  const firstMessage = (turn: OpenTurn, event: EventLike): void => {
    turn.source = sourceName((event.data as { source?: { kind?: unknown } } | undefined)?.source?.kind);
    let ms: number | undefined;
    try {
      ms = deps.deadlineFor?.(turn.source);
    } catch (err) {
      log(`${BIN}: desk: deadlineFor failed for the ${turn.source} turn ${turn.turn} on ${where} (${errText(err)}); it keeps ${turn.deadlineMs} ms`);
      return;
    }
    if (typeof ms !== "number" || !Number.isFinite(ms)) return;
    if (!isTimerMs(ms)) {
      log(`${BIN}: desk: deadlineFor gave ${ms} ms for the ${turn.source} turn ${turn.turn} on ${where}, not a whole number of milliseconds in 1..${MAX_TIMER_MS}; it keeps ${turn.deadlineMs} ms`);
      return;
    }
    if (ms >= turn.deadlineMs) return;
    turn.deadlineMs = ms;
    const left = turn.startedAt + ms - clock.now();
    if (left > 0) {
      arm(turn, left);
      return;
    }
    disarm(turn);
    queueMicrotask(() => cut(turn, { by: "deadline" }));
  };

  const end = (turn: OpenTurn, event: EventLike): void => {
    disarm(turn);
    open = undefined;
    let usage: TurnUsage | undefined;
    try {
      usage = turnUsage(turn.events);
    } catch (err) {
      log(`${BIN}: desk: the tokens of turn ${turn.turn} on ${where} could not be read: ${errText(err)}`);
    }
    /* The supervisor's own cut wins: the turn its cancel ended may well report an error too. */
    const reason = (event.data as { reason?: unknown } | undefined)?.reason;
    const cancel = turn.cut === undefined ? cancelOf(reason) : undefined;
    const failure = turn.cut === undefined && cancel === undefined ? failureOf(reason) : undefined;
    const outcome: DeskTurnRecord["outcome"] = turn.cut !== undefined
      ? (turn.cut.by === "deadline" ? "timed-out" : "refused")
      : cancel !== undefined ? "cancelled" : failure !== undefined ? "failed" : "ended";
    const finalText = finalTextOf(turn.events, turn.turn);
    const record: DeskTurnRecord = {
      sessionId: deps.sessionId,
      turn: turn.turn,
      source: turn.source ?? "wake",
      outcome,
      finalText,
      ...(cutMidAnswer(turn.events, turn.turn, finalText) ? { interrupted: true as const } : {}),
      ...(usage === undefined ? {} : { usage }),
      startedAt: new Date(turn.startedAt).toISOString(),
      wallMs: clock.now() - turn.startedAt,
      deadlineMs: turn.deadlineMs,
      ...(turn.cut?.by === "fence" ? { violation: turn.cut.violation } : {}),
      ...(cancel === undefined ? {} : { cancel }),
      ...(failure === undefined ? {} : { error: failure }),
    };
    /* A then-callback, not a bare call: a throw and a rejected promise both end in the one catch. */
    void Promise.resolve()
      .then(() => deps.onTurnEnd(record))
      .catch((err: unknown) => {
        log(`${BIN}: desk: turn ${record.turn} on ${where} ended but its owner failed on it: ${errText(err)}`);
      });
  };

  const off = deps.on("session/event", (session, event) => {
    if (disposed || session.id !== deps.sessionId) return;
    const n = (event.data as { turn?: unknown } | undefined)?.turn;
    if (event.type === "turn/start" && typeof n === "number") {
      begin(n, event);
      return;
    }
    const turn = open;
    if (turn === undefined) return;
    turn.events.push(event);
    if (event.type === "user/message" && turn.source === undefined) firstMessage(turn, event);
    else if (event.type === "turn/end" && n === turn.turn) end(turn, event);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    if (open !== undefined) disarm(open);
    open = undefined;
    off();
  };
}
