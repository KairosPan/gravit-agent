// face/src/task-recovery.ts
/** A restart's recovery (one entry, plan 1, task 7; spec docs/superpowers/specs/2026-11-08-one-entry-router-design.md
 * §5.3 "Restart"): at install, every worker of the conversation in the window whose last turn the face's going cut -
 * left open in its log, ended `interrupted`, or ended `aborted` because its agent was disposed (the face's own shutdown)
 * - and that no recovery note names yet gets one, {@link RECOVERY_NOTE} under the id `task-recovery:<id>:<turn>`; then
 * every relay its log holds is offered. A cut turn that was waiting for the operator is recovered too: its parked gate
 * died with the process. src/tasks.ts runs it and owns the rows, the views and the resume.
 * @module
 */
import { MessageId, freezeMessage } from "@deepseek-ai/dsh-llm";
import type { EventLike, MessageLike } from "./room-rules.ts";
import { relaysOf, type RelayItem, type TaskView, type TimedEvent } from "./task-view.ts";

const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** What a worker whose turn a restart cut is told. */
export const RECOVERY_NOTE =
  "The face restarted while you worked. Check what you already did - files, the Account, your last tool results - before repeating anything outside, then carry on.";

/** The turn a restart cut, from the log: the last turn when it is still open, when it ended `interrupted`, or when it
 * ended `aborted` with the cause `disposed`. A turn a hook cancelled (a stop, a deadline) is not cut. */
export function cutTurn(events: readonly EventLike[]): number | undefined {
  let last: { turn: number; open: boolean; cut: boolean } | undefined;
  for (const event of events) {
    const data = event.data as { turn?: unknown; reason?: { kind?: unknown; reason?: { kind?: unknown } } } | undefined;
    if (typeof data?.turn !== "number") continue;
    if (event.type === "turn/start") last = { turn: data.turn, open: true, cut: false };
    else if (event.type === "turn/end") {
      const kind = data.reason?.kind;
      last = { turn: data.turn, open: false, cut: kind === "interrupted" || (kind === "aborted" && data.reason?.reason?.kind === "disposed") };
    }
  }
  if (last === undefined) return undefined;
  return last.open || last.cut ? last.turn : undefined;
}

/** Whether the log names message `id`: logged as a `user/message`, or spliced into the inbox. */
export function namesMessage(events: readonly EventLike[], id: string): boolean {
  return events.some((event) => {
    const data = event.data as { id?: unknown; inserted?: unknown } | undefined;
    if (event.type === "user/message") return data?.id === id;
    if (event.type === "agent/inbox/spliced" && Array.isArray(data?.inserted)) return data.inserted.some((m) => (m as { id?: unknown } | null)?.id === id);
    return false;
  });
}

/** A worker as the recovery sees it: its id and, when live, its status. */
export interface RecoveryRow { id: string; live?: { status: "idle" | "running" } }
/** An agent the recovery sends to. */
export interface RecoveryAgent { session: { snapshotEvents(): readonly EventLike[] }; followup(message: MessageLike): void }

/** What {@link recoverWorkers} needs, each from src/tasks.ts. */
export interface RecoveryDeps<R extends RecoveryRow> {
  conversation: string;
  rows: readonly R[];
  eventsOf(row: R): Promise<readonly TimedEvent[]>;
  viewOf(row: R, events: readonly TimedEvent[]): TaskView;
  inWindow(view: TaskView): boolean;
  /** The worker live, or resumed and held. */
  agentFor(row: R): Promise<RecoveryAgent>;
  offer(items: readonly RelayItem[]): void;
  disposed(): boolean;
  log(line: string): void;
}

/**
 * For each row in the window: a cut turn ({@link cutTurn}) of a task not stopped and not running live now is resumed
 * and sent the note once - none when the log, before or after the resume, already names it; then its relays are
 * offered. A worker that fails is one line, and the others go on. Never rejects.
 */
export async function recoverWorkers<R extends RecoveryRow>(deps: RecoveryDeps<R>): Promise<void> {
  for (const row of deps.rows) {
    if (deps.disposed()) return;
    try {
      const events = await deps.eventsOf(row);
      const view = deps.viewOf(row, events);
      if (!deps.inWindow(view)) continue;
      const turn = cutTurn(events);
      if (turn !== undefined && view.state !== "stopped" && row.live?.status !== "running") {
        const noteId = `task-recovery:${row.id}:${turn}`;
        const agent = await deps.agentFor(row);
        if (!namesMessage(events, noteId) && !namesMessage(agent.session.snapshotEvents(), noteId)) {
          agent.followup(freezeMessage({
            id: MessageId(noteId),
            role: "user",
            content: [{ type: "text", text: RECOVERY_NOTE }],
            source: { kind: "task", form: "recovery", conversation: deps.conversation, task: row.id },
          }) as unknown as MessageLike);
          deps.log(`${BIN}: task: worker ${row.id}'s turn ${turn} was cut by a restart; it got the recovery note`);
        }
      }
      deps.offer(relaysOf(view, events));
    } catch (err) {
      deps.log(`${BIN}: task: worker ${row.id} could not be recovered (${errText(err)})`);
    }
  }
}
