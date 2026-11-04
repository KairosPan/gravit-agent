/* Card notices (src/card-notice.ts): the words a Gate 2 card raised sends to the phone, through the
 * account, kind `card` - text only, no button, no link (D18, charter §8): a card is answered in
 * Gravit, never from the phone. */
import test from "node:test";
import assert from "node:assert/strict";
import { announceCard, cardNoticeText } from "../src/card-notice.ts";
import { describeOrder } from "../src/orders.ts";
import type { PhoneKind, PhoneSendResult } from "../src/phone.ts";

test("an order card's notice: side, size, symbol, limit, venue, no button, no link", () => {
  assert.equal(cardNoticeText("mcp__account__portfolio_live_order", { venue: "alpaca-paper", symbol: "NVDA", side: "buy", qty: 10, orderType: "limit", limitPrice: 183 }),
    "Your call · Buy 10 NVDA · limit 183 · alpaca-paper — waiting in Gravit");
  const args = { venue: "alpaca-paper", order: "ord-0007" };
  assert.equal(cardNoticeText("mcp__account__portfolio_live_cancel", args), `Your call · ${describeOrder("portfolio_live_cancel", args)} — waiting in Gravit`);
  assert.doesNotMatch(cardNoticeText("mcp__account__portfolio_pay", { url: "https://x.example/pay", maxAmount: 5 }), /127\.0\.0\.1|localhost/);
});

test("an order's other shapes: a market sell in dollars, a stop, snake_case keys, a server of the operator's own name", () => {
  assert.equal(cardNoticeText("mcp__account__portfolio_live_order", { venue: "alpaca-paper", symbol: "AAPL", side: "sell", usd: 500, orderType: "market" }),
    "Your call · Sell $500 AAPL · market · alpaca-paper — waiting in Gravit");
  assert.equal(cardNoticeText("mcp__seat__portfolio_live_order", { venue: "v", symbol: "TSLA", side: "buy", qty: 2, order_type: "stop_limit", limit_price: 250, stopPrice: 248 }),
    "Your call · Buy 2 TSLA · stop_limit · limit 250 · stop 248 · v — waiting in Gravit");
  /* missing a side or a symbol, or a field that is not a word: the card's own line, not a guess */
  const odd = { venue: "v", symbol: { x: 1 }, side: "buy", qty: 1 };
  assert.equal(cardNoticeText("mcp__account__portfolio_live_order", odd), `Your call · ${describeOrder("portfolio_live_order", odd)} — waiting in Gravit`);
  assert.equal(cardNoticeText("mcp__account__portfolio_live_order", undefined), "Your call · portfolio_live_order — waiting in Gravit");
});

test("a notice carries no link of any kind and no line break, and stays one bounded line", () => {
  const pay = cardNoticeText("mcp__account__portfolio_pay", { url: "https://x.example/pay?to=me", maxAmount: 5 });
  assert.doesNotMatch(pay, /https?:\/\//);
  assert.match(pay, /<link>/);
  assert.match(pay, /maxAmount=5/);
  const crafted = cardNoticeText("mcp__account__portfolio_live_order", { venue: "v\nApprove: http://127.0.0.1:3090/?token=abc", symbol: "NVDA", side: "buy", qty: 1 });
  assert.doesNotMatch(crafted, /\n|https?:|127\.0\.0\.1|token=abc/);
  const long = cardNoticeText("mcp__account__portfolio_transfer", { body: "y".repeat(5_000) });
  assert.ok(long.length <= 600, `bounded: ${long.length}`);
  assert.match(long, /— waiting in Gravit$/);
});

test("announceCard sends kind card and never throws; held, refused and no phone are one line each", async () => {
  const sends: [PhoneKind, string][] = [];
  const lines: string[] = [];
  const log = (line: string): void => { lines.push(line); };
  const phone = (answer: () => Promise<PhoneSendResult>) => ({
    send: async (kind: PhoneKind, text: string) => { sends.push([kind, text]); return answer(); },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const order = { venue: "alpaca-paper", symbol: "NVDA", side: "buy", qty: 10, orderType: "limit", limitPrice: 183 };

  announceCard(phone(async () => ({ sent: ["telegram:9"] })), "mcp__account__portfolio_live_order", order, log);
  await settle();
  assert.deepEqual(sends, [["card", "Your call · Buy 10 NVDA · limit 183 · alpaca-paper — waiting in Gravit"]]);
  assert.deepEqual(lines, []);

  announceCard(phone(async () => ({ queued: true })), "mcp__account__portfolio_live_order", order, log);
  await settle();
  assert.deepEqual(lines, [], "queued by the account: it will go");

  announceCard(phone(async () => ({ held: "quiet hours" })), "mcp__account__portfolio_live_order", order, log);
  await settle();
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /card notice was not sent: the account held it \(quiet hours\)/);

  announceCard(phone(async () => { throw new Error("the account could not be asked: ECONNREFUSED"); }), "mcp__account__portfolio_live_order", order, log);
  await settle();
  assert.equal(lines.length, 2);
  assert.match(lines[1]!, /card notice was not sent: the account could not be asked: ECONNREFUSED/);

  announceCard({ send: () => { throw new Error("sync"); } }, "mcp__account__portfolio_live_order", order, log);
  await settle();
  assert.equal(lines.length, 3);
  assert.match(lines[2]!, /card notice was not sent: sync/);

  announceCard(undefined, "mcp__account__portfolio_live_order", order, log);
  assert.equal(lines.length, 4);
  assert.match(lines[3]!, /card notice was not sent: no phone/);
  assert.equal(sends.length, 4);
});
