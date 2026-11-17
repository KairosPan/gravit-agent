// The Memory screen's pure views (memory screen plan Task 3, host/memory-page-view.js): the lines of a card's armed copy and its
// file now, each marked; one outcome side of a lesson's record by horizon, the median once there is one, else the cases; and a
// card as one line of its codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { textDiff, recordView, cardLine } from '../../client/js/host/memory-page-view.js';

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
