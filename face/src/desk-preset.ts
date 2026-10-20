// face/src/desk-preset.ts
/** The desk's preset, `gravit-desk`: Gravit on the desk, informing from the phone and the clock and
 * never ordering (docs/superpowers/specs/2026-10-19-always-on-gravit-design.md §5.3).
 *
 * The desk session joins a preset of its own, which the face declares from memory: no `bots/` directory
 * backs it, and src/bots.ts reserves its id so none can. Its composition is two rows:
 * - the face's `gravit` plugin (src/roles.ts `GRAVIT_PLUGIN_URL`) carrying the desk's contract alone,
 *   `{ desk }` - `dsh/profile/desk.md`, read by `composeFace` (src/cycle.ts `readDesk`). It mounts the
 *   date section and the scoped `gravit:desk` section, and neither the role list nor the cycle contract:
 *   a preset carries one contract or the other, and plugins/gravit.js refuses a row with both.
 * - `plugins/bot.js` in its MASK-ONLY mode, `{ maskOnly: true, allow: DESK_ALLOW }` with no persona. It
 *   registers no persona section, so the deployment's global persona prefix - Gravit's - stays; the desk
 *   sees {@link DESK_ALLOW} ∩ the tree, re-expanded after every tool change exactly as a bot's mask is.
 *
 * NO SHELL. The desk runs unattended on text it does not control (web results, filings, forwarded
 * messages), and with a shell an injected turn could read the repository's and the harness home's key
 * files and send them to any host - an exfiltration path. So {@link DESK_ALLOW} names neither `bash` nor
 * the `job_*` tools, which serve only background shell jobs; the face runs the desk's producers itself.
 *
 * The two desk tools, `desk_quotes` and `desk_state`, are not in this composition. An allow mask filters
 * what the preset's own layer registers too, and `tools.restrict` refuses to name such a tool, so a row
 * here could not offer them past the mask; they are registered into each desk agent's own layer instead,
 * which no restriction filters (docs/superpowers/plans/2026-10-20-desk-p1-bridge.md, Global
 * Constraints). A tool the mask hides is refused at dispatch.
 *
 * DECLARED AFTER BOOT, like the bots and unlike Gravit's default. `bootFace` calls
 * {@link declareDeskPreset} right after `declareBots`, once the tree has settled: activation is EAGER
 * (NEW packages/preset/agent-preset-registry/src/index.ts:80-118) and a mount failure is final, so a
 * static overlay row would mount the mask before the MCP rows' tools exist. `bootFace` then refuses the
 * boot, as it does for the legacy alias, when the roster does not list the desk whole
 * ({@link deskRosterProblem}).
 *
 * WHAT THE MASK IS NOT. Visibility, not authority (plugins/bot.js, WHAT THIS IS NOT): what a desk turn
 * may write is its session's sandbox, and what it may order is nothing - Gate 2 stands between every
 * session and every order tool.
 * @module
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import type { PresetDefinition } from "@deepseek-ai/dsh-agent-preset-registry";
import { DESK_PRESET } from "./desk-names.ts";
import { GRAVIT_PLUGIN_URL, GRAVIT_ROW_ID } from "./roles.ts";

const BIN = "gravit-face";
/** `FiberState.ACTIVE`: a const enum with no runtime object under tsx, so the literal, as
 * src/bot-presets.ts spells it. */
const FIBER_ACTIVE = 2;
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** The desk's preset id, defined in src/desk-names.ts - a leaf that src/desk-tools.ts, and through it
 * the pause switch, can load without this module's imports - and re-exported here for this module's
 * importers. src/bots.ts reserves it, spelling it out rather than importing it: this module imports
 * src/roles.ts, which imports src/bots.ts (tests/bots.test.ts ties the two spellings). */
export { DESK_PRESET };

/** What a desk session may see, in this order (the plan's Global Constraints): file read and edit,
 * search, skills, web search, its own todos, and the live market reads of the alpaca-kit MCP server
 * under whatever name the operator mounts it (`mcp__*__<raw>`, expanded by plugins/bot.js). Writes stay:
 * the session's sandbox confines them to `desk/journal/`, and the face's instruction-chain fence (the
 * plan's Global Constraints) refuses a desk turn while an instruction file sits there. Absent by design:
 * the shell and its background-job tools (NO SHELL, in the header), every order and account tool, the
 * question tool, goals, delegation (`subagent*`, `send_message`, `interrupt_agent`, `list_agents`,
 * `workflow`, `ralph`, the room's `dispatch`, every `agent_<bin>`), the AKShare tools, and the bed-backed
 * reads (`market_snapshot`, `screen`, `breadth`). Frozen, and pinned name for name by
 * tests/desk-preset.test.ts: whatever is added here reaches every unattended desk turn. */
export const DESK_ALLOW: readonly string[] = Object.freeze([
  "read", "write", "edit", "read_image", "glob", "grep", "str_replace_editor", "skill", "web_search", "todo_write",
  "mcp__*__earnings", "mcp__*__daily_bars", "mcp__*__calendar", "mcp__*__corp_actions",
]);

/** `plugins/bot.js` as the row's `name`: an absolute `file:` URL, module-relative, built the way
 * src/roles.ts builds {@link GRAVIT_PLUGIN_URL}. dsh resolves a preset's rows against the DECLARING
 * context's base (NEW agent-preset-registry/src/index.ts:108, src/mount.ts:258-264), so a relative
 * spelling would miss the file; a `file:` URL resolves the same from any base. */
export const BOT_PLUGIN_URL: string = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "bot.js")).href;

/** The `gravit-desk` definition for the desk's contract `desk` (`readDesk`'s text). Pure: every call
 * builds fresh rows, and the mask row's allow list is a copy, so no caller can reach
 * {@link DESK_ALLOW} through one. No roles, no cycle, no persona row. */
export function deskPresetDefinition(options: { desk: string }): PresetDefinition {
  return {
    id: DESK_PRESET,
    name: "Gravit · desk",
    description: "Gravit on the desk: informs from the phone and the clock, never orders",
    plugins: [
      { id: GRAVIT_ROW_ID, name: GRAVIT_PLUGIN_URL, config: { desk: options.desk } },
      { id: "desk-mask", name: BOT_PLUGIN_URL, config: { maskOnly: true, allow: [...DESK_ALLOW] } },
    ],
  };
}

/**
 * Declare `definition` into the booted tree's preset registry through its own child plugin of `ctx` -
 * the pattern src/bot-presets.ts `declareBots` declares every bot with, which is the registry's own
 * declaration model: `ctx.plugin({ inject: ["agentPresets"], async *apply(c) { yield await
 * c.agentPresets.register(definition) } })`. Disposing that fiber unregisters the definition, and it is
 * a child of `ctx`, so disposing the root does too; if the registry itself restarts, cordis reloads the
 * fiber, which declares again on the new instance. Unlike a bot's, a refused declaration is not recorded
 * and survived: the face has no desk without it.
 * @param ctx - the booted ROOT context, after `boot()` resolved (src/boot.ts `bootFace`).
 * @param definition - the desk's definition ({@link deskPresetDefinition}).
 * @returns the disposer that withdraws the declaration; a second call is a no-op.
 * @throws when the preset registry service is absent (a fiber injecting a missing service stays pending
 * and awaiting it resolves, which would declare nothing, silently), when the registry refuses the
 * definition - its reason in the message and as the `cause` - and when the declaration never activated.
 * A declaration whose rows fail to mount does not throw: the registry lists it `broken`, which
 * {@link deskRosterProblem} reports.
 */
export async function declareDeskPreset(ctx: Context, definition: PresetDefinition): Promise<() => Promise<void>> {
  if (ctx.get("agentPresets") === undefined) {
    throw new Error(`${BIN}: agentPresets is missing - the desk agent preset "${definition.id}" cannot be declared (the agent-preset-registry overlay row did not mount)`);
  }
  /* A handle, never the fiber itself: `ctx.plugin` returns a thenable, and a thenable that reaches an
   * async function's `return` is silently adopted (src/bot-presets.ts says the same). */
  const fiber = ctx.plugin({
    inject: ["agentPresets"],
    async *apply(declaring: Context) { yield await declaring.agentPresets.register(definition); },
  });
  try {
    await fiber;
  } catch (error) {
    /* A refused `register` (a duplicate or blank id) leaves the fiber FAILED but attached (NEW
     * vendor/cordis/src/fiber.ts:659-664); detach it. */
    await fiber.dispose();
    throw new Error(`${BIN}: desk agent preset "${definition.id}" could not be declared - the preset registry refused it: ${messageOf(error)}`, { cause: error });
  }
  if ((fiber.state as number) !== FIBER_ACTIVE) {
    await fiber.dispose();
    throw new Error(`${BIN}: desk agent preset "${definition.id}" could not be declared - its declaration never activated (fiber state ${String(fiber.state)}); is the agentPresets service mounted?`);
  }
  return () => fiber.dispose();
}

/** Why the desk cannot open on this roster, as `bootFace`'s refusal, or `undefined` when the registry
 * lists `gravit-desk` whole: missing, or listed `broken` with the registry's reason. */
export function deskRosterProblem(roster: readonly { id: string; broken?: string }[]): string | undefined {
  const desk = roster.find((preset) => preset.id === DESK_PRESET);
  if (desk !== undefined && desk.broken === undefined) return undefined;
  return `${BIN}: desk agent preset "${DESK_PRESET}" is ` +
    (desk === undefined ? "not in the roster" : `broken: ${desk.broken}`) +
    " - the desk could not open";
}
