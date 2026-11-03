/** THE FAKES THE MARKET'S PUBLIC READS ARE TESTED OVER (unit/reads.test.ts, unit/market-stream.test.ts; the account's
 * unit/market-parity.test.ts builds the same ones): a public source with listings, a book, trades and bars; China with one A share; and a hub
 * the test makes speak. Nothing leaves the process. */
import type { ExploreItem } from "../src/live/explore.ts";
import type { ChinaHistory, ChinaMarket, ChinaSource } from "../src/live/china.ts";
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
  key: "cn:600519", kind: "ashare", name: "贵州茅台", base: "600519", currency: "CNY", price: 1500, quoteFrom: "Tencent", tabs: ["china"],
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
