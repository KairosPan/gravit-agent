// face/tests/et.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { etDate, etDayStart, etTime } from "../src/et.ts";

test("etTime and etDate render America/New_York across DST", () => {
  assert.equal(etTime(new Date("2026-10-20T18:03:00Z")), "14:03 ET");      // EDT
  assert.equal(etTime(new Date("2026-12-01T19:03:00Z")), "14:03 ET");      // EST
  assert.equal(etDate(new Date("2026-10-21T02:30:00Z")), "2026-10-20");    // still the 20th in New York
  assert.equal(etDayStart(Date.parse("2026-10-20T18:03:00Z")), Date.parse("2026-10-20T04:00:00Z"));
  assert.equal(etTime(new Date("2026-10-21T04:00:00Z")), "00:00 ET", "midnight is 00, never 24");
  assert.equal(etDate(new Date("2026-10-21T04:00:00Z")), "2026-10-21");
  assert.equal(etDayStart(Date.parse("2026-10-21T04:00:00Z")), Date.parse("2026-10-21T04:00:00Z"), "midnight is its own day's start");
  assert.equal(etDayStart(Date.parse("2026-10-21T03:59:59.999Z")), Date.parse("2026-10-20T04:00:00Z"), "a millisecond before it is the day before");
  assert.equal(etDayStart(Date.parse("2026-12-01T19:03:00Z")), Date.parse("2026-12-01T05:00:00Z"), "a winter day begins at 05:00 UTC");
});

test("etDayStart on the first Sunday of November 2026: a 25-hour day that begins on EDT", () => {
  // 00:00 EDT; at 02:00 EDT (06:00 UTC) the clocks go back to 01:00 EST
  const start = Date.parse("2026-11-01T04:00:00Z");
  for (const at of ["2026-11-01T04:00:00Z", "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z", "2026-11-01T18:03:00Z", "2026-11-02T04:59:59.999Z"]) {
    assert.equal(etDayStart(Date.parse(at)), start, at);
    assert.equal(etDate(new Date(at)), "2026-11-01", at);
  }
  assert.equal(etTime(new Date("2026-11-01T05:30:00Z")), "01:30 ET", "01:30 EDT");
  assert.equal(etTime(new Date("2026-11-01T06:30:00Z")), "01:30 ET", "01:30 EST, the same hour again");
  assert.equal(etTime(new Date("2026-11-02T04:59:59.999Z")), "23:59 ET");
  assert.equal(etDayStart(Date.parse("2026-11-02T05:00:00Z")), Date.parse("2026-11-02T05:00:00Z"), "the next day begins 25 hours later, at 00:00 EST");
});

test("etDayStart on the second Sunday of March 2026: a 23-hour day that begins on EST", () => {
  // 00:00 EST; at 02:00 EST (07:00 UTC) the clocks go forward to 03:00 EDT
  const start = Date.parse("2026-03-08T05:00:00Z");
  for (const at of ["2026-03-08T05:00:00Z", "2026-03-08T06:59:59.999Z", "2026-03-08T07:00:00Z", "2026-03-08T18:03:00Z", "2026-03-09T03:59:59.999Z"]) {
    assert.equal(etDayStart(Date.parse(at)), start, at);
    assert.equal(etDate(new Date(at)), "2026-03-08", at);
  }
  assert.equal(etTime(new Date("2026-03-08T06:59:59.999Z")), "01:59 ET", "01:59 EST");
  assert.equal(etTime(new Date("2026-03-08T07:00:00Z")), "03:00 ET", "02:00 never happens");
  assert.equal(etDayStart(Date.parse("2026-03-09T04:00:00Z")), Date.parse("2026-03-09T04:00:00Z"), "the next day begins 23 hours later, at 00:00 EDT");
});
