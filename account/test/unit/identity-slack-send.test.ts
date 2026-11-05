/** SENDING ON SLACK (identity/slack.ts SlackTransport, identity.ts): once Slack is connected, POST /api/account/identity/send reaches the
 * bound DM through chat.postMessage — top level (no thread_ts), escaped (`&`, `<`, `>`), plain (mrkdwn off) and unfurled nowhere, with the
 * account's tokens and every Slack token shape taken out, ids `slack:<ts>`. Routing, quiet hours, the watchdog, the outbox and the
 * notices are B1's, as on Telegram; Slack's failures read by ruling 10 (a 429 or a network failure waits, channel_not_found is dropped,
 * token_revoked reads pollFailing). Every Web API call and every socket goes to the fake Slack on loopback; every token is made up and
 * built at runtime (slackTokens). */
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ledger } from "../../src/agent/ledger.ts";
import { isRefusal } from "../../src/core/errors.ts";
import { keyHashOf, newSalt } from "../../src/portfolio/account/brain-keys.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import type { PendingView } from "../../src/portfolio/identity/pending.ts";
import { SlackTransport } from "../../src/portfolio/identity/slack.ts";
import { SLACK_FLUSH_MS } from "../../src/portfolio/identity/identity.ts";
import { SlackApi, SlackApiError } from "../../src/portfolio/identity/slack-api.ts";
import type { IdentityClock } from "../../src/portfolio/identity/telegram.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { fakeBotApi, fakeSlack, FAKE_BOT_TOKEN, slackTokens, type FakeBotApi, type FakeSlack } from "../identity-fakes.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const owner = simKey("owner");
const ALL_SLACK = "chat=slack;alerts=slack;brief=slack;cards=slack;fills=slack";
const ALL_TELEGRAM = "chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram";
const OP = "U0PAN07QK";
const DM = "D0FAKEDM1";
const HEARD_TS = "1730811000.000100";
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

async function until(ok: () => boolean, ms = 5000, what = "the condition"): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** a clock whose waits of SLACK_FLUSH_MS or longer are held until a test fires them (only those armed after a mark, so a socket's own
 * 30 s timers armed before it stay put); shorter waits fire at once, moving `now` by what they waited */
function heldClock(start: number): IdentityClock & { mark(): number; armedSince(mark: number): number[]; fireSince(mark: number, ms: number): number } {
  let offset = 0;
  let seq = 0;
  const held = new Map<object, { seq: number; ms: number; fn: () => void }>();
  return {
    now: () => start + offset,
    setTimeout: (fn, ms) => {
      if (ms >= SLACK_FLUSH_MS) {
        const h = {};
        held.set(h, { seq: ++seq, ms, fn });
        return h;
      }
      const t = setTimeout(() => {
        offset += ms;
        fn();
      }, 5);
      t.unref();
      return t;
    },
    clearTimeout: (h) => {
      if (h !== null && typeof h === "object" && held.has(h)) held.delete(h);
      else clearTimeout(h as NodeJS.Timeout);
    },
    mark: () => seq,
    armedSince: (mark) => [...held.values()].filter((v) => v.seq > mark).map((v) => v.ms),
    fireSince(mark, ms) {
      const due = [...held.entries()].filter(([, v]) => v.seq > mark && v.ms === ms);
      for (const [h] of due) held.delete(h);
      offset += ms;
      for (const [, v] of due) v.fn();
      return due.length;
    },
  };
}

let envelopes = 0;
const dm = (o: { user?: string; text?: string; ts?: string } = {}) => ({
  envelope_id: `env-${++envelopes}`,
  type: "events_api",
  accepts_response_payload: false,
  retry_attempt: 0,
  retry_reason: "",
  payload: {
    team_id: "T0FAKE001",
    api_app_id: "A0FAKE001",
    type: "event_callback",
    event_id: `Ev${envelopes}`,
    event: { type: "message", channel: DM, channel_type: "im", ts: o.ts ?? `${1730812000 + envelopes}.000200`, user: o.user ?? OP, text: o.text ?? "hi" },
  },
});

let said: string[] = [];
let spies: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  said = [];
  const keep = (...a: unknown[]) => void said.push(a.map(String).join(" "));
  spies = [vi.spyOn(console, "log").mockImplementation(keep), vi.spyOn(console, "error").mockImplementation(keep), vi.spyOn(console, "warn").mockImplementation(keep), vi.spyOn(console, "info").mockImplementation(keep)];
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
});

describe("SlackTransport", () => {
  const t = new SlackTransport({ api: new SlackApi({ token: "made-up", apiBase: "http://127.0.0.1:9/api" }), channel: DM, secrets: ["a", "b"] });

  it("parts of 4,000 code units, its own secrets, no blocked verdict", () => {
    expect(t.network).toBe("slack");
    expect(t.partMax).toBe(4_000);
    expect(t.secrets).toEqual(["a", "b"]);
  });

  it("reads Slack's failures by ruling 10", () => {
    for (const code of ["ratelimited", "service_unavailable", "request_timeout", "fatal_error"]) expect(t.classify(new SlackApiError(200, code)), code).toBe("retry");
    expect(t.classify(new SlackApiError(429, "http_429", 3))).toBe("retry");
    expect(t.classify(new SlackApiError(503, "http_503"))).toBe("retry");
    for (const code of ["invalid_auth", "token_revoked", "account_inactive", "not_authed"]) expect(t.classify(new SlackApiError(200, code)), code).toBe("auth");
    for (const code of ["channel_not_found", "msg_too_long", "cannot_dm_bot", "not_in_channel"]) expect(t.classify(new SlackApiError(200, code)), code).toBe("refused");
    // a network failure or the deadline: not a SlackApiError, sent again later
    expect(t.classify(new Error("fetch failed (ECONNREFUSED)"))).toBe("retry");
    expect(t.classify(new Error("no answer in 15 s"))).toBe("retry");
    expect(t.classify("odd")).toBe("retry");
  });
});

describe("sending on Slack, through the account", () => {
  let slack: FakeSlack;
  let bot: FakeBotApi;
  let home: string;
  let svc: PortfolioService;
  let srv: PortfolioServerHandle;
  let clock = NOON_ET;
  /** the identity's clock, when a test injects one before a reboot */
  let idClock: IdentityClock | undefined;
  /** chat.postMessage fails as a network failure would while set */
  let netDown = false;

  const fetchVia: typeof fetch = (input, init) => {
    if (netDown && String(input).endsWith("/chat.postMessage")) return Promise.reject(new TypeError("fetch failed"));
    return fetch(input, init);
  };
  const boot = async () => {
    svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, identity: { apiBase: bot.url, slackApiBase: slack.url, fetch: fetchVia, pollTimeoutS: 1, connectedPollTimeoutS: 1, now: () => clock, ...(idClock ? { clock: idClock } : {}) } });
    await svc.restoring;
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  };
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: nonce() } as OwnerAction));
  const post = async (path: string, body: unknown) => {
    const r = await call(srv.url, path, { body: JSON.stringify(body) });
    return { status: r.status, ...JSON.parse(r.text) };
  };
  const send = async (body: unknown) => {
    const { status: _s, ...rest } = await post("/api/account/identity/send", body);
    return rest;
  };
  const status = () => svc.identity!.phoneStatus();
  const slackStatus = () => status().networks.find((x) => x.network === "slack")!;
  const texts = () => slack.posted.map((p) => p.text);
  const routing = async (r: string, quietFrom = "23:00", quietTo = "07:00") => {
    const done = await own({ type: "setRouting", routing: r, quietFrom, quietTo } as NoNonce<OwnerAction>);
    expect(isRefusal(done)).toBe(false);
  };

  const connectSlack = async (r = ALL_SLACK) => {
    const salt = newSalt();
    const keyHash = keyHashOf(salt, `${slack.tokens.app}\u0000${slack.tokens.bot}`);
    const res = await call(srv.url, "/api/account/identity/slack/token", { body: JSON.stringify({ appToken: slack.tokens.app, botToken: slack.tokens.bot, keyHash, salt }) });
    expect(res.status).toBe(200);
    const p = JSON.parse(res.text).pending as PendingView;
    slack.push(dm({ text: "hi", ts: HEARD_TS }));
    await until(() => svc.identity!.pending.view(p.id)?.state === "heard", 5000, "heard");
    await until(() => slack.sockets() === 0, 5000, "the pending socket closed");
    const c = await own({ type: "connectNetwork", network: "slack", pending: p.id, botId: "T0FAKE001:U0BOT0001", speaksAs: "@gravit", operatorId: `T0FAKE001:${OP}`, talksOnlyWith: "@pan", routing: r, keyHash, salt } as NoNonce<OwnerAction>);
    expect(isRefusal(c)).toBe(false);
    await until(() => slackStatus()?.polling === true, 5000, "the connector's hello");
  };
  const connectTelegram = async (r: string) => {
    const salt = newSalt();
    const keyHash = keyHashOf(salt, FAKE_BOT_TOKEN);
    const res = await call(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: FAKE_BOT_TOKEN, keyHash, salt }) });
    expect(res.status).toBe(200);
    const p = JSON.parse(res.text).pending as PendingView;
    bot.push({ update_id: 10, message: { message_id: 10, from: OPERATOR, chat: { id: OPERATOR.id, type: "private" }, date: 1_762_000_000, text: "/start" } });
    await until(() => svc.identity!.pending.view(p.id)?.state === "heard", 5000, "telegram heard");
    const c = await own({ type: "connectNetwork", network: "telegram", pending: p.id, botId: String(bot.me.id), speaksAs: `@${bot.me.username}`, operatorId: String(OPERATOR.id), talksOnlyWith: "@pan", routing: r, keyHash, salt } as NoNonce<OwnerAction>);
    expect(isRefusal(c)).toBe(false);
    await until(() => status().networks.find((x) => x.network === "telegram")?.polling === true, 5000, "telegram polling");
  };

  beforeEach(async () => {
    clock = NOON_ET;
    idClock = undefined;
    netDown = false;
    slack = await fakeSlack();
    slack.users.set(OP, { name: "pan", displayName: "Pan", realName: "Pan Zhe" });
    bot = await fakeBotApi();
    home = mkdtempSync(join(tmpdir(), "identity-slack-send-"));
    await boot();
    await connectSlack();
  });
  afterEach(async () => {
    await srv.close();
    await slack.close();
    await bot.close();
    const all = said.join("\n");
    for (const t of [slack.tokens.app, slack.tokens.bot, FAKE_BOT_TOKEN]) expect(all).not.toContain(t);
    rmSync(home, { recursive: true, force: true });
  });

  it("a reply to a Slack text goes to Slack's DM, top level, ids prefixed", async () => {
    const r = await send({ kind: "chat", text: "NVDA is 183", network: "slack", replyTo: "slack:1730812345.001200" });
    expect(r).toEqual({ ok: true, sent: [`slack:${slack.posted.at(-1)!.ts}`] });
    expect(slack.posted.at(-1)).toMatchObject({ channel: DM, text: "NVDA is 183", mrkdwn: "false", unfurl_links: "false", unfurl_media: "false" });
    expect(slack.posted.at(-1)!.thread_ts).toBeUndefined();
    // the bot token, never the app-level token, and never in the URL
    const c = slack.calls.filter((x) => x.method === "chat.postMessage").at(-1)!;
    expect(c.authorization).toBe(`Bearer ${slack.tokens.bot}`);
    expect(c.url).toBe("/api/chat.postMessage");
    // a chat with no network goes by the Chat with Gravit row
    const plain = await send({ kind: "chat", text: "and AAPL is 230" });
    expect(plain).toEqual({ ok: true, sent: [`slack:${slack.posted.at(-1)!.ts}`] });
    // a long text in parts of at most 4,000 before escaping, each its own id
    const long = await send({ kind: "chat", text: `${"a".repeat(3_999)} ${"b".repeat(100)}` });
    expect(long.sent).toHaveLength(2);
    for (const p of slack.posted.slice(-2)) expect(p.text.length).toBeLessThanOrEqual(4_000);
    expect(slack.posted.slice(-2).map((p) => p.text).join("").replace(/\s/g, "")).toBe(`${"a".repeat(3_999)}${"b".repeat(100)}`);
  });

  it("what is sent is escaped, plain and unfurled nowhere", async () => {
    const r = await send({ kind: "chat", text: "<!channel> <https://evil.example|ok> *bold* a & b" });
    expect(r.ok).toBe(true);
    expect(slack.posted.at(-1)).toMatchObject({ text: "&lt;!channel&gt; &lt;https://evil.example|ok&gt; *bold* a &amp; b", mrkdwn: "false", unfurl_links: "false", unfurl_media: "false" });
    // and a link to the face never goes, on Slack as on Telegram
    await send({ kind: "chat", text: "open http://127.0.0.1:3090/?token=abc" });
    expect(slack.posted.at(-1)!.text).toBe("open &lt;local link&gt;");
  });

  it("every Slack token shape is taken out of what is sent and what is logged", async () => {
    const more = slackTokens();
    await send({ kind: "chat", text: `bot ${slack.tokens.bot} app ${slack.tokens.app} user ${more.user} refresh ${more.refresh}` });
    const out = slack.posted.at(-1)!.text;
    expect(out).toBe("bot &lt;token&gt; app &lt;token&gt; user &lt;token&gt; refresh &lt;token&gt;");
    for (const t of [slack.tokens.bot, slack.tokens.app, more.user, more.refresh]) expect(out).not.toContain(t);
    // a SlackApiError whose code carries tokens - Slack's own shapes and Telegram's token, which Slack's client does not know - is logged
    // with none of them
    await connectTelegram(`${ALL_TELEGRAM.replace("chat=telegram", "chat=slack,telegram")}`);
    slack.answer("chat.postMessage", 200, { ok: false, error: `odd ${more.user} ${FAKE_BOT_TOKEN}` });
    const r = await send({ kind: "chat", text: "x", network: "slack" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(FAKE_BOT_TOKEN);
    expect(said.some((l) => l.includes("Slack refused a message"))).toBe(true);
    // a Telegram failure that carries Slack's tokens: the identity's own lines take them out too
    bot.answer("sendMessage", 400, { ok: false, error_code: 400, description: `Bad Request: ${slack.tokens.bot} ${more.refresh}` });
    const t = await send({ kind: "chat", text: "y", network: "telegram" });
    expect(t.ok).toBe(false);
    expect(said.some((l) => l.includes("Telegram refused a message"))).toBe(true);
    const all = said.join("\n");
    for (const tok of [slack.tokens.bot, slack.tokens.app, more.user, more.refresh, FAKE_BOT_TOKEN]) expect(all).not.toContain(tok);
  });

  it("with both networks connected, alerts go to each ticked network and a reply only to its own", async () => {
    await connectTelegram("chat=slack,telegram;alerts=slack,telegram;brief=telegram;cards=slack;fills=slack,telegram");
    const alert = await send({ kind: "alert", text: "NVDA crossed 190" });
    expect(alert.sent).toHaveLength(2);
    expect(alert.sent.filter((id: string) => id.startsWith("telegram:"))).toHaveLength(1);
    expect(alert.sent.filter((id: string) => id.startsWith("slack:"))).toHaveLength(1);
    expect((await send({ kind: "brief", text: "the brief" })).sent).toEqual([expect.stringMatching(/^telegram:/)]);
    expect((await send({ kind: "card", text: "a card" })).sent).toEqual([expect.stringMatching(/^slack:/)]);
    // a reply goes only where its text came from; its replyTo reaches only its own network
    expect((await send({ kind: "chat", text: "slack reply", network: "slack", replyTo: "slack:1730812345.001200" })).sent).toEqual([expect.stringMatching(/^slack:/)]);
    expect((await send({ kind: "chat", text: "tg reply", network: "telegram", replyTo: "telegram:41" })).sent).toEqual([expect.stringMatching(/^telegram:/)]);
    expect(bot.sent.at(-1)).toMatchObject({ text: "tg reply", reply_parameters: { message_id: 41, allow_sending_without_reply: true } });
    // a slack replyTo with no network: the chat row's networks, and Telegram is not sent it as a reply
    await send({ kind: "chat", text: "both", replyTo: "slack:1730812345.001200" });
    expect(bot.sent.at(-1)).toEqual({ chat_id: OPERATOR.id, text: "both" });
    expect(texts()).toEqual(["NVDA crossed 190", "a card", "slack reply", "both"]);
    expect(bot.sent.map((s) => s.text)).toEqual(["NVDA crossed 190", "the brief", "tg reply", "both"]);
  });

  it("quiet hours, not routed and the watchdog behave on Slack as on Telegram", async () => {
    clock = Date.parse("2026-11-05T04:30:00Z");
    for (const kind of ["alert", "brief", "report", "card", "fill"]) expect(await send({ kind, text: `a ${kind} at night` })).toEqual({ ok: true, held: "quiet hours" });
    for (const kind of ["chat", "urgent", "watchdog"]) expect((await send({ kind, text: `a ${kind} at night` })).sent).toHaveLength(1);
    expect(texts()).toEqual(["a chat at night", "a urgent at night", "a watchdog at night"]);
    clock = NOON_ET;
    await routing("chat=;alerts=;brief=;cards=;fills=");
    for (const kind of ["chat", "alert", "urgent", "brief", "report", "card", "fill"]) expect(await send({ kind, text: "x" })).toEqual({ ok: true, held: "not routed" });
    expect((await send({ kind: "chat", text: "a reply", network: "slack", replyTo: "slack:1730812345.001200" })).sent).toHaveLength(1);
    expect((await send({ kind: "watchdog", text: "the face is down" })).sent).toHaveLength(1);
    expect(texts().slice(3)).toEqual(["a reply", "the face is down"]);
    expect(status().queued).toBe(0);
  });

  it("a 429 and a network failure wait in the outbox and go first; channel_not_found is dropped; token_revoked reads pollFailing", async () => {
    // a network failure: queued
    netDown = true;
    expect(await send({ kind: "chat", text: "first", network: "slack", replyTo: "slack:1730812345.001200" })).toEqual({ ok: true, queued: true });
    expect(status().queued).toBe(1);
    expect(said.filter((l) => l.includes("could not be sent on Slack"))).toHaveLength(1);
    // a 429: the head stays, the next waits behind it
    netDown = false;
    slack.answer("chat.postMessage", 429, { ok: false, error: "ratelimited" }, { "retry-after": "30" });
    expect(await send({ kind: "alert", text: "second" })).toEqual({ ok: true, queued: true });
    expect(status().queued).toBe(2);
    // Slack takes messages again: the outbox goes first, in order
    slack.answer("chat.postMessage", 0, {});
    const third = await send({ kind: "chat", text: "third" });
    expect(third.sent).toHaveLength(1);
    expect(texts()).toEqual(["first", "second", "third"]);
    expect(slack.posted.every((p) => p.thread_ts === undefined)).toBe(true);
    expect(status().queued).toBe(0);

    // channel_not_found: refused outright, dropped with one line
    slack.answer("chat.postMessage", 200, { ok: false, error: "channel_not_found" });
    const before = said.length;
    const nf = await post("/api/account/identity/send", { kind: "chat", text: "gone" });
    expect(nf.status).toBe(502);
    expect(nf.error).toMatch(/Slack refused the message/);
    expect(status().queued).toBe(0);
    expect(said.slice(before).filter((l) => l.includes("channel_not_found"))).toHaveLength(1);
    expect(slackStatus().pollFailing).toBeUndefined();

    // token_revoked: dropped, the status reads pollFailing, one line
    slack.answer("chat.postMessage", 200, { ok: false, error: "token_revoked" });
    const at = said.length;
    const tr = await post("/api/account/identity/send", { kind: "chat", text: "revoked" });
    expect(tr.ok).toBe(false);
    expect(status().queued).toBe(0);
    expect(slackStatus().pollFailing).toEqual({ since: expect.any(String), reason: expect.stringContaining("token_revoked") });
    expect(said.slice(at).filter((l) => l.startsWith("identity:"))).toHaveLength(1);
    // and through the outbox: queued by a network failure, then token_revoked at the flush - dropped, one line
    netDown = true;
    expect(await send({ kind: "chat", text: "queued" })).toEqual({ ok: true, queued: true });
    netDown = false;
    const at2 = said.length;
    expect(await send({ kind: "chat", text: "next" })).toMatchObject({ ok: false });
    expect(status().queued).toBe(0);
    expect(said.slice(at2).filter((l) => l.includes("token_revoked"))).toHaveLength(2);
    expect(said.slice(at2).filter((l) => l.startsWith("identity:"))).toHaveLength(2);
    // a part that goes ends pollFailing
    slack.answer("chat.postMessage", 0, {});
    expect((await send({ kind: "chat", text: "back" })).sent).toHaveLength(1);
    expect(slackStatus().pollFailing).toBeUndefined();
    expect(texts()).toEqual(["first", "second", "third", "back"]);
  });

  it("a queued Slack message goes after SLACK_FLUSH_MS with no other send, and after a longer Retry-After when Slack gives one", async () => {
    await srv.close();
    const c = heldClock(NOON_ET);
    idClock = c;
    await boot();
    await until(() => slackStatus()?.polling === true, 5000, "the resumed connector's hello");
    let mark = c.mark();
    netDown = true;
    expect(await send({ kind: "chat", text: "first" })).toEqual({ ok: true, queued: true });
    netDown = false;
    expect(c.armedSince(mark)).toEqual([SLACK_FLUSH_MS]);
    await pause(50);
    expect(texts()).toEqual([]);
    expect(c.fireSince(mark, SLACK_FLUSH_MS)).toBe(1);
    await until(() => texts().includes("first"), 5000, "the flush");
    expect(status().queued).toBe(0);
    // a 429 with Retry-After 90: the flush waits 90 s, not 30
    mark = c.mark();
    slack.answer("chat.postMessage", 429, { ok: false, error: "ratelimited" }, { "retry-after": "90" });
    expect(await send({ kind: "alert", text: "second" })).toEqual({ ok: true, queued: true });
    slack.answer("chat.postMessage", 0, {});
    expect(c.armedSince(mark)).toEqual([90_000]);
    expect(c.fireSince(mark, SLACK_FLUSH_MS)).toBe(0);
    await pause(50);
    expect(texts()).toEqual(["first"]);
    expect(c.fireSince(mark, 90_000)).toBe(1);
    await until(() => texts().includes("second"), 5000, "the flush after Retry-After");
    expect(status().queued).toBe(0);
  });

  it("a Slack message queued by an earlier run goes at boot, with no other send", async () => {
    netDown = true;
    expect(await send({ kind: "chat", text: "while the net was down" })).toEqual({ ok: true, queued: true });
    await srv.close();
    netDown = false;
    await boot();
    await until(() => texts().includes("while the net was down"), 5000, "the boot flush");
    expect(status().queued).toBe(0);
    expect(slack.posted).toHaveLength(1);
  });

  it("a fill and a Guard card notice reach Slack, defanged, with no link", async () => {
    const ledger = (svc as unknown as { ledger: Ledger }).ledger;
    ledger.append({ kind: "card", venue: "*", intentId: "ap-1", outcome: "pending", reason: "Buy 10 NVDA · limit 183.00 · see https://evil.example/x or evil.example" });
    await until(() => slack.posted.length >= 1);
    svc.identity!.onFill({ side: "buy", qty: 10, symbol: "NVDA.US", price: 183, venueName: "Paper <b>&</b> broker.example", paper: true });
    await until(() => slack.posted.length >= 2);
    await pause(100);
    expect(texts()).toEqual(["Your call · Buy 10 NVDA · limit 183.00 · see &lt;link&gt; or evil·example — waiting in Gravit", "Filled · Buy 10 NVDA·US at 183 · Paper · Paper &lt;b&gt;&amp;&lt;/b&gt; broker·example"]);
    for (const t of texts()) expect(t).not.toMatch(/https?:|evil\.example|broker\.example/);
  });
});
