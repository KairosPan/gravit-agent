// face/tests/memory-smoke.test.ts
/** The memory on a REAL composed tree (memory plan 1, task 6): the `mcp-memory` row (src/memory-row.ts) spawns
 * gravit-memory's own door from the install beside the face, as the agent `gravit`, and this file shows who holds its
 * seven tools, what one of them answers through the tree, and where the two prompt sections reach.
 *
 * FOUR STATES OF THE WORLD, FOUR BOOTS. The first boots over a home made with the package's own `initHome`: the
 * conversation (`gravit-router`, opened as main.ts opens it - src/tasks.ts `installRouter`) and a task's worker
 * (`gravit`, started by the stubbed conversation's `task_start`) each hold the seven `mcp__memory__memory_*` tools, a
 * desk session (src/desk-session.ts `createDeskAgent`, the firings' create path) holds none; `memory_status`, called
 * through the tree's tool registry as the order-gate smokes call their stand-ins, opens with the status's own first
 * line, and one `memory_record` lands in the home as written `by: "gravit"`; and the assembled prompts are read for the
 * sections `mcp:memory` (dsh-mcp-client's server instructions) and `gravit:memory` (dsh/profile/memory.md, gated on the
 * recall tool). On the same tree the owner-name fence (src/memory-guard.ts), installed as main.ts installs it over the
 * real conversation's held session with whose turn it is set by the test, refuses the owner's name from a worker and
 * from the conversation out of the operator's turn, refuses a worker's void, ref, own-name review and correction of the
 * owner's decision, and hands on the rest to the real row. The second boots over a home nobody made: healthy, and the tool says "no memory here". The third points
 * `FACE_MEMORY_DIR` at an empty directory, an install that is not there: healthy, no memory tool, the face's own
 * standing "not installed". The fourth disables the row by a line in the operator's own patch file: no memory tool in
 * the tree, the conversation or a Gravit session, no `gravit:memory` in their prompts, the face's standing "disabled".
 * Each boot's environment (and the fourth's patch file) is set before it and put back after it, since the row reads it
 * at compose time.
 *
 * THE MEASURE. Asserted: a worker's and the conversation's prompts hold both sections, a desk session's holds no
 * `gravit:memory`. Recorded and not asserted - dsh has no switch for it: whether `mcp:memory` reaches a desk session's,
 * a bot's and a role child's prompt, and, with the row disabled, whether it reaches the conversation's and a Gravit
 * session's. Each is written to stderr as one `memory-smoke: measure:` line.
 *
 * WHERE IT RUNS. Every directory is a `mkdtemp` under the system's temporary directory - the harness home (shared by
 * the four boots, as tests/router-smoke.test.ts's boots share one), the repository root the tasks read (with a `.git`
 * of its own and `strategies/fx`), the bots root, the roles root, the memory's home and the empty install - and each is
 * removed in `after`. The memory homes are under it too: in a test process any other is refused (src/memory.ts).
 *
 * WHAT STANDS IN. The model is the shared stub on `stub/echo`; AKShare and the Account seat are off. The memory is the
 * real package, over a scratch home; the decision recorded is filler. Nothing reaches the network.
 *
 * Own file, gated: FACE_SMOKE=1.
 * @module
 */
import "./helpers/no-market.ts";
import "./helpers/no-memory.ts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { assembleContextFor, installModelSelection } from "@deepseek-ai/dsh-agent";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { initHome, openMemory } from "gravit-memory";
import type { SeatEntryLike } from "../src/account-seat.ts";
import { bootFace, type BootedFace } from "../src/boot.ts";
import { installConversation, type ConversationCtxLike, type ConversationHandle } from "../src/conversation.ts";
import { claimsOf } from "../src/desk.ts";
import { CONVERSATION_PRESET } from "../src/desk-names.ts";
import { createDeskAgent, type DeskSessionDeps } from "../src/desk-session.ts";
import { isTrustedDataRequest } from "../src/http.ts";
import { listBots } from "../src/bots.ts";
import { NO_MEMORY_HERE, memoryOpener } from "../src/memory.ts";
import { OWNER_NAME_REFUSED, installMemoryGuard, ownerDecisionRefused, type MemoryGuardCtxLike } from "../src/memory-guard.ts";
import { MEMORY_ROW_ID, MEMORY_TOOL_PREFIX, MEMORY_TOOLS, composedMemoryRow } from "../src/memory-row.ts";
import { DEFAULT_PRESET } from "../src/overlay.ts";
import { MEMORY_SECTION } from "../src/protocols.ts";
import { ensureRoster, setAvailable } from "../src/roster.ts";
import { setupFaceProfile } from "../src/setup.ts";
import { rosterBots } from "../src/task-worker.ts";
import { installRouter, installTasks, type TasksCtxLike, type TasksHandle } from "../src/tasks.ts";
import { PLUGIN_ABS, makeBotsRoot, makeRolesRoot } from "./bots-fixture.ts";
import { TEST_MEMORY_HOME } from "./helpers/no-memory.ts";
import { mountClient, remote, signIn } from "./remote.ts";
import { StubAdapter, type StubReply } from "./stub-llm.ts";

const gated = process.env.FACE_SMOKE !== "1";
const skip = gated && "set FACE_SMOKE=1";
const STUB = { provider: "stub", model: "echo" };
/** The seven tools as every model inside the face sees them. */
const MEMORY_NAMES = MEMORY_TOOLS.map((raw) => `${MEMORY_TOOL_PREFIX}${raw}`);
/** dsh-mcp-client's section for a server's instructions: `mcp:<serverName>`. */
const MCP_SECTION = "mcp:memory";
/** The operator's prompt that has the conversation start a task, and the task's brief. */
const START = "START_MEMORY_TASK";
const BRIEF = "BRIEF_MEMORY: read the fixture strategy and report.";
/** The prompt that has a plain Gravit session call the fixture role, and the role child's marker. */
const RUN_ROLE = "RUN_ROLE_PROBE";
const ROLE_MARK = "ROLE_FIXTURE_MEMORY";
/** A scratch bot whose allow is `read` and `grep`. */
const BOT = "memory-bot";
/** The filler decision the record registers: no symbol, nothing real. */
const FILLER = { action: "pass", whose: "agent", thesis: "A filler note for the smoke: nothing here is a real decision." };

type Message = GenerateOptions["messages"][number];
const sourceOf = (m: { source?: unknown }): { kind?: unknown } => (m.source ?? {}) as { kind?: unknown };
const textOf = (m: Message): string => m.content.map((b) => ("text" in b ? b.text : "")).join("\n");

/** The last message a person or the task machinery sent in a request, and how many tool results came after it. */
function trigger(r: GenerateOptions): { message?: Message; results: number } {
  for (let i = r.messages.length - 1; i >= 0; i--) {
    const kind = sourceOf(r.messages[i]!).kind;
    if (kind === "user" || kind === "task") {
      return { message: r.messages[i], results: r.messages.slice(i + 1).filter((m) => sourceOf(m).kind === "tool").length };
    }
  }
  return { results: 0 };
}

async function waitFor(what: string, check: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Sets `vars` in this process's environment for `run` and puts every one back after it, however it ends. */
async function withEnv<T>(vars: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

type ToolResult = { isError: boolean; content?: { type?: string; text?: string }[] };
type Tools = {
  schemas(scope?: object): { name: string }[];
  execute(exec: { callId: string; name: string; arguments: unknown; agent: object; signal: AbortSignal }): Promise<ToolResult>;
};
const toolsOf = (booted: BootedFace): Tools => booted.ctx.get("tools") as Tools;
const memoryNamesIn = (names: readonly string[]): string[] => names.filter((name) => name.startsWith(MEMORY_TOOL_PREFIX)).sort();
/** One memory tool called through the tree's registry from `agent`, as the order-gate smokes call their stand-ins. */
async function callMemory(booted: BootedFace, agent: object, raw: string, args: unknown): Promise<{ isError: boolean; text: string }> {
  const result = await toolsOf(booted).execute({
    callId: `memory-smoke-${crypto.randomUUID()}`, name: `${MEMORY_TOOL_PREFIX}${raw}`, arguments: args, agent, signal: new AbortController().signal,
  });
  return { isError: result.isError, text: (result.content ?? []).map((b) => b.text ?? "").join("\n") };
}
/** The sections of `agent`'s assembled prompt that carry text, by name, and their texts. */
async function sectionsOf(booted: BootedFace, agent: Parameters<typeof assembleContextFor>[0]): Promise<Map<string, string>> {
  const assembly = await booted.ctx.systemPrompt.assemble(assembleContextFor(agent));
  return new Map(assembly.sections.filter((s) => s.text.trim() !== "").map((s) => [s.name, s.text]));
}
/** The memory row as the tree composed it, and the face's own standing over it (src/memory.ts `memoryOpener`). */
function rowOf(booted: BootedFace) {
  const loader = booted.ctx.get("loader") as { entries(): Iterable<SeatEntryLike> };
  return composedMemoryRow(loader.entries());
}
/** Whether the memory row's plugin is active: dsh-mcp-client's `apply` awaits its first connection attempt, failed or
 * not, so an active row has settled that attempt and registered whatever tools it will. */
function rowSettled(booted: BootedFace): boolean {
  const loader = booted.ctx.get("loader") as { entries(): Iterable<{ options: { id?: unknown }; fiber?: { state: number } }> };
  return [...loader.entries()].some((entry) => entry.options.id === MEMORY_ROW_ID && entry.fiber?.state === 2 /* FiberState.ACTIVE */);
}

const made: string[] = [];
let home = "";
let root = "";
let bots = "";
let roles = "";
/** The memory's home the first boot runs over, made with the package's own initHome. */
let memoryHome = "";

/** The first boot as this file holds it: the tree, the conversation and its tasks, the browser's session, a worker,
 * a desk agent, a bot session, a plain Gravit session, and what the role child's first request carried. */
interface Face {
  booted: BootedFace;
  conversation: ConversationHandle;
  tasks: TasksHandle;
  sessionId: string;
  base: string;
  cookie: string;
  desk?: Awaited<ReturnType<typeof createDeskAgent>>;
}
let face: Face | undefined;
/** Each session's first model request, by session id; the role child's is found by its marker. */
const firstRequests = new Map<string, GenerateOptions>();

async function stopFace(): Promise<void> {
  const held = face;
  face = undefined;
  if (held === undefined) return;
  await held.desk?.dispose();
  await held.tasks.dispose();
  await held.conversation.dispose();
  await held.booted.dispose();
}

after(async () => {
  await stopFace();
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The scratch harness home, the repository root, the bots root (with {@link BOT} on the one roster) and the roles
 * root (tests/bots-fixture.ts's `probe` role, `read` alone), made once for the four boots. */
async function makeFixtures(): Promise<void> {
  home = await mkdtemp(join(tmpdir(), "face-memory-home-"));
  made.push(home);
  const rawRoot = await mkdtemp(join(tmpdir(), "face-memory-root-"));
  made.push(rawRoot);
  root = await realpath(rawRoot);
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "strategies", "fx"), { recursive: true });
  bots = await makeBotsRoot();
  made.push(bots);
  roles = await makeRolesRoot();
  made.push(roles);
  const dir = join(bots, BOT);
  await mkdir(join(dir, "journal"), { recursive: true });
  await mkdir(join(dir, "skills"), { recursive: true });
  await writeFile(join(dir, "preset.yml"), "name: Memory Bot\ndescription: the memory smoke's bot\n");
  await writeFile(join(dir, "SOUL.md"), "You are Memory Bot, a test bot.\n");
  await writeFile(join(dir, "agent.cordis.yml"),
    `- id: bot\n  name: ${JSON.stringify(PLUGIN_ABS)}\n  config:\n    persona: 'You are Memory Bot, a test bot.'\n    allow:\n      - read\n      - grep\n`);
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  // This smoke owns a scratch profile: never the operator's data server or Account, never a real model.
  writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n` +
    `- id: agent-default-model\n  config:\n    provider: ${STUB.provider}\n    model: ${STUB.model}\n`);
  await ensureRoster(home, []);
  await setAvailable(home, "bot", BOT, true);
}

/** A bare boot on {@link home}, on the stub route, scripted only by `script`. */
async function bootBare(script: (booted: BootedFace, r: GenerateOptions) => StubReply): Promise<BootedFace> {
  const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: bots, rolesRoot: roles });
  booted.ctx.llm.registerAdapter([STUB.provider], new StubAdapter((r) => script(booted, r)));
  return booted;
}

/** The first boot: the conversation and its tasks installed as main.ts installs them. */
async function bootWithConversation(): Promise<Face> {
  const booted = await bootBare((b, r) => {
    if (r.purpose !== undefined) return { kind: "text", text: "memory smoke" }; // titles, compaction
    const header = b.ctx.sessions.get(r.sessionId!)?.header;
    if (r.sessionId !== undefined && !firstRequests.has(String(r.sessionId))) firstRequests.set(String(r.sessionId), r);
    const { message, results } = trigger(r);
    const kind = message === undefined ? undefined : sourceOf(message).kind;
    const said = message === undefined ? "" : textOf(message);
    if (header?.agentPreset === CONVERSATION_PRESET) {
      if (kind === "user" && said.includes(START)) {
        return results === 0 ? { kind: "tool", name: "task_start", args: { title: "Memory probe", brief: BRIEF, strategy: "fx" } } : { kind: "text", text: "STARTED" };
      }
      return { kind: "text", text: "OK" };
    }
    if (header?.parentSession !== undefined && kind === "task") {
      return results === 0 ? { kind: "tool", name: "task_report", args: { status: "ready", text: "REPORT_MEMORY: nothing yet." } } : { kind: "text", text: "WORKER_DONE" };
    }
    if (header?.origin === "subagent") return { kind: "text", text: "ROLE_DONE" };
    if (kind === "user" && said === RUN_ROLE) {
      return results === 0 ? { kind: "tool", name: "role_probe", args: { description: "Probe once", prompt: `${ROLE_MARK}: report.` } } : { kind: "text", text: "PARENT_DONE" };
    }
    return { kind: "text", text: "OK" };
  });
  const { ctx } = booted;
  const install = (agentCtx: object, ref: Parameters<typeof installModelSelection>[1]) => installModelSelection(agentCtx as unknown as Context, ref);
  const router = await installRouter({
    conversation: () => installConversation({
      ctx: ctx as unknown as ConversationCtxLike, home, route: STUB, installModelSelection: install, log: () => {}, onClaimed: claimsOf(ctx),
    }),
    tasks: (held) => installTasks(ctx.webServer, {
      ctx: ctx as unknown as TasksCtxLike, root, route: STUB, installModelSelection: install, conversation: held,
      bots: rosterBots(home, () => listBots(bots, () => (ctx.get("agentPresets") as { list(): Promise<{ id: string; broken?: string }[]> }).list(), booted.botPresets.errors)),
      isTrusted: isTrustedDataRequest, log: () => {},
    }),
    log: () => {},
  });
  if (!("sessionId" in router)) {
    await booted.dispose();
    throw new Error("the conversation was not installed");
  }
  await router.tasks.ready;
  const base = `http://127.0.0.1:${ctx.webServer.port}`;
  mountClient(ctx);
  const cookie = await signIn(ctx, base);
  return { booted, conversation: router.conversation, tasks: router.tasks, sessionId: router.sessionId, base, cookie };
}

const held = (): Face => {
  assert.ok(face !== undefined, "the face is booted (the first test ran)");
  return face;
};
const conversationAgent = (f: Face) => f.booted.ctx.agents.get(SessionId(f.sessionId))!;
const workerOf = (f: Face) => f.booted.ctx.agents.list().find((a) => a.session.header.parentSession === f.sessionId);
/** Every memory tool in the tree's global view, once the row has connected. */
const rowConnected = (booted: BootedFace) => memoryNamesIn(toolsOf(booted).schemas().map((s) => s.name)).length === MEMORY_NAMES.length;

test("a worker and the conversation each hold the seven tools; the desk holds none", { skip, timeout: 180_000 }, async () => {
  await makeFixtures();
  memoryHome = join(await mkdtemp(join(tmpdir(), "face-memory-made-")), "home");
  made.push(dirname(memoryHome));
  assert.equal((await initHome(memoryHome)).created, true, "the package made the home");
  face = await withEnv({ FACE_MEMORY_HOME: memoryHome }, bootWithConversation);
  const f = face;
  assert.equal(process.env.FACE_MEMORY_HOME, TEST_MEMORY_HOME, "the environment is put back after the boot");
  const row = rowOf(f.booted);
  assert.equal(row?.disabled === false ? row.home : undefined, memoryHome, "the row the tree composed runs over the made home");
  await waitFor("the memory row's seven tools", () => rowConnected(f.booted));
  const tools = toolsOf(f.booted);

  /* the conversation: on its session, and in its first request */
  await remote(f.base, f.cookie, "session/prompt", {
    request: { requestId: `memory-${crypto.randomUUID()}`, sessionId: f.sessionId, mode: "queue", content: [{ type: "text", text: START }] },
  });
  const conversation = conversationAgent(f);
  assert.deepEqual(memoryNamesIn(tools.schemas(conversation).map((s) => s.name)), [...MEMORY_NAMES].sort(), "the conversation holds the seven, by name");
  await waitFor("the conversation's first request", () => firstRequests.has(f.sessionId));
  assert.deepEqual(memoryNamesIn((firstRequests.get(f.sessionId)!.tools ?? []).map((t) => t.name)), [...MEMORY_NAMES].sort(), "and offers them to the model");

  /* the worker the conversation's task_start opened */
  await waitFor("a worker under the conversation", () => workerOf(f) !== undefined);
  const worker = workerOf(f)!;
  assert.equal(worker.session.header.agentPreset, DEFAULT_PRESET);
  assert.deepEqual(memoryNamesIn(tools.schemas(worker).map((s) => s.name)), [...MEMORY_NAMES].sort(), "the worker holds the seven");
  await waitFor("the worker's first request", () => firstRequests.has(worker.id));
  assert.deepEqual(memoryNamesIn((firstRequests.get(worker.id)!.tools ?? []).map((t) => t.name)), [...MEMORY_NAMES].sort(), "and offers them to the model");

  /* a desk session, from the firings' create path */
  const deskDeps: DeskSessionDeps = {
    ctx: f.booted.ctx as unknown as DeskSessionDeps["ctx"], root, home, route: STUB,
    installModelSelection: (agentCtx, ref) => installModelSelection(agentCtx as unknown as Context, ref),
  };
  const desk = await createDeskAgent(deskDeps, { cwd: join(root, "desk", "journal") });
  f.desk = desk;
  assert.equal(desk.agent.session.header.agentPreset, "gravit-desk");
  assert.deepEqual(memoryNamesIn(tools.schemas(desk.agent).map((s) => s.name)), [], "the desk holds no memory tool");
});

test("memory_status answers through the row as gravit", { skip, timeout: 120_000 }, async () => {
  const f = held();
  const conversation = conversationAgent(f);
  const memory = openMemory(memoryHome);
  /* The status's own first line, as the package's texts.js `opening` writes it: the count of lessons, how many apply,
   * and each chain's file and whether it holds. A fresh home has no card, no partial ledger, and every chain holds. */
  const status = await memory.status();
  assert.deepEqual([status.cards.length, status.partial.length, status.chains.every((c) => c.ok)], [0, 0, true], "a fresh home");
  const opening = `0 lessons in all, 0 applying. Chains: ${status.chains.map((c) => `${c.file} holds`).join(", ")}.`;
  const answered = await callMemory(f.booted, conversation, "memory_status", {});
  assert.equal(answered.isError, false, answered.text);
  assert.equal(answered.text.split("\n")[0], opening, answered.text);

  const recorded = await callMemory(f.booted, conversation, "memory_record", FILLER);
  assert.equal(recorded.isError, false, recorded.text);
  assert.match(recorded.text, /^Registered decision d-\S+: pass, whose agent\.$/);
  const { items } = await memory.decisions();
  assert.equal(items.length, 1, "one decision in the home");
  assert.equal(items[0]!.view.line.by, "gravit", "written by the row's agent");
  assert.equal(items[0]!.view.line.thesis, FILLER.thesis);
});

test("the owner's name is written only from the conversation in the operator's turn", { skip, timeout: 120_000 }, async () => {
  const f = held();
  const conversation = conversationAgent(f);
  const worker = workerOf(f);
  assert.ok(worker !== undefined, "the worker from the first test");
  /* The fence as main.ts installs it, over the real conversation's held session; whose turn is running is a flag this
   * test sets, since no model runs offline and so no real turn opens. The look-up opens the memory as the row runs. */
  let operatorTurn = false;
  const handle = { current: () => f.conversation.current(), operatorTurn: () => operatorTurn };
  const lines: string[] = [];
  const dispose = installMemoryGuard({
    ctx: f.booted.ctx as unknown as MemoryGuardCtxLike, conversation: () => handle, open: memoryOpener(rowOf(f.booted)), log: (line) => { lines.push(line); },
  });
  try {
    const memory = openMemory(memoryHome);
    const all = async () => (await memory.decisions()).items.map((item) => item.view);
    const viewOf = async (id: string) => (await all()).find((view) => view.line.id === id);
    const before = (await all()).length;
    const decision = { action: "buy", thesis: "t", symbol: "NVDA", market: "US" };
    const idOf = (text: string): string => /^Registered decision (d-\d{8}-[0-9a-f]{8}):/.exec(text)?.[1] ?? assert.fail(text);

    /* 1. a worker, in the operator's turn: the owner's name is refused, and nothing lands */
    operatorTurn = true;
    const workerOwner = await callMemory(f.booted, worker, "memory_record", { ...decision, whose: "owner" });
    assert.equal(workerOwner.isError, true, workerOwner.text);
    assert.ok(workerOwner.text.includes(OWNER_NAME_REFUSED), workerOwner.text);
    assert.equal((await all()).length, before, "nothing registered");

    /* 2. the worker in its own name: registered */
    const workerOwn = await callMemory(f.booted, worker, "memory_record", { ...decision, whose: "agent" });
    assert.equal(workerOwn.isError, false, workerOwn.text);
    const own = idOf(workerOwn.text);
    assert.equal((await all()).length, before + 1);
    assert.equal((await viewOf(own))?.line.whose, "agent");

    /* 3. the conversation, out of the operator's turn: refused */
    operatorTurn = false;
    const outOfTurn = await callMemory(f.booted, conversation, "memory_record", { ...decision, whose: "owner" });
    assert.equal(outOfTurn.isError, true, outOfTurn.text);
    assert.ok(outOfTurn.text.includes(OWNER_NAME_REFUSED), outOfTurn.text);
    assert.equal((await all()).length, before + 1, "still one more");

    /* 4. the conversation, in the operator's turn: registered in the owner's name */
    operatorTurn = true;
    const inPlace = await callMemory(f.booted, conversation, "memory_record", { ...decision, whose: "owner" });
    assert.equal(inPlace.isError, false, inPlace.text);
    const OWNED = idOf(inPlace.text);
    assert.equal((await all()).length, before + 2);
    assert.equal((await viewOf(OWNED))?.line.whose, "owner");

    /* 5. the worker voids the owner's decision: refused after the look-up, and it stands */
    const voidOwned = await callMemory(f.booted, worker, "memory_amend", { decision: OWNED, what: "void", reason: "r" });
    assert.equal(voidOwned.isError, true, voidOwned.text);
    assert.ok(voidOwned.text.includes(ownerDecisionRefused(OWNED)), voidOwned.text);
    assert.equal((await viewOf(OWNED))?.void, false, "the owner's decision is not void");

    /* 5a. the worker's ref, its review in its own name and its correction on the owner's decision: each refused */
    const refOwned = await callMemory(f.booted, worker, "memory_amend", { decision: OWNED, what: "ref", ref: "o-1" });
    assert.equal(refOwned.isError, true, refOwned.text);
    assert.ok(refOwned.text.includes(ownerDecisionRefused(OWNED)), refOwned.text);
    const reviewOwned = await callMemory(f.booted, worker, "memory_amend", { decision: OWNED, what: "review", whose: "agent", thesis_held: "yes", wrong_if_hit: "no" });
    assert.equal(reviewOwned.isError, true, reviewOwned.text);
    assert.ok(reviewOwned.text.includes(ownerDecisionRefused(OWNED)), reviewOwned.text);
    assert.equal((await viewOf(OWNED))?.reviewed, false, "the owner's decision is not reviewed");
    const correctOwned = await callMemory(f.booted, worker, "memory_amend", { decision: OWNED, what: "correction", field: "thesis", value: "v" });
    assert.equal(correctOwned.isError, true, correctOwned.text);
    assert.ok(correctOwned.text.includes(ownerDecisionRefused(OWNED)), correctOwned.text);

    /* 5b. the worker's ref on its own decision: handed on, and registered */
    const refOwn = await callMemory(f.booted, worker, "memory_amend", { decision: own, what: "ref", ref: "o-1" });
    assert.equal(refOwn.isError, false, refOwn.text);
    assert.deepEqual((await viewOf(own))?.amends.map((a) => a.what), ["ref"]);

    /* 5c. the conversation, in the operator's turn, refs the owner's decision: registered */
    const refInPlace = await callMemory(f.booted, conversation, "memory_amend", { decision: OWNED, what: "ref", ref: "o-1" });
    assert.equal(refInPlace.isError, false, refInPlace.text);

    /* 6. the worker voids its own: handed on, and registered */
    const voidOwn = await callMemory(f.booted, worker, "memory_amend", { decision: own, what: "void", reason: "r" });
    assert.equal(voidOwn.isError, false, voidOwn.text);
    assert.equal((await viewOf(own))?.void, true, "the worker's own decision is void");

    /* 7. the conversation, in the operator's turn, closes the owner's decision */
    const close = await callMemory(f.booted, conversation, "memory_amend", { decision: OWNED, what: "close", closed_at: new Date().toISOString() });
    assert.equal(close.isError, false, close.text);
    assert.equal((await viewOf(OWNED))?.open, false, "the owner's decision is closed");
    assert.deepEqual((await viewOf(OWNED))?.amends.map((a) => a.what), ["ref", "close"], "only the conversation's amendments");

    /* one line per refusal, naming the caller and never an argument's text */
    assert.deepEqual(lines, [
      `memory: refused mcp__memory__memory_record (record) from session ${worker.id}: not the operator's turn in the conversation`,
      `memory: refused mcp__memory__memory_record (record) from session ${conversation.id}: not the operator's turn in the conversation`,
      `memory: refused mcp__memory__memory_amend (void) from session ${worker.id}: not the operator's turn in the conversation`,
      `memory: refused mcp__memory__memory_amend (ref) from session ${worker.id}: not the operator's turn in the conversation`,
      `memory: refused mcp__memory__memory_amend (review) from session ${worker.id}: not the operator's turn in the conversation`,
      `memory: refused mcp__memory__memory_amend (correction) from session ${worker.id}: not the operator's turn in the conversation`,
    ]);
  } finally {
    dispose();
  }
});

test("where the two sections reach", { skip, timeout: 120_000 }, async () => {
  const f = held();
  const conversation = conversationAgent(f);
  const worker = workerOf(f);
  assert.ok(worker !== undefined && f.desk !== undefined, "the worker and the desk from the first test");

  /* asserted: both sections reach the worker and the conversation; gravit:memory never reaches the desk */
  const conversationSections = await sectionsOf(f.booted, conversation);
  const workerSections = await sectionsOf(f.booted, worker);
  for (const [who, sections] of [["the conversation", conversationSections], ["a worker", workerSections]] as const) {
    assert.ok(sections.has(MCP_SECTION), `${who}'s prompt holds ${MCP_SECTION}: ${[...sections.keys()].join(", ")}`);
    assert.ok(sections.has(MEMORY_SECTION), `${who}'s prompt holds ${MEMORY_SECTION}: ${[...sections.keys()].join(", ")}`);
  }
  const deskSections = await sectionsOf(f.booted, f.desk.agent as unknown as Parameters<typeof assembleContextFor>[0]);
  assert.equal(deskSections.has(MEMORY_SECTION), false, `a desk session's prompt holds no ${MEMORY_SECTION}`);

  /* recorded, not asserted: mcp:memory in a desk session's, a bot's and a role child's prompt */
  const instructions = conversationSections.get(MCP_SECTION)!;
  const marker = instructions.split("\n")[0]!;
  const bot = await remote<{ sessionId: string }>(f.base, f.cookie, "session/create", { request: { cwd: join(bots, BOT, "journal"), agentPreset: BOT } });
  const botAgent = f.booted.ctx.agents.get(SessionId(bot.sessionId))!;
  assert.equal(botAgent.session.header.agentPreset, BOT);
  const botSections = await sectionsOf(f.booted, botAgent);
  const plain = await remote<{ sessionId: string }>(f.base, f.cookie, "session/create", { request: { cwd: root } });
  await remote(f.base, f.cookie, "session/prompt", {
    request: { requestId: `memory-${crypto.randomUUID()}`, sessionId: plain.sessionId, mode: "queue", content: [{ type: "text", text: RUN_ROLE }] },
  });
  const roleRequest = (): GenerateOptions | undefined => [...firstRequests.values()].find((r) => r.messages.some((m) => textOf(m).includes(ROLE_MARK)) && String(r.sessionId) !== plain.sessionId);
  await waitFor("the role child's first request", () => roleRequest() !== undefined);
  await f.booted.ctx.agents.get(SessionId(plain.sessionId))!.whenIdle();
  const roleSystem = textOf(roleRequest()!.messages[0]!);
  const measure = {
    desk: deskSections.has(MCP_SECTION),
    bot: botSections.has(MCP_SECTION),
    roleChild: roleSystem.includes(marker),
    roleChildGravitMemory: roleSystem.includes((await sectionsOf(f.booted, worker)).get(MEMORY_SECTION)!.split("\n")[0]!),
    botGravitMemory: botSections.has(MEMORY_SECTION),
  };
  console.error(`memory-smoke: measure: ${MCP_SECTION} in a desk session's prompt: ${measure.desk}; in a bot's: ${measure.bot}; in a role child's: ${measure.roleChild}`);
  console.error(`memory-smoke: measure: ${MEMORY_SECTION} in a bot's prompt: ${measure.botGravitMemory}; in a role child's: ${measure.roleChildGravitMemory}`);
  await stopFace();
});

test("a home nobody made: the boot is healthy and the tool says no memory here", { skip, timeout: 120_000 }, async () => {
  assert.ok(home !== "", "the fixtures from the first test");
  await stopFace();
  /* the environment as tests/helpers/no-memory.ts left it: a home under the temporary directory that nobody made */
  assert.equal(process.env.FACE_MEMORY_HOME, TEST_MEMORY_HOME);
  const booted = await bootBare(() => ({ kind: "text", text: "OK" }));
  try {
    const row = rowOf(booted);
    assert.equal(row?.disabled === false ? row.home : undefined, TEST_MEMORY_HOME, "the row runs over the home nobody made");
    await waitFor("the memory row's seven tools", () => rowConnected(booted));
    const base = `http://127.0.0.1:${booted.ctx.webServer.port}`;
    mountClient(booted.ctx);
    const cookie = await signIn(booted.ctx, base);
    const created = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: { cwd: root } });
    const agent = booted.ctx.agents.get(SessionId(created.sessionId))!;
    assert.deepEqual(memoryNamesIn(toolsOf(booted).schemas(agent).map((s) => s.name)), [...MEMORY_NAMES].sort());
    const answered = await callMemory(booted, agent, "memory_status", {});
    /* the door answers its sentence as an error; dsh's tool layer heads an error's text with `Error: ` */
    assert.equal(answered.isError, true);
    assert.equal(answered.text, `Error: ${NO_MEMORY_HERE}`);
    const standing = await memoryOpener(row)();
    assert.equal(standing.connected, true, "the install is there; only the home is not");
  } finally {
    await booted.dispose();
  }
});

test("an install that is not there: the boot is healthy", { skip, timeout: 120_000 }, async () => {
  assert.ok(home !== "", "the fixtures from the first test");
  const empty = await mkdtemp(join(tmpdir(), "face-memory-noinstall-"));
  made.push(empty);
  const booted = await withEnv({ FACE_MEMORY_DIR: empty }, () => bootBare(() => ({ kind: "text", text: "OK" })));
  try {
    assert.equal(process.env.FACE_MEMORY_DIR, undefined, "the environment is put back after the boot");
    const row = rowOf(booted);
    assert.deepEqual(row, { disabled: false, dir: empty, home: TEST_MEMORY_HOME }, "the row names the empty install");
    const base = `http://127.0.0.1:${booted.ctx.webServer.port}`;
    mountClient(booted.ctx);
    const cookie = await signIn(booted.ctx, base);
    const created = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: { cwd: root } });
    const agent = booted.ctx.agents.get(SessionId(created.sessionId))!;
    await booted.ctx.systemPrompt.assemble(assembleContextFor(agent));
    await waitFor("the memory row's first attempt to settle", () => rowSettled(booted));
    assert.deepEqual(memoryNamesIn(toolsOf(booted).schemas().map((s) => s.name)), [], "the row has no tools");
    assert.deepEqual(memoryNamesIn(toolsOf(booted).schemas(agent).map((s) => s.name)), [], "and a session holds none");
    const standing = await memoryOpener(row)();
    assert.deepEqual(standing, { connected: false, why: "no install", say: "the memory is not connected: gravit-memory is not installed" });
  } finally {
    await booted.dispose();
  }
});

test("a row an operator's patch disabled: no memory tool, no gravit:memory, the disabled standing", { skip, timeout: 180_000 }, async () => {
  assert.ok(home !== "", "the fixtures from the first test");
  await stopFace();
  /* the operator's own patch file, as an operator disables the row; put back after the boot */
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8");
  writeFileSync(patchPath, `${patch}\n- id: ${MEMORY_ROW_ID}\n  disabled: true\n`);
  try {
    face = await bootWithConversation();
  } finally {
    writeFileSync(patchPath, patch);
  }
  const f = face;
  try {
    assert.deepEqual(rowOf(f.booted), { disabled: true }, "the row as the tree composed it");
    assert.deepEqual(memoryNamesIn(toolsOf(f.booted).schemas().map((s) => s.name)), [], "no memory tool in the tree");

    /* the conversation (found again from the first boot's ledger): no memory tool on its session or in this boot's
     * first request, and no gravit:memory */
    firstRequests.delete(f.sessionId);
    await remote(f.base, f.cookie, "session/prompt", {
      request: { requestId: `memory-${crypto.randomUUID()}`, sessionId: f.sessionId, mode: "queue", content: [{ type: "text", text: "OK?" }] },
    });
    const conversation = conversationAgent(f);
    assert.deepEqual(memoryNamesIn(toolsOf(f.booted).schemas(conversation).map((s) => s.name)), [], "the conversation holds none");
    await waitFor("the conversation's first request", () => firstRequests.has(f.sessionId));
    assert.deepEqual(memoryNamesIn((firstRequests.get(f.sessionId)!.tools ?? []).map((t) => t.name)), [], "and offers none to the model");
    const sections = await sectionsOf(f.booted, conversation);
    assert.equal(sections.has(MEMORY_SECTION), false, `the conversation's prompt holds no ${MEMORY_SECTION}: ${[...sections.keys()].join(", ")}`);

    /* a plain Gravit session: none either */
    const plain = await remote<{ sessionId: string }>(f.base, f.cookie, "session/create", { request: { cwd: root } });
    const plainAgent = f.booted.ctx.agents.get(SessionId(plain.sessionId))!;
    assert.deepEqual(memoryNamesIn(toolsOf(f.booted).schemas(plainAgent).map((s) => s.name)), [], "a Gravit session holds none");
    const plainSections = await sectionsOf(f.booted, plainAgent);
    assert.equal(plainSections.has(MEMORY_SECTION), false, `a Gravit session's prompt holds no ${MEMORY_SECTION}`);

    /* the face's own standing over the row */
    assert.deepEqual(await memoryOpener(rowOf(f.booted))(), {
      connected: false, why: "disabled", say: "the memory is not connected: the mcp-memory row is disabled",
    });

    /* recorded, not asserted: mcp:memory in a prompt with the row disabled */
    console.error(`memory-smoke: measure: with the row disabled, ${MCP_SECTION} in the conversation's prompt: ${sections.has(MCP_SECTION)}; in a Gravit session's: ${plainSections.has(MCP_SECTION)}`);
  } finally {
    await stopFace();
  }
});
