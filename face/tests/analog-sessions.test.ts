import test from "node:test";
import assert from "node:assert/strict";
import { CALENDAR_DAYS, checkDayZero } from "../plugins/analog/lib/sessions.mjs";
import { dayZero } from "../plugins/analog/lib/events.mjs";
import { EVENT, EVENT_MARKET, LISTED, barsFrom, flat } from "./analog-fixtures.ts";

const full = { calendar: EVENT_MARKET, short: false };

test("the calendar's fallback is 7 calendar days", () => {
  assert.equal(CALENDAR_DAYS, 7);
});
test("no session skipped", () => {
  assert.deepEqual(checkDayZero(EVENT, 100, { date: "2020-04-10", timing: "pre" }, full), { skipped: 0, listed: false });
});
test("a halt is measured and counted", () => {
  const halted = EVENT.filter((_, i) => i < 101 || i > 110);
  const when = { date: "2020-04-11", timing: "pre" } as const;
  assert.equal(dayZero(halted, when), 101);
  assert.deepEqual(checkDayZero(halted, 101, when, full), { skipped: 10, listed: false });
});
test("a listing: no session skipped, the first bar of a full history", () => {
  const when = { date: "2020-04-10", timing: "open" } as const;
  assert.deepEqual(checkDayZero(LISTED, 0, when, full), { skipped: 0, listed: true });
  assert.deepEqual(checkDayZero(LISTED, 0, when, { calendar: EVENT_MARKET, short: true }), { skipped: 0, listed: false });
});
test("an IPO dated by its pricing evening is still its listing day", () => {
  const when = { date: "2020-04-09", timing: "post" } as const;
  assert.equal(dayZero(LISTED, when), 0);
  assert.deepEqual(checkDayZero(LISTED, 0, when, full), { skipped: 0, listed: true });
});
test("the date's session missing from a stock's first bars is unmeasured", () => {
  const late = LISTED.slice(1);
  assert.deepEqual(checkDayZero(late, 0, { date: "2020-04-10", timing: "open" }, full), {
    words: "its bars start 2020-04-11, 1 session after 2020-04-10: the date's session is not in its bars",
  });
  assert.deepEqual(checkDayZero(LISTED, 0, { date: "2020-03-01", timing: "pre" }, full), {
    words: "its bars start 2020-04-10, 40 sessions after 2020-03-01: the date's session is not in its bars",
  });
});
test("before the calendar, 7 calendar days", () => {
  const calendar = EVENT_MARKET.slice(50);
  const when = { date: "2020-01-11", timing: "pre" } as const;
  const far = barsFrom(flat(60, 50), {}, 20);
  const near = barsFrom(flat(60, 50), {}, 15);
  const words = { words: "day 0 would be 2020-01-21, 10 days after 2020-01-11: its bars do not cover the date" };
  assert.deepEqual(checkDayZero(far, 0, when, { calendar, short: false }), words);
  assert.deepEqual(checkDayZero(near, 0, when, { calendar, short: false }), { skipped: 0, listed: false });
  assert.deepEqual(checkDayZero(far, 0, when, { calendar: null, short: false }), words);
  assert.deepEqual(checkDayZero(near, 0, when, { calendar: null, short: false }), { skipped: 0, listed: false });
  assert.deepEqual(checkDayZero(far, 0, when, { calendar: [], short: false }), words);
});
test("a date past the calendar's last session is not covered", () => {
  const calendar = EVENT_MARKET.slice(0, 101);
  const when = { date: "2020-04-10", timing: "post" } as const;
  assert.deepEqual(checkDayZero(EVENT, 101, when, { calendar, short: false }), { skipped: 0, listed: false });
});
