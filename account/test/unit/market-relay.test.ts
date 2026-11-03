/** LUNHUI AND AKSHARE THROUGH THE ACCOUNT: the account's four /api/cn/* and /api/akshare/* routes relay the market's answer byte for
 * byte, to a stub market here (a plain node:http server that records each request — no market code), and say so in their own words when
 * it does not answer, or answer `off` with no market at all, as before. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MARKET_DOWN } from "../../src/portfolio/market/client.ts";
import { connectMarket, type MarketLink } from "../../src/portfolio/market/link.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
  closed: boolean;
}
/** the stub market: each request recorded, answered by the test's handler */
let stub: Server;
let stubUrl: string;
let answer: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void = (_q, res) => void res.end();
const seen: Seen[] = [];

let home: string;
let svc: PortfolioService;
const servers: PortfolioServerHandle[] = [];
const links: MarketLink[] = [];

async function startStub(port = 0): Promise<void> {
  stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const s: Seen = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks), closed: false };
      seen.push(s);
      res.on("close", () => (s.closed = true));
      answer(req, res, s);
    });
  });
  await new Promise<void>((r) => stub.listen(port, "127.0.0.1", r));
  stubUrl = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
}
const stopStub = () =>
  new Promise<void>((r) => {
    stub.close(() => r());
    stub.closeAllConnections();
  });

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "market-relay-"));
  svc = await PortfolioService.create({ home, venues: "frontline", real: true, publicMarkets: [], liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined } });
});
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const l of links.splice(0)) l.close();
  if (stub?.listening) await stopStub();
  seen.length = 0;
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** the account, its market the stub */
async function account(): Promise<string> {
  const market = connectMarket({ url: stubUrl });
  links.push(market);
  const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0, market });
  servers.push(srv);
  return srv.url;
}

describe("the account relays Lunhui and AKShare to the market", () => {
  it("relays bytes unchanged", async () => {
    const gbk = Uint8Array.from([0xb9, 0xfa, 0xc6, 0xf3, 0xff]);
    answer = (_q, res) => void res.writeHead(200, { "content-type": "text/plain; charset=GBK", "x-cn-relay": "upstream", "x-content-type-options": "nosniff" }).end(Buffer.from(gbk));
    await startStub();
    const url = await account();
    const query = `url=${encodeURIComponent("https://qt.gtimg.cn/q=sh600519")}`;
    const r = await fetch(`${url}/api/cn/relay?${query}`, { headers: { accept: "*/*", referer: "https://gu.qq.com/", "user-agent": "Lunhui-Test/1" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=GBK");
    expect(r.headers.get("x-cn-relay")).toBe("upstream");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([...gbk]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!).toMatchObject({ method: "GET", url: `/api/cn/relay?${query}` });
    expect(seen[0]!.headers).toMatchObject({ accept: "*/*", referer: "https://gu.qq.com/", "user-agent": "Lunhui-Test/1" });
    expect(seen[0]!.headers.origin).toBeUndefined();
  });

  it("relays a redirect's location", async () => {
    answer = (_q, res) => void res.writeHead(302, { location: "http://qt.gtimg.cn/x", "x-cn-relay": "upstream", "content-type": "text/html" }).end("moved");
    await startStub();
    const url = await account();
    const r = await fetch(`${url}/api/cn/relay?url=${encodeURIComponent("https://qt.gtimg.cn/q=sh600519")}`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("http://qt.gtimg.cn/x");
    expect(r.headers.get("x-cn-relay")).toBe("upstream");
    expect(await r.text()).toBe("moved");
  });

  it("relays iFinD's body and answers unreachable when the market is down", async () => {
    answer = (_q, res) => void res.writeHead(200, { "content-type": "application/json", "x-cn-ifind": "upstream" }).end('{"tables":[]}');
    await startStub();
    const url = await account();
    const body = { query: "A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念" };
    const r = await fetch(`${url}/api/cn/ifind`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect([r.status, r.headers.get("x-cn-ifind"), await r.text()]).toEqual([200, "upstream", '{"tables":[]}']);
    expect(seen[0]!).toMatchObject({ method: "POST", url: "/api/cn/ifind" });
    expect(JSON.parse(seen[0]!.body.toString("utf8"))).toEqual(body);
    expect(seen[0]!.headers["content-type"]).toBe("application/json");
    await stopStub();
    const down = await fetch(`${url}/api/cn/ifind`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect([down.status, down.headers.get("x-cn-ifind"), await down.json()]).toEqual([502, "refused", { ok: false, ifind: "unreachable" }]);
    const relay = await fetch(`${url}/api/cn/relay?url=${encodeURIComponent("https://qt.gtimg.cn/q=sh600519")}`);
    expect([relay.status, relay.headers.get("x-cn-relay"), await relay.json()]).toEqual([502, "refused", { ok: false, relay: "unreachable" }]);
  });

  it("relays AKShare and says the market is down in plain words", async () => {
    answer = (req, res) => {
      if (req.url === "/api/akshare/tools") return void res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true,"tools":[{"name":"akshare_discover"}]}');
      res.writeHead(400, { "content-type": "application/json" }).end('{"ok":false,"akshare":"unknown-tool","message":"no such tool"}');
    };
    await startStub();
    const url = await account();
    const tools = await fetch(`${url}/api/akshare/tools`);
    expect([tools.status, await tools.json()]).toEqual([200, { ok: true, tools: [{ name: "akshare_discover" }] }]);
    const call = await fetch(`${url}/api/akshare/call`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "akshare_nope", arguments: { a: 1 } }) });
    expect([call.status, await call.json()]).toEqual([400, { ok: false, akshare: "unknown-tool", message: "no such tool" }]);
    expect(JSON.parse(seen[1]!.body.toString("utf8"))).toEqual({ tool: "akshare_nope", arguments: { a: 1 } });
    await stopStub();
    const down = await fetch(`${url}/api/akshare/tools`);
    expect([down.status, await down.json()]).toEqual([503, { ok: false, akshare: "unavailable", message: MARKET_DOWN }]);
    const downCall = await fetch(`${url}/api/akshare/call`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "akshare_stock_a" }) });
    expect([downCall.status, await downCall.json()]).toEqual([503, { ok: false, akshare: "unavailable", message: MARKET_DOWN }]);
  });

  it("an aborted call aborts upstream", async () => {
    // the stub holds the call open, as a 120 s AKShare call would be held
    answer = () => undefined;
    await startStub();
    const url = await account();
    const caller = new AbortController();
    const call = fetch(`${url}/api/akshare/call`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "akshare_stock_a" }), signal: caller.signal }).catch(() => "aborted");
    const t0 = Date.now();
    while (!seen.length) {
      if (Date.now() - t0 > 3_000) throw new Error("the stub never saw the call");
      await new Promise((go) => setTimeout(go, 10));
    }
    caller.abort();
    expect(await call).toBe("aborted");
    const t1 = Date.now();
    while (!seen[0]!.closed) {
      if (Date.now() - t1 > 1_000) throw new Error("the account's request to the market was not aborted within 1 s");
      await new Promise((go) => setTimeout(go, 10));
    }
  });

  it("answers off with no market, as before", async () => {
    const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
    servers.push(srv);
    const relay = await fetch(`${srv.url}/api/cn/relay?url=${encodeURIComponent("https://qt.gtimg.cn/q=sh600519")}`);
    expect([relay.status, relay.headers.get("x-cn-relay"), await relay.json()]).toEqual([503, "refused", { ok: false, relay: "off" }]);
    const notListed = await fetch(`${srv.url}/api/cn/relay`);
    expect([notListed.status, await notListed.json()]).toEqual([403, { ok: false, relay: "not-listed" }]);
    const ifind = await fetch(`${srv.url}/api/cn/ifind`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念" }) });
    expect([ifind.status, await ifind.json()]).toEqual([503, { ok: false, ifind: "off" }]);
    const tools = await fetch(`${srv.url}/api/akshare/tools`);
    expect([tools.status, await tools.json()]).toEqual([503, { ok: false, akshare: "off", message: "this Account runs no AKShare sidecar" }]);
    const call = await fetch(`${srv.url}/api/akshare/call`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "akshare_stock_a" }) });
    expect([call.status, await call.json()]).toEqual([503, { ok: false, akshare: "off", message: "this Account runs no AKShare sidecar" }]);
  });
});
