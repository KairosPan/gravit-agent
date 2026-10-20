// face/tests/desk.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ASLEEP_THRESHOLD_MS, ASLEEP_TICK_MS, LEDGER_ROTATE_BYTES, appendEvent, deskDir, deskStatus, installAsleepWatch,
  installDesk, readEvents, registerDeskRoutes, runsOf, type DeskEvent,
} from "../src/desk.ts";
import { recorder } from "./route-recorder.ts";

const home = (): Promise<string> => mkdtemp(join(tmpdir(), "face-desk-"));
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
  assert.deepEqual(rec.paths(), ["/data/desk/status"]);
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
  assert.deepEqual(rec.paths(), ["/data/desk/status"]);
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
