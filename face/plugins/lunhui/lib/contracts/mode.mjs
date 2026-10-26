// face/plugins/lunhui/lib/contracts/mode.mjs
/**
 * The mode module's contract (modules spec §5.4, §5.6, A5, A6, A11, A12, A18, A21, A22, E4): 模式选择
 * 与预期, the chapters 三 (P0164–P0452) and 七 (P1610–P1650) and P0159, chosen last over a strategy
 * run's quotes and accepted leader artifact - and the reviewer's counterevidence when accepted - and
 * the cited `cn-market` run's evidence and accepted environment, sentiment and theme artifacts. The
 * conclusion is `S01`, `S02` or `WAIT` (A18). A strategy registers only its own mode (`MODE_FOR`),
 * any other strategy `WAIT` alone. An `S01` or `S02` is a daily registration, not a decision (E4):
 * the cited sentiment `state` in the mode's admitted set, every required precondition listed - met
 * with evidence, or `unmet: no source` for the minute confirmation and S02's catalyst, which no
 * freeze holds, so `S02` is refused today - an accepted counterevidence artifact with every item
 * addressed by id (A6, A22), a frozen expectation card (A12) and the parameter values used, research
 * candidates only. Refusals beside the core's: `INADMISSIBLE_STATE` for a mode the strategy, the
 * state or a missing source does not admit, `UNADDRESSED_COUNTEREVIDENCE` for an item left
 * unanswered; the counterevidence must be accepted OK with an items array and cite the mode's own
 * market run, and an S01 or S02 over none such meets that gate before any answer is checked. Each
 * met precondition cites its own class of evidence - a theme one a mainline board's - and one with
 * no source cites none. A `WAIT` needs none of it and carries no card. A card is at most
 * `CARD_BYTES` of compact JSON (`BYTE_LIMIT`). The previous card is the card of the strategy's
 * newest accepted `mode.json` of an earlier session (read by the service); a WAIT there leaves
 * nothing to grade. When it exists the context shows it - cut to `CARD_BYTES` with
 * `card_truncated` when stored larger (`previousCard`) - and `expectation_review` grades it,
 * naming its run and, unless
 * `NOT_EVALUABLE`, citing an item this run froze. The read refuses `MISSING_EVIDENCE` when the run's
 * leader artifact cites another market run than the one given. The R01–R14 families are `research_only` labels, each its
 * family's registered name; the label is carved out of the forbidden-word and scope rules
 * (`exemptPaths`), as are the precondition names, both bound by `rules`. The module owns no
 * assertion class (A21): it cites artifacts and evidence. The context shows the strategy, its
 * THESIS.md Falsification section and the previous card (`extra`), and of the cited run only what a
 * precondition cites: the index and limit-up derived items, the mainline boards' board, member and
 * derived items, the candidates' pool rows. `lib/module-tool.mjs` consumes the `contract` object;
 * the shared rules are `contract-core.mjs`'s. Its context shows the run's own leader and
 * counterevidence before the market run's sentiment, theme and environment (`artifactViews`): the
 * market run's headline-only, the run's own at two claims of 60 characters.
 */
import { checkSchema, fail } from "../contract-core.mjs";
import { refuse } from "../errors.mjs";
import { DERIVED_HINT, derivedRow, exampleOf, poolRow, quoteRow } from "./shared.mjs";

/** Chapters 三 and 七 and P0159 of the manuscript, in the tree's own words, paragraph ids only. */
export const HYPOTHESES =
  "模式选择与预期（三 P0164–P0452，七 P1610–P1650，P0159）：模式在最后选择，只依据本运行与引用的市场运行已接受的读数，取 S01、S02、WAIT 之一；读数不足、前提不全或来源缺失时为 WAIT。" +
  "S01、S02 是一次每日登记，不是决定：列出日线证据能显示的前提，分钟级确认因没有来源写作未满足，所用参数只是研究候选。" +
  "预期是一张冻结的卡片，写明候选、锚点、状态、触发与否决、窗口、价格区间、观察期与三条分支；下一个运行对照冻结的事实把它评为符合、强于或弱于。" +
  "其他打法族只作 research_only 标签，说明不能选择的理由，不作为结论。";

const MODES = ["S01", "S02", "WAIT"];
const STATES = ["UNKNOWN", "CHAOS", "IGNITION", "EXPANSION", "CLIMAX", "RETREAT", "REPAIR"];

/** The mode each Lunhui strategy may register; any other strategy concludes WAIT only. */
export const MODE_FOR = Object.freeze({ "lunhui-s01-repair": "S01", "lunhui-s02-rotation": "S02" });

/** The preconditions each mode lists (strategy-spec §3–§4, in the tree's names). */
export const REQUIRED_PRECONDITIONS = Object.freeze({
  S01: Object.freeze(["theme_gate", "candidate_before_divergence", "theme_not_falsified", "negative_tail_not_widening", "minute_confirmation"]),
  S02: Object.freeze(["old_theme_retreat", "catalyst", "candidates_pooled", "minute_confirmation"]),
});

/** The preconditions no freeze holds a source for today (E4): stated `unmet: no source`. */
const NO_SOURCE = { S01: ["minute_confirmation"], S02: ["catalyst", "minute_confirmation"] };

/** The no-source precondition that refuses the mode itself (E4): S02's catalyst. */
const GATE = { S02: "catalyst" };

/** The cited sentiment states each mode admits (strategy-spec §3–§4, spec §5.6). */
const ADMITTED = { S01: ["REPAIR", "EXPANSION"], S02: ["CHAOS", "IGNITION", "REPAIR", "EXPANSION"] };

/** The R01–R14 families' registered names (strategy-spec §6), labels only. */
export const R_FAMILIES = Object.freeze({
  R01: "冰点反核/地天", R02: "一进二/竞价弱转强", R03: "加速/高位接力/突破高度", R04: "一字开板/T板/尾盘回封",
  R05: "首阴反包/上影线/出货分时", R06: "二三波/老龙反抽/平台低吸", R07: "补涨/属性发散", R08: "题材轮动/低吸弱方向",
  R09: "事件埋伏/逻辑挖掘", R10: "失败者/梯队/补涨套利", R11: "容量趋势", R12: "20cm/ST/北交/转债生态",
  R13: "新股/次新/临停", R14: "唯一反弹/指数形态择时",
});

/** What a precondition means, for the hints. */
const PRECONDITION_TEXT = {
  theme_gate: "题材此前已过主线门槛，引有主线候选的 theme 工件、或主线板块的板块行、成分股或 boards 派生量",
  candidate_before_divergence: "候选在分歧前已列入，引 leader 工件、候选的报价或涨停池行",
  theme_not_falsified: "题材未被证伪，引同 theme_gate",
  negative_tail_not_widening: "负尾部未扩大，引 yesterday_negative_tail 派生量或 sentiment 工件",
  minute_confirmation: "分钟级确认，今天没有来源",
  old_theme_retreat: "旧线退潮已登记，引 theme 或 sentiment 工件、或 boards 派生量",
  catalyst: "公开可核验的催化，今天没有来源",
  candidates_pooled: "候选在观察窗前已入池，引同 candidate_before_divergence",
};

/** A cited id: an evidence id or an artifact id `<module>@<snapshot_id>`. */
const CITED = { type: "string", pattern: "^(?:ev_[a-f0-9]{24}|[a-z]+@snap_[a-f0-9]{64})$" };
const EVIDENCE = { type: "string", pattern: "^ev_[a-f0-9]{24}$" };
const text = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const list = (items, minItems, maxItems) => ({ type: "array", minItems, maxItems, items });

/** The compact JSON bytes of an expectation card at most, as submitted and as a later context shows it (A12). */
export const CARD_BYTES = 2048;

/** The characters a previous card's string keeps at most when the card is cut to `CARD_BYTES`. */
const CARD_CUT_CHARS = 120;

/** The expectation card (A12, strategy-spec §2.2): strings ≤ 200, lists ≤ 5, compact JSON ≤ `CARD_BYTES`. */
const CARD = {
  type: "object",
  required: ["frozen_version", "candidates", "anchor", "state", "triggers", "vetoes", "window", "price_band", "holding_period", "branches"],
  properties: {
    frozen_version: text(80),
    candidates: { ...list({ type: "string", pattern: "^(sh|sz)\\d{6}$" }, 1, 5), uniqueItems: true },
    anchor: text(200),
    state: { enum: STATES },
    triggers: list(text(200), 1, 5),
    vetoes: list(text(200), 1, 5),
    window: text(200),
    price_band: text(200),
    holding_period: text(200),
    branches: { type: "object", required: ["符合", "强于", "弱于"], properties: { 符合: text(200), 强于: text(200), 弱于: text(200) } },
  },
};

/** The previous card's review (A12). */
const REVIEW = {
  type: "object",
  required: ["previous_run", "grade", "evidence_ids"],
  properties: {
    previous_run: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" },
    grade: { enum: ["符合", "强于", "弱于", "NOT_EVALUABLE"] },
    evidence_ids: { ...list(EVIDENCE, 0, 8), uniqueItems: true },
  },
};

const SCHEMA = {
  required: ["mode", "preconditions", "research_only_matches", "expectation", "expectation_review", "parameters_used", "addressed"],
  properties: {
    mode: { enum: MODES },
    preconditions: list({
      type: "object",
      required: ["id", "name", "status", "evidence_ids"],
      properties: {
        id: { type: "string", pattern: "^p\\d$" },
        name: { enum: Object.keys(PRECONDITION_TEXT) },
        status: { enum: ["met", "unmet", "unmet: no source"] },
        evidence_ids: { ...list(CITED, 0, 8), uniqueItems: true },
      },
    }, 0, 8),
    research_only_matches: list({
      type: "object",
      required: ["family", "label", "reason"],
      properties: { family: { enum: Object.keys(R_FAMILIES) }, label: text(40), reason: { enum: ["data", "ruling", "registration"] } },
    }, 0, 14),
    // An object or null: `rules` checks a card or a review, the core's schema keywords having no union.
    expectation: { ...CARD, type: ["object", "null"] },
    expectation_review: { ...REVIEW, type: ["object", "null"] },
    parameters_used: list({ type: "object", required: ["name", "value", "note"], properties: { name: text(40), value: text(80), note: text(200) } }, 0, 12),
    addressed: list({
      type: "object",
      required: ["item", "response"],
      properties: { item: { type: "string", pattern: "^x\\d{1,2}$" }, response: text(200), evidence_ids: { ...list(CITED, 0, 8), uniqueItems: true } },
    }, 0, 12),
  },
};

const FAMILY_TEXT = Object.entries(R_FAMILIES).map(([family, name]) => `${family} ${name}`).join("；");

const HINTS = {
  derived: DERIVED_HINT,
  rows:
    "evidence 列本运行的报价（quotes），再列引用的市场运行中前提可依据的行：leader 候选的涨停池行，theme 主线候选板块的板块行与成分股（members 只列前 10 只代码，再加其中的候选）；derived 只列 index、limit-up 与主线候选板块的派生量。其余行计入 truncated，仍可按编号引用。",
  artifacts: "artifacts 先列本运行的 leader、counterevidence 工件（各至多 2 条声明，每条 60 字），再列引用的市场运行的 sentiment、theme、environment 工件（只列标题字段，claims_total 为声明数）；按 id（<module>@<snapshot_id>）引用，evidence_ids 多于 3 个时只列前 3 个，ids_total 为总数。",
  mode: "S01、S02 或 WAIT：只有本策略可登记的模式（见 strategy）且条件全部满足时写 S01 或 S02，其余一律 WAIT；WAIT 不需要前提、回应与卡片，expectation 写 null。",
  preconditions:
    "0–8 条 { id: p1…, name, status, evidence_ids }，id 与 name 各用一次：name 取 " +
    Object.entries(PRECONDITION_TEXT).map(([name, meaning]) => `${name}（${meaning}）`).join("、") +
    "；status 为 met、unmet 或 “unmet: no source”；met 须引用至少一条括号里那一类的证据或工件编号；“unmet: no source” 不引用任何编号。",
  research_only_matches:
    `0–14 条 { family, label, reason }：label 照抄该族登记名（整名或斜杠分隔的一个），reason 为 data、ruling 或 registration；每族一次。登记名：${FAMILY_TEXT}。这些名称只写在 label 里。`,
  expectation:
    "S01、S02 的预期卡：frozen_version 照抄 snapshot_id；candidates 为 leader 工件的候选代码；state 照抄引用的 sentiment 工件的 state；triggers、vetoes 各 1–5 条；字符串不超过 200 字，整张卡的紧凑 JSON 不超过 2,048 字节，写下一运行可对照冻结事实核对的条件，不写交易方向、价位目标或仓位；price_band 写观察区间，相对锚点（如锚点上下若干百分比）。WAIT 写 null。",
  expectation_review:
    "previous 非空时必填：previous_run 照抄 previous.run；grade 为 符合、强于、弱于 或 NOT_EVALUABLE，除 NOT_EVALUABLE 外引用至少一条本运行冻结、scope 为 CURRENT 的证据编号（如候选的报价）。previous 为 null 时写 null。",
  previous: "previous 是本策略交易日早于本运行的运行中最新一份 mode 工件的预期卡，本运行只评它；那份工件为 WAIT（没有卡）时 previous 为 null，不用评；card_truncated 为 true 时卡片超过 2,048 字节，字符串被截短，原文仍在那份工件里。falsification 是 THESIS.md 的 Falsification 一节（至多 1,500 字节，falsification_truncated 为 true 时后面被截去，原文仍在文件里），写前提与卡片时对照它；null 即没有这一节，falsification_unreadable 为 true 时是 THESIS.md 读不出。",
  parameters_used: "S01、S02 列出所用参数 { name, value, note }（1–12 条），都只是研究候选；WAIT 可为空。",
  addressed:
    "S01、S02 须本运行有已接受、status 为 OK、带 items 列表（可为空）且 market_run 与本运行引用的市场运行相同的 counterevidence 工件，并逐项回应 { item, response, evidence_ids? }，item 照抄 x 编号；漏一项即 UNADDRESSED_COUNTEREVIDENCE；没有这样的工件时结论写 WAIT。",
  claims:
    "每条声明写一个事实并引用证据或工件编号。本模块不拥有断言类：任何字段都不写“全市场、市场广度、涨跌家数、情绪、赚钱效应、亏钱效应、冰点、题材、主线、轮动、龙头、空间板、指数、大盘、成交额、流动性”，写缺口（缺少、无法、待补充）的句子除外；需要这些读数时引用对应工件的编号。",
  basis:
    "CURRENT 须至少引用一条本运行交易日（scope CURRENT）的证据或工件；更早的一律 HISTORICAL，不用“当前、今日”等词；全部声明为 INSUFFICIENT 时结论 WAIT，前提与标签为空，expectation 为 null。",
  status: "status_expected 为 NOT_EVALUABLE 时照 example 提交，missing_sources 照抄 missing。",
  example:
    "example 只示格式：WAIT，没有卡片，声明为 INSUFFICIENT，不是判断；previous 非空时以 NOT_EVALUABLE 评上一张卡。market_run 与 market_snapshot_id 照抄上下文。",
};

/** An item the strategy run froze itself, of its own session: what a grade of the previous card cites. */
const ofThisRun = (entry) => entry !== undefined && !entry.source.startsWith("market:") && entry.scope === "CURRENT";

/** An equity quote of the strategy run. */
const isQuote = (entry) => entry.source === "quotes" && entry.kind === "quote";

/** The run's accepted artifact read from `source`, or undefined. */
function artifactOf(digest, source) {
  for (const entry of digest.artifacts.values()) if (entry.source === source) return entry.artifact;
  return undefined;
}

/** The cited market run's sentiment state, or null. */
function sentimentState(digest) {
  const state = artifactOf(digest, "market:sentiment")?.state;
  return typeof state === "string" ? state : null;
}

/** The symbols the run's leader artifact names. */
function leaderSymbols(digest) {
  const candidates = artifactOf(digest, "leader")?.leader_candidates;
  return Array.isArray(candidates) ? candidates.map((candidate) => candidate?.symbol).filter((symbol) => typeof symbol === "string") : [];
}

/** The six-digit codes of the leader's candidates. */
const candidateCodes = (digest) => leaderSymbols(digest).map((symbol) => symbol.slice(-6));

/** The boards the cited theme artifact names among its mainline candidates. */
function mainlineBoards(digest) {
  const candidates = artifactOf(digest, "market:theme")?.mainline_candidates;
  return Array.isArray(candidates) ? candidates.map((candidate) => candidate?.board).filter((board) => typeof board === "string") : [];
}

/**
 * The run's accepted counterevidence artifact as the A22 gate reads it, or null when there is none:
 * `usable` when its status is OK, its `items` an array of items with an `x` id (empty allowed - a
 * review that found nothing) and its `market_run` the mode's own cited market run (`bound`), and
 * those ids.
 * @returns {{ usable: boolean, bound: boolean, ids: string[] } | null}
 */
function counterevidence(digest) {
  const artifact = artifactOf(digest, "counterevidence");
  if (artifact === undefined) return null;
  const items = artifact.items;
  const bound = typeof artifact.market_run === "string" && artifact.market_run === digest.market_run;
  const usable = bound && artifact.status === "OK" && Array.isArray(items) && items.every((item) => typeof item?.id === "string" && /^x\d{1,2}$/u.test(item.id));
  return { usable, bound, ids: usable ? items.map((item) => item.id) : [] };
}

/** The accepted artifact an id names, by its source, if the context shows it. */
const artifactSource = (id, digest) => (digest.artifactIds.has(id) ? digest.artifacts.get(id)?.source : undefined);
const isBoardsDerived = (entry) => entry?.source === "market:boards" && entry.kind === "derived";

/** Whether `id` carries a theme precondition: a theme artifact with a mainline candidate, a mainline board's row, list or boards measure. */
function carriesTheme(id, digest) {
  const mainline = mainlineBoards(digest);
  if (artifactSource(id, digest) === "market:theme") return mainline.length > 0;
  const entry = digest.items.get(id);
  return (isBoardsDerived(entry) && mainline.includes(entry.item.params?.board)) || (entry?.source === "market:boards" && (
    (entry.kind === "board" && mainline.includes(entry.item.code)) || (entry.kind === "members" && mainline.includes(entry.item.board))));
}

/** Whether `id` carries a candidate precondition: the leader artifact, a candidate's quote or pool row. */
function carriesCandidate(id, digest) {
  if (artifactSource(id, digest) === "leader") return true;
  const entry = digest.items.get(id);
  if (entry === undefined) return false;
  if (entry.source === "quotes" && entry.kind === "quote") return leaderSymbols(digest).includes(entry.item.symbol);
  return entry.source === "market:limit-up" && entry.kind !== "derived" && candidateCodes(digest).includes(entry.item.code);
}

/** Whether `id` carries the negative-tail precondition: its derived measure or the sentiment artifact. */
function carriesTail(id, digest) {
  if (artifactSource(id, digest) === "market:sentiment") return true;
  const entry = digest.items.get(id);
  return entry?.source === "market:limit-up" && entry.kind === "derived" && entry.item.measure === "yesterday_negative_tail";
}

/** Whether `id` carries the old-theme-retreat precondition: the theme or sentiment artifact, a boards measure. */
function carriesRetreat(id, digest) {
  const source = artifactSource(id, digest);
  return source === "market:theme" || source === "market:sentiment" || isBoardsDerived(digest.items.get(id));
}

/** The class each precondition with a source cites when met, and the words naming it. */
const CITES = {
  theme_gate: [carriesTheme, "the theme artifact with a mainline candidate, or a mainline board's row, member list or boards derived item"],
  theme_not_falsified: [carriesTheme, "the theme artifact with a mainline candidate, or a mainline board's row, member list or boards derived item"],
  candidate_before_divergence: [carriesCandidate, "the leader artifact, or a candidate's quote or pool row"],
  candidates_pooled: [carriesCandidate, "the leader artifact, or a candidate's quote or pool row"],
  negative_tail_not_widening: [carriesTail, "the yesterday_negative_tail derived item or the sentiment artifact"],
  old_theme_retreat: [carriesRetreat, "the theme or sentiment artifact, or a boards derived item"],
};

/** The strategy and the previous card `extra` read, from the digest. */
const extraOf = (digest) => ({ strategy: digest.extra?.strategy ?? null, previous: digest.extra?.previous ?? null });

/** Whether `values` holds one value twice. */
const repeats = (values) => new Set(values).size !== values.length;

/**
 * The module's own rules, after the shared ones: the card and the review in their shapes, the
 * preconditions, labels and answers each once and bound, the previous card graded; then, for S01 or
 * S02, the strategy's own mode on an admitted state with every source it needs, its preconditions,
 * every counterevidence item addressed, a card bound to the run, and the parameters used.
 */
function rules(parsed, digest) {
  const { strategy, previous } = extraOf(digest);
  if (parsed.expectation !== null) {
    checkSchema(parsed.expectation, CARD, "analysis.expectation");
    if (bytes(parsed.expectation) > CARD_BYTES) fail(`analysis.expectation: the card exceeds its byte budget of ${CARD_BYTES} bytes, compact JSON.`);
  }
  if (parsed.expectation_review !== null) checkSchema(parsed.expectation_review, REVIEW, "analysis.expectation_review");

  const preconditions = parsed.preconditions;
  if (repeats(preconditions.map((p) => p.id)) || repeats(preconditions.map((p) => p.name))) fail("analysis.preconditions: duplicate values.");
  for (const [i, { name, status, evidence_ids: ids }] of preconditions.entries()) {
    if (status === "met" && ids.length === 0) fail(`analysis.preconditions[${i}]: a met precondition needs an evidence reference.`);
    if (status === "unmet: no source" && ids.length > 0)
      fail(`analysis.preconditions[${i}].evidence_ids: a precondition with no source carries no evidence reference.`);
    const cites = CITES[name];
    if (status === "met" && cites !== undefined && !ids.some((id) => cites[0](id, digest)))
      fail(`analysis.preconditions[${i}].evidence_ids: ${name} needs an evidence reference to ${cites[1]}.`);
  }

  const matches = parsed.research_only_matches;
  if (repeats(matches.map((match) => match.family))) fail("analysis.research_only_matches: duplicate values.");
  for (const [i, { family, label }] of matches.entries()) {
    const name = R_FAMILIES[family];
    if (label !== name && !name.split("/").includes(label))
      fail(`analysis.research_only_matches[${i}].label: a label is its family's registered name (${family}: ${name}); no such evidence reference.`);
  }

  const reviewed = counterevidence(digest);
  if (repeats(parsed.addressed.map((answer) => answer.item))) fail("analysis.addressed: duplicate values.");
  // An S01 or S02 over no usable counterevidence meets the gate below before any answer is checked.
  const gated = parsed.mode !== "WAIT" && (reviewed === null || !reviewed.usable);
  if (!gated) for (const [i, answer] of parsed.addressed.entries())
    if (reviewed === null || !reviewed.ids.includes(answer.item))
      fail(`analysis.addressed[${i}].item: not an item of the run's accepted counterevidence artifact; no such evidence reference.`);

  const review = parsed.expectation_review;
  if (previous === null && review !== null)
    fail("analysis.expectation_review: no previous card of the strategy to grade; no such evidence reference.");
  if (previous !== null) {
    if (review === null) fail(`analysis.expectation_review: the previous card of run ${previous.run} needs its review, naming that run, with an evidence reference unless NOT_EVALUABLE.`);
    if (review.previous_run !== previous.run)
      fail(`analysis.expectation_review.previous_run: Snapshot or envelope mismatch; the previous card is run ${previous.run}'s.`);
    if (review.grade !== "NOT_EVALUABLE" && !review.evidence_ids.some((id) => ofThisRun(digest.items.get(id))))
      fail("analysis.expectation_review.evidence_ids: a grade needs an evidence reference to an item this run froze, of its session.");
  }

  if (parsed.mode === "WAIT") {
    if (parsed.expectation !== null) fail("analysis.expectation: invalid fixed value; WAIT carries no expectation card, null.");
    return;
  }
  const mode = parsed.mode;
  const own = MODE_FOR[strategy];
  if (own !== mode) fail(`analysis.mode: Inadmissible state; the strategy ${strategy} registers ${own ?? "WAIT only"}, not ${mode}.`);
  const state = sentimentState(digest);
  if (!ADMITTED[mode].includes(state))
    fail(`analysis.mode: Inadmissible state; ${mode} admits the cited sentiment state ${ADMITTED[mode].join(", ")}, not ${state ?? "none"}.`);
  if (GATE[mode] !== undefined)
    fail(`analysis.mode: Inadmissible state; ${mode} needs its ${GATE[mode]} precondition, which no source of the run holds (unmet: no source).`);

  for (const name of REQUIRED_PRECONDITIONS[mode]) {
    const index = preconditions.findIndex((precondition) => precondition.name === name);
    if (index < 0) fail(`analysis.preconditions: ${mode} lists the precondition ${name}; no such evidence reference.`);
    const { status } = preconditions[index];
    if (NO_SOURCE[mode].includes(name)) {
      if (status !== "unmet: no source")
        fail(`analysis.preconditions[${index}]: ${name} has no source in the run; it is stated unmet: no source, with no evidence reference.`);
    } else if (status !== "met") fail(`analysis.preconditions[${index}]: ${mode} needs ${name} met, with an evidence reference.`);
  }

  if (reviewed === null)
    fail(`analysis.addressed: Unaddressed counterevidence; ${mode} needs an accepted counterevidence artifact in the run, every item addressed by id.`);
  if (!reviewed.bound)
    fail(`analysis.addressed: Unaddressed counterevidence; ${mode} needs the run's counterevidence artifact to cite the mode's market run ${digest.market_run}.`);
  if (!reviewed.usable)
    fail(`analysis.addressed: Unaddressed counterevidence; ${mode} needs the run's counterevidence artifact accepted with status OK and an items array.`);
  const answered = new Set(parsed.addressed.map((answer) => answer.item));
  const open = reviewed.ids.filter((id) => !answered.has(id));
  if (open.length > 0) fail(`analysis.addressed: Unaddressed counterevidence; the items ${open.join(", ")} are not addressed.`);

  const card = parsed.expectation;
  if (card === null) fail(`analysis.expectation: required. ${mode} carries an expectation card.`);
  if (card.frozen_version !== digest.snapshot_id)
    fail("analysis.expectation.frozen_version: Snapshot or envelope mismatch; a card is frozen at the run's snapshot_id.");
  if (card.state !== state) fail(`analysis.expectation.state: a card's state is the cited sentiment artifact's, ${state}; no such evidence reference.`);
  const symbols = leaderSymbols(digest);
  for (const [i, symbol] of card.candidates.entries())
    if (!symbols.includes(symbol))
      fail(`analysis.expectation.candidates[${i}]: a card's candidate is a candidate of the run's leader artifact; no such evidence reference.`);
  if (parsed.parameters_used.length === 0)
    fail(`analysis.parameters_used: invalid array length; ${mode} lists the parameter values it used, research candidates.`);
}

/** The mode's no-conclusion values beside the core's (`unknownHeadline`): `WAIT`, and a review graded NOT_EVALUABLE. */
function unknownHeadline(field, value) {
  return (field === "mode" && value === "WAIT") || (field === "expectation_review" && /** @type {any} */ (value)?.grade === "NOT_EVALUABLE");
}

/**
 * The hints, with `strategy`: what this run's strategy may register, from the digest.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function hints(digest) {
  const { strategy } = extraOf(digest);
  const mode = MODE_FOR[strategy];
  const line = mode === undefined
    ? `本策略 ${strategy} 不登记 S01 或 S02：结论只能是 WAIT，expectation 写 null。`
    : `本策略 ${strategy} 只可登记 ${mode}，其余结论写 WAIT。${mode} 要求引用的 sentiment 工件 state 为 ${ADMITTED[mode].join("、")} 之一；preconditions 逐一列出 ${REQUIRED_PRECONDITIONS[mode].join("、")}，` +
      `其中 ${NO_SOURCE[mode].join("、")} 今天没有来源，status 写 “unmet: no source”，其余须为 met 并引用证据；还要回应反证工件的每一项、一张预期卡与所用参数。` +
      (GATE[mode] === undefined ? "" : `${GATE[mode]} 没有来源，所以 ${mode} 今天会被拒绝（INADMISSIBLE_STATE）：结论写 WAIT。`);
  return { ...HINTS, strategy: line };
}

/**
 * The context's example (`exampleOf`): WAIT, no card, empty lists, a review of the previous card
 * graded NOT_EVALUABLE when there is one and, in an OK run, one INSUFFICIENT claim citing a quote.
 * @param {import("../contract-core.mjs").ContextDigest} digest
 */
function example(digest) {
  const { previous } = extraOf(digest);
  return exampleOf(digest, {
    mode: "WAIT", preconditions: [], research_only_matches: [], expectation: null,
    expectation_review: previous === null ? null : { previous_run: previous.run, grade: "NOT_EVALUABLE", evidence_ids: [] },
    parameters_used: [], addressed: [],
  }, isQuote);
}

/**
 * The bytes of the Falsification section a context shows at most: a fixed share of the 30 KiB
 * context, so an operator's longer THESIS.md never pushes a mainline board out. The file keeps all
 * of it.
 */
export const FALSIFICATION_BYTES = 1500;

/**
 * The Falsification section of a THESIS.md text: the lines after its `## Falsification` heading up
 * to the next heading, trimmed, cut to at most `FALSIFICATION_BYTES` of UTF-8 on a character, with
 * `truncated` when the cut left some out; null when there is no text or no such section.
 * @param {string | null} thesis
 * @returns {{ text: string, truncated: boolean } | null}
 */
export function falsificationOf(thesis) {
  if (typeof thesis !== "string") return null;
  const lines = thesis.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^##\s+Falsification\s*$/u.test(line));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/u.test(line));
  const section = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  if (!section) return null;
  let cut = "";
  let size = 0;
  for (const char of section) {
    size += Buffer.byteLength(char, "utf8");
    if (size > FALSIFICATION_BYTES) break;
    cut += char;
  }
  return { text: cut, truncated: cut.length < section.length };
}

/** The bytes of `value`'s compact JSON text. */
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * A previous card as a context shows it: the card as stored when its compact JSON is at most
 * `CARD_BYTES`; else a copy with every string but the ids (`frozen_version`, `candidates`) cut to
 * `CARD_CUT_CHARS` characters - halved again until the copy fits, for a card stored before the cap -
 * and `card_truncated`. The artifact keeps the card whole.
 * @param {Record<string, any>} card
 * @returns {{ expectation: Record<string, any>, card_truncated?: true }}
 */
export function previousCard(card) {
  if (bytes(card) <= CARD_BYTES) return { expectation: card };
  const cut = (value, chars) => typeof value === "string" ? Array.from(value).slice(0, chars).join("")
    : Array.isArray(value) ? value.map((entry) => cut(entry, chars))
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cut(entry, chars)])) : value;
  for (let chars = CARD_CUT_CHARS; ; chars = Math.floor(chars / 2)) {
    const { frozen_version, candidates, ...rest } = card;
    const shown = { frozen_version, candidates, ...cut(rest, Math.max(chars, 1)) };
    // Keep the card's own field order.
    const ordered = Object.fromEntries(Object.keys(card).map((key) => [key, shown[key]]));
    if (bytes(ordered) <= CARD_BYTES || chars <= 1) return { expectation: ordered, card_truncated: true };
  }
}

/** Whether an accepted mode artifact holds a card in its shape: what the next run grades. */
function holdsCard(artifact) {
  try {
    checkSchema(artifact.expectation, CARD, "expectation");
    return true;
  } catch {
    return false;
  }
}

/**
 * What the mode reads beside the run (A11), once the run's leader artifact is found to cite the
 * given market run (`MISSING_EVIDENCE` otherwise: leader and mode stand on one market run): the
 * strategy's name; its previous card - the card of the newest accepted `mode.json` of an earlier
 * session, null when that artifact holds none (a WAIT: nothing to grade); and its THESIS.md
 * Falsification section, cut to `FALSIFICATION_BYTES` with `falsification_truncated` when cut, and
 * `falsification_unreadable` when the file cannot be read.
 * @param {import("../../runs-row.mjs").LunhuiRuns} runs
 * @param {{ strategy: string, run: string }} located
 * @param {{ artifacts: Record<string, Record<string, any>>, market: { run: string } | null }} read
 */
async function extra(runs, { strategy, run }, { artifacts, market }) {
  const leader = artifacts.leader;
  if (leader !== undefined && leader.market_run !== market?.run) throw refuse.marketRunDiffers(typeof leader.market_run === "string" ? leader.market_run : null);
  const previous = await runs.previousArtifact(strategy, run, "mode");
  const thesis = await runs.readThesis(strategy);
  const falsification = falsificationOf(thesis);
  return {
    strategy,
    previous: previous === null || !holdsCard(previous.artifact) ? null
      : { run: previous.run, snapshot_id: previous.snapshot_id, session: previous.session, ...previousCard(previous.artifact.expectation) },
    falsification: falsification?.text ?? null,
    ...(falsification?.truncated ? { falsification_truncated: true } : {}),
    ...(thesis === null ? { falsification_unreadable: true } : {}),
  };
}

/** A pool row of a leader candidate's code. */
const ofCandidate = (item, digest) => candidateCodes(digest).includes(item.code);

/** A board or member list of a board the cited theme artifact names among its mainline candidates. */
const ofMainline = (item, digest) => mainlineBoards(digest).includes(item.board ?? item.code);

/** A derived item a precondition can cite: any but a boards measure of a board outside the mainline candidates. */
const derivedFilter = (item, digest) => item.source !== "boards" || mainlineBoards(digest).includes(item.params?.board);

/** A board row without its per-item stamps and its leader. */
function boardRow({ host, delayed, leader, ...item }) {
  return item;
}

/** A member list as codes: its first 10, then any leader candidate further down, the frozen count beside them. */
function memberCodes({ kind, board, truncated, members }, digest) {
  const codes = Array.isArray(members) ? members.map((member) => member?.code) : [];
  const candidates = candidateCodes(digest);
  return { kind, board, truncated, members: codes.filter((code, index) => index < 10 || candidates.includes(code)), members_total: codes.length };
}

/** @type {import("../module-tool.mjs").ModuleContract} */
export const contract = {
  schema: SCHEMA,
  owns: [],
  exemptPaths: ["research_only_matches[*].label", "preconditions[*].name"],
  unknownHeadline,
  rules,
  hypotheses: HYPOTHESES,
  hints,
  example,
  extra,
  sources: ["quotes"],
  required: ["leader"],
  derivedView: derivedRow,
  derivedFilter,
  priority: [
    { source: "quotes", kind: "quote", view: quoteRow },
    // Only what a precondition cites: the candidates' pool rows, the mainline boards' board and list.
    { source: "market:limit-up", kind: "zt", view: poolRow, filter: ofCandidate },
    { source: "market:limit-up", kind: "zb", view: poolRow, filter: ofCandidate },
    { source: "market:limit-up", kind: "yesterday", view: poolRow, filter: ofCandidate },
    { source: "market:boards", kind: "board", view: boardRow, filter: ofMainline },
    { source: "market:boards", kind: "members", view: memberCodes, filter: ofMainline },
  ],
  marketRun: "required",
  marketSources: ["index", "limit-up", "boards"],
  // The market run's in the order the mode needs them, environment last.
  marketArtifacts: ["sentiment", "theme", "environment"],
  runArtifacts: ["leader", "counterevidence"],
  // The mode cites an artifact by its id and reads state and mainline boards from the headline: the
  // market run's headline-only, the run's own two claims of 60 characters (counterevidence items keep 120).
  artifactViews: {
    environment: { claims: 0 }, sentiment: { claims: 0 }, theme: { claims: 0 },
    leader: { claims: 2, claimText: 60 }, counterevidence: { claims: 2, claimText: 60 },
  },
};
