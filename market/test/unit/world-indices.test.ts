import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { CnHttp, CnReply } from "../../src/live/cn-http.ts";
import { eastmoney } from "../../src/live/eastmoney.ts";
import { SESSIONS } from "../../src/live/local-session.ts";
import { WORLD_INDICES, worldIndices } from "../../src/live/world-indices.ts";

const fx = (n: string): Buffer => readFileSync(new URL(`../fixtures/regions/${n}`, import.meta.url));
const reply = (b: Uint8Array | string, status = 200): CnReply => ({ status, bytes: typeof b === "string" ? new TextEncoder().encode(b) : b });
const answered = <T,>(v: T | Refusal): T => { if (isRefusal(v)) throw new Error(`refused: ${v.message}`); return v; };

type Route = [string, CnReply | ((url: string) => CnReply)];
function net(routes: Route[]) {
  const sent: string[] = [];
  const http: CnHttp = async (url) => {
    sent.push(url);
    const hit = routes.find(([k]) => url.includes(k));
    if (!hit) return { status: 404, bytes: new Uint8Array() };
    return typeof hit[1] === "function" ? hit[1](url) : hit[1];
  };
  return { http, sent };
}
const ROUTES: Route[] = [
  ["worldstock/index", reply(fx("naver-world.json"))], ["domestic/index", reply(fx("naver-domestic-index.json"))],
  ["ulist.np", reply(fx("em-indices.json"))], ["qt.gtimg.cn", reply(fx("tencent-quotes.txt"))], ["getStockInfo", reply(fx("twse-mis.json"))],
  ["push2his", reply(fx("em-kline.json"))], ["hkfqkline/get", reply(fx("hk-index-kline.json"))], ["fqkline/get", reply(fx("cn-index-kline.json"))],
];
/** Saturday 2026-11-21: every market closed */
const SAT = Date.parse("2026-11-21T12:00:00Z");
const keysOf = (r: { items: Array<{ key: string }> }): string[] => r.items.map((i) => i.key);

afterEach(() => { vi.useRealTimers(); });

describe("the list", () => {
  it("every index's hours is a key of SESSIONS or cn, and ids are unique per region", () => {
    for (const i of WORLD_INDICES) expect(i.hours === "cn" || Object.hasOwn(SESSIONS, i.hours)).toBe(true);
    expect(new Set(WORLD_INDICES.map((i) => `${i.region}:${i.id}`)).size).toBe(WORLD_INDICES.length);
  });
});

describe("levels", () => {
  it("eu: four rows in list order, from Naver with its declared delay", async () => {
    const n = net(ROUTES);
    const r = answered(await worldIndices({ http: n.http, clock: () => SAT }).levels("eu"));
    expect(keysOf(r)).toEqual(["ix:eu:sx5e", "ix:eu:dax", "ix:eu:ftse", "ix:eu:cac"]);
    expect(r.items.every((i) => i.quoteFrom === "Naver · 15 min delayed" && i.price !== undefined)).toBe(true);
    expect(r.read).toMatchObject({ venue: "ix", region: "eu", sort: "volume", total: 4 });
    expect(n.sent.filter((u) => u.includes("worldstock"))).toHaveLength(1);
  });

  it.each([["a 500", reply("", 500)], ["an unparseable 200", reply("<html>busy</html>")]])("eu: Naver %s gives the same four from Eastmoney", async (_n, bad) => {
    const n = net([["worldstock/index", bad], ...ROUTES]);
    const r = answered(await worldIndices({ http: n.http, clock: () => SAT }).levels("eu"));
    expect(keysOf(r)).toEqual(["ix:eu:sx5e", "ix:eu:dax", "ix:eu:ftse", "ix:eu:cac"]);
    expect(r.items.every((i) => i.quoteFrom === "Eastmoney")).toBe(true);
    expect(n.sent.filter((u) => u.includes("ulist.np"))).toHaveLength(1);
  });

  it("an empty reply is a failure for the indices it should have carried", async () => {
    const n = net([["worldstock/index", reply(JSON.stringify({ datas: [] }))], ...ROUTES]);
    const r = answered(await worldIndices({ http: n.http, clock: () => SAT }).levels("jp"));
    expect(r.items[0]!.quoteFrom).toBe("Eastmoney");
  });

  it("us: Naver down leaves the Composite out (no other source) with a note, the others from Eastmoney", async () => {
    const n = net([["worldstock/index", reply("", 500)], ...ROUTES]);
    const r = answered(await worldIndices({ http: n.http, clock: () => SAT }).levels("us"));
    expect(keysOf(r)).toEqual(["ix:us:spx", "ix:us:dji"]);
    expect(r.read.note).toContain("Nasdaq Composite");
  });

  it("kr: Eastmoney hanging still answers KOSPI from Naver within 9 s and leaves KOSPI 200 out with a note", async () => {
    vi.useFakeTimers();
    const n = net(ROUTES);
    const hung = { list: () => new Promise<never>(() => {}), kline: () => new Promise<never>(() => {}) };
    const pending = worldIndices({ http: n.http, eastmoney: hung }).levels("kr");
    await vi.advanceTimersByTimeAsync(9_000);
    const r = answered(await pending);
    expect(keysOf(r)).toEqual(["ix:kr:kospi", "ix:kr:kosdaq"]);
    expect(r.items[0]!.quoteFrom).toBe("Naver · real time");
    expect(r.read.note).toContain("KOSPI 200");
  });

  it("cn: Tencent is asked once for five codes, named Tencent", async () => {
    const n = net(ROUTES);
    const r = answered(await worldIndices({ http: n.http, clock: () => SAT }).levels("cn"));
    expect(keysOf(r)).toEqual(["ix:cn:sse", "ix:cn:szse", "ix:cn:csi300", "ix:cn:chinext", "ix:cn:star50"]);
    const asks = n.sent.filter((u) => u.includes("qt.gtimg.cn"));
    expect(asks).toHaveLength(1);
    expect(asks[0]).toContain("sh000001,sz399001,sh000300,sz399006,sh000688");
    expect(r.items[0]!.quoteFrom).toBe("Tencent");
    expect(r.items[2]!.price).toBeCloseTo(3954.57);
  });

  it("hk: Tencent first, the other two Hong Kong indices left to Eastmoney when Tencent is down", async () => {
    const n = net([["qt.gtimg.cn", reply("", 500)], ...ROUTES]);
    const r = answered(await worldIndices({ http: n.http, clock: () => SAT }).levels("hk"));
    expect(keysOf(r)).toEqual(["ix:hk:hsi", "ix:hk:hscei", "ix:hk:hstech"]);
    expect(r.items.map((i) => i.quoteFrom)).toEqual(["Naver · 15 min delayed", "Eastmoney", "Eastmoney"]);
  });

  it("tw: TAIEX from MIS as TWSE real time", async () => {
    const r = answered(await worldIndices({ http: net(ROUTES).http, clock: () => SAT }).levels("tw"));
    expect(keysOf(r)).toEqual(["ix:tw:taiex"]);
    expect(r.items[0]).toMatchObject({ quoteFrom: "TWSE · real time", price: 36033.29 });
  });

  it("tw: MIS down falls to Naver then Eastmoney", async () => {
    const a = answered(await worldIndices({ http: net([["getStockInfo", reply("", 500)], ...ROUTES]).http, clock: () => SAT }).levels("tw"));
    expect(a.items[0]!.quoteFrom).toBe("Naver · 20 min delayed");
    const b = answered(await worldIndices({ http: net([["getStockInfo", reply("", 500)], ["worldstock", reply("", 403)], ...ROUTES]).http, clock: () => SAT }).levels("tw"));
    expect(b.items[0]!.quoteFrom).toBe("Eastmoney");
  });

  it("movers orders by the size of the move", async () => {
    const r = answered(await worldIndices({ http: net(ROUTES).http, clock: () => SAT }).levels("eu", "movers"));
    const pct = r.items.map((i) => Math.abs(i.changePct24h ?? 0));
    expect(pct).toEqual([...pct].sort((a, b) => b - a));
    expect(r.read.sort).toBe("movers");
  });

  it("a read is kept to the next open outside the session, and asked again after", async () => {
    const n = net(ROUTES);
    let t = SAT;
    const w = worldIndices({ http: n.http, clock: () => t });
    await w.levels("jp"); await w.levels("jp");
    expect(n.sent.filter((u) => u.includes("worldstock"))).toHaveLength(1);
    t += 3 * 86_400_000;
    await w.levels("jp");
    expect(n.sent.filter((u) => u.includes("worldstock"))).toHaveLength(2);
  });

  it("an index no source answers keeps its last level flagged stale for a day, then is left out", async () => {
    let up = true;
    const n = net([["worldstock/index", () => (up ? reply(fx("naver-world.json")) : reply("", 500))], ["ulist.np", () => (up ? reply(fx("em-indices.json")) : reply("", 500))]]);
    let t = Date.parse("2026-11-23T09:00:00Z"); // Monday, Europe in session: a read is kept 15 s
    const w = worldIndices({ http: n.http, clock: () => t });
    answered(await w.levels("eu"));
    up = false; t += 3_600_000;
    const stale = answered(await w.levels("eu"));
    expect(keysOf(stale)).toHaveLength(4);
    expect(stale.items[0]!.quoteFrom).toContain("stale");
    expect(stale.read.status.state).toBe("stale");
    t += 86_400_000;
    expect(isRefusal(await w.levels("eu"))).toBe(true);
  });

  it("every source down is a refusal", async () => {
    const n = net([]);
    expect(isRefusal(await worldIndices({ http: n.http, clock: () => SAT }).levels("in"))).toBe(true);
  });
});

describe("quotes", () => {
  it("answers by region:id with the source's own words", async () => {
    const m = answered(await worldIndices({ http: net(ROUTES).http, clock: () => SAT }).quotes(["jp:n225", "tw:taiex", "xx:none"]));
    expect([...m.keys()].sort()).toEqual(["jp:n225", "tw:taiex"]);
    expect(m.get("tw:taiex")!.quoteFrom).toBe("TWSE · real time");
    expect(m.get("jp:n225")!.local.quoteStatus).toBe("delayed");
  });
});

describe("history", () => {
  it("jp:n225 1Y is Eastmoney's kline", async () => {
    const n = net(ROUTES);
    const h = answered(await worldIndices({ http: n.http, clock: () => SAT }).history("jp:n225", "1Y"));
    expect(h).toMatchObject({ venue: "ix", symbol: "jp:n225", range: "1Y", source: "Eastmoney" });
    expect("candles" in h && h.candles.length).toBeGreaterThan(100);
  });
  it("cn:csi300 is Tencent's fqkline; Tencent failing falls to Eastmoney (hand-made reply shaped like em-kline.json)", async () => {
    const a = answered(await worldIndices({ http: net(ROUTES).http, clock: () => SAT }).history("cn:csi300", "3M"));
    expect(a).toMatchObject({ source: "Tencent" });
    const em = JSON.stringify({ rc: 0, data: { code: "000300", klines: ["2026-11-19,3900.00,3950.00,3960.00,3890.00,0,0.00", "2026-11-20,3950.00,3954.57,3961.07,3894.47,0,0.00"] } });
    const n = net([["fqkline/get", reply("", 500)], ["push2his", reply(em)], ...ROUTES]);
    const b = answered(await worldIndices({ http: n.http, clock: () => SAT }).history("cn:csi300", "3M"));
    expect(b).toMatchObject({ source: "Eastmoney" });
    expect(n.sent.find((u) => u.includes("push2his"))).toContain("secid=1.000300");
  });
  it("hk:hsi is Tencent's hkfqkline", async () => {
    const n = net(ROUTES);
    const h = answered(await worldIndices({ http: n.http, clock: () => SAT }).history("hk:hsi", "6M"));
    expect(h).toMatchObject({ source: "Tencent" });
    expect(n.sent[0]).toContain("param=hkHSI,day");
  });
  it("Eastmoney down falls to Naver's chart; intraday and unknown indices are refused", async () => {
    const n = net([["push2his", reply("", 500)], ["chart/foreign/index/.N225", reply(fx("naver-index-chart.json"))], ...ROUTES]);
    const w = worldIndices({ http: n.http, clock: () => SAT });
    expect(answered(await w.history("jp:n225", "3M"))).toMatchObject({ source: "Naver" });
    expect(isRefusal(await w.history("jp:n225", "1D"))).toBe(true);
    expect(isRefusal(await w.history("jp:nope", "1Y"))).toBe(true);
  });
});

describe("eastmoney dep", () => {
  it("is built from the http when not given", async () => {
    const n = net([["worldstock/index", reply("", 500)], ...ROUTES]);
    const r = answered(await worldIndices({ http: n.http, clock: () => SAT, eastmoney: eastmoney({ http: n.http, clock: () => SAT }) }).levels("jp"));
    expect(r.items[0]!.quoteFrom).toBe("Eastmoney");
  });
});
