/** A US STOCK'S LONG PRICE HISTORY, keyless (live/history-stocks.ts, feat/paper-live phase H), against stand-ins that answer as each source
 * answered live on 2026-10-16 and 2026-10-17: Robinhood's historicals (fixed windows, each bar's session, its interpolated filler),
 * Nasdaq's daily bars by dates (us-quotes.ts Nasdaq.daily: its days with no opening price left out and counted), Cboe's every day since 2004
 * (public-stocks.ts: its copied holiday rows and repeated dates left out). Which window each range and size asks, the folds (15m from 5m,
 * 4h from New York's hours, weeks from Monday), today's bar built from the session's minutes, the nights said as gaps, where intraday
 * history starts, a page scrolled left by dates, Cboe's short volume, and the words on every page. Nothing leaves the process. */
import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { et, fromEt, isMarketDay } from "../../src/portfolio/account/calendar.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { nyDay, rangeSince } from "../../src/portfolio/live/history.ts";
import { EXTENDED_HOURS, LATE_OPEN_WORDS, REGULAR_DAYS, REGULAR_FROM_TEN, REGULAR_ONLY, ROBINHOOD_HISTORICALS, SPLIT_ONLY, stockHistory, type StockHistoryDeps } from "../../src/portfolio/live/history-stocks.ts";
import { usStocksPublic } from "../../src/portfolio/live/public-stocks.ts";
import type { Candle, CandlePage } from "../../src/portfolio/live/trade.ts";
import type { Http, HttpReply } from "../../src/portfolio/live/types.ts";
import type { Nasdaq } from "../../src/portfolio/live/us-quotes.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Tuesday 13 October 2026, 10:30 New York: the regular session is under way */
const NOW = fromEt(2026, 10, 13, 10, 30);
const json = (body: unknown, status = 200): HttpReply => ({ status, body, text: JSON.stringify(body) });
const page = (r: CandlePage | Refusal): CandlePage => {
  if (isRefusal(r)) throw new Error(`refused: ${r.code} ${r.message}`);
  return r;
};
const px = (t: number): number => Number((300 + t / DAY / 100).toFixed(4));
/** the market days from the New York date of one instant to that of another, both included, as each one's noon */
function marketDays(from: number, to: number): number[] {
  const out: number[] = [];
  const a = et(from);
  const b = et(to);
  const last = Date.UTC(b.y, b.m - 1, b.d);
  for (let d = Date.UTC(a.y, a.m - 1, a.d); d <= last; d += DAY) {
    const day = new Date(d);
    const noon = fromEt(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 12, 0);
    if (isMarketDay(noon)) out.push(noon);
  }
  return out;
}
const at = (noon: number, h: number, m: number): number => {
  const e = et(noon);
  return fromEt(e.y, e.m, e.d, h, m);
};
type RhBar = { begins_at: string; open_price: string; close_price: string; high_price: string; low_price: string; volume: number; session: string; interpolated: boolean };
const rh = (t: number, session: string, interpolated = false): RhBar => ({ begins_at: new Date(t).toISOString(), open_price: String(px(t)), close_price: String(px(t) + 0.5), high_price: String(px(t) + 1), low_price: String(px(t) - 1), volume: interpolated ? 0 : 1000, session, interpolated });
const sessionOf = (t: number): string => {
  const m = et(t).minutes;
  return m < 9 * 60 + 30 ? "pre" : m < 16 * 60 ? "reg" : "post";
};

/** ROBINHOOD'S historicals as they answered live: fixed windows (start and end ignored), each bar's session, filler marked interpolated —
 * the minutes with no trade, and today's row in a daily list — a combination it refuses answered 400 */
function robinhood(now = NOW) {
  const sent: URL[] = [];
  const intraday = (days: number[], stepMin: number, fromH: number, toH: number): RhBar[] => {
    const out: RhBar[] = [];
    for (const d of days) for (let t = at(d, fromH, 0); t < at(d, toH, 0) && t <= now - stepMin * MIN; t += stepMin * MIN) out.push(rh(t, sessionOf(t)));
    return out;
  };
  const http: Http = async (url) => {
    const u = new URL(url);
    sent.push(u);
    const m = /^\/marketdata\/historicals\/([^/]+)\/$/.exec(u.pathname);
    if (u.host !== "api.robinhood.com" || !m) return json({ detail: "Not found." }, 404);
    if (decodeURIComponent(m[1]!) === "ZZZZ") return json({ detail: "Not found." }, 404);
    const [interval, span, bounds] = [u.searchParams.get("interval"), u.searchParams.get("span"), u.searchParams.get("bounds")];
    const today = marketDays(now - 10 * DAY, now).filter((d) => d <= now + 12 * HOUR).at(-1)!;
    let rows: RhBar[];
    if (interval === "minute" && span === "day" && bounds === "extended") {
      rows = intraday([today], 1, 4, 20);
      // two minutes with no trade: Robinhood's filler
      rows[3]!.interpolated = true;
      rows[4]!.interpolated = true;
    } else if (interval === "5minute" && span === "week" && bounds === "extended") rows = intraday(marketDays(now - 9 * DAY, now).slice(-5), 5, 4, 20);
    else if (interval === "hour" && span === "month" && bounds === "extended") rows = intraday(marketDays(now - 29 * DAY, now), 60, 4, 20);
    else if (interval === "hour" && span === "3month" && bounds === "regular") rows = intraday(marketDays(now - 91 * DAY, now), 60, 10, 16);
    else if (interval === "day" && (span === "year" || span === "5year") && bounds === "regular") {
      const days = marketDays(now - (span === "year" ? 365 : 1826) * DAY, now);
      rows = days.map((d) => {
        const e = et(d);
        const r = rh(Date.UTC(e.y, e.m - 1, e.d), "reg");
        // today's row: filler flat at the close before, volume 0
        return d === today ? { ...r, interpolated: true, volume: 0 } : r;
      });
    } else return json({ non_field_errors: [`span "${span}" is not valid with bounds "${bounds}"`] }, 400);
    return json({ symbol: m[1], interval, span, bounds, historicals: rows });
  };
  return { http, sent };
}

/** NASDAQ'S daily bars by dates (us-quotes.ts Nasdaq.daily), AAPL's from 1990 — its first three days with no opening price, left out and
 * counted — and every date range asked recorded */
function nasdaq(o: { refuse?: Refusal; from?: string } = {}) {
  const asked: Array<[string, string, string]> = [];
  const first = Date.parse(`${o.from ?? "1990-01-02"}T12:00:00Z`);
  const n = {
    async daily(symbol: string, from: string, to: string) {
      asked.push([symbol, from, to]);
      if (o.refuse) return o.refuse;
      const a = Math.max(first, Date.parse(`${from}T12:00:00Z`));
      const b = Date.parse(`${to}T12:00:00Z`);
      const bars: Candle[] = [];
      let noOpen = 0;
      let lastNoOpen: number | undefined;
      for (const d of marketDays(a, b)) {
        const t = at(d, 9, 30);
        if (t < first + 5 * DAY && first < Date.parse("2000-01-01")) {
          noOpen++;
          lastNoOpen = t;
          continue;
        }
        bars.push({ t, o: px(t), h: px(t) + 1, l: px(t) - 1, c: px(t) + 0.5, v: 5000 });
      }
      return { bars, noOpen, ...(lastNoOpen !== undefined ? { lastNoOpen } : {}) };
    },
  };
  return { nasdaq: n as unknown as Nasdaq, asked };
}

function history(o: { http?: Http; nq?: ReturnType<typeof nasdaq>; cboe?: StockHistoryDeps["cboeDaily"]; minutes?: StockHistoryDeps["minutes"]; now?: number } = {}) {
  const r = robinhood(o.now ?? NOW);
  const nq = o.nq ?? nasdaq();
  const paced: string[] = [];
  const h = stockHistory(
    {
      http: o.http ?? r.http,
      pace: async (host) => void paced.push(host),
      clock: () => o.now ?? NOW,
      nasdaq: nq.nasdaq,
      cboeDaily: o.cboe ?? (async () => no("E_VENUE_UNREACHABLE", { venue: "cboe", message: "Cboe did not answer" })),
      minutes: o.minutes ?? (async () => no("E_VENUE_UNREACHABLE", { venue: "cboe", message: "Cboe did not answer" })),
    },
    "cboe",
  );
  return { h, rh: r, nq, paced };
}
const asked = (u: URL): string => `${u.searchParams.get("interval")}/${u.searchParams.get("span")}/${u.searchParams.get("bounds")}`;

describe("intraday: Robinhood's fixed windows", () => {
  it("1D: the latest session's minutes from 04:00, pre-market to after-hours, its filler left out; the page says its source, that it is split-adjusted only, and its hours", async () => {
    const s = history();
    const p = page(await s.h("AAPL", "1m", { since: rangeSince("1D", NOW), limit: 5_000, range: "1D" }));
    expect(s.rh.sent.map(asked)).toEqual(["minute/day/extended"]);
    expect(s.rh.sent[0]!.href.startsWith(`${ROBINHOOD_HISTORICALS}/AAPL/?`)).toBe(true);
    // 04:00 to 10:29, less the two filler minutes
    expect(p.bars).toHaveLength(6 * 60 + 30 - 2);
    expect(p.bars[0]!.t).toBe(fromEt(2026, 10, 13, 4, 0));
    expect(p.bars.some((b) => b.t === fromEt(2026, 10, 13, 4, 3))).toBe(false);
    expect([p.more, p.ends, p.source, p.adjustment, p.session, p.gaps]).toEqual([false, undefined, "Robinhood · AAPL", SPLIT_ONLY, EXTENDED_HOURS, undefined]);
    expect([SPLIT_ONLY, EXTENDED_HOURS]).toEqual(["split-adjusted, not dividend-adjusted", "pre-market, regular and after-hours, 04:00–20:00 New York · no overnight data"]);
    expect(s.paced).toEqual(["robinhood"]);
  });

  it("5D: five sessions of five-minute bars, each night between them said as a gap and never filled; 15m folded from them on New York's quarter hours", async () => {
    const s = history();
    const p = page(await s.h("AAPL", "5m", { since: rangeSince("5D", NOW), limit: 5_000, range: "5D" }));
    expect(s.rh.sent.map(asked)).toEqual(["5minute/week/extended"]);
    // Wednesday 7 to Tuesday 13 October: the nights of Wednesday, Thursday, Sunday and Monday — not Friday's or Saturday's
    expect(p.gaps!.map((g) => [new Date(g.from).toISOString(), g.why])).toEqual([7, 8, 11, 12].map((d) => [new Date(fromEt(2026, 10, d, 20, 0)).toISOString(), "No overnight data"]));
    expect(p.bars.some((b) => et(b.t).minutes >= 20 * 60 || et(b.t).minutes < 4 * 60)).toBe(false);
    const q = page(await s.h("AAPL", "15m", { since: rangeSince("5D", NOW), limit: 5_000, range: "5D" }));
    expect(s.rh.sent.map(asked)).toEqual(["5minute/week/extended"]);
    expect(q.bars.every((b) => b.t % (15 * MIN) === 0)).toBe(true);
    const b0 = q.bars[0]!.t;
    expect(q.bars[0]).toEqual({ t: b0, o: px(b0), h: px(b0 + 10 * MIN) + 1, l: px(b0) - 1, c: px(b0 + 10 * MIN) + 0.5, v: 3000 });
    expect(q.folded).toBe("15-minute bars folded from Robinhood's 5-minute bars (New York quarter hours)");
  });

  it("1h over a month with pre-market and after-hours; over three months the regular session from 10:00 — Robinhood's hourly regular-session bars leave out 09:30–10:00, said on every session — 4h folded from New York's hours; a page scrolled left before a window's first bar: nothing, and why", async () => {
    const s = history();
    const month = page(await s.h("AAPL", "1h", { since: rangeSince("1M", NOW), limit: 5_000, range: "1M" }));
    expect(month.session).toBe(EXTENDED_HOURS);
    expect(month.ends).toBeUndefined();
    const three = page(await s.h("AAPL", "4h", { since: rangeSince("3M", NOW), limit: 5_000, range: "3M" }));
    expect(s.rh.sent.map(asked)).toEqual(["hour/month/extended", "hour/3month/regular"]);
    expect([three.session, three.folded, three.ends, three.interval]).toEqual([REGULAR_FROM_TEN, "4-hour bars folded from Robinhood's hourly bars (New York buckets from 04:00)", undefined, undefined]);
    expect([REGULAR_FROM_TEN, REGULAR_ONLY]).toEqual(["regular session, 10:00–16:00 New York: Robinhood's regular-session hours leave out 09:30–10:00", "regular session only, 09:30–16:00 New York"]);
    // 10:00 and 11:00 fold into 08:00's four hours, 12:00 to 15:00 into 12:00's
    const day = three.bars.filter((b) => et(b.t).d === 12 && et(b.t).m === 10);
    expect(day.map((b) => et(b.t).minutes / 60)).toEqual([8, 12]);
    expect(day[1]).toMatchObject({ o: px(at(day[1]!.t, 12, 0)), c: px(at(day[1]!.t, 15, 0)) + 0.5, v: 4000 });
    // every session's 09:30–10:00 said as a gap, never filled: one a market day, none on a weekend
    const days = new Set(three.bars.map((b) => `${et(b.t).m}-${et(b.t).d}`));
    expect(three.gaps!.length).toBe(days.size);
    expect(three.gaps!.every((g) => et(g.from).minutes === 9 * 60 + 30 && g.to - g.from === 30 * MIN && g.why === LATE_OPEN_WORDS)).toBe(true);
    expect(LATE_OPEN_WORDS).toBe("No bars 09:30–10:00 New York: Robinhood's hourly regular-session bars start at 10:00");
    // a page scrolled left before the window's first bar: nothing, and why
    const left = page(await s.h("AAPL", "1m", { until: fromEt(2026, 10, 13, 4, 0), limit: 300 }));
    expect([left.bars, left.more, left.ends]).toEqual([[], false, "Intraday history starts Tue 13 Oct 2026 04:00 New York: Robinhood publishes no older 1-minute bars without a broker's key"]);
  });

  it("the three months' hourly bars as Robinhood stamps them: the first at 14:00Z (10:00 New York in summer), so the day starts at 10:00 and its half hour from the open is a gap — never drawn as 09:30", async () => {
    const s = history();
    const h = page(await s.h("AAPL", "1h", { since: rangeSince("3M", NOW), limit: 5_000, range: "3M" }));
    const oct12 = h.bars.filter((b) => et(b.t).m === 10 && et(b.t).d === 12);
    expect(new Date(oct12[0]!.t).toISOString()).toBe("2026-10-12T14:00:00.000Z");
    expect(oct12.map((b) => et(b.t).minutes / 60)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(h.gaps!.find((g) => et(g.from).m === 10 && et(g.from).d === 12)).toEqual({ from: Date.parse("2026-10-12T13:30:00Z"), to: Date.parse("2026-10-12T14:00:00Z"), why: LATE_OPEN_WORDS });
    expect(h.session).toBe(REGULAR_FROM_TEN);
  });

  it("a range Robinhood's window at the size asked does not reach is drawn in the finest size whose window does, and says why: 6M at 4h in days, 1M at 5m in hours, 5D at 1m in five minutes", async () => {
    const s = history();
    const six = page(await s.h("AAPL", "4h", { since: rangeSince("6M", NOW), limit: 5_000, range: "6M" }));
    expect(s.rh.sent.map(asked)).toEqual(["day/year/regular", "minute/day/extended"]);
    expect([six.interval, six.note, six.ends, six.session]).toEqual(["1d", "Robinhood publishes 4-hour bars of AAPL for about three months only without a broker's key: 6M is drawn in daily bars", undefined, REGULAR_DAYS]);
    // the whole six months, in days: the first within a few days of the range's start
    expect(six.bars[0]!.t - rangeSince("6M", NOW)).toBeLessThan(4 * DAY);
    const month = page(await s.h("AAPL", "5m", { since: rangeSince("1M", NOW), limit: 5_000, range: "1M" }));
    expect([month.interval, month.session]).toEqual(["1h", EXTENDED_HOURS]);
    expect(month.note).toBe("Robinhood publishes 5-minute bars of AAPL for the latest five sessions only without a broker's key: 1M is drawn in hourly bars");
    const five = page(await s.h("AAPL", "1m", { since: rangeSince("5D", NOW), limit: 5_000, range: "5D" }));
    expect(five.interval).toBe("5m");
    // what each window reaches is asked as it is: 1D in minutes and 3M in hours stay as asked
    expect(page(await s.h("AAPL", "1m", { since: rangeSince("1D", NOW), limit: 5_000, range: "1D" })).interval).toBeUndefined();
    expect(page(await s.h("AAPL", "4h", { since: rangeSince("3M", NOW), limit: 5_000, range: "3M" })).interval).toBeUndefined();
  });

  it("a page scrolled left after a three months' view in hours asks the three months' window, and says where that one starts — never the month's, newer than the bars it is asked before", async () => {
    const s = history();
    const three = page(await s.h("AAPL", "4h", { since: rangeSince("3M", NOW), limit: 5_000, range: "3M" }));
    const n = s.rh.sent.length;
    const left = page(await s.h("AAPL", "4h", { until: three.bars[0]!.t, limit: 300 }));
    // kept from the view's own ask a minute: nothing more asked of Robinhood
    expect(s.rh.sent.length).toBe(n);
    expect([left.bars, left.more]).toEqual([[], false]);
    // the three months' first day, its first four hours (08:00's, from its 10:00 bar)
    expect(left.ends).toBe(`Intraday history starts ${nyDay(three.bars[0]!.t)} 08:00 New York: Robinhood publishes no older 4-hour bars without a broker's key`);
    expect(three.bars[0]!.t).toBeLessThan(rangeSince("1M", NOW) - 30 * DAY);
    // after a month's view, the month's window: its own start
    const month = page(await s.h("AAPL", "1h", { since: rangeSince("1M", NOW), limit: 5_000, range: "1M" }));
    const back = page(await s.h("AAPL", "1h", { until: month.bars[0]!.t, limit: 300 }));
    expect(back.ends).toBe(`Intraday history starts ${nyDay(month.bars[0]!.t)} 04:00 New York: Robinhood publishes no older hourly bars without a broker's key`);
  });

  it("where Robinhood keeps no history of a share: the latest session's minutes from Cboe and Nasdaq, said as theirs; both refusing, Robinhood's words", async () => {
    const minutes: Candle[] = [{ t: fromEt(2026, 10, 13, 9, 31), o: 1, h: 2, l: 1, c: 2, v: 10 }, { t: fromEt(2026, 10, 13, 9, 34), o: 2, h: 3, l: 2, c: 3, v: 5 }];
    const s = history({ minutes: async () => minutes });
    const p = page(await s.h("ZZZZ", "5m", { since: rangeSince("1D", NOW), limit: 5_000, range: "1D" }));
    expect(p.bars).toEqual([{ t: fromEt(2026, 10, 13, 9, 30), o: 1, h: 3, l: 1, c: 3, v: 15 }]);
    expect(p.source).toBe("Cboe · 15 min delayed, regular session · Nasdaq one-price-a-minute samples outside it · ZZZZ");
    const none = await history().h("ZZZZ", "5m", { since: rangeSince("1D", NOW), limit: 5_000, range: "1D" });
    expect((none as Refusal).message).toBe("Robinhood keeps no history of ZZZZ");
  });
});

describe("daily and weekly: Robinhood's year or five, Nasdaq's by dates for all of it and for every page scrolled left", () => {
  it("1Y: Robinhood's days, its filler row for today left out, and today's bar built from the session's regular minutes — said as \"Today so far\"", async () => {
    const s = history();
    const p = page(await s.h("AAPL", "1d", { since: rangeSince("1Y", NOW), limit: 5_000, range: "1Y" }));
    expect(s.rh.sent.map(asked)).toEqual(["day/year/regular", "minute/day/extended"]);
    expect(p.bars.every((b) => et(b.t).minutes === 9 * 60 + 30)).toBe(true);
    const last = p.bars.at(-1)!;
    expect(last.t).toBe(fromEt(2026, 10, 13, 9, 30));
    // 09:30 to 10:29's minutes: the first's open, the last's close, their volume
    expect(last).toEqual({ t: last.t, o: px(fromEt(2026, 10, 13, 9, 30)), h: px(fromEt(2026, 10, 13, 10, 29)) + 1, l: px(fromEt(2026, 10, 13, 9, 30)) - 1, c: px(fromEt(2026, 10, 13, 10, 29)) + 0.5, v: 60_000 });
    expect(p.today).toEqual({ t: last.t, words: "Today so far" });
    expect([p.more, p.session, p.source]).toEqual([true, REGULAR_DAYS, "Robinhood · AAPL"]);
    // on the Saturday after a session, its bar is built the same way and said so
    const sat = fromEt(2026, 10, 17, 3, 0);
    const later = page(await history({ now: sat }).h("AAPL", "1d", { since: rangeSince("1Y", sat), limit: 5_000, range: "1Y" }));
    expect(later.today).toEqual({ t: fromEt(2026, 10, 16, 9, 30), words: "Built from Robinhood's 1-minute bars of the session: its daily bar is not published yet" });
    // weeks folded from the days, from Monday, the last one this week so far
    const weeks = page(await s.h("AAPL", "1w", { since: rangeSince("5Y", NOW), limit: 5_000, range: "5Y" }));
    // the session's minutes were kept from the ask before (fifteen seconds)
    expect(s.rh.sent.slice(2).map(asked)).toEqual(["day/5year/regular"]);
    expect(weeks.bars.every((b) => et(b.t).dow === 1 && et(b.t).minutes === 9 * 60 + 30)).toBe(true);
    expect(weeks.today).toEqual({ t: fromEt(2026, 10, 12, 9, 30), words: "This week so far: today so far" });
    expect(weeks.folded).toBe("weekly bars folded from Robinhood's daily bars (weeks from Monday)");
  });

  it("MAX: Nasdaq's days from 1970, its days with no opening price left out and said; the latest 5,000 with older ones said to exist; weeks of all of it", async () => {
    const s = history();
    const p = page(await s.h("AAPL", "1d", { since: 0, limit: 5_000, range: "MAX" }));
    expect(s.nq.asked).toEqual([["AAPL", "1970-01-01", "2026-10-13"]]);
    expect([p.bars.length, p.more, p.source]).toEqual([5_000, true, "Nasdaq · AAPL"]);
    const w = page(await s.h("AAPL", "1w", { since: 0, limit: 5_000, range: "MAX" }));
    expect(w.more).toBe(false);
    // its first four days (2 to 5 January 1990) give no opening price
    expect(w.ends).toBe("Nasdaq's daily history of AAPL starts Mon 8 Jan 1990: its days before give no opening price and are left out");
  });

  it("a page scrolled left before a chart's first day: ONE ask of Nasdaq by dates, the days before it; before Nasdaq's first, nothing, and why", async () => {
    const s = history({ nq: nasdaq({ from: "2000-01-03" }) });
    const until = fromEt(2021, 10, 18, 9, 30);
    const p = page(await s.h("AAPL", "1d", { until, limit: 300 }));
    expect(s.nq.asked).toEqual([["AAPL", "2020-07-18", "2021-10-17"]]);
    expect(s.rh.sent).toEqual([]);
    expect(p.bars.length).toBe(300);
    expect([p.bars.at(-1)!.t, p.more, p.source]).toEqual([fromEt(2021, 10, 15, 9, 30), true, "Nasdaq · AAPL"]);
    const first = page(await s.h("AAPL", "1d", { until: fromEt(2000, 1, 3, 9, 30), limit: 300 }));
    expect([first.bars, first.more, first.ends]).toEqual([[], false, "Nasdaq keeps no daily bars of AAPL before Mon 3 Jan 2000"]);
  });

  it("where Robinhood and Nasdaq both refuse, Cboe's days — their short volume from 2021-10-15 to 2022-06-17 left unsaid where Nasdaq gives none", async () => {
    const cboe: Candle[] = [fromEt(2021, 10, 14, 9, 30), fromEt(2021, 10, 15, 9, 30), fromEt(2022, 6, 17, 9, 30), fromEt(2022, 6, 21, 9, 30), fromEt(2026, 10, 12, 9, 30)].map((t) => ({ t, o: 10, h: 11, l: 9, c: 10.5, v: 777 }));
    const refuse = no("E_VENUE_GEOBLOCKED", { venue: "nasdaq", message: "Nasdaq does not serve this location: that is its own rule, and the account does not look for a way around it" });
    const down: Http = async () => json({ detail: "unavailable" }, 503);
    const s = history({ http: down, nq: nasdaq({ refuse }), cboe: async () => cboe });
    const p = page(await s.h("AAPL", "1d", { since: fromEt(2021, 10, 1), limit: 5_000 }));
    expect(p.bars.map((b) => b.v)).toEqual([777, undefined, undefined, 777, 777]);
    expect(p.source).toBe("Cboe · AAPL");
    // Nasdaq answering that stretch: its volume in place of Cboe's
    const nq = nasdaq();
    const n = nq.nasdaq.daily.bind(nq.nasdaq);
    let first = true;
    (nq.nasdaq as { daily: Nasdaq["daily"] }).daily = async (sym, from, to) => (first ? ((first = false), refuse) : n(sym, from, to));
    const fixed = page(await history({ http: down, nq, cboe: async () => cboe }).h("AAPL", "1d", { since: fromEt(2021, 10, 1), limit: 5_000 }));
    expect(fixed.bars.map((b) => b.v)).toEqual([777, 5000, 5000, 777, 777]);
  });
});

describe("through the US stocks line (public-stocks.ts)", () => {
  it("hours where Robinhood keeps none: Cboe's month of ten-minute regular-session bars, each at its start (ten minutes before its label), folded into New York's hours", async () => {
    const month = json({ timestamp: "2026-10-13 14:45:06", symbol: "AAPL", data: [["09:40", 330, 331, 329, 330.5], ["09:50", 330.5, 332, 330, 331], ["10:00", 331, 331.5, 330.2, 331.2], ["10:10", 331.2, 333, 331, 332.8]].map(([clock, o, h, l, c], i) => ({ datetime: `2026-10-12T${clock}:00`, sequence_number: i, price: { open: o, high: h, low: l, close: c }, volume: { stock_volume: 1000 } })) });
    const http: Http = async (url) => (url.includes("/charts/one_month/AAPL.json") ? month : json({ detail: "unavailable" }, 503));
    const src = usStocksPublic({ http, clock: () => NOW, pace: async () => undefined });
    const p = (await src.candles!("AAPL", "1h", { since: fromEt(2026, 10, 12, 0, 0) })) as CandlePage;
    // 09:30–09:40, 09:40–09:50 and 09:50–10:00 are the 09:00 hour's; 10:00–10:10 the 10:00 hour's
    expect(p.bars).toEqual([
      { t: fromEt(2026, 10, 12, 9, 0), o: 330, h: 332, l: 329, c: 331.2, v: 3000 },
      { t: fromEt(2026, 10, 12, 10, 0), o: 331.2, h: 333, l: 331, c: 332.8, v: 1000 },
    ]);
    expect([p.source, p.session, p.folded]).toEqual(["Cboe · 10-minute regular-session bars, 15 min delayed · AAPL", REGULAR_ONLY, "hourly bars folded from Cboe's 10-minute bars"]);
  });

  /** Cboe's daily file as it answered live, with its own quirks: a closed day's row copying the day before (Memorial Day 2025), and a date
   * written twice */
  const CBOE_DAYS = json({ timestamp: "11:00:08", data: [{ date: "2025-05-23", volume: 100, open: 1, high: 2, low: 1, close: 2 }, { date: "2025-05-26", volume: 100, open: 1, high: 2, low: 1, close: 2 }, { date: "2025-05-27", volume: 200, open: 2, high: 3, low: 2, close: 3 }, { date: "2025-05-27", volume: 999, open: 9, high: 9, low: 9, close: 9 }, { date: "2025-05-28", volume: 300, open: 3, high: 4, low: 3, close: 4 }] });
  it("Cboe's days where the others refuse: its copied holiday row and its repeated date left out; Robinhood asked first at its fixed host", async () => {
    const sent: string[] = [];
    const http: Http = async (url) => {
      sent.push(url);
      if (url.includes("/charts/historical/SPY.json")) return CBOE_DAYS;
      if (url.includes("api.nasdaq.com")) return { status: 403, body: undefined, text: "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>" };
      return json({ detail: "unavailable" }, 503);
    };
    const src = usStocksPublic({ http, clock: () => NOW, pace: async () => undefined });
    const p = (await src.candles!("SPY", "1d", { since: fromEt(2025, 5, 1) })) as CandlePage;
    expect(p.bars.map((b) => [et(b.t).m, et(b.t).d, b.c])).toEqual([[5, 23, 2], [5, 27, 3], [5, 28, 4]]);
    expect(sent[0]!.startsWith(`${ROBINHOOD_HISTORICALS}/SPY/?interval=day&span=year&bounds=regular`)).toBe(false);
    expect(sent.some((u) => u.startsWith(`${ROBINHOOD_HISTORICALS}/SPY/?interval=day&span=5year&bounds=regular`))).toBe(true);
    expect(sent.every((u) => ["api.robinhood.com", "api.nasdaq.com", "cdn-api.cboe.com"].includes(new URL(u).host))).toBe(true);
  });
});
