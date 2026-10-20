// face/tests/desk-preset.test.ts
/** The desk's preset, `gravit-desk` (src/desk-preset.ts), offline.
 *
 * `deskPresetDefinition` is pure, and is pinned against the plan's exact shape, the registry's own
 * validator (`entryListProblem`, installed) and the two plugins' own validators, so a drift in any of
 * them fails here instead of listing the preset broken at boot. `declareDeskPreset` runs on a REAL
 * cordis Context with a stand-in `agentPresets` that keeps the registry's contract where it matters - a
 * duplicate id throws, and `register` resolves to the async disposer the declaring fiber owns - as
 * tests/bot-presets.test.ts drills `declareBots`. The real registry mounting the real preset, and a desk
 * session's roster and prompt, are FACE_SMOKE territory.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { entryListProblem, type PresetDefinition } from "@deepseek-ai/dsh-agent-preset-registry";
import {
  BOT_PLUGIN_URL, DESK_ALLOW, DESK_PRESET, declareDeskPreset, deskPresetDefinition, deskRosterProblem,
} from "../src/desk-preset.ts";
import { GRAVIT_PLUGIN_URL } from "../src/roles.ts";
import { validateBotConfig } from "../plugins/bot.js";
import { validateGravitConfig } from "../plugins/gravit.js";
import { PLUGIN_ABS } from "./bots-fixture.ts";

/** The stand-in registry service; `events` records the order of registrations. */
function fakeRegistry() {
  const live = new Map<string, PresetDefinition>();
  const events: string[] = [];
  const service = {
    async register(definition: PresetDefinition): Promise<() => Promise<void>> {
      if (!definition.id.trim()) throw new Error("Preset id must not be empty");
      if (live.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`);
      live.set(definition.id, definition);
      events.push(`register ${definition.id}`);
      let disposed = false;
      return async () => {
        if (disposed) return;
        disposed = true;
        live.delete(definition.id);
        events.push(`unregister ${definition.id}`);
      };
    },
  };
  return { live, events, service };
}

/** A root context the way bootFace meets one after boot: the service provided. */
function rootWith(service?: object): Context {
  const ctx = new Context();
  if (service !== undefined) (ctx as unknown as { provide(name: string, value: unknown): () => void }).provide("agentPresets", service);
  return ctx;
}

test("deskPresetDefinition: the gravit row carries only the desk text; the mask is mask-only with DESK_ALLOW", () => {
  const d = deskPresetDefinition({ desk: "D" });
  assert.equal(d.id, "gravit-desk");
  assert.deepEqual(d.plugins.map((p) => p.id), ["gravit", "desk-mask"]);
  assert.deepEqual(d.plugins[0].config, { desk: "D" });
  assert.deepEqual(d.plugins[1].config, { maskOnly: true, allow: [...DESK_ALLOW] });
  assert.ok(d.plugins[1].name.endsWith("/face/plugins/bot.js") && d.plugins[1].name.startsWith("file://"));
});

test("DESK_ALLOW names no order, approval, goal, delegation or A-share tool", () => {
  for (const banned of ["place_order", "cancel_order", "orders", "account", "positions", "ask_user_question", "create_goal",
    "get_goal", "update_goal", "subagent", "subagent_fork", "send_message", "interrupt_agent", "list_agents", "ralph", "workflow", "akshare", "dispatch", "agent_",
    "bash", "job_"])
    assert.ok(DESK_ALLOW.every((name) => !name.includes(banned)), banned);
});

/* The plan's Global Constraints list, verbatim and in its order. Every name reaches every unattended desk
 * turn, and the desk reads text it does not control, so the list is pinned name for name: a shell (`bash`,
 * or the `job_*` tools that serve its background jobs) beside readable key files and an open network would
 * be an exfiltration path, and a later edit must not add one back quietly. */
test("DESK_ALLOW is exactly the plan's 14 names, in order - no shell, no job tools - and cannot be changed at run time", () => {
  assert.deepEqual([...DESK_ALLOW], [
    "read", "write", "edit", "read_image", "glob", "grep", "str_replace_editor", "skill", "web_search", "todo_write",
    "mcp__*__earnings", "mcp__*__daily_bars", "mcp__*__calendar", "mcp__*__corp_actions",
  ]);
  assert.equal(Object.isFrozen(DESK_ALLOW), true);
});

/* Everything the registry and the two plugins would refuse at the mount is refused here first: the
 * registry's own entry-list check, `gravit.js`'s config check (one contract, never both) and `bot.js`'s
 * (the mask-only opt-in takes no persona). Both rows name the face's real files by absolute `file:` URL,
 * which the registry resolves the same from any declaring base. */
test("the desk definition: its display fields, both rows on the real plugin files, and valid for the registry and both plugins", () => {
  const d = deskPresetDefinition({ desk: "Inform; never order." });
  assert.deepEqual(d, {
    id: DESK_PRESET,
    name: "Gravit · desk",
    description: "Gravit on the desk: informs from the phone and the clock, never orders",
    plugins: [
      { id: "gravit", name: GRAVIT_PLUGIN_URL, config: { desk: "Inform; never order." } },
      { id: "desk-mask", name: BOT_PLUGIN_URL, config: { maskOnly: true, allow: [...DESK_ALLOW] } },
    ],
  });
  assert.equal(DESK_PRESET, "gravit-desk");
  assert.equal(fileURLToPath(BOT_PLUGIN_URL), PLUGIN_ABS, "the mask row mounts the face's own plugins/bot.js");
  assert.equal(entryListProblem(d.plugins), undefined, "the registry's own validator accepts the composition");
  assert.equal(validateGravitConfig(d.plugins[0].config), undefined, "the gravit row carries the desk contract alone");
  assert.equal(validateBotConfig(d.plugins[1].config), undefined, "the mask row is a valid mask-only row: no persona");
  assert.equal("persona" in d.plugins[1].config, false, "no persona row: Gravit's own prefix stays");
});

test("deskPresetDefinition is pure: every call builds fresh rows, and no caller can reach DESK_ALLOW through one", () => {
  const first = deskPresetDefinition({ desk: "D" });
  const second = deskPresetDefinition({ desk: "D" });
  assert.deepEqual(first, second);
  assert.notEqual(first.plugins[1].config.allow, second.plugins[1].config.allow);
  assert.notEqual(first.plugins[1].config.allow, DESK_ALLOW);
  first.plugins[1].config.allow.push("mcp__*__place_order");
  assert.equal(DESK_ALLOW.includes("mcp__*__place_order"), false);
  assert.deepEqual(second.plugins[1].config.allow, [...DESK_ALLOW]);
});

test("declareDeskPreset declares through a child fiber of the root, and its disposer withdraws the declaration", async () => {
  const registry = fakeRegistry();
  const ctx = rootWith(registry.service);
  const definition = deskPresetDefinition({ desk: "D" });
  const dispose = await declareDeskPreset(ctx, definition);
  assert.equal(typeof dispose, "function");
  assert.equal(registry.live.get(DESK_PRESET), definition, "the registry receives exactly the definition it was handed");
  await dispose();
  assert.equal(registry.live.has(DESK_PRESET), false, "the disposer unregisters it");
  await dispose();
  await declareDeskPreset(ctx, definition);
  await ctx.fiber.dispose();
  assert.equal(registry.live.has(DESK_PRESET), false, "a child fiber of the root: disposing the root withdraws it too");
  assert.deepEqual(registry.events, ["register gravit-desk", "unregister gravit-desk", "register gravit-desk", "unregister gravit-desk"],
    "a second disposer call is a no-op");
});

test("declareDeskPreset throws the registry's reason when the declaration is refused, and leaves nothing declared", async () => {
  const registry = fakeRegistry();
  registry.live.set(DESK_PRESET, { id: DESK_PRESET, plugins: [] });       // someone else already declared it
  const ctx = rootWith(registry.service);
  await assert.rejects(declareDeskPreset(ctx, deskPresetDefinition({ desk: "D" })), (error: Error) =>
    error.message === 'gravit-face: desk agent preset "gravit-desk" could not be declared - the preset registry refused it: Duplicate agent preset: gravit-desk'
      && error.cause instanceof Error && error.cause.message === "Duplicate agent preset: gravit-desk");
  assert.deepEqual(registry.events, [], "the refused declaration registered nothing");
  registry.live.delete(DESK_PRESET);
  await declareDeskPreset(ctx, deskPresetDefinition({ desk: "D" }));
  assert.deepEqual(registry.events, ["register gravit-desk"], "once the id is free, a declaration registers once");
  await ctx.fiber.dispose();
  assert.deepEqual(registry.events, ["register gravit-desk", "unregister gravit-desk"]);
});

/* Measured on cordis 4.0.4 (tests/bot-presets.test.ts): a fiber that injects an absent service stays
 * PENDING and awaiting it RESOLVES - the desk would "declare" and register nothing. */
test("without the agentPresets service declareDeskPreset refuses loudly instead of declaring nothing", async () => {
  await assert.rejects(declareDeskPreset(rootWith(), deskPresetDefinition({ desk: "D" })), /agentPresets is missing - the desk agent preset "gravit-desk" cannot be declared/);
});

/* bootFace's roster check (src/boot.ts), in the plan's exact words: a desk preset the registry does not
 * list, or lists broken, refuses the boot instead of failing the desk's first session at resolution. */
test("deskRosterProblem: the boot's refusal when gravit-desk is missing or broken, nothing when it is listed whole", () => {
  assert.equal(deskRosterProblem([{ id: "gravit" }, { id: "kairos" }]),
    'gravit-face: desk agent preset "gravit-desk" is not in the roster - the desk could not open');
  assert.equal(deskRosterProblem([{ id: "gravit" }, { id: "gravit-desk", broken: "desk-mask (file:///x/bot.js): gravit-bot: none of the allowed tools exist" }]),
    'gravit-face: desk agent preset "gravit-desk" is broken: desk-mask (file:///x/bot.js): gravit-bot: none of the allowed tools exist - the desk could not open');
  assert.equal(deskRosterProblem([{ id: "gravit" }, { id: "gravit-desk" }]), undefined);
});
