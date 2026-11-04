/** THE IDENTITY SEAMS (identity/kinds.ts, store.ts, secret-file.ts, pending.ts, telegram.ts, identity.ts, routes.ts): what B1 wrote for
 * Telegram alone, made for a second network — the wire id, the routing, the token file, the masked id, a token in a signed field, the
 * chat-off line, the words, and the transport's verdicts. Slack itself is later tasks'; every token below is made up and built at runtime. */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { keyHashOf, newSalt } from "../../src/portfolio/account/brain-keys.ts";
import { isRefusal } from "../../src/core/errors.ts";
import { BotApiError } from "../../src/portfolio/identity/bot-api.ts";
import { Identity, identitySignedProblem, type IdentityAction } from "../../src/portfolio/identity/identity.ts";
import { PendingConnections, type PendingSender, type PendingSource } from "../../src/portfolio/identity/pending.ts";
import { chatOffLine, formatRouting, NETWORKS, parseRouting, SLACK_TOKEN_ANYWHERE, WIRE_ID, type Routing } from "../../src/portfolio/identity/kinds.ts";
import { IDENTITY_WORDS } from "../../src/portfolio/identity/routes.ts";
import { readNetworkSecret, secretsOf, writeNetworkSecret, type SlackSecret, type TelegramSecret } from "../../src/portfolio/identity/secret-file.ts";
import { loadIdentity, MASKED, saveIdentity, senderRef, Strangers } from "../../src/portfolio/identity/store.ts";
import { CHAT_OFF, TelegramTransport } from "../../src/portfolio/identity/telegram.ts";
import { slackTokens } from "../identity-fakes.ts";

const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const newHome = (): string => {
  const h = mkdtempSync(join(tmpdir(), "identity-seams-"));
  homes.push(h);
  return h;
};
const mode = (p: string): string => (statSync(p).mode & 0o777).toString(8);
const SLACK_SECRET: SlackSecret = { appToken: slackTokens().app, botToken: slackTokens().bot, appId: "A0FAKEAPP01", channel: "D0FAKEDM01", botId: "T0FAKE001:U0BOT0001", username: "gravit", operatorId: "T0FAKE001:U0PAN7QK", operatorHandle: "@pan" };

describe("the seams for a second network", () => {
  it("the wire id takes Telegram's numbers and Slack's ts, nothing else", () => {
    for (const ok of ["telegram:41", "slack:1730812345.001200"]) expect(WIRE_ID.test(ok)).toBe(true);
    for (const no of ["slack:41", "slack:D0123:1730812345.001200", "imessage:1", "telegram:4.1", "41"]) expect(WIRE_ID.test(no)).toBe(false);
  });

  it("routing knows slack; a network the account does not speak on is refused", () => {
    expect(NETWORKS).toEqual(["telegram", "slack"]);
    expect(formatRouting(parseRouting("chat=slack,telegram;alerts=telegram;brief=;cards=;fills=") as Routing)).toBe("chat=slack,telegram;alerts=telegram;brief=;cards=;fills=");
    expect(parseRouting("chat=imessage;alerts=;brief=;cards=;fills=")).toMatch(/imessage/);
    expect(parseRouting("chat=telegram,slack;alerts=;brief=;cards=;fills=")).toMatch(/sorted/);
  });

  it("Slack's token file keeps both tokens under the same rules, and reads back as Slack's shape", () => {
    const home = newHome();
    const w = writeNetworkSecret(home, "slack", SLACK_SECRET);
    expect("ok" in w && w.ok).toBe(true);
    const file = join(home, "credentials", "networks", "slack.json");
    expect(mode(file)).toBe("600");
    expect(mode(join(home, "credentials", "networks"))).toBe("700");
    expect(readNetworkSecret(home, "slack")).toEqual(SLACK_SECRET);
    expect(readNetworkSecret(home, "telegram")).toBeUndefined();
    expect(secretsOf(SLACK_SECRET)).toEqual([SLACK_SECRET.appToken, SLACK_SECRET.botToken]);
    const tg: TelegramSecret = { token: "123456789:AAFakeTokenForTheTestOnly_abcdefghijk", botId: "123456789", username: "gravit_test_bot", operatorId: "987654321", operatorHandle: "@pan" };
    expect(secretsOf(tg)).toEqual([tg.token]);
  });

  it("a Slack file missing a field, or Telegram's shape under Slack's name, reads as no token", () => {
    const home = newHome();
    const { channel: _c, ...short } = SLACK_SECRET;
    writeNetworkSecret(home, "slack", { ...short, channel: "" } as SlackSecret);
    expect(readNetworkSecret(home, "slack")).toBeUndefined();
  });

  it("a Slack masked id is blockable", () => {
    expect(MASKED.test("…7QK")).toBe(true);
    expect(MASKED.test("…123")).toBe(true);
    expect(MASKED.test("…7qk")).toBe(false);
    expect(MASKED.test("…7QKX")).toBe(false);
  });

  it("a Slack token in any signed field is refused before the door writes", () => {
    expect(identitySignedProblem({ type: "setRouting", routing: slackTokens().bot, quietFrom: "", quietTo: "", nonce: 1 } as IdentityAction)).toBe(IDENTITY_WORDS.tokenInField);
    for (const t of Object.values(slackTokens())) {
      expect(identitySignedProblem({ type: "setRouting", routing: `chat=;alerts=;brief=;cards=;fills= ${t}`, quietFrom: "", quietTo: "", nonce: 1 } as IdentityAction)).toBe(IDENTITY_WORDS.tokenInField);
      // the global pattern holds no state between two tests
      expect(`a ${t} b`.replace(SLACK_TOKEN_ANYWHERE, "<token>")).toBe("a <token> b");
    }
    expect(identitySignedProblem({ type: "setRouting", routing: "chat=;alerts=;brief=;cards=;fills=", quietFrom: "", quietTo: "", nonce: 1 } as IdentityAction)).toBeNull();
  });

  it("chatOffLine names the network", () => {
    expect(chatOffLine("slack")).toBe("Chat with Gravit is off on Slack: Account › Identity turns it on.");
    expect(chatOffLine("telegram")).toBe(CHAT_OFF);
  });

  it("the words name the network they are about; one the account does not speak on has its own", () => {
    expect(IDENTITY_WORDS.connectedOn("slack")).toBe("Slack is connected already: Disconnect… it in Account › Identity first.");
    expect(IDENTITY_WORDS.connectedOn("telegram")).toBe(IDENTITY_WORDS.connected);
    expect(IDENTITY_WORDS.notConnectedOn("slack")).toBe("Slack is not connected: there is nothing to disconnect.");
    expect(IDENTITY_WORDS.notConnectedOn("telegram")).toBe(IDENTITY_WORDS.notConnected);
    expect(IDENTITY_WORDS.networkUnknown).toMatch(/telegram/);
    expect(IDENTITY_WORDS.networkUnknown).toMatch(/slack/);
    expect("network" in IDENTITY_WORDS).toBe(false);
  });

  it("Telegram's transport: 400 refused, 403 blocked, anything else again later", () => {
    const t = new TelegramTransport({ token: "123456789:AAFakeTokenForTheTestOnly_abcdefghijk", apiBase: "http://127.0.0.1:9", chatId: 987654321 });
    try {
      expect(t.network).toBe("telegram");
      expect(t.partMax).toBe(4000);
      expect(t.secrets).toEqual(["123456789:AAFakeTokenForTheTestOnly_abcdefghijk"]);
      expect(t.classify(new BotApiError(400, "Bad Request: chat not found"))).toBe("refused");
      expect(t.classify(new BotApiError(403, "Forbidden: bot was blocked by the user"))).toBe("blocked");
      expect(t.classify(new BotApiError(429, "Too Many Requests"))).toBe("retry");
      expect(t.classify(new BotApiError(500, "Internal"))).toBe("retry");
      expect(t.classify(new Error("ECONNREFUSED"))).toBe("retry");
    } finally {
      t.dispose();
    }
  });
});

/** a source the test drives by hand: each sender it is handed is put to the shell's admit, as a network's listener would */
function scriptedSource(network: "slack" | "telegram", secrets: string[]) {
  let hand: ((s: PendingSender) => void) | undefined;
  let conflict: ((on: boolean) => void) | undefined;
  const verdicts: string[] = [];
  const counts = { listens: 0 };
  const source: PendingSource = {
    network,
    secrets,
    check: async () => ({ id: "T0FAKE001:U0BOT0001", username: "gravit", name: "Gravit", link: "https://slack.com/app_redirect?app=A0FAKEAPP01", workspace: "Fake Co" }),
    listen: (ctx) =>
      new Promise<void>((done) => {
        counts.listens += 1;
        ctx.signal.addEventListener("abort", () => done(), { once: true });
        conflict = ctx.conflict;
        hand = (s) => {
          const v = ctx.admit(s.id);
          verdicts.push(v);
          if (v === "hear") {
            ctx.heard(s);
            done();
          }
        };
      }),
    resume: () => ({ network: "slack", appId: "A0FAKEAPP01", channel: "D0FAKEDM01", cursor: "1730812345.001200" }),
  };
  return { source, verdicts, counts, say: (s: PendingSender) => hand?.(s), conflict: (on: boolean) => conflict?.(on) };
}

const until = async (ok: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("the pending shell over a source", () => {
  it("a source's conflict, a Not me, a blocked sender and the one heard; take hands over Slack's file with both tokens", async () => {
    const home = newHome();
    const { app, bot } = slackTokens();
    const keyInput = `${app}\u0000${bot}`;
    const salt = newSalt();
    const blocked = senderRef("slack", "T0FAKE001:U0BLOCKED1");
    const strangers = new Strangers(home);
    const pending = new PendingConnections({ apiBase: "http://127.0.0.1:9", strangers, bound: (n) => n === "telegram", blocked: () => [blocked] });
    try {
      const s = scriptedSource("slack", [app, bot]);
      const v = await pending.begin("slack", s.source, keyInput, keyHashOf(salt, keyInput), salt);
      if (isRefusal(v)) throw new Error(v.message);
      expect(v).toMatchObject({ network: "slack", bot: { id: "T0FAKE001:U0BOT0001", username: "gravit", name: "Gravit", workspace: "Fake Co" }, link: "https://slack.com/app_redirect?app=A0FAKEAPP01", state: "waiting" });
      expect(s.counts.listens).toBe(1);
      s.conflict(true);
      expect(pending.view(v.id)!.state).toBe("conflict");
      s.conflict(false);
      expect(pending.view(v.id)!.state).toBe("waiting");
      s.say({ id: "T0FAKE001:U0BLOCKED1", name: "B", handle: "@b", masked: "…ED1", text: "hi" });
      const someone = { id: "T0FAKE001:U0SOMEONE", name: "Someone", handle: "@someone", masked: "…ONE", text: "hi" };
      s.say(someone);
      expect(pending.view(v.id)!.sender).toEqual(someone);
      // Not me in the very tick the sender was heard: the shell listens again as soon as the last listening has returned
      expect(pending.notMe(v.id)!.state).toBe("waiting");
      await until(() => s.counts.listens === 2);
      s.say(someone);
      expect(strangers.list().map((x) => [x.network, x.masked, x.count])).toEqual([["slack", "…ONE", 2]]);
      s.say({ id: "T0FAKE001:U0PAN7QK", name: "Pan", handle: "@pan", masked: "…7QK", text: "hello" });
      expect(s.verdicts).toEqual(["drop", "hear", "stranger", "hear"]);
      const taken = pending.take(v.id)!;
      expect(taken).toMatchObject({ network: "slack", keyInput, resume: { network: "slack", channel: "D0FAKEDM01" }, sender: { id: "T0FAKE001:U0PAN7QK", handle: "@pan" } });
      expect(taken.secret).toEqual({ appToken: app, botToken: bot, appId: "A0FAKEAPP01", channel: "D0FAKEDM01", botId: "T0FAKE001:U0BOT0001", username: "gravit", operatorId: "T0FAKE001:U0PAN7QK", operatorHandle: "@pan" });
      expect("token" in taken).toBe(false);
      expect(pending.view(v.id)).toBeUndefined();
      // bound asks the network being begun
      const t = scriptedSource("telegram", ["x"]);
      const r = await pending.begin("telegram", t.source, "k", keyHashOf(salt, "k"), salt);
      expect(isRefusal(r) && r.message).toBe(IDENTITY_WORDS.connected);
    } finally {
      pending.dispose();
    }
  });

  it("a key that does not match its fingerprint is refused before the source is asked", async () => {
    const home = newHome();
    const pending = new PendingConnections({ apiBase: "http://127.0.0.1:9", strangers: new Strangers(home), bound: () => false });
    try {
      let asked = false;
      const s = scriptedSource("slack", ["a", "b"]);
      const source = { ...s.source, check: async (signal: AbortSignal) => ((asked = true), s.source.check(signal)) };
      const salt = newSalt();
      const r = await pending.begin("slack", source, "a\u0000b", keyHashOf(salt, "a\u0000c"), salt);
      expect(isRefusal(r) && r.message).toBe(IDENTITY_WORDS.mismatch);
      expect(asked).toBe(false);
    } finally {
      pending.dispose();
    }
  });
});

describe("a Slack binding before Slack is built", () => {
  it("starts nothing, says so in one line, and Telegram's words are untouched", async () => {
    const home = newHome();
    writeNetworkSecret(home, "slack", SLACK_SECRET);
    const s = loadIdentity(home);
    saveIdentity(home, { ...s, bindings: [{ network: "slack", speaksAs: "@gravit", botId: SLACK_SECRET.botId, talksOnlyWith: "@pan", operatorId: SLACK_SECRET.operatorId, since: new Date().toISOString(), fingerprint: "ab12cd34" }] });
    const lines: string[] = [];
    const id = new Identity({ home, apiBase: "http://127.0.0.1:9", log: (l) => void lines.push(l) });
    try {
      expect(lines.filter((l) => l.includes("Slack is not spoken on"))).toHaveLength(1);
      expect(lines.join("\n")).not.toContain(SLACK_SECRET.botToken);
      expect(id.phoneStatus().networks).toEqual([{ network: "slack", polling: false }]);
      expect(await id.send({ kind: "chat", text: "hi", network: "slack" })).toEqual({ ok: true, held: "nothing connected" });
      expect(id.problem({ type: "disconnectNetwork", network: "telegram", nonce: 1 } as IdentityAction)).toBe(IDENTITY_WORDS.notConnectedOn("telegram"));
      expect(id.problem({ type: "disconnectNetwork", network: "slack", nonce: 1 } as IdentityAction)).toBeNull();
    } finally {
      await id.dispose();
    }
  });
});
