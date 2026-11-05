/** THE FOUR IDENTITY OWNER TYPES AT THE DOOR (identity/identity.ts, account/sign.ts, account/exchange.ts): connectNetwork signs the
 * token's fingerprint — never the token — and names the pending connection; the door's handler checks the token held since sheet 1 against
 * that fingerprint, the bot and the sender heard against what was signed, and only then writes the token file and the binding.
 * disconnectNetwork, setRouting (with quiet hours) and blockSender are ordinary owner writes. None of them an agent key can sign. Every Bot
 * API call goes to a fake on loopback; every token is made up. */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { keyHashOf, newSalt } from "../../src/portfolio/account/brain-keys.ts";
import { scriptedBrain } from "../../src/portfolio/account/desk.ts";
import { AGENT_TYPES, MONEY_TYPES, OWNER_TYPES, shownFields, signOwner, simKey, STEER_TYPES, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { keyless } from "../../src/portfolio/account/exchange.ts";
import type { PendingView } from "../../src/portfolio/identity/pending.ts";
import { IDENTITY_WORDS } from "../../src/portfolio/identity/routes.ts";
import { readNetworkSecret } from "../../src/portfolio/identity/secret-file.ts";
import { loadIdentity, senderRef, maskId } from "../../src/portfolio/identity/store.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { fakeBotApi, fakeSlack, FAKE_BOT_TOKEN, OTHER_BOT_TOKEN, slackTokens, type FakeBotApi, type FakeSlack } from "../identity-fakes.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const TOKEN = FAKE_BOT_TOKEN;
const owner = simKey("owner");
const agentKey = simKey("agent:identity-sign");
const ALL_TELEGRAM = "chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram";
const NONE = "chat=;alerts=;brief=;cards=;fills=";
let n = 0;
const nonce = () => Date.now() + ++n;

function send(url: string, path: string, o: { body?: string; method?: string } = {}): Promise<{ status: number; text: string }> {
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

const privateText = (update_id: number, text: string, from: { id: number; first_name: string; username?: string } = { id: 555000123, first_name: "Pan", username: "pan" }) => ({
  update_id,
  message: { message_id: update_id, from, chat: { id: from.id, type: "private" }, date: 1, text },
});

/** every file under the home, by its path relative to it */
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
const ledgerText = (home: string) => readdirSync(join(home, "portfolio")).filter((f) => f.endsWith(".jsonl")).map((f) => readFileSync(join(home, "portfolio", f), "utf8")).join("\n");

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

describe("the four identity types are the owner's", () => {
  it("in OWNER_TYPES, never an agent's, a money or a steering type; each signs its fields as text and a nonce", () => {
    for (const t of ["connectNetwork", "disconnectNetwork", "setRouting", "blockSender"]) {
      expect((OWNER_TYPES as readonly string[]).includes(t)).toBe(true);
      expect((AGENT_TYPES as readonly string[]).includes(t)).toBe(false);
      expect(MONEY_TYPES.has(t)).toBe(false);
      expect(STEER_TYPES.has(t)).toBe(false);
    }
    const c: OwnerAction = { type: "connectNetwork", network: "telegram", pending: "p", botId: "777", speaksAs: "@b", operatorId: "1", talksOnlyWith: "@o", routing: ALL_TELEGRAM, keyHash: "a".repeat(64), salt: "b".repeat(32), nonce: 1 };
    expect(shownFields(c).map((f) => f.name)).toEqual(["network", "pending", "botId", "speaksAs", "operatorId", "talksOnlyWith", "routing", "keyHash", "salt", "nonce"]);
    expect(shownFields({ type: "disconnectNetwork", network: "telegram", nonce: 1 }).map((f) => f.name)).toEqual(["network", "nonce"]);
    expect(shownFields({ type: "setRouting", routing: NONE, quietFrom: "", quietTo: "", nonce: 1 }).map((f) => f.name)).toEqual(["routing", "quietFrom", "quietTo", "nonce"]);
    expect(shownFields({ type: "blockSender", network: "telegram", sender: "0123456789ab", masked: "…123", nonce: 1 }).map((f) => f.name)).toEqual(["network", "sender", "masked", "nonce"]);
  });

  it("the ledger's copy of a connectNetwork keeps the fingerprint and no salt", () => {
    const a: OwnerAction = { type: "connectNetwork", network: "telegram", pending: "p", botId: "777", speaksAs: "@b", operatorId: "1", talksOnlyWith: "@o", routing: ALL_TELEGRAM, keyHash: "0123456789abcdef".repeat(4), salt: "e".repeat(32), nonce: 5 };
    expect(keyless({ action: a, nonce: 5, signature: { r: "0x1", s: "0x2", v: 27 } } as never).action).toMatchObject({ keyHash: "01234567", salt: "" });
  });
});

describe("connect, disconnect, routing and block, signed at the door", () => {
  let bot: FakeBotApi;
  let home: string;
  let svc: PortfolioService;
  let srv: PortfolioServerHandle;

  const boot = async () => {
    svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, desk: { brain: [scriptedBrain(() => null)], tickMs: 0, env: {} }, identity: { apiBase: bot.url, pollTimeoutS: 1 } });
    await svc.restoring;
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  };
  beforeEach(async () => {
    bot = await fakeBotApi();
    home = mkdtempSync(join(tmpdir(), "identity-sign-"));
    await boot();
  });
  afterEach(async () => {
    await srv.close();
    await bot.close();
    rmSync(home, { recursive: true, force: true });
  });

  const own = async (a: NoNonce<OwnerAction>, at = nonce()) => svc.exchange(await signOwner(owner, { ...a, nonce: at } as OwnerAction));
  let salt = "";
  let keyHash = "";
  let update = 100;
  /** sheets 1 to 3 through the routes: the token sent with its fingerprint, the operator's /start heard */
  const heardPending = async (from?: { id: number; first_name: string; username?: string }): Promise<PendingView> => {
    salt = newSalt();
    keyHash = keyHashOf(salt, TOKEN);
    const r = await send(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: TOKEN, keyHash, salt }) });
    expect(r.status).toBe(200);
    const p = JSON.parse(r.text).pending as PendingView;
    bot.push(privateText(++update, "/start", from));
    await until(() => svc.identity!.pending.view(p.id)?.state === "heard");
    return svc.identity!.pending.view(p.id)!;
  };
  const connectOf = (p: PendingView, over: Partial<Record<string, string>> = {}): NoNonce<OwnerAction> => ({ type: "connectNetwork", network: "telegram", pending: p.id, botId: "777", speaksAs: "@gravit_desk_bot", operatorId: "555000123", talksOnlyWith: "@pan", routing: ALL_TELEGRAM, keyHash, salt, ...over }) as NoNonce<OwnerAction>;
  const connect = async () => {
    const p = await heardPending();
    const r = await own(connectOf(p));
    expect(isRefusal(r)).toBe(false);
    return r;
  };

  it("an agent key can never sign them: refused at the door as the owner's", async () => {
    const ok = await own({ type: "approveAgent", agentAddress: agentKey.address, agentName: "Agent", validUntil: Date.now() + 86_400_000 });
    expect(isRefusal(ok)).toBe(false);
    for (const a of [{ type: "disconnectNetwork", network: "telegram" }, { type: "setRouting", routing: NONE, quietFrom: "", quietTo: "" }, { type: "blockSender", network: "telegram", sender: "0123456789ab", masked: "…123" }] as NoNonce<OwnerAction>[]) {
      const r = await svc.exchange(await signOwner(agentKey, { ...a, nonce: nonce() } as OwnerAction));
      expect(isRefusal(r) && r.code).toBe("E_ACCOUNT_OWNER_ONLY");
    }
    const p = await heardPending();
    const r = await svc.exchange(await signOwner(agentKey, { ...connectOf(p), nonce: nonce() } as OwnerAction));
    expect(isRefusal(r) && r.code).toBe("E_ACCOUNT_OWNER_ONLY");
    expect(readNetworkSecret(home, "telegram")).toBeUndefined();
    // the pending connection is still the owner's to sign
    expect(svc.identity!.pending.view(p.id)?.state).toBe("heard");
  });

  it("connect: the door checks the pending token against the signed fingerprint, then stores token and binding", async () => {
    const p = await heardPending();
    const r = await own(connectOf(p));
    expect(isRefusal(r)).toBe(false);
    expect(r).toMatchObject({ ok: true, kind: "account", summary: `Telegram connected: Gravit speaks as @gravit_desk_bot and talks only with @pan · token ${keyHash.slice(0, 8)}` });
    expect(readNetworkSecret(home, "telegram")).toEqual({ token: TOKEN, botId: "777", username: "gravit_desk_bot", operatorId: "555000123", operatorHandle: "@pan" });
    const v = svc.identity!.view();
    expect(v.networks).toHaveLength(1);
    expect(v.networks[0]).toMatchObject({ network: "telegram", speaksAs: "@gravit_desk_bot", talksOnlyWith: "@pan", fingerprint: keyHash.slice(0, 8), state: "connected", polling: true });
    expect(v.networks[0]).not.toHaveProperty("botId");
    expect(v.networks[0]).not.toHaveProperty("operatorId");
    expect(v.routing).toEqual({ chat: ["telegram"], alerts: ["telegram"], brief: ["telegram"], cards: ["telegram"], fills: ["telegram"] });
    // the pending connection is taken: gone
    expect(svc.identity!.pending.view(p.id)).toBeUndefined();
    // the view at GET /api/account/identity
    const g = await send(srv.url, "/api/account/identity", { method: "GET" });
    expect(g.status).toBe(200);
    const body = JSON.parse(g.text);
    expect(body).toMatchObject({ ok: true, networks: [{ network: "telegram", state: "connected" }], quiet: { from: "23:00", to: "07:00", zone: "America/New_York" }, strangers: [] });
    expect(g.text).not.toContain(TOKEN);
    expect(g.text).not.toContain("555000123");
    // a second connect while bound is refused, at prepare and at the door
    const pre = await svc.account!.prepare({ ...connectOf(p) });
    expect(isRefusal(pre) && pre.message).toBe(IDENTITY_WORDS.connected);
  });

  it("connect refuses a pending gone, a fingerprint of another token, a bot or a sender other than the one heard, and one past 10 minutes", async () => {
    const p = await heardPending();
    const other = newSalt();
    const tries: Array<[NoNonce<OwnerAction>, number | undefined, string | RegExp]> = [
      [connectOf(p, { keyHash: keyHashOf(other, OTHER_BOT_TOKEN), salt: other }), undefined, IDENTITY_WORDS.mismatch],
      [connectOf(p, { botId: "778" }), undefined, IDENTITY_WORDS.botMismatch],
      [connectOf(p, { speaksAs: "@another_bot" }), undefined, IDENTITY_WORDS.botMismatch],
      [connectOf(p, { operatorId: "555000124" }), undefined, IDENTITY_WORDS.senderMismatch],
      [connectOf(p, { talksOnlyWith: "@someone" }), undefined, IDENTITY_WORDS.senderMismatch],
      [connectOf(p, { pending: "f".repeat(32) }), undefined, IDENTITY_WORDS.noPending],
      [connectOf(p, { network: "imessage" }), undefined, IDENTITY_WORDS.networkUnknown],
      [connectOf(p, { routing: "chat=imessage;alerts=;brief=;cards=;fills=" }), undefined, /imessage/],
      [connectOf(p), Date.now() - 11 * 60_000, /10 minutes/],
    ];
    for (const [a, at, words] of tries) {
      const r = await own(a, at ?? nonce());
      expect(isRefusal(r)).toBe(true);
      if (isRefusal(r)) typeof words === "string" ? expect(r.message).toBe(words) : expect(r.message).toMatch(words);
      expect(existsSync(join(home, "credentials", "networks"))).toBe(false);
      expect(svc.identity!.view().networks).toEqual([]);
    }
    // the pending connection outlived every refusal: the right signature still connects
    expect(svc.identity!.pending.view(p.id)?.state).toBe("heard");
    // a pending connection dropped is gone
    await send(srv.url, "/api/account/identity/pending/drop", { body: JSON.stringify({ id: p.id }) });
    const gone = await own(connectOf(p));
    expect(isRefusal(gone) && gone.message).toBe(IDENTITY_WORDS.noPending);
    expect(existsSync(join(home, "credentials", "networks"))).toBe(false);
    expect(said.join("\n")).not.toContain(TOKEN);
  });

  it("a token pasted into a signed field is refused before the door writes its taken row", async () => {
    const p = await heardPending();
    const r = await own(connectOf(p, { talksOnlyWith: TOKEN }));
    expect(isRefusal(r) && r.message).toBe(IDENTITY_WORDS.tokenInField);
    const pre = await svc.account!.prepare({ type: "setRouting", routing: NONE, quietFrom: TOKEN, quietTo: "" });
    expect(isRefusal(pre) && pre.message).toBe(IDENTITY_WORDS.tokenInField);
    expect(ledgerText(home)).not.toContain(TOKEN);
    expect(JSON.stringify(pre)).not.toContain(TOKEN);
  });

  it("the token is in credentials/networks/telegram.json and nowhere else", async () => {
    const r = await connect();
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    const files = walk(home);
    const holding = files.filter((f) => f.text.includes(TOKEN)).map((f) => f.path);
    expect(holding).toEqual([join("credentials", "networks", "telegram.json")]);
    const ledger = ledgerText(home);
    expect(ledger).toContain(keyHash.slice(0, 8));
    expect(ledger).not.toContain(keyHash);
    expect(ledger).not.toContain(salt);
    expect(ledger).not.toContain(TOKEN);
    expect(ledger).toContain(`Telegram connected: Gravit speaks as @gravit_desk_bot and talks only with @pan · token ${keyHash.slice(0, 8)}`);
    expect(said.join("\n")).not.toContain(TOKEN);
    // the state file holds the binding with its fingerprint
    expect(loadIdentity(home).bindings).toMatchObject([{ network: "telegram", botId: "777", operatorId: "555000123", fingerprint: keyHash.slice(0, 8) }]);
  });

  it("disconnect removes the token, the binding and the network's routing ticks", async () => {
    const before = await own({ type: "disconnectNetwork", network: "telegram" });
    expect(isRefusal(before) && before.message).toBe(IDENTITY_WORDS.notConnected);
    await connect();
    const r = await own({ type: "disconnectNetwork", network: "telegram" });
    expect(isRefusal(r)).toBe(false);
    expect(readNetworkSecret(home, "telegram")).toBeUndefined();
    const v = svc.identity!.view();
    expect(v.networks).toEqual([]);
    expect(Object.values(v.routing).every((row) => row.length === 0)).toBe(true);
    expect(loadIdentity(home).bindings).toEqual([]);
    // connected again from a fresh pending connection
    const again = await own(connectOf(await heardPending()));
    expect(isRefusal(again)).toBe(false);
  });

  it("setRouting saves rows and quiet hours; refuses a network not connected, a bad time, equal times", async () => {
    const unbound = await own({ type: "setRouting", routing: ALL_TELEGRAM, quietFrom: "22:00", quietTo: "06:30" });
    expect(isRefusal(unbound) && unbound.message).toBe(IDENTITY_WORDS.routedNotConnected);
    await connect();
    const r = await own({ type: "setRouting", routing: "chat=telegram;alerts=telegram;brief=;cards=telegram;fills=", quietFrom: "22:00", quietTo: "06:30" });
    expect(isRefusal(r)).toBe(false);
    let v = svc.identity!.view();
    expect(v.routing).toEqual({ chat: ["telegram"], alerts: ["telegram"], brief: [], cards: ["telegram"], fills: [] });
    expect(v.quiet).toEqual({ from: "22:00", to: "06:30", zone: "America/New_York" });
    for (const [from, to, words] of [["25:00", "07:00", IDENTITY_WORDS.quietTime], ["7:00", "08:00", IDENTITY_WORDS.quietTime], ["08:00", "", IDENTITY_WORDS.quietTime], ["08:00", "08:00", IDENTITY_WORDS.quietEqual]] as const) {
      const bad = await own({ type: "setRouting", routing: ALL_TELEGRAM, quietFrom: from, quietTo: to });
      expect(isRefusal(bad) && bad.message).toBe(words);
    }
    const order = await own({ type: "setRouting", routing: "alerts=;chat=;brief=;cards=;fills=", quietFrom: "", quietTo: "" });
    expect(isRefusal(order) && order.message).toMatch(/order/);
    v = svc.identity!.view();
    expect(v.quiet).toEqual({ from: "22:00", to: "06:30", zone: "America/New_York" });
    // quiet hours turned off, and still off after a restart (stored as null, not as an empty pair the store would read as the default)
    const off = await own({ type: "setRouting", routing: ALL_TELEGRAM, quietFrom: "", quietTo: "" });
    expect(isRefusal(off)).toBe(false);
    expect(svc.identity!.view().quiet).toBeNull();
    expect(loadIdentity(home).quiet).toBeNull();
    await srv.close();
    await boot();
    expect(svc.identity!.view().quiet).toBeNull();
    expect(svc.identity!.view().networks).toHaveLength(1);
    expect(svc.identity!.view().routing.chat).toEqual(["telegram"]);
  });

  it("blockSender takes the stranger out of Not you and keeps the ref blocked", async () => {
    const p = await heardPending({ id: 999000456, first_name: "Someone", username: "someone" });
    const nm = await send(srv.url, "/api/account/identity/pending/not-me", { body: JSON.stringify({ id: p.id }) });
    expect(nm.status).toBe(200);
    const ref = senderRef("telegram", "999000456");
    expect(svc.identity!.view().strangers).toMatchObject([{ network: "telegram", sender: ref, masked: maskId("999000456"), count: 1 }]);
    const bad = await own({ type: "blockSender", network: "telegram", sender: "not-a-ref", masked: "…456" });
    expect(isRefusal(bad) && bad.message).toBe(IDENTITY_WORDS.blockShape);
    const r = await own({ type: "blockSender", network: "telegram", sender: ref, masked: "…456" });
    expect(isRefusal(r)).toBe(false);
    expect(svc.identity!.view().strangers).toEqual([]);
    expect(loadIdentity(home).blocked).toEqual([ref]);
    // the strangers file no longer holds them either
    const strangers = JSON.parse(readFileSync(join(home, "identity", "strangers.json"), "utf8")) as unknown[];
    expect(strangers).toEqual([]);
  });

  it("prepare shows each type's fields and refuses what the door would", async () => {
    const bad = await svc.account!.prepare({ type: "setRouting", routing: "chat=imessage;alerts=;brief=;cards=;fills=", quietFrom: "", quietTo: "" });
    expect(isRefusal(bad) && bad.message).toMatch(/imessage/);
    const shape = await svc.account!.prepare({ type: "setRouting", routing: NONE });
    expect(isRefusal(shape) && shape.message).toMatch(/quietFrom/);
    const unbound = await svc.account!.prepare({ type: "disconnectNetwork", network: "telegram" });
    expect(isRefusal(unbound) && unbound.message).toBe(IDENTITY_WORDS.notConnected);
    const p = await heardPending();
    const pre = await svc.account!.prepare({ ...connectOf(p) });
    expect(isRefusal(pre)).toBe(false);
    if (!isRefusal(pre)) {
      expect(pre.primaryType).toBe("AccountIdentity:Connect");
      expect(pre.shown.map((f) => f.name)).toEqual(["network", "pending", "botId", "speaksAs", "operatorId", "talksOnlyWith", "routing", "keyHash", "salt", "nonce"]);
      expect(JSON.stringify(pre)).not.toContain(TOKEN);
      // prepared, then signed as prepared
      const r = await svc.exchange(await signOwner(owner, pre.action));
      expect(isRefusal(r)).toBe(false);
    }
    const okRouting = await svc.account!.prepare({ type: "setRouting", routing: ALL_TELEGRAM, quietFrom: "", quietTo: "" });
    expect(!isRefusal(okRouting) && okRouting.primaryType).toBe("AccountIdentity:Routing");
    const okOff = await svc.account!.prepare({ type: "disconnectNetwork", network: "telegram" });
    expect(!isRefusal(okOff) && okOff.primaryType).toBe("AccountIdentity:Disconnect");
    const okBlock = await svc.account!.prepare({ type: "blockSender", network: "telegram", sender: "0123456789ab", masked: "…123" });
    expect(!isRefusal(okBlock) && okBlock.primaryType).toBe("AccountIdentity:Block");
  });
});

describe("connect Slack, signed at the door", () => {
  let slack: FakeSlack;
  let bot: FakeBotApi;
  let home: string;
  let svc: PortfolioService;
  let srv: PortfolioServerHandle;
  const ALL_SLACK = "chat=slack;alerts=slack;brief=slack;cards=slack;fills=slack";

  beforeEach(async () => {
    slack = await fakeSlack();
    // a display name anyone can set: the signed handle is the username
    slack.users.set("U0PAN07QK", { name: "pan", displayName: "Pan K", realName: "Pan" });
    bot = await fakeBotApi();
    home = mkdtempSync(join(tmpdir(), "identity-sign-slack-"));
    svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, desk: { brain: [scriptedBrain(() => null)], tickMs: 0, env: {} }, identity: { apiBase: bot.url, slackApiBase: slack.url, pollTimeoutS: 1 } });
    await svc.restoring;
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  });
  afterEach(async () => {
    await srv.close();
    await slack.close();
    await bot.close();
    rmSync(home, { recursive: true, force: true });
  });

  const own = async (a: NoNonce<OwnerAction>, at = nonce()) => svc.exchange(await signOwner(owner, { ...a, nonce: at } as OwnerAction));
  let salt = "";
  let keyHash = "";
  /** sheets 1 to 3 through the routes: the two tokens sent with their one fingerprint, the operator's first DM heard */
  const heardPending = async (): Promise<PendingView> => {
    salt = newSalt();
    keyHash = keyHashOf(salt, `${slack.tokens.app}\u0000${slack.tokens.bot}`);
    const r = await send(srv.url, "/api/account/identity/slack/token", { body: JSON.stringify({ appToken: slack.tokens.app, botToken: slack.tokens.bot, keyHash, salt }) });
    expect(r.status).toBe(200);
    const p = JSON.parse(r.text).pending as PendingView;
    slack.push({ envelope_id: "env-hi", type: "events_api", retry_attempt: 0, payload: { team_id: "T0FAKE001", api_app_id: "A0FAKE001", type: "event_callback", event: { type: "message", channel: "D0FAKEDM1", channel_type: "im", user: "U0PAN07QK", text: "hi", ts: "1730812345.001200" } } });
    await until(() => svc.identity!.pending.view(p.id)?.state === "heard");
    return svc.identity!.pending.view(p.id)!;
  };
  const connectOf = (p: PendingView, over: Partial<Record<string, string>> = {}): NoNonce<OwnerAction> => ({ type: "connectNetwork", network: "slack", pending: p.id, botId: "T0FAKE001:U0BOT0001", speaksAs: "@gravit", operatorId: "T0FAKE001:U0PAN07QK", talksOnlyWith: "@pan", routing: ALL_SLACK, keyHash, salt, ...over }) as NoNonce<OwnerAction>;
  const tokens = () => [slack.tokens.app, slack.tokens.bot];

  it("connect Slack: the door checks the pair against the signed fingerprint, then stores both tokens, the channel and the binding", async () => {
    const p = await heardPending();
    expect(p.sender).toMatchObject({ id: "T0FAKE001:U0PAN07QK", userId: "U0PAN07QK", name: "Pan K", handle: "@pan" });
    // a fingerprint of another pair, another bot, a token in a field: refused in Slack's own words, nothing written
    const other = newSalt();
    const otherPair = `${slack.tokens.app}\u0000${slackTokens().user}`;
    const tries: Array<[NoNonce<OwnerAction>, string]> = [
      [connectOf(p, { keyHash: keyHashOf(other, otherPair), salt: other }), IDENTITY_WORDS.slackMismatch],
      [connectOf(p, { botId: "T0FAKE001:U0BOT0002" }), IDENTITY_WORDS.slackBotMismatch],
      [connectOf(p, { speaksAs: "@another" }), IDENTITY_WORDS.slackBotMismatch],
      [connectOf(p, { operatorId: "T0FAKE001:U0SOME456" }), IDENTITY_WORDS.senderMismatch],
      [connectOf(p, { operatorId: "U0PAN07QK" }), IDENTITY_WORDS.senderMismatch],
      [connectOf(p, { talksOnlyWith: "@Pan K" }), IDENTITY_WORDS.senderMismatch],
      [connectOf(p, { talksOnlyWith: slack.tokens.bot }), IDENTITY_WORDS.slackTokenInField],
      [connectOf(p, { network: "telegram", routing: ALL_TELEGRAM }), IDENTITY_WORDS.noPending],
    ];
    for (const [a, words] of tries) {
      const r = await own(a);
      expect(isRefusal(r) && r.message).toBe(words);
      expect(existsSync(join(home, "credentials", "networks"))).toBe(false);
    }
    const r = await own(connectOf(p));
    expect(isRefusal(r)).toBe(false);
    expect(r).toMatchObject({ ok: true, kind: "account", summary: `Slack connected: Gravit speaks as @gravit and talks only with @pan · tokens ${keyHash.slice(0, 8)}` });
    expect(readNetworkSecret(home, "slack")).toEqual({ appToken: slack.tokens.app, botToken: slack.tokens.bot, appId: "A0FAKE001", channel: "D0FAKEDM1", botId: "T0FAKE001:U0BOT0001", username: "gravit", operatorId: "T0FAKE001:U0PAN07QK", operatorHandle: "@pan" });
    const v = svc.identity!.view();
    expect(v.networks).toHaveLength(1);
    expect(v.networks[0]).toMatchObject({ network: "slack", speaksAs: "@gravit", talksOnlyWith: "@pan", fingerprint: keyHash.slice(0, 8), state: "connected" });
    expect(v.routing).toEqual({ chat: ["slack"], alerts: ["slack"], brief: ["slack"], cards: ["slack"], fills: ["slack"] });
    expect(svc.identity!.pending.view(p.id)).toBeUndefined();
    // Telegram's words are its own still
    expect(IDENTITY_WORDS.mismatch).toBe("The token does not match its fingerprint: nothing was kept. Paste the token again.");
    expect(IDENTITY_WORDS.botMismatch).toBe("The bot signed is not the bot this connection checked with Telegram: nothing was written. Start again.");
  });

  it("the two tokens are in credentials/networks/slack.json and nowhere else", async () => {
    const r = await own(connectOf(await heardPending()));
    expect(isRefusal(r)).toBe(false);
    for (const t of tokens()) expect(JSON.stringify(r)).not.toContain(t);
    const holding = walk(home).filter((f) => tokens().some((t) => f.text.includes(t))).map((f) => f.path);
    expect(holding).toEqual([join("credentials", "networks", "slack.json")]);
    const ledger = ledgerText(home);
    expect(ledger).toContain(`Slack connected: Gravit speaks as @gravit and talks only with @pan · tokens ${keyHash.slice(0, 8)}`);
    expect(ledger).not.toContain(keyHash);
    expect(ledger).not.toContain(salt);
    for (const t of tokens()) expect(ledger).not.toContain(t);
    for (const t of tokens()) expect(said.join("\n")).not.toContain(t);
    const g = await send(srv.url, "/api/account/identity", { method: "GET" });
    for (const t of tokens()) expect(g.text).not.toContain(t);
    expect(g.text).not.toContain("U0PAN07QK");
    expect(loadIdentity(home).bindings).toMatchObject([{ network: "slack", botId: "T0FAKE001:U0BOT0001", operatorId: "T0FAKE001:U0PAN07QK", fingerprint: keyHash.slice(0, 8) }]);
  });

  it("the identity view carries the Slack manifest", async () => {
    const g = await send(srv.url, "/api/account/identity", { method: "GET" });
    expect(g.status).toBe(200);
    const manifest = JSON.parse(JSON.parse(g.text).slackManifest) as { settings: { socket_mode_enabled: boolean }; oauth_config: { scopes: { bot: string[] } } };
    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(manifest.oauth_config.scopes.bot).toEqual(["chat:write", "im:history", "users:read"]);
  });
});

describe("no Slack token in the tree", () => {
  /** a secret scanner's Slack shapes: a bot, user, refresh or legacy token, and an app-level token */
  const SCANNER: readonly RegExp[] = [/\bxox[abposre]-(?:\d+-)+[0-9A-Za-z]{6,}/, /\bxapp-\d-[A-Z0-9]{8,14}-\d{6,16}-[a-f0-9]{16,}/];
  const SKIP: ReadonlySet<string> = new Set(["node_modules", "dist", "coverage"]);
  /** the tracked files of account/ and face/ (git ls-files: nothing untracked or ignored, so no .env and no key file is opened); without
   * git, a walk that skips every dotfile and folder, the dependencies and what is built */
  function tracked(repo: string): string[] {
    try {
      const out = execFileSync("git", ["ls-files", "-z", "--", "account", "face"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return out.split("\u0000").filter((f) => f !== "").map((f) => join(repo, f));
    } catch {
      return [join(repo, "account"), join(repo, "face")].filter((d) => existsSync(d)).flatMap((d) => tree(d));
    }
  }
  function tree(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".") || SKIP.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) tree(p, out);
      else if (st.isFile()) out.push(p);
    }
    return out;
  }

  it("no file in account/ or face/ holds a literal Slack token of scanner shape", () => {
    const account = fileURLToPath(new URL("../..", import.meta.url));
    // the scanner itself finds the made-up tokens, as they are built at runtime
    const made = slackTokens();
    for (const t of [made.bot, made.user, made.refresh]) expect(SCANNER[0]!.test(t)).toBe(true);
    expect(SCANNER[1]!.test(made.app)).toBe(true);
    const repo = join(account, "..");
    const files = tracked(repo).filter((f) => !/(^|\/)\.env/.test(relative(repo, f)));
    // this very file and the account's sources are among them
    expect(files).toContain(fileURLToPath(import.meta.url));
    expect(files.some((f) => relative(repo, f).startsWith("face/"))).toBe(true);
    const found: string[] = [];
    for (const file of files) {
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size >= 4_000_000) continue;
      const text = readFileSync(file).toString("latin1");
      if (SCANNER.some((re) => re.test(text))) found.push(relative(repo, file));
    }
    expect(found).toEqual([]);
  });
});
