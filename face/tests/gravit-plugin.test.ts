import test from "node:test";
import assert from "node:assert/strict";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import { CYCLE_SECTION, DESK_SECTION, LUNHUI_MODULE_SECTION, LUNHUI_RUN_SECTION, ROLES_SECTION, ROUTER_SECTION, TODAY_SECTION, apply, canCall, inject, isRootOrFork, name, resolveZone, rolesText, todayText, validateGravitConfig } from "../plugins/gravit.js";

const dshSectionOrder = (slot: "DEPLOYMENT_PERSONA_PREFIX" | "DEPLOYMENT_PERSONA_SUFFIX" | "TOOL_SUBAGENT"): number => SystemPrompt.prototype.getSectionOrder(slot);

/** A stand-in scope for `apply`. `systemPrompt` records the sections; `tools.get(name, scope)`
 *  resolves a name when the scope it is handed lists it in `visible`, and records every lookup -
 *  the assembly context's `scope` is the agent, and the registry answers what that scope can call. */
type FakeToolScope = { visible?: readonly string[] };
function fakeScope() {
  const sections: Array<{ name: string; order: number; interpolate?: boolean; text: unknown }> = [];
  const disposers: Array<() => unknown> = [];
  const lookups: Array<{ name: string; scope: FakeToolScope | undefined }> = [];
  const ctx = {
    effect(fn: () => unknown) { const d = fn(); assert.equal(typeof d, "function"); disposers.push(d as () => unknown); return d; },
    systemPrompt: {
      section(section: { name: string; order: number; interpolate?: boolean; text: unknown }) {
        sections.push(section);
        return () => { sections.splice(sections.indexOf(section), 1); };
      },
      getSectionOrder: (slot: "DEPLOYMENT_PERSONA_PREFIX" | "DEPLOYMENT_PERSONA_SUFFIX" | "TOOL_SUBAGENT") => dshSectionOrder(slot),
    },
    tools: {
      get(name: string, scope?: FakeToolScope) {
        lookups.push({ name, scope });
        return scope?.visible?.includes(name) ? { name } : undefined;
      },
    },
  };
  return { ctx, sections, lookups, unload: () => { for (const d of disposers.splice(0).reverse()) d(); } };
}

test("gravit: name and inject are what the composition relies on", () => {
  assert.equal(name, "gravit");
  assert.deepEqual(inject, ["systemPrompt", "tools"]);
  assert.equal(TODAY_SECTION, "deployment:today");
});

test("validateGravitConfig: {} is valid; cycle and roles are checked when present", () => {
  assert.equal(validateGravitConfig({}), undefined);
  assert.match(validateGravitConfig(null) ?? "", /object/);
  assert.match(validateGravitConfig({ cycle: "" }) ?? "", /cycle/);
  assert.equal(validateGravitConfig({ cycle: "Open one goal per cycle." }), undefined);
  assert.match(validateGravitConfig({ roles: [{ tool: "probe", summary: "x" }] }) ?? "", /role_/);
  assert.match(validateGravitConfig({ roles: [{ tool: "role_probe", summary: "" }] }) ?? "", /summary/);
  assert.equal(validateGravitConfig({ roles: [{ tool: "role_probe", summary: "probes the fixture" }] }), undefined);
});

test("todayText renders the LOCAL date of the zone, ISO date then weekday", () => {
  assert.equal(todayText(new Date("2026-10-18T12:00:00Z"), "America/New_York"), "Today is 2026-10-18, Sunday (America/New_York).");
  assert.equal(todayText(new Date("2026-10-18T03:00:00Z"), "America/New_York"), "Today is 2026-10-17, Saturday (America/New_York).");
  assert.equal(todayText(new Date("2026-10-18T03:00:00Z"), "Asia/Shanghai"), "Today is 2026-10-18, Sunday (Asia/Shanghai).");
});

test("apply registers exactly one scoped, uninterpolated section right after the persona slot, and unload removes it", () => {
  const tree = fakeScope();
  apply(tree.ctx, {});
  assert.equal(tree.sections.length, 1);
  const [section] = tree.sections;
  assert.equal(section.name, TODAY_SECTION);
  assert.ok(Number.isFinite(section.order), "the persona slot exists in the installed SECTION_ORDERS");
  assert.equal(section.order, dshSectionOrder("DEPLOYMENT_PERSONA_PREFIX") + 1);
  assert.equal(section.interpolate, false);
  assert.equal(typeof section.text, "function");
  assert.match((section.text as () => string)(), /^Today is \d{4}-\d{2}-\d{2}, [A-Z][a-z]+ \(.+\)\.$/);
  tree.unload();
  assert.equal(tree.sections.length, 0);
});

test("apply refuses a bad config with its reason", () => {
  assert.throws(() => apply(fakeScope().ctx, { cycle: 7 }), /gravit: .*cycle/);
});

/* The text function runs at every assembly and `apply` never calls it, so an
 * unusable TZ - "" resolves to "Etc/Unknown", which Intl refuses; "Foo/Bar"
 * resolves to undefined - would mount cleanly and then throw (or print
 * "(undefined)") in every Gravit prompt. Node re-reads TZ on assignment, so the
 * real resolution is exercised; the key is put back (or deleted) in `finally`. */
test("an unusable TZ is rendered in UTC and labelled, never thrown at assembly", () => {
  const saved = process.env.TZ;
  try {
    for (const unusable of ["", "Foo/Bar"]) {
      process.env.TZ = unusable;
      assert.equal(resolveZone(), "UTC", `TZ=${JSON.stringify(unusable)}`);
      const tree = fakeScope();
      apply(tree.ctx, {});
      const text = (tree.sections[0].text as () => string)();
      assert.match(text, /^Today is \d{4}-\d{2}-\d{2}, [A-Z][a-z]+ \(UTC\)\.$/, `TZ=${JSON.stringify(unusable)}`);
      tree.unload();
    }
    process.env.TZ = "America/New_York";
    assert.equal(resolveZone(), "America/New_York");
    const tree = fakeScope();
    apply(tree.ctx, {});
    assert.match((tree.sections[0].text as () => string)(), /\(America\/New_York\)\.$/);
    tree.unload();
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

/* The roles section lists what the ASSEMBLING scope can call, the gate dsh-tool-web and
 * dsh-tool-subagent put on their own sections: a role child, whose allow list restricts the
 * `role_<id>` tools away, is told of none; a `subagent_fork` child - seeded, unrestricted - sees
 * every role tool, so it gets Gravit's text unchanged and its inherited prefix stays byte-identical
 * (roles-smoke pins that on a real boot); a role whose tool never registered is not advertised.
 * These contexts carry no agent, so the header half of the gate (`isRootOrFork`, the last test)
 * reads them as a root. */
test("gravit: the roles section follows dsh's subagent section and lists exactly the roles the assembling scope can call", () => {
  const tree = fakeScope();
  const roles = [{ tool: "role_probe", summary: "probes the fixture" }, { tool: "role_auditor", summary: "audits" }];
  apply(tree.ctx, { roles });
  const section = tree.sections.find((s) => s.name === ROLES_SECTION)!;
  assert.ok(section, "registered");
  assert.equal(section.order, dshSectionOrder("TOOL_SUBAGENT") + 1);
  assert.equal(section.interpolate, false);
  assert.equal(tree.lookups.length, 0, "nothing is looked up at mount: the gate is read at every assembly");
  const textFor = (visible: string[]) => (section.text as (c: unknown) => string)({ scope: { visible } });
  const all = textFor(["read", "role_probe", "role_auditor"]);
  assert.equal(all, rolesText(roles), "every role tool visible: the whole list, as Gravit and a fork child read it");
  assert.match(all, /^Roles\. /);
  assert.ok(all.includes("- role_probe — probes the fixture") && all.includes("- role_auditor — audits"));
  assert.equal(textFor(["read", "grep"]), "", "no role tool visible (a role child's allow list removed them): nothing");
  assert.equal(textFor(["role_auditor"]), rolesText([roles[1]]), "one of two visible: that one only");
  assert.equal(textFor(["role_auditor"]).includes("role_probe"), false);
});

test("canCall is the registry's view of the assembling scope: tools.get(name, context.scope)", () => {
  const tree = fakeScope();
  const scope = { visible: ["role_probe"] };
  assert.equal(canCall(tree.ctx, { scope }, "role_probe"), true);
  assert.equal(canCall(tree.ctx, { scope }, "role_auditor"), false);
  assert.deepEqual(tree.lookups.map((l) => [l.name, l.scope === scope]), [["role_probe", true], ["role_auditor", true]], "each lookup is handed the context's own scope");
  assert.equal(canCall(tree.ctx, {}, "role_probe"), false, "no scope is the global view, where no preset-scoped tool lives");
  assert.equal(canCall(tree.ctx, undefined, "role_probe"), false, "total on a missing context");
});

test("gravit: without a roles key there is no roles section; an empty list renders nothing", () => {
  const tree = fakeScope();
  apply(tree.ctx, {});
  assert.equal(tree.sections.some((s) => s.name === ROLES_SECTION), false);
  assert.equal(rolesText([]), "");
});

/* D20: a role call blocks and returns the role's report (plugins/role.mjs), unlike `subagent`, which returns an id
 * and reports through a notice; the intro says so, and that a role child is never messaged. */
test("gravit: the roles intro says the call returns the role's report and that a role child is never messaged", () => {
  const [intro] = rolesText([{ tool: "role_probe", summary: "probe" }]).split("\n");
  assert.ok(intro.startsWith("Roles. One-shot delegates"), intro);
  assert.ok(intro.includes("returns the role's report"), intro);
  assert.ok(intro.includes("never send_message"), intro);
  assert.ok(intro.includes("a claim to check, never a result to copy"), intro);
});

/* The cycle section is gated the way the roles section is: on what the ASSEMBLING scope can call
 * (and on the header, the last test). `create_goal` is the probe because the contract is written
 * for the session that opens a goal - Gravit, and a `subagent_fork` child, which resolves every
 * tool Gravit does and so reads the identical text (its inherited prefix stays byte-identical;
 * roles-smoke pins that on a real boot) - while a role child, whose allow list removed the goal
 * tools, is not given the face's contract. */
test("gravit: the cycle section sits just before the persona suffix, is literal, and is blank where create_goal is not visible", () => {
  const tree = fakeScope();
  const cycle = "# The research cycle\n\nStep 0 — ask once.";
  apply(tree.ctx, { cycle });
  const section = tree.sections.find((s) => s.name === CYCLE_SECTION)!;
  assert.ok(section);
  assert.equal(section.order, dshSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 50);
  assert.equal(section.interpolate, false);
  assert.equal(tree.lookups.length, 0, "nothing is looked up at mount: the gate is read at every assembly");
  const textFor = (visible: string[]) => (section.text as (c: unknown) => string)({ scope: { visible } });
  assert.equal(textFor(["read", "create_goal", "update_goal"]), cycle, "create_goal visible (Gravit, or a fork child): the cycle, verbatim");
  assert.equal(textFor(["read", "grep"]), "", "create_goal not visible (a role child's allow list removed it): nothing");
  tree.unload();
  assert.equal(tree.sections.length, 0, "unloading the preset revision takes the cycle section out with the date's");
});

/* Visibility alone admits every UNRESTRICTED child: a plain `subagent` spawn, a workflow or a ralph
 * worker resolves `create_goal` and every role tool as Gravit does. So both sections also read the
 * assembling session's header (`context.agent.session.header`): a delegated child (`origin:
 * "subagent"`) that is not a fork (`isSeeded` false) reads neither - it inherits no prefix to keep
 * identical, and `create_goal` needs a direct human turn on a top-level agent, which it never has -
 * while a `subagent_fork` child (seeded) and a root session read Gravit's text, byte for byte. The
 * scope here resolves every tool, so only the header can blank a section. */
test("gravit: both sections are blank for a delegated child that is not a fork, and Gravit's text for a fork child and a root session", () => {
  const tree = fakeScope();
  const roles = [{ tool: "role_probe", summary: "probes the fixture" }, { tool: "role_auditor", summary: "audits" }];
  const cycle = "# The research cycle\n\nStep 0 — ask once.";
  apply(tree.ctx, { roles, cycle });
  const everything = { visible: ["read", "create_goal", "update_goal", "role_probe", "role_auditor"] };
  const textOf = (sectionName: string, header?: object): string =>
    (tree.sections.find((s) => s.name === sectionName)!.text as (c: unknown) => string)(
      header === undefined ? { scope: everything } : { scope: everything, agent: { session: { header } } });
  const cases = [
    { label: "a root session", header: { id: "root", isSeeded: false }, reads: true },
    { label: "a subagent_fork child (seeded)", header: { id: "fork", origin: "subagent", isSeeded: true }, reads: true },
    { label: "a session the operator forked (seeded, no origin)", header: { id: "forked", isSeeded: true }, reads: true },
    { label: "a delegated child that is not a fork (subagent, workflow, ralph)", header: { id: "spawn", origin: "subagent", isSeeded: false }, reads: false },
    { label: "a context with no agent (the global view)", header: undefined, reads: true },
  ];
  for (const { label, header, reads } of cases) {
    assert.equal(textOf(ROLES_SECTION, header), reads ? rolesText(roles) : "", `roles section, ${label}`);
    assert.equal(textOf(CYCLE_SECTION, header), reads ? cycle : "", `cycle section, ${label}`);
    assert.equal(isRootOrFork(header === undefined ? {} : { agent: { session: { header } } }), reads, `isRootOrFork, ${label}`);
  }
  assert.equal(isRootOrFork(undefined), true, "total on a missing context");
  tree.unload();
});

test("validateGravitConfig: desk must be a non-empty string when given", () => {
  assert.equal(validateGravitConfig({}), undefined, "absent: valid, as before");
  assert.equal(validateGravitConfig({ desk: "x" }), undefined);
  for (const desk of ["", " \n", 3, null, ["x"]])
    assert.equal(validateGravitConfig({ desk }), "desk must be a non-empty string", JSON.stringify(desk));
  assert.throws(() => apply(fakeScope().ctx, { desk: 3 }), (e: Error) => e.message === "gravit: desk must be a non-empty string", "apply refuses the mount with it");
});

/* The two contracts share one slot and two different jobs - the cycle opens goals, the desk never orders -
 * so a preset carries one or the other: Gravit's row the cycle, the desk's row (src/desk-preset.ts) the
 * desk. A row carrying both is refused at the mount rather than mounting two contracts that contradict. */
test("validateGravitConfig: a preset carries the cycle contract or the desk contract, not both", () => {
  const both = "a preset carries the cycle contract or the desk contract, not both";
  assert.equal(validateGravitConfig({ cycle: "C", desk: "D" }), both);
  assert.equal(validateGravitConfig({ roles: [], cycle: "C", desk: "D" }), both);
  assert.equal(validateGravitConfig({ cycle: "C" }), undefined, "the cycle alone: Gravit's row");
  assert.equal(validateGravitConfig({ desk: "D" }), undefined, "the desk alone: the desk's row");
  const tree = fakeScope();
  assert.throws(() => apply(tree.ctx, { cycle: "C", desk: "D" }), (e: Error) => e.message === `gravit: ${both}`, "apply refuses the mount with it");
  assert.equal(tree.sections.length, 0, "before registering any section");
});

/* The desk's contract binds every desk session whatever its allow list leaves it, so its section has NO
 * tool gate: it never looks a tool up, at mount or at assembly, and a scope that can call nothing still
 * reads it. Only the header gates it, as it does the cycle's: a delegated child that is not a fork reads
 * nothing; a root session and a fork child read the text verbatim. It takes the cycle's slot (a preset
 * carries one contract or the other), and a config without `desk` - Gravit's own among them - mounts none. */
test("the desk section registers only with a desk key, after the persona, and is blank for a non-fork child", () => {
  const tree = fakeScope();
  apply(tree.ctx, { desk: "D" });
  assert.equal(DESK_SECTION, "gravit:desk");
  assert.deepEqual(tree.sections.map((s) => s.name).sort(), [TODAY_SECTION, DESK_SECTION].sort(), "the date and the desk: no roles, no cycle");
  const section = tree.sections.find((s) => s.name === DESK_SECTION)!;
  assert.ok(section.order > dshSectionOrder("DEPLOYMENT_PERSONA_PREFIX"), "after the persona prefix");
  assert.equal(section.order, dshSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 50, "the cycle's slot, just before the persona suffix");
  assert.equal(section.interpolate, false);
  assert.equal(typeof section.text, "function");
  const text = section.text as (c: unknown) => string;
  assert.equal(text({ agent: { session: { header: {} } } }), "D", "a root session");
  assert.equal(text({ agent: { session: { header: { origin: "subagent" } } } }), "", "a delegated child that is not a fork");
  assert.equal(text({ agent: { session: { header: { origin: "subagent", isSeeded: true } } } }), "D", "a subagent_fork child (seeded)");
  assert.equal(text({ scope: { visible: [] }, agent: { session: { header: {} } } }), "D", "a scope that can call nothing: no tool gate");
  assert.equal(text({}), "D", "a context with no agent (the global view)");
  assert.equal(tree.lookups.length, 0, "no tool is looked up, at mount or at assembly");
  tree.unload();
  assert.equal(tree.sections.length, 0, "unloading the preset revision takes the desk section out with the date's");
  for (const config of [{}, { roles: [{ tool: "role_screener", summary: "runs the screen" }], cycle: "# The research cycle" }]) {
    const other = fakeScope();
    apply(other.ctx, config);
    assert.equal(other.sections.some((s) => s.name === DESK_SECTION), false, `no desk key, no desk section: ${JSON.stringify(config)}`);
  }
});

/* The conversation's contract (`dsh/profile/router.md`, src/router-preset.ts) takes the cycle's slot too, gated as
 * the desk's is - by the header alone - and names the repository by a placeholder the row's `root` fills. */
test("a router config mounts gravit:router, its <REPO> replaced by root, and neither gravit:cycle nor gravit:desk", () => {
  const tree = fakeScope();
  apply(tree.ctx, { router: { text: "Read <REPO>/strategies; the repo is <REPO>.", root: "/r" } });
  assert.equal(ROUTER_SECTION, "gravit:router");
  assert.deepEqual(tree.sections.map((s) => s.name).sort(), [TODAY_SECTION, ROUTER_SECTION].sort(), "the date and the router: no cycle, no desk");
  const section = tree.sections.find((s) => s.name === ROUTER_SECTION)!;
  assert.equal(section.order, dshSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 50, "the cycle's slot");
  assert.equal(section.interpolate, false);
  const text = section.text as (c: unknown) => string;
  const filled = "Read /r/strategies; the repo is /r.";
  assert.equal(text({ agent: { session: { header: {} } } }), filled, "a root session, every <REPO> replaced");
  assert.equal(text({ agent: { session: { header: { origin: "subagent", isSeeded: true } } } }), filled, "a fork child");
  assert.equal(text({ agent: { session: { header: { origin: "subagent" } } } }), "", "a delegated child that is not a fork");
  assert.equal(text({ scope: { visible: [] }, agent: { session: { header: {} } } }), filled, "no tool gate");
  assert.equal(tree.lookups.length, 0);
  tree.unload();
  assert.equal(tree.sections.length, 0);
  for (const config of [{}, { desk: "D" }, { cycle: "C" }]) {
    const other = fakeScope();
    apply(other.ctx, config);
    assert.equal(other.sections.some((s) => s.name === ROUTER_SECTION), false, `no router key, no router section: ${JSON.stringify(config)}`);
  }
});

test("router excludes cycle and desk", () => {
  const router = { text: "T", root: "/r" };
  assert.equal(validateGravitConfig({ router }), undefined);
  for (const other of [{ cycle: "c" }, { desk: "d" }]) {
    const problem = validateGravitConfig({ router, ...other });
    assert.equal(typeof problem, "string", JSON.stringify(other));
    assert.throws(() => apply(fakeScope().ctx, { router, ...other }), (e: Error) => e.message === `gravit: ${problem}`);
  }
  for (const bad of [null, "T", [], {}, { text: "T" }, { root: "/r" }, { text: "", root: "/r" }, { text: "T", root: "" }, { text: 3, root: "/r" }])
    assert.equal(typeof validateGravitConfig({ router: bad }), "string", JSON.stringify(bad));
});

const PROTOCOL = { name: "lunhui:run", probe: "lunhui_read_run", text: "# 市场研究运行\n\n先冻结 {run}。" };
const MODULE_PROTOCOL = { name: "lunhui:module", probe: "lunhui_read_run", text: "# 单模块" };

test("validateGravitConfig: protocols are checked when present - an array of { name, probe, text }, names unique", () => {
  assert.equal(LUNHUI_RUN_SECTION, "lunhui:run");
  assert.equal(LUNHUI_MODULE_SECTION, "lunhui:module");
  assert.equal(validateGravitConfig({ protocols: [] }), undefined);
  assert.equal(validateGravitConfig({ protocols: [PROTOCOL] }), undefined);
  assert.match(validateGravitConfig({ protocols: PROTOCOL }) ?? "", /protocols must be an array/);
  assert.match(validateGravitConfig({ protocols: [null] }) ?? "", /protocols\[0\] must be an object/);
  assert.match(validateGravitConfig({ protocols: [{ ...PROTOCOL, name: "lunhui-run" }] }) ?? "", /protocols\[0\]\.name/);
  assert.match(validateGravitConfig({ protocols: [{ ...PROTOCOL, name: "Lunhui:run" }] }) ?? "", /protocols\[0\]\.name/);
  assert.match(validateGravitConfig({ protocols: [{ ...PROTOCOL, probe: "" }] }) ?? "", /protocols\[0\]\.probe/);
  assert.match(validateGravitConfig({ protocols: [{ ...PROTOCOL, probe: "lunhui read run" }] }) ?? "", /protocols\[0\]\.probe/);
  assert.match(validateGravitConfig({ protocols: [{ ...PROTOCOL, text: " " }] }) ?? "", /protocols\[0\]\.text/);
  assert.match(validateGravitConfig({ protocols: [PROTOCOL, PROTOCOL] }) ?? "", /protocols\[1\]\.name .*twice/);
  for (const own of [TODAY_SECTION, ROLES_SECTION, CYCLE_SECTION, DESK_SECTION]) {
    assert.match(validateGravitConfig({ protocols: [{ ...PROTOCOL, name: own }] }) ?? "", /protocols\[0\]\.name .*this plugin's own sections/, `${own} is reserved`);
  }
  assert.throws(() => apply(fakeScope().ctx, { protocols: [{ ...PROTOCOL, text: "" }] }), /gravit: .*protocols/);
});

/* A protocol is gated as the cycle is - on the header and on what the assembling scope can call -
 * with its own probe: `lunhui:run` reads `lunhui_read_run`, so it is there only when the Lunhui rows
 * mounted. The first sits ten below the cycle and each later one a step after, so the run protocol and
 * then the module protocol read just before the cycle contract. A
 * role child fails both halves (its allow list carries no lunhui_read_run, and it is no fork); a
 * plain spawn child sees the probe (the Lunhui tools are tree-wide) and only the header blanks it. */
test("gravit: a protocol section sits just before the cycle, is literal, and reads only for a root or fork that can call its probe", () => {
  const tree = fakeScope();
  apply(tree.ctx, { cycle: "# The research cycle", protocols: [PROTOCOL, MODULE_PROTOCOL] });
  const section = tree.sections.find((s) => s.name === LUNHUI_RUN_SECTION)!;
  const module = tree.sections.find((s) => s.name === LUNHUI_MODULE_SECTION)!;
  assert.ok(section, "registered under the protocol's own name");
  assert.ok(module, "the second protocol registered under its own name");
  const cycleOrder = tree.sections.find((s) => s.name === CYCLE_SECTION)!.order;
  assert.equal(section.order, dshSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 60);
  assert.equal(module.order, section.order + 1, "the second protocol one order step after the first, in their listed order");
  assert.ok(section.order < cycleOrder && module.order < cycleOrder, "both before the cycle contract");
  assert.equal(tree.lookups.length, 0, "nothing is looked up at mount: the gate is read at every assembly");
  for (const [registered, protocol] of [[section, PROTOCOL], [module, MODULE_PROTOCOL]] as const) {
    assert.equal(registered.interpolate, false);
    const textFor = (visible: string[], header?: object) =>
      (registered.text as (c: unknown) => string)(header === undefined ? { scope: { visible } } : { scope: { visible }, agent: { session: { header } } });
    const withProbe = ["read", "create_goal", "lunhui_read_run", "lunhui_freeze_index"];
    assert.equal(textFor(withProbe, { id: "root", isSeeded: false }), protocol.text, `${protocol.name}: a root session that can call the probe: the text, verbatim`);
    assert.equal(textFor(withProbe, { id: "fork", origin: "subagent", isSeeded: true }), protocol.text, `${protocol.name}: a fork child: the same text`);
    assert.equal(textFor(withProbe, { id: "spawn", origin: "subagent", isSeeded: false }), "", `${protocol.name}: a spawn child that can call the probe: nothing`);
    assert.equal(textFor(["skill", "lunhui_read_environment_context", "lunhui_submit_environment"], { id: "role", origin: "subagent", isSeeded: false }), "", `${protocol.name}: a role child: nothing`);
    assert.equal(textFor(["read", "create_goal"], { id: "root", isSeeded: false }), "", `${protocol.name}: the probe hidden (the Lunhui rows did not mount): nothing, even for a root`);
  }
  assert.deepEqual([...new Set(tree.lookups.map((l) => l.name))], ["lunhui_read_run"], "the probe is the protocols' own");
  tree.unload();
  assert.equal(tree.sections.length, 0, "unloading the preset revision takes the protocols out with the rest");
});

test("gravit: without a protocols key, or with an empty list, no protocol section is registered", () => {
  for (const config of [{}, { protocols: [] }]) {
    const tree = fakeScope();
    apply(tree.ctx, config);
    assert.equal(tree.sections.some((s) => s.name === LUNHUI_RUN_SECTION), false);
    assert.equal(tree.sections.some((s) => s.name === LUNHUI_MODULE_SECTION), false);
    tree.unload();
  }
});
