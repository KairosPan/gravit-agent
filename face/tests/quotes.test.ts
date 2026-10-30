import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { createQuoteHub, parseInstrumentId, parseQuoteRequest, registerQuoteRoutes, QUOTE_CLIENT_LIMIT, type QuoteHub } from "../src/quotes.ts";
import { isTrustedDataRequest } from "../src/http.ts";
import type { ProviderState, QuoteIdentity, QuotePayload, QuoteUpdate, SnapshotResult } from "../src/quote-types.ts";

const CN: QuoteIdentity = { id: "cn:603986", market: "cn", symbol: "603986" };
const CN2: QuoteIdentity = { id: "cn:600519", market: "cn", symbol: "600519" };
const DAY = Date.parse("2026-09-15T05:00:00Z");
const cnState: ProviderState = { id: "tencent", market: "cn", status: "connected", source: "腾讯", feed: "snapshot", transport: "poll", message: "腾讯行情" };
const update = (extra: Partial<QuoteUpdate> = {}): QuoteUpdate => ({ id: CN.id, source: "腾讯", feed: "snapshot", basis: "previous_close",
  price: 100, prev_close: 80, volume: 1000, as_of: new Date(DAY).toISOString(), volume_as_of: "2026-09-15T01:30:00Z", market_status: "unknown", ...extra });
const empty = (): SnapshotResult => ({ updates: [], providers: [] });

test("quote requests accept only bounded canonical cn identities", () => {
  assert.deepEqual(parseQuoteRequest("/data/quotes?ids=cn:603986,cn:600519,cn:603986"), [CN, CN2]);
  assert.deepEqual(parseQuoteRequest("/data/quotes?ids="), []);
  for (const suffix of ["", "?ids=cn:603986&ids=cn:600519", "?ids=https://evil.example", "?ids=cn:603986:extra", "?ids=cn:123", "?ids=us:aapl", "?ids=us:*", "?ids=crypto:BTC", "?ids=cn:60398%00", "?ids=%ZZ", "?ids=" + Array(101).fill("cn:603986").join(",")]) {
    assert.throws(() => parseQuoteRequest(`/data/quotes${suffix}`), suffix);
  }
});

test("parseInstrumentId accepts the cn grammar alone", () => {
  assert.deepEqual(parseInstrumentId(" cn:603986 "), CN);
  for (const bad of ["us:AAPL", "crypto:BTC/USD", "cn:12345", "cn:60398A", "cn:603986:X", "603986", "cn:", ""]) assert.equal(parseInstrumentId(bad), null, bad);
});

class ResponseMock extends EventEmitter {
  status = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  destroyed = false;
  writableLength = 0;
  hardClosed = false;
  writeHead(status: number, headers: Record<string, string>) { this.status = status; this.headers = headers; }
  write(chunk: string) { this.chunks.push(chunk); return true; }
  end(chunk?: string) { if (chunk) this.chunks.push(chunk); if (!this.destroyed) { this.destroyed = true; this.emit("close"); } }
  destroy() { this.hardClosed = true; this.end(); return this; }
}
function routesOf(hub: QuoteHub) {
  const routes: WebRoute[] = [];
  const dispose = registerQuoteRoutes({ register: (route) => routes.push(route) }, { isTrusted: isTrustedDataRequest, hub });
  const invoke = async (stream: boolean, url: string, method = "GET", host = "localhost:3090") => {
    const res = new ResponseMock();
    await routes[stream ? 1 : 0]!.handler({ url, method, headers: { host } } as IncomingMessage, res as unknown as ServerResponse);
    return res;
  };
  return { invoke, dispose };
}

test("a us or crypto id is no longer quoted by the face", async () => {
  const asked: string[] = [];
  const hub = createQuoteHub({ now: () => DAY, snapshots: { async load(assets) {
    asked.push(...assets.map((asset) => asset.id));
    return { updates: assets.map((asset) => update({ id: asset.id })), providers: [cnState] };
  } } });
  const { invoke, dispose } = routesOf(hub);
  try {
    const alone = await invoke(false, "/data/quotes?ids=us:AAPL");
    assert.equal(alone.status, 200);
    const body = JSON.parse(alone.chunks.join("")) as QuotePayload;
    assert.deepEqual(body.quotes, [], "no quote, and no provider, for us:AAPL");
    assert.deepEqual(body.providers.map((provider) => [provider.id, provider.market, provider.source]), [["tencent", "cn", "腾讯"]]);
    const mixed = JSON.parse((await invoke(false, "/data/quotes?ids=us:AAPL,crypto:BTC%2FUSD,cn:603986")).chunks.join("")) as QuotePayload;
    assert.deepEqual(mixed.quotes.map((quote) => quote.id), [CN.id]);
    assert.deepEqual(mixed.providers.map((provider) => provider.id), ["tencent"]);
    const stream = await invoke(true, "/data/quotes/stream?ids=crypto:BTC%2FUSD,cn:603986");
    const first = JSON.parse(/data: (.*)\n/.exec(stream.chunks.join("").split("event: quotes\n")[1]!)![1]!) as QuotePayload;
    assert.deepEqual(first.quotes.map((quote) => quote.id), [CN.id]);
    assert.deepEqual(first.providers.map((provider) => provider.id), ["tencent"]);
    stream.end();
    assert.deepEqual([...new Set(asked)], [CN.id], "the snapshots were never asked for a us or crypto id");
  } finally { dispose(); }
});

test("hub polls the subscribed cn ids and stops asking for unused ones", async () => {
  const requests: string[][] = [];
  const hub = createQuoteHub({ now: () => DAY, snapshots: { async load(assets) { requests.push(assets.map((a) => a.id)); return empty(); } } });
  try {
    const received: QuotePayload[] = [];
    const a = hub.subscribe([CN], (payload) => received.push(payload));
    const b = hub.subscribe([CN, CN2], () => {});
    await hub.snapshot([CN, CN2]);
    assert.deepEqual(received[0]!.quotes.map((quote) => quote.id), [CN.id]);
    assert.deepEqual(received[0]!.quotes.map((quote) => quote.transport), ["poll"]);
    assert.deepEqual(requests.flat().sort(), [CN.id, CN2.id].sort());
    a(); b();
    await hub.snapshot([]);
    assert.equal(requests.flat().length, 2);
  } finally { hub.close(); }
});

test("a provider in error carries its message and null values", async () => {
  const hub = createQuoteHub({ now: () => DAY, snapshots: { async load() { return { updates: [
    { id: CN.id, source: "腾讯", feed: "snapshot", basis: "previous_close", message: "腾讯行情暂不可用，稍后重试" }], providers: [
    { id: "tencent", market: "cn", status: "error", source: "腾讯", feed: "snapshot", transport: "poll", message: "腾讯行情暂不可用，稍后重试" }] }; } } });
  try {
    const result = await hub.snapshot([CN]);
    assert.equal(result.quotes[0]!.price, null);
    assert.equal(result.quotes[0]!.change_pct, null);
    assert.equal(result.quotes[0]!.quote_status, "unavailable");
    assert.match(result.quotes[0]!.message, /腾讯/);
    assert.equal(result.providers[0]!.status, "error");
  } finally { hub.close(); }
});

test("a quote carries its change against the previous close", async () => {
  const hub = createQuoteHub({ now: () => DAY, snapshots: { async load() { return { updates: [update()], providers: [cnState] }; } } });
  try {
    const quote = (await hub.snapshot([CN])).quotes[0]!;
    assert.equal(quote.change, 20);
    assert.equal(quote.change_pct, 25);
    assert.equal(quote.quote_status, "live");
    assert.equal(quote.transport, "poll");
  } finally { hub.close(); }
});

test("a failed refresh keeps the last price and flags it stale; an old trade stays explicit", async () => {
  let clock = DAY;
  let failing = false;
  const hub = createQuoteHub({ now: () => clock, snapshots: { async load() {
    return failing ? { updates: [], providers: [{ ...cnState, status: "error", message: "连接失败" }] }
      : { updates: [update()], providers: [cnState] };
  } } });
  try {
    await hub.snapshot([CN]); failing = true; clock += 6000;
    const result = await hub.snapshot([CN]);
    assert.equal(result.quotes[0]!.price, 100);
    assert.equal(result.quotes[0]!.quote_status, "stale");
    assert.equal(result.quotes[0]!.as_of, new Date(DAY).toISOString());
  } finally { hub.close(); }
  const old = createQuoteHub({ now: () => DAY, snapshots: { async load() { return {
    updates: [update({ as_of: new Date(DAY - 6 * 60_000).toISOString() })], providers: [cnState],
  }; } } });
  try {
    const quote = (await old.snapshot([CN])).quotes[0]!;
    assert.equal(quote.quote_status, "stale");
    assert.match(quote.message, /最近成交时间较早/);
  } finally { old.close(); }
});

test("snapshot cache coalesces concurrent reads and connection limits refuse extra subscribers", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hub = createQuoteHub({ now: () => DAY, snapshots: { async load() { calls++; await gate; return empty(); } } });
  try {
    const first = hub.snapshot([CN]), second = hub.snapshot([CN]);
    release(); await Promise.all([first, second]); assert.equal(calls, 1);
    const stops = Array.from({ length: QUOTE_CLIENT_LIMIT }, () => hub.subscribe([CN], () => {}));
    assert.throws(() => hub.subscribe([CN], () => {}), /连接过多/);
    stops.forEach((stop) => stop());
  } finally { hub.close(); }
});

test("quote routes fence requests before reads, emit named SSE updates/heartbeats, and release on close", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0, stops = 0;
  const example: QuotePayload = { ok: true, generated_at: new Date(DAY).toISOString(), quotes: [], providers: [] };
  const { invoke, dispose } = routesOf({ async snapshot() { calls++; return example; }, subscribe(_assets, listener) { calls++; listener(example); return () => { stops++; }; }, close() {} });
  assert.equal((await invoke(false, "/data/quotes?ids=cn:603986", "GET", "evil.example")).status, 403);
  assert.equal((await invoke(false, "/data/quotes?ids=cn:603986", "POST")).status, 405);
  assert.equal((await invoke(false, "/data/quotes?ids=cn:*", "GET")).status, 400);
  assert.equal((await invoke(false, "/data/quotes?ids=us:*", "GET")).status, 400);
  assert.equal(calls, 0);
  const res = await invoke(true, "/data/quotes/stream?ids=cn:603986");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"]!, /text\/event-stream/);
  assert.match(res.chunks.join(""), /event: quotes/);
  t.mock.timers.tick(15_000);
  assert.match(res.chunks.join(""), /event: heartbeat/);
  res.end(); assert.equal(stops, 1);
  const size = res.chunks.length;
  t.mock.timers.tick(30_000); assert.equal(res.chunks.length, size);
  const slow = await invoke(true, "/data/quotes/stream?ids=cn:603986");
  slow.writableLength = 300 * 1024;
  t.mock.timers.tick(15_000);
  assert.equal(slow.hardClosed, true);
  assert.equal(stops, 2);
  const open = await invoke(true, "/data/quotes/stream?ids=cn:603986");
  dispose();
  assert.equal(open.destroyed, true);
  assert.equal(stops, 3);
});

test("concurrent distinct snapshots are pinned until delivered and excess work is rejected", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hub = createQuoteHub({ now: () => DAY, snapshots: { async load(assets) {
    await gate; return { updates: assets.map((asset) => update({ id: asset.id })), providers: [cnState] };
  } } });
  try {
    const promises = Array.from({ length: 7 }, (_, batch) => hub.snapshot(Array.from({ length: 100 }, (_, index) => {
      const symbol = String(batch * 100 + index).padStart(6, "0");
      return { id: `cn:${symbol}`, market: "cn" as const, symbol };
    })));
    const resultPromise = Promise.allSettled(promises);
    release();
    const results = await resultPromise;
    assert.equal(results.filter((result) => result.status === "rejected").length, 2);
    for (const result of results) if (result.status === "fulfilled") assert.equal(result.value.quotes.filter((quote) => quote.price === 100).length, 100);
  } finally { hub.close(); }
});

test("a new trading day clears old volume and baseline until current-session data arrives", async () => {
  let clock = DAY;
  let next = update();
  const hub = createQuoteHub({ now: () => clock, snapshots: { async load() { return { updates: [next], providers: [cnState] }; } } });
  try {
    await hub.snapshot([CN]);
    clock += 86_400_000;
    next = { id: CN.id, source: "腾讯", feed: "snapshot", basis: "previous_close", price: 120, as_of: new Date(clock).toISOString() };
    let quote = (await hub.snapshot([CN])).quotes[0]!;
    assert.equal(quote.price, 120);
    assert.equal(quote.prev_close, null);
    assert.equal(quote.volume, null);
    // A late response carrying yesterday's snapshot cannot repopulate
    // yesterday's cumulative volume or price-change baseline.
    clock += 6000;
    next = update();
    quote = (await hub.snapshot([CN])).quotes[0]!;
    assert.equal(quote.price, 120);
    assert.equal(quote.prev_close, null);
    assert.equal(quote.change_pct, null);
    assert.equal(quote.volume, null);
  } finally { hub.close(); }
});

test("an explicit missing current-session volume clears it without erasing the valid price", async () => {
  let clock = DAY;
  let next = update();
  const hub = createQuoteHub({ now: () => clock, snapshots: { async load() { return { updates: [next], providers: [cnState] }; } } });
  try {
    await hub.snapshot([CN]);
    clock += 6000;
    next = update({ price: 110, as_of: new Date(DAY + 1000).toISOString(), volume: null, volume_as_of: null });
    const quote = (await hub.snapshot([CN])).quotes[0]!;
    assert.equal(quote.volume, null);
    assert.equal(quote.price, 110);
  } finally { hub.close(); }
});
