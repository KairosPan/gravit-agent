/**
 * The Lunhui derived measures, `plugins/lunhui/lib/derive.mjs` (modules spec A20): host code
 * computes the market-wide measures at freeze time, each item citing the evidence ids of the rows
 * it read. The expectations are hand-computed from small synthetic rows shaped as `eastmoney.mjs`
 * and `market.mjs` return them; the ids map is built the way the freeze builds it, `evidenceId`
 * over each row object as it will be written.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  NEGATIVE_TAIL_PCT, deriveBoards, deriveCounts, deriveIndex, deriveLimitUp, ladderCodes, rowKey,
} from "../plugins/lunhui/lib/derive.mjs";
import { syntheticPools1027 } from "./lunhui-view-fixtures.ts";
import { evidenceId } from "../plugins/lunhui/lib/runs.mjs";

type Row = Record<string, unknown>;

/** The ids map of `rows` under `kind`, keyed by `rowKey(kind, row[field])`. */
function idsOf(kind: string, rows: Row[], field = "code"): Map<string, string> {
  return new Map(rows.map((row) => [rowKey(kind, row[field] as string), evidenceId(row)]));
}

function merge(...maps: Map<string, string>[]): Map<string, string> {
  return new Map(maps.flatMap((map) => [...map]));
}

/** The one item measuring `measure` (and, when given, the board `board`). */
function find(items: Row[], measure: string, board?: string): Row {
  const hits = items.filter((item) => item.measure === measure && (board === undefined || (item.params as Row)?.board === board));
  assert.equal(hits.length, 1, `one ${measure}${board ? ` for ${board}` : ""}`);
  return hits[0];
}

const zt: Row[] = [
  { pool: "zt", code: "000001", pct: 10.01, boards: 1 },
  { pool: "zt", code: "000002", pct: 10.0, boards: 1 },
  { pool: "zt", code: "000003", pct: 9.98, boards: 3 },
];
const zb: Row[] = [
  { pool: "zb", code: "000002", pct: 6.1 },
  { pool: "zb", code: "000004", pct: 2.3 },
];
const yesterday: Row[] = [
  { pool: "yesterday", code: "600001", pct: -6 },
  { pool: "yesterday", code: "600002", pct: -2 },
  { pool: "yesterday", code: "600003", pct: 1 },
  { pool: "yesterday", code: "600004", pct: 4 },
];
const poolIds = merge(idsOf("zt", zt), idsOf("zb", zb), idsOf("yesterday", yesterday));

test("derive: rowKey keys a pool row by pool and code, so one code in zt and zb keeps two ids", () => {
  assert.equal(rowKey("zt", "000002"), "zt:000002");
  assert.notEqual(rowKey("zt", "000002"), rowKey("zb", "000002"));
  assert.notEqual(poolIds.get(rowKey("zt", "000002")), poolIds.get(rowKey("zb", "000002")));
});

test("derive: deriveLimitUp computes the streak distribution, the ratios by unique code and yesterday's median and tail, citing the rows", () => {
  const items = deriveLimitUp({ zt, zb, yesterday }, poolIds);
  for (const item of items) {
    assert.equal(item.kind, "derived");
    assert.equal(item.source, "limit-up");
    assert.equal(Object.hasOwn(item, "id"), false, "addEvidence gives the id");
  }
  const ztIds = zt.map(evidenceId);
  const zbIds = zb.map(evidenceId);
  const yIds = yesterday.map(evidenceId);

  const streak = find(items, "streak_distribution");
  assert.deepEqual(streak.value, { "1": 2, "3": 1 });
  assert.deepEqual(streak.inputs, ztIds);

  // zt {1, 2, 3}, zb {2, 4}: the union is four codes.
  const seal = find(items, "seal_ratio");
  assert.equal(seal.value, 3 / 4);
  assert.deepEqual(seal.inputs, [...ztIds, ...zbIds]);
  assert.equal(find(items, "break_ratio").value, 2 / 4);

  const median = find(items, "yesterday_return_median");
  assert.equal(median.value, -0.5);
  assert.deepEqual(median.inputs, yIds);
  const tail = find(items, "yesterday_negative_tail");
  assert.equal(tail.value, 0.25);
  assert.deepEqual(tail.params, { pct: NEGATIVE_TAIL_PCT });
  assert.equal(NEGATIVE_TAIL_PCT, -5);
  assert.deepEqual(tail.inputs, yIds);
});

test("derive: a code twice in one pool counts once in the ratios", () => {
  const twice = [...zt, { pool: "zt", code: "000001", pct: 10.01, boards: 1, name: "again" }];
  const ids = merge(poolIds, new Map([[rowKey("zt", "000001"), evidenceId(twice[3])]]));
  const items = deriveLimitUp({ zt: twice, zb, yesterday }, ids);
  assert.equal(find(items, "seal_ratio").value, 3 / 4);
});

test("derive: an odd yesterday pool has its middle pct as the median; a null pct is left out", () => {
  const rows: Row[] = [{ code: "600001", pct: 3 }, { code: "600002", pct: null }, { code: "600003", pct: -7 }, { code: "600004", pct: 1 }];
  const items = deriveLimitUp({ zt: [], zb: [], yesterday: rows }, idsOf("yesterday", rows));
  assert.equal(find(items, "yesterday_return_median").value, 1);
  assert.equal(find(items, "yesterday_negative_tail").value, 1 / 3);
});

test("derive: empty pools give an empty distribution and null ratios, never NaN", () => {
  const items = deriveLimitUp({ zt: [], zb: [], yesterday: [] }, new Map());
  assert.deepEqual(find(items, "streak_distribution").value, {});
  for (const measure of ["seal_ratio", "break_ratio", "yesterday_return_median", "yesterday_negative_tail"]) {
    assert.equal(find(items, measure).value, null, measure);
    assert.deepEqual(find(items, measure).inputs, []);
  }
});

test("derive: a row with no id in the map is host code's bug, a TypeError", () => {
  assert.throws(() => deriveLimitUp({ zt, zb, yesterday }, new Map()), TypeError);
});

const boards: Row[] = [
  { code: "BK0001", name: "甲", pct: 4.2, amount: 600, advancers: 7, decliners: 3, leader: "x" },
  { code: "BK0002", name: "乙", pct: 3.1, amount: 400, advancers: 0, decliners: 0, leader: null },
  { code: "BK0003", name: "丙", pct: 2.0, amount: null, advancers: null, decliners: 5, leader: null },
];
const boardIds = idsOf("board", boards);

test("derive: deriveBoards gives each board its breadth from its own counts and its turnover share of the fetched boards", () => {
  const items = deriveBoards(boards, [], boardIds);
  assert.equal(items.length, 6);
  const all = boards.map(evidenceId);
  for (const item of items) {
    assert.equal(item.kind, "derived");
    assert.equal(item.source, "boards");
  }
  const breadth = find(items, "breadth", "BK0001");
  assert.equal(breadth.value, 0.7);
  assert.deepEqual(breadth.inputs, [evidenceId(boards[0])]);
  assert.equal(find(items, "breadth", "BK0002").value, null, "both counts zero");
  assert.equal(find(items, "breadth", "BK0003").value, null, "a count absent");

  const share = find(items, "turnover_share", "BK0001");
  assert.equal(share.value, 600 / 1000);
  assert.deepEqual(share.inputs, all);
  assert.equal(find(items, "turnover_share", "BK0002").value, 400 / 1000);
  assert.equal(find(items, "turnover_share", "BK0003").value, null, "its amount absent");
});

test("derive: breadth never reads a member list, cut or whole", () => {
  const members = [{ board: "BK0001", truncated: true, members: Array.from({ length: 100 }, (_, i) => ({ code: String(i).padStart(6, "0"), pct: -1 })) }];
  const items = deriveBoards(boards, members, boardIds);
  assert.equal(find(items, "breadth", "BK0001").value, 0.7);
  assert.deepEqual(items, deriveBoards(boards, [], boardIds));
});

test("derive: turnover shares are null when the fetched boards' turnover sums to 0", () => {
  const flat: Row[] = [{ code: "BK0009", amount: 0, advancers: 1, decliners: 1 }];
  assert.equal(find(deriveBoards(flat, [], idsOf("board", flat)), "turnover_share", "BK0009").value, null);
});

const counts = {
  qdate: 20261023, advancers: 3000, decliners: 1500, unchanged: 200, limitUp: 80, limitDown: 12, total: 4700,
  buckets: [{ bucket: -11, count: 12 }, { bucket: 11, count: 80 }], hash: "h", host: "push2ex.eastmoney.com", delayed: false,
};

test("derive: deriveCounts gives the advance/decline ratio and the limit counts, citing the one counts item and naming their definition", () => {
  const ids = new Map([[rowKey("counts"), evidenceId(counts)]]);
  const items = deriveCounts(counts, ids);
  assert.equal(items.length, 3);
  assert.equal(find(items, "advance_decline_ratio").value, 2);
  assert.equal(find(items, "limit_up_count").value, 80);
  assert.equal(find(items, "limit_down_count").value, 12);
  for (const item of items) {
    assert.equal(item.source, "index");
    assert.ok(!("partial" in item), item.measure);
    assert.deepEqual(item.inputs, [evidenceId(counts)]);
  }
  // The definition rides on each item: the endpoint, and the bucket a limit count reads (spec §17).
  assert.deepEqual(find(items, "advance_decline_ratio").params, { endpoint: "getTopicZDFenBu" });
  assert.deepEqual(find(items, "limit_up_count").params, { endpoint: "getTopicZDFenBu", bucket: 11 });
  assert.deepEqual(find(items, "limit_down_count").params, { endpoint: "getTopicZDFenBu", bucket: -11 });
  const none = deriveCounts({ ...counts, decliners: 0 }, new Map([[rowKey("counts"), "ev_x"]]));
  assert.equal(find(none, "advance_decline_ratio").value, null, "no decliners");
  // A limit bucket the reply lacked is null in the counts, and null in its measure.
  const lacking = deriveCounts({ ...counts, limitDown: null }, new Map([[rowKey("counts"), "ev_x"]]));
  assert.equal(find(lacking, "limit_down_count").value, null, "no -11 bucket");
});

test("derive: deriveCounts over no counts item gives the three measures null with no inputs, their definition still named", () => {
  const items = deriveCounts(null, new Map());
  assert.deepEqual(items.map((item) => [item.measure, item.value, item.inputs]), [
    ["advance_decline_ratio", null, []], ["limit_up_count", null, []], ["limit_down_count", null, []],
  ]);
  for (const item of items) assert.equal(item.source, "index");
  assert.deepEqual(find(items, "limit_up_count").params, { endpoint: "getTopicZDFenBu", bucket: 11 });
});

const quotes: Row[] = [
  { symbol: "sh000001", kind: "index", amountCny: 5.2e11 },
  { symbol: "sz399001", kind: "index", amountCny: 6.8e11 },
  { symbol: "sz399006", kind: "index", amountCny: 3.1e11 },
];

test("derive: deriveIndex sums the Shanghai and Shenzhen composites' amountCny, citing the two quotes", () => {
  const items = deriveIndex(quotes, idsOf("quote", quotes, "symbol"));
  assert.equal(items.length, 1);
  const [turnover] = items;
  assert.equal(turnover.measure, "total_turnover");
  assert.equal(turnover.source, "index");
  assert.equal(turnover.value, 5.2e11 + 6.8e11);
  assert.deepEqual(turnover.inputs, [evidenceId(quotes[0]), evidenceId(quotes[1])]);
});

test("derive: total_turnover is null when either composite or its amountCny is absent", () => {
  const one = [quotes[0]];
  const [missing] = deriveIndex(one, idsOf("quote", one, "symbol"));
  assert.equal(missing.value, null);
  assert.deepEqual(missing.inputs, [evidenceId(quotes[0])]);
  const blank = [quotes[0], { symbol: "sz399001", amountCny: null }];
  assert.equal(deriveIndex(blank, idsOf("quote", blank, "symbol"))[0].value, null);
});

test("ladderCodes: zt at 2+ boards, then zb tried at 2+, then yesterday at 2+ that did not seal again, unique, cut at the cap", () => {
  const pools = syntheticPools1027();
  const range = (prefix: string, from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => prefix + String(from + i).padStart(6 - prefix.length, "0"));
  assert.deepEqual(ladderCodes(pools), [
    "600001", "600011", "600012", "600013",
    ...range("000", 101, 108),
    "000021", "000109", "000110", "000111",
    "600014", "600015", "600016",
    ...range("0000", 22, 28),
  ]);
  assert.equal(ladderCodes(pools).length, 26);
  assert.deepEqual(ladderCodes(pools, 3), ["600001", "600011", "600012"]);
  assert.deepEqual(ladderCodes({ zt: [], zb: [], yesterday: [] }), []);
  // A first board, sealed or broken with no yesterday, is no ladder name; 002001 sits in zt and zb.
  assert.ok(!ladderCodes(pools).some((code) => code.startsWith("002") || code.startsWith("003")));
});

test("ladderCodes: ties fall to firstSealAt then code; a null firstSealAt sorts last among its height", () => {
  const zt = [
    { pool: "zt", code: "000003", boards: 3, firstSealAt: null },
    { pool: "zt", code: "000002", boards: 3, firstSealAt: "100000" },
    { pool: "zt", code: "000001", boards: 3, firstSealAt: "100000" },
    { pool: "zt", code: "000009", boards: 1, firstSealAt: "092500" },
  ];
  const zb = [{ pool: "zb", code: "000005" }, { pool: "zb", code: "000004" }];
  const yesterday = [
    { pool: "yesterday", code: "000005", yesterdayBoards: 1 },
    { pool: "yesterday", code: "000004", yesterdayBoards: 1 },
    { pool: "yesterday", code: "000006", yesterdayBoards: null },
  ];
  assert.deepEqual(ladderCodes({ zt, zb, yesterday }), ["000001", "000002", "000003", "000004", "000005"]);
});
