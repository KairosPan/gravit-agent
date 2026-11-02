// face/tests/edgar.test.ts
/** The EDGAR reader (src/edgar.ts): the submissions parse (the forms since a date, SEC's order, acceptance read on
 * New York's wall clock despite its `Z`), and the reader over a fake fetch - the contact header on every request, one
 * ticker map per ET date, `BRK.B` as `BRK-B`, the 200 ms pace, and each symbol's own error. A fake fetch over
 * in-memory bodies records each URL and its headers; nothing reaches sec.gov. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EDGAR_RESPONSE_MAX, EDGAR_SPACING_MS, EDGAR_SUBMISSIONS, EDGAR_TICKERS_URL,
  createEdgar, parseSubmissions, type EdgarFetch,
} from "../src/edgar.ts";

const FILINGS = { filings: { recent: { form: ["4", "8-K", "10-Q", "8-K/A", "S-3", "8-K"], filingDate: ["2026-11-30", "2026-11-30", "2026-11-27", "2026-11-25", "2026-11-24", "2026-11-10"],
  accessionNumber: ["0001-26-000009", "0001045810-26-000123", "x3", "x4", "x5", "x6"],
  acceptanceDateTime: ["2026-11-30T16:31:02.000Z", "2026-11-30T10:05:12.000Z", "2026-11-27T16:00:00.000Z", "2026-11-25T17:45:00.000Z", "", "2026-11-10T08:00:00.000Z"],
  items: ["", "2.02,9.01", "", "5.02", "", "7.01"], primaryDocument: ["xslF345X05/form4.xml", "nvda-20261130.htm", "q.htm", "", "s3.htm", "old.htm"] } } };
const FORMS = ["8-K", "8-K/A", "4"] as const;

test("parseSubmissions keeps the forms since the date and reads acceptance in New York", () => {
  const got = parseSubmissions("NVDA", 1045810, FILINGS, FORMS, "2026-11-20");
  assert.deepEqual(got.map((f) => [f.form, f.accession]), [["4", "0001-26-000009"], ["8-K", "0001045810-26-000123"], ["8-K/A", "x4"]]);
  assert.equal(got[1].accepted, "2026-11-30T10:05:12-05:00");
  assert.equal(got[0].accepted, "2026-11-30T16:31:02-05:00");
  assert.equal(got[1].items, "2.02,9.01");
  assert.equal(got[0].items, null);
  assert.equal(got[2].primaryDocument, null);
  assert.equal(got[1].url, "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000123/nvda-20261130.htm");
  assert.equal(got[2].url, "https://www.sec.gov/Archives/edgar/data/1045810/x4/x4-index.htm");
  assert.deepEqual(got[1], {
    symbol: "NVDA", cik: 1045810, accession: "0001045810-26-000123", form: "8-K", filingDate: "2026-11-30",
    accepted: "2026-11-30T10:05:12-05:00", items: "2.02,9.01", primaryDocument: "nvda-20261130.htm",
    url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000123/nvda-20261130.htm",
  });
});

test("acceptance in summer is EDT and a missing one is null", () => {
  const one = (accepted: unknown): unknown => parseSubmissions("NVDA", 1, { filings: { recent: {
    form: ["8-K"], filingDate: ["2026-07-01"], accessionNumber: ["a-1"], acceptanceDateTime: [accepted], items: ["8.01"], primaryDocument: ["d.htm"],
  } } }, FORMS, "2026-01-01")[0];
  assert.equal((one("2026-07-01T10:00:00.000Z") as { accepted: string }).accepted, "2026-07-01T10:00:00-04:00");
  assert.equal((one("2026-07-01T10:00:00Z") as { accepted: string }).accepted, "2026-07-01T10:00:00-04:00");
  for (const bad of ["", undefined, null, "yesterday", "2026-13-01T10:00:00.000Z", "2026-03-08T02:30:00.000Z"]) {
    assert.equal((one(bad) as { accepted: unknown }).accepted, null, String(bad));
  }
});

test("parseSubmissions refuses a body with no filings.recent and skips an entry it cannot read", () => {
  assert.throws(() => parseSubmissions("NVDA", 1, {}, FORMS, "2026-01-01"), /filings\.recent/);
  assert.throws(() => parseSubmissions("NVDA", 1, { filings: { recent: { form: "8-K" } } }, FORMS, "2026-01-01"), /filings\.recent/);
  const got = parseSubmissions("NVDA", 1, { filings: { recent: {
    form: ["8-K", "8-K", 4], filingDate: ["2026-11-30", 20261130, "2026-11-30"], accessionNumber: ["a-1", "a-2", "a-3"],
  } } }, FORMS, "2026-01-01");
  assert.deepEqual(got.map((f) => [f.accession, f.accepted, f.items, f.url]), [["a-1", null, null, "https://www.sec.gov/Archives/edgar/data/1/a1/a-1-index.htm"]]);
});

/* ---------- the reader, over a fake fetch ---------- */

const TICKERS = {
  "0": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
  "1": { cik_str: 1067983, ticker: "BRK-B", title: "BERKSHIRE HATHAWAY INC" },
  "2": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
  "3": { cik_str: 789019, ticker: "MSFT", title: "MICROSOFT CORP" },
};
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Call { url: string; headers: Record<string, string>; signal: AbortSignal }
/** A fetch over `routes` (a URL to its response, or a function of the call); an unrouted URL is a 404. */
function fake(routes: Record<string, Response | ((call: Call) => Promise<Response> | Response)>): { fetch: EdgarFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: EdgarFetch = async (url, init) => {
    const call = { url, headers: init.headers, signal: init.signal };
    calls.push(call);
    const route = routes[url];
    if (route === undefined) return new Response("not found", { status: 404 });
    return typeof route === "function" ? route(call) : route.clone();
  };
  return { fetch, calls };
}
const live = (): { stopAfterMs: number; signal: AbortSignal } => ({ stopAfterMs: 90_000, signal: new AbortController().signal });
const NOV30 = Date.parse("2026-11-30T15:00:00Z");

test("recentFilings sends the contact header, reads the ticker map once a day, spaces requests and names each symbol's error", async () => {
  const { fetch, calls } = fake({
    [EDGAR_TICKERS_URL]: json(TICKERS),
    [EDGAR_SUBMISSIONS(1045810)]: json(FILINGS),
    [EDGAR_SUBMISSIONS(1067983)]: json({ filings: { recent: { form: [], filingDate: [], accessionNumber: [] } } }),
    [EDGAR_SUBMISSIONS(320193)]: new Response("Forbidden", { status: 403 }),
    [EDGAR_SUBMISSIONS(789019)]: new Response("oops", { status: 500 }),
  });
  let now = NOV30;
  const sleeps: number[] = [];
  const edgar = createEdgar({ fetch, userAgent: "ops@example.com", now: () => now, sleep: async (ms) => { sleeps.push(ms); } });

  const got = await edgar.recentFilings(["NVDA", "BRK.B", "ZZZZ", "AAPL", "MSFT"], FORMS, "2026-11-20", live());
  assert.deepEqual(got.filings.map((f) => [f.symbol, f.accession]), [["NVDA", "0001-26-000009"], ["NVDA", "0001045810-26-000123"], ["NVDA", "x4"]]);
  assert.deepEqual(got.errors, [{ symbol: "AAPL", error: "refused: HTTP 403" }, { symbol: "MSFT", error: "HTTP 500" }]);
  assert.deepEqual(calls.map((c) => c.url), [
    EDGAR_TICKERS_URL, EDGAR_SUBMISSIONS(1045810), EDGAR_SUBMISSIONS(1067983), EDGAR_SUBMISSIONS(320193), EDGAR_SUBMISSIONS(789019),
  ]);
  assert.equal(EDGAR_SUBMISSIONS(1067983), "https://data.sec.gov/submissions/CIK0001067983.json");
  for (const c of calls) {
    assert.equal(c.headers["User-Agent"], "ops@example.com");
    assert.equal(c.headers.Accept, "application/json");
    assert.ok(c.signal instanceof AbortSignal);
  }
  assert.equal(EDGAR_SPACING_MS, 200);
  assert.deepEqual(sleeps, [200, 200, 200, 200], "a pause before every request but the first; ZZZZ makes none");

  // the same ET date: the map is not read again; the next date reads it once more
  now = Date.parse("2026-12-01T04:59:00Z");
  await edgar.recentFilings(["NVDA"], FORMS, "2026-11-20", live());
  assert.equal(calls.filter((c) => c.url === EDGAR_TICKERS_URL).length, 1);
  now = Date.parse("2026-12-01T05:00:00Z");
  await edgar.recentFilings(["NVDA"], FORMS, "2026-11-20", live());
  assert.equal(calls.filter((c) => c.url === EDGAR_TICKERS_URL).length, 2);
});

test("a symbol not started within stopAfterMs is deadline, and so is every one after it", async () => {
  let now = NOV30;
  const { fetch, calls } = fake({
    [EDGAR_TICKERS_URL]: () => { now += 50_000; return json(TICKERS); },
    [EDGAR_SUBMISSIONS(1045810)]: () => { now += 50_000; return json(FILINGS); },
  });
  const edgar = createEdgar({ fetch, userAgent: "ops@example.com", now: () => now, sleep: async () => {} });
  const got = await edgar.recentFilings(["NVDA", "AAPL", "MSFT"], FORMS, "2026-11-20", live());
  assert.equal(got.filings.length, 3);
  assert.deepEqual(got.errors, [{ symbol: "AAPL", error: "deadline" }, { symbol: "MSFT", error: "deadline" }]);
  assert.equal(calls.length, 2);
});

test("a failed ticker map is every symbol's error, and the next poll asks for it again", async () => {
  let refuse = true;
  const { fetch, calls } = fake({
    [EDGAR_TICKERS_URL]: () => (refuse ? new Response("no", { status: 403 }) : json(TICKERS)),
    [EDGAR_SUBMISSIONS(1045810)]: json(FILINGS),
  });
  const edgar = createEdgar({ fetch, userAgent: "ops@example.com", now: () => NOV30, sleep: async () => {} });
  const got = await edgar.recentFilings(["NVDA", "ZZZZ"], FORMS, "2026-11-20", live());
  assert.deepEqual(got, { filings: [], errors: [{ symbol: "NVDA", error: "refused: HTTP 403" }, { symbol: "ZZZZ", error: "refused: HTTP 403" }] });
  refuse = false;
  const again = await edgar.recentFilings(["NVDA"], FORMS, "2026-11-20", live());
  assert.equal(again.filings.length, 3);
  assert.equal(calls.filter((c) => c.url === EDGAR_TICKERS_URL).length, 2);

  const broken = createEdgar({ fetch: fake({ [EDGAR_TICKERS_URL]: json(["NVDA"]) }).fetch, userAgent: "u", now: () => NOV30, sleep: async () => {} });
  const shape = await broken.recentFilings(["NVDA"], FORMS, "2026-11-20", live());
  assert.match(shape.errors[0].error, /ticker map/);
});

test("a body over 16 MiB, a thrown fetch and a bad body are that symbol's error, its first line at most 200 characters", async () => {
  assert.equal(EDGAR_RESPONSE_MAX, 16 * 1024 * 1024);
  const { fetch } = fake({
    [EDGAR_TICKERS_URL]: json(TICKERS),
    [EDGAR_SUBMISSIONS(1045810)]: () => new Response("x".repeat(EDGAR_RESPONSE_MAX + 1)),
    [EDGAR_SUBMISSIONS(1067983)]: () => { throw new Error(`socket hang up\nat somewhere`); },
    [EDGAR_SUBMISSIONS(320193)]: () => { throw new Error("y".repeat(300)); },
    [EDGAR_SUBMISSIONS(789019)]: () => new Response("<html>not json</html>"),
  });
  const edgar = createEdgar({ fetch, userAgent: "u", now: () => NOV30, sleep: async () => {} });
  const got = await edgar.recentFilings(["NVDA", "BRK.B", "AAPL", "MSFT"], FORMS, "2026-11-20", live());
  assert.deepEqual(got.errors.slice(0, 3), [
    { symbol: "NVDA", error: "response over 16 MiB" },
    { symbol: "BRK.B", error: "socket hang up" },
    { symbol: "AAPL", error: "y".repeat(200) },
  ]);
  assert.equal(got.errors[3].symbol, "MSFT");
  assert.doesNotMatch(got.errors[3].error, /\n/);
  assert.ok(got.errors[3].error.length > 0 && got.errors[3].error.length <= 200);
});

test("the poll's signal reaches each request, and once it aborts no further request is made", async () => {
  const ctl = new AbortController();
  const { fetch, calls } = fake({
    [EDGAR_TICKERS_URL]: json(TICKERS),
    [EDGAR_SUBMISSIONS(1045810)]: (call) => new Promise<Response>((_, reject) => {
      call.signal.addEventListener("abort", () => reject(call.signal.reason));
      ctl.abort();
    }),
  });
  const edgar = createEdgar({ fetch, userAgent: "u", now: () => NOV30, sleep: async () => {} });
  const got = await edgar.recentFilings(["NVDA", "AAPL"], FORMS, "2026-11-20", { stopAfterMs: 90_000, signal: ctl.signal });
  assert.equal(got.errors.length, 2);
  assert.match(got.errors[0].error, /abort/i);
  assert.match(got.errors[1].error, /abort/i);
  assert.equal(calls.length, 2, "AAPL is never asked for");
});

test("edgar.ts reaches nothing that can order", async () => {
  const source = await readFile(new URL("../src/edgar.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /account-seat|account-proxy|orders|place_order|cancel_order/);
  const imports = [...source.matchAll(/^import\s.*?from\s+"([^"]+)"/gms)].map((m) => m[1]);
  assert.deepEqual(imports, ["./et.ts"]);
  assert.doesNotMatch(source, /\bimport\(/);
});
