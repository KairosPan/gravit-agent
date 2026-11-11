/** THE MARKET'S US CALENDAR (src/calendar.ts), in the years its callers reach. A first view of a stock's daily bars is held to its market
 * days (live/history-stocks.ts) and so is every row of Cboe's daily file (live/public-stocks.ts) — Nasdaq's days go back to 1990, Cboe's to
 * 2004 — so a holiday said of a year before the exchanges kept it takes a real session out of a chart. Every market day and market holiday
 * below that is past was checked against the days the sources themselves carry a bar on (Nasdaq's IBM from 1990, Cboe's SPY from 2004, read
 * 2026-11-11); Friday 18 June 2027 is NYSE's published calendar (nyse.com/trade/hours-calendars, read the same day); a bank day is the
 * Federal Reserve's rule, which no price source shows. */
import { describe, expect, it } from "vitest";
import { isBankDay, isMarketDay } from "../../src/calendar.ts";

/** the middle of the New York day of a date, summer or winter */
const midday = (date: string): number => Date.parse(`${date}T16:30:00Z`);
const market = (dates: string[]): Array<[string, boolean]> => dates.map((d) => [d, isMarketDay(midday(d))]);
const bank = (dates: string[]): Array<[string, boolean]> => dates.map((d) => [d, isBankDay(midday(d))]);

describe("the calendar against the sessions the exchanges held", () => {
  /** the sessions of each year, counted from Nasdaq's daily bars of IBM (read 2026-11-11, its first bar Tuesday 2 January 1990). Cboe's SPY
   * counts the same from 2004, its two rows on closed days left out (Thanksgiving 2018, Memorial Day 2025) */
  const HELD: ReadonlyArray<[number, number]> = [
    [1990, 253], [1991, 253], [1992, 254], [1993, 253], [1994, 252], [1995, 252], [1996, 254], [1997, 253], [1998, 252], [1999, 252],
    [2000, 252], [2001, 248], [2002, 252], [2003, 252], [2004, 252], [2005, 252], [2006, 251], [2007, 251], [2008, 253], [2009, 252],
    [2010, 252], [2011, 252], [2012, 250], [2013, 252], [2014, 252], [2015, 252], [2016, 252], [2017, 251], [2018, 251], [2019, 252],
    [2020, 253], [2021, 252], [2022, 251], [2023, 250], [2024, 252], [2025, 250],
  ];
  /** the exchanges' one-off closures since 1990 — a funeral, an attack, a storm. No rule gives them and the calendar does not list them:
   * it counts each as a market day (the top of src/calendar.ts says why that keeps no bar wrongly) */
  const ONE_OFF = ["1994-04-27", "2001-09-11", "2001-09-12", "2001-09-13", "2001-09-14", "2004-06-11", "2007-01-02", "2012-10-29", "2012-10-30", "2018-12-05", "2025-01-09"];

  it("from 1990 to 2025 a year's market days number the sessions held that year and its one-off closures, no more and no fewer", () => {
    const counted = HELD.map(([y]) => {
      let n = 0;
      // 17:00 UTC is midday in New York, summer or winter
      for (let t = Date.UTC(y, 0, 1, 17); t < Date.UTC(y + 1, 0, 1); t += 86_400_000) if (isMarketDay(t)) n++;
      return [y, n];
    });
    expect(counted).toEqual(HELD.map(([y, held]) => [y, held + ONE_OFF.filter((d) => d.startsWith(`${y}-`)).length]));
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
