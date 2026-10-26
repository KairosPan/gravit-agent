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
  MODULE_REPAIRS, VALIDATION_REPAIRS, classifyValidationRejection, hash, hypothesesVersion, repairFor,
  validateEnvelope as untypedValidateEnvelope,
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

test("scope: ownedBy names the items that carry an owned class, per class; the default stays a derived item", () => {
  const { digest } = context();
  const one = (text: string, ids: string[]) => artifact(digest, { claims: [{ id: "c1", text, basis: "CURRENT", evidence_ids: ids }] });
  const index = (entry: Loose) => entry.kind === "index" || entry.kind === "bars" || entry.kind === "derived";
  const owned = { owns: ["index", "sentiment"], ownedBy: { index } };
  // An index sentence citing only an index quote: refused by the default, accepted through ownedBy.
  assert.equal(category(() => check(one("指数偏强", [indexQuote.id]), { owns: ["index", "sentiment"] })), "UNSUPPORTED_SCOPE");
  check(one("指数偏强", [indexQuote.id]), owned);
  check(one("指数偏强", [advance.id]), owned);
  // ownedBy[class] that does not hold for any cited id refuses.
  assert.equal(category(() => check(one("指数偏强", [zt.id]), owned)), "UNSUPPORTED_SCOPE");
  // A class without its own ownedBy entry keeps the default: a row id alone is not enough.
  assert.equal(category(() => check(one("情绪进入扩张", [indexQuote.id]), owned)), "UNSUPPORTED_SCOPE");
  check(one("情绪进入扩张", [sealRatio.id]), owned);
  // ownedBy opens nothing the module does not own.
  assert.equal(category(() => check(one("指数偏强", [indexQuote.id]), { owns: ["sentiment"], ownedBy: { index } })), "UNSUPPORTED_SCOPE");
});

test("scope: a line break ends a sentence, so an exempt line does not cover the next", () => {
  const { digest } = context();
  assert.equal(category(() => check(artifact(digest, { limitations: ["缺少分钟数据\n题材轮动加快"] }))), "UNSUPPORTED_SCOPE");
});

test("exemptPaths: the strings at those paths skip the forbidden words and the scope rule, nothing else does; their evidence ids still bind", () => {
  const { digest } = context();
  const schema = {
    ...SCHEMA,
    properties: {
      ...SCHEMA.properties,
      labels: { type: "array", minItems: 0, maxItems: 3, items: { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 40 } } } },
    },
  };
  const exemptPaths = ["labels[*].name"];
  const labelled = (name: string, overrides: Loose = {}) => artifact(digest, { labels: [{ name: "丙" }, { name }], ...overrides });
  // Without the option a name is text like any other.
  assert.equal(category(() => check(labelled("题材主线"), { schema })), "UNSUPPORTED_SCOPE");
  assert.equal(category(() => check(labelled("做多板块"), { schema })), "EXECUTION_CONTENT");
  check(labelled("题材主线"), { schema, exemptPaths });
  check(labelled("做多板块"), { schema, exemptPaths });
  // Any other path is still judged.
  assert.equal(category(() => check(labelled("丁", { limitations: ["题材主线"] }), { schema, exemptPaths })), "UNSUPPORTED_SCOPE");
  assert.equal(category(() => check(labelled("丁", { claims: [{ id: "c1", text: "做多。", basis: "CURRENT", evidence_ids: [sealRatio.id] }] }), { schema, exemptPaths })), "EXECUTION_CONTENT");
  // An evidence id written into an exempt string must still be the context's.
  assert.equal(category(() => check(labelled(`ev_${"0".repeat(24)}`), { schema, exemptPaths })), "REFERENCE");
});

test("a rejection carries its category and the module repair, never stage 0's", () => {
  assert.deepEqual(Object.keys(MODULE_REPAIRS), Object.keys(VALIDATION_REPAIRS));
  assert.ok(Object.isFrozen(MODULE_REPAIRS));
  for (const [key, text] of Object.entries(MODULE_REPAIRS)) {
    assert.notEqual(text, (VALIDATION_REPAIRS as Loose)[key], key);
    assert.doesNotMatch(text, /universe|WAIT/, key);
    assert.equal(repairFor(key), text);
  }
  assert.equal(repairFor("NO_SUCH_CATEGORY"), MODULE_REPAIRS.OTHER);
  const { digest } = context();
  for (const [overrides, expected] of [
    [{ extra: 1 }, "SCHEMA"], [{ run: "r2" }, "REFERENCE"], [{ limitations: ["情绪偏强。"] }, "UNSUPPORTED_SCOPE"],
  ] as const) {
    try {
      check(artifact(digest, overrides), { context: digest });
      assert.fail("expected a rejection");
    } catch (error) {
      assert.equal((error as Loose).category, expected);
      assert.equal((error as Loose).repair, MODULE_REPAIRS[expected]);
    }
  }
  // A module rule's rejection is classified the same way; a host bug passes through bare.
  const ruled = (() => {
    try {
      check(artifact(digest), { context: digest, rules: () => core.fail("analysis.state: invalid enum.") });
    } catch (error) {
      return error as Loose;
    }
  })();
  assert.equal(ruled?.repair, MODULE_REPAIRS.SCHEMA);
  assert.throws(() => check(artifact(digest), { module: "nope", context: digest }), (error: Loose) => error.repair === undefined);
});

test("scope outside claims: an owned class in a limitation is UNSUPPORTED_SCOPE unless exempt", () => {
  const { digest } = context();
  assert.equal(category(() => check(artifact(digest, { limitations: ["情绪偏强。"] }))), "UNSUPPORTED_SCOPE");
  check(artifact(digest, { limitations: ["缺少情绪周期的分钟确认。"] }));
});

test("status: NOT_EVALUABLE needs the run's missing sources and UNKNOWN headlines; OK needs none missing and a claim", () => {
  const { digest } = context();
  const missing = context({ manifest: { ...MANIFEST, evidence: [{ source: "limit-up" }] } }).digest;
  const notEvaluable = { status: "NOT_EVALUABLE", missing_sources: ["index"], state: "UNKNOWN" };
  const at = (ctx: Loose, overrides: Loose) => () => check(artifact(ctx, overrides), { context: ctx });
  at(missing, notEvaluable)();
  assert.equal(category(at(missing, { ...notEvaluable, missing_sources: [] })), "SCHEMA");
  assert.equal(category(at(missing, { ...notEvaluable, state: "EXPANSION" })), "SCHEMA");
  // missing_sources is the run's missing set: none more, none left out.
  assert.equal(category(at(missing, { ...notEvaluable, missing_sources: ["index", "limit-up"] })), "SCHEMA");
  assert.equal(category(at(digest, notEvaluable)), "SCHEMA");
  const both = context({ manifest: { ...MANIFEST, evidence: [] } }).digest;
  at(both, { ...notEvaluable, missing_sources: ["index", "limit-up"] })();
  assert.equal(category(at(both, notEvaluable)), "SCHEMA");
  // OK: nothing missing in the artifact or the run, and at least one claim.
  assert.equal(category(at(digest, { missing_sources: ["index"] })), "SCHEMA");
  assert.equal(category(at(missing, {})), "SCHEMA");
  assert.equal(category(at(digest, { claims: [] })), "SCHEMA");
});

test("a module whose sources froze nothing accepts a NOT_EVALUABLE artifact with no claims and refuses an OK one", () => {
  const { text, digest } = context({ manifest: { ...MANIFEST, evidence: [] }, evidence: [] });
  assert.equal(JSON.parse(text).status_expected, "NOT_EVALUABLE");
  assert.equal(digest.evidenceIds.size, 0);
  const empty = { claims: [], limitations: ["缺少涨停池与指数证据。"] };
  check(artifact(digest, { ...empty, status: "NOT_EVALUABLE", missing_sources: ["limit-up", "index"], state: "UNKNOWN" }), { context: digest });
  assert.equal(category(() => check(artifact(digest, { ...empty, state: "UNKNOWN" }), { context: digest })), "SCHEMA");
  // A claim still cites at least one id.
  const bare = { id: "c1", text: "缺少资料。", basis: "INSUFFICIENT", evidence_ids: [] };
  assert.equal(category(() => check(artifact(digest, { ...empty, claims: [bare], status: "NOT_EVALUABLE", missing_sources: ["limit-up", "index"], state: "UNKNOWN" }), { context: digest })), "SCHEMA");
});

test("a module schema cannot redefine an envelope field", () => {
  const { digest } = context();
  const loose = { ...SCHEMA, properties: { ...SCHEMA.properties, claims: {}, run: {} } };
  assert.equal(category(() => check(artifact(digest, { claims: "无" }), { context: digest, schema: loose })), "SCHEMA");
  assert.equal(category(() => check(artifact(digest, { run: 7 }), { context: digest, schema: loose })), "SCHEMA");
  assert.deepEqual(JSON.parse(context({ schema: loose }).text).schema.properties.claims.minItems, 0);
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

test("buildContext: a hints function gets the digest; plain hints are shown as given", () => {
  let received: Loose | undefined;
  const { text, digest } = context({ hints: (d: Loose) => ((received = d), { count: d.items.size }) });
  assert.equal(received, digest);
  assert.deepEqual(JSON.parse(text).hints, { count: digest.items.size });
  assert.equal(JSON.parse(context().text).hints, "按字段填写。");
});

test("buildContext: derivedView is the whole row of every derived item shown - no source or scope added; the item stays citable whole", () => {
  const { text, digest } = context({ derivedView: ({ id, measure, inputs }: Loose) => ({ id, measure, inputs_total: inputs.length }) });
  const parsed = JSON.parse(text);
  const seal = parsed.derived.find((item: Loose) => item.id === sealRatio.id);
  assert.deepEqual(Object.keys(seal), ["id", "measure", "inputs_total"]);
  assert.equal(digest.items.get(sealRatio.id).scope, "CURRENT");
  assert.equal(seal.inputs, undefined);
  assert.equal(seal.inputs_total, 2);
  assert.equal(parsed.derived.find((item: Loose) => item.id === advance.id).inputs_total, 0);
  assert.deepEqual(digest.items.get(sealRatio.id).item.inputs, sealRatio.inputs);
  // Without it a derived item is shown as frozen.
  assert.deepEqual(JSON.parse(context().text).derived.find((item: Loose) => item.id === sealRatio.id).inputs, sealRatio.inputs);
});

test("buildContext: when the truncated list itself would pass the cap, the last rows added are given back", () => {
  const rows = Array.from({ length: 400 }, (_, i) => withId({ pool: "zt", code: String(600000 + i), name: "某股".repeat(20), boards: 1 }));
  const kept = (extra: Loose[]) => {
    const evidence = [{ source: "limit-up", session: SESSION, items: [...rows, ...extra, sealRatio] }, EVIDENCE[1]];
    const { text } = context({ evidence });
    assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
    return JSON.parse(text);
  };
  const plain = kept([]);
  // Unasked rows of many kinds leave the base and the fill unchanged, but lengthen `truncated`.
  const odd = Array.from({ length: 20 }, (_, i) => withId({ kind: `unasked_kind_${String(i).padStart(2, "0")}_${"x".repeat(40)}` }));
  const squeezed = kept(odd);
  const count = (parsed: Loose) => parsed.evidence.filter((item: Loose) => item.pool === "zt").length;
  assert.ok(count(squeezed) < count(plain), `${count(squeezed)} < ${count(plain)}`);
  assert.equal(squeezed.truncated.find((entry: Loose) => entry.kind === "zt").count, 400 - count(squeezed));
  assert.equal(squeezed.truncated.filter((entry: Loose) => entry.kind.startsWith("unasked_kind_")).length, 20);
});

test("buildContext: derived items past the cap leave out the rest of them and every evidence row", () => {
  const derived = Array.from({ length: 300 }, (_, i) =>
    withId({ source: "limit-up", kind: "derived", measure: `m${i}`, value: i, inputs: [zt.id], note: "某".repeat(40) }));
  const evidence = [{ source: "limit-up", session: SESSION, items: [zt, ...derived] }, EVIDENCE[1]];
  const { text, digest } = context({ evidence });
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.evidence, []);
  assert.ok(parsed.derived.length > 0 && parsed.derived.length < 301);
  const cut = parsed.truncated.filter((entry: Loose) => entry.kind === "derived");
  assert.equal(cut.reduce((sum: number, entry: Loose) => sum + entry.count, 0), 301 - parsed.derived.length);
  assert.deepEqual(parsed.truncated.find((entry: Loose) => entry.kind === "zt"), { source: "limit-up", kind: "zt", count: 1 });
  assert.deepEqual(parsed.truncated.find((entry: Loose) => entry.kind === "index"), { source: "index", kind: "index", count: 1 });
  // Every derived id stays citable, shown or not.
  assert.equal(digest.derivedIds.size, 301);
});

// -------------------------------------------------------------------------------------------------
// The cited run (A5, A27, §5.1): a module reading a sealed cn-market run beside its own run.
// -------------------------------------------------------------------------------------------------

const MARKET_SNAP = `snap_${"b".repeat(64)}`;
const marketZt = withId({ pool: "zt", code: "600519", name: "丁", boards: 3 });
const marketSeal = withId({ source: "limit-up", kind: "derived", measure: "seal_ratio", value: 0.8, inputs: [marketZt.id] });
const marketBoard = withId({ kind: "board", code: "BK0002", name: "戊" });
const marketBars = withId({ kind: "bars", symbol: "sh000001", bars: [["2026-10-22", 3290]] });
const quote = withId({ kind: "quote", symbol: "sh600519", name: "丁", last: 1500 });
const sentimentArtifact = {
  module: "sentiment", snapshot_id: MARKET_SNAP, state: "REPAIR", money_effect: "WEAK", freeze_type: "UNKNOWN",
  claims: [{ id: "c1", text: "封板率回升。", basis: "CURRENT", evidence_ids: [marketSeal.id] }], limitations: [],
};
const themeArtifact = { module: "theme", mainline_candidates: [], theme_stage: "UNKNOWN", rotation: "UNKNOWN", claims: [], limitations: [] };
const leaderArtifact = { module: "leader", leader_candidates: [], top_pattern_flags: [], claims: [{ id: "c1", text: "丁在册。", basis: "CURRENT", evidence_ids: [quote.id] }] };

/** A sealed cn-market run, its files from `session` (the strategy run's own session by default). */
function marketOf(session = SESSION, artifacts: Loose = { sentiment: sentimentArtifact, theme: themeArtifact }): Loose {
  return {
    run: "m20261023", snapshot_id: MARKET_SNAP, session,
    evidence: [
      { source: "limit-up", session, items: [marketZt, marketSeal] },
      { source: "index", session, items: [marketBars] },
      { source: "boards", session, items: [marketBoard] },
    ],
    artifacts,
  };
}

/** A strategy run's context citing `market`: its quotes, the market's limit-up and boards, the market's sentiment and theme, the run's leader. */
function cited(market: Loose | null = marketOf(), overrides: Loose = {}) {
  return buildContext({
    module: "mode", run: "s20261023", manifest: { run: "s20261023", snapshot_id: MANIFEST.snapshot_id, as_of: MANIFEST.as_of, session: SESSION, evidence: [{ source: "quotes" }] },
    evidence: [{ source: "quotes", session: SESSION, items: [quote] }], sources: ["quotes"], priority: [{ source: "quotes", kind: "quote" }, { source: "market:limit-up", kind: "zt" }, { source: "market:boards", kind: "board" }],
    hypotheses: HYPOTHESES, schema: { type: "object", required: ["mode"], properties: { mode: { enum: ["WAIT", "UNKNOWN"] } } }, hints: "按字段填写。", example: {},
    required: ["quotes", "market:limit-up", "market:theme", "leader"],
    marketRun: "required", market, marketSources: ["limit-up", "boards"], marketArtifacts: ["sentiment", "theme"],
    runArtifacts: ["leader"], artifacts: { leader: leaderArtifact, counterevidence: { module: "counterevidence" } },
    ...overrides,
  });
}

/** A valid artifact of the citing context `digest`. */
function citing(digest: Loose, overrides: Loose = {}): Loose {
  return {
    module: digest.module, contract_version: digest.contract_version, hypotheses_version: digest.hypotheses_version,
    snapshot_id: digest.snapshot_id, run: digest.run, as_of: digest.as_of, session: digest.session,
    market_run: digest.market_run, market_snapshot_id: digest.market_snapshot_id,
    status: "OK", missing_sources: [], mode: "WAIT",
    claims: [{ id: "c1", text: "丁的报价在本运行交易日冻结。", basis: "CURRENT", evidence_ids: [quote.id, `sentiment@${MARKET_SNAP}`] }],
    limitations: [],
    ...overrides,
  };
}

const checkCiting = (raw: unknown, digest: Loose) =>
  validateEnvelope(raw, { module: "mode", context: digest, schema: { type: "object", required: ["mode"], properties: { mode: { enum: ["WAIT", "UNKNOWN"] } } }, owns: [] });

test("buildContext with a cited run: market items join the digest as market:<source>, scoped against the strategy run's session", () => {
  const { digest, text } = cited();
  assert.deepEqual(digest.market, { run: "m20261023", snapshot_id: MARKET_SNAP, session: SESSION });
  assert.equal(digest.market_run, "m20261023");
  assert.equal(digest.market_snapshot_id, MARKET_SNAP);
  assert.deepEqual(digest.items.get(marketZt.id), { source: "market:limit-up", kind: "zt", scope: "CURRENT", item: marketZt });
  assert.equal(digest.items.get(marketBoard.id).source, "market:boards");
  // Only the market sources the module reads.
  assert.equal(digest.items.has(marketBars.id), false);
  assert.ok(digest.evidenceIds.has(marketSeal.id) && digest.derivedIds.has(marketSeal.id));
  assert.equal(digest.items.get(quote.id).source, "quotes");
  const context = JSON.parse(text);
  assert.equal(context.market_run, "m20261023");
  assert.equal(context.market_snapshot_id, MARKET_SNAP);
  assert.deepEqual(context.market, digest.market);
  assert.deepEqual(context.derived.map((row: Loose) => [row.id, row.source]), [[marketSeal.id, "market:limit-up"]]);
  assert.deepEqual(context.evidence.map((row: Loose) => row.id), [quote.id, marketZt.id, marketBoard.id]);
  assert.ok(context.schema.required.includes("market_run") && context.schema.required.includes("market_snapshot_id"));

  // The market run of the previous session: its items are HISTORICAL for this run.
  const older = cited(marketOf("2026-10-22")).digest;
  assert.equal(older.items.get(marketZt.id).scope, "HISTORICAL");
  assert.equal(older.items.get(quote.id).scope, "CURRENT");
});

test("buildContext with a cited run: the named market and run artifacts are shown as digests and citable as <module>@<snapshot_id>", () => {
  const { digest, text } = cited();
  const context = JSON.parse(text);
  assert.deepEqual(context.artifacts, [
    {
      id: `sentiment@${MARKET_SNAP}`, module: "sentiment", headline: { state: "REPAIR", money_effect: "WEAK", freeze_type: "UNKNOWN" },
      claims: [{ id: "c1", text: "封板率回升。", evidence_ids: [marketSeal.id] }],
    },
    { id: `theme@${MARKET_SNAP}`, module: "theme", headline: { mainline_candidates: [], theme_stage: "UNKNOWN", rotation: "UNKNOWN" }, claims: [] },
    { id: `leader@${MANIFEST.snapshot_id}`, module: "leader", headline: { leader_candidates: [], top_pattern_flags: [] }, claims: [{ id: "c1", text: "丁在册。", evidence_ids: [quote.id] }] },
  ]);
  assert.deepEqual([...digest.artifactIds], [`sentiment@${MARKET_SNAP}`, `theme@${MARKET_SNAP}`, `leader@${MANIFEST.snapshot_id}`]);
  // The parsed artifacts stay in the digest for a contract's rules, by id.
  assert.deepEqual(digest.artifacts.get(`sentiment@${MARKET_SNAP}`), { module: "sentiment", source: "market:sentiment", scope: "CURRENT", artifact: sentimentArtifact });
  assert.equal(digest.artifacts.get(`leader@${MANIFEST.snapshot_id}`).source, "leader");
  assert.deepEqual(digest.missing, []);
});

test("buildContext with a cited run: missing names market:<source>, market:<module> and a run artifact; no market run leaves every market entry missing", () => {
  const thin = cited({ ...marketOf(), evidence: marketOf().evidence.filter((file: Loose) => file.source !== "limit-up"), artifacts: { sentiment: sentimentArtifact } }, { artifacts: {} }).digest;
  assert.deepEqual(thin.missing, ["market:limit-up", "market:theme", "leader"]);
  const none = cited(null, { marketRun: "optional" });
  assert.deepEqual(none.digest.missing, ["market:limit-up", "market:theme"]);
  assert.equal(none.digest.market, null);
  assert.equal(none.digest.market_run, null);
  assert.equal(none.digest.market_snapshot_id, null);
  assert.deepEqual(JSON.parse(none.text).market, null);
});

test("buildContext without a cited run: the context text and envelope are plan 2's, no market or artifact fields", () => {
  const { text, digest } = context();
  const shown = JSON.parse(text);
  for (const field of ["market", "market_run", "market_snapshot_id", "artifacts"]) assert.equal(Object.hasOwn(shown, field), false, field);
  assert.equal(Object.hasOwn(digest, "market_run"), false);
  assert.equal(shown.schema.required.includes("market_run"), false);
  assert.equal(shown.schema.properties.claims.items.properties.evidence_ids.items.pattern, "^ev_[a-f0-9]{24}$");
  // An artifact id cited by a module that cites no run is SCHEMA, as before.
  assert.equal(category(() => check(artifact(digest, { claims: [{ id: "c1", text: "情绪进入扩张。", basis: "CURRENT", evidence_ids: [indexQuote.id, `theme@${MARKET_SNAP}`] }] }))), "SCHEMA");
});

test("validateEnvelope with a cited run: market_run and market_snapshot_id required and bound; an artifact id is citable, an unknown one REFERENCE", () => {
  const { digest } = cited();
  checkCiting(citing(digest), digest);
  checkCiting(JSON.stringify(citing(digest)), digest);
  for (const field of ["market_run", "market_snapshot_id"]) {
    assert.equal(category(() => checkCiting(citing(digest, { [field]: "other" }), digest)), "REFERENCE", field);
    const { [field]: _dropped, ...without } = citing(digest);
    assert.equal(category(() => checkCiting(without, digest)), "SCHEMA", field);
  }
  const cite = (ids: string[], basis = "CURRENT") => ({ claims: [{ id: "c1", text: "丁的报价已冻结。", basis, evidence_ids: ids }] });
  // The run's own leader artifact is citable by the strategy run's snapshot.
  checkCiting(citing(digest, cite([`leader@${MANIFEST.snapshot_id}`])), digest);
  // Not shown, so not citable: a run artifact the contract does not list, a market artifact of another snapshot.
  assert.equal(category(() => checkCiting(citing(digest, cite([`counterevidence@${MANIFEST.snapshot_id}`])), digest)), "REFERENCE");
  assert.equal(category(() => checkCiting(citing(digest, cite([`theme@snap_${"c".repeat(64)}`])), digest)), "REFERENCE");
  assert.equal(category(() => checkCiting(citing(digest, { limitations: [`缺少 theme@snap_${"c".repeat(64)} 的核验。`] }), digest)), "REFERENCE");
  // A previous session's artifact is HISTORICAL evidence for a strategy run of today.
  const older = cited(marketOf("2026-10-22")).digest;
  assert.equal(category(() => checkCiting(citing(older, cite([`sentiment@${MARKET_SNAP}`])), older)), "TIME_SCOPE");
  checkCiting(citing(older, { claims: [{ id: "c1", text: "前一交易日的读数为修复。", basis: "HISTORICAL", evidence_ids: [`sentiment@${MARKET_SNAP}`, marketZt.id] }] }), older);
});

test("buildContext with a cited run: an artifact view is bounded - six claims, each text cut to 120 characters, ids whole, claims_total when cut", () => {
  const long = "封".repeat(300);
  const claims = Array.from({ length: 10 }, (_, i) => ({ id: `c${i + 1}`, text: long, basis: "CURRENT", evidence_ids: [marketSeal.id, marketZt.id] }));
  const big = { ...sentimentArtifact, claims };
  const { text, digest } = cited(marketOf(SESSION, { sentiment: big, theme: themeArtifact }));
  const view = JSON.parse(text).artifacts[0];
  assert.equal(view.id, `sentiment@${MARKET_SNAP}`);
  assert.equal(view.claims.length, 6);
  assert.equal(view.claims_total, 10);
  for (const claim of view.claims) {
    assert.equal(Array.from(claim.text).length, 120);
    assert.deepEqual(claim.evidence_ids, [marketSeal.id, marketZt.id]);
  }
  // The digest keeps the artifact whole; a view within the bound has no claims_total.
  assert.equal(digest.artifacts.get(`sentiment@${MARKET_SNAP}`).artifact.claims.length, 10);
  assert.equal(Object.hasOwn(JSON.parse(cited().text).artifacts[0], "claims_total"), false);
});

test("buildContext with a cited run: an artifact the cap leaves out is not citable, counted in truncated, and missing when required", () => {
  const wide = { ...themeArtifact, mainline_candidates: ["x".repeat(29 * 1024)] };
  const { text, digest } = cited(marketOf(SESSION, { sentiment: sentimentArtifact, theme: wide }));
  const context = JSON.parse(text);
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES);
  assert.deepEqual(context.artifacts.map((row: Loose) => row.id), [`sentiment@${MARKET_SNAP}`]);
  assert.deepEqual([...digest.artifactIds], [`sentiment@${MARKET_SNAP}`]);
  assert.ok(context.truncated.some((group: Loose) => group.source === "market:theme" && group.kind === "artifact" && group.count === 1));
  // The run's leader comes after the theme, so the latching cap leaves it out too.
  assert.deepEqual(digest.missing, ["market:theme", "leader"]);
  assert.deepEqual(context.missing, ["market:theme", "leader"]);
  assert.equal(context.status_expected, "NOT_EVALUABLE");
  assert.equal(category(() => checkCiting(citing(digest, { claims: [{ id: "c1", text: "读数待核。", basis: "CURRENT", evidence_ids: [quote.id, `theme@${MARKET_SNAP}`] }] }), digest)), "REFERENCE");
  // A left-out artifact the contract does not require is not missing.
  const optional = cited(marketOf(SESSION, { sentiment: sentimentArtifact, theme: wide }), { required: ["quotes"] });
  assert.deepEqual(optional.digest.missing, []);
  assert.equal(JSON.parse(optional.text).status_expected, "OK");
});

test("buildContext with a cited run: an item frozen in both runs keeps the strategy run's entry", () => {
  const market = marketOf();
  const both = { ...market, evidence: market.evidence.map((file: Loose) => (file.source === "limit-up" ? { ...file, session: "2026-10-22", items: [...file.items, quote] } : file)) };
  const { digest } = cited(both);
  assert.deepEqual(digest.items.get(quote.id), { source: "quotes", kind: "quote", scope: "CURRENT", item: quote });
  assert.equal(digest.items.get(marketZt.id).source, "market:limit-up");
});

test("validateEnvelope with a cited run: an artifact id in free text is read whole - a longer hex run is not one", () => {
  const { digest } = cited();
  checkCiting(citing(digest, { limitations: [`sentiment@${MARKET_SNAP}。`] }), digest);
  assert.equal(category(() => checkCiting(citing(digest, { limitations: [`theme@snap_${"c".repeat(64)}，待核。`] }), digest)), "REFERENCE");
  // 65 hex digits name no snapshot, so the scan takes no id from them, the known one's prefix included.
  checkCiting(citing(digest, { limitations: [`sentiment@${MARKET_SNAP}0 不是工件编号。`] }), digest);
});
