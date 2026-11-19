// face/src/router-preset.ts
/** The conversation's preset, `gravit-router`: gravit in the operator's one conversation, answering what a few
 * reads answer and starting a task for anything longer (docs/superpowers/specs/2026-11-08-one-entry-router-design.md
 * §5.2).
 *
 * Shaped as the desk's preset is (src/desk-preset.ts), and declared from memory beside it, after boot:
 * - the face's `gravit` plugin carrying the conversation's contract, `{ router: { text, root }, protocols }` -
 *   `dsh/profile/router.md` (src/cycle.ts `readRouter`) and the repository's root, which plugins/gravit.js puts
 *   in place of the text's `<REPO>` placeholder in the `gravit:router` section - and, as its `protocols`, the
 *   memory's section alone (`gravit:memory`, src/protocols.ts `readMemoryProtocol`), never the Lunhui protocols.
 *   No roles, no cycle, no desk: plugins/gravit.js refuses a row that carries the router beside either contract.
 * - `plugins/bot.js` in its MASK-ONLY mode, `{ maskOnly: true, allow: ROUTER_ALLOW }`, so gravit's persona
 *   stays and the conversation sees {@link ROUTER_ALLOW} ∩ the tree.
 *
 * NO SHELL AND NO FILE WRITES. The conversation reads files, the market's keyless reads and the Account seat's
 * reads, and holds the memory's seven tools, so the owner's decisions said in conversation are recorded where they
 * are said; whatever runs a shell or writes a file is a task's worker's. The task tools (`task_*`) are not in this mask: like
 * the desk's tools they are registered into the conversation agent's own layer, which no mask filters. The face's
 * desk guard judges this preset's agents as it judges the desk's (src/desk-tools.ts `installDeskGuard`): no read
 * outside the repository or of a key file or dot-file, no call carrying a secret.
 * @module
 */
import type { PresetDefinition } from "@deepseek-ai/dsh-agent-preset-registry";
import { CONVERSATION_PRESET } from "./desk-names.ts";
import { MEMORY_TOOL_PREFIX, MEMORY_TOOLS } from "./memory-row.ts";
import type { Protocol } from "./protocols.ts";
import { BOT_PLUGIN_URL, GRAVIT_PLUGIN_URL, GRAVIT_ROW_ID } from "./roles.ts";

/** The Account seat's reads the conversation may call, by raw name after `portfolio_`: each a member of
 * src/orders.ts `SEAT_READ_RAW_NAMES`, none of `SEAT_WRITE_RAW_NAMES` (tests/router-preset.test.ts). */
const SEAT_READS = [
  "overview", "read", "markets", "quote", "account", "statement", "holdings", "history", "asset", "venues",
  "live_positions", "live_markets",
] as const;

/** What the conversation may see, in this order: file reads and search, the market's four keyless reads and 问财
 * (`market_wencai`; never `market_akshare`) and the seat's reads, each under whatever server name the operator
 * mounts it (`mcp__*__<raw>`, expanded by plugins/bot.js), then the memory's seven tools (src/memory-row.ts
 * `MEMORY_TOOLS`, in the row's order) named WITH their server, `mcp__memory__<raw>` (`MEMORY_TOOL_PREFIX`): the
 * section's gate already needs that exact server name (src/protocols.ts `MEMORY_PROBE`), so a wildcard would buy
 * nothing, and it would let another server's tool named `memory_…` through this mask. plugins/bot.js admits an exact
 * name when the tree has it. Frozen, and pinned name for name by tests/router-preset.test.ts. */
export const ROUTER_ALLOW: readonly string[] = Object.freeze([
  "read", "grep", "glob",
  "mcp__*__market_explore", "mcp__*__market_quotes", "mcp__*__market_candles", "mcp__*__market_book", "mcp__*__market_wencai",
  ...SEAT_READS.map((raw) => `mcp__*__portfolio_${raw}`),
  ...MEMORY_TOOLS.map((raw) => `${MEMORY_TOOL_PREFIX}${raw}`),
]);

/** The `gravit-router` definition for the conversation's contract `router.text` (`readRouter`'s text) and the
 * repository's root `router.root`, with `protocols` - the memory's alone, as the boot hands it
 * (src/protocols.ts `readMemoryProtocol`) - as the gravit row's `protocols` when given. Pure: every call builds
 * fresh rows, and the mask row's allow list and the protocol list are copies. */
export function routerPresetDefinition(opts: { router: { text: string; root: string }; protocols?: readonly Protocol[] }): PresetDefinition {
  const router = { text: opts.router.text, root: opts.router.root };
  return {
    id: CONVERSATION_PRESET,
    name: "gravit · conversation",
    description: "gravit in the operator's one conversation: answers, or starts a task and routes it",
    plugins: [
      { id: GRAVIT_ROW_ID, name: GRAVIT_PLUGIN_URL, config: opts.protocols === undefined ? { router } : { router, protocols: [...opts.protocols] } },
      { id: "router-mask", name: BOT_PLUGIN_URL, config: { maskOnly: true, allow: [...ROUTER_ALLOW] } },
    ],
  };
}
