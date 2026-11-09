/** The session-list normalization: whose preset a `session/list` row runs.
 *
 * THE BREAK THIS CLOSES (dsh 0.2.0-rc.2). `SessionSummary` lost its
 * `agentPreset` field (NEW packages/api/session-controller/src/types.ts:177-188);
 * the value now rides `projections.values.agentPreset`, and a cold row's block
 * may omit it. Read raw, every bot home session, every room member and every
 * bot-bucketed row silently reads as the host. `summaryOf` restores the field
 * at intake - projection first, the face's header hint second, never a guess -
 * so room.js, speaker.js and chat.js keep reading
 * `summary.agentPreset` unchanged.
 */
import test from "node:test";
import assert from "node:assert/strict";
// summaries.js is plain ESM JS (it ships to the browser); tsconfig `allowJs`
// lets this test import it, the same way speaker.test.ts imports speaker.js.
import { summaryOf, readProjections } from "../client/js/wire/summaries.js";
import { foldMembers } from "../client/js/wire/room.js";
import { speakerFor } from "../client/js/wire/speaker.js";

/** A 0.2.0 list row: no `agentPreset` field of its own. */
const row = (sessionId: string, values?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  agentAvailable: false, sessionId, updatedAt: 1, running: false, blank: false, cwd: "/c",
  ...(values === undefined ? {} : { projections: { kind: "cached", asOfSeq: 4, values } }),
  ...extra,
});

test("the projected preset wins over the header hint: it is the preset the session runs", () => {
  const out = summaryOf(row("s1", { agentPreset: "buffett", title: "t" }), { s1: "gravit" });
  assert.equal(out.agentPreset, "buffett");
});

test("the header hint fills in when the block is absent or omits the key", () => {
  assert.equal(summaryOf(row("s1"), { s1: "buffett" }).agentPreset, "buffett");
  assert.equal(summaryOf(row("s1", { title: "only a title" }), { s1: "buffett" }).agentPreset, "buffett");
});

test("the registry's null (no preset composed) defers to the hint rather than naming a preset", () => {
  assert.equal(summaryOf(row("s1", { agentPreset: null }), { s1: "buffett" }).agentPreset, "buffett");
  assert.equal("agentPreset" in summaryOf(row("s1", { agentPreset: null }), {}), false);
});

test("an absent value stays absent: no hint, no projection, no field - never a guess", () => {
  const out = summaryOf(row("s1", { title: "t" }), { other: "buffett" });
  assert.equal("agentPreset" in out, false);
  assert.equal("agentPreset" in summaryOf(row("s1"), undefined), false);
  assert.equal("agentPreset" in summaryOf(row("s1"), null), false);
});

test("blank or non-string values are not presets", () => {
  assert.equal("agentPreset" in summaryOf(row("s1", { agentPreset: "" }), { s1: "" }), false);
  assert.equal("agentPreset" in summaryOf(row("s1", { agentPreset: 42 }), { s1: { id: "buffett" } }), false);
});

test("a hint map is read by own keys only: a session id never reaches Object.prototype", () => {
  for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal("agentPreset" in summaryOf(row(id), {}), false, id);
  }
});

test("the row is copied, never mutated, and a second pass is idempotent", () => {
  const input = row("s1", { agentPreset: "buffett" });
  const once = summaryOf(input, {});
  assert.equal("agentPreset" in input, false, "the host's row is left as it arrived");
  assert.notEqual(once, input);
  assert.deepEqual(summaryOf(once, {}), once);
  // A session/create answer still names the preset (types.ts:292-296) and keeps it.
  assert.equal(summaryOf({ sessionId: "s2", agentPreset: "speculator" }, {}).agentPreset, "speculator");
});

test("a non-object row passes through untouched rather than throwing", () => {
  assert.equal(summaryOf(null as unknown as Record<string, unknown>, { s1: "x" }), null);
});

test("normalized rows restore the member fold and the speaker label the raw 0.2 rows lose", () => {
  const raw = [
    row("room", { agentPreset: "gravit" }),
    row("m1", undefined, { parentSessionId: "room" }), // cold, pre-upgrade: only the header knows
    row("m2", { agentPreset: "speculator" }, { parentSessionId: "room" }),
  ];
  // Raw: nobody is a member, because no row names a bot preset.
  assert.deepEqual([...foldMembers(raw).members], []);
  const hints = { room: "gravit", m1: "buffett" };
  const fold = foldMembers(raw.map((r) => summaryOf(r, hints)));
  assert.deepEqual([...fold.members].sort(), ["m1", "m2"]);
  const bots = [{ id: "buffett", name: "Buffett Type" }];
  assert.equal(speakerFor(summaryOf(raw[1], hints), bots), "Buffett Type");
  assert.equal(speakerFor(raw[1] as { agentPreset?: unknown }, bots), "Gravit", "the raw row is exactly the silent mislabel this closes");
});

// rc.5: `SessionSummary.formatStatus?: 'current' | 'migration-required'` and the kinded `SessionProjectionsValue` union
// (@deepseek-ai/dsh-api-session-controller/lib/types/types.d.ts).
test("a row's formatStatus rides through; an unknown value is dropped, never guessed", () => {
  assert.equal(summaryOf(row("s1", undefined, { formatStatus: "migration-required" })).formatStatus, "migration-required");
  assert.equal(summaryOf(row("s1", undefined, { formatStatus: "current" })).formatStatus, "current");
  assert.equal("formatStatus" in summaryOf(row("s1")), false, "an unreported status stays unreported");
  assert.equal("formatStatus" in summaryOf(row("s1", undefined, { formatStatus: "stale" })), false);
  assert.equal("formatStatus" in summaryOf(row("s1", undefined, { formatStatus: 3 })), false);
});

test("readProjections reads a sequenced cut: the log cursor, the values, no migration", () => {
  const values = { title: "t" };
  assert.deepEqual(readProjections({ kind: "sequenced", asOfSeq: 7, values }), { asOfSeq: 7, values, migrationRequired: false });
  assert.deepEqual(readProjections({ kind: "sequenced", asOfSeq: -1, values: {} }), { asOfSeq: -1, values: {}, migrationRequired: false }, "-1 is an empty log");
});

test("readProjections reads a migration-required answer: values are sequence-free cache hints, so asOfSeq is null", () => {
  const out = readProjections({ kind: "migration-required", values: { title: "old" } });
  assert.deepEqual(out, { asOfSeq: null, values: { title: "old" }, migrationRequired: true });
  assert.deepEqual(readProjections({ kind: "migration-required", values: {} }), { asOfSeq: null, values: {}, migrationRequired: true });
  assert.deepEqual(readProjections({ kind: "migration-required" }), { asOfSeq: null, values: {}, migrationRequired: true }, "a missing values object is empty");
});

test("readProjections on null (no such session) and on anything unreadable gives no cut and no migration flag", () => {
  const none = { asOfSeq: null, values: {}, migrationRequired: false };
  for (const bad of [null, undefined, "x", 3, [], {}, { values: {} }, { kind: "sequenced", values: {} }, { kind: "sequenced", asOfSeq: 1.5, values: {} }, { kind: "sequenced", asOfSeq: "1", values: {} }]) {
    assert.deepEqual(readProjections(bad), none, JSON.stringify(bad));
  }
});

test("readProjections still reads a 0.2.0-shaped answer ({asOfSeq, values}, no kind) as sequenced", () => {
  assert.deepEqual(readProjections({ asOfSeq: 4, values: { a: 1 } }), { asOfSeq: 4, values: { a: 1 }, migrationRequired: false });
});
