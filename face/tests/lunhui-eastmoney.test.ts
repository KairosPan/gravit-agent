/**
 * The Lunhui Eastmoney fetch core, the limit-up pools, the boards, their members, the board fund
 * flow and the up/down distribution, `plugins/lunhui/lib/eastmoney.mjs` (modules spec §5.3, A17, A20,
 * A28): the replies parsed from the synthetic fixtures in
 * `fixtures/lunhui-eastmoney/`, the one redirect to the delay host, the four-request limiter and
 * the provider failures as refusals. The redirect and failure cases hand the fetch core a small
 * fake `fetch`; nothing reaches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  fetchBoardFundFlow, fetchBoardMembers, fetchBoards, fetchEastmoneyJson, fetchLimitUpPools, fetchMarketCounts, inFlight,
} from "../plugins/lunhui/lib/eastmoney.mjs";
import { createFixtureFetch } from "../plugins/lunhui/lib/fixture-fetch.mjs";
import { hash } from "../plugins/lunhui/lib/contract-core.mjs";
import { LunhuiError } from "../plugins/lunhui/lib/runs.mjs";

const FIXTURES = fileURLToPath(new URL("./fixtures/lunhui-eastmoney/", import.meta.url));
const fixtureFetch = createFixtureFetch(FIXTURES);
const DATE = "20261023";
const PLAIN = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=30&fs=m%3A90+t%3A3";
const ZDFENBU = "https://push2ex.eastmoney.com/getTopicZDFenBu?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt";

/** `promise` rejects with a `LunhuiError` carrying `code`, and the message opens with the code. */
async function rejectsWith(promise: Promise<unknown>, code: string): Promise<LunhuiError> {
  let refusal: unknown;
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof LunhuiError, `a LunhuiError, not ${String(error)}`);
    assert.equal(error.code, code);
    assert.ok(error.message.startsWith(`${code}: `), error.message);
    refusal = error;
    return true;
  });
  return refusal as LunhuiError;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** A fake `fetch` answering each URL in turn from `answers`, recording every URL and init it was asked. */
function scripted(...answers: Array<(url: string) => Response>) {
  const asked: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    asked.push({ url: String(url), init });
    const answer = answers.shift();
    assert.ok(answer, `an unexpected request for ${String(url)}`);
    return answer(String(url));
  };
  return { asked, fetchImpl };
}

/** A pool reply in the live shape around `pool`. */
function poolReply(pool: unknown[] | null) {
  return { rc: 0, rt: 4, svr: 1, lt: 1, full: 1, data: pool === null ? null : { tc: pool.length, qdate: 20261023, pool } };
}

/** A fake `fetch` serving the fixtures, with the reply at `path` replaced by `reply`. */
function withPool(path: string, reply: unknown) {
  return async (url: string | URL, init?: RequestInit) =>
    new URL(String(url)).pathname === path ? json(reply) : fixtureFetch(url, init);
}
const withZtPool = (reply: unknown) => withPool("/getTopicZTPool", reply);

test("eastmoney: the ZT pool parses to PoolRows with the price divided by 1000 and the streak split", async () => {
  const asked: string[] = [];
  const pools = await fetchLimitUpPools({
    date: DATE,
    fetchImpl: async (url: string | URL, init?: RequestInit) => {
      asked.push(String(url));
      return fixtureFetch(url, init);
    },
  });
  assert.equal(pools.zt.length, 6);
  assert.deepEqual(pools.zt[0], {
    code: "600101", name: "示例电力", pct: 10.04, price: 5.12, amount: 412345678, floatCap: 6123456789,
    totalCap: 6234567890, turnoverRate: 6.73, boards: 3, firstSealAt: "092500", lastSealAt: "092500",
    sealFunds: 185432100, breakCount: 0, industry: "电力", streak: { days: 3, count: 3 },
  });
  assert.deepEqual(pools.zt[3].streak, { days: 4, count: 2 });
  assert.deepEqual(pools.zb[2], {
    code: "300107", name: "示例医药", price: 31.02, limitPrice: 33.6, pct: 10.77, amount: 876543210,
    floatCap: 7890123456, totalCap: 8901234567, turnoverRate: 11.11, firstSealAt: "094207", breakCount: 2,
    amplitude: 21.4, speed: -0.42, streak: { days: 1, count: 0 }, industry: "化学制药",
  });
  assert.deepEqual(pools.yesterday[3], {
    code: "002109", name: "示例食品", price: 11.98, limitPrice: 13.31, pct: -6.05, amount: 234567890,
    floatCap: 3210987654, totalCap: 3321098765, turnoverRate: 7.31, amplitude: 9.02, speed: -0.51,
    yesterdaySealAt: "141022", yesterdayBoards: 1, industry: "食品加工", streak: { days: 1, count: 1 },
  });
  assert.equal(pools.zb.length, 3);
  assert.equal(pools.yesterday.length, 5);
  assert.equal(pools.host, "push2ex.eastmoney.com");
  assert.equal(pools.delayed, false);
  assert.equal(pools.truncated, false);
  // The queries AKShare sends, the page size cut to the 500-row bound.
  const query = "ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=500";
  assert.deepEqual(asked.sort(), [
    `https://push2ex.eastmoney.com/getTopicZBPool?${query}&sort=fbt%3Aasc&date=${DATE}`,
    `https://push2ex.eastmoney.com/getTopicZTPool?${query}&sort=fbt%3Aasc&date=${DATE}`,
    `https://push2ex.eastmoney.com/getYesterdayZTPool?${query}&sort=zs%3Adesc&date=${DATE}`,
  ]);
  // A bad date is the host's bug, thrown before any request.
  asked.length = 0;
  for (const date of ["2026-10-23", "2026102", 20261023, undefined]) {
    await assert.rejects(fetchLimitUpPools({ date: date as string, fetchImpl: fixtureFetch }), TypeError);
  }
  assert.deepEqual(asked, []);
});

test("eastmoney: a ZT pool with data null or an empty pool is NO_MARKET_DATA; the ZB and yesterday pools read them as empty lists", async () => {
  await rejectsWith(fetchLimitUpPools({ date: DATE, fetchImpl: withZtPool(poolReply(null)) }), "NO_MARKET_DATA");
  await rejectsWith(fetchLimitUpPools({ date: DATE, fetchImpl: withZtPool(poolReply([])) }), "NO_MARKET_DATA");
  // A day with no 炸板, or no 昨日涨停 reply, is a market state beside a good 涨停池.
  for (const path of ["/getTopicZBPool", "/getYesterdayZTPool"]) {
    for (const reply of [poolReply(null), poolReply([])]) {
      const pools = await fetchLimitUpPools({ date: DATE, fetchImpl: withPool(path, reply) });
      assert.equal(pools.zt.length, 6, path);
      assert.deepEqual(path === "/getTopicZBPool" ? pools.zb : pools.yesterday, [], path);
      assert.equal((path === "/getTopicZBPool" ? pools.yesterday : pools.zb).length > 0, true, path);
    }
  }
  // A pool that is not a list is not "no data" but an invalid reply.
  await rejectsWith(
    fetchLimitUpPools({ date: DATE, fetchImpl: withZtPool({ rc: 0, data: { tc: 1, pool: {} } }) }),
    "UPSTREAM_INVALID",
  );
});

test("eastmoney: 501 rows are cut to 500 with truncated true", async () => {
  const row = (i: number) => ({ c: String(600000 + i), n: `示例${i}`, p: 10000, zdp: 10, lbc: 1, zttj: { days: 1, ct: 1 } });
  const pools = await fetchLimitUpPools({
    date: DATE,
    fetchImpl: withZtPool(poolReply(Array.from({ length: 501 }, (_, i) => row(i)))),
  });
  assert.equal(pools.zt.length, 500);
  assert.equal(pools.zt[499].code, "600499");
  assert.equal(pools.truncated, true);
  const exact = await fetchLimitUpPools({
    date: DATE,
    fetchImpl: withZtPool(poolReply(Array.from({ length: 500 }, (_, i) => row(i)))),
  });
  assert.equal(exact.zt.length, 500);
  assert.equal(exact.truncated, false);
  // The live server sends at most `pagesize` rows; its total `tc` above them marks the cut.
  const cut = { rc: 0, data: { tc: 600, qdate: 20261023, pool: Array.from({ length: 500 }, (_, i) => row(i)) } };
  const live = await fetchLimitUpPools({ date: DATE, fetchImpl: withZtPool(cut) });
  assert.equal(live.zt.length, 500);
  assert.equal(live.truncated, true);
});

test("eastmoney: one redirect to push2delay is followed with delayed true; a redirect elsewhere is UPSTREAM_INVALID; a second redirect is UPSTREAM_INVALID; no numbered host is ever asked", async () => {
  const delayUrl = PLAIN.replace("push2.", "push2delay.");
  const followed = scripted(() => redirect(delayUrl), () => json({ rc: 0, data: { total: 1 } }));
  const reply = await fetchEastmoneyJson(PLAIN, { fetchImpl: followed.fetchImpl });
  assert.deepEqual(reply, { json: { rc: 0, data: { total: 1 } }, host: "push2delay.eastmoney.com", delayed: true });
  assert.deepEqual(followed.asked.map((a) => a.url), [PLAIN, delayUrl]);
  for (const { init } of followed.asked) {
    assert.equal(init?.redirect, "manual");
    assert.deepEqual(init?.headers, { Accept: "application/json", Referer: "https://quote.eastmoney.com/" });
  }
  for (const status of [301, 307, 308]) {
    const other = scripted(() => redirect(delayUrl, status), () => json({ rc: 0 }));
    assert.equal((await fetchEastmoneyJson(PLAIN, { fetchImpl: other.fetchImpl })).host, "push2delay.eastmoney.com");
  }

  const elsewhere = [
    "https://17.push2.eastmoney.com/api/qt/clist/get?pn=1&pz=30&fs=m%3A90+t%3A3", // a numbered host
    "https://29.push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=30&fs=m%3A90+t%3A3",
    "http://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=30&fs=m%3A90+t%3A3", // not https
    "https://push2delay.eastmoney.com/api/qt/clist/get?pn=2&pz=30&fs=m%3A90+t%3A3", // another query
    "https://push2delay.eastmoney.com/api/qt/ulist/get?pn=1&pz=30&fs=m%3A90+t%3A3", // another path
    "https://push2delay.eastmoney.com:8443/api/qt/clist/get?pn=1&pz=30&fs=m%3A90+t%3A3", // another port
    "http://[",
  ];
  for (const location of elsewhere) {
    const refused = scripted(() => redirect(location));
    const error = await rejectsWith(fetchEastmoneyJson(PLAIN, { fetchImpl: refused.fetchImpl }), "UPSTREAM_INVALID");
    assert.equal(error.message, "UPSTREAM_INVALID: 东方财富响应无效（REDIRECT_REFUSED）；本次未写入任何文件。");
    assert.deepEqual(refused.asked.map((a) => a.url), [PLAIN], location);
  }
  const missing = scripted(() => new Response(null, { status: 302 }));
  await rejectsWith(fetchEastmoneyJson(PLAIN, { fetchImpl: missing.fetchImpl }), "UPSTREAM_INVALID");

  const twice = scripted(() => redirect(delayUrl), () => redirect(delayUrl));
  await rejectsWith(fetchEastmoneyJson(PLAIN, { fetchImpl: twice.fetchImpl }), "UPSTREAM_INVALID");
  assert.deepEqual(twice.asked.map((a) => a.url), [PLAIN, delayUrl]);
});

test("eastmoney: ten concurrent requests never have more than four in flight", async () => {
  let running = 0;
  let peak = 0;
  const started: number[] = [];
  const releases: Array<() => void> = [];
  const fetchImpl = async (url: string | URL) => {
    started.push(Number(new URL(String(url)).searchParams.get("i")));
    running += 1;
    peak = Math.max(peak, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running -= 1;
    return json({ rc: 0 });
  };
  const replies = Array.from({ length: 10 }, (_, i) =>
    fetchEastmoneyJson(`https://push2ex.eastmoney.com/getTopicZTPool?i=${i}`, { fetchImpl }),
  );
  // Release the running requests one at a time until all ten have run.
  while (started.length < 10 || releases.length > 0) {
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(running <= 4, `${running} in flight`);
    releases.shift()?.();
  }
  await Promise.all(replies);
  assert.equal(peak, 4);
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // the others queue in arrival order
  // A task that fails releases its slot too.
  await assert.rejects(inFlight(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await inFlight(async () => "free"), "free");
});

test("eastmoney: a reply with dlmkts set is delayed even from the plain host", async () => {
  const delayed = scripted(() => json({ rc: 0, dlmkts: "8,10,128", data: {} }));
  const reply = await fetchEastmoneyJson(PLAIN, { fetchImpl: delayed.fetchImpl });
  assert.equal(reply.host, "push2.eastmoney.com");
  assert.equal(reply.delayed, true);
  const live = scripted(() => json({ rc: 0, dlmkts: "", data: {} }));
  assert.equal((await fetchEastmoneyJson(PLAIN, { fetchImpl: live.fetchImpl })).delayed, false);
});

test("eastmoney: not JSON is UPSTREAM_INVALID, over 512 KiB is UPSTREAM_TOO_LARGE, a hung body is UPSTREAM_TIMEOUT", async () => {
  for (const body of ["<html>busy</html>", "[1,2]", "null", new Uint8Array([0xff, 0xfe, 0x7b, 0x7d])]) {
    const answer = scripted(() => new Response(body));
    await rejectsWith(fetchEastmoneyJson(PLAIN, { fetchImpl: answer.fetchImpl }), "UPSTREAM_INVALID");
  }
  const failed = scripted(() => json({ rc: 0 }, 503));
  await rejectsWith(fetchEastmoneyJson(PLAIN, { fetchImpl: failed.fetchImpl }), "UPSTREAM_INVALID");

  const large = scripted(() => new Response(new Uint8Array(512 * 1024 + 1)));
  await rejectsWith(fetchEastmoneyJson(PLAIN, { fetchImpl: large.fetchImpl }), "UPSTREAM_TOO_LARGE");
  const capped = scripted(() => json({ rc: 0, pad: "x".repeat(64) }));
  await rejectsWith(fetchEastmoneyJson(PLAIN, { fetchImpl: capped.fetchImpl, maxBytes: 32 }), "UPSTREAM_TOO_LARGE");

  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const hung = scripted(() => new Response(body));
  await rejectsWith(fetchEastmoneyJson(PLAIN, { fetchImpl: hung.fetchImpl, timeoutMs: 15 }), "UPSTREAM_TIMEOUT");
  assert.equal(cancelled, true);
});

test("eastmoney: the fixture fetch answers the three pool paths and the distribution, and 404s an unknown path", async () => {
  for (const [path, tc] of [["/getTopicZTPool", 6], ["/getTopicZBPool", 3], ["/getYesterdayZTPool", 5]] as const) {
    const response = await fixtureFetch(`https://push2ex.eastmoney.com${path}?date=${DATE}`);
    assert.equal(response.status, 200, path);
    assert.equal((await response.json()).data.tc, tc, path);
  }
  const fenbu = await fixtureFetch(ZDFENBU);
  assert.equal(fenbu.status, 200);
  assert.equal((await fenbu.json()).data.qdate, 20261023);
  for (const url of [
    "https://push2ex.eastmoney.com/getTopicDTPool?date=20261023",
    "https://push2ex.eastmoney.com/",
    "https://push2delay.eastmoney.com/getTopicZTPool",
    "https://push2.eastmoney.com/api/qt/clist/get?fs=m%3A99",
    "https://push2.eastmoney.com/api/qt/clist/get?fs=b%3A..%2Fx",
    "https://push2.eastmoney.com/api/qt/ulist/get?fs=m%3A90+t%3A3",
    "not a url",
  ]) {
    assert.equal((await fixtureFetch(url)).status, 404, url);
  }
});

/** A fake `fetch` serving the fixtures, recording every URL it was asked. */
function recorded() {
  const asked: string[] = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    asked.push(String(url));
    return fixtureFetch(url, init);
  };
  return { asked, fetchImpl };
}

const CLIST = "https://push2.eastmoney.com/api/qt/clist/get";
const UT = "ut=bd1d9ddb04089700cf9c27f6f7426281";

test("eastmoney: fetchBoards returns the top boards with advancers and decliners", async () => {
  const { asked, fetchImpl } = recorded();
  const reply = await fetchBoards({ fetchImpl });
  assert.equal(reply.boards.length, 4);
  assert.deepEqual(reply.boards[0], {
    code: "BK0715", name: "示例电网", pct: 4.12, amount: 98765432100, advancers: 42, decliners: 3, leader: "示例电力",
  });
  // "-" is no number and no name.
  assert.deepEqual(reply.boards[3], {
    code: "BK1099", name: "示例停牌板块", pct: null, amount: 1234567800, advancers: 0, decliners: 0, leader: null,
  });
  assert.equal(reply.host, "push2.eastmoney.com");
  assert.equal(reply.delayed, false);
  // AKShare's concept-board query, sorted by change, descending, and cut to the top.
  assert.deepEqual(asked, [
    `${CLIST}?pn=1&pz=30&po=1&np=1&${UT}&fltt=2&invt=2&fid=f3&fs=m%3A90+t%3A3+f%3A%2150` +
      "&fields=f12%2Cf14%2Cf3%2Cf6%2Cf104%2Cf105%2Cf128",
  ]);
  const top = recorded();
  assert.equal((await fetchBoards({ fetchImpl: top.fetchImpl, top: 2 })).boards.length, 2);
  assert.equal(new URL(top.asked[0]).searchParams.get("pz"), "2");

  // Null data or an empty list is no market data; a row off the BK grammar is an invalid reply.
  const clist = (data: unknown) => async () => json({ rc: 0, data });
  await rejectsWith(fetchBoards({ fetchImpl: clist(null) }), "NO_MARKET_DATA");
  await rejectsWith(fetchBoards({ fetchImpl: clist({ total: 0, diff: [] }) }), "NO_MARKET_DATA");
  await rejectsWith(fetchBoards({ fetchImpl: clist({ total: 1, diff: [{ f12: "../x", f14: "x" }] }) }), "UPSTREAM_INVALID");
  await rejectsWith(fetchBoards({ fetchImpl: clist({ total: 1, diff: {} }) }), "UPSTREAM_INVALID");
});

test("eastmoney: fetchBoardMembers refuses a code off the BK grammar before fetching, and cuts a 140-member board to 100 with truncated true", async () => {
  const { asked, fetchImpl } = recorded();
  for (const code of ["BK071", "BK07150", "bk0715", "../BK0715", "BK0715 f:!50", 715, undefined]) {
    const error = await rejectsWith(fetchBoardMembers(code as string, { fetchImpl }), "UPSTREAM_INVALID");
    assert.ok(!error.message.includes("/"), error.message);
  }
  assert.deepEqual(asked, []);

  const small = await fetchBoardMembers("BK0715", { fetchImpl });
  assert.deepEqual(small.members, [
    { code: "600101", name: "示例电力", pct: 10.04 },
    { code: "000102", name: "示例电网", pct: 6.21 },
    { code: "603103", name: "示例电气", pct: -0.85 },
    { code: "002104", name: "示例停牌", pct: null },
  ]);
  assert.equal(small.truncated, false);
  assert.equal(small.host, "push2.eastmoney.com");
  assert.equal(small.delayed, false);
  assert.deepEqual(asked, [
    `${CLIST}?pn=1&pz=100&po=1&np=1&${UT}&fltt=2&invt=2&fid=f12&fs=b%3ABK0715+f%3A%2150&fields=f12%2Cf14%2Cf3`,
  ]);

  const large = await fetchBoardMembers("BK1716", { fetchImpl });
  assert.equal(large.members.length, 100);
  assert.deepEqual(large.members[99], { code: "300299", name: "示例算力99", pct: -4.9 });
  assert.equal(large.truncated, true);
  // A smaller bound cuts the rows the server sent.
  const cut = await fetchBoardMembers("BK0715", { fetchImpl, max: 2 });
  assert.deepEqual(cut.members.map((m) => m.code), ["600101", "000102"]);
  assert.equal(cut.truncated, true);

  // An empty member list is an empty list, not a refusal.
  for (const data of [null, { total: 0, diff: [] }]) {
    const empty = await fetchBoardMembers("BK0715", { fetchImpl: async () => json({ rc: 0, data }) });
    assert.deepEqual(empty.members, []);
    assert.equal(empty.truncated, false);
  }
  await rejectsWith(
    fetchBoardMembers("BK0715", { fetchImpl: async () => json({ rc: 0, data: { total: 1, diff: [{ f12: "60010" }] } }) }),
    "UPSTREAM_INVALID",
  );
});

test("eastmoney: fetchBoardFundFlow parses the main net inflow and its share", async () => {
  const { asked, fetchImpl } = recorded();
  const reply = await fetchBoardFundFlow({ fetchImpl });
  assert.deepEqual(reply.rows, [
    { code: "BK0715", name: "示例电网", pct: 4.12, mainNet: 3456789012, mainShare: 7.85 },
    { code: "BK1716", name: "示例算力", pct: 2.87, mainNet: 1234567890, mainShare: 1.61 },
    { code: "BK0493", name: "示例新能源车", pct: -1.35, mainNet: -2345678901, mainShare: -4.32 },
    { code: "BK1099", name: "示例停牌板块", pct: null, mainNet: null, mainShare: null },
  ]);
  assert.equal(reply.host, "push2.eastmoney.com");
  assert.equal(reply.delayed, false);
  // stock_sector_fund_flow_rank("今日", "概念资金流"), its page cut to the top.
  assert.deepEqual(asked, [
    `${CLIST}?pn=1&pz=30&po=1&np=1&ut=b2884a393a59ad64002292a3e90d46a5&fltt=2&invt=2&fid0=f62` +
      "&fs=m%3A90+t%3A3&stat=1&fields=f12%2Cf14%2Cf2%2Cf3%2Cf62%2Cf184%2Cf66%2Cf69%2Cf72%2Cf75%2Cf78%2Cf81" +
      "%2Cf84%2Cf87%2Cf204%2Cf205%2Cf124&rt=52975239",
  ]);
  const top = await fetchBoardFundFlow({ fetchImpl, top: 1 });
  assert.deepEqual(top.rows.map((row) => row.code), ["BK0715"]);
  await rejectsWith(fetchBoardFundFlow({ fetchImpl: async () => json({ rc: 0, data: null }) }), "NO_MARKET_DATA");
});

test("eastmoney: a clist reply whose total is not a non-negative integer is UPSTREAM_INVALID for the boards, the members and the fund flow", async () => {
  const members = (total: unknown) => async () => json({ rc: 0, data: { total, diff: [{ f12: "600519", f14: "示例酒", f3: 1.2 }] } });
  for (const total of ["140", null, -1, 1.5]) await rejectsWith(fetchBoardMembers("BK0715", { fetchImpl: members(total) }), "UPSTREAM_INVALID");
  const boards = (total: unknown) => async () => json({ rc: 0, data: { total, diff: [{ f12: "BK0715", f14: "示例电网", f3: 1 }] } });
  await rejectsWith(fetchBoards({ fetchImpl: boards("1") }), "UPSTREAM_INVALID");
  await rejectsWith(fetchBoardFundFlow({ fetchImpl: boards(null) }), "UPSTREAM_INVALID");
  // An integer total stands, and a total past the rows kept tells a cut list.
  assert.equal((await fetchBoardMembers("BK0715", { fetchImpl: members(140) })).truncated, true);
});

/** A distribution reply in the live shape around `data`. */
function distribution(data: unknown) {
  return { rc: 0, rt: 115, svr: 1, lt: 2, full: 0, data };
}

test("eastmoney: fetchMarketCounts reads the up/down distribution in one request: counts by bucket, 11 and -11 the limits, the data hashed", async () => {
  const { asked, fetchImpl } = recorded();
  const counts = await fetchMarketCounts({ date: DATE, fetchImpl });
  const fixture = JSON.parse(readFileSync(`${FIXTURES}distribution.json`, "utf8"));
  assert.deepEqual(counts, {
    qdate: 20261023,
    advancers: 15, decliners: 12, unchanged: 3, limitUp: 6, limitDown: 2, total: 30,
    buckets: [
      { bucket: -11, count: 2 }, { bucket: -10, count: 1 }, { bucket: -3, count: 4 }, { bucket: -1, count: 5 },
      { bucket: 0, count: 3 }, { bucket: 1, count: 6 }, { bucket: 5, count: 2 }, { bucket: 10, count: 1 }, { bucket: 11, count: 6 },
    ],
    hash: hash(fixture.data), host: "push2ex.eastmoney.com", delayed: false,
  });
  // One request, no date in it: the endpoint answers its latest session whatever is asked.
  assert.deepEqual(asked, [ZDFENBU]);
  // The hash is over the reply's data, canonical: a reply differing only in its per-request fields hashes alike.
  const again = await fetchMarketCounts({ date: DATE, fetchImpl: async () => json({ ...fixture, svr: fixture.svr + 1, rt: 9 }) });
  assert.equal(again.hash, counts.hash);
  // A bad date is the host's bug, thrown before any request.
  for (const date of ["2026-10-23", 20261023, undefined]) {
    await assert.rejects(fetchMarketCounts({ date, fetchImpl } as any), TypeError);
  }
  assert.equal(asked.length, 1);
});

test("eastmoney: fetchMarketCounts refuses a distribution in which no share has moved, and reads a bucket the reply lacks as null", async () => {
  const reply = (fenbu: unknown) => async () => json(distribution({ qdate: 20261023, fenbu }));
  // Every share in bucket 0, or every bucket at 0: a session with no prices yet is no market data, said so.
  const flat = await rejectsWith(fetchMarketCounts({ date: DATE, fetchImpl: reply([{ "0": 5375 }]) }), "NO_MARKET_DATA");
  assert.match(flat.message, /^NO_MARKET_DATA: 东方财富的涨跌分布里没有任何一只股票上涨或下跌/);
  const zeros = Array.from({ length: 23 }, (_, i) => ({ [String(i - 11)]: 0 }));
  await rejectsWith(fetchMarketCounts({ date: DATE, fetchImpl: reply(zeros) }), "NO_MARKET_DATA");
  // A bucket the reply lacks is not asserted: null, never 0.
  const sparse = await fetchMarketCounts({ date: DATE, fetchImpl: reply([{ "1": 3 }, { "-1": 2 }]) });
  assert.deepEqual(
    [sparse.advancers, sparse.decliners, sparse.unchanged, sparse.limitUp, sparse.limitDown, sparse.total],
    [3, 2, null, null, null, 5],
  );
});

test("eastmoney: fetchMarketCounts refuses another session's distribution, an empty one, a rejected request, and a malformed one", async () => {
  const reply = (data: unknown) => async () => json(distribution(data));
  const other = await rejectsWith(
    fetchMarketCounts({ date: DATE, fetchImpl: reply({ qdate: 20261022, fenbu: [{ "1": 3 }] }) }), "NO_MARKET_DATA");
  assert.match(other.message, /^NO_MARKET_DATA: 东方财富返回的数据属于交易日 20261022，不是本次会话 20261023/);
  await rejectsWith(fetchMarketCounts({ date: DATE, fetchImpl: reply(null) }), "NO_MARKET_DATA");
  // A reply Eastmoney rejected (rc not 0) is an invalid reply, whatever its data, not a market state.
  for (const data of [null, { qdate: 20261023, fenbu: [{ "1": 3 }] }]) {
    const rejected = await rejectsWith(
      fetchMarketCounts({ date: DATE, fetchImpl: async () => json({ ...distribution(data), rc: -1 }) }), "UPSTREAM_INVALID");
    assert.match(rejected.message, /PROVIDER_ERROR/);
  }
  await rejectsWith(fetchMarketCounts({ date: DATE, fetchImpl: reply({ qdate: 20261023, fenbu: [] }) }), "NO_MARKET_DATA");
  for (const data of [
    { qdate: "20261023", fenbu: [{ "1": 3 }] }, // a string date
    { qdate: 20261023, fenbu: {} }, // not a list
    { qdate: 20261023, fenbu: [{ "12": 3 }] }, // past the limit bucket
    { qdate: 20261023, fenbu: [{ "-0": 3 }] },
    { qdate: 20261023, fenbu: [{ "1": -1 }] }, // a negative count
    { qdate: 20261023, fenbu: [{ "1": 1.5 }] },
    { qdate: 20261023, fenbu: [{ "1": 3, "2": 4 }] }, // two buckets in one entry
    { qdate: 20261023, fenbu: [{ "1": 3 }, { "1": 4 }] }, // a bucket twice
    { qdate: 20261023, fenbu: [null] },
  ]) {
    await rejectsWith(fetchMarketCounts({ date: DATE, fetchImpl: reply(data) }), "UPSTREAM_INVALID");
  }
  await rejectsWith(fetchMarketCounts({ date: DATE, fetchImpl: async () => new Response("<html>502</html>", { status: 502 }) }), "UPSTREAM_INVALID");
});

test("eastmoney: the fixture fetch answers the boards, members and fund-flow files by fs", async () => {
  const q = (params: Record<string, string>) => `${CLIST}?${new URLSearchParams(params)}`;
  for (const [url, name] of [
    [q({ fs: "m:90 t:3 f:!50" }), "boards.json"],
    [q({ fs: "m:90 t:3", fid0: "f62" }), "board-flow.json"],
    [q({ fs: "b:BK0715 f:!50" }), "members-BK0715.json"],
    [q({ fs: "b:BK1716 f:!50" }), "members-BK1716.json"],
  ]) {
    const response = await fixtureFetch(url);
    assert.equal(response.status, 200, url);
    assert.deepEqual(await response.json(), JSON.parse(readFileSync(`${FIXTURES}${name}`, "utf8")), url);
  }
  for (const url of [q({ fs: "b:BK9999 f:!50" }), q({ fs: "m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048", pn: "1" })]) {
    assert.equal((await fixtureFetch(url)).status, 404, url);
  }
});
