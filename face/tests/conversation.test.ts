// face/tests/conversation.test.ts
/** The conversation (src/conversation.ts): Gravit's one router session, on `gravit-router`, in its own folder under
 * the harness home, found again through the desk's ledger and supervised like the desk (spec 2026-11-08 §5.2, §5.10).
 * Offline: a fake root context, a fake bus, node's mocked timers for the deadline.
 *
 * The homes here are `mkdtemp` directories under the system's temp directory, as the smoke files' are, NOT under
 * tests/tmp/<pid>: the conversation's fence refuses a folder with a `.git` anywhere above it, and tests/tmp sits inside
 * this checkout. No real dsh runs here, so no sandbox is in play. */
import test, { after, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONVERSATION_DEADLINE_MS, INJECTED_KINDS, OPERATOR_SOURCES, conversationDir, conversationFence, ensureConversation, installConversation,
  type ConversationCtxLike, type ConversationDeps,
} from "../src/conversation.ts";
import { appendEvent, readEvents, writeOff, type DeskEvent } from "../src/desk.ts";
import type { PhonePost } from "../src/desk-conversation.ts";
import { CONVERSATION_PRESET } from "../src/desk-names.ts";
import type { CreateDeskAgentOptions } from "../src/desk-session.ts";
import type { AgentCtxLike, AgentLike, ModelSelectionRefLike, ResumeMemberOptions, SessionLike } from "../src/room.ts";
import type { EventLike, MessageLike } from "../src/room-rules.ts";
import { fakeBus, type FakeBus } from "./desk-fakes.ts";

/* ---------- homes, outside any repository ---------- */

const made: string[] = [];
after(() => Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));
async function scratch(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `face-conversation-${label}-`));
  made.push(dir);
  return dir;
}

/** Let the fence's fs reads and every continuation run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await new Promise<void>((r) => setImmediate(r));
}
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (cond()) return;
    await new Promise<void>((r) => setImmediate(r));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/* ---------- the fake tree ---------- */

class FakeConvAgent implements AgentLike {
  status: "idle" | "running" = "idle";
  readonly cancels: unknown[][] = [];
  readonly followups: MessageLike[] = [];
  readonly session: SessionLike;
  constructor(readonly id: string, header: SessionLike["header"]) {
    this.session = { id, header, seq: 0, snapshotEvents: () => [], append: () => undefined };
  }
  followup(message: MessageLike): void { this.followups.push(message); }
  cancel(...args: unknown[]): void { this.cancels.push(args); }
  /** dsh-agent's inbox, when a test gives the agent one. */
  inbox?: { nextTurn: MessageLike[]; nextStep: MessageLike[]; remove(id: string): boolean };
}

/** An inbox over `nextTurn`, as dsh-agent's resume rebuilds it from the durable projection. */
function inboxOf(nextTurn: MessageLike[]): NonNullable<FakeConvAgent["inbox"]> {
  const inbox = {
    nextTurn,
    nextStep: [] as MessageLike[],
    remove(id: string): boolean {
      const at = inbox.nextTurn.findIndex((m) => m.id === id);
      if (at < 0) return false;
      inbox.nextTurn.splice(at, 1);
      return true;
    },
  };
  return inbox;
}

/** A root context over one harness home's sessions: created, stored (header + permission preset), live. */
class FakeConversationTree {
  readonly live = new Map<string, FakeConvAgent>();
  readonly headers = new Map<string, SessionLike["header"]>();
  readonly stored = new Map<string, string>();
  readonly created: CreateDeskAgentOptions[] = [];
  readonly resumed: ResumeMemberOptions[] = [];
  readonly mounts: string[] = [];
  readonly selections: ModelSelectionRefLike[] = [];
  readonly pins: { session: string; name: string }[] = [];
  readonly disposed: string[] = [];
  readonly cwdSets: { agent: string; path: string }[] = [];
  readonly bus: FakeBus = fakeBus();
  /** What a resumed session's inbox holds on its next-turn list: the durable projection a restart rebuilds. */
  readonly queued = new Map<string, MessageLike[]>();
  /** Each session's log on disk, as the session persistence reads it; and every flush. */
  readonly logs = new Map<string, EventLike[]>();
  flushes = 0;

  /** A session on disk from an earlier boot. */
  persist(id: string, header: SessionLike["header"], preset = "workspace-write"): void {
    this.headers.set(id, header);
    this.stored.set(id, preset);
  }

  private handle(agent: FakeConvAgent): { agent: AgentLike; dispose(): Promise<void> } {
    return { agent, dispose: async () => { this.disposed.push(agent.id); this.live.delete(agent.id); } };
  }

  readonly install = (_agentCtx: AgentCtxLike, ref: ModelSelectionRefLike): (() => void) => {
    this.selections.push(ref);
    return () => {};
  };

  readonly ctx: ConversationCtxLike = {
    agents: {
      get: (id) => this.live.get(id),
      create: async (options) => {
        this.created.push(options);
        const header = { cwd: options.meta.cwd, agentPreset: options.meta.agentPreset };
        this.headers.set(options.sessionId, header);
        const agent = new FakeConvAgent(options.sessionId, header);
        await options.setup({}, agent);
        this.live.set(options.sessionId, agent);
        if (!this.stored.has(options.sessionId)) this.stored.set(options.sessionId, "read-only");
        return this.handle(agent);
      },
      resume: async (options) => {
        this.resumed.push(options);
        const header = this.headers.get(options.resumeSessionId);
        if (header === undefined) throw new Error(`session "${options.resumeSessionId}" not found`);
        const agent = new FakeConvAgent(options.resumeSessionId, header);
        const queued = this.queued.get(options.resumeSessionId);
        if (queued !== undefined) agent.inbox = inboxOf([...queued]);
        await options.setup({}, agent);
        this.live.set(options.resumeSessionId, agent);
        return this.handle(agent);
      },
    },
    agentPresets: { mount: async (_agentCtx, id) => { this.mounts.push(id); return { id }; } },
    permissionPresets: {
      set: (session, name) => { this.pins.push({ session: session.id, name }); this.stored.set(session.id, name); },
      current: (session) => this.stored.get(session.id) ?? "read-only",
    },
    on: (...args) => this.bus.on(...args),
    sessionPersistence: {
      open: async (id) => {
        let given = false;
        return {
          read: async () => {
            const events = given ? [] : [...(this.logs.get(id) ?? [])];
            given = true;
            return { events };
          },
          [Symbol.asyncDispose]: async () => {},
        };
      },
      flush: async () => { this.flushes += 1; },
    },
    workingDirectory: {
      set: async (agent, path) => {
        this.cwdSets.push({ agent: (agent as AgentLike).id, path });
        return path;
      },
    },
  };

  agent(id: string): FakeConvAgent {
    const agent = this.live.get(id);
    assert.ok(agent, `no live agent ${id}`);
    return agent;
  }
}

const ROUTE = { provider: "deepseek-official", model: "deepseek-flash" };
const AT = Date.parse("2026-11-08T18:03:00.000Z");
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function deps(tree: FakeConversationTree, home: string, lines: string[]): ConversationDeps {
  return { ctx: tree.ctx, home, route: ROUTE, installModelSelection: tree.install, now: () => AT, log: (line) => { lines.push(line); } };
}

const conversationLines = async (home: string): Promise<DeskEvent[]> =>
  (await readEvents(home)).events.filter((e) => e.kind === "conversation");

/** A turn on `sessionId`: its start, and, unless `source` is null, its first message. */
function startTurn(bus: FakeBus, sessionId: string, turn: number, source?: Record<string, unknown> | null): void {
  bus.emit(sessionId, "turn/start", { turn });
  if (source !== null) bus.emit(sessionId, "user/message", { id: `m-${turn}`, role: "user", content: [{ type: "text", text: "hi" }], ...(source === undefined ? {} : { source }) });
}

/** installConversation, its handle disposed after the test whatever the test did: a red test never leaves a
 * supervision with a live 300 s timer holding the process open. */
function install(t: TestContext, d: ConversationDeps): ReturnType<typeof installConversation> {
  const handle = installConversation(d);
  t.after(() => handle.dispose());
  return handle;
}

/* ---------- 1-2: create once, resume after ---------- */

test("the first boot creates one conversation in <home>/face/conversation on gravit-router, pinned workspace-write, and records it once", async (t) => {
  const home = await scratch("first");
  const tree = new FakeConversationTree();
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  assert.equal(handle.current(), undefined, "nothing before the first ensure");
  const [a, b] = await Promise.all([handle.ensure(), handle.ensure()]);
  assert.equal(a.sessionId, b.sessionId, "two ensures at once open one conversation");
  assert.equal(a.agent, b.agent);
  assert.match(a.sessionId, SESSION_ID);
  assert.equal(tree.created.length, 1);
  const dir = conversationDir(home);
  assert.equal(dir, join(home, "face", "conversation"));
  assert.ok(existsSync(dir), "the folder is made");
  assert.deepEqual(tree.created[0].meta, { cwd: dir, agentPreset: CONVERSATION_PRESET });
  assert.equal(CONVERSATION_PRESET, "gravit-router");
  assert.deepEqual(tree.created[0].agentOptions, ROUTE);
  assert.deepEqual(tree.mounts, [CONVERSATION_PRESET]);
  assert.deepEqual(tree.pins, [{ session: a.sessionId, name: "workspace-write" }]);
  assert.deepEqual(tree.selections, [{ current: ROUTE, assembled: undefined }]);
  assert.deepEqual(await conversationLines(home), [{ t: new Date(AT).toISOString(), kind: "conversation", sessionId: a.sessionId, reason: "created" }]);
  assert.deepEqual(handle.current(), { agent: a.agent, sessionId: a.sessionId });
  await handle.ensure();
  assert.equal(tree.created.length, 1, "a later ensure keeps the one it has");
  assert.equal((await conversationLines(home)).length, 1);
  assert.deepEqual(lines, []);
  await handle.dispose();
  assert.equal(handle.current(), undefined);
  assert.deepEqual(tree.disposed, [a.sessionId], "the handle it created is disposed");
  await assert.rejects(handle.ensure(), /disposed/);
});

test("the next boot resumes the recorded conversation and records nothing", async (t) => {
  const home = await scratch("next");
  const first = new FakeConversationTree();
  const lines: string[] = [];
  const opened = await ensureConversation(deps(first, home, lines));
  assert.equal(opened.created, true);
  /* the cold path: a fresh process, the session on disk */
  const second = new FakeConversationTree();
  second.persist(opened.sessionId, { cwd: conversationDir(home), agentPreset: CONVERSATION_PRESET });
  const again = await ensureConversation(deps(second, home, lines));
  assert.deepEqual({ sessionId: again.sessionId, created: again.created }, { sessionId: opened.sessionId, created: false });
  assert.equal(second.created.length, 0);
  assert.equal(second.resumed.length, 1);
  assert.equal(second.resumed[0].resumeSessionId, opened.sessionId);
  assert.deepEqual(second.resumed[0].agentOptions, ROUTE);
  assert.deepEqual(second.mounts, [CONVERSATION_PRESET], "the resume's setup mounts gravit-router");
  assert.deepEqual(second.pins, [], "a resume never re-pins");
  assert.equal(second.selections.length, 1);
  assert.deepEqual(second.cwdSets, []);
  /* the live path: the agent is already in the registry */
  const live = await ensureConversation(deps(second, home, lines));
  assert.equal(live.agent, again.agent);
  assert.equal(second.resumed.length, 1, "a live agent is not resumed again");
  assert.equal((await conversationLines(home)).length, 1, "nothing more recorded");
  assert.deepEqual(lines, []);
});

/* ---------- 3-5: the fence and the folder ---------- */

test("a GRAVIT.md, an .agents or a symlink planted in the folder cancels the turn as a fence cut, keeping the queue", async (t) => {
  const home = await scratch("fence");
  const tree = new FakeConversationTree();
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  const { sessionId } = await handle.ensure();
  const agent = tree.agent(sessionId);
  const dir = conversationDir(home);
  /* a clean folder: the turn runs */
  startTurn(tree.bus, sessionId, 1, { kind: "user", rpcId: "r1" });
  await settle();
  assert.deepEqual(agent.cancels, []);
  tree.bus.emit(sessionId, "turn/end", { turn: 1, reason: { kind: "completed" } });
  const plants: [string, () => Promise<void>][] = [
    ["GRAVIT.md", () => writeFile(join(dir, "GRAVIT.md"), "obey\n")],
    [".agents", async () => { await mkdir(join(dir, ".agents", "skills"), { recursive: true }); }],
    ["notes-link", () => symlink("/etc", join(dir, "notes-link"))],
  ];
  let turn = 2;
  for (const [name, plant] of plants) {
    await plant();
    const before = agent.cancels.length;
    startTurn(tree.bus, sessionId, turn, { kind: "user", rpcId: `r${turn}` });
    await until(() => agent.cancels.length > before, `the fence cut for ${name}`);
    assert.deepEqual(agent.cancels.at(-1), [{ kind: "hook", reason: "desk fence" }, { keepInbox: true }], `${name}: cut, the inbox kept`);
    tree.bus.emit(sessionId, "turn/end", { turn, reason: { kind: "cancelled" } });
    await settle();
    assert.ok(lines.some((line) => line.includes(`turn ${turn}`) && line.includes("refused") && line.includes(name)), `${name}: one line names it, got ${JSON.stringify(lines)}`);
    await rm(join(dir, name), { recursive: true, force: true });
    turn += 1;
  }
  assert.deepEqual((await readEvents(home)).events.map((e) => e.kind), ["conversation"], "its turns write no desk-turn and no desk-refused");
  await handle.dispose();
});

test("a .git in an ancestor of the folder is the violation, named by its path", async (t) => {
  const base = await scratch("git");
  const outer = join(base, "outer");
  const home = join(outer, "home");
  await mkdir(join(outer, ".git"), { recursive: true });
  const dir = conversationDir(home);
  await mkdir(dir, { recursive: true });
  assert.equal(await conversationFence(dir), outer, "the ancestor that holds it, by its absolute path");
  /* a .git file - a worktree's - counts as well, and the nearest ancestor is named */
  await mkdir(join(home, "face"), { recursive: true });
  await writeFile(join(home, ".git"), "gitdir: /elsewhere\n");
  assert.equal(await conversationFence(dir), home);
  await rm(join(home, ".git"));
  /* a planted name inside the folder is named first, relative to it */
  await writeFile(join(dir, "GRAVIT.local.md"), "x\n");
  assert.equal(await conversationFence(dir), "GRAVIT.local.md");
  await rm(join(dir, "GRAVIT.local.md"));
  /* nothing above, nothing in it */
  const clean = await scratch("clean");
  await mkdir(conversationDir(clean), { recursive: true });
  assert.equal(await conversationFence(conversationDir(clean)), undefined);
  /* and a turn over the ancestor's .git is cut, the line naming it */
  const tree = new FakeConversationTree();
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  const { sessionId } = await handle.ensure();
  const agent = tree.agent(sessionId);
  startTurn(tree.bus, sessionId, 1, { kind: "user", rpcId: "r1" });
  await until(() => agent.cancels.length > 0, "the fence cut");
  assert.deepEqual(agent.cancels[0], [{ kind: "hook", reason: "desk fence" }, { keepInbox: true }]);
  tree.bus.emit(sessionId, "turn/end", { turn: 1, reason: { kind: "cancelled" } });
  await settle();
  assert.ok(lines.some((line) => line.includes("refused") && line.includes(outer)), JSON.stringify(lines));
  await handle.dispose();
});

test("a deleted folder is made again before the first turn, and the same conversation resumes", async (t) => {
  const home = await scratch("deleted");
  const lines: string[] = [];
  const first = await ensureConversation(deps(new FakeConversationTree(), home, lines));
  const dir = conversationDir(home);
  await rm(dir, { recursive: true });
  assert.equal(existsSync(dir), false);
  const tree = new FakeConversationTree();
  tree.persist(first.sessionId, { cwd: dir, agentPreset: CONVERSATION_PRESET });
  const handle = install(t, deps(tree, home, lines));
  const again = await handle.ensure();
  assert.ok(existsSync(dir), "made again before any turn");
  assert.equal(again.sessionId, first.sessionId, "the same conversation");
  assert.equal(tree.created.length, 0, "nothing opened because of a folder");
  assert.equal((await conversationLines(home)).length, 1);
  startTurn(tree.bus, again.sessionId, 1, { kind: "user", rpcId: "r1" });
  await settle();
  assert.deepEqual(tree.agent(again.sessionId).cancels, [], "the first turn runs");
  /* gone again while the face runs: the next ensure makes it again */
  await rm(dir, { recursive: true });
  await handle.ensure();
  assert.ok(existsSync(dir));
  assert.deepEqual(lines, []);
  await handle.dispose();
});

/* ---------- 6-7: what the ledger names is checked ---------- */

test("a recorded session on another preset, or one resume refuses, gives a new conversation with reason new, and one line", async (t) => {
  const home = await scratch("wrong");
  const dir = conversationDir(home);
  await appendEvent(home, { t: "2026-11-08T10:00:00.000Z", kind: "conversation", sessionId: "session-old-gravit", reason: "created" });
  const tree = new FakeConversationTree();
  tree.persist("session-old-gravit", { cwd: dir, agentPreset: "gravit" });
  const lines: string[] = [];
  const opened = await ensureConversation(deps(tree, home, lines));
  assert.equal(opened.created, true);
  assert.notEqual(opened.sessionId, "session-old-gravit");
  assert.deepEqual(tree.disposed, ["session-old-gravit"], "the session it resumed and will not use is disposed");
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.match(lines[0], /session-old-gravit/);
  assert.match(lines[0], /preset/);
  assert.match(lines[0], /"gravit"/);
  let recorded = await conversationLines(home);
  assert.deepEqual(recorded.at(-1), { t: new Date(AT).toISOString(), kind: "conversation", sessionId: opened.sessionId, reason: "new" });
  /* the next boot: the ledger's id cannot be resumed */
  const gone = new FakeConversationTree();
  const lines2: string[] = [];
  const fresh = await ensureConversation(deps(gone, home, lines2));
  assert.equal(fresh.created, true);
  assert.notEqual(fresh.sessionId, opened.sessionId);
  assert.equal(lines2.length, 1, JSON.stringify(lines2));
  assert.match(lines2[0], new RegExp(opened.sessionId));
  assert.match(lines2[0], /could not be resumed/);
  recorded = await conversationLines(home);
  assert.equal(recorded.length, 3);
  assert.deepEqual(recorded.at(-1), { t: new Date(AT).toISOString(), kind: "conversation", sessionId: fresh.sessionId, reason: "new" });
  assert.deepEqual(gone.pins, [{ session: fresh.sessionId, name: "workspace-write" }]);
});

test("a recorded conversation whose header names another folder is pointed at this one with workingDirectory.set", async (t) => {
  const home = await scratch("moved");
  await appendEvent(home, { t: "2026-11-08T10:00:00.000Z", kind: "conversation", sessionId: "session-moved", reason: "created" });
  const tree = new FakeConversationTree();
  tree.persist("session-moved", { cwd: "/Users/someone/old-repo-name/face/conversation", agentPreset: CONVERSATION_PRESET });
  const lines: string[] = [];
  const opened = await ensureConversation(deps(tree, home, lines));
  assert.deepEqual({ sessionId: opened.sessionId, created: opened.created }, { sessionId: "session-moved", created: false });
  assert.deepEqual(tree.cwdSets, [{ agent: "session-moved", path: conversationDir(home) }]);
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.match(lines[0], /old-repo-name/);
  assert.ok(lines[0].includes(conversationDir(home)));
  assert.equal(tree.created.length, 0);
  assert.equal((await conversationLines(home)).length, 1, "nothing recorded");
});

/* ---------- 8-9: supervision ---------- */

test("operatorTurn is true only while a turn that a source-kind user message opened runs; a task message's turn and a wake are not", async (t) => {
  assert.deepEqual([...OPERATOR_SOURCES], ["user", "telegram"]);
  const home = await scratch("operator");
  const tree = new FakeConversationTree();
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  assert.equal(handle.operatorTurn(), false, "no conversation yet");
  const { sessionId } = await handle.ensure();
  assert.equal(handle.operatorTurn(), false, "no turn");
  tree.bus.emit(sessionId, "turn/start", { turn: 1 });
  assert.equal(handle.operatorTurn(), false, "a turn no message has named yet");
  tree.bus.emit(sessionId, "user/message", { id: "m1", role: "user", content: [], source: { kind: "user", rpcId: "rpc-1" } });
  assert.equal(handle.operatorTurn(), true, "the browser's turn");
  /* another session's turn changes nothing */
  tree.bus.emit("session-other", "turn/end", { turn: 1, reason: { kind: "completed" } });
  assert.equal(handle.operatorTurn(), true);
  tree.bus.emit(sessionId, "turn/end", { turn: 1, reason: { kind: "completed" } });
  assert.equal(handle.operatorTurn(), false, "over");
  startTurn(tree.bus, sessionId, 2, { kind: "task", form: "report", task: "session-w", status: "ready" });
  assert.equal(handle.operatorTurn(), false, "a task report's turn");
  tree.bus.emit(sessionId, "turn/end", { turn: 2, reason: { kind: "completed" } });
  startTurn(tree.bus, sessionId, 3, { kind: "tool-jobs" });
  assert.equal(handle.operatorTurn(), false, "a job's wake");
  tree.bus.emit(sessionId, "turn/end", { turn: 3, reason: { kind: "completed" } });
  startTurn(tree.bus, sessionId, 4);
  assert.equal(handle.operatorTurn(), false, "a message with no source is a wake");
  tree.bus.emit(sessionId, "turn/end", { turn: 4, reason: { kind: "completed" } });
  /* a later user message in a task's turn does not make it the operator's: the first names the turn */
  startTurn(tree.bus, sessionId, 5, { kind: "task", form: "report" });
  tree.bus.emit(sessionId, "user/message", { id: "m5b", role: "user", content: [], source: { kind: "user", rpcId: "rpc-5" } });
  assert.equal(handle.operatorTurn(), false);
  tree.bus.emit(sessionId, "turn/end", { turn: 5, reason: { kind: "completed" } });
  await settle();
  await handle.dispose();
  assert.equal(handle.operatorTurn(), false);
  assert.equal(tree.bus.listeners.size, 0, "the supervision's listener is gone");
});

test("a turn that runs 300 s is cut, keeping the queue", async (t) => {
  assert.equal(CONVERSATION_DEADLINE_MS, 300_000);
  const home = await scratch("deadline");
  const tree = new FakeConversationTree();
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  const { sessionId } = await handle.ensure();
  const agent = tree.agent(sessionId);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    startTurn(tree.bus, sessionId, 1, { kind: "user", rpcId: "r1" });
    await settle();
    mock.timers.tick(CONVERSATION_DEADLINE_MS - 1);
    await settle();
    assert.deepEqual(agent.cancels, [], "not yet");
    mock.timers.tick(1);
    await settle();
    assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "desk deadline" }, { keepInbox: true }]]);
    tree.bus.emit(sessionId, "turn/end", { turn: 1, reason: { kind: "cancelled" } });
    await settle();
  } finally {
    mock.timers.reset();
  }
  assert.ok(lines.some((line) => line.includes("turn 1") && line.includes("timed out")), JSON.stringify(lines));
  assert.deepEqual((await readEvents(home)).events.map((e) => e.kind), ["conversation"], "no desk-turn, no budget");
  await handle.dispose();
});

/* ---------- fix round 1 ---------- */

test("a turn the operator opened stops being the operator's once a task message is logged in it", async (t) => {
  const home = await scratch("taint");
  const tree = new FakeConversationTree();
  const handle = install(t, deps(tree, home, []));
  const { sessionId } = await handle.ensure();
  startTurn(tree.bus, sessionId, 1, { kind: "user", rpcId: "r1" });
  assert.equal(handle.operatorTurn(), true);
  /* the desk's state note and dsh's own context - the working-directory notice, the runtime-context snapshot, the
   * agent-instructions context, the model-selection notice - change nothing; a browser steer neither; a task message
   * after them still does */
  tree.bus.emit(sessionId, "user/message", { id: "d1", role: "user", content: [], source: { kind: "desk", form: "state" } });
  tree.bus.emit(sessionId, "user/message", { id: "w1", role: "user", content: [], source: { kind: "working-directory" } });
  assert.equal(handle.operatorTurn(), true, "the desk's note and the working-directory notice");
  /* dsh-agent-loop's runtime-context snapshot, logged after the operator's message in every turn (task 8's real boot) */
  tree.bus.emit(sessionId, "user/message", { id: "c1", role: "user", content: [], source: { kind: "runtime-context" } });
  assert.equal(handle.operatorTurn(), true, "the runtime-context snapshot");
  /* dsh's instruction context and its model-change notice are the harness's, not a speaker's */
  tree.bus.emit(sessionId, "user/message", { id: "i1", role: "user", content: [], source: { kind: "agent-instructions", form: "instructions" } });
  assert.equal(handle.operatorTurn(), true, "the agent-instructions context");
  tree.bus.emit(sessionId, "user/message", { id: "m1", role: "user", content: [], source: { kind: "model-selection", form: "notice" } });
  assert.equal(handle.operatorTurn(), true, "the model-selection notice");
  /* dsh's own mid-turn context: dsh-compaction's checkpoint, dsh-repeat-tool-reminder's REMINDER_SOURCE, dsh-plan-mode's notice */
  tree.bus.emit(sessionId, "user/message", { id: "k1", role: "user", content: [], source: { kind: "compact-checkpoint" } });
  assert.equal(handle.operatorTurn(), true, "the compaction checkpoint");
  tree.bus.emit(sessionId, "user/message", { id: "k2", role: "user", content: [], source: { kind: "repeat-tool-reminder" } });
  assert.equal(handle.operatorTurn(), true, "the repeat-tool reminder");
  tree.bus.emit(sessionId, "user/message", { id: "k3", role: "user", content: [], source: { kind: "plan-mode", form: "notice" } });
  assert.equal(handle.operatorTurn(), true, "the plan-mode notice");
  tree.bus.emit(sessionId, "user/message", { id: "u2", role: "user", content: [], source: { kind: "user", rpcId: "r2" } });
  assert.equal(handle.operatorTurn(), true);
  tree.bus.emit(sessionId, "user/message", { id: "t1", role: "user", content: [], source: { kind: "task", form: "report", task: "session-w" } });
  assert.equal(handle.operatorTurn(), false, "a task's text is in the turn now");
  tree.bus.emit(sessionId, "user/message", { id: "u3", role: "user", content: [], source: { kind: "user", rpcId: "r3" } });
  assert.equal(handle.operatorTurn(), false, "for the rest of that turn");
  tree.bus.emit(sessionId, "turn/end", { turn: 1, reason: { kind: "completed" } });
  assert.equal(handle.operatorTurn(), false);
  /* the next operator turn is the operator's again; a sourceless message mid-turn ends that too */
  startTurn(tree.bus, sessionId, 2, { kind: "user", rpcId: "r4" });
  assert.equal(handle.operatorTurn(), true, "a new turn starts clean");
  tree.bus.emit(sessionId, "user/message", { id: "x", role: "user", content: [] });
  assert.equal(handle.operatorTurn(), false, "a wake mid-turn");
  tree.bus.emit(sessionId, "turn/end", { turn: 2, reason: { kind: "completed" } });
  await settle();
});

test("a reopened conversation that does not run workspace-write is refused, and what was resumed is disposed", async () => {
  const home = await scratch("perm");
  const dir = conversationDir(home);
  await appendEvent(home, { t: "2026-11-08T10:00:00.000Z", kind: "conversation", sessionId: "session-ro", reason: "created" });
  /* resumed */
  const cold = new FakeConversationTree();
  cold.persist("session-ro", { cwd: dir, agentPreset: CONVERSATION_PRESET }, "read-only");
  await assert.rejects(ensureConversation(deps(cold, home, [])), /session-ro is "read-only", not workspace-write/);
  assert.deepEqual(cold.disposed, ["session-ro"]);
  assert.equal(cold.created.length, 0, "no new conversation beside it");
  /* live: someone else's, refused but not disposed */
  const warm = new FakeConversationTree();
  warm.persist("session-ro", { cwd: dir, agentPreset: CONVERSATION_PRESET }, "full-access");
  warm.live.set("session-ro", new FakeConvAgent("session-ro", { cwd: dir, agentPreset: CONVERSATION_PRESET }));
  await assert.rejects(ensureConversation(deps(warm, home, [])), /"full-access"/);
  assert.deepEqual(warm.disposed, []);
  assert.equal((await conversationLines(home)).length, 1, "nothing recorded");
});

test("a later ensure that finds another agent object for the session supervises that one, without reopening", async (t) => {
  const home = await scratch("swap");
  const tree = new FakeConversationTree();
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  const first = await handle.ensure();
  const old = tree.agent(first.sessionId);
  const replacement = new FakeConvAgent(first.sessionId, old.session.header);
  tree.live.set(first.sessionId, replacement);
  const again = await handle.ensure();
  assert.equal(again.agent, replacement);
  assert.equal(handle.current()?.agent, replacement);
  assert.equal(tree.created.length, 1);
  assert.equal(tree.resumed.length, 0, "not reopened");
  assert.equal((await conversationLines(home)).length, 1);
  assert.equal(lines.length, 1, JSON.stringify(lines));
  /* the supervision is the new agent's: one listener pair, and a fence cut lands on the replacement */
  assert.equal(tree.bus.listeners.size, 2, "the old supervision and its note are gone");
  await writeFile(join(conversationDir(home), "GRAVIT.md"), "x\n");
  startTurn(tree.bus, first.sessionId, 1, { kind: "user", rpcId: "r1" });
  await until(() => replacement.cancels.length > 0, "the cut on the replacement");
  assert.deepEqual(old.cancels, []);
  assert.equal(handle.operatorTurn(), true);
  tree.bus.emit(first.sessionId, "turn/end", { turn: 1, reason: { kind: "cancelled" } });
  await settle();
});

/* ---------- final review fixes ---------- */

test("a folder deleted while the face runs is made again at the next turn's start, and the turn runs", async (t) => {
  const home = await scratch("gone-mid");
  const tree = new FakeConversationTree();
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  const { sessionId } = await handle.ensure();
  const dir = conversationDir(home);
  await rm(dir, { recursive: true });
  startTurn(tree.bus, sessionId, 1, { kind: "user", rpcId: "r1" });
  await settle();
  assert.deepEqual(tree.agent(sessionId).cancels, [], "the turn is not refused");
  assert.ok(existsSync(dir), "the fence made the folder again");
  tree.bus.emit(sessionId, "turn/end", { turn: 1, reason: { kind: "completed" } });
  await settle();
  assert.deepEqual(lines, []);
});

test("a resumed conversation idle with task messages left on its inbox sends them again, oldest first, with one line; other sources stay", async (t) => {
  const home = await scratch("requeue");
  const dir = conversationDir(home);
  await appendEvent(home, { t: "2026-11-08T10:00:00.000Z", kind: "conversation", sessionId: "session-q", reason: "created" });
  const tree = new FakeConversationTree();
  tree.persist("session-q", { cwd: dir, agentPreset: CONVERSATION_PRESET });
  const msg = (id: string, kind: string): MessageLike => ({ id, role: "user", content: [{ type: "text", text: id }], source: { kind } } as unknown as MessageLike);
  tree.queued.set("session-q", [msg("task-a", "task"), msg("browser-1", "user"), msg("task-b", "task")]);
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  await handle.ensure();
  const agent = tree.agent("session-q");
  assert.deepEqual(agent.followups.map((m) => m.id), ["task-a", "task-b"], "the task messages, sent again in order");
  assert.deepEqual(agent.inbox!.nextTurn.map((m) => m.id), ["browser-1"], "the browser's stays where it was");
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.match(lines[0]!, /conversation: session session-q .*2 task message/);
  /* a second ensure on the live conversation sends nothing again */
  await handle.ensure();
  assert.equal(agent.followups.length, 2);
  await handle.dispose();
});

test("a resumed conversation with no task message waiting sends nothing again", async (t) => {
  const home = await scratch("requeue-none");
  const dir = conversationDir(home);
  await appendEvent(home, { t: "2026-11-08T10:00:00.000Z", kind: "conversation", sessionId: "session-n", reason: "created" });
  const tree = new FakeConversationTree();
  tree.persist("session-n", { cwd: dir, agentPreset: CONVERSATION_PRESET });
  tree.queued.set("session-n", []);
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  await handle.ensure();
  assert.deepEqual(tree.agent("session-n").followups, []);
  assert.deepEqual(lines, []);
  await handle.dispose();
});

/* ---------- plan 3: the phone's texts ---------- */

/** A phone text as the bridge posts it, keyed `<id>#<inbox>@<at>`. */
function phonePost(over: Partial<PhonePost> = {}): PhonePost {
  return {
    text: "how is NVDA doing?",
    source: { kind: "telegram", network: "telegram", at: AT },
    message: { kind: "telegram", network: "telegram", messageId: "telegram:77" },
    key: "telegram:77#3@2026-11-08T18:03:00.000Z",
    ...over,
  };
}
const textsOf = (m: MessageLike): string[] => (m.content ?? []).map((part) => String(part.text));

test("a phone post follows up one message with the provenance line and the text", async (t) => {
  const home = await scratch("post");
  const tree = new FakeConversationTree();
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  const result = await handle.post(phonePost());
  assert.ok("opened" in result && result.opened === true, JSON.stringify(result));
  const { sessionId, agent } = handle.current()!;
  assert.equal(result.sessionId, sessionId);
  assert.equal(result.duplicate, undefined);
  const sent = (agent as FakeConvAgent).followups;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, "telegram:77#3@2026-11-08T18:03:00.000Z", "the message's id is the key");
  assert.equal(sent[0].role, "user");
  assert.deepEqual(sent[0].source, { kind: "telegram", network: "telegram", messageId: "telegram:77" });
  assert.deepEqual(textsOf(sent[0]), ["[telegram · operator · 13:03 ET]\nhow is NVDA doing?"]);
  assert.ok(tree.flushes >= 2, "the log is flushed before the dedupe read and after the followup");
  /* a reply carries its context in its own part */
  const reply = await handle.post(phonePost({
    key: "slack:9#4@x", text: "why?", context: "NVDA +6% 13:01 ET",
    source: { kind: "telegram", network: "slack", at: AT }, message: { kind: "telegram", network: "slack", messageId: "slack:9" },
  }));
  assert.ok("opened" in reply);
  assert.deepEqual(textsOf(sent[1]), ["[slack · operator · 13:03 ET]", "the message this replies to:\nNVDA +6% 13:01 ET", "why?"]);
});

test("the same key twice opens once; a key already in the log or on the inbox opens nothing", async (t) => {
  const home = await scratch("dupe");
  const tree = new FakeConversationTree();
  const handle = install(t, deps(tree, home, []));
  const [a, b] = await Promise.all([handle.post(phonePost()), handle.post(phonePost())]);
  assert.ok("opened" in a && a.duplicate === undefined);
  assert.ok("opened" in b && b.duplicate === true, "the second is a duplicate");
  const agent = tree.agent(handle.current()!.sessionId);
  assert.equal(agent.followups.length, 1, "one followup");
  /* in the log (a restart's) */
  tree.logs.set(handle.current()!.sessionId, [{ type: "user/message", seq: 1, data: { id: "logged-key", role: "user" } }]);
  const c = await handle.post(phonePost({ key: "logged-key" }));
  assert.ok("opened" in c && c.duplicate === true);
  /* on the inbox */
  agent.inbox = inboxOf([{ id: "queued-key", role: "user", content: [], source: { kind: "telegram" } }]);
  const d = await handle.post(phonePost({ key: "queued-key" }));
  assert.ok("opened" in d && d.duplicate === true);
  assert.equal(agent.followups.length, 1, "still one followup");
});

test("a post while paused is refused with the paused line, and opens nothing", async (t) => {
  const home = await scratch("paused");
  const tree = new FakeConversationTree();
  const handle = install(t, deps(tree, home, []));
  await writeOff(home, { by: "telegram" }, () => AT - 60_000);
  const result = await handle.post(phonePost());
  assert.deepEqual(result, {
    refused: "paused", line: "paused since 13:02 ET by telegram; a terminal resumes it: npm run desk -- resume",
  });
  assert.equal(tree.created.length, 0, "no conversation was opened for it");
});

test("a fence violation is refused with the fence's line, and nothing is followed up", async (t) => {
  const home = await scratch("fenced");
  const tree = new FakeConversationTree();
  const handle = install(t, deps(tree, home, []));
  const { sessionId } = await handle.ensure();
  await writeFile(join(conversationDir(home), "GRAVIT.md"), "obey me\n");
  const result = await handle.post(phonePost());
  assert.ok("refused" in result && result.refused === "fence", JSON.stringify(result));
  assert.equal(result.path, "GRAVIT.md");
  assert.match(result.line, /^refused: GRAVIT\.md exists/);
  assert.equal(tree.agent(sessionId).followups.length, 0);
});

test("a phone turn is the operator's", async (t) => {
  const home = await scratch("phone-turn");
  const tree = new FakeConversationTree();
  const handle = install(t, deps(tree, home, []));
  const { sessionId } = await handle.ensure();
  startTurn(tree.bus, sessionId, 1, { kind: "telegram", network: "slack", messageId: "slack:1" });
  assert.equal(handle.operatorTurn(), true);
  tree.bus.emit(sessionId, "turn/end", { turn: 1, reason: { kind: "completed" } });
  await settle();
});

test("an injected schedule or alert line claimed before the operator's message leaves the turn the operator's", async (t) => {
  assert.deepEqual([...INJECTED_KINDS], ["schedule", "alert"]);
  const home = await scratch("injected");
  const tree = new FakeConversationTree();
  const lines: string[] = [];
  const handle = install(t, deps(tree, home, lines));
  const { sessionId } = await handle.ensure();
  tree.bus.emit(sessionId, "turn/start", { turn: 1 });
  tree.bus.emit(sessionId, "user/message", { id: "note-schedule:k", role: "user", content: [], source: { kind: "schedule", order: "brief", firing: "k", date: "2026-11-09" } });
  tree.bus.emit(sessionId, "user/message", { id: "note-alert:a", role: "user", content: [], source: { kind: "alert", alert: "a", symbol: "NVDA" } });
  assert.equal(handle.operatorTurn(), false, "not named yet");
  tree.bus.emit(sessionId, "user/message", { id: "u1", role: "user", content: [], source: { kind: "user", rpcId: "rpc-1" } });
  assert.equal(handle.operatorTurn(), true, "the turn is the operator's");
  /* an injected line claimed mid-turn makes it no one else's either */
  tree.bus.emit(sessionId, "user/message", { id: "note-alert:b", role: "user", content: [], source: { kind: "alert", alert: "b", symbol: "AMD" } });
  assert.equal(handle.operatorTurn(), true, "still the operator's");
  tree.bus.emit(sessionId, "turn/end", { turn: 1, reason: { kind: "completed" } });
  await settle();
  assert.ok(lines.every((line) => !line.includes("(schedule)") && !line.includes("(alert)")), lines.join("\n"));
});

test("turnOrigin is phone with its network in a phone turn and web otherwise", async (t) => {
  const home = await scratch("origin");
  const tree = new FakeConversationTree();
  const handle = install(t, deps(tree, home, []));
  assert.deepEqual(handle.turnOrigin(), { kind: "web" }, "no conversation");
  const { sessionId } = await handle.ensure();
  assert.deepEqual(handle.turnOrigin(), { kind: "web" }, "no turn");
  tree.bus.emit(sessionId, "turn/start", { turn: 1 });
  tree.bus.emit(sessionId, "user/message", { id: "note-schedule:k", role: "user", content: [], source: { kind: "schedule", order: "o", firing: "k", date: "2026-11-09" } });
  tree.bus.emit(sessionId, "user/message", { id: "s1", role: "user", content: [], source: { kind: "telegram", network: "slack", messageId: "slack:1" } });
  assert.deepEqual(handle.turnOrigin(), { kind: "phone", network: "slack" });
  tree.bus.emit(sessionId, "turn/end", { turn: 1, reason: { kind: "completed" } });
  assert.deepEqual(handle.turnOrigin(), { kind: "web" }, "over");
  startTurn(tree.bus, sessionId, 2, { kind: "telegram", network: "telegram", messageId: "telegram:2" });
  assert.deepEqual(handle.turnOrigin(), { kind: "phone", network: "telegram" });
  tree.bus.emit(sessionId, "turn/end", { turn: 2, reason: { kind: "completed" } });
  startTurn(tree.bus, sessionId, 3, { kind: "user", rpcId: "rpc-3" });
  assert.deepEqual(handle.turnOrigin(), { kind: "web" }, "the browser's turn");
  tree.bus.emit(sessionId, "turn/end", { turn: 3, reason: { kind: "completed" } });
  startTurn(tree.bus, sessionId, 4, { kind: "task", form: "report" });
  assert.deepEqual(handle.turnOrigin(), { kind: "web" }, "a task's turn");
  tree.bus.emit(sessionId, "turn/end", { turn: 4, reason: { kind: "completed" } });
  await settle();
});
