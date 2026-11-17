/** src/memory-lunhui.ts: a fresh Lunhui run's leaders, asked of the owner's memory once as gravit-face and the answers
 * kept under a directory in the system's temporary directory - on a stub view, a stub memory and an injected timer.
 * Nothing leaves the process and no real timer is waited on. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Memory, RecallAnswer } from "gravit-memory";
import { RUN_ID_RE as SOURCE_RUN_ID_RE, STRATEGY_NAME_RE as SOURCE_STRATEGY_NAME_RE } from "../plugins/lunhui/lib/runs.mjs";
import { FACT_READ_MS, type Facts } from "../src/memory-facts.ts";
import {
  createLunhuiLessons, industryOf, LEADER_ASK_MS, leadersOf, LUNHUI_FRESH_MS, RUN_ID_RE, STRATEGY_NAME_RE,
  type LunhuiLessonsDeps,
} from "../src/memory-lunhui.ts";
import type { MemoryStanding } from "../src/memory.ts";

const NOW = Date.parse("2026-11-16T07:30:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const never = <T>(): Promise<T> => new Promise<T>(() => {});

const rung = (n: number, codes: unknown[]) => ({ n, sealed: codes.map((code) => ({ code })) });

/** A run's view: two leaders by default, `600519` at four boards and `000001` at two. */
function viewOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    strategy: "cn-market", run: "run-1", frozenAt: iso(NOW - 60_000),
    ladder: { height: 4, rungs: [rung(4, ["600519"]), rung(2, ["000001"]), rung(1, ["300750"])], unavailable: null },
    stocks: { "600519": { industry: "白酒" }, "000001": { industry: "银行" }, "300750": { industry: "电池" } },
    ...over,
  };
}

/** A recall answer with one lesson. */
function answerOf(id: string): RecallAnswer {
  return {
    recall_id: `r-20261116-${id}`, applies: [{
      id: "L-0001", strength: "caveat", says: "careful", actions: ["buy"], words: "do not chase the fifth board",
      record: { owner: { fired: 1, followed: 1, overridden: 0, seen: 1, backfilled: 0, no_decision: 0 }, agents: { followed: 0, overridden: 0, seen: 0 } },
    }], applies_more: 0, untold: [], untold_more: 0, same: [], like: [],
    house: { armed: 0, may_be_due: 0, proposals_waiting: 0, cards_changed: [], cards_broken: [], owner_chain_broken: false, chains_broken: [], partial: [] },
    text: "",
  } as unknown as RecallAnswer;
}

/** A connected memory whose recall records its arguments. */
function memoryOf(recall: (input: { symbol?: string }) => Promise<RecallAnswer> = async (input) => answerOf(String(input.symbol))) {
  const calls: Array<{ by: string; input: Record<string, unknown> }> = [];
  let connected = true;
  const memory = {
    recall: (by: string, input: Record<string, unknown>) => { calls.push({ by, input }); return recall(input as { symbol?: string }); },
  } as unknown as Memory;
  const open = async (): Promise<MemoryStanding> =>
    connected ? { connected: true, memory, home: "/memory" } : { connected: false, why: "no home named", say: "no memory home is named" };
  return { calls, open, setConnected: (on: boolean) => { connected = on; } };
}

const PRICE: Facts = { facts: { price: 10.5, change_1d_pct: 10 }, sources: { price: "the Market's quote", change_1d_pct: "the Market's quote" } };

/** A timer that runs the facts' bound at once and never runs the recall's: no real timer is set. */
const timers = {
  setTimer: (run: () => void, ms: number): unknown => {
    if (ms === FACT_READ_MS) setImmediate(run);
    return { ms };
  },
  clearTimer: (): void => {},
};

async function dirOf(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memory-lunhui-"));
}

/** A store over `dir`, with a view, a memory and facts that record their calls. */
function storeOf(dir: string, over: Partial<LunhuiLessonsDeps> & { view?: LunhuiLessonsDeps["view"] } = {}) {
  const memory = memoryOf();
  const facts: string[] = [];
  const views: Array<[string, string]> = [];
  const logs: string[] = [];
  const deps: LunhuiLessonsDeps = {
    dir,
    view: async (strategy, run) => { views.push([strategy, run]); return viewOf({ strategy, run }); },
    open: memory.open,
    facts: async (code) => { facts.push(code); return PRICE; },
    log: (line) => { logs.push(line); },
    now: () => NOW,
    ...timers,
    ...over,
  };
  return { store: createLunhuiLessons(deps), memory, facts, views, logs, deps };
}

const exists = async (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

test("the copied names pin their source in plugins/lunhui/lib/runs.mjs", () => {
  assert.equal(STRATEGY_NAME_RE.source, SOURCE_STRATEGY_NAME_RE.source);
  assert.equal(STRATEGY_NAME_RE.flags, SOURCE_STRATEGY_NAME_RE.flags);
  assert.equal(RUN_ID_RE.source, SOURCE_RUN_ID_RE.source);
  assert.equal(RUN_ID_RE.flags, SOURCE_RUN_ID_RE.flags);
});

test("leadersOf: rungs of two boards and up, the highest first, a rung's order kept, at most five", () => {
  const ladder = (rungs: unknown[]) => ({ ladder: { height: 5, rungs, unavailable: null } });
  const rungs = [rung(5, ["600001"]), rung(4, []), rung(3, ["600002", "600003"]), rung(2, ["600004", "600005", "600006"]), rung(1, ["600007", "600008"])];
  const want = [
    { code: "600001", boards: 5 }, { code: "600002", boards: 3 }, { code: "600003", boards: 3 },
    { code: "600004", boards: 2 }, { code: "600005", boards: 2 },
  ];
  assert.deepEqual(leadersOf(ladder(rungs)), want);
  assert.deepEqual(leadersOf(ladder([...rungs].reverse())), want, "rungs given lowest first give the same");
});

test("leadersOf: a code off six digits is skipped; a code on two rungs is once, at the higher", () => {
  const view = { ladder: { rungs: [rung(2, ["600519", "000001"]), rung(3, ["sh600519", "60051", 600519, "000001"])], unavailable: null } };
  assert.deepEqual(leadersOf(view), [{ code: "000001", boards: 3 }, { code: "600519", boards: 2 }]);
});

test("leadersOf: no ladder, an unavailable ladder or a view that is not an object is no leader", () => {
  assert.deepEqual(leadersOf({}), []);
  assert.deepEqual(leadersOf({ ladder: { rungs: [rung(3, ["600519"])], unavailable: "limit-up not frozen" } }), []);
  assert.deepEqual(leadersOf(null), []);
  assert.deepEqual(leadersOf("view"), []);
  assert.deepEqual(leadersOf(42), []);
});

test("industryOf: 1 to 24 code points none of which echo.ts would escape", () => {
  const view = (industry: unknown) => ({ stocks: { "600519": { industry } } });
  assert.equal(industryOf(view("白酒"), "600519"), "白酒");
  assert.equal(industryOf(view("业".repeat(24)), "600519"), "业".repeat(24));
  assert.equal(industryOf(view("业".repeat(25)), "600519"), undefined);
  assert.equal(industryOf(view("a\nb"), "600519"), undefined);
  assert.equal(industryOf(view("白\u202e酒"), "600519"), undefined);
  assert.equal(industryOf(view(""), "600519"), undefined);
  assert.equal(industryOf(view(null), "600519"), undefined);
  assert.equal(industryOf(view("白酒"), "000001"), undefined);
  assert.equal(industryOf(view("白酒"), "toString"), undefined);
});

test("a fresh run: each leader recalled in order as gravit-face, the answer checked and kept", async () => {
  const dir = await dirOf();
  try {
    const { store, memory, facts } = storeOf(dir);
    const answer = await store.get("cn-market", "run-1");
    assert.equal(memory.calls.length, 2);
    assert.deepEqual(memory.calls.map((c) => c.by), ["gravit-face", "gravit-face"]);
    assert.deepEqual(memory.calls[0].input, {
      considering: ["buy"], symbol: "600519", market: "CN",
      facts: { price: 10.5, change_1d_pct: 10, industry: "白酒" },
      fact_sources: { price: "the Market's quote", change_1d_pct: "the Market's quote", industry: "the run's frozen limit-up pool (run-1)" },
    });
    assert.equal(memory.calls[1].input.symbol, "000001");
    assert.deepEqual(facts, ["600519", "000001"]);
    assert.equal(answer.state, "checked");
    if (answer.state !== "checked") return;
    assert.equal(answer.strategy, "cn-market");
    assert.equal(answer.run, "run-1");
    assert.equal(answer.askedAt, iso(NOW));
    assert.deepEqual(answer.leaders.map((l) => [l.code, l.boards, l.recall]), [["600519", 4, "r-20261116-600519"], ["000001", 2, "r-20261116-000001"]]);
    assert.equal(answer.leaders[0].lessons[0].words, "do not chase the fifth board");
    assert.equal(answer.leaders[0].lessonsMore, 0);
    const file = join(dir, "cn-market", "run-1.json");
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), answer);
    if (process.platform !== "win32") {
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal((await stat(join(dir, "cn-market"))).mode & 0o777, 0o700);
    }
    assert.deepEqual(await readdir(join(dir, "cn-market")), ["run-1.json"], "no temporary file is left");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a second get: the same answer, nothing asked or read again", async () => {
  const dir = await dirOf();
  try {
    const { store, memory, facts } = storeOf(dir);
    const first = await store.get("cn-market", "run-1");
    const second = await store.get("cn-market", "run-1");
    assert.deepEqual(second, first);
    assert.equal(memory.calls.length, 2);
    assert.equal(facts.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a new store over the same directory: the kept answer, with no recall", async () => {
  const dir = await dirOf();
  try {
    const first = await storeOf(dir).store.get("cn-market", "run-1");
    const again = storeOf(dir);
    assert.deepEqual(await again.store.get("cn-market", "run-1"), first);
    assert.equal(again.memory.calls.length, 0);
    assert.equal(again.facts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two gets at once: one ask, two recalls in all", async () => {
  const dir = await dirOf();
  try {
    const { store, memory } = storeOf(dir);
    const [a, b] = await Promise.all([store.get("cn-market", "run-1"), store.get("cn-market", "run-1")]);
    assert.deepEqual(a, b);
    assert.equal(memory.calls.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sealed exactly LUNHUI_FRESH_MS ago is asked; a millisecond older is not", async () => {
  const dir = await dirOf();
  try {
    const at = storeOf(dir, { view: async (strategy, run) => viewOf({ strategy, run, frozenAt: iso(NOW - LUNHUI_FRESH_MS) }) });
    assert.equal((await at.store.get("cn-market", "run-1")).state, "checked");
    assert.equal(at.memory.calls.length, 2);

    const older = storeOf(dir, { view: async (strategy, run) => viewOf({ strategy, run, frozenAt: iso(NOW - LUNHUI_FRESH_MS - 1) }) });
    assert.deepEqual(await older.store.get("cn-market", "run-2"), { state: "not checked", why: "old", words: "lessons were not checked for this run" });
    assert.equal(older.memory.calls.length, 0);
    assert.equal(older.facts.length, 0);
    assert.equal(await exists(join(dir, "cn-market", "run-2.json")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a sealing time that does not parse: not checked, nothing kept", async () => {
  for (const frozenAt of [null, "soon", 42]) {
    const dir = await dirOf();
    try {
      const { store, memory } = storeOf(dir, { view: async (strategy, run) => viewOf({ strategy, run, frozenAt }) });
      assert.deepEqual(await store.get("cn-market", "run-1"), { state: "not checked", why: "old", words: "lessons were not checked for this run" });
      assert.equal(memory.calls.length, 0);
      assert.deepEqual(await readdir(dir), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("a run asked while fresh, read two days later: its kept answer", async () => {
  const dir = await dirOf();
  try {
    const first = await storeOf(dir).store.get("cn-market", "run-1");
    const later = storeOf(dir, { now: () => NOW + 2 * LUNHUI_FRESH_MS });
    assert.deepEqual(await later.store.get("cn-market", "run-1"), first);
    assert.equal(later.memory.calls.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("not connected: its words, nothing kept; a later get with the memory connected asks", async () => {
  const dir = await dirOf();
  try {
    const { store, memory } = storeOf(dir);
    memory.setConnected(false);
    assert.deepEqual(await store.get("cn-market", "run-1"), { state: "not connected", words: "no memory home is named" });
    assert.deepEqual(await readdir(dir), []);
    memory.setConnected(true);
    assert.equal((await store.get("cn-market", "run-1")).state, "checked");
    assert.equal(memory.calls.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a recall that throws: that leader carries its fault, the answer is kept and not asked again", async () => {
  const dir = await dirOf();
  try {
    const memory = memoryOf(async (input) => {
      if (input.symbol === "000001") throw new Error("the ledger is busy");
      return answerOf(String(input.symbol));
    });
    const { store, logs } = storeOf(dir, { open: memory.open });
    const answer = await store.get("cn-market", "run-1");
    assert.equal(answer.state, "checked");
    if (answer.state !== "checked") return;
    assert.equal(answer.leaders[0].fault, undefined);
    assert.equal(answer.leaders[0].lessons.length, 1);
    assert.equal(answer.leaders[1].fault, "the ledger is busy");
    assert.deepEqual(answer.leaders[1].lessons, []);
    assert.deepEqual(logs, ["memory lunhui: cn-market/run-1: 000001: the ledger is busy"]);
    assert.equal(await exists(join(dir, "cn-market", "run-1.json")), true);
    await store.get("cn-market", "run-1");
    assert.equal(memory.calls.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no leader: checked with no leaders, and kept", async () => {
  const dir = await dirOf();
  try {
    const ladder = { height: 1, rungs: [rung(1, ["600519"])], unavailable: null };
    const { store, memory } = storeOf(dir, { view: async (strategy, run) => viewOf({ strategy, run, ladder }) });
    const answer = await store.get("cn-market", "run-1");
    assert.deepEqual(answer, { state: "checked", strategy: "cn-market", run: "run-1", askedAt: iso(NOW), leaders: [] });
    assert.equal(memory.calls.length, 0);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "cn-market", "run-1.json"), "utf8")), answer);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a run that froze no limit-up pool: not checked, nothing kept", async () => {
  const dir = await dirOf();
  try {
    const ladder = { height: 0, rungs: [], unavailable: "limit-up not frozen" };
    const { store, memory } = storeOf(dir, { view: async (strategy, run) => viewOf({ strategy, run, ladder }) });
    assert.deepEqual(await store.get("cn-market", "run-1"), { state: "not checked", why: "no pool", words: "the run froze no limit-up pool" });
    assert.equal(memory.calls.length, 0);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a kept file that cannot be read back: unreadable, and nothing asked", async () => {
  const kept = [
    "{ not json",
    JSON.stringify({ state: "checked", strategy: "cn-market", run: "run-1", askedAt: iso(NOW), leaders: "none" }),
  ];
  for (const text of kept) {
    const dir = await dirOf();
    try {
      await mkdir(join(dir, "cn-market"), { recursive: true });
      await writeFile(join(dir, "cn-market", "run-1.json"), text);
      const { store, memory } = storeOf(dir);
      assert.deepEqual(await store.get("cn-market", "run-1"), { state: "not checked", why: "unreadable", words: "the kept answer could not be read" });
      assert.equal(memory.calls.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("a strategy whose name is in another script: its directory carries that name", async () => {
  const dir = await dirOf();
  try {
    const { store } = storeOf(dir);
    assert.equal((await store.get("市场情绪", "run-1")).state, "checked");
    assert.equal(await exists(join(dir, "市场情绪", "run-1.json")), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the view refusing: get rejects with its code, no file is read or written", async () => {
  const dir = await dirOf();
  try {
    await mkdir(join(dir, "cn-market"), { recursive: true });
    await writeFile(join(dir, "cn-market", "run-1.json"), "{ not json");
    const refusal = Object.assign(new Error("no such run"), { code: "NO_SUCH_RUN" });
    const { store, memory } = storeOf(dir, { view: async () => { throw refusal; } });
    await assert.rejects(store.get("cn-market", "run-1"), (error: unknown) => (error as { code?: string }).code === "NO_SUCH_RUN");
    assert.equal(memory.calls.length, 0);
    assert.deepEqual(await readdir(join(dir, "cn-market")), ["run-1.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a leader whose industry is refused: its facts hold no industry and no source for it", async () => {
  const dir = await dirOf();
  try {
    const stocks = { "600519": { industry: "白酒\u202e" }, "000001": { industry: "银行" } };
    const { store, memory } = storeOf(dir, { view: async (strategy, run) => viewOf({ strategy, run, stocks }) });
    await store.get("cn-market", "run-1");
    const first = memory.calls[0].input as { facts: Record<string, unknown>; fact_sources: Record<string, unknown> };
    assert.equal(Object.hasOwn(first.facts, "industry"), false);
    assert.equal(Object.hasOwn(first.fact_sources, "industry"), false);
    assert.equal((memory.calls[1].input as { facts: Record<string, unknown> }).facts.industry, "银行");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("facts that never answer for one leader: its recall is still made, without them", async () => {
  const dir = await dirOf();
  try {
    const { store, memory } = storeOf(dir, { facts: async (code) => (code === "600519" ? never<Facts>() : PRICE) });
    const answer = await store.get("cn-market", "run-1");
    assert.equal(answer.state, "checked");
    assert.equal(memory.calls.length, 2);
    assert.deepEqual(memory.calls[0].input.facts, { industry: "白酒" });
    assert.deepEqual((memory.calls[1].input.facts as Record<string, unknown>).price, 10.5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("each recall is bounded by LEADER_ASK_MS", async () => {
  const dir = await dirOf();
  try {
    const bounds: number[] = [];
    const { store } = storeOf(dir, {
      setTimer: (run, ms) => { bounds.push(ms); if (ms === FACT_READ_MS) setImmediate(run); return { ms }; },
    });
    await store.get("cn-market", "run-1");
    assert.deepEqual(bounds.filter((ms) => ms !== FACT_READ_MS), [LEADER_ASK_MS, LEADER_ASK_MS]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a write that fails: one log line, the answer still given and kept in the process", async () => {
  const dir = await dirOf();
  try {
    /* a file where the strategy's directory would be: the directory cannot be made */
    await writeFile(join(dir, "cn-market"), "");
    const { store, memory, logs } = storeOf(dir);
    assert.equal((await store.get("cn-market", "run-1")).state, "checked");
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^memory lunhui: cn-market\/run-1: the answer could not be kept: /);
    assert.equal((await store.get("cn-market", "run-1")).state, "checked");
    assert.equal(memory.calls.length, 2, "not asked again before a restart");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A view that resolves any spelling of a name to its canonical one, as the runs service's realpath does. */
const canonical = (strategy: string, run: string) => async (): Promise<unknown> => viewOf({ strategy, run });

test("a request spelled otherwise: keyed and filed by the view's own names, asked once whichever comes first", async () => {
  const spellings: Array<Array<[string, string]>> = [
    [["CN-MARKET", "RUN-1"], ["cn-market", "run-1"]],
    [["cn-market", "run-1"], ["CN-MARKET", "RUN-1"]],
  ];
  for (const [a, b] of spellings) {
    const dir = await dirOf();
    try {
      const { store, memory } = storeOf(dir, { view: canonical("cn-market", "run-1") });
      const first = await store.get(...a);
      assert.deepEqual(await store.get(...b), first);
      assert.equal(first.state === "checked" && first.strategy, "cn-market");
      assert.equal(first.state === "checked" && first.run, "run-1");
      assert.equal(memory.calls.length, 2, "one ask: two leaders");
      assert.deepEqual(await readdir(dir), ["cn-market"]);
      assert.deepEqual(await readdir(join(dir, "cn-market")), ["run-1.json"]);
      const file = JSON.parse(await readFile(join(dir, "cn-market", "run-1.json"), "utf8"));
      assert.deepEqual([file.strategy, file.run], ["cn-market", "run-1"]);
      const restarted = storeOf(dir, { view: canonical("cn-market", "run-1") });
      assert.deepEqual(await restarted.store.get("CN-MARKET", "RUN-1"), first);
      assert.equal(restarted.memory.calls.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("an NFD spelling of an NFC strategy name: the canonical name's key and directory", async () => {
  const nfc = "caf\u00e9";
  const nfd = "cafe\u0301";
  const dir = await dirOf();
  try {
    const { store, memory } = storeOf(dir, { view: canonical(nfc, "run-1") });
    const first = await store.get(nfd, "run-1");
    assert.equal(first.state === "checked" && first.strategy, nfc);
    assert.deepEqual(await store.get(nfc, "run-1"), first);
    assert.equal(memory.calls.length, 2);
    assert.deepEqual(await readdir(dir), [nfc]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a view whose names are missing or off their grammar: a coded refusal, nothing read or written", async () => {
  const views: Array<[Record<string, unknown>, string]> = [
    [{ strategy: undefined }, "NOT_A_STRATEGY"],
    [{ strategy: "../cn-market" }, "NOT_A_STRATEGY"],
    [{ strategy: "cn.market" }, "NOT_A_STRATEGY"],
    [{ run: undefined }, "NO_SUCH_RUN"],
    [{ run: "run/1" }, "NO_SUCH_RUN"],
    [{ run: "run.1" }, "NO_SUCH_RUN"],
  ];
  for (const [over, code] of views) {
    const dir = await dirOf();
    try {
      const { store, memory, facts } = storeOf(dir, { view: async () => viewOf({ strategy: "cn-market", run: "run-1", ...over }) });
      await assert.rejects(store.get("cn-market", "run-1"), (error: unknown) => (error as { code?: string }).code === code);
      assert.equal(memory.calls.length, 0);
      assert.equal(facts.length, 0);
      assert.deepEqual(await readdir(dir), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
