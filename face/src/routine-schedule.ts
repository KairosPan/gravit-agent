/** A routine's schedule: which New York dates it runs on, at which wall-clock minutes, and how it reads to the
 * operator. A routine is a named instruction the operator confirmed, run by an unattended agent; this module is the
 * pure arithmetic under its store, its runs and its clock, and imports nothing from the tree but `et.ts`.
 *
 * A schedule is `days` - `"trading"` (the market calendar's open days), `"daily"`, or a list of weekdays - with either
 * `times` (1 to {@link TIMES_MAX} wall-clock minutes) or `every` (a step of {@link EVERY_MIN} to {@link EVERY_MAX}
 * minutes from `from` up to and including `to` when it lands on a step). Every time is New York's wall clock: a minute
 * a daylight-saving change skips is no slot that day, and one it repeats is one slot, at its first occurrence
 * ({@link nyInstant}). A weekday is the one the calendar date has in New York.
 * @module
 */
import { etDate, etTime } from "./et.ts";

/** A day of the week, as a schedule's `days` list names it. */
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** When a routine runs: on which days, at listed times or every so many minutes between two times. */
export type RoutineSchedule =
  | { days: "trading" | "daily" | Weekday[]; times: string[] }
  | { days: "trading" | "daily" | Weekday[]; every: { minutes: number; from: string; to: string } };

/** How late after its minute a slot is still run on time. */
export const SLOT_GRACE_MS = 300_000;
/** How late after its minute a queued slot may still start. */
export const SLOT_WAIT_MS = 900_000;
/** The most slots a schedule has in a day. */
export const SLOTS_MAX = 48;
/** The most `times` a schedule lists. */
export const TIMES_MAX = 8;
/** The shortest `every` step, in minutes. */
export const EVERY_MIN = 15;
/** The longest `every` step, in minutes. */
export const EVERY_MAX = 240;

/** The weekdays in the week's order, Monday first - the order a when line lists them in. */
const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** Each weekday's short name, as a when line lists several. */
const SHORT: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
/** Each weekday's plural long name, as a when line names one alone. */
const PLURAL: Record<Weekday, string> = {
  mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays", fri: "Fridays", sat: "Saturdays", sun: "Sundays",
};
/** A wall-clock minute, `00:00` to `23:59`. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** How many days past today {@link nextRun} looks. */
const LOOKAHEAD_DAYS = 10;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === "string" && HHMM.test(v);
/** `"08:30"` as minutes past midnight, 510. */
const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** 510 minutes past midnight as `"08:30"`. */
const hhmmOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** `["a", "b", "c"]` as `"a, b and c"`; two as `"a and b"`, one as itself. */
function joinAnd(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The sentence a time that is not `HH:MM` is refused with. */
const notTime = (v: unknown): string => `${typeof v === "string" ? v : JSON.stringify(v)} is not a time as HH:MM.`;

/**
 * A schedule as written - by the operator's confirmed proposal or by hand -, checked; refused in one sentence naming
 * the first fault. A schedule that parses is a fresh copy, sharing nothing with `raw`.
 * @param raw - the schedule as read from JSON.
 */
export function parseSchedule(raw: unknown): { ok: true; schedule: RoutineSchedule } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isRecord(raw)) return fail("A schedule is an object with days and either times or every.");
  for (const key of Object.keys(raw)) {
    if (key !== "days" && key !== "times" && key !== "every") return fail(`A schedule has no key ${key}.`);
  }

  let days: RoutineSchedule["days"];
  if (raw.days === "trading" || raw.days === "daily") days = raw.days;
  else if (Array.isArray(raw.days) && raw.days.every((d) => (WEEKDAYS as readonly unknown[]).includes(d))) {
    if (raw.days.length === 0) return fail("days lists at least one weekday.");
    const seen = new Set<Weekday>();
    for (const d of raw.days as Weekday[]) {
      if (seen.has(d)) return fail(`${d} is listed twice in days.`);
      seen.add(d);
    }
    days = [...(raw.days as Weekday[])];
  } else return fail("days is trading, daily or a list of weekdays (mon to sun).");

  const hasTimes = raw.times !== undefined;
  const hasEvery = raw.every !== undefined;
  if (hasTimes && hasEvery) return fail("A schedule has times or every, not both.");
  if (!hasTimes && !hasEvery) return fail("A schedule needs times or every.");

  if (hasTimes) {
    if (!Array.isArray(raw.times) || raw.times.length === 0 || raw.times.length > TIMES_MAX) {
      return fail(`times lists 1 to ${TIMES_MAX} times.`);
    }
    const seen = new Set<string>();
    for (const t of raw.times) {
      if (!isTime(t)) return fail(notTime(t));
      if (seen.has(t)) return fail(`${t} is listed twice.`);
      seen.add(t);
    }
    return { ok: true, schedule: { days, times: [...(raw.times as string[])] } };
  }

  const every = raw.every;
  if (!isRecord(every)) return fail("every is an object with minutes, from and to.");
  for (const key of Object.keys(every)) {
    if (key !== "minutes" && key !== "from" && key !== "to") return fail(`every has no key ${key}.`);
  }
  const { minutes, from, to } = every;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < EVERY_MIN || minutes > EVERY_MAX || minutes % 5 !== 0) {
    return fail(`every.minutes is ${EVERY_MIN} to ${EVERY_MAX}, in steps of 5.`);
  }
  if (!isTime(from)) return fail(notTime(from));
  if (!isTime(to)) return fail(notTime(to));
  if (minutesOf(from) >= minutesOf(to)) return fail("every.from comes before every.to.");
  const schedule: RoutineSchedule = { days, every: { minutes, from, to } };
  if (runsPerDay(schedule) > SLOTS_MAX) return fail(`A schedule runs at most ${SLOTS_MAX} times a day.`);
  return { ok: true, schedule };
}

/**
 * A schedule's wall-clock minutes in a day, `"HH:MM"`, ascending: its `times`, or `every`'s `from`, `from + minutes`,
 * … up to and including `to` when it lands on a step.
 * @param schedule - a parsed schedule.
 */
export function slotTimes(schedule: RoutineSchedule): string[] {
  if ("times" in schedule) return [...schedule.times].sort();
  const { minutes, from, to } = schedule.every;
  const out: string[] = [];
  for (let m = minutesOf(from); m <= minutesOf(to); m += minutes) out.push(hhmmOf(m));
  return out;
}

/**
 * How many slots a schedule has on a day it runs.
 * @param schedule - a parsed schedule.
 */
export function runsPerDay(schedule: RoutineSchedule): number {
  return slotTimes(schedule).length;
}

/**
 * The instant New York's wall clock reads `hhmm` on `date`, in ms since the epoch: of the two candidates, at UTC−4
 * and UTC−5, the earliest that reads back exactly - so a time the November change repeats is its first occurrence -,
 * or undefined when neither does, a time the March change skips.
 * @param date - New York's date, `"2026-11-13"`.
 * @param hhmm - the wall-clock time, `"08:30"`.
 */
export function nyInstant(date: string, hhmm: string): number | undefined {
  const wall = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  if (Number.isNaN(wall)) return undefined;
  for (const hours of [4, 5]) {
    const at = wall + hours * 3_600_000;
    const d = new Date(at);
    if (etDate(d) === date && etTime(d) === `${hhmm} ET`) return at;
  }
  return undefined;
}

/** The weekday the calendar date `date` has. */
function weekdayOf(date: string): Weekday {
  const day = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).getUTCDay();
  return WEEKDAYS[(day + 6) % 7]!;
}

/** The calendar date `n` days after `date`. */
function addDays(date: string, n: number): string {
  const ms = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + n);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Whether a schedule runs on `date`: a trading-days schedule on a trading day, a daily one always, a weekday list on
 * the weekdays it names.
 * @param schedule - a parsed schedule.
 * @param date - New York's date, `"2026-11-15"`.
 * @param trading - whether `date` is a trading day.
 */
export function admits(schedule: RoutineSchedule, date: string, trading: boolean): boolean {
  if (schedule.days === "trading") return trading;
  if (schedule.days === "daily") return true;
  return schedule.days.includes(weekdayOf(date));
}

/**
 * A schedule's slots on `date` with their instants, ascending; none on a date it does not admit, and none at a
 * wall-clock time the day skips.
 * @param schedule - a parsed schedule.
 * @param date - New York's date.
 * @param trading - whether `date` is a trading day.
 */
export function slotsOn(schedule: RoutineSchedule, date: string, trading: boolean): { slot: string; at: number }[] {
  if (!admits(schedule, date, trading)) return [];
  const out: { slot: string; at: number }[] = [];
  for (const slot of slotTimes(schedule)) {
    const at = nyInstant(date, slot);
    if (at !== undefined) out.push({ slot, at });
  }
  return out;
}

/**
 * A schedule as one line for the operator: `"Trading days, every 30 min, 08:30–16:00 ET · 16 runs a day"`,
 * `"Sundays at 18:00 ET"`, `"Mon, Wed and Fri at 12:00 ET"`; a schedule that runs once a day shows no count.
 * @param schedule - a parsed schedule.
 */
export function whenText(schedule: RoutineSchedule): string {
  const { days } = schedule;
  const head = days === "trading" ? "Trading days"
    : days === "daily" ? "Every day"
    : days.length === 1 ? PLURAL[days[0]!]
    : joinAnd(WEEKDAYS.filter((d) => days.includes(d)).map((d) => SHORT[d]));
  const body = "times" in schedule
    ? `${head} at ${joinAnd(slotTimes(schedule))} ET`
    : `${head}, every ${schedule.every.minutes} min, ${schedule.every.from}–${schedule.every.to} ET`;
  const runs = runsPerDay(schedule);
  return runs > 1 ? `${body} · ${runs} runs a day` : body;
}

/**
 * A schedule's next slot after `now`, looking at today and the {@link LOOKAHEAD_DAYS} days after it in New York, or
 * undefined if none falls in them. A date the calendar cannot answer for is not a trading day.
 * @param schedule - a parsed schedule.
 * @param now - the instant, in ms since the epoch.
 * @param isTrading - whether a New York date is a trading day; undefined when the calendar cannot say.
 */
export function nextRun(
  schedule: RoutineSchedule, now: number, isTrading: (date: string) => boolean | undefined,
): { date: string; slot: string; at: number } | undefined {
  const today = etDate(new Date(now));
  for (let i = 0; i <= LOOKAHEAD_DAYS; i++) {
    const date = addDays(today, i);
    const trading = schedule.days === "trading" ? isTrading(date) === true : false;
    const next = slotsOn(schedule, date, trading).find(({ at }) => at > now);
    if (next !== undefined) return { date, ...next };
  }
  return undefined;
}
