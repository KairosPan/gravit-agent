/** THE MARKET'S PUBLIC READS, the face's Markets reads: what there is to trade (explore), a fresh price for a few A shares (quotes), one
 * market's price history (candles), its order book (book) and its latest trades (trades) — under names without "account", proxied by the
 * face under /data/market (face/src/market-proxy.ts) and read by Gravit through market:mcp. Each answers from the keyless public sources
 * and China alone: the market keeps no venue connected (a connected venue's own reads are the account's, /api/account/connected/…), no
 * list of where the user can connect, and no market-down hold (the market never sees itself down).
 *
 *   GET  /api/explore   ?tab= &q= &key= &sort= &limit=            Exploration
 *   GET  /api/quotes    ?pairs=<venue>|<symbol>,… (or ?pair= each)  {quotes: [{venue, symbol, market? | refusal?}]}: A shares only
 *   GET  /api/candles   ?venue= &symbol= &interval= &range= &before= &limit=   CandlesView, or an A share's ChinaHistory
 *   GET  /api/book      ?venue= &symbol= &depth=                  BookView
 *   GET  /api/trades    ?venue= &symbol= &limit=                  TradesView
 *
 * Each answers 200 with `{ok: true, …}`, a refusal 409 `{ok: false, refusal}`, a malformed question 400 `{ok: false, error}`. Nothing is
 * ordered or signed. */
import type express from "express";
import { isRefusal, type Refusal } from "./core/errors.ts";
import { no } from "./refuse.ts";
import type { MarketCore } from "./core.ts";
import { TABS, type TabId } from "./live/categories.ts";
import { CHINA_ID, CHINA_NAME, CHINA_NOTE, type ChinaHistory, type ChinaMarket } from "./live/china.ts";
import type { ChinaRange } from "./live/cn-history.ts";
import { RANK_ROWS } from "./live/cn-rank.ts";
import { exploreAcross, type Exploration, type ExploreSort } from "./live/explore.ts";
import { INTERVAL_RANGE, PAGE_MOST, pageOf, RANGE_BAR, rangeSince, sessionsSince } from "./live/history.ts";
import { KEEP_MS as LISTING_KEEP_MS, type PublicSource } from "./live/public-markets.ts";
import { CANDLE_INTERVALS, CANDLE_RANGES, HISTORY_MOST, type Candle, type CandleInterval, type CandlePage, type CandleRange, type CandleWindow, type Market, type OrderBook, type PublicTrade } from "./live/trade.ts";
import { PUBLIC_KEEP_MS, thrownBy } from "./read-cache.ts";
import { wrap } from "./routes-cn.ts";

export interface MarketReads {
  explore(o: { tab?: string | undefined; q?: string | undefined; key?: string | undefined; sort?: string | undefined; limit?: number | undefined }): Promise<Exploration | Refusal>;
  quotes(pairs: Array<{ venue: string; symbol: string }>): Promise<Array<{ venue: string; symbol: string; market?: Market; refusal?: Refusal }> | Refusal>;
  candles(venue: string, symbol: string, interval: string, ask: { range?: string | undefined; before?: string | number | undefined; limit?: string | number | undefined }): Promise<CandlesView | ChinaHistory | Refusal>;
  book(venue: string, symbol: string, depth?: number): Promise<BookView | Refusal>;
  trades(venue: string, symbol: string, limit?: number): Promise<TradesView | Refusal>;
}

/** one market's price history, as GET /api/candles answers it (live/trade.ts CandlePage for the words) */
export interface CandlesView {
  venue: string;
  venueName: string;
  symbol: string;
  /** the bars' size: the one asked, or the coarser one the source drew a range in (`note` says why) */
  interval: CandleInterval;
  /** the range this first view covers, or the bar a page was asked before (ms) */
  range?: CandleRange | undefined;
  before?: number | undefined;
  /** oldest first */
  candles: Candle[];
  /** older bars exist: the next page is asked `before` the first bar's start */
  more: boolean;
  /** the answer stops short of what was asked for a reason other than the history (a page further back was refused, or did not answer:
   * live/trade.ts CandlePage.partial) — a page scrolled left with no bars and this is one that did not come, never where the history ends */
  partial?: true | undefined;
  /** where the history ends inside what was asked, and why, in a sentence */
  ends?: string | undefined;
  note?: string | undefined;
  /** whose bars these are (venue · market), what their prices are adjusted for, which hours they cover, what they were folded from */
  source?: string | undefined;
  adjustment?: string | undefined;
  session?: string | undefined;
  folded?: string | undefined;
  /** stretches inside the bars with none, [from, to) ms and why ("No overnight data"): said, never filled */
  gaps?: Array<{ from: number; to: number; why: string }> | undefined;
  /** the last bar built from intraday bars, and its words ("Today so far") */
  today?: { t: number; words: string } | undefined;
  /** read from the venue's public market data, without a key: the venue is not connected */
  public?: true | undefined;
  /** whose bars these are, where not the venue's own: a paper account's market's public source */
  from?: string | undefined;
}

/** one market's order book, as GET /api/book answers it */
export interface BookView {
  venue: string;
  venueName: string;
  symbol: string;
  book: OrderBook;
  /** read from the venue's public market data, without a key: the venue is not connected */
  public?: true | undefined;
}
/** one market's latest trades, newest first, as GET /api/trades answers it */
export interface TradesView {
  venue: string;
  venueName: string;
  symbol: string;
  trades: PublicTrade[];
  /** the source publishes no trades at all, in a sentence ("US stocks publishes no trades the market can read"); `trades` is then empty and
   * asking again would say the same, so the face stops asking until the market changes */
  none?: string | undefined;
  public?: true | undefined;
}

/** how long a search waits for China's hits beside the other sources (exploreAcross's per-source budget): late, they are `missing` */
export const CHINA_SEARCH_WAIT_MS = 4_000;
/** the market's words where it reads no China */
const CHINA_NOT_READ = "China is not read by this market";
const EXPLORE_SORTS: readonly ExploreSort[] = ["volume", "movers", "closing"];
/** how long a chart's first view may take (Nasdaq's whole history of a share is about ten seconds), and one page scrolled left */
export const HISTORY_WAIT_MS = 20_000;
export const PAGE_WAIT_MS = 12_000;
/** how long a book and the latest trades are kept (the face asks every two and every four seconds), and how long either is waited for */
const BOOK_KEEP_MS = 1_500;
const TRADES_KEEP_MS = 3_000;
const BOOK_WAIT_MS = 5_000;
/** how old a listing's quote that carries no time of its own may be when a book here shows it: the source keeps the quote LISTING_KEEP_MS
 * from when it read it, and the read cache keeps the listing PUBLIC_KEEP_MS from when it asked */
const LISTED_QUOTE_UP_TO_MS = LISTING_KEEP_MS + PUBLIC_KEEP_MS;

/** What is text on a page, and nothing else is taken (account/src/portfolio/account/state.ts isPlain): letters, marks, digits,
 * punctuation, symbols and spaces — an allow-list — and nothing Unicode says is shown as nothing */
const PLAIN = /^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]*$/u;
const IGNORED = /\p{Default_Ignorable_Code_Point}/u;
const isPlain = (text: string): boolean => PLAIN.test(text) && !IGNORED.test(text);

/** WHOSE BARS A CHART SAYS THEY ARE (CandlesView.from): the source the market is priced from (`named`), unless its page names another
 * exchange's bars — then that venue, so the chart's name and the face's source never disagree. A source that speaks for several venues
 * (the US stocks line) keeps its own name */
function barsFrom(page: CandlePage, named: string, kind: PublicSource["kind"] | undefined): string {
  const venue = page.source?.split(" · ")[0]?.trim();
  return kind === "exchange" && venue && !page.source!.startsWith(named) ? venue : named;
}

/** A PRICE HISTORY AS ASKED (GET /api/candles): the bar size (empty: the range's own, else 1h), a range or the bar a page is asked before —
 * never both — and the most bars, held to what can be asked; or why not, in words (service.ts historyAsk) */
export function historyAsk(interval: string, ask: { range?: string | undefined; before?: string | number | undefined; limit?: string | number | undefined }): { iv: CandleInterval; range?: CandleRange | undefined; before?: number | undefined; limit: number } | Refusal {
  const r = String(ask.range ?? "").trim().toUpperCase();
  if (r && !(CANDLE_RANGES as readonly string[]).includes(r)) return no("E_ACCOUNT_BAD_ACTION", { message: `a range is one of ${CANDLE_RANGES.join(", ")}` });
  const b = String(ask.before ?? "").trim();
  if (b && !/^\d{1,15}$/.test(b)) return no("E_ACCOUNT_BAD_ACTION", { message: "a page of price history is asked before a bar's start, in milliseconds" });
  if (r && b) return no("E_ACCOUNT_BAD_ACTION", { message: "price history is asked for a range or for the page before a bar, not both" });
  const range = r ? (r as CandleRange) : undefined;
  const iv = (interval || (range ? RANGE_BAR[range] : "1h")).trim();
  if (!(CANDLE_INTERVALS as readonly string[]).includes(iv)) return no("E_ACCOUNT_BAD_ACTION", { message: `price history is by ${CANDLE_INTERVALS.join(", ")}` });
  const most = b ? PAGE_MOST : HISTORY_MOST;
  const l = String(ask.limit ?? "").trim();
  if (l && !(/^\d{1,6}$/.test(l) && Number(l) >= 1 && Number(l) <= most)) return no("E_ACCOUNT_BAD_ACTION", { message: `a ${b ? "page" : "view"} of price history holds 1 to ${most.toLocaleString("en-US")} bars` });
  const before = b ? Number(b) : undefined;
  if (before !== undefined && !(before > 0)) return no("E_ACCOUNT_BAD_ACTION", { message: "a page of price history is asked before a bar's start, in milliseconds" });
  return { iv: iv as CandleInterval, range: before !== undefined ? undefined : (range ?? INTERVAL_RANGE[iv as CandleInterval]), ...(before !== undefined ? { before } : {}), limit: l ? Number(l) : b ? 300 : HISTORY_MOST };
}

/** why a book is only its best bid and ask (trade.ts OrderBook.topOnly) */
type TopOnly = NonNullable<OrderBook["topOnly"]>;
/** A market's best bid and best ask as the market itself carries them, as a book of depth "top", and why that is all (`topOnly`). No size:
 * the market gives none. Stamped with the quote's own time where it has one; else with now, and — where the market came from a list kept a
 * while (`keptMs`) — how old its quote may be (`upToMs`). Named by the source its quote came from (`quoteFrom`), else the venue. Nothing
 * when it carries neither (service.ts topBook) */
function topBook(m: Market, venueName: string, now: number, topOnly: TopOnly, keptMs?: number): OrderBook | undefined {
  const good = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : undefined);
  const bid = good(m.bid);
  const ask = good(m.ask);
  if (bid === undefined && ask === undefined) return undefined;
  const stamped = m.quoteAt ? Date.parse(m.quoteAt) : NaN;
  const own = Number.isFinite(stamped);
  return { bids: bid !== undefined ? [[bid, null]] : [], asks: ask !== undefined ? [[ask, null]] : [], at: new Date(own ? stamped : now).toISOString(), from: m.quoteFrom ?? venueName, depth: "top", topOnly, ...(!own && keptMs !== undefined ? { upToMs: keptMs } : {}) };
}

/** an answer within `ms`, or the venue's not answering as a refusal; a throw is a refusal too. The call is not stopped: its answer is just
 * not waited for (service.ts within) */
function within<T>(ms: number, p: Promise<T | Refusal>, venue: string, name: string): Promise<T | Refusal> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Refusal>((resolve) => {
    timer = setTimeout(() => resolve(no("E_VENUE_UNREACHABLE", { venue, message: `${name} did not answer in ${ms / 1000} seconds` })), ms);
  });
  const said = p.catch((err: unknown) => no("E_VENUE_UNREACHABLE", { venue, message: `${name}: ${String((err as Error)?.message ?? err).slice(0, 160)}` }));
  return Promise.race([said, late]).finally(() => clearTimeout(timer));
}

/** a venue named that is no public source: Markets names each source by its id */
const notPublic = (id: string): Refusal => no("E_MARKET_UNKNOWN_SOURCE", { venue: id, message: `"${id.slice(0, 40)}" is not a public market source: Markets names each source by its id` });

export function marketReads(core: MarketCore): MarketReads {
  const cache = core.cache;
  const now = () => core.now();

  /** THE CHINA TAB: Tencent's ranking by turnover (`volume`, the default) or by the day's move (`movers`), at most RANK_ROWS rows, with its
   * read — or, with `q`, China's hits alone. A refusal of the source is the answer */
  async function exploreChina(q: string, sort: string | undefined, limit: number): Promise<Exploration | Refusal> {
    const china = core.china;
    if (!china) return no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message: CHINA_NOT_READ });
    if (sort === "closing") return no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message: "China is sorted by volume or movers" });
    const body = { movers: [], closing: [], mostTraded: [], missing: [], notes: [CHINA_NOTE] };
    if (q) {
      const hits = await china.search(q);
      if (isRefusal(hits)) return hits;
      return { asOf: new Date(now()).toISOString(), tabs: [{ id: "china", label: "China", count: hits.length }], items: hits.slice(0, limit), ...body };
    }
    const got = await china.rank(sort === "movers" ? "movers" : "volume");
    if (isRefusal(got)) return got;
    return { asOf: got.read.asOf, tabs: [{ id: "china", label: "China", count: got.read.total }], items: got.items.slice(0, Math.min(limit, RANK_ROWS)), ...body, china: got.read };
  }

  /** a venue and a market as the book and the trades take them (as `candles` does): a venue's id, and the market as plain text */
  function oneMarket(venue: string, symbol: string): { id: string; sym: string } | Refusal {
    const id = venue.trim();
    const sym = symbol.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) return no("E_ACCOUNT_BAD_ACTION", { message: "a venue is named by its id: lower-case letters, digits and dashes" });
    if (!sym || sym.length > 160 || !isPlain(sym)) return no("E_ACCOUNT_BAD_ACTION", { message: "a market is named by its symbol at that venue: 1 to 160 characters of plain text" });
    return { id, sym };
  }

  /** a public source's book or trades through the read cache, held under the source's name as its other reads are (a source that reads
   * them from another host than its listings, apart: `#history`), within BOOK_WAIT_MS */
  function publicRead(src: PublicSource, what: "book" | "trades", sym: string, n: number): Promise<OrderBook | PublicTrade[] | Refusal> {
    const at = `public:${src.id}${src.historyApart ? "#history" : ""}`;
    const load = (): Promise<OrderBook | PublicTrade[] | Refusal> => (what === "book" ? src.book!(sym, n) : src.trades!(sym, n)).catch((err: unknown) => thrownBy(src.id, src.name, err));
    return within(BOOK_WAIT_MS, cache.get(`public-${what}|${src.id}|${sym}|${n}`, what === "book" ? BOOK_KEEP_MS : TRADES_KEEP_MS, load, at), src.id, src.name);
  }

  return {
    /** MARKETS: what the public sources publish without a key (marked "Connect to trade"), as one list with its tabs, its movers, what closes
     * soon and what trades most (live/explore.ts), China's hits beside them on a search. The same question is answered from what was found
     * for thirty seconds. `key`, a row's own exactly as `items` names it, keeps only that row */
    async explore(o = {}) {
      const tab = o.tab?.trim() || undefined;
      if (tab !== undefined && !TABS.some((t) => t.id === tab)) return no("E_ACCOUNT_BAD_ACTION", { message: `a tab is one of ${TABS.map((t) => t.id).join(", ")}` });
      const sort = o.sort?.trim() || undefined;
      if (sort !== undefined && !EXPLORE_SORTS.includes(sort as ExploreSort)) return no("E_ACCOUNT_BAD_ACTION", { message: `markets are sorted by ${EXPLORE_SORTS.join(", ")}` });
      const q = (o.q ?? "").trim();
      if (q.length > 60) return no("E_ACCOUNT_BAD_ACTION", { message: "a search is at most 60 characters" });
      const key = (o.key ?? "").trim();
      if (key.length > 200) return no("E_ACCOUNT_BAD_ACTION", { message: "a row's key is at most 200 characters" });
      const limit = o.limit === undefined ? 60 : Math.floor(o.limit);
      if (!(limit >= 1 && limit <= 200)) return no("E_ACCOUNT_BAD_ACTION", { message: "a limit is 1 to 200 markets" });
      // CHINA is its own tab, asked of its own source (which keeps its reads): never kept here, never in All
      if (tab === "china") return exploreChina(q, sort, limit);
      // a search on All asks China too, beside the other sources and within their budget; no other tab ever asks it
      const china = q && !key && (tab === undefined || tab === "all") ? core.china : undefined;
      const pub = core.sources();
      // the key exactly as asked (a row's key is not a search: kalshi:KXFED and kalshi:kxfed are not one row), written so that no `|` in it
      // reads as the next part of the question
      return cache.get(`explore|${tab ?? ""}|${q.toUpperCase()}|${encodeURIComponent(key)}|${sort ?? ""}|${limit}`, 30_000, async (): Promise<Exploration | Refusal> => {
        const [explored, hits] = await Promise.all([
          exploreAcross({ connected: [], public: pub }, { q, ...(key ? { key } : {}), limit, clock: now, ...(tab ? { tab: tab as TabId } : {}), ...(sort ? { sort: sort as ExploreSort } : {}) }),
          china ? within(CHINA_SEARCH_WAIT_MS, china.search(q), CHINA_ID, CHINA_NAME) : undefined,
        ]);
        if (hits === undefined) return explored;
        // China's hits after the dollar rows; a late or refused China half is said in `missing`, the rest answered without it
        if (isRefusal(hits)) return { ...explored, missing: [...explored.missing, { venue: CHINA_ID, venueName: CHINA_NAME, connected: false, why: hits.message, code: hits.code }] };
        return { ...explored, items: [...explored.items, ...hits].slice(0, limit) };
      });
    },

    /** a fresh price for each of a few A shares, from China's source in ONE read. Any other pair is refused by name: a public market's
     * price is in explore's rows, and a connected venue's quote is the account's (/api/account/connected/quotes) */
    async quotes(pairs) {
      if (!pairs.length || pairs.length > 12) return no("E_ACCOUNT_BAD_ACTION", { message: "quotes are asked for 1 to 12 markets at once, each venue|symbol" });
      const six = (p: { symbol: string }) => /^\d{6}$/.test(p.symbol);
      const asked = pairs.filter((p) => p.venue === CHINA_ID && six(p)).map((p) => p.symbol);
      const china = core.china;
      const cn: Promise<Map<string, ChinaMarket> | Refusal> = !asked.length ? Promise.resolve(new Map())
        : china ? china.quotes(asked) : Promise.resolve(no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message: CHINA_NOT_READ }));
      return Promise.all(pairs.map(async (p) => {
        if (p.venue === CHINA_ID) {
          if (!china) return { ...p, refusal: no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message: CHINA_NOT_READ }) };
          if (!six(p)) return { ...p, refusal: no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message: "an A share is its six digits" }) };
          const got = await cn;
          if (isRefusal(got)) return { ...p, refusal: got };
          const m = got.get(p.symbol);
          return m ? { ...p, market: m } : { ...p, refusal: no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message: `no A-share quote for ${p.symbol}` }) };
        }
        return { ...p, refusal: no("E_VENUE_RAIL_CLOSED", { venue: p.venue, message: `"${p.venue}" is priced in explore: the market quotes A shares only (venue "china")` }) };
      }));
    },

    /** ONE MARKET'S PRICE HISTORY, from its public source, without a key (live/public-markets.ts), or an A share's from China, by range.
     * Asked by a range (`range`, in its own bar size unless one is named) or by a page (`before` a bar's start, and `limit`). Each answer
     * kept by the source's read cache (keptSource) */
    async candles(venue, symbol, interval, ask = {}) {
      const id = venue.trim();
      const sym = symbol.trim();
      if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) return no("E_ACCOUNT_BAD_ACTION", { message: "a venue is named by its id: lower-case letters, digits and dashes" });
      if (!sym || sym.length > 160 || !isPlain(sym)) return no("E_ACCOUNT_BAD_ACTION", { message: "a market is named by its symbol at that venue: 1 to 160 characters of plain text" });
      // an A share's history is Tencent's, by range, in Shanghai's sessions (china.ts history): decided before any bar size or New York window
      if (id === CHINA_ID) {
        const china = core.china;
        if (!china) return no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message: CHINA_NOT_READ });
        if (ask.before !== undefined && String(ask.before).trim() !== "") return no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message: "an A share's history is read by range" });
        const range = (ask.range ?? "").trim();
        if (!(CANDLE_RANGES as readonly string[]).includes(range)) return no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message: `a range is one of ${CANDLE_RANGES.join(", ")}` });
        return china.history(sym, range as ChinaRange);
      }
      const asked = historyAsk(interval, ask);
      if (isRefusal(asked)) return asked;
      const { iv, range, before, limit } = asked;
      const t = now();
      const w: CandleWindow = before !== undefined ? { until: before, limit } : { since: rangeSince(range!, t), limit, range };
      // the window the answer is held to: a US stock's 1D and 5D are its latest sessions (the source counts them so), which may start earlier
      const held: CandleWindow = w.range !== undefined && w.since !== undefined ? { ...w, since: Math.min(w.since, sessionsSince(w.range, t)) } : w;
      const wait = before !== undefined ? PAGE_WAIT_MS : HISTORY_WAIT_MS;
      const said = (page: CandlePage, base: { venue: string; venueName: string; public?: true; from?: string }): CandlesView => ({
        ...base,
        symbol: sym,
        interval: page.interval ?? iv,
        ...(before !== undefined ? { before } : { range }),
        candles: page.bars,
        more: page.more,
        ...(page.partial ? { partial: true as const } : {}),
        ...(page.ends ? { ends: page.ends } : {}),
        ...(page.note ? { note: page.note } : {}),
        ...(page.source ? { source: page.source } : {}),
        ...(page.adjustment ? { adjustment: page.adjustment } : {}),
        ...(page.session ? { session: page.session } : {}),
        ...(page.folded ? { folded: page.folded } : {}),
        ...(page.gaps?.length ? { gaps: page.gaps } : {}),
        ...(page.today ? { today: page.today } : {}),
      });
      const src = core.source(id);
      if (!src) return notPublic(id);
      if (!src.candles) return no("E_VENUE_RAIL_CLOSED", { venue: id, message: `${src.name} publishes no price history` });
      // kept under the source's id (keptSource): a source that refused this location is not asked again for ten minutes
      const got = await within(wait, src.candles(sym, iv, w), id, src.name);
      if (isRefusal(got)) return got;
      const page = pageOf(got, iv, held);
      const from = barsFrom(page, src.name, src.kind);
      return said(page, { venue: id, venueName: src.name, public: true, ...(from !== src.name ? { from } : {}) });
    },

    /** ONE MARKET'S ORDER BOOK from its public source, `depth` levels a side, 1 to 50, best first. A source with no book: its listing's best
     * bid and ask (`depth: "top"`), with why that is all (`topOnly`: "none" where the source publishes no depth at all — US stocks' public
     * quotes — else "unread"). Each answer kept a second and a half (BOOK_KEEP_MS) */
    async book(venue, symbol, depth = 20) {
      const asked = oneMarket(venue, symbol);
      if (isRefusal(asked)) return asked;
      const { id, sym } = asked;
      if (!(Number.isInteger(depth) && depth >= 1 && depth <= 50)) return no("E_ACCOUNT_BAD_ACTION", { message: "a book is read 1 to 50 levels a side" });
      const t = now();
      const src = core.source(id);
      if (!src) return notPublic(id);
      if (src.book) {
        const got = await publicRead(src, "book", sym, depth);
        return isRefusal(got) ? got : { venue: id, venueName: src.name, symbol: sym, book: got as OrderBook, public: true };
      }
      // a source with no book: its listing's best bid and ask (the listings are kept as Markets keeps them). US stocks' public quotes have no
      // depth at all; the others (Stock Tokens, xStocks at Gate, the exchanges' pre-IPO contracts) have a book that is not read here
      const topOnly: TopOnly = src.kind === "stocks" ? "none" : "unread";
      const listed = await within(BOOK_WAIT_MS, src.listings({ q: sym, limit: 20 }), id, src.name);
      if (isRefusal(listed)) return listed;
      const m = listed.find((x) => x.symbol === sym);
      if (!m) return no("E_VENUE_REJECTED", { venue: id, message: `${src.name} lists no market ${sym.slice(0, 60)} just now` });
      const top = topBook(m, src.name, t, topOnly, LISTED_QUOTE_UP_TO_MS);
      return top ? { venue: id, venueName: src.name, symbol: sym, book: top, public: true } : no("E_VENUE_RAIL_CLOSED", { venue: id, message: `${topOnly === "none" ? `${src.name} publishes no order book` : `The market reads no order book from ${src.name}`}, and it gives no best bid or ask for ${sym.slice(0, 60)} just now` });
    },

    /** ONE MARKET'S LATEST TRADES from its public source, newest first, `limit` of them at most (1 to 100). Kept three seconds
     * (TRADES_KEEP_MS). A source that publishes no trades at all is not refused: the answer is an empty list with `none`, the sentence saying
     * so, and the face stops asking until the market changes */
    async trades(venue, symbol, limit = 30) {
      const asked = oneMarket(venue, symbol);
      if (isRefusal(asked)) return asked;
      const { id, sym } = asked;
      if (!(Number.isInteger(limit) && limit >= 1 && limit <= 100)) return no("E_ACCOUNT_BAD_ACTION", { message: "the latest trades are read 1 to 100 at a time" });
      const src = core.source(id);
      if (!src) return notPublic(id);
      if (!src.trades) return { venue: id, venueName: src.name, symbol: sym, trades: [], none: `${src.name} publishes no trades the market can read`, public: true };
      const got = await publicRead(src, "trades", sym, limit);
      return isRefusal(got) ? got : { venue: id, venueName: src.name, symbol: sym, trades: got as PublicTrade[], public: true };
    },
  };
}

/** THE ROUTES: each read's query parsed and answered with its status code (200, 409 a refusal, 400 a malformed question) */
export function mountReads(app: express.Express, _core: MarketCore, reads: MarketReads): void {
  const bad = (res: express.Response, error: string) => res.status(400).json({ ok: false, error });
  /** a route's query parameters as strings, each cut to its length; one given twice is a malformed request — neither copy is picked */
  const strings = <K extends string>(req: express.Request, res: express.Response, want: Record<K, number>): Record<K, string> | undefined => {
    const out = {} as Record<K, string>;
    for (const k of Object.keys(want) as K[]) {
      const v = req.query[k];
      if (Array.isArray(v)) return void bad(res, `"${k}" is given more than once`);
      out[k] = typeof v === "string" ? v.slice(0, want[k]) : "";
    }
    return out;
  };
  const answerOf = <T extends object>(res: express.Response, r: T | Refusal, key?: string) => void res.status(isRefusal(r) ? 409 : 200).json(isRefusal(r) ? { ok: false, refusal: r } : key ? { ok: true, [key]: r } : { ok: true, ...r });

  // MARKETS: what there is to trade, keyless ("Connect to trade"). A limit is a plain count of markets (digits), nothing a number parser
  // would also take. A key is one row's own, given once: read past the 200 characters the read takes, so that a longer one is refused there
  // rather than cut into another
  app.get("/api/explore", wrap(async (req, res) => {
    const q = strings(req, res, { tab: 20, q: 80, key: 240, sort: 20, limit: 6 });
    if (!q) return;
    if (q.limit && !/^\d{1,3}$/.test(q.limit)) return void bad(res, "limit is a count of markets, 1 to 200, in digits");
    answerOf(res, await reads.explore({ tab: q.tab, q: q.q, key: q.key, sort: q.sort, ...(q.limit ? { limit: Number(q.limit) } : {}) }));
  }));

  // a fresh price for each of up to twelve markets: ?pairs=china|600519,okx|BTC/USDT (or one ?pair= each). How many is the read's rule,
  // answered as its refusal; the shape of each is this route's
  app.get("/api/quotes", wrap(async (req, res) => {
    const list = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");
    const pairs = [...list(req.query.pairs).flatMap((x) => x.split(",")), ...list(req.query.pair)].map((x) => x.trim()).filter(Boolean);
    const parsed = pairs.map((x) => ({ venue: x.slice(0, Math.max(0, x.indexOf("|"))), symbol: x.slice(x.indexOf("|") + 1).slice(0, 160) }));
    if (parsed.some((p) => !p.venue || !p.symbol)) return void bad(res, "each market is venue|symbol, e.g. okx|BTC/USDT");
    answerOf(res, await reads.quotes(parsed), "quotes");
  }));

  // one market's price history, a public source's without a key. The venue is a source's id and the symbol plain text: neither ever names a
  // host
  app.get("/api/candles", wrap(async (req, res) => {
    const q = strings(req, res, { venue: 60, symbol: 200, interval: 4, range: 4, before: 16, limit: 6 });
    if (!q) return;
    answerOf(res, await reads.candles(q.venue, q.symbol, q.interval, { range: q.range, before: q.before, limit: q.limit }));
  }));

  // one market's order book (best first, `depth` levels a side, 1 to 50) and its latest trades (newest first, `limit`, 1 to 100); a market
  // whose source has no book, its best bid and ask only
  app.get("/api/book", wrap(async (req, res) => {
    const q = strings(req, res, { venue: 60, symbol: 200, depth: 4 });
    if (!q) return;
    if (q.depth && !/^\d{1,2}$/.test(q.depth)) return void bad(res, "depth is a count of levels a side, 1 to 50, in digits");
    answerOf(res, await reads.book(q.venue, q.symbol, q.depth ? Number(q.depth) : 20));
  }));
  app.get("/api/trades", wrap(async (req, res) => {
    const q = strings(req, res, { venue: 60, symbol: 200, limit: 5 });
    if (!q) return;
    if (q.limit && !/^\d{1,3}$/.test(q.limit)) return void bad(res, "limit is a count of trades, 1 to 100, in digits");
    answerOf(res, await reads.trades(q.venue, q.symbol, q.limit ? Number(q.limit) : 30));
  }));
}
