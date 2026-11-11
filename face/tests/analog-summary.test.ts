// face/tests/analog-summary.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { MIN_GROUP, quantile, summarize } from "../plugins/analog/lib/summary.mjs";
import { near } from "./analog-fixtures.ts";

const mk = (r60s: number[]) => r60s.map((r60, k) => ({ after: { r5: 0.01, r20: 0.02, r60, low60: -0.05 * (k + 1), lowAt: k + 1, high60: 0.1, sessionsAfter: 100 } }));
const EIGHT = [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5];
const STATS = ["r5", "r20", "r60", "r60q1", "r60q3", "low60", "lowAt", "lower5", "lower10", "lower20", "up20", "up60"] as const;

test("quantiles interpolate between the two nearest values", () => {
  assert.equal(MIN_GROUP, 8);
  near(quantile(EIGHT, 0.25), -0.025); near(quantile(EIGHT, 0.5), 0.15); near(quantile(EIGHT, 0.75), 0.325);
});

test("eight cases are summarized", () => {
  const s = summarize(mk(EIGHT));
  assert.deepEqual([s.n, s.n60, s.summarized], [8, 8, true]);
  near(s.r5, 0.01); near(s.r20, 0.02); near(s.r60, 0.15); near(s.r60q1, -0.025); near(s.r60q3, 0.325);
  near(s.low60, -0.225); near(s.lowAt, 4.5);
  near(s.lower5, 1); near(s.lower10, 7 / 8); near(s.lower20, 5 / 8); near(s.up20, 1); near(s.up60, 5 / 8);
});

test("seven cases are counted and not summarized", () => {
  const s = summarize(mk(EIGHT.slice(0, 7)));
  assert.deepEqual([s.n, s.n60, s.summarized], [7, 7, false]);
  for (const key of STATS) assert.equal(s[key], null, key);
});

test("a case short of 60 sessions is counted and left out of the 60-session figures; one under way is in no summary", () => {
  const short = { after: { r5: 0.5, r20: 0.5, r60: null, low60: -0.01, lowAt: 2, high60: 0.5, sessionsAfter: 30 } };
  const underWay = { after: { r5: 0.9, r20: null, r60: null, low60: -0.9, lowAt: 1, high60: 0.9, sessionsAfter: 5 } };
  const s = summarize([...mk(EIGHT), short, underWay]);
  assert.deepEqual([s.n, s.n60, s.summarized], [9, 8, true]);
  near(s.r60, 0.15); near(s.r5, 0.01); near(s.lower10, 7 / 8);
  assert.deepEqual([summarize([]).n, summarize([]).summarized], [0, false]);
});
