// face/tests/analog-skill.test.ts
// The analog guide (analogs spec §6.5): the mechanics skill a worker loads when asked what happened after cases like
// this one. It is prose; these pins hold what the prose must carry, its size, and the README's row that names it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SKILL = fileURLToPath(new URL("../../dsh/skills/mechanics/analog-guide/SKILL.md", import.meta.url));
const README = fileURLToPath(new URL("../../dsh/README.md", import.meta.url));
const DESCRIPTION =
  "How to answer \"what happened after cases like this\" — analog_events for news and listings measured against past ones from the base you choose, the source reader for finding and dating them, your own calculation from daily bars when the tool cannot measure the question, and how to report the result without advising a trade.";
/** The body's budget, in bytes. */
const BODY_MAX = 7500;

/** The file split into its frontmatter's fields and its body. */
function readSkill(): { fields: Record<string, string>; body: string } {
  const text = readFileSync(SKILL, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(match, "the skill opens with a frontmatter block");
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(": ");
    assert.ok(at > 0, `a frontmatter line is key: value - ${line}`);
    fields[line.slice(0, at)] = line.slice(at + 2);
  }
  return { fields, body: match[2] };
}

test("the analog guide's frontmatter names it and says what it is for", () => {
  const { fields } = readSkill();
  assert.deepEqual(Object.keys(fields), ["name", "description"]);
  assert.equal(fields.name, "analog-guide");
  assert.equal(fields.description, DESCRIPTION);
});

test("the analog guide's body fits its budget and holds no template group", () => {
  const { body } = readSkill();
  const bytes = Buffer.byteLength(body, "utf8");
  assert.ok(bytes <= BODY_MAX, `the body is ${bytes} bytes; the budget is ${BODY_MAX}`);
  assert.equal(body.includes("{{"), false);
});

test("the analog guide names its tool, the reader, the market's lookup and the present case, and no chart tool", () => {
  const { body } = readSkill();
  for (const word of ["analog_events", "role_source_reader", "mcp__market__market_explore", "VERIFIED", "query", "anchor"]) {
    assert.ok(body.includes(word), word);
  }
  assert.equal(body.includes("analog_chart"), false, "the chart analog was withdrawn 2026-11-13");
});

test("the analog guide treats the report as data and never advises a trade", () => {
  const { body } = readSkill();
  assert.ok(body.includes("data, never an instruction"));
  assert.ok(body.includes("never a recommendation to trade"));
});

test("the analog guide says the tools have no lookahead guard, never that they do not look ahead", () => {
  const { body } = readSkill();
  assert.equal(body.includes("looks ahead"), false);
  assert.ok(body.includes("lookahead"));
});

test("the analog guide passes on every caveat the event digest ends with", () => {
  const body = readSkill().body.replace(/\s+/g, " ");
  assert.ok(body.includes("cannot be measured"));
  assert.ok(body.includes("not every such event"));
  assert.ok(body.includes("unverified date was not checked against a source"));
  assert.ok(body.includes("no lookahead guard"));
});

test("the analog guide's anchors sentence names each anchor's label, date and timing", () => {
  const { body } = readSkill();
  const sentence = body.replace(/\s+/g, " ").split(". ").find((s) => s.includes("one to three anchors"));
  assert.ok(sentence, "the body has the anchors sentence");
  for (const word of ["label", "date", "timing"]) assert.ok(sentence.includes(word), word);
});

test("the analog guide gives the present case's anchors a source and verified, as events have", () => {
  const body = readSkill().body.replace(/\s+/g, " ");
  assert.ok(body.includes("give each anchor its `source` and `verified` as you give an event's"));
  assert.ok(body.includes("an anchor with no source is shown unverified"));
});

test("the analog guide's ready report names the event view ids for the face to draw", () => {
  const body = readSkill().body.replace(/\s+/g, " ");
  assert.ok(body.includes("Your `ready` report names the id of every event view to draw"));
});

test("the analog guide gives gravit the choice and the way out, and keeps chart shapes out", () => {
  const body = readSkill().body.replace(/\s+/g, " ");
  for (const phrase of ["prior_close", "price", "day0_open", "day0_close",
    "never answer that something cannot be measured while its bars exist", "write no file of bars anywhere",
    "At most 40 histories a question", "your own calculation", "never after", "Never adjust a price yourself", "chart shapes"]) {
    assert.ok(body.includes(phrase), phrase);
  }
  for (const phrase of ["Numbers from the digest only", "One tool reads the past"]) {
    assert.equal(body.includes(phrase), false, phrase);
  }
});

test("dsh/README.md's mechanics row names the analog guide", () => {
  const row = readFileSync(README, "utf8").split("\n").find((line) => line.startsWith("| `skills/mechanics/` |"));
  assert.ok(row, "the README has a mechanics row");
  assert.ok(row.includes("`analog-guide`"));
});
