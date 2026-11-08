import { describe, expect, it } from "vitest";
import { tradeXyzPublic, KEEP_MS, type Listing } from "../../src/live/public-markets.ts";
import type { CandlePage } from "../../src/live/trade.ts";
import type { Http, HttpReply } from "../../src/live/types.ts";

// Synthetic markets in Hyperliquid's documented info shapes; no requests leave the process.
const NOW = Date.parse("2026-11-05T18:12:00.000Z");
const HOUR = 3_600_000;
const PAID = Math.floor(NOW / HOUR) * HOUR;
type Rec = Record<string, unknown>;
const json = (body: unknown, status = 200): HttpReply => ({ status, body, text: JSON.stringify(body) });
const categories = [["xyz:NVDA", "stocks"], ["xyz:XYZ100", "indices"], ["xyz:GOLD", "commodities"], ["xyz:EUR", "fx"], ["xyz:OURA", "preipo"], ["other:NVDA", "stocks"]];
const coins = ["xyz:NVDA", "xyz:XYZ100", "xyz:GOLD", "xyz:EUR", "xyz:OURA", "xyz:QUIET", "xyz:UNPRICED", "xyz:OLD", "other:NVDA", "BTC"];
const meta = () => [{ universe: coins.map((name) => ({ name, szDecimals: 3, maxLeverage: 20, ...(name === "xyz:OLD" ? { isDelisted: true } : {}) })), collateralToken: 0 }, coins.map((coin) => ({
  midPx: coin === "xyz:UNPRICED" ? null : "125.5", markPx: coin === "xyz:UNPRICED" ? null : "125.6", oraclePx: "125.4",
  prevDayPx: "100", dayNtlVlm: coin === "xyz:QUIET" ? "0" : "2000000", openInterest: coin === "xyz:QUIET" ? "0" : "1000",
  premium: "0.001", funding: "0.00001",
}))];

function network(overrides: Record<string, HttpReply> = {}) {
  const sent: Array<{ url: string; method: string; body: Rec }> = [];
  const http: Http = async (url, init = {}) => {
    const body = JSON.parse(init.body ?? "{}") as Rec;
    sent.push({ url, method: init.method ?? "GET", body });
    const type = String(body.type);
    if (overrides[type]) return overrides[type];
    if (type === "metaAndAssetCtxs") {
      expect(body.dex).toBe("xyz");
      return json(meta());
    }
    if (type === "perpCategories") return json(categories);
    if (type === "l2Book") return json({ coin: body.coin, time: NOW, levels: [[{ px: "125.4", sz: "2" }], [{ px: "125.6", sz: "3" }]] });
    if (type === "recentTrades") return json([{ coin: body.coin, px: "125.5", sz: "0.5", side: "B", time: NOW }]);
    if (type === "fundingHistory") return json([{ coin: body.coin, fundingRate: "0.00001", time: PAID + 127 }]);
    if (type === "candleSnapshot") return json([{ s: "xyz:NVDA", t: PAID - HOUR, o: "124", h: "126", l: "123", c: "125", v: "50", n: 5 }]);
    throw new Error(`unexpected info call: ${type}`);
  };
  return { sent, http };
}

describe("trade.xyz's public xyz perpetuals", () => {
  it("lists the active equity, index, commodity, FX and pre-IPO universe without mixing in another dex or spot", async () => {
    const net = network();
    const source = tradeXyzPublic({ http: net.http, clock: () => NOW });
    const rows = await source.listings({ limit: 100 }) as Listing[];
    expect(source).toMatchObject({ id: "trade-xyz", name: "trade.xyz", connector: "live:hyperliquid-trade", connectTo: "hyperliquid-trade" });
    expect(rows.map((r) => r.symbol).sort()).toEqual(coins.slice(0, 7).map((s) => `${s}-PERP`).sort());
    expect(rows.every((r) => r.kind === "perp" && r.quote === "USDC" && r.venueName === "trade.xyz" && r.open && r.types.length === 0)).toBe(true);
    expect(rows.find((r) => r.symbol === "xyz:NVDA-PERP")).toMatchObject({
      base: "xyz:NVDA", category: "stocks", name: "NVDA perpetual on trade.xyz", contractSize: 1, price: 125.5,
      markPrice: 125.6, oraclePrice: 125.4, premium: 0.001, openInterest: 1000, openInterestUsd: 125600,
      volumeUsd24h: 2000000, change24h: 25.5, changePct24h: 25.5, fundingRate: 0.00001, fundingEveryH: 1,
      nextFundingAt: "2026-11-05T19:00:00.000Z", maxLeverage: 20, minNotional: 10, qtyStep: 0.001,
    });
    expect(rows.find((r) => r.symbol === "xyz:QUIET-PERP")).toMatchObject({ openInterest: 0, volumeUsd24h: 0 });
    expect(rows.find((r) => r.symbol === "xyz:UNPRICED-PERP")?.price).toBeUndefined();
    expect(rows.find((r) => r.symbol === "xyz:OURA-PERP")).toMatchObject({ base: "OURA", category: "Pre-IPO", group: { id: "preipo:oura" }, implied: { perPoint: 320_945_459, usd: Math.round(125.5 * 320_945_459) } });
    expect(rows.find((r) => r.symbol === "xyz:EUR-PERP")).toMatchObject({ category: "fx", kind: "perp" });
    expect(net.sent.map((s) => s.body)).toEqual([{ type: "metaAndAssetCtxs", dex: "xyz" }, { type: "perpCategories" }]);
    expect(net.sent.every((s) => s.url === "https://api.hyperliquid.xyz/info" && s.method === "POST")).toBe(true);
    expect(source.notes!({})[0]).toContain("7 of 7 active xyz perpetuals");
  });

  it("searches both plain and qualified tickers, keeps categories, and returns only the exact derivative for a quote", async () => {
    const net = network();
    const source = tradeXyzPublic({ http: net.http, clock: () => NOW });
    for (const q of ["nvda", "xyz:nvda", "xyz:NVDA-PERP"])
      expect((await source.listings({ q, limit: 20 }) as Listing[]).map((r) => r.symbol)).toEqual(["xyz:NVDA-PERP"]);
    expect((await source.listings({ q: "commodities", limit: 20 }) as Listing[]).map((r) => r.symbol)).toEqual(["xyz:GOLD-PERP"]);
    expect(await source.line!("NVDA")).toBeNull();
    expect(await source.line!("BTC-PERP")).toBeNull();
    expect(await source.line!("xyz:nvda-perp")).toMatchObject({ kind: "perp", base: "xyz:NVDA", fundingEveryH: 1 });
    expect(await source.listings({ q: "other:NVDA", limit: 20 })).toEqual([]);
    expect(net.sent).toHaveLength(2);
  });

  it("uses the same qualified coin for history, book, trades and funding, preserving trade.xyz attribution", async () => {
    const net = network();
    const source = tradeXyzPublic({ http: net.http, clock: () => NOW, pace: async () => {} });
    const bars = await source.candles!("xyz:NVDA-PERP", "1h", { since: PAID - HOUR }) as CandlePage;
    expect(bars.bars).toEqual([{ t: PAID - HOUR, o: 124, h: 126, l: 123, c: 125, v: 50 }]);
    expect(bars.source).toBe("trade.xyz · xyz:NVDA perpetual");
    expect(await source.book!("xyz:NVDA-PERP", 10)).toMatchObject({ bids: [[125.4, 2]], asks: [[125.6, 3]], from: "trade.xyz", depth: "full" });
    expect(await source.trades!("xyz:NVDA-PERP", 10)).toEqual([{ price: 125.5, size: 0.5, side: "buy", at: new Date(NOW).toISOString() }]);
    expect(await source.fundingHistory!("xyz:NVDA-PERP", PAID, PAID)).toEqual([{ at: PAID, rate: 0.00001 }]);
    expect(net.sent.map((s) => s.body.type)).toEqual(["candleSnapshot", "l2Book", "recentTrades", "fundingHistory"]);
    expect(net.sent.every(({ body }) => body.coin === "xyz:NVDA" || (body.req as Rec | undefined)?.coin === "xyz:NVDA")).toBe(true);
  });

  it("rejects main-dex, spot and other HIP-3 symbols before any depth or history request", async () => {
    const net = network();
    const source = tradeXyzPublic({ http: net.http, clock: () => NOW, pace: async () => {} });
    for (const symbol of ["BTC-PERP", "io:ANTH-PERP", "NVDA", "xyz:NVDA/USDC", "@107"]) {
      expect(await source.candles!(symbol, "1h", { since: PAID - HOUR })).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION", venue: "trade-xyz" });
      expect(await source.book!(symbol, 10)).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION" });
      expect(await source.trades!(symbol, 10)).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION" });
      expect(await source.fundingHistory!(symbol, PAID, PAID)).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION" });
    }
    expect(net.sent).toEqual([]);
  });

  it("caches the xyz universe independently of categories and lets reset release a held refusal", async () => {
    const net = network();
    let now = NOW;
    const source = tradeXyzPublic({ http: net.http, clock: () => now });
    await source.listings({ limit: 2 });
    await source.line!("xyz:NVDA-PERP");
    expect(net.sent).toHaveLength(2);
    now += KEEP_MS + 1;
    await source.listings({ limit: 20 });
    expect(net.sent.filter((s) => s.body.type === "metaAndAssetCtxs")).toHaveLength(2);
    expect(net.sent.filter((s) => s.body.type === "perpCategories")).toHaveLength(1);
    const overrides: Record<string, HttpReply> = { metaAndAssetCtxs: { status: 403, body: undefined, text: "This service is not available in your country" } };
    const blocked = network(overrides);
    const retry = tradeXyzPublic({ http: blocked.http, clock: () => now });
    await retry.listings({ limit: 20 });
    delete overrides.metaAndAssetCtxs;
    expect(await retry.listings({ limit: 20 })).toMatchObject({ code: "E_VENUE_GEOBLOCKED" });
    expect(blocked.sent.filter((s) => s.body.type === "metaAndAssetCtxs")).toHaveLength(1);
    retry.reset!();
    expect(await retry.line!("xyz:NVDA-PERP")).toMatchObject({ price: 125.5 });
    expect(blocked.sent.filter((s) => s.body.type === "metaAndAssetCtxs")).toHaveLength(2);
  });

  it("keeps active derivatives available when optional categories fail, and refuses malformed or unsupported quotes", async () => {
    const net = network({ perpCategories: json(null, 500) });
    const source = tradeXyzPublic({ http: net.http, clock: () => NOW });
    expect(await source.line!("xyz:NVDA-PERP")).toMatchObject({ kind: "perp", base: "xyz:NVDA", price: 125.5 });
    expect(await source.line!("xyz:NVDA-PERP")).not.toHaveProperty("category");
    expect(await source.line!("xyz:OURA-PERP")).toMatchObject({ group: { id: "preipo:oura" } });
    const malformed = network({ metaAndAssetCtxs: json([{ universe: [{ name: "xyz:NVDA" }] }, []]) });
    expect(await tradeXyzPublic({ http: malformed.http }).listings({ limit: 20 })).toMatchObject({ code: "E_VENUE_REJECTED", venue: "trade-xyz" });
    const unknownCollateral = network({ metaAndAssetCtxs: json([{ ...(meta()[0] as Rec), collateralToken: 9999 }, meta()[1]]) });
    expect(await tradeXyzPublic({ http: unknownCollateral.http }).listings({ limit: 20 })).toMatchObject({ code: "E_ACCOUNT_UNPRICED", venue: "trade-xyz" });
    const blocked = network({ metaAndAssetCtxs: { status: 403, body: undefined, text: "This service is not available in your country" } });
    expect(await tradeXyzPublic({ http: blocked.http }).listings({ limit: 20 })).toMatchObject({ code: "E_VENUE_GEOBLOCKED", venue: "trade-xyz" });
  });

  it("keeps a raw preipo tag without inventing valuation terms, and preserves unknown category words", async () => {
    // ANT is tagged preipo by the official endpoint, but has no registered valuation convention in preipo.ts.
    const net = network({
      perpCategories: json([["xyz:ANT", "preipo"], ["xyz:NEW", "new-category"]]),
      metaAndAssetCtxs: json([{ universe: [{ name: "xyz:ANT" }, { name: "xyz:NEW" }], collateralToken: 0 }, [
        { midPx: "100", markPx: "100", dayNtlVlm: "2" }, { midPx: "50", markPx: "50", dayNtlVlm: "1" },
      ]]),
    });
    const rows = await tradeXyzPublic({ http: net.http, clock: () => NOW }).listings({ limit: 10 }) as Listing[];
    expect(rows.map((m) => ({ symbol: m.symbol, kind: m.kind, category: m.category }))).toEqual([
      { symbol: "xyz:ANT-PERP", kind: "perp", category: "preipo" },
      { symbol: "xyz:NEW-PERP", kind: "perp", category: "new-category" },
    ]);
    for (const m of rows) {
      expect(m).not.toHaveProperty("implied");
      expect(m).not.toHaveProperty("group");
    }
  });
});
