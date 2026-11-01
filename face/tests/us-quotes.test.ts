/** The desk's US quotes from the Account's market read (src/us-quotes.ts accountUsQuotes): one explore read per
 * symbol through the proxy's `explore` route, a row's timed price as the quote, and every failure honest - no price
 * invented. The Account is a local stub server; nothing leaves 127.0.0.1. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { registerAccountProxy } from "../src/account-proxy.ts";
import { HttpError } from "../src/http.ts";
import { accountUsQuotes, type UsQuoteIdentity } from "../src/us-quotes.ts";
import { buildBrief } from "../src/brief.ts";
import { deskToolDefinitions } from "../src/desk-tools.ts";
import type { RouteRegistrar } from "../src/static.ts";

const NOW = Date.parse("2026-11-02T20:30:00Z");
const us = (symbol: string): UsQuoteIdentity => ({ id: `us:${symbol}`, market: "us", symbol });
const noRoutes: RouteRegistrar = { register() {} } as unknown as RouteRegistrar;

/** A stub Account answering `GET /api/account/explore` from `rows` (symbol → row), recording each query. */
async function stubAccount(answer: (q: URLSearchParams) => { status: number; body: unknown }): Promise<{ url: string; asked: URLSearchParams[]; server: Server }> {
  const asked: URLSearchParams[] = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname !== "/api/account/explore") { res.writeHead(404).end(); return; }
    asked.push(u.searchParams);
    const a = answer(u.searchParams);
    res.writeHead(a.status, { "content-type": "application/json" }).end(JSON.stringify(a.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked, server };
}

const ROWS: Record<string, unknown> = {
  NVDA: { key: "stock:NVDA", kind: "stock", name: "NVIDIA", price: 182.31, change24h: 2.16, changePct24h: 1.2, quoteFrom: "Nasdaq real-time", quoteAt: "2026-11-02T20:21:03Z" },
  SPY: { key: "stock:SPY", kind: "stock", name: "SPDR S&P 500", price: 600, change24h: -6, quoteFrom: "Cboe delayed 15 min", quoteAt: "2026-11-02T20:06:00Z" },
  UNTIMED: { key: "stock:UNTIMED", kind: "stock", name: "x", price: 10 },
};
const explore = (q: URLSearchParams) => {
  const row = ROWS[q.get("q") ?? ""];
  return { status: 200, body: { ok: true, asOf: "x", tabs: [], items: row ? [row, { key: "rwa:NVDA", price: 999, quoteAt: "2026-11-02T20:21:03Z" }] : [], movers: [], closing: [], mostTraded: [], missing: [], notes: [] } };
};

test("the Account's explore row becomes a timed quote; unknown and untimed symbols have no price", async (t) => {
  const stub = await stubAccount(explore);
  t.after(() => stub.server.close());
  const proxy = registerAccountProxy(noRoutes, { url: stub.url });
  t.after(() => proxy.dispose());
  const source = accountUsQuotes({ explore: proxy.explore, now: () => NOW });
  assert.equal(source.unavailable, undefined);
  const payload = await source.snapshot([us("NVDA"), us("SPY"), us("ZZZZ"), us("UNTIMED")]);
  assert.deepEqual(stub.asked.map((q) => [q.get("q"), q.get("key"), q.get("limit")]).sort(),
    [["NVDA", "stock:NVDA", "1"], ["SPY", "stock:SPY", "1"], ["UNTIMED", "stock:UNTIMED", "1"], ["ZZZZ", "stock:ZZZZ", "1"]]);
  const [nvda, spy, zzzz, untimed] = payload.quotes;
  assert.equal(nvda?.id, "us:NVDA");
  assert.equal(nvda?.price, 182.31, "the stock row, never the rwa token's");
  assert.equal(nvda?.as_of, "2026-11-02T20:21:03Z");
  assert.equal(nvda?.prev_close, 180.15);
  assert.equal(nvda?.change, 2.16);
  assert.equal(nvda?.change_pct, 1.199);
  assert.equal(nvda?.feed, "Nasdaq real-time");
  assert.equal(nvda?.quote_status, "live");
  assert.equal(spy?.quote_status, "delayed");
  assert.equal(spy?.prev_close, 606);
  assert.equal(zzzz?.price, null);
  assert.equal(zzzz?.quote_status, "unavailable");
  assert.match(zzzz?.message ?? "", /lists no US share ZZZZ/);
  assert.equal(untimed?.price, null, "a price without its time is no price");
  assert.equal(payload.providers[0]?.status, "connected");
  // the proxy's explore cache serves the second ask
  await source.snapshot([us("NVDA")]);
  assert.equal(stub.asked.filter((q) => q.get("q") === "NVDA").length, 1);
});

test("an Account not running, a disabled row, a refusal and a busy Account are said, never priced", async (t) => {
  const down = accountUsQuotes({ explore: registerAccountProxy(noRoutes, { url: "http://127.0.0.1:9" }).explore });
  await assert.rejects(down.snapshot([us("NVDA")]), /the Account is not reachable/);
  const off = accountUsQuotes({ explore: registerAccountProxy(noRoutes, { disabled: true }).explore });
  await assert.rejects(off.snapshot([us("NVDA")]), /the Account seat row is disabled/);
  const slow = accountUsQuotes({ explore: async () => ({ unreachable: "timeout" }) });
  await assert.rejects(slow.snapshot([us("NVDA")]), /did not answer in time/);
  const busy = accountUsQuotes({ explore: async () => ({ status: 429, body: "{}" }) });
  await assert.rejects(busy.snapshot([us("NVDA")]), (e: unknown) => e instanceof HttpError && e.status === 429);

  const refusing = await stubAccount(() => ({ status: 409, body: { ok: false, refusal: { message: "the account layer is not mounted" } } }));
  t.after(() => refusing.server.close());
  const refused = await accountUsQuotes({ explore: registerAccountProxy(noRoutes, { url: refusing.url }).explore }).snapshot([us("NVDA")]);
  assert.equal(refused.quotes[0]?.price, null);
  assert.match(refused.quotes[0]?.message ?? "", /the Account refused: the account layer is not mounted/);
  assert.equal(refused.providers[0]?.status, "limited");
});

test("a snapshot keeps at most its concurrency in flight and answers in the order asked", async () => {
  let open = 0;
  let most = 0;
  const source = accountUsQuotes({
    concurrency: 3,
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

test("the brief and desk_quotes over the Account: prices with their source and time, an Account down said", async (t) => {
  const stub = await stubAccount(explore);
  t.after(() => stub.server.close());
  const hub = accountUsQuotes({ explore: registerAccountProxy(noRoutes, { url: stub.url }).explore, now: () => NOW });
  const quotes = deskToolDefinitions({ hub, readState: async () => ({}) as never, now: () => NOW }).find((d) => d.name === "desk_quotes")!;
  const exec = { signal: new AbortController().signal } as never;
  const answer = await quotes.execute({ symbols: ["NVDA"] }, exec) as { quotes: Array<{ price: number; feed: string }> };
  assert.equal(answer.quotes[0]?.price, 182.31);
  const text = quotes.output.render({ symbols: ["NVDA"] }, answer) as Array<{ text: string }>;
  assert.match(text[0]?.text ?? "", /^NVDA 182\.31, \+1\.20% vs prev close 180\.15 \| NASDAQ REAL-TIME 15:21:03 ET \| poll \| live$/);

  const down = accountUsQuotes({ explore: registerAccountProxy(noRoutes, { url: "http://127.0.0.1:9" }).explore });
  const downTool = deskToolDefinitions({ hub: down, readState: async () => ({}) as never }).find((d) => d.name === "desk_quotes")!;
  assert.match((await downTool.execute({ symbols: ["NVDA"] }, exec) as { error: string }).error, /^unavailable: the Account is not reachable/);
  const root = `${import.meta.dirname}/tmp/us-quotes-none`; // no desk/ files there: the loaders say missing, nothing is written
  const brief = await buildBrief({ hub: down, root, now: () => NOW }, { date: "2026-11-02", session: { open: "09:30", close: "16:00", early: false } } as never);
  assert.equal(brief.ok, false);
  assert.match((brief as { error: string }).error, /^quotes unavailable: the Account is not reachable/);
});
