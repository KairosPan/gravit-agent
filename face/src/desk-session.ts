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
 * and the repository's own skill roots. {@link findChainViolation} looks for one along the chain from the
 * repository root to any cwd inside it - P2's firings run in the journal and, in P4, in `strategies/<name>` -
 * and {@link findDeskFenceViolation} is that check for the journal;
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
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection as installDshModelSelection } from "@deepseek-ai/dsh-agent";
import { deriveTurnTokenUsage } from "@deepseek-ai/dsh-token-meter/client";
import { appendEvent, deskTime, lastDeskSession, readEvents, type DeskEvent, type TurnUsage } from "./desk.ts";
import { FENCE_NAMES, fenceNameOf } from "./desk-names.ts";
import { DESK_PRESET } from "./desk-preset.ts";
import { formatDuration } from "./producer.ts";
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

/** The entry of `names` that is a {@link FENCE_NAMES} name, compared as a case-insensitive volume compares it
 * (src/desk-names.ts `fenceNameOf`), as it is named on disk: the names taken in {@link FENCE_NAMES}' order,
 * and for each the first such entry in code-unit order; `undefined` when there is none. */
function fenceEntry(names: readonly string[]): string | undefined {
  const sorted = [...names].sort();
  for (const name of FENCE_NAMES) {
    const entry = sorted.find((candidate) => fenceNameOf(candidate) === name);
    if (entry !== undefined) return entry;
  }
  return undefined;
}

/**
 * The first thing in the repository that would steer a desk session whose cwd is `cwd`, as a path relative to
 * `root` - `.agents`, `strategies/demo`, `desk/GRAVIT.md`, `desk/journal/a/.git` - or `undefined` when there is
 * none: the instruction-chain fence for any cwd (rulings P2-4, P2-15). dsh reads `GRAVIT.md` and
 * `GRAVIT.local.md` in every directory from the project root - the nearest ancestor holding a `.git` - down to
 * the cwd, and below it whenever a turn touches a file there; under a project root, `.dsh/skills` and
 * `.agents/skills` are skill roots. So a desk session can be steered from the directories strictly between
 * `root` and its cwd, from anywhere under the cwd, and from the repository's own skill roots - all three of which
 * a workbench session at the repository root can write. In this order:
 * - the repository's skill roots ({@link ROOT_SKILL_ROOTS}), by `lstat`: either one present, or not known to be
 *   absent, is its own name. The root's own `GRAVIT.md`, `GRAVIT.local.md` and `.git` are the repository's, and
 *   are not checked;
 * - each directory from the first below `root` down to `cwd` itself, top down, by `lstat`: a symlink is the
 *   violation, by its path; one that is not there (ENOENT, ENOTDIR) ends the check clean, nothing below it
 *   being there either; any other failure is the violation. Each directory strictly between `root` and `cwd` is
 *   then listed, before the directory below it, for the five {@link FENCE_NAMES} ({@link fenceEntry}) - without
 *   recursion, case-folded, answered as named on disk: `.git` there would make it the project root with skill
 *   roots of its own. One that cannot be listed - a file where a directory should be included - is the
 *   violation, by its path; one gone since its `lstat` (ENOENT) holds nothing;
 * - `cwd`'s own tree, through {@link findFenceViolation}: a fence name at any depth, any symlink, or a directory
 *   it cannot list is the violation, under `cwd`'s path; `cwd` itself when it cannot be listed at all.
 *
 * Every lookup is an `lstat` or a listing, so a symlink is judged as itself, dangling or not; paths are joined
 * with `/`. It fails closed: what it cannot read counts as found. Never rejects, but on a `cwd` that is not
 * strictly inside `root` - `root` itself, outside it, or out of it through `..`; both are resolved first -
 * which is the caller's mistake: a `TypeError`, before the disk is touched.
 * @param root - the repository root.
 * @param cwd - the session's working directory, strictly inside `root`.
 */
export async function findChainViolation(root: string, cwd: string): Promise<string | undefined> {
  const base = resolve(root);
  const rel = relative(base, resolve(cwd));
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new TypeError(`findChainViolation takes a cwd strictly inside ${base}, not ${JSON.stringify(cwd)}`);
  }
  for (const name of ROOT_SKILL_ROOTS) {
    try {
      await lstat(join(base, name));
      return name;
    } catch (err) {
      if (codeOf(err) !== "ENOENT") return name;
    }
  }
  const segments = rel.split(sep);
  for (let depth = 1; depth <= segments.length; depth++) {
    const dir = join(base, ...segments.slice(0, depth));
    const at = segments.slice(0, depth).join("/");
    try {
      if ((await lstat(dir)).isSymbolicLink()) return at;
    } catch (err) {
      const code = codeOf(err);
      return code === "ENOENT" || code === "ENOTDIR" ? undefined : at;
    }
    if (depth === segments.length) break; // the cwd: walked below
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      if (codeOf(err) === "ENOENT") continue; // gone since its lstat: the levels below find nothing there either
      return at;
    }
    const entry = fenceEntry(names);
    if (entry !== undefined) return `${at}/${entry}`;
  }
  const at = segments.join("/");
  const found = await findFenceViolation(join(base, ...segments));
  if (found === undefined) return undefined;
  return found === "." ? at : `${at}/${found}`;
}

/**
 * The first thing in the repository that would steer the desk conversation, whose cwd is the journal:
 * {@link findChainViolation} over `<root>/desk/journal` ({@link deskJournalDir}) - the repository's skill roots,
 * `desk/` and the journal by `lstat`, the five {@link FENCE_NAMES} in `desk/`, the journal's tree - answered
 * repo-relative: `.agents`, `desk`, `desk/GRAVIT.md`, `desk/journal`, `desk/journal/a/.git`. The desk's sandbox
 * cannot write `desk/`; a workbench session at the repository root can. Never rejects.
 * @param root - the repository root.
 */
export async function findDeskFenceViolation(root: string): Promise<string | undefined> {
  return findChainViolation(root, deskJournalDir(root));
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
 * has it, and `carried` when the boot posts it again after a graceful stop carried it through the ledger
 * (src/desk-conversation.ts, spec §16 H3), and `network`, the network it came through (`slack`), when the bridge has it:
 * the kind stays `telegram` - the ledger, the session logs and the carry read it (plan B2, ruling 12). `alerts` is a batch of `count` alerts the face has already sent at once; `state`, the face's view of
 * the desk injected just before a phone's text (src/desk-conversation.ts `setState`). */
export type DeskSource =
  | { kind: "telegram"; network?: string; at?: number; carried?: true }
  | { kind: "schedule"; order: string; date: string }
  | { kind: "alert"; symbol: string; rule: string }
  | { kind: "alerts"; count: number }
  | { kind: "state" };

/**
 * The bracketed first line of every message the face sends the desk:
 * `[telegram · operator · 14:03 ET]` - `[slack · operator · 14:03 ET]` for a text that came through Slack, the source's
 * `network` when it has one, else `telegram` - `[schedule · <order> · <YYYY-MM-DD>]`, `[alert · <SYMBOL> · <rule>]`,
 * `[alerts · <n> · 09:30 ET]` and `[desk · state · 14:03 ET]`, the last two at `now`. A phone's time is
 * when the operator wrote it - the source's `at`, else `now` - in America/New_York as src/desk.ts
 * `deskTime` shows it: dated when it falls on another New York date than `now`'s, as a text written before a
 * night the Mac slept through does - and, for a text carried over a restart, `(carried over a restart)` after it:
 * `[telegram · operator · 13:55 ET (carried over a restart)]`. A schedule line carries its firing's own date.
 * `dsh/profile/desk.md` tells the model how to read each form (tests/desk-session.test.ts ties the two).
 * @param source - where the message came from.
 * @param now - when the face sends it.
 */
export function provenanceLine(source: DeskSource, now: Date): string {
  switch (source.kind) {
    case "telegram":
      return `[${source.network ?? "telegram"} · operator · ${deskTime(source.at === undefined ? now : new Date(source.at), now)}${source.carried === true ? " (carried over a restart)" : ""}]`;
    case "schedule":
      return `[schedule · ${source.order} · ${source.date}]`;
    case "alert":
      return `[alert · ${source.symbol} · ${source.rule}]`;
    case "alerts":
      return `[alerts · ${source.count} · ${deskTime(now, now)}]`;
    case "state":
      return `[desk · state · ${deskTime(now, now)}]`;
  }
}

/* `type`, not `interface`, for the reason src/room-rules.ts gives: an interface is not assignable to
 * `Record<string, unknown>`, and `MessageLike.source` is one. */
/** A text from the operator's phone: the network it came through and its id there, `<network>:<id>`, as the account's
 * inbox hands it over (src/phone-bridge.ts) - or, in a desk session an older face wrote, the Telegram sender, the chat
 * and the message's number there (the retired src/telegram.ts). */
export type TelegramMessageSource =
  | { kind: "telegram"; network: string; messageId: string }
  | { kind: "telegram"; from: number; chat: number; messageId: number };
/** A standing order's firing: the order, the firing's key and the trading date it fires for. */
export type ScheduleMessageSource = { kind: "schedule"; order: string; firing: string; date: string };
/** An alert the face has already sent: the alert's id - or the pass's, for several - its symbol or symbols, and its pass. */
export type AlertMessageSource = { kind: "alert"; alert: string; symbol: string; pass?: string };
/** The face's view of the desk, injected before a phone's text: context, never what names a turn. */
export type DeskStateMessageSource = { kind: "desk"; form: "state" };
/** The `source` of a message the face sends the desk: the log's, the ledger's and the client's record of
 * what {@link provenanceLine} tells the model. */
export type DeskMessageSource = TelegramMessageSource | ScheduleMessageSource | AlertMessageSource | DeskStateMessageSource;

/* Declared kinds, so `createUserMessage` takes them (dsh-llm's map is merge-extensible; src/room-rules.ts
 * adds the room's the same way). dsh 0.2's v4 log admits any non-empty kind but `plugin`; spike 4
 * measured the first three written, replayed and re-booted; `desk` is the desk state's. */
declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    telegram: TelegramMessageSource;
    schedule: ScheduleMessageSource;
    alert: AlertMessageSource;
    desk: DeskStateMessageSource;
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

/** dsh-agent's `CreateAgentOptions` as the desk fills it. No `parentAgent`, and no `parentSession` for the desk: a
 * desk session is a runtime root that the face owns, and no room's member. A task worker (src/task-worker.ts) names
 * its conversation as `parentSession`, still with no `parentAgent`. */
export interface CreateDeskAgentOptions {
  sessionId: string;
  meta: { cwd: string; agentPreset: string; parentSession?: string };
  agentOptions: { provider: string; model: string };
  setup: MemberSetup;
}

/** dsh-session-persistence's service as the desk reads it (lib/types/index.d.ts `open`, `flush`; lib/types/handle.d.ts
 * `SessionHandle.read`): a stored session's log opened for reading - `read(offset, length)` answers the events from
 * `offset`, at most `length` of them, and none past the end; the handle is closed by its `Symbol.asyncDispose` - and
 * `flush`, which resolves once every append made so far is durable. */
export interface DeskSessionPersistenceLike {
  open(id: string, access: "read"): Promise<{
    read(offset?: number, length?: number): Promise<{ events: readonly EventLike[] }>;
    [Symbol.asyncDispose](): Promise<void>;
  }>;
  flush(): Promise<void>;
}

/** What the desk session reads of the booted ROOT context, stated structurally as src/room.ts states its
 * own: the agent registry, the preset join and the permission fact. `create` and `resume` answer
 * dsh-agent's `AgentHandle`, `{ agent, dispose }` - the disposer only its holder has (dsh-agent
 * lib/types/index.d.ts:129-146); `get` answers a bare agent, someone else's to dispose. `sessionPersistence`, the
 * session logs on disk, is what a keyed post checks and flushes (src/desk-conversation.ts); src/desk.ts hands the
 * booted context's to a slice that lacks it, and a post with no key never reads it. */
export interface DeskSessionCtxLike {
  agents: {
    get(id: string): AgentLike | undefined;
    create(options: CreateDeskAgentOptions): Promise<{ agent: AgentLike; dispose(): Promise<void> }>;
    resume(options: ResumeMemberOptions): Promise<{ agent: AgentLike; dispose(): Promise<void> }>;
  };
  agentPresets: RoomContextLike["agentPresets"];
  permissionPresets: RoomContextLike["permissionPresets"];
  sessionPersistence?: DeskSessionPersistenceLike;
}

/** How many events {@link readSessionEvents} asks for at a time. */
const LOG_PAGE = 512;

/**
 * Session `sessionId`'s log as it is on disk now: opened for reading and read in pages of {@link LOG_PAGE} until a
 * page comes back empty, then closed. A keyed post's seen set is built from it (src/desk-conversation.ts).
 * @param ctx - the desk session's slice of the root context, its `sessionPersistence` with it.
 * @param sessionId - the stored session to read.
 * @returns every event of the log, in order.
 * @throws when the slice has no `sessionPersistence`, and when the open or a read rejects.
 */
export async function readSessionEvents(ctx: DeskSessionCtxLike, sessionId: string): Promise<EventLike[]> {
  const persistence = ctx.sessionPersistence;
  if (persistence === undefined) throw new Error("this face has no session persistence");
  const handle = await persistence.open(sessionId, "read");
  try {
    const events: EventLike[] = [];
    for (;;) {
      const page = await handle.read(events.length, LOG_PAGE);
      if (page.events.length === 0) return events;
      events.push(...page.events);
    }
  } finally {
    await handle[Symbol.asyncDispose]();
  }
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
 * `opts.cwd`, made first (`agents.create` does not make it) unless `make` is false, on `opts.route` or else the
 * desk's. With `make: false` - a strategy's firing, whose directory is the operator's and is never recreated - a
 * cwd that is not there rejects with `<cwd, repo-relative> is gone`, and one that is not a directory with `<cwd>
 * is not a directory`, before any session exists. It writes no ledger record: this is how P2's firings get the
 * desk's setup without becoming the conversation {@link ensureDeskSession} resumes. Rejects when creation does,
 * and when the pin does not hold after publication - the agent is disposed first, so nothing is left live that
 * the face will not prompt.
 * @param deps - see {@link DeskSessionDeps}.
 * @param opts - `cwd`, the session's working directory; `route`, its model route; `make`, whether the cwd is
 *   made when missing, `true` by default.
 * @returns the agent, its session id, and `dispose`, which disposes the handle `agents.create` returned:
 *   once however often it is called, never rejecting - a failure is one `gravit-face: desk:` line.
 */
export async function createDeskAgent(
  deps: DeskSessionDeps,
  opts: { cwd: string; route?: { provider: string; model: string }; make?: boolean },
): Promise<{ agent: AgentLike; sessionId: string; dispose(): Promise<void> }> {
  const route = opts.route ?? deps.route;
  const log = deps.log ?? defaultLog;
  if (opts.make ?? true) await mkdir(opts.cwd, { recursive: true });
  else {
    const label = relative(resolve(deps.root), resolve(opts.cwd)).split(sep).join("/");
    let isDir: boolean;
    try {
      isDir = (await lstat(opts.cwd)).isDirectory();
    } catch (err) {
      if (codeOf(err) === "ENOENT" || codeOf(err) === "ENOTDIR") throw new Error(`${label} is gone`);
      throw err;
    }
    if (!isDir) throw new Error(`${label} is not a directory`);
  }
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
 * conversation the face could not find again is not opened. `resumed` is there, `true`, when this call resumed a cold
 * session: what a restart left in it - messages still queued, a turn the restart cut - is the owner's to deal with
 * ({@link requeuePending}, {@link cutPhoneTurn}).
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
): Promise<{ agent: AgentLike; sessionId: string; created: boolean; resumed?: true }> {
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
): Promise<{ agent: AgentLike; sessionId: string; created: false; resumed?: true } | undefined> {
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
  return { agent, sessionId: id, created: false, ...(resumed === undefined ? {} : { resumed: true as const }) };
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
 * `user/message` that is not the desk state (`telegram`, `schedule`, `alert`, ...), or `wake` for a
 * background job's notice (`tool-jobs`) and for a turn that claimed no other message; `message`, that
 * message's own `source`, absent when there was none - an alert's id is how its owner answers it as a
 * reply. `outcome` is `timed-out` when the supervisor's deadline cut the turn, or `refused` when its fence check found `violation` (repo-relative) while the
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
  message?: Record<string, unknown>;
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

/**
 * A turn's end as `events.jsonl` records it, the one builder both owners use - the desk conversation's phone turns
 * and a firing's turn (p2-m22): a `desk-refused` for a turn the fence cut, at its violation or `fallbackPath`; else a
 * `desk-turn` with its source, its outcome, its wall time, its tokens and why it was cancelled or failed.
 * @param r - the supervisor's record.
 * @param t - the event's time.
 * @param fallbackPath - the repo-relative path a refusal without a violation names: the turn's cwd.
 */
export function deskTurnEvent(r: DeskTurnRecord, t: string, fallbackPath: string): DeskEvent {
  if (r.outcome === "refused") return { t, kind: "desk-refused", reason: "fence", path: r.violation ?? fallbackPath };
  return {
    t, kind: "desk-turn", sessionId: r.sessionId, source: r.source, turn: r.turn, outcome: r.outcome, wallMs: r.wallMs,
    ...(r.usage === undefined ? {} : { usage: r.usage }),
    ...(r.cancel === undefined ? {} : { cancel: r.cancel }),
    ...(r.error === undefined ? {} : { error: r.error }),
  };
}

/** The line after an answer a cut interrupted mid-stream, one form for both owners: `(cut off: <what cut it>)` - its
 * deadline, as producer.ts `formatDuration` spells it (`5 min`, `1.5 s`), or what cancelled it (`stopped from the
 * phone`, `shutdown`, `stopped in the browser`). */
export function cutOffLine(r: DeskTurnRecord): string {
  return `(cut off: ${r.outcome === "timed-out" ? `timed out after ${formatDuration(r.deadlineMs)}` : r.cancel ?? r.outcome})`;
}

export { formatDuration };

/** What {@link superviseDeskTurns} needs. `deadlineMs` is every turn's deadline - a whole number of
 * milliseconds in 1..2147483647, the longest a timer holds - and the ceiling of any shorter one
 * `deadlineFor` gives a source; `onTurnEnd`, the owner's hand for each record, synchronous or async;
 * `fence`, the instruction-chain check run at every turn's start (none when absent), and `fenceLabel`, the
 * repo-relative path a check that rejects counts as a violation at - the turn's cwd, `desk/journal` by default
 * (p2-m18); `clock`, the timers (the global ones by default); `log`, where a failure line goes (stderr). */
export interface SuperviseDeskTurnsDeps {
  on: SessionEventsOn;
  sessionId: string;
  agent: AgentLike;
  deadlineMs: number;
  clock?: DeskClock;
  onTurnEnd: (record: DeskTurnRecord) => void | Promise<void>;
  fence?: () => Promise<string | undefined>;
  fenceLabel?: string;
  deadlineFor?: (sourceKind: string) => number | undefined;
  log?: (line: string) => void;
}

/** The turn a supervision has open, as {@link DeskSupervision}'s `openTurn` shows it: its number; once a message
 * named it, the source's name as a record gives it (`telegram`, `alert`, `wake`, ...); that message's id and logged
 * time (ms since the epoch), when its event had them; and the ids of every message it has logged - dsh claims a
 * message from the inbox before it logs it, so a claimed id missing here is one the turn holds unlogged. */
export interface OpenTurnView {
  turn: number;
  source?: string;
  id?: string;
  at?: number;
  /** The id of every `user/message` the turn has logged so far, in order. */
  logged: string[];
}

/** What {@link superviseDeskTurns} returns: its disposer, which also says which turn it has open. */
export type DeskSupervision = (() => void) & { openTurn(): OpenTurnView | undefined };

/** A turn between its `turn/start` and its `turn/end`. */
interface OpenTurn {
  readonly turn: number;
  readonly startedAt: number;
  /** Every event of the session from `turn/start` on: the slice `deriveTurnTokenUsage` folds. */
  readonly events: EventLike[];
  source?: string;
  /** The `source` of the message that named it. */
  message?: Record<string, unknown>;
  /** That message's id, and when it was logged (ms since the epoch), when the event had them. */
  id?: string;
  at?: number;
  /** The id of every `user/message` the turn has logged. */
  readonly logged: string[];
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
 * unwound (dsh-agent `Agent.send`). So, in the same tick as the cancel, each message on the inbox's next-turn list -
 * whatever its source: the phone's, an alert's, the browser's, a job's notice - is taken out and sent again with
 * `followup`, oldest first: the list ends as it began, in the order the operator sent them, and each is answered in its
 * own turn - with its own deadline, fence check and record. The input waiting
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
  return requeue(agent, () => true, log, " after the cut");
}

/** The message sources {@link requeuePending} wakes the desk for: the phone's texts and the face's alerts - one alert's
 * or a pass's batch, whose message's source is `alert` alike (src/alert-text.ts `annotationPost`). */
const REQUEUED: ReadonlySet<string> = new Set(["telegram", "alert"]);

/**
 * The boot's wake: take each phone text and alert waiting on `agent`'s inbox's next-turn list out, and send it again
 * with `followup`, oldest first, so the agent wakes for them: dsh opens no turn on a resume for a message on that list -
 * the queued message lives only in the inbox's durable projection, which the resume rebuilds, and the resumed agent sits
 * idle beside it (measured on a real tree, spec §16 H3). A message of any other source - the browser's, a job's notice -
 * stays where it is: nobody is at the browser to see its answer at boot. A cut wakes every source
 * ({@link cancelKeepingQueue}). A message
 * `remove` says is no longer there was taken by a turn since, which answers it: it is skipped, never sent twice. An
 * agent without an inbox has nothing to wake.
 * @param agent - the desk agent.
 * @param log - where the line goes for a message that could not be sent again: taken out, it is lost.
 * @returns how many messages it sent again.
 */
export function requeuePending(agent: AgentLike, log: (line: string) => void): number {
  return requeue(agent, (message) => REQUEUED.has(message.source?.kind), log, "");
}

/** Take each message on `agent`'s next-turn list that `which` keeps out and send it again, oldest first - a cut's
 * ({@link cancelKeepingQueue}: every one) and a boot's ({@link requeuePending}: the phone's and the alerts') - its loss
 * line naming `when` (` after the cut`, or nothing). */
function requeue(agent: AgentLike, which: (message: MessageLike) => boolean, log: (line: string) => void, when: string): number {
  const inbox = (agent as AgentLike & InboxAware).inbox;
  if (inbox === undefined) return 0;
  let sent = 0;
  for (const message of [...inbox.nextTurn]) {
    if (!which(message)) continue;
    if (!inbox.remove(message.id)) continue; // taken by a turn since: it is answered there
    try {
      agent.followup(message);
      sent += 1;
    } catch (err) {
      log(`${BIN}: desk: a message queued on desk session ${agent.id} could not be queued again${when}, and is lost: ${errText(err)}`);
    }
  }
  return sent;
}

/** A session log event's own time, when it has one: dsh stamps each with `time`, in ms since the epoch. */
function timeOf(event: EventLike | undefined): number | undefined {
  const time = (event as { time?: unknown } | undefined)?.time;
  return typeof time === "number" && Number.isFinite(time) ? time : undefined;
}

/**
 * The phone turn a restart cut, from the desk session's log as the restart left it: the log's last `turn/start`, when no
 * `turn/end` of that turn follows it - a log the loop has not reopened - or the one that follows says `interrupted`,
 * the closer dsh-agent-loop appends on resume to a log whose tail turn was open (lib/index.js `interruptedTurnClosers`;
 * measured, spec §16 H3), or says `aborted` with a `disposed` cause, which dsh 0.2.1-rc.5's tree dispose writes for a
 * turn it aborts at a graceful stop (measured: .superpowers/sdd/2026-11-02-desk-hardening/graceful-stop-measurement.md)
 * - that one only when `carried` does not hold the turn's number: a `desk-carry` that names the turn sends its line from
 * the boot's carry instead, so it is never sent twice; and only when the turn's first `user/message` that is not the desk state names it as the
 * phone's (`source.kind` `telegram`), as the supervisor names a turn. `at` is when that message was logged (ISO-8601
 * UTC), else when the turn started; dsh stamps every event, and a log with neither time names no cut. A turn that ended any other way - a shutdown's cancel among them, which its own
 * record covers - is no cut; nor is a browser's, an alert's or a wake's.
 * @param events - the session's log, in order (src/desk-session.ts {@link readSessionEvents}).
 * @param carried - the turns of this session a `desk-carry` in the ledger names as cut (none by default).
 */
export function cutPhoneTurn(events: readonly EventLike[], carried: ReadonlySet<number> = new Set()): { turn: number; at: string } | undefined {
  let start = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "turn/start") {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;
  const turn = (events[start].data as { turn?: unknown } | undefined)?.turn;
  if (typeof turn !== "number") return undefined;
  let named: EventLike | undefined;
  for (const event of events.slice(start + 1)) {
    const data = event.data as { turn?: unknown; reason?: { kind?: unknown; reason?: { kind?: unknown } }; source?: { kind?: unknown } } | undefined;
    if (event.type === "turn/end" && data?.turn === turn) {
      const disposed = data.reason?.kind === "aborted" && data.reason.reason?.kind === "disposed" && !carried.has(turn);
      if (data.reason?.kind !== "interrupted" && !disposed) return undefined;
      break;
    }
    if (event.type === "user/message" && named === undefined && data?.source?.kind !== "desk") named = event;
  }
  if ((named?.data as { source?: { kind?: unknown } } | undefined)?.source?.kind !== "telegram") return undefined;
  const at = timeOf(named) ?? timeOf(events[start]);
  return at === undefined ? undefined : { turn, at: new Date(at).toISOString() };
}

/**
 * The phone's line for a turn a restart cut: `a restart cut your message of <deskTime> before it was answered; send it
 * again`, the message's time as src/desk.ts `deskTime` shows it - dated when the restart came on another New York date.
 * @param at - when the message was logged ({@link cutPhoneTurn}).
 * @param now - when the face says so.
 */
export function cutPhoneTurnLine(at: Date, now: Date): string {
  return `a restart cut your message of ${deskTime(at, now)} before it was answered; send it again`;
}

/** The longest delay a timer keeps: 2^31 - 1 ms, about 24.8 days. Node fires a longer one at once. */
const MAX_TIMER_MS = 2_147_483_647;
/** Whether `ms` is a deadline a timer can hold: a whole number of milliseconds in 1..{@link MAX_TIMER_MS}. */
const isTimerMs = (ms: number): boolean => Number.isInteger(ms) && ms >= 1 && ms <= MAX_TIMER_MS;

/** A turn's tokens as the ledger keeps them, or `undefined` when `deriveTurnTokenUsage` cannot prove
 * them. A bucket it leaves out is 0 and absent routes are `[]`; `totalTokens` and `reasoningTokens` are
 * not kept. */
export function turnUsage(events: readonly EventLike[]): TurnUsage | undefined {
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
 * check runs again. When the turn's first `user/message` that is not the desk state (`source.kind`
 * `desk`, src/desk-conversation.ts's inject) arrives, the turn is named after it and `deadlineFor` is
 * asked by the source's name as the record gives it. An answer below `deadlineMs` moves the deadline to
 * that long after `turn/start` - or cancels at once, when that moment has passed. No answer, or a non-finite one,
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
 * @returns the disposer: it clears every timer and the listener, and is idempotent - with `openTurn`, the turn it has
 *   open now, if any ({@link OpenTurnView}), which the desk conversation's dispose carries through the ledger.
 * @throws a `RangeError`, before anything is installed, unless `deadlineMs` is a whole number of
 *   milliseconds in 1..2147483647.
 */
export function superviseDeskTurns(deps: SuperviseDeskTurnsDeps): DeskSupervision {
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
    const turn: OpenTurn = { turn: n, startedAt: clock.now(), events: [event], deadlineMs: deps.deadlineMs, logged: [] };
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
          const at = deps.fenceLabel ?? JOURNAL;
          log(`${BIN}: desk: the fence check for turn ${turn.turn} on ${where} failed (${errText(err)}); it counts as a violation at ${at}`);
          cut(turn, { by: "fence", violation: at });
        },
      );
  };

  /** Name `turn` after `event`, its first message that is not the desk state - which is context, never a turn's
   * name - and ask its deadline there. */
  const firstMessage = (turn: OpenTurn, event: EventLike): void => {
    const source = (event.data as { source?: unknown } | undefined)?.source;
    const kind = typeof source === "object" && source !== null ? (source as { kind?: unknown }).kind : undefined;
    if (kind === "desk") return;
    turn.source = sourceName(kind);
    if (typeof source === "object" && source !== null) turn.message = source as Record<string, unknown>;
    const id = (event.data as { id?: unknown } | undefined)?.id;
    if (typeof id === "string") turn.id = id;
    const at = timeOf(event);
    if (at !== undefined) turn.at = at;
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
      ...(turn.message === undefined ? {} : { message: turn.message }),
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
    const logged = event.type === "user/message" ? (event.data as { id?: unknown } | undefined)?.id : undefined;
    if (typeof logged === "string") turn.logged.push(logged);
    if (event.type === "user/message" && turn.source === undefined) firstMessage(turn, event);
    else if (event.type === "turn/end" && n === turn.turn) end(turn, event);
  });

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (open !== undefined) disarm(open);
    open = undefined;
    off();
  };
  return Object.assign(dispose, {
    openTurn: (): OpenTurnView | undefined => {
      const turn = open;
      if (turn === undefined) return undefined;
      return {
        turn: turn.turn,
        ...(turn.source === undefined ? {} : { source: turn.source }),
        ...(turn.id === undefined ? {} : { id: turn.id }),
        ...(turn.at === undefined ? {} : { at: turn.at }),
        logged: [...turn.logged],
      };
    },
  });
}
