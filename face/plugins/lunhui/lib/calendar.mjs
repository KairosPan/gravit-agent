// face/plugins/lunhui/lib/calendar.mjs
/**
 * The Lunhui trading calendar as one JSON table per year (spec A25): `lib/calendar/<year>.json`,
 * each `{ year, source, holidays: [{ start, end, name, source }] }` with the SSE notice URLs the
 * ranges come from. A year is covered only when its table is present; a date outside every table
 * is `"uncovered"` and never a trading day, so a caller fails closed instead of guessing weekdays
 * for a year nobody verified. Read-only quote freshness metadata, not an order-admission calendar.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ start: string, end: string, name: string, source: string }} Holiday
 * @typedef {{ year: string, source: string, holidays: Holiday[] }} CalendarTable
 */

const DEFAULT_DIR = fileURLToPath(new URL("./calendar/", import.meta.url));
const DATE = /^(\d{4})-\d{2}-\d{2}$/;

/** A real `YYYY-MM-DD` calendar date (no 02-30); its year, or null. */
function dateYear(date) {
  if (typeof date !== "string") return null;
  const match = DATE.exec(date);
  if (!match) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) return null;
  return match[1];
}

const isText = (value) => typeof value === "string" && value.length > 0;

function validate(table, file, expectedYear) {
  const fail = (why) => {
    throw new Error(`calendar table ${file}: ${why}`);
  };
  if (!table || typeof table !== "object" || Array.isArray(table)) fail("not an object");
  if (typeof table.year !== "string" || !/^\d{4}$/.test(table.year)) fail("year is not four digits");
  if (table.year !== expectedYear) fail(`year ${table.year} differs from the file name`);
  if (!isText(table.source)) fail("source is missing");
  if (!Array.isArray(table.holidays)) fail("holidays is not a list");
  const holidays = table.holidays.map((holiday, index) => {
    const at = `holiday ${index}`;
    if (!holiday || typeof holiday !== "object") fail(`${at} is not an object`);
    const { start, end, name, source } = holiday;
    if (dateYear(start) !== table.year) fail(`${at} start is not a date of ${table.year}`);
    if (dateYear(end) !== table.year) fail(`${at} end is not a date of ${table.year}`);
    if (end < start) fail(`${at} ends before it starts`);
    if (!isText(name)) fail(`${at} name is missing`);
    if (!isText(source)) fail(`${at} source is missing`);
    return Object.freeze({ start, end, name, source });
  });
  return Object.freeze({ year: table.year, source: table.source, holidays: Object.freeze(holidays) });
}

/**
 * Read every `<year>.json` in `dir`, validated; a malformed table throws an Error naming its file.
 * @param {string} [dir]
 * @returns {Map<string, CalendarTable>} keyed by year, ascending
 */
export function loadCalendars(dir = DEFAULT_DIR) {
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const tables = new Map();
  for (const file of files) {
    const year = file.slice(0, -".json".length);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      throw new Error(`calendar table ${file}: not readable JSON (${error.message})`);
    }
    tables.set(year, validate(parsed, file, year));
  }
  return tables;
}

/**
 * @param {string} date `YYYY-MM-DD`
 * @param {Map<string, CalendarTable>} tables
 * @returns {"covered" | "uncovered"}
 */
export function coverageOf(date, tables) {
  const year = dateYear(date);
  return year !== null && tables.has(year) ? "covered" : "uncovered";
}

/**
 * @param {string} date `YYYY-MM-DD`
 * @param {Map<string, CalendarTable>} tables
 * @returns {Holiday | undefined}
 */
export function holidayOn(date, tables) {
  const year = dateYear(date);
  const table = year === null ? undefined : tables.get(year);
  return table?.holidays.find((holiday) => date >= holiday.start && date <= holiday.end);
}

/** @param {string} date a valid `YYYY-MM-DD` */
export const isWeekend = (date) =>
  [0, 6].includes(new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay());

/**
 * True only for a covered date that is neither a weekend nor inside a holiday; an uncovered date
 * is never a trading day.
 * @param {string} date `YYYY-MM-DD`
 * @param {Map<string, CalendarTable>} tables
 */
export function isTradingDay(date, tables) {
  return coverageOf(date, tables) === "covered" && !isWeekend(date) && !holidayOn(date, tables);
}
