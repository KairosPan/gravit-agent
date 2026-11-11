/** THE MARKET'S US CALENDAR (src/calendar.ts), in the years its callers reach. A first view of a stock's daily bars is held to its market
 * days (live/history-stocks.ts) and so is every row of Cboe's daily file (live/public-stocks.ts) — Nasdaq's days go back to 1990, Cboe's to
 * 2004 — so a holiday said of a year before the exchanges kept it takes a real session out of a chart. Every market day and market holiday
 * below that is past was checked against the days the sources themselves carry a bar on (Nasdaq's IBM from 1990, Cboe's SPY from 2004, read
 * 2026-11-11), and test/fixtures/us-closed-weekdays.json holds every closed weekday of 1990 to 2025 from the same read; Friday 18 June
 * 2027 is NYSE's published calendar (nyse.com/trade/hours-calendars, read the same day); a bank day is the Federal Reserve's rule, which
 * no price source shows. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBankDay, isMarketDay } from "../../src/calendar.ts";

/** the middle of the New York day of a date, summer or winter */
const midday = (date: string): number => Date.parse(`${date}T16:30:00Z`);
const market = (dates: string[]): Array<[string, boolean]> => dates.map((d) => [d, isMarketDay(midday(d))]);
const bank = (dates: string[]): Array<[string, boolean]> => dates.map((d) => [d, isBankDay(midday(d))]);

describe("the calendar against the sessions the exchanges held", () => {
  /** every Monday-to-Friday date from 1990 to 2025 with no session, by year, as MM-DD: the weekdays Nasdaq's daily history of IBM has no bar
   * for, the one-off closures among them (the fixture says where it was read) */
  const CLOSED = (JSON.parse(readFileSync(new URL("../fixtures/us-closed-weekdays.json", import.meta.url), "utf8")) as { closed: Record<string, string[]> }).closed;
  /** the sessions of each year, counted from the same bars (Cboe's SPY counts the same from 2004, its rows on closed days left out) */
  const HELD: ReadonlyArray<[number, number]> = [
    [1990, 253], [1991, 253], [1992, 254], [1993, 253], [1994, 252], [1995, 252], [1996, 254], [1997, 253], [1998, 252], [1999, 252],
    [2000, 252], [2001, 248], [2002, 252], [2003, 252], [2004, 252], [2005, 252], [2006, 251], [2007, 251], [2008, 253], [2009, 252],
    [2010, 252], [2011, 252], [2012, 250], [2013, 252], [2014, 252], [2015, 252], [2016, 252], [2017, 251], [2018, 251], [2019, 252],
    [2020, 253], [2021, 252], [2022, 251], [2023, 250], [2024, 252], [2025, 250],
  ];
  /** the exchanges' one-off closures since 1990 — a funeral, an attack, a storm. No rule gives them and the calendar does not list them */
  const ONE_OFF = ["1994-04-27", "2001-09-11", "2001-09-12", "2001-09-13", "2001-09-14", "2004-06-11", "2007-01-02", "2012-10-29", "2012-10-30", "2018-12-05", "2025-01-09"];
  /** a year as the calendar says it: its Monday-to-Friday dates called closed, those called market days, and any weekend date called one */
  const yearOf = (y: number): { closed: string[]; open: string[]; weekendOpen: string[] } => {
    const out = { closed: [] as string[], open: [] as string[], weekendOpen: [] as string[] };
    // 17:00 UTC is the middle of the day in New York, summer or winter: the UTC date is New York's
    for (let t = Date.UTC(y, 0, 1, 17); t < Date.UTC(y + 1, 0, 1); t += 86_400_000) {
      const day = new Date(t);
      const date = day.toISOString().slice(0, 10);
      if (day.getUTCDay() === 0 || day.getUTCDay() === 6) {
        if (isMarketDay(t)) out.weekendOpen.push(date);
      } else (isMarketDay(t) ? out.open : out.closed).push(date);
    }
    return out;
  };

  it("from 1990 to 2025 it closes the weekdays the exchanges held no session on, date for date — their one-off closures aside — and trades no weekend", () => {
    expect(Object.keys(CLOSED)).toEqual(HELD.map(([y]) => String(y)));
    for (const [y] of HELD) {
      const said = yearOf(y);
      const real = CLOSED[String(y)]!.map((d) => `${y}-${d}`);
      expect([y, said.closed]).toEqual([y, real.filter((d) => !ONE_OFF.includes(d))]);
      expect([y, said.weekendOpen]).toEqual([y, []]);
    }
  });

  it("so a year's market days, its one-off closures aside, number the sessions held that year", () => {
    expect(HELD.map(([y]) => [y, yearOf(y).open.filter((d) => !ONE_OFF.includes(d)).length])).toEqual(HELD.map(([y, held]) => [y, held]));
  });

  it("A KNOWN LIMIT, not a rule: each one-off closure was a closed day in fact, and is still called a market day here", () => {
    // closed in fact: the sessions' own record has no bar on it
    expect(ONE_OFF.map((d) => [d, CLOSED[d.slice(0, 4)]!.includes(d.slice(5))])).toEqual(ONE_OFF.map((d) => [d, true]));
    // and not known to the calendar (the top of src/calendar.ts says what follows from that). Teach it these days, and this is the
    // assertion to turn round, with the two "aside"s above
    expect(market(ONE_OFF)).toEqual(ONE_OFF.map((d) => [d, true]));
  });
});

describe("Juneteenth: a holiday from 2022, an ordinary session before", () => {
  it("through 2021 the market traded on 19 June, on the Friday before a Saturday 19th and on the Monday after a Sunday 19th", () => {
    // 2021 and 2010: the 19th a Saturday; 2016: a Sunday; 2020 and 1990: a weekday. NYSE and Nasdaq first closed for it on Monday 20 June 2022
    expect(market(["2021-06-18", "2016-06-20", "2010-06-18", "2020-06-19", "1990-06-19"])).toEqual([
      ["2021-06-18", true],
      ["2016-06-20", true],
      ["2010-06-18", true],
      ["2020-06-19", true],
      ["1990-06-19", true],
    ]);
  });

  it("from 2022 the market is closed for it: the Monday after a Sunday 19th, the 19th itself, the Friday before a Saturday 19th — and open on the days beside", () => {
    expect(market(["2022-06-20", "2023-06-19", "2026-06-19", "2027-06-18"])).toEqual([
      ["2022-06-20", false],
      ["2023-06-19", false],
      ["2026-06-19", false],
      ["2027-06-18", false],
    ]);
    expect(market(["2022-06-17", "2022-06-21", "2023-06-20"])).toEqual([
      ["2022-06-17", true],
      ["2022-06-21", true],
      ["2023-06-20", true],
    ]);
  });

  it("the banks kept it first on Monday 20 June 2022 too: every 19 June before was a bank day, and a Saturday 19th closes no Friday", () => {
    // the law is of Thursday 17 June 2021, the 19th a Saturday that year: the Federal Reserve's services ran as usual on Friday 18 June 2021
    expect(bank(["2020-06-19", "2021-06-18", "2022-06-20", "2023-06-19", "2027-06-18"])).toEqual([
      ["2020-06-19", true],
      ["2021-06-18", true],
      ["2022-06-20", false],
      ["2023-06-19", false],
      ["2027-06-18", true],
    ]);
  });
});

describe("Martin Luther King Jr. Day: the market's holiday from 1998", () => {
  it("through 1997 the market traded on the third Monday of January", () => {
    // Nasdaq's daily bars go back to 1990, and each of these Mondays has one
    expect(market(["1990-01-15", "1993-01-18", "1997-01-20"])).toEqual([
      ["1990-01-15", true],
      ["1993-01-18", true],
      ["1997-01-20", true],
    ]);
  });

  it("from 1998 the market is closed on it", () => {
    expect(market(["1998-01-19", "2007-01-15", "2026-01-19"])).toEqual([
      ["1998-01-19", false],
      ["2007-01-15", false],
      ["2026-01-19", false],
    ]);
  });

  it("the banks kept it before the market did: in 1997 it is a bank holiday and a session", () => {
    expect([isBankDay(midday("1997-01-20")), isMarketDay(midday("1997-01-20"))]).toEqual([false, true]);
    expect(bank(["1998-01-19", "2026-01-19"])).toEqual([
      ["1998-01-19", false],
      ["2026-01-19", false],
    ]);
  });
});
