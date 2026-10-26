/** The Lunhui rows: A-share research as in-process dsh rows (modules spec
 * §5.12), the project layer's third member - boot.ts composes them right after
 * the Account seat's row, after dsh-base and the face's policy defaults and
 * before the profile and home patches, so an operator row with one of these
 * ids replaces that row's config (a replacement restates `strategiesRoot`) and
 * `disabled: true` removes it.
 *
 * Five cordis file-plugin rows under `face/plugins/lunhui/`, in one insert:
 * `lunhui-runs`, the backbone that provides the `lunhuiRuns` service and
 * registers `lunhui_read_run`, then the four freeze rows, each injecting
 * `tools` and `lunhuiRuns` and registering one tool. The tools are registered
 * tree-wide, as dsh's own are; no bot's allow list names one
 * (`tests/bots.test.ts`). A freeze row takes no config in production: its
 * `fetch` and `now` keys are test-only. */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FacePatchList } from "./boot.ts";

export const LUNHUI_ROW_IDS = [
  "lunhui-runs", "lunhui-freeze-quotes", "lunhui-freeze-limit-up", "lunhui-freeze-boards", "lunhui-freeze-index",
] as const;

/** The five tools the rows register, the backbone's first. */
export const LUNHUI_TOOL_NAMES = [
  "lunhui_read_run", "lunhui_freeze_quotes", "lunhui_freeze_limit_up", "lunhui_freeze_boards", "lunhui_freeze_index",
] as const;

/** `face/plugins/lunhui/`, beside this file's `src/`. */
const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "lunhui");

/** The checkout this file lives in, so a worktree boots its own `strategies/`. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The rows: each `name` the absolute file URL of its plugin file (`lunhui-runs`
 * → `runs-row.mjs`, `lunhui-freeze-quotes` → `freeze-quotes-row.mjs`, ...). */
export function lunhuiPatches(repoRoot = REPO_ROOT): FacePatchList {
  return [{
    insert: LUNHUI_ROW_IDS.map((id) => ({
      id,
      name: pathToFileURL(join(PLUGIN_DIR, `${id.slice("lunhui-".length)}-row.mjs`)).href,
      config: id === "lunhui-runs" ? { strategiesRoot: join(repoRoot, "strategies") } : {},
    })),
  }];
}
