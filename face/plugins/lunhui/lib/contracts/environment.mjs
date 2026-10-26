// face/plugins/lunhui/lib/contracts/environment.mjs
/**
 * The environment module's contract (modules spec §5.4, §5.6, A20, A21): 环境与大周期, the
 * chapters 一 (P0019–P0074) and 八 (P1652–P1708), over a `cn-market` run's index evidence and,
 * when frozen, its quotes. Three headline fields - `index_state`, `liquidity_state`,
 * `cycle_anchor` - with the index and the liquidity reported apart, as system-design §4 insists:
 * each state other than `UNKNOWN` needs a claim citing its own kind of evidence (an index quote or
 * bars for the index; `total_turnover` or `advance_decline_ratio` for the liquidity). The module
 * owns the index assertion class (指数, 大盘, 成交额, 流动性). `lib/module-tool.mjs` consumes the
 * `contract` object; the shared rules are `contract-core.mjs`'s.
 */
import { fail } from "../contract-core.mjs";

/** The bars of a series a context shows: the last 20; the frozen file keeps them all. */
const BARS_SHOWN = 20;

/** Hypothesis 1 of strategies/cn-market/THESIS.md, in the tree's own words, paragraph ids only. */
export const HYPOTHESES =
  "H1 环境与大周期（一 P0019–P0074，八 P1652–P1708）：指数所处位置和成交流动性构成一个可单独陈述的背景，由本运行冻结的指数报价、日线与宿主算出的派生量刻画。" +
  "指数状态与流动性状态分开报告，不合并成一个分数，两者可以背离。" +
  "背景偏弱时，短线结论的可信度应随之下调；本模块只陈述背景，不给短线结论。" +
  "大周期位置是可修订的工作标签，下一交易日的冻结证据可以推翻它。";

const HINTS = {
  index_state:
    "STRONG、NEUTRAL、WEAK 或 UNKNOWN：只按指数报价（kind 为 index）与指数日线（kind 为 bars）判断；不是 UNKNOWN 时，至少一条声明引用其中一条证据。",
  liquidity_state:
    "EXPANDING、STABLE、CONTRACTING 或 UNKNOWN：只按派生量 total_turnover（两市成交额合计）与 advance_decline_ratio（上涨与下跌家数之比）判断；不是 UNKNOWN 时，至少一条声明引用其中一条。limit_up_count、limit_down_count 不算流动性证据。",
  apart: "指数状态与流动性状态分开报告，各写各的声明，不合并成一个分数；两者背离时照实写出。",
  cycle_anchor:
    "用本仓库自己的话写大周期位置，不超过 120 字，证据不足写 UNKNOWN。此字段不引证据，所以不写“指数、大盘、成交额、流动性”等词，这类断言只放进引用了派生证据的声明。",
  claims:
    "每条声明写一个事实并引用证据编号；含“指数、大盘、成交额、流动性”的句子须同时引用一条派生证据（derived）。本模块不写全市场广度、情绪、题材、龙头类断言。",
  basis:
    "CURRENT 指本运行的交易日（上下文 session），须至少引用一条 scope 为 CURRENT 的证据；日线与历史序列一律 HISTORICAL，文字不用“当前、今日”等词；证据不足用 INSUFFICIENT，此时标题字段写 UNKNOWN。",
  bars: `日线只列最近 ${BARS_SHOWN} 根，bars_total 是冻结的根数；证据编号指整条序列。`,
  status: "status_expected 为 NOT_EVALUABLE 时照 example 提交：missing_sources 照抄 missing，标题字段一律 UNKNOWN。",
  example:
    "example 只示格式：标题字段为 UNKNOWN，声明为 INSUFFICIENT，不是判断。写出 STRONG 或 WEAK 等指数状态，须有一条 CURRENT 或 HISTORICAL 声明引用指数报价或指数日线；写出 EXPANDING 或 CONTRACTING 等流动性状态，须有一条声明引用 total_turnover 或 advance_decline_ratio；句中出现“指数、成交额、流动性”时同一声明还须引用一条派生证据。",
};

const SCHEMA = {
  required: ["index_state", "liquidity_state", "cycle_anchor"],
  properties: {
    index_state: { enum: ["STRONG", "NEUTRAL", "WEAK", "UNKNOWN"] },
    liquidity_state: { enum: ["EXPANDING", "STABLE", "CONTRACTING", "UNKNOWN"] },
    cycle_anchor: { type: "string", minLength: 1, maxLength: 120 },
  },
};

/** The derived measures a liquidity state may rest on. */
const LIQUIDITY_MEASURES = new Set(["total_turnover", "advance_decline_ratio"]);

/** An index quote or an index bars series, of the index source. */
const isIndexRow = (entry) => entry.source === "index" && (entry.kind === "index" || entry.kind === "bars");
const isLiquidityMeasure = (entry) => entry.source === "index" && entry.kind === "derived" && LIQUIDITY_MEASURES.has(entry.item.measure);

/**
 * Whether any claim cites an item `test` accepts.
 * @param {any} parsed
 * @param {import("../contract-core.mjs").ContextDigest} context
 * @param {(entry: import("../contract-core.mjs").DigestItem) => boolean} test
 */
function cites(parsed, context, test) {
  return parsed.claims.some((claim) => claim.evidence_ids.some((id) => {
    const entry = context.items.get(id);
    return entry !== undefined && test(entry);
  }));
}

/** The module's own rules, after the shared ones: each state stands on its own evidence. */
function rules(parsed, context) {
  if (parsed.index_state !== "UNKNOWN" && !cites(parsed, context, isIndexRow))
    fail("analysis.index_state: a state other than UNKNOWN needs a claim with an evidence reference to an index quote or index bars.");
  if (parsed.liquidity_state !== "UNKNOWN" && !cites(parsed, context, isLiquidityMeasure))
    fail("analysis.liquidity_state: a state other than UNKNOWN needs a claim with an evidence reference to total_turnover or advance_decline_ratio.");
}

/**
 * The first id in the digest whose entry `test` accepts, or undefined.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 * @param {(entry: import("../contract-core.mjs").DigestItem) => boolean} test
 */
function firstId(digest, test) {
  for (const [id, entry] of digest.items) if (test(entry)) return id;
  return undefined;
}

/**
 * The context's example, built from the digest's own ids: `NOT_EVALUABLE` naming the missing
 * sources when any is, else `OK` with UNKNOWN headlines and one INSUFFICIENT claim citing one of
 * the digest's ids - a format a role cannot copy as a judgment it never made.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function example(digest) {
  const envelope = {
    module: digest.module, contract_version: digest.contract_version, hypotheses_version: digest.hypotheses_version,
    snapshot_id: digest.snapshot_id, run: digest.run, as_of: digest.as_of, session: digest.session,
  };
  const unknown = { index_state: "UNKNOWN", liquidity_state: "UNKNOWN", cycle_anchor: "UNKNOWN" };
  if (digest.missing.length > 0)
    return {
      ...envelope, status: "NOT_EVALUABLE", missing_sources: [...digest.missing], ...unknown,
      claims: [], limitations: [`缺少 ${digest.missing.join("、")} 证据，无法评估。`],
    };
  // No judgment to copy: UNKNOWN headlines and one INSUFFICIENT claim citing one id of the digest.
  const cited =
    firstId(digest, (entry) => isIndexRow(entry) && entry.kind === "index" && entry.item.symbol === "sh000001") ??
    firstId(digest, () => true);
  const claims = cited === undefined ? [] : [{
    id: "c1", basis: "INSUFFICIENT", evidence_ids: [cited],
    text: "示例：所引证据只示格式；按读数改写本声明的 basis 与文字，再填标题字段。",
  }];
  return { ...envelope, status: "OK", missing_sources: [], ...unknown, claims, limitations: [] };
}

/** A bars or history row cut to its last `BARS_SHOWN` bars, the frozen count beside them. */
function lastBars(item) {
  if (!Array.isArray(item.bars)) return item;
  return { ...item, bars: item.bars.slice(-BARS_SHOWN), bars_total: item.bars.length };
}

/** @type {import("../module-tool.mjs").ModuleContract} */
export const contract = {
  schema: SCHEMA,
  owns: ["index"],
  rules,
  hypotheses: HYPOTHESES,
  hints: HINTS,
  example,
  sources: ["index", "quotes"],
  required: ["index"],
  derivedFirst: ["index"],
  priority: [
    { source: "index", kind: "index" },
    { source: "index", kind: "counts" },
    { source: "index", kind: "bars", view: lastBars },
    { source: "quotes", kind: "quote" },
    { source: "quotes", kind: "history", view: lastBars },
  ],
};
