// face/tests/desk.test.ts
import test, { after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { lstat, lutimes, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileLock } from "@deepseek-ai/dsh-atomic-write";
import {
  ASLEEP_THRESHOLD_MS, ASLEEP_TICK_MS, LEDGER_ROTATE_BYTES, OFF_FILE, appendEvent, appendRecord, clearOff, deskDir, deskStatus, deskStatusLines, deskTime,
  installAsleepWatch, installDesk, lastDeskSession, parseDuration, readEvents, readOffState, registerDeskRoutes, runsOf, writeOff,
  type DeskEvent, type DeskStatus, type TurnUsage,
} from "../src/desk.ts";
import type { DeskConversationCtxLike } from "../src/desk-conversation.ts";
import type { AgentLike, SessionLike } from "../src/room.ts";
import type { EventLike } from "../src/room-rules.ts";
import { recorder } from "./route-recorder.ts";

/** Every harness home made with {@link home}, removed once the file's tests are done. */
const homes: string[] = [];
afterAll(() => Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));
/** A fresh harness home under the system's temp directory, removed after the file's tests. */
const home = async (): Promise<string> => {
  const made = await mkdtemp(join(tmpdir(), "face-desk-"));
  homes.push(made);
  return made;
};
const boot = (t: string, pid: number): DeskEvent => ({ t, kind: "boot", pid, version: "0.2.0-rc.2", deskEnabled: true });

test("appendEvent creates face/desk/events.jsonl mode 0600 and readEvents round-trips in order", async () => {
  const h = await home();
  await appendEvent(h, boot("2026-10-19T13:00:00.000Z", 11));
  await appendEvent(h, { t: "2026-10-19T13:05:00.000Z", kind: "asleep", from: "2026-10-19T13:02:00.000Z", to: "2026-10-19T13:05:00.000Z", gapMs: 180_000 });
  const file = join(deskDir(h), "events.jsonl");
  assert.equal(((await stat(file)).mode & 0o777), 0o600);
  const text = await readFile(file, "utf8");
  assert.equal(text.split("\n").filter(Boolean).length, 2, "one JSON line per event");
  const { events, skipped } = await readEvents(h);
  assert.equal(skipped, 0);
  assert.deepEqual(events.map((e) => e.kind), ["boot", "asleep"]);
});

test("readEvents: an absent ledger is empty; a bad line is skipped and counted", async () => {
  const h = await home();
  assert.deepEqual(await readEvents(h), { events: [], skipped: 0 });
  await appendEvent(h, boot("2026-10-19T13:00:00.000Z", 11));
  await writeFile(join(deskDir(h), "events.jsonl"), `{"t":"x","kind":"nope"}\nnot json\n`, { flag: "a" });
  const { events, skipped } = await readEvents(h);
  assert.equal(events.length, 1);
  assert.equal(skipped, 2);
});

test("appendEvent rotates a ledger over rotateBytes into a dated sibling", async () => {
  const h = await home();
  await appendEvent(h, boot("2026-10-19T13:00:00.000Z", 11), { rotateBytes: 10 });
  await appendEvent(h, boot("2026-10-19T14:00:00.000Z", 12), { rotateBytes: 10 });
  const { events } = await readEvents(h);
  assert.equal(events.length, 1, "the current file holds only the event written after the rotation");
  assert.equal((events[0] as { pid: number }).pid, 12);
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(deskDir(h));
  assert.ok(names.some((n) => /^events\.2026-10-19T14-00-00\.000Z\.jsonl$/.test(n)), names.join(","));
  assert.equal(LEDGER_ROTATE_BYTES, 50 * 1024 * 1024);
});

/* After a rotation the current file would hold no desk-session, and the next post would open a new desk conversation
 * (src/desk-session.ts `ensureDeskSession` reads the current file only): the new file opens with the last one. */
test("a rotation carries the ledger's last desk-session into the new file, as written, so the desk conversation is found again", async () => {
  const h = await home();
  const sessionA = { t: "2026-10-19T13:00:01.000Z", kind: "desk-session", sessionId: "session-a", reason: "created" } as const;
  const sessionB = { t: "2026-10-19T15:00:00.000Z", kind: "desk-session", sessionId: "session-b", reason: "new" } as const;
  const turn = { t: "2026-10-19T15:01:00.000Z", kind: "desk-turn", sessionId: "session-b", source: "telegram", turn: 1, outcome: "ended", wallMs: 900 } as const;
  for (const event of [boot("2026-10-19T13:00:00.000Z", 11), sessionA, sessionB, turn] as DeskEvent[]) await appendEvent(h, event);
  const before = await readFile(join(deskDir(h), "events.jsonl"), "utf8");
  const asleep: DeskEvent = { t: "2026-10-20T14:00:00.000Z", kind: "asleep", from: "2026-10-20T13:00:00.000Z", to: "2026-10-20T14:00:00.000Z", gapMs: 3_600_000 };
  await appendEvent(h, asleep, { rotateBytes: 10 });
  const { events, skipped } = await readEvents(h);
  assert.equal(skipped, 0);
  assert.deepEqual(events, [sessionB, asleep], "the new file opens with the last desk-session, then the event that rotated it");
  assert.equal(lastDeskSession(events), "session-b");
  assert.equal(readFileSync(join(deskDir(h), "events.jsonl"), "utf8").split("\n")[0], JSON.stringify(sessionB), "the line as it was written");
  const rotated = (await readdir(deskDir(h))).filter((name) => /^events\..+\.jsonl$/.test(name));
  assert.equal(rotated.length, 1);
  assert.equal(await readFile(join(deskDir(h), rotated[0]), "utf8"), before, "the rotated file keeps every line it had");
  /* A desk-session that rotates the file follows the one carried, and is the last. */
  const sessionC = { t: "2026-10-21T09:00:00.000Z", kind: "desk-session", sessionId: "session-c", reason: "new" } as const;
  await appendEvent(h, sessionC, { rotateBytes: 10 });
  assert.deepEqual((await readEvents(h)).events, [sessionB, sessionC]);
  assert.equal(lastDeskSession((await readEvents(h)).events), "session-c");
  /* A ledger with no desk-session carries nothing; and the carry is the ledger's: another JSONL rotates bare. */
  const bare = await home();
  await appendEvent(bare, boot("2026-10-19T13:00:00.000Z", 11));
  await appendEvent(bare, boot("2026-10-19T14:00:00.000Z", 12), { rotateBytes: 10 });
  assert.deepEqual((await readEvents(bare)).events.map((e) => e.kind), ["boot"]);
  await appendRecord(bare, "telegram.jsonl", { t: "2026-10-19T13:00:00.000Z", kind: "desk-session", sessionId: "session-x" });
  await appendRecord(bare, "telegram.jsonl", { t: "2026-10-19T14:00:00.000Z", kind: "sent" }, { rotateBytes: 10 });
  assert.deepEqual(readFileSync(join(deskDir(bare), "telegram.jsonl"), "utf8"), `${JSON.stringify({ t: "2026-10-19T14:00:00.000Z", kind: "sent" })}\n`);
});

test("an unwritable ledger logs and does not throw", async () => {
  const h = await home();
  await writeFile(join(h, "face"), "a file where the directory should be"); // mkdir face/desk fails
  const lines: string[] = [];
  await appendEvent(h, boot("2026-10-19T13:00:00.000Z", 11), { log: (l) => lines.push(l) });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^gravit-face: the desk ledger at .*events\.jsonl could not be written: /);
});

test("runsOf marks a boot with no shutdown before the next boot as lost", () => {
  const runs = runsOf([
    boot("2026-10-19T13:00:00.000Z", 11),
    { t: "2026-10-19T13:30:00.000Z", kind: "shutdown", pid: 11, code: 0 },
    boot("2026-10-19T14:00:00.000Z", 12),
    boot("2026-10-19T15:00:00.000Z", 13),
  ]);
  assert.deepEqual(runs, [
    { bootedAt: "2026-10-19T13:00:00.000Z", pid: 11, endedAt: "2026-10-19T13:30:00.000Z", code: 0, lost: false },
    { bootedAt: "2026-10-19T14:00:00.000Z", pid: 12, lost: true },
    { bootedAt: "2026-10-19T15:00:00.000Z", pid: 13, lost: false },
  ]);
});

/* The reader checks only `t` and `kind`, so a line written by hand can lack a field the face always
 * writes. A run takes `endedAt` and `code` only when its `shutdown` carries them: an `undefined` key
 * would fail dsh's lossless snapshot of `desk_state`'s value, and the route would drop it anyway. */
test("runsOf: a hand-written shutdown with no code ends its run without one - absent, never undefined", async () => {
  const h = await home();
  await mkdir(deskDir(h), { recursive: true });
  await writeFile(join(deskDir(h), "events.jsonl"),
    '{"t":"2026-10-20T13:00:00.000Z","kind":"boot","pid":11,"version":"v","deskEnabled":true}\n' +
    '{"t":"2026-10-20T14:00:00.000Z","kind":"shutdown","pid":11}\n');
  const runs = runsOf((await readEvents(h)).events);
  assert.deepEqual(runs, [{ bootedAt: "2026-10-20T13:00:00.000Z", pid: 11, endedAt: "2026-10-20T14:00:00.000Z", lost: false }]);
  assert.equal(Object.hasOwn(runs[0], "code"), false);
});

test("a torn last line stays one skipped line: the next boot is kept and the cut-off run reads as lost", async () => {
  const h = await home();
  await appendEvent(h, boot("2026-10-19T13:00:00.000Z", 11));
  // a write that a crash or a full disk cut short: no closing newline
  await writeFile(join(deskDir(h), "events.jsonl"), `{"t":"2026-10-19T13:30:00.000Z","kind":"asl`, { flag: "a" });
  await appendEvent(h, boot("2026-10-19T14:00:00.000Z", 12));
  const { events, skipped } = await readEvents(h);
  assert.deepEqual(events.map((e) => e.kind), ["boot", "boot"], "both boots kept");
  assert.equal(skipped, 1, "the fragment is one skipped line of its own");
  assert.deepEqual(runsOf(events), [
    { bootedAt: "2026-10-19T13:00:00.000Z", pid: 11, lost: true },
    { bootedAt: "2026-10-19T14:00:00.000Z", pid: 12, lost: false },
  ]);
});

function fakeTimer() {
  let tick: (() => void) | undefined; let cleared = false; let every: number | undefined;
  return {
    setInterval: (fn: () => void, ms: number) => { tick = fn; every = ms; return 1; },
    clearInterval: () => { cleared = true; },
    fire: () => tick?.(),
    get cleared() { return cleared; },
    /** The interval the watch asked for. */
    get ms() { return every; },
  };
}

test("the watch writes one asleep event for a gap over two minutes and nothing for a normal tick", () => {
  const timer = fakeTimer(); let t = 1_700_000_000_000; const got: DeskEvent[] = [];
  const dispose = installAsleepWatch({ now: () => t, setInterval: timer.setInterval, clearInterval: timer.clearInterval, append: (e) => { got.push(e); } });
  t += ASLEEP_TICK_MS; timer.fire();
  assert.equal(got.length, 0);
  t += 5 * 60_000; timer.fire();
  assert.equal(got.length, 1);
  assert.deepEqual(got[0], { t: new Date(t).toISOString(), kind: "asleep", from: new Date(t - 5 * 60_000).toISOString(), to: new Date(t).toISOString(), gapMs: 5 * 60_000 });
  t += ASLEEP_TICK_MS; timer.fire();
  assert.equal(got.length, 1, "the gap is counted once");
  dispose();
  assert.ok(timer.cleared);
  assert.equal(ASLEEP_THRESHOLD_MS, 120_000);
});

test("a backwards clock is no gap", () => {
  const timer = fakeTimer(); let t = 1_700_000_000_000; const got: DeskEvent[] = [];
  installAsleepWatch({ now: () => t, setInterval: timer.setInterval, clearInterval: timer.clearInterval, append: (e) => { got.push(e); } });
  t -= 10 * 60_000; timer.fire();
  const landed = t;
  t += ASLEEP_TICK_MS; timer.fire();
  assert.equal(got.length, 0);
  t += 5 * 60_000; timer.fire();
  assert.deepEqual(got, [{ t: new Date(t).toISOString(), kind: "asleep", from: new Date(landed + ASLEEP_TICK_MS).toISOString(), to: new Date(t).toISOString(), gapMs: 5 * 60_000 }],
    "the watch keeps running, and measures on the clock where it landed");
  assert.equal(timer.cleared, false);
});

test("a gap of exactly the threshold is no sleep and one millisecond more is; the tick defaults to ASLEEP_TICK_MS", () => {
  const timer = fakeTimer(); let t = 1_700_000_000_000; const got: DeskEvent[] = [];
  installAsleepWatch({ now: () => t, setInterval: timer.setInterval, clearInterval: timer.clearInterval, append: (e) => { got.push(e); } });
  assert.equal(timer.ms, ASLEEP_TICK_MS); assert.equal(ASLEEP_TICK_MS, 30_000);
  t += ASLEEP_THRESHOLD_MS; timer.fire();
  assert.equal(got.length, 0, "strictly greater: a gap of exactly the threshold writes nothing");
  t += ASLEEP_THRESHOLD_MS + 1; timer.fire();
  assert.equal(got.length, 1);
  assert.equal((got[0] as { gapMs: number }).gapMs, ASLEEP_THRESHOLD_MS + 1);
});

test("deskStatus: pid, version, uptime, the gaps since boot and the runs", async () => {
  const h = await home();
  const bootedAt = Date.parse("2026-10-19T13:00:00.000Z");
  await appendEvent(h, { t: "2026-10-19T12:00:00.000Z", kind: "asleep", from: "2026-10-19T11:50:00.000Z", to: "2026-10-19T12:00:00.000Z", gapMs: 600_000 });
  await appendEvent(h, boot("2026-10-19T13:00:00.000Z", 11));
  await appendEvent(h, { t: "2026-10-19T13:10:00.000Z", kind: "asleep", from: "2026-10-19T13:05:00.000Z", to: "2026-10-19T13:10:00.000Z", gapMs: 300_000 });
  const s = await deskStatus({ home: h, bootedAt, enabled: true, now: () => bootedAt + 3_600_000, pid: 11, version: "v" });
  assert.equal(s.ok, true); assert.equal(s.pid, 11); assert.equal(s.version, "v");
  assert.equal(s.bootedAt, "2026-10-19T13:00:00.000Z"); assert.equal(s.uptimeMs, 3_600_000);
  assert.deepEqual(s.desk, { enabled: true, dir: deskDir(h) });
  assert.deepEqual(s.asleep.map((g) => g.gapMs), [300_000], "the gap before this boot is not this run's");
  assert.equal(s.runs.length, 1);
});

test("GET /data/desk/status is fenced and reports desk.enabled", async () => {
  const h = await home(); const rec = recorder();
  registerDeskRoutes(rec, { home: h, bootedAt: Date.now(), enabled: false });
  assert.deepEqual(rec.paths(), ["/data/desk/status", "/data/desk/pause"]);
  const ok = JSON.parse(await rec.call("/data/desk/status")) as { status: number; body: { ok: boolean; desk: { enabled: boolean } } };
  assert.equal(ok.status, 200); assert.equal(ok.body.ok, true); assert.equal(ok.body.desk.enabled, false);
  const forged = JSON.parse(await rec.call("/data/desk/status", { host: "evil.example.com" })) as { status: number; body: { ok: boolean; error: string } };
  assert.equal(forged.status, 403); assert.deepEqual(forged.body, { ok: false, error: "forbidden" });
});

test("installDesk: enabled writes boot and shutdown; disabled writes nothing and still answers", async () => {
  const on = await home(); const timer = fakeTimer();
  const desk = installDesk(recorder(), { home: on, enabled: true, watch: { setInterval: timer.setInterval, clearInterval: timer.clearInterval } });
  await desk.ready;
  await desk.dispose(0);
  await desk.dispose(0);
  const { events } = await readEvents(on);
  assert.deepEqual(events.map((e) => e.kind), ["boot", "shutdown"], "dispose is idempotent");
  assert.equal((events[1] as { code: number }).code, 0); assert.ok(timer.cleared);
  const off = await home(); const rec = recorder();
  const quiet = installDesk(rec, { home: off, enabled: false });
  await quiet.ready; await quiet.dispose(0);
  assert.deepEqual(await readEvents(off), { events: [], skipped: 0 });
  assert.deepEqual(rec.paths(), ["/data/desk/status", "/data/desk/pause"], "both routes whatever enabled says: the switch is the home's, not this face's");
});

test("an unreadable ledger still answers 200: no gaps, no runs, and ledgerError names the code", async () => {
  const h = await home(); const rec = recorder();
  await mkdir(join(deskDir(h), "events.jsonl"), { recursive: true }); // a directory where the ledger should be: EISDIR
  registerDeskRoutes(rec, { home: h, bootedAt: Date.now(), enabled: true });
  const got = JSON.parse(await rec.call("/data/desk/status")) as { status: number; body: { ok: boolean; asleep: unknown[]; runs: unknown[]; ledgerError?: string } };
  assert.equal(got.status, 200); assert.equal(got.body.ok, true);
  assert.deepEqual(got.body.asleep, []); assert.deepEqual(got.body.runs, []);
  assert.equal(got.body.ledgerError, "EISDIR");
  const fine = await deskStatus({ home: await home(), bootedAt: Date.now(), enabled: true });
  assert.equal(Object.hasOwn(fine, "ledgerError"), false, "absent when the ledger reads");
});

/* P1: the desk's other files, the OFF switch, the desk's records and what the status makes of them. */

test("appendRecord writes any file under the desk's directory as the ledger is written: 0600, a torn line kept to itself, rotated under its record's t", async () => {
  const h = await home();
  const file = join(deskDir(h), "telegram.jsonl");
  await appendRecord(h, "telegram.jsonl", { t: "2026-10-20T13:00:00.000Z", kind: "sent", parts: 1, chars: 5 });
  assert.equal(((await stat(file)).mode & 0o777), 0o600);
  await writeFile(file, `{"t":"2026-10-20T13:01:00.000Z","kind":"se`, { flag: "a" }); // a write cut short
  await appendRecord(h, "telegram.jsonl", { t: "2026-10-20T13:02:00.000Z", kind: "queued", chars: 9 });
  assert.equal(await readFile(file, "utf8"), `{"t":"2026-10-20T13:00:00.000Z","kind":"sent","parts":1,"chars":5}\n`
    + `{"t":"2026-10-20T13:01:00.000Z","kind":"se\n{"t":"2026-10-20T13:02:00.000Z","kind":"queued","chars":9}\n`);
  await appendRecord(h, "telegram.jsonl", { t: "2026-10-20T14:00:00.000Z", kind: "conflict" }, { rotateBytes: 10 });
  assert.equal(await readFile(file, "utf8"), `{"t":"2026-10-20T14:00:00.000Z","kind":"conflict"}\n`);
  assert.deepEqual((await readdir(deskDir(h))).sort(), ["telegram.2026-10-20T14-00-00.000Z.jsonl", "telegram.jsonl"]);
  assert.deepEqual(await readEvents(h), { events: [], skipped: 0 }, "the events ledger is another file");
});

test("appendRecord rotates a record with no t under the time of the append, and logs a failure naming its file", async () => {
  const h = await home();
  await appendRecord(h, "notes.jsonl", { text: "a" });
  await appendRecord(h, "notes.jsonl", { text: "b" }, { rotateBytes: 1 });
  const names = await readdir(deskDir(h));
  assert.equal(names.length, 2, names.join(","));
  assert.ok(names.some((n) => /^notes\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.jsonl$/.test(n)), names.join(","));
  const blocked = await home();
  await writeFile(join(blocked, "face"), "a file where the directory should be");
  const lines: string[] = [];
  await appendRecord(blocked, "telegram.jsonl", { t: "2026-10-20T13:00:00.000Z", kind: "sent" }, { log: (l) => lines.push(l) });
  assert.deepEqual(lines, [`gravit-face: the desk ledger at ${join(deskDir(blocked), "telegram.jsonl")} could not be written: ENOTDIR`]);
});

test("appendRecord refuses a path for a file name with a TypeError, before anything is touched", async () => {
  const h = await home();
  for (const file of ["../escape.jsonl", "sub/notes.jsonl", join(h, "abs.jsonl"), "..", ".", ""]) {
    const lines: string[] = [];
    await assert.rejects(appendRecord(h, file, { t: "2026-10-20T13:00:00.000Z" }, { log: (l) => lines.push(l) }), TypeError, JSON.stringify(file));
    assert.deepEqual(lines, [], "a caller's mistake, not a ledger failure");
  }
  assert.deepEqual(await readdir(h), [], "not even the desk's directory was made");
});

test("the ledger reads back P1's kinds in order, and runsOf passes over them", async () => {
  const h = await home();
  const usage: TurnUsage = { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, routes: ["deepseek-official/deepseek-flash"] };
  const events: DeskEvent[] = [
    boot("2026-10-20T13:00:00.000Z", 11),
    { t: "2026-10-20T13:01:00.000Z", kind: "off-set", by: "telegram", until: "2026-10-20T15:01:00.000Z" },
    { t: "2026-10-20T13:02:00.000Z", kind: "off-cleared", by: "expiry" },
    { t: "2026-10-20T13:03:00.000Z", kind: "desk-session", sessionId: "session-a", reason: "created" },
    { t: "2026-10-20T13:04:00.000Z", kind: "desk-turn", sessionId: "session-a", source: "telegram", turn: 1, outcome: "ended", wallMs: 4_200, usage },
    { t: "2026-10-20T13:05:00.000Z", kind: "desk-refused", reason: "instruction chain", path: "GRAVIT.md" },
  ];
  for (const event of events) await appendEvent(h, event);
  assert.deepEqual(await readEvents(h), { events, skipped: 0 });
  assert.deepEqual(runsOf(events), [{ bootedAt: "2026-10-20T13:00:00.000Z", pid: 11, lost: false }]);
});

test("lastDeskSession is the sessionId of the last desk-session event", () => {
  assert.equal(lastDeskSession([]), undefined);
  assert.equal(lastDeskSession([boot("2026-10-20T13:00:00.000Z", 11)]), undefined);
  assert.equal(lastDeskSession([
    { t: "2026-10-20T13:00:00.000Z", kind: "desk-session", sessionId: "session-a", reason: "created" },
    { t: "2026-10-20T14:00:00.000Z", kind: "desk-session", sessionId: "session-b", reason: "new" },
    { t: "2026-10-20T14:05:00.000Z", kind: "desk-turn", sessionId: "session-b", source: "telegram", turn: 1, outcome: "ended", wallMs: 1 },
  ]), "session-b");
});

test("writeOff, readOffState and clearOff round-trip with ledger events", async () => {
  const h = await home(); const now = () => Date.parse("2026-10-20T18:00:00Z");
  const s = await writeOff(h, { by: "telegram", until: now() + 7_200_000 }, now);
  assert.deepEqual(s, { setAt: "2026-10-20T18:00:00.000Z", by: "telegram", until: "2026-10-20T20:00:00.000Z" });
  assert.equal(((await stat(join(deskDir(h), "OFF"))).mode & 0o777), 0o600);
  assert.deepEqual(await readOffState(h, now), { state: s, expired: false });
  assert.equal((await readOffState(h, () => now() + 7_200_001)).expired, true);
  assert.equal(await clearOff(h, "terminal"), true);
  assert.equal(await clearOff(h, "terminal"), false, "no file, no second event");
  assert.deepEqual((await readEvents(h)).events.map((e) => e.kind), ["off-set", "off-cleared"]);
});

test("OFF holds the state as JSON and the events carry it; a pause without until never expires; at until it has", async () => {
  const h = await home(); const now = () => Date.parse("2026-10-20T18:00:00Z");
  assert.deepEqual(await readOffState(h, now), { expired: false }, "no switch: not paused");
  const timed = await writeOff(h, { by: "page", until: now() + 60_000 }, now);
  assert.deepEqual(JSON.parse(await readFile(join(deskDir(h), OFF_FILE), "utf8")), timed);
  assert.equal((await readOffState(h, () => now() + 59_999)).expired, false);
  assert.equal((await readOffState(h, () => now() + 60_000)).expired, true, "at until the pause is over");
  const open = await writeOff(h, { by: "terminal" }, () => now() + 1_000);
  assert.deepEqual(open, { setAt: "2026-10-20T18:00:01.000Z", by: "terminal" }, "no until key at all");
  assert.deepEqual(await readOffState(h, () => now() + 365 * 86_400_000), { state: open, expired: false }, "the second write replaced the first");
  assert.equal(await clearOff(h, "terminal", () => now() + 2_000), true);
  assert.deepEqual(await readOffState(h, now), { expired: false });
  assert.deepEqual((await readEvents(h)).events, [
    { t: "2026-10-20T18:00:00.000Z", kind: "off-set", by: "page", until: "2026-10-20T18:01:00.000Z" },
    { t: "2026-10-20T18:00:01.000Z", kind: "off-set", by: "terminal" },
    { t: "2026-10-20T18:00:02.000Z", kind: "off-cleared", by: "terminal" },
  ]);
});

/** 14:00 ET on 2026-10-20, and the clock `ms` after it. */
const AT = Date.parse("2026-10-20T18:00:00Z");
const after = (ms: number) => (): number => AT + ms;

/** The OFF file's text under the home `h`. */
const offText = (h: string): Promise<string> => readFile(join(deskDir(h), OFF_FILE), "utf8");

test("a phone or page pause never shortens one in force: nothing is written or recorded, and the pause that stands is returned", async () => {
  const open = await home();
  const terminal = await writeOff(open, { by: "terminal" }, after(0));
  const before = await offText(open);
  assert.deepEqual(await writeOff(open, { by: "telegram", until: AT + 1_000 + 60_000 }, after(1_000)), terminal, "an open-ended pause survives a phone /pause 1m");
  assert.equal(await offText(open), before, "the file is as it was");
  assert.deepEqual(await readOffState(open, after(3_600_000)), { state: terminal, expired: false }, "and the minute passing lifts nothing");
  assert.deepEqual((await readEvents(open)).events.map((e) => e.kind), ["off-set"], "no event for a file left alone");

  const twoHours = await home();
  const held = await writeOff(twoHours, { by: "terminal", until: AT + 7_200_000 }, after(0));
  assert.deepEqual(await writeOff(twoHours, { by: "page", until: AT + 60_000 }, after(0)), held, "a 2 h pause survives a page 1 m pause");
  assert.deepEqual(await writeOff(twoHours, { by: "telegram", until: AT + 7_200_000 }, after(0)), held, "and an equal one changes nothing");
  assert.deepEqual((await readOffState(twoHours, after(0))).state, held);
  assert.equal((await readEvents(twoHours)).events.length, 1);

  const touched = await home();
  await mkdir(deskDir(touched), { recursive: true });
  await writeFile(join(deskDir(touched), OFF_FILE), "");
  const asRead = (await readOffState(touched)).state;
  assert.deepEqual(await writeOff(touched, { by: "telegram", until: AT + 60_000 }, after(0)), asRead, "a touched OFF is an open-ended pause");
  assert.equal(await offText(touched), "");
});

test("a phone or page pause that outlasts the one in force replaces it: a later until, or no end at all", async () => {
  const h = await home();
  await writeOff(h, { by: "page", until: AT + 3_600_000 }, after(0));
  const longer = await writeOff(h, { by: "telegram", until: AT + 1_000 + 10_800_000 }, after(1_000));
  assert.deepEqual(longer, { setAt: "2026-10-20T18:00:01.000Z", by: "telegram", until: "2026-10-20T21:00:01.000Z" }, "a 1 h pause extended by a phone 3 h pause");
  assert.deepEqual((await readOffState(h, after(7_200_000))).state, longer, "still in force when the hour has gone");
  const open = await writeOff(h, { by: "page" }, after(2_000));
  assert.deepEqual(open, { setAt: "2026-10-20T18:00:02.000Z", by: "page" }, "an open-ended pause outlasts any timed one");
  assert.deepEqual((await readEvents(h)).events.map((e) => [e.kind, (e as { by?: string }).by]), [["off-set", "page"], ["off-set", "telegram"], ["off-set", "page"]]);
});

test("the terminal's pause replaces any pause, and an expired one is replaced from anywhere as though there were none", async () => {
  const h = await home();
  await writeOff(h, { by: "telegram" }, after(0));
  const short = await writeOff(h, { by: "terminal", until: AT + 60_000 }, after(0));
  assert.deepEqual(short, { setAt: "2026-10-20T18:00:00.000Z", by: "terminal", until: "2026-10-20T18:01:00.000Z" }, "the terminal replaces an open-ended pause with a 1 m one");
  assert.equal((await readOffState(h, after(60_000))).expired, true, "which then ends on time");
  const fresh = await writeOff(h, { by: "page", until: AT + 120_000 + 60_000 }, after(120_000));
  assert.deepEqual(fresh, { setAt: "2026-10-20T18:02:00.000Z", by: "page", until: "2026-10-20T18:03:00.000Z" }, "an expired pause is replaced as if absent");
  assert.deepEqual((await readOffState(h, after(120_000))).state, fresh);
  assert.equal((await readEvents(h)).events.length, 3);
});

test("clearOff by expiry reads OFF again under the lock: a fresh or open-ended pause stays, an expired one goes", async () => {
  const h = await home();
  const fresh = await writeOff(h, { by: "telegram", until: AT + 60_000 }, after(0));
  assert.equal(await clearOff(h, "expiry", after(0)), false, "a pause written since the caller found one expired");
  assert.deepEqual(await readOffState(h, after(0)), { state: fresh, expired: false }, "is left as it is");
  assert.equal(await clearOff(h, "expiry", after(60_000)), true);
  assert.deepEqual(await readOffState(h), { expired: false });
  await writeOff(h, { by: "terminal" }, after(0));
  assert.equal(await clearOff(h, "expiry", after(365 * 86_400_000)), false, "an open-ended pause never expires");
  assert.deepEqual((await readEvents(h)).events.map((e) => [e.kind, (e as { by?: string }).by]),
    [["off-set", "telegram"], ["off-cleared", "expiry"], ["off-set", "terminal"]]);
});

test("writeOff and clearOff wait for the switch's lock", async () => {
  const h = await home();
  await mkdir(deskDir(h), { recursive: true });
  const lock = join(deskDir(h), OFF_FILE);
  let writing: Promise<unknown> = Promise.resolve();
  await withFileLock(lock, async () => {
    writing = writeOff(h, { by: "terminal" });
    await new Promise((done) => setTimeout(done, 100));
    assert.deepEqual(await readOffState(h), { expired: false }, "nothing written while another holds the lock");
  });
  await writing;
  assert.equal((await readOffState(h)).state?.by, "terminal", "written once it was let go");
  let clearing: Promise<boolean> = Promise.resolve(false);
  await withFileLock(lock, async () => {
    clearing = clearOff(h, "terminal");
    await new Promise((done) => setTimeout(done, 100));
    assert.equal((await readOffState(h)).state?.by, "terminal", "nothing removed while another holds the lock");
  });
  assert.equal(await clearing, true);
  assert.deepEqual(await readOffState(h), { expired: false });
});

test("an unparseable OFF file still reads as paused", async () => {
  const h = await home();
  await mkdir(deskDir(h), { recursive: true });
  const file = join(deskDir(h), OFF_FILE);
  const mtime = new Date("2026-10-20T12:34:56.000Z");
  const later = () => Date.parse("2027-01-01T00:00:00Z");
  // "" is what `touch` leaves; the rest are not { setAt, by, until? }
  for (const text of ["junk", "", "null", "[]", "{}", `{"setAt":"2026-10-20T18:00:00.000Z","by":"phone"}`, `{"setAt":"later","by":"page"}`,
    `{"setAt":"2026-10-20T18:00:00.000Z","by":"page","until":"soon"}`, `{"setAt":"2026-10-20T18:00:00.000Z","by":"page","until":1}`]) {
    await writeFile(file, text);
    await utimes(file, mtime, mtime);
    assert.deepEqual(await readOffState(h, later), { state: { setAt: "2026-10-20T12:34:56.000Z", by: "terminal" }, expired: false }, JSON.stringify(text));
  }
  assert.equal(await clearOff(h, "terminal"), true, "resume clears it like any other");
  assert.deepEqual(await readOffState(h, later), { expired: false });
});

test("an OFF that is not a file still reads as paused and clearOff will not remove it; no desk directory is no switch", async () => {
  const h = await home();
  const dir = join(deskDir(h), OFF_FILE);
  await mkdir(dir, { recursive: true }); // the read fails with EISDIR
  const mtime = new Date("2026-10-20T12:34:56.000Z");
  await utimes(dir, mtime, mtime);
  assert.deepEqual(await readOffState(h), { state: { setAt: "2026-10-20T12:34:56.000Z", by: "terminal" }, expired: false });
  await assert.rejects(clearOff(h, "terminal"));
  assert.deepEqual(await readEvents(h), { events: [], skipped: 0 }, "no off-cleared for a switch still there");
  const blocked = await home();
  await writeFile(join(blocked, "face"), "a file where the directory should be"); // ENOTDIR: no switch can be there
  assert.deepEqual(await readOffState(blocked), { expired: false });
  assert.equal(await clearOff(blocked, "terminal"), false);
});

test("a link to nothing at OFF still reads as paused, at the link's own time, and resume removes the link", async () => {
  const h = await home();
  await mkdir(deskDir(h), { recursive: true });
  const link = join(deskDir(h), OFF_FILE);
  await symlink(join(h, "nowhere"), link);
  const mtime = new Date("2026-10-20T12:34:56.000Z");
  await lutimes(link, mtime, mtime);
  assert.deepEqual(await readOffState(h), { state: { setAt: "2026-10-20T12:34:56.000Z", by: "terminal" }, expired: false });
  assert.equal(await clearOff(h, "expiry"), false, "it never expires");
  assert.equal(await clearOff(h, "terminal"), true);
  await assert.rejects(lstat(link), { code: "ENOENT" });
  await assert.rejects(stat(join(h, "nowhere")), { code: "ENOENT" }, "nothing was made where it pointed");
});

/* The Desk panel's Pause: `POST /data/desk/pause`, which pauses from the page and never resumes. */

/** Play one request at `path` and hand back `{ status, body }`. */
const play = async (rec: ReturnType<typeof recorder>, path: string, options: Parameters<ReturnType<typeof recorder>["call"]>[1] = {}) =>
  JSON.parse(await rec.call(path, options)) as { status: number; body: Record<string, any> };

test("POST /data/desk/pause writes OFF by page, for a duration or until a resume, and answers the pause in force", async () => {
  const h = await home(); const rec = recorder();
  let clock = AT;
  registerDeskRoutes(rec, { home: h, bootedAt: AT, enabled: true, now: () => clock });
  const timed = await play(rec, "/data/desk/pause", { method: "POST", json: { until: "2h" } });
  assert.deepEqual(timed, { status: 200, body: { ok: true, off: { setAt: "2026-10-20T18:00:00.000Z", by: "page", until: "2026-10-20T20:00:00.000Z" } } });
  assert.deepEqual(JSON.parse(await offText(h)), timed.body.off, "OFF holds what the route answered");
  assert.deepEqual((await readEvents(h)).events, [{ t: "2026-10-20T18:00:00.000Z", kind: "off-set", by: "page", until: "2026-10-20T20:00:00.000Z" }]);

  clock = AT + 60_000;
  const shorter = await play(rec, "/data/desk/pause", { method: "POST", json: { until: "30m" } });
  assert.deepEqual(shorter, { status: 200, body: { ok: true, off: timed.body.off } }, "a shorter page pause stands down: the answer is the pause that stands");
  assert.equal((await readEvents(h)).events.length, 1, "and nothing is recorded for it");

  const open = await play(rec, "/data/desk/pause", { method: "POST", json: {} });
  assert.deepEqual(open, { status: 200, body: { ok: true, off: { setAt: "2026-10-20T18:01:00.000Z", by: "page" } } }, "no until is a pause until a resume, which outlasts any timed one");
  const status = await play(rec, "/data/desk/status");
  assert.deepEqual(status.body.off, open.body.off, "the status route reads the same switch");
});

test("POST /data/desk/pause is fenced, POST-only and JSON-only, refuses an until that is no duration, and has no resume beside it", async () => {
  const h = await home(); const rec = recorder();
  registerDeskRoutes(rec, { home: h, bootedAt: AT, enabled: true, now: after(0) });
  assert.deepEqual(rec.paths(), ["/data/desk/status", "/data/desk/pause"], "a pause route and no resume route: only a terminal resumes");
  assert.deepEqual(await play(rec, "/data/desk/pause", { method: "POST", json: { until: "2h" }, host: "evil.example.com" }), { status: 403, body: { ok: false, error: "forbidden" } });
  assert.deepEqual(await play(rec, "/data/desk/pause", { method: "POST", json: {}, headers: { origin: "http://evil.example.com" } }), { status: 403, body: { ok: false, error: "forbidden" } }, "a cross-site page posting to loopback");
  assert.equal((await play(rec, "/data/desk/pause", { method: "GET" })).status, 405);
  assert.equal((await play(rec, "/data/desk/pause", { method: "POST", body: '{"until":"2h"}', headers: { "content-type": "text/plain" } })).status, 415);
  for (const until of ["soon", "", "0m", "2 h", "1.5h", "2H", 30, null, false, ["2h"], { h: 2 }]) {
    assert.deepEqual(await play(rec, "/data/desk/pause", { method: "POST", json: { until } }),
      { status: 400, body: { ok: false, error: "until must look like 30m, 2h or 1d" } }, JSON.stringify(until));
  }
  assert.deepEqual(await readOffState(h), { expired: false }, "nothing refused wrote OFF");
  assert.deepEqual(await readEvents(h), { events: [], skipped: 0 }, "nor recorded a pause");
});

test("a pause the face cannot write is a 500 with a fixed message - never a pause reported", async () => {
  const h = await home(); const rec = recorder();
  await writeFile(join(h, "face"), "a file where the desk's directory should be");
  registerDeskRoutes(rec, { home: h, bootedAt: AT, enabled: true, now: after(0) });
  assert.deepEqual(await play(rec, "/data/desk/pause", { method: "POST", json: { until: "30m" } }), { status: 500, body: { ok: false, error: "request failed" } });
});

test("parseDuration", () => {
  assert.equal(parseDuration("30m"), 1_800_000); assert.equal(parseDuration("2h"), 7_200_000); assert.equal(parseDuration("1d"), 86_400_000);
  for (const bad of ["", "2", "2x", "-1h", "1.5h", " 2h", "0m"]) assert.equal(parseDuration(bad), undefined, bad);
});

test("parseDuration refuses every zero, every other spelling and anything past 36,500 days", () => {
  for (const bad of ["0h", "0d", "00m", "2h ", "2H", "+2h", "2hm", "h", "1e3m", "2 h", "36501d", "876001h", "99999999d", "99999999999999999999d"]) {
    assert.equal(parseDuration(bad), undefined, bad);
  }
  assert.equal(parseDuration("90m"), 5_400_000);
  assert.equal(parseDuration("010m"), 600_000, "a leading zero is still a digit");
  assert.equal(parseDuration("36500d"), 36_500 * 86_400_000, "a hundred years is the longest");
  assert.ok(new Date(Date.now() + (parseDuration("36500d") ?? 0)).getTime() > 0, "and its end is a time");
});

test("deskTime dates a time on another New York date than now's, and only then", () => {
  const now = new Date("2026-10-21T03:30:00Z"); // 23:30 ET on the 20th
  assert.equal(deskTime(new Date("2026-10-20T04:00:00Z"), now), "00:00 ET", "the 20th's first minute");
  assert.equal(deskTime(new Date("2026-10-21T03:59:00Z"), now), "23:59 ET", "its last, though UTC says the 21st");
  assert.equal(deskTime(new Date("2026-10-21T04:00:00Z"), now), "2026-10-21 00:00 ET", "the 21st");
  assert.equal(deskTime(new Date("2026-10-20T03:59:00Z"), now), "2026-10-19 23:59 ET", "the 19th");
});

test("deskStatus reports off, the desk session and today's desk turns", async () => {
  const h = await home();
  const now = () => Date.parse("2026-10-20T18:00:00Z"); // 14:00 ET: the ET day began at 04:00 UTC
  const usage = (uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number): TurnUsage =>
    ({ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, routes: ["deepseek-official/deepseek-flash"] });
  const turn = (t: string, sessionId: string, n: number, u?: TurnUsage): DeskEvent =>
    ({ t, kind: "desk-turn", sessionId, source: "telegram", turn: n, outcome: "ended", wallMs: 1_000, ...(u === undefined ? {} : { usage: u }) });
  await appendEvent(h, { t: "2026-10-19T20:00:00.000Z", kind: "desk-session", sessionId: "session-a", reason: "created" });
  await appendEvent(h, turn("2026-10-20T03:59:59.999Z", "session-a", 1, usage(7, 7, 7, 7))); // 23:59 ET on the 19th: yesterday
  await appendEvent(h, turn("2026-10-20T04:00:00.000Z", "session-a", 2, usage(100, 10, 1000, 0)));
  await appendEvent(h, { t: "2026-10-20T17:00:00.000Z", kind: "desk-session", sessionId: "session-b", reason: "new" });
  await appendEvent(h, turn("2026-10-20T17:30:00.000Z", "session-b", 1, usage(50, 5, 0, 0)));
  const off = await writeOff(h, { by: "page", until: now() + 3_600_000 }, now);
  const s = await deskStatus({ home: h, bootedAt: now() - 60_000, enabled: true, now, telegram: () => ({ configured: true, polling: true, dropped: 2, queued: 1 }) });
  assert.equal(s.deskSession, "session-b");
  assert.deepEqual(s.turnsToday, { count: 2, usage: { uncachedInputTokens: 150, outputTokens: 15, cacheReadTokens: 1000, cacheWriteTokens: 0 } });
  assert.deepEqual(s.off, off);
  assert.deepEqual(s.telegram, { configured: true, polling: true, dropped: 2, queued: 1 });

  await appendEvent(h, turn("2026-10-20T18:30:00.000Z", "session-b", 2)); // a turn may end with no usage
  const later = await deskStatus({ home: h, bootedAt: now() - 60_000, enabled: true, now: () => now() + 3_600_000 });
  assert.deepEqual(later.turnsToday, { count: 3, usage: { uncachedInputTokens: 150, outputTokens: 15, cacheReadTokens: 1000, cacheWriteTokens: 0 } },
    "it counts and adds nothing");
  assert.equal(Object.hasOwn(later, "off"), false, "a pause past its until is not in force");
  assert.equal(Object.hasOwn(later, "telegram"), false, "no provider, no field");

  const empty = await deskStatus({ home: await home(), bootedAt: now(), enabled: true, now });
  assert.deepEqual(empty.turnsToday, { count: 0, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  for (const key of ["off", "deskSession", "telegram", "ledgerError"]) assert.equal(Object.hasOwn(empty, key), false, key);
});

test("deskStatus still answers when the desk's directory cannot be read: ledgerError names it, and there is no off", async () => {
  const h = join(await home(), "x".repeat(300)); // a name past NAME_MAX: every read under it fails ENAMETOOLONG
  const s = await deskStatus({ home: h, bootedAt: Date.now(), enabled: true });
  assert.equal(s.ok, true);
  assert.equal(s.ledgerError, "ENAMETOOLONG");
  assert.equal(Object.hasOwn(s, "off"), false);
  await assert.rejects(readOffState(h), { code: "ENAMETOOLONG" }, "readOffState itself says it cannot tell");
});

/* P1: the desk conversation installDesk creates (src/desk-conversation.ts). Its repository root - the desk
 * session runs in <root>/desk/journal - sits under tests/tmp/, inside the repository, as the fence's fixtures do. */

const TMP = join(dirname(fileURLToPath(import.meta.url)), "tmp", `desk-${process.pid}`);
afterAll(() => rm(TMP, { recursive: true, force: true }));

/** A desk agent whose status the test sets, recording its cancels. */
class FakeAgent implements AgentLike {
  status: "idle" | "running" = "idle";
  readonly cancels: unknown[][] = [];
  readonly session: SessionLike;
  constructor(readonly id: string) {
    this.session = { id, header: {}, seq: 0, snapshotEvents: () => [], append: () => undefined };
  }
  followup(): void {}
  cancel(...args: unknown[]): void { this.cancels.push(args); }
}

/** A booted root as the desk conversation reads it. Its bus's disposer notes what the ledger held when the
 * conversation let go of it; `gate`, when set, holds every create until it opens. */
function conversationRoot(ledger: () => string) {
  const agents: FakeAgent[] = [];
  const stored = new Map<string, string>();
  const listeners = new Set<unknown>();
  const letGo: string[] = [];
  const state: { gate?: Promise<void>; creates: number } = { creates: 0 };
  const ctx: DeskConversationCtxLike = {
    agents: {
      get: (id) => agents.find((agent) => agent.id === id),
      create: async (options) => {
        state.creates += 1;
        await state.gate;
        const agent = new FakeAgent(options.sessionId);
        await options.setup({}, agent);
        agents.push(agent);
        return { agent, dispose: async () => {} };
      },
      resume: async (options) => { throw new Error(`no ${options.resumeSessionId} here`); },
    },
    agentPresets: { mount: async (_agentCtx, id) => ({ id }) },
    permissionPresets: { set: (session, name) => { stored.set(session.id, name); }, current: (session) => stored.get(session.id) ?? "read-only" },
    on: (_name, listener) => {
      listeners.add(listener);
      return () => {
        const file = ledger();
        letGo.push(existsSync(file) ? readFileSync(file, "utf8") : "");
        listeners.delete(listener);
      };
    },
  };
  return { ctx, agents, listeners, letGo, state };
}

async function until(what: string, ok: () => boolean): Promise<void> {
  const limit = Date.now() + 5_000;
  while (!ok()) {
    if (Date.now() > limit) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 2));
  }
}

test("installDesk creates the desk conversation only when enabled with root, route, sessionCtx and installModelSelection, and disposes it before the shutdown", async () => {
  const made: string[] = [];
  const own = async (): Promise<string> => {
    const h = await home();
    made.push(h);
    return h;
  };
  try {
    let ledger = "";
    const fake = conversationRoot(() => ledger);
    const full = {
      root: join(TMP, "repo"),
      route: { provider: "stub", model: "echo" },
      sessionCtx: fake.ctx,
      installModelSelection: () => () => {},
    };
    const quiet = installDesk(recorder(), { home: await own(), enabled: false, ...full });
    assert.equal(quiet.conversation, undefined, "a disabled desk creates none");
    await quiet.dispose(0);
    for (const [left, partial] of [
      ["root", { ...full, root: undefined }],
      ["route", { ...full, route: undefined }],
      ["sessionCtx", { ...full, sessionCtx: undefined }],
      ["installModelSelection", { ...full, installModelSelection: undefined }],
    ] as const) {
      const timer = fakeTimer();
      const desk = installDesk(recorder(), { home: await own(), enabled: true, watch: { setInterval: timer.setInterval, clearInterval: timer.clearInterval }, ...partial });
      assert.equal(desk.conversation, undefined, `none without ${left}`);
      await desk.dispose(0);
    }
    assert.equal(fake.agents.length, 0);

    const h = await own();
    ledger = join(deskDir(h), "events.jsonl");
    const timer = fakeTimer();
    const desk = installDesk(recorder(), { home: h, enabled: true, watch: { setInterval: timer.setInterval, clearInterval: timer.clearInterval }, ...full });
    assert.notEqual(desk.conversation, undefined);
    await until("the conversation's start, which installDesk does not await", () => fake.listeners.size === 1);
    assert.equal(fake.agents.length, 1);
    const agent = fake.agents[0];
    assert.deepEqual(desk.conversation?.current(), { sessionId: agent.id, running: false });

    agent.status = "running";
    await desk.dispose(0);
    await desk.dispose(0);
    assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "shutdown" }]], "the running desk turn is cancelled once");
    assert.equal(fake.listeners.size, 0);
    assert.equal(fake.letGo.length, 1);
    assert.doesNotMatch(fake.letGo[0], /"kind":"shutdown"/, "the conversation was let go before the shutdown was written");
    const kinds = (await readEvents(h)).events.map((e) => e.kind);
    assert.deepEqual([kinds.slice(0, 2).sort(), kinds.slice(2)], [["boot", "desk-session"], ["shutdown"]]);
  } finally {
    await Promise.all(made.map((h) => rm(h, { recursive: true, force: true })));
  }
});

test("installDesk's dispose lets a start still ensuring finish first, so its desk-session lands before the shutdown", async () => {
  const h = await home();
  try {
    const fake = conversationRoot(() => join(deskDir(h), "events.jsonl"));
    let open: () => void = () => {};
    fake.state.gate = new Promise((done) => { open = done; });
    const timer = fakeTimer();
    const desk = installDesk(recorder(), {
      home: h, enabled: true, watch: { setInterval: timer.setInterval, clearInterval: timer.clearInterval },
      root: join(TMP, "repo-race"), route: { provider: "stub", model: "echo" }, sessionCtx: fake.ctx, installModelSelection: () => () => {},
    });
    await until("the start's create under way", () => fake.state.creates === 1);
    const disposing = desk.dispose(0);
    await new Promise((done) => setTimeout(done, 50));
    open();
    await disposing;
    assert.deepEqual((await readEvents(h)).events.map((e) => e.kind), ["boot", "desk-session", "shutdown"]);
    assert.equal(fake.listeners.size, 0, "a start that finished after dispose began supervises nothing");
  } finally {
    await rm(h, { recursive: true, force: true });
  }
});

/* installDesk's deadline seam (tests/telegram-smoke.test.ts cuts a parked card at 1,500 ms through it): the
 * conversation it creates times every desk turn by `deskDeadlineMs`, and by its own five minutes without it. */
test("installDesk's deskDeadlineMs is every desk turn's deadline; without it a turn is timed by the conversation's five minutes", async () => {
  const made: string[] = [];
  /* Disposed in `finally` too: a failure would otherwise leave a supervisor's five-minute timer holding the process. */
  const desks: { dispose(code: number): Promise<void> }[] = [];
  const realSetTimeout = globalThis.setTimeout;
  try {
    /** A desk on the fake root, its conversation started, with the bus, the agent and what reached the outlet. */
    const deskWith = async (label: string, deskDeadlineMs: number | undefined) => {
      const h = join(TMP, `deadline-${label}`);
      await mkdir(h, { recursive: true });
      made.push(h);
      const fake = conversationRoot(() => "");
      const timer = fakeTimer();
      const desk = installDesk(recorder(), {
        home: h, enabled: true, watch: { setInterval: timer.setInterval, clearInterval: timer.clearInterval },
        root: join(TMP, `repo-deadline-${label}`), route: { provider: "stub", model: "echo" }, sessionCtx: fake.ctx, installModelSelection: () => () => {},
        ...(deskDeadlineMs === undefined ? {} : { deskDeadlineMs }),
      });
      desks.push(desk);
      await until(`the ${label} conversation's start`, () => fake.listeners.size === 1);
      const agent = fake.agents[0];
      const sent: string[] = [];
      desk.conversation?.setOutlet({ send: async (text) => { sent.push(text); return { sent: [1] }; } });
      /** One event of the desk session on the root bus, as the supervisor hears it. */
      const emit = (type: string, data: Record<string, unknown>): void => {
        for (const listener of fake.listeners) (listener as (session: { id: string }, event: EventLike) => void)({ id: agent.id }, { type, seq: 0, data });
      };
      return { h, desk, agent, sent, emit };
    };

    const cut = await deskWith("seam", 40);
    cut.emit("turn/start", { turn: 1 });
    cut.emit("user/message", { turn: 1, source: { kind: "telegram" } });
    await until("the 40 ms deadline's cancel", () => cut.agent.cancels.length === 1);
    assert.deepEqual(cut.agent.cancels, [[{ kind: "hook", reason: "desk deadline" }, { keepInbox: true }]], "the seam's deadline cut the turn");
    cut.emit("turn/end", { turn: 1, reason: { kind: "aborted" } });
    await until("the timed-out line at the outlet", () => cut.sent.length === 1);
    assert.deepEqual(cut.sent, ["timed out after 0.04 s; a card or a long tool was pending"], "the line names the seam's deadline");
    assert.deepEqual((await readEvents(cut.h)).events.filter((e) => e.kind === "desk-turn").map((e) => (e as { outcome?: unknown }).outcome), ["timed-out"]);
    await cut.desk.dispose(0);

    const plain = await deskWith("default", undefined);
    const armed: unknown[] = [];
    /* The supervisor arms a turn's timer inside the bus listener, synchronously, on the global timers
     * installDesk's clock calls: the delay it asks for is the deadline in force. */
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
      armed.push(ms);
      return realSetTimeout(fn, ms, ...rest);
    }) as unknown as typeof setTimeout;
    try {
      plain.emit("turn/start", { turn: 1 });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    assert.deepEqual(armed, [300_000], "with no seam the deadline is the conversation's five minutes");
    plain.emit("user/message", { turn: 1, source: { kind: "telegram" } });
    plain.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
    await until("the default turn's record", () => existsSync(join(deskDir(plain.h), "events.jsonl"))
      && readFileSync(join(deskDir(plain.h), "events.jsonl"), "utf8").includes(`"kind":"desk-turn"`));
    assert.deepEqual(plain.agent.cancels, [], "a turn that ended inside five minutes is never cut");
    await plain.desk.dispose(0);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    await Promise.all(desks.map((desk) => desk.dispose(0)));
    await Promise.all(made.map((h) => rm(h, { recursive: true, force: true })));
  }
});

/* P1: the desk's lines as the terminal and the phone read them, and the Telegram bridge (src/telegram.ts),
 * which installDesk loads on first use. */

test("deskStatusLines: the desk line, then the pause and the telegram lines, a time on another New York date carrying it", () => {
  const now = new Date("2026-10-20T18:30:00Z"); // 14:30 ET
  const base: DeskStatus = {
    ok: true, pid: 7, version: "v", bootedAt: "2026-10-20T17:00:00.000Z", uptimeMs: 90 * 60_000 + 59_999, desk: { enabled: true, dir: "/d" },
    asleep: [], runs: [], turnsToday: { count: 0, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  };
  assert.deepEqual(deskStatusLines(base, now), ["up 1h 30m since 2026-10-20T17:00:00.000Z · desk on"], "neither line without its field");
  assert.deepEqual(deskStatusLines({ ...base, desk: { enabled: false, dir: "/d" } }, now), ["up 1h 30m since 2026-10-20T17:00:00.000Z · desk off (FACE_DESK=0)"]);
  const polled = { configured: true, polling: true, lastPollAt: "2026-10-20T18:29:00.000Z", dropped: 2, queued: 1 };
  assert.deepEqual(deskStatusLines({ ...base, off: { setAt: "2026-10-20T18:00:00.000Z", by: "telegram", until: "2026-10-20T20:00:00.000Z" },
    telegram: { ...polled, conflictAt: "2026-10-20T18:10:00.000Z" } }, now).slice(1), [
    "desk: paused since 14:00 ET by telegram until 16:00 ET (npm run desk -- resume)",
    "telegram: polling, last poll 14:29 ET, 2 dropped, 1 queued, conflict at 14:10 ET",
  ]);
  assert.deepEqual(deskStatusLines({ ...base, off: { setAt: "2026-10-19T18:00:00.000Z", by: "page", until: "2026-10-21T18:00:00.000Z" },
    telegram: { ...polled, lastPollAt: "2026-10-20T03:59:00.000Z", conflictAt: "2026-10-19T22:00:00.000Z" } }, now).slice(1), [
    "desk: paused since 2026-10-19 14:00 ET by page until 2026-10-21 14:00 ET (npm run desk -- resume)",
    "telegram: polling, last poll 2026-10-19 23:59 ET, 2 dropped, 1 queued, conflict at 2026-10-19 18:00 ET",
  ], "every time, the last poll's too: 03:59 UTC on the 20th is still the 19th in New York");
  assert.deepEqual(deskStatusLines({ ...base, telegram: { configured: false, polling: false, dropped: 0, queued: 0 } }, now).slice(1),
    ["telegram: not configured (TELEGRAM_BOT_TOKEN and TELEGRAM_OPERATOR_ID in $DSH_HOME/.env)"]);
  assert.deepEqual(deskStatusLines({ ...base, telegram: { configured: true, polling: false, dropped: 0, queued: 3 } }, now).slice(1),
    ["telegram: not polling, no poll yet, 0 dropped, 3 queued"]);
  assert.deepEqual(deskStatusLines({ ...base, telegram: { ...polled, blocked: true } }, now).slice(1),
    ["telegram: blocked (403), polling, last poll 14:29 ET, 2 dropped, 1 queued"], "a bot the operator blocked says so first");
});

/* The pause switch (scripts/desk.ts) and scripts/service.ts import desk.ts; neither runs a bridge, so
 * desk.ts names telegram.ts statically for its types alone and loads it with a dynamic import. */
test("desk.ts loads the Telegram bridge on first use: its one static import of telegram.ts is types", async () => {
  const source = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "desk.ts"), "utf8");
  const statics = (source.match(/^import\b.*$/gm) ?? []).filter((line) => line.includes('"./telegram.ts"'));
  assert.equal(statics.length, 1);
  assert.match(statics[0], /^import type /, `a value edge: ${statics[0]}`);
  assert.match(source, /import\("\.\/telegram\.ts"\)/, "the module itself comes through a dynamic import");
});

test("installDesk runs the Telegram bridge only with the desk on, Telegram configured and a conversation; the status is the bridge's; dispose ends it before the conversation", async () => {
  const token = "424242:AAFakeTokenForTheBridgeTests_x9";
  const made: string[] = [];
  const own = async (label: string): Promise<string> => {
    const h = join(TMP, `telegram-${made.length}-${label}`);
    await mkdir(h, { recursive: true });
    made.push(h);
    return h;
  };
  /** A Bot API that holds every request open until it is aborted, noting how many buses the conversation had let go of by then. */
  const botApi = (letGo: () => number) => {
    const state = { asked: [] as string[], abortedAfter: [] as number[] };
    const fetchStub = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      state.asked.push(url.slice(url.lastIndexOf("/") + 1));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { state.abortedAfter.push(letGo()); reject(init.signal?.reason); }, { once: true });
      });
    }) as typeof fetch;
    return { state, fetch: fetchStub };
  };
  const telegramOf = async (rec: ReturnType<typeof recorder>): Promise<unknown> =>
    (JSON.parse(await rec.call("/data/desk/status")) as { body: DeskStatus }).body.telegram;
  const watch = () => { const timer = fakeTimer(); return { setInterval: timer.setInterval, clearInterval: timer.clearInterval }; };
  const conversationDeps = (fake: ReturnType<typeof conversationRoot>, label: string) =>
    ({ root: join(TMP, `repo-telegram-${label}`), route: { provider: "stub", model: "echo" }, sessionCtx: fake.ctx, installModelSelection: () => () => {} });
  try {
    const plainRec = recorder();
    const plain = installDesk(plainRec, { home: await own("plain"), enabled: true, watch: watch(), ...conversationDeps(conversationRoot(() => ""), "plain") });
    assert.deepEqual(await telegramOf(plainRec), { configured: false, polling: false, dropped: 0, queued: 0 }, "no Telegram: the status says so");
    await plain.dispose(0);

    for (const [label, enabled, withConversation] of [["off", false, true], ["no conversation", true, false]] as const) {
      const quiet = botApi(() => 0);
      const rec = recorder();
      const desk = installDesk(rec, {
        home: await own(label), enabled, watch: watch(), telegram: { token, operatorId: 42, apiBase: "https://telegram.test", fetch: quiet.fetch },
        ...(withConversation ? conversationDeps(conversationRoot(() => ""), label) : {}),
      });
      await new Promise((done) => setTimeout(done, 50));
      assert.deepEqual(quiet.state.asked, [], `no bridge, no request (${label})`);
      assert.deepEqual(await telegramOf(rec), { configured: true, polling: false, dropped: 0, queued: 0 }, `configured, not polling (${label})`);
      await desk.dispose(0);
    }

    const fake = conversationRoot(() => "");
    const live = botApi(() => fake.letGo.length);
    const rec = recorder();
    const desk = installDesk(rec, {
      home: await own("live"), enabled: true, watch: watch(), telegram: { token, operatorId: 42, apiBase: "https://telegram.test", fetch: live.fetch },
      ...conversationDeps(fake, "live"),
    });
    await until("the bridge's first poll, which installDesk does not await", () => live.state.asked.includes("getUpdates"));
    assert.deepEqual(await telegramOf(rec), { configured: true, polling: true, dropped: 0, queued: 0 }, "the status is the bridge's own");
    await until("the conversation's start", () => fake.listeners.size === 1);
    await desk.dispose(0);
    assert.deepEqual(live.state.abortedAfter, [0], "the poll was aborted before the conversation let go of the bus");
    assert.equal(fake.letGo.length, 1, "and the conversation was disposed after it");
    assert.deepEqual(await telegramOf(rec), { configured: true, polling: false, dropped: 0, queued: 0 });
  } finally {
    await Promise.all(made.map((h) => rm(h, { recursive: true, force: true })));
  }
});
