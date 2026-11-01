/**
 * The 问财 client, `plugins/lunhui/lib/wencai.mjs`: one token exchange and one all-market query
 * through the QuantAPI fixtures, the cached access token, and every refusal naming 同花顺问财
 * without the token. Nothing reaches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createFixtureFetch } from "../plugins/lunhui/lib/fixture-fetch.mjs";
import { fetchWencaiUniverse, hasWencaiCredentials, resetWencaiToken, WENCAI_PROVIDER } from "../plugins/lunhui/lib/wencai.mjs";
import { LunhuiError } from "../plugins/lunhui/lib/runs.mjs";

const serve = createFixtureFetch(fileURLToPath(new URL("./fixtures/lunhui/", import.meta.url)));
const REFRESH = "fake-refresh-value";
const ENV = { IFIND_REFRESH_TOKEN: REFRESH };

type Call = { path: string; headers: Record<string, string>; body: any };
function recorder(over: (path: string, n: number) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, headers: { ...(init?.headers as Record<string, string>) }, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return over(path, calls.filter((c) => c.path === path).length) ?? serve(url, init);
  };
  return { calls, fetchImpl };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const universe = (r: ReturnType<typeof recorder>, env: Record<string, string> = ENV) =>
  fetchWencaiUniverse({ session: "2026-10-30", env, fetchImpl: r.fetchImpl });

async function refusal(p: Promise<unknown>, code: string, reason: RegExp): Promise<void> {
  await assert.rejects(p, (error: unknown) => {
    assert.ok(error instanceof LunhuiError, String(error));
    assert.equal(error.code, code);
    assert.match(error.message, /同花顺问财/);
    assert.match(error.message, reason);
    assert.ok(!error.message.includes("fixture-access") && !error.message.includes(REFRESH), "no token in the message");
    return true;
  });
}

test("a universe is one token exchange and one query, the session's date in it", async () => {
  resetWencaiToken();
  const r = recorder();
  const out = await universe(r);
  assert.deepEqual(r.calls.map((c) => c.path), ["/api/v1/get_access_token", "/api/v1/smart_stock_picking"]);
  assert.equal(r.calls[0].headers.refresh_token, REFRESH);
  assert.equal(r.calls[1].headers.access_token, "fixture-access");
  assert.equal(r.calls[1].body.searchstring, "A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念");
  assert.equal(r.calls[1].body.searchtype, "stock");
  assert.equal(out.host, "quantapi.51ifind.com");
  assert.equal(out.rows.length, 40);
});

test("rows carry six-digit codes and split concepts", async () => {
  resetWencaiToken();
  const { rows } = await universe(recorder());
  const row = rows.find((x) => x.code === "603890")!;
  assert.equal(row.name, "白酒1");
  assert.equal(row.pct, 2);
  assert.equal(row.amount, 1.5e8);
  assert.equal(row.mainNet, 500000);
  assert.deepEqual(row.concepts, ["白酒概念", "融资融券"]);
  assert.ok(rows.some((x) => x.code === "835185"));
  assert.deepEqual(rows.find((x) => x.code === "601999")!.concepts, []);
  assert.equal(rows.filter((x) => x.concepts.includes("人形机器人")).length, 12);
});

test("the access token is cached; a refused one is exchanged once more", async () => {
  resetWencaiToken();
  const first = recorder();
  await universe(first);
  const second = recorder();
  await universe(second);
  assert.deepEqual(second.calls.map((c) => c.path), ["/api/v1/smart_stock_picking"]);

  const stale = recorder((path, n) => (path.endsWith("smart_stock_picking") && n === 1 ? json({ errorcode: -1010, errmsg: "access_token invalid" }) : undefined));
  await universe(stale);
  assert.deepEqual(stale.calls.map((c) => c.path), ["/api/v1/smart_stock_picking", "/api/v1/get_access_token", "/api/v1/smart_stock_picking"]);

  resetWencaiToken();
  const dead = recorder((path) => (path.endsWith("smart_stock_picking") ? json({ errorcode: -1010, errmsg: "access_token invalid" }) : undefined));
  await refusal(universe(dead), "UPSTREAM_INVALID", /凭据被拒/);
  assert.deepEqual(dead.calls.map((c) => c.path), ["/api/v1/get_access_token", "/api/v1/smart_stock_picking"], "a fresh token is not exchanged again");
});

const PATHS = { x: "/api/v1/get_access_token", q: "/api/v1/smart_stock_picking" };
/** A cached access token, then a query whose first `failures` answers are `errorcode`. */
async function cachedThen(errorcode: number, failures: number) {
  resetWencaiToken();
  await universe(recorder());
  const r = recorder((path, n) => (path.endsWith("smart_stock_picking") && n <= failures ? json({ errorcode, errmsg: "refused" }) : undefined));
  return { r, out: universe(r) };
}

test("a cached token answered with any nonzero errorcode is exchanged once and the query asked once more", async () => {
  const { r, out } = await cachedThen(-9999, 1);
  assert.equal((await out).rows.length, 40);
  assert.deepEqual(r.calls.map((c) => c.path), [PATHS.q, PATHS.x, PATHS.q]);
  // The fresh token is cached: the next universe is one query.
  const next = recorder();
  await universe(next);
  assert.deepEqual(next.calls.map((c) => c.path), [PATHS.q]);
});

test("a cached token's retry answered nonzero again refuses with its errorcode, or 凭据被拒 for a token code", async () => {
  const unknown = await cachedThen(-9999, 2);
  await refusal(unknown.out, "UPSTREAM_INVALID", /errorcode -9999/);
  assert.deepEqual(unknown.r.calls.map((c) => c.path), [PATHS.q, PATHS.x, PATHS.q]);
  const token = await cachedThen(-1301, 2);
  await refusal(token.out, "UPSTREAM_INVALID", /凭据被拒/);
  assert.deepEqual(token.r.calls.map((c) => c.path), [PATHS.q, PATHS.x, PATHS.q]);
});

test("a freshly exchanged token answered nonzero refuses at once - no second exchange", async () => {
  resetWencaiToken();
  const r = recorder((path) => (path.endsWith("smart_stock_picking") ? json({ errorcode: -9999, errmsg: "refused" }) : undefined));
  await refusal(universe(r), "UPSTREAM_INVALID", /errorcode -9999/);
  assert.deepEqual(r.calls.map((c) => c.path), [PATHS.x, PATHS.q]);
  resetWencaiToken();
  const direct = recorder((path) => (path.endsWith("smart_stock_picking") ? json({ errorcode: -9999, errmsg: "refused" }) : undefined));
  await refusal(universe(direct, { IFIND_ACCESS_TOKEN: "fixture-access", IFIND_REFRESH_TOKEN: REFRESH }), "UPSTREAM_INVALID", /errorcode -9999/);
  assert.deepEqual(direct.calls.map((c) => c.path), [PATHS.q], "a direct access token is never exchanged");
});

test("no token, an errorcode, missing columns, no rows, oversize and timeout refuse naming 同花顺问财 and never the token", async () => {
  const run = async (env: Record<string, string>, over: (path: string, n: number) => any, opts: any = {}) => {
    resetWencaiToken();
    const r = recorder(over);
    return fetchWencaiUniverse({ session: "2026-10-30", env, fetchImpl: r.fetchImpl, ...opts });
  };
  await refusal(run({}, () => undefined), "UPSTREAM_INVALID", /未配置/);
  await refusal(run(ENV, (p) => (p.endsWith("get_access_token") ? json({ errorcode: -1301, errmsg: "Refresh_Token is expired or illegal." }, 401) : undefined)), "UPSTREAM_INVALID", /凭据被拒/);
  await refusal(run(ENV, (p) => (p.endsWith("get_access_token") ? json({ errorcode: -1301, errmsg: "bad" }) : undefined)), "UPSTREAM_INVALID", /凭据被拒/);
  await refusal(run(ENV, (p) => (p.endsWith("smart_stock_picking") ? json({ errorcode: -4001, errmsg: "no data" }) : undefined)), "UPSTREAM_INVALID", /errorcode -4001/);
  const body = JSON.parse(await (await serve("https://quantapi.51ifind.com/api/v1/smart_stock_picking")).text());
  const noConcept = structuredClone(body);
  delete noConcept.tables[0].table["所属概念"];
  await refusal(run(ENV, (p) => (p.endsWith("smart_stock_picking") ? json(noConcept) : undefined)), "UPSTREAM_INVALID", /缺少列/);
  const empty = structuredClone(body);
  for (const k of Object.keys(empty.tables[0].table)) empty.tables[0].table[k] = [];
  await refusal(run(ENV, (p) => (p.endsWith("smart_stock_picking") ? json(empty) : undefined)), "NO_MARKET_DATA", /没有可用行/);
  await refusal(run(ENV, (p) => (p.endsWith("smart_stock_picking") ? new Response("x".repeat(2000)) : undefined), { maxBytes: 1000 }), "UPSTREAM_TOO_LARGE", /响应过大/);
  resetWencaiToken();
  const slow = async (url: string | URL, init?: RequestInit) => {
    if (new URL(url).pathname.endsWith("smart_stock_picking"))
      return new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)));
    return serve(url, init);
  };
  await refusal(fetchWencaiUniverse({ session: "2026-10-30", env: ENV, fetchImpl: slow, timeoutMs: 30 }), "UPSTREAM_TIMEOUT", /超时/);
});

test("sha256 is over the reply's data and the query is recorded", async () => {
  resetWencaiToken();
  const a = await universe(recorder());
  resetWencaiToken();
  const b = await universe(recorder());
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.query, "A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念");
  assert.ok(a.dataVol > 0);
  assert.equal(hasWencaiCredentials(ENV), true);
  assert.equal(hasWencaiCredentials({}), false);
  assert.equal(WENCAI_PROVIDER, "同花顺问财");
});
