import test from "node:test";
import assert from "node:assert/strict";
import {
  MEMORY_GUARD_LIMIT_MS,
  MEMORY_GUARD_PAGES,
  MEMORY_WRITE_TOOL,
  OWNER_NAME_REFUSED,
  decisionOwner,
  installMemoryGuard,
  ownerDecisionRefused,
  ownerDecisionUnchecked,
  ownerWriteOf,
  type GuardStanding,
  type MemoryGuardDeps,
  type OwnerWrite,
} from "../src/memory-guard.ts";
import type { MemoryStanding } from "../src/memory.ts";

const D = "d-20260302-0f3a9c21";
const CONV = "session-conv";
const WORKER = "session-worker";

/** `MemoryStanding` is assignable to the fence's own type: a compile-time check, never run. */
const _standingFits = (s: MemoryStanding): GuardStanding => s;
void _standingFits;

test("ownerWriteOf: what each call asks of the owner's name", () => {
  const rows: [string, unknown, OwnerWrite][] = [
    ["mcp__memory__memory_record", { whose: "owner", action: "buy", thesis: "t" }, { kind: "name", what: "record" }],
    ["mcp__other-1__memory_record", { whose: "owner" }, { kind: "name", what: "record" }],
    ["mcp__memory__memory_record", { whose: "agent", action: "buy", thesis: "t" }, { kind: "none" }],
    ["mcp__memory__memory_record", { whose: "Owner" }, { kind: "none" }],
    ["mcp__memory__memory_record", { whose: ["owner"] }, { kind: "none" }],
    ["mcp__memory__memory_record", {}, { kind: "none" }],
    ["mcp__memory__memory_record", null, { kind: "none" }],
    ["mcp__memory__memory_record", "whose owner", { kind: "none" }],
    ["mcp__memory__memory_record", [{ whose: "owner" }], { kind: "none" }],
    ["mcp__memory__memory_amend", { decision: D, what: "review", whose: "owner", thesis_held: "yes", wrong_if_hit: "no" }, { kind: "name", what: "review" }],
    ["mcp__memory__memory_amend", { decision: D, what: "review", whose: "agent", thesis_held: "yes", wrong_if_hit: "no" }, { kind: "none" }],
    ["mcp__memory__memory_amend", { decision: D, what: "void", reason: "r" }, { kind: "standing", what: "void", decision: D }],
    ["mcp__memory__memory_amend", { decision: D, what: "close", closed_at: "2026-03-03T15:00:00Z" }, { kind: "standing", what: "close", decision: D }],
    ["mcp__memory__memory_amend", { decision: D, what: "ref", ref: "o-1" }, { kind: "none" }],
    ["mcp__memory__memory_amend", { decision: D, what: "correction", field: "thesis", value: "v" }, { kind: "none" }],
    ["mcp__memory__memory_amend", { decision: "d-1", what: "void", reason: "r" }, { kind: "none" }],
    ["mcp__memory__memory_amend", { decision: 7, what: "close" }, { kind: "none" }],
    ["mcp__memory__memory_amend", { what: "void", reason: "r" }, { kind: "none" }],
    ["mcp__memory__memory_propose", { whose: "owner" }, { kind: "none" }],
    ["mcp__memory__memory_recall", { whose: "owner" }, { kind: "none" }],
    ["memory_record", { whose: "owner" }, { kind: "none" }],
    ["mcp__a b__memory_record", { whose: "owner" }, { kind: "none" }],
    ["mcp__memory__memory_record\nx", { whose: "owner" }, { kind: "none" }],
    ["web_fetch", { whose: "owner" }, { kind: "none" }],
  ];
  for (const [name, args, expected] of rows) assert.deepEqual(ownerWriteOf(name, args), expected, `${name} ${JSON.stringify(args)}`);
  assert.equal(MEMORY_WRITE_TOOL.source, "^mcp__[A-Za-z0-9_-]{1,64}__memory_(record|amend)$");
});

test("the reasons, word for word, and the limits", () => {
  assert.equal(
    OWNER_NAME_REFUSED,
    "the owner's name is written only in the conversation, in a turn the owner's own message opened; register your own call with whose \"agent\", or tell the owner",
  );
  assert.equal(
    ownerDecisionRefused(D),
    "decision d-20260302-0f3a9c21 is the owner's: it is voided or closed only in the conversation, in a turn the owner's own message opened; tell the owner",
  );
  assert.equal(
    ownerDecisionUnchecked(D),
    "decision d-20260302-0f3a9c21 could not be checked against the memory, so it is not voided or closed here; try again, or tell the owner",
  );
  assert.equal(MEMORY_GUARD_LIMIT_MS, 10_000);
  assert.equal(MEMORY_GUARD_PAGES, 25);
});

/* ---------- a fake memory ---------- */

type Filter = { before?: string; limit?: number };
type Item = { view: { line: { id: string; whose: string } } };

/** A memory holding `list` newest first, served as the package does: `limit` at a time, `before` an id, `more`. */
function fakeMemory(list: { id: string; whose: string }[]): { open: () => Promise<GuardStanding>; reads: Filter[]; opens: () => number } {
  const reads: Filter[] = [];
  let opens = 0;
  const memory = {
    async decisions(filter: Filter = {}) {
      reads.push({ ...filter });
      const limit = filter.limit ?? 50;
      let start = 0;
      if (filter.before !== undefined) {
        const at = list.findIndex((d) => d.id === filter.before);
        if (at < 0) throw new Error("E_NOT_FOUND");
        start = at + 1;
      }
      const items: Item[] = list.slice(start, start + limit).map((line) => ({ view: { line } }));
      return { items, more: start + limit < list.length };
    },
  };
  return {
    open: async () => {
      opens += 1;
      return { connected: true, memory };
    },
    reads,
    opens: () => opens,
  };
}

function ids(n: number, whose = "agent"): { id: string; whose: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `d-20260101-${i.toString(16).padStart(8, "0")}`, whose }));
}

test("decisionOwner: the newest, an agent's, and one not in the memory", async () => {
  const list = [{ id: D, whose: "owner" }, { id: "d-20260301-00000001", whose: "agent" }];
  const m = fakeMemory(list);
  assert.equal(await decisionOwner(m.open, D), "owner");
  assert.equal(await decisionOwner(m.open, "d-20260301-00000001"), "agent");
  assert.equal(await decisionOwner(m.open, "d-20260301-ffffffff"), "absent");
});

test("decisionOwner: pages back with before, 200 at a time", async () => {
  const list = ids(600);
  list[450] = { id: D, whose: "owner" };
  const m = fakeMemory(list);
  assert.equal(await decisionOwner(m.open, D), "owner");
  assert.equal(m.reads.length, 3);
  assert.deepEqual(m.reads[0], { limit: 200 });
  assert.deepEqual(m.reads[1], { before: list[199]!.id, limit: 200 });
  assert.deepEqual(m.reads[2], { before: list[399]!.id, limit: 200 });
});

test("decisionOwner: runs out of pages and rejects after 25 reads", async () => {
  const list = ids(5_200);
  list[5_199] = { id: D, whose: "owner" };
  const m = fakeMemory(list);
  await assert.rejects(decisionOwner(m.open, D));
  assert.equal(m.reads.length, 25);
});

test("decisionOwner: not connected, or a read that throws, rejects", async () => {
  await assert.rejects(decisionOwner(async () => ({ connected: false }), D));
  const throwing: GuardStanding = { connected: true, memory: { decisions: async () => { throw new Error("broken"); } } };
  await assert.rejects(decisionOwner(async () => throwing, D));
});

/* ---------- the guard ---------- */

type Listener = Parameters<MemoryGuardDeps["ctx"]["on"]>[1];

/** A fake root context keeping its listeners and whether each was prepended. */
function fakeCtx() {
  const listeners: { listener: Listener; prepend: boolean | undefined }[] = [];
  return {
    listeners,
    on(_name: "tools/pre-execute", listener: Listener, options?: { prepend?: boolean }) {
      const entry = { listener, prepend: options?.prepend };
      listeners.push(entry);
      return () => {
        const at = listeners.indexOf(entry);
        if (at >= 0) listeners.splice(at, 1);
        return true;
      };
    },
  };
}

type FakeTimer = { fn: () => void; ms: number };

interface Rig {
  call(name: string, args: unknown, agentId?: string | null): Promise<unknown>;
  nexts: () => number;
  opens: () => number;
  lines: string[];
  timers: FakeTimer[];
  cleared: unknown[];
  dispose: () => unknown;
  ctx: ReturnType<typeof fakeCtx>;
}

function rig(opts: {
  conversation?: MemoryGuardDeps["conversation"];
  operatorTurn?: () => boolean;
  open?: () => Promise<GuardStanding>;
} = {}): Rig {
  const ctx = fakeCtx();
  let nexts = 0;
  let opens = 0;
  const lines: string[] = [];
  const timers: FakeTimer[] = [];
  const cleared: unknown[] = [];
  const operatorTurn = opts.operatorTurn ?? (() => true);
  const baseOpen = opts.open ?? fakeMemory([]).open;
  const dispose = installMemoryGuard({
    ctx,
    conversation: opts.conversation ?? (() => ({ current: () => ({ sessionId: CONV }), operatorTurn })),
    open: () => {
      opens += 1;
      return baseOpen();
    },
    log: (line) => lines.push(line),
    setTimer: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => cleared.push(timer),
  });
  return {
    async call(name, args, agentId = WORKER) {
      const exec = agentId === null ? { name, arguments: args } : { name, arguments: args, agent: { id: agentId } };
      return ctx.listeners[0]!.listener(exec, async () => {
        nexts += 1;
        return { kind: "allow" };
      });
    },
    nexts: () => nexts,
    opens: () => opens,
    lines,
    timers,
    cleared,
    dispose,
    ctx,
  };
}

const OWNER_RECORD = { whose: "owner", action: "buy", thesis: "t" };
const OWNER_REVIEW = { decision: D, what: "review", whose: "owner", thesis_held: "yes", wrong_if_hit: "no" };
const VOID = { decision: D, what: "void", reason: "r" };
const CLOSE = { decision: D, what: "close", closed_at: "2026-03-03T15:00:00Z" };
const REC = "mcp__memory__memory_record";
const AMEND = "mcp__memory__memory_amend";
const DENY_NAME = { kind: "deny", reason: OWNER_NAME_REFUSED };

test("installMemoryGuard: one listener, in front; the disposer removes it", () => {
  const r = rig();
  assert.equal(r.ctx.listeners.length, 1);
  assert.equal(r.ctx.listeners[0]!.prepend, true);
  r.dispose();
  assert.equal(r.ctx.listeners.length, 0);
});

test("in place: every owner write is handed on, with no read and no line", async () => {
  const r = rig();
  for (const [name, args] of [[REC, OWNER_RECORD], [AMEND, OWNER_REVIEW], [AMEND, VOID], [AMEND, CLOSE]] as const) {
    assert.deepEqual(await r.call(name, args, CONV), { kind: "allow" });
  }
  assert.equal(r.nexts(), 4);
  assert.equal(r.opens(), 0);
  assert.deepEqual(r.lines, []);
});

test("the conversation outside the operator's turn is refused the owner's name", async () => {
  const r = rig({ operatorTurn: () => false });
  assert.deepEqual(await r.call(REC, OWNER_RECORD, CONV), DENY_NAME);
  assert.equal(r.nexts(), 0);
  assert.deepEqual(r.lines, [
    "memory: refused mcp__memory__memory_record (record) from session session-conv: not the operator's turn in the conversation",
  ]);
});

test("a worker is refused the owner's name while the conversation's turn is the operator's", async () => {
  const r = rig();
  assert.deepEqual(await r.call(REC, OWNER_RECORD, WORKER), DENY_NAME);
  assert.deepEqual(await r.call(AMEND, OWNER_REVIEW, WORKER), DENY_NAME);
  assert.equal(r.nexts(), 0);
  assert.equal(r.lines.length, 2);
  assert.match(r.lines[1]!, /\(review\) from session session-worker/);
});

test("no conversation, no held session, or no agent: not in place", async () => {
  const none = rig({ conversation: () => undefined });
  assert.deepEqual(await none.call(REC, OWNER_RECORD, CONV), DENY_NAME);
  const unheld = rig({ conversation: () => ({ current: () => undefined, operatorTurn: () => true }) });
  assert.deepEqual(await unheld.call(REC, OWNER_RECORD, CONV), DENY_NAME);
  const noAgent = rig();
  assert.deepEqual(await noAgent.call(REC, OWNER_RECORD, null), DENY_NAME);
  assert.deepEqual(noAgent.lines, [
    "memory: refused mcp__memory__memory_record (record) from session unknown: not the operator's turn in the conversation",
  ]);
});

test("calls that ask nothing of the owner's name are handed on from anywhere", async () => {
  const r = rig();
  const calls: [string, unknown][] = [
    [REC, { whose: "agent", action: "buy", thesis: "t" }],
    [AMEND, { decision: D, what: "ref", ref: "o-1" }],
    [AMEND, { decision: D, what: "correction", field: "thesis", value: "v" }],
    ["mcp__memory__memory_propose", { whose: "owner" }],
    ["web_fetch", { whose: "owner" }],
  ];
  for (const [name, args] of calls) {
    const before = r.nexts();
    assert.deepEqual(await r.call(name, args, WORKER), { kind: "allow" });
    assert.equal(r.nexts(), before + 1);
  }
  assert.equal(r.opens(), 0);
  assert.deepEqual(r.lines, []);
});

test("the place is read at the call", async () => {
  const turns = [true, false];
  const r = rig({ operatorTurn: () => turns.shift() ?? false });
  assert.deepEqual(await r.call(REC, OWNER_RECORD, CONV), { kind: "allow" });
  assert.deepEqual(await r.call(REC, OWNER_RECORD, CONV), DENY_NAME);
});

test("a worker's void outside the place reads the target's owner", async () => {
  const list = [{ id: D, whose: "owner" }];
  const owner = rig({ open: fakeMemory(list).open });
  assert.deepEqual(await owner.call(AMEND, VOID, WORKER), { kind: "deny", reason: ownerDecisionRefused(D) });
  assert.deepEqual(owner.lines, [
    "memory: refused mcp__memory__memory_amend (void) from session session-worker: not the operator's turn in the conversation",
  ]);
  assert.equal(owner.nexts(), 0);

  const agent = rig({ open: fakeMemory([{ id: D, whose: "agent" }]).open });
  assert.deepEqual(await agent.call(AMEND, VOID, WORKER), { kind: "allow" });
  assert.deepEqual(agent.lines, []);

  const absent = rig({ open: fakeMemory([{ id: "d-20260301-00000001", whose: "owner" }]).open });
  assert.deepEqual(await absent.call(AMEND, CLOSE, WORKER), { kind: "allow" });
  assert.deepEqual(absent.lines, []);
});

test("a void that cannot be checked is refused: not connected, a throw, or past the limit", async () => {
  const unchecked = { kind: "deny", reason: ownerDecisionUnchecked(D) };

  const offline = rig({ open: async () => ({ connected: false }) });
  assert.deepEqual(await offline.call(AMEND, VOID, WORKER), unchecked);
  assert.equal(offline.lines.length, 1);
  assert.ok(offline.lines[0]!.endsWith("the decision could not be checked"));
  assert.equal(offline.timers.length, 1);
  assert.deepEqual(offline.cleared, [offline.timers[0]]);

  const broken = rig({ open: async () => ({ connected: true, memory: { decisions: async () => { throw new Error("broken"); } } }) });
  assert.deepEqual(await broken.call(AMEND, VOID, WORKER), unchecked);
  assert.ok(broken.lines[0]!.endsWith("the decision could not be checked"));
  assert.deepEqual(broken.cleared, [broken.timers[0]]);

  const hung = rig({ open: async () => ({ connected: true, memory: { decisions: () => new Promise(() => {}) } }) });
  const pending = hung.call(AMEND, VOID, WORKER);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hung.timers.length, 1);
  assert.equal(hung.timers[0]!.ms, MEMORY_GUARD_LIMIT_MS);
  hung.timers[0]!.fn();
  assert.deepEqual(await pending, unchecked);
  assert.ok(hung.lines[0]!.endsWith("the decision could not be checked"));
  assert.equal(hung.nexts(), 0);
});

test("no argument's text is logged", async () => {
  const r = rig();
  const args = { whose: "owner", action: "buy", thesis: "SECRET-THESIS-9f3a", words: "SECRET-WORDS-9f3a" };
  assert.deepEqual(await r.call(REC, args, WORKER), DENY_NAME);
  assert.equal(r.lines.length, 1);
  for (const line of r.lines) assert.ok(!line.includes("SECRET"), line);
});

test("a throw while judging a matched call refuses it; an unmatched call never reaches the throw", async () => {
  const r = rig({ conversation: () => { throw new Error("boom"); } });
  assert.deepEqual(await r.call(REC, OWNER_RECORD, CONV), DENY_NAME);
  assert.equal(r.lines.length, 1);
  assert.equal(r.nexts(), 0);
  assert.deepEqual(await r.call("web_fetch", { whose: "owner" }, CONV), { kind: "allow" });
  assert.equal(r.nexts(), 1);
});
