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
  ALERTS_FILE, ASLEEP_THRESHOLD_MS, ASLEEP_TICK_MS, EVENTS_FILE, FILINGS_FILE, FIRINGS_FILE, LEDGER_ROTATE_BYTES, MUTE_FILE, MUTE_USAGE, OFF_FILE,
  WATCH_LEASE_FILE, appendChain, appendEvent, appendRecord, appendRecordOnce, budgetLine, budgetReplyLine, budgetState, clearMute, clearOff, deskDir, deskStatus, deskStatusLines, deskTime, installAsleepWatch, installDesk, lastDeskSession, noteBudgetSpent,
  muteReplyLine, parseDuration, readBudget, readEvents, readMuteState, readOffState, readRecords, registerDeskRoutes, runsOf, standingLines, writeMute,
  writeOff,
  type BudgetState, type DeskEvent, type DeskStatus, type TurnUsage,
} from "../src/desk.ts";
import type { DeskConversationCtxLike } from "../src/desk-conversation.ts";
import { DESK_PRESET } from "../src/desk-names.ts";
import type { DeskGuardCtxLike, DeskToolDefinition } from "../src/desk-tools.ts";
import type { AgentLike, SessionLike } from "../src/room.ts";
import type { EventLike } from "../src/room-rules.ts";
import { renderOrder, sha256Hex, writeStanding, type FiringSummary, type StandingStatus } from "../src/standing.ts";
import { fakeCalendar, WallClock } from "./desk-fakes.ts";
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

/* P2: the day's token budget, the once-only append, any desk JSONL read back, and what the status carries of them. */

/** A desk turn recorded at `t`, opened by `source`, ending `outcome`, with its four buckets in the ledger's order. */
const tokenTurn = (t: string, source: string, u: [number, number, number, number], outcome: "ended" | "timed-out" | "cancelled" | "failed" = "ended"): DeskEvent => ({
  t, kind: "desk-turn", sessionId: "s", source, turn: 1, outcome, wallMs: 1,
  usage: { uncachedInputTokens: u[0], outputTokens: u[1], cacheReadTokens: u[2], cacheWriteTokens: u[3], routes: [] },
});
/** A day's budget spent: 2,013,402 tokens of 2,000,000. */
const SPENT: BudgetState = {
  dailyTokens: 2_000_000,
  used: { uncachedInputTokens: 13_402, outputTokens: 0, cacheReadTokens: 2_000_000, cacheWriteTokens: 0, total: 2_013_402 },
  spent: true,
};

test("budgetState sums the four buckets of today's desk turns, phone and schedule alike, from 00:00 ET", () => {
  const now = Date.parse("2026-11-27T17:00:00Z");   // 12:00 ET
  const turn = (t: string, source: string, u: [number, number, number, number]) => ({ t, kind: "desk-turn" as const, sessionId: "s", source, turn: 1,
    outcome: "ended" as const, wallMs: 1, usage: { uncachedInputTokens: u[0], outputTokens: u[1], cacheReadTokens: u[2], cacheWriteTokens: u[3], routes: [] } });
  const events = [turn("2026-11-27T04:59:00.000Z", "telegram", [999, 0, 0, 0]),   // 23:59 ET on the 26th
    turn("2026-11-27T05:03:00.000Z", "telegram", [1, 1, 1, 1]),                      // 00:03 ET: the new day
    turn("2026-11-27T15:00:00.000Z", "telegram", [100, 10, 1000, 5]), turn("2026-11-27T16:00:00.000Z", "schedule", [50, 5, 0, 0])];
  assert.deepEqual(budgetState(events, now), { used: { uncachedInputTokens: 151, outputTokens: 16, cacheReadTokens: 1001, cacheWriteTokens: 6, total: 1174 }, spent: false });
  assert.equal(budgetState(events, now, 1174).spent, true); assert.equal(budgetState(events, now, 1175).spent, false);
});

test("budgetState: a cancelled, failed or timed-out turn's tokens count; a turn without usage, any other event and a bucket that is no count add nothing", () => {
  const now = Date.parse("2026-11-27T17:00:00Z");
  const handWritten = { ...tokenTurn("2026-11-27T14:50:00.000Z", "telegram", [0, 0, 0, 0]),
    usage: { uncachedInputTokens: "7", outputTokens: -3, cacheReadTokens: null, routes: [] } } as unknown as DeskEvent; // the reader checks t and kind only
  const events: DeskEvent[] = [
    tokenTurn("2026-11-27T14:00:00.000Z", "telegram", [10, 1, 0, 0], "cancelled"),
    tokenTurn("2026-11-27T14:10:00.000Z", "schedule", [20, 2, 0, 0], "failed"),
    tokenTurn("2026-11-27T14:20:00.000Z", "alert", [30, 3, 0, 0], "timed-out"),
    { t: "2026-11-27T14:30:00.000Z", kind: "desk-turn", sessionId: "s", source: "telegram", turn: 2, outcome: "ended", wallMs: 1 },
    { t: "2026-11-27T14:40:00.000Z", kind: "budget-spent", date: "2026-11-27", used: 5_000_000, dailyTokens: 1 },
    handWritten,
  ];
  assert.deepEqual(budgetState(events, now, 66), {
    dailyTokens: 66, used: { uncachedInputTokens: 60, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0, total: 66 }, spent: true,
  });
});

test("budgetReplyLine is the phone's line for a post while the budget is spent", () => {
  assert.equal(budgetReplyLine(SPENT),
    "the desk's token budget for today is spent: 2,013,402 of 2,000,000 tokens since 00:00 ET. It opens again at midnight ET, or raise budget.dailyTokens in standing.yml");
  assert.equal(budgetReplyLine({ used: SPENT.used, spent: false }),
    "the desk's token budget for today is spent: 2,013,402 tokens since 00:00 ET. It opens again at midnight ET, or raise budget.dailyTokens in standing.yml",
    "a state with no cap names none");
});

test("appendRecordOnce appends a key once even when two callers race", async () => {   // Review Focus 4
  const h = await home();
  const rec = { t: "2026-11-27T17:30:10.000Z", kind: "started", key: "preclose:2026-11-27" };
  const same = (x: unknown) => (x as { kind?: string; key?: string }).kind === "started" && (x as { key?: string }).key === rec.key;
  assert.deepEqual((await Promise.all([appendRecordOnce(h, "firings.jsonl", rec, same), appendRecordOnce(h, "firings.jsonl", rec, same)])).sort(), ["appended", "duplicate"]);
  const file = join(deskDir(h), FIRINGS_FILE);
  assert.equal(FIRINGS_FILE, "firings.jsonl");
  assert.equal(await readFile(file, "utf8"), `${JSON.stringify(rec)}\n`, "the file holds one line");
  assert.equal(((await stat(file)).mode & 0o777), 0o600);

  /* A torn last line is skipped by the check, and stays a line of its own. */
  const torn = `{"t":"2026-11-30T17:30:05.000Z","kind":"started","key":"preclose:2026-11-3`;
  await writeFile(file, torn, { flag: "a" });
  const next = { t: "2026-11-30T17:30:10.000Z", kind: "started", key: "preclose:2026-11-30" };
  const nextSame = (x: unknown) => (x as { key?: unknown }).key === next.key;
  assert.equal(await appendRecordOnce(h, FIRINGS_FILE, next, nextSame), "appended");
  assert.equal(await appendRecordOnce(h, FIRINGS_FILE, next, nextSame), "duplicate");
  assert.deepEqual((await readFile(file, "utf8")).split("\n"), [JSON.stringify(rec), torn, JSON.stringify(next), ""]);

  /* The check is handed every line that is a JSON object, in order, and nothing else. */
  await writeFile(file, `null\n7\n"text"\n[1]\n`, { flag: "a" });
  const handed: unknown[] = [];
  const noted = { t: "2026-12-01T17:30:10.000Z", kind: "noted" };
  assert.equal(await appendRecordOnce(h, FIRINGS_FILE, noted, (x) => { handed.push(x); return false; }), "appended");
  assert.deepEqual(handed, [rec, next]);

  /* The check reads the whole file before any rotation: a duplicate in a file past rotateBytes is found and nothing moves;
   * a new record rotates the file, which then opens with what carry hands on. */
  const big = await home();
  await appendRecord(big, FIRINGS_FILE, rec);
  assert.equal(await appendRecordOnce(big, FIRINGS_FILE, rec, same, { rotateBytes: 10 }), "duplicate");
  assert.deepEqual(await readdir(deskDir(big)), [FIRINGS_FILE], "nothing moved");
  assert.equal(await appendRecordOnce(big, FIRINGS_FILE, next, nextSame, { rotateBytes: 10, carry: () => ['{"carried":true}'] }), "appended");
  assert.deepEqual((await readdir(deskDir(big))).sort(), ["firings.2026-11-30T17-30-10.000Z.jsonl", FIRINGS_FILE]);
  assert.equal(await readFile(join(deskDir(big), FIRINGS_FILE), "utf8"), `{"carried":true}\n${JSON.stringify(next)}\n`);

  /* A failure is one line and "failed" - never a rejection, a check that throws included; a path for a name is the caller's TypeError. */
  const blocked = await home();
  await mkdir(join(deskDir(blocked), FIRINGS_FILE), { recursive: true }); // a directory where firings.jsonl should be
  const lines: string[] = [];
  assert.equal(await appendRecordOnce(blocked, FIRINGS_FILE, rec, same, { log: (l) => lines.push(l) }), "failed");
  assert.deepEqual(lines, [`gravit-face: the desk ledger at ${join(deskDir(blocked), FIRINGS_FILE)} could not be written: EISDIR`]);
  const thrown: string[] = [];
  assert.equal(await appendRecordOnce(h, FIRINGS_FILE, rec, () => { throw new Error("a broken check"); }, { log: (l) => thrown.push(l) }), "failed");
  assert.deepEqual(thrown, [`gravit-face: the desk ledger at ${file} could not be written: a broken check`]);
  await assert.rejects(appendRecordOnce(h, "../firings.jsonl", rec, same), TypeError);
});

test("noteBudgetSpent appends one budget-spent per ET date", async () => {
  const h = await home();
  const at = Date.parse("2026-11-27T17:30:10.000Z");
  const noted = (t: string, date: string): DeskEvent => ({ t, kind: "budget-spent", date, used: 2_013_402, dailyTokens: 2_000_000 });
  assert.equal(await noteBudgetSpent(h, at, SPENT), true);
  assert.equal(await noteBudgetSpent(h, at + 3_600_000, SPENT), false, "the same ET date");
  assert.equal(await noteBudgetSpent(h, Date.parse("2026-11-28T04:59:59.999Z"), SPENT), false, "23:59 ET is still the 27th");
  assert.equal(await noteBudgetSpent(h, Date.parse("2026-11-28T05:00:00.000Z"), SPENT), true, "00:00 ET opens the 28th");
  assert.deepEqual(await readEvents(h), { events: [noted("2026-11-27T17:30:10.000Z", "2026-11-27"), noted("2026-11-28T05:00:00.000Z", "2026-11-28")], skipped: 0 });

  const raced = await home();
  assert.deepEqual((await Promise.all([noteBudgetSpent(raced, at, SPENT), noteBudgetSpent(raced, at, SPENT)])).sort(), [false, true], "two faces at once: one notes it");
  assert.equal(await noteBudgetSpent(raced, Date.parse("2026-11-30T17:30:10.000Z"), { ...SPENT, spent: false }), false, "a budget that is not spent notes nothing");
  assert.equal((await readEvents(raced)).events.length, 1);

  /* events.jsonl is the ledger: a rotation the note makes carries the desk conversation on. */
  const rotating = await home();
  const session = { t: "2026-11-27T13:00:00.000Z", kind: "desk-session", sessionId: "session-a", reason: "created" } as const;
  await appendEvent(rotating, session);
  assert.equal(await noteBudgetSpent(rotating, at, SPENT, { rotateBytes: 10 }), true);
  assert.deepEqual((await readEvents(rotating)).events, [session, noted("2026-11-27T17:30:10.000Z", "2026-11-27")]);

  /* A ledger that cannot be written is one line, and true: nothing says the day has heard it already. */
  const blocked = await home();
  await writeFile(join(blocked, "face"), "a file where the directory should be");
  const lines: string[] = [];
  assert.equal(await noteBudgetSpent(blocked, at, SPENT, { log: (l) => lines.push(l) }), true);
  assert.deepEqual(lines, [`gravit-face: the desk ledger at ${join(deskDir(blocked), EVENTS_FILE)} could not be written: ENOTDIR`]);
});

test("readRecords reads any desk JSONL through a guard; events.jsonl takes the three new kinds", async () => {
  const h = await home();
  type Started = { t: string; kind: "started"; key: string };
  const isStarted = (x: unknown): x is Started => (x as { kind?: unknown }).kind === "started" && typeof (x as { key?: unknown }).key === "string";
  assert.deepEqual(await readRecords(h, FIRINGS_FILE, isStarted), { records: [], skipped: 0 }, "no file holds nothing");
  const a: Started = { t: "2026-11-27T17:30:10.000Z", kind: "started", key: "preclose:2026-11-27" };
  const b: Started = { t: "2026-11-30T17:30:10.000Z", kind: "started", key: "preclose:2026-11-30" };
  await appendRecord(h, FIRINGS_FILE, a);
  await appendRecord(h, FIRINGS_FILE, { t: "2026-11-27T17:36:00.000Z", kind: "finished", key: a.key });
  await writeFile(join(deskDir(h), FIRINGS_FILE), `null\n{"t":"2026-11-28T17:30:10.000Z","kind":"sta`, { flag: "a" });
  await appendRecord(h, FIRINGS_FILE, b);
  assert.deepEqual(await readRecords(h, FIRINGS_FILE, isStarted), { records: [a, b], skipped: 3 },
    "what the guard refuses, a line that is no object and the torn line: each skipped and counted, the guard never handed a non-object");

  const fresh: DeskEvent[] = [
    { t: "2026-11-27T17:00:00.000Z", kind: "standing-error", errors: ["orders[0] (preclose): not armed: npm run desk -- arm desk --id preclose"] },
    { t: "2026-11-27T17:00:30.000Z", kind: "calendar-error", date: "2026-11-27", clock: "fake clock", error: "the clock is down" },
    { t: "2026-11-27T17:30:10.000Z", kind: "budget-spent", date: "2026-11-27", used: 2_013_402, dailyTokens: 2_000_000 },
  ];
  const ledger = await home();
  for (const event of fresh) await appendEvent(ledger, event);
  assert.deepEqual(await readEvents(ledger), { events: fresh, skipped: 0 });

  const broken = await home();
  await mkdir(join(deskDir(broken), FIRINGS_FILE), { recursive: true });
  await assert.rejects(readRecords(broken, FIRINGS_FILE, isStarted), { code: "EISDIR" }, "an unreadable file never reads as an empty one");
  await assert.rejects(readRecords(h, "../events.jsonl", isStarted), TypeError);
  await assert.rejects(readRecords(h, "", isStarted), TypeError);
});

test("deskStatus carries the budget and passes the standing provider through", async () => {
  const h = await home();
  const now = () => Date.parse("2026-11-27T17:00:00Z"); // 12:00 ET
  await appendEvent(h, tokenTurn("2026-11-27T04:59:00.000Z", "telegram", [999, 0, 0, 0])); // 23:59 ET on the 26th
  await appendEvent(h, tokenTurn("2026-11-27T15:00:00.000Z", "telegram", [100, 10, 1000, 5]));
  await appendEvent(h, tokenTurn("2026-11-27T16:00:00.000Z", "schedule", [50, 5, 0, 0], "cancelled"));
  const used = { uncachedInputTokens: 150, outputTokens: 15, cacheReadTokens: 1000, cacheWriteTokens: 5, total: 1170 };
  const standing: StandingStatus = {
    file: { path: join(deskDir(h), "standing.yml"), state: "loaded", loadedAt: "2026-11-27T16:59:30.000Z" },
    calendar: { clock: "fake clock", state: "ok", today: { date: "2026-11-27", open: "2026-11-27T14:30:00.000Z", close: "2026-11-27T18:00:00.000Z", early: true } },
    orders: [], queued: [], recent: [],
  };
  let asked = 0;
  const s = await deskStatus({ home: h, bootedAt: now() - 60_000, enabled: true, now, dailyTokens: () => { asked += 1; return 1_000; }, standing: () => standing });
  assert.deepEqual(s.budget, { dailyTokens: 1_000, used, spent: true });
  assert.equal(asked, 1, "the cap is read once a call");
  assert.deepEqual(s.standing, standing);
  assert.deepEqual(s.turnsToday, { count: 2, usage: { uncachedInputTokens: 150, outputTokens: 15, cacheReadTokens: 1000, cacheWriteTokens: 5 } }, "the turns the budget counts");

  const none = await deskStatus({ home: h, bootedAt: now() - 60_000, enabled: true, now, dailyTokens: () => undefined, standing: () => undefined });
  assert.deepEqual(none.budget, { used, spent: false }, "no cap: never spent, and no dailyTokens key");
  assert.equal(Object.hasOwn(none, "standing"), false, "no standing orders read yet: no key");
  assert.deepEqual((await deskStatus({ home: h, bootedAt: now(), enabled: true, now })).budget, { used, spent: false }, "always set, providers or none");
  const rec = recorder();
  registerDeskRoutes(rec, { home: h, bootedAt: now(), enabled: true, now, dailyTokens: () => 2_000, standing: () => standing });
  const routed = JSON.parse(await rec.call("/data/desk/status")) as { body: DeskStatus };
  assert.deepEqual([routed.body.budget, routed.body.standing], [{ dailyTokens: 2_000, used, spent: false }, standing], "the route carries both");

  /* An unreadable ledger is zeros and not spent, its code in error: in the status and from readBudget alike. */
  const broken = await home();
  await mkdir(join(deskDir(broken), EVENTS_FILE), { recursive: true });
  const zeros = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, total: 0 };
  assert.deepEqual((await deskStatus({ home: broken, bootedAt: now(), enabled: true, now, dailyTokens: () => 1_000 })).budget,
    { dailyTokens: 1_000, used: zeros, spent: false, error: "EISDIR" });
  assert.deepEqual(await readBudget(broken, now(), 1_000), { dailyTokens: 1_000, used: zeros, spent: false, error: "EISDIR" });
  assert.deepEqual(await readBudget(h, now(), 1_170), { dailyTokens: 1_170, used, spent: true });
  assert.deepEqual(await readBudget(h, now()), { used, spent: false });
  assert.deepEqual(await readBudget(await home(), now(), 1), { dailyTokens: 1, used: zeros, spent: false }, "no ledger yet: nothing used");
});

/* The pause switch (scripts/desk.ts) imports desk.ts, and standing.ts brings js-yaml: desk.ts names it for its types alone. */
test("desk.ts names standing.ts for its types alone", async () => {
  const source = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "desk.ts"), "utf8");
  const statics = (source.match(/^import\b.*$/gm) ?? []).filter((line) => line.includes('"./standing.ts"'));
  assert.equal(statics.length, 1);
  assert.match(statics[0], /^import type /, `a value edge: ${statics[0]}`);
});

/* P2: the standing orders and the day's budget as the terminal's `status` and the phone's /status print them. */

test("standingLines and budgetLine print the orders, the calendar and the budget exactly", () => {
  const now = new Date("2026-11-27T16:00:00Z"); // 11:00 ET
  const last: FiringSummary = {
    key: "preclose:2026-11-26", order: "preclose", date: "2026-11-26", kind: "finished", outcome: "delivered", t: "2026-11-26T20:31:40.000Z",
    sessionId: "session-26", wallMs: 252_000, files: 1,
  };
  type Order = StandingStatus["orders"][number];
  const bare: Order = {
    id: "preclose", dir: "desk", file: "STANDING.md", at: "close-30m", producer: "builtin:brief", wake: true, enabled: true,
    expires: "2026-12-31", expired: false, hash: "ok", nextAnchor: "2026-11-27T17:30:00.000Z",
  };
  const loaded: StandingStatus = {
    file: { path: "/h/face/desk/standing.yml", state: "loaded", loadedAt: "2026-11-27T15:59:30.000Z" },
    calendar: { clock: "fake clock", state: "ok", today: { date: "2026-11-27", open: "2026-11-27T14:30:00.000Z", close: "2026-11-27T18:00:00.000Z", early: true } },
    orders: [{ ...bare, last }], queued: [], recent: [last],
  };
  const lastLine = "standing preclose: close-30m, next 12:30 ET; last delivered 2026-11-26 15:31 ET";
  assert.deepEqual(standingLines(loaded, now), [lastLine]);

  /* An order's line says the first that holds of: its firing running, disabled, expired, its text's pin, its script's pin, its schedule. */
  const one = (fields: Partial<Order>, s: Partial<StandingStatus> = {}): string[] => standingLines({ ...loaded, ...s, orders: [{ ...bare, ...fields }] }, now);
  assert.deepEqual(one({ hash: "changed" }), ["standing preclose: desk/STANDING.md changed since arming (npm run desk -- rearm preclose)"]);
  assert.deepEqual(one({ hash: "missing" }), ["standing preclose: desk/STANDING.md is missing"]);
  assert.deepEqual(one({ producer: "scripts/p.py", producerHash: "changed" }), ["standing preclose: scripts/p.py changed since arming (npm run desk -- rearm preclose)"]);
  assert.deepEqual(one({ producer: "scripts/p.py", producerHash: "missing" }), ["standing preclose: scripts/p.py is missing"]);
  assert.deepEqual(one({ hash: "changed", producer: "scripts/p.py", producerHash: "changed" }),
    ["standing preclose: desk/STANDING.md changed since arming (npm run desk -- rearm preclose)"], "the text's pin before the script's");
  assert.deepEqual(one({ hash: "unknown" }), ["standing preclose: close-30m, next 12:30 ET"], "a pin not yet checked claims nothing");
  assert.deepEqual(one({ nextAnchor: undefined }), ["standing preclose: close-30m, no session in the calendar's window"]);
  assert.deepEqual(one({ at: "15:30", nextAnchor: "2026-11-30T20:30:00.000Z" }), ["standing preclose: 15:30, next 2026-11-30 15:30 ET"], "another New York date carries it");
  assert.deepEqual(one({ enabled: false, hash: "changed" }), ["standing preclose: disabled"]);
  assert.deepEqual(one({ expired: true, expires: "2026-11-26", hash: "changed" }), ["standing preclose: expired after 2026-11-26"]);
  const running = { key: "preclose:2026-11-27", startedAt: "2026-11-27T17:30:04.000Z", sessionId: "session-run" };
  assert.deepEqual(one({ enabled: false }, { running }), ["standing preclose: running since 12:30 ET"]);
  assert.deepEqual(one({}, { running: { ...running, key: "preclose-2:2026-11-27" } }), ["standing preclose: close-30m, next 12:30 ET"], "another order's firing is not this one's");
  assert.deepEqual(one({ enabled: false, last: { ...last, outcome: "refused (budget)", t: "2026-11-27T15:30:10.000Z" } }),
    ["standing preclose: disabled; last refused (budget) 10:30 ET"], "the last firing after any state");
  assert.deepEqual(one({ last: { ...last, t: "yesterday" } }), ["standing preclose: close-30m, next 12:30 ET; last delivered yesterday"],
    "a time the ledger holds that is no time is shown as written, never a throw");

  /* The whole book's lines, before the orders': none armed, a refused file, an unreadable ledger, no calendar today. */
  assert.deepEqual(standingLines({ ...loaded, orders: [] }, now), ["standing orders: none armed (npm run desk -- arm)"]);
  assert.deepEqual(standingLines({ ...loaded, file: { path: "/h/face/desk/standing.yml", state: "missing" }, orders: [] }, now), ["standing orders: none armed (npm run desk -- arm)"]);
  const errors = [
    'orders[0] (preclose): at must be an anchor - open, close, open-Nm, close-Nm or HH:MM - not "9:30"',
    "orders[1] (weekly): not armed: npm run desk -- arm strategies/alpha --id weekly …",
    'budget.dailyTokens must be a whole number above zero, not "lots"',
  ];
  const refused: StandingStatus["file"] = { path: "/h/face/desk/standing.yml", state: "refused", errors };
  assert.deepEqual(standingLines({ ...loaded, file: refused, orders: [] }, now), [
    'standing orders stopped: standing.yml is refused: orders[0] (preclose): at must be an anchor - open, close, open-Nm, close-Nm or HH:MM - not "9:30"; '
    + "orders[1] (weekly): not armed: npm run desk -- arm strategies/alpha --id weekly …; budget.dailyToken…",
  ], "the errors joined and cut at 200 characters; a refused file is not an empty book");
  assert.deepEqual(standingLines({ ...loaded, file: { ...refused, errors: errors.slice(2) } }, now), [
    'standing orders stopped: standing.yml is refused: budget.dailyTokens must be a whole number above zero, not "lots"',
    lastLine,
  ], "the last good load's orders still listed");
  assert.deepEqual(standingLines({ ...loaded, ledger: { error: "EISDIR" } }, now), ["standing orders stopped: the firing ledger cannot be read (EISDIR)", lastLine]);
  assert.deepEqual(standingLines({ ...loaded, calendar: { clock: "fake clock", state: "failed", error: "the clock is down" } }, now),
    ["standing orders: no calendar today, fake clock: the clock is down", lastLine]);
  assert.deepEqual(standingLines({ ...loaded, calendar: { clock: "fake clock", state: "stale" } }, now), [lastLine], "a stale window still covers today");
  assert.deepEqual(standingLines({ ...loaded, orders: [], ledger: { error: "EACCES" }, calendar: { clock: "fake clock", state: "failed", error: "exit 1" } }, now), [
    "standing orders: none armed (npm run desk -- arm)",
    "standing orders stopped: the firing ledger cannot be read (EACCES)",
    "standing orders: no calendar today, fake clock: exit 1",
  ]);

  const used = (total: number): BudgetState["used"] => ({ uncachedInputTokens: 0, outputTokens: total, cacheReadTokens: 0, cacheWriteTokens: 0, total });
  assert.equal(budgetLine({ used: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, total: 1234567 }, spent: false }),
    "budget: 1,234,567 tokens today, cap not set (budget.dailyTokens in standing.yml)");
  assert.equal(budgetLine({ dailyTokens: 2_000_000, used: used(1_234_567), spent: false }), "budget: 1,234,567 of 2,000,000 tokens today");
  assert.equal(budgetLine({ dailyTokens: 2_000_000, used: used(2_013_402), spent: true }),
    "budget: spent, 2,013,402 of 2,000,000 tokens today; standing orders and phone turns wait for 00:00 ET");
  assert.equal(budgetLine({ dailyTokens: 2_000_000, used: used(0), spent: false, error: "EACCES" }), "budget: 0 of 2,000,000 tokens today (ledger unreadable: EACCES)");

  /* deskStatusLines: the budget line, then the standing orders', after the telegram line - each only with its field. */
  const base: DeskStatus = {
    ok: true, pid: 7, version: "v", bootedAt: "2026-11-27T14:30:00.000Z", uptimeMs: 90 * 60_000, desk: { enabled: true, dir: "/d" }, asleep: [], runs: [],
    turnsToday: { count: 0, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    telegram: { configured: true, polling: true, lastPollAt: "2026-11-27T15:59:00.000Z", dropped: 0, queued: 0 },
  };
  const budget: BudgetState = { dailyTokens: 2_000_000, used: used(1_234_567), spent: false };
  assert.deepEqual(deskStatusLines({ ...base, budget, standing: { ...loaded, orders: [{ ...bare, last }, { ...bare, id: "weekly", hash: "changed" }] } }, now).slice(1), [
    "telegram: polling, last poll 10:59 ET, 0 dropped, 0 queued",
    "budget: 1,234,567 of 2,000,000 tokens today",
    lastLine,
    "standing weekly: desk/STANDING.md changed since arming (npm run desk -- rearm weekly)",
  ]);
  assert.deepEqual(deskStatusLines({ ...base, budget }, now).slice(1), ["telegram: polling, last poll 10:59 ET, 0 dropped, 0 queued", "budget: 1,234,567 of 2,000,000 tokens today"],
    "no standing orders' clock, no lines of theirs");
  assert.deepEqual(deskStatusLines(base, now).slice(1), ["telegram: polling, last poll 10:59 ET, 0 dropped, 0 queued"], "a status with neither field: neither line");
});

/* P2: the clock row (src/schedule.ts), which installDesk loads on first use, once the bridge has set the outlet. */

/** The booted root as the desk tools and the guard read it: one live `gravit-desk` agent, whose own tool layer keeps
 * what is registered in it; `state` calls its desk_state. */
function deskToolsRoot() {
  const registered: DeskToolDefinition[] = [];
  const agent = { id: "desk-agent", ctx: { preset: DESK_PRESET, tools: { register(definition: DeskToolDefinition) { registered.push(definition); return () => {}; } } } };
  const ctx: DeskGuardCtxLike = {
    on: () => () => true,
    inject: () => ({ dispose: async () => {} }),
    agents: { list: () => [agent] },
    agentPresets: { composedPreset: (agentCtx) => (agentCtx as { preset?: string }).preset },
  };
  const state = async (): Promise<DeskStatus> => {
    const tool = registered.find((definition) => definition.name === "desk_state");
    assert.ok(tool, "desk_state is registered");
    return await tool.execute({}, { signal: new AbortController().signal }) as DeskStatus;
  };
  return { ctx, state };
}

test("installDesk loads the schedule only with the conversation; its status reaches the route and desk_state; dispose stops it first", async () => {
  const h = join(TMP, "schedule-home");
  const root = join(TMP, "repo-schedule");
  await mkdir(deskDir(h), { recursive: true });
  await mkdir(join(root, "desk", "journal"), { recursive: true });
  await writeFile(join(root, "desk", "STANDING.md"), "# The brief\n");
  await writeStanding(h, `budget:\n  dailyTokens: 1000\norders:\n${renderOrder({
    id: "preclose", dir: "desk", file: "STANDING.md", sha256: sha256Hex("# The brief\n"), at: "close-30m", producer: "builtin:brief", wake: true,
    turnDeadline: "10m", producerDeadline: "5m", expires: "2026-12-31", armedAt: "2026-11-20T15:00:00.000Z",
  }, 2)}`);
  await appendEvent(h, tokenTurn("2026-11-27T15:00:00.000Z", "telegram", [600, 400, 0, 0])); // the day's 1,000 tokens: the cap

  const fake = conversationRoot(() => "");
  const clock = new WallClock("2026-11-27T16:00:00Z");
  /* how many of the clock row's timers are still armed when the conversation lets go of the bus */
  const armedAtLetGo: number[] = [];
  const on = fake.ctx.on;
  fake.ctx.on = (name, listener) => {
    const off = on(name, listener);
    return () => {
      armedAtLetGo.push(clock.pending());
      return off();
    };
  };
  const tools = deskToolsRoot();
  const rec = recorder();
  const timer = fakeTimer();
  const desk = installDesk(rec, {
    home: h, enabled: true, now: () => Date.parse("2026-11-27T16:00:00Z"), watch: { setInterval: timer.setInterval, clearInterval: timer.clearInterval },
    ctx: tools.ctx, quotes: { snapshot: async () => ({ ok: true, generated_at: "2026-11-27T16:00:00.000Z", quotes: [], providers: [] }) },
    root, route: { provider: "stub", model: "echo" }, sessionCtx: fake.ctx, installModelSelection: () => () => {},
    python: "python3",
    schedule: { clock, calendar: fakeCalendar({ "2026-11-27": { date: "2026-11-27", open: "2026-11-27T14:30:00Z", close: "2026-11-27T18:00:00Z", early: true } }), tickMs: 86_400_000 },
    log: () => {},
  });
  assert.ok(desk.schedule !== undefined, "a desk with its conversation loads the clock row");
  const schedule = await desk.schedule;
  assert.ok(schedule !== undefined);
  await until("the conversation's start", () => fake.listeners.size === 1);
  await clock.advance(0);
  await schedule.tick();
  assert.equal(schedule.status().orders[0].id, "preclose");

  const routed = JSON.parse(await rec.call("/data/desk/status")) as { body: DeskStatus };
  assert.equal(routed.body.standing?.orders[0].id, "preclose", "the route reads the clock row's status");
  assert.deepEqual([routed.body.budget?.dailyTokens, routed.body.budget?.spent], [1000, true], "and its cap");
  const state = await tools.state();
  assert.equal(state.standing?.orders[0].id, "preclose", "and so does desk_state");
  const posted = await desk.conversation?.post({ text: "how is the book?", source: { kind: "telegram" }, message: { kind: "telegram", from: 42, chat: 42, messageId: 7 } });
  assert.deepEqual(posted, {
    refused: "budget",
    line: "the desk's token budget for today is spent: 1,000 of 1,000 tokens since 00:00 ET. It opens again at midnight ET, or raise budget.dailyTokens in standing.yml",
  }, "the conversation's budget is the clock row's cap");

  await desk.dispose(0);
  assert.deepEqual(armedAtLetGo, [0], "the clock row was disposed before the conversation let go of the bus");
  assert.equal(clock.pending(), 0, "and nothing of it is armed");

  /* a desk disposed before the clock's module arrives starts no clock */
  const early = new WallClock("2026-11-27T16:00:00Z");
  const brief = installDesk(recorder(), {
    home: h, enabled: true, now: () => Date.parse("2026-11-27T16:00:00Z"), watch: { setInterval: timer.setInterval, clearInterval: timer.clearInterval },
    root, route: { provider: "stub", model: "echo" }, sessionCtx: conversationRoot(() => "").ctx, installModelSelection: () => () => {},
    schedule: { clock: early, calendar: fakeCalendar({}), tickMs: 86_400_000 }, log: () => {},
  });
  const stopped = brief.dispose(0);
  assert.equal(await brief.schedule, undefined);
  await stopped;
  assert.equal(early.pending(), 0, "nothing armed on its clock");

  for (const label of ["off", "no conversation"] as const) {
    const quiet = installDesk(recorder(), {
      home: join(TMP, `schedule-${label.replace(" ", "-")}`), enabled: label !== "off", watch: { setInterval: timer.setInterval, clearInterval: timer.clearInterval },
      root, route: { provider: "stub", model: "echo" }, sessionCtx: label === "off" ? conversationRoot(() => "").ctx : undefined,
      installModelSelection: () => () => {}, log: () => {},
    });
    assert.equal(quiet.schedule, undefined, `no clock row (${label})`);
    await quiet.dispose(0);
  }
});

/* ---------- P3: the mute, and one append chain per file ---------- */

test("the watch's files are named beside OFF", () => {
  assert.deepEqual([ALERTS_FILE, FILINGS_FILE, MUTE_FILE, WATCH_LEASE_FILE], ["alerts.jsonl", "filings.jsonl", "MUTE", "watch.lease"]);
  assert.equal(MUTE_USAGE, "mute needs a duration: /mute 30m, /mute 2h or /mute 1d");
});

test("writeMute, readMuteState and clearMute round-trip with ledger events", async () => {
  const h = await home(); const now = () => Date.parse("2026-11-30T15:00:00Z");
  assert.deepEqual(await readMuteState(h, now), { expired: false }, "no MUTE: not muted");
  const s = await writeMute(h, { by: "telegram", until: now() + 7_200_000 }, now);
  assert.deepEqual(s, { setAt: "2026-11-30T15:00:00.000Z", by: "telegram", until: "2026-11-30T17:00:00.000Z" });
  assert.equal((await stat(join(deskDir(h), "MUTE"))).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(join(deskDir(h), MUTE_FILE), "utf8")), s);
  assert.deepEqual(await readMuteState(h, now), { state: s, expired: false });
  assert.equal((await readMuteState(h, () => now() + 7_200_001)).expired, true);
  assert.equal(await clearMute(h, "expiry", now), false, "a mute in force does not expire");
  assert.equal(await clearMute(h, "expiry", () => now() + 7_200_001), true);
  assert.equal(await clearMute(h, "terminal"), false, "nothing to lift, no second event");
  assert.deepEqual(await readOffState(h), { expired: false }, "the mute is not the pause");
  assert.deepEqual((await readEvents(h)).events, [
    { t: "2026-11-30T15:00:00.000Z", kind: "mute-set", by: "telegram", until: "2026-11-30T17:00:00.000Z" },
    { t: "2026-11-30T17:00:00.001Z", kind: "mute-cleared", by: "expiry" },
  ]);
});

test("the phone never shortens a mute, and a touched MUTE mutes with no end", async () => {
  const h = await home(); const at = Date.parse("2026-11-30T15:00:00Z");
  const twoHours = await writeMute(h, { by: "telegram", until: at + 7_200_000 }, () => at);
  assert.deepEqual(await writeMute(h, { by: "telegram", until: at + 60_000 + 3_600_000 }, () => at + 60_000), twoHours, "a 1 h mute stands aside");
  assert.deepEqual((await readMuteState(h, () => at)).state, twoHours);
  const longer = await writeMute(h, { by: "telegram", until: at + 60_000 + 10_800_000 }, () => at + 60_000);
  assert.deepEqual(longer, { setAt: "2026-11-30T15:01:00.000Z", by: "telegram", until: "2026-11-30T18:01:00.000Z" }, "a 3 h one outlasts it");
  assert.deepEqual((await readEvents(h)).events.map((e) => e.kind), ["mute-set", "mute-set"], "one event per real change");

  const touched = await home();
  await mkdir(deskDir(touched), { recursive: true });
  const file = join(deskDir(touched), MUTE_FILE);
  await writeFile(file, "");
  const mtime = new Date("2026-11-30T12:34:56.000Z");
  await utimes(file, mtime, mtime);
  const asRead = { setAt: "2026-11-30T12:34:56.000Z", by: "terminal" };
  assert.deepEqual(await readMuteState(touched, () => at + 365 * 86_400_000), { state: asRead, expired: false }, "a mute by terminal, with no end");
  assert.deepEqual(await writeMute(touched, { by: "telegram", until: at + 60_000 }, () => at), asRead, "the phone cannot shorten it");
  assert.equal(await readFile(file, "utf8"), "");
  for (const text of [`{"setAt":"2026-11-30T15:00:00.000Z","by":"page"}`, "junk"]) {
    await writeFile(file, text);
    await utimes(file, mtime, mtime);
    assert.deepEqual((await readMuteState(touched)).state, asRead, `${text}: the mute has no page setter`);
  }
  assert.equal(await clearMute(touched, "expiry", () => at + 365 * 86_400_000), false, "it never expires");
  assert.equal(await clearMute(touched, "terminal"), true);
  assert.deepEqual((await readEvents(touched)).events.map((e) => [e.kind, (e as { by?: string }).by]), [["mute-cleared", "terminal"]]);
});

test("the mute and the pause each take their own lock", async () => {
  const h = await home();
  await mkdir(deskDir(h), { recursive: true });
  let muting: Promise<unknown> = Promise.resolve();
  await withFileLock(join(deskDir(h), MUTE_FILE), async () => {
    assert.equal((await writeOff(h, { by: "terminal" })).by, "terminal", "OFF is not held by MUTE's lock");
    muting = writeMute(h, { by: "telegram", until: Date.now() + 60_000 });
    await new Promise((done) => setTimeout(done, 100));
    assert.deepEqual(await readMuteState(h), { expired: false }, "nothing written while another holds MUTE's lock");
  });
  await muting;
  assert.equal((await readMuteState(h)).state?.by, "telegram");
});

test("appendChain writes a burst in order and drops nothing", async () => {
  const h = await home();
  const chain = appendChain(h, ALERTS_FILE);
  for (let i = 0; i < 40; i++) chain.append({ t: `2026-11-30T15:00:00.${String(i).padStart(3, "0")}Z`, kind: "alert", n: i });
  await chain.settled();
  assert.deepEqual((await readRecords(h, ALERTS_FILE, (x): x is { n: number } => true)).records.map((r) => r.n), [...Array(40).keys()],
    "P0 measured 20 bare appends at once, 6 dropped (P3-6); one chain drops none");
  assert.equal((await stat(join(deskDir(h), ALERTS_FILE))).mode & 0o777, 0o600);
  chain.append({ t: "2026-11-30T15:00:01.000Z", kind: "alert", n: 40 });
  await chain.settled();
  assert.equal((await readRecords(h, ALERTS_FILE, (x): x is object => true)).records.length, 41, "the chain goes on after it settles");

  const stuck = await home();
  await mkdir(join(deskDir(stuck), FILINGS_FILE), { recursive: true }); // a directory in its place
  const lines: string[] = [];
  const failing = appendChain(stuck, FILINGS_FILE, { log: (line) => { lines.push(line); } });
  for (let i = 0; i < 3; i++) assert.equal(failing.append({ t: "2026-11-30T15:00:00.000Z", n: i }), undefined, "append returns nothing and never throws");
  await failing.settled();
  assert.equal(lines.length, 3, "one log line per record");
  for (const line of lines) assert.match(line, /^gravit-face: the desk ledger at .*filings\.jsonl could not be written: E[A-Z]+$/);
  assert.throws(() => appendChain(h, "../alerts.jsonl"), TypeError, "a path is the caller's mistake, refused before anything is touched");
});

test("appendChain on events.jsonl keeps the desk-session a rotation carries", async () => {
  const h = await home();
  const chain = appendChain(h, EVENTS_FILE);
  chain.append({ t: "2026-11-30T15:00:00.000Z", kind: "desk-session", sessionId: "desk-s1", reason: "created" });
  chain.append({ t: "2026-11-30T15:00:01.000Z", kind: "watch-load", file: "desk/rules.yml", loaded: 2, refused: [] });
  await chain.settled();
  assert.equal(lastDeskSession((await readEvents(h)).events), "desk-s1");
  assert.deepEqual((await readEvents(h)).events.map((e) => e.kind), ["desk-session", "watch-load"]);
});

test("muteReplyLine names the end, and dates it on another ET day", () => {
  const now = new Date("2026-11-30T15:00:00Z");
  assert.equal(muteReplyLine({ setAt: "2026-11-30T15:00:00.000Z", by: "telegram", until: "2026-11-30T17:00:00.000Z" }, now),
    "alerts muted until 12:00 ET; detection and the ledger go on. A terminal lifts it: npm run desk -- unmute");
  assert.equal(muteReplyLine({ setAt: "2026-11-30T15:00:00.000Z", by: "telegram", until: "2026-12-01T15:00:00.000Z" }, now),
    "alerts muted until 2026-12-01 10:00 ET; detection and the ledger go on. A terminal lifts it: npm run desk -- unmute");
  assert.equal(muteReplyLine({ setAt: "2026-11-30T12:34:56.000Z", by: "terminal" }, now),
    "alerts muted until a terminal lifts it; detection and the ledger go on. A terminal lifts it: npm run desk -- unmute");
});

test("events.jsonl takes the three new kinds", async () => {
  const fresh: DeskEvent[] = [
    { t: "2026-11-30T15:00:00.000Z", kind: "mute-set", by: "telegram", until: "2026-11-30T17:00:00.000Z" },
    { t: "2026-11-30T15:30:00.000Z", kind: "mute-cleared", by: "terminal" },
    { t: "2026-11-30T15:30:01.000Z", kind: "watch-load", file: "desk/rules.yml", loaded: 3, refused: ["#2 NVDA: kind must be move_pct, gap or filing"] },
    { t: "2026-11-30T15:30:02.000Z", kind: "watch-load", file: "desk/levels.yml", loaded: 0, refused: [], error: "levels.yml: not YAML" },
  ];
  const h = await home();
  for (const event of fresh) await appendEvent(h, event);
  assert.deepEqual(await readEvents(h), { events: fresh, skipped: 0 });
  assert.deepEqual(runsOf(fresh), [], "no run in them");
});
