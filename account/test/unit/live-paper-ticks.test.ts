import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { CATCH_UP_BAR, catchUpBar, FILL_SAVE_MS, OWED_MOST_MS, PAPER_DEFAULT_CASH, PRUNE_AFTER_MS, paperBookPath, paperOrder, paperSource, TRAIL_SAVE_MS, type PaperBook, type PaperChange } from "../../src/portfolio/live/paper.ts";
import type { ExchangeClient } from "../../src/portfolio/live/exchange.ts";
import { exchangeTickers, readLike, type Listing, type PublicSource } from "../../src/portfolio/live/public-markets.ts";
import { HUB_URLS, IDLE_MS, joinHubs, StreamHub, type WebSocketLike } from "../../src/portfolio/live/stream-hub.ts";
import { usClock, usSessionFull } from "../../src/portfolio/account/calendar.ts";
import { CBOE_DELAY_MS, CBOE_FROM } from "../../src/portfolio/live/public-stocks.ts";
import { ROBINHOOD_FROM, ROBINHOOD_PRICES, usQuote, UsQuoteFeed } from "../../src/portfolio/live/us-quotes.ts";
import type { Candle, CandlePage, LiveTrader, Market, OrderBook, OrderRequest } from "../../src/portfolio/live/trade.ts";
import type { LiveSource } from "../../src/portfolio/live/types.ts";
import { makeWorld, publicSources, standinHub, tick } from "../standin/venues.ts";

/** THE PAPER ACCOUNT ON THE VENUES' LIVE STREAMS (live/paper.ts over live/stream-hub.ts; feat/paper-live p2a), the hub's WebSocket a stand-in
 * the test speaks through (Coinbase's and Hyperliquid's message shapes) — no network. A quote is the stream's while it is live; each tick
 * judges only its market's orders, against the quote of that moment and the trades' highest and lowest since each order was last judged (a
 * stop touched between two quotes, a resting limit the trades reached, a trailing stop, a bracket's two exits); a market order walks the
 * book; a coin's fill takes a price at most a second old; buying power is held for open orders; the book is written within 50 ms of a fill
 * and once a second for a trailing stop's moves; closed orders a quarter old go to the month's archive; the time asleep is judged against
 * real bars; a perpetual is marked and liquidated at its venue's mark. */
const NOW = Date.parse("2026-10-16T15:00:00Z");
let now = NOW;
const clock = () => now;
let n = 0;
const clientId = () => (++n).toString(16).padStart(32, "0");

class FakeWs implements WebSocketLike {
  static all: FakeWs[] = [];
  readyState = 0;
  readonly sent: string[] = [];
  closed = false;
  private readonly on = new Map<string, Array<(ev: { data?: unknown }) => void>>();
  constructor(readonly url: string) {
    FakeWs.all.push(this);
  }
  addEventListener(type: string, fn: (ev: { data?: unknown }) => void): void {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
    for (const fn of this.on.get("close") ?? []) fn({});
  }
  open(): void {
    this.readyState = 1;
    for (const fn of this.on.get("open") ?? []) fn({});
  }
  say(msg: unknown): void {
    for (const fn of this.on.get("message") ?? []) fn({ data: JSON.stringify(msg) });
  }
}

type Row = Listing & { price: number; bid?: number | undefined; ask?: number | undefined };
const row = (symbol: string, kind: Market["kind"], base: string, quote: string, price: number, extra: Partial<Row> = {}): Row => ({ symbol, name: `${base} ${kind === "perp" ? "perpetual" : "market"}`, kind, base, quote, price, bid: price - price * 0.0002, ask: price + price * 0.0002, open: true, types: [], volumeUsd24h: 1_000_000, ...extra });
/** a row as Coinbase's REST listing gives it: its last trade, no bid and no ask (public-markets.ts EXCHANGES.coinbase) */
const lastOnly = (r: Row): Row => ({ ...r, bid: undefined, ask: undefined });
function source(id: string, name: string, rows: Row[], extra: Partial<PublicSource> = {}): PublicSource & { rows: Row[] } {
  return { id, name, kind: "exchange", connectTo: id, connector: `live:exchange:${id}`, rows, listings: async (o) => rows.filter((m) => !o.q || m.symbol.includes(o.q.toUpperCase()) || m.base.includes(o.q.toUpperCase())).map((m) => ({ ...m })), ...extra };
}
/** a source's REST order book from its rows: one level a side, 5 units, two basis points either side of the row's price, read now */
const restBook = (rows: Row[], from: string) => async (symbol: string): Promise<OrderBook> => {
  const r = rows.find((x) => x.symbol === symbol)!;
  return { bids: [[r.price - r.price * 0.0002, 5]], asks: [[r.price + r.price * 0.0002, 5]], at: new Date(now).toISOString(), from, depth: "full" };
};

const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const home = () => {
  const h = mkdtempSync(join(tmpdir(), "paper-ticks-"));
  homes.push(h);
  return h;
};
const ok = <T>(x: T | Refusal): T => {
  if (isRefusal(x)) throw new Error(`expected an answer, got ${x.code}: ${x.message}`);
  return x;
};
const refusal = (x: unknown): Refusal => {
  if (!isRefusal(x)) throw new Error(`expected a refusal, got ${JSON.stringify(x)}`);
  return x;
};
const book = (h: string, venue = "paper-1"): PaperBook => JSON.parse(readFileSync(paperBookPath(h, venue), "utf8")) as PaperBook;
const order = (o: Partial<OrderRequest> = {}): OrderRequest => ({ symbol: "BTC/USD", side: "buy", type: "market", qty: 0.1, clientId: clientId(), ...o });
/** the end of this turn, and whatever it set going */
const turn = () => vi.advanceTimersByTimeAsync(0);

let hub: StreamHub | undefined;
beforeEach(() => {
  FakeWs.all = [];
  now = NOW;
  // the timers are the test's; the clocks are the test's own `now`
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(() => {
  hub?.close();
  hub = undefined;
  vi.useRealTimers();
});

/** a paper account on Coinbase's BTC/USD and Hyperliquid's BTC-PERP (stand-in REST listings — Coinbase's its last trade only, as the real
 * one's, with its REST order book behind it), its hub over a stand-in WebSocket: the venue's side spoken through `cb` and `hl` */
async function open(o: { h?: string; extra?: Partial<PublicSource>; hlExtra?: Partial<PublicSource>; cash?: number; hub?: () => StreamHub | undefined } = {}) {
  const h = o.h ?? home();
  const cbRows = [lastOnly(row("BTC/USD", "spot", "BTC", "USD", 60000)), lastOnly(row("ETH/USD", "spot", "ETH", "USD", 2000))];
  const coinbase = source("coinbase", "Coinbase", cbRows, { book: restBook(cbRows, "Coinbase"), ...o.extra });
  const hl = source("hyperliquid", "Hyperliquid", [row("BTC-PERP", "perp", "BTC", "USDC", 60000, { maxLeverage: 40, fundingRate: 0 })], o.hlExtra);
  hub ??= new StreamHub({ WebSocket: FakeWs, clock, random: () => 0 });
  const made = hub;
  const opened = await paperSource({ home: h, venue: "paper-1", label: "", cashUsd: o.cash ?? PAPER_DEFAULT_CASH, sources: () => [coinbase, hl], clock, hub: o.hub ?? (() => made) });
  if (isRefusal(opened)) throw new Error(opened.message);
  const told: PaperChange[] = [];
  opened.source.paperEvents!.listen((c) => told.push(c));
  const ws = (venue: keyof typeof HUB_URLS) => FakeWs.all.filter((w) => w.url === HUB_URLS[venue]).at(-1);
  let seq = 0;
  /** the stream opened (once the hub has asked for it) and the market's first word said */
  const live = async (venue: "coinbase" | "hyperliquid" = "coinbase") => {
    await turn();
    const w = ws(venue)!;
    if (w.readyState !== 1) w.open();
    return w;
  };
  const cb = {
    bbo: (bid: number, ask: number, last = (bid + ask) / 2, symbol = "BTC-USD", sizes: [number, number] = [5, 5]) => ws("coinbase")!.say({ channel: "ticker", timestamp: new Date(now).toISOString(), sequence_num: seq++, events: [{ type: "update", tickers: [{ product_id: symbol, price: String(last), best_bid: String(bid), best_ask: String(ask), best_bid_quantity: String(sizes[0]), best_ask_quantity: String(sizes[1]) }] }] }),
    trade: (price: number, symbol = "BTC-USD") => ws("coinbase")!.say({ channel: "market_trades", timestamp: new Date(now).toISOString(), sequence_num: seq++, events: [{ type: "update", trades: [{ product_id: symbol, trade_id: `t${seq}`, price: String(price), size: "0.01", time: new Date(now).toISOString() }] }] }),
    /** one market_trades message of several trades (Coinbase batches them about every 250 ms) */
    trades: (prices: number[], symbol = "BTC-USD") => ws("coinbase")!.say({ channel: "market_trades", timestamp: new Date(now).toISOString(), sequence_num: seq++, events: [{ type: "update", trades: prices.map((price, i) => ({ product_id: symbol, trade_id: `t${seq}-${i}`, price: String(price), size: "0.01", time: new Date(now).toISOString() })) }] }),
    /** a market_trades snapshot, as Coinbase sends on subscribing: trades stamped when they printed */
    snapshot: (trades: Array<[number, number]>, symbol = "BTC-USD") => ws("coinbase")!.say({ channel: "market_trades", timestamp: new Date(now).toISOString(), sequence_num: seq++, events: [{ type: "snapshot", trades: trades.map(([price, at], i) => ({ product_id: symbol, trade_id: `s${at}-${i}`, price: String(price), size: "0.01", time: new Date(at).toISOString() })) }] }),
    beat: () => ws("coinbase")!.say({ channel: "heartbeats", sequence_num: seq++, events: [{ heartbeat_counter: seq }] }),
  };
  let tid = 0;
  const hlSay = {
    bbo: (bid: number, ask: number, sizes: [number, number] = [10, 10]) => ws("hyperliquid")!.say({ channel: "bbo", data: { coin: "BTC", time: now, bbo: [{ px: String(bid), sz: String(sizes[0]) }, { px: String(ask), sz: String(sizes[1]) }] } }),
    mark: (markPx: number, funding = 0) => ws("hyperliquid")!.say({ channel: "activeAssetCtx", data: { coin: "BTC", ctx: { markPx: String(markPx), oraclePx: String(markPx), funding: String(funding) } } }),
    /** trades as Hyperliquid sends them: each stamped `at` (its block's time), coming here when said — half a second later, as measured */
    trades: (trades: Array<[number, number]>) => ws("hyperliquid")!.say({ channel: "trades", data: trades.map(([px, at]) => ({ coin: "BTC", side: "A", px: String(px), sz: "0.01", time: at, tid: ++tid, hash: "0x0", users: ["0x1", "0x2"] })) }),
    book: (bids: Array<[number, number]>, asks: Array<[number, number]>) => ws("hyperliquid")!.say({ channel: "l2Book", data: { coin: "BTC", time: now, levels: [bids.map(([px, sz]) => ({ px: String(px), sz: String(sz), n: 1 })), asks.map(([px, sz]) => ({ px: String(px), sz: String(sz), n: 1 }))] } }),
  };
  return { h, t: opened.source.trader! as LiveTrader, source: opened.source as LiveSource, coinbase, hl, told, live, cb, hlSay, ws };
}

describe("the paper account on its markets' live streams (feat/paper-live p2a)", () => {
  it("takes Coinbase's coin pair first, then Kraken's, then OKX's, every other source in its place — and a market's quote is its own stream's while it is live, said with its moment and its stream", async () => {
    const ids = (xs: PublicSource[]) => xs.map((x) => x.id);
    const s = (id: string) => source(id, id, []);
    expect(ids(paperOrder([s("kraken"), s("coinbase"), s("okx"), s("binance"), s("bybit"), s("kalshi"), s("hyperliquid")]))).toEqual(["coinbase", "kraken", "okx", "binance", "bybit", "kalshi", "hyperliquid"]);
    expect(ids(paperOrder([s("okx"), s("kalshi"), s("kraken")]))).toEqual(["kraken", "kalshi", "okx"]);
    const p = await open();
    // the REST listing first (nothing streamed yet: Coinbase's listing is its last trade, no bid and no ask), and the market wanted from the
    // hub as it is quoted
    const listed = ok(await p.t.market("BTC/USD"));
    expect(listed).toMatchObject({ price: 60000, quoteFrom: "Coinbase" });
    expect([listed.bid, listed.ask]).toEqual([undefined, undefined]);
    const w = await p.live();
    expect(w.sent.map((x) => JSON.parse(x))).toContainEqual({ type: "subscribe", product_ids: ["BTC-USD"], channel: "ticker" });
    p.cb.bbo(60100, 60101, 60100.5);
    expect(ok(await p.t.market("BTC/USD"))).toMatchObject({ price: 60100.5, bid: 60100, ask: 60101, quoteFrom: "Coinbase · live", quoteAt: new Date(now).toISOString() });
    // the stream gone quiet past three seconds: the REST listing again, its own age said
    now += 4_000;
    expect(ok(await p.t.market("BTC/USD"))).toMatchObject({ price: 60000, quoteFrom: "Coinbase" });
  });

  it("judges a resting limit on its market's tick: the trades reached it between two quotes, so it fills at its limit — told at once, and on disk within 50 ms", async () => {
    const p = await open();
    const placed = ok(await p.t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    expect(placed.status).toBe("open");
    await p.live();
    p.cb.bbo(59990, 60010);
    await turn();
    expect(p.told.flatMap((c) => c.fills)).toEqual([]);
    // a trade prints at 58,990 and the book is back where it was before the next quote
    now += 200;
    p.cb.trade(58990);
    p.cb.bbo(59990, 60010);
    await turn();
    const fills = p.told.flatMap((c) => c.fills);
    expect(fills).toEqual([expect.objectContaining({ ref: placed.ref, side: "buy", qty: 0.1, price: 59000, feeUsd: 5.9 })]);
    // told at once, written within FILL_SAVE_MS
    expect(book(p.h).orders[placed.ref]!.status).toBe("open");
    await vi.advanceTimersByTimeAsync(FILL_SAVE_MS);
    await p.source.paperBook!.flush();
    expect(book(p.h).orders[placed.ref]).toMatchObject({ status: "filled", avgPrice: 59000 });
    expect(statSync(paperBookPath(p.h, "paper-1")).mode & 0o777).toBe(0o600);
  });

  it("a stop the trades touched between two quotes triggers on the tick and fills at its stop — the quote back above it — while a stop the trades did not reach waits; only that market's orders are judged", async () => {
    const p = await open();
    ok(await p.t.place(order({ qty: 0.1 })));
    const stop = ok(await p.t.place(order({ side: "sell", type: "stop", stopPrice: 59500, qty: 0.05 })));
    const far = ok(await p.t.place(order({ side: "sell", type: "stop", stopPrice: 58000, qty: 0.05 })));
    const eth = ok(await p.t.place(order({ symbol: "ETH/USD", type: "limit", limitPrice: 1000, qty: 1 })));
    await p.live();
    p.cb.bbo(59990, 60010);
    await turn();
    now += 100;
    p.cb.trade(59450);
    p.cb.bbo(59990, 60010);
    await turn();
    const by = (ref: string) => p.told.flatMap((c) => c.orders).filter((o) => o.ref === ref).at(-1);
    expect(by(stop.ref)).toMatchObject({ status: "filled", avgPrice: 59500 });
    // told when they were placed, and nothing since
    expect(p.told.flatMap((c) => c.orders).filter((o) => o.ref === far.ref).map((o) => o.status)).toEqual(["open"]);
    expect(p.told.flatMap((c) => c.orders).filter((o) => o.ref === eth.ref).map((o) => o.status)).toEqual(["open"]);
  });

  it("a trailing stop follows each tick's best price, its moves told and written once a second — and its trigger told at once", async () => {
    const p = await open();
    ok(await p.t.place(order({ qty: 0.1 })));
    const trail = ok(await p.t.place(order({ side: "sell", type: "trailing_stop", trailPercent: 1, qty: 0.1 })));
    await p.live();
    const stopOf = () => p.told.flatMap((c) => c.orders).filter((o) => o.ref === trail.ref).at(-1)?.stopPrice;
    const onDisk = () => book(p.h).orders[trail.ref]!.stopPrice;
    const placedStop = onDisk();
    p.cb.bbo(60500, 60510);
    await turn();
    now += 100;
    p.cb.bbo(61000, 61010);
    await turn();
    // moved twice, told and written not yet (what was told is the stop it was placed with)
    expect([stopOf(), onDisk()]).toEqual([placedStop, placedStop]);
    await vi.advanceTimersByTimeAsync(TRAIL_SAVE_MS);
    await p.source.paperBook!.flush();
    expect(stopOf()).toBe(60390);
    expect(onDisk()).toBe(60390);
    // the bid falls through it: triggered and filled, told at once
    now += 100;
    p.cb.bbo(60300, 60310);
    await turn();
    expect(p.told.flatMap((c) => c.orders).filter((o) => o.ref === trail.ref).at(-1)).toMatchObject({ status: "filled", avgPrice: 60300 });
  });

  it("a bracket's exits are judged on the ticks: the take-profit reached fills at its limit, and the stop-loss is canceled with it (one cancels the other)", async () => {
    const p = await open();
    await p.t.market("BTC/USD");
    await p.live();
    p.cb.bbo(59990, 60010);
    const entry = ok(await p.t.place(order({ qty: 0.1, takeProfit: 60600, stopLoss: 59400 })));
    expect(entry).toMatchObject({ status: "filled", avgPrice: 60010 });
    const legs = (entry.native as { legs: Array<{ ref: string; type: string }> }).legs;
    now += 100;
    p.cb.trade(60650);
    p.cb.bbo(60590, 60610);
    await turn();
    const last = (ref: string) => p.told.flatMap((c) => c.orders).filter((o) => o.ref === ref).at(-1);
    expect(last(legs.find((l) => l.type === "limit")!.ref)).toMatchObject({ status: "filled", avgPrice: 60600 });
    expect(last(legs.find((l) => l.type === "stop")!.ref)).toMatchObject({ status: "canceled" });
  });

  it("a market order takes the ask where the best level holds its size, else walks the book at the average of what it took; one the book does not hold within its worst price fills nothing, in words", async () => {
    const levels: OrderBook = { bids: [[59990, 0.05], [59980, 0.2]], asks: [[60010, 0.05], [60020, 0.1], [60050, 1]], at: new Date(NOW).toISOString(), from: "Coinbase", depth: "full" };
    const p = await open({ cash: 100_000, extra: { book: async () => ({ ...levels, at: new Date(now).toISOString() }) } });
    // no stream yet: the listing has no sizes, so the book is read and walked
    const walked = ok(await p.t.place(order({ qty: 0.12 })));
    expect(walked).toMatchObject({ status: "filled", avgPrice: Number(((0.05 * 60010 + 0.07 * 60020) / 0.12).toFixed(10)) });
    // past the worst price: what the book holds within it is not enough
    const r = refusal(await p.t.place(order({ qty: 0.5, worstPrice: 60030 })));
    expect(r.message).toBe("Paper account: the order book shows 0.15 BTC on the ask side within the worst price the order allows (60,030), less than the 0.5 asked: a market order here fills whole or not at all — a smaller size, or a limit order that rests until it can: nothing was filled");
    // the stream's best ask holds the size: at the ask, the book not asked
    await p.live();
    p.cb.bbo(59990, 60011, 60000, "BTC-USD", [3, 2]);
    expect(ok(await p.t.place(order({ qty: 1 })))).toMatchObject({ status: "filled", avgPrice: 60011 });
  });

  it("a coin's fill takes a price at most a second old: a stream gone quiet waits a moment for its next word, else the order book read now, else the order is refused saying why", async () => {
    let bookUp = false;
    const p = await open({ extra: { book: async () => (bookUp ? { bids: [[59000, 10]], asks: [[59010, 10]], at: new Date(now).toISOString(), from: "Coinbase", depth: "full" } : { code: "E_VENUE_UNREACHABLE", message: "no answer", venue: "coinbase" } as never) } });
    await p.t.market("BTC/USD");
    await p.live();
    p.cb.bbo(59990, 60010);
    // two seconds quiet: still live (under three), but too old to fill at
    now += 2_000;
    const asked = p.t.place(order({ qty: 0.01 }));
    await vi.advanceTimersByTimeAsync(400);
    const r = refusal(await asked);
    expect(r.message).toMatch(/^Paper account: the latest price of BTC market is 2\.0 s old \(no newer price has come on Coinbase's live stream, and its order book did not answer in time\): a paper fill takes a bid and an ask at most 1 s old, so nothing was filled/);
    // the stream speaks within the wait — its ticker (a heartbeat says the connection carries, not that the best bid and ask still stand:
    // Coinbase's ticker speaks only when a trade happens): filled at its price
    const again = p.t.place(order({ qty: 0.01 }));
    await turn();
    p.cb.beat();
    p.cb.bbo(59990, 60010);
    await vi.advanceTimersByTimeAsync(10);
    expect(ok(await again)).toMatchObject({ status: "filled", avgPrice: 60010 });
    // quiet again, the order book answering: filled at the book's ask, read now
    now += 2_000;
    bookUp = true;
    const third = p.t.place(order({ qty: 0.01 }));
    await vi.advanceTimersByTimeAsync(400);
    expect(ok(await third)).toMatchObject({ status: "filled", avgPrice: 59010 });
  });

  it("holds buying power for open orders (P1): a plain sell's units, a perpetual's margin; a bracket's exits hold nothing, so a close goes; an amend is weighed again", async () => {
    const p = await open({ cash: 10_000 });
    ok(await p.t.place(order({ qty: 0.1 })));
    ok(await p.t.place(order({ side: "sell", type: "limit", limitPrice: 70000, qty: 0.08 })));
    const r = refusal(await p.t.place(order({ side: "sell", type: "limit", limitPrice: 71000, qty: 0.05 })));
    expect(r.message).toBe("Paper account: a sell sells only what the paper account holds and no open order sells already — 0.1 BTC held, 0.08 of it in open sell orders, 0.05 asked");
    // a perpetual's margin at 1x: $3,000 notional at 30,000 and its fee, held
    const perp = ok(await p.t.place(order({ symbol: "BTC-PERP", type: "limit", limitPrice: 30000, qty: 0.1 })));
    const cash = (await p.source.read()).find((x) => x.asset === "USD")!;
    expect(cash.freeUsd).toBeCloseTo(cash.amount - 3003, 2);
    const btc = (await p.source.read()).find((x) => x.asset === "BTC")!;
    expect(btc.freeAmount).toBeCloseTo(0.02, 10);
    // the amend that would hold more than is free is refused, and the order stays as it was
    expect(refusal(await p.t.amend!(perp.ref, "BTC-PERP", { qty: 1 }, order({ symbol: "BTC-PERP", type: "limit", limitPrice: 30000, qty: 1 }))).code).toBe("E_VENUE_INSUFFICIENT");
    // a bracket bought: its exits hold nothing — the position can be closed by hand at once
    const p2 = await open();
    const entry = ok(await p2.t.place(order({ qty: 0.1, takeProfit: 70000, stopLoss: 50000 })));
    expect(entry.status).toBe("filled");
    expect(ok(await p2.t.close!("BTC/USD", 0.1, clientId())).status).toBe("filled");
  });

  it("an owner's order is written before its answer; closed orders that filled nothing, a quarter old, go to the month's archive beside the book — filled ones stay", async () => {
    const h = home();
    const old = new Date(NOW - PRUNE_AFTER_MS - 86_400_000).toISOString();
    const recent = new Date(NOW - 86_400_000).toISOString();
    const base = { symbol: "BTC/USD", side: "buy" as const, type: "limit" as const, qty: 0.1, limitPrice: 50000, filledQty: 0, at: old };
    const was: PaperBook = { version: 1, id: "paper-1", name: "Paper account", createdAt: old, updatedAt: old, startCashUsd: 10000, feeBps: 10, cashUsd: 10000, holdings: {}, positions: {}, markets: { "BTC/USD": { source: "coinbase", kind: "spot", base: "BTC", quote: "USD", name: "BTC / USD" } }, fills: [], seq: 4, orders: {
      p1: { ...base, ref: "p1", clientId: "a", status: "canceled", updatedAt: old },
      p2: { ...base, ref: "p2", clientId: "b", status: "expired", updatedAt: old },
      p3: { ...base, ref: "p3", clientId: "c", status: "filled", filledQty: 0.1, avgPrice: 50000, feeUsd: 5, filledAt: old, updatedAt: old },
      p4: { ...base, ref: "p4", clientId: "d", status: "canceled", updatedAt: recent },
    } };
    mkdirSync(join(h, "paper", "paper-1"), { recursive: true });
    writeFileSync(paperBookPath(h, "paper-1"), JSON.stringify(was));
    const p = await open({ h });
    const placed = ok(await p.t.place(order({ type: "limit", limitPrice: 40000, qty: 0.01 })));
    // written before the answer came back
    const b = book(h);
    expect(b.orders[placed.ref]).toMatchObject({ status: "open" });
    expect(Object.keys(b.orders).sort()).toEqual(["p3", "p4", placed.ref].sort());
    const month = old.slice(0, 7);
    const archive = JSON.parse(readFileSync(join(h, "paper", "paper-1", `orders-${month}.json`), "utf8")) as { orders: Record<string, { status: string }> };
    expect(Object.keys(archive.orders).sort()).toEqual(["p1", "p2"]);
    expect(statSync(join(h, "paper", "paper-1", `orders-${month}.json`)).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(h, "paper", "paper-1")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(existsSync(paperBookPath(h, "paper-1"))).toBe(true);
  });

  it("after the machine slept, a look judges the time asleep against its market's real one-minute bars: a resting limit a bar reached filled at its limit then, saying so — only bars wholly inside the gap and after the order", async () => {
    const bars: Candle[] = [];
    const asked: Array<{ interval: string; since?: number | undefined; until?: number | undefined }> = [];
    const owns: Array<true | undefined> = [];
    const p = await open({
      extra: {
        candles: async (_s, interval, w) => {
          asked.push({ interval, since: w.since, until: w.until });
          owns.push(w.own);
          return bars.filter((x) => x.t >= (w.since ?? 0));
        },
      },
    });
    const placed = ok(await p.t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    expect(await p.source.settle!()).toBe(false);
    const asleep = now;
    // ten minutes asleep; a bar from before the order, one inside the gap that reached the limit, one still open at the wake
    bars.push({ t: asleep - 60_000, o: 60000, h: 60000, l: 58000, c: 60000 }, { t: asleep + 60_000, o: 59900, h: 60100, l: 58950, c: 59950 }, { t: asleep + 570_000, o: 59950, h: 60000, l: 58000, c: 59990 });
    now = asleep + 600_000;
    expect(await p.source.settle!()).toBe(true);
    const o = book(p.h).orders[placed.ref]!;
    expect(o).toMatchObject({ status: "filled", avgPrice: 59000, filledAt: new Date(asleep + 120_000).toISOString() });
    expect(o.note).toContain("while the account slept: Coinbase's 1m bar from 15:01 UTC (58,950–60,100) reached it");
    // the one-minute bars of the time asleep were asked, from the look before it to the wake — the listing source's own bars alone
    expect(asked).toEqual([{ interval: "1m", since: asleep, until: asleep + 600_000 }]);
    expect(owns).toEqual([true]);
  });

  it("an answer for the time asleep cut short (an older page refused: `partial`) judges nothing — a bracket's take-profit late in the sleep is never filled ahead of its stop-loss early in it, unseen", async () => {
    const asked: Array<{ interval: string; own?: true | undefined }> = [];
    let answer: (w: { since?: number | undefined }) => CandlePage = () => ({ bars: [], more: false });
    const p = await open({ extra: { candles: async (_s, interval, w) => (asked.push({ interval, own: w.own }), answer(w)) } });
    const placed = ok(await p.t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    expect(await p.source.settle!()).toBe(false);
    const asleep = now;
    // three days asleep; only the latest part answered, its first bar long after the sleep began — a bar there that reached the limit
    answer = () => ({ bars: [{ t: asleep + 2 * 86_400_000, o: 59900, h: 60100, l: 58950, c: 59950 }], more: true, partial: true });
    now = asleep + 3 * 86_400_000;
    await p.source.settle!();
    const o = book(p.h).orders[placed.ref]!;
    expect(o.status).toBe("open");
    expect(o.note ?? "").not.toContain("while the account slept");
    expect(asked.map((a) => [a.interval, a.own])).toEqual([["1m", true]]);
  });

  it("a source whose history at the size asked ends after the sleep began (Kraken's latest 720 minutes) is asked again a size coarser, and the sleep judged in those bars", async () => {
    const asked: string[] = [];
    let asleep = 0;
    const p = await open({
      extra: {
        candles: async (_s, interval, w) => {
          asked.push(interval);
          // twelve hours of minutes, said to end there; five-minute bars reaching back to the sleep's start
          if (interval === "1m") return { bars: [{ t: now - 12 * 3_600_000, o: 60000, h: 60000, l: 60000, c: 60000 }], more: false, ends: "Kraken keeps only the latest 720 bars at this size" };
          return { bars: [{ t: asleep + 300_000, o: 59900, h: 60100, l: 58950, c: 59950 }].filter((x) => x.t >= (w.since ?? 0)), more: false };
        },
      },
    });
    const placed = ok(await p.t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    expect(await p.source.settle!()).toBe(false);
    asleep = now;
    now = asleep + 2 * 86_400_000;
    expect(await p.source.settle!()).toBe(true);
    expect(asked).toEqual(["1m", "5m"]);
    const o = book(p.h).orders[placed.ref]!;
    expect(o).toMatchObject({ status: "filled", avgPrice: 59000 });
    expect(o.note).toContain("Coinbase's 5m bar");
  });

  it("a Kraken BTC/USD limit over a sleep is judged on Kraken's own bars only — never on Coinbase Exchange's, which its chart is drawn from", async () => {
    let asleep = 0;
    const handed: string[] = [];
    const sent: string[] = [];
    const kraken = exchangeTickers("kraken", {
      clock,
      pace: async () => undefined,
      // Coinbase Exchange trades BTC-USD and would answer bars that never reach the limit: they must not be the ones judged
      http: async (url) => {
        sent.push(url);
        if (url.includes("/products/BTC-USD/candles")) return { status: 200, body: [[(asleep + 60_000) / 1000, 59_500, 60_100, 59_900, 59_950, 1]], text: "" };
        if (url.includes("/products/BTC-USD")) return { status: 200, body: { status: "online", trading_disabled: false }, text: "" };
        return { status: 404, body: { message: "NotFound" }, text: "" };
      },
      open: async () =>
        ({
          id: "kraken",
          markets: { "BTC/USD": { symbol: "BTC/USD", base: "BTC", quote: "USD", spot: true } },
          timeframes: { "1m": "1", "5m": "5", "1h": "60", "1d": "1440", "1w": "10080" },
          async loadMarkets() {
            return {};
          },
          async fetchBalance() {
            throw new Error("never");
          },
          async fetchTickers() {
            return { "BTC/USD": { symbol: "BTC/USD", last: 60_000, info: { c: ["60000.0", "0.1"], a: ["60010.0", "1", "1"], b: ["59990.0", "1", "1"], v: ["1", "10"], p: ["60000", "60000"] } } };
          },
          // Kraken's own latest minutes: one before the sleep, one inside it that reached the limit
          async fetchOHLCV(symbol: string, timeframe: string, since?: number, limit?: number) {
            handed.push(`${symbol}|${timeframe}|${since}|${limit}`);
            return [[asleep - 60_000, 60_000, 60_000, 60_000, 60_000, 1], [asleep + 60_000, 59_900, 60_100, 58_950, 59_950, 1]];
          },
        }) as unknown as ExchangeClient,
    });
    hub ??= new StreamHub({ WebSocket: FakeWs, clock, random: () => 0 });
    const made = hub;
    const h = home();
    const opened = await paperSource({ home: h, venue: "paper-1", label: "", cashUsd: PAPER_DEFAULT_CASH, sources: () => [kraken], clock, hub: () => made });
    if (isRefusal(opened)) throw new Error(opened.message);
    const t = opened.source.trader!;
    const placed = ok(await t.place(order({ type: "limit", limitPrice: 59_000, qty: 0.1 })));
    expect(await opened.source.settle!()).toBe(false);
    asleep = now;
    now = asleep + 600_000;
    expect(await opened.source.settle!()).toBe(true);
    const o = book(h).orders[placed.ref]!;
    expect(o).toMatchObject({ status: "filled", avgPrice: 59_000 });
    expect(o.note).toContain("while the account slept: Kraken's 1m bar");
    expect(handed).toEqual(["BTC/USD|1m|undefined|720"]);
    expect(sent.some((u) => u.includes("/candles"))).toBe(false);
  });

  it("a sleep longer than one ask of one-minute bars reaches is judged in the finest bars whose one ask reaches back to it, so none of it goes unjudged", () => {
    const H = 3_600_000;
    expect([catchUpBar(0, 10 * 60_000), catchUpBar(0, 3 * 24 * H), catchUpBar(0, 4 * 24 * H), catchUpBar(0, 30 * 24 * H), catchUpBar(0, 365 * 24 * H), catchUpBar(0, 20 * 365 * 24 * H)]).toEqual(["1m", "1m", "5m", "15m", "4h", "1d"]);
    expect(CATCH_UP_BAR).toBe("1m");
  });

  it("marks a perpetual at its venue's mark on each tick, and liquidates it there when the margin left falls to the maintenance margin", async () => {
    const p = await open();
    await p.t.setLeverage!("BTC-PERP", 20);
    ok(await p.t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    await p.live("hyperliquid");
    p.hlSay.bbo(59990, 60010);
    p.hlSay.mark(60000);
    await turn();
    const pos1 = ok(await p.t.positions!())[0]!;
    expect(pos1).toMatchObject({ symbol: "BTC-PERP", markPrice: 60000 });
    // the mark falls past the liquidation price (the bid and ask a little above it): liquidated at the mark, on the tick
    const liq = pos1.liquidationPrice!;
    now += 100;
    p.hlSay.mark(liq - 10);
    p.hlSay.bbo(liq, liq + 5);
    await turn();
    const fill = p.told.flatMap((c) => c.fills).at(-1)!;
    expect(fill).toMatchObject({ symbol: "BTC-PERP", side: "sell", price: liq - 10 });
    expect(fill.note).toMatch(/^liquidated at the mark/);
  });

  it("Coinbase's ticker speaks only on a trade: after it, thirty seconds of heartbeats never make its old best ask a fill price — a market order fills at the REST book read now, or is refused saying so", async () => {
    let up = true;
    const p = await open({ extra: { book: async () => (up ? { bids: [[60010, 5]], asks: [[60020, 5]], at: new Date(now).toISOString(), from: "Coinbase", depth: "full" } : ({ code: "E_VENUE_UNREACHABLE", message: "no answer", venue: "coinbase" } as never)) } });
    await p.t.market("BTC/USD");
    await p.live();
    p.cb.bbo(59999, 60001);
    const tickerAt = now;
    for (let s = 0; s < 30; s++) {
      now += 1_000;
      p.cb.beat();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    // still live, and its price said as old as the ticker
    expect(ok(await p.t.market("BTC/USD"))).toMatchObject({ quoteFrom: "Coinbase · live", quoteAt: new Date(tickerAt).toISOString(), ask: 60001 });
    const filled = p.t.place(order({ qty: 0.1 }));
    await vi.advanceTimersByTimeAsync(400);
    expect(ok(await filled)).toMatchObject({ status: "filled", avgPrice: 60020 });
    up = false;
    const refused = p.t.place(order({ qty: 0.1 }));
    await vi.advanceTimersByTimeAsync(400);
    expect(refusal(await refused).message).toMatch(/^Paper account: the latest price of BTC market is 30 s old \(no newer price has come on Coinbase's live stream, and its order book did not answer in time\)/);
  });

  it("a trailing stop's trades are judged against the stop as it stood when they printed: a rally past the trail in one window moves the stop and triggers nothing — a dip under the moved stop in the next window does", async () => {
    const p = await open();
    await p.t.market("BTC/USD");
    await p.live();
    p.cb.bbo(59990, 60010);
    ok(await p.t.place(order({ qty: 0.1 })));
    const trail = ok(await p.t.place(order({ side: "sell", type: "trailing_stop", trailPercent: 1, qty: 0.1 })));
    expect((trail.native as { stopPrice: number }).stopPrice).toBe(59390.1);
    // one read: the trades rally 60,200 → 61,000, the bid follows them up. The price never fell
    now += 100;
    p.cb.trades([60200, 60600, 61000]);
    p.cb.bbo(61000, 61010);
    await turn();
    const fillsOf = () => p.told.flatMap((c) => c.fills).filter((f) => f.ref === trail.ref);
    expect(fillsOf()).toEqual([]);
    await vi.advanceTimersByTimeAsync(TRAIL_SAVE_MS);
    await p.source.paperBook!.flush();
    expect(book(p.h).orders[trail.ref]).toMatchObject({ status: "open", stopPrice: 60390 });
    // the next window: a trade under the stop as it stands now, the bid back above it — triggered there, at its stop
    now += 100;
    p.cb.trades([60350]);
    p.cb.bbo(60990, 61010);
    await turn();
    expect(fillsOf()).toEqual([expect.objectContaining({ ref: trail.ref, side: "sell", price: 60390 })]);
  });

  it("a Hyperliquid trade that comes half a second after its block's stamp — after the quote that moved the last judge — still touches a stop: live trades count by their seq, not by the venue's stamp against this machine's moment", async () => {
    const p = await open();
    await p.t.market("BTC-PERP");
    await p.live("hyperliquid");
    p.hlSay.bbo(59990, 60010);
    // the subscription's snapshot of the recent trades
    p.hlSay.trades([[60000, now - 5_000]]);
    ok(await p.t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    const stop = ok(await p.t.place(order({ symbol: "BTC-PERP", side: "sell", type: "stop", stopPrice: 59900, qty: 0.1, reduceOnly: true })));
    // a quote: the stop judged at this moment
    now += 100;
    p.hlSay.bbo(59990, 60010);
    await turn();
    // a trade at 59,850 comes 100 ms later, stamped 400 ms before it came (300 ms before that judge)
    now += 100;
    p.hlSay.trades([[59850, now - 400]]);
    await turn();
    expect(p.told.flatMap((c) => c.orders).filter((o) => o.ref === stop.ref).at(-1)).toMatchObject({ status: "filled", avgPrice: 59900 });
  });

  it("a perpetual opened after a long gap with nothing open is never judged against the bars from before it: the look before the owner's order takes the gap as it stood, and a position is judged from when it was opened only", async () => {
    // the exact case: connected at 15:00 with nothing open, bars at 15:05 and 15:10 dipping to 58,000, a 40x long opened at 15:30
    const dip: Candle[] = [{ t: NOW + 300_000, o: 60000, h: 60000, l: 58000, c: 59000 }, { t: NOW + 600_000, o: 59000, h: 60000, l: 58000, c: 60000 }];
    const p = await open({ hlExtra: { candles: async (_s, _i, w) => dip.filter((x) => x.t >= (w.since ?? 0)) } });
    now = NOW + 30 * 60_000;
    await p.t.setLeverage!("BTC-PERP", 40);
    expect(ok(await p.t.place(order({ symbol: "BTC-PERP", qty: 0.1 })))).toMatchObject({ status: "filled", avgPrice: 60012 });
    now += 5_000;
    await p.source.settle!();
    expect(book(p.h).positions["BTC-PERP"]).toMatchObject({ side: "long", qty: 0.1, openedAt: NOW + 30 * 60_000 });
    expect(book(p.h).fills.filter((f) => /liquidated/.test(f.note ?? ""))).toEqual([]);
    // the same, with no look before the order (no stream at the moment it was placed): the position's own moment keeps the bars from it
    hub?.close();
    hub = undefined;
    now = NOW;
    let streams = false;
    const q = await open({ hub: () => (streams ? hub : undefined), hlExtra: { candles: async (_s, _i, w) => dip.filter((x) => x.t >= (w.since ?? 0)) } });
    now = NOW + 30 * 60_000;
    await q.t.setLeverage!("BTC-PERP", 40);
    ok(await q.t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    streams = true;
    now += 5_000;
    await q.source.settle!();
    expect(book(q.h).positions["BTC-PERP"]).toMatchObject({ side: "long", qty: 0.1 });
    expect(book(q.h).fills.filter((f) => /liquidated/.test(f.note ?? ""))).toEqual([]);
  });

  it("a market order the stream's five levels do not hold walks the source's own book (fifty levels) before it is refused — and the book read for a page is the source's twenty levels, not the stream's five called whole", async () => {
    const ladder = (from: number, dir: number, n: number): Array<[number, number]> => Array.from({ length: n }, (_, i) => [from + dir * i, 1]);
    const rest: OrderBook = { bids: ladder(59999, -1, 50), asks: ladder(60001, 1, 50), at: new Date(NOW).toISOString(), from: "Hyperliquid", depth: "full" };
    const p = await open({ cash: 2_000_000, hlExtra: { book: async (_s, depth) => ({ ...rest, bids: rest.bids.slice(0, depth), asks: rest.asks.slice(0, depth), at: new Date(now).toISOString() }) } });
    await p.t.market("BTC-PERP");
    // a page shows the book: Hyperliquid's l2Book {fast} — five levels a side
    const release = hub!.hold("hyperliquid", "BTC-PERP", { book: true });
    await p.live("hyperliquid");
    p.hlSay.bbo(59999, 60001, [1, 1]);
    p.hlSay.book(ladder(59999, -1, 5), ladder(60001, 1, 5));
    const filled = ok(await p.t.place(order({ symbol: "BTC-PERP", qty: 20 })));
    expect(filled).toMatchObject({ status: "filled", avgPrice: 60010.5 });
    const deep = ok(await p.t.book!("BTC-PERP", 20));
    expect([deep.from, deep.bids.length, deep.asks.length]).toEqual(["Hyperliquid", 20, 20]);
    const top = ok(await p.t.book!("BTC-PERP", 5));
    expect([top.from, top.bids.length, top.more]).toEqual(["Hyperliquid · live", 5, { bids: true, asks: true }]);
    release();
  });

  it("a resting order is judged at an order book read up to two seconds old, as a new order fills at one: one rule for both", async () => {
    let ask = 60010;
    const p = await open({ extra: { book: async () => ({ bids: [[ask - 20, 5]], asks: [[ask, 5]], at: new Date(now - 1_500).toISOString(), from: "Coinbase", depth: "full" }) } });
    const placed = ok(await p.t.place(order({ type: "limit", limitPrice: 59500, qty: 0.1 })));
    expect(placed.status).toBe("open");
    // the book's ask comes to 59,400 (the listing's last trade with it), the book read 1.5 s before it is asked: the limit fills at it
    ask = 59400;
    p.coinbase.rows.find((r) => r.symbol === "BTC/USD")!.price = 59450;
    expect(await p.source.settle!()).toBe(true);
    expect(book(p.h).orders[placed.ref]).toMatchObject({ status: "filled", avgPrice: 59500 });
  });

  it("an order of the book started again while a tick waited on its book read fills nothing into the new book", async () => {
    let held: (() => void) | undefined;
    let slow = false;
    const p = await open({ cash: 100_000, extra: { book: async () => {
      if (slow) await new Promise<void>((go) => (held = go));
      return { bids: [[59000, 10]], asks: [[60620, 10]], at: new Date(now).toISOString(), from: "Coinbase", depth: "full" };
    } } });
    await p.t.market("BTC/USD");
    await p.live();
    p.cb.bbo(59990, 60010, 60000, "BTC-USD", [0.01, 0.01]);
    // a buy stop at 60,500 for one coin: the best ask (0.01) does not hold it, so its fill reads the book
    const stop = ok(await p.t.place(order({ type: "stop", stopPrice: 60500, qty: 1 })));
    slow = true;
    now += 100;
    p.cb.bbo(60590, 60600, 60595, "BTC-USD", [0.01, 0.01]);
    await turn();
    expect(held).toBeDefined();
    // the owner starts the book again meanwhile, and buys in that market in the new book
    ok(await p.source.paperBook!.reset(100_000));
    slow = false;
    ok(await p.t.place(order({ qty: 0.01 })));
    held!();
    await turn();
    await vi.advanceTimersByTimeAsync(FILL_SAVE_MS);
    await p.source.paperBook!.flush();
    const b = book(p.h);
    expect(b.orders[stop.ref]).toBeUndefined();
    expect(b.fills.map((f) => f.qty)).toEqual([0.01]);
    expect(b.holdings["BTC/USD"]!.qty).toBe(0.01);
    expect(b.cashUsd).toBeCloseTo(100_000 - 606 - 0.606, 6);
  });

  it("a pre-IPO venue's contract — no stream, no book — rests and fills at its listing however old it is, as it did before the streams: nothing fresher can be had for it", async () => {
    const rows = [row("ANTHROPIC/USDT:USDT", "perp", "ANTHROPIC", "USDT", 100, { maxLeverage: 2, name: "Anthropic pre-IPO" })];
    const preipo = source("okx-preipo", "OKX pre-IPO", rows, { listings: async () => readLike(rows.map((m) => ({ ...m })), now - 5_000) });
    hub ??= new StreamHub({ WebSocket: FakeWs, clock, random: () => 0 });
    const made = hub;
    const h = home();
    const opened = await paperSource({ home: h, venue: "paper-1", label: "", cashUsd: PAPER_DEFAULT_CASH, sources: () => [preipo], clock, hub: () => made });
    if (isRefusal(opened)) throw new Error(opened.message);
    const t = opened.source.trader!;
    const placed = ok(await t.place(order({ symbol: "ANTHROPIC/USDT:USDT", type: "limit", limitPrice: 95, qty: 1 })));
    expect(placed.status).toBe("open");
    // the listing, read five seconds before it is asked, now at 94
    Object.assign(rows[0]!, { price: 94, bid: 93.98, ask: 94.02 });
    for (let i = 0; i < 3; i++) {
      now += 2_000;
      await opened.source.settle!();
    }
    expect(book(h).orders[placed.ref]).toMatchObject({ status: "filled", avgPrice: 95 });
  });

  it("a market order whose best level is known to hold less than its size fills nothing when the order book does not answer — never whole at the best price", async () => {
    const p = await open({ extra: { book: async () => ({ code: "E_VENUE_UNREACHABLE", message: "no answer", venue: "coinbase" }) as never } });
    await p.t.market("BTC/USD");
    await p.live();
    p.cb.bbo(59990, 60010, 60000, "BTC-USD", [5, 0.01]);
    const r = refusal(await p.t.place(order({ qty: 5 })));
    expect(r.message).toBe("Paper account: the best ask holds 0.01, less than the 5 asked, and the order book did not answer in time to walk: a market order larger than the best level fills only against the book, whole or not at all — a smaller size, or try again in a moment: nothing was filled");
  });

  it("Coinbase's listing is its last trade only: with no stream and no book, nothing fills at it; a limit that crosses the last trade but not the book's ask rests", async () => {
    let up = false;
    const p = await open({ extra: { book: async () => (up ? { bids: [[60000, 5]], asks: [[60020, 5]], at: new Date(now).toISOString(), from: "Coinbase", depth: "full" } : ({ code: "E_VENUE_UNREACHABLE", message: "no answer", venue: "coinbase" } as never)) } });
    expect(refusal(await p.t.place(order({ qty: 0.1 }))).message).toBe("Paper account: the latest quote of BTC market is its last trade only, with no bid and ask (Coinbase's live stream is not live just now, and its order book did not answer in time): a paper fill takes a bid and an ask at most 1 s old, so nothing was filled — try again in a moment");
    up = true;
    const lim = ok(await p.t.place(order({ type: "limit", limitPrice: 60005, qty: 0.1 })));
    expect(lim.status).toBe("open");
    expect(book(p.h).fills).toEqual([]);
  });

  it("a trade from before an amend never fills the order as amended: after a restart, the stream's snapshot is cut at the moment the order was changed, not when it was placed", async () => {
    const p = await open();
    await p.t.market("BTC/USD");
    await p.live();
    p.cb.bbo(59990, 60010);
    const placed = ok(await p.t.place(order({ type: "limit", limitPrice: 58000, qty: 0.1 })));
    expect(placed.status).toBe("open");
    // twenty minutes on (BTC traded at 59,000 at 15:10 meanwhile), the limit is changed to 59,500 at the stream's quote, and rests
    now = NOW + 20 * 60_000;
    p.cb.bbo(59990, 60010);
    ok(await p.t.amend!(placed.ref, "BTC/USD", { limitPrice: 59500 }, order({ type: "limit", limitPrice: 59500, qty: 0.1 })));
    expect(book(p.h).orders[placed.ref]).toMatchObject({ status: "open", limitPrice: 59500, rested: true, amendedAt: new Date(now).toISOString() });
    // the service restarts: the book read afresh, and the stream's snapshot carries the 15:10 trade
    p.source.stop!();
    const q = await open({ h: p.h });
    await q.t.market("BTC/USD");
    q.cb.snapshot([[59000, NOW + 10 * 60_000]]);
    q.cb.bbo(59990, 60010);
    await turn();
    expect(book(q.h).orders[placed.ref]).toMatchObject({ status: "open" });
    expect(q.told.flatMap((c) => c.fills)).toEqual([]);
  });

  it("a read that only looks — the 24 hours of every market the book ever traded — streams none of them: only a market the book holds or has an order in is wanted", async () => {
    const p = await open();
    ok(await p.t.place(order({ qty: 0.1 })));
    ok(await p.t.place(order({ symbol: "ETH/USD", qty: 1 })));
    ok(await p.t.place(order({ symbol: "ETH/USD", side: "sell", qty: 1 })));
    // past every want: the hub lets them go
    now += IDLE_MS + 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(hub!.status().map((s) => s.key)).toEqual([]);
    ok(await p.t.stats!());
    expect(hub!.status().map((s) => s.key)).toEqual(["coinbase|BTC/USD"]);
  });
});

describe("the time asleep, a restart and the forced fill (the whole branch's review)", () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it("a restart is time asleep too: the last look is kept in the book, and once the account's streams are up the downtime is judged against the bars — a resting limit a bar reached while the service was not running fills at its limit then", async () => {
    const bars: Candle[] = [];
    const asked: Array<{ interval: string; since?: number | undefined; until?: number | undefined }> = [];
    const extra: Partial<PublicSource> = { candles: async (_s, interval, w) => (asked.push({ interval, since: w.since, until: w.until }), bars.filter((x) => x.t >= (w.since ?? 0))) };
    const p = await open({ extra });
    const placed = ok(await p.t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    expect(await p.source.settle!()).toBe(false);
    // the service stops without a word (a crash: nothing flushed) — the book on disk says when it was last looked at
    const down = now;
    expect(book(p.h).lookedAt).toBe(iso(down));
    p.source.stop!();
    bars.push({ t: down + 60_000, o: 59900, h: 60100, l: 58950, c: 59950 });
    now = down + 600_000;
    // it starts again: its paper accounts open before its streams do (server.ts watchStreams) — the first read judges nothing
    let up = false;
    const made = hub!;
    const q = await open({ h: p.h, extra, hub: () => (up ? made : undefined) });
    expect(book(q.h).orders[placed.ref]!.status).toBe("open");
    expect(asked).toEqual([]);
    // a look before the streams are up judges the orders at the quote as always — the downtime stays owed, never taken as judged
    expect(await q.source.settle!()).toBe(false);
    expect(asked).toEqual([]);
    up = true;
    now += 5_000;
    expect(await q.source.settle!()).toBe(true);
    const o = book(q.h).orders[placed.ref]!;
    expect(o).toMatchObject({ status: "filled", avgPrice: 59000, filledAt: iso(down + 120_000) });
    expect(o.note).toContain("while the account slept: Coinbase's 1m bar from 15:01 UTC (58,950–60,100) reached it");
    expect(asked).toEqual([{ interval: "1m", since: down, until: down + 605_000 }]);
  });

  it("bars that do not come back right after the Mac wakes (no network yet) leave the time asleep owed — nothing of that market judged at the quote meanwhile — and the next look asks again and judges it; owed past ten minutes it is given up, saying so", async () => {
    let fail = true;
    let asked = 0;
    const bars: Candle[] = [];
    const p = await open({ extra: { candles: async (_s, _i, w) => {
      asked++;
      if (fail) throw new Error("getaddrinfo ENOTFOUND api.exchange.coinbase.com");
      return bars.filter((x) => x.t >= (w.since ?? 0));
    } } });
    const placed = ok(await p.t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    expect(await p.source.settle!()).toBe(false);
    const asleep = now;
    bars.push({ t: asleep + 60_000, o: 59900, h: 60100, l: 58950, c: 59950 });
    now = asleep + 600_000;
    // the quote is under the limit now: judged at it, the order would fill at 58,000 — it is not judged at all while its time is owed
    p.coinbase.rows.find((r) => r.symbol === "BTC/USD")!.price = 58_000;
    expect(await p.source.settle!()).toBe(false);
    await p.source.paperBook!.flush();
    expect(book(p.h).orders[placed.ref]!.status).toBe("open");
    expect(book(p.h).owed).toEqual({ "BTC/USD": { from: iso(asleep), since: iso(asleep + 600_000) } });
    // the network is back: the next look asks again, from where the owed time began
    fail = false;
    now += 5_000;
    expect(await p.source.settle!()).toBe(true);
    expect(book(p.h).orders[placed.ref]).toMatchObject({ status: "filled", avgPrice: 59000, filledAt: iso(asleep + 120_000) });
    expect(asked).toBe(2);
    expect(book(p.h).owed).toBeUndefined();
    // another sleep whose bars never come back: owed until ten minutes have passed, then given up — judged at the quote from then on
    const second = ok(await p.t.place(order({ type: "limit", limitPrice: 50000, qty: 0.01 })));
    expect(await p.source.settle!()).toBe(false);
    fail = true;
    const asleep2 = now;
    now += 120_000;
    await p.source.settle!();
    now += OWED_MOST_MS + 5_000;
    await p.source.settle!();
    await p.source.paperBook!.flush();
    expect(book(p.h).orders[second.ref]!.note).toContain(`the time from ${iso(asleep2).slice(11, 16)} to ${iso(now).slice(11, 16)} UTC (the account not looking) was not judged against bars: Coinbase's bars did not come back — judged at the quote from then on`);
    expect(book(p.h).owed).toBeUndefined();
  });

  it("the stream's ticks never judge a market while the time asleep is being judged: a bracket whose stop-loss a bar reached during the sleep is stopped out there, though the price is back past its take-profit when the stream speaks again", async () => {
    let release: (() => void) | undefined;
    let gated = false;
    const bars: Candle[] = [];
    const p = await open({ extra: { candles: async (_s, _i, w) => {
      if (gated) await new Promise<void>((go) => (release = go));
      return bars.filter((x) => x.t >= (w.since ?? 0));
    } } });
    await p.t.market("BTC/USD");
    await p.live();
    p.cb.bbo(59990, 60010);
    const entry = ok(await p.t.place(order({ qty: 0.1, takeProfit: 60600, stopLoss: 59400 })));
    const legs = (entry.native as { legs: Array<{ ref: string; type: string }> }).legs;
    const tp = legs.find((l) => l.type === "limit")!.ref;
    const sl = legs.find((l) => l.type === "stop")!.ref;
    await p.source.settle!();
    const asleep = now;
    // asleep: a bar fell through the stop-loss, a later one rose through the take-profit
    bars.push({ t: asleep + 60_000, o: 60000, h: 60050, l: 59300, c: 59500 }, { t: asleep + 300_000, o: 60500, h: 60700, l: 60450, c: 60650 });
    now = asleep + 600_000;
    gated = true;
    const looking = p.source.settle!();
    await turn();
    expect(release).toBeDefined();
    // the stream is back while the bars are read: the price is past the take-profit
    p.cb.trade(60650);
    p.cb.bbo(60640, 60660);
    await turn();
    expect(p.told.flatMap((c) => c.fills).filter((f) => f.ref === tp || f.ref === sl)).toEqual([]);
    release!();
    expect(await looking).toBe(true);
    const b = book(p.h);
    expect(b.orders[sl]).toMatchObject({ status: "filled", avgPrice: 59400 });
    expect(b.orders[tp]).toMatchObject({ status: "canceled" });
    expect(b.holdings["BTC/USD"]).toBeUndefined();
  });

  it("a bar of the time asleep that opened above a long's stop-loss reached the stop before the liquidation price: the stop-loss fills, nothing is liquidated — and a bar that opened past the liquidation price (a gap) liquidates it first", async () => {
    const bars: Candle[] = [];
    const run = async (o: number) => {
      hub?.close();
      hub = undefined;
      now = NOW;
      bars.length = 0;
      const p = await open({ hlExtra: { candles: async (_s, _i, w) => bars.filter((x) => x.t >= (w.since ?? 0)) } });
      await p.t.setLeverage!("BTC-PERP", 40);
      const entry = ok(await p.t.place(order({ symbol: "BTC-PERP", qty: 0.1, stopLoss: 59600 })));
      expect(entry).toMatchObject({ status: "filled", avgPrice: 60012 });
      const sl = (entry.native as { legs: Array<{ ref: string }> }).legs[0]!.ref;
      await p.source.settle!();
      const asleep = now;
      bars.push({ t: asleep + 60_000, o, h: Math.max(o, 59950), l: 59000, c: 59100 });
      now = asleep + 600_000;
      expect(await p.source.settle!()).toBe(true);
      return { b: book(p.h), sl };
    };
    // opened at 59,900: the stop-loss at 59,600 came first, above the liquidation price (about 59,252)
    const above = await run(59900);
    expect(above.b.orders[above.sl]).toMatchObject({ status: "filled", avgPrice: 59600 });
    expect(above.b.positions["BTC-PERP"]).toBeUndefined();
    expect(above.b.fills.filter((f) => /liquidated/.test(f.note ?? ""))).toEqual([]);
    // opened at 59,200, past the liquidation price: liquidated there first, its stop-loss canceled with it
    const gap = await run(59200);
    expect(gap.b.fills.filter((f) => /liquidated/.test(f.note ?? ""))).toHaveLength(1);
    expect(gap.b.orders[gap.sl]).toMatchObject({ status: "canceled" });
  });

  it("a perpetual is liquidated only at a price fresh enough to fill at: a listing a hundred seconds old past the liquidation price liquidates nothing; the order book read now does, saying where its mark came from and how old it was", async () => {
    const rows = [row("BTC-PERP", "perp", "BTC", "USDC", 60000, { maxLeverage: 40, fundingRate: 0 })];
    let listedAt = NOW;
    let bookUp = true;
    let mid = 60000;
    const p = await open({
      hub: () => undefined,
      hlExtra: {
        listings: async () => readLike(rows.map((m) => ({ ...m })), listedAt),
        book: async () => (bookUp ? { bids: [[mid - 5, 10]], asks: [[mid + 5, 10]], at: iso(now), from: "Hyperliquid", depth: "full" } : ({ code: "E_VENUE_UNREACHABLE", message: "no answer", venue: "hyperliquid" } as never)),
      },
    });
    await p.t.setLeverage!("BTC-PERP", 40);
    // filled walking the book read for it (the listing says no sizes)
    expect(ok(await p.t.place(order({ symbol: "BTC-PERP", qty: 0.1 })))).toMatchObject({ status: "filled", avgPrice: 60005 });
    // the listing says 59,000 (past the liquidation price, about 59,245) — but it was read a hundred seconds ago, and the book does not answer
    bookUp = false;
    mid = 59000;
    now += 100_000;
    Object.assign(rows[0]!, { price: 59000, bid: 58988.2, ask: 59011.8 });
    listedAt = now - 100_000;
    await p.source.settle!();
    expect(book(p.h).positions["BTC-PERP"]).toMatchObject({ side: "long", qty: 0.1 });
    // the order book read now holds the same: liquidated at its middle, said
    bookUp = true;
    now += 5_000;
    expect(await p.source.settle!()).toBe(true);
    const f = book(p.h).fills.at(-1)!;
    expect(f).toMatchObject({ symbol: "BTC-PERP", side: "sell", price: 59000 });
    expect(f.note).toMatch(/^liquidated at the mark \(59,000\)/);
    expect(f.note).toContain("the mark from Hyperliquid · order book, 0.0 s old");
    expect(book(p.h).positions["BTC-PERP"]).toBeUndefined();
  });

  it("lowering a perpetual's leverage takes its margin from the free cash only: what open orders hold is theirs, and the refusal says how much is free", async () => {
    const p = await open({ cash: 10_000 });
    await p.t.setLeverage!("BTC-PERP", 40);
    ok(await p.t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    // a resting buy holds $7,507.50 of the cash
    ok(await p.t.place(order({ type: "limit", limitPrice: 50000, qty: 0.15 })));
    const r = refusal(await p.t.setLeverage!("BTC-PERP", 1));
    expect(r.code).toBe("E_VENUE_INSUFFICIENT");
    expect(r.message).toBe("Paper account: 1x on the open position needs $5,851.17 more margin, $2,336.47 free ($7,507.50 of the $9,843.97 paper cash is held for 1 open order)");
    expect(book(p.h).positions["BTC-PERP"]).toMatchObject({ leverage: 40 });
    ok(await p.t.setLeverage!("BTC-PERP", 3));
    expect(book(p.h).positions["BTC-PERP"]).toMatchObject({ leverage: 3, marginUsd: 2000.4 });
  });

  it("a close of the whole holding goes past the stop-loss resting on it, and cancels it; the estimate says before anything is signed what a part of it, or a book too thin for a market order, would be refused for", async () => {
    const p = await open({ cash: 1_000_000 });
    ok(await p.t.place(order({ qty: 0.1 })));
    const stop = ok(await p.t.place(order({ side: "sell", type: "stop", stopPrice: 59000, qty: 0.1 })));
    const part = ok(await p.t.estimate!({ symbol: "BTC/USD", side: "sell", qty: 0.05, price: 60000, type: "market" }));
    expect(part.refuses).toBe("Paper account: a sell sells only what the paper account holds and no open order sells already — 0.1 BTC held, 0.1 of it in open sell orders: at most 0 now — or cancel those orders first");
    const all = ok(await p.t.estimate!({ symbol: "BTC/USD", side: "sell", qty: 0.1, price: 60000, type: "market", close: true }));
    expect(all.refuses).toBeUndefined();
    expect(all.note).toBe("its open sell order is canceled with the close");
    const closed = ok(await p.t.close!("BTC/USD", 0.1, clientId()));
    expect(closed).toMatchObject({ status: "filled", filledQty: 0.1 });
    expect(book(p.h).orders[stop.ref]).toMatchObject({ status: "canceled", note: `canceled: the holding it was to sell was closed whole (${closed.ref})` });
    expect(book(p.h).holdings["BTC/USD"]).toBeUndefined();
    // the book holds five coins at the ask: a market buy of ten is refused before it is signed, with the most it would take
    const thin = ok(await p.t.estimate!({ symbol: "BTC/USD", side: "buy", qty: 10, price: 60012, type: "market", worstPrice: 61000 }));
    expect(thin.refuses).toBe("Paper account: the order book holds 5 BTC (≈ $300,060.00) on the ask side within the worst price the order allows (61,000), less than the 10 asked: a market order here fills whole or not at all — at most 5 now, or a limit order that rests until it can");
    // a coin's market order is fill-or-kill alone: it never promises a part filled
    expect(ok(await p.t.market("BTC/USD")).tifsByType).toMatchObject({ market: ["fok"] });
  });

  it("a holding's entry is the average of its fills, its fees left out (in its cost, and so in its result); a sale says what it realised", async () => {
    const p = await open();
    ok(await p.t.place(order({ qty: 0.1 })));
    const row1 = ok(await p.t.positions!()).find((x) => x.symbol === "BTC/USD")!;
    expect(row1).toMatchObject({ entryPrice: 60012, costUsd: 6007.2012 });
    const sold = ok(await p.t.place(order({ side: "sell", qty: 0.1 })));
    expect(sold.status).toBe("filled");
    const f = book(p.h).fills.at(-1)!;
    expect(f.realizedUsd).toBeCloseTo(0.1 * 59988 - 5.9988 - 6007.2012, 6);
  });
});

describe("US shares on the background reader (feat/paper-live phase 3): a fill at Robinhood's real-time quote as it is written, never at Cboe's delayed one", () => {
  /** Friday 16 October 2026, 11:00 New York (the regular session), the clock the timers': a paper account whose US stocks line answers
   * Cboe's delayed quote alone (its `line`, counted), beside the background reader of Robinhood's answer — written every fifteen seconds
   * from seven seconds before, AAPL's mid `mid` (moving a cent each write unless `still`), read through a stand-in network */
  async function stocks() {
    // this file fakes the timers alone: here the clock too
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    const first = NOW - 7_000;
    const px = { mid: 340, still: false };
    let lines = 0;
    let searches = 0;
    const http = async (url: string) => {
      const t = Date.now();
      if (url !== ROBINHOOD_PRICES) return { status: 200, body: { data: null }, text: "" };
      const k = Math.max(0, Math.floor((t - first) / 15_000));
      const mid = px.mid + (px.still ? 0 : k * 0.01);
      return { status: 200, text: "", body: { quotes: [{ tokenSymbol: "AAPL", bid: (mid - 0.02).toFixed(2), ask: (mid + 0.02).toFixed(2), currency: "USD", isTradingHalt: false, generatedAt: new Date(first + k * 15_000).toISOString() }] } };
    };
    const feed = new UsQuoteFeed({ source: "cboe", quotes: usQuote({ pace: async () => undefined, http }), listed: () => true });
    const delayed = (): Listing => ({ symbol: "AAPL", name: "Apple Inc", kind: "stock", base: "AAPL", quote: "USD", price: 338, bid: 337.98, ask: 338.02, open: true, types: [], quoteAt: new Date(Date.now() - CBOE_DELAY_MS).toISOString(), delayMs: CBOE_DELAY_MS, quoteFrom: CBOE_FROM, session: usSessionFull(Date.now(), false), venueName: "US stocks" });
    const cboe: PublicSource = { id: "cboe", name: "US stocks", kind: "stocks", connectTo: "alpaca", connector: "live:alpaca", sessions: usClock, listings: async () => (searches++, [delayed()]), line: async (sym) => (lines++, sym === "AAPL" ? delayed() : null) };
    const h = home();
    const venues = new StreamHub({ WebSocket: FakeWs, clock: Date.now, random: () => 0 });
    const joined = joinHubs(venues, feed);
    const opened = await paperSource({ home: h, venue: "paper-1", label: "", cashUsd: 10_000, sources: () => [cboe], clock: Date.now, hub: () => joined });
    if (isRefusal(opened)) throw new Error(opened.message);
    const told: PaperChange[] = [];
    opened.source.paperEvents!.listen((c) => told.push(c));
    return { h, t: opened.source.trader! as LiveTrader, feed, px, told, lines: () => lines, listings: () => searches, close: () => joined.close() };
  }

  it("a market order with Cboe's quote alone is refused — the only quote is 15 minutes old, use a limit — and with Robinhood's read as it is written it fills at Robinhood's ask; the line is asked for that one share (P16)", async () => {
    const s = await stocks();
    try {
      const m0 = ok(await s.t.market("AAPL"));
      expect(m0).toMatchObject({ quoteFrom: CBOE_FROM, delayMs: CBOE_DELAY_MS });
      expect(m0.refusesNow!.market).toContain("is Cboe's, 15 minutes behind the market");
      expect(refusal(await s.t.place(order({ symbol: "AAPL", qty: 1 }))).message).toContain("use a limit order");
      // the ticket's market wanted it from the reader: two of Robinhood's writes later its book has been seen to move
      await vi.advanceTimersByTimeAsync(25_000);
      const m = ok(await s.t.market("AAPL"));
      expect(m).toMatchObject({ quoteFrom: ROBINHOOD_FROM, delayMs: 0, session: { phase: "regular" } });
      expect(m.refusesNow).toBeUndefined();
      expect(Date.now() - Date.parse(m.quoteAt!)).toBeLessThan(15_000);
      const filled = ok(await s.t.place(order({ symbol: "AAPL", qty: 2 })));
      expect(filled).toMatchObject({ status: "filled", avgPrice: m.ask, feeUsd: 0 });
      // the line was asked for AAPL alone — never the stocks line's search (P16) — and not at all once the reader's quote was live
      expect(s.lines()).toBe(2);
      expect(s.listings()).toBe(0);
    } finally {
      s.close();
      vi.useRealTimers();
    }
  });

  it("a trailing stop on a share placed out of its session with Cboe's delayed quote alone starts no trail from it: it waits, holding the cash its trail from the last price would need, until the session's first real-time quote", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    // Friday 16 October 2026, 18:00 New York: after-hours
    vi.setSystemTime(Date.parse("2026-10-16T22:00:00Z"));
    try {
      const delayed = (): Listing => ({ symbol: "AAPL", name: "Apple Inc", kind: "stock", base: "AAPL", quote: "USD", price: 338, bid: 337.98, ask: 338.02, open: true, types: [], quoteAt: new Date(Date.now() - CBOE_DELAY_MS).toISOString(), delayMs: CBOE_DELAY_MS, quoteFrom: CBOE_FROM, session: usSessionFull(Date.now(), false), venueName: "US stocks" });
      const cboe: PublicSource = { id: "cboe", name: "US stocks", kind: "stocks", connectTo: "alpaca", connector: "live:alpaca", sessions: usClock, listings: async () => [delayed()], line: async (sym) => (sym === "AAPL" ? delayed() : null) };
      const h = home();
      const opened = await paperSource({ home: h, venue: "paper-1", label: "", cashUsd: 10_000, sources: () => [cboe], clock: Date.now });
      if (isRefusal(opened)) throw new Error(opened.message);
      const placed = ok(await opened.source.trader!.place(order({ symbol: "AAPL", type: "trailing_stop", trailPercent: 1, qty: 1, tif: "gtc" })));
      const o = book(h).orders[placed.ref]!;
      expect([o.status, o.hwm, o.stopPrice, o.note]).toEqual(["open", undefined, undefined, "its trail starts at the session's first real-time quote"]);
      // what it holds: the cash a stop 1% over the last ask would need
      const cash = (await opened.source.read()).find((x) => x.asset === "USD")!;
      expect(cash.freeUsd).toBeCloseTo(10_000 - 338.02 * 1.01, 2);
      // a look out of the session moves no trail
      vi.setSystemTime(Date.now() + 60_000);
      await opened.source.settle!();
      expect(book(h).orders[placed.ref]).toMatchObject({ status: "open", note: "its trail starts at the session's first real-time quote" });
      expect(book(h).orders[placed.ref]!.stopPrice).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a resting limit and a stop are judged on the reader's tick — the moment Robinhood's write that crosses them is read, not at the next look", async () => {
    const s = await stocks();
    try {
      ok(await s.t.market("AAPL"));
      await vi.advanceTimersByTimeAsync(25_000);
      // bought 2; a buy limit under the book rests, and a stop sells the rest under it
      ok(await s.t.place(order({ symbol: "AAPL", qty: 2 })));
      const lim = ok(await s.t.place(order({ symbol: "AAPL", type: "limit", limitPrice: 339.5, qty: 1 })));
      const stop = ok(await s.t.place(order({ symbol: "AAPL", side: "sell", type: "stop", stopPrice: 339.6, qty: 2, tif: "gtc" })));
      expect(book(s.h).orders[lim.ref]!.rested).toBe(true);
      expect(book(s.h).orders[stop.ref]!.status).toBe("open");
      s.told.length = 0;
      // Robinhood's next write has the book at 339.30/339.34: read as it is written, it fills the limit at its own price and triggers the stop
      s.px.mid = 339.32 - Math.floor((Date.now() + 15_000 - (NOW - 7_000)) / 15_000) * 0.01;
      await vi.advanceTimersByTimeAsync(15_000);
      // told as the tick filled them (the book written within FILL_SAVE_MS, in the background)
      expect(s.told.flatMap((c) => c.fills).map((f) => [f.ref, f.side])).toEqual([[lim.ref, "buy"], [stop.ref, "sell"]]);
      expect(s.told.flatMap((c) => c.fills).find((f) => f.ref === lim.ref)!.price).toBe(339.5);
      expect(ok(await s.t.status(lim.ref, "AAPL"))).toMatchObject({ status: "filled", avgPrice: 339.5 });
      expect(ok(await s.t.status(stop.ref, "AAPL")).status).toBe("filled");
    } finally {
      s.close();
      vi.useRealTimers();
    }
  });
});

describe("the stand-in's live streams (test/standin venues.ts standinHub)", () => {
  it("stream the stand-in world's own prices while a market is wanted: each pulse (the world's tick) tells its quote, its trades and its book, and a market no one wants any more is let go", async () => {
    const world = makeWorld({ clock });
    const hub = standinHub(world);
    const [pubex] = publicSources();
    const symbol = ((await pubex!.listings({ limit: 1 })) as Listing[])[0]!.symbol;
    const told: string[] = [];
    hub.onTick((t) => told.push(`${t.symbol}:${t.what}`));
    expect(hub.covers("standin-pubex-public", symbol)).toBe(true);
    expect(hub.covers("coinbase", "BTC/USD")).toBe(false);
    expect(hub.want("standin-pubex-public", symbol)).toBe(true);
    const before = hub.quote("standin-pubex-public", symbol)!;
    expect(before).toMatchObject({ live: true, src: "Stand-in stream" });
    now += 3_000;
    tick(world);
    hub.pulse();
    expect(told).toEqual([`${symbol}:quote`, `${symbol}:trades`, `${symbol}:book`]);
    const after = hub.quote("standin-pubex-public", symbol)!;
    expect(after.seq).toBe(before.seq + 1);
    expect(after.last).toBe(world.pubex.market(symbol)!.price);
    expect(hub.trades("standin-pubex-public", symbol, 5)).toHaveLength(1);
    expect(hub.book("standin-pubex-public", symbol, 3)!.bids).toHaveLength(3);
    // nobody wants it a minute on: let go at the next pulse
    now += 61_000;
    hub.pulse();
    expect(hub.quote("standin-pubex-public", symbol)).toBeUndefined();
  });

  it("streams the stand-in's own venues under their own ids where it is told their books (feat/paper-live p2b: the stand-in page's bar, chart, book and positions move wherever the trading area opens), each quote stamped with the pulse that last moved it and confirmed as it is read", () => {
    const world = makeWorld({ clock });
    const hub = standinHub(world, { ex: () => world.ex });
    expect(hub.covers("ex", "BTC/USDT")).toBe(true);
    expect(standinHub(world).covers("ex", "BTC/USDT")).toBe(false);
    const release = hub.hold("ex", "BTC/USDT");
    const t0 = now;
    now += 3_000;
    tick(world);
    hub.pulse();
    const pulsed = now;
    now += 1_200;
    const q = hub.quote("ex", "BTC/USDT")!;
    expect(q).toMatchObject({ at: pulsed, recvAt: pulsed, seenAt: now, live: true, last: world.ex.market("BTC/USDT")!.price });
    expect(q.at).toBeGreaterThan(t0);
    expect(hub.book("ex", "BTC/USDT")!.bids.length).toBeGreaterThan(0);
    release();
  });
});
