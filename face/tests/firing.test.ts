// face/tests/firing.test.ts
/** One firing (src/firing.ts): the checks before it - the pause, the budget, the armed text's and script's bytes,
 * the chain fence, in that order - and the run: the producer and its cap, a fresh desk agent in the order's cwd,
 * supervised with the order's own deadline and the fence and woken once with the verified text inline, the
 * watchdog, the turn's record in the ledger, the files the turn changed, the fence again, the delivery before the
 * firing's market moment and the one line for every other ending, and the abort; then the phone lines, the
 * ledger's records and how each reads. Offline: fake agents, a fake bus, a supervisor that hands the test its
 * turn's end - the real one where the record itself is under test - a recording delivery and a WallClock
 * (tests/desk-fakes.ts). Each case's repository root and harness home sit INSIDE the repository, under
 * tests/tmp/firing-<pid>/, and are removed afterwards; a script producer is JavaScript under a .py name, run by node
 * itself (process.execPath). */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeskConversation } from "../src/desk-conversation.ts";
import type { DeliverResult } from "../src/desk-conversation.ts";
import {
  clearOff, deskDir, FIRINGS_FILE, readEvents, readRecords, writeOff, type BudgetState, type DeskEvent, type TurnUsage,
} from "../src/desk.ts";
import type { DeskSessionCtxLike, DeskTurnRecord } from "../src/desk-session.ts";
import {
  checkFiring, cutoffOf, diffFiles, FILES_RECORD_MAX, FILES_WALK_MAX, FIRING_DISPOSE_MS, FIRING_SLACK_MS, firingKey, isFiringRecord, LINES, outcomeOf,
  resolveFiringRoute, runFiring, snapshotFiles, wakeMessage,
  type FinishedRecord, type FiringDeps, type FiringItem, type FiringRecord, type Verified,
} from "../src/firing.ts";
import type { MarketSession } from "../src/market-clock.ts";
import { defaultProducerRunner, PRODUCER_TEXT_MAX, type ProducerInput, type ProducerOutput } from "../src/producer.ts";
import { sha256Hex, type StandingOrder } from "../src/standing.ts";
import {
  fakeAgents, fakeBus, fakeCalendar, fakeSupervise, recordingDeliver, WallClock, type FakeAgents, type FakeBus, type FakeSupervise,
} from "./desk-fakes.ts";

/* ---------- fixtures, inside the repository ---------- */

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "tmp", `firing-${process.pid}`);
before(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
  /* CommonJS for the .py fixtures, above BOTH scripts/ and every home's run base: a script producer runs from its
   * private copy in <home>/face/desk/run, not beside scripts/, and face/package.json says "module", under which
   * node refuses a .py file. */
  await writeFile(join(TEST_DIR, "package.json"), '{ "type": "commonjs" }\n');
});
after(() => rm(TEST_DIR, { recursive: true, force: true }));

/** The order's text as armed: UTF-8 beyond ASCII, and a last newline, both carried byte for byte. */
const STANDING = "# The pre-close brief\n\nSPY · QQQ · IWM: the day's moves, then the book — each price with its source and time.\nNever recommend a trade.\n";

/** A script producer that prints `out` and exits 0. */
const printing = (out: string): string => `process.stdout.write(${JSON.stringify(out)});\n`;

/** A fresh repository root - desk/STANDING.md, desk/journal/, scripts/p.py holding `script` - and harness home, whose
 * desk directory exists as the caller's `started` record leaves it; the order's cwd is the journal. */
interface Fixture {
  root: string;
  home: string;
  cwd: string;
}
let made = 0;
async function fixture(script = printing("P")): Promise<Fixture> {
  const dir = join(TEST_DIR, String(++made));
  const root = join(dir, "root");
  const home = join(dir, "home");
  await mkdir(join(root, "desk", "journal"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(deskDir(home), { recursive: true });
  await writeFile(join(root, "desk", "STANDING.md"), STANDING);
  await writeFile(join(root, "scripts", "p.py"), script);
  return { root, home, cwd: join(root, "desk", "journal") };
}

/** Poll until `ok` holds: the ledger and the producer settle on real file I/O and real processes, which no fake clock
 * drives. */
async function waitFor(what: string, ok: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 2));
  }
}

/** A real pause for a check that something did NOT happen: long enough for a ledger append started before it to land. */
const quietly = (ms = 50): Promise<void> => new Promise((done) => { setTimeout(done, ms); });

/* ---------- the order, its session, its firing ---------- */

/** The 2026-11-27 session: the day after Thanksgiving, an early close at 13:00 ET. */
const EARLY: MarketSession = { date: "2026-11-27", open: "2026-11-27T14:30:00Z", close: "2026-11-27T18:00:00Z", early: true };
/** A regular session, 09:30 to 16:00 ET. */
const REGULAR: MarketSession = { date: "2026-11-30", open: "2026-11-30T14:30:00Z", close: "2026-11-30T21:00:00Z", early: false };

/** The pre-close brief: close-30m, builtin:brief, a ten-minute turn. */
const ORDER: StandingOrder = {
  id: "preclose", dir: "desk", file: "STANDING.md", sha256: sha256Hex(STANDING), at: "close-30m",
  anchor: { kind: "close", offsetMin: -30 }, producer: { kind: "builtin", name: "brief" }, wake: true,
  turnDeadlineMs: 600_000, producerDeadlineMs: 300_000, expires: "2026-12-31", enabled: true, armedAt: "2026-11-20T15:00:00.000Z",
};
const KEY = "preclose:2026-11-27";
const ITEM: FiringItem = { key: KEY, order: ORDER, date: "2026-11-27", session: EARLY, anchorMs: Date.parse("2026-11-27T17:30:00Z") };
/** When ITEM's turn is woken: its anchor and four seconds. */
const FIRED = "2026-11-27T17:30:04Z";

/** The order with `over`, and ITEM for it. */
function itemWith(over: Partial<StandingOrder>, item: Partial<FiringItem> = {}): FiringItem {
  const order = { ...ORDER, ...over };
  return { ...ITEM, key: firingKey(order.id, item.date ?? ITEM.date), order, ...item };
}

/** What checkFiring hands a clean ITEM. */
const verifiedFor = (fx: Fixture): Verified => ({ cwd: fx.cwd, standingText: STANDING, standingSha: sha256Hex(STANDING) });

/* ---------- a firing's world ---------- */

interface Rig {
  deps: FiringDeps;
  clock: WallClock;
  agents: FakeAgents;
  sup: FakeSupervise;
  out: ReturnType<typeof recordingDeliver>;
  bus: FakeBus;
  /** The face's log lines. */
  lines: string[];
  /** What resolveRoute was asked for, in order. */
  routes: (string | undefined)[];
  /** What the brief builtin was handed, in order. */
  inputs: ProducerInput[];
}

/** A firing's deps over `fx`: the clock at `start` (FIRED), the brief builtin answering "BRIEF", fake agents on the
 * stub/echo route, the fake supervisor, a delivery answering `deliver` (each text's number by default), the real
 * runner under node. `over` replaces any of them. */
function rig(fx: Fixture, opts: { start?: string; deliver?: DeliverResult; over?: Partial<FiringDeps> } = {}): Rig {
  const clock = new WallClock(opts.start ?? FIRED);
  const agents = fakeAgents();
  const sup = fakeSupervise();
  const out = recordingDeliver(opts.deliver);
  const bus = fakeBus();
  const lines: string[] = [];
  const routes: (string | undefined)[] = [];
  const inputs: ProducerInput[] = [];
  const deps: FiringDeps = {
    home: fx.home,
    root: fx.root,
    clock,
    runScript: defaultProducerRunner(process.execPath, []),
    builtins: {
      brief: async (input) => {
        inputs.push(input);
        return { ok: true, text: "BRIEF" };
      },
    },
    createAgent: (o) => agents.createAgent(o),
    resolveRoute: async (raw) => {
      routes.push(raw);
      return { provider: "stub", model: "echo" };
    },
    on: bus.on,
    supervise: sup.supervise,
    deliver: (text) => out.deliver(text),
    budget: async () => UNSPENT,
    log: (line) => { lines.push(line); },
    ...opts.over,
  };
  return { deps, clock, agents, sup, out, bus, lines, routes, inputs };
}

/** Whether the firing has woken its agent: supervised, and the wake message sent. */
const woken = (r: Rig) => (): boolean => r.sup.calls.length === 1 && (r.agents.agents[0]?.followups.length ?? 0) === 1;

const signal = (): AbortSignal => new AbortController().signal;

/** What one stub attempt records. */
const RECORDED: TurnUsage = { uncachedInputTokens: 1200, outputTokens: 34, cacheReadTokens: 1000, cacheWriteTokens: 0, routes: ["stub/echo"] };
/** The usage the stub reports per call: what the loop logs on an assistant message. */
const USAGE = { inputTokens: 1200, outputTokens: 34, cacheReadTokens: 1000, cacheWriteTokens: 0, totalTokens: 2234 };

/** A turn's end as the supervisor reports it: the first fake agent's turn 1, opened by the schedule, ended. */
function turnEnd(over: Partial<DeskTurnRecord> = {}): DeskTurnRecord {
  return {
    sessionId: "session-fake-1", turn: 1, source: "schedule", outcome: "ended", finalText: "", usage: RECORDED,
    startedAt: "2026-11-27T17:30:05.000Z", wallMs: 355_000, deadlineMs: 600_000, ...over,
  };
}

const UNSPENT: BudgetState = { dailyTokens: 2_000_000, used: { uncachedInputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, total: 10 }, spent: false };
const SPENT: BudgetState = {
  dailyTokens: 2_000_000,
  used: { uncachedInputTokens: 2_000_000, outputTokens: 13_402, cacheReadTokens: 0, cacheWriteTokens: 0, total: 2_013_402 },
  spent: true,
};

/** The firing ledger's records. */
const firings = async (home: string): Promise<FiringRecord[]> => (await readRecords(home, FIRINGS_FILE, isFiringRecord)).records;
/** The desk ledger's events. */
const deskEvents = async (home: string): Promise<DeskEvent[]> => (await readEvents(home)).events;

/** Run ITEM (or `item`) until its wake, end its turn with `end`, and return the finished record and the rig. */
async function fireAndEnd(item: FiringItem, end: Partial<DeskTurnRecord>, opts: Parameters<typeof rig>[1] = {}): Promise<{ r: Rig; fx: Fixture; finished: FinishedRecord | undefined }> {
  const fx = await fixture();
  const r = rig(fx, opts);
  const running = runFiring(r.deps, item, verifiedFor(fx), signal());
  await waitFor("the wake", woken(r));
  r.sup.calls[0].onTurnEnd(turnEnd(end));
  return { r, fx, finished: await running };
}

/* ---------- the wake message ---------- */

test("wakeMessage carries the provenance line, the session, the deadline, the verified text and the producer's output", () => {
  const verified: Verified = { cwd: "/repo/desk/journal", standingText: STANDING, standingSha: sha256Hex(STANDING) };
  const text = wakeMessage({
    item: ITEM, firedAt: Date.parse(FIRED), verified, producer: { spec: "builtin:brief", output: { ok: true, text: "BRIEF" }, chars: 5 },
  });
  const lines = text.split("\n");
  assert.equal(lines[0], "[schedule · preclose · 2026-11-27]");
  assert.equal(lines[1], "Standing order preclose, for the 2026-11-27 session (open 09:30 ET, close 13:00 ET, an early close), fired at 12:30:04 ET. The face cancels this turn at 12:40:04 ET; your final text goes to the operator's phone.");
  const inlined = text.split(" as armed ---\n")[1].split("\n--- end of desk/STANDING.md ---")[0];
  assert.equal(inlined, STANDING);
  assert.equal(sha256Hex(inlined), verified.standingSha, "the hash was taken on the bytes the message carries");
  assert.ok(text.includes("--- producer builtin:brief: ok, 5 characters ---\nBRIEF\n--- end of producer output ---"));
  assert.equal(text, [
    "[schedule · preclose · 2026-11-27]",
    lines[1],
    "",
    `--- desk/STANDING.md, sha256 ${sha256Hex(STANDING)}, as armed ---`,
    STANDING,
    "--- end of desk/STANDING.md ---",
    "",
    "--- producer builtin:brief: ok, 5 characters ---",
    "BRIEF",
    "--- end of producer output ---",
  ].join("\n"), "the whole message, in order");

  /* a regular session, no producer, a strategy's order with a five-minute turn */
  const plain = wakeMessage({
    item: itemWith({ id: "nightly", dir: "strategies/demo", file: "NIGHTLY.md", producer: undefined, turnDeadlineMs: 300_000 }, { date: "2026-11-30", session: REGULAR }),
    firedAt: Date.parse("2026-11-30T20:30:00Z"), verified,
  });
  assert.deepEqual(plain.split("\n").slice(0, 4), [
    "[schedule · nightly · 2026-11-30]",
    "Standing order nightly, for the 2026-11-30 session (open 09:30 ET, close 16:00 ET), fired at 15:30:00 ET. The face cancels this turn at 15:35:00 ET; your final text goes to the operator's phone.",
    "",
    `--- strategies/demo/NIGHTLY.md, sha256 ${sha256Hex(STANDING)}, as armed ---`,
  ]);
  assert.ok(plain.endsWith(`${STANDING}\n--- end of strategies/demo/NIGHTLY.md ---`), "no producer block");

  /* a cut producer, a failed one with its text, and a failed one with none */
  const block = (producer: { spec: string; output: ProducerOutput; chars: number }): string =>
    wakeMessage({ item: ITEM, firedAt: Date.parse(FIRED), verified, producer }).split(`--- end of desk/STANDING.md ---\n\n`)[1];
  assert.equal(block({ spec: "builtin:brief", output: { ok: true, text: "CUT" }, chars: 40_000 }),
    "--- producer builtin:brief: ok, cut to 32,768 of 40,000 characters ---\nCUT\n--- end of producer output ---");
  assert.equal(block({ spec: "scripts/p.py", output: { ok: false, error: "exit 1", text: '{"ok":false}' }, chars: 12 }),
    '--- producer scripts/p.py: failed (exit 1) ---\n{"ok":false}\n--- end of producer output ---');
  assert.equal(block({ spec: "scripts/p.py", output: { ok: false, error: "timed out after 5 min" }, chars: 0 }),
    "--- producer scripts/p.py: failed (timed out after 5 min) ---\n--- end of producer output ---");
});

/* ---------- the checks before a firing ---------- */

test("checkFiring refuses in order: OFF, the budget, the fence, then a changed or missing text and a changed script, each pin named", async () => {
  const fx = await fixture();
  const script = printing("P");
  const order: StandingOrder = { ...ORDER, producer: { kind: "script", script: "scripts/p.py" }, producerSha256: sha256Hex(script) };
  const clock = new WallClock(FIRED);
  let reads = 0;
  let budget: BudgetState = SPENT;
  const deps = { home: fx.home, root: fx.root, clock, budget: async () => { reads += 1; return budget; } };
  const text = join(fx.root, "desk", "STANDING.md");
  const edited = `${STANDING}Also buy NVDA.\n`;

  await writeOff(fx.home, { by: "terminal" }, () => clock.now());
  await writeFile(text, edited);
  assert.deepEqual(await checkFiring(deps, order), { refuse: { reason: "off" } }, "OFF first, and nothing after it is read");
  assert.equal(reads, 0, "a paused firing never reads the budget");

  await clearOff(fx.home, "terminal");
  assert.deepEqual(await checkFiring(deps, order), { refuse: { reason: "budget", state: SPENT } });

  budget = UNSPENT;
  const p = join(fx.root, "scripts", "p.py");
  const gravit = join(fx.root, "desk", "GRAVIT.md");
  await writeFile(p, printing("Q"));
  await writeFile(gravit, "steer\n");
  assert.deepEqual(await checkFiring(deps, order), { refuse: { reason: "fence", detail: "desk/GRAVIT.md" } }, "the fence before any file is read (M9)");
  await rm(gravit);
  assert.deepEqual(await checkFiring(deps, order), { refuse: { reason: "hash", detail: sha256Hex(edited), producerDetail: sha256Hex(printing("Q")) } },
    "the text before the script, the script's moved pin named with it (p2-m11)");
  await writeFile(p, script);
  assert.deepEqual(await checkFiring(deps, order), { refuse: { reason: "hash", detail: sha256Hex(edited) } });
  await rm(text);
  assert.deepEqual(await checkFiring(deps, order), { refuse: { reason: "hash", detail: "missing" } });
  await writeFile(join(fx.root, "copy.md"), STANDING);
  await symlink(join(fx.root, "copy.md"), text);
  assert.deepEqual(await checkFiring(deps, order), { refuse: { reason: "hash", detail: "missing" } }, "a link is never read through - not even to the armed bytes - as arm refuses one");
  await rm(text);
  await writeFile(text, `${STANDING}${"x".repeat(16_384)}`);
  assert.deepEqual(await checkFiring(deps, order), { refuse: { reason: "hash", detail: "oversized" } }, "past the 16,384 bytes arm took: changed, never read whole");
  await writeFile(text, STANDING);

  await writeFile(p, printing("Q"));
  assert.deepEqual(await checkFiring(deps, order), { refuse: { reason: "producer-hash", detail: sha256Hex(printing("Q")) } });
  await rm(p);
  assert.deepEqual(await checkFiring(deps, order), { refuse: { reason: "producer-hash", detail: "missing" } });
  await writeFile(p, script);

  const go = await checkFiring(deps, order);
  assert.deepEqual(go, { go: { cwd: fx.cwd, standingText: STANDING, standingSha: sha256Hex(STANDING), producerSha: sha256Hex(script) } });
  assert.ok("go" in go && sha256Hex(go.go.standingText) === order.sha256, "the text carried is the text hashed");

  /* a pause past its until is no pause; a builtin has no script to check */
  await writeOff(fx.home, { by: "terminal", until: clock.now() - 1_000 }, () => clock.now() - 60_000);
  assert.deepEqual(await checkFiring(deps, ORDER), { go: { cwd: fx.cwd, standingText: STANDING, standingSha: sha256Hex(STANDING) } });
  await clearOff(fx.home, "terminal");

  /* a strategy's order: its text in its own directory, its cwd that directory */
  await mkdir(join(fx.root, "strategies", "demo"), { recursive: true });
  await writeFile(join(fx.root, "strategies", "demo", "NIGHTLY.md"), "nightly\n");
  const strategy: StandingOrder = { ...ORDER, id: "nightly", dir: "strategies/demo", file: "NIGHTLY.md", sha256: sha256Hex("nightly\n") };
  assert.deepEqual(await checkFiring(deps, strategy), { go: { cwd: join(fx.root, "strategies", "demo"), standingText: "nightly\n", standingSha: sha256Hex("nightly\n") } });
});

test("checkFiring fails closed on a pause it cannot read and open on a budget it cannot read", async (t) => {
  const fx = await fixture();
  const lines: string[] = [];
  const clock = new WallClock(FIRED);
  const failing = { home: fx.home, root: fx.root, clock, budget: async (): Promise<BudgetState> => { throw new Error("the ledger is gone"); }, log: (line: string) => { lines.push(line); } };
  assert.deepEqual(await checkFiring(failing, ORDER), { go: verifiedFor(fx) }, "the budget fails open");
  assert.deepEqual(lines, ["gravit-face: desk: the token budget could not be read (the ledger is gone); standing order preclose goes on"]);

  if (process.getuid?.() === 0) {
    t.diagnostic("skipped the unreadable pause: root reads a 000 directory");
    return;
  }
  lines.length = 0;
  await chmod(deskDir(fx.home), 0o000);
  try {
    assert.deepEqual(await checkFiring({ ...failing, budget: async () => UNSPENT }, ORDER), { refuse: { reason: "off" } }, "a switch that cannot be read is a pause");
  } finally {
    await chmod(deskDir(fx.home), 0o700);
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^gravit-face: desk: the pause could not be read \(.+\); standing order preclose is refused as paused$/);
});

/* ---------- a firing ---------- */

test("a firing runs its builtin, wakes a fresh desk agent in its cwd, supervises it with its own deadline, and delivers the final text", async () => {
  const fx = await fixture();
  const r = rig(fx, { deliver: { sent: [11] } });
  const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
  await waitFor("the wake", woken(r));

  assert.deepEqual(r.inputs, [{ order: "preclose", firing: KEY, date: "2026-11-27", dir: "desk", session: { open: EARLY.open, close: EARLY.close, early: true } }]);
  assert.deepEqual(r.routes, [undefined], "the order names no model");
  assert.deepEqual(r.agents.created, [{ cwd: fx.cwd, route: { provider: "stub", model: "echo" } }]);
  const agent = r.agents.agents[0];
  const sup = r.sup.calls[0];
  assert.equal(sup.sessionId, agent.id);
  assert.equal(sup.agent, agent);
  assert.equal(sup.deadlineMs, 600_000, "the order's own deadline");
  assert.equal(sup.clock, r.clock);
  assert.equal(sup.on, r.bus.on);
  assert.equal(sup.deadlineFor, undefined);
  assert.equal(await sup.fence?.(), undefined, "the chain fence over the order's cwd: clean");
  await writeFile(join(fx.root, "desk", "GRAVIT.md"), "steer\n");
  assert.equal(await sup.fence?.(), "desk/GRAVIT.md", "it walks the chain from the root");
  await rm(join(fx.root, "desk", "GRAVIT.md"));

  assert.equal(agent.followups.length, 1, "woken once");
  assert.equal(agent.followups[0].role, "user");
  assert.deepEqual(agent.followups[0].source, { kind: "schedule", order: "preclose", firing: KEY, date: "2026-11-27" });
  assert.equal(agent.text(0), wakeMessage({
    item: ITEM, firedAt: Date.parse(FIRED), verified: verifiedFor(fx), producer: { spec: "builtin:brief", output: { ok: true, text: "BRIEF" }, chars: 5 },
  }));
  assert.deepEqual((await firings(fx.home)).map((f) => f.kind), ["producer", "woke"]);

  /* the turn writes its brief, then ends at 17:36Z */
  await mkdir(join(fx.cwd, "briefs"));
  await writeFile(join(fx.cwd, "briefs", "2026-11-27-preclose.md"), "BRIEF TEXT\n");
  r.clock.set("2026-11-27T17:36:00Z");
  sup.onTurnEnd(turnEnd({ outcome: "ended", finalText: "BRIEF TEXT" }));
  const finished = await running;

  assert.deepEqual(r.out.texts, ["BRIEF TEXT"]);
  const expected: FinishedRecord = {
    t: "2026-11-27T17:36:00.000Z", kind: "finished", key: KEY, order: "preclose", date: "2026-11-27", wallMs: 356_000,
    producer: { spec: "builtin:brief", ok: true },
    turn: { sessionId: "session-fake-1", outcome: "ended", deadlineMs: 600_000, wallMs: 355_000, usage: RECORDED },
    files: [{ path: "briefs/2026-11-27-preclose.md", change: "added" }],
    delivery: { sent: [11] },
    chars: 10,
  };
  assert.deepEqual(finished, expected);
  assert.deepEqual(await firings(fx.home), [
    { t: "2026-11-27T17:30:04.000Z", kind: "producer", key: KEY, producer: "builtin:brief", ok: true, wallMs: 0, chars: 5 },
    { t: "2026-11-27T17:30:04.000Z", kind: "woke", key: KEY, sessionId: "session-fake-1", route: "stub/echo" },
    expected,
  ]);
  assert.deepEqual(await deskEvents(fx.home), [
    { t: "2026-11-27T17:36:00.000Z", kind: "desk-turn", sessionId: "session-fake-1", source: "schedule", turn: 1, outcome: "ended", wallMs: 355_000, usage: RECORDED },
  ], "one desk-turn, as a phone turn is recorded - and no desk-session: a firing never becomes the conversation");
  assert.equal(outcomeOf(expected), "delivered");
  assert.equal(agent.disposed, 1, "the agent disposed once");
  assert.deepEqual(r.sup.disposed, [1], "the supervision ended once");
  assert.deepEqual(agent.cancels, []);
  assert.equal(r.clock.pending(), 0, "the watchdog is cleared");
  assert.equal(r.bus.listeners.size, 0, "the firing's own listener is gone");
  assert.deepEqual(r.lines, []);
});

test("a firing that finishes after its market moment is held back with one line", async () => { // Review Focus 1
  /* close-30m on the 2026-11-27 early close: woken at 17:30:04Z, the Mac sleeps 40 minutes, the turn ends at 18:10:04Z */
  {
    const fx = await fixture();
    const r = rig(fx);
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    r.clock.jump(2_400_000);
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "BRIEF TEXT" }));
    const finished = await running;
    assert.deepEqual(r.out.texts, ["preclose finished after the close; not sent - it describes a market that has moved"]);
    assert.equal(finished?.withheld, "after the close");
    assert.equal(finished?.chars, 10);
    assert.deepEqual(finished?.delivery, { sent: [1] }, "the line's delivery");
    assert.equal(outcomeOf(finished as FinishedRecord), "withheld (after the close)");
    assert.equal(r.clock.pending(), 0, "the watchdog the sleep left overdue is cleared, never fired");
    assert.deepEqual(r.agents.agents[0].cancels, []);
  }
  /* at the close itself it is held back; a millisecond before, it goes */
  for (const [at, sent] of [["2026-11-27T18:00:00.000Z", "preclose finished after the close; not sent - it describes a market that has moved"], ["2026-11-27T17:59:59.999Z", "BRIEF TEXT"]]) {
    const fx = await fixture();
    const r = rig(fx);
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    r.clock.set(at);
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "BRIEF TEXT" }));
    await running;
    assert.deepEqual(r.out.texts, [sent], at);
  }
  /* open-90m: fired at 13:00:04Z, its turn ends at 14:31Z, after the 14:30Z open */
  {
    const item = itemWith({ id: "premarket", at: "open-90m", anchor: { kind: "open", offsetMin: -90 } }, { anchorMs: Date.parse("2026-11-27T13:00:00Z") });
    const fx = await fixture();
    const r = rig(fx, { start: "2026-11-27T13:00:04Z" });
    const running = runFiring(r.deps, item, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    r.clock.set("2026-11-27T14:31:00Z");
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "PREMARKET TEXT" }));
    const finished = await running;
    assert.deepEqual(r.out.texts, ["premarket finished after the open; not sent - it describes a market that has moved"]);
    assert.equal(finished?.withheld, "after the open");
  }
  /* 15:30 - a wall time - has no moment to miss: its text goes even after the early close */
  {
    const item = itemWith({ id: "late", at: "15:30", anchor: { kind: "time", hour: 15, minute: 30 } }, { anchorMs: Date.parse("2026-11-27T20:30:00Z") });
    const fx = await fixture();
    const r = rig(fx, { start: "2026-11-27T20:30:04Z" });
    const running = runFiring(r.deps, item, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    r.clock.set("2026-11-27T20:45:00Z");
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "LATE TEXT" }));
    const finished = await running;
    assert.deepEqual(r.out.texts, ["LATE TEXT"]);
    assert.equal(finished?.withheld, undefined);
  }
});

test("a failed script producer still wakes the model, which is told so, and never sees stderr", async () => {
  const script = 'process.stdout.write(JSON.stringify({ ok: false, error: "no keys" }));\nprocess.stderr.write("SECRET");\nprocess.exitCode = 1;\n';
  const fx = await fixture(script);
  const r = rig(fx);
  const item = itemWith({ producer: { kind: "script", script: "scripts/p.py" }, producerSha256: sha256Hex(script) });
  const running = runFiring(r.deps, item, verifiedFor(fx), signal());
  await waitFor("the wake", woken(r));

  const wake = r.agents.agents[0].text(0) ?? "";
  assert.ok(wake.includes('\n--- producer scripts/p.py: failed (exit 1) ---\n{"ok":false,"error":"no keys"}\n--- end of producer output ---'), wake);
  assert.equal(wake.includes("SECRET"), false, "stderr never reaches the model");
  assert.deepEqual(r.lines, ["gravit-face: desk: producer scripts/p.py wrote to stderr: SECRET"], "it is one face line");
  assert.deepEqual((await firings(fx.home))[0], {
    t: "2026-11-27T17:30:04.000Z", kind: "producer", key: KEY, producer: "scripts/p.py", ok: false, error: "exit 1", code: 1, wallMs: 0, chars: 30,
  });

  r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "the brief is unavailable: no keys" }));
  const finished = await running;
  assert.deepEqual(finished?.producer, { spec: "scripts/p.py", ok: false, error: "exit 1" });
  assert.deepEqual(r.out.texts, ["the brief is unavailable: no keys"]);
  /* the private copy ran from <desk dir>/run - made 0700, left empty - never from scripts/ or the temp areas */
  const runBase = join(deskDir(fx.home), "run");
  assert.equal((await stat(runBase)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(runBase), []);
});

test("a script changed after the check fails its producer, unrun, and the turn is told", async () => { // ruling 1's backstop
  const armed = printing("ARMED");
  const swapped = 'require("fs").writeFileSync(require("path").join(process.env.GRAVIT_ROOT, "ran"), "x");\nprocess.stdout.write("SWAPPED");\n';
  for (const wake of [true, false]) {
    const fx = await fixture(armed);
    const r = rig(fx);
    const item = itemWith({ producer: { kind: "script", script: "scripts/p.py" }, producerSha256: sha256Hex(armed), wake });
    await writeFile(join(fx.root, "scripts", "p.py"), swapped);
    const running = runFiring(r.deps, item, verifiedFor(fx), signal());
    if (wake) {
      await waitFor("the wake", woken(r));
      assert.ok(r.agents.agents[0].text(0)?.endsWith("\n--- producer scripts/p.py: failed (scripts/p.py changed since arming) ---\n--- end of producer output ---"));
      r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "TEXT" }));
    }
    const finished = await running;
    await assert.rejects(stat(join(fx.root, "ran")), { code: "ENOENT" }, "the swapped bytes never ran");
    assert.deepEqual((await firings(fx.home))[0], {
      t: "2026-11-27T17:30:04.000Z", kind: "producer", key: KEY, producer: "scripts/p.py", ok: false, error: "scripts/p.py changed since arming", code: null, wallMs: 0, chars: 0,
    });
    assert.deepEqual(finished?.producer, { spec: "scripts/p.py", ok: false, error: "scripts/p.py changed since arming" });
    assert.deepEqual(r.out.texts, wake ? ["TEXT"] : ["preclose · 2026-11-27 producer scripts/p.py failed (scripts/p.py changed since arming); nothing was woken"]);
  }
});

test("any producer's text is capped before it is quoted", async () => {
  const long = "x".repeat(40_000);
  /* a builtin */
  {
    const fx = await fixture();
    const r = rig(fx, { over: { builtins: { brief: async () => ({ ok: true, text: long }) } } });
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    const wake = r.agents.agents[0].text(0) ?? "";
    const block = wake.split("--- end of desk/STANDING.md ---\n\n")[1];
    const [header, quoted] = block.split("\n", 2);
    assert.equal(header, "--- producer builtin:brief: ok, cut to 32,768 of 40,000 characters ---");
    assert.equal(quoted, "x".repeat(PRODUCER_TEXT_MAX), "32,768 characters, then the cut's own line");
    assert.ok(block.endsWith("\n…[cut: 7232 more characters]\n--- end of producer output ---"));
    const producer = (await firings(fx.home))[0];
    assert.equal(producer.kind === "producer" && producer.chars, 40_000, "counted before the cut");
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "TEXT" }));
    await running;
  }
  /* a script */
  {
    const fx = await fixture(printing("y".repeat(40_000)));
    const r = rig(fx);
    const item = itemWith({ producer: { kind: "script", script: "scripts/p.py" }, producerSha256: sha256Hex(printing("y".repeat(40_000))) });
    const running = runFiring(r.deps, item, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    const wake = r.agents.agents[0].text(0) ?? "";
    assert.ok(wake.includes("\n--- producer scripts/p.py: ok, cut to 32,768 of 40,000 characters ---\n"));
    assert.ok(wake.includes("\n…[cut: 7232 more characters]\n--- end of producer output ---"));
    assert.equal(wake.includes("y".repeat(PRODUCER_TEXT_MAX + 1)), false);
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "TEXT" }));
    await running;
  }
});

test("a builtin past its producer deadline is stopped, and the turn is told it timed out", async () => {
  const fx = await fixture();
  let stopped: AbortSignal | undefined;
  const r = rig(fx, {
    over: {
      builtins: {
        brief: (_input, sig) => new Promise<ProducerOutput>((done) => {
          stopped = sig;
          sig.addEventListener("abort", () => { done({ ok: false, error: "stopped: aborted" }); });
        }),
      },
    },
  });
  const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
  await waitFor("the builtin", () => stopped !== undefined);
  await r.clock.advance(299_999);
  assert.equal(stopped?.aborted, false, "not before its deadline");
  await r.clock.advance(1);
  assert.equal(stopped?.aborted, true, "its own signal aborts at the deadline");
  await waitFor("the wake", woken(r));
  assert.ok(r.agents.agents[0].text(0)?.endsWith("\n--- producer builtin:brief: failed (timed out after 5 min) ---\n--- end of producer output ---"));
  assert.deepEqual((await firings(fx.home))[0], {
    t: "2026-11-27T17:35:04.000Z", kind: "producer", key: KEY, producer: "builtin:brief", ok: false, error: "timed out after 5 min", timedOut: true, wallMs: 300_000, chars: 0,
  });
  r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "TEXT" }));
  await running;
});

test("wake: false runs only the producer: no session, nothing sent on success, one line on failure", async () => {
  const item = itemWith({ id: "nightly", wake: false });
  {
    const fx = await fixture();
    const r = rig(fx);
    const finished = await runFiring(r.deps, item, verifiedFor(fx), signal());
    assert.deepEqual(r.agents.created, [], "no session");
    assert.deepEqual(r.out.texts, [], "nothing sent");
    const expected: FinishedRecord = {
      t: "2026-11-27T17:30:04.000Z", kind: "finished", key: "nightly:2026-11-27", order: "nightly", date: "2026-11-27", wallMs: 0,
      producer: { spec: "builtin:brief", ok: true },
    };
    assert.deepEqual(finished, expected);
    assert.deepEqual((await firings(fx.home)).map((f) => f.kind), ["producer", "finished"]);
    assert.equal(outcomeOf(expected), "producer ran");
  }
  {
    const fx = await fixture();
    const r = rig(fx, { over: { builtins: { brief: async () => ({ ok: false, error: "quotes unavailable: busy" }) } } });
    const finished = await runFiring(r.deps, item, verifiedFor(fx), signal());
    assert.deepEqual(r.agents.created, []);
    assert.deepEqual(r.out.texts, ["nightly · 2026-11-27 producer builtin:brief failed (quotes unavailable: busy); nothing was woken"]);
    assert.deepEqual(finished?.producer, { spec: "builtin:brief", ok: false, error: "quotes unavailable: busy" });
    assert.deepEqual(finished?.delivery, { sent: [1] });
    assert.equal(finished?.turn, undefined);
    assert.equal(outcomeOf(finished as FinishedRecord), "producer failed");
    assert.deepEqual(await deskEvents(fx.home), [], "no turn, no desk-turn");
  }
  /* a builtin this face does not have, or one that rejects, is a failed producer too; a delivery that rejects is one
   * face line and an undelivered answer */
  for (const [builtins, error] of [
    [{}, "builtin:brief is not available in this face"],
    [{ brief: async (): Promise<ProducerOutput> => { throw new Error("the quote source fell over"); } }, "the quote source fell over"],
  ] as const) {
    const fx = await fixture();
    const r = rig(fx, { over: { builtins, deliver: async () => { throw new Error("the outlet fell over"); } } });
    const finished = await runFiring(r.deps, item, verifiedFor(fx), signal());
    assert.deepEqual(finished?.producer, { spec: "builtin:brief", ok: false, error });
    assert.deepEqual(finished?.delivery, { undelivered: "send failed: the outlet fell over" });
    assert.deepEqual(r.lines, ["gravit-face: desk: firing nightly:2026-11-27 could not deliver its message: the outlet fell over"]);
  }
});

test("deadline, refusal at turn start, the watchdog, a failed session: one line each", async () => {
  /* timed out with nothing said */
  {
    const { r, fx, finished } = await fireAndEnd(ITEM, { outcome: "timed-out", wallMs: 600_000 });
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 timed out after 10 min; a card or a long tool was pending"]);
    assert.equal(finished?.turn?.outcome, "timed-out");
    assert.deepEqual((await deskEvents(fx.home)).map((e) => e.kind === "desk-turn" && [e.outcome, e.usage]), [["timed-out", RECORDED]]);
  }
  /* refused at its turn's start: the fence's line, never the text a steered turn wrote, and no second line for it */
  {
    const fx = await fixture();
    const r = rig(fx);
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    await mkdir(join(fx.cwd, ".git"));
    r.sup.calls[0].onTurnEnd(turnEnd({ outcome: "refused", violation: "desk/journal/.git", finalText: "STEERED" }));
    const finished = await running;
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 refused: desk/journal/.git exists; it would steer every desk turn. Remove it."]);
    assert.equal(finished?.turn?.outcome, "refused");
    assert.equal(finished?.violation, "desk/journal/.git", "still there after the turn");
    assert.equal(outcomeOf(finished as FinishedRecord), "refused: fence");
    assert.deepEqual(await deskEvents(fx.home), [{ t: "2026-11-27T17:30:04.000Z", kind: "desk-refused", reason: "fence", path: "desk/journal/.git" }], "as the conversation records a refused turn");
  }
  /* no turn by the deadline and the slack: the watchdog cancels, and nothing ran */
  {
    const fx = await fixture();
    const r = rig(fx);
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    const agent = r.agents.agents[0];
    await r.clock.advance(600_000 + FIRING_SLACK_MS - 1);
    assert.deepEqual(agent.cancels, [], "not before the deadline and the slack");
    await r.clock.advance(1);
    const finished = await running;
    assert.deepEqual(agent.cancels.map((c) => c[0]), [{ kind: "hook", reason: "desk deadline" }]);
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 never started a turn; nothing ran"]);
    assert.deepEqual(finished?.turn, { sessionId: "session-fake-1", outcome: "no-turn", deadlineMs: 600_000 });
    assert.equal(outcomeOf(finished as FinishedRecord), "never started");
    assert.deepEqual(await deskEvents(fx.home), [], "no turn ended: nothing to record");
    assert.equal(agent.disposed, 1);
    assert.deepEqual(r.sup.disposed, [1]);
    /* once the supervision has ended no report can come (the real supervisor is gone); one that did changes nothing */
    r.sup.calls[0].onTurnEnd(turnEnd({ outcome: "cancelled", cancel: "desk deadline", finalText: "LATE" }));
    await quietly();
    assert.equal(r.out.texts.length, 1);
    assert.deepEqual(await deskEvents(fx.home), []);
  }
  /* a turn that started and never ended: the watchdog reads it timed out */
  {
    const fx = await fixture();
    const r = rig(fx);
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    r.bus.emit("session-other", "turn/start", { turn: 1 });
    r.bus.emit("session-fake-1", "turn/start", { turn: 1 });
    await r.clock.advance(660_000);
    const finished = await running;
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 timed out after 10 min; a card or a long tool was pending"]);
    assert.deepEqual(finished?.turn, { sessionId: "session-fake-1", outcome: "timed-out", deadlineMs: 600_000 });
  }
  /* a session that cannot be made */
  {
    const fx = await fixture();
    const r = rig(fx);
    r.agents.failCreate = "boom";
    const finished = await runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 could not run: boom"]);
    assert.deepEqual(finished?.turn, { outcome: "error", deadlineMs: 600_000, error: "boom" });
    assert.equal(outcomeOf(finished as FinishedRecord), "failed");
    assert.deepEqual((await firings(fx.home)).map((f) => f.kind), ["producer", "finished"], "no woke");
    assert.deepEqual(r.lines, ["gravit-face: desk: firing preclose:2026-11-27 could not run: boom"]);
  }
  /* a create that throws rather than rejects, and a route that cannot be had: the same line */
  for (const over of [
    { createAgent: (): never => { throw new Error("sync boom"); } },
    { resolveRoute: async (): Promise<never> => { throw new Error("no route"); } },
  ] satisfies Partial<FiringDeps>[]) {
    const fx = await fixture();
    const r = rig(fx, { over });
    const finished = await runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    const reason = "createAgent" in over ? "sync boom" : "no route";
    assert.deepEqual(r.out.texts, [`preclose · 2026-11-27 could not run: ${reason}`]);
    assert.deepEqual(finished?.turn, { outcome: "error", deadlineMs: 600_000, error: reason });
  }
  /* a session that cannot be woken */
  {
    const fx = await fixture();
    const r = rig(fx);
    r.agents.failFollowup = "the agent is closed";
    const finished = await runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 could not run: the agent is closed"]);
    assert.deepEqual(finished?.turn, { sessionId: "session-fake-1", outcome: "error", deadlineMs: 600_000, error: "the agent is closed" });
    assert.equal(r.agents.agents[0].disposed, 1);
    assert.deepEqual(r.sup.disposed, [1]);
    assert.equal(r.clock.pending(), 0, "no watchdog for a wake that never went");
  }
  /* ended, and said nothing */
  {
    const { r, finished } = await fireAndEnd(ITEM, { outcome: "ended", finalText: "" });
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 ended with no text"]);
    assert.equal(finished?.chars, undefined);
  }
  /* the model call failed with nothing said */
  {
    const { r, fx, finished } = await fireAndEnd(ITEM, { outcome: "failed", error: "429 rate limit" });
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 could not answer: 429 rate limit; nothing was done"]);
    assert.deepEqual(finished?.turn, { sessionId: "session-fake-1", outcome: "failed", deadlineMs: 600_000, wallMs: 355_000, usage: RECORDED, error: "429 rate limit" });
    assert.deepEqual(await deskEvents(fx.home), [
      { t: "2026-11-27T17:30:04.000Z", kind: "desk-turn", sessionId: "session-fake-1", source: "schedule", turn: 1, outcome: "failed", wallMs: 355_000, usage: RECORDED, error: "429 rate limit" },
    ]);
  }
});

test("a cancelled turn is recorded with its tokens and its cause; a cut answer carries its cut-off line", async () => {
  /* cancelled with nothing said */
  {
    const { r, fx, finished } = await fireAndEnd(ITEM, { outcome: "cancelled", cancel: "stopped in the browser" });
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 was cancelled (stopped in the browser); nothing more will be said"]);
    assert.deepEqual(finished?.turn, { sessionId: "session-fake-1", outcome: "cancelled", cancel: "stopped in the browser", deadlineMs: 600_000, wallMs: 355_000, usage: RECORDED });
    assert.equal(outcomeOf(finished as FinishedRecord), "cancelled");
    assert.deepEqual(await deskEvents(fx.home), [
      { t: "2026-11-27T17:30:04.000Z", kind: "desk-turn", sessionId: "session-fake-1", source: "schedule", turn: 1, outcome: "cancelled", wallMs: 355_000, usage: RECORDED, cancel: "stopped in the browser" },
    ], "a cancelled firing's tokens reach the ledger and the budget");
  }
  /* the real supervisor: an answer the browser's stop cut mid-stream, then one the deadline cut */
  for (const cut of ["browser", "deadline"] as const) {
    const fx = await fixture();
    const r = rig(fx, { over: { supervise: undefined } });
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    await waitFor("the wake", () => (r.agents.agents[0]?.followups.length ?? 0) === 1);
    const agent = r.agents.agents[0];
    const say = (type: string, data: object): void => { r.bus.emit(agent.id, type, data); };
    say("turn/start", { turn: 1 });
    say("step/start", { turn: 1, step: 1 });
    say("user/message", agent.followups[0]);
    say("assistant/message", {
      turn: 1, step: 1, usage: USAGE, interrupted: true,
      message: { id: "a-1", role: "assistant", content: [{ type: "text", text: "SPY -0.4%, QQQ" }], source: { kind: "model", provider: "stub", model: "echo" } },
    });
    say("step/end", { turn: 1, step: 1 });
    if (cut === "deadline") {
      await r.clock.advance(600_000);
      assert.deepEqual(agent.cancels.map((c) => c[0]), [{ kind: "hook", reason: "desk deadline" }], "the supervisor's own deadline, the order's");
    }
    say("turn/end", { turn: 1, reason: { kind: "aborted", reason: cut === "browser" ? { kind: "user" } : { kind: "hook", reason: "desk deadline" } } });
    const finished = await running;
    const by = cut === "browser" ? "stopped in the browser" : "timed out after 10 min";
    assert.deepEqual(r.out.texts, [`SPY -0.4%, QQQ\n(cut off: ${by})`]);
    assert.equal(finished?.turn?.outcome, cut === "browser" ? "cancelled" : "timed-out");
    const events = await deskEvents(fx.home);
    assert.equal(events.length, 1);
    const event = events[0];
    assert.ok(event.kind === "desk-turn");
    assert.equal(event.source, "schedule", "the wake message's own source");
    assert.deepEqual(event.usage, RECORDED);
    assert.equal(event.cancel, cut === "browser" ? "stopped in the browser" : undefined);
    assert.equal(r.clock.pending(), 0);
    assert.equal(r.bus.listeners.size, 0, "the supervisor's listener and the firing's are gone");
  }
});

test("OFF set during the turn holds the text back and records why", async () => {
  const fx = await fixture();
  const sent: string[] = [];
  const unused = (): never => { throw new Error("a firing's delivery opens no conversation"); };
  const ctx: DeskSessionCtxLike = {
    agents: { get: unused, create: unused, resume: unused },
    agentPresets: { mount: unused },
    permissionPresets: { set: unused, current: unused },
  };
  const r0 = rig(fx);
  const conversation = createDeskConversation({
    session: { ctx, root: fx.root, home: fx.home, route: { provider: "stub", model: "echo" }, installModelSelection: () => () => {}, now: () => r0.clock.now() },
    on: r0.bus.on,
    clock: r0.clock,
    log: (line) => { r0.lines.push(line); },
  });
  conversation.setOutlet({ send: async (text) => { sent.push(text); return { sent: [1] }; } });
  const r = { ...r0, deps: { ...r0.deps, deliver: (text: string) => conversation.deliver(text) } };
  const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
  await waitFor("the wake", woken(r));
  await writeOff(fx.home, { by: "telegram" }, () => r.clock.now());
  r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "BRIEF TEXT" }));
  const finished = await running;
  assert.deepEqual(finished?.delivery, { undelivered: "paused" });
  assert.deepEqual(sent, [], "the outlet was never called");
  assert.equal(outcomeOf(finished as FinishedRecord), "undelivered (paused)");
  assert.deepEqual((await firings(fx.home)).at(-1), finished, "and the ledger says so");
});

test("a turn that leaves a fence violation is reported once", async () => {
  const fx = await fixture();
  const r = rig(fx);
  const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
  await waitFor("the wake", woken(r));
  /* another session plants it while the turn runs: a desk turn's own write of it is denied by the write guard */
  await writeFile(join(fx.cwd, "GRAVIT.md"), "steer every desk turn\n");
  r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "BRIEF TEXT" }));
  const finished = await running;
  assert.equal(finished?.violation, "desk/journal/GRAVIT.md");
  assert.deepEqual(finished?.files, [{ path: "GRAVIT.md", change: "added" }]);
  assert.deepEqual(r.out.texts, [
    "BRIEF TEXT",
    "preclose · 2026-11-27 left desk/journal/GRAVIT.md behind; every desk turn is refused until it is removed",
  ], "the text, then the line, once");
  assert.equal(outcomeOf(finished as FinishedRecord), "delivered");
  assert.deepEqual((await firings(fx.home)).at(-1), finished);
});

test("a turn that changes more files than the record holds records the first 200, in order, and says so", async () => {
  const fx = await fixture();
  const r = rig(fx);
  const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
  await waitFor("the wake", woken(r));
  for (let i = 0; i < FILES_RECORD_MAX + 1; i++) await writeFile(join(fx.cwd, `n${String(i).padStart(3, "0")}.md`), "x");
  r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "TEXT" }));
  const finished = await running;
  assert.equal(finished?.files?.length, FILES_RECORD_MAX);
  assert.deepEqual(finished?.files?.[0], { path: "n000.md", change: "added" });
  assert.deepEqual(finished?.files?.at(-1), { path: "n199.md", change: "added" });
  assert.equal(finished?.filesTruncated, true);
});

test("the model route: the order's model when given, else the default route", async () => {
  const lines: string[] = [];
  const log = (line: string): void => { lines.push(line); };
  const ctx = {
    agentDefaultModel: { currentSelection: () => ({ provider: "stub", model: "echo", reasoningEffort: "high" as const }) },
    llm: {
      resolveCallConfig: async (c: { provider: string; model: string }): Promise<unknown> => {
        if (c.provider === "deepseek-official") return {};
        throw new Error(`no adapter serves ${c.provider}`);
      },
    },
  };
  assert.deepEqual(await resolveFiringRoute(ctx, undefined, log), { provider: "stub", model: "echo" }, "the face's default, not the desk's flash");
  assert.deepEqual(await resolveFiringRoute(ctx, "deepseek-official/deepseek-pro", log), { provider: "deepseek-official", model: "deepseek-pro" });
  assert.deepEqual(lines, []);
  assert.deepEqual(await resolveFiringRoute(ctx, "nowhere/model", log), { provider: "stub", model: "echo" });
  assert.deepEqual(lines, ["gravit-face: desk: model route nowhere/model is not usable (no adapter serves nowhere); the desk uses the default stub/echo"]);

  /* a firing asks for its order's model and runs on the answer */
  for (const model of ["deepseek-official/deepseek-pro", undefined]) {
    const item = itemWith({ model });
    const fx = await fixture();
    const r = rig(fx, { over: { resolveRoute: (raw) => resolveFiringRoute(ctx, raw, log) } });
    const running = runFiring(r.deps, item, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    const route = model === undefined ? { provider: "stub", model: "echo" } : { provider: "deepseek-official", model: "deepseek-pro" };
    assert.deepEqual(r.agents.created, [{ cwd: fx.cwd, route }]);
    const woke = (await firings(fx.home)).find((f) => f.kind === "woke");
    assert.equal(woke?.kind === "woke" && woke.route, `${route.provider}/${route.model}`);
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "TEXT" }));
    await running;
  }
});

test("an aborted firing stops recording and delivering", async () => {
  /* after the wake: the turn is cancelled as a shutdown, nothing more is recorded or sent, the session is let go */
  {
    const fx = await fixture();
    const r = rig(fx);
    const controller = new AbortController();
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), controller.signal);
    await waitFor("the wake", woken(r));
    controller.abort();
    assert.equal(await running, undefined);
    const agent = r.agents.agents[0];
    assert.deepEqual(agent.cancels, [[{ kind: "hook", reason: "shutdown" }]]);
    assert.equal(agent.disposed, 1);
    assert.deepEqual(r.sup.disposed, [1]);
    /* once the supervision has ended no report can come (the real supervisor is gone); one that did changes nothing */
    r.sup.calls[0].onTurnEnd(turnEnd({ outcome: "cancelled", cancel: "shutdown", finalText: "LATE" }));
    await r.clock.advance(3_600_000);
    await quietly();
    assert.deepEqual(r.out.texts, []);
    assert.deepEqual((await firings(fx.home)).map((f) => f.kind), ["producer", "woke"], "no finished: the next boot reads it as interrupted");
    assert.deepEqual(await deskEvents(fx.home), []);
    assert.equal(r.clock.pending(), 0);
  }
  /* during the producer: the builtin is stopped, and no session is made */
  {
    const fx = await fixture();
    let stopped: AbortSignal | undefined;
    const r = rig(fx, {
      over: {
        builtins: {
          brief: (_input, sig) => new Promise<ProducerOutput>((done) => {
            stopped = sig;
            sig.addEventListener("abort", () => { done({ ok: false, error: "stopped: shutdown" }); });
          }),
        },
      },
    });
    const controller = new AbortController();
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), controller.signal);
    await waitFor("the builtin", () => stopped !== undefined);
    controller.abort();
    assert.equal(await running, undefined);
    assert.equal(stopped?.aborted, true);
    await r.clock.advance(600_000);
    assert.deepEqual(r.agents.created, []);
    assert.deepEqual(await firings(fx.home), []);
    assert.deepEqual(r.out.texts, []);
  }
  /* aborted before it began: nothing at all */
  {
    const fx = await fixture();
    const r = rig(fx);
    const controller = new AbortController();
    controller.abort();
    assert.equal(await runFiring(r.deps, ITEM, verifiedFor(fx), controller.signal), undefined);
    assert.deepEqual(r.inputs, []);
    assert.deepEqual(await firings(fx.home), []);
  }
  /* while its session is being made: the firing ends at once, and the session that comes later is let go */
  {
    const fx = await fixture();
    const late = fakeAgents();
    let make: (() => void) | undefined;
    const r = rig(fx, {
      over: {
        createAgent: (o) => new Promise((done) => {
          make = () => { done(late.createAgent(o)); };
        }),
      },
    });
    const controller = new AbortController();
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), controller.signal);
    await waitFor("the create", () => make !== undefined);
    controller.abort();
    assert.equal(await running, undefined);
    make?.();
    await waitFor("the late session's dispose", () => late.agents[0]?.disposed === 1);
    assert.deepEqual(late.agents[0].followups, [], "never woken");
    assert.deepEqual((await firings(fx.home)).map((f) => f.kind), ["producer"], "no woke, no finished");
    assert.deepEqual(r.out.texts, []);
  }
  /* during its delivery: no finished, nothing more sent - the turn it ran is still counted */
  {
    const fx = await fixture();
    const texts: string[] = [];
    let unblock: (() => void) | undefined;
    const r = rig(fx, {
      over: {
        deliver: (text) => {
          texts.push(text);
          return new Promise<DeliverResult>((done) => {
            unblock = () => { done({ sent: [1] }); };
          });
        },
      },
    });
    const controller = new AbortController();
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), controller.signal);
    await waitFor("the wake", woken(r));
    await writeFile(join(fx.cwd, "GRAVIT.md"), "steer\n"); // a violation: a left-behind line would follow the text
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "BRIEF TEXT" }));
    await waitFor("the delivery", () => unblock !== undefined);
    controller.abort();
    assert.equal(await running, undefined);
    unblock?.();
    await r.clock.flush();
    assert.deepEqual(texts, ["BRIEF TEXT"], "no left-behind line");
    assert.deepEqual((await firings(fx.home)).map((f) => f.kind), ["producer", "woke"], "no finished: the next boot reads it as interrupted");
    assert.deepEqual((await deskEvents(fx.home)).map((e) => e.kind), ["desk-turn"]);
    assert.equal(r.agents.agents[0].disposed, 1);
  }
  /* while its finished record is written: the record stays, and the left-behind line is not sent */
  {
    const fx = await fixture();
    const controller = new AbortController();
    const texts: string[] = [];
    const r = rig(fx, {
      over: {
        deliver: async (text) => {
          texts.push(text);
          setImmediate(() => { controller.abort(); }); // after this delivery's answer, while finished goes to the ledger
          return { sent: [texts.length] };
        },
      },
    });
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), controller.signal);
    await waitFor("the wake", woken(r));
    await writeFile(join(fx.cwd, "GRAVIT.md"), "steer\n");
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "BRIEF TEXT" }));
    assert.equal(await running, undefined);
    assert.deepEqual(texts, ["BRIEF TEXT"], "no left-behind line once aborted");
    const last = (await firings(fx.home)).at(-1);
    assert.equal(last?.kind, "finished", "the record written as the abort came stays");
  }
  /* during the left-behind line: the firing ends at once */
  {
    const fx = await fixture();
    const controller = new AbortController();
    const texts: string[] = [];
    let unblock: (() => void) | undefined;
    const r = rig(fx, {
      over: {
        deliver: (text) => {
          texts.push(text);
          if (texts.length === 1) return Promise.resolve({ sent: [1] });
          return new Promise<DeliverResult>((done) => { unblock = () => { done({ sent: [2] }); }; });
        },
      },
    });
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), controller.signal);
    await waitFor("the wake", woken(r));
    await writeFile(join(fx.cwd, "GRAVIT.md"), "steer\n");
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "BRIEF TEXT" }));
    await waitFor("the left-behind line", () => unblock !== undefined);
    controller.abort();
    assert.equal(await running, undefined);
    unblock?.();
    assert.equal(texts.length, 2);
    assert.equal(r.agents.agents[0].disposed, 1);
  }
  /* a turn whose end comes in the same tick as the abort: counted, and nothing more */
  {
    const fx = await fixture();
    const r = rig(fx);
    const controller = new AbortController();
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), controller.signal);
    await waitFor("the wake", woken(r));
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "BRIEF TEXT" }));
    controller.abort();
    assert.equal(await running, undefined);
    assert.deepEqual(r.out.texts, []);
    assert.deepEqual((await firings(fx.home)).map((f) => f.kind), ["producer", "woke"]);
    assert.deepEqual((await deskEvents(fx.home)).map((e) => e.kind === "desk-turn" && [e.turn, e.outcome, e.usage]), [[1, "ended", RECORDED]]);
  }
});

test("a firing counts every turn it outlives - after the watchdog, an abort or its own turn - in events.jsonl alone", async () => {
  /* after the watchdog: the hung turn ends while its session is let go, the supervision still installed */
  {
    const fx = await fixture();
    const r = rig(fx);
    let supervisedAtDispose: number[] | undefined;
    r.agents.onDispose = () => {
      supervisedAtDispose = [...r.sup.disposed];
      r.sup.calls[0].onTurnEnd(turnEnd({ outcome: "timed-out", wallMs: 660_500 }));
    };
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    r.bus.emit("session-fake-1", "turn/start", { turn: 1 });
    await r.clock.advance(600_000 + FIRING_SLACK_MS);
    const finished = await running;
    assert.deepEqual(finished?.turn, { sessionId: "session-fake-1", outcome: "timed-out", deadlineMs: 600_000 });
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 timed out after 10 min; a card or a long tool was pending"], "no line for the late report");
    assert.deepEqual((await firings(fx.home)).map((f) => f.kind), ["producer", "woke", "finished"], "no second finished");
    assert.deepEqual(await deskEvents(fx.home), [
      { t: "2026-11-27T17:41:04.000Z", kind: "desk-turn", sessionId: "session-fake-1", source: "schedule", turn: 1, outcome: "timed-out", wallMs: 660_500, usage: RECORDED },
    ], "its tokens reach the budget");
    assert.deepEqual(supervisedAtDispose, [0], "the supervision outlasts the dispose");
    assert.deepEqual(r.sup.disposed, [1]);
    assert.deepEqual(r.lines, ["gravit-face: desk: firing preclose:2026-11-27 saw no end to its turn in 11 min; the watchdog cancels it"]);
  }
  /* after an abort: the cut turn's record comes while the session is let go */
  {
    const fx = await fixture();
    const r = rig(fx);
    r.agents.onDispose = () => {
      r.sup.calls[0].onTurnEnd(turnEnd({ outcome: "cancelled", cancel: "shutdown", finalText: "SPY -0.4%" }));
    };
    const controller = new AbortController();
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), controller.signal);
    await waitFor("the wake", woken(r));
    controller.abort();
    assert.equal(await running, undefined);
    assert.deepEqual(r.out.texts, [], "nothing sent");
    assert.deepEqual((await firings(fx.home)).map((f) => f.kind), ["producer", "woke"], "still interrupted for the next boot");
    assert.deepEqual(await deskEvents(fx.home), [
      { t: "2026-11-27T17:30:04.000Z", kind: "desk-turn", sessionId: "session-fake-1", source: "schedule", turn: 1, outcome: "cancelled", wallMs: 355_000, usage: RECORDED, cancel: "shutdown" },
    ]);
  }
  /* after its own turn: a browser post on its session answered while the firing's text is delivered; a refused one too */
  {
    const fx = await fixture();
    const texts: string[] = [];
    const r: Rig = rig(fx, {
      over: {
        deliver: async (text) => {
          texts.push(text);
          r.sup.calls[0].onTurnEnd(turnEnd({ turn: 2, source: "user", finalText: "a browser answer", wallMs: 2_000 }));
          r.sup.calls[0].onTurnEnd(turnEnd({ turn: 3, source: "user", outcome: "refused", violation: "desk/journal/.git" }));
          return { sent: [1] };
        },
      },
    });
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    await waitFor("the wake", woken(r));
    r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "BRIEF TEXT" }));
    const finished = await running;
    assert.equal(finished?.turn?.outcome, "ended");
    assert.deepEqual(texts, ["BRIEF TEXT"], "the browser's answers are its own");
    assert.deepEqual((await deskEvents(fx.home)).map((e) => (e.kind === "desk-turn" ? [e.kind, e.turn, e.source] : [e.kind])), [
      ["desk-turn", 1, "schedule"], ["desk-turn", 2, "user"], ["desk-refused"],
    ], "in turn order");
    assert.equal((await firings(fx.home)).filter((f) => f.kind === "finished").length, 1);
  }
});

test("a session whose dispose hangs holds the firing FIRING_DISPOSE_MS, then it ends with one line", async () => {
  const fx = await fixture();
  const r = rig(fx);
  let release: (() => void) | undefined;
  r.agents.onDispose = () => new Promise<void>((done) => { release = done; });
  let settled = false;
  const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal()).finally(() => { settled = true; });
  await waitFor("the wake", woken(r));
  r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "BRIEF TEXT" }));
  await waitFor("the dispose", () => r.agents.agents[0].disposed === 1);
  assert.equal(r.clock.pending(), 1, "the bound, and nothing else");
  await r.clock.advance(FIRING_DISPOSE_MS - 1);
  assert.equal(settled, false, "not before the bound");
  await r.clock.advance(1);
  const finished = await running;
  assert.equal(FIRING_DISPOSE_MS, 10_000);
  assert.equal(finished?.turn?.outcome, "ended", "everything before the dispose was done");
  assert.deepEqual(r.out.texts, ["BRIEF TEXT"]);
  assert.deepEqual(r.lines, ["gravit-face: desk: firing preclose:2026-11-27 could not dispose its session session-fake-1 in 10 s; it ends, and the dispose goes on alone"]);
  assert.deepEqual(r.sup.disposed, [0], "the supervision stays while the dispose goes on");
  assert.equal(r.clock.pending(), 0);
  /* a turn the lingering session reports is still counted; when the dispose ends at last, so does the supervision */
  r.sup.calls[0].onTurnEnd(turnEnd({ turn: 2, source: "user", finalText: "late", wallMs: 1_000 }));
  await waitFor("the late turn's event", async () => (await deskEvents(fx.home)).length === 2);
  release?.();
  await waitFor("the supervision's end", () => r.sup.disposed[0] === 1);
  assert.deepEqual(r.out.texts, ["BRIEF TEXT"], "nothing more sent");
});

test("the wake carries the bytes checkFiring verified, never the file as it is when the turn starts", async () => {
  const fx = await fixture();
  const r = rig(fx);
  const checked = await checkFiring(r.deps, ORDER);
  assert.ok("go" in checked);
  await writeFile(join(fx.root, "desk", "STANDING.md"), "Buy NVDA at the open.\n");
  const running = runFiring(r.deps, ITEM, checked.go, signal());
  await waitFor("the wake", woken(r));
  const wake = r.agents.agents[0].text(0) ?? "";
  assert.ok(wake.includes(`, as armed ---\n${STANDING}\n--- end of desk/STANDING.md ---`));
  assert.equal(wake.includes("Buy NVDA"), false);
  r.sup.calls[0].onTurnEnd(turnEnd({ finalText: "TEXT" }));
  await running;
});

/* ---------- the files a turn changed ---------- */

test("snapshotFiles and diffFiles: added, modified, removed; links not followed; the walk capped", async () => {
  const fx = await fixture();
  const dir = join(fx.root, "walk");
  const outside = join(fx.root, "outside");
  await mkdir(join(dir, "sub"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, "x.md"), "outside");
  await writeFile(join(dir, "b.md"), "bb");
  await writeFile(join(dir, "c.md"), "c");
  await writeFile(join(dir, "sub", "d.md"), "d");
  await writeFile(join(dir, "e.md"), "e");
  await symlink(outside, join(dir, "link"));

  const before = await snapshotFiles(dir);
  assert.equal(before.truncated, false);
  assert.deepEqual([...before.files.keys()].sort(), ["b.md", "c.md", "e.md", "link", "sub/d.md"], "a link is listed as itself; its target is not walked");
  assert.deepEqual(before.files.get("b.md")?.size, 2);

  await writeFile(join(dir, "a.md"), "a");
  await writeFile(join(dir, "b.md"), "bbb");
  await rm(join(dir, "c.md"));
  const old = new Date(Date.parse("2026-01-01T00:00:00Z"));
  await utimes(join(dir, "e.md"), old, old);
  const after = await snapshotFiles(dir);
  assert.deepEqual(diffFiles(before.files, after.files), [
    { path: "a.md", change: "added" },
    { path: "b.md", change: "modified" },
    { path: "c.md", change: "removed" },
    { path: "e.md", change: "modified" },
  ], "by size or by mtime, sorted by path");
  assert.deepEqual(diffFiles(after.files, after.files), []);

  const capped = await snapshotFiles(dir, 2);
  assert.equal(capped.truncated, true);
  assert.ok(capped.files.size <= 2);
  assert.equal(FILES_WALK_MAX, 2_000);
  assert.deepEqual(await snapshotFiles(join(dir, "nowhere")), { files: new Map(), truncated: false }, "a cwd not made yet holds nothing");
  await symlink(dir, join(fx.root, "walk-link"));
  assert.deepEqual(await snapshotFiles(join(fx.root, "walk-link")), { files: new Map(), truncated: false }, "a linked cwd is not followed");
  assert.equal((await readFile(join(dir, "a.md"), "utf8")), "a");
});

/* ---------- the lines, the records, the cut-off ---------- */

test("LINES: every row of the phone-line table, exactly", () => {
  const id = "preclose";
  const date = "2026-11-27";
  assert.equal(LINES.timedOut(id, date, 600_000), "preclose · 2026-11-27 timed out after 10 min; a card or a long tool was pending");
  assert.equal(LINES.timedOut(id, date, 90_000), "preclose · 2026-11-27 timed out after 90 s; a card or a long tool was pending");
  assert.equal(LINES.noText(id, date), "preclose · 2026-11-27 ended with no text");
  assert.equal(LINES.failed(id, date, "429 rate limit"), "preclose · 2026-11-27 could not answer: 429 rate limit; nothing was done");
  assert.equal(LINES.cancelled(id, date, "stopped in the browser"), "preclose · 2026-11-27 was cancelled (stopped in the browser); nothing more will be said");
  assert.equal(LINES.fence(id, date, "desk/journal/.git"), "preclose · 2026-11-27 refused: desk/journal/.git exists; it would steer every desk turn. Remove it.");
  assert.equal(LINES.noTurn(id, date), "preclose · 2026-11-27 never started a turn; nothing ran");
  assert.equal(LINES.couldNotRun(id, date, "boom"), "preclose · 2026-11-27 could not run: boom");
  assert.equal(LINES.leftBehind(id, date, "desk/journal/GRAVIT.md"), "preclose · 2026-11-27 left desk/journal/GRAVIT.md behind; every desk turn is refused until it is removed");
  assert.equal(LINES.changed(id, date, "desk/STANDING.md"), "preclose · 2026-11-27 refused: desk/STANDING.md changed since arming. Review it, then: npm run desk -- rearm preclose");
  assert.equal(LINES.missing(id, date, "scripts/p.py"), "preclose · 2026-11-27 refused: scripts/p.py is missing. Restore it, or remove the order from standing.yml");
  assert.equal(LINES.afterClose(id), "preclose finished after the close; not sent - it describes a market that has moved");
  assert.equal(LINES.afterOpen("premarket"), "premarket finished after the open; not sent - it describes a market that has moved");
  assert.equal(LINES.budgetSpent(SPENT), "standing orders are refused for the rest of the day: the desk's token budget is spent (2,013,402 of 2,000,000 tokens since 00:00 ET)");
  assert.equal(LINES.budgetReply(SPENT), "the desk's token budget for today is spent: 2,013,402 of 2,000,000 tokens since 00:00 ET. It opens again at midnight ET, or raise budget.dailyTokens in standing.yml");
  const missed = { order: id, date: "2026-11-30", anchor: "2026-11-30T20:30:00.000Z" };
  assert.equal(LINES.missed({ ...missed, why: "asleep", asleep: { from: "2026-11-30T20:25:00.000Z", to: "2026-11-30T20:36:00.000Z" }, foundAt: "2026-11-30T20:36:00.000Z" }),
    "preclose · 2026-11-30 missed its 15:30 ET anchor: the face was asleep from 15:25 ET to 15:36 ET. A standing order never runs late");
  assert.equal(LINES.missed({ ...missed, why: "asleep", asleep: { from: "2026-11-30T03:00:00.000Z", to: "2026-11-30T20:36:00.000Z" }, foundAt: "2026-11-30T20:36:00.000Z" }),
    "preclose · 2026-11-30 missed its 15:30 ET anchor: the face was asleep from 2026-11-29 22:00 ET to 15:36 ET. A standing order never runs late", "a time on another New York day is dated");
  assert.equal(LINES.missed({ order: id, date, anchor: "2026-11-27T17:30:00.000Z", why: "down", foundAt: "2026-11-27T17:40:00.000Z" }),
    "preclose · 2026-11-27 missed its 12:30 ET anchor: the face was not running. A standing order never runs late");
  assert.equal(LINES.missed({ order: id, date, anchor: "2026-11-27T17:30:00.000Z", why: "late", foundAt: "2026-11-27T17:36:00.000Z" }),
    "preclose · 2026-11-27 missed its 12:30 ET anchor: found at 12:36 ET, past the 5-minute grace. A standing order never runs late");
  assert.equal(LINES.interrupted(id, date), "preclose · 2026-11-27 was cut off by a restart; a standing order never runs twice");
  assert.equal(LINES.expired(id, "2026-11-26"), "preclose expired after 2026-11-26 and no longer fires; extend it with npm run desk -- rearm preclose --expires <YYYY-MM-DD> to keep it");
  assert.equal(LINES.producerFailed("nightly", date, "scripts/capture.py", "exit 1"), "nightly · 2026-11-27 producer scripts/capture.py failed (exit 1); nothing was woken");
  assert.equal(LINES.standingRefused(["orders[0] (preclose): not armed: npm run desk -- arm desk …", "budget.dailyTokens is missing"]),
    "standing.yml is refused, so no standing order runs until it is fixed: orders[0] (preclose): not armed: npm run desk -- arm desk …; budget.dailyTokens is missing");
  const long = LINES.standingRefused(Array.from({ length: 40 }, (_, i) => `orders[${i}] (o${i}): at is missing`));
  const errors = long.slice("standing.yml is refused, so no standing order runs until it is fixed: ".length);
  assert.equal([...errors].length, 500, "the errors cut at 500 characters");
  assert.ok(errors.startsWith("orders[0] (o0): at is missing; orders[1]") && errors.endsWith("…"));
  assert.equal(LINES.ledgerUnreadable("/h/face/desk/firings.jsonl", "EISDIR"), "the firing ledger /h/face/desk/firings.jsonl cannot be read (EISDIR), so no standing order runs until it can");
  assert.equal(LINES.noCalendar("fake clock", "the clock is down"),
    "no standing order runs today: the market calendar failed in fake clock (the clock is down)");
});

test("cutoffOf: the close for close-Nm, the open for open-Nm, nothing for an anchor at or after its moment", () => {
  const cut = (at: string, anchor: StandingOrder["anchor"]): number | undefined => cutoffOf(itemWith({ at, anchor }));
  assert.equal(cut("close-30m", { kind: "close", offsetMin: -30 }), Date.parse(EARLY.close));
  assert.equal(cut("open-90m", { kind: "open", offsetMin: -90 }), Date.parse(EARLY.open));
  assert.equal(cut("close", { kind: "close", offsetMin: 0 }), undefined);
  assert.equal(cut("close+10m", { kind: "close", offsetMin: 10 }), undefined);
  assert.equal(cut("open", { kind: "open", offsetMin: 0 }), undefined);
  assert.equal(cut("open+5m", { kind: "open", offsetMin: 5 }), undefined);
  assert.equal(cut("15:30", { kind: "time", hour: 15, minute: 30 }), undefined);
});

test("firingKey, isFiringRecord and outcomeOf", () => {
  assert.equal(firingKey("preclose", "2026-11-27"), "preclose:2026-11-27");
  const t = "2026-11-27T17:36:00.000Z";
  const base = { t, kind: "finished" as const, key: KEY, order: "preclose", date: "2026-11-27", wallMs: 1 };
  const turn = (outcome: NonNullable<FinishedRecord["turn"]>["outcome"]): FinishedRecord => ({ ...base, turn: { outcome, deadlineMs: 600_000 } });
  const records: [FiringRecord, string][] = [
    [turn("timed-out"), "timed out"],
    [turn("refused"), "refused: fence"],
    [turn("no-turn"), "never started"],
    [turn("failed"), "failed"],
    [turn("error"), "failed"],
    [turn("cancelled"), "cancelled"],
    [{ ...turn("ended"), withheld: "after the open", delivery: { sent: [3] } }, "withheld (after the open)"],
    [{ ...turn("ended"), delivery: { sent: [3] } }, "delivered"],
    [{ ...turn("ended"), delivery: { sent: [3], queued: true } }, "queued"],
    [{ ...turn("ended"), delivery: { queued: true } }, "queued"],
    [{ ...turn("ended"), delivery: { undelivered: "telegram not configured" } }, "undelivered (telegram not configured)"],
    [{ ...base, producer: { spec: "builtin:brief", ok: true } }, "producer ran"],
    [{ ...base, producer: { spec: "builtin:brief", ok: false, error: "x" }, delivery: { sent: [1] } }, "producer failed"],
    [{ t, kind: "refused", key: KEY, order: "preclose", date: "2026-11-27", reason: "hash", detail: "missing", reported: true }, "refused (hash)"],
    [{ t, kind: "missed", key: KEY, order: "preclose", date: "2026-11-27", anchor: "2026-11-27T17:30:00.000Z", why: "down", foundAt: t }, "missed"],
    [{ t, kind: "interrupted", key: KEY, order: "preclose", date: "2026-11-27", startedAt: t }, "interrupted"],
    [{ t, kind: "expired", key: "preclose:2026-11-26", order: "preclose", date: "2026-11-26", expires: "2026-11-26" }, "expired"],
  ];
  for (const [record, outcome] of records) {
    assert.equal(outcomeOf(record), outcome, JSON.stringify(record));
    assert.equal(isFiringRecord(record), true);
  }
  for (const kind of ["started", "producer", "woke"]) assert.equal(isFiringRecord({ t, kind }), true, kind);
  assert.equal(isFiringRecord({ kind: "finished" }), false, "no t");
  assert.equal(isFiringRecord({ t, kind: "ended" }), false, "an unknown kind");
  assert.equal(isFiringRecord({ t: 1, kind: "finished" }), false);
  assert.equal(isFiringRecord(null), false);
  assert.equal(isFiringRecord([t, "finished"]), false);
  assert.equal(isFiringRecord("finished"), false);
});

/* ---------- the shared fakes (tests/desk-fakes.ts), as the clock row's tests lean on them ---------- */

test("the fakes: a WallClock fires due timers in order and a jump fires none; a fake calendar answers its days", async () => {
  const clock = new WallClock("2026-11-27T17:30:00Z");
  const fired: string[] = [];
  clock.setTimeout(() => { fired.push("b"); }, 2_000);
  clock.setTimeout(() => { fired.push(`a at ${new Date(clock.now()).toISOString()}`); }, 1_000);
  clock.clearTimeout(clock.setTimeout(() => { fired.push("cleared"); }, 500));
  clock.setTimeout(() => { fired.push("tie"); }, 2_000);
  await clock.advance(1_999);
  assert.deepEqual(fired, ["a at 2026-11-27T17:30:01.000Z"], "each at its own instant");
  clock.jump(60_000);
  await clock.flush();
  assert.equal(clock.now(), Date.parse("2026-11-27T17:31:01.999Z"));
  assert.equal(fired.length, 1, "a jump fires nothing, now or later");
  assert.equal(clock.pending(), 2);
  await clock.advance(0);
  assert.deepEqual(fired.slice(1), ["b", "tie"], "the overdue fire on the next advance, ties in the order they were set");
  clock.set("2026-11-26T12:00:00Z");
  assert.equal(clock.now(), Date.parse("2026-11-26T12:00:00Z"));
  assert.throws(() => new WallClock("not a time"), RangeError);

  const calendar = fakeCalendar({ "2026-11-26": "closed", "2026-11-27": EARLY, "2026-11-30": REGULAR });
  assert.equal(calendar.clock, "fake clock");
  assert.equal(calendar.peek(), undefined);
  assert.equal(calendar.window(), undefined, "no window before an answer, as the face's calendar has none before its first ask");
  const first = calendar.today(Date.parse("2026-11-27T17:30:00Z"));
  assert.equal(calendar.window(), undefined, "nor while the first ask is under way");
  assert.deepEqual(await first, { ok: true, date: "2026-11-27", session: EARLY, source: "fake calendar" });
  assert.deepEqual(calendar.window(), { from: "2026-11-26", days: 5, source: "fake calendar", sessions: [EARLY, REGULAR] });
  assert.deepEqual(await calendar.today(Date.parse("2026-11-27T04:59:00Z")), { ok: true, date: "2026-11-26", session: "closed", source: "fake calendar" }, "a New York date");
  assert.deepEqual(await calendar.today(Date.parse("2026-11-27T04:59:30Z")), { ok: true, date: "2026-11-26", session: "closed", source: "fake calendar" });
  const unknown = { ok: false, date: "2026-12-01", error: "the fake calendar has no 2026-12-01" };
  assert.deepEqual(await calendar.today(Date.parse("2026-12-01T15:00:00Z")), unknown);
  assert.deepEqual(calendar.asked, ["2026-11-27", "2026-11-26", "2026-12-01"], "a date once each time it changes");
  assert.deepEqual(calendar.peek(), unknown, "the latest date's answer");
  assert.deepEqual(calendar.window(), { from: "2026-11-26", days: 5, source: "fake calendar", sessions: [EARLY, REGULAR] });
  const empty = fakeCalendar({}, "another clock");
  assert.deepEqual(await empty.today(Date.parse("2026-11-27T17:30:00Z")), { ok: false, date: "2026-11-27", error: "the fake calendar has no 2026-11-27" });
  assert.equal(empty.window(), undefined, "no days, no window");

  const out = recordingDeliver((text, n) => (n === 1 ? { queued: true } : { undelivered: `no ${text}` }));
  assert.deepEqual(await out.deliver("one"), { queued: true });
  assert.deepEqual(await out.deliver("two"), { undelivered: "no two" });
  assert.deepEqual(out.texts, ["one", "two"]);
});

test("a WallClock waits for a timer's own work: a tick that re-arms after real I/O fires on every interval", async () => {
  const fx = await fixture();
  /* the contract's first form: the callback returns its promise, which the advance awaits before the next timer */
  const clock = new WallClock(FIRED);
  const ticks: string[] = [];
  const tick = async (): Promise<void> => {
    ticks.push(new Date(clock.now()).toISOString());
    for (let i = 0; i < 20; i++) await stat(fx.root); // more turns of the event loop than the drain gives
    clock.setTimeout(tick, 30_000);
  };
  clock.setTimeout(tick, 30_000);
  await clock.advance(120_000);
  assert.deepEqual(ticks, ["2026-11-27T17:30:34.000Z", "2026-11-27T17:31:04.000Z", "2026-11-27T17:31:34.000Z", "2026-11-27T17:32:04.000Z"]);
  assert.equal(clock.pending(), 1, "re-armed for the next");

  /* its second form: the callback re-arms before its first await, and its work runs on alone */
  const other = new WallClock(FIRED);
  let tocks = 0;
  const tock = (): void => {
    tocks += 1;
    other.setTimeout(tock, 30_000);
    void (async () => {
      for (let i = 0; i < 20; i++) await stat(fx.root);
    })().catch(() => {}); // the fixture may be gone by the time a late stat runs (p2-m25)
  };
  other.setTimeout(tock, 30_000);
  await other.advance(120_000);
  assert.equal(tocks, 4);

  /* a callback's rejection is the advance's own */
  const failing = new WallClock(FIRED);
  failing.setTimeout(async () => { throw new Error("the tick broke"); }, 1_000);
  await assert.rejects(failing.advance(1_000), /the tick broke/);

  /* work that waits on a later timer of the same clock is bounded in real time, the timer named (p2-m24) */
  const stuck = new WallClock(FIRED, { workBoundMs: 50 });
  stuck.setTimeout(() => new Promise<void>((done) => { stuck.setTimeout(done, 1_000); }), 1_000);
  await assert.rejects(stuck.advance(5_000), /WallClock: the timer due at 2026-11-27T17:30:05\.000Z returned work that did not settle in 50 ms of real time/);
});

/* ---------- the fix wave: a setup that hangs (M1), the fence's label (p2-m18), both pins named (p2-m11) ---------- */

test("a route or a create that hangs past the turn deadline ends the firing as error, and a late session is let go (M1)", async () => {
  /* the create hangs, then arrives late */
  {
    const fx = await fixture();
    let arrive!: (made: Awaited<ReturnType<FiringDeps["createAgent"]>>) => void;
    let disposed = 0;
    const r = rig(fx, { over: { createAgent: () => new Promise((done) => { arrive = done; }) } });
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    await waitFor("the create", () => arrive !== undefined);
    await r.clock.advance(599_999);
    let settled = false;
    void running.then(() => { settled = true; });
    await r.clock.flush();
    assert.equal(settled, false, "a millisecond before its bound it still waits");
    await r.clock.advance(1);
    const finished = await running;
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 could not run: the session did not open in 10 min"]);
    assert.deepEqual(finished?.turn, { outcome: "error", deadlineMs: 600_000, error: "the session did not open in 10 min" });
    arrive({ agent: {} as never, sessionId: "late", dispose: async () => { disposed += 1; } });
    await waitFor("the late session's dispose", () => disposed === 1);
  }
  /* the route hangs */
  {
    const fx = await fixture();
    let asked = false;
    const r = rig(fx, { over: { resolveRoute: () => { asked = true; return new Promise<never>(() => {}); } } });
    const running = runFiring(r.deps, ITEM, verifiedFor(fx), signal());
    /* the producer's record is real I/O: wait for the route to be asked - its bound is set by then - before time moves */
    await waitFor("the route", () => asked);
    await r.clock.advance(600_000);
    const finished = await running;
    assert.deepEqual(r.out.texts, ["preclose · 2026-11-27 could not run: the session did not open in 10 min"]);
    assert.equal(finished?.turn?.outcome, "error");
    assert.equal(r.agents.agents.length, 0, "no session was asked for");
  }
});

test("a firing's supervision counts a fence check that fails at the firing's own cwd, not desk/journal (p2-m18)", async () => {
  const fx = await fixture();
  const r = rig(fx);
  const strategy = itemWith({ id: "nightly", dir: "strategies/demo", file: "NIGHTLY.md" });
  await mkdir(join(fx.root, "strategies", "demo"), { recursive: true });
  const running = runFiring(r.deps, strategy, { ...verifiedFor(fx), cwd: join(fx.root, "strategies", "demo") }, signal());
  await waitFor("the supervision", () => r.sup.calls.length === 1);
  assert.equal(r.sup.calls[0].fenceLabel, "strategies/demo");
  await r.clock.advance(660_000);
  await running;
});

test("LINES.changed names every pin that moved", () => {
  assert.equal(LINES.changed("p", "2026-11-27", "desk/STANDING.md"),
    "p · 2026-11-27 refused: desk/STANDING.md changed since arming. Review it, then: npm run desk -- rearm p");
  assert.equal(LINES.changed("p", "2026-11-27", ["desk/STANDING.md", "scripts/p.py"]),
    "p · 2026-11-27 refused: desk/STANDING.md and scripts/p.py changed since arming. Review them, then: npm run desk -- rearm p");
});
