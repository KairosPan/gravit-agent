// face/plugins/lunhui/freeze-limit-up-row.mjs
/**
 * `lunhui-freeze-limit-up` (modules spec §5.3, A20, A25): `lunhui_freeze_limit_up({ strategy, run? })`
 * freezes Eastmoney's 涨停池, 炸板池 and 昨日涨停 into a market run's `evidence-limit-up.json`, each
 * row tagged with its `pool` (`zt`, `zb`, `yesterday`), followed by `deriveLimitUp`'s measures. The
 * session asked for is `getMarketSession(now).expectedQuoteDate`, the latest trading day whose pool
 * can exist - on a weekend or holiday, or before 09:15, the previous session; a null date (the
 * previous session outside the calendar) is `CALENDAR_UNCOVERED`. `cn-market` only.
 */
import { refuse } from "./lib/errors.mjs";
import { deriveLimitUp } from "./lib/derive.mjs";
import { fetchLimitUpPools } from "./lib/eastmoney.mjs";
import { RUN_PARAMETERS, SHARED_BOUNDS, defineFreeze, freezeDeps, idsOf } from "./lib/freeze-tool.mjs";
import { getMarketSession } from "./lib/market.mjs";

export const name = "lunhui-freeze-limit-up";
export const inject = ["tools", "lunhuiRuns"];

/**
 * @param {import("./lib/freeze-tool.mjs").FetchLike} fetchImpl
 * @param {unknown} _args
 * @param {() => Date} now
 * @returns {Promise<import("./lib/freeze-tool.mjs").Frozen>}
 */
async function freeze(fetchImpl, _args, now) {
  const session = getMarketSession(now()).expectedQuoteDate;
  if (session === null) throw refuse.calendarUncovered();
  const pools = await fetchLimitUpPools({ date: session.replaceAll("-", ""), fetchImpl });
  const tag = (pool) => pools[pool].map((row) => ({ pool, ...row }));
  const tagged = { zt: tag("zt"), zb: tag("zb"), yesterday: tag("yesterday") };
  const items = [...tagged.zt, ...tagged.zb, ...tagged.yesterday];
  const derived = deriveLimitUp(tagged, idsOf(items, (row) => [row.pool, row.code]));
  return {
    items,
    derived,
    meta: { received_at: now().toISOString(), host: pools.host, delayed: pools.delayed, truncated: pools.truncated },
  };
}

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {{ fetch?: string, now?: () => Date }} config
 */
export function apply(ctx, config) {
  const deps = freezeDeps(name, ctx, config);
  ctx.effect(() => ctx.tools.register(defineFreeze({
    name: "lunhui_freeze_limit_up",
    description:
      "冻结东方财富的涨停池、炸板池与昨日涨停表现（各至多 500 行）到一个市场运行的证据文件 evidence-limit-up.json：代码、名称、连板数、封板时间、炸板次数、成交额、所属行业；" +
      "宿主同时算出连板高度分布、封板率与炸板率、昨日涨停今日收益中位数与负尾占比，作为派生证据，引用其输入行的证据编号。" +
      "交易日取最近一个已开盘的交易日（周末、节假日或 09:15 前取上一交易日）。只用于市场频道 cn-market，策略频道会被拒绝（WRONG_CHANNEL）。" +
      SHARED_BOUNDS,
    parameters: { ...RUN_PARAMETERS },
    source: "limit-up",
    kind: "market",
    freeze,
    ...deps,
  })));
}
