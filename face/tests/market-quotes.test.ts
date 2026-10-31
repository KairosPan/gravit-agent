import assert from "node:assert/strict";
import test from "node:test";
import { createLiveQuotes, parsePayload, type QuoteState } from "../client/js/wire/market-quotes.js";
import type { LiveQuote, ProviderState, QuotePayload } from "../src/quote-types.js";

const moutai = { id: "cn:600519", market: "cn", symbol: "600519" };
const catl = { id: "cn:300750", market: "cn", symbol: "300750" };
const cn = { id: "cn:603986", market: "cn", symbol: "603986" };
const received = "2026-09-15T15:00:00.000Z";
function quote(asset = moutai, extra: Partial<LiveQuote> = {}): LiveQuote {
  return { ...asset, market: asset.market as LiveQuote["market"], price: 120, prev_close: 100, change: 20, change_pct: 20,
    volume: 1000, as_of: "2026-09-15T14:59:58.123Z", received_at: received, volume_as_of: received,
    source: "腾讯", feed: "snapshot", basis: "previous_close", quote_status: "live", market_status: "unknown", message: "", name: null, last_session: null, open: null, high: null, low: null,
    turnover: null, turnover_rate: null, market_cap: null, pe_ttm: null, limit_up: null, limit_down: null, amplitude: null, ...extra };
}
function provider(extra: Partial<ProviderState> = {}): ProviderState {
  return { id: "tencent", market: "cn", status: "connected", source: "腾讯", feed: "snapshot", transport: "poll", message: "", ...extra };
}
function payload(quotes = [quote()], extra: Partial<QuotePayload> = {}): QuotePayload {
  return { ok: true, generated_at: received, quotes, providers: [provider()], ...extra };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let count = 0; count < 16; count += 1) await Promise.resolve(); }

class Clock {
  now = 0;
  serial = 0;
  tasks = new Map<number, { at: number; callback: () => void }>();
  schedule = (callback: () => void, delay: number) => { const id = ++this.serial; this.tasks.set(id, { at: this.now + delay, callback }); return id; };
  cancel = (id: number) => { this.tasks.delete(id); };
  tick(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const first = [...this.tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      this.tasks.delete(first[0]); this.now = first[1].at; first[1].callback();
    }
    this.now = end;
  }
}
class Stream {
  closed = false;
  listeners = new Map<string, ((event: { data?: string }) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(name: string, handler: (event: { data?: string }) => void) { this.listeners.set(name, [...(this.listeners.get(name) || []), handler]); }
  close() { this.closed = true; }
  // Late callbacks remain deliverable to verify revision guards after close().
  emit(name: string, data?: unknown) { for (const listener of this.listeners.get(name) || []) listener({ data: JSON.stringify(data) }); }
}
function harness(extra: Parameters<typeof createLiveQuotes>[1] = {}) {
  const clock = new Clock();
  const states: QuoteState[] = [];
  const streams: Stream[] = [];
  const calls: { url: string; signal: AbortSignal; result: ReturnType<typeof deferred<Response>> }[] = [];
  const client = createLiveQuotes((state) => states.push(state), {
    schedule: clock.schedule, cancelTimer: clock.cancel,
    createEventSource: (url) => { const stream = new Stream(url); streams.push(stream); return stream; },
    fetcher: async (url, init) => { const result = deferred<Response>(); calls.push({ url: String(url), signal: init!.signal!, result }); return result.promise; },
    ...extra,
  });
  return { client, clock, states, streams, calls, latest: () => states.at(-1)! };
}

test("empty watchlists do no network work; only unique selected IDs are subscribed, capped at 100", () => {
  const h = harness();
  h.client.setAssets([]); h.client.refresh(); h.client.setVisible(false); h.client.setVisible(true);
  assert.equal(h.streams.length, 0); assert.equal(h.calls.length, 0); assert.equal(h.clock.tasks.size, 0);
  h.client.setAssets([moutai, moutai, catl, { symbol: "invalid" }]);
  assert.equal(new URL(h.streams[0].url, "http://local").searchParams.get("ids"), "cn:600519,cn:300750");
  assert.equal(h.calls.length, 0, "the initial SSE snapshot needs no duplicate REST request");
  h.client.setAssets([catl, moutai]);
  assert.equal(h.streams.length, 1, "reordering identical subscriptions does not reconnect");
  h.client.setAssets(Array.from({ length: 101 }, (_, i) => ({ market: "cn", symbol: String(i).padStart(6, "0") })));
  assert.equal(h.streams[0].closed, true);
  assert.equal(new URL(h.streams[1].url, "http://local").searchParams.get("ids")!.split(",").length, 100);
  assert.equal(h.latest().limited, 1);
  h.client.close(); assert.equal(h.clock.tasks.size, 0);
});

test("full stream snapshots preserve event time, quote status, provider limits and percentage points", () => {
  const h = harness(); h.client.setAssets([moutai, catl, cn]);
  const missing = quote(cn, { price: null, prev_close: null, change: null, change_pct: null, volume: null, as_of: null,
    received_at: null, volume_as_of: null, source: "腾讯", feed: "", quote_status: "unavailable", market_status: "unknown", message: "该标的暂无腾讯行情" });
  h.streams[0].emit("quotes", payload([quote(moutai, { change_pct: 2.3, quote_status: "delayed" }), quote(catl, { quote_status: "stale" }), missing], {
    providers: [provider({ status: "limited", message: "部分 A 股标的暂无完整行情" })],
  }));
  assert.equal(h.latest().status, "streaming");
  assert.equal(h.latest().quotes[moutai.id].change_pct, 2.3);
  assert.equal(h.latest().quotes[moutai.id].as_of, "2026-09-15T14:59:58.123Z");
  assert.equal(h.latest().quotes[moutai.id].quote_status, "delayed");
  assert.equal(h.latest().quotes[catl.id].quote_status, "stale");
  assert.equal(h.latest().quotes[cn.id].price, null);
  assert.equal(h.latest().providers[0].status, "limited");
  h.client.close();
});

test("selection changes reject late stream events and ignored-abort REST responses", async () => {
  const h = harness(); h.client.setAssets([moutai]);
  h.streams[0].emit("quotes", payload());
  h.client.refresh();
  assert.equal(h.calls.length, 1);
  h.client.setAssets([catl]);
  assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.streams[0].closed, true);
  h.streams[1].emit("quotes", payload([quote(catl)]));
  const newest = h.latest();
  h.streams[0].emit("quotes", payload([quote(moutai, { price: 999 })]));
  h.streams[0].emit("error");
  h.calls[0].result.resolve(Response.json(payload([quote(moutai, { price: 888 })])));
  await settle();
  assert.equal(h.latest(), newest);
  assert.deepEqual(Object.keys(h.latest().quotes), [catl.id]);
  assert.equal(h.streams.length, 2); h.client.close();
});

test("disconnect keeps good prices stale, falls back immediately, then a stream update beats older REST JSON", async () => {
  const h = harness(); h.client.setAssets([moutai]); h.streams[0].emit("quotes", payload());
  h.streams[0].emit("error");
  assert.equal(h.streams[0].closed, true);
  assert.equal(h.latest().quotes[moutai.id].price, 120);
  assert.equal(h.latest().quotes[moutai.id].quote_status, "stale");
  assert.equal(h.latest().quotes[moutai.id].as_of, "2026-09-15T14:59:58.123Z");
  assert.equal(h.calls.length, 1);
  const json = deferred<QuotePayload>();
  h.calls[0].result.resolve({ ok: true, json: () => json.promise } as Response);
  await settle();
  h.clock.tick(1_000);
  h.streams[1].emit("quotes", payload([quote(moutai, { price: 123 })], { generated_at: "2026-09-15T15:00:01Z" }));
  assert.equal(h.calls[0].signal.aborted, true);
  json.resolve(payload([quote(moutai, { price: 99 })])); await settle();
  assert.equal(h.latest().quotes[moutai.id].price, 123);
  assert.equal(h.latest().status, "streaming");
  h.clock.tick(15_000);
  assert.equal(h.calls.length, 1, "successful stream cancels polling"); h.client.close();
});

test("REST fallback has a hard deadline even if fetch ignores abort, then polls at 15 seconds", async () => {
  const h = harness({ createEventSource: null }); h.client.setAssets([moutai]);
  h.clock.tick(10_000);
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.latest().refreshing, false); assert.equal(h.latest().status, "error"); assert.match(h.latest().note, /超时/);
  const timedOut = h.latest(); h.calls[0].result.resolve(Response.json(payload())); await settle();
  assert.equal(h.latest(), timedOut);
  h.clock.tick(14_999); assert.equal(h.calls.length, 1);
  h.clock.tick(1); assert.equal(h.calls.length, 2);
  h.calls[1].result.resolve(Response.json(payload())); await settle();
  assert.equal(h.latest().status, "polling"); assert.equal(h.latest().quotes[moutai.id].price, 120);
  h.clock.tick(15_000); assert.equal(h.calls.length, 3); h.client.close();
});

test("stream retries are bounded, REST continues after exhaustion, and refresh explicitly retries streaming", async () => {
  const h = harness({ fetcher: async () => Response.json(payload()) }); h.client.setAssets([moutai]);
  for (const [index, delay] of [1_000, 3_000, 10_000].entries()) {
    h.streams[index].emit("error"); await settle(); h.clock.tick(delay);
  }
  assert.equal(h.streams.length, 4);
  h.streams[3].emit("error"); await settle();
  h.clock.tick(15_000); await settle();
  assert.equal(h.streams.length, 4); assert.equal(h.latest().status, "polling");
  h.client.refresh(); assert.equal(h.streams.length, 5); h.client.close();
});

test("heartbeat prolongs a healthy stream, missing heartbeat and missing initial snapshot trigger fallback", () => {
  const h = harness(); h.client.setAssets([moutai]); h.streams[0].emit("quotes", payload());
  h.clock.tick(30_000); h.streams[0].emit("heartbeat", { generated_at: received });
  h.clock.tick(34_999); assert.equal(h.calls.length, 0);
  h.clock.tick(1); assert.equal(h.calls.length, 1); assert.equal(h.streams[0].closed, true); h.client.close();
  const cold = harness(); cold.client.setAssets([moutai]);
  cold.clock.tick(10_000); assert.equal(cold.streams[0].closed, true); assert.equal(cold.calls.length, 1); cold.client.close();
});

test("hiding, emptying and closing cancel every timer and request; resuming reconnects only current IDs", async () => {
  const h = harness(); h.client.setAssets([moutai]); h.streams[0].emit("quotes", payload()); h.client.refresh();
  h.client.setVisible(false);
  assert.equal(h.streams[0].closed, true); assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.clock.tasks.size, 0);
  assert.equal(h.latest().status, "paused"); assert.equal(h.latest().quotes[moutai.id].quote_status, "stale");
  h.client.setAssets([catl]); h.clock.tick(120_000); assert.equal(h.streams.length, 1);
  h.client.setVisible(true); assert.equal(h.streams.length, 2); assert.match(decodeURIComponent(h.streams[1].url), /cn:300750/);
  h.client.setAssets([]); assert.equal(h.clock.tasks.size, 0); assert.equal(h.streams[1].closed, true); assert.equal(h.latest().status, "idle");
  const empty = h.latest(); h.calls[0].result.resolve(Response.json(payload())); await settle(); assert.equal(h.latest(), empty);
  h.client.close(); h.client.setAssets([moutai]); h.client.refresh(); h.client.setVisible(true); assert.equal(h.streams.length, 2);
});

test("malformed snapshots and provider failures never clear good prices or invent successful updates", async () => {
  const h = harness({ createEventSource: null }); h.client.setAssets([moutai]); h.calls[0].result.resolve(Response.json(payload())); await settle();
  const good = h.latest().quotes[moutai.id];
  for (const invalid of [{ ok: true, quotes: [] }, payload([quote(moutai, { price: "bad" as unknown as number })]), payload([], { providers: [{} as ProviderState] })]) {
    h.client.refresh(); h.calls.at(-1)!.result.resolve(Response.json(invalid)); await settle();
    assert.equal(h.latest().status, "error"); assert.equal(h.latest().quotes[moutai.id].price, good.price); assert.equal(h.latest().quotes[moutai.id].quote_status, "stale");
  }
  h.client.refresh();
  h.calls.at(-1)!.result.resolve(Response.json(payload([quote(moutai, { price: null, quote_status: "unavailable", message: "provider unavailable" })])));
  await settle();
  assert.equal(h.latest().quotes[moutai.id].price, 120); assert.equal(h.latest().quotes[moutai.id].quote_status, "stale");
  assert.equal(h.latest().quotes[moutai.id].as_of, good.as_of); assert.equal(h.latest().quotes[moutai.id].message, "provider unavailable"); h.client.close();
});

test("a failed manual REST refresh does not relabel a still-healthy live stream as disconnected", async () => {
  const h = harness(); h.client.setAssets([moutai]); h.streams[0].emit("quotes", payload());
  h.client.refresh(); h.calls[0].result.reject(new Error("REST unavailable")); await settle();
  assert.equal(h.latest().status, "streaming"); assert.equal(h.latest().refreshing, false);
  assert.equal(h.latest().quotes[moutai.id].quote_status, "live"); assert.equal(h.streams[0].closed, false);
  h.client.close();
});

test("a payload naming a provider other than Tencent, or quoting a us or crypto id, is refused", () => {
  assert.equal(parsePayload(payload()).providers[0]!.id, "tencent");
  for (const asset of [{ id: "us:AAPL", market: "us", symbol: "AAPL" }, { id: "crypto:BTC/USD", market: "crypto", symbol: "BTC/USD" }]) {
    assert.throws(() => parsePayload(payload([quote(asset)])), /行情响应格式无效/);
  }
  for (const retired of [provider({ id: "ifind" as unknown as ProviderState["id"] }),
    provider({ id: "alpaca" as unknown as ProviderState["id"], market: "us" as unknown as ProviderState["market"] }),
    provider({ id: "coinbase" as unknown as ProviderState["id"], market: "crypto" as unknown as ProviderState["market"] }),
    provider({ market: "us" as unknown as ProviderState["market"] })]) {
    assert.throws(() => parsePayload(payload([quote()], { providers: [retired] })), /行情源状态无效/);
  }
});

test("parsePayload accepts the page's facts and the midday status, refuses a fact that is not a number", () => {
  const facts = { name: "贵州茅台", open: 1363, high: 1393.37, low: 1352.98, turnover: 8_257_380_000, turnover_rate: 0.48,
    market_cap: 1_740_176_000_000, pe_ttm: -12.5, limit_up: 1489.4, limit_down: 1218.6, amplitude: 2.98 };
  assert.doesNotThrow(() => parsePayload(payload([quote(moutai, { ...facts, market_status: "midday" } as Partial<LiveQuote>)])));
  assert.throws(() => parsePayload(payload([quote(moutai, { ...facts, turnover: "1" } as unknown as Partial<LiveQuote>)])));
  assert.throws(() => parsePayload(payload([quote(moutai, { name: 7 } as unknown as Partial<LiveQuote>)])));
});
