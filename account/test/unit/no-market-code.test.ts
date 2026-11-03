/** THE ACCOUNT RUNS NO MARKET CODE (plan A1 task 4): account/src names no host only the market reads, spawns no AKShare, holds no iFinD
 * token and imports nothing from the market's tree — and a service made without the market's link reads no public source at all. */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PortfolioService } from "../../src/portfolio/service.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const MARKET_ONLY_HOST = /gtimg\.cn|finance\.qq\.com|eastmoney\.com|51ifind\.com|api\.nasdaq\.com|cdn-api\.cboe\.com|api-futures\.kucoin\.com|api\.bybit\.com|contract\.mexc\.com|fapi\.binance\.com|www\.deribit\.com|api\.gateio\.ws|ws\.kraken\.com|ws\.okx\.com|advanced-trade-ws\.coinbase\.com/;

function sources(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else out.push([relative(SRC, path), readFileSync(path, "utf8")]);
  }
  return out;
}

describe("account/src runs no market code", () => {
  const files = sources(SRC);

  it("account/src names no host only the market reads", () => {
    // account/src is 110 files or so: the walk reached all of it
    expect(files.length).toBeGreaterThan(100);
    for (const [file, text] of files) expect(text, file).not.toMatch(MARKET_ONLY_HOST);
  });

  it("account/src spawns no AKShare and holds no iFinD token", () => {
    for (const [file, text] of files) expect(text, file).not.toMatch(/akshare-mcp|MARKET_AKSHARE_BIN|PORTFOLIO_AKSHARE_BIN|IFIND_(ACCESS|REFRESH)_TOKEN|quantapi/);
  });

  it("account/src imports nothing from the market's tree", () => {
    for (const [file, text] of files) expect(text, file).not.toMatch(/market\/src\//);
  });

  it("a service made without a link reads no public source", async () => {
    const home = mkdtempSync(join(tmpdir(), "no-market-code-"));
    const asked: string[] = [];
    try {
      const svc = await PortfolioService.create({ home, real: true, venues: "frontline", liveDeps: { http: async (url) => (asked.push(url), { status: 599, body: undefined, text: "" }) } });
      await svc.explore({ q: "BTC" });
      await svc.quotes([{ venue: "coinbase", symbol: "BTC/USD" }]);
      expect(asked).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
