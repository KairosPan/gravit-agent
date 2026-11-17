import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ABILITY_FILE, ABILITY_MAX_BYTES, readAbilities, validateAbility } from "../src/abilities.ts";

/** The event analog's declaration, as the spec's §4.5 gives it. */
const EVENT_ANALOGS = {
  id: "event-analogs",
  name: "Event analogs",
  blurb: "What stocks did after past events like this one, measured against the market",
  icon: "rewind",
  about: "Give gravit a stock and what just happened to it. In a task, a source reader looks for past events of the same kind at other companies and dates each from a page it opens. Every dated event is then measured on daily bars against the market (SPY): the first day that could react, then 1, 5, 20 and 60 sessions on.\nThe answer is a table of the cases, with a median where a group has 8 or more, and a chart for each case. A run takes several minutes.",
  asks: [
    "NVDA's board opened an investigation into its CEO. What did stocks do after events like this?",
    "A drug maker's lead trial just failed. How did past cases trade over the next 60 days?",
    "TSLA announced a large recall. Find past events like it and measure them",
  ],
  limits: [
    "Historical statistics, not a forecast and not a basis for a trade",
    "Survivorship leans the numbers: companies that are gone cannot be measured",
    "The cases are the ones one search found, and they are not independent",
    "US shares on daily bars only, and nothing guards against lookahead",
  ],
  tools: ["analog_events"],
  rows: ["analog-views", "analog-events"],
  roles: ["source-reader"],
  skills: ["analog-guide"],
  zh: {
    name: "事件对标",
    blurb: "一件事发生后，历史上同类事件之后股价怎么走，对比大盘来量",
    about: "告诉 gravit 一只股票和它刚发生的事。gravit 会开一个任务：先由来源阅读员去找其他公司发生过的同类事件，并从它打开的网页里核对每件事的日期；再用日线把每件事对比大盘（SPY）量一遍：第一个能反应的交易日，以及之后第 1、5、20、60 个交易日。\n结果是一张案例表，同组满 8 例才给中位数，每个案例都能点开看当时的 K 线。一次大约要几分钟。",
    asks: [
      "NVDA 董事会对 CEO 启动调查，历史上类似的事发生后股价怎么走？",
      "一家药企的核心临床试验刚失败，过去的同类案例之后 60 天怎么走？",
      "TSLA 宣布大规模召回，帮我找历史上类似的事件并量一下",
    ],
    limits: [
      "这是历史统计，不是预测，也不是交易依据",
      "有幸存者偏差：已经退市的公司量不到",
      "案例是一次搜索找到的那些，彼此也不独立",
      "只覆盖美股日线，没有防止用到事后信息的机制",
    ],
  },
};

/** The fields a declaration cannot leave out, and nothing else. */
const MINIMAL = {
  id: "alpha",
  name: "Alpha",
  blurb: "A short line for the card",
  about: "What it does and how it runs.",
  tools: ["alpha_tool"],
  rows: ["alpha-row"],
};

/** The refusal's field for `input`, failing the test when the input is kept. */
function refusedField(input: unknown): string {
  const result = validateAbility(input);
  assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(input)}`);
  if (result.ok) throw new Error("unreachable");
  assert.equal(typeof result.error.rule, "string");
  assert.ok(result.error.rule.length > 0, "a refusal says its rule");
  return result.error.field;
}

test("validateAbility keeps the event analog's whole declaration", () => {
  const result = validateAbility(EVENT_ANALOGS);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.deepEqual(result.ability, EVENT_ANALOGS);
  assert.equal(result.ability.icon, "rewind");
  assert.equal(result.ability.zh?.name, "事件对标");
});

test("validateAbility gives a minimal declaration its defaults", () => {
  const result = validateAbility(MINIMAL);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.deepEqual(result.ability, {
    ...MINIMAL,
    icon: null, asks: [], limits: [], roles: [], skills: [], zh: null,
  });
});

test("validateAbility refuses one broken rule at a time, naming the field", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["id", { id: "Ab" }],
    ["id", { id: "a" }],
    ["id", { id: "a".repeat(42) }],
    ["name", { name: "" }],
    ["name", { name: "n".repeat(41) }],
    ["blurb", { blurb: "b".repeat(91) }],
    ["blurb", { blurb: "Ends with a period." }],
    ["blurb", { blurb: "以句号结尾。" }],
    ["about", { about: "a".repeat(601) }],
    ["asks", { asks: ["one?", "two?", "three?", "four?", "five?"] }],
    ["asks", { asks: ["one?", "q".repeat(121)] }],
    ["limits", { limits: ["one", "two", "three", "four", "five"] }],
    ["limits", { limits: ["one", "l".repeat(161)] }],
    ["tools", { tools: [] }],
    ["tools", { tools: ["alpha_tool", "alpha_tool"] }],
    ["tools", { tools: ["bad name"] }],
    ["rows", { rows: [] }],
    ["rows", { rows: ["alpha-row", "alpha-row"] }],
    ["rows", { rows: ["Bad"] }],
    ["roles", { roles: ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"] }],
    ["skills", { skills: ["Not_Kebab"] }],
    ["zh.blurb", { zh: { blurb: "字".repeat(91) } }],
  ];
  for (const [field, patch] of cases) {
    assert.equal(refusedField({ ...MINIMAL, ...patch }), field, `${JSON.stringify(patch)} breaks ${field}`);
  }
  for (const input of [null, [], "x"]) {
    assert.equal(refusedField(input), "manifest", `${JSON.stringify(input)} is not an object`);
  }
});

test("validateAbility counts lengths in code points, at the bounds", () => {
  /* Forty emoji are eighty UTF-16 units and forty characters. */
  const result = validateAbility({ ...MINIMAL, id: "a".repeat(41), name: "😀".repeat(40), blurb: "b".repeat(90), about: "a".repeat(600) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(refusedField({ ...MINIMAL, name: "😀".repeat(41) }), "name");
});

test("validateAbility trims strings and refuses a control character, but keeps a newline in about", () => {
  const trimmed = validateAbility({ ...MINIMAL, name: "  Event analogs  " });
  assert.equal(trimmed.ok, true, JSON.stringify(trimmed));
  if (trimmed.ok) assert.equal(trimmed.ability.name, "Event analogs");

  assert.equal(refusedField({ ...MINIMAL, name: "Event\u0007analogs" }), "name");
  assert.equal(refusedField({ ...MINIMAL, blurb: "A line\u0085for the card" }), "blurb");

  const paragraphs = validateAbility({ ...MINIMAL, about: "First paragraph.\nSecond paragraph." });
  assert.equal(paragraphs.ok, true, JSON.stringify(paragraphs));
  if (paragraphs.ok) assert.equal(paragraphs.ability.about, "First paragraph.\nSecond paragraph.");
});

/** The refusal's rule for `input`, failing the test unless `field` is the one refused. */
function refusedRule(input: unknown, field: string): string {
  assert.equal(refusedField(input), field, `${JSON.stringify(input)} breaks ${field}`);
  const result = validateAbility(input);
  return result.ok ? "" : result.error.rule;
}

/** The kept declaration's name for `input`, failing the test when it is refused. */
function keptName(input: unknown): string {
  const result = validateAbility(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.ability.name : "";
}

test("validateAbility refuses a line or paragraph separator inside a string, in about too; one trim removes is dropped", () => {
  for (const separator of ["\u2028", "\u2029"]) {
    assert.match(refusedRule({ ...MINIMAL, name: `Event${separator}analogs` }, "name"), /invisible character/);
    refusedRule({ ...MINIMAL, about: `First paragraph.${separator}Second paragraph.` }, "about");
    refusedRule({ ...MINIMAL, asks: [`One${separator}two?`] }, "asks");
    refusedRule({ ...MINIMAL, zh: { blurb: `一行${separator}两行` } }, "zh.blurb");
    assert.equal(keptName({ ...MINIMAL, name: `${separator}Event analogs${separator}` }), "Event analogs", "trimmed at the edges");
  }
});

test("validateAbility refuses a bidi control anywhere in a string, at its edges too", () => {
  const BIDI = ["\u061C", "\u200E", "\u200F", "\u202A", "\u202B", "\u202C", "\u202D", "\u202E", "\u2066", "\u2067", "\u2068", "\u2069"];
  for (const control of BIDI) {
    const hex = control.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
    assert.match(refusedRule({ ...MINIMAL, name: `Event${control}analogs` }, "name"), new RegExp(`invisible character.*U\\+${hex}`));
    refusedRule({ ...MINIMAL, name: `${control}Event analogs` }, "name");
    refusedRule({ ...MINIMAL, limits: [`A limit${control}`] }, "limits");
    refusedRule({ ...MINIMAL, icon: `rew${control}ind` }, "icon");
  }
});

test("validateAbility refuses a zero-width character inside a string; a name that is one U+200B is refused as the character", () => {
  for (const zero of ["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF"]) {
    assert.match(refusedRule({ ...MINIMAL, name: `Event${zero}analogs` }, "name"), /invisible character/);
    refusedRule({ ...MINIMAL, blurb: `A line${zero}for the card` }, "blurb");
    refusedRule({ ...MINIMAL, zh: { name: `事件${zero}对标` } }, "zh.name");
  }
  assert.match(refusedRule({ ...MINIMAL, name: "\u200B" }, "name"), /invisible character.*U\+200B/, "refused as the character, not as empty");
  /* U+FEFF is white space to trim(): at an edge it is dropped. */
  assert.equal(keptName({ ...MINIMAL, name: "\uFEFFEvent analogs\uFEFF" }), "Event analogs");
});

test("validateAbility refuses a string that is not well formed: a lone surrogate, in any field", () => {
  for (const lone of ["\uD800", "\uDFFF", "a\uDC00b"]) {
    assert.match(refusedRule({ ...MINIMAL, name: `Event ${lone}` }, "name"), /well formed/);
    refusedRule({ ...MINIMAL, about: `About ${lone}.` }, "about");
    refusedRule({ ...MINIMAL, asks: [`Ask ${lone}?`] }, "asks");
    refusedRule({ ...MINIMAL, zh: { about: `简介${lone}` } }, "zh.about");
    refusedRule({ ...MINIMAL, icon: `rewind${lone}` }, "icon");
    refusedRule({ ...MINIMAL, tools: [`alpha_tool${lone}`] }, "tools");
  }
  /* A pair is one character, kept. */
  assert.equal(keptName({ ...MINIMAL, name: "Event \uD83D\uDE00" }), "Event 😀");
});

test("validateAbility drops keys the declaration does not name", () => {
  const result = validateAbility({ ...MINIMAL, kind: "mcp", url: "https://example.com/mcp", by: "someone" });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  for (const key of ["kind", "url", "by"]) assert.equal(key in result.ability, false, `${key} is dropped`);
  assert.deepEqual(Object.keys(result.ability).sort(),
    ["about", "asks", "blurb", "icon", "id", "limits", "name", "roles", "rows", "skills", "tools", "zh"]);
});

test("readAbilities keeps the good files in folder order and refuses the rest, each by its file", async () => {
  const root = await mkdtemp(join(tmpdir(), "abilities-"));
  try {
    const put = async (folder: string, body: string | Buffer): Promise<void> => {
      await mkdir(join(root, folder), { recursive: true });
      await writeFile(join(root, folder, ABILITY_FILE), body);
    };
    const good = (id: string): string => JSON.stringify({ ...MINIMAL, id });
    await put("a", good("alpha"));
    await put("b", good("beta"));
    await put("c", "this is not JSON");
    await put("d", JSON.stringify([MINIMAL]));
    /* A good declaration padded past the size: refused by its size alone. */
    const fits = JSON.stringify({ ...MINIMAL, id: "epsilon", pad: "" });
    const over = JSON.stringify({ ...MINIMAL, id: "epsilon", pad: "p".repeat(ABILITY_MAX_BYTES + 1 - Buffer.byteLength(fits)) });
    assert.equal(Buffer.byteLength(over), 8193);
    await put("e", over);
    await put("f", good("alpha"));
    await put("g", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(good("gamma"))]));
    await mkdir(join(root, "h"));
    await writeFile(join(root, "x.js"), "export default {};\n");

    const { abilities, refused } = readAbilities(root);
    assert.deepEqual(abilities.map((a) => a.id), ["alpha", "beta"]);
    assert.deepEqual(refused.map((r) => r.file), ["c/ability.json", "d/ability.json", "e/ability.json", "f/ability.json", "g/ability.json"]);
    assert.equal(refused.find((r) => r.file === "f/ability.json")?.field, "id");
    for (const r of refused) assert.ok(r.rule.length > 0, `${r.file} says its rule`);
    /* The not-JSON refusal is a fixed text: nothing of the file, which a parser's message quotes. */
    const notJson = refused.find((r) => r.file === "c/ability.json");
    assert.deepEqual(notJson && { field: notJson.field, rule: notJson.rule }, { field: "manifest", rule: "is not JSON" });
    assert.equal(notJson?.rule.includes("this is not JSON"), false, "the file's text is absent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readAbilities of a root that does not exist reads nothing", () => {
  assert.deepEqual(readAbilities(join(tmpdir(), "abilities-no-such-root-" + process.pid)), { abilities: [], refused: [] });
});
