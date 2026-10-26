// face/plugins/lunhui/lib/contracts/sentiment.mjs
/**
 * The sentiment module's contract (modules spec §5.4, §5.6, A20, A21): 情绪周期, the chapter 二
 * (P0156–P0163) and P0020–P0056, over a `cn-market` run's limit-up pools and index evidence. Three
 * headline fields - `state`, one of the seven states, `money_effect` and `freeze_type` (冰点: none,
 * at the ice point, the session after it) - and a `conflict`, the indicators that disagree, which an
 * `OK` artifact must carry when its `state` is `UNKNOWN` (system-design §4). A `state` other than
 * `UNKNOWN` rests on at least two cited ids of limit-up evidence and one of index evidence, across
 * the claims that are not INSUFFICIENT. The module owns the sentiment and whole-market assertion
 * classes, each carried by a derived item (the core's default). `lib/module-tool.mjs` consumes the
 * `contract` object; the shared rules are `contract-core.mjs`'s.
 */
import { fail } from "../contract-core.mjs";

const STATES = ["UNKNOWN", "CHAOS", "IGNITION", "EXPANSION", "CLIMAX", "RETREAT", "REPAIR"];

/** Hypothesis 2 of strategies/cn-market/THESIS.md, in the tree's own words, paragraph ids only. */
export const HYPOTHESES =
  "H2 情绪周期（二 P0156–P0163，P0020–P0056）：短线情绪由涨停、连板、炸板与昨日涨停股的次日表现共同刻画，由本运行冻结的涨停池、炸板池、昨日涨停与宿主算出的派生量读出。" +
  `情绪在若干状态间轮转，状态取 ${STATES.join("、")} 七个之一。` +
  "这些状态是可修订的工作标签，不是事实；下一交易日的冻结证据可以推翻它。" +
  "指标彼此矛盾时状态写 UNKNOWN，并写明哪些指标相互矛盾。";

const HINTS = {
  state:
    `${STATES.join("、")} 之一：不是 UNKNOWN 时，所有不为 INSUFFICIENT 的声明合计至少引用两条涨停证据（涨停池、炸板池、昨日涨停的行，或 limit-up 的派生量）和一条指数证据（家数计数 counts 或 index 的派生量）。`,
  money_effect: "POSITIVE、MIXED、NEGATIVE 或 UNKNOWN：赚钱效应，宜按 yesterday_return_median 与 yesterday_negative_tail 判断。",
  freeze_type: "NONE、ICE_POINT、POST_ICE 或 UNKNOWN：冰点读数，NONE 不在冰点，ICE_POINT 本交易日即冰点，POST_ICE 冰点后的一个交易日。",
  conflict:
    "status 为 OK 且 state 为 UNKNOWN 时必填，不超过 200 字：写出相互矛盾的指标名（如 seal_ratio 与 yesterday_negative_tail）及其方向。此字段不引证据，所以不写“情绪、赚钱效应、冰点、全市场、涨跌家数”等词。",
  claims:
    "每条声明写一个事实并引用证据编号；含“情绪、情绪周期、赚钱效应、亏钱效应、冰点、全市场、市场广度、涨跌家数”的句子须同时引用一条派生证据（derived）。本模块不写题材、主线、龙头、指数类断言。" +
    "advance_decline_ratio 在文字里写作“上涨与下跌家数之比”。",
  basis:
    "CURRENT 指本运行的交易日（上下文 session），须至少引用一条 scope 为 CURRENT 的证据；更早交易日的证据一律 HISTORICAL，文字不用“当前、今日”等词；证据不足用 INSUFFICIENT，此时标题字段写 UNKNOWN。",
  rows: "涨停池按连板数从高到低、昨日涨停按涨跌幅从低到高列出；指数报价与日线不在本模块的列表里，计入 truncated，指数证据请引用 counts 或 index 的派生量。",
  status: "status_expected 为 NOT_EVALUABLE 时照 example 提交：missing_sources 照抄 missing，标题字段一律 UNKNOWN，不写 conflict。",
  example:
    "example 只示格式：标题字段为 UNKNOWN，声明为 INSUFFICIENT，conflict 只示写法，不是判断。写出 UNKNOWN 以外的状态，须有不为 INSUFFICIENT 的声明合计引用两条涨停证据和一条指数证据。",
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
/** Index evidence: an index quote, the all-shares counts, or an index derived item - not bars. */
const isIndex = (entry) => entry.source === "index" && (entry.kind === "index" || entry.kind === "counts" || entry.kind === "derived");

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
 * conflict; any other state stands on two limit-up ids and one index id across its claims.
 */
function rules(parsed, context) {
  if (parsed.state === "UNKNOWN") {
    if (parsed.status === "OK" && parsed.conflict === undefined) fail("analysis.conflict: required.");
    return;
  }
  if (idsCited(parsed, context, isLimitUp).size < 2 || idsCited(parsed, context, isIndex).size < 1)
    fail("analysis.state: a state other than UNKNOWN needs, across its claims not INSUFFICIENT, two evidence references to limit-up evidence and one to index evidence.");
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
 * sources when any is, else `OK` with UNKNOWN headlines, a format-only conflict and one
 * INSUFFICIENT claim citing one of the digest's ids.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function example(digest) {
  const envelope = {
    module: digest.module, contract_version: digest.contract_version, hypotheses_version: digest.hypotheses_version,
    snapshot_id: digest.snapshot_id, run: digest.run, as_of: digest.as_of, session: digest.session,
  };
  const unknown = { state: "UNKNOWN", money_effect: "UNKNOWN", freeze_type: "UNKNOWN" };
  if (digest.missing.length > 0)
    return {
      ...envelope, status: "NOT_EVALUABLE", missing_sources: [...digest.missing], ...unknown,
      claims: [], limitations: [`缺少 ${digest.missing.join("、")} 证据，无法评估。`],
    };
  const cited = firstId(digest, (entry) => isLimitUp(entry) && entry.kind === "derived") ?? firstId(digest, () => true);
  const claims = cited === undefined ? [] : [{
    id: "c1", basis: "INSUFFICIENT", evidence_ids: [cited],
    text: "示例：所引证据只示格式；按读数改写本声明的 basis 与文字，再填标题字段。",
  }];
  return {
    ...envelope, status: "OK", missing_sources: [], ...unknown,
    conflict: "示例：写出读数相互矛盾的指标名及其方向，例如 seal_ratio 偏高而 yesterday_negative_tail 扩大。",
    claims, limitations: [],
  };
}

/** Rows by a numeric field, `sign` 1 ascending and -1 descending, a null last. */
const byNumber = (field, sign) => (a, b) =>
  (typeof a[field] !== "number") - (typeof b[field] !== "number") || sign * ((a[field] ?? 0) - (b[field] ?? 0));

/** @type {import("../module-tool.mjs").ModuleContract} */
export const contract = {
  schema: SCHEMA,
  owns: ["sentiment", "market"],
  rules,
  hypotheses: HYPOTHESES,
  hints: HINTS,
  example,
  sources: ["limit-up", "index"],
  required: ["limit-up", "index"],
  derivedFirst: ["limit-up"],
  priority: [
    { source: "index", kind: "counts" },
    { source: "limit-up", kind: "zt", order: byNumber("boards", -1) },
    { source: "limit-up", kind: "zb" },
    { source: "limit-up", kind: "yesterday", order: byNumber("pct", 1) },
  ],
};
