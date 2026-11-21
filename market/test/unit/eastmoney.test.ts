import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eastmoney, emKlineUrl, emListUrl, emSecidsUrl, parseEmKline, parseEmList } from "../../src/live/eastmoney.ts";
import { isRefusal } from "../../src/core/errors.ts";
import type { CnHttp, CnReply } from "../../src/live/cn-http.ts";

const fx = (n: string): string => readFileSync(new URL(`../fixtures/regions/${n}`, import.meta.url), "utf8");
const body = (s: string, status = 200): CnReply => ({ status, bytes: new TextEncoder().encode(s) });

afterEach(() => { vi.useRealTimers(); });

describe("parsers", () => {
  it("the HK list's first row", () => {
    const rows = parseEmList(fx("em-hk-list.json"))!;
    expect(rows[0]).toMatchObject({ code: "02800", name: "盈富基金", price: 22.54, changePct: -1.74, turnover: 28914506240, prevClose: 22.94, open: 22.64, high: 22.72, low: 22.42 });
    expect(rows.length).toBeGreaterThan(10);
  });
  it("the index list: 12 rows or more, N225's level and quote time", () => {
    const rows = parseEmList(fx("em-indices.json"))!;
    expect(rows.length).toBeGreaterThanOrEqual(12);
    const n = rows.find((r) => r.code === "N225")!;
    expect(n.price).toBe(56436.65);
    expect(n.volume).toBeNull();
    expect(n.at).toBe(new Date(1795156200 * 1000).toISOString());
  });
  it("a dash is a missing number", () => {
    const rows = parseEmList(JSON.stringify({ data: { diff: [{ f2: "-", f3: "-", f12: "X", f14: "x" }] } }))!;
    expect(rows[0]).toMatchObject({ code: "X", price: null, changePct: null });
  });
  it("anything else is null", () => {
    expect(parseEmList("<html>busy</html>")).toBeNull();
    expect(parseEmList("{}")).toBeNull();
    expect(parseEmKline("<html>busy</html>")).toBeNull();
  });
  it("the kline's bars, oldest first", () => {
    const bars = parseEmKline(fx("em-kline.json"))!;
    const klines = (JSON.parse(fx("em-kline.json")) as { data: { klines: string[] } }).data.klines;
    expect(bars).toHaveLength(klines.length);
    expect(bars[0]).toEqual({ t: Date.parse("2025-07-29T15:00:00+08:00"), o: 40767.77, c: 40674.55, h: 40792.85, l: 40563.53 });
  });
});

describe("urls", () => {
  it("carry the filter, the sort and the right ut", () => {
    expect(emListUrl("m:128+t:3", { fid: "f6", pz: 50 })).toBe("https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f6&fs=m:128+t:3&fields=f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18&ut=bd1d9ddb04089700cf9c27f6f7426281");
    expect(emSecidsUrl(["100.N225", "100.HSI"])).toContain("secids=100.N225,100.HSI&fields=f2,f3,f4,f12,f14,f18,f124");
    expect(emKlineUrl("100.N225", 320)).toContain("push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.N225&klt=101&fqt=1&lmt=320");
  });
});

describe("eastmoney()", () => {
  it("reads a list with the Referer", async () => {
    let seen: Record<string, string> | undefined;
    const em = eastmoney({ http: async (_u, init) => { seen = init.headers; return body(fx("em-indices.json")); } });
    const rows = await em.list(emSecidsUrl(["100.N225"]));
    expect(isRefusal(rows)).toBe(false);
    expect(seen?.referer).toBe("https://quote.eastmoney.com/");
  });
  it("a 403, a 429, a 500 and an unparseable 200 are refusals in the market's words", async () => {
    for (const reply of [body("secret upstream", 403), body("x", 429), body("x", 500), body("<html>busy</html>")]) {
      const r = await eastmoney({ http: async () => reply }).list(emListUrl("m:1", { fid: "f6", pz: 5 }));
      expect(isRefusal(r)).toBe(true);
      expect(JSON.stringify(r)).not.toMatch(/secret|push2delay|busy/);
      expect(JSON.stringify(r)).toContain("Eastmoney");
    }
  });
  it("a 429 pauses the host: the next ask sends nothing and is refused", async () => {
    let n = 0;
    const em = eastmoney({ http: (async () => { n++; return body("x", 429); }) as CnHttp });
    await em.kline(emKlineUrl("100.N225", 5));
    const r = await em.kline(emKlineUrl("100.N225", 5));
    expect(isRefusal(r)).toBe(true);
    expect(n).toBe(1);
  });
  it("a hanging source is asked twice and refused within 9 s", async () => {
    vi.useFakeTimers();
    let n = 0;
    const em = eastmoney({ http: () => { n++; return new Promise<CnReply>(() => {}); } });
    const pending = em.list(emListUrl("m:1", { fid: "f6", pz: 5 }));
    await vi.advanceTimersByTimeAsync(8_999);
    const r = await pending;
    expect(n).toBe(2);
    expect(isRefusal(r)).toBe(true);
  });
  it("a host off the list is refused without a request", async () => {
    let n = 0;
    const r = await eastmoney({ http: async () => { n++; return body("{}"); } }).list("https://evil.example.com/x");
    expect(isRefusal(r)).toBe(true);
    expect(n).toBe(0);
  });
});
