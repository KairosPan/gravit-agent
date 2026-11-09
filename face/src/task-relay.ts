// face/src/task-relay.ts
/** Relays (one entry, plan 1, task 5): what a task tells the conversation - a worker's report, a wait, a stall, a
 * failure ({@link RelayItem}, src/task-view.ts) - becomes one `[task · …]` user message in the conversation, Gravit's
 * router session, under the item's fixed id, sent with `followup` only when the conversation is idle and both its
 * inbox lists are empty, so a relay never splices into the operator's turn or overtakes a message they typed. Before
 * each send the conversation's log is flushed and read and its inbox scanned, and an id already there is dropped: a
 * restart that re-offers a relay already delivered sends nothing twice (the fixed-id pattern of
 * src/desk-conversation.ts's keyed posts). The caller (task 7) pumps on each offer and on each `agent/status` of the
 * conversation to `idle`, from a microtask, never inside the bus. */
import { MessageId, freezeMessage } from "@deepseek-ai/dsh-llm";
import { readSessionEvents, type DeskSessionCtxLike } from "./desk-session.ts";
import type { AgentLike } from "./room.ts";
import type { EventLike, MessageLike } from "./room-rules.ts";
import { TASK_TEXT_MAX, cut, type RelayItem } from "./task-view.ts";

const BIN = "gravit-face";
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The relay's message text: the bracketed head `[task · <title> · <status>]` - every `]` and line break in the title
 * a space, so the head stays one line and one bracket - then the text cut at {@link TASK_TEXT_MAX} characters. */
export function relayText(item: RelayItem): string {
  const title = item.title.replace(/\r\n|[\]\r\n\u2028\u2029]/g, " ");
  return `[task · ${title} · ${item.status}]\n${cut(item.text, TASK_TEXT_MAX)}`;
}

/** The relays waiting for the conversation, and the pump that delivers them. */
export interface Relay {
  /** Queue `item`, first in first out, once per id: an id already offered is ignored. */
  offer(item: RelayItem): void;
  /** Send the first item not yet in the conversation, when the conversation is idle with an empty inbox; at most one
   * per call, and one delivery in flight at a time. Never rejects. */
  pump(): Promise<void>;
  /** The items still waiting, oldest first. */
  pending(): readonly RelayItem[];
}

export interface RelayDeps {
  /** The conversation as it is now, or `undefined` while there is none (src/conversation.ts `current()`). */
  conversation: () => { agent: AgentLike; sessionId: string } | undefined;
  ctx: { sessionPersistence?: { flush(): Promise<void> } } & DeskSessionCtxLike;
  log?: (line: string) => void;
}

/** dsh-agent's `Agent.inbox`, the two lists the relay reads (as src/desk-conversation.ts reads them). */
type InboxAware = { inbox?: { readonly nextTurn?: readonly MessageLike[]; readonly nextStep?: readonly MessageLike[] } };

/** The ids on `agent`'s two inbox lists. */
function inboxIds(agent: AgentLike): string[] {
  const inbox = (agent as AgentLike & InboxAware).inbox;
  return [...(inbox?.nextTurn ?? []), ...(inbox?.nextStep ?? [])].map((message) => message.id);
}

/** Whether `agent` may take a relay now: idle, nothing on either inbox list. */
function ready(agent: AgentLike): boolean {
  return agent.status === "idle" && inboxIds(agent).length === 0;
}

/** The id of the message a `user/message` event logs, when it has one. */
function loggedId(event: EventLike): string | undefined {
  if (event.type !== "user/message" || event.data === null || typeof event.data !== "object") return undefined;
  const id = (event.data as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/**
 * The relay for one face's conversation.
 * @param deps - the conversation's getter, the root context's slice (its `sessionPersistence` to flush and read the
 *   log) and a log line sink.
 * @returns the {@link Relay}; it holds the queue in memory only - a restart re-offers from the workers' logs (task 7).
 */
export function createRelay(deps: RelayDeps): Relay {
  const log = deps.log ?? ((line: string) => { console.error(line); });
  const queue: RelayItem[] = [];
  /** Every id ever offered: an id is queued once, and a sent one is not queued again. */
  const offered = new Set<string>();
  let inFlight: Promise<void> | undefined;
  /** A pump asked for while one was in flight: run once more after it. */
  let again = false;

  /** One delivery: at most one item sent. */
  const deliver = async (): Promise<void> => {
    if (queue.length === 0) return;
    const conv = deps.conversation();
    if (conv === undefined || !ready(conv.agent)) return;
    const persistence = deps.ctx.sessionPersistence;
    if (persistence === undefined) {
      log(`${BIN}: task: no session persistence; ${queue.length} relay(s) wait`);
      return;
    }
    let seen: Set<string>;
    try {
      await persistence.flush();
      seen = new Set<string>();
      for (const event of await readSessionEvents(deps.ctx, conv.sessionId)) {
        const id = loggedId(event);
        if (id !== undefined) seen.add(id);
      }
    } catch (err) {
      log(`${BIN}: task: the conversation's log could not be read (${errText(err)}); ${queue.length} relay(s) wait`);
      return;
    }
    /* read again after the awaits: the conversation may have been replaced, started a turn, or taken a message */
    const now = deps.conversation();
    if (now === undefined || now.sessionId !== conv.sessionId || now.agent !== conv.agent) return;
    for (const id of inboxIds(now.agent)) seen.add(id);
    while (queue.length > 0 && seen.has(queue[0]!.id)) queue.shift();
    const item = queue[0];
    if (item === undefined || !ready(now.agent)) return;
    const message = freezeMessage({
      id: MessageId(item.id),
      role: "user",
      content: [{ type: "text", text: relayText(item) }],
      source: { kind: "task", form: "report", task: item.task, status: item.status },
    });
    try {
      now.agent.followup(message as unknown as MessageLike);
    } catch (err) {
      log(`${BIN}: task: relay ${item.id} could not be sent (${errText(err)}); it waits`);
      return;
    }
    queue.shift();
    try {
      await persistence.flush();
    } catch (err) {
      log(`${BIN}: task: the conversation's log could not be flushed after relay ${item.id} (${errText(err)})`);
    }
  };

  const pump = (): Promise<void> => {
    if (inFlight !== undefined) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          again = false;
          try {
            await deliver();
          } catch (err) {
            log(`${BIN}: task: a relay delivery failed (${errText(err)}); ${queue.length} relay(s) wait`);
          }
        } while (again);
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  return {
    offer(item) {
      if (offered.has(item.id)) return;
      offered.add(item.id);
      queue.push(item);
    },
    pump,
    pending: () => [...queue],
  };
}
