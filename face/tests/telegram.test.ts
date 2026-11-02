// face/tests/telegram.test.ts
/** The Telegram bridge (src/telegram.ts): one operator in a private chat, the five commands, the desk
 * conversation's outlet, the offset across restarts, the outbox, and what a refused or failed poll does.
 * Offline: a fake Bot API answering by URL - no request leaves the process, and nothing here names
 * api.telegram.org - a fake conversation port and a manual clock. Homes sit inside the repository, under
 * tests/tmp/telegram-<pid>/, and are removed afterwards. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTE_FILE, MUTE_USAGE, OFF_FILE, deskDir, deskStatusLines, readEvents, type DeskStatus } from "../src/desk.ts";
import type { DeskConversation, DeskOutlet, PostResult } from "../src/desk-conversation.ts";
import type { DeskClock } from "../src/desk-session.ts";
import { deskSecrets } from "../src/desk-tools.ts";
import {
  installTelegramBridge, parseCommand, splitMessage, telegramConfigFromEnv, type BridgeHandle,
} from "../src/telegram.ts";

/* ---------- fixtures, inside the repository ---------- */

const TMP = join(dirname(fileURLToPath(import.meta.url)), "tmp", `telegram-${process.pid}`);
let made = 0;
/** A fresh harness home under tests/tmp/telegram-<pid>/. */
async function freshHome(label: string): Promise<string> {
  const dir = join(TMP, `${++made}-${label}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
after(() => rm(TMP, { recursive: true, force: true }));

/** Poll until `ok` holds: the bridge's loop runs on real promises and real file I/O, which no fake clock drives. */
async function waitFor(what: string, ok: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 2));
  }
}

/** The bot's token in every test: long enough that redacting it can only ever hit the token. */
const TOKEN = "424242:AAFakeTokenForTheBridgeTests_x9";
const OPERATOR = 42;
const API = "https://telegram.test";
/** 14:30 ET on 2026-10-20. */
const NOW = Date.parse("2026-10-20T18:30:00Z");

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
  /** Whether a timer asked for `ms` is pending. */
  has(ms: number): boolean { return this.timers.some((x) => x.ms === ms); }
  /** Move on by `ms`, firing in order every timer pending now that falls due on the way. */
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

type Update = { update_id: number } & Record<string, unknown>;
/** How a request fails: unreachable (an error that carries the URL, token and all, as a careless library's
 * might), held open until it is aborted, or answered with a Bot API error. */
type Failure = "network" | "hang" | { status: number; description: string };

const answer = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake Bot API at https://telegram.test, answering by the URL's method. getUpdates honours the offset
 * and, with nothing to deliver, holds the request open - as the long poll does - until an update arrives,
 * {@link endPoll} answers it empty, or it is aborted; sendMessage answers the next message id. `poll` and
 * `send` say how a request fails, when it does. */
class FakeBotApi {
  readonly calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  readonly sent: { chat_id?: unknown; text: string; reply_parameters?: unknown; parse_mode?: unknown; id: number }[] = [];
  readonly updates: Update[] = [];
  abortedPolls = 0;
  abortedSends = 0;
  nextId = 501;
  /** When set, the next getUpdates answers every update it has, whatever the offset - a Bot API that
   * misbehaves once. */
  ignoreOffsetOnce = false;
  poll: () => Failure | undefined = () => undefined;
  send: (body: Record<string, unknown>) => Failure | undefined = () => undefined;
  private waiting: (() => void)[] = [];

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = url.slice(url.lastIndexOf("/") + 1);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    this.calls.push({ url, method, body });
    const signal = init?.signal ?? undefined;
    const failure = method === "getUpdates" ? this.poll() : method === "sendMessage" ? this.send(body) : undefined;
    if (failure === "network") throw new TypeError(`fetch failed: connect ECONNREFUSED ${url}`);
    if (failure === "hang") await this.until(method, signal, false);
    if (typeof failure === "object") return answer(failure.status, { ok: false, error_code: failure.status, description: failure.description });
    if (method === "getUpdates") {
      const from = typeof body.offset === "number" && !this.ignoreOffsetOnce ? body.offset : 0;
      this.ignoreOffsetOnce = false;
      const ready = (): Update[] => this.updates.filter((u) => u.update_id >= from);
      if (ready().length === 0) await this.until(method, signal, true);
      return answer(200, { ok: true, result: ready() });
    }
    if (method === "sendMessage") {
      const id = this.nextId++;
      this.sent.push({ ...(body as { text: string }), id });
      return answer(200, { ok: true, result: { message_id: id, chat: { id: body.chat_id, type: "private" }, date: 0, text: body.text } });
    }
    return answer(404, { ok: false, error_code: 404, description: "Not Found" });
  }) as typeof fetch;

  /** Hold a request until it is released (a poll) or aborted (either). */
  private until(method: string, signal: AbortSignal | undefined, releasable: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const release = (): void => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = (): void => {
        if (method === "getUpdates") this.abortedPolls += 1;
        else this.abortedSends += 1;
        this.waiting = this.waiting.filter((w) => w !== release);
        reject(signal?.reason);
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (releasable) this.waiting.push(release);
    });
  }

  push(...updates: Update[]): void {
    this.updates.push(...updates);
    this.release();
  }
  /** Answer the poll held open, with whatever there is - nothing, as Telegram does at the end of a long poll. */
  endPoll(): void { this.release(); }
  /** How many polls are held open now. */
  get pending(): number { return this.waiting.length; }
  /** The getUpdates calls' bodies, in order. */
  polls(): Record<string, unknown>[] { return this.calls.filter((c) => c.method === "getUpdates").map((c) => c.body); }
  texts(): string[] { return this.sent.map((m) => m.text); }
  private release(): void { for (const done of this.waiting.splice(0)) done(); }
}

type PostInput = Parameters<DeskConversation["post"]>[0];

/** The conversation port as the bridge drives it: what was posted, renewed, stopped and set as its outlet. */
class FakeConversation {
  readonly posts: PostInput[] = [];
  readonly outlets: (DeskOutlet | undefined)[] = [];
  readonly stops: string[] = [];
  renews = 0;
  /** What the next posts answer, in order; once it is empty, a post opens its turn. */
  readonly answers: PostResult[] = [];
  stopAnswer = true;
  stopFails: string | undefined;
  renewFails: string | undefined;
  /** When set, every post waits for it. */
  gate: Promise<void> | undefined;
  /** When set, every renew waits for it. */
  renewGate: Promise<void> | undefined;
  readonly post = async (input: PostInput): Promise<PostResult> => {
    this.posts.push(input);
    if (this.gate !== undefined) await this.gate;
    return this.answers.shift() ?? { opened: true, sessionId: "desk-s1" };
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

const noTurns: DeskStatus["turnsToday"] = { count: 0, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
/** The face's status as `/status` reads it: up 90 minutes, paused from the phone until 16:00 ET. */
const STATUS: DeskStatus = {
  ok: true, pid: 7, version: "v", bootedAt: "2026-10-20T17:00:00.000Z", uptimeMs: 90 * 60_000,
  desk: { enabled: true, dir: "/d" }, asleep: [], runs: [], deskSession: "desk-s1",
  turnsToday: { ...noTurns, count: 3 },
  off: { setAt: "2026-10-20T18:00:00.000Z", by: "telegram", until: "2026-10-20T20:00:00.000Z" },
  telegram: { configured: true, polling: true, lastPollAt: "2026-10-20T18:29:00.000Z", dropped: 1, queued: 0 },
};

interface Rig {
  home: string;
  api: FakeBotApi;
  clock: Clock;
  conversation: FakeConversation;
  lines: string[];
  bridge: BridgeHandle;
}

/** A bridge over a fake Bot API, a fake conversation and a manual clock at {@link NOW}; every part can be given,
 * and `pollTimeoutS`, the long poll - a test that moves the clock past a held poll's 65 s gives a longer one - and
 * `secrets`, what the bridge redacts beside the token (none unless given: never this process's environment). */
async function rig(
  label: string,
  o: Partial<Omit<Rig, "bridge" | "lines">> & { status?: () => Promise<DeskStatus>; pollTimeoutS?: number; secrets?: readonly string[] } = {},
): Promise<Rig> {
  const home = o.home ?? await freshHome(label);
  const api = o.api ?? new FakeBotApi();
  const clock = o.clock ?? new Clock(NOW);
  const conversation = o.conversation ?? new FakeConversation();
  const lines: string[] = [];
  const bridge = installTelegramBridge({
    config: { token: TOKEN, operatorId: OPERATOR, apiBase: API, fetch: api.fetch, clock, ...(o.pollTimeoutS === undefined ? {} : { pollTimeoutS: o.pollTimeoutS }) },
    home, conversation, status: o.status ?? (async () => STATUS), log: (line) => { lines.push(line); }, secrets: o.secrets ?? [],
  });
  return { home, api, clock, conversation, lines, bridge };
}

/** Wait until the loop has made `n` polls and holds the last one open: everything before it is handled. */
async function polled(r: Rig, n: number): Promise<void> {
  await waitFor(`poll ${n} held open`, () => r.api.polls().length === n && r.api.pending === 1);
}

/** A message in an update: from the operator, in their private chat, written at {@link NOW} (Telegram's
 * `date` is in seconds), unless `over` says otherwise. */
function message(updateId: number, over: Record<string, unknown> = {}): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 1000, from: { id: OPERATOR, is_bot: false, first_name: "Op" }, chat: { id: OPERATOR, type: "private" },
      date: NOW / 1_000, ...over,
    },
  };
}
/** A promise and the hand that settles it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const text = (updateId: number, body: string, messageId = updateId + 1000): Update => message(updateId, { text: body, message_id: messageId });

/** The bridge's ledger, telegram.jsonl, as records. */
async function records(home: string): Promise<Record<string, unknown>[]> {
  try {
    return (await readFile(join(deskDir(home), "telegram.jsonl"), "utf8")).split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
const kinds = async (home: string): Promise<unknown[]> => (await records(home)).map((r) => r.kind);
const fileText = (home: string, name: string): Promise<string> => readFile(join(deskDir(home), name), "utf8");
async function putFile(home: string, name: string, body: string): Promise<void> {
  await mkdir(deskDir(home), { recursive: true });
  await writeFile(join(deskDir(home), name), body);
}

/* ---------- who may talk to the desk ---------- */

test("a foreign sender and a group chat are dropped, counted and recorded; no reply", async () => {
  const r = await rig("drop");
  try {
    await polled(r, 1);
    r.api.push(
      text(1, "first"),
      message(2, { from: { id: 99 }, chat: { id: 99, type: "private" }, text: "a stranger" }),
      message(3, { chat: { id: -100123, type: "group" }, text: "the operator, in a group" }),
      /* each of the two rules alone: another sender in the operator's chat, the operator's id on a chat that is not private */
      message(4, { from: { id: 99 }, text: "someone else, in the operator's chat" }),
      message(5, { chat: { id: OPERATOR, type: "supergroup" }, text: "not a private chat" }),
      text(6, "hi"),
    );
    await polled(r, 2);
    assert.deepEqual(r.conversation.posts.map((p) => p.text), ["first", "hi"], "the operator's private texts still reach the desk");
    assert.deepEqual(r.api.sent, [], "a dropped update is never answered");
    const status = r.bridge.status();
    assert.equal(status.dropped, 4);
    assert.equal(status.lastDroppedFrom, OPERATOR, "the last one's sender - the operator, on a chat that is not private");
    assert.deepEqual((await records(r.home)).map(({ t, ...rest }) => { assert.equal(t, new Date(NOW).toISOString()); return rest; }), [
      { kind: "drop", from: 99, chatType: "private" },
      { kind: "drop", from: OPERATOR, chatType: "group" },
      { kind: "drop", from: 99, chatType: "private" },
      { kind: "drop", from: OPERATOR, chatType: "supergroup" },
    ]);
    assert.equal(await fileText(r.home, "telegram.offset"), "7\n", "the offset moves past every update, dropped or not");
  } finally {
    await r.bridge.dispose();
  }
});

test("operator text is posted to the conversation with the telegram source", async () => {
  const r = await rig("post");
  try {
    await polled(r, 1);
    r.api.push(text(5, "hi", 7));
    await polled(r, 2);
    assert.deepEqual(r.conversation.posts, [
      { text: "hi", source: { kind: "telegram", at: NOW }, message: { kind: "telegram", from: OPERATOR, chat: OPERATOR, messageId: 7 } },
    ]);
    assert.deepEqual(r.api.sent, [], "an opened turn answers through the outlet, not here");
    assert.deepEqual(r.api.polls()[1], { offset: 6, timeout: 50, allowed_updates: ["message"] }, "the long poll: 50 s, messages only, past the update");
    assert.deepEqual(r.api.polls()[0], { timeout: 50, allowed_updates: ["message"] }, "no offset before the first update");
  } finally {
    await r.bridge.dispose();
  }
});

test("a text carries when the operator wrote it - Telegram's own date - not when it arrived", async () => {
  const r = await rig("written");
  try {
    await polled(r, 1);
    const written = NOW - 10 * 3_600_000; // 04:30 ET, before the Mac woke
    r.api.push(
      message(1, { text: "written before the Mac woke", date: written / 1_000 }),
      message(2, { text: "no date", date: undefined }),
      message(3, { text: "a date that is no time", date: "yesterday" }),
      message(4, { text: "the epoch", date: 0 }),
    );
    await polled(r, 2);
    assert.deepEqual(r.conversation.posts.map((p) => p.source), [{ kind: "telegram", at: written }, { kind: "telegram" }, { kind: "telegram" }, { kind: "telegram" }],
      "the time it was written, when Telegram gives one; else the conversation's own clock decides");
  } finally {
    await r.bridge.dispose();
  }
});

test("a refused post replies with its line", async () => {
  const conversation = new FakeConversation();
  conversation.answers.push(
    { refused: "paused", line: "paused since 14:00 ET by telegram until 16:00 ET; a terminal resumes it: npm run desk -- resume" },
    { refused: "fence", path: "desk/journal/GRAVIT.md", line: "refused: desk/journal/GRAVIT.md exists; it would steer every later desk turn. Remove it, then write again." },
    { refused: "error", line: "the desk could not open a turn: EACCES" },
    {
      refused: "budget",
      line: "the desk's token budget for today is spent: 2,013,402 of 2,000,000 tokens since 00:00 ET. It opens again at midnight ET, or raise budget.dailyTokens in standing.yml",
    },
  );
  const r = await rig("refused", { conversation });
  try {
    await polled(r, 1);
    r.api.push(text(1, "one"), text(2, "two"), text(3, "three"), text(4, "four"));
    await polled(r, 2);
    assert.deepEqual(r.api.sent.map((m) => [m.chat_id, m.text]), [
      [OPERATOR, "paused since 14:00 ET by telegram until 16:00 ET; a terminal resumes it: npm run desk -- resume"],
      [OPERATOR, "refused: desk/journal/GRAVIT.md exists; it would steer every later desk turn. Remove it, then write again."],
      [OPERATOR, "the desk could not open a turn: EACCES"],
      [OPERATOR, "the desk's token budget for today is spent: 2,013,402 of 2,000,000 tokens since 00:00 ET. It opens again at midnight ET, or raise budget.dailyTokens in standing.yml"],
    ]);
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- what the bridge sends ---------- */

test("send goes to the operator's chat only, split at 4,000, and resolves the message ids", async () => {
  const r = await rig("send");
  try {
    const long = "a".repeat(9_000);
    assert.deepEqual(await r.bridge.send(long), { sent: [501, 502, 503] });
    assert.deepEqual(r.api.sent.map((m) => [m.chat_id, m.text.length, m.parse_mode]), [[OPERATOR, 4_000, undefined], [OPERATOR, 4_000, undefined], [OPERATOR, 1_000, undefined]],
      "three parts, each to the operator's chat, as plain text");
    assert.equal(r.api.texts().join(""), long);
    assert.deepEqual(await r.bridge.send("an annotation", { replyTo: 77 }), { sent: [504] });
    assert.deepEqual(r.api.sent.at(-1)?.reply_parameters, { message_id: 77, allow_sending_without_reply: true }, "a reply threads under its message, and still goes if that one is gone");
    const lines = `${"x".repeat(3_000)}\n${"y".repeat(3_000)}`;
    await r.bridge.send(lines);
    assert.deepEqual(r.api.texts().slice(-2), [`${"x".repeat(3_000)}\n`, "y".repeat(3_000)], "cut at the line's end when one falls in the second half");
    assert.deepEqual(await r.bridge.send(" \n "), { sent: [] }, "nothing to say is nothing sent");
    assert.equal(r.api.sent.length, 6);
    assert.deepEqual((await records(r.home)).map((x) => [x.kind, x.parts, x.chars]), [["sent", 3, 9_000], ["sent", 1, 13], ["sent", 2, 6_001]]);
  } finally {
    await r.bridge.dispose();
  }
});

test("splitMessage never breaks a surrogate pair", () => {
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  for (const whole of ["😀".repeat(2_500), `a${"😀".repeat(2_500)}`, `${"b".repeat(3_999)}😀${"c".repeat(10)}`]) {
    const parts = splitMessage(whole);
    assert.ok(parts.length > 1);
    for (const part of parts) {
      assert.ok(part.length <= 4_000, "no part past 4,000 code units");
      assert.doesNotMatch(part, lone, "every part valid UTF-16");
    }
    assert.equal(parts.join(""), whole, "joined back, the text itself");
  }
  assert.equal(splitMessage(`a${"😀".repeat(2_500)}`)[0].length, 3_999, "a cut that would split a pair moves back one");
  assert.deepEqual(splitMessage("short"), ["short"]);
  assert.deepEqual(splitMessage(""), []);
  assert.deepEqual(splitMessage(`${"w ".repeat(2_100)}`).map((p) => p.length), [4_000, 200], "a space when there is no line end");
  assert.deepEqual(splitMessage(`x\n${"z".repeat(5_000)}`).map((p) => p.length), [4_000, 1_002], "a line end in the first half makes no tiny part");
  assert.throws(() => splitMessage("abc", 1), RangeError);
});

/* ---------- the four commands ---------- */

test("parseCommand reads the five commands in any case, with or without the bot's name; anything else is text", () => {
  assert.deepEqual(parseCommand("/status"), { cmd: "status" });
  assert.deepEqual(parseCommand("/pause 2h"), { cmd: "pause", arg: "2h" });
  assert.deepEqual(parseCommand("/pause@gravit_desk_bot 2h"), { cmd: "pause", arg: "2h" });
  assert.deepEqual(parseCommand("  /pause  "), { cmd: "pause" });
  assert.deepEqual(parseCommand("/new"), { cmd: "new" });
  assert.deepEqual(parseCommand("/stop@gravit_desk_bot"), { cmd: "stop" });
  assert.deepEqual(parseCommand("/Status"), { cmd: "status" }, "a phone's capital");
  assert.deepEqual(parseCommand("/PAUSE@Gravit_Desk_Bot 2H"), { cmd: "pause", arg: "2H" }, "the word in any case; the argument as typed");
  assert.deepEqual(parseCommand("/New"), { cmd: "new" });
  assert.deepEqual(parseCommand("/sToP@GRAVIT_DESK_BOT"), { cmd: "stop" });
  assert.deepEqual(parseCommand("/mute 2h"), { cmd: "mute", arg: "2h" });
  assert.deepEqual(parseCommand("/mute@gravit_desk_bot 2h"), { cmd: "mute", arg: "2h" });
  assert.deepEqual(parseCommand("/Mute"), { cmd: "mute" });
  for (const other of ["/help", "/start", "/pause2h", "/statuses", "/Statuses", "status", "hi /status", "/resume", "/Resume", "/mute2h", "/muted", "/unmute"]) {
    assert.equal(parseCommand(other), undefined, other);
  }
});

test("/status, /pause 2h, /new and /stop", async () => {
  const r = await rig("commands");
  try {
    await polled(r, 1);
    r.api.push(text(1, "/status"));
    await polled(r, 2);
    assert.equal(r.api.texts()[0], [
      "up 1h 30m since 2026-10-20T17:00:00.000Z · desk on",
      "desk: paused since 14:00 ET by telegram until 16:00 ET (npm run desk -- resume)",
      "telegram: polling, last poll 14:29 ET, 1 dropped, 0 queued",
      "desk session desk-s1",
      "turns today 3",
    ].join("\n"));

    r.api.push(text(2, "/pause 2h"));
    await polled(r, 3);
    assert.equal(r.api.texts()[1], "paused until 16:30 ET; a terminal resumes it: npm run desk -- resume");
    assert.deepEqual(JSON.parse(await fileText(r.home, OFF_FILE)), { setAt: "2026-10-20T18:30:00.000Z", by: "telegram", until: "2026-10-20T20:30:00.000Z" });
    r.api.push(text(3, "/Pause@Gravit_Desk_Bot 1h"));
    await polled(r, 4);
    assert.equal(r.api.texts()[2], "paused until 16:30 ET; a terminal resumes it: npm run desk -- resume", "a shorter pause stands aside: the reply names the pause in force");
    r.api.push(text(4, "/pause 1d"));
    await polled(r, 5);
    assert.equal(r.api.texts()[3], "paused until 2026-10-21 14:30 ET; a terminal resumes it: npm run desk -- resume", "an end on another New York date carries it");
    r.api.push(text(5, "/PAUSE 2H"));
    await polled(r, 6);
    assert.equal(r.api.texts()[4], "/pause takes Nm, Nh or Nd - 30m, 2h, 1d - or nothing; nothing was paused", "the command in any case, the duration exact");
    assert.equal(JSON.parse(await fileText(r.home, OFF_FILE)).until, "2026-10-21T18:30:00.000Z", "a duration that does not parse writes nothing");
    r.api.push(text(6, "/pause"));
    await polled(r, 7);
    assert.equal(r.api.texts()[5], "paused; a terminal resumes it: npm run desk -- resume");

    r.api.push(text(7, "/new"));
    await polled(r, 8);
    assert.equal(r.conversation.renews, 1);
    assert.equal(r.api.texts()[6], "a new desk conversation");
    r.conversation.renewFails = "the desk is shut down";
    r.api.push(text(8, "/new"));
    await polled(r, 9);
    assert.equal(r.api.texts()[7], "a new desk conversation could not be opened: the desk is shut down");

    r.api.push(text(9, "/Stop"));
    await polled(r, 10);
    r.conversation.stopAnswer = false;
    r.api.push(text(10, "/stop@gravit_desk_bot"));
    await polled(r, 11);
    assert.deepEqual(r.conversation.stops, ["stopped from the phone", "stopped from the phone"]);
    assert.deepEqual(r.api.texts().slice(8), ["stopped", "nothing is running"]);
    assert.equal(r.conversation.posts.length, 0, "no command is text for Gravit");

    r.api.push(text(11, "/help"));
    await polled(r, 12);
    assert.deepEqual(r.conversation.posts.map((p) => p.text), ["/help"], "any other /word is");
  } finally {
    await r.bridge.dispose();
  }
});

test("/mute 2h writes MUTE and replies its end; /mute alone or /mute 0m is the usage; a shorter mute replies the one in force", async () => {
  const r = await rig("mute");
  try {
    await polled(r, 1);
    r.api.push(text(1, "/mute 2h"));
    await polled(r, 2);
    assert.equal(r.api.texts()[0], "alerts muted until 16:30 ET; detection and the ledger go on. A terminal lifts it: npm run desk -- unmute");
    assert.deepEqual(JSON.parse(await fileText(r.home, MUTE_FILE)), { setAt: "2026-10-20T18:30:00.000Z", by: "telegram", until: "2026-10-20T20:30:00.000Z" });
    r.api.push(text(2, "/Mute@Gravit_Desk_Bot 1h"));
    await polled(r, 3);
    assert.equal(r.api.texts()[1], "alerts muted until 16:30 ET; detection and the ledger go on. A terminal lifts it: npm run desk -- unmute",
      "a shorter mute stands aside: the reply names the mute in force");
    for (const [id, bad] of [[3, "/mute"], [4, "/mute 0m"], [5, "/mute soon"]] as const) {
      r.api.push(text(id, bad));
      await polled(r, id + 1);
      assert.equal(r.api.texts()[id - 1], MUTE_USAGE, bad);
    }
    assert.equal(JSON.parse(await fileText(r.home, MUTE_FILE)).until, "2026-10-20T20:30:00.000Z", "the usage writes nothing");
    r.api.push(text(6, "/mute 1d"));
    await polled(r, 7);
    assert.equal(r.api.texts()[5], "alerts muted until 2026-10-21 14:30 ET; detection and the ledger go on. A terminal lifts it: npm run desk -- unmute");
    assert.deepEqual((await readEvents(r.home)).events.map((e) => e.kind), ["mute-set", "mute-set"], "one event per real change");
    assert.equal(existsSync(join(deskDir(r.home), OFF_FILE)), false, "the mute pauses nothing");
    assert.equal(r.conversation.posts.length, 0, "no /mute is text for Gravit");
  } finally {
    await r.bridge.dispose();
  }
});

test("a mute that cannot be written answers with why", { skip: process.getuid?.() === 0 && "root writes anywhere" }, async () => {
  const r = await rig("mute-failure");
  try {
    await polled(r, 1);
    await mkdir(deskDir(r.home), { recursive: true });
    await chmod(deskDir(r.home), 0o500);
    try {
      r.api.push(text(1, "/mute 2h"));
      await polled(r, 2);
    } finally {
      await chmod(deskDir(r.home), 0o700);
    }
    assert.match(r.api.texts()[0], /^the mute could not be written: EACCES\b/);
    assert.equal(existsSync(join(deskDir(r.home), MUTE_FILE)), false);
  } finally {
    await r.bridge.dispose();
  }
});

/* A desk directory the face may not write makes the switch's lock fail at once (EACCES), as root never sees. */
test("a pause that cannot be written and a stop that fails each answer with why", { skip: process.getuid?.() === 0 && "root writes anywhere" }, async () => {
  const r = await rig("command-failures");
  try {
    await polled(r, 1);
    await mkdir(deskDir(r.home), { recursive: true });
    await chmod(deskDir(r.home), 0o500);
    try {
      r.api.push(text(1, "/pause 2h"));
      await polled(r, 2);
    } finally {
      await chmod(deskDir(r.home), 0o700);
    }
    assert.match(r.api.texts()[0], /^the pause could not be set: EACCES\b/);
    assert.equal(existsSync(join(deskDir(r.home), OFF_FILE)), false, "and no pause was written");
    r.conversation.stopFails = "the agent is gone";
    r.api.push(text(2, "/stop"));
    await polled(r, 3);
    assert.deepEqual(r.conversation.stops, ["stopped from the phone"]);
    assert.equal(r.api.texts()[1], "the desk could not be stopped: the agent is gone");
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- a desk that is slow to take a message ---------- */

test("a post the desk is slow to take is answered so after 30 s and the offset moves on; a late refusal still gets its line", async () => {
  const conversation = new FakeConversation();
  conversation.gate = new Promise(() => {}); // the first post never settles
  const r = await rig("slow-post", { conversation });
  try {
    await polled(r, 1);
    r.api.push(text(1, "never taken"));
    await waitFor("the post's 30 s", () => conversation.posts.length === 1 && r.clock.has(30_000));
    r.clock.advance(29_999);
    await new Promise((done) => setTimeout(done, 20));
    assert.deepEqual(r.api.texts(), [], "not before 30 s");
    r.clock.advance(1);
    await polled(r, 2);
    assert.deepEqual(r.api.texts(), ["the desk is slow to take this; it will answer when it can"]);
    assert.equal(await fileText(r.home, "telegram.offset"), "2\n", "the offset moved on");

    const late = deferred();
    conversation.gate = late.promise;
    conversation.answers.push({ refused: "paused", line: "paused since 14:00 ET by terminal; a terminal resumes it: npm run desk -- resume" });
    r.api.push(text(2, "taken late"));
    await waitFor("the second post's 30 s", () => conversation.posts.length === 2 && r.clock.has(30_000));
    r.clock.advance(30_000);
    await polled(r, 3);
    r.api.push(text(3, "/status"));
    await polled(r, 4);
    assert.ok(r.api.texts()[2].startsWith("up "), "the bridge goes on while a post is under way");
    late.resolve();
    await waitFor("the late refusal's line", () => r.api.texts().length === 4);
    assert.deepEqual(r.api.texts(), [
      "the desk is slow to take this; it will answer when it can",
      "the desk is slow to take this; it will answer when it can",
      r.api.texts()[2],
      "paused since 14:00 ET by terminal; a terminal resumes it: npm run desk -- resume",
    ]);
  } finally {
    await r.bridge.dispose();
  }
});

test("a /new the desk is slow to open is answered so after 30 s, then with the new conversation when it comes", async () => {
  const conversation = new FakeConversation();
  const opened = deferred();
  conversation.renewGate = opened.promise;
  const r = await rig("slow-new", { conversation });
  try {
    await polled(r, 1);
    r.api.push(text(1, "/new"));
    await waitFor("the renew's 30 s", () => conversation.renews === 1 && r.clock.has(30_000));
    r.clock.advance(30_000);
    await polled(r, 2);
    assert.deepEqual(r.api.texts(), ["the desk is slow to take this; it will answer when it can"]);
    opened.resolve();
    await waitFor("the late answer", () => r.api.texts().length === 2);
    assert.equal(r.api.texts()[1], "a new desk conversation");
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- the offset ---------- */

test("unusable updates advance the offset", async () => {
  const r = await rig("unusable");
  try {
    await polled(r, 1);
    /* one at a time, so no later update can carry the offset past an earlier one */
    const unusable: Update[] = [
      { update_id: 10, edited_message: { message_id: 9, from: { id: OPERATOR }, chat: { id: OPERATOR, type: "private" }, text: "hi, edited" } },
      message(11, { sticker: { file_id: "s", emoji: "👍" } }),
      { update_id: 12, channel_post: { message_id: 3, chat: { id: -1001, type: "channel" }, text: "news" } },
      message(13, { from: undefined, sender_chat: { id: -1002, type: "supergroup" }, chat: { id: -1002, type: "supergroup" }, text: "anonymous" }),
    ];
    for (const [i, update] of unusable.entries()) {
      r.api.push(update);
      await polled(r, i + 2);
      assert.equal(r.api.polls()[i + 1].offset, update.update_id + 1, `the poll after update ${update.update_id} is past it`);
      assert.equal(await fileText(r.home, "telegram.offset"), `${update.update_id + 1}\n`);
    }
    assert.deepEqual(r.api.texts(), ["text only on the desk"], "the operator's sticker gets one line; the rest, nothing");
    assert.deepEqual(r.conversation.posts, []);
    assert.equal(r.bridge.status().dropped, 3);
    assert.equal(Object.hasOwn(r.bridge.status(), "lastDroppedFrom"), false, "the last one had no sender");
    assert.deepEqual((await records(r.home)).filter((x) => x.kind === "drop").map(({ t: _t, ...rest }) => rest), [
      { kind: "drop", from: OPERATOR, chatType: "private" },
      { kind: "drop", chatType: "channel" },
      { kind: "drop", chatType: "supergroup" },
    ]);
    r.api.endPoll();
    await polled(r, 6);
    assert.equal(r.api.polls()[5].offset, 14);
    assert.equal(r.bridge.status().dropped, 3, "never redelivered");
    assert.equal(r.api.sent.length, 1);
  } finally {
    await r.bridge.dispose();
  }
});

test("restart resumes from the stored offset and flushes the outbox first", async () => {
  const home = await freshHome("restart");
  await putFile(home, "telegram.offset", "101\n");
  /* queued a minute before this boot: not late (that is its own test) */
  await putFile(home, "outbox.json", JSON.stringify([
    { t: new Date(NOW - 60_000).toISOString(), text: "first queued" },
    { t: new Date(NOW - 30_000).toISOString(), text: "second queued" },
  ]));
  const api = new FakeBotApi();
  api.updates.push(text(100, "handled before the restart"), text(101, "new since"));
  const conversation = new FakeConversation();
  conversation.answers.push({ refused: "error", line: "the desk could not open a turn: EIO" });
  const r = await rig("restart", { home, api, conversation });
  try {
    await polled(r, 2);
    assert.deepEqual(r.api.calls.map((c) => (c.method === "sendMessage" ? `send ${c.body.text}` : `poll ${c.body.offset}`)), [
      "send first queued", "send second queued", "poll 101", "send the desk could not open a turn: EIO", "poll 102",
    ], "the queued messages, in their order, before the first poll; the new reply after them");
    assert.deepEqual(r.conversation.posts.map((p) => p.text), ["new since"], "update 100 is not taken again");
    assert.deepEqual(JSON.parse(await fileText(home, "outbox.json")), []);
    assert.equal(await fileText(home, "telegram.offset"), "102\n");
    await r.bridge.dispose();

    const again = await rig("restart", { home, api, conversation: new FakeConversation() });
    try {
      await waitFor("the restarted bridge's first poll", () => api.polls().length === 3 && api.pending === 1);
      assert.equal(api.polls()[2].offset, 102);
      assert.deepEqual(again.conversation.posts, [], "nothing is processed twice");
      assert.equal(api.sent.length, 3);
    } finally {
      await again.bridge.dispose();
    }
  } finally {
    await r.bridge.dispose();
  }
});

/* After about a week with no update Telegram may number its updates afresh, and telegram-bot-api answers from
 * the head of its queue whatever offset is asked: the ids fall below the stored offset. Passed over, every
 * message after it - /stop included - would go unheard while the status read healthy. */
test("a renumbered queue: ids below the stored offset are taken, and the next poll asks for the last id + 1", async () => {
  const home = await freshHome("renumbered");
  await putFile(home, "telegram.offset", "101\n");
  const api = new FakeBotApi();
  api.ignoreOffsetOnce = true;
  api.updates.push(text(5, "after a quiet week"), text(6, "/stop"), text(7, "still there?"));
  const r = await rig("renumbered", { home, api });
  try {
    await polled(r, 2);
    assert.equal(api.polls()[0].offset, 101, "the poll asked from the stored offset");
    assert.deepEqual(r.conversation.posts.map((p) => p.text), ["after a quiet week", "still there?"], "every update taken, in order");
    assert.deepEqual(r.conversation.stops, ["stopped from the phone"], "the command among them too");
    assert.equal(api.polls()[1].offset, 8, "the offset set from the last id, not kept at the old one");
    assert.equal(await fileText(home, "telegram.offset"), "8\n");
    assert.deepEqual(r.lines, [
      "gravit-face: telegram: Telegram update 5 is below the stored offset 101: Telegram has numbered its updates afresh, so the bridge takes it and goes on from 6",
    ], "one line, for the first update below the offset, in the bridge's own words");
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- the outbox ---------- */

test("a failed send is queued with its time, resolves queued, and is flushed in order", async () => {
  const r = await rig("outbox");
  try {
    await polled(r, 1);
    r.api.send = () => "network";
    assert.deepEqual(await r.bridge.send("one"), { queued: true });
    r.clock.advance(1_000);
    assert.deepEqual(await r.bridge.send("two", { replyTo: 9 }), { queued: true });
    r.api.send = () => "hang";
    r.clock.advance(1_000);
    const slow = r.bridge.send("three");
    await waitFor("the flush's send held open", () => r.api.calls.filter((c) => c.method === "sendMessage").length === 3);
    assert.ok(r.clock.has(15_000), "a send has its own 15 s");
    r.clock.advance(15_000);
    assert.deepEqual(await slow, { queued: true }, "a send cut at 15 s is queued like any failed one");
    assert.equal(r.api.abortedSends, 1);
    assert.deepEqual(JSON.parse(await fileText(r.home, "outbox.json")), [
      { t: "2026-10-20T18:30:00.000Z", text: "one" },
      { t: "2026-10-20T18:30:01.000Z", text: "two", replyTo: 9 },
      { t: "2026-10-20T18:30:02.000Z", text: "three" },
    ], "each with the time it was sent at, in order");
    assert.equal(r.bridge.status().queued, 3);
    assert.ok(r.lines.some((l) => /^gravit-face: telegram: a message could not be sent \(.*\); it waits in the outbox$/.test(l)));

    r.api.send = () => undefined;
    assert.deepEqual(await r.bridge.send("four"), { sent: [504] }, "a new send goes after the queued ones");
    assert.deepEqual(r.api.texts(), ["one", "two", "three", "four"]);
    assert.deepEqual(r.api.sent[1].reply_parameters, { message_id: 9, allow_sending_without_reply: true }, "a queued reply is still a reply");
    assert.deepEqual(JSON.parse(await fileText(r.home, "outbox.json")), []);
    assert.equal(r.bridge.status().queued, 0);
    assert.deepEqual(await kinds(r.home), ["queued", "queued", "queued", "sent", "sent", "sent", "sent"]);
  } finally {
    await r.bridge.dispose();
  }
});

test("a send that fails part of the way queues only what did not go", async () => {
  const r = await rig("partial");
  try {
    await polled(r, 1);
    let calls = 0;
    r.api.send = () => (++calls === 2 ? "network" : undefined);
    assert.deepEqual(await r.bridge.send("a".repeat(9_000), { replyTo: 5 }), { sent: [501], queued: true },
      "the id of the part that went, and that the rest is queued");
    assert.deepEqual(r.api.sent.map((m) => m.text.length), [4_000]);
    assert.deepEqual(JSON.parse(await fileText(r.home, "outbox.json")), [{ t: new Date(NOW).toISOString(), text: "a".repeat(5_000) }],
      "the rest, and no longer a reply: its first part went as one");
    r.api.send = () => undefined;
    r.api.endPoll();
    await polled(r, 2);
    assert.deepEqual(r.api.sent.map((m) => m.text.length), [4_000, 4_000, 1_000]);
    assert.equal(r.api.sent[1].reply_parameters, undefined);
    assert.deepEqual((await records(r.home)).map((x) => [x.kind, x.parts ?? null, x.chars]), [["sent", 1, 4_000], ["queued", null, 5_000], ["sent", 2, 5_000]]);
  } finally {
    await r.bridge.dispose();
  }
});

test("a queued message that goes part of the way stays queued as the rest, under its own time", async () => {
  const home = await freshHome("partial-flush");
  const queuedAt = new Date(NOW - 60_000).toISOString();
  await putFile(home, "outbox.json", JSON.stringify([{ t: queuedAt, text: "b".repeat(9_000) }]));
  const api = new FakeBotApi();
  let calls = 0;
  api.send = () => (++calls === 2 ? "network" : undefined);
  const r = await rig("partial-flush", { home, api });
  try {
    await polled(r, 1);
    assert.deepEqual(api.sent.map((m) => m.text.length), [4_000]);
    assert.deepEqual(JSON.parse(await fileText(home, "outbox.json")), [{ t: queuedAt, text: "b".repeat(5_000) }]);
    api.send = () => undefined;
    api.endPoll();
    await polled(r, 2);
    assert.deepEqual(api.sent.map((m) => m.text.length), [4_000, 4_000, 1_000], "each part once");
    assert.deepEqual(JSON.parse(await fileText(home, "outbox.json")), []);
    assert.deepEqual((await records(home)).map((x) => [x.kind, x.parts, x.chars]), [["sent", 1, 4_000], ["sent", 2, 5_000]]);
  } finally {
    await r.bridge.dispose();
  }
});

/* The Mac slept: a reply queued before it went to sleep is flushed when it wakes, hours later. */
test("a message flushed more than 2 minutes after it was written opens with the time it was written", async () => {
  const r = await rig("late", { pollTimeoutS: 200_000 }); // a poll held across a day's clock is not cut
  try {
    await polled(r, 1);
    const queue = async (body: string): Promise<void> => {
      r.api.send = () => "network";
      assert.deepEqual(await r.bridge.send(body), { queued: true });
      r.api.send = () => undefined;
    };
    await queue("written at 14:30");
    r.clock.advance(120_000);
    await r.bridge.send("fresh one");
    assert.deepEqual(r.api.texts(), ["written at 14:30", "fresh one"], "two minutes is not late, and a fresh send never is");
    await queue("written at 14:32");
    r.clock.advance(120_001);
    await r.bridge.send("fresh two");
    assert.deepEqual(r.api.texts().slice(2), ["(written 14:32 ET, sent late)\nwritten at 14:32", "fresh two"]);
    await queue("written the day before");
    r.clock.advance(24 * 3_600_000);
    r.api.endPoll();
    await polled(r, 2);
    assert.equal(r.api.texts()[4], "(written 2026-10-20 14:34 ET, sent late)\nwritten the day before", "the loop's flush says so too, dated on another day");
  } finally {
    await r.bridge.dispose();
  }
});

/* Telegram answers 403 when the operator has blocked the bot (or never started it): sending again cannot help
 * until they unblock it, so the message is not kept - and the status says why the phone hears nothing. */
test("a 403 drops the message with one line, and the status reads blocked until a send goes through", async () => {
  const home = await freshHome("blocked");
  await putFile(home, "outbox.json", JSON.stringify([{ t: "2026-10-20T18:00:00.000Z", text: "queued before the block" }]));
  const api = new FakeBotApi();
  api.send = () => ({ status: 403, description: "Forbidden: bot was blocked by the user" });
  const r = await rig("blocked", { home, api });
  try {
    await polled(r, 1);
    assert.deepEqual(JSON.parse(await fileText(home, "outbox.json")), [], "the queued message is dropped");
    assert.deepEqual(r.lines, ["gravit-face: telegram: Telegram refused a queued message (HTTP 403 Forbidden: bot was blocked by the user); it is dropped from the outbox"]);
    assert.equal(r.bridge.status().blocked, true);
    await assert.rejects(r.bridge.send("a fresh one"), /^Error: Telegram refused the message: HTTP 403 Forbidden: bot was blocked by the user$/,
      "a fresh one rejects: its caller's line is the one line");
    assert.equal(r.bridge.status().queued, 0, "and is never queued");
    assert.equal(deskStatusLines({ ...STATUS, telegram: r.bridge.status() }, new Date(NOW)).at(-1), "telegram: blocked (403), polling, no poll yet, 0 dropped, 0 queued");
    api.send = () => undefined;
    assert.deepEqual(await r.bridge.send("unblocked"), { sent: [501] });
    assert.equal(Object.hasOwn(r.bridge.status(), "blocked"), false, "a send that goes through ends it");
  } finally {
    await r.bridge.dispose();
  }
});

test("the outbox holds at most 100 messages: one more drops the oldest, with one line", async () => {
  const home = await freshHome("cap");
  const writtenAt = (i: number): string => new Date(NOW - (200 - i) * 60_000).toISOString();
  await putFile(home, "outbox.json", JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ t: writtenAt(i), text: `m${i}` }))));
  const api = new FakeBotApi();
  api.send = () => "network";
  const r = await rig("cap", { home, api });
  try {
    await polled(r, 1);
    assert.equal(r.bridge.status().queued, 100);
    assert.deepEqual(await r.bridge.send("m100"), { queued: true });
    const kept = (JSON.parse(await fileText(home, "outbox.json")) as { text: string }[]).map((e) => e.text);
    assert.equal(kept.length, 100);
    assert.deepEqual([kept[0], kept.at(-1)], ["m1", "m100"], "the oldest went; the newest is last");
    assert.deepEqual(r.lines, ["gravit-face: telegram: the outbox holds 100 messages; the oldest, written 11:10 ET, is dropped"]);
    assert.equal(r.bridge.status().queued, 100);
  } finally {
    await r.bridge.dispose();
  }
});

test("the bridge's files are the operator's alone: outbox.json, telegram.offset and telegram.jsonl are 0600", async () => {
  const r = await rig("modes");
  try {
    await polled(r, 1);
    r.api.send = () => "network";
    await r.bridge.send("held");
    r.api.send = () => undefined;
    r.api.push(text(1, "hi"));
    await polled(r, 2);
    const mode = async (name: string): Promise<number> => (await stat(join(deskDir(r.home), name))).mode & 0o777;
    for (const name of ["outbox.json", "telegram.offset", "telegram.jsonl"]) assert.equal(await mode(name), 0o600, name);
    assert.deepEqual(JSON.parse(await fileText(r.home, "outbox.json")), [], "the flush before the second poll rewrote it");
    assert.equal(await mode("outbox.json"), 0o600, "and a rewritten file is 0600 too");
  } finally {
    await r.bridge.dispose();
  }
});

test("the loop flushes the outbox before each poll", async () => {
  const r = await rig("flush");
  try {
    await polled(r, 1);
    r.api.send = () => "network";
    await r.bridge.send("held");
    r.api.send = () => undefined;
    r.api.endPoll();
    await polled(r, 2);
    assert.deepEqual(r.api.calls.map((c) => c.method), ["getUpdates", "sendMessage", "sendMessage", "getUpdates"]);
    assert.deepEqual(r.api.texts(), ["held"]);
    assert.equal(r.bridge.status().queued, 0);
  } finally {
    await r.bridge.dispose();
  }
});

test("a queued message Telegram refuses is dropped, so it cannot hold up the rest; a fresh one it refuses rejects", async () => {
  const home = await freshHome("refusal");
  await putFile(home, "outbox.json", JSON.stringify([{ t: new Date(NOW - 60_000).toISOString(), text: "bad" }, { t: new Date(NOW - 30_000).toISOString(), text: "good" }]));
  const api = new FakeBotApi();
  api.send = (body) => (body.text === "bad" ? { status: 400, description: "Bad Request: message is too long" } : undefined);
  const r = await rig("refusal", { home, api });
  try {
    await polled(r, 1);
    assert.deepEqual(api.texts(), ["good"]);
    assert.deepEqual(JSON.parse(await fileText(home, "outbox.json")), []);
    assert.ok(r.lines.includes("gravit-face: telegram: Telegram refused a queued message (HTTP 400 Bad Request: message is too long); it is dropped from the outbox"));
    await assert.rejects(r.bridge.send("bad"), /^Error: Telegram refused the message: HTTP 400 Bad Request: message is too long$/);
    assert.equal(r.bridge.status().queued, 0, "a message Telegram refuses is not queued");
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- the poll's failures ---------- */

test("409 conflict is recorded once a minute and backed off", async () => {
  const POLLER = "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running";
  const WEBHOOK = "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first";
  const api = new FakeBotApi();
  let conflicts = 0;
  /* a second poller, then - from the third conflict on - a webhook left set: both answer 409 */
  api.poll = () => ({ status: 409, description: ++conflicts < 3 ? POLLER : WEBHOOK });
  const r = await rig("conflict", { api });
  try {
    const at = (s: number): string => new Date(NOW + s * 1_000).toISOString();
    await waitFor("the first conflict's wait", () => r.clock.has(30_000));
    assert.deepEqual(await records(r.home), [{ t: at(0), kind: "conflict", description: POLLER }]);
    assert.equal(r.bridge.status().conflictAt, at(0));
    r.clock.advance(29_999);
    await new Promise((done) => setTimeout(done, 20));
    assert.equal(r.api.polls().length, 1, "no poll inside the 30 s");
    for (const [n, s] of [[2, 30], [3, 60], [4, 90]] as const) {
      r.clock.advance(s === 30 ? 1 : 30_000);
      await waitFor(`conflict ${n}`, () => r.api.polls().length === n && r.clock.has(30_000));
      assert.equal(r.bridge.status().conflictAt, at(s), "the status names the last conflict");
    }
    assert.deepEqual(await records(r.home), [{ t: at(0), kind: "conflict", description: POLLER }, { t: at(60), kind: "conflict", description: WEBHOOK }],
      "once a minute, each with what Telegram said");
    assert.deepEqual(r.lines, [
      `gravit-face: telegram: getUpdates got HTTP 409 (${POLLER}): another poller holds the bot's token - a second face without FACE_DESK=0? - or a webhook is set; polling again in 30 s`,
      `gravit-face: telegram: getUpdates got HTTP 409 (${WEBHOOK}): another poller holds the bot's token - a second face without FACE_DESK=0? - or a webhook is set; polling again in 30 s`,
    ]);
    r.api.poll = () => undefined;
    r.clock.advance(30_000);
    await polled(r, 5);
    r.api.push(text(1, "back"));
    await polled(r, 6);
    assert.deepEqual(r.conversation.posts.map((p) => p.text), ["back"], "the bridge kept running");
    assert.equal(r.bridge.status().polling, true);
    assert.equal(r.bridge.status().conflictAt, at(90));
    assert.equal(r.bridge.status().lastPollAt, at(120));
  } finally {
    await r.bridge.dispose();
  }
});

test("a failed poll is recorded once a minute and backed off from 5 s, doubling to 60 s; a poll that answers resets it", async () => {
  const api = new FakeBotApi();
  api.poll = () => "network";
  const r = await rig("backoff", { api });
  try {
    const at = (s: number): string => new Date(NOW + s * 1_000).toISOString();
    let s = 0;
    for (const wait of [5, 10, 20, 40, 60, 60]) {
      await waitFor(`a ${wait} s backoff`, () => r.clock.has(wait * 1_000));
      r.clock.advance(wait * 1_000);
      s += wait;
    }
    await waitFor("the seventh poll's backoff", () => r.api.polls().length === 7 && r.clock.has(60_000));
    assert.deepEqual((await records(r.home)).map((x) => [x.kind, x.t]), [["poll-error", at(0)], ["poll-error", at(75)], ["poll-error", at(135)], ["poll-error", at(195)]],
      "failures at 0, 5, 15, 35, 75, 135 and 195 s: one record a minute");
    assert.equal(s, 195);
    r.api.poll = () => undefined;
    r.clock.advance(60_000);
    await polled(r, 8);
    r.api.poll = () => "network";
    r.api.endPoll();
    await waitFor("a fresh 5 s backoff", () => r.api.polls().length === 9 && r.clock.has(5_000));
  } finally {
    await r.bridge.dispose();
  }
});

/* A revoked token answers every poll 401, a mistyped one 404: the loop goes on, `polling` stays true and only the
 * last poll's time goes stale - so the status says so, since when and why, until a poll answers. */
test("a failing poll shows in the status and its line - since when, and why, redacted - and a poll that answers clears it", async () => {
  const api = new FakeBotApi();
  /* Telegram's own words, and - as a careless proxy might - the token and a secret in them */
  api.poll = () => ({ status: 401, description: `Unauthorized for /bot${TOKEN}/getUpdates (key made-up-poll-secret-0042)` });
  const r = await rig("failing-poll", { api, secrets: ["made-up-poll-secret-0042"] });
  try {
    const at = (s: number): string => new Date(NOW + s * 1_000).toISOString();
    const reason = "HTTP 401 Unauthorized for /bot<token>/getUpdates (key <secret>)";
    await waitFor("the first backoff", () => r.clock.has(5_000));
    assert.deepEqual(r.bridge.status().pollFailing, { since: at(0), reason }, "since the first failure, why the last");
    assert.equal(r.bridge.status().polling, true, "the loop goes on");
    assert.equal(deskStatusLines({ ...STATUS, telegram: r.bridge.status() }, new Date(NOW)).at(-1),
      `telegram: polling, no poll yet, 0 dropped, 0 queued, poll failing since 14:30 ET: ${reason}`);
    /* A mistyped token, five seconds on: still failing since the first, now for the new reason. */
    api.poll = () => ({ status: 404, description: "Not Found" });
    r.clock.advance(5_000);
    await waitFor("the second backoff", () => r.api.polls().length === 2 && r.clock.has(10_000));
    assert.deepEqual(r.bridge.status().pollFailing, { since: at(0), reason: "HTTP 404 Not Found" });
    for (const line of [...r.lines, JSON.stringify(r.bridge.status()), JSON.stringify(await records(r.home))]) {
      assert.equal(line.includes(TOKEN) || line.includes("made-up-poll-secret-0042"), false, `nothing carries the token or the secret: ${line}`);
    }
    /* A poll that answers clears it - not one merely under way. */
    api.poll = () => undefined;
    r.clock.advance(10_000);
    await polled(r, 3);
    assert.equal(Object.hasOwn(r.bridge.status(), "pollFailing"), true, "a poll Telegram holds open has not answered yet");
    api.endPoll();
    await polled(r, 4);
    assert.equal(Object.hasOwn(r.bridge.status(), "pollFailing"), false);
    assert.equal(r.bridge.status().lastPollAt, at(15));
    assert.equal(deskStatusLines({ ...STATUS, telegram: r.bridge.status() }, new Date(NOW)).at(-1), "telegram: polling, last poll 14:30 ET, 0 dropped, 0 queued");
    /* And a 409 is a failing poll too, beside its conflict. */
    api.poll = () => ({ status: 409, description: "Conflict: terminated by other getUpdates request" });
    api.endPoll();
    await waitFor("the conflict's wait", () => r.clock.has(30_000));
    assert.deepEqual(r.bridge.status().pollFailing, { since: at(15), reason: "HTTP 409 Conflict: terminated by other getUpdates request" });
    assert.equal(r.bridge.status().conflictAt, at(15));
  } finally {
    await r.bridge.dispose();
  }
});

test("a poll that goes unanswered is cut at 65 s - the long poll and 15 s - and is a failed poll", async () => {
  const api = new FakeBotApi();
  api.poll = () => "hang";
  const r = await rig("hung-poll", { api });
  try {
    await waitFor("the poll under way", () => api.polls().length === 1);
    assert.ok(r.clock.has(65_000), "the poll's own deadline");
    r.clock.advance(64_999);
    await new Promise((done) => setTimeout(done, 20));
    assert.equal(api.abortedPolls, 0);
    r.clock.advance(1);
    await waitFor("the backoff after it", () => r.clock.has(5_000));
    assert.equal(api.abortedPolls, 1);
    assert.deepEqual(await records(r.home), [{ t: new Date(NOW + 65_000).toISOString(), kind: "poll-error", reason: "no answer in 65 s" }]);
  } finally {
    await r.bridge.dispose();
  }
});

/* ---------- the outlet and the end ---------- */

test("the bridge is the conversation's outlet until dispose", async () => {
  const r = await rig("outlet");
  assert.equal(r.conversation.outlets.length, 1);
  const outlet = r.conversation.outlets[0];
  assert.notEqual(outlet, undefined);
  assert.deepEqual(await outlet?.send("a desk answer"), { sent: [501] });
  assert.deepEqual(r.api.sent.map((m) => [m.chat_id, m.text]), [[OPERATOR, "a desk answer"]]);
  await r.bridge.dispose();
  assert.deepEqual(r.conversation.outlets, [outlet, undefined]);
});

test("dispose aborts the poll", async () => {
  const home = await freshHome("dispose");
  await putFile(home, "outbox.json", JSON.stringify([{ t: "2026-10-20T13:00:00.000Z", text: "kept" }]));
  const api = new FakeBotApi();
  api.send = () => "network";
  const r = await rig("dispose", { home, api });
  await polled(r, 1);
  assert.equal(r.bridge.status().polling, true);
  await r.bridge.dispose();
  assert.equal(api.abortedPolls, 1);
  assert.equal(r.bridge.status().polling, false);
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(api.polls().length, 1, "the loop stopped: no poll after dispose");
  assert.deepEqual(JSON.parse(await fileText(home, "outbox.json")), [{ t: "2026-10-20T13:00:00.000Z", text: "kept" }], "the outbox is kept");
  const calls = api.calls.length;
  assert.deepEqual(await r.bridge.send("after"), { queued: true }, "a send after dispose waits in the outbox for the next boot");
  assert.equal(api.calls.length, calls, "and makes no request");
  assert.equal(r.bridge.status().queued, 2);
  assert.equal(r.lines.some((l) => /poll failed/.test(l)), false, "the abort is no failure");
  await r.bridge.dispose();
});

test("dispose stops waiting after 2 s for an update still in hand", async () => {
  const conversation = new FakeConversation();
  conversation.gate = new Promise(() => {});
  const r = await rig("dispose-bound", { conversation });
  await polled(r, 1);
  r.api.push(text(1, "a post that never settles"));
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

/* ---------- configuration and the token ---------- */

test("telegramConfigFromEnv needs both names and a numeric id", () => {
  assert.deepEqual(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_OPERATOR_ID: "42" }), { token: TOKEN, operatorId: 42 });
  for (const env of [
    {}, { TELEGRAM_BOT_TOKEN: TOKEN }, { TELEGRAM_OPERATOR_ID: "42" },
    { TELEGRAM_BOT_TOKEN: "", TELEGRAM_OPERATOR_ID: "42" }, { TELEGRAM_BOT_TOKEN: "  ", TELEGRAM_OPERATOR_ID: "42" },
    ...["", "-42", "4.2", "42x", " 42", "0x2a", "9007199254740993"].map((id) => ({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_OPERATOR_ID: id })),
  ]) assert.equal(telegramConfigFromEnv(env), undefined, JSON.stringify(env));
});

test("the token is only ever in a request's path: no log line, record, file or status carries it", async () => {
  const api = new FakeBotApi();
  api.poll = () => "network";
  const r = await rig("token", { api });
  try {
    await waitFor("the first backoff", () => r.clock.has(5_000));
    r.api.poll = () => ({ status: 502, description: `Bad Gateway for ${API}/bot${TOKEN}/getUpdates` });
    for (const wait of [5, 10, 20, 40]) {
      await waitFor(`a ${wait} s backoff`, () => r.clock.has(wait * 1_000));
      r.clock.advance(wait * 1_000);
    }
    await waitFor("the 502 recorded", async () => (await records(r.home)).length === 2);
    /* the record is written before the backoff is armed: move the clock only once it is */
    await waitFor("the 60 s backoff", () => r.clock.has(60_000));
    r.api.poll = () => undefined;
    r.clock.advance(60_000);
    await polled(r, 6);
    r.api.send = () => "network";
    assert.deepEqual(await r.bridge.send(`a message that quotes ${TOKEN}`), { queued: true });
    r.api.send = () => undefined;
    r.api.push(text(1, "/status"), message(2, { from: { id: 99 }, chat: { id: 99, type: "private" }, text: "x" }));
    await polled(r, 7);
    /* a refusal whose description carries the token rejects with it redacted */
    r.api.send = () => ({ status: 400, description: `Bad Request: ${API}/bot${TOKEN}/sendMessage` });
    const refused = await r.bridge.send("refused outright").then(() => undefined, (err: unknown) => err as Error);
    assert.ok(refused instanceof Error, "a fresh 400 rejects");
    assert.equal(refused.message, `Telegram refused the message: HTTP 400 Bad Request: ${API}/bot<token>/sendMessage`);
    r.api.send = () => undefined;
    /* and a 409 whose description carries it is recorded and said redacted */
    r.api.poll = () => ({ status: 409, description: `Conflict: a webhook is set at ${API}/bot${TOKEN}/hook` });
    r.api.endPoll();
    await waitFor("the conflict recorded", async () => (await records(r.home)).some((x) => x.kind === "conflict"));

    const everything = [
      ...r.lines,
      JSON.stringify(await records(r.home)),
      await fileText(r.home, "outbox.json"),
      await fileText(r.home, "telegram.offset"),
      JSON.stringify(r.bridge.status()),
    ].join("\n");
    assert.equal(everything.includes(TOKEN), false, "the token is nowhere but the URLs");
    assert.ok(r.lines.some((l) => l.includes("<token>")), "a line that carried it says <token> instead");
    assert.ok((await records(r.home)).some((x) => String(x.reason).includes("<token>")), "and so does a record");
    assert.ok((await records(r.home)).some((x) => x.kind === "conflict" && String(x.description).includes("<token>")), "a conflict's description too");
    for (const call of r.api.calls) {
      assert.equal(call.url, `${API}/bot${TOKEN}/${call.method}`);
      assert.equal(JSON.stringify(call.body).includes(TOKEN), false, "never in a request's body");
    }
  } finally {
    await r.bridge.dispose();
  }
});

test("every secret value is redacted from sends, queued text and log lines; the token keeps <token>", async () => {
  /* Made-up secrets as the face's environment would hold them (src/desk-tools.ts `deskSecrets`): the token is one
   * too, and still reads <token>; a secret that wraps it goes whole. */
  const SECRET = "made-up-alpaca-secret-0001";
  const WRAPPED = `wrapped-${TOKEN}`;
  const secrets = deskSecrets({ APCA_API_SECRET_KEY: SECRET, TELEGRAM_BOT_TOKEN: TOKEN, WRAPPED_TOKEN: WRAPPED });
  assert.deepEqual(secrets, [SECRET, TOKEN, WRAPPED]);
  /* An outbox an earlier run left with a secret in it, and Telegram down: the leftover stays queued, and when a new
   * message is queued behind it the outbox is written whole - the leftover redacted as it was read back. */
  const home = await freshHome("secrets");
  await putFile(home, "outbox.json", JSON.stringify([{ t: "2026-10-20T18:29:00.000Z", text: `left over: ${SECRET}` }]));
  const api = new FakeBotApi();
  api.send = () => ({ status: 503, description: "Service Unavailable" });
  const r = await rig("secrets", { home, secrets, api });
  try {
    await polled(r, 1);
    assert.deepEqual(await r.bridge.send(`queued: ${SECRET}`), { queued: true });
    assert.deepEqual(JSON.parse(await fileText(r.home, "outbox.json")), [
      { t: "2026-10-20T18:29:00.000Z", text: "left over: <secret>" },
      { t: "2026-10-20T18:30:00.000Z", text: "queued: <secret>" },
    ], "both queued texts are written redacted, the earlier run's included");
    /* Telegram back: both go first, redacted; then a reply carrying the secret, the token and a secret that wraps it. */
    r.api.send = () => undefined;
    assert.deepEqual(await r.bridge.send(`the key is ${SECRET}; the bot is ${TOKEN}; both are ${WRAPPED}`), { sent: [503] });
    assert.deepEqual(r.api.texts(), ["left over: <secret>", "queued: <secret>", "the key is <secret>; the bot is <token>; both are <secret>"]);
    /* A send that fails is queued redacted, and the line that says so is redacted too. */
    r.api.send = () => ({ status: 503, description: `Service Unavailable: upstream echoed ${SECRET}` });
    assert.deepEqual(await r.bridge.send(`again: ${SECRET}`), { queued: true });
    assert.deepEqual(JSON.parse(await fileText(r.home, "outbox.json")), [{ t: "2026-10-20T18:30:00.000Z", text: "again: <secret>" }]);
    assert.ok(r.lines.some((l) => l.includes("upstream echoed <secret>")), `the failure's line says <secret>; saw ${JSON.stringify(r.lines)}`);
    r.api.send = () => undefined;
    assert.deepEqual(await r.bridge.send("after"), { sent: [505] });
    assert.deepEqual(r.api.texts().slice(3), ["again: <secret>", "after"], "the queued one went first, redacted");
    const everything = [
      ...r.lines,
      JSON.stringify(await records(r.home)),
      await fileText(r.home, "outbox.json"),
      JSON.stringify(r.api.sent),
      JSON.stringify(r.bridge.status()),
    ].join("\n");
    assert.equal(everything.includes(SECRET), false, "the secret is in no send, queued text, line, record or status");
    assert.equal(everything.includes(TOKEN), false, "nor is the token");
  } finally {
    await r.bridge.dispose();
  }
});
