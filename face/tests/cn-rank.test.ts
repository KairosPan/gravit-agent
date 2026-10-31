import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { createCnRank, mergeMovers, parseTencentRank, registerCnRankRoute, RANK_TTL_MS, type CnRank } from "../src/cn-rank.ts";

const CLOSED = 'v_marketStat="2026-10-31 14:46:10|SH_close_x|SZ_close_x";\n'
  + 'v_sh000001="1~上证指数~000001~3599.02~3651.43~' + "~".repeat(25) + '20261030161400~-52.41";\n';
const SAT_10 = Date.parse("2026-10-31T02:00:00Z");
const row = (code: string, name: string, zxj: string, zdf: string, turnover: string) =>
  ({ code, name, zxj, zdf, turnover, volume: "1", hsl: "1", pe_ttm: "1", zsz: "1", ltsz: "1", zf: "1", lb: "1", state: "", stock_type: "GP-A" });
const page = (rows: object[], total = 5577) => JSON.stringify({ code: 0, msg: "ok", data: { rank_list: rows, offset: 0, total } });
const RANK = page([row("sz300502", "新易盛", "196.00", "-14.19", "2160760"), row("sh688825", "长鑫科技", "41.80", "-2.50", "1214502"),
  row("bj920306", "天元重工", "7.58", "-23.28", "16000"), row("hk00700", "腾讯控股", "1", "1", "1")]);
const answer = (url: URL) => new Response(url.host === "qt.gtimg.cn" ? CLOSED : RANK);

test("parseTencentRank maps rows to cn ids, yuan turnover, and skips what is not an A share", () => {
  const { total, items } = parseTencentRank(RANK);
  assert.equal(total, 5577);
  assert.deepEqual(items.map((i) => i.id), ["cn:300502", "cn:688825", "cn:920306"]);
  assert.deepEqual(items[0], { id: "cn:300502", symbol: "300502", name: "新易盛", price: 196, change_pct: -14.19, turnover: 21_607_600_000 });
  for (const bad of ["<html>busy</html>", JSON.stringify({ code: 1, data: {} }), JSON.stringify({ code: 0, data: { total: 1 } })]) {
    assert.throws(() => parseTencentRank(bad), bad);
  }
});

test("mergeMovers ranks gainers and losers by the size of the move, then turnover", () => {
  const g = parseTencentRank(page([row("sz300030", "阳普医疗", "7.31", "20.03", "35402"), row("sz301132", "满坤科技", "56.08", "20.01", "83510")])).items;
  const l = parseTencentRank(page([row("bj920306", "天元重工", "7.58", "-23.28", "16000"), row("sz300911", "亿田智能", "22.20", "-19.33", "49000")])).items;
  assert.deepEqual(mergeMovers(g, l, 3).map((i) => i.symbol), ["920306", "300030", "301132"]);
  const tie = parseTencentRank(page([row("sz000001", "甲", "1", "10.00", "100"), row("sz000002", "乙", "1", "-10.00", "900")])).items;
  assert.deepEqual(mergeMovers(tie.slice(0, 1), tie.slice(1)).map((i) => i.symbol), ["000002", "000001"]);
});

test("volume asks Tencent once by turnover; movers asks twice by priceRatio; both carry the session", async () => {
  const urls: string[] = [];
  const rank = createCnRank({ now: () => SAT_10, fetch: async (url) => { urls.push(url.href); return answer(url); } });
  const volume = await rank("volume");
  assert.equal(volume.ok, true);
  assert.equal(volume.sort, "volume");
  assert.equal(volume.total, 5577);
  assert.equal(volume.items.length, 3);
  assert.deepEqual(volume.session, { phase: "closed", lastSession: "2026-10-30" });
  const movers = await rank("movers");
  assert.equal(movers.sort, "movers");
  const ranked = urls.filter((u) => u.includes("getBoardRankList"));
  assert.equal(ranked[0], "https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList?_appver=11.17.0&board_code=aStock&sort_type=turnover&direct=down&offset=0&count=20");
  assert.deepEqual(ranked.slice(1).map((u) => [new URL(u).searchParams.get("sort_type"), new URL(u).searchParams.get("direct")]).sort(),
    [["priceRatio", "down"], ["priceRatio", "up"]]);
});

test("an answer is kept for RANK_TTL_MS per sort; a failure is never kept", async () => {
  let clock = SAT_10, calls = 0;
  const rank = createCnRank({ now: () => clock, fetch: async (url) => { if (!url.host.startsWith("qt")) calls++; return answer(url); } });
  await rank("volume"); await rank("volume");
  assert.equal(calls, 1);
  clock += RANK_TTL_MS + 1;
  await rank("volume");
  assert.equal(calls, 2);
  let failing = 0;
  const down = createCnRank({ now: () => clock, fetch: async (url) => { if (url.host.startsWith("qt")) return answer(url); failing++; return new Response("<html>busy</html>"); } });
  await assert.rejects(down("volume"));
  await assert.rejects(down("volume"));
  assert.equal(failing, 2);
});

function routeWith(rank: CnRank): WebRoute {
  const routes: WebRoute[] = [];
  registerCnRankRoute({ register: (route) => routes.push(route) }, rank);
  assert.equal(routes[0]?.path, "/data/cn/rank");
  return routes[0]!;
}
async function call(route: WebRoute, overrides: Partial<IncomingMessage> = {}) {
  const out = { status: 0, body: "", headers: {} as Record<string, string> };
  const res = { writeHead(status: number, headers: Record<string, string>) { out.status = status; out.headers = headers; }, end(body: string) { out.body = body; } } as unknown as ServerResponse;
  const req = { method: "GET", url: "/data/cn/rank?sort=volume", headers: { host: "127.0.0.1:3090" }, ...overrides } as IncomingMessage;
  await route.handler(req, res);
  return out;
}

test("the route: fence, GET only, sort once and known, 503 with a fixed body on failure", async () => {
  let calls = 0;
  const ok = routeWith(async (sort) => { calls++; return { ok: true, sort, total: 1, asOf: "x", session: { phase: "closed", lastSession: null }, items: [] }; });
  assert.equal((await call(ok, { headers: { host: "localhost:3090", origin: "https://evil.example" } })).status, 403);
  assert.equal((await call(ok, { method: "POST" })).status, 405);
  for (const url of ["/data/cn/rank?sort=price", "/data/cn/rank?sort=volume&sort=movers", "/data/cn/rank?sort=volume&x=1", "/data/cn/rank"]) {
    const bad = await call(ok, { url });
    assert.equal(bad.status, 400, url);
    assert.equal(bad.body, '{"ok":false,"error":"invalid rank request"}');
  }
  assert.equal(calls, 0);
  const good = await call(ok, { url: "/data/cn/rank?sort=movers" });
  assert.equal(good.status, 200);
  assert.equal(good.headers["cache-control"], "no-store");
  assert.equal(JSON.parse(good.body).sort, "movers");
  const failed = await call(routeWith(async () => { throw new Error("private detail"); }));
  assert.equal(failed.status, 503);
  assert.equal(failed.body, '{"ok":false,"error":"ranking unavailable"}');
});
