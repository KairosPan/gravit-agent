// face/plugins/lunhui/mode-row.mjs
/**
 * `lunhui-mode` (modules spec §5.4, §5.5, §5.6, A5, A6, A12, A18, A22, E4): the mode module's two
 * tools, `lunhui_read_mode_context({ strategy, run, market_run })` and
 * `lunhui_submit_mode({ strategy, run, analysis })`, over the contract in
 * `lib/contracts/mode.mjs` - S01, S02 or WAIT as a daily registration with an expectation card,
 * graded in the strategy's next run; strategy runs only. `lib/module-tool.mjs` holds the shared
 * shape.
 */
import { contract } from "./lib/contracts/mode.mjs";
import { defineModule, moduleDeps } from "./lib/module-tool.mjs";

export const name = "lunhui-mode";
export const inject = ["tools", "lunhuiRuns"];

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {unknown} _config
 */
export function apply(ctx, _config) {
  const { runs } = moduleDeps(name, ctx);
  for (const tool of defineModule({ module: "mode", channel: "strategy", contract, runs }))
    ctx.effect(() => ctx.tools.register(tool));
}
