/** THE MARKET'S PUBLIC READS, the face's Markets reads: what there is to trade (explore), a fresh price for a few A shares (quotes), one
 * market's price history (candles), its order book (book) and its latest trades (trades) — under names without "account", proxied by the
 * face under /data/market (face/src/market-proxy.ts) and read by gravit through market:mcp. Each answers from the keyless public sources,
 * China, and the local regions (Hong Kong, Korea, Taiwan, the world's cash indices: live/local.ts) alone: the market keeps no venue
 * connected (a connected venue's own reads are the account's, /api/account/connected/…), no
 * list of where the user can connect, and no market-down hold (the market never sees itself down).
 *
 *   GET  /api/explore   ?scope= &source= &tab= &q= &key= &sort= &limit=  Exploration; or by underlying, ?asset= &form= &region= with
 *                       &source=<id>,<id>… (never beside scope or tab), region=cn being the China read, region=hk|kr|tw on Stocks Spot that
 *                       region's ranking, asset=indices&form=spot a region's cash indices
 *   GET  /api/quotes    ?pairs=<venue>|<symbol>,… (or ?pair= each)  {quotes: [{venue, symbol, market? | refusal?}]}: A shares (china), Hong
 *                       Kong, Korean and Taiwanese shares (hk, kr, tw) and the cash indices (ix)
 *   GET  /api/candles   ?venue= &symbol= &interval= &range= &since= &before= &limit=   CandlesView, or an A share's ChinaHistory, or a local
 *                       region's LocalHistory (hk, kr, tw, ix: by range)
 *   GET  /api/book      ?venue= &symbol= &depth=                  BookView
 *   GET  /api/trades    ?venue= &symbol= &limit=                  TradesView
 *   GET  /api/news      ?symbols=<A,B> &since=<ISO time>          {news: {<SYM>: Headline[]}, unavailable?: {<SYM>: reason}}: US shares
 *
 * Each answers 200 with `{ok: true, …}`, a refusal 409 `{ok: false, refusal}`, a malformed question 400 `{ok: false, error}`. Nothing is
 * ordered or signed. */
import type express from "express";
import { isRefusal, type Refusal } from "./core/errors.ts";
import { no } from "./refuse.ts";
import type { MarketCore } from "./core.ts";
import { ASSET_IDS, FORM_IDS, REGION_IDS, TABS, type AssetId, type FormId, type RegionId, type TabId } from "./live/categories.ts";
import { CHINA_ID, CHINA_NAME, CHINA_NOTE, type ChinaHistory, type ChinaMarket } from "./live/china.ts";
import type { ChinaRange } from "./live/cn-history.ts";
import { RANK_ROWS } from "./live/cn-rank.ts";
import { HK_NOTE } from "./live/hongkong.ts";
import { hkCode } from "./live/hk-parse.ts";
import { krCode } from "./live/kr-parse.ts";
import { twCode } from "./live/tw-parse.ts";
import { WORLD_INDICES } from "./live/world-indices.ts";
import type { LocalHistory, LocalMarket, LocalVenue } from "./live/local.ts";
import { NEWS_ID, NEWS_KEEP_MS, NEWS_NAME, type Headline } from "./live/news.ts";
import { US_TICKER } from "./live/us-quotes.ts";
import { exploreAcross, type Exploration, type ExploreItem, type ExploreSort } from "./live/explore.ts";
import { INTERVAL_RANGE, PAGE_MOST, pageOf, RANGE_BAR, rangeSince, sessionsSince } from "./live/history.ts";
import { KEEP_MS as LISTING_KEEP_MS, type PublicSource } from "./live/public-markets.ts";
import { CANDLE_INTERVALS, CANDLE_RANGES, HISTORY_MOST, type Candle, type CandleInterval, type CandlePage, type CandleRange, type CandleWindow, type Market, type OrderBook, type PublicTrade } from "./live/trade.ts";
import { PUBLIC_KEEP_MS, thrownBy } from "./read-cache.ts";
import { wrap } from "./routes-cn.ts";

export interface MarketReads {
  /** `source` is one source's id or a comma list of them; `asset`, `form` and `region` (categories.ts) ask by underlying */
  explore(o: { scope?: string | undefined; source?: string | undefined; tab?: string | undefined; q?: string | undefined; key?: string | undefined; sort?: string | undefined; limit?: number | undefined; asset?: string | undefined; form?: string | undefined; region?: string | undefined }): Promise<Exploration | Refusal>;
  quotes(pairs: Array<{ venue: string; symbol: string }>): Promise<Array<{ venue: string; symbol: string; market?: Market; refusal?: Refusal }> | Refusal>;
  candles(venue: string, symbol: string, interval: string, ask: { range?: string | undefined; before?: string | number | undefined; since?: string | number | undefined; limit?: string | number | undefined }): Promise<CandlesView | ChinaHistory | LocalHistory | Refusal>;
  book(venue: string, symbol: string, depth?: number): Promise<BookView | Refusal>;
  trades(venue: string, symbol: string, limit?: number): Promise<TradesView | Refusal>;
  /** each US share's latest headlines (at most NEWS_PER_SYMBOL, newest first, none older than `since`), a feed that refuses under
   * `unavailable` with its reason */
  news(symbols: readonly string[], since?: string): Promise<NewsView | Refusal>;
}

/** the headlines GET /api/news answers: by symbol, and the symbols whose feed refused, each with the refusal's words */
export interface NewsView {
  news: Record<string, Headline[]>;
  unavailable?: Record<string, string> | undefined;
}
/** the most headlines a symbol answers */
export const NEWS_PER_SYMBOL = 10;
/** the most symbols one ask names */
export const NEWS_SYMBOLS_MOST = 10;
/** how long one symbol's feed is waited for, its turn in Nasdaq's line included: inside the face's ten seconds (face/src/market-news.ts) */
const NEWS_WAIT_MS = 9_000;
const NEWS_NOT_READ = "this market reads no headlines";

/** one market's price history, as GET /api/candles answers it (live/trade.ts CandlePage for the words) */
export interface CandlesView {
  venue: string;
  venueName: string;
  symbol: string;
  /** the bars' size: the one asked, or the coarser one the source drew a range in (`note` says why) */
  interval: CandleInterval;
  /** the range this first view covers, or the bar a page was asked before (ms); a dated window: its start (`since`) and its end (`before`),
   * both ms */
  range?: CandleRange | undefined;
  before?: number | undefined;
  since?: number | undefined;
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

/** how long a search waits for China's hits (and Hong Kong's, Korea's and Taiwan's) beside the other sources (exploreAcross's per-source
 * budget): late, they are `missing` */
export const CHINA_SEARCH_WAIT_MS = 4_000;
/** the market's words where it reads no China */
const CHINA_NOT_READ = "China is not read by this market";
const EXPLORE_SORTS: readonly ExploreSort[] = ["volume", "movers", "closing"];

/** THE LOCAL REGIONS' WORDS: each venue's name on a page, how its code is typed (live/*-parse.ts), and its refusals in the market's words */
type ShareVenue = "hk" | "kr" | "tw";
const SHARE_VENUES: readonly ShareVenue[] = ["hk", "kr", "tw"];
const isShareVenue = (v: string | undefined): v is ShareVenue => (SHARE_VENUES as readonly string[]).includes(v ?? "");
const isLocalVenue = (v: string): v is LocalVenue => isShareVenue(v) || v === "ix";
/** an index as a pair names it: `<region>:<id>` from the market's list (world-indices.ts WORLD_INDICES), lower-cased */
const ixCode = (s: string): string | null => {
  const id = s.trim().toLowerCase();
  return WORLD_INDICES.some((i) => `${i.region}:${i.id}` === id) ? id : null;
};
const LOCAL_WORDS: Record<LocalVenue, { label: string; notRead: string; notSource: string; sorted: string; code: (s: string) => string | null; bad: string; quote: string; history: string; note: string }> = {
  hk: { label: "Hong Kong", notRead: "Hong Kong is not read by this market", notSource: "Hong Kong is not part of a selected public source", sorted: "Hong Kong is sorted by volume or movers",
    code: hkCode, bad: "a Hong Kong share is its code, up to five digits", quote: "Hong Kong", history: "a Hong Kong share's history is read by range", note: HK_NOTE },
  kr: { label: "Korea", notRead: "Korea is not read by this market", notSource: "Korea is not part of a selected public source", sorted: "Korea is sorted by volume or movers",
    code: krCode, bad: "a Korean share is its code, six digits or letters", quote: "Korean", history: "a Korean share's history is read by range",
    note: "Korea: KOSPI shares as Naver gives them, view-only and priced in KRW; no venue here trades them." },
  tw: { label: "Taiwan", notRead: "Taiwan is not read by this market", notSource: "Taiwan is not part of a selected public source", sorted: "Taiwan is sorted by volume or movers",
    code: twCode, bad: "a Taiwan share is its code, four to six digits or letters", quote: "Taiwan", history: "a Taiwan share's history is read by range",
    note: "Taiwan: TWSE-listed shares as TWSE gives them, view-only and priced in TWD; no venue here trades them." },
  ix: { label: "Indices", notRead: "The cash indices are not read by this market", notSource: "The cash indices are not part of a selected public source", sorted: "The cash indices are sorted by volume or movers",
    code: ixCode, bad: "an index is <region>:<id> from the market's list (jp:n225)", quote: "index", history: "an index's history is read by range",
    note: "Indices: the cash indices, levels in points, view-only; no venue here trades them." },
};
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

/** A PRICE HISTORY AS ASKED (GET /api/candles): the bar size (empty: the range's own, else 1h), a range, the bar a page is asked before, or a
 * dated window (`since` and `before` together, `since` first) — a range never with either — and the most bars, held to what can be asked; or
 * why not, in words (service.ts historyAsk) */
export function historyAsk(interval: string, ask: { range?: string | undefined; before?: string | number | undefined; since?: string | number | undefined; limit?: string | number | undefined }): { iv: CandleInterval; range?: CandleRange | undefined; before?: number | undefined; since?: number | undefined; limit: number } | Refusal {
  const r = String(ask.range ?? "").trim().toUpperCase();
  if (r && !(CANDLE_RANGES as readonly string[]).includes(r)) return no("E_MARKET_BAD_REQUEST", { message: `a range is one of ${CANDLE_RANGES.join(", ")}` });
  const b = String(ask.before ?? "").trim();
  if (b && !/^\d{1,15}$/.test(b)) return no("E_MARKET_BAD_REQUEST", { message: "a page of price history is asked before a bar's start, in milliseconds" });
  const s = String(ask.since ?? "").trim();
  if (s && !/^\d{1,15}$/.test(s)) return no("E_MARKET_BAD_REQUEST", { message: "a dated window of price history starts at a time in milliseconds" });
  if (s && !b) return no("E_MARKET_BAD_REQUEST", { message: "a dated window of price history is asked since a time and before another, both" });
  if (r && s) return no("E_MARKET_BAD_REQUEST", { message: "price history is asked for a range or for a dated window, not both" });
  if (r && b) return no("E_MARKET_BAD_REQUEST", { message: "price history is asked for a range or for the page before a bar, not both" });
  const range = r ? (r as CandleRange) : undefined;
  const iv = (interval || (range ? RANGE_BAR[range] : "1h")).trim();
  if (!(CANDLE_INTERVALS as readonly string[]).includes(iv)) return no("E_MARKET_BAD_REQUEST", { message: `price history is by ${CANDLE_INTERVALS.join(", ")}` });
  // a page: PAGE_MOST bars at most; a first view, a range's or a dated window's: HISTORY_MOST
  const page = b !== "" && s === "";
  const most = page ? PAGE_MOST : HISTORY_MOST;
  const l = String(ask.limit ?? "").trim();
  if (l && !(/^\d{1,6}$/.test(l) && Number(l) >= 1 && Number(l) <= most)) return no("E_MARKET_BAD_REQUEST", { message: `a ${page ? "page" : "view"} of price history holds 1 to ${most.toLocaleString("en-US")} bars` });
  const before = b ? Number(b) : undefined;
  if (before !== undefined && !(before > 0)) return no("E_MARKET_BAD_REQUEST", { message: "a page of price history is asked before a bar's start, in milliseconds" });
  const since = s ? Number(s) : undefined;
  if (since !== undefined && !(since < before!)) return no("E_MARKET_BAD_REQUEST", { message: "a dated window of price history starts before it ends" });
  return { iv: iv as CandleInterval, range: before !== undefined ? undefined : (range ?? INTERVAL_RANGE[iv as CandleInterval]), ...(before !== undefined ? { before } : {}), ...(since !== undefined ? { since } : {}), limit: l ? Number(l) : page ? 300 : HISTORY_MOST };
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

/** THE TWO WAYS TO ASK explore: the old navigation (a scope, a tab) or by underlying (an asset, a form, a region, a list of sources) —
 * never both in one question. The route answers it 400, a malformed question; the read, a refusal in the same words */
export const MIXED_NAVIGATION = "scope and tab are not asked beside asset, form, region or a list of sources: ask one way or the other";
export function mixesNavigation(o: { scope?: string | undefined; tab?: string | undefined; asset?: string | undefined; form?: string | undefined; region?: string | undefined; source?: string | undefined }): boolean {
  const has = (v: string | undefined) => (v ?? "").trim() !== "";
  return (has(o.scope) || has(o.tab)) && (has(o.asset) || has(o.form) || has(o.region) || (o.source ?? "").split(",").length > 1);
}

/** the most sources one list names, and the most characters it is */
export const SOURCE_LIST_MOST = 12;
export const SOURCE_LIST_CHARS = 400;

/** a list of sources as explore takes it: ids between commas, each trimmed, a duplicate dropped; an empty one between two commas, more
 * than SOURCE_LIST_MOST, a longer list or a longer id is refused, never cut. Whether each id is a source is the read's to say */
export function sourceList(raw: string | undefined): string[] | Refusal {
  const text = (raw ?? "").trim();
  if (!text) return [];
  if (text.length > SOURCE_LIST_CHARS) return no("E_MARKET_BAD_REQUEST", { message: `a list of sources is at most ${SOURCE_LIST_CHARS} characters` });
  const parts = text.split(",").map((x) => x.trim());
  if (parts.some((x) => !x)) return no("E_MARKET_BAD_REQUEST", { message: "a list of sources names a source's id between each two commas" });
  const ids = [...new Set(parts)];
  if (ids.length > SOURCE_LIST_MOST) return no("E_MARKET_BAD_REQUEST", { message: `a list of sources names at most ${SOURCE_LIST_MOST}` });
  if (ids.some((id) => id.length > 80)) return no("E_MARKET_BAD_REQUEST", { message: "a public source ID is at most 80 characters" });
  return ids;
}

export function marketReads(core: MarketCore): MarketReads {
  const cache = core.cache;
  const now = () => core.now();

  /** THE CHINA TAB: Tencent's ranking by turnover (`volume`, the default) or by the day's move (`movers`), at most RANK_ROWS rows, with its
   * read — or, with `q`, China's hits alone. A refusal of the source is the answer */
  async function exploreChina(q: string, sort: string | undefined, limit: number): Promise<Exploration | Refusal> {
    const china = core.china;
    if (!china) return no("E_MARKET_BAD_REQUEST", { venue: CHINA_ID, message: CHINA_NOT_READ });
    if (sort === "closing") return no("E_MARKET_BAD_REQUEST", { venue: CHINA_ID, message: "China is sorted by volume or movers" });
    const body = { movers: [], closing: [], mostTraded: [], missing: [], notes: [CHINA_NOTE] };
    if (q) {
      const hits = await china.search(q);
      if (isRefusal(hits)) return hits;
      return { asOf: new Date(now()).toISOString(), tabs: [{ id: "china", label: "China", count: hits.length }], items: hits.slice(0, limit), ...body };
    }
    const got = await china.rank(sort === "movers" ? "movers" : "volume");
    if (isRefusal(got)) return got;
    const r = got.read;
    return { asOf: r.asOf, tabs: [{ id: "china", label: "China", count: r.total }], items: got.items.slice(0, Math.min(limit, RANK_ROWS)), ...body, china: r,
      local: { venue: CHINA_ID, region: "cn", sort: r.sort, total: r.total, asOf: r.asOf, session: r.session, status: r.status, note: CHINA_NOTE } };
  }

  /** A LOCAL REGION'S SHARES (Hong Kong, Korea, Taiwan): its source's ranking by turnover (`volume`, the default) or by the day's move
   * (`movers`), with its read in `local` — or, with `q`, that source's hits alone. A refusal of the source is the answer; never kept here
   * (each source keeps its own reads) */
  async function exploreLocal(venue: ShareVenue, q: string, sort: string | undefined, limit: number): Promise<Exploration | Refusal> {
    const w = LOCAL_WORDS[venue];
    const src = core[venue];
    if (!src) return no("E_MARKET_BAD_REQUEST", { venue, message: w.notRead });
    if (sort === "closing") return no("E_MARKET_BAD_REQUEST", { venue, message: w.sorted });
    const body = { movers: [], closing: [], mostTraded: [], missing: [] };
    if (q) {
      const hits = await src.search(q);
      if (isRefusal(hits)) return hits;
      return { asOf: new Date(now()).toISOString(), tabs: [{ id: venue, label: w.label, count: hits.length }], items: hits.slice(0, limit), ...body, notes: [w.note] };
    }
    const got = await src.rank(sort === "movers" ? "movers" : "volume");
    if (isRefusal(got)) return got;
    // a source whose read note is its venue note (Hong Kong's) says it once
    const notes = [...new Set([w.note, got.read.note])];
    return { asOf: got.read.asOf, tabs: [{ id: venue, label: w.label, count: got.read.total }], items: got.items.slice(0, limit), ...body, notes, local: got.read };
  }

  /** A REGION'S CASH INDICES (world-indices.ts): their levels, by the day's move with `movers`, a search kept to the names and ids that hold it */
  async function exploreIndices(region: RegionId, q: string, sort: string | undefined, limit: number): Promise<Exploration | Refusal> {
    const w = LOCAL_WORDS.ix;
    const ix = core.indices;
    if (!ix) return no("E_MARKET_BAD_REQUEST", { venue: "ix", message: w.notRead });
    if (sort === "closing") return no("E_MARKET_BAD_REQUEST", { venue: "ix", message: w.sorted });
    const got = await ix.levels(region, sort === "movers" ? "movers" : "volume");
    if (isRefusal(got)) return got;
    const Q = q.toLowerCase();
    const items = Q ? got.items.filter((i) => i.name.toLowerCase().includes(Q) || (i.base ?? "").toLowerCase().includes(Q)) : got.items;
    return { asOf: got.read.asOf, tabs: [{ id: "indices", label: "Indices", count: items.length }], items: items.slice(0, limit), movers: [], closing: [], mostTraded: [], missing: [],
      notes: [w.note, got.read.note], local: got.read };
  }

  /** a venue and a market as the book and the trades take them (as `candles` does): a venue's id, and the market as plain text */
  function oneMarket(venue: string, symbol: string): { id: string; sym: string } | Refusal {
    const id = venue.trim();
    const sym = symbol.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) return no("E_MARKET_BAD_REQUEST", { message: "a venue is named by its id: lower-case letters, digits and dashes" });
    if (!sym || sym.length > 160 || !isPlain(sym)) return no("E_MARKET_BAD_REQUEST", { message: "a market is named by its symbol at that venue: 1 to 160 characters of plain text" });
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
      const scope = o.scope?.trim() || undefined;
      if (scope !== undefined && !["hyperliquid", "xyz", "more"].includes(scope)) return no("E_MARKET_BAD_REQUEST", { message: "a market scope is hyperliquid, xyz or more" });
      const ids = sourceList(o.source);
      if (isRefusal(ids)) return ids;
      if (ids.length && (scope === "hyperliquid" || scope === "xyz")) return no("E_MARKET_BAD_REQUEST", { message: "a source is selected only in more markets or without a scope" });
      const unknown = ids.find((id) => !core.source(id));
      if (unknown !== undefined) return no("E_MARKET_BAD_REQUEST", { message: `"${unknown.slice(0, 40)}" is not a public source in this market scope` });
      if (scope === "more" && ids.some((id) => ["hyperliquid", "trade-xyz"].includes(id))) return no("E_MARKET_BAD_REQUEST", { message: "the source is not available in this market scope" });
      const tab = o.tab?.trim() || undefined;
      if (tab !== undefined && !TABS.some((t) => t.id === tab)) return no("E_MARKET_BAD_REQUEST", { message: `a tab is one of ${TABS.map((t) => t.id).join(", ")}` });
      // BY UNDERLYING: an asset, a form, a region, each one of its ids (categories.ts)
      const asset = o.asset?.trim() || undefined;
      if (asset !== undefined && !ASSET_IDS.includes(asset as AssetId)) return no("E_MARKET_BAD_REQUEST", { message: `an asset is one of ${ASSET_IDS.join(", ")}` });
      const form = o.form?.trim() || undefined;
      if (form !== undefined && !FORM_IDS.includes(form as FormId)) return no("E_MARKET_BAD_REQUEST", { message: `a form is one of ${FORM_IDS.join(", ")}` });
      const region = o.region?.trim() || undefined;
      if (region !== undefined && !REGION_IDS.includes(region as RegionId)) return no("E_MARKET_BAD_REQUEST", { message: `a region is one of ${REGION_IDS.join(", ")}` });
      if (mixesNavigation({ scope, tab, asset, form, region, source: ids.join(",") })) return no("E_MARKET_BAD_REQUEST", { message: MIXED_NAVIGATION });
      const byClass = asset !== undefined || form !== undefined || region !== undefined;
      const sort = o.sort?.trim() || undefined;
      if (sort !== undefined && !EXPLORE_SORTS.includes(sort as ExploreSort)) return no("E_MARKET_BAD_REQUEST", { message: `markets are sorted by ${EXPLORE_SORTS.join(", ")}` });
      const q = (o.q ?? "").trim();
      if (q.length > 60) return no("E_MARKET_BAD_REQUEST", { message: "a search is at most 60 characters" });
      const key = (o.key ?? "").trim();
      if (key.length > 200) return no("E_MARKET_BAD_REQUEST", { message: "a row's key is at most 200 characters" });
      const limit = o.limit === undefined ? 60 : Math.floor(o.limit);
      if (!(limit >= 1 && limit <= 200)) return no("E_MARKET_BAD_REQUEST", { message: "a limit is 1 to 200 markets" });
      // CHINA is its own tab, asked of its own source (which keeps its reads): never kept here, never in All
      if (tab === "china") {
        if (ids.length) return no("E_MARKET_BAD_REQUEST", { message: "China is not part of a selected public source" });
        if (scope && scope !== "more") return no("E_MARKET_BAD_REQUEST", { message: "China is in more markets" });
        return exploreChina(q, sort, limit);
      }
      // THE LOCAL READS BY UNDERLYING: a region's shares on Stocks Spot (either left out) are its own source's — China A's (cn), Hong Kong's,
      // Korea's, Taiwan's — and a region's cash indices (Indices Spot) the world indices'; never beside a source list. Every other region and
      // form (perps on these regions, Stocks Spot on jp, in, eu) is the generic path below, which classOf already filters
      const sharesSpot = (asset ?? "stocks") === "stocks" && (form ?? "spot") === "spot";
      if (region === "cn" && sharesSpot) {
        if (ids.length) return no("E_MARKET_BAD_REQUEST", { message: "China is not part of a selected public source" });
        return exploreChina(q, sort, limit);
      }
      if (isShareVenue(region) && sharesSpot) {
        if (ids.length) return no("E_MARKET_BAD_REQUEST", { venue: region, message: LOCAL_WORDS[region].notSource });
        return exploreLocal(region, q, sort, limit);
      }
      if (region !== undefined && asset === "indices" && form === "spot") {
        if (ids.length) return no("E_MARKET_BAD_REQUEST", { venue: "ix", message: LOCAL_WORDS.ix.notSource });
        return exploreIndices(region as RegionId, q, sort, limit);
      }
      // a search on All asks China, Hong Kong, Korea and Taiwan too, beside the other sources and each within their budget; no other tab ever
      // asks them
      const allSearch = !ids.length && !byClass && (!scope || scope === "more") && q && !key && (tab === undefined || tab === "all");
      const china = core.china;
      const asks: Array<{ venue: string; name: string; search: (q: string) => Promise<ExploreItem[] | Refusal> }> = !allSearch ? [] : [
        ...(china ? [{ venue: CHINA_ID, name: CHINA_NAME, search: (x: string) => china.search(x) }] : []),
        ...SHARE_VENUES.flatMap((v) => { const src = core[v]; return src ? [{ venue: v, name: src.name, search: (x: string) => src.search(x) }] : []; }),
      ];
      // trade.xyz's own lines are its own: a legacy xyz: line at hyperliquid-preipo is left out wherever trade.xyz is read beside it
      const strip = scope === "more" || (ids.includes("hyperliquid-preipo") && ids.includes("trade-xyz"));
      const pub = core.sources()
        .filter((s) => !ids.length || ids.includes(s.id))
        .filter((s) => scope === "hyperliquid" ? s.id === "hyperliquid" : scope === "xyz" ? s.id === "trade-xyz" : scope === "more" ? s.id !== "hyperliquid" && s.id !== "trade-xyz" : true)
        .map((s) => strip && s.id === "hyperliquid-preipo" ? {
          ...s,
          // The legacy source still resolves saved xyz: paths on an explicit query; those belong only to trade.xyz in scoped browsing.
          listings: async (ask: Parameters<PublicSource["listings"]>[0]) => {
            const got = await s.listings(ask);
            return isRefusal(got) ? got : got.filter((m) => !m.symbol.startsWith("xyz:"));
          },
        } : s);
      // the key exactly as asked (a row's key is not a search: kalshi:KXFED and kalshi:kxfed are not one row), written so that no `|` in it
      // reads as the next part of the question
      return cache.get(`explore|${scope ?? ""}|${ids.join(",")}|${tab ?? ""}|${q.toUpperCase()}|${encodeURIComponent(key)}|${sort ?? ""}|${limit}|${asset ?? ""}|${form ?? ""}|${region ?? ""}`, 30_000, async (): Promise<Exploration | Refusal> => {
        const [explored, hits] = await Promise.all([
          exploreAcross({ connected: [], public: pub }, {
            q, ...(key ? { key } : {}), limit, ...(ids.length || scope === "hyperliquid" || scope === "xyz" ? { perSource: 200 } : {}), clock: now,
            ...(tab ? { tab: tab as TabId } : {}), ...(sort ? { sort: sort as ExploreSort } : {}),
            ...(asset ? { asset: asset as AssetId } : {}), ...(form ? { form: form as FormId } : {}), ...(region ? { region: region as RegionId } : {}),
          }),
          Promise.all(asks.map((a) => within(CHINA_SEARCH_WAIT_MS, a.search(q), a.venue, a.name))),
        ]);
        if (!asks.length) return explored;
        // the local hits after the dollar rows, China's first; a late or refused one is said in `missing`, the rest answered without it
        const found: ExploreItem[] = [];
        const missing = [...explored.missing];
        hits.forEach((h, i) => {
          const a = asks[i]!;
          if (isRefusal(h)) missing.push({ venue: a.venue, venueName: a.name, connected: false, why: h.message, code: h.code });
          else found.push(...h);
        });
        return { ...explored, items: [...explored.items, ...found].slice(0, limit), missing };
      });
    },

    /** a fresh price for each of a few A shares, from China's source in ONE read, and for Hong Kong, Korean and Taiwanese shares and the
     * cash indices, one read per venue (a code typed short is answered at its own: hk|700 at 00700). Any other pair is refused by name: a
     * public market's price is in explore's rows, and a connected venue's quote is the account's (/api/account/connected/quotes) */
    async quotes(pairs) {
      if (!pairs.length || pairs.length > 12) return no("E_MARKET_BAD_REQUEST", { message: "quotes are asked for 1 to 12 markets at once, each venue|symbol" });
      const six = (p: { symbol: string }) => /^\d{6}$/.test(p.symbol);
      const asked = pairs.filter((p) => p.venue === CHINA_ID && six(p)).map((p) => p.symbol);
      const china = core.china;
      const cn: Promise<Map<string, ChinaMarket> | Refusal> = !asked.length ? Promise.resolve(new Map())
        : china ? china.quotes(asked) : Promise.resolve(no("E_MARKET_BAD_REQUEST", { venue: CHINA_ID, message: CHINA_NOT_READ }));
      const quoterOf = (v: LocalVenue) => (v === "ix" ? core.indices : core[v]);
      const locals = new Map<LocalVenue, Promise<Map<string, LocalMarket> | Refusal>>();
      for (const v of [...SHARE_VENUES, "ix"] as LocalVenue[]) {
        const src = quoterOf(v);
        const codes = [...new Set(pairs.filter((p) => p.venue === v).flatMap((p) => { const c = LOCAL_WORDS[v].code(p.symbol); return c ? [c] : []; }))];
        if (src && codes.length) locals.set(v, src.quotes(codes).catch(() => no("E_VENUE_UNREACHABLE", { venue: v, message: `${LOCAL_WORDS[v].label} is not answering: no quote could be read now` })));
      }
      return Promise.all(pairs.map(async (p) => {
        if (isLocalVenue(p.venue)) {
          const v = p.venue;
          const w = LOCAL_WORDS[v];
          if (!quoterOf(v)) return { ...p, refusal: no("E_MARKET_BAD_REQUEST", { venue: v, message: w.notRead }) };
          const code = w.code(p.symbol);
          if (!code) return { ...p, refusal: no("E_MARKET_BAD_REQUEST", { venue: v, message: w.bad }) };
          const got = await locals.get(v)!;
          if (isRefusal(got)) return { ...p, refusal: got };
          const m = got.get(code);
          return m ? { venue: v, symbol: code, market: m } : { ...p, refusal: no("E_MARKET_BAD_REQUEST", { venue: v, message: `no ${w.quote} quote for ${code}` }) };
        }
        if (p.venue === CHINA_ID) {
          if (!china) return { ...p, refusal: no("E_MARKET_BAD_REQUEST", { venue: CHINA_ID, message: CHINA_NOT_READ }) };
          if (!six(p)) return { ...p, refusal: no("E_MARKET_BAD_REQUEST", { venue: CHINA_ID, message: "an A share is its six digits" }) };
          const got = await cn;
          if (isRefusal(got)) return { ...p, refusal: got };
          const m = got.get(p.symbol);
          return m ? { ...p, market: m } : { ...p, refusal: no("E_MARKET_BAD_REQUEST", { venue: CHINA_ID, message: `no A-share quote for ${p.symbol}` }) };
        }
        return { ...p, refusal: no("E_VENUE_RAIL_CLOSED", { venue: p.venue, message: `"${p.venue}" is priced in explore: the market quotes A shares (venue "china"), Hong Kong, Korean and Taiwanese shares (hk, kr, tw) and the cash indices (ix)` }) };
      }));
    },

    /** ONE MARKET'S PRICE HISTORY, from its public source, without a key (live/public-markets.ts), or an A share's from China, by range.
     * Asked by a range (`range`, in its own bar size unless one is named) or by a page (`before` a bar's start, and `limit`). Each answer
     * kept by the source's read cache (keptSource) */
    async candles(venue, symbol, interval, ask = {}) {
      const id = venue.trim();
      const sym = symbol.trim();
      if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) return no("E_MARKET_BAD_REQUEST", { message: "a venue is named by its id: lower-case letters, digits and dashes" });
      if (!sym || sym.length > 160 || !isPlain(sym)) return no("E_MARKET_BAD_REQUEST", { message: "a market is named by its symbol at that venue: 1 to 160 characters of plain text" });
      // an A share's history is Tencent's, by range, in Shanghai's sessions (china.ts history): decided before any bar size or New York window
      if (id === CHINA_ID) {
        const china = core.china;
        if (!china) return no("E_MARKET_BAD_REQUEST", { venue: CHINA_ID, message: CHINA_NOT_READ });
        if ([ask.before, ask.since].some((x) => x !== undefined && String(x).trim() !== "")) return no("E_MARKET_BAD_REQUEST", { venue: CHINA_ID, message: "an A share's history is read by range" });
        const range = (ask.range ?? "").trim();
        if (!(CANDLE_RANGES as readonly string[]).includes(range)) return no("E_MARKET_BAD_REQUEST", { venue: CHINA_ID, message: `a range is one of ${CANDLE_RANGES.join(", ")}` });
        return china.history(sym, range as ChinaRange);
      }
      // a Hong Kong, Korean or Taiwanese share's history, or a cash index's, is its own source's, by range, as an A share's
      if (isLocalVenue(id)) {
        const w = LOCAL_WORDS[id];
        const src = id === "ix" ? core.indices : core[id];
        if (!src) return no("E_MARKET_BAD_REQUEST", { venue: id, message: w.notRead });
        if ([ask.before, ask.since].some((x) => x !== undefined && String(x).trim() !== "")) return no("E_MARKET_BAD_REQUEST", { venue: id, message: w.history });
        const range = (ask.range ?? "").trim();
        if (!(CANDLE_RANGES as readonly string[]).includes(range)) return no("E_MARKET_BAD_REQUEST", { venue: id, message: `a range is one of ${CANDLE_RANGES.join(", ")}` });
        // the venue's own code, as the quotes take it (a Hong Kong code padded, a Korean or Taiwanese one upper-cased, an index's lower-cased)
        const code = w.code(sym);
        if (!code) return no("E_MARKET_BAD_REQUEST", { venue: id, message: w.bad });
        return src.history(code, range as CandleRange);
      }
      const asked = historyAsk(interval, ask);
      if (isRefusal(asked)) return asked;
      const { iv, range, before, since, limit } = asked;
      const t = now();
      const w: CandleWindow = since !== undefined ? { since, until: before, limit } : before !== undefined ? { until: before, limit } : { since: rangeSince(range!, t), limit, range };
      // the window the answer is held to: a US stock's 1D and 5D are its latest sessions (the source counts them so), which may start earlier
      const held: CandleWindow = w.range !== undefined && w.since !== undefined ? { ...w, since: Math.min(w.since, sessionsSince(w.range, t)) } : w;
      const wait = before !== undefined && since === undefined ? PAGE_WAIT_MS : HISTORY_WAIT_MS;
      const said = (page: CandlePage, base: { venue: string; venueName: string; public?: true; from?: string }): CandlesView => ({
        ...base,
        symbol: sym,
        interval: page.interval ?? iv,
        ...(since !== undefined ? { since } : {}),
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
      if (!(Number.isInteger(depth) && depth >= 1 && depth <= 50)) return no("E_MARKET_BAD_REQUEST", { message: "a book is read 1 to 50 levels a side" });
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
      if (!(Number.isInteger(limit) && limit >= 1 && limit <= 100)) return no("E_MARKET_BAD_REQUEST", { message: "the latest trades are read 1 to 100 at a time" });
      const src = core.source(id);
      if (!src) return notPublic(id);
      if (!src.trades) return { venue: id, venueName: src.name, symbol: sym, trades: [], none: `${src.name} publishes no trades the market can read`, public: true };
      const got = await publicRead(src, "trades", sym, limit);
      return isRefusal(got) ? got : { venue: id, venueName: src.name, symbol: sym, trades: got as PublicTrade[], public: true };
    },

    /** EACH US SHARE'S LATEST HEADLINES (live/news.ts), Nasdaq's: each symbol's feed kept a minute (NEWS_KEEP_MS) and asked side by side,
     * at most NEWS_PER_SYMBOL a symbol, newest first, none older than `since`. A feed that refuses, or does not answer in NEWS_WAIT_MS, puts
     * its symbol under `unavailable` with the refusal's words; the others answer. A repeated symbol is asked once */
    async news(symbols, since) {
      const source = core.news;
      if (!source) return no("E_MARKET_UNKNOWN_SOURCE", { venue: NEWS_ID, message: NEWS_NOT_READ });
      const asked = [...new Set(symbols)];
      if (asked.length < 1 || asked.length > NEWS_SYMBOLS_MOST || !asked.every((x) => US_TICKER.test(x))) return no("E_MARKET_BAD_REQUEST", { venue: NEWS_ID, message: `headlines are read for 1 to ${NEWS_SYMBOLS_MOST} US shares, each by its ticker` });
      const sinceMs = since === undefined ? undefined : Date.parse(since);
      if (sinceMs !== undefined && !Number.isFinite(sinceMs)) return no("E_MARKET_BAD_REQUEST", { venue: NEWS_ID, message: "since is an ISO 8601 time" });
      const got = await Promise.all(asked.map((sym) => within(NEWS_WAIT_MS, cache.get(`news|${NEWS_ID}|${sym}`, NEWS_KEEP_MS, () => source.headlines(sym)), NEWS_ID, NEWS_NAME)));
      const news: Record<string, Headline[]> = {};
      const unavailable: Record<string, string> = {};
      asked.forEach((sym, i) => {
        const r = got[i]!;
        if (isRefusal(r)) unavailable[sym] = r.message;
        else news[sym] = r.filter((h) => sinceMs === undefined || Date.parse(h.time) >= sinceMs).slice(0, NEWS_PER_SYMBOL);
      });
      return { news, ...(Object.keys(unavailable).length ? { unavailable } : {}) };
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
  // would also take. A key and a source ID are read past their respective limits, so a longer value is refused rather than cut into
  // another registered identity. The old navigation beside the new is a malformed question.
  app.get("/api/explore", wrap(async (req, res) => {
    const q = strings(req, res, { scope: 20, source: SOURCE_LIST_CHARS + 1, tab: 20, q: 80, key: 240, sort: 20, limit: 6, asset: 20, form: 20, region: 20 });
    if (!q) return;
    if (q.limit && !/^\d{1,3}$/.test(q.limit)) return void bad(res, "limit is a count of markets, 1 to 200, in digits");
    if (mixesNavigation(q)) return void bad(res, MIXED_NAVIGATION);
    answerOf(res, await reads.explore({ scope: q.scope, source: q.source, tab: q.tab, q: q.q, key: q.key, sort: q.sort, ...(q.limit ? { limit: Number(q.limit) } : {}), asset: q.asset, form: q.form, region: q.region }));
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
    const q = strings(req, res, { venue: 60, symbol: 200, interval: 4, range: 4, before: 16, since: 16, limit: 6 });
    if (!q) return;
    answerOf(res, await reads.candles(q.venue, q.symbol, q.interval, { range: q.range, before: q.before, since: q.since, limit: q.limit }));
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

  // each US share's latest headlines: ?symbols=INTC,CRWV (1 to 10 tickers, the Market's rule: us-quotes.ts US_TICKER) and an optional
  // ?since=<ISO 8601 time, with its zone>. A feed that refuses is its symbol's `unavailable`, never the answer's
  app.get("/api/news", wrap(async (req, res) => {
    const raw = { symbols: req.query.symbols, since: req.query.since };
    if (Array.isArray(raw.symbols) || Array.isArray(raw.since)) return void bad(res, "symbols and since are each given once");
    const symbols = typeof raw.symbols === "string" && raw.symbols.length <= 100 ? raw.symbols.split(",").map((x) => x.trim()) : [];
    if (symbols.length < 1 || symbols.length > NEWS_SYMBOLS_MOST || !symbols.every((x) => US_TICKER.test(x))) return void bad(res, `symbols is 1 to ${NEWS_SYMBOLS_MOST} US tickers, comma-separated, e.g. INTC,CRWV`);
    const since = typeof raw.since === "string" && raw.since !== "" ? raw.since : undefined;
    if (raw.since !== undefined && (since === undefined || !ISO_TIME.test(since) || !Number.isFinite(Date.parse(since)))) return void bad(res, "since is an ISO 8601 time with its zone, e.g. 2026-11-07T13:30:00Z");
    answerOf(res, await reads.news(symbols, since));
  }));
}

/** an ISO 8601 time with its zone (Z or an offset), to the minute at least */
const ISO_TIME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
