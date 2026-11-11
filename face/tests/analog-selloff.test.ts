// face/tests/analog-selloff.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { LOOKBACK, MIN_BARS, SELLOFF_DEPTH, bandsFor, distance, featuresAt, inBand } from "../plugins/analog/lib/selloff.mjs";
import { PAST, SELLOFF, barsFrom, flat, near } from "./analog-fixtures.ts";

const q = featuresAt(SELLOFF, 330)!;

test("the constants are the spec's", () => {
  assert.deepEqual([LOOKBACK, MIN_BARS, SELLOFF_DEPTH], [60, 120, -0.10]);
});

test("the five numbers of the fixture sell-off", () => {
  near(q.depth, -0.30); assert.equal(q.days, 20); near(q.last5, -0.125); near(q.gap, -0.06);
  assert.equal(q.gapAt, 327); near(q.volume, 4); assert.equal(q.peakAt, 310); assert.equal(q.fromHigh, true);
});

test("too little history gives no numbers, a thin volume baseline no volume, a young high no fromHigh", () => {
  assert.equal(featuresAt(SELLOFF, 59), null);
  const thin = SELLOFF.map((b, i) => (i >= 275 && i < 290 ? { ...b, v: null } : b)); // 35 of the 50 baseline sessions left
  assert.equal(featuresAt(thin, 330)!.volume, null);
  assert.equal(featuresAt(PAST, 124)!.fromHigh, null); // fewer than 200 sessions before the high
});

test("a high that ties is the earliest one", () => {
  const f = featuresAt(barsFrom([...flat(70, 100), 80]), 70)!; // highs of 100 from index 10 to 69
  assert.equal(f.peakAt, 10); assert.equal(f.days, 60); near(f.depth, -0.20);
});

test("bands are relative to the query", () => {
  const b = bandsFor(q);
  near(b.depth[0], -0.435); near(b.depth[1], -0.21); assert.deepEqual(b.days, [8, 36]);
  near(b.last5, -0.06625); near(b.gap, -0.033); near(b.volume, 2.48); assert.deepEqual(b.dropped, []);
  assert.deepEqual(bandsFor({ ...q, days: 4 }).days, [3, 7]);
  assert.deepEqual(bandsFor({ ...q, days: 40 }).days, [16, 59]);
  assert.deepEqual(bandsFor({ ...q, days: 2 }).days, [2, 4]);
  assert.deepEqual(bandsFor({ ...q, days: 1 }).days, [1, 2]);
  assert.deepEqual(bandsFor({ ...q, days: 3 }).days, [3, 5]);
});

test("a condition the query does not meet is dropped and named", () => {
  const b = bandsFor({ ...q, last5: -0.04, gap: -0.01, volume: 1.2 });
  assert.deepEqual([b.last5, b.gap, b.volume], [null, null, null]);
  assert.deepEqual(b.dropped, ["last5", "gap", "volume"]);
  assert.deepEqual(bandsFor({ ...q, volume: null }).dropped, ["volume"]);
});

test("the matching days of the other company, and their distance", () => {
  const b = bandsFor(q);
  const hits = PAST.map((_, i) => i).filter((i) => { const f = featuresAt(PAST, i); return f !== null && inBand(f, b); });
  assert.deepEqual(hits, [122, 123, 124, 125, 322, 323, 324, 325, 326]);
  near(distance(featuresAt(PAST, 124)!, q, b), 0.88865, 1e-5);
  near(distance(featuresAt(PAST, 325)!, q, b), 0, 1e-9);
});

test("a dropped condition leaves its term out of the distance, and a day with no volume fails an active volume band", () => {
  const q2 = { ...q, volume: 1.2 };
  near(distance(featuresAt(PAST, 124)!, q2, bandsFor(q2)), 0.6172542506, 1e-9);
  assert.equal(inBand({ ...featuresAt(PAST, 124)!, volume: null }, bandsFor(q)), false);
});
