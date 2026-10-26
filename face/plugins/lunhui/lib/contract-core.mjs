// face/plugins/lunhui/lib/contract-core.mjs
/**
 * The Lunhui contract core (modules spec §5.6, A16, A19, A20, A21, A24): the rules every module's
 * contract shares. Two parts.
 *
 * Lifted from stage 0's `contract.mjs`, unchanged, and re-exported by it: `fail`, `canonical`,
 * `hash`, `checkSchema`, `textEntries`, the forbidden trading and account words, the current-time
 * words, the three bases, the two byte budgets, the repair hints by category and the classifier -
 * which gains patterns for the envelope's own messages beside stage 0's, all of which it keeps.
 *
 * New for the modules: the assertion classes a module may own (A21), the artifact envelope (A19)
 * merged into a module's schema, `validateEnvelope` - the fail-closed validator every submit runs,
 * its rules in a fixed order, the module's own last - and `buildContext`, the digest a module's
 * context read returns (A24): only the module's sources, derived items first, then rows by the
 * module's priority, whole, until the UTF-8 JSON text would pass 30 KiB, the rest named in
 * `truncated`. Its `digest` is the validator's context.
 */
import { createHash } from "node:crypto";
import { MODULES } from "./modules.mjs";

// -------------------------------------------------------------------------------------------------
// Lifted from stage 0's contract.mjs (verbatim but for `export`)
// -------------------------------------------------------------------------------------------------

export const BASIS = ["CURRENT", "HISTORICAL", "INSUFFICIENT"];
export const MAX_CONTEXT_BYTES = 30 * 1024;
export const MAX_ANALYSIS_BYTES = 24 * 1024;
export const FORBIDDEN_TEXT =
  /买入|卖出|建仓|加仓|减仓|清仓|满仓|重仓|仓位|持仓|账户|帐户|订单|下单|目标价|止损价|止盈价|买点|卖点|做多|做空|入场价|出场价|建议介入|逢低吸纳|(?:上看|下看|看到)\s*[¥￥]?\d+(?:\.\d+)?\s*元|\b(?:buy|sell|long|short|order|account|portfolio|position|allocation)\b|price\s*target|stop[- ]?loss|take[- ]?profit/i;
export const CURRENT_WORDS =
  /当前|实时|现价|此刻|今日|今天|盘中|\b(?:currently|current|realtime|real-time|today|now)\b/i;

export function fail(message, code = "INVALID_ANALYSIS") {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function checkSchema(value, schema, path = "analysis") {
  if (schema.const !== undefined && value !== schema.const)
    fail(`${path}: invalid fixed value.`);
  if (schema.enum && !schema.enum.includes(value))
    fail(`${path}: invalid enum.`);
  if (schema.type === "object") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      fail(`${path}: expected object.`);
    for (const key of schema.required)
      if (!Object.hasOwn(value, key)) fail(`${path}.${key}: required.`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key))
        fail(`${path}.${key}: unknown field.`);
      checkSchema(value[key], schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === "array") {
    if (
      !Array.isArray(value) ||
      value.length < schema.minItems ||
      value.length > schema.maxItems
    )
      fail(`${path}: invalid array length.`);
    if (schema.uniqueItems && new Set(value).size !== value.length)
      fail(`${path}: duplicate values.`);
    value.forEach((item, i) =>
      checkSchema(item, schema.items, `${path}[${i}]`),
    );
  } else if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length < (schema.minLength || 0) ||
      value.length > (schema.maxLength || 200) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value))
    )
      fail(`${path}: invalid string.`);
  }
}
export function textEntries(value, path = "analysis") {
  return typeof value === "string"
    ? [[path, value]]
    : Array.isArray(value)
      ? value.flatMap((item, i) => textEntries(item, `${path}[${i}]`))
      : value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, item]) =>
            textEntries(item, `${path}.${key}`),
          )
        : [];
}

export const VALIDATION_REPAIRS = Object.freeze({
  SCHEMA:
    "按 schemaExample 核对字段、类型、枚举和数组；完整 JSON 对象不包裹 Markdown，不增加字段。",
  REFERENCE:
    "仅使用 context.universe 中证券和真实 evidence.id；个股必须引用自身证据，不重复证券。",
  TIME_SCOPE:
    "逐项按证据 basis 修正；历史字段和反证中删除“当前、实时、现价、今日、今天、盘中”，否定句也不用；资料不足时使用 WAIT。",
  UNSUPPORTED_SCOPE:
    "只描述所给样本指标；涉及广度、题材或核心地位的每一句都用“缺少”“无法”或“待补充”，包括 nextChecks；不作一般性断言。",
  EXECUTION_CONTENT:
    "删除超出只读研究范围的内容及对应术语，不在免责声明中复述；只保留样本事实、资料缺口和核验步骤。",
  BYTE_LIMIT:
    "缩短至约800汉字，仅保留必要事实和引用；个股 thesis≤80字、反证≤60字、失效条件≤50字。",
  OTHER:
    "核对格式示例和字段级错误，仅修正被指出的问题；资料不足使用 WAIT，不添加无依据的补充解释。",
});

// Stage 0's patterns, each kept; the envelope's messages join them: an envelope mismatch is
// REFERENCE, the INSUFFICIENT headline rule TIME_SCOPE, the status rules SCHEMA.
export function classifyValidationRejection(error) {
  const message = String(error?.message || "");
  if (/byte budget/i.test(message)) return "BYTE_LIMIT";
  if (/Trading, target-price, or account content/i.test(message))
    return "EXECUTION_CONTENT";
  if (/Unsupported whole-market, theme, or leadership assertion/i.test(message))
    return "UNSUPPORTED_SCOPE";
  if (
    /historical|non-current|CURRENT claim|Insufficient evidence requires WAIT|Insufficient evidence requires UNKNOWN|WATCH requires usable|WATCH conclusion/i.test(
      message,
    )
  )
    return "TIME_SCOPE";
  if (
    /evidence reference|lacks evidence for its symbol|symbol outside|observation symbol|Snapshot or envelope mismatch/i.test(
      message,
    )
  )
    return "REFERENCE";
  if (
    /invalid fixed value|invalid enum|expected object|required\.|unknown field|invalid array length|duplicate values|invalid string|JSON object without surrounding prose|status: (?:NOT_EVALUABLE|OK) requires/i.test(
      message,
    )
  )
    return "SCHEMA";
  return "OTHER";
}

// -------------------------------------------------------------------------------------------------
// The modules' envelope, scope classes, validator and context (A19, A21, A24)
// -------------------------------------------------------------------------------------------------

/**
 * The repair hints a module's rejection carries, by the classifier's categories: module-neutral,
 * naming the envelope, the evidence ids, the time scope, the owned assertion classes, the status and
 * the byte budget. Stage 0's `VALIDATION_REPAIRS` stays with `validateAnalysis`.
 */
export const MODULE_REPAIRS = Object.freeze({
  SCHEMA:
    "按上下文的 schema 与 example 核对字段、类型、枚举和数组长度；只交一个 JSON 对象，不包裹 Markdown，不增加字段。status 为 NOT_EVALUABLE 时 missing_sources 非空且标题字段均为 UNKNOWN 或空；为 OK 时 missing_sources 为空，且上下文 missing 须为空。",
  REFERENCE:
    "信封字段 module、contract_version、hypotheses_version、snapshot_id、run、as_of、session 原样照抄上下文；只引用上下文中真实的证据编号（ev_…），不引用本模块来源以外的编号。",
  TIME_SCOPE:
    "按证据时效修正 basis：CURRENT 须至少引用一条本运行交易日的证据；HISTORICAL 只引用更早的证据（日线、历史序列或更早交易日），文字不用“当前、实时、现价、今日、今天、盘中”；所有声明均为 INSUFFICIENT 时标题字段一律 UNKNOWN。",
  UNSUPPORTED_SCOPE:
    "全市场、情绪、题材、龙头、指数类断言只在本模块拥有该类时写入声明，并引用至少一条该类认可的证据编号（默认是派生证据，见提示）；其他此类句子改写为“缺少”“无法”或“待补充”，限制说明里也一样。",
  EXECUTION_CONTENT:
    "删除交易方向、价位目标、仓位、账户或下单内容及对应术语，免责声明里也不复述；只保留证据事实、资料缺口和核验步骤。",
  BYTE_LIMIT:
    "压缩到 24 KiB 以内：缩短声明与限制说明，只保留必要事实和证据编号。",
  OTHER:
    "按被指出的字段逐项修正，不添加无依据的内容；资料不足时标题字段用 UNKNOWN。",
});

/**
 * The module repair hint for a rejection's category; an unknown category gets `OTHER`'s.
 * @param {string} category
 * @returns {string}
 */
export function repairFor(category) {
  return MODULE_REPAIRS[category] ?? MODULE_REPAIRS.OTHER;
}

/** The version of the shared rules an artifact was validated under (A19). */
export const CONTRACT_VERSION = "1";

/**
 * The assertion classes (A21): a sentence matching one is a whole-market, sentiment, theme,
 * leadership or index assertion, which only a module owning the class may make, citing a derived
 * item.
 */
export const SCOPE_CLASSES = Object.freeze({
  market: /全市场|市场广度|全板块|涨跌家数/u,
  sentiment: /情绪周期|情绪|赚钱效应|亏钱效应|冰点/u,
  theme: /题材|主线|板块轮动|轮动/u,
  leader: /龙头|总龙头|空间板/u,
  index: /指数|大盘|成交额|流动性/u,
});

/** Stage 0's exemption: a sentence stating a gap, a limit or a need asserts nothing. */
export const SCOPE_EXEMPT =
  /缺少|缺失|不足|不具备|不能|不可|无法|未知|未提供|未验证|未确认|尚未|待核验|待补充|不代表|不支持|需要|需补|仅凭/u;

/** The sentence boundaries the scope rule splits on, a line break among them as stage 0's. */
const SENTENCE_SPLIT = /[。；;.!?！？\n]/u;

/** The default carrier of an owned class (A21): a derived item. */
const isDerivedEntry = (entry) => entry.kind === "derived";

/** An evidence id, anywhere in an artifact's text. */
const EVIDENCE_ID = /ev_[a-f0-9]{24}/g;

const textSchema = (maxLength) => ({ type: "string", minLength: 1, maxLength });

/** The envelope every module's artifact carries (A19), merged into the module's own schema. */
export const ENVELOPE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "module", "contract_version", "hypotheses_version", "snapshot_id", "run", "as_of", "session",
    "status", "missing_sources", "claims", "limitations",
  ],
  properties: {
    module: textSchema(40),
    contract_version: textSchema(8),
    hypotheses_version: textSchema(20),
    snapshot_id: textSchema(80),
    run: textSchema(64),
    // The run's own values, a string or null; the envelope check binds them.
    as_of: {},
    session: {},
    status: { enum: ["OK", "NOT_EVALUABLE"] },
    missing_sources: { type: "array", minItems: 0, maxItems: 8, uniqueItems: true, items: textSchema(40) },
    // None only in a NOT_EVALUABLE artifact, whose sources may have frozen nothing to cite (the status rule).
    claims: {
      type: "array",
      minItems: 0,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "basis", "evidence_ids"],
        properties: {
          id: { type: "string", minLength: 2, maxLength: 3, pattern: "^c[0-9]{1,2}$" },
          text: textSchema(300),
          basis: { enum: BASIS },
          evidence_ids: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            uniqueItems: true,
            items: { type: "string", pattern: "^ev_[a-f0-9]{24}$" },
          },
        },
      },
    },
    limitations: { type: "array", minItems: 0, maxItems: 8, items: textSchema(200) },
  },
});

/** The envelope fields an artifact must carry exactly as its context does. */
const ENVELOPE_BOUND = ["module", "snapshot_id", "run", "as_of", "session", "contract_version", "hypotheses_version"];

/**
 * A module's schema merged with the envelope: the envelope's fields, the module's headline fields.
 * @param {{ required?: string[], properties?: Record<string, unknown> }} schema
 */
export function envelopeSchema(schema) {
  return {
    ...ENVELOPE_SCHEMA,
    required: [...new Set([...ENVELOPE_SCHEMA.required, ...(schema.required ?? [])])],
    // The envelope's fields last: a module schema cannot redefine them.
    properties: { ...schema.properties, ...ENVELOPE_SCHEMA.properties },
  };
}

/**
 * `h_` and 12 hex of the sha256 over the module's hypotheses text (A19).
 * @param {string} text
 */
export function hypothesesVersion(text) {
  return `h_${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}

/**
 * A headline value that asserts nothing: `UNKNOWN`, null, absent, an empty list, or an object of such.
 * @param {unknown} value
 * @returns {boolean}
 */
function isUnknown(value) {
  if (value === undefined || value === null || value === "UNKNOWN") return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.values(value).every(isUnknown);
}

/**
 * The bytes of `value`'s compact JSON text.
 * @param {unknown} value
 */
function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/**
 * The evidence time scope of an item (for the CURRENT/HISTORICAL rule): bars and history series
 * look back, so they are HISTORICAL; any other item is CURRENT when its file's session is the
 * run's, else HISTORICAL.
 * @param {{ kind?: unknown }} item
 * @param {string | null} fileSession
 * @param {string | null} runSession
 * @returns {"CURRENT" | "HISTORICAL"}
 */
function timeScope(item, fileSession, runSession) {
  if (item.kind === "bars" || item.kind === "history") return "HISTORICAL";
  return fileSession !== null && fileSession === runSession ? "CURRENT" : "HISTORICAL";
}

/**
 * A row's kind as `truncated` and a priority entry name it: its `kind`, else a pool row's `pool`.
 * @param {Record<string, unknown>} item
 * @returns {string}
 */
function rowKind(item) {
  return String(item.kind ?? item.pool ?? "row");
}

/**
 * The context's digest, the validator's `context` argument.
 * @typedef {{ source: string, kind: string, scope: "CURRENT" | "HISTORICAL", item: Record<string, unknown> }} DigestItem
 * @typedef {{ module: string, contract_version: string, hypotheses_version: string, run: string,
 *   snapshot_id: string | null, as_of: string | null, session: string | null, missing: string[],
 *   evidenceIds: Set<string>, derivedIds: Set<string>, items: Map<string, DigestItem>,
 *   labelAllow: string[] }} ContextDigest
 */

/**
 * Validate a module's artifact against its context (spec §5.6, A19, A21), failing closed through
 * `fail` in this order: the string's bytes, its JSON, the object's compact bytes, the merged
 * schema, the envelope's binding to the context, every cited evidence id known, the time scope of
 * each claim, the forbidden words, the scope rule, the status rule, then the module's own `rules`.
 * @param {unknown} raw the submitted artifact, JSON text or a parsed object
 * @param {{ module: string, context: ContextDigest, schema: { required?: string[], properties?: Record<string, unknown> },
 *   owns?: string[], ownedBy?: Record<string, (entry: DigestItem) => boolean>, rules?: (parsed: any, context: ContextDigest) => void }} options
 * `ownedBy[class]` names the cited items that carry an owned class's sentence; a class without
 * an entry needs a derived item (A21).
 * A rejection (code `INVALID_ANALYSIS`, the module's own rules' included) carries its `category`,
 * through `classifyValidationRejection`, and that category's `repair` from `MODULE_REPAIRS`.
 * @returns {any} the artifact, parsed and copied
 */
export function validateEnvelope(raw, options) {
  try {
    return checkEnvelope(raw, options);
  } catch (error) {
    if (error?.code === "INVALID_ANALYSIS") {
      error.category = classifyValidationRejection(error);
      error.repair = repairFor(error.category);
    }
    throw error;
  }
}

/** `validateEnvelope`'s rules, in order. */
function checkEnvelope(raw, { module, context, schema, owns = [], ownedBy = {}, rules }) {
  const entry = MODULES.find((candidate) => candidate.name === module);
  if (!entry || !context) throw new TypeError(`lunhui: no contract context for module ${JSON.stringify(module)}`);
  let artifact = raw;
  if (typeof raw === "string") {
    if (Buffer.byteLength(raw, "utf8") > MAX_ANALYSIS_BYTES) fail("Analysis exceeds its byte budget.");
    try {
      artifact = JSON.parse(raw);
    } catch {
      fail("Analysis must be a JSON object without surrounding prose.");
    }
  }
  if (bytes(artifact) > MAX_ANALYSIS_BYTES) fail("Analysis exceeds its byte budget.");
  checkSchema(artifact, envelopeSchema(schema));

  for (const field of ENVELOPE_BOUND)
    if (artifact[field] !== context[field]) fail(`analysis.${field}: Snapshot or envelope mismatch.`);

  const entries = textEntries(artifact);
  for (const [path, text] of entries)
    for (const [id] of text.matchAll(EVIDENCE_ID))
      if (!context.evidenceIds.has(id)) fail(`${path}: Unknown evidence reference.`);

  for (const [index, claim] of artifact.claims.entries()) {
    const path = `analysis.claims[${index}]`;
    const scopes = claim.evidence_ids.map((id) => context.items.get(id)?.scope);
    if (claim.basis === "CURRENT" && !scopes.includes("CURRENT"))
      fail(`${path}.basis: Historical or missing evidence cannot support a CURRENT claim.`);
    if (claim.basis === "HISTORICAL" && scopes.some((scope) => scope !== "HISTORICAL"))
      fail(`${path}.basis: A HISTORICAL claim must cite historical evidence only.`);
    if (claim.basis === "HISTORICAL" && CURRENT_WORDS.test(claim.text))
      fail(`${path}: Non-current evidence was described as current.`);
  }
  if (artifact.claims.length > 0 && artifact.claims.every((claim) => claim.basis === "INSUFFICIENT") && !entry.headline.every((field) => isUnknown(artifact[field])))
    fail("analysis: Insufficient evidence requires UNKNOWN headline values.");

  for (const [path, text] of entries) {
    const stripped = context.labelAllow.reduce((rest, label) => rest.replaceAll(label, ""), text);
    if (FORBIDDEN_TEXT.test(stripped))
      fail(`${path}: Trading, target-price, or account content is outside the research contract.`);
  }

  // The scope rule: a claim's sentences with the claim's ids, every other string with none. An owned
  // class is carried by a cited item `ownedBy[class]` accepts, a derived item by default.
  const scoped = [
    ...artifact.claims.flatMap((claim, index) =>
      textEntries(claim, `analysis.claims[${index}]`).map(([path, text]) => [path, text, claim.evidence_ids])),
    ...textEntries({ ...artifact, claims: undefined }).map(([path, text]) => [path, text, []]),
  ];
  for (const [path, text, ids] of scoped) {
    const carries = (name) => {
      const accepts = ownedBy[name] ?? isDerivedEntry;
      return ids.some((id) => {
        const entry = context.items.get(id);
        return entry !== undefined && accepts(entry);
      });
    };
    for (const sentence of text.split(SENTENCE_SPLIT)) {
      const refused = Object.entries(SCOPE_CLASSES).some(
        ([name, pattern]) => pattern.test(sentence) && !(owns.includes(name) && carries(name)),
      );
      if (refused && !SCOPE_EXEMPT.test(sentence))
        fail(`${path}: Unsupported whole-market, theme, or leadership assertion.`);
    }
  }

  if (artifact.status === "NOT_EVALUABLE" && (artifact.missing_sources.length === 0 || !entry.headline.every((field) => isUnknown(artifact[field]))))
    fail("analysis.status: NOT_EVALUABLE requires missing sources and UNKNOWN headline values.");
  // The sources named missing are the run's, none more, none left out (missing_sources is unique).
  if (
    artifact.status === "NOT_EVALUABLE" &&
    (artifact.missing_sources.length !== context.missing.length || !artifact.missing_sources.every((source) => context.missing.includes(source)))
  )
    fail("analysis.status: NOT_EVALUABLE requires missing_sources to be the run's missing sources.");
  if (artifact.status === "OK" && (artifact.missing_sources.length > 0 || context.missing.length > 0))
    fail("analysis.status: OK requires no missing sources, in the artifact or the run.");
  if (artifact.status === "OK" && artifact.claims.length === 0) fail("analysis.status: OK requires at least one claim.");

  rules?.(artifact, context);
  return JSON.parse(JSON.stringify(artifact));
}

/**
 * Build a module's context (A24): a digest of the run as UTF-8 JSON text of at most 30 KiB, and the
 * validator's context. Only the files whose source is in `sources` enter. `derived` holds their
 * derived items, by source in `derivedFirst` order and then `sources` order; `evidence` the rows
 * `priority` asks for, entry by entry - an entry `{ source, kind, order?, view? }` takes that
 * source's rows of that kind (a pool row's kind is its `pool`), sorted by `order` and shown through
 * `view`. Each row is added whole, derived items first, until the next would pass the cap; from
 * there every row is left out, as is every row no entry asks for, each counted in `truncated` as
 * `{ source, kind, count }`. Every item of the module's sources stays citable, shown or not.
 * `example` is the built example, or a function of the digest that builds it.
 * @param {{ module: string, run: string, manifest: { snapshot_id?: string | null, as_of?: string | null, session?: string | null,
 *   evidence: { source: string }[] }, evidence: { source: string, session: string | null, items: Record<string, any>[] }[],
 *   sources: string[], derivedFirst?: string[], priority: { source: string, kind: string, order?: (a: any, b: any) => number,
 *   view?: (item: any) => Record<string, unknown> }[], hypotheses: string, schema: { required?: string[], properties?: Record<string, unknown> },
 *   hints: unknown, example: unknown, required: string[] }} options
 * @returns {{ text: string, digest: ContextDigest }}
 */
export function buildContext({ module, run, manifest, evidence, sources, derivedFirst = [], priority, hypotheses, schema, hints, example, required }) {
  const frozen = new Set(manifest.evidence.map((entry) => entry.source));
  const missing = required.filter((source) => !frozen.has(source));
  const session = manifest.session ?? null;
  const files = evidence.filter((file) => sources.includes(file.source));
  /** @type {Map<string, DigestItem>} */
  const items = new Map();
  for (const file of files)
    for (const item of file.items)
      items.set(item.id, { source: file.source, kind: rowKind(item), scope: timeScope(item, file.session ?? null, session), item });
  const all = [...items.entries()];
  const derivedIds = new Set(all.filter(([, entry]) => entry.kind === "derived").map(([id]) => id));
  /** @type {ContextDigest} */
  const digest = {
    module, contract_version: CONTRACT_VERSION, hypotheses_version: hypothesesVersion(hypotheses), run,
    snapshot_id: manifest.snapshot_id ?? null, as_of: manifest.as_of ?? null, session, missing,
    evidenceIds: new Set(items.keys()), derivedIds, items, labelAllow: [],
  };

  const shown = (entry, view) => ({ id: entry.item.id, source: entry.source, scope: entry.scope, ...(view ? view(entry.item) : entry.item) });
  const sourceOrder = [...new Set([...derivedFirst, ...sources])];
  const derivedRows = sourceOrder.flatMap((source) =>
    all.filter(([, entry]) => entry.kind === "derived" && entry.source === source).map(([, entry]) => ({ entry, row: shown(entry) })));
  const asked = new Set();
  const priorityRows = priority.flatMap(({ source, kind, order, view }) => {
    const matched = all.map(([, entry]) => entry).filter((entry) => entry.source === source && entry.kind === kind && entry.kind !== "derived");
    for (const entry of matched) asked.add(entry);
    const sorted = order ? [...matched].sort((a, b) => order(a.item, b.item)) : matched;
    return sorted.map((entry) => ({ entry, row: shown(entry, view) }));
  });
  const unasked = all.map(([, entry]) => entry).filter((entry) => entry.kind !== "derived" && !asked.has(entry));

  const context = {
    module, contract_version: CONTRACT_VERSION, hypotheses_version: digest.hypotheses_version, run,
    snapshot_id: digest.snapshot_id, as_of: digest.as_of, session, status_expected: missing.length ? "NOT_EVALUABLE" : "OK",
    missing, hypotheses, schema: envelopeSchema(schema), hints,
    example: typeof example === "function" ? example(digest) : example,
    evidence: [], derived: [], truncated: [],
  };
  let size = bytes(context);
  if (size > MAX_CONTEXT_BYTES) fail("Context exceeds its byte budget.", "INVALID_CONTEXT");
  /** @type {DigestItem[]} */
  const left = [];
  /** @type {{ entry: DigestItem, list: unknown[] }[]} */
  const added = [];
  let full = false;
  for (const [candidates, list] of [[derivedRows, context.derived], [priorityRows, context.evidence]])
    for (const { entry, row } of candidates) {
      const cost = bytes(row) + (list.length ? 1 : 0);
      if (full || size + cost > MAX_CONTEXT_BYTES) {
        full = true;
        left.push(entry);
        continue;
      }
      list.push(row);
      added.push({ entry, list });
      size += cost;
    }
  const count = () => {
    /** @type {Map<string, { source: string, kind: string, count: number }>} */
    const groups = new Map();
    for (const entry of [...left, ...unasked]) {
      const key = `${entry.source}\u0000${entry.kind}`;
      const group = groups.get(key) ?? { source: entry.source, kind: entry.kind, count: 0 };
      group.count += 1;
      groups.set(key, group);
    }
    context.truncated = [...groups.values()];
  };
  count();
  // The `truncated` list adds bytes of its own: give back the last rows added until the text fits.
  while (bytes(context) > MAX_CONTEXT_BYTES) {
    const last = added.pop();
    if (!last) fail("Context exceeds its byte budget.", "INVALID_CONTEXT");
    last.list.pop();
    left.unshift(last.entry);
    count();
  }
  return { text: JSON.stringify(context), digest };
}
