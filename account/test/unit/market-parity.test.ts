/** THE ONE PLACE BOTH PACKAGES' READ CODE IS COMPARED (plan A1 task 6): the account's Markets reads (service.ts explore, quotes, candles,
 * marketBook, marketTrades and its page follows) on an in-process service with no venue connected, and the market's public reads
 * (market/src/reads.ts, follows.ts) over the same fakes, asked over HTTP — their bodies the same once the moments they were made at are
 * taken out. Until plan A2 deletes the account's copies, this is what says the two answer alike. Nothing leaves the process. */
import { mkdtempSync, rmSync } from "node:fs";
import { request, type ClientRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { createMarketCore } from "../../../market/src/core.ts";
import { mountStream } from "../../../market/src/follows.ts";
import { marketReads, mountReads } from "../../../market/src/reads.ts";
import { startMarketServer, type MarketServerHandle } from "../../../market/src/server.ts";
import { fakeChina, fakeHub, fakeSource } from "../../../market/test/fakes.ts";

const START = Date.parse("2026-10-14T15:00:00Z");
const CLIENT = "parity-page-01";
const homes: string[] = [];
const servers: Array<PortfolioServerHandle | MarketServerHandle> = [];
const open: ClientRequest[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) r.destroy();
  for (const s of servers.splice(0)) await s.close().catch(() => undefined);
});
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

/** the same fakes as an account with no venue connected, and as a market */
async function both() {
  const h = fakeHub();
  const home = mkdtempSync(join(tmpdir(), "market-parity-"));
  homes.push(home);
  const svc = await PortfolioService.create({
    home,
    now: () => new Date(START).toISOString(),
    venues: "frontline",
    real: true,
    publicMarkets: [fakeSource()],
    china: fakeChina(),
    streams: h.hub,
    liveDeps: { clock: () => Date.now(), http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined },
  });
  const account = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  servers.push(account);
  svc.watchStreams();
  const core = createMarketCore({ sources: [fakeSource()], china: fakeChina(), hub: h.hub });
  let closeStream: (() => void) | undefined;
  const market = await startMarketServer({
    port: 0,
    mount: (app) => {
      mountReads(app, core, marketReads(core));
      closeStream = mountStream(app, core).close;
    },
    close: async () => closeStream?.(),
  });
  servers.push(market);
  const get = async (base: string, path: string) => {
    const r = await fetch(`${base}${path}`);
    return { status: r.status, body: await r.json() };
  };
  /** the account's answer and the market's to the same question (the account's route under /api/account/, the market's under /api/) */
  const ask = async (path: string) => ({ a: await get(account.url, `/api/account/${path}`), m: await get(market.url, `/api/${path}`) });
  return { h, account, market, ask };
}

/** the moments an answer was made at, taken out: what is left is what it says (an explore row's `at`, its list of venues, is kept) */
const VOLATILE = new Set(["asOf", "at", "readAt", "seenAt"]);
function steady(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(steady);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k, x]) => !(VOLATILE.has(k) && (typeof x === "string" || typeof x === "number"))).map(([k, x]) => [k, steady(x)]));
  return v;
}

interface Frame { event?: string; data?: any }
function listen(url: string) {
  const frames: Frame[] = [];
  let text = "";
  const req = request(url, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      text += chunk;
      const blocks = text.split("\n\n");
      text = blocks.pop() ?? "";
      for (const b of blocks) {
        const f: Frame = {};
        for (const line of b.split("\n")) {
          if (line.startsWith("event: ")) f.event = line.slice(7);
          else if (line.startsWith("data: ")) f.data = JSON.parse(line.slice(6));
        }
        if (f.event) frames.push(f);
      }
    });
  });
  req.on("error", () => undefined);
  req.end();
  open.push(req);
  return frames;
}
async function until(ok: () => boolean, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`waited ${ms} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("the account's Markets reads and the market's public reads, alike", () => {
  it("explore answers the same with no venue connected", async () => {
    const { ask } = await both();
    for (const path of ["explore?q=BTC", "explore?q=600519", "explore", "explore?tab=crypto&sort=movers&limit=5", "explore?tab=nope", "explore?limit=x", "explore?q=BTC&q=ETH"]) {
      const { a, m } = await ask(path);
      expect(m.status, path).toBe(a.status);
      expect(steady(m.body), path).toEqual(steady(a.body));
    }
    // the BTC search found the fake's pair: the comparison is of something
    const { m } = await ask("explore?q=BTC");
    expect(JSON.stringify(m.body)).toContain("BTC/USDT");
  });

  it("quotes, candles, book and trades answer the same", async () => {
    const { ask } = await both();
    const paths = [
      "quotes?pairs=fake|BTC/USDT,china|600519,china|sh600519",
      "quotes?pairs=nobar",
      "candles?venue=fake&symbol=BTC/USDT&interval=1h&range=1D",
      "candles?venue=fake&symbol=BTC/USDT&interval=1h&before=1700000000000&limit=10",
      "candles?venue=china&symbol=600519&interval=1d&range=1M",
      "candles?venue=fake&symbol=BTC/USDT&interval=7m",
      "book?venue=fake&symbol=BTC/USDT&depth=2",
      "book?venue=my-okx&symbol=BTC/USDT",
      "book?venue=fake&symbol=BTC/USDT&depth=x",
      "trades?venue=fake&symbol=BTC/USDT&limit=1",
      "trades?venue=my-okx&symbol=BTC/USDT",
      "trades?venue=Bad_Id&symbol=BTC/USDT",
    ];
    for (const path of paths) {
      const { a, m } = await ask(path);
      expect(m.status, path).toBe(a.status);
      expect(steady(m.body), path).toEqual(steady(a.body));
    }
  });

  it("a followed market's quote event is the same on both streams", async () => {
    const { h, account, market } = await both();
    const onAccount = listen(`${account.url}/api/account/stream?client=${CLIENT}&markets=fake:BTC/USDT`);
    const onMarket = listen(`${market.url}/api/stream?client=${CLIENT}&markets=fake:BTC/USDT`);
    const quotes = (frames: Frame[]) => frames.filter((f) => f.event === "quote");
    await until(() => quotes(onAccount).length >= 1 && quotes(onMarket).length >= 1);
    expect(quotes(onMarket)[0]!.data).toEqual(quotes(onAccount)[0]!.data);
    await new Promise((r) => setTimeout(r, 300));
    // one tick of the hub: the same data on both
    h.quote("fake", "BTC/USDT", { mark: 62_000.5, priceAt: 1_700_000_099_000 });
    const ticked = (frames: Frame[]) => quotes(frames).find((f) => f.data.bid !== undefined);
    await until(() => !!ticked(onAccount) && !!ticked(onMarket));
    expect(ticked(onMarket)!.data).toEqual(ticked(onAccount)!.data);
    expect(ticked(onMarket)!.data).toMatchObject({ key: "fake:BTC/USDT", bid: 61_999, live: true });
  });
});
