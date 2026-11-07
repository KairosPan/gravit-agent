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
 * The desk does reach the network beyond its search: it opens public web pages with dsh's own `web_fetch`
 * (spec 2026-11-07 §5.6), because search snippets alone cannot explain a move. That is an accepted risk -
 * charter R1 and D29: a page's planted text could have a turn put what the desk reads (the book, the journal,
 * the rules) into a URL it opens. Keys stay out - the guard reads no key file or dot-file and refuses any call
 * that carries a secret - and every fetch that reaches dispatch is a `desk-fetch` line in the ledger.
 *
 * The two desk tools, `desk_quotes` and `desk_state`, and `web_fetch` are not in this composition. An allow
 * mask filters what the preset's own layer registers too, and `tools.restrict` refuses to name such a tool, so a
 * row here could not offer them past the mask; they are registered into each desk agent's own layer instead,
 * which no restriction filters (docs/superpowers/plans/2026-10-20-desk-p1-bridge.md, Global
 * Constraints; src/desk-tools.ts `installDeskTools`). `web_fetch` is not in {@link DESK_ALLOW} either: the tree
 * registers none (src/policy.ts D6), so naming it would expose nothing, and the desk's own layer is the only place
 * it exists. A tool the mask hides is refused at dispatch.
 *
 * DECLARED AFTER BOOT, like the bots and the role presets (src/roles.ts `rolePresetDefinition`, D20/B1)
 * and unlike Gravit's default. `bootFace` calls {@link declareDeskPreset} right after `declareBots`, and
 * the role presets right after it, once the tree has settled: activation is EAGER (NEW
 * packages/preset/agent-preset-registry/src/index.ts:80-118) and a mount failure is final, so a static
 * overlay row would mount the mask before the MCP rows' tools exist. `bootFace` then refuses the boot, as
 * it does for the legacy alias, when the roster does not list the desk whole ({@link deskRosterProblem})
 * or a role's preset whole (src/roles.ts `roleRosterProblem`).
 *
 * WHAT THE MASK IS NOT. Visibility, not authority (plugins/bot.js, WHAT THIS IS NOT): what a desk turn
 * may write is its session's sandbox and the face's desk guard (src/desk-tools.ts `installDeskGuard`: no
 * write of an instruction file, no read outside the repository or of a key file, no call carrying a
 * secret), and what it may order is nothing - Gate 2 stands between every session and every order tool.
 * Nor does the mask decide what the desk may fetch: `web_fetch` sits in the desk agent's own layer, past the
 * mask, and what bounds it is the http provider (public HTTP(S) addresses only, no credentials in a URL,
 * same-origin redirects only), the guard's secret check, and the record of every fetch (charter D29).
 * @module
 */
import type { Context } from "@deepseek-ai/cordis";
import type { PresetDefinition } from "@deepseek-ai/dsh-agent-preset-registry";
import { declarePreset } from "./bot-presets.ts";
import { DESK_PRESET } from "./desk-names.ts";
import { BOT_PLUGIN_URL, GRAVIT_PLUGIN_URL, GRAVIT_ROW_ID } from "./roles.ts";

const BIN = "gravit-face";

/** The desk's preset id, defined in src/desk-names.ts - a leaf that src/desk-tools.ts, and through it
 * the pause switch, can load without this module's imports - and re-exported here for this module's
 * importers. src/bots.ts reserves it, importing it from the leaf too: this module imports src/roles.ts,
 * which imports src/bots.ts, and the leaf is outside that cycle. */
export { DESK_PRESET };

/** What a desk session may see, in this order (the plan's Global Constraints): file read and edit,
 * search, skills, web search, its own todos, and the live market reads of the alpaca-kit MCP server
 * under whatever name the operator mounts it (`mcp__*__<raw>`, expanded by plugins/bot.js). Writes stay:
 * the session's sandbox keeps them to `desk/journal/` and the temp areas, an escalation asking the
 * operator; the face's desk guard (src/desk-tools.ts `installDeskGuard`) denies a desk turn's write of an
 * instruction file and its read outside the repository or of a key file; and the face's instruction-chain
 * fence (src/desk-session.ts) refuses a desk turn while an instruction file sits there. Absent by design:
 * the shell and its background-job tools (NO SHELL, in the header), every order and account tool, the
 * question tool, goals, delegation (`subagent*`, `send_message`, `interrupt_agent`, `list_agents`,
 * `workflow`, `ralph`, the room's `dispatch`, every `agent_<bin>`), the AKShare tools, and the bed-backed
 * reads (`market_snapshot`, `screen`, `breadth`). Frozen, and pinned name for name by
 * tests/desk-preset.test.ts: whatever is added here reaches every unattended desk turn. */
export const DESK_ALLOW: readonly string[] = Object.freeze([
  "read", "write", "edit", "read_image", "glob", "grep", "str_replace_editor", "skill", "web_search", "todo_write",
  "mcp__*__earnings", "mcp__*__daily_bars", "mcp__*__calendar", "mcp__*__corp_actions",
]);

/** `plugins/bot.js` as the mask row's `name`, defined in src/roles.ts beside {@link GRAVIT_PLUGIN_URL}
 * (a role preset's mask row names it too) and re-exported here for this module's importers. */
export { BOT_PLUGIN_URL };

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

/** Declare the desk's `definition` ({@link deskPresetDefinition}) through src/bot-presets.ts
 * {@link declarePreset}, its messages naming it the desk agent preset: its refusals, its disposer and its
 * child fiber of the root are that function's. */
export async function declareDeskPreset(ctx: Context, definition: PresetDefinition): Promise<() => Promise<void>> {
  return declarePreset(ctx, definition, "desk agent preset");
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
