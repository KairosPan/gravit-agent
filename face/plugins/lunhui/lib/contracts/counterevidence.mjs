// face/plugins/lunhui/lib/contracts/counterevidence.mjs
/**
 * The counterevidence module's contract (modules spec §5.4, §5.6, A6, A21, A22): the reviewer's
 * artifact, read against the ten rulings of strategy-spec §7 and its §5, written by `cn-reviewer`
 * before the mode, in either channel. One headline field, `items` - 0 to 12 of `{ id, against,
 * kind, text, evidence_ids }`, an `x` id each, unique; `against` a module whose accepted artifact
 * the context shows, never `mode` or `counterevidence`; `kind` one of five; `text` at most 160
 * characters; `evidence_ids` unique and at least one an evidence id, not only artifact ids - an item
 * with none, or resting only on the artifact it is against, is `REFERENCE`. An empty `items` is a
 * review that found nothing, a result. The reviewer may deny any reading (A21, "counterevidence
 * may deny any of them"): the module owns every assertion class, carried by any cited evidence
 * item, and an item's strings are scoped by its own `evidence_ids` (`scopedFields`), so each such
 * sentence still cites evidence.
 *
 * The channel picks the contract (`forStrategy`, read by `lib/module-tool.mjs`): in `cn-market` the
 * run is itself the market run - its index, limit-up and boards evidence and its accepted
 * environment, sentiment and theme artifacts, no `market_run` (`WRONG_CHANNEL` when given), and a
 * run with none of the three accepted is `NOT_EVALUABLE` naming them (`requiredAny`); in any other
 * strategy `market_run` is required, the context reads the run's quotes and accepted leader
 * artifact - required, and refused `MISSING_EVIDENCE` at the read when it cites another market run
 * (`extra`) - beside the cited run's evidence and three artifacts, and the artifact carries the
 * bound `market_run` and `market_snapshot_id`. The shared rules are `contract-core.mjs`'s.
 */
import { CITED_ID_PATTERN, SCOPE_CLASSES, fail } from "../contract-core.mjs";
import { refuse } from "../errors.mjs";
import { MARKET_CHANNEL } from "../freeze-tool.mjs";
import { MODULES } from "../modules.mjs";
import { derivedRow, exampleOf, poolRow, quoteRow } from "./shared.mjs";

/** The ten rulings (strategy-spec §7) and §5, by topic in the tree's own words, paragraph ids only. */
export const HYPOTHESES =
  "反证审查（策略规格 §7 的十条裁决与 §5 的通用管理）：审查员在 mode 之前读取本运行已接受的工件（策略频道另加引用的市场运行的证据与工件），" +
  "逐项指出与冻结证据相悖、证据不足、时效不符、与裁决冲突或断言越界之处；什么也没找到时给空列表，那也是一个结果。" +
  "十条裁决的主题：混沌阶段不套用通用的一进二，退潮时照样否决（P0016 对 P0574、P0782、P0855）；" +
  "极端低点之后不预设必然反弹，要等分歧之后的联合确认（P0536 对 P0534、P0454）；" +
  "不拿事后的成败去认定谁是真龙头，事前列出的候选连同后来失败的都留在样本里（P0755–P0757）；" +
  "个股走强压不过全市场的退潮，状态否决在先（P0780–P0784 对 P0822–P0823、P1272）；" +
  "断板本身不足以说明切换，要看同一篮子的负反馈（P0403 对 P0285–P0288）；" +
  "竞价量的大小不按固定比例或单向假设解读，目前只看不用（P0874、P0888、P0819）；" +
  "启动期的高潮与见顶期的高潮分开读，CLIMAX 不登记新的模式，状态不明就等待（P0337–P0348）；" +
  "规模预算与价格区间各自独立，不因别的生态而放宽（P0205–P0217 对 P1110）；" +
  "保本、无抛压、无风险一类说法不当作结论，复盘把无法成交与连续下跌算进去（P0524、P0744–P0745、P1093–P1094、P1525）；" +
  "不许诺倍数收益或节后必然反抽，样本包括当时全部的候选（P0068、P1157、P1694–P1697）。" +
  "通用管理（§5）：数据缺失或互相矛盾时等待（P0011–P0012）；退潮与题材证伪先于任何叙事（P0302、P0440–P0441、P0013、P0378）。";

/** The five kinds of an item. */
export const KINDS = ["CONTRADICTS", "MISSING_EVIDENCE", "STALE", "RULING_CONFLICT", "OVERREACH"];

/** The modules an item is never against: the mode, chosen after the review, and the review itself. */
const NEVER_AGAINST = new Set(["mode", "counterevidence"]);

/** The member codes a context shows of a board's list. */
const MEMBERS_SHOWN = 10;

const HINTS = {
  order:
    "审查员在 mode 之前运行（A22）：市场频道在三个市场工件之后，策略频道在 leader 工件之后、mode 之前；mode 登记 S01、S02 时须按 x 编号逐项回应这里的每一项。",
  items:
    "items 0–12 项，每项 { id, against, kind, text, evidence_ids }：id 为 x 加一到两位数字，各项不重复；against 是上下文 artifacts 列出的工件所属的模块，不是 mode，也不是 counterevidence；" +
    "text 至多 160 字，写清相悖、缺失、过期或越界的是什么；evidence_ids 0–16 个不重复的编号，至少一个是证据编号（ev_…），可另加工件编号（<module>@<snapshot_id>）；只引用被质疑的工件本身、没有证据编号的一项即 REFERENCE。",
  kinds:
    "kind 五种：CONTRADICTS 冻结证据与工件的读数相悖；MISSING_EVIDENCE 工件的结论缺少证据支撑；STALE 工件把更早交易日的证据当作本运行交易日的；RULING_CONFLICT 与十条裁决或通用管理冲突（text 写明是哪一条的主题）；OVERREACH 断言超出所引证据或该模块的范围。",
  rulings: [
    "混沌阶段不套用通用的一进二", "极端低点之后不预设必然反弹", "不以事后成败认定真龙头", "个股走强不覆盖全市场退潮", "断板不足以说明切换",
    "竞价量不按固定比例解读", "两种高潮分开读，CLIMAX 不登记，状态不明即等待", "规模预算与价格区间不因别的生态放宽", "保证性说法不当作结论", "不许诺倍数收益，样本含全部事前候选",
  ],
  empty: "什么也没找到就交空的 items：空列表是一个结果，不是缺漏；此时声明可照 example 为 INSUFFICIENT。",
  scope:
    "items 的 text 与声明一样受用词与范围规则约束：含全市场、情绪、题材、龙头、指数一类词的句子，须由该项自己的 evidence_ids 里至少一个证据编号承载；否认任何一个读数都可以，但要有证据。不写交易方向、价位、规模或账户内容。",
  claims:
    "OK 时至少一条声明；items 非空时至少一条声明不为 INSUFFICIENT：CURRENT 须引用一条本运行交易日的证据，HISTORICAL 只引用更早的证据，文字不用“当前、今日”等词。",
  status: "status_expected 为 NOT_EVALUABLE 时照 example 提交：missing_sources 照抄 missing，items 为空列表。",
  example: "example 只示格式：没有反证项，声明为 INSUFFICIENT，不是审查结论。",
};

const SCHEMA = {
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: 0,
      maxItems: 12,
      items: {
        type: "object",
        required: ["id", "against", "kind", "text", "evidence_ids"],
        properties: {
          id: { type: "string", pattern: "^x\\d{1,2}$" },
          against: { enum: MODULES.map((module) => module.name) },
          kind: { enum: KINDS },
          text: { type: "string", minLength: 1, maxLength: 160 },
          // None is the module's REFERENCE, not the schema's: `rules` asks for an evidence id.
          evidence_ids: {
            type: "array", minItems: 0, maxItems: 16, uniqueItems: true,
            items: { type: "string", pattern: CITED_ID_PATTERN },
          },
        },
      },
    },
  },
};

/** An equity quote of the strategy run. */
const isQuote = (entry) => entry.source === "quotes" && entry.kind === "quote";

/**
 * The hints, with `against`: the modules whose accepted artifacts the context reads.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function hints(digest) {
  const modules = [...new Set([...digest.artifacts.values()].map((entry) => entry.module))];
  return {
    ...HINTS,
    against: modules.length ? `本上下文可作 against 的模块：${modules.join("、")}。` : "本上下文没有已接受的工件：items 只能为空。",
    ...(Object.hasOwn(digest, "market_run") ? { envelope: "信封的 market_run 与 market_snapshot_id 照抄上下文。" } : {}),
  };
}

/**
 * The module's own rules, after the shared ones: each item's `x` id once, against a module whose
 * artifact the context shows and never the mode or the review. That each cites an evidence id is
 * the core's (`scopedFields`), checked before the scope rule.
 */
function rules(parsed, context) {
  const shown = new Set([...context.artifactIds].map((id) => context.artifacts.get(id)?.module));
  const seen = new Set();
  for (const [i, item] of parsed.items.entries()) {
    const path = `analysis.items[${i}]`;
    if (seen.has(item.id)) fail(`${path}.id: duplicate values.`);
    seen.add(item.id);
    if (NEVER_AGAINST.has(item.against) || !shown.has(item.against))
      fail(`${path}.against: an item is against a module whose accepted artifact the context shows, never mode or counterevidence; no such evidence reference.`);
  }
}

/**
 * The context's example (`exampleOf`): no item and, in an OK run, one INSUFFICIENT claim citing a
 * quote of the strategy run, or a derived item of the market run.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function example(digest) {
  return exampleOf(digest, { items: [] }, (entry) => isQuote(entry) || entry.kind === "derived");
}

/** A board row without its per-item stamps and its leader. */
function boardRow({ host, delayed, leader, ...item }) {
  return item;
}

/** A member list as codes: its first `MEMBERS_SHOWN`, the frozen count beside them. */
function memberCodes({ kind, board, truncated, members }) {
  const codes = Array.isArray(members) ? members.map((member) => member?.code) : [];
  return { kind, board, truncated, members: codes.slice(0, MEMBERS_SHOWN), members_total: codes.length };
}

/** The six-digit codes of the strategy run's frozen quotes. */
const quoteCodes = (digest) => [...digest.items.values()].filter(isQuote).map((entry) => String(entry.item.symbol).slice(-6));

/** A pool row of a code the strategy run froze. */
const ofQuote = (item, digest) => quoteCodes(digest).includes(item.code);

/**
 * A strategy run's read: the run's leader artifact, when accepted, cites the market run given -
 * one market run per strategy run (A5, A27) - else `MISSING_EVIDENCE` naming the leader's.
 */
async function extra(_runs, _located, { artifacts, market }) {
  const leader = artifacts.leader;
  if (leader !== undefined && leader.market_run !== market?.run)
    throw refuse.marketRunDiffers(typeof leader.market_run === "string" ? leader.market_run : null, "counterevidence");
  return {};
}

/** What both channels' contracts share: the artifact and its rules. */
const SHARED = {
  schema: SCHEMA,
  // The reviewer may deny any reading: every class, carried by any cited evidence item.
  owns: Object.keys(SCOPE_CLASSES),
  ownedBy: Object.fromEntries(Object.keys(SCOPE_CLASSES).map((name) => [name, () => true])),
  scopedFields: ["items"],
  rules,
  hypotheses: HYPOTHESES,
  hints,
  example,
  derivedView: derivedRow,
};

/** In `cn-market`: the run is the market run, its three artifacts the ones reviewed. */
/** @type {import("../module-tool.mjs").ModuleContract} */
export const marketContract = {
  ...SHARED,
  sources: ["index", "limit-up", "boards"],
  required: [],
  requiredAny: ["environment", "sentiment", "theme"],
  runArtifacts: ["environment", "sentiment", "theme"],
  priority: [
    { source: "index", kind: "index" },
    { source: "index", kind: "counts" },
    { source: "limit-up", kind: "zt", view: poolRow },
    { source: "limit-up", kind: "zb", view: poolRow },
    { source: "limit-up", kind: "yesterday", view: poolRow },
    { source: "boards", kind: "board", view: boardRow },
    { source: "boards", kind: "members", view: memberCodes },
  ],
};

/** In another strategy: the run's quotes and leader, the cited market run's evidence and three artifacts. */
/** @type {import("../module-tool.mjs").ModuleContract} */
export const strategyContract = {
  ...SHARED,
  extra,
  sources: ["quotes"],
  required: ["leader"],
  runArtifacts: ["leader"],
  priority: [
    { source: "quotes", kind: "quote", view: quoteRow },
    { source: "market:index", kind: "counts" },
    { source: "market:limit-up", kind: "zt", view: poolRow, filter: ofQuote },
    { source: "market:limit-up", kind: "zb", view: poolRow, filter: ofQuote },
    { source: "market:limit-up", kind: "yesterday", view: poolRow, filter: ofQuote },
    { source: "market:boards", kind: "board", view: boardRow },
    { source: "market:boards", kind: "members", view: memberCodes },
  ],
  marketRun: "required",
  marketSources: ["index", "limit-up", "boards"],
  marketArtifacts: ["environment", "sentiment", "theme"],
};

/**
 * The contract `lib/module-tool.mjs` consumes: `market_run` an optional parameter, each read and
 * submit using the contract its strategy picks.
 * @type {import("../module-tool.mjs").ModuleContract}
 */
export const contract = {
  ...SHARED,
  marketRun: "optional",
  forStrategy: (strategy) => (strategy === MARKET_CHANNEL ? marketContract : strategyContract),
};
