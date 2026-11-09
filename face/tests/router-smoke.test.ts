// face/tests/router-smoke.test.ts
/** The conversation and a task on a REAL composed tree (one entry, plan 1, task 8; spec
 * docs/superpowers/specs/2026-11-08-one-entry-router-design.md): the face's boot opens the conversation on
 * `gravit-router` in `<home>/face/conversation`, as main.ts does (src/tasks.ts `installRouter` over
 * src/conversation.ts `installConversation` and src/tasks.ts `installTasks`); an operator prompt over the browser's
 * Remote wire has the stubbed model call `task_start`; the worker runs on `gravit` in `strategies/fx`, under the
 * conversation, from its `task-brief:<worker>` message; its `task_report` ready reaches the conversation as one
 * `[task · …]` message, in whose turn a `task_start` is refused (`OPERATOR_ONLY`); and a second boot on the same home
 * resumes the same conversation, the relay not sent again.
 *
 * WHERE IT RUNS. Two `mkdtemp` directories under the system's temp directory, as tests/subagents-smoke.test.ts's are:
 * the harness home (and so the conversation's folder, whose fence refuses every turn under a `.git` - tests/tmp sits
 * inside this checkout) and the repository root the tasks read, with a `.git` of its own (as the real checkout has)
 * and `strategies/fx`. The bots root is tests/bots-fixture.ts's `makeBotsRoot`. All three are removed in `after`.
 *
 * WHAT STANDS IN. The model is the shared stub on `stub/echo` (the profile's default route and the conversation's and
 * workers' route), scripted per session by its header: the conversation (`gravit-router`) and the worker
 * (`parentSession` = the conversation). AKShare and the Account seat are off.
 *
 * ONE FILE, THREE BOOTS. The four tests share one boot, in order; the fourth disposes it and boots again on the same home,
 * as tests/subagents-smoke.test.ts does (a second boot in one process, `dshHome` passed both times). The fifth boots
 * once more with the desk and its phone bridge as main.ts installs them (one-entry plan 3): a text from a fake account
 * (tests/fake-phone-account.ts) reaches the conversation, and its answer reaches the account's send as `chat`.
 *
 * Own file, gated: FACE_SMOKE=1.
 * @module
 */
import "./helpers/no-market.ts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { bootFace, type BootedFace } from "../src/boot.ts";
import { conversationDir, installConversation, type ConversationCtxLike, type ConversationHandle } from "../src/conversation.ts";
import { installDesk, readEvents, type DeskHandle } from "../src/desk.ts";
import type { DeskConversationCtxLike } from "../src/desk-conversation.ts";
import { CONVERSATION_PRESET } from "../src/desk-names.ts";
import { isTrustedDataRequest } from "../src/http.ts";
import { DEFAULT_PRESET } from "../src/overlay.ts";
import { setupFaceProfile } from "../src/setup.ts";
import { OPERATOR_ONLY } from "../src/task-tools.ts";
import { createPhoneClient } from "../src/phone.ts";
import { installRouter, installTasks, phoneConversation, type TasksCtxLike, type TasksHandle } from "../src/tasks.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { fakePhoneAccount, type FakePhoneAccount } from "./fake-phone-account.ts";
import { mountClient, remote, signIn } from "./remote.ts";
import { StubAdapter, type StubReply } from "./stub-llm.ts";

const gated = process.env.FACE_SMOKE !== "1";
const skip = gated && "set FACE_SMOKE=1";
const STUB = { provider: "stub", model: "echo" };
/** The operator's prompt that has the conversation start a task. */
const START = "START_TASK_FX";
const TITLE = "FX probe";
const BRIEF = "BRIEF_FX: read the fixture strategy and report.";
/** What the worker reports. */
const REPORT = "REPORT_FX: the fixture strategy holds nothing yet.";
/** How the conversation answers a phone text. */
const PHONE_HEARD = "PHONE_HEARD";

type Message = GenerateOptions["messages"][number];
type Ev = { type: string; data?: unknown };
const sourceOf = (m: { source?: unknown }): { kind?: unknown; form?: unknown; status?: unknown } =>
  (m.source ?? {}) as { kind?: unknown; form?: unknown; status?: unknown };
const textOf = (m: Message): string => m.content.map((b) => ("text" in b ? b.text : "")).join("\n");

/** The last message a person or the task machinery sent in a request, and how many tool results came after it. */
function trigger(r: GenerateOptions): { message?: Message; results: number } {
  for (let i = r.messages.length - 1; i >= 0; i--) {
    const kind = sourceOf(r.messages[i]!).kind;
    if (kind === "user" || kind === "task" || kind === "telegram") {
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

/** The face as this file holds it: the tree, the conversation and the tasks, and the browser's session. */
interface Face {
  booted: BootedFace;
  conversation: ConversationHandle;
  tasks: TasksHandle;
  sessionId: string;
  base: string;
  cookie: string;
  lines: string[];
  desk?: DeskHandle;
}

const made: string[] = [];
let home = "";
let root = "";
let bots = "";
let face: Face | undefined;

async function stopFace(): Promise<void> {
  const held = face;
  face = undefined;
  if (held === undefined) return;
  await held.tasks.dispose();
  await held.conversation.dispose();
  await held.desk?.dispose(0);
  await held.booted.dispose();
}

after(async () => {
  await stopFace();
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Boot the face on {@link home} and install the conversation and its tasks as main.ts does, on the stub route. */
async function boot(phone?: FakePhoneAccount): Promise<Face> {
  const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: bots });
  const { ctx } = booted;
  const script = (r: GenerateOptions): StubReply => {
    if (r.purpose !== undefined) return { kind: "text", text: "router smoke" }; // titles, compaction
    const header = ctx.sessions.get(r.sessionId!)?.header;
    const { message, results } = trigger(r);
    const kind = message === undefined ? undefined : sourceOf(message).kind;
    if (header?.agentPreset === CONVERSATION_PRESET) {
      if (kind === "user" && textOf(message!).includes(START)) {
        return results === 0 ? { kind: "tool", name: "task_start", args: { title: TITLE, brief: BRIEF, strategy: "fx" } } : { kind: "text", text: "STARTED" };
      }
      if (kind === "telegram") return { kind: "text", text: `${PHONE_HEARD}: ${textOf(message!).split("\n").at(-1)}` };
      if (kind === "task") {
        /* a relay's turn is not the operator's: this start must be refused */
        return results === 0 ? { kind: "tool", name: "task_start", args: { title: "From a relay", brief: "must not start", strategy: "fx" } } : { kind: "text", text: "RELAYED" };
      }
      return { kind: "text", text: "OK" };
    }
    if (header?.parentSession !== undefined && kind === "task") {
      return results === 0 ? { kind: "tool", name: "task_report", args: { status: "ready", text: REPORT } } : { kind: "text", text: "WORKER_DONE" };
    }
    return { kind: "text", text: "OK" };
  };
  ctx.llm.registerAdapter([STUB.provider], new StubAdapter(script));
  const lines: string[] = [];
  const log = (line: string): void => { lines.push(line); console.error(line); };
  const install = (agentCtx: object, ref: Parameters<typeof installModelSelection>[1]) => installModelSelection(agentCtx as unknown as Context, ref);
  /* with a phone: the desk as main.ts installs it, before the conversation, its bridge waiting for the bind */
  const desk = phone === undefined ? undefined : installDesk(ctx.webServer, {
    home, enabled: true, root, route: STUB, sessionCtx: ctx as unknown as DeskConversationCtxLike, installModelSelection: install,
    phone: createPhoneClient({ url: phone.url, secrets: [] }), router: true, log,
  });
  const deskConversation = desk?.conversation;
  const router = await installRouter({
    conversation: () => installConversation({
      ctx: ctx as unknown as ConversationCtxLike, home, route: STUB, installModelSelection: install, log,
      ...(deskConversation === undefined ? {} : { deliver: (text, opts) => deskConversation.deliver(text, opts) }),
    }),
    tasks: (held) => installTasks(ctx.webServer, {
      ctx: ctx as unknown as TasksCtxLike, root, route: STUB, installModelSelection: install, conversation: held,
      isTrusted: isTrustedDataRequest, log,
    }),
    log,
  });
  desk?.bindRouter("sessionId" in router ? phoneConversation(router.conversation, router.tasks.ops) : undefined);
  if (!("sessionId" in router)) {
    await desk?.dispose(1);
    await booted.dispose();
    throw new Error(`the conversation was not installed: ${lines.join(" | ")}`);
  }
  await router.tasks.ready;
  const base = `http://127.0.0.1:${ctx.webServer.port}`;
  mountClient(ctx);
  const cookie = await signIn(ctx, base);
  return { booted, conversation: router.conversation, tasks: router.tasks, sessionId: router.sessionId, base, cookie, lines, ...(desk === undefined ? {} : { desk }) };
}

const held = (): Face => {
  assert.ok(face !== undefined, "the face is booted (the first test ran)");
  return face;
};
const convEvents = (f: Face): readonly Ev[] => f.booted.ctx.agents.get(SessionId(f.sessionId))!.session.snapshotEvents() as readonly Ev[];
/** The `[task · …]` relay messages the conversation's log holds. */
const relaysIn = (events: readonly Ev[]) => events.filter((e) => e.type === "user/message"
  && sourceOf((e.data ?? {}) as { source?: unknown }).kind === "task"
  && sourceOf((e.data ?? {}) as { source?: unknown }).form === "report");
const eventText = (e: Ev): string => {
  const content = (e.data as { content?: { text?: string }[] } | undefined)?.content ?? [];
  return content.map((b) => b.text ?? "").join("\n");
};
/** The conversation's workers live now. */
const workers = (f: Face) => f.booted.ctx.agents.list().filter((a) => a.session.header.parentSession === f.sessionId);

test("a boot opens the conversation on gravit-router in <home>/face/conversation, and session/list shows it", { skip, timeout: 120_000 }, async () => {
  home = await mkdtemp(join(tmpdir(), "face-router-home-"));
  made.push(home);
  const rawRoot = await mkdtemp(join(tmpdir(), "face-router-root-"));
  made.push(rawRoot);
  root = await realpath(rawRoot);
  bots = await makeBotsRoot();
  made.push(bots);
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "strategies", "fx"), { recursive: true });
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  // This smoke owns a scratch profile: never the operator's data server or Account, never a real model.
  writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n` +
    `- id: agent-default-model\n  config:\n    provider: ${STUB.provider}\n    model: ${STUB.model}\n`);

  face = await boot();
  const agent = face.booted.ctx.agents.get(SessionId(face.sessionId));
  assert.ok(agent !== undefined, "the conversation is live");
  assert.equal(agent.session.header.agentPreset, CONVERSATION_PRESET);
  assert.equal(agent.session.header.cwd, conversationDir(home));
  assert.equal(face.booted.ctx.permissionPresets.current(agent.session), "workspace-write");
  const ledger = (await readEvents(home)).events.filter((e) => e.kind === "conversation");
  assert.deepEqual(ledger.map((e) => ({ kind: e.kind, sessionId: (e as { sessionId: string }).sessionId, reason: (e as { reason: string }).reason })),
    [{ kind: "conversation", sessionId: face.sessionId, reason: "created" }]);
  const listed = await remote<{ items: { sessionId: string }[] }>(face.base, face.cookie, "session/list", { _request: {} });
  assert.ok(listed.items.some((item) => item.sessionId === face!.sessionId), "session/list shows the conversation");
});

test("an operator prompt over the browser RPC has the stub call task_start; a worker exists on gravit in strategies/fx, naming the conversation as parentSession, its first message task-brief", { skip, timeout: 120_000 }, async () => {
  const f = held();
  await remote(f.base, f.cookie, "session/prompt", {
    request: { requestId: `router-${crypto.randomUUID()}`, sessionId: f.sessionId, mode: "queue", content: [{ type: "text", text: START }] },
  });
  await waitFor("a worker under the conversation", () => workers(f).length > 0);
  const [worker] = workers(f);
  assert.equal(workers(f).length, 1, "one worker");
  assert.equal(worker!.session.header.agentPreset, DEFAULT_PRESET);
  assert.equal(worker!.session.header.cwd, join(root, "strategies", "fx"));
  assert.equal(worker!.session.header.parentSession, f.sessionId);
  assert.equal(worker!.session.header.origin, undefined, "a runtime root, not a subagent");
  await waitFor("the worker's brief in its log", () => worker!.session.snapshotEvents().some((e) => e.type === "user/message"));
  const first = (worker!.session.snapshotEvents() as readonly Ev[]).find((e) => e.type === "user/message")!;
  assert.equal((first.data as { id?: string }).id, `task-brief:${worker!.id}`);
  assert.ok(eventText(first).includes(BRIEF), "the brief is the worker's first message");
  /* the start's tool result in the conversation: the worker's id, not an error */
  await waitFor("the conversation's task_start result", () => convEvents(f).some((e) => e.type === "tool/result"));
  const result = convEvents(f).find((e) => e.type === "tool/result")!.data as { message: { isError?: boolean; content: { text?: string }[] } };
  assert.notEqual(result.message.isError, true, result.message.content.map((b) => b.text).join("\n"));
  assert.ok(result.message.content.some((b) => b.text?.includes(worker!.id)), "task_start answers the worker's id");
});

test("the worker's stub calls task_report ready; the conversation gets one [task · …] message, and in that turn the stub's task_start is refused with OPERATOR_ONLY", { skip, timeout: 120_000 }, async () => {
  const f = held();
  const [worker] = workers(f);
  assert.ok(worker !== undefined, "the worker from the test before");
  await waitFor("the relay in the conversation", () => relaysIn(convEvents(f)).length > 0, 60_000);
  const relays = relaysIn(convEvents(f));
  assert.equal(relays.length, 1, "one relay");
  const relay = relays[0]!;
  const text = eventText(relay);
  const lines = text.split("\n");
  assert.equal(lines[0], `[task · ${TITLE} · ready]`);
  assert.match(lines[1] ?? "", /^<<<task-data [0-9a-f]+>>>$/);
  assert.ok(text.includes(REPORT), "the report's text is quoted in the relay");
  assert.match(lines[lines.length - 1] ?? "", /^<<<end [0-9a-f]+>>>$/);
  assert.ok(String((relay.data as { id?: string }).id).startsWith(`task-report:${worker!.id}:`), "the relay's id names the worker");
  assert.equal(sourceOf((relay.data ?? {}) as { source?: unknown }).status, "ready");

  /* the relay's turn: its task_start is refused before it reaches the tasks */
  const refusal = (): { isError?: boolean; text: string } | undefined => {
    const events = convEvents(f);
    const at = events.indexOf(relay);
    const found = events.slice(at + 1).find((e) => e.type === "tool/result");
    if (found === undefined) return undefined;
    const message = (found.data as { message: { isError?: boolean; content: { text?: string }[] } }).message;
    return { isError: message.isError, text: message.content.map((b) => b.text ?? "").join("\n") };
  };
  await waitFor("the relay turn's task_start result", () => refusal() !== undefined);
  const refused = refusal()!;
  assert.equal(refused.isError, true);
  assert.ok(refused.text.includes(OPERATOR_ONLY), refused.text);
  await waitFor("the conversation idle", () => f.booted.ctx.agents.get(SessionId(f.sessionId))!.status === "idle");
  assert.equal(workers(f).length, 1, "no second worker");
  const listed = await f.tasks.ops.list();
  assert.deepEqual(listed.map((t) => ({ id: t.id, state: t.state })), [{ id: worker!.id, state: "done" }]);
});

test("a second boot on the same home resumes the same conversation", { skip, timeout: 120_000 }, async () => {
  const before = held();
  const sessionId = before.sessionId;
  const [worker] = workers(before);
  assert.ok(worker !== undefined, "the worker from the tests before");
  await stopFace();

  face = await boot();
  const f = face;
  assert.equal(f.sessionId, sessionId, "the same conversation");
  const agent = f.booted.ctx.agents.get(SessionId(sessionId));
  assert.ok(agent !== undefined, "resumed live");
  assert.equal(agent.session.header.agentPreset, CONVERSATION_PRESET);
  assert.equal(agent.session.header.cwd, conversationDir(home));
  assert.equal(f.booted.ctx.permissionPresets.current(agent.session), "workspace-write");
  const ledger = (await readEvents(home)).events.filter((e) => e.kind === "conversation");
  assert.equal(ledger.length, 1, "no second conversation recorded");
  const listed = await remote<{ items: { sessionId: string }[] }>(f.base, f.cookie, "session/list", { _request: {} });
  assert.ok(listed.items.some((item) => item.sessionId === sessionId), "session/list shows it");
  /* the boot's recovery re-offers the worker's report; the relay already in the log is not sent again */
  await f.booted.ctx.agents.get(SessionId(sessionId))!.whenIdle();
  assert.equal(relaysIn(convEvents(f)).length, 1, "the relay is not sent twice");
  const tasks = await f.tasks.ops.list();
  assert.deepEqual(tasks.map((t) => ({ id: t.id, state: t.state })), [{ id: worker!.id, state: "done" }]);
});

test("with the desk's phone bridge bound, a fake phone text reaches the conversation and its answer reaches the account's send", { skip, timeout: 120_000 }, async () => {
  const before = held();
  const sessionId = before.sessionId;
  await stopFace();
  const account = await fakePhoneAccount();
  try {
    face = await boot(account);
    const f = face;
    assert.equal(f.sessionId, sessionId, "the same conversation");
    account.push({ network: "telegram", messageId: "telegram:4242", text: "PHONE_PING", at: new Date().toISOString() });
    await waitFor("the answer at the account's send", () => account.sends.some((s) => String(s.text).startsWith(PHONE_HEARD)), 60_000);
    const answers = account.sends.filter((s) => String(s.text).startsWith(PHONE_HEARD));
    assert.deepEqual(answers, [{ kind: "chat", network: "telegram", text: `${PHONE_HEARD}: PHONE_PING` }], "one chat answer, to telegram");
    const phoneTexts = convEvents(f).filter((e) => e.type === "user/message" && sourceOf((e.data ?? {}) as { source?: unknown }).kind === "telegram");
    assert.equal(phoneTexts.length, 1, "the text is in the conversation's log");
    assert.ok(eventText(phoneTexts[0]!).includes("PHONE_PING"));
    const kinds = (await readEvents(home)).events.map((e) => e.kind);
    assert.equal(kinds.includes("desk-session"), false, "no desk session was opened");
    assert.equal(kinds.includes("desk-turn"), false, "and no desk turn recorded");
  } finally {
    await stopFace();
    await account.close();
  }
});
