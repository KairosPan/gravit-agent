/** A COIN'S LONG PRICE HISTORY, keyless, from the venue that charts it (feat/paper-live phase H; every fact below checked live 2026-10-16 and
 * again 2026-10-17 from this machine: history-crypto-live.md, history-sources.md). ONE VENUE FOR A WHOLE SERIES: a chart's bars, its first
 * view and every page scrolled left, come from one venue's one market, named on the page (CandlePage.source) — never two venues' bars
 * stitched, never two kinds of week.
 *
 *   Coinbase Exchange   GET api.exchange.coinbase.com/products/{BTC-USD}/candles?granularity=&start=&end= — [[time (s), low, high, open,
 *                       close, volume]], newest first, the bar still forming included. Granularities 60, 300, 900, 3600, 21600 and 86400:
 *                       no 4h (14400 answers 400 "Unsupported granularity") and no week, so 4h is folded from 1h and 1w from 1d (Monday
 *                       weeks, UTC). `start` and `end` are both INCLUDED: a span of 300 granularities answered 301 bars on 2026-10-17, so
 *                       a page asks 300 starts, its last 299 granularities after its first. Every answer is cached in front of it for
 *                       five minutes (cache-control max-age=300; three asks of one daily page answered cf-cache-status HIT, age 16 to
 *                       20 s, 2026-10-17), start and end or none — so the page that holds the bar still forming ends at this second, not
 *                       at that bar's start: its URL is new each second, and its forming bar is never an older copy (a MISS, 300 bars,
 *                       the forming one included, live). A minute with no trade has no bar, and a thin product's page of 300 minutes can
 *                       hold none at all (CHECK-USD on 2026-10-17: 11, 0, 0, 6 and 4 bars in its day's five pages): an empty page is a
 *                       stretch with no trade, not where its history starts, unless its own coarser candles say nothing is older
 *                       (probe below). BTC-USD starts 2015-07-20. An unknown product answers 404 {"message":"NotFound"}; a delisted one
 *                       200 [] — GET /products/{id} says which (status "online" or "delisted", trading_disabled). Ten requests a second
 *                       (live/history.ts)
 *   OKX                 GET www.okx.com/api/v5/market/history-candles?instId=&bar=&after=&limit=300 — {code:"0", data: [[ts (ms), o, h, l,
 *                       c, vol, volCcy, volCcyQuote, confirm]]}, newest first, at most 300, `after` the exclusive cursor (bars older than
 *                       it), the bar still forming answered with confirm "0". Bars 1m 5m 15m 1H 4H and 1Dutc 1Wutc — never 1D or 1W, which
 *                       open at 16:00 UTC (UTC+8); a lower-case 1h is code 51000 "Parameter bar error". A spot pair's `vol` is in the coin;
 *                       a swap's is in contracts and its `volCcy` in the coin. An unknown instrument answers code 51001 under HTTP 200.
 *                       BTC-USDT's 1Dutc starts 2018-01-11 (older pages answer []); BTC-USDT-SWAP's 2020-01. Twenty requests in two seconds
 *   Hyperliquid         POST api.hyperliquid.xyz/info {"type":"candleSnapshot","req":{coin,interval,startTime,endTime}} — [{t, T, s, i, o, c,
 *                       h, l, v, n}], oldest first, everything in the window ONLY FROM ITS LATEST ~5,000 BARS at that size (5,128 one-minute
 *                       bars on 2026-10-17: 3.6 days; 1h about 208 days; 4h back to 2024-07; 1d to 2020-08-19). It answers a bar for every
 *                       interval, a quiet one too: n 0, flat at the price before — a thin perpetual's day of minutes is mostly them
 *                       (NOT-PERP on 2026-10-17: 1,345 of 1,439) — and never drawn: no trade, no bar. Its daily bars before 2023-02-26 (BTC)
 *                       are the same, v 0 and n 0: price-only backfill from before Hyperliquid traded the coin. Where Hyperliquid's bars
 *                       start after the window does (its first bar, traded or not), its history at that size ends there, and the page says
 *                       why: at the edge of its latest 5,000, "Hyperliquid keeps only the latest 5,000 bars at this size"; else its market
 *                       starts there — "Hyperliquid's HYPE trading starts …", at its first traded day where daily backfill comes before it.
 *                       Its own 1w starts on Thursday, so weeks are folded from its days (Monday). Where the latest 5,000 bars at the size
 *                       asked do not reach a range's start, the range is drawn in the finest size whose 5,000 do (said in `note`).
 *                       Weighed 20 and one more per 60 bars, from a budget of 900 a minute
 *   the library         the unified exchange library's fetchOHLCV, for every other exchange (and a connected key's client): the bars from
 *                       a start, forward, a page at a time; a size the exchange lacks folded from a finer one it has. A week only where the
 *                       exchange's own weeks are known to start on Monday (Binance's 1w, OKX's 1Wutc: history-sources.md), else folded from
 *                       its days — Kraken's 10080 starts on Thursday (2026-10-01, 08, 15 live)
 *
 * PAGES (paged): the window is cut into the venue's pages, newest first, each on the venue's own bars (a week's from its Monday) — Coinbase's
 * and OKX's three hundred bars, the library's — and asked the newest alone, then the rest in waves of ten at the line's pace, so a first view
 * of five thousand one-minute bars is seventeen requests in about two seconds, a market the venue does not list one, and a page scrolled left
 * up to BEFORE_PAGES. A page whose bars have all closed never changes: it is kept a while (CLOSED_PAGE_MS), so the same view read again asks
 * the venue for its newest page alone. A first view drawn as a range holds HISTORY_MOST of the venue's own bars at most, however many make one bar of the size asked:
 * Coinbase's 4h over five years is its latest 5,000 hours folded, seventeen requests, and the rest by scrolling left. WHERE THE HISTORY
 * STARTS depends on how the venue pages. OKX's `after` is a cursor — the bars older than a time, across any stretch with none — so a page it
 * answers empty is where its history of the market starts. Coinbase's and the library's pages are windows of time, and one with no bar in
 * it is a stretch with no trade: the rest of the wave is kept, a stretch with no bar between bars is said as a gap ("No trades at …"), and
 * the history starts only where the empty pages at the oldest end say so — Coinbase's own coarser candles (probe) finding nothing before
 * them, or, for the library, which has no such look, three empty pages in a row or the window's own first page; three hundred days with no
 * bar is a start at either. A page scrolled left that Coinbase answers empty is asked again where its coarser candles found the next
 * trade, so it brings bars, the stretch after them said as a gap. The page then says where the history starts ("Coinbase Exchange's
 * BTC-USD history starts Mon 20 Jul 2015"). A page with bars says older ones may exist (`more`), even where the market started inside it:
 * the next page asked finds the start. A page refused after a newer one answered ends the answer there, with `more` and `partial`: asked
 * again, it may answer. Kraken is not a history source for a chart (its OHLC keeps only its latest 720 bars, with no paging back) */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { no } from "../refuse.ts";
import { barStart, foldBars, historyKeep, hlWeight, INTERVAL_WORDS, limitOf, utcDay, type HistoryKeep, type Pace } from "./history.ts";
import { publicNo } from "./public-markets.ts";
import { HISTORY_MOST, INTERVAL_MS, type Candle, type CandleInterval, type CandlePage, type CandleWindow } from "./trade.ts";
import { unreachable, type Http, type HttpReply } from "./types.ts";

export const COINBASE_EXCHANGE = "https://api.exchange.coinbase.com";
export const COINBASE_EXCHANGE_HOST = "api.exchange.coinbase.com";
export const COINBASE_EXCHANGE_NAME = "Coinbase Exchange";
const OKX_API = "https://www.okx.com/api/v5";
/** a page of each venue, in bars, and how many pages are asked at once */
const COINBASE_PAGE = 300;
const OKX_PAGE = 300;
const WAVE = 10;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** a stretch this long with no bar at a window venue's oldest end is where its history starts, whoever asks: no market that trades is quiet
 * for three hundred days */
const LONG_QUIET = 300 * DAY;
/** the library has no look of its own before a stretch with no bar: this many of its pages in a row with none is where its history starts */
const QUIET_PAGES = 3;
/** how long one page may take: each page has its own deadline, so one slow page never holds a chart's whole first view */
export const PAGE_MS = 8_000;
/** a page scrolled left is this many of the venue's own pages at most, asked in one wave: a scroll of a folded size (Coinbase's 4h, from its
 * hours) brings a few hundred bars, not one page's seventy-five */
export const BEFORE_PAGES = 4;
/** A CLOSED PAGE — one whose every bar ended a bar before now — never changes: each venue's are kept in memory a while (Coinbase's own
 * CDN keeps them five minutes) by its venue, market, size and window, so a chart's first view read again (its reconcile every minute) asks
 * the venue for its newest page alone. Bounded, in memory only, never written anywhere */
export const CLOSED_PAGE_MS = 10 * 60_000;
const CLOSED_KEPT = 400;
const CLOSED_KEPT_BARS = 120_000;
const closedKeeps = new WeakMap<object, HistoryKeep<Candle[]>>();
/** the closed pages kept for one asker of a venue's history (a source's network, a library's client): its own, so a test's stand-in
 * venue never reads another's */
function closedOf(owner: object, clock: () => number): HistoryKeep<Candle[]> {
  let k = closedKeeps.get(owner);
  if (!k) closedKeeps.set(owner, (k = historyKeep<Candle[]>({ entries: CLOSED_KEPT, most: CLOSED_KEPT_BARS, weigh: (v) => v.length, clock })));
  return k;
}
/** Hyperliquid keeps this many bars at each size (its docs: "Only the most recent 5000 candles are available") */
export const HL_KEEPS = 5_000;
export const HL_KEEPS_WORDS = "Hyperliquid keeps only the latest 5,000 bars at this size";

const COINBASE_SECONDS: Partial<Record<CandleInterval, number>> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "1d": 86_400 };
const OKX_BAR: Readonly<Record<CandleInterval, string>> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1Dutc", "1w": "1Wutc" };
/** the finer size a size is folded from, where a venue does not publish it */
const FOLD_FROM: Partial<Record<CandleInterval, CandleInterval>> = { "4h": "1h", "1w": "1d", "15m": "5m" };

const fin = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const bar = (t: unknown, o: unknown, h: unknown, l: unknown, c: unknown, v?: unknown): Candle | undefined => {
  const [tt, oo, hh, ll, cc, vv] = [fin(t), fin(o), fin(h), fin(l), fin(c), fin(v)];
  if (tt === undefined || oo === undefined || hh === undefined || ll === undefined || cc === undefined || !(oo > 0 && hh > 0 && ll > 0 && cc > 0)) return undefined;
  return { t: tt, o: oo, h: hh, l: ll, c: cc, ...(vv !== undefined && vv >= 0 ? { v: vv } : {}) };
};
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** one venue's way of answering one page: its native bars that start in [from, to], both included */
interface Paged {
  /** the venue and its market in words, for the page's sentences ("Coinbase Exchange", "BTC-USD") */
  name: string;
  market: string;
  interval: CandleInterval;
  /** the size asked of the venue: the interval, or the finer one it is folded from */
  native: CandleInterval;
  pageBars: number;
  /** how the venue pages (see the top of this file): by a CURSOR — OKX's `after`, the bars older than a time across any stretch with none,
   * so an empty answer is where its history starts — or by a WINDOW of time (Coinbase's start and end, the library's start and count),
   * where an empty answer is a stretch with no trade */
  cursor: boolean;
  page: (from: number, to: number) => Promise<Candle[] | Refusal>;
  /** a window venue's own look before a stretch with no bar (Coinbase Exchange's coarser candles): the newest stretch before `before` that
   * holds a bar — its start and its length, a length one page holds — or none; `quiet` ms from `before` on are known to hold none. Absent:
   * the venue has no such look (the library) */
  probe?: ((before: number, quiet: number) => Promise<{ at: number; ms: number } | undefined | Refusal>) | undefined;
  /** where its closed pages are kept (closedOf); absent: each asked every time */
  closed?: HistoryKeep<Candle[]> | undefined;
}

/** the start of the first whole bar of `interval` (UTC) at or after `t` */
const wholeFrom = (t: number, interval: CandleInterval): number => {
  const s = barStart(t, interval);
  return s === t ? t : s + INTERVAL_MS[interval];
};

/** THE WINDOW AS PAGES (see the top of this file): the starts of the native bars wanted — the window's, the latest `limit` of the asked size,
 * the first a whole bar of it (a fold never starts with a bucket whose first part was not read) — cut into the venue's pages, newest first,
 * each page's seams on the venue's own bars (the last one the bar the window's end falls in: a week's from its Monday) */
function plan(interval: CandleInterval, native: CandleInterval, w: CandleWindow, now: number, pageBars: number, pagesBefore = 1): { first: number; last: number; cut: boolean; pages: Array<{ from: number; to: number }> } {
  const g = INTERVAL_MS[native];
  const G = INTERVAL_MS[interval];
  const up = (t: number): number => wholeFrom(t, interval);
  const until = Math.min(w.until ?? Number.POSITIVE_INFINITY, now + 1);
  const last = barStart(until - 1, native);
  const perBar = Math.max(1, Math.round(G / g));
  // a page scrolled left is `pagesBefore` pages of the venue's at most (BEFORE_PAGES where they are asked in waves); a first view drawn as a
  // range HISTORY_MOST of the venue's own bars at most, however many make one bar of the size asked (the rest comes by scrolling left); a
  // window asked whole (the paper account's time asleep) all of it
  const room = w.since === undefined ? Math.min(limitOf(w) * perBar, pageBars * pagesBefore) : w.range !== undefined ? Math.min(limitOf(w) * perBar, HISTORY_MOST) : limitOf(w) * perBar;
  const wanted = w.since === undefined ? Number.NEGATIVE_INFINITY : up(Math.max(0, w.since));
  let first = last - (room - 1) * g;
  const cut = w.since === undefined || first > wanted;
  first = up(Math.max(first, wanted));
  const pages: Array<{ from: number; to: number }> = [];
  for (let to = last; to >= first; to -= pageBars * g) pages.push({ from: Math.max(first, to - (pageBars - 1) * g), to });
  return { first, last, cut, pages };
}

/** A WINDOW ASKED PAGE BY PAGE (see the top of this file) */
async function paged(p: Paged, w: CandleWindow, now: number): Promise<CandlePage | Refusal> {
  const { first, cut, pages } = plan(p.interval, p.native, w, now, p.pageBars, BEFORE_PAGES);
  const g = INTERVAL_MS[p.native];
  // a page whose last bar ended a bar before now is closed: kept (CLOSED_PAGE_MS), asked of the venue once — only the newest is asked anew
  const ask = (pg: { from: number; to: number }): Promise<Candle[] | Refusal> => (p.closed && pg.to + 2 * g <= now ? p.closed.get(`${p.name}|${p.market}|${p.native}|${pg.from}|${pg.to}`, CLOSED_PAGE_MS, () => p.page(pg.from, pg.to)) : p.page(pg.from, pg.to));
  const got: Candle[] = [];
  // each page asked, newest first: whether it held no bar
  const empty: boolean[] = [];
  let started = false;
  let partial = false;
  // the venue's own look found a bar before the stretch with none at the oldest end: its history goes on before it
  let older = false;
  let probed = false;
  // a page scrolled left that held no bar, asked again where the venue's look found its next older trade: the stretch after its bars
  let quietAfter: number | undefined;
  // a fold starts with a whole bar of what was read: the window's first, or the page asked again further back
  let foldFrom = first;
  // the pages with no bar at the oldest end of what was asked, and how long a stretch they make
  const run = (): { n: number; quiet: number } => {
    let n = 0;
    while (n < empty.length && empty[empty.length - 1 - n]) n++;
    return { n, quiet: n ? pages[empty.length - n]!.to + g - pages[empty.length - 1]!.from : 0 };
  };
  // a window venue's stretch with none long enough to be where its history starts: three hundred days, or QUIET_PAGES of the library's
  // pages (it has no look of its own); never once its own look found a bar before it
  const startsHere = (): boolean => {
    const r = run();
    return !p.cursor && !older && r.n > 0 && (r.quiet >= LONG_QUIET || (!p.probe && r.n >= QUIET_PAGES));
  };
  // the newest page alone first — a market the venue does not list, or a venue that refuses, costs it one request — then the rest in waves
  for (let i = 0; i < pages.length && !started && !partial; ) {
    const wave = pages.slice(i, i === 0 ? 1 : i + WAVE);
    const answers = await Promise.all(wave.map((pg) => ask(pg)));
    i += wave.length;
    for (let k = 0; k < wave.length; k++) {
      const a = answers[k]!;
      const pg = wave[k]!;
      if (isRefusal(a)) {
        if (empty.length === 0) return a;
        // refused past a stretch with none long enough to be where the history starts: it is that, and the refusal of what lies before it
        // says nothing; else the answer stops short here
        if (startsHere()) started = true;
        else partial = true;
        break;
      }
      // one with bars older than its page (OKX past a stretch with no bars) is kept down to the window's first bar — the next page's own;
      // a window venue's bars after its page (the library's count from its start, past a stretch with none) are the newer pages' own
      const upto = a.filter((b) => b.t <= pg.to);
      empty.push(!upto.length);
      got.push(...upto.filter((b) => b.t >= first));
      // a cursor's empty answer: nothing older exists
      if (!upto.length && p.cursor) {
        started = true;
        break;
      }
    }
    if (started || partial || p.cursor || older) continue;
    // a window venue: the stretch with no bar at the oldest end of what was asked — its start where it is long enough, or where the library
    // has asked its window's own first page; else, where the venue can look before it, what its look finds
    const { n, quiet } = run();
    if (!n) continue;
    if (startsHere() || (!p.probe && i >= pages.length)) {
      started = true;
      continue;
    }
    const oldest = pages[empty.length - 1]!;
    if (p.probe && !probed) {
      probed = true;
      const seen = await p.probe(oldest.from, quiet);
      if (isRefusal(seen)) partial = true;
      else if (!seen) started = true;
      else {
        older = true;
        // a page scrolled left that held nothing: the page that ends with the stretch the look found a trade in, so the answer has bars
        if (w.since === undefined && !got.length) {
          const to = Math.min(oldest.from - g, seen.at + seen.ms - g);
          const from = to - (p.pageBars - 1) * g;
          const again = await p.page(from, to);
          if (isRefusal(again)) partial = true;
          else {
            foldFrom = wholeFrom(from, p.interval);
            const kept = again.filter((b) => b.t >= from && b.t <= to);
            got.push(...kept);
            if (kept.length) quietAfter = Math.max(...kept.map((b) => b.t)) + g;
          }
        }
      }
    }
  }
  const byStart = new Map(got.map((b) => [b.t, b]));
  const native = [...byStart.values()].sort((a, b) => a.t - b.t);
  const folded = p.native !== p.interval;
  const bars = folded ? foldBars(native, p.interval, "utc", foldFrom) : native;
  const words = INTERVAL_WORDS[p.interval];
  const ends = !started ? undefined : bars.length ? `${p.name}'s ${p.market} history starts ${utcDay(bars[0]!.t)}` : `${p.name} keeps no ${words} ${p.market} bars${w.until !== undefined ? ` before ${utcDay(w.until)}` : ""}`;
  // the stretches with no bar between bars, said and never filled: each run of empty pages with bars on both sides of it, and a page
  // scrolled left asked again further back, from its bars to where the page was asked
  const why = `No trades at ${p.name}`;
  const gaps: Array<{ from: number; to: number; why: string }> = [];
  for (let k = 0; !p.cursor && k < empty.length; ) {
    if (!empty[k]) {
      k++;
      continue;
    }
    let j = k;
    while (j < empty.length && empty[j]) j++;
    if (k > 0 && j < empty.length) gaps.push({ from: pages[j - 1]!.from, to: pages[k]!.to + g, why });
    k = j;
  }
  if (quietAfter !== undefined) gaps.push({ from: quietAfter, to: pages[0]!.to + g, why });
  return {
    bars,
    more: partial || older || (!started && (cut || (w.since ?? 0) > 0)),
    ...(partial ? { partial: true as const } : {}),
    ...(ends ? { ends } : {}),
    source: `${p.name} · ${p.market}`,
    ...(folded ? { folded: `${words} bars folded from ${p.name}'s ${INTERVAL_WORDS[p.native]} bars${p.interval === "1w" ? " (weeks from Monday, UTC)" : ""}` } : {}),
    ...(gaps.length ? { gaps: gaps.sort((a, b) => a.from - b.from) } : {}),
  };
}

// ---- Coinbase Exchange ---------------------------------------------------------------------------------------------------------------

/** a dollar pair as Coinbase Exchange names its product: BTC/USD → BTC-USD; none for anything else */
export function coinbaseProduct(symbol: string): string | undefined {
  const m = /^([A-Z0-9]{1,20})[/-]([A-Z0-9]{1,10})$/.exec(symbol.trim().toUpperCase());
  return m ? `${m[1]}-${m[2]}` : undefined;
}

export interface HistoryHttp {
  /** the network through the fixed-host guard, each request within its page's deadline */
  http: Http;
  pace: Pace;
  clock: () => number;
}

/** one GET's JSON answer, or the venue's refusal in its own words */
async function getJson(d: HistoryHttp, venue: string, name: string, url: string): Promise<{ r: HttpReply } | Refusal> {
  try {
    return { r: await d.http(url, { timeoutMs: PAGE_MS }) };
  } catch (err) {
    return unreachable(venue, name, err);
  }
}

/** one GET of Coinbase Exchange's candles for `product` at `seconds` from `from` to `to` (both included): its bars, newest first as it sends
 * them, or its refusal in its own words */
async function coinbaseCandles(d: HistoryHttp, venue: string, product: string, seconds: number, from: number, to: number): Promise<Candle[] | Refusal> {
  const name = COINBASE_EXCHANGE_NAME;
  await d.pace("coinbase");
  const got = await getJson(d, venue, name, `${COINBASE_EXCHANGE}/products/${encodeURIComponent(product)}/candles?granularity=${seconds}&start=${iso(from)}&end=${iso(to)}`);
  if (isRefusal(got)) return got;
  const { r } = got;
  if (r.status === 404) return no("E_VENUE_REJECTED", { venue, message: `${name} lists no product ${product}`, native: { status: 404 } });
  if (r.status !== 200 || !Array.isArray(r.body)) return publicNo(venue, name, r);
  const out: Candle[] = [];
  for (const row of r.body as unknown[]) {
    if (!Array.isArray(row)) continue;
    const t = fin(row[0]);
    const b = t === undefined ? undefined : bar(t * 1000, row[3], row[2], row[1], row[4], row[5]);
    if (b) out.push(b);
  }
  return out;
}

/** A DOLLAR PAIR'S HISTORY AT COINBASE EXCHANGE (see the top of this file): `product` as Coinbase names it (BTC-USD). `venue` is the source
 * asking, for its refusals. The page that holds the bar still forming ends at this second (its URL new each second: never a cached copy) */
export function coinbaseHistory(d: HistoryHttp, venue: string, product: string, interval: CandleInterval, w: CandleWindow): Promise<CandlePage | Refusal> {
  const native = COINBASE_SECONDS[interval] ? interval : FOLD_FROM[interval]!;
  const seconds = COINBASE_SECONDS[native]!;
  const g = INTERVAL_MS[native];
  const now = d.clock();
  /** the start of the newest stretch of `ms` from `from` to `to` (bucket starts, both included) that holds a bar, or none */
  const newest = async (ms: number, from: number, to: number): Promise<number | undefined | Refusal> => {
    const got = await coinbaseCandles(d, venue, product, ms / 1000, from, to);
    if (isRefusal(got)) return got;
    const seen = got.map((b) => b.t).filter((t) => t >= from && t <= to);
    return seen.length ? Math.max(...seen) : undefined;
  };
  return paged(
    {
      name: COINBASE_EXCHANGE_NAME,
      market: product,
      interval,
      native,
      pageBars: COINBASE_PAGE,
      cursor: false,
      closed: closedOf(d, d.clock),
      page: (from, to) => coinbaseCandles(d, venue, product, seconds, from, to + g > now ? Math.max(to, now) : to),
      // COINBASE'S OWN LOOK BEFORE A STRETCH WITH NO BAR: its hours over the 300 before it where a page holds less than a day (a page of
      // minutes is five hours), else its days over the 300 before it — each bucket wholly before the stretch's start or inside the stretch
      // itself, so a bar found is older than the stretch — and, the hours finding none, its days over the 300 before those, a day found
      // looked at again by the hour; at most three requests. A day or an hour found is a stretch one page holds
      probe: async (before, quiet) => {
        // a page of minutes holds five hours: an hour is the stretch it is looked at in; a page of anything longer holds a day
        const fine = COINBASE_PAGE * g < DAY || quiet < DAY ? HOUR : DAY;
        const b = Math.floor((before - 1) / fine) * fine;
        const first = await newest(fine, b - (COINBASE_PAGE - 1) * fine, b);
        if (isRefusal(first) || first !== undefined) return isRefusal(first) ? first : { at: first, ms: fine };
        if (fine === DAY) return undefined;
        const bd = Math.floor((b - (COINBASE_PAGE - 1) * fine - 1) / DAY) * DAY;
        const day = await newest(DAY, bd - (COINBASE_PAGE - 1) * DAY, bd);
        if (isRefusal(day) || day === undefined) return day;
        const hour = await newest(HOUR, day, Math.min(day + DAY - HOUR, b - COINBASE_PAGE * fine));
        return isRefusal(hour) ? hour : { at: hour ?? day, ms: hour === undefined ? DAY : HOUR };
      },
    },
    w,
    now,
  );
}

/** WHETHER COINBASE EXCHANGE TRADES A PRODUCT NOW: GET /products/{id} — {status: "online" | "delisted", trading_disabled, …} (ENJ-USD
 * delisted, trading_disabled true; BTC-USD online, live 2026-10-17); an unknown one 404 ("unlisted"). A delisted product's candles answer
 * 200 [] for its latest page, so a venue that borrows Coinbase's history (Kraken's dollar pairs: live/public-markets.ts) asks this first */
export async function coinbaseOnline(d: HistoryHttp, venue: string, product: string): Promise<"online" | "offline" | "unlisted" | Refusal> {
  const name = COINBASE_EXCHANGE_NAME;
  await d.pace("coinbase");
  const got = await getJson(d, venue, name, `${COINBASE_EXCHANGE}/products/${encodeURIComponent(product)}`);
  if (isRefusal(got)) return got;
  const { r } = got;
  if (r.status === 404) return "unlisted";
  if (r.status !== 200 || !r.body || typeof r.body !== "object") return publicNo(venue, name, r);
  const b = r.body as { status?: unknown; trading_disabled?: unknown };
  return String(b.status).toLowerCase() === "online" && b.trading_disabled !== true ? "online" : "offline";
}

// ---- OKX -------------------------------------------------------------------------------------------------------------------------------

/** a pair or a swap as OKX names its instrument: BTC/USDT → BTC-USDT, BTC/USDT:USDT (the library's name for the swap) → BTC-USDT-SWAP */
export function okxInstrument(symbol: string): string | undefined {
  const s = symbol.trim().toUpperCase();
  const swap = /^([A-Z0-9]{1,20})\/([A-Z0-9]{1,10}):([A-Z0-9]{1,10})$/.exec(s);
  if (swap) return swap[2] === swap[3] ? `${swap[1]}-${swap[2]}-SWAP` : undefined;
  if (/^[A-Z0-9]{1,20}-[A-Z0-9]{1,10}-SWAP$/.test(s)) return s;
  const pair = /^([A-Z0-9]{1,20})[/-]([A-Z0-9]{1,10})$/.exec(s);
  return pair ? `${pair[1]}-${pair[2]}` : undefined;
}

/** A PAIR'S OR A SWAP'S HISTORY AT OKX (see the top of this file): `instId` as OKX names it (BTC-USDT, BTC-USDT-SWAP) */
export function okxHistory(d: HistoryHttp, venue: string, instId: string, interval: CandleInterval, w: CandleWindow): Promise<CandlePage | Refusal> {
  const name = "OKX";
  const g = INTERVAL_MS[interval];
  const swap = instId.endsWith("-SWAP");
  return paged(
    {
      name,
      market: instId,
      interval,
      native: interval,
      pageBars: OKX_PAGE,
      cursor: true,
      closed: closedOf(d, d.clock),
      page: async (_from, to) => {
        await d.pace("okx");
        const got = await getJson(d, venue, name, `${OKX_API}/market/history-candles?instId=${encodeURIComponent(instId)}&bar=${OKX_BAR[interval]}&after=${to + g}&limit=${OKX_PAGE}`);
        if (isRefusal(got)) return got;
        const { r } = got;
        if (r.status !== 200 || !r.body || typeof r.body !== "object") return publicNo(venue, name, r);
        const body = r.body as { code?: unknown; msg?: unknown; data?: unknown };
        if (String(body.code) === "51001") return no("E_VENUE_REJECTED", { venue, message: `${name} lists no instrument ${instId}`, native: { code: "51001" } });
        if (String(body.code) === "50011") return no("E_VENUE_UNREACHABLE", { venue, message: `${name} is rate-limiting this machine: try again in a few seconds`, native: { code: "50011", status: 429, until: Date.now() + 2_000 } });
        if (String(body.code) !== "0" || !Array.isArray(body.data)) return no("E_VENUE_REJECTED", { venue, message: `${name} refused the request: ${String(body.msg ?? body.code ?? "").slice(0, 160)}`, native: { code: body.code } });
        const out: Candle[] = [];
        for (const row of body.data as unknown[]) {
          if (!Array.isArray(row)) continue;
          const b = bar(row[0], row[1], row[2], row[3], row[4], swap ? row[6] : row[5]);
          if (b) out.push(b);
        }
        return out;
      },
    },
    w,
    d.clock(),
  );
}

// ---- Hyperliquid -----------------------------------------------------------------------------------------------------------------------

/** one candleSnapshot asked: its JSON answer, or Hyperliquid's refusal */
export type HlSnapshot = (req: { coin: string; interval: CandleInterval; startTime: number; endTime: number }) => Promise<unknown>;

/** A PERPETUAL'S HISTORY AT HYPERLIQUID (see the top of this file): `coin` as Hyperliquid names it (BTC; a HIP-3 market's with its dex,
 * io:ANTH). `ask` sends one candleSnapshot through the caller's own guard; `name` the source's name ("Hyperliquid", "Hyperliquid testnet") */
export async function hyperliquidHistory(ask: HlSnapshot, pace: Pace, clock: () => number, name: string, coin: string, interval: CandleInterval, w: CandleWindow): Promise<CandlePage | Refusal> {
  const now = clock();
  const asked = interval;
  let size = interval;
  // the range drawn in the finest size whose latest 5,000 bars reach its start (a week is folded from days, which reach years)
  let note: string | undefined;
  if (w.range !== undefined && w.since !== undefined && size !== "1w" && size !== "1d") {
    const order: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
    const reach = (s: CandleInterval): number => Math.floor(now / INTERVAL_MS[s]) * INTERVAL_MS[s] - (HL_KEEPS - 1) * INTERVAL_MS[s];
    for (const s of order.slice(order.indexOf(size))) {
      size = s;
      if (reach(s) <= w.since) break;
    }
    if (size !== asked) note = `${HL_KEEPS_WORDS}: ${INTERVAL_WORDS[asked]} bars do not reach back ${w.range}, so it is drawn in ${INTERVAL_WORDS[size]} bars`;
  }
  const native = size === "1w" ? "1d" : size;
  const { first, last, cut } = plan(size, native, w, now, HL_KEEPS);
  if (first > last) return { bars: [], more: false, source: `${name} · ${coin} perpetual` };
  const g = INTERVAL_MS[native];
  await pace("hyperliquid", hlWeight(Math.min(HL_KEEPS, Math.round((last - first) / g) + 1)));
  const body = await ask({ coin, interval: native, startTime: first, endTime: last + g - 1 });
  if (isRefusal(body)) return body;
  // every bar Hyperliquid answered in the window, traded or not, oldest first
  const raw: Array<{ t: number; n: number | undefined; b: Candle | undefined }> = [];
  for (const c of Array.isArray(body) ? (body as unknown[]) : []) {
    if (!c || typeof c !== "object") continue;
    const x = c as Record<string, unknown>;
    const t = fin(x.t);
    if (t === undefined || t < first || t > last) continue;
    raw.push({ t, n: fin(x.n), b: bar(x.t, x.o, x.h, x.l, x.c, x.v) });
  }
  raw.sort((a, b) => a.t - b.t);
  // a bar with no trade in it (n 0) is never drawn (see the top of this file): a quiet interval, or, opening a daily answer, Hyperliquid's
  // price-only backfill from before it traded the coin
  const real = raw.filter((r) => r.n !== 0 && r.b !== undefined).map((r) => r.b!);
  const bars = native !== size ? foldBars(real, size, "utc", first) : real;
  let lead = 0;
  while (lead < raw.length && raw[lead]!.n === 0) lead++;
  // where Hyperliquid's bars start after the first one asked — its first bar, traded or not — it has none older at this size: the edge of
  // its latest 5,000 there, or its market starting there (at its first traded day, where a daily backfill comes before it)
  const reach = Math.floor(clock() / g) * g - (HL_KEEPS - 1) * g;
  const short = !raw.length || raw[0]!.t > first + g;
  const words = INTERVAL_WORDS[size];
  const backfill = native === "1d" && lead > 0;
  // a window cut to its latest bars at the edge of Hyperliquid's latest 5,000, its start asked before them: the history at this size ends
  // there too
  const edge = !short && cut && first <= reach + g && (w.since === undefined || w.since < first);
  const ends = !short
    ? edge
      ? HL_KEEPS_WORDS
      : undefined
    : !raw.length
      ? last + g <= reach
        ? HL_KEEPS_WORDS
        : `${name} has no ${words} ${coin} bars${w.until !== undefined ? ` before ${utcDay(w.until)}` : ""}`
      : raw[0]!.t <= reach + g
        ? HL_KEEPS_WORDS
        : backfill && !real.length
          ? `${name}'s ${coin} trading starts after ${utcDay(raw[raw.length - 1]!.t)}: its daily bars before then are price-only backfill`
          : `${name}'s ${coin} trading starts ${utcDay((backfill ? real[0]! : raw[0]!).t)}`;
  return {
    bars,
    // older bars exist where the window began inside Hyperliquid's latest 5,000 at this size
    more: !short && (cut || (w.since ?? 0) > 0) && first > reach + g,
    ...(ends ? { ends } : {}),
    ...(size !== asked ? { interval: size } : {}),
    ...(note ? { note } : {}),
    source: `${name} · ${coin} perpetual`,
    ...(native !== size ? { folded: `weekly bars folded from ${name}'s daily bars (weeks from Monday, UTC; its own weeks start on Thursday)` } : {}),
  };
}

// ---- the unified library -----------------------------------------------------------------------------------------------------------

/** the library's client as a history reads it */
export interface LibraryBars {
  fetchOHLCV(symbol: string, timeframe: string, since: number, limit: number): Promise<unknown[]>;
  /** the sizes the exchange publishes, as the library names them (absent: every size is asked) */
  timeframes?: Record<string, unknown> | undefined;
}

/** the exchanges whose own weeks start on Monday, 00:00 UTC, as checked (history-sources.md: Binance's 1w, OKX's 1Wutc — the library asks
 * OKX's utc bars): a week is asked of them as a week. Every other exchange's week is folded from its days, Monday weeks — Kraken's own
 * starts on Thursday, and an exchange whose weeks were never looked at is not taken on trust */
export const MONDAY_WEEKS: ReadonlySet<string> = new Set(["binance", "okx"]);

/** the size asked of the library for `interval`, or why there is none: the interval where the exchange publishes it — a week only where its
 * weeks start on Monday (`mondayWeeks`: MONDAY_WEEKS has the exchange) — else the finer one it is folded from */
export function libraryNative(x: LibraryBars, interval: CandleInterval, mondayWeeks = false): CandleInterval | undefined {
  const has = (s: CandleInterval): boolean => x.timeframes === undefined || Object.hasOwn(x.timeframes, s);
  if (has(interval) && (interval !== "1w" || mondayWeeks)) return interval;
  const finer = FOLD_FROM[interval];
  return finer && has(finer) ? finer : undefined;
}

/** A MARKET'S HISTORY THROUGH THE LIBRARY (see the top of this file): fetchOHLCV from each page's start, `pageBars` at a time, a size the
 * exchange lacks folded. What the library throws for a page is the exchange's refusal in the caller's words (`no`): the newest page's is the
 * answer, an older one's ends the answer there. `inCoin`: the volume the library gives is in the coin (a spot market's, a linear contract of
 * one coin), else none is said */
export function libraryHistory(x: LibraryBars, o: { name: string; symbol: string; inCoin: boolean; pageBars: number; clock: () => number; no: (err: unknown) => Refusal }, interval: CandleInterval, native: CandleInterval, w: CandleWindow): Promise<CandlePage | Refusal> {
  const g = INTERVAL_MS[native];
  return paged(
    {
      name: o.name,
      market: o.symbol,
      interval,
      native,
      pageBars: o.pageBars,
      cursor: false,
      closed: closedOf(x, o.clock),
      page: async (from, to) => {
        let rows: unknown[];
        try {
          rows = await x.fetchOHLCV(o.symbol, native, from, Math.min(o.pageBars, Math.round((to - from) / g) + 1));
        } catch (err) {
          return o.no(err);
        }
        const out: Candle[] = [];
        for (const r of Array.isArray(rows) ? rows : []) {
          if (!Array.isArray(r)) continue;
          const b = bar(r[0], r[1], r[2], r[3], r[4], o.inCoin ? r[5] : undefined);
          if (b) out.push(b);
        }
        return out;
      },
    },
    w,
    o.clock(),
  );
}
