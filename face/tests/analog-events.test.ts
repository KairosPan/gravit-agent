import test from "node:test";
import assert from "node:assert/strict";
import {
  BASES, DEFAULT_HORIZONS, DEFAULT_HORIZONS_DAY0_CLOSE, HORIZONS_MAX, HORIZON_MAX, baseOf, casePaths, dayZero, measureCase, tapeCheck,
} from "../plugins/analog/lib/events.mjs";
import { barOn, windowOf } from "../plugins/analog/lib/windows.mjs";
import { EVENT, EVENT_CLOSES, EVENT_GAPPED, EVENT_MARKET, LISTED, SELLOFF, barsFrom, dateAt, near } from "./analog-fixtures.ts";

test("day 0 is the first session that could react", () => {
  assert.equal(dayZero(EVENT, { date: "2020-04-10", timing: "pre" }), 100);
  assert.equal(dayZero(EVENT, { date: "2020-04-10", timing: "open" }), 100);
  assert.equal(dayZero(EVENT, { date: "2020-04-09", timing: "post" }), 100);
  assert.equal(dayZero(EVENT, { date: "2020-04-09", timing: "closed" }), 100);
  assert.equal(dayZero(EVENT, { date: "2020-04-10", timing: "post" }), 101);
});
test("a date that is no session of the company's moves to its next one", () => {
  assert.equal(dayZero(EVENT_GAPPED, { date: "2020-04-08", timing: "pre" }), 98);
  assert.equal(dayZero(EVENT_GAPPED, { date: "2020-04-08", timing: "closed" }), 98);
  assert.equal(dayZero(EVENT_GAPPED, { date: "2020-04-07", timing: "post" }), 98);
  assert.equal(dateAt(100), "2020-04-10");
});
test("a day 0 that has not traded is null", () => {
  assert.equal(dayZero(EVENT, { date: "2020-06-20", timing: "pre" }), null);
  assert.equal(dayZero(EVENT, { date: "2020-06-19", timing: "post" }), null);
});
test("the bases and the horizons", () => {
  assert.deepEqual(BASES, ["prior_close", "price", "day0_open", "day0_close"]);
  assert.deepEqual([HORIZONS_MAX, HORIZON_MAX], [6, 250]);
  assert.deepEqual(DEFAULT_HORIZONS, [0, 1, 5, 20, 60]);
  assert.deepEqual(DEFAULT_HORIZONS_DAY0_CLOSE, [1, 5, 20, 60]);
});
test("prior_close measures from the close before day 0, against the benchmark by date", () => {
  const b = baseOf(EVENT, 100, "prior_close", null, EVENT_MARKET);
  assert.deepEqual(b, { value: 50, benchBase: 400 });
  const m = measureCase(EVENT, 100, "prior_close", b as any, [0, 1, 5, 20, 60], EVENT_MARKET);
  assert.equal(m.base, 50);
  near(m.gap, -0.10);
  assert.deepEqual(m.changes.map((c) => c.k), [0, 1, 5, 20, 60]);
  near(m.changes[0]!.r, -0.12); near(m.changes[1]!.r, -0.16); near(m.changes[2]!.r, -0.08); near(m.changes[3]!.r, -0.08);
  near(m.changes[4]!.r, -0.04);
  near(m.changes[0]!.x, 0.88 / 0.99 - 1); near(m.changes[1]!.x, -0.16); near(m.changes[2]!.x, -0.08);
  near(m.changes[3]!.x, -0.08); near(m.changes[4]!.x, 0.96 / 1.02 - 1);
  near(m.low, -0.16); assert.equal(m.lowAt, 1); assert.equal(m.sessionsAfter, 70);
  // the market has two sessions the company lacks: still paired by date
  const gapped = measureCase(EVENT_GAPPED, 98, "prior_close", baseOf(EVENT_GAPPED, 98, "prior_close", null, EVENT_MARKET) as any, [0, 60], EVENT_MARKET);
  near(gapped.changes[0]!.x, 0.88 / 0.99 - 1); near(gapped.changes[1]!.x, 0.96 / 1.02 - 1); assert.equal(gapped.sessionsAfter, 70);
});
test("prior_close on a first bar says why", () => {
  assert.deepEqual(baseOf(LISTED, 0, "prior_close", null, EVENT_MARKET), {
    words: "day 0 is its first bar (2020-04-10): there is no close before it; measure a listing from its price, day 0's open or day 0's close",
  });
});
test("price measures from the price, the benchmark from its last close before day 0", () => {
  const b = baseOf(LISTED, 0, "price", 40, EVENT_MARKET);
  assert.deepEqual(b, { value: 40, benchBase: 400 });
  const m = measureCase(LISTED, 0, "price", b as any, [0, 5], EVENT_MARKET);
  assert.equal(m.base, 40);
  near(m.gap, 45 / 40 - 1);
  near(m.changes[0]!.r, 44 / 40 - 1);
  near(m.changes[0]!.x, (44 / 40) / (396 / 400) - 1);
  near(m.changes[1]!.r, 46 / 40 - 1);
});
test("day0_open and day0_close measure from day 0's own prices", () => {
  const open = baseOf(LISTED, 0, "day0_open", null, EVENT_MARKET);
  assert.deepEqual(open, { value: 45, benchBase: 400 });
  const mo = measureCase(LISTED, 0, "day0_open", open as any, [0], EVENT_MARKET);
  near(mo.changes[0]!.r, 44 / 45 - 1);
  near(mo.changes[0]!.x, (44 / 45) / (396 / 400) - 1);
  assert.equal(mo.gap, null);
  near(mo.low, 44 / 45 - 1); assert.equal(mo.lowAt, 0);
  assert.deepEqual(baseOf(barsFrom([44, 42], { 0: { o: 0 } }, 100), 0, "day0_open", null, EVENT_MARKET),
    { words: "day 0's open in its bars is not a price" });
  const close = baseOf(LISTED, 0, "day0_close", null, EVENT_MARKET);
  assert.deepEqual(close, { value: 44, benchBase: 396 });
  const mc = measureCase(LISTED, 0, "day0_close", close as any, [1, 5], EVENT_MARKET);
  near(mc.changes[0]!.r, 42 / 44 - 1);
  near(mc.changes[0]!.x, (42 / 44) / (400 / 396) - 1);
  assert.equal(mc.gap, null);
  assert.ok(mc.lowAt !== null && mc.lowAt >= 1);
  near(mc.low, 42 / 44 - 1); assert.equal(mc.lowAt, 1); // day 0's own low of 44 is not counted
  const lastDay = measureCase(LISTED, LISTED.length - 1, "day0_close", { value: 48, benchBase: null }, [1], null);
  assert.deepEqual([lastDay.low, lastDay.lowAt, lastDay.sessionsAfter], [null, null, 0]);
  assert.deepEqual(lastDay.changes, [{ k: 1, r: null, x: null }]);
});
test("a benchmark of none, or one without the date, leaves every x null and never zero", () => {
  const m = measureCase(EVENT, 100, "prior_close", { value: 50, benchBase: null }, [0, 60], null);
  assert.deepEqual(m.changes.map((c) => c.x), [null, null]);
  near(m.changes[0]!.r, -0.12); near(m.changes[1]!.r, -0.04);
  const late = baseOf(EVENT, 100, "prior_close", null, EVENT_MARKET.slice(100)); // the market's bars start on day 0
  assert.equal((late as any).benchBase, null);
  const lm = measureCase(EVENT, 100, "prior_close", late as any, [0], EVENT_MARKET.slice(100));
  assert.equal(lm.changes[0]!.x, null); near(lm.changes[0]!.r, -0.12);
  assert.equal((baseOf(EVENT, 100, "prior_close", null, null) as any).benchBase, null);
});
test("a horizon past the last bar is null", () => {
  const m = measureCase(EVENT, 150, "prior_close", baseOf(EVENT, 150, "prior_close", null, EVENT_MARKET) as any, [0, 20, 60], EVENT_MARKET);
  assert.deepEqual(m.changes[2], { k: 60, r: null, x: null });
  assert.notEqual(m.changes[1]!.r, null);
  assert.equal(m.sessionsAfter, 20);
});
test("the tape check: volume against the 50 sessions before, and the busiest neighbour", () => {
  assert.deepEqual(tapeCheck(EVENT, 100), { vol0: 5, busiest: { at: -2, ratio: 1 }, flags: [] });
  assert.deepEqual(tapeCheck(barsFrom(EVENT_CLOSES, { 100: { o: 45, v: 1200 } }), 100).flags, ["quiet"]);
  assert.deepEqual(tapeCheck(barsFrom(EVENT_CLOSES, { 100: { o: 45, v: 1500 }, 101: { v: 4500 } }), 100),
    { vol0: 1.5, busiest: { at: 1, ratio: 4.5 }, flags: ["elsewhere"] }); // 1.5 is not under 1.5
  assert.deepEqual(tapeCheck(barsFrom(EVENT_CLOSES, { 100: { o: 45, v: 1200 }, 102: { v: 3600 } }), 100).flags, ["quiet", "elsewhere"]);
  assert.deepEqual(tapeCheck(barsFrom(EVENT_CLOSES, { 100: { o: 45, v: 2000 }, 102: { v: 3000 } }), 100),
    { vol0: 2, busiest: { at: 2, ratio: 3 }, flags: ["elsewhere"] }); // exactly 3 and exactly 1.5 times day 0's
  assert.deepEqual(tapeCheck(barsFrom(EVENT_CLOSES, { 100: { o: 45, v: 2100 }, 102: { v: 3000 } }), 100).flags, []);
});
test("fewer than 20 volumes before day 0, or none on it, give no ratio and no flag", () => {
  assert.deepEqual(tapeCheck(EVENT, 15), { vol0: null, busiest: null, flags: [] });
  assert.deepEqual(tapeCheck(barsFrom(EVENT_CLOSES, { 100: { o: 45, v: null } }), 100), { vol0: null, busiest: null, flags: [] });
});
test("the paths run to the larger of 60 and the last horizon", () => {
  const { window, rel, relOf } = casePaths(EVENT, 100, baseOf(EVENT, 100, "prior_close", null, EVENT_MARKET) as any, EVENT_MARKET, 60);
  assert.equal(window.length, 91);
  assert.deepEqual(window[0], [-30, 100, 100, 100, 100, 1000]);
  assert.deepEqual(window[30], [0, 90, 90, 88, 88, 5000]);
  assert.deepEqual(window[31], [1, 88, 88, 84, 84, 1000]);
  assert.deepEqual(window[90], [60, 96, 96, 96, 96, 1000]);
  assert.equal(relOf, "benchmark");
  assert.equal(rel.length, 91);
  assert.deepEqual([rel[29], rel[30], rel[31], rel[90]], [[-1, 100], [0, 88.89], [1, 84], [60, 94.12]]);
  const short = casePaths(EVENT, 100, { value: 50, benchBase: 400 }, EVENT_MARKET, 20);
  assert.deepEqual(short.rel.at(-1)![0], 20);
  const listed = casePaths(LISTED, 0, { value: 40, benchBase: 400 }, EVENT_MARKET, 250);
  assert.equal(listed.window[0]![0], 0); // nothing before a listing
  assert.equal(listed.rel[0]![0], 0);
  assert.equal(listed.rel.at(-1)![0], 70); // as far as the bars go
  const self = casePaths(LISTED, 0, { value: 40, benchBase: null }, null, 60);
  assert.equal(self.relOf, "self");
  assert.deepEqual(self.rel[0], [0, 110]);
});
test("windows.mjs: barOn finds a date's bar; windowOf keeps day 0's close as its base by default", () => {
  assert.equal(barOn(EVENT_MARKET, "2020-04-10")?.c, 396);
  assert.equal(barOn(EVENT_MARKET, "2019-12-31"), undefined);
  assert.deepEqual(windowOf(SELLOFF, 330), windowOf(SELLOFF, 330, SELLOFF[330]!.c));
});
