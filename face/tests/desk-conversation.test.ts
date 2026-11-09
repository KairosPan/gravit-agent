// face/tests/desk-conversation.test.ts
/** The desk conversation (src/desk-conversation.ts): the one owner of the desk session - the pause, the
 * budget, the fence and the ensure before a turn opens, the provenance line on the message, the supervision
 * of every turn, the ledger record at each turn's end and the delivery through `deliver`, the switch to a
 * renewed session, stop and dispose. Offline: the real ensure (src/desk-session.ts) over a fake root slice, a
 * fake bus, a manual clock and a recording outlet. Repositories and homes sit INSIDE the repository, under
 * tests/tmp/<pid>/, as src/desk-session.ts's own tests keep theirs, and are removed afterwards. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fsp, { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileLock } from "@deepseek-ai/dsh-atomic-write";
import { installConversation } from "../src/conversation.ts";
import { DESK_PATH, readDesk } from "../src/cycle.ts";
import { OFF_FILE, appendEvent, clearOff, deskDir, readEvents, readOffState, writeOff, type BudgetState, type DeskEvent } from "../src/desk.ts";
import {
  createDeskConversation, type DeskConversation, type DeskConversationDeps, type DeskOutlet, type PostResult,
} from "../src/desk-conversation.ts";
import type { CreateDeskAgentOptions, DeskClock, DeskSessionCtxLike, SessionEventsOn } from "../src/desk-session.ts";
import type { AgentCtxLike, AgentLike, ModelSelectionRefLike, ResumeMemberOptions, SessionLike } from "../src/room.ts";
import type { EventLike, MessageLike } from "../src/room-rules.ts";
import { InboxModel, type InboxLike } from "./inbox-fake.ts";
import { FakeClock } from "./room-fake.ts";

/* ---------- fixtures, inside the repository ---------- */

const TMP = join(dirname(fileURLToPath(import.meta.url)), "tmp", String(process.pid));
let made = 0;
/** A fresh directory under tests/tmp/<pid>/. */
async function fixture(label: string): Promise<string> {
  const dir = join(TMP, `${++made}-${label}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
after(() => rm(TMP, { recursive: true, force: true }));

/** Make `rel` under `dir`: a directory when it ends in "/", else a file, its parents made first. */
async function put(dir: string, rel: string): Promise<void> {
  const path = join(dir, rel);
  if (rel.endsWith("/")) {
    await mkdir(path, { recursive: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "x\n");
}

/** Poll until `ok` holds - the ledger and the outlet settle on real file I/O, which no fake clock drives. */
async function waitFor(what: string, ok: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 2));
  }
}

/* ---------- the fakes ---------- */

/** A desk agent as the conversation drives it: what it was sent, how it was cancelled, and a status the
 * test sets. `whenIdle` is dsh-agent's: it resolves once the agent's driver retires ({@link settle}).
 * `maintaining` is dsh's maintenance with a followup latched behind it: the status reads `idle`, but
 * `whenIdle` waits. With `model` (the tree's `inboxes`), it has dsh's inbox and wake too (tests/inbox-fake.ts):
 * what it is sent queues there, and a cancel clears it or keeps it as dsh's does. */
class FakeDeskAgent implements AgentLike {
  status: "idle" | "running" = "idle";
  maintaining = false;
  readonly followups: MessageLike[] = [];
  readonly injects: MessageLike[] = [];
  /** What the conversation called, in order: `inject` and `followup`. */
  readonly calls: string[] = [];
  readonly cancels: unknown[][] = [];
  /** dsh-agent's `inject`, which the structural {@link AgentLike} leaves out; a test deletes it for an agent without one. */
  inject?: (message: MessageLike) => void = (message) => {
    this.calls.push("inject");
    this.injects.push(message);
  };
  failFollowup: string | undefined;
  model: InboxModel | undefined;
  private readonly idle: (() => void)[] = [];
  readonly session: SessionLike;
  constructor(readonly id: string, header: SessionLike["header"]) {
    this.session = { id, header, seq: 0, snapshotEvents: () => [], append: () => undefined };
  }
  /** dsh-agent's `Agent.inbox`, when the agent has the model's. */
  get inbox(): InboxLike | undefined { return this.model?.inbox; }
  followup(message: MessageLike): void {
    if (this.failFollowup !== undefined) throw new Error(this.failFollowup);
    this.calls.push("followup");
    this.followups.push(message);
    this.model?.send(message);
  }
  cancel(...args: unknown[]): void {
    this.cancels.push(args);
    this.model?.cancel(args[1] as { keepInbox?: boolean } | undefined);
  }
  whenIdle(): Promise<void> {
    if (this.status !== "running" && !this.maintaining) return Promise.resolve();
    return new Promise((done) => { this.idle.push(done); });
  }
  /** The driver retires: idle, and every `whenIdle` waiter released. */
  settle(): void {
    this.status = "idle";
    this.maintaining = false;
    for (const done of this.idle.splice(0)) done();
  }
  /** The text of the `n`th message the conversation sent. */
  text(n: number): string | undefined { return this.followups[n]?.content[0]?.text; }
}

/** The slice of a booted root the real ensure reads, as tests/desk-session.test.ts fakes it: a session's
 * header (what creation's `meta` said) and its permission preset (setup's pin, else "read-only") are
 * durable facts, and a resume finds both as they were. */
class FakeDeskTree {
  readonly live = new Map<string, FakeDeskAgent>();
  readonly stored = new Map<string, string>();
  readonly headers = new Map<string, SessionLike["header"]>();
  readonly created: CreateDeskAgentOptions[] = [];
  readonly resumed: ResumeMemberOptions[] = [];
  /** Every agent ever made, in order. */
  readonly agents: FakeDeskAgent[] = [];
  failCreate: string | undefined;
  /** When set, a create waits for it: a test can land something while an ensure is under way. */
  gate: Promise<void> | undefined;
  /** When set, every agent made has dsh's inbox and wake ({@link FakeDeskAgent.model}). */
  inboxes = false;
  /** Each session's durable log as dsh-session-persistence reads it back; a test fills it. */
  readonly logs = new Map<string, EventLike[]>();
  /** What was asked of the persistence, in order: `open <id> <access>`, `read <offset>`, `close` and `flush`. */
  readonly persisted: string[] = [];
  /** When set, `flush` waits for it. */
  flushGate: Promise<void> | undefined;
  /** What a resume finds waiting on a session's next-turn list, as dsh rebuilds it from the inbox's durable splices: a
   * resumed agent with an inbox starts with these pending. */
  readonly rebuilt = new Map<string, MessageLike[]>();

  readonly install = (_agentCtx: AgentCtxLike, _ref: ModelSelectionRefLike): (() => void) => () => {};

  private async make(id: string, setup: (agentCtx: AgentCtxLike, agent: AgentLike) => Promise<void>): Promise<FakeDeskAgent> {
    const agent = new FakeDeskAgent(id, this.headers.get(id) ?? {});
    if (this.inboxes) agent.model = new InboxModel();
    await setup({}, agent);
    this.live.set(id, agent);
    this.agents.push(agent);
    return agent;
  }

  readonly ctx: DeskSessionCtxLike = {
    agents: {
      get: (id) => this.live.get(id),
      create: async (options) => {
        this.created.push(options);
        await new Promise((done) => setImmediate(done)); // a real create yields: two at once interleave
        if (this.gate !== undefined) await this.gate;
        if (this.failCreate !== undefined) throw new Error(this.failCreate);
        this.headers.set(options.sessionId, { cwd: options.meta.cwd, agentPreset: options.meta.agentPreset });
        const agent = await this.make(options.sessionId, options.setup);
        if (!this.stored.has(options.sessionId)) this.stored.set(options.sessionId, "read-only");
        return { agent, dispose: async () => { this.live.delete(options.sessionId); } };
      },
      resume: async (options) => {
        this.resumed.push(options);
        if (!this.stored.has(options.resumeSessionId)) throw new Error(`session "${options.resumeSessionId}" not found`);
        const agent = await this.make(options.resumeSessionId, options.setup);
        agent.model?.pending.push(...(this.rebuilt.get(options.resumeSessionId) ?? []));
        return { agent, dispose: async () => { this.live.delete(options.resumeSessionId); } };
      },
    },
    agentPresets: { mount: async (_agentCtx, id) => ({ id }) },
    permissionPresets: {
      set: (session, name) => { this.stored.set(session.id, name); },
      current: (session) => this.stored.get(session.id) ?? "read-only",
    },
    sessionPersistence: {
      open: async (id, access) => {
        this.persisted.push(`open ${id} ${access}`);
        const log = this.logs.get(id) ?? [];
        return {
          read: async (offset = 0, length = log.length) => {
            this.persisted.push(`read ${offset}`);
            return { events: log.slice(offset, offset + length) };
          },
          [Symbol.asyncDispose]: async () => { this.persisted.push("close"); },
        };
      },
      flush: async () => {
        this.persisted.push("flush");
        if (this.flushGate !== undefined) await this.flushGate;
      },
    },
  };

  /** The one agent the tree holds for `id`, live or not, newest first. */
  agent(id: string): FakeDeskAgent {
    const agent = [...this.agents].reverse().find((a) => a.id === id);
    if (agent === undefined) throw new Error(`no agent ${id}`);
    return agent;
  }
}

/** The root bus: every listener sees every session's events, as dsh's `session/event` does. */
function fakeBus(): { on: SessionEventsOn; emit(sessionId: string, type: string, data?: unknown): void; listeners: Set<unknown> } {
  const listeners = new Set<(session: { id: string }, event: EventLike) => void>();
  let seq = 0;
  return {
    listeners,
    on: (_name, listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(sessionId, type, data) {
      const event = { type, seq: seq++, data };
      for (const listener of [...listeners]) listener({ id: sessionId }, event);
    },
  };
}

/** 14:03 ET on 2026-10-20. */
const AT = Date.parse("2026-10-20T18:03:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

/** A manual clock that reads {@link AT} until advanced. */
function deskClock(): { clock: DeskClock; fake: FakeClock } {
  const fake = new FakeClock();
  const base = AT - fake.now();
  return { fake, clock: { now: () => base + fake.now(), setTimeout: (fn, ms) => fake.setTimeout(fn, ms), clearTimeout: (h) => fake.clearTimeout(h) } };
}

/** An outlet that records what it was asked to send; `fail` makes every send reject, `throws` throw, and
 * `never` never settle. */
function recordingOutlet(mode: "ok" | "fail" | "throws" | "never" = "ok"): DeskOutlet & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send(text) {
      sent.push(text);
      if (mode === "throws") throw new Error("the bridge fell over");
      if (mode === "fail") return Promise.reject(new Error("telegram is down"));
      if (mode === "never") return new Promise(() => {});
      return Promise.resolve({ sent: [`telegram:${sent.length}`] });
    },
  };
}

const ROUTE = { provider: "deepseek-official", model: "deepseek-flash" };

interface Harness {
  root: string;
  home: string;
  tree: FakeDeskTree;
  bus: ReturnType<typeof fakeBus>;
  time: ReturnType<typeof deskClock>;
  lines: string[];
  desk: DeskConversation;
}

async function harness(over: Partial<DeskConversationDeps> = {}, opts: { home?: string } = {}): Promise<Harness> {
  const root = await fixture("repo");
  const home = opts.home ?? (await fixture("home"));
  const tree = new FakeDeskTree();
  const bus = fakeBus();
  const time = deskClock();
  const lines: string[] = [];
  const log = (line: string): void => { lines.push(line); };
  const desk = createDeskConversation({
    session: { ctx: tree.ctx, root, home, route: ROUTE, installModelSelection: tree.install, now: () => time.clock.now(), log },
    on: bus.on,
    clock: time.clock,
    log,
    ...over,
  });
  return { root, home, tree, bus, time, lines, desk };
}

/* ---------- messages and turns ---------- */

const PHONE = { kind: "telegram", from: 42, chat: 42, messageId: 7 };
/** A phone text as this face's bridge records it (plan B2): the network it came through, and its id there. */
const PHONE_TG = { kind: "telegram", network: "telegram", messageId: "telegram:7" };
const PHONE_SLACK = { kind: "telegram", network: "slack", messageId: "slack:1730812345.001200" };
const say = (text: string): { type: "text"; text: string }[] => [{ type: "text", text }];
let ids = 0;
/** A user message as the loop logs it on `user/message`. */
const userMessage = (source: Record<string, unknown>, text = "x") => ({ id: `m-${++ids}`, role: "user", content: say(text), source });
const BROWSER = { kind: "user", rpcId: "rpc-1" };
const ALERT = { kind: "alert", alert: "a-0001", symbol: "NVDA" };
/** dsh-tool-jobs' wake (lib 276-281): the supervisor names it `wake`. */
const JOB = { kind: "tool-jobs", form: "notice", summary: "job-1 finished" };

/** The usage the stub reports per call, and what one such attempt records. */
const USAGE = { inputTokens: 1200, outputTokens: 34, cacheReadTokens: 1000, cacheWriteTokens: 0, totalTokens: 2234 };
const RECORDED = { uncachedInputTokens: 1200, outputTokens: 34, cacheReadTokens: 1000, cacheWriteTokens: 0, routes: ["stub/echo"] };

/** A turn's opening as the loop logs it, its first message from `source` when one is given. */
function startTurn(h: Harness, sessionId: string, turn: number, source?: Record<string, unknown>): void {
  h.bus.emit(sessionId, "turn/start", { turn });
  h.bus.emit(sessionId, "step/start", { turn, step: 1 });
  if (source !== undefined) h.bus.emit(sessionId, "user/message", userMessage(source));
}
/** Step 1 answers `text`. */
function answer(h: Harness, sessionId: string, turn: number, text: string): void {
  h.bus.emit(sessionId, "assistant/message", {
    turn, step: 1, usage: USAGE,
    message: { id: `a-${sessionId}-${turn}`, role: "assistant", content: say(text), source: { kind: "model", provider: "stub", model: "echo" } },
  });
  h.bus.emit(sessionId, "step/end", { turn, step: 1 });
}
function endTurn(h: Harness, sessionId: string, turn: number, reason: object = { kind: "completed" }): void {
  h.bus.emit(sessionId, "turn/end", { turn, reason });
}
/** One whole turn: opened by `source`, answered `text`, ended. */
function turn(h: Harness, sessionId: string, n: number, source: Record<string, unknown> | undefined, text: string): void {
  startTurn(h, sessionId, n, source);
  answer(h, sessionId, n, text);
  endTurn(h, sessionId, n);
}
const ABORTED = (reason: string) => ({ kind: "aborted", reason: { kind: "hook", reason } });

/** The ledger's events. */
const events = async (h: Harness): Promise<DeskEvent[]> => (await readEvents(h.home)).events;
const kinds = async (h: Harness): Promise<string[]> => (await events(h)).map((e) => e.kind);
/** The ledger's `desk-turn` events. */
const turnsOf = async (h: Harness) => (await events(h)).flatMap((e) => (e.kind === "desk-turn" ? [e] : []));

const post = (h: Harness, text: string, source: Parameters<DeskConversation["post"]>[0]["source"] = { kind: "telegram" }, message: Record<string, unknown> = PHONE) =>
  h.desk.post({ text, source, message: message as { kind: string } & Record<string, unknown> });

/* ---------- post ---------- */

test("post opens a turn with the provenance line and the message source", async () => {
  const h = await harness();
  const result = await post(h, "hi");
  assert.equal(h.tree.created.length, 1);
  const agent = h.tree.agents[0];
  assert.deepEqual(result, { opened: true, sessionId: agent.id });
  assert.equal(agent.text(0), "[telegram · operator · 14:03 ET]\nhi");
  assert.equal(agent.followups[0].role, "user");
  assert.deepEqual(agent.followups[0].source, { kind: "telegram", from: 42, chat: 42, messageId: 7 });
  assert.deepEqual(h.desk.current(), { sessionId: agent.id, running: false });

  await h.time.fake.advance(60_000);
  const alerted = await post(h, "NVDA 181.50", { kind: "alert", symbol: "NVDA", rule: "buy_zone" }, ALERT);
  assert.deepEqual(alerted, { opened: true, sessionId: agent.id }, "the same conversation");
  assert.equal(agent.text(1), "[alert · NVDA · buy_zone]\nNVDA 181.50");
  assert.deepEqual(agent.followups[1].source, ALERT);
  assert.deepEqual(await events(h), [{ t: iso(AT), kind: "desk-session", sessionId: agent.id, reason: "created" }], "a post records no turn of its own");
  assert.deepEqual(h.lines, []);
});

/* The bridge passes Telegram's own date as the source's `at`: a text written before a night the Mac slept
 * through reaches the desk with the time it was written, not the time it arrived. */
test("a phone's provenance line carries when the operator wrote it, dated when that was another day", async () => {
  const h = await harness();
  await post(h, "written at noon", { kind: "telegram", at: AT - 2 * 3_600_000 - 3 * 60_000 });
  await post(h, "written last night", { kind: "telegram", at: AT - 16 * 3_600_000 });
  const agent = h.tree.agents[0];
  assert.equal(agent.text(0), "[telegram · operator · 12:00 ET]\nwritten at noon");
  assert.equal(agent.text(1), "[telegram · operator · 2026-10-19 22:03 ET]\nwritten last night");
});

/* ---------- a keyed post: one phone text, one message, across a restart (spec §16 H3) ---------- */

/** A keyed phone post, as the bridge sends one for Telegram update `update`. */
const keyed = (h: Harness, text: string, key: string) =>
  h.desk.post({ text, source: { kind: "telegram" }, message: PHONE as { kind: string } & Record<string, unknown>, key });
/** A `user/message` event as the session's log keeps one, the message's id `id`. */
const logged = (seq: number, id: string): EventLike => ({ type: "user/message", seq, data: { id, role: "user", content: say("x"), source: PHONE } });
/** A promise and the hand that settles it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
/** The desk session, started, and its id. */
async function started(h: Harness): Promise<string> {
  await h.desk.start();
  const { sessionId } = h.desk.current();
  assert.ok(sessionId !== undefined, "the conversation holds its session");
  return sessionId;
}

test("a keyed post builds its message with the key as its id", async () => {
  const h = await harness();
  const result = await keyed(h, "hi", "telegram:42");
  const agent = h.tree.agents[0];
  assert.deepEqual(result, { opened: true, sessionId: agent.id });
  assert.equal(agent.followups[0].id, "telegram:42");
  assert.equal(agent.followups[0].role, "user");
  assert.equal(agent.text(0), "[telegram · operator · 14:03 ET]\nhi");
  assert.deepEqual(agent.followups[0].source, PHONE);
  assert.ok(Object.isFrozen(agent.followups[0]), "frozen, as dsh publishes a message");
  assert.deepEqual(h.lines, []);
});

test("the context is its own part between the provenance line and the operator's text", async () => {
  const h = await harness();
  const result = await h.desk.post({
    text: "why did this fire?", source: { kind: "telegram" }, message: PHONE as { kind: string } & Record<string, unknown>, key: "telegram:43",
    context: "NVDA 169.82 · ROBINHOOD 10:21:03 ET\n\nannotation:\nStop met.",
  });
  const agent = h.tree.agents[0];
  assert.deepEqual(result, { opened: true, sessionId: agent.id });
  assert.equal(agent.followups[0].id, "telegram:43", "still keyed");
  assert.deepEqual(agent.followups[0].content, [
    { type: "text", text: "[telegram · operator · 14:03 ET]" },
    { type: "text", text: "the message this replies to:\nNVDA 169.82 · ROBINHOOD 10:21:03 ET\n\nannotation:\nStop met." },
    { type: "text", text: "why did this fire?" },
  ]);
  await post(h, "and a plain one");
  assert.deepEqual(agent.followups[1].content, [{ type: "text", text: "[telegram · operator · 14:03 ET]\nand a plain one" }], "no context, one part as before");
  assert.deepEqual(h.lines, []);
});

test("a key already in the session's log opens nothing and answers duplicate", async () => {
  const h = await harness();
  const sessionId = await started(h);
  /* 600 events, read in pages of 512: the key sits in the second page */
  const log: EventLike[] = [];
  for (let seq = 0; seq < 600; seq++) log.push(seq === 550 ? logged(seq, "telegram:42") : { type: "step/start", seq, data: { turn: 1, step: seq } });
  h.tree.logs.set(sessionId, log);
  assert.deepEqual(await keyed(h, "again", "telegram:42"), { opened: true, sessionId, duplicate: true });
  const agent = h.tree.agent(sessionId);
  assert.equal(agent.followups.length, 0, "nothing sent again");
  assert.deepEqual(h.tree.persisted, ["flush", `open ${sessionId} read`, "read 0", "read 512", "read 600", "close", "flush"],
    "the log flushed, then read to its end in pages of 512, and flushed again before the answer");

  /* a key the log does not hold opens its turn, and the log is not read again */
  assert.deepEqual(await keyed(h, "new", "telegram:43"), { opened: true, sessionId });
  assert.equal(agent.followups[0].id, "telegram:43");
  /* a message the session logs from now on is seen too: the live `user/message` keeps the set current */
  h.bus.emit(sessionId, "user/message", { id: "telegram:44", role: "user", content: say("x"), source: PHONE });
  assert.deepEqual(await keyed(h, "seen live", "telegram:44"), { opened: true, sessionId, duplicate: true });
  /* and one this conversation sent is seen at once, before any turn takes it */
  assert.deepEqual(await keyed(h, "new, again", "telegram:43"), { opened: true, sessionId, duplicate: true });
  assert.equal(agent.followups.length, 1);
  assert.equal(h.tree.persisted.filter((p) => p.startsWith("open")).length, 1, "the log is read once per session");
  assert.deepEqual(h.lines, []);
});

test("a key already waiting in the inbox opens nothing and answers duplicate", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  const agent = h.tree.agent(sessionId);
  const model = agent.model;
  assert.ok(model !== undefined);
  const waiting = (id: string): MessageLike => ({ id, role: "user", content: say("x"), source: PHONE });
  model.pending.push(waiting("telegram:42"));
  model.steps.push(waiting("telegram:43"));
  assert.deepEqual(await keyed(h, "queued", "telegram:42"), { opened: true, sessionId, duplicate: true }, "on the next-turn list");
  assert.deepEqual(await keyed(h, "steered", "telegram:43"), { opened: true, sessionId, duplicate: true }, "on the next-step list");
  assert.deepEqual(agent.followups, []);
  assert.deepEqual(await keyed(h, "fresh", "telegram:44"), { opened: true, sessionId });
  assert.deepEqual(model.pending.map((m) => m.id), ["telegram:42", "telegram:44"]);
});

test("a keyed post answers opened only once the persistence flush has resolved", async () => {
  const h = await harness();
  const sessionId = await started(h);
  await keyed(h, "first", "telegram:41");
  const gate = deferred();
  h.tree.flushGate = gate.promise;
  let answered: PostResult | undefined;
  const posting = keyed(h, "second", "telegram:42").then((result) => { answered = result; });
  const agent = h.tree.agent(sessionId);
  await waitFor("the followup", () => agent.followups.length === 2);
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(answered, undefined, "followed up, but not answered before the flush");
  assert.equal(h.tree.persisted.at(-1), "flush");
  gate.resolve();
  await posting;
  assert.deepEqual(answered, { opened: true, sessionId });
});

test("a keyed post whose flush fails still answers opened, with one line", async () => {
  const h = await harness();
  const sessionId = await started(h);
  await keyed(h, "first", "telegram:41");
  h.tree.flushGate = Promise.reject(new Error("EIO"));
  h.tree.flushGate.catch(() => {});
  assert.deepEqual(await keyed(h, "second", "telegram:42"), { opened: true, sessionId });
  assert.equal(h.tree.agent(sessionId).followups.length, 2);
  assert.deepEqual(h.lines, ["gravit-face: desk: the desk session's log could not be flushed (EIO); a crash before the next flush may lose this text"]);
});

test("an unkeyed post is built by createUserMessage as before", async () => {
  const h = await harness();
  assert.deepEqual(await post(h, "hi"), { opened: true, sessionId: h.tree.agents[0].id });
  const message = h.tree.agents[0].followups[0];
  assert.ok(message.id !== "" && !message.id.startsWith("telegram:"), "a fresh id of dsh's own");
  assert.deepEqual(h.tree.persisted, [], "the log is neither read nor flushed");
});

test("a keyed post on a face with no session persistence refuses with the error line and opens nothing", async () => {
  const h = await harness();
  delete (h.tree.ctx as { sessionPersistence?: unknown }).sessionPersistence;
  const result = await keyed(h, "hi", "telegram:42");
  const line = "the desk could not open a turn: this face has no session persistence, so a phone text cannot be checked against the desk session's log";
  assert.deepEqual(result, { refused: "error", line });
  assert.deepEqual(h.tree.agents[0].followups, []);
  assert.deepEqual(h.lines, [`gravit-face: desk: ${line}`]);
});

test("a paused desk refuses with the paused line and opens no turn", async () => {
  const today = await harness();
  await writeOff(today.home, { by: "telegram", until: AT + 7_200_000 }, () => AT - 60_000);
  await put(today.root, "desk/journal/.git/"); // the pause is read first: a paused desk refuses as paused
  assert.deepEqual(await post(today, "hi"), {
    refused: "paused",
    line: "paused since 14:02 ET by telegram until 16:03 ET; a terminal resumes it: npm run desk -- resume",
  });
  assert.equal(today.tree.created.length, 0, "no session ensured");
  assert.deepEqual(await kinds(today), ["off-set"], "no new event");

  const yesterday = await harness();
  await writeOff(yesterday.home, { by: "terminal" }, () => Date.parse("2026-10-19T13:30:00.000Z"));
  assert.deepEqual(await post(yesterday, "hi"), {
    refused: "paused", line: "paused since 2026-10-19 09:30 ET by terminal; a terminal resumes it: npm run desk -- resume",
  });

  const tomorrow = await harness();
  await writeOff(tomorrow.home, { by: "page", until: Date.parse("2026-10-21T13:30:00.000Z") }, () => AT);
  assert.deepEqual(await post(tomorrow, "hi"), {
    refused: "paused", line: "paused since 14:03 ET by page until 2026-10-21 09:30 ET; a terminal resumes it: npm run desk -- resume",
  });
  for (const h of [yesterday, tomorrow]) assert.equal(h.tree.created.length, 0);
});

test("an expired pause clears itself and the post opens a turn", async () => {
  const h = await harness();
  await writeOff(h.home, { by: "page", until: AT - 1 }, () => AT - 3_600_000);
  const result = await post(h, "back?");
  const agent = h.tree.agents[0];
  assert.deepEqual(result, { opened: true, sessionId: agent.id });
  assert.equal(agent.text(0), "[telegram · operator · 14:03 ET]\nback?");
  assert.deepEqual(await events(h), [
    { t: iso(AT - 3_600_000), kind: "off-set", by: "page", until: iso(AT - 1) },
    { t: iso(AT), kind: "off-cleared", by: "expiry" },
    { t: iso(AT), kind: "desk-session", sessionId: agent.id, reason: "created" },
  ]);
  assert.deepEqual(await readOffState(h.home, () => AT), { expired: false }, "the switch is gone");
});

/** chmod cannot shut root out, so the unwritable cases are skipped when the suite runs as root. */
const AS_ROOT = process.getuid?.() === 0 ? "root writes past a mode of 500" : false;

test("a switch that cannot be read refuses with the error line: it never reads as no switch", async () => {
  const unreadable = join(await fixture("long"), "x".repeat(300)); // a name past NAME_MAX: every read under it fails
  const h = await harness({}, { home: unreadable });
  const result = await post(h, "hi");
  assert.equal((result as { refused?: string }).refused, "error");
  assert.match((result as { line: string }).line, /^the desk could not open a turn: ENAMETOOLONG: .*lstat '.*\/face\/desk\/OFF'$/, "the switch's own read");
  assert.deepEqual(h.lines, [`gravit-face: desk: ${(result as { line: string }).line}`]);
  await assert.rejects(stat(join(h.root, "desk", "journal")), { code: "ENOENT" }, "it stopped at the switch: no ensure made the journal");
  assert.equal(h.tree.created.length, 0, "no session ensured, no turn");
});

test("a pause set while an expired one is being lifted stands: the post reads the switch again and refuses", async () => {
  await post(await harness(), "warm"); // load the conversation's machinery, so the next post reaches the lift at once
  const h = await harness();
  await writeOff(h.home, { by: "page", until: AT - 1 }, () => AT - 3_600_000);
  const off = join(deskDir(h.home), OFF_FILE);
  let result: Promise<PostResult> | undefined;
  await withFileLock(off, async () => {
    result = post(h, "hi"); // reads the expired pause, then its lift waits here for the switch's lock
    await new Promise((done) => setTimeout(done, 150));
    // a pause written as writeOff writes one, under the lock the lift is waiting for
    await writeFile(off, `${JSON.stringify({ setAt: iso(AT), by: "telegram", until: iso(AT + 3_600_000) })}\n`);
  });
  assert.deepEqual(await result, {
    refused: "paused", line: "paused since 14:03 ET by telegram until 15:03 ET; a terminal resumes it: npm run desk -- resume",
  });
  assert.deepEqual(await kinds(h), ["off-set"], "the lift found the new pause and lifted nothing");
  assert.equal(h.tree.created.length, 0);
});

test("an expired pause that cannot be lifted is one line, and the desk goes on", { skip: AS_ROOT }, async () => {
  const h = await harness();
  await writeOff(h.home, { by: "page", until: AT - 1 }, () => AT - 3_600_000);
  await chmod(deskDir(h.home), 0o500); // the switch's lock cannot be made beside it
  try {
    const result = await post(h, "back?");
    assert.deepEqual(result, { opened: true, sessionId: h.tree.agents[0].id }, "past its until, the pause is not in force");
    assert.match(h.lines[0], /^gravit-face: desk: the expired pause could not be lifted \(EACCES: .*\); the desk goes on$/);
    assert.equal(h.lines.filter((line) => line.includes("could not be lifted")).length, 1);
  } finally {
    await chmod(deskDir(h.home), 0o755);
  }
});

test("a fence violation refuses with the repo-relative line and a desk-refused event", async () => {
  const journal = await harness();
  await put(journal.root, "desk/journal/.git/");
  assert.deepEqual(await post(journal, "hi"), {
    refused: "fence", path: "desk/journal/.git",
    line: "refused: desk/journal/.git exists; it would steer every later desk turn. Remove it, then write again.",
  });
  assert.equal(journal.tree.created.length, 0, "no session ensured, no turn");
  assert.deepEqual(await events(journal), [{ t: iso(AT), kind: "desk-refused", reason: "fence", path: "desk/journal/.git" }]);

  const desk = await harness();
  await put(desk.root, "desk/GRAVIT.md");
  assert.deepEqual(await post(desk, "hi"), {
    refused: "fence", path: "desk/GRAVIT.md",
    line: "refused: desk/GRAVIT.md exists; it would steer every later desk turn. Remove it, then write again.",
  });
  assert.deepEqual(await events(desk), [{ t: iso(AT), kind: "desk-refused", reason: "fence", path: "desk/GRAVIT.md" }]);
});

test("a failed ensure or followup refuses with the error line and one log line, and the next post tries again", async () => {
  const h = await harness();
  h.tree.failCreate = "the registry is closed";
  assert.deepEqual(await post(h, "hi"), { refused: "error", line: "the desk could not open a turn: the registry is closed" });
  assert.deepEqual(h.lines, ["gravit-face: desk: the desk could not open a turn: the registry is closed"]);

  h.tree.failCreate = undefined;
  const opened = await post(h, "hi again");
  const agent = h.tree.agents[0];
  assert.deepEqual(opened, { opened: true, sessionId: agent.id });

  agent.failFollowup = "the inbox is closed";
  assert.deepEqual(await post(h, "and again"), { refused: "error", line: "the desk could not open a turn: the inbox is closed" });
  assert.equal(h.lines.length, 2);
  assert.equal(h.lines[1], "gravit-face: desk: the desk could not open a turn: the inbox is closed");
});

/* ---------- supervision, the ledger and delivery ---------- */

test("telegram, alert and wake turns are delivered; a user turn is not; no outlet records only", async () => {
  const h = await harness();
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };

  turn(h, sessionId, 1, PHONE, "phone answer");
  turn(h, sessionId, 2, ALERT, "alert answer");
  turn(h, sessionId, 3, JOB, "wake answer");
  turn(h, sessionId, 4, BROWSER, "browser answer");
  turn(h, sessionId, 5, PHONE, "second phone answer");
  await waitFor("five deliveries checked", () => outlet.sent.length === 4);
  assert.deepEqual(outlet.sent, ["phone answer", "alert answer", "wake answer", "second phone answer"], "in turn order; the browser turn's answer stays in the transcript");

  h.desk.setOutlet(undefined);
  turn(h, sessionId, 6, PHONE, "nobody hears this");
  await waitFor("turn 6 recorded", async () => (await turnsOf(h)).length === 6);
  assert.equal(outlet.sent.length, 4, "no outlet, nothing sent");
  assert.deepEqual(await turnsOf(h), [1, 2, 3, 4, 5, 6].map((n) => ({
    t: iso(AT), kind: "desk-turn", sessionId, source: ["telegram", "alert", "wake", "user", "telegram", "telegram"][n - 1],
    turn: n, outcome: "ended", wallMs: 0, usage: RECORDED,
  })));
  assert.deepEqual(h.lines, []);
});

test("a phone turn's answer goes as chat to the network it came from; an alert turn's as alert; a wake's as report", async () => {
  const h = await harness();
  const asked: unknown[] = [];
  h.desk.setOutlet({ send: (text, opts) => { asked.push([text, opts]); return Promise.resolve({ sent: [`telegram:${asked.length}`] }); } });
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  turn(h, sessionId, 1, PHONE_TG, "phone answer");
  turn(h, sessionId, 2, ALERT, "alert answer");
  turn(h, sessionId, 3, JOB, "wake answer");
  await waitFor("three deliveries", () => asked.length === 3);
  assert.deepEqual(asked, [
    ["phone answer", { kind: "chat", network: "telegram" }],
    ["alert answer", { kind: "alert" }],
    ["wake answer", { kind: "report" }],
  ]);
});

test("a Slack text's answer goes back to Slack, a Telegram text's to Telegram", async () => {
  const h = await harness();
  const asked: unknown[] = [];
  h.desk.setOutlet({ send: (text, opts) => { asked.push([text, opts]); return Promise.resolve({ sent: [`x:${asked.length}`] }); } });
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  turn(h, sessionId, 1, PHONE_SLACK, "to slack");
  turn(h, sessionId, 2, PHONE_TG, "to telegram");
  /* an older face's record names no network, and a record with one neither network is: no network, every ticked one */
  turn(h, sessionId, 3, PHONE, "an older record");
  turn(h, sessionId, 4, { kind: "telegram", network: "matrix", messageId: "matrix:1" }, "an unknown network");
  await waitFor("four deliveries", () => asked.length === 4);
  assert.deepEqual(asked, [
    ["to slack", { kind: "chat", network: "slack" }],
    ["to telegram", { kind: "chat", network: "telegram" }],
    ["an older record", { kind: "chat" }],
    ["an unknown network", { kind: "chat" }],
  ]);
});

test("a held send is recorded undelivered with the account's reason", async () => {
  const h = await harness();
  assert.deepEqual(await h.desk.deliver("nobody to hear it", { kind: "alert" }), { undelivered: "no phone" });
  h.desk.setOutlet({ send: () => Promise.resolve({ held: "quiet hours" }) });
  assert.deepEqual(await h.desk.deliver("an alert at 23:30", { kind: "alert" }), { undelivered: "quiet hours" });
  assert.deepEqual(h.lines, [], "a hold is the account's answer, not a failure");
});

test("a turn the supervisor refuses records desk-refused and delivers the refusal line", async () => {
  const h = await harness();
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  const agent = h.tree.agent(sessionId);

  await put(h.root, "desk/journal/notes/GRAVIT.md"); // planted after the post's own check: the turn's check finds it
  startTurn(h, sessionId, 1, PHONE);
  await waitFor("the fence's cancel", () => agent.cancels.length === 1);
  assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "desk fence" }, { keepInbox: true }]]);
  endTurn(h, sessionId, 1, ABORTED("desk fence"));
  await waitFor("the refusal's delivery", () => outlet.sent.length === 1);
  assert.deepEqual(outlet.sent, ["refused: desk/journal/notes/GRAVIT.md exists; it would steer every later desk turn. Remove it, then write again."]);
  assert.deepEqual((await events(h)).slice(1), [{ t: iso(AT), kind: "desk-refused", reason: "fence", path: "desk/journal/notes/GRAVIT.md" }], "and no desk-turn");
});

test("a timed-out turn with no text delivers the timed-out line for its deadline", async () => {
  const h = await harness({ deadlineFor: (kind) => (kind === "alert" ? 90_000 : undefined) });
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  const agent = h.tree.agent(sessionId);

  startTurn(h, sessionId, 1, PHONE);
  h.bus.emit(sessionId, "approval/asked", { id: "ap-1", turn: 1, toolName: "write" }); // parked on a card
  await h.time.fake.advance(300_000);
  assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "desk deadline" }, { keepInbox: true }]]);
  endTurn(h, sessionId, 1, ABORTED("desk deadline"));
  await waitFor("the 5 min line", () => outlet.sent.length === 1);
  assert.deepEqual(outlet.sent, ["timed out after 5 min; a card or a long tool was pending"]);

  startTurn(h, sessionId, 2, ALERT);
  await h.time.fake.advance(90_000);
  assert.equal(agent.cancels.length, 2, "the alert's own deadline");
  endTurn(h, sessionId, 2, ABORTED("desk deadline"));
  await waitFor("the 90 s line", () => outlet.sent.length === 2);
  assert.equal(outlet.sent[1], "timed out after 90 s; a card or a long tool was pending");

  startTurn(h, sessionId, 3, PHONE);
  answer(h, sessionId, 3, "NVDA closed at 181.50 (IEX 15:59:58 ET); noting it.");
  await h.time.fake.advance(300_000);
  endTurn(h, sessionId, 3, ABORTED("desk deadline"));
  await waitFor("turn 3's delivery", () => outlet.sent.length === 3);
  assert.equal(outlet.sent[2], "NVDA closed at 181.50 (IEX 15:59:58 ET); noting it.", "a timed-out turn with text sends its text");

  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.source, e.outcome, e.wallMs]), [
    [1, "telegram", "timed-out", 300_000], [2, "alert", "timed-out", 90_000], [3, "telegram", "timed-out", 300_000],
  ]);
});

test("an ended turn with no text sends nothing and is still recorded", async () => {
  const h = await harness();
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  startTurn(h, sessionId, 1, PHONE);
  h.bus.emit(sessionId, "step/end", { turn: 1, step: 1 });
  endTurn(h, sessionId, 1); // it ended on a tool: no final text
  turn(h, sessionId, 2, PHONE, "the next one");
  await waitFor("turn 2's delivery", () => outlet.sent.length === 1);
  assert.deepEqual(outlet.sent, ["the next one"]);
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.outcome]), [[1, "ended"], [2, "ended"]]);
});

test("a send that rejects or throws is one line each, never an unhandled rejection, and the next turn is still sent", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    const h = await harness();
    const { sessionId } = (await post(h, "hi")) as { sessionId: string };

    const failing = recordingOutlet("fail");
    h.desk.setOutlet(failing);
    turn(h, sessionId, 1, PHONE, "lost on the way");
    await waitFor("the rejected send's line", () => h.lines.length === 1);

    const throwing = recordingOutlet("throws");
    h.desk.setOutlet(throwing);
    turn(h, sessionId, 2, PHONE, "also lost");
    await waitFor("the thrown send's line", () => h.lines.length === 2);

    const working = recordingOutlet();
    h.desk.setOutlet(working);
    turn(h, sessionId, 3, PHONE, "this one arrives");
    await waitFor("turn 3's delivery", () => working.sent.length === 1);

    assert.deepEqual(h.lines, [
      `gravit-face: desk: the reply to turn 1 on desk session ${sessionId} could not be sent: telegram is down`,
      `gravit-face: desk: the reply to turn 2 on desk session ${sessionId} could not be sent: the bridge fell over`,
    ]);
    assert.deepEqual((await turnsOf(h)).map((e) => e.turn), [1, 2, 3], "every turn recorded before its send");
    await new Promise((done) => setTimeout(done, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a failed turn is recorded with its error and answered with the failed line - or with its text, when it said something", async () => {
  const h = await harness();
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };

  startTurn(h, sessionId, 1, PHONE);
  endTurn(h, sessionId, 1, { kind: "error", error: { message: "DeepSeek is down\n    at fetch (deepseek.js:1)", code: "UNAVAILABLE" } });
  startTurn(h, sessionId, 2, ALERT);
  answer(h, sessionId, 2, "NVDA 181.50 (IEX 15:21:03 ET); the plan's buy zone is 180-182.");
  endTurn(h, sessionId, 2, { kind: "error", error: { message: "the stream was reset", code: "UNKNOWN" } });
  startTurn(h, sessionId, 3, JOB);
  endTurn(h, sessionId, 3, { kind: "blocked" });
  startTurn(h, sessionId, 4, BROWSER);
  endTurn(h, sessionId, 4, { kind: "error", error: { message: "DeepSeek is down", code: "UNAVAILABLE" } });
  turn(h, sessionId, 5, PHONE, "back up");
  await waitFor("four replies", () => outlet.sent.length === 4);
  assert.deepEqual(outlet.sent, [
    "the desk could not answer: DeepSeek is down; nothing was done - send it again later",
    "NVDA 181.50 (IEX 15:21:03 ET); the plan's buy zone is 180-182.",
    "the desk could not answer: blocked; nothing was done - send it again later",
    "back up",
  ], "the browser turn's failure stays in its transcript");
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.source, e.outcome, e.error]), [
    [1, "telegram", "failed", "DeepSeek is down"],
    [2, "alert", "failed", "the stream was reset"],
    [3, "wake", "failed", "blocked"],
    [4, "user", "failed", "DeepSeek is down"],
    [5, "telegram", "ended", undefined],
  ]);
  assert.equal(Object.hasOwn((await turnsOf(h))[4], "error"), false, "no error key on a turn that did not fail");
});

test("a send that never settles is given a minute, then one line, and the next reply goes ahead", async () => {
  const h = await harness();
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  const stuck = recordingOutlet("never");
  h.desk.setOutlet(stuck);
  turn(h, sessionId, 1, PHONE, "into the void");
  await waitFor("the first send", () => stuck.sent.length === 1);
  turn(h, sessionId, 2, PHONE, "the next one");
  await waitFor("turn 2's record", async () => (await turnsOf(h)).length === 2);
  await h.time.fake.advance(59_999);
  assert.deepEqual(stuck.sent, ["into the void"], "the next reply waits behind the one under way");
  await h.time.fake.advance(1);
  await waitFor("the next reply", () => stuck.sent.length === 2);
  assert.deepEqual(stuck.sent, ["into the void", "the next one"]);
  assert.deepEqual(h.lines, [
    `gravit-face: desk: the reply to turn 1 on desk session ${sessionId} could not be sent: the outlet did not answer in 60 s; the next reply goes ahead`,
  ]);
});

test("the conversation imports nothing but types: desk.ts, desk-session.ts and dsh-llm load on first use", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "desk-conversation.ts"), "utf8");
  const imports = source.match(/^import\b.*$/gm) ?? [];
  assert.ok(imports.some((line) => line.includes('"./desk.ts"')), "it does name desk.ts");
  for (const line of imports) assert.match(line, /^import type /, `a value edge: ${line}`);
});

test("the desk contract says where each answer goes, as the delivery does", () => {
  const contract = readDesk(DESK_PATH);
  assert.ok(contract.includes(
    "Your final text goes to the operator's phone, as plain text; so does your answer to a background job's notice. "
      + "While the conversation is off, a message with no bracketed line is the operator at the browser, where your answer stays.",
  ));
});

/* ---------- serialization ---------- */

test("two posts at once ensure once and open two turns in order", async () => {
  const h = await harness();
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const [first, second] = await Promise.all([post(h, "first"), post(h, "second")]);
  assert.equal(h.tree.created.length, 1, "one conversation, not two");
  const agent = h.tree.agents[0];
  assert.deepEqual([first, second], [{ opened: true, sessionId: agent.id }, { opened: true, sessionId: agent.id }]);
  assert.deepEqual([agent.text(0), agent.text(1)], ["[telegram · operator · 14:03 ET]\nfirst", "[telegram · operator · 14:03 ET]\nsecond"]);
  assert.deepEqual(await kinds(h), ["desk-session"]);

  // the loop claims them as two turns, each with its own deadline and its own reply
  startTurn(h, agent.id, 1, PHONE);
  await h.time.fake.advance(100_000);
  answer(h, agent.id, 1, "first answer");
  endTurn(h, agent.id, 1);
  startTurn(h, agent.id, 2, PHONE);
  await h.time.fake.advance(250_000);
  assert.deepEqual(agent.cancels, [], "turn 1's deadline ended with turn 1");
  answer(h, agent.id, 2, "second answer");
  endTurn(h, agent.id, 2);
  await waitFor("both replies", () => outlet.sent.length === 2);
  assert.deepEqual(outlet.sent, ["first answer", "second answer"]);
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.wallMs]), [[1, 100_000], [2, 250_000]]);
});

/* ---------- start, renew, stop, dispose ---------- */

test("start supervises the desk session before any post", async () => {
  const h = await harness();
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  await h.desk.start();
  const agent = h.tree.agents[0];
  assert.deepEqual(await events(h), [{ t: iso(AT), kind: "desk-session", sessionId: agent.id, reason: "created" }]);
  assert.deepEqual(h.desk.current(), { sessionId: agent.id, running: false });

  // the operator types in the browser: timed, recorded, not sent
  startTurn(h, agent.id, 1, BROWSER);
  await h.time.fake.advance(300_000);
  assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "desk deadline" }, { keepInbox: true }]]);
  endTurn(h, agent.id, 1, ABORTED("desk deadline"));
  turn(h, agent.id, 2, BROWSER, "a browser answer");
  await waitFor("two records", async () => (await turnsOf(h)).length === 2);
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.source, e.outcome]), [[1, "user", "timed-out"], [2, "user", "ended"]]);
  turn(h, agent.id, 3, PHONE, "a phone answer"); // deliveries keep turn order: once this one is sent, the two before were passed over
  await waitFor("turn 3's delivery", () => outlet.sent.length === 1);
  assert.deepEqual(outlet.sent, ["a phone answer"]);

  await h.desk.start();
  assert.equal(h.tree.created.length, 1, "a second start finds the same conversation");
  assert.equal(h.bus.listeners.size, 1, "and supervises it once");
});

test("a start that fails is one line and never rejects; the next post opens the conversation", async () => {
  const h = await harness();
  h.tree.failCreate = "the registry is closed";
  await h.desk.start();
  assert.deepEqual(h.lines, ["gravit-face: desk: the desk session could not be opened: the registry is closed; the next message tries again"]);
  assert.equal(h.bus.listeners.size, 0);
  h.tree.failCreate = undefined;
  const opened = await post(h, "hi");
  assert.deepEqual(opened, { opened: true, sessionId: h.tree.agents[0].id });
  assert.equal(h.bus.listeners.size, 1);
});

test("a desk session resumed as a new agent is supervised once: the old supervision goes at once", async () => {
  const h = await harness();
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  h.tree.live.delete(sessionId); // the session went cold: the next ensure resumes it as another agent object
  await post(h, "again");
  assert.equal(h.tree.resumed.length, 1);
  assert.notEqual(h.tree.agents[1], h.tree.agents[0]);
  assert.equal(h.bus.listeners.size, 1);
  turn(h, sessionId, 1, PHONE, "once");
  await waitFor("the record", async () => (await turnsOf(h)).length === 1);
  await new Promise((done) => setTimeout(done, 20));
  assert.equal((await turnsOf(h)).length, 1, "one record per turn, not one per supervision");
});

/* ---------- what a restart left (spec §16 H3) ---------- */

/** The face restarted on `h`'s home and tree: the old conversation (`h.desk`, or `previous`) disposed, its desk session cold, and a new
 * conversation over the same tree, bus and clock - its lines in `h.lines`, its outlet recording. */
async function restarted(h: Harness, sessionId: string, previous: DeskConversation = h.desk): Promise<{ desk: DeskConversation; outlet: ReturnType<typeof recordingOutlet> }> {
  await previous.dispose();
  h.tree.live.delete(sessionId);
  const log = (line: string): void => { h.lines.push(line); };
  const desk = createDeskConversation({
    session: { ctx: h.tree.ctx, root: h.root, home: h.home, route: ROUTE, installModelSelection: h.tree.install, now: () => h.time.clock.now(), log },
    on: h.bus.on,
    clock: h.time.clock,
    log,
  });
  const outlet = recordingOutlet();
  desk.setOutlet(outlet);
  return { desk, outlet };
}
/** A message as the inbox holds one: `id`, from `source`. */
const pending = (id: string, source: Record<string, unknown>): MessageLike =>
  ({ id, role: "user", content: say(`[${String(source.kind)}]\n${id}`), source }) as unknown as MessageLike;
/** A session log row: `type`, its `data`, and its `time` in ms. */
const row = (seq: number, type: string, data: unknown, time = AT): EventLike => ({ type, seq, data, time }) as EventLike;
/** A log whose tail is phone turn `n`, cut: started, its message claimed, and closed `interrupted` by the resume. */
const cutLog = (n: number, at: number): EventLike[] => [
  row(0, "turn/start", { turn: n }, at),
  row(1, "user/message", { id: `telegram:${n}`, role: "user", content: say("x"), source: PHONE }, at),
  row(2, "turn/end", { turn: n, reason: { kind: "interrupted" } }, at + 1_000),
];
const RESTART_LINE = "a restart cut your message of 13:55 ET before it was answered; send it again";

test("start, after a resume, requeues what the restart left pending", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  assert.equal(h.tree.agent(sessionId).followups.length, 0, "a created session has nothing left to wake");
  assert.equal(h.tree.persisted.length, 0, "and its log is not read");

  const phoneText = pending("telegram:9", PHONE);
  const browser = pending("m-browser", BROWSER);
  const flagged = pending("m-alert", ALERT);
  h.tree.rebuilt.set(sessionId, [phoneText, browser, flagged]);
  const { desk, outlet } = await restarted(h, sessionId);
  await desk.start();
  const agent = h.tree.agent(sessionId);
  assert.equal(h.tree.resumed.length, 1);
  assert.deepEqual(agent.followups.map((m) => m.id), ["telegram:9", "m-alert"], "the phone's text and the alert, sent again in order: the agent wakes for them");
  assert.deepEqual(agent.model!.pending.map((m) => m.id), ["m-browser", "telegram:9", "m-alert"], "the browser's message is left as it was");
  assert.deepEqual(h.tree.persisted, ["flush", `open ${sessionId} read`, "read 0", "close"], "the resumed session's log read, flushed first");
  assert.deepEqual(await turnsOf(h), [], "a log with no cut turn records nothing");
  assert.deepEqual(outlet.sent, []);

  /* a second start finds the session live: nothing resumed, nothing woken again */
  await desk.start();
  assert.equal(agent.followups.length, 2);
  assert.equal(h.tree.persisted.filter((p) => p.startsWith("open")).length, 1);
  assert.deepEqual(h.lines, []);
  await desk.dispose();
});

test("start answers a phone turn the restart cut with one line, once per session and turn, recorded as a desk-turn cancelled by 'restart'", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  const writtenAt = AT - 8 * 60_000; // 13:55 ET
  h.tree.logs.set(sessionId, cutLog(3, writtenAt));
  h.tree.rebuilt.set(sessionId, [pending("telegram:4", PHONE)]);
  const first = await restarted(h, sessionId);
  await first.desk.start();
  await waitFor("the restart's line", () => first.outlet.sent.length === 1);
  assert.deepEqual(first.outlet.sent, [RESTART_LINE]);
  assert.deepEqual(await turnsOf(h), [
    { t: iso(AT), kind: "desk-turn", sessionId, source: "telegram", turn: 3, outcome: "cancelled", wallMs: 0, cancel: "restart" },
  ]);
  assert.deepEqual(h.tree.agent(sessionId).followups.map((m) => m.id), ["telegram:4"], "and what waited behind it is woken");

  /* the line comes before the answer of the text it woke, and that turn is recorded after the cut one */
  turn(h, sessionId, 4, PHONE, "the fourth answer");
  await waitFor("turn 4's answer", () => first.outlet.sent.length === 2);
  assert.deepEqual(first.outlet.sent, [RESTART_LINE, "the fourth answer"]);
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.outcome]), [[3, "cancelled"], [4, "ended"]]);

  /* another restart with the same log tail: the ledger already holds turn 3's record, so neither is done again */
  h.tree.rebuilt.delete(sessionId);
  const second = await restarted(h, sessionId, first.desk);
  await second.desk.start();
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(second.outlet.sent, [], "answered once");
  assert.equal((await turnsOf(h)).filter((e) => e.turn === 3).length, 1, "recorded once");

  /* a different cut turn on the same session is its own */
  h.tree.logs.set(sessionId, cutLog(5, writtenAt));
  const third = await restarted(h, sessionId, second.desk);
  await third.desk.start();
  await waitFor("turn 5's line", () => third.outlet.sent.length === 1);
  assert.deepEqual(third.outlet.sent, [RESTART_LINE]);
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.cancel]), [[3, "restart"], [4, undefined], [5, "restart"]]);
  assert.deepEqual(h.lines, []);
  await third.desk.dispose();
});

test("a cut-turn line goes as chat with no network", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  h.tree.logs.set(sessionId, [
    row(0, "turn/start", { turn: 3 }, AT - 8 * 60_000),
    row(1, "user/message", { id: "slack:1730812345.001200", role: "user", content: say("x"), source: PHONE_SLACK }, AT - 8 * 60_000),
    row(2, "turn/end", { turn: 3, reason: { kind: "interrupted" } }, AT - 7 * 60_000),
  ]);
  const { desk } = await restarted(h, sessionId);
  const asked: unknown[] = [];
  desk.setOutlet({ send: (text, opts) => { asked.push([text, opts]); return Promise.resolve({ sent: ["slack:1730812400.000001"] }); } });
  await desk.start();
  await waitFor("the restart's line", () => asked.length === 1);
  assert.deepEqual(asked, [[RESTART_LINE, { kind: "chat" }]], "no network: the account sends it to every network the Chat row ticks");
  await desk.dispose();
});

test("a resumed session whose log cannot be read still wakes what was left, with one line", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  h.tree.rebuilt.set(sessionId, [pending("telegram:2", PHONE)]);
  const { desk, outlet } = await restarted(h, sessionId);
  const open = h.tree.ctx.sessionPersistence!.open;
  h.tree.ctx.sessionPersistence!.open = async () => { throw new Error("the log is locked"); };
  try {
    await desk.start();
  } finally {
    h.tree.ctx.sessionPersistence!.open = open;
  }
  assert.deepEqual(h.tree.agent(sessionId).followups.map((m) => m.id), ["telegram:2"]);
  assert.deepEqual(h.lines, [
    `gravit-face: desk: desk session ${sessionId}'s log could not be read (the log is locked); a phone turn a restart cut there goes unanswered`,
  ]);
  assert.deepEqual(outlet.sent, []);
  await desk.dispose();
});

test("the boot's wake passes the fence first: a violation is a desk-refused event and leaves the inbox parked", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  h.tree.rebuilt.set(sessionId, [pending("telegram:2", PHONE)]);
  await put(h.root, "desk/GRAVIT.md"); // planted while the face was down
  const { desk } = await restarted(h, sessionId);
  await desk.start();
  const agent = h.tree.agent(sessionId);
  assert.deepEqual(agent.followups, [], "nothing woken over a violation");
  assert.deepEqual(agent.model!.pending.map((m) => m.id), ["telegram:2"], "the text stays queued for the next post, which the fence refuses first");
  assert.deepEqual((await events(h)).filter((e) => e.kind === "desk-refused"), [{ t: iso(AT), kind: "desk-refused", reason: "fence", path: "desk/GRAVIT.md" }]);
  assert.deepEqual(h.lines, []);
  await desk.dispose();
});

test("a boot fence check that throws fails closed: one line, nothing woken", async (t) => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  h.tree.rebuilt.set(sessionId, [pending("telegram:2", PHONE)]);
  const desk_ = join(h.root, "desk");
  const real = fsp.readdir as unknown as (...args: unknown[]) => Promise<unknown>;
  /* a listing of desk/ that is no list: the chain check's own code throws on it, outside its fail-closed reads */
  t.mock.method(fsp, "readdir", (async (...args: unknown[]) => (String(args[0]) === desk_ ? 42 : real(...args))) as unknown as typeof fsp.readdir);
  syncBuiltinESMExports();
  const { desk } = await restarted(h, sessionId);
  try {
    await desk.start();
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  const agent = h.tree.agent(sessionId);
  assert.deepEqual(agent.followups, []);
  assert.deepEqual(agent.model!.pending.map((m) => m.id), ["telegram:2"]);
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], new RegExp(`^gravit-face: desk: the fence check before waking what desk session ${sessionId} still had queued failed \\(.+\\); it stays queued$`));
  assert.deepEqual((await events(h)).filter((e) => e.kind === "desk-refused"), []);
  await desk.dispose();
});

/* The re-review's M1: a shutdown that begins while the boot's fence check runs wakes nothing afterwards. */
test("a dispose that lands during the boot's fence check stops the boot: nothing is woken and nothing carried", async (t) => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  h.tree.rebuilt.set(sessionId, [pending("telegram:2", PHONE)]);
  await appendEvent(h.home, carryOf(sessionId, [{ key: "telegram:3", text: "third" }]));
  const desk_ = join(h.root, "desk");
  const gate = deferred();
  let reached = false;
  const real = fsp.readdir as unknown as (...args: unknown[]) => Promise<unknown>;
  t.mock.method(fsp, "readdir", (async (...args: unknown[]) => {
    if (String(args[0]) === desk_) {
      reached = true;
      await gate.promise;
    }
    return real(...args);
  }) as unknown as typeof fsp.readdir);
  syncBuiltinESMExports();
  const { desk } = await restarted(h, sessionId);
  try {
    const starting = desk.start();
    await waitFor("the fence check", () => reached);
    const disposing = desk.dispose();
    gate.resolve();
    await starting;
    await disposing;
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(h.tree.agent(sessionId).followups, [], "nothing woken, nothing carried after the dispose began");
  assert.deepEqual(await carriedOf(h), [], "the carry waits for a later boot");
});

test("the cut-turn line goes through deliver, so OFF holds it", async (t) => {
  const h = await harness();
  const sessionId = await started(h);
  h.tree.logs.set(sessionId, cutLog(3, AT - 8 * 60_000));
  await writeOff(h.home, { by: "telegram" }, () => AT);
  const off = join(deskDir(h.home), OFF_FILE);
  let offReads = 0;
  const real = fsp.readFile as unknown as (...args: unknown[]) => Promise<unknown>;
  t.mock.method(fsp, "readFile", (async (...args: unknown[]) => {
    try {
      return await real(...args);
    } finally {
      if (String(args[0]) === off) offReads += 1;
    }
  }) as unknown as typeof fsp.readFile);
  syncBuiltinESMExports();
  const { desk, outlet } = await restarted(h, sessionId);
  try {
    await desk.start();
    await waitFor("the line's delivery reading the switch", () => offReads === 1);
    await new Promise((done) => setTimeout(done, 20));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(outlet.sent, [], "held back by the pause");
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.cancel]), [[3, "restart"]], "and recorded all the same");
  assert.deepEqual(h.lines, [], "a pause holding the line back is no failure");
  await desk.dispose();
});

/* ---------- what a graceful stop carried (spec §16 H3, R93) ---------- */

/** A `desk-carry` as a dispose writes one, at `t`, on `sessionId`. */
const carryOf = (sessionId: string, queued: { key: string; text: string; at?: string }[], cut?: { turn: number; key?: string; at?: string }, t = iso(AT - 5 * 60_000)) =>
  ({ t, kind: "desk-carry" as const, sessionId, queued, ...(cut === undefined ? {} : { cut }) });
/** 13:55 ET, when the carried texts were written. */
const WROTE = AT - 8 * 60_000;
const CARRIED = "[telegram · operator · 13:55 ET (carried over a restart)]";
/** The ledger's `desk-carried` events. */
const carriedOf = async (h: Harness) => (await events(h)).filter((e) => e.kind === "desk-carried");

test("the boot posts the carried texts again once, in order, keyed and marked carried, then records desk-carried; a second boot does nothing", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  const carry = carryOf(sessionId, [{ key: "telegram:2", text: "second", at: iso(WROTE) }, { key: "telegram:3", text: "third" }]);
  await appendEvent(h.home, carry);
  const first = await restarted(h, sessionId);
  await first.desk.start();
  const agent = h.tree.agent(sessionId);
  assert.deepEqual(agent.followups.map((m) => m.id), ["telegram:2", "telegram:3"], "each under its own key, in order");
  assert.equal(agent.text(0), `${CARRIED}\nsecond`, "written at 13:55, and said to be carried");
  assert.equal(agent.text(1), "[telegram · operator · 14:03 ET (carried over a restart)]\nthird", "no time kept: the boot's");
  assert.deepEqual(agent.followups.map((m) => (m.source as { kind?: unknown } | undefined)?.kind), ["telegram", "telegram"], "answered to the phone");
  assert.deepEqual(await carriedOf(h), [{ t: iso(AT), kind: "desk-carried", of: carry.t, posted: 2, skipped: 0 }]);
  assert.deepEqual(first.outlet.sent, [], "no cut, no line");
  assert.deepEqual(h.lines, []);

  agent.model!.pending.length = 0; // both answered before the next stop: nothing is left to carry again
  const second = await restarted(h, sessionId, first.desk);
  await second.desk.start();
  assert.equal(h.tree.agent(sessionId).followups.length, 0, "carried once");
  assert.equal((await carriedOf(h)).length, 1);
  await second.desk.dispose();
});

test("a carried Slack text keeps its network: its line says slack, and its record names the network", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  await appendEvent(h.home, carryOf(sessionId, [{ key: `slack:1730812345.001200#4@${iso(WROTE)}`, text: "from slack", at: iso(WROTE) }]));
  const { desk } = await restarted(h, sessionId);
  await desk.start();
  const agent = h.tree.agent(sessionId);
  assert.equal(agent.text(0), "[slack · operator · 13:55 ET (carried over a restart)]\nfrom slack");
  assert.deepEqual(agent.followups[0].source, { kind: "telegram", network: "slack", carried: true });
  await desk.dispose();
});

test("a carried key the session already holds is skipped and counted", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  h.tree.logs.set(sessionId, [logged(0, "telegram:2")]); // a turn claimed it before the stop: it ran
  const carry = carryOf(sessionId, [{ key: "telegram:2", text: "second" }, { key: "telegram:3", text: "third" }]);
  await appendEvent(h.home, carry);
  const { desk } = await restarted(h, sessionId);
  await desk.start();
  assert.deepEqual(h.tree.agent(sessionId).followups.map((m) => m.id), ["telegram:3"]);
  assert.deepEqual(await carriedOf(h), [{ t: iso(AT), kind: "desk-carried", of: carry.t, posted: 1, skipped: 1 }]);
  await desk.dispose();
});

test("the carried cut turn gets the restart line once, after its texts; OFF holds it back and the carry is still done", async () => {
  const h = await harness();
  const sessionId = await started(h);
  const carry = carryOf(sessionId, [], { turn: 4, key: "telegram:4", at: iso(WROTE) });
  await appendEvent(h.home, carry);
  const first = await restarted(h, sessionId);
  await first.desk.start();
  await waitFor("the line", () => first.outlet.sent.length === 1);
  assert.deepEqual(first.outlet.sent, [RESTART_LINE]);
  assert.deepEqual(await carriedOf(h), [{ t: iso(AT), kind: "desk-carried", of: carry.t, posted: 0, skipped: 0 }]);
  assert.deepEqual(await turnsOf(h), [], "the turn's own record is the shutdown's: none is added");
  const second = await restarted(h, sessionId, first.desk);
  await second.desk.start();
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(second.outlet.sent, [], "sent once");

  const paused = await harness();
  const pausedId = await started(paused);
  await appendEvent(paused.home, carryOf(pausedId, [], { turn: 4, at: iso(WROTE) }));
  await writeOff(paused.home, { by: "telegram" }, () => AT);
  const third = await restarted(paused, pausedId);
  await third.desk.start();
  await waitFor("the carry done", async () => (await carriedOf(paused)).length === 1);
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(third.outlet.sent, [], "held back by the pause");
  await third.desk.dispose();
});

test("a carried cut the resume's own closer already answered gets no second line", async () => {
  const h = await harness();
  const sessionId = await started(h);
  h.tree.logs.set(sessionId, cutLog(3, WROTE)); // 0.2.0-rc.2: the resume closed it `interrupted`
  await appendEvent(h.home, carryOf(sessionId, [], { turn: 3, key: "telegram:3", at: iso(WROTE) }));
  const { desk, outlet } = await restarted(h, sessionId);
  await desk.start();
  await waitFor("the line", () => outlet.sent.length === 1);
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(outlet.sent, [RESTART_LINE], "one line");
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.cancel]), [[3, "restart"]]);
  assert.equal((await carriedOf(h)).length, 1);
  await desk.dispose();
});

test("a turn a dispose aborted (0.2.1-rc.5's turn/end) is cut once: by the boot's restart line, or by the carry that names it", async () => {
  const disposedLog = (n: number): EventLike[] => [
    row(0, "turn/start", { turn: n }, WROTE),
    row(1, "user/message", { id: `telegram:${n}`, role: "user", content: say("x"), source: PHONE }, WROTE),
    row(2, "turn/end", { turn: n, reason: { kind: "aborted", reason: { kind: "disposed" } } }, WROTE + 1_000),
  ];
  const h = await harness();
  const sessionId = await started(h);
  h.tree.logs.set(sessionId, disposedLog(2)); // no carry names it: a turn woken during the dispose
  const first = await restarted(h, sessionId);
  await first.desk.start();
  await waitFor("the line", () => first.outlet.sent.length === 1);
  assert.deepEqual(first.outlet.sent, [RESTART_LINE]);
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.cancel]), [[2, "restart"]]);

  const named = await harness();
  const namedId = await started(named);
  named.tree.logs.set(namedId, disposedLog(2));
  await appendEvent(named.home, carryOf(namedId, [], { turn: 2, key: "telegram:2", at: iso(WROTE) }));
  const second = await restarted(named, namedId);
  await second.desk.start();
  await waitFor("the line", () => second.outlet.sent.length === 1);
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(second.outlet.sent, [RESTART_LINE], "one line, the carry's");
  assert.deepEqual(await turnsOf(named), [], "the boot's closer stood aside");
  await first.desk.dispose();
  await second.desk.dispose();
});

test("a fence violation at boot carries nothing and leaves the carry for a later boot", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  await appendEvent(h.home, carryOf(sessionId, [{ key: "telegram:2", text: "second" }], { turn: 1, at: iso(WROTE) }));
  await put(h.root, "desk/GRAVIT.md");
  const first = await restarted(h, sessionId);
  await first.desk.start();
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(h.tree.agent(sessionId).followups, [], "nothing posted over a violation");
  assert.deepEqual(first.outlet.sent, [], "and no line");
  assert.deepEqual(await carriedOf(h), [], "the carry is still pending");
  assert.equal((await events(h)).filter((e) => e.kind === "desk-refused").length, 1);

  await rm(join(h.root, "desk", "GRAVIT.md"));
  const second = await restarted(h, sessionId, first.desk);
  await second.desk.start();
  await waitFor("the line", () => second.outlet.sent.length === 1);
  assert.deepEqual(h.tree.agent(sessionId).followups.map((m) => m.id), ["telegram:2"], "a later boot carries it");
  assert.equal((await carriedOf(h)).length, 1);
  await second.desk.dispose();
});

test("a carried text the pause refuses stops the carry and leaves it for a later boot", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  await appendEvent(h.home, carryOf(sessionId, [{ key: "telegram:2", text: "second" }]));
  await writeOff(h.home, { by: "telegram" }, () => AT);
  const { desk } = await restarted(h, sessionId);
  await desk.start();
  assert.deepEqual(h.tree.agent(sessionId).followups, []);
  assert.deepEqual(await carriedOf(h), []);
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], /^gravit-face: desk: the texts a graceful stop carried could not all be posted again \(paused since .+\); a later boot tries again$/);
  await desk.dispose();
});

/* The final review of task 9 (I1): a carry a refusal left pending is not superseded by a later one - every carry no
 * `desk-carried` names is answered, oldest first, one `desk-carried` each. */
test("every pending carry is answered, oldest first: one refused under a pause, then a second written, one boot answers both", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  const c1 = carryOf(sessionId, [{ key: "telegram:2", text: "second" }], { turn: 1, key: "telegram:1", at: iso(WROTE) }, iso(AT - 9 * 60_000));
  await appendEvent(h.home, c1);
  await writeOff(h.home, { by: "telegram" }, () => AT);
  const first = await restarted(h, sessionId);
  await first.desk.start();
  assert.deepEqual(h.tree.agent(sessionId).followups, [], "the pause refuses C1's text");
  assert.deepEqual(await carriedOf(h), [], "C1 stays pending");
  h.tree.agent(sessionId).model!.pending.length = 0;

  const c2 = carryOf(sessionId, [{ key: "telegram:5", text: "fifth" }], { turn: 4, key: "telegram:4", at: iso(WROTE) }, iso(AT - 2 * 60_000));
  await appendEvent(h.home, c2);
  await clearOff(h.home, "terminal", () => AT);
  const second = await restarted(h, sessionId, first.desk);
  await second.desk.start();
  await waitFor("both lines", () => second.outlet.sent.length === 2);
  assert.deepEqual(h.tree.agent(sessionId).followups.map((m) => m.id), ["telegram:2", "telegram:5"], "C1's text, then C2's");
  assert.deepEqual((await carriedOf(h)).map((e) => (e.kind === "desk-carried" ? [e.of, e.posted, e.skipped] : [])),
    [[c1.t, 1, 0], [c2.t, 1, 0]], "one desk-carried each, in order");
  assert.deepEqual(second.outlet.sent, [RESTART_LINE, RESTART_LINE], "each carry's cut turn its own line");

  h.tree.agent(sessionId).model!.pending.length = 0; // both answered before the next stop
  const third = await restarted(h, sessionId, second.desk);
  await third.desk.start();
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(third.outlet.sent, []);
  assert.equal((await carriedOf(h)).length, 2);
  await third.desk.dispose();
});

test("a malformed desk-carry never stops the boot: it is skipped with one line, and the carries around it are answered", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  const ledger = join(deskDir(h.home), "events.jsonl");
  await fsp.appendFile(ledger, `${JSON.stringify({ t: iso(AT - 7 * 60_000), kind: "desk-carry", sessionId, queued: "not a list", cut: null })}\n`);
  await fsp.appendFile(ledger, `${JSON.stringify({ t: "never", kind: "desk-carry", sessionId, queued: [{ key: 7 }] })}\n`);
  const good = carryOf(sessionId, [{ key: "telegram:2", text: "second" }], undefined, iso(AT - 6 * 60_000));
  await appendEvent(h.home, good);
  const { desk } = await restarted(h, sessionId);
  await desk.start(); // resolves: never rejects
  assert.deepEqual(h.tree.agent(sessionId).followups.map((m) => m.id), ["telegram:2"]);
  assert.deepEqual((await carriedOf(h)).map((e) => (e.kind === "desk-carried" ? e.of : "")), [good.t]);
  assert.deepEqual(h.lines, [
    `gravit-face: desk: the desk-carry of ${iso(AT - 7 * 60_000)} in the ledger is malformed and is skipped`,
    "gravit-face: desk: the desk-carry of never in the ledger is malformed and is skipped",
  ]);
  await desk.dispose();
});

test("carried texts are posted without the desk state: the boot is not held by its wait", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const sessionId = await started(h);
  await appendEvent(h.home, carryOf(sessionId, Array.from({ length: 20 }, (_, i) => ({ key: `telegram:${i + 10}`, text: `t${i}` }))));
  const { desk } = await restarted(h, sessionId);
  let asked = 0;
  desk.setState(() => { asked += 1; return new Promise(() => {}); }); // a state that never answers
  await desk.start(); // on the manual clock a state wait would never end
  assert.equal(asked, 0, "the state is never asked for a carried text");
  assert.equal(h.tree.agent(sessionId).followups.length, 20);
  assert.ok(h.tree.agent(sessionId).followups.every((m) => m.content.length === 1 && !(m.content[0]?.text ?? "").startsWith("[desk · state")));
  assert.equal(h.tree.agent(sessionId).injects.length, 0);
  await desk.dispose();
});

test("renew supervises the new session and stop cancels with the reason", async () => {
  const h = await harness();
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const { sessionId: old } = (await post(h, "hi")) as { sessionId: string };
  const renewed = await h.desk.renew();
  assert.notEqual(renewed.sessionId, old);
  assert.deepEqual((await events(h)).map((e) => (e.kind === "desk-session" ? [e.sessionId, e.reason] : [e.kind])), [[old, "created"], [renewed.sessionId, "new"]]);
  assert.deepEqual(h.desk.current(), { sessionId: renewed.sessionId, running: false });
  assert.equal(h.bus.listeners.size, 1, "the old session was idle: its supervision went at once");

  turn(h, old, 1, PHONE, "the old conversation, unsupervised");
  turn(h, renewed.sessionId, 1, PHONE, "the new conversation");
  await waitFor("the new turn's delivery", () => outlet.sent.length === 1);
  assert.deepEqual(outlet.sent, ["the new conversation"]);
  assert.deepEqual((await turnsOf(h)).map((e) => e.sessionId), [renewed.sessionId]);

  const fresh = h.tree.agent(renewed.sessionId);
  assert.equal(await h.desk.stop("stopped from the phone"), false, "nothing runs");
  assert.deepEqual(fresh.cancels, []);
  fresh.status = "running";
  assert.deepEqual(h.desk.current(), { sessionId: renewed.sessionId, running: true });
  assert.equal(await h.desk.stop("stopped from the phone"), true);
  assert.deepEqual(fresh.cancels, [[{ kind: "hook", reason: "stopped from the phone" }, { keepInbox: true }]], "the turn under way, and only it");
  const next = await post(h, "after the renew");
  assert.deepEqual(next, { opened: true, sessionId: renewed.sessionId }, "posts go to the new conversation");
});

test("a turn running at renew still ends with its record and its delivery, then its supervision is gone", async () => {
  const h = await harness();
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const { sessionId: old } = (await post(h, "a long question")) as { sessionId: string };
  const oldAgent = h.tree.agent(old);
  oldAgent.status = "running";
  startTurn(h, old, 1, PHONE);

  const { sessionId: fresh } = await h.desk.renew();
  assert.equal(h.bus.listeners.size, 2, "the old supervision retires with its turn still running");

  answer(h, old, 1, "the old answer");
  endTurn(h, old, 1);
  await waitFor("the old turn's delivery", () => outlet.sent.length === 1);
  assert.deepEqual(outlet.sent, ["the old answer"]);
  assert.deepEqual((await turnsOf(h)).map((e) => [e.sessionId, e.turn, e.outcome]), [[old, 1, "ended"]]);
  assert.equal(h.bus.listeners.size, 2, "still there until the old agent is idle");

  oldAgent.settle();
  await waitFor("the old supervision's end", () => h.bus.listeners.size === 1);
  turn(h, old, 2, PHONE, "unsupervised now");
  turn(h, fresh, 1, PHONE, "the new conversation");
  await waitFor("the new turn's delivery", () => outlet.sent.length === 2);
  assert.deepEqual(outlet.sent, ["the old answer", "the new conversation"]);
  assert.deepEqual((await turnsOf(h)).map((e) => [e.sessionId, e.turn]), [[old, 1], [fresh, 1]]);
});

test("a stop reaches a retiring turn as well as the current one, and current() says a turn runs while one does", async () => {
  const h = await harness();
  const { sessionId: old } = (await post(h, "a long question")) as { sessionId: string };
  const oldAgent = h.tree.agent(old);
  oldAgent.status = "running";
  startTurn(h, old, 1, PHONE);
  const { sessionId: fresh } = await h.desk.renew();
  assert.deepEqual(h.desk.current(), { sessionId: fresh, running: true }, "the retiring turn still runs");
  const freshAgent = h.tree.agent(fresh);
  freshAgent.status = "running";
  assert.equal(await h.desk.stop("stopped from the phone"), true);
  assert.deepEqual(oldAgent.cancels, [[{ kind: "hook", reason: "stopped from the phone" }, { keepInbox: true }]]);
  assert.deepEqual(freshAgent.cancels, [[{ kind: "hook", reason: "stopped from the phone" }, { keepInbox: true }]]);
});

/* The operator sends Q1, then Q2 and Q3 while Q1 runs, then /stop: the stop cancels "the desk session's current turn"
 * (spec §5.6), not the operator's later messages. The agent here has dsh's inbox and wake (tests/inbox-fake.ts): a
 * cancel that cleared the inbox would drop Q2 and Q3 unrecorded, and one that only kept it would leave them queued
 * and unanswered until the next message, as tests/desk-smoke.test.ts measures on a real tree. */
test("stop cuts only the turn under way: the messages queued behind it are answered, in order, and the cut turn is recorded cancelled", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const { sessionId } = (await post(h, "first")) as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  const model = agent.model!;
  assert.equal(model.claim()?.content[0]?.text, "[telegram · operator · 14:03 ET]\nfirst", "the driver takes the first message for turn 1");
  model.running = true;
  agent.status = "running";
  startTurn(h, sessionId, 1, PHONE);
  assert.deepEqual(await post(h, "second"), { opened: true, sessionId });
  assert.deepEqual(await post(h, "third"), { opened: true, sessionId });
  assert.equal(model.pending.length, 2, "both wait for turns of their own");

  assert.equal(await h.desk.stop("stopped from the phone"), true);
  assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "stopped from the phone" }, { keepInbox: true }]], "the turn under way, the inbox kept");
  endTurn(h, sessionId, 1, ABORTED("stopped from the phone"));
  agent.settle();
  assert.equal(model.converge(), true, "the agent wakes for what was queued once the cut turn has unwound");
  for (const [n, text] of [[2, "second"], [3, "third"]] as const) {
    assert.equal(model.claim()?.content[0]?.text, `[telegram · operator · 14:03 ET]\n${text}`, `turn ${n} takes ${text}, in the order it was sent`);
    turn(h, sessionId, n, PHONE, `the ${text} answer`);
  }
  await waitFor("both answers", () => outlet.sent.length === 2);
  assert.deepEqual(outlet.sent, ["the second answer", "the third answer"], "the stopped turn said nothing; the bridge answers /stop itself");
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.outcome, e.cancel]), [
    [1, "cancelled", "stopped from the phone"], [2, "ended", undefined], [3, "ended", undefined],
  ]);
  assert.deepEqual(h.lines, []);
});

/** Step 1 of turn `turn` writes `text` and is cut mid-stream: dsh writes what it had as an interrupted message. */
function interrupted(h: Harness, sessionId: string, turn: number, text: string): void {
  h.bus.emit(sessionId, "assistant/message", {
    turn, step: 1, interrupted: true,
    message: { id: `a-${sessionId}-${turn}`, role: "assistant", content: say(text), source: { kind: "model", provider: "stub", model: "echo" } },
  });
}

test("an answer cut mid-stream reaches the phone with a line naming the cut; a whole one goes as it is", async () => {
  const h = await harness();
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  startTurn(h, sessionId, 1, PHONE);
  interrupted(h, sessionId, 1, "NVDA is trading at 18");
  endTurn(h, sessionId, 1, ABORTED("stopped from the phone"));
  startTurn(h, sessionId, 2, ALERT);
  interrupted(h, sessionId, 2, "The 10-Q says revenue");
  await h.time.fake.advance(300_000);
  endTurn(h, sessionId, 2, ABORTED("desk deadline"));
  /* the browser's stop after the answer was whole: the phone gets the answer, unmarked */
  startTurn(h, sessionId, 3, PHONE);
  answer(h, sessionId, 3, "Noting it.");
  endTurn(h, sessionId, 3, { kind: "aborted", reason: { kind: "user" } });
  await waitFor("three replies", () => outlet.sent.length === 3);
  assert.deepEqual(outlet.sent, [
    "NVDA is trading at 18\n(cut off: stopped from the phone)",
    "The 10-Q says revenue\n(cut off: timed out after 5 min)",
    "Noting it.",
  ]);
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.outcome, e.cancel]), [
    [1, "cancelled", "stopped from the phone"], [2, "timed-out", undefined], [3, "cancelled", "stopped in the browser"],
  ]);
});

test("a retiring turn keeps its deadline", async () => {
  const h = await harness();
  const { sessionId: old } = (await post(h, "a long question")) as { sessionId: string };
  const oldAgent = h.tree.agent(old);
  oldAgent.status = "running";
  startTurn(h, old, 1, PHONE);
  await h.time.fake.advance(200_000);
  await h.desk.renew();
  await h.time.fake.advance(100_000);
  assert.deepEqual(oldAgent.cancels, [[{ kind: "hook", reason: "desk deadline" }, { keepInbox: true }]], "five minutes from its own start");
});

test("dispose cancels a running turn with the shutdown reason, once", async () => {
  const h = await harness();
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  agent.status = "running";
  startTurn(h, sessionId, 1, PHONE);
  const first = h.desk.dispose();
  const second = h.desk.dispose();
  assert.equal(second, first, "a second call settles with the first");
  await waitFor("the shutdown cancel", () => agent.cancels.length === 1);
  agent.settle(); // the cut turn's driver retires
  await first;
  await h.desk.dispose();
  assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "shutdown" }]]);
  assert.equal(h.bus.listeners.size, 0, "the supervision is gone");
  await h.time.fake.advance(600_000);
  assert.equal(agent.cancels.length, 1, "no deadline fires after dispose");
  assert.deepEqual(await post(h, "too late"), { refused: "error", line: "the desk could not open a turn: the desk is shut down" });
  assert.equal(agent.followups.length, 1);
  await assert.rejects(h.desk.renew(), /the desk is shut down/);
  assert.equal(await h.desk.stop("stopped from the phone"), false);
});

/* A graceful stop (spec §16 H3, R93): dsh's teardown clears the desk session's inbox whatever the desk's own cancel
 * keeps (measured on a real tree, .superpowers/sdd/2026-11-02-desk-hardening/graceful-stop-measurement.md), so the
 * phone's texts queued behind the turn under way, and that turn, go through the ledger instead: one `desk-carry`,
 * written before anything is cancelled, which the next boot answers. */
test("dispose records the phone's queued texts and the turn under way in one desk-carry, read in the cancel's own tick, and the shutdown cancel keeps nothing", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const wroteFirst = AT - 2 * 60_000; // 14:01 ET
  const wroteSecond = AT - 60_000; // 14:02 ET
  const first = await h.desk.post({ text: "first", source: { kind: "telegram", at: wroteFirst }, message: PHONE, key: "telegram:1" });
  const { sessionId } = first as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  const model = agent.model!;
  const claimed = model.claim()!;
  model.running = true;
  agent.status = "running";
  h.bus.emit(sessionId, "turn/start", { turn: 1 });
  h.bus.emit(sessionId, "user/message", claimed);
  await h.desk.post({ text: "second", source: { kind: "telegram", at: wroteSecond }, message: PHONE, key: "telegram:2" });
  await h.desk.post({ text: "a browser's", source: { kind: "telegram" }, message: BROWSER as { kind: string } & Record<string, unknown> });
  await h.desk.post({ text: "third", source: { kind: "telegram" }, message: PHONE, key: "telegram:3", context: "[alert · NVDA · buy_zone]\nNVDA 181.50" });
  model.steps.push(pending("telegram:4", PHONE)); // a steer the turn under way has not taken yet
  assert.deepEqual(model.pending.map((m) => m.id).filter((id) => id.startsWith("telegram:")), ["telegram:2", "telegram:3"]);
  /* what the inbox held at the moment of the cancel: the carry is read in the same tick, so it is exactly this */
  let atCancel: string[] = [];
  const cancel = agent.cancel.bind(agent);
  agent.cancel = (...args: unknown[]) => {
    atCancel = [...model.pending, ...model.steps].map((m) => m.id).filter((id) => id.startsWith("telegram:"));
    cancel(...args);
  };
  const disposing = h.desk.dispose();
  await waitFor("the shutdown cancel", () => agent.cancels.length === 1);
  endTurn(h, sessionId, 1, ABORTED("shutdown"));
  agent.settle();
  await disposing;
  assert.deepEqual(atCancel, ["telegram:2", "telegram:3", "telegram:4"], "nothing claimed between the snapshot and the cancel");
  assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "shutdown" }]], "the shutdown cancel keeps nothing: the ledger carries it");
  assert.deepEqual(model.pending, [], "dsh clears the inbox");
  const carries = (await events(h)).filter((e) => e.kind === "desk-carry");
  assert.deepEqual(carries, [{
    t: iso(AT), kind: "desk-carry", sessionId,
    queued: [
      { key: "telegram:2", text: "second", at: iso(wroteSecond) },
      { key: "telegram:3", text: "third" },
      { key: "telegram:4", text: "telegram:4" },
    ],
    cut: { turn: 1, key: "telegram:1", at: iso(wroteFirst) },
  }], "the phone's texts only, the operator's words only, oldest first, the next step's after the next turn's");
  assert.deepEqual(h.lines, []);
});

/** dsh-agent's `agent/inbox/claimed`, as a test fires it: `onClaimed` for the harness, and `claim(agent, turn)`, which
 * takes the oldest waiting message off the agent's inbox and tells every listener, as dsh-agent-loop's `preStep` does
 * before the turn logs it. */
function claimsBus(): { onClaimed: NonNullable<DeskConversationDeps["onClaimed"]>; claim(agent: FakeDeskAgent, turn: number): MessageLike; listeners: Set<unknown> } {
  const listeners = new Set<Parameters<NonNullable<DeskConversationDeps["onClaimed"]>>[0]>();
  return {
    listeners,
    onClaimed: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    claim(agent, turn) {
      const message = agent.model!.claim()!;
      for (const listener of [...listeners]) listener({ agent, message, turn });
      return message;
    },
  };
}

/* The final review of task 9 (I2): the snapshot and the cancel are one tick, so a turn that ends while the dispose is
 * still asking who is busy, and the next turn that claims a queued text and logs it, are both read as they are at the
 * cancel: the claiming turn is the carry's cut, the text no longer queued. A claimed text not yet logged is the next
 * test's. */
test("a turn that claims and logs a queued text before the shutdown's snapshot is the carry's cut; after it, the cancel has cleared the inbox", async () => {
  const claims = claimsBus();
  const h = await harness({ onClaimed: claims.onClaimed });
  h.tree.inboxes = true;
  const { sessionId } = (await h.desk.post({ text: "first", source: { kind: "telegram" }, message: PHONE, key: "telegram:1" })) as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  const model = agent.model!;
  h.bus.emit(sessionId, "turn/start", { turn: 1 });
  h.bus.emit(sessionId, "user/message", model.claim()!);
  model.running = true;
  agent.status = "running";
  await h.desk.post({ text: "second", source: { kind: "telegram" }, message: PHONE, key: "telegram:2" });
  await h.desk.post({ text: "third", source: { kind: "telegram" }, message: PHONE, key: "telegram:3" });
  /* while the dispose asks whether the agent is busy, turn 1 ends and turn 2 claims telegram:2 */
  const whenIdle = agent.whenIdle.bind(agent);
  let moved = false;
  agent.whenIdle = () => {
    if (!moved) {
      moved = true;
      endTurn(h, sessionId, 1);
      h.bus.emit(sessionId, "turn/start", { turn: 2 });
      h.bus.emit(sessionId, "user/message", claims.claim(agent, 2)); // claimed, then logged
    }
    return whenIdle();
  };
  let claimedAfter: MessageLike | undefined;
  const cancel = agent.cancel.bind(agent);
  agent.cancel = (...args: unknown[]) => {
    cancel(...args);
    claimedAfter = model.claim(); // the next turn's driver, the moment after the cancel
  };
  const disposing = h.desk.dispose();
  await waitFor("the shutdown cancel", () => agent.cancels.length === 1);
  endTurn(h, sessionId, 2, ABORTED("shutdown"));
  agent.settle();
  await disposing;
  assert.equal(claimedAfter, undefined, "nothing left to claim once the cancel has run");
  const carries = (await events(h)).filter((e) => e.kind === "desk-carry");
  assert.deepEqual(carries.map((e) => (e.kind === "desk-carry" ? [e.queued.map((q) => q.key), e.cut] : [])),
    [[["telegram:3"], { turn: 2, key: "telegram:2" }]], "the turn that claimed telegram:2 is the cut, telegram:3 still queued");
});

/* The re-review's N1: dsh claims a step's input in `preStep` and logs its `user/message` only after the prompt is
 * assembled and the pre-step hooks have run (dsh-agent-loop lib/index.js 906, 1061). A snapshot in that window finds the
 * text neither in the inbox nor in the open turn's name; dsh-agent's `agent/inbox/claimed` is what says it was taken. */
test("a text dsh has claimed for the open turn but not yet logged is carried, from agent/inbox/claimed", async () => {
  const claims = claimsBus();
  const h = await harness({ onClaimed: claims.onClaimed });
  h.tree.inboxes = true;
  const wrote = AT - 3 * 60_000; // 14:00 ET
  const { sessionId } = (await h.desk.post({ text: "first", source: { kind: "telegram", at: wrote }, message: PHONE, key: "telegram:1" })) as { sessionId: string };
  await h.desk.post({ text: "second", source: { kind: "telegram" }, message: PHONE, key: "telegram:2" });
  const agent = h.tree.agent(sessionId);
  agent.model!.running = true;
  agent.status = "running";
  h.bus.emit(sessionId, "turn/start", { turn: 1 });
  const claimed = claims.claim(agent, 1); // out of the inbox; its user/message not yet logged
  assert.equal(claimed.id, "telegram:1");
  assert.deepEqual(agent.model!.pending.map((m) => m.id), ["telegram:2"]);
  const disposing = h.desk.dispose(); // the snapshot falls in the window
  await waitFor("the shutdown cancel", () => agent.cancels.length === 1);
  h.bus.emit(sessionId, "user/message", claimed); // logged only after the snapshot
  endTurn(h, sessionId, 1, ABORTED("shutdown"));
  agent.settle();
  await disposing;
  const carries = (await events(h)).filter((e) => e.kind === "desk-carry");
  assert.deepEqual(carries, [{
    t: iso(AT), kind: "desk-carry", sessionId,
    queued: [{ key: "telegram:1", text: "first", at: iso(wrote) }, { key: "telegram:2", text: "second" }],
  }], "the claimed text first, then the one still queued; no cut, the turn was not yet named");
  assert.equal(claims.listeners.size, 0, "the claims are no longer heard after dispose");

  /* a claim that was logged before the snapshot is the turn's own: the cut, not carried as queued */
  const logged = claimsBus();
  const k = await harness({ onClaimed: logged.onClaimed });
  k.tree.inboxes = true;
  const { sessionId: other } = (await k.desk.post({ text: "first", source: { kind: "telegram" }, message: PHONE, key: "telegram:1" })) as { sessionId: string };
  const otherAgent = k.tree.agent(other);
  otherAgent.status = "running";
  k.bus.emit(other, "turn/start", { turn: 1 });
  k.bus.emit(other, "user/message", logged.claim(otherAgent, 1));
  const disposingK = k.desk.dispose();
  await waitFor("the shutdown cancel", () => otherAgent.cancels.length === 1);
  otherAgent.settle();
  await disposingK;
  assert.deepEqual((await events(k)).filter((e) => e.kind === "desk-carry").map((e) => (e.kind === "desk-carry" ? [e.queued, e.cut?.key] : [])),
    [[[], "telegram:1"]]);
});

test("dispose writes no desk-carry when no phone text waits and no phone turn is under way", async () => {
  const h = await harness();
  h.tree.inboxes = true;
  const { sessionId } = (await post(h, "hi", { kind: "telegram" }, BROWSER)) as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  agent.model!.claim();
  agent.model!.running = true;
  agent.status = "running";
  startTurn(h, sessionId, 1, BROWSER); // the browser's turn: no phone's to carry
  agent.model!.pending.push(pending("m-alert", ALERT)); // an alert waiting: the watch has its own record of it
  const disposing = h.desk.dispose();
  await waitFor("the shutdown cancel", () => agent.cancels.length === 1);
  endTurn(h, sessionId, 1, ABORTED("shutdown"));
  agent.settle();
  await disposing;
  assert.deepEqual(await kinds(h), ["desk-session", "desk-turn"]);

  const idle = await harness();
  await post(idle, "hi");
  await idle.desk.dispose();
  assert.deepEqual(await kinds(idle), ["desk-session"], "an idle desk with nothing queued carries nothing");
});

test("a carry that cannot be written is one line, and the shutdown goes on", async (t) => {
  const h = await harness();
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  agent.status = "running";
  startTurn(h, sessionId, 1, PHONE);
  const ledger = join(deskDir(h.home), "events.jsonl");
  const real = fsp.appendFile as unknown as (...args: unknown[]) => Promise<unknown>;
  t.mock.method(fsp, "appendFile", (async (...args: unknown[]) => {
    if (String(args[0]) === ledger) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    return real(...args);
  }) as unknown as typeof fsp.appendFile);
  syncBuiltinESMExports();
  try {
    const disposing = h.desk.dispose();
    await waitFor("the shutdown cancel", () => agent.cancels.length === 1);
    agent.settle();
    await disposing;
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "shutdown" }]]);
  assert.equal(h.lines.length, 1, h.lines.join("\n"));
  assert.match(h.lines[0], /^gravit-face: the desk ledger at .+events\.jsonl could not be written: ENOSPC$/);
});

test("a turn cut at shutdown is recorded before dispose resolves", async () => {
  const h = await harness();
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  agent.status = "running";
  startTurn(h, sessionId, 1, PHONE);
  let resolved = false;
  const disposing = h.desk.dispose().then(() => { resolved = true; });
  await waitFor("the shutdown cancel", () => agent.cancels.length === 1);
  await h.time.fake.advance(1_000);
  assert.equal(resolved, false, "it waits for the agent it cut");
  endTurn(h, sessionId, 1, ABORTED("shutdown")); // the loop ends the turn after the cancel
  agent.settle();
  await disposing;
  assert.deepEqual((await turnsOf(h)).map((e) => [e.sessionId, e.turn, e.source, e.wallMs, e.outcome, e.cancel]), [[sessionId, 1, "telegram", 1_000, "cancelled", "shutdown"]],
    "recorded as cancelled, by the shutdown");
  assert.equal(h.bus.listeners.size, 0);
});

test("dispose waits two seconds at most for an agent it cut", async () => {
  const h = await harness();
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  agent.status = "running";
  startTurn(h, sessionId, 1, PHONE);
  let resolved = false;
  const disposing = h.desk.dispose().then(() => { resolved = true; });
  await waitFor("the shutdown cancel", () => agent.cancels.length === 1);
  await h.time.fake.advance(1_999);
  assert.equal(resolved, false);
  await h.time.fake.advance(1);
  await disposing;
  assert.equal(h.bus.listeners.size, 0, "the supervision ends all the same");
  assert.deepEqual(await turnsOf(h), [], "no turn/end came: nothing to record");
});

test("dispose during a retiring turn cancels it once", async () => {
  const h = await harness();
  const { sessionId: old } = (await post(h, "hi")) as { sessionId: string };
  const oldAgent = h.tree.agent(old);
  oldAgent.status = "running";
  startTurn(h, old, 1, PHONE);
  const { sessionId: fresh } = await h.desk.renew();
  assert.equal(h.bus.listeners.size, 2);
  const disposing = Promise.all([h.desk.dispose(), h.desk.dispose()]);
  await waitFor("the shutdown cancel", () => oldAgent.cancels.length === 1);
  endTurn(h, old, 1, ABORTED("shutdown"));
  oldAgent.settle();
  await disposing;
  assert.deepEqual(oldAgent.cancels, [[{ kind: "hook", reason: "shutdown" }]]);
  assert.deepEqual(h.tree.agent(fresh).cancels, [], "the idle new conversation has nothing to cancel");
  assert.equal(h.bus.listeners.size, 0, "every supervision is gone, the retiring one included");
  assert.deepEqual((await turnsOf(h)).map((e) => [e.sessionId, e.turn]), [[old, 1]], "and the retiring turn it cut is recorded");
});

test("work the status does not show - maintenance with a followup latched - is work under way to stop, retire and dispose", async () => {
  const h = await harness();
  const { sessionId: old } = (await post(h, "hi")) as { sessionId: string };
  const oldAgent = h.tree.agent(old);
  oldAgent.maintaining = true; // dsh reads idle here, while whenIdle waits
  assert.deepEqual(h.desk.current(), { sessionId: old, running: false }, "the status says idle");
  assert.equal(await h.desk.stop("stopped from the phone"), true, "stop goes by whenIdle");
  assert.deepEqual(oldAgent.cancels, [[{ kind: "hook", reason: "stopped from the phone" }, { keepInbox: true }]]);
  const { sessionId: fresh } = await h.desk.renew();
  assert.equal(h.bus.listeners.size, 2, "retired, not ended: whenIdle still waits");
  const disposing = h.desk.dispose();
  await waitFor("the shutdown cancel", () => oldAgent.cancels.length === 2);
  assert.deepEqual(oldAgent.cancels[1], [{ kind: "hook", reason: "shutdown" }]);
  oldAgent.settle();
  await disposing;
  assert.equal(h.bus.listeners.size, 0);
  assert.deepEqual(h.tree.agent(fresh).cancels, []);
});

test("a renew that a dispose lands on while it ensures resolves nothing and supervises nothing", async () => {
  const h = await harness();
  await post(h, "hi");
  let open: () => void = () => {};
  h.tree.gate = new Promise((done) => { open = done; });
  const renewing = h.desk.renew();
  await waitFor("the fresh create under way", () => h.tree.created.length === 2);
  const disposing = h.desk.dispose();
  open();
  await assert.rejects(renewing, /the desk is shut down/);
  await disposing;
  assert.equal(h.bus.listeners.size, 0, "the new conversation is not supervised");
});

test("a supervision that cannot be ended is one line, never an unhandled rejection, even from the idle wait", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    const broken = fakeBus();
    const on: SessionEventsOn = (name, listener) => {
      broken.on(name, listener);
      return () => { throw new Error("the bus is gone"); };
    };
    const h = await harness({ on });
    const { sessionId: old } = (await post(h, "hi")) as { sessionId: string };
    const oldAgent = h.tree.agent(old);
    oldAgent.status = "running";
    const { sessionId: fresh } = await h.desk.renew();
    oldAgent.settle(); // the retiring supervision ends from the idle wait's promise
    await waitFor("the retiring supervision's line", () => h.lines.length === 1);
    await h.desk.dispose();
    assert.deepEqual(h.lines, [
      `gravit-face: desk: the supervision of desk session ${old} could not be ended: the bus is gone`,
      `gravit-face: desk: the supervision of desk session ${fresh} could not be ended: the bus is gone`,
    ]);
    await new Promise((done) => setTimeout(done, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a dispose that lands while a post is ensuring waits for it, and the turn stays unopened and the session unsupervised", async () => {
  const h = await harness();
  let open: () => void = () => {};
  h.tree.gate = new Promise((done) => { open = done; });
  const pending = post(h, "hi");
  await waitFor("the create under way", () => h.tree.created.length === 1);
  let resolved = false;
  const disposing = h.desk.dispose().then(() => { resolved = true; });
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(resolved, false, "dispose waits for the post under way");
  open();
  await disposing;
  assert.deepEqual(await pending, { refused: "error", line: "the desk could not open a turn: the desk is shut down" });
  assert.deepEqual(await kinds(h), ["desk-session"], "the ensure's record landed before dispose resolved");
  assert.equal(h.tree.agents.length, 1, "the ensure itself finished");
  assert.deepEqual(h.tree.agents[0].followups, [], "but nothing was sent");
  assert.equal(h.bus.listeners.size, 0, "and nothing is supervised");
  assert.deepEqual(h.lines, []);
});

test("dispose waits five seconds at most for a start, post or renew under way", async () => {
  const h = await harness();
  let open: () => void = () => {};
  h.tree.gate = new Promise((done) => { open = done; });
  const starting = h.desk.start();
  await waitFor("the create under way", () => h.tree.created.length === 1);
  let resolved = false;
  const disposing = h.desk.dispose().then(() => { resolved = true; });
  await h.time.fake.advance(4_999);
  assert.equal(resolved, false);
  await h.time.fake.advance(1);
  await disposing;
  open();
  await starting;
  assert.equal(h.bus.listeners.size, 0, "a start that finishes after dispose supervises nothing");
});

/* ---------- deliver and the budget (P2) ---------- */

test("deliver goes to the outlet, or says why not", async () => {
  const h = await harness();
  assert.deepEqual(await h.desk.deliver("nobody to hear it", { kind: "report" }), { undelivered: "no phone" });
  await writeOff(h.home, { by: "page" }, () => AT);
  assert.deepEqual(await h.desk.deliver("nobody to hear it", { kind: "report" }), { undelivered: "paused" }, "the pause is read first: it outranks a missing outlet");
  await clearOff(h.home, "terminal");

  const asked: unknown[][] = [];
  let answer = (): Promise<{ sent: string[]; queued?: true } | { queued: true }> => Promise.resolve({ sent: ["telegram:11"] });
  h.desk.setOutlet({ send: (...args) => { asked.push(args); return answer(); } });
  assert.deepEqual(await h.desk.deliver("the pre-close brief", { kind: "brief" }), { sent: ["telegram:11"] });
  assert.deepEqual(await h.desk.deliver("an annotation", { kind: "alert", replyTo: "telegram:77" }), { sent: ["telegram:11"] });
  answer = () => Promise.resolve({ queued: true });
  assert.deepEqual(await h.desk.deliver("Telegram is unreachable", { kind: "report" }), { queued: true }, "the outlet's answer, whatever it is");
  assert.deepEqual(asked, [["the pre-close brief", { kind: "brief" }], ["an annotation", { kind: "alert", replyTo: "telegram:77" }], ["Telegram is unreachable", { kind: "report" }]]);

  /* OFF holds a text back and the outlet is never asked; deliver reads the switch and lifts nothing, and a pause past its
   * until is not in force. */
  await writeOff(h.home, { by: "telegram", until: AT + 3_600_000 }, () => AT - 60_000);
  assert.deepEqual(await h.desk.deliver("held back", { kind: "report" }), { undelivered: "paused" });
  assert.equal(asked.length, 3, "the outlet was not called");
  await writeOff(h.home, { by: "terminal", until: AT - 1 }, () => AT - 3_600_000);
  answer = () => Promise.resolve({ sent: ["telegram:12"] });
  assert.deepEqual(await h.desk.deliver("after the pause", { kind: "report" }), { sent: ["telegram:12"] });
  assert.deepEqual(await kinds(h), ["off-set", "off-cleared", "off-set", "off-set"], "deliver wrote nothing: no off-cleared for the expired pause");
  await clearOff(h.home, "terminal");

  /* A send that rejects or throws is one line and send failed; one that keeps the outlet past a minute is one line too. */
  answer = () => Promise.reject(new Error("boom"));
  assert.deepEqual(await h.desk.deliver("lost", { kind: "report" }), { undelivered: "send failed: boom" });
  answer = () => { throw new Error("the bridge fell over"); };
  assert.deepEqual(await h.desk.deliver("also lost", { kind: "report" }), { undelivered: "send failed: the bridge fell over" });
  answer = () => new Promise(() => {});
  const stuck = h.desk.deliver("into the void", { kind: "report" });
  await waitFor("the stuck send", () => asked.length === 7);
  await h.time.fake.advance(59_999);
  let settled = false;
  void stuck.then(() => { settled = true; });
  await h.time.fake.flush();
  assert.equal(settled, false, "a minute is the bound, not less");
  await h.time.fake.advance(1);
  assert.deepEqual(await stuck, { undelivered: "the outlet did not answer in 60 s" });
  assert.deepEqual(h.lines, [
    "gravit-face: desk: a message could not be sent: boom",
    "gravit-face: desk: a message could not be sent: the bridge fell over",
    "gravit-face: desk: a message could not be sent: the outlet did not answer in 60 s",
  ]);
});

test("deliver holds a text back when the switch cannot be read: it never reads as no switch", async () => {
  const unreadable = join(await fixture("long"), "x".repeat(300)); // a name past NAME_MAX: every read under it fails
  const h = await harness({}, { home: unreadable });
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const result = await h.desk.deliver("hi", { kind: "report" });
  assert.match((result as { undelivered: string }).undelivered, /^the pause could not be read: ENAMETOOLONG: /);
  assert.deepEqual(outlet.sent, [], "the outlet was not called");
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], /^gravit-face: desk: a message could not be sent: the pause could not be read: ENAMETOOLONG: /);
});

/* P2-19: a turn's reply leaves through deliver. Deliveries keep turn order, so once turn 2's reply is sent, turn 1's was
 * decided - and the switch was read for it exactly once, while the pause held: the test counts the reads of OFF, so the
 * resume never races turn 1's delivery. */
test("a turn's text leaves through deliver, so a pause set during the turn holds it back", async (t) => {
  const h = await harness();
  const outlet = recordingOutlet();
  h.desk.setOutlet(outlet);
  const { sessionId } = (await post(h, "hi")) as { sessionId: string };
  startTurn(h, sessionId, 1, PHONE);
  await writeOff(h.home, { by: "telegram" }, () => AT); // the operator pauses from the phone while the turn runs
  const off = join(deskDir(h.home), OFF_FILE);
  let offReads = 0;
  const real = fsp.readFile as unknown as (...args: unknown[]) => Promise<unknown>;
  t.mock.method(fsp, "readFile", (async (...args: unknown[]) => {
    try {
      return await real(...args);
    } finally {
      if (String(args[0]) === off) offReads += 1;
    }
  }) as unknown as typeof fsp.readFile);
  syncBuiltinESMExports();
  try {
    answer(h, sessionId, 1, "an answer the pause holds back");
    endTurn(h, sessionId, 1);
    await waitFor("turn 1's delivery reading the switch", () => offReads === 1);
    await clearOff(h.home, "terminal");
    turn(h, sessionId, 2, PHONE, "an answer after the resume");
    await waitFor("turn 2's delivery", () => outlet.sent.length === 1);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(outlet.sent, ["an answer after the resume"], "turn 1's reply was held back");
  assert.deepEqual((await turnsOf(h)).map((e) => [e.turn, e.outcome]), [[1, "ended"], [2, "ended"]], "and its turn recorded all the same");
  assert.deepEqual(h.lines, [], "a pause holding a reply back is no failure");
});

test("a spent budget answers a post with the budget line and opens no turn; OFF outranks it", async () => {
  let state: BudgetState = {
    dailyTokens: 2_000_000,
    used: { uncachedInputTokens: 13_402, outputTokens: 0, cacheReadTokens: 2_000_000, cacheWriteTokens: 0, total: 2_013_402 },
    spent: true,
  };
  let asked = 0;
  const h = await harness({ budget: async () => { asked += 1; return state; } });
  await put(h.root, "desk/journal/.git/"); // the budget is read before the fence: a spent desk refuses as spent
  assert.deepEqual(await post(h, "hi"), {
    refused: "budget",
    line: "the desk's token budget for today is spent: 2,013,402 of 2,000,000 tokens since 00:00 ET; your text was not taken. It opens again at 00:00 ET, or raise budget.dailyTokens in standing.yml",
  });
  assert.equal(h.tree.created.length, 0, "no session ensured, no turn");
  assert.deepEqual(await kinds(h), [], "and no event");

  await writeOff(h.home, { by: "telegram" }, () => AT);
  const paused = await post(h, "hi");
  assert.equal((paused as { refused?: string }).refused, "paused", "OFF outranks the budget: the paused line, never the budget's");
  assert.equal(asked, 1, "a paused post does not read the budget");
  await clearOff(h.home, "terminal");

  state = { ...state, used: { ...state.used, cacheReadTokens: 1_986_597, total: 1_999_999 }, spent: false };
  await rm(join(h.root, "desk", "journal", ".git"), { recursive: true });
  const opened = await post(h, "hi");
  assert.deepEqual(opened, { opened: true, sessionId: h.tree.agents[0].id }, "under the cap, the post opens its turn");
  assert.equal(asked, 2);
  assert.equal(h.tree.agents[0].followups.length, 1);
  assert.deepEqual(h.lines, []);
});

test("a spent budget no longer refuses a phone post routed to the conversation (the fallback path keeps its check)", async (t) => {
  const SPENT: BudgetState = {
    dailyTokens: 2_000_000,
    used: { uncachedInputTokens: 13_402, outputTokens: 0, cacheReadTokens: 2_000_000, cacheWriteTokens: 0, total: 2_013_402 },
    spent: true,
  };
  /* the fallback: the desk session (FACE_ROUTER=0) still refuses */
  const h = await harness({ budget: async () => SPENT });
  const fallback = await post(h, "hi");
  assert.equal((fallback as { refused?: string }).refused, "budget");
  /* routed: Gravit's one conversation, its home outside any repository and its ledger showing the day spent, opens it */
  const home = await mkdtemp(join(tmpdir(), "face-desk-conv-routed-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await appendEvent(home, { t: new Date(AT).toISOString(), kind: "budget-spent", date: "2026-10-20", used: 2_013_402, dailyTokens: 2_000_000 });
  const tree = new FakeDeskTree();
  const bus = fakeBus();
  const conversation = installConversation({
    ctx: { ...tree.ctx, on: bus.on, workingDirectory: { set: async (_agent, path) => path } },
    home, route: ROUTE, installModelSelection: tree.install, now: () => AT, log: () => {},
  });
  t.after(() => conversation.dispose());
  const routed = await conversation.post({
    text: "hi", key: "telegram:7#1@2026-10-20T18:03:00.000Z",
    source: { kind: "telegram", network: "telegram", at: AT },
    message: { kind: "telegram", network: "telegram", messageId: "telegram:7" },
  });
  assert.ok("opened" in routed && routed.opened === true, JSON.stringify(routed));
  assert.equal(tree.agents.at(-1)!.followups.length, 1, "the conversation's turn is opened");
});

test("a budget that cannot be read is one line, and the desk goes on", async () => {
  for (const budget of [() => Promise.reject(new Error("the ledger is gone")), () => { throw new Error("the ledger is gone"); }]) {
    const h = await harness({ budget: budget as () => Promise<BudgetState> });
    assert.deepEqual(await post(h, "hi"), { opened: true, sessionId: h.tree.agents[0].id });
    assert.deepEqual(h.lines, ["gravit-face: desk: the token budget could not be read (the ledger is gone); the desk goes on"]);
  }
});

/* ---------- the desk state (P3) ----------
 * The alert annotations and their replies moved to their own lane (src/annotator.ts): tests/annotator.test.ts. */

const STATE = '{"holdings":[]}';

test("a phone post injects the desk state just before its followup, only when nothing is under way", async () => {
  const h = await harness();
  let asked = 0;
  h.desk.setState(async () => { asked += 1; return STATE; });
  const { sessionId } = (await post(h, "NVDA?")) as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  assert.deepEqual(agent.calls, ["inject", "followup"]);
  assert.equal(agent.injects[0].content[0]?.text, `[desk · state · 14:03 ET]\n${STATE}`);
  assert.deepEqual(agent.injects[0].source, { kind: "desk", form: "state" });
  assert.equal(agent.text(0), "[telegram · operator · 14:03 ET]\nNVDA?");

  agent.status = "running"; // a turn under way: the text queues behind it, and carries no state
  await post(h, "and AAPL?");
  assert.deepEqual(agent.calls, ["inject", "followup", "followup"]);
  agent.settle();

  await post(h, "NVDA 171.20", { kind: "alert", symbol: "NVDA", rule: "stop" }, ALERT);
  assert.deepEqual(agent.calls.slice(3), ["followup"], "a post that is not the phone's never injects");
  assert.equal(asked, 2, "nor asks for the state: the busy phone post did, and went without");

  delete agent.inject; // an agent without inject
  await post(h, "still there?");
  assert.deepEqual(agent.calls.slice(4), ["followup"]);

  h.desk.setState(undefined);
  agent.inject = (message) => { agent.calls.push("inject"); agent.injects.push(message); };
  await post(h, "no provider");
  assert.deepEqual(agent.calls.slice(5), ["followup"]);
  assert.equal(asked, 3, "asked by the busy post and the inject-less one too");
  assert.deepEqual(h.lines, []);
});

test("a desk state that is late, throws or has nothing goes without, the late and the thrown with one line", async () => {
  const h = await harness();
  const { sessionId } = (await post(h, "warm")) as { sessionId: string }; // no provider yet
  const agent = h.tree.agent(sessionId);

  let called = false;
  h.desk.setState(() => { called = true; return new Promise<string>(() => {}); });
  const slow = post(h, "slow");
  await waitFor("the state asked", () => called);
  await h.time.fake.advance(3_499);
  assert.equal(agent.followups.length, 1, "it waits for the state");
  await h.time.fake.advance(1);
  assert.deepEqual(await slow, { opened: true, sessionId });
  assert.deepEqual(agent.calls, ["followup", "followup"]);

  h.desk.setState(async () => { throw new Error("the Market read refused: 503"); });
  await post(h, "thrown");
  h.desk.setState(() => { throw new Error("sync throw"); });
  await post(h, "thrown at once");
  h.desk.setState(async () => undefined);
  await post(h, "nothing");
  assert.deepEqual(agent.calls, ["followup", "followup", "followup", "followup", "followup"]);
  assert.deepEqual(h.lines, [
    "gravit-face: desk: the desk state was not ready (it did not answer in 3.5 s); the message goes without it",
    "gravit-face: desk: the desk state was not ready (the Market read refused: 503); the message goes without it",
    "gravit-face: desk: the desk state was not ready (sync throw); the message goes without it",
  ]);
});

test("a turn that starts between the idle check and the inject gets no state: the status is read again at once", async () => {
  const h = await harness();
  const { sessionId } = (await post(h, "warm")) as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  h.desk.setState(async () => STATE);
  /* whenIdle answers idle, and a wake turn starts in the macrotask busy() waits through */
  agent.whenIdle = () => {
    queueMicrotask(() => { agent.status = "running"; });
    return Promise.resolve();
  };
  await post(h, "NVDA?");
  assert.deepEqual(agent.calls, ["followup", "followup"], "no inject into the running turn");
  assert.equal(agent.text(1), "[telegram · operator · 14:03 ET]\nNVDA?");
  assert.deepEqual(h.lines, []);
});

test("an inject that throws costs the phone text nothing; a followup that throws after one takes the state back", async () => {
  const h = await harness();
  const { sessionId } = (await post(h, "warm")) as { sessionId: string };
  const agent = h.tree.agent(sessionId);
  h.desk.setState(async () => STATE);
  agent.inject = () => { throw new Error("the inbox is closed"); };
  assert.deepEqual(await post(h, "NVDA?"), { opened: true, sessionId });
  assert.equal(agent.text(1), "[telegram · operator · 14:03 ET]\nNVDA?");
  assert.deepEqual(h.lines, ["gravit-face: desk: the desk state could not be injected (the inbox is closed); the message goes without it"]);

  /* an agent with dsh's inbox: the state waits there, and is taken out again when the followup throws */
  const model = new InboxModel();
  agent.model = model;
  agent.inject = (message) => { agent.calls.push("inject"); model.pending.push(message); };
  agent.failFollowup = "the driver is gone";
  const refused = await post(h, "AAPL?");
  assert.deepEqual(refused, { refused: "error", line: "the desk could not open a turn: the driver is gone" });
  assert.deepEqual(model.pending, [], "no state left as context for the next turn");
  assert.equal(h.lines.length, 2, "the refusal's own line only");

  /* without an inbox it cannot be taken back: one line says so */
  agent.model = undefined;
  agent.inject = (message) => { agent.injects.push(message); };
  await post(h, "MSFT?");
  assert.deepEqual(h.lines.slice(2), [
    "gravit-face: desk: the desk state could not be taken back (the agent has no inbox); it may reach the next turn",
    "gravit-face: desk: the desk could not open a turn: the driver is gone",
  ]);
});
