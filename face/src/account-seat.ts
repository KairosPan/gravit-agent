/** The Account seat: the project-owned MCP row that gives Gravit a seat at
 * Linqi's Account (after linqizhe07/buyer-agent-demo), the service in the
 * repo's `account/`.
 *
 * The Account puts the operator's exchange, broker, wallet and prediction-
 * market accounts on one page at 127.0.0.1:4820 and lets agents trade inside
 * limits the owner signs; its MCP seat (`src/portfolio/mcp.ts`, stdio) is the
 * door every agent uses (its COOKBOOK §11 writes this very dsh row). The face
 * spawns it from the repo's `account/` (`npm ci` there; `FACE_ACCOUNT_SEAT_DIR`
 * names another install) and points it at the service the operator runs
 * (`FACE_ACCOUNT_URL`); the face never starts the service.
 * Composed in the project layer — after dsh-base and the policy layer,
 * before the profile and home patches — so an operator patch can replace its
 * config or disable it (`- { id: mcp-account, disabled: true }`).
 *
 * What the seat does, read at buyer-agent-demo @ 133b9a7:
 * - its key is the Account's, made on its first tool call under
 *   `$BUYER_HOME/seats/<slug>.json` (exclusive create, mode 0600), never read
 *   here; the seat's name is what the Account page shows, so the operator
 *   admits it as Gravit and signs its limit under that name;
 * - it registers its 36 real-account tools even when the service is not
 *   reachable (its startup GET of `/api/account` fails closed to "real"), so a
 *   face booted before the service still carries the tools, and a call then
 *   fails in the seat's own words;
 * - it sets no `instructions`, so no prompt section; its 36 schemas enter the
 *   tool block of every request (DEVELOPMENT.md §4.3 prices them);
 * - `portfolio_wait` polls at most 55 s, and the Account's AKShare sidecar call
 *   is bounded at 120 s, so the seat waits longer: the 130 s call timeout.
 *
 * dsh 0.2.0-rc.2 spawns a stdio server twice per connect (a probe, then the
 * serving process); the probe calls no tool, so the lazily made key is the
 * serving process's. The child's env is the parent's scrubbed of names holding
 * KEY, SECRET, TOKEN or PASSWORD, with this row's `env` spread over it
 * (`@deepseek-ai/dsh-mcp-client/lib/index.js:26-31`). The command is this
 * process's own node binary and the install's tsx (the Account's
 * devDependency; the shape of its own LaunchAgent), never `npx`, which would
 * fetch tsx from the network when the install is missing: a missing install is
 * a spawn failure dsh logs, the row stays active with no tools, and the Account
 * screen's seat box says the service is not reachable. Every seat write is a
 * Gate 2 card first (src/orders.ts), then the Account's own card. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StdioConfig } from "@deepseek-ai/dsh-mcp-client";
import type { FacePatchList } from "./boot.ts";

export const ACCOUNT_SEAT_ROW_ID = "mcp-account";
/** The server name, hence the tool prefix `mcp__account__`: Linqi's own name for the dsh row. */
export const ACCOUNT_SEAT_SERVER = "account";
export const SEAT_TOOL_PREFIX = `mcp__${ACCOUNT_SEAT_SERVER}__`;
/** The seat's name on the Account page; its slug `gravit` names the key file there. */
export const ACCOUNT_SEAT_NAME = "Gravit";
/** The repo's `account/`, the Account service's install, resolved from this module's own location (as
 * `roles.ts` resolves `ROLES_ROOT`); `FACE_ACCOUNT_SEAT_DIR` overrides it ({@link seatDir}). */
export const DEFAULT_SEAT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "account");
export const DEFAULT_SEAT_URL = "http://127.0.0.1:4820";

/** The Account's install: `FACE_ACCOUNT_SEAT_DIR`, or the repo's `account/`. */
export function seatDir(): string {
  return process.env.FACE_ACCOUNT_SEAT_DIR || DEFAULT_SEAT_DIR;
}

/** The running service, from the environment or the default; `/data/seat.json` reads the same. */
export function seatUrl(): string {
  return process.env.FACE_ACCOUNT_URL || DEFAULT_SEAT_URL;
}

/** One Loader entry as the seat box reads it (structural; the Loader's own
 * `Entry` is `@deepseek-ai/cordis-plugin-loader`'s, which the face does not
 * declare): the row's id and its COMPOSED config, and `disabled`, a getter that
 * evaluates `!!js` expressions and so can throw. */
export interface SeatEntryLike {
  options: { id: string; config?: unknown };
  readonly disabled?: boolean;
}

/** The `mcp-account` row as it booted: disabled by an operator patch, or its
 * service URL and seat name (the row's `env`, patched or the face's own). */
export type SeatRowStanding = { disabled: true } | { disabled: false; url: string; seatName: string };

/** The seat row the tree actually composed — an operator patch may have
 * replaced its config (another service, another seat name) or disabled it —
 * so the box and `/data/seat.json` follow the row, not the environment this
 * module read at boot. A `disabled` getter that throws is read as disabled:
 * the row audit refuses such a boot anyway. `undefined`: no such row. */
export function composedSeatRow(entries: Iterable<SeatEntryLike>): SeatRowStanding | undefined {
  for (const entry of entries) {
    if (entry.options.id !== ACCOUNT_SEAT_ROW_ID) continue;
    try {
      if (entry.disabled === true) return { disabled: true };
    } catch {
      return { disabled: true };
    }
    const config = entry.options.config;
    const env = config !== null && typeof config === "object" && "env" in config && config.env !== null && typeof config.env === "object"
      ? (config.env as Record<string, unknown>)
      : {};
    const url = typeof env.PORTFOLIO_URL === "string" && env.PORTFOLIO_URL !== "" ? env.PORTFOLIO_URL : DEFAULT_SEAT_URL;
    const seatName = typeof env.PORTFOLIO_AGENT === "string" && env.PORTFOLIO_AGENT !== "" ? env.PORTFOLIO_AGENT : ACCOUNT_SEAT_NAME;
    return { disabled: false, url, seatName };
  }
  return undefined;
}

/** The row. Startup never installs anything: an unavailable seat is logged by
 * dsh and does not take down the chat host. */
export function accountSeatPatches(dir = seatDir(), url = seatUrl()): FacePatchList {
  return [{
    insert: [{
      id: ACCOUNT_SEAT_ROW_ID,
      name: "@deepseek-ai/dsh-mcp-client",
      config: {
        transport: "stdio",
        serverName: ACCOUNT_SEAT_SERVER,
        command: process.execPath,
        args: [join(dir, "node_modules", "tsx", "dist", "cli.mjs"), "src/portfolio/mcp.ts"],
        cwd: dir,
        env: { PORTFOLIO_URL: url, PORTFOLIO_AGENT: ACCOUNT_SEAT_NAME },
        toolCallTimeoutMs: 130_000, /* the Account's 120 s AKShare deadline plus margin; portfolio_wait's 55 s fits */
        failOnStartupError: false,
      } satisfies StdioConfig,
    }],
  }];
}
