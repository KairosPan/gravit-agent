// face/tests/task-relay.test.ts
/** Relays (src/task-relay.ts): a task's report reaches the conversation as one message under its fixed id, only when
 * the conversation is idle and its inbox empty. Offline. */
import test from "node:test";
import assert from "node:assert/strict";
import type { DeskSessionCtxLike } from "../src/desk-session.ts";
import type { AgentLike, SessionLike } from "../src/room.ts";
import type { EventLike, MessageLike } from "../src/room-rules.ts";
import { createRelay, relayText } from "../src/task-relay.ts";
import { TASK_TEXT_MAX, type RelayItem } from "../src/task-view.ts";

/** The conversation's agent: its status, its two inbox lists and the followups it was sent. */
class Conv {
  status: "idle" | "running" = "idle";
  readonly inbox = { nextTurn: [] as MessageLike[], nextStep: [] as MessageLike[], remove: () => false };
  readonly sent: MessageLike[] = [];
  /** The conversation's log on disk. */
  readonly log: EventLike[] = [];
  readonly persisted: string[] = [];
  readonly session: SessionLike = { id: "session-conv", header: {}, seq: 0, snapshotEvents: () => [], append: () => undefined };
  readonly agent: AgentLike = {
    id: "session-conv",
    get status() { return conv.status; },
    session: this.session,
    inbox: this.inbox,
    followup: (m: MessageLike) => {
      this.sent.push(m);
      this.inbox.nextTurn.push(m);
    },
    cancel: () => {},
  } as unknown as AgentLike;
  readonly ctx = {
    sessionPersistence: {
      open: async (id: string) => {
        this.persisted.push(`open ${id}`);
        let given = false;
        return {
          read: async () => {
            const events = given ? [] : [...this.log];
            given = true;
            return { events };
          },
          [Symbol.asyncDispose]: async () => {},
        };
      },
      flush: async () => { this.persisted.push("flush"); },
    },
  } as unknown as DeskSessionCtxLike;
  /** The turn the last followup opened has run to its end: logged, claimed, idle. */
  answer(): void {
    for (const m of this.inbox.nextTurn.splice(0)) this.log.push({ type: "user/message", seq: this.log.length, data: m });
    this.status = "idle";
  }
}
let conv: Conv;

function setup(opts: { exists?: () => boolean } = {}) {
  conv = new Conv();
  const lines: string[] = [];
  const relay = createRelay({
    conversation: () => (opts.exists?.() ?? true) ? { agent: conv.agent, sessionId: "session-conv" } : undefined,
    ctx: conv.ctx,
    log: (line) => { lines.push(line); },
  });
  return { relay, lines };
}

const item = (n: number, over: Partial<RelayItem> = {}): RelayItem =>
  ({ id: `task-report:w${n}:c${n}`, task: `w${n}`, title: `Task ${n}`, status: "ready", text: `report ${n}`, ...over });

const textOf = (m: MessageLike): string => (m.content as unknown as { text: string }[])[0]!.text;

test("an idle conversation with an empty inbox gets the relay at once: one followup, the item's id, source task/report", async () => {
  const { relay } = setup();
  relay.offer(item(1, { status: "blocked" }));
  await relay.pump();
  assert.equal(conv.sent.length, 1);
  const m = conv.sent[0]! as MessageLike & { source?: unknown; role?: string };
  assert.equal(m.id, "task-report:w1:c1");
  assert.equal(m.role, "user");
  assert.deepEqual(m.source, { kind: "task", form: "report", task: "w1", status: "blocked" });
  assert.equal(textOf(m), "[task · Task 1 · blocked]\nreport 1");
  assert.deepEqual(relay.pending(), []);
  assert.deepEqual(conv.persisted, ["flush", "open session-conv", "flush"], "flushed and read before, flushed after");
  await relay.pump();
  assert.equal(conv.sent.length, 1, "a second pump sends nothing more");
});

test("while the conversation runs, or while its inbox holds a message, the relay waits; at idle it goes", async () => {
  const { relay } = setup();
  conv.status = "running";
  relay.offer(item(1));
  await relay.pump();
  assert.equal(conv.sent.length, 0, "running: waits");
  conv.status = "idle";
  conv.inbox.nextTurn.push({ id: "operator-typed", role: "user", content: [] } as unknown as MessageLike);
  await relay.pump();
  assert.equal(conv.sent.length, 0, "a queued operator message: waits");
  conv.inbox.nextTurn.splice(0);
  conv.inbox.nextStep.push({ id: "steered", role: "user", content: [] } as unknown as MessageLike);
  await relay.pump();
  assert.equal(conv.sent.length, 0, "a next-step message: waits");
  conv.inbox.nextStep.splice(0);
  await relay.pump();
  assert.equal(conv.sent.length, 1, "idle with an empty inbox: goes");
  assert.equal(conv.sent[0]!.id, "task-report:w1:c1");
});

test("no conversation: the relay waits and nothing is read", async () => {
  let exists = false;
  const { relay } = setup({ exists: () => exists });
  relay.offer(item(1));
  await relay.pump();
  assert.equal(conv.sent.length, 0);
  assert.deepEqual(conv.persisted, []);
  exists = true;
  await relay.pump();
  assert.equal(conv.sent.length, 1);
});

test("the conversation starting a turn while the log is read: the relay waits for the next idle", async () => {
  const { relay } = setup();
  const flush = conv.ctx.sessionPersistence!.flush;
  conv.ctx.sessionPersistence!.flush = async () => { await flush(); conv.status = "running"; };
  relay.offer(item(1));
  await relay.pump();
  assert.equal(conv.sent.length, 0);
  assert.equal(relay.pending().length, 1);
});

test("an id already in the conversation's log or inbox is never sent again", async () => {
  const { relay } = setup();
  conv.log.push({ type: "user/message", seq: 0, data: { id: "task-report:w1:c1", role: "user", content: [] } });
  relay.offer(item(1));
  relay.offer(item(2));
  await relay.pump();
  assert.deepEqual(conv.sent.map((m) => m.id), ["task-report:w2:c2"], "the logged id dropped, the next one sent");
  conv.answer();
  relay.offer(item(2));
  relay.offer(item(1));
  await relay.pump();
  assert.equal(conv.sent.length, 1, "neither is sent again");
  assert.deepEqual(relay.pending(), []);
  /* an id that a restart left on the inbox */
  const { relay: again } = setup();
  const queued = { id: "task-report:w3:c3", role: "user", content: [] } as unknown as MessageLike;
  conv.inbox.nextTurn.push(queued);
  again.offer(item(3));
  await again.pump();
  assert.equal(conv.sent.length, 0, "waits behind the inbox");
  conv.answer();
  await again.pump();
  assert.equal(conv.sent.length, 0, "and, once logged, is dropped");
  assert.deepEqual(again.pending(), []);
});

test("items go in the order offered, one per idle", async () => {
  const { relay } = setup();
  relay.offer(item(1));
  relay.offer(item(2));
  relay.offer(item(1));
  relay.offer(item(3));
  assert.deepEqual(relay.pending().map((i) => i.task), ["w1", "w2", "w3"], "once per id");
  await Promise.all([relay.pump(), relay.pump(), relay.pump()]);
  assert.deepEqual(conv.sent.map((m) => m.id), ["task-report:w1:c1"], "overlapping pumps: one delivery");
  conv.answer();
  await relay.pump();
  conv.answer();
  await relay.pump();
  assert.deepEqual(conv.sent.map((m) => m.id), ["task-report:w1:c1", "task-report:w2:c2", "task-report:w3:c3"]);
});

test("a read that fails leaves the item queued, with one line", async () => {
  const { relay, lines } = setup();
  conv.ctx.sessionPersistence!.open = async () => { throw new Error("EIO"); };
  relay.offer(item(1));
  await relay.pump();
  assert.equal(conv.sent.length, 0);
  assert.equal(relay.pending().length, 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /EIO/);
});

test("the text is the bracketed head and at most 600 characters; a ] or a line break in a title becomes a space", () => {
  assert.equal(relayText(item(1, { title: "a]b\nc\r\nd", status: "stalled", text: "x" })), "[task · a b c d · stalled]\nx");
  const long = relayText(item(1, { text: "y".repeat(TASK_TEXT_MAX + 50) }));
  const [head, ...rest] = long.split("\n");
  assert.equal(head, "[task · Task 1 · ready]");
  const body = rest.join("\n");
  assert.equal(Array.from(body).length, TASK_TEXT_MAX);
  assert.ok(body.endsWith("…"));
});
