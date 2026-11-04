/* Card notices (src/card-notice.ts): the words a Gate 2 card raised sends to the phone, through the
 * account, kind `card` - text only, no button, no link (D18, charter §8): a card is answered in
 * Gravit, never from the phone. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { announceCard, cardNoticeText, scrubLinks } from "../src/card-notice.ts";
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

/* Fix rounds 1 and 2: every link Telegram would make tappable is <link> - any scheme, scheme-relative,
 * a bare host whatever its TLD, a dotted quad - and market forms are left alone. The same cases run on
 * the account's notices (account/test/unit/identity-send.test.ts), and the rule is one text in both. */
const BARE_LINKS: [string, string][] = [
  ["Pay at evil.com now", "Pay at <link> now"],
  ["evil.example/approve?id=1", "<link>"],
  ["see Pay.Example.COM/x", "see <link>"],
  ["host 203.0.113.5:8080/pay", "host <link>"],
  ["write a@evil.io", "write a@<link>"],
  ["go evil.museum", "go <link>"],
  ["go evil.tk and evil.xn--p1ai", "go <link> and <link>"],
  ["go evil.us/x", "go <link>"],
  ["go sub.evil.io:8080/x?y=1", "go <link>"],
  ["go //evil.com/x", "go <link>"],
  ["go ftp://x and javascript://x", "go <link> and <link>"],
  ["go x_evil.com", "go x_<link>"],
  ["go a/evil.com", "go a/<link>"],
  ["go 183.00/evil.com", "go 183.00/<link>"],
  ["go xhttp://evil", "go <link>"],
  ["go EVIL.US/x", "go <link>"],
  ["go evil.рф", "go <link>"],
];
const NOT_LINKS = ["Buy 10 NVDA · limit 183.00 · Paper · Alpaca", "BTC/USDT", "ETH/USD at 2451.3333", "up 3.5% on v1.2.3",
  "600519.SH and 0700.HK and 000001.SZ", "BRK.B", "NVDA.US", "e.g. Alpaca."];

test("a link in any form is <link>; prices, versions and market symbols are not touched", () => {
  for (const [text, want] of BARE_LINKS) assert.equal(scrubLinks(text), want, text);
  for (const text of NOT_LINKS) assert.equal(scrubLinks(text), text, text);
  assert.equal(scrubLinks("see notes.md"), "see <link>", "an ordinary dotted word reads as a link and goes too");
  const bare = { venue: "evil.example/approve", symbol: "NVDA", side: "buy", qty: 1 };
  assert.equal(cardNoticeText("mcp__account__portfolio_live_order", bare), "Your call · Buy 1 NVDA · <link> — waiting in Gravit");
  assert.equal(cardNoticeText("mcp__account__portfolio_transfer", { to: "evil.com", amount: "183.00" }),
    "Your call · portfolio_transfer: amount=183.00 to=<link> — waiting in Gravit");
});

test("a cut line is scrubbed again: wherever the cut lands near a link, none is left", () => {
  for (let pad = 520; pad < 600; pad++) {
    const text = cardNoticeText("mcp__account__portfolio_transfer", { body: "y", note: `${"z".repeat(30)}`,
      a: "evil.museum/x", ...Object.fromEntries(Array.from({ length: Math.ceil(pad / 40) }, (_, i) => [`k${i}`, "w".repeat(38)])), zz: "sub.evil.io/x" });
    assert.ok(text.length <= 600, `bounded: ${text.length}`);
    assert.doesNotMatch(text, /evil/, `pad ${pad}`);
    const inner = text.slice("Your call · ".length, -" — waiting in Gravit".length);
    assert.equal(scrubLinks(inner), inner, "the cut line is already clean");
  }
});

test("the link scrub is one text: face/src/card-notice.ts and the account's notices.ts carry the same block", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const block = (path: string): string => {
    const text = readFileSync(path, "utf8");
    const from = text.indexOf("/* LINK SCRUB BEGIN");
    const to = text.indexOf("/* LINK SCRUB END */");
    assert.ok(from >= 0 && to > from, `markers in ${path}`);
    return text.slice(from, to);
  };
  assert.equal(block(join(here, "../../account/src/portfolio/identity/notices.ts")), block(join(here, "../src/card-notice.ts")));
});
