/** CONNECT TELEGRAM, SHEETS 1 TO 3 (identity/bot-api.ts, pending.ts, routes.ts): the token travels once, beside the fingerprint the page
 * made, on its own route with its own body reader; the account checks it against the fingerprint, asks Telegram who the bot is (getMe),
 * holds it in memory only, and long-polls for the first private message — whose sender sheet 3 shows, and "Not me" turns into a stranger.
 * The token is in no answer and no log line. Every Bot API call goes to a fake on loopback; every token is made up. */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyHashOf, newSalt } from "../../src/portfolio/account/brain-keys.ts";
import { scriptedBrain } from "../../src/portfolio/account/desk.ts";
import { simKey } from "../../src/portfolio/account/sign.ts";
import { BotApi, BotApiError, redactorOf, splitMessage, telegramApiBase } from "../../src/portfolio/identity/bot-api.ts";
import { PENDING_MS, PendingConnections, type PendingView } from "../../src/portfolio/identity/pending.ts";
import { IDENTITY_WORDS, isIdentityTokenPath } from "../../src/portfolio/identity/routes.ts";
import { saveIdentity, loadIdentity, Strangers } from "../../src/portfolio/identity/store.ts";
import { isRefusal } from "../../src/core/errors.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { fakeBotApi, FAKE_BOT_TOKEN, OTHER_BOT_TOKEN, type FakeBotApi } from "../identity-fakes.ts";

const TOKEN = FAKE_BOT_TOKEN;
const owner = simKey("owner");

const fp = (token: string) => {
  const salt = newSalt();
  return { salt, keyHash: keyHashOf(salt, token) };
};

function send(url: string, path: string, o: { headers?: Record<string, string>; body?: string; method?: string } = {}): Promise<{ status: number; text: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: o.method ?? "POST", headers: { "content-type": "application/json", ...(o.headers ?? {}) } }, (res) => {
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

const privateText = (update_id: number, text: string, from: { id: number; first_name: string; username?: string } = { id: 555000123, first_name: "Pan", username: "pan" }) => ({
  update_id,
  message: { message_id: update_id, from, chat: { id: from.id, type: "private" }, date: 1, text },
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

describe("connect Telegram through the account: the token route and the pending connection", () => {
  let bot: FakeBotApi;
  let home: string;
  let svc: PortfolioService;
  let srv: PortfolioServerHandle;

  beforeEach(async () => {
    bot = await fakeBotApi();
    home = mkdtempSync(join(tmpdir(), "identity-pending-"));
    svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, desk: { brain: [scriptedBrain(() => null)], tickMs: 0, env: {} }, identity: { apiBase: bot.url, pollTimeoutS: 1 } });
    await svc.restoring;
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  });
  afterEach(async () => {
    await srv.close();
    await bot.close();
    rmSync(home, { recursive: true, force: true });
  });

  const begin = async (token = TOKEN) => {
    const { salt, keyHash } = fp(token);
    const r = await send(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token, keyHash, salt }) });
    return { r, pending: r.status === 200 ? (JSON.parse(r.text).pending as PendingView) : undefined };
  };
  const getView = async (id: string) => {
    const r = await send(srv.url, `/api/account/identity/pending?id=${id}`, { method: "GET" });
    return { status: r.status, body: JSON.parse(r.text) as { ok: boolean; pending?: PendingView; error?: string } };
  };

  it("a token Telegram knows becomes a pending connection; the answer names the bot, never the token", async () => {
    const { salt, keyHash } = fp(TOKEN);
    const r = await send(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: TOKEN, keyHash, salt }) });
    expect(r.status).toBe(200);
    const p = JSON.parse(r.text).pending;
    expect(p).toMatchObject({ network: "telegram", bot: { id: "777", username: "gravit_desk_bot", name: "Gravit" }, link: "https://t.me/gravit_desk_bot", qr: "", state: "waiting" });
    expect(Date.parse(p.expiresAt)).toBeGreaterThan(Date.now() + PENDING_MS - 5000);
    expect(r.text).not.toContain(TOKEN);
    const g = await getView(p.id);
    expect(g.status).toBe(200);
    expect(g.body.pending).toMatchObject({ id: p.id, state: "waiting" });
    expect(JSON.stringify(g.body)).not.toContain(TOKEN);
    expect(said.join("\n")).not.toContain(TOKEN);
  });

  it("a token Telegram refuses, a token of the wrong shape and a fingerprint that does not match are refused in fixed words, nothing kept", async () => {
    const refused = await begin(OTHER_BOT_TOKEN);
    expect(refused.r.status).toBe(409);
    expect(JSON.parse(refused.r.text)).toEqual({ ok: false, error: IDENTITY_WORDS.refusedByTelegram });
    const shape = await begin("abc");
    expect(shape.r.status).toBe(400);
    expect(JSON.parse(shape.r.text)).toEqual({ ok: false, error: IDENTITY_WORDS.tokenShape });
    const other = fp(OTHER_BOT_TOKEN);
    const mismatch = await send(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: TOKEN, keyHash: other.keyHash, salt: other.salt }) });
    expect(mismatch.status).toBe(409);
    expect(JSON.parse(mismatch.text)).toEqual({ ok: false, error: IDENTITY_WORDS.mismatch });
    for (const text of [refused.r.text, shape.r.text, mismatch.text]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(OTHER_BOT_TOKEN);
      expect(text).not.toContain("abc");
    }
    // the mismatch never reached Telegram; only the refused token's getMe did (with the fake's 401), and nothing polls
    expect(bot.calls.filter((c) => c.method === "getUpdates")).toEqual([]);
    expect(said.join("\n")).not.toContain(TOKEN);
    expect(said.join("\n")).not.toContain(OTHER_BOT_TOKEN);
  });

  it("the token route skips the JSON parser: a broken body is one fixed sentence, never logged", async () => {
    const broken = '{"token":"123:';
    const r = await send(srv.url, "/api/account/identity/telegram/token", { body: broken });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.text)).toEqual({ ok: false, error: IDENTITY_WORDS.malformed });
    // every spelling express routes to it (case, a trailing slash) is read by the route's own reader
    for (const path of ["/api/account/identity/Telegram/token", "/api/account/identity/telegram/token/"]) {
      const again = await send(srv.url, path, { body: broken });
      expect(again.status).toBe(400);
      expect(JSON.parse(again.text)).toEqual({ ok: false, error: IDENTITY_WORDS.malformed });
    }
    const extra = await send(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: TOKEN, keyHash: "x", salt: "y", more: 1 }) });
    expect(extra.status).toBe(400);
    expect(JSON.parse(extra.text)).toEqual({ ok: false, error: IDENTITY_WORDS.malformed });
    const type = await send(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: TOKEN }), headers: { "content-type": "text/plain" } });
    expect(type.status).toBe(415);
    expect(type.text).not.toContain(TOKEN);
    const large = await send(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: TOKEN, keyHash: "a".repeat(2000), salt: "" }) });
    expect(large.status).toBe(413);
    expect(large.text).not.toContain(TOKEN);
    expect(said.join("\n")).not.toContain("123:");
    expect(said.join("\n")).not.toContain(TOKEN);
    expect(isIdentityTokenPath("/API/account/identity/telegram/token//")).toBe(true);
    expect(isIdentityTokenPath("/api/account/identity/pending")).toBe(false);
  });

  it("the first private message to the bot is heard: name, handle, masked id and text", async () => {
    const { pending } = await begin();
    const id = pending!.id;
    let view: PendingView = pending!;
    bot.push(privateText(10, "/start"));
    await until(() => (view = svc.identity!.pending.view(id)!).state === "heard");
    expect(view.sender).toEqual({ name: "Pan", handle: "@pan", masked: "…123", text: "/start" });
    const g = await getView(id);
    expect(g.body.pending!.sender).toEqual({ name: "Pan", handle: "@pan", masked: "…123", text: "/start" });
    expect(JSON.stringify(g.body)).not.toContain("555000123");
    // it keeps the offset after the update it heard
    const taken = svc.identity!.pending.take(id)!;
    expect(taken).toMatchObject({ token: TOKEN, bot: { id: "777", username: "gravit_desk_bot" }, sender: { id: "555000123", handle: "@pan" }, offset: 11 });
    expect(svc.identity!.pending.view(id)).toBeUndefined();
  });

  it("a group message is not heard while pending", async () => {
    const { pending } = await begin();
    bot.push({ update_id: 20, message: { message_id: 1, from: { id: 555000123, first_name: "Pan" }, chat: { id: -1001, type: "group" }, date: 1, text: "hello all" } });
    await until(() => bot.calls.filter((c) => c.method === "getUpdates" && c.body.offset === 21).length > 0);
    expect(svc.identity!.pending.view(pending!.id)!.state).toBe("waiting");
    expect(svc.identity!.pending.view(pending!.id)!.sender).toBeUndefined();
  });

  it("Not me lists the sender as a stranger and waits again", async () => {
    const { pending } = await begin();
    const id = pending!.id;
    bot.push(privateText(30, "/start", { id: 999000456, first_name: "Someone", username: "someone" }));
    await until(() => svc.identity!.pending.view(id)!.state === "heard");
    const r = await send(srv.url, "/api/account/identity/pending/not-me", { body: JSON.stringify({ id }) });
    expect(r.status).toBe(200);
    const after = JSON.parse(r.text).pending as PendingView;
    expect(after.state).toBe("waiting");
    expect(after.sender).toBeUndefined();
    expect(svc.identity!.strangers()).toHaveLength(1);
    expect(svc.identity!.strangers()[0]).toMatchObject({ network: "telegram", masked: "…456", count: 1 });
    // the next private message is heard in its place
    bot.push(privateText(31, "/start"));
    await until(() => svc.identity!.pending.view(id)!.state === "heard");
    expect(svc.identity!.pending.view(id)!.sender!.handle).toBe("@pan");
    const gone = await send(srv.url, "/api/account/identity/pending/not-me", { body: JSON.stringify({ id: "nope" }) });
    expect(gone.status).toBe(404);
    expect(JSON.parse(gone.text)).toEqual({ ok: false, error: IDENTITY_WORDS.noPending });
  });

  it("drop forgets the token at once; a second token replaces the first pending", async () => {
    const first = (await begin()).pending!;
    const second = (await begin()).pending!;
    expect(second.id).not.toBe(first.id);
    expect(svc.identity!.pending.view(first.id)).toBeUndefined();
    expect(svc.identity!.pending.view(second.id)!.state).toBe("waiting");
    const r = await send(srv.url, "/api/account/identity/pending/drop", { body: JSON.stringify({ id: second.id }) });
    expect(r.status).toBe(200);
    expect(svc.identity!.pending.view(second.id)).toBeUndefined();
    expect(svc.identity!.pending.take(second.id)).toBeUndefined();
    const g = await getView(second.id);
    expect(g.status).toBe(404);
    expect(g.body).toEqual({ ok: false, error: IDENTITY_WORDS.noPending });
  });

  it("a 409 from getUpdates is state conflict", async () => {
    const { pending } = await begin();
    bot.answer("getUpdates", 409, { ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" });
    await until(() => svc.identity!.pending.view(pending!.id)!.state === "conflict");
    expect(said.join("\n")).not.toContain(TOKEN);
  });

  it("a connection is refused while Telegram is connected already", async () => {
    const s = loadIdentity(home);
    saveIdentity(home, { ...s, bindings: [{ network: "telegram", speaksAs: "@gravit_desk_bot", botId: "777", talksOnlyWith: "@pan", operatorId: "555000123", since: new Date().toISOString(), fingerprint: "ab12cd34" }] });
    const { r } = await begin();
    expect(r.status).toBe(409);
    expect(JSON.parse(r.text)).toEqual({ ok: false, error: IDENTITY_WORDS.connected });
    expect(bot.calls).toEqual([]);
  });
});

describe("the pending connection on its own clock", () => {
  let bot: FakeBotApi;
  let home: string;
  beforeEach(async () => {
    bot = await fakeBotApi();
    home = mkdtempSync(join(tmpdir(), "identity-pending-clock-"));
  });
  afterEach(async () => {
    await bot.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("a pending connection expires after 10 minutes and its token is dropped", async () => {
    let t = Date.parse("2026-11-04T15:00:00Z");
    const pending = new PendingConnections({ apiBase: bot.url, strangers: new Strangers(home), bound: () => false, now: () => t, pollTimeoutS: 1 });
    try {
      const { salt, keyHash } = fp(TOKEN);
      const v = await pending.begin(TOKEN, keyHash, salt);
      if (isRefusal(v)) throw new Error(v.message);
      expect(v.expiresAt).toBe(new Date(t + PENDING_MS).toISOString());
      t += PENDING_MS - 1;
      expect(pending.view(v.id)!.state).toBe("waiting");
      t += 1;
      expect(pending.view(v.id)!.state).toBe("expired");
      expect(pending.take(v.id)).toBeUndefined();
      expect(pending.notMe(v.id)!.state).toBe("expired");
    } finally {
      pending.dispose();
    }
  });

  it("a heard connection past its time is expired too, and take answers nothing", async () => {
    let t = Date.now();
    const pending = new PendingConnections({ apiBase: bot.url, strangers: new Strangers(home), bound: () => false, now: () => t, pollTimeoutS: 1 });
    try {
      const { salt, keyHash } = fp(TOKEN);
      const v = await pending.begin(TOKEN, keyHash, salt);
      if (isRefusal(v)) throw new Error(v.message);
      bot.push(privateText(5, "hi"));
      await until(() => pending.view(v.id)!.state === "heard");
      t += PENDING_MS;
      expect(pending.view(v.id)!.state).toBe("expired");
      expect(pending.view(v.id)!.sender).toBeUndefined();
      expect(pending.take(v.id)).toBeUndefined();
    } finally {
      pending.dispose();
    }
  });
});

describe("the pending connection holds no token it does not need, and says none", () => {
  let bot: FakeBotApi;
  let home: string;
  beforeEach(async () => {
    bot = await fakeBotApi();
    home = mkdtempSync(join(tmpdir(), "identity-pending-safe-"));
  });
  afterEach(async () => {
    await bot.close();
    rmSync(home, { recursive: true, force: true });
  });
  /** the test seam: the entry the connections hold now (private) */
  const held = (p: PendingConnections) => (p as unknown as { current?: { token: string; keyHash: string; salt: string; api?: unknown; sender?: unknown } }).current;

  it("an expired connection keeps no token and no Bot API client, and take answers nothing", async () => {
    let t = Date.now();
    const pending = new PendingConnections({ apiBase: bot.url, strangers: new Strangers(home), bound: () => false, now: () => t, pollTimeoutS: 1 });
    try {
      const { salt, keyHash } = fp(TOKEN);
      const v = await pending.begin(TOKEN, keyHash, salt);
      if (isRefusal(v)) throw new Error(v.message);
      expect(held(pending)!.api).toBeDefined();
      t += PENDING_MS;
      expect(pending.view(v.id)!.state).toBe("expired");
      const e = held(pending)!;
      expect(e).toMatchObject({ token: "", keyHash: "", salt: "" });
      expect(e.api).toBeUndefined();
      expect(e.sender).toBeUndefined();
      expect(JSON.stringify(e)).not.toContain(TOKEN);
      expect(pending.take(v.id)).toBeUndefined();
      pending.drop(v.id);
      expect(held(pending)).toBeUndefined();
    } finally {
      pending.dispose();
    }
  });

  it("a poll failure whose error carries the token logs no token, before expiry and after", async () => {
    const lines: string[] = [];
    let t = Date.now();
    let mode: "fail" | "hang" = "fail";
    let release: (() => void) | undefined;
    const leaky: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/getUpdates")) {
        if (mode === "fail") throw new Error(`connect refused for ${String(url)} with ${TOKEN}`);
        // held until the test lets it go, then failing with the token whatever the signal says
        await new Promise<void>((r) => (release = r));
        throw new Error(`late failure for ${String(url)}`);
      }
      return fetch(url, init);
    };
    const pending = new PendingConnections({ apiBase: bot.url, strangers: new Strangers(home), bound: () => false, now: () => t, pollTimeoutS: 1, fetch: leaky, log: (l) => void lines.push(l) });
    try {
      const { salt, keyHash } = fp(TOKEN);
      const v = await pending.begin(TOKEN, keyHash, salt);
      if (isRefusal(v)) throw new Error(v.message);
      await until(() => lines.length > 0);
      expect(lines[0]).toContain("poll failed");
      expect(lines.join("\n")).not.toContain(TOKEN);
      // a second connection whose poll is under way when it expires
      mode = "hang";
      const w = await pending.begin(TOKEN, keyHash, salt);
      if (isRefusal(w)) throw new Error(w.message);
      await until(() => release !== undefined);
      t += PENDING_MS;
      expect(pending.view(w.id)!.state).toBe("expired");
      release!();
      await new Promise((r) => setTimeout(r, 50));
      expect(lines.join("\n")).not.toContain(TOKEN);
      expect(lines.join("\n")).not.toContain(encodeURIComponent(TOKEN));
    } finally {
      pending.dispose();
    }
  });

  it("a strangers store that throws once does not stop the poll: the next private message is heard", async () => {
    const lines: string[] = [];
    let notes = 0;
    class Flaky extends Strangers {
      override note(network: "telegram", id: string, at: number): void {
        notes += 1;
        if (notes === 2) throw Object.assign(new Error(`EACCES writing for ${TOKEN}`), { code: "EACCES" });
        super.note(network, id, at);
      }
    }
    const pending = new PendingConnections({ apiBase: bot.url, strangers: new Flaky(home), bound: () => false, pollTimeoutS: 1, log: (l) => void lines.push(l) });
    try {
      const { salt, keyHash } = fp(TOKEN);
      const v = await pending.begin(TOKEN, keyHash, salt);
      if (isRefusal(v)) throw new Error(v.message);
      const someone = { id: 999000456, first_name: "Someone", username: "someone" };
      bot.push(privateText(40, "/start", someone));
      await until(() => pending.view(v.id)!.state === "heard");
      expect(pending.notMe(v.id)!.state).toBe("waiting");
      // the same stranger again: the store throws inside the poll loop
      bot.push(privateText(41, "again", someone));
      await until(() => lines.some((l) => l.includes("stranger could not be counted")));
      expect(pending.view(v.id)!.state).toBe("waiting");
      bot.push(privateText(42, "/start"));
      await until(() => pending.view(v.id)!.state === "heard");
      expect(pending.view(v.id)!.sender!.handle).toBe("@pan");
      expect(lines.join("\n")).not.toContain(TOKEN);
    } finally {
      pending.dispose();
    }
  });
});

describe("the Bot API client", () => {
  it("answers getMe, sends with a reply, and says a refusal by status and description, never the token", async () => {
    const bot = await fakeBotApi();
    try {
      const api = new BotApi({ token: TOKEN, apiBase: bot.url });
      expect(await api.getMe()).toEqual({ id: 777, username: "gravit_desk_bot", first_name: "Gravit" });
      const id = await api.sendMessage(555000123, "hello", 41);
      expect(typeof id).toBe("number");
      expect(bot.sent).toEqual([{ chat_id: 555000123, text: "hello", reply_parameters: { message_id: 41, allow_sending_without_reply: true } }]);
      bot.push(privateText(7, "x"));
      expect((await api.getUpdates(undefined, 1)).length).toBe(1);
      expect(bot.calls.find((c) => c.method === "getUpdates")!.body).toEqual({ timeout: 1, allowed_updates: ["message"] });
      const wrong = new BotApi({ token: OTHER_BOT_TOKEN, apiBase: bot.url });
      const err = await wrong.getMe().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BotApiError);
      expect((err as BotApiError).status).toBe(401);
      expect((err as BotApiError).description).toBe("Unauthorized");
      expect(String((err as Error).message)).not.toContain(OTHER_BOT_TOKEN);
      bot.answer("sendMessage", 400, { ok: false, error_code: 400, description: `Bad Request: echo ${TOKEN}` });
      const e2 = (await api.sendMessage(1, "x").catch((e: unknown) => e)) as BotApiError;
      expect(e2.status).toBe(400);
      expect(e2.description).not.toContain(TOKEN);
      expect(e2.message).not.toContain(TOKEN);
    } finally {
      await bot.close();
    }
  });

  it("a Bot API that cannot be reached is an error that never carries the token", async () => {
    const api = new BotApi({ token: TOKEN, apiBase: "http://127.0.0.1:9" });
    const err = (await api.getMe().catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BotApiError);
    expect(err.message).not.toContain(TOKEN);
  });

  it("the Bot API base takes only a loopback http override", () => {
    const lines: string[] = [];
    const log = (l: string) => void lines.push(l);
    expect(telegramApiBase({}, log)).toBe("https://api.telegram.org");
    expect(telegramApiBase({ ACCOUNT_TELEGRAM_API: "http://127.0.0.1:9999" }, log)).toBe("http://127.0.0.1:9999");
    expect(telegramApiBase({ ACCOUNT_TELEGRAM_API: "https://evil.example" }, log)).toBe("https://api.telegram.org");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("evil.example");
    for (const v of ["http://localhost:9999", "http://127.0.0.1", "http://127.0.0.1:9999/path", "http://127.0.0.1:99999", "http://127.0.0.2:9999", "http://user@127.0.0.1:9999"]) {
      expect(telegramApiBase({ ACCOUNT_TELEGRAM_API: v }, () => undefined), v).toBe("https://api.telegram.org");
    }
  });

  it("splitMessage and redactorOf keep the face's cases", () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const whole of ["😀".repeat(2_500), `a${"😀".repeat(2_500)}`, `${"b".repeat(3_999)}😀${"c".repeat(10)}`]) {
      const parts = splitMessage(whole);
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(4_000);
        expect(part).not.toMatch(lone);
      }
      expect(parts.join("")).toBe(whole);
    }
    expect(splitMessage(`a${"😀".repeat(2_500)}`)[0]!.length).toBe(3_999);
    expect(splitMessage("short")).toEqual(["short"]);
    expect(splitMessage("")).toEqual([]);
    expect(splitMessage(`${"w ".repeat(2_100)}`).map((p) => p.length)).toEqual([4_000, 200]);
    expect(splitMessage(`x\n${"z".repeat(5_000)}`).map((p) => p.length)).toEqual([4_000, 1_002]);
    expect(() => splitMessage("abc", 1)).toThrow(RangeError);

    const secret = 'key"with/a space';
    const inner = "AAInnerSecretValue";
    const redact = redactorOf([secret, `wrap-${inner}-wrap`, inner]);
    expect(redact(`plain ${secret}`)).toBe("plain <secret>");
    expect(redact(`json ${JSON.stringify(secret).slice(1, -1)}`)).toBe("json <secret>");
    expect(redact(`url ${encodeURIComponent(secret)}`)).toBe("url <secret>");
    expect(redact(`both wrap-${inner}-wrap and ${inner}`)).toBe("both <secret> and <secret>");
    expect(redactorOf([""])("nothing")).toBe("nothing");
  });
});

describe("the Bot API's address", () => {
  const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
  const walk = (dir: string): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(path));
      else out.push([relative(SRC, path), readFileSync(path, "utf8")]);
    }
    return out;
  };
  it("account/src names api.telegram.org in identity/bot-api.ts alone", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(100);
    const naming = files.filter(([, text]) => text.includes("api.telegram.org")).map(([file]) => file);
    expect(naming).toEqual([join("portfolio", "identity", "bot-api.ts")]);
  });
});

describe("without the account layer", () => {
  it("every identity route answers that the account layer is not mounted, and the service holds no identity", async () => {
    const home = mkdtempSync(join(tmpdir(), "identity-classic-"));
    const svc = await PortfolioService.create({ home, venues: "classic" });
    const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
    try {
      expect(svc.identity).toBeUndefined();
      const { salt, keyHash } = fp(TOKEN);
      for (const [path, method, body] of [["/api/account/identity/telegram/token", "POST", JSON.stringify({ token: TOKEN, keyHash, salt })], ["/api/account/identity/pending?id=x", "GET", undefined], ["/api/account/identity/pending/not-me", "POST", '{"id":"x"}'], ["/api/account/identity/pending/drop", "POST", '{"id":"x"}']] as const) {
        const r = await send(srv.url, path, { method, ...(body ? { body } : {}) });
        expect(r.status, path).toBe(404);
        expect(JSON.parse(r.text), path).toEqual({ ok: false, error: "the account layer is not mounted" });
        expect(r.text).not.toContain(TOKEN);
      }
    } finally {
      await srv.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
