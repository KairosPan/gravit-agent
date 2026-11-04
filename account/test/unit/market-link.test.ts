/** THE ACCOUNT'S LINK TO THE MARKET (src/portfolio/market/*): a real market in this process (market/src, over fakes), and the account's
 * link reading it over HTTP — its sources, a source's refusal, the market down and back, the source list filling in, China, a price, the
 * hub's mirror and its reconnect, and the hub's covers agreed with the market's own fixture. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { MARKET_DOWN } from "../../src/portfolio/market/client.ts";
import { connectMarket, type MarketLink } from "../../src/portfolio/market/link.ts";
import { hubCovers, readAtOf, type Listing } from "../../src/portfolio/market/shapes.ts";
import { usClock } from "../../src/portfolio/account/calendar.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { usClock as marketUsClock } from "../../../market/src/calendar.ts";
import type { MarketServerHandle } from "../../../market/src/server.ts";
import { createMarketCore, fakeChina, fakeHub, fakeSource, freePort, READ_AT, startMarket } from "../market-fakes.ts";

const ROWS = JSON.parse(readFileSync(new URL("../../../market/test/fixtures/hub-covers.json", import.meta.url), "utf8")) as Array<{ source: string; symbol: string; covers: boolean; pricesOnly: boolean }>;

const links: MarketLink[] = [];
const markets: MarketServerHandle[] = [];
const homes: string[] = [];
afterEach(async () => {
  for (const l of links.splice(0)) l.close();
  for (const m of markets.splice(0)) await m.close();
});
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

const price = async (asset: string) => (asset === "BTC" ? 62_000 : undefined);
/** a market over fakes, and a link to it, started */
async function boot(o: { port?: number } = {}) {
  const source = fakeSource();
  const hub = fakeHub();
  const china = fakeChina();
  const core = createMarketCore({ sources: [source], hub: hub.hub, china, price });
  const market = await startMarket(core, o.port ?? 0);
  markets.push(market);
  const link = connectMarket({ url: market.url });
  links.push(link);
  link.start();
  expect(await link.ready(3_000)).toBe(true);
  return { source, hub, china, core, market, link, port: Number(new URL(market.url).port) };
}
const until = async (ok: () => boolean | Promise<boolean>, ms = 6_000): Promise<void> => {
  const t0 = Date.now();
  while (!(await ok())) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((go) => setTimeout(go, 25));
  }
};
const refused = (v: unknown): Refusal => {
  if (!isRefusal(v)) throw new Error(`expected a refusal, got ${JSON.stringify(v).slice(0, 200)}`);
  return v;
};

describe("the account's link to the market", () => {
  it("lists the market's sources and reads a listing with its read time", async () => {
    const { link } = await boot();
    const s = link.sources()[0]!;
    expect(s.id).toBe("fake");
    expect(s).toMatchObject({ name: "Fake Ex", kind: "exchange", connectTo: "fake", connector: "live:exchange:fake" });
    // what the source answers, and nothing it does not: a line and notes, no book, no feed
    expect([typeof s.line, typeof s.notes, s.book, s.feed, s.sessions]).toEqual(["function", "function", undefined, undefined, undefined]);
    const got = (await s.listings({ q: "BTC", limit: 5 })) as Listing[];
    expect(got.map((m) => m.symbol)).toEqual(["BTC/USD"]);
    expect(readAtOf(got[0])).toBe(READ_AT);
    expect(s.notes!({ q: "BTC" })).toEqual(["fake note"]);
  });

  it("gives a source the account's own US clock where the market names New York's, and none where it names none", async () => {
    const stocks = { ...fakeSource({ id: "cboe" }), sessions: marketUsClock };
    const m = await startMarket(createMarketCore({ sources: [stocks, fakeSource()] }));
    markets.push(m);
    const link = connectMarket({ url: m.url });
    links.push(link);
    expect(await link.ready(3_000)).toBe(true);
    const [cboe, fake] = link.sources();
    expect([cboe!.id, cboe!.sessions]).toEqual(["cboe", usClock]);
    expect([fake!.id, fake!.sessions]).toEqual(["fake", undefined]);
  });

  it("hands a source's refusal back unchanged", async () => {
    const { link } = await boot();
    const r = refused(await link.sources()[0]!.listings({ q: "NOPE", limit: 5 }));
    expect([r.code, r.message]).toEqual(["E_VENUE_REJECTED", "Fake Ex refused the request (HTTP 400)"]);
  });

  it("refuses with MARKET_DOWN while the market is down, and answers again when it is back", async () => {
    const { link, market, core, port } = await boot();
    const s = link.sources()[0]!;
    expect(link.marketOld()).toBeUndefined();
    await market.close();
    markets.splice(markets.indexOf(market), 1);
    const r = refused(await s.listings({ q: "ETH", limit: 5 }));
    expect(r).toMatchObject({ code: "E_VENUE_UNREACHABLE", venue: "market", message: MARKET_DOWN });
    expect(link.marketOld()?.message).toBe(MARKET_DOWN);
    expect(Date.parse(link.marketOld()!.since)).toBeGreaterThan(0);
    markets.push(await startMarket(core, port));
    // a refusal is kept two seconds at most: the same ask answers once the market is back
    await until(async () => !isRefusal(await s.listings({ q: "ETH", limit: 5 })));
    expect(((await s.listings({ q: "ETH", limit: 5 })) as Listing[]).map((m) => m.symbol)).toEqual(["ETH/USD"]);
    expect(link.marketOld()).toBeUndefined();
  });

  it("sources fill in once the market answers", async () => {
    // what the account reads of them (a paper account's prices, a coin's day) is wrapped again when the list changes (service.ts
    // publicMarkets); the public Markets list itself is the market's own explore
    const port = await freePort();
    const link = connectMarket({ url: `http://127.0.0.1:${port}` });
    links.push(link);
    link.start();
    expect(link.sources()).toEqual([]);
    expect(await link.ready(200)).toBe(false);
    markets.push(await startMarket(createMarketCore({ sources: [fakeSource()], hub: fakeHub().hub, price }), port));
    await until(() => link.sources().some((s) => s.id === "fake"), 6_000);
    expect(await link.ready(100)).toBe(true);
    const listed = await link.sources().find((s) => s.id === "fake")!.listings({ q: "BTC", limit: 20 });
    if (isRefusal(listed)) throw new Error(listed.message);
    expect(listed.some((m) => m.symbol === "BTC/USD")).toBe(true);
  }, 20_000);

  it("reads China and its status", async () => {
    const { link, market } = await boot();
    const q = await link.china.quotes(["sh600519", "sz000001"]);
    if (isRefusal(q)) throw new Error(q.message);
    expect(q).toBeInstanceOf(Map);
    expect([...q.keys()]).toEqual(["sh600519"]);
    expect(q.get("sh600519")).toMatchObject({ symbol: "sh600519", currency: "CNY", price: 1500 });
    expect(link.china.status().state).toBe("live");
    await market.close();
    markets.splice(markets.indexOf(market), 1);
    expect(isRefusal(await link.china.quotes(["sh600519", "sh600000"]))).toBe(true);
    expect(link.china.status()).toEqual({ state: "unavailable", said: MARKET_DOWN });
  });

  it("prices an asset, and keeps its last price while the market is down", async () => {
    const { link, market } = await boot();
    expect(await link.price("BTC")).toBe(62_000);
    await market.close();
    markets.splice(markets.indexOf(market), 1);
    expect(await link.price("BTC")).toBe(62_000);
    expect(await link.price("DOGE")).toBeUndefined();
  });

  it("mirrors a held market: quote, book for a book hold, trades and since", async () => {
    const { link, hub } = await boot();
    const src = "coinbase";
    const sym = "BTC/USD";
    expect(link.hub.covers(src, sym)).toBe(true);
    const release = link.hub.hold(src, sym, { book: true });
    await until(() => hub.seen.holds.includes(`${src}|${sym}|book`));
    hub.quote(src, sym, { bid: 61_999, ask: 62_001, last: 62_000 });
    hub.book(src, sym, { bids: [[61_999, 1]], asks: [[62_001, 2]] });
    hub.trade(src, sym, 62_000);
    hub.trade(src, sym, 62_010);
    await until(() => link.hub.quote(src, sym)?.bid === 61_999 && link.hub.book(src, sym)?.bids.length === 1 && link.hub.trades(src, sym, 10).length === 2);
    expect(link.hub.quote(src, sym)).toMatchObject({ bid: 61_999, ask: 62_001, live: true });
    expect(link.hub.book(src, sym)).toMatchObject({ bids: [[61_999, 1]], asks: [[62_001, 2]] });
    expect(link.hub.trades(src, sym, 10).map((t) => t.price)).toEqual([62_010, 62_000]);
    expect(link.hub.since(src, sym, 0).trades).toBe(hub.hub.since(src, sym, 0).trades);
    expect(link.hub.since(src, sym, 0)).toMatchObject({ hi: 62_010, lo: 62_000, trades: 2 });
    // the next since starts where this one stands: nothing counted twice
    const at = link.hub.since(src, sym, 0).seq;
    expect(link.hub.since(src, sym, at).trades).toBe(0);
    expect(await link.hub.confirmed(src, sym, 60_000, 0)).toMatchObject({ bid: 61_999 });
    release();
    await until(() => hub.seen.releases.includes(`${src}|${sym}|book`));
  });

  it("the hub reconnects and holds again", async () => {
    const { link, hub, market, core, port } = await boot();
    const src = "coinbase";
    const sym = "ETH/USD";
    link.hub.hold(src, sym);
    await until(() => hub.seen.holds.filter((k) => k === `${src}|${sym}`).length === 1);
    hub.quote(src, sym, { bid: 3_000, ask: 3_001 });
    await until(() => link.hub.quote(src, sym)?.bid === 3_000);
    const ticks: string[] = [];
    link.hub.onTick((t) => ticks.push(`${t.what}|${t.symbol}`));
    await market.close();
    markets.splice(markets.indexOf(market), 1);
    // the stream dropped: the mirror is not live, and says so
    await until(() => link.hub.quote(src, sym)?.live === false);
    expect(ticks).toContain(`live|${sym}`);
    expect(await link.hub.confirmed(src, sym, 60_000, 0)).toBeUndefined();
    markets.push(await startMarket(core, port));
    // back: the hold sent again with no new hold here, and a new quote reaches the mirror
    await until(() => hub.seen.holds.filter((k) => k === `${src}|${sym}`).length === 2, 8_000);
    hub.quote(src, sym, { bid: 3_010, ask: 3_011 });
    await until(() => link.hub.quote(src, sym)?.bid === 3_010 && link.hub.quote(src, sym)?.live === true);
  }, 20_000);

  it("covers every row of the market's fixture", () => {
    expect(ROWS.length).toBeGreaterThan(10);
    for (const r of ROWS) expect(hubCovers(r.source, r.symbol), `${r.source} ${r.symbol}`).toEqual({ covers: r.covers, pricesOnly: r.pricesOnly });
    const { link } = { link: connectMarket({ url: "http://127.0.0.1:9" }) };
    for (const r of ROWS) expect([link.hub.covers(r.source, r.symbol), link.hub.pricesOnly!(r.source, r.symbol)], `${r.source} ${r.symbol}`).toEqual([r.covers, r.pricesOnly]);
    link.close();
  });
});
