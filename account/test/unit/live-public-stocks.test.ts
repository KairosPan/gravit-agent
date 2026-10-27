import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { fromEt, usClock } from "../../src/portfolio/account/calendar.ts";
import { PUBLIC_HOSTS, publicSources, type Listing } from "../../src/portfolio/live/public-markets.ts";
import { CBOE_DELAY_MS, CBOE_FROM, cboeQuoteInSession, cboeTimeMs, DAY_CHANGE_FROM_CBOE, ROBINHOOD_OVERNIGHT, US_SHARES, US_STOCKS_LINE, US_STOCKS_NAME, US_STOCKS_READ_ONLY, usLineAt, usStocksPublic } from "../../src/portfolio/live/public-stocks.ts";
import type { Candle, CandlePage } from "../../src/portfolio/live/trade.ts";
import type { Http, HttpReply } from "../../src/portfolio/live/types.ts";
import { NASDAQ_FROM, ROBINHOOD_FROM, ROBINHOOD_OVERNIGHT as OVERNIGHT_IN_QUOTES, ROBINHOOD_PRICES, RT_WAIT_MS } from "../../src/portfolio/live/us-quotes.ts";
import { json, network } from "./live-public-markets-fixtures.ts";

/** US STOCKS WITHOUT A KEY (live/public-stocks.ts): real-time quotes from Robinhood or Nasdaq where they answer, Cboe's own delayed quotes
 * where neither does, read through a stand-in network that answers the shapes each source answered — Cboe on 2026-10-13 (quotes, the
 * symbol book, today's minutes, the daily closes), Robinhood's /rhj/prices and Nasdaq's info and chart on 2026-10-14 (live/us-quotes.ts
 * and its test say what each is). The first tests are Cboe's own, the fallback: there Robinhood's answer quotes none of the shares asked
 * and Nasdaq says of each "Symbol not exists.", as both did of a symbol they do not know. Nothing leaves the process. */
type Rec = Record<string, unknown>;
/** Tuesday 13 October 2026, 10:30 New York: the regular session is under way, and a quote fifteen minutes behind is from inside it */
const NOW = fromEt(2026, 10, 13, 10, 30);
const STAMP = "2026-10-13 14:30:46";
const quoteOf = (symbol: string, price: number, extra: Rec = {}) =>
  json({ timestamp: STAMP, data: { symbol, security_type: "stock", exchange_id: 2, current_price: price, price_change: 0.84, price_change_percent: 0.2464, bid: price - 0.05, ask: price + 0.06, bid_size: 1280, ask_size: 80, open: price + 2.9, high: price + 6.3, low: price - 0.7, close: price, prev_day_close: price - 0.84, volume: 6877536, iv30: 26.691, last_trade_time: "2026-10-13T10:15:44", tick: "up", ...extra }, symbol });
const NOT_LISTED = { status: 403, body: undefined, text: '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>' };
const BOOK = json({ timestamp: "2026-10-13 13:00:03", data: [{ name: "A", company_name: "Agilent Technologies Inc" }, { name: "A2RZ1", company_name: "Adjusted Interest Rate Russell 2000 Total Return Futures" }, { name: "AAPL", company_name: "Apple Inc" }, { name: "APP", company_name: "AppLovin Corp" }, { name: "NVDA", company_name: "NVIDIA Corp" }, { name: "BRK.B", company_name: "Berkshire Hathaway Inc" }, { name: "JPM", company_name: "JPMorgan Chase & Co" }, { name: "^SPX", company_name: "S&P 500 INDEX" }, { name: "SPY", company_name: "SPDR S&P 500 ETF Trust" }] });
const routes = (): Array<[string, ReturnType<typeof json> | ((url: string) => ReturnType<typeof json>)]> => [
  ["/quotes/AAPL.json", quoteOf("AAPL", 341.81)],
  ["/quotes/NVDA.json", quoteOf("NVDA", 180.5)],
  ["/quotes/APP.json", quoteOf("APP", 400)],
  ["/quotes/BRK.B.json", quoteOf("BRK.B", 520.11)],
  ["/quotes/_SPX.json", quoteOf("^SPX", 7810.31, { security_type: "index" })],
  ["/quotes/ZZZZ.json", NOT_LISTED],
  ["/charts/intraday/ZZZZ.json", NOT_LISTED],
  ["/symbol_book/symbol-book.json", BOOK],
  ["/charts/intraday/AAPL.json", json({ timestamp: STAMP, data: [{ datetime: "2026-10-13T09:31:00", price: { open: 344.665, high: 347.61, low: 344.665, close: 346.9699 }, volume: { stock_volume: 1637693 } }, { datetime: "2026-10-13T09:32:00", price: { open: 346.935, high: 347.2, low: 346.5, close: 346.8 }, volume: { stock_volume: 500000 } }, { datetime: "2026-10-13T09:36:00", price: { open: 346.8, high: 348.1, low: 346.1, close: 347.5 }, volume: { stock_volume: 400000 } }] })],
  ["/charts/historical/AAPL.json", json({ timestamp: "11:00:08", data: [{ date: "2004-01-02", volume: 2024993600, open: 0.39, high: 0.39, low: 0.38, close: 0.38 }, { date: "2026-10-09", volume: 50000000, open: 340, high: 342, low: 338, close: 341 }, { date: "2026-10-12", volume: 48000000, open: 341, high: 343, low: 339, close: 340.97 }] })],
];
/** Robinhood's one answer (its record's shape, live/us-quotes.ts), stamped `at`, quoting the shares given as [ticker, bid, ask] */
const rhAnswer = (at: number, shares: Array<[string, string, string]>, extra: Rec = {}) =>
  json({ quotes: shares.map(([tokenSymbol, bid, ask]) => ({ tokenSymbol, bid, ask, currency: "USD", dailyTradingVolume: "2325834", isTradingHalt: false, generatedAt: new Date(at).toISOString(), dailyHigh: "1", dailyLow: "1", tokenBid: bid, tokenAsk: ask, ...extra })) });
/** a route for Robinhood's answer that answers it as it stood fifteen seconds before on its first ask — each book a cent lower, each stamp
 * fifteen seconds earlier — then as it is: a book is taken only once it has been seen to move (one first seen may have stood since the last
 * session: live/us-quotes.ts), so a source that read the first sees every book in the second move */
const seenMoving = (r: HttpReply) => {
  let asked = 0;
  const cent = (v: unknown) => (Number(v) - 0.01).toFixed(2);
  const earlier = json({ quotes: (r.body as { quotes: Rec[] }).quotes.map((x) => ({ ...x, bid: cent(x.bid), ask: cent(x.ask), generatedAt: new Date(Date.parse(String(x.generatedAt)) - 15_000).toISOString() })) });
  return () => (asked++ === 0 ? earlier : r);
};
/** a source whose clock reads `at`, that listed a search matching nothing fifteen seconds before and again at `at` — which reads
 * Robinhood's answer (as it stood then, `seenMoving`, then as it is) and the symbol book, nothing else — so each book Robinhood quotes at
 * `at` has been seen to move, and its latest answer prices it: Nasdaq is asked, at the same time as Robinhood, only for what that answer
 * does not price. What those listings asked is not counted in `sent`, and the answer read at `at` is kept until Robinhood's next write */
async function watched(net: { http: Http; sent?: unknown[] }, at: number) {
  let t = at - 15_000;
  const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => t });
  await src.listings({ q: "#", limit: 1 });
  await new Promise((go) => setTimeout(go, 0));
  t = at;
  await src.listings({ q: "#", limit: 1 });
  await new Promise((go) => setTimeout(go, 0));
  net.sent?.splice(0);
  return src;
}
/** Nasdaq's answer for a symbol it does not know (as for SPY asked as a stock, 2026-10-14) */
const NQ_NONE = json({ data: null, message: null, status: { rCode: 400, bCodeMessage: [{ code: 1001, errorMessage: "Symbol not exists." }], developerMessage: null } });
/** neither real-time source has the shares asked: Robinhood quotes another, Nasdaq knows none */
const noRealTime = (): Array<[string, HttpReply]> => [["/rhj/prices", rhAnswer(NOW - 5_000, [["CRM", "234.98", "235.12"]])], ["api.nasdaq.com", NQ_NONE]];
const cboeSent = (net: { sent: Array<{ url: string }> }) => net.sent.filter((s) => s.url.includes("cdn-api.cboe.com")).map((s) => s.url);
const listings = async (o: { q?: string; limit: number }, net = network([...routes(), ...noRealTime()]), clock = () => NOW) => {
  const got = await usStocksPublic({ pace: async () => undefined, http: net.http, clock }).listings(o);
  if (isRefusal(got)) throw new Error(`${got.code}: ${got.message}`);
  return got;
};

describe("US stocks, keyless: Cboe's delayed quotes where no real-time source answers", () => {
  it("lists the well-known names first, each with Cboe's own price, bid, ask, stamp and day change, the session from the market calendar, and the delay said on the line; read-only, a broker to connect", async () => {
    const net = network([...routes(), ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => NOW });
    const got = (await src.listings({ limit: 2 })) as Listing[];
    expect(US_SHARES.slice(0, 2)).toEqual(["NVDA", "AAPL"]);
    expect(got.map((m) => m.symbol)).toEqual(["NVDA", "AAPL"]);
    // by design since the real-time chain: the line carries its stamp (Cboe's last_trade_time), the delay, the source in words (which is
    // the line's name), and the session in full
    const closes = new Date(fromEt(2026, 10, 13, 16)).toISOString();
    expect(got[1]).toEqual({ symbol: "AAPL", name: "Apple Inc", kind: "stock", base: "AAPL", quote: "USD", price: 341.81, bid: 341.76, ask: 341.87, quoteAt: new Date(fromEt(2026, 10, 13, 10, 15) + 44_000).toISOString(), delayMs: CBOE_DELAY_MS, quoteFrom: CBOE_FROM, open: true, types: [], session: { open: true, closesAt: closes, phase: "regular", phaseEndsAt: closes, extendedHours: false }, change24h: 0.84, changePct24h: 0.2464, venueName: US_STOCKS_NAME });
    expect(CBOE_FROM).toBe("Cboe · 15 min delayed");
    // nothing worked out from Cboe's figures: its volume is in shares, so no dollar volume
    expect(got[1]!.volumeUsd24h).toBeUndefined();
    // Robinhood's one answer, Nasdaq for each share (as a stock, then as an ETF), then Cboe: the symbol book for the names (kept ten
    // minutes) and the two quotes, nothing else
    expect(net.sent.map((s) => s.url).filter((u) => u.includes("robinhood"))).toEqual([ROBINHOOD_PRICES]);
    expect(net.sent.filter((s) => s.url.includes("api.nasdaq.com"))).toHaveLength(4);
    expect(cboeSent(net)).toEqual(["https://cdn-api.cboe.com/api/global/delayed_quotes/symbol_book/symbol-book.json", "https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/NVDA.json", "https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/AAPL.json"]);
    expect(src).toMatchObject({ id: "cboe", name: "US stocks", kind: "stocks", connectTo: "alpaca", connector: "live:alpaca" });
    expect([US_STOCKS_NAME, US_STOCKS_LINE]).toEqual(["US stocks", "US stocks · real time, else Cboe 15 min delayed"]);
    expect(src.readOnly).toBe(US_STOCKS_READ_ONLY);
    expect(src.readOnly).toContain("15 minutes behind the market");
    expect(src.notes!({})).toEqual(["US stocks: real-time quotes (Robinhood, else Nasdaq) for 2 well-known names, else Cboe's 15 min delayed ones · search any stock or ETF."]);
    expect(src.notes!({}).every((n) => n.length < 160)).toBe(true);
    expect(PUBLIC_HOSTS).toEqual(expect.arrayContaining(["cdn-api.cboe.com", "api.robinhood.com", "api.nasdaq.com"]));
    expect(publicSources().map((s) => s.id)).toContain("cboe");
    // a quote is kept a minute, the book ten, Robinhood's answer ten seconds, a symbol Nasdaq does not know ten minutes: the same listing
    // again asks nothing
    const asked = net.sent.length;
    await src.listings({ limit: 2 });
    expect(net.sent).toHaveLength(asked);
    // the book refusing leaves the well-known their tickers for names, and the quotes still answer
    const noBook = network([["/symbol_book/", { status: 500, body: undefined, text: "" }], ["/quotes/NVDA.json", quoteOf("NVDA", 180.5)], ["/quotes/AAPL.json", quoteOf("AAPL", 341.81)], ...noRealTime()]);
    expect(((await usStocksPublic({ pace: async () => undefined, http: noBook.http, clock: () => NOW }).listings({ limit: 2 })) as Listing[]).map((m) => m.name)).toEqual(["NVDA", "AAPL"]);
  });

  it("a search reads Cboe's symbol book: the ticker whole first, then its start, then the company's name; an index and a futures root are not stocks; a dotted class share is; a ticker the loaded book lacks is asked of Nasdaq alone, and not listed where Nasdaq does not know it", async () => {
    const net = network([...routes(), ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => NOW });
    const app = (await src.listings({ q: "app", limit: 5 })) as Listing[];
    // APP whole, then Apple by its company name; the company's name comes with the quote
    expect(app.map((m) => [m.symbol, m.name])).toEqual([["APP", "AppLovin Corp"], ["AAPL", "Apple Inc"]]);
    expect(net.sent.filter((s) => s.url.includes("symbol_book"))).toHaveLength(1);
    // the same book serves the well-known list's names
    expect(((await src.listings({ limit: 2 })) as Listing[]).map((m) => m.name)).toEqual(["NVIDIA Corp", "Apple Inc"]);
    expect(((await src.listings({ q: "berk", limit: 5 })) as Listing[]).map((m) => m.symbol)).toEqual(["BRK.B"]);
    // the book is kept ten minutes: one read for both searches
    expect(net.sent.filter((s) => s.url.includes("symbol_book"))).toHaveLength(1);
    // an index (^SPX) and a futures root (A2RZ1) are no stock: not asked for, not listed
    expect(await src.listings({ q: "A2RZ", limit: 5 })).toEqual([]);
    expect(await src.listings({ q: "^SPX", limit: 5 })).toEqual([]);
    expect(net.sent.some((s) => s.url.includes("_SPX") || s.url.includes("A2RZ1") || s.url.includes("SPX/"))).toBe(false);
    // a ticker typed whole that the loaded book does not carry is asked of Nasdaq, which knows the tickers that trade — not of Cboe, whose
    // store keeps files of tickers that no longer trade — and Nasdaq not knowing it, it is not listed
    expect(await src.listings({ q: "ZZZZ", limit: 5 })).toEqual([]);
    expect(net.sent.some((s) => s.url.endsWith("/quotes/ZZZZ.json"))).toBe(false);
    expect(net.sent.filter((s) => s.url.includes("/quote/ZZZZ/info")).map((s) => s.url.split("?")[1])).toEqual(["assetclass=stocks", "assetclass=etf"]);
    // a quote that is an index is not listed either
    const spx = network([["/quotes/SPY.json", quoteOf("SPY", 778.67, { security_type: "index" })], ["/symbol_book/", BOOK], ...noRealTime()]);
    expect(await usStocksPublic({ pace: async () => undefined, http: spx.http, clock: () => NOW }).listings({ q: "SPY", limit: 5 })).toEqual([]);
    expect(src.notes!({ q: "app" })).toEqual(["US stocks: real-time quotes from Robinhood or Nasdaq, else Cboe's delayed ones (15 minutes), for any US stock or ETF in Cboe's symbol book."]);
    expect(src.notes!({ q: "app" })[0]!.length).toBeLessThan(160);
  });

  it("a plain ticker typed whole answers from its quote without waiting for a slow symbol book (the book finishes loading for the next search), so the first search of AAPL is the share and not a slower source's token", async () => {
    let bookAsked = 0;
    const slow = {
      http: async (url: string, init?: { timeoutMs?: number }) => {
        if (url.includes("symbol_book")) {
          bookAsked++;
          await new Promise((go) => setTimeout(go, 2_000));
          return BOOK;
        }
        return url.includes("/quotes/AAPL.json") ? quoteOf("AAPL", 341.81) : url.includes("/quotes/APP.json") ? quoteOf("APP", 400) : NOT_LISTED;
      },
    };
    const src = usStocksPublic({ pace: async () => undefined, http: slow.http, clock: () => NOW });
    const t0 = Date.now();
    const got = (await src.listings({ q: "aapl", limit: 5 })) as Listing[];
    expect(Date.now() - t0).toBeLessThan(1_900);
    expect(got.map((m) => [m.symbol, m.name])).toEqual([["AAPL", "AAPL"]]);
    // a search by a company's name has to wait for the book
    expect(((await src.listings({ q: "applovin", limit: 5 })) as Listing[]).map((m) => m.symbol)).toEqual(["APP"]);
    // the book was loaded once, on its way during the first search, and kept
    expect(bookAsked).toBe(1);
    expect(((await src.listings({ q: "aapl", limit: 5 })) as Listing[]).map((m) => [m.symbol, m.name])).toEqual([["AAPL", "Apple Inc"]]);
  });

  it("out of the session the line says the market is closed and when it opens, and keeps Cboe's quote (the close); the delayed window (the old rule) is the session shifted by fifteen minutes", async () => {
    const night = fromEt(2026, 10, 13, 21, 0);
    const got = await listings({ limit: 1 }, network([...routes(), ...noRealTime()]), () => night);
    // by design: the session in full — the overnight session is on, and with no real-time price for it no extended-hours order is offered
    expect(got[0]!.session).toEqual({ open: false, opensAt: new Date(fromEt(2026, 10, 14, 9, 30)).toISOString(), phase: "overnight", phaseEndsAt: new Date(fromEt(2026, 10, 14, 4, 0)).toISOString(), extendedHours: false });
    expect(got[0]!.note).toBe("the US stock market is closed: it opens Wed 14 Oct, 09:30 New York; Cboe's quote is from the close");
    expect(got[0]!.open).toBe(true);
    // the window: from 09:45 to 16:15 New York on a market day
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 9, 40))).toBe(false);
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 9, 45))).toBe(true);
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 16, 10))).toBe(true);
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 16, 15))).toBe(false);
    expect(cboeQuoteInSession(fromEt(2026, 10, 17, 12, 0))).toBe(false);
    expect(CBOE_DELAY_MS).toBe(15 * 60_000);
    // Cboe's stamps are New York time with no zone written
    expect(cboeTimeMs("2026-10-13T09:45:44")).toBe(fromEt(2026, 10, 13, 9, 45) + 44_000);
    expect(cboeTimeMs("2026-10-13 09:45")).toBeUndefined();
  });

  it("price history where Robinhood keeps none and Nasdaq keeps no minutes: Cboe's minutes folded into 5m and 1h bars, its daily closes for 1d (since the start asked), the volume in shares", async () => {
    const net = network([...routes(), ...noRealTime()]);
    const src = usStocksPublic({ http: net.http, clock: () => NOW, pace: async () => undefined });
    const five = ((await src.candles!("AAPL", "5m", { since: NOW - 3_600_000 })) as CandlePage).bars;
    expect(five).toEqual([
      { t: fromEt(2026, 10, 13, 9, 30), o: 344.665, h: 347.61, l: 344.665, c: 346.8, v: 2137693 },
      { t: fromEt(2026, 10, 13, 9, 35), o: 346.8, h: 348.1, l: 346.1, c: 347.5, v: 400000 },
    ]);
    // a bar that began before the start asked is not one of them (the exchanges' rule): the hour is asked from two hours back
    const hour = ((await src.candles!("aapl", "1h", { since: NOW - 2 * 3_600_000 })) as CandlePage).bars;
    expect(hour).toEqual([{ t: fromEt(2026, 10, 13, 9, 0), o: 344.665, h: 348.1, l: 344.665, c: 347.5, v: 2537693 }]);
    const days = (await src.candles!("AAPL", "1d", { since: fromEt(2026, 10, 1) })) as CandlePage;
    expect(days.bars.map((b) => [b.t, b.c])).toEqual([[fromEt(2026, 10, 9, 9, 30), 341], [fromEt(2026, 10, 12, 9, 30), 340.97]]);
    expect([days.source, days.adjustment]).toEqual(["Cboe · AAPL", "split-adjusted, not dividend-adjusted"]);
    // the minutes once, the days once: both kept. Cboe's month of ten-minute bars, the hourly fallback first, has no file here (asked each
    // time: a refusal is not kept)
    await src.candles!("AAPL", "1h", { since: NOW - 2 * 3_600_000 });
    expect(net.sent.filter((s) => s.url.includes("/charts/")).map((s) => s.url.split("/charts/")[1])).toEqual(["intraday/AAPL.json", "one_month/AAPL.json", "historical/AAPL.json", "one_month/AAPL.json"]);
    expect((await src.candles!("^SPX", "1h", { since: NOW - 3_600_000 }) as Refusal).code).toBe("E_ACCOUNT_BAD_ACTION");
    expect((await src.candles!("ZZZZ", "1h", { since: NOW - 3_600_000 }) as Refusal).message).toContain("keeps no history");
  });

  it("Cboe refusing this network — a 451, a 429, no answer — is its answer for the whole listing, held back as any public source's is; a refusal of one quote beside others answering leaves that line out", async () => {
    const blocked = network([["cdn-api.cboe.com", { status: 451, body: undefined, text: "unavailable for legal reasons" }], ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: blocked.http, clock: () => NOW });
    const r = (await src.listings({ limit: 2 })) as Refusal;
    expect(r.code).toBe("E_VENUE_GEOBLOCKED");
    expect(r.message).toBe("Cboe does not serve this location: that is its own rule, and the account does not look for a way around it");
    // held ten minutes (the book's refusal and each quote's): the next listing asks Cboe nothing
    const asked = blocked.sent.length;
    await src.listings({ limit: 2 });
    expect(cboeSent(blocked)).toHaveLength(3);
    expect(blocked.sent).toHaveLength(asked);
    const some = network([["/quotes/NVDA.json", { status: 500, body: undefined, text: "" }], ["/quotes/AAPL.json", quoteOf("AAPL", 341.81)], ...noRealTime()]);
    expect(((await usStocksPublic({ pace: async () => undefined, http: some.http, clock: () => NOW }).listings({ limit: 2 })) as Listing[]).map((m) => m.symbol)).toEqual(["AAPL"]);
  });
});

describe("US stocks in real time: Robinhood's quote, else Nasdaq's, else Cboe's delayed one — each line saying which", () => {
  /** Nasdaq's info for a share, in its shape (live/us-quotes.ts): its strings, its stamp to the minute */
  const nqInfo = (symbol: string, last: string, bid: string, ask: string, stamp: string, extra: Rec = {}) =>
    json({ data: { symbol, companyName: `${symbol} Common Stock`, primaryData: { lastSalePrice: `$${last}`, netChange: "+3.39", percentageChange: "+1.02%", lastTradeTimestamp: stamp, isRealTime: true, bidPrice: `$${bid}`, askPrice: `$${ask}`, bidSize: "53", askSize: "30", volume: "4,564,263", currency: null }, secondaryData: null, marketStatus: "Open", assetClass: "STOCKS", ...extra }, message: null, status: { rCode: 200 } });
  const nq = (sym: string, cls = "stocks", what = "info") => `https://api.nasdaq.com/api/quote/${sym}/${what}?assetclass=${cls}`;
  /** Robinhood quotes NVDA and AAPL (stamped `at`); Nasdaq knows JPM; Cboe has a file for each, and for BRK.B, which neither real-time
   * source prices (Nasdaq's edge refuses it here: a stand-in) */
  const live = (at: number, extra: Array<[string, HttpReply]> = []): ReturnType<typeof routes> => [
    ...extra,
    ["/rhj/prices", seenMoving(rhAnswer(at - 5_000, [["NVDA", "180.48", "180.52"], ["AAPL", "341.80", "341.84"]]))],
    [nq("JPM"), nqInfo("JPM", "334.82", "334.80", "334.85", "Oct 13, 2026 10:29 AM ET")],
    [nq("BRK.B"), { status: 403, body: undefined, text: "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>Access Denied</BODY></HTML>" }],
    ["api.nasdaq.com", NQ_NONE],
    ["/quotes/JPM.json", quoteOf("JPM", 334.1)],
    ...routes(),
  ];

  it("prices each line from the real-time chain first: Robinhood's bid and ask with its stamp, no delay, and its change from Cboe's previous close; Nasdaq's last trade with its own change; Cboe's delayed quote only where neither priced", async () => {
    expect(DAY_CHANGE_FROM_CBOE).toBe(true);
    const net = network(live(NOW));
    const src = await watched(net, NOW);
    const first = (await src.listings({ q: "AAPL", limit: 1 })) as Listing[];
    const closes = new Date(fromEt(2026, 10, 13, 16)).toISOString();
    const line = { symbol: "AAPL", name: "Apple Inc", kind: "stock", base: "AAPL", quote: "USD", price: 341.82, bid: 341.8, ask: 341.84, quoteAt: new Date(NOW - 5_000).toISOString(), delayMs: 0, quoteFrom: ROBINHOOD_FROM, open: true, types: [], session: { open: true, closesAt: closes, phase: "regular", phaseEndsAt: closes, extendedHours: false }, venueName: US_STOCKS_NAME };
    // A ROBINHOOD LINE NEVER WAITS FOR CBOE (feat/paper-live phase 3): Cboe, asked at the same time, had not answered when Robinhood's price
    // was at hand — the line goes without the day's change rather than wait for it
    expect(first).toEqual([line]);
    // the next read has Cboe's answer (kept a minute): the change is Robinhood's price less Cboe's previous close (341.81 - 0.84 = 340.97,
    // from Cboe's file of this session, last trade 10:15:44): 0.85, not Cboe's own 0.84, which is fifteen minutes older than the price beside
    // it — the price less the change is the close
    await new Promise((go) => setTimeout(go, 0));
    const got = (await src.listings({ q: "AAPL", limit: 1 })) as Listing[];
    expect(got).toEqual([{ ...line, change24h: 0.85, changePct24h: 0.2493 }]);
    // Nasdaq was not asked for a share Robinhood priced; Cboe for its previous close
    expect(net.sent.some((s) => s.url.includes("/quote/AAPL/"))).toBe(false);
    expect(cboeSent(net).filter((u) => u.includes("/quotes/"))).toEqual(["https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/AAPL.json"]);
    // JPM: Nasdaq's, its own change, and Cboe not asked for it
    const jpm = ((await src.listings({ q: "JPM", limit: 1 })) as Listing[])[0]!;
    expect(jpm).toMatchObject({ symbol: "JPM", price: 334.82, bid: 334.8, ask: 334.85, quoteAt: new Date(fromEt(2026, 10, 13, 10, 29)).toISOString(), delayMs: 0, quoteFrom: NASDAQ_FROM, venueName: US_STOCKS_NAME, change24h: 3.39, changePct24h: 1.02 });
    // Cboe was asked for it AT THE SAME TIME as the chain (the fallback, ready if the chain is late); Nasdaq's answer is the line's
    expect(net.sent.some((s) => s.url.endsWith("/quotes/JPM.json"))).toBe(true);
    // BRK.B: neither priced it, so Cboe's, fifteen minutes behind, with Cboe's stamp
    const brk = ((await src.listings({ q: "BRK.B", limit: 1 })) as Listing[])[0]!;
    expect(brk).toMatchObject({ symbol: "BRK.B", price: 520.11, quoteAt: new Date(fromEt(2026, 10, 13, 10, 15) + 44_000).toISOString(), delayMs: CBOE_DELAY_MS, quoteFrom: CBOE_FROM, venueName: US_STOCKS_NAME, change24h: 0.84 });
    expect(src.sessions).toBe(usClock);
  });

  it("the well-known names in one pass: Robinhood's one answer for all, Nasdaq only for what it does not price, Cboe at the same time for every line (the fallback, and the previous close beside a Robinhood price)", async () => {
    const net = network(live(NOW));
    const got = (await (await watched(net, NOW)).listings({ limit: 2 })) as Listing[];
    expect(got.map((m) => [m.symbol, m.quoteFrom])).toEqual([["NVDA", ROBINHOOD_FROM], ["AAPL", ROBINHOOD_FROM]]);
    // Robinhood's answer as it was just written serves both (kept until its next write): no GET of it here
    expect(net.sent.filter((s) => s.url === ROBINHOOD_PRICES)).toHaveLength(0);
    expect(net.sent.some((s) => s.url.includes("api.nasdaq.com"))).toBe(false);
    // Robinhood stale: Nasdaq is asked (and knows neither here), and Cboe prices both
    const stale = network(live(NOW - 3 * 60_000));
    const old = (await (await watched(stale, NOW)).listings({ limit: 2 })) as Listing[];
    expect(old.map((m) => [m.symbol, m.quoteFrom])).toEqual([["NVDA", CBOE_FROM], ["AAPL", CBOE_FROM]]);
    expect(stale.sent.filter((s) => s.url.includes("api.nasdaq.com"))).toHaveLength(4);
    // Cboe refusing everything beside Robinhood's prices (its book too: the well-known few are tickers the file names itself, so Robinhood's
    // quote is still taken for them): the lines Robinhood priced, with no day's change, not a refusal
    const cboeDown = network([["cdn-api.cboe.com", { status: 503, body: undefined, text: "" }], ...live(NOW)]);
    const without = (await (await watched(cboeDown, NOW)).listings({ limit: 2 })) as Listing[];
    expect(without.map((m) => [m.symbol, m.price, m.changePct24h])).toEqual([["NVDA", 180.5, undefined], ["AAPL", 341.82, undefined]]);
  });

  it("the session on each line: pre-market and after-hours offer an extended-hours limit where a real-time source priced the line, and say whose price it is and from when; overnight only a share Robinhood priced; closed, Cboe's close", async () => {
    expect(ROBINHOOD_OVERNIGHT).toBe(OVERNIGHT_IN_QUOTES);
    const read = async (at: number, q: string, extra: Array<[string, HttpReply]> = []) => ((await (await watched(network(live(at, extra)), at)).listings({ q, limit: 1 })) as Listing[])[0]!;
    // pre-market, Tuesday 13 October 08:00 EDT: Robinhood's AAPL
    const pre = fromEt(2026, 10, 13, 8, 0);
    const a = await read(pre, "AAPL");
    expect(a.session).toEqual({ open: false, opensAt: new Date(fromEt(2026, 10, 13, 9, 30)).toISOString(), phase: "pre", phaseEndsAt: new Date(fromEt(2026, 10, 13, 9, 30)).toISOString(), extendedHours: true });
    expect(a.note).toBe("pre-market trading is on until 09:30 New York: the price is Robinhood's real-time quote; the regular session opens Tue 13 Oct, 09:30 New York");
    // no change beside a Robinhood price out of the regular session: the close it would be measured from is not one Cboe's file says
    expect([a.change24h, a.changePct24h]).toEqual([undefined, undefined]);
    // nor from 09:30 until Cboe's file has the day's first trade: at 09:35 on Wednesday Cboe's file is still Tuesday's
    const opening = await read(fromEt(2026, 10, 14, 9, 35), "AAPL");
    expect([opening.quoteFrom, opening.session!.phase, opening.change24h]).toEqual([ROBINHOOD_FROM, "regular", undefined]);
    // after-hours, 17:00: JPM at Nasdaq — its last trade stamped 10:29, from the regular session, said so and not called the phase's live
    // quote; with a trade stamped in after-hours, it is
    const after = fromEt(2026, 10, 13, 17, 0);
    const jpm = await read(after, "JPM");
    expect([jpm.quoteFrom, jpm.session!.extendedHours]).toEqual([NASDAQ_FROM, true]);
    expect(jpm.note).toBe("after-hours trading is on until 20:00 New York: the price is Nasdaq's last trade at 10:29 New York (regular session); the regular session opens Wed 14 Oct, 09:30 New York");
    const jpmAfter = await read(after, "JPM", [[nq("JPM"), nqInfo("JPM", "334.90", "334.85", "334.95", "Oct 13, 2026 4:58 PM ET")]]);
    expect(jpmAfter.note).toBe("after-hours trading is on until 20:00 New York: the price is Nasdaq's real-time quote; the regular session opens Wed 14 Oct, 09:30 New York");
    // the next morning's pre-market, JPM not yet traded: yesterday's trade, with its date
    expect((await read(fromEt(2026, 10, 14, 8, 0), "JPM")).note).toBe("pre-market trading is on until 09:30 New York: the price is Nasdaq's last trade at 10:29 New York on Tue 13 Oct (regular session); the regular session opens Wed 14 Oct, 09:30 New York");
    // BRK.B at Cboe's close, said so — and no extended-hours order offered beside it: a paper account never fills one at Cboe's quote
    const brk = await read(after, "BRK.B");
    expect([brk.quoteFrom, brk.session!.extendedHours]).toEqual([CBOE_FROM, false]);
    expect(brk.note).toBe("after-hours trading is on until 20:00 New York, but no real-time quote answered: Cboe's quote is from the close; the regular session opens Wed 14 Oct, 09:30 New York");
    // overnight, 22:00: Robinhood's AAPL may take an extended-hours limit; JPM (Nasdaq keeps no overnight session) is Cboe's close and may not
    const night = fromEt(2026, 10, 13, 22, 0);
    const na = await read(night, "AAPL");
    expect([na.quoteFrom, na.session!.phase, na.session!.extendedHours]).toEqual([ROBINHOOD_FROM, "overnight", true]);
    expect(na.note).toBe("the overnight session is on until 04:00 New York: the price is Robinhood's real-time quote; the regular session opens Wed 14 Oct, 09:30 New York");
    const nj = await read(night, "JPM");
    expect([nj.quoteFrom, nj.session!.phase, nj.session!.extendedHours, nj.note]).toEqual([CBOE_FROM, "overnight", false, "the US stock market is closed: it opens Wed 14 Oct, 09:30 New York; Cboe's quote is from the close"]);
    // Saturday: closed; no real-time source is asked, Cboe's close
    const saturday = fromEt(2026, 10, 17, 12, 0);
    const sat = network(live(saturday));
    const s = ((await usStocksPublic({ pace: async () => undefined, http: sat.http, clock: () => saturday }).listings({ q: "AAPL", limit: 1 })) as Listing[])[0]!;
    expect([s.quoteFrom, s.session!.phase, s.session!.extendedHours]).toEqual([CBOE_FROM, "closed", false]);
    expect(sat.sent.some((x) => x.url.includes("robinhood") || x.url.includes("nasdaq"))).toBe(false);
    // the day after Thanksgiving, 14:00 EST: the early close's after-hours, to 17:00
    const early = fromEt(2026, 11, 27, 14, 0);
    const e = await read(early, "AAPL");
    expect(e.session).toEqual({ open: false, opensAt: new Date(fromEt(2026, 11, 30, 9, 30)).toISOString(), phase: "after", phaseEndsAt: new Date(fromEt(2026, 11, 27, 17, 0)).toISOString(), extendedHours: true });
    expect(e.note).toBe("after-hours trading is on until 17:00 New York: the price is Robinhood's real-time quote; the regular session opens Mon 30 Nov, 09:30 New York");
  });

  it("price history where Robinhood keeps none: Cboe's real minute bars and Nasdaq's one-price-a-minute samples for the minutes Cboe has none of (pre-market, the minutes since Cboe's last), asked at once and merged by time, folded into 5m and 1h bars at their real instants; a bar's volume only where every minute has one; either refusing leaves the other's; 1d Cboe's where Nasdaq has no days", async () => {
    // Nasdaq's points on Tuesday 13 October: 04:00, 04:01 and 04:07 in pre-market; 09:31, which Cboe has (its own bar is taken); 09:38 and
    // 10:28, after Cboe's last minute (09:36), fifteen minutes behind (x written as New York's wall clock)
    const wall = (h: number, m: number) => Date.UTC(2026, 9, 13, h, m);
    const chart = json({ data: { symbol: "AAPL", timeAsOf: "Oct 13, 2026 10:30 AM ET", chart: [[4, 0, 342.21], [4, 1, 341.77], [4, 7, 343.08], [9, 31, 346.97], [9, 38, 347.9], [10, 28, 349]].map(([h, m, y]) => ({ z: { dateTime: `${h}:${String(m).padStart(2, "0")} AM ET`, value: String(y) }, x: wall(h!, m!), y })) } });
    const net = network(live(NOW, [[nq("AAPL", "stocks", "chart"), chart]]));
    const src = usStocksPublic({ http: net.http, clock: () => NOW, pace: async () => undefined });
    const five = ((await src.candles!("AAPL", "5m", { since: fromEt(2026, 10, 13, 0, 0) })) as CandlePage).bars;
    expect(five).toEqual([
      { t: fromEt(2026, 10, 13, 4, 0), o: 342.21, h: 342.21, l: 341.77, c: 341.77 },
      { t: fromEt(2026, 10, 13, 4, 5), o: 343.08, h: 343.08, l: 343.08, c: 343.08 },
      // Cboe's 09:31 and 09:32, their real range and volume (Nasdaq's 09:31 sample left out)
      { t: fromEt(2026, 10, 13, 9, 30), o: 344.665, h: 347.61, l: 344.665, c: 346.8, v: 2137693 },
      // Cboe's 09:36 and Nasdaq's 09:38 sample: no volume said for a bar with a sampled minute in it
      { t: fromEt(2026, 10, 13, 9, 35), o: 346.8, h: 348.1, l: 346.1, c: 347.9 },
      { t: fromEt(2026, 10, 13, 10, 25), o: 349, h: 349, l: 349, c: 349 },
    ]);
    const hour = ((await src.candles!("AAPL", "1h", { since: fromEt(2026, 10, 13, 0, 0) })) as CandlePage).bars;
    expect(hour).toEqual([
      { t: fromEt(2026, 10, 13, 4, 0), o: 342.21, h: 343.08, l: 341.77, c: 343.08 },
      { t: fromEt(2026, 10, 13, 9, 0), o: 344.665, h: 348.1, l: 344.665, c: 347.9 },
      { t: fromEt(2026, 10, 13, 10, 0), o: 349, h: 349, l: 349, c: 349 },
    ]);
    // both asked once (kept), at the same time — Nasdaq's after its turn in its line, so in either order — the days are Cboe's
    // (Cboe's month of ten-minute bars, the hourly fallback first, has no file here)
    expect(net.sent.filter((s) => s.url.includes("/chart")).map((s) => s.url.replace(/^https:\/\/[^/]+/, "")).sort()).toEqual(["/api/global/delayed_quotes/charts/intraday/AAPL.json", "/api/global/delayed_quotes/charts/one_month/AAPL.json", "/api/quote/AAPL/chart?assetclass=stocks"]);
    expect(((await src.candles!("AAPL", "1d", { since: fromEt(2026, 10, 1) })) as CandlePage).bars.map((b) => b.c)).toEqual([341, 340.97]);
    // Nasdaq's edge refusing: Cboe's regular-session minutes alone
    const refused = network(live(NOW, [["/chart?", { status: 403, body: undefined, text: "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>" }]]));
    const cboe = ((await usStocksPublic({ http: refused.http, clock: () => NOW, pace: async () => undefined }).candles!("AAPL", "5m", { since: NOW - 3_600_000 })) as CandlePage).bars;
    expect(cboe[0]).toEqual({ t: fromEt(2026, 10, 13, 9, 30), o: 344.665, h: 347.61, l: 344.665, c: 346.8, v: 2137693 });
    // Cboe refusing: Nasdaq's samples alone; both refusing: Cboe's refusal
    const noCboe = network([["/charts/intraday/", { status: 503, body: undefined, text: "" }], ...live(NOW, [[nq("AAPL", "stocks", "chart"), chart]])]);
    expect(((await usStocksPublic({ http: noCboe.http, clock: () => NOW, pace: async () => undefined }).candles!("AAPL", "1h", { since: fromEt(2026, 10, 13, 0, 0) })) as CandlePage).bars.map((b) => b.v)).toEqual([undefined, undefined, undefined]);
    const neither = network([["/charts/intraday/", { status: 503, body: undefined, text: "" }], ["/chart?", { status: 403, body: undefined, text: "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>" }], ...live(NOW)]);
    // both refusing: Robinhood's refusal, the source asked first
    expect(((await usStocksPublic({ http: neither.http, clock: () => NOW, pace: async () => undefined }).candles!("AAPL", "1h", { since: NOW - 3_600_000 })) as Refusal).message).toBe("Robinhood keeps no history of AAPL");
  });

  it("a ticker the market does not list under that name — SATS, EchoStar's Robinhood token; the share trades as ECHO — takes no Robinhood quote and no dead Cboe file once the book has answered: not listed, and ECHO is the share", async () => {
    // SATS.json as Cboe's store served it on 2026-10-14: written in September, a last trade in June, no previous close, no book
    const satsFile = json({ timestamp: "2026-09-26 14:14:54", data: { symbol: "SATS", security_type: "stock", exchange_id: 2, current_price: 103.3, price_change: 0.0, price_change_percent: null, bid: 0.0, ask: 0.0, bid_size: 0, ask_size: 0, open: 0.0, high: 0.0, low: 0.0, close: 103.915, prev_day_close: 0.0, volume: 0, last_trade_time: "2026-06-23T15:59:59", tick: "up" }, symbol: "SATS" });
    const book = json({ timestamp: "2026-10-14 13:00:03", data: [{ name: "AAPL", company_name: "Apple Inc" }, { name: "ECHO", company_name: "EchoStar Corp" }] });
    // Robinhood's SATS book seen moving and fresh: only the ticker keeps it out
    const routesOf = (bookReply: HttpReply): Array<[string, HttpReply | (() => HttpReply)]> => [["/rhj/prices", seenMoving(rhAnswer(NOW - 5_000, [["SATS", "87.87", "87.93"], ["AAPL", "341.80", "341.84"]]))], [nq("ECHO"), nqInfo("ECHO", "87.90", "87.88", "87.92", "Oct 13, 2026 10:29 AM ET")], ["api.nasdaq.com", NQ_NONE], ["/quotes/SATS.json", satsFile], ["/quotes/ECHO.json", quoteOf("ECHO", 87.94)], ["/symbol_book/", bookReply]];
    const net = network(routesOf(book));
    const src = await watched(net, NOW);
    expect(await src.listings({ q: "SATS", limit: 5 })).toEqual([]);
    expect(net.sent.some((s) => s.url.endsWith("/quotes/SATS.json"))).toBe(false);
    expect(((await src.listings({ q: "ECHO", limit: 5 })) as Listing[]).map((m) => [m.symbol, m.name, m.quoteFrom, m.price])).toEqual([["ECHO", "EchoStar Corp", NASDAQ_FROM, 87.9]]);
    // the book not answering (a first search, or the book refused): still no Robinhood quote for a ticker typed. Cboe's dead file is then
    // all there is: shown as Cboe's, stamped June, with no change (the file gives no previous close) — and no paper fill takes a stamp so old
    const noBook = network(routesOf({ status: 500, body: undefined, text: "" }));
    const dead = ((await (await watched(noBook, NOW)).listings({ q: "SATS", limit: 5 })) as Listing[])[0]!;
    expect([dead.quoteFrom, dead.price, dead.quoteAt, dead.change24h, dead.bid]).toEqual([CBOE_FROM, 103.3, new Date(fromEt(2026, 6, 23, 15, 59) + 59_000).toISOString(), undefined, undefined]);
  });

  it("the real-time chain and Cboe are asked at the same time: Robinhood and Nasdaq hanging leave Cboe's lines within RT_WAIT_MS; Cboe hanging leaves the chain's lines, without a change, within the callers' four seconds", async () => {
    const hang = () => new Promise<HttpReply>(() => undefined);
    const base = network(live(NOW));
    const t0 = Date.now();
    const quiet = (await usStocksPublic({ pace: async () => undefined, http: (url, init) => (url.includes("robinhood") || url.includes("nasdaq") ? hang() : base.http(url, init)), clock: () => NOW }).listings({ q: "AAPL", limit: 5 })) as Listing[];
    expect(Date.now() - t0).toBeLessThan(RT_WAIT_MS + 500);
    expect(quiet.map((m) => [m.symbol, m.quoteFrom])).toEqual([["AAPL", CBOE_FROM]]);
    const slowSrc = await watched({ http: (url, init) => (url.includes("/quotes/") ? hang() : base.http(url, init)) }, NOW);
    const t1 = Date.now();
    const slow = (await slowSrc.listings({ q: "AAPL", limit: 5 })) as Listing[];
    expect(Date.now() - t1).toBeLessThan(3_500);
    expect(slow.map((m) => [m.symbol, m.quoteFrom, m.change24h])).toEqual([["AAPL", ROBINHOOD_FROM, undefined]]);
  });

  it("NASDAQ ANSWERS ONCE AND THEN SAYS TO WAIT (a 429, for minutes): the line falls back to Cboe's quote, said as fifteen minutes delayed — never Nasdaq's answer from before, said as real time — and so does one share's line (what a paper account prices by)", async () => {
    let t = NOW;
    let refuse = false;
    const base = network(live(NOW));
    const http: Http = async (url, init) => (refuse && url.includes("api.nasdaq.com") ? { status: 429, body: undefined, text: "Too Many Requests" } : base.http(url, init));
    const src = usStocksPublic({ pace: async () => undefined, http, clock: () => t });
    expect(((await src.listings({ q: "JPM", limit: 1 })) as Listing[])[0]).toMatchObject({ symbol: "JPM", price: 334.82, quoteFrom: NASDAQ_FROM, delayMs: 0 });
    refuse = true;
    // ten seconds on, and three minutes on (the answer before then older than FRESH_MS as well): Cboe's line, its own stamp and delay
    for (const later of [10_000, 3 * 60_000]) {
      t = NOW + later;
      const cboe = { symbol: "JPM", price: 334.1, quoteAt: new Date(fromEt(2026, 10, 13, 10, 15) + 44_000).toISOString(), delayMs: CBOE_DELAY_MS, quoteFrom: CBOE_FROM };
      expect(((await src.listings({ q: "JPM", limit: 1 })) as Listing[])[0]).toMatchObject(cboe);
      expect(await src.line!("JPM")).toMatchObject(cboe);
    }
  });
});

describe("one share's line, asked alone (line) — what a paper account prices a share it knows by — and a line said again at a newer quote (usLineAt)", () => {
  /** Cboe's symbol book with V and forty-five more tickers that start with it (VA… VZ, VAA…): a search of "V" lists forty */
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const many = json({ timestamp: "2026-10-13 13:00:03", data: [{ name: "V", company_name: "Visa Inc" }, ...Array.from({ length: 45 }, (_, i) => ({ name: `V${letters[i % 26]}${i >= 26 ? letters[i - 26] : ""}`, company_name: `V company ${i}` }))] });
  const anyQuote = (url: string) => quoteOf(decodeURIComponent(url.split("/quotes/")[1]!.replace(/\.json$/, "")), 330);

  it("P16: a short ticker's line asks Cboe for that one share — one GET, where a search of the same ticker reads forty — with the real-time chain at the same time; a line the chain priced never waits for Cboe", async () => {
    const searched = network([["/symbol_book/", many], ["/quotes/", anyQuote], ...noRealTime()]);
    const search = (await usStocksPublic({ pace: async () => undefined, http: searched.http, clock: () => NOW }).listings({ q: "V", limit: 40 })) as Listing[];
    expect(search).toHaveLength(40);
    expect(cboeSent(searched).filter((u) => u.includes("/quotes/"))).toHaveLength(40);
    // the line: one quote of Cboe's, the share's own; Nasdaq (at the same time as Robinhood) for it alone
    const alone = network([["/symbol_book/", many], ["/quotes/", anyQuote], ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: alone.http, clock: () => NOW });
    const line = (await src.line!("v")) as Listing;
    expect(line).toMatchObject({ symbol: "V", name: "Visa Inc", kind: "stock", price: 330, quoteFrom: CBOE_FROM, delayMs: CBOE_DELAY_MS, venueName: US_STOCKS_NAME });
    expect(cboeSent(alone).filter((u) => u.includes("/quotes/"))).toEqual(["https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/V.json"]);
    expect(alone.sent.filter((x) => x.url.includes("api.nasdaq.com")).map((x) => x.url.split("/quote/")[1])).toEqual(["V/info?assetclass=stocks", "V/info?assetclass=etf"]);
    // Cboe hanging: a line Robinhood prices answers at once, without the day's change — never waiting for Cboe
    const hang = () => new Promise<HttpReply>(() => undefined);
    const base = network([["/rhj/prices", seenMoving(rhAnswer(NOW - 5_000, [["AAPL", "341.80", "341.84"]]))], ["/symbol_book/", BOOK], ["api.nasdaq.com", NQ_NONE]]);
    const rh = await watched({ http: (url, init) => (url.includes("/quotes/") ? hang() : base.http(url, init)) }, NOW);
    const t0 = Date.now();
    const fast = (await rh.line!("AAPL")) as Listing;
    expect(Date.now() - t0).toBeLessThan(100);
    expect([fast.quoteFrom, fast.price, fast.change24h]).toEqual([ROBINHOOD_FROM, 341.82, undefined]);
  });

  it("a ticker the loaded book does not list is asked of Nasdaq alone (no dead Cboe file); not a ticker, nothing is asked; nothing priced and Cboe refusing is Cboe's refusal", async () => {
    const net = network([...routes(), ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => NOW });
    expect(await src.line!("ZZZZ")).toBeNull();
    expect(net.sent.some((x) => x.url.endsWith("/quotes/ZZZZ.json"))).toBe(false);
    const asked = net.sent.length;
    expect(await src.line!("BTC/USD")).toBeNull();
    expect(net.sent).toHaveLength(asked);
    const blocked = network([["cdn-api.cboe.com", { status: 451, body: undefined, text: "unavailable for legal reasons" }], ...noRealTime()]);
    expect(((await usStocksPublic({ pace: async () => undefined, http: blocked.http, clock: () => NOW }).line!("AAPL")) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
  });

  it("usLineAt: the line at a newer real-time quote — its price, bid, ask, stamp, delay and source, never another's bid beside it; the session and words as the line says them with that quote; the day's change from the same close within one regular session, else none", () => {
    const at = fromEt(2026, 10, 13, 10, 31);
    const cboeLine: Listing = { symbol: "AAPL", name: "Apple Inc", kind: "stock", base: "AAPL", quote: "USD", price: 341.81, bid: 341.76, ask: 341.87, quoteAt: new Date(fromEt(2026, 10, 13, 10, 15) + 44_000).toISOString(), delayMs: CBOE_DELAY_MS, quoteFrom: CBOE_FROM, open: true, types: [], change24h: 0.84, changePct24h: 0.2464, venueName: US_STOCKS_NAME };
    // Robinhood's quote at 10:31: from the close Cboe's change was measured from (341.81 - 0.84 = 340.97)
    const rh = usLineAt(cboeLine, { symbol: "AAPL", price: 342.0, bid: 341.98, ask: 342.02, at: at - 2_000, delayMs: 0, from: ROBINHOOD_FROM }, at);
    expect(rh).toMatchObject({ symbol: "AAPL", name: "Apple Inc", price: 342, bid: 341.98, ask: 342.02, quoteAt: new Date(at - 2_000).toISOString(), delayMs: 0, quoteFrom: ROBINHOOD_FROM, change24h: 1.03, venueName: US_STOCKS_NAME, session: { open: true, phase: "regular" } });
    expect(rh.changePct24h).toBeCloseTo((1.03 / 340.97) * 100, 3);
    expect(rh.note).toBeUndefined();
    // Nasdaq's quote: its own change; a crossed book gives no side — and the listing's bid is not left beside its price
    const nq = usLineAt(cboeLine, { symbol: "AAPL", price: 342.1, at: fromEt(2026, 10, 13, 10, 30), delayMs: 0, from: NASDAQ_FROM, change: 1.13, changePct: 0.33 }, at);
    expect([nq.price, nq.bid, nq.ask, nq.change24h, nq.changePct24h, nq.quoteFrom]).toEqual([342.1, undefined, undefined, 1.13, 0.33, NASDAQ_FROM]);
    // overnight, Robinhood's quote: the overnight session offers an extended-hours limit, its words say whose price; no change (the close
    // it would be measured from is not one session's with the listing's)
    const night = fromEt(2026, 10, 13, 22, 0);
    const n = usLineAt(cboeLine, { symbol: "AAPL", price: 343, bid: 342.9, ask: 343.1, at: night - 10_000, delayMs: 0, from: ROBINHOOD_FROM }, night);
    expect([n.session?.phase, n.session?.extendedHours, n.change24h]).toEqual(["overnight", true, undefined]);
    expect(n.note).toBe("the overnight session is on until 04:00 New York: the price is Robinhood's real-time quote; the regular session opens Wed 14 Oct, 09:30 New York");
  });
});

