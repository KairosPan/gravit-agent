/** src/memory-screen.ts: the four reads the owner's memory screen draws - the lessons, the decisions, what waits and
 * the home's health - on a stub memory answering fixtures: each answer's shape, the terminal's commands built from
 * ids that fit their shapes, a card's text bounded, not connected as a state, a fault and a late read as a
 * `ScreenFault`; and src/memory-facts.ts `FACE_FACTS`. */
import test from "node:test";
import assert from "node:assert/strict";
import type { Card, CardRecord, DecisionView, LessonView, Memory, ProposalLine, Review, Status } from "gravit-memory";
import { FACE_FACTS } from "../src/memory-facts.ts";
import { NO_MEMORY_HERE, type MemoryStanding } from "../src/memory.ts";
import { SCREEN_READ_MS, SCREEN_TEXT_MAX, ScreenFault, commandOf, createMemoryScreen } from "../src/memory-screen.ts";

const HOME = "/h";
const PH = "\"\u2026\"";

/** A card with `id`, checking `checks` and defining `facts`. */
function card(id: string, checks: string[] = [], facts?: Record<string, string>): Card {
  return {
    id, says: "dont", actions: ["buy"], strength: "caveat", words: `the words of ${id}`,
    ...(checks.length > 0 ? { check: checks.map((fact) => ({ fact, op: ">", value: 1 })) } : {}),
    ...(facts === undefined ? {} : { facts }),
  } as Card;
}

const RECORD = { card: "no-chasing" } as unknown as CardRecord;

/** A memory whose four reads answer what is given; every call is recorded. */
function stubMemory(answers: Partial<{ lessons: unknown; decisions: unknown; review: unknown; status: unknown }> & { reject?: unknown; hang?: boolean }) {
  const calls: Array<[string, unknown[]]> = [];
  const read = (name: keyof typeof answers & string) => (...args: unknown[]) => {
    calls.push([name, args]);
    if (answers.hang) return new Promise(() => {});
    if (answers.reject !== undefined) return Promise.reject(answers.reject);
    return Promise.resolve(answers[name as "lessons"]);
  };
  const memory = {
    home: HOME,
    lessons: read("lessons"), decisions: read("decisions"), review: read("review"), status: read("status"),
    recall: () => { throw new Error("recall is never called"); },
    owner: new Proxy({}, { get: () => { throw new Error("owner is never touched"); } }),
  } as unknown as Memory;
  return { memory, calls };
}

const connected = (memory: Memory) => async (): Promise<MemoryStanding> => ({ connected: true, memory, home: HOME });

const lesson = (view: Partial<LessonView> & Pick<LessonView, "id" | "state">): LessonView => ({ record: null, ...view });
const text = (c: Card, body = `---\nid: ${c.id}\n---\n${c.words}\n`) => ({ sha256: "a".repeat(64), text: body, card: c });

test("lessons: an armed card's checks, each fact once, and its retire command", async () => {
  const armedCard = card("no-chasing", ["change_5d_pct", "sector", "change_5d_pct"], { sector: "the GICS sector of the symbol." });
  const { memory, calls } = stubMemory({
    lessons: { ownerChainBroken: false, lessons: [lesson({ id: "no-chasing", state: "armed", armedAt: "2026-11-01T00:00:00Z", armed: text(armedCard), file: text(armedCard), record: RECORD })] },
  });
  const answer = await createMemoryScreen({ open: connected(memory) }).lessons();
  assert.equal(answer.connected, true);
  if (!answer.connected) return;
  assert.equal(answer.ownerChainBroken, false);
  const [row] = answer.lessons;
  const face5d = FACE_FACTS.find((f) => f.fact === "change_5d_pct")!.definition;
  assert.deepEqual(row.checks, [
    { fact: "change_5d_pct", definition: face5d, face: true },
    { fact: "sector", definition: "the GICS sector of the symbol.", face: false },
  ]);
  assert.deepEqual(row.commands, { retire: `npx --no gravit-memory retire no-chasing --reason ${PH} --home /h` });
  assert.equal(row.record, RECORD);
  assert.equal(row.armedAt, "2026-11-01T00:00:00Z");
  assert.equal(row.armed?.card?.id, "no-chasing");
  assert.deepEqual(calls.map(([name]) => name), ["lessons"]);
});

test("lessons: a fact the card defines and the face computes takes the face's definition; one defined nowhere is null", async () => {
  const c = card("held-check", ["held", "mood"], { held: "the card's own words.", extra: "an extra fact." });
  const { memory } = stubMemory({ lessons: { ownerChainBroken: true, lessons: [lesson({ id: "held-check", state: "unarmed", file: text(c) })] } });
  const answer = await createMemoryScreen({ open: connected(memory) }).lessons();
  assert.ok(answer.connected);
  assert.equal(answer.ownerChainBroken, true);
  assert.deepEqual(answer.lessons[0].checks, [
    { fact: "held", definition: FACE_FACTS.find((f) => f.fact === "held")!.definition, face: true },
    { fact: "mood", definition: null, face: false },
    { fact: "extra", definition: "an extra fact.", face: false },
  ]);
});

test("lessons: the commands each state allows", async () => {
  const changedArmed = card("changed-one", ["price"]);
  const changedFile = card("changed-one", ["price", "held"]);
  const { memory } = stubMemory({
    lessons: {
      ownerChainBroken: false,
      lessons: [
        lesson({ id: "changed-one", state: "changed", armed: text(changedArmed, "armed text"), file: text(changedFile, "file text"), record: RECORD }),
        lesson({ id: "unarmed-one", state: "unarmed", file: text(card("unarmed-one")) }),
        lesson({ id: "refused-one", state: "refused", fault: "card refused-one cannot be armed: its id is taken.", file: text(card("refused-one")) }),
        lesson({ id: "broken-one", state: "broken", fault: "card broken-one is broken: lessons/broken-one.md is gone.", armed: text(card("broken-one")) }),
        lesson({ id: "retired-one", state: "retired", file: text(card("retired-one")) }),
        lesson({ id: "retired-gone", state: "retired" }),
        lesson({ id: "unarmed-bad", state: "unarmed", file: { sha256: "b".repeat(64), text: "junk", fault: "card unarmed-bad does not parse." } }),
      ],
    },
  });
  const answer = await createMemoryScreen({ open: connected(memory) }).lessons();
  assert.ok(answer.connected);
  const byId = new Map(answer.lessons.map((row) => [row.id, row]));
  const changed = byId.get("changed-one")!;
  assert.deepEqual(changed.commands, {
    arm: "npx --no gravit-memory arm changed-one --home /h",
    retire: `npx --no gravit-memory retire changed-one --reason ${PH} --home /h`,
    review: "npx --no gravit-memory review --home /h",
  });
  assert.equal(changed.armed?.text, "armed text");
  assert.equal(changed.file?.text, "file text");
  assert.deepEqual(changed.checks.map((c) => c.fact), ["price"], "the armed copy's card is the one checked");
  assert.deepEqual(byId.get("unarmed-one")!.commands, { arm: "npx --no gravit-memory arm unarmed-one --home /h" });
  const refused = byId.get("refused-one")!;
  assert.equal(refused.fault, "card refused-one cannot be armed: its id is taken.");
  assert.deepEqual(refused.commands, {});
  const broken = byId.get("broken-one")!;
  assert.equal(broken.fault, "card broken-one is broken: lessons/broken-one.md is gone.");
  assert.deepEqual(broken.commands, { retire: `npx --no gravit-memory retire broken-one --reason ${PH} --home /h` });
  assert.deepEqual(byId.get("retired-one")!.commands, { arm: "npx --no gravit-memory arm retired-one --home /h" });
  assert.deepEqual(byId.get("retired-gone")!.commands, {});
  const bad = byId.get("unarmed-bad")!;
  assert.deepEqual(bad.commands, {}, "a file that does not parse is not armed");
  assert.equal(bad.file?.fault, "card unarmed-bad does not parse.");
});

test("lessons: a text of 20,000 characters is cut to SCREEN_TEXT_MAX and marked; a short one is not marked", async () => {
  const c = card("long-one");
  const { memory } = stubMemory({ lessons: { ownerChainBroken: false, lessons: [lesson({ id: "long-one", state: "unarmed", file: text(c, "x".repeat(20_000)) }), lesson({ id: "short-one", state: "unarmed", file: text(card("short-one")) })] } });
  const answer = await createMemoryScreen({ open: connected(memory) }).lessons();
  assert.ok(answer.connected);
  const long = answer.lessons[0].file!;
  assert.equal(SCREEN_TEXT_MAX, 16_384);
  assert.equal(long.text.length, SCREEN_TEXT_MAX);
  assert.equal(long.cut, true);
  assert.equal("cut" in answer.lessons[1].file!, false);
});

test("lessons: an id off the lesson shape is served with no command at all", async () => {
  const { memory } = stubMemory({ lessons: { ownerChainBroken: false, lessons: [lesson({ id: "bad name", state: "unarmed", file: text(card("bad name")) }), lesson({ id: "x;rm", state: "armed", armed: text(card("x;rm")) })] } });
  const answer = await createMemoryScreen({ open: connected(memory) }).lessons();
  assert.ok(answer.connected);
  assert.deepEqual(answer.lessons.map((row) => [row.id, row.commands]), [["bad name", {}], ["x;rm", {}]]);
});

/** A decision view with `id`, void or not. */
const decision = (id: string, isVoid: boolean): DecisionView => ({ line: { id } as DecisionView["line"], amends: [], void: isVoid, open: !isVoid, reviewed: false, decidedMs: 1 });

test("decisions: the filter as given; a void command on a decision not void; none on a void one", async () => {
  const { memory, calls } = stubMemory({
    decisions: { items: [{ view: decision("d-20260302-0f3a9c21", false), figures: [] }, { view: decision("d-20260301-00000000", true), figures: [] }, { view: decision("d-bad", false), figures: [] }], more: true },
  });
  const screen = createMemoryScreen({ open: connected(memory) });
  const answer = await screen.decisions({ symbol: "NVDA", limit: 5 });
  assert.ok(answer.connected);
  assert.deepEqual(calls[0], ["decisions", [{ symbol: "NVDA", limit: 5 }]]);
  assert.equal(answer.more, true);
  assert.equal(answer.items[0].command, `npx --no gravit-memory void d-20260302-0f3a9c21 --reason ${PH} --home /h`);
  assert.equal("command" in answer.items[1], false);
  assert.equal("command" in answer.items[2], false, "an id off the decision shape carries no command");
  await screen.decisions({});
  assert.deepEqual(calls[1], ["decisions", [{}]]);
  await screen.decisions({ before: "d-20260302-0f3a9c21", symbol: undefined });
  assert.deepEqual(calls[2], ["decisions", [{ before: "d-20260302-0f3a9c21" }]]);
});

test("waiting: the proposals, the decisions past their horizon, the count without a wrong-if, and the review command", async () => {
  const proposals = [{ id: "p-20261101-0a0b0c0d", kind: "proposal", what: "new", lesson: "no-chasing", reason: "why" }] as unknown as ProposalLine[];
  const review = { since: "", measured: [], cards: [], tags_shared: [], past_horizon: ["d-20260302-0f3a9c21"], without_wrong_if: 3, voided: [], proposals } as Review;
  const { memory, calls } = stubMemory({ review });
  const answer = await createMemoryScreen({ open: connected(memory) }).waiting();
  assert.deepEqual(answer, { connected: true, proposals, pastHorizon: ["d-20260302-0f3a9c21"], withoutWrongIf: 3, command: "npx --no gravit-memory review --home /h" });
  assert.deepEqual(calls, [["review", []]]);
});

test("health: the status's home, lines, partial, chains and prices; the face's facts; the five commands; no card and no tag", async () => {
  const status = {
    home: "/h", version: 1, lines: { "decisions.jsonl": 4, "owner.jsonl": 2 }, partial: ["outcomes.jsonl"],
    chains: [{ file: "owner.jsonl", ok: false, line: 2 }], cards: [{ id: "no-chasing", state: "armed" }],
    facts: [{ card: "no-chasing", fact: "sector", definition: "d", checked: [] }], tags: [{ tag: "secret-tag", count: 1 }],
    prices: { url: "http://127.0.0.1:4821", last: { t: "2026-11-15T00:00:00Z", ok: true, refused: 0, asked: 2 } },
  } as unknown as Status;
  const { memory } = stubMemory({ status });
  const answer = await createMemoryScreen({ open: connected(memory) }).health();
  assert.deepEqual(answer, {
    connected: true, home: "/h", lines: status.lines, partial: status.partial, chains: status.chains, prices: status.prices, facts: FACE_FACTS,
    commands: ["status", "verify", "reconcile", "review", "reseal"].map((name) => ({ name, line: `npx --no gravit-memory ${name} --home /h` })),
  });
  assert.doesNotMatch(JSON.stringify(answer), /secret-tag|"cards"|no-chasing/);
});

test("not connected: a standing that is not connected answers from every read with the init command and no --home", async () => {
  const say = "the memory is not connected: the mcp-memory row is disabled";
  const screen = createMemoryScreen({ open: async () => ({ connected: false, why: "disabled", say }) });
  const expected = { connected: false, why: "disabled", say, command: "npx --no gravit-memory init" };
  assert.deepEqual(await screen.lessons(), expected);
  assert.deepEqual(await screen.decisions({}), expected);
  assert.deepEqual(await screen.waiting(), expected);
  assert.deepEqual(await screen.health(), expected);
});

test("not connected: a read rejecting with E_NO_HOME is the home never made, with the init command for this home", async () => {
  const { memory } = stubMemory({ reject: Object.assign(new Error("no memory here"), { code: "E_NO_HOME" }) });
  const screen = createMemoryScreen({ open: connected(memory) });
  const expected = { connected: false, why: "no home", say: NO_MEMORY_HERE, command: "npx --no gravit-memory init --home /h" };
  assert.deepEqual(await screen.lessons(), expected);
  assert.deepEqual(await screen.decisions({ limit: 1 }), expected);
  assert.deepEqual(await screen.waiting(), expected);
  assert.deepEqual(await screen.health(), expected);
});

test("a read rejecting with another code is a ScreenFault of fault, its cause kept", async () => {
  const cause = Object.assign(new Error("owner.jsonl is not readable"), { code: "E_IO" });
  const { memory } = stubMemory({ reject: cause });
  const screen = createMemoryScreen({ open: connected(memory) });
  for (const read of [() => screen.lessons(), () => screen.decisions({}), () => screen.waiting(), () => screen.health()]) {
    await assert.rejects(read(), (error: unknown) => error instanceof ScreenFault && error.why === "fault" && error.cause === cause);
  }
  await assert.rejects(createMemoryScreen({ open: async () => { throw new Error("refused"); } }).lessons(), (error: unknown) => error instanceof ScreenFault && error.why === "fault");
});

test("a read that never answers rejects at SCREEN_READ_MS on the injected timer as late; a read that wins clears its timer", async () => {
  let fire: (() => void) | undefined;
  let armedMs = 0;
  const cleared: unknown[] = [];
  const timers = {
    setTimer: (run: () => void, ms: number) => { fire = run; armedMs = ms; return "timer-1"; },
    clearTimer: (timer: unknown) => { cleared.push(timer); },
  };
  let answerLate: ((value: unknown) => void) | undefined;
  const memory = { lessons: () => new Promise((resolve) => { answerLate = resolve; }) } as unknown as Memory;
  const pending = createMemoryScreen({ open: connected(memory), ...timers }).lessons();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(armedMs, SCREEN_READ_MS);
  assert.equal(SCREEN_READ_MS, 5_000);
  fire!();
  await assert.rejects(pending, (error: unknown) => error instanceof ScreenFault && error.why === "late");
  answerLate!({ ownerChainBroken: false, lessons: [] });
  await new Promise((resolve) => setImmediate(resolve));

  const { memory: quick } = stubMemory({ lessons: { ownerChainBroken: false, lessons: [] } });
  cleared.length = 0;
  const answer = await createMemoryScreen({ open: connected(quick), ...timers }).lessons();
  assert.deepEqual(answer, { connected: true, ownerChainBroken: false, lessons: [] });
  assert.deepEqual(cleared, ["timer-1"]);
});

test("a late answer that then rejects is swallowed, not an unhandled rejection", async () => {
  let fire: (() => void) | undefined;
  let rejectLate: ((error: unknown) => void) | undefined;
  const memory = { status: () => new Promise((_, reject) => { rejectLate = reject; }) } as unknown as Memory;
  const pending = createMemoryScreen({ open: connected(memory), setTimer: (run) => { fire = run; return 1; }, clearTimer: () => {} }).health();
  await new Promise((resolve) => setImmediate(resolve));
  fire!();
  await assert.rejects(pending, (error: unknown) => error instanceof ScreenFault && error.why === "late");
  rejectLate!(new Error("late"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("commandOf: a home with a space is double-quoted; no home has no --home", () => {
  assert.equal(commandOf("/Users/a b/home", ["arm", "x"]), "npx --no gravit-memory arm x --home \"/Users/a b/home\"");
  assert.equal(commandOf("~/.gravit-memory", ["status"]), "npx --no gravit-memory status --home ~/.gravit-memory");
  assert.equal(commandOf(undefined, ["init"]), "npx --no gravit-memory init");
  assert.equal(commandOf("/a\"$b`c\\d", ["init"]), "npx --no gravit-memory init --home \"/a\\\"\\$b\\`c\\\\d\"", "the shell's specials inside double quotes are escaped");
});

test("FACE_FACTS: the seven names in order, each definition one sentence naming its source", () => {
  assert.deepEqual(FACE_FACTS.map((f) => f.fact), ["price", "change_1d_pct", "change_5d_pct", "change_20d_pct", "change_60d_pct", "held", "unrealized_pct"]);
  for (const { fact, definition } of FACE_FACTS) {
    assert.ok(definition.length <= 160, `${fact}: at most 160 characters`);
    assert.match(definition, /^[A-Z][^.]*\.$/, `${fact}: one sentence`);
    assert.match(definition, /the Market's|the Account's/, `${fact}: names its source`);
  }
});
