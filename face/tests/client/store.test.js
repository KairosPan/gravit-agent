// gravit-ui/tests/store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { levelOf, needsAnswer, LEVELS } from '../../client/js/messages.js';

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

const reducers = {
  inc: (s, n = 1) => ({ ...s, n: s.n + n }),
  same: s => s,
};

test('dispatch runs the reducer, notifies subscribers, persists', () => {
  const storage = fakeStorage();
  const store = createStore({ initial: { n: 0 }, reducers, storage, key: 'k' });
  const seen = [];
  const off = store.subscribe((s, type) => seen.push([s.n, type]));
  store.dispatch('inc', 2);
  assert.equal(store.get().n, 2);
  assert.deepEqual(seen, [[2, 'inc']]);
  assert.equal(storage.getItem('k'), '{"n":2}');
  store.dispatch('same');
  assert.equal(seen.length, 1, 'an unchanged state does not notify');
  off();
  store.dispatch('inc');
  assert.equal(seen.length, 1);
  assert.throws(() => store.dispatch('nope'), /unknown action nope/);
});

test('a saved state is loaded; a corrupt one falls back to the initial', () => {
  const good = createStore({ initial: { n: 0 }, reducers, storage: fakeStorage({ k: '{"n":7}' }), key: 'k' });
  assert.equal(good.get().n, 7);
  const bad = createStore({ initial: { n: 0 }, reducers, storage: fakeStorage({ k: '{not json' }), key: 'k' });
  assert.equal(bad.get().n, 0);
  const none = createStore({ initial: { n: 5 }, reducers });
  assert.equal(none.get().n, 5);
});

test('a saved state the accept predicate refuses falls back to the initial', () => {
  const stale = createStore({ initial: { v: 1, n: 0 }, reducers, storage: fakeStorage({ k: '{"v":2,"n":7}' }), key: 'k', accept: s => s.v === 1 });
  assert.equal(stale.get().n, 0);
  const same = createStore({ initial: { v: 1, n: 0 }, reducers, storage: fakeStorage({ k: '{"v":1,"n":7}' }), key: 'k', accept: s => s.v === 1 });
  assert.equal(same.get().n, 7);
});

test('reset replaces the state and notifies with type reset', () => {
  const store = createStore({ initial: { n: 1 }, reducers });
  let last;
  store.subscribe((s, type) => (last = [s.n, type]));
  store.reset({ n: 9 });
  assert.deepEqual(last, [9, 'reset']);
});

test("the message model: levels by the host's kinds, what needs an answer", () => {
  const m = kind => ({ from: 'gravit', kind, text: 'x', data: {} });
  assert.equal(levelOf(m('text')), 'grey'); assert.equal(levelOf(m('tool')), 'grey');
  for (const k of ['card', 'approval', 'question']) { assert.equal(levelOf(m(k)), 'orange', k); assert.equal(needsAnswer(m(k)), true, k); }
  assert.equal(levelOf(m('refusal')), 'red'); assert.equal(levelOf(m('receipt')), 'green');
  assert.equal(levelOf(m('brief')), 'grey', 'a demo kind has no level of its own');
  assert.deepEqual(Object.keys(LEVELS).sort(), ['approval', 'card', 'question', 'receipt', 'refusal', 'text', 'tool']);
  assert.equal(needsAnswer({ ...m('card'), answer: 'approved' }), false);
  assert.equal(needsAnswer(m('text')), false);
});

test('save writes only when what it persists changed: a quote tick rewrites no prefs', () => {
  const writes = [];
  const storage = { getItem: () => null, setItem: (k, v) => writes.push(v) };
  const store = createStore({ initial: { n: 0, m: 0 }, reducers: { ...reducers, bump: s => ({ ...s, m: s.m + 1 }) }, storage, key: 'k', persist: s => ({ n: s.n }) });
  store.dispatch('bump');
  store.dispatch('bump');
  assert.deepEqual(writes, ['{"n":0}'], 'the first save writes, an unchanged one does not');
  store.dispatch('inc');
  assert.deepEqual(writes, ['{"n":0}', '{"n":1}']);
});
