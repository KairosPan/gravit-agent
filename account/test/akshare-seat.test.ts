/** The seat's portfolio_akshare against an Account whose market runs the AKShare sidecar (a market in this process, its child a stand-in),
 * and against one without the routes. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMarketCore } from "../../market/src/core.ts";
import { createAkshare } from "../../market/src/live/akshare.ts";
import { mountCn } from "../../market/src/routes-cn.ts";
import { startMarketServer, type MarketServerHandle } from "../../market/src/server.ts";
import { connectMarket, type MarketLink } from "../src/portfolio/market/link.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../src/portfolio/server.ts";
import { PortfolioService } from "../src/portfolio/service.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../market/test/fixtures/fake-akshare-mcp.mjs", import.meta.url));

let home: string;
let svc: PortfolioService;
let server: PortfolioServerHandle;
let market: MarketServerHandle;
let link: MarketLink;
let bare: Server;
let bareUrl: string;
const clients: Client[] = [];

async function seat(url: string): Promise<Client> {
  const c = new Client({ name: "vitest", version: "0" });
  await c.connect(new StdioClientTransport({ command: join(ROOT, "node_modules", ".bin", "tsx"), args: [join(ROOT, "src", "portfolio", "mcp.ts")], env: { ...(process.env as Record<string, string>), PORTFOLIO_URL: url, PORTFOLIO_AGENT: "DeepSeek Harness", BUYER_HOME: home }, stderr: "ignore" }));
  clients.push(c);
  return c;
}
const ask = (c: Client, args: Record<string, unknown>) => c.callTool({ name: "portfolio_akshare", arguments: args }).then((r) => ({ isError: r.isError === true, text: (r.content as Array<{ text: string }>)[0]!.text }));

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "akshare-seat-"));
  svc = await PortfolioService.create({ home, venues: "frontline", real: true, publicMarkets: [], liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined } });
  const core = createMarketCore({ akshare: createAkshare({ command: process.execPath, args: [FIXTURE] }) });
  market = await startMarketServer({ port: 0, mount: (app) => mountCn(app, core), close: () => core.close() });
  link = connectMarket({ url: market.url });
  server = await startPortfolioServer({ port: 0, service: svc, market: link });
  bare = createServer((_req, res) => void res.writeHead(404, { "content-type": "text/html" }).end("<html>Cannot POST</html>"));
  await new Promise<void>((r) => bare.listen(0, "127.0.0.1", r));
  bareUrl = `http://127.0.0.1:${(bare.address() as { port: number }).port}`;
}, 30_000);

afterAll(async () => {
  for (const c of clients) await c.close();
  await server?.close();
  await market?.close();
  await new Promise((r) => bare?.close(r));
  rmSync(home, { recursive: true, force: true });
});

describe("portfolio_akshare through the MCP seat", () => {
  it("Gravit asks AKShare through the seat", async () => {
    const r = await ask(await seat(server.url), { tool: "akshare_stock_a", arguments: { method: "stock_zh_a_spot_tx" } });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text)).toEqual({ rows: [{ 代码: "600519", 名称: "贵州茅台" }], row_count: 1, truncated: false });
  }, 30_000);

  it("a tool's own error stays the tool's", async () => {
    const r = await ask(await seat(server.url), { tool: "akshare_stock_a", arguments: { method: "fails" } });
    expect(r.isError).toBe(true);
    expect(r.text).toBe('{"error":"upstream refused"}');
  }, 30_000);

  it("a refusal is the Account's word", async () => {
    const r = await ask(await seat(server.url), { tool: "akshare_nope" });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ ok: false, akshare: "unknown-tool" });
  }, 30_000);

  it("an Account without the routes says to restart it", async () => {
    const r = await ask(await seat(bareUrl), { tool: "akshare_discover" });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.text).error).toMatch(/restart it from this tree/);
  }, 30_000);
});
