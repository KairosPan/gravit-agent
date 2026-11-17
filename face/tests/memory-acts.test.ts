/** src/memory-acts.ts: the owner's acts on the memory, on a stub memory answering fixtures and a stub `exchange`
 * recording what it is given: `lineHash` and `digestOf`; `prepare`, each act's show, its draft and its refusals;
 * `perform`, its nine steps in order - the body's shape, the envelope as this act's, fresh and not done, the memory
 * connected, the content read and its digest recomputed, the Account's yes, the envelope done, the content read again
 * and its digest recomputed, then the memory's own act - one at a time. */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Card, DecisionLine, DecisionView, LessonView, Memory, ProposalLine } from "gravit-memory";
import type { MemoryStanding } from "../src/memory.ts";
import { SCREEN_TEXT_MAX } from "../src/memory-screen.ts";
import type { UpstreamAnswer } from "../src/upstream-proxy.ts";
import {
  ACTS, ACT_DONE_KEPT, ACT_FRESH_MS, ACT_READ_MS, MEMORY_SERVICE, WORDED, createMemoryActs, digestOf, lineHash,
  type ActAsk, type AttestDraft,
} from "../src/memory-acts.ts";

const NOW = 1_763_300_000_000;
const HOME = "/h";
const SAY = "the memory is not connected: the mcp-memory row is disabled";
const NOT_AN_ACT = "not an act the memory's screen takes";
const SAY_WHY = "say why in your own words: 1 to 500 characters";
const NO_WORDS = "this act takes no words";
const NOT_THIS = "the envelope is not an attest of this act";
const TOO_OLD = "it was signed too long ago: prepare it again";
const DONE = "this was done already";
const NO_ANSWER = "the Account did not answer: nothing was done";
const CHANGED = "it changed while it was shown: nothing was done";
const LATE = "the memory did not answer in time";
const TOO_LONG = "the card is too long to show whole here: use the terminal";

const hex = (c: string): string => c.repeat(64);
const card = (id: string): Card => ({ id, says: "dont", actions: ["buy"], strength: "caveat", words: `the words of ${id}` }) as Card;
const copy = (id: string, sha: string, text = `the text of ${id} at ${sha.slice(0, 4)}`) => ({ sha256: sha, text, card: card(id) });
const lesson = (view: Partial<LessonView> & Pick<LessonView, "id" | "state">): LessonView => ({ record: null, ...view });

const P_NEW = "p-20261110-0a1b2c3d";
const P_RETIRE = "p-20261111-0a1b2c3e";
const D_OPEN = "d-20261101-0a1b2c3d";
const D_VOID = "d-20261102-0a1b2c3e";

const proposal = (id: string, what: ProposalLine["what"], lessonId: string, sum: string): ProposalLine =>
  ({ v: 1, kind: "proposal", id, seq: 1, prev: null, t: "2026-11-10T00:00:00Z", by: "gravit", sum, what, lesson: lessonId, reason: "the reason", ...(what === "retire" ? {} : { card: card(lessonId) }) });
const decision = (id: string, sum: string, isVoid: boolean): DecisionView => ({
  line: { v: 1, kind: "decision", id, seq: 1, prev: null, t: "2026-11-01T00:00:00Z", by: "gravit", sum, action: "buy", whose: "agent", thesis: "the thesis" } as DecisionLine,
  amends: [], void: isVoid, open: true, reviewed: false, decidedMs: NOW,
});

/** The fixtures, changed in place by a test between prepare and perform. */
function fixtures() {
  return {
    lessons: [
      lesson({ id: "cut-losers", state: "unarmed", file: copy("cut-losers", hex("a")) }),
      lesson({ id: "no-chasing", state: "armed", armed: copy("no-chasing", hex("b")), file: copy("no-chasing", hex("b")) }),
      lesson({ id: "late-entry", state: "changed", armed: copy("late-entry", hex("c")), file: copy("late-entry", hex("d")) }),
      lesson({ id: "gone-file", state: "broken", armed: copy("gone-file", hex("e")) }),
      lesson({ id: "bad-card", state: "refused", file: { sha256: hex("f"), text: "not a card", fault: "no front matter" } }),
      lesson({ id: "old-one", state: "retired", file: copy("old-one", hex("9")) }),
    ] as LessonView[],
    proposals: [proposal(P_NEW, "new", "new-lesson", hex("1")), proposal(P_RETIRE, "retire", "no-chasing", hex("2")), proposal("p-20261112-0a1b2c3f", "change", "late-entry", hex("3"))],
    decisions: [decision(D_OPEN, hex("4"), false), decision(D_VOID, hex("5"), true)],
  };
}

/** Owner acts that answer in place of the stub's own, by name. */
type OwnerStubs = Partial<Record<string, (...args: unknown[]) => Promise<unknown>>>;

const coded = (code: string, message: string): Error => Object.assign(new Error(message), { code });

/** A memory over `fx`: its reads answer the fixtures as they stand; each owner act is recorded with its arguments. */
function stubMemory(fx = fixtures(), o: { hang?: boolean; owner?: OwnerStubs } = {}) {
  const owner: Array<[string, unknown[]]> = [];
  const hang = <T>(value: () => T): Promise<T> => (o.hang ? new Promise(() => {}) : Promise.resolve().then(value));
  const act = (name: string, answer: (...args: unknown[]) => unknown) => async (...args: unknown[]) => {
    owner.push([name, args]);
    const own = o.owner?.[name];
    return own === undefined ? answer(...args) : own(...args);
  };
  const memory = {
    home: HOME,
    lessons: () => hang(() => ({ ownerChainBroken: false, lessons: fx.lessons })),
    review: () => hang(() => ({ proposals: fx.proposals, past_horizon: [], without_wrong_if: 0 })),
    show: (id: string) => hang(() => {
      const d = fx.decisions.find((v) => v.line.id === id);
      if (d !== undefined) return { decision: d, figures: [] };
      if (/^d-/.test(id)) throw coded("E_NOT_FOUND", `decision ${id} is not in the memory.`);
      throw coded("E_NOT_FOUND", `lesson ${id} is not a card in the memory.`);
    }),
    owner: {
      arm: act("arm", (_l, expect) => ({ sha256: expect })),
      retire: act("retire", () => undefined),
      discard: act("discard", () => undefined),
      accept: act("accept", (p) => ({ lesson: fx.proposals.find((x) => x.id === p)?.lesson })),
      edit: act("edit", (p) => ({ lesson: "new-lesson", path: `${HOME}/lessons/new-lesson.md`, p })),
      reject: act("reject", () => undefined),
      void: act("void", () => undefined),
    },
  } as unknown as Memory;
  return { memory, owner, fx };
}

const yes = (): UpstreamAnswer => ({ status: 200, body: JSON.stringify({ ok: true, kind: "account", summary: "the owner attested" }) });

/** The acts over a stub memory, a stub exchange answering `answer`, and a clock at `now`. */
function actsWith(o: { fx?: ReturnType<typeof fixtures>; standing?: MemoryStanding; answer?: (envelope: unknown) => Promise<UpstreamAnswer> | UpstreamAnswer; now?: () => number; hang?: boolean; owner?: OwnerStubs } = {}) {
  const stub = stubMemory(o.fx, { hang: o.hang, owner: o.owner });
  const sent: unknown[] = [];
  const logs: string[] = [];
  const acts = createMemoryActs({
    open: async () => o.standing ?? { connected: true, memory: stub.memory, home: HOME },
    exchange: async (envelope) => { sent.push(envelope); return (o.answer ?? yes)(envelope); },
    log: (line) => logs.push(line),
    now: o.now ?? (() => NOW),
  });
  return { acts, sent, logs, ...stub };
}

/** A signed envelope over `draft`, its nonce `nonce`. */
const envelopeOf = (draft: AttestDraft, nonce = NOW) => ({ action: { ...draft, nonce }, nonce, signature: "c2lnbmVk" });

/** Prepare `ask`, expecting a draft; the body perform takes for it. */
async function prepared(acts: ReturnType<typeof actsWith>["acts"], ask: { act: string; subject: string; words?: string }, nonce = NOW) {
  const answer = await acts.prepare(ask);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  if (!answer.ok) throw new Error("refused");
  assert.ok(answer.draft !== null);
  return { answer, body: { ...ask, envelope: envelopeOf(answer.draft!, nonce) } };
}

const refusal = (answer: unknown, status: number, error: string, why?: string): void => {
  assert.equal((answer as { ok: boolean }).ok, false, JSON.stringify(answer));
  assert.equal((answer as { status: number }).status, status, why ?? JSON.stringify(answer));
  assert.equal((answer as { error: string }).error, error, why);
};
/** A refusal for content found changed: the sentence, a 409, and `changed: true`. */
const changedRefusal = (answer: unknown): void => {
  refusal(answer, 409, CHANGED);
  assert.equal((answer as { changed?: unknown }).changed, true, JSON.stringify(answer));
};

test("the constants: the service, the seven acts, the worded three and the limits", () => {
  assert.equal(MEMORY_SERVICE, "gravit-memory");
  assert.deepEqual([...ACTS], ["arm", "retire", "discard", "accept", "edit", "reject", "void"]);
  assert.deepEqual([...WORDED].sort(), ["reject", "retire", "void"]);
  assert.equal(ACT_FRESH_MS, 600_000);
  assert.equal(ACT_READ_MS, 5_000);
  assert.equal(ACT_DONE_KEPT, 500);
});

test("digestOf: SHA-256 of the versioned line, content's keys sorted; one character apart is another digest; no words is \"\"", () => {
  const ask: ActAsk = { act: "discard", subject: "late-entry", words: "" };
  const d = digestOf(ask, { armed: hex("c"), file: hex("d") });
  const line = JSON.stringify({ v: 1, service: "gravit-memory", act: "discard", subject: "late-entry", content: { armed: hex("c"), file: hex("d") }, words: "" });
  assert.equal(d, createHash("sha256").update(line).digest("hex"));
  assert.match(d, /^[0-9a-f]{64}$/);
  assert.equal(digestOf(ask, { file: hex("d"), armed: hex("c") }), d, "the order of content's keys does not count");
  assert.notEqual(digestOf({ ...ask, act: "retire" }, { armed: hex("c"), file: hex("d") }), d, "another act");
  assert.notEqual(digestOf({ ...ask, subject: "late-entrz" }, { armed: hex("c"), file: hex("d") }), d, "another subject");
  assert.notEqual(digestOf(ask, { armed: `${hex("c").slice(0, 63)}d`, file: hex("d") }), d, "a content hash one character apart");
  const worded: ActAsk = { act: "retire", subject: "no-chasing", words: "it never fired" };
  assert.notEqual(digestOf(worded, { armed: hex("b") }), digestOf({ ...worded, words: "it never firee" }, { armed: hex("b") }), "words one character apart");
  assert.equal(digestOf({ act: "arm", subject: "cut-losers" } as ActAsk, { file: hex("a") }), digestOf({ act: "arm", subject: "cut-losers", words: "" }, { file: hex("a") }));
});

test("lineHash: SHA-256 of the line as canonical JSON - equal whatever the keys' order, another for one character anywhere", () => {
  const line = { v: 1, kind: "proposal", id: P_NEW, sum: hex("1"), card: { id: "x", words: "do not chase", actions: ["buy", "add"] }, evidence: ["d-1", "d-2"] };
  const canonical = '{"card":{"actions":["buy","add"],"id":"x","words":"do not chase"},"evidence":["d-1","d-2"],"id":"' + P_NEW + '","kind":"proposal","sum":"' + hex("1") + '","v":1}';
  assert.equal(lineHash(line), createHash("sha256").update(canonical).digest("hex"));
  assert.match(lineHash(line), /^[0-9a-f]{64}$/);
  const reordered = { evidence: ["d-1", "d-2"], card: { actions: ["buy", "add"], words: "do not chase", id: "x" }, sum: hex("1"), id: P_NEW, kind: "proposal", v: 1 };
  assert.equal(lineHash(reordered), lineHash(line), "the keys' order does not count, at any depth");
  const apart: Array<[string, unknown]> = [
    ["a top-level field", { ...line, id: "p-20261110-0a1b2c3e" }],
    ["a nested field", { ...line, card: { ...line.card, words: "do not chasE" } }],
    ["an array's item", { ...line, card: { ...line.card, actions: ["buy", "adD"] } }],
    ["an array's order", { ...line, evidence: ["d-2", "d-1"] }],
    ["a key more", { ...line, extra: "" }],
    ["a number for a string", { ...line, v: "1" }],
  ];
  for (const [what, other] of apart) assert.notEqual(lineHash(other), lineHash(line), what);
  assert.equal(lineHash({ ...line, gone: undefined }), lineHash(line), "a key whose value is undefined is left out, as JSON leaves it");
});

test("prepare, each act: the show and a draft whose digest covers that act's content", async () => {
  const { acts } = actsWith();
  const draft = (act: string, subject: string, digest: string) => ({ type: "attest", service: "gravit-memory", act, subject, digest });
  const fx = fixtures();

  const arm = await acts.prepare({ act: "arm", subject: "cut-losers" });
  assert.deepEqual(arm, { ok: true, show: { kind: "card", lesson: "cut-losers", state: "unarmed", text: fx.lessons[0].file!.text }, draft: draft("arm", "cut-losers", digestOf({ act: "arm", subject: "cut-losers", words: "" }, { file: hex("a") })) });

  const discard = await acts.prepare({ act: "discard", subject: "late-entry" });
  assert.deepEqual(discard, { ok: true, show: { kind: "card", lesson: "late-entry", state: "changed", text: fx.lessons[2].file!.text, armedText: fx.lessons[2].armed!.text }, draft: draft("discard", "late-entry", digestOf({ act: "discard", subject: "late-entry", words: "" }, { armed: hex("c"), file: hex("d") })) });

  const retire = await acts.prepare({ act: "retire", subject: "no-chasing", words: "  it never fired  " });
  assert.deepEqual(retire, { ok: true, show: { kind: "card", lesson: "no-chasing", state: "armed", text: fx.lessons[1].armed!.text }, draft: draft("retire", "no-chasing", digestOf({ act: "retire", subject: "no-chasing", words: "it never fired" }, { armed: hex("b") })) });

  const brokenRetire = await acts.prepare({ act: "retire", subject: "gone-file", words: "lost" });
  assert.equal(brokenRetire.ok, true);
  if (brokenRetire.ok) assert.equal(brokenRetire.draft!.digest, digestOf({ act: "retire", subject: "gone-file", words: "lost" }, { armed: hex("e") }));

  for (const act of ["accept", "edit"] as const) {
    const answer = await acts.prepare({ act, subject: P_NEW });
    assert.deepEqual(answer, { ok: true, show: { kind: "proposal", proposal: fx.proposals[0] }, draft: draft(act, P_NEW, digestOf({ act, subject: P_NEW, words: "" }, { proposal: lineHash(fx.proposals[0]), file: "none" })) });
  }
  const change = await acts.prepare({ act: "accept", subject: "p-20261112-0a1b2c3f" });
  assert.equal(change.ok, true);
  if (change.ok) assert.equal(change.draft!.digest, digestOf({ act: "accept", subject: "p-20261112-0a1b2c3f", words: "" }, { proposal: lineHash(fx.proposals[2]), file: hex("d") }), "its lesson's file hash");

  const reject = await acts.prepare({ act: "reject", subject: P_RETIRE, words: "not yet" });
  assert.deepEqual(reject, { ok: true, show: { kind: "proposal", proposal: fx.proposals[1] }, draft: draft("reject", P_RETIRE, digestOf({ act: "reject", subject: P_RETIRE, words: "not yet" }, { proposal: lineHash(fx.proposals[1]) })) });

  const voided = await acts.prepare({ act: "void", subject: D_OPEN, words: "a wrong entry" });
  assert.deepEqual(voided, { ok: true, show: { kind: "decision", decision: fx.decisions[0].line }, draft: draft("void", D_OPEN, digestOf({ act: "void", subject: D_OPEN, words: "a wrong entry" }, { decision: lineHash(fx.decisions[0].line) })) });
});

test("prepare: a card whose text would be shown cut is not armed, discarded or retired here - 409 for the terminal; at SCREEN_TEXT_MAX it is shown whole", async () => {
  const long = "x".repeat(SCREEN_TEXT_MAX + 1);
  const fx = fixtures();
  fx.lessons[0] = lesson({ id: "cut-losers", state: "unarmed", file: copy("cut-losers", hex("a"), long) });
  fx.lessons[1] = lesson({ id: "no-chasing", state: "armed", armed: copy("no-chasing", hex("b"), long), file: copy("no-chasing", hex("b"), long) });
  fx.lessons[2] = lesson({ id: "late-entry", state: "changed", armed: copy("late-entry", hex("c"), long), file: copy("late-entry", hex("d")) });
  const { acts, sent } = actsWith({ fx });
  refusal(await acts.prepare({ act: "arm", subject: "cut-losers" }), 409, TOO_LONG);
  refusal(await acts.prepare({ act: "retire", subject: "no-chasing", words: "why" }), 409, TOO_LONG);
  refusal(await acts.prepare({ act: "retire", subject: "no-chasing" }), 409, TOO_LONG);
  refusal(await acts.prepare({ act: "discard", subject: "late-entry" }), 409, TOO_LONG, "the armed copy's text cut is enough");
  assert.equal(sent.length, 0);
  fx.lessons[0] = lesson({ id: "cut-losers", state: "unarmed", file: copy("cut-losers", hex("a"), "x".repeat(SCREEN_TEXT_MAX)) });
  const whole = await acts.prepare({ act: "arm", subject: "cut-losers" });
  assert.equal(whole.ok, true);
  if (whole.ok && whole.show.kind === "card") {
    assert.equal(whole.show.text.length, SCREEN_TEXT_MAX);
    assert.equal("cut" in whole.show, false);
  }
});

test("prepare: a worded act with no words is the show and no draft; words of spaces, 501 characters, or words for arm are refused", async () => {
  const { acts } = actsWith();
  for (const [act, subject] of [["retire", "no-chasing"], ["reject", P_NEW], ["void", D_OPEN]] as const) {
    const answer = await acts.prepare({ act, subject });
    assert.equal(answer.ok, true, act);
    if (answer.ok) assert.equal(answer.draft, null, act);
    if (answer.ok) assert.ok(answer.show !== undefined);
    refusal(await acts.prepare({ act, subject, words: "   \n " }), 400, SAY_WHY);
    refusal(await acts.prepare({ act, subject, words: "y".repeat(501) }), 400, SAY_WHY);
    const full = await acts.prepare({ act, subject, words: "y".repeat(500) });
    assert.equal(full.ok, true, "500 characters are taken");
  }
  refusal(await acts.prepare({ act: "arm", subject: "cut-losers", words: "because" }), 400, NO_WORDS);
});

test("prepare refusals: off the acts or off a shape, not there, not askable, not connected, late", async (t) => {
  const { acts } = actsWith();
  for (const body of [null, "arm", [], { act: "delete", subject: "cut-losers" }, { act: "arm", subject: "Cut-losers" }, { act: "accept", subject: "p-2026111-0a1b2c3d" },
    { act: "void", subject: P_NEW }, { act: "arm" }, { act: "toString", subject: "cut-losers" }]) {
    refusal(await acts.prepare(body), 400, NOT_AN_ACT);
  }
  refusal(await acts.prepare({ act: "arm", subject: "no-such" }), 404, "lesson no-such is not a card in the memory.");
  refusal(await acts.prepare({ act: "void", subject: "d-20261103-0a1b2c3d" }), 404, "decision d-20261103-0a1b2c3d is not in the memory.");
  const noProposal = await acts.prepare({ act: "accept", subject: "p-20261103-0a1b2c3d" });
  assert.equal((noProposal as { status: number }).status, 404);

  const conflicts: Array<[{ act: string; subject: string; words?: string }, RegExp]> = [
    [{ act: "arm", subject: "no-chasing" }, /no-chasing is armed/],
    [{ act: "arm", subject: "bad-card" }, /bad-card is refused/],
    [{ act: "arm", subject: "gone-file" }, /gone-file is broken/],
    [{ act: "discard", subject: "no-chasing" }, /no-chasing is armed/],
    [{ act: "retire", subject: "cut-losers", words: "why" }, /cut-losers is unarmed/],
    [{ act: "retire", subject: "old-one", words: "why" }, /old-one is retired/],
    [{ act: "edit", subject: P_RETIRE }, /retire/],
    [{ act: "void", subject: D_VOID, words: "why" }, /is void/],
  ];
  for (const [ask, words] of conflicts) {
    const answer = await acts.prepare(ask) as { ok: boolean; status: number; error: string };
    assert.equal(answer.ok, false, JSON.stringify(ask));
    assert.equal(answer.status, 409, JSON.stringify(ask));
    assert.match(answer.error, words);
  }

  const off = actsWith({ standing: { connected: false, why: "disabled", say: SAY } });
  refusal(await off.acts.prepare({ act: "arm", subject: "cut-losers" }), 503, SAY);

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const slow = actsWith({ hang: true });
  const late = slow.acts.prepare({ act: "arm", subject: "cut-losers" });
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(ACT_READ_MS);
  refusal(await late, 504, LATE);
});

test("perform, an arm: the three members to the Account, then owner.arm with the file's hash, the answer and one log line", async () => {
  const { acts, sent, owner, logs } = actsWith();
  const { body } = await prepared(acts, { act: "arm", subject: "cut-losers" });
  const answer = await acts.perform(body);
  assert.deepEqual(answer, { ok: true, act: "arm", subject: "cut-losers", sha256: hex("a") });
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0] as object).sort(), ["action", "nonce", "signature"]);
  assert.deepEqual(sent[0], { action: body.envelope.action, nonce: NOW, signature: "c2lnbmVk" });
  assert.deepEqual(owner, [["arm", ["cut-losers", hex("a")]]]);
  assert.deepEqual(logs, ["memory: the owner's arm of cut-losers is done"]);
});

test("perform, each other act: its own owner act with step 8's arguments; the words as typed after trimming", async () => {
  const { acts, owner } = actsWith();
  const run = async (ask: { act: string; subject: string; words?: string }) => acts.perform((await prepared(acts, ask)).body);
  assert.deepEqual(await run({ act: "retire", subject: "no-chasing", words: " it never fired " }), { ok: true, act: "retire", subject: "no-chasing" });
  assert.deepEqual(await run({ act: "discard", subject: "late-entry" }), { ok: true, act: "discard", subject: "late-entry" });
  assert.deepEqual(await run({ act: "accept", subject: P_NEW }), { ok: true, act: "accept", subject: P_NEW, lesson: "new-lesson" });
  assert.deepEqual(await run({ act: "edit", subject: "p-20261112-0a1b2c3f" }), { ok: true, act: "edit", subject: "p-20261112-0a1b2c3f", lesson: "new-lesson", path: `${HOME}/lessons/new-lesson.md` });
  assert.deepEqual(await run({ act: "reject", subject: P_RETIRE, words: "not yet" }), { ok: true, act: "reject", subject: P_RETIRE });
  assert.deepEqual(await run({ act: "void", subject: D_OPEN, words: "\n  a wrong entry,\nmade twice  " }), { ok: true, act: "void", subject: D_OPEN });
  assert.deepEqual(owner, [
    ["retire", ["no-chasing", "it never fired"]],
    ["discard", ["late-entry"]],
    ["accept", [P_NEW]],
    ["edit", ["p-20261112-0a1b2c3f"]],
    ["reject", [P_RETIRE, "not yet"]],
    ["void", [D_OPEN, "a wrong entry,\nmade twice"]],
  ]);
});

test("perform, step 1: a body off its shape is refused before anything else", async () => {
  const { acts, sent } = actsWith();
  const { body } = await prepared(acts, { act: "retire", subject: "no-chasing", words: "why" });
  refusal(await acts.perform({ ...body, envelope: undefined }), 400, NOT_AN_ACT);
  refusal(await acts.perform({ ...body, envelope: { ...body.envelope, action: "attest" } }), 400, NOT_AN_ACT);
  refusal(await acts.perform({ ...body, subject: "No-chasing" }), 400, NOT_AN_ACT);
  refusal(await acts.perform({ ...body, words: "  " }), 400, SAY_WHY);
  refusal(await acts.perform({ ...body, words: undefined }), 400, SAY_WHY);
  refusal(await acts.perform({ act: "arm", subject: "cut-losers", words: "x", envelope: body.envelope }), 400, NO_WORDS);
  assert.equal(sent.length, 0);
});

test("perform, step 2: an envelope that is not this act's attest is never forwarded", async () => {
  const { acts, sent } = actsWith();
  const { body } = await prepared(acts, { act: "retire", subject: "no-chasing", words: "why" });
  const action = body.envelope.action;
  const bad = [
    { ...body.envelope, action: { type: "setWatch", venue: "ex", symbol: "SOL/USDT", on: "true", nonce: NOW } },
    { ...body.envelope, action: { ...action, service: "other" } },
    { ...body.envelope, action: { ...action, act: "arm" } },
    { ...body.envelope, action: { ...action, subject: "late-entry" } },
    { ...body.envelope, action: { ...action, digest: action.digest.slice(1) } },
    { ...body.envelope, action: { ...action, digest: action.digest.toUpperCase() } },
    { ...body.envelope, nonce: NOW + 1 },
    { ...body.envelope, action: { ...action, nonce: NOW + 0.5 }, nonce: NOW + 0.5 },
  ];
  for (const envelope of bad) refusal(await acts.perform({ ...body, envelope }), 400, NOT_THIS);
  refusal(await acts.perform({ ...body, act: "arm", words: undefined }), 400, NOT_THIS);
  refusal(await acts.perform({ ...body, subject: "late-entry" }), 400, NOT_THIS);
  assert.equal(sent.length, 0, "nothing is forwarded");
});

test("perform, step 3: ten minutes on the face's clock either side, and an envelope done once", async () => {
  const { acts, sent, owner } = actsWith();
  const old = await prepared(acts, { act: "arm", subject: "cut-losers" }, NOW - ACT_FRESH_MS - 1);
  refusal(await acts.perform(old.body), 409, TOO_OLD);
  const ahead = await prepared(acts, { act: "arm", subject: "cut-losers" }, NOW + ACT_FRESH_MS + 1);
  refusal(await acts.perform(ahead.body), 409, TOO_OLD);
  assert.equal(sent.length, 0);
  const edge = await prepared(acts, { act: "arm", subject: "cut-losers" }, NOW - ACT_FRESH_MS);
  assert.equal((await acts.perform(edge.body)).ok, true, "exactly ten minutes is forwarded");
  refusal(await acts.perform(edge.body), 409, DONE);
  assert.equal(sent.length, 1, "exchange was called once");
  assert.equal(owner.length, 1);
});

test("perform, step 4: a memory not connected is 503 with its say, and nothing is forwarded", async () => {
  const { acts: prep } = actsWith();
  const { body } = await prepared(prep, { act: "arm", subject: "cut-losers" });
  const off = actsWith({ standing: { connected: false, why: "disabled", say: SAY } });
  refusal(await off.acts.perform(body), 503, SAY);
  assert.equal(off.sent.length, 0);
});

test("perform, step 5: no answer, a refusal or anything but a 200 with ok: nothing done, and a refused envelope is not among those done", async () => {
  let answer: UpstreamAnswer = { unreachable: "ECONNREFUSED" };
  const { acts, owner, sent } = actsWith({ answer: () => answer });
  const { body } = await prepared(acts, { act: "arm", subject: "cut-losers" });
  refusal(await acts.perform(body), 502, NO_ANSWER);
  answer = { unreachable: "disabled" };
  refusal(await acts.perform(body), 502, NO_ANSWER);
  const badSignature = { code: "E_ACCOUNT_BAD_SIGNATURE", message: "the signature does not verify" };
  answer = { status: 401, body: JSON.stringify({ ok: false, refusal: badSignature }) };
  const r401 = await acts.perform(body);
  refusal(r401, 401, "the signature does not verify");
  assert.deepEqual((r401 as { refusal: unknown }).refusal, badSignature);
  const threshold = { code: "E_ACCOUNT_THRESHOLD", message: "two of your devices sign this" };
  answer = { status: 409, body: JSON.stringify({ ok: false, refusal: threshold }) };
  const r409 = await acts.perform(body);
  refusal(r409, 409, "two of your devices sign this");
  assert.deepEqual((r409 as { refusal: unknown }).refusal, threshold);
  answer = { status: 200, body: JSON.stringify({ ok: false }) };
  const r200 = await acts.perform(body) as { ok: boolean };
  assert.equal(r200.ok, false, "a 200 whose ok is false is a refusal");
  answer = { status: 200, body: "not json" };
  assert.equal((await acts.perform(body)).ok, false, "a body that is not JSON is a refusal");
  assert.equal(owner.length, 0, "no owner act");
  answer = yes();
  assert.equal((await acts.perform(body)).ok, true, "the same body with a good answer afterwards is done");
  assert.equal(sent.length, 7);
  assert.equal(owner.length, 1);
});

test("perform, step 5: the content moved before the Account is asked - nothing forwarded, nothing done, and the envelope not among those done", async () => {
  const { acts, owner, fx, sent, logs } = actsWith();
  const { body } = await prepared(acts, { act: "arm", subject: "cut-losers" });
  fx.lessons[0] = lesson({ id: "cut-losers", state: "unarmed", file: copy("cut-losers", hex("7")) });
  changedRefusal(await acts.perform(body));
  changedRefusal(await acts.perform(body));
  assert.equal(sent.length, 0, "an act already stale spends no signature");
  assert.equal(owner.length, 0);
  assert.deepEqual(logs, []);
  fx.lessons[0] = lesson({ id: "cut-losers", state: "unarmed", file: copy("cut-losers", hex("a")) });
  assert.equal((await acts.perform(body)).ok, true, "the file as signed again: done");
});

test("perform, step 8: the content moved while the Account answered - nothing done, the envelope done, and one line in the log", async () => {
  const fx = fixtures();
  const { acts, owner, logs } = actsWith({ fx, answer: () => { fx.lessons[0] = lesson({ id: "cut-losers", state: "unarmed", file: copy("cut-losers", hex("7")) }); return yes(); } });
  const { body } = await prepared(acts, { act: "arm", subject: "cut-losers" });
  changedRefusal(await acts.perform(body));
  assert.equal(owner.length, 0);
  assert.deepEqual(logs, [`memory: the owner's arm of cut-losers was attested and not done: ${CHANGED}`]);
  refusal(await acts.perform(body), 409, DONE);
});

test("perform: an act that may no longer be asked is refused as changed", async () => {
  const { acts, owner, fx, sent } = actsWith();
  const { body } = await prepared(acts, { act: "void", subject: D_OPEN, words: "wrong" });
  fx.decisions[0] = decision(D_OPEN, hex("4"), true);
  changedRefusal(await acts.perform(body));
  const gone = await prepared(acts, { act: "reject", subject: P_NEW, words: "no" });
  fx.proposals.splice(0, 1);
  changedRefusal(await acts.perform(gone.body));
  assert.equal(owner.length, 0);
  assert.equal(sent.length, 0);
});

test("perform: a proposal's card words changed with its sum left as it was - changed, no owner act", async () => {
  for (const act of ["accept", "edit"] as const) {
    const { acts, owner, fx, sent } = actsWith();
    const { body } = await prepared(acts, { act, subject: P_NEW });
    const shown = fx.proposals[0]!;
    fx.proposals[0] = { ...shown, card: { ...shown.card!, words: "always buy, with all the leverage there is" } as Card };
    assert.equal(fx.proposals[0].sum, shown.sum, "the line's own sum is the same");
    changedRefusal(await acts.perform(body));
    assert.equal(owner.length, 0, act);
    assert.equal(sent.length, 0, act);
  }
  const { acts, owner, fx } = actsWith();
  const { body } = await prepared(acts, { act: "reject", subject: P_RETIRE, words: "not yet" });
  fx.proposals[1] = { ...fx.proposals[1]!, reason: "another reason" };
  changedRefusal(await acts.perform(body));
  assert.equal(owner.length, 0);
});

test("perform: a decision's thesis changed with its sum left as it was - a void is refused as changed, no owner act", async () => {
  const { acts, owner, fx } = actsWith();
  const { body } = await prepared(acts, { act: "void", subject: D_OPEN, words: "a wrong entry" });
  const shown = fx.decisions[0]!;
  fx.decisions[0] = { ...shown, line: { ...shown.line, thesis: "another thesis the owner never read" } };
  assert.equal(fx.decisions[0].line.sum, shown.line.sum);
  changedRefusal(await acts.perform(body));
  assert.equal(owner.length, 0);
});

test("perform: words are in the digest: a retire signed for one reason and posted with another is refused before the Account is asked", async () => {
  const { acts, owner, sent } = actsWith();
  const { body } = await prepared(acts, { act: "retire", subject: "no-chasing", words: "it never fired" });
  changedRefusal(await acts.perform({ ...body, words: "it fired too often" }));
  assert.equal(sent.length, 0, "nothing is forwarded");
  assert.equal(owner.length, 0);
});

test("perform, step 9: any throw of the memory's own act is 409 in its words, changed, and logged; an accept's lesson is passed on", async () => {
  const { acts, logs } = actsWith({ owner: { arm: async () => { throw coded("E_REFUSED", "the card changed while it was shown: nothing was armed."); } } });
  const { body } = await prepared(acts, { act: "arm", subject: "cut-losers" });
  const r = await acts.perform(body);
  refusal(r, 409, "the card changed while it was shown: nothing was armed.");
  assert.equal((r as { changed?: unknown }).changed, true);
  assert.deepEqual(logs, ["memory: the owner's arm of cut-losers was attested and not done: the card changed while it was shown: nothing was armed."]);
  const odd = actsWith({ owner: { discard: async () => { throw new Error("EIO: the disk\nfailed"); } } });
  const discarded = await prepared(odd.acts, { act: "discard", subject: "late-entry" });
  refusal(await odd.acts.perform(discarded.body), 409, "EIO: the disk failed");
  assert.deepEqual(odd.logs, ["memory: the owner's discard of late-entry was attested and not done: EIO: the disk failed"]);
  const other = actsWith({ owner: { accept: async () => ({ lesson: "the-lesson" }) } });
  const accepted = await prepared(other.acts, { act: "accept", subject: P_NEW });
  assert.deepEqual(await other.acts.perform(accepted.body), { ok: true, act: "accept", subject: P_NEW, lesson: "the-lesson" });
});

test("perform: a face that forgot those done (a restart) is given the same body - the Account's refusal passed on, no owner act", async () => {
  const one = actsWith();
  const { body } = await prepared(one.acts, { act: "arm", subject: "cut-losers" });
  assert.equal((await one.acts.perform(body)).ok, true);
  const used = { code: "E_ACCOUNT_NONCE", message: "this nonce was used before", detail: { nonce: NOW, verdict: "used" } };
  const two = actsWith({ answer: () => ({ status: 409, body: JSON.stringify({ ok: false, refusal: used }) }) });
  const again = await two.acts.perform(body);
  refusal(again, 409, "this nonce was used before");
  assert.deepEqual((again as { refusal: unknown }).refusal, used);
  assert.equal(two.sent.length, 1);
  assert.equal(two.owner.length, 0);
  assert.deepEqual(two.logs, []);
});

test("perform: a first perform that throws, then a second that is done - the chain goes on", async () => {
  let calls = 0;
  const { acts, owner } = actsWith({ now: () => { calls += 1; if (calls === 1) throw new Error("the clock failed"); return NOW; } });
  const { body } = await prepared(acts, { act: "arm", subject: "cut-losers" });
  await assert.rejects(acts.perform(body), /the clock failed/);
  assert.equal((await acts.perform(body)).ok, true);
  assert.equal(owner.length, 1);
});

test("perform: two at once - the second starts after the first has answered", async () => {
  let release!: (answer: UpstreamAnswer) => void;
  let calls = 0;
  const { acts, sent } = actsWith({ answer: () => (++calls === 1 ? new Promise<UpstreamAnswer>((r) => { release = r; }) : yes()) });
  const first = await prepared(acts, { act: "arm", subject: "cut-losers" });
  const second = await prepared(acts, { act: "discard", subject: "late-entry" });
  const one = acts.perform(first.body);
  const two = acts.perform(second.body);
  let twoDone = false;
  void two.then(() => { twoDone = true; });
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1, "the second waits for the first");
  assert.equal(twoDone, false);
  release(yes());
  assert.equal((await one).ok, true);
  assert.equal((await two).ok, true);
  assert.equal(sent.length, 2);
});

test("perform: past ACT_DONE_KEPT done, the oldest is forgotten - and an envelope that old is past its ten minutes anyway", async () => {
  let clock = NOW;
  const fx = fixtures();
  const asSigned = fx.lessons[0]!;
  /* The file moves while the Account answers, so step 8 refuses each envelope after the Account's yes: each is done
     and nothing is armed. Before each perform the file is put back as signed. */
  const { acts, sent, owner } = actsWith({ fx, now: () => clock, answer: () => { fx.lessons[0] = lesson({ id: "cut-losers", state: "unarmed", file: copy("cut-losers", hex("7")) }); return yes(); } });
  const { answer } = await prepared(acts, { act: "arm", subject: "cut-losers" });
  const bodyAt = (nonce: number) => ({ act: "arm", subject: "cut-losers", envelope: envelopeOf(answer.draft!, nonce) });
  const perform = (body: unknown) => { fx.lessons[0] = asSigned; return acts.perform(body); };
  const first = bodyAt(NOW);
  changedRefusal(await perform(first));
  refusal(await perform(first), 409, DONE);
  for (let i = 1; i <= ACT_DONE_KEPT; i += 1) changedRefusal(await perform(bodyAt(NOW + i)));
  changedRefusal(await perform(first));
  assert.equal(sent.length, ACT_DONE_KEPT + 2, "the oldest was forgotten, and forwarded again");
  refusal(await perform(bodyAt(NOW + ACT_DONE_KEPT)), 409, DONE);
  clock = NOW + ACT_FRESH_MS + 1;
  refusal(await perform(first), 409, TOO_OLD);
  assert.equal(owner.length, 0);
});

test("outside tests, src/memory-acts.ts is the only file under src that calls an owner act of the memory", () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|mts|js|mjs)$/.test(name)) files.push(path);
    }
  };
  walk(root);
  assert.ok(files.length > 50, "the scan reads the sources");
  const call = /\.owner\s*(?:\?\.|\.)\s*(?:arm|retire|discard|accept|edit|reject|void|reseal)\s*\(|\[\s*["'`]owner["'`]\s*\]/;
  const callers = files.filter((path) => call.test(readFileSync(path, "utf8"))).map((path) => relative(root, path));
  assert.deepEqual(callers, ["memory-acts.ts"]);
});
