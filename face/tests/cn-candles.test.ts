import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { CN_RANGES, createCnCandles, gridIndex, parseDayQuery, parseKline, registerCnCandlesRoute, type CnCandles } from "../src/cn-candles.ts";
import type { QuoteIdentity } from "../src/quote-types.ts";

const MOUTAI: QuoteIdentity = { id: "cn:600519", market: "cn", symbol: "600519" };
const day = (date: string, prec: string, rows: string[]) => ({ date, prec, data: rows });
const DAYQ = JSON.stringify({ code: 0, data: { sh600519: { data: [
  day("20261030", "1354.00", ["0930 1363.00 1534 209084200.00", "0932 1359.61 2839 386191243.54", "1130 1380.00 30000 4100000000.00",
    "1300 1381.00 30500 4170000000.00", "1500 1392.05 59927 8257380000.00", "1505 1392.05 59944 8259708303.78"]),
  day("20261029", "1350.00", ["0930 1351.00 100 13510000.00"]) ] } } });
const kline = (interval: string, rows: string[][]) => JSON.stringify({ code: 0, data: { sh600519: { [`qfq${interval}`]: rows } } });
const bar = (date: string, c = "1392.050") => [date, "1325.400", c, "1393.370", "1322.600", "221992.000"];

test("gridIndex: 09:30–11:30 are 0–120, 13:00–15:00 are 121–241, nothing else", () => {
  assert.deepEqual(["0930", "1130", "1131", "1259", "1300", "1500", "1501", "0929", "xx"].map(gridIndex), [0, 120, null, null, 121, 241, null, null, null]);
});

test("parseDayQuery: oldest first, gaps repeat the last price with nothing traded, points past 15:00 dropped", () => {
  const [d29, d30] = parseDayQuery(DAYQ, "sh600519");
  assert.equal(d29!.date, "2026-10-29");
  assert.equal(d29!.price.length, 1);
  assert.equal(d30!.date, "2026-10-30");
  assert.equal(d30!.prec, 1354);
  assert.equal(d30!.price.length, 242);
  assert.equal(d30!.price[1], 1363);
  assert.equal(d30!.amount[1], 0);
  assert.equal(d30!.amount[2], 177_107_043.54);
  assert.equal(d30!.price[241], 1392.05);
  assert.throws(() => parseDayQuery("<html>busy</html>", "sh600519"));
  assert.throws(() => parseDayQuery(JSON.stringify({ code: 0, data: { sh600519: { data: [day("20261030", "1354", ["0930 1 10 100", "0931 1 5 50"])] } } }), "sh600519"));
});

test("parseKline: forward-adjusted rows to bars stamped 15:00 Beijing, for day, week and month", () => {
  assert.deepEqual(parseKline(kline("week", [bar("2026-10-30")]), "sh600519", "week"),
    [{ t: Date.parse("2026-10-30T07:00:00Z"), o: 1325.4, h: 1393.37, l: 1322.6, c: 1392.05 }]);
  assert.throws(() => parseKline(kline("day", [bar("2026-10-30")]), "sh600519", "week"));
});

test("each range asks Tencent for its own read", async () => {
  const want: Record<string, string> = {
    "1D": "https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh600519",
    "5D": "https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh600519",
    "1M": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,22,qfq",
    "3M": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,66,qfq",
    "6M": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,132,qfq",
    YTD: "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,260,qfq",
    "1Y": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,250,qfq",
    "5Y": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,week,,,260,qfq",
    MAX: "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,month,,,500,qfq",
  };
  for (const range of CN_RANGES) {
    const urls: string[] = [];
    const candles = createCnCandles({ fetch: async (url) => {
      urls.push(url.href);
      const interval = /,(day|week|month),/.exec(url.href)?.[1] ?? "day";
      return new Response(url.href.includes("day/query") ? DAYQ : kline(interval, [bar("2025-12-31", "1300"), bar("2026-01-05"), bar("2026-10-30")]));
    } });
    const answer = await candles(MOUTAI, range);
    assert.deepEqual(urls, [want[range]], range);
    assert.equal(answer.range, range);
    if (answer.range === "1D") assert.deepEqual(answer.sessions.map((s) => s.date), ["2026-10-30"]);
    else if (answer.range === "5D") assert.deepEqual(answer.sessions.map((s) => s.date), ["2026-10-29", "2026-10-30"]);
    else if (answer.range === "YTD") assert.equal(answer.candles.length, 2, "bars from Jan 1 of the last bar's year");
    else assert.equal(answer.candles.length, 3, range);
  }
});

test("a share with fewer than five sessions answers the sessions it has", async () => {
  const one = JSON.stringify({ code: 0, data: { sh688825: { data: [day("20261030", "40.00", ["0930 41.00 10 410.00"])] } } });
  const answer = await createCnCandles({ fetch: async () => new Response(one) })({ id: "cn:688825", market: "cn", symbol: "688825" }, "5D");
  assert.ok(answer.range === "5D" && answer.sessions.length === 1);
});

function routeWith(candles: CnCandles): WebRoute {
  const routes: WebRoute[] = [];
  registerCnCandlesRoute({ register: (route) => routes.push(route) }, candles);
  assert.equal(routes[0]?.path, "/data/cn/candles");
  return routes[0]!;
}
async function call(route: WebRoute, overrides: Partial<IncomingMessage> = {}) {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; }, end(body: string) { out.body = body; } } as unknown as ServerResponse;
  const req = { method: "GET", url: "/data/cn/candles?id=cn:600519&range=1D", headers: { host: "127.0.0.1:3090" }, ...overrides } as IncomingMessage;
  await route.handler(req, res);
  return out;
}

test("the route: fence, GET only, a cn id and a known range, 503 with a fixed body on failure", async () => {
  let asked: [string, string] | null = null;
  const ok = routeWith(async (asset, range) => { asked = [asset.id, range]; return { ok: true, range: "1D", sessions: [] } as never; });
  assert.equal((await call(ok, { headers: { host: "evil.example" } })).status, 403);
  assert.equal((await call(ok, { method: "POST" })).status, 405);
  for (const url of ["/data/cn/candles?id=us:AAPL&range=1D", "/data/cn/candles?id=cn:12345&range=1D", "/data/cn/candles?id=cn:600519&range=2D",
    "/data/cn/candles?id=cn:600519&range=1D&range=5D", "/data/cn/candles?id=cn:600519&range=1D&x=1", "/data/cn/candles?id=cn:200002&range=1D"]) {
    const bad = await call(ok, { url });
    assert.equal(bad.status, 400, url);
    assert.equal(bad.body, '{"ok":false,"error":"invalid candles request"}');
  }
  assert.equal(asked, null);
  assert.equal((await call(ok, { url: "/data/cn/candles?id=cn%3A600519&range=5D" })).status, 200);
  assert.deepEqual(asked, ["cn:600519", "5D"]);
  const failed = await call(routeWith(async () => { throw new Error("private"); }));
  assert.equal(failed.status, 503);
  assert.equal(failed.body, '{"ok":false,"error":"history unavailable"}');
});

test("answers are kept 30 s for 1D and 5D, 600 s for bars; failures never", async () => {
  let clock = 0, calls = 0, fail = false;
  const candles = createCnCandles({ now: () => clock, fetch: async (url) => {
    calls++;
    if (fail) return new Response("<html>busy</html>");
    return new Response(url.href.includes("day/query") ? DAYQ : kline("day", [bar("2026-10-30")]));
  } });
  await candles(MOUTAI, "1D"); clock += 29_000; await candles(MOUTAI, "1D");
  assert.equal(calls, 1);
  clock += 2_000; await candles(MOUTAI, "1D");
  assert.equal(calls, 2);
  await candles(MOUTAI, "1M"); clock += 599_000; await candles(MOUTAI, "1M");
  assert.equal(calls, 3);
  fail = true;
  await assert.rejects(candles(MOUTAI, "3M"));
  await assert.rejects(candles(MOUTAI, "3M"));
  assert.equal(calls, 5);
});

test("CN_RANGES is the client's CANDLE_RANGES", async () => {
  const { CANDLE_RANGES } = await import("../client/js/host/market-view.js");
  assert.deepEqual([...CN_RANGES], CANDLE_RANGES);
});
