// The Gravit box drawn (plan 1 of the box, Task 2): half a ball at the right edge with its marks, the panel with the one
// conversation's thread and Messages' own composer, where it stands and what it steps aside for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBox } from '../../client/js/render/box.js';
import { renderThread } from '../../client/js/render/thread.js';
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

// ---- Task 4: the compact thread and what waits on you
const RUN = '20261027T201627Z-6937d208';
const composedMessage = () => m('p7', { seq: 7, kind: 'composed', text: 'Weak day.', data: { callId: '7', strategy: 'cn-market', run: RUN, summary: 'Weak day.', blocks: [{ kind: 'ladder' }], choices: [], modules: ['environment'] } });
const VIEW_ID = 'an-20261112-0a1b2c3d';
const reportWithView = () => m('e70', { seq: 70, from: 'system', kind: 'task', text: '', data: { form: 'report', task: 't1', status: 'ready', title: 'Read the tape', body: `see ${VIEW_ID}`, views: [VIEW_ID] } });
const convWith = messages => conv('conv', { messages, loaded: true });
const state = emptyState();
// tasks waiting on the operator, each carrying a gate, the screen navigated to `screen`/`id`; each spec its id and its strategy
const waitingWith = (screen, id, specs) => {
  let s = at(screen, id, { convs: [conv('conv'), ...specs.map(x => conv(x.id))], tasks: specs.map(x => task(x.id, { state: 'waiting', group: 'you', strategy: x.strategy, waitingFor: { kind: 'approval', id: 'c', tool: 'x' } })) });
  for (const x of specs) s = R.hostGate(s, { convId: x.id, message: { id: 'ev-' + x.id, seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Buy 1 NVDA', data: { eventId: 'ev-' + x.id, sessionId: x.id, title: 'Buy 1 NVDA', venue: 'paper' } } });
  return s;
};

test('compact: a composed answer and an event table are one line to Messages', () => {
  const h = renderThread(convWith([composedMessage(), reportWithView()]), state, NOW, { compact: true });
  assert.equal((h.match(/class="gbox-stub"/g) ?? []).length, 2);
  assert.doesNotMatch(h, /class="lh-answer|class="et-/);
  assert.match(h, /<div class="gbox-stub"><span>Composed answer<\/span><a href="#\/messages">Open in Messages ›<\/a><\/div>/);
  assert.match(h, /<div class="gbox-stub"><span>Event table<\/span><a href="#\/messages">Open in Messages ›<\/a><\/div>/);
  assert.match(h, /id="relay-conv-e70"/, 'the report line itself stays');
});

test('not compact: the blocks as before', () => {
  const h = renderThread(convWith([composedMessage(), reportWithView()]), state, NOW, {});
  assert.doesNotMatch(h, /gbox-stub/);
  assert.match(h, /class="et-list"/);
});

test('waiting lines: open, at most three, then the count', () => {
  const h = renderBox(R.boxOpen(waitingAt('desk', 5)), NOW);
  const waiting = h.slice(h.indexOf('class="gbox-waiting"'), h.indexOf('class="gbox-body"'));
  assert.equal((waiting.match(/class="gbox-line"/g) ?? []).length, 3);
  assert.match(waiting, /<h3 class="gbox-waiting-head">Waiting on you<\/h3>/);
  assert.match(waiting, /<a class="gbox-more" href="#\/messages">2 more in Messages ›<\/a>/);
  assert.doesNotMatch(waiting, /<details/);
  assert.match(waiting, /<div class="gbox-line" data-task="t1">[\s\S]*?<div class="task-gate"><div class="card orange">[\s\S]*?data-action="answer" data-conv="t1" data-msg="ev-t1" data-value="allowed-once"/);
  const three = renderBox(R.boxOpen(waitingAt('desk', 3)), NOW);
  assert.equal((three.match(/class="gbox-line"/g) ?? []).length, 3);
  assert.doesNotMatch(three, /gbox-more/, 'three fit: no count');
  assert.match(renderBox(R.boxOpen(waitingAt('desk', 4)), NOW), />1 more in Messages ›</);
});

test('no line waiting: the strip is empty', () => {
  assert.match(renderBox(R.boxOpen(at('desk')), NOW), /<div class="gbox-waiting"><\/div>/);
});

test('on a strategy\'s page the box leaves out the page\'s own lines', () => {
  const h = renderBox(R.boxOpen(waitingWith('strategy', 'beta', [{ id: 't3', strategy: 'beta' }, { id: 't4' }])), NOW);
  assert.doesNotMatch(h, /data-task="t3"/); assert.match(h, /data-task="t4"/);
  assert.match(renderBox(R.boxOpen(waitingWith('strategy', 'beta', [{ id: 't3', strategy: 'beta' }])), NOW), /<div class="gbox-waiting"><\/div>/);
});
