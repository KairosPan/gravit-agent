// face/plugins/lunhui/present-row.mjs
/**
 * `lunhui-present` (run view spec §5.2, M15, M16, M20): `lunhui_present`, Gravit's composed answer
 * to a market run. Gravit names the run, writes a one- or two-sentence summary and picks, orders,
 * titles and focuses blocks from the face's catalog (`PRESENT_KINDS`); the face draws every number
 * from the run's view. The tool checks the composition against the same view the route serves and
 * its digest (`checkPresent`) and, on ok, ends Gravit's turn: the answer is the drawn composition.
 *
 * `execute`, in order: `NOT_GRAVIT` for a delegated child; the run's manifest (`readRun`);
 * `NOT_A_MARKET_RUN` for a strategy run (`checkPresent` keeps its own guard); a card run's `module` that the run has no artifact of is `INVALID_PRESENT` before any view is built; the
 * modules (`presentModules`); the view (`service.view`, `MISSING_EVIDENCE` for an open run); the
 * check; then `exec.concludeTurn()` and the reply `{ ok, blocks, modules }`. A refusal throws and
 * never concludes the turn, so Gravit may call again. Nothing is written or counted.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { asToolError, callerIsChild, refuse } from "./lib/errors.mjs";
import { PRESENT_KINDS, checkPresent, presentModules } from "./lib/present.mjs";
import { VIEW_MODULES, viewDigest } from "./lib/view.mjs";

export const name = "lunhui-present";
export const inject = ["tools", "lunhuiRuns"];

export const PRESENT_DESCRIPTION =
  "市场运行的作答：一两句结论 summary，按当天轻重排的 blocks（verdicts、breadth、indices、ladder、sources），每块一句 title，可标 focus（ladder 的 rung，indices 的 from/to），至多三个 choices。数字只能取自 lunhui_read_run 的 view 摘要。成功即结束本轮。";

/** The parameters, in the dsh DSL: every nested object closed. Lengths and counts are `checkPresent`'s. */
const PARAMETERS = {
  strategy: { type: "string", description: "策略名，即频道名（cn-market），不是路径。", required: true },
  run: { type: "string", description: "运行编号，即 lunhui_read_run 读过的那个已封存的市场运行。", required: true },
  module: { type: "string", enum: [...VIEW_MODULES], description: "可选：模块卡片的单模块运行所答的模块；省略则为整次运行作答。" },
  summary: { type: "string", description: "一两句结论，1–160 个字符。", required: true },
  blocks: {
    type: "array",
    description: "1–6 个块，按当天轻重排，每种至多一次。",
    required: true,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: [...PRESENT_KINDS], required: true },
        title: { type: "string", description: "一句标题，至多 40 个字符；breadth、indices、ladder 必填。" },
        focus: {
          type: "object",
          additionalProperties: false,
          description: "可选重点：ladder 用 rung（几板），indices 用 from/to（HH:MM）。",
          properties: {
            rung: { type: "integer" },
            from: { type: "string" },
            to: { type: "string" },
          },
        },
      },
    },
  },
  choices: {
    type: "array",
    description: "0–3 个追问。",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string", description: "追问的文字，至多 30 个字符。", required: true },
        stock: { type: "string", description: "可选：这个运行涨停池里的六位代码。" },
      },
    },
  },
};

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 */
export function apply(ctx) {
  const service = ctx?.lunhuiRuns;
  if (service === undefined || service === null) throw new Error(`${name}: lunhuiRuns is missing; mount the lunhui-runs row first`);
  ctx.effect(() => ctx.tools.register(defineTool({
    name: "lunhui_present",
    description: PRESENT_DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: "string" },
      render: (_args, result) => [{ type: "text", text: result }],
    },
    async execute(args, exec) {
      let checked;
      try {
        if (callerIsChild(exec)) throw refuse.notGravit();
        const { manifest } = await service.readRun(args.strategy, args.run);
        // a strategy run keeps its text report (v1 answers market runs alone): refused before the module check and the view
        if (manifest?.kind !== "market") throw refuse.notMarketRun();
        if (args.module !== undefined && !(Array.isArray(manifest.artifacts) && manifest.artifacts.includes(args.module)))
          throw refuse.invalidPresent("module", `这个运行没有 ${args.module} 的已接受工件；只能为已提交的模块作答`);
        const modules = presentModules(args, manifest);
        const view = await service.view(args.strategy, args.run, { modules });
        checked = checkPresent(args, { view, digest: viewDigest(view), manifest });
      } catch (error) {
        throw asToolError(error);
      }
      exec.concludeTurn();
      return JSON.stringify({ ok: true, blocks: checked.blocks, modules: checked.modules });
    },
  })));
}
