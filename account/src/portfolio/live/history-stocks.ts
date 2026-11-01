/** A US STOCK'S LONG PRICE HISTORY, keyless (feat/paper-live phase H; checked live 2026-10-16 and again 2026-10-17 from this machine:
 * history-stocks-live.md, history-sources.md). None of these sources sends CORS for another site, so the service asks them, never the page.
 *
 *   Robinhood   GET api.robinhood.com/marketdata/historicals/{SYM}/?interval=&span=&bounds= — {symbol, interval, span, bounds, …,
 *               historicals: [{begins_at (UTC), open_price, close_price, high_price, low_price (strings), volume, session pre|reg|post,
 *               interpolated}]}. Real bars with the session each is in, in fixed windows that do not page (start and end are ignored):
 *                 1m   minute/day/extended        the latest session from 04:00 New York (960 bars on Fri 2026-10-16, 166 interpolated)
 *                 5m   5minute/week/extended      the latest five sessions, 04:00–20:00; 15m folded from them
 *                 1h   hour/month/extended        a month, 04:00–20:00; for 3M (and a page scrolled left past the month) hour/3month/regular
 *                                                 — 6 bars a day stamped 10:00 to 15:00 New York (14:00–19:00Z in summer, AAPL 2026-10-17),
 *                                                 so 10:00–16:00: Robinhood's regular-session hours leave out 09:30–10:00 (each day's first
 *                                                 hourly open is its 10:00 five-minute open), and every session says that half hour as a gap
 *                                                 (3month is refused with extended bounds); 4h folded from either, New York buckets from 04:00
 *                 1d   day/year, day/5year        regular-session days, split-adjusted (NVDA 2024-06-07 is 120.888), not dividend-adjusted
 *               A bar marked interpolated is Robinhood's filler — overnight with bounds=24_7 (never asked), a minute with no trade, and the
 *               day not yet closed in its daily list (Fri 2026-10-16 on the Saturday after: interpolated, volume 0, flat at the close before)
 *               — and is never drawn. Today's daily bar, which no daily source has, is built from the session's own regular-session minutes
 *               and said so ("Today so far")
 *   Nasdaq      GET api.nasdaq.com/api/quote/{SYM}/chart?assetclass=stocks|etf&fromdate=&todate= (us-quotes.ts Nasdaq.daily, with the browser
 *               headers it already sends): daily bars back to 1990 or an ETF's start in one call (AAPL 9,266 days, 9.7 s), any window of
 *               dates — the source for MAX and for every page scrolled left before a chart's first day. A day whose open it gives as 0 (485 of
 *               AAPL's, nearly all of 1990 and 1991) is left out and said
 *   Cboe        GET cdn-api.cboe.com/api/global/delayed_quotes/charts/historical/{SYM}.json (public-stocks.ts): every day since 2004 in one
 *               file — the daily fallback where Robinhood and Nasdaq both refuse. Its rows on days the market was closed (2025-05-26 copies
 *               05-23) and its repeated dates (SPY 2024-12-31) are left out, and its volume from 2021-10-15 to 2022-06-17 (about 45% of the
 *               consolidated figure) is Nasdaq's for that stretch, or none where Nasdaq does not answer. Its month of ten-minute
 *               regular-session bars (charts/one_month, 15 minutes late) is the hourly and four-hour fallback, and its minutes with
 *               Nasdaq's one-price-a-minute samples the finer one, the latest session only
 *
 * Every page says its source, that its prices are split-adjusted and not dividend-adjusted, and which hours it covers. The overnight
 * session (20:00–04:00 New York, Sunday to Thursday night) has no real keyless bars: an extended-hours series says each such night as a gap
 * ("No overnight data"), and never fills it. Robinhood's windows are fixed and do not page: a range a window at the size asked does not
 * reach is drawn in the finest size whose window does — minutes only for 1D, five and fifteen minutes up to 5D, hours up to three months,
 * days for anything longer — said in `interval` and `note` (as Hyperliquid's latest 5,000 are: history-crypto.ts); where a window still does
 * not reach a range's start, the page says where intraday history starts; a page scrolled left past it brings nothing, and says so — from
 * the window the view was drawn from (a page before the latest month's hours asks the three months'). Daily history pages left by dates at Nasdaq. Answers are kept
 * in a small bounded memory (live/history.ts HistoryKeep): a session's minutes fifteen seconds, the other intraday windows a minute, daily
 * bars ten minutes. Nothing is written anywhere */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { et, fromEt, isMarketDay, marketSession } from "../account/calendar.ts";
import { no } from "../refuse.ts";
import { foldBars, historyKeep, INTERVAL_WORDS, limitOf, nyClock, nyDay, overnightGaps, pageOf, sessionsSince, type Pace } from "./history.ts";
import { publicNo } from "./public-markets.ts";
import { INTERVAL_MS, type Candle, type CandleInterval, type CandlePage, type CandleWindow } from "./trade.ts";
import { unreachable, type Http } from "./types.ts";
import type { Nasdaq } from "./us-quotes.ts";

export const ROBINHOOD_HISTORICALS = "https://api.robinhood.com/marketdata/historicals";
export const SPLIT_ONLY = "split-adjusted, not dividend-adjusted";
export const EXTENDED_HOURS = "pre-market, regular and after-hours, 04:00–20:00 New York · no overnight data";
export const REGULAR_ONLY = "regular session only, 09:30–16:00 New York";
/** Robinhood's hourly regular-session bars (hour/3month/regular): stamped 10:00 to 15:00, its half hour from the open left out */
export const REGULAR_FROM_TEN = "regular session, 10:00–16:00 New York: Robinhood's regular-session hours leave out 09:30–10:00";
export const LATE_OPEN_WORDS = "No bars 09:30–10:00 New York: Robinhood's hourly regular-session bars start at 10:00";
export const REGULAR_DAYS = "regular-session daily bars";
const DAY = 86_400_000;
/** how long each kind of answer is kept (see the top of this file) */
const SESSION_KEEP_MS = 15_000;
const INTRADAY_KEEP_MS = 60_000;
const DAILY_KEEP_MS = 600_000;
/** how long one Robinhood page may take */
const ROBINHOOD_MS = 8_000;
/** Cboe's volume is short from here to there (history-sources.md: about 45% of the consolidated volume) */
const CBOE_SHORT_FROM = fromEt(2021, 10, 15, 9, 30);
const CBOE_SHORT_TO = fromEt(2022, 6, 17, 9, 30);

type RhInterval = "minute" | "5minute" | "hour" | "day";
type RhSpan = "day" | "week" | "month" | "3month" | "year" | "5year";
type RhBounds = "extended" | "regular";
/** a bar with the session Robinhood says it is in */
type SessionBar = Candle & { session?: string | undefined };

export interface StockHistoryDeps {
  /** the network through the fixed-host guard */
  http: Http;
  pace: Pace;
  clock: () => number;
  /** Nasdaq as the US stocks line reads it (its memory of each symbol's class, its hold after a refusal), for daily bars by dates */
  nasdaq: Nasdaq;
  /** Cboe's every day since 2004, as public-stocks.ts reads and keeps it (its own non-trading days and repeated dates already left out) */
  cboeDaily: (symbol: string) => Promise<Candle[] | Refusal>;
  /** the latest session's minutes where Robinhood refuses: Cboe's real minutes and Nasdaq's samples, merged (public-stocks.ts) */
  minutes: (symbol: string) => Promise<Candle[] | Refusal>;
  /** Cboe's last month of ten-minute regular-session bars (public-stocks.ts, charts/one_month), each at its start: the hourly and four-hour
   * fallback where Robinhood refuses (absent: none) */
  month?: ((symbol: string) => Promise<Candle[] | Refusal>) | undefined;
}

const fin = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const ymd = (ms: number): string => {
  const e = et(ms);
  return `${e.y}-${String(e.m).padStart(2, "0")}-${String(e.d).padStart(2, "0")}`;
};
const sameNyDate = (a: number, b: number): boolean => ymd(a) === ymd(b);

/** A US STOCK'S HISTORY (see the top of this file): `symbol` a plain ticker the caller has checked (AAPL, BRK.B) */
export function stockHistory(d: StockHistoryDeps, venue: string): (symbol: string, interval: CandleInterval, w: CandleWindow) => Promise<CandlePage | Refusal> {
  // Robinhood's windows, and Nasdaq's days by dates: each its own small memory, bounded by answers and by bars
  const keep = historyKeep<SessionBar[]>({ entries: 32, most: 60_000, weigh: (v) => v.length, clock: d.clock });
  const keepDays = historyKeep<{ bars: Candle[]; noOpen: number; lastNoOpen?: number | undefined } | null>({ entries: 16, most: 80_000, weigh: (v) => (v === null ? 1 : v.bars.length), clock: d.clock });

  /** one Robinhood window: its real bars, the interpolated ones left out, a day stamped at its session's open */
  const robinhood = (sym: string, interval: RhInterval, span: RhSpan, bounds: RhBounds): Promise<SessionBar[] | Refusal> => {
    const url = `${ROBINHOOD_HISTORICALS}/${encodeURIComponent(sym)}/?interval=${interval}&span=${span}&bounds=${bounds}`;
    const ttl = span === "day" ? SESSION_KEEP_MS : interval === "day" ? DAILY_KEEP_MS : INTRADAY_KEEP_MS;
    return keep.get(url, ttl, async () => {
      await d.pace("robinhood");
      let r;
      try {
        r = await d.http(url, { timeoutMs: ROBINHOOD_MS });
      } catch (err) {
        return unreachable(venue, "Robinhood", err);
      }
      if (r.status === 404) return no("E_VENUE_REJECTED", { venue, message: `Robinhood keeps no history of ${sym}`, native: { status: 404 } });
      const body = r.body as { historicals?: unknown } | undefined;
      if (r.status !== 200 || !body || !Array.isArray(body.historicals)) return publicNo(venue, "Robinhood", r);
      const out: SessionBar[] = [];
      for (const x of body.historicals as Array<Record<string, unknown>>) {
        if (!x || typeof x !== "object" || x.interpolated !== false) continue;
        const at = Date.parse(String(x.begins_at ?? ""));
        const [o, h, l, c, v] = [fin(x.open_price), fin(x.high_price), fin(x.low_price), fin(x.close_price), fin(x.volume)];
        if (!Number.isFinite(at) || o === undefined || h === undefined || l === undefined || c === undefined || !(o > 0 && h > 0 && l > 0 && c > 0)) continue;
        // a day's bar is dated in UTC (2021-10-18T00:00:00Z): stamped at that date's open, 09:30 New York, as every daily bar here is
        const day = new Date(at);
        const t = interval === "day" ? fromEt(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 9, 30) : at;
        out.push({ t, o, h, l, c, ...(v !== undefined && v >= 0 ? { v } : {}), ...(typeof x.session === "string" ? { session: x.session } : {}) });
      }
      return out.sort((a, b) => a.t - b.t);
    });
  };

  /** Nasdaq's daily bars between two New York dates, kept ten minutes (each GET waits in Nasdaq's line there: us-quotes.ts nasdaqSource) */
  const nasdaqDays = (sym: string, from: string, to: string) => keepDays.get(`${sym}|${from}|${to}`, DAILY_KEEP_MS, () => d.nasdaq.daily(sym, from, to));

  /** the latest session's daily bar, built from its regular-session minutes, where the daily bars do not have that day yet */
  const todayFrom = async (sym: string, days: Candle[], now: number): Promise<{ bar: Candle; words: string } | undefined> => {
    const minutes = await robinhood(sym, "minute", "day", "extended");
    if (isRefusal(minutes)) return undefined;
    const reg = minutes.filter((b) => b.session === "reg");
    if (!reg.length) return undefined;
    const t = fromEt(et(reg[0]!.t).y, et(reg[0]!.t).m, et(reg[0]!.t).d, 9, 30);
    if (days.some((b) => sameNyDate(b.t, t))) return undefined;
    const bar = foldBars(reg, "1d", "new-york")[0];
    if (!bar) return undefined;
    const open = marketSession(now) === "regular" && sameNyDate(now, t);
    return { bar, words: open ? "Today so far" : "Built from Robinhood's 1-minute bars of the session: its daily bar is not published yet" };
  };

  /** Cboe's days, with its short volume taken from Nasdaq for that stretch, or left unsaid where Nasdaq does not answer */
  const cboeDays = async (sym: string): Promise<Candle[] | Refusal> => {
    const days = await d.cboeDaily(sym);
    if (isRefusal(days)) return days;
    if (!days.some((b) => b.t >= CBOE_SHORT_FROM && b.t <= CBOE_SHORT_TO)) return days;
    const nq = await nasdaqDays(sym, ymd(CBOE_SHORT_FROM), ymd(CBOE_SHORT_TO));
    const vol = new Map(nq && !isRefusal(nq) ? nq.bars.map((b) => [ymd(b.t), b.v]) : []);
    return days.map((b) => {
      if (b.t < CBOE_SHORT_FROM || b.t > CBOE_SHORT_TO) return b;
      const { v: _short, ...rest } = b;
      const v = vol.get(ymd(b.t));
      return v !== undefined ? { ...rest, v } : rest;
    });
  };

  const intraday = async (sym: string, interval: CandleInterval, w: CandleWindow, now: number): Promise<CandlePage | Refusal> => {
    // hours over three months come from the three months' window; a page scrolled left before the month's window reaches is asked there too,
    // so it says where the window its view was drawn from starts — never the month's, newer than the bars it is asked before
    const long = w.range !== undefined ? !["1D", "5D", "1M"].includes(w.range) : w.since !== undefined ? w.since < now - 31 * DAY : (w.until ?? now) < now - 31 * DAY;
    const [rhInterval, span, bounds]: [RhInterval, RhSpan, RhBounds] =
      interval === "1m" ? ["minute", "day", "extended"] : interval === "5m" || interval === "15m" ? ["5minute", "week", "extended"] : long ? ["hour", "3month", "regular"] : ["hour", "month", "extended"];
    const rh = await robinhood(sym, rhInterval, span, bounds);
    const fold = interval === "15m" || interval === "4h";
    if (isRefusal(rh)) {
      // hours from Cboe's month of ten-minute bars (15 minutes late, the regular session), where it answers
      if ((interval === "1h" || interval === "4h") && d.month) {
        const month = await d.month(sym);
        if (!isRefusal(month) && month.length) {
          const bars = foldBars(month, interval, "new-york");
          return { bars, more: false, ...(bars.length ? { ends: `Intraday history starts ${nyDay(bars[0]!.t)} ${nyClock(bars[0]!.t)} New York: Cboe's month of ten-minute bars answered (Robinhood: ${rh.message})` } : {}), source: `Cboe · 10-minute regular-session bars, 15 min delayed · ${sym}`, adjustment: SPLIT_ONLY, session: REGULAR_ONLY, folded: `${INTERVAL_WORDS[interval]} bars folded from Cboe's 10-minute bars` };
        }
      }
      // the latest session from Cboe's minutes (15 minutes late, the regular session) and Nasdaq's samples beside them
      const m = await d.minutes(sym);
      if (isRefusal(m)) return rh;
      const bars = foldBars(m, interval, "new-york");
      return { bars, more: false, ...(bars.length ? { ends: `Intraday history starts ${nyDay(bars[0]!.t)} ${nyClock(bars[0]!.t)} New York: only the latest session's minutes answered (Robinhood: ${rh.message})` } : {}), source: `Cboe · 15 min delayed, regular session · Nasdaq one-price-a-minute samples outside it · ${sym}`, adjustment: SPLIT_ONLY, session: "the latest session only" };
    }
    const bars = interval === "1m" || interval === "5m" || interval === "1h" ? rh.map(({ session: _s, ...b }) => b) : foldBars(rh, interval, "new-york");
    const first = bars[0]?.t;
    // Robinhood's windows do not page: what is asked from before its window's first bar is not there, and the page says where it starts
    // (a market closed over a night, a weekend and a holiday beside it is no end of the history: four days of slack)
    const before = first === undefined || (w.since === undefined ? (w.until ?? Number.POSITIVE_INFINITY) <= first : w.since < first - Math.max(INTERVAL_MS[interval], 4 * DAY));
    const words = INTERVAL_WORDS[interval];
    const ends = before ? (first !== undefined ? `Intraday history starts ${nyDay(first)} ${nyClock(first)} New York: Robinhood publishes no older ${words} bars without a broker's key` : `Robinhood has no ${words} bars of ${sym} just now`) : undefined;
    const last = bars[bars.length - 1]?.t;
    const gaps = first === undefined || last === undefined ? [] : bounds === "extended" ? overnightGaps(first, last + INTERVAL_MS[interval]) : lateOpenGaps(first, last + INTERVAL_MS[interval]);
    return {
      bars,
      more: false,
      ...(ends ? { ends } : {}),
      source: `Robinhood · ${sym}`,
      adjustment: SPLIT_ONLY,
      session: bounds === "extended" ? EXTENDED_HOURS : REGULAR_FROM_TEN,
      ...(fold ? { folded: `${words} bars folded from Robinhood's ${interval === "15m" ? "5-minute" : "hourly"} bars (New York ${interval === "4h" ? "buckets from 04:00" : "quarter hours"})` } : {}),
      ...(gaps.length ? { gaps } : {}),
    };
  };

  const daily = async (sym: string, interval: "1d" | "1w", w: CandleWindow, now: number): Promise<CandlePage | Refusal> => {
    const weekly = interval === "1w";
    const label = (bars: Candle[], source: string, extra: Partial<CandlePage> = {}): CandlePage => ({
      bars: weekly ? foldBars(bars, "1w", "new-york") : bars,
      more: false,
      source: `${source} · ${sym}`,
      adjustment: SPLIT_ONLY,
      session: REGULAR_DAYS,
      ...(weekly ? { folded: `weekly bars folded from ${source}'s daily bars (weeks from Monday)` } : {}),
      ...extra,
    });
    // A PAGE SCROLLED LEFT: Nasdaq's days before the chart's first, by dates, one request — Cboe's where Nasdaq refuses
    if (w.since === undefined) {
      const until = w.until ?? now;
      const n = limitOf(w);
      const to = ymd(until - DAY);
      // enough days for the page: five trading days a week, and the holidays (about nine a year) beside them
      const from = ymd(until - (weekly ? n * 7 + 7 : Math.ceil(n * 1.5) + 7) * DAY);
      const nq = await nasdaqDays(sym, from, to);
      if (nq === null) return label([], "Nasdaq", { ends: `Nasdaq keeps no daily bars of ${sym}` });
      if (!isRefusal(nq)) {
        const bars = nq.bars.filter((b) => b.t < until);
        // fewer days than the dates hold, ending well after the first date asked: the start of Nasdaq's history of the share
        const started = !bars.length || bars[0]!.t > fromEt(Number(from.slice(0, 4)), Number(from.slice(5, 7)), Number(from.slice(8, 10)), 9, 30) + 10 * DAY;
        return label(bars, "Nasdaq", started ? { ends: bars.length ? `Nasdaq's daily history of ${sym} starts ${nyDay(bars[0]!.t)}${nq.noOpen ? `: its days before give no opening price and are left out` : ""}` : `Nasdaq keeps no daily bars of ${sym} before ${nyDay(until)}` } : { more: true });
      }
      const cb = await cboeDays(sym);
      if (isRefusal(cb)) return isRefusal(nq) ? nq : cb;
      const bars = cb.filter((b) => b.t < until).slice(-(weekly ? n * 5 : n));
      return label(bars, "Cboe", bars.length && bars.length >= (weekly ? n * 5 : n) ? { more: true } : { ends: bars.length ? `Cboe's daily history of ${sym} starts ${nyDay(bars[0]!.t)}` : `Cboe keeps no daily bars of ${sym} before ${nyDay(until)}` });
    }
    // A FIRST VIEW: Robinhood's year or five years where they reach the start, Nasdaq's by dates for anything older (MAX: all of it)
    const since = w.since;
    let days: Candle[] | undefined;
    let source = "Robinhood";
    let ends: string | undefined;
    let noOpen: string | undefined;
    let refused: Refusal | undefined;
    if (since >= now - 1_827 * DAY) {
      const rh = await robinhood(sym, "day", since >= now - 366 * DAY ? "year" : "5year", "regular");
      if (isRefusal(rh)) refused = rh;
      else days = rh.map(({ session: _s, ...b }) => b);
    }
    if (!days) {
      const nq = await nasdaqDays(sym, since <= 0 ? "1970-01-01" : ymd(since), ymd(now));
      // Nasdaq answering no days at all for dates the market traded is no answer: Cboe's are asked
      if (nq === null || (!isRefusal(nq) && !nq.bars.length)) refused ??= no("E_VENUE_REJECTED", { venue, message: `Nasdaq keeps no daily bars of ${sym}` });
      else if (isRefusal(nq)) refused ??= nq;
      else {
        days = nq.bars;
        source = "Nasdaq";
        const first = days[0]?.t;
        if (first !== undefined && first > since + 10 * DAY) ends = `Nasdaq's daily history of ${sym} starts ${nyDay(first)}${nq.noOpen && nq.lastNoOpen !== undefined && nq.lastNoOpen < first ? `: its days before give no opening price and are left out` : ""}`;
        if (nq.noOpen && nq.lastNoOpen !== undefined && nq.lastNoOpen >= (first ?? Number.POSITIVE_INFINITY)) noOpen = `Nasdaq gives no opening price for ${nq.noOpen.toLocaleString("en-US")} of its days, the last ${nyDay(nq.lastNoOpen)}: they are left out, never given one`;
      }
    }
    if (!days) {
      const cb = await cboeDays(sym);
      if (isRefusal(cb)) return refused ?? cb;
      days = cb.filter((b) => b.t >= since);
      source = "Cboe";
      const first = days[0]?.t;
      if (first !== undefined && first > since + 10 * DAY) ends = `Cboe's daily history of ${sym} starts ${nyDay(first)}`;
    }
    days = days.filter((b) => b.t >= since && isMarketDay(b.t));
    const today = await todayFrom(sym, days, now);
    if (today) days = [...days, today.bar];
    const page = label(days, source, { more: !ends, ...(ends ? { ends } : {}), ...(noOpen ? { note: noOpen } : {}) });
    const lastBar = page.bars[page.bars.length - 1];
    return today && lastBar ? { ...page, today: { t: lastBar.t, words: weekly ? `This week so far: ${today.words.charAt(0).toLowerCase()}${today.words.slice(1)}` : today.words } } : page;
  };

  return async (symbol, interval, w) => {
    const now = d.clock();
    // a stock's 1D and 5D are its latest sessions, not the calendar's day (live/history.ts sessionsSince; the service widens its own window
    // the same way)
    const win: CandleWindow = w.since !== undefined && w.range !== undefined ? { ...w, since: sessionsSince(w.range, now) } : w;
    // a range Robinhood's window at the size asked does not reach: drawn in the finest size whose window does, and said
    const size = win.since !== undefined && win.range !== undefined ? sizeFor(interval, win.since, now) : interval;
    const got = size === "1d" || size === "1w" ? await daily(symbol, size, win, now) : await intraday(symbol, size, win, now);
    if (isRefusal(got)) return got;
    const drawn: CandlePage = size === interval ? got : { ...got, interval: size, note: `Robinhood publishes ${INTERVAL_WORDS[interval]} bars of ${symbol} for ${REACH_WORDS[interval]} only without a broker's key: ${win.range} is drawn in ${INTERVAL_WORDS[size]} bars` };
    // every answer held to its window: the bars that start in it, the latest `limit` of them (live/history.ts pageOf)
    return pageOf(drawn, size, win);
  };
}

/** how far back each of Robinhood's intraday windows reaches, in words, by the size asked of it */
const REACH_WORDS: Readonly<Record<CandleInterval, string>> = { "1m": "the latest session", "5m": "the latest five sessions", "15m": "the latest five sessions", "1h": "about three months", "4h": "about three months", "1d": "years", "1w": "years" };

/** THE SIZE A RANGE IS DRAWN IN (see the top of this file): the one asked, or the finest coarser one whose Robinhood window reaches the range's
 * start — minutes the latest session (from 04:00), five and fifteen minutes the latest five, hours about three months (hour/3month/regular:
 * 64 sessions, a few days of slack as the page's own check keeps), days any range */
export function sizeFor(asked: CandleInterval, since: number, now: number): CandleInterval {
  const order: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
  const reaches = (s: CandleInterval): boolean =>
    s === "1m" ? sessionsSince("1D", now) <= since + 60_000 : s === "5m" || s === "15m" ? sessionsSince("5D", now) <= since + 60_000 : s === "1h" || s === "4h" ? now - 92 * DAY <= since + 4 * DAY : true;
  if (asked === "1w" || asked === "1d") return asked;
  for (const s of order.slice(order.indexOf(asked))) if (reaches(s)) return s;
  return "1d";
}

/** THE HALF HOUR FROM THE OPEN that Robinhood's hourly regular-session bars leave out (see the top of this file): 09:30 to 10:00 New York of
 * every market day from `from` to `to`, each said as a gap and never filled. At most 400 */
export function lateOpenGaps(from: number, to: number): Array<{ from: number; to: number; why: string }> {
  const out: Array<{ from: number; to: number; why: string }> = [];
  if (!(to > from)) return out;
  const e = et(from);
  for (let i = 0; out.length < 400; i++) {
    const day = new Date(Date.UTC(e.y, e.m - 1, e.d + i));
    const open = fromEt(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 9, 30);
    if (open >= to) break;
    if (isMarketDay(open) && open + 30 * 60_000 > from) out.push({ from: open, to: open + 30 * 60_000, why: LATE_OPEN_WORDS });
  }
  return out;
}
