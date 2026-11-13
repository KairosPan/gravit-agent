// face/tests/readthrough-args.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, checkArgs } from "../plugins/readthrough/lib/args.mjs";
import { ReadThroughError, asToolError, refuse } from "../plugins/readthrough/lib/errors.mjs";
import { NEVER, fenceOf } from "../plugins/readthrough/lib/fence.mjs";
import { renderBlock } from "../plugins/readthrough/lib/block.mjs";

const GOOD = {
  symbol: "nvda", basis: "company", event: " 董事会对 CEO 启动独立调查 ", sources: ["NVIDIA newsroom 11-08 18:00 ET"],
  logic: "调查带来供应不确定 \u{2192} 客户找备选", peers: [{ symbol: "amd", reason: "数据中心 GPU 的直接替代" }],
  counter: "调查针对个人\u{FF0C}不改变产品和产能", certainty: "medium",
};
const invalid = (field: string) => (e: unknown) => e instanceof ReadThroughError && e.code === "INVALID" && e.message.startsWith(`INVALID ${field}: `);

test("checkArgs trims, upper-cases the symbols and answers the direction", () => {
  assert.deepEqual(checkArgs(GOOD), {
    symbol: "NVDA", basis: "company", event: "董事会对 CEO 启动独立调查", sources: ["NVIDIA newsroom 11-08 18:00 ET"],
    logic: "调查带来供应不确定 \u{2192} 客户找备选", peers: [{ symbol: "AMD", reason: "数据中心 GPU 的直接替代" }],
    noDirection: null, counter: "调查针对个人\u{FF0C}不改变产品和产能", certainty: "medium",
  });
});

test("no peers needs no_direction and takes no counter into the direction", () => {
  const none = checkArgs({ ...GOOD, peers: [], counter: undefined, no_direction: "这是全行业的事\u{FF0C}对手一起受累" });
  assert.deepEqual([none.peers, none.noDirection, none.counter], [[], "这是全行业的事\u{FF0C}对手一起受累", null]);
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

test("a reason holds only Chinese characters, ASCII letters and digits, single spaces and a few marks", () => {   // second fix N1, round 2
  const reason = (r: string) => ({ ...GOOD, peers: [{ symbol: "AMD", reason: r }] });
  const refusedAt = (r: string, shown: string) => assert.throws(() => checkArgs(reason(r)),
    (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes(shown)
      && (e as Error).message.includes("a reason holds only Chinese characters, ASCII letters and digits"), JSON.stringify(r));
  // the forgeries: letters of other scripts drawn as brackets and a semicolon
  refusedAt("直接替代\u{13287}\u{A4FC}作多 SMCI\u{13286}AI 服务器", "U+13287");   // Egyptian brackets, the Lisu semicolon
  refusedAt("直接替代\u{1325D}\u{A4FC}作多 SMCI\u{13258}AI", "U+1325D");
  refusedAt("直接替代\u{1337A}\u{A4FC}作多 SMCI\u{13379}AI", "U+1337A");
  refusedAt("直接替代\u{1450}\u{A4FC}作多 SMCI\u{1455}AI", "U+1450");   // Canadian syllabics
  refusedAt("直接替代\u{1433}\u{A4FC}作多 SMCI\u{1438}AI", "U+1433");
  for (const c of [0xa4f8, 0xa4f9, 0xa4fa, 0xa4fb, 0xa4fc, 0xa4fd, 0x1c3, 0x1c0]) {
    refusedAt(`直接${String.fromCodePoint(c)}替代`, `U+${c.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  refusedAt("直接替代\u{FF09}\u{FF1B}做多 SMCI\u{FF08}AI 服务器", "U+FF09");
  refusedAt("直接替代\u{FE5A}\u{FE54}做多 SMCI\u{FE59}AI 服务器", "U+FE5A");
  refusedAt("直接替代\u{FF3D}做多 SMCI\u{FF3B}AI", "U+FF3D");
  refusedAt("直接替代\u{FF60}做多 SMCI\u{FF5F}AI", "U+FF60");
  for (const bad of ["(", ")", ";", "\"", "\u{FF08}", "\u{FF1B}"]) refusedAt(`直接${bad}替代`, `"${bad}"`);
  refusedAt("直接替代\u{37E} SMCI", "U+037E");
  // other scripts and accented letters: the accepted cost
  refusedAt("caf\u{E9} 的对手", "U+00E9");
  refusedAt("\u{3072}\u{3089}\u{304C}\u{306A}", "U+3072");   // Hiragana
  refusedAt("\u{436}\u{443}\u{43A}", "U+0436");   // Cyrillic
  // invisible characters are refused as in every text, before the list is read
  assert.throws(() => checkArgs(reason("直接替代\u{FE5A}\u{FE54}做\u{34F}多 SMCI\u{FE59}AI")), (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes("U+034F"));
  assert.throws(() => checkArgs(reason("直接做\u{FE00}多")), (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes("U+FE00"));
  // fifty-six spaces would wrap a forged line onto its own visual line
  assert.throws(() => checkArgs(reason(`直接替代${" ".repeat(56)}买入 SMCI\u{FF0C}AI 服务器`)), invalid("peers[0].reason"));
  // 做多 with anything but a letter or a digit between, or in a compatibility form
  for (const r of ["做多", "直接 做 多 SMCI", "做\u{3000}多", "\u{FF10}做 多", "做\u{B7}多", "做'多", "做-多", "做.多", "做\u{2D1}多", "做\u{1161}多", "做\u{FF9E}多", "做\u{FF1A}多", "做/多", "做\u{2019}多"]) {
    assert.throws(() => checkArgs(reason(r)), invalid("peers[0].reason"), JSON.stringify(r));
  }
  for (const r of ["直接 做 多", "做\u{B7}多", "做.多", "做\u{2F85D}"]) {
    assert.throws(() => checkArgs(reason(r)), (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes('"做多"'), JSON.stringify(r));
  }
  assert.equal(checkArgs({ ...GOOD, logic: "供应\u{FF08}不确定\u{FF09}\u{2192} 客户找备选\u{FF1B}做多对手" }).logic, "供应\u{FF08}不确定\u{FF09}\u{2192} 客户找备选\u{FF1B}做多对手", "logic is otherwise free");
});

test("ordinary prose passes as a reason, and the direction line holds one entry per rival", () => {   // second fix N1, round 2
  const prose = ["数据中心 GPU 的直接替代", "云厂商自研芯片的设计伙伴", "同做数据中心\u{FF0C}产品\u{3001}客户重叠\u{3002}",
    "the next-best supplier's share, 40% of AI chips", "与 BRK.B 的保险业务重叠\u{FF0C}份额约 5.5%", "R&D 重叠 + 同一批客户",
    "TSMC/三星 的代工份额", "Nvidia\u{2019}s rival \u{B7} A/B: 2nd & 3rd \u{2014} +5% \u{2013} ok.", "份额\u{FF1A}超过一半"];
  for (const r of prose) assert.equal(checkArgs({ ...GOOD, peers: [{ symbol: "AMD", reason: r }] }).peers[0]!.reason, r, r);
  const entry = /^做多 [A-Z][A-Z0-9.-]*\u{FF08}[^\u{FF08}\u{FF09}\u{FF1B}]*\u{FF09}$/u;
  for (let i = 0; i < prose.length; i += 3) {
    const peers = prose.slice(i, i + 3).map((reason, j) => ({ symbol: ["AMD", "AVGO", "BRK.B"][j]!, reason }));
    const d = checkArgs({ ...GOOD, peers });
    const tape = ["NVDA", ...d.peers.map((p) => p.symbol), "SPY"].map((symbol) => ({ symbol, changePct: 1, feed: "robinhood", asOf: "2026-11-09T09:03:10.000Z", traded: true }));
    const line = renderBlock({ direction: d, tape, shut: false, forTask: false, now: "2026-11-09T09:03:10.000Z" }).split("\n").find((l) => l.startsWith("\u{B7} 方向\u{FF1A}"))!;
    const entries = line.slice("\u{B7} 方向\u{FF1A}".length).split("\u{FF1B}");
    assert.equal(entries.length, d.peers.length, line);
    for (const e of entries) assert.match(e, entry);
  }
});

test("every text refuses a control or format character, an invisible character, an odd space and a line break", () => {   // final review C1, second fix N1
  assert.throws(() => checkArgs({ ...GOOD, logic: "调查\u{202E}带来供应不确定" }), (e: unknown) => invalid("logic")(e) && (e as Error).message.includes("U+202E"));
  assert.throws(() => checkArgs({ ...GOOD, logic: "调查\u{3164}带来" }), (e: unknown) => invalid("logic")(e) && (e as Error).message.includes("U+3164"));
  for (const c of ["\u{A0}", "\u{3000}", "\u{2003}"]) {
    assert.throws(() => checkArgs({ ...GOOD, event: `董事会${c}调查` }), (e: unknown) => invalid("event")(e) && (e as Error).message.includes("space"), JSON.stringify(c));
  }
  for (const c of ["\u{34F}", "\u{115F}", "\u{1160}", "\u{3164}", "\u{FFA0}", "\u{FE00}", "\u{FE0F}", "\u{E0100}"]) {
    assert.throws(() => checkArgs({ ...GOOD, counter: `a${c}b` }), (e: unknown) => invalid("counter")(e) && (e as Error).message.includes("invisible"), JSON.stringify(c));
  }
  for (const [field, raw] of [
    ["event", { ...GOOD, event: "a\u{7}b" }], ["sources[0]", { ...GOOD, sources: ["a\u{200B}b"] }], ["counter", { ...GOOD, counter: "a\u{2066}b" }],
    ["peers[0].reason", { ...GOOD, peers: [{ symbol: "AMD", reason: "a\u{AD}b" }] }], ["sources[0]", { ...GOOD, sources: ["a\u{3000}b"] }],
    ["no_direction", { ...GOOD, peers: [], counter: undefined, no_direction: "a\u{FEFF}b" }], ["no_direction", { ...GOOD, peers: [], counter: undefined, no_direction: "a\u{34F}b" }],
    ["event", { ...GOOD, event: "one\u{2028}two" }], ["logic", { ...GOOD, logic: "one\rtwo" }],
  ] as const) assert.throws(() => checkArgs(raw), invalid(field), field);
});

test("every text refuses two spaces in a row, the Braille blank and a lone surrogate", () => {   // second fix N1, round 2
  assert.throws(() => checkArgs({ ...GOOD, logic: "调查带来  供应不确定" }), (e: unknown) => invalid("logic")(e) && (e as Error).message.includes("two spaces"));
  assert.throws(() => checkArgs({ ...GOOD, event: "董事会\u{2800}调查" }), (e: unknown) => invalid("event")(e) && (e as Error).message.includes("U+2800"));
  assert.throws(() => checkArgs({ ...GOOD, counter: "调查\ud800针对个人" }), (e: unknown) => invalid("counter")(e) && (e as Error).message.includes("U+D800"));
  assert.equal(checkArgs({ ...GOOD, counter: "调查 针对 个人 \u{1F600}" }).counter, "调查 针对 个人 \u{1F600}", "single spaces and a paired surrogate pass");
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
