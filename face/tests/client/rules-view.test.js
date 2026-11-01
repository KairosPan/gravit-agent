// The Rules tab's view (plan 4a Task 5): the Account's mode and its door-by-door rules, whether it takes writes, the cap on each
// move, the agents' session and their leverage — read off the stand-in's page, a read-only page and one the face does not know.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rulesOf } from '../../client/js/host/rules-view.js';

const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-01T12:00:00.000Z');

test('rulesOf reads the mode, the writes, the cap, the session and leverage', () => {
  const page = fx('account');
  const r = rulesOf(page, NOW);
  assert.equal(r.mode, 'guard');
  assert.equal(r.modeRows.length, page.modeRules.rows.length);
  assert.deepEqual(r.modeRows[0], { door: 'Place or enlarge an order', guard: 'Waits on a card', beast: 'At once' });
  assert.equal(r.cardMinutes, 30);
  assert.equal(r.writes, true);
  assert.deepEqual(r.cap, { usd: 250 });
  assert.deepEqual(r.session, { until: '2026-11-21T07:35:46.773Z', ended: false });
  assert.deepEqual(r.leverage, { max: 5 });
  assert.equal(r.leverageOffered, true);
  assert.equal(rulesOf({ ...page, mode: 'open' }, NOW).mode, 'open');
  assert.equal(rulesOf({ ...page, mode: 'other' }, NOW).mode, '');
  // a session the Account says ended, or one whose day has passed by the caller's clock
  assert.equal(rulesOf({ ...page, dial: { ...page.dial, sessionEnded: true } }, NOW).session.ended, true);
  assert.equal(rulesOf(page, Date.parse('2026-11-22T00:00:00.000Z')).session.ended, true);
  // no leverage figure from the Account: 1x, as its page says
  const { maxLeverage, ...dial } = page.dial;
  assert.deepEqual(rulesOf({ ...page, dial }, NOW).leverage, { max: 1 });
  // rows that are not the Account's shape are left out
  const odd = rulesOf({ ...page, modeRules: { rows: [null, { door: 'X', guard: 'a', beast: 'b' }, { door: 3 }], cardMinutes: 'soon' } }, NOW);
  assert.deepEqual(odd.modeRows, [{ door: 'X', guard: 'a', beast: 'b' }]);
  assert.equal(odd.cardMinutes, null);
});

test('a read-only page has no cap, session or leverage', () => {
  const page = fx('account');
  const r = rulesOf({ ...page, connectLive: { ...page.connectLive, writes: { on: false, capUsd: 250 } } }, NOW);
  assert.equal(r.writes, false);
  assert.equal(r.cap, null);
  assert.equal(r.session, null);
  assert.equal(r.leverage, null);
  assert.equal(r.mode, 'guard', 'the mode is still read');
  // an unrecognised page is all empty
  for (const p of [null, { ok: true }, { ...page, venues: 'x' }]) {
    assert.deepEqual(rulesOf(p, NOW), { mode: '', modeRows: [], cardMinutes: null, writes: false, cap: null, session: null, leverage: null, leverageOffered: false });
  }
});

test('leverage is offered only where a venue sets it', () => {
  const page = fx('account');
  const none = page.venues.map(v => (v.trade ? { ...v, trade: { ...v.trade, leverage: false } } : v));
  assert.equal(rulesOf({ ...page, venues: none }, NOW).leverageOffered, false);
  const one = none.map(v => (v.id === 'predict' ? { ...v, trade: { ...v.trade, leverage: true } } : v));
  assert.equal(rulesOf({ ...page, venues: one }, NOW).leverageOffered, true);
  // a truthy word is not true
  const word = none.map(v => (v.id === 'ex' ? { ...v, trade: { ...v.trade, leverage: 'yes' } } : v));
  assert.equal(rulesOf({ ...page, venues: word }, NOW).leverageOffered, false);
});
