// face/tests/task-tools.test.ts
/** The conversation's five task tools (src/task-tools.ts), offline: which agents get them, the operator-turn guard,
 * the bounds, and unknown ids. Ops, context and agents are fakes. */
import test from "node:test";
import assert from "node:assert/strict";
import type { DeskAgentLike, DeskToolDefinition, DeskToolsCtxLike } from "../src/desk-tools.ts";
import { equipConversation, OPERATOR_ONLY, TASK_READ_MAX, TASK_STEER_MAX, taskToolDefinitions, type TaskOps } from "../src/task-tools.ts";
import type { TaskView } from "../src/task-view.ts";

const view = (id: string, extra: Partial<TaskView> = {}): TaskView => ({
  id, title: `title ${id}`, origin: "web", state: "running", group: "running", steps: ["a"], startedAt: 1, lastEventAt: 2, lastSeq: 3, ...extra,
});

function fakeOps() {
  const calls: string[] = [];
  const known = new Map([["w1", view("w1", { strategy: "cn-market" })]]);
  // "old" is known to ops but outside list()'s window.
  const has = (id: string) => known.has(id) || id === "old";
  const ops: TaskOps = {
    async start(input) { calls.push("start"); return view("w2", { title: input.title, strategy: input.strategy }); },
    async steer(id) { calls.push("steer"); if (!has(id)) throw new Error(`no task ${id}`); return view(id, { state: "running" }); },
    async stop(id) { calls.push("stop"); if (!has(id)) throw new Error(`no task ${id}`); return view(id, { state: "stopped", group: "done" }); },
    async read(id) { calls.push("read"); if (!has(id)) throw new Error(`no task ${id}`); return { view: known.get(id) ?? view(id, { state: "done", group: "done" }), text: "x".repeat(TASK_READ_MAX + 50) }; },
    async list() { calls.push("list"); return [...known.values()]; },
  };
  return { ops, calls };
}
const byName = (defs: DeskToolDefinition[], name: string) => defs.find((d) => d.name === name)!;
const exec = { signal: new AbortController().signal };

test("the five tools are on the conversation's own layer and on no other agent's", () => {
  const { ops } = fakeOps();
  const defs = taskToolDefinitions(ops, () => true);
  const registered = new Map<string, string[]>();
  const mk = (id: string): DeskAgentLike => ({
    id, ctx: { tools: { register: (d) => { registered.set(id, [...(registered.get(id) ?? []), d.name]); } }, inject: () => undefined },
  });
  const live = [mk("conv"), mk("other")];
  let listener: ((e: { agent: DeskAgentLike }) => undefined) | undefined;
  const late = mk("late-conv");
  const ctx: DeskToolsCtxLike = {
    on: (_n, l) => { listener = l; return () => undefined; },
    agents: { list: () => live },
    agentPresets: { composedPreset: () => undefined },
  };
  const off = equipConversation(ctx, (a) => a.id === "conv" || a.id === "late-conv", defs);
  listener!({ agent: late });
  listener!({ agent: live[0] });
  assert.deepEqual(registered.get("conv"), ["task_start", "task_steer", "task_stop", "task_read", "task_list"]);
  assert.equal(registered.get("late-conv")?.length, 5);
  assert.equal(registered.has("other"), false);
  off();
});

test("task_start in an operator turn calls ops.start and returns the task's id, title and strategy", async () => {
  const { ops, calls } = fakeOps();
  const start = byName(taskToolDefinitions(ops, () => true), "task_start");
  const out = await start.execute({ title: "Scan", brief: "do it", strategy: "cn-market" }, exec);
  assert.deepEqual(out, { task: "w2", title: "Scan", strategy: "cn-market" });
  assert.deepEqual(calls, ["start"]);
});

test("in a turn that a report or a wake opened, task_start, task_steer and task_stop throw OPERATOR_ONLY and never reach ops; task_read and task_list answer", async () => {
  const { ops, calls } = fakeOps();
  const defs = taskToolDefinitions(ops, () => false);
  await assert.rejects(byName(defs, "task_start").execute({ title: "t", brief: "b" }, exec), new Error(OPERATOR_ONLY));
  await assert.rejects(byName(defs, "task_steer").execute({ task: "w1", text: "x" }, exec), new Error(OPERATOR_ONLY));
  await assert.rejects(byName(defs, "task_stop").execute({ task: "w1" }, exec), new Error(OPERATOR_ONLY));
  assert.deepEqual(calls, []);
  const read = (await byName(defs, "task_read").execute({ task: "w1" }, exec)) as { task: string; text: string };
  assert.equal(read.task, "w1");
  assert.equal(Array.from(read.text).length, TASK_READ_MAX);
  const list = (await byName(defs, "task_list").execute({}, exec)) as { tasks: { task: string; group: string }[] };
  assert.deepEqual(list.tasks.map((t) => [t.task, t.group]), [["w1", "running"]]);
});

test("task_steer, task_stop and task_read on an unknown task throw no task <id>", async () => {
  const { ops } = fakeOps();
  const defs = taskToolDefinitions(ops, () => true);
  await assert.rejects(byName(defs, "task_steer").execute({ task: "nope", text: "x" }, exec), new Error("no task nope"));
  await assert.rejects(byName(defs, "task_stop").execute({ task: "nope" }, exec), new Error("no task nope"));
  await assert.rejects(byName(defs, "task_read").execute({ task: "nope" }, exec), new Error("no task nope"));
});

test("an id absent from list() but known to ops still reaches ops.read, steer and stop", async () => {
  const { ops, calls } = fakeOps();
  const defs = taskToolDefinitions(ops, () => true);
  assert.deepEqual((await byName(defs, "task_read").execute({ task: "old" }, exec) as { task: string }).task, "old");
  assert.deepEqual(await byName(defs, "task_steer").execute({ task: "old", text: "x" }, exec), { task: "old", state: "running" });
  assert.deepEqual(await byName(defs, "task_stop").execute({ task: "old" }, exec), { task: "old", state: "stopped" });
  assert.deepEqual(calls, ["read", "steer", "stop"]);
});

test("a title, brief or steer text out of bounds is refused before ops is called", async () => {
  const { ops, calls } = fakeOps();
  const defs = taskToolDefinitions(ops, () => true);
  const start = byName(defs, "task_start");
  const steer = byName(defs, "task_steer");
  await assert.rejects(start.execute({ title: "", brief: "b" }, exec));
  await assert.rejects(start.execute({ title: "t".repeat(81), brief: "b" }, exec));
  await assert.rejects(start.execute({ title: "t", brief: "" }, exec));
  await assert.rejects(start.execute({ title: "t", brief: "b".repeat(4_001) }, exec));
  await assert.rejects(start.execute({ title: 5, brief: "b" }, exec));
  await assert.rejects(steer.execute({ task: "w1", text: "" }, exec));
  await assert.rejects(steer.execute({ task: "w1", text: "x".repeat(TASK_STEER_MAX + 1) }, exec));
  await assert.rejects(steer.execute({ task: "", text: "x" }, exec));
  assert.deepEqual(calls, []);
});
