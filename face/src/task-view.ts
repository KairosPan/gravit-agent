// face/src/task-view.ts
/** The task view: what one task is - its state, steps, result, tokens - and what it has to tell the conversation, all
 * computed from the worker session's own log (spec docs/superpowers/specs/2026-11-08-one-entry-router-design.md
 * §5.4-§5.5: derived, not stored; a restart rebuilds it). Pure: no clock but the `now` it is handed, no I/O.
 *
 * A worker reports through `task_report` (src/task-worker.ts `taskReportTool`); {@link reportOf} is the one reading of
 * its arguments, for the tool and for this view alike, and the report is the call in the log, so nothing is kept
 * beside it.
 * @module
 */
import { relative, sep } from "node:path";
import { ANALOG_VIEW_ID_RE } from "./analog-view.ts";
import type { TurnUsage } from "./desk.ts";
import { turnUsage } from "./desk-session.ts";
import { DEFAULT_PRESET } from "./overlay.ts";
import { isPhoneNetwork, type PhoneNetwork } from "./phone.ts";
import { finalTextOf, type EventLike } from "./room-rules.ts";

/** A worker with an open turn and no session event for this long is stalled (20 minutes). */
export const STALL_MS = 1_200_000;
/** A report's text, and every relay's, is at most this many characters. */
export const TASK_TEXT_MAX = 600;
/** How many `progress` lines a view keeps, the last ones. */
export const STEPS_KEPT = 10;

/** What a worker's `task_report` says. */
export type ReportStatus = "progress" | "ready" | "blocked" | "failed";
/** What a relay into the conversation says. */
export type RelayStatus = "ready" | "blocked" | "failed" | "waiting" | "stalled";
/** A task's state, as the rail draws it. */
export type TaskState = "waiting" | "stalled" | "blocked" | "failed" | "running" | "done" | "stopped";
/** The rail's group a state falls in. */
export type TaskGroup = "you" | "running" | "done";

/** The statuses `task_report` takes, in the order its schema lists them. */
export const REPORT_STATUSES: readonly ReportStatus[] = Object.freeze(["progress", "ready", "blocked", "failed"]);
/** The tools whose answer names an analog view: `{ "ok": true, "view": "<id>", … }` as a JSON text. `analog_events`
 * alone since the chart analog was withdrawn (2026-11-13), so a task's `views` and its `eventViews` now hold the same
 * ids; `views` stays on the wire, the page reads `eventViews`. */
export const ANALOG_VIEW_TOOLS: readonly string[] = Object.freeze(["analog_events"]);

/** A session log event with dsh's own stamp, in ms since the epoch. */
export type TimedEvent = EventLike & { time?: number };

/** One task, as the rail and `GET /data/tasks` show it. */
export interface TaskView {
  id: string;
  title: string;
  strategy?: string;
  /** A bot task's bot: the worker's preset (its header's `agentPreset`) when it is not `gravit`. */
  bot?: string;
  /** Where the task was asked: the brief's `origin` (src/task-worker.ts), `web` for a brief that names none. */
  origin: "web" | "phone";
  /** For a phone task, the network its text came through. */
  network?: PhoneNetwork;
  state: TaskState;
  group: TaskGroup;
  waitingFor?: { kind: "approval" | "question"; id: string; tool: string };
  steps: string[];
  result?: { status: "ready" | "blocked" | "failed"; text: string };
  usage?: TurnUsage;
  /** The analog view ids its worker's {@link ANALOG_VIEW_TOOLS} calls answered, in the order answered, each once. */
  views: string[];
  /** Those of {@link views} an `analog_events` call answered, in the order answered, each once. */
  eventViews: string[];
  /** Those of {@link eventViews} named by the whole text of any relayed report or turn's last words ({@link namedViews}),
   * in the order first named, each once. */
  namedViews: string[];
  startedAt: number;
  lastEventAt: number;
  lastSeq: number;
}

/** One thing a task tells the conversation, under its fixed message id. */
export interface RelayItem {
  id: string;
  task: string;
  title: string;
  status: RelayStatus;
  text: string;
  /** The task's event views ({@link TaskView.eventViews}) this item's whole text names, read before the
   * {@link TASK_TEXT_MAX} cut; absent when it names none. */
  views?: string[];
  /** Set when the task came from the phone ({@link TaskView.origin}) and the item carries `views`. */
  phone?: true;
}

/** The analog view ids `text` names, kept when in `among`: in the order first named, each once. */
export function namedViews(text: string, among: readonly string[]): string[] {
  const found: string[] = [];
  for (const [id] of text.matchAll(/an-\d{8}-[0-9a-f]{8}/g)) if (among.includes(id) && !found.includes(id)) found.push(id);
  return found;
}

/** `text` at most `max` characters (code points): cut to `max - 1` and an ellipsis when longer. */
export function cut(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** `task_report`'s arguments, when they are exactly `{ status, text }` with a known status and a text of 1 to
 * {@link TASK_TEXT_MAX} characters that is not only whitespace; otherwise `undefined`. A JSON string is parsed first,
 * as the log keeps a call's arguments. */
export function reportOf(args: unknown): { status: ReportStatus; text: string } | undefined {
  let value = args;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("status") || !keys.includes("text")) return undefined;
  const { status, text } = value as { status: unknown; text: unknown };
  if (typeof status !== "string" || !(REPORT_STATUSES as readonly string[]).includes(status)) return undefined;
  if (typeof text !== "string" || text.trim() === "" || Array.from(text).length > TASK_TEXT_MAX) return undefined;
  return { status: status as ReportStatus, text };
}

/* ---------- one pass over the log ---------- */

type Data = Record<string, unknown>;
const dataOf = (event: EventLike): Data => (event.data !== null && typeof event.data === "object" ? event.data as Data : {});
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const timeOf = (event: EventLike | undefined): number | undefined => {
  const time = (event as { time?: unknown } | undefined)?.time;
  return typeof time === "number" && Number.isFinite(time) ? time : undefined;
};

interface Report { at: number; callId: string; status: ReportStatus; text: string }
interface Turn { turn: number; start: number; end?: number; reason?: unknown }
interface Gate { at: number; id: string; kind: "approval" | "question"; tool: string; detail: string }

interface Scan {
  title?: string;
  origin?: BriefOrigin;
  turns: Turn[];
  reports: Report[];
  gates: Gate[];
  /** Where each `dispatch` call that succeeded has its result: a turn holding one ended to wait on its round. */
  dispatches: number[];
  lastStart: number;
  lastEnd: number;
  lastStopped: number;
  /** The analog view ids the worker's {@link ANALOG_VIEW_TOOLS} calls answered, in the order answered, each once. */
  views: string[];
  /** Those of `views` an `analog_events` call answered, in the order answered, each once. */
  eventViews: string[];
}

/** Where a task was asked, as its brief's source names it (src/task-worker.ts `TaskMessageSource`): the conversation
 * that started it, `origin` - `web` for a brief that names none or one it does not know - and, for a phone task, its
 * `network`, `telegram` when it names none it knows (src/conversation.ts `turnOrigin` reads a phone text so). */
export interface BriefOrigin {
  conversation?: string;
  origin: "web" | "phone";
  network?: PhoneNetwork;
}

function originOfBrief(source: Data): BriefOrigin {
  const conversation = typeof source.conversation === "string" ? { conversation: source.conversation } : {};
  if (source.origin !== "phone") return { ...conversation, origin: "web" };
  const network = isPhoneNetwork(source.network) ? source.network : "telegram";
  return { ...conversation, origin: "phone", network };
}

/** The origin of the task whose log is `events`: its first brief's ({@link BriefOrigin}), or `undefined` when the log
 * holds no brief. */
export function briefOrigin(events: readonly EventLike[]): BriefOrigin | undefined {
  for (const event of events) {
    if (event.type !== "user/message") continue;
    const source = dataOf(event).source as Data | undefined;
    if (source?.kind === "task" && source.form === "brief") return originOfBrief(source);
  }
  return undefined;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: "text"; text: string } => b !== null && typeof b === "object" && (b as Data).type === "text" && typeof (b as Data).text === "string")
    .map((b) => b.text).join("\n");
}

function argsOf(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function questionsOf(raw: unknown): string {
  const questions = (argsOf(raw) as { questions?: unknown } | undefined)?.questions;
  if (!Array.isArray(questions)) return "";
  return questions.map((q) => str((q as Data | null)?.question)).filter((q): q is string => q !== undefined && q !== "").join(" / ");
}

/** The view id an analog tool's answer names: its text parsed as a JSON object whose `view` matches
 * {@link ANALOG_VIEW_ID_RE}; otherwise `undefined`. */
function viewIdOf(content: unknown): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(textOf(content)) as unknown;
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const view = (value as Data).view;
  return typeof view === "string" && ANALOG_VIEW_ID_RE.test(view) ? view : undefined;
}

function scan(events: readonly EventLike[]): Scan {
  const s: Scan = { turns: [], reports: [], gates: [], dispatches: [], lastStart: -1, lastEnd: -1, lastStopped: -1, views: [], eventViews: [] };
  const openTurns = new Map<number, Turn>();
  const asks = new Map<string, Gate>();
  const approvals = new Map<string, Gate>();
  /* task_report calls waiting for their result: a report counts once its result is logged and is no error */
  const calls = new Map<string, Report>();
  /* dispatch calls waiting for their result: a round runs once its result is logged and is no error */
  const dispatchCalls = new Set<string>();
  /* analog calls waiting for their result, by tool: a view counts once its result is logged, is no error and names one */
  const analogCalls = new Map<string, string>();
  events.forEach((event, at) => {
    const data = dataOf(event);
    switch (event.type) {
      case "user/message": {
        const source = data.source as Data | undefined;
        if (source?.kind !== "task") break;
        if (source.form === "brief" && s.title === undefined) {
          s.title = (textOf(data.content).split(/\r?\n/, 1)[0] ?? "").trim();
          s.origin = originOfBrief(source);
        }
        else if (source.form === "stopped") s.lastStopped = at;
        break;
      }
      case "turn/start": {
        if (typeof data.turn !== "number") break;
        const turn: Turn = { turn: data.turn, start: at };
        s.turns.push(turn);
        openTurns.set(data.turn, turn);
        s.lastStart = at;
        break;
      }
      case "turn/end": {
        if (typeof data.turn !== "number") break;
        let turn = openTurns.get(data.turn);
        if (turn === undefined) {
          /* an end whose start is not in this log: the turn began after the last end before it */
          turn = { turn: data.turn, start: s.lastEnd };
          s.turns.push(turn);
        }
        openTurns.delete(data.turn);
        /* a gate is pending only while the turn that asked it is open */
        asks.clear();
        approvals.clear();
        turn.end = at;
        turn.reason = data.reason;
        s.lastEnd = at;
        break;
      }
      case "tool/call": {
        const callId = str(data.callId);
        if (callId === undefined) break;
        if (data.name === "task_report") {
          const report = reportOf(data.arguments);
          if (report !== undefined) calls.set(callId, { at, callId, ...report });
        } else if (data.name === "dispatch") {
          dispatchCalls.add(callId);
        } else if (typeof data.name === "string" && ANALOG_VIEW_TOOLS.includes(data.name)) {
          analogCalls.set(callId, data.name);
        } else if (data.name === "ask_user_question") {
          asks.set(callId, { at, id: callId, kind: "question", tool: "ask_user_question", detail: questionsOf(data.arguments) });
        }
        break;
      }
      case "tool/result": {
        const message = data.message !== null && typeof data.message === "object" ? data.message as Data : undefined;
        const callId = str(message?.toolCallId);
        if (callId === undefined) break;
        asks.delete(callId);
        if (dispatchCalls.delete(callId) && message?.isError !== true) s.dispatches.push(at);
        const analogTool = analogCalls.get(callId);
        if (analogTool !== undefined && analogCalls.delete(callId) && message?.isError !== true) {
          const view = viewIdOf(message?.content);
          if (view !== undefined && !s.views.includes(view)) s.views.push(view);
          if (view !== undefined && analogTool === "analog_events" && !s.eventViews.includes(view)) s.eventViews.push(view);
        }
        const report = calls.get(callId);
        if (report !== undefined) {
          calls.delete(callId);
          if (message?.isError !== true) s.reports.push(report);
        }
        break;
      }
      case "approval/asked": {
        const id = str(data.id);
        if (id === undefined) break;
        approvals.set(id, { at, id, kind: "approval", tool: str(data.toolName) ?? "", detail: str(data.reason) ?? "" });
        break;
      }
      case "approval/decided": {
        const id = str(data.id);
        if (id !== undefined) approvals.delete(id);
        break;
      }
    }
  });
  s.reports.sort((a, b) => a.at - b.at);
  s.gates = [...asks.values(), ...approvals.values()].sort((a, b) => a.at - b.at);
  return s;
}

/** Whether `turn` ended to wait on a debate's round: a `dispatch` call in it succeeded (src/room.ts `dispatchToolDefinition`,
 * whose result tells the worker to end its turn). The round's end wakes the worker with a `room`/`round-end` message
 * and a new turn (src/room.ts `finishRound`), so such a turn is never the task's last word. */
function waitsOnRound(s: Scan, turn: Turn): boolean {
  return turn.end !== undefined && s.dispatches.some((at) => at > turn.start && at < turn.end!);
}

/** The error a turn ended on: its message's first line, else its code, else `error`. */
function errorLine(reason: unknown): string {
  const error = (reason as { error?: { message?: unknown; code?: unknown } } | undefined)?.error;
  const line = (str(error?.message)?.split(/\r?\n/, 1)[0] ?? "").trim();
  if (line !== "") return line;
  const code = str(error?.code);
  return code !== undefined && code !== "" ? code : "error";
}

/** The kind a turn ended with, `turn/end`'s `reason.kind`, or `unknown`. */
const kindOf = (reason: unknown): string => str((reason as { kind?: unknown } | null | undefined)?.kind) ?? "unknown";

/** The last report since `turn` started that is not `progress`. */
function settledBy(s: Scan, turn: Turn, until = Number.POSITIVE_INFINITY): Report | undefined {
  let found: Report | undefined;
  for (const r of s.reports) if (r.at > turn.start && r.at < until && r.status !== "progress") found = r;
  return found;
}

/** What an ended turn with no settling report means, by its end kind - the one table the view and the relays read:
 * `error` → `failed` with its error line; `blocked` and `max-tokens` → `blocked`; `aborted` and `interrupted` → the
 * task is `stalled` (cut, not finished) and relays nothing; `completed`, `forked` and any other kind → `done`, relayed
 * `ready`. A text is the turn's last words, or `the turn ended (<kind>) with no closing words` when it has none. */
function turnOutcome(events: readonly EventLike[], turn: Turn, max = TASK_TEXT_MAX): { state: TaskState; relay?: { status: "ready" | "blocked" | "failed"; text: string } } {
  const kind = kindOf(turn.reason);
  if (kind === "aborted" || kind === "interrupted") return { state: "stalled" };
  if (kind === "error") return { state: "failed", relay: { status: "failed", text: cut(errorLine(turn.reason), max) } };
  const words = finalTextOf(events, turn.turn);
  const text = cut(words === "" ? `the turn ended (${kind}) with no closing words` : words, max);
  if (kind === "blocked" || kind === "max-tokens") return { state: "blocked", relay: { status: "blocked", text } };
  return { state: "done", relay: { status: "ready", text } };
}

function strategyOf(root: string, cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined;
  const parts = relative(root, cwd).split(sep);
  if (parts.length !== 2 || parts[0] !== "strategies") return undefined;
  const name = parts[1]!;
  return name === "" || name === "." || name === ".." ? undefined : name;
}

function usageOf(events: readonly EventLike[], s: Scan): TurnUsage | undefined {
  let sum: TurnUsage | undefined;
  for (const turn of s.turns) {
    if (turn.start < 0) continue;
    const next = s.turns.find((t) => t.start > turn.start)?.start;
    const stop = turn.end !== undefined ? turn.end + 1 : next ?? events.length;
    let usage: TurnUsage | undefined;
    try {
      usage = turnUsage(events.slice(turn.start, stop));
    } catch {
      usage = undefined; // a turn the meter cannot read is a turn it cannot account: no tokens, as when it cannot prove them
    }
    if (usage === undefined) continue;
    if (sum === undefined) {
      sum = { ...usage, routes: [...new Set(usage.routes)] };
      continue;
    }
    sum.uncachedInputTokens += usage.uncachedInputTokens;
    sum.outputTokens += usage.outputTokens;
    sum.cacheReadTokens += usage.cacheReadTokens;
    sum.cacheWriteTokens += usage.cacheWriteTokens;
    for (const route of usage.routes) if (!sum.routes.includes(route)) sum.routes.push(route);
  }
  return sum;
}

/** What the task relays from its reports and turns ({@link relaysOf}), in log order, each text whole - before the
 * {@link TASK_TEXT_MAX} cut - so the views it names are read from all of it. Gates are not here. */
function relayed(events: readonly EventLike[], s: Scan): { at: number; key: string; status: "ready" | "blocked" | "failed"; whole: string }[] {
  const out: { at: number; key: string; status: "ready" | "blocked" | "failed"; whole: string }[] = [];
  for (const r of s.reports) {
    if (r.status === "progress") continue;
    out.push({ at: r.at, key: r.callId, status: r.status, whole: r.text });
  }
  for (const turn of s.turns) {
    if (turn.end === undefined || settledBy(s, turn, turn.end) !== undefined) continue;
    const outcome = turnOutcome(events, turn, Number.POSITIVE_INFINITY);
    const relay = outcome.relay;
    if (relay === undefined || (outcome.state === "done" && waitsOnRound(s, turn))) continue;
    out.push({ at: turn.end, key: `turn-${turn.turn}`, status: relay.status, whole: relay.text });
  }
  return out.sort((a, b) => a.at - b.at);
}

const GROUP: Record<TaskState, TaskGroup> = {
  waiting: "you", stalled: "you", blocked: "you", failed: "you", running: "running", done: "done", stopped: "done",
};

/**
 * One task's view from its worker's log. The state is the first rule that matches: `stopped` - a `task`/`stopped`
 * message after the last `turn/start`, or with none; `waiting` - an approval asked and not decided, or an
 * `ask_user_question` call with no result (`waitingFor` names the first); an open turn - `stalled` when its last event
 * is {@link STALL_MS} or more before `now`, else `running`; after the last `turn/end` - the last non-`progress` report
 * since that turn started (`ready` → `done`, `blocked`, `failed`), and with none the turn's end kind ({@link
 * turnOutcome}) - except that a turn that would read `done` but ended to wait on a debate's round ({@link waitsOnRound})
 * reads as an open turn does, `running`, or `stalled` once quiet for {@link STALL_MS}; no turn yet - `running`. A gate is pending only while the turn that asked it is open, and a report
 * counts once its result is logged and is no error.
 * @param input - `id`, the worker's session id; `header`, its creation time, folder and preset; `events`, its log in order;
 *   `root`, the repository root its strategy is read against; `now`, the clock the stall is judged by.
 */
export function taskViewOf(input: { id: string; header: { createdAt: number; cwd?: string; agentPreset?: string }; events: readonly TimedEvent[]; root: string; now: number }): TaskView {
  const { events } = input;
  const s = scan(events);
  const last = events.at(-1);
  let lastEventAt = input.header.createdAt;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = timeOf(events[i]);
    if (t !== undefined) { lastEventAt = t; break; }
  }
  const steps = s.reports.filter((r) => r.status === "progress").map((r) => r.text).slice(-STEPS_KEPT);

  let state: TaskState;
  let waitingFor: TaskView["waitingFor"];
  let result: TaskView["result"];
  const gate = s.gates[0];
  const lastTurn = s.turns.at(-1);
  if (s.lastStopped > s.lastStart) {
    state = "stopped";
  } else if (gate !== undefined) {
    state = "waiting";
    waitingFor = { kind: gate.kind, id: gate.id, tool: gate.tool };
  } else if (s.lastStart > s.lastEnd) {
    state = input.now - lastEventAt >= STALL_MS ? "stalled" : "running";
  } else if (lastTurn !== undefined && lastTurn.end !== undefined) {
    const report = settledBy(s, lastTurn);
    if (report !== undefined) {
      state = report.status === "ready" ? "done" : report.status === "blocked" ? "blocked" : "failed";
      result = { status: report.status as "ready" | "blocked" | "failed", text: cut(report.text, TASK_TEXT_MAX) };
    } else {
      const outcome = turnOutcome(events, lastTurn);
      if (outcome.state === "done" && waitsOnRound(s, lastTurn)) {
        /* a debate's round runs: the worker waits for its wake, quiet like an open turn */
        state = input.now - lastEventAt >= STALL_MS ? "stalled" : "running";
      } else {
        state = outcome.state;
        result = outcome.relay;
      }
    }
  } else {
    state = "running";
  }
  const usage = usageOf(events, s);
  const named: string[] = [];
  for (const r of relayed(events, s)) for (const id of namedViews(r.whole, s.eventViews)) if (!named.includes(id)) named.push(id);
  const strategy = strategyOf(input.root, input.header.cwd);
  const bot = input.header.agentPreset !== undefined && input.header.agentPreset !== DEFAULT_PRESET ? input.header.agentPreset : undefined;
  return {
    id: input.id,
    title: s.title !== undefined && s.title !== "" ? s.title : input.id,
    ...(strategy === undefined ? {} : { strategy }),
    ...(bot === undefined ? {} : { bot }),
    origin: s.origin?.origin ?? "web",
    ...(s.origin?.network === undefined ? {} : { network: s.origin.network }),
    state,
    group: GROUP[state],
    ...(waitingFor === undefined ? {} : { waitingFor }),
    steps,
    ...(result === undefined ? {} : { result }),
    ...(usage === undefined ? {} : { usage }),
    views: s.views,
    eventViews: s.eventViews,
    namedViews: named,
    startedAt: input.header.createdAt,
    lastEventAt,
    lastSeq: last?.seq ?? 0,
  };
}

/** The last ended turn's result text uncut: the report that settled it - its last `ready`, `blocked` or `failed`
 * `task_report` since it started - else its end kind's text ({@link turnOutcome}) without the relay's
 * {@link TASK_TEXT_MAX} cut; `undefined` when no turn has ended or the last one relays nothing. `task_read` reads it,
 * so closing words longer than a relay are not lost to the router. */
export function resultTextWhole(events: readonly EventLike[]): string | undefined {
  const s = scan(events);
  const last = s.turns.at(-1);
  if (last === undefined || last.end === undefined) return undefined;
  return settledBy(s, last)?.text ?? turnOutcome(events, last, Number.POSITIVE_INFINITY).relay?.text;
}

/**
 * What the task has to tell the conversation, in log order, each under a fixed id so a second read of the same log
 * gives the same items: each non-`progress` report (`task-report:<id>:<callId>`); each ended turn with no such report
 * since it started (`task-report:<id>:turn-<n>`, by its end kind, {@link turnOutcome}; a turn cut by `aborted` or
 * `interrupted` relays nothing, and so does one that ended `done` to wait on a debate's round, {@link waitsOnRound});
 * each gate still pending (`task-wait:<id>:<approval id or callId>`, `waiting`, the tool and the
 * question or reason). Every text is cut at {@link TASK_TEXT_MAX}; a report's or a turn's item carries the event views
 * its whole text names (`views`, {@link namedViews}), and `phone` with them when the task came from the phone.
 */
export function relaysOf(view: TaskView, events: readonly TimedEvent[]): RelayItem[] {
  const s = scan(events);
  const items: { at: number; item: RelayItem }[] = [];
  const item = (id: string, status: RelayStatus, text: string, views: string[] = []): RelayItem => ({
    id, task: view.id, title: view.title, status, text: cut(text, TASK_TEXT_MAX),
    ...(views.length === 0 ? {} : { views, ...(view.origin === "phone" ? { phone: true as const } : {}) }),
  });
  for (const r of relayed(events, s)) {
    items.push({ at: r.at, item: item(`task-report:${view.id}:${r.key}`, r.status, r.whole, namedViews(r.whole, s.eventViews)) });
  }
  for (const gate of s.gates) {
    const text = gate.detail === "" ? gate.tool : `${gate.tool}: ${gate.detail}`;
    items.push({ at: gate.at, item: item(`task-wait:${view.id}:${gate.id}`, "waiting", text) });
  }
  return items.sort((a, b) => a.at - b.at).map((x) => x.item);
}

/** The stall relay, `task-stall:<id>:<lastSeq>`, only for an OPEN turn - or a turn ended to wait on a debate's round
 * ({@link waitsOnRound}), whose wake never came - quiet for {@link STALL_MS} (spec §5.3): one per
 * stall, since any new event moves `lastSeq`. A turn cut by `aborted` or `interrupted` also reads as `stalled` in the
 * view, but relays nothing - after a restart the recovery note is the only message. `events` is the log the view was
 * read from, which tells the two apart.
 */
export function stallOf(view: TaskView, events: readonly TimedEvent[]): RelayItem | undefined {
  if (view.state !== "stalled") return undefined;
  const s = scan(events);
  const lastTurn = s.turns.at(-1);
  const waiting = lastTurn !== undefined && lastTurn.end !== undefined && settledBy(s, lastTurn) === undefined
    && turnOutcome(events, lastTurn).state === "done" && waitsOnRound(s, lastTurn);
  if (s.lastStart <= s.lastEnd && !waiting) return undefined;
  return {
    id: `task-stall:${view.id}:${view.lastSeq}`,
    task: view.id,
    title: view.title,
    status: "stalled",
    text: cut(`no progress since ${new Date(view.lastEventAt).toISOString()}`, TASK_TEXT_MAX),
  };
}
