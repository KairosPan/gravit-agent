import { readFileSync } from "node:fs";
import { request, type ClientRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMarketCore, realMarketCore, type MarketCore } from "../../src/core.ts";
import { HUB_WAIT_MAX_MS, mountProtocol, type HubEvent } from "../../src/protocol.ts";
import { startMarketServer, type MarketServerHandle } from "../../src/server.ts";
import type { HubBook, HubQuote, HubTick, MarketHub } from "../../src/live/stream-hub.ts";

const ROWS = JSON.parse(readFileSync(new URL("../fixtures/hub-covers.json", import.meta.url), "utf8")) as Array<{ source: string; symbol: string; covers: boolean; pricesOnly: boolean }>;
const CLIENT = "account-test-1";

/** a hub as the tests build one: it covers coinbase's pairs, counts its holds and releases, and keeps a ring the test adds to */
function fakeHub() {
  const listeners = new Set<(t: HubTick) => void>();
  const ring: Array<{ seq: number; at: number; price: number; snap: boolean }> = [];
  const seen = { holds: 0, releases: 0, bookHolds: 0, confirmedWait: [] as number[] };
  let seq = 0;
  const quote = (): HubQuote => ({ bid: 99, ask: 101, last: 100, at: 1, recvAt: 1, seenAt: 1, src: "Coinbase", seq, live: true });
  const book: HubBook = { bids: [[99, 1]], asks: [[101, 2]], at: 1, recvAt: 1, seenAt: 1, src: "Coinbase", live: true };
  const hub: MarketHub = {
    covers: (source) => source === "coinbase",
    want: (source) => source === "coinbase",
    hold(_s, _y, o) {
      seen.holds++;
      if (o?.book) seen.bookHolds++;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        seen.releases++;
      };
    },
    quote: () => quote(),
    book: () => book,
    trades: (_s, _y, limit) => ring.slice(-limit).reverse().map((t) => ({ price: t.price, size: 1, at: new Date(t.at).toISOString() })),
    since: () => ({ trades: 0, seq }),
    async confirmed(_s, _y, _m, waitMs) {
      seen.confirmedWait.push(waitMs);
      return quote();
    },
    onTick(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    close: () => listeners.clear(),
    ring: (_s, _y, after) => ({ trades: ring.filter((t) => t.seq > after), evictedSeq: 0 }),
  };
  /** a trade printed: into the ring, and told as the hub tells it */
  const trade = (price: number) => {
    ring.push({ seq: ++seq, at: 1_000 + seq, price, snap: false });
    for (const fn of listeners) fn({ source: "coinbase", symbol: "BTC/USD", what: "trades" });
  };
  const tick = (what: HubTick["what"]) => {
    for (const fn of listeners) fn({ source: "coinbase", symbol: "BTC/USD", what });
  };
  return { hub, seen, trade, tick };
}

const servers: MarketServerHandle[] = [];
const streams: ClientRequest[] = [];
afterEach(async () => {
  for (const s of streams.splice(0)) s.destroy();
  for (const s of servers.splice(0)) await s.close();
});
async function serve(core: MarketCore): Promise<string> {
  const srv = await startMarketServer({ port: 0, mount: (app) => mountProtocol(app, core), close: () => core.close() });
  servers.push(srv);
  return srv.url;
}
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** the hub stream opened for a client: each event as it comes, and the request (destroy it to close the stream) */
async function open(url: string, client = CLIENT): Promise<{ events: HubEvent[]; req: ClientRequest; status: number }> {
  const events: HubEvent[] = [];
  let buf = "";
  return new Promise((resolve, reject) => {
    const req = request(`${url}/api/hub?client=${client}`, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)) as HubEvent);
        }
      });
      res.on("error", () => {});
      resolve({ events, req, status: res.statusCode ?? 0 });
    });
    req.on("error", (e) => (streams.includes(req) ? undefined : reject(e)));
    req.end();
    streams.push(req);
  });
}
const until = async (ok: () => boolean, ms = 2_000) => {
  const t0 = Date.now();
  while (!ok() && Date.now() - t0 < ms) await sleep(10);
  expect(ok()).toBe(true);
};

describe("the hub over HTTP", () => {
  it("covers as the hub covers, for every row of the fixture", async () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(12);
    const core = realMarketCore();
    const url = await serve(core);
    for (const row of ROWS) {
      const r = await fetch(`${url}/api/hub/covers?source=${encodeURIComponent(row.source)}&symbol=${encodeURIComponent(row.symbol)}`).then((x) => x.json());
      expect({ ...row, ...(r as { value: object }).value }).toEqual(row);
      expect(core.hub!.covers(row.source, row.symbol)).toBe(row.covers);
    }
  });

  it("pushes a held market's quote, its book only for a book hold, and its trades with their ring", async () => {
    const f = fakeHub();
    const url = await serve(createMarketCore({ hub: f.hub }));
    const s = await open(url);
    expect(s.status).toBe(200);
    expect((await post(`${url}/api/hub/hold`, { client: CLIENT, source: "coinbase", symbol: "BTC/USD", book: false, held: true })).body).toEqual({ ok: true });
    await until(() => s.events.some((e) => e.t === "quote"));
    f.tick("book");
    f.trade(100);
    await until(() => s.events.some((e) => e.t === "trades"));
    await sleep(300);
    expect(s.events.some((e) => e.t === "book")).toBe(false);
    const tr = s.events.find((e) => e.t === "trades") as Extract<HubEvent, { t: "trades" }>;
    expect(tr).toMatchObject({ source: "coinbase", symbol: "BTC/USD", ring: [{ seq: 1, price: 100, snap: false }], evictedSeq: 0, recent: [{ price: 100 }] });
    expect((s.events.find((e) => e.t === "quote") as Extract<HubEvent, { t: "quote" }>).quote).toMatchObject({ bid: 99, ask: 101, live: true });
    await post(`${url}/api/hub/hold`, { client: CLIENT, source: "coinbase", symbol: "BTC/USD", book: true, held: true });
    await until(() => s.events.some((e) => e.t === "book"));
    expect((s.events.find((e) => e.t === "book") as Extract<HubEvent, { t: "book" }>).book).toMatchObject({ bids: [[99, 1]], asks: [[101, 2]] });
    f.tick("live");
    await until(() => s.events.some((e) => e.t === "live"));
    expect(s.events.find((e) => e.t === "live")).toEqual({ t: "live", source: "coinbase", symbol: "BTC/USD", live: true });
    // a bad hold is a 400
    expect((await post(`${url}/api/hub/hold`, { client: "x", source: "coinbase", symbol: "BTC/USD", held: true })).status).toBe(400);
    expect((await post(`${url}/api/hub/hold`, { client: CLIENT, source: "coinbase", symbol: "BTC/USD" })).status).toBe(400);
    expect((await fetch(`${url}/api/hub?client=x`)).status).toBe(400);
  });

  it("releases every hold of a client when its stream closes", async () => {
    const f = fakeHub();
    const url = await serve(createMarketCore({ hub: f.hub }));
    const s = await open(url);
    await post(`${url}/api/hub/hold`, { client: CLIENT, source: "coinbase", symbol: "BTC/USD", book: false, held: true });
    await post(`${url}/api/hub/hold`, { client: CLIENT, source: "coinbase", symbol: "BTC/USD", book: true, held: true });
    await post(`${url}/api/hub/hold`, { client: CLIENT, source: "coinbase", symbol: "ETH/USD", book: false, held: true });
    // the same hold twice is one hold
    await post(`${url}/api/hub/hold`, { client: CLIENT, source: "coinbase", symbol: "ETH/USD", book: false, held: true });
    expect(f.seen.holds).toBe(3);
    // one let go by the client itself
    await post(`${url}/api/hub/hold`, { client: CLIENT, source: "coinbase", symbol: "ETH/USD", book: false, held: false });
    expect(f.seen.releases).toBe(1);
    s.req.destroy();
    await until(() => f.seen.releases === f.seen.holds);
    expect(f.seen.releases).toBe(3);
  });

  it("sends each ring entry once per client", async () => {
    const f = fakeHub();
    const url = await serve(createMarketCore({ hub: f.hub }));
    const s = await open(url);
    await post(`${url}/api/hub/hold`, { client: CLIENT, source: "coinbase", symbol: "BTC/USD", book: false, held: true });
    f.trade(100);
    f.trade(101);
    await until(() => s.events.filter((e) => e.t === "trades").length === 1);
    f.trade(102);
    await until(() => s.events.filter((e) => e.t === "trades").length === 2);
    const [one, two] = s.events.filter((e): e is Extract<HubEvent, { t: "trades" }> => e.t === "trades");
    expect(one!.ring.map((t) => t.seq)).toEqual([1, 2]);
    expect(two!.ring.map((t) => t.seq)).toEqual([3]);
    expect(two!.ring[0]!.seq).toBeGreaterThan(one!.ring.at(-1)!.seq);
    // a want is the hub's, its answer the value
    expect((await post(`${url}/api/hub/want`, { client: CLIENT, source: "coinbase", symbol: "SOL/USD" })).body).toEqual({ ok: true, value: true });
    expect((await post(`${url}/api/hub/want`, { client: CLIENT, source: "kraken", symbol: "SOL/USD" })).body).toEqual({ ok: true, value: false });
  });

  it("proxies confirmed, waiting no more than 5000 ms", async () => {
    const f = fakeHub();
    const url = await serve(createMarketCore({ hub: f.hub }));
    const r = await fetch(`${url}/api/hub/confirmed?source=coinbase&symbol=BTC/USD&maxAgeMs=2000&waitMs=60000`).then((x) => x.json());
    expect(r).toMatchObject({ ok: true, value: { bid: 99, ask: 101, live: true } });
    await fetch(`${url}/api/hub/confirmed?source=coinbase&symbol=BTC/USD&maxAgeMs=2000&waitMs=300`);
    expect(f.seen.confirmedWait).toEqual([HUB_WAIT_MAX_MS, 300]);
    expect(HUB_WAIT_MAX_MS).toBe(5_000);
    expect((await fetch(`${url}/api/hub/confirmed?source=coinbase&symbol=BTC/USD`)).status).toBe(400);
    // no hub: nothing confirmed
    const bare = await serve(createMarketCore({}));
    expect(await fetch(`${bare}/api/hub/confirmed?source=coinbase&symbol=BTC/USD&maxAgeMs=2000`).then((x) => x.json())).toEqual({ ok: true, value: null });
  });
});
