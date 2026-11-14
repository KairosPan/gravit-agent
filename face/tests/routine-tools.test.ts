// face/tests/routine-tools.test.ts
/** The conversation's two routine tools (src/routine-tools.ts) over the real store (src/routines.ts): a proposal in
 * an operator's turn, the operator-turn guard, the secret check with the face's own detector, a schedule's refusal
 * in its own sentence, a phone turn's origin, the list of routines and waiting cards, and the contract's paragraph.
 * Each case's harness home sits INSIDE the repository, under tests/tmp/routine-tools-<pid>/, and is removed
 * afterwards. Every secret here is made up. */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readRouter, ROUTER_MAX_BYTES } from "../src/cycle.ts";
import { deskDir } from "../src/desk.ts";
import { deskSecretDecision, deskSecrets, type DeskToolDefinition } from "../src/desk-tools.ts";
import { loadRoutines, routineOps, type RoutineOps } from "../src/routines.ts";
import { routineToolDefinitions } from "../src/routine-tools.ts";
import { OPERATOR_ONLY } from "../src/task-tools.ts";
import type { TaskOrigin } from "../src/conversation.ts";

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "tmp", `routine-tools-${process.pid}`);
before(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
});
after(() => rm(TEST_DIR, { recursive: true, force: true }));

let made = 0;
/** A fresh harness home, with no desk directory yet. */
const freshHome = (): string => join(TEST_DIR, String(++made));

/** A made-up key (no four characters of it in any refusal by chance), under a name the face's secret check takes (src/desk-tools.ts `deskSecrets`). */
const SECRET = "Qx7v9JfK2mWp4Ld8Zt";
const SECRETS = deskSecrets({ ROUTINE_TOOLS_TEST_API_KEY: SECRET });
const hasSecret = (text: string): boolean => deskSecretDecision(text, SECRETS) !== null;

const exec = { signal: new AbortController().signal };
const byName = (defs: DeskToolDefinition[], name: string) => defs.find((d) => d.name === name)!;

/** The two tools over a fresh home; `operator` and `origin` are read on every call. */
function setup(over: { operator?: () => boolean; origin?: () => TaskOrigin } = {}) {
  const home = freshHome();
  const ops = routineOps({ home });
  const defs = routineToolDefinitions(ops, {
    home, operatorTurn: over.operator ?? (() => true), ...(over.origin === undefined ? {} : { turnOrigin: over.origin }), hasSecret,
  });
  return { home, ops, defs, propose: byName(defs, "routine_propose"), list: byName(defs, "routine_list") };
}

const ARGS = {
  name: "Morning movers",
  schedule: { days: "trading", every: { minutes: 30, from: "08:30", to: "16:00" } },
  instruction: "List the five largest pre-market movers and one line on each.",
};

/** The pending proposals in the store. */
async function pending(home: string) {
  const load = await loadRoutines(home);
  assert.ok(load.ok);
  return load.store.proposals.filter((p) => p.state === "pending");
}

test("the two tools, in order, with their exact descriptions", () => {
  const { defs } = setup();
  assert.deepEqual(defs.map((d) => d.name), ["routine_propose", "routine_list"]);
  assert.equal(byName(defs, "routine_propose").description,
    "Propose a routine: work the operator wants on a clock. Only in a turn the operator's message opened. It adds nothing: the operator sees a card with the name, when it runs and the instruction, and confirms it in the browser. `schedule` is New York time: `days` is trading, daily or weekdays; give either `times` or `every` with its `from` and `to` (told no end, use 16:00). `instruction` is what a fresh Gravit does on each run, alone: it can price symbols, read headlines, the market's list and bars, search and open web pages, and read the repository; it cannot see the account or place an order. `note` is one line the operator should know. `replaces` is the id of the routine this changes.");
  assert.equal(byName(defs, "routine_list").description, "The operator's routines and the cards still waiting: ids, names, when each runs, on or off.");
  assert.equal(byName(defs, "routine_propose").timeoutMs, 15_000);
});

test("a proposal in an operator's turn stores one pending proposal and answers the when line with its runs a day", async () => {
  const { home, propose } = setup();
  const out = await propose.execute(ARGS, exec) as { ok: true; proposal: string; when: string; runsPerDay: number; replaces?: string };
  assert.equal(out.ok, true);
  assert.match(out.proposal, /^p-[0-9a-f]{8}$/);
  assert.equal(out.when, "Trading days, every 30 min, 08:30–16:00 ET · 16 runs a day");
  assert.equal(out.runsPerDay, 16);
  assert.equal("replaces" in out, false);
  const waiting = await pending(home);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]!.id, out.proposal);
  assert.equal(waiting[0]!.name, "Morning movers");
  assert.deepEqual(waiting[0]!.origin, { kind: "web" });
});

test("outside a turn the operator's message opened: OPERATOR_ONLY, and the store is unchanged", async () => {
  const { home, propose } = setup({ operator: () => false });
  await assert.rejects(propose.execute(ARGS, exec), (err: Error) => err.message === OPERATOR_ONLY);
  const load = await loadRoutines(home);
  assert.ok(load.ok);
  assert.equal(load.store.proposals.length, 0);
  await assert.rejects(readFile(join(deskDir(home), "routines.json")), { code: "ENOENT" });
});

test("an instruction carrying a planted key is refused, the refusal holds no part of the key, and nothing is stored", async () => {
  const { home, propose } = setup();
  for (const args of [
    { ...ARGS, instruction: `Price NVDA with key ${SECRET} every half hour.` },
    { ...ARGS, name: `movers ${SECRET}` },
    { ...ARGS, note: `uses ${encodeURIComponent(SECRET)}` },
  ]) {
    let message = "";
    await assert.rejects(propose.execute(args, exec), (err: Error) => { message = err.message; return true; });
    assert.equal(message, "the routine carries a secret; say it without the key");
    for (let i = 0; i + 4 <= SECRET.length; i++) assert.equal(message.includes(SECRET.slice(i, i + 4)), false, `echoes ${SECRET.slice(i, i + 4)}`);
  }
  const load = await loadRoutines(home);
  assert.ok(load.ok);
  assert.equal(load.store.proposals.length, 0);
});

test("a bad schedule's sentence reaches the caller", async () => {
  const { home, propose } = setup();
  await assert.rejects(propose.execute({ ...ARGS, schedule: { days: "trading", times: ["9am"] } }, exec), (err: Error) => {
    assert.equal(err.message, "9am is not a time as HH:MM.");
    return true;
  });
  assert.equal((await pending(home)).length, 0);
});

test("a phone turn's proposal records its origin", async () => {
  const { home, propose } = setup({ origin: () => ({ kind: "phone", network: "telegram" }) });
  await propose.execute(ARGS, exec);
  const [p] = await pending(home);
  assert.deepEqual(p!.origin, { kind: "phone", network: "telegram" });
});

/** Two routines confirmed, the second switched off, and one card still waiting that replaces the first. */
async function seeded(ops: RoutineOps) {
  const a = await ops.confirm((await ops.propose({ ...ARGS, origin: { kind: "web" } })).id);
  const b = await ops.confirm((await ops.propose({
    name: "Sunday wrap", schedule: { days: ["sun"], times: ["18:00"] }, instruction: "Sum up the week.", origin: { kind: "web" },
  })).id);
  await ops.setEnabled(b.routine.id, false);
  const card = await ops.propose({ ...ARGS, name: "Morning movers v2", schedule: { days: "daily", times: ["09:00"] }, replaces: a.routine.id, origin: { kind: "web" } });
  return { a: a.routine.id, b: b.routine.id, card: card.id };
}

test("routine_list: two routines and one waiting card", async () => {
  const { ops, list, propose } = setup();
  const ids = await seeded(ops);
  const out = await list.execute({}, exec);
  assert.deepEqual(out, {
    routines: [
      { id: ids.a, name: "Morning movers", when: "Trading days, every 30 min, 08:30–16:00 ET · 16 runs a day", enabled: true },
      { id: ids.b, name: "Sunday wrap", when: "Sundays at 18:00 ET", enabled: false },
    ],
    pending: [{ proposal: ids.card, name: "Morning movers v2", when: "Every day at 09:00 ET", replaces: ids.a }],
  });
  /* a proposal that replaces one answers which */
  const again = await propose.execute({ ...ARGS, replaces: ids.b }, exec) as { replaces?: string };
  assert.equal(again.replaces, ids.b);
});

test("routine_list: a store that cannot be read answers its error", async () => {
  const { home, list } = setup();
  await mkdir(deskDir(home), { recursive: true });
  await writeFile(join(deskDir(home), "routines.json"), "{ cut short");
  const out = await list.execute({}, exec) as { error?: string };
  assert.match(out.error ?? "", /^routines\.json is not JSON/);
});

test("router.md fits ROUTER_MAX_BYTES and names the routine tools", () => {
  const text = readRouter();
  assert.ok(Buffer.byteLength(text) <= ROUTER_MAX_BYTES, `${Buffer.byteLength(text)} bytes`);
  for (const needle of ["routine_propose", "routine_list", "`replaces`"]) assert.ok(text.includes(needle), `names ${needle}`);
});
