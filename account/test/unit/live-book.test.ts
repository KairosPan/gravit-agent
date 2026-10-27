/** THE ORDER BOOK AND THE LATEST TRADES (live/public-markets.ts book · trades, live/paper.ts and live/exchange-trade.ts passing them
 * through, service.ts marketBook · marketTrades, the two GET routes), against stand-ins that speak each source's own shape as it answered
 * live and keyless on 2026-10-14: the exchange library's fetchOrderBook / fetchTrades, Kalshi's orderbook_fp (bids only, sent worst first)
 * and its trades, Polymarket's CLOB book and its Data API's trades, Polymarket US's gateway book, Hyperliquid's l2Book and recentTrades.
 * What is checked is what the page relies on: every level the source's own, best first; Kalshi's NO bids read as YES asks at 1 − their
 * price; a source with no depth shown as its best bid and ask only; a refusal in the source's words; the paper account passing both through
 * to its market's source; the service asking a connected venue's trader before a public source of the same id. Nothing leaves the process. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { Outcome } from "../../src/portfolio/account/exchange.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { exchangeTrader } from "../../src/portfolio/live/exchange-trade.ts";
import type { ExchangeClient, OpenExchange } from "../../src/portfolio/live/exchange.ts";
import { register } from "../../src/portfolio/live/index.ts";
import { paperSource } from "../../src/portfolio/live/paper.ts";
import { BOOK_MS, exchangeTickers, hyperliquidPreIpoPublic, hyperliquidPublic, kalshiPublic, polymarketPublic, polymarketUsPublic, PUBLIC_HOSTS, type Listing, type PublicSource } from "../../src/portfolio/live/public-markets.ts";
import type { LiveTrader, Market, OrderBook, OrderState, PublicTrade } from "../../src/portfolio/live/trade.ts";
import type { Http, HttpReply, LiveSource } from "../../src/portfolio/live/types.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

const NOW = Date.parse("2026-10-14T17:30:00.000Z");
const json = (body: unknown, status = 200): HttpReply => ({ status, body, text: JSON.stringify(body) });
type Rec = Record<string, unknown>;
const ok = <T,>(x: T | Refusal): T => {
  if (isRefusal(x)) throw new Error(`expected an answer, got ${x.code}: ${x.message}`);
  return x;
};
const refused = (x: unknown): Refusal => {
  if (!isRefusal(x)) throw new Error(`expected a refusal, got ${JSON.stringify(x).slice(0, 300)}`);
  return x;
};

/** a stand-in network: answers by URL (the first route whose key the URL contains), records every request with its body */
function network(routes: Array<[string, HttpReply | ((url: string, body?: string) => HttpReply)]>) {
  const sent: Array<{ url: string; method: string; body?: string | undefined }> = [];
  const http: Http = async (url, init = {}) => {
    sent.push({ url, method: init.method ?? "GET", body: init.body });
    const hit = routes.find(([k]) => url.includes(k) || (init.body ?? "").includes(k));
    if (!hit) return json({ error: "not found" }, 404);
    return typeof hit[1] === "function" ? hit[1](url, init.body) : hit[1];
  };
  return { http, sent };
}

/** a stand-in exchange library: markets, a book and trades as the library's parsers give them (here sent in no particular order) */
function library(o: { book?: Rec; trades?: Rec[]; fail?: Error; has?: Rec } = {}) {
  const calls: string[] = [];
  const markets: Record<string, Rec> = { "BTC/USD": { symbol: "BTC/USD", base: "BTC", quote: "USD", spot: true, active: true }, "BTC/EUR": { symbol: "BTC/EUR", base: "BTC", quote: "EUR", spot: true, active: true } };
  const client = {
    id: "x",
    markets,
    has: o.has ?? { fetchOrderBook: true, fetchTrades: true },
    async loadMarkets() {
      return markets;
    },
    async fetchBalance(): Promise<Record<string, unknown>> {
      throw new Error("a public source never reads a balance");
    },
    async fetchOrderBook(symbol: string, limit?: number) {
      calls.push(`book:${symbol}:${limit}`);
      if (o.fail) throw o.fail;
      return o.book;
    },
    async fetchTrades(symbol: string, since?: number, limit?: number) {
      calls.push(`trades:${symbol}:${since}:${limit}`);
      if (o.fail) throw o.fail;
      return o.trades;
    },
  };
  const open: OpenExchange = async (id) => ({ ...client, id }) as unknown as ExchangeClient;
  return { open, calls };
}

const BOOK = {
  // the library sends levels as [price, amount, count]; a level with nothing resting is not a level
  bids: [[81766, 1.58891], [81768, 14.31819], [81767, 0.20924], [81765, 0]],
  asks: [[81772, 0.01202], [81769, 6.21438], [81770, 0.03668]],
  timestamp: NOW - 1_000,
};
const TRADES = [
  { timestamp: NOW - 3_000, price: 81768, amount: 0.00221, side: "sell" },
  { timestamp: NOW - 2_000, price: 81769, amount: 0.00431, side: "buy" },
  { timestamp: NOW - 2_000, price: 81769, amount: 0.001, side: "buy" },
  { timestamp: NOW - 1_000, price: 0, amount: 1, side: "buy" },
];

describe("the exchanges, keyless, through the library's fetchOrderBook and fetchTrades", () => {
  it("gives the exchange's own levels best first — the highest bid, the lowest ask — cut to the depth, the library asked for 20 or 100", async () => {
    let now = NOW;
    const lib = library({ book: BOOK });
    const kraken = exchangeTickers("kraken", { open: lib.open, clock: () => now });
    const b = ok(await kraken.book!("BTC/USD", 2));
    // three levels a side came where two were asked: each side goes on past what is shown
    expect(b).toEqual({ bids: [[81768, 14.31819], [81767, 0.20924]], asks: [[81769, 6.21438], [81770, 0.03668]], at: new Date(NOW - 1_000).toISOString(), from: "Kraken", depth: "full", more: { bids: true, asks: true } });
    // the levels with nothing resting are left out, never shown as 0; fewer came than the hundred asked: that is the whole book
    const deep = ok(await kraken.book!("BTC/USD", 50));
    expect(deep.bids.map((l) => l[0])).toEqual([81768, 81767, 81766]);
    expect(deep.more).toEqual({ bids: false, asks: false });
    expect(lib.calls).toEqual(["book:BTC/USD:20", "book:BTC/USD:100"]);
    // kept a second and a half: the next poll asks nothing; after it, the exchange is asked again
    await kraken.book!("BTC/USD", 2);
    expect(lib.calls.length).toBe(2);
    now += BOOK_MS + 1;
    await kraken.book!("BTC/USD", 2);
    expect(lib.calls.length).toBe(3);
  });

  it("asks nothing for a pair the exchange does not list in dollars", async () => {
    const lib = library({ book: BOOK });
    const kraken = exchangeTickers("kraken", { open: lib.open, clock: () => NOW });
    expect(refused(await kraken.book!("BTC/EUR", 10)).message).toBe("Kraken lists no market BTC/EUR priced in dollars");
    expect(refused(await kraken.trades!("DOGE/USD", 10)).code).toBe("E_VENUE_REJECTED");
    expect(lib.calls).toEqual([]);
  });

  it("gives the latest trades newest first, a trade's side only where the exchange says it is the taker's (Kraken yes, Coinbase no)", async () => {
    const lib = library({ trades: TRADES });
    const kraken = exchangeTickers("kraken", { open: lib.open, clock: () => NOW });
    const t = ok(await kraken.trades!("BTC/USD", 30));
    // one moment's two trades in the reverse of the order the library listed them (oldest first); a trade at no price is no trade
    expect(t).toEqual([
      { price: 81769, size: 0.001, side: "buy", at: new Date(NOW - 2_000).toISOString() },
      { price: 81769, size: 0.00431, side: "buy", at: new Date(NOW - 2_000).toISOString() },
      { price: 81768, size: 0.00221, side: "sell", at: new Date(NOW - 3_000).toISOString() },
    ]);
    const coinbase = exchangeTickers("coinbase", { open: library({ trades: TRADES }).open, clock: () => NOW });
    expect(ok(await coinbase.trades!("BTC/USD", 30)).every((x) => x.side === undefined)).toBe(true);
    // Bybit's spot trades come sixty at a time at most
    const by = library({ trades: [] });
    await exchangeTickers("bybit", { open: by.open, clock: () => NOW }).trades!("BTC/USD", 100);
    expect(by.calls).toEqual(["trades:BTC/USD:undefined:60"]);
  });

  it("a side that came back as long as the library was asked for may go on", async () => {
    const full = { bids: Array.from({ length: 20 }, (_, i) => [81768 - i, 1]), asks: [[81769, 1]] };
    const kraken = exchangeTickers("kraken", { open: library({ book: full }).open, clock: () => NOW });
    expect(ok(await kraken.book!("BTC/USD", 20)).more).toEqual({ bids: true, asks: false });
  });

  it("loads the market list afresh after a failed read only once in a while — a book asked every two seconds never reloads it each time", async () => {
    let loads = 0;
    let forced = 0;
    const lib = library({ fail: Object.assign(new Error("kraken {\"error\":[\"EGeneral:Internal error\"]}"), { name: "ExchangeError" }) });
    const open: OpenExchange = async (id, key) => {
      const x = (await lib.open(id, key)) as unknown as Rec;
      return { ...x, async loadMarkets(reload?: boolean) {
        loads++;
        if (reload) forced++;
        return x.markets;
      } } as unknown as ExchangeClient;
    };
    let now = NOW;
    const kraken = exchangeTickers("kraken", { open, clock: () => now });
    for (let i = 0; i < 5; i++) {
      expect(refused(await kraken.book!("BTC/USD", 10)).code).not.toBe("E_ACCOUNT_BAD_ACTION");
      now += BOOK_MS + 500;
    }
    // five reads, each failing: the list was loaded each time, but forced afresh only once (after the first failure)
    expect([loads, forced]).toEqual([5, 1]);
    now += 90_000;
    await kraken.book!("BTC/USD", 10);
    await kraken.book!("BTC/USD", 10);
    expect(forced).toBe(2);
  });

  it("passes the exchange's refusal on in its own words, and holds the whole exchange back after a place rule: the book is not asked again", async () => {
    const lib = library({ fail: Object.assign(new Error('binance GET https://api.binance.com/api/v3/depth 451 {"code":0,"msg":"Service unavailable from a restricted location according to \'b. Eligibility\' in https://www.binance.com/en/terms."}'), { name: "ExchangeNotAvailable" }) });
    let now = NOW;
    const binance = exchangeTickers("binance", { open: lib.open, clock: () => now });
    const r = refused(await binance.book!("BTC/USD", 10));
    expect(r.code).toBe("E_VENUE_GEOBLOCKED");
    expect(r.message).toBe("Binance does not serve this location: that is its own rule, and the account does not look for a way around it");
    now += 60_000;
    expect(refused(await binance.trades!("BTC/USD", 10)).code).toBe("E_VENUE_GEOBLOCKED");
    expect(lib.calls).toEqual(["book:BTC/USD:20"]);
  });
});

describe("Kalshi, keyless: bids only, a bid on one outcome an offer of the other at 1 − its price", () => {
  // as Kalshi answered for KXFED-26OCT-T4.00 on 2026-10-14: each side's levels worst first, the best (the highest) last
  const OB = { orderbook_fp: { no_dollars: [["0.6300", "50000.00"], ["0.6400", "288.50"], ["0.6500", "4095.99"]], yes_dollars: [["0.3200", "6.06"], ["0.3300", "50004.76"], ["0.3400", "2.24"]] } };
  const TAPE = {
    trades: [
      { count_fp: "5.70", created_time: "2026-10-14T17:29:13.76869Z", no_price_dollars: "0.6500", yes_price_dollars: "0.3500", taker_outcome_side: "no", taker_book_side: "ask", taker_side: "no", ticker: "KXFED-26OCT-T4.00" },
      { count_fp: "61.00", created_time: "2026-10-14T17:06:48.852028Z", no_price_dollars: "0.6300", yes_price_dollars: "0.3700", taker_outcome_side: "yes", taker_side: "yes", ticker: "KXFED-26OCT-T4.00" },
    ],
  };
  const net = () => network([["/orderbook", json(OB)], ["/markets/trades", json(TAPE)]]);

  it("a YES leg's bids are the YES bids, best first; its asks the NO bids at 1 − their price, the lowest first", async () => {
    const n = net();
    const k = kalshiPublic({ http: n.http, clock: () => NOW });
    const yes = ok(await k.book!("KXFED-26OCT-T4.00:YES", 3));
    expect(yes.bids).toEqual([[0.34, 2.24], [0.33, 50004.76], [0.32, 6.06]]);
    // NO bids 0.65, 0.64, 0.63 are YES asks 0.35, 0.36, 0.37
    expect(yes.asks).toEqual([[0.35, 4095.99], [0.36, 288.5], [0.37, 50000]]);
    // three levels a side asked, three came: either side may go on
    expect(yes).toMatchObject({ from: "Kalshi", depth: "full", more: { bids: true, asks: true } });
    expect(n.sent.map((s) => s.url)).toEqual(["https://external-api.kalshi.com/trade-api/v2/markets/KXFED-26OCT-T4.00/orderbook?depth=3"]);
    // the NO leg the other way: its own bids, and the YES bids as its asks
    const nope = ok(await k.book!("KXFED-26OCT-T4.00:NO", 3));
    expect(nope.bids).toEqual([[0.65, 4095.99], [0.64, 288.5], [0.63, 50000]]);
    expect(nope.asks).toEqual([[0.66, 2.24], [0.67, 50004.76], [0.68, 6.06]]);
  });

  it("gives a leg's trades at its own price, a buy when the taker bought this outcome", async () => {
    const k = kalshiPublic({ http: net().http, clock: () => NOW });
    expect(ok(await k.trades!("KXFED-26OCT-T4.00:YES", 30))).toEqual([
      { price: 0.35, size: 5.7, side: "sell", at: "2026-10-14T17:29:13.768Z" },
      { price: 0.37, size: 61, side: "buy", at: "2026-10-14T17:06:48.852Z" },
    ]);
    expect(ok(await k.trades!("KXFED-26OCT-T4.00:NO", 30)).map((t) => [t.price, t.side])).toEqual([[0.65, "buy"], [0.63, "sell"]]);
    expect(refused(await k.book!("KXFED", 10)).message).toContain("<ticker>:YES or <ticker>:NO");
  });
});

describe("Polymarket, keyless: the outcome's own book on the CLOB, its trades from the Data API", () => {
  const SLUG = "will-the-fed-cut";
  const YES = "1110619025448142662072672955056394086074006257958916184626827264609217829937";
  const NO_T = "4203877586619821261549165011488181821966513998176320769911049161533327379541";
  const COND = `0x${"df".repeat(32)}`;
  const gamma = json({ slug: SLUG, conditionId: COND, outcomes: '["Yes", "No"]', clobTokenIds: JSON.stringify([YES, NO_T]) });
  // the CLOB sends each side worst first: the bids from 0.01 up, the asks from 0.99 down
  const clob = json({ market: COND, asset_id: NO_T, timestamp: String(NOW - 500), bids: [{ price: "0.01", size: "2220978.07" }, { price: "0.32", size: "2500" }, { price: "0.33", size: "2492.53" }], asks: [{ price: "0.99", size: "2152353.79" }, { price: "0.35", size: "100" }, { price: "0.34", size: "59427.81" }], tick_size: "0.01" });
  const trades = json([
    { proxyWallet: "0x8a02530ad61fcee13552b7386309a974fd17bc34", side: "SELL", asset: NO_T, conditionId: COND, size: 1406.25, price: 0.33, timestamp: 1791999739, name: "someone", pseudonym: "", bio: "", profileImage: "" },
    { proxyWallet: "0x296693128006a7ae0000000000000000000000000", side: "BUY", asset: YES, conditionId: COND, size: 1.49, price: 0.67, timestamp: 1791999740, name: "someone else" },
    { proxyWallet: "0x1", side: "BUY", asset: NO_T, conditionId: COND, size: 3.05, price: 0.3399999477, timestamp: 1791999745, name: "a third" },
  ]);

  it("reads the outcome's token from Gamma, then its book from the CLOB, best first", async () => {
    const n = network([[`/markets/slug/${SLUG}`, gamma], ["clob.polymarket.com/book", clob]]);
    const p = polymarketPublic({ http: n.http, clock: () => NOW });
    const b = ok(await p.book!(`${SLUG}:No`, 2));
    // the CLOB sends its whole book: a side goes on only where it was cut to the depth here (three levels a side, two asked)
    expect(b).toEqual({ bids: [[0.33, 2492.53], [0.32, 2500]], asks: [[0.34, 59427.81], [0.35, 100]], at: new Date(NOW - 500).toISOString(), from: "Polymarket", depth: "full", more: { bids: true, asks: true } });
    expect(ok(await p.book!(`${SLUG}:No`, 5)).more).toEqual({ bids: false, asks: false });
    expect(n.sent.map((s) => s.url)).toEqual([`https://gamma-api.polymarket.com/markets/slug/${SLUG}`, `https://clob.polymarket.com/book?token_id=${NO_T}`]);
  });

  it("gives every trade of the market's one book on each leg — the other outcome's at 1 − its price and the other side — and nothing of who made them", async () => {
    const n = network([[`/markets/slug/${SLUG}`, gamma], ["data-api.polymarket.com/trades", trades]]);
    const p = polymarketPublic({ http: n.http, clock: () => NOW });
    const t = ok(await p.trades!(`${SLUG}:No`, 30));
    // a taker buying YES at 0.67 sold NO at 0.33: the NO leg's book traded there too
    expect(t).toEqual([
      { price: 0.3399999477, size: 3.05, side: "buy", at: new Date(1791999745 * 1000).toISOString() },
      { price: 0.33, size: 1.49, side: "sell", at: new Date(1791999740 * 1000).toISOString() },
      { price: 0.33, size: 1406.25, side: "sell", at: new Date(1791999739 * 1000).toISOString() },
    ]);
    // the YES leg: the same three trades, from its side — none left out, none counted twice, no price rounded past what it says
    expect(ok(await p.trades!(`${SLUG}:Yes`, 30))).toEqual([
      { price: 0.6600000523, size: 3.05, side: "sell", at: new Date(1791999745 * 1000).toISOString() },
      { price: 0.67, size: 1.49, side: "buy", at: new Date(1791999740 * 1000).toISOString() },
      { price: 0.67, size: 1406.25, side: "buy", at: new Date(1791999739 * 1000).toISOString() },
    ]);
    expect(JSON.stringify(t)).not.toMatch(/proxyWallet|someone|0x8a02/);
    expect(n.sent[1]!.url).toBe(`https://data-api.polymarket.com/trades?market=${COND}&limit=30&takerOnly=true`);
    expect(PUBLIC_HOSTS).toContain("data-api.polymarket.com");
  });

  it("passes the CLOB's refusal on with its words", async () => {
    const n = network([[`/markets/slug/${SLUG}`, gamma], ["clob.polymarket.com/book", json({ error: "No orderbook exists for the requested token id" }, 404)]]);
    const r = refused(await polymarketPublic({ http: n.http, clock: () => NOW }).book!(`${SLUG}:Yes`, 10));
    expect(r.message).toBe("Polymarket refused the request (HTTP 404)");
    expect(JSON.stringify(r.native)).toContain("No orderbook exists for the requested token id");
  });
});

describe("Polymarket US, keyless: the gateway's YES book; NO is its other side", () => {
  const SLUG = "ipcc-2026ipos-anthropic";
  const BOOK_US = { marketData: { marketSlug: SLUG, bids: [{ px: { value: "0.7200", currency: "USD" }, qty: "552.0000" }, { px: { value: "0.7000", currency: "USD" }, qty: "15.0000" }], offers: [{ px: { value: "0.7300", currency: "USD" }, qty: "96.0000" }, { px: { value: "0.7500", currency: "USD" }, qty: "36.0000" }], state: "MARKET_STATE_OPEN", transactTime: "2026-10-14T17:44:52.368510062Z" } };

  it("a YES leg as the gateway gives it; a NO leg's bids are the YES offers at 1 − their price, its asks the YES bids so", async () => {
    const n = network([[`/v1/markets/${SLUG}/book`, json(BOOK_US)]]);
    const s = polymarketUsPublic({ http: n.http, clock: () => NOW });
    // the gateway sends its whole book (no cap at twenty, live): two levels where ten were asked is all of it
    expect(ok(await s.book!(`${SLUG}:YES`, 10))).toEqual({ bids: [[0.72, 552], [0.7, 15]], asks: [[0.73, 96], [0.75, 36]], at: "2026-10-14T17:44:52.368Z", from: "Polymarket US", depth: "full", more: { bids: false, asks: false } });
    const nb = ok(await s.book!(`${SLUG}:NO`, 10));
    expect([nb.bids, nb.asks]).toEqual([[[0.27, 96], [0.25, 36]], [[0.28, 552], [0.3, 15]]]);
    expect(ok(await s.book!(`${SLUG}:NO`, 1)).more).toEqual({ bids: true, asks: true });
    expect(n.sent[0]!.url).toBe(`https://gateway.polymarket.us/v1/markets/${SLUG}/book`);
    // the gateway publishes no trades: none are offered
    expect(s.trades).toBeUndefined();
  });
});

describe("Hyperliquid, keyless: l2Book and recentTrades, through its own POST guard", () => {
  const L2 = { coin: "BTC", time: NOW - 200, levels: [[{ px: "81768.0", sz: "14.31819", n: 70 }, { px: "81767.0", sz: "0.20924", n: 4 }], [{ px: "81769.0", sz: "6.21438", n: 7 }, { px: "81772.0", sz: "0.01202", n: 1 }]] };
  const RECENT = [
    { coin: "BTC", side: "B", px: "81769.0", sz: "0.00431", time: NOW - 100, hash: "0xed1e", tid: 1, users: ["0xa7", "0x7d"] },
    { coin: "BTC", side: "A", px: "81768.0", sz: "0.00221", time: NOW - 900, hash: "0x3dd2", tid: 2, users: ["0xe0", "0x7d"] },
  ];

  it("asks exactly {type: l2Book, coin} and gives its levels best first; B is a buy, A a sell", async () => {
    const n = network([['"type":"l2Book"', json(L2)], ['"type":"recentTrades"', json(RECENT)]]);
    const hl = hyperliquidPublic({ http: n.http, clock: () => NOW });
    expect(ok(await hl.book!("BTC-PERP", 20))).toEqual({ bids: [[81768, 14.31819], [81767, 0.20924]], asks: [[81769, 6.21438], [81772, 0.01202]], at: new Date(NOW - 200).toISOString(), from: "Hyperliquid", depth: "full", more: { bids: false, asks: false } });
    expect(ok(await hl.trades!("BTC-PERP", 30))).toEqual([
      { price: 81769, size: 0.00431, side: "buy", at: new Date(NOW - 100).toISOString() },
      { price: 81768, size: 0.00221, side: "sell", at: new Date(NOW - 900).toISOString() },
    ]);
    expect(n.sent.map((s) => [s.url, s.method, s.body])).toEqual([
      ["https://api.hyperliquid.xyz/info", "POST", '{"type":"l2Book","coin":"BTC"}'],
      ["https://api.hyperliquid.xyz/info", "POST", '{"type":"recentTrades","coin":"BTC"}'],
    ]);
  });

  it("a side of twenty — the most l2Book ever sends — may go on, even where fifty were wanted", async () => {
    const twenty = { ...L2, levels: [Array.from({ length: 20 }, (_, i) => ({ px: String(81768 - i), sz: "1", n: 1 })), L2.levels[1]] };
    const hl = hyperliquidPublic({ http: network([['"type":"l2Book"', json(twenty)]]).http, clock: () => NOW });
    const b = ok(await hl.book!("BTC-PERP", 50));
    expect([b.bids.length, b.more]).toEqual([20, { bids: true, asks: false }]);
  });

  it("says a coin it does not trade is that — its `null` — not that Hyperliquid failed; a HIP-3 market is asked by its dex's coin", async () => {
    const n = network([['"type":"l2Book"', { status: 200, body: null, text: "null" }], ['"type":"recentTrades"', { status: 500, body: null, text: "null" }]]);
    const hl = hyperliquidPublic({ http: n.http, clock: () => NOW });
    const r = refused(await hl.book!("NOPE-PERP", 10));
    expect([r.code, r.message]).toEqual(["E_VENUE_REJECTED", "Hyperliquid trades no perpetual NOPE"]);
    expect(refused(await hl.trades!("NOPE-PERP", 10)).message).toBe("Hyperliquid trades no perpetual NOPE");
    // the first dex's source takes no dex's coin, and the HIP-3 source only one
    expect(refused(await hl.book!("io:ANTH-PERP", 10)).code).toBe("E_ACCOUNT_BAD_ACTION");
    const hip = network([['"type":"l2Book"', json({ ...L2, coin: "io:ANTH" })]]);
    ok(await hyperliquidPreIpoPublic({ http: hip.http, clock: () => NOW }).book!("io:ANTH-PERP", 5));
    expect(hip.sent[0]!.body).toBe('{"type":"l2Book","coin":"io:ANTH"}');
  });
});

// ---- the paper account: both passed through to the market's own source --------------------------------------------------------------

const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const listing = (symbol: string, kind: Market["kind"], price: number, extra: Partial<Listing> = {}): Listing => ({ symbol, name: symbol, kind, base: symbol.split("/")[0]!, quote: "USD", price, bid: price - 1, ask: price + 1, open: true, types: [], ...extra });
const BOOK_PUB: OrderBook = { bids: [[59_999, 1.5], [59_998, 2]], asks: [[60_001, 0.5]], at: new Date(NOW).toISOString(), from: "Pub Exchange", depth: "full" };
const EVENT_BOOK: OrderBook = { bids: [[0.39, 100]], asks: [[0.41, 50]], at: new Date(NOW).toISOString(), from: "Predict", depth: "full" };
const TRADES_PUB: PublicTrade[] = [{ price: 60_000, size: 0.1, side: "buy", at: new Date(NOW).toISOString() }];
const PERP_BOOK: OrderBook = { bids: [[81_768, 2]], asks: [[81_769, 3]], at: new Date(NOW).toISOString(), from: "Perps", depth: "full", more: { bids: false, asks: false } };
/** a public exchange with a book and trades, and US stocks with neither (a public quote: best bid and ask, no sizes) */
function publicStandIns(asked: string[]): PublicSource[] {
  return [
    {
      id: "pubex",
      name: "Pub Exchange",
      kind: "exchange",
      connectTo: "pubex",
      connector: "live:exchange:pubex",
      async listings(o) {
        return [listing("BTC/USD", "spot", 60_000)].filter((m) => !o.q || m.symbol.includes(o.q.toUpperCase()) || m.base === o.q.toUpperCase());
      },
      async book(symbol, depth) {
        asked.push(`pubex book ${symbol} ${depth}`);
        return symbol === "BTC/USD" ? BOOK_PUB : no("E_VENUE_REJECTED", { venue: "pubex", message: `Pub Exchange lists no market ${symbol}` });
      },
      async trades(symbol, limit) {
        asked.push(`pubex trades ${symbol} ${limit}`);
        return TRADES_PUB;
      },
    },
    {
      id: "predict-pub",
      name: "Predict",
      kind: "events",
      connectTo: "predict",
      connector: "live:standin-book-predict",
      async listings() {
        return [];
      },
      async book(symbol) {
        asked.push(`predict book ${symbol}`);
        if (symbol === "EV-1:YES") return EVENT_BOOK;
        // a market in its form that it holds no book for: its own words; a name not in its form: not one of its markets at all
        return /^EV-\d+:YES$/.test(symbol) ? no("E_VENUE_REJECTED", { venue: "predict-pub", message: `Predict holds no book for ${symbol}` }) : no("E_ACCOUNT_BAD_ACTION", { venue: "predict-pub", message: `a Predict market here is <ticker>:YES, not "${symbol}"` });
      },
      async trades(symbol) {
        if (!/^EV-\d+:YES$/.test(symbol)) return no("E_ACCOUNT_BAD_ACTION", { venue: "predict-pub", message: `a Predict market here is <ticker>:YES, not "${symbol}"` });
        return [{ price: 0.4, size: 3, side: "sell", at: new Date(NOW).toISOString() }];
      },
    },
    // an exchange's pre-IPO contracts: a book the account does not read, a listing kept a while with no time of its own on its quotes
    {
      id: "preipo-pub",
      name: "Pre-IPO Ex",
      kind: "exchange",
      connectTo: "preipo",
      connector: "live:exchange:preipo",
      async listings() {
        return [listing("OPENAI-PERP", "perp", 900, { base: "OPENAI", bid: 899.5, ask: 900.5 })];
      },
    },
    // a perpetual exchange's two listings for one connection, named by its own coin as Hyperliquid's are (BTC-PERP; a HIP-3 dex's xyz:NVDA-PERP)
    ...[
      { id: "perps-pub", name: "Perps", form: /^[A-Za-z0-9]+-PERP$/ },
      { id: "perps-hip-pub", name: "Perps HIP-3", form: /^[a-z0-9]+:[A-Za-z0-9]+-PERP$/ },
    ].map(
      ({ id, name, form }): PublicSource => ({
        id,
        name,
        kind: "exchange",
        connectTo: "perps",
        connector: "live:standin-book-perps",
        async listings() {
          return [];
        },
        async book(symbol) {
          asked.push(`${id} book ${symbol}`);
          if (!form.test(symbol)) return no("E_ACCOUNT_BAD_ACTION", { venue: id, message: `a ${name} perpetual here is <COIN>-PERP, not "${symbol}"` });
          if (symbol === "ETH-PERP") return no("E_VENUE_UNREACHABLE", { venue: id, message: `${name} did not answer in 5 seconds` });
          return { ...PERP_BOOK, from: `${name} ${symbol}` };
        },
      }),
    ),
    {
      id: "us-stocks",
      name: "US stocks",
      kind: "stocks",
      connectTo: "alpaca",
      connector: "live:alpaca",
      async listings(o) {
        asked.push(`stocks listings ${o.q ?? ""}`);
        return [listing("AAPL", "stock", 190, { base: "AAPL", bid: 189.98, ask: 190.02, quoteFrom: "Nasdaq · real time", quoteAt: new Date(NOW - 5_000).toISOString() })].filter((m) => !o.q || m.symbol === o.q.toUpperCase());
      },
    },
  ];
}

describe("the paper account passes the book and the trades through to its market's public source", () => {
  it("answers with the source's own book and trades; says so where the source has none, so the account shows the best bid and ask", async () => {
    const h = mkdtempSync(join(tmpdir(), "live-book-paper-"));
    homes.push(h);
    const asked: string[] = [];
    const opened = await paperSource({ home: h, venue: "paper-1", label: "", cashUsd: 10_000, sources: () => publicStandIns(asked), clock: () => NOW });
    if (isRefusal(opened)) throw new Error(opened.message);
    const t = opened.source.trader!;
    expect(ok(await t.book!("BTC/USD", 7))).toEqual(BOOK_PUB);
    expect(ok(await t.trades!("BTC/USD", 12))).toEqual(TRADES_PUB);
    expect(asked).toEqual(expect.arrayContaining(["pubex book BTC/USD 7", "pubex trades BTC/USD 12"]));
    const none = refused(await t.book!("AAPL", 7));
    // US stocks' public quotes have no depth at all: said so, for the line under the best bid and ask
    expect([none.code, none.detail]).toEqual(["E_VENUE_RAIL_CLOSED", { book: "none", topOnly: "none" }]);
    expect(none.message).toMatch(/: US stocks publishes no order book$/);
    expect(refused(await t.trades!("AAPL", 7)).message).toMatch(/: US stocks publishes no trades$/);
    expect(refused(await t.book!("NOTHING/USD", 7)).message).toMatch(/no public source lists NOTHING\/USD just now/);
  });
});

// ---- a connected exchange's own client -------------------------------------------------------------------------------------------------

describe("a connected exchange answers from its own client", () => {
  const markets: Record<string, Rec> = { "BTC/USDT": { id: "BTC-USDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", type: "spot", spot: true, active: true, precision: { amount: 0.00000001, price: 0.1 }, limits: { amount: { min: 0.00001 } }, info: { state: "live" } } };
  const client = (id: string, calls: string[]): ExchangeClient =>
    ({
      id,
      markets,
      precisionMode: 4,
      has: { fetchOrderBook: true, fetchTrades: true },
      async loadMarkets() {
        return markets;
      },
      async fetchBalance() {
        return {};
      },
      async fetchOrderBook(symbol: string, limit?: number) {
        calls.push(`book:${symbol}:${limit}`);
        return BOOK;
      },
      async fetchTrades(symbol: string, since?: number, limit?: number) {
        calls.push(`trades:${symbol}:${limit}`);
        return TRADES;
      },
    }) as unknown as ExchangeClient;

  it("gives its book best first and its trades newest first, the side where the exchange says it is the taker's (OKX), none at Coinbase", async () => {
    const calls: string[] = [];
    const okx = exchangeTrader(client("okx", calls), "okx", "OKX", [], { can: ["read", "trade"] }, { now: () => NOW });
    const b = ok(await okx.book!("BTC/USDT", 2));
    expect([b.bids, b.asks, b.from, b.depth, b.more]).toEqual([[[81768, 14.31819], [81767, 0.20924]], [[81769, 6.21438], [81770, 0.03668]], "OKX", "full", { bids: true, asks: true }]);
    expect(ok(await okx.trades!("BTC/USDT", 2))).toEqual([
      { price: 81769, size: 0.001, side: "buy", at: new Date(NOW - 2_000).toISOString() },
      { price: 81769, size: 0.00431, side: "buy", at: new Date(NOW - 2_000).toISOString() },
    ]);
    expect(calls).toEqual(["book:BTC/USDT:20", "trades:BTC/USDT:2"]);
    const cb = exchangeTrader(client("coinbase", []), "coinbase", "Coinbase", [], { can: ["read", "trade"] }, { now: () => NOW });
    expect(ok(await cb.trades!("BTC/USDT", 30)).some((t) => t.side !== undefined)).toBe(false);
    expect(refused(await okx.book!("ETH/USDT", 5)).message).toContain('OKX lists no market "ETH/USDT"');
    // an exchange the library reads no book of has none
    const bare = exchangeTrader({ ...client("okx", []), has: { fetchOrderBook: false, fetchTrades: false } } as ExchangeClient, "okx", "OKX", [], { can: ["read"] });
    expect([bare.book, bare.trades]).toEqual([undefined, undefined]);
  });
});

// ---- the service and the routes ------------------------------------------------------------------------------------------------------

const owner = simKey("owner");
const CONNECTED_BOOK: OrderBook = { bids: [[59_950, 3]], asks: [[60_050, 4]], at: new Date(NOW).toISOString(), from: "Pub Ex (connected)", depth: "full" };
function stub(list: Market[], over: Partial<LiveTrader> = {}): LiveTrader {
  return {
    can: true,
    what: "a stand-in",
    async markets() {
      return list;
    },
    async market(symbol) {
      const m = list.find((x) => x.symbol === symbol);
      return m ? { ...m } : no("E_VENUE_REJECTED", { venue: "standin", message: `no market ${symbol}` });
    },
    async place(): Promise<OrderState> {
      return { ref: "r-1", status: "open", filledQty: 0, native: {} };
    },
    async cancel(ref) {
      return { ref, status: "canceled", filledQty: 0, native: {} };
    },
    async status(ref) {
      return { ref, status: "open", filledQty: 0, native: {} };
    },
    ...over,
  };
}
function connector(kind: string, name: string, trader: LiveTrader): void {
  register({ kind, label: name, needs: "key-file", example: "", venues: [], async open(req) {
    return { source: { name: req.label || name, kind: "cex", reference: "standin", via: "a stand-in", probe: { can: ["read", "trade"], note: "" }, read: async () => [], trader, readOnlyBecause: "a stand-in moves no money" } as LiveSource, first: [], summary: "connected" };
  } });
}

describe("the service picks a connected venue's trader before a public source, and the routes answer in the page's shapes", () => {
  let home: string;
  let svc: PortfolioService;
  let server: PortfolioServerHandle;
  const asked: string[] = [];
  let traderBooks = 0;
  let n = 0;
  type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: Date.now() + ++n } as OwnerAction));
  const done = (o: Outcome | Refusal) => {
    if (isRefusal(o)) throw new Error(`${o.code}: ${o.message}`);
    return o;
  };
  const get = async (path: string) => {
    const r = await fetch(`${server.url}${path}`);
    return { status: r.status, body: (await r.json()) as any };
  };

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "live-book-svc-"));
    const BTC: Market = { symbol: "BTC/USDT", name: "BTC / USDT", kind: "spot", base: "BTC", quote: "USDT", price: 60_000, bid: 59_950, ask: 60_050, open: true, types: ["market", "limit"] };
    connector("standin-book-ex", "Pub Ex", stub([BTC], { async book(symbol, depth) {
      traderBooks++;
      return symbol === "BTC/USDT" && depth === 5 ? CONNECTED_BOOK : no("E_VENUE_REJECTED", { venue: "pubex", message: "asked otherwise" });
    } }));
    const AAPL: Market = { symbol: "AAPL", name: "Apple", kind: "stock", base: "AAPL", quote: "USD", price: 190, bid: 189.9, ask: 190.1, open: true, types: ["market", "limit"], quoteAt: new Date(NOW - 1_000).toISOString() };
    connector("standin-book-broker", "Broker", stub([AAPL]));
    const EV: Market = { symbol: "EV-1:YES", name: "An event · Yes", kind: "event", base: "EV-1:YES", quote: "USD", price: 0.4, bid: 0.39, ask: 0.41, open: true, types: ["limit"] };
    connector("standin-book-predict", "Predict", stub([EV, { ...EV, symbol: "EV-2:YES" }, { ...EV, symbol: "EV3-SERIES", base: "EV3-SERIES" }]));
    // a perpetual exchange's connection whose trader names markets the exchange library's way and reads no book
    const perp = (symbol: string, base: string): Market => ({ symbol, name: symbol, kind: "perp", base, quote: "USDC", price: 100, bid: 99, ask: 101, open: true, types: ["market", "limit"] });
    connector("standin-book-perps", "Perps", stub([perp("BTC/USDC:USDC", "BTC"), perp("XYZ-NVDA/USDC:USDC", "NVDA"), perp("KPEPE/USDC:USDC", "kPEPE"), perp("ETH/USDC:USDC", "ETH"), { ...perp("HYPE/USDC", "HYPE"), kind: "spot" }]));
    svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveWrites: { capUsd: 5_000, pairingCode: "K7QX-M2PA" }, publicMarkets: publicStandIns(asked), liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] } });
    server = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 3_600_000 });
    done(await own({ type: "connectVenue", venue: "pubex", connector: "live:standin-book-ex", label: "Pub Ex", credentialRef: "" }));
    done(await own({ type: "connectVenue", venue: "broker", connector: "live:standin-book-broker", label: "Broker", credentialRef: "" }));
    done(await own({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" }));
    done(await own({ type: "connectVenue", venue: "predict", connector: "live:standin-book-predict", label: "Predict", credentialRef: "" }));
    done(await own({ type: "connectVenue", venue: "perps", connector: "live:standin-book-perps", label: "Perps", credentialRef: "" }));
  }, 30_000);
  afterAll(async () => {
    await server?.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("a connected venue answers from its own trader, kept a moment; a public source by its id, without a key", async () => {
    // "pubex" is connected AND a public source: the connection speaks for it
    expect(ok(await svc.marketBook("pubex", "BTC/USDT", 5))).toEqual({ venue: "pubex", venueName: "Pub Ex", symbol: "BTC/USDT", book: CONNECTED_BOOK });
    await svc.marketBook("pubex", "BTC/USDT", 5);
    expect(traderBooks).toBe(1);
    // the paper account passes through to its market's public source
    expect(ok(await svc.marketBook("paper-1", "BTC/USD", 20)).book).toEqual(BOOK_PUB);
    expect(ok(await svc.marketTrades("paper-1", "BTC/USD", 30)).trades).toEqual(TRADES_PUB);
    // a connected venue with no trades says so: the venue's fact, an empty list and the sentence, not a refusal
    expect(ok(await svc.marketTrades("pubex", "BTC/USDT", 30))).toEqual({ venue: "pubex", venueName: "Pub Ex", symbol: "BTC/USDT", trades: [], none: "Pub Ex publishes no trades the account can read" });
  });

  it("a connected venue whose trader reads no book shows its own public book — the public source made for the same connection — and its trades", async () => {
    expect(ok(await svc.marketBook("predict", "EV-1:YES", 20))).toEqual({ venue: "predict", venueName: "Predict", symbol: "EV-1:YES", book: EVENT_BOOK });
    expect(ok(await svc.marketTrades("predict", "EV-1:YES", 30)).trades).toEqual([{ price: 0.4, size: 3, side: "sell", at: new Date(NOW).toISOString() }]);
    // a market the public source knows but holds no book for: its own words — never a lesser book in their place
    const r = refused(await svc.marketBook("predict", "EV-2:YES", 20));
    expect([r.code, r.message]).toEqual(["E_VENUE_REJECTED", "Predict holds no book for EV-2:YES"]);
    // a market it does not name at all: the connected market's own best bid and ask, said to be all the account reads there
    expect(ok(await svc.marketBook("predict", "EV3-SERIES", 20)).book).toMatchObject({ bids: [[0.39, null]], asks: [[0.41, null]], depth: "top", from: "Predict", topOnly: "unread" });
    expect(ok(await svc.marketTrades("predict", "EV3-SERIES", 30))).toMatchObject({ trades: [], none: "Predict publishes no trades the account can read" });
    // a connection no public source speaks for has none of another venue's
    expect(ok(await svc.marketBook("broker", "AAPL", 20)).book.depth).toBe("top");
  });

  it("asks a connection's public listings by the name they know a perpetual by: the coin in the market's own letters, a HIP-3 dex's in small ones", async () => {
    const at = asked.length;
    expect(ok(await svc.marketBook("perps", "BTC/USDC:USDC", 20)).book).toEqual({ ...PERP_BOOK, from: "Perps BTC-PERP" });
    expect(ok(await svc.marketBook("perps", "XYZ-NVDA/USDC:USDC", 20)).book.from).toBe("Perps HIP-3 xyz:NVDA-PERP");
    // the library writes kPEPE as KPEPE; the market carries Hyperliquid's own letters
    expect(ok(await svc.marketBook("perps", "KPEPE/USDC:USDC", 20)).book.from).toBe("Perps kPEPE-PERP");
    expect(asked.slice(at)).toEqual(["perps-pub book BTC-PERP", "perps-pub book xyz:NVDA-PERP", "perps-pub book XYZ-NVDA/USDC:USDC", "perps-hip-pub book xyz:NVDA-PERP", "perps-pub book kPEPE-PERP"]);
    // a spot market no listing here names: what the connected market carries
    expect(ok(await svc.marketBook("perps", "HYPE/USDC", 20)).book).toMatchObject({ bids: [[99, null]], asks: [[101, null]], depth: "top", from: "Perps", topOnly: "unread" });
    // a listing that knows the market but does not answer: its words, not the market's best bid and ask with a line under them
    const late = refused(await svc.marketBook("perps", "ETH/USDC:USDC", 20));
    expect([late.code, late.message]).toEqual(["E_VENUE_UNREACHABLE", "Perps did not answer in 5 seconds"]);
    // and while that holds the listing back, its words stand for the venue's public side, whatever is asked of it
    expect(refused(await svc.marketBook("perps", "HYPE/USDC", 20)).message).toBe("Perps did not answer in 5 seconds");
  });

  it("a market whose source has no book is its best bid and ask only, depth top, with no size, named by its quote's source", async () => {
    const pub = ok(await svc.marketBook("us-stocks", "AAPL", 20));
    expect(pub).toEqual({ venue: "us-stocks", venueName: "US stocks", symbol: "AAPL", public: true, book: { bids: [[189.98, null]], asks: [[190.02, null]], at: new Date(NOW - 5_000).toISOString(), from: "Nasdaq · real time", depth: "top", topOnly: "none" } });
    expect(ok(await svc.marketTrades("us-stocks", "AAPL", 30))).toEqual({ venue: "us-stocks", venueName: "US stocks", symbol: "AAPL", trades: [], none: "US stocks publishes no trades the account can read", public: true });
    // a paper account on a stock: the source's fact too, said in the source's name — never the paper account's prefix
    expect(ok(await svc.marketTrades("paper-1", "AAPL", 30))).toMatchObject({ venue: "paper-1", symbol: "AAPL", trades: [], none: "US stocks publishes no trades the account can read" });
    // a market no source lists is still refused: only "publishes no trades" is the quiet answer
    expect(isRefusal(await svc.marketTrades("paper-1", "NOTHING/USD", 30))).toBe(true);
    // a source with a book the account does not read is never said to have none; a quote with no time of its own says how old it may be:
    // its source keeps it ninety seconds, and the service keeps the listing twenty more
    expect(ok(await svc.marketBook("preipo-pub", "OPENAI-PERP", 20)).book).toMatchObject({ bids: [[899.5, null]], asks: [[900.5, null]], from: "Pre-IPO Ex", depth: "top", topOnly: "unread", upToMs: 110_000 });
    // a paper account's market of it is kept three seconds more
    expect(ok(await svc.marketBook("paper-1", "OPENAI-PERP", 20)).book).toMatchObject({ bids: [[899.5, null]], asks: [[900.5, null]], depth: "top", upToMs: 113_000 });
    expect(ok(await svc.marketBook("us-stocks", "AAPL", 20)).book.upToMs).toBeUndefined();
    // a broker connected live with no book: the market it reads
    expect(ok(await svc.marketBook("broker", "AAPL", 20)).book).toEqual({ bids: [[189.9, null]], asks: [[190.1, null]], at: new Date(NOW - 1_000).toISOString(), from: "Broker", depth: "top", topOnly: "unread" });
    // a paper account on a stock: its source has no book, so the market's own best bid and ask
    const paper = ok(await svc.marketBook("paper-1", "AAPL", 20)).book;
    expect([paper.depth, paper.bids, paper.asks, paper.from, paper.topOnly]).toEqual(["top", [[189.98, null]], [[190.02, null]], "Nasdaq · real time", "none"]);
    expect(refused(await svc.marketBook("nowhere", "AAPL", 20)).code).toBe("E_WALLET_ACCOUNT_UNKNOWN");
  });

  it("answers GET /api/account/book and /api/account/trades in the page's shapes, and turns away what is not a count", async () => {
    const b = await get("/api/account/book?venue=pubex&symbol=BTC/USDT&depth=5");
    expect(b).toEqual({ status: 200, body: { ok: true, venue: "pubex", venueName: "Pub Ex", symbol: "BTC/USDT", book: CONNECTED_BOOK } });
    const t = await get(`/api/account/trades?${new URLSearchParams({ venue: "paper-1", symbol: "BTC/USD", limit: "30" })}`);
    expect(t.body).toMatchObject({ ok: true, venue: "paper-1", symbol: "BTC/USD", trades: TRADES_PUB });
    expect((await get("/api/account/book?venue=pubex&symbol=BTC/USDT&depth=lots")).status).toBe(400);
    expect((await get("/api/account/book?venue=pubex&symbol=BTC/USDT&depth=500")).status).toBe(400);
    expect((await get("/api/account/trades?venue=pubex&symbol=BTC/USDT&limit=1000")).status).toBe(400);
    expect((await get("/api/account/book?venue=pubex&venue=geo&symbol=BTC/USDT")).status).toBe(400);
    const no51 = await get("/api/account/book?venue=pubex&symbol=BTC/USDT&depth=51");
    expect([no51.status, no51.body.refusal.code]).toEqual([409, "E_ACCOUNT_BAD_ACTION"]);
    // a source that publishes no trades is answered 200 with an empty list and why, so the page's Trades tab is quiet and stops asking
    const none = await get("/api/account/trades?venue=us-stocks&symbol=AAPL");
    expect([none.status, none.body]).toEqual([200, { ok: true, venue: "us-stocks", venueName: "US stocks", symbol: "AAPL", trades: [], none: "US stocks publishes no trades the account can read", public: true }]);
    // every other refusal stays 409
    const unknown = await get("/api/account/trades?venue=nowhere&symbol=AAPL");
    expect([unknown.status, unknown.body.refusal.code]).toEqual([409, "E_WALLET_ACCOUNT_UNKNOWN"]);
  });
});
