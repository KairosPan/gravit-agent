import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeGbk } from "../../src/live/cn-quotes.ts";
import { hkCode, hkGridIndex, parseHkKline, parseHkMinutes, parseHkQuotes, parseHkRank, parseHkSearch } from "../../src/live/hk-parse.ts";

const fxBytes = (n: string): Buffer => readFileSync(new URL(`./../fixtures/regions/${n}`, import.meta.url));
const fx = (n: string): string => fxBytes(n).toString("utf8");

describe("hkCode", () => {
  it("pads digits to five", () => {
    expect(hkCode("700")).toBe("00700");
    expect(hkCode("09988")).toBe("09988");
    expect(hkCode("1")).toBe("00001");
  });
  it("anything else is null", () => {
    for (const bad of ["", "123456", "hk00700", "7 0", "70a", "-1"]) expect(hkCode(bad)).toBeNull();
  });
});

describe("parseHkRank", () => {
  it("the fixture's rows in turnover order", () => {
    const r = parseHkRank(fx("hk-rank.txt"))!;
    expect(r.total).toBe(2041);
    expect(r.rows).toHaveLength(50);
    expect(r.rows[0]).toEqual({ code: "00700", name: "腾讯控股", price: 344, changePct: -1.26, turnover: 14089992865.68 });
    expect(r.rows[1]!.code).toBe("09988");
    expect(r.rows.every((x) => /^\d{5}$/.test(x.code))).toBe(true);
  });
  it("anything else is null", () => {
    expect(parseHkRank("<html>busy</html>")).toBeNull();
    expect(parseHkRank("list_data={}")).toBeNull();
    expect(parseHkRank('list_data={"code":1,"data":{"page_data":[]}}')).toBeNull();
  });
});

describe("parseHkQuotes", () => {
  const quotes = parseHkQuotes(decodeGbk(fxBytes("tencent-quotes.txt")))!;
  it("Tencent's line: name, last, prev close, open, high, low, volume, turnover, time", () => {
    expect(quotes.get("00700")).toEqual({ code: "00700", name: "腾讯控股", price: 344, prevClose: 348.4, open: 341, high: 349.6, low: 339.6,
      volume: 41094469, turnover: 14089992865.68, asOf: "2026-11-20T16:08:37+08:00" });
    expect(quotes.get("09988")!.prevClose).toBe(80.55);
  });
  it("only the r_hk shares; the indices and A shares are absent", () => {
    expect([...quotes.keys()].sort()).toEqual(["00700", "09988"]);
  });
  it("no quote line is null", () => {
    expect(parseHkQuotes("<html>busy</html>")).toBeNull();
    expect(parseHkQuotes("")).toBeNull();
  });
});

describe("parseHkKline", () => {
  it("the daily bars, oldest first, stamped 16:00 Hong Kong", () => {
    const bars = parseHkKline(fx("hk-kline.json"), "00700", "day")!;
    expect(bars).toHaveLength(320);
    expect(bars[0]).toEqual({ t: Date.parse("2025-08-06T16:00:00+08:00"), o: 554.7, c: 563.2, h: 564.7, l: 552.7 });
    expect(bars.at(-1)!.c).toBe(344);
  });
  it("another code or shape is null", () => {
    expect(parseHkKline(fx("hk-kline.json"), "09988", "day")).toBeNull();
    expect(parseHkKline("<html/>", "00700", "day")).toBeNull();
    expect(parseHkKline(fx("hk-kline.json"), "00700", "week")).toBeNull();
  });
});

describe("parseHkMinutes", () => {
  it("one day on the 332-point grid, the amount per minute", () => {
    const [day] = parseHkMinutes(fx("hk-minute.json"), "00700")!;
    expect(parseHkMinutes(fx("hk-minute.json"), "00700")).toHaveLength(1);
    expect(day!.date).toBe("2026-11-20");
    expect(day!.prec).toBe(348.4);
    expect(day!.price).toHaveLength(332);
    expect(day!.price[0]).toBe(341);
    expect(day!.price[331]).toBe(344);
    expect(day!.amount[0]).toBe(636947197.48);
    expect(day!.amount.reduce((a, b) => a + b, 0)).toBeCloseTo(14089992865.68, 0);
  });
  it("the grid: the morning to 12:00, the afternoon from 13:00, the closing print last", () => {
    expect(hkGridIndex("0930")).toBe(0);
    expect(hkGridIndex("1200")).toBe(150);
    expect(hkGridIndex("1300")).toBe(151);
    expect(hkGridIndex("1600")).toBe(331);
    expect(hkGridIndex("1608")).toBe(331);
    expect(hkGridIndex("1230")).toBeNull();
    expect(hkGridIndex("0900")).toBeNull();
  });
  it("another shape is null", () => {
    expect(parseHkMinutes("<html/>", "00700")).toBeNull();
    expect(parseHkMinutes(fx("hk-minute.json"), "09988")).toBeNull();
  });
});

describe("parseHkSearch", () => {
  it("tencent: 00700 first, the RMB counter left out", () => {
    expect(parseHkSearch(fx("hk-search.txt"))).toEqual([{ code: "00700", name: "腾讯控股" }]);
  });
  it("N is no suggestion; anything else is null", () => {
    expect(parseHkSearch('v_hint="N"')).toEqual([]);
    expect(parseHkSearch("<html/>")).toBeNull();
    expect(parseHkSearch('v_hint="hk~00700"')).toBeNull();
  });
});
