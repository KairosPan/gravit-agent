// face/tests/routine-schedule.test.ts
/** A routine's schedule (src/routine-schedule.ts): what parseSchedule refuses and in which sentence, the slots of an
 * `every` schedule, New York's wall clock across both daylight-saving Sundays, which dates a schedule admits, its when
 * line, and the next run from a Friday evening. Pure, offline. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  admits, EVERY_MAX, EVERY_MIN, nextRun, nyInstant, parseSchedule, runsPerDay, SLOT_GRACE_MS, SLOT_WAIT_MS, SLOTS_MAX,
  slotsOn, slotTimes, TIMES_MAX, whenText, type RoutineSchedule,
} from "../src/routine-schedule.ts";

/** `raw` parsed, or the test fails. */
const parsed = (raw: unknown): RoutineSchedule => {
  const r = parseSchedule(raw);
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r.schedule;
};

/** The sentence parseSchedule refuses `raw` with. */
const refusal = (raw: unknown): string => {
  const r = parseSchedule(raw);
  if (r.ok) throw new Error("it parses");
  return r.error;
};

test("the limits are the plan's", () => {
  assert.deepEqual(
    [SLOT_GRACE_MS, SLOT_WAIT_MS, SLOTS_MAX, TIMES_MAX, EVERY_MIN, EVERY_MAX],
    [300_000, 900_000, 48, 8, 15, 240],
  );
});

test("whenText: the six when lines", () => {
  assert.equal(whenText(parsed({ days: "trading", every: { minutes: 30, from: "08:30", to: "16:00" } })),
    "Trading days, every 30 min, 08:30–16:00 ET · 16 runs a day");
  assert.equal(whenText(parsed({ days: "trading", times: ["16:10"] })), "Trading days at 16:10 ET");
  assert.equal(whenText(parsed({ days: "trading", times: ["15:50", "09:35"] })), "Trading days at 09:35 and 15:50 ET · 2 runs a day");
  assert.equal(whenText(parsed({ days: "daily", times: ["07:00"] })), "Every day at 07:00 ET");
  assert.equal(whenText(parsed({ days: ["sun"], times: ["18:00"] })), "Sundays at 18:00 ET");
  assert.equal(whenText(parsed({ days: ["fri", "mon", "wed"], times: ["12:00"] })), "Mon, Wed and Fri at 12:00 ET");
});

test("whenText: three times join with commas and a final and", () => {
  assert.equal(whenText(parsed({ days: ["mon", "tue"], times: ["09:00", "12:00", "15:00"] })),
    "Mon and Tue at 09:00, 12:00 and 15:00 ET · 3 runs a day");
});

test("slotTimes: every 30 from 08:30 to 16:00 is 16 slots, `to` inclusive", () => {
  const schedule = parsed({ days: "trading", every: { minutes: 30, from: "08:30", to: "16:00" } });
  const slots = slotTimes(schedule);
  assert.equal(slots.length, 16);
  assert.equal(slots[0], "08:30");
  assert.equal(slots[1], "09:00");
  assert.equal(slots.at(-1), "16:00");
  assert.equal(runsPerDay(schedule), 16);
});

test("slotTimes: `to` off the step is not a slot; times come back ascending", () => {
  assert.deepEqual(slotTimes(parsed({ days: "daily", every: { minutes: 45, from: "09:00", to: "11:00" } })), ["09:00", "09:45", "10:30"]);
  assert.deepEqual(slotTimes(parsed({ days: "daily", times: ["15:50", "09:35"] })), ["09:35", "15:50"]);
});

test("parseSchedule: each refusal in its own sentence", () => {
  const every = { minutes: 30, from: "08:30", to: "16:00" };
  const cases: [unknown, string][] = [
    [null, "A schedule is an object with days and either times or every."],
    [{ days: "daily", times: ["09:00"], at: "x" }, "A schedule has no key at."],
    [{ days: "daily", every: { ...every, step: 1 } }, "every has no key step."],
    [{ days: "daily", times: ["09:00"], every }, "A schedule has times or every, not both."],
    [{ days: "daily" }, "A schedule needs times or every."],
    [{ days: "daily", times: ["9:00"] }, "9:00 is not a time as HH:MM."],
    [{ days: "daily", times: ["24:00"] }, "24:00 is not a time as HH:MM."],
    [{ days: "daily", times: [] }, "times lists 1 to 8 times."],
    [{ days: "daily", times: ["09:00", "09:00"] }, "09:00 is listed twice."],
    [{ days: "daily", times: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00", "08:00", "09:00"] }, "times lists 1 to 8 times."],
    [{ days: "daily", every: { ...every, minutes: 10 } }, "every.minutes is 15 to 240, in steps of 5."],
    [{ days: "daily", every: { ...every, minutes: 245 } }, "every.minutes is 15 to 240, in steps of 5."],
    [{ days: "daily", every: { ...every, minutes: 17 } }, "every.minutes is 15 to 240, in steps of 5."],
    [{ days: "daily", every: { ...every, from: "8:30" } }, "8:30 is not a time as HH:MM."],
    [{ days: "daily", every: { ...every, from: "16:00", to: "16:00" } }, "every.from comes before every.to."],
    [{ days: "daily", every: { minutes: 15, from: "00:00", to: "23:45" } }, "A schedule runs at most 48 times a day."],
    [{ days: [], times: ["09:00"] }, "days lists at least one weekday."],
    [{ days: ["mon", "mon"], times: ["09:00"] }, "mon is listed twice in days."],
    [{ days: "weekdays", times: ["09:00"] }, "days is trading, daily or a list of weekdays (mon to sun)."],
    [{ days: ["monday"], times: ["09:00"] }, "days is trading, daily or a list of weekdays (mon to sun)."],
    [{ times: ["09:00"] }, "days is trading, daily or a list of weekdays (mon to sun)."],
  ];
  for (const [raw, sentence] of cases) assert.equal(refusal(raw), sentence, JSON.stringify(raw));
});

test("parseSchedule: 48 slots is the limit, not past it", () => {
  assert.equal(runsPerDay(parsed({ days: "daily", every: { minutes: 15, from: "08:00", to: "19:45" } })), 48);
});

test("nyInstant: New York's wall clock, both daylight-saving Sundays", () => {
  assert.equal(nyInstant("2026-11-13", "08:30"), Date.parse("2026-11-13T13:30:00Z"));
  assert.equal(nyInstant("2026-07-01", "09:30"), Date.parse("2026-07-01T13:30:00Z"));
  assert.equal(nyInstant("2026-03-08", "02:30"), undefined);
  assert.equal(nyInstant("2026-03-08", "03:00"), Date.parse("2026-03-08T07:00:00Z"));
  assert.equal(nyInstant("2026-03-08", "01:59"), Date.parse("2026-03-08T06:59:00Z"));
  assert.equal(nyInstant("2026-11-01", "01:30"), Date.parse("2026-11-01T05:30:00Z"));
  assert.equal(nyInstant("2026-11-01", "09:30"), Date.parse("2026-11-01T14:30:00Z"));
});

test("admits: trading, daily and a weekday list", () => {
  const trading = parsed({ days: "trading", times: ["09:35"] });
  assert.equal(admits(trading, "2026-11-26", false), false);
  assert.equal(admits(trading, "2026-11-25", true), true);
  assert.equal(admits(parsed({ days: "daily", times: ["07:00"] }), "2026-11-26", false), true);
  const sundays = parsed({ days: ["sun"], times: ["18:00"] });
  for (const date of ["2026-11-14", "2026-11-15", "2026-11-16"]) {
    assert.equal(admits(sundays, date, false), date === "2026-11-15", date);
  }
});

test("slotsOn: none on a day not admitted; a skipped wall time is no slot", () => {
  const trading = parsed({ days: "trading", times: ["09:35"] });
  assert.deepEqual(slotsOn(trading, "2026-11-26", false), []);
  assert.deepEqual(slotsOn(trading, "2026-11-13", true), [{ slot: "09:35", at: Date.parse("2026-11-13T14:35:00Z") }]);
  const night = parsed({ days: "daily", times: ["02:30", "03:00"] });
  assert.deepEqual(slotsOn(night, "2026-03-08", false), [{ slot: "03:00", at: Date.parse("2026-03-08T07:00:00Z") }]);
});

test("nextRun: from a Friday 17:00 ET, a trading-days routine runs Monday's first slot", () => {
  const schedule = parsed({ days: "trading", every: { minutes: 30, from: "08:30", to: "16:00" } });
  const friday = Date.parse("2026-11-13T22:00:00Z");
  const isTrading = (date: string): boolean | undefined => {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6;
  };
  assert.deepEqual(nextRun(schedule, friday, isTrading), { date: "2026-11-16", slot: "08:30", at: Date.parse("2026-11-16T13:30:00Z") });
});

test("nextRun: later the same day; an unknown calendar is no trading day; none in ten days is undefined", () => {
  const schedule = parsed({ days: "trading", times: ["09:35", "15:50"] });
  const morning = Date.parse("2026-11-13T15:00:00Z");
  assert.deepEqual(nextRun(schedule, morning, () => true), { date: "2026-11-13", slot: "15:50", at: Date.parse("2026-11-13T20:50:00Z") });
  assert.equal(nextRun(schedule, morning, () => undefined), undefined);
  assert.equal(nextRun(schedule, morning, () => false), undefined);
});
