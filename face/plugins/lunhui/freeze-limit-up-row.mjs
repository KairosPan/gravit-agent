// face/plugins/lunhui/freeze-limit-up-row.mjs
/**
 * `lunhui-freeze-limit-up` (modules spec §5.3, A20, A25): `lunhui_freeze_limit_up({ strategy, run? })`
 * freezes Eastmoney's 涨停池, 炸板池 and 昨日涨停 into a market run's `evidence-limit-up.json`, each
 * row tagged with its `pool` (`zt`, `zb`, `yesterday`), followed by `deriveLimitUp`'s measures. The
 * session asked for is `sessionOf(now)`, the latest trading day whose pool can exist - on a weekend
 * or holiday, or before 09:15, the previous session - and it is the session the evidence records;
 * one outside the calendar `defineFreeze` refuses before any run. A code a pool reply repeats keeps
 * its first row, so every row has its own key; the reply's `duplicates` counts the rows dropped.
 * Each row carries the `host` and `delayed` of the reply that served its pool (A28). After the pool
 * rows, one Tencent minute line of the session per ladder name (`ladderCodes`, run view M6): a
 * `minutes` item, or `minutes_missing` naming the reason when the line cannot be read - which fails
 * nothing - each with its `code`; the derived measures read the pool rows alone. `cn-market` only.
 */
import { deriveLimitUp, ladderCodes, rowKey } from "./lib/derive.mjs";
import { fetchLimitUpPools } from "./lib/eastmoney.mjs";
import { RUN_PARAMETERS, SHARED_BOUNDS, defineFreeze, freezeDeps, hostsOf, idsOf, sessionOf } from "./lib/freeze-tool.mjs";
import { exchangeOf, minuteItems } from "./lib/market.mjs";

export const name = "lunhui-freeze-limit-up";
export const inject = ["tools", "lunhuiRuns"];

/** The host serving the minute lines. */
const MINUTES_HOST = "web.ifzq.gtimg.cn";

/**
 * A pool's rows with each code's first row only, and how many later rows repeated a code.
 * @param {string} pool
 * @param {Record<string, unknown>[]} rows
 */
function firstOfEach(pool, rows) {
  const seen = new Set();
  const kept = rows.filter((row) => {
    const key = rowKey(pool, row.code);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { kept, duplicates: rows.length - kept.length };
}

/**
 * @param {import("./lib/freeze-tool.mjs").FetchLike} fetchImpl
 * @param {unknown} _args
 * @param {() => Date} now
 * @returns {Promise<import("./lib/freeze-tool.mjs").Frozen>}
 */
async function freeze(fetchImpl, _args, now) {
  const session = sessionOf(now());
  const pools = await fetchLimitUpPools({ date: session.replaceAll("-", ""), fetchImpl });
  let duplicates = 0;
  // Each pool deduplicated by its key, then each row stamped with the reply that served its pool
  // (A28), before its id is computed.
  const tag = (pool) => {
    const { kept, duplicates: dropped } = firstOfEach(pool, pools[pool]);
    duplicates += dropped;
    return kept.map((row) => ({ pool, ...row, ...pools.served[pool] }));
  };
  const tagged = { zt: tag("zt"), zb: tag("zb"), yesterday: tag("yesterday") };
  const items = [...tagged.zt, ...tagged.zb, ...tagged.yesterday];
  const derived = deriveLimitUp(tagged, idsOf(items, (row) => [row.pool, row.code]));
  // The ladder's minute lines, after the derive step: the measures see pool rows only. A code with
  // no exchange is never fetched, so the minute host joins the meta only when one line was asked.
  const entries = ladderCodes(tagged).map((code) => ({ code, symbol: exchangeOf(code) && exchangeOf(code) + code }));
  items.push(...(await minuteItems(entries, session, { fetchImpl })));
  const asked = entries.some((entry) => entry.symbol !== null);
  return {
    items,
    derived,
    meta: {
      received_at: now().toISOString(),
      session,
      host: hostsOf([...pools.host.split(","), ...(asked ? [MINUTES_HOST] : [])]),
      delayed: pools.delayed,
      truncated: pools.truncated,
    },
    summary: { duplicates },
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
