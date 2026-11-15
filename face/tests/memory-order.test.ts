/** src/memory-order.ts: a seat write's arguments read into validated order lines, and what a line and a position say
 * might be done, what an approval and a decline are written as, and the order's words. Pure: no I/O. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  approvedAction, consideringOf, declinedAction, GATE_LINES_MAX, gateOrdersOf, marketOfKind, MEMORY_SYMBOL, memorySymbol,
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

test("orderWords: no character outside the order words' set", () => {
  const allowed = /^[A-Za-z0-9 ._:\/^=$·-]*$/;
  const lines: OrderLine[] = [
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
