// face/tests/analog-event-summary.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { groupPaths, orderCases, summarizeEvents } from "../plugins/analog/lib/event-summary.mjs";
import type { Measure } from "../plugins/analog/lib/events.mjs";
import { near } from "./analog-fixtures.ts";

type Changes = Partial<Record<"x0" | "x1" | "x5" | "x20" | "x60", number | null>>;
type Case = { id: string, group: string, state: string, measure: Measure | null };

/** A measured case: the changes against the market given, the rest null; `r0` follows `x0` unless given. */
const mk = (id: string, group: string, x: Changes, r0 = x.x0): Case => ({
  id, group, state: "measured",
  measure: { r0, x0: null, x1: null, x5: null, x20: null, x60: null, ...x } as unknown as Measure,
});
/** A case that could not be measured. */
const gone = (id: string, group: string): Case => ({ id, group, state: "unmeasured", measure: null });

const X0 = [-0.10, -0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.04];
const X60 = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4];
test("eight cases get medians and shares; a horizon seven reached gets none", () => {
  const cases = X0.map((x0, i) => mk(`c${i}`, "hired", { x0, x1: x0, x5: x0, x20: i < 7 ? x0 : null, x60: X60[i]! }));
  const s = summarizeEvents([...cases, gone("g", "hired")]);
  assert.deepEqual([s.n, s.n0, s.n20, s.n60], [8, 8, 7, 8]);
  near(s.x0, -0.03); near(s.down0, 0.625); assert.deepEqual(s.worst0, { id: "c0", x0: -0.10 });
  assert.equal(s.x20, null); assert.equal(s.down20, null);
  near(s.x60, 0.05); near(s.x60q1, -0.125); near(s.x60q3, 0.225); near(s.down60, 0.375);
});
test("seven cases are counted and nothing else", () => {
  const s = summarizeEvents(X0.slice(0, 7).map((x0, i) => mk(`c${i}`, "founder", { x0, x60: x0 })));
  assert.deepEqual([s.n, s.n0, s.n60], [7, 7, 7]);
  assert.deepEqual([s.x0, s.x60, s.x60q1, s.x60q3, s.down0, s.down60, s.worst0], [null, null, null, null, null, null, null]);
});
test("a case measured without the market counts in n and in no horizon", () => {
  const s = summarizeEvents([...X0.map((x0, i) => mk(`c${i}`, "a", { x0 })), mk("raw", "a", {}, -0.5)]);
  assert.deepEqual([s.n, s.n0], [9, 8]); near(s.x0, -0.03);
});
test("group paths run while eight cases have the session", () => {
  const cases = Array.from({ length: 8 }, (_, i) => ({ state: "measured", rel: [[-1, 100], [0, 100 + i], [1, 100 + 2 * i], ...(i < 7 ? [[2, 100]] : [])] as Array<[number, number]> }));
  assert.deepEqual(groupPaths(cases), { median: [103.5, 107], q1: [101.75, 103.5], q3: [105.25, 110.5] });
  assert.equal(groupPaths(cases.slice(0, 7)), null);
  assert.equal(groupPaths([...cases.slice(0, 7), { state: "unmeasured", rel: null }]), null);
});
test("cases are ordered by group as first given, the most negative day 0 against the market first", () => {
  const ordered = orderCases([mk("b1", "b", { x0: 0.02 }), mk("a2", "a", { x0: -0.01 }), gone("a0", "a"), mk("a3", "a", {}, -0.09),
    mk("b0", "b", { x0: -0.2 }), mk("a1", "a", { x0: -0.05 }), mk("a4", "a", {}, -0.30)]);
  assert.deepEqual(ordered.map((c) => c.id), ["b0", "b1", "a1", "a2", "a4", "a3", "a0"]);
});
