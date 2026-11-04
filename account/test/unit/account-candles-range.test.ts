/** ONE MARKET'S PRICE HISTORY AS THE ACCOUNT ASKS IT (service.ts candles, feat/paper-live phase H): at a venue connected to this account
 * alone since account split plan A2 task 7 — a public source's history, its windows and its memory are the market's own reads
 * (market/test/unit/reads.test.ts "a public market's price history: windows and memory"). What stays here: the ask as the service reads it
 * (historyAsk), and a public source named here refused by name before it is asked. A stand-in public source records every window it is
 * asked; nothing leaves the process. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { simKey } from "../../src/portfolio/account/sign.ts";
import type { LiveDeps } from "../../src/portfolio/live/index.ts";
import type { Listing, PublicSource } from "../../../market/src/live/public-markets.ts";
import { INTERVAL_MS, type Candle, type CandleInterval, type CandlePage, type CandleWindow } from "../../src/portfolio/live/trade.ts";
import { historyAsk, PortfolioService } from "../../src/portfolio/service.ts";

const NOW = Date.parse("2026-10-17T07:03:30Z");
const owner = simKey("owner");
const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const refusal = (r: unknown): Refusal => {
  if (!isRefusal(r)) throw new Error(`expected a refusal, got ${JSON.stringify(r).slice(0, 160)}`);
  return r;
};

/** a public source that answers every window with the bars of its interval inside it (the latest `limit`), says older bars exist, names
 * itself, and records what it was asked; `refuse` answers a refusal instead */
function source(o: { refuse?: () => Refusal | undefined; from?: string } = {}) {
  const asked: Array<{ symbol: string; interval: CandleInterval; w: CandleWindow }> = [];
  const btc: Listing = { symbol: "BTC/USD", name: "BTC market", kind: "spot", base: "BTC", quote: "USD", price: 81_500, open: true, types: [] };
  const s: PublicSource = {
    id: "pubx",
    name: "Pubx",
    kind: "exchange",
    connectTo: "pubx",
    connector: "live:exchange:pubx",
    listings: async () => [btc],
    candles: async (symbol, interval, w): Promise<CandlePage | Refusal> => {
      asked.push({ symbol, interval, w });
      const r = o.refuse?.();
      if (r) return r;
      const g = INTERVAL_MS[interval];
      const until = w.until ?? NOW + 1;
      const limit = w.limit ?? 300;
      const since = w.since ?? until - limit * g;
      const bars: Candle[] = [];
      for (let t = Math.floor((until - 1) / g) * g; t >= since && bars.length < limit; t -= g) bars.unshift({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 3 });
      // one bar before the window, which the service must not pass on
      bars.unshift({ t: since - 7 * g, o: 9, h: 9, l: 9, c: 9 });
      return { bars, more: true, source: o.from ?? "Pubx · BTC-USD", folded: interval === "4h" ? "4-hour bars folded from Pubx's hourly bars" : undefined };
    },
  };
  return { s, asked };
}

async function service(src: PublicSource) {
  const home = mkdtempSync(join(tmpdir(), "candles-range-"));
  homes.push(home);
  const liveDeps: Partial<LiveDeps> = { clock: () => NOW, http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined };
  return PortfolioService.create({ home, now: () => new Date(NOW).toISOString(), venues: "frontline", real: true, liveDeps, publicMarkets: [src], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(NOW).toISOString() }] } });
}

describe("the account's price history is a connected venue's", () => {
  it("a public source named here is refused by name, before it is asked; the ask is read as the market reads it", async () => {
    const src = source();
    const svc = await service(src.s);
    expect(refusal(await svc.candles("pubx", "BTC/USD", "", { range: "5D" }))).toMatchObject({ code: "E_WALLET_NOT_CONNECTED", venue: "pubx" });
    expect(refusal(await svc.candles("pubx", "BTC/USD", "2h")).code).toBe("E_WALLET_NOT_CONNECTED");
    expect(src.asked).toEqual([]);
    expect(historyAsk("", { range: "ytd" })).toEqual({ iv: "1d", range: "YTD", limit: 5_000 });
    expect(refusal(historyAsk("2h", {})).message).toBe("price history is by 1m, 5m, 15m, 1h, 4h, 1d, 1w");
    expect(refusal(historyAsk("", { range: "1M", before: "1" })).message).toBe("price history is asked for a range or for the page before a bar, not both");
  });
});
