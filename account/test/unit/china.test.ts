import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { chinaSource, type ChinaMarket } from "../../src/portfolio/live/china.ts";
import { CN_HOSTS, type CnHttp, type CnReply } from "../../src/portfolio/live/cn-http.ts";
import { historyUrl } from "../../src/portfolio/live/cn-history.ts";
import { rankUrl } from "../../src/portfolio/live/cn-rank.ts";
import { searchUrl } from "../../src/portfolio/live/cn-search.ts";

// ---- the network: a CnHttp stand-in answering by URL (the first route whose key the URL contains), recording each URL ----------------
type Route = [string, CnReply | ((url: string) => CnReply)];
const everySent: string[] = [];
function net(routes: Route[]) {
  const sent: string[] = [];
  const http: CnHttp = async (url) => {
    sent.push(url);
    everySent.push(url);
    const hit = routes.find(([k]) => url.includes(k));
    if (!hit) return { status: 404, bytes: new Uint8Array() };
    return typeof hit[1] === "function" ? hit[1](url) : hit[1];
  };
  return { http, sent };
}
const bytes = (...parts: Array<string | number[]>): CnReply =>
  ({ status: 200, bytes: new Uint8Array(Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p) : Buffer.from(p))))) });
const down: CnReply = { status: 503, bytes: new Uint8Array(Buffer.from("<html>busy, from 203.0.113.9</html>")) };
const answered = <T,>(v: T | Refusal): T => { if (isRefusal(v)) throw new Error(`refused: ${v.message}`); return v; };
const refused = (v: unknown): Refusal => { if (!isRefusal(v)) throw new Error("answered"); return v; };

// ---- the replies -------------------------------------------------------------------------------------------------------------------
/** 贵州茅台 in GBK (and GB18030): B9F3 D6DD C3A9 CCA8 */
const MOUTAI_GBK = [0xb9, 0xf3, 0xd6, 0xdd, 0xc3, 0xa9, 0xcc, 0xa8];
/** 15:00 Beijing, Saturday 2026-10-31; 10:40 Beijing, Monday 2026-11-02 */
const SAT_15 = Date.parse("2026-10-31T07:00:00Z"), MON_1040 = Date.parse("2026-11-02T02:40:00Z");
const SESSION_URL = "https://qt.gtimg.cn/q=marketStat,sh000001";
// the session reply measured 2026-10-31 (a Saturday), cut to the fields read (cn-session.test.ts)
const CLOSED = 'v_marketStat="2026-10-31 14:46:10|HK_close_已休市|SH_close_已休市|SZ_close_已休市|KCB_close_已休市|CYB_close_已休市";\n'
  + 'v_sh000001="1~上证指数~000001~3599.02~3651.43~' + "~".repeat(25) + '20261030161400~-52.41";\n';
/** One Tencent quote line, `v_<code>="…";`, its 88 fields joined by `~` (cn-quotes.test.ts) */
function line(code: string, at: Record<number, string>): string {
  return `v_${code}="${Array.from({ length: 88 }, (_, i) => at[i] ?? "").join("~")}";\n`;
}
const OPEN = 'v_marketStat="2026-11-02 10:40:00|SH_open_x|SZ_open_x";\n' + line("sh000001", { 1: "INDEX", 2: "000001", 3: "3600.00", 30: "20261102104000" });
const MOUTAI = (at: string) => line("sh600519", { 1: "@NAME@", 2: "600519", 3: "1392.05", 4: "1354.00", 5: "1363.00", 6: "59927", 30: at,
  33: "1393.37", 34: "1352.98", 37: "825738", 38: "0.48", 39: "21.18", 43: "2.98", 45: "17401.76", 47: "1489.40", 48: "1218.60" }).split("@NAME@");
const PINGAN = line("sz000001", { 1: "PINGAN", 2: "000001", 3: "11.64", 4: "11.50", 6: "1864245", 30: "20261102104000", 37: "217000" });
const SMIC = line("sh688981", { 1: "SMIC", 2: "688981", 3: "98.60", 4: "99.00", 6: "29998989", 30: "20261102104000", 37: "295750" });
/** a qt reply: the session first, then 600519 (its name in GBK), then the rest */
const qt = (session: string, moutaiAt: string, ...rest: string[]): CnReply => {
  const [head, tail] = MOUTAI(moutaiAt);
  return bytes(session, head!, MOUTAI_GBK, tail!, ...rest);
};

const row = (code: string, name: string, zxj: string, zdf: string, turnover: string, state = "") =>
  ({ code, name, zxj, zdf, turnover, volume: "1", hsl: "1", pe_ttm: "1", zsz: "1", ltsz: "1", zf: "1", lb: "1", state, stock_type: "GP-A" });
const rankPage = (rows: object[], total = 5577) => JSON.stringify({ code: 0, msg: "ok", data: { rank_list: rows, offset: 0, total } });
// a STAR (sh688981), a ChiNext (sz300750), a Beijing (bj920306, halted: a non-empty state) share, and a Hong Kong row that is no A share
const VOLUME = rankPage([row("sh600519", "贵州茅台", "1392.05", "2.81", "2161000"), row("sh688981", "中芯国际", "98.60", "-0.40", "295750"),
  row("sz300750", "宁德时代", "232.92", "0.50", "120000"), row("bj920306", "天元重工", "", "0.00", "0", "停牌"), row("hk00700", "腾讯控股", "1", "1", "1")]);
const GAINERS = rankPage([row("sz300030", "阳普医疗", "7.31", "20.03", "35402")]);
const LOSERS = rankPage([row("bj920306", "天元重工", "7.58", "-23.28", "16000")]);
const rankRoutes = (rank: Route[1] = bytes(VOLUME)): Route[] =>
  [["sort_type=turnover", rank], ["priceRatio&direct=down", bytes(GAINERS)], ["priceRatio&direct=up", bytes(LOSERS)], ["qt.gtimg.cn", bytes(CLOSED)]];

const day = (date: string, prec: string, rows: string[]) => ({ date, prec, data: rows });
const days = (dates: string[]) => JSON.stringify({ code: 0, data: { sh600519: { data: dates.map((d) => day(d, "1354.00", ["0930 1363.00 100 136300.00"])) } } });
const kline = (interval: string, rows: string[][]) => JSON.stringify({ code: 0, data: { sh600519: { [`qfq${interval}`]: rows } } });
const bar = (date: string) => [date, "1325.400", "1392.050", "1393.370", "1322.600", "221992.000"];

describe("the China source", () => {
  it("volume asks the ranking once by turnover; movers twice by priceRatio, merged; each with the session", async () => {
    const v = net(rankRoutes());
    const r = answered(await chinaSource({ http: v.http, clock: () => SAT_15 }).rank("volume"));
    expect([...v.sent].sort()).toEqual([rankUrl("turnover", "down", 20), SESSION_URL].sort());
    expect(r.items.map((i) => i.key)).toEqual(["cn:600519", "cn:688981", "cn:300750", "cn:920306"]);
    expect(r.read).toMatchObject({ sort: "volume", total: 5577, asOf: new Date(SAT_15).toISOString(),
      session: { phase: "closed", lastSession: "2026-10-30" }, status: { state: "live", said: "Tencent · answering" } });

    const m = net(rankRoutes());
    const movers = answered(await chinaSource({ http: m.http, clock: () => SAT_15 }).rank("movers"));
    expect([...m.sent].sort()).toEqual([rankUrl("priceRatio", "down", 20), rankUrl("priceRatio", "up", 20), SESSION_URL].sort());
    expect(movers.items.map((i) => i.key)).toEqual(["cn:920306", "cn:300030"]);
    expect(movers.read).toMatchObject({ sort: "movers", total: 5577, status: { state: "live" } });
  });

  it("a China row is view-only, in CNY, and only in China", async () => {
    const { http } = net(rankRoutes());
    const { items } = answered(await chinaSource({ http, clock: () => SAT_15 }).rank("volume"));
    expect(items[0]).toEqual({
      key: "cn:600519", kind: "ashare", name: "贵州茅台", base: "600519", currency: "CNY", price: 1392.05, changePct24h: 2.81,
      turnoverCny: 21_610_000_000, quoteFrom: "Tencent", tabs: ["china"],
      at: [{ venue: "china", venueName: "Tencent", symbol: "600519", connected: false, canTrade: false, public: true, price: 1392.05, quoteFrom: "Tencent" }],
    });
    // the halted share is kept, unpriced
    expect(items[3]).toMatchObject({ key: "cn:920306", changePct24h: 0, turnoverCny: 0 });
    expect(items[3]!.price).toBeUndefined();
    for (const i of items) {
      expect(i.tabs).toEqual(["china"]);
      expect(i.currency).toBe("CNY");
      expect(i.volumeUsd24h).toBeUndefined();
      for (const a of i.at) {
        expect(a.canTrade).toBe(false);
        expect(a).not.toHaveProperty("connectTo");
        expect(a).not.toHaveProperty("connector");
      }
    }
  });

  it("a ranking is kept 10 s per sort, shared by concurrent asks; a failure is never kept", async () => {
    let t = SAT_15;
    const { http, sent } = net(rankRoutes());
    const china = chinaSource({ http, clock: () => t });
    const asked = (k: string) => sent.filter((u) => u.includes(k)).length;
    const [a, b] = await Promise.all([china.rank("volume"), china.rank("volume")]);
    expect(a).toBe(b);
    expect(asked("sort_type=turnover")).toBe(1);
    t += 9_000;
    expect(await china.rank("volume")).toBe(a);
    expect(asked("sort_type=turnover")).toBe(1);
    await china.rank("movers");
    expect(asked("priceRatio")).toBe(2);
    t += 2_000;
    await china.rank("volume");
    expect(asked("sort_type=turnover")).toBe(2);

    let fail = true;
    const f = net(rankRoutes(() => (fail ? down : bytes(VOLUME))));
    const flaky = chinaSource({ http: f.http, clock: () => SAT_15 });
    refused(await flaky.rank("volume"));
    fail = false;
    expect(answered(await flaky.rank("volume")).items.length).toBe(4);
    expect(f.sent.filter((u) => u.includes("sort_type=turnover")).length).toBe(2);
  });

  it("a failed ranking answers the last good one for ten minutes, flagged stale, then refuses", async () => {
    let t = SAT_15, fail = false;
    const { http } = net(rankRoutes(() => (fail ? down : bytes(VOLUME))));
    const china = chinaSource({ http, clock: () => t });
    expect(china.status()).toEqual({ state: "unavailable", said: "Tencent · not read yet" });
    const good = answered(await china.rank("volume"));
    expect(china.status().state).toBe("live");

    fail = true;
    t = SAT_15 + 11_000;
    const stale = answered(await china.rank("volume"));
    expect(stale.items).toEqual(good.items);
    expect(stale.read.status).toMatchObject({ state: "stale", said: "Tencent did not answer · China as of 15:00 Beijing" });
    expect(china.status().state).toBe("stale");

    t = SAT_15 + 601_000;
    const no = refused(await china.rank("volume"));
    expect(no).toMatchObject({ code: "E_VENUE_UNREACHABLE", venue: "china", message: "Tencent is not answering: A shares cannot be read now" });
    expect(JSON.stringify(no)).not.toMatch(/busy|203\.0|http|503/);
    expect(china.status()).toEqual({ state: "unavailable", said: "Tencent is not answering: A shares cannot be read now" });
  });

  it("quotes: one qt GET for the session and every code, GBK, the facts and the phase", async () => {
    const { http, sent } = net([["qt.gtimg.cn", qt(OPEN, "20261102103400", PINGAN)]]);
    const china = chinaSource({ http, clock: () => MON_1040 });
    const got = answered(await china.quotes(["600519", "000001"]));
    expect(sent).toEqual(["https://qt.gtimg.cn/q=marketStat,sh000001,sh600519,sz000001"]);
    expect([...got.keys()]).toEqual(["600519", "000001"]);
    const m: ChinaMarket = got.get("600519")!;
    expect(m).toMatchObject({ symbol: "600519", name: "贵州茅台", kind: "stock", base: "600519", quote: "CNY", currency: "CNY", open: false, types: [],
      price: 1392.05, quoteAt: "2026-11-02T10:34:00+08:00", quoteFrom: "Tencent", change24h: 38.05, changePct24h: 2.81, session: { open: true } });
    expect(m.cn).toEqual({ prevClose: 1354, open: 1363, high: 1393.37, low: 1352.98, turnover: 8_257_380_000, turnoverRate: 0.48,
      marketCap: 1_740_176_000_000, peTtm: 21.18, limitUp: 1489.4, limitDown: 1218.6, volume: 5_992_700, amplitude: 2.98,
      lastSession: "2026-11-02", phase: "trading", quoteStatus: "delayed" });
    expect(got.get("000001")!.cn.quoteStatus).toBe("live");
    expect(china.status().state).toBe("live");

    // kept 5 s
    await china.quotes(["000001", "600519"]);
    expect(sent.length).toBe(1);
  });

  it("quotes: a STAR share's volume is in shares, a main-board share's in lots ×100", async () => {
    const { http } = net([["qt.gtimg.cn", qt(OPEN, "20261102104000", SMIC)]]);
    const got = answered(await chinaSource({ http, clock: () => MON_1040 }).quotes(["688981", "600519"]));
    expect(got.get("688981")!.cn.volume).toBe(29_998_989);
    expect(got.get("600519")!.cn.volume).toBe(5_992_700);
  });

  it("quotes: a code Tencent does not file is never asked; more than 30 is refused", async () => {
    const { http, sent } = net([["qt.gtimg.cn", qt(OPEN, "20261102104000")]]);
    const china = chinaSource({ http, clock: () => MON_1040 });
    const got = answered(await china.quotes(["600519", "123456"]));
    expect(sent).toEqual(["https://qt.gtimg.cn/q=marketStat,sh000001,sh600519"]);
    expect([...got.keys()]).toEqual(["600519"]);
    const many = Array.from({ length: 31 }, (_, i) => String(600000 + i));
    expect(refused(await china.quotes(many)).code).toBe("E_ACCOUNT_BAD_ACTION");
    expect(sent.length).toBe(1);

    const failing = chinaSource({ http: net([["qt.gtimg.cn", down]]).http, clock: () => MON_1040 });
    expect(refused(await failing.quotes(["600519"]))).toMatchObject({ code: "E_VENUE_UNREACHABLE", message: "Tencent is not answering: A shares cannot be read now" });
    expect(failing.status().state).toBe("unavailable");
  });

  it("history: 1D the last session, 5D the last five, from day/query; 1M–MAX forward-adjusted bars", async () => {
    const { http, sent } = net([
      ["day/query", bytes(days(["20261030", "20261029", "20261028", "20261027", "20261026", "20261023"]))],
      ["week", bytes(kline("week", [bar("2026-10-30")]))],
      [",day,", bytes(kline("day", [bar("2025-12-31"), bar("2026-01-02"), bar("2026-10-30")]))],
    ]);
    const china = chinaSource({ http, clock: () => SAT_15 });
    const one = answered(await china.history("600519", "1D"));
    const five = answered(await china.history("600519", "5D"));
    if (!("sessions" in one) || !("sessions" in five)) throw new Error("no sessions");
    expect(one).toMatchObject({ venue: "china", venueName: "Tencent", symbol: "600519", range: "1D", source: "Tencent" });
    expect(one.sessions.map((s) => s.date)).toEqual(["2026-10-30"]);
    expect(five.sessions.map((s) => s.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(sent).toEqual([historyUrl("sh600519", "1D")]); // 1D and 5D are one read

    const weekly = answered(await china.history("600519", "5Y"));
    expect(sent.at(-1)).toBe(historyUrl("sh600519", "5Y"));
    expect(weekly).toMatchObject({ venue: "china", venueName: "Tencent", symbol: "600519", range: "5Y", source: "Tencent",
      adjustment: "forward-adjusted (前复权)", candles: [{ t: Date.parse("2026-10-30T07:00:00Z"), o: 1325.4, h: 1393.37, l: 1322.6, c: 1392.05 }] });

    const ytd = answered(await china.history("600519", "YTD"));
    if (!("candles" in ytd)) throw new Error("no candles");
    expect(ytd.candles.map((c) => c.t)).toEqual([Date.parse("2026-01-02T07:00:00Z"), Date.parse("2026-10-30T07:00:00Z")]);

    expect(refused(await china.history("60051", "1D")).code).toBe("E_ACCOUNT_BAD_ACTION");
    const failing = chinaSource({ http: net([["gtimg", down]]).http, clock: () => SAT_15 });
    expect(refused(await failing.history("600519", "1M"))).toMatchObject({ code: "E_VENUE_UNREACHABLE", message: "Tencent is not answering: A shares cannot be read now" });
  });

  it("history: a share with fewer than five sessions answers the sessions it has", async () => {
    const { http } = net([["day/query", bytes(days(["20261030", "20261029"]))]]);
    const five = answered(await chinaSource({ http, clock: () => SAT_15 }).history("600519", "5D"));
    if (!("sessions" in five)) throw new Error("no sessions");
    expect(five.sessions.map((s) => s.date)).toEqual(["2026-10-29", "2026-10-30"]);
  });

  it("search: smartbox hits priced by one quote read; a failed quote read leaves them unpriced", async () => {
    // the smartbox reply is GB18030: 贵州茅台 in its bytes
    const hint = bytes('v_hint="sh~600519~', MOUTAI_GBK, '~gzmt~GP-A";');
    const { http, sent } = net([["smartbox", hint], ["qt.gtimg.cn", qt(CLOSED, "20261030150003")]]);
    const items = answered(await chinaSource({ http, clock: () => SAT_15 }).search("茅台"));
    expect(sent[0]).toBe(searchUrl("茅台"));
    expect(sent[1]).toBe("https://qt.gtimg.cn/q=marketStat,sh000001,sh600519");
    expect(items).toEqual([{ key: "cn:600519", kind: "ashare", name: "贵州茅台", base: "600519", currency: "CNY", price: 1392.05, changePct24h: 2.81,
      turnoverCny: 8_257_380_000, quoteFrom: "Tencent", tabs: ["china"],
      at: [{ venue: "china", venueName: "Tencent", symbol: "600519", connected: false, canTrade: false, public: true, price: 1392.05, quoteFrom: "Tencent" }] }]);

    const unpriced = net([["smartbox", hint], ["qt.gtimg.cn", down]]);
    const bare = answered(await chinaSource({ http: unpriced.http, clock: () => SAT_15 }).search("茅台"));
    expect(bare.map((i) => i.key)).toEqual(["cn:600519"]);
    expect(bare[0]!.price).toBeUndefined();
    expect(bare[0]!.at[0]!.price).toBeUndefined();
  });

  it("search: a STAR listing is found by its code", async () => {
    const hint = bytes('v_hint="sh~688981~\\u4e2d\\u82af\\u56fd\\u9645~zxgj~GP-A-KCB^hk~00981~\\u4e2d\\u82af\\u56fd\\u9645~zxgj~GP";');
    const { http } = net([["smartbox", hint], ["qt.gtimg.cn", bytes(OPEN, SMIC)]]);
    const items = answered(await chinaSource({ http, clock: () => MON_1040 }).search("688981"));
    expect(items.map((i) => [i.key, i.name, i.price])).toEqual([["cn:688981", "中芯国际", 98.6]]);
  });

  it("search: kept 60 s per query; an outage is not kept", async () => {
    let t = SAT_15;
    const hint = bytes('v_hint="sh~600519~', MOUTAI_GBK, '~gzmt~GP-A";');
    const { http, sent } = net([["smartbox", hint], ["qt.gtimg.cn", qt(CLOSED, "20261030150003")]]);
    const china = chinaSource({ http, clock: () => t });
    const boxed = () => sent.filter((u) => u.includes("smartbox")).length;
    await china.search("茅台");
    await china.search(" 茅台 ");
    expect(sent.length).toBe(2);
    t += 10_000; // the hits are kept, their prices are asked again
    await china.search("茅台");
    expect([boxed(), sent.length]).toEqual([1, 3]);
    t += 51_000;
    await china.search("茅台");
    expect(boxed()).toBe(2);

    let fail = true;
    const f = net([["smartbox", () => (fail ? down : hint)], ["qt.gtimg.cn", qt(CLOSED, "20261030150003")]]);
    const flaky = chinaSource({ http: f.http, clock: () => SAT_15 });
    expect(refused(await flaky.search("茅台"))).toMatchObject({ code: "E_VENUE_UNREACHABLE", venue: "china", message: "Tencent's search did not answer" });
    fail = false;
    expect(answered(await flaky.search("茅台")).length).toBe(1);
    expect(f.sent.filter((u) => u.includes("smartbox")).length).toBe(2);
  });

  it("search: at most 32 searches are asked of Tencent at once", async () => {
    const http: CnHttp = (url) => { everySent.push(url); return new Promise<CnReply>(() => {}); };
    const china = chinaSource({ http, clock: () => SAT_15 });
    for (let i = 0; i < 32; i++) void china.search(`q${i}`);
    void china.search("q0"); // the same query joins its flight
    expect(refused(await china.search("q32"))).toMatchObject({ code: "E_ACCOUNT_BAD_ACTION", message: "too many A-share searches at once" });
  });

  it("no request leaves the four hosts", () => {
    expect(everySent.length).toBeGreaterThan(20);
    for (const url of everySent) {
      const u = new URL(url);
      expect(u.protocol, url).toBe("https:");
      expect(CN_HOSTS, url).toContain(u.hostname);
    }
  });
});
