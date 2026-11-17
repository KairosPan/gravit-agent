// The Memory screen's pure views (memory screen plan Task 3, host/memory-page-view.js): the lines of a card's armed copy and its
// file now, each marked; one outcome side of a lesson's record by horizon, the median once there is one, else the cases; and a
// card as one line of its codes; what followed a decision at each measured horizon, and a decision's marks (Task 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { textDiff, recordView, cardLine, followedLine, decisionMarks } from '../../client/js/host/memory-page-view.js';

test('textDiff: a line in one copy alone is marked for that copy, the rest same, each text in its own order', () => {
  assert.deepEqual(textDiff('a\nb\nc', 'a\nx\nc'), {
    armed: [{ line: 'a', mark: 'same' }, { line: 'b', mark: 'armed' }, { line: 'c', mark: 'same' }],
    file: [{ line: 'a', mark: 'same' }, { line: 'x', mark: 'file' }, { line: 'c', mark: 'same' }],
  });
});

test('textDiff: equal texts are all same; a final line break adds no empty line', () => {
  const d = textDiff('a\nb\n', 'a\nb\n');
  assert.deepEqual(d.armed, [{ line: 'a', mark: 'same' }, { line: 'b', mark: 'same' }]);
  assert.deepEqual(d.file, d.armed);
});

test('textDiff: an empty file text marks every armed line and has no line of its own; a text not a string is empty', () => {
  assert.deepEqual(textDiff('a\nb', ''), { armed: [{ line: 'a', mark: 'armed' }, { line: 'b', mark: 'armed' }], file: [] });
  assert.deepEqual(textDiff(undefined, 'z'), { armed: [], file: [{ line: 'z', mark: 'file' }] });
});

const kase = (decision, date, symbol, action, figures) => ({ decision, date, symbol, action, figures });
const fig = (k, change) => ({ k, change_pct: change, vs_benchmark_pct: null });

test('recordView: a median at 5 is given as the median; at 20, under eight measured, the cases measured there', () => {
  const record = {
    followed: [
      kase('d-20261101-0a1b2c3d', '2026-11-01', 'NVDA', 'pass', [fig(5, 2.5), fig(20, -1.25)]),
      kase('d-20261102-1b2c3d4e', '2026-11-02', 'AMD', 'trim', [fig(5, 3.9), fig(20, null)]),
    ],
    overridden: [], backfilled: [],
    medians: { followed: { 5: 3.2 }, overridden: {} },
  };
  assert.deepEqual(recordView(record, 'followed'), [
    { k: 5, median: 3.2 },
    { k: 20, cases: [{ decision: 'd-20261101-0a1b2c3d', date: '2026-11-01', symbol: 'NVDA', action: 'pass', change: -1.25 }] },
  ]);
  assert.deepEqual(recordView(record, 'overridden'), []);
});

test('recordView: no figure at all gives an empty list; no record, or a side that is no side, too', () => {
  const record = { followed: [kase('d-20261101-0a1b2c3d', '2026-11-01', 'NVDA', 'pass', [])], overridden: [], medians: { followed: {}, overridden: {} } };
  assert.deepEqual(recordView(record, 'followed'), []);
  assert.deepEqual(recordView(null, 'followed'), []);
  assert.deepEqual(recordView(record, 'backfilled'), []);
});

test('cardLine: a red-line dont for buy and add scoped to US and NVDA', () => {
  const card = { id: 'no-chasing', says: 'dont', actions: ['buy', 'add'], strength: 'red-line', scope: { market: ['US'], symbols: ['NVDA'] }, words: 'w' };
  assert.deepEqual(cardLine(card), { strength: 'red-line', says: 'dont', actions: ['buy', 'add'], markets: ['US'], symbols: ['NVDA'] });
});

test('cardLine: no scope gives no markets and no symbols; a field not a string is left out', () => {
  assert.deepEqual(cardLine({ says: 'do', actions: ['hold', 3], strength: 'caveat' }), { strength: 'caveat', says: 'do', actions: ['hold'], markets: [], symbols: [] });
  assert.deepEqual(cardLine(undefined), { strength: '', says: '', actions: [], markets: [], symbols: [] });
});

test('followedLine: each measured horizon by k, its change signed to two places and against the benchmark when measured', () => {
  assert.deepEqual(followedLine([
    { k: 20, change_pct: -0.4, vs_benchmark_pct: null },
    { k: 5, change_pct: 3.2, vs_benchmark_pct: 1.1 },
    { k: 60, change_pct: null, vs_benchmark_pct: 2 },
  ]), [{ k: 5, change: '+3.20%', against: '+1.10%' }, { k: 20, change: '-0.40%', against: null }]);
  assert.deepEqual(followedLine([{ k: 1, change_pct: 0, vs_benchmark_pct: -2.5 }]), [{ k: 1, change: '0.00%', against: '-2.50%' }]);
});

test('followedLine: none measured, no figures, or a figure off its shape gives none', () => {
  assert.deepEqual(followedLine([{ k: 5, change_pct: null, vs_benchmark_pct: null }]), []);
  assert.deepEqual(followedLine([]), []);
  assert.deepEqual(followedLine(undefined), []);
  assert.deepEqual(followedLine([null, { k: '5', change_pct: 1, vs_benchmark_pct: null }, { k: 5, change_pct: Infinity }]), []);
});

test('decisionMarks: void, open, reviewed and backfilled, each that holds, in that order', () => {
  assert.deepEqual(decisionMarks({ void: true, open: false, reviewed: false, line: {} }), ['void']);
  assert.deepEqual(decisionMarks({ void: false, open: true, reviewed: false, line: {} }), ['open']);
  assert.deepEqual(decisionMarks({ void: false, open: false, reviewed: true, line: {} }), ['reviewed']);
  assert.deepEqual(decisionMarks({ void: false, open: false, reviewed: false, line: { backfilled: true } }), ['backfilled']);
  assert.deepEqual(decisionMarks({ void: false, open: true, reviewed: true, line: { backfilled: true } }), ['open', 'reviewed', 'backfilled']);
  assert.deepEqual(decisionMarks({ void: 'yes', open: 1, line: { backfilled: 'true' } }), []);
  assert.deepEqual(decisionMarks(undefined), []);
});
