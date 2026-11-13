/** The analog rows: past events like a stock's present news, measured, as
 * in-process dsh rows - boot.ts composes them right after the Lunhui rows, in
 * the same project layer, below everything the operator writes, so an operator
 * row with one of these ids replaces that row's config (a replacement restates
 * `viewsDir`) and `disabled: true` removes it.
 *
 * Two cordis file-plugin rows under `face/plugins/analog/`, in one insert:
 * `analog-views`, the backbone that provides the `analogViews` service (the
 * keep of daily histories read through the market, the record of the web
 * pages a reader opened, and the view store under
 * `$DSH_HOME/face/analog/views`), then `analog-events`, injecting `tools` and
 * `analogViews`, which registers `analog_events`. The tool is registered
 * tree-wide, as dsh's own are; no bot's allow list names it
 * (`tests/bots.test.ts`), and the conversation's and the desk's presets carry
 * their own allow lists. */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FacePatchList } from "./boot.ts";

export const ANALOG_ROW_IDS = ["analog-views", "analog-events"] as const;

/** The tools the rows register, in row order. */
export const ANALOG_TOOL_NAMES = ["analog_events"] as const;

/** `face/plugins/analog/`, beside this file's `src/`. */
const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "analog");

/** The rows: each `name` the absolute file URL of its plugin file (`analog-views`
 * → `views-row.mjs`, `analog-events` → `events-row.mjs`); `home` is the harness
 * home, `$DSH_HOME`. */
export function analogPatches(home: string): FacePatchList {
  return [{
    insert: ANALOG_ROW_IDS.map((id) => ({
      id,
      name: pathToFileURL(join(PLUGIN_DIR, `${id.slice("analog-".length)}-row.mjs`)).href,
      config: id === "analog-views" ? { viewsDir: join(home, "face", "analog", "views") } : {},
    })),
  }];
}
