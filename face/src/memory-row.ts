/** The memory row: the project-owned MCP row that gives every model inside the
 * face the operator's trading memory - gravit-memory's stdio door (`dist/cli.js
 * mcp`), installed beside the face (`face/node_modules/gravit-memory`;
 * `FACE_MEMORY_DIR` names another install, src/memory.ts).
 *
 * The door runs as the agent `gravit` over the owner's home (`FACE_MEMORY_HOME`,
 * else `GRAVIT_MEMORY_HOME`, else `~/.gravit-memory` - the default for a face on
 * the harness's default home alone: on a scratch harness home naming neither
 * variable there is no row, src/memory.ts `namedMemoryHome`): seven tools, from
 * `memory_recall` to `memory_status`. Under the server name `memory` they are
 * `mcp__memory__…`, which is not under the seat's prefix, so Gate 2 never cards
 * one (src/orders.ts). The child is local and reaches no network; a home nobody
 * made is no failure - each tool answers "no memory here" - and the face never
 * makes it. In a test process the home is judged before the row is written
 * ({@link assertHomeAllowed}): one outside the temporary directory throws, so a
 * test that boots a face without `tests/helpers/no-memory.ts` fails loudly.
 *
 * Composed in the project layer right after the market row (src/boot.ts), below
 * the profile and home patches, so an operator patch can re-point it or disable
 * it (`- { id: mcp-memory, disabled: true }`) without touching the market's.
 *
 * The spawn is the market's shape: this process's own node binary and the
 * install's built `dist/cli.js`, never `npx`; a missing install is a spawn
 * failure dsh logs, and the row stays active with no tools. A reconcile reads
 * several symbols at ten seconds each at worst, so the call timeout is 60 s. */
import { dirname, join } from "node:path";
import type { StdioConfig } from "@deepseek-ai/dsh-mcp-client";
import type { SeatEntryLike } from "./account-seat.ts";
import type { FacePatchList } from "./boot.ts";
import { AGENT_MEMORY_NAME, assertHomeAllowed, memoryDir, memoryHome, namedMemoryHome } from "./memory.ts";

export const MEMORY_ROW_ID = "mcp-memory";
/** The server name, hence the tool prefix `mcp__memory__`. */
export const MEMORY_SERVER = "memory";
export const MEMORY_TOOL_PREFIX = `mcp__${MEMORY_SERVER}__`;
/** The door's seven tools, by their raw names. */
export const MEMORY_TOOLS = ["memory_recall", "memory_record", "memory_amend", "memory_propose", "memory_reconcile",
  "memory_review", "memory_status"] as const;

/** The `mcp-memory` row as it booted: disabled by an operator patch, or the install and the home its args name. */
export type MemoryRowStanding = { disabled: true } | { disabled: false; dir: string; home: string };

/** The memory row the tree actually composed - an operator patch may have
 * re-pointed its install or its home, or disabled it - so the face follows the
 * row, not the environment this module read at boot. A `disabled` getter that
 * throws is read as disabled, as the seat's is. The home is the argument after
 * `--home`, the install two directories above the first argument (its
 * `dist/cli.js`). `undefined`: no such row. */
export function composedMemoryRow(entries: Iterable<SeatEntryLike>): MemoryRowStanding | undefined {
  for (const entry of entries) {
    if (entry.options.id !== MEMORY_ROW_ID) continue;
    try {
      if (entry.disabled === true) return { disabled: true };
    } catch {
      return { disabled: true };
    }
    const config = entry.options.config;
    const args = config !== null && typeof config === "object" && "args" in config && Array.isArray(config.args)
      ? (config.args as unknown[])
      : [];
    const cli = typeof args[0] === "string" && args[0] !== "" ? args[0] : join(memoryDir(), "dist", "cli.js");
    const at = args.indexOf("--home");
    const home = at >= 0 && typeof args[at + 1] === "string" && args[at + 1] !== "" ? (args[at + 1] as string) : memoryHome();
    return { disabled: false, dir: dirname(dirname(cli)), home };
  }
  return undefined;
}

/** The row, for a face on harness home `dshHome`. In a test process the home
 * is judged first and throws what {@link assertHomeAllowed} throws; then
 * {@link namedMemoryHome}'s rule: on a scratch harness home that names no
 * memory home there is no row (an empty list), so nothing is spawned over the
 * default home and src/boot.ts says so once. Startup never installs anything
 * and never makes the home. */
export function memoryRowPatches(
  dshHome: string,
  opts: { dir?: string; env?: NodeJS.ProcessEnv } = {},
): FacePatchList {
  const env = opts.env ?? process.env;
  assertHomeAllowed(memoryHome(env), env);
  const home = namedMemoryHome(dshHome, env);
  if (home === undefined) return [];
  const dir = opts.dir ?? memoryDir(env);
  return [{
    insert: [{
      id: MEMORY_ROW_ID,
      name: "@deepseek-ai/dsh-mcp-client",
      config: {
        transport: "stdio",
        serverName: MEMORY_SERVER,
        command: process.execPath,
        args: [join(dir, "dist", "cli.js"), "mcp", "--as", AGENT_MEMORY_NAME, "--home", home],
        toolCallTimeoutMs: 60_000, /* a reconcile reads several symbols at ten seconds each at worst */
        failOnStartupError: false,
      } satisfies Omit<StdioConfig, "env" | "cwd">, /* both optional on input; the door needs neither */
    }],
  }];
}
