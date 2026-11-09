// face/src/router-preset.ts
/** The conversation's preset, `gravit-router`: Gravit in the operator's one conversation, answering what a few
 * reads answer and starting a task for anything longer (docs/superpowers/specs/2026-11-08-one-entry-router-design.md
 * §5.2).
 *
 * Shaped as the desk's preset is (src/desk-preset.ts), and declared from memory beside it, after boot:
 * - the face's `gravit` plugin carrying the conversation's contract alone, `{ router: { text, root } }` -
 *   `dsh/profile/router.md` (src/cycle.ts `readRouter`) and the repository's root, which plugins/gravit.js puts
 *   in place of the text's `<REPO>` placeholder in the `gravit:router` section. No roles, no cycle, no desk:
 *   plugins/gravit.js refuses a row that carries the router beside either contract.
 * - `plugins/bot.js` in its MASK-ONLY mode, `{ maskOnly: true, allow: ROUTER_ALLOW }`, so Gravit's persona
 *   stays and the conversation sees {@link ROUTER_ALLOW} ∩ the tree.
 *
 * NO SHELL AND NO WRITES. The conversation reads files, the market's keyless reads and the Account seat's reads;
 * whatever runs a shell or writes a file is a task's worker's. The task tools (`task_*`) are not in this mask: like
 * the desk's tools they are registered into the conversation agent's own layer, which no mask filters. The face's
 * desk guard judges this preset's agents as it judges the desk's (src/desk-tools.ts `installDeskGuard`): no read
 * outside the repository or of a key file or dot-file, no call carrying a secret.
 * @module
 */
import type { PresetDefinition } from "@deepseek-ai/dsh-agent-preset-registry";
import { CONVERSATION_PRESET } from "./desk-names.ts";
import { BOT_PLUGIN_URL, GRAVIT_PLUGIN_URL, GRAVIT_ROW_ID } from "./roles.ts";

/** The Account seat's reads the conversation may call, by raw name after `portfolio_`: each a member of
 * src/orders.ts `SEAT_READ_RAW_NAMES`, none of `SEAT_WRITE_RAW_NAMES` (tests/router-preset.test.ts). */
const SEAT_READS = [
  "overview", "read", "markets", "quote", "account", "statement", "holdings", "history", "asset", "venues",
  "live_positions", "live_markets",
] as const;

/** What the conversation may see, in this order: file reads and search, the market's four keyless reads (never
 * `market_akshare`), and the seat's reads, each under whatever server name the operator mounts it (`mcp__*__<raw>`,
 * expanded by plugins/bot.js). Frozen, and pinned name for name by tests/router-preset.test.ts. */
export const ROUTER_ALLOW: readonly string[] = Object.freeze([
  "read", "grep", "glob",
  "mcp__*__market_explore", "mcp__*__market_quotes", "mcp__*__market_candles", "mcp__*__market_book",
  ...SEAT_READS.map((raw) => `mcp__*__portfolio_${raw}`),
]);

/** The `gravit-router` definition for the conversation's contract `router.text` (`readRouter`'s text) and the
 * repository's root `router.root`. Pure: every call builds fresh rows, and the mask row's allow list is a copy. */
export function routerPresetDefinition(opts: { router: { text: string; root: string } }): PresetDefinition {
  return {
    id: CONVERSATION_PRESET,
    name: "Gravit · conversation",
    description: "Gravit in the operator's one conversation: answers, or starts a task and routes it",
    plugins: [
      { id: GRAVIT_ROW_ID, name: GRAVIT_PLUGIN_URL, config: { router: { text: opts.router.text, root: opts.router.root } } },
      { id: "router-mask", name: BOT_PLUGIN_URL, config: { maskOnly: true, allow: [...ROUTER_ALLOW] } },
    ],
  };
}
