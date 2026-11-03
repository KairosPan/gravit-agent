/** THE ACCOUNT ON THE MARKET'S LINK, built as the server's main builds it (publicMarkets, streams, china and the price from one link): its
 * Markets answer is the in-process source's, a paper fill is at the market's price, a page's followed public market streams from the
 * market's hub, and its valuation prices with the market's price. */
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { Outcome } from "../../src/portfolio/account/exchange.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import type { LiveDeps } from "../../src/portfolio/live/index.ts";
import { connectMarket, type MarketLink } from "../../src/portfolio/market/link.ts";
import type { PublicSource } from "../../src/portfolio/market/shapes.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import type { MarketServerHandle } from "../../../market/src/server.ts";
import { createMarketCore, fakeHub, fakeSource, listing, startMarket } from "../market-fakes.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const START = Date.parse("2026-10-14T15:00:00Z");
const owner = simKey("owner");
const links: MarketLink[] = [];
const markets: MarketServerHandle[] = [];
const servers: PortfolioServerHandle[] = [];
const homes: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => undefined);
  for (const l of links.splice(0)) l.close();
  for (const m of markets.splice(0)) await m.close();
});
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

const price = async (asset: string) => (asset === "BTC" ? 62_000 : undefined);
const liveDeps = (o: Partial<LiveDeps> = {}): Partial<LiveDeps> => ({ clock: () => Date.now(), http: async () => ({ status: 599, body: undefined, text: "" }), ...o });

/** a service over `publicMarkets` and the rest as given, with an owner and a paper account, served */
async function account(o: { publicMarkets: PublicSource[] | (() => PublicSource[]); link?: MarketLink; china?: boolean }) {
  const home = mkdtempSync(join(tmpdir(), "market-account-"));
  homes.push(home);
  const svc = await PortfolioService.create({
    home,
    now: () => new Date(START).toISOString(),
    venues: "frontline",
    real: true,
    publicMarkets: o.publicMarkets,
    ...(o.link ? { streams: o.link.hub, ...(o.china ? { china: o.link.china } : {}) } : {}),
    liveDeps: liveDeps(o.link ? { price: o.link.price } : { price: async () => undefined }),
    liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" },
    account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] },
  });
  let n = 0;
  const own = async (a: NoNonce<OwnerAction>): Promise<Outcome | Refusal> => svc.exchange(await signOwner(owner, { ...a, nonce: START + ++n } as OwnerAction));
  const r = await own({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" });
  if (isRefusal(r)) throw new Error(r.message);
  const order = async (draft: Record<string, unknown>) => {
    const p = await svc.account!.prepare({ type: "liveOrder", venue: "paper-1", ...draft });
    if (isRefusal(p)) throw new Error(p.message);
    const { nonce: _n, ...rest } = p.action as Extract<OwnerAction, { type: "liveOrder" }>;
    const done = await own(rest as NoNonce<OwnerAction>);
    if (isRefusal(done) || done.kind !== "order") throw new Error(`expected an order, got ${isRefusal(done) ? done.message : done.kind}`);
    return done.order;
  };
  const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0, ...(o.link ? { market: o.link } : {}) });
  servers.push(srv);
  svc.watchStreams();
  return { svc, srv, order };
}
/** a market over fakes, and a link to it, answering */
async function market(sources: PublicSource[]) {
  const hub = fakeHub();
  const m = await startMarket(createMarketCore({ sources, hub: hub.hub, price }));
  markets.push(m);
  const link = connectMarket({ url: m.url });
  links.push(link);
  link.start();
  expect(await link.ready(3_000)).toBe(true);
  return { hub, link };
}
const until = async (ok: () => boolean, ms = 6_000): Promise<void> => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((go) => setTimeout(go, 25));
  }
};

describe("the account on the market's link", () => {
  it("answers explore with the same body as the in-process source", async () => {
    const { link } = await market([fakeSource()]);
    const over = await account({ publicMarkets: () => link.sources(), link });
    const local = await account({ publicMarkets: [fakeSource()] });
    // the same body, but for the moment it was put together
    const get = async (url: string): Promise<Record<string, unknown>> => ({ ...((await (await fetch(`${url}/api/account/explore?q=BTC`)).json()) as Record<string, unknown>), asOf: "" });
    const a = await get(over.srv.url);
    const b = await get(local.srv.url);
    expect((a.items as unknown[]).length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it("fills a paper market order at the market's price", async () => {
    const { link } = await market([fakeSource({ rows: [listing("BTC/USD", 100, { bid: 99.5, ask: 100 })] })]);
    const { order } = await account({ publicMarkets: () => link.sources(), link });
    const bought = await order({ symbol: "BTC/USD", side: "buy", orderType: "market", qty: "0.01" });
    expect(bought).toMatchObject({ status: "filled", filledQty: 0.01, avgPrice: 100 });
  });

  it("pushes a followed public market's quote on the account stream", async () => {
    const { link, hub } = await market([fakeSource({ id: "coinbase" })]);
    const { srv } = await account({ publicMarkets: () => link.sources(), link });
    const key = "coinbase:BTC/USD";
    expect(link.hub.covers("coinbase", "BTC/USD")).toBe(true);
    let text = "";
    const req = request(`${srv.url}/api/account/stream?client=page-test-0009&markets=${encodeURIComponent(key)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
    });
    req.end();
    try {
      await until(() => hub.seen.holds.some((k) => k.startsWith("coinbase|BTC/USD")));
      hub.quote("coinbase", "BTC/USD", { bid: 61_990, ask: 62_010, last: 62_000 });
      await until(() => /event: quote\n/.test(text) && text.includes("61990"));
      const frame = text.split("\n\n").find((b) => b.includes("event: quote") && b.includes("61990"))!;
      const data = JSON.parse(frame.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as Record<string, unknown>;
      expect(data).toMatchObject({ key, bid: 61_990, ask: 62_010 });
    } finally {
      req.destroy();
    }
  });

  it("values with the market's price", async () => {
    const { link } = await market([fakeSource()]);
    const { svc } = await account({ publicMarkets: () => link.sources(), link });
    const deps = (svc as unknown as { liveDeps(): LiveDeps }).liveDeps();
    expect(await deps.price("BTC")).toBe(62_000);
  });
});
