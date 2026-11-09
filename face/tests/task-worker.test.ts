// face/tests/task-worker.test.ts
/** Task workers (src/task-worker.ts): a root session on gravit per task, its folder and its brief. Offline. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSupportedJsonSchema } from "@deepseek-ai/dsh-tools";
import { DEFAULT_PRESET } from "../src/overlay.ts";
import {
  TASK_BRIEF_MAX, TASK_FOOTER, TASK_TITLE_MAX, TaskInputError, briefText, equipWorkers, isStrategyName, startWorker,
  rosterBots, strategyDir, taskReportTool, type WorkerAgentLike, type WorkerCtxLike, type WorkerToolsCtxLike,
} from "../src/task-worker.ts";
import type { CreateDeskAgentOptions } from "../src/desk-session.ts";
import { taskViewOf } from "../src/task-view.ts";
import type { DeskToolDefinition } from "../src/desk-tools.ts";
import type { AgentCtxLike, AgentLike, ModelSelectionRefLike, SessionLike } from "../src/room.ts";
import type { MessageLike } from "../src/room-rules.ts";

const TMP = join(dirname(fileURLToPath(import.meta.url)), "tmp", String(process.pid));
let made = 0;
after(() => rm(TMP, { recursive: true, force: true }));

/** A repository root with strategies/ holding the named directories, a symlink `link` and a file `afile`. */
async function repo(dirs: string[]): Promise<string> {
  const root = join(TMP, `${++made}-repo`);
  await mkdir(join(root, "strategies"), { recursive: true });
  for (const d of dirs) await mkdir(join(root, "strategies", d), { recursive: true });
  await symlink(join(root, "strategies", dirs[0] ?? "."), join(root, "strategies", "link"));
  await writeFile(join(root, "strategies", "afile"), "x\n");
  return root;
}

class Fake {
  readonly created: CreateDeskAgentOptions[] = [];
  readonly mounts: string[] = [];
  readonly selections: ModelSelectionRefLike[] = [];
  readonly renames: { session: unknown; title: string }[] = [];
  readonly followups: MessageLike[] = [];
  flushes = 0;
  disposed = 0;
  titles = true;
  readonly ctx: WorkerCtxLike = {
    agents: {
      get: () => undefined,
      create: async (options) => {
        this.created.push(options);
        const session: SessionLike = { id: options.sessionId, header: { cwd: options.meta.cwd, agentPreset: options.meta.agentPreset }, seq: 0, snapshotEvents: () => [], append: () => undefined };
        const agent: AgentLike = { id: options.sessionId, status: "idle", session, followup: (m) => { this.followups.push(m); }, cancel: () => {} };
        await options.setup({}, agent);
        return { agent, dispose: async () => { this.disposed++; } };
      },
      resume: async () => { throw new Error("no resume"); },
    },
    agentPresets: { mount: async (_c: AgentCtxLike, id: string) => { this.mounts.push(id); } },
    permissionPresets: { set: () => { throw new Error("a worker pins no permission"); }, current: () => "x" },
    sessionPersistence: { open: async () => { throw new Error("no"); }, flush: async () => { this.flushes++; } },
    get: (_name: "sessionTitle") => (this.titles ? { rename: (session: unknown, title: string) => { this.renames.push({ session, title }); } } : undefined),
  } as WorkerCtxLike;
  deps(root: string) {
    return {
      ctx: this.ctx, root, route: { provider: "p", model: "m" },
      installModelSelection: (_c: AgentCtxLike, ref: ModelSelectionRefLike) => { this.selections.push(ref); return () => {}; },
      log: () => {},
    };
  }
}

const input = { conversationId: "session-conv", title: "Read the tape", brief: "Look at the tape.", origin: "web" as const };

test("a worker is a root session on gravit, in the strategy's directory, naming the conversation as parentSession", async () => {
  const root = await repo(["alpha"]);
  const f = new Fake();
  const w = await startWorker(f.deps(root), { ...input, strategy: "alpha" });
  assert.equal(f.created.length, 1);
  const c = f.created[0]!;
  assert.match(c.sessionId, /^session-/);
  assert.equal(w.sessionId, c.sessionId);
  assert.deepEqual(c.meta, { cwd: join(root, "strategies", "alpha"), parentSession: "session-conv", agentPreset: DEFAULT_PRESET });
  assert.ok(!("parentAgent" in c) && !("parentAgent" in c.meta));
  assert.deepEqual(c.agentOptions, { provider: "p", model: "m" });
  assert.deepEqual(f.mounts, [DEFAULT_PRESET]);
  assert.deepEqual(f.selections[0]?.current, { provider: "p", model: "m" });
  await w.dispose();
  assert.equal(f.disposed, 1);
});

test("with no strategy, a worker runs at the repository root", async () => {
  const root = await repo(["alpha"]);
  const f = new Fake();
  await startWorker(f.deps(root), input);
  assert.equal(f.created[0]!.meta.cwd, root);
});

test("names that are not a plain strategy directory are refused before any session exists", async () => {
  const root = await repo(["alpha", "_template", "市场情绪"]);
  await mkdir(join(root, "strategies", ".git"));
  await mkdir(join(root, "strategies", "a b"));
  for (const bad of ["../x", "_template", ".git", "a b", "link", "afile", "missing", "", ".", "..", "a/b", "a\\b", "a\u0007b", "x".repeat(65)]) {
    const f = new Fake();
    await assert.rejects(startWorker(f.deps(root), { ...input, strategy: bad }), TaskInputError, bad);
    assert.equal(f.created.length, 0, bad);
  }
  assert.equal(isStrategyName("市场情绪"), true);
  assert.equal(await strategyDir(root, "市场情绪"), join(root, "strategies", "市场情绪"));
  const f = new Fake();
  await startWorker(f.deps(root), { ...input, strategy: "市场情绪" });
  assert.equal(f.created[0]!.meta.cwd, join(root, "strategies", "市场情绪"));
  await assert.rejects(strategyDir(root, "missing"), /no strategy named missing/);
});

test("the title is the session's title, and the brief is one followup with id task-brief:<id>, source task/brief, ending with TASK_FOOTER", async () => {
  const root = await repo(["alpha"]);
  const f = new Fake();
  const w = await startWorker(f.deps(root), { ...input, title: "  Read the tape  " });
  assert.deepEqual(f.renames.map((r) => r.title), ["Read the tape"]);
  assert.equal(f.followups.length, 1);
  const m = f.followups[0] as unknown as { id: string; role: string; content: { type: string; text: string }[]; source: unknown };
  assert.equal(m.id, `task-brief:${w.sessionId}`);
  assert.equal(m.role, "user");
  assert.deepEqual(m.source, { kind: "task", form: "brief", conversation: "session-conv", origin: "web" });
  assert.equal(m.content[0]!.text, briefText("Read the tape", input.brief));
  assert.ok(m.content[0]!.text.endsWith(TASK_FOOTER));
  assert.equal(f.flushes, 1);
  // no sessionTitle service: one line, no failure
  const g = new Fake();
  g.titles = false;
  const lines: string[] = [];
  await startWorker({ ...g.deps(root), log: (l: string) => lines.push(l) }, input);
  assert.equal(g.followups.length, 1);
  assert.equal(lines.length, 1);
});

test("a title over 80 characters or with a newline, and a brief empty or over 4,000 characters, are refused before any session exists", async () => {
  const root = await repo(["alpha"]);
  const bad = [
    { title: "x".repeat(TASK_TITLE_MAX + 1) }, { title: "a\nb" }, { title: "   " }, { title: "" },
    { brief: "" }, { brief: "y".repeat(TASK_BRIEF_MAX + 1) },
  ];
  for (const b of bad) {
    const f = new Fake();
    await assert.rejects(startWorker(f.deps(root), { ...input, ...b }), TaskInputError, JSON.stringify(b).slice(0, 40));
    assert.equal(f.created.length, 0);
  }
  const f = new Fake();
  await startWorker(f.deps(root), { ...input, title: "x".repeat(TASK_TITLE_MAX), brief: "y".repeat(TASK_BRIEF_MAX) });
  assert.equal(f.created.length, 1);
});

/** A root context with `agent/created` and the live agents `live`; `create` plays one agent's creation through every
 * listener and hands back what each answered. */
function fakeRoot(live: WorkerAgentLike[] = []) {
  const listeners: ((event: { agent: WorkerAgentLike }) => undefined)[] = [];
  const ctx: WorkerToolsCtxLike = {
    on(name, listener) {
      assert.equal(name, "agent/created");
      listeners.push(listener);
      return () => { listeners.splice(listeners.indexOf(listener), 1); };
    },
    agents: { list: () => live },
  };
  return { ctx, listeners, create: (agent: WorkerAgentLike) => listeners.map((l) => l({ agent })) };
}

function fakeWorkerAgent(id: string, header: { parentSession?: string; origin?: string; agentPreset?: string }) {
  const registered: DeskToolDefinition[] = [];
  const agent: WorkerAgentLike = { id, session: { header }, ctx: { tools: { register: (d: DeskToolDefinition) => { registered.push(d); return () => {}; } } } };
  return { agent, names: () => registered.map((d) => d.name) };
}

test("task_report is on a worker's own layer and on no other agent's", () => {
  const isWorker = (h: { parentSession?: string; origin?: string }) => h.parentSession === "session-conv" && h.origin === undefined;
  const early = fakeWorkerAgent("w-early", { parentSession: "session-conv", agentPreset: DEFAULT_PRESET });
  const root = fakeRoot([early.agent]);
  const dispose = equipWorkers(root.ctx, isWorker, { log: () => {} });
  assert.equal(root.listeners.length, 1);
  assert.deepEqual(early.names(), ["task_report"], "an agent already live is swept");

  const worker = fakeWorkerAgent("w-1", { parentSession: "session-conv", agentPreset: DEFAULT_PRESET });
  assert.deepEqual(root.create(worker.agent), [undefined]);
  root.create(worker.agent);
  root.create(early.agent);
  assert.deepEqual(worker.names(), ["task_report"], "once");
  assert.deepEqual(early.names(), ["task_report"], "once, by the sweep or the listener");

  const conversation = fakeWorkerAgent("conv", { agentPreset: "gravit-router" });
  const member = fakeWorkerAgent("member", { parentSession: "session-room", agentPreset: "drill-bull" });
  const fork = fakeWorkerAgent("fork", { parentSession: "session-conv", origin: "fork" });
  for (const other of [conversation, member, fork]) {
    root.create(other.agent);
    assert.deepEqual(other.names(), [], other.agent.id);
  }

  // a registration that throws is one line, never a throw in the dispatch
  const lines: string[] = [];
  const bad: WorkerAgentLike = { id: "bad", session: { header: { parentSession: "session-conv" } }, ctx: { tools: { register: () => { throw new Error("dup"); } } } };
  const r2 = fakeRoot();
  equipWorkers(r2.ctx, isWorker, { log: (l) => lines.push(l) });
  assert.deepEqual(r2.create(bad), [undefined]);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^gravit-face: /);

  dispose();
  assert.equal(root.listeners.length, 0);
});

test("task_report's output schema is one dsh's tool layer registers (task 8's real boot)", () => {
  /* dsh-tools ToolRuntime.register runs this on every output schema: a `const` without a `type` is refused */
  assert.doesNotThrow(() => assertSupportedJsonSchema(taskReportTool().output.schema));
});

test("task_report refuses an unknown status, an empty text and a text over 600 characters", async () => {
  const tool = taskReportTool();
  assert.equal(tool.name, "task_report");
  assert.equal(tool.timeoutMs, 10_000);
  assert.deepEqual(tool.parameters, {
    type: "object",
    properties: {
      status: { type: "string", enum: ["progress", "ready", "blocked", "failed"] },
      text: { type: "string", minLength: 1, maxLength: 600 },
    },
    required: ["status", "text"],
    additionalProperties: false,
  });
  const exec = { signal: new AbortController().signal };
  for (const status of ["progress", "ready", "blocked", "failed"]) {
    assert.deepEqual(await tool.execute({ status, text: "a line" }, exec), { kind: "reported", status });
  }
  assert.deepEqual(await tool.execute({ status: "ready", text: "市".repeat(600) }, exec), { kind: "reported", status: "ready" });
  for (const bad of [
    { status: "done", text: "x" }, { status: "ready", text: "" }, { status: "ready", text: "   " },
    { status: "ready", text: "x".repeat(601) }, { status: "ready" }, { text: "x" }, null, "ready",
    { status: "ready", text: "x", extra: 1 },
  ]) {
    await assert.rejects(Promise.resolve().then(() => tool.execute(bad, exec)), Error, JSON.stringify(bad));
  }
  assert.deepEqual(tool.output.render({ status: "ready", text: "x" }, { kind: "reported", status: "ready" }), [{ type: "text", text: "reported ready" }]);
  assert.equal(tool.presentCall({ status: "blocked", text: "x" }).kind, "read");
});

test("a phone-started task's brief carries origin phone and its network, and its view reads them", async () => {
  const root = await repo(["alpha"]);
  const f = new Fake();
  const w = await startWorker(f.deps(root), { ...input, origin: "phone", network: "slack" });
  const m = f.followups[0] as unknown as { source: unknown };
  assert.deepEqual(m.source, { kind: "task", form: "brief", conversation: "session-conv", origin: "phone", network: "slack" });
  const v = taskViewOf({
    id: w.sessionId, header: { cwd: root, createdAt: 1 }, root, now: 2,
    events: [{ type: "user/message", seq: 1, data: f.followups[0] }],
  });
  assert.equal(v.origin, "phone");
  assert.equal(v.network, "slack");
});

/* ---------- bot tasks (one-entry plan 4 task 3) ---------- */

/** The bots a test's deps offer: `drill-bull` and `drill-bear` usable, `quiet` unlisted, `cracked` broken, `off-bot`
 * usable but off the roster; every home under `root`. */
async function botsOf(root: string) {
  const row = async (id: string, extra: { listed?: boolean; broken?: string } = {}) => {
    const homeCwd = join(root, "bots", id, "journal");
    await mkdir(homeCwd, { recursive: true });
    return { id, homeCwd, listed: extra.listed ?? true, ...(extra.broken === undefined ? {} : { broken: extra.broken }) };
  };
  const rows = [
    await row("drill-bull"), await row("drill-bear"), await row("quiet", { listed: false }),
    await row("cracked", { broken: "bad yaml" }), await row("off-bot"), await row("gravit"),
  ];
  return async () => ({ available: ["drill-bull", "drill-bear", "quiet", "cracked", "gravit"], rows });
}

test("a bot task starts on the bot's preset in its home folder", async () => {
  const root = await repo(["alpha"]);
  const f = new Fake();
  const w = await startWorker({ ...f.deps(root), bots: await botsOf(root) }, { ...input, bot: "drill-bull" });
  assert.equal(f.created.length, 1);
  const c = f.created[0]!;
  assert.equal(w.sessionId, c.sessionId);
  assert.deepEqual(c.meta, { cwd: join(root, "bots", "drill-bull", "journal"), parentSession: "session-conv", agentPreset: "drill-bull" });
  assert.deepEqual(f.mounts, ["drill-bull"], "the setup mounts the bot's preset");
  assert.deepEqual(f.selections[0]?.current, { provider: "p", model: "m" });
  assert.equal(f.followups.length, 1, "the brief is sent as for any task");
});

test("startWorker refuses a bad bot before any session exists", async () => {
  const root = await repo(["alpha"]);
  const bots = await botsOf(root);
  const cases: { bot: string; strategy?: string; message: string | RegExp; bots?: typeof bots }[] = [
    { bot: "drill-bull", strategy: "alpha", message: "a task is a bot or a strategy, not both" },
    { bot: "gravit", message: "no bot available named gravit; available: drill-bull, drill-bear" },
    { bot: "role-cn-reviewer", message: "no bot available named role-cn-reviewer; available: drill-bull, drill-bear" },
    { bot: "gravit-desk", message: "no bot available named gravit-desk; available: drill-bull, drill-bear" },
    { bot: "off-bot", message: "no bot available named off-bot; available: drill-bull, drill-bear" },
    { bot: "quiet", message: "no bot available named quiet; available: drill-bull, drill-bear" },
    { bot: "cracked", message: "no bot available named cracked; available: drill-bull, drill-bear" },
    { bot: "drill-bull", message: "no bot available named drill-bull; available: none", bots: async () => ({ available: [], rows: [] }) },
  ];
  for (const c of cases) {
    const f = new Fake();
    const deps = { ...f.deps(root), bots: c.bots ?? bots };
    await assert.rejects(
      startWorker(deps, { ...input, bot: c.bot, ...(c.strategy === undefined ? {} : { strategy: c.strategy }) }),
      (err: unknown) => err instanceof TaskInputError && err.message === c.message,
      c.bot,
    );
    assert.equal(f.created.length, 0, c.bot);
  }
  /* no bots provider at all: none available */
  const f = new Fake();
  await assert.rejects(startWorker(f.deps(root), { ...input, bot: "drill-bull" }), { name: "TaskInputError", message: "no bot available named drill-bull; available: none" });
  assert.equal(f.created.length, 0);
});

test("rosterBots reads the one roster: its bots in order beside the rows; a roster missing or unreadable refuses, naming channels.json", async () => {
  const home = join(TMP, `${++made}-home`);
  const rows = [{ id: "drill-bull", homeCwd: "/x", listed: true }];
  const read = rosterBots(home, async () => rows);
  await assert.rejects(read(), (err: unknown) => err instanceof TaskInputError
    && err.message === `the roster ${join(home, "face", "channels.json")} is missing, so no bot task can start; repair channels.json in the harness home`);
  await mkdir(join(home, "face"), { recursive: true });
  await writeFile(join(home, "face", "channels.json"), "{ not json");
  await assert.rejects(read(), (err: unknown) => err instanceof TaskInputError
    && err.message === `the roster ${join(home, "face", "channels.json")} cannot be read, so no bot task can start; repair channels.json in the harness home`);
  await writeFile(join(home, "face", "channels.json"), JSON.stringify({ version: 2, agents: [], bots: ["drill-bear", "drill-bull"] }));
  assert.deepEqual(await read(), { available: ["drill-bear", "drill-bull"], rows });
  /* a bot task over the unreadable roster is refused before any session exists */
  await writeFile(join(home, "face", "channels.json"), JSON.stringify({ version: 3 }));
  const root = await repo(["alpha"]);
  const f = new Fake();
  await assert.rejects(startWorker({ ...f.deps(root), bots: read }, { ...input, bot: "drill-bull" }), /channels\.json cannot be read/);
  assert.equal(f.created.length, 0);
});
