/** The market row: the project-owned MCP row that gives Gravit the market's
 * own reads - the market service in the repo's `market/` (127.0.0.1:4821),
 * through its MCP server `market/src/mcp.ts` (`npm run market:mcp`, stdio).
 *
 * The market holds no key and no wallet, and its server holds no state: five
 * keyless reads, `market_explore`, `market_quotes`, `market_candles`,
 * `market_book` and `market_akshare` (AKShare for A shares), each marked
 * read-only. Under the server name `market` they are `mcp__market__…`, which is
 * not under the seat's prefix, so Gate 2 never cards one (src/orders.ts). What
 * the owner connected, and every write, stays the seat's (src/account-seat.ts).
 *
 * The face spawns it from the repo's `market/` (`npm ci` there;
 * `FACE_MARKET_DIR` names another install) and points it at the market the
 * operator runs (`FACE_MARKET_URL`); the face never starts the service.
 * Composed in the project layer right after the seat row (src/boot.ts), below
 * the profile and home patches, so an operator patch can replace its config or
 * disable it (`- { id: mcp-market, disabled: true }`) without touching the seat.
 *
 * The spawn is the seat's shape: this process's own node binary and the
 * install's tsx, never `npx` (which would fetch tsx from the network when the
 * install is missing; a missing install is a spawn failure dsh logs, and the row
 * stays active with no tools). The child's env is the parent's scrubbed of names
 * holding KEY, SECRET, TOKEN or PASSWORD, with this row's `env` over it. The
 * market's AKShare call is bounded at 120 s, so the call timeout is 130 s. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StdioConfig } from "@deepseek-ai/dsh-mcp-client";
import type { SeatEntryLike } from "./account-seat.ts";
import type { FacePatchList } from "./boot.ts";

export const MARKET_ROW_ID = "mcp-market";
/** The server name, hence the tool prefix `mcp__market__`. */
export const MARKET_SERVER = "market";
export const MARKET_TOOL_PREFIX = `mcp__${MARKET_SERVER}__`;
/** The repo's `market/`, resolved from this module's own location; `FACE_MARKET_DIR` overrides it ({@link marketDir}). */
export const DEFAULT_MARKET_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "market");
export const DEFAULT_MARKET_URL = "http://127.0.0.1:4821";

/** The market's install: `FACE_MARKET_DIR`, or the repo's `market/`. */
export function marketDir(): string {
  return process.env.FACE_MARKET_DIR || DEFAULT_MARKET_DIR;
}

/** The running market service, from the environment or the default. */
export function marketUrl(): string {
  return process.env.FACE_MARKET_URL || DEFAULT_MARKET_URL;
}

/** The `mcp-market` row as it booted: disabled by an operator patch, or its market URL (the row's `env`, patched or the face's own). */
export type MarketRowStanding = { disabled: true } | { disabled: false; url: string };

/** The market row the tree actually composed - an operator patch may have
 * pointed it at another market or disabled it - so the face's market half
 * follows the row, not the environment this module read at boot. A `disabled`
 * getter that throws is read as disabled, as the seat's is. `undefined`: no
 * such row. */
export function composedMarketRow(entries: Iterable<SeatEntryLike>): MarketRowStanding | undefined {
  for (const entry of entries) {
    if (entry.options.id !== MARKET_ROW_ID) continue;
    try {
      if (entry.disabled === true) return { disabled: true };
    } catch {
      return { disabled: true };
    }
    const config = entry.options.config;
    const env = config !== null && typeof config === "object" && "env" in config && config.env !== null && typeof config.env === "object"
      ? (config.env as Record<string, unknown>)
      : {};
    const url = typeof env.MARKET_URL === "string" && env.MARKET_URL !== "" ? env.MARKET_URL : DEFAULT_MARKET_URL;
    return { disabled: false, url };
  }
  return undefined;
}

/** The row. Startup never installs anything: an unavailable market server is
 * logged by dsh and does not take down the chat host. */
export function marketRowPatches(dir = marketDir(), url = marketUrl()): FacePatchList {
  return [{
    insert: [{
      id: MARKET_ROW_ID,
      name: "@deepseek-ai/dsh-mcp-client",
      config: {
        transport: "stdio",
        serverName: MARKET_SERVER,
        command: process.execPath,
        args: [join(dir, "node_modules", "tsx", "dist", "cli.mjs"), "src/mcp.ts"],
        cwd: dir,
        env: { MARKET_URL: url },
        toolCallTimeoutMs: 130_000, /* the market's 120 s AKShare deadline plus margin */
        failOnStartupError: false,
      } satisfies StdioConfig,
    }],
  }];
}
