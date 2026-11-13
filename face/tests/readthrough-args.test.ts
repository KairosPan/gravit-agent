// face/tests/readthrough-args.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, checkArgs } from "../plugins/readthrough/lib/args.mjs";
import { ReadThroughError, asToolError, refuse } from "../plugins/readthrough/lib/errors.mjs";
import { NEVER, fenceOf } from "../plugins/readthrough/lib/fence.mjs";
import { renderBlock } from "../plugins/readthrough/lib/block.mjs";

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

test("a reason holds only letters, digits, plain spaces and a few marks, so it cannot forge a second entry", () => {   // second fix N1
  const reason = (r: string) => ({ ...GOOD, peers: [{ symbol: "AMD", reason: r }] });
  const refusedAt = (r: string, shown: string) => assert.throws(() => checkArgs(reason(r)),
    (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes(shown) && (e as Error).message.includes("a reason holds only"), JSON.stringify(r));
  refusedAt("直接替代\uff09\uff1b做多 SMCI\uff08AI 服务器", "U+FF09");
  // small-form brackets and U+034F inside 做多: the invisible character is refused first, as in every text
  assert.throws(() => checkArgs(reason("直接替代\ufe5a\ufe54做\u034f多 SMCI\ufe59AI 服务器")), (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes("U+034F"));
  refusedAt("直接替代\ufe5a\ufe54做多 SMCI\ufe59AI 服务器", "U+FE5A");
  refusedAt("直接替代\uff3d做多 SMCI\uff3bAI", "U+FF3D");
  refusedAt("直接替代\uff60做多 SMCI\uff5fAI", "U+FF60");
  for (const bad of ["(", ")", ";", "\uff08", "\uff1b"]) refusedAt(`直接${bad}替代`, `"${bad}"`);
  // U+037E, the Greek question mark that reads as ";", is outside the list; U+FE00, a variation selector, is invisible
  assert.throws(() => checkArgs(reason("直接替代)\u037e做\ufe00多 SMCI(AI")), invalid("peers[0].reason"));
  assert.throws(() => checkArgs(reason("直接替代\u037e SMCI")), (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes("U+037E"));
  assert.throws(() => checkArgs(reason("直接做\ufe00多")), (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes("U+FE00"));
  for (const r of ["做多", "直接 做 多 SMCI", "做\u3000多", "\uff10做  多"]) assert.throws(() => checkArgs(reason(r)), invalid("peers[0].reason"), JSON.stringify(r));
  assert.throws(() => checkArgs(reason("直接 做 多")), (e: unknown) => (e as Error).message.includes('"做多"'));
  assert.equal(checkArgs({ ...GOOD, logic: "供应\uff08不确定\uff09\u2192 客户找备选\uff1b做多对手" }).logic, "供应\uff08不确定\uff09\u2192 客户找备选\uff1b做多对手", "logic is otherwise free");
});

test("ordinary prose passes as a reason, and the direction line holds one 做多 per rival", () => {   // second fix N1
  for (const r of ["数据中心 GPU 的直接替代", "云厂商自研芯片的设计伙伴",
    "同做数据中心\uff0c产品\u3001客户重叠\u3002", "the next-best supplier's share, 40% of AI chips",
    "Nvidia\u2019s rival \u00b7 A/B: 2nd & 3rd \u2014 +5% \u2013 ok.", "份额\uff1a超过一半"]) {
    assert.equal(checkArgs({ ...GOOD, peers: [{ symbol: "AMD", reason: r }] }).peers[0]!.reason, r, r);
  }
  const d = checkArgs({ ...GOOD, peers: [{ symbol: "AMD", reason: "数据中心 GPU 的直接替代" }, { symbol: "AVGO", reason: "云厂商自研芯片的设计伙伴" }] });
  const tape = ["NVDA", "AMD", "AVGO", "SPY"].map((symbol) => ({ symbol, changePct: 1, feed: "robinhood", asOf: "2026-11-09T09:03:10.000Z", traded: true }));
  const line = renderBlock({ direction: d, tape, shut: false, forTask: false, now: "2026-11-09T09:03:10.000Z" }).split("\n").find((l) => l.startsWith("\u00b7 方向\uff1a"))!;
  assert.equal(line.split("做多").length - 1, d.peers.length);
  assert.equal(line, "\u00b7 方向\uff1a做多 AMD\uff08数据中心 GPU 的直接替代\uff09\uff1b做多 AVGO\uff08云厂商自研芯片的设计伙伴\uff09");
});

test("every text refuses a control or format character, an invisible character, an odd space and a line break", () => {   // final review C1, second fix N1
  assert.throws(() => checkArgs({ ...GOOD, logic: "调查\u202e带来供应不确定" }), (e: unknown) => invalid("logic")(e) && (e as Error).message.includes("U+202E"));
  assert.throws(() => checkArgs({ ...GOOD, logic: "调查\u3164带来" }), (e: unknown) => invalid("logic")(e) && (e as Error).message.includes("U+3164"));
  for (const c of ["\u00a0", "\u3000", "\u2003"]) {
    assert.throws(() => checkArgs({ ...GOOD, event: `董事会${c}调查` }), (e: unknown) => invalid("event")(e) && (e as Error).message.includes("space"), JSON.stringify(c));
  }
  for (const c of ["\u034f", "\u115f", "\u1160", "\u3164", "\uffa0", "\ufe00", "\ufe0f", "\u{e0100}"]) {
    assert.throws(() => checkArgs({ ...GOOD, counter: `a${c}b` }), (e: unknown) => invalid("counter")(e) && (e as Error).message.includes("invisible"), JSON.stringify(c));
  }
  for (const [field, raw] of [
    ["event", { ...GOOD, event: "a\u0007b" }], ["sources[0]", { ...GOOD, sources: ["a\u200bb"] }], ["counter", { ...GOOD, counter: "a\u2066b" }],
    ["peers[0].reason", { ...GOOD, peers: [{ symbol: "AMD", reason: "a\u00adb" }] }], ["sources[0]", { ...GOOD, sources: ["a\u3000b"] }],
    ["no_direction", { ...GOOD, peers: [], counter: undefined, no_direction: "a\ufeffb" }], ["no_direction", { ...GOOD, peers: [], counter: undefined, no_direction: "a\u034fb" }],
    ["event", { ...GOOD, event: "one\u2028two" }], ["logic", { ...GOOD, logic: "one\rtwo" }],
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
