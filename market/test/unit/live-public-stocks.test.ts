import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { etDate, fromEt, usClock } from "../../src/calendar.ts";
import { PUBLIC_HOSTS, publicSources, type Listing } from "../../src/live/public-markets.ts";
import { CBOE_DELAY_MS, CBOE_FROM, CLOSE_WAIT_MS, cboeQuoteInSession, DIR_WAIT_MS, NASDAQ_CLOSE_FROM, ROBINHOOD_OVERNIGHT, US_CLOSE_DELAY_MS, US_SHARES, US_STOCKS_LINE, US_STOCKS_NAME, US_STOCKS_READ_ONLY, usLineAt, usStocksPublic } from "../../src/live/public-stocks.ts";
import type { Candle, CandlePage } from "../../src/live/trade.ts";
import type { Http, HttpReply } from "../../src/live/types.ts";
import { NASDAQ_FROM, ROBINHOOD_FROM, ROBINHOOD_OVERNIGHT as OVERNIGHT_IN_QUOTES, ROBINHOOD_PRICES, RT_WAIT_MS } from "../../src/live/us-quotes.ts";
import { NASDAQ_TRADER } from "../../src/live/us-directory.ts";
import { RH_ASSETS } from "../../src/live/us-tokens.ts";
import { json, network } from "./live-public-markets-fixtures.ts";

/** US STOCKS WITHOUT A KEY (live/public-stocks.ts): real-time quotes from Robinhood or Nasdaq where they answer, Nasdaq's last regular close
 * (its daily bars asked by dates, live/us-closes.ts) where neither does, read through a stand-in network that answers the shapes each
 * source answered — Robinhood's /rhj/prices and Nasdaq's info and chart on 2026-10-14, Nasdaq's daily bars on 2026-11-23 (the AAPL fixture,
 * and the same shape for the other shares), Cboe's minutes and daily history on 2026-10-13 (price history only: no price is asked of Cboe)
 * (live/us-quotes.ts and its test say what each is). The first tests are the close's own, the fallback: there Robinhood's answer quotes none
 * of the shares asked and Nasdaq says of each "Symbol not exists.", as both did of a symbol they do not know. Nothing leaves the process. */
type Rec = Record<string, unknown>;
/** Tuesday 13 October 2026, 10:30 New York: the regular session is under way; the last regular close is Monday 12 October's */
const NOW = fromEt(2026, 10, 13, 10, 30);
const STAMP = "2026-10-13 14:30:46";
const NOT_LISTED = { status: 403, body: undefined, text: '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>' };
/** Nasdaq Trader's symbol directory (live/us-directory.ts) and Robinhood's token names (live/us-tokens.ts), as cut from the files they
 * served on 2026-11-23: the market's book of tickers, their companies' names, and the names a Robinhood quote is checked against */
const fixture = (name: string) => readFileSync(new URL(`../fixtures/us-stocks/${name}`, import.meta.url), "utf8");
const NASDAQ_LISTED = fixture("nasdaqlisted.txt");
const OTHER_LISTED = fixture("otherlisted.txt");
const TOKEN_NAMES = json(JSON.parse(fixture("rh-token-names.json")));
/** Nasdaq's daily bars for AAPL asked by dates on Monday 2026-11-23 at 21:58 New York: 11/19 at 349.21, 11/20 at 342.56, 11/23 at 349.08 */
const AAPL_DAYS = json(JSON.parse(fixture("chart-AAPL-daily.json")));
/** a text answer, as the directory's files are read (whole, not as JSON) */
const textReply = (text: string): HttpReply => ({ status: 200, body: undefined, text });
/** the directory's two files and the token names, as routes; another nasdaqlisted text (its header kept) where a test needs other rows */
const dirRoutes = (nasdaqListed = NASDAQ_LISTED, otherListed = OTHER_LISTED): Array<[string, HttpReply]> => [["/SymDir/nasdaqlisted.txt", textReply(nasdaqListed)], ["/SymDir/otherlisted.txt", textReply(otherListed)], ["/rhj/assets", TOKEN_NAMES]];
const dirSent = (net: { sent: Array<{ url: string }> }) => net.sent.filter((s) => s.url.startsWith(NASDAQ_TRADER)).map((s) => s.url);
/** Nasdaq's daily bars for a share, in the AAPL fixture's shape: each day [M/D/YYYY, close] */
const daysOf = (symbol: string, closes: Array<[string, number]>): HttpReply =>
  json({ data: { symbol, company: `${symbol} Common Stock`, chart: closes.map(([d, c]) => ({ z: { high: String(c + 2), low: String(c - 2), open: String(c - 1), close: String(c), volume: "40,000,000", dateTime: d, value: String(c) }, x: 0, y: c })) }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
/** the share a Nasdaq URL is for */
const symOf = (url: string) => decodeURIComponent(url.split("/quote/")[1]!.split("/")[0]!);
/** a route answering Nasdaq's daily bars (a chart asked by dates) from a table; a share not in it, Nasdaq's "Symbol not exists." */
const days = (table: Record<string, HttpReply>): [string, (url: string) => HttpReply] => ["fromdate=", (url) => table[symOf(url)] ?? NQ_NONE];
/** October's daily bars: Friday 9th, Monday 12th, Tuesday 13th */
const oct = (a: number, b: number, c: number): HttpReply => daysOf("", [["10/09/2026", a], ["10/12/2026", b], ["10/13/2026", c]]);
const OCT: Record<string, HttpReply> = { AAPL: oct(341, 340.97, 340.5), NVDA: oct(179, 179.66, 181), APP: oct(398, 399, 401), "BRK.B": oct(519, 520.11, 521), JPM: oct(333, 334.1, 335) };
/** November's: 19th, 20th (Friday) and Monday 23rd — AAPL the fixture's */
const nov = (a: number, b: number, c: number): HttpReply => daysOf("", [["11/19/2026", a], ["11/20/2026", b], ["11/23/2026", c]]);
const NOV: Record<string, HttpReply> = { AAPL: AAPL_DAYS, NVDA: nov(182, 180, 184), "BRK.B": nov(500, 498, 501), SPY: nov(660, 655, 662) };
const dailySent = (net: { sent: Array<{ url: string }> }) => net.sent.filter((s) => s.url.includes("fromdate=")).map((s) => symOf(s.url));
const routes = (): Array<[string, HttpReply | ((url: string) => HttpReply)]> => [
  days(OCT),
  ["/charts/intraday/ZZZZ.json", NOT_LISTED],
  ...dirRoutes(),
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
 * Robinhood's answer (as it stood then, `seenMoving`, then as it is), the symbol directory and the token names, nothing else — so each book Robinhood quotes at
 * `at` has been seen to move, and its latest answer prices it: Nasdaq is asked, at the same time as Robinhood, only for what that answer
 * does not price. What those listings asked is not counted in `sent`, and the answer read at `at` is kept until Robinhood's next write.
 * `clock`, given, is set to read `at` and can be moved on after */
async function watched(net: { http: Http; sent?: unknown[] }, at: number, clock: { t: number } = { t: at }) {
  clock.t = at - 15_000;
  const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => clock.t });
  await src.listings({ q: "#", limit: 1 });
  await new Promise((go) => setTimeout(go, 0));
  clock.t = at;
  await src.listings({ q: "#", limit: 1 });
  await new Promise((go) => setTimeout(go, 0));
  net.sent?.splice(0);
  return src;
}
/** Nasdaq's answer for a symbol it does not know (as for SPY asked as a stock, 2026-10-14) */
const NQ_NONE = json({ data: null, message: null, status: { rCode: 400, bCodeMessage: [{ code: 1001, errorMessage: "Symbol not exists." }], developerMessage: null } });
/** neither real-time source has the shares asked: Robinhood quotes another, Nasdaq knows none */
const noRealTime = (): Array<[string, HttpReply]> => [["/rhj/prices", rhAnswer(NOW - 5_000, [["CRM", "234.98", "235.12"]])], ["api.nasdaq.com", NQ_NONE]];
const cboeSent = (net: { sent: Array<{ url: string }> }) => net.sent.filter((s) => s.url.includes("cboe.com")).map((s) => s.url);
const listings = async (o: { q?: string; limit: number }, net = network([...routes(), ...noRealTime()]), clock = () => NOW) => {
  const got = await usStocksPublic({ pace: async () => undefined, http: net.http, clock }).listings(o);
  if (isRefusal(got)) throw new Error(`${got.code}: ${got.message}`);
  return got;
};
/** a close's own instant, as a line stamps it */
const closeIso = (y: number, m: number, d: number) => new Date(fromEt(y, m, d, 16)).toISOString();

describe("US stocks, keyless: Nasdaq's last close where no real-time source answers", () => {
  it("lists the well-known names first, each at Nasdaq's last close — its price, the close's own instant, the delay that is never real time, the change against the day before — the session from the market calendar; read-only, a broker to connect", async () => {
    const net = network([...routes(), ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => NOW });
    const got = (await src.listings({ limit: 2 })) as Listing[];
    expect(US_SHARES.slice(0, 2)).toEqual(["NVDA", "AAPL"]);
    expect(got.map((m) => m.symbol)).toEqual(["NVDA", "AAPL"]);
    // Monday's close (340.97), stamped at Monday's 16:00, against Friday's (341); no bid or ask: a close is no book
    const closes = new Date(fromEt(2026, 10, 13, 16)).toISOString();
    expect(got[1]).toEqual({ symbol: "AAPL", name: "Apple Inc.", kind: "stock", base: "AAPL", quote: "USD", price: 340.97, quoteAt: closeIso(2026, 10, 12), delayMs: US_CLOSE_DELAY_MS, quoteFrom: NASDAQ_CLOSE_FROM, open: true, types: [], session: { open: true, closesAt: closes, phase: "regular", phaseEndsAt: closes, extendedHours: false }, note: "no real-time quote answered: the price is Nasdaq's close of Mon 12 Oct", change24h: -0.03, changePct24h: -0.0088, venueName: US_STOCKS_NAME });
    expect([NASDAQ_CLOSE_FROM, US_CLOSE_DELAY_MS]).toEqual(["Nasdaq · close", 60_000]);
    // Robinhood's token names and its one answer, Nasdaq for each share (as a stock, then as an ETF) and its daily bars once each, Nasdaq
    // Trader's directory for the names (its two files, kept twelve hours) — and nothing of Cboe's
    expect(net.sent.map((s) => s.url).filter((u) => u.includes("robinhood")).sort()).toEqual([RH_ASSETS, ROBINHOOD_PRICES]);
    expect(net.sent.filter((s) => s.url.includes("/info?"))).toHaveLength(4);
    expect(dailySent(net)).toEqual(["NVDA", "AAPL"]);
    expect(dirSent(net)).toEqual([`${NASDAQ_TRADER}/nasdaqlisted.txt`, `${NASDAQ_TRADER}/otherlisted.txt`]);
    expect(cboeSent(net)).toEqual([]);
    expect(src).toMatchObject({ id: "cboe", name: "US stocks", kind: "stocks", connectTo: "alpaca", connector: "live:alpaca" });
    expect([US_STOCKS_NAME, US_STOCKS_LINE]).toEqual(["US stocks", "US stocks · real time, else Nasdaq's last close"]);
    expect(src.readOnly).toBe(US_STOCKS_READ_ONLY);
    expect(src.readOnly).toContain("Real-time quotes from Robinhood or Nasdaq, else Nasdaq's last close — each line says which");
    expect(src.notes!({})).toEqual(["US stocks: real-time quotes (Robinhood, else Nasdaq) for 2 well-known names, else Nasdaq's last close · search any stock or ETF."]);
    expect(src.notes!({}).every((n) => n.length < 160)).toBe(true);
    expect(PUBLIC_HOSTS).toEqual(expect.arrayContaining(["api.robinhood.com", "api.nasdaq.com"]));
    expect(publicSources().map((s) => s.id)).toContain("cboe");
    expect(PUBLIC_HOSTS).toContain("www.nasdaqtrader.com");
    // the bars are kept for the close, the directory twelve hours, the token names a day, Robinhood's answer ten seconds, a symbol Nasdaq
    // does not know ten minutes: the same listing again asks nothing
    const asked = net.sent.length;
    await src.listings({ limit: 2 });
    expect(net.sent).toHaveLength(asked);
    // the directory refusing leaves the well-known their tickers for names, and the closes still answer
    const noBook = network([["/SymDir/", { status: 500, body: undefined, text: "" }], days(OCT), ...noRealTime()]);
    expect(((await usStocksPublic({ pace: async () => undefined, http: noBook.http, clock: () => NOW }).listings({ limit: 2 })) as Listing[]).map((m) => m.name)).toEqual(["NVDA", "AAPL"]);
  });

  it("a search reads Nasdaq Trader's directory: the ticker whole first, then its start, then the company; an index and a futures root are not stocks; a dotted class share is; a ticker the loaded directory lacks is asked of Nasdaq, and not listed where Nasdaq does not know it", async () => {
    const net = network([...routes(), ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => NOW });
    const app = (await src.listings({ q: "app", limit: 5 })) as Listing[];
    // APP whole, then Apple by its company's name; the company's name is the directory's, its share-class words trimmed
    expect(app.map((m) => [m.symbol, m.name])).toEqual([["APP", "Applovin Corporation Class A"], ["AAPL", "Apple Inc."]]);
    // "Apple" is five letters, so a ticker typed whole as well: Nasdaq is asked for APPLE (it knows none), and Apple Inc. is found by name
    expect(((await src.listings({ q: "Apple", limit: 5 })) as Listing[]).map((m) => [m.symbol, m.name])).toEqual([["AAPL", "Apple Inc."]]);
    expect(dirSent(net)).toEqual([`${NASDAQ_TRADER}/nasdaqlisted.txt`, `${NASDAQ_TRADER}/otherlisted.txt`]);
    // the same directory serves the well-known list's names
    expect(((await src.listings({ limit: 2 })) as Listing[]).map((m) => m.name)).toEqual(["NVIDIA Corporation", "Apple Inc."]);
    expect(((await src.listings({ q: "berk", limit: 5 })) as Listing[]).map((m) => m.symbol)).toEqual(["BRK.B"]);
    // the directory is kept twelve hours: one read of each file for every search
    expect(dirSent(net)).toHaveLength(2);
    // an index (^SPX) and a futures root (A2RZ1) are no stock: not asked for, not listed
    expect(await src.listings({ q: "A2RZ", limit: 5 })).toEqual([]);
    expect(await src.listings({ q: "^SPX", limit: 5 })).toEqual([]);
    expect(net.sent.some((s) => s.url.includes("_SPX") || s.url.includes("A2RZ1") || s.url.includes("SPX/"))).toBe(false);
    // a ticker typed whole that the loaded directory does not carry is asked of Nasdaq, which knows the tickers that trade — and Nasdaq not
    // knowing it (its quote, its daily bars), it is not listed
    expect(await src.listings({ q: "ZZZZ", limit: 5 })).toEqual([]);
    expect(net.sent.filter((s) => s.url.includes("/quote/ZZZZ/info")).map((s) => s.url.split("?")[1])).toEqual(["assetclass=stocks", "assetclass=etf"]);
    expect(cboeSent(net)).toEqual([]);
    expect(src.notes!({ q: "app" })).toEqual(["US stocks: real-time quotes from Robinhood or Nasdaq, else Nasdaq's last close, for any US stock or ETF in Nasdaq Trader's symbol directory."]);
    expect(src.notes!({ q: "app" })[0]!.length).toBeLessThan(160);
  });

  it("a search for \"BRK\" lists BRK.B with its name: a class share is found by the start of its ticker", async () => {
    const got = await listings({ q: "BRK", limit: 5 });
    expect(got.map((m) => [m.symbol, m.name])).toEqual([["BRK.B", "Berkshire Hathaway Inc. New"]]);
  });

  it("SPY is asked of Nasdaq as an ETF first: the directory says it is one", async () => {
    const net = network([...routes(), ...noRealTime()]);
    await usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => NOW }).listings({ q: "SPY", limit: 5 });
    const spy = net.sent.filter((s) => s.url.includes("/quote/SPY/")).map((s) => s.url.split("?")[1]);
    expect(spy[0]).toBe("assetclass=etf");
    // and a share the directory says is not a fund is asked as a stock first
    await usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => NOW }).listings({ q: "JPM", limit: 5 });
    expect(net.sent.filter((s) => s.url.includes("/quote/JPM/")).map((s) => s.url.split("?")[1])[0]).toBe("assetclass=stocks");
  });

  it("a ticker typed whole answers without waiting past DIR_WAIT_MS for a slow directory (it finishes loading for the next search), so the first search of AAPL is the share and not a slower source's token", async () => {
    expect(DIR_WAIT_MS).toBe(1_500);
    let dirAsked = 0;
    const fast = network([...routes(), ...noRealTime()]);
    const slow: { http: Http } = {
      http: async (url, init) => {
        if (url.includes("/SymDir/")) {
          dirAsked++;
          await new Promise((go) => setTimeout(go, 1_000));
        }
        return fast.http(url, init);
      },
    };
    const src = usStocksPublic({ pace: async () => undefined, http: slow.http, clock: () => NOW });
    const t0 = Date.now();
    const got = (await src.listings({ q: "aapl", limit: 5 })) as Listing[];
    // the two files, one after the other, take two seconds: the search answers at DIR_WAIT_MS, from the close alone
    expect(Date.now() - t0).toBeLessThan(DIR_WAIT_MS + 400);
    expect(got.map((m) => [m.symbol, m.name])).toEqual([["AAPL", "AAPL"]]);
    // a search by a company's name has to wait for the directory
    expect(((await src.listings({ q: "applovin", limit: 5 })) as Listing[]).map((m) => m.symbol)).toEqual(["APP"]);
    // the directory was read once, on its way during the first search, and kept
    expect(dirAsked).toBe(2);
    expect(((await src.listings({ q: "aapl", limit: 5 })) as Listing[]).map((m) => [m.symbol, m.name])).toEqual([["AAPL", "Apple Inc."]]);
  });

  it("past the directory's twelve hours a search does not wait for its read again beyond DIR_WAIT_MS: the last map answers it meanwhile", async () => {
    let t = NOW;
    let slowDir = false;
    const fast = network([...routes(), ...noRealTime()]);
    const http: Http = async (url, init) => {
      if (slowDir && url.includes("/SymDir/")) await new Promise((go) => setTimeout(go, 3_000));
      return fast.http(url, init);
    };
    const src = usStocksPublic({ pace: async () => undefined, http, clock: () => t });
    expect(((await src.listings({ q: "applovin", limit: 5 })) as Listing[]).map((m) => m.symbol)).toEqual(["APP"]);
    // thirteen hours on, the directory slow to answer its next read: the search answers from the map read before, within DIR_WAIT_MS
    t = NOW + 13 * 3_600_000;
    slowDir = true;
    const t0 = Date.now();
    const again = await src.listings({ q: "applovin", limit: 5 });
    expect(Date.now() - t0).toBeLessThan(DIR_WAIT_MS + 400);
    expect(isRefusal(again) ? again : again.map((m) => [m.symbol, m.name])).toEqual([["APP", "Applovin Corporation Class A"]]);
  });

  it("the directory refused at cold start: the well-known list still priced, a ticker typed whole still answered, a search by name the directory's refusal, and the notes say company names are unavailable — once it has refused, not while its first read is on its way", async () => {
    const down = network([["/SymDir/", { status: 503, body: undefined, text: "Service Unavailable" }], ...routes(), ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: down.http, clock: () => NOW });
    // no read yet: nothing said of the names
    expect(src.notes!({})).toHaveLength(1);
    // no search: US_SHARES, priced here by Nasdaq's closes, their tickers for names
    const all = (await src.listings({ limit: 2 })) as Listing[];
    expect(all.map((m) => [m.symbol, m.name, m.quoteFrom])).toEqual([["NVDA", "NVDA", NASDAQ_CLOSE_FROM], ["AAPL", "AAPL", NASDAQ_CLOSE_FROM]]);
    // a ticker typed whole: the share
    expect(((await src.listings({ q: "AAPL", limit: 5 })) as Listing[]).map((m) => m.symbol)).toEqual(["AAPL"]);
    // a company's name: no directory to find it in, so its refusal is the answer
    const apple = (await src.listings({ q: "Apple", limit: 5 })) as Refusal;
    expect(isRefusal(apple)).toBe(true);
    expect([apple.venue, apple.code]).toEqual(["nasdaqtrader", "E_VENUE_UNREACHABLE"]);
    expect(src.notes!({})).toContain("Company names are unavailable: Nasdaq Trader's symbol directory did not answer; search by ticker.");
    expect(src.notes!({ q: "apple" })).toContain("Company names are unavailable: Nasdaq Trader's symbol directory did not answer; search by ticker.");
    // the refusal is kept ten minutes: the directory was asked once (its first file refused, the second not asked)
    expect(dirSent(down)).toEqual([`${NASDAQ_TRADER}/nasdaqlisted.txt`]);
    // while the first read is still on its way, the notes say nothing of it
    const hang = network([...routes(), ...noRealTime()]);
    const slow = usStocksPublic({ pace: async () => undefined, http: (url, init) => (url.includes("/SymDir/") ? new Promise<HttpReply>(() => undefined) : hang.http(url, init)), clock: () => NOW });
    await slow.listings({ limit: 1 });
    expect(slow.notes!({})).toHaveLength(1);
  });

  it("the directory refused at cold start, Robinhood quoting AAPL (its token names served): the well-known list carries AAPL at Robinhood's price — the gate takes the well-known few before the directory answers", async () => {
    const net = network([["/SymDir/", { status: 503, body: undefined, text: "" }], ["/rhj/prices", seenMoving(rhAnswer(NOW - 5_000, [["AAPL", "341.80", "341.84"]]))], ...routes(), ["api.nasdaq.com", NQ_NONE]]);
    const src = await watched(net, NOW);
    const got = (await src.listings({ limit: 2 })) as Listing[];
    expect(got.map((m) => [m.symbol, m.quoteFrom])).toEqual([["NVDA", NASDAQ_CLOSE_FROM], ["AAPL", ROBINHOOD_FROM]]);
    expect(got[1]!.price).toBe(341.82);
  });

  it("out of the session the line says the market is closed, when it opens and whose close the price is; the delayed window (the old rule) is the session shifted by fifteen minutes", async () => {
    const night = fromEt(2026, 10, 13, 21, 0);
    const got = await listings({ limit: 1 }, network([...routes(), ...noRealTime()]), () => night);
    // by design: the session in full — the overnight session is on, and with no real-time price for it no extended-hours order is offered
    expect(got[0]!.session).toEqual({ open: false, opensAt: new Date(fromEt(2026, 10, 14, 9, 30)).toISOString(), phase: "overnight", phaseEndsAt: new Date(fromEt(2026, 10, 14, 4, 0)).toISOString(), extendedHours: false });
    expect(got[0]!.note).toBe("the US stock market is closed: it opens Wed 14 Oct, 09:30 New York; the price is Nasdaq's close of Tue 13 Oct");
    expect([got[0]!.price, got[0]!.quoteAt, got[0]!.change24h]).toEqual([181, closeIso(2026, 10, 13), 1.34]);
    expect(got[0]!.open).toBe(true);
    // the window: from 09:45 to 16:15 New York on a market day
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 9, 40))).toBe(false);
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 9, 45))).toBe(true);
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 16, 10))).toBe(true);
    expect(cboeQuoteInSession(fromEt(2026, 10, 13, 16, 15))).toBe(false);
    expect(cboeQuoteInSession(fromEt(2026, 10, 17, 12, 0))).toBe(false);
    expect(CBOE_DELAY_MS).toBe(15 * 60_000);
  });

  it("price history where Robinhood keeps none and Nasdaq keeps no minutes: the minutes and days are refused, and nothing is asked of Cboe", async () => {
    // Nasdaq keeps no daily bars of AAPL here either
    const net = network([["fromdate=", NQ_NONE], ...routes(), ...noRealTime()]);
    const src = usStocksPublic({ http: net.http, clock: () => NOW, pace: async () => undefined });
    const five = (await src.candles!("AAPL", "5m", { since: NOW - 3_600_000 })) as Refusal;
    expect(isRefusal(five)).toBe(true);
    expect(isRefusal(await src.candles!("aapl", "1h", { since: NOW - 2 * 3_600_000 }))).toBe(true);
    expect(isRefusal(await src.candles!("AAPL", "1d", { since: fromEt(2026, 10, 1) }))).toBe(true);
    expect(cboeSent(net)).toEqual([]);
    expect((await src.candles!("^SPX", "1h", { since: NOW - 3_600_000 }) as Refusal).code).toBe("E_ACCOUNT_BAD_ACTION");
  });

  it("Nasdaq refusing this network — a 451 — off-hours is its answer for the whole listing, held back as any public source's is; one share's daily read refused beside others answering leaves that line out", async () => {
    const saturday = fromEt(2026, 10, 17, 12, 0);
    const blocked = network([["api.nasdaq.com", { status: 451, body: undefined, text: "unavailable for legal reasons" }], ...dirRoutes(), ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: blocked.http, clock: () => saturday });
    const r = (await src.listings({ limit: 2 })) as Refusal;
    expect(r.code).toBe("E_VENUE_GEOBLOCKED");
    expect(r.message).toBe("Nasdaq does not serve this location: that is its own rule, and the market does not look for a way around it");
    // held ten minutes (Nasdaq's refusal, and each daily read's): the next listing asks Nasdaq nothing
    const asked = blocked.sent.filter((s) => s.url.includes("api.nasdaq.com")).length;
    expect(isRefusal(await src.listings({ limit: 2 }))).toBe(true);
    expect(blocked.sent.filter((s) => s.url.includes("api.nasdaq.com"))).toHaveLength(asked);
    const some = network([["/NVDA/chart?", { status: 500, body: undefined, text: "" }], days(OCT), ...dirRoutes(), ...noRealTime()]);
    expect(((await usStocksPublic({ pace: async () => undefined, http: some.http, clock: () => saturday }).listings({ limit: 2 })) as Listing[]).map((m) => m.symbol)).toEqual(["AAPL"]);
  });
});

describe("US stocks off-hours and between turns: Nasdaq's last close, dated, never fillable — and no request to Cboe", () => {
  /** Monday 23 November 2026, 21:58 New York: the overnight session, the market closed for every share Robinhood does not price */
  const MON_NIGHT = fromEt(2026, 11, 23, 21, 58);
  const nightNet = (extra: Array<[string, HttpReply | ((url: string) => HttpReply)]> = []) => network([...extra, days(NOV), ...dirRoutes(), ...noRealTime()]);

  it("off-hours: every line is Nasdaq's last close, dated, never fillable", async () => {
    const net = nightNet();
    const got = (await usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => MON_NIGHT }).listings({ q: "AAPL", limit: 1 })) as Listing[];
    const aapl = got[0]!;
    expect([aapl.symbol, aapl.price, aapl.quoteFrom, aapl.delayMs]).toEqual(["AAPL", 349.08, "Nasdaq · close", 60_000]);
    expect(aapl.quoteAt).toBe(new Date(fromEt(2026, 11, 23, 16, 0)).toISOString());
    // 349.08 - 342.56, Friday's close
    expect(aapl.change24h).toBe(6.52);
    expect(aapl.changePct24h).toBe(1.9033);
    expect(aapl.bid).toBeUndefined();
    expect(aapl.session!.extendedHours).toBe(false);
    expect(aapl.note!.endsWith(`the price is Nasdaq's close of ${etDate(fromEt(2026, 11, 23, 16, 0))}`)).toBe(true);
    expect(aapl.note).toBe("the US stock market is closed: it opens Tue 24 Nov, 09:30 New York; the price is Nasdaq's close of Mon 23 Nov");
    // the bars by dates: ten days back from the close, as Nasdaq's chart page asks them
    expect(net.sent.filter((s) => s.url.includes("fromdate=")).map((s) => s.url.split("?")[1])).toEqual(["assetclass=stocks&fromdate=2026-11-13&todate=2026-11-23"]);
    expect(cboeSent(net)).toEqual([]);
  });

  it("a weekend reads the Friday close once", async () => {
    const net = nightNet();
    let t = fromEt(2026, 11, 21, 12, 0);
    const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => t });
    const sat = (await src.listings({ limit: 2 })) as Listing[];
    expect(sat.map((m) => [m.symbol, m.price, m.quoteAt])).toEqual([["NVDA", 180, closeIso(2026, 11, 20)], ["AAPL", 342.56, closeIso(2026, 11, 20)]]);
    expect(sat[1]!.session!.phase).toBe("closed");
    t = fromEt(2026, 11, 22, 12, 0);
    const sun = (await src.listings({ limit: 2 })) as Listing[];
    expect(sun.map((m) => m.price)).toEqual([180, 342.56]);
    expect(dailySent(net).sort()).toEqual(["AAPL", "NVDA"]);
    expect(cboeSent(net)).toEqual([]);
  });

  it("one unknown share off-hours is left out, the rest listed", async () => {
    const net = nightNet();
    const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => MON_NIGHT });
    // MSFT, third of the well-known, has no bars here (Nasdaq: "Symbol not exists.")
    const got = await src.listings({ limit: 3 });
    expect(isRefusal(got)).toBe(false);
    expect((got as Listing[]).map((m) => m.symbol)).toEqual(["NVDA", "AAPL"]);
    // a ticker no one knows: no line, not a refusal
    expect(await src.listings({ q: "ZZZZ", limit: 5 })).toEqual([]);
  });

  it("in session, a line the chain did not price shows the held close", async () => {
    // Monday 10:00: Robinhood prices none of them; Nasdaq prices any share it is asked, eight at a time — the ninth (SPY) waits its turn
    const at = fromEt(2026, 11, 23, 10, 0);
    let t = at;
    const info = (url: string) => {
      const s = symOf(url);
      return json({ data: { symbol: s, primaryData: { lastSalePrice: "$100.50", netChange: "+1.00", percentageChange: "+1.00%", lastTradeTimestamp: "Nov 23, 2026 9:59 AM ET", isRealTime: true, bidPrice: "$100.49", askPrice: "$100.51" }, secondaryData: null }, message: null, status: { rCode: 200 } });
    };
    const net = network([["/info?", info], days(NOV), ...dirRoutes(), ["/rhj/prices", rhAnswer(at - 5_000, [["CRM", "234.98", "235.12"]])]]);
    const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => t });
    const first = (await src.listings({ limit: 9 })) as Listing[];
    expect(first.map((m) => m.symbol)).toEqual(US_SHARES.slice(0, 9));
    expect(first.slice(0, 8).every((m) => m.quoteFrom === NASDAQ_FROM)).toBe(true);
    const spy = first[8]!;
    expect([spy.symbol, spy.quoteFrom, spy.price, spy.quoteAt, spy.delayMs]).toEqual(["SPY", NASDAQ_CLOSE_FROM, 655, closeIso(2026, 11, 20), US_CLOSE_DELAY_MS]);
    expect(spy.note).toBe("no real-time quote answered: the price is Nasdaq's close of Fri 20 Nov");
    expect(spy.session!.phase).toBe("regular");
    expect(dailySent(net)).toEqual(["SPY"]);
    // ten seconds on, SPY is asked first and is Nasdaq's; the others' answers are still recent
    t = at + 10_000;
    const next = (await src.listings({ limit: 9 })) as Listing[];
    expect(next.map((m) => m.quoteFrom)).toEqual(Array(9).fill(NASDAQ_FROM));
    // a share whose bars are held, the chain not pricing it: the held close, no read again
    t = at + 20_000;
    const held = network([["/info?", { status: 500, body: undefined, text: "" }], days(NOV), ...dirRoutes(), ["/rhj/prices", rhAnswer(at - 5_000, [["CRM", "234.98", "235.12"]])]]);
    const src2 = usStocksPublic({ pace: async () => undefined, http: held.http, clock: () => t });
    expect(((await src2.listings({ q: "SPY", limit: 1 })) as Listing[])[0]!.quoteFrom).toBe(NASDAQ_CLOSE_FROM);
    t += 10_000;
    expect(((await src2.listings({ q: "SPY", limit: 1 })) as Listing[])[0]!.quoteFrom).toBe(NASDAQ_CLOSE_FROM);
    expect(dailySent(held)).toEqual(["SPY"]);
  });

  it("Nasdaq held back in session: a Robinhood line stands, a share with bars held is its close; nothing priced and nothing held is the 429's refusal", async () => {
    const at = fromEt(2026, 11, 23, 10, 0);
    const clock = { t: at };
    let refuse = false;
    // Nasdaq's quote page first not answering (a 500: no hold), its daily bars answering
    const base = network([["/info?", { status: 500, body: undefined, text: "" }], ["/rhj/prices", seenMoving(rhAnswer(at - 5_000, [["AAPL", "341.80", "341.84"]]))], days(NOV), ...dirRoutes()]);
    const http: Http = async (url, init) => (refuse && url.includes("api.nasdaq.com") ? { status: 429, body: undefined, text: "Too Many Requests" } : base.http(url, init));
    const src = await watched({ http }, at, clock);
    const before = (await src.listings({ limit: 2 })) as Listing[];
    expect(before.map((m) => [m.symbol, m.quoteFrom])).toEqual([["NVDA", NASDAQ_CLOSE_FROM], ["AAPL", ROBINHOOD_FROM]]);
    // Nasdaq says to wait: AAPL Robinhood's, NVDA its held close (Friday's)
    refuse = true;
    clock.t = at + 10_000;
    const during = (await src.listings({ limit: 2 })) as Listing[];
    expect(during.map((m) => [m.symbol, m.quoteFrom, m.price])).toEqual([["NVDA", NASDAQ_CLOSE_FROM, 180], ["AAPL", ROBINHOOD_FROM, 341.82]]);
    // a source that holds nothing, Robinhood pricing none of it: the 429's refusal, not an empty list
    const fresh = network([["api.nasdaq.com", { status: 429, body: undefined, text: "Too Many Requests" }], ...dirRoutes(), ["/rhj/prices", rhAnswer(at - 5_000, [["CRM", "234.98", "235.12"]])]]);
    const r = (await usStocksPublic({ pace: async () => undefined, http: fresh.http, clock: () => at }).listings({ q: "NVDA", limit: 1 })) as Refusal;
    expect(isRefusal(r)).toBe(true);
    expect([r.venue, r.code, (r.native as { status?: number }).status]).toEqual(["nasdaq", "E_VENUE_UNREACHABLE", 429]);
  });

  it("a Robinhood line in the regular session carries its change from the daily bars' close", async () => {
    const at = fromEt(2026, 11, 23, 10, 0);
    const net = network([["/rhj/prices", seenMoving(rhAnswer(at - 5_000, [["AAPL", "341.80", "341.84"]]))], days(NOV), ...dirRoutes(), ["api.nasdaq.com", NQ_NONE]]);
    const src = await watched(net, at);
    const aapl = ((await src.listings({ q: "AAPL", limit: 1 })) as Listing[])[0]!;
    // no Nasdaq answer kept: 341.82 less Friday's close (342.56)
    expect([aapl.quoteFrom, aapl.price, aapl.change24h, aapl.changePct24h]).toEqual([ROBINHOOD_FROM, 341.82, -0.74, -0.216]);
    expect(dailySent(net)).toEqual(["AAPL"]);
    expect(net.sent.some((s) => s.url.includes("/quote/AAPL/info"))).toBe(false);
    // the bars are kept for the close: the next read asks none
    await src.listings({ q: "AAPL", limit: 1 });
    expect(dailySent(net)).toEqual(["AAPL"]);
  });

  it("line(\"BRK.B\") off-hours is its last close", async () => {
    const net = nightNet();
    const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => MON_NIGHT });
    const brk = (await src.line!("BRK.B")) as Listing;
    expect(brk).toMatchObject({ symbol: "BRK.B", name: "Berkshire Hathaway Inc. New", price: 501, quoteAt: closeIso(2026, 11, 23), delayMs: US_CLOSE_DELAY_MS, quoteFrom: NASDAQ_CLOSE_FROM, change24h: 3 });
    expect(brk.session!.extendedHours).toBe(false);
    expect(dailySent(net)).toEqual(["BRK.B"]);
    expect(cboeSent(net)).toEqual([]);
    // a share Nasdaq has no bars of: no line
    expect(await src.line!("ZZZZ")).toBeNull();
  });
});

describe("US stocks in real time: Robinhood's quote, else Nasdaq's, else Nasdaq's last close — each line saying which", () => {
  /** Nasdaq's info for a share, in its shape (live/us-quotes.ts): its strings, its stamp to the minute */
  const nqInfo = (symbol: string, last: string, bid: string, ask: string, stamp: string, extra: Rec = {}) =>
    json({ data: { symbol, companyName: `${symbol} Common Stock`, primaryData: { lastSalePrice: `$${last}`, netChange: "+3.39", percentageChange: "+1.02%", lastTradeTimestamp: stamp, isRealTime: true, bidPrice: `$${bid}`, askPrice: `$${ask}`, bidSize: "53", askSize: "30", volume: "4,564,263", currency: null }, secondaryData: null, marketStatus: "Open", assetClass: "STOCKS", ...extra }, message: null, status: { rCode: 200 } });
  const nq = (sym: string, cls = "stocks", what = "info") => `https://api.nasdaq.com/api/quote/${sym}/${what}?assetclass=${cls}`;
  /** Robinhood quotes NVDA and AAPL (stamped `at`); Nasdaq knows JPM; Nasdaq's daily bars for each (October's), and for BRK.B, which
   * neither real-time source prices */
  const live = (at: number, extra: Array<[string, HttpReply | ((url: string) => HttpReply)]> = []): ReturnType<typeof routes> => [
    ...extra,
    ["/rhj/prices", seenMoving(rhAnswer(at - 5_000, [["NVDA", "180.48", "180.52"], ["AAPL", "341.80", "341.84"]]))],
    [nq("JPM"), nqInfo("JPM", "334.82", "334.80", "334.85", "Oct 13, 2026 10:29 AM ET")],
    ...routes(),
    ["api.nasdaq.com", NQ_NONE],
  ];

  it("prices each line from the real-time chain first: Robinhood's bid and ask with its stamp, no delay, and its change from the daily bars' close; Nasdaq's last trade with its own change; Nasdaq's last close only where neither priced", async () => {
    const net = network(live(NOW));
    const src = await watched(net, NOW);
    const first = (await src.listings({ q: "AAPL", limit: 1 })) as Listing[];
    const closes = new Date(fromEt(2026, 10, 13, 16)).toISOString();
    // the change is Robinhood's price less Monday's close from Nasdaq's daily bars (340.97): 0.85 — the price less the change is the close
    expect(first).toEqual([{ symbol: "AAPL", name: "Apple Inc.", kind: "stock", base: "AAPL", quote: "USD", price: 341.82, bid: 341.8, ask: 341.84, quoteAt: new Date(NOW - 5_000).toISOString(), delayMs: 0, quoteFrom: ROBINHOOD_FROM, open: true, types: [], session: { open: true, closesAt: closes, phase: "regular", phaseEndsAt: closes, extendedHours: false }, change24h: 0.85, changePct24h: 0.2493, venueName: US_STOCKS_NAME }]);
    // Nasdaq was not asked for a share Robinhood priced; its daily bars once, for the close
    expect(net.sent.some((s) => s.url.includes("/quote/AAPL/info"))).toBe(false);
    expect(dailySent(net)).toEqual(["AAPL"]);
    // JPM: Nasdaq's, its own change, and no daily read for it
    const jpm = ((await src.listings({ q: "JPM", limit: 1 })) as Listing[])[0]!;
    expect(jpm).toMatchObject({ symbol: "JPM", price: 334.82, bid: 334.8, ask: 334.85, quoteAt: new Date(fromEt(2026, 10, 13, 10, 29)).toISOString(), delayMs: 0, quoteFrom: NASDAQ_FROM, venueName: US_STOCKS_NAME, change24h: 3.39, changePct24h: 1.02 });
    expect(dailySent(net)).toEqual(["AAPL"]);
    // BRK.B: neither priced it, so Monday's close, a day old, stamped at the close
    const brk = ((await src.listings({ q: "BRK.B", limit: 1 })) as Listing[])[0]!;
    expect(brk).toMatchObject({ symbol: "BRK.B", price: 520.11, quoteAt: closeIso(2026, 10, 12), delayMs: US_CLOSE_DELAY_MS, quoteFrom: NASDAQ_CLOSE_FROM, venueName: US_STOCKS_NAME, change24h: 1.11 });
    expect(cboeSent(net)).toEqual([]);
    expect(src.sessions).toBe(usClock);
  });

  it("the well-known names in one pass: Robinhood's one answer for all, Nasdaq only for what it does not price, the daily bars for each line's close", async () => {
    const net = network(live(NOW));
    const got = (await (await watched(net, NOW)).listings({ limit: 2 })) as Listing[];
    expect(got.map((m) => [m.symbol, m.quoteFrom, m.change24h])).toEqual([["NVDA", ROBINHOOD_FROM, 0.84], ["AAPL", ROBINHOOD_FROM, 0.85]]);
    // Robinhood's answer as it was just written serves both (kept until its next write): no GET of it here, nor of Nasdaq's quote page
    expect(net.sent.filter((s) => s.url === ROBINHOOD_PRICES)).toHaveLength(0);
    expect(net.sent.some((s) => s.url.includes("/info?"))).toBe(false);
    expect(dailySent(net)).toEqual(["NVDA", "AAPL"]);
    // Robinhood stale: Nasdaq is asked (and knows neither here), and both are Monday's close
    const stale = network(live(NOW - 3 * 60_000));
    const old = (await (await watched(stale, NOW)).listings({ limit: 2 })) as Listing[];
    expect(old.map((m) => [m.symbol, m.quoteFrom])).toEqual([["NVDA", NASDAQ_CLOSE_FROM], ["AAPL", NASDAQ_CLOSE_FROM]]);
    expect(stale.sent.filter((s) => s.url.includes("/info?"))).toHaveLength(4);
    // the daily bars refused beside Robinhood's prices: the lines Robinhood priced, with no day's change, not a refusal
    const barsDown = network([["fromdate=", { status: 503, body: undefined, text: "" }], ...live(NOW)]);
    const without = (await (await watched(barsDown, NOW)).listings({ limit: 2 })) as Listing[];
    expect(without.map((m) => [m.symbol, m.price, m.changePct24h])).toEqual([["NVDA", 180.5, undefined], ["AAPL", 341.82, undefined]]);
  });

  it("the session on each line: pre-market and after-hours offer an extended-hours limit where a real-time source priced the line, and say whose price it is and from when; overnight only a share Robinhood priced; closed, Nasdaq's close", async () => {
    expect(ROBINHOOD_OVERNIGHT).toBe(OVERNIGHT_IN_QUOTES);
    const read = async (at: number, q: string, extra: Array<[string, HttpReply]> = []) => ((await (await watched(network(live(at, extra)), at)).listings({ q, limit: 1 })) as Listing[])[0]!;
    // pre-market, Tuesday 13 October 08:00 EDT: Robinhood's AAPL
    const pre = fromEt(2026, 10, 13, 8, 0);
    const a = await read(pre, "AAPL");
    expect(a.session).toEqual({ open: false, opensAt: new Date(fromEt(2026, 10, 13, 9, 30)).toISOString(), phase: "pre", phaseEndsAt: new Date(fromEt(2026, 10, 13, 9, 30)).toISOString(), extendedHours: true });
    expect(a.note).toBe("pre-market trading is on until 09:30 New York: the price is Robinhood's real-time quote; the regular session opens Tue 13 Oct, 09:30 New York");
    // its change from Monday's close, as the daily bars say it
    expect([a.change24h, a.changePct24h]).toEqual([0.85, 0.2493]);
    // at 09:35 on Wednesday, from Tuesday's close
    const opening = await read(fromEt(2026, 10, 14, 9, 35), "AAPL");
    expect([opening.quoteFrom, opening.session!.phase, opening.change24h]).toEqual([ROBINHOOD_FROM, "regular", 1.32]);
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
    // BRK.B at Nasdaq's close, said so — and no extended-hours order offered beside it: a paper account never fills one at a close
    const brk = await read(after, "BRK.B");
    expect([brk.quoteFrom, brk.session!.extendedHours]).toEqual([NASDAQ_CLOSE_FROM, false]);
    expect(brk.note).toBe("after-hours trading is on until 20:00 New York, but no real-time quote answered: the price is Nasdaq's close of Tue 13 Oct; the regular session opens Wed 14 Oct, 09:30 New York");
    // overnight, 22:00: Robinhood's AAPL may take an extended-hours limit; JPM (Nasdaq keeps no overnight session) is Nasdaq's close and may not
    const night = fromEt(2026, 10, 13, 22, 0);
    const na = await read(night, "AAPL");
    expect([na.quoteFrom, na.session!.phase, na.session!.extendedHours]).toEqual([ROBINHOOD_FROM, "overnight", true]);
    expect(na.note).toBe("the overnight session is on until 04:00 New York: the price is Robinhood's real-time quote; the regular session opens Wed 14 Oct, 09:30 New York");
    const nj = await read(night, "JPM");
    expect([nj.quoteFrom, nj.session!.phase, nj.session!.extendedHours, nj.note]).toEqual([NASDAQ_CLOSE_FROM, "overnight", false, "the US stock market is closed: it opens Wed 14 Oct, 09:30 New York; the price is Nasdaq's close of Tue 13 Oct"]);
    // Saturday: closed; no real-time source is asked, Nasdaq's last close (the bars here end on Tuesday: Tuesday's, dated so)
    const saturday = fromEt(2026, 10, 17, 12, 0);
    const sat = network(live(saturday));
    const s = ((await usStocksPublic({ pace: async () => undefined, http: sat.http, clock: () => saturday }).listings({ q: "AAPL", limit: 1 })) as Listing[])[0]!;
    expect([s.quoteFrom, s.session!.phase, s.session!.extendedHours, s.quoteAt]).toEqual([NASDAQ_CLOSE_FROM, "closed", false, closeIso(2026, 10, 13)]);
    expect(sat.sent.some((x) => x.url.includes("/rhj/prices") || x.url.includes("/info?"))).toBe(false);
    // the day after Thanksgiving, 14:00 EST: the early close's after-hours, to 17:00
    const early = fromEt(2026, 11, 27, 14, 0);
    const e = await read(early, "AAPL");
    expect(e.session).toEqual({ open: false, opensAt: new Date(fromEt(2026, 11, 30, 9, 30)).toISOString(), phase: "after", phaseEndsAt: new Date(fromEt(2026, 11, 27, 17, 0)).toISOString(), extendedHours: true });
    expect(e.note).toBe("after-hours trading is on until 17:00 New York: the price is Robinhood's real-time quote; the regular session opens Mon 30 Nov, 09:30 New York");
  });

  it("price history where Robinhood keeps none: Nasdaq's one-price-a-minute samples alone, folded into 5m and 1h bars at their real instants, no volume said; Nasdaq refusing, or keeping no minutes, is a refusal; nothing is asked of Cboe", async () => {
    // Nasdaq's points on Tuesday 13 October: 04:00, 04:01 and 04:07 in pre-market, 09:31 and 09:38 in the session, 10:28 (x written as New York's wall clock)
    const wall = (h: number, m: number) => Date.UTC(2026, 9, 13, h, m);
    const chart = json({ data: { symbol: "AAPL", timeAsOf: "Oct 13, 2026 10:30 AM ET", chart: [[4, 0, 342.21], [4, 1, 341.77], [4, 7, 343.08], [9, 31, 346.97], [9, 38, 347.9], [10, 28, 349]].map(([h, m, y]) => ({ z: { dateTime: `${h}:${String(m).padStart(2, "0")} AM ET`, value: String(y) }, x: wall(h!, m!), y })) } });
    const net = network(live(NOW, [[nq("AAPL", "stocks", "chart"), chart]]));
    const src = usStocksPublic({ http: net.http, clock: () => NOW, pace: async () => undefined });
    const p = (await src.candles!("AAPL", "5m", { since: fromEt(2026, 10, 13, 0, 0) })) as CandlePage;
    expect(p.bars).toEqual([
      { t: fromEt(2026, 10, 13, 4, 0), o: 342.21, h: 342.21, l: 341.77, c: 341.77 },
      { t: fromEt(2026, 10, 13, 4, 5), o: 343.08, h: 343.08, l: 343.08, c: 343.08 },
      { t: fromEt(2026, 10, 13, 9, 30), o: 346.97, h: 346.97, l: 346.97, c: 346.97 },
      { t: fromEt(2026, 10, 13, 9, 35), o: 347.9, h: 347.9, l: 347.9, c: 347.9 },
      { t: fromEt(2026, 10, 13, 10, 25), o: 349, h: 349, l: 349, c: 349 },
    ]);
    expect(p.source).toBe("Nasdaq · one-price-a-minute samples · AAPL");
    const hour = ((await src.candles!("AAPL", "1h", { since: fromEt(2026, 10, 13, 0, 0) })) as CandlePage).bars;
    expect(hour.map((b) => b.v)).toEqual([undefined, undefined, undefined]);
    expect(hour.map((b) => b.t)).toEqual([fromEt(2026, 10, 13, 4, 0), fromEt(2026, 10, 13, 9, 0), fromEt(2026, 10, 13, 10, 0)]);
    expect(cboeSent(net)).toEqual([]);
    // Nasdaq's edge refusing, and Robinhood: Robinhood's refusal, the source asked first
    const refused = network(live(NOW, [["/chart?", { status: 403, body: undefined, text: "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>" }]]));
    const r = (await usStocksPublic({ http: refused.http, clock: () => NOW, pace: async () => undefined }).candles!("AAPL", "5m", { since: NOW - 3_600_000 })) as Refusal;
    expect(isRefusal(r)).toBe(true);
    expect(cboeSent(refused)).toEqual([]);
    const neither = network([["/chart?", { status: 403, body: undefined, text: "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>" }], ...live(NOW)]);
    expect(((await usStocksPublic({ http: neither.http, clock: () => NOW, pace: async () => undefined }).candles!("AAPL", "1h", { since: NOW - 3_600_000 })) as Refusal).message).toBe("Robinhood keeps no history of AAPL");
  });

  it("SATS takes no Robinhood quote, AAPL does: the gate is the directory's name beside the token's — SATS is EchoStar's token, while the directory's SATS is Strive's preferred stock; EchoStar's share is ECHO", async () => {
    // Robinhood's SATS book seen moving and fresh: only the names keep it out
    const routesOf = (dir: Array<[string, HttpReply]>): Array<[string, HttpReply | ((url: string) => HttpReply)]> => [["/rhj/prices", seenMoving(rhAnswer(NOW - 5_000, [["SATS", "87.87", "87.93"], ["AAPL", "341.80", "341.84"]]))], [nq("ECHO"), nqInfo("ECHO", "87.90", "87.88", "87.92", "Oct 13, 2026 10:29 AM ET")], days(OCT), ["api.nasdaq.com", NQ_NONE], ...dir];
    const net = network(routesOf(dirRoutes()));
    const src = await watched(net, NOW);
    // SATS: the directory lists it, but "EchoStar" and "Strive, Inc. … SATS Preferred Stock" name two companies — not Robinhood's price
    const sats = (await src.listings({ q: "SATS", limit: 5 })) as Listing[];
    expect(sats.map((m) => m.quoteFrom)).not.toContain(ROBINHOOD_FROM);
    expect(sats.some((m) => m.price === 87.9)).toBe(false);
    expect(((await src.listings({ q: "AAPL", limit: 1 })) as Listing[]).map((m) => [m.symbol, m.name, m.quoteFrom, m.price])).toEqual([["AAPL", "Apple Inc.", ROBINHOOD_FROM, 341.82]]);
    expect(((await src.listings({ q: "ECHO", limit: 5 })) as Listing[]).map((m) => [m.symbol, m.name, m.quoteFrom, m.price])).toEqual([["ECHO", "EchoStar Corporation", NASDAQ_FROM, 87.9]]);
    // one share's line says the same
    expect(await src.line!("SATS")).toBeNull();
    expect(((await src.line!("AAPL")) as Listing).quoteFrom).toBe(ROBINHOOD_FROM);
    // the directory not answering: Robinhood's quote only for the well-known few (US_SHARES), so still none for SATS — nothing prices it,
    // and the directory's refusal says why no name was found
    const noDir = network(routesOf([["/SymDir/", { status: 500, body: undefined, text: "" }], ["/rhj/assets", TOKEN_NAMES]]));
    const dead = await (await watched(noDir, NOW)).listings({ q: "SATS", limit: 5 });
    expect(isRefusal(dead) ? dead.venue : dead.map((m) => m.quoteFrom)).toBe("nasdaqtrader");
  });

  it("the real-time chain hanging leaves Nasdaq's closes within RT_WAIT_MS; the daily bars hanging leave the chain's lines, without a change, within CLOSE_WAIT_MS — inside the callers' four seconds", async () => {
    expect(CLOSE_WAIT_MS).toBe(2_500);
    const hang = () => new Promise<HttpReply>(() => undefined);
    const base = network(live(NOW));
    const t0 = Date.now();
    const quiet = (await usStocksPublic({ pace: async () => undefined, http: (url, init) => (url.includes("/rhj/prices") || url.includes("/info?") ? hang() : base.http(url, init)), clock: () => NOW }).listings({ q: "AAPL", limit: 5 })) as Listing[];
    expect(Date.now() - t0).toBeLessThan(RT_WAIT_MS + 500);
    expect(quiet.map((m) => [m.symbol, m.quoteFrom])).toEqual([["AAPL", NASDAQ_CLOSE_FROM]]);
    const slowSrc = await watched({ http: (url, init) => (url.includes("fromdate=") ? hang() : base.http(url, init)) }, NOW);
    const t1 = Date.now();
    const slow = (await slowSrc.listings({ q: "AAPL", limit: 5 })) as Listing[];
    expect(Date.now() - t1).toBeLessThan(CLOSE_WAIT_MS + 500);
    expect(slow.map((m) => [m.symbol, m.quoteFrom, m.change24h])).toEqual([["AAPL", ROBINHOOD_FROM, undefined]]);
  });

  it("NASDAQ ANSWERS ONCE AND THEN SAYS TO WAIT (a 429, for minutes): never Nasdaq's answer from before, said as real time — with no close held for the share, the 429 is the answer, for the listing and for one share's line (what a paper account prices by)", async () => {
    let t = NOW;
    let refuse = false;
    const base = network(live(NOW));
    const http: Http = async (url, init) => (refuse && url.includes("api.nasdaq.com") ? { status: 429, body: undefined, text: "Too Many Requests" } : base.http(url, init));
    const src = usStocksPublic({ pace: async () => undefined, http, clock: () => t });
    expect(((await src.listings({ q: "JPM", limit: 1 })) as Listing[])[0]).toMatchObject({ symbol: "JPM", price: 334.82, quoteFrom: NASDAQ_FROM, delayMs: 0 });
    refuse = true;
    // ten seconds on, and three minutes on (the answer before then older than FRESH_MS as well)
    for (const later of [10_000, 3 * 60_000]) {
      t = NOW + later;
      const r = (await src.listings({ q: "JPM", limit: 1 })) as Refusal;
      expect([isRefusal(r), r.message]).toEqual([true, "Nasdaq is rate-limiting this machine: try again in a minute"]);
      expect(((await src.line!("JPM")) as Refusal).message).toBe("Nasdaq is rate-limiting this machine: try again in a minute");
    }
  });

  describe("the day's change outside the regular session, and early in it, whoever priced the line (why-it-moved task 6)", () => {
    const round2 = (v: number) => Math.round(v * 100) / 100;
    /** AAPL's daily bars without Tuesday's (as right after the close, before Nasdaq's chart has the day's bar) */
    const noTuesday: [string, HttpReply] = ["/quote/AAPL/chart?assetclass=stocks&fromdate=", daysOf("AAPL", [["10/09/2026", 341], ["10/12/2026", 340.97]])];
    /** a source watched at `at` (Robinhood's AAPL at 341.80/341.84, so 341.82), read for AAPL twice */
    const settled = async (at: number, extra: Array<[string, HttpReply]>, q = "AAPL") => {
      const net = network(live(at, extra));
      const src = await watched(net, at);
      await src.listings({ q, limit: 1 });
      await new Promise((go) => setTimeout(go, 0));
      return { line: ((await src.listings({ q, limit: 1 })) as Listing[])[0]!, net };
    };

    it("a Robinhood-priced row in after-hours carries its change from that day's close", async () => {
      // Tuesday 17:00: Nasdaq's daily bars have Tuesday's (340.50)
      const { line, net } = await settled(fromEt(2026, 10, 13, 17, 0), []);
      expect([line.quoteFrom, line.session!.phase, line.price]).toEqual([ROBINHOOD_FROM, "after", 341.82]);
      // 341.82 - 340.50 — not from Monday's close (340.97), which the regular session's change is measured from
      expect([line.change24h, line.changePct24h]).toEqual([1.32, 0.3877]);
      // the price less the change is the reference close, as the face reads it (prev_close = price - change)
      expect(round2(line.price! - line.change24h!)).toBe(340.5);
      // Nasdaq's quote page is not asked for a share Robinhood priced, nor its bars a second time
      expect(net.sent.some((s) => s.url.includes("/quote/AAPL/info"))).toBe(false);
      expect(dailySent(net)).toEqual(["AAPL"]);
    });

    it("a Robinhood-priced row in pre-market carries its change from the previous close", async () => {
      const { line } = await settled(fromEt(2026, 10, 14, 8, 0), []);
      expect([line.quoteFrom, line.session!.phase]).toEqual([ROBINHOOD_FROM, "pre"]);
      expect([line.change24h, line.changePct24h]).toEqual([1.32, 0.3877]);
    });

    it("a Robinhood-priced row early in the regular session, and later in it, carries its change from the previous close", async () => {
      const { line } = await settled(fromEt(2026, 10, 14, 9, 35), []);
      expect([line.quoteFrom, line.session!.phase]).toEqual([ROBINHOOD_FROM, "regular"]);
      expect([line.change24h, line.changePct24h]).toEqual([1.32, 0.3877]);
      const later = await settled(fromEt(2026, 10, 14, 10, 30), []);
      expect([later.line.quoteFrom, later.line.change24h, later.line.changePct24h]).toEqual([ROBINHOOD_FROM, 1.32, 0.3877]);
    });

    it("Nasdaq's kept answer for the share wins over the daily bars where they disagree: its change is measured from the official close", async () => {
      // the first read, 15 s before, finds Robinhood's book first seen (not taken) and asks Nasdaq, which answers: 341.70, +3.39 from
      // the close, so 338.31; the second, Robinhood's book moved, is Robinhood's — and Nasdaq's answer is still recent
      const at = fromEt(2026, 10, 13, 17, 0);
      const net = network(live(at, [[nq("AAPL"), nqInfo("AAPL", "341.70", "341.65", "341.75", "Oct 13, 2026 4:58 PM ET")]]));
      let t = at - 15_000;
      const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => t });
      const first = ((await src.listings({ q: "AAPL", limit: 1 })) as Listing[])[0]!;
      expect(first.quoteFrom).toBe(NASDAQ_FROM);
      await new Promise((go) => setTimeout(go, 0));
      t = at;
      const line = ((await src.listings({ q: "AAPL", limit: 1 })) as Listing[])[0]!;
      expect(line.quoteFrom).toBe(ROBINHOOD_FROM);
      // 341.82 - 338.31, not 341.82 - 340.50 (the daily bars' close)
      expect(line.change24h).toBe(3.51);
      expect(line.changePct24h).toBe(1.0375);
      // a Nasdaq trade stamped 4:00 PM may be the regular session's closing print, its change from Monday's close: not taken, the bars' is
      const closing = network(live(at, [[nq("AAPL"), nqInfo("AAPL", "341.70", "341.65", "341.75", "Oct 13, 2026 4:00 PM ET")]]));
      t = at - 15_000;
      const again = usStocksPublic({ pace: async () => undefined, http: closing.http, clock: () => t });
      await again.listings({ q: "AAPL", limit: 1 });
      await new Promise((go) => setTimeout(go, 0));
      t = at;
      const fromBars = ((await again.listings({ q: "AAPL", limit: 1 })) as Listing[])[0]!;
      expect([fromBars.quoteFrom, fromBars.change24h]).toEqual([ROBINHOOD_FROM, 1.32]);
    });

    it("a Nasdaq-priced after-hours row keeps Nasdaq's change from that day's close", async () => {
      // JPM traded at 16:58: Nasdaq's own change (+3.39, +1.02%), not one worked out from the daily bars
      const { line } = await settled(fromEt(2026, 10, 13, 17, 0), [[nq("JPM"), nqInfo("JPM", "334.90", "334.85", "334.95", "Oct 13, 2026 4:58 PM ET")]], "JPM");
      expect([line.quoteFrom, line.session!.phase, line.change24h, line.changePct24h]).toEqual([NASDAQ_FROM, "after", 3.39, 1.02]);
    });

    it("a Robinhood row right after the close, before the daily bars have the day, takes its close from one Nasdaq read, kept for the close", async () => {
      // Tuesday 16:03: Nasdaq's chart has no bar of Tuesday's yet
      const at = fromEt(2026, 10, 13, 16, 3);
      const nqAsked = (net: { sent: Array<{ url: string }> }) => net.sent.filter((x) => x.url.includes("/quote/AAPL/info")).length;
      // Nasdaq's last trade stamped 4:00 PM — the closing print, its change from Monday's close — is the session's close: 340.75
      const print = await settled(at, [[nq("AAPL"), nqInfo("AAPL", "340.75", "340.70", "340.80", "Oct 13, 2026 4:00 PM ET")], noTuesday]);
      expect([print.line.quoteFrom, print.line.session!.phase, print.line.change24h, print.line.changePct24h]).toEqual([ROBINHOOD_FROM, "after", 1.07, 0.314]);
      expect(nqAsked(print.net)).toBe(1);
      // secondaryData's close wins over a later after-hours trade's price less its change (341.70 - 3.39)
      const closed = await settled(at, [[nq("AAPL"), nqInfo("AAPL", "341.70", "341.65", "341.75", "Oct 13, 2026 4:02 PM ET", { secondaryData: { lastSalePrice: "$340.60", netChange: "+2.10", percentageChange: "+0.62%", lastTradeTimestamp: "Closed at Oct 13, 2026 4:00 PM ET", isRealTime: false } })], noTuesday]);
      expect([closed.line.change24h, closed.line.changePct24h]).toEqual([1.22, 0.3582]);
      // the close is kept: later reads within the hour ask Nasdaq no more
      let t = at;
      const net = network(live(at, [[nq("AAPL"), nqInfo("AAPL", "340.75", "340.70", "340.80", "Oct 13, 2026 4:00 PM ET")], noTuesday]));
      const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => t });
      t = at - 15_000;
      await src.listings({ q: "#", limit: 1 });
      await new Promise((go) => setTimeout(go, 0));
      t = at;
      await src.listings({ q: "#", limit: 1 });
      await new Promise((go) => setTimeout(go, 0));
      for (let i = 0; i < 3; i++) {
        const l = ((await src.listings({ q: "AAPL", limit: 1 })) as Listing[])[0]!;
        expect([l.quoteFrom, l.change24h]).toEqual([ROBINHOOD_FROM, 1.07]);
        await new Promise((go) => setTimeout(go, 0));
      }
      expect(nqAsked(net)).toBe(1);
      // the daily read that lacked the day is not asked again within DAYS_RETRY_MS
      expect(dailySent(net)).toEqual(["AAPL"]);
      // Nasdaq refusing: no change, as before — and not asked again within the minute
      const down = await settled(at, [[nq("AAPL"), { status: 500, body: undefined, text: "" }], noTuesday]);
      expect([down.line.quoteFrom, down.line.change24h, down.line.changePct24h]).toEqual([ROBINHOOD_FROM, undefined, undefined]);
      expect(nqAsked(down.net)).toBe(1);
    });

    it("a row whose reference close no source answers has no change, as today", async () => {
      const after = fromEt(2026, 10, 13, 17, 0);
      // the daily bars refused, no Nasdaq answer kept, Nasdaq's quote page knowing none: Robinhood's price, no change
      const down = await settled(after, [["/quote/AAPL/chart?assetclass=stocks&fromdate=", { status: 503, body: undefined, text: "" }]]);
      expect([down.line.quoteFrom, down.line.change24h, down.line.changePct24h]).toEqual([ROBINHOOD_FROM, undefined, undefined]);
      // the bars without the session's own bar: no change from the day before said beside an after-hours price
      const early = await settled(after, [noTuesday]);
      expect([early.line.quoteFrom, early.line.change24h]).toEqual([ROBINHOOD_FROM, undefined]);
      // overnight (not this plan's): no change, though the bars have the day
      const night = await settled(fromEt(2026, 10, 13, 22, 0), []);
      expect([night.line.quoteFrom, night.line.session!.phase, night.line.change24h]).toEqual([ROBINHOOD_FROM, "overnight", undefined]);
      expect(dailySent(night.net)).toEqual([]);
    });
  });
});

describe("one share's line, asked alone (line) — what a paper account prices a share it knows by — and a line said again at a newer quote (usLineAt)", () => {
  /** a directory with V and forty-five more tickers that start with it (VA… VZ, VAA…) in nasdaqlisted's shape: a search of "V" lists forty */
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const rows = [["V", "Visa Inc. - Common Stock"], ...Array.from({ length: 45 }, (_, i) => [`V${letters[i % 26]}${i >= 26 ? letters[i - 26] : ""}`, `V company ${i} - Common Stock`])];
  const many = dirRoutes([NASDAQ_LISTED.split("\n")[0]!, ...rows.map(([sym, name]) => `${sym}|${name}|Q|N|N|100|N|N`), "File Creation Time: 1123202608:30|||||||"].join("\r\n"), OTHER_LISTED.split("\n")[0]!);
  const anyDays: [string, (url: string) => HttpReply] = ["fromdate=", () => oct(329, 330, 331)];

  it("P16: a short ticker's line asks Nasdaq's daily bars for that one share — one read, where a search of the same ticker starts eight at a time — with the real-time chain first", async () => {
    const searched = network([...many, anyDays, ...noRealTime()]);
    const src0 = usStocksPublic({ pace: async () => undefined, http: searched.http, clock: () => NOW });
    // a search of forty lines starts eight daily reads, and lists the lines those priced; the next search eight more
    expect((await src0.listings({ q: "V", limit: 40 })) as Listing[]).toHaveLength(8);
    expect(dailySent(searched)).toHaveLength(8);
    expect((await src0.listings({ q: "V", limit: 40 })) as Listing[]).toHaveLength(16);
    expect(dailySent(searched)).toHaveLength(16);
    // the line: one daily read, the share's own; Nasdaq's quote page (at the same time as Robinhood) for it alone
    const alone = network([...many, anyDays, ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: alone.http, clock: () => NOW });
    const line = (await src.line!("v")) as Listing;
    expect(line).toMatchObject({ symbol: "V", name: "Visa Inc.", kind: "stock", price: 330, quoteFrom: NASDAQ_CLOSE_FROM, delayMs: US_CLOSE_DELAY_MS, venueName: US_STOCKS_NAME, note: "no real-time quote answered: the price is Nasdaq's close of Mon 12 Oct" });
    expect(dailySent(alone)).toEqual(["V"]);
    expect(alone.sent.filter((x) => x.url.includes("/info?")).map((x) => x.url.split("/quote/")[1])).toEqual(["V/info?assetclass=stocks", "V/info?assetclass=etf"]);
    expect(cboeSent(alone)).toEqual([]);
    // the daily bars hanging: a line Robinhood prices answers within CLOSE_WAIT_MS, without the day's change
    const hang = () => new Promise<HttpReply>(() => undefined);
    const base = network([["/rhj/prices", seenMoving(rhAnswer(NOW - 5_000, [["AAPL", "341.80", "341.84"]]))], ...dirRoutes(), ["api.nasdaq.com", NQ_NONE]]);
    const rh = await watched({ http: (url, init) => (url.includes("fromdate=") ? hang() : base.http(url, init)) }, NOW);
    const t0 = Date.now();
    const fast = (await rh.line!("AAPL")) as Listing;
    expect(Date.now() - t0).toBeLessThan(CLOSE_WAIT_MS + 300);
    expect([fast.quoteFrom, fast.price, fast.change24h]).toEqual([ROBINHOOD_FROM, 341.82, undefined]);
  });

  it("a ticker Nasdaq does not know has no line; not a ticker, nothing is asked; nothing priced and Nasdaq refusing is Nasdaq's refusal", async () => {
    const net = network([...routes(), ...noRealTime()]);
    const src = usStocksPublic({ pace: async () => undefined, http: net.http, clock: () => NOW });
    expect(await src.line!("ZZZZ")).toBeNull();
    const asked = net.sent.length;
    expect(await src.line!("BTC/USD")).toBeNull();
    expect(net.sent).toHaveLength(asked);
    const blocked = network([["api.nasdaq.com", { status: 451, body: undefined, text: "unavailable for legal reasons" }], ...dirRoutes(), ...noRealTime()]);
    expect(((await usStocksPublic({ pace: async () => undefined, http: blocked.http, clock: () => NOW }).line!("AAPL")) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
  });

  it("usLineAt: the line at a newer real-time quote — its price, bid, ask, stamp, delay and source, never another's bid beside it; the session and words as the line says them with that quote; the day's change from the same close within one regular session, else none", () => {
    const at = fromEt(2026, 10, 13, 10, 31);
    const cboeLine: Listing = { symbol: "AAPL", name: "Apple Inc", kind: "stock", base: "AAPL", quote: "USD", price: 341.81, bid: 341.76, ask: 341.87, quoteAt: new Date(fromEt(2026, 10, 13, 10, 15) + 44_000).toISOString(), delayMs: CBOE_DELAY_MS, quoteFrom: CBOE_FROM, open: true, types: [], change24h: 0.84, changePct24h: 0.2464, venueName: US_STOCKS_NAME };
    // Robinhood's quote at 10:31: from the close the listing's change was measured from (341.81 - 0.84 = 340.97)
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
