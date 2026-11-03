import { afterEach, describe, expect, it } from "vitest";
import { createMarketCore, type MarketCore, type MarketCoreOptions } from "../../src/core.ts";
import { mountProtocol } from "../../src/protocol.ts";
import { no } from "../../src/refuse.ts";
import { mountCn } from "../../src/routes-cn.ts";
import { startMarketServer, type MarketServerHandle } from "../../src/server.ts";
import type { ChinaMarket, ChinaSource, ChinaStatus } from "../../src/live/china.ts";
import type { CnIfind } from "../../src/live/cn-ifind.ts";
import { readLike, type Listing, type PublicSource } from "../../src/live/public-markets.ts";
import type { MarketStats } from "../../src/live/trade.ts";

const READ_AT = 1_700_000_000_000;
const BTC: Listing = { symbol: "BTC/USDT", name: "Bitcoin", kind: "spot", base: "BTC", quote: "USDT", price: 62_000, open: true, types: ["market", "limit"] } as unknown as Listing;
const STATS: MarketStats = { changePct24h: 1.5, volumeUsd24h: 1_000_000 } as unknown as MarketStats;

/** a keyless source as the tests build one: listings, a line, stats and candles; no book */
function fake(over: Partial<PublicSource> = {}): PublicSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    id: "fake",
    name: "Fake Exchange",
    kind: "exchange",
    connectTo: "fake",
    connector: "live:exchange:fake",
    async listings(o) {
      calls.push(`listings:${o.q ?? ""}:${o.limit}`);
      return [readLike({ ...BTC }, READ_AT)];
    },
    async line(sym) {
      calls.push(`line:${sym}`);
      return sym === "BTC/USDT" ? { ...BTC } : null;
    },
    async stats() {
      calls.push("stats");
      return new Map([["BTC/USDT", STATS]]);
    },
    async candles() {
      calls.push("candles");
      return [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }];
    },
    notes: () => ["fake note"],
    ...over,
  };
}

const servers: MarketServerHandle[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});
async function serve(o: MarketCoreOptions): Promise<{ url: string; core: MarketCore }> {
  const core = createMarketCore(o);
  const srv = await startMarketServer({ port: 0, mount: (app) => { mountProtocol(app, core); mountCn(app, core); }, close: () => core.close() });
  servers.push(srv);
  return { url: srv.url, core };
}
const get = async (url: string): Promise<{ status: number; body: any }> => {
  const r = await fetch(url);
  return { status: r.status, body: await r.json() };
};

describe("the source protocol", () => {
  it("lists the sources and what each answers", async () => {
    const { url } = await serve({ sources: [fake()] });
    const { status, body } = await get(`${url}/api/sources`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.value[0]).toMatchObject({ id: "fake", name: "Fake Exchange", kind: "exchange", connectTo: "fake", connector: "live:exchange:fake", has: { line: true, stats: true, candles: true, book: false, trades: false, events: false, settlement: false, fundingHistory: false, notes: true } });
  });

  it("hands a listing back with its read time", async () => {
    const { url } = await serve({ sources: [fake()] });
    const { status, body } = await get(`${url}/api/source/fake/listings?q=BTC&limit=5`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.value[0].symbol).toBe("BTC/USDT");
    expect(body.readAt[0]).toBe(READ_AT);
    expect(body.notes).toEqual(["fake note"]);
  });

  it("hands a source's refusal back as an answer", async () => {
    const r = no("E_VENUE_GEOBLOCKED", { venue: "fake", message: "Fake does not serve this location" });
    const { url } = await serve({ sources: [fake({ listings: async () => r })] });
    const { status, body } = await get(`${url}/api/source/fake/listings?limit=5`);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: false, refusal: expect.objectContaining({ code: "E_VENUE_GEOBLOCKED", message: "Fake does not serve this location" }) });
  });

  it("sends a Map as entries", async () => {
    const { url } = await serve({ sources: [fake()] });
    const { body } = await get(`${url}/api/source/fake/stats?symbols=BTC/USDT`);
    expect(body.ok).toBe(true);
    expect(body.value).toEqual([["BTC/USDT", { changePct24h: 1.5, volumeUsd24h: 1_000_000 }]]);
  });

  it("answers 404 for an unknown source and 400 for a bad limit", async () => {
    const { url } = await serve({ sources: [fake()] });
    expect((await get(`${url}/api/source/nope/listings?limit=5`)).status).toBe(404);
    for (const q of ["limit=0", "limit=abc", "limit=5&limit=6", ""]) {
      const r = await get(`${url}/api/source/fake/listings?${q}`);
      expect(r.status).toBe(400);
      expect(r.body.ok).toBe(false);
      expect(typeof r.body.error).toBe("string");
    }
    expect((await get(`${url}/api/source/fake/book?symbol=BTC/USDT`)).status).toBe(404);
    expect((await get(`${url}/api/source/fake/candles?symbol=BTC/USDT&interval=2m`)).status).toBe(400);
    const c = await get(`${url}/api/source/fake/candles?symbol=BTC/USDT&interval=1h&since=0&limit=10`);
    expect(c.body).toMatchObject({ ok: true, value: [{ t: 1, c: 1.5 }] });
  });

  it("asks a refused source again only after its hold", async () => {
    let asked = 0;
    const limited = no("E_VENUE_REJECTED", { venue: "fake", message: "Fake is rate-limiting this machine", native: { status: 429 } });
    const { url } = await serve({ sources: [fake({ listings: async () => { asked++; return asked === 1 ? limited : [{ ...BTC }]; } })] });
    const one = await get(`${url}/api/source/fake/listings?limit=5`);
    const two = await get(`${url}/api/source/fake/listings?q=ETH&limit=5`);
    expect(one.body).toMatchObject({ ok: false, refusal: { code: "E_VENUE_REJECTED" } });
    expect(two.body).toMatchObject({ ok: false, refusal: { code: "E_VENUE_REJECTED" } });
    expect(asked).toBe(1);
  });

  it("serves China and the price", async () => {
    let status: ChinaStatus = { state: "unavailable", said: "not asked" };
    const china: ChinaSource = {
      rank: async () => no("E_VENUE_UNREACHABLE", { venue: "china" }),
      search: async () => [],
      async quotes(symbols) {
        status = { state: "live", said: "Tencent · answering" };
        return new Map(symbols.map((s) => [s, { symbol: s, name: "Kweichow Moutai", currency: "CNY", price: 1_500 } as unknown as ChinaMarket]));
      },
      history: async () => no("E_VENUE_UNREACHABLE", { venue: "china" }),
      status: () => status,
    };
    const { url } = await serve({ china, price: async (a) => (a === "BTC" ? 62_000 : undefined) });
    const q = await get(`${url}/api/china/quotes?symbols=sh600519`);
    expect(q.body.ok).toBe(true);
    expect(q.body.value).toEqual([["sh600519", expect.objectContaining({ currency: "CNY" })]]);
    expect(q.body.status.state).toBe("live");
    const r = await get(`${url}/api/china/rank?sort=volume`);
    expect(r.body).toMatchObject({ ok: false, refusal: { code: "E_VENUE_UNREACHABLE" }, status: { state: "live" } });
    expect((await get(`${url}/api/china/status`)).body).toEqual({ ok: true, value: { state: "live", said: "Tencent · answering" } });
    expect((await get(`${url}/api/price?asset=BTC`)).body).toEqual({ ok: true, value: 62_000 });
    expect((await get(`${url}/api/price?asset=NOPE`)).body).toEqual({ ok: true, value: null });
    expect((await get(`${url}/api/price`)).status).toBe(400);
  });

  it("names no token on health", async () => {
    const ifind: CnIfind = { configured: () => true, ask: async () => ({ kind: "refused", word: "unconfigured" }) };
    const { url } = await serve({ sources: [fake()], cn: { relay: async () => ({ kind: "refused", word: "unreachable" }), ifind } });
    const r = await fetch(`${url}/api/health`);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ ok: true, service: "market", sources: 1, china: false, akshare: false, ifind: true });
    expect(text.toLowerCase()).not.toContain("token");
  });
});
