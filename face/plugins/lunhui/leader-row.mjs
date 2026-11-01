// face/plugins/lunhui/leader-row.mjs
/**
 * `lunhui-leader` (modules spec §5.4, §5.5, §5.12, A27): the leader module's two tools,
 * `lunhui_read_leader_context({ strategy, run, market_run })` and
 * `lunhui_submit_leader({ strategy, run, analysis })`, over the contract in
 * `lib/contracts/leader.mjs` - candidates ranked within the cited `cn-market` run, each a frozen
 * quote and a frozen pool row or member; strategy runs only. `lib/module-tool.mjs` holds the
 * shared shape.
 */
import { contract } from "./lib/contracts/leader.mjs";
import { defineModule, moduleDeps } from "./lib/module-tool.mjs";

export const name = "lunhui-leader";
export const inject = ["tools", "lunhuiRuns"];

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {unknown} _config
 */
export function apply(ctx, _config) {
  const { runs } = moduleDeps(name, ctx);
  for (const tool of defineModule({ module: "leader", channel: "strategy", contract, runs }))
    ctx.effect(() => ctx.tools.register(tool));
}
