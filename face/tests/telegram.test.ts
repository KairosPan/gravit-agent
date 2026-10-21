// face/tests/telegram.test.ts
/** The Telegram bridge (src/telegram.ts): one operator in a private chat, the four commands, the desk
 * conversation's outlet, the offset across restarts, the outbox, and what a refused or failed poll does.
 * Offline: a fake Bot API answering by URL - no request leaves the process, and nothing here names
 * api.telegram.org - a fake conversation port and a manual clock. Homes sit inside the repository, under
 * tests/tmp/telegram-<pid>/, and are removed afterwards. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OFF_FILE, deskDir, type DeskStatus } from "../src/desk.ts";
import type { DeskConversation, DeskOutlet, PostResult } from "../src/desk-conversation.ts";
import type { DeskClock } from "../src/desk-session.ts";
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
  renewFails: string | undefined;
  /** When set, every post waits for it. */
  gate: Promise<void> | undefined;
  readonly post = async (input: PostInput): Promise<PostResult> => {
    this.posts.push(input);
    if (this.gate !== undefined) await this.gate;
    return this.answers.shift() ?? { opened: true, sessionId: "desk-s1" };
  };
  readonly renew = async (): Promise<{ sessionId: string }> => {
    this.renews += 1;
    if (this.renewFails !== undefined) throw new Error(this.renewFails);
    return { sessionId: `desk-s${this.renews + 1}` };
  };
  readonly stop = async (reason: string): Promise<boolean> => {
    this.stops.push(reason);
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

/** A bridge over a fake Bot API, a fake conversation and a manual clock at {@link NOW}; every part can be given. */
async function rig(label: string, o: Partial<Omit<Rig, "bridge" | "lines">> & { status?: () => Promise<DeskStatus> } = {}): Promise<Rig> {
  const home = o.home ?? await freshHome(label);
  const api = o.api ?? new FakeBotApi();
  const clock = o.clock ?? new Clock(NOW);
  const conversation = o.conversation ?? new FakeConversation();
  const lines: string[] = [];
  const bridge = installTelegramBridge({
    config: { token: TOKEN, operatorId: OPERATOR, apiBase: API, fetch: api.fetch, clock },
    home, conversation, status: o.status ?? (async () => STATUS), log: (line) => { lines.push(line); },
  });
  return { home, api, clock, conversation, lines, bridge };
}

/** Wait until the loop has made `n` polls and holds the last one open: everything before it is handled. */
async function polled(r: Rig, n: number): Promise<void> {
  await waitFor(`poll ${n} held open`, () => r.api.polls().length === n && r.api.pending === 1);
}

/** A message in an update: from the operator, in their private chat, unless `over` says otherwise. */
function message(updateId: number, over: Record<string, unknown> = {}): Update {
  return {
    update_id: updateId,
    message: { message_id: updateId + 1000, from: { id: OPERATOR, is_bot: false, first_name: "Op" }, chat: { id: OPERATOR, type: "private" }, date: 0, ...over },
  };
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
      { text: "hi", source: { kind: "telegram" }, message: { kind: "telegram", from: OPERATOR, chat: OPERATOR, messageId: 7 } },
    ]);
    assert.deepEqual(r.api.sent, [], "an opened turn answers through the outlet, not here");
    assert.deepEqual(r.api.polls()[1], { offset: 6, timeout: 50, allowed_updates: ["message"] }, "the long poll: 50 s, messages only, past the update");
    assert.deepEqual(r.api.polls()[0], { timeout: 50, allowed_updates: ["message"] }, "no offset before the first update");
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
  );
  const r = await rig("refused", { conversation });
  try {
    await polled(r, 1);
    r.api.push(text(1, "one"), text(2, "two"), text(3, "three"));
    await polled(r, 2);
    assert.deepEqual(r.api.sent.map((m) => [m.chat_id, m.text]), [
      [OPERATOR, "paused since 14:00 ET by telegram until 16:00 ET; a terminal resumes it: npm run desk -- resume"],
      [OPERATOR, "refused: desk/journal/GRAVIT.md exists; it would steer every later desk turn. Remove it, then write again."],
      [OPERATOR, "the desk could not open a turn: EACCES"],
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

test("parseCommand reads the four commands, with or without the bot's name; anything else is text", () => {
  assert.deepEqual(parseCommand("/status"), { cmd: "status" });
  assert.deepEqual(parseCommand("/pause 2h"), { cmd: "pause", arg: "2h" });
  assert.deepEqual(parseCommand("/pause@gravit_desk_bot 2h"), { cmd: "pause", arg: "2h" });
  assert.deepEqual(parseCommand("  /pause  "), { cmd: "pause" });
  assert.deepEqual(parseCommand("/new"), { cmd: "new" });
  assert.deepEqual(parseCommand("/stop@gravit_desk_bot"), { cmd: "stop" });
  for (const other of ["/help", "/start", "/pause2h", "/statuses", "status", "hi /status", "/resume", "/Status"]) {
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
    r.api.push(text(3, "/pause@gravit_desk_bot 1h"));
    await polled(r, 4);
    assert.equal(r.api.texts()[2], "paused until 16:30 ET; a terminal resumes it: npm run desk -- resume", "a shorter pause stands aside: the reply names the pause in force");
    r.api.push(text(4, "/pause 1d"));
    await polled(r, 5);
    assert.equal(r.api.texts()[3], "paused until 2026-10-21 14:30 ET; a terminal resumes it: npm run desk -- resume", "an end on another New York date carries it");
    r.api.push(text(5, "/pause soon"));
    await polled(r, 6);
    assert.equal(r.api.texts()[4], "/pause takes Nm, Nh or Nd - 30m, 2h, 1d - or nothing; nothing was paused");
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

    r.api.push(text(9, "/stop"));
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
  await putFile(home, "outbox.json", JSON.stringify([
    { t: "2026-10-20T13:00:00.000Z", text: "first queued" },
    { t: "2026-10-20T13:01:00.000Z", text: "second queued" },
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

test("an update below the stored offset is passed over, even when the Bot API sends it again", async () => {
  const home = await freshHome("below");
  await putFile(home, "telegram.offset", "101\n");
  const api = new FakeBotApi();
  api.ignoreOffsetOnce = true;
  api.updates.push(text(100, "taken before the restart"), text(101, "new"));
  const r = await rig("below", { home, api });
  try {
    await polled(r, 2);
    assert.equal(api.polls()[0].offset, 101);
    assert.deepEqual(r.conversation.posts.map((p) => p.text), ["new"], "update 100 came back, and was passed over");
    assert.equal(await fileText(home, "telegram.offset"), "102\n");
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
    assert.deepEqual(await r.bridge.send("a".repeat(9_000), { replyTo: 5 }), { queued: true });
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
  const queuedAt = "2026-10-20T13:00:00.000Z";
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
  await putFile(home, "outbox.json", JSON.stringify([{ t: "2026-10-20T13:00:00.000Z", text: "bad" }, { t: "2026-10-20T13:01:00.000Z", text: "good" }]));
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
  const api = new FakeBotApi();
  api.poll = () => ({ status: 409, description: "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running" });
  const r = await rig("conflict", { api });
  try {
    const at = (s: number): string => new Date(NOW + s * 1_000).toISOString();
    await waitFor("the first conflict's wait", () => r.clock.has(30_000));
    assert.deepEqual(await records(r.home), [{ t: at(0), kind: "conflict" }]);
    assert.equal(r.bridge.status().conflictAt, at(0));
    r.clock.advance(29_999);
    await new Promise((done) => setTimeout(done, 20));
    assert.equal(r.api.polls().length, 1, "no poll inside the 30 s");
    for (const [n, s] of [[2, 30], [3, 60], [4, 90]] as const) {
      r.clock.advance(s === 30 ? 1 : 30_000);
      await waitFor(`conflict ${n}`, () => r.api.polls().length === n && r.clock.has(30_000));
      assert.equal(r.bridge.status().conflictAt, at(s), "the status names the last conflict");
    }
    assert.deepEqual(await records(r.home), [{ t: at(0), kind: "conflict" }, { t: at(60), kind: "conflict" }], "once a minute");
    assert.equal(r.lines.length, 2);
    assert.match(r.lines[0], /^gravit-face: telegram: another poller holds the bot's token \(HTTP 409/);
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
    r.api.poll = () => undefined;
    r.clock.advance(60_000);
    await polled(r, 6);
    r.api.send = () => "network";
    assert.deepEqual(await r.bridge.send(`a message that quotes ${TOKEN}`), { queued: true });
    r.api.send = () => undefined;
    r.api.push(text(1, "/status"), message(2, { from: { id: 99 }, chat: { id: 99, type: "private" }, text: "x" }));
    await polled(r, 7);

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
    for (const call of r.api.calls) {
      assert.equal(call.url, `${API}/bot${TOKEN}/${call.method}`);
      assert.equal(JSON.stringify(call.body).includes(TOKEN), false, "never in a request's body");
    }
  } finally {
    await r.bridge.dispose();
  }
});
