/** market:mcp (src/mcp.ts): the market's own stdio MCP server, gravit's market reads — spawned as the face's mcp-market row would spawn
 * it, over an in-process market holding a fake public source, a fake China, the fake AKShare sidecar and a 问财 client over a fake picker. */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createAkshare } from "../../src/live/akshare.ts";
import type { CnIfind, IfindPicker } from "../../src/live/cn-ifind.ts";
import type { CnRelay } from "../../src/live/cn-relay.ts";
import { createWencai } from "../../src/live/cn-wencai.ts";
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

// the 2026-11-19 shape of a smart_stock_picking reply: one table, one array per column
const COL = "区间涨跌幅:前复权[20260928-20261118]";
const SHAPE = { errorcode: 0, tables: [{ table: { "股票代码": ["002242.SZ", "301313.SZ"], "股票简称": ["九阳股份", "x"], [COL]: [202.13, 112.8] } }] };
/** what the fake picker was asked: a question refused by the tool's own schema never reaches it */
const picked: Array<{ searchstring: string; searchtype: string }> = [];
const picker: IfindPicker = {
  async pick(searchstring, searchtype) {
    picked.push({ searchstring, searchtype });
    return { answer: { kind: "upstream", status: 200, contentType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(SHAPE)) }, asked: 1 };
  },
};
const relay: CnRelay = async () => ({ kind: "refused", word: "unreachable" });
const ifind: CnIfind = { configured: () => true, ask: async () => ({ kind: "refused", word: "unreachable" }) };

let srv: MarketServerHandle;
let client: Client;

beforeAll(async () => {
  const core = createMarketCore({
    sources: [fakeSource()],
    china: fakeChina(),
    akshare: createAkshare({ command: process.execPath, args: [FIXTURE] }),
    cn: { relay, ifind, wencai: createWencai({ picker, configured: () => true, perDay: 2 }) },
  });
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
  it("lists six read tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["market_akshare", "market_book", "market_candles", "market_explore", "market_quotes", "market_wencai"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    // the market's words: no connected venue, no "Account" for the market
    for (const t of tools) expect(t.description ?? "").not.toMatch(/the Account|connected venue|venue the owner connected/);
  });

  it("market_explore answers the market's explore", async () => {
    const direct = (await (await fetch(`${srv.url}/api/explore?limit=30`)).json()) as { items: Array<{ key: string }> };
    const r = await client.callTool({ name: "market_explore", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(body(r).items[0].key).toBe(direct.items[0]!.key);
    const scoped = await client.callTool({ name: "market_explore", arguments: { scope: "xyz" } });
    expect(scoped.isError).toBeFalsy();
    expect(body(scoped).items).toEqual([]); // the fake source is outside xyz; scope reached the HTTP reader
    const more = await client.callTool({ name: "market_explore", arguments: { scope: "more" } });
    expect(body(more).items[0].key).toBe(direct.items[0]!.key);
    for (const tab of ["indices", "commodities", "fx"]) {
      const categorized = await client.callTool({ name: "market_explore", arguments: { scope: "xyz", tab } });
      expect(categorized.isError).toBeFalsy();
      expect(body(categorized).items).toEqual([]);
    }
  });

  it("market_explore accepts and forwards an exact public source, including the reader's validation", async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "market_explore")!.inputSchema.properties!.source).toMatchObject({ type: "string", maxLength: 400 });
    const selected = await client.callTool({ name: "market_explore", arguments: { scope: "more", source: "fake" } });
    expect(selected.isError).toBeFalsy();
    expect(body(selected).items.length).toBeGreaterThan(0);
    expect(body(selected).items.every((row: { at: Array<{ venue: string }> }) => row.at.every((at) => at.venue === "fake"))).toBe(true);
    for (const args of [{ source: "unknown" }, { scope: "xyz", source: "fake" }, { source: "fake", tab: "china" }]) {
      const refused = await client.callTool({ name: "market_explore", arguments: args });
      expect(refused.isError).toBe(true);
      expect(body(refused).code).toBe("E_MARKET_BAD_REQUEST");
    }
    const long = await client.callTool({ name: "market_explore", arguments: { source: "x".repeat(401) } });
    expect(long.isError).toBe(true);
  });

  it("market_explore forwards asset, form, region and a source list", async () => {
    const seen: string[] = [];
    const stand = createServer((req, res) => {
      seen.push(req.url ?? "");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, items: [] }));
    });
    await new Promise<void>((r) => stand.listen(0, "127.0.0.1", r));
    const c = await seat(`http://127.0.0.1:${(stand.address() as AddressInfo).port}`);
    try {
      const r = await c.callTool({ name: "market_explore", arguments: { asset: "indices", form: "perp", region: "us", source: "trade-xyz,kalshi" } });
      expect(r.isError).toBeFalsy();
      expect(seen).toEqual(["/api/explore?asset=indices&form=perp&region=us&source=trade-xyz%2Ckalshi&limit=30"]);
    } finally {
      await c.close();
      await new Promise((r) => stand.close(r));
    }
  });

  it("market_explore passes a mixing refusal through as the market's words", async () => {
    const stand = createServer((_req, res) => {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: "asset cannot be mixed with tab" }));
    });
    await new Promise<void>((r) => stand.listen(0, "127.0.0.1", r));
    const c = await seat(`http://127.0.0.1:${(stand.address() as AddressInfo).port}`);
    try {
      const r = await c.callTool({ name: "market_explore", arguments: { asset: "stocks", tab: "crypto" } });
      expect(r.isError).toBe(true);
      expect(body(r)).toEqual({ ok: false, error: "asset cannot be mixed with tab" });
    } finally {
      await c.close();
      await new Promise((r) => stand.close(r));
    }
  });

  it("market_explore's description says a full class names its sources, and a source list is not mixed with scope or tab", async () => {
    const { tools } = await client.listTools();
    const d = tools.find((t) => t.name === "market_explore")!.description ?? "";
    expect(d).toMatch(/a whole class needs its source\(s\) named \(`asset=fx&source=trade-xyz`\)/);
    expect(d).toMatch(/`scope` and `tab` are not mixed with `asset`, `form`, `region` or a source list/);
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
    expect(body(no)).toMatchObject({ ok: false, code: "E_MARKET_UNKNOWN_SOURCE" });
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

  it("market_wencai says what 问财 is for, and takes stock or fund, a question of 1 to 300 characters and a limit of 1 to 200", async () => {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === "market_wencai")!;
    const d = t.description ?? "";
    for (const word of ["`stock`", "`fund`", "market_akshare", "今日", "从大到小排名前50", "truncated", "credential"]) expect(d).toContain(word);
    expect(d).toMatch(/never evidence of a trade/);
    expect(t.inputSchema.required).toEqual(["question"]);
    expect(t.inputSchema.properties).toMatchObject({
      question: { type: "string", minLength: 1, maxLength: 300 },
      type: { enum: ["stock", "fund"] },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    });
  });

  it("market_wencai answers a question as columns and rows, and spends one of the budget", async () => {
    const r = await client.callTool({ name: "market_wencai", arguments: { question: "2026年9月28日至2026年11月18日区间涨跌幅从大到小排名前50" } });
    expect(r.isError).toBeFalsy();
    const b = body(r);
    expect(b).toMatchObject({ ok: true, type: "stock", columns: ["股票代码", "股票简称", COL], rows: [["002242.SZ", "九阳股份", 202.13], ["301313.SZ", "x", 112.8]], rowCount: 2, returned: 2, truncated: false });
    expect(b.budget).toMatchObject({ used: 1, cap: 2 });
    expect(picked).toEqual([{ searchstring: "2026年9月28日至2026年11月18日区间涨跌幅从大到小排名前50", searchtype: "stock" }]);
    // limit reaches the route
    const one = await client.callTool({ name: "market_wencai", arguments: { question: "规模大于100亿的股票型基金", type: "fund", limit: 1 } });
    expect(body(one)).toMatchObject({ ok: true, type: "fund", returned: 1, rowCount: 2, truncated: true, budget: { used: 2 } });
  });

  it("market_wencai refuses another type, a long question and a bad limit by its schema, before the market is asked", async () => {
    const before = picked.length;
    for (const args of [{ question: "腾讯控股", type: "hkstock" }, { question: "x".repeat(301) }, { question: "" }, { question: "q", limit: 0 }, { question: "q", limit: 201 }, { question: "q", limit: 1.5 }]) {
      const r = await client.callTool({ name: "market_wencai", arguments: args });
      expect(r.isError, JSON.stringify(args).slice(0, 60)).toBe(true);
      expect((r.content as Text[])[0]!.text).toMatch(/Input validation error/);
    }
    expect(picked.length).toBe(before);
  });

  it("market_wencai answers a kept question free, and passes the budget's refusal on with its word", async () => {
    const again = await client.callTool({ name: "market_wencai", arguments: { question: "2026年9月28日至2026年11月18日区间涨跌幅从大到小排名前50" } });
    expect(again.isError).toBeFalsy();
    expect(body(again).budget.used).toBe(2);
    const n = picked.length;
    const r = await client.callTool({ name: "market_wencai", arguments: { question: "第三个问题" } });
    expect(r.isError).toBe(true);
    const b = body(r);
    expect(b).toMatchObject({ ok: false, wencai: "budget" });
    expect(b.message).toMatch(/2 of 2 问财 calls spent/);
    expect(picked.length).toBe(n);
  });

  it("market_wencai over a market without the route says to restart it", async () => {
    const bare = createMarketCore({});
    const old = await startMarketServer({ port: 0, mount: () => {}, close: () => bare.close() });
    const c = await seat(old.url);
    try {
      const r = await c.callTool({ name: "market_wencai", arguments: { question: "q" } });
      expect(r.isError).toBe(true);
      expect(body(r)).toEqual({ ok: false, error: "this market has no 问财 route (/api/cn/wencai): restart it from this tree" });
    } finally {
      await c.close();
      await old.close();
    }
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
        ["market_wencai", { question: "q" }],
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
