/**
 * The Lunhui calendar tables, `plugins/lunhui/lib/calendar.mjs` (spec A25): one JSON table per
 * year under `lib/calendar/`, a date outside every table reported as uncovered so the freezes fail
 * closed, never a guessed weekday for an uncovered year.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coverageOf, holidayOn, isTradingDay, loadCalendars,
} from "../plugins/lunhui/lib/calendar.mjs";

const TABLE_2026 = fileURLToPath(new URL("../plugins/lunhui/lib/calendar/2026.json", import.meta.url));
const ANNUAL = "https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml";
const AUTUMN = "https://www.sse.com.cn/disclosure/announcement/general/c/c_20260915_10832273.shtml";

test("calendar: the 2026 table loads, a 2026 holiday is closed, a 2027 date is uncovered", async () => {
  const tables = loadCalendars();
  assert.deepEqual([...tables.keys()], ["2026"]);
  assert.equal(coverageOf("2026-10-01", tables), "covered");
  assert.equal(isTradingDay("2026-10-01", tables), false); // National Day
  assert.equal(isTradingDay("2026-10-12", tables), true);
  assert.equal(coverageOf("2027-01-04", tables), "uncovered");
});

test("calendar: the 2026 table keeps stage 0's seven ranges and their two notices", () => {
  const table = loadCalendars().get("2026");
  assert.ok(table);
  assert.equal(table.year, "2026");
  assert.equal(table.source, ANNUAL);
  assert.deepEqual(
    table.holidays.map((h: { start: string; end: string; name: string }) => [h.start, h.end, h.name]),
    [
      ["2026-01-01", "2026-01-03", "元旦"],
      ["2026-02-15", "2026-02-23", "春节"],
      ["2026-04-04", "2026-04-06", "清明节"],
      ["2026-05-01", "2026-05-05", "劳动节"],
      ["2026-06-19", "2026-06-21", "端午节"],
      ["2026-09-25", "2026-09-27", "中秋节"],
      ["2026-10-01", "2026-10-07", "国庆节"],
    ],
  );
  assert.deepEqual(
    table.holidays.map((h: { source: string }) => h.source),
    [ANNUAL, ANNUAL, ANNUAL, ANNUAL, ANNUAL, AUTUMN, AUTUMN],
  );
});

test("calendar: holidayOn names the range, weekends and uncovered dates are not trading days", () => {
  const tables = loadCalendars();
  assert.equal(holidayOn("2026-10-03", tables)?.name, "国庆节");
  assert.equal(holidayOn("2026-10-03", tables)?.source, AUTUMN);
  assert.equal(holidayOn("2026-10-08", tables), undefined);
  assert.equal(holidayOn("2027-01-01", tables), undefined);
  assert.equal(isTradingDay("2026-10-10", tables), false); // a Saturday
  assert.equal(isTradingDay("2027-01-04", tables), false); // a Monday, but no 2027 table
  assert.equal(coverageOf("not-a-date", tables), "uncovered");
  assert.equal(coverageOf("2026-02-30", tables), "uncovered");
});

test("calendar: a second table in the directory covers its year", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lunhui-cal-"));
  await copyFile(TABLE_2026, join(dir, "2026.json"));
  await writeFile(join(dir, "2099.json"), JSON.stringify({ year: "2099", source: "synthetic", holidays: [{ start: "2099-01-01", end: "2099-01-01", name: "元旦", source: "synthetic" }] }));
  const tables = loadCalendars(dir);
  assert.deepEqual([...tables.keys()], ["2026", "2099"]);
  assert.equal(coverageOf("2099-06-01", tables), "covered");
  assert.equal(isTradingDay("2099-01-01", tables), false);
  assert.equal(isTradingDay("2099-01-02", tables), true); // a Friday
});

test("calendar: a malformed table is refused with its file named", async () => {
  const holiday = (start: string, end: string) => ({ start, end, name: "x", source: "synthetic" });
  const cases: Array<[string, unknown]> = [
    ["2099.json", { year: "99", source: "s", holidays: [] }],
    ["2099.json", { year: "2098", source: "s", holidays: [] }],
    ["2099.json", { year: "2099", source: "s", holidays: [holiday("2098-12-31", "2099-01-01")] }],
    ["2099.json", { year: "2099", source: "s", holidays: [holiday("2099-01-01", "2100-01-01")] }],
    ["2099.json", { year: "2099", source: "s", holidays: [holiday("2099-02-30", "2099-03-01")] }],
    ["2099.json", { year: "2099", source: "s", holidays: [holiday("2099-03-02", "2099-03-01")] }],
    ["2099.json", { year: "2099", source: "s", holidays: [{ start: "2099-01-01", end: "2099-01-01", name: "x" }] }],
    ["2099.json", { year: "2099", holidays: [] }],
    ["2099.json", { year: "2099", source: "s" }],
    ["2099.json", "{not json"],
  ];
  for (const [name, body] of cases) {
    const dir = await mkdtemp(join(tmpdir(), "lunhui-cal-bad-"));
    await writeFile(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
    assert.throws(() => loadCalendars(dir), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /2099\.json/);
      return true;
    }, JSON.stringify(body));
  }
});
