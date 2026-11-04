/** The market row (plan A2 Task 4): the project-owned `mcp-market` row that spawns
 * the market's own MCP server (market/src/mcp.ts) - keyless, no card - and the
 * composed standing the face's market half follows. */
import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MARKET_DIR, DEFAULT_MARKET_URL, MARKET_ROW_ID, MARKET_SERVER, MARKET_TOOL_PREFIX,
  composedMarketRow, marketDir, marketRowPatches, marketUrl,
} from "../src/market-row.ts";
import type { SeatEntryLike } from "../src/account-seat.ts";

const entry = (id: string, config: unknown, disabled: boolean | (() => boolean) = false): SeatEntryLike => ({
  options: { id, config },
  get disabled() { return typeof disabled === "function" ? disabled() : disabled; },
});

const inserted = (dir?: string, url?: string): { id: string; name: string; config: unknown } =>
  (marketRowPatches(dir, url)[0] as unknown as { insert: { id: string; name: string; config: unknown }[] }).insert[0];

test("marketRowPatches spawns the market's MCP server from market/ with this node and the install's tsx", () => {
  assert.equal(MARKET_ROW_ID, "mcp-market");
  assert.equal(MARKET_SERVER, "market");
  assert.equal(MARKET_TOOL_PREFIX, "mcp__market__");
  assert.equal(DEFAULT_MARKET_URL, "http://127.0.0.1:4821");
  assert.equal(DEFAULT_MARKET_DIR, resolve(fileURLToPath(new URL("../../market", import.meta.url))));
  const patches = marketRowPatches("/x/market", "http://127.0.0.1:4821");
  assert.equal(patches.length, 1);
  const row = inserted("/x/market", "http://127.0.0.1:4821");
  assert.equal(row.id, MARKET_ROW_ID);
  assert.equal(row.name, "@deepseek-ai/dsh-mcp-client");
  assert.deepEqual(row.config, {
    transport: "stdio",
    serverName: "market",
    command: process.execPath,
    args: [join("/x/market", "node_modules", "tsx", "dist", "cli.mjs"), "src/mcp.ts"],
    cwd: "/x/market",
    env: { MARKET_URL: "http://127.0.0.1:4821" },
    toolCallTimeoutMs: 130_000,
    failOnStartupError: false,
  });
});

test("FACE_MARKET_DIR and FACE_MARKET_URL override the defaults", () => {
  const previousDir = process.env.FACE_MARKET_DIR;
  const previousUrl = process.env.FACE_MARKET_URL;
  try {
    delete process.env.FACE_MARKET_DIR;
    delete process.env.FACE_MARKET_URL;
    assert.equal(marketDir(), DEFAULT_MARKET_DIR);
    assert.equal(marketUrl(), DEFAULT_MARKET_URL);
    process.env.FACE_MARKET_DIR = "/tmp/face-test-market";
    process.env.FACE_MARKET_URL = "http://127.0.0.1:4999";
    assert.equal(marketDir(), "/tmp/face-test-market");
    assert.equal(marketUrl(), "http://127.0.0.1:4999");
    const row = inserted() as { config: { cwd: string; args: string[]; env: Record<string, string> } };
    assert.equal(row.config.cwd, "/tmp/face-test-market");
    assert.equal(row.config.args[0], join("/tmp/face-test-market", "node_modules", "tsx", "dist", "cli.mjs"));
    assert.deepEqual(row.config.env, { MARKET_URL: "http://127.0.0.1:4999" });
  } finally {
    if (previousDir === undefined) delete process.env.FACE_MARKET_DIR;
    else process.env.FACE_MARKET_DIR = previousDir;
    if (previousUrl === undefined) delete process.env.FACE_MARKET_URL;
    else process.env.FACE_MARKET_URL = previousUrl;
  }
});

test("composedMarketRow follows the row as composed: disabled, or its MARKET_URL", () => {
  const row = inserted("/x/market", "http://127.0.0.1:4821");
  assert.deepEqual(composedMarketRow([entry("mcp-account", {}), entry(row.id, row.config)]), { disabled: false, url: DEFAULT_MARKET_URL });
  const patched = { ...(row.config as Record<string, unknown>), env: { MARKET_URL: "http://127.0.0.1:4999/" } };
  assert.deepEqual(composedMarketRow([entry(MARKET_ROW_ID, patched)]), { disabled: false, url: "http://127.0.0.1:4999/" });
  assert.deepEqual(composedMarketRow([entry(MARKET_ROW_ID, row.config, true)]), { disabled: true });
  assert.deepEqual(composedMarketRow([entry(MARKET_ROW_ID, row.config, () => { throw new Error("!!js"); })]), { disabled: true });
  assert.equal(composedMarketRow([entry("mcp-account", {})]), undefined);
  assert.deepEqual(composedMarketRow([entry(MARKET_ROW_ID, { transport: "stdio", env: {} })]), { disabled: false, url: DEFAULT_MARKET_URL }, "an env without MARKET_URL falls back to the default");
});
