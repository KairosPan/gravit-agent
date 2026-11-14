// face/src/memory.ts
/** The memory: the face's own handle on gravit-memory, the operator's trading memory (ledgers
 * and lesson cards in a home directory), a pinned dependency at {@link MEMORY_COMMIT}.
 *
 * The face's code opens the memory through {@link openFaceMemory} and writes as
 * {@link FACE_MEMORY_NAME}; every model inside the face reaches it through the row and writes as
 * {@link AGENT_MEMORY_NAME}. The library is loaded by a dynamic import from the install's own
 * directory ({@link memoryDir}), once per directory, so a missing or unbuilt install is a
 * standing - "the memory is not connected" - and never a boot failure. Types come from the
 * package by `import type` alone. The face never makes the home and reads none of its files:
 * everything goes through the library.
 *
 * {@link assertHomeAllowed} keeps a test off a real memory: in a test process a home whose real
 * path is not under the system's temporary directory is refused, before anything is read.
 * @module
 */
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Memory } from "gravit-memory";

/** The commit of gravit-memory's tag v0.2.0, the one `package.json` pins. */
export const MEMORY_COMMIT = "a55480ea98550de0c842c4dcac06edaaf6d06990";
/** Who the face's own code is, to the memory. */
export const FACE_MEMORY_NAME = "gravit-face";
/** Who every model inside the face is, to the memory, through the row. */
export const AGENT_MEMORY_NAME = "gravit";
/** The install beside the face: `face/node_modules/gravit-memory`, from this module's location. */
export const DEFAULT_MEMORY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "gravit-memory");
/** What the package's door answers when no home was made, word for word. */
export const NO_MEMORY_HERE = "no memory here: run gravit-memory init";

const SAY_DISABLED = "the memory is not connected: the mcp-memory row is disabled";
const SAY_NO_INSTALL = "the memory is not connected: gravit-memory is not installed";
/** The longest fault {@link memoryFaultWords} gives, in characters. */
const FAULT_MAX = 200;

/** The install's directory: `FACE_MEMORY_DIR`, else {@link DEFAULT_MEMORY_DIR}. */
export function memoryDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.FACE_MEMORY_DIR || DEFAULT_MEMORY_DIR;
}

/** The memory's home: `FACE_MEMORY_HOME`, else `GRAVIT_MEMORY_HOME`, else the package's default,
 *  `~/.gravit-memory`. */
export function memoryHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.FACE_MEMORY_HOME || env.GRAVIT_MEMORY_HOME || join(homedir(), ".gravit-memory");
}

/** Whether this process is a test's: node's test runner sets `NODE_TEST_CONTEXT` in the process
 *  it runs a file in, and a smoke is started with `FACE_SMOKE`. */
export function isTestProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NODE_TEST_CONTEXT || env.FACE_SMOKE);
}

/** Whether `path` lies strictly under `root`; both absolute, compared by node:path's own rules
 *  (case-blind on Windows, across a drive letter never under). */
function isUnder(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** The real path of `path`, or of its nearest ancestor that exists with the rest joined on, so a
 *  directory not made yet is judged by where it would be. */
function realPathOrAncestor(path: string): string {
  const rest: string[] = [];
  for (let at = path; ; at = dirname(at)) {
    try {
      return join(realpathSync.native(at), ...rest);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "ENOENT" && code !== "ENOTDIR") || dirname(at) === at) throw error;
      rest.unshift(basename(at));
    }
  }
}

/** Throws, in a test process, when `home` is not under the system's temporary directory; outside
 *  a test process it allows everything. A home that is not under the temporary directory even
 *  as written is refused without touching the filesystem; one that is, by its real path, so a
 *  link out of the temporary directory is refused too. */
export function assertHomeAllowed(home: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!isTestProcess(env)) return;
  const written = resolve(home);
  const tmp = resolve(tmpdir());
  const realTmp = realpathSync.native(tmp);
  const allowed =
    (isUnder(written, tmp) || isUnder(written, realTmp)) && isUnder(realPathOrAncestor(written), realTmp);
  if (allowed) return;
  const shown = [basename(dirname(written)), basename(written)].filter(Boolean).join("/");
  throw new Error(
    `memory home …/${shown} refused: it is outside the temporary directory, and a test never opens a real memory - ` +
      "import tests/helpers/no-memory.ts",
  );
}

/** Where the face stands with the memory: connected, with the library's handle and its home, or
 *  not, with why and the words that say so. */
export type MemoryStanding =
  | { connected: true; memory: Memory; home: string }
  | { connected: false; why: "disabled" | "no install"; say: string };

type MemoryLibrary = { openMemory: (home: string) => Memory };

/** The library's load per install directory: the module, or null when it cannot be loaded. */
const libraries = new Map<string, Promise<MemoryLibrary | null>>();

/** Loads the library from `dir`'s `dist/index.js`, once per directory; a failed load is null and
 *  logs nothing (the caller says it). */
function loadLibrary(dir: string): Promise<MemoryLibrary | null> {
  const key = resolve(dir);
  let load = libraries.get(key);
  if (!load) {
    load = import(pathToFileURL(join(key, "dist", "index.js")).href).then(
      (mod: Partial<MemoryLibrary>) => (typeof mod.openMemory === "function" ? (mod as MemoryLibrary) : null),
      () => null,
    );
    libraries.set(key, load);
  }
  return load;
}

/** Opens the memory for the face's own code. The home is guarded first
 *  ({@link assertHomeAllowed}); a disabled row or a missing install is a standing, not a throw.
 *  Opening reads nothing: a home nobody made answers {@link NO_MEMORY_HERE} on its first read. */
export async function openFaceMemory(
  opts: { dir?: string; home?: string; disabled?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<MemoryStanding> {
  const env = opts.env ?? process.env;
  const home = opts.home ?? memoryHome(env);
  assertHomeAllowed(home, env);
  if (opts.disabled) return { connected: false, why: "disabled", say: SAY_DISABLED };
  const library = await loadLibrary(opts.dir ?? memoryDir(env));
  if (!library) return { connected: false, why: "no install", say: SAY_NO_INSTALL };
  return { connected: true, memory: library.openMemory(home), home };
}

/** The opener of the memory as the tree composed its row - what `composedMemoryRow` gives
 *  (src/memory-row.ts), typed here by its shape alone: a disabled row, or no such row, is the
 *  disabled standing; otherwise the row's install and home are opened. Built once by main.ts and
 *  handed to the reconcile clock and the brief, so both follow the row an operator patch may have
 *  re-pointed or disabled, not the environment. */
export function memoryOpener(
  row: { disabled: true } | { disabled: false; dir: string; home: string } | undefined,
): () => Promise<MemoryStanding> {
  return () =>
    row === undefined || row.disabled ? openFaceMemory({ disabled: true }) : openFaceMemory({ dir: row.dir, home: row.home });
}

/** A memory fault in words: {@link NO_MEMORY_HERE} for an error whose `code` is `E_NO_HOME` -
 *  judged by the code it carries, since the library is loaded from the install's own path and
 *  its `MemoryError` is not this module's to `instanceof` - else the error's message as one line
 *  of at most 200 characters. */
export function memoryFaultWords(error: unknown): string {
  if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "E_NO_HOME") {
    return NO_MEMORY_HERE;
  }
  const message = error instanceof Error ? error.message : String(error);
  const line = message.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const chars = Array.from(line);
  return chars.length <= FAULT_MAX ? line : `${chars.slice(0, FAULT_MAX - 1).join("")}…`;
}
