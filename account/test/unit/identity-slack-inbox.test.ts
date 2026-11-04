/** THE CONNECTED SLACK CONNECTOR (identity/slack.ts SlackConnector, identity.ts): once connectNetwork is signed for Slack, the account holds
 * one Socket Mode link for the app and stores the bound operator's DM texts in the inbox — acked only after the inbox took them, and read
 * again from the DM's history (after slack.cursor) at every hello, so a text written while no socket was open is not lost. A stranger is
 * counted, never stored and never answered; a channel, a bot, an edit and another team are dropped; `!status` and the other four reach the
 * desk as `/status` even with Chat off. Every Web API call and every socket goes to the fake Slack on loopback; every token is made up and
 * built at runtime (slackTokens). */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { keyHashOf, newSalt } from "../../src/portfolio/account/brain-keys.ts";
import { scriptedBrain } from "../../src/portfolio/account/desk.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { INBOX_MAX } from "../../src/portfolio/identity/inbox.ts";
import type { PendingView } from "../../src/portfolio/identity/pending.ts";
import { HELLO_WAIT_MS, normalizeCommand } from "../../src/portfolio/identity/slack.ts";
import { HELLO_DEADLINE_MS, SOCKET_REFRESH_MS } from "../../src/portfolio/identity/slack-socket.ts";
import { senderRef } from "../../src/portfolio/identity/store.ts";
import type { IdentityClock } from "../../src/portfolio/identity/telegram.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { fakeBotApi, fakeSlack, FAKE_BOT_TOKEN, type FakeBotApi, type FakeSlack } from "../identity-fakes.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const owner = simKey("owner");
const ALL_SLACK = "chat=slack;alerts=slack;brief=slack;cards=slack;fills=slack";
const OP = "U0PAN07QK";
const DM = "D0FAKEDM1";
/** the ts of the DM the operator was heard by on sheet 2: where the connector's cursor starts */
const HEARD_TS = "1730811000.000100";
const CHAT_OFF_SLACK = "Chat with Gravit is off on Slack: Account › Identity turns it on.";
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

/** a clock whose waits fire at once (moving `now` by what they waited), except the long ones a test fires itself: a socket's hello
 * deadline and the conflict's recheck (both 30 s), the 30-minute silence, and — until `connected()` — sheet 1's 10 s hello wait (after
 * it, a 10 s backoff fires at once like the rest) */
function hybridClock(): IdentityClock & { fire(ms: number): number; advance(ms: number): void; heldFor(ms: number): number; connected(): void } {
  let offset = 0;
  const held = new Map<object, { ms: number; fn: () => void }>();
  const HELD = new Set([HELLO_WAIT_MS, HELLO_DEADLINE_MS, SOCKET_REFRESH_MS]);
  return {
    now: () => Date.now() + offset,
    setTimeout: (fn, ms) => {
      if (HELD.has(ms)) {
        const h = {};
        held.set(h, { ms, fn });
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
    fire(ms) {
      const due = [...held.entries()].filter(([, v]) => v.ms === ms);
      for (const [h] of due) held.delete(h);
      offset += ms;
      for (const [, v] of due) v.fn();
      return due.length;
    },
    advance(ms) {
      offset += ms;
    },
    heldFor: (ms) => [...held.values()].filter((v) => v.ms === ms).length,
    connected: () => void HELD.delete(HELLO_WAIT_MS),
  };
}

let envelopes = 0;
/** a message event in an events_api envelope, as Slack sends it over Socket Mode: by default the operator's DM to the bot */
const dm = (o: { user?: string; text?: string; ts?: string; thread_ts?: string; channel?: string; channel_type?: string; subtype?: string; bot_id?: string; team?: string; app?: string; retry?: number } = {}) => ({
  envelope_id: `env-${++envelopes}`,
  type: "events_api",
  accepts_response_payload: false,
  retry_attempt: o.retry ?? 0,
  retry_reason: o.retry ? "timeout" : "",
  payload: {
    team_id: o.team ?? "T0FAKE001",
    api_app_id: o.app ?? "A0FAKE001",
    type: "event_callback",
    event_id: `Ev${envelopes}`,
    event: {
      type: "message",
      channel: o.channel ?? DM,
      channel_type: o.channel_type ?? "im",
      ts: o.ts ?? `${1730812000 + envelopes}.000200`,
      ...(o.user === "" ? {} : { user: o.user ?? OP }),
      text: o.text ?? "hi",
      ...(o.thread_ts !== undefined ? { thread_ts: o.thread_ts } : {}),
      ...(o.subtype !== undefined ? { subtype: o.subtype } : {}),
      ...(o.bot_id !== undefined ? { bot_id: o.bot_id } : {}),
    },
  },
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
});

describe("normalizeCommand", () => {
  it("rewrites a leading ! before one of the five words to /, and leaves every other text alone", () => {
    expect(normalizeCommand("!status")).toBe("/status");
    expect(normalizeCommand("!pause 30m")).toBe("/pause 30m");
    expect(normalizeCommand("  !MUTE 1h ")).toBe("  /MUTE 1h ");
    expect(normalizeCommand("!new")).toBe("/new");
    expect(normalizeCommand("!Stop")).toBe("/Stop");
    for (const same of ["!statusx", "!help", "hi !status", "! status", "/status", "!!stop", "!pause30m", ""]) expect(normalizeCommand(same)).toBe(same);
  });
});

describe("the connected Slack connector, through the account", () => {
  let slack: FakeSlack;
  let tg: FakeBotApi;
  let home: string;
  let svc: PortfolioService;
  let srv: PortfolioServerHandle;
  let clock: ReturnType<typeof hybridClock>;

  const boot = async () => {
    svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined }, publicMarkets: [], liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" }, account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date().toISOString() }] }, desk: { brain: [scriptedBrain(() => null)], tickMs: 0, env: {} }, identity: { apiBase: tg.url, slackApiBase: slack.url, pollTimeoutS: 1, connectedPollTimeoutS: 1, clock } });
    await svc.restoring;
    srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  };
  const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: nonce() } as OwnerAction));
  const inbox = async (after: number, waitS: number) => {
    const r = await call(srv.url, `/api/account/identity/inbox?after=${after}&wait=${waitS}`, { method: "GET" });
    return JSON.parse(r.text) as { messages: Array<Record<string, unknown>>; last: number; status: { networks: Array<Record<string, unknown>>; strangers: number } };
  };
  const cursorFile = () => join(home, "identity", "slack.cursor");
  const cursor = () => (existsSync(cursorFile()) ? readFileSync(cursorFile(), "utf8").trim() : "");
  const slackStatus = () => svc.identity!.phoneStatus().networks.find((x) => x.network === "slack")!;
  const historyCalls = () => slack.calls.filter((c) => c.method === "conversations.history");
  const hellos = () => slack.events.filter((e) => e.startsWith("open")).length;
  let last: { envelope_id: string } | undefined;
  const push = <T extends { envelope_id: string }>(e: T): T => {
    last = e;
    slack.push(e);
    return e;
  };
  const lastEnvelopeId = () => last!.envelope_id;
  /** the socket after `opened` hellos is open past its hello (so its hello deadline is cleared), and the 30 s recheck is armed */
  const armed = (opened: number) => until(() => hellos() === opened + 1 && slackStatus().polling === true && clock.heldFor(HELLO_DEADLINE_MS) === 1, 5000, "the recheck armed");
  const acked = (e: { envelope_id: string }) => until(() => slack.acks.includes(e.envelope_id), 5000, `the ack of ${e.envelope_id}`);

  /** sheets 1 to 3 through the routes, the operator's first DM heard, connectNetwork signed; the connector's first hello come */
  const connect = async (routing = ALL_SLACK) => {
    const salt = newSalt();
    const keyHash = keyHashOf(salt, `${slack.tokens.app}\u0000${slack.tokens.bot}`);
    const r = await call(srv.url, "/api/account/identity/slack/token", { body: JSON.stringify({ appToken: slack.tokens.app, botToken: slack.tokens.bot, keyHash, salt }) });
    expect(r.status).toBe(200);
    const p = JSON.parse(r.text).pending as PendingView;
    slack.push(dm({ text: "hi", ts: HEARD_TS }));
    await until(() => svc.identity!.pending.view(p.id)?.state === "heard", 5000, "heard");
    await until(() => slack.sockets() === 0, 5000, "the pending socket closed");
    const c = await own({ type: "connectNetwork", network: "slack", pending: p.id, botId: "T0FAKE001:U0BOT0001", speaksAs: "@gravit", operatorId: `T0FAKE001:${OP}`, talksOnlyWith: "@pan", routing, keyHash, salt } as NoNonce<OwnerAction>);
    expect(isRefusal(c)).toBe(false);
    clock.connected();
    expect(cursor()).toBe(HEARD_TS);
    await until(() => slackStatus().polling === true, 5000, "the connector's hello");
    // the first hello's backfill ran
    await until(() => historyCalls().length >= 1, 5000, "the first backfill");
  };

  beforeEach(async () => {
    clock = hybridClock();
    slack = await fakeSlack();
    slack.users.set(OP, { name: "pan", displayName: "Pan", realName: "Pan Zhe" });
    slack.users.set("U0OTHER01", { name: "other", displayName: "Other", realName: "Other One" });
    tg = await fakeBotApi();
    home = mkdtempSync(join(tmpdir(), "identity-slack-inbox-"));
    await boot();
    await connect();
  });
  afterEach(async () => {
    await srv.close();
    await slack.close();
    await tg.close();
    for (const t of [slack.tokens.app, slack.tokens.bot]) expect(said.join("\n")).not.toContain(t);
    rmSync(home, { recursive: true, force: true });
  });

  it("the operator's DM is stored, then acked, with its ts as the id and a thread's root as replyTo", async () => {
    push(dm({ user: OP, text: "how is NVDA", ts: "1730812345.001200", thread_ts: "1730812000.000100" }));
    const a = await inbox(0, 5);
    expect(a.messages).toEqual([{ id: 1, network: "slack", messageId: "slack:1730812345.001200", replyTo: "slack:1730812000.000100", text: "how is NVDA", at: "2024-11-05T13:12:25.001Z" }]);
    await until(() => slack.acks.includes(lastEnvelopeId()));
    expect(slack.acks).toContain(lastEnvelopeId());
    expect(readFileSync(join(home, "identity", "slack.cursor"), "utf8").trim()).toBe("1730812345.001200");
    expect(a.status.networks).toEqual([expect.objectContaining({ network: "slack", polling: true, lastPollAt: expect.any(String) })]);
    // the heard "hi" is not in the inbox, and a thread's root is no reply to itself
    push(dm({ text: "a root", ts: "1730812400.000100", thread_ts: "1730812400.000100" }));
    const b = await inbox(1, 5);
    expect(b.messages).toEqual([{ id: 2, network: "slack", messageId: "slack:1730812400.000100", text: "a root", at: "2024-11-05T13:13:20.000Z" }]);
    expect(slack.posted).toEqual([]);
  });

  it("a text the inbox cannot store is not acked, and its retry is stored once", async () => {
    mkdirSync(join(home, "identity"), { recursive: true });
    const elsewhere = join(home, "elsewhere.json");
    writeFileSync(elsewhere, "untouched");
    symlinkSync(elsewhere, join(home, "identity", "inbox.json"));
    const e = push(dm({ text: "hold this", ts: "1730812500.000100" }));
    await until(() => said.some((l) => l.includes("could not be stored in the inbox")), 5000, "the line");
    await pause(100);
    expect(slack.acks).not.toContain(e.envelope_id);
    expect(cursor()).toBe(HEARD_TS);
    expect(readFileSync(elsewhere, "utf8")).toBe("untouched");
    unlinkSync(join(home, "identity", "inbox.json"));
    // Slack sends it again, retry_attempt 1: stored, then acked; a third time it is the same row
    slack.push({ ...e, retry_attempt: 1, retry_reason: "timeout" });
    await acked(e);
    slack.push({ ...e, retry_attempt: 2, retry_reason: "timeout" });
    await until(() => slack.acks.filter((x) => x === e.envelope_id).length === 2);
    const a = await inbox(0, 0);
    expect(a.messages.map((m) => m.text)).toEqual(["hold this"]);
    expect(cursor()).toBe("1730812500.000100");
  });

  it("a text written while no socket was open is taken from the history once", async () => {
    // the socket cut, and Slack not opening another for a while
    slack.answer("apps.connections.open", 200, { ok: false, error: "internal_error" });
    const opens = slack.calls.filter((c) => c.method === "apps.connections.open").length;
    slack.drop();
    await until(() => slack.calls.filter((c) => c.method === "apps.connections.open").length > opens, 5000, "a failed open");
    expect(slackStatus().polling).toBe(false);
    // what the operator wrote meanwhile is only in the DM's history (and the bot's own line beside it)
    slack.history.push({ ts: "1730812600.000100", user: OP, text: "while away" });
    slack.history.push({ ts: "1730812601.000100", user: "U0BOT0001", text: "a line of the bot's", bot_id: "B0BOT0001" });
    slack.answer("apps.connections.open", 0, {});
    const a = await inbox(0, 8);
    expect(a.messages).toEqual([{ id: 1, network: "slack", messageId: "slack:1730812600.000100", text: "while away", at: "2024-11-05T13:16:40.000Z" }]);
    // the backfill read after the cursor, and not inclusive
    expect(historyCalls().at(-1)!.form).toMatchObject({ channel: DM, oldest: HEARD_TS, inclusive: "false", limit: "100" });
    // Slack's own retry of the live envelope, after the next hello: acked, not stored again
    const e = push(dm({ text: "while away", ts: "1730812600.000100", retry: 1 }));
    await acked(e);
    expect((await inbox(0, 0)).messages).toHaveLength(1);
    expect(cursor()).toBe("1730812601.000100");
    expect(slack.posted).toEqual([]);
  });

  it("the backfill starts after the cursor and stops at 500, oldest first", async () => {
    // one before the cursor (already taken), then 600 after it
    slack.history.push({ ts: "1730810000.000100", user: OP, text: "before the cursor" });
    for (let i = 1; i <= 600; i++) slack.history.push({ ts: `${1730813000 + i}.000100`, user: OP, text: `t${i}` });
    const before = historyCalls().length;
    slack.disconnect("refresh_requested");
    await until(() => svc.identity!.inboxRing.last() >= INBOX_MAX, 10_000, "the backfill");
    const a = await inbox(0, 0);
    // the 500 newest, oldest first: Slack answers newest first, 100 a page
    expect(a.messages).toHaveLength(INBOX_MAX);
    expect(a.messages.map((m) => m.text)).toEqual(Array.from({ length: 500 }, (_, i) => `t${i + 101}`));
    expect(a.messages.map((m) => m.id)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
    const reads = historyCalls().slice(before);
    expect(reads).toHaveLength(5);
    expect(reads.every((c) => c.form.oldest === HEARD_TS && c.form.limit === "100")).toBe(true);
    expect(cursor()).toBe("1730813600.000100");
    expect(said.some((l) => l.includes("more than 500"))).toBe(true);
    // the next hello reads after the new cursor: nothing again
    slack.disconnect("refresh_requested");
    await until(() => historyCalls().length > before + 5, 5000, "the next backfill");
    await pause(50);
    expect(historyCalls().at(-1)!.form.oldest).toBe("1730813600.000100");
    expect(svc.identity!.inboxRing.last()).toBe(INBOX_MAX);
  });

  it("a hello whose backfill fails leaves the cursor where it was, and the next hello backfills", async () => {
    slack.history.push({ ts: "1730812700.000100", user: OP, text: "missed" });
    slack.answer("conversations.history", 200, { ok: false, error: "internal_error" });
    const before = historyCalls().length;
    const opened = hellos();
    slack.disconnect("refresh_requested");
    // the hello's backfill fails: the socket is closed and opened again after the backoff, and each hello tries again
    await until(() => historyCalls().length >= before + 2 && hellos() >= opened + 2, 8000, "two failed backfills");
    expect(cursor()).toBe(HEARD_TS);
    expect(svc.identity!.inboxRing.last()).toBe(0);
    slack.answer("conversations.history", 0, {});
    const a = await inbox(0, 8);
    expect(a.messages.map((m) => m.text)).toEqual(["missed"]);
    await until(() => cursor() === "1730812700.000100");
  });

  it("a stranger is counted, never stored, never answered; a channel, a bot, an edit and another team are dropped", async () => {
    slack.users.set("U0GUEST01", { name: "guest", displayName: "Pan", realName: "Pan", restricted: true });
    slack.users.set("U0ABOT001", { name: "somebot", displayName: "Pan", realName: "Pan", isBot: true });
    const stranger = push(dm({ user: "U0OTHER01", channel: "D0OTHERDM", text: "a stranger's secret words", ts: "1730812800.000100" }));
    await acked(stranger);
    expect(svc.identity!.strangers()).toMatchObject([{ network: "slack", sender: senderRef("slack", "T0FAKE001:U0OTHER01"), masked: "…R01", count: 1 }]);
    const dropped = [
      dm({ channel: "C0CHANNEL1", channel_type: "channel", text: "in a channel" }),
      dm({ channel: "G0MPIM0001", channel_type: "mpim", text: "in an mpim" }),
      dm({ bot_id: "B0OTHER01", text: "a bot's" }),
      dm({ user: "", subtype: "bot_message", bot_id: "B0OTHER01", text: "a bot's message" }),
      dm({ subtype: "message_changed", text: "edited" }),
      dm({ subtype: "message_deleted", text: "deleted" }),
      dm({ team: "T0OTHER01", text: "another team's" }),
      dm({ app: "A0OTHER09", text: "another app's" }),
      // a bot user, by users.info, in its own DM with the app: dropped, not counted
      dm({ user: "U0ABOT001", channel: "D0ABOTDM1", text: "a bot user's" }),
      { envelope_id: "env-slash", type: "slash_commands", payload: { command: "/gravit" } },
    ];
    for (const e of dropped) push(e);
    for (const e of dropped) await acked(e);
    // a guest is counted as a stranger, as sheet 3 counts them
    const guest = push(dm({ user: "U0GUEST01", channel: "D0GUESTDM", text: "it's me" }));
    await acked(guest);
    const a = await inbox(0, 0);
    expect(a.messages).toEqual([]);
    expect(a.status.strangers).toBe(2);
    expect(svc.identity!.strangers().map((s) => s.sender).sort()).toEqual([senderRef("slack", "T0FAKE001:U0OTHER01"), senderRef("slack", "T0FAKE001:U0GUEST01")].sort());
    expect(slack.posted).toEqual([]);
    expect(cursor()).toBe(HEARD_TS);
    for (const f of walk(home)) {
      expect(f.text).not.toContain("a stranger's secret words");
      expect(f.text).not.toContain("Other One");
    }
  });

  it("a file from the operator gets 'text only, please'; a blocked stranger is not counted", async () => {
    const file = push(dm({ subtype: "file_share", text: "", ts: "1730812900.000100" }));
    await acked(file);
    await until(() => slack.posted.length === 1);
    expect(slack.posted).toEqual([{ channel: DM, text: "text only, please", mrkdwn: "false", unfurl_links: "false", unfurl_media: "false" }]);
    expect((await inbox(0, 0)).messages).toEqual([]);
    // the stranger, counted once, then blocked: never counted again
    await acked(push(dm({ user: "U0OTHER01", channel: "D0OTHERDM" })));
    const ref = senderRef("slack", "T0FAKE001:U0OTHER01");
    expect(svc.identity!.strangers().map((s) => s.sender)).toEqual([ref]);
    const b = await own({ type: "blockSender", network: "slack", sender: ref, masked: "…R01" } as NoNonce<OwnerAction>);
    expect(isRefusal(b)).toBe(false);
    expect(svc.identity!.strangers()).toEqual([]);
    const infos = slack.calls.filter((c) => c.method === "users.info").length;
    await acked(push(dm({ user: "U0OTHER01", channel: "D0OTHERDM", text: "again" })));
    expect(svc.identity!.strangers()).toEqual([]);
    // a blocked sender is not even looked up
    expect(slack.calls.filter((c) => c.method === "users.info").length).toBe(infos);
    expect(slack.posted).toHaveLength(1);
  });

  it("!status reaches the inbox as /status even with Chat off; plain text with Chat off gets the Slack line", async () => {
    const r = await own({ type: "setRouting", routing: "chat=;alerts=slack;brief=slack;cards=slack;fills=slack", quietFrom: "", quietTo: "" } as NoNonce<OwnerAction>);
    expect(isRefusal(r)).toBe(false);
    push(dm({ text: "!pause 30m", ts: "1730813100.000100" }));
    const a = await inbox(0, 5);
    expect(a.messages.map((m) => m.text)).toEqual(["/pause 30m"]);
    const hello = push(dm({ text: "hello", ts: "1730813101.000100" }));
    await acked(hello);
    await until(() => slack.posted.length === 1);
    expect(slack.posted[0]).toMatchObject({ channel: DM, text: CHAT_OFF_SLACK });
    push(dm({ text: "!STATUS", ts: "1730813102.000100" }));
    expect((await inbox(1, 5)).messages.map((m) => m.text)).toEqual(["/STATUS"]);
    // a /status that arrives as text is taken as it is
    push(dm({ text: "/mute 1h", ts: "1730813103.000100" }));
    expect((await inbox(2, 5)).messages.map((m) => m.text)).toEqual(["/mute 1h"]);
    expect((await inbox(0, 0)).messages.map((m) => m.text)).not.toContain("hello");
    // the chat-off text moved the cursor past it: a restart's backfill does not answer it again
    expect(cursor()).toBe("1730813103.000100");
  });

  it("a reconnect's own old socket is not a conflict; a second holder is", async () => {
    // Slack still counts the socket the link just closed: within 30 s of its own close, a reading of two waits for a recheck
    slack.helloConnections(2);
    const opened = hellos();
    slack.disconnect("refresh_requested");
    await armed(opened);
    expect(slackStatus().conflictAt).toBeUndefined();
    // the recheck, 30 s later, opens a fresh socket: Slack counts one now
    slack.helloConnections(0);
    clock.fire(HELLO_DEADLINE_MS);
    await until(() => hellos() === opened + 2, 5000, "the recheck's hello");
    await pause(50);
    expect(slackStatus().conflictAt).toBeUndefined();
    expect(said.filter((l) => l.includes("sockets for this app"))).toEqual([]);
    expect(slack.calls.filter((c) => c.method === "apps.connections.open").length).toBeGreaterThanOrEqual(3);
    // another process holds a socket: the recheck still reads two, and that is a conflict
    slack.helloConnections(2);
    slack.disconnect("refresh_requested");
    await armed(opened + 2);
    await pause(50);
    expect(slackStatus().conflictAt).toBeUndefined();
    clock.fire(HELLO_DEADLINE_MS);
    await until(() => slackStatus().conflictAt !== undefined, 5000, "the conflict");
    expect(said.filter((l) => l.includes("sockets for this app"))).toHaveLength(1);
    // the link closes its own socket before it opens the next: never two of its own at once
    expect(slack.events.every((e) => e === "open 1" || e === "close 0")).toBe(true);
  });

  it("a second connection is recorded as conflict once a minute", async () => {
    slack.helloConnections(2);
    const confirm = async () => {
      const opened = hellos();
      slack.disconnect("refresh_requested");
      await armed(opened);
      clock.fire(HELLO_DEADLINE_MS);
      await until(() => hellos() === opened + 2, 5000, "the recheck's hello");
      await pause(50);
    };
    await confirm();
    const first = slackStatus().conflictAt;
    expect(first).toEqual(expect.any(String));
    expect(said.filter((l) => l.includes("sockets for this app"))).toHaveLength(1);
    // within the minute: the status moves, no second line
    await confirm();
    expect(slackStatus().conflictAt).toEqual(expect.any(String));
    expect(said.filter((l) => l.includes("sockets for this app"))).toHaveLength(1);
    clock.advance(61_000);
    await confirm();
    expect(said.filter((l) => l.includes("sockets for this app"))).toHaveLength(2);
    // a hello that counts one clears it
    slack.helloConnections(0);
    slack.disconnect("refresh_requested");
    await until(() => slackStatus().conflictAt === undefined, 5000, "the conflict cleared");
  });

  it("a restarted account resumes Slack from the cursor with the file's tokens", async () => {
    push(dm({ text: "before", ts: "1730813200.000100" }));
    await until(() => cursor() === "1730813200.000100");
    await srv.close();
    expect(slack.sockets()).toBe(0);
    // written while the account was down: only in the history, beside the one taken already
    slack.history.push({ ts: "1730813200.000100", user: OP, text: "before" });
    slack.history.push({ ts: "1730813300.000100", user: OP, text: "while down" });
    const calls = slack.calls.length;
    await boot();
    const a = await inbox(1, 8);
    expect(a.messages).toEqual([expect.objectContaining({ id: 2, text: "while down", messageId: "slack:1730813300.000100" })]);
    expect((await inbox(0, 0)).messages.map((m) => m.text)).toEqual(["before", "while down"]);
    const since = slack.calls.slice(calls);
    expect(since.find((c) => c.method === "apps.connections.open")!.authorization).toBe(`Bearer ${slack.tokens.app}`);
    const read = since.find((c) => c.method === "conversations.history")!;
    expect(read.authorization).toBe(`Bearer ${slack.tokens.bot}`);
    expect(read.form).toMatchObject({ channel: DM, oldest: "1730813200.000100" });
    expect(cursor()).toBe("1730813300.000100");
  });

  it("disconnect closes the socket and removes slack.json; Telegram's connection is untouched", async () => {
    // Telegram connected beside Slack
    const salt = newSalt();
    const keyHash = keyHashOf(salt, FAKE_BOT_TOKEN);
    const r = await call(srv.url, "/api/account/identity/telegram/token", { body: JSON.stringify({ token: FAKE_BOT_TOKEN, keyHash, salt }) });
    expect(r.status).toBe(200);
    const p = JSON.parse(r.text).pending as PendingView;
    const operator = { id: 555000123, first_name: "Pan", username: "pan" };
    tg.push({ update_id: 10, message: { message_id: 10, from: operator, chat: { id: operator.id, type: "private" }, date: 1_762_000_000, text: "/start" } });
    await until(() => svc.identity!.pending.view(p.id)?.state === "heard");
    const c = await own({ type: "connectNetwork", network: "telegram", pending: p.id, botId: String(tg.me.id), speaksAs: `@${tg.me.username}`, operatorId: String(operator.id), talksOnlyWith: "@pan", routing: "chat=slack,telegram;alerts=slack,telegram;brief=slack;cards=slack;fills=slack", keyHash, salt } as NoNonce<OwnerAction>);
    expect(isRefusal(c)).toBe(false);
    await until(() => svc.identity!.phoneStatus().networks.find((x) => x.network === "telegram")?.polling === true);
    expect(existsSync(join(home, "credentials", "networks", "slack.json"))).toBe(true);
    const d = await own({ type: "disconnectNetwork", network: "slack" } as NoNonce<OwnerAction>);
    expect(isRefusal(d)).toBe(false);
    await until(() => slack.sockets() === 0);
    expect(existsSync(join(home, "credentials", "networks", "slack.json"))).toBe(false);
    expect(existsSync(join(home, "credentials", "networks", "telegram.json"))).toBe(true);
    expect(svc.identity!.phoneStatus().networks.map((x) => x.network)).toEqual(["telegram"]);
    const opens = slack.calls.filter((x) => x.method === "apps.connections.open").length;
    await pause(100);
    expect(slack.calls.filter((x) => x.method === "apps.connections.open").length).toBe(opens);
    // Telegram still hears the operator
    tg.push({ update_id: 11, message: { message_id: 11, from: operator, chat: { id: operator.id, type: "private" }, date: 1_762_000_000, text: "still here" } });
    const a = await inbox(0, 5);
    expect(a.messages).toEqual([expect.objectContaining({ network: "telegram", text: "still here" })]);
    expect(svc.identity!.view().routing).toEqual({ chat: ["telegram"], alerts: ["telegram"], brief: [], cards: [], fills: [] });
  });
});
