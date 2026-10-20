/** Gravit's research-cycle contract - `dsh/profile/cycle.md`, the one file that tells Gravit how
 * to run a cycle: one batched question, then a goal-driven loop of role calls to a verdict (spec
 * §6). {@link readCycle} reads it where `composeFace` renders Gravit's default preset
 * (src/boot.ts) and hands the text to `gravitRows` (src/roles.ts) as the `gravit` row's `cycle`
 * key, which `plugins/gravit.js` turns into the `gravit:cycle` section of every prompt a ROOT or
 * FORK session that can call `create_goal` assembles: Gravit's, and a `subagent_fork` child's. A
 * role child, or any other delegated child, is told nothing.
 *
 * Unlike the persona (src/persona.ts), the text is NOT a template. The section registers with
 * `interpolate: false`, so a `{{...}}` group in it is literal prose, not an unknown variable that
 * would fail every step of every session; the reader therefore checks the size and nothing else.
 *
 * The text rides in every request Gravit makes, so it is capped at {@link CYCLE_MAX_BYTES} bytes,
 * the prompt budget of spec §7. A missing file, an unreadable one, an empty one and an oversized
 * one are refused where the file is read, each with its absolute path first (src/roles.ts refuses
 * a role file the same way), so a boot names the file at fault instead of shipping a Gravit with
 * no contract or a heavier prompt than was budgeted.
 *
 * The desk's contract, `dsh/profile/desk.md` - the `gravit:desk` section (plugins/gravit.js) - is
 * read the same way: {@link readDesk} shares {@link readCycle}'s private reader, so it is refused for
 * the same faults, path first, under its own cap, {@link DESK_MAX_BYTES}.
 * @module
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolved from this module, never from the working directory (persona.ts does the same). */
export const CYCLE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dsh", "profile", "cycle.md");

/** The largest `cycle.md`, in bytes as `wc -c` counts them. */
export const CYCLE_MAX_BYTES = 3000;

/** Beside `cycle.md`, resolved from this module the same way. */
export const DESK_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dsh", "profile", "desk.md");

/** The largest `desk.md`, in bytes as `wc -c` counts them. */
export const DESK_MAX_BYTES = 3000;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Every refusal opens with the absolute path of the file it is about, as src/roles.ts's do. */
const refusal = (file: string, reason: string, cause?: unknown): Error =>
  new Error(`${file}: ${reason}`, cause === undefined ? undefined : { cause });

/** The contract at `path`, trimmed - the one reader behind {@link readCycle} and {@link readDesk}, so
 * the two refuse alike. `max` is the cap in raw bytes, inclusive; `label` names the contract in a
 * refusal. */
function readContract(path: string, max: number, label: string): string {
  const file = resolve(path);
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw refusal(file, missing ? `the ${label} file is missing` : `cannot be read: ${messageOf(error)}`, error);
  }
  const text = bytes.toString("utf8").trim();
  if (text === "") throw refusal(file, `the ${label} is empty`);
  if (bytes.length > max) throw refusal(file, `is ${bytes.length} bytes; the limit is ${max}`);
  return text;
}

/** The cycle text, trimmed. Throws an `Error` whose message opens with the absolute path of `path`
 * when the file is missing, cannot be read, is empty, or is over {@link CYCLE_MAX_BYTES}. The cap
 * is on the file's raw bytes, not the trimmed text's, and is inclusive: exactly the limit is
 * accepted. Braces are allowed: the section does not interpolate. */
export function readCycle(path: string): string {
  return readContract(path, CYCLE_MAX_BYTES, "cycle");
}

/** The desk's contract, trimmed, refused as {@link readCycle} refuses - the absolute path of `path`
 * first - when the file is missing, cannot be read, is empty, or is over {@link DESK_MAX_BYTES},
 * counted in raw bytes and inclusive, as the cycle's cap is. Braces are allowed: the section does
 * not interpolate. */
export function readDesk(path: string): string {
  return readContract(path, DESK_MAX_BYTES, "desk contract");
}
