/**
 * The Lunhui contract module, `plugins/lunhui/lib/contract.mjs` (spec G2, D6, D9). Ported under
 * their source names from the source branch (evolving-alpha `codex/lunhui-agent-design` @
 * 2ae4df0): the 13 cases of `frontend/test/analysis-contract.test.mjs` with their helpers, and of
 * `frontend/harness/runner.test.mjs` the one case that needs no harness launcher, on
 * `buildSchemaExample` and `classifyValidationRejection`, with its `fixtureSnapshot`, and the
 * fact-check assertions of its tool case (:317-357), made direct `buildFactChecks` calls on that
 * case's five-bar history (:235-257), since the tool that returned them is not ported (the freeze
 * rows, `lunhui-freeze.test.ts`, take its place); then the two hints' byte budget, and
 * `buildAnalysisContext` on what `freezeSample` freezes from the synthetic fixtures in
 * `fixtures/lunhui/` (spec §5.1). The bodies are the source's; the TypeScript adaptations are type-level only: `buildAnalysisContext`
 * re-declared with the parameter and result types the untyped module cannot give it, parameter
 * types on the helpers and on one callback, loose return types on the three fixture builders
 * whose output a case extends, nulls or deletes, loose items for the fact checks a case reads by
 * kind, and a parameter type on the two predicates given to `assert.throws`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_CONTRACT_HINT, ANALYSIS_JSON_SCHEMA, FACT_CHECK_HINT, buildAnalysisContext as untypedBuildAnalysisContext,
  buildFactChecks, buildSchemaExample, classifyValidationRejection, validateAnalysis,
} from "../plugins/lunhui/lib/contract.mjs";
import { freezeSample } from "../plugins/lunhui/lib/market.mjs";
import { fixtureFetch } from "./fixtures/lunhui/fetch.ts";

/** A fixture as the source's untyped tests use one: a case may add, null or delete any field. */
type Loose = Record<string, any>;
/** A snapshot fixture: loose, and so are its quotes. */
type Snapshot = { quotes: Loose[]; [key: string]: any };
/** The context as TypeScript infers it from the module, but for the two arrays it can only read as `any`. */
type Context = Omit<ReturnType<typeof untypedBuildAnalysisContext>, "universe" | "evidence"> & {
  universe: any[];
  evidence: any[];
};
/** The module's own function, typed: TypeScript reads its `{ histories = [] }` default as `never[]`. */
const buildAnalysisContext = untypedBuildAnalysisContext as (
  snapshot: unknown,
  options?: { histories?: unknown[] },
) => Context;

// ---- frontend/test/analysis-contract.test.mjs ----

function snapshot({
  asOf = "2026-10-12T02:00:00Z",
  quotedAt = "2026-10-12T09:59:30+08:00",
  quality = "current",
  cacheState = "fresh",
}: {
  asOf?: string;
  quotedAt?: string | null;
  quality?: string;
  cacheState?: string;
} = {}): Snapshot {
  const symbols = [
    "sh000001",
    "sz399001",
    "sz399006",
    "sh000300",
    "sh600519",
    "sz000001",
    "sh601318",
    "sz000333",
  ];
  return {
    provider: "tencent",
    servedAt: asOf,
    receivedAt: asOf,
    cache: { state: cacheState },
    quotes: symbols.map((symbol) => ({
      provider: "tencent",
      symbol,
      name: symbol === "sh600519" ? "贵州茅台" : symbol,
      kind:
        symbol.startsWith("sh6") || symbol.startsWith("sz0")
          ? "equity"
          : "index",
      last: 100,
      previousClose: 98,
      open: 99,
      high: 102,
      low: 97,
      change: 2,
      changePercent: 2.04,
      volumeShares: 100000,
      amountCny: 1e7,
      quotedAt,
      quality,
      validity: { priceValid: true, timeValid: true, dateMatches: true },
    })),
  };
}
function result(context: Context, basis = "CURRENT"): Loose {
  const q = context.evidence.find((e) => e.symbol === "sh600519");
  return {
    summary:
      basis === "CURRENT"
        ? "快照时点样本报价可供描述性观察，策略条件仍不可评估。"
        : "历史报价只供描述性观察，策略条件仍不可评估。",
    marketView: {
      scope: "PROVIDED_SAMPLE_ONLY",
      phase: "UNKNOWN",
      basis,
      text: "仅描述所提供样本，无法判断全市场广度或题材状态。",
      evidenceIds: [q.id],
    },
    observations: [
      {
        symbol: "sh600519",
        stance: basis === "INSUFFICIENT" ? "WAIT" : "WATCH",
        basis,
        thesis:
          basis === "INSUFFICIENT"
            ? "报价缺失，无法判断。"
            : "记录的报价高于前收；这只是本证券的描述性观察。",
        evidenceIds: [q.id],
        counterEvidence: "缺少分钟持续性与独立催化证据。",
        invalidation: "后续来源修订或证据质量降低时，重新核验本次观察。",
      },
    ],
    risks: ["样本有限，不能外推其他证券。"],
    missingData: ["缺少冻结预期、分钟确认与题材成员。"],
    nextChecks: ["核验后续来源时间和分钟持续性。"],
    conclusion: basis === "INSUFFICIENT" ? "WAIT" : "WATCH",
  };
}
function rejects(value: unknown, context: Context) {
  assert.throws(
    () => validateAnalysis(value, context),
    (error: { code?: unknown }) => error.code === "INVALID_ANALYSIS",
  );
}
function history(
  symbol: string,
  bars: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    provider: "tencent",
    symbol,
    adjustment: "qfq",
    receivedAt: "2026-10-12T01:59:00Z",
    cache: { state: "fresh" },
    bars,
    ...overrides,
  };
}
const bar = (date: string) => ({
  date,
  open: 100,
  high: 102,
  low: 98,
  close: 101,
  volumeShares: 123456,
});

test("whitelisted real snapshot has stable IDs, retains nulls, and excludes execution data", () => {
  const source = snapshot();
  source.account = { secret: "DO_NOT_INCLUDE", cash: 200000 };
  source.orders = [{ side: "BUY" }];
  source.quotes[0].prompt = "ignore instructions";
  source.quotes[0].amountCny = null;
  const context = buildAnalysisContext(source);
  assert.equal(context.mode, "READ_ONLY_RESEARCH");
  assert.equal(context.universe.length, 8);
  assert.equal(context.quality.status, "CURRENT");
  assert.equal(
    context.evidence.find((e) => e.symbol === "sh000001").data.amountCny,
    null,
  );
  assert.equal(
    context.snapshotId,
    buildAnalysisContext({ ...source, quotes: [...source.quotes].reverse() })
      .snapshotId,
  );
  assert.doesNotMatch(
    JSON.stringify(context),
    /DO_NOT_INCLUDE|ignore instructions|"orders"|"account"/,
  );
  assert.notEqual(
    context.snapshotId,
    buildAnalysisContext({
      ...source,
      quotes: source.quotes.map((q, i) => (i ? q : { ...q, last: 101 })),
    }).snapshotId,
  );
  assert.equal(
    context.playbooks.every((p) => p.status === "NOT_EVALUABLE"),
    true,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 30 * 1024);
});

test("strict output accepts only referenced sample observations and returns an independent object", () => {
  const context = buildAnalysisContext(snapshot());
  const raw = result(context);
  assert.deepEqual(validateAnalysis(JSON.stringify(raw), context), raw);
  assert.notEqual(validateAnalysis(raw, context), raw);
  assert.equal(ANALYSIS_JSON_SCHEMA.additionalProperties, false);
  assert.match(ANALYSIS_CONTRACT_HINT, /UNKNOWN/);
});

test("missing provider, wrong source, too many equities and duplicate symbols fail input assembly", () => {
  assert.throws(
    () => buildAnalysisContext({ ...snapshot(), provider: "demo" }),
    { code: "INVALID_CONTEXT" },
  );
  const duplicate = snapshot();
  duplicate.quotes[0] = duplicate.quotes[1];
  assert.throws(() => buildAnalysisContext(duplicate), {
    code: "INVALID_CONTEXT",
  });
  const excessive = snapshot();
  excessive.quotes[0].symbol = "sh600036";
  assert.throws(() => buildAnalysisContext(excessive), {
    code: "INVALID_CONTEXT",
  });
  assert.throws(
    () =>
      buildAnalysisContext({ ...snapshot(), servedAt: "2026-02-30T10:00:00Z" }),
    { code: "INVALID_CONTEXT" },
  );
});

test("schema rejects absent fields, unknown fields, invalid enum, fences and unbounded output", () => {
  const context = buildAnalysisContext(snapshot());
  const absent = result(context);
  delete absent.risks;
  rejects(absent, context);
  rejects({ ...result(context), permit: true }, context);
  rejects({ ...result(context), conclusion: "BUY" }, context);
  rejects({ ...result(context), summary: "x".repeat(801) }, context);
  rejects({ ...result(context), risks: [] }, context);
  rejects("```json\n{}\n```", context);
  rejects(null, context);
});

test("out-of-universe and unrelated or nonexistent evidence cannot support a claim", () => {
  const context = buildAnalysisContext(snapshot());
  const wrongSymbol = result(context);
  wrongSymbol.observations[0].symbol = "sh600036";
  rejects(wrongSymbol, context);
  const unknown = result(context);
  unknown.observations[0].evidenceIds = ["ev_" + "f".repeat(24)];
  rejects(unknown, context);
  const wrongEvidence = result(context);
  wrongEvidence.observations[0].evidenceIds = [
    context.evidence.find((e) => e.symbol === "sh000001").id,
  ];
  rejects(wrongEvidence, context);
  const duplicate = result(context);
  duplicate.observations.push(structuredClone(duplicate.observations[0]));
  rejects(duplicate, context);
  rejects({ ...result(context), summary: "sh600036 表现突出。" }, context);
});

test("expired, stale-cache, and non-open quotes cannot be relabeled current", () => {
  for (const source of [
    snapshot({ quotedAt: "2026-10-12T09:55:00+08:00" }),
    snapshot({ cacheState: "stale" }),
    snapshot({
      asOf: "2026-10-12T04:00:00Z",
      quotedAt: "2026-10-12T11:30:00+08:00",
      quality: "close",
    }),
    snapshot({
      asOf: "2026-10-02T02:00:00Z",
      quotedAt: "2026-09-30T15:00:00+08:00",
      quality: "close",
    }),
  ]) {
    const context = buildAnalysisContext(source);
    assert.equal(context.quality.status, "HISTORICAL");
    rejects(result(context, "CURRENT"), context);
    assert.equal(
      validateAnalysis(result(context, "HISTORICAL"), context).conclusion,
      "WATCH",
    );
    const dishonest = result(context, "HISTORICAL");
    dishonest.observations[0].thesis = "当前走势很强。";
    rejects(dishonest, context);
    dishonest.observations[0].thesis = "历史样本报价可供核验。";
    dishonest.summary = "今日强势延续。";
    rejects(dishonest, context);
  }
});

test("future, malformed and missing quote times produce insufficient evidence and WAIT only", () => {
  for (const quotedAt of [
    null,
    "2026-10-12 10:00:00",
    "2026-10-12T10:01:00+08:00",
  ]) {
    const context = buildAnalysisContext(snapshot({ quotedAt }));
    assert.equal(context.quality.status, "INSUFFICIENT");
    assert.equal(context.evidence[0].data.last, null);
    rejects(result(context), context);
    assert.equal(
      validateAnalysis(result(context, "INSUFFICIENT"), context).conclusion,
      "WAIT",
    );
    const watch = result(context, "INSUFFICIENT");
    watch.conclusion = "WATCH";
    rejects(watch, context);
  }
});

test("history preserves adjustment, excludes current/future/invalid bars and late retrievals", () => {
  const source = snapshot();
  const context = buildAnalysisContext(source, {
    histories: [
      history("sh600519", [
        bar("2026-10-09"),
        bar("2026-10-12"),
        bar("2026-10-13"),
        { ...bar("2026-10-08"), low: null },
      ]),
    ],
  });
  const historical = context.evidence.find((e) => e.kind === "DAILY_HISTORY");
  assert.deepEqual(
    historical.data.bars.map((b: unknown[]) => b[0]),
    ["2026-10-09"],
  );
  assert.equal(historical.data.adjustment, "qfq");
  assert.equal(historical.basis, "HISTORICAL");
  assert.match(context.limitations.join(" "), /point-in-time/);
  const late = buildAnalysisContext(source, {
    histories: [
      history("sh600519", [bar("2026-10-09")], {
        receivedAt: "2026-10-12T03:00:00Z",
      }),
    ],
  });
  assert.equal(
    late.evidence.some((e) => e.kind === "DAILY_HISTORY"),
    false,
  );
  const impossible = buildAnalysisContext(source, {
    histories: [
      history("sh600519", [bar("2026-10-09")], {
        receivedAt: "2026-10-08T03:00:00Z",
      }),
    ],
  });
  assert.equal(
    impossible.evidence.some((e) => e.kind === "DAILY_HISTORY"),
    false,
  );
  assert.throws(
    () =>
      buildAnalysisContext(source, {
        histories: [history("sh600036", [bar("2026-10-09")])],
      }),
    { code: "INVALID_CONTEXT" },
  );
  const wrongBasis = result(context);
  wrongBasis.observations[0].evidenceIds = [historical.id];
  rejects(wrongBasis, context);
});

test("maximum high-precision history remains below 30 KiB and truncation IDs are stable", () => {
  const source = snapshot();
  const bars = Array.from({ length: 100 }, (_, i) => ({
    ...bar(
      new Date(Date.UTC(2026, 5, 1) + i * 86400_000).toISOString().slice(0, 10),
    ),
    open: 99.12345678901234,
    high: 102.12345678901234,
    low: 98.12345678901234,
    close: 100.12345678901234,
    volumeShares: 123456789.1234567,
  }));
  const histories = source.quotes.map((q) => history(q.symbol, bars));
  const context = buildAnalysisContext(source, { histories });
  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 30 * 1024);
  assert.equal(
    context.evidence.filter((e) => e.kind === "DAILY_HISTORY").length,
    8,
  );
  assert.equal(
    context.snapshotId,
    buildAnalysisContext(source, { histories: [...histories].reverse() })
      .snapshotId,
  );
  for (const e of context.evidence.filter((e) => e.kind === "DAILY_HISTORY"))
    assert.ok(e.data.bars.length >= 1 && e.data.bars.length <= 60);
});

test("execution language, price targets and unsupported market-wide conclusions are rejected", () => {
  const context = buildAnalysisContext(snapshot());
  for (const summary of [
    "建议买入。",
    "目标价 120。",
    "价格上看 120 元。",
    "建议介入。",
    "仓位 20%。",
    "Buy this stock.",
    "全市场进入修复。",
    "该股确认为龙头。",
    "题材已经启动。",
    "账户风险较低。",
    "可以开始下单。",
  ])
    rejects({ ...result(context), summary }, context);
  const invalidPhase = result(context);
  invalidPhase.marketView.phase = "REPAIR";
  rejects(invalidPhase, context);
});

test("context is snapshot-bound and copied evidence cannot be relabeled after assembly", () => {
  const context = buildAnalysisContext(snapshot({ cacheState: "stale" }));
  const output = result(context, "HISTORICAL");
  context.evidence[0].basis = "CURRENT";
  rejects(output, context);
});

test("unknown calendar year never yields CURRENT regardless of provider quality", () => {
  const context = buildAnalysisContext(
    snapshot({
      asOf: "2027-01-04T02:00:00Z",
      quotedAt: "2027-01-04T09:59:30+08:00",
    }),
  );
  assert.equal(context.session.status, "unknown");
  assert.equal(context.quality.status, "HISTORICAL");
  rejects(result(context), context);
});

test("rejection identifies the faulty field without echoing generated prose", () => {
  const context = buildAnalysisContext(snapshot());
  const output = result(context);
  output.observations[0].counterEvidence = "模型原句标记：建议买入。";
  assert.throws(
    () => validateAnalysis(output, context),
    (error: Error & { code?: unknown }) => {
      assert.match(
        error.message,
        /^analysis\.observations\[0\]\.counterEvidence:/,
      );
      assert.doesNotMatch(error.message, /模型原句标记/);
      return error.code === "INVALID_ANALYSIS";
    },
  );
});

// ---- frontend/harness/runner.test.mjs: the case that needs no harness launcher ----

const fixtureSnapshot = (): Snapshot => ({
  provider: "tencent",
  servedAt: "2026-10-12T20:00:00Z",
  receivedAt: "2026-10-12T19:59:59Z",
  cache: { state: "fresh" },
  quotes: [
    {
      symbol: "sh600519",
      provider: "tencent",
      name: "测试证券",
      quotedAt: "2026-10-12T15:00:00+08:00",
      quality: "close",
      last: 100,
      previousClose: 99,
      open: 99,
      high: 102,
      low: 98,
      volumeShares: 10000,
      amountCny: 1000000,
    },
  ],
});

test("schema examples preserve immutable context and classification handles field-prefixed errors", () => {
  const fixtures = [fixtureSnapshot(), fixtureSnapshot(), fixtureSnapshot()];
  fixtures[1].quotes[0].last = null;
  fixtures[1].quotes[0].quality = "missing";
  fixtures[2].servedAt = "2026-10-12T02:00:10Z";
  fixtures[2].receivedAt = "2026-10-12T02:00:09Z";
  Object.assign(fixtures[2].quotes[0], {
    quotedAt: "2026-10-12T10:00:00+08:00",
    quality: "current",
    validity: { priceValid: true, timeValid: true, dateMatches: true },
  });
  for (const snapshot of fixtures) {
    const context = buildAnalysisContext(snapshot);
    const frozen = JSON.stringify(context);
    const example = buildSchemaExample(context);
    assert.deepEqual(validateAnalysis(example, context), example);
    assert.equal(example.conclusion, "WAIT");
    assert.equal(example.observations[0].stance, "WAIT");
    assert.equal(example.observations[0].basis, context.evidence[0].basis);
    assert.deepEqual(example.marketView.evidenceIds, [context.evidence[0].id]);
    assert.equal(JSON.stringify(context), frozen);
  }
  for (const [message, expected] of [
    ["analysis.summary: invalid string.", "SCHEMA"],
    [
      "analysis.observations[1].evidenceIds: Unknown evidence reference.",
      "REFERENCE",
    ],
    [
      "analysis.observations[1]: Non-current evidence was described as current.",
      "TIME_SCOPE",
    ],
    [
      "analysis.nextChecks[0]: Unsupported whole-market, theme, or leadership assertion.",
      "UNSUPPORTED_SCOPE",
    ],
    [
      "analysis.summary: Trading, target-price, or account content is outside the research contract.",
      "EXECUTION_CONTENT",
    ],
    ["Analysis exceeds its byte budget.", "BYTE_LIMIT"],
    ["Unknown issue containing MODEL_BODY_SENTINEL", "OTHER"],
  ])
    assert.equal(classifyValidationRejection(new Error(message)), expected);
});

// ---- frontend/harness/runner.test.mjs: the tool case's fact checks, called directly ----

test("fact checks compare adjacent available closes and never date the quote's previous close", () => {
  const context = buildAnalysisContext(fixtureSnapshot(), {
    histories: [
      {
        provider: "tencent",
        symbol: "sh600519",
        adjustment: "qfq",
        receivedAt: "2026-10-12T19:59:00Z",
        bars: (
          [
            ["2026-09-28", 100],
            ["2026-09-29", 101],
            ["2026-09-30", 99],
            ["2026-10-09", 103],
            ["2026-10-12", 102],
          ] as const
        ).map(([date, close]) => ({
          date,
          open: close,
          close,
          high: close + 1,
          low: close - 1,
          volumeShares: 10000,
        })),
      },
    ],
  });
  const frozenContextText = JSON.stringify(context);
  const facts: Loose[] = buildFactChecks(context);
  const quoteFacts = facts.find((item) => item.kind === "QUOTE_REFERENCE");
  assert.ok(quoteFacts);
  assert.equal(quoteFacts.quoteDate, "2026-10-12");
  assert.equal(quoteFacts.previousClose, 99);
  assert.equal(quoteFacts.previousCloseDate, null); // No date inferred by mixing qfq history with an unadjusted quote.
  assert.equal(quoteFacts.computedChangeVsPreviousClosePercent, 1.010101);
  const historyFacts = facts.find((item) => item.kind === "AVAILABLE_CLOSE_COMPARISONS");
  assert.ok(historyFacts);
  assert.equal(
    historyFacts.evidenceId,
    context.evidence.find((item) => item.kind === "DAILY_HISTORY").id,
  );
  assert.equal(historyFacts.calendarContinuityVerified, false);
  assert.equal(historyFacts.adjustment, "qfq");
  assert.deepEqual(
    historyFacts.closingComparisons.map((item: Loose) =>
      Math.sign(item.changePercent),
    ),
    [1, -1, 1, -1],
  );
  assert.deepEqual(historyFacts.closingComparisons.at(-1), {
    fromDate: "2026-10-09",
    toDate: "2026-10-12",
    fromClose: 103,
    toClose: 102,
    changePercent: -0.970874,
  });
  assert.deepEqual(
    buildFactChecks({
      evidence: [
        {
          id: "missing",
          kind: "QUOTE",
          asOf: null,
          data: { last: null, previousClose: null },
        },
      ],
    })[0].computedChangeVsPreviousClosePercent,
    null,
  );
  assert.equal(JSON.stringify(context), frozenContextText); // Arithmetic aids must not rewrite hashed evidence.
});

// ---- the two hints, one home (spec D9) ----

test("the hints are the source's and fit the role budget together", () => {
  assert.ok(ANALYSIS_CONTRACT_HINT.includes("ANALYSIS_JSON_SCHEMA"));
  assert.ok(FACT_CHECK_HINT.startsWith("写作前进行事实核对"));
  assert.ok(Buffer.byteLength(ANALYSIS_CONTRACT_HINT + FACT_CHECK_HINT) < 4096);
});

// ---- buildAnalysisContext on what freezeSample freezes (spec §5.1) ----

/** The fixture instant (2026-10-13 09:00:33 China time, pre-open), as in `lunhui-market.test.ts`. */
const FREEZE_AT = new Date("2026-10-13T01:00:33.165Z");

test("buildAnalysisContext accepts a freezeSample result and binds a snapshot id", async () => {
  const { snapshot, histories } = await freezeSample({ symbols: ["sh000001", "sh600519"], fetchImpl: fixtureFetch, now: FREEZE_AT });
  const context = buildAnalysisContext(snapshot, { histories });
  assert.match(context.snapshotId, /^snap_[0-9a-f]{64}$/);
  assert.deepEqual(context.universe.map((item) => item.symbol), ["sh000001", "sh600519"]);
  assert.deepEqual(
    context.evidence.map((e) => `${e.symbol} ${e.kind}`).sort(),
    ["sh000001 DAILY_HISTORY", "sh000001 QUOTE", "sh600519 DAILY_HISTORY", "sh600519 QUOTE"],
  );
});

test("a failed daily fetch is named among the limitations", async () => {
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const target = new URL(url);
    if (target.host === "web.ifzq.gtimg.cn" && (target.searchParams.get("param") ?? "").startsWith("sh600519,"))
      throw new Error("connection lost");
    return fixtureFetch(url, init);
  };
  const { snapshot, histories } = await freezeSample({ symbols: ["sh000001", "sh600519"], fetchImpl, now: FREEZE_AT });
  const context = buildAnalysisContext(snapshot, { histories });
  assert.ok(context.limitations.includes("sh600519 日线缺少可核验来源时间/复权口径，或晚于快照，已排除。"));
  assert.equal(context.evidence.some((e) => e.kind === "DAILY_HISTORY" && e.symbol === "sh600519"), false);
  // Only the failed history is excluded: the other symbol's daily history survives.
  assert.equal(context.evidence.some((e) => e.kind === "DAILY_HISTORY" && e.symbol === "sh000001"), true);
});
