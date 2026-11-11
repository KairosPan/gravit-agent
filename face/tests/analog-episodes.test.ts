// face/tests/analog-episodes.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { bandsFor, featuresAt } from "../plugins/analog/lib/selloff.mjs";
import { aftermathOf, contextOf, episodesOf, leadingCases, windowOf, withClusters } from "../plugins/analog/lib/episodes.mjs";
import { MARKET, PAST, SELLOFF, barsFrom, near } from "./analog-fixtures.ts";

const q = featuresAt(SELLOFF, 330)!;
const b = bandsFor(q);

test("one day 0 per sell-off, the nearest day; days counts the days that had numbers", () => {
  const { episodes, days } = episodesOf("PAST", PAST, q, b);
  assert.deepEqual(episodes.map((e) => [e.id, e.i, e.peakDate]), [["PAST:2020-05-04", 124, "2020-04-10"], ["PAST:2020-11-21", 325, "2020-11-01"]]);
  near(episodes[0]!.distance, 0.88865, 1e-5); near(episodes[0]!.depth, -0.28); assert.equal(episodes[0]!.days, 24);
  assert.equal(days, 271);
});

test("the query stock's own last sessions are not candidates", () => {
  const { episodes, days } = episodesOf("PAST", PAST, q, b, { skipLast: 15 });
  assert.deepEqual(episodes.map((e) => e.i), [124]);
  assert.equal(days, 256);
  assert.deepEqual(episodesOf("QRY", SELLOFF, q, b, { skipLast: 15 }).episodes, []);
});

test("what came after", () => {
  const a = aftermathOf(PAST, 124);
  near(a.r5, 1 / 12); near(a.r20, 0.125); near(a.r60, 0.25); near(a.low60, -1 / 36); assert.equal(a.lowAt, 4);
  near(a.high60, 0.25); assert.equal(a.sessionsAfter, 206);
  const u = aftermathOf(PAST, 325);
  assert.equal(u.sessionsAfter, 5); near(u.r5, 0); assert.equal(u.r20, null); assert.equal(u.r60, null);
  assert.deepEqual(aftermathOf(PAST, 330), { r5: null, r20: null, r60: null, low60: null, lowAt: null, high60: null, sessionsAfter: 0 });
});

test("market context is cut at −7%, after rounding the change to six decimals", () => {
  const down = contextOf(MARKET, "2020-04-10", "2020-05-04");
  near(down.change, -0.08); assert.equal(down.group, "down");
  assert.deepEqual(contextOf(MARKET, "2020-11-01", "2020-11-21"), { change: 0, group: "calm" });
  assert.equal(contextOf(barsFrom([400, 372]), "2020-01-01", "2020-01-02").group, "down"); // 372 / 400 − 1 is −0.06999999999999995
  assert.deepEqual(contextOf(MARKET, "2019-12-01", "2020-05-04"), { change: null, group: "unknown" });
  assert.deepEqual(contextOf(null, "2020-04-10", "2020-05-04"), { change: null, group: "unknown" });
});

test("a case's window is 30 sessions before to 60 after, as a percentage of day 0's close", () => {
  const w = windowOf(PAST, 124);
  assert.equal(w.length, 91);
  assert.deepEqual(w[0], [-30, 131.94, 131.94, 131.94, 131.94, 1000]);
  assert.deepEqual(w[28], [-2, 104.24, 104.24, 104.17, 104.17, 3000]);
  assert.deepEqual(w[30], [0, 101.39, 101.39, 100, 100, 1000]);
  assert.deepEqual(w[90], [60, 112.5, 125, 112.5, 125, 1000]);
  assert.equal(windowOf(PAST, 325).length, 36);
});

test("clusters count other companies within a week; the leading cases are the stock's own, then one per market event", () => {
  const cases = [
    { id: "QRY:2018-01-10", symbol: "QRY", date: "2018-01-10", distance: 1.4 },
    { id: "QRY:2016-02-08", symbol: "QRY", date: "2016-02-08", distance: 0.9 },
    { id: "QRY:2015-08-24", symbol: "QRY", date: "2015-08-24", distance: 1.1 },
    { id: "QRY:2011-08-08", symbol: "QRY", date: "2011-08-08", distance: 2.0 },
    { id: "QRY:2008-10-10", symbol: "QRY", date: "2008-10-10", distance: 0.5 },
    { id: "A:2020-03-12", symbol: "A", date: "2020-03-12", distance: 1.0 },
    { id: "B:2020-03-16", symbol: "B", date: "2020-03-16", distance: 0.9 },
    { id: "C:2018-11-05", symbol: "C", date: "2018-11-05", distance: 1.2 },
  ];
  withClusters(cases);
  assert.deepEqual(cases.map((c) => (c as { sameWeek?: number }).sameWeek), [0, 0, 0, 0, 0, 1, 1, 0]);
  assert.deepEqual(leadingCases(cases, "QRY"), {
    own: ["QRY:2008-10-10", "QRY:2016-02-08", "QRY:2015-08-24", "QRY:2018-01-10"],
    others: [{ id: "B:2020-03-16", standsFor: 2 }, { id: "C:2018-11-05", standsFor: 1 }],
  });
  assert.deepEqual(leadingCases(cases, "QRY", { own: 1, others: 1 }), { own: ["QRY:2008-10-10"], others: [{ id: "B:2020-03-16", standsFor: 2 }] });
});

test("market context is looked up, not searched: after the first call a call reads no bar's time", () => {
  let reads = 0;
  const counted = MARKET.map((bar) => new Proxy(bar, { get(target, key, receiver) { if (key === "t") reads++; return Reflect.get(target, key, receiver); } }));
  assert.deepEqual(contextOf(counted, "2020-04-10", "2020-05-04"), contextOf(MARKET, "2020-04-10", "2020-05-04"));
  reads = 0;
  for (let k = 0; k < 500; k++) contextOf(counted, "2020-04-10", "2020-05-04");
  assert.equal(reads, 0);
  assert.deepEqual(contextOf(counted, "2019-12-01", "2020-05-04"), { change: null, group: "unknown" });
});

test("a market change that is not a number is unknown, never calm", () => {
  assert.deepEqual(contextOf(barsFrom([0, 400]), "2020-01-01", "2020-01-02"), { change: null, group: "unknown" });
});

test("clusters are counted in one sorted sweep, and agree with counting every pair", () => {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const DAY = 86_400_000, from = Date.UTC(2000, 0, 1);
  const plain = Array.from({ length: 1500 }, (_, k) => ({ symbol: `S${k % 40}`, date: new Date(from + Math.floor(next() * 3650) * DAY).toISOString().slice(0, 10) }));
  const days = plain.map((c) => Date.parse(`${c.date}T00:00:00Z`) / DAY);
  const expected = plain.map((a, i) => plain.reduce((n, b, j) => n + (b.symbol !== a.symbol && Math.abs(days[i]! - days[j]!) <= 7 ? 1 : 0), 0));
  let reads = 0;
  const counted = plain.map((c): { symbol: string; readonly date: string; sameWeek?: number } => ({ symbol: c.symbol, get date() { reads++; return c.date; } }));
  withClusters(counted);
  assert.deepEqual(counted.map((c) => c.sameWeek), expected);
  assert.ok(reads <= 100 * plain.length, `${reads} reads of a date for ${plain.length} cases is every pair, not a sweep`);
});

test("the leading cases read each case's date a few times at most, however many market events there are", () => {
  let reads = 0;
  const DAY = 86_400_000, from = Date.UTC(2000, 0, 1);
  const cases = Array.from({ length: 600 }, (_, k) => {
    const date = new Date(from + k * 30 * DAY).toISOString().slice(0, 10); // each case its own market event, nearest first
    return { id: `S${k}:${date}`, symbol: `S${k}`, distance: k / 100, get date() { reads++; return date; } };
  });
  const { others } = leadingCases(cases, "QRY");
  assert.deepEqual(others, cases.slice(0, 8).map((c) => ({ id: c.id, standsFor: 1 })));
  assert.ok(reads <= 4 * cases.length, `${reads} reads of a date for ${cases.length} cases`);
});
