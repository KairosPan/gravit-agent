// face/tests/desk-conversation.test.ts
/** The desk conversation (src/desk-conversation.ts): the one owner of the desk session - the pause, the
 * fence and the ensure before a turn opens, the provenance line on the message, the supervision of every
 * turn, the ledger record at each turn's end and the delivery to the outlet, the switch to a renewed
 * session, stop and dispose. Offline: the real ensure (src/desk-session.ts) over a fake root slice, a fake
 * bus, a manual clock and a recording outlet. Repositories and homes sit INSIDE the repository, under
 * tests/tmp/<pid>/, as src/desk-session.ts's own tests keep theirs, and are removed afterwards. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileLock } from "@deepseek-ai/dsh-atomic-write";
import { DESK_PATH, readDesk } from "../src/cycle.ts";
import { OFF_FILE, deskDir, readEvents, readOffState, writeOff, type DeskEvent } from "../src/desk.ts";
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
  readonly cancels: unknown[][] = [];
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
        return { agent, dispose: async () => { this.live.delete(options.resumeSessionId); } };
      },
    },
    agentPresets: { mount: async (_agentCtx, id) => ({ id }) },
    permissionPresets: {
      set: (session, name) => { this.stored.set(session.id, name); },
      current: (session) => this.stored.get(session.id) ?? "read-only",
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
      return Promise.resolve({ sent: [sent.length] });
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
    "Your final text goes to the operator's phone, as plain text. A message with no bracketed line is the operator at the browser, "
      + "where your answer stays; a background job's notice is answered to the phone.",
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
