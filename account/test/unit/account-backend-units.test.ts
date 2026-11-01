/** The smaller contracts behind the wallet page, one at a time against stand-ins (nothing leaves the process, no key anywhere):
 *
 *   public price history    an exchange's keyless OHLCV through the library, page by page (only for a pair it lists), a Kraken pair from
 *                           Coinbase Exchange, Kalshi's public candlesticks (NO as 1 − YES, five minutes folded from one), Polymarket's
 *                           prices-history through the outcome's token id — fixed hosts only
 *   movers                  one chip per asset: a coin's perpetual is the coin
 *   agentSetup              the command that adds this account's MCP seat, quoted where a shell would read the path
 *   the mm source's price   live/index.ts hands the price to the mm source, so a vault of a coin can be valued
 *   a device's label        kept when the owner lets it in, and after a restart
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { signOwner, signDevice, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { applyOwner, emptyState } from "../../src/portfolio/account/state.ts";
import { exploreAcross } from "../../src/portfolio/live/explore.ts";
import type { ExchangeClient, OpenExchange } from "../../src/portfolio/live/exchange.ts";
import { openLive, type LiveDeps } from "../../src/portfolio/live/index.ts";
import { exchangeTickers, holdBackMs, kalshiPublic, polymarketPublic, PUBLIC_HOSTS, stockTokensPublic, type PublicSource } from "../../src/portfolio/live/public-markets.ts";
import type { Candle, CandlePage, Market } from "../../src/portfolio/live/trade.ts";
import type { Http, HttpReply } from "../../src/portfolio/live/types.ts";
import { agentSetupOf } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const HOUR = 3_600_000;
const json = (body: unknown, status = 200): HttpReply => ({ status, body, text: JSON.stringify(body) });
const bars = (r: Candle[] | CandlePage | Refusal): Candle[] => {
  if (isRefusal(r)) throw new Error(`refused: ${r.code} ${r.message}`);
  return Array.isArray(r) ? r : r.bars;
};
const page = (r: Candle[] | CandlePage | Refusal): CandlePage => {
  if (isRefusal(r)) throw new Error(`refused: ${r.code} ${r.message}`);
  if (Array.isArray(r)) throw new Error("expected a page, got a plain list");
  return r;
};
const refusal = (r: unknown): Refusal => {
  if (!isRefusal(r)) throw new Error(`expected a refusal, got ${JSON.stringify(r).slice(0, 160)}`);
  return r;
};
/** a stand-in network that answers by URL and records every URL asked */
function network(routes: Array<[string, HttpReply]>) {
  const sent: string[] = [];
  const http: Http = async (url) => {
    sent.push(url);
    return routes.find(([k]) => url.includes(k))?.[1] ?? json({ error: "not found" }, 404);
  };
  return { http, sent };
}

describe("public price history, keyless", () => {
  it("an exchange through the library: fetchOHLCV page by page from the window's start for a pair it lists, nothing asked for a pair it does not", async () => {
    const asked: Array<[string, string, number, number]> = [];
    const client: ExchangeClient = {
      id: "binance",
      markets: { "BTC/USDT": { symbol: "BTC/USDT", base: "BTC", quote: "USDT", spot: true }, "BTC/EUR": { symbol: "BTC/EUR", base: "BTC", quote: "EUR", spot: true } },
      timeframes: { "5m": "5m", "1h": "1h", "1d": "1d" },
      async loadMarkets() {
        return {};
      },
      async fetchBalance() {
        throw new Error("never");
      },
      async fetchOHLCV(symbol, timeframe, since, limit) {
        asked.push([symbol, timeframe!, since!, limit!]);
        return [[NOW - 2 * HOUR, 100, 110, 95, 105, 3.5], [NOW - HOUR, 105, 108, 101, 107, 2], ["junk"], [NOW - 3 * HOUR * 1000, 1, 1, 1, 1, 1]];
      },
    };
    const open: OpenExchange = async () => client;
    const src = exchangeTickers("binance", { open, clock: () => NOW });
    const got = page(await src.candles!("BTC/USDT", "1h", { since: NOW - 20 * 24 * HOUR }));
    expect(got.bars).toEqual([{ t: NOW - 2 * HOUR, o: 100, h: 110, l: 95, c: 105, v: 3.5 }, { t: NOW - HOUR, o: 105, h: 108, l: 101, c: 107, v: 2 }]);
    // the window's own hours, from its first whole bar to the one forming now, in one page of Binance's thousand
    expect(asked).toEqual([["BTC/USDT", "1h", NOW - 480 * HOUR, 481]]);
    expect([got.more, got.source]).toEqual([true, "Binance · BTC/USDT"]);
    expect(refusal(await src.candles!("BTC/EUR", "1h", { since: NOW - HOUR })).message).toMatch(/lists no market BTC\/EUR priced in dollars/);
    expect(refusal(await src.candles!("ETH/USD?x=1", "1h", { since: NOW - HOUR })).code).toBe("E_VENUE_REJECTED");
    expect(refusal(await src.candles!("BTC/USDT", "2h" as never, { since: NOW - HOUR })).code).toBe("E_ACCOUNT_BAD_ACTION");
    // a size the exchange does not publish is folded from the finer one it does: 4h from 1h, on UTC's four-hour marks
    const four = page(await src.candles!("BTC/USDT", "4h", { since: NOW - 8 * HOUR }));
    expect(asked[asked.length - 1]!.slice(1, 3)).toEqual(["1h", NOW - 8 * HOUR]);
    expect(four.folded).toBe("4-hour bars folded from Binance's hourly bars");
    expect(four.bars).toEqual([{ t: NOW - 4 * HOUR, o: 100, h: 110, l: 95, c: 107, v: 5.5 }]);
  });

  /** a keyless Kraken client: BTC/USD, XYZ/USD and ENJ/USD listed, its own bars one an hour, every fetchOHLCV recorded */
  const krakenClient = (handed: string[]): ExchangeClient => ({
    id: "kraken",
    markets: { "BTC/USD": { symbol: "BTC/USD", base: "BTC", quote: "USD", spot: true }, "XYZ/USD": { symbol: "XYZ/USD", base: "XYZ", quote: "USD", spot: true }, "ENJ/USD": { symbol: "ENJ/USD", base: "ENJ", quote: "USD", spot: true } },
    timeframes: { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "1440", "1w": "10080" },
    async loadMarkets() {
      return {};
    },
    async fetchBalance() {
      throw new Error("never");
    },
    async fetchOHLCV(symbol, timeframe, since, limit) {
      handed.push(`${symbol}|${timeframe}|${since}|${limit}`);
      return [[NOW - HOUR, 5, 6, 4, 5.5, 1]];
    },
    async fetchTickers() {
      return { "BTC/USD": { symbol: "BTC/USD", last: 60000, info: { c: ["60000.0", "0.1"], v: ["1", "10"], p: ["60000", "60000"] } } };
    },
  });

  it("Kraken: a dollar pair's history from Coinbase Exchange where it trades that product now (Kraken keeps only its latest 720 bars), its own 720 where Coinbase lists none or no longer trades it", async () => {
    const handed: string[] = [];
    const net = network([
      ["/products/BTC-USD/candles", json([[(NOW - HOUR) / 1000, 99, 110, 100, 105, 7]])],
      // a delisted product answers its candles empty, 200 [] (ENJ-USD live, 2026-10-17): its status says so
      ["/products/ENJ-USD/candles", json([])],
      ["/products/BTC-USD", json({ id: "BTC-USD", status: "online", trading_disabled: false })],
      ["/products/ENJ-USD", json({ id: "ENJ-USD", status: "delisted", trading_disabled: true })],
      ["/products/XYZ-USD", json({ message: "NotFound" }, 404)],
    ]);
    const src = exchangeTickers("kraken", { open: async () => krakenClient(handed), http: net.http, clock: () => NOW, pace: async () => undefined });
    expect(src.historyApart).toBe(true);
    const btc = page(await src.candles!("BTC/USD", "1h", { since: NOW - 2 * HOUR }));
    expect(btc.bars).toEqual([{ t: NOW - HOUR, o: 100, h: 110, l: 99, c: 105, v: 7 }]);
    expect(btc.source).toBe("Coinbase Exchange · BTC-USD");
    // whether Coinbase Exchange trades the product, then its candles
    expect(net.sent.map((x) => new URL(x).pathname)).toEqual(["/products/BTC-USD", "/products/BTC-USD/candles"]);
    const u = new URL(net.sent[1]!);
    expect([u.host, u.pathname, u.searchParams.get("granularity"), u.searchParams.get("start"), u.searchParams.get("end")]).toEqual(["api.exchange.coinbase.com", "/products/BTC-USD/candles", "3600", new Date(NOW - 2 * HOUR).toISOString().replace(".000", ""), new Date(NOW).toISOString().replace(".000", "")]);
    expect(handed).toEqual([]);
    const xyz = page(await src.candles!("XYZ/USD", "1h", { since: NOW - 2 * HOUR }));
    expect([xyz.bars.length, xyz.more, xyz.ends, xyz.source]).toEqual([1, false, "Kraken keeps only the latest 720 bars at this size, and no venue with a longer history lists XYZ/USD", "Kraken · XYZ/USD"]);
    expect(handed).toEqual(["XYZ/USD|1h|undefined|720"]);
    // delisted at Coinbase Exchange: Kraken's own bars, never Coinbase's empty page — and its candles are not asked at all
    const enj = page(await src.candles!("ENJ/USD", "1h", { since: NOW - 2 * HOUR }));
    expect([enj.bars.length, enj.ends, enj.source]).toEqual([1, "Kraken keeps only the latest 720 bars at this size, and Coinbase Exchange no longer trades ENJ-USD", "Kraken · ENJ/USD"]);
    expect(net.sent.some((x) => x.includes("/products/ENJ-USD/candles"))).toBe(false);
    // a window inside Kraken's 720 says no end of its history, only why these are Kraken's own bars
    const inside = page(await src.candles!("ENJ/USD", "1h", { since: NOW - HOUR }));
    expect([inside.ends, inside.note]).toEqual([undefined, "Kraken's own latest bars: Coinbase Exchange no longer trades ENJ-USD"]);
    // Kraken's own weeks start on Thursday: a week is folded from its days, Monday weeks
    await src.candles!("XYZ/USD", "1w", { since: NOW - 30 * 24 * HOUR });
    expect(handed.at(-1)).toBe("XYZ/USD|1d|undefined|720");
    expect(net.sent.every((x) => PUBLIC_HOSTS.includes(new URL(x).host))).toBe(true);
  });

  it("Kraken's own bars alone where they are asked so (a paper account judging the time it slept): Coinbase Exchange is never asked", async () => {
    const handed: string[] = [];
    const net = network([["/products/BTC-USD", json({ status: "online", trading_disabled: false })]]);
    const src = exchangeTickers("kraken", { open: async () => krakenClient(handed), http: net.http, clock: () => NOW, pace: async () => undefined });
    const own = page(await src.candles!("BTC/USD", "1m", { since: NOW - 2 * HOUR, until: NOW, own: true }));
    expect([own.source, net.sent]).toEqual(["Kraken · BTC/USD", []]);
    expect(handed).toEqual(["BTC/USD|1m|undefined|720"]);
  });

  it("a 451 from Coinbase Exchange on a Kraken chart holds back that host's histories alone — Kraken's own bars are drawn, its listings still answer, a page scrolled left is refused in words scoped to Coinbase Exchange, and Coinbase's own chart is not asked meanwhile", async () => {
    const handed: string[] = [];
    const geo: HttpReply = { status: 451, body: { message: "Service unavailable from a restricted location" }, text: '{"message":"Service unavailable from a restricted location"}' };
    const net = network([["api.exchange.coinbase.com", geo]]);
    const deps = { open: async () => krakenClient(handed), http: net.http, clock: () => NOW, pace: async () => undefined };
    const kraken = exchangeTickers("kraken", deps);
    const coinbase = exchangeTickers("coinbase", { ...deps, open: async () => ({ id: "coinbase", markets: { "BTC/USD": { id: "BTC-USD", symbol: "BTC/USD", base: "BTC", quote: "USD", spot: true } }, async loadMarkets() { return {}; }, async fetchBalance() { throw new Error("never"); } }) as ExchangeClient });
    const first = page(await kraken.candles!("BTC/USD", "1h", { since: NOW - 2 * HOUR }));
    expect([first.source, first.ends]).toEqual(["Kraken · BTC/USD", "Kraken keeps only the latest 720 bars at this size, and Coinbase Exchange did not say whether it trades BTC-USD: Coinbase Exchange does not serve this location: that is its own rule, and the account does not look for a way around it"]);
    expect(net.sent).toHaveLength(1);
    // Kraken itself still answers: its listings were never held back
    expect(Array.isArray(await kraken.listings({ limit: 5 }))).toBe(true);
    // a page scrolled left stays with the series' venue: refused, scoped to Coinbase Exchange's history, so it holds back nothing of Kraken's
    const left = refusal(await kraken.candles!("BTC/USD", "1h", { until: NOW - 2 * HOUR, limit: 300 }));
    expect([left.code, (left.detail as { scope?: unknown }).scope, holdBackMs(left)]).toEqual(["E_VENUE_GEOBLOCKED", "Coinbase Exchange's history", 0]);
    // the host is held for every source made with these deps: Coinbase's own chart is answered the hold, nothing is asked
    const cb = refusal(await coinbase.candles!("BTC/USD", "1h", { since: NOW - 2 * HOUR }));
    expect([cb.code, net.sent.length]).toEqual(["E_VENUE_GEOBLOCKED", 1]);
  });

  it("Coinbase: a pair's history from Coinbase Exchange under the venue's own product id; a pair Coinbase trades on another book (its product's alias) from that book, said so", async () => {
    const client: ExchangeClient = {
      id: "coinbase",
      markets: { "BTC/USD": { id: "BTC-USD", symbol: "BTC/USD", base: "BTC", quote: "USD", spot: true }, "ETH/USDC": { id: "ETH-USDC", symbol: "ETH/USDC", base: "ETH", quote: "USDC", spot: true, info: { product_id: "ETH-USDC", alias: "ETH-USD" } } },
      async loadMarkets() {
        return {};
      },
      async fetchBalance() {
        throw new Error("never");
      },
    };
    const net = network([
      ["/products/BTC-USD/candles", json([[(NOW - HOUR) / 1000, 99, 110, 100, 105, 7]])],
      ["/products/ETH-USD/candles", json([[(NOW - HOUR) / 1000, 2399, 2410, 2400, 2405, 70]])],
    ]);
    const src = exchangeTickers("coinbase", { open: async () => client, http: net.http, clock: () => NOW, pace: async () => undefined });
    const btc = page(await src.candles!("BTC/USD", "1h", { since: NOW - 2 * HOUR }));
    expect([btc.source, btc.note]).toEqual(["Coinbase Exchange · BTC-USD", undefined]);
    const eth = page(await src.candles!("ETH/USDC", "1h", { since: NOW - 2 * HOUR }));
    expect([eth.bars[0]!.c, eth.source, eth.note]).toEqual([2405, "Coinbase Exchange · ETH-USD", "Coinbase trades ETH/USDC on its ETH-USD book: the history is that book's"]);
    expect(net.sent.map((u) => new URL(u).pathname)).toEqual(["/products/BTC-USD/candles", "/products/ETH-USD/candles"]);
  });

  it("Kalshi: its public candlesticks for the market's ticker — the trades' prices, NO turned over, five minutes folded from one", async () => {
    const stick = (endMin: number, o: string, h: string, l: string, c: string, v = "10.00") => ({ end_period_ts: Math.floor(NOW / 1000) - endMin * 60, price: { open_dollars: o, high_dollars: h, low_dollars: l, close_dollars: c }, volume_fp: v });
    const net = network([["/markets/candlesticks", json({ markets: [{ market_ticker: "KXFED-25DEC-T4.00", candlesticks: [stick(9, "0.40", "0.42", "0.39", "0.41"), stick(8, "0.41", "0.45", "0.41", "0.44"), { end_period_ts: Math.floor(NOW / 1000) - 7 * 60, price: { open_dollars: null } }] }] })]]);
    const src = kalshiPublic({ http: net.http, clock: () => NOW });
    const yes = bars(await src.candles!("KXFED-25DEC-T4.00:YES", "5m", { since: NOW - 24 * HOUR }));
    const no = bars(await src.candles!("kxfed-25dec-t4.00:no", "5m", { since: NOW - 24 * HOUR }));
    expect(yes).toHaveLength(1);
    expect(yes[0]).toMatchObject({ o: 0.4, h: 0.45, l: 0.39, c: 0.44, v: 20 });
    expect(no[0]).toMatchObject({ o: 0.6, h: 0.61, l: 0.55, c: 0.56 });
    const u = new URL(net.sent[0]!);
    expect([u.host, u.pathname, u.searchParams.get("market_tickers"), u.searchParams.get("period_interval")]).toEqual(["external-api.kalshi.com", "/trade-api/v2/markets/candlesticks", "KXFED-25DEC-T4.00", "1"]);
    expect(refusal(await src.candles!("../../x:YES", "1h", { since: NOW - HOUR })).message).toMatch(/<ticker>:YES/);
  });

  it("Polymarket: the outcome's token id from Gamma, then the CLOB's prices-history, folded into bars", async () => {
    const t0 = Math.floor(NOW / 1000) - 7200;
    const net = network([
      ["gamma-api.polymarket.com/markets/slug/nfl-atl-no-2026-10-06", json({ slug: "nfl-atl-no-2026-10-06", outcomes: '["Falcons", "Saints"]', clobTokenIds: '["111", "222"]' })],
      ["clob.polymarket.com/prices-history", json({ history: [{ t: t0, p: 0.47 }, { t: t0 + 600, p: 0.5 }, { t: t0 + 3700, p: 0.45 }, { t: t0 + 3800, p: 2 }] })],
    ]);
    const src = polymarketPublic({ http: net.http, clock: () => NOW });
    const got = bars(await src.candles!("nfl-atl-no-2026-10-06:Saints", "1h", { since: NOW - 12 * 24 * HOUR }));
    expect(got.map((b) => [b.o, b.h, b.l, b.c])).toEqual([[0.47, 0.5, 0.47, 0.5], [0.45, 0.45, 0.45, 0.45]]);
    expect(new URL(net.sent[1]!).searchParams.get("market")).toBe("222");
    expect(net.sent.every((u) => PUBLIC_HOSTS.includes(new URL(u).host))).toBe(true);
    expect(refusal(await src.candles!("nfl-atl-no-2026-10-06:Rams", "1h", { since: NOW - HOUR })).message).toMatch(/no outcome "Rams"/);
    expect(refusal(await src.candles!("NOT A SLUG:Yes", "1h", { since: NOW - HOUR })).code).toBe("E_ACCOUNT_BAD_ACTION");
  });

  it("MAX and wide windows at the event venues: never a start of 0 (both answer it HTTP 400), Kalshi asked from its market's open and in spans of 9,999 periods at most (it refuses more than 10,000 candles a request)", async () => {
    const sent: URL[] = [];
    const OPEN = Date.parse("2025-08-06T14:30:00Z");
    const http: Http = async (url) => {
      const u = new URL(url);
      sent.push(u);
      if (u.pathname === "/trade-api/v2/markets/KXFED-26OCT-T2.75") return json({ market: { ticker: "KXFED-26OCT-T2.75", open_time: "2025-08-06T14:30:00Z" } });
      if (u.pathname === "/trade-api/v2/markets/candlesticks") {
        const [start, end, period] = ["start_ts", "end_ts", "period_interval"].map((k) => Number(u.searchParams.get(k)));
        if (!start) return json({ error: { code: "bad_request", message: "bad request", details: "start_ts is required" } }, 400);
        const count = Math.ceil((end! - start!) / (period! * 60));
        if (count > 10_000) return json({ error: { code: "bad_request", message: "bad request", details: `requested candlesticks across all markets: ${count}, max candlesticks: 10000` } }, 400);
        return json({ markets: [{ market_ticker: "KXFED-26OCT-T2.75", candlesticks: [{ end_period_ts: end, price: { open_dollars: "0.40", high_dollars: "0.42", low_dollars: "0.39", close_dollars: "0.41" }, volume_fp: "1.00" }] }] });
      }
      if (u.host === "gamma-api.polymarket.com") return json({ slug: "fed", outcomes: '["Yes", "No"]', clobTokenIds: '["111", "222"]' });
      if (u.host === "clob.polymarket.com") return Number(u.searchParams.get("startTs")) ? json({ history: [{ t: Math.floor(NOW / 1000) - 3600, p: 0.4 }] }) : json({ error: "the time component is mandatory" }, 400);
      return json({ error: "not found" }, 404);
    };
    const kalshi = kalshiPublic({ http, clock: () => NOW });
    const max = page(await kalshi.candles!("KXFED-26OCT-T2.75:YES", "1w", { since: 0, limit: 5_000, range: "MAX" }));
    const sticks = sent.filter((u) => u.pathname.endsWith("/candlesticks"));
    // the market's open asked once, then one span from it
    expect(sent.map((u) => u.pathname.split("/").pop())).toEqual(["KXFED-26OCT-T2.75", "candlesticks"]);
    expect(Number(sticks[0]!.searchParams.get("start_ts"))).toBe(OPEN / 1000);
    expect([max.bars.length, max.more, max.ends]).toEqual([1, false, "Kalshi's KXFED-26OCT-T2.75 history starts Mon 5 Oct 2026"]);
    // a month of 15-minute bars is 43,200 one-minute candles: five spans of 9,999 at most, newest first, none refused
    sent.length = 0;
    const month = bars(await kalshi.candles!("KXFED-26OCT-T2.75:YES", "15m", { since: NOW - 30 * 24 * HOUR, limit: 5_000, range: "1M" }));
    const spans = sent.filter((u) => u.pathname.endsWith("/candlesticks")).map((u) => [Number(u.searchParams.get("start_ts")), Number(u.searchParams.get("end_ts"))]);
    expect(spans).toHaveLength(5);
    expect(spans.every(([a, b]) => (b! - a!) / 60 <= 9_999)).toBe(true);
    expect(spans[0]![1]).toBe(Math.floor(NOW / 60_000) * 60);
    expect(spans.at(-1)![0]).toBe((NOW - 30 * 24 * HOUR) / 1000);
    expect(month.length).toBeGreaterThan(0);
    // Polymarket's MAX asks from the first second, never 0
    sent.length = 0;
    const poly = polymarketPublic({ http, clock: () => NOW });
    expect(bars(await poly.candles!("fed:Yes", "1w", { since: 0, limit: 5_000, range: "MAX" }))).toHaveLength(1);
    expect(sent.find((u) => u.host === "clob.polymarket.com")!.searchParams.get("startTs")).toBe("1");
  });

  it("Robinhood's Stock Tokens publish none", () => {
    expect(stockTokensPublic({}).candles).toBeUndefined();
  });
});

describe("movers: one chip per asset", () => {
  const listing = (symbol: string, kind: Market["kind"], base: string, changePct24h: number, volumeUsd24h: number): Market => ({ symbol, name: symbol, kind, base, quote: "USDT", price: 100, open: true, types: [], changePct24h, volumeUsd24h });
  const source = (markets: Market[]): PublicSource => ({ id: "x", name: "X", kind: "exchange", connectTo: "x", connector: "live:exchange:x", listings: async () => markets });

  it("a coin and its perpetual both moving: the coin's own market is the chip; a perpetual alone is its own", async () => {
    const x = await exploreAcross({ public: [source([listing("BTC/USDT", "spot", "BTC", 3, 5e9), listing("BTC/USDT:USDT", "perp", "BTC", 9, 9e9), listing("SOL/USDT:USDT", "perp", "SOL", -7, 2e9), listing("ETH/USDT", "spot", "ETH", 1, 3e9)])] }, { clock: () => NOW });
    expect(x.movers.map((m) => m.key)).toEqual(["perp:SOL", "coin:BTC", "coin:ETH"]);
    // the perpetual's row is still in Perps
    expect(x.items.map((i) => i.key)).toContain("perp:BTC");
  });
});

describe("agentSetup: the command that adds this account's MCP seat", () => {
  it("names this server's origin and the seat by its absolute path, quoted where a shell would read it", () => {
    const s = agentSetupOf("http://127.0.0.1:4821");
    expect(s.url).toBe("http://127.0.0.1:4821");
    expect(s.command).toMatch(/^claude mcp add portfolio -e PORTFOLIO_URL=http:\/\/127\.0\.0\.1:4821 -- npx tsx \/\S+\/src\/portfolio\/mcp\.ts$/);
    expect(agentSetupOf("http://localhost:1 ;rm -rf ~").command).toContain("PORTFOLIO_URL='http://localhost:1 ;rm -rf ~'");
  });
});

describe("live/index.ts hands the price to the mm source", () => {
  it("so a vault of a coin is valued: the earner prices a WETH vault by the price it was given", async () => {
    const priced: string[] = [];
    const vault = { address: "0x1111111111111111111111111111111111111111", chainId: 8453, name: "WETH vault", protocol: { name: "Morpho" }, underlyingTokens: [{ address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 }], apy: { base: 0.02, reward: null, total: 0.02 }, tvlUsd: 50_000_000, isTransactional: true, isRedeemable: true };
    const mm = (async (args: string[]) => {
      if (args[0] === "wallet" && args[1] === "show") return { address: "0x2222222222222222222222222222222222222222", policyYaml: "" };
      if (args[0] === "wallet" && args[1] === "balance") return { currency: "usd", totalValue: "0", chains: [] };
      if (args[0] === "earn" && args[1] === "markets") return [vault];
      throw new Error(`not asked here: ${args.join(" ")}`);
    }) as LiveDeps["mm"];
    const deps = { home: "/nowhere", http: async () => json({}, 599), clock: () => NOW, proofs: undefined as never, chain: undefined as never, mm, price: async (a: string) => (priced.push(a), a === "WETH" ? 2_400 : undefined) } as unknown as LiveDeps;
    const opened = await openLive({ venue: "metamask", connector: "live:metamask", label: "", reference: "" }, deps);
    if (isRefusal(opened)) throw new Error(opened.message);
    const earner = opened.source.earner!;
    const products = await earner.products();
    if (isRefusal(products)) throw new Error(products.message);
    expect(products.find((p) => p.asset === "WETH")).toMatchObject({ priceUsd: 2_400 });
    expect(priced).toContain("WETH");
  });
});

describe("a device let in keeps the label it paired under", () => {
  const homes: string[] = [];
  afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));
  const owner = simKey("device:label-owner");
  const phone = simKey("device:label-phone");

  it("in the state: a waiting device's label becomes its owner label; one that gave none is a device", () => {
    const base = { ...emptyState(), owners: [{ id: `device:${owner.kid}`, kind: "device" as const, label: "first", jwk: owner.jwk, addedAt: "" }], pendingDevices: [{ kid: phone.kid, jwk: phone.jwk, at: "", label: "Safari on this Mac" }, { kid: simKey("device:label-x").kid, jwk: simKey("device:label-x").jwk, at: "" }] };
    const users = [`device:${owner.kid}`, `device:${phone.kid}`, `device:${simKey("device:label-x").kid}`].sort();
    const next = applyOwner(base, { type: "convertToMultiSigUser", signers: JSON.stringify({ authorizedUsers: users, threshold: 1 }), nonce: 1 }, {} as never, NOW);
    if (isRefusal(next)) throw new Error(next.message);
    expect(Object.fromEntries(next.owners.map((o) => [o.id, o.label]))).toEqual({ [`device:${owner.kid}`]: "first", [`device:${phone.kid}`]: "Safari on this Mac", [`device:${simKey("device:label-x").kid}`]: "device" });
  });

  it("through the door, and after a restart: the same label", async () => {
    const home = mkdtempSync(join(tmpdir(), "device-label-"));
    homes.push(home);
    let t = NOW;
    const start = () => PortfolioService.create({ home, now: () => new Date(t).toISOString(), venues: "frontline", real: true, liveDeps: { clock: () => t, http: async () => json({}, 599), price: async () => undefined }, liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" } });
    const svc = await start();
    await svc.restoring;
    const engine = svc.account!;
    expect(engine.pairDevice(owner.jwk, "the first browser", "K7QX-M2PA")).toMatchObject({ role: "owner" });
    expect(engine.pairDevice(phone.jwk, "Safari on this Mac")).toMatchObject({ role: "pending" });
    const action: OwnerAction = { type: "convertToMultiSigUser", signers: JSON.stringify({ authorizedUsers: [`device:${owner.kid}`, `device:${phone.kid}`].sort(), threshold: 1 }), nonce: t + 1 };
    expect(await svc.exchange({ action, nonce: action.nonce, signature: signDevice(owner, action) })).toMatchObject({ ok: true });
    const labels = (s: PortfolioService) => Object.fromEntries(s.account!.state.owners.map((o) => [o.id, o.label]));
    expect(labels(svc)).toEqual({ [`device:${owner.kid}`]: "the first browser", [`device:${phone.kid}`]: "Safari on this Mac" });
    t += 60_000;
    const again = await start();
    await again.restoring;
    expect(labels(again)).toEqual({ [`device:${owner.kid}`]: "the first browser", [`device:${phone.kid}`]: "Safari on this Mac" });
    // an EOA owner is unaffected by any of it
    void signOwner;
  });
});
