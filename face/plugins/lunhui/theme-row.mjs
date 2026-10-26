// face/plugins/lunhui/theme-row.mjs
/**
 * `lunhui-theme` (modules spec §5.4, §5.5, §5.12): the theme module's two tools,
 * `lunhui_read_theme_context({ strategy, run })` and
 * `lunhui_submit_theme({ strategy, run, analysis })`, over the contract in
 * `lib/contracts/theme.mjs` - mainline candidates cited from frozen boards and members,
 * `cn-market` runs only. `lib/module-tool.mjs` holds the shared shape.
 */
import { contract } from "./lib/contracts/theme.mjs";
import { defineModule, moduleDeps } from "./lib/module-tool.mjs";

export const name = "lunhui-theme";
export const inject = ["tools", "lunhuiRuns"];

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {unknown} _config
 */
export function apply(ctx, _config) {
  const { runs } = moduleDeps(name, ctx);
  for (const tool of defineModule({ module: "theme", channel: "market", contract, runs }))
    ctx.effect(() => ctx.tools.register(tool));
}
