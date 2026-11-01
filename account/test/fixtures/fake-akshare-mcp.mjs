// A stand-in for akshare-mcp in the Account's tests: plain Node over the Account's own MCP SDK, no Python, no network. Two of the real
// server's tools, with methods that answer, fail, hang, exit and flood, so src/portfolio/live/akshare.ts can be driven through each edge.
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

if (process.env.FAKE_AKSHARE_START_LOG) appendFileSync(process.env.FAKE_AKSHARE_START_LOG, `${process.pid}\n`);

const server = new McpServer({ name: "akshare MCP Server", version: "0.0.0-fake" }, { instructions: "A stand-in for akshare-mcp: akshare_discover, then a category tool by method." });
const text = (t) => ({ content: [{ type: "text", text: t }] });

server.registerTool("akshare_discover", { description: "the index of methods", inputSchema: { query: z.string().optional() } }, async ({ query }) =>
  text(JSON.stringify({ query, pid: process.pid, env: Object.keys(process.env).sort(), maxRows: process.env.AKSHARE_MCP_MAX_ROWS })),
);

server.registerTool(
  "akshare_stock_a",
  { description: "A-share methods", inputSchema: { method: z.string(), params_json: z.string().optional(), symbol: z.string().optional() } },
  async ({ method }) => {
    switch (method) {
      case "stock_zh_a_spot_tx":
        return text(JSON.stringify({ rows: [{ 代码: "600519", 名称: "贵州茅台" }], row_count: 1, truncated: false }));
      case "fails":
        return { isError: true, content: [{ type: "text", text: "{\"error\":\"upstream refused\"}" }] };
      case "sleep":
        await new Promise((r) => setTimeout(r, 10_000));
        return text("late");
      case "exit":
        process.exit(3);
      case "flood":
        return text("x".repeat(5 * 1024 * 1024));
      default:
        return { isError: true, content: [{ type: "text", text: `unknown method ${method}` }] };
    }
  },
);

await server.connect(new StdioServerTransport());
