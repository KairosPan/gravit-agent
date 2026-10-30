// face/plugins/lunhui/lib/contracts/theme.mjs
/**
 * The theme module's contract (modules spec §5.4, §5.6, A20, A21): 题材与轮动, the 题材 pages
 * (P0075–P0153) and the chapter 六 (P1345–P1464), over a `cn-market` run's concept boards and
 * limit-up pools. Three headline fields - `mainline_candidates`, at most five, `theme_stage` and
 * `rotation`. Each candidate stands on a frozen board: it cites that board's `board` item and its
 * `members` item, and its `name` is the board's frozen name - so the name, data of the freeze, is
 * carved out of the forbidden-word and scope rules (`exemptPaths`), and a code the run did not
 * freeze is `REFERENCE`. A `theme_stage` or `rotation` other than `UNKNOWN` stands on a claim of its
 * own citing a boards derived item. The module owns the theme assertion class (题材, 主线, 轮动),
 * carried by a derived item of the boards source. Derived items are shown with their inputs
 * counted, not listed: each `turnover_share` cites every fetched board. Board, member-list and flow
 * rows are shown without their per-item `host` and `delayed` (and a board without its `leader`), so
 * every one of the ten member lists a freeze reads fits; the hints state the boards source's hosts
 * and delay once, from the digest, and the evidence file keeps every stamp. `lib/module-tool.mjs` consumes the `contract` object; the
 * shared rules are `contract-core.mjs`'s.
 */
import { BOARD_CODE_PATTERN, fail } from "../contract-core.mjs";
import { DERIVED_HINT, derivedRow, exampleOf, ownClaims } from "./shared.mjs";

/** The members a context shows of a board's list: the first 10; the frozen file keeps them all. */
const MEMBERS_SHOWN = 10;

/** Hypothesis 3 of strategies/cn-market/THESIS.md, in the tree's own words, paragraph ids only. */
export const HYPOTHESES =
  "H3 题材与轮动（P0075–P0153，六 P1345–P1464）：资金在题材之间集中与切换，由本运行冻结的概念板块、成分股、板块资金流、涨停池与宿主算出的派生量读出。" +
  "主线候选应同时表现为板块广度、涨停集中和成交占比，单一个股的上涨不构成题材。" +
  "每个主线候选落在一个已冻结的板块上，引用该板块及其成分股。" +
  "题材所处阶段与轮动方向是可修订的工作标签，下一交易日的冻结证据可以推翻它。";

const HINTS = {
  derived: DERIVED_HINT,
  rows: "板块行只列代码、名称、涨跌幅、成交额与上涨、下跌家数（不列领涨股）；板块、成分股与资金流各行不列 host 与 delayed，见 served；冻结文件逐行保留。",
  mainline_candidates:
    "0–5 个主线候选，每个 { board, name, evidence_ids }：board 是本运行已冻结的板块代码（BK 加四位数字，或 THS: 加概念名，照冻结的写），evidence_ids 至少引用该板块的 board 证据与它的 members 证据（同一代码），可再引用它的 breadth、turnover_share；同一板块只列一次；没有把握时给空列表。",
  name: "name 照抄该板块 board 证据的 name，一字不改；它是冻结的数据，不受用词检查，所以只写板块名，不写判断。",
  theme_stage:
    "START、FERMENT、DIVERGE、CLIMAX、FADE、CHAOS 或 UNKNOWN：题材所处阶段（启动、发酵、分歧、高潮、退潮、混沌）；不是 UNKNOWN 时，须有一条不为 INSUFFICIENT 的声明引用一条 boards 的派生量，且不是支撑 rotation 的那一条。",
  rotation:
    "NONE、HIGH_LOW_SWITCH、NEW_DIRECTION、ROTATING 或 UNKNOWN：轮动方向（无、高低切换、新方向、轮转）；不是 UNKNOWN 时，须有一条不为 INSUFFICIENT 的声明引用一条 boards 的派生量，且不是支撑 theme_stage 的那一条。",
  claims:
    "每条声明写一个事实并引用证据编号；含“题材、主线、板块轮动、轮动”的句子须同时引用一条 boards 的派生证据（breadth 或 turnover_share）。本模块不写情绪、全市场、龙头、指数类断言。" +
    "turnover_share 在文字里写作“成交占比”，不写“成交额”：那是本模块不拥有的指数类断言，会被拒绝。",
  basis:
    "CURRENT 指本运行的交易日（上下文 session），须至少引用一条 scope 为 CURRENT 的证据；更早交易日的证据一律 HISTORICAL，文字不用“当前、今日”等词；证据不足用 INSUFFICIENT，此时标题字段写 UNKNOWN。",
  members:
    `成分股只列前 ${MEMBERS_SHOWN} 只，members_total 是冻结的只数；证据编号指整条列表。成分股证据自带的 truncated 字段为 true，表示来源只给了前 100 只、冻结时已被截断；它与上下文顶层的 truncated 列表（本摘要因 30 KiB 上限未列出的行，按来源与种类计数）是两回事。` +
    "涨停池只列代码、名称、连板数与所属行业；炸板池与昨日涨停未列出，计入顶层 truncated。boards 的派生量是 breadth 与 turnover_share（params.board 为板块代码）；其余派生量属于 limit-up。",
  status: "status_expected 为 NOT_EVALUABLE 时照 example 提交：missing_sources 照抄 missing，mainline_candidates 为空列表，其余标题字段为 UNKNOWN。",
  example:
    "example 只示格式：没有候选，标题字段为 UNKNOWN，声明为 INSUFFICIENT，不是判断。列出主线候选，须引用该板块的 board 与 members 证据；theme_stage、rotation 各需一条自己的、引用 boards 派生证据的声明。",
};

const SCHEMA = {
  required: ["mainline_candidates", "theme_stage", "rotation"],
  properties: {
    mainline_candidates: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        required: ["board", "name", "evidence_ids"],
        properties: {
          board: { type: "string", pattern: BOARD_CODE_PATTERN },
          name: { type: "string", minLength: 1, maxLength: 40 },
          evidence_ids: {
            type: "array", minItems: 1, maxItems: 16, uniqueItems: true,
            items: { type: "string", pattern: "^ev_[a-f0-9]{24}$" },
          },
        },
      },
    },
    theme_stage: { enum: ["START", "FERMENT", "DIVERGE", "CLIMAX", "FADE", "CHAOS", "UNKNOWN"] },
    rotation: { enum: ["NONE", "HIGH_LOW_SWITCH", "NEW_DIRECTION", "ROTATING", "UNKNOWN"] },
  },
};

/**
 * The hints, with `served`: the boards source's hosts and delay, stated once from the digest's rows
 * (each row's own stamp is left out of the context).
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function hints(digest) {
  const rows = [...digest.items.values()].filter((entry) => entry.source === "boards" && entry.kind !== "derived").map((entry) => entry.item);
  if (rows.length === 0) return HINTS;
  const hosts = [...new Set(rows.map((row) => row.host).filter((host) => typeof host === "string"))].join("、") || "未记录";
  const delayed = rows.some((row) => row.delayed === true);
  if (rows.some((row) => row.provider === "同花顺问财"))
    return { ...HINTS, served: "板块来自同花顺问财（同花顺概念；涨跌幅为成分股等权平均，不是指数）；各行来自 quantapi.51ifind.com，均非延时行情。" };
  return { ...HINTS, served: `boards 各行来自 ${hosts}；${delayed ? "其中有延时行情（delayed 为 true）" : "均非延时行情（delayed 为 false）"}。` };
}

/** The items that carry the theme class's sentences (A21): a derived item of the boards source. */
const carriesTheme = (entry) => entry.source === "boards" && entry.kind === "derived";

/**
 * The id and entry of the boards item of `kind` whose `field` is `code`, or undefined.
 * @param {import("../contract-core.mjs").ContextDigest} context
 */
function boardsItem(context, kind, field, code) {
  for (const [id, entry] of context.items)
    if (entry.source === "boards" && entry.kind === kind && entry.item[field] === code) return { id, entry };
  return undefined;
}

/**
 * The module's own rules, after the shared ones: each candidate names a board the run froze, with
 * its member list, cites both items, carries the board's own name, and no board twice; a stage or a
 * rotation other than UNKNOWN each on a claim of its own citing a boards derived item.
 */
function rules(parsed, context) {
  const seen = new Set();
  for (const [i, candidate] of parsed.mainline_candidates.entries()) {
    const path = `analysis.mainline_candidates[${i}]`;
    const board = boardsItem(context, "board", "code", candidate.board);
    const members = boardsItem(context, "members", "board", candidate.board);
    if (!board || !members)
      fail(`${path}.board: a candidate needs a board this run froze with its member list; no such evidence reference.`);
    if (!candidate.evidence_ids.includes(board.id) || !candidate.evidence_ids.includes(members.id))
      fail(`${path}: a candidate needs an evidence reference to its board item and to its members item, both of its own code.`);
    if (candidate.name !== board.entry.item.name)
      fail(`${path}.name: a candidate's name must be the name of the board evidence reference it cites, unchanged.`);
    if (seen.has(candidate.board)) fail(`${path}.board: one candidate per board; this board evidence reference is named twice.`);
    seen.add(candidate.board);
  }
  ownClaims(parsed, context, [
    { field: "theme_stage", test: carriesTheme, needs: "a boards derived item" },
    { field: "rotation", test: carriesTheme, needs: "a boards derived item" },
  ]);
}

/**
 * The context's example (`exampleOf`): no candidate, UNKNOWN headlines and, in an OK run, one
 * INSUFFICIENT claim citing a boards derived item.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function example(digest) {
  return exampleOf(digest, { mainline_candidates: [], theme_stage: "UNKNOWN", rotation: "UNKNOWN" }, carriesTheme);
}

/** A member list cut to its first `MEMBERS_SHOWN` members, the frozen count beside them. */
function firstMembers(item) {
  return { ...unstamped(item), members: item.members.slice(0, MEMBERS_SHOWN), members_total: item.members.length };
}

/** A board, member-list or flow row without its per-item stamps; a board without its leader. */
function unstamped({ host, delayed, leader, ...item }) {
  return item;
}

/** A zt row as the theme reads it: who, how many boards, which industry. */
function ztIndustry({ pool, code, name, boards, industry }) {
  return { pool, code, name, boards, industry };
}

/** @type {import("../module-tool.mjs").ModuleContract} */
export const contract = {
  schema: SCHEMA,
  owns: ["theme"],
  ownedBy: { theme: carriesTheme },
  exemptPaths: ["mainline_candidates[*].name", "mainline_candidates[*].board"],
  rules,
  hypotheses: HYPOTHESES,
  hints,
  example,
  sources: ["boards", "limit-up"],
  required: ["boards", "limit-up"],
  derivedFirst: ["boards"],
  derivedView: derivedRow,
  priority: [
    { source: "boards", kind: "board", view: unstamped },
    // A candidate cites its board and its member list: both before the fund flow, which only adds to them.
    { source: "boards", kind: "members", view: firstMembers },
    { source: "boards", kind: "flow", view: unstamped },
    { source: "limit-up", kind: "zt", view: ztIndustry },
  ],
};
