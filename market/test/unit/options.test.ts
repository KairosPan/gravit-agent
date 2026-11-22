import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { atmStrike, defaultExpiry, optionRow, parseDeribitName, parseOkxName, settleMs } from "../../src/live/options.ts";

const fx = (n: string): any => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/options/${n}.json`, import.meta.url)), "utf8"));

describe("parseDeribitName", () => {
  it("parses the inverse and linear forms", () => {
    expect(parseDeribitName("BTC-26MAR27-40000-C")).toEqual({ underlying: "BTC", expiry: "2027-03-26", strike: 40000, right: "C", settle: "coin" });
    expect(parseDeribitName("ETH-1DEC26-3200-P")).toEqual({ underlying: "ETH", expiry: "2026-12-01", strike: 3200, right: "P", settle: "coin" });
    expect(parseDeribitName("SOL_USDC-27NOV26-154-P")).toEqual({ underlying: "SOL", expiry: "2026-11-27", strike: 154, right: "P", settle: "USDC" });
    expect(parseDeribitName("XRP_USDC-27NOV26-2d25-C")?.strike).toBe(2.25);
  });
  it("is null on anything else", () => {
    for (const n of ["BTC-PERPETUAL", "BTC-26MAR27", "BTC-CS-26MAR27-40000-45000", "BTC-31FEB27-40000-C", "BTC-26XXX27-40000-C", "", "BTC-USD-261218-44000-C"]) expect(parseDeribitName(n)).toBeNull();
  });
  it("parses every fixture name, to the strike the name says", () => {
    let n = 0;
    for (const f of ["deribit-btc", "deribit-eth", "deribit-usdc"]) {
      for (const r of fx(f).result) {
        const p = parseDeribitName(r.instrument_name);
        expect(p, r.instrument_name).not.toBeNull();
        const strikeText = r.instrument_name.split("-")[2]!.replace("d", ".");
        expect(p!.strike).toBe(Number(strikeText));
        expect(r.instrument_name.startsWith(p!.underlying)).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(500);
    expect(new Set(fx("deribit-usdc").result.map((r: any) => parseDeribitName(r.instrument_name)!.underlying))).toEqual(new Set(["SOL", "XRP"]));
  });
});

describe("parseOkxName", () => {
  it("parses and rejects", () => {
    expect(parseOkxName("BTC-USD-261218-44000-C")).toEqual({ underlying: "BTC", expiry: "2026-12-18", strike: 44000, right: "C", settle: "coin" });
    for (const n of ["BTC-USD-SWAP", "BTC-USD-261218", "BTC-USD-261318-44000-C", "BTC-26MAR27-40000-C"]) expect(parseOkxName(n)).toBeNull();
  });
  it("parses every fixture name", () => {
    const rows = fx("okx-btc").data;
    expect(rows.length).toBeGreaterThan(100);
    for (const r of rows) {
      const p = parseOkxName(r.instId);
      expect(p, r.instId).not.toBeNull();
      expect(p!.strike).toBe(Number(r.instId.split("-")[3]));
    }
  });
});

describe("defaultExpiry", () => {
  const now = Date.parse("2026-11-22T06:00:00Z");
  it("skips today's and a past expiry, and one with under 24 h left", () => {
    expect(defaultExpiry(["2026-11-20", "2026-11-22", "2026-11-23", "2026-11-24", "2026-12-25"], now)).toBe("2026-11-23");
    expect(defaultExpiry(["2026-11-23", "2026-11-24"], Date.parse("2026-11-22T08:00:00Z"))).toBe("2026-11-23");
    expect(defaultExpiry(["2026-11-23"], Date.parse("2026-11-22T08:00:01Z"))).toBeNull();
    expect(defaultExpiry([], now)).toBeNull();
  });
  it("measures to the venue's settlement time", () => {
    expect(settleMs("2026-11-23", "deribit")).toBe(Date.parse("2026-11-23T08:00:00Z"));
    expect(settleMs("2026-11-23", "nasdaq")).toBe(Date.parse("2026-11-23T21:00:00Z"));
    expect(settleMs("2026-07-17", "nasdaq")).toBe(Date.parse("2026-07-17T20:00:00Z"));
    expect(defaultExpiry(["2026-11-23", "2026-11-24"], Date.parse("2026-11-22T20:00:00Z"), "nasdaq")).toBe("2026-11-23");
    expect(defaultExpiry(["2026-11-23", "2026-11-24"], Date.parse("2026-11-22T22:00:00Z"), "nasdaq")).toBe("2026-11-24");
  });
});

describe("atmStrike", () => {
  it("is the nearest, ties to the lower", () => {
    expect(atmStrike([58000, 60000, 62000], 60487)).toBe(60000);
    expect(atmStrike([62000, 58000, 60000], 61000)).toBe(60000);
    expect(atmStrike([], 1)).toBeNull();
    expect(atmStrike([1], Number.NaN)).toBeNull();
  });
});

describe("optionRow", () => {
  it("is view-only and outside the dollar-volume cut", () => {
    const r = optionRow({ underlying: "BTC", asset: "crypto", price: 59000, changePct: 1.2, nearestExpiry: "2026-11-24", volume: 10, volumeUsd: 5e6, openInterest: 3, atmIv: 45, venues: ["deribit", "okx"], quoteFrom: "Deribit" });
    expect(r).toMatchObject({ key: "opt:BTC", kind: "optionChain", name: "BTC options", category: "crypto", form: "option", asset: "crypto", tabs: [] });
    expect(r.volumeUsd24h).toBeUndefined();
    expect(r.option).toEqual({ nearestExpiry: "2026-11-24", volume: 10, volumeUsd: 5e6, openInterest: 3, atmIv: 45 });
    expect(r.at.map((a) => [a.venue, a.canTrade, a.connected, a.public])).toEqual([["deribit", false, false, true], ["okx", false, false, true]]);
    const u = optionRow({ underlying: "AAPL", asset: "stocks", price: null, nearestExpiry: null, volume: null, openInterest: null, venues: ["nasdaq"], quoteFrom: "", nearestOnly: true });
    expect(u).toMatchObject({ key: "opt:AAPL", category: "stocks", region: "us" });
    expect(u.price).toBeUndefined();
    expect(u.option?.nearestOnly).toBe(true);
  });
});
