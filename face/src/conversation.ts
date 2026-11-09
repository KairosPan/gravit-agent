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
 *
 * ANSWERS (plan 3). At a turn's end the conversation answers the phone through `deps.deliver` - the desk
 * conversation's `deliver`, the pause's choke point (src/desk-conversation.ts), absent with the desk off, when nothing
 * is sent: a turn that logged a phone text - whatever message named it, a parked browser steer claimed first included -
 * sends its reply (src/desk-conversation.ts `replyOf`: the answer, the cut line, the
 * refusal; its failure line saying Gravit, not the desk) as `chat` to the network the last such text came through; a task report's turn sends it to the network of the
 * phone that asked for the task (its brief's `origin`, src/task-view.ts `briefOrigin`); every other turn - the
 * browser's, a web task's report - sends nothing. Deliveries go in turn order. Still no `desk-turn` is written.
 *
 * A RESTART (plan 3). The phone's `/stop` ({@link ConversationHandle.stop}) cuts the work under way and keeps the queue
 * behind it (src/desk-session.ts `cancelKeepingQueue`). dsh's teardown clears the inbox, so at dispose the phone's part
 * is one `desk-carry` in the ledger, as the desk's is (src/desk-conversation.ts WHAT A GRACEFUL STOP CARRIED): the
 * phone texts dsh claimed for the open turn and has not logged (`deps.onClaimed`), then those waiting on the inbox - at
 * most {@link CARRY_MAX}, each cut at {@link CARRY_TEXT_MAX} characters - and, when the open turn holds a phone text,
 * that turn as the carry's `cut`. {@link ConversationHandle.carry} - which src/desk.ts calls once the conversation is
 * bound to the phone and the outlet is set - answers every carry no `desk-carried` names, oldest first, a desk's from
 * before the one entry included: each text posted again as a phone post with its own key - one the log already holds
 * is skipped - its provenance line saying `(carried over a restart)`; then the cut turn's restart line
 * (src/desk-session.ts `cutPhoneTurnLine`) to the network its key names, unless the desk already answered that turn (a
 * `desk-turn` cancelled by `restart`); then the `desk-carried`. A refused post (the pause, the fence) stops the carrying
 * for a later boot, with one line. A crash leaves the inbox's durable projection instead: a resumed conversation sends
 * its phone texts again, as it does its task messages.
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
  CARRY_MAX, CARRY_TEXT_MAX, busy, loggedId, operatorText, pauseInForce, pausedLine, pendingCarries, phoneContent, replyOf, waiting,
  type Carry, type ClaimsOn, type DeliverOpts, type DeliverResult, type PhonePost, type PostResult, type ReplyLines,
} from "./desk-conversation.ts";
import { CONVERSATION_PRESET } from "./desk-names.ts";
import {
  cancelKeepingQueue, cutOffLine, cutPhoneTurnLine, findFenceViolation, formatDuration, provenanceLine, readSessionEvents, superviseDeskTurns,
  type DeskSessionCtxLike, type DeskTurnRecord, type OpenTurnView, type SessionEventsOn,
} from "./desk-session.ts";
import type { AgentLike, MemberSetup, RoomDeps, SessionLike } from "./room.ts";
import type { EventLike, MessageLike } from "./room-rules.ts";
import { briefOrigin } from "./task-view.ts";

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
  /** How an answer reaches the phone: the desk conversation's `deliver` (src/desk-conversation.ts), absent with the
   * desk off (`FACE_DESK=0`) - then no turn sends anything. Never rejects. */
  deliver?: (text: string, opts: DeliverOpts) => Promise<DeliverResult>;
  /** dsh-agent's `agent/inbox/claimed` on the root context (src/desk.ts `claimsOf`): what a turn has claimed and not
   * yet logged, for the carry at dispose. Without it, such a text is not carried. */
  onClaimed?: ClaimsOn;
}

/** The label a fence check that rejects names: the turn is cut as a violation here. */
const FENCE_LABEL = "the conversation's folder";

/** The lines a conversation turn's reply is written with ({@link replyOf}): its own fence's refusal line. */
const CONVERSATION_LINES: ReplyLines = {
  fenceRefusalLine: (path) => (path === FENCE_LABEL
    ? "refused: the conversation's folder could not be checked, so the turn was cut. Write again; if it goes on, look at the face's log."
    : conversationFenceRefusalLine(path)),
  cutOffLine,
  formatDuration,
  notAnsweredLine: (error) => `Gravit could not answer: ${error}; nothing was done - send it again later`,
};

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
  /** The open turn's origin: `{ kind: "phone", network }` once the running turn has logged a phone text - whatever
   * message named the turn - with the last such text's network, `telegram` when it names none it knows; else
   * `{ kind: "web" }`. */
  turnOrigin(): TaskOrigin;
  /** Post a phone text (the module header's THE PHONE): `{ opened, sessionId }`, `duplicate` when its key was
   * already there and nothing was sent; else the refusal and the line the phone gets - `paused`, `fence` (with the
   * violation's path), or `error` (disposed, no session persistence, the log unreadable, the open or followup
   * failing). Posts run one at a time. Never rejects. */
  post(input: PhonePost): Promise<PostResult>;
  /** The phone's `/stop`: when the conversation's agent has work under way - a turn running, or one latched behind
   * maintenance (src/desk-conversation.ts `busy`) - cut it with `reason`, keeping the messages queued behind it
   * (src/desk-session.ts `cancelKeepingQueue`) - `true`; else `false`. Rejects when the cancel throws. */
  stop(reason: string): Promise<boolean>;
  /** Answer what a graceful stop carried (the module header's A RESTART), once per handle - later calls answer the
   * first's promise - after any post under way. Called once the phone is bound to the conversation and its outlet set
   * (src/desk.ts), never at a first open: a conversation that turns out not to be installed leaves its carries to the
   * desk session's fallback, so a carry is never posted twice. Never rejects. */
  carry(): Promise<void>;
  /** Ends the supervision, writes the phone texts still on the inbox as one `desk-carry` (the module header's A
   * RESTART), and disposes the agent this handle created or resumed; waits for an ensure and a post under way. */
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

/** `text` cut to at most `max` UTF-16 code units, never between the two halves of a surrogate pair (as src/watch.ts
 * `cutAt`, which this module does not load). */
function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** The networks a phone text's message names (src/phone.ts `PHONE_NETWORKS`). */
const isPhoneNetwork = (value: unknown): value is "telegram" | "slack" => value === "telegram" || value === "slack";

/** How many turns' phone texts a supervision remembers before their ends are heard. */
const PHONES_KEPT = 16;

/** The message source kind of a task's relay, report or note (src/task-relay.ts). */
const TASK_KIND = "task";
/** The message source kinds {@link requeueTasks} sends again: a task's message and the phone's text. */
const REQUEUED: ReadonlySet<string> = new Set([TASK_KIND, "telegram"]);

/** dsh-agent's `Agent.inbox`, its two lists and its `remove`, as src/desk-session.ts reads it. */
type InboxAware = { inbox?: { readonly nextTurn: readonly MessageLike[]; readonly nextStep?: readonly MessageLike[]; remove(id: string): boolean } };

/**
 * The resume's wake for the conversation: when `agent` is idle, take each `task` message and phone text waiting on its
 * inbox's next-turn list out and send it again with `followup`, oldest first, with one line. dsh opens no turn on a
 * resume for a message already on that list (src/desk-session.ts `requeuePending`), and the relay (src/task-relay.ts)
 * waits for an empty inbox, so a relay left there across a restart would block every relay after it; a phone text
 * left there would never be answered. Any other source - the browser's - stays where it is. A message `remove` says is gone was taken by a turn since: skipped, never sent twice.
 * @returns how many it sent again.
 */
function requeueTasks(agent: AgentLike, sessionId: string, log: (line: string) => void): number {
  const inbox = (agent as AgentLike & InboxAware).inbox;
  if (inbox === undefined || agent.status !== "idle") return 0;
  const waiting = inbox.nextTurn.filter((message) => REQUEUED.has(message.source?.kind as string));
  if (waiting.length === 0) return 0;
  let sent = 0;
  for (const message of waiting) {
    if (!inbox.remove(message.id)) continue;
    try {
      agent.followup(message);
      sent += 1;
    } catch (err) {
      log(`${BIN}: conversation: message ${message.id} on session ${sessionId} could not be queued again, and is lost: ${errText(err)}`);
    }
  }
  log(`${BIN}: conversation: session ${sessionId} was resumed idle with ${waiting.length} task message(s) or phone text(s) on its inbox; ${sent} sent again`);
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
  /** The open turn and, when it logged a phone text, that text's network and id - read for a shutdown's carry. */
  openPhoneTurn(): { open: OpenTurnView; phone?: { network?: "telegram" | "slack"; id?: string } } | undefined;
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
 * turn's start (a check that rejects counts as a violation at "the conversation's folder"), and an `onTurnEnd` that logs
 * and answers the phone (the module header's ANSWERS): its turns write no `desk-turn` and count against no budget.
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
    /* the phone texts each turn logged, by turn: a parked browser steer claimed first names the turn `user`, and a
     * phone text that follows it in the same turn must still be answered (and a task it starts is the phone's) */
    const phones = new Map<number, { network?: "telegram" | "slack"; id?: string }>();
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
      fenceLabel: FENCE_LABEL,
      skipKinds: SKIPPED,
      onTurnEnd: (record) => {
        const line = turnEndLine(record);
        if (line !== undefined) log(line);
        answer(record, phones.get(record.turn));
        phones.delete(record.turn);
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
      if (kind === "telegram" && state.turn !== undefined) {
        const network = (source as { network?: unknown }).network;
        const id = (data as { id?: unknown }).id;
        phones.set(state.turn, { ...(isPhoneNetwork(network) ? { network } : {}), ...(typeof id === "string" ? { id } : {}) });
        /* a turn whose end was never heard leaves its entry: keep the newest few */
        if (phones.size > PHONES_KEPT) phones.delete(phones.keys().next().value as number);
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
      openPhoneTurn: () => {
        const open = ended ? undefined : supervision.openTurn();
        if (open === undefined) return undefined;
        const phone = phones.get(open.turn);
        return { open, ...(phone === undefined ? {} : { phone }) };
      },
      turnOrigin: () => {
        const open = ended ? undefined : supervision.openTurn();
        const phone = open === undefined ? undefined : phones.get(open.turn);
        return phone === undefined ? { kind: "web" } : { kind: "phone", network: phone.network ?? "telegram" };
      },
    };
  };

  /** Where task `task`'s report goes: its phone's network when its brief says a phone on this conversation
   * (`conversationId`) asked for it; else `undefined`. The live log first, the stored one when it holds no brief. */
  const taskNetwork = async (task: string, conversationId: string): Promise<"telegram" | "slack" | undefined> => {
    let found = briefOrigin((deps.ctx.agents.get(task)?.session.snapshotEvents() ?? []) as readonly EventLike[]);
    if (found === undefined) {
      try {
        found = briefOrigin(await readSessionEvents(deps.ctx, task));
      } catch (err) {
        log(`${BIN}: conversation: task ${task}'s log could not be read (${errText(err)}); its report goes to no phone`);
        return undefined;
      }
    }
    return found?.origin === "phone" && found.conversation === conversationId ? found.network : undefined;
  };

  /** How turn `r`'s answer goes ({@link ConversationDeps.deliver}): a turn that logged a phone text (`phone`, the last
   * one's network) - whatever message named it - to that network; a phone task's report to that task's; else
   * `undefined`. */
  const answerOpts = async (r: DeskTurnRecord, phone: { network?: "telegram" | "slack" } | undefined): Promise<DeliverOpts | undefined> => {
    if (phone !== undefined || r.source === "telegram") {
      const network = phone !== undefined ? phone.network : r.message?.network;
      return isPhoneNetwork(network) ? { kind: "chat", network } : { kind: "chat" };
    }
    if (r.source !== TASK_KIND || r.message?.form !== "report" || typeof r.message.task !== "string") return undefined;
    const network = await taskNetwork(r.message.task, r.sessionId);
    return network === undefined ? undefined : { kind: "chat", network };
  };

  /* a turn's answer, in turn order; the chain never rejects */
  let answering: Promise<void> = Promise.resolve();
  const answer = (r: DeskTurnRecord, phone: { network?: "telegram" | "slack"; id?: string } | undefined): void => {
    const deliver = deps.deliver;
    if (deliver === undefined) return;
    answering = answering.then(async () => {
      const opts = await answerOpts(r, phone);
      if (opts === undefined) return;
      const text = replyOf(r, CONVERSATION_LINES, FENCE_LABEL);
      if (text === "") return; // it ended on a tool: there is nothing to say
      await deliver(text, opts);
    }).catch((err: unknown) => {
      log(`${BIN}: conversation: the answer to turn ${r.turn} on ${r.sessionId} could not be delivered: ${errText(err)}`);
    });
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
    hearClaims();
    return { agent: opened.agent, sessionId: opened.sessionId };
  };

  const ensure = (): Promise<{ agent: AgentLike; sessionId: string }> => {
    const next = tail.then(open, open);
    tail = next.catch(() => undefined);
    return next;
  };

  /** Keys this handle has followed up: a text dsh has claimed from the inbox and not yet logged is in neither. */
  const sent = new Set<string>();
  /** When the operator wrote each phone text this handle sent, by key - the newest {@link CARRY_MAX} times ten - for a
   * `desk-carry` to name: the message keeps it only in its provenance line. */
  const atOf = new Map<string, number>();
  /** The carry pass, once {@link ConversationHandle.carry} asked for it. */
  let carrying: Promise<void> | undefined;
  /** The phone texts dsh claimed for each agent's latest turn, by agent id: what a turn holds before it logs it. */
  const claims = new Map<string, { turn: number; messages: MessageLike[] }>();
  let unclaim: (() => void) | undefined;
  const hearClaims = (): void => {
    if (unclaim !== undefined || deps.onClaimed === undefined || disposed) return;
    try {
      unclaim = deps.onClaimed(({ agent, message, turn }) => {
        if (message?.source?.kind !== "telegram" || typeof agent?.id !== "string") return;
        const entry = claims.get(agent.id);
        if (entry === undefined || entry.turn !== turn) claims.set(agent.id, { turn, messages: [message] });
        else entry.messages.push(message);
      });
    } catch (err) {
      log(`${BIN}: conversation: dsh's inbox claims could not be heard (${errText(err)}); a text claimed but not yet logged at a shutdown is not carried`);
    }
  };
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
      if (input.source.at !== undefined) {
        atOf.delete(input.key);
        atOf.set(input.key, input.source.at);
        if (atOf.size > CARRY_MAX * 10) atOf.delete(atOf.keys().next().value as string);
      }
      await flush(`after the phone text ${input.key}`);
      return { opened: true, sessionId };
    } catch (err) {
      return failed(errText(err));
    }
  };
  let posting: Promise<unknown> = Promise.resolve();

  /** The restart line for a carry's `cut` - a phone turn a graceful stop cut, the conversation's or a desk's from before
   * the one entry - to the network its key names (`telegram` when it names none), through `deps.deliver`: unless the
   * desk's boot already answered that turn (a `desk-turn` cancelled by `restart`), and none with no `deliver`. A ledger
   * that cannot be read sends nothing, with one line. Never rejects. */
  const answerCut = async (carry: Carry): Promise<void> => {
    const cut = carry.cut!;
    const deliver = deps.deliver;
    if (deliver === undefined) return;
    try {
      const { events } = await readEvents(deps.home);
      if (events.some((e) => e.kind === "desk-turn" && e.sessionId === carry.sessionId && e.turn === cut.turn && e.cancel === "restart")) return;
    } catch (err) {
      log(`${BIN}: conversation: the ledger could not be read for turn ${cut.turn} on ${carry.sessionId}, which a graceful stop cut (${errText(err)}); it goes unanswered`);
      return;
    }
    const prefix = cut.key === undefined ? "" : cut.key.slice(0, Math.max(0, cut.key.indexOf(":")));
    const network = isPhoneNetwork(prefix) ? prefix : "telegram";
    const clock = deps.now ?? Date.now;
    const at = [cut.at, carry.t].map((x) => (x === undefined ? NaN : Date.parse(x))).find(Number.isFinite) ?? clock();
    try {
      await deliver(cutPhoneTurnLine(new Date(at), new Date(clock())), { kind: "chat", network });
    } catch (err) {
      log(`${BIN}: conversation: the restart line for turn ${cut.turn} on ${carry.sessionId} could not be delivered: ${errText(err)}`);
    }
  };

  /** One carry answered: each text posted again in order, as carried; then its cut turn's restart line; then its
   * `desk-carried`. `false`, with one line, when a post was refused: that carry and every later one wait for a later
   * boot. */
  const carryOne = async (carry: Carry): Promise<boolean> => {
    let posted = 0;
    let skipped = 0;
    for (const text of carry.queued) {
      const at = text.at === undefined ? NaN : Date.parse(text.at);
      /* the key is the bridge's (src/phone-bridge.ts `deliveryKey`): `<network>:<id>#<inbox>@<at>` */
      const hash = text.key.indexOf("#");
      const messageId = hash < 0 ? text.key : text.key.slice(0, hash);
      const prefix = messageId.slice(0, Math.max(0, messageId.indexOf(":")));
      const network = isPhoneNetwork(prefix) ? prefix : "telegram";
      const result = await postNow({
        text: text.text, key: text.key,
        source: { kind: "telegram", network, ...(Number.isFinite(at) ? { at } : {}), carried: true },
        message: { kind: "telegram", network, messageId },
      });
      if ("refused" in result) {
        log(`${BIN}: conversation: the texts a graceful stop carried could not all be posted again (${result.line}); a later boot tries again`);
        return false;
      }
      if (result.duplicate === true) skipped += 1;
      else posted += 1;
    }
    if (carry.cut !== undefined) await answerCut(carry);
    await appendEvent(deps.home, { t: new Date((deps.now ?? Date.now)()).toISOString(), kind: "desk-carried", of: carry.t, posted, skipped }, { log });
    return true;
  };

  /** Every carry no boot has answered, oldest first (the module header's A RESTART). Never rejects. */
  const carryAll = async (): Promise<void> => {
    let carries: Carry[];
    try {
      carries = pendingCarries((await readEvents(deps.home)).events, log, "conversation");
    } catch (err) {
      log(`${BIN}: conversation: the ledger could not be read at boot (${errText(err)}); what a graceful stop carried waits for a later boot`);
      return;
    }
    for (const carry of carries) {
      if (disposed) return;
      try {
        if (!(await carryOne(carry))) return;
      } catch (err) {
        log(`${BIN}: conversation: the desk-carry of ${carry.t} could not be answered (${errText(err)}); a later boot tries again`);
        return;
      }
    }
  };

  /** The phone's part of the held conversation, as one `desk-carry` of session `sessionId`, or `undefined` when there is
   * none (the module header's A RESTART): the phone texts claimed for the open turn and not yet logged, then those
   * waiting on the inbox's two lists, and the open turn as `cut` when it logged a phone text. Synchronous: read in the
   * tick before the agent is disposed. */
  const carryEvent = (agent: AgentLike, sessionId: string, w: Watch): Carry | undefined => {
    const inbox = (agent as AgentLike & InboxAware).inbox;
    const turn = w.openPhoneTurn();
    const claim = claims.get(agent.id);
    const held = turn !== undefined && claim?.turn === turn.open.turn
      ? claim.messages.filter((message) => !turn.open.logged.includes(message.id))
      : [];
    const queued: { key: string; text: string; at?: string }[] = [];
    const seenHere = new Set<string>();
    let dropped = 0;
    for (const message of [...held, ...(inbox?.nextTurn ?? []), ...(inbox?.nextStep ?? [])]) {
      if (message.source?.kind !== "telegram" || seenHere.has(message.id)) continue;
      seenHere.add(message.id);
      if (queued.length >= CARRY_MAX) {
        dropped += 1;
        continue;
      }
      const at = atOf.get(message.id);
      queued.push({
        key: message.id,
        text: cutText(operatorText(message), CARRY_TEXT_MAX),
        ...(at === undefined ? {} : { at: new Date(at).toISOString() }),
      });
    }
    if (dropped > 0) log(`${BIN}: conversation: ${dropped} phone text(s) queued past the first ${CARRY_MAX} are not carried over the shutdown`);
    let cut: Carry["cut"];
    if (turn?.phone !== undefined) {
      const key = turn.phone.id;
      const at = (key === undefined ? undefined : atOf.get(key)) ?? turn.open.at;
      cut = { turn: turn.open.turn, ...(key === undefined ? {} : { key }), ...(at === undefined ? {} : { at: new Date(at).toISOString() }) };
    }
    if (queued.length === 0 && cut === undefined) return undefined;
    return { t: new Date((deps.now ?? Date.now)()).toISOString(), kind: "desk-carry", sessionId, queued, ...(cut === undefined ? {} : { cut }) };
  };

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
    async stop(reason) {
      const agent = held?.agent;
      if (agent === undefined || !(await busy(agent))) return false;
      cancelKeepingQueue(agent, { kind: "hook", reason }, log);
      return true;
    },
    carry() {
      if (carrying === undefined) {
        const run = posting.then(carryAll);
        posting = run.catch(() => undefined);
        carrying = run.then(() => undefined, () => undefined);
      }
      return carrying;
    },
    async dispose() {
      disposed = true;
      await posting;
      await tail;
      const was = held;
      held = undefined;
      if (was === undefined) {
        unclaim?.();
        return;
      }
      /* the snapshot before the supervision ends: the open turn is still known */
      let event: ReturnType<typeof carryEvent>;
      try {
        event = carryEvent(was.agent, was.sessionId, was.watch);
      } catch (err) {
        log(`${BIN}: conversation: the phone's texts could not be carried over the shutdown: ${errText(err)}`);
      }
      was.watch.end();
      unclaim?.();
      unclaim = undefined;
      claims.clear();
      /* the snapshot, then the teardown that clears the inbox; the write after it */
      const disposing = was.handle === undefined ? Promise.resolve() : disposeQuietly(was.handle, was.sessionId, log);
      if (event !== undefined) await appendEvent(deps.home, event, { log });
      await disposing;
    },
  };
}
