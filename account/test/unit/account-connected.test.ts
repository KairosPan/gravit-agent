import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import type { LiveDeps } from "../../src/portfolio/live/index.ts";
import type { Listing, PublicSource } from "../../../market/src/live/public-markets.ts";
import { startPortfolioServer } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import type { MarketLink } from "../../src/portfolio/market/link.ts";

/** A CONNECTED VENUE'S OWN READS under /api/account/connected/: what the account answers for the venues the owner connected — their
 * explore rows, their quotes, their candles, book and trades — and a public source refused by name, its data being the market's. */
type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const START = Date.parse("2026-10-12T15:00:00Z");
const REAL = Date.parse("2026-10-14T15:00:00Z");
const owner = simKey("owner");
const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

const btc: Listing = { symbol: "BTC/USDT", name: "BTC market", kind: "spot", base: "BTC", quote: "USDT", price: 60000, bid: 59990, ask: 60010, open: true, types: [], volumeUsd24h: 2e9 } as Listing;
const bars = Array.from({ length: 300 }, (_, i) => {
  const t = REAL - (300 - i) * 300_000;
  return { t, o: 60000, h: 60010, l: 59990, c: 60000 + i };
});
const fake: PublicSource = {
  id: "fake",
  name: "Fake Ex",
  kind: "exchange",
  connectTo: "fake",
  connector: "live:exchange:fake",
  listings: async (q) => [btc].filter((m) => !q.q || m.base.includes(q.q.toUpperCase())),
  candles: async (symbol, _i, w) => (symbol === "BTC/USDT" ? bars.filter((b) => b.t >= (w.since ?? 0)) : []),
  book: async () => ({ bids: [{ price: 59990, qty: 1 }], asks: [{ price: 60010, qty: 2 }] }) as never,
  trades: async () => [{ at: REAL - 1000, price: 60000, qty: 0.1, side: "buy" }] as never,
};

async function boot(sources: PublicSource[] | (() => PublicSource[]) = [fake], market?: MarketLink) {
  const home = mkdtempSync(join(tmpdir(), "account-connected-"));
  homes.push(home);
  const liveDeps: Partial<LiveDeps> = { clock: () => REAL, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  const svc = await PortfolioService.create({ home, now: () => new Date(START).toISOString(), venues: "frontline", real: true, liveDeps, publicMarkets: sources, liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] } });
  let n = 0;
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: START + ++n } as OwnerAction));
  const r = await own({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" });
  if (isRefusal(r)) throw new Error(r.message);
  const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0, ...(market ? { market } : {}) });
  const get = async (path: string) => {
    const res = await fetch(`${srv.url}${path}`);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { svc, srv, get, own };
}

describe("a connected venue's own reads (GET /api/account/connected/…)", () => {
  it("keeps selected-source paper reads and their cache keys separate and validates the source query", async () => {
    const second: PublicSource = { ...fake, id: "second", listings: async () => [{ ...btc, symbol: "ETH/USDT", base: "ETH" }] };
    const { srv, get } = await boot([fake, second]);
    try {
      const one = await get("/api/account/connected/explore?scope=more&source=fake");
      const two = await get("/api/account/connected/explore?scope=more&source=second");
      expect(one.body.items.map((i: { key: string }) => i.key)).toEqual(["coin:BTC"]);
      expect(two.body.items.map((i: { key: string }) => i.key)).toEqual(["coin:ETH"]);
      expect(one.body.items[0].at[0].publicSource).toBe("fake");
      expect(two.body.items[0].at[0].publicSource).toBe("second");
      expect((await get("/api/account/connected/explore?scope=more&source=fake")).body).toEqual(one.body);
      expect((await get("/api/account/connected/explore?source=fake")).body.items[0].key).toBe("coin:BTC");
      for (const q of ["scope=xyz&source=fake", "scope=hyperliquid&source=fake", "source=missing", `source=${"a".repeat(81)}`]) expect((await get(`/api/account/connected/explore?${q}`)).status).toBe(409);
      expect((await get("/api/account/connected/explore?source=fake&source=second")).status).toBe(400);
    } finally { await srv.close(); }
  });

  it("keeps a selected paper token's identity through broad reads and both listing and explore caches", async () => {
    const token: Listing = { ...btc, symbol: "NVDA", base: "NVDA", quote: "USD", kind: "token", price: 180 };
    const share: PublicSource = { ...fake, id: "cboe", name: "US stocks", kind: "stocks", listings: async () => [{ ...token, kind: "stock", price: 190 }] };
    const tokens: PublicSource = { ...fake, id: "robinhood-stock-tokens", name: "Robinhood Stock Tokens", kind: "tokens", listings: async () => [token] };
    const { srv, get } = await boot([share, tokens]);
    try {
      const selected = await get("/api/account/connected/explore?scope=more&source=robinhood-stock-tokens");
      expect(selected.body.items.map((i: { key: string }) => i.key)).toEqual(["rwa:NVDA"]);
      const broad = await get("/api/account/connected/explore?scope=more");
      expect(broad.body.items.map((i: { key: string }) => i.key)).toEqual(["rwa:NVDA"]);
      expect((await get("/api/account/connected/explore?scope=more&source=robinhood-stock-tokens")).body).toEqual(selected.body);
      expect((await get("/api/account/connected/explore?scope=more&source=cboe")).body.items).toEqual([]);
      const quote = await get("/api/account/connected/quotes?pairs=paper-1|NVDA");
      expect(quote.body.quotes[0].market).toMatchObject({ symbol: "NVDA", kind: "token", publicSource: "robinhood-stock-tokens" });
    } finally { await srv.close(); }
  });

  it("waits for the first source registry on a cold exact-source request", async () => {
    let sources: PublicSource[] = [];
    const ready = vi.fn(async () => { sources = [fake]; return true; });
    const market = { sources: () => sources, ready, close() {}, marketOld: () => undefined } as unknown as MarketLink;
    const { srv, get } = await boot(() => sources, market);
    try {
      const r = await get("/api/account/connected/explore?scope=more&source=fake");
      expect(ready).toHaveBeenCalledWith(3_000);
      expect(r.status).toBe(200);
      expect(r.body.items[0].key).toBe("coin:BTC");
    } finally { await srv.close(); }
  });

  it("explores the venues connected, and no public line", async () => {
    const { srv, get } = await boot();
    try {
      const r = await get("/api/account/connected/explore?q=BTC");
      expect(r.status).toBe(200);
      const items = r.body.items as Array<{ at: Array<{ venue: string; connected: boolean; public?: boolean }> }>;
      expect(items.length).toBeGreaterThan(0);
      for (const it of items) for (const at of it.at) {
        expect(at.connected).toBe(true);
        expect(at.public).not.toBe(true);
      }
      expect(items.flatMap((i) => i.at.map((a) => a.venue))).not.toContain("fake");
      // the public route is gone: the public line is the market's explore
      expect((await fetch(`${srv.url}/api/account/explore?q=BTC`)).status).toBe(404);
    } finally {
      await srv.close();
    }
  });

  it("forgets its kept answer when a venue is unplugged or connected", async () => {
    const { srv, get, own } = await boot();
    try {
      const venues = async () => (((await get("/api/account/connected/explore?q=BTC")).body.items ?? []) as Array<{ at: Array<{ venue: string }> }>).flatMap((i) => i.at.map((a) => a.venue));
      expect(await venues()).toContain("paper-1");
      const off = await own({ type: "disconnectVenue", venue: "paper-1" });
      if (isRefusal(off)) throw new Error(off.message);
      expect(await venues()).not.toContain("paper-1");
      const on = await own({ type: "connectVenue", venue: "paper-2", connector: "live:paper", label: "", credentialRef: "" });
      if (isRefusal(on)) throw new Error(on.message);
      expect(await venues()).toContain("paper-2");
    } finally {
      await srv.close();
    }
  });

  it("refuses China, which is the market's", async () => {
    const { srv, get } = await boot();
    try {
      const r = await get("/api/account/connected/explore?tab=china");
      expect(r.status).toBe(409);
      expect(r.body.refusal.message).toBe("China is the market's: its explore answers it");
      // the same checks as the old route's
      expect((await get("/api/account/connected/explore?limit=0")).status).toBe(409);
      expect((await get("/api/account/connected/explore?limit=x")).status).toBe(400);
      expect((await get("/api/account/connected/explore?tab=nowhere")).status).toBe(409);
      expect((await get("/api/account/connected/explore?scope=nowhere")).status).toBe(409);
      expect((await get("/api/account/connected/explore?scope=xyz&scope=more")).status).toBe(400);
      // This generic paper fixture has no Hyperliquid or xyz source, so preferred scopes are empty; More and the legacy read include it.
      expect((await get("/api/account/connected/explore?scope=xyz&q=BTC")).body.items).toEqual([]);
      expect((await get("/api/account/connected/explore?scope=hyperliquid&q=BTC")).body.items).toEqual([]);
      expect((await get("/api/account/connected/explore?scope=more&q=BTC")).body.items.length).toBeGreaterThan(0);
    } finally {
      await srv.close();
    }
  });

  it("reads a connected venue's candles, book and trades; the public routes are gone", async () => {
    const { srv, get } = await boot();
    try {
      for (const [part, query] of [["candles", "venue=paper-1&symbol=BTC/USDT&range=1D"], ["book", "venue=paper-1&symbol=BTC/USDT"], ["trades", "venue=paper-1&symbol=BTC/USDT"]] as const) {
        const now = await get(`/api/account/connected/${part}?${query}`);
        expect(now.status, part).toBe(200);
        expect(now.body).toMatchObject({ ok: true, venue: "paper-1", symbol: "BTC/USDT" });
        expect((await fetch(`${srv.url}/api/account/${part}?${query}`)).status, part).toBe(404);
      }
      // the old routes' query checks hold
      expect((await get("/api/account/connected/book?venue=paper-1&symbol=BTC/USDT&depth=x")).status).toBe(400);
      expect((await get("/api/account/connected/trades?venue=paper-1&symbol=BTC/USDT&limit=x")).status).toBe(400);
    } finally {
      await srv.close();
    }
  });

  it("refuses a public source by name", async () => {
    const { srv, get } = await boot();
    try {
      for (const part of ["candles", "book", "trades"]) {
        const r = await get(`/api/account/connected/${part}?venue=fake&symbol=BTC/USDT`);
        expect(r.status).toBe(409);
        expect(r.body.refusal).toMatchObject({ code: "E_WALLET_NOT_CONNECTED", venue: "fake", message: '"fake" is not a venue connected to this account: its public data is the market\'s' });
      }
    } finally {
      await srv.close();
    }
  });

  it("quotes connected pairs and refuses the rest one by one", async () => {
    const { srv, get } = await boot();
    try {
      const r = await get("/api/account/connected/quotes?pairs=paper-1|BTC/USDT,fake|BTC/USDT");
      expect(r.status).toBe(200);
      const quotes = r.body.quotes as Array<{ venue: string; market?: unknown; refusal?: { code: string } }>;
      expect(quotes.map((q) => q.venue)).toEqual(["paper-1", "fake"]);
      expect(quotes[0]!.market).toBeDefined();
      expect(quotes[0]!.refusal).toBeUndefined();
      expect(quotes[1]!.refusal?.code).toBe("E_WALLET_NOT_CONNECTED");
      // 1 to 12, as the old route's
      const many = Array.from({ length: 13 }, () => "paper-1|BTC/USDT").join(",");
      expect((await get(`/api/account/connected/quotes?pairs=${many}`)).status).toBe(409);
      expect((await get("/api/account/connected/quotes?pairs=nobar")).status).toBe(400);
    } finally {
      await srv.close();
    }
  });
});
