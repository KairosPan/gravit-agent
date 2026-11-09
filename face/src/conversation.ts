// face/src/conversation.ts
/** The conversation: Gravit's one router session, the operator's one entry (docs/superpowers/specs/
 * 2026-11-08-one-entry-router-design.md §5.2, §5.10).
 *
 * WHERE IT LIVES. A runtime-root session of the `gravit-router` preset (src/router-preset.ts) whose cwd is
 * `$DSH_HOME/face/conversation/` ({@link conversationDir}) - outside the repository, so no `GRAVIT.md` or skill root a
 * worker writes there can steer it, and a renamed repository cannot strand it - with `workspace-write` pinned inside
 * creation setup, as the desk's session is (src/desk-session.ts `createDeskAgent`).
 *
 * FOUND BY RECORD. The face records the session's id as a `conversation` line in the desk's ledger (src/desk.ts) and
 * resumes the last one at boot ({@link ensureConversation}). What the ledger names is checked, never trusted: a session
 * on another preset, or one dsh will not resume, gives a new conversation, recorded `new`, with one line. A folder never
 * does: a missing folder is made again, and a header that names another folder is pointed here with the working-
 * directory service's `set`.
 *
 * THE FENCE. Every turn's start is checked as the desk journal's is ({@link conversationFence}): no instruction file,
 * skill root or symlink in the folder, and no `.git` in any directory above it - a project root above would make dsh
 * read `GRAVIT.md` along the chain down to the folder. A violation cuts the turn and keeps its inbox.
 *
 * SUPERVISION. {@link installConversation} runs src/desk-session.ts `superviseDeskTurns` over the session with the
 * desk's 300 s cut ({@link CONVERSATION_DEADLINE_MS}): the router runs no shell, so a turn that long is stuck. Its turns
 * write no `desk-turn` and count against no budget; an abnormal end is one log line. The supervision is also how the
 * task tools know whose turn is running ({@link ConversationHandle.operatorTurn}).
 * @module
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection as installDshModelSelection } from "@deepseek-ai/dsh-agent";
import { appendEvent, lastConversation, readEvents } from "./desk.ts";
import { CONVERSATION_PRESET } from "./desk-names.ts";
import {
  findFenceViolation, superviseDeskTurns,
  type DeskSessionCtxLike, type DeskTurnRecord, type SessionEventsOn,
} from "./desk-session.ts";
import type { AgentLike, MemberSetup, RoomDeps, SessionLike } from "./room.ts";

const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): unknown => (err as { code?: unknown } | null | undefined)?.code;
const defaultLog = (line: string): void => { console.error(line); };
const WORKSPACE_WRITE = "workspace-write";

/** Every conversation turn's deadline: the desk's 300 s (spec §5.6). */
export const CONVERSATION_DEADLINE_MS = 300_000;

/** The message source kinds whose turn is the operator's - the only turns that may start, steer or stop a task
 * (spec §5.2). The browser's prompt is `user`; plan 3 adds the phone's `telegram`. */
export const OPERATOR_SOURCES: ReadonlySet<string> = new Set(["user"]);

/** The conversation's folder under the harness home `home`: `<home>/face/conversation`. */
export function conversationDir(home: string): string {
  return join(home, "face", "conversation");
}

/**
 * What would steer the conversation from its folder: the first entry in `dir` that src/desk-session.ts
 * `findFenceViolation` names (relative to `dir`); else the nearest directory above `dir` that holds a `.git` entry - a
 * directory or a worktree's file - as its absolute path; else `undefined`. It fails closed: an ancestor whose `.git`
 * cannot be looked at for any reason but its absence counts as holding one. Never rejects.
 * @param dir - the conversation's folder ({@link conversationDir}).
 */
export async function conversationFence(dir: string): Promise<string | undefined> {
  const inside = await findFenceViolation(dir);
  if (inside !== undefined) return inside;
  let at = resolve(dir);
  for (;;) {
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
    try {
      await lstat(join(at, ".git"));
      return at;
    } catch (err) {
      const code = codeOf(err);
      if (code !== "ENOENT" && code !== "ENOTDIR") return at;
    }
  }
}

/** The booted ROOT context as the conversation reads it: the desk session's slice, the root bus, and dsh's working-
 * directory service, whose `set` points a session at another folder. */
export type ConversationCtxLike = DeskSessionCtxLike & {
  on: SessionEventsOn;
  workingDirectory: { set(agent: unknown, path: string): Promise<string> };
};

/** What the conversation needs. `home` is the harness home (the ledger's and the folder's); `route`, the conversation's
 * model route; `installModelSelection`, dsh-agent's, injected as src/room.ts's is (its own import when `undefined`);
 * `now`, the clock a ledger line is stamped with (`Date.now`); `log`, where a line goes (stderr). */
export interface ConversationDeps {
  ctx: ConversationCtxLike;
  home: string;
  route: { provider: string; model: string };
  installModelSelection: RoomDeps["installModelSelection"];
  now?: () => number;
  log?: (line: string) => void;
}

/** The conversation's composition, the desk's three steps (src/desk-session.ts `deskSetup`): the model selection, the
 * `gravit-router` join and, for a new session only, the `workspace-write` pin on setup's own agent. */
function conversationSetup(deps: ConversationDeps, pin: boolean): MemberSetup {
  const route = { provider: deps.route.provider, model: deps.route.model };
  const install = deps.installModelSelection ?? ((agentCtx, ref) => installDshModelSelection(agentCtx as unknown as Context, ref));
  return async (agentCtx, agent) => {
    install(agentCtx, { current: route, assembled: undefined });
    await deps.ctx.agentPresets.mount(agentCtx, CONVERSATION_PRESET);
    if (pin) deps.ctx.permissionPresets.set(agent.session, WORKSPACE_WRITE);
  };
}

/** A handle the face holds: the disposer only its holder has. */
type Held = { dispose(): Promise<void> };

/** What {@link openConversation} answers: {@link ensureConversation}'s result and, when this call created or resumed the
 * agent, the handle to dispose it by - a live agent is someone else's and has none. */
interface Opened {
  agent: AgentLike;
  sessionId: string;
  created: boolean;
  handle?: Held;
}

/**
 * The conversation: the one the ledger names last, live or resumed, while it is a `gravit-router` session; else a new
 * one.
 *
 * In order: makes the folder (`mkdir -p`); reads the ledger's {@link lastConversation} - a ledger that cannot be read
 * rejects, so a conversation the face could not find again is never opened beside it; reopens it (`agents.get`, else
 * `agents.resume` on `deps.route` with the conversation's setup, never re-pinned). A reopened session whose header's
 * preset is not `gravit-router`, or one the resume refuses, gives a new conversation, recorded with reason `new`, and
 * one line naming the old id and why; what this call resumed and does not use is disposed. A reopened one whose
 * header's folder is not {@link conversationDir} is pointed there with `ctx.workingDirectory.set`, with one line; one
 * that does not run `workspace-write` is refused - what this call resumed is disposed and it rejects. With
 * no id it creates one - `session-<uuid>`, `gravit-router`, `workspace-write` pinned and checked after publication -
 * and records it `created`.
 *
 * ONE CALLER AT A TIME: two calls at once would both find nothing and both create. {@link installConversation}
 * serialises its own.
 * @param deps - see {@link ConversationDeps}.
 * @throws when the ledger cannot be read, when creation fails or the pin does not hold (the agent is disposed first),
 *   when a reopened conversation does not run `workspace-write`, and when `workingDirectory.set` rejects.
 */
export async function ensureConversation(deps: ConversationDeps): Promise<{ agent: AgentLike; sessionId: string; created: boolean }> {
  const { agent, sessionId, created } = await openConversation(deps);
  return { agent, sessionId, created };
}

async function openConversation(deps: ConversationDeps): Promise<Opened> {
  const dir = conversationDir(deps.home);
  await mkdir(dir, { recursive: true });
  const log = deps.log ?? defaultLog;
  const id = lastConversation((await readEvents(deps.home)).events);
  if (id !== undefined) {
    const found = await reopen(deps, id, dir, log);
    if (found !== undefined) return found;
  }
  const sessionId = `session-${randomUUID()}`;
  const handle = await deps.ctx.agents.create({
    sessionId,
    meta: { cwd: dir, agentPreset: CONVERSATION_PRESET },
    agentOptions: { provider: deps.route.provider, model: deps.route.model },
    setup: conversationSetup(deps, true),
  });
  const effective = deps.ctx.permissionPresets.current(handle.agent.session);
  if (effective !== WORKSPACE_WRITE) {
    await disposeQuietly(handle, sessionId, log);
    throw new Error(`the conversation ${sessionId} is "${effective}", not ${WORKSPACE_WRITE}; the face will not prompt it`);
  }
  const t = new Date((deps.now ?? Date.now)()).toISOString();
  await appendEvent(deps.home, { t, kind: "conversation", sessionId, reason: id === undefined ? "created" : "new" }, { log });
  return { agent: handle.agent, sessionId, created: true, handle };
}

/** The ledger's conversation `id`, live or resumed and pointed at `dir`, or `undefined`, with its line, when it cannot
 * be had or is not a `gravit-router` session; a rejection, after disposing what it resumed, when it does not run
 * `workspace-write`. */
async function reopen(deps: ConversationDeps, id: string, dir: string, log: (line: string) => void): Promise<Opened | undefined> {
  const live = deps.ctx.agents.get(id);
  let resumed: { agent: AgentLike; dispose(): Promise<void> } | undefined;
  if (live === undefined) {
    try {
      resumed = await deps.ctx.agents.resume({
        resumeSessionId: id,
        agentOptions: { provider: deps.route.provider, model: deps.route.model },
        setup: conversationSetup(deps, false),
      });
    } catch (err) {
      log(`${BIN}: conversation: session ${id}, the ledger's conversation, could not be resumed (${errText(err)}); opening a new one`);
      return undefined;
    }
  }
  const agent = live ?? resumed!.agent;
  const header: SessionLike["header"] = agent.session.header;
  if (header.agentPreset !== CONVERSATION_PRESET) {
    log(`${BIN}: conversation: session ${id}, the ledger's conversation, is not one: its preset is ${quoted(header.agentPreset)}, not ${CONVERSATION_PRESET}; opening a new one`);
    if (resumed !== undefined) await disposeQuietly(resumed, id, log);
    return undefined;
  }
  if (header.cwd === undefined || resolve(header.cwd) !== resolve(dir)) {
    log(`${BIN}: conversation: session ${id} names the folder ${quoted(header.cwd)}; pointing it at ${dir}`);
    try {
      await deps.ctx.workingDirectory.set(agent, dir);
    } catch (err) {
      if (resumed !== undefined) await disposeQuietly(resumed, id, log);
      throw err;
    }
  }
  /* as the desk's reopen does: a conversation that does not run workspace-write is refused, never prompted */
  const effective = deps.ctx.permissionPresets.current(agent.session);
  if (effective !== WORKSPACE_WRITE) {
    if (resumed !== undefined) await disposeQuietly(resumed, id, log);
    throw new Error(`the conversation ${id} is "${effective}", not ${WORKSPACE_WRITE}; the face will not prompt it`);
  }
  return { agent, sessionId: id, created: false, ...(resumed === undefined ? {} : { handle: resumed }) };
}

/** A header value as a line quotes it: `"gravit"`, or `unset`. */
const quoted = (value: string | undefined): string => (value === undefined ? "unset" : JSON.stringify(value));

/** Dispose a handle the face holds; a failure is one line, never a rejection. */
async function disposeQuietly(handle: Held, id: string, log: (line: string) => void): Promise<void> {
  try {
    await handle.dispose();
  } catch (err) {
    log(`${BIN}: conversation: session ${id} could not be disposed: ${errText(err)}`);
  }
}

/** The conversation as the face holds it. */
export interface ConversationHandle {
  /** The conversation, opened once ({@link ensureConversation}) and supervised; later calls answer the one held, its
   * folder made again if it went. Calls run one at a time. Rejects when the open does, and once disposed. */
  ensure(): Promise<{ agent: AgentLike; sessionId: string }>;
  /** The conversation held now, or `undefined` before the first ensure settles and after dispose. */
  current(): { agent: AgentLike; sessionId: string } | undefined;
  /** Whether the turn running now on the conversation is the operator's: one whose first message's source kind is in
   * {@link OPERATOR_SOURCES} and which has logged no message of any other kind since (a `task` message, a wake; the
   * desk's state note and dsh's own context messages excepted - see NOT_A_SPEAKER). False with no turn, before a
   * message names it, and for a task's or a wake's turn. */
  operatorTurn(): boolean;
  /** Ends the supervision and disposes the agent this handle created or resumed; waits for an ensure under way. */
  dispose(): Promise<void>;
}

/** Source kinds that never make a turn someone else's: the desk's state note and dsh's own context - the
 * working-directory notice, dsh-agent-loop's runtime-context snapshot (the cwd and file policy, logged after the turn's
 * first message in every turn), dsh-agent-instructions' context and dsh-agent's model-selection notice. */
const NOT_A_SPEAKER: ReadonlySet<string> = new Set(["desk", "working-directory", "runtime-context", "agent-instructions", "model-selection"]);

/** One supervised session: its supervision and the note of who has spoken in the open turn. */
interface Watch {
  /** Ends the supervision and the note; idempotent. */
  end(): void;
  /** Whether the open turn is the operator's: opened by an operator source, and no other speaker logged in it since. */
  operatorTurn(): boolean;
}

/** One line for a turn that did not simply end; nothing for one that did. */
function turnEndLine(r: DeskTurnRecord): string | undefined {
  const head = `${BIN}: conversation: turn ${r.turn} (${r.source}) on ${r.sessionId}`;
  switch (r.outcome) {
    case "ended": return undefined;
    case "timed-out": return `${head} timed out after ${r.deadlineMs} ms and was cut`;
    case "refused": return `${head} was refused: the fence found ${r.violation ?? "the conversation's folder"}`;
    case "cancelled": return `${head} was cancelled${r.cancel === undefined ? "" : ` (${r.cancel})`}`;
    case "failed": return `${head} failed${r.error === undefined ? "" : `: ${r.error}`}`;
  }
}

/**
 * The face's hold on the conversation: {@link ensureConversation} serialised, and, once the agent is had, src/desk-
 * session.ts `superviseDeskTurns` over it - the {@link CONVERSATION_DEADLINE_MS} cut, {@link conversationFence} at every
 * turn's start (a check that rejects counts as a violation at "the conversation's folder"), and an `onTurnEnd` that only
 * logs: its turns write no `desk-turn` and count against no budget.
 * @param deps - see {@link ConversationDeps}.
 */
export function installConversation(deps: ConversationDeps): ConversationHandle {
  const log = deps.log ?? defaultLog;
  const dir = conversationDir(deps.home);
  let tail: Promise<unknown> = Promise.resolve();
  let held: { agent: AgentLike; sessionId: string; handle?: Held; watch: Watch } | undefined;
  let disposed = false;

  /** Supervise `agent` as session `sessionId`, and note, per turn, whether the turn has logged a message that is not
   * the operator's: once it has, the turn is not the operator's any more, whoever opened it. */
  const watch = (agent: AgentLike, sessionId: string): Watch => {
    const supervision = superviseDeskTurns({
      on: deps.ctx.on,
      sessionId,
      agent,
      deadlineMs: CONVERSATION_DEADLINE_MS,
      fence: () => conversationFence(dir),
      fenceLabel: "the conversation's folder",
      onTurnEnd: (record) => {
        const line = turnEndLine(record);
        if (line !== undefined) log(line);
      },
      log,
    });
    const state: { turn?: number; foreign: boolean } = { foreign: false };
    /* only notes: nothing here calls into the agent, so the session's own append is never re-entered */
    const off = deps.ctx.on("session/event", (session, event) => {
      if (session.id !== sessionId) return;
      const data = event.data as { turn?: unknown; source?: unknown } | undefined;
      if (event.type === "turn/start") {
        state.turn = typeof data?.turn === "number" ? data.turn : undefined;
        state.foreign = false;
        return;
      }
      if (event.type !== "user/message") return;
      const source = data?.source;
      const kind = typeof source === "object" && source !== null ? (source as { kind?: unknown }).kind : undefined;
      if (typeof kind === "string" && (OPERATOR_SOURCES.has(kind) || NOT_A_SPEAKER.has(kind))) return;
      state.foreign = true;
    });
    let ended = false;
    return {
      end: () => {
        if (ended) return;
        ended = true;
        supervision();
        off();
      },
      operatorTurn: () => {
        if (ended) return false;
        const open = supervision.openTurn();
        if (open?.source === undefined || !OPERATOR_SOURCES.has(open.source)) return false;
        return !(state.foreign && state.turn === open.turn);
      },
    };
  };

  const open = async (): Promise<{ agent: AgentLike; sessionId: string }> => {
    if (disposed) throw new Error("the conversation is disposed");
    if (held !== undefined) {
      const live = deps.ctx.agents.get(held.sessionId);
      if (live !== undefined) {
        await mkdir(dir, { recursive: true });
        if (live !== held.agent) {
          /* the registry holds another object for the session now: supervise that one, not the one it replaced */
          log(`${BIN}: conversation: session ${held.sessionId} has a new agent object; supervising it`);
          held.watch.end();
          held.agent = live;
          held.watch = watch(live, held.sessionId);
        }
        return { agent: held.agent, sessionId: held.sessionId };
      }
      /* disposed under the face: let go of it and open it again */
      log(`${BIN}: conversation: session ${held.sessionId} is no longer live; opening it again`);
      held.watch.end();
      held = undefined;
    }
    const opened = await openConversation(deps);
    if (disposed) {
      if (opened.handle !== undefined) await disposeQuietly(opened.handle, opened.sessionId, log);
      throw new Error("the conversation is disposed");
    }
    held = { agent: opened.agent, sessionId: opened.sessionId, watch: watch(opened.agent, opened.sessionId), ...(opened.handle === undefined ? {} : { handle: opened.handle }) };
    return { agent: opened.agent, sessionId: opened.sessionId };
  };

  return {
    ensure() {
      const next = tail.then(open, open);
      tail = next.catch(() => undefined);
      return next;
    },
    current() {
      return held === undefined ? undefined : { agent: held.agent, sessionId: held.sessionId };
    },
    operatorTurn() {
      return held?.watch.operatorTurn() ?? false;
    },
    async dispose() {
      disposed = true;
      await tail;
      const was = held;
      held = undefined;
      if (was === undefined) return;
      was.watch.end();
      if (was.handle !== undefined) await disposeQuietly(was.handle, was.sessionId, log);
    },
  };
}
