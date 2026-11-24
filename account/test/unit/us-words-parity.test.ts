import { describe, expect, it } from "vitest";
import { usSessionFull } from "../../src/portfolio/account/calendar.ts";
import { NASDAQ_CLOSE_FROM as ACCOUNT_CLOSE_FROM, usSessionWords as accountWords } from "../../src/portfolio/market/shapes.ts";
import { NASDAQ_CLOSE_FROM, usSessionWords as marketWords } from "../../../market/src/live/public-stocks.ts";

/** The account's copy of the US line's session words is the market's, word for word (two packages, no shared module): over a table of
 * moments and quote sources the two say the same, so the copies cannot drift apart unseen */
const at = (iso: string): number => Date.parse(iso);
// 2026-11-18 is a Wednesday: the regular session is 14:30 to 21:00 UTC (09:30 to 16:00 New York)
const CLOSE = at("2026-11-17T21:00:00Z");
const cases: { name: string; now: string; overnight: boolean; from: string; quoteAt: number | undefined }[] = [
  { name: "closed, with a close line", now: "2026-11-21T17:00:00Z", overnight: false, from: NASDAQ_CLOSE_FROM, quoteAt: at("2026-11-20T21:00:00Z") },
  { name: "pre-market, no real-time answer", now: "2026-11-18T12:00:00Z", overnight: false, from: "Cboe · 15 min delayed", quoteAt: undefined },
  { name: "pre-market, with a close line", now: "2026-11-18T12:00:00Z", overnight: false, from: NASDAQ_CLOSE_FROM, quoteAt: CLOSE },
  { name: "the regular session, with a close line", now: "2026-11-18T15:30:00Z", overnight: false, from: NASDAQ_CLOSE_FROM, quoteAt: CLOSE },
  { name: "the regular session, real time", now: "2026-11-18T15:30:00Z", overnight: false, from: "Nasdaq · real time", quoteAt: at("2026-11-18T15:29:30Z") },
  { name: "after-hours, a Nasdaq quote", now: "2026-11-17T22:00:00Z", overnight: false, from: "Nasdaq · real time", quoteAt: at("2026-11-17T21:58:00Z") },
  { name: "after-hours, an old Nasdaq trade", now: "2026-11-17T22:00:00Z", overnight: false, from: "Nasdaq · real time", quoteAt: at("2026-11-17T20:00:00Z") },
  { name: "overnight, Robinhood", now: "2026-11-18T03:00:00Z", overnight: true, from: "Robinhood · real time", quoteAt: at("2026-11-18T02:59:00Z") },
  { name: "overnight, a share not traded then, with a close line", now: "2026-11-18T03:00:00Z", overnight: false, from: NASDAQ_CLOSE_FROM, quoteAt: CLOSE },
];

describe("the US line's session words, the account's copy and the market's", () => {
  it("name the close line's source the same", () => {
    expect(ACCOUNT_CLOSE_FROM).toBe(NASDAQ_CLOSE_FROM);
  });
  for (const c of cases) {
    it(`say the same words: ${c.name}`, () => {
      const now = at(c.now);
      const session = usSessionFull(now, c.overnight);
      const words = accountWords(session, c.from, c.quoteAt, now);
      expect(words).toBe(marketWords(session, c.from, c.quoteAt, now));
      if (c.from === NASDAQ_CLOSE_FROM) expect(words).not.toMatch(/Cboe/);
    });
  }
  it("say a close line's close in the regular session", () => {
    const now = at("2026-11-18T15:30:00Z");
    expect(accountWords(usSessionFull(now, false), NASDAQ_CLOSE_FROM, CLOSE, now)).toMatch(/no real-time quote answered: the price is Nasdaq's close of/);
  });
});
