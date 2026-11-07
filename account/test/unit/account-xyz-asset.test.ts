import { describe, expect, it } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

describe("a trade.xyz contract's asset sheet", () => {
  it("keeps its positions and old unqualified orders apart from other xyz contracts and the underlying stock", async () => {
    // The service's read inputs, without opening an account or writing any order. Exercise the actual asset read's matching.
    const positions = [
      { venue: "hl", symbol: "XYZ-NVDA/USDC:USDC", kind: "perp", qty: 1 },
      { venue: "hl", symbol: "XYZ-GOLD/USDC:USDC", kind: "perp", qty: 2 },
      { venue: "broker", symbol: "NVDA", kind: "stock", qty: 3 },
    ];
    const orders = [
      { id: "nvda-old", symbol: "XYZ-NVDA/USDC:USDC", base: "NVDA", kind: "perp", status: "open" },
      { id: "nvda-new", symbol: "XYZ-NVDA/USDC:USDC", base: "xyz:NVDA", kind: "perp", status: "open" },
      { id: "gold", symbol: "XYZ-GOLD/USDC:USDC", base: "xyz:GOLD", kind: "perp", status: "open" },
      { id: "stock", symbol: "NVDA", base: "NVDA", kind: "stock", status: "open" },
    ];
    const svc = Object.assign(Object.create(PortfolioService.prototype), {
      held: async () => ({ view: { rows: [], positions, cost: [] }, page: { orders, venues: [] } }),
      liveCompare: async (base: string) => ({ base, side: "buy", rows: [], missing: [] }),
      statementRows: () => ({ before: [], now: [] }),
      statement: () => [],
    }) as PortfolioService;
    const result = await svc.asset("crypto:XYZ:NVDA");
    if (isRefusal(result)) throw new Error(result.message);
    expect(result.key).toBe("crypto:XYZ:NVDA");
    expect(result.positions.map((p) => p.symbol)).toEqual(["XYZ-NVDA/USDC:USDC"]);
    expect(result.orders.map((o) => o.id)).toEqual(["nvda-old", "nvda-new"]);
    expect(result.compare?.base).toBe("XYZ:NVDA");
  });
});
