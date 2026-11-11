// face/plugins/analog/chart-row.mjs
/**
 * `analog-chart`: `analog_chart`, past sell-offs like a US stock's present one. `execute`, in order: `NOT_GRAVIT`
 * for a delegated child; the scan (`analogViews.scanChart`); the view stored (`analogViews.writeView`); then the reply
 * `{ ok, view, digest }`, the digest built from the scan's own view under the stored id, so the numbers it quotes are
 * the scan's whatever the store trimmed. Every refusal throws through `asToolError`.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { chartDigest } from "./lib/digest.mjs";
import { asToolError, callerIsChild, refuse } from "./lib/errors.mjs";

export const name = "analog-chart";
export const inject = ["tools", "analogViews"];

export const CHART_DESCRIPTION =
  "Past sell-offs like this one. For a US-listed stock that is falling, finds the past stretches most like its present sell-off, by depth, speed, gaps and volume and not by the shape of the line, in its own history and in a fixed list of large US companies, and what each did over the next 60 sessions. Answers a digest (coverage, groups, the leading cases) and the id of a view; the page draws the charts from the view, so quote numbers from the digest only. It matches sell-offs only: a stock less than 10% below its 60-session high is refused NOT_A_SELLOFF. The first scan of a trading day reads history for a few minutes. A reading of the past with no lookahead guard: never evidence for a trade, never a forecast, never a recommendation.";

/** The parameters, in the dsh DSL. Their checks are the scan's. */
const PARAMETERS = {
  symbol: { type: "string", description: "a US ticker, such as NVDA", required: true },
  as_of: { type: "string", description: "optional date YYYY-MM-DD: every history is cut at that date first; default the latest bar" },
  also: { type: "array", items: { type: "string" }, description: "optional, at most 20 more US tickers to scan beside the fixed list" },
};

/**
 * @param {any} ctx the row's context, injecting `tools` and `analogViews`
 */
export function apply(ctx) {
  const service = ctx?.analogViews;
  if (service === undefined || service === null) throw new Error(`${name}: analogViews is missing; mount the analog-views row first`);
  ctx.effect(() => ctx.tools.register(defineTool({
    name: "analog_chart",
    description: CHART_DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: "string" },
      render: (_args, result) => [{ type: "text", text: result }],
    },
    async execute(args, exec) {
      try {
        if (callerIsChild(exec)) throw refuse.notGravit();
        const view = await service.scanChart({ symbol: args.symbol, asOf: args.as_of, also: args.also });
        const { id } = await service.writeView(view);
        return JSON.stringify({ ok: true, view: id, digest: chartDigest({ ...view, id }) });
      } catch (error) {
        throw asToolError(error);
      }
    },
  })));
}
