// face/src/tasks.ts
/** The tasks installed (one entry, plan 1, task 7; spec docs/superpowers/specs/2026-11-08-one-entry-router-design.md
 * §5.3-§5.5): the conversation's {@link TaskOps} over its workers, `GET /data/tasks`, the relays on the root bus, the
 * recovery after a restart, the stalls, and the idle workers' disposal.
 *
 * NO REGISTRY. A task is its worker session: a session whose header names the conversation as `parentSession` and has
 * no `origin` - `sessionPersistence.list()` merged by id with the live agents. Its view, its relays and its stall are
 * read from its log every time (src/task-view.ts), live from the session's snapshot, cold from disk.
 *
 * THE BUS. The `session/event` and `agent/status` listeners only note and schedule: their work runs in a microtask,
 * since the bus calls them inside the session's own append, which refuses re-entry, and a `followup` there would
 * throw (src/desk-session.ts `superviseDeskTurns`' header).
 *
 * A RESTART. At install, src/task-recovery.ts sends each worker whose turn the face's going cut one recovery note,
 * and every relay a worker's log holds that the conversation's log does not is offered.
 * @module
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { MessageId, freezeMessage } from "@deepseek-ai/dsh-llm";
import type { ConversationCtxLike, ConversationHandle } from "./conversation.ts";
import { CONVERSATION_PRESET } from "./desk-names.ts";
import { readSessionEvents, type DeskSessionPersistenceLike } from "./desk-session.ts";
import type { DeskAgentLike, DeskToolsCtxLike } from "./desk-tools.ts";
import { etDayStart } from "./et.ts";
import { fencedGet, fencedPost, HttpError } from "./http.ts";
import type { AgentLike, PersistedSnapshotLike, RoomDeps } from "./room.ts";
import type { EventLike, MessageLike } from "./room-rules.ts";
import type { RouteRegistrar } from "./static.ts";
import { recoverWorkers } from "./task-recovery.ts";
import { createRelay } from "./task-relay.ts";
import { TASK_READ_MAX, equipConversation, taskToolDefinitions, type TaskOps } from "./task-tools.ts";
import { relaysOf, stallOf, taskViewOf, cut, type RelayItem, type TaskGroup, type TaskView, type TimedEvent } from "./task-view.ts";
import {
  equipWorkers, startWorker, strategyDir, workerSetup,
  type WorkerCtxLike, type WorkerDeps, type WorkerToolsCtxLike,
} from "./task-worker.ts";

const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const defaultLog = (line: string): void => { console.error(line); };

/** A held worker idle this long after its task went `done` or `stopped` is disposed (10 minutes). */
export const IDLE_DISPOSE_MS = 600_000;
/** How often the stalls and the idle workers are looked at (60 s). */
export const TICK_MS = 60_000;
export { RECOVERY_NOTE } from "./task-recovery.ts";
/** The steer text Continue sends a task from its page. */
export const CONTINUE_NOTE = "Continue the task. First check what you already did \u2014 files written, orders proposed, messages sent \u2014 and do not repeat any of it.";
/** The stopped marker's text. */
export const STOPPED_TEXT = "Stopped by the conversation.";

/** The states a task has ended in: a Stop on one of them is refused, so it never overwrites a result. */
const ENDED: ReadonlySet<TaskView["state"]> = new Set(["done", "stopped", "failed", "blocked"]);

/** A Stop on a task that already ended (`ENDED`): the route answers 409, `task_stop` says so. */
export class TaskEndedError extends Error {
  constructor(id: string, state: string) {
    super(`task ${id} already ended (${state}); there is nothing to stop`);
  }
}

/** Whether the conversation and its tasks are installed: unless `FACE_ROUTER` is `"0"`. */
export function routerEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.FACE_ROUTER !== "0";
}

/** A worker as the tasks drive it: dsh-agent's `steer` and `whenIdle` beside the room's narrowing. */
type TaskAgent = AgentLike & { steer(message: MessageLike): void; whenIdle(): Promise<void> };

/** The booted ROOT context as the tasks read it: the conversation's, a worker start's and the tool equippers' slices,
 * dsh-agent's `agent/status`, and the session store's `list` beside the desk's `open` and `flush`. */
export type TasksCtxLike = ConversationCtxLike & WorkerCtxLike & DeskToolsCtxLike & {
  on(name: "agent/status", listener: (payload: { agent: { id: string }; status: "idle" | "running" }) => void): () => unknown;
  sessionPersistence?: DeskSessionPersistenceLike & { list(): Promise<readonly PersistedSnapshotLike[]> };
};

/** What {@link installTasks} needs. `root` is the repository root (strategies are read under it); `route`, the
 * workers' model route; `isTrusted`, the data routes' fence; `now`, `setInterval` and `clearInterval`, the clock;
 * `log`, where a line goes (stderr). */
export interface TasksDeps {
  ctx: TasksCtxLike;
  root: string;
  route: { provider: string; model: string };
  installModelSelection: RoomDeps["installModelSelection"];
  conversation: ConversationHandle;
  isTrusted: (req: IncomingMessage) => boolean;
  now?: () => number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  log?: (line: string) => void;
}

/** The tasks as the face holds them: the operations the conversation's tools act through; `ready`, which settles
 * once the boot's recovery and relays are done (never rejects); and `dispose`, idempotent, which ends the listeners
 * and the tick and disposes every worker handle the tasks hold. */
export interface TasksHandle {
  ops: TaskOps;
  ready: Promise<void>;
  dispose(): Promise<void>;
}

/** One worker as the store and the registry give it. */
interface Row { id: string; createdAt: number; cwd?: string; live?: TaskAgent }
/** A worker handle the tasks hold, and since when its finished task has been idle. */
interface Held { agent: TaskAgent; dispose(): Promise<void>; idleSince?: number }

const GROUP_ORDER: Record<TaskGroup, number> = { you: 0, running: 1, done: 2 };

const createdAtOf = (header: object): number | undefined => {
  const value = (header as { createdAt?: unknown }).createdAt;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

/** The last assistant message's text in the log, or "". */
function lastAssistantText(events: readonly EventLike[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type !== "assistant/message") continue;
    const content = (events[i]!.data as { message?: { content?: unknown } } | undefined)?.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((b): b is { type: "text"; text: string } => (b as { type?: unknown } | null)?.type === "text" && typeof (b as { text?: unknown }).text === "string")
      .map((b) => b.text).join("\n").trim();
    if (text !== "") return text;
  }
  return "";
}

/**
 * Install the tasks: the five tools on the conversation's agent (src/task-tools.ts, guarded by the conversation's
 * `operatorTurn`), `task_report` on every worker (src/task-worker.ts), `GET /data/tasks`, the bus listeners, the
 * {@link TICK_MS} tick, and the boot's recovery and relays (see the module header).
 * @param webServer - where `GET /data/tasks` is registered: `{ ok, conversation, tasks }` through http.ts `fencedGet`.
 * @param deps - see {@link TasksDeps}; the conversation is ensured before this is called.
 */
export function installTasks(webServer: RouteRegistrar, deps: TasksDeps): TasksHandle {
  const { ctx } = deps;
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? Date.now;
  const every = deps.setInterval ?? setInterval;
  const stopEvery = deps.clearInterval ?? clearInterval;
  const workerDeps: WorkerDeps = { ctx, root: deps.root, route: deps.route, installModelSelection: deps.installModelSelection, log };
  const relay = createRelay({ conversation: () => deps.conversation.current(), ctx, log });
  const convId = (): string | undefined => deps.conversation.current()?.sessionId;
  const held = new Map<string, Held>();
  const resuming = new Map<string, Promise<TaskAgent>>();
  /** Workers a steer or a stop is acting on: the tick never disposes them meanwhile. */
  const inUse = new Map<string, number>();
  /** Run `act` with worker `id` marked in use, its idle clock stopped, from before the first await. */
  const using = async <T>(id: string, act: () => Promise<T>): Promise<T> => {
    inUse.set(id, (inUse.get(id) ?? 0) + 1);
    const entry = held.get(id);
    if (entry !== undefined) entry.idleSince = undefined;
    try {
      return await act();
    } finally {
      const left = (inUse.get(id) ?? 1) - 1;
      if (left > 0) inUse.set(id, left);
      else inUse.delete(id);
    }
  };
  /** Relay ids the conversation's log held at boot: never offered. */
  const delivered = new Set<string>();
  /** `task_report` calls seen on the bus and waiting for their result, keyed `<session>\0<callId>`. */
  const reportCalls = new Set<string>();
  let disposed = false;

  const isWorker = (header: { parentSession?: string; origin?: string }): boolean => {
    const conv = convId();
    return conv !== undefined && header.parentSession === conv && header.origin === undefined;
  };
  const liveWorker = (id: string): TaskAgent | undefined => {
    const agent = ctx.agents.get(id) as TaskAgent | undefined;
    return agent !== undefined && isWorker(agent.session.header) ? agent : undefined;
  };
  const rowOfLive = (agent: TaskAgent, createdAt?: number): Row => ({
    id: agent.id,
    createdAt: createdAtOf(agent.session.header) ?? createdAt ?? now(),
    ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
    live: agent,
  });
  const viewOf = (row: Row, events: readonly TimedEvent[]): TaskView => taskViewOf({
    id: row.id,
    header: { createdAt: row.createdAt, ...(row.cwd === undefined ? {} : { cwd: row.cwd }) },
    events,
    root: deps.root,
    now: now(),
  });
  const inWindow = (view: TaskView): boolean => !(view.group === "done" && view.lastEventAt < etDayStart(now()));
  const offer = (items: readonly RelayItem[]): void => {
    for (const item of items) if (!delivered.has(item.id)) relay.offer(item);
  };
  const flush = async (): Promise<void> => {
    try {
      await ctx.sessionPersistence?.flush();
    } catch (err) {
      log(`${BIN}: task: the session logs could not be flushed (${errText(err)})`);
    }
  };

  /** The conversation's workers: the store's headers merged by id with the live agents. */
  async function rows(conv: string): Promise<Map<string, Row>> {
    const found = new Map<string, Row>();
    for (const { header } of (await ctx.sessionPersistence?.list()) ?? []) {
      if (header.parentSession !== conv || header.origin !== undefined) continue;
      found.set(header.id, { id: header.id, createdAt: header.createdAt, ...(header.cwd === undefined ? {} : { cwd: header.cwd }) });
    }
    for (const agent of ctx.agents.list() as unknown as readonly TaskAgent[]) {
      if (agent.session.header.parentSession !== conv || agent.session.header.origin !== undefined) continue;
      found.set(agent.id, rowOfLive(agent, found.get(agent.id)?.createdAt));
    }
    return found;
  }
  const eventsOf = async (row: Row): Promise<readonly TimedEvent[]> =>
    (row.live !== undefined ? row.live.session.snapshotEvents() : await readSessionEvents(ctx, row.id)) as readonly TimedEvent[];

  /** The conversation's id, and the worker `id` of it, or `Error("no task <id>")`. */
  async function find(id: string): Promise<{ conv: string; row: Row }> {
    const conv = convId();
    const row = conv === undefined ? undefined : (await rows(conv)).get(id);
    if (conv === undefined || row === undefined) throw new Error(`no task ${id}`);
    return { conv, row };
  }

  /** The worker live, or resumed - once at a time per worker - and held. */
  function agentFor(row: Row): Promise<TaskAgent> {
    const live = liveWorker(row.id);
    if (live !== undefined) return Promise.resolve(live);
    let pending = resuming.get(row.id);
    if (pending === undefined) {
      pending = (async () => {
        const handle = await ctx.agents.resume({
          resumeSessionId: row.id,
          agentOptions: { provider: deps.route.provider, model: deps.route.model },
          setup: workerSetup(workerDeps),
        });
        let disposing: Promise<void> | undefined;
        const dispose = (): Promise<void> => {
          disposing ??= handle.dispose().catch((err: unknown) => { log(`${BIN}: task: could not dispose worker ${row.id} (${errText(err)})`); });
          return disposing;
        };
        if (disposed) {
          await dispose();
          throw new Error("the tasks are disposed");
        }
        held.set(row.id, { agent: handle.agent as TaskAgent, dispose });
        return handle.agent as TaskAgent;
      })();
      const settled = pending.finally(() => { resuming.delete(row.id); });
      settled.catch(() => undefined);
      resuming.set(row.id, pending);
    }
    return pending;
  }

  /** A worker whose folder is gone, while its strategy's directory is there under the current root, is pointed at it. */
  async function pointAtStrategy(agent: TaskAgent, cwd: string | undefined): Promise<void> {
    if (cwd === undefined) return;
    try {
      await stat(cwd);
      return;
    } catch (err) {
      if ((err as { code?: unknown }).code !== "ENOENT") return;
    }
    if (basename(dirname(cwd)) !== "strategies") return;
    let dir: string;
    try {
      dir = await strategyDir(deps.root, basename(cwd));
    } catch {
      return;
    }
    log(`${BIN}: task: worker ${agent.id}'s folder ${cwd} is gone; pointing it at ${dir}`);
    await ctx.workingDirectory.set(agent, dir);
  }

  /** Note whether a held worker's finished task sits idle, and since when. */
  function noteIdle(id: string, agent: TaskAgent, view: TaskView): void {
    const entry = held.get(id);
    if (entry === undefined || entry.agent !== agent) return;
    if (agent.status === "idle" && (view.state === "done" || view.state === "stopped")) entry.idleSince ??= now();
    else entry.idleSince = undefined;
  }

  /** A live worker's relays offered, its idleness noted, the relay pumped. Never rejects. */
  async function settle(id: string): Promise<void> {
    if (disposed) return;
    try {
      const agent = liveWorker(id);
      if (agent === undefined) return;
      const events = agent.session.snapshotEvents() as readonly TimedEvent[];
      const view = viewOf(rowOfLive(agent), events);
      offer(relaysOf(view, events));
      noteIdle(id, agent, view);
      await relay.pump();
    } catch (err) {
      log(`${BIN}: task: worker ${id} could not be read (${errText(err)})`);
    }
  }

  const ops: TaskOps = {
    async start(input) {
      const conv = convId();
      if (conv === undefined) throw new Error("there is no conversation");
      const started = await startWorker(workerDeps, {
        conversationId: conv, title: input.title, brief: input.brief,
        ...(input.origin?.kind === "phone" ? { origin: "phone", network: input.origin.network } : { origin: "web" }),
        ...(input.strategy === undefined ? {} : { strategy: input.strategy }),
      });
      const agent = started.agent as TaskAgent;
      held.set(started.sessionId, { agent, dispose: started.dispose });
      return viewOf(rowOfLive(agent), agent.session.snapshotEvents() as readonly TimedEvent[]);
    },
    steer: (id, text) => using(id, async () => {
      const { conv, row } = await find(id);
      const agent = await agentFor(row);
      await pointAtStrategy(agent, agent.session.header.cwd ?? row.cwd);
      const entry = held.get(id);
      if (entry !== undefined) entry.idleSince = undefined;
      agent.steer(freezeMessage({
        id: MessageId(`task-steer:${id}:${randomUUID()}`),
        role: "user",
        content: [{ type: "text", text }],
        source: { kind: "task", form: "steer", conversation: conv },
      }) as unknown as MessageLike);
      await flush();
      return viewOf(rowOfLive(agent, row.createdAt), agent.session.snapshotEvents() as readonly TimedEvent[]);
    }),
    stop: (id) => using(id, async () => {
      const { conv, row } = await find(id);
      /* read first: a Stop clicked in the poll's lag after the worker finished must not turn its result into stopped */
      const now0 = viewOf(row, await eventsOf(row));
      if (ENDED.has(now0.state)) throw new TaskEndedError(id, now0.state);
      const agent = await agentFor(row);
      agent.cancel({ kind: "hook", reason: "task stopped" });
      await agent.whenIdle();
      const message = freezeMessage({
        id: MessageId(`task-stopped:${id}:${randomUUID()}`),
        role: "user",
        content: [{ type: "text", text: STOPPED_TEXT }],
        source: { kind: "task", form: "stopped", conversation: conv },
      });
      agent.session.append("user/message", message as unknown as MessageLike, { surfaceOp: "append" });
      await flush();
      const view = viewOf(rowOfLive(agent, row.createdAt), agent.session.snapshotEvents() as readonly TimedEvent[]);
      noteIdle(id, agent, view);
      return view;
    }),
    async read(id) {
      const { row } = await find(id);
      const events = await eventsOf(row);
      const view = viewOf(row, events);
      /* the task's report first, when it has one: what it was asked for; else its closing words */
      const reported = view.result?.text ?? "";
      return { view, text: cut(reported !== "" ? reported : lastAssistantText(events), TASK_READ_MAX) };
    },
    async list() {
      const conv = convId();
      if (conv === undefined) return [];
      const views: TaskView[] = [];
      for (const row of (await rows(conv)).values()) {
        try {
          const view = viewOf(row, await eventsOf(row));
          if (inWindow(view)) views.push(view);
        } catch (err) {
          log(`${BIN}: task: worker ${row.id} could not be read (${errText(err)}); left out of the list`);
        }
      }
      return views.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || b.lastEventAt - a.lastEventAt);
    },
  };

  webServer.register({
    kind: "exact",
    path: "/data/tasks",
    handler: fencedGet(deps.isTrusted, async () => ({ conversation: convId() ?? null, tasks: await ops.list() })),
  });

  /* Stop and Continue from the task's page: `body.task` a non-empty string, an unknown id 404, a Stop on an ended task 409 */
  const taskRoute = (act: (id: string) => Promise<TaskView>) => fencedPost(deps.isTrusted, async (body) => {
    const id = body.task;
    if (typeof id !== "string" || id === "" || id.length > 200) throw new HttpError(400, "task is required");
    try {
      return { task: await act(id) };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("no task ")) throw new HttpError(404, "no such task");
      if (err instanceof TaskEndedError) throw new HttpError(409, "task already ended");
      throw err;
    }
  });
  webServer.register({ kind: "exact", path: "/data/tasks/stop", handler: taskRoute((id) => ops.stop(id)) });
  webServer.register({ kind: "exact", path: "/data/tasks/continue", handler: taskRoute((id) => ops.steer(id, CONTINUE_NOTE)) });

  const isConversation = (agent: DeskAgentLike): boolean => {
    if (ctx.agentPresets.composedPreset(agent.ctx) !== CONVERSATION_PRESET) return false;
    const conv = convId();
    return conv === undefined || conv === agent.id;
  };
  const offTools = equipConversation(ctx, isConversation, taskToolDefinitions(ops, () => deps.conversation.operatorTurn(), () => deps.conversation.turnOrigin()), { log });
  const offReport = equipWorkers(ctx as unknown as WorkerToolsCtxLike, isWorker, { log });

  /* the bus: note, and leave the work to a microtask */
  const offEvents = ctx.on("session/event", (session, event) => {
    if (disposed) return;
    const agent = ctx.agents.get(session.id);
    if (agent === undefined || !isWorker(agent.session.header)) return;
    const entry = held.get(session.id);
    if (entry !== undefined) entry.idleSince = undefined;
    const data = event.data as { name?: unknown; callId?: unknown; message?: { toolCallId?: unknown } } | undefined;
    let wake = false;
    if (event.type === "tool/call" && typeof data?.callId === "string") {
      if (data.name === "task_report") reportCalls.add(`${session.id}\0${data.callId}`);
      else if (data.name === "ask_user_question") wake = true;
    } else if (event.type === "tool/result") {
      const callId = data?.message?.toolCallId;
      wake = typeof callId === "string" && reportCalls.delete(`${session.id}\0${callId}`);
    } else if (event.type === "turn/end" || event.type === "approval/asked") {
      wake = true;
    }
    if (wake) queueMicrotask(() => { void settle(session.id); });
  });
  const offStatus = ctx.on("agent/status", ({ agent, status }) => {
    if (disposed || status !== "idle") return;
    const id = agent.id;
    queueMicrotask(() => {
      if (id === convId()) void relay.pump();
      else void settle(id);
    });
  });

  /* the tick: the stalls of the live workers, and the held ones idle long enough */
  let ticking = false;
  const tick = async (): Promise<void> => {
    if (disposed || ticking) return;
    ticking = true;
    try {
      for (const agent of ctx.agents.list() as unknown as readonly TaskAgent[]) {
        if (!isWorker(agent.session.header)) continue;
        const events = agent.session.snapshotEvents() as readonly TimedEvent[];
        const view = viewOf(rowOfLive(agent), events);
        const stall = stallOf(view, events);
        if (stall !== undefined) offer([stall]);
        noteIdle(agent.id, agent, view);
      }
      for (const [id, entry] of [...held]) {
        if (ctx.agents.get(id) !== entry.agent) {
          held.delete(id);
          continue;
        }
        if (inUse.has(id) || entry.idleSince === undefined || entry.agent.status !== "idle" || now() - entry.idleSince < IDLE_DISPOSE_MS) continue;
        held.delete(id);
        await entry.dispose();
      }
      await relay.pump();
    } catch (err) {
      log(`${BIN}: task: the tick failed (${errText(err)})`);
    } finally {
      ticking = false;
    }
  };
  const timer = every(() => { void tick(); }, TICK_MS);
  (timer as { unref?: () => void } | undefined)?.unref?.();

  /* the boot: recovery notes, then the relays the conversation has not had */
  const ready = (async () => {
    const conv = convId();
    if (conv === undefined) {
      log(`${BIN}: task: no conversation at install; nothing recovered`);
      return;
    }
    try {
      for (const event of await readSessionEvents(ctx, conv)) {
        const id = (event.data as { id?: unknown } | undefined)?.id;
        if (event.type === "user/message" && typeof id === "string") delivered.add(id);
      }
    } catch (err) {
      log(`${BIN}: task: the conversation's log could not be read at boot (${errText(err)}); the relay checks it before each send`);
    }
    await recoverWorkers({
      conversation: conv,
      rows: [...(await rows(conv)).values()],
      eventsOf,
      viewOf,
      inWindow,
      agentFor,
      offer,
      disposed: () => disposed,
      log,
    });
    await flush();
    await relay.pump();
  })().catch((err: unknown) => { log(`${BIN}: task: the boot's recovery failed (${errText(err)})`); });

  let disposing: Promise<void> | undefined;
  return {
    ops,
    ready,
    dispose() {
      disposing ??= (async () => {
        disposed = true;
        stopEvery(timer);
        offEvents();
        offStatus();
        offTools();
        offReport();
        await ready;
        await Promise.all([...resuming.values()].map((p) => p.catch(() => undefined)));
        const handles = [...held.values()];
        held.clear();
        await Promise.all(handles.map((h) => h.dispose()));
      })();
      return disposing;
    },
  };
}

/** What {@link installRouter} answers: both handles and the conversation's id, or nothing when the install failed. */
export type RouterInstall = { conversation: ConversationHandle; tasks: TasksHandle; sessionId: string } | Record<string, never>;

/**
 * The conversation and its tasks as main.ts installs them: `open.conversation()`, its `ensure()`, the fence checked
 * once (`open.fence`, a violation one loud line), then `open.tasks(conversation)`. A throw or rejection at any step is one line; the conversation already made is disposed
 * (a failure there is one more line), and the answer is empty, so the face starts without them. Never rejects.
 */
export async function installRouter(open: {
  conversation(): ConversationHandle;
  tasks(conversation: ConversationHandle): TasksHandle;
  /** The conversation's fence check (src/conversation.ts `conversationFence` over its folder), run once after the
   * ensure: a violation - a home that is itself a git checkout, a dotfiles repository - would refuse every turn, so it
   * is one loud line at boot rather than only a line per refused turn. The face still starts. */
  fence?: () => Promise<string | undefined>;
  log?: (line: string) => void;
}): Promise<RouterInstall> {
  const log = open.log ?? defaultLog;
  let conversation: ConversationHandle | undefined;
  try {
    conversation = open.conversation();
    const { sessionId } = await conversation.ensure();
    if (open.fence !== undefined) {
      try {
        const violation = await open.fence();
        if (violation !== undefined) {
          log(`${BIN}: conversation: THE FENCE WILL REFUSE EVERY TURN of ${sessionId}: it found ${violation} (a .git above the folder, or a file planted in it); remove it, or move the harness home`);
        }
      } catch (err) {
        log(`${BIN}: conversation: its fence could not be checked at boot (${errText(err)}); every turn checks it again`);
      }
    }
    return { conversation, tasks: open.tasks(conversation), sessionId };
  } catch (err) {
    log(`${BIN}: conversation: could not be installed (${errText(err)}); the face starts without the conversation and its tasks`);
    try {
      await conversation?.dispose();
    } catch (disposeErr) {
      log(`${BIN}: conversation: could not be disposed after the failed install (${errText(disposeErr)})`);
    }
    return {};
  }
}
