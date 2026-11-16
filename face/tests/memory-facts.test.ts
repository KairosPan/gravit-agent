/** src/memory-facts.ts: the facts the face computes for the memory - the price facts from the Market's quote and
 * daily bars, the held facts from a position - with stub reads and an injected timer; nothing leaves the process. */
import test from "node:test";
import assert from "node:assert/strict";
import { changeFacts, changesFrom, FACT_READ_MS, fullBars, heldFacts, priceFacts, type Facts, type FactReads } from "../src/memory-facts.ts";
import type { MarketQuote, MarketQuoteIdentity, MarketQuotePayload } from "../src/market-quotes.ts";
import type { UpstreamAnswer } from "../src/upstream-proxy.ts";

const DAY = 86_400_000;

/** A quote as the Market's source answers one; `over` replaces its fields. */
function quoteOf(id: string, over: Partial<MarketQuote> = {}): MarketQuote {
  const [market, symbol] = id.split(":") as ["us" | "cn", string];
  return {
    id, market, symbol, price: 110, prev_close: 100, change: 10, change_pct: 10, volume: null,
    as_of: "2026-03-02T20:59:00.000Z", received_at: null, volume_as_of: null, source: "market", feed: "cboe delayed",
    basis: "previous_close", quote_status: "delayed", market_status: "closed", message: "", ...over,
  };
}
const payloadOf = (quotes: MarketQuote[]): MarketQuotePayload => ({ ok: true, generated_at: "2026-03-02T21:00:00.000Z", quotes, providers: [] });

/** `n` daily bars, oldest first, one a day ending at `last`, closes 100, 101, … */
function barsOf(n: number, last: number): Array<{ t: number; o: number; h: number; l: number; c: number }> {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + i;
    return { t: last - (n - 1 - i) * DAY, o: c, h: c, l: c, c };
  });
}

/** Stub reads recording what was asked; the timer is a manual one. */
function readsOf(opts: {
  quote?: (assets: MarketQuoteIdentity[]) => Promise<MarketQuotePayload>;
  candles?: (query: string) => Promise<UpstreamAnswer>;
  now?: number;
}): { reads: FactReads; asked: { quotes: MarketQuoteIdentity[][]; candles: string[] }; timers: Array<{ run: () => void; ms: number; cleared: boolean }> } {
  const asked = { quotes: [] as MarketQuoteIdentity[][], candles: [] as string[] };
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  const reads: FactReads = {
    quotes: { snapshot: (assets) => { asked.quotes.push(assets); return (opts.quote ?? (() => new Promise(() => {})))(assets); } },
    candles: (query) => { asked.candles.push(query); return (opts.candles ?? (() => new Promise(() => {})))(query); },
    now: () => opts.now ?? Date.parse("2026-03-02T21:00:00Z"),
    setTimer: (run, ms) => { const t = { run, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { (t as { cleared: boolean }).cleared = true; },
  };
  return { reads, asked, timers };
}
const ok = (body: unknown): Promise<UpstreamAnswer> => Promise.resolve({ status: 200, body: JSON.stringify(body) });

/** Every key of `facts` is a key of `sources` and the reverse; every source at most 120 characters. */
function assertPaired(f: Facts): void {
  assert.deepEqual(Object.keys(f.facts).sort(), Object.keys(f.sources).sort());
  for (const s of Object.values(f.sources)) assert.ok(s.length <= 120, `a source over 120 characters: ${s}`);
}

test("changesFrom: the base is N sessions before the last full session", () => {
  const full = Array.from({ length: 61 }, (_, i) => ({ t: Date.UTC(2026, 0, 1 + i, 14, 30), c: 100 + i }));   // closes 100..160
  const f = changesFrom(176, full, (b) => `base ${b.c}`);
  assert.deepEqual(f.facts, { change_5d_pct: 13.55, change_20d_pct: 25.71, change_60d_pct: 76 });   // 176/155, 176/140, 176/100
  assert.deepEqual(f.sources, { change_5d_pct: "base 155", change_20d_pct: "base 140", change_60d_pct: "base 100" });
});
test("changesFrom: too few bars leaves that change absent", () => {
  const full = Array.from({ length: 21 }, (_, i) => ({ t: i, c: 100 }));
  assert.deepEqual(Object.keys(changesFrom(110, full, () => "s").facts), ["change_5d_pct", "change_20d_pct"]);
});
test("fullBars: a US answer's today marks the last bar provisional", () => {
  assert.deepEqual(fullBars([{ t: 1, c: 1 }, { t: 2, c: 2 }], { us: 2 }), [{ t: 1, c: 1 }]);
  assert.deepEqual(fullBars([{ t: 1, c: 1 }, { t: 2, c: 2 }], { us: 9 }).length, 2);
});
test("fullBars: an A share's bar of today is provisional while the phase is not closed", () => {
  const t = Date.parse("2026-03-02T07:00:00Z");   // 15:00 in Shanghai on 2026-03-02
  assert.equal(fullBars([{ t: t - 86_400_000, c: 1 }, { t, c: 2 }], { cn: { phase: "trading", today: "2026-03-02" } }).length, 1);
  assert.equal(fullBars([{ t: t - 86_400_000, c: 1 }, { t, c: 2 }], { cn: { phase: "midday", today: "2026-03-02" } }).length, 1);
  assert.equal(fullBars([{ t: t - 86_400_000, c: 1 }, { t, c: 2 }], { cn: { phase: "closed", today: "2026-03-02" } }).length, 2);
});
test("heldFacts: flat, long, short and not read", () => {
  assert.deepEqual(heldFacts(null, 10, "v").facts, { held: false });
  assert.deepEqual(heldFacts({ side: "long", entryPrice: 8 }, 10, "v").facts, { held: true, unrealized_pct: 25 });
  assert.deepEqual(heldFacts({ side: "short", entryPrice: 8 }, 10, "v").facts, { held: true });
  assert.deepEqual(heldFacts(undefined, 10, "v"), { facts: {}, sources: {} });
});
test("heldFacts: the sources name the venue", () => {
  assert.deepEqual(heldFacts({ side: "long", entryPrice: 8 }, 10, "paper-us").sources, {
    held: "the Account's position on paper-us",
    unrealized_pct: "the Market's quote over the Account's entry price on paper-us",
  });
  assert.deepEqual(heldFacts({ side: "long" }, 10, "v").facts, { held: true }, "no entry price: no unrealized_pct");
  assert.deepEqual(heldFacts({ side: "long", entryPrice: 8 }, undefined, "v").facts, { held: true }, "no last price: no unrealized_pct");
});

test("priceFacts US: the quote and six months of daily bars give all five facts", async () => {
  // 70 full bars ending 2026-02-27 (closes 100..169), then today's provisional bar.
  const lastFull = Date.parse("2026-02-27T14:30:00Z");
  const todayT = Date.parse("2026-03-02T14:30:00Z");
  const candles = [...barsOf(70, lastFull), { t: todayT, o: 1, h: 1, l: 1, c: 1 }];
  const { reads, asked, timers } = readsOf({
    quote: (assets) => Promise.resolve(payloadOf([quoteOf(assets[0].id, { price: 176, prev_close: 160 })])),
    candles: () => ok({ ok: true, candles, today: { t: todayT, c: 1 } }),
  });
  const f = await priceFacts(reads, "NVDA", "US");
  assert.deepEqual(asked.quotes, [[{ id: "us:NVDA", market: "us", symbol: "NVDA" }]]);
  assert.deepEqual(asked.candles, ["venue=cboe&symbol=NVDA&interval=1d&range=6M"]);
  assert.deepEqual(f.facts, {
    price: 176, change_1d_pct: 10,
    change_5d_pct: 7.32,     // 176 / 164
    change_20d_pct: 18.12,   // 176 / 149
    change_60d_pct: 61.47,   // 176 / 109
  });
  assert.equal(f.sources.price, "the Market's quote (cboe delayed) at 2026-03-02T20:59:00.000Z");
  assert.equal(f.sources.change_1d_pct, f.sources.price);
  assert.equal(f.sources.change_5d_pct, "the Market's daily bars, base close 2026-02-22");
  assert.equal(f.sources.change_60d_pct, "the Market's daily bars, base close 2025-12-29");
  assertPaired(f);
  assert.equal(timers.length, 2);
  assert.ok(timers.every((t) => t.ms === FACT_READ_MS && t.cleared), "both timers cleared once both reads answered");
});

test("priceFacts CN: the quote's phase and Shanghai's date of now decide the provisional bar", async () => {
  const todayT = Date.parse("2026-03-02T07:00:00Z");   // 15:00 Shanghai, 2026-03-02
  const candles = barsOf(62, todayT);                  // the last bar is today's; closes 100..161
  const run = async (phase: "trading" | "closed"): Promise<{ f: Facts; asked: string[] }> => {
    const { reads, asked } = readsOf({
      quote: (assets) => Promise.resolve(payloadOf([quoteOf(assets[0].id, { price: 180, prev_close: 160, feed: "tencent", cn: { phase, lastSession: "2026-03-02" } })])),
      candles: () => ok({ ok: true, candles }),
      now: Date.parse("2026-03-02T06:00:00Z"),   // 14:00 Shanghai
    });
    return { f: await priceFacts(reads, "600519", "CN"), asked: asked.candles };
  };
  const trading = await run("trading");
  assert.deepEqual(trading.asked, ["venue=china&symbol=600519&range=6M"]);
  assert.equal(trading.f.facts.change_5d_pct, 16.13, "today's bar dropped: the base is close 155 (180/155)");
  assert.equal(trading.f.sources.change_5d_pct, "the Market's daily bars, base close 2026-02-24");
  assertPaired(trading.f);
  const closed = await run("closed");
  assert.equal(closed.f.facts.change_5d_pct, 15.38, "today's bar kept: the base is close 156 (180/156)");
  assert.equal(closed.f.sources.change_5d_pct, "the Market's daily bars, base close 2026-02-25");
  assertPaired(closed.f);
});

test("priceFacts: a candles read that never answers resolves after FACT_READ_MS with the quote's facts", async () => {
  const { reads, timers } = readsOf({ quote: (assets) => Promise.resolve(payloadOf([quoteOf(assets[0].id)])) });
  const pending = priceFacts(reads, "NVDA", "US");
  let settled = false;
  void pending.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "waiting on the bars");
  const open = timers.filter((t) => !t.cleared);
  assert.equal(open.length, 1);
  assert.equal(open[0].ms, FACT_READ_MS);
  open[0].run();
  const f = await pending;
  assert.deepEqual(f.facts, { price: 110, change_1d_pct: 10 });
  assertPaired(f);
});

test("priceFacts: a readMs of 1,200 bounds each read - bars that never answer give the quote's two facts at 1,200", async () => {
  const { reads, timers } = readsOf({ quote: (assets) => Promise.resolve(payloadOf([quoteOf(assets[0].id)])) });
  const pending = priceFacts(reads, "NVDA", "US", { readMs: 1_200 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timers.map((t) => t.ms), [1_200, 1_200], "each of the two reads raced against 1,200 ms");
  const open = timers.filter((t) => !t.cleared);
  assert.equal(open.length, 1, "the quote answered; the bars are still out");
  open[0].run();
  const f = await pending;
  assert.deepEqual(f.facts, { price: 110, change_1d_pct: 10 });
  assertPaired(f);
});

test("priceFacts: a quotes read that never answers gives no fact", async () => {
  const { reads, timers } = readsOf({ candles: () => ok({ ok: true, candles: barsOf(70, Date.parse("2026-02-27T14:30:00Z")) }) });
  const pending = priceFacts(reads, "NVDA", "US");
  await new Promise((resolve) => setImmediate(resolve));
  for (const t of timers.filter((x) => !x.cleared)) t.run();
  assert.deepEqual(await pending, { facts: {}, sources: {} });
});

test("priceFacts: a rejecting or priceless quote and a refused, failed or unreadable candles read never throw", async () => {
  const bars = barsOf(70, Date.parse("2026-02-27T14:30:00Z"));
  const rejected = readsOf({ quote: () => Promise.reject(new Error("down")), candles: () => ok({ ok: true, candles: bars }) });
  assert.deepEqual(await priceFacts(rejected.reads, "NVDA", "US"), { facts: {}, sources: {} });
  const thrown = readsOf({ quote: () => { throw new Error("sync"); }, candles: () => ok({ ok: true, candles: bars }) });
  assert.deepEqual(await priceFacts(thrown.reads, "NVDA", "US"), { facts: {}, sources: {} });
  const priceless = readsOf({ quote: (a) => Promise.resolve(payloadOf([quoteOf(a[0].id, { price: null })])), candles: () => ok({ ok: true, candles: bars }) });
  assert.deepEqual(await priceFacts(priceless.reads, "NVDA", "US"), { facts: {}, sources: {} });
  const noPrev = readsOf({ quote: (a) => Promise.resolve(payloadOf([quoteOf(a[0].id, { prev_close: null })])), candles: () => Promise.resolve({ unreachable: "ECONNREFUSED" }) });
  assert.deepEqual((await priceFacts(noPrev.reads, "NVDA", "US")).facts, { price: 110 }, "no prev_close: no change_1d_pct");
  for (const answer of [
    { unreachable: "ECONNREFUSED" },
    { status: 409, body: JSON.stringify({ ok: true, candles: bars }) },
    { status: 200, body: "not json" },
    { status: 200, body: JSON.stringify({ ok: true, candles: [{ t: "x", c: 1 }] }) },
  ] as UpstreamAnswer[]) {
    const { reads } = readsOf({ quote: (a) => Promise.resolve(payloadOf([quoteOf(a[0].id)])), candles: () => Promise.resolve(answer) });
    const f = await priceFacts(reads, "NVDA", "US");
    assert.deepEqual(f.facts, { price: 110, change_1d_pct: 10 });
    assertPaired(f);
  }
  const candlesThrow = readsOf({ quote: (a) => Promise.resolve(payloadOf([quoteOf(a[0].id)])), candles: () => Promise.reject(new Error("x")) });
  assert.deepEqual((await priceFacts(candlesThrow.reads, "NVDA", "US")).facts, { price: 110, change_1d_pct: 10 });
});

test("priceFacts: a symbol off the market's shape gives no fact and asks nothing", async () => {
  for (const [symbol, market] of [["nvda", "US"], ["sh600519", "CN"], ["BTC/USD", "US"], ["600519", "US"], ["NVDA", "CN"]] as const) {
    const { reads, asked, timers } = readsOf({});
    assert.deepEqual(await priceFacts(reads, symbol, market), { facts: {}, sources: {} }, symbol);
    assert.deepEqual(asked, { quotes: [], candles: [] }, symbol);
    assert.equal(timers.length, 0, symbol);
  }
});

test("priceFacts CN: a quote with no cn.phase counts as not closed - today's bar is not a base", async () => {
  const todayT = Date.parse("2026-03-02T07:00:00Z");   // 15:00 Shanghai, 2026-03-02
  const { reads } = readsOf({
    quote: (assets) => Promise.resolve(payloadOf([quoteOf(assets[0].id, { price: 180, prev_close: 160, feed: "tencent" })])),
    candles: () => ok({ ok: true, candles: barsOf(62, todayT) }),
    now: Date.parse("2026-03-02T08:00:00Z"),   // 16:00 Shanghai
  });
  const f = await priceFacts(reads, "600519", "CN");
  assert.equal(f.facts.change_5d_pct, 16.13, "today's bar dropped: the base is close 155 (180/155)");
  assert.equal(f.sources.change_5d_pct, "the Market's daily bars, base close 2026-02-24");
});

/* changeFacts: the bars half alone, against a last price in hand. */

/** Stub candles alone, recording what was asked; the timer is a manual one. */
function candlesOf(candles?: (query: string) => Promise<UpstreamAnswer>, now = Date.parse("2026-03-02T21:00:00Z")) {
  const asked: string[] = [];
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  const reads: Pick<FactReads, "candles" | "now" | "setTimer" | "clearTimer"> = {
    candles: (query) => { asked.push(query); return (candles ?? (() => new Promise(() => {})))(query); },
    now: () => now,
    setTimer: (run, ms) => { const t = { run, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { (t as { cleared: boolean }).cleared = true; },
  };
  return { reads, asked, timers };
}

test("changeFacts US: 61 full bars and today's marked one, against 176 in hand", async () => {
  const lastFull = Date.parse("2026-02-27T14:30:00Z");
  const todayT = Date.parse("2026-03-02T14:30:00Z");
  const candles = [...barsOf(61, lastFull), { t: todayT, o: 1, h: 1, l: 1, c: 1 }];   // closes 100..160, then today's
  const { reads, asked, timers } = candlesOf(() => ok({ ok: true, candles, today: { t: todayT, c: 1 } }));
  const f = await changeFacts(reads, "NVDA", "US", 176);
  assert.deepEqual(asked, ["venue=cboe&symbol=NVDA&interval=1d&range=6M"]);
  assert.deepEqual(f.facts, { change_5d_pct: 13.55, change_20d_pct: 25.71, change_60d_pct: 76 });
  assert.equal(f.sources.change_5d_pct, "the Market's daily bars, base close 2026-02-22");
  assert.equal(f.sources.change_60d_pct, "the Market's daily bars, base close 2025-12-29");
  assertPaired(f);
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms === FACT_READ_MS && timers[0].cleared, "one timer of FACT_READ_MS, cleared once the bars answered");
});

test("changeFacts CN: the phase in hand decides today's bar; no phase counts as not closed", async () => {
  const todayT = Date.parse("2026-03-02T07:00:00Z");   // 15:00 Shanghai, 2026-03-02
  const candles = barsOf(62, todayT);                  // the last bar is today's; closes 100..161
  const run = async (phase: string | undefined): Promise<{ f: Facts; asked: string[] }> => {
    const { reads, asked } = candlesOf(() => ok({ ok: true, candles }), Date.parse("2026-03-02T06:00:00Z"));
    return { f: await changeFacts(reads, "600519", "CN", 180, phase), asked };
  };
  const trading = await run("trading");
  assert.deepEqual(trading.asked, ["venue=china&symbol=600519&range=6M"]);
  assert.equal(trading.f.facts.change_5d_pct, 16.13, "today's bar dropped: the base is close 155 (180/155)");
  assert.equal(trading.f.sources.change_5d_pct, "the Market's daily bars, base close 2026-02-24");
  assertPaired(trading.f);
  const closed = await run("closed");
  assert.equal(closed.f.facts.change_5d_pct, 15.38, "today's bar kept: the base is close 156 (180/156)");
  assert.equal(closed.f.sources.change_5d_pct, "the Market's daily bars, base close 2026-02-25");
  const unsaid = await run(undefined);
  assert.equal(unsaid.f.facts.change_5d_pct, 16.13, "no phase: today's bar is not a base");
});

test("changeFacts: bars that never answer give nothing after FACT_READ_MS", async () => {
  const { reads, timers } = candlesOf();
  const pending = changeFacts(reads, "NVDA", "US", 176);
  let settled = false;
  void pending.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "waiting on the bars");
  assert.deepEqual(timers.map((t) => t.ms), [FACT_READ_MS]);
  timers[0].run();
  assert.deepEqual(await pending, { facts: {}, sources: {} });
});

test("changeFacts: a readMs of 1,200 bounds the bars read", async () => {
  const { reads, timers } = candlesOf();
  const pending = changeFacts(reads, "NVDA", "US", 176, undefined, { readMs: 1_200 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timers.map((t) => t.ms), [1_200]);
  timers[0].run();
  assert.deepEqual(await pending, { facts: {}, sources: {} });
});

test("changeFacts: a symbol off its market's shape, or a last price not above zero, asks nothing", async () => {
  for (const [symbol, market, last] of [
    ["nvda", "US", 176], ["600519", "US", 176], ["NVDA", "CN", 176], ["sh600519", "CN", 176],
    ["NVDA", "US", 0], ["NVDA", "US", -1], ["NVDA", "US", Number.NaN], ["NVDA", "US", Number.POSITIVE_INFINITY],
  ] as const) {
    const { reads, asked, timers } = candlesOf(() => ok({ ok: true, candles: barsOf(70, Date.parse("2026-02-27T14:30:00Z")) }));
    assert.deepEqual(await changeFacts(reads, symbol, market, last), { facts: {}, sources: {} }, `${symbol} ${market} ${last}`);
    assert.deepEqual(asked, [], `${symbol} ${market} ${last}`);
    assert.equal(timers.length, 0, `${symbol} ${market} ${last}`);
  }
});

test("changeFacts: a refused, failed or unreadable bars read never throws", async () => {
  const answers: Array<(query: string) => Promise<UpstreamAnswer>> = [
    () => Promise.resolve({ unreachable: "ECONNREFUSED" }),
    () => Promise.resolve({ status: 200, body: "not json" }),
    () => Promise.reject(new Error("x")),
    () => { throw new Error("sync"); },
  ];
  for (const candles of answers) {
    const { reads } = candlesOf(candles);
    assert.deepEqual(await changeFacts(reads, "NVDA", "US", 176), { facts: {}, sources: {} });
  }
});
