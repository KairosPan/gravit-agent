/** The Slack Web API client, the Socket Mode link and the fake Slack they are tested against (plan B2, task 2). Every call and every socket
 * here goes to fakeSlack on loopback; every token is made up (slackTokens). */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { escapeSlack, SLACK_MANIFEST, SlackApi, SlackApiError, slackApiBase, socketUrlOk } from "../../src/portfolio/identity/slack-api.ts";
import { HELLO_DEADLINE_MS, LINK_DISABLED, SOCKET_REFRESH_MS, SlackSocket, type Envelope, type SocketLike } from "../../src/portfolio/identity/slack-socket.ts";
import type { IdentityClock } from "../../src/portfolio/identity/telegram.ts";
import { fakeSlack, slackTokens, type FakeSlack } from "../identity-fakes.ts";

const log = () => undefined;

async function until(cond: () => boolean, ms = 5_000, what = "the condition"): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** a clock whose waits fire at once (moving `now` by what they waited, read off `waits`), but whose 30-minute silence timer fires only
 * when the test says so (`silence()`), and whose 30 s hello deadline only at `noHello()` */
function testClock(): IdentityClock & { waits: number[]; silence(): void; noHello(): number } {
  let now = Date.parse("2026-11-04T15:00:00Z");
  const waits: number[] = [];
  const held = new Map<object, { ms: number; fn: () => void }>();
  const fire = (ms: number) => {
    now += ms;
    const due = [...held.entries()].filter(([, v]) => v.ms === ms);
    for (const [h] of due) held.delete(h);
    for (const [, v] of due) v.fn();
    return due.length;
  };
  return {
    waits,
    now: () => now,
    setTimeout: (fn, ms) => {
      if (ms === SOCKET_REFRESH_MS || ms === HELLO_DEADLINE_MS) {
        const h = {};
        held.set(h, { ms, fn });
        return h;
      }
      waits.push(ms);
      return setTimeout(() => {
        now += ms;
        fn();
      }, 5);
    },
    clearTimeout: (h) => {
      if (h !== null && typeof h === "object" && held.has(h)) held.delete(h);
      else clearTimeout(h as NodeJS.Timeout);
    },
    silence() {
      fire(SOCKET_REFRESH_MS);
    },
    noHello: () => fire(HELLO_DEADLINE_MS),
  };
}

/** sockets that open and never say a word: no hello, no frame; close() closes them (a close event, code 1000) */
function mute(): { open: (url: string) => SocketLike; opened: string[]; closed: number } {
  const out = { opened: [] as string[], closed: 0, open: (url: string): SocketLike => {
    out.opened.push(url);
    const listeners = new Map<string, Array<(ev: unknown) => void>>();
    let state = 1;
    return {
      get readyState() {
        return state;
      },
      send: () => undefined,
      close: () => {
        if (state === 3) return;
        state = 3;
        out.closed += 1;
        setTimeout(() => {
          for (const fn of listeners.get("close") ?? []) fn({ code: 1000, reason: "" });
        }, 1);
      },
      addEventListener: ((type: string, fn: (ev: unknown) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      }) as SocketLike["addEventListener"],
    } as SocketLike;
  } };
  return out;
}

const realClock = (): IdentityClock => ({
  now: Date.now,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
});

let slack: FakeSlack | undefined;
const sockets: SlackSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) await s.dispose();
  await slack?.close();
  slack = undefined;
});

const apiOf = (f: FakeSlack, o: { signal?: AbortSignal } = {}) => new SlackApi({ token: f.tokens.bot, appToken: f.tokens.app, apiBase: f.url, ...o });

describe("the Web API client", () => {
  it("each call is a form POST with the token in Authorization, never in the URL", async () => {
    slack = await fakeSlack();
    slack.history.push({ ts: "1730812345.001200", user: "U0OPER001", text: "one" }, { ts: "1730812346.001200", user: "U0OPER001", text: "two" }, { ts: "1730812347.001200", user: "U0OPER001", text: "three" });
    const api = apiOf(slack);
    expect(await api.authTest()).toEqual({ teamId: "T0FAKE001", team: "Fake Co", userId: "U0BOT0001", user: "gravit", botId: "B0BOT0001" });
    expect(await api.botsInfo("B0BOT0001")).toEqual({ appId: "A0FAKE001", name: "gravit" });
    expect(await api.usersInfo("U0OPER001")).toEqual({ name: "pan", displayName: "Pan", realName: "Pan Zhe", isBot: false, teamId: "T0FAKE001", restricted: false, deleted: false });
    expect((await api.usersInfo("U0BOT0001")).isBot).toBe(true);
    expect(await api.connectionsOpen()).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/link\//);
    const first = await api.history("D0FAKEDM1", "1730812345.001200", 1);
    expect(first.messages).toHaveLength(1);
    expect((first.messages[0] as { text: string }).text).toBe("three");
    const second = await api.history("D0FAKEDM1", "1730812345.001200", 1, first.next);
    expect((second.messages[0] as { text: string }).text).toBe("two");
    expect(second.next).toBeUndefined();
    const ts = await api.postMessage("D0FAKEDM1", "hello &amp; there");
    expect(ts).toMatch(/^\d{9,12}\.\d{6}$/);
    expect(slack.posted).toEqual([{ ts: expect.any(String), channel: "D0FAKEDM1", text: "hello &amp; there", mrkdwn: "false", unfurl_links: "false", unfurl_media: "false" }]);

    expect(slack.calls.map((c) => c.method)).toEqual(["auth.test", "bots.info", "users.info", "users.info", "apps.connections.open", "conversations.history", "conversations.history", "chat.postMessage"]);
    for (const c of slack.calls) {
      expect(c.contentType).toMatch(/^application\/x-www-form-urlencoded/);
      expect(c.authorization).toBe(`Bearer ${c.method === "apps.connections.open" ? slack.tokens.app : slack.tokens.bot}`);
      for (const t of [slack.tokens.app, slack.tokens.bot]) {
        expect(c.url).not.toContain(t);
        expect(c.url).not.toContain(encodeURIComponent(t));
        expect(Object.values(c.form).join(" ")).not.toContain(t);
      }
    }
    expect(slack.calls[5]!.form).toMatchObject({ channel: "D0FAKEDM1", oldest: "1730812345.001200", inclusive: "false", limit: "1" });

    // a token the fake does not know is invalid_auth; a client without the app-level token cannot open a socket
    const wrong = new SlackApi({ token: slackTokens().user, apiBase: slack.url });
    await expect(wrong.authTest()).rejects.toMatchObject({ name: "SlackApiError", code: "invalid_auth" });
    await expect(wrong.connectionsOpen()).rejects.toThrow(/app-level token/);
  });

  it("ok:false is a SlackApiError with Slack's code; 429 carries Retry-After", async () => {
    slack = await fakeSlack();
    const api = apiOf(slack);
    slack.answer("chat.postMessage", 200, { ok: false, error: "channel_not_found" });
    const e1 = await api.postMessage("D0NOPE", "x").catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(SlackApiError);
    expect(e1).toMatchObject({ status: 200, code: "channel_not_found", message: "HTTP 200 channel_not_found" });
    expect((e1 as SlackApiError).retryAfterS).toBeUndefined();

    slack.answer("chat.postMessage", 429, { ok: false, error: "ratelimited" }, { "retry-after": "7" });
    await expect(api.postMessage("D0FAKEDM1", "x")).rejects.toMatchObject({ status: 429, code: "ratelimited", retryAfterS: 7 });

    // an error that says no code is the HTTP status; one that holds a token says <token>
    slack.answer("auth.test", 503, { nothing: true });
    await expect(api.authTest()).rejects.toMatchObject({ status: 503, code: "http_503" });
    const t = slackTokens();
    slack.answer("auth.test", 200, { ok: false, error: `bad ${slack.tokens.bot} and ${t.user} and ${t.refresh}` });
    const e2 = (await api.authTest().catch((e: unknown) => e)) as SlackApiError;
    for (const tok of [slack.tokens.bot, t.user, t.refresh]) {
      expect(e2.message).not.toContain(tok);
      expect(e2.code).not.toContain(tok);
    }
    expect(e2.message).toBe("HTTP 200 bad <token> and <token> and <token>");

    // a network failure is an Error that names no token; an aborted client refuses at once
    const port = Number(new URL(slack.url).port);
    await slack.close();
    slack = undefined;
    const gone = new SlackApi({ token: t.bot, appToken: t.app, apiBase: `http://127.0.0.1:${port}/api` });
    const e3 = (await gone.authTest().catch((e: unknown) => e)) as Error;
    expect(e3).not.toBeInstanceOf(SlackApiError);
    expect(e3.message).not.toContain(t.bot);
    const stop = new AbortController();
    stop.abort();
    await expect(new SlackApi({ token: t.bot, apiBase: `http://127.0.0.1:${port}/api`, signal: stop.signal }).authTest()).rejects.toThrow("stopped");
  });

  it("the base takes only a loopback http override; the socket URL only slack.com's wss or that loopback port", () => {
    const lines: string[] = [];
    const say = (l: string) => lines.push(l);
    expect(slackApiBase({}, say)).toBe("https://slack.com/api");
    expect(slackApiBase({ ACCOUNT_SLACK_API: "https://evil.example" }, say)).toBe("https://slack.com/api");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("evil.example");
    expect(slackApiBase({ ACCOUNT_SLACK_API: "http://127.0.0.1:8" }, log)).toBe("http://127.0.0.1:8/api");
    expect(slackApiBase({ ACCOUNT_SLACK_API: "http://127.0.0.1:8/api" }, log)).toBe("http://127.0.0.1:8/api");
    for (const v of ["http://localhost:8", "http://127.0.0.1", "http://127.0.0.1:99999", "http://127.0.0.1:8/other", "http://127.0.0.1:8@evil.example", "https://127.0.0.1:8"]) {
      expect(slackApiBase({ ACCOUNT_SLACK_API: v }, log), v).toBe("https://slack.com/api");
    }

    expect(socketUrlOk("wss://wss-primary.slack.com/link/?ticket=x", "https://slack.com/api")).toBe(true);
    expect(socketUrlOk("wss://wss-backup.slack.com/link/?ticket=x&app_id=y", "https://slack.com/api")).toBe(true);
    expect(socketUrlOk("wss://slack.com.evil.example/link", "https://slack.com/api")).toBe(false);
    expect(socketUrlOk("wss://evilslack.com/link", "https://slack.com/api")).toBe(false);
    expect(socketUrlOk("ws://wss-primary.slack.com/link", "https://slack.com/api")).toBe(false);
    expect(socketUrlOk("wss://wss-primary.slack.com:8443/link", "https://slack.com/api")).toBe(false);
    expect(socketUrlOk("wss://u:p@wss-primary.slack.com/link", "https://slack.com/api")).toBe(false);
    expect(socketUrlOk("ws://127.0.0.1:8/link", "https://slack.com/api")).toBe(false);
    expect(socketUrlOk("ws://127.0.0.1:9/link", "http://127.0.0.1:8/api")).toBe(false);
    expect(socketUrlOk("ws://127.0.0.1:8/link/?ticket=x", "http://127.0.0.1:8/api")).toBe(true);
    expect(socketUrlOk("wss://wss-primary.slack.com/link", "http://127.0.0.1:8/api")).toBe(false);
    expect(socketUrlOk("ws://localhost:8/link", "http://127.0.0.1:8/api")).toBe(false);
    expect(socketUrlOk("ws://127.0.0.1:8/link", "https://evil.example/api")).toBe(false);
    expect(socketUrlOk("not a url", "https://slack.com/api")).toBe(false);
  });

  it("escapeSlack escapes &, < and > and nothing else", () => {
    expect(escapeSlack("<!channel> a & b <https://x|y>")).toBe("&lt;!channel&gt; a &amp; b &lt;https://x|y&gt;");
    expect(escapeSlack("*bold* _it_ `code` \"q\" 'a' &amp;")).toBe("*bold* _it_ `code` \"q\" 'a' &amp;amp;");
  });

  it("the manifest is Socket Mode, a bot user, the DM tab writable, three bot scopes and message.im", () => {
    expect(SLACK_MANIFEST).toContain("\n  ");
    const m = JSON.parse(SLACK_MANIFEST) as Record<string, any>;
    expect(m.display_information.name).toBe("Gravit");
    expect(m.features.app_home).toEqual({ home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false });
    expect(m.features.bot_user).toEqual({ display_name: "Gravit", always_online: true });
    expect(m.oauth_config.scopes.bot).toEqual(["chat:write", "im:history", "users:read"]);
    expect(m.settings).toEqual({ event_subscriptions: { bot_events: ["message.im"] }, interactivity: { is_enabled: false }, org_deploy_enabled: false, socket_mode_enabled: true, token_rotation_enabled: false });
  });
});

describe("the Socket Mode link", () => {
  const start = (f: FakeSlack, clock: IdentityClock, lines: string[] = []) => {
    const s = new SlackSocket({ api: apiOf(f), apiBase: f.url, clock, log: (l) => lines.push(l) });
    sockets.push(s);
    return s;
  };

  it("the socket: hello first, then envelopes in order; ack sends the envelope_id; hold sends nothing", async () => {
    slack = await fakeSlack();
    const order: string[] = [];
    const seen: Envelope[] = [];
    const s = start(slack, realClock());
    s.run({
      hello: async (h) => {
        order.push(`hello ${h.appId} ${h.connections}`);
        await pause(60);
        order.push("hello done");
      },
      envelope: async (e) => {
        seen.push(e);
        if (e.envelopeId === "e1") await pause(30);
        order.push(e.envelopeId);
        return e.envelopeId === "e2" ? "hold" : "ack";
      },
      down: () => undefined,
    });
    await until(() => slack!.sockets() === 1, 5_000, "the socket");
    slack.push({ envelope_id: "e1", type: "events_api", payload: { event: { type: "message", text: "one" } }, accepts_response_payload: false, retry_attempt: 0, retry_reason: "" });
    slack.push({ envelope_id: "e2", type: "events_api", payload: { n: 2 }, retry_attempt: 2, retry_reason: "timeout" });
    slack.push({ envelope_id: "e3", type: "slash_commands", payload: { n: 3 } });
    await until(() => slack!.acks.length === 2, 5_000, "two acks");
    await pause(50);
    expect(order).toEqual(["hello A0FAKE001 1", "hello done", "e1", "e2", "e3"]);
    expect(slack.acks).toEqual(["e1", "e3"]);
    expect(seen.map((e) => [e.envelopeId, e.type, e.retryAttempt])).toEqual([["e1", "events_api", 0], ["e2", "events_api", 2], ["e3", "slash_commands", 0]]);
    expect(seen[0]!.payload).toEqual({ event: { type: "message", text: "one" } });
    const st = s.status();
    expect(st.open).toBe(true);
    expect(st.failing).toBeUndefined();
    expect(typeof st.lastFrameAt).toBe("string");
  });

  it("a frame over 64 KiB, or one that is not JSON, is dropped with one line", async () => {
    slack = await fakeSlack();
    const lines: string[] = [];
    const handled: string[] = [];
    const s = start(slack, realClock(), lines);
    s.run({ hello: async () => {}, envelope: async (e) => (handled.push(e.envelopeId), "ack"), down: () => undefined });
    await until(() => s.status().open, 5_000, "the hello");
    slack.pushText("this is not json {");
    slack.pushText("[1, 2]");
    slack.push({ envelope_id: "big", type: "events_api", payload: { text: "x".repeat(70 * 1024) } });
    slack.push({ envelope_id: "small", type: "events_api", payload: {} });
    await until(() => slack!.acks.includes("small"), 5_000, "the small ack");
    expect(handled).toEqual(["small"]);
    expect(slack.acks).toEqual(["small"]);
    expect(lines.filter((l) => l.includes("over 64 KiB"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("not a JSON object"))).toHaveLength(1);
  });

  it("refresh_requested reconnects at once; a close backs off 5 s doubling to 60 s; link_disabled stops and says so", async () => {
    slack = await fakeSlack();
    const clock = testClock();
    const lines: string[] = [];
    const hellos: number[] = [];
    const downs: string[] = [];
    const s = start(slack, clock, lines);
    s.run({ hello: async (h) => void hellos.push(h.connections), envelope: async () => "ack", down: (r) => void downs.push(r) });
    await until(() => hellos.length === 1, 5_000, "the first hello");

    // refresh: the old socket is closed before the next is opened, so the next hello counts one; no wait between
    slack.disconnect("refresh_requested");
    await until(() => hellos.length === 2, 5_000, "the second hello");
    expect(clock.waits).toEqual([]);
    expect(hellos).toEqual([1, 1]);
    expect(slack.events).toEqual(["open 1", "close 0", "open 1"]);
    expect(downs).toEqual(["Slack asked for a fresh socket"]);

    // a warning is nothing to do
    slack.disconnect("warning");
    await pause(50);
    expect(slack.sockets()).toBe(1);
    expect(hellos).toHaveLength(2);

    // a close: 5 s, then a hello resets the backoff
    slack.drop();
    await until(() => hellos.length === 3, 5_000, "the third hello");
    expect(clock.waits).toEqual([5_000]);
    expect(downs[1]).toMatch(/^the socket closed \(\d+/);

    // a close, then failing opens: 5 s doubling to 60 s, said at most once a minute
    const before = lines.length;
    slack.answer("apps.connections.open", 200, { ok: false, error: "internal_error" });
    slack.drop();
    await until(() => clock.waits.length >= 7, 5_000, "six waits");
    expect(clock.waits.slice(1, 7)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(s.status().open).toBe(false);
    expect(s.status().failing?.reason).toBe("HTTP 200 internal_error");
    const said = lines.length - before;
    expect(said).toBeGreaterThan(0);
    expect(said).toBeLessThan(6);
    slack.answer("apps.connections.open", 0, {});
    await until(() => hellos.length === 4, 5_000, "the fourth hello");
    expect(s.status().failing).toBeUndefined();

    // link_disabled: closed, said, and never opened again
    slack.disconnect("link_disabled");
    await until(() => s.status().failing?.reason === LINK_DISABLED, 5_000, "the link disabled");
    await until(() => slack!.sockets() === 0, 5_000, "the socket closed");
    const opens = slack.calls.filter((c) => c.method === "apps.connections.open").length;
    await pause(100);
    expect(slack.calls.filter((c) => c.method === "apps.connections.open").length).toBe(opens);
    expect(s.status().open).toBe(false);
    expect(downs.at(-1)).toBe(LINK_DISABLED);
    expect(lines.filter((l) => l.includes(LINK_DISABLED))).toHaveLength(1);
    for (const l of lines) for (const t of [slack.tokens.app, slack.tokens.bot, "ticket="]) expect(l).not.toContain(t);
  });

  it("a socket silent for 30 minutes is reopened", async () => {
    slack = await fakeSlack();
    const clock = testClock();
    const hellos: number[] = [];
    const s = start(slack, clock);
    s.run({ hello: async (h) => void hellos.push(h.connections), envelope: async () => "ack", down: () => undefined });
    await until(() => hellos.length === 1, 5_000, "the first hello");
    await pause(50);
    expect(slack.sockets()).toBe(1);
    clock.silence();
    await until(() => hellos.length === 2, 5_000, "the second hello");
    expect(hellos).toEqual([1, 1]);
    expect(slack.events).toEqual(["open 1", "close 0", "open 1"]);
    expect(slack.calls.filter((c) => c.method === "apps.connections.open")).toHaveLength(2);
    expect(clock.waits).toEqual([]);
  });

  it("a socket URL off Slack's host, or off the loopback port, is refused and never opened", async () => {
    slack = await fakeSlack();
    const lines: string[] = [];
    const clock = testClock();
    slack.socketUrl("ws://127.0.0.1:9/link/?ticket=steer");
    const s = start(slack, clock, lines);
    s.run({ hello: async () => {}, envelope: async () => "ack", down: () => undefined });
    await until(() => s.status().failing !== undefined, 5_000, "the refusal");
    expect(s.status().failing?.reason).toBe("the socket URL Slack answered is not Slack's");
    expect(slack.events).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("ticket");
    slack.socketUrl("");
    await until(() => s.status().open, 5_000, "the hello once the URL is the fake's own");
    expect(slack.sockets()).toBe(1);
  });

  it("a socket with no hello in 30 s is closed and opened again after the backoff", async () => {
    slack = await fakeSlack();
    const clock = testClock();
    const lines: string[] = [];
    const quiet = mute();
    const downs: string[] = [];
    const s = new SlackSocket({ api: apiOf(slack), apiBase: slack.url, open: quiet.open, clock, log: (l) => lines.push(l) });
    sockets.push(s);
    s.run({ hello: async () => {}, envelope: async () => "ack", down: (r) => void downs.push(r) });
    await until(() => quiet.opened.length === 1, 5_000, "the first socket");
    await pause(30);
    // nothing before the deadline: the socket waits, and the status is not open
    expect(quiet.closed).toBe(0);
    expect(s.status().open).toBe(false);
    expect(clock.noHello()).toBe(1);
    await until(() => quiet.opened.length === 2, 5_000, "the second socket");
    expect(quiet.closed).toBe(1);
    expect(clock.waits).toEqual([5_000]);
    expect(downs).toEqual(["the socket sent no hello in 30 s"]);
    expect(s.status().failing?.reason).toBe("the socket sent no hello in 30 s");
    expect(lines.filter((l) => l.includes("sent no hello in 30 s"))).toHaveLength(1);
    // again: the backoff doubles
    expect(clock.noHello()).toBe(1);
    await until(() => quiet.opened.length === 3, 5_000, "the third socket");
    expect(clock.waits).toEqual([5_000, 10_000]);
  });

  it("a hello whose handler throws closes the socket and backs off, and the next hello is handed over again", async () => {
    slack = await fakeSlack();
    const clock = testClock();
    const lines: string[] = [];
    const seen: string[] = [];
    let fails = 2;
    const s = start(slack, clock, lines);
    s.run({
      hello: async () => {
        seen.push("hello");
        if (fails-- > 0) throw new Error("the backfill failed (HTTP 200 internal_error)");
      },
      envelope: async (e) => (seen.push(e.envelopeId), "ack"),
      down: () => undefined,
    });
    await until(() => seen.filter((x) => x === "hello").length === 3, 5_000, "three hellos");
    // each failed hello closed its socket and backed off, doubling; the hello that went resets the status
    expect(clock.waits).toEqual([5_000, 10_000]);
    expect(slack.events).toEqual(["open 1", "close 0", "open 1", "close 0", "open 1"]);
    await until(() => s.status().open && s.status().failing === undefined, 5_000, "open again");
    expect(lines.some((l) => l.includes("its hello could not be handled (the backfill failed (HTTP 200 internal_error))"))).toBe(true);
    slack.push({ envelope_id: "after", type: "events_api", payload: {} });
    await until(() => slack!.acks.includes("after"), 5_000, "the ack");
    expect(seen.at(-1)).toBe("after");
  });

  it("reopen closes the socket and opens a fresh one at once", async () => {
    slack = await fakeSlack();
    const clock = testClock();
    const hellos: number[] = [];
    const downs: string[] = [];
    const s = start(slack, clock);
    s.run({ hello: async (h) => void hellos.push(h.connections), envelope: async () => "ack", down: (r) => void downs.push(r) });
    await until(() => hellos.length === 1, 5_000, "the first hello");
    s.reopen("a recheck");
    await until(() => hellos.length === 2, 5_000, "the second hello");
    expect(slack.events).toEqual(["open 1", "close 0", "open 1"]);
    expect(downs).toEqual(["a recheck"]);
    expect(clock.waits).toEqual([]);
  });

  it("dispose closes the socket and stops", async () => {
    slack = await fakeSlack();
    const s = start(slack, realClock());
    s.run({ hello: async () => {}, envelope: async () => "ack", down: () => undefined });
    await until(() => s.status().open, 5_000, "the hello");
    await s.dispose();
    await until(() => slack!.sockets() === 0, 5_000, "the close");
    expect(s.status().open).toBe(false);
    const opens = slack.calls.length;
    await pause(50);
    expect(slack.calls.length).toBe(opens);
  });
});

describe("Slack's address", () => {
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
  it("account/src names slack.com in identity/slack-api.ts alone", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(100);
    const naming = files.filter(([, text]) => /slack\.com/i.test(text) || text.includes("slack\\.com")).map(([file]) => file);
    expect(naming).toEqual([join("portfolio", "identity", "slack-api.ts")]);
  });
});
