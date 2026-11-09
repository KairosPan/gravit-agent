// face/tests/tasks.test.ts
/** The tasks installed (src/tasks.ts, one entry plan 1 task 7): the operations over the conversation's workers,
 * `GET /data/tasks`, relays on the bus, boot recovery, stalls and idle disposal. Offline, on the room fakes
 * (tests/room-fake.ts) with a fake clock; the conversation is a fake handle over a fake agent, so no conversation's
 * folder is made and the repository root is a scratch directory under tests/tmp/<pid>. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TaskView } from "../src/task-view.ts";
import { phoneConversation, routerEnabled, installRouter, installTasks, RECOVERY_NOTE, CONTINUE_NOTE, IDLE_DISPOSE_MS, type TasksDeps, type TasksHandle } from "../src/tasks.ts";
import type { ConversationHandle, TaskOrigin } from "../src/conversation.ts";
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
  origin: TaskOrigin = { kind: "web" };
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
      turnOrigin: () => this.origin,
      post: async () => ({ refused: "error", line: "no phone here" }),
      stop: async () => false, carry: async () => {}, note: () => {},
      dispose: async () => {},
    };
    const handle = (agent: FakeAgent) => ({
      agent,
      /* as dsh's dispose: a turn under way ends aborted, its cause disposed */
      dispose: async () => {
        this.disposed.push(agent.id);
        if (agent.status === "running") {
          tree.emit(agent.session, { type: "turn/end", seq: agent.session.seq, data: { turn: agent.turn, reason: { kind: "aborted", reason: { kind: "disposed" } } } } as EventLike);
          agent.status = "idle";
        }
        tree.agents.delete(agent.id);
      },
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
  seed(id: string, events: Ev[], opts: { cwd?: string; parentSession?: string; origin?: string; live?: boolean; running?: boolean; agentPreset?: string } = {}): FakeSession {
    const header = {
      id,
      cwd: opts.cwd ?? this.root,
      parentSession: opts.parentSession ?? CONV,
      agentPreset: opts.agentPreset ?? "gravit",
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
type Rec = {
  register(route: { path: string; handler: Handler }): void;
  paths(): string[];
  get(path: string, host?: string): Promise<{ status: number; body: Record<string, unknown> }>;
  post(path: string, body: unknown, host?: string, method?: string): Promise<{ status: number; body: Record<string, unknown> }>;
};
function recorder(): Rec {
  const routes = new Map<string, Handler>();
  const call = async (path: string, method: string, host: string, payload: string | undefined): Promise<{ status: number; body: Record<string, unknown> }> => {
    const handler = routes.get(path);
    assert.ok(handler, `a route at ${path}`);
    let status = 0;
    let body = "";
    const res = { writeHead(s: number) { status = s; return res; }, end(b: string) { body = b; } } as unknown as ServerResponse;
    const req = Object.assign(Readable.from(payload === undefined ? [] : [Buffer.from(payload)]), {
      method, url: path, headers: { host, ...(payload === undefined ? {} : { "content-type": "application/json" }) },
    }) as unknown as IncomingMessage;
    await handler(req, res);
    return { status, body: JSON.parse(body) as Record<string, unknown> };
  };
  return {
    register(route) { routes.set(route.path, route.handler); },
    paths: () => [...routes.keys()],
    get: (path, host = "127.0.0.1:3090") => call(path, "GET", host, undefined),
    post: (path, body, host = "127.0.0.1:3090", method = "POST") => call(path, method, host, JSON.stringify(body)),
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

  assert.deepEqual(rec.paths(), ["/data/tasks", "/data/tasks/stop", "/data/tasks/continue"]);
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
  /* waiting for the operator: the parked gate died with the process, so it is recovered too */
  h.seed("w-wait", [brief("w-wait", "Waiting", AT - 60_000), start(1, AT - 60_000), { type: "approval/asked", data: { id: "ap", toolName: "x", reason: "y" } }]);
  /* a turn a hook cut (a deadline): not the restart's */
  h.seed("w-hook", [brief("w-hook", "Hooked", AT - 60_000), start(1, AT - 60_000), { type: "turn/end", data: { turn: 1, reason: { kind: "aborted", reason: { kind: "hook", reason: "deadline" } } } }]);
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
  assert.deepEqual(notes("w-wait"), ["task-recovery:w-wait:1"]);
  assert.deepEqual(notes("w-hook"), []);
  assert.deepEqual(notes("w-done"), []);
  const note = h.tree.sessions.get("w-open")!.snapshotEvents().find((e) => e.type === "user/message" && (e.data as MessageLike).id === "task-recovery:w-open:1")!;
  assert.deepEqual((note.data as { content: unknown }).content, [{ type: "text", text: RECOVERY_NOTE }]);
  assert.equal(RECOVERY_NOTE, "The face restarted while you worked. Check what you already did - files, the Account, your last tool results - before repeating anything outside, then carry on.");
  assert.deepEqual((note.data as { source: unknown }).source, { kind: "task", form: "recovery", conversation: CONV, task: "w-open" });
  assert.deepEqual(h.tree.resumed.map((r) => (r as { resumeSessionId: string }).resumeSessionId).sort(), ["w-int", "w-open", "w-queued", "w-wait"], "the queued one is resumed, so dsh runs what its inbox holds");

  /* the recovered turns run to their end; then the face restarts */
  await h.tree.clock.advance(100);
  await first.dispose();
  for (const id of ["w-open", "w-int", "w-wait"]) h.tree.agents.delete(id);
  const second = await install(h);
  assert.deepEqual(notes("w-open"), ["task-recovery:w-open:1"]);
  assert.deepEqual(notes("w-wait"), ["task-recovery:w-wait:1"]);
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
  const log = worker.session.snapshotEvents();
  const marker = log.filter((e) => e.type === "user/message").at(-1)!;
  assert.ok(log.indexOf(marker) > log.findIndex((e) => e.type === "turn/end"), "the marker comes after the turn's end");
  assert.ok(log.some((e) => e.type === "turn/end"));
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
  /* the task's result - its last turn's words, here the steer's turn's - is what task_read says */
  const here = await tasks.ops.read("w-here");
  assert.ok(here.text.endsWith("(pass)"), here.text);
  assert.equal(here.text, here.view.result?.text);
});

test("a running worker the face disposes at shutdown gets one recovery note on the next boot", async () => {
  const h = await harness();
  h.tree.script("gravit", () => ({ kind: "hang" }));
  const first = await install(h);
  const view = await first.ops.start({ title: "Cut", brief: "work" });
  assert.equal(h.tree.agents.get(view.id)!.status, "running");
  await first.dispose();
  assert.deepEqual(h.disposed, [view.id]);
  const ended = h.tree.sessions.get(view.id)!.snapshotEvents().filter((e) => e.type === "turn/end");
  assert.deepEqual(ended.map((e) => (e.data as { reason: unknown }).reason), [{ kind: "aborted", reason: { kind: "disposed" } }]);
  const second = await install(h);
  const notes = h.ids(view.id).filter((m) => m.startsWith("task-recovery:"));
  assert.deepEqual(notes, [`task-recovery:${view.id}:1`]);
  await second.dispose();
});

test("installRouter: a conversation that cannot be opened is one line, is disposed, and the face goes on without it", async () => {
  const made: string[] = [];
  const handle = (ensure: () => Promise<{ agent: AgentLike; sessionId: string }>): ConversationHandle => ({
    ensure, current: () => undefined, operatorTurn: () => false, turnOrigin: () => ({ kind: "web" }),
    post: async () => ({ refused: "error", line: "no phone here" }), stop: async () => false, carry: async () => {}, note: () => {}, dispose: async () => { made.push("disposed"); },
  });
  const lines: string[] = [];
  const failed = await installRouter({
    conversation: () => handle(async () => { throw new Error("the ledger cannot be read"); }),
    tasks: () => { made.push("tasks"); return {} as TasksHandle; },
    log: (line) => { lines.push(line); },
  });
  assert.deepEqual(failed, {});
  assert.deepEqual(made, ["disposed"], "no tasks over a conversation that is not there");
  assert.deepEqual(lines, ["gravit-face: conversation: could not be installed (the ledger cannot be read); the face starts without the conversation and its tasks"]);

  made.length = 0;
  const noTasks = await installRouter({
    conversation: () => handle(async () => ({ agent: {} as AgentLike, sessionId: "session-c" })),
    tasks: () => { throw new Error("route taken"); },
    log: () => {},
  });
  assert.deepEqual(noTasks, {});
  assert.deepEqual(made, ["disposed"]);

  const thrown = await installRouter({ conversation: () => { throw new Error("bad"); }, tasks: () => ({} as TasksHandle), log: () => {} });
  assert.deepEqual(thrown, {});

  const tasks = { ops: {}, ready: Promise.resolve(), dispose: async () => {} } as unknown as TasksHandle;
  const conv = handle(async () => ({ agent: {} as AgentLike, sessionId: "session-c" }));
  const ok = await installRouter({ conversation: () => conv, tasks: () => tasks, log: () => {} });
  assert.deepEqual(ok, { conversation: conv, tasks, sessionId: "session-c" });
});

test("phoneConversation posts and stops through the conversation and counts its tasks running and waiting", async () => {
  const calls: string[] = [];
  const conv = {
    ensure: async () => ({ agent: {} as AgentLike, sessionId: "session-c" }), current: () => ({ agent: {} as AgentLike, sessionId: "session-c" }),
    operatorTurn: () => false, turnOrigin: () => ({ kind: "web" as const }),
    post: async () => { calls.push("post"); return { opened: true as const, sessionId: "session-c" }; },
    stop: async (reason: string) => { calls.push(`stop ${reason}`); return true; },
    carry: async () => { calls.push("carry"); },
    note: (line) => { calls.push(`note ${line.kind}`); },
    dispose: async () => {},
  } satisfies ConversationHandle;
  const views = ["running", "stalled", "waiting", "done", "waiting", "failed"].map((state) => ({ state })) as unknown as TaskView[];
  const phone = phoneConversation(conv, { list: async () => views });
  assert.deepEqual(await phone.status(), { sessionId: "session-c", running: 2, waiting: 2 });
  assert.equal(await phone.stop("stopped from the phone"), true);
  await phone.post({ text: "t", key: "k", source: { kind: "telegram" }, message: { kind: "telegram", network: "telegram", messageId: "telegram:1" } });
  phone.note({ kind: "schedule", order: "brief", firing: "brief@2026-11-09", date: "2026-11-09", text: "the brief" });
  assert.deepEqual(calls, ["stop stopped from the phone", "post", "note schedule"]);
});

test("routerEnabled is false only for FACE_ROUTER=0", () => {
  assert.equal(routerEnabled({}), true);
  assert.equal(routerEnabled({ FACE_ROUTER: "1" }), true);
  assert.equal(routerEnabled({ FACE_ROUTER: "" }), true);
  assert.equal(routerEnabled({ FACE_ROUTER: "0" }), false);
});

/* ---------- final review fixes ---------- */

test("task_read's text is the task's report when it has one, over its closing words; the closing words when it has none", async (t) => {
  const h = await harness();
  h.seed("w-rep", [brief("w-rep", "Rep", AT - 60_000), start(1), ...report(1, "c1", "ready", "the report itself"), said(1, "closing words"), end(1)]);
  h.seed("w-bare", [brief("w-bare", "Bare", AT - 60_000), start(1), said(1, "only closing words"), end(1)]);
  const tasks = await install(h);
  t.after(() => tasks.dispose());
  const rep = await tasks.ops.read("w-rep");
  assert.equal(rep.view.result?.text, "the report itself");
  assert.equal(rep.text, "the report itself");
  assert.equal((await tasks.ops.read("w-bare")).text, "only closing words");
});

test("installRouter checks the conversation's fence once: a violation is one loud line naming it, and the face still starts", async () => {
  const handle = (): ConversationHandle => ({
    ensure: async () => ({ agent: {} as AgentLike, sessionId: "session-c" }), current: () => undefined, operatorTurn: () => false,
    turnOrigin: () => ({ kind: "web" }), post: async () => ({ refused: "error", line: "no phone here" }), stop: async () => false, carry: async () => {}, note: () => {}, dispose: async () => {},
  });
  const tasks = { ops: {}, ready: Promise.resolve(), dispose: async () => {} } as unknown as TasksHandle;
  const lines: string[] = [];
  const conv = handle();
  const ok = await installRouter({ conversation: () => conv, tasks: () => tasks, fence: async () => "/Users/op", log: (line) => { lines.push(line); } });
  assert.deepEqual(ok, { conversation: conv, tasks, sessionId: "session-c" }, "the face still starts with it");
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.match(lines[0]!, /^gravit-face: conversation: .*REFUSE.*\/Users\/op/);
  lines.length = 0;
  await installRouter({ conversation: handle, tasks: () => tasks, fence: async () => undefined, log: (line) => { lines.push(line); } });
  assert.equal(lines.length, 0, "a clean folder says nothing");
  await installRouter({ conversation: handle, tasks: () => tasks, fence: async (): Promise<string | undefined> => { throw new Error("EACCES"); }, log: (line) => { lines.push(line); } });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /EACCES/);
});

test("POST /data/tasks/stop calls ops.stop once and answers {ok, task}", async (t) => {
  const h = await harness();
  const rec = recorder();
  const tasks = await install(h, rec);
  t.after(() => tasks.dispose());
  h.tree.script("gravit", () => ({ kind: "hang" }));
  const started = await tasks.ops.start({ title: "Long", brief: "work" });
  const calls: string[] = [];
  const real = tasks.ops.stop.bind(tasks.ops);
  tasks.ops.stop = async (id) => { calls.push(id); return real(id); };
  const pending = rec.post("/data/tasks/stop", { task: started.id });
  await h.tree.clock.advance(10);
  const got = await pending;
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, true);
  assert.deepEqual(calls, [started.id]);
  assert.equal((got.body.task as { id: string }).id, started.id);
  assert.equal((got.body.task as { state: string }).state, "stopped");
});

test("Stop on a task that already ended is 409 and leaves it alone: no cancel, no stopped marker, its result kept", async (t) => {
  const h = await harness();
  h.seed("w-ended", [brief("w-ended", "Ended", AT - 60_000), start(1), said(1, "the answer"), end(1)]);
  const rec = recorder();
  const tasks = await install(h, rec);
  t.after(() => tasks.dispose());
  const before = await tasks.ops.read("w-ended");
  assert.equal(before.view.state, "done");
  const got = await rec.post("/data/tasks/stop", { task: "w-ended" });
  assert.deepEqual([got.status, got.body], [409, { ok: false, error: "task already ended" }]);
  assert.equal(h.ids("w-ended").filter((m) => m.startsWith("task-stopped:")).length, 0, "the log gains no stopped marker");
  const after = await tasks.ops.read("w-ended");
  assert.equal(after.view.state, "done");
  assert.deepEqual(after.view.result, before.view.result);
  await assert.rejects(h.tool("task_stop").execute({ task: "w-ended" }), /^Error: task w-ended already ended \(done\); there is nothing to stop$/);
});

test("POST /data/tasks/continue sends CONTINUE_NOTE through ops.steer", async (t) => {
  const h = await harness();
  h.seed("w-done", [brief("w-done", "Done", AT - 60_000), start(1), said(1, "done"), end(1)]);
  const rec = recorder();
  const tasks = await install(h, rec);
  t.after(() => tasks.dispose());
  assert.equal(CONTINUE_NOTE, "Continue the task. First check what you already did \u2014 files written, orders proposed, messages sent \u2014 and do not repeat any of it.");
  const calls: [string, string][] = [];
  const real = tasks.ops.steer.bind(tasks.ops);
  tasks.ops.steer = async (id, text) => { calls.push([id, text]); return real(id, text); };
  const pending = rec.post("/data/tasks/continue", { task: "w-done" });
  await h.tree.clock.advance(50);
  const got = await pending;
  assert.equal(got.status, 200);
  assert.deepEqual(calls, [["w-done", CONTINUE_NOTE]]);
  assert.equal((got.body.task as { id: string }).id, "w-done");
});

test("the Stop and Continue routes: an unknown task is 404, a bad body 400, GET 405, an untrusted request 403", async (t) => {
  const h = await harness();
  const rec = recorder();
  const tasks = await install(h, rec);
  t.after(() => tasks.dispose());
  for (const path of ["/data/tasks/stop", "/data/tasks/continue"]) {
    const missing = await rec.post(path, { task: "x" });
    assert.deepEqual([missing.status, missing.body], [404, { ok: false, error: "no such task" }]);
    for (const bad of [{}, { task: 3 }, { task: "" }, { task: "x".repeat(201) }]) {
      const got = await rec.post(path, bad);
      assert.deepEqual([got.status, got.body.error], [400, "task is required"]);
    }
    assert.equal((await rec.post(path, { task: "x" }, "127.0.0.1:3090", "GET")).status, 405);
    assert.equal((await rec.post(path, { task: "x" }, "evil.example")).status, 403);
  }
});

test("task_start in a phone turn starts a phone task", async (t) => {
  const h = await harness();
  const tasks = await install(h);
  t.after(() => tasks.dispose());
  h.origin = { kind: "phone", network: "slack" };
  const out = await h.tool("task_start").execute({ title: "From the phone", brief: "look" }) as { task: string };
  const brief = h.tree.sessions.get(out.task)!.snapshotEvents().find((e) => e.type === "user/message" && (e.data as MessageLike).id === `task-brief:${out.task}`)!;
  assert.deepEqual((brief.data as { source: unknown }).source, { kind: "task", form: "brief", conversation: CONV, origin: "phone", network: "slack" });
  const { view } = await tasks.ops.read(out.task);
  assert.equal(view.origin, "phone");
  assert.equal(view.network, "slack");
  h.origin = { kind: "web" };
  const web = await h.tool("task_start").execute({ title: "From the browser", brief: "look" }) as { task: string };
  assert.equal((await tasks.ops.read(web.task)).view.origin, "web");
});

test("GET /data/tasks carries desk when a provider is given and omits it otherwise", async (t) => {
  const h = await harness();
  const none = recorder();
  const a = await install(h, none);
  t.after(() => a.dispose());
  assert.equal(Object.hasOwn((await none.get("/data/tasks")).body, "desk"), false);

  const h2 = await harness();
  const desk = { scheduled: [{ order: "preclose", enabled: true, expired: false }], lines: [] };
  const rec = recorder();
  const b = installTasks(rec, { ...h2.deps(), deskLines: async () => desk });
  await b.ready;
  t.after(() => b.dispose());
  assert.deepEqual((await rec.get("/data/tasks")).body.desk, desk);
});

test("a provider that throws leaves desk out and the route answers", async (t) => {
  const h = await harness();
  const rec = recorder();
  const tasks = installTasks(rec, { ...h.deps(), deskLines: async () => { throw new Error("ledger gone"); } });
  await tasks.ready;
  t.after(() => tasks.dispose());
  const got = await rec.get("/data/tasks");
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, true);
  assert.equal(Object.hasOwn(got.body, "desk"), false);
  await rec.get("/data/tasks");
  assert.equal(h.lines.filter((l) => l.includes("ledger gone")).length, 1, "logged once");
});

/* ---------- bot tasks (one-entry plan 4 task 3) ---------- */

test("a bot worker is resumed on its own preset", async () => {
  const h = await harness();
  const home = join(h.root, "bots", "drill-bull", "journal");
  await mkdir(home, { recursive: true });
  /* a bot task whose turn the restart cut, and a gravit one beside it */
  h.seed("w-bot", [brief("w-bot", "Bull case", AT - 60_000), start(1, AT - 60_000)], { cwd: home, agentPreset: "drill-bull" });
  h.seed("w-plain", [brief("w-plain", "Plain", AT - 60_000), start(1, AT - 60_000)]);
  const tasks = await install(h);
  const mounted = (id: string) => h.tree.mounts.filter((m) => m.agent === id).map((m) => m.preset);
  assert.deepEqual(mounted("w-bot"), ["drill-bull"], "the recovery's resume mounts the bot's preset, not gravit");
  assert.deepEqual(mounted("w-plain"), ["gravit"]);
  /* a later steer of a disposed bot worker resumes it on its preset too */
  await h.tree.clock.advance(100);
  await tasks.dispose();
  h.tree.agents.delete("w-bot");
  const again = await install(h);
  await again.ops.steer("w-bot", "and the bear case");
  assert.deepEqual(mounted("w-bot"), ["drill-bull", "drill-bull"]);
  await again.dispose();
});

test("GET /data/tasks shows a bot task's bot", async (t) => {
  const h = await harness();
  const home = join(h.root, "bots", "drill-bull", "journal");
  await mkdir(home, { recursive: true });
  h.seed("w-bot", [brief("w-bot", "Bull case", AT - 600_000), start(1, AT - 600_000), said(1, "bullish", AT - 600_000), end(1, "completed", AT - 600_000)], { cwd: home, agentPreset: "drill-bull" });
  h.seed("w-plain", [brief("w-plain", "Plain", AT - 700_000), start(1, AT - 700_000), said(1, "ok", AT - 700_000), end(1, "completed", AT - 700_000)], { cwd: join(h.root, "strategies", "fx") });
  const web = recorder();
  const tasks = await install(h, web);
  t.after(() => tasks.dispose());
  const got = await web.get("/data/tasks");
  const listed = got.body.tasks as TaskView[];
  assert.deepEqual(listed.map((v) => ({ id: v.id, bot: v.bot, strategy: v.strategy })), [
    { id: "w-bot", bot: "drill-bull", strategy: undefined },
    { id: "w-plain", bot: undefined, strategy: "fx" },
  ]);
});

test("task_start with bot starts a worker on the bot's preset in its home, through TasksDeps.bots", async (t) => {
  const h = await harness();
  const home = join(h.root, "bots", "drill-bull", "journal");
  await mkdir(home, { recursive: true });
  const tasks = installTasks(recorder(), {
    ...h.deps(),
    bots: async () => ({ available: ["drill-bull"], rows: [{ id: "drill-bull", homeCwd: home, listed: true }] }),
  });
  await tasks.ready;
  t.after(() => tasks.dispose());
  const out = await h.tool("task_start").execute({ title: "Bull case", brief: "argue it", bot: "drill-bull" }) as { task: string; bot?: string };
  assert.equal(out.bot, "drill-bull");
  const created = h.tree.agentsCreated.find((c) => (c as { sessionId: string }).sessionId === out.task) as { meta: { cwd: string; agentPreset: string } };
  assert.deepEqual({ cwd: created.meta.cwd, agentPreset: created.meta.agentPreset }, { cwd: home, agentPreset: "drill-bull" });
  assert.deepEqual(h.tree.mounts.filter((m) => m.agent === out.task).map((m) => m.preset), ["drill-bull"]);
  await assert.rejects(h.tool("task_start").execute({ title: "Bear case", brief: "argue it", bot: "drill-bear" }), /^Error: no bot available named drill-bear; available: drill-bull$|no bot available named drill-bear; available: drill-bull/);
});
