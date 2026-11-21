import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { krCode, parseKrChart, parseKrQuotes, parseKrRank, parseKrSearch, krSearchUrl } from "../../src/live/kr-parse.ts";

const fx = (n: string): string => readFileSync(new URL(`../fixtures/regions/${n}`, import.meta.url), "utf8");

describe("krCode", () => {
  it("keeps six digits or letters as they are (letters upper-cased) and refuses the rest", () => {
    expect(krCode("005930")).toBe("005930");
    expect(krCode("005935")).toBe("005935");
    expect(krCode("0126Z0")).toBe("0126Z0");
    expect(krCode("0126z0")).toBe("0126Z0");
    expect(krCode("5930")).toBeNull();
    expect(krCode("ABC")).toBeNull();
    expect(krCode("0059300")).toBeNull();
    expect(krCode("samsung")).toBeNull();
  });
});

describe("parseKrRank", () => {
  it("reads the shares of a marketValue page, exchange-traded products left out", () => {
    const r = parseKrRank(fx("naver-kospi-value.json"))!;
    expect(r.total).toBe(2496);
    expect(r.rows).toHaveLength(90); // 90 shares, one of them coded 0126Z0
    expect(r.rows.some((x) => x.code === "0126Z0")).toBe(true);
    expect(r.rows[0]).toEqual({ code: "005930", name: "삼성전자", price: 180900, changePct: -8.13, turnover: 3267336000000,
      at: "2026-11-20T20:20:21+09:00", delayMin: 0 });
    expect(r.rows.every((x) => /^[0-9A-Z]{6}$/.test(x.code))).toBe(true);
  });
  it("answers null for a body that is not a page", () => {
    expect(parseKrRank("<html>busy</html>")).toBeNull();
    expect(parseKrRank('{"stocks":"no"}')).toBeNull();
    expect(parseKrRank('{"stocks":[],"totalCount":0}')).toEqual({ total: 0, rows: [] });
  });
});

describe("parseKrQuotes", () => {
  it("reads both shares, the raw numbers first", () => {
    const q = parseKrQuotes(fx("naver-kr-quotes.json"))!;
    expect([...q.keys()]).toEqual(["005930", "000660"]);
    expect(q.get("005930")).toEqual({ code: "005930", name: "삼성전자", price: 180900, prevClose: 196900, changePct: -8.13, open: 188100, high: 189300,
      low: 180100, volume: 17706899, turnover: 3267336000000, asOf: "2026-11-20T20:00:00+09:00", delayMin: 0 });
  });
  it("answers null for another body", () => {
    expect(parseKrQuotes("nope")).toBeNull();
  });
});

describe("parseKrChart", () => {
  it("reads the day candles oldest first, each stamped 15:30 Seoul", () => {
    const bars = parseKrChart(fx("naver-kr-chart.json"), "005930")!;
    expect(bars).toHaveLength(110);
    expect(bars[0]).toEqual({ t: Date.parse("2026-06-12T15:30:00+09:00"), o: 326000, h: 339000, l: 320000, c: 322500 });
    expect(bars.at(-1)!.c).toBe(180900);
    expect(parseKrChart(fx("naver-kr-chart.json"), "000660")).toBeNull();
    expect(parseKrChart("[]", "005930")).toBeNull();
  });
});

describe("parseKrSearch", () => {
  it("keeps Korean listings of six digits or letters only", () => {
    const reply = JSON.stringify({ query: "x", items: [
      { code: "02812", name: "Samsung ETF", nationCode: "HKG" },
      { code: "005930", name: "삼성전자", nationCode: "KOR" },
      { code: "005930", name: "삼성전자", nationCode: "KOR" },
      { code: "0126Z0", name: "알파", nationCode: "KOR" },
      { code: "ABC", name: "odd", nationCode: "KOR" },
    ] });
    expect(parseKrSearch(reply)).toEqual([{ code: "005930", name: "삼성전자" }, { code: "0126Z0", name: "알파" }]);
    expect(parseKrSearch(fx("naver-search.json"))).toEqual([]);
    expect(parseKrSearch("nope")).toBeNull();
    expect(krSearchUrl("a b")).toBe("https://ac.stock.naver.com/ac?q=a+b&target=stock");
  });
});
