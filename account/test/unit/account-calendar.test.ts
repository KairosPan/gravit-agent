import { describe, expect, it } from "vitest";
import { achArrival, DAY, et, etDate, fromEt, isBankDay, isEarlyClose, isMarketDay, marketSession, navArrival, nextRegularSession, regularSession, sameDayAchArrival, settlementArrival, usClock, usDayEndAt, usPhaseAt, usPhaseEndsAt, usSessionFull, whenLabel } from "../../src/portfolio/account/calendar.ts";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

describe("New York time, from a UTC instant", () => {
  it("knows which New York day an instant belongs to", () => {
    // the demo's clock: Saturday 3 October 2026, 5:00am in New York
    expect(et(at("2026-10-03T09:00:00Z"))).toEqual({ y: 2026, m: 10, d: 3, dow: 6, minutes: 300 });
    // 03:30 UTC on Saturday is still Friday evening in New York
    expect(et(at("2026-10-10T03:30:00Z"))).toMatchObject({ d: 9, dow: 5, minutes: 23 * 60 + 30 });
    // winter time: New York is five hours behind
    expect(et(at("2026-12-01T14:00:00Z"))).toMatchObject({ m: 12, d: 1, minutes: 9 * 60 });
  });

  it("goes back from a New York wall time to the instant, across the clock change", () => {
    expect(iso(fromEt(2026, 10, 6, 9))).toBe("2026-10-06T13:00:00.000Z");
    expect(iso(fromEt(2026, 12, 1, 9))).toBe("2026-12-01T14:00:00.000Z");
    // 1 November 2026 is the day the clocks go back
    expect(iso(fromEt(2026, 11, 2, 9))).toBe("2026-11-02T14:00:00.000Z");
  });
});

describe("bank days and market days are not the same days", () => {
  it("Columbus Day and Veterans Day: the banks rest, the market trades", () => {
    for (const day of ["2026-10-12T15:00:00Z", "2026-11-11T15:00:00Z"]) {
      expect(isBankDay(at(day))).toBe(false);
      expect(isMarketDay(at(day))).toBe(true);
    }
  });

  it("Good Friday: the market rests, the banks settle", () => {
    expect(isMarketDay(at("2026-04-03T15:00:00Z"))).toBe(false);
    expect(isBankDay(at("2026-04-03T15:00:00Z"))).toBe(true);
  });

  it("a holiday on a Saturday closes the market on Friday and the banks not at all", () => {
    // 4 July 2026 is a Saturday
    expect(isMarketDay(at("2026-07-03T15:00:00Z"))).toBe(false);
    expect(isBankDay(at("2026-07-03T15:00:00Z"))).toBe(true);
  });

  it("the usual ones close both, and a weekend is never a day", () => {
    for (const day of ["2026-01-01T15:00:00Z", "2026-01-19T15:00:00Z", "2026-02-16T15:00:00Z", "2026-05-25T15:00:00Z", "2026-06-19T15:00:00Z", "2026-09-07T15:00:00Z", "2026-11-26T15:00:00Z", "2026-12-25T15:00:00Z"]) {
      expect([day, isBankDay(at(day)), isMarketDay(at(day))]).toEqual([day, false, false]);
    }
    expect(isBankDay(at("2026-10-03T15:00:00Z"))).toBe(false);
    expect(isBankDay(at("2026-10-04T15:00:00Z"))).toBe(false);
    expect(isBankDay(at("2026-10-05T15:00:00Z"))).toBe(true);
  });
});

describe("when an ACH lands", () => {
  it("sent on a Saturday, it goes out Monday and lands Tuesday", () => {
    const lands = achArrival(at("2026-10-03T09:00:00Z"));
    expect(iso(lands)).toBe("2026-10-06T13:00:00.000Z");
    expect(etDate(lands)).toBe("Tue 6 Oct");
  });

  it("sent on a Friday before a Monday bank holiday, it lands Tuesday", () => {
    // Friday 9 October, 5:00pm New York; Monday 12 October is Columbus Day
    expect(etDate(achArrival(at("2026-10-09T21:00:00Z")))).toBe("Tue 13 Oct");
  });

  it("the 8:30pm cut-off moves it a day", () => {
    // Monday 5 October: 8:29pm is still Monday's file, 8:31pm is Tuesday's
    expect(etDate(achArrival(at("2026-10-06T00:29:00Z")))).toBe("Tue 6 Oct");
    expect(etDate(achArrival(at("2026-10-06T00:31:00Z")))).toBe("Wed 7 Oct");
  });

  it("same-day ACH before 3:00pm lands that evening; after it, it is a standard one", () => {
    expect(iso(sameDayAchArrival(at("2026-10-05T18:00:00Z")))).toBe("2026-10-05T21:00:00.000Z");
    expect(etDate(sameDayAchArrival(at("2026-10-05T19:30:00Z")))).toBe("Tue 6 Oct");
    expect(etDate(sameDayAchArrival(at("2026-10-03T09:00:00Z")))).toBe("Tue 6 Oct");
  });
});

describe("the fund's price and the trade's settlement", () => {
  it("a redemption in before 4:00pm is paid the next business day; after it, the one after", () => {
    expect(etDate(navArrival(at("2026-10-05T19:59:00Z")))).toBe("Tue 6 Oct");
    expect(etDate(navArrival(at("2026-10-05T20:01:00Z")))).toBe("Wed 7 Oct");
    // on a Saturday it is taken on Monday and paid on Tuesday
    expect(etDate(navArrival(at("2026-10-03T09:00:00Z")))).toBe("Tue 6 Oct");
  });

  it("cash from a sale can leave the broker the next settlement day", () => {
    expect(etDate(settlementArrival(at("2026-10-05T15:00:00Z")))).toBe("Tue 6 Oct");
    expect(etDate(settlementArrival(at("2026-10-09T15:00:00Z")))).toBe("Tue 13 Oct");
    // a fill at 9pm on Monday is in the overnight session: a Tuesday trade, settled Wednesday
    expect(etDate(settlementArrival(at("2026-10-06T01:00:00Z")))).toBe("Wed 7 Oct");
    // Columbus Day: the market trades, the banks do not settle
    expect(etDate(settlementArrival(at("2026-10-12T15:00:00Z")))).toBe("Tue 13 Oct");
  });
});

describe("the stock market's sessions", () => {
  it("is closed from Friday 8pm to Sunday 8pm", () => {
    expect(marketSession(at("2026-10-03T09:00:00Z"))).toBe("closed");
    expect(marketSession(at("2026-10-10T00:30:00Z"))).toBe("closed");
    expect(marketSession(at("2026-10-04T23:00:00Z"))).toBe("closed");
  });

  it("runs overnight, pre-market, regular and after-hours on a market day", () => {
    expect(marketSession(at("2026-10-05T00:30:00Z"))).toBe("overnight");
    expect(marketSession(at("2026-10-05T07:00:00Z"))).toBe("overnight");
    expect(marketSession(at("2026-10-05T09:00:00Z"))).toBe("pre-market");
    expect(marketSession(at("2026-10-05T14:00:00Z"))).toBe("regular");
    expect(marketSession(at("2026-10-05T21:00:00Z"))).toBe("after-hours");
    expect(marketSession(at("2026-10-06T01:00:00Z"))).toBe("overnight");
  });

  it("trades on a bank holiday that is not its own", () => {
    expect(marketSession(at("2026-10-12T15:00:00Z"))).toBe("regular");
  });
});

describe("the regular session a market carries (Market.session), from this calendar", () => {
  it("in session on a weekday: open, and it closes at 16:00 New York that day", () => {
    // Tuesday 6 October 2026, 11:00 EDT
    expect(regularSession(at("2026-10-06T15:00:00Z"))).toEqual({ open: true, closesAt: "2026-10-06T20:00:00.000Z" });
    expect(nextRegularSession(at("2026-10-06T15:00:00Z"))).toEqual({ open: true, opensAt: at("2026-10-06T13:30:00Z"), closesAt: at("2026-10-06T20:00:00Z") });
  });

  it("before the open and after the close: closed, and when it next opens — the same morning, or the next market day's", () => {
    // 09:29:59 and 09:30 sharp; 15:59:59 and 16:00 sharp, EDT
    expect(regularSession(at("2026-10-06T13:29:59Z"))).toEqual({ open: false, opensAt: "2026-10-06T13:30:00.000Z" });
    expect(regularSession(at("2026-10-06T13:30:00Z"))).toEqual({ open: true, closesAt: "2026-10-06T20:00:00.000Z" });
    expect(regularSession(at("2026-10-06T19:59:59Z"))).toEqual({ open: true, closesAt: "2026-10-06T20:00:00.000Z" });
    expect(regularSession(at("2026-10-06T20:00:00Z"))).toEqual({ open: false, opensAt: "2026-10-07T13:30:00.000Z" });
    // pre-market and after-hours trade at some venues, but they are not the regular session
    expect(marketSession(at("2026-10-06T21:00:00Z"))).toBe("after-hours");
    expect(regularSession(at("2026-10-06T21:00:00Z"))).toEqual({ open: false, opensAt: "2026-10-07T13:30:00.000Z" });
    // the next session in full: its open, and its close
    expect(nextRegularSession(at("2026-10-06T21:00:00Z"))).toEqual({ open: false, opensAt: at("2026-10-07T13:30:00Z"), closesAt: at("2026-10-07T20:00:00Z") });
  });

  it("over a weekend: Monday's open — Columbus Day too, which the market trades", () => {
    // Saturday 10 October, noon EDT; Friday 9 October at the close
    expect(regularSession(at("2026-10-10T16:00:00Z"))).toEqual({ open: false, opensAt: "2026-10-12T13:30:00.000Z" });
    expect(regularSession(at("2026-10-09T20:00:00Z"))).toEqual({ open: false, opensAt: "2026-10-12T13:30:00.000Z" });
  });

  it("on the market's holidays: closed, and the next market day's open", () => {
    // Thanksgiving, Thursday 26 November 2026, 11:00 EST: Friday's open (Friday closes early, at 13:00: see the early closes below)
    expect(regularSession(at("2026-11-26T16:00:00Z"))).toEqual({ open: false, opensAt: "2026-11-27T14:30:00.000Z" });
    expect(regularSession(at("2026-11-25T21:30:00Z"))).toEqual({ open: false, opensAt: "2026-11-27T14:30:00.000Z" });
    // Independence Day on a Saturday closes the market on Friday 3 July: after Thursday's close, Monday 6 July
    expect(regularSession(at("2026-07-02T20:30:00Z"))).toEqual({ open: false, opensAt: "2026-07-06T13:30:00.000Z" });
    // Christmas on a Friday: Thursday's close (13:00, Christmas Eve) to Monday's open
    expect(regularSession(at("2026-12-24T21:00:00Z"))).toEqual({ open: false, opensAt: "2026-12-28T14:30:00.000Z" });
  });

  it("across the November clock change: Friday's close in EDT, Monday's open in EST", () => {
    // Friday 30 October 2026, 16:30 EDT; the clocks go back on Sunday 1 November; 09:30 EST is 14:30 UTC
    expect(regularSession(at("2026-10-30T20:30:00Z"))).toEqual({ open: false, opensAt: "2026-11-02T14:30:00.000Z" });
    expect(regularSession(at("2026-11-02T14:29:00Z"))).toEqual({ open: false, opensAt: "2026-11-02T14:30:00.000Z" });
    expect(regularSession(at("2026-11-02T15:00:00Z"))).toEqual({ open: true, closesAt: "2026-11-02T21:00:00.000Z" });
  });

  it("agrees with marketSession at every quarter hour of a fortnight across the clock change", () => {
    for (let t = at("2026-10-24T00:00:00Z"); t < at("2026-11-07T00:00:00Z"); t += 15 * 60_000) {
      const s = regularSession(t);
      expect([iso(t), s.open]).toEqual([iso(t), marketSession(t) === "regular"]);
      expect(nextRegularSession(t).open).toBe(s.open);
      // what it says is always ahead: the close while open, the open while not
      expect(Date.parse((s.open ? s.closesAt : s.opensAt)!)).toBeGreaterThan(t);
    }
  });
});

describe("how the page says when", () => {
  it("now, minutes, hours, or a New York date", () => {
    const now = at("2026-10-03T09:00:00Z");
    expect(whenLabel(now, now)).toBe("now");
    expect(whenLabel(now, now + 120_000)).toBe("~2 min");
    expect(whenLabel(now, now + 3 * 3_600_000)).toBe("~3 h");
    expect(whenLabel(now, achArrival(now))).toBe("Tue 6 Oct");
  });
});

describe("the market's early closes (NYSE's calendar, https://www.nyse.com/markets/hours-calendars, read 2026-10-14)", () => {
  it("closes early on exactly the days NYSE lists for 2026 to 2028, and on none of the days beside them", () => {
    // NYSE's footnotes: the day after Thanksgiving in 2026, 2027 and 2028; Christmas Eve 2026; Monday 3 July 2028
    for (const [y, m, d] of [[2026, 11, 27], [2026, 12, 24], [2027, 11, 26], [2028, 7, 3], [2028, 11, 24]] as const) expect([y, m, d, isEarlyClose(fromEt(y, m, d, 12))]).toEqual([y, m, d, true]);
    // none on Thursday 2 July 2026 (the holiday is observed on Friday 3 July), on 23 or 24 December 2027 (Friday 24 December is the observed
    // Christmas), on Friday 2 July 2027 (3 July is a Saturday), on Thanksgiving itself, on New Year's Eve, or on Christmas Eve 2028 (a Sunday)
    for (const [y, m, d] of [[2026, 7, 2], [2026, 7, 3], [2026, 11, 26], [2026, 12, 23], [2026, 12, 31], [2027, 7, 2], [2027, 12, 23], [2027, 12, 24], [2028, 12, 22], [2028, 12, 24]] as const) expect([y, m, d, isEarlyClose(fromEt(y, m, d, 12))]).toEqual([y, m, d, false]);
    // and in the whole of 2026, only the two
    const found: string[] = [];
    for (let t = at("2026-01-01T17:00:00Z"); t < at("2027-01-01T00:00:00Z"); t += DAY) if (isEarlyClose(t)) found.push(etDate(t));
    expect(found).toEqual(["Fri 27 Nov", "Thu 24 Dec"]);
  });

  it("the day after Thanksgiving 2026 (EST): the regular session to 13:00, after-hours to 17:00, then closed", () => {
    expect(marketSession(at("2026-11-27T17:59:00Z"))).toBe("regular");
    expect(marketSession(at("2026-11-27T18:00:00Z"))).toBe("after-hours");
    expect(marketSession(at("2026-11-27T21:59:00Z"))).toBe("after-hours");
    expect(marketSession(at("2026-11-27T22:00:00Z"))).toBe("closed");
    // 18:00 New York, an hour that is after-hours on any other day
    expect(marketSession(at("2026-11-27T23:00:00Z"))).toBe("closed");
    expect(regularSession(at("2026-11-27T15:00:00Z"))).toEqual({ open: true, closesAt: "2026-11-27T18:00:00.000Z" });
    expect(regularSession(at("2026-11-27T18:00:00Z"))).toEqual({ open: false, opensAt: "2026-11-30T14:30:00.000Z" });
    // asked the evening before Thanksgiving: Friday's session, opening at 09:30 and closing at 13:00
    expect(nextRegularSession(at("2026-11-26T02:00:00Z"))).toEqual({ open: false, opensAt: at("2026-11-27T14:30:00Z"), closesAt: at("2026-11-27T18:00:00Z") });
  });

  it("Christmas Eve 2026, a Thursday before the holiday: 13:00, after-hours to 17:00, and no overnight session ahead of Christmas", () => {
    expect(regularSession(at("2026-12-24T17:00:00Z"))).toEqual({ open: true, closesAt: "2026-12-24T18:00:00.000Z" });
    expect(usPhaseAt(at("2026-12-24T18:00:00Z"))).toBe("after");
    expect(usPhaseAt(at("2026-12-24T22:00:00Z"))).toBe("closed");
    expect(usPhaseAt(at("2026-12-25T02:00:00Z"))).toBe("closed");
    // after-hours ends at 17:00; closed through Christmas and the weekend, to Sunday 27 December, 20:00 EST
    expect(iso(usPhaseEndsAt(at("2026-12-24T18:30:00Z")))).toBe("2026-12-24T22:00:00.000Z");
    expect(iso(usPhaseEndsAt(at("2026-12-24T22:00:00Z")))).toBe("2026-12-28T01:00:00.000Z");
  });
});

describe("the US market's clock (usClock): a phase at any instant, and when a DAY order ends", () => {
  it("names each phase as a market carries it (pre, regular, after, overnight, closed)", () => {
    // Wednesday 14 October 2026, EDT
    const day: Array<[string, string]> = [["2026-10-14T07:59:00Z", "overnight"], ["2026-10-14T08:00:00Z", "pre"], ["2026-10-14T13:29:00Z", "pre"], ["2026-10-14T13:30:00Z", "regular"], ["2026-10-14T19:59:00Z", "regular"], ["2026-10-14T20:00:00Z", "after"], ["2026-10-14T23:59:00Z", "after"], ["2026-10-15T00:00:00Z", "overnight"]];
    for (const [t, phase] of day) expect([t, usPhaseAt(at(t))]).toEqual([t, phase]);
    // Friday 20:00 to Sunday 20:00 is closed; Sunday 20:00 is Monday's overnight session
    expect(usPhaseAt(at("2026-10-17T00:00:00Z"))).toBe("closed");
    expect(usPhaseAt(at("2026-10-17T16:00:00Z"))).toBe("closed");
    expect(usPhaseAt(at("2026-10-18T23:59:00Z"))).toBe("closed");
    expect(usPhaseAt(at("2026-10-19T00:00:00Z"))).toBe("overnight");
    expect(usClock).toMatchObject({ city: "New York", zone: "America/New_York" });
    expect(usClock.phaseAt(at("2026-10-14T16:45:00Z"))).toBe("regular");
  });

  it("says when each phase ends: the next turn of the day at which another phase is on", () => {
    expect(iso(usPhaseEndsAt(at("2026-10-14T16:45:00Z")))).toBe("2026-10-14T20:00:00.000Z");
    expect(iso(usPhaseEndsAt(at("2026-10-14T21:00:00Z")))).toBe("2026-10-15T00:00:00.000Z");
    expect(iso(usPhaseEndsAt(at("2026-10-15T01:00:00Z")))).toBe("2026-10-15T08:00:00.000Z");
    expect(iso(usPhaseEndsAt(at("2026-10-15T09:00:00Z")))).toBe("2026-10-15T13:30:00.000Z");
    // a weekend: Sunday 20:00 New York
    expect(iso(usPhaseEndsAt(at("2026-10-17T16:00:00Z")))).toBe("2026-10-19T00:00:00.000Z");
    // Thanksgiving: closed from Wednesday 20:00 to Thursday 20:00 EST, Friday's overnight session
    expect(usPhaseAt(at("2026-11-26T17:00:00Z"))).toBe("closed");
    expect(iso(usPhaseEndsAt(at("2026-11-26T17:00:00Z")))).toBe("2026-11-27T01:00:00.000Z");
    expect(usPhaseAt(at("2026-11-27T01:00:00Z"))).toBe("overnight");
  });

  it("across the clock changes: Sunday 8 March and Sunday 1 November 2026", () => {
    // Friday 6 March, 20:00 EST: closed until Sunday 8 March, 20:00 EDT (the clocks went forward that morning), 00:00 UTC
    expect(usPhaseAt(at("2026-03-07T01:00:00Z"))).toBe("closed");
    expect(iso(usPhaseEndsAt(at("2026-03-07T01:00:00Z")))).toBe("2026-03-09T00:00:00.000Z");
    expect(usPhaseAt(at("2026-03-08T23:59:00Z"))).toBe("closed");
    expect(usPhaseAt(at("2026-03-09T00:00:00Z"))).toBe("overnight");
    expect(iso(usPhaseEndsAt(at("2026-03-09T00:00:00Z")))).toBe("2026-03-09T08:00:00.000Z");
    expect(iso(usDayEndAt(at("2026-03-07T01:00:00Z"), false))).toBe("2026-03-09T20:00:00.000Z");
    // Friday 30 October, 21:00 EDT: closed until Sunday 1 November, 20:00 EST (the clocks went back that morning), 01:00 UTC
    expect(iso(usPhaseEndsAt(at("2026-10-31T01:00:00Z")))).toBe("2026-11-02T01:00:00.000Z");
    expect(usPhaseAt(at("2026-11-02T00:59:00Z"))).toBe("closed");
    expect(usPhaseAt(at("2026-11-02T01:00:00Z"))).toBe("overnight");
    expect(iso(usPhaseEndsAt(at("2026-11-02T01:00:00Z")))).toBe("2026-11-02T09:00:00.000Z");
    expect(iso(usDayEndAt(at("2026-10-31T01:00:00Z"), false))).toBe("2026-11-02T21:00:00.000Z");
    expect(iso(usDayEndAt(at("2026-10-31T01:00:00Z"), true))).toBe("2026-11-03T01:00:00.000Z");
  });

  it("a DAY order ends at the close of the market day it is placed in or before; with extended hours, at that day's 20:00 (17:00 on an early close)", () => {
    const end = (t: string, extended: boolean) => iso(usDayEndAt(at(t), extended));
    // in the regular session (Wednesday 14 October, 12:45 EDT): that day's 16:00, or 20:00
    expect(end("2026-10-14T16:45:00Z", false)).toBe("2026-10-14T20:00:00.000Z");
    expect(end("2026-10-14T16:45:00Z", true)).toBe("2026-10-15T00:00:00.000Z");
    // in pre-market: that day's
    expect(end("2026-10-14T09:00:00Z", false)).toBe("2026-10-14T20:00:00.000Z");
    // after the close (17:00): the next market day's close, or this evening's 20:00
    expect(end("2026-10-14T21:00:00Z", false)).toBe("2026-10-15T20:00:00.000Z");
    expect(end("2026-10-14T21:00:00Z", true)).toBe("2026-10-15T00:00:00.000Z");
    // in the overnight session ahead of Thursday (21:00 Wednesday, 02:00 Thursday): Thursday's
    expect(end("2026-10-15T01:00:00Z", false)).toBe("2026-10-15T20:00:00.000Z");
    expect(end("2026-10-15T01:00:00Z", true)).toBe("2026-10-16T00:00:00.000Z");
    expect(end("2026-10-15T06:00:00Z", true)).toBe("2026-10-16T00:00:00.000Z");
    // at a weekend: Monday's
    expect(end("2026-10-17T16:00:00Z", false)).toBe("2026-10-19T20:00:00.000Z");
    // the day after Thanksgiving (EST): 13:00, or 17:00; after 13:00 a plain DAY order is Monday's, an extended one still Friday's to 17:00
    expect(end("2026-11-27T15:00:00Z", false)).toBe("2026-11-27T18:00:00.000Z");
    expect(end("2026-11-27T15:00:00Z", true)).toBe("2026-11-27T22:00:00.000Z");
    expect(end("2026-11-27T19:00:00Z", false)).toBe("2026-11-30T21:00:00.000Z");
    expect(end("2026-11-27T19:00:00Z", true)).toBe("2026-11-27T22:00:00.000Z");
    expect(end("2026-11-27T22:30:00Z", true)).toBe("2026-12-01T01:00:00.000Z");
    // the evening before Thanksgiving: Friday's early close
    expect(end("2026-11-26T02:00:00Z", false)).toBe("2026-11-27T18:00:00.000Z");
    expect(usClock.dayEndAt(at("2026-10-14T16:45:00Z"), false)).toBe(at("2026-10-14T20:00:00Z"));
  });

  it("the session in full (usSessionFull): the regular session, the phase and its end, and whether an extended-hours limit may be sent", () => {
    expect(usSessionFull(at("2026-10-14T16:45:00Z"), false)).toEqual({ open: true, closesAt: "2026-10-14T20:00:00.000Z", phase: "regular", phaseEndsAt: "2026-10-14T20:00:00.000Z", extendedHours: false });
    expect(usSessionFull(at("2026-10-14T09:00:00Z"), false)).toEqual({ open: false, opensAt: "2026-10-14T13:30:00.000Z", phase: "pre", phaseEndsAt: "2026-10-14T13:30:00.000Z", extendedHours: true });
    expect(usSessionFull(at("2026-10-14T21:00:00Z"), false)).toEqual({ open: false, opensAt: "2026-10-15T13:30:00.000Z", phase: "after", phaseEndsAt: "2026-10-15T00:00:00.000Z", extendedHours: true });
    // overnight: an extended-hours limit only where the market is traded overnight
    expect(usSessionFull(at("2026-10-15T01:00:00Z"), false)).toEqual({ open: false, opensAt: "2026-10-15T13:30:00.000Z", phase: "overnight", phaseEndsAt: "2026-10-15T08:00:00.000Z", extendedHours: false });
    expect(usSessionFull(at("2026-10-15T01:00:00Z"), true).extendedHours).toBe(true);
    // closed: never, overnight or not
    expect(usSessionFull(at("2026-10-17T16:00:00Z"), true)).toEqual({ open: false, opensAt: "2026-10-19T13:30:00.000Z", phase: "closed", phaseEndsAt: "2026-10-19T00:00:00.000Z", extendedHours: false });
    // an early close's after-hours ends at 17:00
    expect(usSessionFull(at("2026-11-27T18:30:00Z"), true)).toEqual({ open: false, opensAt: "2026-11-30T14:30:00.000Z", phase: "after", phaseEndsAt: "2026-11-27T22:00:00.000Z", extendedHours: true });
  });

  it("holds together at every quarter hour from the week of Thanksgiving back across the November clock change", () => {
    for (let t = at("2026-10-28T00:00:00Z"); t < at("2026-11-30T12:00:00Z"); t += 15 * 60_000) {
      const phase = usPhaseAt(t);
      const s = usSessionFull(t, true);
      expect([iso(t), s.open]).toEqual([iso(t), phase === "regular"]);
      expect(s.extendedHours).toBe(phase === "pre" || phase === "after" || phase === "overnight");
      // the phase ends ahead, another is on there, and the same one holds until then
      const ends = Date.parse(s.phaseEndsAt!);
      expect(ends).toBeGreaterThan(t);
      expect(usPhaseAt(ends)).not.toBe(phase);
      expect(usPhaseAt(ends - 60_000)).toBe(phase);
      // a DAY order ends ahead, at a close: the regular session just before it, or with extended hours the after-hours session — four
      // hours after the same day's close (16:00 and 20:00, or 13:00 and 17:00), or, placed in after-hours, before the next day's close
      const d = usDayEndAt(t, false);
      const x = usDayEndAt(t, true);
      expect(d).toBeGreaterThan(t);
      expect(x).toBeGreaterThan(t);
      expect(usPhaseAt(d - 60_000)).toBe("regular");
      expect(usPhaseAt(x - 60_000)).toBe("after");
      expect([iso(t), x === d + 4 * 3_600_000 || (x < d && phase === "after")]).toEqual([iso(t), true]);
    }
  });
});
