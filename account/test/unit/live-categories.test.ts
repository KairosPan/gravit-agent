import { describe, expect, it } from "vitest";
import { categoryOf, isExcludedCategory, isIpoCategory, KALSHI_SERIES, perpCategoryTab, roleOfCategory, TABS, type TabId } from "../../src/portfolio/live/categories.ts";

/** The Markets screen's tabs, the table of venues' category words, and the Kalshi series the public read is made of. */

describe("the tabs", () => {
  it("keep All first and add the explicit underlying categories before the other instrument tabs", () => {
    expect(TABS).toEqual([
      { id: "all", label: "All" },
      { id: "crypto", label: "Crypto" },
      { id: "stocks", label: "Stocks" },
      { id: "indices", label: "Indices" },
      { id: "commodities", label: "Commodities" },
      { id: "fx", label: "FX" },
      { id: "rwas", label: "RWAs" },
      { id: "perps", label: "Perps" },
      { id: "preipo", label: "Pre-IPO" },
      { id: "predictions", label: "Predictions" },
      { id: "china", label: "China" },
    ]);
    const ids: TabId[] = TABS.map((t) => t.id);
    expect(ids).not.toContain("now");
    expect(ids).not.toContain("venues");
  });
  it("normalizes only explicit underlying categories, without treating unknown perpetuals as crypto", () => {
    expect(["CRYPTO", " Stocks ", "indices", "commodities", "FX", "preipo", "Pre-IPO"].map(perpCategoryTab)).toEqual(["crypto", "stocks", "indices", "commodities", "fx", "preipo", "preipo"]);
    expect([undefined, "", "unknown", "NVDA", "IPO"].map(perpCategoryTab)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("the category words", () => {
  it("show IPO (Polymarket's tag) and IPOs (Kalshi's) before the broader Finance, Financials or Companies an IPO question also carries", () => {
    expect(roleOfCategory("IPO")).toBe("shown");
    expect(roleOfCategory("ipos")).toBe("shown");
    // Gamma's "Anthropic IPO by __?" carries Finance, IPO, Anthropic IPO, Anthropic, IPOs, Dario and a rewards tag
    expect(categoryOf(["Finance", "IPO", "Anthropic IPO", "Anthropic", "IPOs", "Dario", "rewards 100, 4.5, 100 Deprec"])).toBe("IPO");
    // Kalshi's KXIPOANTHROPIC event is filed under Companies, its series under IPOs and Companies
    expect(categoryOf(["Companies", "IPOs"])).toBe("IPOs");
    expect(categoryOf(["Economics", "IPOs", "Companies"])).toBe("IPOs");
    // the rates words still come first
    expect(categoryOf(["IPO", "Fed Rates"])).toBe("Fed Rates");
    expect(isIpoCategory(["IPO"])).toBe(true);
    expect(isIpoCategory(["Companies", "IPOs"])).toBe(true);
    expect(isIpoCategory(["Finance", undefined, "Anthropic IPO"])).toBe(false);
    expect(isIpoCategory(["Economics"])).toBe(false);
    expect(isExcludedCategory(["IPO"])).toBe(false);
  });
});

describe("the Kalshi series", () => {
  it("are the ten finance series and the two IPO series, the IPO ones carrying Kalshi's own series tags", () => {
    expect(KALSHI_SERIES.map((s) => s.ticker)).toEqual(["KXFEDDECISION", "KXCPI", "KXCPIYOY", "KXGDP", "KXPAYROLLS", "KXBTCD", "KXINX", "KXNASDAQ100", "KXPRESNOMD", "KXTRUMPAPPROVE", "KXIPOANTHROPIC", "KXIPOOPENAI"]);
    expect(KALSHI_SERIES.filter((s) => s.tags).map((s) => [s.ticker, s.word, s.tags])).toEqual([
      ["KXIPOANTHROPIC", "Anthropic IPO", ["IPOs", "Companies"]],
      ["KXIPOOPENAI", "OpenAI IPO", ["IPOs", "Companies"]],
    ]);
    // a series ticker is the series root: KXIPOANTHROPIC-DATE (the event) answers nothing
    expect(KALSHI_SERIES.every((s) => !s.ticker.includes("-"))).toBe(true);
  });
});
