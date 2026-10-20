// face/src/desk-names.ts
/** The desk's names, in a leaf module that imports nothing at runtime. src/desk-tools.ts reads the
 * preset id from here rather than from src/desk-preset.ts, which loads src/roles.ts, src/bots.ts and
 * js-yaml: src/desk.ts imports src/desk-tools.ts, and `npm run desk` and scripts/service.ts import
 * src/desk.ts, so the pause switch would otherwise load the bots' and the roles' code to write one
 * file. src/desk-preset.ts re-exports the id, so its importers keep working.
 * @module
 */

/** The desk's preset id. src/bots.ts reserves it, spelling it out rather than importing it
 * (tests/bots.test.ts ties the two spellings). */
export const DESK_PRESET = "gravit-desk";
