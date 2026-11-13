// face/tests/analog-format.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { DIGEST_MAX, pct, ratio, whole } from "../plugins/analog/lib/format.mjs";
import { MIN_GROUP, quantile } from "../plugins/analog/lib/stats.mjs";
import { near } from "./analog-fixtures.ts";

test("a percentage has one decimal, U+2212 for a negative, + for a positive, bare at zero, n/a when absent", () => {
  assert.equal(pct(-0.1234), "−12.3%");
  assert.equal(pct(0.05), "+5.0%");
  assert.equal(pct(0), "0.0%");
  assert.equal(pct(-0.0004), "0.0%", "a change that rounds to zero carries no sign");
  assert.equal(pct(null), "n/a");
  assert.equal(pct(undefined), "n/a");
});

test("a ratio has one decimal and ×; a share is a whole percentage", () => {
  assert.equal(ratio(4.04), "4.0×");
  assert.equal(ratio(null), "n/a");
  assert.equal(whole(0.625), "63%");
  assert.equal(whole(0), "0%");
  assert.equal(whole(null), "n/a");
  assert.equal(DIGEST_MAX, 2048);
});

test("a quantile interpolates between the two nearest values and leaves its input as it was", () => {
  const values = [0.4, -0.3, 0.2, -0.2, 0.1, -0.1, 0.3, 0];
  const before = [...values];
  near(quantile(values, 0.5), 0.05);
  near(quantile(values, 0.25), -0.125);
  near(quantile(values, 0.75), 0.225);
  assert.deepEqual(values, before);
  assert.equal(quantile([7], 0.25), 7);
  assert.ok(Number.isNaN(quantile([], 0.5)));
  assert.equal(MIN_GROUP, 8);
});
