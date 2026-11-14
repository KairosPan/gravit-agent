// face/tests/routine-routes.test.ts
/** The routines' routes (src/routine-routes.ts): the read - the clock row's status, or the store's alone while there
 * is no clock row -, the switch and the delete with their ledger lines, the test run passing the clock's word
 * through, every refusal by its status, the fence, and a store cut short that every act refuses with a 503, the file
 * left as it was. Each case's harness home sits INSIDE the repository, under tests/tmp/routine-routes-<pid>/, and is
 * removed afterwards. */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deskDir, readRecords } from "../src/desk.ts";
import type { RoutineClock, RoutinesStatus } from "../src/routine-clock.ts";
import { registerRoutineRoutes } from "../src/routine-routes.ts";
import { DAILY_TOKENS_DEFAULT, loadRoutines, routineOps, ROUTINES_FILE, ROUTINES_LEDGER, type RoutineOps } from "../src/routines.ts";
import { recorder } from "./route-recorder.ts";

/* ---------- fixtures, inside the repository ---------- */

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "tmp", `routine-routes-${process.pid}`);
before(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
});
after(() => rm(TEST_DIR, { recursive: true, force: true }));

let made = 0;
/** A fresh harness home, with no desk directory yet. */
const freshHome = (): string => join(TEST_DIR, String(++made));

const T0 = Date.parse("2026-11-16T14:00:00.000Z");
const PATHS = ["/data/desk/routines", "/data/desk/routines/switch", "/data/desk/routines/test", "/data/desk/routines/delete"];

/** A home holding one confirmed routine, its ops, and its id. */
async function withRoutine(): Promise<{ home: string; ops: RoutineOps; id: string }> {
  const home = freshHome();
  const ops = routineOps({ home, now: () => T0, log: () => {} });
  const proposal = await ops.propose({
    name: "Morning movers", schedule: { days: "daily", times: ["09:00"] }, instruction: "List the movers.", origin: { kind: "web" },
  });
  const { routine } = await ops.confirm(proposal.id);
  return { home, ops, id: routine.id };
}

/** The ledger's lines, in order. */
async function ledger(home: string): Promise<Record<string, unknown>[]> {
  const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
  return (await readRecords(home, ROUTINES_LEDGER, isObject)).records;
}

/** A clock row that answers `word` to every test and `status` to every read, recording the ids it was asked for. */
function fakeClock(word: Awaited<ReturnType<RoutineClock["test"]>>, status?: RoutinesStatus): RoutineClock & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    tick: async () => {},
    status: async () => status ?? { load: { ok: true }, routines: [], cap: { dailyTokens: 1, used: 0, spent: false }, queued: [] },
    test: async (id) => { asked.push(id); return word; },
    dispose: async () => {},
  };
}

type Answer = { status: number; body: Record<string, unknown> };
const call = async (rec: ReturnType<typeof recorder>, path: string, json?: unknown, host?: string): Promise<Answer> =>
  JSON.parse(await rec.call(path, {
    ...(json === undefined ? {} : { method: "POST", json }),
    ...(host === undefined ? {} : { host }),
  })) as Answer;

/* ---------- the routes ---------- */

test("registers the read and the three acts, each behind the fence", async () => {
  const { home, ops } = await withRoutine();
  const rec = recorder();
  registerRoutineRoutes(rec, { ops, clock: () => undefined, home, now: () => T0 });
  assert.deepEqual(rec.paths(), PATHS);
  for (const path of PATHS) {
    const forged = await call(rec, path, path === PATHS[0] ? undefined : { id: "r-00000000", enabled: true }, "evil.example.com");
    assert.equal(forged.status, 403, path);
    assert.deepEqual(forged.body, { ok: false, error: "forbidden" });
  }
});

test("the read with no clock row is the store's alone: each routine's when, no runs, the store's cap unspent", async () => {
  const { home, ops, id } = await withRoutine();
  const rec = recorder();
  registerRoutineRoutes(rec, { ops, clock: () => undefined, home, now: () => T0 });
  const read = await call(rec, "/data/desk/routines");
  assert.equal(read.status, 200);
  const load = await loadRoutines(home);
  assert.ok(load.ok);
  const r = load.store.routines[0]!;
  assert.deepEqual(read.body, {
    ok: true,
    load: { ok: true },
    routines: [{
      id, name: "Morning movers", when: "Every day at 09:00 ET", instruction: "List the movers.",
      enabled: true, sha256: r.sha256, confirmedAt: r.confirmedAt, runs: [],
    }],
    cap: { dailyTokens: DAILY_TOKENS_DEFAULT, used: 0, spent: false },
    queued: [],
  });

  /* an empty home reads as no routines, the default cap */
  const empty = recorder();
  const bare = freshHome();
  registerRoutineRoutes(empty, { ops: routineOps({ home: bare }), clock: () => undefined, home: bare });
  assert.deepEqual((await call(empty, "/data/desk/routines")).body, {
    ok: true, load: { ok: true }, routines: [], cap: { dailyTokens: 10_000_000, used: 0, spent: false }, queued: [],
  });
});

test("the read with a clock row is its status, as it is", async () => {
  const { home, ops } = await withRoutine();
  const status: RoutinesStatus = { load: { ok: true }, routines: [], cap: { dailyTokens: 5, used: 3, spent: false }, running: "r-1:2026-11-16:09:00", queued: ["k"] };
  const rec = recorder();
  registerRoutineRoutes(rec, { ops, clock: () => fakeClock("queued", status), home });
  assert.deepEqual((await call(rec, "/data/desk/routines")).body, { ok: true, ...status });
});

test("switch flips the routine in the store, answers it and writes its ledger line", async () => {
  const { home, ops, id } = await withRoutine();
  const rec = recorder();
  registerRoutineRoutes(rec, { ops, clock: () => undefined, home });
  const off = await call(rec, "/data/desk/routines/switch", { id, enabled: false });
  assert.equal(off.status, 200);
  assert.equal((off.body.routine as { id: string; enabled: boolean }).enabled, false);
  assert.equal((off.body.routine as { id: string }).id, id);
  const load = await loadRoutines(home);
  assert.ok(load.ok);
  assert.equal(load.store.routines[0]!.enabled, false);
  const last = (await ledger(home)).at(-1)!;
  assert.equal(last.kind, "switched"); assert.equal(last.routine, id); assert.equal(last.enabled, false);
});

test("switch and delete refuse a bad body with 400 and an unknown id with 404", async () => {
  const { home, ops } = await withRoutine();
  const rec = recorder();
  registerRoutineRoutes(rec, { ops, clock: () => undefined, home });
  for (const body of [{}, { id: 7, enabled: true }, { id: "r-00000000" }, { id: "r-00000000", enabled: "yes" }]) {
    const bad = await call(rec, "/data/desk/routines/switch", body);
    assert.equal(bad.status, 400, JSON.stringify(body));
    assert.equal(bad.body.ok, false);
  }
  assert.equal((await call(rec, "/data/desk/routines/delete", { id: 7 })).status, 400);
  assert.equal((await call(rec, "/data/desk/routines/test", {})).status, 400);
  const unknown = await call(rec, "/data/desk/routines/switch", { id: "r-00000000", enabled: true });
  assert.equal(unknown.status, 404);
  assert.equal(typeof unknown.body.error, "string");
  assert.equal((await call(rec, "/data/desk/routines/delete", { id: "r-00000000" })).status, 404);
});

test("delete removes the routine and writes its ledger line", async () => {
  const { home, ops, id } = await withRoutine();
  const rec = recorder();
  registerRoutineRoutes(rec, { ops, clock: () => undefined, home });
  const gone = await call(rec, "/data/desk/routines/delete", { id });
  assert.deepEqual(gone, { status: 200, body: { ok: true } });
  const load = await loadRoutines(home);
  assert.ok(load.ok);
  assert.deepEqual(load.store.routines, []);
  const last = (await ledger(home)).at(-1)!;
  assert.equal(last.kind, "deleted"); assert.equal(last.routine, id);
});

test("test passes the clock row's word through: queued 200, paused and cap 409, unknown 404", async () => {
  const { home, ops, id } = await withRoutine();
  const expected = { queued: 200, paused: 409, cap: 409, unknown: 404 } as const;
  for (const [word, status] of Object.entries(expected) as [keyof typeof expected, number][]) {
    const clock = fakeClock(word);
    const rec = recorder();
    registerRoutineRoutes(rec, { ops, clock: () => clock, home });
    const answer = await call(rec, "/data/desk/routines/test", { id });
    assert.equal(answer.status, status, word);
    assert.deepEqual(answer.body, status === 200 ? { ok: true, result: "queued" } : { ok: false, error: word });
    assert.deepEqual(clock.asked, [id]);
  }
});

test("test with no clock row is 409 paused: nothing runs while the desk is off", async () => {
  const { home, ops, id } = await withRoutine();
  const rec = recorder();
  registerRoutineRoutes(rec, { ops, clock: () => undefined, home });
  assert.deepEqual(await call(rec, "/data/desk/routines/test", { id }), { status: 409, body: { ok: false, error: "paused" } });
});

test("a store cut short: the read says so, and every act answers 503 and leaves the file as it was", async () => {
  const { home, ops, id } = await withRoutine();
  const path = join(deskDir(home), ROUTINES_FILE);
  const cut = (await readFile(path, "utf8")).slice(0, 40);
  await writeFile(path, cut);
  const rec = recorder();
  registerRoutineRoutes(rec, { ops, clock: () => undefined, home });
  const read = await call(rec, "/data/desk/routines");
  assert.equal(read.status, 200);
  assert.equal((read.body.load as { ok: boolean }).ok, false);
  assert.equal(typeof (read.body.load as { error: string }).error, "string");
  assert.deepEqual(read.body.routines, []);
  assert.deepEqual(read.body.cap, { dailyTokens: DAILY_TOKENS_DEFAULT, used: 0, spent: false });
  for (const [path2, body] of [["/data/desk/routines/switch", { id, enabled: false }], ["/data/desk/routines/delete", { id }]] as const) {
    const refused = await call(rec, path2, body);
    assert.equal(refused.status, 503, path2);
    assert.equal(refused.body.ok, false);
    assert.equal(typeof refused.body.error, "string");
  }
  assert.equal(await readFile(path, "utf8"), cut);
});

test("an act's own refusals map to their statuses, and any other throw is a 500 with a fixed message", async () => {
  const home = freshHome();
  const { RoutineError } = await import("../src/routines.ts");
  const failing = (err: Error): RoutineOps => ({
    propose: async () => { throw err; }, confirm: async () => { throw err; }, dismiss: async () => { throw err; },
    setEnabled: async () => { throw err; }, remove: async () => { throw err; }, sweep: async () => {},
  });
  const cases: [Error, number, string][] = [
    [new RoutineError("invalid", "bad"), 400, "bad"],
    [new RoutineError("state", "wrong state"), 400, "wrong state"],
    [new RoutineError("unknown", "no such routine"), 404, "no such routine"],
    [new RoutineError("limit", "too many"), 409, "too many"],
    [new RoutineError("unreadable", "cut short"), 503, "cut short"],
    [new Error("lock timed out at /secret/path"), 500, "request failed"],
  ];
  for (const [err, status, error] of cases) {
    const rec = recorder();
    registerRoutineRoutes(rec, { ops: failing(err), clock: () => undefined, home });
    assert.deepEqual(await call(rec, "/data/desk/routines/switch", { id: "r-00000000", enabled: true }), { status, body: { ok: false, error } });
    assert.deepEqual(await call(rec, "/data/desk/routines/delete", { id: "r-00000000" }), { status, body: { ok: false, error } });
  }
});
