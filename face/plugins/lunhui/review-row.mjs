// face/plugins/lunhui/review-row.mjs
/**
 * `lunhui-review` (modules spec §5.4, §5.5, §5.6, §5.12, A6, A22): the counterevidence module's two
 * tools, `lunhui_read_counterevidence_context({ strategy, run, market_run? })` and
 * `lunhui_submit_counterevidence({ strategy, run, analysis })`, over the contract in
 * `lib/contracts/counterevidence.mjs` - the reviewer's items against the accepted artifacts its
 * context shows, written before the mode; either channel: `cn-market` without `market_run`, any
 * other strategy with it. `lib/module-tool.mjs` holds the shared shape.
 */
import { contract } from "./lib/contracts/counterevidence.mjs";
import { defineModule, moduleDeps } from "./lib/module-tool.mjs";

export const name = "lunhui-review";
export const inject = ["tools", "lunhuiRuns"];

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {unknown} _config
 */
export function apply(ctx, _config) {
  const { runs } = moduleDeps(name, ctx);
  for (const tool of defineModule({ module: "counterevidence", channel: "any", contract, runs }))
    ctx.effect(() => ctx.tools.register(tool));
}
