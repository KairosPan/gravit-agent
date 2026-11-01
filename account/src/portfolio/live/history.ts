/** LONG PRICE HISTORY, FETCHED ON DEMAND (feat/paper-live phase H): what every source of bars shares — the ranges a chart is asked for and the
 * bar size each one starts in, bars folded from finer real bars, a page said the same way whoever drew it, a small line per host so a burst
 * of pages keeps under the venue's rate limit, and a bounded memory that absorbs the same ask repeated.
 *
 * The owner's rule for market data (2026-10-16): it is fetched from the providers when a chart asks for it — nothing is written to disk, and
 * nothing goes to a store of ours. The only memory is HistoryKeep below: in this process, a few dozen answers at most, each for seconds to
 * minutes, and the oldest let go first.
 *
 * RANGES and the bar each starts in (PAPERLIVE.md "Ranges and default bar sizes"):
 *   1D 1m · 5D 5m · 1M 1h · 3M and 6M 4h · YTD and 1Y 1d · 5Y and MAX 1w
 * A range is counted back from now on the calendar (rangeSince: 1M thirty days, 3M ninety-two, 6M a hundred and eighty-three, YTD from the
 * first of January in UTC, 1Y three hundred and sixty-five days, 5Y eighteen hundred and twenty-six, MAX from the start of the source's
 * history) — save a US stock's 1D and 5D, which are its latest session and its latest five (sessionsSince): a Monday morning's 1D is Monday's
 * pre-market, never Sunday.
 *
 * FOLDING (foldBars): a bar size a source does not publish is built from its own finer bars and said so (CandlePage.folded) — 4h from 1h,
 * 1w from 1d, 15m from 5m — first open, highest high, lowest low, last close, the volume summed where every part has one. Only real bars:
 * a bucket with none stays empty. Crypto's bars are counted in UTC (4h from 00:00, weeks from Monday 00:00, as OKX's 1Wutc and Coinbase's
 * weeks are); a US stock's in New York (4h from 04:00, 08:00, 12:00, 16:00; a day stamped at its session's open, 09:30, as public-stocks.ts
 * has always stamped it; a week at its Monday's). Never stitched across sources with different weeks.
 *
 * A PAGE (pageOf): what a source answered, held to the window that was asked — the bars that start in it, the latest `limit` of them — and
 * whether older bars exist. A source that pages says it itself (live/history-crypto.ts, live/history-stocks.ts); a plain list of bars says
 * nothing of what lies before it, and is taken as: older bars exist where the window cut some off, or where one page asked before the first
 * bar a chart has brought any.
 *
 * RATE LIMITS (lane): one small line per host, shared by every source in the process that asks it — Coinbase Exchange ten requests a second
 * (its documented limit for a public endpoint, bursts to fifteen), OKX twenty in two seconds, Hyperliquid's info endpoint a weight of 1,200 a
 * minute of which the history takes at most 900 (a candleSnapshot weighs 20 and one more per 60 bars it returns; the listings and the
 * stream share the rest). A page waits its turn; it is never sent past the limit and never dropped. */
import type { Refusal } from "../../core/errors.ts";
import { isRefusal } from "../../core/errors.ts";
import { et, fromEt, isMarketDay, usPhaseAt } from "../account/calendar.ts";
import { HISTORY_MOST, INTERVAL_MS, type Candle, type CandleInterval, type CandlePage, type CandleRange, type CandleWindow } from "./trade.ts";

const DAY = 86_400_000;

/** the bar each range starts in (PAPERLIVE.md "Ranges and default bar sizes") */
export const RANGE_BAR: Readonly<Record<CandleRange, CandleInterval>> = { "1D": "1m", "5D": "5m", "1M": "1h", "3M": "4h", "6M": "4h", YTD: "1d", "1Y": "1d", "5Y": "1w", MAX: "1w" };
/** the range a chart asked only for a bar size is drawn over (GET /api/account/candles with no range and no `before`): about the few hundred
 * bars the chart drew before ranges existed — a day of five-minute bars, a month of hourly ones, a year of daily ones — and the range that
 * starts in each new size */
export const INTERVAL_RANGE: Readonly<Record<CandleInterval, CandleRange>> = { "1m": "1D", "5m": "1D", "15m": "5D", "1h": "1M", "4h": "3M", "1d": "1Y", "1w": "5Y" };
/** how many days each range reaches back on the calendar (YTD and MAX are counted from a date) */
const RANGE_DAYS: Readonly<Record<Exclude<CandleRange, "YTD" | "MAX">, number>> = { "1D": 1, "5D": 5, "1M": 30, "3M": 92, "6M": 183, "1Y": 365, "5Y": 1826 };
/** the bar sizes in words, for the sentences a page carries */
export const INTERVAL_WORDS: Readonly<Record<CandleInterval, string>> = { "1m": "1-minute", "5m": "5-minute", "15m": "15-minute", "1h": "hourly", "4h": "4-hour", "1d": "daily", "1w": "weekly" };
/** the most bars one page asked before a chart's first bar brings, whatever the chart asks: a source's own page is often smaller */
export const PAGE_MOST = 1_000;

/** a range's start on the calendar, counted back from `now` (see the top of this file); MAX is the source's whole history */
export function rangeSince(range: CandleRange, now: number): number {
  if (range === "MAX") return 0;
  if (range === "YTD") return Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  return now - RANGE_DAYS[range] * DAY;
}

/** A US STOCK'S range start: its 1D is its latest session — from 04:00 New York, pre-market, on the latest market day that has begun — and
 * its 5D the latest five; any other range as rangeSince counts it */
export function sessionsSince(range: CandleRange, now: number): number {
  const n = range === "1D" ? 1 : range === "5D" ? 5 : 0;
  if (!n) return rangeSince(range, now);
  const e = et(now);
  let found = 0;
  for (let i = 0; i < 40; i++) {
    const day = new Date(Date.UTC(e.y, e.m - 1, e.d - i));
    const at = fromEt(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 4, 0);
    if (at > now || !isMarketDay(at)) continue;
    if (++found === n) return at;
  }
  return rangeSince(range, now);
}

/** the next coarser bar size, where there is one */
export function coarserThan(interval: CandleInterval): CandleInterval | undefined {
  const order: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
  return order[order.indexOf(interval) + 1];
}

// ---- folding: a size the source does not publish, from its own finer bars ----------------------------------------------------------

/** how a source's bars are counted: crypto's in UTC, a US stock's in New York (see the top of this file) */
export type BarClock = "utc" | "new-york";
/** 1970-01-05 00:00 UTC was a Monday: weeks are counted from it (the epoch itself was a Thursday, which is where Hyperliquid's and Kraken's
 * own weeks start) */
const MONDAY = 4 * DAY;

/** the start of the bar of `interval` that `t` falls in, on `clock` */
export function barStart(t: number, interval: CandleInterval, clock: BarClock = "utc"): number {
  const ms = INTERVAL_MS[interval];
  if (interval === "1w" && clock === "utc") return Math.floor((t - MONDAY) / ms) * ms + MONDAY;
  // New York is a whole number of hours from UTC: a minute, a quarter hour and an hour start at the same instants in both
  if (clock === "utc" || ms <= INTERVAL_MS["1h"]) return Math.floor(t / ms) * ms;
  const e = et(t);
  if (interval === "4h") return fromEt(e.y, e.m, e.d, Math.floor(e.minutes / 240) * 4);
  // a stock's day is stamped at its regular session's open, 09:30 New York, and its week at the open of that week's Monday
  if (interval === "1d") return fromEt(e.y, e.m, e.d, 9, 30);
  const monday = new Date(Date.UTC(e.y, e.m - 1, e.d - ((e.dow + 6) % 7)));
  return fromEt(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 9, 30);
}

/** Real bars (any order) folded into bars of `interval` on `clock`: first open, highest high, lowest low, last close, and the volume summed
 * only where every bar in the bucket has one. A bucket that starts before `from` is left out — its first bars were not read, so it would
 * understate its range. Oldest first */
export function foldBars(bars: readonly Candle[], interval: CandleInterval, clock: BarClock = "utc", from = Number.NEGATIVE_INFINITY): Candle[] {
  const out = new Map<number, Candle>();
  for (const b of [...bars].sort((x, y) => x.t - y.t)) {
    const at = barStart(b.t, interval, clock);
    const x = out.get(at);
    if (!x) out.set(at, { t: at, o: b.o, h: b.h, l: b.l, c: b.c, ...(b.v !== undefined ? { v: b.v } : {}) });
    else {
      x.h = Math.max(x.h, b.h);
      x.l = Math.min(x.l, b.l);
      x.c = b.c;
      if (x.v !== undefined && b.v !== undefined) x.v = Number((x.v + b.v).toFixed(8));
      else delete x.v;
    }
  }
  return [...out.values()].filter((b) => b.t >= from).sort((x, y) => x.t - y.t);
}

// ---- a page, whoever drew it ---------------------------------------------------------------------------------------------------------

/** a bar fit to draw: a time and four prices none below zero (an event contract may trade at 0), the high not under the low, a volume only
 * where it is a count. What the venue said is drawn as it said it: a high a cent under the open (a source's rounding) is not corrected */
export function realBar(b: unknown): b is Candle {
  if (!b || typeof b !== "object") return false;
  const c = b as Candle;
  const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  return ok(c.t) && ok(c.o) && ok(c.h) && ok(c.l) && ok(c.c) && c.o >= 0 && c.l >= 0 && c.c >= 0 && c.h >= c.l && (c.v === undefined || (ok(c.v) && c.v >= 0));
}

/** the window as a memory's key: its range where it was asked as one (a range's start moves with the clock, and the answer is kept only
 * seconds), else its start to the minute, its end and its limit — and whether the venue's own bars alone were asked (CandleWindow.own: a
 * Kraken pair's own bars are not the chart's) */
export function windowKey(interval: CandleInterval, w: CandleWindow): string {
  const since = w.range !== undefined ? `r${w.range}` : w.since === undefined ? "" : `s${Math.floor(w.since / 60_000)}`;
  return `${interval}|${since}|${w.until ?? ""}|${w.limit ?? ""}${w.own ? "|own" : ""}`;
}
/** how long an answer for the window is kept: a page that ends in the past never changes (five minutes), one that ends now has a bar
 * still forming (fifteen seconds for minutes, thirty for longer bars) */
export function keepMsOf(interval: CandleInterval, w: CandleWindow): number {
  if (w.until !== undefined) return 300_000;
  return INTERVAL_MS[interval] <= INTERVAL_MS["5m"] ? 15_000 : 30_000;
}
/** what a history's window may not be, in words, or nothing: one of the bar sizes, a start before now, an end and a limit that are numbers */
export function badWindow(interval: string, w: CandleWindow, now: number): string | undefined {
  if (!(Object.hasOwn(INTERVAL_MS, interval) as boolean)) return `price history comes in bars of ${Object.keys(INTERVAL_MS).join(", ")}, not "${String(interval).slice(0, 12)}"`;
  if (!w || typeof w !== "object") return "price history is asked for a window of time";
  if (w.since !== undefined && !(Number.isFinite(w.since) && w.since >= 0 && w.since < now)) return "price history starts before now";
  if (w.until !== undefined && !(Number.isFinite(w.until) && w.until > 0)) return "a page of price history ends at a time, in milliseconds";
  if (w.limit !== undefined && !(Number.isFinite(w.limit) && w.limit >= 1)) return "a page of price history holds at least one bar";
  return undefined;
}

/** the most bars a window may ask for: HISTORY_MOST for a first view, PAGE_MOST for a page asked before a chart's first bar */
export function limitOf(w: CandleWindow): number {
  const most = w.since === undefined ? PAGE_MOST : HISTORY_MOST;
  const n = Math.floor(w.limit ?? most);
  return Number.isFinite(n) && n > 0 ? Math.min(n, most) : most;
}

/** WHAT A SOURCE ANSWERED, AS A PAGE (see the top of this file): the bars that start inside the window (from `since`, before `until`), one
 * to a start, oldest first, the latest `limit` of them; the source's own words carried; a plain list taken as saying older bars exist where
 * the window cut some off or a page brought any. The gaps and the "today so far" bar only where they are among the bars kept */
export function pageOf(got: Candle[] | CandlePage, interval: CandleInterval, w: CandleWindow): CandlePage {
  const plain = Array.isArray(got);
  const page: CandlePage = plain ? { bars: got, more: false } : got;
  const since = w.since ?? Number.NEGATIVE_INFINITY;
  const until = w.until ?? Number.POSITIVE_INFINITY;
  const byStart = new Map<number, Candle>();
  for (const b of Array.isArray(page.bars) ? page.bars : []) if (realBar(b) && b.t >= since && b.t < until) byStart.set(b.t, b);
  const inside = [...byStart.values()].sort((x, y) => x.t - y.t);
  const limit = limitOf(w);
  const cut = inside.length > limit;
  const bars = cut ? inside.slice(-limit) : inside;
  const more = cut || (plain ? w.since === undefined && bars.length > 0 : page.more === true);
  const first = bars[0]?.t ?? Number.POSITIVE_INFINITY;
  const last = bars[bars.length - 1]?.t ?? Number.NEGATIVE_INFINITY;
  const gaps = (page.gaps ?? []).filter((g) => g.to > first && g.from <= last + INTERVAL_MS[page.interval ?? interval]);
  const { gaps: _g, today: _t, ends: _e, ...rest } = page;
  return {
    ...rest,
    bars,
    more,
    // a history that ends inside what was asked says so only where nothing older is said to exist
    ...(page.ends && !more ? { ends: page.ends } : {}),
    ...(gaps.length ? { gaps } : {}),
    ...(page.today && bars.some((b) => b.t === page.today!.t) ? { today: page.today } : {}),
  };
}

// ---- words ---------------------------------------------------------------------------------------------------------------------------

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon 20 Jul 2015", a UTC date as a person reads it (a crypto bar's) */
export function utcDay(ms: number): string {
  const d = new Date(ms);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** "Fri 16 Oct 2026", a New York date (a US stock's bar's) */
export function nyDay(ms: number): string {
  const e = et(ms);
  return `${DOW[e.dow]} ${e.d} ${MONTH[e.m - 1]} ${e.y}`;
}
/** "04:00", New York's time of day */
export function nyClock(ms: number): string {
  const m = et(ms).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** THE NIGHTS A US STOCK'S EXTENDED-HOURS BARS SAY NOTHING OF (PAPERLIVE.md "Gaps are said, never filled"): every overnight session — 20:00 to
 * 04:00 New York, Sunday to Thursday night ahead of a market day — that lies between `from` and `to`, each as [its start, its end) and "No
 * overnight data": no keyless source publishes real bars of it (Robinhood's are interpolated filler, history-sources.md). At most 400 */
export function overnightGaps(from: number, to: number): Array<{ from: number; to: number; why: string }> {
  const out: Array<{ from: number; to: number; why: string }> = [];
  if (!(to > from)) return out;
  const e = et(from - DAY);
  for (let i = 0; out.length < 400; i++) {
    const day = new Date(Date.UTC(e.y, e.m - 1, e.d + i));
    const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const start = fromEt(y, m, d, 20, 0);
    if (start >= to) break;
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const end = fromEt(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 4, 0);
    if (end > from && usPhaseAt(start + 60_000) === "overnight") out.push({ from: start, to: end, why: "No overnight data" });
  }
  return out;
}

// ---- rate limits: one line per host -----------------------------------------------------------------------------------------------

/** a turn in a host's line: resolves when a request that weighs `cost` may be sent */
export type Lane = (cost?: number) => Promise<void>;
/** the line a source waits in before each request to `host` (PublicDeps.pace; absent: the process's own line for that host, hostLane) */
export type Pace = (host: HistoryHost, cost?: number) => Promise<void>;
export type HistoryHost = "coinbase" | "okx" | "hyperliquid" | "robinhood" | "nasdaq";

/** A LINE: at most `max` of weight sent in any `perMs`, in the order asked; a turn that would go past it waits for the oldest to age out.
 * Real time by default (`now`, `sleep` are for tests): a stopped test clock never holds a line shut */
export function lane(max: number, perMs: number, o: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Lane {
  const now = o.now ?? (() => performance.now());
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((go) => setTimeout(go, ms)));
  const spent: Array<{ at: number; cost: number }> = [];
  let line: Promise<void> = Promise.resolve();
  return (cost = 1) => {
    const c = Math.min(Math.max(0, cost), max);
    const turn = line.then(async () => {
      for (;;) {
        const t = now();
        while (spent.length && spent[0]!.at <= t - perMs) spent.shift();
        const used = spent.reduce((s, x) => s + x.cost, 0);
        if (used + c <= max) {
          spent.push({ at: t, cost: c });
          return;
        }
        await sleep(Math.max(1, spent[0]!.at + perMs - t));
      }
    });
    line = turn.catch(() => undefined);
    return turn;
  };
}

/** each host's limit (see the top of this file): requests (Hyperliquid: weight) in a window of ms */
export const HOST_LIMITS: Readonly<Record<HistoryHost, { max: number; perMs: number }>> = {
  coinbase: { max: 10, perMs: 1_000 },
  okx: { max: 20, perMs: 2_000 },
  hyperliquid: { max: 900, perMs: 60_000 },
  // neither publishes a limit for these keyless reads (history-sources.md: no rate-limit headers): a few a second, so a burst of charts
  // never looks like a crawl. Nasdaq's line is every GET of it the process sends — the US shares' real-time quotes too (us-quotes.ts
  // nasdaqSource) — four a second on the whole, a burst of eight at once (one batch of quotes: NASDAQ_AT_ONCE) still sent at once
  robinhood: { max: 5, perMs: 1_000 },
  nasdaq: { max: 8, perMs: 2_000 },
};
const LANES = new Map<HistoryHost, Lane>();
/** the process's own line for a host: every source asking it waits in the same one */
export const hostLane: Pace = (host, cost) => {
  let l = LANES.get(host);
  if (!l) LANES.set(host, (l = lane(HOST_LIMITS[host].max, HOST_LIMITS[host].perMs)));
  return l(cost);
};
/** Hyperliquid's weight for a candleSnapshot that returns `bars` (its rate-limit page: 20 for an info request, one more per 60 items) */
export const hlWeight = (bars: number): number => 20 + Math.ceil(Math.max(0, bars) / 60);

// ---- the memory: bounded, and short ----------------------------------------------------------------------------------------------

export interface HistoryKeep<T> {
  /** the answer kept under `key` while it is younger than `ttlMs` (or still on its way: one request for many askers), else `load`'s. A
   * refusal is never kept: the holds that make a refusing venue wait are the service's and the sources' own */
  get(key: string, ttlMs: number, load: () => Promise<T | Refusal>): Promise<T | Refusal>;
  clear(): void;
  /** how many answers, and how much of them (`weigh`), are kept now */
  readonly size: number;
  readonly weight: number;
}

/** A BOUNDED MEMORY OF ANSWERS (see the top of this file): at most `entries` answers and `most` of their weight (bars), the one used longest
 * ago let go first; each for its own time. In memory only. `clock` decides the ages (a test's clock); the bound holds whatever it says */
export function historyKeep<T>(o: { entries: number; most: number; weigh: (v: T) => number; clock?: () => number }): HistoryKeep<T> {
  const clock = o.clock ?? Date.now;
  const kept = new Map<string, { until: number; p: Promise<T | Refusal>; settled: boolean; w: number }>();
  let weight = 0;
  const drop = (key: string): void => {
    const e = kept.get(key);
    if (!e) return;
    if (e.settled) weight -= e.w;
    kept.delete(key);
  };
  const evict = (): void => {
    for (const [k, e] of kept) {
      if (kept.size <= o.entries && weight <= o.most) return;
      if (e.settled) drop(k);
    }
  };
  return {
    get(key, ttlMs, load) {
      const now = clock();
      const hit = kept.get(key);
      if (hit && (!hit.settled || now < hit.until)) {
        // used again: the newest in line
        kept.delete(key);
        kept.set(key, hit);
        return hit.p;
      }
      drop(key);
      const entry = { until: now + Math.max(0, ttlMs), p: Promise.resolve() as unknown as Promise<T | Refusal>, settled: false, w: 0 };
      entry.p = load().then(
        (v) => {
          if (kept.get(key) !== entry) return v;
          if (isRefusal(v)) kept.delete(key);
          else {
            entry.settled = true;
            entry.w = Math.max(0, o.weigh(v));
            entry.until = clock() + Math.max(0, ttlMs);
            weight += entry.w;
            evict();
          }
          return v;
        },
        (err: unknown) => {
          if (kept.get(key) === entry) kept.delete(key);
          throw err;
        },
      );
      kept.set(key, entry);
      evict();
      return entry.p;
    },
    clear() {
      kept.clear();
      weight = 0;
    },
    get size() {
      return kept.size;
    },
    get weight() {
      return weight;
    },
  };
}
/** how much a page weighs in a HistoryKeep: its bars */
export const pageWeight = (v: Candle[] | CandlePage): number => (Array.isArray(v) ? v.length : Array.isArray(v.bars) ? v.bars.length : 0);
