/** THE MARKET'S PUBLIC READS (reads.ts): explore, quotes, candles, book and trades under names without "account", over a fake public
 * source, a fake China and a fake hub — each the public half of the account's read of the same name (service.ts), with nothing connected. */
import { afterEach, describe, expect, it } from "vitest";
import { createMarketCore } from "../../src/core.ts";
import { marketReads, mountReads } from "../../src/reads.ts";
import { startMarketServer, type MarketServerHandle } from "../../src/server.ts";
import { fakeChina, fakeHub, fakeSource } from "../fakes.ts";

const servers: MarketServerHandle[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function market() {
  const core = createMarketCore({ sources: [fakeSource()], china: fakeChina(), hub: fakeHub().hub });
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
    // the account's checks and words: a tab it does not have, a limit past 200
    const tab = await get("/api/explore?tab=nope");
    expect(tab.status).toBe(409);
    expect(tab.body.refusal.code).toBe("E_ACCOUNT_BAD_ACTION");
    expect((await get("/api/explore?limit=x")).body).toEqual({ ok: false, error: "limit is a count of markets, 1 to 200, in digits" });
  });

  it("quotes a public pair and an A share", async () => {
    const { get } = await market();
    const r = await get("/api/quotes?pairs=fake|BTC/USDT,china|600519,china|sh600519");
    expect(r.status).toBe(200);
    const [pub, share, letters] = r.body.quotes as Array<Record<string, any>>;
    // a public pair is answered as the account answers it with no venue connected: its quote is a connected venue's (service.ts liveMarket)
    expect(pub).toMatchObject({ venue: "fake", symbol: "BTC/USDT", refusal: { code: "E_WALLET_ACCOUNT_UNKNOWN" } });
    expect(share).toMatchObject({ venue: "china", symbol: "600519", market: { symbol: "600519", currency: "CNY" } });
    expect(letters).toMatchObject({ venue: "china", symbol: "sh600519", refusal: { code: "E_ACCOUNT_BAD_ACTION", message: "an A share is its six digits" } });
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
    expect(r.body.refusal).toMatchObject({ code: "E_WALLET_ACCOUNT_UNKNOWN", venue: "my-okx" });
    expect((await get("/api/trades?venue=my-okx&symbol=BTC/USDT")).body.refusal.code).toBe("E_WALLET_ACCOUNT_UNKNOWN");
    expect((await get("/api/candles?venue=my-okx&symbol=BTC/USDT&interval=1h")).body.refusal.code).toBe("E_WALLET_ACCOUNT_UNKNOWN");
  });
});
