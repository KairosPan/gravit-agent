/** THE MARKET'S PUBLIC READS (reads.ts): explore, quotes, candles, book and trades under names without "account", over a fake public
 * source, a fake China and a fake hub — the face's Markets reads, each refusal in the market's own words. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarketCore } from "../../src/core.ts";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { ExchangeClient, OpenExchange } from "../../src/live/exchange.ts";
import { exchangeTickers, kalshiPublic, polymarketPublic, PUBLIC_HOSTS } from "../../src/live/public-markets.ts";
import type { Http } from "../../src/live/types.ts";
import { CHINA_SEARCH_WAIT_MS, historyAsk, marketReads, mountReads, type CandlesView } from "../../src/reads.ts";
import { CHINA_NOTE, chinaSource, type ChinaHistory, type ChinaMarket, type ChinaRead, type ChinaSource, type ChinaStatus } from "../../src/live/china.ts";
import type { CnHttp, CnReply } from "../../src/live/cn-http.ts";
import { historyUrl } from "../../src/live/cn-history.ts";
import { searchUrl } from "../../src/live/cn-search.ts";
import type { ExploreItem } from "../../src/live/explore.ts";
import { INTERVAL_MS, type Candle, type CandleInterval, type CandlePage, type CandleWindow } from "../../src/live/trade.ts";
import { no } from "../../src/refuse.ts";
import { startMarketServer, type MarketServerHandle } from "../../src/server.ts";
import type { Listing, PublicSource } from "../../src/live/public-markets.ts";
import { fakeChina, fakeHub, fakeSource, listing } from "../fakes.ts";

const servers: MarketServerHandle[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function market(o: { sources?: PublicSource[]; china?: boolean } = {}) {
  const core = createMarketCore({ sources: o.sources ?? [fakeSource()], ...(o.china === false ? {} : { china: fakeChina() }), hub: fakeHub().hub });
  const srv = await startMarketServer({ port: 0, mount: (app) => mountReads(app, core, marketReads(core)) });
  servers.push(srv);
  const get = async (path: string) => {
    const r = await fetch(`${srv.url}${path}`);
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  return { get };
}

describe("the market's public reads", () => {
  it("explores the public markets and finds China on a search", async () => {
    const { get } = await market();
    const btc = await get("/api/explore?q=BTC");
    expect(btc.status).toBe(200);
    expect(btc.body.ok).toBe(true);
    const at = (btc.body.items as Array<{ at: Array<{ venue: string; symbol: string; connected: boolean }> }>).flatMap((i) => i.at);
    expect(at).toContainEqual(expect.objectContaining({ venue: "fake", symbol: "BTC/USDT", connected: false }));
    const cn = await get("/api/explore?q=600519");
    expect(cn.body.ok).toBe(true);
    expect(cn.body.items).toContainEqual(expect.objectContaining({ key: "cn:600519", kind: "ashare" }));
    // a tab it does not have, a limit past 200
    const tab = await get("/api/explore?tab=nope");
    expect(tab.status).toBe(409);
    expect(tab.body.refusal.code).toBe("E_MARKET_BAD_REQUEST");
    expect((await get("/api/explore?limit=x")).body).toEqual({ ok: false, error: "limit is a count of markets, 1 to 200, in digits" });
  });

  it("quotes a public pair and an A share", async () => {
    const { get } = await market();
    const r = await get("/api/quotes?pairs=fake|BTC/USDT,china|600519,china|sh600519");
    expect(r.status).toBe(200);
    const [pub, share, letters] = r.body.quotes as Array<Record<string, any>>;
    // a public pair's price is explore's: the market quotes A shares only
    expect(pub).toMatchObject({ venue: "fake", symbol: "BTC/USDT", refusal: { code: "E_VENUE_RAIL_CLOSED" } });
    expect(share).toMatchObject({ venue: "china", symbol: "600519", market: { symbol: "600519", currency: "CNY" } });
    expect(letters).toMatchObject({ venue: "china", symbol: "sh600519", refusal: { code: "E_MARKET_BAD_REQUEST", message: "an A share is its six digits" } });
    expect((await get("/api/quotes?pairs=nobar")).body).toEqual({ ok: false, error: "each market is venue|symbol, e.g. okx|BTC/USDT" });
  });

  it("answers candles, book and trades from the public source", async () => {
    const { get } = await market();
    const c = await get("/api/candles?venue=fake&symbol=BTC/USDT&interval=1h&range=1D");
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ ok: true, venue: "fake", venueName: "Fake Ex", symbol: "BTC/USDT", interval: "1h", range: "1D", public: true });
    expect((c.body.candles as unknown[]).length).toBeGreaterThan(0);
    const b = await get("/api/book?venue=fake&symbol=BTC/USDT&depth=1");
    expect(b.body).toEqual({ ok: true, venue: "fake", venueName: "Fake Ex", symbol: "BTC/USDT", public: true, book: { bids: [[61_999, 1]], asks: [[62_001, 1]], at: expect.any(String), from: "Fake Ex", depth: "full" } });
    const t = await get("/api/trades?venue=fake&symbol=BTC/USDT&limit=1");
    expect(t.body).toMatchObject({ ok: true, venue: "fake", symbol: "BTC/USDT", public: true, trades: [{ price: 62_000, size: 0.1, side: "buy" }] });
    // an A share's history is China's, by range
    const h = await get("/api/candles?venue=china&symbol=600519&interval=1d&range=1M");
    expect(h.body).toMatchObject({ ok: true, venue: "china", symbol: "600519", range: "1M" });
    expect((await get("/api/book?venue=fake&symbol=BTC/USDT&depth=x")).body).toEqual({ ok: false, error: "depth is a count of levels a side, 1 to 50, in digits" });
  });

  it("refuses a venue that is not public", async () => {
    const { get } = await market();
    const r = await get("/api/book?venue=my-okx&symbol=BTC/USDT");
    expect(r.status).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(r.body.refusal).toMatchObject({ code: "E_MARKET_UNKNOWN_SOURCE", venue: "my-okx" });
    expect((await get("/api/trades?venue=my-okx&symbol=BTC/USDT")).body.refusal.code).toBe("E_MARKET_UNKNOWN_SOURCE");
    expect((await get("/api/candles?venue=my-okx&symbol=BTC/USDT&interval=1h")).body.refusal.code).toBe("E_MARKET_UNKNOWN_SOURCE");
  });
});

/** THE MARKET'S SENTENCES (account split plan A2 task 7): each refusal and `none` in the market's words, code and message exactly */
describe("the market's refusals say nothing of an account", () => {
  it("a source that is not public, for candles, book and trades: E_MARKET_UNKNOWN_SOURCE", async () => {
    const { get } = await market();
    const want = { code: "E_MARKET_UNKNOWN_SOURCE", message: '"my-okx" is not a public market source: Markets names each source by its id' };
    expect((await get("/api/candles?venue=my-okx&symbol=BTC/USDT&interval=1h&range=1D")).body.refusal).toMatchObject(want);
    expect((await get("/api/book?venue=my-okx&symbol=BTC/USDT")).body.refusal).toMatchObject(want);
    expect((await get("/api/trades?venue=my-okx&symbol=BTC/USDT")).body.refusal).toMatchObject(want);
  });

  it("a pair that is not China's, in quotes: E_VENUE_RAIL_CLOSED, priced in explore", async () => {
    const { get } = await market();
    const [pub] = (await get("/api/quotes?pairs=fake|BTC/USDT")).body.quotes as Array<Record<string, any>>;
    expect(pub!.refusal).toMatchObject({ code: "E_VENUE_RAIL_CLOSED", venue: "fake", message: '"fake" is priced in explore: the market quotes A shares only (venue "china")' });
  });

  it("China not read: its sentence unchanged, its code the market's", async () => {
    const { get } = await market({ china: false });
    const [cn] = (await get("/api/quotes?pairs=china|600519")).body.quotes as Array<Record<string, any>>;
    expect(cn!.refusal).toMatchObject({ code: "E_MARKET_BAD_REQUEST", message: "China is not read by this market" });
    expect((await get("/api/explore?tab=china")).body.refusal).toMatchObject({ code: "E_MARKET_BAD_REQUEST", message: "China is not read by this market" });
    expect((await get("/api/candles?venue=china&symbol=600519&range=1M")).body.refusal).toMatchObject({ code: "E_MARKET_BAD_REQUEST", message: "China is not read by this market" });
  });

  it("a book the market does not read, with no best bid or ask: its sentence unchanged", async () => {
    const { book: _b, trades: _t, ...rest } = fakeSource({ id: "tokens" });
    const bare: PublicSource = { ...rest, name: "Tokens", kind: "tokens", listings: async () => [{ ...listing("TSLAX", 400), bid: undefined, ask: undefined } as unknown as Listing] };
    const { get } = await market({ sources: [bare] });
    expect((await get("/api/book?venue=tokens&symbol=TSLAX")).body.refusal).toMatchObject({ code: "E_VENUE_RAIL_CLOSED", message: "The market reads no order book from Tokens, and it gives no best bid or ask for TSLAX just now" });
  });

  it("a source that publishes no trades: `none` in the market's words", async () => {
    const { trades: _t, ...rest } = fakeSource({ id: "tokens" });
    const bare: PublicSource = { ...rest, name: "Tokens" };
    const { get } = await market({ sources: [bare] });
    expect((await get("/api/trades?venue=tokens&symbol=BTC/USDT")).body).toMatchObject({ ok: true, trades: [], none: "Tokens publishes no trades the market can read" });
  });
});

/** THE VENUE AND THE SYMBOL OF A PRICE HISTORY NEVER REACH A HOST THEY NAME (moved from the account's test/attack/ask-candles-earn-holes.test.ts,
 * account split plan A2 task 7, where the account's public candles were): a venue is a source's id, a symbol plain text that a public source
 * only puts, encoded, in a fixed host's path or query — or refuses. Over a recording network and exchange library: nothing leaves the
 * process. */
describe("candles: the venue and the symbol never reach a host they name", () => {
  const START = Date.parse("2026-10-06T10:00:00.000Z");
  const HOUR = 3_600_000;
  const asked: string[] = [];
  const recordingHttp: Http = async (url) => {
    asked.push(url);
    return { status: 404, body: { error: "not here" }, text: "not here" };
  };
  const handed: string[] = [];
  const library: OpenExchange = async () =>
    ({
      id: "kraken",
      markets: { "BTC/USD": { symbol: "BTC/USD", base: "BTC", quote: "USD", spot: true } },
      loadMarkets: async () => ({}),
      fetchBalance: async () => ({}),
      fetchOHLCV: async (symbol: string) => (handed.push(symbol), [[START - HOUR, 1, 1, 1, 1, 1]]),
    }) as unknown as ExchangeClient;
  const refusal = (r: unknown): Refusal => {
    if (!isRefusal(r)) throw new Error(`expected a refusal, got ${JSON.stringify(r).slice(0, 200)}`);
    return r;
  };
  const reads = () => {
    const t = START;
    const core = createMarketCore({ sources: [exchangeTickers("kraken", { open: library, http: recordingHttp, clock: () => t, pace: async () => undefined }), kalshiPublic({ http: recordingHttp, clock: () => t }), polymarketPublic({ http: recordingHttp, clock: () => t })], clock: () => t });
    return { core, reads: marketReads(core) };
  };

  it("a venue is a source's id; a symbol is plain text — anything else is refused before anything is asked", async () => {
    const { reads: r } = reads();
    asked.length = 0;
    for (const venue of ["http://169.254.169.254/latest", "../etc/passwd", "EX", "ex/../kalshi", "", "kraken@evil.com", "a".repeat(61)]) expect(refusal(await r.candles(venue, "BTC/USD", "1h", {})).code, venue).toBe("E_MARKET_BAD_REQUEST");
    for (const symbol of ["BTC/USD\nHost: evil.com", "BTC\u0000", "BTC\u202e", "x".repeat(161), ""]) expect(refusal(await r.candles("kraken", symbol, "1h", {})).code, JSON.stringify(symbol)).toBe("E_MARKET_BAD_REQUEST");
    expect(refusal(await r.candles("kraken", "BTC/USD", "1h&x=1", {})).code).toBe("E_MARKET_BAD_REQUEST");
    expect(asked).toEqual([]);
  });

  it("a public source puts a symbol only in its fixed host's path or query, encoded — or refuses it without asking", async () => {
    const { reads: r } = reads();
    asked.length = 0;
    handed.length = 0;
    // Kalshi's ticker and Polymarket's slug are read by pattern, by the sources themselves (their own code): refused, nothing asked
    for (const symbol of ["A@evil.com/x:YES", "KX/../..:YES", "https://evil.com:YES"]) expect(refusal(await r.candles("kalshi", symbol, "1h", {})).code).toBe("E_ACCOUNT_BAD_ACTION");
    for (const symbol of ["x/../../evil:Yes", "UPPER:Yes", "@evil.com:Yes"]) expect(refusal(await r.candles("polymarket", symbol, "1h", {})).code).toBe("E_ACCOUNT_BAD_ACTION");
    expect(asked).toEqual([]);
    // what is asked goes to the source's own host, the symbol in it encoded
    await r.candles("polymarket", "http:Yes?x=1&y=#frag", "1h", {});
    await r.candles("kalshi", "KX-ONE.T4:NO", "5m", {});
    expect(asked.length).toBe(2);
    for (const u of asked) {
      const url = new URL(u);
      expect([url.protocol, PUBLIC_HOSTS.includes(url.hostname), url.port, url.username]).toEqual(["https:", true, "", ""]);
    }
    expect(asked[0]).toBe("https://gamma-api.polymarket.com/markets/slug/http");
    // the exchange library is handed only a pair the exchange lists; the venue with deep history a Kraken pair is charted from (Coinbase
    // Exchange, for a dollar pair) is asked at its fixed host, the product in its path — first whether it trades that product now; where it
    // lists none, Kraken's own latest bars, and its candles are never asked
    asked.length = 0;
    expect(refusal(await r.candles("kraken", "BTC/USD@evil.com", "1h", {})).code).toBe("E_VENUE_REJECTED");
    expect(asked).toEqual([]);
    expect((await r.candles("kraken", "BTC/USD", "1h", {})) as { candles: unknown[] }).toMatchObject({ venue: "kraken", public: true, source: "Kraken · BTC/USD" });
    expect(asked.map((u) => new URL(u)).map((u) => [u.protocol, u.host, u.pathname])).toEqual([["https:", "api.exchange.coinbase.com", "/products/BTC-USD"]]);
    expect(handed).toEqual(["BTC/USD"]);
  });

  it("over HTTP too: a venue naming a host is a 409, and nothing is asked", async () => {
    const { core, reads: r } = reads();
    const srv = await startMarketServer({ port: 0, mount: (app) => mountReads(app, core, r) });
    servers.push(srv);
    asked.length = 0;
    const res = await fetch(`${srv.url}/api/candles?venue=${encodeURIComponent("http://169.254.169.254")}&symbol=${encodeURIComponent("BTC/USD")}&interval=1h`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { refusal: Refusal }).refusal.code).toBe("E_MARKET_BAD_REQUEST");
    expect(asked).toEqual([]);
  });
});

/** ONE MARKET'S PRICE HISTORY AS THE MARKET ASKS IT (reads.ts candles; moved from the account's test/unit/account-candles-range.test.ts,
 * account split plan A2 task 7, where the account's public candles were): a range's first view in its own bar size, the page before a bar a
 * chart has, the window handed to the source, the answer held to it with the source's own words, and the memory that absorbs the same ask
 * repeated — keyed by the window, bounded, and never asking a source that said it cannot be asked just now. A stand-in public source
 * records every window it is asked; nothing leaves the process. */
describe("a public market's price history: windows and memory", () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const NOW = Date.parse("2026-10-17T07:03:30Z");
  const view = (r: CandlesView | ChinaHistory | Refusal): CandlesView => {
    if (isRefusal(r)) throw new Error(`refused: ${r.code} ${r.message}`);
    if (!("interval" in r)) throw new Error("an A share's history, not a market's bars");
    return r;
  };
  const refusal = (r: unknown): Refusal => {
    if (!isRefusal(r)) throw new Error(`expected a refusal, got ${JSON.stringify(r).slice(0, 160)}`);
    return r;
  };
  /** a public source that answers every window with the bars of its interval inside it (the latest `limit`), says older bars exist, names
   * itself, and records what it was asked; `refuse` answers a refusal instead */
  function source(o: { refuse?: () => Refusal | undefined; from?: string } = {}) {
    const asked: Array<{ symbol: string; interval: CandleInterval; w: CandleWindow }> = [];
    const btc: Listing = { symbol: "BTC/USD", name: "BTC market", kind: "spot", base: "BTC", quote: "USD", price: 81_500, open: true, types: [] };
    const s: PublicSource = {
      id: "pubx",
      name: "Pubx",
      kind: "exchange",
      connectTo: "pubx",
      connector: "live:exchange:pubx",
      listings: async () => [btc],
      candles: async (symbol, interval, w): Promise<CandlePage | Refusal> => {
        asked.push({ symbol, interval, w });
        const r = o.refuse?.();
        if (r) return r;
        const g = INTERVAL_MS[interval];
        const until = w.until ?? NOW + 1;
        const limit = w.limit ?? 300;
        const since = w.since ?? until - limit * g;
        const bars: Candle[] = [];
        for (let t = Math.floor((until - 1) / g) * g; t >= since && bars.length < limit; t -= g) bars.unshift({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 3 });
        // one bar before the window, which the service must not pass on
        bars.unshift({ t: since - 7 * g, o: 9, h: 9, l: 9, c: 9 });
        return { bars, more: true, source: o.from ?? "Pubx · BTC-USD", folded: interval === "4h" ? "4-hour bars folded from Pubx's hourly bars" : undefined };
      },
    };
    return { s, asked };
  }
  const service = (src: PublicSource) => marketReads(createMarketCore({ sources: [src], clock: () => NOW }));

  describe("a range's first view, and the page before a bar", () => {
    it("a range in its own bar size: its start on the calendar, the latest 5,000 bars at most, the range said to the source; the answer held to the window, with the source's words", async () => {
      const src = source();
      const svc = service(src.s);
      const v = view(await svc.candles("pubx", "BTC/USD", "", { range: "5D" }));
      expect(src.asked).toEqual([{ symbol: "BTC/USD", interval: "5m", w: { since: NOW - 5 * DAY, limit: 5_000, range: "5D" } }]);
      expect([v.interval, v.range, v.before, v.more, v.source, v.public]).toEqual(["5m", "5D", undefined, true, "Pubx · BTC-USD", true]);
      // the bar from before the window is not passed on
      expect(v.candles.every((b) => b.t >= NOW - 5 * DAY)).toBe(true);
      expect(v.candles).toHaveLength(1_440);
      // a bar size named with the range: that size; 4h's words carried
      const four = view(await svc.candles("pubx", "BTC/USD", "4h", { range: "3M" }));
      expect([four.interval, four.range, four.folded]).toEqual(["4h", "3M", "4-hour bars folded from Pubx's hourly bars"]);
      // neither a range nor a page: the size's own range (5m: a day)
      const day = view(await svc.candles("pubx", "BTC/USD", "5m", {}));
      expect([day.range, src.asked.at(-1)!.w]).toEqual(["1D", { since: NOW - DAY, limit: 5_000, range: "1D" }]);
    });
  
    it("the page before a bar: one window that ends there, three hundred bars unless asked otherwise, a thousand at most", async () => {
      const src = source();
      const svc = service(src.s);
      const before = NOW - 3 * DAY;
      const v = view(await svc.candles("pubx", "BTC/USD", "1h", { before: String(before), limit: "48" }));
      expect(src.asked.at(-1)!.w).toEqual({ until: before, limit: 48 });
      expect([v.before, v.range, v.candles.length, v.candles.every((b) => b.t < before), v.more]).toEqual([before, undefined, 48, true, true]);
      await svc.candles("pubx", "BTC/USD", "1h", { before });
      expect(src.asked.at(-1)!.w).toEqual({ until: before, limit: 300 });
    });
  
    it("whose bars they are: an exchange's chart drawn from another venue (a Kraken pair's from Coinbase Exchange) names that venue, so the chart's name and the page's source never disagree; its own bars name nothing more", async () => {
      const other = view(await (service(source({ from: "Coinbase Exchange · BTC-USD" }).s)).candles("pubx", "BTC/USD", "", { range: "1D" }));
      expect([other.venueName, other.from, other.source]).toEqual(["Pubx", "Coinbase Exchange", "Coinbase Exchange · BTC-USD"]);
      const own = view(await (service(source().s)).candles("pubx", "BTC/USD", "", { range: "1D" }));
      expect([own.venueName, own.from]).toEqual(["Pubx", undefined]);
    });
  
    it("refuses what cannot be asked, in words, before any source is", async () => {
      const src = source();
      const svc = service(src.s);
      expect(refusal(await svc.candles("pubx", "BTC/USD", "2h", {})).message).toBe("price history is by 1m, 5m, 15m, 1h, 4h, 1d, 1w");
      expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "10Y" })).message).toBe("a range is one of 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX");
      expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "1M", before: "1" })).message).toBe("price history is asked for a range or for the page before a bar, not both");
      expect(refusal(await svc.candles("pubx", "BTC/USD", "1h", { before: "-5" })).message).toBe("a page of price history is asked before a bar's start, in milliseconds");
      expect(refusal(await svc.candles("pubx", "BTC/USD", "1h", { range: "1M", limit: "5001" })).message).toBe("a view of price history holds 1 to 5,000 bars");
      expect(src.asked).toEqual([]);
      expect(historyAsk("", { range: "ytd" })).toEqual({ iv: "1d", range: "YTD", limit: 5_000 });
    });
  });
  
  describe("the memory: the same ask once, keyed by its window, bounded", () => {
    it("the same range asked again is answered from memory; another range, another size or a page is asked of the source", async () => {
      const src = source();
      const svc = service(src.s);
      await svc.candles("pubx", "BTC/USD", "", { range: "1M" });
      await svc.candles("pubx", "BTC/USD", "1h", { range: "1M" });
      expect(src.asked).toHaveLength(1);
      await svc.candles("pubx", "BTC/USD", "", { range: "3M" });
      await svc.candles("pubx", "BTC/USD", "15m", { range: "1M" });
      await svc.candles("pubx", "BTC/USD", "1h", { before: NOW - 30 * DAY });
      await svc.candles("pubx", "BTC/USD", "1h", { before: NOW - 30 * DAY });
      await svc.candles("pubx", "BTC/USD", "1h", { before: NOW - 31 * DAY });
      expect(src.asked.map((a) => `${a.interval} ${a.w.range ?? a.w.until}`)).toEqual(["1h 1M", "4h 3M", "15m 1M", `1h ${NOW - 30 * DAY}`, `1h ${NOW - 31 * DAY}`]);
    });
  
    it("at most 64 answers: the page used longest ago is let go, and asked again when it is asked again", async () => {
      const src = source();
      const svc = service(src.s);
      for (let i = 0; i < 70; i++) await svc.candles("pubx", "BTC/USD", "1h", { before: NOW - (i + 1) * DAY, limit: 10 });
      expect(src.asked).toHaveLength(70);
      // the latest is still kept, the first is not
      await svc.candles("pubx", "BTC/USD", "1h", { before: NOW - 70 * DAY, limit: 10 });
      expect(src.asked).toHaveLength(70);
      await svc.candles("pubx", "BTC/USD", "1h", { before: NOW - DAY, limit: 10 });
      expect(src.asked).toHaveLength(71);
    });
  
    it("a refusal is not kept, and one that says the source cannot be asked just now (its place rule) holds every history ask of it back", async () => {
      let answer: Refusal | undefined = no("E_VENUE_UNREACHABLE", { venue: "pubx", message: "Pubx refused the request (HTTP 400)" });
      answer = { ...answer, code: "E_VENUE_REJECTED" };
      const src = source({ refuse: () => answer });
      const svc = service(src.s);
      expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "1M" })).message).toBe("Pubx refused the request (HTTP 400)");
      expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "1M" })).message).toBe("Pubx refused the request (HTTP 400)");
      expect(src.asked).toHaveLength(2);
      answer = no("E_VENUE_GEOBLOCKED", { venue: "pubx", message: "Pubx does not serve this location: that is its own rule, and the market does not look for a way around it" });
      expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "5D" })).code).toBe("E_VENUE_GEOBLOCKED");
      expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "1Y" })).code).toBe("E_VENUE_GEOBLOCKED");
      expect(src.asked).toHaveLength(3);
    });
  });
});

/** CHINA IN THE MARKET'S READS (moved from the account's test/unit/account-china.test.ts, account split plan A2 task 7, where the account's
 * China tab, search, quotes and history were): the China tab, China's hits in a search, an A share's quotes and history, through the
 * market's reads as the face's proxy and market:mcp reach them. A recording stand-in ChinaSource for the reads' own rules, and the real
 * chinaSource over a stand-in CnHttp where what is pinned is Tencent's own answer passing through (a Beijing Saturday, a search typed in
 * Chinese or as a STAR code). Nothing leaves the process. */
describe("China in the market's reads", () => {
  afterEach(() => vi.useRealTimers());
  const answered = <T,>(v: T | Refusal): T => { if (isRefusal(v)) throw new Error(`refused: ${v.code} ${v.message}`); return v; };
  const refused = (v: unknown): Refusal => { if (!isRefusal(v)) throw new Error(`answered: ${JSON.stringify(v).slice(0, 160)}`); return v; };

  /** the market's reads on stand-ins, with no public source, and China as given */
    async function account(o: { china?: ChinaSource; clock?: () => number } = {}) {
      const clock = o.clock ?? (() => Date.parse("2026-11-02T02:40:00Z"));
      return marketReads(createMarketCore({ sources: [], clock, ...(o.china ? { china: o.china } : {}) }));
    }

    // ---- the recording stand-in ---------------------------------------------------------------------------------------------------------
  const cnRow = (symbol: string, name: string, price: number): ExploreItem => ({
    key: `cn:${symbol}`, kind: "ashare", name, base: symbol, currency: "CNY", price, quoteFrom: "Tencent", tabs: ["china"],
    at: [{ venue: "china", venueName: "Tencent", symbol, connected: false, canTrade: false, public: true, price, quoteFrom: "Tencent" }],
  });
  const LIVE: ChinaStatus = { state: "live", said: "Tencent · answering", at: "2026-11-02T02:40:00.000Z" };
  const readOf = (sort: "volume" | "movers"): ChinaRead => ({ sort, total: 5577, asOf: "2026-11-02T02:40:00.000Z", session: { phase: "trading", lastSession: "2026-11-02" } as ChinaRead["session"], status: LIVE });
  const marketOf = (symbol: string): ChinaMarket => ({ symbol, name: symbol, kind: "stock", base: symbol, quote: "CNY", currency: "CNY", open: false, types: [], price: 10, quoteFrom: "Tencent" } as unknown as ChinaMarket);

  function stub(o: { rank?: ChinaSource["rank"]; search?: ChinaSource["search"]; quotes?: ChinaSource["quotes"]; history?: ChinaSource["history"] } = {}) {
    const calls = { rank: [] as string[], search: [] as string[], quotes: [] as string[][], history: [] as Array<[string, string]> };
    const rows = Array.from({ length: 25 }, (_, i) => cnRow(String(600000 + i), `A${i}`, 10 + i));
    const source: ChinaSource = {
      async rank(sort) { calls.rank.push(sort); return o.rank ? o.rank(sort) : { items: rows, read: readOf(sort) }; },
      async search(q) { calls.search.push(q); return o.search ? o.search(q) : [cnRow("600519", "贵州茅台", 1392.05)]; },
      async quotes(symbols) { calls.quotes.push([...symbols]); return o.quotes ? o.quotes(symbols) : new Map(symbols.filter((s) => s !== "000002").map((s) => [s, marketOf(s)])); },
      async history(symbol, range) { calls.history.push([symbol, range]); return o.history ? o.history(symbol, range) : no("E_VENUE_UNREACHABLE", { venue: "china", message: "x" }); },
      status: () => LIVE,
    };
    return { source, calls };
  }

  // ---- Tencent's replies, for the real source (china.test.ts has the measured ones these are cut from) -----------------------------------
  type Route = [string, CnReply | ((url: string) => CnReply)];
  function net(routes: Route[]) {
    const sent: string[] = [];
    const http: CnHttp = async (url) => {
      sent.push(url);
      const hit = routes.find(([k]) => url.includes(k));
      if (!hit) return { status: 404, bytes: new Uint8Array() };
      return typeof hit[1] === "function" ? hit[1](url) : hit[1];
    };
    return { http, sent };
  }
  const bytes = (...parts: Array<string | number[]>): CnReply => ({ status: 200, bytes: new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p as string)))) });
  const down: CnReply = { status: 503, bytes: new Uint8Array() };
  /** 贵州茅台 in GBK (and GB18030) */
  const MOUTAI_GBK = [0xb9, 0xf3, 0xd6, 0xdd, 0xc3, 0xa9, 0xcc, 0xa8];
  // the session reply measured 2026-10-31 (a Saturday): every board closed, the index's last time Friday's
  const CLOSED = 'v_marketStat="2026-10-31 14:46:10|HK_close_已休市|SH_close_已休市|SZ_close_已休市|KCB_close_已休市|CYB_close_已休市";\n'
    + 'v_sh000001="1~上证指数~000001~3599.02~3651.43~' + "~".repeat(25) + '20261030161400~-52.41";\n';
  const row = (code: string, name: string, zxj: string, zdf: string, turnover: string) =>
    ({ code, name, zxj, zdf, turnover, volume: "1", hsl: "1", pe_ttm: "1", zsz: "1", ltsz: "1", zf: "1", lb: "1", state: "", stock_type: "GP-A" });
  const VOLUME = JSON.stringify({ code: 0, msg: "ok", data: { rank_list: [row("sh600519", "贵州茅台", "1392.05", "2.81", "2161000"), row("sh688981", "中芯国际", "98.60", "-0.40", "295750")], offset: 0, total: 5577 } });
  const days = (dates: string[]) => JSON.stringify({ code: 0, data: { sh600519: { data: dates.map((date) => ({ date, prec: "1354.00", data: ["0930 1363.00 100 136300.00"] })) } } });
  /** Friday 2026-10-30 22:30 in New York: Saturday 10:30 in Beijing */
  const NY_FRIDAY_EVENING = Date.parse("2026-10-30T22:30:00-04:00");

  describe("China in the market's Markets", () => {
    it("explore tab=china answers the source's ranking with its read, its count and its note", async () => {
      const s = stub();
      const svc = await account({ china: s.source });
      const answer = answered(await svc.explore({ tab: "china", sort: "movers" }));
      expect(s.calls.rank).toEqual(["movers"]);
      expect(answer.tabs).toEqual([{ id: "china", label: "China", count: 5577 }]);
      expect(answer.china).toMatchObject({ sort: "movers", total: 5577, status: { state: "live" } });
      expect(answer.notes).toEqual([CHINA_NOTE]);
      expect([answer.movers, answer.closing, answer.mostTraded, answer.missing]).toEqual([[], [], [], []]);
      // twenty rows at most, whatever the limit; volume when no sort is named
      expect(answer.items).toHaveLength(20);
      expect(answer.items.every((i) => i.key.startsWith("cn:") && i.currency === "CNY" && i.at.every((a) => a.canTrade === false && !("connectTo" in a)))).toBe(true);
      const volume = answered(await svc.explore({ tab: "china", limit: 200 }));
      expect([s.calls.rank.at(-1), volume.china?.sort, volume.items.length]).toEqual(["volume", "volume", 20]);
      expect(answered(await svc.explore({ tab: "china", limit: 5 })).items).toHaveLength(5);
      // never kept here: the source keeps its own reads
      await svc.explore({ tab: "china", sort: "movers" });
      expect(s.calls.rank.filter((x) => x === "movers")).toHaveLength(2);
    });

    it("explore tab=china refuses closing; a source refusal is the answer; a search on it is China's alone", async () => {
      const down = no("E_VENUE_UNREACHABLE", { venue: "china", message: "Tencent is not answering: A shares cannot be read now" });
      const s = stub({ rank: async () => down });
      const svc = await account({ china: s.source });
      expect(refused(await svc.explore({ tab: "china", sort: "closing" }))).toMatchObject({ code: "E_MARKET_BAD_REQUEST", message: "China is sorted by volume or movers" });
      expect(s.calls.rank).toEqual([]);
      expect(refused(await svc.explore({ tab: "china" }))).toEqual(down);
      const found = answered(await svc.explore({ tab: "china", q: "茅台" }));
      expect(s.calls.search).toEqual(["茅台"]);
      expect(found.items.map((i) => i.key)).toEqual(["cn:600519"]);
      expect(found.china).toBeUndefined();
    });

    it("All and every dollar tab never hold an A share, nor ask China", async () => {
      const s = stub();
      const svc = await account({ china: s.source });
      for (const tab of [undefined, "all", "stocks", "crypto", "predictions"]) {
        const x = answered(await svc.explore(tab ? { tab } : {}));
        expect(x.items.some((i) => i.key.startsWith("cn:"))).toBe(false);
        expect(x.tabs.some((t) => t.id === "china")).toBe(false);
        expect(x.china).toBeUndefined();
      }
      // a search on a dollar tab asks no China either
      answered(await svc.explore({ tab: "stocks", q: "AAPL" }));
      expect([s.calls.rank, s.calls.search]).toEqual([[], []]);
    });

    it("a search merges China's hits after the dollar rows", async () => {
      const s = stub();
      const svc = await account({ china: s.source });
      const x = answered(await svc.explore({ q: "maotai" }));
      expect(s.calls.search).toEqual(["maotai"]);
      expect(x.items.map((i) => i.key)).toEqual(["cn:600519"]);
      expect(x.missing).toEqual([]);
      // the limit holds over both halves
      const many = stub({ search: async () => Array.from({ length: 30 }, (_, i) => cnRow(String(600100 + i), `B${i}`, 1)) });
      expect(answered(await (await account({ china: many.source })).explore({ q: "b", limit: 7 })).items).toHaveLength(7);
    });

    it("a search whose China half is late answers without it and says so in missing; a refused one too", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const s = stub({ search: () => new Promise<never>(() => {}) });
      const svc = await account({ china: s.source });
      const asked = svc.explore({ q: "茅台" });
      await vi.advanceTimersByTimeAsync(CHINA_SEARCH_WAIT_MS + 10);
      const x = answered(await asked);
      expect(x.items.some((i) => i.key.startsWith("cn:"))).toBe(false);
      expect(x.missing).toEqual([expect.objectContaining({ venue: "china", venueName: "Tencent", connected: false, why: "Tencent did not answer in 4 seconds" })]);
      vi.useRealTimers();

      const r = stub({ search: async () => no("E_VENUE_UNREACHABLE", { venue: "china", message: "Tencent's search did not answer" }) });
      const y = answered(await (await account({ china: r.source })).explore({ q: "茅台" }));
      expect(y.missing).toEqual([expect.objectContaining({ venue: "china", venueName: "Tencent", connected: false, why: "Tencent's search did not answer" })]);
    });

    it("a search in Chinese reaches the source as typed", async () => {
      const s = stub();
      await (await account({ china: s.source })).explore({ q: "茅台" });
      expect(s.calls.search).toEqual(["茅台"]);
    });

    it("a search in Chinese or as a STAR code goes to Tencent encoded and comes back decoded from GB18030, STAR listings kept", async () => {
      const hint = bytes('v_hint="sh~600519~', MOUTAI_GBK, '~gzmt~GP-A";');
      const star = bytes('v_hint="sh~688981~\\u4e2d\\u82af\\u56fd\\u9645~zxgj~GP-A-KCB^hk~00981~\\u4e2d\\u82af\\u56fd\\u9645~zxgj~GP";');
      const v = net([["smartbox", (url) => (url.includes("688981") ? star : hint)], ["qt.gtimg.cn", down]]);
      const clock = () => NY_FRIDAY_EVENING;
      const svc = await account({ china: chinaSource({ http: v.http, clock }), clock });
      const moutai = answered(await svc.explore({ q: "茅台" }));
      expect(v.sent[0]).toBe(searchUrl("茅台"));
      expect(v.sent[0]).toContain("q=%E8%8C%85%E5%8F%B0");
      expect(moutai.items.map((i) => [i.key, i.name])).toEqual([["cn:600519", "贵州茅台"]]);
      const smic = answered(await svc.explore({ tab: "china", q: "688981" }));
      expect(smic.items.map((i) => [i.key, i.name])).toEqual([["cn:688981", "中芯国际"]]);
    });

    it("a failed quote read made to price a search leaves China's status as its ranking left it", async () => {
      let quotesUp = true;
      const hint = bytes('v_hint="sh~600519~', MOUTAI_GBK, '~gzmt~GP-A";');
      // the session read (marketStat alone) answers; a read that prices 600519 fails while quotesUp is false
      const v = net([["sort_type=turnover", bytes(VOLUME)], ["smartbox", hint], ["qt.gtimg.cn", (url) => (url.includes("sh600519") && !quotesUp ? down : bytes(CLOSED))]]);
      const clock = () => NY_FRIDAY_EVENING;
      const china = chinaSource({ http: v.http, clock });
      const svc = await account({ china, clock });
      expect(answered(await svc.explore({ tab: "china" })).china?.status.state).toBe("live");
      quotesUp = false;
      const found = answered(await svc.explore({ q: "茅台" }));
      expect(found.items.map((i) => [i.key, i.price])).toEqual([["cn:600519", undefined]]);
      expect(china.status().state).toBe("live");
      expect(answered(await svc.explore({ tab: "china" })).china?.status.state).toBe("live");
      // a quote read asked for itself still says what it met
      const q = answered(await svc.quotes([{ venue: "china", symbol: "600519" }]));
      expect(q[0]!.refusal?.code).toBe("E_VENUE_UNREACHABLE");
      expect(china.status().state).toBe("unavailable");
    });

    it("explore tab=china on a Beijing Saturday read on New York's Friday evening: the session closed, Tencent answering, never stale", async () => {
      const v = net([["sort_type=turnover", bytes(VOLUME)], ["qt.gtimg.cn", bytes(CLOSED)]]);
      const clock = () => NY_FRIDAY_EVENING;
      const svc = await account({ china: chinaSource({ http: v.http, clock }), clock });
      const x = answered(await svc.explore({ tab: "china" }));
      expect(x.china).toMatchObject({ session: { phase: "closed", lastSession: "2026-10-30" }, status: { state: "live" } });
      expect(x.items.map((i) => i.key)).toEqual(["cn:600519", "cn:688981"]);
    });
  });

  describe("China's quotes and history in the market", () => {
    it("quotes: China's pairs go to the source in one call, the others refused by name", async () => {
      const s = stub();
      const svc = await account({ china: s.source });
      const got = answered(await svc.quotes([{ venue: "china", symbol: "600519" }, { venue: "nowhere", symbol: "BTC/USDT" }, { venue: "china", symbol: "688981" }, { venue: "china", symbol: "60051" }, { venue: "china", symbol: "000002" }]));
      expect(s.calls.quotes).toEqual([["600519", "688981", "000002"]]);
      expect(got.map((r) => [r.venue, r.symbol, r.market ? "market" : r.refusal!.message])).toEqual([
        ["china", "600519", "market"],
        ["nowhere", "BTC/USDT", '"nowhere" is priced in explore: the market quotes A shares only (venue "china")'],
        ["china", "688981", "market"],
        ["china", "60051", "an A share is its six digits"],
        ["china", "000002", "no A-share quote for 000002"],
      ]);
      expect((got[0]!.market as ChinaMarket).currency).toBe("CNY");
      // the source's refusal is each China pair's
      const refusing = stub({ quotes: async () => no("E_VENUE_UNREACHABLE", { venue: "china", message: "Tencent is not answering: A shares cannot be read now" }) });
      const r = answered(await (await account({ china: refusing.source })).quotes([{ venue: "china", symbol: "600519" }]));
      expect(r[0]!.refusal).toMatchObject({ code: "E_VENUE_UNREACHABLE", message: "Tencent is not answering: A shares cannot be read now" });
      // the twelve-pair limit stands
      expect(refused(await svc.quotes(Array.from({ length: 13 }, (_, i) => ({ venue: "china", symbol: String(600000 + i) })))).code).toBe("E_MARKET_BAD_REQUEST");
    });

    it("candles venue china: by range, never by before; Tencent's last session on a Beijing Saturday", async () => {
      const history: ChinaHistory = { venue: "china", venueName: "Tencent", symbol: "600519", range: "1D", sessions: [{ date: "2026-10-30", prec: 1354, price: [1363], amount: [136300] }], source: "Tencent" };
      const s = stub({ history: async () => history });
      const svc = await account({ china: s.source, clock: () => NY_FRIDAY_EVENING });
      expect(answered(await svc.candles("china", "600519", "5m", { range: "1D" }))).toEqual(history);
      expect(s.calls.history).toEqual([["600519", "1D"]]);
      expect(refused(await svc.candles("china", "600519", "1h", { before: String(NY_FRIDAY_EVENING) }))).toMatchObject({ code: "E_MARKET_BAD_REQUEST", message: "an A share's history is read by range" });
      expect(refused(await svc.candles("china", "600519", "1h", {}))).toMatchObject({ code: "E_MARKET_BAD_REQUEST", message: "a range is one of 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX" });
      expect(refused(await svc.candles("china", "600519", "", { range: "10Y" })).code).toBe("E_MARKET_BAD_REQUEST");
      expect(s.calls.history).toHaveLength(1);
    });

    it("1D and 5D on a Beijing Saturday read on New York's Friday evening are Tencent's last sessions, not New York's window", async () => {
      // Tencent's reply: newest first, Friday's on top, and a sixth day the 5D read leaves out
      const v = net([["day/query", bytes(days(["20261030", "20261029", "20261028", "20261027", "20261026", "20261023"]))]]);
      const clock = () => NY_FRIDAY_EVENING;
      const svc = await account({ china: chinaSource({ http: v.http, clock }), clock });
      const one = answered(await svc.candles("china", "600519", "", { range: "1D" }));
      expect(v.sent).toEqual([historyUrl("sh600519", "1D")]);
      expect("sessions" in one && one.sessions.map((d) => d.date)).toEqual(["2026-10-30"]);
      const five = answered(await svc.candles("china", "600519", "", { range: "5D" }));
      expect("sessions" in five && five.sessions.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
      // 1D and 5D are one read of Tencent's, kept: nothing else asked
      expect(v.sent).toHaveLength(1);
    });

    it("without a China source, China refuses in its own words and nothing asks Tencent", async () => {
      const svc = await account();
      const said = { code: "E_MARKET_BAD_REQUEST", message: "China is not read by this market" };
      expect(refused(await svc.explore({ tab: "china" }))).toMatchObject(said);
      expect(refused(await svc.candles("china", "600519", "", { range: "1D" }))).toMatchObject(said);
      expect(answered(await svc.quotes([{ venue: "china", symbol: "600519" }]))[0]!.refusal).toMatchObject(said);
      // a search on All answers without China, and says nothing missing of it
      const x = answered(await svc.explore({ q: "茅台" }));
      expect(x.items).toEqual([]);
      expect(x.missing.some((m) => m.venue === "china")).toBe(false);
    });
  });

  describe("China over the market's HTTP", () => {
    it("explore, quotes and candles answer China's shapes; a refusal is a 409", async () => {
      const history: ChinaHistory = { venue: "china", venueName: "Tencent", symbol: "600519", range: "5D", sessions: [], source: "Tencent" };
      const s = stub({ history: async () => history });
      const reads = await account({ china: s.source });
      const server = await startMarketServer({ port: 0, mount: (app) => mountReads(app, createMarketCore({ sources: [] }), reads) });
      try {
        const get = async (path: string) => { const r = await fetch(`${server.url}${path}`); return { status: r.status, body: (await r.json()) as Record<string, any> }; };
        const tab = await get("/api/explore?tab=china&sort=movers&limit=20");
        expect([tab.status, tab.body.ok, tab.body.tabs, tab.body.items.length, tab.body.china.sort]).toEqual([200, true, [{ id: "china", label: "China", count: 5577 }], 20, "movers"]);
        expect((await get("/api/explore?tab=china&sort=closing")).status).toBe(409);
        const q = await get("/api/quotes?pairs=china|600519,china|abc");
        expect(q.body.quotes.map((r: { market?: unknown; refusal?: { message: string } }) => r.market ? "market" : r.refusal!.message)).toEqual(["market", "an A share is its six digits"]);
        expect((await get("/api/candles?venue=china&symbol=600519&range=5D")).body).toEqual({ ok: true, ...history });
        expect((await get("/api/candles?venue=china&symbol=600519&interval=1h&before=1700000000000")).body.refusal.message).toBe("an A share's history is read by range");
      } finally {
        await server.close();
      }
    });
  });
});

/** A PUBLIC SOURCE WITH NO BOOK (moved from the account's test/unit/live-book.test.ts, account split plan A2 task 7, where the account's
 * public book and trades were): its best bid and ask only, depth top, with no size, named by its quote's source — "none" where the source
 * publishes no depth at all (US stocks' public quotes), "unread" where it has a book the market does not read, with how old a quote with no
 * time of its own may be — and its trades `none`, a 200. Nothing leaves the process. */
describe("a public source with no book: its best bid and ask", () => {
  const NOW = Date.parse("2026-10-14T17:30:00.000Z");
  const listingOf = (symbol: string, kind: Listing["kind"], price: number, extra: Partial<Listing> = {}): Listing => ({ symbol, name: symbol, kind, base: symbol.split("/")[0]!, quote: "USD", price, bid: price - 1, ask: price + 1, open: true, types: [], ...extra });
  const usStocks: PublicSource = {
    id: "us-stocks", name: "US stocks", kind: "stocks", connectTo: "alpaca", connector: "live:alpaca",
    async listings(o) {
      return [listingOf("AAPL", "stock", 190, { base: "AAPL", bid: 189.98, ask: 190.02, quoteFrom: "Nasdaq · real time", quoteAt: new Date(NOW - 5_000).toISOString() })].filter((m) => !o.q || m.symbol === o.q.toUpperCase());
    },
  };
  const preIpo: PublicSource = {
    id: "preipo-pub", name: "Pre-IPO Ex", kind: "exchange", connectTo: "preipo", connector: "live:exchange:preipo",
    async listings() {
      return [listingOf("OPENAI-PERP", "perp", 900, { base: "OPENAI", bid: 899.5, ask: 900.5 })];
    },
  };

  it("US stocks: depth top, topOnly none, the quote's own time; its trades none, said in the market's words", async () => {
    const r = marketReads(createMarketCore({ sources: [usStocks, preIpo], clock: () => NOW }));
    expect(await r.book("us-stocks", "AAPL", 20)).toEqual({ venue: "us-stocks", venueName: "US stocks", symbol: "AAPL", public: true, book: { bids: [[189.98, null]], asks: [[190.02, null]], at: new Date(NOW - 5_000).toISOString(), from: "Nasdaq · real time", depth: "top", topOnly: "none" } });
    expect(await r.trades("us-stocks", "AAPL", 30)).toEqual({ venue: "us-stocks", venueName: "US stocks", symbol: "AAPL", trades: [], none: "US stocks publishes no trades the market can read", public: true });
    // a source with a book the market does not read is never said to have none; a quote with no time of its own says how old it may be:
    // its source keeps it ninety seconds, and the listing is kept twenty more
    expect(await r.book("preipo-pub", "OPENAI-PERP", 20)).toMatchObject({ book: { bids: [[899.5, null]], asks: [[900.5, null]], from: "Pre-IPO Ex", depth: "top", topOnly: "unread", upToMs: 110_000 } });
    expect(((await r.book("us-stocks", "AAPL", 20)) as { book: { upToMs?: number } }).book.upToMs).toBeUndefined();
  });
});

/** THE TWENTY-SECOND HOLD-BACK REACHES THE MARKET'S READS (moved from the account's test/unit/review2-service.test.ts, account split plan A2
 * task 7, where the account's public explore and candles were): a source that refused this location to any read (451) is not asked for its
 * listings or its bars again while the rule holds, and Markets still says so, in the venue's own words; the two explores one page makes
 * (limit 200 for Markets, 24 for Trade's picker) ask a venue that answered 451 once, not twice. Nothing leaves the process. */
describe("the hold-back reaches the market's reads", () => {
  const GEO_SAID = '{"code":0,"msg":"Service unavailable from a restricted location according to \'b. Eligibility\' in https://www.binance.com/en/terms."}';
  const geoNo = (venue: string, name: string): Refusal => no("E_VENUE_GEOBLOCKED", { venue, message: `${name} does not serve this location: that is its own rule, and the market does not look for a way around it`, native: { status: 451, said: GEO_SAID } });

  it("a venue that answered 451 is asked once by two explores, a venue that refused any read not at all, and its candles are its refusal with no request", async () => {
    const geo = { stats: 0, listings: 0 };
    const geo2 = { listings: 0 };
    const sources: PublicSource[] = [
      {
        id: "geo", name: "Geo Exchange", kind: "exchange", connectTo: "geo", connector: "live:exchange:geo",
        async listings() { geo.listings++; return geoNo("geo", "Geo Exchange"); },
        async stats() { geo.stats++; return geoNo("geo", "Geo Exchange"); },
        async candles() { geo.listings++; return geoNo("geo", "Geo Exchange"); },
      },
      {
        id: "geo2", name: "Second Geo Exchange", kind: "exchange", connectTo: "geo2", connector: "live:exchange:geo2",
        async listings() { geo2.listings++; return geoNo("geo2", "Second Geo Exchange"); },
      },
    ];
    const core = createMarketCore({ sources });
    const r = marketReads(core);
    // Geo Exchange says 451 to a ticker read first: a rule for this location holds for ten minutes, for every read of it
    expect(isRefusal(await core.sources().find((x) => x.id === "geo")!.stats!(["BTC/USD"]))).toBe(true);
    expect(geo.stats).toBe(1);
    const x = await r.explore({ limit: 200 });
    if (isRefusal(x)) throw new Error(x.message);
    await r.explore({ limit: 24 });
    expect(geo2.listings).toBe(1);
    expect(geo.listings).toBe(0);
    expect(x.missing).toEqual(expect.arrayContaining([expect.objectContaining({ venue: "geo", code: "E_VENUE_GEOBLOCKED" }), expect.objectContaining({ venue: "geo2", code: "E_VENUE_GEOBLOCKED" })]));
    const before = geo.listings + geo.stats;
    const c = await r.candles("geo", "BTC/USD", "1h", {});
    expect(isRefusal(c) && c.code).toBe("E_VENUE_GEOBLOCKED");
    expect(geo.listings + geo.stats - before).toBe(0);
  });
});
