/** ONE MARKET'S PRICE HISTORY AS THE SERVICE ASKS IT (service.ts candles, feat/paper-live phase H): a range's first view in its own bar size,
 * the page before a bar a chart has, the window handed to the source, the answer held to it with the source's own words, and the memory
 * that absorbs the same ask repeated — keyed by the window, bounded, and never asking a source that said it cannot be asked just now. A
 * stand-in public source records every window it is asked; nothing leaves the process. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { simKey } from "../../src/portfolio/account/sign.ts";
import type { LiveDeps } from "../../src/portfolio/live/index.ts";
import type { Listing, PublicSource } from "../../src/portfolio/live/public-markets.ts";
import { INTERVAL_MS, type Candle, type CandleInterval, type CandlePage, type CandleWindow } from "../../src/portfolio/live/trade.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { historyAsk, PortfolioService, type CandlesView } from "../../src/portfolio/service.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-17T07:03:30Z");
const owner = simKey("owner");
const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const view = (r: CandlesView | Refusal): CandlesView => {
  if (isRefusal(r)) throw new Error(`refused: ${r.code} ${r.message}`);
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

async function service(src: PublicSource) {
  const home = mkdtempSync(join(tmpdir(), "candles-range-"));
  homes.push(home);
  const liveDeps: Partial<LiveDeps> = { clock: () => NOW, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  return PortfolioService.create({ home, now: () => new Date(NOW).toISOString(), venues: "frontline", real: true, liveDeps, publicMarkets: [src], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(NOW).toISOString() }] } });
}

describe("a range's first view, and the page before a bar", () => {
  it("a range in its own bar size: its start on the calendar, the latest 5,000 bars at most, the range said to the source; the answer held to the window, with the source's words", async () => {
    const src = source();
    const svc = await service(src.s);
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
    const day = view(await svc.candles("pubx", "BTC/USD", "5m"));
    expect([day.range, src.asked.at(-1)!.w]).toEqual(["1D", { since: NOW - DAY, limit: 5_000, range: "1D" }]);
  });

  it("the page before a bar: one window that ends there, three hundred bars unless asked otherwise, a thousand at most", async () => {
    const src = source();
    const svc = await service(src.s);
    const before = NOW - 3 * DAY;
    const v = view(await svc.candles("pubx", "BTC/USD", "1h", { before: String(before), limit: "48" }));
    expect(src.asked.at(-1)!.w).toEqual({ until: before, limit: 48 });
    expect([v.before, v.range, v.candles.length, v.candles.every((b) => b.t < before), v.more]).toEqual([before, undefined, 48, true, true]);
    await svc.candles("pubx", "BTC/USD", "1h", { before });
    expect(src.asked.at(-1)!.w).toEqual({ until: before, limit: 300 });
  });

  it("whose bars they are: an exchange's chart drawn from another venue (a Kraken pair's from Coinbase Exchange) names that venue, so the chart's name and the page's source never disagree; its own bars name nothing more", async () => {
    const other = view(await (await service(source({ from: "Coinbase Exchange · BTC-USD" }).s)).candles("pubx", "BTC/USD", "", { range: "1D" }));
    expect([other.venueName, other.from, other.source]).toEqual(["Pubx", "Coinbase Exchange", "Coinbase Exchange · BTC-USD"]);
    const own = view(await (await service(source().s)).candles("pubx", "BTC/USD", "", { range: "1D" }));
    expect([own.venueName, own.from]).toEqual(["Pubx", undefined]);
  });

  it("refuses what cannot be asked, in words, before any source is", async () => {
    const src = source();
    const svc = await service(src.s);
    expect(refusal(await svc.candles("pubx", "BTC/USD", "2h")).message).toBe("price history is by 1m, 5m, 15m, 1h, 4h, 1d, 1w");
    expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "10Y" })).message).toBe("a range is one of 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX");
    expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "1M", before: "1" })).message).toBe("price history is asked for a range or for the page before a bar, not both");
    expect(refusal(await svc.candles("pubx", "BTC/USD", "1h", { before: "-5" })).message).toBe("a page of price history is asked before a bar's start, in milliseconds");
    expect(refusal(await svc.candles("pubx", "BTC/USD", "1h", { range: "1M", limit: "5001" })).message).toBe("a view of price history holds 1 to 5,000 bars");
    expect(src.asked).toEqual([]);
    expect(historyAsk("", { range: "ytd" })).toEqual({ iv: "1d", range: "YTD", limit: 5_000 });
  });
});

describe("an asset's price history (GET /api/account/asset: the Market sheet's line where the venue gives no candles)", () => {
  it("is drawn over the range asked, as the candles read is — else over the range of its bar size alone; a range that is not one is refused before any source is asked", async () => {
    const src = source();
    const svc = await service(src.s);
    const asked = (r: unknown) => {
      if (isRefusal(r)) throw new Error(`refused: ${r.code} ${r.message}`);
      return src.asked.at(-1)!;
    };
    // 5D pressed: five days of 5-minute bars, not the one day 5-minute bars alone are drawn over
    expect(asked(await svc.asset("crypto:BTC", "5m", "5D"))).toMatchObject({ symbol: "BTC/USD", interval: "5m", w: { since: NOW - 5 * DAY, range: "5D" } });
    expect(asked(await svc.asset("crypto:BTC", "4h", "6m"))).toMatchObject({ interval: "4h", w: { range: "6M" } });
    expect(asked(await svc.asset("crypto:BTC", "5m"))).toMatchObject({ interval: "5m", w: { since: NOW - DAY, range: "1D" } });
    const n = src.asked.length;
    expect(refusal(await svc.asset("crypto:BTC", "1d", "10Y")).message).toBe("a range is one of 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX");
    expect(src.asked).toHaveLength(n);
  });
});

describe("the memory: the same ask once, keyed by its window, bounded", () => {
  it("the same range asked again is answered from memory; another range, another size or a page is asked of the source", async () => {
    const src = source();
    const svc = await service(src.s);
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
    const svc = await service(src.s);
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
    const svc = await service(src.s);
    expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "1M" })).message).toBe("Pubx refused the request (HTTP 400)");
    expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "1M" })).message).toBe("Pubx refused the request (HTTP 400)");
    expect(src.asked).toHaveLength(2);
    answer = no("E_VENUE_GEOBLOCKED", { venue: "pubx", message: "Pubx does not serve this location: that is its own rule, and the account does not look for a way around it" });
    expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "5D" })).code).toBe("E_VENUE_GEOBLOCKED");
    expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "1Y" })).code).toBe("E_VENUE_GEOBLOCKED");
    expect(src.asked).toHaveLength(3);
  });
});
