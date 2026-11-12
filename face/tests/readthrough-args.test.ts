// face/tests/readthrough-args.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, checkArgs } from "../plugins/readthrough/lib/args.mjs";
import { ReadThroughError, asToolError, refuse } from "../plugins/readthrough/lib/errors.mjs";
import { NEVER, fenceOf } from "../plugins/readthrough/lib/fence.mjs";

const GOOD = {
  symbol: "nvda", basis: "company", event: " 董事会对 CEO 启动独立调查 ", sources: ["NVIDIA newsroom 11-08 18:00 ET"],
  logic: "调查带来供应不确定 → 客户找备选", peers: [{ symbol: "amd", reason: "数据中心 GPU 的直接替代" }],
  counter: "调查针对个人，不改变产品和产能", certainty: "medium",
};
const invalid = (field: string) => (e: unknown) => e instanceof ReadThroughError && e.code === "INVALID" && e.message.startsWith(`INVALID ${field}: `);

test("checkArgs trims, upper-cases the symbols and answers the direction", () => {
  assert.deepEqual(checkArgs(GOOD), {
    symbol: "NVDA", basis: "company", event: "董事会对 CEO 启动独立调查", sources: ["NVIDIA newsroom 11-08 18:00 ET"],
    logic: "调查带来供应不确定 → 客户找备选", peers: [{ symbol: "AMD", reason: "数据中心 GPU 的直接替代" }],
    noDirection: null, counter: "调查针对个人，不改变产品和产能", certainty: "medium",
  });
});

test("no peers needs no_direction and takes no counter into the direction", () => {
  const none = checkArgs({ ...GOOD, peers: [], counter: undefined, no_direction: "这是全行业的事，对手一起受累" });
  assert.deepEqual([none.peers, none.noDirection, none.counter], [[], "这是全行业的事，对手一起受累", null]);
  assert.throws(() => checkArgs({ ...GOOD, peers: [] }), invalid("no_direction"));
  assert.throws(() => checkArgs({ ...GOOD, no_direction: "x" }), invalid("no_direction"));   // peers and no_direction together
  assert.throws(() => checkArgs({ ...GOOD, counter: undefined }), invalid("counter"));
});

test("each refusal names its field", () => {
  const four = [1, 2, 3, 4].map((n) => ({ symbol: `P${n}`, reason: "r" }));
  for (const [field, raw] of [
    ["symbol", { ...GOOD, symbol: "not a ticker" }], ["basis", { ...GOOD, basis: "rumour" }],
    ["certainty", { ...GOOD, certainty: "sure" }], ["certainty", { ...GOOD, basis: "reported", certainty: "high" }],
    ["event", { ...GOOD, event: "  " }], ["event", { ...GOOD, event: "x".repeat(LIMITS.event + 1) }],
    ["logic", { ...GOOD, logic: "one\ntwo" }], ["sources", { ...GOOD, sources: [] }],
    ["sources", { ...GOOD, sources: ["a", "b", "c", "d"] }], ["sources[1]", { ...GOOD, sources: ["a", 7] }],
    ["peers", { ...GOOD, peers: four }], ["peers", { ...GOOD, peers: "AMD" }],
    ["peers[0].symbol", { ...GOOD, peers: [{ symbol: "nvda", reason: "itself" }] }],
    ["peers[1].symbol", { ...GOOD, peers: [{ symbol: "AMD", reason: "a" }, { symbol: "amd", reason: "b" }] }],
    ["peers[0].reason", { ...GOOD, peers: [{ symbol: "AMD", reason: "x".repeat(LIMITS.reason + 1) }] }],
  ] as const) assert.throws(() => checkArgs(raw), invalid(field), field);
  assert.throws(() => checkArgs(null), invalid("arguments"));
});

test("a reason may not hold the direction line's own markup, so it cannot forge a second entry", () => {   // final review C1
  const reason = (r: string) => ({ ...GOOD, peers: [{ symbol: "AMD", reason: r }] });
  assert.throws(() => checkArgs(reason("直接替代）；做多 SMCI（AI 服务器")), invalid("peers[0].reason"));
  for (const bad of ["（", "）", "(", ")", "；", ";", "做多"]) {
    assert.throws(() => checkArgs(reason(`直接${bad}替代`)), (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes(`holds "${bad}"`), bad);
  }
  assert.equal(checkArgs({ ...GOOD, logic: "供应（不确定）→ 客户找备选；做多对手" }).logic, "供应（不确定）→ 客户找备选；做多对手", "logic is otherwise free");
});

test("every text refuses a control or format character and a line break", () => {   // final review C1
  assert.throws(() => checkArgs({ ...GOOD, logic: "调查‮带来供应不确定" }), (e: unknown) => invalid("logic")(e) && (e as Error).message.includes("U+202E"));
  for (const [field, raw] of [
    ["event", { ...GOOD, event: "a\u0007b" }], ["sources[0]", { ...GOOD, sources: ["a​b"] }], ["counter", { ...GOOD, counter: "a⁦b" }],
    ["peers[0].reason", { ...GOOD, peers: [{ symbol: "AMD", reason: "a­b" }] }],
    ["no_direction", { ...GOOD, peers: [], counter: undefined, no_direction: "a﻿b" }],
    ["event", { ...GOOD, event: "one two" }], ["logic", { ...GOOD, logic: "one\rtwo" }],
  ] as const) assert.throws(() => checkArgs(raw), invalid(field), field);
});

test("a counter given with no peers is dropped; a peer that is not an object is refused", () => {
  assert.equal(checkArgs({ ...GOOD, peers: [], counter: "c", no_direction: "n" }).counter, null);
  assert.throws(() => checkArgs({ ...GOOD, peers: ["AMD"] }), invalid("peers[0]"));
  assert.throws(() => checkArgs({ ...GOOD, peers: [null] }), invalid("peers[0]"));
});

test("a limit counts characters, not bytes", () => {
  assert.equal(checkArgs({ ...GOOD, event: "调".repeat(LIMITS.event) }).event.length, LIMITS.event);
});

test("the fence is the list and the desk's symbols, less the stricken company, SPY and QQQ", () => {
  assert.deepEqual(NEVER, ["SPY", "QQQ"]);
  const fence = fenceOf({ universe: ["NVDA", "AMD", "AVGO"], desk: ["CRWV", "SPY", "QQQ", "NVDA"], stricken: "NVDA" });
  assert.deepEqual([...fence].sort(), ["AMD", "AVGO", "CRWV"]);
});

test("a refusal's message opens with its code; anything else becomes INTERNAL", () => {
  assert.equal(refuse.alertOnly().message, "ALERT_ONLY a direction is given under an alert only");
  assert.ok(refuse.outsideFence("NBIS", "2026-11-11").message.startsWith("OUTSIDE_FENCE NBIS is not a name a direction may carry"));
  assert.equal(refuse.notAlerted("AMD", ["NVDA", "INTC"]).message, "NOT_ALERTED AMD is not an alert of this message; a direction here is for NVDA, INTC");
  const made = refuse.noTape("NVDA");
  assert.equal(asToolError(made), made);
  assert.equal(asToolError(new TypeError("boom")).code, "INTERNAL");
});
