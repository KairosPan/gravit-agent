/** SENDING (identity/identity.ts send, identity/outbox.ts, identity/notices.ts): POST /api/account/identity/send takes a kind, a text and
 * what it replies to — the account picks who receives it: only the bound operator's private chat, only on the networks the routing ticks for
 * that kind (every connected one for the watchdog), and not in quiet hours for a proactive kind. What Telegram cannot take waits in the
 * outbox and goes first; the account's own tokens are taken out of every text; nothing links to the face. The account sends its own fill
 * and Guard-card notices. Every Bot API call goes to a fake on loopback; every token is made up. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ledger, LedgerRow } from "../../src/agent/ledger.ts";
import { isRefusal } from "../../src/core/errors.ts";
import { keyHashOf, newSalt } from "../../src/portfolio/account/brain-keys.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import type { PublicSource } from "../../../market/src/live/public-markets.ts";
import { quietHolds } from "../../src/portfolio/identity/kinds.ts";
import { cardNotice, fillNotice, noLinks } from "../../src/portfolio/identity/notices.ts";
import { Outbox } from "../../src/portfolio/identity/outbox.ts";
import type { PendingView } from "../../src/portfolio/identity/pending.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { fakeBotApi, FAKE_BOT_TOKEN, type FakeBotApi } from "../identity-fakes.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const TOKEN = FAKE_BOT_TOKEN;
const owner = simKey("owner");
const ALL_TELEGRAM = "chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram";
const OPERATOR = { id: 555000123, first_name: "Pan", username: "pan" };
/** 12:00 in New York (EST, UTC−5, in November): outside the default quiet hours */
const NOON_ET = Date.parse("2026-11-04T17:00:00Z");
let n = 0;
const nonce = () => Date.now() + ++n;

function call(url: string, path: string, o: { body?: string; method?: string } = {}): Promise<{ status: number; text: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: o.method ?? "POST", headers: { "content-type": "application/json" } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    req.end(o.body);
  });
}

async function until(ok: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const update = (update_id: number, fields: Record<string, unknown>, from: { id: number; first_name: string; username?: string } = OPERATOR) => ({
  update_id,
  message: { message_id: update_id, from, chat: { id: from.id, type: "private" }, date: 1_762_000_000, ...fields },
});

let said: string[] = [];
let spies: Array<{ mockRestore(): void }> = [];
/** every text any fake bot was asked to send in this file, for the last test */
const everySent: string[] = [];
beforeEach(() => {
  said = [];
  const keep = (...a: unknown[]) => void said.push(a.map(String).join(" "));
  spies = [vi.spyOn(console, "log").mockImplementation(keep), vi.spyOn(console, "error").mockImplementation(keep), vi.spyOn(console, "warn").mockImplementation(keep), vi.spyOn(console, "info").mockImplementation(keep)];
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
  expect(said.join("\n")).not.toContain(TOKEN);
  expect(said.join("\n")).not.toContain(encodeURIComponent(TOKEN));
});

describe("the send route, through the account", () => {
  let bot: FakeBotApi;
  let home: string;
  let svc: PortfolioService;
  let srv: PortfolioServerHandle;
  let clock = NOON_ET;

  const btc = { symbol: "BTC/USD", name: "BTC market", kind: "spot", base: "BTC", quote: "USD", price: 60000, bid: 59990, ask: 60010, open: true, types: [], volumeUsd24h: 2e9 };
  const kraken = { id: "kraken", name: "Kraken", kind: "exchange", connectTo: "kraken", connector: "live:exchange:kraken", listings: async (q: { q?: string }) => [btc].filter((m) => !q.q || m.base.includes(q.q.toUpperCase())) } as unknown as PublicSource;

  const boot = async () => {
    svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [kraken], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, identity: { apiBase: bot.url, pollTimeoutS: 1, connectedPollTimeoutS: 1, now: () => clock } });
    await svc.restoring;
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  };
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: nonce() } as OwnerAction));
  const post = async (path: string, body: unknown) => {
    const r = await call(srv.url, path, { body: JSON.stringify(body) });
    return { status: r.status, text: r.text, ...JSON.parse(r.text) };
  };
  const send = async (body: unknown) => {
    const { status: _s, text: _t, ...rest } = await post("/api/account/identity/send", body);
    return rest;
  };
  const status = () => svc.identity!.phoneStatus();
  const routing = async (r: string, quietFrom = "23:00", quietTo = "07:00") => {
    const done = await own({ type: "setRouting", routing: r, quietFrom, quietTo } as NoNonce<OwnerAction>);
    expect(isRefusal(done)).toBe(false);
  };

  const connect = async () => {
    const salt = newSalt();
    const keyHash = keyHashOf(salt, TOKEN);
    const r = await call(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: TOKEN, keyHash, salt }) });
    expect(r.status).toBe(200);
    const p = JSON.parse(r.text).pending as PendingView;
    bot.push(update(10, { text: "/start" }));
    await until(() => svc.identity!.pending.view(p.id)?.state === "heard");
    const c = await own({ type: "connectNetwork", network: "telegram", pending: p.id, botId: String(bot.me.id), speaksAs: `@${bot.me.username}`, operatorId: String(OPERATOR.id), talksOnlyWith: "@pan", routing: ALL_TELEGRAM, keyHash, salt } as NoNonce<OwnerAction>);
    expect(isRefusal(c)).toBe(false);
    await until(() => svc.identity!.view().networks[0]?.polling === true);
  };

  beforeEach(async () => {
    clock = NOON_ET;
    bot = await fakeBotApi();
    home = mkdtempSync(join(tmpdir(), "identity-send-"));
    await boot();
    await connect();
  });
  afterEach(async () => {
    everySent.push(...bot.sent.map((s) => s.text));
    await srv.close();
    await bot.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("a reply goes to the network its text came from, as a reply, ids prefixed", async () => {
    const r = await send({ kind: "chat", text: "NVDA is 183", network: "telegram", replyTo: "telegram:41" });
    expect(r).toEqual({ ok: true, sent: ["telegram:" + String(1000 + bot.sent.length - 1)] });
    expect(bot.sent.at(-1)).toMatchObject({ chat_id: 555000123, text: "NVDA is 183", reply_parameters: { message_id: 41, allow_sending_without_reply: true } });
    // a chat with no network goes by the Chat with Gravit row, and not as a reply
    const plain = await send({ kind: "chat", text: "and AAPL is 230" });
    expect(plain.sent).toHaveLength(1);
    expect(bot.sent.at(-1)).toEqual({ chat_id: 555000123, text: "and AAPL is 230" });
  });

  it("the account picks the recipient: only the bound operator, only ticked networks", async () => {
    // the caller can give a kind, a text, a reply-to and a network — nothing that names a chat
    for (const body of [{ kind: "chat", text: "hi", chat_id: 42 }, { kind: "chat", text: "hi", to: "@someone" }, { kind: "bogus", text: "hi" }, { kind: "chat", text: 5 }, { kind: "chat", text: "hi", network: "slack" }, { kind: "chat", text: "hi", replyTo: "41" }, [1, 2]]) {
      const r = await post("/api/account/identity/send", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.ok).toBe(false);
    }
    const big = await post("/api/account/identity/send", { kind: "chat", text: "x".repeat(65_600) });
    expect(big.status).toBe(413);
    expect(bot.sent).toHaveLength(0);
    // alerts unticked: an alert is not routed, an urgent one neither (same row), and nothing is sent
    await routing("chat=telegram;alerts=;brief=telegram;cards=telegram;fills=telegram");
    expect(await send({ kind: "alert", text: "NVDA crossed 190" })).toEqual({ ok: true, held: "not routed" });
    expect(await send({ kind: "urgent", text: "NVDA crossed 200" })).toEqual({ ok: true, held: "not routed" });
    expect(bot.sent).toHaveLength(0);
    expect((await send({ kind: "brief", text: "the brief" })).sent).toHaveLength(1);
    expect(bot.sent.every((s) => s.chat_id === OPERATOR.id)).toBe(true);
    // nothing bound: nothing connected, whatever the kind
    const off = await own({ type: "disconnectNetwork", network: "telegram" } as NoNonce<OwnerAction>);
    expect(isRefusal(off)).toBe(false);
    for (const kind of ["chat", "alert", "watchdog"]) expect(await send({ kind, text: "anyone?" })).toEqual({ ok: true, held: "nothing connected" });
    expect(await send({ kind: "chat", text: "anyone?", network: "telegram", replyTo: "telegram:41" })).toEqual({ ok: true, held: "nothing connected" });
    expect(bot.sent).toHaveLength(1);
  });

  it("quiet hours hold proactive kinds, never a reply, an urgent alert or a watchdog notice", async () => {
    // 23:30 in New York: inside the default 23:00–07:00
    clock = Date.parse("2026-11-05T04:30:00Z");
    for (const kind of ["alert", "brief", "report", "card", "fill"]) expect(await send({ kind, text: `a ${kind} at night` })).toEqual({ ok: true, held: "quiet hours" });
    expect(bot.sent).toHaveLength(0);
    for (const kind of ["chat", "urgent", "watchdog"]) expect((await send({ kind, text: `a ${kind} at night` })).sent).toHaveLength(1);
    expect(bot.sent.map((s) => s.text)).toEqual(["a chat at night", "a urgent at night", "a watchdog at night"]);
    expect(status().queued).toBe(0);
    // morning: nothing held is sent later — the outbox never had it
    clock = Date.parse("2026-11-05T12:30:00Z");
    await pause(1500);
    expect(bot.sent).toHaveLength(3);
    expect((await send({ kind: "alert", text: "a morning alert" })).sent).toHaveLength(1);
    expect(bot.sent.map((s) => s.text)).toEqual(["a chat at night", "a urgent at night", "a watchdog at night", "a morning alert"]);
    // quiet hours off: an alert at 23:30 goes
    await routing(ALL_TELEGRAM, "", "");
    clock = Date.parse("2026-11-05T04:30:00Z");
    expect((await send({ kind: "alert", text: "a night alert, quiet hours off" })).sent).toHaveLength(1);
  });

  it("the watchdog goes to every connected network whatever the routing says", async () => {
    await routing("chat=;alerts=;brief=;cards=;fills=");
    for (const kind of ["chat", "alert", "urgent", "brief", "report", "card", "fill"]) expect(await send({ kind, text: "x" })).toEqual({ ok: true, held: "not routed" });
    // a reply names its network, but the Chat with Gravit row still decides nothing here: a reply goes where its text came from
    expect((await send({ kind: "chat", text: "a reply", network: "telegram", replyTo: "telegram:7" })).sent).toHaveLength(1);
    const w = await send({ kind: "watchdog", text: "the face is down" });
    expect(w.sent).toHaveLength(1);
    expect(bot.sent.map((s) => s.text)).toEqual(["a reply", "the face is down"]);
  });

  it("the account's tokens are taken out of every text it sends, beside its parts", async () => {
    const r = await send({ kind: "chat", text: `the key is ${TOKEN}, or ${encodeURIComponent(TOKEN)}, or "${JSON.stringify(TOKEN).slice(1, -1)}"` });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(bot.sent.at(-1)!.text).toBe('the key is <token>, or <token>, or "<token>"');
    // a token where a long text is cut in parts: taken out before the text is cut, so no part carries a piece of it
    const long = `${"a".repeat(3_990)}${TOKEN}${"b".repeat(100)}`;
    expect((await send({ kind: "chat", text: long })).sent.length).toBeGreaterThanOrEqual(1);
    const parts = bot.sent.slice(1).map((s) => s.text);
    expect(parts.join("")).toBe(`${"a".repeat(3_990)}<token>${"b".repeat(100)}`);
    for (const p of parts) expect(p).not.toContain(TOKEN.slice(0, 15));
    // a link to the face (its chat URL carries its own token) never goes either
    await send({ kind: "chat", text: "open http://127.0.0.1:3090/?token=abc123 or http://localhost:3090/#/trade" });
    expect(bot.sent.at(-1)!.text).toBe("open <local link> or <local link>");
    // bare addresses too: [::1] and 0.0.0.0 with a port, 127.0.0.1 with a path and no port, localhost with a port
    await send({ kind: "chat", text: "try [::1]:3090/x, 0.0.0.0:3090, 127.0.0.1/cards and localhost:3090?token=q" });
    expect(bot.sent.at(-1)!.text).toBe("try <local link>, <local link>, <local link> and <local link>");
    // the token URL-encoded with a lower-case escape
    const lower = encodeURIComponent(TOKEN).replace(/%3A/g, "%3a");
    expect(lower).not.toBe(encodeURIComponent(TOKEN));
    await send({ kind: "chat", text: `as ${lower} too` });
    expect(bot.sent.at(-1)!.text).toBe("as <token> too");
  });

  it("a send Telegram cannot take waits in the outbox and goes first, late after 2 minutes", async () => {
    bot.answer("sendMessage", 500, { ok: false, error_code: 500, description: `Internal Server Error near ${TOKEN}` });
    expect(await send({ kind: "chat", text: "first", network: "telegram", replyTo: "telegram:41" })).toEqual({ ok: true, queued: true });
    expect(status().queued).toBe(1);
    const file = join(home, "identity", "outbox.json");
    expect(existsSync(file)).toBe(true);
    const kept = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
    expect(kept).toEqual([{ t: new Date(NOON_ET).toISOString(), network: "telegram", kind: "chat", text: "first", replyTo: "telegram:41" }]);
    expect(readFileSync(file, "utf8")).not.toContain(TOKEN);
    // while the outbox holds one, a later send waits behind it
    expect(await send({ kind: "alert", text: "second" })).toEqual({ ok: true, queued: true });
    expect(status().queued).toBe(2);
    // three minutes later Telegram takes messages again: the outbox goes first, in order, each saying it is late
    clock = NOON_ET + 3 * 60_000;
    bot.answer("sendMessage", 0, {});
    const third = await send({ kind: "chat", text: "third" });
    expect(third.sent).toHaveLength(1);
    expect(bot.sent.map((s) => s.text)).toEqual(["(written 12:00 ET, sent late)\nfirst", "(written 12:00 ET, sent late)\nsecond", "third"]);
    expect(bot.sent[0]!.reply_parameters).toEqual({ message_id: 41, allow_sending_without_reply: true });
    expect(status().queued).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([]);
  });

  it("a queued alert quiet hours would hold now is dropped at flush, a queued reply still goes, an aged message is dropped", async () => {
    // 22:58 in New York: Telegram fails, an alert and a reply wait in the outbox
    clock = Date.parse("2026-11-05T03:58:00Z");
    bot.answer("sendMessage", 500, { ok: false, error_code: 500, description: "Internal" });
    expect(await send({ kind: "alert", text: "NVDA crossed 190" })).toEqual({ ok: true, queued: true });
    expect(await send({ kind: "chat", text: "a reply" })).toEqual({ ok: true, queued: true });
    // 23:20: quiet hours; Telegram is back — the alert is dropped with one line, the reply goes, late
    clock = Date.parse("2026-11-05T04:20:00Z");
    bot.answer("sendMessage", 0, {});
    await until(() => status().queued === 0, 5000);
    expect(bot.sent.map((s) => s.text)).toEqual(["(written 22:58 ET, sent late)\na reply"]);
    expect(said.filter((l) => l.includes("quiet hours hold it now"))).toHaveLength(1);
    // a reply that waited more than 12 hours is dropped, never sent
    clock = NOON_ET + 86_400_000;
    bot.answer("sendMessage", 500, { ok: false, error_code: 500, description: "Internal" });
    expect(await send({ kind: "chat", text: "stale" })).toEqual({ ok: true, queued: true });
    clock += 13 * 3_600_000;
    bot.answer("sendMessage", 0, {});
    await until(() => status().queued === 0, 5000);
    expect(bot.sent.map((s) => s.text)).not.toContain("stale");
    expect(said.filter((l) => l.includes("waited more than 12 hours"))).toHaveLength(1);
  });

  it("quiet hours read New York's summer clock (EDT)", async () => {
    // 23:30 EDT is 03:30 UTC; 22:30 EDT is 02:30 UTC
    clock = Date.parse("2026-07-15T03:30:00Z");
    expect(await send({ kind: "alert", text: "summer night" })).toEqual({ ok: true, held: "quiet hours" });
    clock = Date.parse("2026-07-15T02:30:00Z");
    expect((await send({ kind: "alert", text: "summer evening" })).sent).toHaveLength(1);
    expect(bot.sent.map((s) => s.text)).toEqual(["summer evening"]);
  });

  it("what waits in the outbox is flushed before each poll", async () => {
    bot.answer("sendMessage", 500, { ok: false, error_code: 500, description: "Internal" });
    expect(await send({ kind: "chat", text: "waiting" })).toEqual({ ok: true, queued: true });
    bot.answer("sendMessage", 0, {});
    await until(() => bot.sent.length === 1, 5000);
    expect(bot.sent[0]!.text).toBe("waiting");
    expect(status().queued).toBe(0);
  });

  it("a 403 drops the message with one line and the status reads blocked", async () => {
    bot.answer("sendMessage", 403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
    const r = await post("/api/account/identity/send", { kind: "chat", text: "are you there" });
    expect(r.status).toBe(502);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Telegram refused the message/);
    expect(status().queued).toBe(0);
    expect(status().networks[0]).toMatchObject({ network: "telegram", blocked: true });
    // one queued while Telegram does not answer, then refused outright when flushed: dropped with one line
    bot.answer("sendMessage", 500, { ok: false, error_code: 500, description: "Internal" });
    expect(await send({ kind: "chat", text: "queued" })).toEqual({ ok: true, queued: true });
    bot.answer("sendMessage", 403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
    await until(() => status().queued === 0, 5000);
    expect(said.filter((l) => l.includes("refused a queued message"))).toHaveLength(1);
    // the operator unblocks: the next send goes, and blocked is gone
    bot.answer("sendMessage", 0, {});
    expect((await send({ kind: "chat", text: "back" })).sent).toHaveLength(1);
    expect(status().networks[0]!.blocked).toBeUndefined();
    expect(bot.sent.map((s) => s.text)).toEqual(["back"]);
  });

  it("a queued message for a network disconnected is never sent to whoever connects next", async () => {
    bot.answer("sendMessage", 500, { ok: false, error_code: 500, description: "Internal" });
    expect(await send({ kind: "chat", text: "for the old binding" })).toEqual({ ok: true, queued: true });
    const off = await own({ type: "disconnectNetwork", network: "telegram" } as NoNonce<OwnerAction>);
    expect(isRefusal(off)).toBe(false);
    expect(status().queued).toBe(0);
    bot.answer("sendMessage", 0, {});
    await connect();
    await pause(1500);
    expect(bot.sent.map((s) => s.text)).not.toContain("for the old binding");
  });

  it("a paper fill reaches the phone with no desk turn", async () => {
    const r = await own({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" } as NoNonce<OwnerAction>);
    expect(isRefusal(r)).toBe(false);
    const p = await svc.account!.prepare({ type: "liveOrder", venue: "paper-1", symbol: "BTC/USD", side: "buy", orderType: "market", qty: "0.01" });
    if (isRefusal(p)) throw new Error(p.message);
    const { nonce: _n, ...rest } = p.action as Extract<OwnerAction, { type: "liveOrder" }>;
    const done = await own(rest as NoNonce<OwnerAction>);
    expect(isRefusal(done)).toBe(false);
    await until(() => bot.sent.some((s) => s.text.startsWith("Filled · ")));
    expect(bot.sent.filter((s) => s.text.startsWith("Filled · ")).map((s) => s.text)).toEqual(["Filled · Buy 0.01 BTC/USD at 60010 · Paper · Paper account"]);
    // in quiet hours the fill notice is held, like any proactive kind
    clock = Date.parse("2026-11-05T04:30:00Z");
    svc.identity!.onFill({ side: "sell", qty: 1, symbol: "X", venueName: "Paper account", paper: true });
    await pause(200);
    expect(bot.sent.filter((s) => s.text.startsWith("Filled · "))).toHaveLength(1);
  });

  it("a Guard card raised in the ledger reaches the phone as a notice, and an answered one does not", async () => {
    const ledger = (svc as unknown as { ledger: Ledger }).ledger;
    ledger.append({ kind: "card", venue: "*", intentId: "ap-1", outcome: "pending", reason: "Buy 10 NVDA · limit 183.00 · Paper · Alpaca" });
    ledger.append({ kind: "card", venue: "*", intentId: "ap-1", outcome: "approved", reason: "Buy 10 NVDA · limit 183.00 · Paper · Alpaca" });
    await until(() => bot.sent.length >= 1);
    await pause(200);
    expect(bot.sent).toEqual([{ chat_id: OPERATOR.id, text: "Your call · Buy 10 NVDA · limit 183.00 · Paper · Alpaca — waiting in Gravit" }]);
    // never throws, whatever it is handed
    expect(() => svc.identity!.onLedgerRow(null as unknown as LedgerRow)).not.toThrow();
    expect(() => svc.identity!.onFill(undefined as never)).not.toThrow();
  });
});

describe("quiet hours across New York's clock changes", () => {
  const q = { from: "23:00", to: "07:00" };
  it("on the day the clocks fall back (2026-11-01, 02:00 EDT → 01:00 EST)", () => {
    expect(quietHolds("alert", Date.parse("2026-11-01T05:30:00Z"), q)).toBe(true); // 01:30 EDT
    expect(quietHolds("alert", Date.parse("2026-11-01T06:30:00Z"), q)).toBe(true); // 01:30 EST, the hour again
    expect(quietHolds("alert", Date.parse("2026-11-01T11:30:00Z"), q)).toBe(true); // 06:30 EST (07:30 in EDT's offset)
    expect(quietHolds("alert", Date.parse("2026-11-01T12:00:00Z"), q)).toBe(false); // 07:00 EST
  });
  it("on the day the clocks spring forward (2026-03-08, 02:00 EST → 03:00 EDT)", () => {
    expect(quietHolds("alert", Date.parse("2026-03-08T07:30:00Z"), q)).toBe(true); // 03:30 EDT
    expect(quietHolds("alert", Date.parse("2026-03-08T10:59:00Z"), q)).toBe(true); // 06:59 EDT
    expect(quietHolds("alert", Date.parse("2026-03-08T11:00:00Z"), q)).toBe(false); // 07:00 EDT (06:00 in EST's offset)
    expect(quietHolds("alert", Date.parse("2026-03-09T03:00:00Z"), q)).toBe(true); // 23:00 EDT that evening
    expect(quietHolds("alert", Date.parse("2026-03-09T02:59:00Z"), q)).toBe(false); // 22:59 EDT
  });
});

describe("the account's own notices", () => {
  it("a fill notice says what filled, where, and that it is paper", () => {
    expect(fillNotice({ side: "buy", qty: 10, symbol: "NVDA", price: "183.00", venueName: "Alpaca", paper: true })).toBe("Filled · Buy 10 NVDA at 183.00 · Paper · Alpaca");
    expect(fillNotice({ side: "sell", qty: "0.5", symbol: "ETH/USD", price: 2451.3333, venueName: "Kraken" })).toBe("Filled · Sell 0.5 ETH/USD at 2451.3333 · Kraken");
    expect(fillNotice({ side: "buy", qty: 3, symbol: "AAPL", venueName: "Alpaca", paper: true })).toBe("Filled · Buy 3 AAPL · Paper · Alpaca");
  });

  it("a Guard card raised is a notice with no button and no link", () => {
    expect(cardNotice({ kind: "card", outcome: "pending", reason: "Buy 10 NVDA · limit 183.00 · Paper · Alpaca" } as LedgerRow)).toBe("Your call · Buy 10 NVDA · limit 183.00 · Paper · Alpaca — waiting in Gravit");
    expect(cardNotice({ kind: "card", outcome: "approved", reason: "x" } as LedgerRow)).toBeUndefined();
    expect(cardNotice({ kind: "order", outcome: "pending", reason: "x" } as LedgerRow)).toBeUndefined();
    expect(cardNotice({ kind: "card", outcome: "pending" } as LedgerRow)).toBeUndefined();
    const linked = cardNotice({ kind: "card", outcome: "pending", reason: "Pay 5 USDC to https://x.example/pay?id=1 · see http://127.0.0.1:3090/#/cards" } as LedgerRow)!;
    expect(linked).not.toMatch(/https?:\/\//);
    expect(linked).toBe("Your call · Pay 5 USDC to <link> · see <link> — waiting in Gravit");
  });

  /* Fix rounds 1-3: the text is defanged rather than searched for hosts - every scheme link, scheme-relative link
   * and dotted quad is <link>, and every '.' not between two digits is '·', after NFKC and the dot look-alikes.
   * The same cases as the face's card notices (face/tests/card-notice.test.ts, which also checks that the rule
   * is one text in both). */
  it("a text is defanged: no link and no host survives; prices, numbers and the card line stay", () => {
    const defanged: [string, string][] = [
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
    ["a.1.2.3.4 and .1.2.3.4", "a·<link> and ·<link>"],
    ["evil.1.2.3.4/p", "evil·<link>"],
    ["…1.2.3.4", "···<link>"],
    ["。250.10．25。25", "·<link>"],
      ["see https://x.example/pay?id=1", "see <link>"],
    ];
    const linkless = (text: string): boolean =>
      !/:\/\/|\/\/|[0-9]{1,3}(?:\.[0-9]{1,3}){3}/.test(text) && !/(?<![0-9])\.|\.(?![0-9])/.test(text);
    for (const [text, want] of defanged) {
      expect(noLinks(text)).toBe(want);
      expect(linkless(noLinks(text))).toBe(true);
    }
    for (const text of ["Buy 10 NVDA · limit 183.00 · Paper · Alpaca", "183.00", "3.5%", "1,234.56", "1.2.3.45678", "BTC/USDT", "ETH/USD at 2451.3333",
  "@gravit /status #nvda $NVDA"]) {
      expect(noLinks(text)).toBe(text);
    }
    expect(cardNotice({ kind: "card", outcome: "pending", reason: "Pay 5 USDC to evil.museum/approve" } as LedgerRow)).toBe("Your call · Pay 5 USDC to evil·museum/approve — waiting in Gravit");
    expect(fillNotice({ side: "buy", qty: 1, symbol: "BTC/USDT", price: "183.00", venueName: "evil.com" })).toBe("Filled · Buy 1 BTC/USDT at 183.00 · evil·com");
    expect(fillNotice({ side: "buy", qty: 10, symbol: "NVDA", price: "183.00", venueName: "Alpaca", paper: true })).toBe("Filled · Buy 10 NVDA at 183.00 · Paper · Alpaca");
  });

  it("the outbox keeps at most its size, the oldest dropped with one line, and reads back what it wrote", () => {
    const home = mkdtempSync(join(tmpdir(), "identity-outbox-"));
    try {
      const lines: string[] = [];
      const box = new Outbox(home, 3, (l) => lines.push(l));
      for (const text of ["a", "b", "c", "d"]) box.push({ t: new Date(NOON_ET).toISOString(), network: "telegram", text });
      expect(box.entries().map((e) => e.text)).toEqual(["b", "c", "d"]);
      expect(lines).toHaveLength(1);
      const again = new Outbox(home, 3, (l) => lines.push(l));
      expect(again.entries().map((e) => e.text)).toEqual(["b", "c", "d"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

it("no text the account sends carries a link to the face", () => {
  // every text this file's fake bots were sent, by every test above
  expect(everySent.length).toBeGreaterThan(10);
  for (const t of everySent) {
    expect(t).not.toContain("127.0.0.1");
    expect(t).not.toContain("localhost");
    expect(t).not.toContain(TOKEN);
  }
});
