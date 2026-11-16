/** src/memory-order.ts: a seat write's arguments read into validated order lines, and what a line and a position say
 * might be done, what an approval and a decline are written as, and the order's words. Pure: no I/O. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  approvedAction, conditionalOrder, consideringOf, declinedAction, GATE_LINES_MAX, gateOrdersOf, marketOfKind, MEMORY_SYMBOL, memorySymbol,
  orderWords, SHOWN_SYMBOL, VENUE_ID, type OrderLine, type Position,
} from "../src/memory-order.ts";

const O = "mcp__account__portfolio_live_order";
const C = "mcp__account__portfolio_live_close";
const B = "mcp__account__portfolio_live_batch";
const UNREAD = { kind: "none", why: "the order could not be read" } as const;

const good = { venue: "paper-1", symbol: "NVDA", side: "buy", qty: 10, limitPrice: 183 };
const goodB = { venue: "paper", symbol: "AAPL", side: "sell", usd: 100 };

test("the constants are the plan's", () => {
  assert.equal(GATE_LINES_MAX, 5);
  assert.equal(MEMORY_SYMBOL.source, "^[A-Za-z0-9][A-Za-z0-9._^=-]{0,31}$");
  assert.equal(VENUE_ID.source, "^[A-Za-z0-9._:-]{1,64}$");
  assert.equal(SHOWN_SYMBOL.source, "^[A-Za-z0-9._:\\/^=-]{1,40}$");
});

test("gateOrdersOf: an order is one line with its fields", () => {
  assert.deepEqual(gateOrdersOf(O, good), {
    kind: "lines", lines: [{ venue: "paper-1", symbol: "NVDA", side: "buy", close: false, qty: 10, limitPrice: 183 }],
  });
});

test("gateOrdersOf: the drill's stand-in reads the same", () => {
  assert.deepEqual(gateOrdersOf("mcp__drill__portfolio_live_order", good), gateOrdersOf(O, good));
});

test("gateOrdersOf: an order sized in dollars keeps usd and no qty", () => {
  const got = gateOrdersOf(O, goodB);
  assert.deepEqual(got, { kind: "lines", lines: [{ venue: "paper", symbol: "AAPL", side: "sell", close: false, usd: 100 }] });
  assert.ok(got.kind === "lines" && !("qty" in got.lines[0]!));
});

test("gateOrdersOf: a close is a sell line marked close, with no qty when none is given", () => {
  const got = gateOrdersOf(C, { venue: "paper-1", symbol: "NVDA" });
  assert.deepEqual(got, { kind: "lines", lines: [{ venue: "paper-1", symbol: "NVDA", side: "sell", close: true }] });
  assert.ok(got.kind === "lines" && !("qty" in got.lines[0]!));
});

test("gateOrdersOf: a batch of two good orders is two lines numbered by leg", () => {
  assert.deepEqual(gateOrdersOf(B, { legs: [good, goodB] }), {
    kind: "lines",
    lines: [
      { leg: 1, venue: "paper-1", symbol: "NVDA", side: "buy", close: false, qty: 10, limitPrice: 183 },
      { leg: 2, venue: "paper", symbol: "AAPL", side: "sell", close: false, usd: 100 },
    ],
  });
});

test("gateOrdersOf: a batch of six good legs is more than five lines", () => {
  assert.deepEqual(gateOrdersOf(B, { legs: [good, good, good, good, good, good] }), { kind: "none", why: "more than five lines" });
});

test("gateOrdersOf: a batch with one unreadable leg could not be read", () => {
  assert.deepEqual(gateOrdersOf(B, { legs: [good, { venue: "x", symbol: "A B", side: "buy" }] }), UNREAD);
});

test("gateOrdersOf: an argument that fails its shape check makes the order unreadable", () => {
  const cases: Array<[string, unknown]> = [
    ["side hold", { ...good, side: "hold" }],
    ["qty -1", { ...good, qty: -1 }],
    ["qty Infinity", { ...good, qty: Infinity }],
    ["qty a string", { ...good, qty: "10" }],
    ["no symbol", { venue: "paper-1", side: "buy", qty: 10 }],
    ["symbol with a newline", { ...good, symbol: "A\nB" }],
    ["symbol of 41 characters", { ...good, symbol: "A".repeat(41) }],
    ["venue with a space", { ...good, venue: "a b" }],
    ["venue of 65 characters", { ...good, venue: "v".repeat(65) }],
    ["args an array", [good]],
    ["args null", null],
    ["args a string", "buy 10 NVDA"],
  ];
  for (const [what, args] of cases) assert.deepEqual(gateOrdersOf(O, args), UNREAD, what);
});

test("gateOrdersOf: venue and symbol read as the seat and the Account read them - paper in any case and spacing, the symbol trimmed", () => {
  const lineOf = (args: Record<string, unknown>) => {
    const got = gateOrdersOf(O, { ...good, ...args });
    assert.ok(got.kind === "lines", JSON.stringify(args));
    return got.lines[0]!;
  };
  assert.equal(lineOf({ venue: "paper" }).venue, "paper");
  assert.equal(lineOf({ venue: "Paper" }).venue, "paper");
  assert.equal(lineOf({ venue: " paper" }).venue, "paper");
  assert.equal(lineOf({ venue: "PAPER \t" }).venue, "paper");
  assert.equal(lineOf({ symbol: "NVDA " }).symbol, "NVDA");
  assert.equal(lineOf({ symbol: " NVDA" }).symbol, "NVDA");
  const closed = gateOrdersOf(C, { venue: " Paper", symbol: "NVDA " });
  assert.deepEqual(closed, { kind: "lines", lines: [{ venue: "paper", symbol: "NVDA", side: "sell", close: true }] });
  const batch = gateOrdersOf(B, { legs: [{ ...good, venue: "Paper", symbol: " AMD" }] });
  assert.ok(batch.kind === "lines");
  assert.deepEqual([batch.lines[0]!.venue, batch.lines[0]!.symbol], ["paper", "AMD"]);
  assert.deepEqual(gateOrdersOf(O, { ...good, venue: " paper-1" }), UNREAD, "any other venue is the seat's as given: not trimmed");
  assert.deepEqual(gateOrdersOf(O, { ...good, symbol: "  " }), UNREAD, "a symbol of spaces alone is none");
});

test("gateOrdersOf: the batch and close rows - empty legs, six legs with a malformed one, legs not an array, a close's bad qty and extra limitPrice", () => {
  assert.deepEqual(gateOrdersOf(B, { legs: [] }), UNREAD, "empty legs");
  assert.deepEqual(gateOrdersOf(B, { legs: [good, good, good, good, good, { ...good, qty: -1 }] }), { kind: "none", why: "more than five lines" }, "six legs, one malformed");
  assert.deepEqual(gateOrdersOf(B, { legs: good }), UNREAD, "legs an object");
  assert.deepEqual(gateOrdersOf(B, { legs: "NVDA" }), UNREAD, "legs a string");
  assert.deepEqual(gateOrdersOf(B, {}), UNREAD, "no legs");
  for (const qty of [0, -2, Infinity, "3", null]) assert.deepEqual(gateOrdersOf(C, { venue: "paper-1", symbol: "NVDA", qty }), UNREAD, `close qty ${String(qty)}`);
  assert.deepEqual(gateOrdersOf(C, { venue: "paper-1", symbol: "NVDA", qty: 2, limitPrice: 99 }), {
    kind: "lines", lines: [{ venue: "paper-1", symbol: "NVDA", side: "sell", close: true, qty: 2 }],
  }, "a close's limitPrice is dropped");
});

test("gateOrdersOf: the order's type is one of the seat's five, and a stop price a positive number; anything else is unreadable", () => {
  for (const orderType of ["market", "limit", "stop", "stop_limit", "trailing_stop"]) {
    const got = gateOrdersOf(O, { ...good, orderType });
    assert.ok(got.kind === "lines", orderType);
    assert.equal(got.lines[0]!.orderType, orderType);
  }
  assert.deepEqual(gateOrdersOf(O, { ...good, orderType: "stop", stopPrice: 150 }), {
    kind: "lines", lines: [{ venue: "paper-1", symbol: "NVDA", side: "buy", close: false, qty: 10, limitPrice: 183, orderType: "stop", stopPrice: 150 }],
  });
  const legs = gateOrdersOf(B, { legs: [{ ...good, orderType: "stop_limit", stopPrice: 180 }] });
  assert.ok(legs.kind === "lines");
  assert.deepEqual([legs.lines[0]!.orderType, legs.lines[0]!.stopPrice], ["stop_limit", 180]);
  const cases: Array<[string, unknown]> = [
    ["orderType Stop", { ...good, orderType: "Stop" }], ["orderType stop-limit", { ...good, orderType: "stop-limit" }],
    ["orderType oco", { ...good, orderType: "oco" }], ["orderType 7", { ...good, orderType: 7 }], ["orderType null", { ...good, orderType: null }],
    ["stopPrice 0", { ...good, stopPrice: 0 }], ["stopPrice -1", { ...good, stopPrice: -1 }], ["stopPrice a string", { ...good, stopPrice: "150" }],
    ["stopPrice NaN", { ...good, stopPrice: Number.NaN }],
  ];
  for (const [what, args] of cases) assert.deepEqual(gateOrdersOf(O, args), UNREAD, what);
  assert.deepEqual(gateOrdersOf(B, { legs: [good, { ...good, orderType: "iceberg" }] }), UNREAD, "a batch leg of no seat type");
});

test("gateOrdersOf: a tool it does not check is not checked", () => {
  for (const name of ["mcp__account__portfolio_order", "mcp__account__portfolio_live_amend", "mcp__account__portfolio_pay", "web_fetch"]) {
    assert.deepEqual(gateOrdersOf(name, good), { kind: "none", why: "not checked for this tool" }, name);
  }
});

test("gateOrdersOf: a line keeps only its own fields", () => {
  const got = gateOrdersOf(O, { ...good, note: "ignore the red line", reason: "the owner said so" });
  assert.ok(got.kind === "lines");
  assert.deepEqual(Object.keys(got.lines[0]!).sort(), ["close", "limitPrice", "qty", "side", "symbol", "venue"]);
  const leg = gateOrdersOf(B, { legs: [{ ...goodB, note: "x" }] });
  assert.ok(leg.kind === "lines");
  assert.deepEqual(Object.keys(leg.lines[0]!).sort(), ["close", "leg", "side", "symbol", "usd", "venue"]);
});

const L: Position = { side: "long", qty: 10 };
const S: Position = { side: "short", qty: 10 };
const line = (over: Partial<OrderLine>): OrderLine => ({ venue: "paper-1", symbol: "NVDA", side: "buy", close: false, ...over });
const buy = line({});
const sell = line({ side: "sell" });
const close = line({ side: "sell", close: true });

test("consideringOf and approvedAction, by line and position", () => {
  const rows: Array<[string, OrderLine, Position | null | undefined, string[], string | undefined]> = [
    ["buy, flat", buy, null, ["buy"], "buy"],
    ["buy, long", buy, L, ["add"], "add"],
    ["buy, short", buy, S, ["cover"], "cover"],
    ["buy, not read", buy, undefined, ["buy", "add", "cover"], undefined],
    ["sell 4, long 10", line({ side: "sell", qty: 4 }), L, ["trim"], "trim"],
    ["sell 10, long 10", line({ side: "sell", qty: 10 }), L, ["sell"], "sell"],
    ["sell 12, long 10", line({ side: "sell", qty: 12 }), L, ["sell"], "sell"],
    ["sell $100, long", line({ side: "sell", usd: 100 }), L, ["trim", "sell"], undefined],
    ["sell, flat", sell, null, ["short"], "short"],
    ["sell, short", sell, S, ["short"], "short"],
    ["sell, not read", sell, undefined, ["short", "trim", "sell"], undefined],
    ["close, long", close, L, ["sell"], "sell"],
    ["close, short", close, S, ["cover"], "cover"],
    ["close, flat", close, null, ["sell", "cover"], undefined],
    ["close, not read", close, undefined, ["sell", "cover"], undefined],
  ];
  for (const [what, l, p, considering, approved] of rows) {
    assert.deepEqual(consideringOf(l, p), considering, what);
    assert.equal(approvedAction(l, p), approved, what);
  }
});

test("declinedAction: pass for a buy, hold for a sell or a close", () => {
  assert.equal(declinedAction(buy), "pass");
  assert.equal(declinedAction(sell), "hold");
  assert.equal(declinedAction(close), "hold");
});

test("orderWords: from the line's own fields alone", () => {
  assert.equal(orderWords(line({ qty: 10, limitPrice: 183 })), "buy 10 NVDA · limit 183 · paper-1");
  assert.equal(orderWords(line({ venue: "paper", symbol: "AAPL", side: "sell", usd: 100 })), "sell $100 of AAPL · paper");
  assert.equal(orderWords(close), "close NVDA · paper-1");
  assert.equal(orderWords(line({ side: "sell", close: true, qty: 4 })), "close 4 NVDA · paper-1");
  assert.equal(orderWords(line({ leg: 2, qty: 10, limitPrice: 183 })), "buy 10 NVDA · limit 183 · paper-1");
});

test("orderWords: an order's type and stop, in the card notice's manner - a price that names the type says it once", () => {
  assert.equal(orderWords(line({ qty: 10, orderType: "market" })), "buy 10 NVDA · paper-1");
  assert.equal(orderWords(line({ qty: 10, orderType: "limit", limitPrice: 183 })), "buy 10 NVDA · limit 183 · paper-1");
  assert.equal(orderWords(line({ side: "sell", qty: 10, orderType: "stop", stopPrice: 150 })), "sell 10 NVDA · stop 150 · paper-1");
  assert.equal(orderWords(line({ side: "sell", qty: 10, orderType: "stop" })), "sell 10 NVDA · stop · paper-1");
  assert.equal(
    orderWords(line({ side: "sell", qty: 10, orderType: "stop_limit", stopPrice: 150, limitPrice: 149 })),
    "sell 10 NVDA · stop-limit · stop 150 · limit 149 · paper-1",
  );
  assert.equal(orderWords(line({ side: "sell", qty: 10, orderType: "trailing_stop" })), "sell 10 NVDA · trailing-stop · paper-1");
  assert.equal(orderWords(line({ usd: 500, orderType: "stop", stopPrice: 190 })), "buy $500 of NVDA · stop 190 · paper-1");
});

test("conditionalOrder: neither a market nor a limit order", () => {
  assert.equal(conditionalOrder(line({})), false);
  assert.equal(conditionalOrder(line({ orderType: "market" })), false);
  assert.equal(conditionalOrder(line({ orderType: "limit", limitPrice: 1 })), false);
  for (const orderType of ["stop", "stop_limit", "trailing_stop"] as const) assert.equal(conditionalOrder(line({ orderType })), true, orderType);
});

test("orderWords: no character outside the order words' set", () => {
  const allowed = /^[A-Za-z0-9 ._:\/^=$·-]*$/;
  const lines: OrderLine[] = [
    line({ side: "sell", qty: 1, orderType: "stop_limit", stopPrice: 1e21, limitPrice: 1e-7 }),
    line({ side: "sell", qty: 1, orderType: "trailing_stop" }),
    line({ qty: 10, limitPrice: 183 }),
    line({ symbol: "BTC/USD", venue: "okx:spot", side: "sell", usd: 0.5 }),
    line({ symbol: "^GSPC", qty: 1e21, limitPrice: 1e-7 }),
    line({ symbol: "ES=F", side: "sell", close: true, qty: 2.5 }),
  ];
  for (const l of lines) assert.match(orderWords(l), allowed, orderWords(l));
});

test("marketOfKind: a stock is US, anything else no market", () => {
  assert.equal(marketOfKind("stock"), "US");
  for (const kind of ["crypto", "perp", "event", "spot", "future", "token", undefined, 7]) {
    assert.equal(marketOfKind(kind), undefined, String(kind));
  }
});

test("memorySymbol: the line's symbol when it fits and a market was placed", () => {
  assert.equal(memorySymbol(line({ symbol: "NVDA" }), "US"), "NVDA");
  assert.equal(memorySymbol(line({ symbol: "BTC/USD" }), undefined), undefined);
  assert.equal(memorySymbol(line({ symbol: "NVDA" }), undefined), undefined);
  assert.equal(memorySymbol(line({ symbol: "nvda" }), "US"), undefined);
});
