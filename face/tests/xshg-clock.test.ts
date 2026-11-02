// face/tests/xshg-clock.test.ts
/** The XSHG clock (src/xshg-clock.ts): the Shanghai exchange's 2026 closures in Node, pinned against the Lunhui
 * plugin's 2026 calendar (face/plugins/lunhui/lib/calendar/2026.json, read here as a fixture - the face imports
 * nothing from face/plugins/ at runtime); a weekday's session, 09:30-15:00 Beijing; a holiday and a weekend closed;
 * a date past the table uncovered; a window cut at the table's end and refused past it. Offline and pure. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_WINDOW_DAYS } from "../src/market-clock.ts";
import { XSHG_CLOCK, XSHG_CLOSURES, XSHG_COVERED, xshgMarketClock, xshgSession, xshgWindow } from "../src/xshg-clock.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isWeekday = (date: string): boolean => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

test("the closure table is the Lunhui 2026 table's ranges, weekdays only", () => {
  const table = JSON.parse(readFileSync(join(REPO, "face/plugins/lunhui/lib/calendar/2026.json"), "utf8")) as {
    holidays: { start: string; end: string; name: string }[];
  };
  assert.equal(table.holidays.length, 7);
  const expected: Record<string, string> = {};
  for (const { start, end, name } of table.holidays) {
    for (let date = start; date <= end; date = addDays(date, 1)) if (isWeekday(date)) expected[date] = name;
  }
  assert.deepEqual({ ...XSHG_CLOSURES }, expected);
  assert.equal(Object.keys(XSHG_CLOSURES).length, 19);
  for (const date of Object.keys(XSHG_CLOSURES)) assert.ok(isWeekday(date), `${date} is a weekday`);
  assert.deepEqual(XSHG_COVERED, { from: "2026-01-01", through: "2026-12-31" });
  assert.equal(XSHG_CLOCK, "builtin XSHG table (face/src/xshg-clock.ts)");
});

test("a weekday session opens 09:30 and closes 15:00 Beijing; a holiday and a weekend are closed; 2027 is uncovered", () => {
  assert.deepEqual(xshgSession("2026-11-02"), { date: "2026-11-02", open: "2026-11-02T01:30:00Z", close: "2026-11-02T07:00:00Z", early: false });
  assert.equal(xshgSession("2026-10-05"), "closed");
  assert.equal(xshgSession("2026-11-01"), "closed");
  assert.equal(xshgSession("2027-01-04"), "uncovered");
  assert.equal(xshgSession("2025-12-31"), "uncovered");
  /* the table's last day is covered; a Saturday makeup day (调休) is still closed: the exchange never trades a weekend */
  assert.deepEqual(xshgSession("2026-12-31"), { date: "2026-12-31", open: "2026-12-31T01:30:00Z", close: "2026-12-31T07:00:00Z", early: false });
  assert.equal(xshgSession("2026-09-20"), "closed");
  assert.throws(() => xshgSession("2026-02-30"), /the A-share calendar takes a YYYY-MM-DD date, not "2026-02-30"/);
});

test("a window is cut at the table's end and refused past it", async () => {
  const cut = xshgWindow("2026-12-28", 10);
  assert.equal(cut.days, 4);
  assert.deepEqual(cut.sessions.map((s) => s.date), ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31"]);
  assert.equal(cut.source, XSHG_CLOCK);
  assert.throws(() => xshgWindow("2027-01-01", 10), /covers 2026-01-01 to 2026-12-31; 2027-01-01 is past it/);
  assert.throws(() => xshgWindow("2025-12-31", 10), /covers 2026-01-01 to 2026-12-31; 2025-12-31 is before it/);
  assert.throws(() => xshgWindow("2026-12-01", MAX_WINDOW_DAYS + 1), /takes 1 to 31 days, not 32/);
  assert.throws(() => xshgWindow("2026-13-01", 1), /takes a YYYY-MM-DD date/);

  /* the National Day week: the five weekdays closed, the weekend closed, the 8th open */
  const golden = xshgWindow("2026-10-01", 10);
  assert.deepEqual(golden.sessions.map((s) => s.date), ["2026-10-08", "2026-10-09"]);

  /* the clock is the window, as a MarketClock: a rejection past the table */
  const ask = xshgMarketClock();
  assert.deepEqual(await ask("2026-12-28", 10), cut);
  await assert.rejects(ask("2027-01-04", 10), /2027-01-04 is past it/);
});
