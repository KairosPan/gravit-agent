// face/plugins/lunhui/lib/contracts/leader.mjs
/**
 * The leader module's contract (modules spec §5.4, §5.6, A21, A27): 龙头与个股地位, the chapter 四
 * (P0654–P1340), over a strategy run's frozen quotes and the cited `cn-market` run's limit-up pools,
 * member lists and accepted theme and sentiment artifacts. Two headline fields - `leader_candidates`,
 * at most five, each with its 顺位 `rank`, and `top_pattern_flags`. Each candidate is an equity quote
 * the strategy run froze whose six-digit code a pool row or a member list of the cited run holds; it
 * cites the quote and that row or list, its `name` is the quote's frozen name - carved out of the
 * forbidden-word and scope rules (`exemptPaths`), as theme's board names are - and its `board`, when
 * given, is one the cited run's theme artifact names among its mainline candidates; anything else is
 * `REFERENCE`. The ranks run 1 to n. Flags other than `NONE` stand on a claim of their own citing a
 * pool row. The module owns the leader class (龙头, 空间板), carried by a quote, a pool row or a
 * member list; a 龙头 is written only as 龙头候选 of a listed candidate. The theme artifact is
 * required (`market:theme`). `lib/module-tool.mjs` consumes the `contract` object; the shared rules
 * are `contract-core.mjs`'s.
 */
import { fail } from "../contract-core.mjs";
import { DERIVED_HINT, derivedRow, exampleOf, ownClaims } from "./shared.mjs";

/** Chapter 四 of the manuscript, in the tree's own words, paragraph ids only. */
export const HYPOTHESES =
  "龙头与个股地位（四 P0654–P1340）：个股在短线结构中的地位，由引用的市场运行冻结的涨停池（连板数、首次与最后封板时间、炸板次数）与概念板块成分股读出，并以本运行冻结的报价核对。" +
  "地位是相对的：顺位只在引用的市场运行的主线候选之内排列，不在其涨停池或成分股中的个股不列为候选。" +
  "龙头只是一个可修订的候选标签（龙头候选），不是结论；下一交易日的冻结证据可以推翻它。" +
  "形态标记只描述冻结行的样子，不是打法名称。";

const BOARD_RE = /^BK\d{4}$/;

const FLAGS = ["ACCELERATING", "DIVERGENCE", "BROKEN_STREAK", "HIGH_POSITION", "FIRST_BOARD", "NONE"];

const HINTS = {
  derived: DERIVED_HINT,
  rows:
    "evidence 先列本运行冻结的个股报价（source 为 quotes），再列引用的市场运行的涨停池行（market:limit-up：zt 涨停、zb 炸板、yesterday 昨日涨停）与板块成分股（market:boards，members 只列代码）；各行不列 host、delayed 与报价的 validity，冻结文件逐行保留。",
  leader_candidates:
    "0–5 个候选，每个 { symbol, name, rank, board, evidence_ids }：symbol 是本运行冻结的个股报价（sh 或 sz 加六位数字，不是指数）；它的六位代码须出现在引用的市场运行的一条涨停池行或一条成分股列表里；" +
    "evidence_ids 至少引用它的报价，和含它代码的那条涨停池行或成分股列表；同一 symbol 只列一次；没有把握时给空列表。",
  name: "name 照抄该报价证据的 name，一字不改；它是冻结的数据，不受用词检查，所以只写证券名，不写判断。",
  rank: "rank 是顺位：在引用的市场运行的主线候选之内排列，1 为首位；n 个候选的 rank 恰为 1 到 n，各用一次。",
  board: "board 是候选所在的主线候选板块代码，只能是 theme 工件 mainline_candidates 里的板块；不确定时写 null。",
  top_pattern_flags:
    "0–5 个形态标记，只描述冻结行的样子：ACCELERATING 加速（连板中封板更早）、DIVERGENCE 分歧（炸板或回封）、BROKEN_STREAK 断板（昨日涨停今日未封）、HIGH_POSITION 高位（连板数高）、FIRST_BOARD 首板；没有就给空列表或只写 NONE。" +
    "除 NONE 外的标记须有一条不为 INSUFFICIENT 的声明引用一条市场涨停池行（market:limit-up）。",
  claims:
    "每条声明写一个事实并引用证据编号；含“龙头、空间板”的句子须同时引用一条报价、涨停池行或成分股列表，且“龙头”只写作已列出候选的“龙头候选”，不写成结论。" +
    "本模块不写题材、主线、轮动、情绪、全市场、指数类断言：板块写代码或名称，主线候选的依据引用 theme 工件编号即可，句中不用这些词。",
  artifacts:
    "artifacts 列引用的市场运行已接受的 theme 与 sentiment 工件（标题字段与至多 6 条声明），按 id（<module>@<snapshot_id>）引用；引用的市场运行与本运行同一交易日时它们是 CURRENT 证据，否则是 HISTORICAL。",
  basis:
    "CURRENT 指本运行的交易日（上下文 session），须至少引用一条 scope 为 CURRENT 的证据；更早交易日的证据一律 HISTORICAL，文字不用“当前、今日”等词；证据不足用 INSUFFICIENT，此时标题字段为空列表。",
  status: "status_expected 为 NOT_EVALUABLE 时照 example 提交：missing_sources 照抄 missing，leader_candidates 与 top_pattern_flags 为空列表。",
  example:
    "example 只示格式：没有候选，没有标记，声明为 INSUFFICIENT，不是判断。信封的 market_run 与 market_snapshot_id 照抄上下文。",
};

const SCHEMA = {
  required: ["leader_candidates", "top_pattern_flags"],
  properties: {
    leader_candidates: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        required: ["symbol", "name", "rank", "board", "evidence_ids"],
        properties: {
          symbol: { type: "string", pattern: "^(sh|sz)\\d{6}$" },
          name: { type: "string", minLength: 1, maxLength: 20 },
          rank: { enum: [1, 2, 3, 4, 5] },
          // A string or null: `rules` checks it, the core's schema keywords having no union.
          board: { type: ["string", "null"], pattern: "^BK\\d{4}$" },
          evidence_ids: {
            type: "array", minItems: 1, maxItems: 16, uniqueItems: true,
            items: { type: "string", pattern: "^ev_[a-f0-9]{24}$" },
          },
        },
      },
    },
    top_pattern_flags: { type: "array", minItems: 0, maxItems: 5, uniqueItems: true, items: { enum: FLAGS } },
  },
};

/** An equity quote of the strategy run. */
const isQuote = (entry) => entry.source === "quotes" && entry.kind === "quote" && entry.item.instrument === "equity";
/** A pool row of the cited market run: 涨停, 炸板 or 昨日涨停. */
const isPoolRow = (entry) => entry.source === "market:limit-up" && entry.kind !== "derived";
/** A member list of the cited market run. */
const isMembers = (entry) => entry.source === "market:boards" && entry.kind === "members";

/** The items that carry the leader class's sentences (A21): a quote, a pool row or a member list. */
const carriesLeader = (entry) => isQuote(entry) || isPoolRow(entry) || isMembers(entry);

/** Whether a pool row or a member list of the cited run holds the six-digit `code`. */
function holds(entry, code) {
  if (isPoolRow(entry)) return entry.item.code === code;
  return isMembers(entry) && Array.isArray(entry.item.members) && entry.item.members.some((member) => member?.code === code);
}

/**
 * The boards the cited run's accepted theme artifact names among its mainline candidates.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 * @returns {string[]}
 */
function themeBoards(digest) {
  for (const entry of digest.artifacts.values())
    if (entry.source === "market:theme" && Array.isArray(entry.artifact.mainline_candidates))
      return entry.artifact.mainline_candidates.map((candidate) => candidate?.board).filter((board) => typeof board === "string");
  return [];
}

/**
 * The hints, with `boards`: the mainline candidates' boards of the cited theme artifact, from the digest.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function hints(digest) {
  const boards = themeBoards(digest);
  return { ...HINTS, boards: boards.length ? `theme 工件的主线候选板块：${boards.join("、")}。` : "theme 工件没有主线候选板块：board 一律写 null。" };
}

/**
 * The module's own rules, after the shared ones: each candidate an equity quote the run froze, its
 * code held by a pool row or a member list of the cited run, both cited, under the quote's name, on
 * a board of the theme artifact's candidates or none, and no symbol twice; the ranks 1 to n; flags
 * other than NONE on a claim of their own citing a pool row.
 */
function rules(parsed, context) {
  const boards = themeBoards(context);
  const items = [...context.items];
  const seen = new Set();
  for (const [i, candidate] of parsed.leader_candidates.entries()) {
    const path = `analysis.leader_candidates[${i}]`;
    if (candidate.board !== null && (typeof candidate.board !== "string" || !BOARD_RE.test(candidate.board)))
      fail(`${path}.board: invalid string.`);
    const quote = items.find(([, entry]) => isQuote(entry) && entry.item.symbol === candidate.symbol);
    if (!quote) fail(`${path}.symbol: a candidate needs an equity quote this run froze; no such evidence reference.`);
    const code = candidate.symbol.slice(-6);
    const homes = items.filter(([, entry]) => holds(entry, code)).map(([id]) => id);
    if (homes.length === 0)
      fail(`${path}.symbol: a candidate's code needs a pool row or a member list of the cited market run; no such evidence reference.`);
    if (!candidate.evidence_ids.includes(quote[0]) || !homes.some((id) => candidate.evidence_ids.includes(id)))
      fail(`${path}: a candidate needs an evidence reference to its quote and to a pool row or member list holding its code.`);
    if (candidate.name !== quote[1].item.name)
      fail(`${path}.name: a candidate's name must be the name of the quote evidence reference it cites, unchanged.`);
    if (candidate.board !== null && !boards.includes(candidate.board))
      fail(`${path}.board: a candidate's board must be a mainline candidate of the cited theme artifact; no such evidence reference.`);
    if (seen.has(candidate.symbol)) fail(`${path}.symbol: one candidate per symbol; this quote evidence reference is named twice.`);
    seen.add(candidate.symbol);
  }
  const count = parsed.leader_candidates.length;
  const ranks = new Set(parsed.leader_candidates.map((candidate) => candidate.rank));
  if (ranks.size !== count || [...ranks].some((rank) => rank > count))
    fail(`analysis.leader_candidates: invalid fixed value; the ranks are 1 to ${count}, each once.`);
  const flags = parsed.top_pattern_flags;
  if (flags.includes("NONE") && flags.length > 1) fail("analysis.top_pattern_flags: invalid enum; NONE stands alone.");
  // The set of flags is one demand: UNKNOWN when there is none to stand on.
  const flagged = flags.length > 0 && flags[0] !== "NONE";
  ownClaims({ claims: parsed.claims, top_pattern_flags: flagged ? flags : "UNKNOWN" }, context, [
    { field: "top_pattern_flags", test: isPoolRow, needs: "a limit-up pool row of the cited market run" },
  ]);
}

/**
 * The context's example (`exampleOf`): no candidate, no flag and, in an OK run, one INSUFFICIENT
 * claim citing an equity quote.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function example(digest) {
  return exampleOf(digest, { leader_candidates: [], top_pattern_flags: [] }, isQuote);
}

/** A quote without its validity block and provider: the file keeps them. */
function quoteRow({ validity, provider, ...item }) {
  return item;
}

/** A pool row as the leader reads it: who, how high, when sealed, how often broken. */
function poolRow(item) {
  const keep = ["pool", "code", "name", "pct", "boards", "firstSealAt", "lastSealAt", "breakCount", "yesterdayBoards", "yesterdaySealAt", "streak", "industry"];
  return Object.fromEntries(keep.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]));
}

/** A member list as its codes, every one the freeze kept. */
function memberCodes({ kind, board, truncated, members }) {
  return { kind, board, truncated, members: Array.isArray(members) ? members.map((member) => member?.code) : [] };
}

/** @type {import("../module-tool.mjs").ModuleContract} */
export const contract = {
  schema: SCHEMA,
  owns: ["leader"],
  ownedBy: { leader: carriesLeader },
  exemptPaths: ["leader_candidates[*].name"],
  rules,
  hypotheses: HYPOTHESES,
  hints,
  example,
  sources: ["quotes"],
  required: ["quotes", "market:theme"],
  derivedView: derivedRow,
  priority: [
    { source: "quotes", kind: "quote", view: quoteRow },
    { source: "market:limit-up", kind: "zt", view: poolRow },
    { source: "market:limit-up", kind: "zb", view: poolRow },
    { source: "market:limit-up", kind: "yesterday", view: poolRow },
    { source: "market:boards", kind: "members", view: memberCodes },
  ],
  marketRun: "required",
  marketSources: ["limit-up", "boards"],
  marketArtifacts: ["theme", "sentiment"],
};
