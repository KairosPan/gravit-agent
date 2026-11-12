/** The read-through rows: which rivals a company's own bad news points to,
 * Gravit's inference and never an order, as in-process dsh rows - boot.ts
 * composes them right after the analog rows, in the same project layer, below
 * everything the operator writes, so an operator row with one of these ids
 * replaces that row's config (a replacement restates `recordDir`) and
 * `disabled: true` removes it.
 *
 * Two cordis file-plugin rows under `face/plugins/readthrough/`, in one insert:
 * `read-through-service`, the backbone that provides the `readThrough` service
 * (the record under `$DSH_HOME/face/readthrough`, the annotation runs open now,
 * and the face's half once wired), then `read-through-tool`, injecting `tools`
 * and `readThrough`, which registers `read_through`. The tool is registered
 * tree-wide, as dsh's own are; no bot's allow list names it
 * (`tests/bots.test.ts`), the desk's mask does (src/desk-preset.ts), and the
 * row refuses a desk agent's call outside an annotation run. */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FacePatchList } from "./boot.ts";

export const READ_THROUGH_ROW_IDS = ["read-through-service", "read-through-tool"] as const;

/** The tools the rows register, in row order. */
export const READ_THROUGH_TOOL_NAMES = ["read_through"] as const;

/** `face/plugins/readthrough/`, beside this file's `src/`. */
const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "readthrough");

/** The rows: each `name` the absolute file URL of its plugin file
 * (`read-through-service` → `service-row.mjs`, `read-through-tool` →
 * `tool-row.mjs`); `home` is the harness home, `$DSH_HOME`. */
export function readThroughPatches(home: string): FacePatchList {
  return [{
    insert: READ_THROUGH_ROW_IDS.map((id) => ({
      id,
      name: pathToFileURL(join(PLUGIN_DIR, `${id.slice("read-through-".length)}-row.mjs`)).href,
      config: id === "read-through-service" ? { recordDir: join(home, "face", "readthrough") } : {},
    })),
  }];
}
