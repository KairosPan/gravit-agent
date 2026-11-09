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
 * THE FENCE. Every turn's start makes the folder again if it went, then is checked as the desk journal's is
 * ({@link conversationFence}): no instruction file,
 * skill root or symlink in the folder, and no `.git` in any directory above it - a project root above would make dsh
 * read `GRAVIT.md` along the chain down to the folder. A violation cuts the turn and keeps its inbox.
 *
 * SUPERVISION. {@link installConversation} runs src/desk-session.ts `superviseDeskTurns` over the session with the
 * desk's 300 s cut ({@link CONVERSATION_DEADLINE_MS}): the router runs no shell, so a turn that long is stuck. Its turns
 * write no `desk-turn` and count against no budget; an abnormal end is one log line. The supervision is also how the
 * task tools know whose turn is running ({@link ConversationHandle.operatorTurn}).
 *
 * THE PHONE (plan 3). A text from the phone reaches the conversation through {@link ConversationHandle.post}, the desk
 * conversation's post (src/desk-conversation.ts) without its budget and its desk state: one at a time, the pause first
 * (a paused post refuses with the paused line), then the fence, then the key - the message's id - checked against the
 * conversation's log, its inbox and what this handle sent, so a text the bridge sends twice opens one turn; then the
 * message, its provenance line first, and the log flushed. A phone text's turn is the operator's, as the browser's is
 * ({@link OPERATOR_SOURCES}); a schedule or alert line injected into the conversation ({@link INJECTED_KINDS}) never
 * names a turn and never makes one someone else's.
 * @module
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection as installDshModelSelection } from "@deepseek-ai/dsh-agent";
import { MessageId, freezeMessage, type MessageSource } from "@deepseek-ai/dsh-llm";
import { appendEvent, clearOff, deskTime, lastConversation, readEvents, readOffState } from "./desk.ts";
import {
  loggedId, pauseInForce, pausedLine, phoneContent, waiting, type PhonePost, type PostResult,
} from "./desk-conversation.ts";
import { CONVERSATION_PRESET } from "./desk-names.ts";
import {
  findFenceViolation, provenanceLine, readSessionEvents, superviseDeskTurns,
  type DeskSessionCtxLike, type DeskTurnRecord, type SessionEventsOn,
} from "./desk-session.ts";
import type { AgentLike, MemberSetup, RoomDeps, SessionLike } from "./room.ts";
import type { MessageLike } from "./room-rules.ts";

const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): unknown => (err as { code?: unknown } | null | undefined)?.code;
const defaultLog = (line: string): void => { console.error(line); };
const WORKSPACE_WRITE = "workspace-write";

/** Every conversation turn's deadline: the desk's 300 s (spec §5.6). */
export const CONVERSATION_DEADLINE_MS = 300_000;

/** The message source kinds whose turn is the operator's - the only turns that may start, steer or stop a task
 * (spec §5.2). The browser's prompt is `user`; the phone's text is `telegram`, for both networks (plan 3). */
export const OPERATOR_SOURCES: ReadonlySet<string> = new Set(["user", "telegram"]);

/** The source kinds of the lines the face injects into the conversation - a standing order's firing (`schedule`) and
 * an alert (`alert`): context claimed at a turn's next step, never a turn's name and never another speaker in it. */
export const INJECTED_KINDS: ReadonlySet<string> = new Set(["schedule", "alert"]);

/** Where the open turn came from, as a task it starts records it: the phone - with the network the text came
 * through - or the web (the browser, and every turn that is not a phone text's). */
export type TaskOrigin = { kind: "web" } | { kind: "phone"; network: "telegram" | "slack" };

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

/**
 * The phone's line for a text the conversation's fence refused, naming what to remove: for a violation inside the
 * folder ({@link conversationFence}'s relative path), that entry in the conversation's folder; for a repository above
 * it (an absolute path, the directory holding the `.git`), that `.git` - the folder must not sit inside a repository,
 * and nothing tells the operator to remove the directory itself.
 * @param path - what {@link conversationFence} found.
 */
export function conversationFenceRefusalLine(path: string): string {
  if (isAbsolute(path)) {
    return `refused: the conversation's folder sits inside a repository (${join(path, ".git")}); its instruction files would steer every turn. Move the harness home out of the repository, then write again.`;
  }
  return `refused: ${path} is in the conversation's folder; it would steer every turn. Remove ${path} from the conversation's folder, then write again.`;
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
   * folder made again if it went (every turn's fence check makes it again too, before it looks). A conversation this
   * call resumed, idle with `task` messages a restart left on its inbox, sends them again, with one line. Calls run one
   * at a time. Rejects when the open does, and once disposed. */
  ensure(): Promise<{ agent: AgentLike; sessionId: string }>;
  /** The conversation held now, or `undefined` before the first ensure settles and after dispose. */
  current(): { agent: AgentLike; sessionId: string } | undefined;
  /** Whether the turn running now on the conversation is the operator's: one whose first message's source kind is in
   * {@link OPERATOR_SOURCES} and which has logged no message of any other kind since (a `task` message, a wake; the
   * desk's state note and dsh's own context messages excepted - see NOT_A_SPEAKER). False with no turn, before a
   * message names it, and for a task's or a wake's turn. */
  operatorTurn(): boolean;
  /** The open turn's origin: `{ kind: "phone", network }` while a turn a phone text named runs - its message's network,
   * `telegram` when it names none it knows - else `{ kind: "web" }`. */
  turnOrigin(): TaskOrigin;
  /** Post a phone text (the module header's THE PHONE): `{ opened, sessionId }`, `duplicate` when its key was
   * already there and nothing was sent; else the refusal and the line the phone gets - `paused`, `fence` (with the
   * violation's path), or `error` (disposed, no session persistence, the log unreadable, the open or followup
   * failing). Posts run one at a time. Never rejects. */
  post(input: PhonePost): Promise<PostResult>;
  /** Ends the supervision and disposes the agent this handle created or resumed; waits for an ensure under way. */
  dispose(): Promise<void>;
}

/** Source kinds that never make a turn someone else's: the desk's state note and dsh's own context - the
 * working-directory notice, dsh-agent-loop's runtime-context snapshot (the cwd and file policy, logged after the turn's
 * first message in every turn), dsh-agent-instructions' context, dsh-agent's model-selection notice, and three that
 * dsh logs mid-turn: dsh-compaction's `compact-checkpoint` (an automatic compaction under context pressure),
 * dsh-repeat-tool-reminder's `repeat-tool-reminder` (its REMINDER_SOURCE) and dsh-plan-mode's `plan-mode` notice. */
const NOT_A_SPEAKER: ReadonlySet<string> = new Set([
  "desk", "working-directory", "runtime-context", "agent-instructions", "model-selection",
  "compact-checkpoint", "repeat-tool-reminder", "plan-mode", ...INJECTED_KINDS,
]);

/** The kinds the conversation's supervisor skips when it names a turn: the desk state, and the injected lines. */
const SKIPPED: ReadonlySet<string> = new Set(["desk", ...INJECTED_KINDS]);

/** The networks a phone text's message names (src/phone.ts `PHONE_NETWORKS`). */
const isPhoneNetwork = (value: unknown): value is "telegram" | "slack" => value === "telegram" || value === "slack";

/** The message source kind {@link requeueTasks} sends again: a task's relay, report or note (src/task-relay.ts). */
const TASK_KIND = "task";

/** dsh-agent's `Agent.inbox`, the next-turn list and its `remove`, as src/desk-session.ts reads it. */
type InboxAware = { inbox?: { readonly nextTurn: readonly MessageLike[]; remove(id: string): boolean } };

/**
 * The resume's wake for the conversation: when `agent` is idle, take each `task` message waiting on its inbox's
 * next-turn list out and send it again with `followup`, oldest first, with one line. dsh opens no turn on a resume for
 * a message already on that list (src/desk-session.ts `requeuePending`), and the relay (src/task-relay.ts) waits for
 * an empty inbox, so a relay left there across a restart would block every relay after it. Any other source - the
 * browser's - stays where it is. A message `remove` says is gone was taken by a turn since: skipped, never sent twice.
 * @returns how many it sent again.
 */
function requeueTasks(agent: AgentLike, sessionId: string, log: (line: string) => void): number {
  const inbox = (agent as AgentLike & InboxAware).inbox;
  if (inbox === undefined || agent.status !== "idle") return 0;
  const waiting = inbox.nextTurn.filter((message) => message.source?.kind === TASK_KIND);
  if (waiting.length === 0) return 0;
  let sent = 0;
  for (const message of waiting) {
    if (!inbox.remove(message.id)) continue;
    try {
      agent.followup(message);
      sent += 1;
    } catch (err) {
      log(`${BIN}: conversation: task message ${message.id} on session ${sessionId} could not be queued again, and is lost: ${errText(err)}`);
    }
  }
  log(`${BIN}: conversation: session ${sessionId} was resumed idle with ${waiting.length} task message(s) on its inbox; ${sent} sent again`);
  return sent;
}

/** One supervised session: its supervision and the note of who has spoken in the open turn. */
interface Watch {
  /** Ends the supervision and the note; idempotent. */
  end(): void;
  /** Whether the open turn is the operator's: opened by an operator source, and no other speaker logged in it since. */
  operatorTurn(): boolean;
  /** The open turn's origin. */
  turnOrigin(): TaskOrigin;
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
      /* a folder deleted while the face runs is made again first, so the turn's working directory is there */
      fence: async () => {
        await mkdir(dir, { recursive: true });
        return conversationFence(dir);
      },
      fenceLabel: "the conversation's folder",
      skipKinds: SKIPPED,
      onTurnEnd: (record) => {
        const line = turnEndLine(record);
        if (line !== undefined) log(line);
      },
      log,
    });
    /* `opener`: the source of the message that named the turn, found as the supervisor finds it (SKIPPED) */
    const state: { turn?: number; foreign: boolean; opener?: Record<string, unknown> } = { foreign: false };
    /* only notes: nothing here calls into the agent, so the session's own append is never re-entered */
    const off = deps.ctx.on("session/event", (session, event) => {
      if (session.id !== sessionId) return;
      const data = event.data as { turn?: unknown; source?: unknown } | undefined;
      if (event.type === "turn/start") {
        state.turn = typeof data?.turn === "number" ? data.turn : undefined;
        state.foreign = false;
        state.opener = undefined;
        return;
      }
      if (event.type !== "user/message") return;
      const source = data?.source;
      const kind = typeof source === "object" && source !== null ? (source as { kind?: unknown }).kind : undefined;
      if (state.opener === undefined && !(typeof kind === "string" && SKIPPED.has(kind))) {
        state.opener = typeof source === "object" && source !== null ? source as Record<string, unknown> : {};
      }
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
      turnOrigin: () => {
        const open = ended ? undefined : supervision.openTurn();
        if (open?.source !== "telegram" || state.turn !== open.turn) return { kind: "web" };
        const network = state.opener?.network;
        return { kind: "phone", network: isPhoneNetwork(network) ? network : "telegram" };
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
    /* resumed here, under supervision: what a restart left on its inbox is sent again */
    if (!opened.created && opened.handle !== undefined) requeueTasks(opened.agent, opened.sessionId, log);
    return { agent: opened.agent, sessionId: opened.sessionId };
  };

  const ensure = (): Promise<{ agent: AgentLike; sessionId: string }> => {
    const next = tail.then(open, open);
    tail = next.catch(() => undefined);
    return next;
  };

  /** Keys this handle has followed up: a text dsh has claimed from the inbox and not yet logged is in neither. */
  const sent = new Set<string>();
  const failed = (reason: string): PostResult => {
    const line = `the conversation could not open a turn: ${reason}`;
    log(`${BIN}: conversation: ${line}`);
    return { refused: "error", line };
  };
  const flush = async (what: string): Promise<void> => {
    try {
      await deps.ctx.sessionPersistence?.flush();
    } catch (err) {
      log(`${BIN}: conversation: the log could not be flushed ${what} (${errText(err)}); a crash before the next flush may lose a phone text`);
    }
  };

  /** {@link ConversationHandle.post}'s work, in its turn. */
  const postNow = async (input: PhonePost): Promise<PostResult> => {
    if (disposed) return failed("the conversation is disposed");
    /* checked, never cast: only a phone text's two sources open a phone turn */
    const msg = input.message as { kind?: unknown; network?: unknown; messageId?: unknown };
    if (input.source?.kind !== "telegram" || msg?.kind !== "telegram" || !isPhoneNetwork(msg.network) || typeof msg.messageId !== "string" || typeof input.key !== "string") {
      return failed("the post is not a phone text (telegram or slack)");
    }
    const network = input.source.network;
    const source = {
      kind: "telegram" as const,
      ...(isPhoneNetwork(network) ? { network } : {}),
      ...(input.source.at === undefined ? {} : { at: input.source.at }),
      ...(input.source.carried === true ? { carried: true as const } : {}),
    };
    const logged = { kind: "telegram" as const, network: msg.network, messageId: msg.messageId };
    try {
      const clock = deps.now ?? Date.now;
      const paused = await pauseInForce({ readOffState, clearOff }, deps.home, clock, log);
      if (paused !== undefined) return { refused: "paused", line: pausedLine(paused, new Date(clock()), deskTime) };
      await mkdir(dir, { recursive: true });
      const path = await conversationFence(dir);
      if (path !== undefined) {
        log(`${BIN}: conversation: a phone text was refused: the fence found ${path}`);
        return { refused: "fence", path, line: conversationFenceRefusalLine(path) };
      }
      const persistence = deps.ctx.sessionPersistence;
      if (persistence === undefined) return failed("this face has no session persistence, so a phone text cannot be checked against the conversation's log");
      const { agent, sessionId } = await ensure();
      await persistence.flush();
      const seen = new Set<string>(sent);
      for (const event of await readSessionEvents(deps.ctx, sessionId)) {
        const id = loggedId(event);
        if (id !== undefined) seen.add(id);
      }
      if (disposed) return failed("the conversation is disposed");
      if (seen.has(input.key) || waiting(agent, input.key)) return { opened: true, sessionId, duplicate: true };
      const content = phoneContent(provenanceLine(source, new Date(clock())), input.text, input.context);
      const message = freezeMessage({ id: MessageId(input.key), role: "user", content, source: logged as MessageSource });
      agent.followup(message as unknown as MessageLike);
      sent.add(input.key);
      await flush(`after the phone text ${input.key}`);
      return { opened: true, sessionId };
    } catch (err) {
      return failed(errText(err));
    }
  };
  let posting: Promise<unknown> = Promise.resolve();

  return {
    ensure,
    post(input) {
      const run = posting.then(() => postNow(input));
      posting = run.catch(() => undefined);
      return run;
    },
    turnOrigin() {
      return held?.watch.turnOrigin() ?? { kind: "web" };
    },
    current() {
      return held === undefined ? undefined : { agent: held.agent, sessionId: held.sessionId };
    },
    operatorTurn() {
      return held?.watch.operatorTurn() ?? false;
    },
    async dispose() {
      disposed = true;
      await posting;
      await tail;
      const was = held;
      held = undefined;
      if (was === undefined) return;
      was.watch.end();
      if (was.handle !== undefined) await disposeQuietly(was.handle, was.sessionId, log);
    },
  };
}
