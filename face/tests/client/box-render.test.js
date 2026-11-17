// The Gravit box drawn (plan 1 of the box, Task 2): half a ball at the right edge with its marks, the panel with the one
// conversation's thread and Messages' own composer, where it stands and what it steps aside for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBox } from '../../client/js/render/box.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';

const NOW = new Date(2026, 10, 16, 10, 0).getTime();
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: 0, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const task = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW, lastEventAt: NOW, lastSeq: 1, ...over });
const m = (id, over = {}) => ({ id, seq: 1, at: NOW, from: 'gravit', kind: 'text', text: 'hello', data: {}, ...over });
// the tasks naming 'conv' loaded, then the screen navigated to (a strategy's page needs a name, or it lands on Messages)
const at = (screen, id = screen === 'strategy' ? 'cn-market' : null, { convs = [conv('conv')], tasks = [] } = {}) => {
  const s = R.tasksLoaded(R.hostList(emptyState(), { conversations: convs, channels: [] }), { conversation: 'conv', tasks, at: NOW });
  return R.nav(s, { screen, id });
};
const withConv = (st, over) => ({ ...st, conversations: st.conversations.map(c => (c.id === 'conv' ? { ...c, ...over } : c)) });
// two tasks in the rail's "you" group, each worker carrying a gate
const waitingAt = (screen, n) => {
  const ids = Array.from({ length: n }, (_, i) => 't' + (i + 1));
  let s = at(screen, null, { convs: [conv('conv'), ...ids.map(id => conv(id))], tasks: ids.map(id => task(id, { state: 'waiting', group: 'you', waitingFor: { kind: 'approval', id: 'c', tool: 'x' } })) });
  for (const id of ids) s = R.hostGate(s, { convId: id, message: { id: 'ev-' + id, seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Buy 1 NVDA', data: { eventId: 'ev-' + id, sessionId: id, title: 'Buy 1 NVDA', venue: 'paper' } } });
  return s;
};

test('no box on Messages, a task\'s page or History, or with no conversation', () => {
  for (const st of [at('messages'), at('task', 'w1'), at('history', 'h1'), R.nav(emptyState(), { screen: 'desk', id: null })]) assert.equal(renderBox(R.boxOpen(st), NOW), '');
});

test('no box under an owner sheet or the identity sheet', () => {
  assert.equal(renderBox({ ...at('trade'), sheet: { kind: 'order' } }, NOW), '');
  assert.equal(renderBox({ ...at('account'), identity: { ...at('account').identity, connect: { step: 'token' } } }, NOW), '');
});

test('closed: the half ball, its marks and its name', () => {
  const h = renderBox(withConv(waitingAt('desk', 2), { running: true }), NOW);
  assert.match(h, /<button type="button" id="gbox-ball" class="gbox-ball" data-action="boxOpen" aria-label="Ask Gravit, 2 waiting, working"/);
  assert.match(h, /title="Ask Gravit · ⌥⌘N"/);
  assert.match(h, /class="gbox-g" aria-hidden="true">G</);
  assert.match(h, /class="gbox-badge" aria-hidden="true">2</);
  assert.match(h, /class="gbox-dot pulse"/);
  assert.doesNotMatch(h, /gbox-panel/);
  assert.match(renderBox(withConv(at('desk'), { updatedAt: 9, lastSeen: 5 }), NOW), /aria-label="Ask Gravit, new reply"[\s\S]*class="gbox-dot steady"/);
  const quiet = renderBox(at('markets'), NOW);
  assert.match(quiet, /aria-label="Ask Gravit"/);
  assert.doesNotMatch(quiet, /gbox-badge|gbox-dot/);
  assert.match(renderBox(at('markets'), NOW, {}, { mac: false }), /title="Ask Gravit · Ctrl\+Alt\+N"/);
});

test('open: the panel with the thread and Messages\' own composer', () => {
  const h = renderBox(R.boxOpen(withConv(at('markets'), { messages: [m('a', { from: 'you', text: 'why?' })], loaded: true })), NOW);
  assert.match(h, /<section class="gbox-panel" role="dialog" aria-modal="false" aria-label="Gravit">/);
  assert.match(h, /<div class="gbox-waiting"><\/div>/);
  assert.match(h, /<div class="gbox-body"><div class="thread" id="thread">/);
  assert.match(h, /why\?/);
  assert.match(h, /id="thread"/); assert.match(h, /id="say"/);
  assert.match(h, /<a class="gbox-key" href="#\/messages" aria-label="Open in Messages" title="Open in Messages">/);
  assert.match(h, /<button type="button" class="gbox-key" data-action="boxClose" aria-label="Minimize" title="Minimize">/);
  assert.doesNotMatch(h, /id="turn-rail"|earlier-/);
  assert.doesNotMatch(h, /id="gbox-ball"/);
  assert.doesNotMatch(h, /class="status up"/);
  assert.match(renderBox(R.boxOpen(withConv(at('markets'), { running: true })), NOW), /<span class="status up"><span class="status-dot"><\/span>Working<\/span>/);
});

test('open on a conversation known but not listed: one plain line in place of the thread', () => {
  const h = renderBox(R.boxOpen(at('desk', null, { convs: [] })), NOW);
  assert.match(h, /<p class="gbox-empty dim">Ask Gravit about this page\.<\/p>/);
  assert.doesNotMatch(h, /id="thread"/);
  assert.match(h, /id="say"/);
});

test('earlier messages: a link to Messages', () => {
  const h = renderBox(R.boxOpen(withConv(at('desk'), { loaded: true, window: { hasMore: true, start: 3 } })), NOW);
  assert.match(h, /<a class="gbox-earlier" href="#\/messages">Earlier in Messages ›<\/a>/);
});

test('aside: a drawer, a ticket', () => {
  assert.match(renderBox({ ...at('account'), account: { ...at('account').account, statementOpen: true } }, NOW), /class="gbox" data-aside="drawer"/);
  assert.match(renderBox({ ...at('trade'), trade: { ...at('trade').trade, ticket: { id: 'stock:NVDA', side: 'buy', venue: null, outcome: 0 } } }, NOW), /class="gbox" data-aside="ticket"/);
  assert.match(renderBox(at('desk'), NOW), /^<div class="gbox">/);
});
