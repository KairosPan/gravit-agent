import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ROLES_ROOT, readRoles, toolNameFor } from "../src/roles.ts";
import { makeRolesRoot } from "./bots-fixture.ts";

const FORBIDDEN = new Set(["ask_user_question", "web_search", "web_fetch", "subagent", "subagent_fork", "send_message", "interrupt_agent",
  "list_agents", "workflow", "ralph", "create_goal", "get_goal", "update_goal", "todo_write", "run_code",
  "dispatch", "exit_plan_mode", "mcp__venue__account", "mcp__venue__positions", "mcp__venue__orders",
  "mcp__venue__place_order", "mcp__venue__cancel_order"]);
/** The account and order tools under ANY server name, matched by their raw suffix as src/orders.ts
 *  `isOrderTool` matches the order tools: an independent copy of the reader's rule. */
const ACCOUNT_OR_ORDER = /(^|__)(account|positions|orders|place_order|cancel_order|portfolio_live_order|portfolio_live_batch|portfolio_live_amend|portfolio_live_cancel|portfolio_live_close|portfolio_live_leverage|portfolio_live_move|portfolio_live_earn|portfolio_pay|portfolio_order|portfolio_execute|portfolio_transfer)$/;
const JOB_TOOLS = ["job_output", "job_list", "job_kill"];

test("toolNameFor: role_ plus the id with dashes as underscores", () => {
  assert.equal(toolNameFor("probe"), "role_probe");
  assert.equal(toolNameFor("data-check"), "role_data_check");
});

/* The repository ships one role, `cn-market-analyst` (modules spec A8, §5.9): the three market module
 * pairs plus `skill`, on deepseek-flash, and no freeze, file or AKShare tool. Gravit's preset is the
 * gravit row, whose summary list names it, then its one-shot row - and the committed mirror says so. */
const MARKET_ANALYST_ALLOW = ["skill", "lunhui_read_environment_context", "lunhui_submit_environment",
  "lunhui_read_sentiment_context", "lunhui_submit_sentiment", "lunhui_read_theme_context", "lunhui_submit_theme"];

test("Gravit's preset has one role row: the shipped library is cn-market-analyst", () => {
  const roles = readRoles(ROLES_ROOT);
  assert.deepEqual(roles.map((role) => role.id), ["cn-market-analyst"], "roles/ holds _template and cn-market-analyst");
  const [analyst] = roles;
  assert.equal(analyst.tool, "role_cn_market_analyst");
  assert.equal(analyst.name, "CN market analyst");
  assert.deepEqual(analyst.allow, MARKET_ANALYST_ALLOW, "skill and the environment, sentiment and theme pairs, in module order");
  assert.equal(analyst.model, "deepseek-official/deepseek-flash");
  assert.ok(!analyst.allow.some((name) => name.startsWith("lunhui_freeze_")), "no role carries a freeze");
  const rows = gravitRows(roles, { plugin: GRAVIT_PLUGIN_URL, cycle: readCycle(CYCLE_PATH) }) as Array<{ id: string; name: string; config: Record<string, unknown> }>;
  assert.deepEqual(rows.map((row) => row.id), [GRAVIT_ROW_ID, roleRowId("cn-market-analyst")]);
  assert.deepEqual(rows[0].config.roles, [{ tool: "role_cn_market_analyst", summary: analyst.description }]);
  assert.deepEqual(rows[1].config.agentOptions, { provider: "deepseek-official", model: "deepseek-flash" });
  const mirror = readFileSync(new URL("../../bots/gravit/agent.cordis.yml", import.meta.url), "utf8");
  assert.equal(mirror.match(/^- id: role-/gm)?.length, 1, "the mirror carries one role row");
  assert.match(mirror, /^ {4}toolName: role_cn_market_analyst$/m);
  assert.match(mirror, /^ {6}model: deepseek-flash$/m, "on its role's route");
});

/* The persona is the tree's own Chinese (D14′): the job, the module order, the artifact only in
 * `analysis`, NOT_EVALUABLE submitted as such, the blocked exit, the four report headings and the
 * paths it names. Each sentence is the role's protocol, so each is pinned by a word it must carry. */
test("cn-market-analyst's ROLE.md: Chinese, within 2,000 bytes, the order, the analysis-only artifact, the blocked exit, the four headings", () => {
  const file = new URL("../../roles/cn-market-analyst/ROLE.md", import.meta.url);
  assert.ok(readFileSync(file).length <= 2000, "ROLE.md is at most 2,000 bytes");
  const persona = readRoles(ROLES_ROOT).find((role) => role.id === "cn-market-analyst")!.persona;
  assert.ok(persona.includes("市场与题材分析员"), "the role's name");
  assert.ok(persona.includes("cn-market"), "the channel the brief's run id belongs to");
  const at = (name: string) => persona.indexOf(name);
  for (const name of MARKET_ANALYST_ALLOW.slice(1)) assert.ok(at(name) >= 0, `names ${name}`);
  assert.ok(at("lunhui_read_environment_context") < at("lunhui_read_sentiment_context")
    && at("lunhui_read_sentiment_context") < at("lunhui_read_theme_context"), "environment, then sentiment, then theme");
  assert.ok(persona.includes("`analysis`") && persona.includes("不写进消息"), "the artifact goes only into analysis");
  assert.ok(persona.includes("NOT_EVALUABLE"), "a NOT_EVALUABLE context is submitted as such");
  assert.ok(persona.includes("读取失败") && persona.includes("第三次") && persona.includes("blocked"), "the blocked exit");
  assert.ok(persona.includes("只停止该模块，接着做下一个模块") && persona.includes("每个受阻的模块"), "a third rejection stops that module only, each blocked module reported");
  for (const heading of ["**status**", "**what was measured**", "**paths**", "**limits**"]) assert.ok(persona.includes(heading), heading);
  assert.ok(persona.includes("analysis/<run>/<module>.json"), "the paths it reports");
});

test("over a roles/ holding only _template the preset has no role_* row; the fixture role renders exactly one", async () => {
  const root = await makeRolesRoot();
  try {
    const toolsOf = (rows: Array<{ config: Record<string, unknown> }>) => rows.map((row) => row.config.toolName).filter((name) => name !== undefined);
    await rm(join(root, "probe"), { recursive: true, force: true });
    const empty = gravitRows(readRoles(root), { plugin: GRAVIT_PLUGIN_URL }) as Array<{ id: string; config: Record<string, unknown> }>;
    assert.deepEqual(empty.map((row) => row.id), [GRAVIT_ROW_ID]);
    assert.deepEqual(toolsOf(empty), []);
    await cp(join(ROLES_ROOT, "_template"), join(root, "probe"), { recursive: true });
    await writeFile(join(root, "probe", "ROLE.md"), "You are the probe, a test role.\n");
    await writeFile(join(root, "probe", "role.yml"), "name: Probe\ndescription: a test role\nallow: [read]\n");
    const one = gravitRows(readRoles(root), { plugin: GRAVIT_PLUGIN_URL }) as Array<{ id: string; config: Record<string, unknown> }>;
    assert.deepEqual(one.map((row) => row.id), [GRAVIT_ROW_ID, roleRowId("probe")]);
    assert.deepEqual(toolsOf(one), ["role_probe"]);
    assert.deepEqual(one[0].config.roles, [{ tool: "role_probe", summary: "a test role" }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

/* The rules every role the repository ships obeys (cn-market-analyst today); a role the operator adds is held to them. */
test("every shipped role: exact names only, nothing forbidden, jobs only beside bash", () => {
  for (const role of readRoles(ROLES_ROOT)) {
    assert.ok(role.description.length <= 300 && role.description.length > 0, role.id);
    for (const name of role.allow) {
      assert.equal(name.includes("*"), false, `${role.id}: ${name} is exact`);
      assert.equal(FORBIDDEN.has(name) || ACCOUNT_OR_ORDER.test(name) || name.startsWith("role_") || name.startsWith("mcp__akshare__") || name.startsWith("mcp__account__") || name.startsWith("agent_"), false, `${role.id}: ${name} is never a role's`);
    }
    /* A bash command past the executor's default moves to a background job the child owns; the job tools
     * are how it reads and stops one, and they mean nothing to a role that cannot start a command. */
    if (JOB_TOOLS.some((job) => role.allow.includes(job))) assert.ok(role.allow.includes("bash"), `${role.id}: a job tool only beside bash`);
  }
});

test("readRoles skips _template, hidden entries and plain files, and reads a valid role", async () => {
  const root = await makeRolesRoot();
  try {
    await mkdir(join(root, ".drafts"));
    await writeFile(join(root, "NOTES.md"), "not a role\n");
    const roles = readRoles(root);
    assert.deepEqual(roles.map((r) => r.id), ["probe"]);
    assert.deepEqual(roles[0], { id: "probe", tool: "role_probe", name: "Probe", description: "a test role", persona: "You are the probe, a test role.", allow: ["read"] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("readRoles refuses, naming the file: braces, an empty persona, a wildcard, an empty allow list, a bad model, a missing root", async () => {
  const root = await makeRolesRoot();
  try {
    await writeFile(join(root, "probe", "ROLE.md"), "You are {{nobody}}.\n");
    assert.throws(() => readRoles(root), (e: Error) => e.message.startsWith(join(root, "probe", "ROLE.md")) && /\{\{/.test(e.message));
    await writeFile(join(root, "probe", "ROLE.md"), "\n");
    assert.throws(() => readRoles(root), /ROLE\.md.*empty/);
    await writeFile(join(root, "probe", "ROLE.md"), "You are the probe.\n");
    await writeFile(join(root, "probe", "role.yml"), "name: Probe\ndescription: x\nallow: [mcp__*__screen]\n");
    assert.throws(() => readRoles(root), /role\.yml.*wildcards are not accepted; name the exact tool, e\.g\. read or mcp__<server>__<raw>/);
    await writeFile(join(root, "probe", "role.yml"), "name: Probe\ndescription: x\nallow: []\n");
    assert.throws(() => readRoles(root), /allow/);
    await writeFile(join(root, "probe", "role.yml"), "name: Probe\ndescription: x\nallow: [read]\nmodel: nope\n");
    assert.throws(() => readRoles(root), /model/);
  } finally { await rm(root, { recursive: true, force: true }); }
  assert.throws(() => readRoles(join(tmpdir(), "no-such-roles-root")), /missing/);
});

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { GRAVIT_PLUGIN_URL, GRAVIT_ROW_ID, gravitRows, renderGravitComposition, roleRowId } from "../src/roles.ts";
import { GRAVIT_PLUGIN_RELATIVE } from "../src/overlay.ts";
import { CYCLE_PATH, readCycle } from "../src/cycle.ts";
import { readProtocols } from "../src/protocols.ts";

test("gravitRows: the gravit row carries the summaries; one one-shot spawn row per role with persona and an exact allow list", async () => {
  const root = await makeRolesRoot();
  try {
    const roles = readRoles(root);
    assert.equal(roles.length, 1, "the fixture root holds one role");
    const rows = gravitRows(roles, { plugin: GRAVIT_PLUGIN_URL }) as Array<{ id: string; name: string; config: Record<string, unknown> }>;
    assert.equal(rows[0].id, GRAVIT_ROW_ID);
    assert.equal(rows[0].name, GRAVIT_PLUGIN_URL);
    assert.ok(GRAVIT_PLUGIN_URL.startsWith("file:") && GRAVIT_PLUGIN_URL.endsWith("/face/plugins/gravit.js"));
    assert.deepEqual(rows[0].config, { roles: roles.map((r) => ({ tool: r.tool, summary: r.description })) });
    assert.equal(rows.length, 1 + roles.length);
    for (const role of roles) {
      const row = rows.find((r) => r.id === roleRowId(role.id))!;
      assert.equal(row.name, "@deepseek-ai/dsh-tool-subagent");
      assert.deepEqual(Object.keys(row.config).sort(), ["backgroundMode", "persona", "provider", "toolFilter", "toolName"]);
      assert.deepEqual(row.config, { provider: "spawn", toolName: role.tool, backgroundMode: "one-shot", persona: role.persona, toolFilter: { allow: role.allow } });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("gravitRows: a role.yml model becomes the row's agentOptions, provider and model split; without one the key is absent", async () => {
  const root = await makeRolesRoot();
  try {
    const rowOf = () => (gravitRows(readRoles(root), { plugin: GRAVIT_PLUGIN_URL }) as Array<{ id: string; config: Record<string, unknown> }>)
      .find((r) => r.id === roleRowId("probe"))!;
    assert.equal("agentOptions" in rowOf().config, false, "a role.yml with no model has no agentOptions");
    await writeFile(join(root, "probe", "role.yml"), "name: Probe\ndescription: a test role\nallow:\n  - read\nmodel: deepseek-official/deepseek-v4-flash\n");
    const row = rowOf();
    assert.deepEqual(row.config.agentOptions, { provider: "deepseek-official", model: "deepseek-v4-flash" });
    assert.deepEqual(Object.keys(row.config).sort(), ["agentOptions", "backgroundMode", "persona", "provider", "toolFilter", "toolName"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the committed mirror bots/gravit/agent.cordis.yml is exactly the render of roles/ (drift fails here)", () => {
  const mirror = readFileSync(new URL("../../bots/gravit/agent.cordis.yml", import.meta.url), "utf8");
  assert.equal(mirror, renderGravitComposition(readRoles(ROLES_ROOT), { cycle: readCycle(CYCLE_PATH), protocols: readProtocols() }), "run: cd face && npm run render:roles");
  assert.match(mirror, /^ {4}protocols:\n {6}- name: lunhui:run\n {8}probe: lunhui_read_run\n/m, "the mirror carries the run protocol");
  assert.ok(mirror.includes("lunhui-run.md"), "and its header names the file it came from");
  assert.ok(mirror.includes(`name: ${GRAVIT_PLUGIN_RELATIVE}`), "the mirror names the plugin by the shipped relative path");
  assert.equal(mirror.includes("file:"), false, "and never by a machine-specific URL");
});

/* The refusals the tests above do not reach. A refusal is ONE line that opens with the
 * absolute path of the file (or directory) it is about, so the boot log points at the place
 * to fix. `files` edits the fresh root from makeRolesRoot (null removes a file); `links` adds
 * a symbolic link at a path, pointing at a target, both relative to that root; `read` is
 * what readRoles is given, relative to that root. */
const LONG_ID = "a".repeat(60);
const REFUSED: Array<{ label: string; files: Record<string, string | null>; links?: Record<string, string>; read?: string; path: string; reason: RegExp }> = [
  { label: "role.yml missing", files: { "probe/role.yml": null }, path: "probe/role.yml", reason: /missing/ },
  { label: "ROLE.md missing", files: { "probe/ROLE.md": null }, path: "probe/ROLE.md", reason: /missing/ },
  { label: "ROLE.md of 2,001 bytes", files: { "probe/ROLE.md": "x".repeat(2001) }, path: "probe/ROLE.md", reason: /is 2001 bytes; the limit is 2000/ },
  { label: "role.yml that is not YAML", files: { "probe/role.yml": "name: [\n" }, path: "probe/role.yml", reason: /is not valid YAML/ },
  { label: "role.yml that is a list", files: { "probe/role.yml": "- name: Probe\n" }, path: "probe/role.yml", reason: /must be a mapping/ },
  { label: "role.yml that is a scalar", files: { "probe/role.yml": "just text\n" }, path: "probe/role.yml", reason: /must be a mapping/ },
  { label: "role.yml that is empty", files: { "probe/role.yml": "" }, path: "probe/role.yml", reason: /must be a mapping/ },
  { label: "a blank name", files: { "probe/role.yml": "name: '  '\ndescription: x\nallow: [read]\n" }, path: "probe/role.yml", reason: /name is missing or blank/ },
  { label: "a blank description", files: { "probe/role.yml": "name: Probe\ndescription: '  '\nallow: [read]\n" }, path: "probe/role.yml", reason: /description is missing or blank/ },
  { label: "a description of 301 characters", files: { "probe/role.yml": `name: Probe\ndescription: ${"d".repeat(301)}\nallow: [read]\n` }, path: "probe/role.yml", reason: /description is 301 characters; the limit is 300/ },
  { label: "a description on two lines", files: { "probe/role.yml": "name: Probe\ndescription: |\n  first line\n  second line\nallow: [read]\n" }, path: "probe/role.yml", reason: /description must be one line/ },
  { label: "an allow entry that is not a string", files: { "probe/role.yml": "name: Probe\ndescription: x\nallow: [read, 5]\n" }, path: "probe/role.yml", reason: /allow entry 2 is not a string/ },
  { label: "an allow entry outside the tool-name grammar", files: { "probe/role.yml": "name: Probe\ndescription: x\nallow: ['a b']\n" }, path: "probe/role.yml", reason: /allow entry "a b" is not a tool name/ },
  { label: "an allow entry no role carries", files: { "probe/role.yml": "name: Probe\ndescription: x\nallow: [read, ask_user_question]\n" }, path: "probe/role.yml", reason: /allow entry "ask_user_question": a role never carries/ },
  { label: "an allow entry listed twice", files: { "probe/role.yml": "name: Probe\ndescription: x\nallow: [read, grep, read]\n" }, path: "probe/role.yml", reason: /allow entry "read" is listed twice/ },
  { label: "a role directory whose name is not an id", files: { "Probe_Two/ROLE.md": "You are two.\n", "Probe_Two/role.yml": "name: Two\ndescription: x\nallow: [read]\n" }, path: "Probe_Two", reason: /is not a role id/ },
  { label: "a role directory that is a symbolic link", files: {}, links: { linked: "probe" }, path: "linked", reason: /is a symbolic link/ },
  { label: "a model that is not a string", files: { "probe/role.yml": "name: Probe\ndescription: x\nallow: [read]\nmodel: 5\n" }, path: "probe/role.yml", reason: /model must be a <provider>\/<model> route.*\(got a non-string\)/ },
  { label: "a tool name over 64 characters", files: { [`${LONG_ID}/ROLE.md`]: "You are long.\n", [`${LONG_ID}/role.yml`]: "name: Long\ndescription: x\nallow: [read]\n" }, path: LONG_ID, reason: /role_a{60} is 65 characters; the limit is 64/ },
  { label: "a roles root that is a file", files: { "a-file": "not a directory\n" }, read: "a-file", path: "a-file", reason: /is not a directory/ },
  { label: "a roles root that is missing", files: {}, read: "no-such-dir", path: "no-such-dir", reason: /the roles directory is missing/ },
];

test("readRoles refuses every other malformed shape in one line that opens with the path it is about", async () => {
  for (const { label, files, links = {}, read = "", path, reason } of REFUSED) {
    const root = await makeRolesRoot();
    try {
      for (const [file, body] of Object.entries(files)) {
        const target = join(root, file);
        if (body === null) await rm(target);
        else {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, body);
        }
      }
      for (const [link, target] of Object.entries(links)) await symlink(join(root, target), join(root, link));
      assert.throws(() => readRoles(join(root, read)), (e: Error) => {
        assert.ok(e.message.startsWith(`${join(root, path)}: `), `${label}: opens with the path it is about, got: ${e.message}`);
        assert.match(e.message, reason, label);
        assert.equal(e.message.includes("\n"), false, `${label}: one line`);
        return true;
      }, label);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

/* The account and order names are refused under any server name, the way Gate 2 matches the order
 * tools by raw suffix (src/orders.ts `isOrderTool`): a server mounted as `broker` cannot slip them in. */
const RENAMED_SERVER = ["account", "positions", "orders", "place_order", "cancel_order", "portfolio_live_order", "portfolio_pay"].map((raw) => `mcp__broker__${raw}`);

test("readRoles refuses every tool a role never carries, naming role.yml and why", async () => {
  const root = await makeRolesRoot();
  try {
    /* The Account seat's tools (spec 2026-10-20 §5.3): every tool under the seat's prefix — a role has no reason to read
     * the account — and its twelve writes under any server name. */
    for (const entry of [...FORBIDDEN, ...RENAMED_SERVER, "role_probe", "agent_codex", "mcp__akshare__stock_zh_a_hist",
      "mcp__account__portfolio_holdings", "mcp__account__portfolio_wait", "portfolio_live_close"]) {
      await writeFile(join(root, "probe", "role.yml"), `name: Probe\ndescription: x\nallow:\n  - read\n  - ${entry}\n`);
      assert.throws(() => readRoles(root), (e: Error) =>
        e.message.startsWith(`${join(root, "probe", "role.yml")}: allow entry ${JSON.stringify(entry)}: a role never carries `), entry);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the limits are inclusive: 2,000 bytes of persona, 300 characters of description and a 64-character tool name are read", async () => {
  const root = await makeRolesRoot();
  try {
    const id = "b".repeat(59);
    await mkdir(join(root, id));
    await writeFile(join(root, id, "ROLE.md"), "y".repeat(2000));
    await writeFile(join(root, id, "role.yml"), `name: Edge\ndescription: ${"d".repeat(300)}\nallow: [read]\n`);
    const edge = readRoles(root).find((r) => r.id === id)!;
    assert.deepEqual([edge.tool.length, edge.persona.length, edge.description.length], [64, 2000, 300]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
