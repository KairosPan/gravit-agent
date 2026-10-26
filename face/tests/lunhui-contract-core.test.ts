/**
 * The Lunhui contract core, `plugins/lunhui/lib/contract-core.mjs` (modules spec §5.6, A16, A19,
 * A20, A21, A24): the rules every module shares, lifted from stage 0's `contract.mjs`, the module
 * envelope validator and the digest context builder. A fixture module - `sentiment`'s name, a
 * schema with one headline enum - over a fixture run of three sources whose items carry their ids
 * as `addEvidence` stores them; each validator rule in its order, its category asserted through
 * `classifyValidationRejection`; then the context's order, cap, `truncated` list and `missing`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_VERSION, MAX_ANALYSIS_BYTES, MAX_CONTEXT_BYTES, SCOPE_CLASSES, SCOPE_EXEMPT, buildContext as untypedBuildContext,
  classifyValidationRejection, hash, hypothesesVersion, validateEnvelope as untypedValidateEnvelope,
} from "../plugins/lunhui/lib/contract-core.mjs";
import * as stage0 from "../plugins/lunhui/lib/contract.mjs";
import * as core from "../plugins/lunhui/lib/contract-core.mjs";

/** A fixture as the cases build one: a case may lay any field over it, valid or not. */
type Loose = Record<string, any>;
// The module's JSDoc types are the host's; the cases hand loose fixtures, invalid ones among them.
const buildContext = untypedBuildContext as unknown as (options: Loose) => { text: string; digest: Loose };
const validateEnvelope = untypedValidateEnvelope as unknown as (raw: unknown, options: Loose) => Loose;

/** An item as `addEvidence` stores it: the item with its own id. */
const withId = (item: Loose): Loose => ({ ...item, id: `ev_${hash(item).slice(0, 24)}` });

const SESSION = "2026-10-23";
const zt = withId({ pool: "zt", code: "600001", name: "甲", boards: 2 });
const zb = withId({ pool: "zb", code: "600002", name: "乙" });
const sealRatio = withId({ source: "limit-up", kind: "derived", measure: "seal_ratio", value: 0.7, inputs: [zt.id, zb.id] });
const indexQuote = withId({ kind: "index", symbol: "sh000001", last: 3300 });
const bars = withId({ kind: "bars", symbol: "sh000001", bars: [["2026-10-22", 3290]] });
const advance = withId({ source: "index", kind: "derived", measure: "advance_decline_ratio", value: 1.4, inputs: [] });
const board = withId({ kind: "board", code: "BK0001", name: "丙" });
const boardBreadth = withId({ source: "boards", kind: "derived", measure: "board_breadth", value: 0.6, inputs: [board.id] });

const EVIDENCE = [
  { source: "limit-up", session: SESSION, items: [zt, zb, sealRatio] },
  { source: "index", session: SESSION, items: [indexQuote, bars, advance] },
  { source: "boards", session: SESSION, items: [board, boardBreadth] },
];
const MANIFEST = {
  run: "r20261023", snapshot_id: `snap_${"a".repeat(64)}`, as_of: "2026-10-23T07:30:00.000Z", session: SESSION,
  evidence: EVIDENCE.map(({ source }) => ({ source })),
};
const SCHEMA = { type: "object", required: ["state"], properties: { state: { enum: ["UNKNOWN", "EXPANSION"] } } };
const HYPOTHESES = "情绪周期是可修订的标签（P0156–P0163）。";

function context(overrides: Loose = {}) {
  return buildContext({
    module: "sentiment", run: MANIFEST.run, manifest: MANIFEST, evidence: EVIDENCE, sources: ["limit-up", "index"],
    derivedFirst: ["limit-up"], priority: [{ source: "limit-up", kind: "zt" }, { source: "index", kind: "index" }],
    hypotheses: HYPOTHESES, schema: SCHEMA, hints: "按字段填写。", example: { note: "示例" }, required: ["limit-up", "index"],
    ...overrides,
  });
}

/** A valid artifact for `digest`, with `overrides` laid over it. */
function artifact(digest: Loose, overrides: Loose = {}): Loose {
  return {
    module: digest.module, contract_version: digest.contract_version, hypotheses_version: digest.hypotheses_version,
    snapshot_id: digest.snapshot_id, run: digest.run, as_of: digest.as_of, session: digest.session,
    status: "OK", missing_sources: [], state: "EXPANSION",
    claims: [
      { id: "c1", text: "情绪进入扩张。", basis: "CURRENT", evidence_ids: [sealRatio.id, indexQuote.id] },
      { id: "c2", text: "前一日收于3290点。", basis: "HISTORICAL", evidence_ids: [bars.id] },
    ],
    limitations: ["缺少分钟数据。"],
    ...overrides,
  };
}

function check(raw: unknown, options: Loose = {}): Loose {
  const digest = options.context ?? context().digest;
  return validateEnvelope(raw, { module: "sentiment", context: digest, schema: SCHEMA, owns: ["sentiment"], ...options });
}

/** The rejection's category, through the classifier the submit uses. */
function category(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return classifyValidationRejection(error);
  }
  assert.fail("expected a rejection");
}

test("the moved helpers are the core's own, re-exported by stage 0's contract unchanged", () => {
  for (const name of [
    "canonical", "hash", "fail", "checkSchema", "FORBIDDEN_TEXT", "CURRENT_WORDS", "BASIS", "VALIDATION_REPAIRS",
    "classifyValidationRejection", "MAX_CONTEXT_BYTES", "MAX_ANALYSIS_BYTES",
  ])
    assert.equal((stage0 as Loose)[name], (core as Loose)[name], name);
  assert.equal(MAX_CONTEXT_BYTES, 30 * 1024);
  assert.equal(MAX_ANALYSIS_BYTES, 24 * 1024);
});

test("SCOPE_CLASSES is a frozen map of the five assertion classes; SCOPE_EXEMPT is stage 0's exemption", () => {
  assert.ok(Object.isFrozen(SCOPE_CLASSES));
  assert.deepEqual(Object.keys(SCOPE_CLASSES), ["market", "sentiment", "theme", "leader", "index"]);
  assert.ok(SCOPE_CLASSES.market.test("涨跌家数"));
  assert.ok(SCOPE_CLASSES.sentiment.test("冰点"));
  assert.ok(SCOPE_CLASSES.theme.test("板块轮动"));
  assert.ok(SCOPE_CLASSES.leader.test("空间板"));
  assert.ok(SCOPE_CLASSES.index.test("流动性"));
  assert.ok(SCOPE_EXEMPT.test("仅凭样本") && SCOPE_EXEMPT.test("缺少资料"));
});

test("a valid artifact is accepted and returned parsed, from a string or an object", () => {
  const { digest } = context();
  const value = artifact(digest);
  assert.deepEqual(check(JSON.stringify(value)), value);
  assert.deepEqual(check(value), value);
});

test("a string over 24 KiB is BYTE_LIMIT before it is parsed", () => {
  assert.equal(category(() => check(`{${" ".repeat(MAX_ANALYSIS_BYTES)}}`)), "BYTE_LIMIT");
});

test("text that is not JSON is SCHEMA", () => {
  assert.equal(category(() => check("这是一段说明 {}")), "SCHEMA");
});

test("an object over 24 KiB compact is BYTE_LIMIT before the schema", () => {
  const value = artifact(context().digest, { padding: "x".repeat(MAX_ANALYSIS_BYTES) });
  assert.equal(category(() => check(value)), "BYTE_LIMIT");
});

test("the module schema merged with the envelope: an unknown field, a bad headline enum, a bad claim are SCHEMA", () => {
  const { digest } = context();
  assert.equal(category(() => check(artifact(digest, { extra: 1 }))), "SCHEMA");
  assert.equal(category(() => check(artifact(digest, { state: "CLIMAX" }))), "SCHEMA");
  assert.equal(category(() => check(artifact(digest, { claims: [] }))), "SCHEMA");
  const { state: _state, ...headless } = artifact(digest);
  assert.equal(category(() => check(headless)), "SCHEMA");
  const badClaim = { id: "x1", text: "缺少资料。", basis: "CURRENT", evidence_ids: [zt.id] };
  assert.equal(category(() => check(artifact(digest, { claims: [badClaim] }))), "SCHEMA");
});

test("every envelope field must equal the context's: a mismatch is REFERENCE", () => {
  const { digest } = context();
  for (const [field, value] of Object.entries({
    module: "theme", snapshot_id: `snap_${"b".repeat(64)}`, run: "r2", as_of: "2026-10-23T08:00:00.000Z",
    session: "2026-10-22", contract_version: "2", hypotheses_version: "h_000000000000",
  })) {
    assert.throws(() => check(artifact(digest, { [field]: value })), /Snapshot or envelope mismatch\./, field);
    assert.equal(category(() => check(artifact(digest, { [field]: value }))), "REFERENCE", field);
  }
});

test("an evidence id the context does not hold is REFERENCE, a derived id of a source the module does not read too", () => {
  const { digest } = context();
  const unknown = `ev_${"0".repeat(24)}`;
  const cite = (id: string) => [{ id: "c1", text: "情绪进入扩张。", basis: "CURRENT", evidence_ids: [sealRatio.id, id] }];
  assert.equal(category(() => check(artifact(digest, { claims: cite(unknown) }))), "REFERENCE");
  assert.equal(category(() => check(artifact(digest, { claims: cite(boardBreadth.id) }))), "REFERENCE");
  // An id written into free text is a citation too.
  assert.equal(category(() => check(artifact(digest, { limitations: [`缺少 ${unknown} 的核验。`] }))), "REFERENCE");
});

test("time scope: a CURRENT claim needs one CURRENT item, a HISTORICAL claim only older ones and no current words", () => {
  const { digest } = context();
  const one = (claim: Loose) => artifact(digest, { claims: [claim] });
  assert.equal(category(() => check(one({ id: "c1", text: "前一日收盘3290点。", basis: "CURRENT", evidence_ids: [bars.id] }))), "TIME_SCOPE");
  assert.equal(category(() => check(one({ id: "c1", text: "前一日收盘3290点。", basis: "HISTORICAL", evidence_ids: [bars.id, indexQuote.id] }))), "TIME_SCOPE");
  assert.equal(category(() => check(one({ id: "c1", text: "今日收盘3290点。", basis: "HISTORICAL", evidence_ids: [bars.id] }))), "TIME_SCOPE");
  // A CURRENT claim may cite older evidence beside a CURRENT item.
  check(one({ id: "c1", text: "情绪进入扩张。", basis: "CURRENT", evidence_ids: [sealRatio.id, bars.id] }));
});

test("an item of a file from an older session is HISTORICAL evidence", () => {
  const older = EVIDENCE.map((file) => (file.source === "index" ? { ...file, session: "2026-10-22" } : file));
  const { digest } = context({ evidence: older });
  const claim = { id: "c1", text: "报3300点。", basis: "CURRENT", evidence_ids: [indexQuote.id] };
  assert.equal(category(() => check(artifact(digest, { claims: [claim] }), { context: digest })), "TIME_SCOPE");
  check(artifact(digest, { claims: [{ ...claim, text: "前一交易日报3300点。", basis: "HISTORICAL" }] }), { context: digest });
});

test("claims all INSUFFICIENT leave every headline field UNKNOWN", () => {
  const { digest } = context();
  const claims = [{ id: "c1", text: "缺少可核验资料。", basis: "INSUFFICIENT", evidence_ids: [zt.id] }];
  assert.equal(category(() => check(artifact(digest, { claims }))), "TIME_SCOPE");
  check(artifact(digest, { claims, state: "UNKNOWN" }));
});

test("trading or account words anywhere are EXECUTION_CONTENT, unless a name in labelAllow", () => {
  const { digest } = context();
  assert.equal(category(() => check(artifact(digest, { limitations: ["不构成买入建议。"] }))), "EXECUTION_CONTENT");
  const label = artifact(digest, { limitations: ["逢低吸纳 仅为研究标签，缺少验证。"] });
  assert.equal(category(() => check(label)), "EXECUTION_CONTENT");
  check(label, { context: { ...digest, labelAllow: ["逢低吸纳"] } });
});

test("scope: an owned class cited with a derived id is accepted; a row id alone or a class not owned is UNSUPPORTED_SCOPE", () => {
  const { digest } = context();
  const one = (text: string, ids: string[]) => artifact(digest, { claims: [{ id: "c1", text, basis: "CURRENT", evidence_ids: ids }] });
  check(one("情绪进入扩张", [sealRatio.id]));
  assert.equal(category(() => check(one("情绪进入扩张", [zt.id]))), "UNSUPPORTED_SCOPE");
  assert.equal(category(() => check(one("题材轮动加快", [sealRatio.id]))), "UNSUPPORTED_SCOPE");
  assert.equal(category(() => check(one("题材轮动加快", [zt.id]))), "UNSUPPORTED_SCOPE");
  // Sentences are judged apart: an exempt one does not cover the next.
  assert.equal(category(() => check(one("缺少题材资料。题材轮动加快", [sealRatio.id]))), "UNSUPPORTED_SCOPE");
  check(one("缺少题材资料；情绪进入扩张", [sealRatio.id]));
});

test("scope outside claims: an owned class in a limitation is UNSUPPORTED_SCOPE unless exempt", () => {
  const { digest } = context();
  assert.equal(category(() => check(artifact(digest, { limitations: ["情绪偏强。"] }))), "UNSUPPORTED_SCOPE");
  check(artifact(digest, { limitations: ["缺少情绪周期的分钟确认。"] }));
});

test("status: NOT_EVALUABLE needs missing sources and UNKNOWN headlines; OK needs none missing, here or in the context", () => {
  const { digest } = context();
  const notEvaluable = { status: "NOT_EVALUABLE", missing_sources: ["index"], state: "UNKNOWN" };
  check(artifact(digest, notEvaluable));
  assert.equal(category(() => check(artifact(digest, { ...notEvaluable, missing_sources: [] }))), "SCHEMA");
  assert.equal(category(() => check(artifact(digest, { ...notEvaluable, state: "EXPANSION" }))), "SCHEMA");
  assert.equal(category(() => check(artifact(digest, { missing_sources: ["index"] }))), "SCHEMA");
  const missing = context({ manifest: { ...MANIFEST, evidence: [{ source: "limit-up" }] } }).digest;
  assert.equal(category(() => check(artifact(missing), { context: missing })), "SCHEMA");
});

test("the module's own rules run last, with the parsed artifact and the context", () => {
  const { digest } = context();
  const seen: Loose[] = [];
  check(artifact(digest), { context: digest, rules: (parsed: Loose, ctx: Loose) => seen.push({ parsed, ctx }) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].parsed.state, "EXPANSION");
  assert.equal(seen[0].ctx, digest);
  // An earlier rule's rejection comes first: the module's never runs.
  assert.throws(() => check(artifact(digest, { extra: 1 }), { rules: () => assert.fail("ran") }), /unknown field/);
});

test("buildContext: the envelope values, the module's sources only, derived items first, rows by priority", () => {
  const { text, digest } = context();
  const parsed = JSON.parse(text);
  assert.equal(parsed.module, "sentiment");
  assert.equal(parsed.contract_version, CONTRACT_VERSION);
  assert.equal(CONTRACT_VERSION, "1");
  assert.equal(parsed.hypotheses_version, hypothesesVersion(HYPOTHESES));
  assert.match(parsed.hypotheses_version, /^h_[0-9a-f]{12}$/);
  assert.deepEqual([parsed.run, parsed.snapshot_id, parsed.as_of, parsed.session], [MANIFEST.run, MANIFEST.snapshot_id, MANIFEST.as_of, SESSION]);
  assert.equal(parsed.status_expected, "OK");
  assert.deepEqual(parsed.missing, []);
  assert.equal(parsed.hypotheses, HYPOTHESES);
  assert.ok(parsed.schema.properties.state && parsed.schema.properties.claims, "the merged schema");
  assert.deepEqual(parsed.derived.map((item: Loose) => item.id), [sealRatio.id, advance.id]);
  assert.deepEqual(parsed.evidence.map((item: Loose) => item.id), [zt.id, indexQuote.id]);
  // The rows no priority entry asks for are left out and named.
  assert.deepEqual(parsed.truncated, [{ source: "limit-up", kind: "zb", count: 1 }, { source: "index", kind: "bars", count: 1 }]);
  assert.deepEqual([...digest.evidenceIds].sort(), [zt.id, zb.id, sealRatio.id, indexQuote.id, bars.id, advance.id].sort());
  assert.deepEqual([...digest.derivedIds].sort(), [sealRatio.id, advance.id].sort());
  assert.ok(!digest.evidenceIds.has(boardBreadth.id));
  assert.deepEqual(digest.labelAllow, []);
  assert.deepEqual(digest.missing, []);
});

test("buildContext: a required source absent from the manifest is missing and the status expected NOT_EVALUABLE", () => {
  const manifest = { ...MANIFEST, evidence: [{ source: "limit-up" }] };
  const { text, digest } = context({ manifest, evidence: EVIDENCE.filter((file) => file.source === "limit-up") });
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.missing, ["index"]);
  assert.equal(parsed.status_expected, "NOT_EVALUABLE");
  assert.deepEqual(digest.missing, ["index"]);
});

test("buildContext: rows are added whole until the text would pass 30 KiB, the rest counted in truncated", () => {
  const rows = Array.from({ length: 400 }, (_, i) => withId({ pool: "zt", code: String(600000 + i), name: "某股".repeat(20), boards: 1 }));
  const evidence = [{ source: "limit-up", session: SESSION, items: [...rows, sealRatio] }, EVIDENCE[1]];
  const { text } = context({ evidence });
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const parsed = JSON.parse(text);
  assert.equal(parsed.derived[0].id, sealRatio.id);
  const kept = parsed.evidence.filter((item: Loose) => item.pool === "zt").length;
  assert.ok(kept > 0 && kept < 400);
  const ztCut = parsed.truncated.find((entry: Loose) => entry.kind === "zt");
  assert.equal(ztCut.count, 400 - kept);
  // Rows after the first that did not fit are left out too, even small ones.
  assert.ok(!parsed.evidence.some((item: Loose) => item.id === indexQuote.id));
  assert.deepEqual(parsed.truncated.find((entry: Loose) => entry.kind === "index"), { source: "index", kind: "index", count: 1 });
});

test("buildContext: a priority entry's order and view shape its rows; an example function gets the digest", () => {
  const low = withId({ pool: "zt", code: "600010", boards: 1 });
  const high = withId({ pool: "zt", code: "600011", boards: 5 });
  const evidence = [{ source: "limit-up", session: SESSION, items: [low, high, sealRatio] }, EVIDENCE[1]];
  let received: Loose | undefined;
  const { text, digest } = context({
    evidence,
    priority: [{ source: "limit-up", kind: "zt", order: (a: Loose, b: Loose) => b.boards - a.boards, view: ({ id, boards }: Loose) => ({ id, boards }) }],
    example: (d: Loose) => ((received = d), { cite: [...d.derivedIds][0] }),
  });
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.evidence.map((item: Loose) => [item.id, item.boards, item.code]), [[high.id, 5, undefined], [low.id, 1, undefined]]);
  assert.equal(received, digest);
  assert.deepEqual(parsed.example, { cite: sealRatio.id });
});
