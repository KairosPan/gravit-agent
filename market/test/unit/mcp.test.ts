/** market:mcp (src/mcp.ts): the market's own stdio MCP server, Gravit's keyless reads — spawned as the face's mcp-market row would spawn
 * it, over an in-process market holding a fake public source, a fake China and the fake AKShare sidecar. */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createAkshare } from "../../src/live/akshare.ts";
import { createMarketCore } from "../../src/core.ts";
import { mountProtocol } from "../../src/protocol.ts";
import { mountCn } from "../../src/routes-cn.ts";
import { marketReads, mountReads } from "../../src/reads.ts";
import { mountStream } from "../../src/follows.ts";
import { startMarketServer, type MarketServerHandle } from "../../src/server.ts";
import { fakeChina, fakeSource } from "../fakes.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/fake-akshare-mcp.mjs", import.meta.url));

type Text = { type: "text"; text: string };
const body = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse(((r.content as Text[])[0] as Text).text) as Record<string, any>;

async function seat(url: string): Promise<Client> {
  const c = new Client({ name: "market-mcp-test", version: "0.0.0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(ROOT, "src", "mcp.ts")], cwd: ROOT, env: { ...(process.env as Record<string, string>), MARKET_URL: url }, stderr: "ignore" }));
  return c;
}

let srv: MarketServerHandle;
let client: Client;

beforeAll(async () => {
  const core = createMarketCore({ sources: [fakeSource()], china: fakeChina(), akshare: createAkshare({ command: process.execPath, args: [FIXTURE] }) });
  let endStream: (() => void) | undefined;
  srv = await startMarketServer({
    port: 0,
    mount: (app) => {
      mountProtocol(app, core);
      mountCn(app, core);
      mountReads(app, core, marketReads(core));
      endStream = mountStream(app, core).close;
    },
    close: async () => {
      endStream?.();
      await core.close();
    },
  });
  client = await seat(srv.url);
});

afterAll(async () => {
  await client?.close();
  await srv?.close();
});

describe("market:mcp", () => {
  it("lists five read tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["market_akshare", "market_book", "market_candles", "market_explore", "market_quotes"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    // the market's words: no connected venue, no "Account" for the market
    for (const t of tools) expect(t.description ?? "").not.toMatch(/the Account|connected venue|venue the owner connected/);
  });

  it("market_explore answers the market's explore", async () => {
    const direct = (await (await fetch(`${srv.url}/api/explore?limit=30`)).json()) as { items: Array<{ key: string }> };
    const r = await client.callTool({ name: "market_explore", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(body(r).items[0].key).toBe(direct.items[0]!.key);
  });

  it("market_candles answers a public source's history", async () => {
    const r = await client.callTool({ name: "market_candles", arguments: { venue: "fake", symbol: "BTC/USDT", interval: "1h", range: "1D" } });
    expect(r.isError).toBeFalsy();
    const b = body(r);
    expect(b).toMatchObject({ ok: true, venue: "fake", symbol: "BTC/USDT", public: true });
    expect((b.candles as unknown[]).length).toBeGreaterThan(0);
  });

  it("market_book carries the book and the latest trades", async () => {
    const r = await client.callTool({ name: "market_book", arguments: { venue: "fake", symbol: "BTC/USDT", depth: 1 } });
    expect(r.isError).toBeFalsy();
    const b = body(r);
    expect(b).toMatchObject({ ok: true, venue: "fake", venueName: "Fake Ex", symbol: "BTC/USDT", public: true, book: { bids: [[61_999, 1]], asks: [[62_001, 1]] } });
    expect(b.trades[0]).toMatchObject({ price: 62_000, size: 0.1, side: "buy" });
    expect(b.tradesRefused).toBeUndefined();
    // a venue that is not public: the refusal's code, not an HTTP number
    const no = await client.callTool({ name: "market_book", arguments: { venue: "my-okx", symbol: "BTC/USDT" } });
    expect(no.isError).toBe(true);
    expect(body(no)).toMatchObject({ ok: false, code: "E_WALLET_ACCOUNT_UNKNOWN" });
  });

  it("market_quotes quotes an A share and passes a refusal on", async () => {
    const r = await client.callTool({ name: "market_quotes", arguments: { pairs: ["china|600519", "fake|BTC/USDT"] } });
    expect(r.isError).toBeFalsy();
    const [share, pub] = body(r).quotes as Array<Record<string, any>>;
    expect(share!.market).toBeDefined();
    expect(share).toMatchObject({ venue: "china", symbol: "600519" });
    expect(pub).toMatchObject({ venue: "fake", symbol: "BTC/USDT" });
    expect(typeof pub!.refusal.code).toBe("string");
    // 1 to 12 markets, each venue|symbol
    const many = await client.callTool({ name: "market_quotes", arguments: { pairs: Array.from({ length: 13 }, () => "china|600519") } });
    expect(many.isError).toBe(true);
    const bare = await client.callTool({ name: "market_quotes", arguments: { pairs: ["600519"] } });
    expect(bare.isError).toBe(true);
  });

  it("market_akshare passes a call through to the sidecar", async () => {
    const r = await client.callTool({ name: "market_akshare", arguments: { tool: "akshare_stock_a", arguments: { method: "stock_zh_a_spot_tx" } } });
    expect(r.isError).toBe(false);
    expect(body(r)).toMatchObject({ row_count: 1, rows: [{ 代码: "600519" }] });
    // a tool's own error is an answer, passed on as one
    const fails = await client.callTool({ name: "market_akshare", arguments: { tool: "akshare_stock_a", arguments: { method: "fails" } } });
    expect(fails.isError).toBe(true);
    expect(body(fails)).toEqual({ error: "upstream refused" });
  });

  it("a market not answering says so in plain words", async () => {
    const down = await seat("http://127.0.0.1:9");
    try {
      for (const [name, args] of [
        ["market_explore", {}],
        ["market_quotes", { pairs: ["china|600519"] }],
        ["market_candles", { venue: "fake", symbol: "BTC/USDT" }],
        ["market_book", { venue: "fake", symbol: "BTC/USDT" }],
        ["market_akshare", { tool: "akshare_discover" }],
      ] as const) {
        const r = await down.callTool({ name, arguments: args });
        expect(r.isError, name).toBe(true);
        expect((r.content as Text[])[0]!.text).toContain("The market service is not answering");
        expect(body(r)).toEqual({ ok: false, error: "The market service is not answering, so prices here are not current." });
      }
    } finally {
      await down.close();
    }
  });
});
