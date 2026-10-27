import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { fromEt } from "../../src/portfolio/account/calendar.ts";
import { HOST_LIMITS } from "../../src/portfolio/live/history.ts";
import { fixedHosts, PUBLIC_HOSTS } from "../../src/portfolio/live/public-markets.ts";
import { realHttp, type Http, type HttpReply } from "../../src/portfolio/live/types.ts";
import { FRESH_MS, NASDAQ_AT_ONCE, NASDAQ_EVERY_MS, NASDAQ_FROM, NASDAQ_UA, NO_ANSWER_HOLD_AFTER, nasdaqChart, nasdaqNumber, nasdaqQuote, nasdaqSource, nasdaqTimeMs, ROBINHOOD_AFTER_MS, ROBINHOOD_BACKOFF, ROBINHOOD_EVERY_MS, ROBINHOOD_FIRST_MS, ROBINHOOD_FROM, ROBINHOOD_JITTER_MS, ROBINHOOD_PRECISE_MS, ROBINHOOD_NEXT_MS, ROBINHOOD_OVERNIGHT, ROBINHOOD_PRICES, ROBINHOOD_RETRIES, ROBINHOOD_RETRY_MS, ROBINHOOD_SPREAD_MS, ROBINHOOD_STANDS_MS, robinhoodQuotes, RT_WAIT_MS, US_IDLE_MS, usQuote, UsQuoteFeed, withoutStrays, type UsQuote, type UsQuotes } from "../../src/portfolio/live/us-quotes.ts";
import { STOCK_JUDGE_MS } from "../../src/portfolio/live/paper.ts";
import type { HubTick } from "../../src/portfolio/live/stream-hub.ts";
import { json, network } from "./live-public-markets-fixtures.ts";

/** US STOCK QUOTES IN REAL TIME (live/us-quotes.ts), read through stand-in networks. The answers are the shapes the sources gave:
 *   · Robinhood GET /rhj/prices and Nasdaq GET /api/quote/{SYM}/info and /chart, live on Wed 2026-10-14 between 16:30 and 16:55 UTC (the
 *     regular session), trimmed to a few symbols and fields (Robinhood's `deployments`, Nasdaq's keyStats and notifications left out);
 *   · Nasdaq's info outside the regular session as web.archive.org captured it: AKAM in pre-market (2025-08-21 08:46 New York), AKA in
 *     after-hours (2026-04-13 18:22), ALX closed (2026-04-14 00:52);
 *   · an edge's 403 page in Akamai's shape and an HTTP/2 stream reset, which no source answered here today: stand-ins for a refusal;
 *   · SATS as Robinhood quoted it at 17:49 UTC (87.87/87.93: EchoStar's token; the share trades as ECHO) and Nasdaq answered it ("Symbol not
 *     exists.", both classes).
 * Nothing leaves the process. */
type Rec = Record<string, unknown>;
/** Wednesday 14 October 2026, 12:33 New York (EDT): the regular session */
const NOW = fromEt(2026, 10, 14, 12, 33) + 20_000;
const GENERATED = "2026-10-14T16:33:08.490956509Z";
/** one Robinhood record as /rhj/prices gave it: the share's bid and ask, the token's beside them (times the multiplier) */
const rh = (tokenSymbol: string, bid: string, ask: string, extra: Rec = {}): Rec => ({ tokenSymbol, bid, ask, currency: "USD", dailyTradingVolume: "2325834", isTradingHalt: false, generatedAt: GENERATED, dailyHigh: "240.11", dailyLow: "233.59", mintBurnTokenVolume: "0", mintBurnUsdVolume: "0", tokenBid: String(Number(bid) * 1.001148), tokenAsk: String(Number(ask) * 1.001148), ...extra });
const RH_ALL = (extra: Rec[] = [], generatedAt = GENERATED) => json({ quotes: [rh("CRM", "234.98", "235.12"), rh("AAPL", "344.36", "344.39"), rh("NVDA", "222.52", "222.55"), rh("SPY", "769.11", "769.14"), rh("HALT", "10.00", "10.10", { isTradingHalt: true }), rh("OTHER", "1", "2", { currency: "EUR" }), ...extra].map((q) => ({ ...q, generatedAt })) });
/** Robinhood's answer as it stood fifteen seconds before `r` (Robinhood writes one about every fifteen seconds): each book a cent lower, each
 * stamp fifteen seconds earlier. A book is taken only once it has been seen to move — one first seen may have stood since the last session —
 * so a reader that read this one first sees every book in `r` move */
const before = (r: HttpReply): HttpReply => {
  const cent = (v: unknown) => (Number(v) - 0.01).toFixed(2);
  const earlier = (v: unknown) => new Date(Date.parse(String(v).replace(/(\.\d{3})\d+/, "$1")) - 15_000).toISOString();
  return json({ quotes: ((r.body as { quotes: Rec[] }).quotes ?? []).map((x) => ({ ...x, bid: cent(x.bid), ask: cent(x.ask), generatedAt: earlier(x.generatedAt) })) });
};
/** a route for Robinhood's answer: as it stood fifteen seconds before (`before`) on the first ask, then `r` */
const seenMoving = (r: HttpReply) => {
  let asked = 0;
  return () => (asked++ === 0 ? before(r) : r);
};
/** a chain whose clock reads `at`, that read Robinhood's answer fifteen seconds before and again at `at` (warm(): Robinhood alone, as a
 * listing's first step, or the background reader) — so each book a `seenMoving` route quotes has been seen to move, and Robinhood's latest
 * answer prices it: the chain asks Nasdaq, at the same time as Robinhood, only for what that answer does not price fresh. What those reads
 * asked is not counted in `sent`, and the answer read at `at` is kept until Robinhood's next write is due */
async function watching(net: { http: Http; sent?: unknown[] }, at: number): Promise<UsQuotes> {
  let t = at - 15_000;
  const q = usQuote({ pace: async () => undefined, http: net.http, clock: () => t });
  q.warm();
  await new Promise((go) => setTimeout(go, 0));
  t = at;
  q.warm();
  await new Promise((go) => setTimeout(go, 0));
  net.sent?.splice(0);
  return q;
}
/** Robinhood's quotes as a reader reads them at `at` that read the answer before `reply` fifteen seconds earlier */
async function seenAt(reply: HttpReply, at = NOW): Promise<Map<string, UsQuote> | Refusal> {
  let now = at - 15_000;
  const answer = seenMoving(reply);
  const all = robinhoodQuotes({ http: async () => answer(), clock: () => now });
  await all();
  now = at;
  return all();
}
/** Nasdaq's info for AAPL, live at 12:33 New York */
const NQ_AAPL = json({ data: { symbol: "AAPL", companyName: "Apple Inc. Common Stock", stockType: "Common Stock", exchange: "NASDAQ-GS", isNasdaqListed: true, isNasdaq100: true, isHeld: false, primaryData: { lastSalePrice: "$344.9472", netChange: "+3.6772", percentageChange: "+1.08%", deltaIndicator: "up", lastTradeTimestamp: "Oct 14, 2026 12:33 PM ET", isRealTime: true, bidPrice: "$344.85", askPrice: "$344.89", bidSize: "20", askSize: "40", volume: "20,359,925.839302", currency: null }, secondaryData: null, marketStatus: "Open", assetClass: "STOCKS" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
const NQ_JPM = json({ data: { symbol: "JPM", companyName: "JP Morgan Chase & Co. Common Stock", stockType: "Common Stock", exchange: "NYSE", primaryData: { lastSalePrice: "$334.82", netChange: "+3.39", percentageChange: "+1.02%", deltaIndicator: "up", lastTradeTimestamp: "Oct 14, 2026 12:33 PM ET", isRealTime: true, bidPrice: "$334.80", askPrice: "$334.85", bidSize: "53", askSize: "30", volume: "4,564,263.548454", currency: null }, secondaryData: null, marketStatus: "Open", assetClass: "STOCKS" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
/** an ETF asked as a stock: 200, data null, "Symbol not exists." (SPY, live); and as an ETF */
const NQ_NONE = json({ data: null, message: null, status: { rCode: 400, bCodeMessage: [{ code: 1001, errorMessage: "Symbol not exists." }], developerMessage: null } });
const NQ_SPY_ETF = json({ data: { symbol: "SPY", companyName: "State Street SPDR S&P 500 ETF Trust", stockType: null, exchange: "PSE", primaryData: { lastSalePrice: "$769.14", netChange: "-8.87", percentageChange: "-1.14%", deltaIndicator: "down", lastTradeTimestamp: "Oct 14, 2026 12:32 PM ET", isRealTime: true, bidPrice: "$769.11", askPrice: "$769.13", bidSize: "120", askSize: "45", volume: "19,178,426.514928", currency: null }, secondaryData: null, marketStatus: "Open", assetClass: "ETF" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
/** archived: pre-market, after-hours, closed */
const NQ_AKAM_PRE = json({ data: { symbol: "AKAM", primaryData: { lastSalePrice: "$76.65", netChange: "+0.59", percentageChange: "+0.78%", deltaIndicator: "up", lastTradeTimestamp: "Aug 21, 2025 8:02 AM ET", isRealTime: true, bidPrice: "$75.00", askPrice: "$77.00", bidSize: "10", askSize: "83", volume: "91", currency: null }, secondaryData: { lastSalePrice: "$76.06", netChange: "-0.43", percentageChange: "-0.56%", deltaIndicator: "down", lastTradeTimestamp: "Closed at Aug 20, 2025 4:00 PM ET", isRealTime: false, bidPrice: "", askPrice: "", bidSize: "", askSize: "", volume: "", currency: null }, marketStatus: "Pre-Market", assetClass: "STOCKS" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
const NQ_AKA_AFTER = json({ data: { symbol: "AKA", primaryData: { lastSalePrice: "$9.87", netChange: "-0.47", percentageChange: "-4.55%", deltaIndicator: "down", lastTradeTimestamp: "Apr 13, 2026 6:22 PM ET", isRealTime: true, bidPrice: "$4.21", askPrice: "$11.40", bidSize: "200", askSize: "13", volume: "530.707642", currency: null }, secondaryData: { lastSalePrice: "$10.34", netChange: "-0.31", percentageChange: "-2.91%", deltaIndicator: "down", lastTradeTimestamp: "Closed at Apr 13, 2026 4:00 PM ET", isRealTime: false, bidPrice: "", askPrice: "", bidSize: "", askSize: "", volume: "", currency: null }, marketStatus: "After-Hours", assetClass: "STOCKS" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
const NQ_ALX_CLOSED = json({ data: { symbol: "ALX", primaryData: { lastSalePrice: "$243.88", netChange: "-3.52", percentageChange: "-1.42%", deltaIndicator: "down", lastTradeTimestamp: "Apr 13, 2026", isRealTime: false, bidPrice: "N/A", askPrice: "N/A", bidSize: "N/A", askSize: "N/A", volume: "52,620", currency: null }, secondaryData: null, marketStatus: "Closed", assetClass: "STOCKS" }, message: null, status: { rCode: 200, bCodeMessage: null, developerMessage: null } });
/** an edge's refusal page, in the shape Akamai serves one (a stand-in: Nasdaq did not refuse this machine today) */
const AKAMAI_403: HttpReply = { status: 403, body: undefined, text: '<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>\n<H1>Access Denied</H1>\n \nYou don\'t have permission to access "http&#58;&#47;&#47;api&#46;nasdaq&#46;com&#47;api&#47;quote&#47;AAPL&#47;info&#63;" on this server.<P>\nReference&#32;&#35;18&#46;0\n</BODY>\n</HTML>\n' };
/** a stream reset, as Node's fetch throws it (a stand-in for the HTTP/2 INTERNAL_ERROR curl met) */
const h2Reset = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR"), { code: "ERR_HTTP2_STREAM_ERROR" }) });

const nq = (sym: string, cls = "stocks", what = "info") => `https://api.nasdaq.com/api/quote/${sym}/${what}?assetclass=${cls}`;

describe("Robinhood's one answer for every share it quotes", () => {
  it("one GET of /rhj/prices: each share by its ticker, at the SHARE's bid and ask (not the token's), the middle as the price, the answer's own stamp; a halted share and one not in dollars left out; kept ten seconds", async () => {
    let now = NOW - 15_000;
    const net = network([["/rhj/prices", seenMoving(RH_ALL())]]);
    const all = robinhoodQuotes({ http: net.http, clock: () => now });
    // the first answer read: every book first seen, none taken (see the next test)
    expect(await all()).toEqual(new Map());
    now = NOW;
    const got = (await all()) as Map<string, UsQuote>;
    expect(net.sent.map((s) => s.url)).toEqual([ROBINHOOD_PRICES, ROBINHOOD_PRICES]);
    expect([...got.keys()]).toEqual(["CRM", "AAPL", "NVDA", "SPY"]);
    expect(got.get("AAPL")).toEqual({ symbol: "AAPL", price: 344.375, bid: 344.36, ask: 344.39, at: Date.parse("2026-10-14T16:33:08.490Z"), delayMs: 0, from: ROBINHOOD_FROM });
    // no day's change: Robinhood gives none
    expect(got.get("CRM")!.change).toBeUndefined();
    // kept ten seconds, then asked again
    now += 9_000;
    await all();
    expect(net.sent).toHaveLength(2);
    now += 2_000;
    await all();
    expect(net.sent).toHaveLength(3);
    expect(PUBLIC_HOSTS).toContain("api.robinhood.com");
  });

  it("a share's stamp is the first answer in which its bid and ask stood as they stand — not the latest answer's, which Robinhood writes every fifteen seconds whether or not anything moved — so a book that stops moving ages", async () => {
    let now = NOW - 15_000;
    let answer = before(RH_ALL());
    const all = robinhoodQuotes({ http: async () => answer, clock: () => now });
    await all();
    now = NOW;
    answer = RH_ALL();
    const first = (await all()) as Map<string, UsQuote>;
    expect(first.get("AAPL")!.at).toBe(Date.parse("2026-10-14T16:33:08.490Z"));
    // fifteen seconds on: a new answer, AAPL's bid and ask as they were, NVDA's moved
    now += 15_000;
    const later = "2026-10-14T16:33:23.512345678Z";
    answer = json({ quotes: [rh("AAPL", "344.36", "344.39", { generatedAt: later }), rh("NVDA", "222.53", "222.56", { generatedAt: later })] });
    const second = (await all()) as Map<string, UsQuote>;
    expect(second.get("AAPL")!.at).toBe(Date.parse("2026-10-14T16:33:08.490Z"));
    expect(second.get("NVDA")!.at).toBe(Date.parse("2026-10-14T16:33:23.512Z"));
    // AAPL's book still standing three minutes on: its stamp is three minutes old, and the chain passes it over (FRESH_MS)
    now += 180_000;
    const third = new Date(now).toISOString();
    answer = json({ quotes: [rh("AAPL", "344.36", "344.39", { generatedAt: third }), rh("SATS", "87.87", "87.93", { generatedAt: third })] });
    expect(((await all()) as Map<string, UsQuote>).get("AAPL")!.at).toBe(Date.parse("2026-10-14T16:33:08.490Z"));
    // through the chain: AAPL's book standing still for three minutes is passed over (and Nasdaq, here, knows nothing)
    let t = NOW - 15_000;
    let reply = before(RH_ALL());
    const chain = usQuote({ pace: async () => undefined, http: async (url) => (url === ROBINHOOD_PRICES ? reply : NQ_NONE), clock: () => t });
    expect(await chain("AAPL", { listed: () => true })).toBeUndefined();
    t = NOW;
    reply = RH_ALL();
    expect((await chain("AAPL", { listed: () => true }))!.from).toBe(ROBINHOOD_FROM);
    t += 180_000;
    reply = json({ quotes: [rh("AAPL", "344.36", "344.39", { generatedAt: new Date(t).toISOString() })] });
    expect(await chain("AAPL", { listed: () => true })).toBeUndefined();
  });

  it("a book first seen is not taken — after a restart, Friday's book read on Sunday night is no live quote — until it moves while watched; one that moved across answers not read is stamped with the last one read, and one older than an answer read says nothing", async () => {
    // Sunday 18 October 2026, 20:01 New York: the overnight session (Robinhood alone) has just begun; the service has just started, and
    // Robinhood's answer, written five seconds ago, carries AAPL's book as it stood at Friday's close
    const sunday = fromEt(2026, 10, 18, 20, 1);
    let t = sunday;
    let reply = json({ quotes: [rh("AAPL", "344.36", "344.39", { generatedAt: new Date(t - 5_000).toISOString() })] });
    const net = network([["/rhj/prices", () => reply], ["api.nasdaq.com", NQ_NONE]]);
    const all = robinhoodQuotes({ http: net.http, clock: () => t });
    const chain = usQuote({ pace: async () => undefined, http: net.http, clock: () => t });
    const listed = () => true;
    expect(await all()).toEqual(new Map());
    expect(await chain("AAPL", { listed })).toBeUndefined();
    expect(net.sent.filter((s) => s.url === ROBINHOOD_PRICES)).toHaveLength(2);
    // the next answer, the book where it stood: still not known since when, still not taken
    t += 15_000;
    reply = json({ quotes: [rh("AAPL", "344.36", "344.39", { generatedAt: new Date(t - 5_000).toISOString() })] });
    expect(await all()).toEqual(new Map());
    expect(await chain("AAPL", { listed })).toBeUndefined();
    // the book moves while watched: from that answer on, Robinhood's real-time quote
    t += 15_000;
    reply = json({ quotes: [rh("AAPL", "344.40", "344.43", { generatedAt: new Date(t - 5_000).toISOString() })] });
    expect(((await all()) as Map<string, UsQuote>).get("AAPL")!.at).toBe(t - 5_000);
    expect(await chain("AAPL", { listed })).toMatchObject({ from: ROBINHOOD_FROM, at: t - 5_000, bid: 344.4 });
    // nobody asks for ten minutes; the book moved once in that time, then stood: it may have moved just after the last answer read, so it
    // is stamped with that one — ten minutes old, not fresh — and the chain passes it over (Nasdaq keeps no overnight session)
    const lastRead = t - 5_000;
    t += 600_000;
    reply = json({ quotes: [rh("AAPL", "344.80", "344.83", { generatedAt: new Date(t - 5_000).toISOString() })] });
    expect(600_000).toBeGreaterThan(ROBINHOOD_NEXT_MS);
    expect(((await all()) as Map<string, UsQuote>).get("AAPL")!.at).toBe(lastRead);
    expect(await chain("AAPL", { listed })).toBeUndefined();
    // moving again under watch, it is live again
    t += 15_000;
    reply = json({ quotes: [rh("AAPL", "344.81", "344.84", { generatedAt: new Date(t - 5_000).toISOString() })] });
    expect(await chain("AAPL", { listed })).toMatchObject({ from: ROBINHOOD_FROM, at: t - 5_000 });
    // an answer older than one already read (a stale copy served late) says nothing of the book: left out, not stamped by it
    t += 15_000;
    reply = json({ quotes: [rh("AAPL", "344.10", "344.13", { generatedAt: new Date(t - 120_000).toISOString() })] });
    expect(await all()).toEqual(new Map());
  });

  it("a crossed or one-sided book is no price; Robinhood refusing this network, not answering, or answering with no quotes is a refusal, never an empty map", async () => {
    expect([...((await seenAt(json({ quotes: [rh("AAPL", "344.39", "344.36"), rh("NVDA", "0", "222.55"), rh("TSLA", "366.40", "366.45")] }))) as Map<string, UsQuote>).keys()]).toEqual(["TSLA"]);
    const blocked = network([["/rhj/prices", { status: 451, body: undefined, text: "unavailable for legal reasons" }]]);
    expect(((await robinhoodQuotes({ http: blocked.http, clock: () => NOW })()) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
    const down: Http = async () => {
      throw h2Reset();
    };
    expect(((await robinhoodQuotes({ http: down, clock: () => NOW })()) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    const empty = network([["/rhj/prices", json({ quotes: [] })]]);
    const r = (await robinhoodQuotes({ http: empty.http, clock: () => NOW })()) as Refusal;
    expect(isRefusal(r)).toBe(true);
    expect(r.message).toContain("no quotes");
  });
});

describe("Nasdaq's quote", () => {
  it("reads the last trade, bid and ask from its strings, the stamp to the minute in New York, the day's change; sends a browser's user-agent", async () => {
    const sent: Array<{ url: string; headers: Record<string, string> }> = [];
    const http: Http = async (url, init = {}) => {
      sent.push({ url, headers: init.headers ?? {} });
      return url.includes("/AAPL/") ? NQ_AAPL : NQ_NONE;
    };
    const q = (await nasdaqQuote({ http, clock: () => NOW })("aapl")) as UsQuote;
    expect(q).toEqual({ symbol: "AAPL", price: 344.9472, bid: 344.85, ask: 344.89, at: fromEt(2026, 10, 14, 12, 33), delayMs: 0, from: NASDAQ_FROM, change: 3.6772, changePct: 1.08 });
    expect(sent).toEqual([{ url: nq("AAPL"), headers: { accept: "application/json", "user-agent": NASDAQ_UA } }]);
    expect(NASDAQ_UA).toMatch(/^Mozilla\/5\.0 .*Chrome\/[\d.]+ Safari\/[\d.]+$/);
    expect(PUBLIC_HOSTS).toContain("api.nasdaq.com");
    // its stamps and figures
    expect(nasdaqTimeMs("Oct 14, 2026 12:33 PM ET")).toBe(Date.parse("2026-10-14T16:33:00Z"));
    expect(nasdaqTimeMs("Dec 1, 2026 12:05 AM ET")).toBe(Date.parse("2026-12-01T05:05:00Z"));
    expect(nasdaqTimeMs("Apr 13, 2026")).toBeUndefined();
    expect(nasdaqTimeMs("Closed at Apr 13, 2026 4:00 PM ET")).toBeUndefined();
    expect([nasdaqNumber("$1,234.56"), nasdaqNumber("+3.6772"), nasdaqNumber("-1.14%"), nasdaqNumber("N/A"), nasdaqNumber(""), nasdaqNumber("$")]).toEqual([1234.56, 3.6772, -1.14, undefined, undefined, undefined]);
    // a crossed book (bid above ask: Nasdaq's own book, not the national best) gives neither side; the last trade stands
    const crossed = json({ data: { ...(NQ_AAPL.body as { data: Rec }).data, primaryData: { ...((NQ_AAPL.body as { data: Rec }).data.primaryData as Rec), bidPrice: "$344.95", askPrice: "$344.89" } } });
    const c = (await nasdaqQuote({ http: async () => crossed, clock: () => NOW })("AAPL")) as UsQuote;
    expect([c.price, c.bid, c.ask]).toEqual([344.9472, undefined, undefined]);
  });

  it("an ETF: asked as a stock first (200, data null), then as an ETF, and the class remembered; a symbol neither knows is not listed, and kept ten minutes", async () => {
    let now = NOW;
    const net = network([[nq("SPY", "etf"), NQ_SPY_ETF], [nq("SPY"), NQ_NONE], [nq("ZZZZ"), NQ_NONE], [nq("ZZZZ", "etf"), NQ_NONE]]);
    const quote = nasdaqQuote({ http: net.http, clock: () => now });
    expect(await quote("SPY")).toMatchObject({ symbol: "SPY", price: 769.14, bid: 769.11, ask: 769.13, at: fromEt(2026, 10, 14, 12, 32), change: -8.87, changePct: -1.14 });
    expect(net.sent.map((s) => s.url)).toEqual([nq("SPY"), nq("SPY", "etf")]);
    now += 11_000;
    await quote("SPY");
    // kept ten seconds, then asked again — as an ETF only
    expect(net.sent.map((s) => s.url).slice(2)).toEqual([nq("SPY", "etf")]);
    expect(await quote("ZZZZ")).toBeNull();
    now += 9 * 60_000;
    expect(await quote("ZZZZ")).toBeNull();
    expect(net.sent.filter((s) => s.url.includes("ZZZZ"))).toHaveLength(2);
    // a 404 as a stock is "not as a stock" too
    const four = network([[nq("QQQ"), json({ message: "not found" }, 404)], [nq("QQQ", "etf"), NQ_SPY_ETF]]);
    expect(await nasdaqQuote({ http: four.http, clock: () => NOW })("QQQ")).toMatchObject({ price: 769.14 });
  });

  it("one Nasdaq for the quote and the chart: the class one answered is the other's too; a symbol hinted as an ETF (its company's name) is asked as one first, and a wrong hint costs one ask", async () => {
    const chart = json({ data: { symbol: "SPY", chart: [{ x: 1791950400000, y: 769.1 }] } });
    const net = network([[nq("SPY", "etf"), NQ_SPY_ETF], [nq("SPY", "etf", "chart"), chart], [nq("O"), NQ_JPM], [nq("O", "etf"), NQ_NONE], ["api.nasdaq.com", NQ_NONE]]);
    const n = nasdaqSource({ pace: async () => undefined, http: net.http, clock: () => NOW });
    expect(await n.quote("SPY")).toMatchObject({ price: 769.14 });
    expect(await n.chart("SPY")).toHaveLength(1);
    // SPY as a stock once (the quote), then as an ETF only
    expect(net.sent.map((x) => x.url)).toEqual([nq("SPY"), nq("SPY", "etf"), nq("SPY", "etf", "chart")]);
    const hinted = network([[nq("QQQ", "etf"), NQ_SPY_ETF], ["api.nasdaq.com", NQ_NONE]]);
    const h = nasdaqSource({ pace: async () => undefined, http: hinted.http, clock: () => NOW });
    h.hint("QQQ", "etf");
    expect(await h.quote("QQQ")).toMatchObject({ price: 769.14 });
    expect(hinted.sent.map((x) => x.url)).toEqual([nq("QQQ", "etf")]);
    // a hint that was wrong (a "Trust" that is a company): asked as an ETF, then as a stock, and the stock remembered over the hint
    const wrong = nasdaqSource({ pace: async () => undefined, http: net.http, clock: () => NOW });
    wrong.hint("O", "etf");
    expect(await wrong.quote("O")).toMatchObject({ price: 334.82 });
    wrong.hint("O", "etf");
    await wrong.chart("O");
    expect(net.sent.map((x) => x.url).slice(3)).toEqual([nq("O", "etf"), nq("O"), nq("O", "stocks", "chart")]);
  });

  it("outside the regular session (archived answers): an extended session's last trade with its own stamp and primaryData's change — the change of that price from the last regular close, not the session before's — ; a closed market's answer, stamped by its date alone, is no quote", async () => {
    const pre = network([[nq("AKAM"), NQ_AKAM_PRE]]);
    // 76.65 less 0.59 is 76.06, the close secondaryData names; secondaryData's own change (-0.43) is the day before's, and is not taken
    expect(await nasdaqQuote({ http: pre.http, clock: () => fromEt(2025, 8, 21, 8, 46) })("AKAM")).toEqual({ symbol: "AKAM", price: 76.65, bid: 75, ask: 77, at: fromEt(2025, 8, 21, 8, 2), delayMs: 0, from: NASDAQ_FROM, change: 0.59, changePct: 0.78 });
    const after = network([[nq("AKA"), NQ_AKA_AFTER]]);
    // 9.87 less -0.47 is 10.34, that day's close
    expect(await nasdaqQuote({ http: after.http, clock: () => fromEt(2026, 4, 13, 18, 23) })("AKA")).toEqual({ symbol: "AKA", price: 9.87, bid: 4.21, ask: 11.4, at: fromEt(2026, 4, 13, 18, 22), delayMs: 0, from: NASDAQ_FROM, change: -0.47, changePct: -4.55 });
    const closed = network([[nq("ALX"), NQ_ALX_CLOSED]]);
    expect(await nasdaqQuote({ http: closed.http, clock: () => fromEt(2026, 4, 14, 0, 52) })("ALX")).toBeNull();
    // only one ask: Nasdaq knows it as a stock
    expect(closed.sent).toHaveLength(1);
  });

  it("Nasdaq refusing — an edge's 403 page, an HTTP/2 stream reset, a 4xx as both classes — is a refusal, and an edge's page is not asked again as an ETF", async () => {
    const edge = network([["api.nasdaq.com", AKAMAI_403]]);
    const r = (await nasdaqQuote({ http: edge.http, clock: () => NOW })("AAPL")) as Refusal;
    expect(r.code).toBe("E_VENUE_GEOBLOCKED");
    expect(edge.sent).toHaveLength(1);
    let asked = 0;
    const reset: Http = async () => {
      asked++;
      throw h2Reset();
    };
    expect(((await nasdaqQuote({ http: reset, clock: () => NOW })("AAPL")) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    expect(asked).toBe(1);
    const forbidden = network([["api.nasdaq.com", json({ message: "forbidden" }, 403)]]);
    const f = (await nasdaqQuote({ http: forbidden.http, clock: () => NOW })("AAPL")) as Refusal;
    expect([f.code, forbidden.sent.length]).toEqual(["E_VENUE_REJECTED", 2]);
    expect(f.message).toContain("HTTP 403");
  });

  it("one refusal that says to wait holds back the WHOLE source — every symbol, the quote and the chart — for as long as holdBackMs says; no answer only once it is the source's way (three in a row); one that does not (a plain 4xx) holds back nothing; clear() lets go", async () => {
    let now = NOW;
    let edge = true;
    const asked: string[] = [];
    const http: Http = async (url) => {
      asked.push(url);
      if (edge) return AKAMAI_403;
      return url.includes("/AAPL/") ? NQ_AAPL : NQ_JPM;
    };
    const n = nasdaqSource({ pace: async () => undefined, http, clock: () => now });
    expect(((await n.quote("AAPL")) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
    // JPM, and the chart: not asked
    expect(((await n.quote("JPM")) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
    expect(((await n.chart("TSLA")) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
    expect(asked).toHaveLength(1);
    // ten minutes on (an edge's page is held as a place rule is), asked again
    edge = false;
    now += 600_001;
    expect(await n.quote("JPM")).toMatchObject({ price: 334.82 });
    // NO ANSWER (feat/paper-live phase 3): one lost request holds nothing back — the next share is asked — and only NO_ANSWER_HOLD_AFTER in
    // a row, with no answer between, hold every symbol for the twenty seconds holdBackMs gives no answer
    expect(NO_ANSWER_HOLD_AFTER).toBe(3);
    let down = true;
    const reset: Http = async (url) => {
      asked.push(url);
      if (down) throw h2Reset();
      return NQ_JPM;
    };
    const m = nasdaqSource({ pace: async () => undefined, http: reset, clock: () => now });
    const before = asked.length;
    expect(((await m.quote("AAPL")) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    expect(((await m.quote("V")) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    expect(asked.length - before).toBe(2);
    expect(((await m.quote("TSLA")) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    expect(asked.length - before).toBe(3);
    // the third in a row: the source is held, and the next share is not asked
    expect(((await m.quote("JPM")) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    expect(asked.length - before).toBe(3);
    down = false;
    now += 20_001;
    expect(await m.quote("V")).toMatchObject({ price: 334.82 });
    // an answer between lost requests starts the count again: two lost, one answered, two lost — nothing held
    let lose = 2;
    const flaky: Http = async (url) => {
      asked.push(url);
      if (lose-- > 0) throw h2Reset();
      return NQ_JPM;
    };
    const f = nasdaqSource({ pace: async () => undefined, http: flaky, clock: () => now });
    await f.quote("A");
    await f.quote("B");
    expect(await f.quote("C")).toMatchObject({ price: 334.82 });
    lose = 2;
    await f.quote("D");
    await f.quote("E");
    lose = 0;
    expect(await f.quote("G")).toMatchObject({ price: 334.82 });
    // clear() lets go of a hold at once
    let refuse = true;
    const z = nasdaqSource({ pace: async () => undefined, http: async () => (refuse ? AKAMAI_403 : NQ_JPM), clock: () => NOW });
    await z.quote("AAPL");
    refuse = false;
    expect(isRefusal(await z.quote("V"))).toBe(true);
    z.clear();
    expect(await z.quote("V")).toMatchObject({ price: 334.82 });
    // a plain 4xx (a symbol Nasdaq answers 404 for, as a stock and as an ETF) holds back nothing
    const plain = network([[nq("ZZZZ"), json({ message: "not found" }, 404)], [nq("ZZZZ", "etf"), json({ message: "not found" }, 404)], [nq("JPM"), NQ_JPM]]);
    const p = nasdaqSource({ pace: async () => undefined, http: plain.http, clock: () => NOW });
    expect(((await p.quote("ZZZZ")) as Refusal).code).toBe("E_VENUE_REJECTED");
    expect(await p.quote("JPM")).toMatchObject({ price: 334.82 });
  });

  it("the chart: one point a minute from 04:00, x written as New York's wall-clock time and read back to the real instant", async () => {
    const chart = json({ data: { symbol: "AAPL", company: "Apple Inc. Common Stock", timeAsOf: "Oct 14, 2026 12:33 PM ET", lastSalePrice: "$344.8806", previousClose: "$341.27", chart: [{ z: { dateTime: "4:01 AM ET", value: "341.77" }, x: 1791950460000, y: 341.77 }, { z: { dateTime: "4:00 AM ET", value: "342.21" }, x: 1791950400000, y: 342.21 }, { z: { dateTime: "12:32 PM ET", value: "345.165" }, x: 1791981120000, y: 345.165 }, { x: "?", y: 1 }] } });
    const net = network([[nq("AAPL", "stocks", "chart"), chart], [nq("SPY", "stocks", "chart"), NQ_NONE], [nq("SPY", "etf", "chart"), chart]]);
    const read = nasdaqChart({ http: net.http, clock: () => NOW });
    const got = await read("AAPL");
    // 04:00 New York in EDT is 08:00 UTC, not 04:00
    expect(got).toEqual([
      { t: Date.parse("2026-10-14T08:00:00Z"), o: 342.21, h: 342.21, l: 342.21, c: 342.21 },
      { t: Date.parse("2026-10-14T08:01:00Z"), o: 341.77, h: 341.77, l: 341.77, c: 341.77 },
      { t: Date.parse("2026-10-14T16:32:00Z"), o: 345.165, h: 345.165, l: 345.165, c: 345.165 },
    ]);
    expect(await read("SPY")).toHaveLength(3);
    const none = network([["api.nasdaq.com", NQ_NONE]]);
    expect(await nasdaqChart({ http: none.http, clock: () => NOW })("ZZZZ")).toBeNull();
  });

  it("a lone stray print is left out — NVDA's 233.4137 at 4:48 PM between 221.20 and 221.1941 — while a move the next minute stays at is kept", async () => {
    const at = (m: number) => 1791950400000 + (12 * 60 + 44 + m) * 60_000; // 4:44 PM New York and on
    const ys = [221.3468, 221.29, 221.2, 233.4137, 221.1941, 221.202, 226.1, 226.3];
    const chart = json({ data: { symbol: "NVDA", chart: ys.map((y, i) => ({ x: at(i), y })) } });
    const net = network([[nq("NVDA", "stocks", "chart"), chart]]);
    const got = (await nasdaqChart({ http: net.http, clock: () => NOW })("NVDA")) as Array<{ c: number }>;
    expect(got.map((b) => b.c)).toEqual([221.3468, 221.29, 221.2, 221.1941, 221.202, 226.1, 226.3]);
    // the pure rule: a first or last sample has one neighbour only, and stays
    expect(withoutStrays([{ t: 1, o: 300, h: 300, l: 300, c: 300 }, { t: 2, o: 100, h: 100, l: 100, c: 100 }]).length).toBe(2);
  });
});

describe("the chain: Robinhood while fresh and listed under that ticker, else Nasdaq, else nothing — within one deadline", () => {
  /** the sources' answers; Robinhood's as it stood fifteen seconds before on its first ask (`seenMoving`: a chain reads it so in `watching`) */
  const routes = (rhAll: HttpReply = RH_ALL()): Array<[string, HttpReply | (() => HttpReply)]> => [["/rhj/prices", seenMoving(rhAll)], [nq("AAPL"), NQ_AAPL], [nq("JPM"), NQ_JPM], [nq("HALT"), NQ_JPM], [nq("SPY"), NQ_NONE], [nq("SPY", "etf"), NQ_SPY_ETF]];
  /** the tickers the market lists (Cboe's symbol book, in the caller): SATS is not one */
  const BOOK = new Set(["AAPL", "NVDA", "SPY", "CRM", "JPM", "HALT", "ECHO"]);
  const listed = (s: string) => BOOK.has(s);

  it("a share Robinhood quotes and the book lists is Robinhood's; one it does not quote (JPM), or has halted, is Nasdaq's; one neither has is nothing", async () => {
    const net = network([...routes(), ["api.nasdaq.com", NQ_NONE]]);
    const q = await watching(net, NOW);
    expect((await q("AAPL", { listed }))!.from).toBe(ROBINHOOD_FROM);
    expect(await q("JPM", { listed })).toMatchObject({ from: NASDAQ_FROM, price: 334.82 });
    expect((await q("HALT", { listed }))!.from).toBe(NASDAQ_FROM);
    expect(await q("ZZZZ", { listed })).toBeUndefined();
    // Robinhood's answer as it was written serves all of it (kept until its next write is due: no more GETs of it), and Nasdaq only for
    // what that answer does not price
    expect(net.sent.filter((s) => s.url === ROBINHOOD_PRICES)).toHaveLength(0);
    expect(net.sent.some((s) => s.url.includes("/AAPL/"))).toBe(false);
  });

  it("NASDAQ AT THE SAME TIME AS ROBINHOOD, never after it: a share Robinhood's latest answer does not price fresh is asked of Nasdaq as Robinhood is read — before Robinhood's first answer, every share asked — and Robinhood's fresh quote is still the one taken", async () => {
    let robinhoodAt = 0;
    let nasdaqAt = 0;
    const t0 = Date.now();
    const rhAll = seenMoving(RH_ALL());
    const http: Http = async (url) => {
      if (url === ROBINHOOD_PRICES) {
        robinhoodAt = Date.now() - t0;
        await new Promise((go) => setTimeout(go, 200));
        return rhAll();
      }
      nasdaqAt = Date.now() - t0;
      await new Promise((go) => setTimeout(go, 200));
      return url.includes("/AAPL/") ? NQ_AAPL : NQ_JPM;
    };
    // nothing read yet: Robinhood and Nasdaq at once, both within one round trip — not Nasdaq a round trip after Robinhood
    const q = usQuote({ pace: async () => undefined, http, clock: () => NOW });
    const got = await q.many(["AAPL", "JPM"], { listed, waitMs: 1_000 });
    expect(Date.now() - t0).toBeLessThan(380);
    expect(Math.abs(nasdaqAt - robinhoodAt)).toBeLessThan(50);
    // Robinhood's first answer is a book first seen (not taken): both are Nasdaq's
    expect([got.get("AAPL")?.from, got.get("JPM")?.from]).toEqual([NASDAQ_FROM, NASDAQ_FROM]);
  });

  it("Robinhood's token symbol is not always the share's ticker: SATS (EchoStar's token; the share is ECHO) is not taken where the book does not list it, and nothing of Robinhood's is taken with no book to check — Nasdaq, which knows the tickers, is asked", async () => {
    const sats = (at: string) => RH_ALL([rh("SATS", "87.87", "87.93")], at);
    const net = network([...routes(sats(GENERATED)), [nq("SATS"), NQ_NONE], [nq("SATS", "etf"), NQ_NONE]]);
    // SATS's book seen moving and fresh: only the ticker keeps it out
    const q = await watching(net, NOW);
    expect(await q("SATS", { listed })).toBeUndefined();
    expect(net.sent.map((s) => s.url).filter((u) => u.includes("nasdaq"))).toEqual([nq("SATS"), nq("SATS", "etf")]);
    // no book given: Robinhood's AAPL is not taken, Nasdaq's is
    expect(await q("AAPL")).toMatchObject({ from: NASDAQ_FROM, price: 344.9472 });
  });

  it("a Robinhood stamp older than two minutes is passed over for Nasdaq", async () => {
    const stale = new Date(NOW - FRESH_MS - 1_000).toISOString();
    const net = network(routes(RH_ALL([], stale)));
    const q = await watching(net, NOW);
    expect(await q("AAPL", { listed })).toMatchObject({ from: NASDAQ_FROM, price: 344.9472, at: fromEt(2026, 10, 14, 12, 33) });
    const fresh = network(routes(RH_ALL([], new Date(NOW - FRESH_MS + 5_000).toISOString())));
    expect((await (await watching(fresh, NOW))("AAPL", { listed }))!.from).toBe(ROBINHOOD_FROM);
  });

  it("Robinhood and Nasdaq both refusing (a 451, an edge's page, an HTTP/2 reset) is nothing — the caller says Cboe's delayed quote — never a refusal of the chain", async () => {
    const http: Http = async (url) => {
      if (url.includes("robinhood")) return { status: 451, body: undefined, text: "" };
      if (url.includes("/JPM/")) throw h2Reset();
      return AKAMAI_403;
    };
    const q = usQuote({ pace: async () => undefined, http, clock: () => NOW });
    expect(await q("AAPL", { listed })).toBeUndefined();
    expect(await q("JPM", { listed })).toBeUndefined();
    expect(await q.many(["AAPL", "JPM"], { listed })).toEqual(new Map());
  });

  it("many at once: one Robinhood answer, and Nasdaq for ONE batch — the first eight shares Robinhood's answer does not price, all at once — and no more", async () => {
    let inFlight = 0;
    let most = 0;
    const asked: string[] = [];
    const rhAll = seenMoving(RH_ALL());
    const http: Http = async (url) => {
      asked.push(url);
      if (url === ROBINHOOD_PRICES) return rhAll();
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((go) => setTimeout(go, 5));
      inFlight--;
      return NQ_JPM;
    };
    const rest = Array.from({ length: 20 }, (_, i) => `X${String.fromCharCode(65 + i)}`);
    const got = await (await watching({ http, sent: asked }, NOW)).many(["AAPL", "NVDA", ...rest], { listed: () => true });
    expect(NASDAQ_AT_ONCE).toBe(8);
    expect(got.size).toBe(2 + NASDAQ_AT_ONCE);
    expect([got.get("AAPL")!.from, got.get("XA")!.from, got.has("XH"), got.has("XI")]).toEqual([ROBINHOOD_FROM, NASDAQ_FROM, true, false]);
    // Robinhood's answer read as it was written (watching) serves the ask: no GET of it here
    expect(asked.filter((u) => u === ROBINHOOD_PRICES)).toHaveLength(0);
    expect(asked.filter((u) => u.includes("api.nasdaq.com"))).toHaveLength(NASDAQ_AT_ONCE);
    expect(most).toBe(NASDAQ_AT_ONCE);
  });

  it("one deadline for all of it: what has not answered by RT_WAIT_MS is not waited for — its answer, when it comes, is kept for the next ask", async () => {
    expect(RT_WAIT_MS).toBe(1_500);
    // Nasdaq answers JPM at once and V a second late
    const rhAll = seenMoving(RH_ALL());
    const http: Http = async (url) => {
      if (url === ROBINHOOD_PRICES) return rhAll();
      if (url.includes("/V/")) await new Promise((go) => setTimeout(go, 300));
      return NQ_JPM;
    };
    const q = await watching({ http }, NOW);
    const t0 = Date.now();
    const got = await q.many(["AAPL", "JPM", "V"], { listed, waitMs: 100 });
    expect(Date.now() - t0).toBeLessThan(250);
    expect([...got.keys()].sort()).toEqual(["AAPL", "JPM"]);
    // the late answer is kept: the next ask has it at once
    await new Promise((go) => setTimeout(go, 300));
    const again = await q.many(["V"], { listed, waitMs: 100 });
    expect(again.get("V")).toMatchObject({ from: NASDAQ_FROM });
    // Robinhood hanging: nothing of it, and the chain still answers by the deadline — with Nasdaq's quote, asked at the same time
    const hang: Http = (url) => (url === ROBINHOOD_PRICES ? new Promise<HttpReply>(() => undefined) : Promise.resolve(NQ_JPM));
    const t1 = Date.now();
    const hung = await usQuote({ pace: async () => undefined, http: hang, clock: () => NOW }).many(["AAPL"], { listed, waitMs: 100 });
    expect(Date.now() - t1).toBeLessThan(250);
    expect([...hung.values()].map((x) => x.from)).toEqual([NASDAQ_FROM]);
  });

  it("A LATE ANSWER KEPT UNTIL THE NEXT ASK: a Nasdaq answer that came after one ask stopped waiting is the next ask's whenever that ask's own is late too — while it came within FRESH_MS, its own stamp saying how old it is; one from hours before is no quote of now", async () => {
    let now = NOW;
    const rhAll = seenMoving(RH_ALL());
    // Nasdaq takes 300 ms each time; each ask waits 100 ms
    let n = 0;
    const http: Http = async (url) => {
      if (url === ROBINHOOD_PRICES) return rhAll();
      n++;
      await new Promise((go) => setTimeout(go, 300));
      return NQ_JPM;
    };
    const q = usQuote({ pace: async () => undefined, http, clock: () => now });
    expect((await q.many(["JPM"], { listed, waitMs: 100 })).has("JPM")).toBe(false);
    await new Promise((go) => setTimeout(go, 300));
    // twenty seconds on (the answer two keeps old): asked again, late again — and the answer from before is this ask's
    now += 20_000;
    const later = await q.many(["JPM"], { listed, waitMs: 100 });
    expect(later.get("JPM")).toMatchObject({ from: NASDAQ_FROM, price: 334.82, at: fromEt(2026, 10, 14, 12, 33) });
    expect(n).toBe(2);
    await new Promise((go) => setTimeout(go, 300));
    // two hours on (JPM searched again in the afternoon), Nasdaq late again: the answer kept from before is no quote of now — none is taken,
    // and the caller says Cboe's delayed quote, never that one said as real time
    expect(FRESH_MS).toBe(120_000);
    now += 2 * 3_600_000;
    expect((await q.many(["JPM"], { listed, waitMs: 100 })).has("JPM")).toBe(false);
    expect(n).toBe(3);
    // just under FRESH_MS after that ask's own late answer came, the next late ask takes it; just over, not
    await new Promise((go) => setTimeout(go, 300));
    now += FRESH_MS - 1_000;
    expect((await q.many(["JPM"], { listed, waitMs: 100 })).get("JPM")).toMatchObject({ from: NASDAQ_FROM });
    await new Promise((go) => setTimeout(go, 300));
    now += FRESH_MS + 1_000;
    expect((await q.many(["JPM"], { listed, waitMs: 100 })).has("JPM")).toBe(false);
    await new Promise((go) => setTimeout(go, 300));
  });

  it("a late answer is not taken while Nasdaq says to wait: one answer, then a 429 — the next ask, its own refused, has nothing of Nasdaq's though the answer before is seconds old (the caller says Cboe's delayed quote); the hold over, Nasdaq's answer again; clear() lets go of the answers kept", async () => {
    let now = NOW;
    let status = 200;
    let slowMs = 0;
    const http: Http = async (url) => {
      if (url === ROBINHOOD_PRICES) return { status: 451, body: undefined, text: "" };
      if (slowMs) await new Promise((go) => setTimeout(go, slowMs));
      return status === 200 ? NQ_JPM : { status, body: undefined, text: "Too Many Requests" };
    };
    const q = usQuote({ pace: async () => undefined, http, clock: () => now });
    expect((await q.many(["JPM"], { listed })).get("JPM")).toMatchObject({ from: NASDAQ_FROM, price: 334.82 });
    status = 429;
    now += 10_000;
    expect((await q.many(["JPM"], { listed })).has("JPM")).toBe(false);
    // a minute on, the hold over and Nasdaq answering: its answer is the ask's
    status = 200;
    now += 61_000;
    expect((await q.many(["JPM"], { listed })).get("JPM")).toMatchObject({ from: NASDAQ_FROM });
    // clear(): the answer kept is let go — the next ask, late, has none of it (without clear(), it would: five seconds old)
    q.clear();
    now += 5_000;
    slowMs = 300;
    expect((await q.many(["JPM"], { listed, waitMs: 100 })).has("JPM")).toBe(false);
    await new Promise((go) => setTimeout(go, 300));
  });

  it("by the session: Nasdaq in pre-market and after-hours; overnight Robinhood alone (ROBINHOOD_OVERNIGHT); closed, neither is asked", async () => {
    expect(ROBINHOOD_OVERNIGHT).toBe(true);
    // JPM's after-hours trade, as Nasdaq stamps one (6:22 PM ET, isRealTime true)
    const jpmAfter = json({ data: { ...(NQ_JPM.body as { data: Rec }).data, primaryData: { ...((NQ_JPM.body as { data: Rec }).data.primaryData as Rec), lastTradeTimestamp: "Oct 14, 2026 6:22 PM ET" }, marketStatus: "After-Hours" } });
    const at = (ms: number) => [["/rhj/prices", seenMoving(RH_ALL([], new Date(ms - 5_000).toISOString()))], [nq("AAPL"), NQ_AAPL], [nq("JPM"), jpmAfter]] as Array<[string, HttpReply | (() => HttpReply)]>;
    // after-hours, Wednesday 14 October 18:30: Robinhood's for AAPL, Nasdaq's for JPM
    const after = fromEt(2026, 10, 14, 18, 30);
    const a = network(at(after));
    const ga = await (await watching(a, after)).many(["AAPL", "JPM"], { listed });
    expect([ga.get("AAPL")?.from, ga.get("JPM")?.from, ga.get("JPM")?.at]).toEqual([ROBINHOOD_FROM, NASDAQ_FROM, fromEt(2026, 10, 14, 18, 22)]);
    // overnight, 22:00: Robinhood's for AAPL, and Nasdaq (which keeps no overnight session) is not asked
    const night = fromEt(2026, 10, 14, 22, 0);
    const n = network(at(night));
    const gn = await (await watching(n, night)).many(["AAPL", "JPM"], { listed });
    expect([gn.get("AAPL")?.from, gn.has("JPM")]).toEqual([ROBINHOOD_FROM, false]);
    // Robinhood's answer as it was just written serves it (kept), and Nasdaq is not asked at all
    expect(n.sent.map((s) => s.url)).toEqual([]);
    // Saturday: nothing is asked
    const saturday = fromEt(2026, 10, 17, 12, 0);
    const s = network(at(saturday));
    const q = usQuote({ pace: async () => undefined, http: s.http, clock: () => saturday });
    q.warm();
    expect(await q.many(["AAPL", "JPM"], { listed })).toEqual(new Map());
    expect(s.sent).toHaveLength(0);
  });
});

describe("Robinhood read as it is written", () => {
  it("learns from its answers when its next write shows here: a read that still has the write before raises the window's floor, the first with the new one ends it, and the next write's window is a cadence on; an answer is kept until that window's end (ten seconds at most), and read() reads now", async () => {
    // writes as Robinhood wrote them on Saturday 2026-10-17: 04:35:19.066, then 15.109 s later; reads here answer at once
    let written = Date.parse("2026-10-17T04:35:19.066Z");
    let now = 0;
    let gets = 0;
    let k = 0;
    const r = robinhoodQuotes({
      http: async () => {
        gets++;
        return json({ quotes: [rh("AAPL", (342.62 + k * 0.01).toFixed(2), (347.11 + k * 0.01).toFixed(2), { generatedAt: new Date(written).toISOString() })] });
      },
      clock: () => now,
    });
    expect([r.latest(), r.nextWrite(), r.everyMs()]).toEqual([undefined, undefined, ROBINHOOD_EVERY_MS]);
    // the first answer read 3.8 s after its write: the write showed within a cadence before it — the next one shows a cadence on from that
    const t0 = written + 3_800;
    now = t0;
    await r();
    expect(r.latest()).toMatchObject({ written, readAt: t0 });
    expect(r.latest()!.symbols.has("AAPL")).toBe(true);
    expect(r.nextWrite()).toEqual({ lo: t0 - ROBINHOOD_JITTER_MS - ROBINHOOD_JITTER_MS, hi: t0 + ROBINHOOD_EVERY_MS + ROBINHOOD_JITTER_MS });
    // a read halfway into the window that still has the same write raises the floor to when it was sent
    now = t0 + 7_000;
    await r.read();
    expect(r.nextWrite()!.lo).toBe(t0 + 7_000);
    // the next write (15.109 s after the first), first read 0.2 s after it: the window it showed in was (the floor, then], and its cadence
    // is taken
    const floor = t0 + 11_200;
    now = floor;
    await r.read();
    written += 15_109;
    k++;
    const seen = written + 200;
    now = seen;
    await r.read();
    expect(r.everyMs()).toBe(15_109);
    expect(r.nextWrite()).toEqual({ lo: floor + 15_109 - ROBINHOOD_JITTER_MS, hi: seen + 15_109 + ROBINHOOD_JITTER_MS });
    // kept until that window's end, ten seconds at most: asked again only then
    expect(gets).toBe(4);
    now = seen + 9_900;
    await r();
    expect(gets).toBe(4);
    now = seen + 10_001;
    await r();
    expect(gets).toBe(5);
    // the book moved at the write read one after the other: stamped with the write it moved in
    expect(((await r()) as Map<string, UsQuote>).get("AAPL")!.at).toBe(written);
    // a write two cadences on (one not read) is no cadence: 15.109 s stands
    written += 30_000;
    k++;
    now = written + 600;
    await r.read();
    expect(r.everyMs()).toBe(15_109);
  });

  it("ONE WRITE, SEVERAL COPIES (ROBINHOOD_SPREAD_MS): a copy made a moment after the first one read is that write's newer word — its books taken — and never the next write: the cadence is the writes', the window's end stays where the write's stamp put it and only its floor rises; a write first read late is placed by its stamp, not by when it was read", async () => {
    // Monday 2026-10-19: copies of one write made at 16:27:25.172, 25.243, 25.375, 25.515 and 25.582 UTC; the next write's from 40.322
    const copy = (stamp: string, nvdaBid: string) => json({ quotes: [rh("AAPL", "341.38", "341.41", { generatedAt: stamp }), rh("NVDA", nvdaBid, (Number(nvdaBid) + 0.02).toFixed(2), { generatedAt: stamp })] });
    let now = 0;
    let reply = copy("2026-10-19T16:27:10.400Z", "219.40");
    const r = robinhoodQuotes({ http: async () => reply, clock: () => now });
    // the write before, read a tenth of a second after it was made: the books seen
    const w0 = Date.parse("2026-10-19T16:27:10.400Z");
    now = w0 + 100;
    await r.read();
    // the write of 25.172, read 0.4 s after it was made (a copy made for this read): the cadence, and the next write's window placed by
    // its stamp and the least time a copy has taken to come back here (0.1 s)
    const w1 = Date.parse("2026-10-19T16:27:25.172Z");
    now = w1 + 400;
    reply = copy("2026-10-19T16:27:25.172Z", "219.43");
    await r.read();
    expect(r.everyMs()).toBe(w1 - w0);
    const { hi } = r.nextWrite()!;
    expect(hi).toBe(w1 + 100 + (w1 - w0) + ROBINHOOD_JITTER_MS);
    // fourteen seconds on, a read answered by the copy made at 25.515, NVDA's book a cent on in it: its newer word, stamped with that copy
    const later = Date.parse("2026-10-19T16:27:25.515Z");
    now = w1 + 14_000;
    reply = copy("2026-10-19T16:27:25.515Z", "219.44");
    const got = (await r.read()) as Map<string, UsQuote>;
    expect(got.get("NVDA")!.at).toBe(later);
    expect(r.latest()!.written).toBe(later);
    // never the next write: no cadence of a third of a second, and the window's end where it was — the next write had not shown where
    // this read was answered, so its floor rose to when the read was sent
    expect(r.everyMs()).toBe(w1 - w0);
    expect(r.nextWrite()).toEqual({ lo: w1 + 14_000, hi });
    // a copy older than the one read last (25.243) says nothing of its books, and still raises the floor
    now = w1 + 14_300;
    reply = copy("2026-10-19T16:27:25.243Z", "219.41");
    expect(((await r.read()) as Map<string, UsQuote>).has("NVDA")).toBe(false);
    expect([r.latest()!.written, r.nextWrite()]).toEqual([later, { lo: w1 + 14_300, hi }]);
    // the next write, first read six seconds after it was made (a listing's ask): the window after it is placed by its stamp — the copy
    // that came back late does not move it six seconds on
    const w2 = Date.parse("2026-10-19T16:27:40.322Z");
    now = w2 + 6_000;
    reply = copy("2026-10-19T16:27:40.322Z", "219.50");
    await r.read();
    expect(r.everyMs()).toBe(w2 - w1);
    expect(r.nextWrite()!.hi).toBe(w2 + 100 + (w2 - w1) + ROBINHOOD_JITTER_MS);
    expect(ROBINHOOD_SPREAD_MS).toBeLessThan(ROBINHOOD_EVERY_MS / 2);
  });

  it("one lost read holds nothing back — the next ask reads again — and three in a row hold it twenty seconds; a refusal that says to wait (a 451) holds it at once, and read() does not read past it", async () => {
    let now = NOW;
    let fail = true;
    let gets = 0;
    const r = robinhoodQuotes({
      http: async () => {
        gets++;
        if (fail) throw h2Reset();
        return RH_ALL();
      },
      clock: () => now,
    });
    expect(((await r()) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    expect(((await r()) as Refusal).code).toBe("E_VENUE_UNREACHABLE");
    expect(gets).toBe(2);
    await r();
    expect(gets).toBe(3);
    // held: neither the next ask nor a read asks
    await r();
    await r.read();
    expect(gets).toBe(3);
    fail = false;
    now += 20_001;
    expect(isRefusal(await r())).toBe(false);
    const blocked = robinhoodQuotes({ http: async () => ({ status: 451, body: undefined, text: "" }), clock: () => NOW });
    expect(((await blocked()) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
    expect(((await blocked.read()) as Refusal).code).toBe("E_VENUE_GEOBLOCKED");
  });
});

describe("the background reader: the shares someone is looking at, read as their sources write them (UsQuoteFeed)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  /** Robinhood's writer as a stand-in: an answer written every `every` ms from `first`, each book a cent higher at each write (so each is seen
   * to move), the answer as of the moment it is read — its writer stopped from `stopsAt` (the last answer before it served, its stamp and its
   * books, as an edge or a stalled writer serves one) until `resumesAt`, when its writes go on where they would be; Nasdaq answering JPM (and
   * AAPL) with its live shape, `nqMs` later — stamped with this moment's minute where `nqClock` says, as it stamps the last trade of a share
   * that trades. Each GET's moment is kept */
  function sources(first: number, o: { every?: number; nqMs?: number; still?: boolean; moves?: number; stopsAt?: number; resumesAt?: number; nqClock?: boolean } = {}) {
    const every = o.every ?? 15_000;
    const rhGets: number[] = [];
    const nqGets: Array<{ at: number; url: string }> = [];
    /** Nasdaq's live answer as it would be at `ms`: its last trade stamped with that minute (12:mm PM New York, the hour these run in) */
    const nqAt = (r: HttpReply, ms: number): HttpReply => {
      const d = (r.body as { data: Rec }).data;
      const minute = Math.floor((ms - fromEt(2026, 10, 14, 12, 0)) / 60_000);
      return json({ ...(r.body as Rec), data: { ...d, primaryData: { ...(d.primaryData as Rec), lastTradeTimestamp: `Oct 14, 2026 12:${String(minute).padStart(2, "0")} PM ET` } } });
    };
    const http: Http = async (url) => {
      const now = Date.now();
      if (url === ROBINHOOD_PRICES) {
        rhGets.push(now);
        const at = o.stopsAt !== undefined && now >= o.stopsAt && now < (o.resumesAt ?? Infinity) ? o.stopsAt : now;
        const k = Math.max(0, Math.floor((at - first) / every));
        const c = o.still ? 0 : Math.min(k, o.moves ?? Infinity) * 0.01;
        return json({ quotes: [rh("AAPL", (344.36 + c).toFixed(2), (344.39 + c).toFixed(2)), rh("NVDA", (222.52 + c).toFixed(2), (222.55 + c).toFixed(2))].map((x) => ({ ...x, generatedAt: new Date(first + k * every).toISOString() })) });
      }
      nqGets.push({ at: now, url });
      if (o.nqMs) await new Promise((go) => setTimeout(go, o.nqMs));
      const r = url.includes("/JPM/") ? NQ_JPM : url.includes("/AAPL/") ? NQ_AAPL : NQ_NONE;
      return o.nqClock && r !== NQ_NONE ? nqAt(r, Date.now()) : r;
    };
    const quotes = usQuote({ pace: async () => undefined, http });
    const feed = new UsQuoteFeed({ source: "cboe", quotes, listed: (s) => s !== "SATS" });
    const ticks: HubTick[] = [];
    feed.onTick((t) => ticks.push(t));
    return { feed, quotes, rhGets, nqGets, ticks };
  }

  it("covers the US stocks line's tickers alone, its price only; nothing runs until a share is wanted", async () => {
    const { feed, rhGets, nqGets } = sources(NOW - 2_000);
    expect([feed.covers("cboe", "AAPL"), feed.covers("cboe", "BRK.B"), feed.covers("cboe", "BTC/USD"), feed.covers("coinbase", "AAPL")]).toEqual([true, true, false, false]);
    expect(feed.pricesOnly("cboe", "AAPL")).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect([rhGets.length, nqGets.length]).toEqual([0, 0]);
    expect([feed.want("coinbase", "BTC/USD"), feed.book(), feed.trades()]).toEqual([false, undefined, []]);
    feed.close();
  });

  it("ROBINHOOD READ JUST AFTER EACH WRITE: once its answers have said when it writes, each read lands within half a second of the write, one a write — and a share's quote is that write's, told as it moves", async () => {
    const first = NOW - 7_000;
    const { feed, rhGets, ticks } = sources(first);
    expect(feed.want("cboe", "AAPL")).toBe(true);
    // two minutes of it, AAPL wanted all along
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      feed.want("cboe", "AAPL");
    }
    // the first read at once, then the window bisected: from the third write on, each write's first read with it lands within
    // ROBINHOOD_PRECISE_MS of the write, with one or two reads a write
    const writes = new Map<number, number>();
    for (const t of rhGets) {
      const w = Math.floor((t - first) / 15_000);
      if (!writes.has(w)) writes.set(w, (t - first) % 15_000);
    }
    const lags = [...writes.entries()].filter(([w]) => w >= 3).map(([, lag]) => lag);
    expect(lags.length).toBeGreaterThanOrEqual(2);
    for (const lag of lags) expect(lag).toBeLessThan(ROBINHOOD_PRECISE_MS);
    expect(rhGets.length).toBeLessThanOrEqual(2 * writes.size + 3);
    // the quote: Robinhood's, stamped with the write it moved in, live, its source and cadence said, its price the middle (no last trade)
    const q = feed.quote("cboe", "AAPL")!;
    const write = first + Math.floor((Date.now() - first) / 15_000) * 15_000;
    expect(q).toMatchObject({ src: "Robinhood", from: ROBINHOOD_FROM, delayMs: 0, live: true, at: write, seenAt: write, priceAt: write });
    expect(q.everyMs).toBeGreaterThan(14_000);
    expect(q.last).toBeUndefined();
    expect(q.us!.price).toBeCloseTo((q.bid! + q.ask!) / 2, 6);
    // told as it moved: a quote tick for each write it moved in
    expect(ticks.filter((t) => t.symbol === "AAPL" && t.what === "quote").length).toBeGreaterThanOrEqual(3);
    feed.close();
  });

  it("NASDAQ FOR A SHARE ROBINHOOD DOES NOT PRICE, at the same time as Robinhood is read and every NASDAQ_EVERY_MS after; Robinhood's fresh quote stands over Nasdaq's, so a share it prices is not asked of Nasdaq once it does", async () => {
    const first = NOW - 7_000;
    const { feed, rhGets, nqGets } = sources(first, { nqMs: 200 });
    feed.want("cboe", "JPM");
    feed.want("cboe", "AAPL");
    await vi.advanceTimersByTimeAsync(0);
    // at once: Robinhood's first read and Nasdaq for both (Robinhood's first answer is a book first seen: AAPL is not priced yet)
    expect(rhGets).toEqual([NOW]);
    expect(nqGets.map((x) => x.at)).toEqual([NOW, NOW]);
    await vi.advanceTimersByTimeAsync(300);
    // Nasdaq writes nothing on a cadence of its own: what is said is how often the account ASKS it (askedEveryMs), never a write's cadence
    expect(feed.quote("cboe", "JPM")).toMatchObject({ src: "Nasdaq", from: NASDAQ_FROM, last: 334.82, bid: 334.8, ask: 334.85, at: fromEt(2026, 10, 14, 12, 33), askedEveryMs: NASDAQ_EVERY_MS });
    expect([feed.quote("cboe", "JPM")!.priceAt, feed.quote("cboe", "JPM")!.everyMs]).toEqual([undefined, undefined]);
    // AAPL, which Robinhood quotes: Nasdaq's answer, stamped with its last trade's minute, is set aside — never AAPL's first quote while
    // Robinhood is still to give it (ROBINHOOD_FIRST_MS)
    expect(feed.quote("cboe", "AAPL")).toBeUndefined();
    // Robinhood's next write prices AAPL: its quote is AAPL's first, and AAPL is asked of Nasdaq no more; JPM every five seconds
    await vi.advanceTimersByTimeAsync(30_000);
    feed.want("cboe", "JPM");
    feed.want("cboe", "AAPL");
    expect(feed.quote("cboe", "AAPL")!.from).toBe(ROBINHOOD_FROM);
    const aapl = nqGets.filter((x) => x.url.includes("/AAPL/")).map((x) => x.at);
    expect(aapl.every((t) => t < first + 2 * 15_000 + 1_000)).toBe(true);
    const jpm = nqGets.filter((x) => x.url.includes("/JPM/")).map((x) => x.at - NOW);
    expect(jpm.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < jpm.length; i++) expect(jpm[i]! - jpm[i - 1]!).toBeGreaterThanOrEqual(NASDAQ_EVERY_MS);
    feed.close();
  });

  it("NASDAQ IN ONE LINE: every GET of it waits its turn in the process's line for Nasdaq (live/history.ts hostLane), and more shares than the line takes in NASDAQ_EVERY_MS are each asked as often as their turn comes — never faster than the line", async () => {
    const paced: string[] = [];
    const gets: Array<{ at: number; sym: string }> = [];
    const http: Http = async (url) => {
      if (url === ROBINHOOD_PRICES) return json({ quotes: [] });
      gets.push({ at: Date.now(), sym: decodeURIComponent(url.split("/api/quote/")[1]!.split("/")[0]!) });
      return NQ_JPM;
    };
    const quotes = usQuote({ pace: async (host) => void paced.push(host), http });
    const feed = new UsQuoteFeed({ source: "cboe", quotes, listed: () => true });
    const syms = Array.from({ length: 30 }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "X" : ""}`);
    for (const sym of syms) feed.want("cboe", sym);
    for (let s = 0; s < 40; s++) {
      for (const sym of syms) feed.want("cboe", sym);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(paced.length).toBe(gets.length);
    expect(new Set(paced)).toEqual(new Set(["nasdaq"]));
    // thirty shares in a line of eight every two seconds: each asked every 7.5 s at the most
    const every = Math.ceil((30 * HOST_LIMITS.nasdaq.perMs) / HOST_LIMITS.nasdaq.max);
    expect(every).toBe(7_500);
    for (const sym of syms) {
      const at = gets.filter((g) => g.sym === sym).map((g) => g.at);
      expect(at.length, sym).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(every);
    }
    feed.close();
  });

  it("ROBINHOOD STANDS WHILE ITS QUOTE IS YOUNG ENOUGH TO JUDGE AT: a book that has stood still longer than ROBINHOOD_STANDS_MS has Nasdaq asked beside it again, and one source's quote replaces the other's only with a newer stamp — a book unchanged since before Nasdaq's last trade never stands over it", async () => {
    // the age an open order is judged at (live/paper.ts): no share is left without a quote that young while Nasdaq has one
    expect(ROBINHOOD_STANDS_MS).toBe(STOCK_JUDGE_MS);
    const first = NOW - 7_000;
    // AAPL's book moves at Robinhood's write of NOW + 8 s and then stands; Nasdaq stamps AAPL's last trade with the minute it is asked in
    const { feed, nqGets } = sources(first, { moves: 1, nqClock: true });
    /** the clock moved on to NOW + `ms`, AAPL wanted again */
    const to = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(NOW + ms - Date.now());
      feed.want("cboe", "AAPL");
    };
    const asked = (from: number, until: number) => nqGets.filter((x) => x.url.includes("/AAPL/") && x.at >= NOW + from && x.at < NOW + until).length;
    feed.want("cboe", "AAPL");
    await to(300);
    // at once: nothing — Nasdaq's 12:33 set aside while Robinhood, whose first answer is a book first seen, is still to give AAPL's first
    // quote (ROBINHOOD_FIRST_MS)
    expect(feed.quote("cboe", "AAPL")).toBeUndefined();
    expect(asked(0, 300)).toBe(1);
    // Robinhood's write of NOW + 8 s moved the book (read a few seconds after it, as the reader halves its first window): AAPL's first
    // quote — and it stands, so Nasdaq is not asked for AAPL while it is ROBINHOOD_STANDS_MS old at most
    const moved = first + 15_000;
    await to(13_000);
    expect(feed.quote("cboe", "AAPL")).toMatchObject({ src: "Robinhood", at: moved });
    await to(moved - NOW + ROBINHOOD_STANDS_MS);
    expect(asked(13_000, moved - NOW + ROBINHOOD_STANDS_MS)).toBe(0);
    // the book has stood ROBINHOOD_STANDS_MS: Nasdaq asked again at the reader's next look, its 12:34 newer than the book's moment —
    // Nasdaq's quote now
    await to(moved - NOW + ROBINHOOD_STANDS_MS + 1_500);
    expect(asked(moved - NOW + ROBINHOOD_STANDS_MS, moved - NOW + ROBINHOOD_STANDS_MS + 1_500)).toBe(1);
    expect(feed.quote("cboe", "AAPL")).toMatchObject({ src: "Nasdaq", at: fromEt(2026, 10, 14, 12, 34), live: true });
    // Robinhood's next writes, read as they come, carry the same book, unchanged since NOW + 8 s and still within FRESH_MS: older than
    // Nasdaq's last trade, so they do not replace it — and Nasdaq goes on being asked every NASDAQ_EVERY_MS
    const since = moved - NOW + ROBINHOOD_STANDS_MS + 1_500;
    await to(since + 30_000);
    expect(feed.quote("cboe", "AAPL")!.src).toBe("Nasdaq");
    expect(asked(since, since + 30_000)).toBeGreaterThanOrEqual(5);
    feed.close();
  });

  it("A WRITER THAT STOPS IS NOT ASKED FOR AGAIN EACH SECOND: Robinhood's next write past its window is asked for again ROBINHOOD_RETRIES times quickly, then a third of a cadence later, twice that, and a cadence apart from then on — never another round of quick asks — until a write comes, which is read within a cadence, and then just after each write again", async () => {
    const first = NOW - 7_000;
    // the writer's last write before it stops is NOW + 38 s; it goes on at NOW + 160 s
    const stopsAt = NOW + 40_000;
    const resumesAt = NOW + 160_000;
    const { feed, rhGets } = sources(first, { stopsAt, resumesAt });
    feed.want("cboe", "AAPL");
    for (let t = 0; t < 160_000; t += 10_000) {
      await vi.advanceTimersByTimeAsync(10_000);
      feed.want("cboe", "AAPL");
    }
    // what the reader read while no write came: the window's own reads (halving it, then at its end), the quick asks past it once —
    // ROBINHOOD_RETRIES of them — then gaps of a third of a cadence, two thirds, and a cadence from then on; never a quick ask again
    const stalled = rhGets.filter((t) => t >= stopsAt && t < resumesAt);
    const gaps = stalled.slice(1).map((t, i) => t - stalled[i]!);
    expect(gaps.filter((g) => g === ROBINHOOD_RETRY_MS)).toHaveLength(ROBINHOOD_RETRIES);
    expect(gaps.filter((g) => g < 1_000).length).toBeLessThanOrEqual(ROBINHOOD_RETRIES + 2);
    const firstSlow = gaps.findIndex((g) => g >= 1_000);
    const slow = gaps.slice(firstSlow);
    expect(slow.every((g) => g >= 1_000)).toBe(true);
    expect(slow.slice(0, 3)).toEqual([ROBINHOOD_EVERY_MS * ROBINHOOD_BACKOFF, ROBINHOOD_EVERY_MS * ROBINHOOD_BACKOFF * 2, ROBINHOOD_EVERY_MS]);
    for (const g of slow.slice(3)) expect(g).toBe(ROBINHOOD_EVERY_MS);
    // over two minutes: about one read every five seconds at most — and over its last minute, one a cadence
    expect(stalled.length).toBeLessThanOrEqual((resumesAt - stopsAt) / 5_000);
    expect(stalled.filter((t) => t >= resumesAt - 60_000).length).toBeLessThanOrEqual(60_000 / ROBINHOOD_EVERY_MS + 1);
    // the writer goes on: its next write read within a cadence, and from the write after, each read within ROBINHOOD_PRECISE_MS of a write
    for (let t = 0; t < 90_000; t += 10_000) {
      await vi.advanceTimersByTimeAsync(10_000);
      feed.want("cboe", "AAPL");
    }
    const after = rhGets.filter((t) => t >= resumesAt);
    expect(after[0]! - resumesAt).toBeLessThanOrEqual(ROBINHOOD_EVERY_MS);
    const lagOf = (t: number) => (t - first) % 15_000;
    const writeOf = (t: number) => Math.floor((t - first) / 15_000);
    // the writes from the second after it goes on — each whole, its first read among them (a read just before a write is the write
    // before's: the window's halfway read)
    const settled = after.filter((t) => first + writeOf(t) * 15_000 >= resumesAt + 2 * 15_000);
    const seen = new Map<number, number>();
    for (const t of settled) if (!seen.has(writeOf(t))) seen.set(writeOf(t), lagOf(t));
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (const lag of seen.values()) expect(lag).toBeLessThan(ROBINHOOD_PRECISE_MS);
    expect(feed.quote("cboe", "AAPL")).toMatchObject({ src: "Robinhood", live: true });
    feed.close();
  });

  it("a book that stops moving ages: live while its stamp is fresh (FRESH_MS), then told not live; a book first seen and never moving is never taken; a share no one wants is let go US_IDLE_MS after, and with none left nothing is read", async () => {
    const first = NOW - 7_000;
    const still = sources(first, { still: true });
    const release = still.feed.hold("cboe", "NVDA");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(still.feed.quote("cboe", "NVDA")).toBeUndefined();
    // let go: read US_IDLE_MS more, then forgotten, and nothing read after
    release();
    await vi.advanceTimersByTimeAsync(US_IDLE_MS + 2_000);
    expect(still.feed.status()).toEqual([]);
    const reads = still.rhGets.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(still.rhGets.length).toBe(reads);
    still.feed.close();
    // NVDA's book (Nasdaq knows none here) moves at the first two writes, then stands: live, stamped with the write it last moved in, until that stamp is FRESH_MS old
    vi.setSystemTime(NOW);
    const moving = sources(NOW - 7_000, { moves: 1 });
    moving.feed.hold("cboe", "NVDA");
    await vi.advanceTimersByTimeAsync(20_000);
    const q = moving.feed.quote("cboe", "NVDA")!;
    expect(q).toMatchObject({ live: true, at: NOW - 7_000 + 15_000 });
    await vi.advanceTimersByTimeAsync(q.at + FRESH_MS - Date.now() - 2_000);
    expect(moving.feed.quote("cboe", "NVDA")!.live).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(moving.feed.quote("cboe", "NVDA")!.live).toBe(false);
    expect(moving.ticks.filter((t) => t.symbol === "NVDA").map((t) => t.what).slice(-1)).toEqual(["live"]);
    // its age is its own: the quote still says its stamp, not the moment it was last read
    expect(moving.feed.quote("cboe", "NVDA")!.seenAt).toBe(q.at);
    moving.feed.close();
  });

  it("by the session: overnight Robinhood alone (Nasdaq keeps no overnight session); while the market is closed nothing is asked", async () => {
    vi.setSystemTime(fromEt(2026, 10, 14, 22, 0));
    const night = sources(Date.now() - 7_000);
    night.feed.want("cboe", "AAPL");
    night.feed.want("cboe", "JPM");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(night.rhGets.length).toBeGreaterThan(0);
    expect(night.nqGets).toEqual([]);
    night.feed.close();
    vi.setSystemTime(fromEt(2026, 10, 17, 12, 0));
    const saturday = sources(Date.now() - 7_000);
    saturday.feed.want("cboe", "AAPL");
    saturday.feed.want("cboe", "JPM");
    await vi.advanceTimersByTimeAsync(20_000);
    expect([saturday.rhGets.length, saturday.nqGets.length]).toEqual([0, 0]);
    saturday.feed.close();
  });

  it("the listing and the reader share one answer of each source: a listing's ask takes the answer the reader read just after the write, and asks Robinhood nothing", async () => {
    const first = NOW - 7_000;
    const { feed, quotes, rhGets } = sources(first);
    feed.want("cboe", "AAPL");
    await vi.advanceTimersByTimeAsync(20_000);
    const reads = rhGets.length;
    const got = await quotes("AAPL", { listed: () => true });
    expect(got).toMatchObject({ from: ROBINHOOD_FROM, at: feed.quote("cboe", "AAPL")!.at });
    expect(rhGets.length).toBe(reads);
    feed.close();
  });

  /** Robinhood as it was read on Monday 2026-10-19: each write made as several COPIES — `spread` ms after the write's moment each — each
   * served until the same copy of the next write is made, a read answered by the copies in turn: a read a moment after a write may be
   * answered by a copy of the write before, and one just before the next write by a later copy of this one. AAPL's book a cent on at each
   * copy, so each is seen to move. Each GET kept: when, and the write and copy that answered it */
  function copies(first: number, spread = [0, 150, 400]) {
    const gets: Array<{ at: number; write: number; copy: number }> = [];
    let turn = 0;
    const http: Http = async (url) => {
      if (url !== ROBINHOOD_PRICES) return url.includes("/AAPL/") ? NQ_AAPL : NQ_NONE;
      const now = Date.now();
      const c = turn++ % spread.length;
      const k = Math.floor((now - first - spread[c]!) / 15_000);
      gets.push({ at: now, write: k, copy: c });
      const cents = (k * spread.length + c) * 0.01;
      return json({ quotes: [rh("AAPL", (344.36 + cents).toFixed(2), (344.39 + cents).toFixed(2), { generatedAt: new Date(first + k * 15_000 + spread[c]!).toISOString() }), rh("NVDA", "222.52", "222.55", { generatedAt: new Date(first + k * 15_000 + spread[c]!).toISOString() })] });
    };
    return { http, gets };
  }

  it("ONE WRITE, SEVERAL COPIES: a read answered by a later copy of a write takes its books as their newer word, never as the next write — so write after write, each is read within a second of it and its quote told then, with a few reads a write", async () => {
    const first = NOW - 7_000;
    const net = copies(first);
    const quotes = usQuote({ pace: async () => undefined, http: net.http });
    const feed = new UsQuoteFeed({ source: "cboe", quotes, listed: () => true });
    const told: Array<{ at: number; stamp: number }> = [];
    feed.onTick((t) => {
      if (t.what === "quote" && t.symbol === "AAPL") told.push({ at: Date.now(), stamp: feed.quote("cboe", "AAPL")!.at });
    });
    feed.want("cboe", "AAPL");
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      feed.want("cboe", "AAPL");
    }
    // from the fourth write on: the first read answered by any copy of a write comes within a second of the write's first copy
    const writeAt = (k: number) => first + k * 15_000;
    const firstRead = new Map<number, number>();
    for (const g of net.gets) if (!firstRead.has(g.write)) firstRead.set(g.write, g.at - writeAt(g.write));
    const settled = [...firstRead.entries()].filter(([k]) => k >= 4);
    expect(settled.length).toBeGreaterThanOrEqual(9);
    for (const [k, lag] of settled) expect(lag, `write ${k}`).toBeLessThan(1_000);
    // and each write's quote told within a second of it — Robinhood's, stamped with the copy its book moved in
    for (const [k] of settled.slice(0, -1)) {
      const t = told.find((x) => x.stamp >= writeAt(k) && x.stamp < writeAt(k + 1));
      expect(t, `write ${k}`).toBeDefined();
      expect(t!.at - writeAt(k), `write ${k}`).toBeLessThan(1_000);
    }
    expect(net.gets.length).toBeLessThanOrEqual(4 * firstRead.size + 8);
    expect(feed.quote("cboe", "AAPL")).toMatchObject({ src: "Robinhood", live: true });
    feed.close();
  });

  it("an answer read first by another — a listing's ask — is told at once, not a cadence later; and a share wanted while the reader runs is given Robinhood's answer read last, not Nasdaq's", async () => {
    const first = NOW - 7_000;
    const { feed, quotes, rhGets, nqGets } = sources(first);
    feed.want("cboe", "NVDA");
    await vi.advanceTimersByTimeAsync(40_000);
    feed.want("cboe", "NVDA");
    const nvda = () => feed.quote("cboe", "NVDA")!;
    expect(nvda()).toMatchObject({ src: "Robinhood" });
    // just after a write, before the reader's own read: another read of Robinhood brings it (a listing's, or a paper account's)
    const next = first + Math.ceil((Date.now() - first) / 15_000) * 15_000;
    await vi.advanceTimersByTimeAsync(next + 20 - Date.now());
    const reads = rhGets.length;
    await quotes.robinhood.read();
    expect(rhGets.length).toBe(reads + 1);
    // told at the reader's next look at the latest — within a second — never at the write after
    await vi.advanceTimersByTimeAsync(1_000);
    expect(nvda().at).toBe(next);
    // AAPL wanted now: Robinhood's answer read last prices it at once — Robinhood's quote its first, Nasdaq never asked for it
    const asked = nqGets.length;
    feed.want("cboe", "AAPL");
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.quote("cboe", "AAPL")).toMatchObject({ src: "Robinhood", at: next, live: true });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(nqGets.slice(asked).filter((x) => x.url.includes("/AAPL/"))).toEqual([]);
    feed.close();
  });

  it("A SHARE'S FIRST QUOTE IS ROBINHOOD'S where Robinhood quotes it: Nasdaq's, stamped with the minute, is set aside — told never, where Robinhood gives its first in time; taken after ROBINHOOD_FIRST_MS where Robinhood's book has not moved; at once where Robinhood refuses", async () => {
    // a book that moves: Robinhood's quote is AAPL's first, and no Nasdaq quote of AAPL is ever told
    const moving = sources(NOW - 7_000, { nqMs: 200 });
    const toldFrom: string[] = [];
    moving.feed.onTick((t) => {
      if (t.symbol === "AAPL" && t.what === "quote") toldFrom.push(moving.feed.quote("cboe", "AAPL")!.src);
    });
    moving.feed.want("cboe", "AAPL");
    for (let t = 0; t < ROBINHOOD_FIRST_MS + 10_000; t += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000);
      moving.feed.want("cboe", "AAPL");
    }
    expect(moving.nqGets.some((x) => x.url.includes("/AAPL/"))).toBe(true);
    expect(moving.feed.quote("cboe", "AAPL")).toMatchObject({ src: "Robinhood" });
    expect(toldFrom.length).toBeGreaterThanOrEqual(2);
    expect(new Set(toldFrom)).toEqual(new Set(["Robinhood"]));
    expect(moving.feed.status()).toEqual([{ symbol: "AAPL", live: true, from: ROBINHOOD_FROM }]);
    moving.feed.close();
    // a book that never moves: Robinhood cannot give its first quote — Nasdaq's taken once ROBINHOOD_FIRST_MS has passed, not before
    vi.setSystemTime(NOW);
    const still = sources(NOW - 7_000, { still: true, nqMs: 200 });
    still.feed.want("cboe", "AAPL");
    await vi.advanceTimersByTimeAsync(ROBINHOOD_FIRST_MS - 1_000);
    still.feed.want("cboe", "AAPL");
    expect(still.feed.quote("cboe", "AAPL")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(still.feed.quote("cboe", "AAPL")).toMatchObject({ src: "Nasdaq", from: NASDAQ_FROM, live: true });
    still.feed.close();
    // Robinhood refusing this network: Nasdaq's at once
    vi.setSystemTime(NOW);
    const http: Http = async (url) => (url === ROBINHOOD_PRICES ? { status: 451, body: undefined, text: "" } : url.includes("/AAPL/") ? NQ_AAPL : NQ_NONE);
    const refused = new UsQuoteFeed({ source: "cboe", quotes: usQuote({ pace: async () => undefined, http }), listed: () => true });
    refused.want("cboe", "AAPL");
    await vi.advanceTimersByTimeAsync(300);
    expect(refused.quote("cboe", "AAPL")).toMatchObject({ src: "Nasdaq", from: NASDAQ_FROM });
    refused.close();
  });
});

describe("the network these sources are read through", () => {
  it("the fixed-host guard passes on a GET's method, headers and time limit only, and a body is kept to its first 2000 characters, whatever else a caller passes", async () => {
    const seen: unknown[] = [];
    const spy: Http = async (_url, init) => {
      seen.push(init);
      return json({ quotes: [] });
    };
    // options the Http type does not have
    const extra = { charset: "x", full: true } as unknown as Parameters<Http>[1];
    await fixedHosts(spy, PUBLIC_HOSTS, 2_500)(ROBINHOOD_PRICES, extra);
    expect(seen).toEqual([{ method: "GET", headers: { accept: "application/json" }, timeoutMs: 2_500 }]);
    vi.stubGlobal("fetch", async () => new Response("x".repeat(5_000), { status: 200 }));
    try {
      const r = await realHttp(ROBINHOOD_PRICES, extra);
      expect([r.status, r.text.length]).toEqual([200, 2_000]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
