/** THE FAKES THE MARKET'S PUBLIC READS ARE TESTED OVER (unit/reads.test.ts, unit/market-stream.test.ts): a public source with listings, a
 * book, trades and bars; China with one A share; and a hub the test makes speak. Nothing leaves the process. */
import type { ExploreItem } from "../src/live/explore.ts";
import type { ChinaHistory, ChinaMarket, ChinaSource } from "../src/live/china.ts";
import { indexRow, shareRow, type LocalHistory, type LocalMarket, type LocalRead, type LocalSort, type LocalSource } from "../src/live/local.ts";
import type { CryptoOptions, UsOptions, WorldIndices } from "../src/core.ts";
import type { OptionChain, OptionSummary, OptionVenue } from "../src/live/options.ts";
import type { Refusal } from "../src/core/errors.ts";
import type { RegionId } from "../src/live/categories.ts";
import { readLike, type Listing, type PublicSource } from "../src/live/public-markets.ts";
import type { HubBook, HubQuote, HubTick, MarketHub } from "../src/live/stream-hub.ts";
import type { Candle } from "../src/live/trade.ts";
import { no } from "../src/refuse.ts";

/** when the fake's listings were read from its venue */
export const READ_AT = 1_700_000_000_000;

export const listing = (symbol: string, price: number, o: Partial<Listing> = {}): Listing => ({ symbol, name: `${symbol} market`, kind: "spot", base: symbol.split("/")[0]!, quote: "USDT", price, bid: price - 0.5, ask: price + 0.5, open: true, types: [], volumeUsd24h: 2e9, ...o });

/** an hour's bars, oldest first, ending an hour before now */
function bars(n: number): Candle[] {
  const hour = 3_600_000;
  const end = Math.floor(Date.now() / hour) * hour - hour;
  return Array.from({ length: n }, (_, i) => ({ t: end - (n - 1 - i) * hour, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 }));
}

/** the fake exchange: BTC/USDT and ETH/USDT, with a book, trades and hourly bars */
export function fakeSource(o: { id?: string } = {}): PublicSource {
  const id = o.id ?? "fake";
  const rows = [listing("BTC/USDT", 62_000), listing("ETH/USDT", 3_000)];
  return {
    id,
    name: "Fake Ex",
    kind: "exchange",
    connectTo: id,
    connector: `live:exchange:${id}`,
    async listings(q) {
      const Q = (q.q ?? "").toUpperCase();
      return readLike(rows.filter((m) => !Q || m.symbol.includes(Q)).map((m) => ({ ...m })), READ_AT);
    },
    async candles(symbol) {
      return rows.some((r) => r.symbol === symbol) ? bars(24) : no("E_ACCOUNT_BAD_ACTION", { venue: id, message: `Fake Ex lists no market ${symbol}` });
    },
    async book(symbol, depth) {
      if (!rows.some((r) => r.symbol === symbol)) return no("E_ACCOUNT_BAD_ACTION", { venue: id, message: `Fake Ex lists no market ${symbol}` });
      return { bids: [[61_999, 1], [61_998, 2]].slice(0, depth) as Array<[number, number]>, asks: [[62_001, 1], [62_002, 3]].slice(0, depth) as Array<[number, number]>, at: new Date(READ_AT).toISOString(), from: "Fake Ex", depth: "full" };
    },
    async trades(symbol, limit) {
      if (!rows.some((r) => r.symbol === symbol)) return no("E_ACCOUNT_BAD_ACTION", { venue: id, message: `Fake Ex lists no market ${symbol}` });
      return [{ price: 62_000, size: 0.1, side: "buy" as const, at: new Date(READ_AT).toISOString() }, { price: 61_999, size: 0.2, side: "sell" as const, at: new Date(READ_AT - 1_000).toISOString() }].slice(0, limit);
    },
  };
}

/** one A share as China's search finds it */
const hit: ExploreItem = {
  key: "cn:600519", kind: "ashare", name: "贵州茅台", base: "600519", currency: "CNY", asset: "stocks", form: "spot", region: "cn", price: 1500, quoteFrom: "Tencent", tabs: ["china"],
  at: [{ venue: "china", venueName: "Tencent", symbol: "600519", connected: false, canTrade: false, public: true, price: 1500, quoteFrom: "Tencent" }],
} as ExploreItem;

/** China with one share, 600519: found by its digits, quoted, and charted */
export function fakeChina(): ChinaSource {
  const share = { symbol: "600519", name: "贵州茅台", kind: "stock", base: "600519", quote: "CNY", currency: "CNY", open: false, types: [], price: 1500, quoteFrom: "Tencent", cn: {} } as unknown as ChinaMarket;
  return {
    rank: async () => no("E_VENUE_UNREACHABLE", { venue: "china", message: "not in this test" }),
    search: async (q) => (q === "600519" ? [{ ...hit }] : []),
    quotes: async (symbols) => new Map(symbols.filter((s) => s === "600519").map((s) => [s, share])),
    history: async (symbol, range) => ({ venue: "china", venueName: "Tencent", symbol, range, candles: [], source: "Tencent · daily", adjustment: "forward-adjusted (前复权)" }) as ChinaHistory,
    status: () => ({ state: "live", said: "Tencent · answering" }),
  };
}

/** each local region's fake: its venue, its source's name, its currency, one share's code and name, and the code typed short (Hong Kong) */
const LOCAL = {
  hk: { name: "Tencent", currency: "HKD", code: "00700", share: "Tencent Holdings", region: "Hong Kong" },
  kr: { name: "Naver", currency: "KRW", code: "005930", share: "삼성전자", region: "Korea" },
  tw: { name: "TWSE", currency: "TWD", code: "2330", share: "TSMC", region: "Taiwan" },
} as const;

/** a local region's source (Hong Kong, Korea or Taiwan) with one share, every ask recorded; any of its reads replaced by `o` */
export function fakeLocal(venue: "hk" | "kr" | "tw", o: Partial<Pick<LocalSource, "rank" | "search" | "quotes" | "history">> = {}) {
  const f = LOCAL[venue];
  const calls = { rank: [] as LocalSort[], search: [] as string[], quotes: [] as string[][], history: [] as Array<[string, string]> };
  const row = () => shareRow({ venue, venueName: f.name, code: f.code, name: f.share, currency: f.currency, price: 100, changePct: 1.5, turnover: 1e9, quoteFrom: f.name });
  const read = (sort: LocalSort): LocalRead => ({ venue, region: venue, sort, total: 200, asOf: new Date(READ_AT).toISOString(), session: { phase: "closed", lastSession: "2026-11-20" } as LocalRead["session"],
    status: { state: "live", said: `${f.name} · answering` }, note: `${f.region}: the fake's ranking` });
  const market = (code: string): LocalMarket => ({ symbol: code, name: f.share, kind: "spot", base: code, quote: f.currency, currency: f.currency, open: false, types: [], price: 100, quoteFrom: f.name,
    local: { prevClose: 99, open: 99, high: 101, low: 98, volume: 1e6, turnover: 1e9, lastSession: "2026-11-20", phase: "closed", quoteStatus: "unsaid" } }) as LocalMarket;
  const source: LocalSource = {
    venue, name: f.name,
    rank: async (sort) => { calls.rank.push(sort); return o.rank ? o.rank(sort) : { items: [row()], read: read(sort) }; },
    search: async (q) => { calls.search.push(q); return o.search ? o.search(q) : q === f.code || f.share.toLowerCase().includes(q.toLowerCase()) ? [row()] : []; },
    quotes: async (symbols) => { calls.quotes.push([...symbols]); return o.quotes ? o.quotes(symbols) : new Map(symbols.filter((s) => s === f.code).map((s) => [s, market(s)])); },
    history: async (symbol, range) => { calls.history.push([symbol, range]); return o.history ? o.history(symbol, range) : ({ venue, venueName: f.name, symbol, range, candles: [], source: f.name }) as LocalHistory; },
    status: () => ({ state: "live", said: `${f.name} · answering` }),
  };
  return { source, calls };
}

/** the world's indices with Japan's Nikkei 225 and the US's S&P 500, every ask recorded */
export function fakeIndices() {
  const calls = { levels: [] as Array<[RegionId, LocalSort | undefined]>, quotes: [] as string[][], history: [] as Array<[string, string]> };
  const LIST: Record<string, Array<{ id: string; name: string; level: number }>> = { jp: [{ id: "n225", name: "Nikkei 225", level: 38_000 }], us: [{ id: "spx", name: "S&P 500", level: 6_000 }] };
  const source: WorldIndices = {
    async levels(region, sort) {
      calls.levels.push([region, sort]);
      const list = LIST[region] ?? [];
      return { items: list.map((i) => indexRow({ region, id: i.id, name: i.name, level: i.level, change: 10, changePct: 0.1, quoteFrom: "Naver · 15 min delayed" })),
        read: { venue: "ix", region, sort: sort ?? "volume", total: list.length, asOf: new Date(READ_AT).toISOString(), session: { phase: "closed", lastSession: "2026-11-20" } as LocalRead["session"], status: { state: "live", said: "Indices · answering" }, note: "the cash indices, each from its own source" } };
    },
    async quotes(ids) {
      calls.quotes.push([...ids]);
      return new Map(ids.flatMap((id) => {
        const [region, ix] = id.split(":");
        const i = (LIST[region!] ?? []).find((x) => x.id === ix);
        return i ? [[id, { symbol: id, name: i.name, kind: "spot", base: i.id, quote: "pts", open: false, types: [], price: i.level, quoteFrom: "Naver · 15 min delayed",
          local: { prevClose: null, open: null, high: null, low: null, volume: null, turnover: null, lastSession: "2026-11-20", phase: "closed", quoteStatus: "delayed" } } as LocalMarket] as const] : [];
      }));
    },
    async history(id, range) { calls.history.push([id, range]); return { venue: "ix", venueName: "Eastmoney", symbol: id, range, candles: [], source: "Eastmoney" } as LocalHistory; },
    status: () => ({ state: "live", said: "Indices · answering" }),
  };
  return { source, calls };
}

/** a hub the test makes speak: it streams the fake's markets, and the "stocks" source's prices alone (pricesOnly); it records every hold
 * and release */
export function fakeHub() {
  const listeners = new Set<(t: HubTick) => void>();
  const quotes = new Map<string, HubQuote>();
  const books = new Map<string, HubBook>();
  const rings = new Map<string, Array<{ seq: number; at: number; price: number; size: number }>>();
  const seen = { holds: [] as string[], releases: [] as string[] };
  let seq = 0;
  const tell = (source: string, symbol: string, what: HubTick["what"]) => {
    for (const fn of listeners) fn({ source, symbol, what });
  };
  const hub: MarketHub = {
    covers: (s) => s === "fake" || s === "stocks",
    pricesOnly: (s) => s === "stocks",
    want: (s) => s === "fake" || s === "stocks",
    hold(s, y, o) {
      const k = `${s}|${y}${o?.book ? "|book" : ""}`;
      seen.holds.push(k);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        seen.releases.push(k);
      };
    },
    quote: (s, y) => quotes.get(`${s}|${y}`),
    book: (s, y) => books.get(`${s}|${y}`),
    trades: (s, y, limit) => [...(rings.get(`${s}|${y}`) ?? [])].reverse().slice(0, limit).map((t) => ({ price: t.price, size: t.size, at: new Date(t.at).toISOString() })),
    since: () => ({ trades: 0, seq }),
    confirmed: async () => undefined,
    onTick(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    close: () => undefined,
  };
  const at = 1_700_000_100_000;
  return {
    hub,
    seen,
    quote(s: string, y: string, q: Partial<HubQuote> = {}) {
      quotes.set(`${s}|${y}`, { bid: 61_999, ask: 62_001, last: 62_000, at, recvAt: at, seenAt: at, src: "Fake Ex", live: true, ...q, seq: ++seq });
      tell(s, y, "quote");
    },
    book(s: string, y: string, b: Partial<HubBook> = {}) {
      books.set(`${s}|${y}`, { bids: [[61_999, 1]], asks: [[62_001, 2]], at, recvAt: at, seenAt: at, src: "Fake Ex", live: true, whole: true, ...b });
      tell(s, y, "book");
    },
    trade(s: string, y: string, price: number) {
      const k = `${s}|${y}`;
      if (!rings.has(k)) rings.set(k, []);
      rings.get(k)!.push({ seq: ++seq, at, price, size: 1 });
      tell(s, y, "trades");
    },
  };
}

type OptionList = { items: OptionSummary[]; asOf: string; stale?: true; partial?: true; note?: string };

/** one option chain as a source answers it: two strikes around the price, the expiry asked (else the nearest) */
export function chainOf(underlying: string, venue: OptionVenue, expiry?: string): OptionChain {
  const coin = venue !== "nasdaq";
  const unit = coin ? underlying : "USD";
  const price = coin ? 60_000 : 230;
  const leg = (symbol: string) => ({ symbol, bid: 1, ask: 1.2, last: 1.1, volume: 10, unit, ...(coin ? { iv: 50, usd: { bid: 60_000, ask: 72_000, last: 66_000 } } : {}) });
  const e = expiry ?? "2026-11-27";
  return {
    underlying, venue, venueName: venue === "deribit" ? "Deribit" : venue === "okx" ? "OKX" : "Nasdaq", price, asOf: new Date(READ_AT).toISOString(), quoteFrom: venue === "deribit" ? "Deribit" : venue === "okx" ? "OKX" : "Nasdaq",
    expiries: ["2026-11-27", "2026-12-25"], expiry: e, atmStrike: price,
    strikes: [{ strike: price * 0.9, call: leg(`${underlying}-C-1`), put: leg(`${underlying}-P-1`) }, { strike: price, call: leg(`${underlying}-C-2`), put: leg(`${underlying}-P-2`) }],
  };
}

const optionSummary = (underlying: string, asset: "crypto" | "stocks", o: Partial<OptionSummary> = {}): OptionSummary => ({
  underlying, asset, price: asset === "crypto" ? 60_000 : 230, nearestExpiry: "2026-11-27", volume: 1_000, openInterest: 5_000,
  venues: asset === "crypto" ? ["deribit", "okx"] : ["nasdaq"], quoteFrom: asset === "crypto" ? "Deribit" : "Nasdaq", ...o,
});

/** crypto options (options-crypto.ts) with BTC, ETH and SOL rows (no change: the market fills it from its coin rows), every ask recorded;
 * either read replaced by `o` */
export function fakeCryptoOptions(o: { summaries?: () => Promise<OptionList | Refusal>; chain?: (u: string, v: "deribit" | "okx", e?: string) => Promise<OptionChain | Refusal> } = {}) {
  const calls = { summaries: 0, chain: [] as Array<[string, string, string | undefined]> };
  const list = (): OptionList => ({
    items: [
      optionSummary("SOL", "crypto", { volume: 900, volumeUsd: 1e7, venues: ["deribit"] }),
      optionSummary("BTC", "crypto", { volume: 9_000, volumeUsd: 5e8, atmIv: 45 }),
      optionSummary("ETH", "crypto", { volume: 30_000, volumeUsd: 2e8, atmIv: 60 }),
    ],
    asOf: new Date(READ_AT).toISOString(),
  });
  const source: CryptoOptions = {
    summaries: async () => { calls.summaries++; return o.summaries ? o.summaries() : list(); },
    chain: async (u, v, e) => { calls.chain.push([u, v, e]); return o.chain ? o.chain(u, v, e) : chainOf(u, v, e); },
    status: () => ({ state: "live", said: "Crypto options · answering" }),
  };
  return { source, calls };
}

/** US options (options-us.ts) with SPY and AAPL rows, priced and changed as the US line would, every ask recorded; either read replaced by `o` */
export function fakeUsOptions(o: { summaries?: () => Promise<OptionList | Refusal>; chain?: (t: string, e?: string) => Promise<OptionChain | Refusal> } = {}) {
  const calls = { summaries: 0, chain: [] as Array<[string, string | undefined]> };
  const list = (): OptionList => ({
    items: [
      optionSummary("AAPL", "stocks", { volume: 300_000, changePct: 1.2, nearestOnly: true, quoteFrom: "Nasdaq · real time" }),
      optionSummary("SPY", "stocks", { volume: 900_000, changePct: -0.4, nearestOnly: true, quoteFrom: "Nasdaq · real time" }),
    ],
    asOf: new Date(READ_AT).toISOString(),
  });
  const source: UsOptions = {
    summaries: async () => { calls.summaries++; return o.summaries ? o.summaries() : list(); },
    chain: async (t, e) => { calls.chain.push([t, e]); return o.chain ? o.chain(t, e) : chainOf(t, "nasdaq", e); },
    has: (t) => ["AAPL", "SPY"].includes(t),
    status: () => ({ state: "live", said: "US options · answering" }),
  };
  return { source, calls };
}
