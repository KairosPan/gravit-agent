/** THE CONNECTED POLLER, THE INBOX AND NOT YOU (identity/telegram.ts, identity/inbox.ts, identity/identity.ts): once connectNetwork is
 * signed, the account long-polls Telegram for the bound operator's texts and keeps them in an append-only ring the face's desk long-polls
 * at GET /api/account/identity/inbox. A text is stored before Telegram's offset moves past it; reading never changes the ring; a stranger
 * is counted, never stored and never answered. Every Bot API call goes to a fake on loopback; every token is made up. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { keyHashOf, newSalt } from "../../src/portfolio/account/brain-keys.ts";
import { scriptedBrain } from "../../src/portfolio/account/desk.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { BotApi } from "../../src/portfolio/identity/bot-api.ts";
import { INBOX_MAX, InboxRing } from "../../src/portfolio/identity/inbox.ts";
import type { PendingView } from "../../src/portfolio/identity/pending.ts";
import { senderRef, Strangers, type Binding } from "../../src/portfolio/identity/store.ts";
import { CHAT_OFF, TelegramConnector, TEXT_ONLY, type IdentityClock } from "../../src/portfolio/identity/telegram.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { fakeBotApi, FAKE_BOT_TOKEN, type FakeBotApi } from "../identity-fakes.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const TOKEN = FAKE_BOT_TOKEN;
const owner = simKey("owner");
const ALL_TELEGRAM = "chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram";
const OPERATOR = { id: 555000123, first_name: "Pan", username: "pan" };
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

/** an update holding a private message from `from` (the operator by default) */
const update = (update_id: number, fields: Record<string, unknown>, from: { id: number; first_name: string; username?: string } = OPERATOR) => ({
  update_id,
  message: { message_id: update_id, from, chat: { id: from.id, type: "private" }, date: 1_762_000_000, ...fields },
});

function walk(dir: string, root = dir): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, root));
    else out.push({ path: relative(root, p), text: readFileSync(p, "utf8") });
  }
  return out;
}

let said: string[] = [];
let spies: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  said = [];
  const keep = (...a: unknown[]) => void said.push(a.map(String).join(" "));
  spies = [vi.spyOn(console, "log").mockImplementation(keep), vi.spyOn(console, "error").mockImplementation(keep), vi.spyOn(console, "warn").mockImplementation(keep), vi.spyOn(console, "info").mockImplementation(keep)];
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
  expect(said.join("\n")).not.toContain(TOKEN);
});

describe("the connected poller and the inbox, through the account", () => {
  let bot: FakeBotApi;
  let home: string;
  let svc: PortfolioService;
  let srv: PortfolioServerHandle;

  const boot = async () => {
    svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, desk: { brain: [scriptedBrain(() => null)], tickMs: 0, env: {} }, identity: { apiBase: bot.url, pollTimeoutS: 1, connectedPollTimeoutS: 1 } });
    await svc.restoring;
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  };
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: nonce() } as OwnerAction));
  const get = async (path: string) => {
    const r = await call(srv.url, path, { method: "GET" });
    return { status: r.status, ...JSON.parse(r.text) };
  };
  const offsetFile = () => join(home, "identity", "telegram.offset");
  const offset = () => (existsSync(offsetFile()) ? readFileSync(offsetFile(), "utf8").trim() : "");

  /** Task 3's flow: the token sent with its fingerprint, the operator's /start heard as update 10, connectNetwork signed */
  const connect = async () => {
    const salt = newSalt();
    const keyHash = keyHashOf(salt, TOKEN);
    const r = await call(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: TOKEN, keyHash, salt }) });
    expect(r.status).toBe(200);
    const p = JSON.parse(r.text).pending as PendingView;
    bot.push(update(10, { text: "/start" }));
    await until(() => svc.identity!.pending.view(p.id)?.state === "heard");
    const c = await own({ type: "connectNetwork", network: "telegram", pending: p.id, botId: "777", speaksAs: "@gravit_desk_bot", operatorId: String(OPERATOR.id), talksOnlyWith: "@pan", routing: ALL_TELEGRAM, keyHash, salt } as NoNonce<OwnerAction>);
    expect(isRefusal(c)).toBe(false);
    // the start hook saved the offset after the operator's /start, and the poller is running
    expect(offset()).toBe("11");
    await until(() => svc.identity!.view().networks[0]?.polling === true);
  };

  beforeEach(async () => {
    bot = await fakeBotApi();
    home = mkdtempSync(join(tmpdir(), "identity-inbox-"));
    await boot();
    await connect();
  });
  afterEach(async () => {
    await srv.close();
    await bot.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("the operator's text is stored before the offset moves, with its network id and reply id", async () => {
    bot.push(update(20, { message_id: 41, text: "how is NVDA", reply_to_message: { message_id: 40 } }));
    const a = await get(`/api/account/identity/inbox?after=0&wait=5`);
    expect(a.messages).toEqual([{ id: 1, network: "telegram", messageId: "telegram:41", replyTo: "telegram:40", text: "how is NVDA", at: expect.any(String) }]);
    await until(() => offset() === "21");
    expect(readFileSync(join(home, "identity", "telegram.offset"), "utf8").trim()).toBe("21");
    expect(a.last).toBe(1);
    expect(a.status).toMatchObject({ networks: [{ network: "telegram", polling: true }], queued: 0, strangers: 0 });
    // the /start the operator was heard by is not in the inbox
    expect(a.messages.map((m: { text: string }) => m.text)).not.toContain("/start");
  });

  it("an inbox that cannot be written keeps the offset where it was, and the text lands once it can", async () => {
    // a planted link at inbox.json: the write is refused, nothing is written through it
    mkdirSync(join(home, "identity"), { recursive: true });
    const elsewhere = join(home, "elsewhere.json");
    writeFileSync(elsewhere, "untouched");
    symlinkSync(elsewhere, join(home, "identity", "inbox.json"));
    bot.push(update(30, { text: "hold this" }));
    await until(() => said.some((l) => l.includes("could not be stored in the inbox")));
    expect(offset()).toBe("11");
    expect(readFileSync(elsewhere, "utf8")).toBe("untouched");
    unlinkSync(join(home, "identity", "inbox.json"));
    // the poller backs off 5 s and reads it again from Telegram
    await until(() => offset() === "31", 9000);
    const a = await get(`/api/account/identity/inbox?after=0&wait=0`);
    expect(a.messages.map((m: { text: string }) => m.text)).toEqual(["hold this"]);
  }, 15_000);

  it("reading the inbox changes nothing: the same after answers the same messages", async () => {
    bot.push(update(20, { text: "one" }));
    bot.push(update(21, { text: "two" }));
    await until(() => offset() === "22");
    const file = join(home, "identity", "inbox.json");
    const before = { text: readFileSync(file, "utf8"), mtime: statSync(file).mtimeMs };
    const a = await get(`/api/account/identity/inbox?after=0&wait=0`);
    const b = await get(`/api/account/identity/inbox?after=0&wait=0`);
    const c = await get(`/api/account/identity/inbox?after=1&wait=0`);
    expect(a.messages.map((m: { text: string }) => m.text)).toEqual(["one", "two"]);
    expect(b.messages).toEqual(a.messages);
    expect(c.messages.map((m: { id: number }) => m.id)).toEqual([2]);
    expect(readFileSync(file, "utf8")).toBe(before.text);
    expect(statSync(file).mtimeMs).toBe(before.mtime);
  });

  it("ids keep growing across a restart of the account", async () => {
    bot.push(update(20, { text: "before" }));
    await until(() => offset() === "21");
    await srv.close();
    await boot();
    // the poller starts again at service creation, from the offset kept
    await until(() => svc.identity!.view().networks[0]?.polling === true);
    bot.push(update(21, { text: "after" }));
    const a = await get(`/api/account/identity/inbox?after=1&wait=5`);
    expect(a.messages).toEqual([expect.objectContaining({ id: 2, text: "after", messageId: "telegram:21" })]);
    expect((await get(`/api/account/identity/inbox?after=0&wait=0`)).messages.map((m: { text: string }) => m.text)).toEqual(["before", "after"]);
  });

  it("a stranger is counted, never stored, never answered", async () => {
    const stranger = { id: 999, first_name: "Mallory", username: "mallory" };
    bot.push(update(20, { text: "a stranger's secret words" }, stranger));
    await until(() => offset() === "21");
    const a = await get(`/api/account/identity/inbox?after=0&wait=0`);
    expect(a.messages).toEqual([]);
    expect(a.status.strangers).toBe(1);
    expect(bot.sent.filter((s) => s.chat_id === 999)).toEqual([]);
    const v = svc.identity!.view();
    expect(v.strangers[0]).toMatchObject({ network: "telegram", sender: senderRef("telegram", "999"), masked: "…999", count: 1 });
    for (const f of walk(home)) {
      expect(f.text).not.toContain("a stranger's secret words");
      expect(f.text).not.toContain("mallory");
      expect(f.text).not.toContain("Mallory");
    }
  });

  it("a blocked sender is dropped and not counted", async () => {
    const stranger = { id: 999, first_name: "Mallory" };
    bot.push(update(20, { text: "hi" }, stranger));
    await until(() => offset() === "21");
    const ref = senderRef("telegram", "999");
    const b = await own({ type: "blockSender", network: "telegram", sender: ref, masked: "…999" } as NoNonce<OwnerAction>);
    expect(isRefusal(b)).toBe(false);
    expect(svc.identity!.view().strangers).toEqual([]);
    bot.push(update(21, { text: "hi again" }, stranger));
    bot.push(update(22, { text: "still here" }, stranger));
    await until(() => offset() === "23");
    expect(svc.identity!.view().strangers).toEqual([]);
    expect((await get(`/api/account/identity/inbox?after=0&wait=0`)).messages).toEqual([]);
    expect(bot.sent.filter((s) => s.chat_id === 999)).toEqual([]);
  });

  it("a group, an edited message and a channel post are dropped; the operator's photo gets 'text only, please'", async () => {
    bot.push({ update_id: 20, message: { message_id: 50, from: OPERATOR, chat: { id: -100, type: "group" }, date: 1, text: "in a group" } });
    bot.push({ update_id: 21, edited_message: { message_id: 51, from: OPERATOR, chat: { id: OPERATOR.id, type: "private" }, date: 1, text: "edited" } });
    bot.push({ update_id: 22, channel_post: { message_id: 52, chat: { id: -200, type: "channel" }, date: 1, text: "posted" } });
    bot.push(update(23, { photo: [{ file_id: "x", width: 1, height: 1 }] }));
    await until(() => offset() === "24");
    expect((await get(`/api/account/identity/inbox?after=0&wait=0`)).messages).toEqual([]);
    expect(bot.sent).toEqual([{ chat_id: OPERATOR.id, text: TEXT_ONLY }]);
    expect(TEXT_ONLY).toBe("text only, please");
    expect(svc.identity!.view().strangers).toEqual([]);
  });

  it("Chat with Gravit off for Telegram: the text is answered with the line and not stored", async () => {
    const r = await own({ type: "setRouting", routing: "chat=;alerts=telegram;brief=telegram;cards=telegram;fills=telegram", quietFrom: "", quietTo: "" } as NoNonce<OwnerAction>);
    expect(isRefusal(r)).toBe(false);
    bot.push(update(20, { text: "are you there" }));
    await until(() => offset() === "21");
    expect(bot.sent.at(-1)?.text).toBe("Chat with Gravit is off on Telegram: Account › Identity turns it on.");
    expect(CHAT_OFF).toBe(bot.sent.at(-1)?.text);
    expect((await get(`/api/account/identity/inbox?after=0&wait=0`)).messages).toEqual([]);
    expect(existsSync(join(home, "identity", "inbox.json")) ? readFileSync(join(home, "identity", "inbox.json"), "utf8") : "").not.toContain("are you there");
  });

  it("the inbox long poll answers as soon as a message lands, and at its wait with none", async () => {
    const t0 = Date.now();
    const empty = await get(`/api/account/identity/inbox?after=0&wait=1`);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(empty).toMatchObject({ ok: true, messages: [], last: 0 });
    const t1 = Date.now();
    const waiting = get(`/api/account/identity/inbox?after=0&wait=20`);
    setTimeout(() => bot.push(update(20, { text: "now" })), 200);
    const a = await waiting;
    expect(Date.now() - t1).toBeLessThan(5000);
    expect(a.messages.map((m: { text: string }) => m.text)).toEqual(["now"]);
    // a cursor past the last answers at once, so a face ahead of a fresh home's ring sees `last` without waiting
    const t2 = Date.now();
    const ahead = await get(`/api/account/identity/inbox?after=7&wait=20`);
    expect(Date.now() - t2).toBeLessThan(1000);
    expect(ahead).toMatchObject({ messages: [], last: 1 });
    // wait past 25 s, or a cursor that is not a whole number, is refused
    for (const q of ["after=0&wait=26", "after=-1&wait=0", "after=x", "after=0&wait=1.5"]) expect((await get(`/api/account/identity/inbox?${q}`)).status).toBe(400);
  });

  it("disconnect stops the poller and saves the state before it removes the token file", async () => {
    const r = await own({ type: "disconnectNetwork", network: "telegram" } as NoNonce<OwnerAction>);
    expect(isRefusal(r)).toBe(false);
    expect(svc.identity!.view().networks).toEqual([]);
    expect(existsSync(join(home, "credentials", "networks", "telegram.json"))).toBe(false);
    // a poll that was on the wire when it stopped may still land at the fake: counted after a moment, nothing more comes
    await new Promise((res) => setTimeout(res, 200));
    const polls = bot.calls.filter((c) => c.method === "getUpdates").length;
    await new Promise((res) => setTimeout(res, 1500));
    expect(bot.calls.filter((c) => c.method === "getUpdates").length).toBe(polls);
    expect((await get(`/api/account/identity/inbox?after=0&wait=0`)).status.networks).toEqual([]);
  });

  it("a disconnect whose state cannot be written changes nothing: the poller runs and the token file stays", async () => {
    // a link at identity/state.json: saveIdentity refuses it
    const state = join(home, "identity", "state.json");
    const copy = join(home, "state-copy.json");
    writeFileSync(copy, readFileSync(state));
    unlinkSync(state);
    symlinkSync(copy, state);
    const r = await own({ type: "disconnectNetwork", network: "telegram" } as NoNonce<OwnerAction>);
    expect(isRefusal(r)).toBe(true);
    expect(existsSync(join(home, "credentials", "networks", "telegram.json"))).toBe(true);
    expect(svc.identity!.view().networks[0]?.polling).toBe(true);
  });
});

describe("the ring", () => {
  it("the ring keeps the last 500", () => {
    const home = mkdtempSync(join(tmpdir(), "identity-ring-"));
    try {
      const ring = new InboxRing(home);
      for (let i = 1; i <= INBOX_MAX + 1; i++) ring.append({ network: "telegram", messageId: `telegram:${i}`, text: `m${i}`, at: new Date(0).toISOString() });
      const all = ring.after(0);
      expect(INBOX_MAX).toBe(500);
      expect(all).toHaveLength(500);
      expect(all[0]!.id).toBe(2);
      expect(ring.last()).toBe(501);
      // a network id already in the ring is not kept twice
      expect(ring.append({ network: "telegram", messageId: "telegram:501", text: "again", at: new Date(0).toISOString() }).id).toBe(501);
      expect(ring.last()).toBe(501);
      // and a fresh ring on the same home reads the same, numbering on
      const again = new InboxRing(home);
      expect(again.after(0)).toEqual(all);
      expect(again.append({ network: "telegram", messageId: "telegram:502", text: "m502", at: new Date(0).toISOString() }).id).toBe(502);
      expect(JSON.parse(readFileSync(join(home, "identity", "inbox.json"), "utf8"))).toMatchObject({ next: 503 });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("a link at identity/ is refused: nothing is written through it", () => {
    const home = mkdtempSync(join(tmpdir(), "identity-ring-"));
    const elsewhere = mkdtempSync(join(tmpdir(), "identity-elsewhere-"));
    try {
      symlinkSync(elsewhere, join(home, "identity"));
      const ring = new InboxRing(home);
      expect(() => ring.append({ network: "telegram", messageId: "telegram:1", text: "x", at: new Date(0).toISOString() })).toThrow(/link/);
      expect(readdirSync(elsewhere)).toEqual([]);
      expect(ring.last()).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe("the poller's failures", () => {
  /** a clock whose timers fire at once, moving `now` by what they waited — so the loop's waits are read off `waits` */
  function fastClock(): IdentityClock & { waits: number[] } {
    let now = Date.parse("2026-11-04T15:00:00Z");
    const waits: number[] = [];
    return {
      waits,
      now: () => now,
      setTimeout: (fn, ms) => {
        if (ms !== 2000) waits.push(ms);
        const t = setTimeout(() => {
          now += ms;
          fn();
        }, 5);
        return t;
      },
      clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
    };
  }

  it("a 409 is recorded as conflict and backed off; any other failure backs off 5 s doubling to 60 s", async () => {
    const bot = await fakeBotApi();
    const home = mkdtempSync(join(tmpdir(), "identity-poll-"));
    const lines: string[] = [];
    const clock = fastClock();
    const stop = new AbortController();
    const binding: Binding = { network: "telegram", speaksAs: "@gravit_desk_bot", botId: "777", talksOnlyWith: "@pan", operatorId: String(OPERATOR.id), since: new Date(0).toISOString(), fingerprint: "01234567" };
    const c = new TelegramConnector({ home, api: new BotApi({ token: TOKEN, apiBase: bot.url, signal: stop.signal }), binding, inbox: new InboxRing(home), strangers: new Strangers(home), blocked: () => [], chatOn: () => true, reply: async () => {}, offset: undefined, clock, log: (l) => lines.push(l), pollTimeoutS: 1 });
    try {
      bot.answer("getUpdates", 500, { ok: false, error_code: 500, description: `Internal Server Error near /bot${TOKEN}/getUpdates` });
      c.start();
      await until(() => clock.waits.length >= 7);
      expect(clock.waits.slice(0, 7)).toEqual([5000, 10000, 20000, 40000, 60000, 60000, 60000]);
      expect(c.status()).toMatchObject({ network: "telegram", polling: true, pollFailing: { since: expect.any(String), reason: expect.stringContaining("500") } });
      // said at most once a minute on the clock: fewer lines than failures
      const failLines = lines.filter((l) => l.includes("the Telegram poll failed"));
      expect(failLines.length).toBeGreaterThanOrEqual(1);
      expect(failLines.length).toBeLessThan(clock.waits.length);
      bot.answer("getUpdates", 409, { ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" });
      const from = clock.waits.length;
      await until(() => clock.waits.slice(from).includes(30_000));
      expect(c.status().conflictAt).toEqual(expect.any(String));
      expect(lines.some((l) => l.includes("409"))).toBe(true);
      // a poll that answers clears the failure and the conflict
      bot.answer("getUpdates", 0, {});
      await until(() => c.status().pollFailing === undefined && c.status().lastPollAt !== undefined);
      expect(c.status().conflictAt).toBeUndefined();
      expect(lines.join("\n")).not.toContain(TOKEN);
      expect(JSON.stringify(c.status())).not.toContain(TOKEN);
    } finally {
      stop.abort();
      await c.dispose();
      expect(c.status().polling).toBe(false);
      await bot.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
