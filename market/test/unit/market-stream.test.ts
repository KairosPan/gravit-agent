/** THE MARKET'S STREAM (stream.ts, follows.ts): GET /api/stream and POST /api/stream/markets, the account's push channel with its market
 * events alone — a followed market's quote, book and trades pushed as the hub moves, a price-only market its quote alone, and the account's
 * checks with the word "account" taken out. Over a fake hub; nothing leaves the process. */
import { request, type ClientRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMarketCore } from "../../src/core.ts";
import { mountStream } from "../../src/follows.ts";
import { marketReads, mountReads } from "../../src/reads.ts";
import { startMarketServer, type MarketServerHandle } from "../../src/server.ts";
import { COALESCE_MS, MAX_FOLLOWS } from "../../src/stream.ts";
import { fakeHub, fakeSource } from "../fakes.ts";

const CLIENT = "page-test-0001";
const servers: MarketServerHandle[] = [];
const open: ClientRequest[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) r.destroy();
  for (const s of servers.splice(0)) await s.close();
});

async function market() {
  const h = fakeHub();
  const core = createMarketCore({ sources: [fakeSource()], hub: h.hub });
  let closeStream: (() => void) | undefined;
  const srv = await startMarketServer({
    port: 0,
    mount: (app) => {
      mountReads(app, core, marketReads(core));
      closeStream = mountStream(app, core).close;
    },
    close: async () => closeStream?.(),
  });
  servers.push(srv);
  return { h, srv };
}

interface Frame { event?: string; data?: any }
/** a stream opened on the market: every frame heard, and a wait for one */
function listen(url: string, headers: Record<string, string> = {}) {
  const frames: Frame[] = [];
  let text = "";
  let status = 0;
  const req = request(url, { headers }, (res) => {
    status = res.statusCode ?? 0;
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
  const until = async (ok: () => boolean, ms = 2_000) => {
    const end = Date.now() + ms;
    while (!ok()) {
      if (Date.now() > end) throw new Error(`waited ${ms} ms: ${JSON.stringify(frames)}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  return { frames, until, status: () => status };
}
const of = (frames: Frame[], event: string) => frames.filter((f) => f.event === event);

describe("the market's stream", () => {
  it("keeps the account bus's windows and room", () => {
    expect(COALESCE_MS).toEqual({ quote: 100, trades: 100, book: 250 });
    expect(MAX_FOLLOWS).toBe(16);
  });

  it("pushes a followed market's quote, book and trades", async () => {
    const { h, srv } = await market();
    const s = listen(`${srv.url}/api/stream?client=${CLIENT}&markets=fake:BTC/USDT`);
    await s.until(() => of(s.frames, "snapshot").length === 1);
    // held with its book, and what it stands at told at once: nothing yet
    await s.until(() => h.seen.holds.includes("fake|BTC/USDT|book"));
    await s.until(() => of(s.frames, "quote").length >= 1 && of(s.frames, "book").length >= 1 && of(s.frames, "trades").length >= 1);
    expect(of(s.frames, "quote")[0]!.data).toEqual({ key: "fake:BTC/USDT", venue: "fake", symbol: "BTC/USDT", source: "fake", live: false });
    await new Promise((r) => setTimeout(r, 300));
    h.quote("fake", "BTC/USDT");
    h.book("fake", "BTC/USDT");
    h.trade("fake", "BTC/USDT", 62_000);
    await s.until(() => of(s.frames, "quote").some((f) => f.data.bid === 61_999) && of(s.frames, "book").some((f) => f.data.live === true) && of(s.frames, "trades").some((f) => f.data.trades.length === 1));
    expect(of(s.frames, "quote").at(-1)!.data).toMatchObject({ key: "fake:BTC/USDT", venue: "fake", symbol: "BTC/USDT", source: "fake", bid: 61_999, ask: 62_001, last: 62_000, from: "Fake Ex · live", live: true });
    expect(of(s.frames, "book").at(-1)!.data).toMatchObject({ key: "fake:BTC/USDT", bids: [[61_999, 1]], asks: [[62_001, 2]], from: "Fake Ex · live", depth: "full", live: true });
    expect(of(s.frames, "trades").at(-1)!.data).toMatchObject({ key: "fake:BTC/USDT", trades: [{ price: 62_000, size: 1 }], live: true });
    // a page that shows another market says so: the first is let go
    const r = await fetch(`${srv.url}/api/stream/markets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: CLIENT, markets: ["fake:ETH/USDT"], n: 1 }) });
    expect(await r.json()).toEqual({ ok: true, following: ["fake:ETH/USDT"] });
    expect(h.seen.releases).toContain("fake|BTC/USDT|book");
  });

  it("tells a price-only market its quote alone", async () => {
    const { h, srv } = await market();
    const s = listen(`${srv.url}/api/stream?client=${CLIENT}&markets=~fake:BTC/USDT,stocks:AAPL`);
    await s.until(() => h.seen.holds.includes("fake|BTC/USDT") && h.seen.holds.includes("stocks|AAPL"));
    await new Promise((r) => setTimeout(r, 300));
    h.quote("fake", "BTC/USDT");
    h.book("fake", "BTC/USDT");
    h.trade("fake", "BTC/USDT", 62_000);
    h.quote("stocks", "AAPL", { bid: 230, ask: 231 });
    h.book("stocks", "AAPL");
    await s.until(() => of(s.frames, "quote").some((f) => f.data.key === "~fake:BTC/USDT" && f.data.bid === 61_999) && of(s.frames, "quote").some((f) => f.data.key === "stocks:AAPL" && f.data.bid === 230));
    await new Promise((r) => setTimeout(r, 400));
    expect(of(s.frames, "book")).toEqual([]);
    expect(of(s.frames, "trades")).toEqual([]);
    // held without the book
    expect(h.seen.holds).not.toContain("fake|BTC/USDT|book");
    expect(h.seen.holds).not.toContain("stocks|AAPL|book");
  });

  it("refuses a navigation and a bad client name", async () => {
    const { srv } = await market();
    // a browser's own header, which fetch() sets itself: asked over http as a browser would send it
    const nav = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(`${srv.url}/api/stream?client=${CLIENT}`, { headers: { "sec-fetch-mode": "navigate" } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end();
    });
    expect(nav.status).toBe(403);
    expect(JSON.parse(nav.body)).toEqual({ ok: false, error: "this server answers only programs on this machine" });
    const bad = await fetch(`${srv.url}/api/stream?client=short`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "a page names itself in 8 to 48 letters, digits, dashes or underscores" });
    const post = (body: unknown) => fetch(`${srv.url}/api/stream/markets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const noName = await post({ client: "x", markets: [] });
    expect(noName.status).toBe(400);
    expect(await noName.json()).toEqual({ ok: false, error: "a page names itself in 8 to 48 letters, digits, dashes or underscores (\"client\")" });
    const notOpen = await post({ client: CLIENT, markets: ["fake:BTC/USDT"] });
    expect(notOpen.status).toBe(404);
    const said = (await notOpen.json()) as { error: string };
    expect(said).toEqual({ ok: false, error: "no stream of that page is open: it opens one at GET /api/stream first" });
    expect(said.error).not.toMatch(/account/i);
  });
});
