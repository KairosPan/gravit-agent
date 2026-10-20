import test from "node:test";
import assert from "node:assert/strict";
import { composeSubagentCatalog, isSubagentRow, normalizeSubagentCatalog, subagentAddress, subagentControls, subagentResult } from "../client/subagents.js";

const catalog = { parentAvailable: true, entries: [
  { kind: "child", id: "live", label: "核查", mode: "continuable", activity: "running", hasChildren: true },
  { kind: "child", id: "once", mode: "one-shot", activity: "inactive" },
  { kind: "diagnostic", id: "broken", reason: "corrupt" },
] };

test("subagents remain separate from room members and ordinary forks", () => {
  assert.equal(isSubagentRow({ parentSessionId: "p", agentPreset: "bot" }), false);
  assert.equal(isSubagentRow({ parentSessionId: "p", agentPreset: "gravit" }), false);
  assert.equal(isSubagentRow({ origin: "subagent", parentSessionId: "p" }), true);
});
test("catalog keeps diagnostics and makes unknown schemas visible but uncontrollable", () => {
  const normalized = normalizeSubagentCatalog({ parentAvailable: false, entries: [...catalog.entries,
    { kind: "child", id: "bad", mode: "continuable" }, { kind: "child", id: "live", mode: "one-shot" }, null] });
  assert.equal(normalized.parentAvailable, false);
  assert.equal(normalized.entries.length, 4);
  assert.deepEqual(normalized.entries[3], { kind: "diagnostic", id: "bad", reason: "unsupported" });
});
test("malformed catalog is unavailable, never an empty successful listing", () => {
  for (const value of [null, {}, { entries: [], parentAvailable: 1 }, { parentAvailable: false }]) assert.throws(() => normalizeSubagentCatalog(value), /目录不可用/);
});
test("unknown activity stays unknown, not inactive", () => {
  const row = normalizeSubagentCatalog({ parentAvailable: true, entries: [{ kind: "child", id: "unknown", mode: "one-shot" }] }).entries[0];
  assert.equal(subagentControls(row, true).state, "运行状态未知");
});
test("only a healthy catalog child yields a durable direct-parent address", () => {
  assert.deepEqual(subagentAddress("p", "live", catalog), { parentSessionId: "p", childSessionId: "live", mode: "continuable" });
  assert.equal(subagentAddress("p", "broken", catalog), null);
  assert.equal(subagentAddress("p", "missing", catalog), null);
  assert.equal(subagentAddress("live", "live", catalog), null);
});
test("inactive never means completed; one-shot remains read-only", () => {
  const state = subagentControls(catalog.entries[1], true);
  assert.equal(state.state, "未运行");
  assert.equal(state.canRead, true);
  assert.equal(state.canPrompt, false);
  assert.equal(state.canInterrupt, false);
});
test("cold parent disables continuation while allowing reads and live interrupt", () => {
  const state = subagentControls(catalog.entries[0], false);
  assert.equal(state.canRead, true);
  assert.equal(state.canPrompt, false);
  assert.equal(state.canInterrupt, true);
  assert.match(state.note, /父会话未加载/);
  assert.equal(subagentControls(catalog.entries[0], true, true).state, "等待你的回应");
});
test("diagnostics never enable controls", () => {
  assert.deepEqual(subagentControls(catalog.entries[2], true), { canRead: false, canPrompt: false, canInterrupt: false, state: "记录不可用 · corrupt", note: "保留记录，无法读取或续派。" });
});
test("last recorded output skips tool-only messages and marks interrupted prefixes", () => {
  // 0.2 page records are `{type:'event', event}` (session-controller src/types.ts:425-429).
  const entry = (text: string, interrupted = false) => ({ type: "event", event: { type: "assistant/message", data: { message: { content: [{ type: "text", text }] }, interrupted } } });
  assert.deepEqual(subagentResult([entry("first"), entry("partial", true), { type: "event", event: { type: "turn/end" } }]), { text: "partial", interrupted: true });
  assert.equal(subagentResult([]), null);
});

/* ---------- composing 0.1.1's `subagent.list` from what 0.2 serves ---------- */

/** The parent's `subagentCatalog` projection value (NEW subagent src/projection-types.ts:9-19). */
const projected = [
  { id: "live", createdAt: 1, mode: "continuable", label: "核查" },
  { id: "once", createdAt: 2, mode: "one-shot" },
  { id: "legacy", createdAt: 3, mode: "unknown" },
  { id: "cold", createdAt: 4, mode: "continuable", label: "冷任务" },
];
/** `session/list` rows (0.2 SessionSummary). */
const rows = [
  { sessionId: "parent", agentAvailable: true, running: false },
  { sessionId: "live", origin: "subagent", parentSessionId: "parent", agentAvailable: true, running: true },
  { sessionId: "once", origin: "subagent", parentSessionId: "parent", agentAvailable: false, running: false },
  { sessionId: "grandchild", origin: "subagent", parentSessionId: "live", agentAvailable: false, running: false },
  { sessionId: "fork", parentSessionId: "once", agentPreset: "gravit" }, // a fork, not a subagent: not a child of `once`
];

test("compose: catalog order, modes and labels; activity from the child's running row; hasChildren from subagent rows", () => {
  const composed = composeSubagentCatalog({ catalog: projected, parentSummary: rows[0], rows });
  assert.equal(composed.parentAvailable, true);
  assert.deepEqual(composed.entries, [
    { kind: "child", id: "live", mode: "continuable", label: "核查", activity: "running", hasChildren: true },
    { kind: "child", id: "once", mode: "one-shot", activity: "inactive", hasChildren: false },
    { kind: "diagnostic", id: "legacy", reason: "unsupported" },
    { kind: "child", id: "cold", mode: "continuable", label: "冷任务", hasChildren: false },
  ]);
});

test("compose → normalize keeps every 0.1.1 decision: unknown mode is a diagnostic, an unlisted child's activity is unknown", () => {
  const normalized = normalizeSubagentCatalog(composeSubagentCatalog({ catalog: projected, parentSummary: rows[0], rows }));
  assert.deepEqual(normalized.entries.map((e) => `${e.id}:${e.kind}:${e.activity ?? e.reason}`), [
    "live:child:running", "once:child:inactive", "legacy:diagnostic:unsupported", "cold:child:unknown",
  ]);
  assert.deepEqual(subagentAddress("parent", "live", normalized), { parentSessionId: "parent", childSessionId: "live", mode: "continuable" });
  assert.equal(subagentAddress("parent", "legacy", normalized), null, "an unknown-mode child is never controllable");
  assert.equal(subagentControls(normalized.entries[3], true).state, "运行状态未知");
});

test("compose: parent availability is the parent row's agentAvailable, and an unlisted parent is not available", () => {
  assert.equal(composeSubagentCatalog({ catalog: [], parentSummary: { sessionId: "p", agentAvailable: false }, rows }).parentAvailable, false);
  assert.equal(composeSubagentCatalog({ catalog: [], parentSummary: undefined, rows }).parentAvailable, false);
});

test("compose: an absent projection is no children; a present non-list is unavailable, never an empty listing", () => {
  assert.deepEqual(composeSubagentCatalog({ catalog: undefined, parentSummary: rows[0], rows }), { entries: [], parentAvailable: true });
  for (const bad of [null, {}, "live", 3]) {
    assert.throws(() => composeSubagentCatalog({ catalog: bad, parentSummary: rows[0], rows }), /目录不可用/);
  }
  const skipped = composeSubagentCatalog({ catalog: [null, { mode: "one-shot" }, { id: "", mode: "one-shot" }, projected[1]], parentSummary: rows[0], rows });
  assert.deepEqual(skipped.entries.map((e) => e.id), ["once"], "malformed rows are skipped as normalize skips them");
});
