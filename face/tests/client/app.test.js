// The app's pure parts on the host: the route, the prefs, the timers, the question batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, toHash } from '../../client/js/router.js';
import { Timers, routeOf, settle, initialState, prefsOf, makeStore, answersFrom, PREFS_KEY } from '../../client/js/app.js';
import { emptyState } from '../../client/js/data/empty.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m }; };

test('parseHash and toHash round-trip; stage 1 folds every other screen to Messages', () => {
  assert.deepEqual(parseHash('#/messages/s1'), { screen: 'messages', id: 's1' });
  assert.equal(toHash({ screen: 'messages', id: 's1' }), '#/messages/s1');
  assert.deepEqual(routeOf('#/messages/s1'), { screen: 'messages', id: 's1' });
  assert.deepEqual(routeOf('#/discover'), { screen: 'messages', id: null });
  assert.deepEqual(routeOf('#/markets/BTC'), { screen: 'messages', id: null });
  assert.deepEqual(routeOf(''), { screen: 'messages', id: null });
});

test('initialState is the empty state plus the viewer\'s prefs; garbage prefs are ignored', () => {
  const storage = memory();
  storage.setItem(PREFS_KEY, JSON.stringify({ theme: 'black', railCollapsed: true, lastConv: 's9', lastSeen: { s9: 40 }, watch: ['BTC'] }));
  const s = initialState(storage);
  assert.equal(s.theme, 'black'); assert.equal(s.railCollapsed, true); assert.equal(s.lastConv, 's9');
  assert.deepEqual(s.lastSeen, { s9: 40 }); assert.deepEqual(s.markets.watch, ['BTC']);
  assert.deepEqual(s.conversations, []);
  storage.setItem(PREFS_KEY, '{"theme":"neon","lastSeen":[1],"watch":"x"}');
  const bad = initialState(storage);
  assert.equal(bad.theme, 'system'); assert.deepEqual(bad.lastSeen, {}); assert.deepEqual(bad.markets.watch, []);
  storage.setItem(PREFS_KEY, 'not json');
  assert.equal(initialState(storage).theme, 'system');
  assert.equal(initialState(null).theme, 'system');
});

test('the store writes only the prefs, never the conversations, and never loads a saved demo state', () => {
  const storage = memory();
  storage.setItem('gravit-ui.state', JSON.stringify({ v: 5, conversations: [{ id: 'old' }] }));
  const store = makeStore(storage);
  assert.deepEqual(store.get().conversations, []);
  store.dispatch('toggleRail');
  const saved = JSON.parse(storage.getItem(PREFS_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['lastConv', 'lastSeen', 'railCollapsed', 'theme', 'watch']);
  assert.equal(saved.railCollapsed, true);
  assert.deepEqual(prefsOf(emptyState()), { theme: 'system', railCollapsed: false, lastConv: null, lastSeen: {}, watch: [] });
});

test('settle routes by the hash and says which hash the address bar should show', () => {
  const store = makeStore(null);
  assert.equal(settle(store, '#/messages/zz'), '#/messages', 'a missing conversation folds to none while the list is empty');
  assert.equal(store.get().route.screen, 'messages');
  assert.equal(settle(store, '#/trade'), '#/messages');
});

test('Timers tracks pending timers and clear() cancels them', async () => {
  const t = new Timers();
  let ran = 0;
  t.after(1, () => { ran += 1; });
  t.after(1, () => { ran += 1; });
  t.clear();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(ran, 0);
  t.after(1, () => { ran += 1; });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(ran, 1);
  assert.equal(t.pending.size, 0);
});

test('answersFrom reads the card\'s inputs into the host\'s batch: every question once, custom text when typed', () => {
  const inputs = {
    'input[name="q-q1"]': [{ checked: false, value: 'Yes' }, { checked: true, value: 'No' }],
    'input[name="q-q2"]': [{ checked: true, value: 'AAPL' }, { checked: true, value: 'NVDA' }],
    'input[name="q-q3"]': [],
  };
  const customs = { 'input[name="q-q3-custom"]': { value: '  nothing more  ' } };
  const root = { querySelectorAll: sel => inputs[sel] ?? [], querySelector: sel => customs[sel] ?? null };
  const batch = answersFrom(root, [{ id: 'q1' }, { id: 'q2', multiSelect: true }, { id: 'q3' }]);
  assert.deepEqual(batch, { answers: [{ id: 'q1', selected: ['No'] }, { id: 'q2', selected: ['AAPL', 'NVDA'] }, { id: 'q3', selected: [], custom: 'nothing more' }] });
  assert.deepEqual(answersFrom(root, undefined), { answers: [] });
});
