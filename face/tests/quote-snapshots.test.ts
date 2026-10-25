import test from "node:test";
import assert from "node:assert/strict";
import { createQuoteSnapshots, QUOTE_RESPONSE_LIMIT, type QuoteFetch } from "../src/quote-snapshots.ts";
import type { QuoteIdentity } from "../src/quote-types.ts";
const NOW = Date.parse("2026-09-15T14:30:00Z");
const cn: QuoteIdentity = { id: "cn:603986", market: "cn", symbol: "603986" };
const token = { IFIND_ACCESS_TOKEN: "test-access" };
const json = (value: unknown) => new Response(JSON.stringify(value));

test("an unconfigured iFinD makes no network request and creates no fake quote", async () => {
  let calls = 0;
  const result = await createQuoteSnapshots({ env: {}, fetcher: async () => { calls++; return json({}); } }).load([cn]);
  assert.equal(calls, 0);
  assert.deepEqual(result.providers.map((provider) => provider.status), ["unconfigured"]);
  assert.match(result.providers[0]!.message, /开通 iFinD/);
  assert.ok(result.updates.every((update) => update.price === undefined && update.as_of === undefined));
});

test("the snapshots read iFinD alone: no Alpaca key, no Alpaca or Coinbase host", async () => {
  const seen: string[] = [];
  const result = await createQuoteSnapshots({ env: { ...token, APCA_API_KEY_ID: "test-key", APCA_API_SECRET_KEY: "test-secret", ALPHA_DATA_FEED: "sip" },
    fetcher: async (url, options) => {
      seen.push(url.origin);
      assert.equal(new Headers(options.headers).has("APCA-API-KEY-ID"), false);
      return json({ errorcode: 0, tables: [] });
    } }).load([cn, cn]);
  assert.deepEqual(seen, ["https://quantapi.51ifind.com"]);
  assert.deepEqual(result.providers.map((provider) => [provider.id, provider.market, provider.source]), [["ifind", "cn", "iFinD"]]);
  assert.deepEqual(result.updates.map((update) => update.id), [cn.id]);
});

test("iFinD sends requested exchange codes and converts supplied Beijing event time", async () => {
  const seen: { url: URL; options: RequestInit }[] = [];
  const more: QuoteIdentity[] = [cn, { id: "cn:300750", market: "cn", symbol: "300750" }, { id: "cn:920185", market: "cn", symbol: "920185" }];
  const result = await createQuoteSnapshots({ env: { IFIND_ACCESS_TOKEN: "test-access" }, fetcher: async (url, options) => {
    seen.push({ url, options });
    return json({ errorcode: 0, tables: [{ thscode: "603986.SH", time: ["2026-09-15 15:00:03"], table: {
      latest: [165.5], preClose: [160], volume: [0], tradeDate: [20260915], tradeTime: [150000],
    } }] });
  } }).load(more);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url.href, "https://quantapi.51ifind.com/api/v1/real_time_quotation");
  assert.equal(new Headers(seen[0]!.options.headers).get("access_token"), "test-access");
  assert.deepEqual(JSON.parse(String(seen[0]!.options.body)), { codes: "603986.SH,300750.SZ,920185.BJ", indicators: "latest,preClose,tradeDate,tradeTime" });
  assert.equal(result.updates[0]!.price, 165.5);
  assert.equal(result.updates[0]!.volume, null);
  assert.equal(Date.parse(result.updates[0]!.as_of!), Date.parse("2026-09-15T07:00:00Z"));
  assert.equal(result.updates[0]!.market_status, "unknown");
  assert.equal(result.providers[0]!.status, "limited");
});

test("iFinD missing event times remain missing and returned errors never reveal tokens", async () => {
  for (const time of ["2026-09-15", "", null]) {
    const result = await createQuoteSnapshots({ env: { IFIND_ACCESS_TOKEN: "private" }, fetcher: async () => json({ errorcode: 0, tables: [
      { thscode: "603986.SH", time: [time], table: { latest: [165.5], preClose: [160] } },
    ] }) }).load([cn]);
    assert.equal(result.updates[0]!.as_of, null);
    assert.equal(result.updates[0]!.volume, null);
    assert.equal(result.providers[0]!.status, "limited");
  }
  const result = await createQuoteSnapshots({ env: { IFIND_ACCESS_TOKEN: "private" }, fetcher: async () => json({ errorcode: -102, errmsg: "bad token private", tables: [] }) }).load([cn]);
  assert.equal(result.providers[0]!.status, "error");
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("iFinD refresh-token acquisition is shared only in memory and never rotates tokens", async () => {
  const seen: string[] = [];
  const source = createQuoteSnapshots({ env: { IFIND_REFRESH_TOKEN: "test-refresh" }, now: () => NOW, fetcher: async (url, options) => {
    seen.push(url.pathname);
    if (url.pathname.endsWith("get_access_token")) {
      assert.equal(new Headers(options.headers).get("refresh_token"), "test-refresh");
      return json({ errorcode: 0, data: { access_token: "test-acquired" } });
    }
    assert.equal(new Headers(options.headers).get("access_token"), "test-acquired");
    return json({ errorcode: 0, tables: [] });
  } });
  await Promise.all([source.load([cn]), source.load([cn])]);
  await source.load([cn]);
  assert.equal(seen.filter((path) => path.endsWith("get_access_token")).length, 1);
  assert.equal(seen.filter((path) => path.endsWith("real_time_quotation")).length, 3);
});

test("timeouts cover ignored cancellation and stalled response bodies", async () => {
  const handlers: QuoteFetch[] = [async () => new Promise<Response>(() => {}), async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"price":'));
  } }))];
  for (const fetcher of handlers) {
    const result = await createQuoteSnapshots({ env: token, timeoutMs: 15, fetcher }).load([cn]);
    assert.equal(result.providers[0]!.status, "error");
    assert.match(result.updates[0]!.message!, /超时/);
  }
});

test("oversized, malformed, zero and timestamp-free payloads never become live quotes", async () => {
  const responses = [() => new Response("x", { headers: { "Content-Length": String(QUOTE_RESPONSE_LIMIT + 1) } }),
    () => new Response("x".repeat(QUOTE_RESPONSE_LIMIT + 1)), () => new Response("<html>blocked</html>"),
    () => json({ errorcode: 0 }), () => json({ errorcode: 0, tables: {} }), () => json({})];
  for (const response of responses) {
    const result = await createQuoteSnapshots({ env: token, fetcher: async () => response() }).load([cn]);
    assert.equal(result.updates[0]!.price, undefined);
    assert.equal(result.providers[0]!.status, "error");
  }
});

test("an aborted load makes no request", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const result = await createQuoteSnapshots({ env: token, fetcher: async () => { calls++; return json({}); } }).load([cn], controller.signal);
  assert.equal(calls, 0);
  assert.equal(result.providers[0]!.status, "error");
});
