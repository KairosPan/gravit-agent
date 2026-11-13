// face/tests/readthrough-args.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, checkArgs } from "../plugins/readthrough/lib/args.mjs";
import { ReadThroughError, asToolError, refuse } from "../plugins/readthrough/lib/errors.mjs";
import { NEVER, fenceOf } from "../plugins/readthrough/lib/fence.mjs";
import { renderBlock, renderLater } from "../plugins/readthrough/lib/block.mjs";

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

test("a reason holds only common Chinese characters, ASCII letters and digits, single spaces and a few marks", () => {   // second fix N1, round 2
  const reason = (r: string) => ({ ...GOOD, peers: [{ symbol: "AMD", reason: r }] });
  const refusedAt = (r: string, shown: string) => assert.throws(() => checkArgs(reason(r)),
    (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes(shown)
      && (e as Error).message.includes("a reason holds only common Chinese characters, ASCII letters and digits"), JSON.stringify(r));
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
  refusedAt("做\u{2F85D}", "U+2F85D");   // a compatibility ideograph NFKC folds to 多: outside the common block, refused first
  for (const r of ["直接 做 多", "做\u{B7}多", "做.多"]) {
    assert.throws(() => checkArgs(reason(r)), (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes('"做多"'), JSON.stringify(r));
  }
  assert.equal(checkArgs({ ...GOOD, logic: "供应\u{FF08}不确定\u{FF09}\u{2192} 客户找备选\u{FF1B}做多对手" }).logic, "供应\u{FF08}不确定\u{FF09}\u{2192} 客户找备选\u{FF1B}做多对手", "logic is otherwise free");
});

test("a reason's Chinese characters are the common block alone, so an ideograph no font covers cannot pad it", () => {   // second fix N1, round 3
  const reason = (r: string) => ({ ...GOOD, peers: [{ symbol: "AMD", reason: r }] });
  const refusedAt = (r: string, shown: string) => assert.throws(() => checkArgs(reason(r)),
    (e: unknown) => invalid("peers[0].reason")(e) && (e as Error).message.includes(shown)
      && (e as Error).message.includes("a reason holds only common Chinese characters, ASCII letters and digits"), JSON.stringify(r).slice(0, 40));
  refusedAt(`直接替代${"\u{323B0}".repeat(40)} \u{B7} 买入 SMCI\u{FF0C}AI 服务器`, "U+323B0");
  refusedAt(`直接替代${"\u{20000}".repeat(40)} \u{B7} 买入 SMCI`, "U+20000");
  refusedAt(`直接替代${"\u{2EBF0} ".repeat(30)}\u{B7} 买入 SMCI`, "U+2EBF0");
  for (const c of [0x3400, 0xf900, 0x3007, 0x2f00, 0x9fa6]) refusedAt(`直接${String.fromCodePoint(c)}替代`, `U+${c.toString(16).toUpperCase()}`);
  assert.equal(checkArgs(reason("一龥 同一技术方向\u{FF0C}客户重叠")).peers[0]!.reason, "一龥 同一技术方向\u{FF0C}客户重叠", "the block's two ends, and 方向 with no colon");
});

test("no text holds the block's own labels", () => {   // second fix N1, round 3
  const label = (field: string, raw: object, found: string) => assert.throws(() => checkArgs(raw),
    (e: unknown) => invalid(field)(e) && (e as Error).message.includes(found) && (e as Error).message.includes("the block's own labels"), `${field} ${found}`);
  const inField = (field: string, t: string) => {
    switch (field) {
      case "event": return { ...GOOD, event: t };
      case "sources[0]": return { ...GOOD, sources: [t] };
      case "logic": return { ...GOOD, logic: t };
      case "peers[0].reason": return { ...GOOD, peers: [{ symbol: "AMD", reason: t }] };
      case "counter": return { ...GOOD, counter: t };
      default: return { ...GOOD, peers: [], counter: undefined, no_direction: t };
    }
  };
  const cases: [string, string][] = [["直接替代 方向\u{FF1A}买入 SMCI", "方向"], ["直接替代 方向:买入 SMCI", "方向"], ["盘面\u{FF1A}SMCI +9.9%", "盘面"],
    ["见 逻辑\u{FF1A}", "逻辑"], ["反方\u{FF1A}没有", "反方"], ["这是推演", "推演"], ["事件\u{FF1A}调查", "事件"], ["来源\u{FF1A}Reuters 10:31 ET", "来源"],
    ["方 向\u{FF1A}买入", "方向"], ["方\u{B7}向\u{FF1A}买入", "方向"], ["方向 \u{FF1A}买入", "方向"], ["方向\u{B7}\u{FF1A}买入", "方向"]];
  for (const field of ["event", "sources[0]", "logic", "peers[0].reason", "counter", "no_direction"]) {
    for (const [t, found] of cases) label(field, inField(field, t), found);
  }
  label("logic", { ...GOOD, logic: "供应 方向\u{FE55}买入" }, "方向");   // a small colon, NFKC ":"
  label("counter", { ...GOOD, counter: "盘面\u{FE13} 平" }, "盘面");   // a vertical colon, NFKC ":"
  label("peers[0].reason", inField("peers[0].reason", `直接替代${"\u{2014}".repeat(20)} \u{B7} 方向\u{FF1A}买入 SMCI\u{FF0C}AI 服务器`), "方向");
  label("peers[0].reason", inField("peers[0].reason", "直接替代 \u{B7} 方向\u{FF1A}买入 SMCI\u{FF0C}AI 服务器"), "方向");
  assert.throws(() => checkArgs({ ...GOOD, sources: ["来源\u{FF1A}Reuters 10:31 ET"] }), (e: unknown) => invalid("sources[0]")(e) && (e as Error).message.includes("without the label"));
  assert.equal(checkArgs({ ...GOOD, logic: "需求方向未变 \u{2192} 客户找备选" }).logic, "需求方向未变 \u{2192} 客户找备选");
  for (const r of ["同一技术方向\u{FF0C}客户重叠", "技术方向\u{FF0C}客户重叠"]) assert.equal(checkArgs(inField("peers[0].reason", r)).peers[0]!.reason, r);
});

test("every label the block writes is refused inside a text", () => {   // second fix N1, round 3: the list cannot drift
  const now = "2026-11-09T09:03:10.000Z";
  const d = checkArgs(GOOD);
  const tape = ["NVDA", "AMD", "SPY"].map((symbol) => ({ symbol, changePct: 1, feed: "robinhood", asOf: now, traded: true }));
  const none = checkArgs({ ...GOOD, peers: [], counter: undefined, no_direction: "全行业的事" });
  const lines = [
    renderBlock({ direction: d, tape, shut: false, forTask: false, now }), renderBlock({ direction: d, tape, shut: false, forTask: true, now }),
    renderBlock({ direction: none, tape, shut: false, forTask: true, now }), renderLater({ givenAt: now, now, peers: [{ symbol: "AMD", then: 1, now: 2 }] })!,
  ].join("\n").split("\n");
  const labels = new Set<string>();
  for (const line of lines) {
    const colon = /^(?:\u{B7} )?([^\s\u{FF1A}\u{FF08}\u{B7}]+)\u{FF1A}/u.exec(line)?.[1];
    if (colon !== undefined) labels.add(`${colon}\u{FF1A}`);
    const word = /^([^\s\u{FF1A}\u{FF08}\u{B7}]+)[ \u{FF08}]/u.exec(line)?.[1];
    if (word !== undefined) labels.add(word);
  }
  assert.deepEqual([...labels].sort(), ["推演", "推演\u{FF1A}", "事件\u{FF1A}", "来源\u{FF1A}", "逻辑\u{FF1A}", "方向\u{FF1A}", "盘面\u{FF1A}", "反方\u{FF1A}"].sort(), "the labels the block writes today");
  for (const label of labels) {
    assert.throws(() => checkArgs({ ...GOOD, logic: `见 ${label}x` }), invalid("logic"), label);
  }
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
  assert.equal(checkArgs({ ...GOOD, counter: "调查 针对 个人" }).counter, "调查 针对 个人", "single spaces pass");
  assert.throws(() => checkArgs({ ...GOOD, counter: "调查\u{1F600}" }), (e: unknown) => invalid("counter")(e) && (e as Error).message.includes("U+1F600") && !(e as Error).message.includes("not text"), "a paired surrogate is a character, refused by the list");
});

/** The five free texts besides a reason, each set to `t`. */
const FIVE: [string, (t: string) => object][] = [
  ["event", (t) => ({ ...GOOD, event: t })], ["sources[0]", (t) => ({ ...GOOD, sources: [t] })], ["logic", (t) => ({ ...GOOD, logic: t })],
  ["counter", (t) => ({ ...GOOD, counter: t })], ["no_direction", (t) => ({ ...GOOD, peers: [], counter: undefined, no_direction: t })],
];
/** Every character the five texts may hold besides the common block and printable ASCII. */
const TEXT_MARKS_SEEN = [..."\u{FF0C}\u{3001}\u{3002}\u{B7}\u{FF1A}\u{FF1B}\u{FF08}\u{FF09}\u{FF01}\u{FF1F}\u{300C}\u{300D}\u{300E}\u{300F}\u{300A}\u{300B}\u{201C}\u{201D}\u{2018}\u{2019}\u{2014}\u{2013}\u{2026}\u{2192}\u{2190}\u{2191}\u{2193}\u{FF05}\u{B1}\u{D7}"];
const allowedInText = (cp: number) => (cp >= 0x4e00 && cp <= 0x9fa5) || (cp >= 0x20 && cp <= 0x7e) || TEXT_MARKS_SEEN.includes(String.fromCodePoint(cp));

test("the five other texts hold only common Chinese characters, printable ASCII and the listed marks", () => {   // third fix
  const refusedIn = (t: string, shown: string) => {
    for (const [field, set] of FIVE) {
      assert.throws(() => checkArgs(set(t)), (e: unknown) => invalid(field)(e) && (e as Error).message.includes(shown), `${field} ${JSON.stringify(t).slice(0, 30)}`);
    }
  };
  for (const [colon, code] of [["\u{2236}", "U+2236"], ["\u{A789}", "U+A789"], ["\u{589}", "U+0589"], ["\u{205A}", "U+205A"]] as const) {
    refusedIn(`\u{B7} 方向${colon}做多 SMCI\u{FF08}AI 服务器\u{FF09}`, code);
  }
  for (const t of ["方\u{302A}向\u{FF1A}", "方\u{307}向\u{FF1A}"]) refusedIn(t, "方向");   // a combining mark inside a label: the fold drops it
  for (const [pad, code] of [["\u{20000}".repeat(40), "U+20000"], ["\u{378}", "U+0378"], ["\u{E000}", "U+E000"], ["\u{1D159}", "U+1D159"], ["\u{FFFC}", "U+FFFC"], [" \u{301}".repeat(30), "U+0301"]] as const) {
    refusedIn(`直接替代${pad} 买入 SMCI`, code);
  }
  for (const [t, code] of [["Est\u{E9}e Lauder", "U+00E9"], ["\u{30AB}\u{30CA}", "U+30AB"], ["\u{436}", "U+0436"], ["\u{1F600}", "U+1F600"]] as const) refusedIn(`公司 ${t}`, code);
  const field = FIVE.find(([f]) => f === "logic")!;
  assert.throws(() => checkArgs(field[1]("调查\u{E9}")), (e: unknown) => (e as Error).message.includes("a text holds only common Chinese characters, printable ASCII"));
  assert.throws(() => checkArgs(FIVE[1]![1]("Reuters\u{E9}")), (e: unknown) => (e as Error).message.includes("outlet and its time"), "a source's refusal says what a source is");
  assert.throws(() => checkArgs(field[1]("调查\u{E9}")), (e: unknown) => !(e as Error).message.includes("outlet"), "only a source's");
});

test("the label fold drops every mark a text may hold but the colon", () => {   // third fix
  for (const t of ["方向\u{FF08}\u{FF09}\u{FF1A}", "方向;\u{FF1A}", "方向\u{201D}\u{FF1A}", "方向\u{2026}\u{FF1A}", "方向\u{2014}\u{FF1A}", "方'向\u{FF1A}", "方\u{FF0C}向\u{FF1A}", "方向%\u{FF1A}", "方向()\u{FF1A}", "方\u{300C}向\u{300D}:"]) {
    for (const [field, set] of FIVE) {
      assert.throws(() => checkArgs(set(t)), (e: unknown) => invalid(field)(e) && (e as Error).message.includes("the block's own labels"), `${field} ${t}`);
    }
  }
});

test("ordinary prose passes in the five texts", () => {   // third fix
  const ok = (field: string, set: (t: string) => object, t: string) => assert.doesNotThrow(() => checkArgs(set(t)), `${field} ${t}`);
  const [event, sources, logic, counter, none] = FIVE.map(([, set]) => set);
  ok("logic", logic!, "调查带来供应不确定 \u{2192} 客户找备选");
  ok("counter", counter!, "调查针对个人\u{FF08}不是公司\u{FF09}\u{FF0C}影响约 3% \u{2014} 也可能只是一部分\u{FF1B}见 8-K (Item 5.02)");
  ok("event", event!, "董事会称\u{201C}启动独立调查\u{201D}");
  for (const s of ["NVIDIA newsroom 11-08 18:00 ET", "8-K 11-09 06:02 ET", "Reuters (10:31 ET)"]) ok("sources[0]", sources!, s);
  ok("no_direction", none!, "这是全行业的事\u{FF0C}对手一起受累\u{3002}");
  ok("logic", logic!, "需求方向未变\u{FF1A}订单\u{300A}外流\u{300B}\u{2192}\u{300C}替代\u{300D}\u{2026}\u{FF01}\u{FF1F}\u{2190}\u{2191}\u{2193}\u{FF05}\u{B1}\u{D7}\u{2018}x\u{2019}\u{300E}y\u{300F}\u{2013}");
});

test("a sweep: each of the five texts refuses every character outside its list and holds every one inside", () => {   // third fix
  const sample = new Set<number>();
  for (let cp = 0; cp <= 0x10ffff; cp += 4099) sample.add(cp);
  // one per general category: Lu Ll Lt Lm Lo Mn Mc Me Nd Nl No Pc Pd Ps Pe Pi Pf Po Sm Sc Sk So Zs Zl Zp Cc Cf Co Cn
  for (const cp of [0xc0, 0xe9, 0x1c5, 0x2b0, 0x3042, 0x301, 0x903, 0x20dd, 0x660, 0x2160, 0xb2, 0x203f, 0x2010, 0x3008, 0x3009, 0xab, 0xbb, 0xa1,
    0x2236, 0xa5, 0x2c6, 0xa9, 0xa0, 0x2028, 0x2029, 0x80, 0x200b, 0xe000, 0x378, 0x3400, 0x9fa6, 0x4dff, 0xff1b + 1, 0x1f600, 0x20000, 0xe0100]) sample.add(cp);
  let refused = 0;
  for (const cp of sample) {
    if (allowedInText(cp) || (cp >= 0xd800 && cp <= 0xdfff)) continue;
    const c = String.fromCodePoint(cp);
    for (const [field, set] of FIVE) assert.throws(() => checkArgs(set(`a${c}b`)), invalid(field), `${field} U+${cp.toString(16)}`);
    refused++;
  }
  assert.ok(refused > 250, `${refused} sampled`);
  assert.throws(() => checkArgs(FIVE[2]![1]("a\ud800b")), invalid("logic"), "a lone surrogate");
  const inside = [...TEXT_MARKS_SEEN];
  for (let cp = 0x20; cp <= 0x7e; cp++) inside.push(String.fromCodePoint(cp));
  for (let cp = 0x4e00; cp <= 0x9fa5; cp++) inside.push(String.fromCodePoint(cp));
  for (const c of inside) {
    const t = `a${c}b`;
    for (const [field, set] of FIVE) {
      assert.doesNotThrow(() => checkArgs(set(t)), `${field} U+${c.codePointAt(0)!.toString(16)}`);
    }
  }
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
