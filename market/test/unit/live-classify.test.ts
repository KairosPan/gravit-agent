import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classOf, NON_US_UNDERLYINGS } from "../../src/live/categories.ts";
import { CASES } from "./classify-cases.ts";

/** What every explore row says of itself (categories.ts classOf): its asset, its form and its region, by the spec's §5.1 table and §5.1.1
 * rules. The account's copy is proved by the same table (account/test/unit/live-categories.test.ts). */

/** trade.xyz's stocks and indices coins, as the fixture keeps them; nothing here reads the network */
const XYZ = JSON.parse(readFileSync(new URL("../fixtures/xyz-equity-categories.json", import.meta.url), "utf8")) as { read: string; coins: Array<[string, string]> };

describe("classOf", () => {
  it.each(CASES)("$name", ({ item, want }) => expect(classOf(item)).toEqual(want));

  it("a non-US underlying named in NON_US_UNDERLYINGS has no region; every other trade.xyz equity or index is us", () => {
    // the judged list: the fixture coins with no US listing (an ADR or a US-listed ETF is US)
    const judged = ["CAMBRICON", "CXMT", "GIGADEV", "HYUNDAI", "IBIDEN", "JIO", "KIOXIA", "MINIMAX", "RELIANCE", "SHEIN", "SKHX", "SKHY", "SMSN", "SOFTBANK", "UNITREE", "ZHIPU", "JP225", "KR200", "NIFTY"];
    expect([...NON_US_UNDERLYINGS].sort()).toEqual([...judged].sort());
    expect(XYZ.read).toBe("2026-11-19");
    expect(XYZ.coins).toHaveLength(112);
    const bases = XYZ.coins.map(([coin]) => coin.slice(coin.indexOf(":") + 1).toUpperCase());
    // every judged name is one of the read's coins, so the list names nothing the read did not
    expect(judged.filter((b) => !bases.includes(b))).toEqual([]);
    for (const [coin, category] of XYZ.coins) {
      const base = coin.slice(coin.indexOf(":") + 1).toUpperCase();
      const got = classOf({ key: `perp:${coin}`, kind: "perp", base: coin, category });
      expect([coin, got.asset, got.region], coin).toEqual([coin, category, judged.includes(base) ? undefined : "us"]);
    }
  });
});
