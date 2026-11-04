import test from "node:test";
import assert from "node:assert/strict";
import { linesOf, WORD_SOURCES, type StoredEvent } from "../src/search-text.ts";

const text = (t: string) => ({ type: "text", text: t });
const user = (seq: number, t: string, source?: unknown, time?: number): StoredEvent =>
  ({ type: "user/message", seq, time, data: { message: { role: "user", content: [text(t)], ...(source ? { source } : {}) } } });
const assistant = (seq: number, content: unknown[], time?: number): StoredEvent =>
  ({ type: "assistant/message", seq, time, data: { message: { role: "assistant", content } } });
const call = (seq: number, callId: string, name: string, args: unknown): StoredEvent =>
  ({ type: "tool/call", seq, data: { callId, name, arguments: JSON.stringify(args) } });
const result = (seq: number, callId: string, body: string, extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}): StoredEvent =>
  ({ type: "tool/result", seq, data: { message: { role: "tool", toolCallId: callId, content: [text(body)], ...extra }, ...data } });

test("the operator's words, Gravit's answer, a phone message and a compaction summary are lines", () => {
  const lines = linesOf([
    user(1, "  看看茅台  ", undefined, 10),
    assistant(2, [text("茅台估值偏高"), text("注意风险")], 11),
    user(3, "from phone", { kind: "telegram" }, 12),
    user(4, "summary of earlier", { kind: "compact-checkpoint" }, 13),
  ]);
  assert.deepEqual(lines, [
    { seq: 1, at: 10, text: "看看茅台" },
    { seq: 2, at: 11, text: "茅台估值偏高\n注意风险" },
    { seq: 3, at: 12, text: "from phone" },
    { seq: 4, at: 13, text: "summary of earlier" },
  ]);
  assert.deepEqual([...WORD_SOURCES].sort(), ["compact-checkpoint", "telegram", "user"]);
});

test("a room member's answer is a line; a room delta is not", () => {
  const lines = linesOf([
    user(1, "bull says", { kind: "room", form: "answer", member: "drill-bull" }),
    user(2, "partial", { kind: "room", form: "delta" }),
  ]);
  assert.deepEqual(lines.map((l) => l.seq), [1]);
});

test("reasoning, a runtime snapshot, a plugin notice, a schedule or alert prompt and a plain tool call are not lines", () => {
  const lines = linesOf([
    assistant(1, [{ type: "reasoning", text: "thinking hard" }]),
    user(2, "snapshot", { kind: "runtime" }),
    user(3, "notice", { kind: "plugin", name: "x" }),
    user(4, "fire", { kind: "schedule" }),
    user(5, "alert!", { kind: "alert" }),
    call(6, "c1", "bash", { command: "ls", summary: "not a present" }),
    result(7, "c1", "files"),
    { type: "turn/start", seq: 8, data: {} },
  ]);
  assert.deepEqual(lines, []);
});

test("an ok lunhui_present call's summary is a line; one whose result in the same batch is an error or not ok is not", () => {
  const ok = linesOf([call(1, "a", "lunhui_present", { summary: "市场综述" }), result(2, "a", JSON.stringify({ ok: true }))]);
  assert.deepEqual(ok, [{ seq: 1, at: 0, text: "市场综述" }]);
  const noResult = linesOf([call(1, "a", "lunhui_present", { summary: "pending" })]);
  assert.equal(noResult.length, 1);
  const viaSource = linesOf([call(1, "a", "lunhui_present", { summary: "s" }), { type: "tool/result", seq: 2, data: { message: { content: [text('{"ok":true}')], source: { callId: "a" } } } }]);
  assert.equal(viaSource.length, 1);
  const isError = linesOf([call(1, "a", "lunhui_present", { summary: "s" }), result(2, "a", '{"ok":true}', { isError: true })]);
  const dataError = linesOf([call(1, "a", "lunhui_present", { summary: "s" }), result(2, "a", '{"ok":true}', {}, { error: { name: "x" } })]);
  const notOk = linesOf([call(1, "a", "lunhui_present", { summary: "s" }), result(2, "a", '{"ok":false}')]);
  const garbage = linesOf([call(1, "a", "lunhui_present", { summary: "s" }), result(2, "a", "nope")]);
  const otherId = linesOf([call(1, "a", "lunhui_present", { summary: "s" }), result(2, "b", '{"ok":false}')]);
  assert.deepEqual([isError, dataError, notOk, garbage].map((l) => l.length), [0, 0, 0, 0]);
  assert.equal(otherId.length, 1);
  assert.deepEqual(linesOf([call(1, "a", "lunhui_present", { summary: "" })]), []);
  assert.deepEqual(linesOf([call(1, "a", "lunhui_present", {})]), []);
});

test("seq and at come from the event, at 0 when time is absent; an empty text is no line", () => {
  const lines = linesOf([user(7, "hi", undefined, 99), user(9, "no time"), user(10, "   "), assistant(11, [text("")])]);
  assert.deepEqual(lines, [{ seq: 7, at: 99, text: "hi" }, { seq: 9, at: 0, text: "no time" }]);
});
