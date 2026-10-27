import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import { liveOptions, openLive, type LiveDeps } from "../../src/portfolio/live/index.ts";
import { PAPER_DEFAULT_CASH, paperBookPath, paperBooksOnDisk, paperSource, parsePaperCash, resetBookOnDisk, type PaperBook, type PaperChange } from "../../src/portfolio/live/paper.ts";
import { rebuildEquity, replayPaperBook } from "../../src/portfolio/live/paper-history.ts";
import type { Listing, PublicSource } from "../../src/portfolio/live/public-markets.ts";
import type { LiveTrader, Market, OrderRequest, OrderState } from "../../src/portfolio/live/trade.ts";
import type { LiveBalance, LiveSource } from "../../src/portfolio/live/types.ts";

/** THE ACCOUNT'S OWN PAPER ACCOUNT (live/paper.ts): paper money, the markets the public sources list, fills by the account's own declared
 * rule, a book in the home. The public sources here are stand-ins that speak the real ones' shape (public-markets.ts PublicSource), with
 * prices the tests move; nothing reaches the network and no money exists anywhere. */
const NOW = 1791484300000;
let now = NOW;
const clock = () => now;
let n = 0;
const clientId = () => (++n).toString(16).padStart(32, "0");

type Row = Listing & { price: number; bid: number; ask: number };
const row = (symbol: string, kind: Market["kind"], base: string, quote: string, price: number, extra: Partial<Row> = {}): Row => ({ symbol, name: `${base} ${kind === "perp" ? "perpetual" : kind === "event" ? "contract" : "market"}`, kind, base, quote, price, bid: price - price * 0.0002, ask: price + price * 0.0002, open: true, types: [], volumeUsd24h: 1_000_000, changePct24h: 1.2, ...extra });
/** a stand-in public source: a list the test can reprice, a search by a few letters, and (where said) candles and events */
function source(id: string, name: string, kind: PublicSource["kind"], rows: Row[], extra: Partial<PublicSource> = {}): PublicSource & { rows: Row[] } {
  return {
    id,
    name,
    kind,
    connectTo: id,
    connector: `live:exchange:${id}`,
    rows,
    async listings(o) {
      const Q = (o.q ?? "").trim().toUpperCase();
      return (Q ? rows.filter((m) => m.symbol.toUpperCase().includes(Q) || m.base.toUpperCase().includes(Q)) : rows).slice(0, o.limit).map((m) => ({ ...m }));
    },
    ...extra,
  };
}
const reprice = (s: { rows: Row[] }, symbol: string, price: number, spread = 0.0002) => {
  const m = s.rows.find((x) => x.symbol === symbol)!;
  m.price = price;
  m.bid = price - price * spread;
  m.ask = price + price * spread;
};
const BARS = [{ t: NOW - 7_200_000, o: 59000, h: 60100, l: 58900, c: 60000, v: 12 }];
function sources() {
  // a coin pair's listing is Coinbase's first where Coinbase lists it, then Kraken's (paper.ts paperOrder, feat/paper-live p2): the sources
  // come in the real ones' order (Kraken before Coinbase), and Coinbase's BTC/USD is the paper account's
  const coinbase = source("coinbase", "Coinbase", "exchange", [row("BTC/USD", "spot", "BTC", "USD", 60000, { volumeUsd24h: 2e9 }), row("ETH/USD", "spot", "ETH", "USD", 2000), row("DOGE/EUR", "spot", "DOGE", "EUR", 0.1), row("BTC/USD:USD-251226", "future", "BTC", "USD", 61000)], { candles: async (symbol) => (symbol === "BTC/USD" ? BARS : []) });
  const kraken = source("kraken", "Kraken", "exchange", [row("BTC/USD", "spot", "BTC", "USD", 60100), row("SOL/USD", "spot", "SOL", "USD", 150)]);
  const hl = source("hyperliquid", "Hyperliquid", "exchange", [row("BTC-PERP", "perp", "BTC", "USDC", 60005, { fundingRate: 0.0000125 }), row("ETH-PERP", "perp", "ETH", "USDC", 2001)]);
  const fed = row("KXFED-25DEC-T4.00:YES", "event", "KXFED-25DEC-T4.00:YES", "USD", 0.62, { bid: 0.61, ask: 0.63, group: { id: "KXFED-25DEC-T4.00", title: "Fed cuts in December?" }, outcome: "YES", closeTime: new Date(NOW + 30 * 86_400_000).toISOString(), category: "Economics" });
  const kalshi = source("kalshi", "Kalshi", "events", [fed], { events: async () => [{ ...fed }] });
  const tokens = source("robinhood-stock-tokens", "Robinhood Stock Tokens", "tokens", [row("NVDA", "token", "NVDA", "USD", 180, { bid: 179.9, ask: 180.1 })]);
  return { all: [kraken, coinbase, hl, kalshi, tokens], kraken, coinbase, hl, kalshi, tokens };
}

const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const home = () => {
  const h = mkdtempSync(join(tmpdir(), "paper-"));
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
async function open(h: string, venue = "paper-1", o: { label?: string; cash?: number; all?: PublicSource[] } = {}): Promise<{ t: LiveTrader; source: LiveSource; first: LiveBalance[]; s: ReturnType<typeof sources> }> {
  const s = sources();
  const opened = await paperSource({ home: h, venue, label: o.label ?? "", cashUsd: o.cash ?? PAPER_DEFAULT_CASH, sources: () => o.all ?? s.all, clock });
  if (isRefusal(opened)) throw new Error(`${opened.code}: ${opened.message}`);
  return { t: opened.source.trader!, source: opened.source, first: opened.first, s };
}
const order = (o: Partial<OrderRequest> = {}): OrderRequest => ({ symbol: "BTC/USD", side: "buy", type: "market", qty: 0.1, clientId: clientId(), ...o });
const cashOf = (first: LiveBalance[]) => first.find((b) => b.asset === "USD" && b.where === "paper money")!.usd!;
const book = (h: string, venue = "paper-1"): PaperBook => JSON.parse(readFileSync(paperBookPath(h, venue), "utf8")) as PaperBook;

describe("a paper account: opened with paper money, its book in the home", () => {
  it("opens with the default paper money, or the sum given; says paper in its name; keeps its book for the user alone", async () => {
    const h = home();
    const { source, first } = await open(h);
    expect(source.paper).toBe(true);
    expect(source.name).toBe("Paper account");
    expect(source.via).toContain("the account's own book");
    expect(source.probe.note).toContain("a paper account: fills at the public quote by the account's own rule");
    // the rule as the engine keeps it (feat/paper-live p2): the book walked whole or not at all, the one-second price, what open orders hold
    expect(source.probe.note).toContain("a market order at the ask or the bid, a size the best level does not hold walking the order book at the average of what it took, whole or not at all (no partial fills)");
    expect(source.probe.note).toContain("a coin or a perpetual only at a bid and an ask at most 1 s old — its live stream's, else its order book read then — or not at all, saying why; what open orders may need held from the buying power");
    expect(source.probe.note).not.toContain("no depth");
    expect(source.readOnlyBecause).toContain("paper money");
    expect(first).toEqual([{ asset: "USD", amount: 10000, usd: 10000, where: "paper money", class: "cash" }]);
    const path = paperBookPath(h, "paper-1");
    expect([existsSync(path), statSync(path).mode & 0o777]).toEqual([true, 0o600]);
    expect(book(h)).toMatchObject({ version: 1, id: "paper-1", cashUsd: 10000, startCashUsd: 10000, feeBps: 10 });
    const rich = await open(h, "paper-momentum", { label: "Momentum", cash: 25000 });
    expect([rich.source.name, cashOf(rich.first)]).toEqual(["Momentum · paper", 25000]);
    expect((await open(h, "paper-3", { label: "My paper book" })).source.name).toBe("My paper book");
  });

  it("the starting money as the owner writes it: empty is the default, dollars with or without $ and commas, nothing else", () => {
    expect(parsePaperCash("", "paper-1")).toBe(PAPER_DEFAULT_CASH);
    expect(parsePaperCash(" $25,000 ", "paper-1")).toBe(25000);
    expect(parsePaperCash("1500.50", "paper-1")).toBe(1500.5);
    expect(refusal(parsePaperCash("lots", "paper-1")).code).toBe("E_ACCOUNT_CREDENTIAL");
    expect(refusal(parsePaperCash("0", "paper-1")).code).toBe("E_ACCOUNT_CREDENTIAL");
    expect(refusal(parsePaperCash("200000000", "paper-1")).message).toContain("at most");
    expect(refusal(parsePaperCash("999999999999", "paper-1")).code).toBe("E_ACCOUNT_CREDENTIAL");
  });

  it("lists what the public sources list, in dollars, the first source speaking for a symbol two list; one market priced fresh, with the account's own steps and rule", async () => {
    const { t } = await open(home());
    const all = ok(await t.markets(""));
    // the sources in turn, each one's first market, then each one's second: every kind is in the few to start from
    expect(all.map((m) => m.symbol)).toEqual(["BTC/USD", "SOL/USD", "BTC-PERP", "KXFED-25DEC-T4.00:YES", "NVDA", "ETH/USD", "ETH-PERP"]);
    // Coinbase's BTC/USD, not Kraken's, though Kraken comes first in the sources' own order; no euro market, no dated future
    expect(all.find((m) => m.symbol === "BTC/USD")!.price).toBe(60000);
    expect(ok(await t.markets("BTC")).map((m) => m.symbol)).toEqual(["BTC/USD", "BTC-PERP"]);
    const btc = ok(await t.market("BTC/USD"));
    expect(btc).toMatchObject({ kind: "spot", base: "BTC", quote: "USD", price: 60000, bid: 59988, ask: 60012, open: true, minNotional: 1, qtyStep: 0.000001, types: ["market", "limit", "stop", "stop_limit", "trailing_stop"], tifs: ["gtc", "ioc", "fok"], tifsByType: { market: ["fok"] }, postOnly: false, sellsReduce: true, brackets: true });
    // the account's fill rule, apart from what is said of this market now (no words of its own here: a list's line of it says nothing)
    expect(btc.rule).toContain("a paper account");
    expect(btc.note).toBeUndefined();
    expect(ok(await t.market("BTC-PERP"))).toMatchObject({ kind: "perp", reduceOnly: true, maxLeverage: 1, contractSize: 1, fundingRate: 0.0000125 });
    expect(ok(await t.market("KXFED-25DEC-T4.00:YES"))).toMatchObject({ kind: "event", minQty: 1, qtyStep: 1, priceStep: 0.01, bid: 0.61, ask: 0.63, outcome: "YES" });
    expect(refusal(await t.market("XYZ/USD")).code).toBe("E_VENUE_REJECTED");
  });
});

describe("fills by the account's own rule", () => {
  it("a market buy fills whole at the ask with the fee, the holding is marked at the price; a sell sells only what is held, at the bid", async () => {
    const h = home();
    const { t, source, s } = await open(h);
    const bought = ok(await t.place(order({ qty: 0.1 })));
    expect(bought).toMatchObject({ status: "filled", filledQty: 0.1, avgPrice: 60012, feeUsd: 6.0012 });
    expect(book(h).cashUsd).toBeCloseTo(10000 - 6001.2 - 6.0012, 4);
    const read = await source.read();
    expect(read.find((b) => b.asset === "BTC")).toMatchObject({ amount: 0.1, usd: 6000, class: "crypto" });
    expect(cashOf(read)).toBeCloseTo(3992.8, 2);
    expect(refusal(await t.place(order({ side: "sell", qty: 0.2 }))).code).toBe("E_VENUE_INSUFFICIENT");
    reprice(s.coinbase, "BTC/USD", 61000);
    const sold = ok(await t.place(order({ side: "sell", qty: 0.1 })));
    expect(sold).toMatchObject({ status: "filled", avgPrice: 60987.8 });
    expect(book(h).holdings).toEqual({});
    expect(book(h).cashUsd).toBeCloseTo(3992.7988 + 6098.78 - 6.09878, 3);
    // the same client id again is the same order, not a second fill
    expect(ok(await t.place({ ...order({ qty: 0.1 }), clientId: (bought.native as { order: string }).order === "p1" ? book(h).orders.p1!.clientId : "" }))).toMatchObject({ ref: "p1", status: "filled" });
  });

  it("the worst price the door gives a market order holds: a quote past it fills nothing", async () => {
    const h = home();
    const { t } = await open(h);
    const r = refusal(await t.place(order({ qty: 0.1, worstPrice: 60000 })));
    expect(r.code).toBe("E_VENUE_REJECTED");
    expect(r.message).toContain("past the worst price");
    expect(book(h).cashUsd).toBe(10000);
    expect(ok(await t.place(order({ qty: 0.1, worstPrice: 60012 }))).status).toBe("filled");
  });

  it("a limit order rests, fills at its limit when the quote crosses it — judged when the account looks — an IOC limit that does not cross is canceled, and a resting order can be taken off", async () => {
    const h = home();
    const { t, s, source } = await open(h);
    const resting = ok(await t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    expect(resting).toMatchObject({ status: "open", filledQty: 0 });
    expect(ok(await t.status(resting.ref, "BTC/USD")).status).toBe("open");
    reprice(s.coinbase, "BTC/USD", 58980);
    now += 30_000;
    expect(ok(await t.status(resting.ref, "BTC/USD"))).toMatchObject({ status: "filled", avgPrice: 59000, filledQty: 0.1, feeUsd: 5.9 });
    expect(book(h).holdings["BTC/USD"]).toMatchObject({ qty: 0.1 });
    const ioc = ok(await t.place(order({ side: "sell", type: "limit", limitPrice: 70000, qty: 0.1, tif: "ioc" })));
    expect(ioc.status).toBe("canceled");
    expect(book(h).holdings["BTC/USD"]!.qty).toBe(0.1);
    // a limit that crosses when it is placed takes the quote, where that is better than its limit
    const crossing = ok(await t.place(order({ side: "sell", type: "limit", limitPrice: 58000, qty: 0.05 })));
    expect(crossing).toMatchObject({ status: "filled", avgPrice: 58968.204 });
    const open2 = ok(await t.place(order({ type: "limit", limitPrice: 50000, qty: 0.1 })));
    expect(ok(await t.cancel(open2.ref, "BTC/USD")).status).toBe("canceled");
    expect(refusal(await t.cancel("p99", "BTC/USD")).code).toBe("E_ACCOUNT_ORDER_UNKNOWN");
    // what a resting order needs is held for it (P1, feat/paper-live p2): one the paper money does not cover is refused when it is placed,
    // in words, rather than rejected when it would fill
    const big = refusal(await t.place(order({ type: "limit", limitPrice: 58900, qty: 1 })));
    expect(big.code).toBe("E_VENUE_INSUFFICIENT");
    expect(big.message).toBe("Paper account: not enough paper buying power — $58,958.90 held for this order, $7,039.56 free");
    // one it covers is held: the cash line says what is free, and an order that would take the held money is refused for it
    const held = ok(await t.place(order({ type: "limit", limitPrice: 50000, qty: 0.1 })));
    expect(held.status).toBe("open");
    const cash = (await source.read()).find((x) => x.asset === "USD")!;
    expect(cash).toMatchObject({ amount: 7039.56, freeUsd: 2034.56 });
    expect(refusal(await t.place(order({ qty: 0.05 }))).message).toBe("Paper account: not enough paper money — $2,952.54 needed, $2,034.56 free ($5,005.00 of the $7,039.56 paper cash is held for 1 open order)");
  });

  it("refuses what it does not take, in words, before anything moves: a stop on an event contract, post-only, a day order on a coin, a trail on a plain order, reduce-only on spot, a size off the step, a market no source prices", async () => {
    const h = home();
    const { t } = await open(h);
    expect(refusal(await t.place(order({ symbol: "KXFED-25DEC-T4.00:YES", qty: 1, type: "stop", stopPrice: 0.5 }))).code).toBe("E_VENUE_ORDER_INVALID");
    expect(refusal(await t.place(order({ type: "limit", limitPrice: 50000, postOnly: true }))).message).toContain("post-only");
    expect(refusal(await t.place(order({ type: "limit", limitPrice: 50000, tif: "day" }))).message).toContain("not day");
    expect(refusal(await t.place(order({ trailPercent: 2 }))).message).toContain("a trail belongs to a trailing stop");
    expect(refusal(await t.place(order({ type: "trailing_stop", side: "sell" }))).message).toContain("one of the two");
    expect(refusal(await t.place(order({ reduceOnly: true }))).message).toContain("reduce-only is for a perpetual");
    expect(refusal(await t.place(order({ symbol: "KXFED-25DEC-T4.00:YES", qty: 1.5 }))).message).toContain("steps of 1");
    expect(refusal(await t.place(order({ symbol: "XYZ/USD" }))).code).toBe("E_VENUE_REJECTED");
    expect(book(h).cashUsd).toBe(10000);
  });

  it("perpetuals at 1x: the notional is the margin, the position is marked at the quote, a reduce-only close realises it, a flip is refused, a short is a short", async () => {
    const h = home();
    const { t, source, s } = await open(h);
    const opened = ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    expect(opened).toMatchObject({ status: "filled", avgPrice: 60017.001 });
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ side: "long", qty: 0.1, entryPrice: 60017.001, marginUsd: 6001.7001 });
    reprice(s.hl, "BTC-PERP", 62000);
    const pos = ok(await t.positions!());
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({ symbol: "BTC-PERP", side: "long", qty: 0.1, entryPrice: 60017.001, markPrice: 62000, usd: 6200, leverage: 1 });
    expect(pos[0]!.unrealizedUsd).toBeCloseTo(198.2999, 3);
    const margin = (await source.read()).find((b) => b.where?.startsWith("paper margin"))!;
    expect(margin.usd).toBeCloseTo(6001.7 + 198.3, 1);
    // counted in what the account is worth, none of it free to spend: it is the position's
    expect(margin.freeUsd).toBe(0);
    expect(refusal(await t.place(order({ symbol: "BTC-PERP", side: "sell", qty: 0.2 }))).message).toContain("flip the side");
    expect(refusal(await t.place(order({ symbol: "BTC-PERP", side: "sell", qty: 0.2, reduceOnly: true }))).message).toContain("more than");
    expect(refusal(await t.place(order({ symbol: "ETH-PERP", side: "sell", qty: 1, reduceOnly: true }))).message).toContain("no long position");
    const half = ok(await t.place(order({ symbol: "BTC-PERP", side: "sell", qty: 0.05, reduceOnly: true })));
    expect(half.status).toBe("filled");
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ qty: 0.05 });
    expect(book(h).fills.at(-1)!.realizedUsd).toBeCloseTo((61987.6 - 60017.001) * 0.05, 3);
    ok(await t.place(order({ symbol: "BTC-PERP", side: "sell", qty: 0.05 })));
    expect(book(h).positions).toEqual({});
    const short = ok(await t.place(order({ symbol: "ETH-PERP", side: "sell", qty: 1 })));
    expect(short.status).toBe("filled");
    expect(book(h).positions["ETH-PERP"]).toMatchObject({ side: "short", qty: 1 });
    reprice(s.hl, "ETH-PERP", 1900);
    expect(ok(await t.positions!())[0]!.unrealizedUsd).toBeCloseTo(2000.5998 - 1900, 3);
    expect(refusal(await t.place(order({ symbol: "BTC-PERP", qty: 100 }))).code).toBe("E_VENUE_INSUFFICIENT");
  });

  it("event contracts: whole contracts at the ask, held and marked at the price, never settled", async () => {
    const h = home();
    const { t, source } = await open(h);
    const got = ok(await t.place(order({ symbol: "KXFED-25DEC-T4.00:YES", qty: 10 })));
    expect(got).toMatchObject({ status: "filled", avgPrice: 0.63, feeUsd: 0.0063 });
    const line = (await source.read()).find((b) => b.class === "event")!;
    expect(line).toMatchObject({ asset: "KXFED-25DEC-T4.00:YES", amount: 10, usd: 6.2 });
    expect(line.where).toContain("Fed cuts");
  });

  it("stats, price history and events come from the market's own source; a source with no history says so", async () => {
    const { t } = await open(home());
    expect(ok(await t.stats!(["BTC/USD"])).get("BTC/USD")).toMatchObject({ price: 60000, changePct24h: 1.2 });
    expect(ok(await t.candles!("BTC/USD", "1h", { since: NOW - 86_400_000 }))).toEqual(BARS);
    expect(refusal(await t.candles!("KXFED-25DEC-T4.00:YES", "1h", { since: NOW - 86_400_000 })).code).toBe("E_VENUE_RAIL_CLOSED");
    expect(ok(await t.events!({ limit: 10 })).map((m) => [m.symbol, m.kind])).toEqual([["KXFED-25DEC-T4.00:YES", "event"]]);
  });
});

describe("the book", () => {
  it("is continued when the same venue is opened again — cash, holdings, resting orders, markets — and another venue is another book", async () => {
    const h = home();
    const a = await open(h, "paper-a", { label: "Alpha", cash: 5000 });
    ok(await a.t.place(order({ qty: 0.01 })));
    const resting = ok(await a.t.place(order({ type: "limit", limitPrice: 50000, qty: 0.01 })));
    const again = await open(h, "paper-a", { label: "Alpha", cash: 99 });
    expect(again.source.name).toBe("Alpha · paper");
    expect(cashOf(again.first)).toBeCloseTo(5000 - 600.12 - 0.60012, 2);
    expect(again.first.find((b) => b.asset === "BTC")).toMatchObject({ amount: 0.01 });
    expect(ok(await again.t.status(resting.ref, "BTC/USD")).status).toBe("open");
    const b = await open(h, "paper-b", { cash: 99 });
    expect(cashOf(b.first)).toBe(99);
    expect([existsSync(paperBookPath(h, "paper-a")), existsSync(paperBookPath(h, "paper-b"))]).toEqual([true, true]);
  });

  it("through the account's own table: live:paper needs nothing, takes a name and a sum, and is paper", async () => {
    const h = home();
    const s = sources();
    expect(liveOptions(h).options.find((o) => o.kind === "paper")).toMatchObject({ connector: "live:paper", needs: "none", venues: [] });
    const deps = { home: h, clock, publicSources: () => s.all, http: async () => ({ status: 599, body: undefined, text: "" }), proofs: {}, price: async () => undefined, mm: async () => ({}) } as unknown as LiveDeps;
    const opened = await openLive({ venue: "paper-momentum", connector: "live:paper", label: "Momentum", reference: " $25,000 " }, deps);
    if (isRefusal(opened)) throw new Error(opened.message);
    expect(opened.source).toMatchObject({ paper: true, name: "Momentum · paper", reference: "paper/paper-momentum/book.json" });
    expect(opened.first).toEqual([{ asset: "USD", amount: 25000, usd: 25000, where: "paper money", class: "cash" }]);
    expect(opened.summary).toContain("started with $25,000.00 of paper money");
    expect(refusal(await openLive({ venue: "paper-2", connector: "live:paper", label: "", reference: "a lot" }, deps)).code).toBe("E_ACCOUNT_CREDENTIAL");
    const state: OrderState | Refusal = await opened.source.trader!.place(order({ qty: 0.01 }));
    expect(ok(state).status).toBe("filled");
  });
});

// ---- V2: US stocks in their window, perpetuals with leverage, funding and liquidation, event contracts settled ------------------------

import { fromEt } from "../../src/portfolio/account/calendar.ts";
import { liquidationPriceOf, STOCK_JUDGE_MS } from "../../src/portfolio/live/paper.ts";
import { usSession } from "../../src/portfolio/live/public-stocks.ts";
import { usClock, usSessionFull } from "../../src/portfolio/account/calendar.ts";
import type { MarketSession, SessionClock } from "../../src/portfolio/live/trade.ts";

/** a Cboe-like stocks source (its id is what the paper account's window rule looks for), its session from the calendar at the clock */
function cboeLike(rows: Row[]) {
  const s = source("cboe", "Cboe", "stocks", rows, { readOnly: "a stand-in's delayed quotes" });
  s.listings = async (o) => {
    const Q = (o.q ?? "").trim().toUpperCase();
    return (Q ? s.rows.filter((m) => m.symbol.toUpperCase().includes(Q) || m.base.toUpperCase().includes(Q)) : s.rows).slice(0, o.limit).map((m) => ({ ...m, session: usSession(clock()), venueName: "Cboe · 15 min delayed" }));
  };
  return s;
}

describe("US stocks: the old delayed line (no quote time) fills nothing — Cboe's quote is fifteen minutes behind the market (feat/paper-live phase 3)", () => {
  it("in its session a market order is refused, saying the only quote is Cboe's and to use a limit; out of it a market order is queued and a limit rests — and neither is filled at the delayed line when the session comes", async () => {
    now = fromEt(2026, 10, 7, 11, 0);
    try {
      const h = home();
      const cboe = cboeLike([row("AAPL", "stock", "AAPL", "USD", 340, { volumeUsd24h: undefined, changePct24h: 0.25 })]);
      const { t, source: src } = await open(h, "paper-1", { all: [cboe] });
      expect(src.trader!.kinds).toContain("stock");
      const m = ok(await t.market("AAPL"));
      expect(m).toMatchObject({ kind: "stock", base: "AAPL", quote: "USD", types: ["market", "limit", "stop", "stop_limit", "trailing_stop"], tifs: ["day", "gtc", "ioc", "fok"], session: { open: true }, sellsReduce: true, qtyStep: 0.000001 });
      // the account's fill rule (the ticket's "How it fills here"), apart from what is said of this market now
      expect(m.rule).toContain("a stock only at a real-time quote from inside its session");
      // the market says so before anything is prepared: no market order now, and why
      expect(m.refusesNow!.market).toContain("15 minutes behind the market");
      expect(m.refusesNow!.market).toContain("so it takes no market order now — use a limit order");
      const refused = refusal(await t.place(order({ symbol: "AAPL", qty: 2 })));
      expect(refused.message).toBe("Paper account: the only quote of AAPL market just now is Cboe's, 15 minutes behind the market: a paper account never fills a stock at a delayed quote, so nothing was filled — use a limit order, which rests until a real-time quote reaches it");
      expect(book(h).holdings["AAPL"]).toBeUndefined();
      // nor a trailing stop, whose trail would start from a price fifteen minutes old
      expect(m.refusesNow!.trailing_stop).toContain("so a trailing stop has no price of this moment to trail from");
      expect(refusal(await t.place(order({ symbol: "AAPL", side: "sell", type: "trailing_stop", trailPercent: 2, qty: 1, tif: "gtc" }))).message).toContain("trailing stop has no price of this moment to trail from");
      // a limit that crosses the delayed quote: on the book, waiting for a real-time quote — never filled at Cboe's
      const waits = ok(await t.place(order({ symbol: "AAPL", type: "limit", limitPrice: 345, qty: 1 })));
      expect(waits.status).toBe("open");
      expect((waits.native as { note?: string }).note).toBe("waiting for a fresh price: judged at the next one");
      // after the close: a market order is queued for the session, a limit rests
      now = fromEt(2026, 10, 7, 16, 20);
      const closed = ok(await t.market("AAPL"));
      expect(closed.session).toMatchObject({ open: false });
      expect(closed.note).toContain("a market order waits for it (queued for the open)");
      expect(closed.refusesNow).toBeUndefined();
      const queued = ok(await t.place(order({ symbol: "AAPL", qty: 1 })));
      expect(queued.status).toBe("open");
      expect((queued.native as { note?: string }).note).toContain("queued for the open");
      // a DAY order — a stock's default for a market order — ends with the session it is for: the next one's close
      expect((queued.native as { expiresAt?: string }).expiresAt).toBe(new Date(fromEt(2026, 10, 8, 16, 0)).toISOString());
      const resting = ok(await t.place(order({ symbol: "AAPL", type: "limit", limitPrice: 345, qty: 1 })));
      expect(resting.status).toBe("open");
      expect((resting.native as { note?: string }).note).toContain("resting until");
      // the window opens: the delayed line is all there is, and it fills neither
      now = fromEt(2026, 10, 8, 9, 50);
      for (const r of [resting.ref, queued.ref, waits.ref]) expect(ok(await t.status(r, "AAPL")).status).toBe("open");
      expect(book(h).holdings["AAPL"]).toBeUndefined();
      // an IOC order out of the window fills nothing
      now = fromEt(2026, 10, 10, 12, 0);
      expect(ok(await t.place(order({ symbol: "AAPL", type: "limit", limitPrice: 345, qty: 1, tif: "ioc" }))).status).toBe("canceled");
      expect(ok(await t.place(order({ symbol: "AAPL", qty: 1, tif: "ioc" }))).status).toBe("canceled");
    } finally {
      now = NOW;
    }
  });
});

/** a stock source that stamps each quote with its own time and its delay, and keeps the market's clock (the real US line's shape): the test
 * moves the quote's time with the price */
function stamped(id: string, rows: Row[], clockOf: SessionClock, o: { delayMs?: number; session?: (ms: number) => MarketSession } = {}) {
  const s = source(id, id, "stocks", rows, { sessions: clockOf });
  const stamp = new Map<string, number>();
  s.listings = async (q) => {
    const Q = (q.q ?? "").trim().toUpperCase();
    return (Q ? s.rows.filter((m) => m.symbol.toUpperCase().includes(Q)) : s.rows).slice(0, q.limit).map((m) => ({ ...m, quoteAt: new Date(stamp.get(m.symbol) ?? clock()).toISOString(), delayMs: o.delayMs ?? 0, quoteFrom: `${id} · test`, session: o.session ? o.session(clock()) : usSessionFull(clock(), false) }));
  };
  return Object.assign(s, { stamp });
}

describe("stocks by their quote's own time: the regular session, extended hours, a quote that stopped moving", () => {
  it("fills only at a quote stamped inside a session the order trades in; an extended-hours limit trades pre-market and after-hours; a stale quote fills nothing", async () => {
    now = fromEt(2026, 10, 14, 11, 0);
    try {
      const h = home();
      const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock);
      const { t } = await open(h, "paper-1", { all: [us] });
      expect(ok(await t.place(order({ symbol: "NVDA", qty: 1 })))).toMatchObject({ status: "filled", avgPrice: 200.04 });
      // a quote that stopped moving: stamped 11:00, read at 11:20 — past its delay and the grace — fills nothing. The market is in its
      // regular session all the same, by its own clock: a market order is one for now, refused saying how old the quote is — never queued
      // "for the open" that has come — and a limit waits unjudged for the next real-time quote
      us.stamp.set("NVDA", fromEt(2026, 10, 14, 11, 0));
      now = fromEt(2026, 10, 14, 11, 20);
      const stale = ok(await t.market("NVDA"));
      expect(stale.note ?? "").not.toContain("the regular session is not on now");
      expect(stale.refusesNow!.market).toContain("is 20 min old");
      expect(refusal(await t.place(order({ symbol: "NVDA", qty: 1 }))).message).toContain("so nothing was filled — try again in a moment, or use a limit order");
      const waits = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 201, qty: 1 })));
      expect(waits.status).toBe("open");
      us.stamp.delete("NVDA");
      now += 10_000;
      expect(ok(await t.status(waits.ref, "NVDA")).status).toBe("filled");
      // after-hours: a plain limit rests; one sent for extended hours trades now
      now = fromEt(2026, 10, 14, 17, 0);
      const m = ok(await t.market("NVDA"));
      expect(m.session).toMatchObject({ phase: "after", extendedHours: true });
      const plainLimit = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 201, qty: 1 })));
      expect(plainLimit.status).toBe("open");
      const eh = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 201, qty: 1, extendedHours: true, tif: "day" })));
      expect(eh).toMatchObject({ status: "filled", avgPrice: 200.04 });
      expect(refusal(await t.place(order({ symbol: "NVDA", qty: 1, extendedHours: true }))).message).toContain("limit order only");
      // a day order for extended hours ends with the after-hours session
      const ehRest = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 150, qty: 1, extendedHours: true, tif: "day" })));
      expect((ehRest.native as { expiresAt?: string }).expiresAt).toBe(new Date(fromEt(2026, 10, 14, 20, 0)).toISOString());
      now = fromEt(2026, 10, 14, 20, 1);
      expect(ok(await t.status(ehRest.ref, "NVDA")).status).toBe("expired");
      // stops are watched in the regular session only
      now = fromEt(2026, 10, 15, 8, 0);
      const stop = ok(await t.place(order({ symbol: "NVDA", side: "sell", type: "stop", stopPrice: 210, qty: 1, tif: "gtc" })));
      expect(ok(await t.status(stop.ref, "NVDA")).status).toBe("open");
      now = fromEt(2026, 10, 15, 9, 31);
      expect(ok(await t.status(stop.ref, "NVDA"))).toMatchObject({ status: "filled", avgPrice: 199.96 });
    } finally {
      now = NOW;
    }
  });

  it("A SHARE CBOE ALONE PRICES, BY THE MARKET'S OWN CLOCK (phase 3): at 16:05 the market is in after-hours though Cboe's quote of 15:50 sees the regular session — a market order, a position's Close too, is queued for the open, never refused as if the session were on; at 09:35 it is open though Cboe's quote of 09:20 sees pre-market — a market order is refused for want of a real-time quote, never queued for the open that has come; the delayed quote fills nothing, and the first real-time quote fills what was queued", async () => {
    now = fromEt(2026, 10, 14, 15, 30);
    try {
      const h = home();
      // the US line as it is: a real-time quote where one answers, else Cboe's, fifteen minutes behind
      const line = { delayMs: 0 };
      const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock, line);
      const { t } = await open(h, "paper-1", { all: [us] });
      expect(ok(await t.place(order({ symbol: "NVDA", qty: 2 })))).toMatchObject({ status: "filled", avgPrice: 200.04 });
      // 16:05 Wednesday: only Cboe's quote, the market's 15:50
      line.delayMs = 15 * 60_000;
      now = fromEt(2026, 10, 14, 16, 5);
      us.stamp.set("NVDA", fromEt(2026, 10, 14, 15, 50));
      const evening = ok(await t.market("NVDA"));
      expect(evening.refusesNow).toBeUndefined();
      expect(evening.note).toContain("the regular session is not on now: a market order waits for it (queued for the open)");
      const buy = ok(await t.place(order({ symbol: "NVDA", qty: 1 })));
      const close = ok(await t.close!("NVDA", 2, clientId()));
      for (const o of [buy, close]) {
        expect(o.status).toBe("open");
        expect((o.native as { note?: string }).note).toContain("queued for the open");
      }
      // a look at 16:10, Cboe's quote the market's 15:55 — the regular session as it sees it: neither is filled at it
      now = fromEt(2026, 10, 14, 16, 10);
      us.stamp.set("NVDA", fromEt(2026, 10, 14, 15, 55));
      expect([ok(await t.status(buy.ref, "NVDA")).status, ok(await t.status(close.ref, "NVDA")).status]).toEqual(["open", "open"]);
      // 09:35 Thursday: only Cboe's quote, the market's 09:20 — pre-market as it sees it — but the market is open: a market order is for
      // now, refused saying the only quote is fifteen minutes behind; a limit waits unjudged for a real-time quote, not for "the session"
      now = fromEt(2026, 10, 15, 9, 35);
      us.stamp.set("NVDA", fromEt(2026, 10, 15, 9, 20));
      const morning = ok(await t.market("NVDA"));
      expect(morning.note ?? "").not.toContain("the regular session is not on now");
      expect(morning.refusesNow!.market).toContain("15 minutes behind the market: a paper account never fills a stock at a delayed quote, so it takes no market order now — use a limit order");
      expect(refusal(await t.place(order({ symbol: "NVDA", qty: 1 }))).message).toContain("15 minutes behind the market");
      const limit = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 150, qty: 1 })));
      expect((limit.native as { note?: string }).note).toBe("waiting for a fresh price: judged at the next one");
      expect([ok(await t.status(buy.ref, "NVDA")).status, ok(await t.status(close.ref, "NVDA")).status]).toEqual(["open", "open"]);
      // 09:36: a real-time quote answers, and what was queued for the open fills at it
      line.delayMs = 0;
      us.stamp.delete("NVDA");
      now = fromEt(2026, 10, 15, 9, 36);
      expect(ok(await t.status(buy.ref, "NVDA"))).toMatchObject({ status: "filled", avgPrice: 200.04 });
      expect(ok(await t.status(close.ref, "NVDA"))).toMatchObject({ status: "filled", avgPrice: 199.96 });
    } finally {
      now = NOW;
    }
  });
});

describe("stops, trailing stops and brackets", () => {
  // these move the clock: each starts at NOW and leaves it there
  beforeEach(() => {
    now = NOW;
  });
  afterEach(() => {
    now = NOW;
  });
  it("a stop triggers when the bid (a sell) or the ask (a buy) reaches it and fills at the quote; a stop-limit becomes its limit", async () => {
    const h = home();
    const { t, s } = await open(h);
    ok(await t.place(order({ qty: 0.16 })));
    const stop = ok(await t.place(order({ side: "sell", type: "stop", stopPrice: 59000, qty: 0.1 })));
    expect(stop.status).toBe("open");
    reprice(s.coinbase, "BTC/USD", 59500);
    now += 10_000;
    expect(ok(await t.status(stop.ref, "BTC/USD")).status).toBe("open");
    reprice(s.coinbase, "BTC/USD", 58900);
    now += 10_000;
    expect(ok(await t.status(stop.ref, "BTC/USD"))).toMatchObject({ status: "filled", avgPrice: 58888.22 });
    const sl = ok(await t.place(order({ side: "sell", type: "stop_limit", stopPrice: 58000, limitPrice: 57900, qty: 0.06 })));
    reprice(s.coinbase, "BTC/USD", 57950);
    now += 10_000;
    const fired = ok(await t.status(sl.ref, "BTC/USD"));
    // triggered (the bid reached 58000), and its limit 57900 crossed the moment it became one: it never rested, so it takes the bid
    // (57938.41), better than its limit
    expect(fired).toMatchObject({ status: "filled", avgPrice: 57938.41 });
    expect((fired.native as { triggeredAt?: string }).triggeredAt).toBeTruthy();
  });

  it("a stop-limit that triggers short of its limit rests, and fills at its limit once the quote comes to it", async () => {
    const h = home();
    const { t, s } = await open(h);
    ok(await t.place(order({ qty: 0.1 })));
    const sl = ok(await t.place(order({ side: "sell", type: "stop_limit", stopPrice: 58000, limitPrice: 57950, qty: 0.1 })));
    // the bid (57948.41) reaches the stop but not the limit: triggered, resting
    reprice(s.coinbase, "BTC/USD", 57960);
    now += 10_000;
    const resting = ok(await t.status(sl.ref, "BTC/USD"));
    expect(resting.status).toBe("open");
    expect((resting.native as { triggeredAt?: string }).triggeredAt).toBeTruthy();
    expect(book(h).orders[sl.ref]!.rested).toBe(true);
    // the quote comes back up through it: the book's maker, filled at its own price
    reprice(s.coinbase, "BTC/USD", 58500);
    now += 10_000;
    expect(ok(await t.status(sl.ref, "BTC/USD"))).toMatchObject({ status: "filled", avgPrice: 57950 });
  });

  it("a trailing stop follows the best price since it was placed and triggers its trail behind it", async () => {
    const h = home();
    const { t, s } = await open(h);
    ok(await t.place(order({ qty: 0.1 })));
    const trail = ok(await t.place(order({ side: "sell", type: "trailing_stop", trailPercent: 5, qty: 0.1 })));
    // from the bid now (59988): its stop 5% under it
    expect((trail.native as { stopPrice: number }).stopPrice).toBeCloseTo(59988 * 0.95, 6);
    reprice(s.coinbase, "BTC/USD", 70000);
    now += 10_000;
    const up = ok(await t.status(trail.ref, "BTC/USD"));
    expect(up.status).toBe("open");
    expect((up.native as { stopPrice: number }).stopPrice).toBeCloseTo(69986 * 0.95, 6);
    // a fall that stays above the moved stop does nothing; one through it sells at the bid
    reprice(s.coinbase, "BTC/USD", 67000);
    now += 10_000;
    expect(ok(await t.status(trail.ref, "BTC/USD")).status).toBe("open");
    reprice(s.coinbase, "BTC/USD", 66000);
    now += 10_000;
    expect(ok(await t.status(trail.ref, "BTC/USD"))).toMatchObject({ status: "filled", avgPrice: 65986.8 });
  });

  it("a bracket: its exits go on the book when the entry fills, the one that fills cancels the other; refused the wrong way round", async () => {
    const h = home();
    const { t, s } = await open(h);
    expect(refusal(await t.place(order({ takeProfit: 59000, stopLoss: 55000 }))).message).toContain("take-profit");
    const entry = ok(await t.place(order({ qty: 0.1, takeProfit: 66000, stopLoss: 57000 })));
    expect(entry.status).toBe("filled");
    const legs = (entry.native as { legs: Array<{ ref: string; type: string; side: string; status: string }> }).legs;
    expect(legs.map((l) => [l.type, l.side, l.status])).toEqual([["limit", "sell", "open"], ["stop", "sell", "open"]]);
    reprice(s.coinbase, "BTC/USD", 67000);
    now += 10_000;
    const after = ok(await t.status(entry.ref, "BTC/USD"));
    expect((after.native as { legs: Array<{ status: string; avgPrice?: number }> }).legs.map((l) => l.status)).toEqual(["filled", "canceled"]);
    expect(book(h).holdings["BTC/USD"]).toBeUndefined();
    // a perpetual's exits are reduce-only
    const perp = ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1, stopLoss: 50000 })));
    const leg = book(h).orders[(perp.native as { legs: Array<{ ref: string }> }).legs[0]!.ref]!;
    expect(leg).toMatchObject({ type: "stop", side: "sell", reduceOnly: true, stopPrice: 50000, parent: perp.ref });
  });

  it("a bracket's exits are judged against where its entry fills, and a refusal says what they must be — when it is placed and when it is changed", async () => {
    const h = home();
    const { t } = await open(h);
    const why = async (o: Partial<OrderRequest>) => refusal(await t.place(order({ qty: 0.01, ...o }))).message;
    // a market buy fills at the ask (60,012): its take-profit must be above it
    expect(await why({ takeProfit: 59000 })).toBe("Paper account: the take-profit (59,000) must be above the entry (60,012) for a buy");
    // a buy limited at 70,000 crosses the ask and fills at 60,012: a stop-loss at 65,000 would sell at once
    expect(await why({ type: "limit", limitPrice: 70000, stopLoss: 65000 })).toBe("Paper account: the stop-loss (65,000) must be below the entry (60,012) for a buy: a buy limited at 70,000 crosses the book and fills there, at 60,012");
    // a sell limited at 50,000 fills at the bid (59,988): a stop-loss at 55,000 is under that fill
    expect(await why({ side: "sell", type: "limit", limitPrice: 50000, stopLoss: 55000 })).toBe("Paper account: the stop-loss (55,000) must be above the entry (59,988) for a sell: a sell limited at 50,000 crosses the book and fills there, at 59,988");
    // a sell's take-profit is under its limit, the worst fill for it
    expect(await why({ side: "sell", type: "limit", limitPrice: 60500, takeProfit: 61000 })).toBe("Paper account: the take-profit (61,000) must be below the entry (60,500) for a sell");
    expect(book(h).cashUsd).toBe(10000);
    // a crossing limit's take-profit is judged at its limit, its stop-loss at the fill
    expect(ok(await t.place(order({ qty: 0.01, type: "limit", limitPrice: 70000, takeProfit: 72000, stopLoss: 59000 }))).status).toBe("filled");
    // a resting bracketed entry changed in place: its exits are checked against the entry as changed
    const entry = ok(await t.place(order({ qty: 0.01, type: "limit", limitPrice: 59000, takeProfit: 60000, stopLoss: 58000 })));
    expect(entry.status).toBe("open");
    expect(refusal(await t.amend!(entry.ref, "BTC/USD", { limitPrice: 57000 }, order())).message).toBe("Paper account: the stop-loss (58,000) must be below the entry (57,000) for a buy");
    expect(refusal(await t.amend!(entry.ref, "BTC/USD", { limitPrice: 61000 }, order())).message).toBe("Paper account: the take-profit (60,000) must be above the entry (61,000) for a buy");
    expect(book(h).orders[entry.ref]).toMatchObject({ status: "open", limitPrice: 59000 });
    expect(ok(await t.amend!(entry.ref, "BTC/USD", { limitPrice: 58500 }, order())).status).toBe("open");
  });
});

describe("perpetuals with leverage: isolated margin, funding each hour, liquidation at the mark", () => {
  const leveraged = () => {
    const s = sources();
    const hl = source("hyperliquid", "Hyperliquid", "exchange", [row("BTC-PERP", "perp", "BTC", "USDC", 60005, { fundingRate: 0.0001, maxLeverage: 40 }), row("ETH-PERP", "perp", "ETH", "USDC", 2001)]);
    return { all: [s.coinbase, hl], hl };
  };

  it("the leverage set for a market bounds the margin put up (1x unless set, at most the source's); the position carries it and its liquidation price; a change with a position open moves margin to or from cash", async () => {
    const h = home();
    const { hl, all } = leveraged();
    const { t } = await open(h, "paper-1", { all });
    expect(ok(await t.market("BTC-PERP"))).toMatchObject({ maxLeverage: 40, marginModes: ["isolated"] });
    expect(refusal(await t.setLeverage!("BTC-PERP", 41)).code).toBe("E_VENUE_ORDER_INVALID");
    expect(refusal(await t.setLeverage!("BTC/USD", 2)).message).toContain("perpetual");
    expect(refusal(await t.setLeverage!("BTC-PERP", 2, "cross")).message).toContain("isolated margin");
    expect(ok(await t.setLeverage!("BTC-PERP", 10))).toMatchObject({ leverage: 10, marginMode: "isolated" });
    expect(book(h).leverage).toEqual({ "BTC-PERP": 10 });
    const opened = ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    expect(opened).toMatchObject({ status: "filled", avgPrice: 60017.001 });
    const p = book(h).positions["BTC-PERP"]!;
    expect(p).toMatchObject({ side: "long", qty: 0.1, entryPrice: 60017.001, marginUsd: 600.17001, leverage: 10, fundingUsd: 0, fundedAt: NOW });
    expect(book(h).cashUsd).toBeCloseTo(10000 - 600.17001 - 6.0017001, 6);
    const pos = ok(await t.positions!())[0]!;
    expect(pos).toMatchObject({ leverage: 10, marginMode: "isolated", markPrice: 60005 });
    expect(pos.liquidationPrice).toBeCloseTo((60017.001 * 0.1 - 600.17001) / (0.1 * (1 - 1 / 80)), 3);
    expect(liquidationPriceOf({ side: "long", qty: 1, entryPrice: 100, marginUsd: 100 }, 1)).toBeUndefined();
    // 20x on the open position: half the initial margin goes back to cash
    expect(ok(await t.setLeverage!("BTC-PERP", 20))).toMatchObject({ leverage: 20 });
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ marginUsd: 300.085005, leverage: 20 });
    expect(book(h).cashUsd).toBeCloseTo(10000 - 300.085005 - 6.0017001, 6);
    // back to 2x needs margin from cash; more than the cash there is refused
    expect(ok(await t.setLeverage!("BTC-PERP", 2))).toMatchObject({ leverage: 2 });
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ marginUsd: 3000.85005 });
    ok(await t.place(order({ symbol: "BTC-PERP", side: "sell", qty: 0.1, reduceOnly: true })));
    expect(book(h).positions).toEqual({});
    void hl;
  });

  it("funding: at each hour on the clock the position stands across — the top of the hour, as Hyperliquid pays it — its size times the oracle (else the mark, else the price) times the hour's rate, paid out of the margin by the long and received by the short; liquidation when the margin left falls to half the initial margin at the most leverage", async () => {
    const h = home();
    const { hl, all } = leveraged();
    const { t, source: src } = await open(h, "paper-1", { all });
    try {
      ok(await t.setLeverage!("BTC-PERP", 10));
      ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
      const cash = book(h).cashUsd;
      // two hours on the clock passed (28 min 20 s after the order, then an hour later): funding for two hours at 0.01% an hour on $6,000.50
      // (no oracle or mark said: the price)
      now = NOW + 2 * 3_600_000 + 60_000;
      const rows = await src.read();
      const margin = rows.find((b) => b.where?.startsWith("paper margin"))!;
      expect(margin.where).toBe("paper margin · long 0.1 BTC-PERP · 10x · −$1.20 unrealised · −$1.20 funding");
      expect(book(h).positions["BTC-PERP"]).toMatchObject({ marginUsd: 598.96991, fundingUsd: 1.2001, fundedAt: NEXT_HOUR + 3_600_000 });
      expect(book(h).funding).toEqual([hourPaid(0, 0.60005, { qty: 0.1, price: 60005, rate: 0.0001 }), hourPaid(1, 0.60005, { qty: 0.1, price: 60005, rate: 0.0001 })]);
      // the same hour again charges nothing
      await src.read();
      expect(book(h).positions["BTC-PERP"]!.fundingUsd).toBe(1.2001);
      expect(ok(await t.positions!())[0]!.native).toMatchObject({ fundingUsd: 1.2001, marginUsd: 598.96991, maxLeverage: 40 });
      // the mark falls: the margin left (598.97 − 501.70) is above the maintenance margin (5,500 / 80): the position stands
      reprice(hl, "BTC-PERP", 55000);
      await src.read();
      expect(book(h).positions["BTC-PERP"]).toBeDefined();
      // further: the margin left is gone, the position is liquidated at the mark, nothing comes back, the fill says so
      reprice(hl, "BTC-PERP", 54000);
      await src.read();
      expect(book(h).positions).toEqual({});
      expect(book(h).cashUsd).toBeCloseTo(cash, 6);
      const last = book(h).fills.at(-1)!;
      expect(last).toMatchObject({ symbol: "BTC-PERP", side: "sell", qty: 0.1, price: 54000 });
      expect(last.note).toContain("liquidated at the mark (54,000)");
      expect(Object.values(book(h).orders).at(-1)).toMatchObject({ status: "filled", reduceOnly: true, symbol: "BTC-PERP" });
      // a short at 1x (the market's most is 1x, so the maintenance margin is half the notional) is liquidated once the price has risen by a third
      const short = ok(await t.place(order({ symbol: "ETH-PERP", side: "sell", qty: 1 })));
      expect(short.status).toBe("filled");
      expect(ok(await t.positions!())[0]!.liquidationPrice).toBeCloseTo((2000.5998 * 2) / 1.5, 3);
      reprice(hl, "ETH-PERP", 2600);
      await src.read();
      expect(book(h).positions["ETH-PERP"]).toBeDefined();
      reprice(hl, "ETH-PERP", 2700);
      await src.read();
      expect(book(h).positions).toEqual({});
      // the margin and the fee went out when the short was opened; what was left of the margin at the mark (2000.5998 − 699.4002) came
      // back less the fee (0.10% of 2,700)
      expect(book(h).fills.at(-1)!.note).toContain("liquidated");
      expect(book(h).cashUsd).toBeCloseTo(cash - 2000.5998 - 2.0005998 + (2000.5998 - 699.4002 - 2.7), 3);
    } finally {
      now = NOW;
    }
  });
});

describe("event contracts settled by their venue", () => {
  it("a contract held is paid out at what its venue says it paid once the market settles — asked every ten minutes before the close, every minute after — and a market closed without a settlement is said to be waiting", async () => {
    const h = home();
    const s = sources();
    let state: { settled: false; closed?: boolean } | { settled: true; payout: number; at?: string } = { settled: false };
    const asked: string[] = [];
    s.kalshi.settlement = async (symbol) => {
      asked.push(symbol);
      return state;
    };
    const { t, source: src } = await open(h, "paper-1", { all: s.all });
    try {
      const bought = ok(await t.place(order({ symbol: "KXFED-25DEC-T4.00:YES", qty: 10 })));
      expect(bought).toMatchObject({ status: "filled", avgPrice: 0.63 });
      const cash = book(h).cashUsd;
      await src.read();
      expect(asked).toEqual(["KXFED-25DEC-T4.00:YES"]);
      // within ten minutes, not asked again
      now = NOW + 5 * 60_000;
      await src.read();
      expect(asked).toHaveLength(1);
      state = { settled: false, closed: true };
      now = NOW + 11 * 60_000;
      const rows = await src.read();
      expect(asked).toHaveLength(2);
      expect(rows.find((b) => b.class === "event")!.where).toContain("closed, waiting for its settlement");
      expect(book(h).markets["KXFED-25DEC-T4.00:YES"]!.closed).toBe(true);
      state = { settled: true, payout: 1, at: "2026-10-08T00:00:00.000Z" };
      now = NOW + 22 * 60_000;
      const after = await src.read();
      expect(after.find((b) => b.class === "event")).toBeUndefined();
      expect(book(h).cashUsd).toBeCloseTo(cash + 10, 6);
      expect(book(h).holdings).toEqual({});
      const fill = book(h).fills.at(-1)!;
      expect(fill).toMatchObject({ symbol: "KXFED-25DEC-T4.00:YES", side: "sell", qty: 10, price: 1, feeUsd: 0 });
      expect(fill.note).toContain("settled by Kalshi: $1.00 a contract to this side, which won");
      expect(fill.realizedUsd).toBeCloseTo(10 - 6.3063, 6);
      expect(book(h).markets["KXFED-25DEC-T4.00:YES"]!.settled).toEqual({ payout: 1, at: "2026-10-08T00:00:00.000Z" });
      // a source that says no settlements never settles here: the contract stays, marked at its price
      const ev = row("pm-x:Yes", "event", "Yes", "pUSD", 0.4, { bid: 0.39, ask: 0.41, group: { id: "0xabc", title: "X?" }, outcome: "Yes" });
      const pm = source("polymarket", "Polymarket", "events", [ev], { events: async () => [{ ...ev }] });
      const other = await open(h, "paper-2", { all: [...s.all, pm] });
      ok(await other.t.place(order({ symbol: "pm-x:Yes", qty: 5 })));
      now = NOW + 60 * 60_000;
      expect((await other.source.read()).find((b) => b.class === "event")).toMatchObject({ amount: 5, usd: 2 });
    } finally {
      now = NOW;
    }
  });
});

// ---- the engine judged while it waits on a quote; exits kept to their position; isolated margin; a market's own source; funding owed --

/** a source that answers each listing `ms` later, in the order it was asked: a test acts while the account waits on a quote (the owner's
 * cancel, an amend, a close) */
function slow(s: PublicSource, ms: number): void {
  const inner = s.listings.bind(s);
  s.listings = async (o) => {
    await new Promise((go) => setTimeout(go, ms));
    return inner(o);
  };
}
const legsOf = (st: OrderState): string[] => ((st.native as { legs?: Array<{ ref: string }> }).legs ?? []).map((l) => l.ref);
const HOUR_MS = 3_600_000;
/** the first hour on the clock after NOW (NOW is 31 min 40 s past an hour): funding is settled at the top of each hour, as Hyperliquid pays it */
const NEXT_HOUR = (Math.floor(NOW / HOUR_MS) + 1) * HOUR_MS;
/** one hour's funding as the book writes it down: a source without a history settles at the rate its quote carries (quoted) */
const hourPaid = (k: number, usd: number, o: { qty: number; price: number; rate: number; side?: "long" | "short" }) => ({ at: new Date(NEXT_HOUR + k * HOUR_MS).toISOString(), symbol: "BTC-PERP", usd, side: o.side ?? "long", qty: o.qty, price: o.price, rate: o.rate, quoted: true });

describe("an order judged while the account waits on its quote", () => {
  beforeEach(() => {
    now = NOW;
  });
  afterEach(() => {
    now = NOW;
  });

  it("a cancel the owner was told succeeded stands: the look that was waiting on the order's quote fills nothing", async () => {
    const h = home();
    const { t, source: src, s } = await open(h);
    const resting = ok(await t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    reprice(s.coinbase, "BTC/USD", 58000);
    slow(s.coinbase, 10);
    const look = src.settle!();
    // a turn, so the look is waiting on the order's quote when the owner cancels it
    await new Promise((go) => setTimeout(go, 0));
    expect(ok(await t.cancel(resting.ref, "BTC/USD")).status).toBe("canceled");
    await look;
    expect(book(h).orders[resting.ref]).toMatchObject({ status: "canceled", filledQty: 0 });
    expect([book(h).cashUsd, book(h).holdings, book(h).fills]).toEqual([10000, {}, []]);
  });

  it("an amend and a look on the same order fill it once; an amend that comes back to an order filled meanwhile changes nothing", async () => {
    // the amend first, the look while it waits: the look fills the order as amended, the amend's own judgement finds it filled
    {
      const h = home();
      const { t, source: src, s } = await open(h);
      const p1 = ok(await t.place(order({ type: "limit", limitPrice: 59000, qty: 0.05 })));
      reprice(s.coinbase, "BTC/USD", 58000);
      slow(s.coinbase, 10);
      const amended = t.amend!(p1.ref, "BTC/USD", { qty: 0.06 }, order());
      const look = src.settle!();
      const [a] = await Promise.all([amended, look]);
      expect(ok(a)).toMatchObject({ status: "filled", filledQty: 0.06, avgPrice: 59000 });
      expect(book(h).fills.filter((f) => f.ref === p1.ref)).toHaveLength(1);
      expect(book(h).holdings["BTC/USD"]!.qty).toBe(0.06);
      expect(book(h).cashUsd).toBeCloseTo(10000 - 0.06 * 59000 - 0.06 * 59000 * 0.001, 6);
    }
    // the look first: it fills the order as it stood; the amend, back from its quote, finds it filled and leaves it as it filled
    {
      const h = home();
      const { t, source: src, s } = await open(h);
      const p1 = ok(await t.place(order({ type: "limit", limitPrice: 59000, qty: 0.05 })));
      reprice(s.coinbase, "BTC/USD", 58000);
      slow(s.coinbase, 10);
      const look = src.settle!();
      // a turn, so the look has asked its quote before the amend asks its own
      await new Promise((go) => setTimeout(go, 0));
      const amended = t.amend!(p1.ref, "BTC/USD", { qty: 0.06 }, order());
      await look;
      expect(refusal(await amended).message).toContain(`order ${p1.ref} is filled: only an open order is changed`);
      expect(book(h).orders[p1.ref]).toMatchObject({ status: "filled", qty: 0.05, filledQty: 0.05 });
      expect(book(h).holdings["BTC/USD"]!.qty).toBe(0.05);
    }
  });

  it("an owner's close while the look waits on another position's quote is paid once: the look does not liquidate the position the close took off", async () => {
    const h = home();
    const s = sources();
    const hl = source("hyperliquid", "Hyperliquid", "exchange", [row("BTC-PERP", "perp", "BTC", "USDC", 60005, { maxLeverage: 40 }), row("ETH-PERP", "perp", "ETH", "USDC", 2001)]);
    const { t, source: src } = await open(h, "paper-1", { all: [s.coinbase, hl] });
    ok(await t.place(order({ symbol: "ETH-PERP", qty: 1 })));
    ok(await t.setLeverage!("BTC-PERP", 20));
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    // past its liquidation price (about 57,729)
    reprice(hl, "BTC-PERP", 57400);
    const cash = book(h).cashUsd;
    slow(hl, 10);
    const look = src.settle!();
    const closed = t.close!("BTC-PERP", 0.1, clientId());
    const [c] = await Promise.all([closed, look]);
    expect(ok(c)).toMatchObject({ status: "filled", avgPrice: 57388.52 });
    const back = 300.085005 + (57388.52 - 60017.001) * 0.1 - 5.738852;
    expect(book(h).cashUsd).toBeCloseTo(cash + back, 6);
    expect(book(h).fills.filter((f) => f.note?.includes("liquidated"))).toEqual([]);
    expect(Object.keys(book(h).positions)).toEqual(["ETH-PERP"]);
  });

  it("a position the owner adds to while the look waits on its quote is marked as it stands when the quote is back, at that moment: its liquidation comes after the add on the book", async () => {
    const h = home();
    const s = sources();
    const hl = source("hyperliquid", "Hyperliquid", "exchange", [row("BTC-PERP", "perp", "BTC", "USDC", 60005, { maxLeverage: 40 })]);
    const { t, source: src } = await open(h, "paper-1", { all: [s.coinbase, hl] });
    ok(await t.setLeverage!("BTC-PERP", 20));
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    // the look's quote is held until the test lets it go; the owner's own asks are answered at once
    const listings = hl.listings.bind(hl);
    let asked: () => void = () => undefined;
    const askedP = new Promise<void>((go) => (asked = go));
    let release: () => void = () => undefined;
    const held = new Promise<void>((go) => (release = go));
    let first = true;
    hl.listings = async (o) => {
      if (first) {
        first = false;
        asked();
        await held;
      }
      return listings(o);
    };
    reprice(hl, "BTC-PERP", 50000);
    now = NOW + 10_000;
    const look = src.settle!();
    await askedP;
    // while the look waits: the owner adds 0.1 at the ask (50,010)
    now = NOW + 20_000;
    const add = ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    expect(add).toMatchObject({ status: "filled", avgPrice: 50010 });
    now = NOW + 30_000;
    release();
    await look;
    // the position as it stands when the quote is back — 0.2 from 55,013.50 — liquidated then, after the add
    const liq = Object.values(book(h).orders).find((o) => o.clientId.startsWith("liquidation-"))!;
    expect(liq).toMatchObject({ qty: 0.2, filledAt: new Date(NOW + 30_000).toISOString() });
    expect(book(h).fills.map((f) => f.at)).toEqual([NOW, NOW + 20_000, NOW + 30_000].map((x) => new Date(x).toISOString()));
    // and the book's past, told again in time order, ends at the book's own cash
    expect(replayPaperBook(book(h)).cashUsd).toBeCloseTo(book(h).cashUsd, 6);
  });

  it("a day order whose session ends while its quote is asked ends with it: expired, never filled after its own end", async () => {
    now = fromEt(2026, 10, 14, 15, 50);
    try {
      const h = home();
      // a real-time US line (a fill at a delayed one is never taken: phase 3)
      const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock);
      const { t, source: src } = await open(h, "paper-1", { all: [us] });
      expect(ok(await t.place(order({ symbol: "NVDA", qty: 1 }))).status).toBe("filled");
      const stop = ok(await t.place(order({ symbol: "NVDA", side: "sell", type: "stop", stopPrice: 190, qty: 1, tif: "day" })));
      expect(book(h).orders[stop.ref]).toMatchObject({ status: "open", expiresAt: new Date(fromEt(2026, 10, 14, 16, 0)).toISOString() });
      // the look asks at 15:59:59; the quote is held until 16:00:01 and comes back stamped 15:59:59 at 185 — through the stop, but after the
      // order's own session ended
      const listings = us.listings.bind(us);
      let asked: () => void = () => undefined;
      const askedP = new Promise<void>((go) => (asked = go));
      let release: () => void = () => undefined;
      const held = new Promise<void>((go) => (release = go));
      let calls = 0;
      us.listings = async (q) => {
        if (++calls === 1) {
          asked();
          await held;
        }
        return listings(q);
      };
      now = fromEt(2026, 10, 14, 15, 59) + 59_000;
      const look = src.settle!();
      await askedP;
      now = fromEt(2026, 10, 14, 16, 0) + 1_000;
      us.stamp.set("NVDA", fromEt(2026, 10, 14, 15, 59) + 59_000);
      reprice(us, "NVDA", 185);
      release();
      await look;
      const o = book(h).orders[stop.ref]!;
      expect(o.status).toBe("expired");
      expect(o.filledAt).toBeUndefined();
      expect(o.filledQty).toBe(0);
      expect(book(h).holdings["NVDA"]).toMatchObject({ qty: 1 });
    } finally {
      now = NOW;
    }
  });

  it("an exit judged while the owner adds to its position is filled at the moment its quote is back: on the book after the add, never before it", async () => {
    const h = home();
    const s = sources();
    const hl = source("hyperliquid", "Hyperliquid", "exchange", [row("BTC-PERP", "perp", "BTC", "USDC", 60005, { maxLeverage: 40 })]);
    const { t, source: src } = await open(h, "paper-1", { all: [s.coinbase, hl] });
    ok(await t.setLeverage!("BTC-PERP", 20));
    // a long of 0.1 at the ask (60,017.001): its take-profit at 61,000 rests from birth
    const entry = ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1, takeProfit: 61000 })));
    const [tp] = legsOf(entry);
    // the look's second ask — the take-profit's quote, after the mark's — is held until the test lets it go; every other ask is answered
    // at once
    const listings = hl.listings.bind(hl);
    let asked: () => void = () => undefined;
    const askedP = new Promise<void>((go) => (asked = go));
    let release: () => void = () => undefined;
    const held = new Promise<void>((go) => (release = go));
    let calls = 0;
    hl.listings = async (o) => {
      if (++calls === 2) {
        asked();
        await held;
      }
      return listings(o);
    };
    reprice(hl, "BTC-PERP", 62000);
    now = NOW + 10_000;
    const look = src.settle!();
    await askedP;
    // while the take-profit's quote is asked: the owner adds 0.1 at the ask (62,012.40)
    now = NOW + 20_000;
    expect(ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })))).toMatchObject({ status: "filled", avgPrice: 62012.4 });
    now = NOW + 30_000;
    release();
    await look;
    // the take-profit fills at its limit when its quote is back — after the add, out of the position as it stands then
    expect(book(h).orders[tp!]).toMatchObject({ status: "filled", avgPrice: 61000, filledAt: new Date(NOW + 30_000).toISOString() });
    expect(book(h).fills.map((f) => f.at)).toEqual([NOW, NOW + 20_000, NOW + 30_000].map((x) => new Date(x).toISOString()));
    // and the book's past, told again in time order, ends at the book's own cash (the replay's counts the margin of the 0.1 still open)
    // and its own position: 0.1 left of 0.2 from 61,014.70
    const p = book(h).positions["BTC-PERP"]!;
    expect(p).toMatchObject({ side: "long", qty: 0.1, entryPrice: 61014.7005 });
    const end = replayPaperBook(book(h));
    expect(end.cashUsd).toBeCloseTo(book(h).cashUsd + p.marginUsd, 6);
    expect(end.positions).toEqual({ "BTC-PERP": { side: "long", qty: 0.1, entryPrice: 61014.7005 } });
  });

  it("an event contract sold and bought again while its settlement is asked: the answer pays nothing for the holding that is gone, and what is held now is paid at the next look", async () => {
    const h = home();
    const s = sources();
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((go) => (answer = go));
    let asked: () => void = () => undefined;
    const askedP = new Promise<void>((go) => (asked = go));
    s.kalshi.settlement = async () => {
      asked();
      await answered;
      return { settled: true, payout: 1, at: "2026-10-08T00:00:00.000Z" };
    };
    const { t, source: src } = await open(h, "paper-1", { all: s.all });
    ok(await t.place(order({ symbol: "KXFED-25DEC-T4.00:YES", qty: 10 })));
    const look = src.settle!();
    await askedP;
    // while the venue is asked: the ten sold, five bought again
    ok(await t.place(order({ symbol: "KXFED-25DEC-T4.00:YES", side: "sell", qty: 10 })));
    ok(await t.place(order({ symbol: "KXFED-25DEC-T4.00:YES", qty: 5 })));
    const cash = book(h).cashUsd;
    answer();
    await look;
    // the answer was about a holding that is gone: nothing paid, nothing taken off; the five are asked about, and paid, at the next look
    expect(book(h).holdings["KXFED-25DEC-T4.00:YES"]).toMatchObject({ qty: 5 });
    expect(book(h).cashUsd).toBeCloseTo(cash, 6);
    now += 10_000;
    await src.read();
    expect(book(h).holdings).toEqual({});
    expect(book(h).cashUsd).toBeCloseTo(cash + 5, 6);
    expect(book(h).fills.filter((f) => f.note?.startsWith("settled by Kalshi")).map((f) => f.qty)).toEqual([5]);
  });
});

describe("isolated margin: a perpetual's own margin, and nothing more, is lost", () => {
  const leveraged = () => {
    const s = sources();
    const hl = source("hyperliquid", "Hyperliquid", "exchange", [row("BTC-PERP", "perp", "BTC", "USDC", 60005, { maxLeverage: 40 })]);
    return { all: [s.coinbase, hl], hl };
  };
  beforeEach(() => {
    now = NOW;
  });
  afterEach(() => {
    now = NOW;
  });

  it("a gap past the liquidation price is a liquidation, whatever stop-loss stood below it: nothing comes back and nothing more is taken", async () => {
    const h = home();
    const { hl, all } = leveraged();
    const { t, source: src } = await open(h, "paper-1", { all });
    ok(await t.setLeverage!("BTC-PERP", 20));
    const entry = ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1, stopLoss: 57000 })));
    const [sl] = legsOf(entry);
    const cash = book(h).cashUsd;
    reprice(hl, "BTC-PERP", 50000);
    now += 10_000;
    await src.settle!();
    expect(book(h).positions).toEqual({});
    expect(book(h).cashUsd).toBeCloseTo(cash, 6);
    expect(book(h).orders[sl!]).toMatchObject({ status: "canceled" });
    expect(book(h).orders[sl!]!.note).toContain("liquidated");
    const liq = Object.values(book(h).orders).find((o) => o.clientId.startsWith("liquidation-"))!;
    // the margin left (300.085005 − 1,001.7001) less the fee (5): what isolated margin did not take, written on the order
    expect(liq.lossPastMarginUsd).toBeCloseTo(1001.7001 - 300.085005 + 5, 6);
  });

  it("an owner's close after a gap, before the look liquidates, gives back nothing and takes nothing from the cash", async () => {
    const h = home();
    const { hl, all } = leveraged();
    const { t } = await open(h, "paper-1", { all });
    ok(await t.setLeverage!("BTC-PERP", 20));
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    const cash = book(h).cashUsd;
    reprice(hl, "BTC-PERP", 50000);
    const closed = ok(await t.close!("BTC-PERP", 0.1, clientId()));
    expect(closed).toMatchObject({ status: "filled", avgPrice: 49990 });
    expect(book(h).cashUsd).toBeCloseTo(cash, 6);
    expect(book(h).positions).toEqual({});
    const o = book(h).orders[closed.ref]!;
    // realised (49,990 − 60,017.001) × 0.1 = −1,002.7001, the margin 300.085005, the fee 4.999
    expect(o.lossPastMarginUsd).toBeCloseTo(1002.7001 - 300.085005 + 4.999, 6);
    expect(book(h).fills.at(-1)!.note).toContain("isolated margin");
  });

  it("a part closed after a gap takes the rest of its loss out of the margin of what is left: the next look liquidates the remainder, and the whole margin, no more, is lost", async () => {
    const h = home();
    const { hl, all } = leveraged();
    const { t, source: src } = await open(h, "paper-1", { all });
    ok(await t.setLeverage!("BTC-PERP", 20));
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    const cash = book(h).cashUsd;
    expect(cash).toBeCloseTo(10000 - 300.085005 - 6.0017001, 6);
    reprice(hl, "BTC-PERP", 50000);
    const half = ok(await t.close!("BTC-PERP", 0.05, clientId()));
    expect(half).toMatchObject({ status: "filled", avgPrice: 49990 });
    // its share of the margin (150.04) against a loss of 501.35 and a fee of 2.50: the margin of the half left (150.04) takes what it
    // can, and only the 203.76 past both is lost to isolated margin
    expect(book(h).cashUsd).toBeCloseTo(cash, 6);
    expect(book(h).positions["BTC-PERP"]!.qty).toBe(0.05);
    expect(book(h).positions["BTC-PERP"]!.marginUsd).toBeCloseTo(0, 6);
    const o = book(h).orders[half.ref]!;
    expect(o.lossPastMarginUsd).toBeCloseTo(501.35005 + 2.4995 - 300.085005, 5);
    expect(o.note).toContain("taken from the margin of what is left");
    // the price comes back before the look: the remainder's margin is gone, so it is liquidated, and nothing more is taken
    reprice(hl, "BTC-PERP", 60005);
    now += 10_000;
    await src.settle!();
    expect(book(h).positions).toEqual({});
    expect(book(h).fills.at(-1)!.note).toContain("liquidated at the mark (60,005)");
    expect(book(h).cashUsd).toBeCloseTo(10000 - 300.085005 - 6.0017001, 6);
  });

  it("a part closed past its share of the margin and past all of it says how far past the share, what the rest of the margin took, and what went past all of it", async () => {
    const h = home();
    const { hl, all } = leveraged();
    const { t } = await open(h, "paper-1", { all });
    ok(await t.setLeverage!("BTC-PERP", 20));
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    reprice(hl, "BTC-PERP", 40000);
    const half = ok(await t.close!("BTC-PERP", 0.05, clientId()));
    expect(half).toMatchObject({ status: "filled", avgPrice: 39992 });
    // its share of the margin (150.04) against a loss of 1,001.25 and a fee of 2.00: 853.21 past the share — 150.04 of it the margin of the
    // half left, and 703.16 past all of it
    const o = book(h).orders[half.ref]!;
    expect(o.lossPastMarginUsd).toBeCloseTo(1001.25005 + 1.9996 - 300.085005, 5);
    expect(o.note).toBe("isolated margin: the loss went $853.21 past this part's share of the margin: $150.04 of it taken from the margin of what is left, and $703.16 past all of it — only the margin was lost");
    expect(book(h).fills.at(-1)!.note).toBe(o.note);
  });

  it("a liquidation the margin covered says so — nothing past the margin, 0 — and the book's past replays it with nothing to say about it", async () => {
    const h = home();
    const { hl, all } = leveraged();
    const { t, source: src } = await open(h, "paper-1", { all });
    ok(await t.setLeverage!("BTC-PERP", 10));
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    const cash = book(h).cashUsd;
    // marked 54,600: 541.70 lost of 600.17 of margin, 58.47 left — under the maintenance margin (5,460 / 80 = 68.25), over the fee (5.46)
    reprice(hl, "BTC-PERP", 54600);
    now += 10_000;
    await src.settle!();
    expect(book(h).positions).toEqual({});
    const liq = Object.values(book(h).orders).find((o) => o.clientId.startsWith("liquidation-"))!;
    expect(liq.lossPastMarginUsd).toBe(0);
    expect(book(h).cashUsd).toBeCloseTo(cash + 600.17001 - 541.7001 - 5.46, 6);
    // the book's past: a liquidation that says it is replayed exactly, and nothing is said of it
    expect(replayPaperBook(book(h)).cashUsd).toBeCloseTo(book(h).cashUsd, 6);
    expect(rebuildEquity(book(h), [], { fromMs: NOW, toMs: now, stepMs: HOUR_MS }).inexact.filter((x) => x.includes("liquidated"))).toEqual([]);
  });
});

describe("a limit fills at its own price only once it has rested", () => {
  beforeEach(() => {
    now = NOW;
  });
  afterEach(() => {
    now = NOW;
  });

  it("a bracket's take-profit placed already past the quote (the entry filled at the open after a gap) takes the quote, not its limit", async () => {
    now = fromEt(2026, 10, 7, 17, 0);
    const h = home();
    const us = stamped("us-test", [row("AAPL", "stock", "AAPL", "USD", 200)], usClock);
    const { t } = await open(h, "paper-1", { all: [us] });
    const entry = ok(await t.place(order({ symbol: "AAPL", qty: 10, takeProfit: 210, stopLoss: 190 })));
    expect(entry.status).toBe("open");
    now = fromEt(2026, 10, 8, 9, 50);
    reprice(us, "AAPL", 230);
    const filled = ok(await t.status(entry.ref, "AAPL"));
    expect(filled).toMatchObject({ status: "filled", avgPrice: 230.046 });
    const [tp, sl] = legsOf(filled);
    now += 10_000;
    await t.status(entry.ref, "AAPL");
    expect(book(h).orders[tp!]).toMatchObject({ status: "filled", avgPrice: 229.954 });
    expect(book(h).orders[sl!]).toMatchObject({ status: "canceled" });
  });

  it("an amend that moves a resting limit past the quote fills at the quote, as a limit placed there does; one moved short of it rests and fills at its limit", async () => {
    const h = home();
    const { t, s } = await open(h);
    const p = ok(await t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    expect(ok(await t.amend!(p.ref, "BTC/USD", { limitPrice: 65000 }, order()))).toMatchObject({ status: "filled", avgPrice: 60012 });
    const q = ok(await t.place(order({ type: "limit", limitPrice: 58000, qty: 0.01 })));
    expect(ok(await t.amend!(q.ref, "BTC/USD", { limitPrice: 59500 }, order())).status).toBe("open");
    reprice(s.coinbase, "BTC/USD", 59000);
    now += 10_000;
    expect(ok(await t.status(q.ref, "BTC/USD"))).toMatchObject({ status: "filled", avgPrice: 59500 });
  });

  it("a limit that rested rests no more once its market is out of session: at the next open, already past the quote, it takes the quote", async () => {
    now = fromEt(2026, 10, 7, 11, 0);
    const h = home();
    const us = stamped("us-test", [row("AAPL", "stock", "AAPL", "USD", 350)], usClock);
    const { t } = await open(h, "paper-1", { all: [us] });
    const p = ok(await t.place(order({ symbol: "AAPL", type: "limit", limitPrice: 345, qty: 1 })));
    expect(book(h).orders[p.ref]!.rested).toBe(true);
    now = fromEt(2026, 10, 7, 16, 20);
    expect(ok(await t.status(p.ref, "AAPL")).status).toBe("open");
    expect(book(h).orders[p.ref]!.rested).toBeUndefined();
    now = fromEt(2026, 10, 8, 9, 50);
    reprice(us, "AAPL", 330);
    expect(ok(await t.status(p.ref, "AAPL"))).toMatchObject({ status: "filled", avgPrice: 330.066 });
  });

  it("a bracket's take-profit beyond its entry's fill rests from birth: a quote that passes through it before the next look fills it at its limit", async () => {
    const h = home();
    const { t, source: src, s } = await open(h);
    // a buy filled at the ask (60,012): its take-profit at 61,000 sells at the bid, which is under the fill
    const buy = ok(await t.place(order({ qty: 0.1, takeProfit: 61000 })));
    expect(buy).toMatchObject({ status: "filled", avgPrice: 60012 });
    const [tp] = legsOf(buy);
    expect(book(h).orders[tp!]!.rested).toBe(true);
    // a coin never closes: its rest is tied to no session
    expect(book(h).orders[tp!]!.restedTill).toBeUndefined();
    reprice(s.coinbase, "BTC/USD", 62000);
    now += 10_000;
    await src.settle!();
    expect(book(h).orders[tp!]).toMatchObject({ status: "filled", avgPrice: 61000 });
    // a sell's the other way: filled at the bid (59,988), its take-profit at 59,000 buys back at its limit
    reprice(s.coinbase, "BTC/USD", 60000);
    ok(await t.place(order({ qty: 0.1 })));
    const sell = ok(await t.place(order({ side: "sell", qty: 0.1, takeProfit: 59000 })));
    expect(sell).toMatchObject({ status: "filled", avgPrice: 59988 });
    const [back] = legsOf(sell);
    expect(book(h).orders[back!]!.rested).toBe(true);
    reprice(s.coinbase, "BTC/USD", 58000);
    now += 10_000;
    await src.settle!();
    expect(book(h).orders[back!]).toMatchObject({ status: "filled", side: "buy", avgPrice: 59000 });
  });

  it("a limit that rested stays rested while its market is in session and only its quote stopped moving: a fresh quote past it fills it at its limit", async () => {
    now = fromEt(2026, 10, 14, 11, 0);
    const h = home();
    const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock);
    const { t } = await open(h, "paper-1", { all: [us] });
    const p = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 195, qty: 1 })));
    expect(book(h).orders[p.ref]!.rested).toBe(true);
    // the quote stamped 11:00 and looked at 11:20: past its delay and the grace, it fills nothing — but the market is in its session
    us.stamp.set("NVDA", fromEt(2026, 10, 14, 11, 0));
    now = fromEt(2026, 10, 14, 11, 20);
    expect(ok(await t.status(p.ref, "NVDA")).status).toBe("open");
    expect(book(h).orders[p.ref]!.rested).toBe(true);
    us.stamp.delete("NVDA");
    now = fromEt(2026, 10, 14, 11, 21);
    reprice(us, "NVDA", 190);
    expect(ok(await t.status(p.ref, "NVDA"))).toMatchObject({ status: "filled", avgPrice: 195 });
  });

  it("A RESTING LIMIT IS JUDGED ONLY AT A REAL-TIME QUOTE UNDER 60 S OLD (phase 3): a quote through it stamped seventy seconds ago fills nothing; one stamped now fills it at its limit — and a stop is not triggered by a stale one either", async () => {
    expect(STOCK_JUDGE_MS).toBe(60_000);
    now = fromEt(2026, 10, 14, 11, 0);
    const h = home();
    const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock);
    const { t } = await open(h, "paper-1", { all: [us] });
    ok(await t.place(order({ symbol: "NVDA", qty: 2 })));
    const p = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 195, qty: 1 })));
    const stop = ok(await t.place(order({ symbol: "NVDA", side: "sell", type: "stop", stopPrice: 196, qty: 2, tif: "gtc" })));
    expect(book(h).orders[p.ref]!.rested).toBe(true);
    // 11:02: through both, but stamped 11:00:50 — seventy seconds old
    now = fromEt(2026, 10, 14, 11, 2);
    us.stamp.set("NVDA", now - 70_000);
    reprice(us, "NVDA", 190);
    expect(ok(await t.status(p.ref, "NVDA")).status).toBe("open");
    expect(ok(await t.status(stop.ref, "NVDA")).status).toBe("open");
    expect(book(h).orders[stop.ref]!.triggeredAt).toBeUndefined();
    // stamped thirty seconds ago: the limit at its own price, the stop at the bid
    us.stamp.set("NVDA", now - 30_000);
    expect(ok(await t.status(p.ref, "NVDA"))).toMatchObject({ status: "filled", avgPrice: 195 });
    expect(ok(await t.status(stop.ref, "NVDA"))).toMatchObject({ status: "filled", avgPrice: 189.962 });
    // a market order placed now takes a real-time quote as old as the US line takes one (two minutes): stamped ninety seconds ago, it fills
    us.stamp.set("NVDA", now - 90_000);
    expect(ok(await t.place(order({ symbol: "NVDA", qty: 1 })))).toMatchObject({ status: "filled", avgPrice: 190.038 });
  });

  it("a stock's rest is the session's it rested in: with no look that answered between the close and the next open, a quote past its limit at the open takes the quote", async () => {
    const wednesdayClose = new Date(fromEt(2026, 10, 14, 16, 0)).toISOString();
    // no look at all overnight (the Mac asleep): a buy limited at 195 rests on Wednesday at 11:00 at a price of 200, and the next look is
    // Thursday 10:00 at 185 — a gap through its limit while the market was closed
    {
      now = fromEt(2026, 10, 14, 11, 0);
      const h = home();
      const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock);
      const { t } = await open(h, "paper-1", { all: [us] });
      const p = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 195, qty: 1, tif: "gtc" })));
      expect(book(h).orders[p.ref]).toMatchObject({ rested: true, restedTill: wednesdayClose });
      now = fromEt(2026, 10, 15, 10, 0);
      reprice(us, "NVDA", 185);
      const filled = ok(await t.status(p.ref, "NVDA"));
      expect(filled.status).toBe("filled");
      expect(filled.avgPrice).toBeCloseTo(185.037, 6);
    }
    // looks overnight, but the source silent out of hours: they find no quote, and the rest is still Wednesday's at Thursday's open
    {
      now = fromEt(2026, 10, 14, 11, 0);
      const h = home();
      const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock);
      const { t } = await open(h, "paper-1", { all: [us] });
      const p = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 195, qty: 1, tif: "gtc" })));
      const listings = us.listings;
      us.listings = async () => {
        throw new Error("not answering");
      };
      for (const at of [fromEt(2026, 10, 14, 18, 0), fromEt(2026, 10, 15, 2, 0)]) {
        now = at;
        expect(ok(await t.status(p.ref, "NVDA")).status).toBe("open");
      }
      us.listings = listings;
      now = fromEt(2026, 10, 15, 10, 0);
      reprice(us, "NVDA", 185);
      const filled = ok(await t.status(p.ref, "NVDA"));
      expect(filled.status).toBe("filled");
      expect(filled.avgPrice).toBeCloseTo(185.037, 6);
    }
  });

  it("A DELAYED QUOTE NEVER FILLS A RESTING LIMIT (phase 3): placed on Cboe's quote alone it waits unjudged, Cboe's quote through it fills nothing, and the first real-time quote judges it — a limit it crosses at once takes that quote", async () => {
    now = fromEt(2026, 10, 14, 11, 0);
    const h = home();
    const line = { delayMs: 15 * 60_000 };
    const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock, line);
    us.stamp.set("NVDA", fromEt(2026, 10, 14, 10, 45));
    const { t } = await open(h, "paper-1", { all: [us] });
    const p = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 195, qty: 1, tif: "gtc" })));
    expect(book(h).orders[p.ref]).toMatchObject({ status: "open", note: "waiting for a fresh price: judged at the next one" });
    expect(book(h).orders[p.ref]!.rested).toBeUndefined();
    // 11:30: Cboe's quote — the market's 11:15 — comes through the limit: nothing filled, and it has not rested on it either
    now = fromEt(2026, 10, 14, 11, 30);
    us.stamp.set("NVDA", fromEt(2026, 10, 14, 11, 15));
    reprice(us, "NVDA", 190);
    expect(ok(await t.status(p.ref, "NVDA")).status).toBe("open");
    expect(book(h).orders[p.ref]!.rested).toBeUndefined();
    // 11:31: a real-time quote answers, through the limit: it never rested, so it takes the quote (the ask, 190.038), as a limit placed there does
    line.delayMs = 0;
    us.stamp.delete("NVDA");
    now = fromEt(2026, 10, 14, 11, 31);
    const filled = ok(await t.status(p.ref, "NVDA"));
    expect(filled.status).toBe("filled");
    expect(filled.avgPrice).toBeCloseTo(190.038, 6);
  });

  it("a rest earned on a real-time quote is the session's it rested in; a quote fifteen minutes behind that answers after the close fills nothing, and at the next open a real-time quote past its limit takes the quote", async () => {
    now = fromEt(2026, 10, 14, 15, 50);
    const h = home();
    // the US line as it is: a real-time quote where one answers, Cboe's fifteen-minute delayed one when it does not
    const line = { delayMs: 0 };
    const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock, line);
    const { t } = await open(h, "paper-1", { all: [us] });
    const p = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 195, qty: 1, tif: "gtc" })));
    expect(book(h).orders[p.ref]).toMatchObject({ rested: true, restedTill: new Date(fromEt(2026, 10, 14, 16, 0)).toISOString() });
    // 16:05: only Cboe's answers, stamped 15:52 and fifteen minutes behind, through the limit: no fill at a delayed quote
    line.delayMs = 15 * 60_000;
    us.stamp.set("NVDA", fromEt(2026, 10, 14, 15, 52));
    now = fromEt(2026, 10, 14, 16, 5);
    reprice(us, "NVDA", 190);
    expect(ok(await t.status(p.ref, "NVDA")).status).toBe("open");
    // Thursday 09:31, real time again, through the limit: the rest was Wednesday's — it takes the quote (190.038)
    line.delayMs = 0;
    us.stamp.delete("NVDA");
    now = fromEt(2026, 10, 15, 9, 31);
    const filled = ok(await t.status(p.ref, "NVDA"));
    expect(filled.status).toBe("filled");
    expect(filled.avgPrice).toBeCloseTo(190.038, 6);
  });

  it("a stock bracket's take-profit that rested from birth is its entry's session's: after a gap up overnight it takes the opening quote, not its limit", async () => {
    now = fromEt(2026, 10, 14, 11, 0);
    const h = home();
    const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock);
    const { t } = await open(h, "paper-1", { all: [us] });
    const entry = ok(await t.place(order({ symbol: "NVDA", qty: 1, takeProfit: 210 })));
    expect(entry).toMatchObject({ status: "filled", avgPrice: 200.04 });
    const [tp] = legsOf(entry);
    expect(book(h).orders[tp!]).toMatchObject({ rested: true, restedTill: new Date(fromEt(2026, 10, 14, 16, 0)).toISOString() });
    now = fromEt(2026, 10, 15, 10, 0);
    reprice(us, "NVDA", 230);
    await t.status(entry.ref, "NVDA");
    expect(book(h).orders[tp!]!.status).toBe("filled");
    expect(book(h).orders[tp!]!.avgPrice).toBeCloseTo(229.954, 6);
  });
});

describe("a bracket's exits are kept to their position", () => {
  beforeEach(() => {
    now = NOW;
  });
  afterEach(() => {
    now = NOW;
  });

  it("a perpetual closed by hand takes its stop-loss and its reduce-only orders with it: they never close the next position opened", async () => {
    const h = home();
    const { t, source: src, s } = await open(h);
    const entry = ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1, stopLoss: 50000 })));
    const [sl] = legsOf(entry);
    const tp = ok(await t.place(order({ symbol: "BTC-PERP", side: "sell", type: "limit", limitPrice: 70000, qty: 0.1, reduceOnly: true })));
    const closed = ok(await t.close!("BTC-PERP", 0.1, clientId()));
    expect(book(h).orders[sl!]).toMatchObject({ status: "canceled", note: `canceled: the position it was to close is closed (${closed.ref})` });
    expect(book(h).orders[tp.ref]).toMatchObject({ status: "canceled" });
    // a new long, then the price falls through the old stop-loss and rises through the old take-profit: the new long stands
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    reprice(s.hl, "BTC-PERP", 49000);
    now += 10_000;
    await src.settle!();
    reprice(s.hl, "BTC-PERP", 71000);
    now += 10_000;
    await src.settle!();
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ side: "long", qty: 0.1 });
  });

  it("a perpetual reduced by hand: the exit that is hit closes what is left, and the other is canceled with it", async () => {
    const h = home();
    const { t, source: src, s } = await open(h);
    const entry = ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1, takeProfit: 61000, stopLoss: 59000 })));
    const [tp, sl] = legsOf(entry);
    ok(await t.close!("BTC-PERP", 0.05, clientId()));
    expect(book(h).orders[tp!]).toMatchObject({ status: "open", qty: 0.1 });
    reprice(s.hl, "BTC-PERP", 61500);
    now += 10_000;
    await src.settle!();
    // the take-profit was placed above the entry's fill: it rested from birth, so it fills at its own price
    expect(book(h).orders[tp!]).toMatchObject({ status: "filled", qty: 0.05, filledQty: 0.05, avgPrice: 61000 });
    expect(book(h).orders[sl!]).toMatchObject({ status: "canceled" });
    expect(book(h).positions).toEqual({});
  });

  it("a perpetual entry with exits that reduces the other side places none: it opened nothing for them to close", async () => {
    const h = home();
    const { t } = await open(h);
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    const sell = ok(await t.place(order({ symbol: "BTC-PERP", side: "sell", qty: 0.05, takeProfit: 55000, stopLoss: 65000 })));
    expect(sell.status).toBe("filled");
    expect(legsOf(sell)).toEqual([]);
    expect((sell.native as { note?: string }).note).toContain("its exits were not placed");
    expect(Object.values(book(h).orders).filter((o) => o.parent)).toEqual([]);
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ side: "long", qty: 0.05 });
  });

  it("a holding: part sold by hand, the exit hit sells what is left; all sold by hand, its exits go with it", async () => {
    const h = home();
    const { t, source: src, s } = await open(h);
    const entry = ok(await t.place(order({ qty: 0.1, takeProfit: 66000, stopLoss: 57000 })));
    const [tp, sl] = legsOf(entry);
    ok(await t.place(order({ side: "sell", qty: 0.05 })));
    reprice(s.coinbase, "BTC/USD", 67000);
    now += 10_000;
    await src.settle!();
    expect(book(h).orders[tp!]).toMatchObject({ status: "filled", qty: 0.05, filledQty: 0.05 });
    expect(book(h).orders[sl!]).toMatchObject({ status: "canceled" });
    expect(book(h).holdings).toEqual({});
    const again = ok(await t.place(order({ qty: 0.1, stopLoss: 60000 })));
    const [sl2] = legsOf(again);
    const sold = ok(await t.place(order({ side: "sell", qty: 0.1 })));
    expect(book(h).orders[sl2!]).toMatchObject({ status: "canceled", note: `canceled: what it was to sell is sold (${sold.ref})` });
    ok(await t.place(order({ qty: 0.1 })));
    reprice(s.coinbase, "BTC/USD", 59000);
    now += 10_000;
    await src.settle!();
    expect(book(h).holdings["BTC/USD"]).toMatchObject({ qty: 0.1 });
  });
});

describe("a market is priced by its own source, and judged only while it takes orders", () => {
  afterEach(() => {
    now = NOW;
  });

  it("a share whose stocks line does not answer is not priced, nor filled, at the Stock Token of the same symbol", async () => {
    now = fromEt(2026, 10, 9, 17, 0);
    const h = home();
    const s = sources();
    const cboe = cboeLike([row("NVDA", "stock", "NVDA", "USD", 190)]);
    const { t, source: src } = await open(h, "paper-1", { all: [cboe, s.tokens] });
    const queued = ok(await t.place(order({ symbol: "NVDA", qty: 10 })));
    expect(queued.status).toBe("open");
    expect(book(h).markets["NVDA"]).toMatchObject({ source: "cboe", kind: "stock" });
    // Saturday: the US stocks line does not answer; Robinhood's token NVDA does
    now = fromEt(2026, 10, 10, 12, 0);
    cboe.listings = async () => {
      throw new Error("not answering");
    };
    expect(ok(await t.status(queued.ref, "NVDA")).status).toBe("open");
    expect(book(h).markets["NVDA"]).toMatchObject({ source: "cboe", kind: "stock" });
    expect(refusal(await t.market("NVDA")).code).toBe("E_VENUE_REJECTED");
    expect(cashOf(await src.read())).toBe(10000);
  });

  it("a symbol two sources name is the market of the one first in the account's order, whichever answered last: a share slow to answer once takes its symbol back, and the Stock Token never takes it again", async () => {
    now = fromEt(2026, 10, 9, 11, 0);
    const h = home();
    const s = sources();
    const cboe = cboeLike([row("NVDA", "stock", "NVDA", "USD", 190)]);
    const listings = cboe.listings.bind(cboe);
    let down = true;
    cboe.listings = async (q) => {
      if (down) throw new Error("not answering yet");
      return listings(q);
    };
    // Robinhood's Stock Tokens name their NVDA "NVDA" too
    const tokens = source("robinhood-stock-tokens", "Robinhood Stock Tokens", "tokens", [row("NVDA", "token", "NVDA", "USD", 191)]);
    const { t } = await open(h, "paper-1", { all: [cboe, s.coinbase, tokens] });
    // at startup the share's line is slow: the token is all that names NVDA, so for now NVDA is the token
    expect(ok(await t.markets("NVDA")).find((m) => m.symbol === "NVDA")?.kind).toBe("token");
    // the share's line answers: it is first in the account's order, so NVDA is the share from now on
    down = false;
    expect(ok(await t.markets("NVDA")).find((m) => m.symbol === "NVDA")?.kind).toBe("stock");
    expect(ok(await t.market("NVDA")).kind).toBe("stock");
    // the share's line misses one answer: the token lists NVDA again, but does not take it back
    down = true;
    expect(ok(await t.markets("NVDA")).find((m) => m.symbol === "NVDA")?.kind).toBe("token");
    down = false;
    expect(ok(await t.market("NVDA")).kind).toBe("stock");
    now = NOW;
  });

  it("a coin pair whose venue does not answer is not judged at another venue's pair of the same symbol", async () => {
    const h = home();
    const { t, s } = await open(h);
    ok(await t.place(order({ qty: 0.1 })));
    // Coinbase's BTC/USD: its bid (59,988) short of the limit; Kraken's (60,087.98) past it
    const p = ok(await t.place(order({ side: "sell", type: "limit", limitPrice: 60080, qty: 0.1 })));
    expect(p.status).toBe("open");
    s.coinbase.listings = async () => {
      throw new Error("not answering");
    };
    now += 10_000;
    expect(ok(await t.status(p.ref, "BTC/USD")).status).toBe("open");
    expect(refusal(await t.market("BTC/USD")).code).toBe("E_VENUE_REJECTED");
    expect(book(h).markets["BTC/USD"]!.source).toBe("coinbase");
  });

  it("a resting order does not fill while its market's source says it takes no orders (a halted token), and does once it does again", async () => {
    const h = home();
    const { t, s } = await open(h);
    const p = ok(await t.place(order({ symbol: "NVDA", type: "limit", limitPrice: 179, qty: 1 })));
    expect(p.status).toBe("open");
    Object.assign(s.tokens.rows[0]!, { open: false, note: "Robinhood has halted trading in it", price: 178.5, bid: 178.4, ask: 178.6 });
    now += 10_000;
    expect(ok(await t.status(p.ref, "NVDA")).status).toBe("open");
    expect(ok(await t.market("NVDA")).open).toBe(false);
    Object.assign(s.tokens.rows[0]!, { open: true, note: undefined });
    now += 10_000;
    // back from the halt already past its limit: it takes the quote
    expect(ok(await t.status(p.ref, "NVDA"))).toMatchObject({ status: "filled", avgPrice: 178.6 });
  });
});

describe("funding owed is never dropped", () => {
  const leveraged = () => {
    const s = sources();
    const hl = source("hyperliquid", "Hyperliquid", "exchange", [row("BTC-PERP", "perp", "BTC", "USDC", 60005, { fundingRate: 0.0001, maxLeverage: 40 })]);
    return { all: [s.coinbase, hl], hl };
  };
  afterEach(() => {
    now = NOW;
  });

  it("the hours a position stood while its source did not answer are settled at the next look that has a quote", async () => {
    const h = home();
    const { hl, all } = leveraged();
    const { t, source: src } = await open(h, "paper-1", { all });
    ok(await t.setLeverage!("BTC-PERP", 10));
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 1 })));
    const listings = hl.listings;
    hl.listings = async () => {
      throw new Error("not answering");
    };
    now = NOW + 10 * HOUR_MS + 60_000;
    await src.read();
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ fundingUsd: 0, fundedAt: NOW });
    hl.listings = listings;
    await src.read();
    // ten hours on the clock at 0.01% an hour on $60,005
    expect(book(h).positions["BTC-PERP"]!.fundingUsd).toBeCloseTo(60.005, 6);
    expect(book(h).positions["BTC-PERP"]!.fundedAt).toBe(NEXT_HOUR + 9 * HOUR_MS);
    expect(book(h).funding).toHaveLength(10);
  });

  it("a close in the look that follows hours away pays the funding of those hours first", async () => {
    const h = home();
    const { hl, all } = leveraged();
    const { t, source: src } = await open(h, "paper-1", { all });
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1, takeProfit: 61000 })));
    now = NOW + 3 * HOUR_MS + 60_000;
    reprice(hl, "BTC-PERP", 62000);
    await src.settle!();
    expect(book(h).positions).toEqual({});
    // three hours on the clock at 0.01% an hour on $6,200, each written down as it was settled
    expect(book(h).funding).toEqual([0, 1, 2].map((k) => hourPaid(k, 0.62, { qty: 0.1, price: 62000, rate: 0.0001 })));
  });

  it("a close by hand after hours the look could not settle (its source silent) pays those hours before it takes the position off", async () => {
    const h = home();
    const { hl, all } = leveraged();
    const { t, source: src } = await open(h, "paper-1", { all });
    ok(await t.setLeverage!("BTC-PERP", 10));
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 1 })));
    const cash = book(h).cashUsd;
    const listings = hl.listings;
    hl.listings = async () => {
      throw new Error("not answering");
    };
    now = NOW + 10 * HOUR_MS + 60_000;
    await src.read();
    expect(book(h).funding).toEqual([]);
    hl.listings = listings;
    const closed = ok(await t.close!("BTC-PERP", 1, clientId()));
    expect(closed).toMatchObject({ status: "filled", avgPrice: 59992.999 });
    expect(book(h).positions).toEqual({});
    // ten hours on the clock at 0.01% an hour on $60,005, paid out of the margin before the close gave it back
    expect(book(h).funding).toEqual(Array.from({ length: 10 }, (_, k) => hourPaid(k, 6.0005, { qty: 1, price: 60005, rate: 0.0001 })));
    expect(book(h).cashUsd).toBeCloseTo(cash + 6001.7001 + (59992.999 - 60017.001) - 59.992999 - 60.005, 6);
  });

  it("a position added to pays the hours it stood at the size it stood at, before it grows", async () => {
    const h = home();
    const { all } = leveraged();
    const { t, source: src } = await open(h, "paper-1", { all });
    ok(await t.setLeverage!("BTC-PERP", 10));
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    now = NOW + 3 * HOUR_MS + 60_000;
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    // three hours on 0.1 ($6,000.50), not on the 0.2 held after
    expect(book(h).funding).toEqual([0, 1, 2].map((k) => hourPaid(k, 0.60005, { qty: 0.1, price: 60005, rate: 0.0001 })));
    now = NOW + 4 * HOUR_MS + 60_000;
    await src.settle!();
    expect(book(h).funding!.map((f) => [f.usd, f.qty])).toEqual([[0.60005, 0.1], [0.60005, 0.1], [0.60005, 0.1], [1.2001, 0.2]]);
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ qty: 0.2, fundingUsd: 3.00025, fundedAt: NEXT_HOUR + 3 * HOUR_MS });
  });
});

describe("funding as Hyperliquid pays it: each hour at its own rate, on the oracle", () => {
  afterEach(() => {
    now = NOW;
  });

  it("an hour's funding at the rate its source's history says it was paid at, on the oracle — waited for a minute after the hour while the history does not say it yet, then at the rate the quote carries, written down as the quote's", async () => {
    const h = home();
    const s = sources();
    // the stand-in history: each hour paid, and the rate it was paid at; the windows asked
    const paid = new Map<number, number>();
    const asked: Array<[number, number]> = [];
    const hl = source("hyperliquid", "Hyperliquid", "exchange", [row("BTC-PERP", "perp", "BTC", "USDC", 60005, { fundingRate: 0.0001, maxLeverage: 40, oraclePrice: 60100, markPrice: 60010 })], {
      fundingHistory: async (_symbol: string, from: number, to: number) => {
        asked.push([from, to]);
        return [...paid].filter(([at]) => at >= from && at <= to).map(([at, rate]) => ({ at, rate }));
      },
    });
    const { t, source: src } = await open(h, "paper-1", { all: [s.coinbase, hl] });
    ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 })));
    // the first hour on the clock passed, its rate in the history: 0.1 × the oracle 60,100 × 0.002%
    paid.set(NEXT_HOUR, 0.00002);
    now = NEXT_HOUR + 5_000;
    await src.read();
    expect(book(h).funding).toEqual([{ at: new Date(NEXT_HOUR).toISOString(), symbol: "BTC-PERP", usd: 0.1202, side: "long", qty: 0.1, price: 60100, rate: 0.00002 }]);
    expect(asked).toEqual([[NEXT_HOUR, NEXT_HOUR + 5_000]]);
    // the next hour, half a minute on, not in the history yet: waited for — nothing settled
    now = NEXT_HOUR + HOUR_MS + 30_000;
    await src.read();
    expect(book(h).funding).toHaveLength(1);
    expect(book(h).positions["BTC-PERP"]!.fundedAt).toBe(NEXT_HOUR);
    // a minute past it, still not said: at the rate the quote carries (0.01%), written down as the quote's
    now = NEXT_HOUR + HOUR_MS + 61_000;
    await src.read();
    expect(book(h).funding!.at(-1)).toEqual({ at: new Date(NEXT_HOUR + HOUR_MS).toISOString(), symbol: "BTC-PERP", usd: 0.601, side: "long", qty: 0.1, price: 60100, rate: 0.0001, quoted: true });
    expect(book(h).positions["BTC-PERP"]).toMatchObject({ fundingUsd: 0.7212, fundedAt: NEXT_HOUR + HOUR_MS });
    // the history asked again at most every ten seconds while it does not say an hour
    expect(asked.length).toBeLessThanOrEqual(3);
    // what the page's Funding history reads (LiveTrader.funding): the hours newest first, each as it was settled; `limit` of them at most,
    // none from before `since`
    expect(ok(await t.funding!({ limit: 10 }))).toEqual([
      { at: new Date(NEXT_HOUR + HOUR_MS).toISOString(), symbol: "BTC-PERP", usd: 0.601, side: "long", qty: 0.1, price: 60100, rate: 0.0001, quoted: true },
      { at: new Date(NEXT_HOUR).toISOString(), symbol: "BTC-PERP", usd: 0.1202, side: "long", qty: 0.1, price: 60100, rate: 0.00002 },
    ]);
    expect(ok(await t.funding!({ limit: 1 })).map((f) => f.at)).toEqual([new Date(NEXT_HOUR + HOUR_MS).toISOString()]);
    expect(ok(await t.funding!({ limit: 10, since: NEXT_HOUR + 1 })).map((f) => f.at)).toEqual([new Date(NEXT_HOUR + HOUR_MS).toISOString()]);
  });
});

describe("the owner's own controls over the book: started again, paper money added (feat/paper-live p0: B10)", () => {
  beforeEach(() => {
    now = NOW;
  });
  afterEach(() => {
    now = NOW;
  });

  it("a reset waits for a look under way — whatever it fills lands in the book it archives, never in the new one — then starts the same account again, its order numbers going on", async () => {
    const h = home();
    const { t, source: src, s } = await open(h);
    const resting = ok(await t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    reprice(s.coinbase, "BTC/USD", 58000);
    slow(s.coinbase, 10);
    const look = src.settle!();
    await new Promise((go) => setTimeout(go, 0));
    const reset = src.paperBook!.reset(5000);
    await look;
    const r = await reset;
    if (isRefusal(r)) throw new Error(r.message);
    // the look's fill is the old book's, archived beside the new one
    const archived = JSON.parse(readFileSync(join(h, "paper", "paper-1", r.archived), "utf8")) as PaperBook;
    expect(archived.orders[resting.ref]).toMatchObject({ status: "filled", filledQty: 0.1 });
    expect(archived.holdings["BTC/USD"]!.qty).toBe(0.1);
    expect(book(h)).toMatchObject({ cashUsd: 5000, startCashUsd: 5000, holdings: {}, orders: {}, fills: [], deposits: [], resetFrom: { file: r.archived } });
    expect(r.book).toMatchObject({ venue: "paper-1", cashUsd: 5000, startCashUsd: 5000, holdings: 0, open: 0 });
    // the trader reads the new book from the next moment: its next order is the next number, its cash the new sum
    const next = ok(await t.place(order({ qty: 0.01 })));
    expect(next.ref).toBe(`p${archived.seq + 1}`);
    expect(cashOf(await src.read())).toBeCloseTo(5000 - 0.01 * 58000 * 1.0002 * 1.001, 2);
  });

  it("paper money added is cash from its moment on, written as put in: the book's past tells it again at that moment, never as a gain", async () => {
    const h = home();
    const { t, source: src } = await open(h);
    ok(await t.place(order({ qty: 0.1 })));
    now = NOW + 2 * HOUR_MS;
    const r = src.paperBook!.topUp(2500);
    if (isRefusal(r)) throw new Error(r.message);
    expect(r.book).toMatchObject({ addedUsd: 2500 });
    const b = book(h);
    expect(b.deposits).toEqual([{ at: new Date(NOW + 2 * HOUR_MS).toISOString(), usd: 2500 }]);
    expect(b.cashUsd).toBeCloseTo(10000 - 6001.2 * 1.001 + 2500, 2);
    // the replay ends where the book does, cash and all, and its curve steps up by the sum at the moment it was added
    expect(replayPaperBook(b).cashUsd).toBeCloseTo(b.cashUsd, 6);
    const told = rebuildEquity(b, [], { fromMs: NOW, toMs: NOW + 3 * HOUR_MS, stepMs: HOUR_MS });
    const before = told.points.filter((p) => p.at > NOW && p.at < NOW + 2 * HOUR_MS).at(-1)!;
    const after = told.points.at(-1)!;
    expect(after.at).toBeGreaterThan(NOW + 2 * HOUR_MS);
    expect(after.usd - before.usd).toBeCloseTo(2500, 2);
    expect(told.inexact.filter((x) => x.includes("replay ends"))).toEqual([]);
    // never past the most a paper account holds
    expect(isRefusal(src.paperBook!.topUp(100_000_000))).toBe(true);
  });

  it("a book in the home no connection has open is listed of itself, and started again on disk; an id that is no book's, or no id at all, is refused", async () => {
    const h = home();
    const { t } = await open(h, "paper-momentum", { label: "Momentum" });
    ok(await t.place(order({ qty: 0.01 })));
    expect(paperBooksOnDisk(h)).toEqual([expect.objectContaining({ venue: "paper-momentum", name: "Momentum · paper", startCashUsd: 10000, holdings: 1, open: 0 })]);
    const r = resetBookOnDisk(h, "paper-momentum", 2000, NOW + HOUR_MS);
    if (isRefusal(r)) throw new Error(r.message);
    expect(r.book).toMatchObject({ name: "Momentum · paper", cashUsd: 2000, startCashUsd: 2000, createdAt: new Date(NOW + HOUR_MS).toISOString() });
    expect(book(h, "paper-momentum")).toMatchObject({ cashUsd: 2000, holdings: {} });
    expect(paperBooksOnDisk(h).map((b) => b.cashUsd)).toEqual([2000]);
    expect(refusal(resetBookOnDisk(h, "paper-none", 2000, NOW)).code).toBe("E_WALLET_ACCOUNT_UNKNOWN");
    expect(refusal(resetBookOnDisk(h, "../escape", 2000, NOW)).code).toBe("E_ACCOUNT_BAD_ACTION");
  });
});

describe("what the book tells as it changes, for the account's push channel (feat/paper-live p1: PaperChange)", () => {
  beforeEach(() => {
    now = NOW;
  });
  afterEach(() => {
    now = NOW;
  });
  /** a listener on the book: every change it tells, in order */
  const listen = (src: LiveSource) => {
    const heard: PaperChange[] = [];
    const off = src.paperEvents!.listen((c) => heard.push(c));
    return { heard, off };
  };
  /** a position row without the moment of its mark: the delta's mark is the last quote the book kept, a read's its quote's own stamp */
  const unstamped = (p: unknown) => {
    const x = p as { native?: Record<string, unknown> };
    const { markAt: _m, ...native } = x.native ?? {};
    return { ...x, native };
  };

  it("the owner's own order tells its state, its fill, the holding as the positions read lists it, and the cash — once, in the write that made them", async () => {
    const h = home();
    const { t, source } = await open(h);
    const { heard } = listen(source);
    const bought = ok(await t.place(order({ qty: 0.1 })));
    expect(heard).toHaveLength(1);
    const c = heard[0]!;
    expect(c.orders).toEqual([expect.objectContaining({ ref: bought.ref, symbol: "BTC/USD", side: "buy", type: "market", status: "filled", filledQty: 0.1, avgPrice: 60012 })]);
    expect(c.orders[0]!.clientId).toBe(book(h).orders[bought.ref]!.clientId);
    expect(c.fills).toEqual([expect.objectContaining({ ref: bought.ref, symbol: "BTC/USD", side: "buy", qty: 0.1, price: 60012, name: expect.any(String), kind: "spot", filledQty: 0.1 })]);
    // the holding as the account's positions read lists it — one shape from one place — marked at the quote the fill took
    const read = ok(await t.positions!()).find((p) => p.symbol === "BTC/USD")!;
    expect(c.positions).toHaveLength(1);
    expect(unstamped(c.positions[0]!.position)).toEqual(unstamped(read));
    expect(c.positions[0]!.position!.native).toMatchObject({ paper: true, markAt: expect.any(Number) });
    expect(c.cashUsd).toBeCloseTo(10000 - 6001.2 - 6.0012, 2);
    expect(c.summary).toMatchObject({ venue: "paper-1", holdings: 1, open: 0 });
    // a write that moved none of it tells nothing: a market's leverage set with nothing held there
    ok(await t.setLeverage!("BTC-PERP", 1, "isolated"));
    expect(heard).toHaveLength(1);
    // sold whole: the holding is told gone
    ok(await t.place(order({ side: "sell", qty: 0.1 })));
    expect(heard[1]!.positions).toEqual([{ symbol: "BTC/USD", position: null }]);
  });

  it("a background look's fill is told in the same words as the owner's own: the resting order filled, its fill, the holding, the cash", async () => {
    const h = home();
    const { t, source, s } = await open(h);
    const resting = ok(await t.place(order({ type: "limit", limitPrice: 59000, qty: 0.1 })));
    // a listener that comes now takes the book as it stands: the resting order is no news to it
    const { heard, off } = listen(source);
    reprice(s.coinbase, "BTC/USD", 58980);
    now += 30_000;
    expect(await source.settle!()).toBe(true);
    expect(heard).toHaveLength(1);
    const c = heard[0]!;
    expect(c.orders).toEqual([expect.objectContaining({ ref: resting.ref, status: "filled", filledQty: 0.1, avgPrice: 59000 })]);
    expect(c.fills).toEqual([expect.objectContaining({ ref: resting.ref, price: 59000, qty: 0.1, clientId: book(h).orders[resting.ref]!.clientId })]);
    expect(c.positions.map((p) => [p.symbol, p.position?.qty])).toEqual([["BTC/USD", 0.1]]);
    expect(c.cashUsd).toBeCloseTo(10000 - 5900 - 5.9, 2);
    // a listener that stopped hears nothing more; one that throws is its own fault: the book and the others go on
    off();
    const other = listen(source);
    source.paperEvents!.listen(() => {
      throw new Error("a broken listener");
    });
    ok(await t.place(order({ side: "sell", qty: 0.05 })));
    expect(heard).toHaveLength(1);
    expect(other.heard).toHaveLength(1);
    expect(book(h).holdings["BTC/USD"]!.qty).toBeCloseTo(0.05, 8);
  });

  it("a trailing stop's stop moving is told as its order's change; a bracket's exits are told as they are placed and as one cancels the other", async () => {
    const h = home();
    const { t, source, s } = await open(h);
    ok(await t.place(order({ qty: 0.1 })));
    const { heard } = listen(source);
    const trail = ok(await t.place(order({ side: "sell", type: "trailing_stop", trailPercent: 5, qty: 0.1 })));
    expect(heard.at(-1)!.orders).toEqual([expect.objectContaining({ ref: trail.ref, status: "open", type: "trailing_stop" })]);
    const stopWas = heard.at(-1)!.orders[0]!.stopPrice!;
    reprice(s.coinbase, "BTC/USD", 64000);
    now += 30_000;
    await source.settle!();
    const moved = heard.at(-1)!.orders.find((o) => o.ref === trail.ref)!;
    expect(moved.stopPrice).toBeGreaterThan(stopWas);
    expect(heard.at(-1)!.fills).toEqual([]);
  });

  it("a reset tells the orders still open as canceled with the book, what was held as gone, the new cash and that the book started again; paper money added tells the cash", async () => {
    const h = home();
    const { t, source } = await open(h);
    ok(await t.place(order({ qty: 0.1 })));
    const resting = ok(await t.place(order({ type: "limit", limitPrice: 50000, qty: 0.01 })));
    const { heard } = listen(source);
    const r = await source.paperBook!.reset(5000);
    if (isRefusal(r)) throw new Error(r.message);
    expect(heard).toHaveLength(1);
    const c = heard[0]!;
    // the resting order is no more: told canceled, with the fields its row has, so a page's open orders never keep it
    expect(c.orders).toEqual([expect.objectContaining({ ref: resting.ref, status: "canceled", note: "the book started again", symbol: "BTC/USD", type: "limit", limitPrice: 50000, qty: 0.01 })]);
    expect(c.positions).toEqual([{ symbol: "BTC/USD", position: null }]);
    expect(c.fills).toEqual([]);
    expect(c.cashUsd).toBe(5000);
    expect(c.reset).toEqual({ archived: r.archived, at: new Date(NOW).toISOString() });
    expect(c.summary).toMatchObject({ cashUsd: 5000, startCashUsd: 5000, holdings: 0, open: 0 });
    const added = source.paperBook!.topUp(1500);
    if (isRefusal(added)) throw new Error(added.message);
    expect(heard).toHaveLength(2);
    expect(heard[1]).toMatchObject({ orders: [], fills: [], positions: [], cashUsd: 6500, summary: { addedUsd: 1500 } });
    expect(heard[1]!.reset).toBeUndefined();
  });
});

// ---- feat/paper-live phase 4: what an order would leave, and a market order queued for the open ------------------------------------------

describe("what an order would leave, said before it is placed (feat/paper-live phase 4: the ticket's fee row and estimated liquidation price)", () => {
  it("says the fee by the book's own rule — a share none — and a perpetual's liquidation price as the order would leave the position, at the leverage set, by the very rule its looks liquidate by: the position the fill opens has that price", async () => {
    const h = home();
    const s = sources();
    const hl = source("hyperliquid", "Hyperliquid", "exchange", [row("BTC-PERP", "perp", "BTC", "USDC", 60000, { maxLeverage: 10 })]);
    const { t } = await open(h, "paper-1", { all: [s.coinbase, hl] });
    // a coin: the fee alone (10 bps of the notional at the price given)
    expect(ok(await t.estimate!({ symbol: "BTC/USD", side: "buy", qty: 0.1, price: 60000 }))).toEqual({ feeUsd: 6, feeBps: 10 });
    // a perpetual at 1x (nothing set): a long cannot be liquidated (no price), a short is, once the price has risen by a third (k = 1/20)
    expect(ok(await t.estimate!({ symbol: "BTC-PERP", side: "buy", qty: 0.1, price: 60000 }))).toEqual({ feeUsd: 6, feeBps: 10, leverage: 1 });
    expect(ok(await t.estimate!({ symbol: "BTC-PERP", side: "sell", qty: 0.1, price: 60000 })).liquidationPrice).toBe(liquidationPriceOf({ side: "short", qty: 0.1, entryPrice: 60000, marginUsd: 6000 }, 10));
    // 5x set: margin 1,200 on 6,000 — and the position the order opens carries exactly that liquidation price
    ok(await t.setLeverage!("BTC-PERP", 5));
    const ask = 60000 + 60000 * 0.0002;
    const est = ok(await t.estimate!({ symbol: "BTC-PERP", side: "buy", qty: 0.1, price: ask }));
    expect(est).toMatchObject({ leverage: 5, feeBps: 10 });
    expect(est.liquidationPrice).toBe(liquidationPriceOf({ side: "long", qty: 0.1, entryPrice: ask, marginUsd: (0.1 * ask) / 5 }, 10));
    expect(ok(await t.place(order({ symbol: "BTC-PERP", qty: 0.1 }))).status).toBe("filled");
    const held = ok(await t.positions!()).find((p) => p.symbol === "BTC-PERP")!;
    expect(held.liquidationPrice).toBeCloseTo(est.liquidationPrice!, 4);
    // the position says its margin and its funding, as the page's Positions shows them
    expect(held).toMatchObject({ marginUsd: 1200.24, fundingUsd: 0, marginMode: "isolated" });
    // added to: the position the order would leave (the average entry, the margin added at its leverage); half closed: the margin with it,
    // so the same price; closed whole, or a reduce-only order that reduces nothing: no liquidation price
    const add = ok(await t.estimate!({ symbol: "BTC-PERP", side: "buy", qty: 0.1, price: 62000 }));
    expect(add.liquidationPrice).toBe(liquidationPriceOf({ side: "long", qty: 0.2, entryPrice: (ask * 0.1 + 62000 * 0.1) / 0.2, marginUsd: 1200.24 + 6200 / 5 }, 10));
    expect(ok(await t.estimate!({ symbol: "BTC-PERP", side: "sell", qty: 0.05, price: 61000 })).liquidationPrice).toBeCloseTo(held.liquidationPrice!, 4);
    expect(ok(await t.estimate!({ symbol: "BTC-PERP", side: "sell", qty: 0.1, price: 61000 })).liquidationPrice).toBeUndefined();
    expect(ok(await t.estimate!({ symbol: "BTC-PERP", side: "buy", qty: 0.1, price: 61000, reduceOnly: true })).liquidationPrice).toBeUndefined();
    // nothing was placed, held or saved by any of it
    expect(Object.values(book(h).orders).length).toBe(1);
  });
});

describe("a share's market order queued for the open (feat/paper-live phase 4, P4)", () => {
  it("is filled at its session's first real-time quote inside the worst price the owner SIGNED, taken afresh from that quote by its door's band — tighter, never looser: an open below it holds the buy nearer the open, an open near it keeps the signed one", async () => {
    now = fromEt(2026, 10, 14, 17, 0);
    try {
      const h = home();
      const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock);
      const { t } = await open(h, "paper-1", { all: [us] });
      // queued after the close, with the door's worst price 2% over the ask it was valued at (200.04): the most the owner signed for
      const buy = ok(await t.place(order({ symbol: "NVDA", qty: 1, worstPrice: 204.04 })));
      expect(buy.status).toBe("open");
      expect((buy.native as { note?: string }).note).toBe("queued for the open: NVDA market fills when its session is on, at its first real-time quote then — never past the worst price signed (204.04): an open past it cancels it, nothing filled");
      expect(book(h).orders[buy.ref]!.queuedBand).toBeCloseTo(0.02, 3);
      // the next morning NVIDIA opens 2.5% lower: the buy fills at the open's ask, its worst price pulled in to the band from that ask
      reprice(us, "NVDA", 195);
      now = fromEt(2026, 10, 15, 9, 31);
      expect(ok(await t.status(buy.ref, "NVDA"))).toMatchObject({ status: "filled", avgPrice: 195.039 });
      const o = book(h).orders[buy.ref]!;
      expect(o.queuedOpen).toBe(new Date(fromEt(2026, 10, 15, 9, 31)).toISOString());
      expect(o.worstPrice).toBeCloseTo(195.039 * (1 + o.queuedBand!), 1);
      expect(o.worstPrice!).toBeLessThan(204.04);
      // another queued that evening, and the open the next morning at 203: the band from that ask (207.10) is past what was signed — the
      // signed 204.04 stands, and it fills inside it
      reprice(us, "NVDA", 200);
      now = fromEt(2026, 10, 15, 17, 0);
      const near = ok(await t.place(order({ symbol: "NVDA", qty: 1, worstPrice: 204.04 })));
      reprice(us, "NVDA", 203);
      now = fromEt(2026, 10, 16, 9, 31);
      expect(ok(await t.status(near.ref, "NVDA"))).toMatchObject({ status: "filled", avgPrice: 203.0406 });
      expect(book(h).orders[near.ref]!).toMatchObject({ worstPrice: 204.04, note: "its session's first real-time quote (203.0406): its worst price stays the 204.04 signed" });
    } finally {
      now = NOW;
    }
  });

  it("AN OPEN THAT GAPPED PAST THE WORST PRICE SIGNED cancels it at once, nothing filled, saying the open's price and the signed one — never a fill past the signature, never a wait all day; a sell gapping down past its signed floor the same", async () => {
    now = fromEt(2026, 10, 14, 15, 0);
    try {
      const h = home();
      const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock);
      const { t } = await open(h, "paper-1", { all: [us] });
      ok(await t.place(order({ symbol: "NVDA", qty: 2 })));
      const cash = book(h).cashUsd;
      now = fromEt(2026, 10, 14, 17, 0);
      const buy = ok(await t.place(order({ symbol: "NVDA", qty: 1, worstPrice: 204.04 })));
      const sell = ok(await t.place(order({ symbol: "NVDA", side: "sell", qty: 1, worstPrice: 196.03 })));
      expect([buy.status, sell.status]).toEqual(["open", "open"]);
      // NVIDIA opens 5% higher: past the most the buy was signed for
      reprice(us, "NVDA", 210);
      now = fromEt(2026, 10, 15, 9, 31);
      const up = ok(await t.status(buy.ref, "NVDA"));
      expect(up).toMatchObject({ status: "canceled", filledQty: 0 });
      expect(book(h).orders[buy.ref]!.note).toBe("the open (210.042) gapped past the worst price signed (204.04): canceled, nothing filled — place it again at the open's price");
      // the sell, inside its floor at 210: filled there
      expect(ok(await t.status(sell.ref, "NVDA")).status).toBe("filled");
      // another sell queued that evening, and the next morning NVIDIA opens 5% lower: past the least it was signed to fetch
      now = fromEt(2026, 10, 15, 17, 0);
      const low = ok(await t.place(order({ symbol: "NVDA", side: "sell", qty: 1, worstPrice: 205.84 })));
      reprice(us, "NVDA", 199.5);
      now = fromEt(2026, 10, 16, 9, 31);
      expect(ok(await t.status(low.ref, "NVDA"))).toMatchObject({ status: "canceled", filledQty: 0 });
      expect(book(h).orders[low.ref]!.note).toBe("the open (199.4601) gapped past the worst price signed (205.84): canceled, nothing filled — place it again at the open's price");
      // what was canceled moved nothing: the share it would have sold is still held, the cash only the filled sell's
      expect(book(h).holdings.NVDA?.qty).toBe(1);
      expect(book(h).cashUsd).toBeCloseTo(cash + 209.958, 2);
    } finally {
      now = NOW;
    }
  });

  it("an order queued before the band was kept (an older book) takes the door's own 2% from the open's quote, once, inside the worst price it was queued with — and one gapped past it is canceled the same", async () => {
    now = fromEt(2026, 10, 14, 17, 0);
    try {
      const h = home();
      const us = stamped("us-test", [row("NVDA", "stock", "NVDA", "USD", 200)], usClock);
      const { t } = await open(h, "paper-1", { all: [us] });
      const buy = ok(await t.place(order({ symbol: "NVDA", qty: 1, worstPrice: 204.04 })));
      const gap = ok(await t.place(order({ symbol: "NVDA", qty: 1, worstPrice: 197 })));
      // as an older book holds them: no band kept, their notes the old one
      const raw = JSON.parse(readFileSync(paperBookPath(h, "paper-1"), "utf8")) as PaperBook;
      for (const ref of [buy.ref, gap.ref]) {
        delete raw.orders[ref]!.queuedBand;
        raw.orders[ref]!.note = "queued for the open: NVDA market fills when its session is on";
      }
      const { writeFileSync } = await import("node:fs");
      writeFileSync(paperBookPath(h, "paper-1"), JSON.stringify(raw));
      const again = await open(h, "paper-1", { all: [us] });
      reprice(us, "NVDA", 198);
      now = fromEt(2026, 10, 15, 9, 31);
      expect(ok(await again.t.status(buy.ref, "NVDA"))).toMatchObject({ status: "filled", avgPrice: 198.0396 });
      expect(book(h).orders[buy.ref]!.worstPrice).toBeCloseTo(198.0396 * 1.02, 1);
      expect(ok(await again.t.status(gap.ref, "NVDA"))).toMatchObject({ status: "canceled", filledQty: 0 });
      expect(book(h).orders[gap.ref]!.note).toContain("gapped past the worst price signed (197)");
    } finally {
      now = NOW;
    }
  });
});
