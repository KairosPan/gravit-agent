import { describe, expect, it, vi } from "vitest";
import { exploreAcross, type ExploreVenue } from "../../src/portfolio/live/explore.ts";
import { scopedExploreVenues } from "../../src/portfolio/live/market-scope.ts";
import type { LiveTrader, Market } from "../../src/portfolio/live/trade.ts";
import type { PublicSource } from "../../src/portfolio/market/shapes.ts";

const market = (symbol: string, base: string, dex?: string, spot = false): Market => ({ symbol, base, name: symbol, kind: spot ? "spot" : "perp", quote: "USDC", types: [], price: 100, open: true, ...(dex !== undefined ? { dex } : {}) });
const native = market("BTC/USDC:USDC", "BTC", "");
const xyz = market("XYZ-NVDA/USDC:USDC", "xyz:NVDA", "xyz");
const gold = market("XYZ-GOLD/USDC:USDC", "xyz:GOLD", "xyz");
const other = market("IO-ANTH/USDC:USDC", "ANTH", "io");
const spot = market("HYPE/USDC", "HYPE", undefined, true);
const source = (id: string, connector: string, kind: PublicSource["kind"] = "exchange"): PublicSource => ({ id, name: id, connector, connectTo: id, kind, listings: async () => [] });

describe("connected Markets scopes", () => {
  it("filters exact-source venues and products before stats or the result limit", async () => {
    const preipo: Market = { ...native, symbol: "ANTH/USDC:USDC", base: "ANTH", category: "Pre-IPO", group: { id: "preipo:anthropic", title: "Anthropic" }, implied: { perPoint: 1e9, unit: "USD billions" } };
    const markets = vi.fn(async () => [native, spot, preipo]);
    const stats = vi.fn(async (symbols: string[]) => new Map(symbols.map((s) => [s, { price: 100 }])));
    const unrelated = vi.fn(async () => [spot]);
    const venues: ExploreVenue[] = [
      { id: "okx-key", name: "OKX", connector: "live:exchange:okx", trader: { can: true, markets, stats } as unknown as LiveTrader },
      { id: "kraken-key", name: "Kraken", connector: "live:exchange:kraken", trader: { can: true, markets: unrelated } as unknown as LiveTrader },
    ];
    const ordinary = await exploreAcross({ connected: scopedExploreVenues(venues, "more", source("okx", "live:exchange:okx")) }, { limit: 1 });
    expect(ordinary.items.map((i) => i.key)).toEqual(["coin:HYPE"]);
    expect(stats).toHaveBeenCalledWith([spot.symbol]);
    expect(unrelated).not.toHaveBeenCalled();
    expect(markets).toHaveBeenCalledWith("", "more", "okx");
    stats.mockClear();
    const contracts = await exploreAcross({ connected: scopedExploreVenues(venues, "more", source("okx-preipo", "live:exchange:okx")) });
    expect(contracts.items.map((i) => i.key)).toEqual(["preipo:anthropic"]);
    expect(stats).toHaveBeenCalledWith([preipo.symbol]);
  });

  it("uses token issuer metadata to keep a selected wallet product separate from other wallet markets", async () => {
    const token = (base: string, issuer: string): Market => ({ ...spot, symbol: base, base, kind: "token", category: "RWA", issuer });
    const robinhood = token("NVDA", "Robinhood Assets (Jersey) Limited");
    const markets = vi.fn(async () => [spot, robinhood, token("NVDAON", "Ondo Global Markets"), token("NVDAX", "Backed (xStocks)")]);
    const events = vi.fn(async () => []);
    for (const connector of ["live:wallet", "live:metamask"]) {
      const venues: ExploreVenue[] = [{ id: "wallet", name: "Wallet", connector, trader: { can: true, markets, events } as unknown as LiveTrader }];
      const r = await exploreAcross({ connected: scopedExploreVenues(venues, "more", source("robinhood-stock-tokens", "live:wallet", "tokens")) });
      expect(r.items.map((i) => i.key)).toEqual(["rwa:NVDA"]);
    }
    expect(events).not.toHaveBeenCalled();
  });

  it("passes selected sources to paper listing and event readers and retains the actual source on each leg", async () => {
    const markets = vi.fn(async () => [{ ...spot, publicSource: "okx" }, { ...native, publicSource: "other" }]);
    const events = vi.fn(async (_options: unknown, _source?: string) => []);
    const venues: ExploreVenue[] = [{ id: "paper", name: "Paper", paper: true, connector: "live:paper", trader: { can: true, markets, events } as unknown as LiveTrader }];
    const r = await exploreAcross({ connected: scopedExploreVenues(venues, "more", source("okx", "live:exchange:okx")) });
    expect(r.items.map((i) => i.key)).toEqual(["coin:HYPE"]);
    expect(r.items[0]?.at[0]).toMatchObject({ paper: true, publicSource: "okx" });
    expect(markets).toHaveBeenCalledWith("", "more", "okx");
    expect(events).not.toHaveBeenCalled();
    await exploreAcross({ connected: scopedExploreVenues(venues, "more", source("kalshi", "live:kalshi", "events")) });
    expect(events).toHaveBeenCalled();
    expect(events.mock.calls.every((call) => call[1] === "kalshi")).toBe(true);
  });

  it("keeps connected and paper-only category tabs aligned, including raw preipo without a valuation unit", async () => {
    const cases = [["NVDA", "stocks"], ["XYZ100", "indices"], ["GOLD", "commodities"], ["EUR", "fx"], ["ANT", "preipo"], ["NEW", undefined]] as const;
    const rows = [{ ...native, category: "crypto" }, ...cases.map(([base, category]) => ({ ...market(`XYZ-${base}/USDC:USDC`, `xyz:${base}`, "xyz"), ...(category ? { category } : {}) }))];
    for (const paper of [false, true]) {
      const venues: ExploreVenue[] = [{ id: "mine", name: "My HL", connector: paper ? "live:hyperliquid-paper" : "live:hyperliquid-trade", ...(paper ? { paper: true } : {}), trader: { can: true, markets: async () => rows } as unknown as LiveTrader }];
      const all = await exploreAcross({ connected: scopedExploreVenues(venues, "xyz") });
      expect(all.items).toHaveLength(cases.length);
      for (const [base, category] of cases) {
        const item = all.items.find((i) => i.key === `perp:xyz:${base}`)!;
        expect(item.tabs).toEqual(["all", "perps", ...(category ? [category] : [])]);
        expect(item.kind).toBe("perp");
        expect(item.implied).toBeUndefined();
        expect(item.group).toBeUndefined();
        expect(item.paper === true).toBe(paper);
      }
      const stock = await exploreAcross({ connected: scopedExploreVenues(venues, "xyz") }, { tab: "stocks", limit: 1 });
      expect(stock.items.map((i) => i.key)).toEqual(["perp:xyz:NVDA"]);
      const crypto = await exploreAcross({ connected: scopedExploreVenues(venues, "hyperliquid") }, { tab: "crypto" });
      expect(crypto.items[0]?.tabs).toEqual(["all", "perps", "crypto"]);
    }
  });

  it("prices the full scoped universe in bounded batches before ranking, including a mover beyond the old forty", async () => {
    const rows = Array.from({ length: 85 }, (_, i) => market(`XYZ-COIN${i}/USDC:USDC`, `xyz:COIN${i}`, "xyz"));
    const stats = vi.fn(async (symbols: string[]) => {
      expect(symbols.length).toBeLessThanOrEqual(40);
      return new Map(symbols.map((symbol) => [symbol, { price: 100, volumeUsd24h: symbol.includes("COIN84/") ? 9e9 : 1e9 }]));
    });
    const venues: ExploreVenue[] = [{ id: "mine", name: "HL", connector: "live:hyperliquid-trade", trader: { can: true, markets: async () => rows, stats } as unknown as LiveTrader }];
    const result = await exploreAcross({ connected: scopedExploreVenues(venues, "xyz") }, { limit: 1 });
    expect(stats.mock.calls.map(([symbols]) => symbols.length)).toEqual([40, 40, 5]);
    expect(result.items[0]?.key).toBe("perp:xyz:COIN84");
    expect(result.missing).toEqual([]);
  });

  it("asks only relevant venues, passes the full-universe scope and filters before stats and the limit", async () => {
    const markets = vi.fn(async () => [native, xyz, gold, other, spot]);
    const stats = vi.fn(async (symbols: string[]) => new Map(symbols.map((s) => [s, { price: 100, volumeUsd24h: s.includes("GOLD") ? 5e9 : 1e9 }])));
    const unrelated = vi.fn(async () => [market("ETH/USDT", "ETH", undefined, true)]);
    const venues: ExploreVenue[] = [
      { id: "mine", name: "My HL", connector: "live:hyperliquid-trade", trader: { can: true, markets, stats } as unknown as LiveTrader },
      { id: "other", name: "Other", connector: "live:exchange:other", trader: { can: true, markets: unrelated } as unknown as LiveTrader },
    ];
    const result = await exploreAcross({ connected: scopedExploreVenues(venues, "xyz") }, { limit: 1 });
    expect(unrelated).not.toHaveBeenCalled();
    expect(markets).toHaveBeenCalledWith("", "xyz");
    expect(stats).toHaveBeenCalledWith([xyz.symbol, gold.symbol]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ key: "perp:xyz:GOLD", at: [{ dex: "xyz", connector: "live:hyperliquid-trade" }] });
    stats.mockClear();
    const main = await exploreAcross({ connected: scopedExploreVenues(venues, "hyperliquid") });
    expect(main.items.map((i) => i.key)).toEqual(["perp:BTC"]);
    expect(stats).toHaveBeenCalledWith([native.symbol]);
    const more = await exploreAcross({ connected: scopedExploreVenues(venues, "more") });
    expect(unrelated).toHaveBeenCalledOnce();
    expect(more.items.flatMap((i) => i.at.map((a) => a.symbol))).toEqual(expect.arrayContaining([other.symbol, spot.symbol, "ETH/USDT"]));
    expect(more.items.flatMap((i) => i.at.map((a) => a.symbol))).not.toContain(xyz.symbol);
    expect(scopedExploreVenues(venues)).toBe(venues);
  });

  it("retains a Hyperliquid testnet venue's paper identity without allowing it to price the public market", async () => {
    const venues: ExploreVenue[] = [{ id: "testnet", name: "Testnet", paper: true, connector: "live:hyperliquid-paper", trader: { can: true, markets: async () => [xyz] } as unknown as LiveTrader }];
    const result = await exploreAcross({ connected: scopedExploreVenues(venues, "xyz") });
    expect(result.items[0]).toMatchObject({ key: "perp:xyz:NVDA", paper: true, at: [{ paper: true, connected: true, dex: "xyz" }] });
  });
});
