import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CLAUDE_MD = fileURLToPath(new URL("../../CLAUDE.md", import.meta.url));
const AGENTS_MD = fileURLToPath(new URL("../../AGENTS.md", import.meta.url));
/** Every Claude Code session loads the root file whole, AGENTS.md through its import, and both
 * again after each compaction; the budgets keep the pair what the tree cannot show. */
const BUDGET_BYTES = 9000;
const BUDGET_WITH_AGENTS_BYTES = 12000;
/** One line per area: the old Map grew one paragraph row at a time, one row past 6 KB. */
const MAP_ROW_BYTES = 450;

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

test("CLAUDE.md fits its budget, and with AGENTS.md theirs", () => {
  const claude = readFileSync(CLAUDE_MD, "utf8");
  const agents = readFileSync(AGENTS_MD, "utf8");
  assert.ok(bytes(claude) <= BUDGET_BYTES, `CLAUDE.md is ${bytes(claude)} bytes; the budget is ${BUDGET_BYTES}`);
  const both = bytes(claude) + bytes(agents);
  assert.ok(both <= BUDGET_WITH_AGENTS_BYTES, `CLAUDE.md and AGENTS.md are ${both} bytes; the budget is ${BUDGET_WITH_AGENTS_BYTES}`);
});

/* With a CLAUDE.md present, Claude Code reads no AGENTS.md of its own accord: the import is how the
 * coding agents' rules reach a Claude Code session. */
test("CLAUDE.md imports AGENTS.md before its first section", () => {
  const text = readFileSync(CLAUDE_MD, "utf8");
  const importAt = text.search(/^@AGENTS\.md$/m);
  const firstSection = text.search(/^## /m);
  assert.ok(importAt >= 0, "no line `@AGENTS.md`");
  assert.ok(firstSection < 0 || importAt < firstSection, "the import comes after a section");
});

test("CLAUDE.md's Map is one short row per area", () => {
  const text = readFileSync(CLAUDE_MD, "utf8");
  const map = text.split(/^## Map$/m)[1]?.split(/^## /m)[0] ?? "";
  const rows = map.split("\n").filter((line) => line.startsWith("| `"));
  assert.ok(rows.length > 0, "no Map rows");
  for (const row of rows) assert.ok(bytes(row) <= MAP_ROW_BYTES, `a Map row is ${bytes(row)} bytes: ${row.slice(0, 60)}`);
});
