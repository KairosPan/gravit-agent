// The gravit box's facts (plan 1 of the box, Task 1): the screens it stands on, the read it names while open, what covers
// it, what it steps aside for, the ball's marks, and its open state kept as a pref.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxShown, onScreenId } from '../../client/js/host/sessions.js';
import { boxCovered, boxAside, ballMarks } from '../../client/js/host/box-view.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { prefsOf, initialState, PREFS_KEY } from '../../client/js/app.js';

const NOW = new Date(2026, 10, 16, 10, 0).getTime();
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: 0, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const task = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW, lastEventAt: NOW, lastSeq: 1, ...over });
// the tasks naming 'conv' loaded, then the screen navigated to (a strategy's page needs a name, or it lands on Messages)
const at = (screen, id = screen === 'strategy' ? 'cn-market' : null, { convs = [conv('conv')], tasks = [] } = {}) => {
  const s = R.tasksLoaded(R.hostList(emptyState(), { conversations: convs, channels: [] }), { conversation: 'conv', tasks, at: NOW });
  return R.nav(s, { screen, id });
};
const withConv = (st, over) => ({ ...st, conversations: st.conversations.map(c => (c.id === 'conv' ? { ...c, ...over } : c)) });
// one task in the rail's "you" group, its worker carrying a gate
const waitingAt = screen => {
  const w = task('t1', { state: 'waiting', group: 'you', waitingFor: { kind: 'approval', id: 'c', tool: 'x' } });
  const s = at(screen, null, { convs: [conv('conv'), conv('t1')], tasks: [w] });
  return R.hostGate(s, { convId: 't1', message: { id: 'ev-1', seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Buy 1 NVDA', data: { eventId: 'ev-1', sessionId: 't1', title: 'Buy 1 NVDA', venue: 'paper' } } });
};

test('the box stands on the eight screens that show no conversation', () => {
  for (const screen of ['desk', 'markets', 'trade', 'discover', 'plugin', 'module', 'account', 'strategy']) assert.equal(boxShown(at(screen)), true, screen);
  for (const screen of ['messages', 'task', 'history']) assert.equal(boxShown(at(screen, 'x')), false, screen);
});

test('no box while the conversation is unknown', () => {
  assert.equal(boxShown(R.nav(emptyState(), { screen: 'desk', id: null })), false);
});

test('onScreenId names the conversation only while the box is open on a box screen', () => {
  assert.equal(onScreenId(at('markets')), null);
  assert.equal(onScreenId(R.boxOpen(at('markets'))), 'conv');
  assert.equal(onScreenId(R.boxOpen(at('task', 'w1'))), 'w1');
  assert.equal(onScreenId(R.boxClose(R.boxOpen(at('desk')))), null);
});

test("covered by any owner sheet, Trade's order step included, and by the identity sheet", () => {
  const st = at('trade');
  assert.equal(boxCovered(st), false);
  assert.equal(boxCovered({ ...st, sheet: { kind: 'order' } }), true);
  assert.equal(boxCovered({ ...st, identity: { ...st.identity, connect: { step: 'token' } } }), true);
});

test('aside: a drawer first, then an open ticket on Trade', () => {
  const st = at('account');
  assert.equal(boxAside(st), null);
  assert.equal(boxAside({ ...st, account: { ...st.account, statementOpen: true } }), 'drawer');
  assert.equal(boxAside({ ...at('trade'), trade: { ...st.trade, ticket: { id: 'stock:NVDA', side: 'buy', venue: null, outcome: 0 } } }), 'ticket');
  // a ticket off Trade is no aside; a drawer wins over an open ticket
  assert.equal(boxAside({ ...st, trade: { ...st.trade, ticket: { id: 'stock:NVDA' } } }), null);
  assert.equal(boxAside({ ...at('trade'), settingsOpen: true, trade: { ...st.trade, ticket: { id: 'stock:NVDA' } } }), 'drawer');
});

test('marks: what waits, working, a new reply', () => {
  const st = waitingAt('desk');
  assert.equal(ballMarks(st).waiting, 1);
  assert.deepEqual(ballMarks(withConv(at('desk'), { running: true })), { waiting: 0, working: true, fresh: false });
  assert.deepEqual(ballMarks(withConv(at('desk'), { updatedAt: 9, lastSeen: 5 })), { waiting: 0, working: false, fresh: true });
  assert.deepEqual(ballMarks(withConv(at('desk'), { running: true, updatedAt: 9, lastSeen: 5 })), { waiting: 0, working: true, fresh: false });
  assert.deepEqual(ballMarks(emptyState()), { waiting: 0, working: false, fresh: false });
});

test('the open box is a pref', () => {
  const storage = p => ({ getItem: k => (k === PREFS_KEY ? JSON.stringify(p) : null) });
  assert.equal(prefsOf({ ...emptyState(), boxOpen: true }).boxOpen, true);
  assert.equal(initialState(storage({ boxOpen: true })).boxOpen, true);
  assert.equal(initialState(storage({})).boxOpen, false);
  assert.equal(initialState(storage({ boxOpen: 'yes' })).boxOpen, false);
  assert.equal(emptyState().boxOpen, false);
});
