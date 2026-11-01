// face/plugins/lunhui/lib/contracts/sentiment.mjs
/**
 * The sentiment module's contract (modules spec §5.4, §5.6, A20, A21): 情绪周期, the chapter 二
 * (P0156–P0163) and P0020–P0056, over a `cn-market` run's limit-up pools and index evidence. Three
 * headline fields - `state`, one of the seven states, `money_effect` and `freeze_type` (冰点: none,
 * at the ice point, the session after it) - and a `conflict`, the indicators that disagree, which an
 * `OK` artifact must carry when its `state` is `UNKNOWN` (system-design §4). A `state` other than
 * `UNKNOWN` rests on at least two cited ids of limit-up evidence and one of index evidence, across
 * the claims that are not INSUFFICIENT; a `money_effect` or `freeze_type` other than `UNKNOWN` on a
 * claim of its own citing a limit-up derived item. The module owns the sentiment assertion class,
 * carried by a derived item (the core's default), and the whole-market class, carried by the
 * market counts or an index derived item. Derived items are shown with their inputs counted, not
 * listed: a pool's measure cites every row; the counts row shows the six counts and their session
 * (`countsRow`). `lib/module-tool.mjs` consumes the `contract` object; the shared rules are
 * `contract-core.mjs`'s.
 */
import { fail } from "../contract-core.mjs";
import { COUNTS_HINT, DERIVED_HINT, countsRow, derivedRow, exampleOf, ownClaims } from "./shared.mjs";

const STATES = ["UNKNOWN", "CHAOS", "IGNITION", "EXPANSION", "CLIMAX", "RETREAT", "REPAIR"];

/** Hypothesis 2 of strategies/cn-market/THESIS.md, in the tree's own words, paragraph ids only. */
export const HYPOTHESES =
  "H2 情绪周期（二 P0156–P0163，P0020–P0056）：短线情绪由涨停、连板、炸板与昨日涨停股的次日表现共同刻画，由本运行冻结的涨停池、炸板池、昨日涨停与宿主算出的派生量读出。" +
  `情绪在若干状态间轮转，状态取 ${STATES.join("、")} 七个之一。` +
  "这些状态是可修订的工作标签，不是事实；下一交易日的冻结证据可以推翻它。" +
  "指标彼此矛盾时状态写 UNKNOWN，并写明哪些指标相互矛盾。";

const HINTS = {
  derived: DERIVED_HINT,
  state:
    `${STATES.join("、")} 之一：不是 UNKNOWN 时，所有不为 INSUFFICIENT 的声明合计至少引用两条涨停证据（涨停池、炸板池、昨日涨停的行，或 limit-up 的派生量）和一条指数证据（家数计数 counts 或 index 的派生量）。`,
  money_effect:
    "POSITIVE、MIXED、NEGATIVE 或 UNKNOWN：赚钱效应，宜按 yesterday_return_median 与 yesterday_negative_tail 判断；不是 UNKNOWN 时，须有一条不为 INSUFFICIENT 的声明引用一条 limit-up 的派生量，且不是支撑 freeze_type 的那一条。",
  freeze_type:
    "NONE、ICE_POINT、POST_ICE 或 UNKNOWN：冰点读数，NONE 不在冰点，ICE_POINT 本交易日即冰点，POST_ICE 冰点后的一个交易日；不是 UNKNOWN 时，须有一条不为 INSUFFICIENT 的声明引用一条 limit-up 的派生量，且不是支撑 money_effect 的那一条。",
  conflict:
    "status 为 OK 且 state 为 UNKNOWN 时必填，不超过 200 字：写出本运行里你读到的、相互矛盾的指标名（派生量的 measure 名）及其方向。此字段不引证据，所以不写“情绪、赚钱效应、冰点、全市场、涨跌家数”等词。",
  claims:
    "每条声明写一个事实并引用证据编号；含“情绪、情绪周期、赚钱效应、亏钱效应、冰点”的句子须同时引用一条派生证据（derived）；含“全市场、市场广度、涨跌家数”的句子须同时引用家数计数 counts 或一条 index 的派生量。本模块不写题材、主线、龙头、指数类断言。" +
    "advance_decline_ratio 在文字里写作“上涨与下跌家数之比”。" +
    "引用指数证据的声明也不写“指数、大盘、成交额、流动性”：那是本模块不拥有的指数类断言，会被拒绝；total_turnover 写作“两市成交合计”，指数证据写作“所引派生证据”或“家数计数”。",
  basis:
    "CURRENT 指本运行的交易日（上下文 session），须至少引用一条 scope 为 CURRENT 的证据；更早交易日的证据一律 HISTORICAL，文字不用“当前、今日”等词；证据不足用 INSUFFICIENT，此时标题字段写 UNKNOWN。",
  rows: "涨停池按连板数从高到低、昨日涨停按涨跌幅从低到高列出；指数报价与日线不在本模块的列表里，计入 truncated，指数证据请引用 counts 或 index 的派生量。limit-up 的派生量是 streak_distribution、seal_ratio、break_ratio、yesterday_return_median、yesterday_negative_tail；index 的派生量是 total_turnover、advance_decline_ratio、limit_up_count、limit_down_count。",
  counts: COUNTS_HINT,
  status: "status_expected 为 NOT_EVALUABLE 时照 example 提交：missing_sources 照抄 missing，标题字段一律 UNKNOWN，不写 conflict。",
  example:
    "example 只示格式：标题字段为 UNKNOWN，声明为 INSUFFICIENT，conflict 只示写法，不是判断。写出 UNKNOWN 以外的状态，须有不为 INSUFFICIENT 的声明合计引用两条涨停证据和一条指数证据；money_effect、freeze_type 各需一条自己的声明。",
};

const SCHEMA = {
  required: ["state", "money_effect", "freeze_type"],
  properties: {
    state: { enum: STATES },
    money_effect: { enum: ["POSITIVE", "MIXED", "NEGATIVE", "UNKNOWN"] },
    freeze_type: { enum: ["NONE", "ICE_POINT", "POST_ICE", "UNKNOWN"] },
    conflict: { type: "string", minLength: 1, maxLength: 200 },
  },
};

/** Limit-up evidence: a pool row or a limit-up derived item. */
const isLimitUp = (entry) => entry.source === "limit-up";
/** Index evidence: an index quote, the market counts, or an index derived item - not bars. */
const isIndex = (entry) => entry.source === "index" && (entry.kind === "index" || entry.kind === "counts" || entry.kind === "derived");
/** A limit-up derived item: what a money effect or a freeze reading rests on. */
const isLimitUpMeasure = (entry) => entry.source === "limit-up" && entry.kind === "derived";
/** The items that carry the whole-market class's sentences: the market counts or an index derived item. */
const carriesMarket = (entry) => entry.source === "index" && (entry.kind === "counts" || entry.kind === "derived");

/**
 * The distinct ids, cited by claims other than INSUFFICIENT ones, whose item `test` accepts.
 * @param {any} parsed
 * @param {import("../contract-core.mjs").ContextDigest} context
 * @param {(entry: import("../contract-core.mjs").DigestItem) => boolean} test
 */
function idsCited(parsed, context, test) {
  const ids = parsed.claims.filter((claim) => claim.basis !== "INSUFFICIENT").flatMap((claim) => claim.evidence_ids);
  return new Set(ids.filter((id) => {
    const entry = context.items.get(id);
    return entry !== undefined && test(entry);
  }));
}

/**
 * The module's own rules, after the shared ones: an OK artifact whose state is UNKNOWN names its
 * conflict; any other state stands on two limit-up ids and one index id across its claims; a money
 * effect or a freeze reading other than UNKNOWN each on a claim of its own citing a limit-up measure.
 */
function rules(parsed, context) {
  if (parsed.state === "UNKNOWN" && parsed.status === "OK" && parsed.conflict === undefined) fail("analysis.conflict: required.");
  if (parsed.state !== "UNKNOWN" && (idsCited(parsed, context, isLimitUp).size < 2 || idsCited(parsed, context, isIndex).size < 1))
    fail("analysis.state: a state other than UNKNOWN needs, across its claims not INSUFFICIENT, two evidence references to limit-up evidence and one to index evidence.");
  ownClaims(parsed, context, [
    { field: "money_effect", test: isLimitUpMeasure, needs: "a limit-up derived item" },
    { field: "freeze_type", test: isLimitUpMeasure, needs: "a limit-up derived item" },
  ]);
}

/**
 * The context's example (`exampleOf`): UNKNOWN headlines and, in an OK run, a conflict that only
 * shows the format and one INSUFFICIENT claim citing a limit-up derived item.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function example(digest) {
  return exampleOf(digest, { state: "UNKNOWN", money_effect: "UNKNOWN", freeze_type: "UNKNOWN" }, isLimitUpMeasure, {
    conflict: "示例：列出相互矛盾的两个以上读数及其方向。",
  });
}

/** Rows by a numeric field, `sign` 1 ascending and -1 descending, a null last. */
const byNumber = (field, sign) => (a, b) =>
  (typeof a[field] !== "number") - (typeof b[field] !== "number") || sign * ((a[field] ?? 0) - (b[field] ?? 0));

/** @type {import("../module-tool.mjs").ModuleContract} */
export const contract = {
  schema: SCHEMA,
  owns: ["sentiment", "market"],
  ownedBy: { market: carriesMarket },
  rules,
  hypotheses: HYPOTHESES,
  hints: HINTS,
  example,
  sources: ["limit-up", "index"],
  required: ["limit-up", "index"],
  derivedFirst: ["limit-up"],
  derivedView: derivedRow,
  priority: [
    { source: "index", kind: "counts", view: countsRow },
    { source: "limit-up", kind: "zt", order: byNumber("boards", -1) },
    { source: "limit-up", kind: "zb" },
    { source: "limit-up", kind: "yesterday", order: byNumber("pct", 1) },
  ],
};
