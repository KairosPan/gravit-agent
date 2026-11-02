/** The desk's quotes from the Market's reads (src/market-quotes.ts marketQuotes): a US share by one explore read per
 * symbol through the proxy's `explore` route, an A share by the proxy's `quotes` route twelve pairs at a time, a row's
 * timed price as the quote, and every failure honest - no price invented. The Account is a local stub server; nothing
 * leaves 127.0.0.1. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { registerAccountProxy, type AccountAnswer } from "../src/account-proxy.ts";
import { HttpError } from "../src/http.ts";
import { CN_QUOTES_BATCH, feedOf, marketQuotes, type MarketQuoteIdentity } from "../src/market-quotes.ts";
import { buildBrief } from "../src/brief.ts";
import { deskToolDefinitions } from "../src/desk-tools.ts";
import type { RouteRegistrar } from "../src/static.ts";

const NOW = Date.parse("2026-11-02T20:30:00Z");
const us = (symbol: string): MarketQuoteIdentity => ({ id: `us:${symbol}`, market: "us", symbol });
const cn = (symbol: string): MarketQuoteIdentity => ({ id: `cn:${symbol}`, market: "cn", symbol });
const noRoutes: RouteRegistrar = { register() {} } as unknown as RouteRegistrar;
/** A read that is never asked: the test's other market's. */
const unasked = async (): Promise<AccountAnswer> => { throw new Error("not asked in this test"); };

/** A stub Account answering `GET /api/account/explore` (and `GET /api/account/quotes`, when `quotes` is given),
 * recording each query. */
async function stubAccount(
  answer: (q: URLSearchParams) => { status: number; body: unknown },
  quotes?: (q: URLSearchParams) => { status: number; body: unknown },
): Promise<{ url: string; asked: URLSearchParams[]; quoted: URLSearchParams[]; server: Server }> {
  const asked: URLSearchParams[] = [];
  const quoted: URLSearchParams[] = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/api/account/quotes" && quotes !== undefined) {
      quoted.push(u.searchParams);
      const a = quotes(u.searchParams);
      res.writeHead(a.status, { "content-type": "application/json" }).end(JSON.stringify(a.body));
      return;
    }
    if (u.pathname !== "/api/account/explore") { res.writeHead(404).end(); return; }
    asked.push(u.searchParams);
    const a = answer(u.searchParams);
    res.writeHead(a.status, { "content-type": "application/json" }).end(JSON.stringify(a.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked, quoted, server };
}

const ROWS: Record<string, unknown> = {
  NVDA: { key: "stock:NVDA", kind: "stock", name: "NVIDIA", price: 182.31, change24h: 2.16, changePct24h: 1.2, quoteFrom: "Nasdaq · real time", quoteAt: "2026-11-02T20:21:03Z" },
  SPY: { key: "stock:SPY", kind: "stock", name: "SPDR S&P 500", price: 600, change24h: -6, quoteFrom: "Cboe · 15 min delayed", quoteAt: "2026-11-02T20:06:00Z" },
  UNTIMED: { key: "stock:UNTIMED", kind: "stock", name: "x", price: 10 },
};
const explore = (q: URLSearchParams) => {
  const row = ROWS[q.get("q") ?? ""];
  return { status: 200, body: { ok: true, asOf: "x", tabs: [], items: row ? [row, { key: "rwa:NVDA", price: 999, quoteAt: "2026-11-02T20:21:03Z" }] : [], movers: [], closing: [], mostTraded: [], missing: [], notes: [] } };
};

/** The Account's China row for `symbol`, as its `quotes` route answers one. */
const chinaRow = (symbol: string, price = 1452.3) => ({
  venue: "china", symbol,
  market: {
    symbol, name: symbol, kind: "stock", price, quoteAt: "2026-12-01T06:03:12Z", quoteFrom: "Tencent", change24h: 12.24, changePct24h: 0.85,
    cn: { prevClose: 1440.06, phase: "trading", quoteStatus: "live", lastSession: "2026-12-01", volume: 31200 },
  },
});
/** The pairs one `quotes` query asks for, as `[venue, symbol]`. */
const pairsOf = (query: string): string[] => (new URLSearchParams(query).get("pairs") ?? "").split(",");
/** A `quotes` answer pricing every pair asked. */
const quotesAnswer = (query: string): AccountAnswer => ({
  status: 200, body: JSON.stringify({ ok: true, quotes: pairsOf(query).map((pair) => chinaRow(pair.slice(pair.indexOf("|") + 1))) }),
});

test("the Market's explore row becomes a timed quote; unknown and untimed symbols have no price", async (t) => {
  const stub = await stubAccount(explore);
  t.after(() => stub.server.close());
  const proxy = registerAccountProxy(noRoutes, { url: stub.url });
  t.after(() => proxy.dispose());
  const source = marketQuotes({ explore: proxy.explore, quotes: proxy.quotes, now: () => NOW });
  assert.equal(source.unavailable, undefined);
  const payload = await source.snapshot([us("NVDA"), us("SPY"), us("ZZZZ"), us("UNTIMED")]);
  assert.deepEqual(stub.asked.map((q) => [q.get("q"), q.get("key"), q.get("limit")]).sort(),
    [["NVDA", "stock:NVDA", "1"], ["SPY", "stock:SPY", "1"], ["UNTIMED", "stock:UNTIMED", "1"], ["ZZZZ", "stock:ZZZZ", "1"]]);
  assert.equal(stub.quoted.length, 0, "no A share asked, no quotes read");
  const [nvda, spy, zzzz, untimed] = payload.quotes;
  assert.equal(nvda?.id, "us:NVDA");
  assert.equal(nvda?.price, 182.31, "the stock row, never the rwa token's");
  assert.equal(nvda?.as_of, "2026-11-02T20:21:03Z");
  assert.equal(nvda?.prev_close, 180.15);
  assert.equal(nvda?.change, 2.16);
  assert.equal(nvda?.change_pct, 1.199);
  assert.equal(nvda?.feed, "nasdaq");
  assert.equal(nvda?.source, "market");
  assert.equal(nvda?.quote_status, "live");
  assert.equal(nvda?.market_status, "unknown");
  assert.equal(nvda?.cn, undefined, "a US quote carries no cn");
  assert.equal(spy?.feed, "cboe delayed");
  assert.equal(spy?.quote_status, "delayed");
  assert.equal(spy?.prev_close, 606);
  assert.equal(zzzz?.price, null);
  assert.equal(zzzz?.quote_status, "unavailable");
  assert.match(zzzz?.message ?? "", /^the Market read lists no US share ZZZZ$/);
  assert.equal(untimed?.price, null, "a price without its time is no price");
  assert.match(untimed?.message ?? "", /^the Market read has no timed price for UNTIMED$/);
  assert.deepEqual(payload.providers.map((p) => [p.id, p.market, p.source, p.status]), [["market", "us", "market", "connected"]]);
  // the proxy's explore cache serves the second ask
  await source.snapshot([us("NVDA")]);
  assert.equal(stub.asked.filter((q) => q.get("q") === "NVDA").length, 1);
});

test("an Account not running, a disabled row, a refusal and a busy Account are said, never priced", async (t) => {
  const downProxy = registerAccountProxy(noRoutes, { url: "http://127.0.0.1:9" });
  const down = marketQuotes({ explore: downProxy.explore, quotes: downProxy.quotes });
  await assert.rejects(down.snapshot([us("NVDA")]), /the Account is not reachable/);
  const offProxy = registerAccountProxy(noRoutes, { disabled: true });
  const off = marketQuotes({ explore: offProxy.explore, quotes: offProxy.quotes });
  await assert.rejects(off.snapshot([us("NVDA")]), /the Account seat row is disabled/);
  await assert.rejects(off.snapshot([cn("600519")]), /the Account seat row is disabled/);
  const slow = marketQuotes({ explore: async () => ({ unreachable: "timeout" }), quotes: unasked });
  await assert.rejects(slow.snapshot([us("NVDA")]), /did not answer in time/);
  const busy = marketQuotes({ explore: async () => ({ status: 429, body: "{}" }), quotes: unasked });
  await assert.rejects(busy.snapshot([us("NVDA")]), (e: unknown) => e instanceof HttpError && e.status === 429);
  const busyCn = marketQuotes({ explore: unasked, quotes: async () => ({ status: 429, body: "{}" }) });
  await assert.rejects(busyCn.snapshot([cn("600519")]), (e: unknown) => e instanceof HttpError && e.status === 429);

  const refusing = await stubAccount(() => ({ status: 409, body: { ok: false, refusal: { message: "the account layer is not mounted" } } }));
  t.after(() => refusing.server.close());
  const refusingProxy = registerAccountProxy(noRoutes, { url: refusing.url });
  const refused = await marketQuotes({ explore: refusingProxy.explore, quotes: refusingProxy.quotes }).snapshot([us("NVDA")]);
  assert.equal(refused.quotes[0]?.price, null);
  assert.equal(refused.quotes[0]?.message, "the Market read refused: the account layer is not mounted");
  assert.equal(refused.providers[0]?.status, "limited");
});

test("a snapshot keeps at most its concurrency in flight and answers in the order asked", async () => {
  let open = 0;
  let most = 0;
  const source = marketQuotes({
    concurrency: 3,
    quotes: unasked,
    explore: async (query) => {
      open++; most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 2));
      open--;
      return { status: 200, body: JSON.stringify(explore(new URLSearchParams(query)).body) };
    },
  });
  const symbols = ["NVDA", "SPY", "A", "B", "C", "D", "E", "NVDA"];
  const payload = await source.snapshot(symbols.map(us));
  assert.ok(most <= 3, `at most 3 in flight, saw ${most}`);
  assert.deepEqual(payload.quotes.map((q) => q.symbol), symbols);
});

test("feedOf names each of the Account's feeds in the Market's words", () => {
  assert.equal(feedOf("Robinhood · real time"), "robinhood");
  assert.equal(feedOf("Nasdaq · real time"), "nasdaq");
  assert.equal(feedOf("Cboe · 15 min delayed"), "cboe delayed");
  assert.equal(feedOf("Tencent"), "tencent");
  assert.equal(feedOf("  Some · New   Feed "), "some new feed");
  assert.equal(feedOf("X".repeat(60)).length, 40);
  assert.equal(feedOf(""), "");
});

test("an A-share snapshot asks the quotes read twelve pairs at a time, sorted, and maps the China row", async () => {
  assert.equal(CN_QUOTES_BATCH, 12);
  const asked: string[] = [];
  const source = marketQuotes({ explore: unasked, quotes: async (query) => { asked.push(query); return quotesAnswer(query); }, now: () => NOW });
  const codes = ["600519", "000013", "000012", "000011", "000010", "000009", "000008", "000007", "000006", "000005", "000004", "000003", "000001"];
  const payload = await source.snapshot(codes.map(cn));
  const sorted = [...codes].sort();
  assert.deepEqual(asked.map(pairsOf), [sorted.slice(0, 12).map((code) => `china|${code}`), [`china|${sorted[12]}`]]);
  assert.deepEqual(payload.quotes.map((q) => q.symbol), codes, "the order asked, not the order read");
  const moutai = payload.quotes[0]!;
  assert.deepEqual(
    {
      id: moutai.id, market: moutai.market, symbol: moutai.symbol, price: moutai.price, prev_close: moutai.prev_close, change_pct: moutai.change_pct,
      as_of: moutai.as_of, feed: moutai.feed, source: moutai.source, quote_status: moutai.quote_status, market_status: moutai.market_status, cn: moutai.cn,
    },
    {
      id: "cn:600519", market: "cn", symbol: "600519", price: 1452.3, prev_close: 1440.06, change_pct: 0.85, as_of: "2026-12-01T06:03:12Z",
      feed: "tencent", source: "market", quote_status: "live", market_status: "open", cn: { phase: "trading", lastSession: "2026-12-01" },
    },
  );
  assert.equal(moutai.change, 12.24);
  assert.equal(moutai.volume, 31200);
  assert.equal(moutai.message, "");
  assert.deepEqual(payload.providers.map((p) => [p.id, p.market, p.status]), [["market", "cn", "connected"]]);

  /* the midday break and the close are closed; a body marked stale is stale */
  const phased = marketQuotes({
    explore: unasked,
    quotes: async (query) => {
      const rows = pairsOf(query).map((pair) => {
        const row = chinaRow(pair.slice(6));
        row.market.cn.phase = pair.endsWith("1") ? "midday" : "closed";
        return row;
      });
      return { status: 200, body: JSON.stringify({ ok: true, stale: true, quotes: rows }) };
    },
  });
  const later = await phased.snapshot([cn("000001"), cn("000002")]);
  assert.deepEqual(later.quotes.map((q) => [q.market_status, q.cn?.phase, q.quote_status]), [["closed", "midday", "stale"], ["closed", "closed", "stale"]]);
});

test("a refused pair, a missing code, an untimed row, a refused read and a body with no JSON are said, never priced", async () => {
  const source = marketQuotes({
    explore: unasked,
    quotes: async () => ({
      status: 200,
      body: JSON.stringify({
        ok: true,
        quotes: [
          { venue: "china", symbol: "000000", refusal: { code: "E_ACCOUNT_BAD_ACTION", message: "no A-share quote for 000000" } },
          { venue: "china", symbol: "000003", market: { symbol: "000003", quoteFrom: "Tencent", cn: { phase: "trading", quoteStatus: "live", lastSession: null } } },
          chinaRow("600519"),
        ],
      }),
    }),
  });
  const payload = await source.snapshot([cn("000000"), cn("000002"), cn("000003"), cn("600519")]);
  assert.deepEqual(payload.quotes.map((q) => [q.symbol, q.price, q.quote_status, q.message]), [
    ["000000", null, "unavailable", "no A-share quote for 000000"],
    ["000002", null, "unavailable", "the Market read lists no A share 000002"],
    ["000003", null, "unavailable", "the Market read has no timed price for 000003"],
    ["600519", 1452.3, "live", ""],
  ]);
  assert.equal(payload.quotes[0]?.market, "cn");

  const refused = await marketQuotes({
    explore: unasked,
    quotes: async () => ({ status: 409, body: JSON.stringify({ ok: false, refusal: { message: "the account layer is not mounted" } }) }),
  }).snapshot([cn("600519"), cn("000001")]);
  assert.deepEqual(refused.quotes.map((q) => [q.symbol, q.price, q.message]), [
    ["600519", null, "the Market read refused: the account layer is not mounted"],
    ["000001", null, "the Market read refused: the account layer is not mounted"],
  ]);
  assert.equal(refused.providers[0]?.status, "limited");

  const html = await marketQuotes({ explore: unasked, quotes: async () => ({ status: 200, body: "<html>" }) }).snapshot([cn("600519"), cn("000001")]);
  assert.deepEqual(html.quotes.map((q) => q.message), ["the Market read answered 200 with no JSON", "the Market read answered 200 with no JSON"]);
});

test("one snapshot over both markets keeps the order asked and rejects only when no read answered", async () => {
  const exploreRead = async (query: string): Promise<AccountAnswer> => ({ status: 200, body: JSON.stringify(explore(new URLSearchParams(query)).body) });
  const both = marketQuotes({ explore: exploreRead, quotes: async (query) => quotesAnswer(query) });
  const payload = await both.snapshot([cn("600519"), us("NVDA")]);
  assert.equal(payload.quotes[0]?.symbol, "600519");
  assert.equal(payload.quotes[0]?.market, "cn");
  assert.equal(payload.quotes[1]?.symbol, "NVDA");
  assert.equal(payload.quotes[1]?.market, "us");
  assert.deepEqual(payload.providers.map((p) => [p.market, p.status]), [["us", "connected"], ["cn", "connected"]]);

  const gone = async (): Promise<AccountAnswer> => ({ unreachable: "unreachable" });
  await assert.rejects(marketQuotes({ explore: gone, quotes: gone }).snapshot([cn("600519"), us("NVDA")]), /the Account is not reachable/);

  const usOnly = await marketQuotes({ explore: exploreRead, quotes: gone }).snapshot([cn("600519"), us("NVDA")]);
  assert.deepEqual(usOnly.quotes.map((q) => [q.symbol, q.price, q.message]), [["600519", null, "the Account is not reachable"], ["NVDA", 182.31, ""]]);
  assert.deepEqual(usOnly.providers.map((p) => [p.market, p.status]), [["us", "connected"], ["cn", "error"]]);
  const cnOnly = await marketQuotes({ explore: gone, quotes: async (query) => quotesAnswer(query) }).snapshot([cn("600519"), us("NVDA")]);
  assert.deepEqual(cnOnly.quotes.map((q) => [q.symbol, q.price, q.message]), [["600519", 1452.3, ""], ["NVDA", null, "the Account is not reachable"]]);
});

test("the brief and desk_quotes over the Market: prices with their feed and time, an Account down said", async (t) => {
  const stub = await stubAccount(explore);
  t.after(() => stub.server.close());
  const proxy = registerAccountProxy(noRoutes, { url: stub.url });
  const source = marketQuotes({ explore: proxy.explore, quotes: proxy.quotes, now: () => NOW });
  const quotes = deskToolDefinitions({ quotes: source, readState: async () => ({}) as never, now: () => NOW }).find((d) => d.name === "desk_quotes")!;
  const exec = { signal: new AbortController().signal } as never;
  const answer = await quotes.execute({ symbols: ["NVDA"] }, exec) as { quotes: Array<{ price: number; feed: string }> };
  assert.equal(answer.quotes[0]?.price, 182.31);
  const text = quotes.output.render({ symbols: ["NVDA"] }, answer) as Array<{ text: string }>;
  assert.match(text[0]?.text ?? "", /^NVDA 182\.31, \+1\.20% vs prev close 180\.15 \| NASDAQ 15:21:03 ET \| poll \| live$/);

  const downProxy = registerAccountProxy(noRoutes, { url: "http://127.0.0.1:9" });
  const down = marketQuotes({ explore: downProxy.explore, quotes: downProxy.quotes });
  const downTool = deskToolDefinitions({ quotes: down, readState: async () => ({}) as never }).find((d) => d.name === "desk_quotes")!;
  assert.match((await downTool.execute({ symbols: ["NVDA"] }, exec) as { error: string }).error, /^unavailable: the Account is not reachable/);
  const root = `${import.meta.dirname}/tmp/market-quotes-none`; // no desk/ files there: the loaders say missing, nothing is written
  const brief = await buildBrief({ quotes: down, root, now: () => NOW }, { date: "2026-11-02", session: { open: "09:30", close: "16:00", early: false } } as never);
  assert.equal(brief.ok, false);
  assert.match((brief as { error: string }).error, /^quotes unavailable: the Account is not reachable/);
});
