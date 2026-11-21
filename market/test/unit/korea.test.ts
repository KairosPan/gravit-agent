import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { CnHttp, CnReply } from "../../src/live/cn-http.ts";
import { koreaSource, KR_RANK_ROWS } from "../../src/live/korea.ts";

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
const RANK_BODY = fxText("naver-kospi-value.json");
const RANK = text(RANK_BODY);
const routes = (over: Route[] = []): Route[] => [...over,
  ["marketValue/KOSPI", RANK], ["realtime/domestic/stock", text(fxText("naver-kr-quotes.json"))],
  ["chart/domestic/item", text(fxText("naver-kr-chart.json"))], ["ac.stock.naver.com", text(fxText("naver-search.json"))]];

/** Saturday 2026-11-21 21:00 UTC: Sunday morning in Seoul. */
const SUN = Date.parse("2026-11-21T21:00:00Z");
/** Friday 2026-11-20 11:00 Seoul, and Monday 2026-11-23 11:00 Seoul (the fixture's last trade is the Friday) */
const FRI_11 = Date.parse("2026-11-20T02:00:00Z"), MON_11 = Date.parse("2026-11-23T02:00:00Z");
const down = text("<html>busy</html>", 500);
const asks = (n: ReturnType<typeof net>) => n.sent.filter((u) => u.includes("marketValue/KOSPI")).length;
const page = JSON.parse(RANK_BODY) as { stocks: Array<{ stockEndType: string; itemCode: string; accumulatedTradingValueRaw: string }> };
const shares = page.stocks.filter((s) => s.stockEndType === "stock");
const byTurnover = [...shares].sort((a, b) => Number(b.accumulatedTradingValueRaw) - Number(a.accumulatedTradingValueRaw)).map((s) => `kr:${s.itemCode}`);

describe("the Korea source", () => {
  it("is venue kr, named Naver", () => {
    const s = koreaSource({ http: net(routes()).http, clock: () => SUN });
    expect(s.venue).toBe("kr");
    expect(s.name).toBe("Naver");
    expect(KR_RANK_ROWS).toBe(200);
  });

  it("the ranking: shares only, turnover order, kr: keys, KRW, Korean names, the Seoul session", async () => {
    const n = net(routes());
    const r = answered(await koreaSource({ http: n.http, clock: () => SUN }).rank("volume"));
    expect(asks(n)).toBe(2);
    expect(n.sent.some((u) => u.endsWith("page=2&pageSize=100"))).toBe(true);
    expect(r.items.length).toBeLessThanOrEqual(KR_RANK_ROWS);
    expect(r.items.map((i) => i.key)).toEqual(byTurnover); // the fixture answers both pages alike; a code is listed once
    expect(r.items.every((i) => /^kr:[0-9A-Z]{6}$/.test(i.key) && i.currency === "KRW" && i.region === "kr" && i.kind === "share")).toBe(true);
    expect(r.items.every((i) => i.nameLocal === undefined)).toBe(true);
    const sk = r.items.find((i) => i.key === "kr:000660")!;
    expect(sk).toMatchObject({ name: "SK하이닉스", price: 1100000, changePct24h: -7.02, turnoverLocal: 3618595000000, quoteFrom: "Naver · real time" });
    expect(sk.at[0]).toMatchObject({ venue: "kr", canTrade: false, connected: false });
    expect(r.read).toMatchObject({ venue: "kr", region: "kr", sort: "volume", total: r.items.length, asOf: new Date(SUN).toISOString(),
      session: { phase: "closed", lastSession: "2026-11-20" }, status: { state: "live", said: "Naver · answering" },
      note: "the 200 largest KOSPI shares by market value, ordered by today's turnover" });
  });

  it("the ranking includes the alphanumeric 0126Z0, in turnover order", async () => {
    const r = answered(await koreaSource({ http: net(routes()).http, clock: () => SUN }).rank("volume"));
    const keys = r.items.map((i) => i.key);
    expect(keys).toContain("kr:0126Z0");
    expect(keys.indexOf("kr:0126Z0")).toBe(byTurnover.indexOf("kr:0126Z0"));
  });

  it("a page 2 that fails fails the whole read: refused with nothing before it, stale with something", async () => {
    const two = text(RANK_BODY);
    let broken = false;
    const n = net(routes([["page=2&", () => (broken ? down : two)], ["page=1&", two]]));
    let t = FRI_11;
    const s = koreaSource({ http: n.http, clock: () => t });
    broken = true;
    expect(refused(await s.rank("volume")).code).toBe("E_VENUE_UNREACHABLE");
    broken = false;
    const first = answered(await s.rank("volume"));
    broken = true;
    t += 60_000;
    const stale = answered(await s.rank("volume"));
    expect(stale.read.status.state).toBe("stale");
    expect(stale.items).toEqual(first.items);
  });

  it("two different pages are both read, and the top 200 are re-sorted by turnover as one", async () => {
    const half = (from: number, to: number) => text(JSON.stringify({ ...JSON.parse(RANK_BODY), stocks: page.stocks.slice(from, to) }));
    const n = net(routes([["page=1&", half(0, 50)], ["page=2&", half(50, 100)]]));
    const r = answered(await koreaSource({ http: n.http, clock: () => SUN }).rank("volume"));
    expect(r.items.map((i) => i.key)).toEqual(byTurnover);
  });

  it("movers: the same rows re-sorted by the size of the move, with its own note", async () => {
    const n = net(routes());
    const r = answered(await koreaSource({ http: n.http, clock: () => SUN }).rank("movers"));
    const sizes = r.items.map((i) => Math.abs(i.changePct24h ?? 0));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(r.read.sort).toBe("movers");
    expect(r.read.note).toBe("the 200 largest KOSPI shares by market value, ordered by today's move");
  });

  it("an unparseable 200 or an empty page, with nothing before it, is refused", async () => {
    for (const bad of [text("<html>maintenance</html>"), text(JSON.stringify({ stocks: [], totalCount: 0 })), down]) {
      const s = koreaSource({ http: net(routes([["marketValue/KOSPI", bad]])).http, clock: () => SUN });
      expect(refused(await s.rank("volume")).code).toBe("E_VENUE_UNREACHABLE");
      expect(s.status().state).toBe("unavailable");
    }
  });

  it("an unparseable 200 after a good read answers the last ranking stale, within ten minutes; past them, refused", async () => {
    let t = FRI_11;
    let broken = false;
    const n = net(routes([["marketValue/KOSPI", () => (broken ? text("<html>maintenance</html>") : RANK)]]));
    const s = koreaSource({ http: n.http, clock: () => t });
    const first = answered(await s.rank("volume"));
    broken = true;
    t += 60_000;
    const stale = answered(await s.rank("volume"));
    expect(stale.items).toEqual(first.items);
    expect(stale.read.status.state).toBe("stale");
    expect(stale.read.status.said).toContain("did not answer");
    expect(s.status().state).toBe("stale");
    t += 700_000;
    expect(refused(await s.rank("volume")).code).toBe("E_VENUE_UNREACHABLE");
    expect(s.status().state).toBe("unavailable");
  });

  it("the keep: in session 10 s, outside it until the next session opens; one read for both sorts", async () => {
    let t = FRI_11;
    const a = net(routes());
    const s = koreaSource({ http: a.http, clock: () => t });
    await Promise.all([s.rank("volume"), s.rank("movers")]);
    const first = asks(a);
    expect(first).toBe(2);
    t += 5_000;
    answered(await s.rank("movers"));
    expect(asks(a)).toBe(first);
    t += 6_000;
    answered(await s.rank("volume"));
    expect(asks(a)).toBe(first * 2);
    t = SUN;
    const b = net(routes());
    const closed = koreaSource({ http: b.http, clock: () => t });
    answered(await closed.rank("volume"));
    t += 3_600_000;
    answered(await closed.rank("volume"));
    expect(asks(b)).toBe(2);
    t += 36 * 3_600_000;
    answered(await closed.rank("volume"));
    expect(asks(b)).toBe(4);
  });

  it("a weekday holiday reads closed: the rows' trade day is not today's", async () => {
    expect(answered(await koreaSource({ http: net(routes()).http, clock: () => MON_11 }).rank("volume")).read.session.phase).toBe("closed");
    expect(answered(await koreaSource({ http: net(routes()).http, clock: () => FRI_11 }).rank("volume")).read.session.phase).toBe("trading");
  });

  it("a refusing host (a 429) is a failure and is not asked again", async () => {
    const n = net(routes([["marketValue/KOSPI", text("slow down", 429)]]));
    const s = koreaSource({ http: n.http, clock: () => SUN });
    expect(refused(await s.rank("volume")).code).toBe("E_VENUE_UNREACHABLE");
    const before = asks(n);
    await s.rank("movers");
    expect(asks(n)).toBe(before);
  });

  it("quotes: 005930 and 005935 key as written; 005935 is not in the fixture's reply and is left out", async () => {
    const n = net(routes());
    const q = answered(await koreaSource({ http: n.http, clock: () => SUN }).quotes(["005930", "005935", "005930"]));
    expect(n.sent).toEqual(["https://polling.finance.naver.com/api/realtime/domestic/stock/005930,005935"]);
    expect([...q.keys()]).toEqual(["005930"]);
    const m = q.get("005930")!;
    expect(m).toMatchObject({ symbol: "005930", name: "삼성전자", price: 180900, quote: "KRW", currency: "KRW", quoteAt: "2026-11-20T20:00:00+09:00",
      quoteFrom: "Naver · real time", change24h: -16000, changePct24h: -8.13, session: { open: false } });
    expect(m.local).toEqual({ prevClose: 196900, open: 188100, high: 189300, low: 180100, volume: 17706899, turnover: 3267336000000,
      lastSession: "2026-11-20", phase: "closed", quoteStatus: "live" });
  });

  it("quotes: an alphanumeric code is asked upper-cased and read", async () => {
    const body = JSON.parse(fxText("naver-kr-quotes.json"));
    body.datas = [{ ...body.datas[0], itemCode: "0126Z0", stockName: "알파" }];
    const n = net(routes([["realtime/domestic/stock", text(JSON.stringify(body))]]));
    const q = answered(await koreaSource({ http: n.http, clock: () => SUN }).quotes(["0126z0"]));
    expect(n.sent).toEqual(["https://polling.finance.naver.com/api/realtime/domestic/stock/0126Z0"]);
    expect(q.get("0126Z0")).toMatchObject({ symbol: "0126Z0", name: "알파", price: 180900 });
  });

  it("quotes: a trading weekday takes the quote's day; a failure is refused; a non-code is not asked", async () => {
    expect(answered(await koreaSource({ http: net(routes()).http, clock: () => FRI_11 }).quotes(["005930"])).get("005930")!.session).toEqual({ open: true });
    expect(answered(await koreaSource({ http: net(routes()).http, clock: () => MON_11 }).quotes(["005930"])).get("005930")!.local.phase).toBe("closed");
    const s = koreaSource({ http: net(routes([["realtime/domestic", down]])).http, clock: () => SUN });
    expect(refused(await s.quotes(["005930"])).code).toBe("E_VENUE_UNREACHABLE");
    expect(answered(await s.quotes(["samsung", "5930"])).size).toBe(0);
    expect(refused(await s.quotes(Array.from({ length: 31 }, (_, i) => String(100000 + i)))).code).toBe("E_ACCOUNT_BAD_ACTION");
  });

  it("history: 1M and 1Y come from the day candles, a range longer than the bars answers what there is", async () => {
    const s = koreaSource({ http: net(routes()).http, clock: () => SUN });
    const m = answered(await s.history("005930", "1M"));
    expect(m).toMatchObject({ venue: "kr", venueName: "Naver", symbol: "005930", range: "1M", source: "Naver" });
    const month = "candles" in m ? m.candles : [];
    expect(month.length).toBeGreaterThan(15);
    expect(month.length).toBeLessThan(25);
    expect(month.at(-1)!.c).toBe(180900);
    const y = answered(await s.history("005930", "1Y"));
    expect("candles" in y && y.candles.length).toBe(110);
    const max = answered(await s.history("005930", "MAX"));
    expect("candles" in max && max.candles.length).toBe(110);
    const ytd = answered(await s.history("005930", "YTD"));
    expect("candles" in ytd && ytd.candles.length).toBe(110);
  });

  it("history 1D and 5D are refused; a bad symbol and a failing chart are refused", async () => {
    const s = koreaSource({ http: net(routes()).http, clock: () => SUN });
    for (const range of ["1D", "5D"] as const) expect(refused(await s.history("005930", range)).message).toBe("Korea's intraday chart is not read here");
    expect(refused(await s.history("samsung", "1Y")).code).toBe("E_ACCOUNT_BAD_ACTION");
    const bad = koreaSource({ http: net(routes([["chart/domestic", down]])).http, clock: () => SUN });
    expect(refused(await bad.history("005930", "1Y")).code).toBe("E_VENUE_UNREACHABLE");
  });

  it("search: only Korean listings; the fixture's samsung has none, a hand-made Korean reply finds kr:005930", async () => {
    const real = answered(await koreaSource({ http: net(routes()).http, clock: () => SUN }).search("samsung"));
    expect(real).toEqual([]);
    // naver-search.json (q=samsung) holds no Korean item: this reply is hand-made, shaped like the fixture's items
    const made = text(JSON.stringify({ query: "samsung", items: [
      { code: "02812", name: "Samsung CSI China Dragon Internet ETF", typeCode: "HONG_KONG", nationCode: "HKG", category: "stock" },
      { code: "005930", name: "삼성전자", typeCode: "KOSPI", nationCode: "KOR", category: "stock" },
      { code: "0126Z0", name: "알파", typeCode: "KOSPI", nationCode: "KOR", category: "stock" }] }));
    const n = net(routes([["ac.stock.naver.com", made]]));
    const hits = answered(await koreaSource({ http: n.http, clock: () => SUN }).search("samsung"));
    expect(hits.map((h) => h.key)).toEqual(["kr:005930", "kr:0126Z0"]);
    expect(hits[0]).toMatchObject({ name: "삼성전자", currency: "KRW", price: 180900, quoteFrom: "Naver · real time" });
    expect(n.sent[0]).toBe("https://ac.stock.naver.com/ac?q=samsung&target=stock");
  });

  it("search: a failing reply is refused; an empty query is empty", async () => {
    const s = koreaSource({ http: net(routes([["ac.stock.naver.com", down]])).http, clock: () => SUN });
    expect(refused(await s.search("samsung")).code).toBe("E_VENUE_UNREACHABLE");
    expect(answered(await s.search("  "))).toEqual([]);
  });
});
