// face/tests/market-news.test.ts
/** The face's headline read (src/market-news.ts): one GET of the Market's /api/news for all the symbols, each symbol's
 * headlines or why it has none, a refusal, a failure or no answer marking every symbol unavailable. Offline: fetch is a
 * stub. */
import test from "node:test";
import assert from "node:assert/strict";
import { NEWS_ABORT_MS, NEWS_SYMBOLS_MOST, marketNews } from "../src/market-news.ts";

const BASE = "http://127.0.0.1:4821";
const SINCE = "2026-11-06T21:00:00Z";

/** A fetch stub answering `status` with `body` as JSON, recording each URL asked. */
function stub(status: number, body: unknown): { fetch: typeof fetch; urls: string[]; inits: (RequestInit | undefined)[] } {
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const doFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    inits.push(init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: doFetch, urls, inits };
}

const NVDA_1 = { time: "2026-11-07T14:05:00Z", outlet: "Reuters", title: "Nvidia shares fall on export curbs", url: "https://www.nasdaq.com/articles/nvda-1" };
const NVDA_2 = { time: "2026-11-07T12:00:00Z", outlet: "Zacks", title: "Nvidia earnings preview", url: "https://www.nasdaq.com/articles/nvda-2" };

test("marketNews asks /api/news once for all the symbols with since, and maps each symbol's headlines", async () => {
  const s = stub(200, { ok: true, news: { NVDA: [NVDA_1, NVDA_2], AAPL: [] } });
  const read = marketNews({ fetch: s.fetch, baseUrl: BASE });
  const got = await read(["NVDA", "AAPL", "NVDA"], SINCE);
  assert.equal(s.urls.length, 1);
  const url = new URL(s.urls[0]!);
  assert.equal(`${url.origin}${url.pathname}`, `${BASE}/api/news`);
  assert.equal(url.searchParams.get("symbols"), "NVDA,AAPL");
  assert.equal(url.searchParams.get("since"), SINCE);
  assert.equal(s.inits[0]?.method ?? "GET", "GET");
  assert.deepEqual(got.get("NVDA"), { headlines: [NVDA_1, NVDA_2] });
  assert.deepEqual(got.get("AAPL"), { headlines: [] });
  assert.equal(got.size, 2);
  assert.equal(NEWS_ABORT_MS, 10_000);

  const none = stub(200, { ok: true, news: {} });
  assert.equal((await marketNews({ fetch: none.fetch, baseUrl: BASE })([], SINCE)).size, 0);
  assert.equal(none.urls.length, 0, "no symbols, no request");
});

test("marketNews reads FACE_MARKET_URL when no base is given", async () => {
  const before = process.env.FACE_MARKET_URL;
  process.env.FACE_MARKET_URL = "http://127.0.0.1:59999";
  try {
    const s = stub(200, { ok: true, news: { NVDA: [] } });
    await marketNews({ fetch: s.fetch })(["NVDA"], SINCE);
    assert.ok(s.urls[0]!.startsWith("http://127.0.0.1:59999/api/news?"));
  } finally {
    if (before === undefined) delete process.env.FACE_MARKET_URL;
    else process.env.FACE_MARKET_URL = before;
  }
});

test("a 409, a 500 or no answer in 10 s marks every symbol unavailable with the reason", async () => {
  const refused = stub(409, { ok: false, refusal: { ok: false, code: "UPSTREAM_DOWN", layer: "source", message: "纳斯达克新闻源不可用" } });
  const r409 = await marketNews({ fetch: refused.fetch, baseUrl: BASE })(["NVDA", "AAPL"], SINCE);
  for (const sym of ["NVDA", "AAPL"]) assert.deepEqual(r409.get(sym), { unavailable: "the Market refused (UPSTREAM_DOWN): 纳斯达克新闻源不可用" });

  const failed = stub(500, { ok: false, error: "boom" });
  const r500 = await marketNews({ fetch: failed.fetch, baseUrl: BASE })(["NVDA", "AAPL"], SINCE);
  for (const sym of ["NVDA", "AAPL"]) assert.deepEqual(r500.get(sym), { unavailable: "the Market answered 500" });

  const bad = stub(400, { ok: false, error: "symbols is 1 to 10 US tickers, comma-separated, e.g. INTC,CRWV" });
  const r400 = await marketNews({ fetch: bad.fetch, baseUrl: BASE })(["NVDA"], SINCE);
  assert.deepEqual(r400.get("NVDA"), { unavailable: "the Market answered 400: symbols is 1 to 10 US tickers, comma-separated, e.g. INTC,CRWV" });

  let aborted = false;
  const silent = (async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); });
  })) as typeof fetch;
  const rSilent = await marketNews({ fetch: silent, baseUrl: BASE, abortMs: 20 })(["NVDA", "AAPL"], SINCE);
  assert.ok(aborted, "the read is aborted at its deadline");
  for (const sym of ["NVDA", "AAPL"]) assert.deepEqual(rSilent.get(sym), { unavailable: "the Market did not answer: timeout" });

  const down = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }) as typeof fetch;
  const rDown = await marketNews({ fetch: down, baseUrl: BASE })(["NVDA"], SINCE);
  assert.deepEqual(rDown.get("NVDA"), { unavailable: "the Market did not answer: ECONNREFUSED" });

  const notJson = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
  const rNotJson = await marketNews({ fetch: notJson, baseUrl: BASE })(["NVDA"], SINCE);
  assert.deepEqual(rNotJson.get("NVDA"), { unavailable: "the Market's answer is not its news shape" });
});

test("a symbol the answer lists under unavailable stays unavailable", async () => {
  const s = stub(200, { ok: true, news: { NVDA: [NVDA_1] }, unavailable: { AAPL: "Nasdaq 的新闻源超时" } });
  const got = await marketNews({ fetch: s.fetch, baseUrl: BASE })(["NVDA", "AAPL", "TSLA"], SINCE);
  assert.deepEqual(got.get("NVDA"), { headlines: [NVDA_1] });
  assert.deepEqual(got.get("AAPL"), { unavailable: "Nasdaq 的新闻源超时" });
  assert.deepEqual(got.get("TSLA"), { unavailable: "the Market's answer does not list it" });

  const odd = stub(200, { ok: true, news: { NVDA: [NVDA_1, { time: 5, outlet: "x" }, "junk"] } });
  assert.deepEqual((await marketNews({ fetch: odd.fetch, baseUrl: BASE })(["NVDA"], SINCE)).get("NVDA"), { headlines: [NVDA_1] },
    "a headline not of the shape is left out");
});

test("eleven symbols are asked in two GETs of at most ten, and a failing GET leaves the other's headlines intact", async () => {
  assert.equal(NEWS_SYMBOLS_MOST, 10);
  const symbols = Array.from({ length: 11 }, (_, i) => `S${String.fromCharCode(65 + i)}`);
  const urls: string[] = [];
  const doFetch = (async (url: string | URL | Request) => {
    urls.push(String(url));
    const asked = new URL(String(url)).searchParams.get("symbols")!.split(",");
    if (asked.includes("SK")) return new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 });
    return new Response(JSON.stringify({ ok: true, news: Object.fromEntries(asked.map((s) => [s, [NVDA_1]])) }), { status: 200 });
  }) as typeof fetch;
  const got = await marketNews({ fetch: doFetch, baseUrl: BASE })(symbols, SINCE);
  assert.equal(urls.length, 2);
  const sizes = urls.map((u) => new URL(u).searchParams.get("symbols")!.split(",").length).sort((a, b) => a - b);
  assert.deepEqual(sizes, [1, 10]);
  for (const sym of symbols.slice(0, 10)) assert.deepEqual(got.get(sym), { headlines: [NVDA_1] });
  assert.deepEqual(got.get("SK"), { unavailable: "the Market answered 500" });
});

test("symbols are upper-cased, and one not a US ticker is left out without failing the rest", async () => {
  const s = stub(200, { ok: true, news: { NVDA: [NVDA_1], "BRK.B": [] } });
  const got = await marketNews({ fetch: s.fetch, baseUrl: BASE })(["nvda", "brk.b", "600519", "TOOLONG"], SINCE);
  assert.equal(s.urls.length, 1);
  assert.equal(new URL(s.urls[0]!).searchParams.get("symbols"), "NVDA,BRK.B");
  assert.deepEqual(got.get("NVDA"), { headlines: [NVDA_1] });
  assert.deepEqual(got.get("BRK.B"), { headlines: [] });
  assert.deepEqual(got.get("600519"), { unavailable: "not a US ticker" });
  assert.deepEqual(got.get("TOOLONG"), { unavailable: "not a US ticker" });

  const none = stub(200, { ok: true, news: {} });
  const only = await marketNews({ fetch: none.fetch, baseUrl: BASE })(["600519"], SINCE);
  assert.equal(none.urls.length, 0, "nothing to ask, no request");
  assert.deepEqual(only.get("600519"), { unavailable: "not a US ticker" });
});
