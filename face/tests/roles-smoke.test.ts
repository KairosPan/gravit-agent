/** Role delegation on a real tree: `role_auditor` and `role_worker` spawn a
 * one-shot child whose persona is the role's (shadowing Gravit's), whose tools
 * are exactly the role's allow list (ancestor-layer `role_*` tools removed,
 * `gravit:roles` and `gravit:cycle` blank), and whose result returns through
 * the tool; the auditor's child reads the root `GRAVIT.md` in its
 * `agent-instructions` baseline; a `subagent_fork` child - seeded and
 * unrestricted - is assembled Gravit's system text byte for byte (the roles
 * list and the cycle contract included) and Gravit's tools, the premise of its
 * inherited prefix's cache reuse; a plain `subagent` child - unseeded and as
 * unrestricted - reads neither section although it can call `create_goal` and
 * every role tool; a role naming a tool the tree lacks fails loudly at
 * delegation. The two roles are fixtures made from the real `roles/_template`
 * under the test's own roles root, handed to the boot as `rolesRoot`; the MCP
 * tools they name are stand-ins registered under a server name nothing real
 * uses. The second case boots the shipped cn-market-analyst (a fixture copy on
 * the stub's route) against the real Lunhui rows, the third the shipped
 * cn-stock-analyst the same way over a sealed market run. Own file, gated. */
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { SessionId, type Session } from "@deepseek-ai/dsh-session";
import { assembleContextFor } from "@deepseek-ai/dsh-agent";
import { renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { PERSONA_PATH, readPersona } from "../src/persona.ts";
import { ROLE_TEMPLATE, ROLES_ROOT, readRoles } from "../src/roles.ts";
import { LUNHUI_RUN_PATH, readProtocol } from "../src/protocols.ts";
import { writeArtifact } from "../plugins/lunhui/lib/runs.mjs";
import { makeBotsRoot } from "./bots-fixture.ts";
import { mountClient, remote, signIn } from "./remote.ts";
import { StubAdapter, type StubReply } from "./stub-llm.ts";

const gated = process.env.FACE_SMOKE !== "1";
/** Planted in the fixture root's GRAVIT.md: what an `agent-instructions` baseline carries when it read the file. */
const GRAVIT_MARK = "GRAVIT-ROOT-MARK-7f3a";
/** The opening words of the research-cycle contract (`dsh/profile/cycle.md`, the `gravit:cycle` section): enough
 *  to tell whether the section reached a prompt, without copying the contract into a test. The em dash is U+2014. */
const CYCLE_HEADING = "Step 0 — ask once";
/** The run protocol's first line (`dsh/profile/lunhui-run.md`, the `lunhui:run` section), read from the file. */
const RUN_HEADING = readProtocol(LUNHUI_RUN_PATH).split("\n")[0];
const sourceKind = (m: { source?: unknown }) => ((m.source ?? {}) as { kind?: string }).kind;
const textOf = (m: GenerateOptions["messages"][number]) => m.content.map((b) => "text" in b ? b.text : "").join("\n");
const lastHuman = (r: GenerateOptions) => [...r.messages].reverse().find((m) => ["user", "tool"].includes(String(sourceKind(m))));
/** The first UTF-16 index where two strings differ, -1 when they are equal: a failure names where. */
function firstDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}
async function waitFor(label: string, check: () => boolean, ms = 30_000) {
  const until = Date.now() + ms;
  while (!check()) { if (Date.now() >= until) throw new Error(`timed out: ${label}`); await new Promise((r) => setTimeout(r, 20)); }
}

/** The fixture roles: each a copy of the repository's real `roles/_template` with its own persona and
 *  allow list. The auditor reads only; the worker runs commands, writes, and owns its background jobs. */
const FIXTURE_ROLES: Record<string, { persona: string; allow: string[] }> = {
  auditor: { persona: "You are the auditor, a fixture role that reads only.", allow: ["read", "glob", "grep", "skill", "mcp__fixture__lookup", "mcp__fixture__history"] },
  worker: { persona: "You are the worker, a fixture role with hands.", allow: ["bash", "job_output", "job_list", "job_kill", "read", "write", "glob", "grep", "skill", "mcp__fixture__lookup", "mcp__fixture__fetch"] },
};
async function makeFixtureRolesRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "face-roles-lib-"));
  await cp(join(ROLES_ROOT, ROLE_TEMPLATE), join(root, ROLE_TEMPLATE), { recursive: true });
  for (const [id, role] of Object.entries(FIXTURE_ROLES)) {
    await cp(join(ROLES_ROOT, ROLE_TEMPLATE), join(root, id), { recursive: true });
    await writeFile(join(root, id, "ROLE.md"), `${role.persona}\n`);
    await writeFile(join(root, id, "role.yml"), `name: ${id}\ndescription: the ${id} fixture role\nallow:\n${role.allow.map((name) => `  - ${name}\n`).join("")}`);
  }
  return root;
}

test("roles smoke: persona, exact tools, the result, the baseline, a fork's identical prefix, a spawn's blank sections, and a loud failure for a missing tool", { skip: gated && "set FACE_SMOKE=1", timeout: 180_000 }, async () => {
  const bots = await makeBotsRoot();
  const rolesRoot = await makeFixtureRolesRoot();
  const root = await realpath(await mkdtemp(join(tmpdir(), "face-roles-root-")));
  const home = await mkdtemp(join(tmpdir(), "face-roles-home-"));
  let dispose: (() => Promise<void>) | undefined;
  try {
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "GRAVIT.md"), `# fixture\n${GRAVIT_MARK}\n`);
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
    writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: stub\n    model: echo\n`);
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: bots, rolesRoot });
    dispose = booted.dispose;
    const { ctx } = booted;
    const tools = ctx.get("tools") as { register(d: unknown): () => void; schemas(scope?: object): { name: string }[] };
    /* Stand-ins under the exact names the fixture roles allow, plus one neither does. */
    const mcpNames = new Set(readRoles(rolesRoot).flatMap((r) => r.allow).filter((n) => n.startsWith("mcp__")));
    mcpNames.add("mcp__fixture__private");
    const unregister = new Map<string, () => void>();
    for (const name of mcpNames) unregister.set(name, tools.register({ name, description: `stand-in ${name}`, parameters: {}, output: { schema: { type: "object" }, render: () => [{ type: "text", text: "ok" }] }, execute: async () => ({}) }));
    const requested = new Map<string, GenerateOptions[]>();
    /* A one-shot child leaves `ctx.sessions` the moment its result returns, which can be before a 20 ms
     * poll looks (measured: the lookup came back empty in most runs), so each session's header is copied
     * while its request is being served, when it is certainly there. */
    const headers = new Map<string, Session["header"]>();
    const isChild = (id: string) => headers.get(id)?.origin === "subagent";
    const script = (request: GenerateOptions): StubReply => {
      if (request.purpose !== undefined) return { kind: "text", text: "fixture" };
      const id = String(request.sessionId);
      requested.set(id, [...requested.get(id) ?? [], request]);
      const header = ctx.sessions.get(request.sessionId!)?.header;
      if (header !== undefined && !headers.has(id)) headers.set(id, { ...header });
      const trigger = lastHuman(request);
      const text = trigger ? textOf(trigger) : "";
      if (header?.isSeeded === true) return { kind: "text", text: "FORK_DONE" };
      if (header?.origin === "subagent") return { kind: "text", text: text.includes("AUDIT_FIXTURE") ? "AUDIT_DONE" : text.includes("SPAWN_FIXTURE") ? "SPAWN_DONE" : "WORK_DONE" };
      if (sourceKind(trigger!) === "user" && text === "RUN_AUDITOR") return { kind: "tool", name: "role_auditor", args: { description: "Audit the fixture", prompt: "AUDIT_FIXTURE: audit the fixture strategy." } };
      if (sourceKind(trigger!) === "user" && text === "RUN_FORK") return { kind: "tool", name: "subagent_fork", args: { description: "Fork the fixture", prompt: "FORK_FIXTURE: continue." } };
      if (sourceKind(trigger!) === "user" && text === "RUN_SUBAGENT") return { kind: "tool", name: "subagent", args: { description: "Spawn the fixture", prompt: "SPAWN_FIXTURE: check one source.", run_in_background: false } };
      if (sourceKind(trigger!) === "user" && text === "RUN_WORKER") return { kind: "tool", name: "role_worker", args: { description: "Work one task", prompt: "WORK_FIXTURE: one bounded task." } };
      return { kind: "text", text: "PARENT_DONE" };
    };
    ctx.llm.registerAdapter(["stub"], new StubAdapter(script));
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    mountClient(ctx);
    const cookie = await signIn(ctx, base);
    const { sessionId } = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: { cwd: root } });
    const gravit = ctx.agents.get(SessionId(sessionId))!;
    const prompt = (value: string) => remote(base, cookie, "session/prompt", { request: { requestId: `roles-${crypto.randomUUID()}`, sessionId, mode: "queue", content: [{ type: "text", text: value }] } });
    const gravitPrompt = renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(gravit)));
    /* The positives the child's two negatives below pair with. The persona is compared up to its first
     * `{{`, as bots-smoke does (the text after it is a substituted variable); it is read from the file. */
    const rolesIntro = "Roles. One-shot delegates";
    const gravitPersona = readPersona(PERSONA_PATH).split("{{")[0];
    assert.ok(gravitPrompt.includes("- role_auditor — "), "Gravit reads the roles section");
    assert.ok(gravitPrompt.includes(rolesIntro), "Gravit reads the roles intro");
    assert.ok(gravitPrompt.includes(CYCLE_HEADING), "Gravit reads the cycle contract");
    assert.ok(gravitPrompt.includes(gravitPersona), "Gravit is told who it is");
    const childRequestAfter = async (marker: string) => {
      await waitFor(`child ${marker}`, () => [...requested.entries()].some(([id, rs]) => isChild(id) && rs.some((r) => r.messages.some((m) => textOf(m).includes(marker)))));
      const [id, rs] = [...requested.entries()].find(([id, rs]) => isChild(id) && rs.some((r) => r.messages.some((m) => textOf(m).includes(marker))))!;
      return { id: SessionId(id), request: rs[0], header: headers.get(id)! };
    };
    /* auditor */
    await prompt("RUN_AUDITOR");
    const auditor = await childRequestAfter("AUDIT_FIXTURE");
    await gravit.whenIdle();
    const auditorTools = auditor.request.tools!.map((t) => t.name).sort();
    for (const kept of ["read", "glob", "grep", "skill", "mcp__fixture__lookup", "mcp__fixture__history"]) assert.ok(auditorTools.includes(kept), `auditor keeps ${kept}`);
    for (const gone of ["bash", "write", "edit", "ask_user_question", "web_search", "subagent", "subagent_fork", "send_message", ...readRoles(rolesRoot).map((r) => r.tool), "mcp__fixture__private", "mcp__fixture__fetch"]) assert.equal(auditorTools.includes(gone), false, `auditor never sees ${gone}`);
    /* Equality, not subsets: dsh exempts a scope's own-layer registrations from `restrict()`, so only an exact
     * comparison with the role's allow list catches a tool the child's layer adds. */
    const role = (id: string) => readRoles(rolesRoot).find((r) => r.id === id)!;
    assert.deepEqual(auditorTools, [...role("auditor").allow].sort(), "the auditor's tools are exactly its allow list");
    const system = auditor.request.messages[0];
    assert.equal(system.role, "system");
    assert.ok(textOf(system).includes("You are the auditor"), "the role persona is the child's");
    assert.equal(textOf(system).includes(gravitPersona), false, "and it shadows Gravit's");
    assert.equal(textOf(system).includes(rolesIntro), false, "the roles section is blank for a role child: its allow list removed every role tool");
    assert.equal(textOf(system).includes(CYCLE_HEADING), false, "and so is the cycle section: its allow list removed create_goal, the visibility `gravit:cycle` is gated on");
    assert.match(textOf(system), /Today is \d{4}-\d{2}-\d{2}/, "the date reaches the child");
    assert.equal(auditor.header.origin, "subagent");
    assert.equal(auditor.header.agentPreset, "gravit");
    assert.equal(auditor.header.cwd, root);
    assert.ok(gravit.session.snapshotEvents().some((e) => e.type === "tool/result" && JSON.stringify(e.data).includes("AUDIT_DONE")), "the child's text returns through the tool");
    /* The workspace map reaches a role child: dsh's agent-instructions row publishes a baseline on every
     * agent's first request, a spawn child's included. Gravit's own first request is the positive pair. */
    const baselineHasMark = (r: GenerateOptions) => r.messages.some((m) => sourceKind(m) === "agent-instructions" && textOf(m).includes(GRAVIT_MARK));
    assert.ok(baselineHasMark(requested.get(sessionId)![0]), "Gravit's baseline carries the root GRAVIT.md");
    assert.ok(baselineHasMark(auditor.request), "so does the auditor child's first request");
    /* fork: `subagent_fork` seeds its child with Gravit's completed turns and restricts nothing, so the
     * child's first request must open with Gravit's system text byte for byte and offer Gravit's tools,
     * or the inherited prefix loses its cache reuse. `gravit:roles` and `gravit:cycle` are gated on what the
     * assembling scope can call (plugins/gravit.js `canCall`: a role tool, `create_goal`) and on the header
     * (`isRootOrFork`: a root, or a seeded child), which is why both reach the fork unchanged. */
    await prompt("RUN_FORK");
    const fork = await childRequestAfter("FORK_FIXTURE");
    await gravit.whenIdle();
    assert.equal(fork.header.isSeeded, true, "a subagent_fork child is seeded");
    const atFork = requested.get(sessionId)!.find((r) => { const t = lastHuman(r); return t !== undefined && sourceKind(t) === "user" && textOf(t) === "RUN_FORK"; })!;
    assert.equal(fork.request.messages[0].role, "system");
    const gravitSystem = textOf(atFork.messages[0]);
    const forkSystem = textOf(fork.request.messages[0]);
    assert.ok(gravitSystem.includes(rolesIntro), "Gravit's request at the fork carries the roles section");
    assert.ok(gravitSystem.includes(CYCLE_HEADING), "Gravit's request at the fork carries the cycle contract");
    assert.ok(forkSystem.includes(CYCLE_HEADING), "and the fork child's does too: `gravit:cycle` reads create_goal's visibility and the header, and a seeded, unrestricted child passes both");
    assert.equal(forkSystem, gravitSystem, `the fork child's system text is Gravit's, whole (${forkSystem.length} vs ${gravitSystem.length} characters, first difference at ${firstDifference(forkSystem, gravitSystem)})`);
    assert.deepEqual(fork.request.tools!.map((t) => t.name), atFork.tools!.map((t) => t.name), "and its tools are Gravit's, in order");
    assert.ok(gravit.session.snapshotEvents().some((e) => e.type === "tool/result" && JSON.stringify(e.data).includes("FORK_DONE")), "the fork's text returns through the tool");
    /* spawn: a plain `subagent` child is delegated, unseeded and restricted by nothing, so its scope
     * resolves `create_goal` and every role tool as Gravit's does - the visibility half of the gate
     * admits it. It reads neither section all the same: both are gated on the header too
     * (plugins/gravit.js `isRootOrFork`), and only a fork inherits a prefix worth keeping identical;
     * the fork above is this step's positive pair. */
    await prompt("RUN_SUBAGENT");
    const spawn = await childRequestAfter("SPAWN_FIXTURE");
    await gravit.whenIdle();
    assert.equal(spawn.header.origin, "subagent");
    assert.equal(spawn.header.isSeeded, false, "a subagent child is not seeded");
    const spawnTools = spawn.request.tools!.map((t) => t.name);
    for (const visible of ["create_goal", ...readRoles(rolesRoot).map((r) => r.tool)]) assert.ok(spawnTools.includes(visible), `the spawn child can call ${visible}, so only the header blanks the sections`);
    const spawnSystem = textOf(spawn.request.messages[0]);
    assert.equal(spawn.request.messages[0].role, "system");
    assert.equal(spawnSystem.includes(CYCLE_HEADING), false, "no cycle contract for a delegated child that is not a fork");
    assert.equal(spawnSystem.includes(rolesIntro), false, "and no roles section");
    assert.match(spawnSystem, /Today is \d{4}-\d{2}-\d{2}/, "the date still reaches it");
    assert.ok(gravit.session.snapshotEvents().some((e) => e.type === "tool/result" && JSON.stringify(e.data).includes("SPAWN_DONE")), "the spawn's text returns through the tool");
    /* worker */
    await prompt("RUN_WORKER");
    const worker = await childRequestAfter("WORK_FIXTURE");
    await gravit.whenIdle();
    const workerTools = worker.request.tools!.map((t) => t.name);
    assert.ok(["bash", "write", "mcp__fixture__fetch"].every((n) => workerTools.includes(n)));
    assert.equal(workerTools.includes("edit"), false);
    assert.deepEqual([...workerTools].sort(), [...role("worker").allow].sort(), "the worker's tools are exactly its allow list");
    /* a tool the tree lacks: the delegation fails naming it, no child runs */
    unregister.get("mcp__fixture__fetch")!();
    const childrenBefore = [...requested.keys()].filter(isChild).length;
    await prompt("RUN_WORKER");
    await gravit.whenIdle();
    const failed = gravit.session.snapshotEvents().filter((e) => e.type === "tool/result").at(-1)!;
    /* Anchored on the quoted name right after the verb: the payload is stringified, so the quotes carry a
     * backslash, and a looser pattern would also match the name inside the error's known-tools list. */
    assert.match(JSON.stringify(failed.data), /names unknown global tools? \\"mcp__fixture__fetch\\"/);
    assert.equal([...requested.keys()].filter(isChild).length, childrenBefore, "no child was created");
  } finally {
    await dispose?.();
    await Promise.all([rm(bots, { recursive: true, force: true }), rm(rolesRoot, { recursive: true, force: true }), rm(root, { recursive: true, force: true }), rm(home, { recursive: true, force: true })]);
  }
});

/** The text of each tool result a request sends the model, in order. */
const toolTexts = (request: GenerateOptions) => request.messages.filter((m) => sourceKind(m) === "tool").map(textOf);

/* The shipped cn-market-analyst on a real boot (modules spec A8, A23, §5.9). Its shipped route,
 * `deepseek-official/deepseek-flash`, would send the child to dsh-base's real DeepSeek adapter, which no smoke can
 * answer, so the boot reads a FIXTURE roles root - every shipped role copied, the analyst's route turned to the stub -
 * and a temp strategies root through the `lunhui-runs` row's own config (a home-patch replacement, src/lunhui.ts), so
 * nothing is written under the repository's strategies/. The market run is opened through the booted `lunhuiRuns`
 * service and frozen with nothing, so every context expects NOT_EVALUABLE and the child submits the context's own
 * NOT_EVALUABLE example. What is pinned: the child's tools are exactly its allow list; its persona is its own; its
 * submit passes NOT_A_ROLE and lands in the run; the same submit from Gravit's root is NOT_A_ROLE; a freeze is out
 * of the role child's reach (UNKNOWN_TOOL), and a delegated child that can reach one - a plain `subagent` child,
 * unrestricted - is NOT_GRAVIT. */
test("roles smoke: cn-market-analyst reads and submits as a role, Gravit's own submit is NOT_A_ROLE, a delegated freeze is NOT_GRAVIT", { skip: gated && "set FACE_SMOKE=1", timeout: 180_000 }, async () => {
  const bots = await makeBotsRoot();
  const fixtureRoles = await mkdtemp(join(tmpdir(), "face-roles-fixture-"));
  const strategies = await realpath(await mkdtemp(join(tmpdir(), "face-roles-strategies-")));
  const root = await realpath(await mkdtemp(join(tmpdir(), "face-roles-root-")));
  const home = await mkdtemp(join(tmpdir(), "face-roles-home-"));
  let dispose: (() => Promise<void>) | undefined;
  try {
    for (const entry of readdirSync(ROLES_ROOT, { withFileTypes: true })) {
      if (entry.isDirectory()) await cp(join(ROLES_ROOT, entry.name), join(fixtureRoles, entry.name), { recursive: true });
    }
    const metaPath = join(fixtureRoles, "cn-market-analyst", "role.yml");
    writeFileSync(metaPath, readFileSync(metaPath, "utf8").replace(/^model: .*$/m, "model: stub/flash-standin"));
    const roles = readRoles(fixtureRoles);
    const analyst = roles.find((r) => r.id === "cn-market-analyst")!;
    assert.equal(analyst.model, "stub/flash-standin", "the fixture's analyst is routed to the stub");
    assert.deepEqual(roles.map((r) => [r.id, r.allow]), readRoles(ROLES_ROOT).map((r) => [r.id, r.allow]), "and the fixture holds every shipped role, its tools unchanged");
    await mkdir(join(strategies, "cn-market"));
    await writeFile(join(strategies, "cn-market", "THESIS.md"), "# cn-market fixture\n");
    await mkdir(join(root, ".git"));
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
    writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: stub\n    model: echo\n- id: lunhui-runs\n  config:\n    strategiesRoot: ${JSON.stringify(strategies)}\n`);
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: bots, rolesRoot: fixtureRoles });
    dispose = booted.dispose;
    const { ctx } = booted;
    const service = ctx.get("lunhuiRuns") as { strategiesRoot: string; openRun(s: string, k: "market"): Promise<{ run: string }>; readRun(s: string, r: string): Promise<{ manifest: { artifacts: string[] } }> };
    assert.equal(service.strategiesRoot, strategies, "the rows write under the temp strategies root");
    const { run } = await service.openRun("cn-market", "market");
    const requested = new Map<string, GenerateOptions[]>();
    const headers = new Map<string, Session["header"]>();
    const script = (request: GenerateOptions): StubReply => {
      if (request.purpose !== undefined) return { kind: "text", text: "fixture" };
      const id = String(request.sessionId);
      requested.set(id, [...requested.get(id) ?? [], request]);
      const header = ctx.sessions.get(request.sessionId!)?.header;
      if (header !== undefined && !headers.has(id)) headers.set(id, { ...header });
      const trigger = lastHuman(request);
      const text = trigger ? textOf(trigger) : "";
      const results = toolTexts(request);
      const briefed = (marker: string) => request.messages.some((m) => sourceKind(m) !== "tool" && textOf(m).includes(marker));
      if (header?.origin === "subagent" && briefed("MARKET_FIXTURE")) {
        /* The role child: reach for a freeze it does not carry, read the environment context, submit its example. */
        if (results.length === 0) return { kind: "tool", name: "lunhui_freeze_index", args: { strategy: "cn-market" } };
        if (results.length === 1) return { kind: "tool", name: "lunhui_read_environment_context", args: { strategy: "cn-market", run } };
        if (results.length === 2) {
          const context = JSON.parse(results[1]);
          return { kind: "tool", name: "lunhui_submit_environment", args: { strategy: "cn-market", run, analysis: JSON.stringify(context.example) } };
        }
        return { kind: "text", text: "MARKET_DONE" };
      }
      if (header?.origin === "subagent" && briefed("SPAWN_FREEZE")) {
        return results.length === 0 ? { kind: "tool", name: "lunhui_freeze_index", args: { strategy: "cn-market" } } : { kind: "text", text: "SPAWN_DONE" };
      }
      if (sourceKind(trigger!) === "user" && text === "RUN_ROOT_SUBMIT") return { kind: "tool", name: "lunhui_submit_environment", args: { strategy: "cn-market", run, analysis: "{}" } };
      if (sourceKind(trigger!) === "user" && text === "RUN_MARKET_ANALYST") return { kind: "tool", name: "role_cn_market_analyst", args: { description: "Read the market run", prompt: `MARKET_FIXTURE: cn-market run ${run}.` } };
      if (sourceKind(trigger!) === "user" && text === "RUN_SPAWN_FREEZE") return { kind: "tool", name: "subagent", args: { description: "Freeze from a child", prompt: "SPAWN_FREEZE: freeze the index.", run_in_background: false } };
      return { kind: "text", text: "PARENT_DONE" };
    };
    ctx.llm.registerAdapter(["stub"], new StubAdapter(script));
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    mountClient(ctx);
    const cookie = await signIn(ctx, base);
    const { sessionId } = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: { cwd: root } });
    const gravit = ctx.agents.get(SessionId(sessionId))!;
    const prompt = (value: string) => remote(base, cookie, "session/prompt", { request: { requestId: `roles-${crypto.randomUUID()}`, sessionId, mode: "queue", content: [{ type: "text", text: value }] } });
    const lastResult = () => (gravit.session.snapshotEvents().filter((e) => e.type === "tool/result").at(-1)!.data as { message: { isError?: boolean; content: ReadonlyArray<{ text?: string }> } }).message;
    const resultText = (message: { content: ReadonlyArray<{ text?: string }> }) => message.content.map((b) => b.text ?? "").join("\n");
    const childAfter = async (marker: string) => {
      const found = () => [...requested.entries()].find(([id, rs]) => headers.get(id)?.origin === "subagent" && rs.some((r) => r.messages.some((m) => sourceKind(m) !== "tool" && textOf(m).includes(marker))));
      await waitFor(`child ${marker}`, () => found() !== undefined);
      await gravit.whenIdle();
      return found()![1];
    };

    /* The run protocol: Gravit's prompt carries it (lunhui_read_run is registered), the role child's and the
     * spawn child's below do not. */
    assert.ok(renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(gravit))).includes(RUN_HEADING), "Gravit reads the run protocol");

    /* Gravit's root: the submit is refused before the run is touched. */
    await prompt("RUN_ROOT_SUBMIT");
    await gravit.whenIdle();
    const refused = lastResult();
    assert.equal(refused.isError, true, "Gravit's own submit fails");
    assert.match(resultText(refused), /^Error: NOT_A_ROLE: /, "as NOT_A_ROLE");

    /* The role child. */
    await prompt("RUN_MARKET_ANALYST");
    const child = await childAfter("MARKET_FIXTURE");
    assert.equal(child[0].model, "flash-standin", "the child runs on its role's route");
    assert.deepEqual(child[0].tools!.map((t) => t.name).sort(), [...analyst.allow].sort(), "the analyst's tools are exactly its allow list");
    const system = textOf(child[0].messages[0]);
    assert.ok(system.includes("市场与题材分析员"), "the role persona is the child's");
    assert.equal(system.includes(readPersona(PERSONA_PATH).split("{{")[0]), false, "and it shadows Gravit's");
    assert.equal(system.includes(RUN_HEADING), false, "no run protocol for a role child: its allow list carries no lunhui_read_run, and it is no fork");
    const childResults = toolTexts(child.at(-1)!);
    assert.equal(childResults.length, 3, "the freeze, the read and the submit came back");
    assert.match(childResults[0], /unknown tool "lunhui_freeze_index"/, "a freeze is out of the role child's reach");
    assert.match(childResults[1], /NOT_EVALUABLE/, "the empty run's context expects NOT_EVALUABLE");
    assert.match(childResults[2], /"accepted":true/, "the child's submit passed NOT_A_ROLE and was accepted");
    assert.deepEqual((await service.readRun("cn-market", run)).manifest.artifacts, ["environment"], "the artifact landed in the run");
    const artifact = JSON.parse(readFileSync(join(strategies, "cn-market", "analysis", run, "environment.json"), "utf8"));
    assert.deepEqual([artifact.module, artifact.status, artifact.run], ["environment", "NOT_EVALUABLE", run]);
    assert.equal(resultText(lastResult()), "MARKET_DONE", "the child's report returns through the tool");

    /* A delegated child that can reach a freeze: NOT_GRAVIT. */
    await prompt("RUN_SPAWN_FREEZE");
    const spawn = await childAfter("SPAWN_FREEZE");
    assert.ok(spawn[0].tools!.some((t) => t.name === "lunhui_freeze_index"), "the plain subagent child carries the freeze");
    assert.ok(spawn[0].tools!.some((t) => t.name === "lunhui_read_run"), "and the run protocol's probe");
    assert.equal(textOf(spawn[0].messages[0]).includes(RUN_HEADING), false, "yet no run protocol: it is a delegated child that is not a fork");
    assert.match(toolTexts(spawn.at(-1)!)[0], /NOT_GRAVIT/, "and its call is NOT_GRAVIT");
  } finally {
    await dispose?.();
    await Promise.all([bots, fixtureRoles, strategies, root, home].map((dir) => rm(dir, { recursive: true, force: true })));
  }
});

/* The shipped cn-stock-analyst on a real boot (modules spec A8, A23, A27, §5.9), on the second case's footing: a
 * fixture roles root with the stock analyst routed to the stub, a temp strategies root holding cn-market and a
 * strategy, `alpha`. The runs it reads are made through the booted `lunhuiRuns` service and the runs library's own
 * artifact writer, no freeze and no network: a cn-market run holding one evidence source of session 2026-10-23 (an
 * empty 涨停池), sealed, then its theme and sentiment artifacts landed as accepted - what the leader requires of its
 * cited run - and an alpha strategy run holding one frozen equity quote of the same session. The child, briefed with
 * the strategy, the run, the market run and the artifact, reads the leader context citing that market run and submits
 * the context's own example. What is pinned: the child's tools are exactly its allow list; its persona is its own;
 * the context cites the market run and expects OK; its leader submit passes NOT_A_ROLE and lands in the strategy run;
 * the same submit from Gravit's root is NOT_A_ROLE. */
test("roles smoke: cn-stock-analyst reads the leader context citing a sealed market run and submits as a role, Gravit's own submit is NOT_A_ROLE", { skip: gated && "set FACE_SMOKE=1", timeout: 180_000 }, async () => {
  const bots = await makeBotsRoot();
  const fixtureRoles = await mkdtemp(join(tmpdir(), "face-roles-fixture-"));
  const strategies = await realpath(await mkdtemp(join(tmpdir(), "face-roles-strategies-")));
  const root = await realpath(await mkdtemp(join(tmpdir(), "face-roles-root-")));
  const home = await mkdtemp(join(tmpdir(), "face-roles-home-"));
  let dispose: (() => Promise<void>) | undefined;
  try {
    for (const entry of readdirSync(ROLES_ROOT, { withFileTypes: true })) {
      if (entry.isDirectory()) await cp(join(ROLES_ROOT, entry.name), join(fixtureRoles, entry.name), { recursive: true });
    }
    const metaPath = join(fixtureRoles, "cn-stock-analyst", "role.yml");
    writeFileSync(metaPath, readFileSync(metaPath, "utf8").replace(/^model: .*$/m, "model: stub/flash-standin"));
    const roles = readRoles(fixtureRoles);
    const analyst = roles.find((r) => r.id === "cn-stock-analyst")!;
    assert.equal(analyst.model, "stub/flash-standin", "the fixture's stock analyst is routed to the stub");
    assert.deepEqual(roles.map((r) => [r.id, r.allow]), readRoles(ROLES_ROOT).map((r) => [r.id, r.allow]), "and the fixture holds every shipped role, its tools unchanged");
    for (const strategy of ["cn-market", "alpha"]) {
      await mkdir(join(strategies, strategy));
      await writeFile(join(strategies, strategy, "THESIS.md"), `# ${strategy} fixture\n`);
    }
    await mkdir(join(root, ".git"));
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
    writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: stub\n    model: echo\n- id: lunhui-runs\n  config:\n    strategiesRoot: ${JSON.stringify(strategies)}\n`);
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: bots, rolesRoot: fixtureRoles });
    dispose = booted.dispose;
    const { ctx } = booted;
    type Meta = { received_at: string; session: string; host: string; delayed: boolean; truncated: boolean };
    const service = ctx.get("lunhuiRuns") as {
      strategiesRoot: string;
      openRun(s: string, k: "market" | "strategy"): Promise<{ run: string }>;
      addEvidence(s: string, r: string, source: string, items: unknown[], meta: Meta): Promise<unknown>;
      sealRun(s: string, r: string): Promise<unknown>;
      readRun(s: string, r: string): Promise<{ manifest: { artifacts: string[] } }>;
    };
    assert.equal(service.strategiesRoot, strategies, "the rows write under the temp strategies root");
    const meta: Meta = { received_at: "2026-10-23T07:00:00.000Z", session: "2026-10-23", host: "fixture", delayed: false, truncated: false };
    const { run: market } = await service.openRun("cn-market", "market");
    await service.addEvidence("cn-market", market, "limit-up", [], meta);
    await service.sealRun("cn-market", market);
    const marketDir = join(strategies, "cn-market", "analysis", market);
    await writeArtifact(marketDir, "sentiment", { module: "sentiment", run: market, status: "OK", state: "REPAIR", claims: [] });
    await writeArtifact(marketDir, "theme", { module: "theme", run: market, status: "OK", mainline_candidates: [], claims: [] });
    const { run } = await service.openRun("alpha", "strategy");
    await service.addEvidence("alpha", run, "quotes", [{
      symbol: "sh600519", name: "贵州茅台", provider: "tencent", kind: "quote", instrument: "equity",
      last: 1500, previousClose: 1490, open: 1492, high: 1505, low: 1488, change: 10, changePercent: 0.67,
      volumeShares: 3_000_000, amountCny: 4_500_000_000, quotedAt: "2026-10-23T15:00:00+08:00", quality: "close",
    }], meta);
    const requested = new Map<string, GenerateOptions[]>();
    const headers = new Map<string, Session["header"]>();
    const script = (request: GenerateOptions): StubReply => {
      if (request.purpose !== undefined) return { kind: "text", text: "fixture" };
      const id = String(request.sessionId);
      requested.set(id, [...requested.get(id) ?? [], request]);
      const header = ctx.sessions.get(request.sessionId!)?.header;
      if (header !== undefined && !headers.has(id)) headers.set(id, { ...header });
      const trigger = lastHuman(request);
      const text = trigger ? textOf(trigger) : "";
      const results = toolTexts(request);
      const briefed = (marker: string) => request.messages.some((m) => sourceKind(m) !== "tool" && textOf(m).includes(marker));
      if (header?.origin === "subagent" && briefed("STOCK_FIXTURE")) {
        /* The role child: read the leader context citing the market run, submit its example. */
        if (results.length === 0) return { kind: "tool", name: "lunhui_read_leader_context", args: { strategy: "alpha", run, market_run: market } };
        if (results.length === 1) {
          const context = JSON.parse(results[0]);
          return { kind: "tool", name: "lunhui_submit_leader", args: { strategy: "alpha", run, analysis: JSON.stringify(context.example) } };
        }
        return { kind: "text", text: "STOCK_DONE" };
      }
      if (sourceKind(trigger!) === "user" && text === "RUN_ROOT_LEADER") return { kind: "tool", name: "lunhui_submit_leader", args: { strategy: "alpha", run, analysis: "{}" } };
      if (sourceKind(trigger!) === "user" && text === "RUN_STOCK_ANALYST") return { kind: "tool", name: "role_cn_stock_analyst", args: { description: "Write the leader artifact", prompt: `STOCK_FIXTURE: strategy alpha, run ${run}, market_run ${market}; write leader.` } };
      return { kind: "text", text: "PARENT_DONE" };
    };
    ctx.llm.registerAdapter(["stub"], new StubAdapter(script));
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    mountClient(ctx);
    const cookie = await signIn(ctx, base);
    const { sessionId } = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: { cwd: root } });
    const gravit = ctx.agents.get(SessionId(sessionId))!;
    const prompt = (value: string) => remote(base, cookie, "session/prompt", { request: { requestId: `roles-${crypto.randomUUID()}`, sessionId, mode: "queue", content: [{ type: "text", text: value }] } });
    const lastResult = () => (gravit.session.snapshotEvents().filter((e) => e.type === "tool/result").at(-1)!.data as { message: { isError?: boolean; content: ReadonlyArray<{ text?: string }> } }).message;
    const resultText = (message: { content: ReadonlyArray<{ text?: string }> }) => message.content.map((b) => b.text ?? "").join("\n");

    /* Gravit's root: the submit is refused before the run is touched. */
    await prompt("RUN_ROOT_LEADER");
    await gravit.whenIdle();
    const refused = lastResult();
    assert.equal(refused.isError, true, "Gravit's own leader submit fails");
    assert.match(resultText(refused), /^Error: NOT_A_ROLE: /, "as NOT_A_ROLE");

    /* The role child. */
    await prompt("RUN_STOCK_ANALYST");
    const found = () => [...requested.entries()].find(([id, rs]) => headers.get(id)?.origin === "subagent" && rs.some((r) => r.messages.some((m) => sourceKind(m) !== "tool" && textOf(m).includes("STOCK_FIXTURE"))));
    await waitFor("child STOCK_FIXTURE", () => found() !== undefined);
    await gravit.whenIdle();
    const child = found()![1];
    assert.equal(child[0].model, "flash-standin", "the child runs on its role's route");
    assert.deepEqual(child[0].tools!.map((t) => t.name).sort(), [...analyst.allow].sort(), "the stock analyst's tools are exactly its allow list");
    const system = textOf(child[0].messages[0]);
    assert.ok(system.includes("个股与预期分析员"), "the role persona is the child's");
    assert.equal(system.includes(readPersona(PERSONA_PATH).split("{{")[0]), false, "and it shadows Gravit's");
    const childResults = toolTexts(child.at(-1)!);
    assert.equal(childResults.length, 2, "the read and the submit came back");
    const context = JSON.parse(childResults[0]);
    assert.deepEqual([context.module, context.market_run, context.status_expected], ["leader", market, "OK"], "the context cites the market run and expects OK");
    assert.match(childResults[1], /"accepted":true/, "the child's leader submit passed NOT_A_ROLE and was accepted");
    assert.deepEqual((await service.readRun("alpha", run)).manifest.artifacts, ["leader"], "the artifact landed in the strategy run");
    const artifact = JSON.parse(readFileSync(join(strategies, "alpha", "analysis", run, "leader.json"), "utf8"));
    assert.deepEqual([artifact.module, artifact.status, artifact.run, artifact.market_run], ["leader", "OK", run, market]);
    assert.equal(resultText(lastResult()), "STOCK_DONE", "the child's report returns through the tool");
  } finally {
    await dispose?.();
    await Promise.all([bots, fixtureRoles, strategies, root, home].map((dir) => rm(dir, { recursive: true, force: true })));
  }
});
