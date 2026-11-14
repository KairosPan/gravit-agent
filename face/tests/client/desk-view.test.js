// host/desk-view.js: the desk status' poll, its New York times and its words, and a level's mark on its market row and page
// (plan 2026-11-01-desk-p3-watch Task 11). The Desk tab it once drew left Markets for the Desk screen (desk-page plan 1 Task 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DESK_POLL_MS, markOf, firingWord, deskTime, etWhen } from '../../client/js/host/desk-view.js';
import { deskStatus, DESK_NOW } from './helpers/desk-status.js';
import { withTable } from '../../client/js/i18n/words.js';
import { EN } from '../../client/js/i18n/en.js';

const STATUS = deskStatus();

test('the poll', () => {
  assert.equal(DESK_POLL_MS, 10_000);
});

test('markOf matches stock:NVDA and cn:600519 to their marks and nothing else', () => {
  assert.deepEqual(markOf(STATUS, 'stock:NVDA'), { label: 'stop 170 · -1.30%', plan: 'sell half on a close below 170', file: 'desk/levels.yml' });
  assert.deepEqual(markOf(STATUS, 'cn:600519'), { label: 'buy_zone 1600-1650', plan: 'add 100 shares in the zone', file: 'desk/levels.yml' });
  assert.equal(markOf(STATUS, 'coin:BTC'), null);
  assert.equal(markOf(STATUS, 'rwa:NVDA'), null, 'a tokenized NVDA is not the share');
  assert.equal(markOf(STATUS, 'stock:600519'), null);
  assert.equal(markOf({ ok: true }, 'stock:NVDA'), null);
  assert.equal(markOf(null, 'stock:NVDA'), null);
  // a level above the last print reads +; the nearest mark of a symbol is its first
  const s = deskStatus();
  s.watch.marks.unshift({ market: 'us', symbol: 'NVDA', kind: 'target', level: '180', when: 'cross_up', plan: 'trim', file: 'desk/levels.yml', distancePct: 0.85 });
  assert.equal(markOf(s, 'stock:NVDA').label, 'target 180 · +0.85%');
});

test("a time is New York's, dated only on another New York date", () => {
  assert.equal(etWhen('2026-11-02T14:59:00.000Z', DESK_NOW), '09:59');
  assert.equal(deskTime('2026-11-02T14:59:00.000Z', DESK_NOW), '09:59 ET');
  assert.equal(deskTime('2026-11-03T14:20:00.000Z', DESK_NOW), '2026-11-03 09:20 ET');
  assert.equal(deskTime('soon', DESK_NOW), 'soon', 'a time that is no time as written');
});

test("a firing's codes are the table's words, an unknown one as it came", () => {
  withTable({ ...EN, 'desk.firing.finished': 'F-finished' }, () => assert.equal(firingWord('finished'), 'F-finished'));
  assert.equal(firingWord('timed-out'), 'timed-out');
  assert.equal(firingWord('bounced'), 'bounced');
});
