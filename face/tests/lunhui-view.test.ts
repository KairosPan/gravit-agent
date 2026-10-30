/**
 * The Lunhui run view's evidence half, `plugins/lunhui/lib/view.mjs`: `evidenceView(sealed)` over
 * the synthetic sealed 10-27 run (`syntheticSealedRun()`), and `mostMoved` over its index minute
 * lines. Each block of the view carries `unavailable`; the variants below strip what an older or
 * partial run lacks - minute lines (before the run view), a mid-session line, the index source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { evidenceView, mostMoved } from "../plugins/lunhui/lib/view.mjs";
import { minuteLabel } from "../plugins/lunhui/lib/market.mjs";
import { syntheticSealedRun, type SealedRun } from "./lunhui-view-fixtures.ts";

type Row = Record<string, any>;

const BUCKETS = [
  [-11, 22], [-10, 76], [-9, 53], [-8, 99], [-7, 224], [-6, 458], [-5, 755], [-4, 1023], [-3, 972], [-2, 734], [-1, 358],
  [0, 34], [1, 214], [2, 114], [3, 77], [4, 43], [5, 22], [6, 23], [7, 10], [8, 3], [9, 6], [10, 14], [11, 41],
].map(([bucket, count]) => ({ bucket, count }));

/** The run with each evidence source's items passed through `edit`. */
function editItems(sealed: SealedRun, edit: (items: Row[], source: string) => Row[]): SealedRun {
  return { ...sealed, evidence: sealed.evidence.map((e) => ({ ...e, items: edit(e.items, e.source) })) };
}

test("breadth: the counts, the turnover and the ratio, with the 23 buckets", () => {
  const view = evidenceView(syntheticSealedRun());
  assert.deepEqual(view.breadth, {
    advancers: 567, unchanged: 34, decliners: 4774, limitUp: 41, limitDown: 22, total: 5375,
    turnover: 1460958320000, ratio: 0.1187683284457478, buckets: BUCKETS, unavailable: null,
  });
  assert.equal(view.breadth.buckets.length, 23);
  assert.equal(view.session, "2026-10-27");
});

test("indices: four rows in index order, each with its 242-point minute line", () => {
  const view = evidenceView(syntheticSealedRun());
  assert.equal(view.indices.unavailable, null);
  assert.deepEqual(view.indices.rows.map((row: Row) => row.symbol), ["sh000001", "sz399001", "sz399006", "sh000300"]);
  for (const row of view.indices.rows) {
    assert.equal(row.minutes!.price.length, 242);
    assert.equal(row.minutesMissing, null);
  }
  const sse = view.indices.rows[0];
  assert.deepEqual(
    { name: sse.name, prec: sse.prec, last: sse.last, pct: sse.pct, change: sse.change, amount: sse.amount },
    { name: "上证指数", prec: 3697.52, last: 3648.3, pct: -1.33, change: -49.22, amount: 672414400000 },
  );
  assert.equal(view.through, "15:00");
});

test("mostMoved: the SSE's largest hour is its last, 14:00 to 15:00", () => {
  const sse = evidenceView(syntheticSealedRun()).indices.rows[0];
  const moved = mostMoved(sse.minutes!);
  assert.ok(moved);
  assert.equal(moved.from, "14:00");
  assert.equal(moved.to, "15:00");
  assert.ok(moved.change < -1, `change ${moved.change}`);
  assert.equal(mostMoved(null), null);
  assert.equal(mostMoved({ ...sse.minutes!, price: [sse.minutes!.price[0]] }), null);
});

test("mostMoved: a line shorter than the span is read whole", () => {
  const prec = 10;
  const moved = mostMoved({ prec, through: "09:32", price: [10, 10.5, 10.2], volume: [0, 0, 0], amount: [0, 0, 0] }, 60);
  assert.deepEqual(moved, { from: "09:30", to: "09:32", change: (10.2 - 10) / prec * 100 });
});

test("ladder: rungs from the height down, misses and gaps as Stocks", () => {
  const { ladder } = evidenceView(syntheticSealedRun());
  assert.equal(ladder.unavailable, null);
  assert.equal(ladder.height, 5);
  assert.deepEqual(ladder.rungs.map((rung: Row) => rung.n), [5, 4, 3, 2, 1]);
  const four = ladder.rungs[1];
  assert.equal(four.n, 4);
  assert.deepEqual(four.missed[0], { code: "600014", name: "样本600014", pct: -9.91, firstSeal: null, breaks: null, sealFunds: null });
  assert.deepEqual(four.sealed.map((s: Row) => s.code), ["600011", "600012", "600013"]);
  assert.equal(four.sealed[0].firstSeal, "09:25");
  assert.equal(four.sealed[0].breaks, 1);
  assert.equal(four.sealed[0].sealFunds, 80_000_000);
  assert.equal(ladder.rungs[2].gap, true);
  assert.deepEqual(ladder.rungs[2].broke.map((s: Row) => s.code), ["000021"]);
  assert.deepEqual(ladder.firstTries, { sealed: 29, tries: 53 });
});

test("yesterday: the count, the median, the tail share and the names at two boards or more", () => {
  const { yesterday } = evidenceView(syntheticSealedRun());
  assert.equal(yesterday.unavailable, null);
  assert.equal(yesterday.count, 55);
  assert.equal(yesterday.median, 0.816);
  assert.equal(yesterday.belowMinus5Share, 0.164);
  assert.equal(yesterday.rows.length, 15);
  assert.equal(yesterday.rows[0].code, "600001");
  // Three boards: by pct ascending, the limit-down first.
  assert.deepEqual(yesterday.rows.slice(1, 4).map((r: Row) => r.code), ["600015", "600014", "600016"]);
  for (let i = 1; i < yesterday.rows.length; i++)
    assert.ok(yesterday.rows[i - 1].yesterdayBoards >= yesterday.rows[i].yesterdayBoards);
});

test("stocks: each pool row's facts, the limits from the minute line's prec", () => {
  const { stocks } = evidenceView(syntheticSealedRun());
  const top = stocks["600001"];
  assert.equal(top.pool, "zt");
  assert.equal(top.symbol, "sh600001");
  assert.equal(top.name, "上海九百");
  assert.equal(top.boards, 5);
  assert.equal(top.yesterdayBoards, 4);
  assert.equal(top.firstSeal, "09:30");
  assert.ok(top.minutes);
  assert.equal(top.minutes.prec, 12.1);
  assert.equal(top.limitUp, 13.31);
  assert.equal(top.limitDown, 10.89);
  assert.equal(top.minutesMissing, null);
  assert.equal(stocks["600012"].minutesMissing, "PROVIDER_HTTP_ERROR");
  assert.equal(stocks["600012"].minutes, null);
  assert.equal(stocks["600012"].limitUp, null);
  assert.equal(stocks["002005"].minutesMissing, "NOT_FROZEN");
  // The overlap sits in zt first; its try is recorded.
  assert.equal(stocks["002001"].pool, "zt");
  assert.equal(stocks["002001"].tried, 1);
  assert.equal(stocks["000021"].pool, "zb");
  assert.equal(stocks["000021"].tried, 3);
  assert.equal(stocks["600014"].pool, "yesterday");
  assert.equal(Object.keys(stocks).length, new Set(syntheticSealedRun().evidence[1].items.filter((i: Row) => i.pool).map((i: Row) => i.code)).size);
});

test("an old run: no minute lines, every index NOT_FROZEN, the ladder unchanged", () => {
  const full = evidenceView(syntheticSealedRun());
  const old = evidenceView(editItems(syntheticSealedRun(), (items) => items.filter((i) => i.kind !== "minutes" && i.kind !== "minutes_missing")));
  for (const row of old.indices.rows) {
    assert.equal(row.minutes, null);
    assert.equal(row.minutesMissing, "NOT_FROZEN");
  }
  assert.equal(old.through, null);
  assert.deepEqual(old.ladder, full.ladder);
  assert.equal(old.stocks["600001"].minutesMissing, "NOT_FROZEN");
  assert.equal(old.stocks["600001"].limitUp, null);
});

test("mid-session: lines cut to 40 points run through 10:09", () => {
  const cut = editItems(syntheticSealedRun(), (items, source) =>
    source !== "index" ? items : items.map((i) => i.kind !== "minutes" ? i : {
      ...i, through: minuteLabel(39), price: i.price.slice(0, 40), volume: i.volume.slice(0, 40), amount: i.amount.slice(0, 40),
    }));
  const view = evidenceView(cut);
  assert.equal(view.through, "10:09");
  assert.equal(view.indices.rows[0].minutes!.price.length, 40);
});

test("index not frozen: breadth and indices unavailable, the ladder still drawn", () => {
  const sealed = syntheticSealedRun();
  const view = evidenceView({
    ...sealed,
    manifest: { ...sealed.manifest, evidence: sealed.manifest.evidence.filter((e) => e.source !== "index") },
    evidence: sealed.evidence.filter((e) => e.source !== "index"),
  });
  assert.equal(view.breadth.unavailable, "index not frozen");
  assert.equal(view.indices.unavailable, "index not frozen");
  assert.deepEqual(view.indices.rows, []);
  assert.equal(view.through, null);
  assert.equal(view.ladder.unavailable, null);
  assert.equal(view.yesterday.unavailable, null);
});

test("limit-up not frozen: the ladder, yesterday and stocks are empty", () => {
  const sealed = syntheticSealedRun();
  const view = evidenceView({
    ...sealed,
    manifest: { ...sealed.manifest, evidence: sealed.manifest.evidence.filter((e) => e.source !== "limit-up") },
    evidence: sealed.evidence.filter((e) => e.source !== "limit-up"),
  });
  assert.equal(view.ladder.unavailable, "limit-up not frozen");
  assert.equal(view.yesterday.unavailable, "limit-up not frozen");
  assert.deepEqual(view.stocks, {});
  assert.equal(view.breadth.unavailable, null);
});
