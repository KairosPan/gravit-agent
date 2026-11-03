// face/tests/role-plugin.test.ts
import test from "node:test";
import assert from "node:assert/strict";
// Plain ESM (the dsh loader imports it by URL); tsconfig `allowJs` lets tsx import it here, as bot-plugin.test.ts imports bot.js.
import { apply, inject, name, validateRoleConfig } from "../plugins/role.mjs";
import { MODEL_ROUTE_RE } from "../src/bots.ts";

/** The shape `gravitRows` (src/roles.ts) hands a role row. */
const SHIPPED = {
  tool: "role_cn_reviewer",
  name: "CN reviewer",
  summary: "Reviews one run's counterevidence.",
  agentPreset: "role-cn-reviewer",
  allow: ["skill", "lunhui_read_counterevidence_context", "lunhui_submit_counterevidence"],
  model: "deepseek-official/deepseek-flash",
};

type Spec = { provider: string; label: string; request: Record<string, unknown>; signal: AbortSignal; delivery: string };
type Result = { output: readonly { type: string; text?: string }[]; stopReason: string; diagnostic?: string };

/** The slice of a preset scope `apply` touches: `tools.register` records the definition, `tools.get` answers from
 *  the tree's names, `subagents` hands out a stub activation whose result the test settles, `llm` resolves the
 *  routes it serves. Every call is recorded in order. */
function fakeTree(options: { names?: readonly string[]; provider?: boolean; served?: readonly string[] } = {}) {
  const names = new Set(options.names ?? SHIPPED.allow);
  const served = new Set(options.served ?? ["deepseek-official/deepseek-flash"]);
  const calls: string[] = [];
  const registered: Record<string, any>[] = [];
  const specs: Spec[] = [];
  let settle: (result: Result) => void = () => { throw new Error("no activation started"); };
  let disposals = 0;
  const ctx = {
    effect(fn: () => unknown) {
      const disposer = fn();
      assert.equal(typeof disposer, "function", "every effect hands back its disposer");
      return disposer;
    },
    tools: {
      register(definition: Record<string, any>) { registered.push(definition); return () => {}; },
      get(tool: string, scope?: unknown) {
        calls.push(`get ${tool}`);
        assert.equal(scope, undefined, "the allow names are checked against the global view");
        return names.has(tool) ? { name: tool } : undefined;
      },
    },
    subagents: {
      getProvider(provider: string) { calls.push(`getProvider ${provider}`); return options.provider === false ? undefined : { name: provider }; },
      resolveMaxDepth(configured?: unknown) { calls.push(`resolveMaxDepth ${String(configured)}`); return 1; },
      async startActivation(spec: Spec) {
        calls.push("startActivation");
        specs.push(spec);
        const result = new Promise<Result>((resolve) => { settle = resolve; });
        return { childId: "session-child", result, dispose: async () => { disposals++; calls.push("dispose"); } };
      },
    },
    llm: {
      async resolveCallConfig(config: { provider: string; model: string }, signal?: AbortSignal) {
        calls.push(`resolveCallConfig ${config.provider}/${config.model}`);
        assert.ok(signal instanceof AbortSignal, "the preflight follows the call's signal");
        if (!served.has(`${config.provider}/${config.model}`)) throw new Error(`model ${config.model} is not registered`);
        return config;
      },
    },
  };
  return { ctx, calls, registered, specs, settle: (result: Result) => settle(result), disposals: () => disposals };
}

const exec = (signal = new AbortController().signal) => ({ agent: { id: "session-gravit" }, signal });
/** Past the microtasks between `execute` starting and the activation's listener being in place. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("role plugin: name and inject", () => {
  assert.equal(name, "gravit-role");
  assert.deepEqual(inject, ["tools", "subagents", "llm"]);
});

test("validateRoleConfig: the shipped shape passes; a missing or malformed field is refused with the field named", () => {
  assert.equal(validateRoleConfig(SHIPPED), undefined);
  const { model: _model, ...noModel } = SHIPPED;
  assert.equal(validateRoleConfig(noModel), undefined, "model is optional");
  assert.match(validateRoleConfig(null)!, /object/);
  const { tool: _tool, ...noTool } = SHIPPED;
  assert.match(validateRoleConfig(noTool)!, /^tool /);
  for (const tool of ["subagent", "role_", "role_Cn", "role-cn", "mcp__x__role_y"]) assert.match(validateRoleConfig({ ...SHIPPED, tool })!, /^tool /, tool);
  assert.match(validateRoleConfig({ ...SHIPPED, name: " " })!, /^name /);
  assert.match(validateRoleConfig({ ...SHIPPED, summary: "" })!, /^summary /);
  assert.match(validateRoleConfig({ ...SHIPPED, agentPreset: "gravit" })!, /^agentPreset /, "a role child joins a role- preset, which the Lunhui role gate reads");
  assert.match(validateRoleConfig({ ...SHIPPED, allow: [] })!, /^allow /);
  assert.match(validateRoleConfig({ ...SHIPPED, allow: ["read", ""] })!, /^allow /);
  assert.match(validateRoleConfig({ ...SHIPPED, allow: "read" })!, /^allow /);
  for (const model of ["deepseek-flash", "a/b/c", "/flash", "deepseek-official/", 7]) assert.match(validateRoleConfig({ ...SHIPPED, model })!, /^model /, String(model));
});

test("validateRoleConfig: the route grammar is src/bots.ts MODEL_ROUTE_RE's", () => {
  for (const model of ["deepseek-official/deepseek-flash", "stub/flash-standin", "a.b/c:d", "-a/b", "a/-b", "a b/c", "a/b c"]) {
    assert.equal(validateRoleConfig({ ...SHIPPED, model }) === undefined, MODEL_ROUTE_RE.test(model), model);
  }
});

test("apply: a refused config throws at the mount, naming the plugin", () => {
  const tree = fakeTree();
  assert.throws(() => apply(tree.ctx, { ...SHIPPED, allow: [] }), /^Error: gravit-role: allow /);
  assert.equal(tree.registered.length, 0);
});

test("apply registers one tool: the role's name, the summary plus the call's contract, a brief and a label, never concurrent, no timeout", () => {
  const tree = fakeTree();
  apply(tree.ctx, SHIPPED);
  assert.equal(tree.registered.length, 1);
  const [tool] = tree.registered;
  assert.equal(tool.name, "role_cn_reviewer");
  assert.equal(tool.description, "Reviews one run's counterevidence. Hands a self-contained brief to the CN reviewer role, a one-shot child with its own persona and tools; the call returns the role's report. Never send_message a role child.");
  assert.equal(tool.isConcurrencySafe(), false, "role calls are serialized");
  assert.equal(tool.timeoutMs, undefined, "a role runs as long as it runs; Stop cancels it");
  assert.deepEqual(tool.parameters.required, ["prompt"]);
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ["description", "prompt"]);
  assert.deepEqual(tree.calls, [], "nothing is looked up at the mount");
});

test("execute (a): a completed child's text is the tool's report; the activation is the role's preset on caller delivery, disposed once", async () => {
  const tree = fakeTree();
  apply(tree.ctx, SHIPPED);
  const [tool] = tree.registered;
  const caller = exec();
  const running = tool.execute({ prompt: "REVIEW the run", description: "Review the run" }, caller);
  await tick();
  assert.equal(tree.specs.length, 1);
  const [spec] = tree.specs;
  assert.deepEqual({ ...spec, signal: undefined }, {
    provider: "spawn",
    label: "Review the run",
    request: {
      prompt: [{ type: "text", text: "REVIEW the run" }],
      parent: caller.agent,
      agentPreset: "role-cn-reviewer",
      agentOptions: { provider: "deepseek-official", model: "deepseek-flash" },
      maxDepth: 1,
    },
    signal: undefined,
    delivery: "caller",
  });
  assert.equal(spec.signal, caller.signal, "the call's own signal");
  tree.settle({ output: [{ type: "text", text: "status: OK" }, { type: "reasoning" }, { type: "text", text: "limits: none" }], stopReason: "completed" });
  const value = await running;
  assert.deepEqual(value, { kind: "report", text: "status: OK\nlimits: none" });
  assert.deepEqual(tool.output.render({}, value), [{ type: "text", text: "status: OK\nlimits: none" }]);
  assert.equal(tree.disposals(), 1, "disposed once, in finally");
  assert.deepEqual(tree.calls, [
    "get skill", "get lunhui_read_counterevidence_context", "get lunhui_submit_counterevidence",
    "getProvider spawn", "resolveCallConfig deepseek-official/deepseek-flash", "resolveMaxDepth undefined", "startActivation", "dispose",
  ], "the checks run before the child starts");
});

test("execute: without a model there is no preflight and no agentOptions; the label falls back to the role's name, for an empty or blank description too; an empty report says so", async () => {
  const tree = fakeTree();
  const { model: _model, ...noModel } = SHIPPED;
  apply(tree.ctx, noModel);
  const running = tree.registered[0].execute({ prompt: "brief" }, exec());
  await tick();
  assert.equal("agentOptions" in tree.specs[0].request, false);
  assert.equal(tree.specs[0].label, "CN reviewer");
  assert.equal(tree.calls.some((call) => call.startsWith("resolveCallConfig")), false);
  tree.settle({ output: [], stopReason: "completed" });
  assert.deepEqual(await running, { kind: "report", text: "It left no closing message." });
  for (const description of ["", "   "]) {
    const blank = fakeTree();
    apply(blank.ctx, SHIPPED);
    const call = blank.registered[0].execute({ prompt: "brief", description }, exec());
    await tick();
    assert.equal(blank.specs[0].label, "CN reviewer", `a description of ${JSON.stringify(description)} is no label`);
    blank.settle({ output: [], stopReason: "completed" });
    await call;
  }
});

test("execute (b): a child that ends other than completed is an error naming the stop reason and the diagnostic", async () => {
  for (const [result, message] of [
    [{ output: [], stopReason: "error", diagnostic: "the model call failed" }, "role role_cn_reviewer error: the model call failed"],
    [{ output: [{ type: "text", text: "partial" }], stopReason: "max-tokens" }, "role role_cn_reviewer max-tokens: no detail"],
  ] as const) {
    const tree = fakeTree();
    apply(tree.ctx, SHIPPED);
    const running = tree.registered[0].execute({ prompt: "brief" }, exec());
    await tick();
    tree.settle(result as Result);
    await assert.rejects(running, (error: Error) => error.message === message);
    assert.equal(tree.disposals(), 1, "disposed on the error path too");
  }
});

test("execute (c): an allow name the tree lacks refuses before any child starts, naming every missing one", async () => {
  const tree = fakeTree({ names: ["skill"] });
  apply(tree.ctx, SHIPPED);
  await assert.rejects(tree.registered[0].execute({ prompt: "brief" }, exec()), (error: Error) =>
    error.message === "role role_cn_reviewer: the tree has no tool lunhui_read_counterevidence_context, lunhui_submit_counterevidence; no child was created");
  assert.equal(tree.specs.length, 0);
});

test("execute: no calling agent, no spawn provider, or a route the tree does not serve refuses before any child starts", async () => {
  const noAgent = fakeTree();
  apply(noAgent.ctx, SHIPPED);
  await assert.rejects(noAgent.registered[0].execute({ prompt: "brief" }, { signal: new AbortController().signal }), /^Error: role role_cn_reviewer: no calling agent/);
  const noProvider = fakeTree({ provider: false });
  apply(noProvider.ctx, SHIPPED);
  await assert.rejects(noProvider.registered[0].execute({ prompt: "brief" }, exec()), /^Error: role role_cn_reviewer: the spawn subagent provider is not registered; no child was created$/);
  const unserved = fakeTree({ served: [] });
  apply(unserved.ctx, SHIPPED);
  await assert.rejects(unserved.registered[0].execute({ prompt: "brief" }, exec()),
    /^Error: role role_cn_reviewer: the route deepseek-official\/deepseek-flash is not served: model deepseek-flash is not registered; no child was created$/);
  for (const tree of [noAgent, noProvider, unserved]) assert.equal(tree.specs.length, 0);
});

test("execute (d): an abort after the child started disposes the activation at once, and finally awaits that disposal instead of a second", async () => {
  const tree = fakeTree();
  apply(tree.ctx, SHIPPED);
  const controller = new AbortController();
  const running = tree.registered[0].execute({ prompt: "brief" }, exec(controller.signal));
  await tick();
  assert.equal(tree.disposals(), 0);
  controller.abort();
  assert.equal(tree.disposals(), 1, "the abort disposes the activation");
  tree.settle({ output: [], stopReason: "aborted" });
  await assert.rejects(running, (error: Error) => error.message === "role role_cn_reviewer aborted: no detail");
  assert.equal(tree.disposals(), 1, "finally awaits the abort's disposal: one dispose, so a teardown failure is warned once");
});
