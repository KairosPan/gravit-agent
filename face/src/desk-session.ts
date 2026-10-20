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
 * desk turn, and git never shows it: the journal is ignored. {@link findDeskFenceViolation} looks for
 * one; {@link superviseDeskTurns} runs the check at every turn's start and cuts a turn that starts over
 * a violation, and an owner can check before it opens a turn at all, {@link fenceRefusalLine} being its
 * reply. The check fails closed: what it cannot read counts as found.
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
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection as installDshModelSelection } from "@deepseek-ai/dsh-agent";
import { deriveTurnTokenUsage } from "@deepseek-ai/dsh-token-meter/client";
import { appendEvent, lastDeskSession, readEvents, type TurnUsage } from "./desk.ts";
import { DESK_PRESET } from "./desk-preset.ts";
import { etTime } from "./et.ts";
import type { AgentLike, MemberSetup, ResumeMemberOptions, RoomContextLike, RoomDeps } from "./room.ts";
import { finalTextOf, parseModelRoute, type EventLike } from "./room-rules.ts";

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

/** The names that steer a desk session from inside its own tree: the workspace instruction files the
 * face's agent-instructions row reads, dsh's project-root marker, and the two project skill roots. */
export const FENCE_NAMES = ["GRAVIT.md", "GRAVIT.local.md", ".git", ".dsh", ".agents"] as const;

/** A name as a case-insensitive volume compares it. macOS's APFS folds case, so dsh's probe,
 * `stat("<dir>/GRAVIT.md")`, opens `Gravit.md` as well - measured on the operator's volume, along with
 * `.GIT` for `.git` and `.dſh` for `.dsh`. Upper, then lower, folds that `ſ` to `s` as the volume
 * does, which lower alone would not. On a case-sensitive volume this refuses a few names dsh would not
 * read: the safe side. */
const folded = (name: string): string => name.toUpperCase().toLowerCase();
const FENCED: ReadonlySet<string> = new Set(FENCE_NAMES.map(folded));

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
const byName = (a: Dirent, b: Dirent): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The first entry under `journalDir` that would steer a desk session, as a path relative to
 * `journalDir` (`a/b/GRAVIT.md`), or `undefined` when there is none.
 *
 * Walks every depth, depth first, each directory's entries in code-unit order, and answers with the
 * first entry named like a {@link FENCE_NAMES} entry - the name compared as a case-insensitive volume
 * compares it ({@link folded}), whatever the entry is: file, directory or symlink, dangling or not. A
 * symlink is never followed. It fails closed: a missing journal (ENOENT at the root) holds nothing,
 * but a journal it cannot list for any other reason is `"."`, and a directory under it that it cannot
 * list is itself the answer, by its path. Never rejects.
 * @param journalDir - the desk's journal ({@link deskJournalDir}).
 */
export async function findFenceViolation(journalDir: string): Promise<string | undefined> {
  let entries: Dirent[];
  try {
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
    if (FENCED.has(folded(entry.name))) return path;
    if (!entry.isDirectory()) continue; // a symlink lists as a link, never as what it points at
    const child = join(dir, entry.name);
    let children: Dirent[];
    try {
      children = await readdir(child, { withFileTypes: true });
    } catch {
      return path;
    }
    const found = await walkFence(child, path, children);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The journal, repo-relative: what a fence check that could not run refuses as. */
const JOURNAL = "desk/journal";

/**
 * The first thing in the repository's `desk/` that would steer a desk session, as a path relative to
 * `root` - `desk/GRAVIT.md`, `desk/journal/a/.git` - or `undefined` when there is none.
 *
 * `desk/` itself first: dsh reads the instruction files at every level from the project root down to
 * the cwd, so `desk/GRAVIT.md` reaches every desk session, and a `.git` at `desk/` would make it the
 * project root with its own skill roots. The desk's sandbox cannot write there; a workbench session at
 * the repository root can. The five {@link FENCE_NAMES} are looked up there in that order, by `lstat`
 * and without recursion - so a symlink by one of those names counts, and the volume's own case rule
 * applies. A missing `desk/` holds nothing; a `desk/` that cannot be searched for any other reason is
 * `desk`. Then the journal, through {@link findFenceViolation}: its answer under `desk/journal/`, and
 * `desk/journal` for its `"."`. Never rejects.
 * @param root - the repository root.
 */
export async function findDeskFenceViolation(root: string): Promise<string | undefined> {
  const desk = join(root, "desk");
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

/** Where a message the face sends the desk came from, as its provenance line names it. */
export type DeskSource =
  | { kind: "telegram" }
  | { kind: "schedule"; order: string; date: string }
  | { kind: "alert"; symbol: string; rule: string };

/**
 * The bracketed first line of every message the face sends the desk:
 * `[telegram · operator · 14:03 ET]`, `[schedule · <order> · <YYYY-MM-DD>]`, `[alert · <SYMBOL> · <rule>]`.
 * The time is `now` in America/New_York (src/et.ts); a schedule line carries its firing's own date.
 * `dsh/profile/desk.md` tells the model how to read each form (tests/desk-session.test.ts ties the two).
 * @param source - where the message came from.
 * @param now - when the face sends it.
 */
export function provenanceLine(source: DeskSource, now: Date): string {
  switch (source.kind) {
    case "telegram":
      return `[telegram · operator · ${etTime(now)}]`;
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
 * own: the agent registry, the preset join and the permission fact. `create` answers dsh-agent's
 * `AgentHandle`, `{ agent, dispose }` - the disposer only its holder has (dsh-agent
 * lib/types/index.d.ts:129-146). */
export interface DeskSessionCtxLike {
  agents: {
    get(id: string): AgentLike | undefined;
    create(options: CreateDeskAgentOptions): Promise<{ agent: AgentLike; dispose(): Promise<void> }>;
    resume(options: ResumeMemberOptions): Promise<{ agent: AgentLike }>;
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
    disposing ??= (async () => {
      try {
        await handle.dispose();
      } catch (err) {
        log(`${BIN}: desk: desk session ${sessionId} could not be disposed: ${errText(err)}`);
      }
    })();
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
 * The desk conversation: the one the ledger names last, live or resumed, else a new one.
 *
 * Makes the journal first (`mkdir -p`). Unless `opts.fresh`, it takes the newest `desk-session` the
 * ledger names: the live agent when there is one (`agents.get`), else a resume on the desk's route with
 * the desk's setup (never re-pinned). With no id, a resume that fails - one `gravit-face: desk:` line -
 * or `fresh`, it creates one in the journal ({@link createDeskAgent}) and records it as a `desk-session`
 * event, `created`, or `new` when `fresh`. Only a creation is recorded. Whichever path, the session must
 * run `workspace-write` or this rejects. Rejects too when the ledger cannot be read (src/desk.ts
 * `readEvents`): a conversation the face could not find again is not opened.
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
    if (id !== undefined) {
      const agent = deps.ctx.agents.get(id) ?? (await resumeDesk(deps, id, log));
      if (agent !== undefined) {
        requireWorkspaceWrite(deps, agent, id);
        return { agent, sessionId: id, created: false };
      }
    }
  }
  const { agent, sessionId } = await createDeskAgent(deps, { cwd: journal });
  const t = new Date((deps.now ?? Date.now)()).toISOString();
  await appendEvent(deps.home, { t, kind: "desk-session", sessionId, reason: opts.fresh === true ? "new" : "created" }, { log });
  return { agent, sessionId, created: true };
}

/** The cold desk conversation `id`, resumed, or `undefined` - with its line - when it cannot be. */
async function resumeDesk(deps: DeskSessionDeps, id: string, log: (line: string) => void): Promise<AgentLike | undefined> {
  try {
    const route = { provider: deps.route.provider, model: deps.route.model };
    return (await deps.ctx.agents.resume({ resumeSessionId: id, agentOptions: route, setup: deskSetup(deps, route, false) })).agent;
  } catch (err) {
    log(`${BIN}: desk: desk session ${id} could not be resumed (${errText(err)}); opening a new one`);
    return undefined;
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
 * (`tool-jobs`) and for a turn that claimed no message. `outcome` is `ended`; `timed-out` when the
 * supervisor's deadline cut the turn; or `refused` when its fence check found `violation`
 * (repo-relative) while the turn ran. `finalText` is the turn's final assistant text (src/room-rules.ts
 * `finalTextOf`), empty when it ended on a tool; `usage`, its tokens in the ledger's four buckets with
 * every route as `provider/model`, absent when the harness could not account for the turn. `startedAt`
 * is ISO-8601 UTC; `wallMs`, from `turn/start` to `turn/end`; `deadlineMs`, the deadline that applied. */
export interface DeskTurnRecord {
  sessionId: string;
  turn: number;
  source: string;
  outcome: "ended" | "timed-out" | "refused";
  finalText: string;
  usage?: TurnUsage;
  startedAt: string;
  wallMs: number;
  deadlineMs: number;
  violation?: string;
}

/** What {@link superviseDeskTurns} needs. `deadlineMs` is every turn's deadline and the ceiling of any
 * shorter one `deadlineFor` gives a source; `onTurnEnd`, the owner's hand for each record; `fence`, the
 * instruction-chain check run at every turn's start (none when absent); `clock`, the timers (the
 * global ones by default); `log`, where a failure line goes (stderr). */
export interface SuperviseDeskTurnsDeps {
  on: SessionEventsOn;
  sessionId: string;
  agent: AgentLike;
  deadlineMs: number;
  clock?: DeskClock;
  onTurnEnd: (record: DeskTurnRecord) => void;
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
 * deadline" }`, keeping the inbox; and, when `fence` is given, the fence check, which cancels the turn
 * with `{ kind: "hook", reason: "desk fence" }` if it finds a violation while the turn still runs. A
 * check that rejects counts as a violation at `desk/journal`, with one line; a check that settles after
 * the turn ended changes nothing, and the next turn's check finds the violation again. When the turn's
 * first `user/message` arrives, `deadlineFor` is asked by the source's name as the record gives it; a
 * finite answer below `deadlineMs` moves the deadline to that long after `turn/start` - or cancels at
 * once, when that moment has passed. Only the first cancel of a turn is sent.
 *
 * Every event of the turn is collected from the bus, and at its `turn/end` the turn is one
 * {@link DeskTurnRecord}, handed to `onTurnEnd` in a microtask: the bus calls this listener inside the
 * session's own append, which refuses reentry, so nothing an owner does in reply - a followup, a cancel -
 * runs there; for the same reason a cancel that is due at once waits for a microtask. A throw from
 * `onTurnEnd` is one line, never an exception in the append. A turn already running when the supervisor
 * is installed is not this supervisor's.
 * @param deps - see {@link SuperviseDeskTurnsDeps}.
 * @returns the disposer: it clears every timer and the listener, and is idempotent.
 */
export function superviseDeskTurns(deps: SuperviseDeskTurnsDeps): () => void {
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
      deps.agent.cancel({ kind: "hook", reason: why.by === "deadline" ? "desk deadline" : "desk fence" }, { keepInbox: true });
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
          if (disposed) return;
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
      log(`${BIN}: desk: no deadline for a ${turn.source} turn (${errText(err)}); turn ${turn.turn} on ${where} keeps ${turn.deadlineMs} ms`);
      return;
    }
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms >= turn.deadlineMs) return;
    turn.deadlineMs = ms;
    const left = turn.startedAt + ms - clock.now();
    if (left > 0) {
      arm(turn, left);
      return;
    }
    disarm(turn);
    queueMicrotask(() => cut(turn, { by: "deadline" }));
  };

  const end = (turn: OpenTurn): void => {
    disarm(turn);
    open = undefined;
    let usage: TurnUsage | undefined;
    try {
      usage = turnUsage(turn.events);
    } catch (err) {
      log(`${BIN}: desk: the tokens of turn ${turn.turn} on ${where} could not be read: ${errText(err)}`);
    }
    const record: DeskTurnRecord = {
      sessionId: deps.sessionId,
      turn: turn.turn,
      source: turn.source ?? "wake",
      outcome: turn.cut === undefined ? "ended" : turn.cut.by === "deadline" ? "timed-out" : "refused",
      finalText: finalTextOf(turn.events, turn.turn),
      ...(usage === undefined ? {} : { usage }),
      startedAt: new Date(turn.startedAt).toISOString(),
      wallMs: clock.now() - turn.startedAt,
      deadlineMs: turn.deadlineMs,
      ...(turn.cut?.by === "fence" ? { violation: turn.cut.violation } : {}),
    };
    queueMicrotask(() => {
      try {
        deps.onTurnEnd(record);
      } catch (err) {
        log(`${BIN}: desk: turn ${record.turn} on ${where} ended but its owner failed on it: ${errText(err)}`);
      }
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
    else if (event.type === "turn/end" && n === turn.turn) end(turn);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    if (open !== undefined) disarm(open);
    open = undefined;
    off();
  };
}
