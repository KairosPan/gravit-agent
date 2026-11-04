/** `/data/market/<read>` (plan A2 Task 5): the market's public reads and its push channel through the face, on the
 * proxy core the account's half is built on (src/upstream-proxy.ts) — seven exact routes, each read at the market's
 * own `/api/<read>` with its rebuilt query, the market not answering as 503 `unreachable` with a kept answer re-served
 * stale, a disabled `mcp-market` row disabling the market half alone, and the stream piped from `/api/stream` with
 * its follows posted to `/api/stream/markets`. The market and the account are stub servers on ephemeral loopback
 * ports; nothing leaves 127.0.0.1. */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { ACCOUNT_ABORT_MS, ACCOUNT_QUERY, ACCOUNT_TTL_MS, registerAccountProxy } from "../src/account-proxy.ts";
import { MARKET_READS, registerMarketProxy } from "../src/market-proxy.ts";

const DISABLED = '{"ok":false,"unreachable":"disabled"}';
const CLIENT = "face-0123456789abcdef01234567";
const HOST = { host: "127.0.0.1:3090" };
const JSON_POST = { host: "127.0.0.1:3090", "content-type": "application/json" };

/** A stub upstream recording each request's method, path, query and body; `answer` says what it sends. */
async function stub(answer: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<{ url: string; seen: Array<{ method: string; path: string; body: string }>; server: Server; close(): Promise<void> }> {
  const seen: Array<{ method: string; path: string; body: string }> = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => { seen.push({ method: req.method ?? "", path: req.url ?? "", body }); answer(req, res, body); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, seen, server, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
const json = (res: ServerResponse, status: number, body: unknown): void => { res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body)); };

class FakeRes extends EventEmitter {
  status = 0;
  headers: Record<string, string> = {};
  body = "";
  writes: Buffer[] = [];
  destroyed = false;
  writableLength = 0;
  writeHead(status: number, headers?: Record<string, string>): this { this.status = status; Object.assign(this.headers, headers ?? {}); return this; }
  write(chunk: Uint8Array): boolean { this.writes.push(Buffer.from(chunk)); return true; }
  end(body?: string | Buffer): this { this.body = String(body ?? ""); return this; }
  destroy(): this { this.destroyed = true; this.emit("close"); return this; }
}
const req = (url: string, headers: Record<string, string> = HOST, method = "GET", body?: string): IncomingMessage =>
  (body === undefined ? { url, headers, method } : Object.assign(Readable.from([Buffer.from(body)]), { url, headers, method })) as unknown as IncomingMessage;

async function call(routes: WebRoute[], url: string, headers?: Record<string, string>, method?: string, body?: string): Promise<FakeRes> {
  const path = url.split("?", 1)[0];
  const route = routes.find((r) => r.path === path);
  assert.ok(route !== undefined, `no route at ${path}`);
  const out = new FakeRes();
  await route.handler(req(url, headers, method, body), out as unknown as ServerResponse);
  return out;
}

const register = (): { routes: WebRoute[]; registrar: { register(route: WebRoute): void } } => {
  const routes: WebRoute[] = [];
  return { routes, registrar: { register: (route: WebRoute) => { routes.push(route); } } };
};

test("mounts seven routes under /data/market and nothing else", () => {
  const { routes, registrar } = register();
  const proxy = registerMarketProxy(registrar, { url: "http://127.0.0.1:9" });
  assert.deepEqual(routes.map((r) => `${r.kind} ${r.path}`), [
    "exact /data/market/explore", "exact /data/market/quotes", "exact /data/market/candles", "exact /data/market/book",
    "exact /data/market/trades", "exact /data/market/stream", "exact /data/market/stream/markets",
  ]);
  const names = ["explore", "quotes", "candles", "book", "trades"] as const;
  assert.deepEqual(MARKET_READS.map((r) => [r.face, r.upstream]), names.map((n) => [`/data/market/${n}`, `/api/${n}`]));
  for (const [i, n] of names.entries()) {
    const r = MARKET_READS[i]!;
    assert.deepEqual(r.query, ACCOUNT_QUERY[n], `${n}'s names are the account route's`);
    assert.equal(r.ttlMs, ACCOUNT_TTL_MS[n], `${n}'s TTL`);
    assert.equal(r.abortMs, ACCOUNT_ABORT_MS[n], `${n}'s abort`);
  }
  assert.equal(MARKET_READS[1]!.long?.get("pairs"), 2_000, "pairs keeps its own 2 000");
  assert.ok(!routes.some((r) => /account/.test(r.path)), "nothing under the market says account");
  proxy.dispose();
});

test("a read goes to the market's own path with its rebuilt query", async () => {
  const market = await stub((_q, res) => json(res, 200, { ok: true, items: [] }));
  try {
    const { routes, registrar } = register();
    registerMarketProxy(registrar, { url: market.url });
    const a = await call(routes, "/data/market/explore?q=BTC");
    assert.equal(a.status, 200); assert.equal(a.body, '{"ok":true,"items":[]}');
    assert.equal(a.headers["content-type"], "application/json; charset=utf-8"); assert.equal(a.headers["cache-control"], "no-store");
    assert.deepEqual(market.seen.map((s) => `${s.method} ${s.path}`), ["GET /api/explore?q=BTC"]);
    const bad = await call(routes, "/data/market/explore?q=BTC&x=1");
    assert.equal(bad.status, 400);
    assert.doesNotMatch(bad.body, /account/, "the market's refusal does not say account");
    assert.equal(market.seen.length, 1, "the market saw nothing of the bad read");
    await call(routes, "/data/market/candles?venue=okx&symbol=BTC%2FUSDT&interval=1h&range=1d");
    await call(routes, "/data/market/book?venue=okx&symbol=BTC%2FUSDT&depth=20");
    await call(routes, "/data/market/trades?venue=okx&symbol=BTC%2FUSDT&limit=50");
    await call(routes, "/data/market/quotes?pairs=china%7C600519");
    assert.deepEqual(market.seen.slice(1).map((s) => s.path), [
      "/api/candles?venue=okx&symbol=BTC%2FUSDT&interval=1h&range=1d",
      "/api/book?venue=okx&symbol=BTC%2FUSDT&depth=20",
      "/api/trades?venue=okx&symbol=BTC%2FUSDT&limit=50",
      "/api/quotes?pairs=china%7C600519",
    ]);
    const foreign = await call(routes, "/data/market/explore?q=BTC", { host: "127.0.0.1:3090", origin: "https://evil.example" });
    assert.equal(foreign.status, 403, "the fence");
    assert.equal((await call(routes, "/data/market/explore", HOST, "POST")).status, 405);
    assert.equal(market.seen.length, 5);
  } finally {
    await market.close();
  }
});

test("the market not answering is 503 unreachable, a kept answer re-served stale", async () => {
  let up = true;
  const market = await stub((_q, res) => (up ? json(res, 200, { ok: true, items: [1] }) : res.socket?.destroy()));
  let clock = 1_000_000;
  try {
    const { routes, registrar } = register();
    registerMarketProxy(registrar, { url: market.url, now: () => clock });
    assert.equal((await call(routes, "/data/market/explore?q=ETH")).status, 200);
    up = false;
    clock += ACCOUNT_TTL_MS.explore;
    const stale = await call(routes, "/data/market/explore?q=ETH");
    assert.equal(stale.status, 200);
    assert.equal(JSON.parse(stale.body).stale, true, "the kept answer, flagged stale");
    const none = await call(routes, "/data/market/explore?q=SOL");
    assert.equal(none.status, 503);
    assert.match(none.body, /^\{"ok":false,"unreachable":"[A-Za-z_]+"\}$/);
  } finally {
    await market.close();
  }
  const { routes, registrar } = register();
  registerMarketProxy(registrar, { url: "http://127.0.0.1:9" });
  const refused = await call(routes, "/data/market/quotes?pairs=china%7C600519");
  assert.equal(refused.status, 503);
  assert.match(refused.body, /^\{"ok":false,"unreachable":"[A-Za-z_]+"\}$/, "a closed port: the failure's code, never its text");
});

test("a disabled mcp-market row disables the market half alone", async () => {
  const market = await stub((_q, res) => json(res, 200, { ok: true }));
  const account = await stub((_q, res) => json(res, 200, { ok: true, holdings: [] }));
  try {
    const { routes, registrar } = register();
    const marketProxy = registerMarketProxy(registrar, { url: market.url, disabled: true });
    const accountProxy = registerAccountProxy(registrar, { url: account.url });
    const off = await call(routes, "/data/market/explore?q=BTC");
    assert.equal(off.status, 503); assert.equal(off.body, DISABLED);
    const offStream = await call(routes, `/data/market/stream?client=${CLIENT}`);
    assert.equal(offStream.status, 503); assert.equal(offStream.body, DISABLED);
    const offFollow = await call(routes, "/data/market/stream/markets", JSON_POST, "POST", `{"client":"${CLIENT}","markets":[]}`);
    assert.equal(offFollow.status, 503); assert.equal(offFollow.body, DISABLED);
    assert.deepEqual(await marketProxy.explore("q=BTC"), { unreachable: "disabled" });
    assert.equal(market.seen.length, 0, "the market is never asked");
    const holdings = await call(routes, "/data/account/holdings");
    assert.equal(holdings.status, 200); assert.equal(holdings.body, '{"ok":true,"holdings":[]}');
    assert.deepEqual(account.seen.map((s) => s.path), ["/api/account/holdings"], "the account half still answers");
    marketProxy.dispose(); accountProxy.dispose();
  } finally {
    await market.close(); await account.close();
  }
});

test("the stream is piped from /api/stream, follows posted to /api/stream/markets", async () => {
  const market = await stub((q, res, body) => {
    if (q.url?.startsWith("/api/stream?")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("id: 7\nevent: quote\ndata: {\"venue\":\"okx\"}\n\n");
      res.end();
      return;
    }
    if (q.url === "/api/stream/markets") return json(res, 200, { ok: true, following: JSON.parse(body).markets });
    json(res, 404, { ok: false });
  });
  try {
    const { routes, registrar } = register();
    registerMarketProxy(registrar, { url: market.url });
    const piped = await call(routes, `/data/market/stream?client=${CLIENT}&markets=okx%3ABTC%2FUSDT`, { ...HOST, "last-event-id": "5" });
    assert.equal(piped.status, 200);
    assert.equal(piped.headers["content-type"], "text/event-stream; charset=utf-8");
    assert.equal(Buffer.concat(piped.writes).toString(), "id: 7\nevent: quote\ndata: {\"venue\":\"okx\"}\n\n", "frames byte for byte");
    assert.equal(market.seen[0]!.path, `/api/stream?client=${CLIENT}&markets=okx%3ABTC%2FUSDT&since=5`, "Last-Event-ID is since");
    assert.equal((await call(routes, "/data/market/stream?client=bad")).status, 400, "a bad client is refused before the market");
    const body = `{"client":"${CLIENT}","markets":["okx:BTC/USDT"],"n":1}`;
    const follow = await call(routes, "/data/market/stream/markets", JSON_POST, "POST", body);
    assert.equal(follow.status, 200);
    assert.deepEqual(JSON.parse(follow.body), { ok: true, following: ["okx:BTC/USDT"] });
    assert.deepEqual(market.seen.slice(1).map((s) => [s.method, s.path, s.body]), [["POST", "/api/stream/markets", body]], "the body as posted");
    assert.equal((await call(routes, "/data/market/stream/markets", HOST, "POST", body)).status, 415, "JSON only");
    assert.equal((await call(routes, "/data/market/stream/markets", JSON_POST, "POST", "x".repeat(4_097))).status, 413);
    assert.equal(market.seen.length, 2);
  } finally {
    await market.close();
  }
});
