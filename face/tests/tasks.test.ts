// face/tests/tasks.test.ts
/** The tasks installed (src/tasks.ts, one entry plan 1 task 7): the operations over the conversation's workers,
 * `GET /data/tasks`, relays on the bus, boot recovery, stalls and idle disposal. Offline, on the room fakes
 * (tests/room-fake.ts) with a fake clock; the conversation is a fake handle over a fake agent, so no conversation's
 * folder is made and the repository root is a scratch directory under tests/tmp/<pid>. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { routerEnabled, installTasks, RECOVERY_NOTE, IDLE_DISPOSE_MS, type TasksDeps, type TasksHandle } from "../src/tasks.ts";
import type { ConversationHandle } from "../src/conversation.ts";
import type { EventLike, MessageLike } from "../src/room-rules.ts";
import type { AgentLike } from "../src/room.ts";
import { FakeAgent, FakeSession, FakeTree, toolResultMessage } from "./room-fake.ts";

/* ---------- scratch roots ---------- */

const TMP = join(import.meta.dirname, "tmp", String(process.pid));
after(() => rm(TMP, { recursive: true, force: true }));
let roots = 0;
async function repoRoot(): Promise<string> {
  const root = join(TMP, `tasks-${++roots}`);
  await mkdir(join(root, "strategies", "fx"), { recursive: true });
  return root;
}

/** Monday 2026-11-09 10:00 ET. */
const AT = Date.parse("2026-11-09T15:00:00.000Z");
const YESTERDAY = Date.parse("2026-11-08T20:00:00.000Z");
const CONV = "session-conv";
const ROUTE = { provider: "deepseek-official", model: "deepseek-flash" };

/* ---------- the harness ---------- */

type Ev = { type: string; data: unknown; time?: number };

class Harness {
  readonly tree = new FakeTree();
  readonly conv: FakeAgent;
  operator = true;
  readonly lines: string[] = [];
  readonly disposed: string[] = [];
  readonly cwdSets: { agent: string; path: string }[] = [];
  /** The order of what was done to a worker: a `set` of its folder, a steer. */
  readonly order: string[] = [];
  private readonly created: ((event: { agent: FakeAgent }) => undefined)[] = [];
  private readonly status: ((payload: { agent: { id: string }; status: "idle" | "running" }) => void)[] = [];
  private depth = 0;
  readonly ctx: TasksDeps["ctx"];
  readonly conversation: ConversationHandle;

  constructor(readonly root: string) {
    const { tree } = this;
    /* every event is stamped with the fake clock, and the append is marked so a send inside it throws, as dsh's does */
    const emit = tree.emit.bind(tree);
    tree.emit = (session: FakeSession, event: EventLike) => {
      this.depth++;
      try {
        emit(session, { time: tree.clock.now(), ...event } as EventLike);
      } finally {
        this.depth--;
      }
    };
    this.conv = tree.newRoom(CONV, "/conversation", "gravit-router");
    this.guard(this.conv);
    const conv = this.conv;
    this.conversation = {
      ensure: async () => ({ agent: conv as unknown as AgentLike, sessionId: CONV }),
      current: () => ({ agent: conv as unknown as AgentLike, sessionId: CONV }),
      operatorTurn: () => this.operator,
      dispose: async () => {},
    };
    const handle = (agent: FakeAgent) => ({
      agent,
      dispose: async () => { this.disposed.push(agent.id); tree.agents.delete(agent.id); },
    });
    const base = tree.ctx;
    this.ctx = {
      ...base,
      agents: {
        get: (id: string) => tree.agents.get(id),
        list: () => [...tree.agents.values()],
        create: async (options: Parameters<typeof base.agents.create>[0]) => {
          const { agent } = await base.agents.create(options);
          this.guard(agent as FakeAgent);
          for (const listener of this.created) listener({ agent: agent as FakeAgent });
          return handle(agent as FakeAgent);
        },
        resume: async (options: Parameters<typeof base.agents.resume>[0]) => {
          const { agent } = await base.agents.resume(options);
          this.guard(agent as FakeAgent);
          for (const listener of this.created) listener({ agent: agent as FakeAgent });
          return handle(agent as FakeAgent);
        },
      },
      agentPresets: { ...base.agentPresets, composedPreset: (agentCtx: unknown) => (agentCtx as { agent?: FakeAgent }).agent?.session.header.agentPreset },
      sessionPersistence: {
        list: base.sessionPersistence.list,
        flush: async () => {},
        open: async (id: string) => {
          const session = tree.sessions.get(id);
          if (session === undefined) throw new Error(`no session ${id}`);
          const events = session.snapshotEvents();
          return {
            read: async (offset = 0, length = 512) => ({ events: events.slice(offset, offset + length) }),
            [Symbol.asyncDispose]: async () => {},
          };
        },
      },
      workingDirectory: {
        set: async (agent: unknown, path: string) => {
          this.cwdSets.push({ agent: (agent as AgentLike).id, path });
          this.order.push(`set ${path}`);
          return path;
        },
      },
      get: (name: string) => (name === "sessionTitle" ? { rename: () => undefined } : undefined),
      on: ((name: string, listener: never) => {
        if (name === "agent/created") { this.created.push(listener); return () => {}; }
        if (name === "agent/status") { this.status.push(listener); return () => { this.status.splice(this.status.indexOf(listener), 1); }; }
        return base.on("session/event", listener);
      }) as never,
    } as unknown as TasksDeps["ctx"];
  }

  /** A send inside the session's own append throws, as dsh's does. */
  private guard(agent: FakeAgent): void {
    for (const name of ["followup", "steer", "inject"] as const) {
      const original = agent[name].bind(agent);
      agent[name] = (message: MessageLike) => {
        if (this.depth > 0) throw new Error(`${name} inside the session's append`);
        if (name === "steer") this.order.push("steer");
        original(message);
      };
    }
  }

  /** dsh's `agent/status`, as a test says it happened. */
  say(agent: FakeAgent, status: "idle" | "running"): void {
    for (const listener of [...this.status]) listener({ agent, status });
  }

  deps(): TasksDeps {
    const clock = this.tree.clock;
    return {
      ctx: this.ctx,
      root: this.root,
      route: ROUTE,
      installModelSelection: () => () => {},
      conversation: this.conversation,
      isTrusted: (req) => req.headers.host === "127.0.0.1:3090",
      now: () => clock.now(),
      setInterval: ((fn: () => void, ms: number) => {
        const box = { id: 0 };
        const loop = (): void => { box.id = clock.setTimeout(loop, ms); fn(); };
        box.id = clock.setTimeout(loop, ms);
        return box;
      }) as unknown as typeof setInterval,
      clearInterval: ((box: { id: number }) => { clock.clearTimeout(box.id); }) as unknown as typeof clearInterval,
      log: (line) => { this.lines.push(line); },
    };
  }

  /** A worker session already on disk (`live` false) or live, with `events` in its log. */
  seed(id: string, events: Ev[], opts: { cwd?: string; parentSession?: string; origin?: string; live?: boolean; running?: boolean } = {}): FakeSession {
    const header = {
      id,
      cwd: opts.cwd ?? this.root,
      parentSession: opts.parentSession ?? CONV,
      agentPreset: "gravit",
      createdAt: AT - 3_600_000,
      ...(opts.origin === undefined ? {} : { origin: opts.origin }),
    };
    const session = new FakeSession(id, header);
    session.tree = this.tree;
    this.tree.sessions.set(id, session);
    this.tree.persisted.push(header);
    for (const e of events) this.tree.emit(session, { type: e.type, seq: session.seq, data: e.data, ...(e.time === undefined ? {} : { time: e.time }) } as EventLike);
    if (opts.live === true) {
      const agent = new FakeAgent(this.tree, session, this.tree.scripts.get("gravit"));
      if (opts.running === true) agent.status = "running";
      this.guard(agent);
      this.tree.agents.set(id, agent);
    }
    return session;
  }

  /** The ids of the user messages a session logged, spliced into its inbox, or holds there, each once, in order. */
  ids(id: string): string[] {
    const session = this.tree.sessions.get(id)!;
    const seen: string[] = [];
    for (const e of session.snapshotEvents()) {
      if (e.type === "user/message") seen.push((e.data as MessageLike).id);
      if (e.type === "agent/inbox/spliced") for (const m of (e.data as { inserted: MessageLike[] }).inserted) seen.push(m.id);
    }
    const agent = this.tree.agents.get(id);
    if (agent !== undefined) for (const m of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) seen.push(m.id);
    return [...new Set(seen)];
  }

  /** The conversation takes what waits on its inbox as one turn, ends it, and goes idle. */
  async convTurn(): Promise<void> {
    this.conv.wake();
    this.conv.sleep();
    this.say(this.conv, "idle");
    await this.tree.clock.flush();
  }

  tool(name: string): { execute(args: unknown, exec?: unknown): Promise<unknown> } {
    const tool = this.conv.tools.find((t) => t.name === name);
    assert.ok(tool, `the conversation has ${name}`);
    return tool as unknown as { execute(args: unknown, exec?: unknown): Promise<unknown> };
  }
}

async function harness(): Promise<Harness> {
  const h = new Harness(await repoRoot());
  await h.tree.clock.advance(AT - h.tree.clock.now());
  return h;
}

async function install(h: Harness, webServer = recorder()): Promise<TasksHandle> {
  const tasks = installTasks(webServer, h.deps());
  await tasks.ready;
  await h.tree.clock.flush();
  return tasks;
}

/* ---------- log builders ---------- */

const brief = (id: string, title: string, time?: number): Ev => ({
  type: "user/message",
  data: { id: `task-brief:${id}`, role: "user", content: [{ type: "text", text: `${title}\n\nthe brief` }], source: { kind: "task", form: "brief", conversation: CONV, origin: "web" } },
  ...(time === undefined ? {} : { time }),
});
const start = (turn: number, time?: number): Ev => ({ type: "turn/start", data: { turn }, ...(time === undefined ? {} : { time }) });
const end = (turn: number, kind = "completed", time?: number): Ev => ({ type: "turn/end", data: { turn, reason: { kind } }, ...(time === undefined ? {} : { time }) });
const said = (turn: number, text: string, time?: number): Ev => ({
  type: "assistant/message",
  data: { turn, step: 1, message: { id: `m-${turn}-${text.length}`, role: "assistant", content: [{ type: "text", text }], source: { kind: "model", provider: "fake", model: "fake" } } },
  ...(time === undefined ? {} : { time }),
});
const report = (turn: number, callId: string, status: string, text: string): Ev[] => [
  { type: "tool/call", data: { turn, step: 1, callId, name: "task_report", arguments: JSON.stringify({ status, text }) } },
  { type: "tool/result", data: { turn, step: 1, message: toolResultMessage(`r-${callId}`, callId, false) } },
];

/* ---------- the route recorder ---------- */

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
function recorder(): { register(route: { path: string; handler: Handler }): void; paths(): string[]; get(path: string, host?: string): Promise<{ status: number; body: Record<string, unknown> }> } {
  const routes = new Map<string, Handler>();
  return {
    register(route) { routes.set(route.path, route.handler); },
    paths: () => [...routes.keys()],
    async get(path, host = "127.0.0.1:3090") {
      const handler = routes.get(path);
      assert.ok(handler, `a route at ${path}`);
      let status = 0;
      let body = "";
      const res = { writeHead(s: number) { status = s; return res; }, end(b: string) { body = b; } } as unknown as ServerResponse;
      await handler({ method: "GET", url: path, headers: { host } } as unknown as IncomingMessage, res);
      return { status, body: JSON.parse(body) as Record<string, unknown> };
    },
  };
}

/* ---------- the tests ---------- */

test("GET /data/tasks lists the conversation's workers — waiting for you first, then running, then today's done — leaves yesterday's done out, and is fenced", async (t) => {
  const h = await harness();
  h.seed("w-done-old", [brief("w-done-old", "Old", YESTERDAY), start(1, YESTERDAY), said(1, "done then", YESTERDAY), end(1, "completed", YESTERDAY)]);
  h.seed("w-done-a", [brief("w-done-a", "Done early", AT - 7_200_000), start(1, AT - 7_200_000), said(1, "found it", AT - 7_200_000), end(1, "completed", AT - 7_200_000)]);
  h.seed("w-done-b", [brief("w-done-b", "Done late", AT - 600_000), start(1, AT - 600_000), ...report(1, "c1", "ready", "all good").map((e) => ({ ...e, time: AT - 600_000 })), end(1, "completed", AT - 600_000)]);
  h.seed("w-running", [brief("w-running", "Running", AT - 60_000), start(1, AT - 60_000)], { live: true, running: true });
  h.seed("w-waiting", [brief("w-waiting", "Waiting", AT - 3_000_000), start(1, AT - 3_000_000), { type: "approval/asked", data: { id: "ap1", toolName: "mcp__account__portfolio_place_order", reason: "an order" }, time: AT - 3_000_000 }], { live: true, running: true });
  h.seed("w-other-conv", [brief("w-other-conv", "Elsewhere")], { parentSession: "session-other" });
  h.seed("w-with-origin", [brief("w-with-origin", "Not a worker")], { origin: "cli" });
  const rec = recorder();
  const tasks = await install(h, rec);
  t.after(() => tasks.dispose());

  assert.deepEqual(rec.paths(), ["/data/tasks"]);
  const got = await rec.get("/data/tasks");
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, true);
  assert.equal(got.body.conversation, CONV);
  const tasksOut = got.body.tasks as { id: string; group: string; state: string; title: string }[];
  assert.deepEqual(tasksOut.map((v) => [v.id, v.group, v.state]), [
    ["w-waiting", "you", "waiting"],
    ["w-running", "running", "running"],
    ["w-done-b", "done", "done"],
    ["w-done-a", "done", "done"],
  ]);
  assert.equal(tasksOut[0]!.title, "Waiting");

  const forged = await rec.get("/data/tasks", "evil.example.com");
  assert.equal(forged.status, 403);
  assert.deepEqual(forged.body, { ok: false, error: "forbidden" });

  const listed = await h.tool("task_list").execute({});
  assert.deepEqual((listed as { tasks: { task: string }[] }).tasks.map((x) => x.task), ["w-waiting", "w-running", "w-done-b", "w-done-a"], "task_list is the same window");
});

test("after a boot, a worker whose turn a restart cut gets one recovery note; a second boot sends none", async () => {
  const h = await harness();
  /* open: turn 1 started, never ended */
  h.seed("w-open", [brief("w-open", "Open", AT - 60_000), start(1, AT - 60_000), { type: "tool/call", data: { turn: 1, step: 1, callId: "b1", name: "bash", arguments: "{}" }, time: AT - 60_000 }]);
  /* interrupted: dsh closed the cut turn on a resume */
  h.seed("w-int", [brief("w-int", "Interrupted", AT - 60_000), start(1, AT - 60_000), end(1, "interrupted", AT - 50_000)]);
  /* a note already on its way: a boot that died after the splice, before the turn */
  h.seed("w-queued", [brief("w-queued", "Queued", AT - 60_000), start(1, AT - 60_000),
    { type: "agent/inbox/spliced", data: { target: "next-turn", start: 0, inserted: [{ id: "task-recovery:w-queued:1", role: "user", content: [] }] } }]);
  /* waiting for the operator: stays waiting */
  h.seed("w-wait", [brief("w-wait", "Waiting", AT - 60_000), start(1, AT - 60_000), { type: "approval/asked", data: { id: "ap", toolName: "x", reason: "y" } }]);
  /* done: nothing to recover */
  h.seed("w-done", [brief("w-done", "Done", AT - 60_000), start(1, AT - 60_000), said(1, "ok"), end(1)]);

  const first = await install(h);
  /* every send is one splice into the inbox, so a note sent twice is spliced twice */
  const notes = (id: string) => h.tree.sessions.get(id)!.snapshotEvents()
    .filter((e) => e.type === "agent/inbox/spliced")
    .flatMap((e) => (e.data as { inserted: MessageLike[] }).inserted.map((m) => m.id))
    .filter((m) => m.startsWith("task-recovery:"));
  assert.deepEqual(notes("w-open"), ["task-recovery:w-open:1"]);
  assert.deepEqual(notes("w-int"), ["task-recovery:w-int:1"]);
  assert.deepEqual(notes("w-queued"), ["task-recovery:w-queued:1"], "the spliced note is not sent again");
  assert.deepEqual(notes("w-wait"), []);
  assert.deepEqual(notes("w-done"), []);
  const note = h.tree.sessions.get("w-open")!.snapshotEvents().find((e) => e.type === "user/message" && (e.data as MessageLike).id === "task-recovery:w-open:1")!;
  assert.deepEqual((note.data as { content: unknown }).content, [{ type: "text", text: RECOVERY_NOTE }]);
  assert.equal(RECOVERY_NOTE, "The face restarted while you worked. Check what you already did - files, the Account, your last tool results - before repeating anything outside, then carry on.");
  assert.deepEqual((note.data as { source: unknown }).source, { kind: "task", form: "recovery", conversation: CONV, task: "w-open" });
  assert.deepEqual(h.tree.resumed.map((r) => (r as { resumeSessionId: string }).resumeSessionId).sort(), ["w-int", "w-open", "w-queued"], "the queued one is resumed, so dsh runs what its inbox holds");

  /* the recovered turns run to their end; then the face restarts */
  await h.tree.clock.advance(100);
  await first.dispose();
  for (const id of ["w-open", "w-int"]) h.tree.agents.delete(id);
  const second = await install(h);
  assert.deepEqual(notes("w-open"), ["task-recovery:w-open:1"]);
  assert.deepEqual(notes("w-int"), ["task-recovery:w-int:1"]);
  assert.deepEqual(notes("w-queued"), ["task-recovery:w-queued:1"]);
  await second.dispose();
});

test("a report already in the conversation's log is not relayed again after a boot; one not yet there is, once", async () => {
  const h = await harness();
  h.seed("w-r", [brief("w-r", "Reports", AT - 60_000), start(1), ...report(1, "c1", "ready", "first"), end(1), start(2), ...report(2, "c2", "ready", "second"), end(2)]);
  /* the conversation already holds the first report */
  h.tree.emit(h.tree.sessions.get(CONV)!, { type: "user/message", seq: 0, data: { id: "task-report:w-r:c1", role: "user", content: [{ type: "text", text: "[task · Reports · ready]" }], source: { kind: "task", form: "report" } } } as EventLike);

  const first = await install(h);
  const relayed = () => h.ids(CONV).filter((id) => id.startsWith("task-report:"));
  assert.deepEqual(relayed(), ["task-report:w-r:c1", "task-report:w-r:c2"]);
  const sent = h.conv.inbox.nextTurn[0]!;
  assert.equal(sent.id, "task-report:w-r:c2");
  assert.match((sent.content as unknown as { text: string }[])[0]!.text, /^\[task · Reports · ready\]\n<<<task-data [0-9a-f]{16}>>>\nsecond\n<<<end [0-9a-f]{16}>>>$/);
  await h.convTurn();
  assert.deepEqual(relayed(), ["task-report:w-r:c1", "task-report:w-r:c2"], "the idle pump sends nothing more");

  await first.dispose();
  const second = await install(h);
  await h.convTurn();
  assert.deepEqual(relayed(), ["task-report:w-r:c1", "task-report:w-r:c2"], "a second boot relays nothing twice");
  await second.dispose();
});

test("a worker's report while the face runs reaches the conversation once, from a microtask, and waits for idle", async (t) => {
  const h = await harness();
  const tasks = await install(h);
  t.after(() => tasks.dispose());
  h.tree.script("gravit", () => ({ kind: "hang" }));
  const view = await tasks.ops.start({ title: "Live", brief: "do it", strategy: "fx" });
  const worker = h.tree.agents.get(view.id)!;
  assert.ok(worker.tools.some((x) => x.name === "task_report"), "the worker got task_report");
  h.conv.status = "running";
  for (const e of report(1, "c9", "ready", "found")) h.tree.emit(worker.session, { type: e.type, seq: worker.session.seq, data: e.data } as EventLike);
  await h.tree.clock.flush();
  assert.deepEqual(h.ids(CONV), [], "not while the conversation runs");
  h.conv.status = "idle";
  h.say(h.conv, "idle");
  await h.tree.clock.flush();
  assert.deepEqual(h.ids(CONV), [`task-report:${view.id}:c9`]);
  assert.deepEqual(h.lines.filter((l) => /inside the session's append/.test(l)), []);
});

test("a worker silent for 20 minutes is relayed stalled once per stall", async (t) => {
  const h = await harness();
  const session = h.seed("w-s", [brief("w-s", "Slow", AT), start(1, AT)], { live: true, running: true });
  const tasks = await install(h);
  t.after(() => tasks.dispose());
  const stalls = () => h.ids(CONV).filter((id) => id.startsWith("task-stall:"));
  await h.tree.clock.advance(19 * 60_000);
  assert.deepEqual(stalls(), []);
  await h.tree.clock.advance(2 * 60_000);
  assert.equal(stalls().length, 1);
  await h.convTurn();
  await h.tree.clock.advance(5 * 60_000);
  assert.equal(stalls().length, 1, "the same stall is not relayed again");
  h.tree.emit(session, { type: "tool/call", seq: session.seq, data: { turn: 1, step: 1, callId: "b2", name: "bash", arguments: "{}" } } as EventLike);
  await h.tree.clock.advance(21 * 60_000);
  assert.equal(stalls().length, 2, "a new stall after new activity");
  assert.notEqual(stalls()[0], stalls()[1]);
});

test("a done worker's handle is disposed 10 minutes after it went idle; task_steer resumes it and steers it", async (t) => {
  const h = await harness();
  const tasks = await install(h);
  t.after(() => tasks.dispose());
  const out = await h.tool("task_start").execute({ title: "Quick", brief: "look", strategy: "fx" }) as { task: string };
  const id = out.task;
  await h.tree.clock.advance(50); // the fake answers "(pass)" and ends the turn
  assert.equal((await tasks.ops.read(id)).view.state, "done");
  await h.tree.clock.advance(IDLE_DISPOSE_MS - 2 * 60_000);
  assert.deepEqual(h.disposed, []);
  await h.tree.clock.advance(3 * 60_000);
  assert.deepEqual(h.disposed, [id]);
  assert.equal(h.tree.agents.get(id), undefined);

  const steered = await h.tool("task_steer").execute({ task: id, text: "and the other one" }) as { task: string; state: string };
  assert.equal(steered.task, id);
  assert.ok(h.tree.resumed.some((r) => (r as { resumeSessionId: string }).resumeSessionId === id));
  const steer = h.ids(id).find((m) => m.startsWith(`task-steer:${id}:`));
  assert.ok(steer, "the steer is in the worker's log");
  const logged = h.tree.sessions.get(id)!.snapshotEvents().find((e) => e.type === "user/message" && (e.data as MessageLike).id === steer)!;
  assert.deepEqual((logged.data as { source: unknown }).source, { kind: "task", form: "steer", conversation: CONV });
  await assert.rejects(h.tool("task_steer").execute({ task: "session-nope", text: "x" }), /^Error: no task session-nope$/);
});

test("task_stop cancels the turn, waits for idle, and appends the stopped marker; the view says stopped", async (t) => {
  const h = await harness();
  const tasks = await install(h);
  t.after(() => tasks.dispose());
  h.tree.script("gravit", () => ({ kind: "hang" }));
  const view = await tasks.ops.start({ title: "Long", brief: "work" });
  const worker = h.tree.agents.get(view.id)!;
  assert.equal(worker.status, "running");
  const stopping = h.tool("task_stop").execute({ task: view.id }) as Promise<{ task: string; state: string }>;
  await h.tree.clock.advance(10);
  const stopped = await stopping;
  assert.deepEqual(worker.cancelled.map((c) => c.cause), [{ kind: "hook", reason: "task stopped" }]);
  assert.deepEqual(stopped, { task: view.id, state: "stopped" });
  const marker = worker.session.snapshotEvents().filter((e) => e.type === "user/message").at(-1)!;
  const data = marker.data as { id: string; content: unknown; source: unknown };
  assert.match(data.id, new RegExp(`^task-stopped:${view.id}:[0-9a-f-]{36}$`));
  assert.deepEqual(data.content, [{ type: "text", text: "Stopped by the conversation." }]);
  assert.deepEqual(data.source, { kind: "task", form: "stopped", conversation: CONV });
  assert.equal((await tasks.ops.read(view.id)).view.state, "stopped");
  assert.deepEqual(h.ids(CONV), [], "a stop relays nothing");
  await assert.rejects(tasks.ops.stop("session-nope"), /^Error: no task session-nope$/);
  h.operator = false;
  await assert.rejects(h.tool("task_stop").execute({ task: view.id }), /operator/);
});

test("steering a task whose strategy directory was renamed points the worker at the current directory first", async (t) => {
  const h = await harness();
  const old = join(h.root, "..", "moved-away", "strategies", "fx");
  h.seed("w-moved", [brief("w-moved", "Moved", AT - 60_000), start(1), said(1, "done"), end(1)], { cwd: old });
  const tasks = await install(h);
  t.after(() => tasks.dispose());
  await tasks.ops.steer("w-moved", "again");
  assert.deepEqual(h.cwdSets, [{ agent: "w-moved", path: join(h.root, "strategies", "fx") }]);
  assert.deepEqual(h.order, [`set ${join(h.root, "strategies", "fx")}`, "steer"]);

  /* a folder that is still there is left alone */
  h.seed("w-here", [brief("w-here", "Here", AT - 60_000), start(1), said(1, "done"), end(1)], { cwd: join(h.root, "strategies", "fx") });
  await tasks.ops.steer("w-here", "again");
  assert.equal(h.cwdSets.length, 1);
  await h.tree.clock.advance(50);
  assert.equal((await tasks.ops.read("w-here")).text, "(pass)");
});

test("routerEnabled is false only for FACE_ROUTER=0", () => {
  assert.equal(routerEnabled({}), true);
  assert.equal(routerEnabled({ FACE_ROUTER: "1" }), true);
  assert.equal(routerEnabled({ FACE_ROUTER: "" }), true);
  assert.equal(routerEnabled({ FACE_ROUTER: "0" }), false);
});
