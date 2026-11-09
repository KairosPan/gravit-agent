// face/tests/task-view.test.ts
/** The task view (src/task-view.ts): a task's state, steps, result, usage and relays, computed from the worker's own
 * log. Pure, on hand-built event lists. */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  STALL_MS, STEPS_KEPT, TASK_TEXT_MAX, briefOrigin, cut, relaysOf, stallOf, taskViewOf, type TimedEvent,
} from "../src/task-view.ts";
import { briefText } from "../src/task-worker.ts";

const ID = "session-w1";
const ROOT = "/repo";
const T0 = 1_800_000_000_000;

/** A worker's log under construction: each event one second after the one before, unless told otherwise. */
class Log {
  readonly events: TimedEvent[] = [];
  t = T0;
  push(type: string, data: unknown, dt = 1_000): this {
    this.t += dt;
    this.events.push({ type, seq: this.events.length + 1, data, time: this.t });
    return this;
  }
  brief(title = "Read the tape", brief = "Look at the tape."): this {
    return this.push("user/message", {
      id: `task-brief:${ID}`, role: "user", content: [{ type: "text", text: briefText(title, brief) }],
      source: { kind: "task", form: "brief", conversation: "session-conv", origin: "web" },
    });
  }
  user(text: string, source: Record<string, unknown> = { kind: "user" }, id = `m-${this.events.length}`): this {
    return this.push("user/message", { id, role: "user", content: [{ type: "text", text }], source });
  }
  start(turn: number): this {
    return this.push("turn/start", { turn }).push("step/start", { turn, step: 1 });
  }
  say(turn: number, text: string, step = 1, usage: object | undefined = undefined, route = { provider: "stub", model: "echo" }): this {
    return this.push("assistant/message", {
      turn, step,
      message: { id: `a-${turn}-${step}-${this.events.length}`, role: "assistant", content: [{ type: "text", text }], source: { kind: "model", ...route } },
      ...(usage === undefined ? {} : { usage }),
    });
  }
  stepEnd(turn: number, step = 1): this {
    return this.push("step/end", { turn, step });
  }
  call(turn: number, callId: string, name: string, args: unknown, step = 1): this {
    return this.push("tool/call", { turn, step, callId, name, arguments: JSON.stringify(args) });
  }
  result(turn: number, callId: string, step = 1, isError = false): this {
    return this.push("tool/result", {
      turn, step,
      message: { id: `r-${callId}`, role: "tool", toolCallId: callId, content: [{ type: "text", text: "ok" }], ...(isError ? { isError } : {}) },
    });
  }
  report(turn: number, callId: string, status: string, text: string): this {
    return this.call(turn, callId, "task_report", { status, text }).result(turn, callId);
  }
  end(turn: number, reason: object = { kind: "completed" }): this {
    return this.push("turn/end", { turn, reason });
  }
}

const header = (cwd?: string) => ({ createdAt: T0, ...(cwd === undefined ? {} : { cwd }) });
const view = (log: Log, now = log.t + 1_000, cwd?: string) => taskViewOf({ id: ID, header: header(cwd), events: log.events, root: ROOT, now });

test("an open turn is running; with no event for 20 minutes it is stalled, and stallOf gives task-stall:<id>:<seq>", () => {
  const log = new Log().brief().start(1).say(1, "looking");
  const running = view(log);
  assert.equal(running.state, "running");
  assert.equal(running.group, "running");
  assert.equal(stallOf(running, log.events), undefined);
  assert.equal(view(log, log.t + STALL_MS - 1).state, "running");

  const stalled = view(log, log.t + STALL_MS);
  assert.equal(STALL_MS, 1_200_000);
  assert.equal(stalled.state, "stalled");
  assert.equal(stalled.group, "you");
  assert.equal(stalled.lastSeq, log.events.length);
  assert.equal(stalled.lastEventAt, log.t);
  const stall = stallOf(stalled, log.events);
  assert.ok(stall !== undefined);
  assert.equal(stall.id, `task-stall:${ID}:${log.events.length}`);
  assert.equal(stall.task, ID);
  assert.equal(stall.title, "Read the tape");
  assert.equal(stall.status, "stalled");
  assert.ok(stall.text.length > 0 && stall.text.length <= TASK_TEXT_MAX);

  // an ended turn is never stalled, however long ago
  log.end(1);
  assert.equal(view(log, log.t + 10 * STALL_MS).state, "done");
  // no turn yet: running
  assert.equal(view(new Log().brief()).state, "running");
});

test("an approval asked and not decided, or an ask_user_question with no result, is waiting, named in waitingFor", () => {
  const log = new Log().brief().start(1)
    .call(1, "c-order", "mcp__account__portfolio_place_order", { symbol: "NVDA" })
    .push("approval/asked", { id: "ap-1", toolName: "mcp__account__portfolio_place_order", callId: "c-order", reason: "buy 10 NVDA" });
  const asked = view(log, log.t + 2 * STALL_MS);
  assert.equal(asked.state, "waiting", "a pending gate is waiting, never stalled");
  assert.equal(asked.group, "you");
  assert.deepEqual(asked.waitingFor, { kind: "approval", id: "ap-1", tool: "mcp__account__portfolio_place_order" });
  const relays = relaysOf(asked, log.events);
  assert.deepEqual(relays.map((r) => [r.id, r.status]), [[`task-wait:${ID}:ap-1`, "waiting"]]);
  assert.match(relays[0]!.text, /mcp__account__portfolio_place_order/);
  assert.match(relays[0]!.text, /buy 10 NVDA/);

  log.push("approval/decided", { id: "ap-1", outcome: "approved" }).result(1, "c-order");
  assert.equal(view(log).state, "running");
  assert.equal(view(log).waitingFor, undefined);
  assert.deepEqual(relaysOf(view(log), log.events), []);

  log.call(1, "c-ask", "ask_user_question", { questions: [{ id: "q1", question: "Which venue?" }] }, 2);
  const q = view(log);
  assert.equal(q.state, "waiting");
  assert.deepEqual(q.waitingFor, { kind: "question", id: "c-ask", tool: "ask_user_question" });
  const qr = relaysOf(q, log.events);
  assert.deepEqual(qr.map((r) => [r.id, r.status]), [[`task-wait:${ID}:c-ask`, "waiting"]]);
  assert.match(qr[0]!.text, /Which venue\?/);

  log.result(1, "c-ask", 2);
  assert.equal(view(log).state, "running");
});

test("a ready report then a turn end is done with its text; blocked and failed reports give their states", () => {
  const ready = new Log().brief().start(1).report(1, "c1", "ready", "NVDA breaks out; notes in analysis/x.md").say(1, "done").end(1);
  const v = view(ready);
  assert.equal(v.state, "done");
  assert.equal(v.group, "done");
  assert.deepEqual(v.result, { status: "ready", text: "NVDA breaks out; notes in analysis/x.md" });
  assert.deepEqual(relaysOf(v, ready.events).map((r) => [r.id, r.status, r.text]), [[`task-report:${ID}:c1`, "ready", "NVDA breaks out; notes in analysis/x.md"]]);

  // a ready report before the turn ends is still a running turn, and relays already
  const open = new Log().brief().start(1).report(1, "c1", "ready", "early");
  assert.equal(view(open).state, "running");
  assert.equal(relaysOf(view(open), open.events).length, 1);

  const blocked = new Log().brief().start(1).report(1, "c1", "blocked", "need the venue").end(1);
  assert.equal(view(blocked).state, "blocked");
  assert.equal(view(blocked).group, "you");
  assert.deepEqual(view(blocked).result, { status: "blocked", text: "need the venue" });

  const failed = new Log().brief().start(1).report(1, "c1", "failed", "no data").end(1);
  assert.equal(view(failed).state, "failed");
  assert.equal(view(failed).group, "you");

  // the last non-progress report wins; progress does not count
  const last = new Log().brief().start(1).report(1, "c1", "blocked", "first").report(1, "c2", "ready", "second").report(1, "c3", "progress", "p").end(1);
  assert.deepEqual(view(last).result, { status: "ready", text: "second" });
  assert.deepEqual(relaysOf(view(last), last.events).map((r) => r.id), [`task-report:${ID}:c1`, `task-report:${ID}:c2`]);

  // a report from an earlier turn does not settle a later one
  const later = new Log().brief().start(1).report(1, "c1", "blocked", "need x").end(1).user("here is x").start(2).say(2, "all good").end(2);
  assert.equal(view(later).state, "done");
  assert.deepEqual(view(later).result, { status: "ready", text: "all good" });
});

test("a turn that ends with only progress reports relays ready with its last assistant text, cut at 600", () => {
  const long = "x".repeat(900);
  const log = new Log().brief().start(1).report(1, "c1", "progress", "halfway").say(1, long).end(1);
  const v = view(log);
  assert.equal(v.state, "done");
  const relays = relaysOf(v, log.events);
  assert.deepEqual(relays.map((r) => [r.id, r.status]), [[`task-report:${ID}:turn-1`, "ready"]]);
  assert.equal(TASK_TEXT_MAX, 600);
  assert.equal(Array.from(relays[0]!.text).length, TASK_TEXT_MAX);
  assert.equal(relays[0]!.text, cut(long, TASK_TEXT_MAX));
  assert.equal(v.result?.status, "ready");
  assert.equal(v.result?.text, cut(long, TASK_TEXT_MAX));

  assert.equal(cut("short", 600), "short");
  assert.equal(Array.from(cut("市".repeat(700), 600)).length, 600);
  assert.ok(cut("y".repeat(601), 600).endsWith("…"));
});

test("a turn that ends in error relays failed", () => {
  const log = new Log().brief().start(1).say(1, "trying").end(1, { kind: "error", error: { message: "provider 500\nstack", code: "E_PROVIDER" } });
  const v = view(log);
  assert.equal(v.state, "failed");
  assert.equal(v.group, "you");
  assert.equal(v.result?.status, "failed");
  const relays = relaysOf(v, log.events);
  assert.deepEqual(relays.map((r) => [r.id, r.status]), [[`task-report:${ID}:turn-1`, "failed"]]);
  assert.match(relays[0]!.text, /provider 500/);
  assert.doesNotMatch(relays[0]!.text, /stack/);
});

test("a stopped marker after the last turn start makes it stopped; a turn started after it does not", () => {
  const stopped = new Log().brief().start(1).say(1, "working").end(1, { kind: "aborted", reason: { kind: "hook", reason: "task stop" } })
    .user("stopped", { kind: "task", form: "stopped", task: ID });
  assert.equal(view(stopped).state, "stopped");
  assert.equal(view(stopped).group, "done");
  // with no turn at all
  assert.equal(view(new Log().brief().user("stopped", { kind: "task", form: "stopped" })).state, "stopped");
  // stopped beats a pending gate
  const gated = new Log().brief().start(1).push("approval/asked", { id: "ap", toolName: "t" }).user("stopped", { kind: "task", form: "stopped" });
  assert.equal(view(gated).state, "stopped");

  stopped.start(2).say(2, "back at it");
  assert.equal(view(stopped).state, "running");
  stopped.end(2);
  assert.equal(view(stopped).state, "done");
});

test("relay ids are stable across two reads of the same log", () => {
  const log = new Log().brief()
    .start(1).report(1, "c1", "progress", "p1").report(1, "c2", "blocked", "need x").end(1)
    .user("x").start(2).say(2, "fine").end(2)
    .user("more").start(3).push("approval/asked", { id: "ap-9", toolName: "bash", reason: "rm" });
  const a = relaysOf(view(log), log.events);
  const b = relaysOf(view(log, log.t + 5_000), [...log.events]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((r) => r.id), [`task-report:${ID}:c2`, `task-report:${ID}:turn-2`, `task-wait:${ID}:ap-9`]);
  assert.ok(a.every((r) => r.task === ID && r.title === "Read the tape"));
});

test("steps keep the last ten progress lines; usage sums every turn; strategy and title come from the cwd and the brief", () => {
  const log = new Log().brief("Size the CRWV debate", "Have both sides argue.").start(1);
  for (let i = 1; i <= 12; i++) log.report(1, `p${i}`, "progress", `step ${i}`);
  log.say(1, "one", 1, { inputTokens: 1200, outputTokens: 34, cacheReadTokens: 1000, cacheWriteTokens: 0, totalTokens: 2234 }).stepEnd(1).end(1);
  log.user("again").start(2).say(2, "two", 1, { inputTokens: 300, outputTokens: 6, cacheReadTokens: 2000, cacheWriteTokens: 100, totalTokens: 2406 }, { provider: "deepseek-official", model: "deepseek-flash" }).stepEnd(2).end(2);
  const v = view(log, log.t + 1_000, join(ROOT, "strategies", "市场情绪"));
  assert.equal(STEPS_KEPT, 10);
  assert.deepEqual(v.steps, Array.from({ length: 10 }, (_, i) => `step ${i + 3}`));
  assert.deepEqual(v.usage, { uncachedInputTokens: 1500, outputTokens: 40, cacheReadTokens: 3000, cacheWriteTokens: 100, routes: ["stub/echo", "deepseek-official/deepseek-flash"] });
  assert.equal(v.title, "Size the CRWV debate");
  assert.equal(v.strategy, "市场情绪");
  assert.equal(v.origin, "web");
  assert.equal(v.id, ID);
  assert.equal(v.startedAt, T0);
  assert.equal(v.lastSeq, log.events.length);
  assert.equal(v.lastEventAt, log.t);
  // the repository root, or a folder that is not one strategy's, has no strategy
  assert.equal(view(log, log.t, ROOT).strategy, undefined);
  assert.equal(view(log, log.t, join(ROOT, "strategies", "a", "b")).strategy, undefined);
  assert.equal(view(log, log.t, "/elsewhere/strategies/a").strategy, undefined);
  // no turn that can be accounted: no usage
  assert.equal(view(new Log().brief().start(1).say(1, "x").end(1)).usage, undefined);
});

test("an ended turn with no settling report reads its end reason: done, blocked, failed, or stalled with no relay", () => {
  const rows: [object, string, string | undefined][] = [
    [{ kind: "completed" }, "done", "ready"],
    [{ kind: "forked" }, "done", "ready"],
    [{ kind: "something-new" }, "done", "ready"],
    [{ kind: "blocked" }, "blocked", "blocked"],
    [{ kind: "max-tokens" }, "blocked", "blocked"],
    [{ kind: "error", error: { message: "boom" } }, "failed", "failed"],
    [{ kind: "aborted", reason: { kind: "user" } }, "stalled", undefined],
    [{ kind: "interrupted" }, "stalled", undefined],
  ];
  for (const [reason, state, relay] of rows) {
    const log = new Log().brief().start(1).say(1, "last words").end(1, reason);
    const v = view(log);
    const label = JSON.stringify(reason);
    assert.equal(v.state, state, label);
    assert.equal(v.group, state === "done" ? "done" : "you", label);
    const relays = relaysOf(v, log.events);
    if (relay === undefined) {
      assert.deepEqual(relays, [], label);
      assert.equal(v.result, undefined, label);
    } else {
      assert.deepEqual(relays.map((r) => [r.id, r.status]), [[`task-report:${ID}:turn-1`, relay]], label);
      assert.equal(v.result?.status, relay, label);
      assert.equal(relays[0]!.text, relay === "failed" ? "boom" : "last words", label);
    }
  }
  // a stopped marker still wins over an aborted end
  const stopped = new Log().brief().start(1).end(1, { kind: "aborted", reason: { kind: "user" } }).user("stopped", { kind: "task", form: "stopped" });
  assert.equal(view(stopped).state, "stopped");
});

test("a gate is pending only while the turn that asked it is open", () => {
  const log = new Log().brief().start(1)
    .push("approval/asked", { id: "ap-1", toolName: "mcp__account__portfolio_place_order", reason: "buy" })
    .call(1, "c-ask", "ask_user_question", { questions: [{ id: "q", question: "Which?" }] })
    .end(1);
  const v = view(log);
  assert.notEqual(v.state, "waiting");
  assert.equal(v.waitingFor, undefined);
  assert.ok(relaysOf(v, log.events).every((r) => !r.id.startsWith("task-wait:")));
});

test("a turn with no closing words says so with its end kind", () => {
  const log = new Log().brief().start(1).say(1, "let me check").call(1, "c1", "bash", { cmd: "ls" }).result(1, "c1").end(1);
  const v = view(log);
  assert.equal(v.result?.text, "the turn ended (completed) with no closing words");
  assert.equal(relaysOf(v, log.events)[0]!.text, "the turn ended (completed) with no closing words");
  const capped = new Log().brief().start(1).end(1, { kind: "max-tokens" });
  assert.equal(relaysOf(view(capped), capped.events)[0]!.text, "the turn ended (max-tokens) with no closing words");
});

test("a task_report counts only once its result exists and is not an error", () => {
  const log = new Log().brief().start(1)
    .call(1, "c-err", "task_report", { status: "ready", text: "refused one" }).result(1, "c-err", 1, true)
    .call(1, "c-prog", "task_report", { status: "progress", text: "no result yet" })
    .call(1, "c-wait", "task_report", { status: "blocked", text: "no result yet" });
  const open = view(log);
  assert.equal(open.state, "running");
  assert.deepEqual(open.steps, []);
  assert.deepEqual(relaysOf(open, log.events), []);
  log.result(1, "c-prog").say(1, "words").end(1);
  const ended = view(log);
  assert.deepEqual(ended.steps, ["no result yet"]);
  assert.equal(ended.state, "done", "neither the refused nor the unanswered report settles the turn");
  assert.deepEqual(relaysOf(ended, log.events).map((r) => r.id), [`task-report:${ID}:turn-1`]);
});

test("malformed or non-object arguments in logged task_report and ask_user_question calls never throw", () => {
  const log = new Log().brief().start(1);
  const bad = ["{not json", "null", "42", "\"ready\"", "[1,2]", "{\"status\":\"ready\"}", "{\"questions\":\"x\"}", "{\"questions\":[null,7,{\"question\":3}]}"];
  bad.forEach((raw, i) => {
    log.push("tool/call", { turn: 1, step: 1, callId: `r${i}`, name: "task_report", arguments: raw }).result(1, `r${i}`);
    log.push("tool/call", { turn: 1, step: 1, callId: `q${i}`, name: "ask_user_question", arguments: raw });
  });
  log.push("tool/call", { turn: 1, step: 1, callId: "obj", name: "task_report", arguments: { status: "ready" } });
  log.push("tool/call", { turn: 1, step: 1, name: "task_report", arguments: "{}" });
  log.push("tool/result", { turn: 1, step: 1, message: null });
  log.push("approval/asked", null);
  const v = view(log);
  assert.equal(v.state, "waiting");
  const relays = relaysOf(v, log.events);
  assert.ok(relays.every((r) => r.id.startsWith(`task-wait:${ID}:q`)));
  assert.equal(relays.length, bad.length);
});

test("stallOf relays only an open turn gone quiet; a turn cut by aborted or interrupted is stalled and relays nothing", () => {
  for (const reason of [{ kind: "aborted", reason: { kind: "hook", reason: "shutdown" } }, { kind: "interrupted" }]) {
    const log = new Log().brief().start(1).say(1, "half").end(1, reason);
    for (const now of [log.t + 1_000, log.t + 3 * STALL_MS]) {
      const v = view(log, now);
      assert.equal(v.state, "stalled");
      assert.equal(stallOf(v, log.events), undefined, JSON.stringify(reason));
      assert.deepEqual(relaysOf(v, log.events), []);
    }
  }
  const open = new Log().brief().start(1).say(1, "half");
  assert.equal(stallOf(view(open, open.t + STALL_MS), open.events)?.id, `task-stall:${ID}:${open.events.length}`);
});

test("a phone-started task's view reads origin phone and its network from the brief", () => {
  const log = new Log().push("user/message", {
    id: `task-brief:${ID}`, role: "user", content: [{ type: "text", text: briefText("T", "b") }],
    source: { kind: "task", form: "brief", conversation: "session-conv", origin: "phone", network: "telegram" },
  });
  const v = view(log);
  assert.equal(v.origin, "phone");
  assert.equal(v.network, "telegram");
  assert.deepEqual(briefOrigin(log.events), { conversation: "session-conv", origin: "phone", network: "telegram" });
});

test("an iMessage-started task's view keeps its network", () => {
  const log = new Log().push("user/message", {
    id: `task-brief:${ID}`, role: "user", content: [{ type: "text", text: briefText("T", "b") }],
    source: { kind: "task", form: "brief", conversation: "session-conv", origin: "phone", network: "imessage" },
  });
  assert.equal(view(log).network, "imessage");
  assert.deepEqual(briefOrigin(log.events), { conversation: "session-conv", origin: "phone", network: "imessage" });
});

test("an old brief without origin reads web", () => {
  const log = new Log().push("user/message", {
    id: `task-brief:${ID}`, role: "user", content: [{ type: "text", text: briefText("T", "b") }],
    source: { kind: "task", form: "brief", conversation: "session-conv" },
  });
  const v = view(log);
  assert.equal(v.origin, "web");
  assert.equal("network" in v, false);
  assert.equal(view(new Log().brief()).origin, "web");
  assert.equal("network" in view(new Log().brief()), false);
  assert.deepEqual(briefOrigin(log.events), { conversation: "session-conv", origin: "web" });
  assert.equal(briefOrigin([]), undefined);
});

test("TaskView.bot is the header's preset when it is not gravit, absent for gravit", () => {
  const log = new Log().brief().start(1);
  const of = (agentPreset?: string) => taskViewOf({
    id: ID, header: { createdAt: T0, cwd: "/repo/bots/drill-bull/journal", ...(agentPreset === undefined ? {} : { agentPreset }) },
    events: log.events, root: ROOT, now: log.t + 1_000,
  });
  assert.equal(of("drill-bull").bot, "drill-bull");
  assert.equal(of("drill-bull").strategy, undefined, "a bot's home is no strategy");
  assert.equal("bot" in of("gravit"), false);
  assert.equal("bot" in of(undefined), false);
});

/* ---------- a debate: a turn that ended after a dispatch waits on its round (final review, Important 1) ---------- */

/** A worker's turn that dispatched a round and ended, as the dispatch protocol asks. */
function dispatched(log: Log, turn: number, callId = `d${turn}`): Log {
  return log.start(turn).call(turn, callId, "dispatch", { to: ["drill-bull", "drill-bear"], mode: "serial", brief: "q", reason: "r" })
    .result(turn, callId).say(turn, `round ${turn} is under way`).stepEnd(turn).end(turn);
}
/** The room engine's wake: the round-end message (src/room.ts `finishRound`). */
const roundEnd = (log: Log, round: number): Log =>
  log.user(`round ${round} ended`, { kind: "room", form: "round-end", round, outcome: "settled", turns: [] });
/** A member's answer appended to the room log while it is quiet (src/room.ts `answerMessage`). */
const answer = (log: Log, bot: string, round: number): Log =>
  log.user(`${bot} says`, { kind: "room", form: "answer", bot, name: bot, sessionId: `session-${bot}`, turn: 1, round });

test("a worker that ended its turn after a dispatch is running and relays nothing while its round runs", () => {
  const log = dispatched(new Log().brief(), 1);
  const v = view(log);
  assert.equal(v.state, "running");
  assert.equal(v.group, "running");
  assert.equal("result" in v, false);
  assert.deepEqual(relaysOf(v, log.events), []);
  answer(log, "drill-bull", 1);
  assert.equal(view(log).state, "running", "an answer appended by the room opens no turn and ends no wait");
  assert.deepEqual(relaysOf(view(log), log.events), []);
  roundEnd(log, 1);
  assert.equal(view(log).state, "running", "the wake is logged; its turn has not started yet");
  assert.deepEqual(relaysOf(view(log), log.events), []);
});

test("a three-round debate relays once: the concluding turn's words, never the three turns that waited", () => {
  const log = new Log().brief();
  for (const n of [1, 2, 3]) {
    dispatched(log, n);
    answer(log, "drill-bull", n);
    answer(log, "drill-bear", n);
    roundEnd(log, n);
  }
  log.start(4).say(4, "Bull and bear disagree on margins; the bear's filing is the stronger evidence.").end(4);
  const v = view(log);
  assert.equal(v.state, "done");
  const relays = relaysOf(v, log.events);
  assert.equal(relays.length, 1, JSON.stringify(relays));
  assert.deepEqual(relays.map((r) => [r.id, r.status]), [[`task-report:${ID}:turn-4`, "ready"]]);
  assert.match(relays[0]!.text, /bear's filing/);
});

test("a dispatch refused (an error result) is no wait: the turn ends done as before", () => {
  const log = new Log().brief().start(1).call(1, "d1", "dispatch", { to: ["nobody"] }).result(1, "d1", 1, true)
    .say(1, "no bot could be called").end(1);
  const v = view(log);
  assert.equal(v.state, "done");
  assert.equal(relaysOf(v, log.events).length, 1);
});

test("a round that never wakes its worker reads stalled after 20 quiet minutes, and stallOf relays it", () => {
  const log = dispatched(new Log().brief(), 1);
  assert.equal(view(log, log.t + STALL_MS - 1).state, "running");
  const v = view(log, log.t + STALL_MS);
  assert.equal(v.state, "stalled");
  assert.equal(stallOf(v, log.events)?.id, `task-stall:${ID}:${log.events.length}`);
  assert.deepEqual(relaysOf(v, log.events), []);
});
