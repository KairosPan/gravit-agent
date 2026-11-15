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
 * {@link namedMemoryHome} keeps a second face off it: a face on a scratch harness home opens no
 * memory unless a home is named.
 * @module
 */
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
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
const SAY_NO_HOME = "the memory is not connected: this face runs on a scratch harness home and no memory home is named";
/** The one line a face on a scratch harness home that names no memory home logs at boot (src/boot.ts). */
export const MEMORY_NO_HOME_NOTICE = `${SAY_NO_HOME}; set FACE_MEMORY_HOME to name one`;
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

/**
 * The home a face on harness home `dshHome` may open, or `undefined` when it may open none. A home named by
 * `FACE_MEMORY_HOME` or `GRAVIT_MEMORY_HOME` is {@link memoryHome}'s, whatever the harness home. With neither named,
 * the memory's default home belongs to the harness's default one: the face on the home the harness itself resolves
 * with no `DSH_HOME` (asked of its own resolver, with an empty environment; the two compared by real path) - the
 * installed service, the daily start - gets it, and a face on any other harness home, a second face on a scratch one,
 * gets none, so it never opens, writes or reconciles the operator's real memory. The one rule the row's builder
 * (src/memory-row.ts `memoryRowPatches`) and the opener ({@link openFaceMemory}) both follow. It never throws: a
 * real path that cannot be resolved (a user home that cannot be entered, say) is read as "not the default", so the
 * face connects to nothing and says so, and nothing fails a boot over the memory.
 */
export function namedMemoryHome(dshHome: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.FACE_MEMORY_HOME || env.GRAVIT_MEMORY_HOME) return memoryHome(env);
  try {
    const harnessDefault = realPathOrAncestor(resolveDshHome(undefined, {}));
    return realPathOrAncestor(resolve(dshHome)) === harnessDefault ? memoryHome(env) : undefined;
  } catch {
    return undefined;
  }
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

/** A home as a refusal shows it, with no account name: from the user's home (`~/.gravit-memory`) when it lies under
 *  it, else its last two path segments after `…/`. */
function shownHome(home: string): string {
  const user = resolve(homedir());
  if (isUnder(home, user)) return `~/${relative(user, home).split(sep).join("/")}`;
  return `…/${[basename(dirname(home)), basename(home)].filter(Boolean).join("/")}`;
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
  throw new Error(
    `memory home ${shownHome(written)} refused: it is outside the temporary directory, and a test never opens a real memory - ` +
      "import tests/helpers/no-memory.ts",
  );
}

/** Where the face stands with the memory: connected, with the library's handle and its home, or
 *  not, with why and the words that say so. */
export type MemoryStanding =
  | { connected: true; memory: Memory; home: string }
  | { connected: false; why: "disabled" | "no install" | "no home named"; say: string };

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
 *  ({@link assertHomeAllowed}); then, when no home is given, {@link namedMemoryHome}'s rule on the
 *  harness home (`dshHome`, else the one `env` resolves): a face on a scratch harness home that
 *  names no memory home is the standing "no home named", and nothing is loaded or opened. A
 *  disabled row or a missing install is a standing too, never a throw. Opening reads nothing: a
 *  home nobody made answers {@link NO_MEMORY_HERE} on its first read. */
export async function openFaceMemory(
  opts: { dir?: string; home?: string; dshHome?: string; disabled?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<MemoryStanding> {
  const env = opts.env ?? process.env;
  assertHomeAllowed(opts.home ?? memoryHome(env), env);
  const home = opts.home ?? namedMemoryHome(opts.dshHome ?? resolveDshHome(undefined, env), env);
  if (home === undefined) return { connected: false, why: "no home named", say: SAY_NO_HOME };
  if (opts.disabled) return { connected: false, why: "disabled", say: SAY_DISABLED };
  const library = await loadLibrary(opts.dir ?? memoryDir(env));
  if (!library) return { connected: false, why: "no install", say: SAY_NO_INSTALL };
  return { connected: true, memory: library.openMemory(home), home };
}

/** The opener of the memory as the tree composed its row - what `composedMemoryRow` gives
 *  (src/memory-row.ts), typed here by its shape alone: a disabled row, or no such row, is the
 *  disabled standing - or, on a scratch harness home naming no memory home, where the builder
 *  composed no row, "no home named" ({@link namedMemoryHome}); otherwise the row's install and home
 *  are opened. Built once by main.ts and handed to the owner-name fence (bound through
 *  `BootedFace.bindMemoryFence`, src/memory-guard.ts), the reconcile clock and the brief, so all
 *  three follow the row an operator patch may have re-pointed or disabled, not the environment. */
export function memoryOpener(
  row: { disabled: true } | { disabled: false; dir: string; home: string } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): () => Promise<MemoryStanding> {
  return () =>
    row === undefined || row.disabled
      ? openFaceMemory({ disabled: true, env })
      : openFaceMemory({ dir: row.dir, home: row.home, env });
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
