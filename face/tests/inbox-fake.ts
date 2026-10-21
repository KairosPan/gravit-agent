// face/tests/inbox-fake.ts
/** dsh-agent-loop's inbox and its wake as a desk cut meets them, for the desk's offline tests
 * (tests/desk-session.test.ts, tests/desk-conversation.test.ts). The real loop (dsh-agent-loop lib/index.js:
 * `send`, `cancel`, `wakeDriver`, `kick`), as tests/desk-smoke.test.ts's /stop section measures it on a real tree:
 * - a followup is queued on the inbox's next-turn list; one sent while the turn under way is still live wakes
 *   nothing of its own - the turn picks it up at its end - but one sent after a cancel aborted that turn latches a
 *   wake, which opens the next turn once the cut turn has unwound;
 * - `cancel(cause)` clears the inbox; `cancel(cause, { keepInbox: true })` keeps it - and a message queued before the
 *   cancel then waits there, unanswered, until something wakes the agent;
 * - a cut turn unwinds without looking at the inbox: the driver goes idle, and wakes again only for a latched wake.
 * Nothing here is dsh's code: a test drives the turns, and asks {@link InboxModel.converge} whether the driver
 * wakes once the cut turn has unwound. */
import type { MessageLike } from "../src/room-rules.ts";

/** dsh-agent's `Agent.inbox`, the slice the desk uses: the next-turn list, and removing one message from it. */
export interface InboxLike {
  readonly nextTurn: readonly MessageLike[];
  remove(id: string): boolean;
}

/** The inbox and the driver's wake, as the desk's cuts meet them. */
export class InboxModel {
  /** The next-turn list: the messages waiting for turns of their own, oldest first. */
  readonly pending: MessageLike[] = [];
  /** Whether a turn is under way, and whether a cancel has aborted it. */
  running = false;
  aborted = false;
  /** A wake latched by a message sent after the abort. */
  wakeRequested = false;
  readonly inbox: InboxLike;

  constructor() {
    const pending = this.pending;
    this.inbox = {
      get nextTurn(): readonly MessageLike[] {
        return [...pending];
      },
      remove(id: string): boolean {
        const at = pending.findIndex((message) => message.id === id);
        if (at < 0) return false;
        pending.splice(at, 1);
        return true;
      },
    };
  }

  /** `followup`: queued on the next-turn list - a second copy of a pending id is dsh's error - and, after an abort, a
   * latched wake. */
  send(message: MessageLike): void {
    if (this.pending.some((pending) => pending.id === message.id)) throw new Error(`message "${message.id}" is already pending`);
    this.pending.push(message);
    if (this.running && this.aborted) this.wakeRequested = true;
  }

  /** `cancel`: the inbox cleared - and any latched wake with it - unless `keepInbox`; the turn under way aborted. */
  cancel(options?: { keepInbox?: boolean }): void {
    if (options?.keepInbox !== true) {
      this.pending.length = 0;
      this.wakeRequested = false;
    }
    if (this.running) this.aborted = true;
  }

  /** The driver opens a turn: the oldest waiting message is its own. */
  claim(): MessageLike | undefined {
    return this.pending.shift();
  }

  /** The cut turn has unwound: the driver is idle, and wakes again - true - only for a latched wake with something to
   * answer. */
  converge(): boolean {
    const wakes = this.aborted && this.wakeRequested && this.pending.length > 0;
    this.running = false;
    this.aborted = false;
    this.wakeRequested = false;
    return wakes;
  }
}
