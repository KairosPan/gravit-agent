import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { CnHttp, CnReply } from "../../src/live/cn-http.ts";
import { eastmoney, emListUrl } from "../../src/live/eastmoney.ts";
import { hongKongSource, HK_RANK_ROWS } from "../../src/live/hongkong.ts";

const fxBytes = (n: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../fixtures/regions/${n}`, import.meta.url)));
const reply = (bytes: Uint8Array, status = 200): CnReply => ({ status, bytes });
const text = (s: string, status = 200): CnReply => reply(new TextEncoder().encode(s), status);
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
const RANK = reply(fxBytes("hk-rank.txt"));
const EM = reply(fxBytes("em-hk-list.json"));
const QUOTES = reply(fxBytes("tencent-quotes.txt"));
const routes = (over: Route[] = []): Route[] => [...over,
  ["hk_rank.php", RANK], ["em-hk", EM], ["push2delay.eastmoney.com/api/qt/clist", EM], ["qt.gtimg.cn", QUOTES],
  ["hkfqkline", reply(fxBytes("hk-kline.json"))], ["hkMinute", reply(fxBytes("hk-minute.json"))], ["smartbox", reply(fxBytes("hk-search.txt"))]];

/** Saturday 2026-11-21 21:00 UTC: Sunday morning in Hong Kong. */
const SUN = Date.parse("2026-11-21T21:00:00Z");
/** Friday 2026-11-20 11:00 Hong Kong, and Monday 2026-11-23 11:00 Hong Kong */
const FRI_11 = Date.parse("2026-11-20T03:00:00Z"), MON_11 = Date.parse("2026-11-23T03:00:00Z");
const down = text("<html>busy</html>", 500);

describe("the Hong Kong source", () => {
  it("is venue hk, named Tencent", () => {
    const s = hongKongSource({ http: net(routes()).http, clock: () => SUN });
    expect(s.venue).toBe("hk");
    expect(s.name).toBe("Tencent");
    expect(HK_RANK_ROWS).toBe(200);
  });

  it("the ranking: turnover order, hk: keys of five digits, HKD, the session from the Hong Kong clock", async () => {
    const n = net(routes());
    const r = answered(await hongKongSource({ http: n.http, clock: () => SUN }).rank("volume"));
    expect(n.sent.filter((u) => u.includes("hk_rank.php"))).toHaveLength(HK_RANK_ROWS / 50);
    expect(r.items.slice(0, 3).map((i) => i.key)).toEqual(["hk:00700", "hk:09988", "hk:01347"]);
    expect(r.items.every((i) => /^hk:\d{5}$/.test(i.key) && i.currency === "HKD" && i.region === "hk" && i.kind === "share")).toBe(true);
    expect(r.items[0]).toMatchObject({ name: "腾讯控股", price: 344, changePct24h: -1.26, turnoverLocal: 14089992865.68, quoteFrom: "Tencent" });
    expect(r.items[0]!.at[0]).toMatchObject({ venue: "hk", canTrade: false, connected: false });
    expect(r.items).toHaveLength(50); // the fixture answers every page alike; a code is listed once
    expect(r.read).toMatchObject({ venue: "hk", region: "hk", sort: "volume", total: 2041, asOf: new Date(SUN).toISOString(),
      session: { phase: "closed", lastSession: "2026-11-20" }, status: { state: "live", said: "Tencent · answering" } });
    expect(r.read.note).toContain("Tencent");
  });

  it("movers: the turnover ranking re-sorted by the size of the move", async () => {
    const r = answered(await hongKongSource({ http: net(routes()).http, clock: () => SUN }).rank("movers"));
    const sizes = r.items.map((i) => Math.abs(i.changePct24h ?? 0));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(r.items[0]!.key).toBe("hk:09999"); // NetEase, -17.60
    expect(r.read.sort).toBe("movers");
  });

  it("a failed Tencent (a 500, then an unparseable 200) is answered from Eastmoney's main board, its ETFs dropped", async () => {
    for (const bad of [down, text("<html>maintenance</html>")]) {
      const n = net(routes([["hk_rank.php", bad]]));
      const r = answered(await hongKongSource({ http: n.http, clock: () => SUN }).rank("volume"));
      const keys = r.items.map((i) => i.key);
      expect(keys.slice(0, 2)).toEqual(["hk:00700", "hk:09988"]);
      for (const etf of ["02800", "03033", "02828", "07709", "07552", "07226"]) expect(keys).not.toContain(`hk:${etf}`);
      expect(keys).toContain("hk:01299");
      expect(r.items[0]).toMatchObject({ quoteFrom: "Eastmoney · delayed", currency: "HKD" });
      expect(r.read.note).toContain("Eastmoney");
      expect(r.read.status.state).toBe("live");
      expect(n.sent.some((u) => u.includes(encodeURIComponent("m:128+t:3")) || u.includes("fs=m:128+t:3&"))).toBe(true);
    }
  });

  it("an empty ranking is a failure: Tencent's falls to Eastmoney's, an empty Eastmoney is refused", async () => {
    const empty = text('list_data={"code":0,"msg":"","data":{"page_data":[],"stock_count":0}}');
    const emEmpty = text(JSON.stringify({ data: { total: 0, diff: [] } }));
    const viaEm = answered(await hongKongSource({ http: net(routes([["hk_rank.php", empty]])).http, clock: () => SUN }).rank("volume"));
    expect(viaEm.items[0]!.quoteFrom).toBe("Eastmoney · delayed");
    const none = hongKongSource({ http: net(routes([["hk_rank.php", empty], ["eastmoney", emEmpty]])).http, clock: () => SUN });
    expect(refused(await none.rank("volume")).code).toBe("E_VENUE_UNREACHABLE");
    expect(none.status().state).toBe("unavailable");
  });

  it("both failing answers the last good ranking stale, within ten minutes; past them, refused", async () => {
    let t = SUN;
    let broken = false;
    const n = net(routes([["hk_rank.php", () => (broken ? down : RANK)], ["eastmoney", () => (broken ? down : EM)]]));
    const s = hongKongSource({ http: n.http, clock: () => t });
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

  it("a refusing host (a 429) is read as a failure and not asked again", async () => {
    const n = net(routes([["hk_rank.php", text("slow down", 429)], ["eastmoney", text("slow down", 429)]]));
    const s = hongKongSource({ http: n.http, clock: () => SUN });
    expect(refused(await s.rank("volume")).code).toBe("E_VENUE_UNREACHABLE");
    const rankAsks = n.sent.filter((u) => u.includes("hk_rank.php")).length;
    await s.rank("movers");
    expect(n.sent.filter((u) => u.includes("hk_rank.php")).length).toBe(rankAsks);
  });

  it("quotes: 700 and 09988 key 00700 and 09988, with the facts", async () => {
    const n = net(routes());
    const q = answered(await hongKongSource({ http: n.http, clock: () => SUN }).quotes(["700", "09988", "700"]));
    expect(n.sent).toEqual(["https://qt.gtimg.cn/q=r_hk00700,r_hk09988"]);
    expect([...q.keys()]).toEqual(["00700", "09988"]);
    const m = q.get("00700")!;
    expect(m).toMatchObject({ symbol: "00700", name: "腾讯控股", price: 344, quote: "HKD", currency: "HKD", quoteAt: "2026-11-20T16:08:37+08:00",
      quoteFrom: "Tencent", change24h: -4.4, changePct24h: -1.26, session: { open: false } });
    expect(m.local).toEqual({ prevClose: 348.4, open: 341, high: 349.6, low: 339.6, volume: 41094469, turnover: 14089992865.68,
      lastSession: "2026-11-20", phase: "closed", quoteStatus: "unsaid" });
    expect(q.get("09988")!.local.prevClose).toBe(80.55);
  });

  it("quotes: the quote's day decides, on a trading weekday", async () => {
    const today = answered(await hongKongSource({ http: net(routes()).http, clock: () => FRI_11 }).quotes(["700"]));
    expect(today.get("00700")!.local.phase).toBe("trading");
    expect(today.get("00700")!.session).toEqual({ open: true });
    const holiday = answered(await hongKongSource({ http: net(routes()).http, clock: () => MON_11 }).quotes(["700"]));
    expect(holiday.get("00700")!.local.phase).toBe("closed");
  });

  it("quotes: a failure is refused and a non-code is no asked", async () => {
    const n = net(routes([["qt.gtimg.cn", down]]));
    const s = hongKongSource({ http: n.http, clock: () => SUN });
    expect(refused(await s.quotes(["700"])).code).toBe("E_VENUE_UNREACHABLE");
    expect((answered(await s.quotes(["tencent"]))).size).toBe(0);
    expect(refused(await s.quotes(Array.from({ length: 31 }, (_, i) => String(i + 1)))).code).toBe("E_ACCOUNT_BAD_ACTION");
  });

  it("history 1D is the minutes; 1Y the forward-adjusted daily bars", async () => {
    const s = hongKongSource({ http: net(routes()).http, clock: () => SUN });
    const d = answered(await s.history("700", "1D"));
    expect(d).toMatchObject({ venue: "hk", venueName: "Tencent", symbol: "00700", range: "1D", source: "Tencent" });
    expect("sessions" in d && d.sessions).toHaveLength(1);
    expect("sessions" in d && d.sessions[0]!.price).toHaveLength(332);
    const y = answered(await s.history("00700", "1Y"));
    expect(y).toMatchObject({ range: "1Y", adjustment: "forward-adjusted (前复权)" });
    expect("candles" in y && y.candles.length).toBe(320);
  });

  it("history 5D is refused: the minutes carry one day", async () => {
    const r = refused(await hongKongSource({ http: net(routes()).http, clock: () => SUN }).history("700", "5D"));
    expect(r.message).toBe("Hong Kong's five-day minutes are not read here");
  });

  it("history: a bad symbol is refused, a failing source is refused", async () => {
    const s = hongKongSource({ http: net(routes([["hkfqkline", down]])).http, clock: () => SUN });
    expect(refused(await s.history("tencent", "1Y")).code).toBe("E_ACCOUNT_BAD_ACTION");
    expect(refused(await s.history("700", "1Y")).code).toBe("E_VENUE_UNREACHABLE");
  });

  it("search tencent: hk:00700 first, priced from the quotes", async () => {
    const n = net(routes());
    const hits = answered(await hongKongSource({ http: n.http, clock: () => SUN }).search("tencent"));
    expect(hits.map((h) => h.key)).toEqual(["hk:00700"]);
    expect(hits[0]).toMatchObject({ name: "腾讯控股", currency: "HKD", price: 344, quoteFrom: "Tencent" });
    expect(n.sent[0]).toContain("smartbox.gtimg.cn");
  });

  it("search: a failing smartbox is refused; an empty query is empty", async () => {
    const s = hongKongSource({ http: net(routes([["smartbox", down]])).http, clock: () => SUN });
    expect(refused(await s.search("tencent")).code).toBe("E_VENUE_UNREACHABLE");
    expect(answered(await s.search("  "))).toEqual([]);
  });

  it("uses a given Eastmoney when it is handed one", async () => {
    const asked: string[] = [];
    const em = { list: async (url: string) => { asked.push(url); return []; }, kline: async () => [] } as unknown as ReturnType<typeof eastmoney>;
    const s = hongKongSource({ http: net(routes([["hk_rank.php", down]])).http, clock: () => SUN, eastmoney: em });
    expect(refused(await s.rank("volume")).code).toBe("E_VENUE_UNREACHABLE");
    expect(asked).toEqual([emListUrl("m:128+t:3", { fid: "f6", pz: 200 })]);
  });
});
