// face/tests/analog-windows.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { POST, PRE, barOn, dateOf, windowOf } from "../plugins/analog/lib/windows.mjs";
import { MARKET, PAST, START, dateAt } from "./analog-fixtures.ts";

test("a bar's date is its UTC date", () => {
  assert.equal(dateOf(START), "2020-01-01");
  assert.equal(dateOf(PAST[124]!.t), dateAt(124));
});

test("a window is 30 sessions before to 60 after, as a percentage of day 0's close", () => {
  assert.deepEqual([PRE, POST], [30, 60]);
  const w = windowOf(PAST, 124);
  assert.equal(w.length, 91);
  assert.deepEqual(w[0], [-30, 131.94, 131.94, 131.94, 131.94, 1000]);
  assert.deepEqual(w[28], [-2, 104.24, 104.24, 104.17, 104.17, 3000]);
  assert.deepEqual(w[30], [0, 101.39, 101.39, 100, 100, 1000]);
  assert.deepEqual(w[90], [60, 112.5, 125, 112.5, 125, 1000]);
  assert.equal(windowOf(PAST, 325).length, 36, "as many sessions after as there are");
  assert.equal(windowOf(PAST, 10)[0]![0], -10, "and as many before");
});

test("a window takes another base when given one", () => {
  const base = PAST[123]!.c;
  const w = windowOf(PAST, 124, base);
  assert.deepEqual(w[29]!.slice(0, 5), [-1, w[29]![1], w[29]![2], w[29]![3], 100], "the base's own close reads 100");
  assert.deepEqual(windowOf(PAST, 124), windowOf(PAST, 124, PAST[124]!.c));
});

test("a series' bar on a date is looked up, not searched: after the first call a call reads no bar's time", () => {
  let reads = 0;
  const counted = MARKET.map((bar) => new Proxy(bar, { get(target, key, receiver) { if (key === "t") reads++; return Reflect.get(target, key, receiver); } }));
  assert.equal(barOn(counted, "2020-05-04")?.c, 368);
  reads = 0;
  for (let k = 0; k < 500; k++) barOn(counted, "2020-05-04");
  assert.equal(reads, 0);
  assert.equal(barOn(counted, "2019-12-01"), undefined, "a date the series has no bar on");
});
