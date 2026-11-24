// face/tests/analog-event-summary.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { groupPaths, orderCases, summarizeEvents, valueOf } from "../plugins/analog/lib/event-summary.mjs";
import type { Measure } from "../plugins/analog/lib/events.mjs";
import { near } from "./analog-fixtures.ts";

type Changes = Partial<Record<number, number | null>>;
type Case = { id: string, group: string, state: string, measure: Measure | null };

const HZ = [0, 1, 5, 20, 60];
/**
 * A measured case: `measure.changes` built at `horizons` (default 0 1 5 20 60) from the changes against the benchmark
 * given by horizon, the rest null; each raw change `r` follows `x` unless given.
 */
const mk = (id: string, group: string, x: Changes, r: Changes = x, horizons = HZ): Case => ({
  id, group, state: "measured",
  measure: {
    base: 100, gap: null, low: null, lowAt: null, sessionsAfter: 250,
    changes: horizons.map((k) => ({ k, x: x[k] ?? null, r: r[k] ?? null })),
  },
});
/** A case that could not be measured. */
const gone = (id: string, group: string): Case => ({ id, group, state: "unmeasured", measure: null });

const X0 = [-0.10, -0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.04];
const X60 = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4];

test("valueOf reads x against the benchmark and r raw", () => {
  assert.equal(valueOf({ k: 0, r: 0.1, x: 0.05 }, "benchmark"), 0.05);
  assert.equal(valueOf({ k: 0, r: 0.1, x: 0.05 }, "raw"), 0.1);
  assert.equal(valueOf({ k: 0, r: 0.1, x: null }, "benchmark"), null);
  assert.equal(valueOf(undefined as never, "raw"), null);
});
test("eight cases get medians and shares; a horizon seven reached gets none", () => {
  const cases = X0.map((x0, i) => mk(`c${i}`, "hired", { 0: x0, 1: x0, 5: x0, 20: i < 7 ? x0 : null, 60: X60[i]! }));
  const s = summarizeEvents([...cases, gone("g", "hired")], HZ, "benchmark");
  assert.equal(s.n, 8); assert.equal(s.against, "benchmark");
  assert.deepEqual(s.at.map((a) => [a.k, a.n]), [[0, 8], [1, 8], [5, 8], [20, 7], [60, 8]]);
  near(s.at[0]!.median, -0.03); near(s.at[0]!.down, 0.625); assert.deepEqual(s.worst, { id: "c0", value: -0.10 });
  assert.equal(s.at[3]!.median, null); assert.equal(s.at[3]!.down, null);
  near(s.at[4]!.median, 0.05); near(s.q1, -0.125); near(s.q3, 0.225); near(s.at[4]!.down, 0.375);
});
test("seven cases are counted and nothing else", () => {
  const s = summarizeEvents(X0.slice(0, 7).map((x0, i) => mk(`c${i}`, "founder", { 0: x0, 60: x0 })), HZ, "benchmark");
  assert.deepEqual([s.n, s.at[0]!.n, s.at[4]!.n], [7, 7, 7]);
  for (const a of s.at) assert.deepEqual([a.median, a.down], [null, null]);
  assert.deepEqual([s.q1, s.q3, s.worst], [null, null, null]);
});
test("a case measured without the benchmark counts in n and in no horizon", () => {
  const s = summarizeEvents([...X0.map((x0, i) => mk(`c${i}`, "a", { 0: x0 })), mk("raw", "a", {}, { 0: -0.5 })], HZ, "benchmark");
  assert.deepEqual([s.n, s.at[0]!.n], [9, 8]); near(s.at[0]!.median, -0.03);
});
test("under raw the same cases summarize their r", () => {
  const cases = X0.map((x0, i) => mk(`c${i}`, "a", { 0: x0, 60: X60[i]! }, { 0: x0 + 0.01, 60: X60[i]! + 0.1 }));
  const s = summarizeEvents([...cases, mk("raw", "a", {}, { 0: -0.5 })], HZ, "raw");
  assert.equal(s.against, "raw"); assert.deepEqual([s.n, s.at[0]!.n], [9, 9]);
  near(s.at[0]!.median, -0.03); near(s.at[0]!.down, 6 / 9); assert.deepEqual(s.worst, { id: "raw", value: -0.5 });
  near(s.q1, -0.025); near(s.q3, 0.325);
});
test("horizons [5, 120] summarize those two and the quartiles at 120", () => {
  const cases = X0.map((x0, i) => mk(`c${i}`, "a", { 5: x0, 120: X60[i]! }, undefined, [5, 120]));
  const s = summarizeEvents(cases, [5, 120], "benchmark");
  assert.deepEqual(s.at.map((a) => [a.k, a.n]), [[5, 8], [120, 8]]);
  near(s.at[0]!.median, -0.03); near(s.at[1]!.median, 0.05);
  near(s.q1, -0.125); near(s.q3, 0.225); assert.deepEqual(s.worst, { id: "c0", value: -0.10 });
});
test("group paths run while eight cases have the session", () => {
  const cases = Array.from({ length: 8 }, (_, i) => ({ state: "measured", rel: [[-1, 100], [0, 100 + i], [1, 100 + 2 * i], ...(i < 7 ? [[2, 100]] : [])] as Array<[number, number]> }));
  assert.deepEqual(groupPaths(cases), { median: [103.5, 107], q1: [101.75, 103.5], q3: [105.25, 110.5] });
  assert.equal(groupPaths(cases.slice(0, 7)), null);
  assert.equal(groupPaths([...cases.slice(0, 7), { state: "unmeasured", rel: null }]), null);
});
test("cases are ordered by group as first given, the most negative first horizon against the benchmark first", () => {
  const ordered = orderCases([mk("b1", "b", { 0: 0.02 }), mk("a2", "a", { 0: -0.01 }), gone("a0", "a"), mk("a3", "a", {}, { 0: -0.09 }),
    mk("b0", "b", { 0: -0.2 }), mk("a1", "a", { 0: -0.05 }), mk("a4", "a", {}, { 0: -0.30 })], "benchmark");
  assert.deepEqual(ordered.map((c) => c.id), ["b0", "b1", "a1", "a2", "a4", "a3", "a0"]);
});
test("under raw cases are ordered by r at the first horizon", () => {
  const ordered = orderCases([mk("a1", "a", { 0: -0.5 }, { 0: 0.1 }), gone("a0", "a"), mk("a2", "a", { 0: 0.3 }, { 0: -0.2 }),
    mk("a3", "a", {}, { 0: 0 })], "raw");
  assert.deepEqual(ordered.map((c) => c.id), ["a2", "a3", "a1", "a0"]);
});
