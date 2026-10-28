/** Gravit's run protocols - prose files under `dsh/profile/` that tell Gravit how to drive a set of
 * tools, each mounted as a section of its own (modules spec A9, §5.10). Two ship, both gated on
 * `lunhui_read_run`, so they are in the prompt only when the Lunhui rows mounted:
 * `lunhui-run.md`, the order of an A-share research run, mounted as `lunhui:run`, and
 * `lunhui-module.md`, how to run one module on a module card's message (modules-cards spec G4),
 * mounted as `lunhui:module` one order step after it and held to its own
 * {@link LUNHUI_MODULE_MAX_BYTES}. {@link readProtocols} reads them where `composeFace` renders Gravit's default preset
 * (src/boot.ts), beside the cycle, and hands them to `gravitRows` (src/roles.ts) as the `gravit`
 * row's `protocols` key; `plugins/gravit.js` registers each as a section a ROOT or FORK session
 * that can call the probe reads - Gravit's, and a `subagent_fork` child's. A role child, a bot or
 * any other delegated child is told nothing.
 *
 * Read as `readCycle` reads `cycle.md` (src/cycle.ts): trimmed, capped at
 * {@link PROTOCOL_MAX_BYTES} raw bytes inclusive, and refused path-first when missing, unreadable,
 * empty or oversized. One refusal more: the section does not interpolate, but a protocol carries
 * no `{{` (spec §5.10), so the text never reads as a template to a later editor.
 * @module
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `dsh/profile/`, resolved from this module, never from the working directory (cycle.ts does the same). */
export const PROTOCOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dsh", "profile");

/** The run protocol's file and section name. */
export const LUNHUI_RUN_FILE = "lunhui-run.md";
export const LUNHUI_RUN_PATH = join(PROTOCOLS_DIR, LUNHUI_RUN_FILE);
export const LUNHUI_RUN_SECTION = "lunhui:run";

/** The single-module protocol's file and section name, and its own budget: under the loader's
 * {@link PROTOCOL_MAX_BYTES}, pinned by tests/protocols.test.ts against the shipped file
 * (modules-cards spec G4). A whole number of three-byte characters, like the loader's. */
export const LUNHUI_MODULE_FILE = "lunhui-module.md";
export const LUNHUI_MODULE_PATH = join(PROTOCOLS_DIR, LUNHUI_MODULE_FILE);
export const LUNHUI_MODULE_SECTION = "lunhui:module";
export const LUNHUI_MODULE_MAX_BYTES = 1500;

/** The largest protocol file, in bytes as `wc -c` counts them (spec §5.10). A whole number of
 * three-byte characters, for tests/protocols.test.ts. */
export const PROTOCOL_MAX_BYTES = 3000;

/** A protocol as the `gravit` row's config carries it: the section's name, the tool whose
 * visibility gates it, and the text. */
export interface Protocol {
  name: string;
  probe: string;
  text: string;
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Every refusal opens with the absolute path of the file it is about, as src/cycle.ts's do. */
const refusal = (file: string, reason: string, cause?: unknown): Error =>
  new Error(`${file}: ${reason}`, cause === undefined ? undefined : { cause });

/** A protocol's text, trimmed. Throws an `Error` whose message opens with the absolute path of
 * `path` when the file is missing, cannot be read, is empty, is over {@link PROTOCOL_MAX_BYTES}
 * (raw bytes, inclusive), or contains `{{`. */
export function readProtocol(path: string): string {
  const file = resolve(path);
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw refusal(file, missing ? "the protocol file is missing" : `cannot be read: ${messageOf(error)}`, error);
  }
  const text = bytes.toString("utf8").trim();
  if (text === "") throw refusal(file, "the protocol is empty");
  if (bytes.length > PROTOCOL_MAX_BYTES) throw refusal(file, `is ${bytes.length} bytes; the limit is ${PROTOCOL_MAX_BYTES}`);
  if (text.includes("{{")) throw refusal(file, "contains {{, which a protocol may not");
  return text;
}

/** Every shipped protocol, read from `dir` (default {@link PROTOCOLS_DIR}; tests point it at a
 * fixture): the run protocol, then the module protocol, both gated on `lunhui_read_run`. The order
 * is the sections' order (plugins/gravit.js). */
export function readProtocols(dir: string = PROTOCOLS_DIR): Protocol[] {
  return [
    { name: LUNHUI_RUN_SECTION, probe: "lunhui_read_run", text: readProtocol(join(dir, LUNHUI_RUN_FILE)) },
    { name: LUNHUI_MODULE_SECTION, probe: "lunhui_read_run", text: readProtocol(join(dir, LUNHUI_MODULE_FILE)) },
  ];
}
