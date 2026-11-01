/** A COIN'S LONG PRICE HISTORY, from the venue that charts it (live/history-crypto.ts, feat/paper-live phase H), against stand-ins that answer
 * as each venue answered live on 2026-10-16 and 2026-10-17: Coinbase Exchange's candles (start and end both included, newest first, no 4h
 * and no week), OKX's history-candles (an `after` cursor, newest first, 1Dutc and 1Wutc, a swap's volume in contracts beside the coin's),
 * Hyperliquid's candleSnapshot (its latest 5,000 bars, its daily backfill with no trade), and the library's fetchOHLCV. The seams between
 * pages, where a history starts, what is folded and from what, and what each page says. Nothing leaves the process. */
import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { coinbaseHistory, coinbaseProduct, HL_KEEPS_WORDS, hyperliquidHistory, libraryHistory, libraryNative, MONDAY_WEEKS, okxHistory, okxInstrument, type HistoryHttp } from "../../src/portfolio/live/history-crypto.ts";
import { hlWeight, type Pace } from "../../src/portfolio/live/history.ts";
import { INTERVAL_MS, type Candle, type CandleInterval, type CandlePage } from "../../src/portfolio/live/trade.ts";
import type { Http, HttpReply } from "../../src/portfolio/live/types.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Saturday 17 October 2026, 07:03:30 UTC */
const NOW = Date.parse("2026-10-17T07:03:30Z");
const json = (body: unknown, status = 200): HttpReply => ({ status, body, text: JSON.stringify(body) });
const page = (r: CandlePage | Refusal): CandlePage => {
  if (isRefusal(r)) throw new Error(`refused: ${r.code} ${r.message}`);
  return r;
};
const refusal = (r: unknown): Refusal => {
  if (!isRefusal(r)) throw new Error(`expected a refusal, got ${JSON.stringify(r).slice(0, 160)}`);
  return r;
};
/** a bar's price on the stand-in's curve: a straight climb, so every bar is told apart */
const px = (t: number): number => 1_000 + t / HOUR / 100;
/** the lines a test waits in: none (each request's host and weight recorded) */
function paced() {
  const turns: Array<[string, number]> = [];
  const pace: Pace = async (host, cost = 1) => void turns.push([host, cost]);
  return { pace, turns };
}

/** COINBASE EXCHANGE as it answered live: GET /products/{id}/candles?granularity=&start=&end= — every bucket start from `start` to `end`,
 * both included, at most 300 of them ("Count of aggregations requested exceeds 300" past it), newest first, [time (s), low, high, open, close,
 * volume], none before the product's first bar; an unknown product 404 {"message":"NotFound"}; 14400 and 604800 "Unsupported granularity" */
function coinbase(o: { listed?: Record<string, number>; refuse?: (u: URL) => HttpReply | undefined; quiet?: (minute: number) => boolean; now?: number } = {}) {
  const listed = o.listed ?? { "BTC-USD": Date.parse("2015-07-20T00:00:00Z") };
  const now = o.now ?? NOW;
  const sent: URL[] = [];
  // a bucket has a bar where any of its minutes had a trade (a thin product's quiet minutes have none)
  const traded = (t: number, g: number): boolean => {
    if (!o.quiet) return true;
    for (let m = t; m < t + g && m <= now; m += MIN) if (!o.quiet(m)) return true;
    return false;
  };
  const http: Http = async (url) => {
    const u = new URL(url);
    sent.push(u);
    const own = o.refuse?.(u);
    if (own) return own;
    const m = /^\/products\/([^/]+)\/candles$/.exec(u.pathname);
    if (u.host !== "api.exchange.coinbase.com" || !m) return json({ message: "not here" }, 404);
    const from = listed[decodeURIComponent(m[1]!)];
    if (from === undefined) return json({ message: "NotFound" }, 404);
    const g = Number(u.searchParams.get("granularity")) * 1000;
    if (![60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000].includes(g)) return json({ message: "Unsupported granularity" }, 400);
    const start = Date.parse(u.searchParams.get("start")!);
    const end = Date.parse(u.searchParams.get("end")!);
    // the whole bucket starts from start to end, both included: an end inside a bucket (the page holding the bar still forming ends at
    // this second) counts that bucket once, as it answered live
    if (Math.floor((end - start) / g) + 1 > 300) return json({ message: "Count of aggregations requested exceeds 300" }, 400);
    const rows: number[][] = [];
    for (let t = Math.ceil(start / g) * g; t <= Math.min(end, now); t += g) if (t >= from && traded(t, g)) rows.push([t / 1000, px(t) - 1, px(t) + 2, px(t), px(t) + 1, 1.5]);
    return json(rows.reverse());
  };
  return { http, sent };
}
/** the candles requests a stand-in Coinbase was sent, as [granularity, start, end] */
const cbAsked = (sent: URL[]): Array<[number, number, number]> => sent.filter((u) => u.pathname.endsWith("/candles")).map((u) => [Number(u.searchParams.get("granularity")), Date.parse(u.searchParams.get("start")!), Date.parse(u.searchParams.get("end")!)]);
const deps = (http: Http, now = NOW): HistoryHttp & { turns: Array<[string, number]> } => {
  const p = paced();
  return { http, pace: p.pace, clock: () => now, turns: p.turns };
};

describe("Coinbase Exchange: a dollar pair's history, three hundred bars a page", () => {
  it("cuts the window into pages of 300 starts, start and end both included, newest first — the newest alone, then the rest at once — with no seam: every hour once, none twice", async () => {
    const cb = coinbase();
    const d = deps(cb.http);
    const since = NOW - 30 * DAY;
    const p = page(await coinbaseHistory(d, "coinbase", "BTC-USD", "1h", { since, limit: 5_000 }));
    const first = Math.ceil(since / HOUR) * HOUR;
    const last = Math.floor(NOW / HOUR) * HOUR;
    expect(p.bars).toHaveLength((last - first) / HOUR + 1);
    expect(p.bars.every((b, i) => b.t === first + i * HOUR)).toBe(true);
    expect(p.bars[0]).toEqual({ t: first, o: px(first), h: px(first) + 2, l: px(first) - 1, c: px(first) + 1, v: 1.5 });
    // three pages: its last 300 hours — the one holding the hour still forming ends at this second, so Coinbase's five-minute cache never
    // answers it (its URL is new each second) — the 300 before, and the rest
    const asked = cb.sent.map((u) => [u.searchParams.get("granularity"), Date.parse(u.searchParams.get("start")!), Date.parse(u.searchParams.get("end")!)]);
    expect(asked).toEqual([
      ["3600", last - 299 * HOUR, NOW],
      ["3600", last - 599 * HOUR, last - 300 * HOUR],
      ["3600", first, last - 600 * HOUR],
    ]);
    expect(d.turns).toEqual([["coinbase", 1], ["coinbase", 1], ["coinbase", 1]]);
    // the window reached its start and Coinbase's history goes on before it
    expect([p.more, p.ends, p.source]).toEqual([true, undefined, "Coinbase Exchange · BTC-USD"]);
  });

  it("a first view of more than HISTORY_MOST bars is the latest 5,000, with older ones said to exist; a page scrolled left before its first bar is ONE request of 300", async () => {
    const cb = coinbase();
    const p = page(await coinbaseHistory(deps(cb.http), "coinbase", "BTC-USD", "1m", { since: NOW - 365 * DAY, limit: 5_000, range: "1Y" }));
    expect([p.bars.length, p.more]).toEqual([5_000, true]);
    expect(cb.sent).toHaveLength(17);
    const before = p.bars[0]!.t;
    const n = cb.sent.length;
    const left = page(await coinbaseHistory(deps(cb.http), "coinbase", "BTC-USD", "1m", { until: before, limit: 300 }));
    expect(cb.sent.length - n).toBe(1);
    expect([Date.parse(cb.sent[n]!.searchParams.get("start")!), Date.parse(cb.sent[n]!.searchParams.get("end")!)]).toEqual([before - 300 * MIN, before - MIN]);
    expect([left.bars.length, left.bars[0]!.t, left.bars.at(-1)!.t, left.more]).toEqual([300, before - 300 * MIN, before - MIN, true]);
  });

  it("a page scrolled left of a folded size is up to four of Coinbase's pages, asked at once: 4h before the first bar is 1,200 hours — 300 bars a scroll, not one page's 75", async () => {
    const cb = coinbase();
    const until = Math.floor((NOW - 90 * DAY) / (4 * HOUR)) * 4 * HOUR;
    const left = page(await coinbaseHistory(deps(cb.http), "coinbase", "BTC-USD", "4h", { until, limit: 1_000 }));
    expect(cbAsked(cb.sent).map(([g]) => g)).toEqual([3600, 3600, 3600, 3600]);
    expect([left.bars.length, left.bars[0]!.t, left.bars.at(-1)!.t, left.more]).toEqual([300, until - 1_200 * HOUR, until - 4 * HOUR, true]);
  });

  it("the same first view read again — the chart's reconcile every minute — asks Coinbase for its newest page alone: a page whose bars have all closed is kept, and no other venue's or market's", async () => {
    const cb = coinbase({ listed: { "BTC-USD": Date.parse("2015-07-20T00:00:00Z"), "ETH-USD": Date.parse("2016-05-18T00:00:00Z") } });
    const d = deps(cb.http);
    const w = { since: NOW - 182 * DAY, limit: 5_000, range: "6M" as const };
    const first = page(await coinbaseHistory(d, "coinbase", "BTC-USD", "4h", w));
    const asked = cb.sent.length;
    expect(asked).toBe(15);
    const again = page(await coinbaseHistory(d, "coinbase", "BTC-USD", "4h", w));
    expect(cb.sent.length - asked).toBe(1);
    expect(again.bars).toEqual(first.bars);
    // another market at the same venue is its own
    page(await coinbaseHistory(d, "coinbase", "ETH-USD", "4h", w));
    expect(cb.sent.length - asked - 1).toBe(15);
  });

  it("where its history starts: three hundred days with no bar at the oldest end ends the asking, and the page says the day it starts; a page wholly before it says there is nothing older", async () => {
    const cb = coinbase();
    const p = page(await coinbaseHistory(deps(cb.http), "coinbase", "BTC-USD", "1d", { since: 0, limit: 5_000, range: "MAX" }));
    expect(p.bars[0]!.t).toBe(Date.parse("2015-07-20T00:00:00Z"));
    expect([p.more, p.ends]).toEqual([false, "Coinbase Exchange's BTC-USD history starts Mon 20 Jul 2015"]);
    // the newest page, then waves of ten until the oldest pages hold nothing for three hundred days and more: nothing older is asked, and no
    // coarser look is needed (MAX is the latest 5,000 days at most: seventeen pages)
    expect(cb.sent.length).toBeLessThanOrEqual(21);
    expect(Math.min(...cb.sent.map((u) => Date.parse(u.searchParams.get("start")!)))).toBeGreaterThan(Date.parse("2008-01-01T00:00:00Z"));
    const none = page(await coinbaseHistory(deps(cb.http), "coinbase", "BTC-USD", "1d", { until: Date.parse("2015-07-20T00:00:00Z"), limit: 300 }));
    expect([none.bars, none.more, none.ends]).toEqual([[], false, "Coinbase Exchange keeps no daily BTC-USD bars before Mon 20 Jul 2015"]);
  });

  it("no 4h and no week at Coinbase: folded from its own hourly and daily bars — weeks from Monday, UTC — the first bucket a whole one, and said so", async () => {
    const cb = coinbase();
    const four = page(await coinbaseHistory(deps(cb.http), "coinbase", "BTC-USD", "4h", { since: NOW - 2 * DAY, limit: 5_000 }));
    expect(cb.sent.every((u) => u.searchParams.get("granularity") === "3600")).toBe(true);
    expect(four.bars.every((b) => b.t % (4 * HOUR) === 0)).toBe(true);
    // 07:03 two days ago: the first whole four hours start at 08:00
    expect(new Date(four.bars[0]!.t).toISOString()).toBe("2026-10-15T08:00:00.000Z");
    const b0 = four.bars[0]!.t;
    expect(four.bars[0]).toEqual({ t: b0, o: px(b0), h: px(b0 + 3 * HOUR) + 2, l: px(b0) - 1, c: px(b0 + 3 * HOUR) + 1, v: 6 });
    expect(four.folded).toBe("4-hour bars folded from Coinbase Exchange's hourly bars");
    const weeks = page(await coinbaseHistory(deps(cb.http), "coinbase", "BTC-USD", "1w", { since: NOW - 30 * DAY, limit: 5_000 }));
    expect(weeks.bars.map((b) => new Date(b.t).toISOString().slice(0, 10))).toEqual(["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(new Date(weeks.bars[0]!.t).getUTCDay()).toBe(1);
    expect(weeks.folded).toBe("weekly bars folded from Coinbase Exchange's daily bars (weeks from Monday, UTC)");
    expect(cb.sent.filter((u) => u.searchParams.get("granularity") === "86400")).toHaveLength(1);
  });

  it("refusals in Coinbase's own words: a product it does not list (404 NotFound) is one request; the newest page refused is the answer; an older one refused ends the answer there, older bars said to exist", async () => {
    const cb = coinbase();
    const unknown = refusal(await coinbaseHistory(deps(cb.http), "coinbase", "ZZZ-USD", "1h", { since: NOW - 30 * DAY }));
    expect([unknown.code, unknown.message, cb.sent.length]).toEqual(["E_VENUE_REJECTED", "Coinbase Exchange lists no product ZZZ-USD", 1]);
    const limited = coinbase({ refuse: () => ({ status: 429, body: { message: "Public rate limit exceeded" }, text: '{"message":"Public rate limit exceeded"}' }) });
    expect(refusal(await coinbaseHistory(deps(limited.http), "coinbase", "BTC-USD", "1h", { since: NOW - 30 * DAY })).message).toMatch(/^Coinbase Exchange is rate-limiting this machine/);
    let n = 0;
    const second = coinbase({ refuse: () => (n++ === 1 ? json({ message: "Internal error" }, 503) : undefined) });
    const p = page(await coinbaseHistory(deps(second.http), "coinbase", "BTC-USD", "1h", { since: NOW - 30 * DAY }));
    expect([p.more, p.ends]).toEqual([true, undefined]);
    expect(p.bars.at(-1)!.t).toBe(Math.floor(NOW / HOUR) * HOUR);
    expect(coinbaseProduct("btc/usd")).toBe("BTC-USD");
    expect(coinbaseProduct("BTC")).toBeUndefined();
  });
});

/** OKX as it answered live: GET /api/v5/market/history-candles?instId=&bar=&after=&limit= — the bars strictly older than `after`, at most 300,
 * newest first, [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] as strings, the bar still forming with confirm "0"; an unknown
 * instrument code 51001 under HTTP 200; a lower-case 1h code 51000 */
function okx(listedFrom = Date.parse("2018-01-11T00:00:00Z"), now = NOW) {
  const sent: URL[] = [];
  const BARS: Record<string, number> = { "1m": MIN, "5m": 5 * MIN, "15m": 15 * MIN, "1H": HOUR, "4H": 4 * HOUR, "1Dutc": DAY, "1Wutc": 7 * DAY };
  const http: Http = async (url) => {
    const u = new URL(url);
    sent.push(u);
    if (u.host !== "www.okx.com" || u.pathname !== "/api/v5/market/history-candles") return json({ code: "50000", msg: "not here", data: [] });
    const id = u.searchParams.get("instId");
    if (id !== "BTC-USDT" && id !== "BTC-USDT-SWAP") return json({ code: "51001", msg: "Instrument ID, Instrument ID code, or Spread ID doesn't exist.", data: [] });
    const g = BARS[u.searchParams.get("bar")!];
    if (!g) return json({ code: "51000", msg: "Parameter bar error", data: [] });
    const after = Number(u.searchParams.get("after") ?? now + g);
    const limit = Math.min(300, Number(u.searchParams.get("limit") ?? 100));
    // a Monday-aligned week, UTC days
    const align = g === 7 * DAY ? 4 * DAY : 0;
    const rows: string[][] = [];
    for (let t = Math.floor((Math.min(after - 1, now) - align) / g) * g + align; t >= listedFrom && rows.length < limit; t -= g) rows.push([String(t), String(px(t)), String(px(t) + 2), String(px(t) - 1), String(px(t) + 1), "250", "2.5", "212500", t + g > now ? "0" : "1"]);
    return json({ code: "0", msg: "", data: rows });
  };
  return { http, sent };
}

describe("Coinbase Exchange: a thin product's pages with no trade", () => {
  const last = Math.floor(NOW / MIN) * MIN;
  /** a product whose pages of minutes, newest first, hold the first `n` minutes counted from each page's end: CHECK-USD's day on 2026-10-17
   * held 11, 0, 0, 6 and 4; every page before them full */
  const thin = (held: number[]) => (t: number): boolean => {
    const k = Math.floor((last - t) / (300 * MIN));
    const n = held[k] ?? 300;
    return (last - k * 300 * MIN - t) / MIN >= n;
  };

  it("an empty page between pages with bars is a stretch with no trade, said as a gap — every page of the wave kept, older bars said to exist, no end of the history", async () => {
    const cb = coinbase({ listed: { "CHECK-USD": Date.parse("2024-01-01T00:00:00Z") }, quiet: thin([11, 0, 0, 6, 4]) });
    const p = page(await coinbaseHistory(deps(cb.http), "coinbase", "CHECK-USD", "1m", { since: NOW - DAY, limit: 5_000, range: "1D" }));
    expect(p.bars).toHaveLength(21);
    expect([p.more, p.ends, p.partial]).toEqual([true, undefined, undefined]);
    // the two quiet pages, from the older's start to the newer's end
    expect(p.gaps).toEqual([{ from: last - 899 * MIN, to: last - 299 * MIN, why: "No trades at Coinbase Exchange" }]);
    // five pages, no look before them: the window's oldest page has bars
    expect(cbAsked(cb.sent)).toHaveLength(5);
  });

  it("a stretch with no trade at the window's oldest end: Coinbase's own hourly candles before it find a trade, so older bars exist — never \"the history starts\"", async () => {
    const cb = coinbase({ listed: { "CHECK-USD": Date.parse("2024-01-01T00:00:00Z") }, quiet: thin([300, 300, 300, 300, 0, 0]) });
    const p = page(await coinbaseHistory(deps(cb.http), "coinbase", "CHECK-USD", "1m", { since: NOW - DAY, limit: 5_000, range: "1D" }));
    expect([p.more, p.ends]).toEqual([true, undefined]);
    // five pages, then one look in hours over the 300 hours before the quiet page
    const asked = cbAsked(cb.sent);
    expect(asked.map(([g]) => g)).toEqual([60, 60, 60, 60, 60, 3600]);
  });

  it("where the history does start inside the window: its hours and then its days before the quiet pages find nothing, and the page says the day it starts", async () => {
    const listed = Math.floor((NOW - 2 * HOUR) / MIN) * MIN;
    const cb = coinbase({ listed: { "NEW-USD": listed } });
    const p = page(await coinbaseHistory(deps(cb.http), "coinbase", "NEW-USD", "1m", { since: NOW - DAY, limit: 5_000, range: "1D" }));
    expect(p.bars[0]!.t).toBe(listed);
    expect([p.more, p.ends]).toEqual([false, "Coinbase Exchange's NEW-USD history starts Sat 17 Oct 2026"]);
    expect(cbAsked(cb.sent).map(([g]) => g)).toEqual([60, 60, 60, 60, 60, 3600, 86400]);
  });

  it("a page scrolled left that holds no trade is asked again where Coinbase's hourly candles found the next older one: it brings bars, the quiet stretch after them said as a gap, older bars said to exist", async () => {
    const until = last - 600 * MIN;
    // nothing traded in the seven hours before `until`
    const cb = coinbase({ listed: { "CHECK-USD": Date.parse("2024-01-01T00:00:00Z") }, quiet: (t) => t >= until - 7 * HOUR && t < until });
    const p = page(await coinbaseHistory(deps(cb.http), "coinbase", "CHECK-USD", "1m", { until, limit: 300 }));
    // the hour the look found a trade in ends the page asked again: its 300 minutes, those with a trade
    const seenEnd = Math.floor((until - 7 * HOUR - 1) / HOUR) * HOUR + HOUR;
    const newest = p.bars.at(-1)!.t;
    expect(newest).toBe(until - 7 * HOUR - MIN);
    expect([p.bars[0]!.t, p.bars.length]).toEqual([seenEnd - 300 * MIN, (newest - (seenEnd - 300 * MIN)) / MIN + 1]);
    expect([p.more, p.ends, p.gaps]).toEqual([true, undefined, [{ from: newest + MIN, to: until, why: "No trades at Coinbase Exchange" }]]);
    // the page, one look in hours, the page again
    expect(cbAsked(cb.sent).map(([g]) => g)).toEqual([60, 3600, 60]);
  });

  it("a folded first view is sized in Coinbase's own bars: 4h over five years is its latest 5,000 hours, seventeen requests, with older ones said to exist", async () => {
    const cb = coinbase();
    const p = page(await coinbaseHistory(deps(cb.http), "coinbase", "BTC-USD", "4h", { since: NOW - 1826 * DAY, limit: 5_000, range: "5Y" }));
    expect(cbAsked(cb.sent)).toHaveLength(17);
    expect(p.more).toBe(true);
    expect(p.bars.length).toBe(1_250);
  });
});

describe("OKX: a USDT pair's or a swap's history, by the `after` cursor", () => {
  it("each page asks the bars older than its end, three hundred at most — 1H, 1Dutc and 1Wutc, never the UTC+8 1D or 1W — and a swap's volume is the coin's, not its contracts'", async () => {
    const o = okx();
    const d = deps(o.http);
    const p = page(await okxHistory(d, "okx", "BTC-USDT-SWAP", "1h", { since: NOW - 20 * DAY, limit: 5_000 }));
    const last = Math.floor(NOW / HOUR) * HOUR;
    expect(o.sent.map((u) => [u.searchParams.get("bar"), Number(u.searchParams.get("after")), u.searchParams.get("limit")])).toEqual([
      ["1H", last + HOUR, "300"],
      ["1H", last - 299 * HOUR, "300"],
    ]);
    expect(d.turns.every(([h]) => h === "okx")).toBe(true);
    expect(p.bars.every((b, i) => i === 0 || b.t - p.bars[i - 1]!.t === HOUR)).toBe(true);
    expect(p.bars.at(-1)).toEqual({ t: last, o: px(last), h: px(last) + 2, l: px(last) - 1, c: px(last) + 1, v: 2.5 });
    const spot = page(await okxHistory(deps(o.http), "okx", "BTC-USDT", "1d", { since: NOW - 10 * DAY }));
    expect(o.sent.at(-1)!.searchParams.get("bar")).toBe("1Dutc");
    expect(spot.bars.at(-1)!.v).toBe(250);
    await okxHistory(deps(o.http), "okx", "BTC-USDT", "1w", { since: NOW - 60 * DAY });
    expect(o.sent.at(-1)!.searchParams.get("bar")).toBe("1Wutc");
    expect([okxInstrument("BTC/USDT:USDT"), okxInstrument("BTC/USDT"), okxInstrument("BTC-USDT-SWAP"), okxInstrument("BTC/USDT:BTC")]).toEqual(["BTC-USDT-SWAP", "BTC-USDT", "BTC-USDT-SWAP", undefined]);
  });

  it("all of it: page after page until one comes back empty, where the page says OKX's history starts; an instrument it does not list is its own words", async () => {
    const o = okx();
    const p = page(await okxHistory(deps(o.http), "okx", "BTC-USDT", "1d", { since: 0, limit: 5_000, range: "MAX" }));
    expect(new Date(p.bars[0]!.t).toISOString().slice(0, 10)).toBe("2018-01-11");
    expect([p.more, p.ends]).toEqual([false, "OKX's BTC-USDT history starts Thu 11 Jan 2018"]);
    const unknown = refusal(await okxHistory(deps(o.http), "okx", "ZZZ-USDT", "1h", { since: NOW - DAY }));
    expect([unknown.code, unknown.message]).toEqual(["E_VENUE_REJECTED", "OKX lists no instrument ZZZ-USDT"]);
  });
});

describe("weeks paged on their own Monday", () => {
  /** Monday 19 October 2026, 10:00 UTC: the week forming began today */
  const MON = Date.parse("2026-10-19T10:00:00Z");
  const mondays = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (let t = from; t <= to; t += 7 * DAY) out.push(t);
    return out;
  };

  it("OKX's 1Wutc over all of it on a Monday: the week forming today is there, and no week is missing at a seam between pages", async () => {
    const o = okx(Date.parse("2018-01-15T00:00:00Z"), MON);
    const p = page(await okxHistory(deps(o.http, MON), "okx", "BTC-USDT", "1w", { since: 0, limit: 5_000, range: "MAX" }));
    const want = mondays(Date.parse("2018-01-15T00:00:00Z"), Date.parse("2026-10-19T00:00:00Z"));
    expect(p.bars.map((b) => b.t)).toEqual(want);
    expect(p.bars.every((b) => new Date(b.t).getUTCDay() === 1)).toBe(true);
    // every page's `after` a Monday: its seams on OKX's own weeks
    expect(o.sent.every((u) => new Date(Number(u.searchParams.get("after"))).getUTCDay() === 1)).toBe(true);
  });

  it("the library's weeks from each page's own Monday, forward: no week lost at a seam, the forming one kept — and only where the exchange's weeks are Monday's; Kraken's Thursday weeks are folded from its days", async () => {
    const listed = Date.parse("2017-08-14T00:00:00Z");
    const x = {
      timeframes: { "1d": "1d", "1w": "1w" },
      async fetchOHLCV(_s: string, tf: string, since: number, limit: number) {
        const g = INTERVAL_MS[tf as CandleInterval];
        // Monday weeks: the first at or after `since`
        const first = tf === "1w" ? Math.ceil((since - 4 * DAY) / g) * g + 4 * DAY : Math.ceil(since / g) * g;
        return Array.from({ length: limit }, (_, i) => first + i * g).filter((t) => t >= listed && t <= MON).map((t) => [t, px(t), px(t) + 2, px(t) - 1, px(t) + 1, 3]);
      },
    };
    expect([libraryNative(x, "1w", true), libraryNative(x, "1w"), libraryNative(x, "1w", MONDAY_WEEKS.has("kraken")), MONDAY_WEEKS.has("binance")]).toEqual(["1w", "1d", "1d", true]);
    const o = { name: "Binance", symbol: "BTC/USDT", inCoin: true, pageBars: 300, clock: () => MON, no: (err: unknown) => no("E_VENUE_UNREACHABLE", { venue: "binance", message: String(err) }) };
    const p = page(await libraryHistory(x, o, "1w", "1w", { since: 0, limit: 5_000, range: "MAX" }));
    expect(p.bars.map((b) => b.t)).toEqual(mondays(listed, Date.parse("2026-10-19T00:00:00Z")));
    expect([p.more, p.ends]).toEqual([false, "Binance's BTC/USDT history starts Mon 14 Aug 2017"]);
  });

  it("a library page with no bar between pages with bars is a stretch with none, not the start: the pages before it are kept", async () => {
    // ten quiet hours: two whole pages of 300 minutes hold no bar
    const quiet = (t: number) => t >= NOW - 900 * MIN && t < NOW - 300 * MIN;
    const x = {
      timeframes: { "1m": "1m" },
      async fetchOHLCV(_s: string, _tf: string, since: number, limit: number) {
        const out: number[][] = [];
        // forward from `since`, `limit` bars at most: a quiet minute has none, so the count runs past the page's end
        for (let t = since; out.length < limit && t <= NOW; t += MIN) if (!quiet(t)) out.push([t, px(t), px(t) + 2, px(t) - 1, px(t) + 1, 3]);
        return out;
      },
    };
    const o = { name: "Bybit", symbol: "BTC/USDT", inCoin: true, pageBars: 300, clock: () => NOW, no: (err: unknown) => no("E_VENUE_UNREACHABLE", { venue: "bybit", message: String(err) }) };
    const p = page(await libraryHistory(x, o, "1m", "1m", { since: NOW - DAY, limit: 5_000, range: "1D" }));
    expect(p.bars.some((b) => b.t < NOW - 900 * MIN)).toBe(true);
    expect([p.more, p.ends]).toEqual([true, undefined]);
    const last = Math.floor(NOW / MIN) * MIN;
    expect(p.gaps).toEqual([{ from: last - 899 * MIN, to: last - 299 * MIN, why: "No trades at Bybit" }]);
  });
});

/** HYPERLIQUID'S candleSnapshot as it answered live: everything in the window, oldest first, ONLY from its latest ~5,000 bars at that size;
 * its daily bars before 2023-02-26 with v 0 and n 0 */
function hyperliquid() {
  const asked: Array<{ coin: string; interval: CandleInterval; startTime: number; endTime: number }> = [];
  const traded = Date.parse("2023-02-26T00:00:00Z");
  const ask = async (req: { coin: string; interval: CandleInterval; startTime: number; endTime: number }): Promise<unknown> => {
    asked.push(req);
    const g = INTERVAL_MS[req.interval];
    const keepsFrom = Math.floor(NOW / g) * g - 4_999 * g;
    const backfillFrom = Date.parse("2020-08-19T00:00:00Z");
    const out: Array<Record<string, unknown>> = [];
    for (let t = Math.max(Math.ceil(req.startTime / g) * g, keepsFrom, req.interval === "1d" ? backfillFrom : 0); t <= Math.min(req.endTime, NOW); t += g) {
      const backfill = req.interval === "1d" && t < traded;
      out.push({ t, T: t + g - 1, s: req.coin, i: req.interval, o: String(px(t)), c: String(px(t) + 1), h: String(px(t) + 2), l: String(px(t) - 1), v: backfill ? "0.0" : "12.5", n: backfill ? 0 : 400 });
    }
    return out;
  };
  return { ask, asked };
}

describe("Hyperliquid: one snapshot within its latest 5,000 bars", () => {
  it("one request for the window, weighed 20 and one per 60 bars; its daily bars with no trade (its backfill before 2023-02-26) never drawn, and the page says when its trading starts", async () => {
    const h = hyperliquid();
    const p = paced();
    const daily = page(await hyperliquidHistory(h.ask, p.pace, () => NOW, "Hyperliquid", "BTC", "1d", { since: 0, limit: 5_000, range: "MAX" }));
    expect(h.asked).toHaveLength(1);
    expect(p.turns).toEqual([["hyperliquid", hlWeight(5_000)]]);
    expect(new Date(daily.bars[0]!.t).toISOString().slice(0, 10)).toBe("2023-02-26");
    expect(daily.bars.every((b) => b.v === 12.5)).toBe(true);
    expect([daily.more, daily.ends, daily.source]).toEqual([false, "Hyperliquid's BTC trading starts Sun 26 Feb 2023", "Hyperliquid · BTC perpetual"]);
    // its own weeks start on Thursday: a week is folded from its days, from Monday
    const weeks = page(await hyperliquidHistory(h.ask, p.pace, () => NOW, "Hyperliquid", "BTC", "1w", { since: Date.parse("2026-09-01T00:00:00Z") }));
    expect(h.asked.at(-1)!.interval).toBe("1d");
    expect(weeks.bars.every((b) => new Date(b.t).getUTCDay() === 1)).toBe(true);
    expect(weeks.folded).toMatch(/^weekly bars folded from Hyperliquid's daily bars \(weeks from Monday, UTC; its own weeks start on Thursday\)$/);
  });

  it("a page asked before its latest 5,000 brings nothing and says so; a window inside them says older bars exist", async () => {
    const h = hyperliquid();
    const p = paced();
    const day = page(await hyperliquidHistory(h.ask, p.pace, () => NOW, "Hyperliquid", "BTC", "1m", { since: NOW - DAY, limit: 5_000, range: "1D" }));
    expect([day.bars.length, day.more, day.interval]).toEqual([1_440, true, undefined]);
    const before = page(await hyperliquidHistory(h.ask, p.pace, () => NOW, "Hyperliquid", "BTC", "1m", { until: NOW - 6 * DAY, limit: 300 }));
    expect([before.bars, before.more, before.ends]).toEqual([[], false, HL_KEEPS_WORDS]);
    expect(HL_KEEPS_WORDS).toBe("Hyperliquid keeps only the latest 5,000 bars at this size");
  });

  it("a range its 5,000 bars at the size asked do not reach is drawn in the finest size whose 5,000 do, and says why", async () => {
    const h = hyperliquid();
    const p = page(await hyperliquidHistory(h.ask, paced().pace, () => NOW, "Hyperliquid", "BTC", "1m", { since: NOW - 365 * DAY, limit: 5_000, range: "1Y" }));
    expect(h.asked.map((a) => a.interval)).toEqual(["4h"]);
    expect([p.interval, p.note]).toEqual(["4h", "Hyperliquid keeps only the latest 5,000 bars at this size: 1-minute bars do not reach back 1Y, so it is drawn in 4-hour bars"]);
    expect(p.bars.length).toBe(Math.floor(NOW / (4 * HOUR)) - Math.ceil((NOW - 365 * DAY) / (4 * HOUR)) + 1);
    // a range they reach is drawn as asked
    await hyperliquidHistory(h.ask, paced().pace, () => NOW, "Hyperliquid", "BTC", "1h", { since: NOW - 30 * DAY, limit: 5_000, range: "1M" });
    expect(h.asked.at(-1)!.interval).toBe("1h");
  });
});

describe("Hyperliquid: quiet bars, and where a market's bars start", () => {
  /** a snapshot answering every interval in the window from `from`, the traded ones where `traded(t)`, the rest flat with n 0 */
  const snap = (from: number, traded: (t: number) => boolean) => async (req: { coin: string; interval: CandleInterval; startTime: number; endTime: number }): Promise<unknown> => {
    const g = INTERVAL_MS[req.interval];
    const out: Array<Record<string, unknown>> = [];
    for (let t = Math.max(Math.ceil(req.startTime / g) * g, from); t <= Math.min(req.endTime, NOW); t += g) {
      const n = traded(t) ? 7 : 0;
      out.push({ t, T: t + g - 1, s: req.coin, i: req.interval, o: String(px(t)), c: String(px(t) + (n ? 1 : 0)), h: String(px(t) + (n ? 2 : 0)), l: String(px(t) - (n ? 1 : 0)), v: n ? "3.5" : "0.0", n });
    }
    return out;
  };

  it("a thin perpetual's quiet minutes (n 0, flat) are never drawn, and are no backfill: its day is its traded minutes, older bars still said to exist, no start said", async () => {
    // NOT-PERP on 2026-10-17: 1,345 of its day's 1,439 minutes with no trade — the first ones among them
    const ask = snap(Date.parse("2024-01-01T00:00:00Z"), (t) => (t / MIN) % 15 === 7);
    const p = page(await hyperliquidHistory(ask, paced().pace, () => NOW, "Hyperliquid", "NOT", "1m", { since: NOW - DAY, limit: 5_000, range: "1D" }));
    expect(p.bars.length).toBe(96);
    expect(p.bars.every((b) => (b.t / MIN) % 15 === 7 && b.v === 3.5)).toBe(true);
    expect([p.more, p.ends]).toEqual([true, undefined]);
  });

  it("a market whose bars start inside its latest 5,000 says its trading starts there, not that Hyperliquid keeps only 5,000; a window older than those 5,000 says that", async () => {
    // HYPE's daily bars from 2024-12-05, every one traded
    const hype = snap(Date.parse("2024-12-05T00:00:00Z"), () => true);
    const five = page(await hyperliquidHistory(hype, paced().pace, () => NOW, "Hyperliquid", "HYPE", "1d", { since: NOW - 1826 * DAY, limit: 5_000, range: "5Y" }));
    expect([five.more, five.ends]).toEqual([false, "Hyperliquid's HYPE trading starts Thu 5 Dec 2024"]);
    const weeks = page(await hyperliquidHistory(hype, paced().pace, () => NOW, "Hyperliquid", "HYPE", "1w", { since: 0, limit: 5_000, range: "MAX" }));
    expect(weeks.ends).toBe("Hyperliquid's HYPE trading starts Thu 5 Dec 2024");
    // a page of minutes before its latest 5,000: the edge of what Hyperliquid keeps
    const minutes = snap(Math.floor(NOW / MIN) * MIN - 4_999 * MIN, () => true);
    const old = page(await hyperliquidHistory(minutes, paced().pace, () => NOW, "Hyperliquid", "HYPE", "1m", { since: NOW - 4 * DAY, limit: 5_000 }));
    expect([old.more, old.ends]).toEqual([false, HL_KEEPS_WORDS]);
  });

  it("BTC's daily backfill before its trading only where its bars start inside the window: 5Y opens on backfill and says no start (older bars exist), and draws none of it", async () => {
    const h = hyperliquid();
    const five = page(await hyperliquidHistory(h.ask, paced().pace, () => NOW, "Hyperliquid", "BTC", "1d", { since: NOW - 1826 * DAY, limit: 5_000, range: "5Y" }));
    expect(new Date(five.bars[0]!.t).toISOString().slice(0, 10)).toBe("2023-02-26");
    expect([five.more, five.ends]).toEqual([true, undefined]);
  });
});

describe("the library: any other exchange, page by page", () => {
  it("fetchOHLCV from each page's start, forward; a size it does not publish folded from a finer one; a throw for the newest page is the exchange's refusal, for an older one the end of the answer", async () => {
    const calls: Array<[string, number, number]> = [];
    let fail = -1;
    const x = {
      timeframes: { "1m": "1m", "1h": "1h", "1d": "1d" },
      async fetchOHLCV(_s: string, tf: string, since: number, limit: number) {
        calls.push([tf, since, limit]);
        if (calls.length - 1 === fail) throw new Error("binance GET https://api.binance.com/api/v3/klines 503 Service Unavailable");
        const g = INTERVAL_MS[tf as CandleInterval];
        return Array.from({ length: limit }, (_, i) => since + i * g).filter((t) => t <= NOW).map((t) => [t, px(t), px(t) + 2, px(t) - 1, px(t) + 1, 3]);
      },
    };
    expect([libraryNative(x, "4h"), libraryNative(x, "1h"), libraryNative(x, "5m")]).toEqual(["1h", "1h", undefined]);
    const o = { name: "Binance", symbol: "BTC/USDT", inCoin: true, pageBars: 1_000, clock: () => NOW, no: (err: unknown) => no("E_VENUE_UNREACHABLE", { venue: "binance", message: `Binance did not answer: ${String((err as Error).message).slice(0, 40)}` }) };
    const four = page(await libraryHistory(x, o, "4h", "1h", { since: NOW - 3 * DAY }));
    expect(calls.map(([tf]) => tf)).toEqual(["1h"]);
    expect(four.bars.every((b) => b.t % (4 * HOUR) === 0 && b.v === 12)).toBe(true);
    expect(four.folded).toBe("4-hour bars folded from Binance's hourly bars");
    calls.length = 0;
    fail = 0;
    expect(refusal(await libraryHistory(x, o, "1m", "1m", { since: NOW - 3 * DAY })).message).toMatch(/^Binance did not answer/);
    calls.length = 0;
    fail = 1;
    const cut = page(await libraryHistory(x, o, "1m", "1m", { since: NOW - 3 * DAY }));
    expect([cut.more, cut.bars.length, cut.bars.at(-1)!.t]).toEqual([true, 1_000, Math.floor(NOW / MIN) * MIN]);
  });
});

describe("one series, one venue", () => {
  it("every page names the one venue and market its bars are from", async () => {
    const cb = coinbase();
    const o = okx();
    const pages: CandlePage[] = [
      page(await coinbaseHistory(deps(cb.http), "kraken", "BTC-USD", "1h", { since: NOW - DAY })),
      page(await coinbaseHistory(deps(cb.http), "kraken", "BTC-USD", "1h", { until: NOW - DAY, limit: 300 })),
      page(await okxHistory(deps(o.http), "okx", "BTC-USDT", "1h", { since: NOW - DAY })),
    ];
    expect(pages.map((p) => p.source)).toEqual(["Coinbase Exchange · BTC-USD", "Coinbase Exchange · BTC-USD", "OKX · BTC-USDT"]);
    const all: Candle[] = [...pages[1]!.bars, ...pages[0]!.bars];
    expect(new Set(all.map((b) => b.t)).size).toBe(all.length);
  });
});
