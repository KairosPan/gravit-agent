import { describe, expect, it } from "vitest";
import { decodeSmartbox, parseTencentSearch, searchUrl } from "../../src/live/cn-search.ts";

const TENCENT = 'v_hint="sh~603986~\\u5146\\u6613\\u521b\\u65b0~zycx~GP-A";';

describe("cn-search", () => {
  it("Tencent decodes Chinese suggestions, retains stable ids and excludes non-A listings", () => {
    const parsed = parseTencentSearch(TENCENT);
    expect(parsed.hits).toEqual([{ symbol: "603986", name: "兆易创新", exchange: "SH" }]);
    expect(parsed.truncated).toBe(false);
    const mixed = 'v_hint="hk~03986~GigaDevice~zycx~GP^sh~900901~B share~b~GP-B^sh~603986~兆易创新~zycx~GP-A^sh~603986~兆易创新~zycx~GP-A^bj~920185~贝特瑞~btr~GP-A";';
    expect(parseTencentSearch(mixed).hits.map((h) => h.symbol)).toEqual(["603986", "920185"]);
    expect(parseTencentSearch('v_hint="";').hits).toEqual([]);
    expect(parseTencentSearch('v_hint="N";').hits).toEqual([]);
    expect(() => parseTencentSearch('v_hint="unexpected shape";')).toThrow();
    expect(() => parseTencentSearch('v_hint=""; globalThis.compromised=true;')).toThrow();
    expect(() => parseTencentSearch("<html>temporarily unavailable</html>")).toThrow();
  });

  it("STAR Market listings (GP-A-KCB), its CDRs among them, are A shares; an index, a fund and a B share are not", () => {
    const star = 'v_hint="sh~688981~中芯国际~zxgj~GP-A-KCB^hk~00981~中芯国际~zxgj~GP^sh~689009~九号公司WD~jhgswd~GP-A-KCB^sh~000688~科创50~kc50~ZS^sh~588000~科创50ETF华夏~kc50etfhx~ETF^sh~506000~科创板基金~kcbjj~LOF^sh~900901~云赛B股~ysbg~GP-B";';
    expect(parseTencentSearch(star).hits.map((h) => h.symbol)).toEqual(["688981", "689009"]);
    expect(parseTencentSearch(star).hits[0]!.exchange).toBe("SH");
  });

  it("suggestion limits are disclosed even when excluded markets reduce visible results", () => {
    const rows = Array.from({ length: 10 }, (_, index) => `hk~${index}~HK~hk~GP`).join("^");
    expect(parseTencentSearch(`v_hint=${JSON.stringify(rows)};`).truncated).toBe(true);
  });

  it("smartbox bytes decode as GB18030", () => {
    // 兆易 in GB18030
    expect(decodeSmartbox(new Uint8Array([0xd5, 0xd7, 0xd2, 0xd7]))).toBe("兆易");
  });

  it("the URLs name their hosts and encode the query", () => {
    expect(searchUrl("茅台")).toBe("https://smartbox.gtimg.cn/s3/?q=%E8%8C%85%E5%8F%B0&t=all");
  });
});
