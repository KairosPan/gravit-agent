import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIS_BATCH, parseDayAll, parseMis, parseStockDay, twCode, twMisUrl, twStockDayUrl, TW_UNIVERSE } from "../../src/live/tw-parse.ts";

const fx = (n: string): string => readFileSync(new URL(`../fixtures/regions/${n}`, import.meta.url), "utf8");

describe("twCode", () => {
  it("accepts four to six digits or letters and upper-cases", () => {
    expect(twCode("2330")).toBe("2330");
    expect(twCode("2881a")).toBe("2881A");
    expect(twCode(" 00400A ")).toBe("00400A");
    expect(["233", "2330123", "23-30", "", "台積電"].map(twCode)).toEqual([null, null, null, null, null]);
  });
});

describe("parseDayAll", () => {
  it("reads the table, its ROC date and its figures", () => {
    const t = parseDayAll(fx("twse-day-all.json"))!;
    expect(t.date).toBe("2026-11-20");
    expect(t.rows.find((r) => r.code === "2330")).toEqual({ code: "2330", name: "台積電", tradeValue: 177284650683, close: 2000, change: -100 });
    expect(t.rows.find((r) => r.code === "00625K")).toMatchObject({ close: null, tradeValue: null });
  });
  it("is null for a body that is not a table", () => {
    for (const body of ["<html>busy</html>", "{}", "[]", '[{"Date":"1151120"}]']) expect(parseDayAll(body)).toBeNull();
  });
});

describe("parseMis", () => {
  it("reads the quotes and leaves the index line out; z of a dash is no price", () => {
    const m = parseMis(fx("twse-mis.json"))!;
    expect([...m.keys()]).toEqual(["2330", "2317"]);
    expect(m.get("2330")).toEqual({ code: "2330", name: "台積電", price: 2000, prevClose: 2100, open: 2035, high: 2060, low: 1970, lots: 75207,
      asOf: new Date(1795156200000).toISOString(), date: "2026-11-20" });
    const body = JSON.parse(fx("twse-mis.json"));
    body.msgArray[1].z = "-";
    expect(parseMis(JSON.stringify(body))!.get("2330")).toMatchObject({ price: null, prevClose: 2100 });
  });
  it("is null unless rtcode is 0000 with an array", () => {
    const body = JSON.parse(fx("twse-mis.json"));
    expect(parseMis(JSON.stringify({ ...body, rtcode: "5000" }))).toBeNull();
    expect(parseMis(JSON.stringify({ rtcode: "0000" }))).toBeNull();
    expect(parseMis("nope")).toBeNull();
  });
});

describe("parseStockDay", () => {
  it("reads the month's bars, 13:30 Taipei, commas dropped", () => {
    const bars = parseStockDay(fx("twse-stock-day.json"))!;
    expect(bars).toHaveLength(15);
    expect(bars[0]).toEqual({ t: Date.parse("2026-11-02T13:30:00+08:00"), o: 2310, h: 2345, l: 2310, c: 2330 });
  });
  it("a month with no data is empty; anything else is null", () => {
    expect(parseStockDay('{"stat":"很抱歉，沒有符合條件的資料!"}')).toEqual([]);
    expect(parseStockDay('{"stat":"error"}')).toBeNull();
    expect(parseStockDay("<html>")).toBeNull();
  });
});

describe("urls and figures", () => {
  it("builds MIS and month asks", () => {
    expect(TW_UNIVERSE).toBe(200);
    expect(MIS_BATCH).toBe(50);
    expect(twMisUrl(["2330", "2317"])).toBe("https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw|tse_2317.tw&json=1&delay=0");
    expect(twStockDayUrl("2330", "202611")).toBe("https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20261101&stockNo=2330");
  });
});
