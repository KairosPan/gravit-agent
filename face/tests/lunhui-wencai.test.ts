/**
 * The 问财 client, `plugins/lunhui/lib/wencai.mjs`: one all-market query through the QuantAPI
 * fixtures, with no token - the market holds it and does the exchange - and every refusal naming
 * 同花顺问财. The market's two iFinD answers Lunhui words itself (no token there, a refused
 * exchange there) arrive as the adapter's IFIND_* codes. Nothing reaches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createFixtureFetch } from "../plugins/lunhui/lib/fixture-fetch.mjs";
import { IFIND_CREDENTIAL, IFIND_UNCONFIGURED } from "../plugins/lunhui/lib/market-fetch.mjs";
import * as wencai from "../plugins/lunhui/lib/wencai.mjs";
import { fetchWencaiUniverse, WENCAI_NOT_CONFIGURED, WENCAI_PROVIDER } from "../plugins/lunhui/lib/wencai.mjs";
import { LunhuiError } from "../plugins/lunhui/lib/runs.mjs";

const serve = createFixtureFetch(fileURLToPath(new URL("./fixtures/lunhui/", import.meta.url)));

type Call = { path: string; method: string; headers: Record<string, string>; body: any };
function recorder(over: (path: string, n: number) => Response | Promise<Response> | undefined = () => undefined) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({
      path,
      method: String(init?.method),
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return over(path, calls.filter((c) => c.path === path).length) ?? serve(url, init);
  };
  return { calls, fetchImpl };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const universe = (r: ReturnType<typeof recorder>, opts: Record<string, unknown> = {}) =>
  fetchWencaiUniverse({ session: "2026-10-30", fetchImpl: r.fetchImpl, ...opts });
/** A fetch whose query is answered by the adapter's rejection coded `code`. */
const rejecting = (code: string) => recorder(() => Promise.reject(Object.assign(new Error(`the market at http://127.0.0.1:4821 refused through its iFinD route: ${code}`), { code })));

async function refusal(p: Promise<unknown>, code: string, reason: RegExp): Promise<void> {
  await assert.rejects(p, (error: unknown) => {
    assert.ok(error instanceof LunhuiError, String(error));
    assert.equal(error.code, code);
    assert.match(error.message, /同花顺问财/);
    assert.match(error.message, reason);
    assert.doesNotMatch(error.message, /access_token|refresh_token|127\.0\.0\.1/);
    return true;
  });
}

test("a universe is one query, the session's date in it, and no token", async () => {
  const r = recorder();
  const out = await universe(r);
  assert.deepEqual(r.calls.map((c) => c.path), ["/api/v1/smart_stock_picking"]);
  const [call] = r.calls;
  assert.equal(call.method, "POST");
  assert.deepEqual(Object.keys(call.headers).sort(), ["Accept", "Content-Type"]);
  for (const name of Object.keys(call.headers)) assert.doesNotMatch(name, /access_token|refresh_token/i);
  assert.deepEqual(call.body, { searchstring: "A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念", searchtype: "stock" });
  assert.equal(out.host, "quantapi.51ifind.com");
  assert.equal(out.rows.length, 40);
});

test("the client keeps no token, no cache and no env", () => {
  assert.deepEqual(Object.keys(wencai).sort(), ["WENCAI_NOT_CONFIGURED", "WENCAI_PROVIDER", "fetchWencaiUniverse"]);
});

test("rows carry six-digit codes and split concepts", async () => {
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

test("the market without a token is NOT_CONFIGURED", async () => {
  await refusal(universe(rejecting(IFIND_UNCONFIGURED)), WENCAI_NOT_CONFIGURED, /未配置（账户没有 iFinD 凭据）；本次未写入任何文件。$/);
  assert.equal(WENCAI_NOT_CONFIGURED, "NOT_CONFIGURED");
});

test("a refused exchange at the market is 凭据被拒", async () => {
  await refusal(universe(rejecting(IFIND_CREDENTIAL)), "UPSTREAM_INVALID", /同花顺问财凭据被拒（令牌换取未通过）/);
});

test("a 401 is 凭据被拒（访问令牌无效）", async () => {
  for (const status of [401, 403]) {
    const r = recorder(() => json({ errorcode: -1010, errmsg: "refused" }, status));
    await refusal(universe(r), "UPSTREAM_INVALID", /凭据被拒（访问令牌无效）/);
    assert.equal(r.calls.length, 1, "one query, never a second");
  }
  const code = recorder(() => json({ errorcode: -1301, errmsg: "refused" }));
  await refusal(universe(code), "UPSTREAM_INVALID", /凭据被拒（访问令牌无效）/);
  assert.equal(code.calls.length, 1);
});

test("an errorcode, missing columns, no rows, oversize, timeout and an unreachable market refuse naming 同花顺问财", async () => {
  const run = (over: (path: string, n: number) => any, opts: any = {}) => universe(recorder(over), opts);
  await refusal(run(() => json({ errorcode: -4001, errmsg: "no data" })), "UPSTREAM_INVALID", /errorcode -4001/);
  const body = JSON.parse(await (await serve("https://quantapi.51ifind.com/api/v1/smart_stock_picking")).text());
  const noConcept = structuredClone(body);
  delete noConcept.tables[0].table["所属概念"];
  await refusal(run(() => json(noConcept)), "UPSTREAM_INVALID", /缺少列/);
  const empty = structuredClone(body);
  for (const k of Object.keys(empty.tables[0].table)) empty.tables[0].table[k] = [];
  await refusal(run(() => json(empty)), "NO_MARKET_DATA", /没有可用行/);
  await refusal(run(() => new Response("x".repeat(2000)), { maxBytes: 1000 }), "UPSTREAM_TOO_LARGE", /响应过大/);
  await refusal(run(() => new Response("not json")), "UPSTREAM_INVALID", /不是 JSON 对象/);
  const slow = async (_url: string | URL, init?: RequestInit) =>
    new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)));
  await refusal(fetchWencaiUniverse({ session: "2026-10-30", fetchImpl: slow, timeoutMs: 30 }), "UPSTREAM_TIMEOUT", /超时/);
  const unreachable = recorder(() => Promise.reject(new Error("the market at http://127.0.0.1:4821 did not answer")));
  const stderr = process.stderr.write;
  process.stderr.write = (() => true) as any;
  try {
    await refusal(universe(unreachable), "UPSTREAM_INVALID", /请求未完成/);
  } finally {
    process.stderr.write = stderr;
  }
});

test("sha256 is over the reply's data and the query is recorded", async () => {
  const a = await universe(recorder());
  const b = await universe(recorder());
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.query, "A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念");
  assert.ok(a.dataVol > 0);
  assert.equal(WENCAI_PROVIDER, "同花顺问财");
});
