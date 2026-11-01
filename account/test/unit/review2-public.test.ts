import { describe, expect, it } from "vitest";
import { KALSHI_SERIES } from "../../src/portfolio/live/categories.ts";
import { kalshiPublic, polymarketPublic, type Listing } from "../../src/portfolio/live/public-markets.ts";
import type { Http, HttpReply } from "../../src/portfolio/live/types.ts";

/** Review round 2, lens "public" (the keyless path with nothing connected): findings against stand-ins, each written as the behaviour
 * the product promises. Finding 2 and the drawing half of 3 were the Account's own page's and left with it; what the venues' reads
 * answer stays.
 *
 *   1. Kalshi "busiest first" read only the first page of GET /markets (Kalshi's own order: newest created first, 1000 a page), so a
 *      market that trades 150k contracts a day further down was not listed while a 5k-contract weather market on page 1 was. Live on
 *      2026-10-06: page 1's busiest was 5,666 contracts; KXFEDDECISION-26OCT-H0 151,820 was not in the listing. Fixed by reading a few
 *      busy SERIES (categories.ts KALSHI_SERIES) with GET /events?series_ticker=&with_nested_markets=true each, and never GET /markets
 *      as a whole: the Fed decision is one small answer, and the Predictions tab is a few hot markets, as the owner asked.
 *   3. A Polymarket market whose endDate has passed but that Polymarket still lists as active, not closed and accepting orders (Gamma's own
 *      flags; "Will Lula win…" traded all day on 2026-10-06 with an endDate of 2026-10-05) is listed open, as its venue says.
 */

const NOW = Date.parse("2026-10-06T17:00:00.000Z");
const json = (body: unknown, status = 200): HttpReply => ({ status, body, text: JSON.stringify(body) });
const query = (url: string): Record<string, string> => Object.fromEntries(new URL(url).searchParams.entries());

function network(routes: Array<[string, HttpReply | ((url: string) => HttpReply)]>) {
  const sent: string[] = [];
  const http: Http = async (url) => {
    sent.push(url);
    const hit = routes.find(([k]) => url.includes(k));
    if (!hit) return json({ error: "not found" }, 404);
    return typeof hit[1] === "function" ? hit[1](url) : hit[1];
  };
  return { http, sent };
}

const kalshiMarket = (ticker: string, event: string, vol24h: number, title: string) => ({
  ticker,
  event_ticker: event,
  status: "active",
  title,
  yes_bid_dollars: "0.50",
  yes_ask_dollars: "0.52",
  no_bid_dollars: "0.48",
  no_ask_dollars: "0.50",
  last_price_dollars: "0.51",
  previous_price_dollars: "0.45",
  volume_24h_fp: String(vol24h),
  volume_fp: String(vol24h * 3),
  close_time: "2026-10-07T08:00:00Z",
});

describe("review2 · public (keyless) lens", () => {
  it("F1 · Kalshi's listing is its busiest markets by series, not the busiest of the newest 1000: the Fed decision, far down Kalshi's list, is listed", async () => {
    // Kalshi's GET /markets?status=open lists its newest markets first: on 2026-10-06 the first thousand held a 5,666-contract weather market
    // and nothing of the Fed. The series read asks GET /events?series_ticker= instead, where the Fed decision is one small answer
    const page1 = [kalshiMarket("KXTEMPMIAH-26OCT0613-T88.99", "KXTEMPMIAH-26OCT0613", 5_666, "Will the temp in Miami be above 88.99°?")];
    const fed = { event_ticker: "KXFEDDECISION-26OCT", series_ticker: "KXFEDDECISION", title: "Fed decision in Oct 2026?", category: "Economics", markets: [kalshiMarket("KXFEDDECISION-26OCT-H0", "KXFEDDECISION-26OCT", 151_820, "Will the Federal Reserve Hike rates by 0bps at their October 2026 meeting?")] };
    const net = network([
      ["/trade-api/v2/markets?", json({ markets: page1, cursor: "page2" })],
      ["/trade-api/v2/events?", (url) => json({ events: query(url).series_ticker === "KXFEDDECISION" ? [fed] : [], cursor: "" })],
    ]);
    const got = (await kalshiPublic({ http: net.http, clock: () => NOW }).listings({ limit: 10 })) as Listing[];
    const tickers = [...new Set(got.map((m) => m.symbol.split(":")[0]))];
    // the whole list is never read; each curated series is, once
    expect(net.sent.filter((u) => u.includes("/markets?"))).toEqual([]);
    expect(net.sent.filter((u) => u.includes("/events?series_ticker="))).toHaveLength(KALSHI_SERIES.length);
    expect(KALSHI_SERIES.map((s) => s.ticker)).toContain("KXFEDDECISION");
    // the Fed decision is listed, with its event and category; the weather market is not
    expect(tickers).toEqual(["KXFEDDECISION-26OCT-H0"]);
    expect(got[0]).toMatchObject({ symbol: "KXFEDDECISION-26OCT-H0:YES", category: "Economics", contracts24h: 151_820, event: { id: "KXFEDDECISION-26OCT", title: "Fed decision in Oct 2026?" } });
  });

  it("F3 · a Polymarket market past its endDate that Polymarket still trades is listed open, in Polymarket's own words", async () => {
    // Gamma's own answer on 2026-10-06 for the Lula market (endDate 2026-10-05, active, not closed, accepting orders, a live book)
    const gamma = network([
      ["/events?", json([{ id: "45915", title: "Brazil Presidential Election", endDate: "2026-10-05T03:59:00Z", tags: [{ label: "Politics", slug: "politics" }], markets: [{ slug: "lula-2026", conditionId: `0x${"ab".repeat(32)}`, question: "Will Lula win the 2026 Brazilian presidential election?", outcomes: '["Yes","No"]', outcomePrices: '["0.155","0.845"]', bestBid: 0.15, bestAsk: 0.16, oneDayPriceChange: -0.01, volume24hr: 1_185_573, endDate: "2026-10-05T03:59:00Z", active: true, closed: false, archived: false, enableOrderBook: true, acceptingOrders: true }] }])],
    ]);
    const legs = (await polymarketPublic({ http: gamma.http, clock: () => NOW }).listings({ limit: 5 })) as Listing[];
    expect(legs[0]).toMatchObject({ symbol: "lula-2026:Yes", open: true, closeTime: "2026-10-05T03:59:00Z" });
  });
});
