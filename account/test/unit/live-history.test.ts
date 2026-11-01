/** LONG PRICE HISTORY, WHAT EVERY SOURCE SHARES (live/history.ts, feat/paper-live phase H): the ranges and the bar each starts in, a US
 * stock's 1D and 5D counted in sessions, bars folded from finer real bars (UTC and New York, Monday weeks), a page held to its window and
 * whether older bars exist, the nights a stock's extended hours say nothing of, the line each host's requests wait in, and the bounded
 * memory that absorbs the same ask repeated. Pure: no network, no file; the lines run on a stand-in clock. */
import { describe, expect, it } from "vitest";
import { no } from "../../src/portfolio/refuse.ts";
import { fromEt } from "../../src/portfolio/account/calendar.ts";
import { badWindow, barStart, coarserThan, foldBars, historyKeep, HOST_LIMITS, INTERVAL_RANGE, keepMsOf, lane, limitOf, overnightGaps, PAGE_MOST, pageOf, pageWeight, RANGE_BAR, rangeSince, sessionsSince, windowKey } from "../../src/portfolio/live/history.ts";
import { CANDLE_INTERVALS, CANDLE_RANGES, HISTORY_MOST, INTERVAL_MS, type Candle, type CandlePage } from "../../src/portfolio/live/trade.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const bar = (t: number, o: number, h: number, l: number, c: number, v?: number): Candle => ({ t, o, h, l, c, ...(v !== undefined ? { v } : {}) });

describe("the bar sizes and the ranges", () => {
  it("seven bar sizes, nine ranges, each range in its own bar size and each size over a range of its own", () => {
    expect(CANDLE_INTERVALS).toEqual(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);
    expect(CANDLE_INTERVALS.map((i) => INTERVAL_MS[i])).toEqual([MIN, 5 * MIN, 15 * MIN, HOUR, 4 * HOUR, DAY, 7 * DAY]);
    expect(CANDLE_RANGES).toEqual(["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"]);
    // the spec's table (PAPERLIVE.md "Ranges and default bar sizes")
    expect(RANGE_BAR).toEqual({ "1D": "1m", "5D": "5m", "1M": "1h", "3M": "4h", "6M": "4h", YTD: "1d", "1Y": "1d", "5Y": "1w", MAX: "1w" });
    // a chart that asks only a size gets about what it drew before ranges: a day of 5m, a month of 1h, a year of 1d
    expect(INTERVAL_RANGE).toEqual({ "1m": "1D", "5m": "1D", "15m": "5D", "1h": "1M", "4h": "3M", "1d": "1Y", "1w": "5Y" });
    expect([coarserThan("1m"), coarserThan("4h"), coarserThan("1w")]).toEqual(["5m", "1d", undefined]);
    expect([HISTORY_MOST, PAGE_MOST]).toEqual([5_000, 1_000]);
  });

  it("a range's start on the calendar: days back from now, the year so far from 1 January UTC, all of it from the start", () => {
    const now = Date.parse("2026-10-17T07:00:00Z");
    expect(rangeSince("1D", now)).toBe(now - DAY);
    expect(rangeSince("5D", now)).toBe(now - 5 * DAY);
    expect(rangeSince("1M", now)).toBe(now - 30 * DAY);
    expect(rangeSince("3M", now)).toBe(now - 92 * DAY);
    expect(rangeSince("6M", now)).toBe(now - 183 * DAY);
    expect(rangeSince("YTD", now)).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(rangeSince("1Y", now)).toBe(now - 365 * DAY);
    expect(rangeSince("5Y", now)).toBe(now - 1826 * DAY);
    expect(rangeSince("MAX", now)).toBe(0);
  });

  it("a US stock's 1D is its latest session from 04:00 New York, its 5D the latest five — a Monday morning's 1D is Monday's, a Saturday's Friday's, a holiday skipped", () => {
    // Monday 12 October 2026, 10:00 New York
    expect(sessionsSince("1D", fromEt(2026, 10, 12, 10, 0))).toBe(fromEt(2026, 10, 12, 4, 0));
    // Monday 03:00: the session has not begun, so the latest is Friday's
    expect(sessionsSince("1D", fromEt(2026, 10, 12, 3, 0))).toBe(fromEt(2026, 10, 9, 4, 0));
    // Saturday 17 October: Friday's; five sessions back from it is Monday 12
    expect(sessionsSince("1D", fromEt(2026, 10, 17, 3, 0))).toBe(fromEt(2026, 10, 16, 4, 0));
    expect(sessionsSince("5D", fromEt(2026, 10, 17, 3, 0))).toBe(fromEt(2026, 10, 12, 4, 0));
    // Thanksgiving (Thursday 26 November 2026) is no session
    expect(sessionsSince("5D", fromEt(2026, 11, 30, 12, 0))).toBe(fromEt(2026, 11, 23, 4, 0));
    // other ranges are the calendar's
    expect(sessionsSince("1M", fromEt(2026, 10, 12, 10, 0))).toBe(fromEt(2026, 10, 12, 10, 0) - 30 * DAY);
  });
});

describe("folding: a size the source does not publish, from its own finer real bars", () => {
  it("a bar's start: UTC hours and four-hour marks, weeks from Monday 00:00 UTC (not the epoch's Thursday); New York's four hours from 04:00, a stock's day at 09:30 and its week at its Monday's", () => {
    const t = Date.parse("2026-10-15T13:47:12Z"); // a Thursday
    expect(new Date(barStart(t, "15m")).toISOString()).toBe("2026-10-15T13:45:00.000Z");
    expect(new Date(barStart(t, "4h")).toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(new Date(barStart(t, "1d")).toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(new Date(barStart(t, "1w")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(new Date(barStart(Date.parse("2026-10-12T00:00:00Z"), "1w")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(new Date(barStart(Date.parse("2026-10-11T23:59:59Z"), "1w")).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    // 09:47 New York (EDT): its four hours from 08:00, its day at 09:30, its week at Monday 12 October's 09:30
    expect(barStart(t, "4h", "new-york")).toBe(fromEt(2026, 10, 15, 8, 0));
    expect(barStart(t, "1d", "new-york")).toBe(fromEt(2026, 10, 15, 9, 30));
    expect(barStart(t, "1w", "new-york")).toBe(fromEt(2026, 10, 12, 9, 30));
    // minutes and hours start at the same instants in both
    expect(barStart(t, "1h", "new-york")).toBe(barStart(t, "1h"));
    // in winter (EST) too
    expect(barStart(fromEt(2026, 12, 2, 13, 5), "4h", "new-york")).toBe(fromEt(2026, 12, 2, 12, 0));
  });

  it("folds real bars: first open, highest high, lowest low, last close, the volume only where every part has one; a bucket with no bar stays empty; one that starts before `from` is left out", () => {
    const H0 = Date.parse("2026-10-15T00:00:00Z");
    const hours = [bar(H0 + 5 * HOUR, 103, 106, 102, 104, 1), bar(H0, 100, 101, 99, 100.5, 2), bar(H0 + HOUR, 100.5, 105, 100, 104, 3), bar(H0 + 3 * HOUR, 104, 104.5, 98, 99, 4), bar(H0 + 9 * HOUR, 90, 91, 89, 90)];
    expect(foldBars(hours, "4h")).toEqual([
      bar(H0, 100, 105, 98, 99, 9),
      bar(H0 + 4 * HOUR, 103, 106, 102, 104, 1),
      // 09:00's bar has no volume: its bucket says none
      bar(H0 + 8 * HOUR, 90, 91, 89, 90),
    ]);
    // nothing between 12:00 and 20:00: no bar is made for it
    expect(foldBars(hours, "4h").map((b) => b.t)).not.toContain(H0 + 12 * HOUR);
    expect(foldBars(hours, "4h", "utc", H0 + 4 * HOUR).map((b) => b.t)).toEqual([H0 + 4 * HOUR, H0 + 8 * HOUR]);
    // a week from Monday out of days
    const days = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => bar(Date.parse("2026-10-10T00:00:00Z") + i * DAY, 10 + i, 11 + i, 9 + i, 10.5 + i, 1));
    expect(foldBars(days, "1w").map((b) => [new Date(b.t).toISOString().slice(0, 10), b.o, b.c, b.v])).toEqual([["2026-10-05", 10, 11.5, 2], ["2026-10-12", 12, 17.5, 6]]);
  });
});

describe("a page, whoever drew it", () => {
  const T = Date.parse("2026-10-15T00:00:00Z");
  const hourly = (n: number, from = T): Candle[] => Array.from({ length: n }, (_, i) => bar(from + i * HOUR, 100, 101, 99, 100));

  it("holds what a source answered to its window: the bars that start in it, one to a start, oldest first, the latest `limit`; a cut window says older bars exist", () => {
    // newest first, a start given twice, a bar before the window, one that is no bar (NaN), one after the window's end
    const got = [...hourly(10), hourly(1)[0]!, bar(T - HOUR, 1, 1, 1, 1), { t: T + 20 * HOUR, o: NaN, h: 1, l: 1, c: 1 } as Candle].reverse();
    const page = pageOf(got, "1h", { since: T, until: T + 8 * HOUR, limit: 5 });
    expect(page.bars.map((b) => (b.t - T) / HOUR)).toEqual([3, 4, 5, 6, 7]);
    expect(page.more).toBe(true);
    const all = pageOf(got, "1h", { since: T, until: T + 8 * HOUR });
    expect([all.bars.map((b) => (b.t - T) / HOUR), all.more]).toEqual([[0, 1, 2, 3, 4, 5, 6, 7], false]);
    expect(pageOf(got, "1h", {}).bars.every((b) => Number.isFinite(b.o))).toBe(true);
  });

  it("a plain list says nothing of what lies before it: a first view it fills is not taken to have more; a page asked before a bar that brought any is", () => {
    expect(pageOf(hourly(3), "1h", { since: T }).more).toBe(false);
    expect(pageOf(hourly(3), "1h", { until: T + 10 * HOUR, limit: 300 }).more).toBe(true);
    expect(pageOf([], "1h", { until: T, limit: 300 }).more).toBe(false);
  });

  it("carries the source's words; where the history ends is said only where nothing older is; gaps and today's bar only among the bars kept", () => {
    const src: CandlePage = {
      bars: hourly(6),
      more: false,
      ends: "Somewhere's history starts Thu 15 Oct 2026",
      source: "Somewhere · X",
      gaps: [{ from: T - 10 * HOUR, to: T - 9 * HOUR, why: "No overnight data" }, { from: T + 2 * HOUR, to: T + 3 * HOUR, why: "No overnight data" }],
      today: { t: T + 5 * HOUR, words: "Today so far" },
    };
    expect(pageOf(src, "1h", { since: T })).toEqual({ bars: hourly(6), more: false, ends: src.ends, source: src.source, gaps: [src.gaps![1]], today: src.today });
    // cut to the latest two: older bars exist, so no end is said; the gap before them goes, today stays
    const cut = pageOf(src, "1h", { since: T, limit: 2 });
    expect([cut.more, cut.ends, cut.gaps, cut.today]).toEqual([true, undefined, undefined, src.today]);
    // today's bar outside the window goes too
    expect(pageOf(src, "1h", { since: T, until: T + 4 * HOUR }).today).toBeUndefined();
  });

  it("a window's limits, its key in a memory and how long its answer is kept: a range by its name, a page by its end; a page that ends in the past five minutes", () => {
    expect([limitOf({ since: 0 }), limitOf({ until: T }), limitOf({ since: 0, limit: 99_999 }), limitOf({ until: T, limit: 5_000 }), limitOf({ since: 0, limit: 0 })]).toEqual([HISTORY_MOST, PAGE_MOST, HISTORY_MOST, PAGE_MOST, HISTORY_MOST]);
    expect(windowKey("1h", { since: T, range: "1M", limit: 5000 })).toBe(windowKey("1h", { since: T + 999, range: "1M", limit: 5000 }));
    expect(windowKey("1h", { since: T, limit: 5000 })).not.toBe(windowKey("1h", { since: T + 60_000, limit: 5000 }));
    expect(windowKey("1h", { until: T, limit: 300 })).not.toBe(windowKey("1h", { until: T - HOUR, limit: 300 }));
    expect([keepMsOf("1m", { since: T }), keepMsOf("1h", { since: T }), keepMsOf("1m", { until: T })]).toEqual([15_000, 30_000, 300_000]);
    expect(badWindow("2h", { since: 0 }, T)).toBe('price history comes in bars of 1m, 5m, 15m, 1h, 4h, 1d, 1w, not "2h"');
    expect([badWindow("1h", { since: T + 1 }, T), badWindow("1h", { until: -1 }, T), badWindow("1h", { until: T, limit: 0 }, T), badWindow("1h", { since: 0 }, T)]).toEqual(["price history starts before now", "a page of price history ends at a time, in milliseconds", "a page of price history holds at least one bar", undefined]);
  });
});

describe("the nights a US stock's extended hours say nothing of", () => {
  it("each overnight session between two instants, Sunday to Thursday night ahead of a market day — not Friday's or Saturday's, not the night before a holiday", () => {
    // Friday 9 October 16:00 to Thursday 15 October 12:00 New York: the nights of Sunday, Monday (Columbus Day is a market day), Tuesday,
    // Wednesday
    const gaps = overnightGaps(fromEt(2026, 10, 9, 16, 0), fromEt(2026, 10, 15, 12, 0));
    expect(gaps.map((g) => [g.from, g.to, g.why])).toEqual([11, 12, 13, 14].map((d) => [fromEt(2026, 10, d, 20, 0), fromEt(2026, 10, d + 1, 4, 0), "No overnight data"]));
    // Wednesday 25 November to Friday 27 November: Thanksgiving's eve is no overnight session (no market day after it); the night before
    // the Friday is
    expect(overnightGaps(fromEt(2026, 11, 25, 12, 0), fromEt(2026, 11, 27, 12, 0)).map((g) => g.from)).toEqual([fromEt(2026, 11, 26, 20, 0)]);
    expect(overnightGaps(10, 5)).toEqual([]);
  });
});

describe("a line per host: the venue's rate limit kept", () => {
  /** a stand-in clock that a wait moves on */
  function clock() {
    let t = 0;
    const waits: number[] = [];
    return { now: () => t, sleep: async (ms: number) => void (waits.push(ms), (t += ms)), waits, at: () => t };
  }

  it("at most `max` requests in any window of `perMs`, in the order asked: the next waits for the oldest to age out, and none is dropped", async () => {
    const c = clock();
    const l = lane(10, 1_000, c);
    const started: number[] = [];
    await Promise.all(Array.from({ length: 25 }, (_, i) => l().then(() => started.push(c.at()) && i)));
    expect(started).toHaveLength(25);
    // ten at once, ten a second later, five a second after that
    expect(started.filter((t) => t === 0)).toHaveLength(10);
    expect(started.filter((t) => t === 1_000)).toHaveLength(10);
    expect(started.filter((t) => t === 2_000)).toHaveLength(5);
    expect(started).toEqual([...started].sort((a, b) => a - b));
  });

  it("weighs each request where the host counts weight (Hyperliquid): a heavy one waits until the window has room for it", async () => {
    const c = clock();
    const l = lane(900, 60_000, c);
    await l(104);
    await l(800);
    expect(c.at()).toBe(60_000);
    await l(20);
    expect(c.at()).toBe(60_000);
    // the limits as written: Coinbase ten a second, OKX twenty in two seconds, Hyperliquid 900 of its 1,200 a minute
    expect([HOST_LIMITS.coinbase, HOST_LIMITS.okx, HOST_LIMITS.hyperliquid]).toEqual([{ max: 10, perMs: 1_000 }, { max: 20, perMs: 2_000 }, { max: 900, perMs: 60_000 }]);
  });
});

describe("the memory: bounded, short, in this process only", () => {
  const page = (n: number): CandlePage => ({ bars: Array.from({ length: n }, (_, i) => bar(i * MIN, 1, 1, 1, 1)), more: false });

  it("one request for many askers while it is on its way; the answer kept for its time, then asked again; a refusal never kept", async () => {
    let t = 0;
    const keep = historyKeep<CandlePage>({ entries: 4, most: 1_000, weigh: pageWeight, clock: () => t });
    let asked = 0;
    const load = async () => (asked++, page(3));
    const [a, b] = await Promise.all([keep.get("k", 15_000, load), keep.get("k", 15_000, load)]);
    expect([asked, a === b]).toEqual([1, true]);
    t = 14_999;
    await keep.get("k", 15_000, load);
    expect(asked).toBe(1);
    t = 15_000;
    await keep.get("k", 15_000, load);
    expect(asked).toBe(2);
    let refused = 0;
    const no1 = async () => (refused++, no("E_VENUE_UNREACHABLE", { venue: "x", message: "x did not answer" }));
    await keep.get("r", 60_000, no1);
    await keep.get("r", 60_000, no1);
    expect(refused).toBe(2);
    expect(keep.size).toBe(1);
  });

  it("at most `entries` answers and `most` bars: the one used longest ago let go first, whatever their times", async () => {
    const keep = historyKeep<CandlePage>({ entries: 3, most: 100, weigh: pageWeight, clock: () => 0 });
    let asked = 0;
    const of = (n: number) => async () => (asked++, page(n));
    await keep.get("a", 600_000, of(10));
    await keep.get("b", 600_000, of(10));
    await keep.get("c", 600_000, of(10));
    // "a" used again: "b" is the oldest now
    await keep.get("a", 600_000, of(10));
    await keep.get("d", 600_000, of(10));
    expect([keep.size, keep.weight, asked]).toEqual([3, 30, 4]);
    await keep.get("a", 600_000, of(10));
    await keep.get("b", 600_000, of(10));
    expect(asked).toBe(5);
    // a heavy answer pushes out as many as its bars need: "d" for the count while it is on its way, "a" for the bars once it came
    await keep.get("e", 600_000, of(90));
    expect([keep.size, keep.weight]).toEqual([2, 100]);
    await keep.get("b", 600_000, of(10));
    expect(asked).toBe(6);
    keep.clear();
    expect([keep.size, keep.weight]).toEqual([0, 0]);
  });
});
