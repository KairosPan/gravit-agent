// face/tests/task-worker.test.ts
/** Task workers (src/task-worker.ts): a root session on gravit per task, its folder and its brief. Offline. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PRESET } from "../src/overlay.ts";
import {
  TASK_BRIEF_MAX, TASK_FOOTER, TASK_TITLE_MAX, TaskInputError, briefText, isStrategyName, startWorker, strategyDir,
  type WorkerCtxLike,
} from "../src/task-worker.ts";
import type { CreateDeskAgentOptions } from "../src/desk-session.ts";
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
