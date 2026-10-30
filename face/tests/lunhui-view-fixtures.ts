/**
 * The shared synthetic fixtures of the Lunhui run view's tests: `syntheticPools1027()`, the three
 * limit-up pools of a made-up session 2026-10-27 in the shape `eastmoney.mjs` parses them to, each
 * row tagged with its `pool`. Nothing here was fetched; every code, name, price and time is made
 * up (A26), and the rows are a pure function of the tables below - no clock, no randomness. Codes
 * are six digits with no exchange, as the pools send them; names are `样本` plus the code, except
 * `600001`'s.
 *
 * The ladder the pools make (`ladderCodes`): `600001` sealed at 5 boards, `600011`–`600013` at 4,
 * `000101`–`000108` at 2; `000021` broke trying its third board, `000109`–`000111` their second;
 * `600014`–`600016` (3 boards yesterday) and `000022`–`000028` (2) did not seal again - 26 names.
 * `002001` sits in zt and zb both, the overlap; `003001`–`003024` broke on a first board, and
 * `000101`–`000140` held 1 board yesterday.
 *
 * `syntheticSealedRun()` is a whole sealed market run of that session in the shape the view reads
 * (`evidenceView`): the manifest, the metrics, the index and limit-up evidence with their derived
 * items and minute lines, and the four market artifacts keyed by module. Its index quotes, counts
 * and derived values are the 10-27 run's as the spec pins them (Appendix A); the derived limit-up
 * values are pinned too, not recomputed from the pools. The index minute lines come from the
 * generator's formula (`fixtures/lunhui/make-minutes.mjs`), parsed by `parseTencentMinutes` as the
 * freeze parses a reply; `600001` and `600011` have stock lines, `600012` is `minutes_missing`.
 */
import { evidenceId } from "../plugins/lunhui/lib/runs.mjs";
import { limitPrices, parseTencentMinutes } from "../plugins/lunhui/lib/market.mjs";
import { INDEX_PRECS, minutesReply } from "./fixtures/lunhui/make-minutes.mjs";

type Row = Record<string, unknown>;
export type Pools = { zt: Row[]; zb: Row[]; yesterday: Row[] };

const round2 = (x: number) => Math.round(x * 100) / 100;

/** `prefix` followed by `from`..`to`, each zero-padded to six digits with `prefix`. */
function codes(prefix: string, from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => prefix + String(from + i).padStart(6 - prefix.length, "0"));
}

const nameOf = (code: string) => (code === "600001" ? "上海九百" : `样本${code}`);
const INDUSTRIES = ["电力", "软件开发", "通信设备", "化学制品", "汽车零部件", "文化传媒", "通用设备"];
const n = (code: string) => Number(code);
const industryOf = (code: string) => INDUSTRIES[n(code) % INDUSTRIES.length];
const turnoverOf = (code: string) => round2(3 + (n(code) % 13) * 0.71);
const amountOf = (code: string) => 100_000_000 + (n(code) % 29) * 17_000_000;

/** Each code's previous close: `600001` 4.62, `000021` 43.19, the rest a made-up spread from 5 to 34. */
function precOf(code: string): number {
  if (code === "600001") return 4.62;
  if (code === "000021") return 43.19;
  return round2(5 + (n(code) % 37) * 0.79);
}

const up = (code: string) => limitPrices(precOf(code), 0.1).up;
const pctOf = (code: string, price: number) => round2((price / precOf(code) - 1) * 100);

/** One 涨停池 row sealed at `boards`. */
function zt(code: string, boards: number, firstSealAt: string, breakCount: number, sealFunds: number): Row {
  const price = up(code);
  return {
    pool: "zt", code, name: nameOf(code), pct: pctOf(code, price), price, boards, firstSealAt,
    lastSealAt: breakCount === 0 ? firstSealAt : "135507", breakCount, sealFunds,
    industry: industryOf(code), turnoverRate: turnoverOf(code), amount: amountOf(code),
  };
}

/** One 炸板池 row: it touched its limit-up at `firstSealAt` and closed `drop` yuan below it. */
function zb(code: string, firstSealAt: string, breakCount: number, drop: number): Row {
  const limitPrice = up(code);
  const price = round2(limitPrice - drop);
  return {
    pool: "zb", code, name: nameOf(code), pct: pctOf(code, price), price, limitPrice, firstSealAt, breakCount,
    industry: industryOf(code), turnoverRate: turnoverOf(code), amount: amountOf(code),
  };
}

/** One 昨日涨停 row: yesterday's limit-up after `yesterdayBoards` boards, today's `pct`. */
function yesterday(code: string, yesterdayBoards: number, pct: number): Row {
  const limitPrice = precOf(code);
  return {
    pool: "yesterday", code, name: nameOf(code), pct, price: round2(limitPrice * (1 + pct / 100)), limitPrice,
    yesterdayBoards, industry: industryOf(code), turnoverRate: turnoverOf(code), amount: amountOf(code),
  };
}

/** Minutes after midnight as an `HHMMSS` seal time. */
const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}${String(t % 60).padStart(2, "0")}00`;

const YESTERDAY_PCT: Record<string, number> = { "600014": -9.91, "600015": -10.02, "600016": -2.65, "000021": 2.78 };
const SEAL_4 = ["092501", "092502", "093409"];

/** The three pools of the synthetic 2026-10-27, parsed shape, each row with its `pool`. */
export function syntheticPools1027(): Pools {
  const y = (code: string, boards: number) => yesterday(code, boards, YESTERDAY_PCT[code] ?? 1.0);
  return {
    zt: [
      zt("600001", 5, "093026", 0, 150_000_000),
      ...codes("6000", 11, 13).map((code, i) => zt(code, 4, SEAL_4[i], 1, 80_000_000 - i * 5_000_000)),
      ...codes("000", 101, 108).map((code, i) => zt(code, 2, "092500", 0, 40_000_000 + i * 1_000_000)),
      ...codes("002", 1, 29).map((code, i) => zt(code, 1, clock(580 + i), 0, 10_000_000 + i * 500_000)),
    ],
    zb: [
      zb("000021", "093629", 2, 2.1),
      ...codes("000", 109, 111).map((code, i) => zb(code, "100512", 1 + i, 0.37)),
      ...codes("003", 1, 24).map((code, i) => zb(code, clock(630 + i), 1 + (i % 3), 0.21)),
      zb("002001", "094000", 1, 0.01),
    ],
    yesterday: [
      y("600001", 4),
      ...codes("6000", 11, 16).map((code) => y(code, 3)),
      ...codes("0000", 21, 28).map((code) => y(code, 2)),
      ...codes("000", 101, 140).map((code) => y(code, 1)),
    ],
  };
}

export type SealedRun = {
  strategy: string;
  run: string;
  manifest: Row & { evidence: Row[]; artifacts: string[] };
  metrics: Row;
  evidence: { source: string; session: string; items: Row[] }[];
  artifacts: Record<string, Row>;
};

const SESSION = "2026-10-27";
const RUN = "20261027T201627Z-6937d208";

/** The 23 buckets of the 10-27 counts, Eastmoney's keys −11…11. */
const BUCKETS: [number, number][] = [
  [-11, 22], [-10, 76], [-9, 53], [-8, 99], [-7, 224], [-6, 458], [-5, 755], [-4, 1023], [-3, 972], [-2, 734], [-1, 358],
  [0, 34], [1, 214], [2, 114], [3, 77], [4, 43], [5, 22], [6, 23], [7, 10], [8, 3], [9, 6], [10, 14], [11, 41],
];

/** The four index quotes of 10-27: name, last, prev, open, high, low, change, pct, amountCny. */
const QUOTES: [string, string, number, number, number, number, number, number, number, number][] = [
  ["sh000001", "上证指数", 3648.3, 3697.52, 3698.44, 3708.2, 3648.3, -49.22, -1.33, 672414400000],
  ["sz399001", "深证成指", 11245.73, 11534.38, 11591.36, 11633.3, 11245.72, -288.65, -2.5, 788543920000],
  ["sz399006", "创业板指", 2548.15, 2638.23, 2661.71, 2670.47, 2548.11, -90.08, -3.41, 381583040000],
  ["sh000300", "沪深300", 4049.55, 4103.54, 4105.48, 4110, 4049.54, -53.99, -1.32, 383125560000],
];

/** Each item with the id `addEvidence` would give it. */
const withIds = (items: Row[]) => items.map((item) => ({ ...item, id: evidenceId(item) }));

const derived = (source: string, measure: string, value: unknown, extra: Row = {}): Row => ({
  source, kind: "derived", measure, value, inputs: [], ...extra,
});

/** A minute line of `symbol` over `series` (the index curve off `prec` by default), as the freeze parses it. */
function minutes(symbol: string, prec: number, series?: number[]): Row {
  const reply = minutesReply(symbol, prec, [SESSION.replaceAll("-", "")], series);
  return { kind: "minutes", ...parseTencentMinutes(reply, symbol, SESSION) };
}

/** A stock line: from `prec * 1.03` at 09:30 up to the limit-up at grid index `seal`, held to the close. */
function sealedLine(prec: number, seal: number): number[] {
  const { up } = limitPrices(prec, 0.1);
  return Array.from({ length: 242 }, (_, i) => (i >= seal ? up : round2(prec * 1.03 + ((up - prec * 1.03) * i) / seal)));
}

const claims = (texts: string[]) => texts.map((text, i) => ({ id: `c${i + 1}`, basis: "CURRENT", evidence_ids: [], text }));
const against = (module: string, ids: string[], kind: string) =>
  ids.map((id) => ({ id, against: module, kind, text: `${id} 对 ${module} 的合成反证。`, evidence_ids: [] }));

/** The synthetic sealed 10-27 market run (see the file's head). */
export function syntheticSealedRun(): SealedRun {
  const pools = syntheticPools1027();
  const index = withIds([
    ...QUOTES.map(([symbol, name, last, previousClose, open, high, low, change, changePercent, amountCny]) => ({
      kind: "index", symbol, name, last, previousClose, open, high, low, change, changePercent,
      volumeShares: Math.round(amountCny / 16), amountCny, quotedAt: `${SESSION}T15:00:00+08:00`, provider: "tencent",
    })),
    {
      kind: "counts", qdate: 20261027, advancers: 567, decliners: 4774, unchanged: 34, limitUp: 41, limitDown: 22, total: 5375,
      buckets: BUCKETS.map(([bucket, count]) => ({ bucket, count })), hash: "0".repeat(64), host: "push2ex.eastmoney.com", delayed: false,
    },
    derived("index", "total_turnover", 1460958320000),
    derived("index", "advance_decline_ratio", 0.1187683284457478, { params: { endpoint: "getTopicZDFenBu" } }),
    derived("index", "limit_up_count", 41, { params: { endpoint: "getTopicZDFenBu", bucket: 11 } }),
    derived("index", "limit_down_count", 22, { params: { endpoint: "getTopicZDFenBu", bucket: -11 } }),
    ...INDEX_PRECS.map(([symbol, prec]) => minutes(symbol as string, prec as number)),
  ]);
  const limitUp = withIds([
    ...pools.zt, ...pools.zb, ...pools.yesterday,
    derived("limit-up", "streak_distribution", { 1: 29, 2: 8, 4: 3, 5: 1 }),
    derived("limit-up", "seal_ratio", 0.594),
    derived("limit-up", "break_ratio", 0.406),
    derived("limit-up", "yesterday_return_median", 0.816),
    derived("limit-up", "yesterday_negative_tail", 0.164, { params: { pct: -5 } }),
    { code: "600001", ...minutes("sh600001", 12.1, sealedLine(12.1, 0)) },
    { code: "600011", ...minutes("sh600011", precOf("600011"), sealedLine(precOf("600011"), 4)) },
    { kind: "minutes_missing", code: "600012", symbol: "sh600012", reason: "PROVIDER_HTTP_ERROR" },
  ]);
  const modules = ["environment", "sentiment", "theme", "counterevidence"];
  const entry = (source: string, file: string) => ({
    source, file, sha256: "0".repeat(64), bytes: 0, received_at: "2026-10-27T20:16:30.000Z", session: SESSION,
    host: source === "index" ? "qt.gtimg.cn,web.ifzq.gtimg.cn,push2ex.eastmoney.com" : "push2ex.eastmoney.com,web.ifzq.gtimg.cn",
    delayed: false,
  });
  return {
    strategy: "cn-market",
    run: RUN,
    manifest: {
      run: RUN, strategy: "cn-market", kind: "market", as_of: "2026-10-27T20:16:32.272Z", session: SESSION,
      opened_at: "2026-10-27T20:16:27.471Z", sealed_at: "2026-10-27T20:16:53.810Z", snapshot_id: `snap_${"0".repeat(64)}`,
      evidence: [entry("index", "evidence-index.json"), entry("limit-up", "evidence-limit-up.json")],
      artifacts: modules,
    },
    metrics: {
      freezes: 5, calls: {}, rejections: {}, submitted: modules,
      refusals: { boards: ["UPSTREAM_TIMEOUT", "UPSTREAM_INVALID", "UPSTREAM_INVALID"] },
    },
    evidence: [
      { source: "index", session: SESSION, items: index },
      { source: "limit-up", session: SESSION, items: limitUp },
    ],
    artifacts: {
      environment: {
        module: "environment", status: "OK", missing_sources: [], index_state: "WEAK", liquidity_state: "CONTRACTING",
        claims: claims([
          "四个指数同向收跌，收盘贴近全日最低。",
          "上证指数的日线仍在下行序列里。",
          "两市成交额合计约 1.46 万亿元，量能收缩。",
          "上涨与下跌家数之比为 0.119，参与面收缩。",
        ]),
      },
      sentiment: {
        module: "sentiment", status: "OK", missing_sources: [], state: "UNKNOWN", money_effect: "MIXED",
        conflict:
          "break_ratio 0.406 偏高、limit_down_count 22 指向收缩，而 yesterday_return_median +0.816 与 streak_distribution 最高 5 板指向接力仍在，四者方向不一致。",
        claims: claims([
          "昨日涨停今日收益中位数为 +0.82%，16.4% 跌幅超过 5%。",
          "封板率 0.594、炸板率 0.406，封板质量中等。",
          "涨停梯队为 29 家首板、8 家二板、3 家四板、1 家五板，三板断层，最高连板 5 板为上海九百。",
          "567 家上涨、4774 家下跌，41 家涨停对 22 家跌停。",
        ]),
      },
      theme: {
        module: "theme", status: "NOT_EVALUABLE", missing_sources: ["boards"], claims: [],
        limitations: ["缺少 boards 证据，无法评估。", "板块冻结三次失败，没有可引用的板块证据。"],
      },
      counterevidence: {
        module: "counterevidence", status: "OK", missing_sources: [],
        items: [...against("environment", ["x1", "x2"], "MISSING_EVIDENCE"), ...against("sentiment", ["x3", "x4", "x5"], "MISSING_EVIDENCE")],
        claims: [],
      },
    },
  };
}
