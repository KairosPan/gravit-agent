// face/src/desk-names.ts
/** The desk's names, in a leaf module that imports nothing at runtime. src/desk-tools.ts reads the
 * preset id from here rather than from src/desk-preset.ts, which loads src/roles.ts, src/bots.ts and
 * js-yaml: src/desk.ts imports src/desk-tools.ts, and `npm run desk` and scripts/service.ts import
 * src/desk.ts, so the pause switch would otherwise load the bots' and the roles' code to write one
 * file. src/desk-preset.ts re-exports the id, so its importers keep working. The fence's names live here
 * for the same reason: src/desk-session.ts's fence and src/desk-tools.ts's write guard both match them,
 * and src/desk-session.ts re-exports them; the write guard's other agents' instruction files and dot-names
 * are here beside them, and the desk guard's read check compares its key names by the same fold.
 * @module
 */

/** The desk's preset id. src/bots.ts reserves it, importing it from here: a leaf, so no import
 * cycle can read it before it is set (tests/bots.test.ts refuses it as a bot id). */
export const DESK_PRESET = "gravit-desk";

/** The names that steer a desk session from inside its own tree: the workspace instruction files the
 * face's agent-instructions row reads, dsh's project-root marker, and the two project skill roots. */
export const FENCE_NAMES = ["GRAVIT.md", "GRAVIT.local.md", ".git", ".dsh", ".agents"] as const;

/** One of {@link FENCE_NAMES}, as spelled there. */
export type FenceName = (typeof FENCE_NAMES)[number];

/** A name as a case-insensitive volume compares it. macOS's APFS folds case, so dsh's probe,
 * `stat("<dir>/GRAVIT.md")`, opens `Gravit.md` as well - measured on the operator's volume, along with
 * `.GIT` for `.git` and `.dſh` for `.dsh`. Upper, then lower, folds that `ſ` to `s` as the volume
 * does, which lower alone would not. On a case-sensitive volume this matches a few names dsh would not
 * read: the safe side. */
export const foldName = (name: string): string => name.toUpperCase().toLowerCase();

/** Each folded fence name, to its {@link FENCE_NAMES} spelling. */
const FENCED: ReadonlyMap<string, FenceName> = new Map(FENCE_NAMES.map((name) => [foldName(name), name]));

/** The {@link FENCE_NAMES} entry `name` is, compared as {@link foldName} compares it, or `undefined`
 * when it is none: `gravit.md` is `GRAVIT.md`, `GRAVIT.md.bak` is none. */
export function fenceNameOf(name: string): FenceName | undefined {
  return FENCED.get(foldName(name));
}

/** The instruction files the operator's coding agents load from the folder they work in, a file they read
 * there or any folder above it: Claude Code's `CLAUDE.md` and `CLAUDE.local.md`, and Codex's `AGENTS.md` and
 * `AGENTS.override.md`. Those agents have a shell. The desk's write guard denies a desk turn's write of any
 * of them, anywhere below the repository root (src/desk-tools.ts `deskWriteDecision`). */
export const AGENT_FILE_NAMES = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "AGENTS.override.md"] as const;

/** One of {@link AGENT_FILE_NAMES}, as spelled there. */
export type AgentFileName = (typeof AGENT_FILE_NAMES)[number];

/** Each folded agent instruction file name, to its {@link AGENT_FILE_NAMES} spelling. */
const AGENT_FILES: ReadonlyMap<string, AgentFileName> = new Map(AGENT_FILE_NAMES.map((name) => [foldName(name), name]));

/** The {@link AGENT_FILE_NAMES} entry `name` is, compared as {@link foldName} compares it, or `undefined`
 * when it is none: `claude.md` is `CLAUDE.md`, `CLAUDE.md.bak` is none. */
export function agentFileNameOf(name: string): AgentFileName | undefined {
  return AGENT_FILES.get(foldName(name));
}

/** Whether `name` - one name of a path, never empty and never `.` - is a dot-file's or a dot-directory's: it
 * begins with a dot and is not `..`, the way up. */
export const isDotName = (name: string): boolean => name.startsWith(".") && name !== "..";
