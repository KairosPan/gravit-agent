/** CHINA IN THE ACCOUNT (plan 1, task 4): the China tab, China's hits in a search, an A share's quotes and history, through the service as
 * the routes and the seat reach it. A recording stand-in ChinaSource for the service's own rules, and the real chinaSource over a stand-in
 * CnHttp where what is pinned is Tencent's own answer passing through (a Beijing Saturday, a search typed in Chinese or as a STAR code).
 * Nothing leaves the process. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { RunMm } from "../../src/portfolio/live/metamask.ts";
import { CHINA_NOTE, chinaSource, type ChinaHistory, type ChinaMarket, type ChinaRead, type ChinaSource, type ChinaStatus } from "../../src/portfolio/live/china.ts";
import type { CnHttp, CnReply } from "../../src/portfolio/live/cn-http.ts";
import { historyUrl } from "../../src/portfolio/live/cn-history.ts";
import { searchUrl } from "../../src/portfolio/live/cn-search.ts";
import type { ExploreItem } from "../../src/portfolio/live/explore.ts";
import { no } from "../../src/portfolio/refuse.ts";
import { startPortfolioServer } from "../../src/portfolio/server.ts";
import { CHINA_SEARCH_WAIT_MS, PortfolioService } from "../../src/portfolio/service.ts";

const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));
afterEach(() => vi.useRealTimers());

const answered = <T,>(v: T | Refusal): T => { if (isRefusal(v)) throw new Error(`refused: ${v.code} ${v.message}`); return v; };
const refused = (v: unknown): Refusal => { if (!isRefusal(v)) throw new Error(`answered: ${JSON.stringify(v).slice(0, 160)}`); return v; };

/** a real account on stand-ins, with no public source, and China as given */
async function account(o: { china?: ChinaSource; clock?: () => number } = {}) {
  const home = mkdtempSync(join(tmpdir(), "account-china-"));
  homes.push(home);
  const clock = o.clock ?? (() => Date.parse("2026-11-02T02:40:00Z"));
  const svc = await PortfolioService.create({ home, venues: "frontline", real: true, publicMarkets: [], liveDeps: { clock, http: async () => ({ status: 404, body: undefined, text: "" }), price: async () => undefined, mm: (async () => ({ authenticated: true })) as unknown as RunMm }, ...(o.china ? { china: o.china } : {}) } as never);
  await svc.restoring;
  return svc;
}

// ---- the recording stand-in ---------------------------------------------------------------------------------------------------------
const cnRow = (symbol: string, name: string, price: number): ExploreItem => ({
  key: `cn:${symbol}`, kind: "ashare", name, base: symbol, currency: "CNY", price, quoteFrom: "Tencent", tabs: ["china"],
  at: [{ venue: "china", venueName: "Tencent", symbol, connected: false, canTrade: false, public: true, price, quoteFrom: "Tencent" }],
});
const LIVE: ChinaStatus = { state: "live", said: "Tencent · answering", at: "2026-11-02T02:40:00.000Z" };
const readOf = (sort: "volume" | "movers"): ChinaRead => ({ sort, total: 5577, asOf: "2026-11-02T02:40:00.000Z", session: { phase: "trading", lastSession: "2026-11-02" } as ChinaRead["session"], status: LIVE });
const marketOf = (symbol: string): ChinaMarket => ({ symbol, name: symbol, kind: "stock", base: symbol, quote: "CNY", currency: "CNY", open: false, types: [], price: 10, quoteFrom: "Tencent" } as unknown as ChinaMarket);

function stub(o: { rank?: ChinaSource["rank"]; search?: ChinaSource["search"]; quotes?: ChinaSource["quotes"]; history?: ChinaSource["history"] } = {}) {
  const calls = { rank: [] as string[], search: [] as string[], quotes: [] as string[][], history: [] as Array<[string, string]> };
  const rows = Array.from({ length: 25 }, (_, i) => cnRow(String(600000 + i), `A${i}`, 10 + i));
  const source: ChinaSource = {
    async rank(sort) { calls.rank.push(sort); return o.rank ? o.rank(sort) : { items: rows, read: readOf(sort) }; },
    async search(q) { calls.search.push(q); return o.search ? o.search(q) : [cnRow("600519", "贵州茅台", 1392.05)]; },
    async quotes(symbols) { calls.quotes.push([...symbols]); return o.quotes ? o.quotes(symbols) : new Map(symbols.filter((s) => s !== "000002").map((s) => [s, marketOf(s)])); },
    async history(symbol, range) { calls.history.push([symbol, range]); return o.history ? o.history(symbol, range) : no("E_VENUE_UNREACHABLE", { venue: "china", message: "x" }); },
    status: () => LIVE,
  };
  return { source, calls };
}

// ---- Tencent's replies, for the real source (china.test.ts has the measured ones these are cut from) -----------------------------------
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
const bytes = (...parts: Array<string | number[]>): CnReply => ({ status: 200, bytes: new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p as string)))) });
const down: CnReply = { status: 503, bytes: new Uint8Array() };
/** 贵州茅台 in GBK (and GB18030) */
const MOUTAI_GBK = [0xb9, 0xf3, 0xd6, 0xdd, 0xc3, 0xa9, 0xcc, 0xa8];
// the session reply measured 2026-10-31 (a Saturday): every board closed, the index's last time Friday's
const CLOSED = 'v_marketStat="2026-10-31 14:46:10|HK_close_已休市|SH_close_已休市|SZ_close_已休市|KCB_close_已休市|CYB_close_已休市";\n'
  + 'v_sh000001="1~上证指数~000001~3599.02~3651.43~' + "~".repeat(25) + '20261030161400~-52.41";\n';
const row = (code: string, name: string, zxj: string, zdf: string, turnover: string) =>
  ({ code, name, zxj, zdf, turnover, volume: "1", hsl: "1", pe_ttm: "1", zsz: "1", ltsz: "1", zf: "1", lb: "1", state: "", stock_type: "GP-A" });
const VOLUME = JSON.stringify({ code: 0, msg: "ok", data: { rank_list: [row("sh600519", "贵州茅台", "1392.05", "2.81", "2161000"), row("sh688981", "中芯国际", "98.60", "-0.40", "295750")], offset: 0, total: 5577 } });
const days = (dates: string[]) => JSON.stringify({ code: 0, data: { sh600519: { data: dates.map((date) => ({ date, prec: "1354.00", data: ["0930 1363.00 100 136300.00"] })) } } });
/** Friday 2026-10-30 22:30 in New York: Saturday 10:30 in Beijing */
const NY_FRIDAY_EVENING = Date.parse("2026-10-30T22:30:00-04:00");

describe("China in the Account's Markets", () => {
  it("explore tab=china answers the source's ranking with its read, its count and its note", async () => {
    const s = stub();
    const svc = await account({ china: s.source });
    const answer = answered(await svc.explore({ tab: "china", sort: "movers" }));
    expect(s.calls.rank).toEqual(["movers"]);
    expect(answer.tabs).toEqual([{ id: "china", label: "China", count: 5577 }]);
    expect(answer.china).toMatchObject({ sort: "movers", total: 5577, status: { state: "live" } });
    expect(answer.notes).toEqual([CHINA_NOTE]);
    expect([answer.movers, answer.closing, answer.mostTraded, answer.missing]).toEqual([[], [], [], []]);
    // twenty rows at most, whatever the limit; volume when no sort is named
    expect(answer.items).toHaveLength(20);
    expect(answer.items.every((i) => i.key.startsWith("cn:") && i.currency === "CNY" && i.at.every((a) => a.canTrade === false && !("connectTo" in a)))).toBe(true);
    const volume = answered(await svc.explore({ tab: "china", limit: 200 }));
    expect([s.calls.rank.at(-1), volume.china?.sort, volume.items.length]).toEqual(["volume", "volume", 20]);
    expect(answered(await svc.explore({ tab: "china", limit: 5 })).items).toHaveLength(5);
    // never kept here: the source keeps its own reads
    await svc.explore({ tab: "china", sort: "movers" });
    expect(s.calls.rank.filter((x) => x === "movers")).toHaveLength(2);
  });

  it("explore tab=china refuses closing; a source refusal is the answer; a search on it is China's alone", async () => {
    const down = no("E_VENUE_UNREACHABLE", { venue: "china", message: "Tencent is not answering: A shares cannot be read now" });
    const s = stub({ rank: async () => down });
    const svc = await account({ china: s.source });
    expect(refused(await svc.explore({ tab: "china", sort: "closing" }))).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION", message: "China is sorted by volume or movers" });
    expect(s.calls.rank).toEqual([]);
    expect(refused(await svc.explore({ tab: "china" }))).toEqual(down);
    const found = answered(await svc.explore({ tab: "china", q: "茅台" }));
    expect(s.calls.search).toEqual(["茅台"]);
    expect(found.items.map((i) => i.key)).toEqual(["cn:600519"]);
    expect(found.china).toBeUndefined();
  });

  it("All and every dollar tab never hold an A share, nor ask China", async () => {
    const s = stub();
    const svc = await account({ china: s.source });
    for (const tab of [undefined, "all", "stocks", "crypto", "predictions"]) {
      const x = answered(await svc.explore(tab ? { tab } : {}));
      expect(x.items.some((i) => i.key.startsWith("cn:"))).toBe(false);
      expect(x.tabs.some((t) => t.id === "china")).toBe(false);
      expect(x.china).toBeUndefined();
    }
    // a search on a dollar tab asks no China either
    answered(await svc.explore({ tab: "stocks", q: "AAPL" }));
    expect([s.calls.rank, s.calls.search]).toEqual([[], []]);
  });

  it("a search merges China's hits after the dollar rows", async () => {
    const s = stub();
    const svc = await account({ china: s.source });
    const x = answered(await svc.explore({ q: "maotai" }));
    expect(s.calls.search).toEqual(["maotai"]);
    expect(x.items.map((i) => i.key)).toEqual(["cn:600519"]);
    expect(x.missing).toEqual([]);
    // the limit holds over both halves
    const many = stub({ search: async () => Array.from({ length: 30 }, (_, i) => cnRow(String(600100 + i), `B${i}`, 1)) });
    expect(answered(await (await account({ china: many.source })).explore({ q: "b", limit: 7 })).items).toHaveLength(7);
  });

  it("a search whose China half is late answers without it and says so in missing; a refused one too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const s = stub({ search: () => new Promise<never>(() => {}) });
    const svc = await account({ china: s.source });
    const asked = svc.explore({ q: "茅台" });
    await vi.advanceTimersByTimeAsync(CHINA_SEARCH_WAIT_MS + 10);
    const x = answered(await asked);
    expect(x.items.some((i) => i.key.startsWith("cn:"))).toBe(false);
    expect(x.missing).toEqual([expect.objectContaining({ venue: "china", venueName: "Tencent", connected: false, why: "Tencent did not answer in 4 seconds" })]);
    vi.useRealTimers();

    const r = stub({ search: async () => no("E_VENUE_UNREACHABLE", { venue: "china", message: "Tencent's search did not answer" }) });
    const y = answered(await (await account({ china: r.source })).explore({ q: "茅台" }));
    expect(y.missing).toEqual([expect.objectContaining({ venue: "china", venueName: "Tencent", connected: false, why: "Tencent's search did not answer" })]);
  });

  it("a search in Chinese reaches the source as typed", async () => {
    const s = stub();
    await (await account({ china: s.source })).explore({ q: "茅台" });
    expect(s.calls.search).toEqual(["茅台"]);
  });

  it("a search in Chinese or as a STAR code goes to Tencent encoded and comes back decoded from GB18030, STAR listings kept", async () => {
    const hint = bytes('v_hint="sh~600519~', MOUTAI_GBK, '~gzmt~GP-A";');
    const star = bytes('v_hint="sh~688981~\\u4e2d\\u82af\\u56fd\\u9645~zxgj~GP-A-KCB^hk~00981~\\u4e2d\\u82af\\u56fd\\u9645~zxgj~GP";');
    const v = net([["smartbox", (url) => (url.includes("688981") ? star : hint)], ["qt.gtimg.cn", down]]);
    const clock = () => NY_FRIDAY_EVENING;
    const svc = await account({ china: chinaSource({ http: v.http, clock }), clock });
    const moutai = answered(await svc.explore({ q: "茅台" }));
    expect(v.sent[0]).toBe(searchUrl("茅台"));
    expect(v.sent[0]).toContain("q=%E8%8C%85%E5%8F%B0");
    expect(moutai.items.map((i) => [i.key, i.name])).toEqual([["cn:600519", "贵州茅台"]]);
    const smic = answered(await svc.explore({ tab: "china", q: "688981" }));
    expect(smic.items.map((i) => [i.key, i.name])).toEqual([["cn:688981", "中芯国际"]]);
  });

  it("a failed quote read made to price a search leaves China's status as its ranking left it", async () => {
    let quotesUp = true;
    const hint = bytes('v_hint="sh~600519~', MOUTAI_GBK, '~gzmt~GP-A";');
    // the session read (marketStat alone) answers; a read that prices 600519 fails while quotesUp is false
    const v = net([["sort_type=turnover", bytes(VOLUME)], ["smartbox", hint], ["qt.gtimg.cn", (url) => (url.includes("sh600519") && !quotesUp ? down : bytes(CLOSED))]]);
    const clock = () => NY_FRIDAY_EVENING;
    const china = chinaSource({ http: v.http, clock });
    const svc = await account({ china, clock });
    expect(answered(await svc.explore({ tab: "china" })).china?.status.state).toBe("live");
    quotesUp = false;
    const found = answered(await svc.explore({ q: "茅台" }));
    expect(found.items.map((i) => [i.key, i.price])).toEqual([["cn:600519", undefined]]);
    expect(china.status().state).toBe("live");
    expect(answered(await svc.explore({ tab: "china" })).china?.status.state).toBe("live");
    // a quote read asked for itself still says what it met
    const q = answered(await svc.quotes([{ venue: "china", symbol: "600519" }]));
    expect(q[0]!.refusal?.code).toBe("E_VENUE_UNREACHABLE");
    expect(china.status().state).toBe("unavailable");
  });

  it("explore tab=china on a Beijing Saturday read on New York's Friday evening: the session closed, Tencent answering, never stale", async () => {
    const v = net([["sort_type=turnover", bytes(VOLUME)], ["qt.gtimg.cn", bytes(CLOSED)]]);
    const clock = () => NY_FRIDAY_EVENING;
    const svc = await account({ china: chinaSource({ http: v.http, clock }), clock });
    const x = answered(await svc.explore({ tab: "china" }));
    expect(x.china).toMatchObject({ session: { phase: "closed", lastSession: "2026-10-30" }, status: { state: "live" } });
    expect(x.items.map((i) => i.key)).toEqual(["cn:600519", "cn:688981"]);
  });
});

describe("China's quotes and history in the Account", () => {
  it("quotes: China's pairs go to the source in one call, the others as before", async () => {
    const s = stub();
    const svc = await account({ china: s.source });
    const got = answered(await svc.quotes([{ venue: "china", symbol: "600519" }, { venue: "nowhere", symbol: "BTC/USDT" }, { venue: "china", symbol: "688981" }, { venue: "china", symbol: "60051" }, { venue: "china", symbol: "000002" }]));
    expect(s.calls.quotes).toEqual([["600519", "688981", "000002"]]);
    expect(got.map((r) => [r.venue, r.symbol, r.market ? "market" : r.refusal!.message])).toEqual([
      ["china", "600519", "market"],
      ["nowhere", "BTC/USDT", expect.not.stringContaining("A share")],
      ["china", "688981", "market"],
      ["china", "60051", "an A share is its six digits"],
      ["china", "000002", "no A-share quote for 000002"],
    ]);
    expect((got[0]!.market as ChinaMarket).currency).toBe("CNY");
    // the source's refusal is each China pair's
    const refusing = stub({ quotes: async () => no("E_VENUE_UNREACHABLE", { venue: "china", message: "Tencent is not answering: A shares cannot be read now" }) });
    const r = answered(await (await account({ china: refusing.source })).quotes([{ venue: "china", symbol: "600519" }]));
    expect(r[0]!.refusal).toMatchObject({ code: "E_VENUE_UNREACHABLE", message: "Tencent is not answering: A shares cannot be read now" });
    // the twelve-pair limit stands
    expect(refused(await svc.quotes(Array.from({ length: 13 }, (_, i) => ({ venue: "china", symbol: String(600000 + i) })))).code).toBe("E_ACCOUNT_BAD_ACTION");
  });

  it("candles venue china: by range, never by before; Tencent's last session on a Beijing Saturday", async () => {
    const history: ChinaHistory = { venue: "china", venueName: "Tencent", symbol: "600519", range: "1D", sessions: [{ date: "2026-10-30", prec: 1354, price: [1363], amount: [136300] }], source: "Tencent" };
    const s = stub({ history: async () => history });
    const svc = await account({ china: s.source, clock: () => NY_FRIDAY_EVENING });
    expect(answered(await svc.candles("china", "600519", "5m", { range: "1D" }))).toEqual(history);
    expect(s.calls.history).toEqual([["600519", "1D"]]);
    expect(refused(await svc.candles("china", "600519", "1h", { before: String(NY_FRIDAY_EVENING) }))).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION", message: "an A share's history is read by range" });
    expect(refused(await svc.candles("china", "600519", "1h"))).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION", message: "a range is one of 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX" });
    expect(refused(await svc.candles("china", "600519", "", { range: "10Y" })).code).toBe("E_ACCOUNT_BAD_ACTION");
    expect(s.calls.history).toHaveLength(1);
  });

  it("1D and 5D on a Beijing Saturday read on New York's Friday evening are Tencent's last sessions, not New York's window", async () => {
    // Tencent's reply: newest first, Friday's on top, and a sixth day the 5D read leaves out
    const v = net([["day/query", bytes(days(["20261030", "20261029", "20261028", "20261027", "20261026", "20261023"]))]]);
    const clock = () => NY_FRIDAY_EVENING;
    const svc = await account({ china: chinaSource({ http: v.http, clock }), clock });
    const one = answered(await svc.candles("china", "600519", "", { range: "1D" }));
    expect(v.sent).toEqual([historyUrl("sh600519", "1D")]);
    expect("sessions" in one && one.sessions.map((d) => d.date)).toEqual(["2026-10-30"]);
    const five = answered(await svc.candles("china", "600519", "", { range: "5D" }));
    expect("sessions" in five && five.sessions.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    // 1D and 5D are one read of Tencent's, kept: nothing else asked
    expect(v.sent).toHaveLength(1);
  });

  it("without a China source, China refuses in its own words and nothing asks Tencent", async () => {
    const svc = await account();
    const said = { code: "E_ACCOUNT_BAD_ACTION", message: "China is not read on this account" };
    expect(refused(await svc.explore({ tab: "china" }))).toMatchObject(said);
    expect(refused(await svc.candles("china", "600519", "", { range: "1D" }))).toMatchObject(said);
    expect(answered(await svc.quotes([{ venue: "china", symbol: "600519" }]))[0]!.refusal).toMatchObject(said);
    // a search on All answers without China, and says nothing missing of it
    const x = answered(await svc.explore({ q: "茅台" }));
    expect(x.items).toEqual([]);
    expect(x.missing.some((m) => m.venue === "china")).toBe(false);
  });
});

describe("China over the Account's HTTP", () => {
  it("explore, quotes and candles answer China's shapes; a refusal is a 409", async () => {
    const history: ChinaHistory = { venue: "china", venueName: "Tencent", symbol: "600519", range: "5D", sessions: [], source: "Tencent" };
    const s = stub({ history: async () => history });
    const server = await startPortfolioServer({ port: 0, service: await account({ china: s.source }) });
    try {
      const get = async (path: string) => { const r = await fetch(`${server.url}${path}`); return { status: r.status, body: (await r.json()) as Record<string, any> }; };
      const tab = await get("/api/account/explore?tab=china&sort=movers&limit=20");
      expect([tab.status, tab.body.ok, tab.body.tabs, tab.body.items.length, tab.body.china.sort]).toEqual([200, true, [{ id: "china", label: "China", count: 5577 }], 20, "movers"]);
      expect((await get("/api/account/explore?tab=china&sort=closing")).status).toBe(409);
      const q = await get("/api/account/quotes?pairs=china|600519,china|abc");
      expect(q.body.quotes.map((r: { market?: unknown; refusal?: { message: string } }) => r.market ? "market" : r.refusal!.message)).toEqual(["market", "an A share is its six digits"]);
      expect((await get("/api/account/candles?venue=china&symbol=600519&range=5D")).body).toEqual({ ok: true, ...history });
      expect((await get("/api/account/candles?venue=china&symbol=600519&interval=1h&before=1700000000000")).body.refusal.message).toBe("an A share's history is read by range");
    } finally {
      await server.close();
    }
  });
});
