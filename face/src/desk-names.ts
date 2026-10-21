// face/src/desk-names.ts
/** The desk's names, in a leaf module that imports nothing at runtime. src/desk-tools.ts reads the
 * preset id from here rather than from src/desk-preset.ts, which loads src/roles.ts, src/bots.ts and
 * js-yaml: src/desk.ts imports src/desk-tools.ts, and `npm run desk` and scripts/service.ts import
 * src/desk.ts, so the pause switch would otherwise load the bots' and the roles' code to write one
 * file. src/desk-preset.ts re-exports the id, so its importers keep working. The fence's names live here
 * for the same reason: src/desk-session.ts's fence and src/desk-tools.ts's write guard both match them,
 * and src/desk-session.ts re-exports them.
 * @module
 */

/** The desk's preset id. src/bots.ts reserves it, spelling it out rather than importing it
 * (tests/bots.test.ts ties the two spellings). */
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
