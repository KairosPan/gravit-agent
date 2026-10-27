// face/plugins/lunhui/freeze-index-row.mjs
/**
 * `lunhui-freeze-index` (modules spec §5.3, A20, A28): `lunhui_freeze_index({ strategy, run? })`
 * freezes the four indices' Tencent quotes (each item the parsed quote, given `kind: "index"`) and their
 * 120-day daily bars (`kind: "bars"`), then the market's advance/decline counts from Eastmoney's
 * up/down distribution of the session (`kind: "counts"`: the counts, the 23 buckets, the reply's
 * hash, its `host` and `delayed`; no row; spec §16), into a market run's `evidence-index.json`,
 * followed by `deriveIndex`'s and `deriveCounts`' measures. Any Tencent failure fails the freeze, as
 * does a reply with no priced quote, or a distribution of another session (`NO_MARKET_DATA`).
 * `cn-market` only.
 */
import { refuse } from "./lib/errors.mjs";
import { deriveCounts, deriveIndex } from "./lib/derive.mjs";
import { fetchMarketCounts } from "./lib/eastmoney.mjs";
import { RUN_PARAMETERS, SHARED_BOUNDS, defineFreeze, freezeDeps, hostsOf, idsOf, sessionOf, tencent } from "./lib/freeze-tool.mjs";
import { fetchDailyBars, fetchQuotes } from "./lib/market.mjs";

export const name = "lunhui-freeze-index";
export const inject = ["tools", "lunhuiRuns"];

const INDICES = ["sh000001", "sz399001", "sz399006", "sh000300"];
const BAR_DAYS = 120;

/**
 * @param {import("./lib/freeze-tool.mjs").FetchLike} fetchImpl
 * @param {unknown} _args
 * @param {() => Date} now
 * @returns {Promise<import("./lib/freeze-tool.mjs").Frozen>}
 */
async function freeze(fetchImpl, _args, now) {
  const session = sessionOf(now());
  const [replied, series, counts] = await Promise.all([
    tencent(fetchQuotes(INDICES, { fetchImpl })),
    tencent(Promise.all(INDICES.map((symbol) => fetchDailyBars(symbol, { fetchImpl, days: BAR_DAYS })))),
    fetchMarketCounts({ date: session.replaceAll("-", ""), fetchImpl }),
  ]);
  // The item's kind is the freeze's to give, not the parser's instrument kind it happens to equal.
  const quotes = replied.map((quote) => ({ ...quote, kind: "index" }));
  if (!quotes.some((quote) => Number.isFinite(quote.last) && quote.last > 0 && quote.quotedAt))
    throw refuse.noMarketData("腾讯行情");
  // The counts item carries its reply's host and delay (A28); the Tencent items need no stamp.
  const { host, delayed } = counts;
  const countsItem = { kind: "counts", ...counts };
  const items = [...quotes, ...series.map((bars) => ({ kind: "bars", ...bars })), countsItem];
  const derived = [
    ...deriveIndex(quotes, idsOf(quotes, (quote) => ["quote", quote.symbol])),
    ...deriveCounts(countsItem, idsOf([countsItem], () => ["counts"])),
  ];
  const at = now();
  return {
    items,
    derived,
    meta: { received_at: at.toISOString(), session, host: hostsOf(["qt.gtimg.cn", "web.ifzq.gtimg.cn", ...host.split(",")]), delayed, truncated: false },
  };
}

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {{ fetch?: string, now?: () => Date }} config
 */
export function apply(ctx, config) {
  const deps = freezeDeps(name, ctx, config);
  ctx.effect(() => ctx.tools.register(defineFreeze({
    name: "lunhui_freeze_index",
    description:
      "冻结四个指数（sh000001、sz399001、sz399006、sh000300）的腾讯报价与 120 个交易日的日线（前复权），以及东方财富当日涨跌分布的上涨、下跌、平盘、涨停与跌停家数（只存计数、各档分布与响应哈希，不存个股行；分布须为本次会话日，否则拒绝 NO_MARKET_DATA），" +
      "到一个市场运行的证据文件 evidence-index.json；宿主同时算出两市成交额合计、涨跌家数比与涨跌停家数，作为派生证据。" +
      "只用于市场频道 cn-market，策略频道会被拒绝（WRONG_CHANNEL）。" +
      SHARED_BOUNDS,
    parameters: { ...RUN_PARAMETERS },
    source: "index",
    kind: "market",
    freeze,
    ...deps,
  })));
}
