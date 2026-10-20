# The Desk, P0 — the Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gravit-face runs as a macOS user service — started at login, restarted after a crash, keyed from `$DSH_HOME/.env`, with a ledger that records every boot, clean stop and sleep gap, and a `status` command that reads it — so the desk's later plans have a process that is always there.

**Architecture:** one new face module, `src/desk.ts`, holds the first piece of the desk: an append-only JSONL ledger under `$DSH_HOME/face/desk/`, a sleep-gap watch on a plain timer, and the fenced `GET /data/desk/status` route; `main.ts` installs it behind the `FACE_DESK` switch. One new operator script, `face/scripts/service.ts`, renders and manages the LaunchAgent the way the demo's `account-service.ts` does, creates the home's `.env` from the repo's gitignored key files, and answers `status`/`url`/`logs` from launchd, the route and the ledger. No dsh row is added or changed; nothing here touches `boot.ts`, the composition, `GRAVIT.md` or the charter.

**Tech Stack:** Node 22 (`^22.19.0 || >=24.0.0`), TypeScript strict via `tsx`, `node:test`; `@deepseek-ai/dsh-atomic-write` (`withFileLock`, already a dependency); macOS `launchctl`; no new npm dependency.

**Spec:** `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` — §5.2 (the service), §5.7 (the ledger), §5.8 (the kill switch is P1's; P0 writes none), §8 (files), §9 (drills), §12 (P0's done criterion).

## Global Constraints

- The service's environment carries `PATH`, `HOME`, `DSH_HOME` and, only when asked, `FACE_PORT` — never a key; keys come from `$DSH_HOME/.env`, which `install` creates from `.env.deepseek`, `.env.alpaca` and `.env.ifind` at the repo root when the home has none, and never overwrites.
- LaunchAgent: `RunAtLoad true`, `KeepAlive { SuccessfulExit false }`, `ThrottleInterval 30`, `Umask 63` (= `077`), logs under `$DSH_HOME/face/service/`, `ProgramArguments` = node (its PATH location, else `process.execPath`), `face/node_modules/tsx/dist/cli.mjs`, `face/src/main.ts`; `WorkingDirectory` = `face/` (`main.ts` chdirs to the repo root itself).
- Ledger: `$DSH_HOME/face/desk/events.jsonl`, one JSON object per line, appended under `withFileLock`, files created mode `0600`, rotated when the file exceeds 50 MB (`50 * 1024 * 1024` bytes). A ledger failure is logged with the `gravit-face:` prefix and never throws into the face.
- Sleep gaps: a timer ticks every 30 s; a gap between ticks longer than two minutes (`120_000` ms) is one `asleep` event; a negative gap (clock set back) is no event.
- `FACE_DESK=0` installs none of the desk rows (no `boot` event, no watch); the status route still answers, reporting `desk.enabled: false`. Any other value, including unset, enables the desk. The switch is read in `main.ts`, where the face installs its rows — the spec's §8 names `boot.ts`; P0's pieces need no dsh row, so the entry is the right reader, and Task 6 corrects the table to `main.ts`.
- Every `/data` route is fenced with `isTrustedDataRequest` first and answers the fixed `FORBIDDEN` body on refusal; status is `{ ok: true, ... }` on 200.
- Conventions the face already holds: `||` (not `??`) when reading an env var with a default; the `gravit-face:` diagnostic prefix (`BIN`); tests under `tests/*.test.ts` via `node:test`, never touching `~/.dsh` (every test home is a `mkdtemp`); a real boot only behind `FACE_SMOKE=1`; `npm run typecheck` strict.
- The dsh pins (`DSH_PIN` 0.2.0-rc.2) do not move; no dsh row or config changes.
- Branch: `feat/desk`, cut from `main`. P0 touches no file the same-day Lunhui graft spec edits except additive rows in `DEVELOPMENT.md`, so it needs not wait for it (spec B7 orders the later plans, not this one).

## Review Focus

1. **A face already holds the port** (an `npm start` left in a terminal) when the service is installed or started: dsh's `webserver` row fails with `EADDRINUSE`, the process exits 1, and KeepAlive would restart it every 30 s forever. `install` and `start` must refuse while anything answers on the port. — Task 5, test "install refuses while the port answers".
2. **`$DSH_HOME/.env` exists but lacks a key** the service needs: the face boots keyless and the first prompt fails. `install` must say which of `DEEPSEEK_API_KEY`, `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY` the home's file lacks. — Task 4, test "ensureHomeEnv reports the expected names an existing file lacks".
3. **The clock moves backwards** (an NTP correction): `now - last` is negative; the watch must write nothing and keep running. — Task 2, test "a backwards clock is no gap".
4. **The ledger directory cannot be created or written** (a file sits at `$DSH_HOME/face/desk`, or the home is read-only): the face must still boot and serve; the failure is one stderr line. — Task 1, test "an unwritable ledger logs and does not throw".
5. **`kill -9` leaves no `shutdown` event**: the next `status` must say the last run was lost, not read as healthy. — Task 1, test "runsOf marks a boot with no shutdown before the next boot as lost"; Task 5, test "formatStatus names a lost last run".

---

### Task 1: The ledger — `src/desk.ts`, events in and out

**Files:**
- Create: `face/src/desk.ts`
- Test: `face/tests/desk.test.ts`

**Interfaces:**
- Produces:
  - `export const DESK_DIR: readonly ["face", "desk"]` and `export function deskDir(home: string): string` → `join(home, "face", "desk")`.
  - `export const EVENTS_FILE = "events.jsonl"`, `export const LEDGER_ROTATE_BYTES = 50 * 1024 * 1024`.
  - `export type DeskEvent = { t: string; kind: "boot"; pid: number; version: string; deskEnabled: boolean } | { t: string; kind: "shutdown"; pid: number; code: number } | { t: string; kind: "asleep"; from: string; to: string; gapMs: number }` — `t`, `from`, `to` are ISO-8601 UTC strings (`new Date(ms).toISOString()`).
  - `export async function appendEvent(home: string, event: DeskEvent, opts?: { rotateBytes?: number; log?: (line: string) => void }): Promise<void>` — mkdir `deskDir(home)` recursively, then under `withFileLock(file, …)`: rename `events.jsonl` to `events.<t with ":" replaced by "-">.jsonl` when its size exceeds `rotateBytes` (default `LEDGER_ROTATE_BYTES`), then `appendFile` the line with `mode: 0o600`. Catches every error, calls `log` (default `console.error`) once with `gravit-face: the desk ledger at <file> could not be written: <error.code or message>`, resolves.
  - `export async function readEvents(home: string): Promise<{ events: DeskEvent[]; skipped: number }>` — the current `events.jsonl` only; an absent file is `{ events: [], skipped: 0 }`; a line that is not a JSON object with a string `t` and a known `kind` is skipped and counted.
  - `export interface DeskRun { bootedAt: string; pid: number; endedAt?: string; code?: number; lost: boolean }` and `export function runsOf(events: DeskEvent[]): DeskRun[]` — one run per `boot`, in order; a `shutdown` with the same `pid` after it ends it (`endedAt`, `code`); a boot followed by another boot with no shutdown between is `lost: true`; the last boot with no shutdown yet is `lost: false` (it may be the running one). `endedAt` and `code` are ABSENT on an unended run, never `undefined` — the tests compare with `deepEqual`.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/desk.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEDGER_ROTATE_BYTES, appendEvent, deskDir, readEvents, runsOf, type DeskEvent } from "../src/desk.ts";

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/desk.test.ts`
Expected: FAIL — `Cannot find module '../src/desk.ts'`.

- [ ] **Step 3: Implement `face/src/desk.ts`** with the exports of the Interfaces block. Module header in the face's style (what the desk is, that P0 holds the ledger only, the spec section); its own `const BIN = "gravit-face"` as `roster.ts` has. `appendEvent` mirrors `roster.ts`'s `update` (mkdir, then `withFileLock`); `readEvents` validates `kind` against the three names; `runsOf` is a single pass keyed on the current open run.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/desk.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add face/src/desk.ts face/tests/desk.test.ts
git commit -m "feat(face): the desk ledger - events.jsonl under the harness home, locked, rotated, read back as runs"
```

---

### Task 2: The sleep watch, the status and its route

**Files:**
- Modify: `face/src/desk.ts`
- Test: `face/tests/desk.test.ts`

**Interfaces:**
- Consumes: Task 1's `appendEvent`, `readEvents`, `DeskEvent`; `RouteRegistrar` from `./static.ts`; `isTrustedDataRequest` from `./data.ts`; `FORBIDDEN`, `HttpError` from `./http.ts`; `DSH_PIN` from `./version.ts`.
- Produces:
  - `export const ASLEEP_TICK_MS = 30_000`, `export const ASLEEP_THRESHOLD_MS = 120_000`.
  - `export interface AsleepWatchOptions { tickMs?: number; thresholdMs?: number; now?: () => number; setInterval?: (fn: () => void, ms: number) => unknown; clearInterval?: (handle: unknown) => void; append: (event: DeskEvent) => void | Promise<void> }` and `export function installAsleepWatch(opts: AsleepWatchOptions): () => void` — returns the disposer; each tick computes `gap = now() - last`, appends `{ kind: "asleep", from: iso(last), to: iso(now), gapMs: gap }` only when `gap > thresholdMs`, then sets `last = now()`.
  - `export interface DeskStatus { ok: true; pid: number; version: string; bootedAt: string; uptimeMs: number; desk: { enabled: boolean; dir: string }; asleep: { from: string; to: string; gapMs: number }[]; runs: DeskRun[] }` and `export async function deskStatus(deps: { home: string; bootedAt: number; enabled: boolean; now?: () => number; pid?: number; version?: string }): Promise<DeskStatus>` — `asleep` is every `asleep` event with `from >= iso(bootedAt)`; `runs` is `runsOf(events)` for the whole current ledger; `version` defaults to `DSH_PIN`, `pid` to `process.pid`.
  - `export function registerDeskRoutes(webServer: RouteRegistrar, deps: Parameters<typeof deskStatus>[0] & { isTrusted?: (req: IncomingMessage) => boolean }): void` — registers `{ kind: "exact", path: "/data/desk/status" }` with the `get` shell `panels.ts` uses (fence → 403 `FORBIDDEN`; `200 { ok: true, ... }`; `HttpError` → its status; else `500 { ok: false, error: "request failed" }`).
  - `export interface DeskHandle { enabled: boolean; bootedAt: number; ready: Promise<void>; dispose(code: number): Promise<void> }` and `export function installDesk(webServer: RouteRegistrar, deps: { home: string; enabled: boolean; now?: () => number; version?: string; watch?: Partial<AsleepWatchOptions> }): DeskHandle` — always registers the route; when `enabled`: `ready` is the `boot` event's append, then `installAsleepWatch` with `append: (e) => appendEvent(home, e)`; `dispose(code)` stops the watch and appends `{ kind: "shutdown", pid, code }` (when enabled) — idempotent. When not enabled: `ready` resolves at once, `dispose` writes nothing.

- [ ] **Step 1: Write the failing tests** (append to `face/tests/desk.test.ts`)

```ts
import { recorder } from "./route-recorder.ts";
import {
  ASLEEP_THRESHOLD_MS, ASLEEP_TICK_MS, deskStatus, installAsleepWatch, installDesk, registerDeskRoutes,
} from "../src/desk.ts";

function fakeTimer() {
  let tick: (() => void) | undefined; let cleared = false;
  return {
    setInterval: (fn: () => void) => { tick = fn; return 1; },
    clearInterval: () => { cleared = true; },
    fire: () => tick?.(),
    get cleared() { return cleared; },
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
  t += ASLEEP_TICK_MS; timer.fire();
  assert.equal(got.length, 0);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/desk.test.ts`
Expected: FAIL — `installAsleepWatch` (and the others) are not exported.

- [ ] **Step 3: Implement the five exports in `face/src/desk.ts`.** The route handler is the `panels.ts` `get` shell, inlined (desk.ts does not import panels.ts). `installDesk`'s `dispose` holds a `disposed` flag so the second call is a no-op.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/desk.test.ts && npm run typecheck`
Expected: PASS, 10 tests; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add face/src/desk.ts face/tests/desk.test.ts
git commit -m "feat(face): the desk's sleep watch, status and fenced /data/desk/status route"
```

---

### Task 3: `main.ts` installs the desk behind `FACE_DESK`; the smoke proves the route on a real tree

**Files:**
- Modify: `face/src/main.ts` (the `shutdown` function; the `installFailLoud` release; after `registerPanelRoutes`, before `commitReady`)
- Modify: `face/tests/smoke.test.ts` (after the `registerDataRoutes` call around line 410)

**Interfaces:**
- Consumes: Task 2's `installDesk`, `DeskHandle`, `deskDir`.
- Produces: the log line `gravit-face: desk: ledger at <dir>` or `gravit-face: desk: rows disabled (FACE_DESK=0)`; `FACE_DESK` read as `process.env.FACE_DESK !== "0"`.

- [ ] **Step 1: Write the failing smoke assertion** (in `tests/smoke.test.ts`, inside the one boot, after `registerDataRoutes`; `home` is the scratch home, `base` the bound URL)

```ts
const desk = installDesk(ctx.webServer, { home, enabled: true });
await desk.ready;
const deskRes = await fetch(`${base}/data/desk/status`);
assert.equal(deskRes.status, 200);
const deskBody = await deskRes.json() as { ok: boolean; desk: { enabled: boolean }; runs: { lost: boolean }[] };
assert.equal(deskBody.ok, true); assert.equal(deskBody.desk.enabled, true);
assert.equal(deskBody.runs.length, 1); assert.equal(deskBody.runs[0]!.lost, false);
assert.match(readFileSync(join(home, "face", "desk", "events.jsonl"), "utf8"), /"kind":"boot"/);
await desk.dispose(0);
```

(import `installDesk` from `../src/desk.ts` at the top.)

- [ ] **Step 2: Run the smoke to verify it fails**

Run: `cd face && FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts`
Expected: FAIL at the new block only if `installDesk` were missing — it exists after Task 2, so this step verifies the assertion RUNS and passes on the real tree. If it fails, the route or the ledger misbehaves on a real webserver: fix `desk.ts`, not the test.

- [ ] **Step 3: Wire `main.ts`:** declare `let desk: DeskHandle | undefined;` beside `disposeRoom`; in `shutdown(code)` call `await desk?.dispose(code)` before `await dispose?.()`; in the `installFailLoud` release call `await desk?.dispose(1)` first; after `await registerPanelRoutes(...)` and before `booted.commitReady()`:

```ts
desk = installDesk(booted.ctx.webServer, { home: dshHome, enabled: process.env.FACE_DESK !== "0" });
console.log(`${BIN}: desk: ${desk.enabled ? `ledger at ${deskDir(dshHome)}` : "rows disabled (FACE_DESK=0)"}`);
```

A short comment above it says what the switch is for (a second face beside the service, spec §5.2) and that the `boot` event is not awaited (the ledger must never delay readiness).

- [ ] **Step 4: Verify the wiring by hand** (the entry has no unit test; the smoke above covers the module)

Run (macOS has no GNU `timeout`; a scratch home, keyless is fine):

```bash
cd face && npm run typecheck
export DSH_HOME=$(mktemp -d) FACE_PORT=0 && npm run setup
npm start & sleep 20; kill -TERM $!; wait $!; echo "exit $?"
cat "$DSH_HOME/face/desk/events.jsonl"
```

Expected: the boot prints `gravit-face: desk: ledger at …/face/desk`; `exit 0` after SIGTERM; the ledger shows a `boot` line then a `shutdown` line with `"code":0`. Then the same with `FACE_DESK=0` exported prints `rows disabled (FACE_DESK=0)` and `ls "$DSH_HOME/face"` has no `desk/`.

- [ ] **Step 5: Run the whole suite**

Run: `cd face && npm test && FACE_SMOKE=1 npx tsx --test tests/smoke.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add face/src/main.ts face/tests/smoke.test.ts
git commit -m "feat(face): main installs the desk behind FACE_DESK; the smoke proves /data/desk/status on a real tree"
```

---

### Task 4: `scripts/service.ts` — the pure parts: the plan, the env file, the parsers

**Files:**
- Create: `face/scripts/service.ts`
- Test: `face/tests/service.test.ts`

**Interfaces:**
- Consumes: Task 2's `DeskStatus`, Task 1's `DeskRun`.
- Produces:
  - `export const LABEL = "com.gravit.face"`; `export const EXPECTED_KEYS = ["DEEPSEEK_API_KEY", "APCA_API_KEY_ID", "APCA_API_SECRET_KEY"] as const`.
  - `export interface ServicePlan { plist: string; path: string; log: string; errLog: string; args: string[]; env: Record<string, string> }` and `export function servicePlan(opts: { root: string; home: string; homeDir: string; node: string; path: string; launchAgentsDir: string; port?: number }): ServicePlan` — pure; `args` as the Global Constraints say; `env` is exactly `{ PATH: filterPath(opts.path), HOME: opts.homeDir, DSH_HOME: opts.home }` plus `FACE_PORT: String(port)` when given; `log`/`errLog` are `join(home, "face", "service", "face.log")` / `"face.err.log"`; `path` is `join(launchAgentsDir, LABEL + ".plist")`; the plist XML escapes `&`, `<`, `>` in every string; `WorkingDirectory` is `join(root, "face")`.
  - `export function filterPath(path: string): string` — drops empty entries and any containing `/node_modules/`.
  - `export function envLinesOf(text: string): { name: string; line: string }[]` — `NAME=VALUE` lines only (regex `^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$`), the `export ` prefix stripped from `line`, blanks and `#` comments dropped, values untouched.
  - `export function ensureHomeEnv(home: string, sources: string[]): { path: string; created: boolean; names: string[]; missing: string[]; missingSources: string[] }` — `path = join(home, ".env")`; an existing file is read, never written: `names` are its own names, `created: false`; otherwise the lines of every existing source are concatenated in order and written with `mode: 0o600` (mkdir `home` recursively), `created: true` — unless no line was found, then nothing is written and `created: false`; `missing` is `EXPECTED_KEYS` minus `names`; `missingSources` lists the source paths that do not exist.
  - `export function parseLaunchctlPrint(text: string): { state?: string; pid?: number }` — `state = (\w+)`, `pid = (\d+)`.
  - `export function lastTokenUrl(logText: string): string | undefined` — the URL of the last line matching `https?:\/\/\S+\?token=\S+`.
  - `export function formatStatus(args: { label: string; info: { state?: string; pid?: number }; installed: boolean; status: DeskStatus | undefined; url: string | undefined; port: number }): string` — lines: `<label>: not installed (npm run service -- install)` when not installed; else `<label>: <state> (pid N)`, then `answering at http://127.0.0.1:<port> · up <h>h <m>m since <bootedAt> · desk <on|off (FACE_DESK=0)>` or `not answering on <port>`; then `asleep: <n> gap(s) since boot` when any; then `last run: lost (killed or crashed; no shutdown event)` when `status.runs` has a run before the current one with `lost: true`, else `last run: ended <endedAt> code <code>` when there was one; then `sign in: <url>` or `sign in: no URL in the log yet (npm run service -- logs)`.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/service.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPECTED_KEYS, LABEL, ensureHomeEnv, envLinesOf, filterPath, formatStatus, lastTokenUrl, parseLaunchctlPrint, servicePlan } from "../scripts/service.ts";
import type { DeskStatus } from "../src/desk.ts";

const home = (): Promise<string> => mkdtemp(join(tmpdir(), "face-service-"));
const plan = (port?: number) => servicePlan({ root: "/repo", home: "/h/.dsh", homeDir: "/h", node: "/usr/local/bin/node", path: "/usr/local/bin:/repo/face/node_modules/.bin::/opt/homebrew/bin", launchAgentsDir: "/h/Library/LaunchAgents", port });

test("servicePlan: node, tsx, main.ts; face/ as cwd; only PATH HOME DSH_HOME in the environment; launchd keys", () => {
  const p = plan();
  assert.deepEqual(p.args, ["/usr/local/bin/node", "/repo/face/node_modules/tsx/dist/cli.mjs", "/repo/face/src/main.ts"]);
  assert.deepEqual(p.env, { PATH: "/usr/local/bin:/opt/homebrew/bin", HOME: "/h", DSH_HOME: "/h/.dsh" });
  assert.equal(p.path, `/h/Library/LaunchAgents/${LABEL}.plist`);
  assert.equal(p.log, "/h/.dsh/face/service/face.log"); assert.equal(p.errLog, "/h/.dsh/face/service/face.err.log");
  for (const needle of ["<key>Label</key><string>com.gravit.face</string>", "<key>WorkingDirectory</key><string>/repo/face</string>",
    "<key>RunAtLoad</key><true/>", "<key>SuccessfulExit</key><false/>", "<key>ThrottleInterval</key><integer>30</integer>",
    "<key>Umask</key><integer>63</integer>", `<key>StandardOutPath</key><string>${p.log}</string>`]) assert.ok(p.plist.includes(needle), needle);
  assert.doesNotMatch(p.plist, /KEY|TOKEN|SECRET/, "no credential name reaches the plist");
  assert.ok(plan(3091).plist.includes("<key>FACE_PORT</key><string>3091</string>"));
  assert.ok(!p.plist.includes("FACE_PORT"));
});

test("servicePlan escapes XML in paths", () => {
  const p = servicePlan({ root: "/re&po", home: "/h/.dsh", homeDir: "/h", node: "/n", path: "", launchAgentsDir: "/l" });
  assert.ok(p.plist.includes("/re&amp;po/face"));
});

test("filterPath drops empty and node_modules entries", () => {
  assert.equal(filterPath("/a::/x/node_modules/.bin:/b"), "/a:/b");
});

test("envLinesOf keeps NAME=VALUE lines verbatim, strips export, drops comments and blanks", () => {
  assert.deepEqual(envLinesOf('# keys\nexport DEEPSEEK_API_KEY="sk x"\n\nAPCA_API_KEY_ID=abc # trailing\nnot a line\n'), [
    { name: "DEEPSEEK_API_KEY", line: 'DEEPSEEK_API_KEY="sk x"' },
    { name: "APCA_API_KEY_ID", line: "APCA_API_KEY_ID=abc # trailing" },
  ]);
});

test("ensureHomeEnv writes .env mode 0600 from the sources once, then leaves it alone", async () => {
  const h = await home(); const src = await home();
  await writeFile(join(src, ".env.deepseek"), "export DEEPSEEK_API_KEY=d\n");
  await writeFile(join(src, ".env.alpaca"), "APCA_API_KEY_ID=k\nAPCA_API_SECRET_KEY=s\n");
  const first = ensureHomeEnv(join(h, ".dsh"), [join(src, ".env.deepseek"), join(src, ".env.alpaca"), join(src, ".env.ifind")]);
  assert.deepEqual(first, { path: join(h, ".dsh", ".env"), created: true, names: [...EXPECTED_KEYS], missing: [], missingSources: [join(src, ".env.ifind")] });
  assert.equal(((await stat(first.path)).mode & 0o777), 0o600);
  const text = await readFile(first.path, "utf8");
  assert.equal(text, "DEEPSEEK_API_KEY=d\nAPCA_API_KEY_ID=k\nAPCA_API_SECRET_KEY=s\n");
  const again = ensureHomeEnv(join(h, ".dsh"), [join(src, ".env.deepseek")]);
  assert.equal(again.created, false);
  assert.equal(await readFile(first.path, "utf8"), text, "never rewritten");
});

test("ensureHomeEnv reports the expected names an existing file lacks, and writes nothing without sources", async () => {
  const h = await home();
  await writeFile(join(h, ".env"), "DEEPSEEK_API_KEY=d\n");
  const r = ensureHomeEnv(h, ["/nowhere/.env.alpaca"]);
  assert.deepEqual(r.names, ["DEEPSEEK_API_KEY"]); assert.deepEqual(r.missing, ["APCA_API_KEY_ID", "APCA_API_SECRET_KEY"]);
  const empty = await home();
  const none = ensureHomeEnv(empty, ["/nowhere/.env.deepseek"]);
  assert.equal(none.created, false); assert.deepEqual(none.missing, [...EXPECTED_KEYS]);
  await assert.rejects(stat(join(empty, ".env")));
});

test("parseLaunchctlPrint and lastTokenUrl", () => {
  assert.deepEqual(parseLaunchctlPrint("gui/501/com.gravit.face = {\n\tstate = running\n\tpid = 4242\n}"), { state: "running", pid: 4242 });
  assert.deepEqual(parseLaunchctlPrint(""), {});
  const log = "x\ngravit-face: http://127.0.0.1:3090/?token=aaa (profile: face)\nagain\ngravit-face: http://127.0.0.1:3090/?token=bbb (profile: face)\n";
  assert.equal(lastTokenUrl(log), "http://127.0.0.1:3090/?token=bbb"); assert.equal(lastTokenUrl("nothing"), undefined);
});

test("formatStatus names a lost last run", () => {
  const status: DeskStatus = { ok: true, pid: 7, version: "v", bootedAt: "2026-10-19T15:00:00.000Z", uptimeMs: 90 * 60_000, desk: { enabled: true, dir: "/d" }, asleep: [],
    runs: [{ bootedAt: "2026-10-19T14:00:00.000Z", pid: 6, lost: true }, { bootedAt: "2026-10-19T15:00:00.000Z", pid: 7, lost: false }] };
  const text = formatStatus({ label: LABEL, info: { state: "running", pid: 7 }, installed: true, status, url: "http://127.0.0.1:3090/?token=t", port: 3090 });
  assert.match(text, /^com\.gravit\.face: running \(pid 7\)/);
  assert.match(text, /answering at http:\/\/127\.0\.0\.1:3090 · up 1h 30m since 2026-10-19T15:00:00\.000Z · desk on/);
  assert.match(text, /last run: lost \(killed or crashed; no shutdown event\)/);
  assert.match(text, /sign in: http:\/\/127\.0\.0\.1:3090\/\?token=t/);
  assert.match(formatStatus({ label: LABEL, info: {}, installed: false, status: undefined, url: undefined, port: 3090 }), /not installed \(npm run service -- install\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/service.test.ts`
Expected: FAIL — `Cannot find module '../scripts/service.ts'`.

- [ ] **Step 3: Implement the pure exports in `face/scripts/service.ts`** (no CLI yet; a module header in the demo script's style naming every command of Task 5). `servicePlan` renders the plist as the demo's `plan` does, with `EnvironmentVariables` from `env` in insertion order. `tsconfig.json`'s `include` does not cover `scripts/`, so the test's import is what typechecks it: add `"scripts/**/*.ts"` to `include` so `npm run typecheck` covers the script directly too (the other scripts already typecheck through the tests that import them; if one that no test imports fails under the wider include, fix it in this commit or narrow the include to `scripts/service.ts`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/service.test.ts && npm run typecheck`
Expected: PASS, 8 tests; tsc clean (including `scripts/`).

- [ ] **Step 5: Commit**

```bash
git add face/scripts/service.ts face/tests/service.test.ts face/tsconfig.json
git commit -m "feat(face): the service script's pure parts - the LaunchAgent plan, the home .env, the status text"
```

---

### Task 5: The service commands

**Files:**
- Modify: `face/scripts/service.ts` (the CLI under the `import.meta.url === argv[1]` guard, as the demo does)
- Modify: `face/package.json` (`"service": "tsx scripts/service.ts"` under `scripts`)
- Test: `face/tests/service.test.ts`

**Interfaces:**
- Consumes: Task 4's exports; Task 1's `readEvents`, `runsOf` (imported from `../src/desk.ts` to read the ledger directly); `resolveDshHome` from `@deepseek-ai/dsh-home-paths`.
- Produces:
  - `export async function portAnswers(port: number, fetchImpl: typeof fetch = fetch): Promise<boolean>` — `GET http://127.0.0.1:<port>/data/desk/status` with a 1,500 ms `AbortSignal.timeout`; **any** HTTP response is `true` (an older face answers 404), a connection error or timeout is `false`.
  - `export async function fetchStatus(port: number, fetchImpl: typeof fetch = fetch): Promise<DeskStatus | undefined>` — the same GET with a 2,000 ms timeout; `undefined` unless `200` with `ok: true`.
  - `export function installPlan(args: { port: number; answers: boolean }): { refuse?: string }` — `refuse` = `something already answers on 127.0.0.1:<port> - stop it (a terminal npm start?) before installing or starting the service` when `answers`; the CLI calls it before `install` and `start`.
  - Commands, `npm run service -- <cmd> [--port N]`: `install` (darwin only; `ensureHomeEnv` first, printing `wrote <path> with: <names>` or `kept <path>`, then `missing: <names>` and `no source: <paths>` when any; refuse while the port answers; mkdir the logs directory `0o700`; `launchctl bootout` the old label quietly; write the plist `0o644`; `bootstrap`, `enable`; print the plist path, the log path, and `next: npm run service -- url`), `uninstall` (`bootout`, remove the plist; the ledger and `.env` untouched, said so), `start` (refuse while the port answers; `launchctl kickstart gui/<uid>/<label>`), `stop` (`launchctl kill SIGTERM gui/<uid>/<label>` — the face exits 0, which `SuccessfulExit false` leaves stopped), `restart` (`kickstart -k`), `status` (default: installed iff the plist exists at `<homeDir>/Library/LaunchAgents/<label>.plist` — `launchctl` is per user, not per `HOME`, so the file is the test a scratch `HOME` can pass; only then `launchctl print` → `parseLaunchctlPrint`; `fetchStatus`; the ledger's `runsOf` when the route does not answer; `lastTokenUrl` of the log; print `formatStatus`), `logs` (the last 40 lines of each log file), `url` (`lastTokenUrl` of the log, or `no sign-in URL in the log yet`). Every launchd command but `status`/`logs`/`url` refuses off darwin with one line.
  - The home is `resolveDshHome(undefined)`; the repo root is resolved from the script's own location (`../..`); node is the first `node` on `PATH` outside `node_modules`, else `process.execPath`.

- [ ] **Step 1: Write the failing tests** (append to `face/tests/service.test.ts`)

```ts
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installPlan, portAnswers, fetchStatus } from "../scripts/service.ts";

const fakeFetch = (status: number, body?: unknown): typeof fetch =>
  (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;
const refusing: typeof fetch = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;

test("portAnswers: any HTTP answer is yes, a refused connection is no", async () => {
  assert.equal(await portAnswers(3090, fakeFetch(404)), true);
  assert.equal(await portAnswers(3090, refusing), false);
});

test("fetchStatus: only a 200 with ok:true counts", async () => {
  assert.equal(await fetchStatus(3090, fakeFetch(404)), undefined);
  assert.equal(await fetchStatus(3090, fakeFetch(200, { ok: false })), undefined);
  assert.equal((await fetchStatus(3090, fakeFetch(200, { ok: true, pid: 1 })))?.pid, 1);
});

test("install refuses while the port answers", () => {
  assert.match(installPlan({ port: 3090, answers: true }).refuse ?? "", /something already answers on 127\.0\.0\.1:3090 - stop it/);
  assert.equal(installPlan({ port: 3090, answers: false }).refuse, undefined);
});

test("the CLI's status against an empty temp home says not installed", async () => {
  const h = await home();
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "service.ts");
  const out = await new Promise<string>((resolve, reject) => execFile(process.execPath, [join(dirname(script), "..", "node_modules", "tsx", "dist", "cli.mjs"), script, "status", "--port", "1"],
    { env: { ...process.env, HOME: h, DSH_HOME: join(h, ".dsh") }, encoding: "utf8" }, (err, stdout) => (err ? reject(err) : resolve(stdout))));
  assert.match(out, /com\.gravit\.face: not installed \(npm run service -- install\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd face && npx tsx --test tests/service.test.ts`
Expected: FAIL — `installPlan`, `portAnswers`, `fetchStatus` are not exported; the CLI case fails because the script has no command handling yet.

- [ ] **Step 3: Implement the three exports and the CLI** in `face/scripts/service.ts`, and add the `service` script to `face/package.json`. `status` with no plist under `homeDir` never calls `launchctl`; with one, a failing `launchctl print` reads as `loaded` with no pid (the demo's `quiet` pattern).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd face && npx tsx --test tests/service.test.ts && npm run typecheck`
Expected: PASS, 12 tests; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add face/scripts/service.ts face/tests/service.test.ts face/package.json
git commit -m "feat(face): npm run service - install, start, stop, restart, status, logs, url, uninstall for the LaunchAgent"
```

---

### Task 6: The documents

**Files:**
- Modify: `face/README.md` ("Run" gains a "Run as a service" subsection right after the `npm start` block; "Tests" table's `smoke.test.ts` row; a new "The desk drill" section after "The cycle drill")
- Modify: `DEVELOPMENT.md` (§4.2, §4.4, §4.5, §4.6, §7.3, §10 item 5, Appendix A)
- Modify: `CLAUDE.md` (the `face/` row), `ROADMAP.md` (Part II)

- [ ] **Step 1: `face/README.md`** — "Run as a service": the six commands with one line each; that keys come from `$DSH_HOME/.env`, which `install` creates from the three `.env.*` files and never overwrites, and the `missing:` line to watch; the sign-in: `npm run service -- url` prints the current run's `?token=` URL (new on every restart; a signed-in browser keeps its 30-day cookie); the logs' location; `FACE_DESK=0` for a second face beside the service (one Telegram poller, one IEX connection — forward references to P1/P3 in one clause); the sleep setting, verbatim: *on mains, `sudo pmset -c sleep 0`; the display may sleep; on battery the Mac sleeps mid-turn (the 2026-10-13 measurement), and the ledger records the gap as `asleep`*. "The desk drill" (P0 half): 1. `npm run service -- install`, `status` says `running`, `url` prints the URL, open it in a browser; 2. `kill -9 <pid>`, within 30 s `status` says `running` with a new pid and `last run: lost`; 3. `npm run service -- stop`, `status` says the state launchd reports and `last run: ended … code 0`; `start`; 4. log out and in, `status` says `running` without any terminal having started it; 5. `FACE_DESK=0 FACE_PORT=3091 DSH_HOME=$SCRATCH npm start` beside it boots and prints `rows disabled`. PASS = all five; record the date in `DEVELOPMENT.md` §7.4's new **Desk** row.
- [ ] **Step 2: `DEVELOPMENT.md`** — §4.2: a `desk.ts` row (the ledger, the sleep watch, `/data/desk/status`, `installDesk`; P0 of the desk arc, spec path) and a `scripts/service.ts` row; §4.4: `GET /data/desk/status` — fence first, `{ok, pid, version, bootedAt, uptimeMs, desk:{enabled,dir}, asleep[], runs[]}`; §4.5: `$DSH_HOME/face/desk/events.jsonl` (writer `desk.ts`; append-only, locked, `0600`, rotated at 50 MB) and `$DSH_HOME/face/service/face.log`, `face.err.log` (writer launchd; `Umask 077`); §4.6 and Appendix A: `FACE_DESK` (`main.ts`, unset, `=0` installs none of the desk rows); §7.3: `desk` and `service` in the suite's bullets and the `smoke` line's new assertion; §7.4: a **Desk** manual row, "not yet run"; §10 item 5 rewritten: *The desk (spec `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md`): P0 the service landed <date>; P1–P4 follow the spec's §12*.
- [ ] **Step 3: `CLAUDE.md`** — the `face/` row gains `; src/desk.ts is the desk's ledger and status, scripts/service.ts the LaunchAgent (npm run service)`. **`ROADMAP.md`** — Part I item (2) becomes *the desk — service, Telegram bridge, standing orders on the exchange calendar, levels and rules (spec 2026-10-19)*; Part II gains *2026-10-xx the desk P0: the face as a LaunchAgent, the ledger, `/data/desk/status`, `FACE_DESK`*.
- [ ] **Step 4: Verify** — `cd face && npm test && npm run typecheck`; `python -m pytest -q` at the repo root still green (nothing Python changed, but the suite greps `scripts/` for order paths: `scripts/` under `face/` is not the repo's `scripts/`, so no new producer is scanned — confirm it passes).
- [ ] **Step 5: Commit**

```bash
git add face/README.md DEVELOPMENT.md CLAUDE.md ROADMAP.md
git commit -m "docs: the desk P0 - run the face as a service, the ledger and FACE_DESK, the desk drill"
```

---

### Task 7: Verification before hand-over

- [ ] **Step 1:** `cd face && npm test` — every file green; `FACE_SMOKE=1 npm test` — the fifteen real boots plus the smoke's desk block green.
- [ ] **Step 2:** `cd face && npm run typecheck` — clean with `scripts/` included.
- [ ] **Step 3:** `git log --oneline main..HEAD` — six commits, one per task above.
- [ ] **Step 4:** Hand over with the branch name and the drill's five steps (README "The desk drill"); the drill itself is the operator's and is the plan's done criterion (spec §12 P0): *the face has survived a `kill -9` and a login without a terminal, and a second face has booted beside it with `FACE_DESK=0`.*
