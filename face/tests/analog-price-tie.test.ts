// face/tests/analog-price-tie.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { SPLITS_MAX, TIE_TOLERANCE, factorWords, tiePrice } from "../plugins/analog/lib/price-tie.mjs";

const after = (n: number, i = 0) => ({ date: `2015-03-${String(19 + i).padStart(2, "0")}`, new: n, old: 1 });

test("the tolerance is 2% and a record holds at most 20 splits", () => {
  assert.equal(TIE_TOLERANCE, 0.02);
  assert.equal(SPLITS_MAX, 20);
});

test("no split: the stated open is the bars' open", () => {
  assert.deepEqual(tiePrice({ day0Open: 111.5, day0Date: "2026-11-19", statedOpen: 111.5, splits: null }), { factor: 1, splitFactor: null });
  assert.deepEqual(tiePrice({ day0Open: 111.5, day0Date: "2026-11-19", statedOpen: 113, splits: null }), { factor: 1, splitFactor: null });
});

test("a split record the bars confirm", () => {
  assert.deepEqual(
    tiePrice({ day0Open: 11.0, day0Date: "2008-03-19", statedOpen: 44, splits: [{ date: "2015-03-19", new: 4, old: 1 }] }),
    { factor: 4, splitFactor: 4 },
  );
  assert.deepEqual(
    tiePrice({ day0Open: 18, day0Date: "2008-03-19", statedOpen: 270, splits: [after(5, 0), after(3, 1)] }),
    { factor: 15, splitFactor: 15 },
  );
  const amzn = [
    { date: "1998-06-02", new: 2, old: 1 },
    { date: "1999-01-05", new: 3, old: 1 },
    { date: "1999-09-02", new: 2, old: 1 },
    { date: "2022-06-06", new: 20, old: 1 },
  ];
  assert.deepEqual(tiePrice({ day0Open: 0.1156, day0Date: "1997-05-15", statedOpen: 27.75, splits: amzn }), { factor: 240, splitFactor: 240 });
  assert.deepEqual(
    tiePrice({ day0Open: 20, day0Date: "2008-03-19", statedOpen: 2, splits: [{ date: "2015-03-19", new: 1, old: 10 }] }),
    { factor: 0.1, splitFactor: 0.1 },
  );
});

test("a split on or before day 0 adjusts nothing", () => {
  assert.deepEqual(
    tiePrice({ day0Open: 11, day0Date: "2008-03-19", statedOpen: 11, splits: [{ date: "2008-01-02", new: 2, old: 1 }] }),
    { factor: 1, splitFactor: null },
  );
  assert.deepEqual(
    tiePrice({ day0Open: 11, day0Date: "2008-03-19", statedOpen: 11, splits: [{ date: "2008-03-19", new: 2, old: 1 }] }),
    { factor: 1, splitFactor: null },
  );
});

test("a record the bars do not show", () => {
  const twice = [{ date: "2015-03-19", new: 4, old: 1 }, { date: "2015-03-19", new: 4, old: 1 }];
  assert.deepEqual(
    tiePrice({ day0Open: 11, day0Date: "2008-03-19", statedOpen: 44, splits: twice }),
    { words: "its split record gives ×16, its bars ×4" },
  );
});

test("the bars adjusted with no record", () => {
  assert.deepEqual(
    tiePrice({ day0Open: 10.5, day0Date: "2008-03-19", statedOpen: 42, splits: null }),
    { words: "its bars are adjusted about ×4 since day 0 (its source's open 42.00, the bars' 10.50): a split record is needed" },
  );
});

test("no stated open", () => {
  assert.deepEqual(
    tiePrice({ day0Open: 10.5, day0Date: "2008-03-19", statedOpen: null, splits: null }),
    { words: "no first-day open from its source: its price cannot be tied to the bars" },
  );
  assert.deepEqual(
    tiePrice({ day0Open: 0, day0Date: "2008-03-19", statedOpen: 42, splits: null }),
    { words: "day 0's open in its bars is not a price" },
  );
});

test("factorWords", () => {
  assert.deepEqual([4, 15, 240, 0.1, 1.5, 4.0000001].map(factorWords), ["4", "15", "240", "0.1", "1.5", "4"]);
});

test("the bars' factor is written as a factor is, a reverse split included", () => {
  // a 1-for-25 reverse split since day 0: the bars' open is 25 times the stated one
  assert.deepEqual(
    tiePrice({ day0Open: 250, day0Date: "2008-03-19", statedOpen: 10, splits: null }),
    { words: "its bars are adjusted about ×0.04 since day 0 (its source's open 10.00, the bars' 250.00): a split record is needed" },
  );
  assert.deepEqual(
    tiePrice({ day0Open: 250, day0Date: "2008-03-19", statedOpen: 10, splits: [{ date: "2015-03-19", new: 1, old: 10 }] }),
    { words: "its split record gives ×0.1, its bars ×0.04" },
  );
});
