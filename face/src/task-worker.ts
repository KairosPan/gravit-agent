// face/src/task-worker.ts
/** Task workers: one root dsh session on the `gravit` preset per task, started by the conversation (src/conversation.ts;
 * spec docs/superpowers/specs/2026-11-08-one-entry-router-design.md §5.3).
 *
 * A worker is a runtime ROOT - `agents.create` gets `meta.parentSession` (the conversation, so the list can group it)
 * and never `parentAgent`: a parent agent would make the session unreachable from the browser (`session/agent-busy`).
 * Its setup installs the model selection and mounts the preset as the desk's does (src/desk-session.ts `deskSetup`) and
 * pins no permission, so a worker gets what a browser conversation gets: order cards wait for the operator there.
 *
 * Everything the model supplied - the strategy's name, the title, the brief - is checked before any session exists
 * ({@link TaskInputError}).
 * @module
 */
import type { PhoneNetwork } from "./phone.ts";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection as installDshModelSelection } from "@deepseek-ai/dsh-agent";
import { MessageId, freezeMessage } from "@deepseek-ai/dsh-llm";
import type { DeskSessionCtxLike } from "./desk-session.ts";
import type { DeskToolDefinition } from "./desk-tools.ts";
import { DEFAULT_PRESET } from "./overlay.ts";
import type { AgentLike, MemberSetup, RoomDeps } from "./room.ts";
import type { MessageLike } from "./room-rules.ts";
import { REPORT_STATUSES, TASK_TEXT_MAX, reportOf, type RelayStatus, type ReportStatus } from "./task-view.ts";

const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const defaultLog = (line: string): void => { console.error(line); };

/** A task's title: at most this many characters, one line. */
export const TASK_TITLE_MAX = 80;
/** A task's brief: at most this many characters. */
export const TASK_BRIEF_MAX = 4_000;

/** The `source` of a message the conversation's task machinery writes: the brief a worker starts from, the operator's
 * steer, a worker's report relayed to the conversation, a restart's recovery note, a stop. */
export type TaskMessageSource = {
  kind: "task";
  form: "brief" | "steer" | "report" | "recovery" | "stopped";
  conversation?: string;
  task?: string;
  /** A brief's: where the task was asked - the browser (`web`) or the phone, with the `network` the text came
   * through (src/conversation.ts `TaskOrigin`). A brief from before plan 3 names none, and reads `web`. */
  origin?: "web" | "phone";
  network?: PhoneNetwork;
  status?: RelayStatus;
};

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    task: TaskMessageSource;
  }
}

/** Input the model supplied that the face refuses: the message is the tool's error text. */
export class TaskInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskInputError";
  }
}

/** Whether `name` is a plain strategy name: 1-64 characters, no `/`, `\`, whitespace or control character, not `.` or
 * `..`, not starting with `.` or `_`. */
export function isStrategyName(name: string): boolean {
  if (name.length < 1 || name.length > 64) return false;
  if (name === "." || name === "..") return false;
  if (name.startsWith(".") || name.startsWith("_")) return false;
  // eslint-disable-next-line no-control-regex
  return !/[/\\\s\u0000-\u001f\u007f-\u009f]/u.test(name);
}

/** The directory of strategy `name` under repository `root`: `<root>/strategies/<name>`, when the name passes
 * {@link isStrategyName} and the path is a directory that is not a symlink. */
export async function strategyDir(root: string, name: string): Promise<string> {
  const refuse = (): TaskInputError => new TaskInputError(`no strategy named ${name}`);
  if (!isStrategyName(name)) throw refuse();
  const dir = join(root, "strategies", name);
  let stat;
  try {
    stat = await lstat(dir);
  } catch {
    throw refuse();
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw refuse();
  return dir;
}

/** What a worker is told at the end of every brief. */
export const TASK_FOOTER = `---
This is a task from Gravit's conversation with the operator, who does not read this session. When you are done, call task_report once with status "ready" and at most 600 characters: what you found or did, and where the full result is. If you cannot go on, call it with "blocked" and what you need, or "failed" and why. At each milestone call it with "progress" and one short line. Ask the operator with ask_user_question only when you cannot go on without an answer; order cards wait for the operator in the browser.`;

/** The brief's text: the title, the brief, then {@link TASK_FOOTER}. */
export function briefText(title: string, brief: string): string {
  return `${title}\n\n${brief}\n\n${TASK_FOOTER}`;
}

/** The booted ROOT context as a worker's start reads it: the desk session's slice and dsh's `sessionTitle` service. */
export type WorkerCtxLike = Pick<DeskSessionCtxLike, "agents" | "agentPresets" | "sessionPersistence"> & {
  get(name: "sessionTitle"): { rename(session: unknown, title: string): unknown } | undefined;
};

/** What {@link startWorker} needs: `root`, the repository root; `route`, the workers' model route;
 * `installModelSelection`, dsh-agent's, injected as src/room.ts's is; `log`, where a line goes (stderr). */
export interface WorkerDeps {
  ctx: WorkerCtxLike;
  root: string;
  route: { provider: string; model: string };
  installModelSelection: RoomDeps["installModelSelection"];
  log?: (line: string) => void;
}

/** A worker's composition, for its creation and every resume (src/tasks.ts): the model selection on `deps.route`, then
 * the `gravit` preset's mount. No permission is pinned. */
export function workerSetup(deps: WorkerDeps): MemberSetup {
  const route = { provider: deps.route.provider, model: deps.route.model };
  const install = deps.installModelSelection ?? ((agentCtx, ref) => installDshModelSelection(agentCtx as unknown as Context, ref));
  return async (agentCtx) => {
    install(agentCtx, { current: route, assembled: undefined });
    await deps.ctx.agentPresets.mount(agentCtx, DEFAULT_PRESET);
  };
}

/**
 * Start a worker: check the title (1-{@link TASK_TITLE_MAX} characters after trimming, one line), the brief
 * (1-{@link TASK_BRIEF_MAX}) and the strategy's folder - `root` itself when `strategy` is absent - before any session
 * exists; create the root session on `gravit` under `conversationId`; set its title; hand it the brief as one followup
 * with the fixed id `task-brief:<sessionId>`, its source naming the task's `origin` (and, for a phone's, its `network`);
 * flush the log.
 * @throws {TaskInputError} for input the face refuses; whatever `agents.create` rejects with otherwise.
 * @returns the session's id, its agent, and `dispose`, once however often called and never rejecting.
 */
export async function startWorker(
  deps: WorkerDeps,
  input: { conversationId: string; title: string; brief: string; strategy?: string; origin: "web" | "phone"; network?: PhoneNetwork },
): Promise<{ sessionId: string; agent: AgentLike; dispose(): Promise<void> }> {
  const log = deps.log ?? defaultLog;
  const title = input.title.trim();
  if (title.length < 1 || title.length > TASK_TITLE_MAX || /[\r\n]/.test(title)) {
    throw new TaskInputError(`the title is one line of 1 to ${TASK_TITLE_MAX} characters`);
  }
  if (input.brief.length < 1 || input.brief.length > TASK_BRIEF_MAX) {
    throw new TaskInputError(`the brief is 1 to ${TASK_BRIEF_MAX} characters`);
  }
  const cwd = input.strategy === undefined ? deps.root : await strategyDir(deps.root, input.strategy);
  const sessionId = `session-${randomUUID()}`;
  const handle = await deps.ctx.agents.create({
    sessionId,
    meta: { cwd, parentSession: input.conversationId, agentPreset: DEFAULT_PRESET },
    agentOptions: { provider: deps.route.provider, model: deps.route.model },
    setup: workerSetup(deps),
  });
  let disposing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposing ??= handle.dispose().catch((err: unknown) => { log(`${BIN}: task: could not dispose worker ${sessionId} (${errText(err)})`); });
    return disposing;
  };
  try {
    const titles = deps.ctx.get("sessionTitle");
    if (titles === undefined) log(`${BIN}: task: no session title service; worker ${sessionId} keeps the default title`);
    else titles.rename(handle.agent.session, title);
    const message = freezeMessage({
      id: MessageId(`task-brief:${sessionId}`),
      role: "user",
      content: [{ type: "text", text: briefText(title, input.brief) }],
      source: {
        kind: "task", form: "brief", conversation: input.conversationId, origin: input.origin,
        ...(input.origin === "phone" && input.network !== undefined ? { network: input.network } : {}),
      },
    });
    handle.agent.followup(message as unknown as MessageLike);
    await deps.ctx.sessionPersistence?.flush();
  } catch (err) {
    await dispose();
    throw err;
  }
  return { sessionId, agent: handle.agent, dispose };
}

/**
 * The worker's `task_report`: `{ status, text }`, both required, nothing else - `progress` with one short line at a
 * milestone, or `ready`, `blocked` or `failed` with at most {@link TASK_TEXT_MAX} characters. It checks its arguments
 * ({@link reportOf}) and answers `{ kind: "reported", status }`; it sends nothing - the call in the worker's log is the
 * report, and src/task-view.ts reads the relay from there.
 */
export function taskReportTool(): DeskToolDefinition {
  return {
    name: "task_report",
    description:
      "Report this task to Gravit's conversation with the operator. \"progress\": one short line at a milestone (it shows on the task's " +
      "line and reaches nobody). \"ready\": what you found or did and where the full result is. \"blocked\": what you need to go on. " +
      "\"failed\": why you cannot. At most 600 characters.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...REPORT_STATUSES] },
        text: { type: "string", minLength: 1, maxLength: TASK_TEXT_MAX },
      },
      required: ["status", "text"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: { kind: { type: "string", const: "reported" }, status: { type: "string", enum: [...REPORT_STATUSES] } },
        required: ["kind", "status"],
        additionalProperties: false,
      },
      render(_args, value) {
        const status = (value as { status?: unknown } | null)?.status;
        return [{ type: "text", text: `reported ${typeof status === "string" ? status : "?"}` }];
      },
    },
    timeoutMs: 10_000,
    async execute(args): Promise<{ kind: "reported"; status: ReportStatus }> {
      const report = reportOf(args);
      if (report === undefined) {
        throw new Error(`task_report takes { status, text }: status one of ${REPORT_STATUSES.join(", ")}, text 1 to ${TASK_TEXT_MAX} characters`);
      }
      return { kind: "reported", status: report.status };
    },
    presentCall(args) {
      const status = (args !== null && typeof args === "object" ? (args as { status?: unknown }).status : undefined);
      return { card: "generic", title: typeof status === "string" ? `Report: ${status}` : "Report", kind: "read" };
    },
  };
}

/** An agent as {@link equipWorkers} sees it: its id, for the log, its session's header, which says whether it is a
 * worker, and its own tool layer. */
export interface WorkerAgentLike {
  id: string;
  session: { header: { parentSession?: string; origin?: string } };
  ctx: { tools: { register(definition: DeskToolDefinition): unknown } };
}

/** The slice of the booted ROOT context {@link equipWorkers} uses: `agent/created` (every agent's create and resume)
 * and the agents already live. */
export interface WorkerToolsCtxLike {
  on(name: "agent/created", listener: (event: { agent: WorkerAgentLike }) => undefined): () => unknown;
  agents: { list(): readonly WorkerAgentLike[] };
}

/**
 * Give every worker {@link taskReportTool} in its own tool layer, as src/desk-tools.ts `installDeskTools` gives the
 * desk its tools: one listener on the ROOT context's `agent/created` and one sweep of `ctx.agents.list()`. An agent
 * whose session header `isWorker` accepts, and that has not been seen (a `WeakSet`, marked first), gets the tool once;
 * the listener is synchronous and never throws - a failure, `isWorker`'s own included, is one `gravit-face:` line.
 * @returns the disposer that removes the listener; tools already registered stay with their agents.
 */
export function equipWorkers(
  ctx: WorkerToolsCtxLike,
  isWorker: (header: { parentSession?: string; origin?: string }) => boolean,
  options: { log?: (line: string) => void } = {},
): () => void {
  const log = options.log ?? defaultLog;
  const tool = taskReportTool();
  const equipped = new WeakSet<WorkerAgentLike>();
  const equip = (agent: WorkerAgentLike): void => {
    try {
      if (equipped.has(agent) || !isWorker(agent.session.header)) return;
      equipped.add(agent);
      agent.ctx.tools.register(tool);
    } catch (err) {
      log(`${BIN}: task: task_report was not registered for agent ${agent.id}: ${errText(err)}`);
    }
  };
  const off = ctx.on("agent/created", ({ agent }) => {
    equip(agent);
    return undefined;
  });
  try {
    for (const agent of ctx.agents.list()) equip(agent);
  } catch (err) {
    log(`${BIN}: task: the agents already live could not be reached: ${errText(err)}`);
  }
  return () => {
    off();
  };
}
