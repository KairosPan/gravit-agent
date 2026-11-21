import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { CnHttp, CnReply } from "../../src/live/cn-http.ts";
import { MIS_BATCH, taiwanSource, twCode, TW_UNIVERSE } from "../../src/live/taiwan.ts";

const fxText = (n: string): string => readFileSync(new URL(`../fixtures/regions/${n}`, import.meta.url), "utf8");
const text = (s: string, status = 200): CnReply => ({ status, bytes: new TextEncoder().encode(s) });
const answered = <T,>(v: T | Refusal): T => { if (isRefusal(v)) throw new Error(`refused: ${v.message}`); return v; };
const refused = (v: unknown): Refusal => { if (!isRefusal(v)) throw new Error("answered"); return v; };

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
const DAY_BODY = fxText("twse-day-all.json");
/** MIS answers whatever codes it is asked, with a volume that differs from the day table's order; "9" in the third place of a code is "no trade yet" */
const lotsOf = (code: string): number => 1000 + (Number(code.replace(/\D/g, "")) * 7919) % 997;
const noTrade = (code: string): boolean => code === "1101";
const mis = (date = "20261123"): ((url: string) => CnReply) => (url) => {
  const codes = [...url.matchAll(/tse_([0-9A-Z]+)\.tw/g)].map((m) => m[1]!);
  const msgArray = codes.map((c) => ({ c, d: date, tlong: String(Date.parse("2026-11-23T10:00:00+08:00")), n: `n${c}`, z: noTrade(c) ? "-" : "100.0000", y: "95.0000",
    o: "96.0000", h: "101.0000", l: "95.5000", v: String(lotsOf(c)) }));
  return text(JSON.stringify({ msgArray, rtcode: "0000", rtmessage: "OK" }));
};
const routes = (over: Route[] = []): Route[] => [...over,
  ["STOCK_DAY_ALL", text(DAY_BODY)], ["getStockInfo", mis()], ["STOCK_DAY?", text(fxText("twse-stock-day.json"))]];

/** Sunday 2026-11-22 05:00 Taipei; Monday 2026-11-23 10:00 Taipei (in session) */
const SUN = Date.parse("2026-11-21T21:00:00Z"), MON_10 = Date.parse("2026-11-23T02:00:00Z");
const misAsks = (n: ReturnType<typeof net>) => n.sent.filter((u) => u.includes("getStockInfo"));
const day = (JSON.parse(DAY_BODY) as Array<{ Code: string; TradeValue: string }>)
  .filter((r) => !r.Code.startsWith("00")).sort((a, b) => Number(b.TradeValue || 0) - Number(a.TradeValue || 0)).slice(0, TW_UNIVERSE);

describe("the Taiwan source", () => {
  it("is venue tw, named TWSE", () => {
    const s = taiwanSource({ http: net(routes()).http, clock: () => SUN });
    expect([s.venue, s.name, TW_UNIVERSE, MIS_BATCH]).toEqual(["tw", "TWSE", 200, 50]);
    expect(twCode("2881a")).toBe("2881A");
  });

  it("outside the session: the day table is the list, no MIS ask, no ETF", async () => {
    const n = net(routes());
    const r = answered(await taiwanSource({ http: n.http, clock: () => SUN }).rank("volume"));
    expect(misAsks(n)).toHaveLength(0);
    expect(n.sent.filter((u) => u.includes("STOCK_DAY_ALL"))).toHaveLength(1);
    expect(r.items.map((i) => i.base)).toEqual(day.map((d) => d.Code));
    expect(r.items.every((i) => /^tw:[0-9A-Z]{4,6}$/.test(i.key) && !i.base!.startsWith("00") && i.currency === "TWD" && i.region === "tw")).toBe(true);
    expect(r.items[0]).toMatchObject({ quoteFrom: "TWSE · last close" });
    expect(r.items.find((i) => i.key === "tw:2330")).toMatchObject({ name: "台積電", price: 2000, changePct24h: -4.76, turnoverLocal: 177284650683 });
    expect(r.read).toMatchObject({ venue: "tw", region: "tw", sort: "volume", total: 200, session: { phase: "closed", lastSession: "2026-11-20" },
      status: { state: "live", said: "TWSE · answering" }, note: "the 200 busiest TWSE shares at the last close" });
    expect(r.items[0]!.at[0]).toMatchObject({ venue: "tw", canTrade: false, connected: false });
  });

  it("in session: 200 priced from MIS in four asks of 50, ordered by MIS turnover, kept 30 s, movers from the same read", async () => {
    const n = net(routes());
    let t = MON_10;
    const s = taiwanSource({ http: n.http, clock: () => t });
    const r = answered(await s.rank("volume"));
    const asks = misAsks(n);
    expect(asks).toHaveLength(4);
    expect(asks.map((u) => (u.match(/tse_/g) ?? []).length)).toEqual([50, 50, 50, 50]);
    expect(asks.every((u) => u.endsWith("&json=1&delay=0"))).toBe(true);
    const turnover = (c: string): number => (noTrade(c) ? -1 : 100 * lotsOf(c) * 1000);
    const want = day.map((d) => d.Code).sort((a, b) => turnover(b) - turnover(a));
    expect(r.items.map((i) => i.base)).toEqual(want);
    expect(r.items[0]).toMatchObject({ quoteFrom: "TWSE · real time", price: 100, changePct24h: 5.26 });
    expect(r.read).toMatchObject({ session: { phase: "trading" }, status: { state: "live" } });
    expect(r.read.note).toContain("priced live");
    // movers re-sorts the same read; the dash row has no price
    const m = answered(await s.rank("movers"));
    expect(misAsks(n)).toHaveLength(4);
    expect(m.read.sort).toBe("movers");
    const dash = m.items.find((i) => i.base === "1101");
    if (dash) expect(dash.price).toBeUndefined();
    t += 29_000;
    await s.rank("volume");
    expect(misAsks(n)).toHaveLength(4);
    t += 2_000;
    await s.rank("volume");
    expect(misAsks(n)).toHaveLength(8);
    expect(n.sent.filter((u) => u.includes("STOCK_DAY_ALL"))).toHaveLength(1); // the day table is read once per close
  });

  it("z of a dash is a row without a price", async () => {
    const dashed = day.some((d) => d.Code === "1101");
    expect(dashed).toBe(true);
    const r = answered(await taiwanSource({ http: net(routes()).http, clock: () => MON_10 }).rank("volume"));
    const row = r.items.find((i) => i.base === "1101")!;
    expect(row.price).toBeUndefined();
    expect(row.changePct24h).toBeUndefined();
    expect(r.items.at(-1)!.base).toBe("1101");
  });

  it("a weekday holiday (MIS still on the last session's date) reads closed", async () => {
    const n = net(routes([["getStockInfo", mis("20261120")]]));
    const r = answered(await taiwanSource({ http: n.http, clock: () => MON_10 }).rank("volume"));
    expect(r.read.session.phase).toBe("closed");
  });

  it("an unparseable day table answers stale within ten minutes of a good read, and unavailable before one", async () => {
    let body = DAY_BODY;
    const n = net([["STOCK_DAY_ALL", { get status() { return 200; }, get bytes() { return new TextEncoder().encode(body); } } as CnReply]]);
    // 13:55 Taipei Monday: the table is the Friday's, read again soon
    let t = Date.parse("2026-11-23T05:55:00Z");
    const s = taiwanSource({ http: n.http, clock: () => t });
    expect(answered(await s.rank("volume")).read.status.state).toBe("live");
    t += 6 * 60_000;
    body = "<html>busy</html>";
    const r = answered(await s.rank("volume"));
    expect(r.read.status.state).toBe("stale");
    expect(r.items).toHaveLength(200);
    expect(s.status().state).toBe("stale");
    const fresh = taiwanSource({ http: net([["STOCK_DAY_ALL", text("<html>busy</html>")]]).http, clock: () => SUN });
    expect(refused(await fresh.rank("volume")).code).toBe("E_VENUE_UNREACHABLE");
    expect(fresh.status().state).toBe("unavailable");
  });

  it("an empty table, a 500 and a refusing status are failures", async () => {
    for (const reply of [text("[]"), text("oops", 500), text(DAY_BODY, 429)]) {
      const s = taiwanSource({ http: net([["STOCK_DAY_ALL", reply]]).http, clock: () => SUN });
      expect(refused(await s.rank("volume")).code).toBe("E_VENUE_UNREACHABLE");
    }
  });

  it("MIS failing in session is a failure, not a table passed off as live", async () => {
    for (const bad of [text("x", 500), text(JSON.stringify({ msgArray: [], rtcode: "5000" }))]) {
      const s = taiwanSource({ http: net(routes([["getStockInfo", bad]])).http, clock: () => MON_10 });
      expect(refused(await s.rank("volume")).code).toBe("E_VENUE_UNREACHABLE");
    }
  });

  it("quotes from MIS, at most 30 at once", async () => {
    const n = net(routes([["getStockInfo", text(fxText("twse-mis.json"))]]));
    const s = taiwanSource({ http: n.http, clock: () => SUN });
    const q = answered(await s.quotes(["2330", "2317", "nope"]));
    expect(n.sent[0]).toContain("tse_2330.tw|tse_2317.tw");
    expect(q.get("2330")).toMatchObject({ price: 2000, quote: "TWD", currency: "TWD", quoteFrom: "TWSE · real time", changePct24h: -4.76,
      local: { prevClose: 2100, volume: 75207000, quoteStatus: "live", lastSession: "2026-11-20" } });
    expect(refused(await s.quotes(Array.from({ length: 31 }, (_, i) => String(1000 + i)))).code).toBe("E_ACCOUNT_BAD_ACTION");
  });

  it("history 1M: two month asks (the fixture answers both), bars deduped and oldest first", async () => {
    const n = net(routes());
    const s = taiwanSource({ http: n.http, clock: () => Date.parse("2026-11-23T02:00:00Z") });
    const h = answered(await s.history("2330", "1M"));
    const asks = n.sent.filter((u) => u.includes("STOCK_DAY?"));
    expect(asks.map((u) => /date=(\d+)/.exec(u)![1])).toEqual(["20261101", "20261001"]);
    expect(h).toMatchObject({ venue: "tw", symbol: "2330", range: "1M", source: "TWSE" });
    if (!("candles" in h)) throw new Error("no candles");
    expect(h.candles).toHaveLength(15);
    expect(h.candles[0]!.t).toBeLessThan(h.candles.at(-1)!.t);
    expect(h.candles.at(-1)).toMatchObject({ c: 2000 });
  });

  it("history asks: 3M four, 6M seven, 1Y thirteen, YTD the months since January; a past month is kept, the current one ten minutes", async () => {
    const asksFor = async (range: "3M" | "6M" | "1Y" | "YTD", sym = "2330"): Promise<number> => {
      const n = net(routes());
      answered(await taiwanSource({ http: n.http, clock: () => Date.parse("2026-11-23T02:00:00Z") }).history(sym, range));
      return n.sent.filter((u) => u.includes("STOCK_DAY?")).length;
    };
    expect(await asksFor("3M")).toBe(4);
    expect(await asksFor("6M")).toBe(7);
    expect(await asksFor("1Y")).toBe(13);
    expect(await asksFor("YTD")).toBe(11);
    const n = net(routes());
    let t = Date.parse("2026-11-23T02:00:00Z");
    const s = taiwanSource({ http: n.http, clock: () => t });
    await s.history("2330", "1M");
    t += 11 * 60_000;
    await s.history("2330", "1M");
    expect(n.sent.filter((u) => u.includes("date=20261001"))).toHaveLength(1);
    expect(n.sent.filter((u) => u.includes("date=20261101"))).toHaveLength(2);
  });

  it("history refusals: 5Y, MAX, the intraday ranges, a bad code, a month failing", async () => {
    const s = taiwanSource({ http: net(routes()).http, clock: () => SUN });
    for (const r of ["5Y", "MAX"] as const) expect(refused(await s.history("2330", r)).message).toBe("Taiwan's history is read up to one year");
    for (const r of ["1D", "5D"] as const) expect(refused(await s.history("2330", r)).message).toBe("Taiwan's intraday chart is not read here");
    expect(refused(await s.history("x", "1M")).code).toBe("E_ACCOUNT_BAD_ACTION");
    const down = taiwanSource({ http: net(routes([["STOCK_DAY?", text("", 500)]])).http, clock: () => SUN });
    expect(refused(await down.history("2330", "1M")).code).toBe("E_VENUE_UNREACHABLE");
  });

  it("search within the day table: code prefix and name part, no MIS ask", async () => {
    const n = net(routes());
    const s = taiwanSource({ http: n.http, clock: () => SUN });
    expect(answered(await s.search("2330")).map((i) => i.key)).toContain("tw:2330");
    const byName = answered(await s.search("台積"));
    expect(byName.map((i) => i.key)).toContain("tw:2330");
    expect(byName[0]).toMatchObject({ quoteFrom: "TWSE · last close" });
    expect(answered(await s.search("0040")).length).toBe(0); // exchange-traded products are not shares
    expect(answered(await s.search("  "))).toEqual([]);
    expect(misAsks(n)).toHaveLength(0);
    expect(n.sent.filter((u) => u.includes("STOCK_DAY_ALL"))).toHaveLength(1);
  });
});
