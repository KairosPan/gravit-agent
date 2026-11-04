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

/* Fix rounds 1-3: the text is defanged rather than searched for hosts - every scheme link, scheme-relative
 * link and dotted quad is <link>, and every '.' not between two digits is '·', after NFKC and the dot
 * look-alikes. The same cases run on the account's notices (account/test/unit/identity-send.test.ts), and
 * the rule is one text in both (the last test here). */
const DEFANGED: [string, string][] = [
  ["Pay at evil.com now", "Pay at evil·com now"],
  ["163.com", "163·com"],
  ["4399.com and 1688.com/x", "4399·com and 1688·com/x"],
  ["a.123.com", "a·123·com"],
  ["1.2.co", "1.2·co"],
  ["١٦٣.com", "١٦٣·com"],
  ["eviĺ.com and eviĺ.com", "eviĺ·com and eviĺ·com"],
  ["evil。com evil．com evil｡com evil․com", "evil·com evil·com evil·com evil·com"],
  ["EVIL.US and NVDA.US", "EVIL·US and NVDA·US"],
  ["600519.SH BRK.B notes.md", "600519·SH BRK·B notes·md"],
  ["x_evil.com a/evil.com a@evil.io", "x_evil·com a/evil·com a@evil·io"],
  ["go //evil.com/x", "go <link>"],
  ["go ftp://x and javascript://x and xhttp://evil", "go <link> and <link> and <link>"],
  ["host 203.0.113.5:8080/pay", "host <link>"],
  ["see https://x.example/pay?id=1", "see <link>"],
];
const UNCHANGED = ["Buy 10 NVDA · limit 183.00 · Paper · Alpaca", "183.00", "3.5%", "1,234.56", "BTC/USDT", "ETH/USD at 2451.3333",
  "@gravit /status #nvda $NVDA"];

/** Nothing Telegram could make a link of: no scheme, no '//', no dotted quad, no '.' but between two digits. */
const linkless = (text: string): boolean =>
  !/:\/\/|\/\/|[0-9]{1,3}(?:\.[0-9]{1,3}){3}/.test(text) && !/(?<![0-9])\.|\.(?![0-9])/.test(text);

test("a text is defanged: no link and no host survives; prices, numbers and the card line stay", () => {
  for (const [text, want] of DEFANGED) {
    assert.equal(scrubLinks(text), want, text);
    assert.ok(linkless(scrubLinks(text)), text);
  }
  for (const text of UNCHANGED) assert.equal(scrubLinks(text), text, text);
  const bare = { venue: "evil.example/approve", symbol: "NVDA", side: "buy", qty: 1 };
  assert.equal(cardNoticeText("mcp__account__portfolio_live_order", bare), "Your call · Buy 1 NVDA · evil·example/approve — waiting in Gravit");
  assert.equal(cardNoticeText("mcp__account__portfolio_transfer", { to: "evil.com", amount: "183.00" }),
    "Your call · portfolio_transfer: amount=183.00 to=evil·com — waiting in Gravit");
  assert.equal(cardNoticeText("mcp__account__portfolio_live_order", { venue: "alpaca-paper", symbol: "NVDA", side: "buy", qty: 10, orderType: "limit", limitPrice: 183.5 }),
    "Your call · Buy 10 NVDA · limit 183.5 · alpaca-paper — waiting in Gravit");
});

test("a cut line is scrubbed again: wherever the cut lands near a link, none is left", () => {
  for (let pad = 520; pad < 600; pad++) {
    const text = cardNoticeText("mcp__account__portfolio_transfer", { body: "y", note: `${"z".repeat(30)}`,
      a: "evil.museum/x", b: "https://evil.example/x", c: "1.2.3.4",
      ...Object.fromEntries(Array.from({ length: Math.ceil(pad / 40) }, (_, i) => [`k${i}`, "w".repeat(38)])), zz: "sub.evil.io/x" });
    assert.ok(text.length <= 600, `bounded: ${text.length}`);
    const inner = text.slice("Your call · ".length, -" — waiting in Gravit".length).replace(/…$/, "");
    assert.ok(linkless(inner), `pad ${pad}`);
    assert.equal(scrubLinks(inner), inner, "the cut line is already clean");
  }
  /* NFKC can lengthen a line (U+FDFA is eighteen characters): still bounded */
  const wide = cardNoticeText("mcp__account__portfolio_transfer", Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, "\uFDFA".repeat(20)])));
  assert.ok(wide.length <= 600, `bounded after NFKC: ${wide.length}`);
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
