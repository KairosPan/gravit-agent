// face/plugins/lunhui/freeze-index-row.mjs
/**
 * `lunhui-freeze-index` (modules spec §5.3, A20, A28, §16, §17): `lunhui_freeze_index({ strategy,
 * run? })` freezes the four indices' Tencent quotes (each item the parsed quote, given `kind:
 * "index"`) and their 120-day daily bars (`kind: "bars"`), then the market's advance/decline counts
 * from Eastmoney's up/down distribution of the session (`kind: "counts"`: the counts, the buckets
 * the reply held, the hash of its data, its `host` and `delayed`; no row), then each index's Tencent
 * minute line of the session (`kind: "minutes"`, or `minutes_missing` naming the reason when the
 * line cannot be read - which fails nothing), into a market run's
 * `evidence-index.json`, followed by `deriveIndex`'s and `deriveCounts`' measures. Any Tencent
 * failure fails the freeze, as does a reply with no priced quote (`NO_MARKET_DATA`). A distribution
 * the freeze cannot use - another session's, a failed or malformed request: any provider refusal -
 * does not: the Tencent items land without a counts item, the counts' three measures are null citing
 * no input, and the reply's `counts` names the refusal (`{ frozen: false, refused, reason }`, else
 * `{ frozen: true }`), because this freeze opens every market run and the distribution is a clock
 * matter from 09:15 China time until Eastmoney rolls its session (§17). A host bug on that path is
 * still `INTERNAL`. `cn-market` only.
 */
import { refuse } from "./lib/errors.mjs";
import { deriveCounts, deriveIndex } from "./lib/derive.mjs";
import { fetchMarketCounts } from "./lib/eastmoney.mjs";
import { RUN_PARAMETERS, SHARED_BOUNDS, defineFreeze, freezeDeps, hostsOf, idsOf, sessionOf, tencent } from "./lib/freeze-tool.mjs";
import { fetchDailyBars, fetchQuotes, minuteItems } from "./lib/market.mjs";
import { LunhuiError } from "./lib/runs.mjs";

export const name = "lunhui-freeze-index";
export const inject = ["tools", "lunhuiRuns"];

const INDICES = ["sh000001", "sz399001", "sz399006", "sh000300"];
const BAR_DAYS = 120;
const TENCENT_HOSTS = ["qt.gtimg.cn", "web.ifzq.gtimg.cn"];
/** The clause every refusal text carries, dropped from a reason the reply reports: the index items were written. */
const UNWRITTEN = "；本次未写入任何文件";

/**
 * The session's distribution, or the provider refusal that stood in for it - a `LunhuiError`;
 * anything else is the host's bug and is rethrown.
 * @param {string} session `YYYY-MM-DD`
 * @param {import("./lib/freeze-tool.mjs").FetchLike} fetchImpl
 * @returns {Promise<{ counts: Awaited<ReturnType<typeof fetchMarketCounts>> } | { refused: LunhuiError }>}
 */
async function marketCounts(session, fetchImpl) {
  try {
    return { counts: await fetchMarketCounts({ date: session.replaceAll("-", ""), fetchImpl }) };
  } catch (error) {
    if (error instanceof LunhuiError) return { refused: error };
    throw error;
  }
}

/**
 * A refusal as the reply's `counts.reason`: its text after the code word (`LunhuiError` opens every
 * message with it), without the unwritten clause - a text without that clause passes through whole.
 */
function reasonOf(error) {
  return error.message.slice(`${error.code}: `.length).replace(UNWRITTEN, "");
}

/**
 * @param {import("./lib/freeze-tool.mjs").FetchLike} fetchImpl
 * @param {unknown} _args
 * @param {() => Date} now
 * @returns {Promise<import("./lib/freeze-tool.mjs").Frozen>}
 */
async function freeze(fetchImpl, _args, now) {
  const session = sessionOf(now());
  // Each index's minute line of the session, one `minutes` or `minutes_missing` item each, fetched
  // beside the rest: a line that cannot be read names its reason and fails nothing.
  const [replied, series, distribution, lines] = await Promise.all([
    tencent(fetchQuotes(INDICES, { fetchImpl })),
    tencent(Promise.all(INDICES.map((symbol) => fetchDailyBars(symbol, { fetchImpl, days: BAR_DAYS })))),
    marketCounts(session, fetchImpl),
    minuteItems(INDICES.map((symbol) => ({ symbol })), session, { fetchImpl }),
  ]);
  // The item's kind is the freeze's to give, not the parser's instrument kind it happens to equal.
  const quotes = replied.map((quote) => ({ ...quote, kind: "index" }));
  if (!quotes.some((quote) => Number.isFinite(quote.last) && quote.last > 0 && quote.quotedAt))
    throw refuse.noMarketData("腾讯行情");
  // The counts item, when the distribution landed, carries its reply's host and delay (A28); the
  // Tencent items need no stamp.
  const countsItem = "counts" in distribution ? { kind: "counts", ...distribution.counts } : null;
  const items = [
    ...quotes,
    ...series.map((bars) => ({ kind: "bars", ...bars })),
    ...(countsItem === null ? [] : [countsItem]),
    ...lines,
  ];
  const derived = [
    ...deriveIndex(quotes, idsOf(quotes, (quote) => ["quote", quote.symbol])),
    ...deriveCounts(countsItem, countsItem === null ? new Map() : idsOf([countsItem], () => ["counts"])),
  ];
  const at = now();
  return {
    items,
    derived,
    meta: {
      received_at: at.toISOString(),
      session,
      host: hostsOf([...TENCENT_HOSTS, ...(countsItem === null ? [] : countsItem.host.split(","))]),
      delayed: countsItem?.delayed ?? false,
      truncated: false,
    },
    summary: {
      counts: countsItem === null ? { frozen: false, refused: distribution.refused.code, reason: reasonOf(distribution.refused) } : { frozen: true },
    },
  };
}

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {{ fetch?: string, account?: string, now?: () => Date }} config
 */
export function apply(ctx, config) {
  const deps = freezeDeps(name, ctx, config);
  ctx.effect(() => ctx.tools.register(defineFreeze({
    name: "lunhui_freeze_index",
    description:
      "冻结四个指数（sh000001、sz399001、sz399006、sh000300）的腾讯报价与 120 个交易日的日线（前复权），以及东方财富本次会话交易日涨跌分布的上涨、下跌、平盘、涨停与跌停家数（只存计数、各档分布与数据哈希，不存个股行），" +
      "到一个市场运行的证据文件 evidence-index.json；宿主同时算出两市成交额合计、涨跌家数比与涨跌停家数，作为派生证据。" +
      "分布不可用时（属于另一交易日、请求失败或响应无效）指数报价与日线照常写入，家数计数缺失、其三个派生量为 null，回复的 counts 写明拒因；09:15 后到东财翻日前属于此例，翻日后开新运行可补。" +
      "只用于市场频道 cn-market，策略频道会被拒绝（WRONG_CHANNEL）。" +
      SHARED_BOUNDS,
    parameters: { ...RUN_PARAMETERS },
    source: "index",
    kind: "market",
    freeze,
    ...deps,
  })));
}
