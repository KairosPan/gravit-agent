import test from "node:test";
import assert from "node:assert/strict";
import { dayZero, eventWindow, measureEvent, tapeCheck } from "../plugins/analog/lib/events.mjs";
import { barOn, windowOf } from "../plugins/analog/lib/episodes.mjs";
import { EVENT, EVENT_CLOSES, EVENT_GAPPED, EVENT_MARKET, SELLOFF, barsFrom, dateAt, near } from "./analog-fixtures.ts";

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
test("every change is from the close before day 0, and against the market by date", () => {
  const m = measureEvent(EVENT, 100, EVENT_MARKET);
  assert.equal(m.base, 50);
  near(m.gap, -0.10); near(m.r0, -0.12); near(m.r1, -0.16); near(m.r5, -0.08); near(m.r20, -0.08); near(m.r60, -0.04);
  near(m.x0, 0.88 / 0.99 - 1); near(m.x1, -0.16); near(m.x5, -0.08); near(m.x20, -0.08); near(m.x60, 0.96 / 1.02 - 1);
  near(m.low60, -0.16); assert.equal(m.lowAt, 1); assert.equal(m.sessionsAfter, 70);
  const gapped = measureEvent(EVENT_GAPPED, 98, EVENT_MARKET); // the market has two sessions the company lacks
  near(gapped.x0, 0.88 / 0.99 - 1); near(gapped.x60, 0.96 / 1.02 - 1); assert.equal(gapped.sessionsAfter, 70);
});
test("a horizon not reached, and a market without the date, are null and never zero", () => {
  const m = measureEvent(EVENT, 150, EVENT_MARKET);
  assert.equal(m.r60, null); assert.equal(m.x60, null); assert.equal(m.sessionsAfter, 20); assert.notEqual(m.r20, null);
  const alone = measureEvent(EVENT, 100, null);
  near(alone.r0, -0.12); assert.deepEqual([alone.x0, alone.x1, alone.x5, alone.x20, alone.x60], [null, null, null, null, null]);
  const late = measureEvent(EVENT, 100, EVENT_MARKET.slice(100)); // the market's bars start on day 0: no close before
  assert.equal(late.x0, null); near(late.r0, -0.12);
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
test("the window is indexed to the close before day 0, and the path against the market pairs by date", () => {
  const { window, rel } = eventWindow(EVENT, 100, EVENT_MARKET);
  assert.equal(window.length, 91);
  assert.deepEqual(window[0], [-30, 100, 100, 100, 100, 1000]);
  assert.deepEqual(window[30], [0, 90, 90, 88, 88, 5000]);
  assert.deepEqual(window[31], [1, 88, 88, 84, 84, 1000]);
  assert.deepEqual(window[90], [60, 96, 96, 96, 96, 1000]);
  assert.deepEqual([rel[29], rel[30], rel[31], rel[90]], [[-1, 100], [0, 88.89], [1, 84], [60, 94.12]]);
  assert.deepEqual(eventWindow(EVENT, 100, null).rel, []);
});
test("episodes.mjs: barOn finds a date's bar; windowOf keeps its old base by default", () => {
  assert.equal(barOn(EVENT_MARKET, "2020-04-10")?.c, 396);
  assert.equal(barOn(EVENT_MARKET, "2019-12-31"), undefined);
  assert.deepEqual(windowOf(SELLOFF, 330), windowOf(SELLOFF, 330, SELLOFF[330]!.c));
});
