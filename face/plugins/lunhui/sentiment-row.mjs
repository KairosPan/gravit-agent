// face/plugins/lunhui/sentiment-row.mjs
/**
 * `lunhui-sentiment` (modules spec §5.4, §5.5, §5.12): the sentiment module's two tools,
 * `lunhui_read_sentiment_context({ strategy, run })` and
 * `lunhui_submit_sentiment({ strategy, run, analysis })`, over the contract in
 * `lib/contracts/sentiment.mjs` - the seven states, cited from the pools and the index,
 * `cn-market` runs only. `lib/module-tool.mjs` holds the shared shape.
 */
import { contract } from "./lib/contracts/sentiment.mjs";
import { defineModule, moduleDeps } from "./lib/module-tool.mjs";

export const name = "lunhui-sentiment";
export const inject = ["tools", "lunhuiRuns"];

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {unknown} _config
 */
export function apply(ctx, _config) {
  const { runs } = moduleDeps(name, ctx);
  for (const tool of defineModule({ module: "sentiment", channel: "market", contract, runs }))
    ctx.effect(() => ctx.tools.register(tool));
}
