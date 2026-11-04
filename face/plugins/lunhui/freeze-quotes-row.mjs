// face/plugins/lunhui/freeze-quotes-row.mjs
/**
 * `lunhui-freeze-quotes` (modules spec §5.3, A27): `lunhui_freeze_quotes({ strategy, run?, symbols })`
 * freezes stage 0's sample - Tencent quotes and 60-day daily bars for 1-8 symbols, at most four of
 * the four indices and four main-board equities, through `freezeSample` - into a run's
 * `evidence-quotes.json`: one item per quote (`kind: "quote"`, the parsed quote's own index or equity
 * kind kept as `instrument`), then one per history series (`kind: "history"`). No
 * derived item here; the index row derives the turnover. The one freeze a strategy channel uses,
 * and the market channel may use it too. `lib/freeze-tool.mjs` holds the shared steps.
 */
import { refuse } from "./lib/errors.mjs";
import { RUN_PARAMETERS, SHARED_BOUNDS, defineFreeze, freezeDeps, sessionOf, tencent } from "./lib/freeze-tool.mjs";
import { freezeSample, validateSymbols } from "./lib/market.mjs";

export const name = "lunhui-freeze-quotes";
export const inject = ["tools", "lunhuiRuns"];

const SYMBOL_RE = /^(sh|sz)\d{6}$/;
const MAIN_BOARD_RE = /^(?:sh60\d{4}|sz00\d{4})$/;

/**
 * Stage 0's `checkSymbols`, before any request: 1-8 codes in the provider grammar, no duplicates,
 * the closed index set and the main board, at most four indices and four equities.
 * @param {{ symbols?: unknown }} args
 */
function checkSymbols({ symbols }) {
  if (
    !Array.isArray(symbols) ||
    symbols.length < 1 ||
    symbols.length > 8 ||
    !symbols.every((symbol) => typeof symbol === "string" && SYMBOL_RE.test(symbol))
  )
    throw refuse.symbolShape();
  if (new Set(symbols).size !== symbols.length) throw refuse.symbolDuplicate();
  let accepted;
  try {
    accepted = validateSymbols(symbols);
  } catch {
    throw refuse.symbolSet();
  }
  const equities = accepted.filter((symbol) => MAIN_BOARD_RE.test(symbol)).length;
  if (equities > 4 || accepted.length - equities > 4) throw refuse.symbolMix();
}

/**
 * @param {import("./lib/freeze-tool.mjs").FetchLike} fetchImpl
 * @param {{ symbols: string[] }} args checked
 * @param {() => Date} now called once, after the quote fetch
 * @returns {Promise<import("./lib/freeze-tool.mjs").Frozen>}
 */
async function freeze(fetchImpl, args, now) {
  const { snapshot, histories } = await tencent(freezeSample({ symbols: args.symbols, fetchImpl, now }));
  // Stage 0's own check: no priced, timed quote is no market data.
  if (!snapshot.quotes.some((quote) => Number.isFinite(quote.last) && quote.last > 0 && quote.quotedAt))
    throw refuse.noMarketData("腾讯行情");
  return {
    items: [
      ...snapshot.quotes.map((quote) => ({ ...quote, kind: "quote", instrument: quote.kind })),
      ...histories.map((history) => ({ kind: "history", ...history })),
    ],
    derived: [],
    meta: { received_at: snapshot.receivedAt, session: sessionOf(new Date(snapshot.receivedAt)), host: "qt.gtimg.cn,web.ifzq.gtimg.cn", delayed: false, truncated: false },
  };
}

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {{ fetch?: string, market?: string, now?: () => Date }} config
 */
export function apply(ctx, config) {
  const deps = freezeDeps(name, ctx, config);
  ctx.effect(() => ctx.tools.register(defineFreeze({
    name: "lunhui_freeze_quotes",
    description:
      "冻结腾讯公开报价与 60 个交易日的日线（前复权）到一个研究运行的证据文件 evidence-quotes.json，每条报价与每个日线序列各一条证据，带证据编号。" +
      "symbols 为 1–8 个代码：指数仅限 sh000001、sz399001、sz399006、sh000300，个股仅限沪深主板 sh60xxxx、sz00xxxx，各至多四个，不得重复。" +
      "市场频道 cn-market 与策略频道都可用；策略频道只用这一个冻结。只读研究，不交易，不读账户。" +
      SHARED_BOUNDS,
    parameters: {
      ...RUN_PARAMETERS,
      symbols: {
        type: "array",
        items: { type: "string" },
        description: "1–8 个代码，每个为 sh 或 sz 加六位数字，指数与主板个股各至多 4 个，不得重复。",
        required: true,
      },
    },
    source: "quotes",
    kind: "any",
    check: checkSymbols,
    freeze,
    ...deps,
  })));
}
