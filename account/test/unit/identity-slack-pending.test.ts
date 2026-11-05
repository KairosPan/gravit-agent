/** CONNECT SLACK, SHEETS 1 TO 3 (identity/slack.ts, pending.ts, routes.ts): the app's two tokens travel once, beside the one fingerprint
 * the page made of both (keyHash = hex sha256(salt ‖ appToken ‖ NUL ‖ botToken)), on their own route with its own body reader. The account
 * checks the pair against the fingerprint, then asks Slack who the bot is (auth.test), which app it belongs to (bots.info), opens a Socket
 * Mode link with the app-level token and checks its hello names that same app — then holds both tokens in memory only and hears the first
 * DM, whose sender sheet 3 shows. Every Web API call and every socket goes to the fake Slack on loopback; every token is made up and built
 * at runtime (slackTokens). */
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { keyHashOf, newSalt } from "../../src/portfolio/account/brain-keys.ts";
import { scriptedBrain } from "../../src/portfolio/account/desk.ts";
import { simKey } from "../../src/portfolio/account/sign.ts";
import { PENDING_MS, PendingConnections, type PendingView } from "../../src/portfolio/identity/pending.ts";
import { HELLO_WAIT_MS } from "../../src/portfolio/identity/slack.ts";
import { HELLO_DEADLINE_MS } from "../../src/portfolio/identity/slack-socket.ts";
import { IDENTITY_WORDS, isIdentityTokenPath, parseSlackTokenBody, SLACK_TOKEN_PATH } from "../../src/portfolio/identity/routes.ts";
import { writeNetworkSecret } from "../../src/portfolio/identity/secret-file.ts";
import { loadIdentity, saveIdentity, senderRef, Strangers } from "../../src/portfolio/identity/store.ts";
import { realClock, type IdentityClock } from "../../src/portfolio/identity/telegram.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { fakeBotApi, fakeSlack, FAKE_BOT_TOKEN, slackTokens, type FakeBotApi, type FakeSlack } from "../identity-fakes.ts";

const owner = simKey("owner");

const fp = (keyInput: string) => {
  const salt = newSalt();
  return { salt, keyHash: keyHashOf(salt, keyInput) };
};
const pairOf = (app: string, bot: string) => `${app}\u0000${bot}`;

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

let envelopes = 0;
/** a message event in an events_api envelope, as Slack sends it over Socket Mode: by default a DM to the bot from `user` */
const dm = (o: { user?: string; text?: string; ts?: string; channel?: string; channel_type?: string; subtype?: string; bot_id?: string; team?: string; app?: string }) => ({
  envelope_id: `env-${++envelopes}`,
  type: "events_api",
  accepts_response_payload: false,
  retry_attempt: 0,
  retry_reason: "",
  payload: {
    team_id: o.team ?? "T0FAKE001",
    api_app_id: o.app ?? "A0FAKE001",
    type: "event_callback",
    event_id: `Ev${envelopes}`,
    event: {
      type: "message",
      channel: o.channel ?? "D0FAKEDM1",
      channel_type: o.channel_type ?? "im",
      ts: o.ts ?? `1730812345.${String(envelopes).padStart(6, "0")}`,
      ...(o.user !== undefined ? { user: o.user } : {}),
      text: o.text ?? "hi",
      ...(o.subtype !== undefined ? { subtype: o.subtype } : {}),
      ...(o.bot_id !== undefined ? { bot_id: o.bot_id } : {}),
    },
  },
});

/** another bot token of the bot shape, one the fake does not know */
const otherBot = () => ["xo", "xb-", "1000000001", "-", "2000000009", "-", "AnotherFakeBotTokenForTests9"].join("");

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

describe("the Slack token route's body", () => {
  it("is exactly {appToken, botToken, keyHash, salt}, four strings, and the buffer is zeroed", () => {
    const { app, bot } = slackTokens();
    const raw = Buffer.from(JSON.stringify({ appToken: app, botToken: bot, keyHash: "k", salt: "s" }), "utf8");
    expect(parseSlackTokenBody(raw)).toEqual({ ok: true, appToken: app, botToken: bot, keyHash: "k", salt: "s" });
    expect(raw.every((b) => b === 0)).toBe(true);
    for (const bad of [{ appToken: app, botToken: bot, keyHash: "k" }, { appToken: app, botToken: bot, keyHash: "k", salt: "s", more: "x" }, { appToken: app, botToken: 1, keyHash: "k", salt: "s" }, [app], "x"]) {
      expect(parseSlackTokenBody(Buffer.from(JSON.stringify(bad), "utf8"))).toEqual({ ok: false });
    }
    expect(parseSlackTokenBody(Buffer.from("{", "utf8"))).toEqual({ ok: false });
    expect(isIdentityTokenPath(SLACK_TOKEN_PATH)).toBe(true);
    expect(isIdentityTokenPath("/API/account/identity/Slack/token/")).toBe(true);
    expect(isIdentityTokenPath("/api/account/identity/telegram/token")).toBe(true);
    expect(isIdentityTokenPath("/api/account/identity/slack")).toBe(false);
  });
});

describe("connect Slack through the account: the token route and the pending connection", () => {
  let slack: FakeSlack;
  let tg: FakeBotApi;
  let home: string;
  let svc: PortfolioService;
  let srv: PortfolioServerHandle;

  beforeEach(async () => {
    slack = await fakeSlack();
    slack.users.set("U0PAN07QK", { name: "pan", displayName: "", realName: "Pan" });
    slack.users.set("U0SOME456", { name: "someone", displayName: "Someone", realName: "Some One" });
    tg = await fakeBotApi();
    home = mkdtempSync(join(tmpdir(), "identity-slack-pending-"));
    svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, desk: { brain: [scriptedBrain(() => null)], tickMs: 0, env: {} }, identity: { apiBase: tg.url, slackApiBase: slack.url, pollTimeoutS: 1 } });
    await svc.restoring;
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  });
  afterEach(async () => {
    await srv.close();
    await slack.close();
    await tg.close();
    rmSync(home, { recursive: true, force: true });
  });

  const begin = async (app = slack.tokens.app, bot = slack.tokens.bot, signed = pairOf(app, bot)) => {
    const { salt, keyHash } = fp(signed);
    const r = await send(srv.url, SLACK_TOKEN_PATH, { body: JSON.stringify({ appToken: app, botToken: bot, keyHash, salt }) });
    return { r, pending: r.status === 200 ? (JSON.parse(r.text).pending as PendingView) : undefined };
  };
  const view = (id: string) => svc.identity!.pending.view(id)!;
  const tokensSaid = () => [slack.tokens.app, slack.tokens.bot].filter((t) => said.join("\n").includes(t));

  it("a token pair Slack knows becomes a pending connection; the answer names the app, never a token", async () => {
    const { salt, keyHash } = fp(pairOf(slack.tokens.app, slack.tokens.bot));
    const r = await send(srv.url, "/api/account/identity/slack/token", { body: JSON.stringify({ appToken: slack.tokens.app, botToken: slack.tokens.bot, keyHash, salt }) });
    expect(r.status).toBe(200);
    const p = JSON.parse(r.text).pending;
    expect(p).toMatchObject({ network: "slack", bot: { id: "T0FAKE001:U0BOT0001", username: "gravit", name: "gravit" }, workspace: "Fake Co", link: "https://slack.com/app_redirect?app=A0FAKE001&team=T0FAKE001", state: "waiting" });
    expect(p.qr.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Date.parse(p.expiresAt)).toBeGreaterThan(Date.now() + PENDING_MS - 5000);
    for (const t of [slack.tokens.app, slack.tokens.bot]) expect(r.text).not.toContain(t);
    // ruling 7's order: who the bot is, its app, a socket for the app-level token — whose hello came
    expect(slack.calls.map((c) => c.method)).toEqual(["auth.test", "bots.info", "apps.connections.open"]);
    expect(slack.calls[1]!.form).toEqual({ bot: "B0BOT0001" });
    expect(slack.sockets()).toBe(1);
    expect(tokensSaid()).toEqual([]);
  });

  it("a bad shape, an unknown bot token, an app token without Socket Mode, a pair from two apps and a fingerprint of other tokens are refused in fixed words, nothing kept", async () => {
    const answers: Array<{ status: number; text: string }> = [];
    const expectRefused = (r: { status: number; text: string }, status: number, words: string) => {
      answers.push(r);
      expect(r.status).toBe(status);
      expect(JSON.parse(r.text)).toEqual({ ok: false, error: words });
    };
    // the shapes: checked before anything reaches Slack — an app token where the bot's goes, a Telegram token, nothing
    for (const [app, bot] of [[slack.tokens.bot, slack.tokens.app], [slack.tokens.app, FAKE_BOT_TOKEN], ["", slack.tokens.bot], [`${slack.tokens.app}\u0000`, slack.tokens.bot]] as const) {
      expectRefused((await begin(app, bot)).r, 400, IDENTITY_WORDS.slackTokenShape);
    }
    // a fingerprint of other tokens: refused before Slack is asked
    expectRefused((await begin(slack.tokens.app, slack.tokens.bot, pairOf(slack.tokens.app, otherBot()))).r, 409, IDENTITY_WORDS.slackMismatch);
    expect(slack.calls).toEqual([]);
    // a bot token Slack does not know: auth.test's invalid_auth
    expectRefused((await begin(slack.tokens.app, otherBot())).r, 409, IDENTITY_WORDS.refusedBySlack);
    expect(slack.calls.map((c) => c.method)).toEqual(["auth.test"]);
    // an app-level token Slack will not open a socket for (no connections:write, or Socket Mode off)
    slack.answer("apps.connections.open", 200, { ok: false, error: "missing_scope" });
    expectRefused((await begin()).r, 409, IDENTITY_WORDS.slackNoSocket);
    slack.answer("apps.connections.open", 0, {});
    // the two tokens of two apps: the bot's app is not the socket's
    slack.answer("bots.info", 200, { ok: true, bot: { id: "B0BOT0001", name: "gravit", app_id: "A0OTHER09", user_id: "U0BOT0001" } });
    expectRefused((await begin()).r, 409, IDENTITY_WORDS.slackPairMismatch);
    await until(() => slack.sockets() === 0);
    for (const r of answers) for (const t of [slack.tokens.app, slack.tokens.bot, otherBot()]) expect(r.text).not.toContain(t);
    expect(tokensSaid()).toEqual([]);
    expect(said.join("\n")).not.toContain(otherBot());
    // nothing pending: the last refusal left no connection behind
    expect((svc.identity!.pending as unknown as { current?: unknown }).current).toBeUndefined();
  });

  it("the route skips the JSON parser and takes only application/json of at most 1,024 bytes", async () => {
    const broken = `{"appToken":"${slack.tokens.app.slice(0, 20)}`;
    const r = await send(srv.url, SLACK_TOKEN_PATH, { body: broken });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.text)).toEqual({ ok: false, error: IDENTITY_WORDS.slackMalformed });
    const type = await send(srv.url, SLACK_TOKEN_PATH, { body: JSON.stringify({ appToken: slack.tokens.app }), headers: { "content-type": "text/plain" } });
    expect(type.status).toBe(415);
    const large = await send(srv.url, SLACK_TOKEN_PATH, { body: JSON.stringify({ appToken: slack.tokens.app, botToken: slack.tokens.bot, keyHash: "a".repeat(2000), salt: "" }) });
    expect(large.status).toBe(413);
    for (const x of [r, type, large]) for (const t of [slack.tokens.app, slack.tokens.bot]) expect(x.text).not.toContain(t);
    expect(said.join("\n")).not.toContain(slack.tokens.app.slice(0, 20));
    expect(slack.calls).toEqual([]);
  });

  it("a socket URL off slack.com is refused", async () => {
    slack.socketUrl("ws://127.0.0.2:1/link");
    const { r } = await begin();
    expect(r.status).toBe(502);
    expect(JSON.parse(r.text)).toEqual({ ok: false, error: IDENTITY_WORDS.slackUnreachable });
    expect(said.filter((l) => /socket URL/.test(l))).toHaveLength(1);
    expect(said.join("\n")).not.toContain("127.0.0.2");
    expect(slack.events).toEqual([]);
    expect(tokensSaid()).toEqual([]);
  });

  it("the first DM from a person is heard: name, handle, masked id and text; the heard envelope is acked", async () => {
    const { pending } = await begin();
    const id = pending!.id;
    const e = dm({ user: "U0PAN07QK", text: "hi", ts: "1730812345.001200" });
    slack.push(e);
    await until(() => view(id).state === "heard");
    expect(view(id).sender).toEqual({ id: "T0FAKE001:U0PAN07QK", userId: "U0PAN07QK", name: "Pan", handle: "@pan", masked: "…7QK", text: "hi" });
    await until(() => slack.acks.includes(e.envelope_id));
    expect(slack.calls.filter((c) => c.method === "users.info").map((c) => c.form.user)).toEqual(["U0PAN07QK"]);
    // heard: the socket is closed, and the pending connection keeps the DM channel and the ts for the connected connector
    await until(() => slack.sockets() === 0);
    const taken = svc.identity!.pending.peek(id)!;
    expect(taken).toMatchObject({ network: "slack", sender: { id: "T0FAKE001:U0PAN07QK", handle: "@pan" }, resume: { network: "slack", appId: "A0FAKE001", channel: "D0FAKEDM1", cursor: "1730812345.001200" } });
    expect(taken.secret).toMatchObject({ appToken: slack.tokens.app, botToken: slack.tokens.bot, appId: "A0FAKE001", channel: "D0FAKEDM1", botId: "T0FAKE001:U0BOT0001", username: "gravit" });
    const g = await send(srv.url, `/api/account/identity/pending?id=${id}`, { method: "GET" });
    for (const t of [slack.tokens.app, slack.tokens.bot]) expect(g.text).not.toContain(t);
    expect(tokensSaid()).toEqual([]);
  });

  it("a channel message, a bot's message and an edit are not heard while pending", async () => {
    const { pending } = await begin();
    const id = pending!.id;
    const dropped = [
      dm({ user: "U0PAN07QK", channel: "C0CHANNEL1", channel_type: "channel" }),
      dm({ user: "U0PAN07QK", channel: "G0MPIM0001", channel_type: "mpim" }),
      dm({ user: "U0PAN07QK", bot_id: "B0OTHER01" }),
      dm({ subtype: "bot_message", bot_id: "B0OTHER01" }),
      dm({ user: "U0PAN07QK", subtype: "message_changed" }),
      dm({ user: "U0PAN07QK", subtype: "message_deleted" }),
      dm({ user: "U0PAN07QK", team: "T0OTHER01" }),
      dm({ user: "U0PAN07QK", app: "A0OTHER09" }),
      // the bot user itself, as users.info says it is
      dm({ user: "U0BOT0001" }),
    ];
    for (const e of dropped) slack.push(e);
    // each is acked at once, so Slack does not send it again
    await until(() => dropped.every((e) => slack.acks.includes(e.envelope_id)));
    expect(view(id).state).toBe("waiting");
    expect(view(id).sender).toBeUndefined();
    expect(svc.identity!.strangers()).toEqual([]);
    // the next DM from a person is heard all the same
    slack.push(dm({ user: "U0PAN07QK", text: "it's me" }));
    await until(() => view(id).state === "heard");
    expect(view(id).sender!.text).toBe("it's me");
  });

  it("sheet 3 names the person by their username and full user id: an impostor's display name from another team, a guest, a deactivated account and a bot are never heard", async () => {
    // each sets the operator's display name, which anyone can; none is a full member of the bot's team, or a person
    slack.users.set("U0PAN07QK", { name: "pan", displayName: "Pan", realName: "Pan" });
    slack.users.set("U0IMPOST1", { name: "pan.other", displayName: "Pan", realName: "Pan", teamId: "T0OTHER01" });
    slack.users.set("U0GUEST01", { name: "guest", displayName: "Pan", realName: "Pan", restricted: true });
    slack.users.set("U0GUEST02", { name: "guest2", displayName: "Pan", realName: "Pan", ultraRestricted: true });
    slack.users.set("U0GONE001", { name: "gone", displayName: "Pan", realName: "Pan", deleted: true });
    slack.users.set("U0ABOT001", { name: "somebot", displayName: "Pan", realName: "Pan", isBot: true });
    const { pending } = await begin();
    const id = pending!.id;
    const unheard = ["U0IMPOST1", "U0GUEST01", "U0GUEST02", "U0GONE001", "U0ABOT001"].map((user) => dm({ user, text: "it's me, Pan" }));
    for (const e of unheard) slack.push(e);
    await until(() => unheard.every((e) => slack.acks.includes(e.envelope_id)));
    expect(view(id).state).toBe("waiting");
    expect(view(id).sender).toBeUndefined();
    // the four people are counted in Not you; the bot is dropped
    expect(svc.identity!.strangers().map((x) => x.sender).sort()).toEqual(["U0IMPOST1", "U0GUEST01", "U0GUEST02", "U0GONE001"].map((u) => senderRef("slack", `T0FAKE001:${u}`)).sort());
    // the operator is heard, by their username and their full user id
    slack.push(dm({ user: "U0PAN07QK", text: "hi" }));
    await until(() => view(id).state === "heard");
    expect(view(id).sender).toEqual({ id: "T0FAKE001:U0PAN07QK", userId: "U0PAN07QK", name: "Pan", handle: "@pan", masked: "…7QK", text: "hi" });
    const g = JSON.parse((await send(srv.url, `/api/account/identity/pending?id=${id}`, { method: "GET" })).text);
    expect(g.pending.sender).toMatchObject({ userId: "U0PAN07QK", handle: "@pan" });
    expect(svc.identity!.pending.peek(id)!.sender).toEqual({ id: "T0FAKE001:U0PAN07QK", handle: "@pan" });
  });

  it("Not me counts the sender as a Slack stranger and waits again", async () => {
    const { pending } = await begin();
    const id = pending!.id;
    slack.push(dm({ user: "U0SOME456", text: "hello?" }));
    await until(() => view(id).state === "heard");
    expect(view(id).sender).toMatchObject({ id: "T0FAKE001:U0SOME456", userId: "U0SOME456", name: "Someone", handle: "@someone", masked: "…456" });
    await until(() => slack.sockets() === 0);
    const r = await send(srv.url, "/api/account/identity/pending/not-me", { body: JSON.stringify({ id }) });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).pending).toMatchObject({ state: "waiting" });
    expect(svc.identity!.strangers()).toMatchObject([{ network: "slack", sender: senderRef("slack", "T0FAKE001:U0SOME456"), masked: "…456", count: 1 }]);
    // listening again: a fresh socket, on which the same person is counted again, never heard, and the operator is
    await until(() => slack.sockets() === 1);
    const again = dm({ user: "U0SOME456", text: "hello??" });
    slack.push(again);
    await until(() => slack.acks.includes(again.envelope_id));
    expect(svc.identity!.strangers()).toMatchObject([{ network: "slack", count: 2 }]);
    expect(view(id).state).toBe("waiting");
    slack.push(dm({ user: "U0PAN07QK", text: "hi" }));
    await until(() => view(id).state === "heard");
    expect(view(id).sender!.handle).toBe("@pan");
  });

  it("a hello with two connections is state conflict", async () => {
    slack.helloConnections(2);
    const { pending } = await begin();
    await until(() => view(pending!.id).state === "conflict");
    // a hello that is alone again clears it
    slack.helloConnections(0);
    slack.disconnect("refresh_requested");
    await until(() => view(pending!.id).state === "waiting", 8000);
    expect(tokensSaid()).toEqual([]);
  });

  it("drop or expiry closes the socket and forgets both tokens", async () => {
    const { pending } = await begin();
    expect(slack.sockets()).toBe(1);
    const r = await send(srv.url, "/api/account/identity/pending/drop", { body: JSON.stringify({ id: pending!.id }) });
    expect(r.status).toBe(200);
    await until(() => slack.sockets() === 0);
    expect(svc.identity!.pending.view(pending!.id)).toBeUndefined();
    expect((svc.identity!.pending as unknown as { current?: unknown }).current).toBeUndefined();
  });

  it("a Slack pending is refused while Slack is connected; Telegram's pending is untouched by Slack's", async () => {
    // Telegram's pending connection, under way
    const { salt, keyHash } = fp(FAKE_BOT_TOKEN);
    const t = await send(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: FAKE_BOT_TOKEN, keyHash, salt }) });
    expect(t.status).toBe(200);
    const tp = JSON.parse(t.text).pending as PendingView;
    // Slack bound already (its token file and its binding)
    const { app, bot } = slack.tokens;
    writeNetworkSecret(home, "slack", { appToken: app, botToken: bot, appId: "A0FAKE001", channel: "D0FAKEDM1", botId: "T0FAKE001:U0BOT0001", username: "gravit", operatorId: "T0FAKE001:U0PAN07QK", operatorHandle: "@pan" });
    const s = loadIdentity(home);
    saveIdentity(home, { ...s, bindings: [{ network: "slack", speaksAs: "@gravit", botId: "T0FAKE001:U0BOT0001", talksOnlyWith: "@pan", operatorId: "T0FAKE001:U0PAN07QK", since: new Date().toISOString(), fingerprint: "ab12cd34" }] });
    const { r } = await begin();
    expect(r.status).toBe(409);
    expect(JSON.parse(r.text)).toEqual({ ok: false, error: IDENTITY_WORDS.connectedOn("slack") });
    expect(slack.calls).toEqual([]);
    expect(slack.events).toEqual([]);
    // the refused Slack pending did not replace Telegram's
    expect(svc.identity!.pending.view(tp.id)!.state).toBe("waiting");
  });
});

describe("the Slack pending connection on its own clock", () => {
  let slack: FakeSlack;
  let home: string;
  beforeEach(async () => {
    slack = await fakeSlack();
    home = mkdtempSync(join(tmpdir(), "identity-slack-clock-"));
  });
  afterEach(async () => {
    await slack.close();
    rmSync(home, { recursive: true, force: true });
  });
  const held = (p: PendingConnections) => (p as unknown as { current?: { token: string; keyHash: string; salt: string; api?: unknown } }).current;

  it("past ten minutes the socket is closed and both tokens are dropped", async () => {
    let t = Date.now();
    const lines: string[] = [];
    const pending = new PendingConnections({ apiBase: "http://127.0.0.1:9", slackApiBase: slack.url, clock: realClock(), strangers: new Strangers(home), bound: () => false, now: () => t, log: (l) => void lines.push(l) });
    try {
      const { app, bot } = slack.tokens;
      const { salt, keyHash } = fp(pairOf(app, bot));
      const v = await pending.beginSlack(app, bot, keyHash, salt);
      if (isRefusal(v)) throw new Error(v.message);
      expect(v.network).toBe("slack");
      expect(slack.sockets()).toBe(1);
      t += PENDING_MS;
      expect(pending.view(v.id)!.state).toBe("expired");
      await until(() => slack.sockets() === 0);
      const e = held(pending)!;
      expect(e).toMatchObject({ token: "", keyHash: "", salt: "" });
      expect(e.api).toBeUndefined();
      expect(JSON.stringify(e)).not.toContain(app);
      expect(JSON.stringify(e)).not.toContain(bot);
      expect(lines.join("\n")).not.toContain(app);
    } finally {
      pending.dispose();
    }
  });

  /** real timers, but the long waits (sheet 1's hello wait, the 30 s hello deadline and recheck) only when the test fires them */
  function heldClock(): IdentityClock & { fire(ms: number): number; held(ms: number): number } {
    const held = new Map<object, { ms: number; fn: () => void }>();
    let offset = 0;
    return {
      now: () => Date.now() + offset,
      setTimeout: (fn, ms) => {
        if (ms === HELLO_WAIT_MS || ms === HELLO_DEADLINE_MS) {
          const h = {};
          held.set(h, { ms, fn });
          return h;
        }
        const t = setTimeout(fn, ms);
        t.unref();
        return t;
      },
      clearTimeout: (h) => {
        if (h !== null && typeof h === "object" && held.has(h)) held.delete(h);
        else clearTimeout(h as NodeJS.Timeout);
      },
      fire(ms) {
        offset += ms;
        const due = [...held.entries()].filter(([, v]) => v.ms === ms);
        for (const [h] of due) held.delete(h);
        for (const [, v] of due) v.fn();
        return due.length;
      },
      held: (ms) => [...held.values()].filter((v) => v.ms === ms).length,
    };
  }

  it("after Not me, a reading of two within 30 s of its own close is no conflict until a recheck still reads two", async () => {
    slack.users.set("U0SOME456", { name: "someone", displayName: "Someone", realName: "Some One" });
    const clock = heldClock();
    const pending = new PendingConnections({ apiBase: "http://127.0.0.1:9", slackApiBase: slack.url, clock, strangers: new Strangers(home), bound: () => false });
    try {
      const { app, bot } = slack.tokens;
      const { salt, keyHash } = fp(pairOf(app, bot));
      const v = await pending.beginSlack(app, bot, keyHash, salt);
      if (isRefusal(v)) throw new Error(v.message);
      const opened = () => slack.events.filter((e) => e.startsWith("open")).length;
      slack.push(dm({ user: "U0SOME456", text: "hello?" }));
      await until(() => pending.view(v.id)!.state === "heard");
      await until(() => slack.sockets() === 0);
      // Slack still counts the socket just closed: the fresh socket's hello reads two, and the connection waits on, not in conflict
      slack.helloConnections(2);
      pending.notMe(v.id);
      await until(() => opened() === 2 && clock.held(HELLO_DEADLINE_MS) === 1 && slack.sockets() === 1);
      await new Promise((r) => setTimeout(r, 50));
      expect(pending.view(v.id)!.state).toBe("waiting");
      // the recheck, 30 s later: a fresh socket, and Slack counts one — no conflict
      slack.helloConnections(0);
      expect(clock.fire(HELLO_DEADLINE_MS)).toBe(1);
      await until(() => opened() === 3);
      await new Promise((r) => setTimeout(r, 50));
      expect(pending.view(v.id)!.state).toBe("waiting");
      // a second holder: the hello after a reopen reads two, and the recheck still reads two
      slack.helloConnections(2);
      slack.disconnect("refresh_requested");
      await until(() => opened() === 4 && clock.held(HELLO_DEADLINE_MS) === 1);
      await new Promise((r) => setTimeout(r, 50));
      expect(pending.view(v.id)!.state).toBe("waiting");
      clock.fire(HELLO_DEADLINE_MS);
      await until(() => pending.view(v.id)!.state === "conflict");
      expect(slack.events.every((e) => e === "open 1" || e === "close 0")).toBe(true);
    } finally {
      pending.dispose();
    }
  });

  it("a Slack key without its NUL, or with a half empty, is refused before Slack is asked", async () => {
    const pending = new PendingConnections({ apiBase: "http://127.0.0.1:9", slackApiBase: slack.url, strangers: new Strangers(home), bound: () => false });
    try {
      const { app, bot } = slack.tokens;
      const source = { network: "slack" as const, secrets: [app, bot], check: async () => ({ id: "x", username: "x", name: "x", link: "https://example.invalid/" }), listen: async () => undefined, resume: () => ({ network: "slack" as const, appId: "A", channel: "D", cursor: "1.000001" }) };
      for (const key of [`${app}${bot}`, `${app}\u0000`, `\u0000${bot}`]) {
        const salt = newSalt();
        const r = await pending.begin("slack", source, key, keyHashOf(salt, key), salt);
        expect(isRefusal(r) && r.message).toBe(IDENTITY_WORDS.slackTokenShape);
      }
      expect(slack.calls).toEqual([]);
    } finally {
      pending.dispose();
    }
  });
});
