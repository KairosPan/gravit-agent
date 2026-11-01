// face/plugins/lunhui/environment-row.mjs
/**
 * `lunhui-environment` (modules spec §5.4, §5.5, §5.12): the environment module's two tools,
 * `lunhui_read_environment_context({ strategy, run })` and
 * `lunhui_submit_environment({ strategy, run, analysis })`, over the contract in
 * `lib/contracts/environment.mjs` - index and liquidity reported apart, `cn-market` runs only.
 * `lib/module-tool.mjs` holds the shared shape.
 */
import { contract } from "./lib/contracts/environment.mjs";
import { defineModule, moduleDeps } from "./lib/module-tool.mjs";

export const name = "lunhui-environment";
export const inject = ["tools", "lunhuiRuns"];

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {unknown} _config
 */
export function apply(ctx, _config) {
  const { runs } = moduleDeps(name, ctx);
  for (const tool of defineModule({ module: "environment", channel: "market", contract, runs }))
    ctx.effect(() => ctx.tools.register(tool));
}
