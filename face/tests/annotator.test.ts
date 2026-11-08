// face/tests/annotator.test.ts
/** The annotation lane (src/annotator.ts, spec §16 H1): each alert pass's plan check in a fresh desk agent of its own,
 * on a chain of its own - the pause, the budget and the fence before the agent is made, the 240 s deadline from its own
 * `turn/start`, the watchdog at the deadline plus the slack, the `desk-turn` record, the reply under the alert through
 * the conversation's `deliver`, the `annotated` note, and the agent let go. Offline: a fake agent factory and a fake
 * bus (tests/desk-fakes.ts) under the real supervisor, a WallClock, a recording `deliver`, and a home and a repository
 * under tests/tmp/<pid>/ for the ledger and the fence. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANNOTATED_TEXT_MAX, createAnnotator, type Annotator, type AnnotatorDeps } from "../src/annotator.ts";
import { clearOff, readEvents, writeOff, type BudgetState, type DeskEvent } from "../src/desk.ts";
import type { DeliverResult, DeskConversation, PostResult } from "../src/desk-conversation.ts";
import type { DeskSessionCtxLike } from "../src/desk-session.ts";
import type { AnnotatedRecord } from "../src/watch.ts";
import { fakeAgents, fakeBus, WallClock, type FakeAgents, type FakeBus } from "./desk-fakes.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, "tmp", `annotator-${process.pid}`);
let made = 0;
async function fixture(label: string): Promise<string> {
  const dir = join(TMP, `${++made}-${label}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
after(() => rm(TMP, { recursive: true, force: true }));

/** Poll until `ok` holds - the ledger settles on real file I/O, which no fake clock drives. */
async function waitFor(what: string, ok: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 2));
  }
}

/** 14:03 ET on 2026-10-20. */
const AT = "2026-10-20T18:03:00.000Z";
const ROUTE = { provider: "deepseek-official", model: "deepseek-flash" };
const USAGE = { inputTokens: 1200, outputTokens: 34, cacheReadTokens: 1000, cacheWriteTokens: 0, totalTokens: 2234 };

interface Harness {
  root: string;
  home: string;
  agents: FakeAgents;
  bus: FakeBus;
  clock: WallClock;
  sent: [string, string | undefined][];
  kinds: string[];
  noted: AnnotatedRecord[];
  lines: string[];
  annotator: Annotator;
}

async function harness(over: Partial<AnnotatorDeps> = {}, deliver?: (text: string, n: number) => Promise<DeliverResult>): Promise<Harness> {
  const root = await fixture("repo");
  const home = await fixture("home");
  const agents = fakeAgents();
  const bus = fakeBus();
  const clock = new WallClock(AT);
  const sent: Harness["sent"] = [];
  const kinds: string[] = [];
  const noted: AnnotatedRecord[] = [];
  const lines: string[] = [];
  const annotator = createAnnotator({
    session: { ctx: {} as DeskSessionCtxLike, root, home, route: ROUTE, installModelSelection: () => () => {} },
    home,
    root,
    on: bus.on,
    deliver: async (text, opts) => {
      sent.push([text, opts.replyTo]);
      kinds.push(opts.kind);
      return deliver === undefined ? { sent: [`telegram:${100 + sent.length}`] } : deliver(text, sent.length);
    },
    onAnnotated: (r) => { noted.push(r); },
    clock,
    log: (line) => { lines.push(line); },
    createAgent: (opts) => agents.createAgent(opts),
    ...over,
  });
  return { root, home, agents, bus, clock, sent, kinds, noted, lines, annotator };
}

const alertOf = (alert: string, symbol = "NVDA", pass = "p-000000000001") => ({ kind: "alert", alert, symbol, pass });
type PostInput = Parameters<DeskConversation["post"]>[0];
/** Post an alert's annotation, replying to the alert's Telegram message `replyTo` (`telegram:<replyTo>`). */
const annotate = (h: Harness, alert: string, replyTo: number | undefined, source: PostInput["source"] = { kind: "alert", symbol: "NVDA", rule: "stop" }) =>
  h.annotator.post({ text: "NVDA 171.20 crossed the stop at 172", source, message: alertOf(alert), ...(replyTo === undefined ? {} : { replyTo: `telegram:${replyTo}` }) });
const sessionOf = (r: PostResult): string => {
  assert.ok("opened" in r, `opened; saw ${JSON.stringify(r)}`);
  return r.sessionId;
};

const say = (text: string) => [{ type: "text", text }];
function startTurn(h: Harness, sessionId: string, turn: number, source?: Record<string, unknown>): void {
  h.bus.emit(sessionId, "turn/start", { turn });
  h.bus.emit(sessionId, "step/start", { turn, step: 1 });
  if (source !== undefined) h.bus.emit(sessionId, "user/message", { id: `m-${turn}`, role: "user", content: say("x"), source });
}
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
const ABORTED = (reason: string) => ({ kind: "aborted", reason: { kind: "hook", reason } });

const events = async (h: Harness): Promise<DeskEvent[]> => (await readEvents(h.home)).events;
const turnsOf = async (h: Harness) => (await events(h)).flatMap((e) => (e.kind === "desk-turn" ? [e] : []));

/* ---------- the lane ---------- */

test("an annotation's reply goes as alert, threaded under the alert's message, and is noted with the ids it went out as", async () => {
  const h = await harness();
  const sessionId = sessionOf(await annotate(h, "a-000000000001", 41));
  startTurn(h, sessionId, 1, alertOf("a-000000000001"));
  answer(h, sessionId, 1, "Stop met.");
  endTurn(h, sessionId, 1);
  await waitFor("the note", () => h.noted.length === 1);
  assert.deepEqual([h.sent, h.kinds], [[["Stop met.", "telegram:41"]], ["alert"]]);
  assert.deepEqual(h.noted[0].sent, ["telegram:101"]);
  await h.annotator.dispose();
});

test("an annotation opens at once in its own session while the desk conversation's turn is under way", async () => {
  const h = await harness();
  /* the desk conversation's session, a phone turn open on it and nothing ending it */
  startTurn(h, "session-desk", 1, { kind: "telegram", from: 42, chat: 42, messageId: 7 });
  const opened = await annotate(h, "a-000000000001", 11);
  assert.deepEqual(opened, { opened: true, sessionId: "session-fake-1" }, "a session of its own, not the desk conversation's");
  assert.deepEqual(h.agents.created, [{ cwd: join(h.root, "desk", "journal"), route: ROUTE }], "a fresh desk agent in the journal, on the desk's route");
  const agent = h.agents.agents[0];
  assert.ok(agent.text(0)?.startsWith("[alert · NVDA · stop]\nNVDA 171.20 crossed the stop at 172"), `the provenance line, then the alerts; saw ${JSON.stringify(agent.text(0))}`);
  assert.deepEqual(agent.followups[0].source, alertOf("a-000000000001"), "its message's source is the alert's");
  await h.annotator.dispose();
});

test("its 240 s deadline runs from its own turn's start, and the cut is answered as a reply to the alert", async () => {
  const h = await harness();
  const sessionId = sessionOf(await annotate(h, "a-000000000001", 11));
  const agent = h.agents.agents[0];
  await h.clock.advance(30_000); // the turn starts 30 s after the post
  startTurn(h, sessionId, 1, alertOf("a-000000000001"));
  await h.clock.advance(239_999);
  assert.deepEqual(agent.cancels, [], "not yet: 240 s from the turn's start, not the post's");
  await h.clock.advance(1);
  assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "desk deadline" }, { keepInbox: true }]]);
  endTurn(h, sessionId, 1, ABORTED("desk deadline"));
  await waitFor("the cut's line", () => h.sent.length === 1);
  assert.deepEqual(h.sent, [["timed out after 4 min; a card or a long tool was pending", "telegram:11"]]);
  await waitFor("the note", () => h.noted.length === 1);
  assert.equal(h.noted[0].outcome, "timed-out");
  assert.deepEqual((await turnsOf(h)).map((e) => [e.sessionId, e.source, e.outcome, e.wallMs]), [[sessionId, "alert", "timed-out", 240_000]]);
});

test("its text is delivered as a reply, recorded as a desk-turn with source alert, noted annotated with the sent ids, and its agent disposed", async () => {
  const h = await harness();
  const sessionId = sessionOf(await annotate(h, "a-000000000001", 11));
  const agent = h.agents.agents[0];
  startTurn(h, sessionId, 1, alertOf("a-000000000001"));
  answer(h, sessionId, 1, "Stop met: 171.20 < 172 (ROBINHOOD 10:21:03 ET).");
  endTurn(h, sessionId, 1);
  await waitFor("the reply", () => h.sent.length === 1);
  assert.deepEqual(h.sent, [["Stop met: 171.20 < 172 (ROBINHOOD 10:21:03 ET).", "telegram:11"]]);
  assert.deepEqual(await turnsOf(h), [{
    t: AT, kind: "desk-turn", sessionId, source: "alert", turn: 1, outcome: "ended", wallMs: 0,
    usage: { uncachedInputTokens: 1200, outputTokens: 34, cacheReadTokens: 1000, cacheWriteTokens: 0, routes: ["stub/echo"] },
  }], "the record comes before the delivery, so the day's budget counts it");
  await waitFor("the note", () => h.noted.length === 1);
  assert.deepEqual(h.noted, [{
    t: AT, kind: "annotated", pass: "p-000000000001", sessionId, outcome: "ended", sent: ["telegram:101"], text: "Stop met: 171.20 < 172 (ROBINHOOD 10:21:03 ET).",
  }]);
  await waitFor("the agent let go", () => agent.disposed === 1);
  await waitFor("the supervision ended", () => h.bus.listeners.size === 0);

  /* a long answer goes whole to the phone, and its note keeps 2,000 characters */
  const long = "x".repeat(2_500);
  const second = sessionOf(await annotate(h, "a-000000000002", undefined));
  startTurn(h, second, 1, alertOf("a-000000000002"));
  answer(h, second, 1, long);
  endTurn(h, second, 1);
  await waitFor("the second note", () => h.noted.length === 2);
  assert.deepEqual(h.sent[1], [long, undefined], "a queued alert's annotation goes without a reply");
  assert.equal(ANNOTATED_TEXT_MAX, 2_000);
  assert.equal(h.noted[1].text, long.slice(0, 2_000));
  assert.deepEqual(h.lines, []);
});

test("every other end answers as a reply with its own line", async () => {
  const h = await harness();
  const cases: [string, (s: string) => Promise<void> | void, string][] = [
    ["failed", (s) => endTurn(h, s, 1, { kind: "error", error: { message: "429 rate limit", code: "UNKNOWN" } }), "the desk could not annotate this alert: 429 rate limit"],
    ["ended with no text", (s) => endTurn(h, s, 1), "the desk's check of this alert ended with no text"],
    ["cancelled", (s) => endTurn(h, s, 1, ABORTED("stopped in the browser")), "the desk's check of this alert ended with no text"],
    ["refused", async (s) => {
      await waitFor("the fence's cancel", () => h.agents.agents.at(-1)!.cancels.length === 1);
      endTurn(h, s, 1, ABORTED("desk fence"));
    }, "refused: desk/journal/notes/GRAVIT.md exists; it would steer every later desk turn. Remove it, then write again."],
  ];
  let n = 0;
  for (const [what, end, line] of cases) {
    n += 1;
    const sessionId = sessionOf(await annotate(h, `a-00000000000${n}`, 10 + n));
    if (what === "refused") {
      await mkdir(join(h.root, "desk", "journal", "notes"), { recursive: true });
      await writeFile(join(h.root, "desk", "journal", "notes", "GRAVIT.md"), "x\n"); // planted after the post's own check
    }
    startTurn(h, sessionId, 1, alertOf(`a-00000000000${n}`));
    await end(sessionId);
    await waitFor(`the ${what} line`, () => h.sent.length === n);
    assert.deepEqual(h.sent[n - 1], [line, `telegram:${10 + n}`], what);
  }
  await waitFor("four notes", () => h.noted.length === 4);
  assert.deepEqual(h.noted.map((r) => r.outcome), ["failed", "ended", "cancelled", "refused"]);
  assert.deepEqual((await events(h)).map((e) => e.kind), ["desk-turn", "desk-turn", "desk-turn", "desk-refused"]);
});

test("a batch post renders the alerts form, and an alert's 0 is a message id", async () => {
  const h = await harness();
  const sessionId = sessionOf(await h.annotator.post({
    text: "NVDA 171.20 crossed the stop at 172", source: { kind: "alerts", count: 3 }, message: { kind: "alert", alert: "p-00000000000a", symbol: "NVDA,AMD", pass: "p-00000000000a" }, replyTo: "telegram:0",
  }));
  assert.equal(h.agents.agents[0].text(0), "[alerts · 3 · 14:03 ET]\nNVDA 171.20 crossed the stop at 172");
  startTurn(h, sessionId, 1, alertOf("p-00000000000a"));
  answer(h, sessionId, 1, "Three plans checked.");
  endTurn(h, sessionId, 1);
  await waitFor("the reply", () => h.sent.length === 1);
  assert.deepEqual(h.sent, [["Three plans checked.", "telegram:0"]]);
  await waitFor("the note", () => h.noted.length === 1);
  assert.equal(h.noted[0].pass, "p-00000000000a");
});

test("the pause, the budget and the fence refuse before any agent is made", async () => {
  let state: BudgetState = {
    dailyTokens: 2_000_000,
    used: { uncachedInputTokens: 13_402, outputTokens: 0, cacheReadTokens: 2_000_000, cacheWriteTokens: 0, total: 2_013_402 },
    spent: true,
  };
  let asked = 0;
  const h = await harness({ budget: async () => { asked += 1; return state; } });

  await writeOff(h.home, { by: "telegram" }, () => Date.parse(AT));
  assert.deepEqual(await annotate(h, "a-000000000001", 11), {
    refused: "paused", line: "paused since 14:03 ET by telegram; a terminal resumes it: npm run desk -- resume",
  }, "the conversation's line");
  assert.equal(asked, 0, "a paused post reads no budget");
  await clearOff(h.home, "terminal");

  await mkdir(join(h.root, "desk", "journal", ".git"), { recursive: true }); // the budget is read before the fence
  assert.deepEqual(await annotate(h, "a-000000000002", 12), {
    refused: "budget",
    line: "the desk's token budget for today is spent: 2,013,402 of 2,000,000 tokens since 00:00 ET. It opens again at midnight ET, or raise budget.dailyTokens in standing.yml",
  });
  state = { ...state, spent: false };
  const fenced = await annotate(h, "a-000000000003", 13);
  assert.equal((fenced as { refused?: string }).refused, "fence");
  assert.equal((fenced as { path?: string }).path, "desk/journal/.git");
  assert.deepEqual((await events(h)).filter((e) => e.kind !== "off-set" && e.kind !== "off-cleared").map((e) => [e.kind, (e as { path?: string }).path]), [["desk-refused", "desk/journal/.git"]]);

  assert.equal(h.agents.created.length, 0, "no agent made for any of them");
  assert.deepEqual(h.sent, [], "a refusal is the watch's to answer");
  assert.deepEqual(h.noted, []);
});

test("a second pass posted 15 s later waits only for the first run's delivery", async () => {   // Review Focus 3
  const h = await harness();
  h.agents.onDispose = () => new Promise(() => {}); // the first agent's dispose never settles
  const first = sessionOf(await annotate(h, "a-000000000001", 11));
  startTurn(h, first, 1, alertOf("a-000000000001"));
  await h.clock.advance(15_000);
  let second: PostResult | undefined;
  const posting = annotate(h, "a-000000000002", 12).then((r) => { second = r; return r; });
  await h.clock.flush();
  assert.equal(second, undefined, "the second waits while the first check runs");
  answer(h, first, 1, "first checked");
  endTurn(h, first, 1);
  await posting;
  assert.deepEqual(second, { opened: true, sessionId: "session-fake-2" }, "it opens once the first is delivered, its dispose still hanging");
  assert.deepEqual(h.sent, [["first checked", "telegram:11"]], "the first was delivered before the second opened");
  assert.equal(h.agents.agents[0].disposed, 1, "the first agent's dispose began");
  assert.ok(h.clock.now() - Date.parse(AT) < 240_000, "well inside the first's deadline");
});

test("idle resolves at once with nothing posted, waits for a running post's delivered reply, and for a queued one", async () => {
  const h = await harness();
  await h.annotator.idle(); // at once with nothing posted

  const first = sessionOf(await annotate(h, "a-000000000001", 11));
  startTurn(h, first, 1, alertOf("a-000000000001"));
  const queued = annotate(h, "a-000000000002", 12);
  let idle = false;
  const waiting = h.annotator.idle().then(() => { idle = true; });
  await h.clock.flush();
  assert.equal(idle, false, "not while the first runs");
  answer(h, first, 1, "first checked");
  endTurn(h, first, 1);
  const second = sessionOf(await queued);
  await h.clock.flush();
  assert.deepEqual(h.sent, [["first checked", "telegram:11"]]);
  assert.equal(idle, false, "not while the queued one runs");
  startTurn(h, second, 1, alertOf("a-000000000002"));
  answer(h, second, 1, "second checked");
  endTurn(h, second, 1);
  await waiting;
  assert.deepEqual(h.sent, [["first checked", "telegram:11"], ["second checked", "telegram:12"]], "idle once the queued reply is delivered");
  assert.equal(h.noted.length, 2, "and noted");
  await h.annotator.idle();

  await h.annotator.dispose();
  await h.annotator.idle(); // and at once after the dispose
});

test("an urgent post's reply goes urgent; another's goes alert", async () => {
  const h = await harness();
  const urgent = sessionOf(await h.annotator.post({
    text: "NVDA 160.00 is down 7.0% from its close", source: { kind: "alert", symbol: "NVDA", rule: "move" }, message: alertOf("a-000000000001"), replyTo: "telegram:11", urgent: true,
  }));
  startTurn(h, urgent, 1, alertOf("a-000000000001"));
  answer(h, urgent, 1, "Why it moved: guidance cut.");
  endTurn(h, urgent, 1);
  const plain = sessionOf(await annotate(h, "a-000000000002", 12));
  startTurn(h, plain, 1, alertOf("a-000000000002"));
  answer(h, plain, 1, "Stop met.");
  endTurn(h, plain, 1);
  await h.annotator.idle();
  assert.deepEqual([h.sent, h.kinds], [[["Why it moved: guidance cut.", "telegram:11"], ["Stop met.", "telegram:12"]], ["urgent", "alert"]]);
  await h.annotator.dispose();
});

test("a turn that never starts is cut by the watchdog at the deadline plus the slack, with the no-text line as a reply", async () => {
  const h = await harness();
  const sessionId = sessionOf(await annotate(h, "a-000000000001", 11));
  const agent = h.agents.agents[0];
  await h.clock.advance(299_999);
  assert.deepEqual(agent.cancels, []);
  await h.clock.advance(1);
  assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "desk deadline" }]], "the watchdog's cancel at 240 s + 60 s");
  await waitFor("the line", () => h.sent.length === 1);
  assert.deepEqual(h.sent, [["the desk's check of this alert ended with no text", "telegram:11"]]);
  await waitFor("the note", () => h.noted.length === 1);
  assert.deepEqual([h.noted[0].sessionId, h.noted[0].outcome, h.noted[0].sent], [sessionId, "timed-out", ["telegram:101"]]);
  assert.ok(h.lines.some((l) => l.includes("saw no turn start")), `one line names it; saw ${JSON.stringify(h.lines)}`);
  await waitFor("the agent let go", () => agent.disposed === 1);
  assert.deepEqual(await turnsOf(h), [], "no turn, no desk-turn");
});

test("a create or a followup that fails refuses with the annotate line, and the next post tries again", async () => {
  const h = await harness();
  h.agents.failCreate = "the tree is gone";
  assert.deepEqual(await annotate(h, "a-000000000001", 11), { refused: "error", line: "the desk could not annotate this alert: the tree is gone" });
  h.agents.failCreate = undefined;
  h.agents.failFollowup = "the inbox is closed";
  assert.deepEqual(await annotate(h, "a-000000000002", 12), { refused: "error", line: "the desk could not annotate this alert: the inbox is closed" });
  await waitFor("the failed agent let go", () => h.agents.agents[0].disposed === 1);
  h.agents.failFollowup = undefined;
  assert.deepEqual(await annotate(h, "a-000000000003", 13), { opened: true, sessionId: "session-fake-2" });
  assert.equal(h.lines.length, 2, "one line each");
  await h.annotator.dispose();
});

test("a create that never settles makes the post refuse at the bound, an agent made late is let go, and the next post opens", async () => {
  let release: () => void = () => {};
  let calls = 0;
  const h = await harness({
    createAgent: async (opts) => {
      calls += 1;
      if (calls === 1) await new Promise<void>((done) => { release = done; }); // the first making hangs
      return h.agents.createAgent(opts);
    },
  });
  let first: PostResult | undefined;
  const posting = annotate(h, "a-000000000001", 11).then((r) => { first = r; return r; });
  await h.clock.advance(299_999);
  assert.equal(first, undefined, "still waiting inside the bound");
  await h.clock.advance(1);
  assert.deepEqual(await posting, { refused: "error", line: "the desk could not annotate this alert: the desk agent was not made in 5 min" },
    "refused at the deadline plus the slack");
  assert.deepEqual(await annotate(h, "a-000000000002", 12), { opened: true, sessionId: "session-fake-1" }, "the lane is not stalled");
  release();
  await waitFor("the late agent let go", () => h.agents.agents.length === 2 && h.agents.agents[1].disposed === 1);
  assert.deepEqual(h.agents.agents[1].followups, [], "the late agent is sent nothing");
  await h.annotator.dispose();
});

test("an agent made once dispose has begun is let go, sent nothing, and the post refuses as shut down", async () => {
  let release: () => void = () => {};
  let making = false;
  const h = await harness({
    createAgent: async (opts) => {
      making = true;
      await new Promise<void>((done) => { release = done; });
      return h.agents.createAgent(opts);
    },
  });
  const posting = annotate(h, "a-000000000001", 11);
  await waitFor("the making under way", () => making);
  const disposing = h.annotator.dispose();
  release();
  assert.deepEqual(await posting, { refused: "error", line: "the desk could not annotate this alert: the desk is shut down" });
  await disposing;
  await waitFor("the agent let go", () => h.agents.agents[0]?.disposed === 1);
  assert.deepEqual(h.agents.agents[0].followups, [], "no followup");
  assert.equal(h.bus.listeners.size, 0, "nothing supervised");
  assert.deepEqual(h.sent, []);
});

test("dispose cancels the turn under way as shutdown, sends nothing, notes nothing, and later posts refuse", async () => {
  const h = await harness();
  const sessionId = sessionOf(await annotate(h, "a-000000000001", 11));
  const agent = h.agents.agents[0];
  startTurn(h, sessionId, 1, alertOf("a-000000000001"));
  agent.onCancel = () => endTurn(h, sessionId, 1, ABORTED("shutdown"));
  await h.annotator.dispose();
  await h.annotator.dispose();
  assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "shutdown" }]], "once");
  assert.equal(agent.disposed, 1);
  assert.deepEqual((await turnsOf(h)).map((e) => [e.outcome, e.cancel]), [["cancelled", "shutdown"]], "the cut turn is counted before dispose resolves");
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.noted, []);
  assert.deepEqual(await annotate(h, "a-000000000002", 12), { refused: "error", line: "the desk could not annotate this alert: the desk is shut down" });
});

test("the annotator imports nothing but types: its machinery loads on first use", async () => {
  const source = await readFile(join(HERE, "..", "src", "annotator.ts"), "utf8");
  const imports = source.match(/^import\b.*$/gm) ?? [];
  assert.ok(imports.length > 0);
  for (const line of imports) assert.match(line, /^import type /, `a value edge: ${line}`);
});
