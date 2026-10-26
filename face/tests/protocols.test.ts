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

/* The shipped run protocol (modules spec A9, §5.10, A22): Chinese, within its budget, no `{{`, and the
 * cn-market order - the index freeze opens the run, limit-up and boards join it, quotes are optional,
 * the market analyst is called once with the run id, then the reviewer without a market run, then
 * lunhui_read_run. */
test("the shipped lunhui-run.md reads, fits its budget, and states the cn-market order", () => {
  assert.ok(readFileSync(LUNHUI_RUN_PATH).length <= PROTOCOL_MAX_BYTES, "lunhui-run.md is at most 3,000 bytes");
  const text = readProtocol(LUNHUI_RUN_PATH);
  assert.equal(text.includes("{{"), false);
  assert.ok(/[一-鿿]/.test(text), "the protocol is Chinese");
  const market = text.slice(0, text.indexOf("## 策略频道"));
  const at = (name: string) => market.indexOf(name);
  for (const name of ["lunhui_freeze_index", "lunhui_freeze_limit_up", "lunhui_freeze_boards", "lunhui_freeze_quotes", "role_cn_market_analyst", "role_cn_reviewer", "lunhui_read_run"]) assert.ok(at(name) >= 0, `names ${name}`);
  assert.ok(at("lunhui_freeze_index") < at("lunhui_freeze_limit_up") && at("lunhui_freeze_limit_up") < at("role_cn_market_analyst")
    && at("lunhui_freeze_boards") < at("role_cn_market_analyst"), "the freezes, then the analyst");
  assert.ok(at("role_cn_market_analyst") < at("role_cn_reviewer") && at("role_cn_reviewer") < at("lunhui_read_run"), "the analyst, then the reviewer, then the read");
  assert.ok(market.slice(at("role_cn_reviewer")).includes("不传 market_run"), "the market reviewer takes no market run");
  assert.ok(market.includes("可选"), "quotes are optional");
  for (const word of ["cn-market", "RUN_SEALED", "analysis/", "NOT_A_ROLE", "NOT_EVALUABLE", "delayed", "journal.md", "environment.json", "sentiment.json", "theme.json", "counterevidence.json", "blocked"]) assert.ok(text.includes(word), `carries ${word}`);
});

/* The strategy channel (spec §5.10, A5, A22, A27): find the market run by lunhui_read_run on cn-market
 * without a run - the day's or the previous trading day's sealed run - choose candidates from its
 * theme's members and pools, freeze their quotes on the strategy, the stock analyst for the leader
 * with both run ids, the reviewer with both, the analyst again for the mode once the leader is
 * accepted, then lunhui_read_run. A WAIT, a NOT_EVALUABLE artifact and a refused mode are results; a
 * stale market run means a fresh market run and a re-read with it, which a sealed strategy run allows
 * until its leader is accepted - so no "a sealed run cannot be re-anchored" reason. */
test("lunhui-run.md states the strategy channel's order after the cn-market one", () => {
  const text = readProtocol(LUNHUI_RUN_PATH);
  const strategy = text.indexOf("## 策略频道");
  assert.ok(strategy > text.indexOf("role_cn_reviewer"), "the strategy channel follows the market one");
  const part = text.slice(strategy, text.indexOf("## 规则"));
  const at = (word: string, from = 0) => part.indexOf(word, from);
  const find = at("lunhui_read_run");
  assert.ok(find >= 0 && part.slice(find, at("mainline_candidates")).includes("不带 run"), "the market run found without a run");
  assert.ok(part.slice(0, at("mainline_candidates")).includes("cn-market"), "on cn-market");
  assert.ok(part.includes("前一个交易日") && part.includes("当日"), "the day's or the previous trading day's (A5)");
  const leader = at("role_cn_stock_analyst");
  const reviewer = at("role_cn_reviewer");
  const mode = at("role_cn_stock_analyst", leader + 1);
  assert.ok(find < at("mainline_candidates") && at("mainline_candidates") < at("lunhui_freeze_quotes") && at("lunhui_freeze_quotes") < leader, "the market run, candidates, their quotes, then the leader");
  assert.ok(leader >= 0 && leader < reviewer && reviewer < mode && at("lunhui_read_run", mode) > mode, "leader, reviewer, mode, then the run read back");
  assert.ok(leader < at("写 leader") && at("写 leader") < reviewer && mode < at("写 mode"), "the first analyst call writes the leader, the second the mode");
  assert.ok(part.slice(reviewer, mode).includes("被接受"), "the mode waits for the leader's acceptance");
  for (const word of ["market_run", "1–4", "sh60", "sz00", "WAIT", "NOT_EVALUABLE", "被拒的 mode", "STALE_MARKET_RUN", "重读"]) assert.ok(part.includes(word), `carries ${word}`);
  assert.doesNotMatch(text, /不能改引/, "a sealed strategy run can be re-read with a fresh market run");
  const stale = part.slice(part.indexOf("STALE_MARKET_RUN"));
  assert.ok(stale.slice(0, stale.indexOf("。")).includes("上一节") && stale.includes("开新的"), "a stale read is cured by a whole sealed market run, or a new strategy run when that run itself is stale");
  assert.doesNotMatch(text, /以后加入|现在没有/, "the reviewer is no longer to come");
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
