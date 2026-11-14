// face/tests/routines.test.ts
/** The routines' store (src/routines.ts): a proposal, its confirmation into a routine - once, however often it is
 * confirmed -, each refusal by its code, the twentieth routine's cap, a replacement that keeps its routine's id and
 * supersedes its siblings, a dismissal, the switch and the delete with their ledger lines, the sweep's two clocks, and
 * a store cut short that loads as unreadable and is never written over. Each case's harness home sits INSIDE the
 * repository, under tests/tmp/routines-<pid>/, and is removed afterwards. */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deskDir, readRecords } from "../src/desk.ts";
import {
  DAILY_TOKENS_DEFAULT, loadRoutines, PROPOSALS_MAX, RoutineError, routineOps, ROUTINES_FILE, ROUTINES_LEDGER, ROUTINES_MAX, versionSha,
  type Origin, type RoutineOps,
} from "../src/routines.ts";

/* ---------- fixtures, inside the repository ---------- */

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "tmp", `routines-${process.pid}`);
before(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
});
after(() => rm(TEST_DIR, { recursive: true, force: true }));

let made = 0;
/** A fresh harness home, with no desk directory yet. */
const freshHome = (): string => join(TEST_DIR, String(++made));

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-16T14:00:00.000Z");
const WEB: Origin = { kind: "web" };

/** A clock the test moves by hand. */
function clock(start = T0): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return { now: () => at, advance: (ms) => { at += ms; } };
}

/** A proposal's input, `over` replacing its fields. */
const input = (over: Record<string, unknown> = {}) => ({
  name: "Morning movers",
  schedule: { days: "trading", times: ["09:00"] },
  instruction: "List the five largest pre-market movers in the book.",
  origin: WEB,
  ...over,
});

/** The ledger's lines, in order. */
async function ledger(home: string): Promise<Record<string, unknown>[]> {
  const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
  return (await readRecords(home, ROUTINES_LEDGER, isObject)).records;
}

/** The store, which must load. */
async function store(home: string) {
  const load = await loadRoutines(home);
  assert.ok(load.ok, load.ok ? "" : load.error);
  return load.store;
}

/** Asserts `p` rejects with a RoutineError of `code`. */
async function refuses(p: Promise<unknown>, code: RoutineError["code"], message?: RegExp): Promise<void> {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof RoutineError, String(err));
    assert.equal(err.code, code, err.message);
    if (message !== undefined) assert.match(err.message, message);
    return true;
  });
}

/** `n` confirmed routines in `ops`, named `R1`… */
async function fill(ops: RoutineOps, n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    const p = await ops.propose(input({ name: `R${i}` }));
    await ops.confirm(p.id);
  }
}

/* ---------- the store ---------- */

test("an absent file loads as an empty store with the default daily cap", async () => {
  const load = await loadRoutines(freshHome());
  assert.deepEqual(load, { ok: true, store: { version: 1, budget: { dailyTokens: DAILY_TOKENS_DEFAULT }, routines: [], proposals: [] } });
  assert.equal(DAILY_TOKENS_DEFAULT, 10_000_000);
});

test("versionSha is one hash for one schedule however it is ordered, and differs for another name", () => {
  const a = versionSha({ name: "N", schedule: { days: ["fri", "mon"], times: ["16:00", "09:30"] }, instruction: "I" });
  const b = versionSha({ name: "N", schedule: { times: ["09:30", "16:00"], days: ["mon", "fri"] } as never, instruction: "I" });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, versionSha({ name: "M", schedule: { days: ["mon", "fri"], times: ["09:30", "16:00"] }, instruction: "I" }));
});

test("propose then confirm: one routine, enabled, with the proposal's sha256, and two ledger lines", async () => {
  const home = freshHome();
  const c = clock();
  const ops = routineOps({ home, now: c.now });
  const p = await ops.propose(input({ note: "for the open", schedule: { days: ["fri", "mon"], times: ["16:00", "09:30"] } }));
  assert.match(p.id, /^p-[0-9a-f]{8}$/);
  assert.equal(p.state, "pending");
  assert.equal(p.proposedAt, new Date(T0).toISOString());
  assert.deepEqual(p.schedule, { days: ["mon", "fri"], times: ["09:30", "16:00"] }, "the schedule is stored canonical");
  assert.equal(p.sha256, versionSha({ name: p.name, schedule: p.schedule, instruction: p.instruction }));

  c.advance(60_000);
  const { routine, proposal } = await ops.confirm(p.id);
  assert.match(routine.id, /^r-[0-9a-f]{8}$/);
  assert.equal(routine.enabled, true);
  assert.equal(routine.sha256, p.sha256);
  assert.equal(routine.proposal, p.id);
  assert.equal(routine.note, "for the open");
  assert.deepEqual(routine.origin, WEB);
  assert.equal(routine.confirmedAt, new Date(T0 + 60_000).toISOString());
  assert.equal(proposal.state, "confirmed");
  assert.equal(proposal.routine, routine.id);
  assert.equal(proposal.settledAt, routine.confirmedAt);

  const s = await store(home);
  assert.deepEqual(s.routines, [routine]);
  assert.deepEqual(s.proposals, [proposal]);
  assert.deepEqual((await ledger(home)).map(({ t: _t, ...rest }) => rest), [
    { kind: "proposed", proposal: p.id, sha256: p.sha256 },
    { kind: "confirmed", proposal: p.id, routine: routine.id, sha256: p.sha256 },
  ]);
});

test("confirm twice answers the same and changes nothing", async () => {
  const home = freshHome();
  const ops = routineOps({ home, now: clock().now });
  const p = await ops.propose(input());
  const first = await ops.confirm(p.id);
  const bytes = await readFile(join(deskDir(home), ROUTINES_FILE), "utf8");
  const second = await ops.confirm(p.id);
  assert.deepEqual(second, first);
  assert.equal((await store(home)).routines.length, 1);
  assert.equal(await readFile(join(deskDir(home), ROUTINES_FILE), "utf8"), bytes);
  assert.equal((await ledger(home)).length, 2);
});

test("confirm of a confirmed proposal whose routine was deleted is refused as state", async () => {
  const ops = routineOps({ home: freshHome(), now: clock().now });
  const p = await ops.propose(input());
  const { routine } = await ops.confirm(p.id);
  await ops.remove(routine.id);
  await refuses(ops.confirm(p.id), "state");
});

/* ---------- refusals ---------- */

test("propose refuses a bad name, instruction, note or schedule with the sentence that names it", async () => {
  const home = freshHome();
  const ops = routineOps({ home, now: clock().now });
  await refuses(ops.propose(input({ name: "" })), "invalid", /name/);
  await refuses(ops.propose(input({ name: "x".repeat(61) })), "invalid", /name/);
  await refuses(ops.propose(input({ name: 7 })), "invalid", /name/);
  await refuses(ops.propose(input({ instruction: "" })), "invalid", /instruction/);
  await refuses(ops.propose(input({ instruction: "x".repeat(2_001) })), "invalid", /instruction/);
  await refuses(ops.propose(input({ note: "x".repeat(201) })), "invalid", /note/);
  await refuses(ops.propose(input({ schedule: { days: "trading", times: ["25:00"] } })), "invalid", /25:00/);
  await refuses(ops.propose(input({ schedule: { days: "daily", every: { minutes: 10, from: "09:00", to: "10:00" } } })), "invalid", /every\.minutes/);
  /* the limits themselves pass */
  await ops.propose(input({ name: "x".repeat(60), instruction: "y".repeat(2_000), note: "z".repeat(200) }));
  assert.equal((await ledger(home)).length, 1, "a refusal writes no line");
});

test("propose refuses an unknown replaces, and an eleventh pending proposal", async () => {
  const home = freshHome();
  const ops = routineOps({ home, now: clock().now });
  await refuses(ops.propose(input({ replaces: "r-00000000" })), "unknown");
  for (let i = 0; i < PROPOSALS_MAX; i++) await ops.propose(input({ name: `P${i}` }));
  await refuses(ops.propose(input({ name: "one too many" })), "limit");
  assert.equal((await store(home)).proposals.length, PROPOSALS_MAX);
});

test("confirm, dismiss, setEnabled and remove refuse what they do not know", async () => {
  const ops = routineOps({ home: freshHome(), now: clock().now });
  await refuses(ops.confirm("p-00000000"), "unknown");
  await refuses(ops.dismiss("p-00000000"), "unknown");
  await refuses(ops.setEnabled("r-00000000", false), "unknown");
  await refuses(ops.remove("r-00000000"), "unknown");
});

test("confirm refuses a dismissed proposal, and dismiss a confirmed one, as state", async () => {
  const ops = routineOps({ home: freshHome(), now: clock().now });
  const a = await ops.propose(input());
  await ops.dismiss(a.id);
  await refuses(ops.confirm(a.id), "state");
  const b = await ops.propose(input());
  await ops.confirm(b.id);
  await refuses(ops.dismiss(b.id), "state");
});

test("the twenty-first routine is refused as limit and its proposal stays pending", async () => {
  const home = freshHome();
  const ops = routineOps({ home, now: clock().now });
  await fill(ops, ROUTINES_MAX);
  const p = await ops.propose(input({ name: "R21" }));
  await refuses(ops.confirm(p.id), "limit");
  const s = await store(home);
  assert.equal(s.routines.length, ROUTINES_MAX);
  assert.equal(s.proposals.find((x) => x.id === p.id)?.state, "pending");
});

/* ---------- replace, dismiss, switch, delete ---------- */

test("a replacement keeps the routine's id and switch, and supersedes a sibling", async () => {
  const home = freshHome();
  const c = clock();
  const ops = routineOps({ home, now: c.now });
  const first = await ops.propose(input({ note: "old note" }));
  const { routine } = await ops.confirm(first.id);
  await ops.setEnabled(routine.id, false);
  /* a twentieth routine fills the cap: a replacement adds none, so it still confirms */
  await fill(ops, ROUTINES_MAX - 1);

  const edit = await ops.propose(input({ name: "Movers, wider", instruction: "List ten.", schedule: { days: "daily", times: ["08:00"] }, replaces: routine.id }));
  const sibling = await ops.propose(input({ name: "Movers, other", replaces: routine.id }));
  const unrelated = await ops.propose(input({ name: "Something else" }));
  assert.equal(edit.replaces, routine.id);
  c.advance(1_000);
  const answer = await ops.confirm(edit.id);

  assert.equal(answer.routine.id, routine.id);
  assert.equal(answer.routine.enabled, false);
  assert.equal(answer.routine.name, "Movers, wider");
  assert.equal(answer.routine.instruction, "List ten.");
  assert.deepEqual(answer.routine.schedule, { days: "daily", times: ["08:00"] });
  assert.equal(answer.routine.note, undefined, "the note is the proposal's, here none");
  assert.equal(answer.routine.sha256, edit.sha256);
  assert.equal(answer.routine.proposal, edit.id);

  const s = await store(home);
  assert.equal(s.routines.length, ROUTINES_MAX);
  assert.equal(s.routines.filter((r) => r.id === routine.id).length, 1);
  assert.equal(s.proposals.find((x) => x.id === sibling.id)?.state, "superseded");
  assert.equal(s.proposals.find((x) => x.id === sibling.id)?.settledAt, new Date(c.now()).toISOString());
  assert.equal(s.proposals.find((x) => x.id === unrelated.id)?.state, "pending");
  const lines = (await ledger(home)).slice(-2).map(({ t: _t, ...rest }) => rest);
  assert.deepEqual(lines, [
    { kind: "confirmed", proposal: edit.id, routine: routine.id, sha256: edit.sha256 },
    { kind: "superseded", proposal: sibling.id },
  ]);
});

test("dismiss settles a pending proposal with one line", async () => {
  const home = freshHome();
  const ops = routineOps({ home, now: clock().now });
  const p = await ops.propose(input());
  const d = await ops.dismiss(p.id);
  assert.equal(d.state, "dismissed");
  assert.equal(d.settledAt, new Date(T0).toISOString());
  assert.deepEqual((await store(home)).proposals, [d]);
  assert.deepEqual((await ledger(home)).at(-1), { t: new Date(T0).toISOString(), kind: "dismissed", proposal: p.id });
});

test("setEnabled and remove, each with its line", async () => {
  const home = freshHome();
  const ops = routineOps({ home, now: clock().now });
  const p = await ops.propose(input());
  const { routine } = await ops.confirm(p.id);
  const off = await ops.setEnabled(routine.id, false);
  assert.equal(off.enabled, false);
  assert.equal((await store(home)).routines[0]?.enabled, false);
  await ops.remove(routine.id);
  assert.deepEqual((await store(home)).routines, []);
  assert.deepEqual((await ledger(home)).slice(-2).map(({ t: _t, ...rest }) => rest), [
    { kind: "switched", routine: routine.id, enabled: false },
    { kind: "deleted", routine: routine.id },
  ]);
});

test("a proposal past its 7 days is refused as state though no sweep has run, and stays pending", async () => {
  const home = freshHome();
  const c = clock();
  const ops = routineOps({ home, now: c.now });
  const p = await ops.propose(input());
  c.advance(7 * DAY + 1);
  await refuses(ops.confirm(p.id), "state", /expired/);
  assert.equal((await store(home)).proposals[0]?.state, "pending");
  assert.deepEqual((await store(home)).routines, []);
});

/* ---------- the sweep ---------- */

test("sweep expires a pending proposal after 7 days and prunes a settled one after 30", async () => {
  const home = freshHome();
  const c = clock();
  const ops = routineOps({ home, now: c.now });
  const old = await ops.propose(input({ name: "old" }));
  const settled = await ops.propose(input({ name: "settled" }));
  await ops.dismiss(settled.id);
  c.advance(DAY);
  const young = await ops.propose(input({ name: "young" }));

  c.advance(6 * DAY); // old is exactly 7 days: not yet
  await ops.sweep();
  assert.equal((await store(home)).proposals.find((x) => x.id === old.id)?.state, "pending");

  c.advance(1);
  await ops.sweep();
  let s = await store(home);
  assert.equal(s.proposals.find((x) => x.id === old.id)?.state, "expired");
  assert.equal(s.proposals.find((x) => x.id === old.id)?.settledAt, new Date(c.now()).toISOString());
  assert.equal(s.proposals.find((x) => x.id === young.id)?.state, "pending");
  assert.deepEqual((await ledger(home)).at(-1), { t: new Date(c.now()).toISOString(), kind: "expired", proposal: old.id });

  c.advance(23 * DAY); // settled was settled 30 days and 1 ms ago
  const before = (await ledger(home)).length;
  await ops.sweep();
  s = await store(home);
  assert.equal(s.proposals.find((x) => x.id === settled.id), undefined);
  assert.ok(s.proposals.some((x) => x.id === old.id), "expired 23 days ago: kept");
  assert.equal(s.proposals.find((x) => x.id === young.id)?.state, "expired");
  assert.deepEqual((await ledger(home)).slice(before).map((l) => [l.kind, l.proposal]), [["expired", young.id]], "a prune writes no line");
});

/* ---------- Review Focus 2: a store cut short ---------- */

test("a store cut mid-JSON loads unreadable, every act refuses, and the file is never written over", async () => {
  const home = freshHome();
  const ops = routineOps({ home, now: clock().now });
  const p = await ops.propose(input());
  await ops.confirm(p.id);
  const path = join(deskDir(home), ROUTINES_FILE);
  const whole = await readFile(path, "utf8");
  const cut = whole.slice(0, Math.floor(whole.length / 2));
  await writeFile(path, cut);
  const lines = (await ledger(home)).length;

  const load = await loadRoutines(home);
  assert.equal(load.ok, false);
  await refuses(ops.confirm(p.id), "unreadable");
  await refuses(ops.propose(input()), "unreadable");
  await refuses(ops.dismiss(p.id), "unreadable");
  await refuses(ops.setEnabled("r-00000000", true), "unreadable");
  await refuses(ops.remove("r-00000000"), "unreadable");
  await refuses(ops.sweep(), "unreadable");
  assert.equal(await readFile(path, "utf8"), cut);
  assert.equal((await ledger(home)).length, lines);
});

test("a store whose shape or a routine's schedule fails its check loads unreadable", async () => {
  const home = freshHome();
  const ops = routineOps({ home, now: clock().now });
  const p = await ops.propose(input());
  await ops.confirm(p.id);
  const path = join(deskDir(home), ROUTINES_FILE);
  const good = JSON.parse(await readFile(path, "utf8"));

  const badSchedule = structuredClone(good);
  badSchedule.routines[0].schedule = { days: "trading", times: ["9am"] };
  await writeFile(path, JSON.stringify(badSchedule));
  assert.equal((await loadRoutines(home)).ok, false);

  await writeFile(path, JSON.stringify({ ...good, version: 2 }));
  assert.equal((await loadRoutines(home)).ok, false);

  await writeFile(path, JSON.stringify([]));
  assert.equal((await loadRoutines(home)).ok, false);
});
