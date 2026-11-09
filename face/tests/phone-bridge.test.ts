// face/tests/phone-bridge.test.ts
/** The desk's phone bridge (src/phone-bridge.ts) and its client of the account (src/phone.ts): the five commands, the
 * desk conversation's outlet, the inbox cursor across restarts, the slow line and the accept bound, and what an account
 * that does not answer does. Offline: a fake account on loopback (tests/fake-phone-account.ts) - no request leaves the
 * machine, and nothing here reaches a network - a fake conversation port and a manual clock. Homes sit inside the
 * repository, under tests/tmp/phone-bridge-<pid>/, and are removed afterwards. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTE_FILE, MUTE_USAGE, OFF_FILE, deskDir, deskStatusLines, readEvents, type DeskStatus } from "../src/desk.ts";
import type { DeskConversation, DeskOutlet, PostResult } from "../src/desk-conversation.ts";
import type { DeskClock } from "../src/desk-session.ts";
import { CURSOR_FILE, ONE_CONVERSATION, deliveryKey, installPhoneBridge, parseCommand, type PhoneBridgeHandle, type PhoneConversation } from "../src/phone-bridge.ts";
import { WIRE_ID, createPhoneClient, type InboxMessage } from "../src/phone.ts";
import { fakePhoneAccount, type FakePhoneAccount } from "./fake-phone-account.ts";

/* ---------- fixtures, inside the repository ---------- */

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, "tmp", `phone-bridge-${process.pid}`);
let made = 0;
async function freshHome(label: string): Promise<string> {
  const dir = join(TMP, `${++made}-${label}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
const accounts: FakePhoneAccount[] = [];
after(async () => {
  await Promise.all(accounts.map((a) => a.close()));
  await rm(TMP, { recursive: true, force: true });
});

async function waitFor(what: string, ok: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 2));
  }
}

/** 14:30 ET on 2026-10-20. */
const NOW = Date.parse("2026-10-20T18:30:00Z");
const AT = new Date(NOW).toISOString();

/* ---------- the fakes ---------- */

/** A manual clock: timers fire only when {@link advance} moves past them. */
class Clock implements DeskClock {
  private timers: { at: number; ms: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  constructor(private t: number) {}
  now(): number { return this.t; }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ at: this.t + ms, ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown): void { this.timers = this.timers.filter((x) => x.id !== handle); }
  has(ms: number): boolean { return this.timers.some((x) => x.ms === ms); }
  advance(ms: number): void {
    const until = this.t + ms;
    for (const timer of [...this.timers].sort((a, b) => a.at - b.at)) {
      if (timer.at > until) break;
      if (!this.timers.includes(timer)) continue;
      this.timers = this.timers.filter((x) => x !== timer);
      this.t = timer.at;
      timer.fn();
    }
    this.t = until;
  }
}

type PostInput = Parameters<DeskConversation["post"]>[0];

/** The conversation port as the bridge drives it. Its keys play the desk session's log: a keyed post whose key it holds
 * answers `duplicate`; any other is a turn, its key held from the followup on. */
class FakeConversation {
  readonly posts: PostInput[] = [];
  readonly held = new Set<string>();
  readonly turns: string[] = [];
  readonly outlets: (DeskOutlet | undefined)[] = [];
  readonly stops: string[] = [];
  renews = 0;
  readonly answers: PostResult[] = [];
  stopAnswer = true;
  stopFails: string | undefined;
  renewFails: string | undefined;
  gate: Promise<void> | undefined;
  renewGate: Promise<void> | undefined;
  readonly post = async (input: PostInput): Promise<PostResult> => {
    this.posts.push(input);
    const duplicate = input.key !== undefined && this.held.has(input.key);
    if (input.key !== undefined && !duplicate) {
      this.held.add(input.key);
      this.turns.push(input.text);
    }
    if (this.gate !== undefined) await this.gate;
    return this.answers.shift() ?? { opened: true, sessionId: "desk-s1", ...(duplicate ? { duplicate: true as const } : {}) };
  };
  readonly renew = async (): Promise<{ sessionId: string }> => {
    this.renews += 1;
    if (this.renewGate !== undefined) await this.renewGate;
    if (this.renewFails !== undefined) throw new Error(this.renewFails);
    return { sessionId: `desk-s${this.renews + 1}` };
  };
  readonly stop = async (reason: string): Promise<boolean> => {
    this.stops.push(reason);
    if (this.stopFails !== undefined) throw new Error(this.stopFails);
    return this.stopAnswer;
  };
  readonly setOutlet = (outlet: DeskOutlet | undefined): void => { this.outlets.push(outlet); };
}

/** Gravit's one conversation as the bridge reaches it once bound: its posts, its stops and a status. */
class FakeRouter implements PhoneConversation {
  readonly posts: PostInput[] = [];
  readonly stops: string[] = [];
  readonly answers: PostResult[] = [];
  stopAnswer = true;
  readonly post = async (input: PostInput): Promise<PostResult> => {
    this.posts.push(input);
    return this.answers.shift() ?? { opened: true, sessionId: "conv-1" };
  };
  readonly stop = async (reason: string): Promise<boolean> => {
    this.stops.push(reason);
    return this.stopAnswer;
  };
  statusFails: string | undefined;
  carries = 0;
  readonly carry = async (): Promise<void> => { this.carries += 1; };
  readonly status = async (): Promise<{ sessionId?: string; running: number; waiting: number }> => {
    if (this.statusFails !== undefined) throw new Error(this.statusFails);
    return { sessionId: "conv-1", running: 2, waiting: 1 };
  };
}

const noTurns: DeskStatus["turnsToday"] = { count: 0, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
/** The face's status as `/status` reads it: up 90 minutes, paused from the phone until 16:00 ET. */
const STATUS: DeskStatus = {
  ok: true, pid: 7, version: "v", bootedAt: "2026-10-20T17:00:00.000Z", uptimeMs: 90 * 60_000,
  desk: { enabled: true, dir: "/d" }, asleep: [], runs: [], deskSession: "desk-s1",
  turnsToday: { ...noTurns, count: 3 },
  off: { setAt: "2026-10-20T18:00:00.000Z", by: "telegram", until: "2026-10-20T20:00:00.000Z" },
  phone: { configured: true, polling: true, lastPollAt: "2026-10-20T18:29:00.000Z", networks: [{ network: "telegram", polling: true }], queued: 0, strangers: 1 },
};

interface Rig {
  home: string;
  account: FakePhoneAccount;
  clock: Clock;
  conversation: FakeConversation;
  lines: string[];
  bridge: PhoneBridgeHandle;
}

async function account(): Promise<FakePhoneAccount> {
  const a = await fakePhoneAccount();
  accounts.push(a);
  return a;
}

async function rig(
  label: string,
  o: Partial<Omit<Rig, "bridge" | "lines">> & {
    status?: () => Promise<DeskStatus>;
    contextFor?: (messageId: string) => string | undefined;
    router?: () => PhoneConversation | undefined;
  } = {},
): Promise<Rig> {
  const home = o.home ?? await freshHome(label);
  const acc = o.account ?? await account();
  const clock = o.clock ?? new Clock(NOW);
  const conversation = o.conversation ?? new FakeConversation();
  const lines: string[] = [];
  const bridge = installPhoneBridge({
    phone: createPhoneClient({ url: acc.url, secrets: [] }),
    home, conversation, clock, status: o.status ?? (async () => STATUS), log: (line) => { lines.push(line); },
    ...(o.contextFor === undefined ? {} : { contextFor: o.contextFor }),
    ...(o.router === undefined ? {} : { router: o.router }),
  });
  return { home, account: acc, clock, conversation, lines, bridge };
}

/** Wait until the bridge has made `n` reads and holds the last one open: everything before it is handled. */
async function polled(r: Rig, n: number): Promise<void> {
  await waitFor(`read ${n} held open`, () => r.account.reads.length === n && r.account.pending === 1);
}

/** An operator's text in the inbox, Telegram's message `n`, written at {@link NOW} unless said otherwise. */
function text(r: Rig, body: string, n: number, over: Partial<InboxMessage> = {}): InboxMessage {
  return r.account.push({ network: "telegram", messageId: `telegram:${n}`, text: body, at: AT, ...over });
}
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const cursorText = (home: string): Promise<string> => readFile(join(deskDir(home), CURSOR_FILE), "utf8");
const fileText = (home: string, name: string): Promise<string> => readFile(join(deskDir(home), name), "utf8");
/** Every send's body as the account had it, without the text unless asked for. */
const chats = (r: Rig): unknown[] => r.account.sends.map((s) => [s.kind, s.network, s.text]);

/* ---------- what the inbox brings ---------- */

test("an inbox text is posted with its key and its reply's context", async () => {
  let contextAsked: string | undefined;
  const r = await rig("post", { contextFor: (id) => { contextAsked = id; return id === "telegram:40" ? "NVDA 169.82 · ROBINHOOD 10:21:03 ET" : undefined; } });
  try {
    await polled(r, 1);
    const m = text(r, "why?", 41, { replyTo: "telegram:40" });
    await polled(r, 2);
    const p = r.conversation.posts[0];
    assert.equal(p.key, deliveryKey(m));
    assert.equal(p.key, `telegram:41#1@${AT}`, "the inbox's own number with the network's id and its time: per binding, per home");
    assert.deepEqual(p.message, { kind: "telegram", network: "telegram", messageId: "telegram:41" });
    assert.deepEqual(p.source, { kind: "telegram", network: "telegram", at: NOW });
    assert.equal(p.context, "NVDA 169.82 · ROBINHOOD 10:21:03 ET");
    assert.equal(contextAsked, "telegram:40");
    assert.deepEqual(r.account.sends, [], "an opened turn answers through the outlet, not here");
    assert.deepEqual(r.account.reads, [{ after: 0, wait: 25 }, { after: 1, wait: 25 }], "the long poll: 25 s, past the message taken");
  } finally {
    await r.bridge.dispose();
  }
});

test("a reply to nothing the watch knows, no reply and a failing lookup carry no context", async () => {
  const r = await rig("reply-context", {
    contextFor: (id) => {
      if (id === "telegram:13") throw new Error("the watch broke");
      return undefined;
    },
  });
  try {
    await polled(r, 1);
    text(r, "and this?", 8, { replyTo: "telegram:999" });
    text(r, "plain", 9);
    text(r, "broken", 11, { replyTo: "telegram:13" });
    await polled(r, 2);
    assert.deepEqual(r.conversation.posts.map((p) => [p.text, "context" in p]), [["and this?", false], ["plain", false], ["broken", false]]);
    assert.equal(r.lines.length, 1);
    assert.match(r.lines[0], /the message telegram:11 replies to could not be read: the watch broke/);
  } finally {
    await r.bridge.dispose();
  }
});

test("a text carries when the operator wrote it, not when it arrived", async () => {
  const r = await rig("written");
  try {
    await polled(r, 1);
    const written = NOW - 10 * 3_600_000;
    text(r, "written before the Mac woke", 1, { at: new Date(written).toISOString() });
    await polled(r, 2);
    assert.deepEqual(r.conversation.posts.map((p) => p.source), [{ kind: "telegram", network: "telegram", at: written }]);
  } finally {
    await r.bridge.dispose();
  }
});

test("a refused post replies with its line, as chat to the network it came from", async () => {
  const conversation = new FakeConversation();
  conversation.answers.push(
    { refused: "paused", line: "paused since 14:00 ET by telegram until 16:00 ET; a terminal resumes it: npm run desk -- resume" },
    { refused: "error", line: "the desk could not open a turn: EACCES" },
  );
  const r = await rig("refused", { conversation });
  try {
    await polled(r, 1);
    text(r, "one", 1);
    text(r, "two", 2);
    await polled(r, 2);
    assert.deepEqual(chats(r), [
      ["chat", "telegram", "paused since 14:00 ET by telegram until 16:00 ET; a terminal resumes it: npm run desk -- resume"],
      ["chat", "telegram", "the desk could not open a turn: EACCES"],
    ]);
    assert.ok(r.account.sends.every((s) => !("replyTo" in s) && Object.keys(s).sort().join() === "kind,network,text"), "no recipient, nothing but the four keys");
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- the commands ---------- */

test("parseCommand reads the five commands in any case, with or without the bot's name; anything else is text", () => {
  assert.deepEqual(parseCommand("/status"), { cmd: "status" });
  assert.deepEqual(parseCommand("/pause 2h"), { cmd: "pause", arg: "2h" });
  assert.deepEqual(parseCommand("/pause@gravit_desk_bot 2h"), { cmd: "pause", arg: "2h" });
  assert.deepEqual(parseCommand("  /pause  "), { cmd: "pause" });
  assert.deepEqual(parseCommand("/new"), { cmd: "new" });
  assert.deepEqual(parseCommand("/stop@gravit_desk_bot"), { cmd: "stop" });
  assert.deepEqual(parseCommand("/Status"), { cmd: "status" });
  assert.deepEqual(parseCommand("/PAUSE@Gravit_Desk_Bot 2H"), { cmd: "pause", arg: "2H" });
  assert.deepEqual(parseCommand("/sToP@GRAVIT_DESK_BOT"), { cmd: "stop" });
  assert.deepEqual(parseCommand("/mute 2h"), { cmd: "mute", arg: "2h" });
  assert.deepEqual(parseCommand("/Mute"), { cmd: "mute" });
  for (const other of ["/help", "/start", "/pause2h", "/statuses", "status", "hi /status", "/resume", "/Resume", "/mute2h", "/muted", "/unmute", "/arm", "/rearm"]) {
    assert.equal(parseCommand(other), undefined, other);
  }
});

test("commands answer as chat to the network they came from; /pause and /mute write OFF and MUTE by telegram", async () => {
  const r = await rig("commands");
  try {
    await polled(r, 1);
    text(r, "/status", 1);
    await polled(r, 2);
    assert.deepEqual(r.account.sends[0], { kind: "chat", network: "telegram", text: [
      "up 1h 30m since 2026-10-20T17:00:00.000Z · desk on",
      "desk: paused since 14:00 ET by telegram until 16:00 ET (npm run desk -- resume)",
      "phone: telegram polling, last poll 14:29 ET, 0 queued, 1 stranger",
      "desk session desk-s1",
      "turns today 3",
    ].join("\n") });

    text(r, "/pause 2h", 2);
    await polled(r, 3);
    assert.equal(r.account.texts()[1], "paused until 16:30 ET; a terminal resumes it: npm run desk -- resume");
    assert.deepEqual(JSON.parse(await fileText(r.home, OFF_FILE)), { setAt: "2026-10-20T18:30:00.000Z", by: "telegram", until: "2026-10-20T20:30:00.000Z" });
    text(r, "/Pause@Gravit_Desk_Bot 1h", 3);
    await polled(r, 4);
    assert.equal(r.account.texts()[2], "paused until 16:30 ET; a terminal resumes it: npm run desk -- resume", "a shorter pause stands aside");
    text(r, "/PAUSE 2H", 4);
    await polled(r, 5);
    assert.equal(r.account.texts()[3], "/pause takes Nm, Nh or Nd - 30m, 2h, 1d - or nothing; nothing was paused");
    text(r, "/pause", 5);
    await polled(r, 6);
    assert.equal(r.account.texts()[4], "paused; a terminal resumes it: npm run desk -- resume");

    text(r, "/mute 2h", 6);
    await polled(r, 7);
    assert.equal(r.account.texts()[5], "alerts muted until 16:30 ET; detection and the ledger go on. A terminal lifts it: npm run desk -- unmute");
    assert.deepEqual(JSON.parse(await fileText(r.home, MUTE_FILE)), { setAt: "2026-10-20T18:30:00.000Z", by: "telegram", until: "2026-10-20T20:30:00.000Z" });
    text(r, "/mute", 7);
    await polled(r, 8);
    assert.equal(r.account.texts()[6], MUTE_USAGE);

    text(r, "/new", 8);
    await polled(r, 9);
    assert.equal(r.conversation.renews, 1);
    assert.equal(r.account.texts()[7], "a new desk conversation");
    r.conversation.renewFails = "the desk is shut down";
    text(r, "/new", 9);
    await polled(r, 10);
    assert.equal(r.account.texts()[8], "a new desk conversation could not be opened: the desk is shut down");

    text(r, "/Stop", 10);
    await polled(r, 11);
    r.conversation.stopAnswer = false;
    text(r, "/stop@gravit_desk_bot", 11);
    await polled(r, 12);
    assert.deepEqual(r.conversation.stops, ["stopped from the phone", "stopped from the phone"]);
    assert.deepEqual(r.account.texts().slice(9), ["stopped", "nothing is running"]);
    assert.equal(r.conversation.posts.length, 0, "no command is text for Gravit");

    for (const [i, word] of ["/resume", "/unmute", "/help"].entries()) text(r, word, 12 + i);
    await polled(r, 13);
    assert.deepEqual(r.conversation.posts.map((p) => p.text), ["/resume", "/unmute", "/help"], "nothing resumes, unmutes or arms: those are text for Gravit");
    assert.equal(existsSync(join(deskDir(r.home), OFF_FILE)), true, "and the pause stands");
    assert.ok(r.account.sends.every((s) => s.kind === "chat" && s.network === "telegram"), "every line a chat reply to telegram");
    assert.deepEqual((await readEvents(r.home)).events.map((e) => e.kind), ["off-set", "off-set", "mute-set"]);
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- the one conversation (one-entry plan 3) ---------- */

test("with the conversation bound, a text posts to it and not to the desk", async () => {
  const router = new FakeRouter();
  let bound: PhoneConversation | undefined;
  const r = await rig("routed-post", { router: () => bound });
  try {
    await polled(r, 1);
    text(r, "before the bind", 1);
    await polled(r, 2);
    bound = router;
    const m = text(r, "after the bind", 2);
    await polled(r, 3);
    assert.deepEqual(r.conversation.posts.map((p) => p.text), ["before the bind"], "the desk only until the router is bound");
    assert.deepEqual(router.posts.map((p) => p.text), ["after the bind"]);
    const p = router.posts[0];
    assert.equal(p.key, deliveryKey(m));
    assert.deepEqual(p.message, { kind: "telegram", network: "telegram", messageId: "telegram:2" });
    assert.deepEqual(p.source, { kind: "telegram", network: "telegram", at: NOW });
    assert.deepEqual(r.account.sends, [], "an opened turn answers through the outlet");
    assert.ok(r.conversation.outlets[0] !== undefined, "the desk conversation stays the outlet");
  } finally {
    await r.bridge.dispose();
  }
});

test("/new answers that there is one conversation", async () => {
  const router = new FakeRouter();
  const r = await rig("routed-new", { router: () => router });
  try {
    await polled(r, 1);
    text(r, "/new", 1);
    await polled(r, 2);
    assert.equal(r.conversation.renews, 0, "no desk conversation is opened");
    assert.deepEqual(chats(r), [["chat", "telegram", ONE_CONVERSATION]]);
    assert.match(ONE_CONVERSATION, /^there is one conversation/);
  } finally {
    await r.bridge.dispose();
  }
});

test("/status names the conversation and the tasks", async () => {
  const router = new FakeRouter();
  const r = await rig("routed-status", { router: () => router });
  try {
    await polled(r, 1);
    text(r, "/status", 1);
    await polled(r, 2);
    assert.deepEqual(r.account.sends[0], { kind: "chat", network: "telegram", text: [
      "up 1h 30m since 2026-10-20T17:00:00.000Z · desk on",
      "desk: paused since 14:00 ET by telegram until 16:00 ET (npm run desk -- resume)",
      "phone: telegram polling, last poll 14:29 ET, 0 queued, 1 stranger",
      "conversation conv-1",
      "tasks: 2 running, 1 waiting for you",
      "desk turns today 3 (firings, annotations)",
    ].join("\n") });
    /* a tasks read that throws is its own line; the rest of the status stands */
    router.statusFails = "the store is gone";
    text(r, "/status", 2);
    await polled(r, 3);
    assert.deepEqual(String(r.account.sends[1]!.text).split("\n").slice(-2), ["tasks: unreadable (the store is gone)", "desk turns today 3 (firings, annotations)"]);
    assert.equal(router.carries, 0, "the bridge never asks for the carry");
  } finally {
    await r.bridge.dispose();
  }
});

test("with a hold, the outlet is set at once and the inbox is read only once it settles", async () => {
  const conversation = new FakeConversation();
  const acc = await account();
  const lines: string[] = [];
  let release: () => void = () => {};
  const hold = new Promise<void>((done) => { release = done; });
  const bridge = installPhoneBridge({
    phone: createPhoneClient({ url: acc.url, secrets: [] }), home: await freshHome("hold"), conversation, clock: new Clock(NOW),
    status: async () => STATUS, log: (line) => { lines.push(line); }, hold,
  });
  try {
    assert.ok(conversation.outlets[0] !== undefined, "the outlet at once");
    await new Promise((done) => setTimeout(done, 30));
    assert.equal(acc.reads.length, 0, "no read while held");
    release();
    await waitFor("the first read", () => acc.reads.length === 1);
  } finally {
    await bridge.dispose();
  }
});

test("stop cuts the read and keeps the outlet; dispose then lets it go", async () => {
  const r = await rig("stop-reading");
  await polled(r, 1);
  await r.bridge.stop();
  await waitFor("the read under way cut", () => r.account.pending === 0);
  assert.equal(r.bridge.status().polling, false);
  assert.equal(r.conversation.outlets.length, 1, "the outlet stays");
  await r.conversation.outlets[0]!.send("a last answer", { kind: "chat", network: "telegram" });
  assert.deepEqual(r.account.texts(), ["a last answer"], "and still reaches the account");
  r.account.push({ network: "telegram", messageId: "telegram:1", text: "too late", at: AT });
  await new Promise((done) => setTimeout(done, 30));
  assert.equal(r.conversation.posts.length, 0, "nothing more is read");
  await r.bridge.dispose();
  assert.deepEqual(r.conversation.outlets.at(-1), undefined, "the outlet let go at dispose");
});

test("/stop cancels the conversation's turn", async () => {
  const router = new FakeRouter();
  const r = await rig("routed-stop", { router: () => router });
  try {
    await polled(r, 1);
    text(r, "/stop", 1);
    await polled(r, 2);
    router.stopAnswer = false;
    text(r, "/stop", 2);
    await polled(r, 3);
    assert.deepEqual(router.stops, ["stopped from the phone", "stopped from the phone"]);
    assert.deepEqual(r.conversation.stops, [], "the desk conversation is not asked");
    assert.deepEqual(r.account.texts(), ["stopped", "nothing is running"]);
  } finally {
    await r.bridge.dispose();
  }
});

test("while paused, a text is refused with the paused line", async () => {
  const router = new FakeRouter();
  const PAUSED = "paused since 14:00 ET by telegram until 16:00 ET; a terminal resumes it: npm run desk -- resume";
  router.answers.push({ refused: "paused", line: PAUSED });
  const r = await rig("routed-paused", { router: () => router });
  try {
    await polled(r, 1);
    text(r, "anything new?", 1);
    await polled(r, 2);
    assert.deepEqual(router.posts.map((p) => p.text), ["anything new?"]);
    assert.deepEqual(r.conversation.posts, []);
    assert.deepEqual(chats(r), [["chat", "telegram", PAUSED]]);
  } finally {
    await r.bridge.dispose();
  }
});

test("a pause, a mute that cannot be written and a stop that fails each answer with why", { skip: process.getuid?.() === 0 && "root writes anywhere" }, async () => {
  const r = await rig("command-failures");
  try {
    await polled(r, 1);
    await mkdir(deskDir(r.home), { recursive: true });
    /* the cursor is written as each message is taken: so the directory is locked only while the two commands are read */
    await chmod(deskDir(r.home), 0o500);
    try {
      text(r, "/pause 2h", 1);
      text(r, "/mute 2h", 2);
      await waitFor("both answered", () => r.account.sends.length === 2);
    } finally {
      await chmod(deskDir(r.home), 0o700);
    }
    assert.match(String(r.account.texts()[0]), /^the pause could not be set: EACCES\b/);
    assert.match(String(r.account.texts()[1]), /^the mute could not be written: EACCES\b/);
    r.conversation.stopFails = "the agent is gone";
    text(r, "/stop", 3);
    await waitFor("the stop's answer", () => r.account.sends.length === 3);
    assert.equal(r.account.texts()[2], "the desk could not be stopped: the agent is gone");
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- a desk that is slow to take a message ---------- */

const SLOW = "the desk is slow to take this; it will answer when it can";
const PAUSED = "paused since 14:00 ET by terminal; a terminal resumes it: npm run desk -- resume";

test("the cursor moves only after the post settles, and is kept in inbox.cursor", async () => {
  const conversation = new FakeConversation();
  const taken = deferred();
  conversation.gate = taken.promise;
  const r = await rig("slow-post", { conversation });
  try {
    await polled(r, 1);
    text(r, "taken at 45 s", 1);
    await waitFor("the post's 30 s", () => conversation.posts.length === 1 && r.clock.has(30_000));
    r.clock.setTimeout(() => { taken.resolve(); }, 45_000);
    r.clock.advance(29_999);
    await new Promise((done) => setTimeout(done, 20));
    assert.deepEqual(r.account.sends, [], "not before 30 s");
    r.clock.advance(1);
    await waitFor("the slow line", () => r.account.sends.length === 1);
    assert.deepEqual(chats(r), [["chat", "telegram", SLOW]]);
    await new Promise((done) => setTimeout(done, 20));
    assert.equal(existsSync(join(deskDir(r.home), CURSOR_FILE)), false, "no cursor stored while the post is under way");
    assert.equal(r.account.reads.length, 1, "and no read past the message");
    r.clock.advance(15_000);
    await polled(r, 2);
    assert.equal(await cursorText(r.home), "1\n", "stored once the desk took it");
    assert.equal(r.account.reads[1].after, 1);

    const late = deferred();
    conversation.gate = late.promise;
    conversation.answers.push({ refused: "paused", line: PAUSED });
    text(r, "refused late", 2);
    await waitFor("the second post's 30 s", () => conversation.posts.length === 2 && r.clock.has(30_000));
    r.clock.advance(30_000);
    await waitFor("the second slow line", () => r.account.sends.length === 2);
    assert.equal(await cursorText(r.home), "1\n");
    late.resolve();
    await polled(r, 3);
    await waitFor("the late refusal's line", () => r.account.sends.length === 3);
    assert.deepEqual(r.account.texts(), [SLOW, SLOW, PAUSED]);
    assert.equal(await cursorText(r.home), "2\n");
    const st = await stat(join(deskDir(r.home), CURSOR_FILE));
    assert.equal(st.mode & 0o777, 0o600, "the cursor is the operator's alone");
    assert.equal((await stat(deskDir(r.home))).mode & 0o777, 0o700);
  } finally {
    await r.bridge.dispose();
  }
});

test("a post that never settles holds the cursor for 5 min, then the bridge says so, moves on and answers what came behind it", async () => {
  const conversation = new FakeConversation();
  conversation.gate = new Promise(() => {});
  const r = await rig("unaccepted", { conversation });
  try {
    await polled(r, 1);
    text(r, "never taken", 1);
    await waitFor("the post's bounds", () => conversation.posts.length === 1 && r.clock.has(30_000) && r.clock.has(300_000));
    r.clock.advance(30_000);
    await waitFor("the slow line", () => r.account.sends.length === 1);
    r.clock.advance(269_999);
    await new Promise((done) => setTimeout(done, 20));
    assert.equal(existsSync(join(deskDir(r.home), CURSOR_FILE)), false, "no cursor before 5 min");
    assert.equal(r.account.reads.length, 1, "and no read");
    r.clock.advance(1);
    await polled(r, 2);
    assert.equal(await cursorText(r.home), "1\n", "past 5 min the cursor moves on");
    assert.deepEqual(r.lines, ["gravit-face: phone: the desk did not take telegram:1 (inbox 1) in 5 min; the bridge goes on, and the text is answered once if it lands later"]);
    text(r, "/status", 2);
    await polled(r, 3);
    assert.equal(r.account.sends.length, 2);
    assert.ok(String(r.account.texts()[1]).startsWith("up "), "a /status sent behind it is answered");
  } finally {
    await r.bridge.dispose();
  }
});

/* Review Focus 1: the face (or the account) restarts between the account storing a message and the desk's flush. The
 * cursor never moved past it, so the inbox hands it over again - the same row, under the same key, which the session
 * now holds. */
test("an inbox message posted again after the account restarts is answered once", async () => {
  const home = await freshHome("again");
  const acc = await account();
  const conversation = new FakeConversation();
  conversation.gate = new Promise(() => {});
  const first = await rig("again", { home, account: acc, conversation });
  await polled(first, 1);
  const m = text(first, "once only", 5);
  await waitFor("the post under way", () => conversation.posts.length === 1);
  const disposing = first.bridge.dispose();
  await waitFor("the dispose's bound", () => first.clock.has(2_000));
  first.clock.advance(2_000);
  await disposing;
  assert.equal(existsSync(join(deskDir(home), CURSOR_FILE)), false, "the cursor never moved past it");

  conversation.gate = undefined;
  const second = await rig("again", { home, account: acc, conversation });
  try {
    await waitFor("the restarted bridge's held read", () => acc.reads.length === 3 && acc.pending === 1);
    assert.deepEqual(conversation.posts.map((p) => [p.key, p.text]), [[deliveryKey(m), "once only"], [deliveryKey(m), "once only"]], "the same key both times");
    assert.deepEqual(conversation.turns, ["once only"], "one turn");
    assert.deepEqual(acc.sends, [], "and nothing said on the phone");
    assert.equal(await cursorText(home), "1\n");

    /* a bot reconnected at the account: Telegram's message ids start again, the inbox's number does not */
    text(second, "the same telegram id, another bot", 5);
    await waitFor("the next read", () => acc.reads.length === 4 && acc.pending === 1);
    assert.deepEqual(conversation.turns, ["once only", "the same telegram id, another bot"], "a new inbox number is a new text, never a duplicate");
  } finally {
    await second.bridge.dispose();
  }
});

test("a batch handed over again is answered once each, in inbox order", async () => {
  const home = await freshHome("batch-again");
  await mkdir(deskDir(home), { recursive: true });
  await writeFile(join(deskDir(home), CURSOR_FILE), "1\n");
  const acc = await account();
  const ms = ["one", "two", "three", "four"].map((t, i) => acc.push({ network: "telegram", messageId: `telegram:${i + 1}`, text: t, at: AT }));
  const conversation = new FakeConversation();
  conversation.held.add(deliveryKey(ms[0])).add(deliveryKey(ms[1]));
  const r = await rig("batch-again", { home, account: acc, conversation });
  try {
    await polled(r, 2);
    assert.equal(acc.reads[0].after, 1);
    assert.deepEqual(conversation.posts.map((p) => p.text), ["two", "three", "four"], "each posted in inbox order");
    assert.deepEqual(conversation.turns, ["three", "four"]);
    assert.deepEqual(acc.sends, []);
    assert.equal(await cursorText(home), "4\n");
    assert.deepEqual(r.lines, []);
  } finally {
    await r.bridge.dispose();
  }
});

test("a cursor past the account's last id starts again from 0, with one line", async () => {
  const home = await freshHome("fresh-account");
  await mkdir(deskDir(home), { recursive: true });
  await writeFile(join(deskDir(home), CURSOR_FILE), "57\n");
  const acc = await account();
  acc.push({ network: "telegram", messageId: "telegram:2", text: "hello from a fresh home", at: AT });
  const r = await rig("fresh-account", { home, account: acc });
  try {
    await polled(r, 3);
    assert.deepEqual(acc.reads.map((x) => x.after), [57, 0, 1]);
    assert.deepEqual(r.lines, ["gravit-face: phone: the account's inbox ends at 1, below the cursor 57 - a fresh account home; reading it again from 0"]);
    assert.deepEqual(r.conversation.turns, ["hello from a fresh home"]);
    assert.equal(await cursorText(home), "1\n");
  } finally {
    await r.bridge.dispose();
  }
});

test("a message that is not one is passed over: the cursor moves to the account's last", async () => {
  const r = await rig("malformed");
  try {
    await polled(r, 1);
    r.account.push({ network: "telegram", messageId: "not an id", text: "x", at: AT });
    text(r, "good", 2);
    r.account.push({ network: "telegram", messageId: "telegram:3", text: 7 as unknown as string, at: AT });
    await polled(r, 2);
    assert.deepEqual(r.conversation.turns, ["good"]);
    assert.equal(await cursorText(r.home), "3\n");
    assert.equal(r.account.reads[1].after, 3);
  } finally {
    await r.bridge.dispose();
  }
});

test("a /new the desk is slow to open is answered so after 30 s, then with the new conversation; only then does the cursor move", async () => {
  const conversation = new FakeConversation();
  const opened = deferred();
  conversation.renewGate = opened.promise;
  const r = await rig("slow-new", { conversation });
  try {
    await polled(r, 1);
    text(r, "/new", 1);
    await waitFor("the renew's 30 s", () => conversation.renews === 1 && r.clock.has(30_000));
    r.clock.advance(30_000);
    await waitFor("the slow line", () => r.account.sends.length === 1);
    assert.equal(r.account.reads.length, 1, "no read past it while the renew is under way");
    opened.resolve();
    await polled(r, 2);
    assert.deepEqual(r.account.texts(), [SLOW, "a new desk conversation"]);
    assert.equal(await cursorText(r.home), "1\n");
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- an account that does not answer ---------- */

test("an account that does not answer is backed off from 5 s to 60 s and shows in the status", async () => {
  const acc = await account();
  acc.inboxAnswer = () => "drop";
  const r = await rig("backoff", { account: acc });
  try {
    const at = (s: number): string => new Date(NOW + s * 1_000).toISOString();
    await waitFor("the first backoff", () => r.clock.has(5_000));
    const failing = r.bridge.status().accountFailing;
    assert.equal(failing?.since, at(0));
    assert.equal(r.bridge.status().polling, true, "the loop goes on");
    assert.equal(deskStatusLines({ ...STATUS, phone: r.bridge.status() }, new Date(NOW))[2],
      `phone: nothing connected (Account › Identity), the account has not answered since 14:30 ET: ${failing?.reason}`);
    /* a 503 whose body is no inbox, then a body that says ok but is none: each a failure, whatever the status */
    acc.inboxAnswer = () => ({ status: 503, body: { ok: false, error: "the account is starting" } });
    r.clock.advance(5_000);
    await waitFor("a 10 s backoff", () => acc.reads.length === 2 && r.clock.has(10_000));
    assert.deepEqual(r.bridge.status().accountFailing, { since: at(0), reason: "the account answered HTTP 503 with no inbox: the account is starting" });
    acc.inboxAnswer = () => ({ status: 200, body: { ok: true, messages: "none" } });
    for (const wait of [10, 20, 40, 60, 60]) {
      await waitFor(`a ${wait} s backoff`, () => r.clock.has(wait * 1_000));
      r.clock.advance(wait * 1_000);
    }
    await waitFor("the seventh read's backoff", () => acc.reads.length === 7 && r.clock.has(60_000));
    assert.equal(r.bridge.status().accountFailing?.reason, "the account answered HTTP 200 with no inbox");
    assert.equal(r.lines.filter((l) => l.includes("did not answer")).length, 4, "failures at 0, 5, 15, 35, 75, 135 and 195 s: one line a minute");
    acc.inboxAnswer = undefined;
    acc.status = { networks: [{ network: "telegram", polling: true }], queued: 2, strangers: 3 };
    r.clock.advance(60_000);
    await polled(r, 8);
    assert.equal(Object.hasOwn(r.bridge.status(), "accountFailing"), true, "a read the account holds open has not answered yet");
    acc.endPoll();
    await polled(r, 9);
    assert.equal(Object.hasOwn(r.bridge.status(), "accountFailing"), false, "a read that answers clears it");
    assert.deepEqual(r.bridge.status(), {
      configured: true, polling: true, lastPollAt: at(255), networks: [{ network: "telegram", polling: true }], queued: 2, strangers: 3,
    });
    acc.inboxAnswer = () => "drop";
    acc.endPoll();
    await waitFor("a fresh 5 s backoff", () => acc.reads.length === 10 && r.clock.has(5_000));
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- Slack beside Telegram (plan B2) ---------- */

/** An operator's text from Slack, its `ts` the wire's id. */
function slackText(r: Rig, body: string, ts: string, over: Partial<InboxMessage> = {}): InboxMessage {
  return r.account.push({ network: "slack", messageId: `slack:${ts}`, text: body, at: AT, ...over });
}

test("a Slack text is posted with its network and answered on Slack; !-commands arrive as /", async () => {
  const r = await rig("slack");
  try {
    await polled(r, 1);
    const m = slackText(r, "why?", "1730812345.001200", { replyTo: "slack:1730812300.000100" });
    await polled(r, 2);
    const p = r.conversation.posts[0];
    assert.equal(p.key, `slack:1730812345.001200#1@${AT}`);
    assert.deepEqual(p.message, { kind: "telegram", network: "slack", messageId: m.messageId }, "the record keeps its name and gains the network");
    assert.deepEqual(p.source, { kind: "telegram", network: "slack", at: NOW });
    /* the connector rewrote !status to /status before it stored it: the bridge reads a slash */
    slackText(r, "/status", "1730812346.000001");
    await polled(r, 3);
    assert.equal(r.account.sends.length, 1);
    assert.equal(r.account.sends[0].kind, "chat");
    assert.equal(r.account.sends[0].network, "slack", "a Slack command is answered on Slack");
    text(r, "/stop", 7);
    await polled(r, 4);
    assert.deepEqual(r.account.sends.map((s) => s.network), ["slack", "telegram"], "a Telegram command on Telegram");
  } finally {
    await r.bridge.dispose();
  }
});

test("/pause from Slack writes OFF by slack; /mute from Slack writes MUTE by slack", async () => {
  const r = await rig("slack-pause");
  try {
    await polled(r, 1);
    slackText(r, "/pause 2h", "1730812345.001200");
    await polled(r, 2);
    assert.equal(r.account.texts()[0], "paused until 16:30 ET; a terminal resumes it: npm run desk -- resume");
    assert.deepEqual(JSON.parse(await fileText(r.home, OFF_FILE)), { setAt: "2026-10-20T18:30:00.000Z", by: "slack", until: "2026-10-20T20:30:00.000Z" });
    slackText(r, "/mute 2h", "1730812346.001200");
    await polled(r, 3);
    assert.deepEqual(JSON.parse(await fileText(r.home, MUTE_FILE)), { setAt: "2026-10-20T18:30:00.000Z", by: "slack", until: "2026-10-20T20:30:00.000Z" });
    const events = (await readEvents(r.home)).events;
    assert.deepEqual(events.map((e) => [e.kind, (e as { by?: unknown }).by]), [["off-set", "slack"], ["mute-set", "slack"]]);
    assert.ok(r.account.sends.every((s) => s.network === "slack"));
  } finally {
    await r.bridge.dispose();
  }
});

test("the wire id is the account's rule: face/src/phone.ts and the account's kinds.ts carry the same text", async () => {
  const rule = (path: string): string => {
    const m = /const WIRE_ID = (\/.*\/);/.exec(readFileSync(path, "utf8"));
    assert.ok(m !== null, `WIRE_ID in ${path}`);
    return m[1];
  };
  assert.equal(rule(join(HERE, "../src/phone.ts")), rule(join(HERE, "../../account/src/portfolio/identity/kinds.ts")));
  assert.equal(WIRE_ID.source, "^(?:telegram:\\d{1,16}|slack:\\d{9,12}\\.\\d{6})$");
  for (const good of ["telegram:4821", "slack:1730812345.001200"]) assert.ok(WIRE_ID.test(good), good);
  for (const bad of ["slack:4821", "slack:1730812345.0012", "slack:C0DM:1730812345.001200", "matrix:1", "telegram:1.000001"]) assert.ok(!WIRE_ID.test(bad), bad);
  /* an inbox message with an id of neither network is left out */
  const r = await rig("wire-id");
  try {
    await polled(r, 1);
    r.account.push({ network: "matrix", messageId: "matrix:1", text: "x", at: AT });
    r.account.push({ network: "slack", messageId: "slack:12", text: "y", at: AT });
    slackText(r, "good", "1730812345.001200");
    await polled(r, 2);
    assert.deepEqual(r.conversation.turns, ["good"]);
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- the outlet and the end ---------- */

test("the bridge is the conversation's outlet until dispose: each send goes to the account as its kind, and its body decides", async () => {
  const r = await rig("outlet");
  assert.equal(r.conversation.outlets.length, 1);
  const outlet = r.conversation.outlets[0]!;
  assert.deepEqual(await outlet.send("a desk answer", { kind: "chat", network: "telegram" }), { sent: ["telegram:501"] });
  assert.deepEqual(await outlet.send("an annotation", { kind: "alert", replyTo: "telegram:77" }), { sent: ["telegram:502"] });
  assert.deepEqual(r.account.sends, [
    { kind: "chat", text: "a desk answer", network: "telegram" },
    { kind: "alert", text: "an annotation", replyTo: "telegram:77" },
  ], "the kind, the reply and the network - never a recipient");
  r.account.sendAnswer = () => ({ status: 200, body: { ok: true, held: "quiet hours" } });
  assert.deepEqual(await outlet.send("a brief", { kind: "brief" }), { held: "quiet hours" });
  r.account.sendAnswer = () => ({ status: 200, body: { ok: true, queued: true } });
  assert.deepEqual(await outlet.send("queued", { kind: "report" }), { queued: true });
  r.account.sendAnswer = () => ({ status: 200, body: { ok: true, sent: ["telegram:9"], queued: true } });
  assert.deepEqual(await outlet.send("partly", { kind: "report" }), { sent: ["telegram:9"], queued: true });
  r.account.sendAnswer = () => ({ status: 502, body: { ok: true, sent: ["telegram:10"] } });
  assert.deepEqual(await outlet.send("a 502 that says it went", { kind: "report" }), { sent: ["telegram:10"] }, "the body, not the status");
  r.account.sendAnswer = () => ({ status: 502, body: { ok: false, error: "Telegram refused the message (HTTP 403): it was not sent, and it is not kept." } });
  await assert.rejects(outlet.send("refused", { kind: "alert" }), /^Error: Telegram refused the message \(HTTP 403\)/);
  r.account.sendAnswer = () => ({ status: 200, body: "not json" });
  await assert.rejects(outlet.send("garbled", { kind: "alert" }), /the account answered HTTP 200 with no send's answer/);
  r.account.sendAnswer = () => "drop";
  await assert.rejects(outlet.send("dead", { kind: "alert" }), /^Error: the account could not be asked: /);
  await r.bridge.dispose();
  assert.deepEqual(r.conversation.outlets, [outlet, undefined]);
});

test("the client takes every secret out of what it sends", async () => {
  const acc = await account();
  const phone = createPhoneClient({ url: acc.url, secrets: ["made-up-phone-secret-0042"] });
  await phone.send("chat", "the key is made-up-phone-secret-0042, or %s", { network: "telegram" });
  await phone.send("alert", `escaped ${JSON.stringify("made-up-phone-secret-0042")} and ${encodeURIComponent("made-up-phone-secret-0042")}`);
  assert.deepEqual(acc.texts(), ["the key is <secret>, or %s", 'escaped "<secret>" and <secret>']);
});

test("dispose aborts the read and stops the loop", async () => {
  const r = await rig("dispose");
  await polled(r, 1);
  assert.equal(r.bridge.status().polling, true);
  await r.bridge.dispose();
  await waitFor("the held read let go", () => r.account.pending === 0);
  assert.equal(r.bridge.status().polling, false);
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(r.account.reads.length, 1, "no read after dispose");
  assert.equal(r.lines.some((l) => /did not answer/.test(l)), false, "the abort is no failure");
  await r.bridge.dispose();
});

test("dispose stops waiting after 2 s for a message still in hand", async () => {
  const conversation = new FakeConversation();
  conversation.gate = new Promise(() => {});
  const r = await rig("dispose-bound", { conversation });
  await polled(r, 1);
  text(r, "a post that never settles", 1);
  await waitFor("the post under way", () => conversation.posts.length === 1);
  let done = false;
  const disposing = r.bridge.dispose().then(() => { done = true; });
  await waitFor("the dispose's bound", () => r.clock.has(2_000));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(done, false);
  r.clock.advance(2_000);
  await disposing;
  assert.equal(r.bridge.status().polling, false);
});

/* ---------- the face holds no network ---------- */

test("the face reads no TELEGRAM_* name and sends nothing to api.telegram.org", async () => {
  const src = join(HERE, "..", "src");
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|mjs|js)$/.test(entry.name)) files.push(path);
    }
  };
  await walk(src);
  assert.ok(files.length > 20, "the walk found the face's sources");
  assert.equal(existsSync(join(src, "telegram.ts")), false, "the old bridge is gone");
  for (const file of files) {
    const body = await readFile(file, "utf8");
    for (const needle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_OPERATOR_ID", "api.telegram.org"]) {
      if (file === join(src, "agents.ts") && needle === "TELEGRAM_BOT_TOKEN") {
        assert.equal(body.split(needle).length - 1, 1, "agents.ts names it once, in its scrub list");
        assert.match(body, /SCRUBBED_ENV[\s\S]*"TELEGRAM_BOT_TOKEN",[\s\S]*\] as const/);
        continue;
      }
      assert.equal(body.includes(needle), false, `${file} names ${needle}`);
    }
  }
});
