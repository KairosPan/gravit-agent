import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { LUNHUI_RUN_PATH, LUNHUI_RUN_SECTION, PROTOCOLS_DIR, PROTOCOL_MAX_BYTES, readProtocol, readProtocols } from "../src/protocols.ts";
import { ROLES_ROOT, readRoles } from "../src/roles.ts";
import { LUNHUI_TOOL_NAMES } from "../src/lunhui.ts";
import { LUNHUI_RUN_SECTION as PLUGIN_RUN_SECTION } from "../plugins/gravit.js";

/* The shipped run protocol (modules spec A9, §5.10): Chinese, within its budget, no `{{`, and the
 * cn-market order this plan builds - the index freeze opens the run, limit-up and boards join it,
 * quotes are optional, the market analyst is called once with the run id, then lunhui_read_run. */
test("the shipped lunhui-run.md reads, fits its budget, and states the cn-market order", () => {
  assert.ok(readFileSync(LUNHUI_RUN_PATH).length <= PROTOCOL_MAX_BYTES, "lunhui-run.md is at most 3,000 bytes");
  const text = readProtocol(LUNHUI_RUN_PATH);
  assert.equal(text.includes("{{"), false);
  assert.ok(/[一-鿿]/.test(text), "the protocol is Chinese");
  const at = (name: string) => text.indexOf(name);
  for (const name of ["lunhui_freeze_index", "lunhui_freeze_limit_up", "lunhui_freeze_boards", "lunhui_freeze_quotes", "role_cn_market_analyst", "lunhui_read_run"]) assert.ok(at(name) >= 0, `names ${name}`);
  assert.ok(at("lunhui_freeze_index") < at("lunhui_freeze_limit_up") && at("lunhui_freeze_limit_up") < at("role_cn_market_analyst")
    && at("lunhui_freeze_boards") < at("role_cn_market_analyst") && at("role_cn_market_analyst") < at("lunhui_read_run"), "freezes, then the analyst, then the read");
  assert.ok(text.includes("可选"), "quotes are optional");
  for (const word of ["cn-market", "RUN_SEALED", "analysis/", "NOT_A_ROLE", "NOT_EVALUABLE", "delayed", "journal.md", "environment.json", "sentiment.json", "theme.json", "blocked"]) assert.ok(text.includes(word), `carries ${word}`);
});

/* Every lunhui_* tool the protocol names is one the composed rows register (src/lunhui.ts), so a
 * later plan's tool cannot be described before it exists, nor a tool renamed under the protocol. */
test("every lunhui_* tool lunhui-run.md names is a tool the Lunhui rows register", () => {
  const named = [...new Set(readProtocol(LUNHUI_RUN_PATH).match(/\blunhui_[a-z_]+/g) ?? [])].sort();
  const registered = new Set<string>(LUNHUI_TOOL_NAMES);
  assert.ok(named.length > 0);
  assert.deepEqual(named.filter((tool) => !registered.has(tool)), [], `lunhui-run.md names ${named.join(", ")}`);
});

test("the section name is the same in src/protocols.ts and plugins/gravit.js", () => {
  assert.equal(LUNHUI_RUN_SECTION, PLUGIN_RUN_SECTION);
});

/* The protocol names the role it delegates to by tool name, and nothing else ties the two. */
test("every role_* tool lunhui-run.md names is a role the shipped library has", () => {
  const named = [...new Set(readProtocol(LUNHUI_RUN_PATH).match(/\brole_[a-z0-9_]+/g) ?? [])].sort();
  const shipped = new Set(readRoles(ROLES_ROOT).map((role) => role.tool));
  assert.ok(named.length > 0);
  assert.deepEqual(named.filter((tool) => !shipped.has(tool)), [], `lunhui-run.md names ${named.join(", ")}`);
});

test("readProtocols: the run protocol, gated on lunhui_read_run, from the profile directory or a given one", async () => {
  assert.deepEqual(readProtocols(), [{ name: LUNHUI_RUN_SECTION, probe: "lunhui_read_run", text: readProtocol(LUNHUI_RUN_PATH) }]);
  assert.equal(LUNHUI_RUN_SECTION, "lunhui:run");
  assert.equal(LUNHUI_RUN_PATH, join(PROTOCOLS_DIR, "lunhui-run.md"));
  const dir = await mkdtemp(join(tmpdir(), "face-protocols-"));
  try {
    await writeFile(join(dir, "lunhui-run.md"), "\n# 运行\n\n先冻结。\n");
    assert.deepEqual(readProtocols(dir), [{ name: "lunhui:run", probe: "lunhui_read_run", text: "# 运行\n\n先冻结。" }]);
    const empty = await mkdtemp(join(tmpdir(), "face-protocols-"));
    try {
      const missing = join(empty, "lunhui-run.md");
      assert.throws(() => readProtocols(empty), (e: Error) => e.message === `${missing}: the protocol file is missing`);
    } finally { await rm(empty, { recursive: true, force: true }); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/* readCycle's refusals, path-first, plus one: the section does not interpolate, but a `{{` in a
 * protocol is refused all the same (spec §5.10: no `{{`), so the file never reads as a template. */
test("readProtocol: trimmed; missing, unreadable, empty, oversized and templated refused path-first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-protocols-"));
  try {
    const missing = join(dir, "no-such.md");
    assert.throws(() => readProtocol(missing), (e: Error) => e.message === `${missing}: the protocol file is missing`);
    assert.throws(() => readProtocol(relative(process.cwd(), missing)), (e: Error) => e.message === `${missing}: the protocol file is missing`);
    const notAFile = join(dir, "a-directory.md");
    await mkdir(notAFile);
    assert.throws(() => readProtocol(notAFile), (e: Error) => e.message.startsWith(`${notAFile}: cannot be read: `) && e.message.includes("EISDIR"));
    const empty = join(dir, "empty.md");
    await writeFile(empty, "  \n");
    assert.throws(() => readProtocol(empty), (e: Error) => e.message === `${empty}: the protocol is empty`);
    const templated = join(dir, "templated.md");
    await writeFile(templated, "先冻结 {{run}}。\n");
    assert.throws(() => readProtocol(templated), (e: Error) => e.message === `${templated}: contains {{, which a protocol may not`);
    const single = join(dir, "single.md");
    await writeFile(single, "{run} 是一个字面量。\n");
    assert.equal(readProtocol(single), "{run} 是一个字面量。", "a single brace is prose");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/* The cap counts raw bytes, inclusive: 1,000 three-byte characters are exactly the limit. */
test("readProtocol: the limit is inclusive and counts raw bytes - PROTOCOL_MAX_BYTES accepted, one more refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-protocols-"));
  try {
    assert.equal(PROTOCOL_MAX_BYTES, 3000);
    const atLimit = join(dir, "at-limit.md");
    await writeFile(atLimit, "运".repeat(PROTOCOL_MAX_BYTES / 3));
    assert.equal(readProtocol(atLimit), "运".repeat(PROTOCOL_MAX_BYTES / 3));
    const over = join(dir, "over.md");
    await writeFile(over, "运".repeat(PROTOCOL_MAX_BYTES / 3) + "\n");
    assert.throws(() => readProtocol(over), (e: Error) => e.message === `${over}: is ${PROTOCOL_MAX_BYTES + 1} bytes; the limit is ${PROTOCOL_MAX_BYTES}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
