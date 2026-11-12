// History (one-entry plan 2 Task 7): every session that is neither the conversation nor one of its tasks, listed newest first
// with its strategy, when and a one-line preview; one opened is read-only — its transcript, no composer, no answer keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHistoryScreen } from '../../client/js/render/history.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN, rowTime } from '../../client/js/time.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 5 * MIN, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const task = (id, over = {}) => ({ id, title: id, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW, lastEventAt: NOW, lastSeq: 1, ...over });
const CHANNELS = [
  { workspaceId: 'w0', name: 'workbench', isRoot: true },
  { workspaceId: 'w1', name: 'cn-market', title: 'CN market', isRoot: false },
];
const listed = (convs, { conversation = 'c', tasks = [], route = { screen: 'history', id: null } } = {}) => {
  const s = R.hostList(emptyState(), { conversations: convs, channels: CHANNELS, bots: [] });
  return R.nav(R.tasksLoaded(s, { conversation, tasks, at: NOW }), route);
};
const hrefs = h => [...h.matchAll(/<a class="hist-row" href="([^"]+)"/g)].map(m => m[1]);

test('rows exclude the conversation and today\'s tasks', () => {
  const s = listed([conv('c'), conv('t1'), conv('h1', { updatedAt: NOW - 9 * MIN }), conv('h2', { updatedAt: NOW - MIN })], { tasks: [task('t1')] });
  const h = renderHistoryScreen(s, NOW);
  assert.deepEqual(hrefs(h), ['#/history/h2', '#/history/h1'], 'newest first, neither the conversation nor the task');
  assert.match(h, /<h1 class="head-title">History<\/h1>/);
  assert.doesNotMatch(h, /data-action=/, 'no actions on a row');
  assert.match(renderHistoryScreen(listed([conv('c'), conv('o', { title: '<i>old</i>' })]), NOW), /&lt;i&gt;old&lt;\/i&gt;/, 'a title escaped');
  const none = renderHistoryScreen(listed([conv('c')]), NOW);
  assert.match(none, /Nothing in history yet/);
});

test('a row names its strategy when it has one', () => {
  const s = listed([conv('c'), conv('h1', { title: 'Lunhui read', channel: { workspaceId: 'w1', name: 'cn-market' }, preview: 'Held the line\nsold half' }), conv('h2', { channel: { workspaceId: 'w0', name: 'workbench' } })]);
  const h = renderHistoryScreen(s, NOW);
  const [first, second] = h.split('<a class="hist-row"').slice(1);
  assert.match(first, /<span class="hist-title">Lunhui read<\/span>/);
  assert.match(first, /<span class="hist-strategy">CN market<\/span>/, "its channel's strategy, by its title");
  assert.ok(first.includes(`<span class="hist-when">${rowTime(NOW - 5 * MIN, NOW)}</span>`), 'when');
  assert.match(first, /<span class="hist-preview">Held the line sold half<\/span>/, 'one line');
  assert.doesNotMatch(second, /hist-strategy/, 'the root names no strategy');
  assert.doesNotMatch(second, /hist-preview/, 'no preview read yet: none drawn');
});

test('an open history session draws no composer and no answer keys', () => {
  const messages = [
    { id: 'm1', from: 'you', kind: 'text', text: 'Price it', seq: 1, at: NOW - 9 * MIN },
    { id: 'm2', from: 'gravit', kind: 'approval', text: 'run it', seq: 2, at: NOW - 8 * MIN, data: { eventId: 'm2', sessionId: 'h1', toolName: 'bash' } },
    { id: 'm3', from: 'gravit', kind: 'question', text: '', seq: 3, at: NOW - 8 * MIN, data: { eventId: 'm3', sessionId: 'h1', questions: [{ id: 'q', question: 'Which?', options: [{ label: 'A' }] }] } },
    { id: 'm4', from: 'gravit', kind: 'card', text: 'Buy 2', seq: 4, at: NOW - 8 * MIN, answer: 'approved', data: { eventId: 'm4', sessionId: 'h1', title: 'Buy 2' } },
  ];
  const s = listed([conv('c'), conv('h1', { title: 'Old read', messages, loaded: true, window: { start: 1, through: 4, hasMore: true } })], { route: { screen: 'history', id: 'h1' } });
  const h = renderHistoryScreen(s, NOW);
  assert.match(h, /<h1 class="head-title">Old read<\/h1>/);
  assert.match(h, /<span class="chip grey hist-tag">Read-only<\/span>/);
  assert.match(h, /<a class="hist-back" href="#\/history"/, 'back to History');
  assert.match(h, /Price it/, 'its transcript');
  assert.match(h, /data-action="earlier"/, 'earlier pages loadable');
  assert.doesNotMatch(h, /class="composer"|id="say"/, 'no composer');
  assert.doesNotMatch(h, /data-action="answer"|data-action="answerQuestion"/, 'no answer keys');
  assert.doesNotMatch(h, /<input(?![^>]*disabled)/, 'nothing to type an answer into');
  assert.equal((h.match(/>Closed</g) ?? []).length, 2, 'the open gates drawn closed');
  assert.match(h, />Approved</, 'an answered one keeps its answer');
});

test('a history page the list does not carry reads Loading… then Not found', () => {
  assert.match(renderHistoryScreen(R.nav(emptyState(), { screen: 'history', id: 'x' }), NOW), /Loading…/);
  assert.match(renderHistoryScreen(listed([conv('c')], { route: { screen: 'history', id: 'gone' } }), NOW), /Not found/);
});

test("a history page draws no Lunhui follow-ups and the stock drawer no Ask: nothing there would send", async () => {
  const { VIEW_1027 } = await import('./helpers/lunhui-view.js');
  const { stockDrawerHtml } = await import('../../client/js/render/lunhui/stock.js');
  const composed = { id: 'p1', seq: 1, at: NOW, from: 'gravit', kind: 'composed', text: '弱势日', data: { callId: 'k1', strategy: VIEW_1027.strategy, run: VIEW_1027.run, summary: '弱势日', blocks: [], choices: [{ label: '再看龙头' }], modules: [] } };
  const key = `${VIEW_1027.strategy}/${VIEW_1027.run}/`;
  const at = (route, tasks = []) => {
    const s = listed([conv('c', { messages: [composed], loaded: true }), conv('h1', { messages: [composed], loaded: true })], { route, tasks });
    return { ...s, lunhui: { ...s.lunhui, views: { [key]: { status: 'loaded', view: VIEW_1027 } }, stock: { key, code: '600001' } } };
  };
  const h = renderHistoryScreen(at({ screen: 'history', id: 'h1' }), NOW);
  assert.match(h, /lh-answer/, 'the composed answer is drawn');
  assert.doesNotMatch(h, /lh-choice|lunhuiChoice/, 'its follow-ups are not');
  assert.doesNotMatch(stockDrawerHtml(at({ screen: 'history', id: 'h1' })), /lunhuiAsk/);
  assert.match(stockDrawerHtml(at({ screen: 'task', id: 'h1' }, [task('h1')])), /lunhuiAsk/, 'a task page keeps its Ask');
  const { renderTaskScreen } = await import('../../client/js/render/task.js');
  assert.match(renderTaskScreen(at({ screen: 'task', id: 'h1' }, [task('h1')]), NOW), /lunhuiChoice/, 'and its follow-ups');
});

// ---- a task off the rail lands here once its New York day is over: its page still draws its event tables (fix wave, spec §4.1)
test("a task's session read here draws its event tables at the top, as the task's page does", async () => {
  const { EVENT_VIEW, EVENT_VIEW_ID } = await import('./helpers/event-view.js');
  const base = listed([conv('c'), conv('w', { loaded: true, messages: [{ id: 'm1', from: 'gravit', kind: 'text', text: 'done', seq: 1, at: NOW, data: {} }] })], { route: { screen: 'history', id: 'w' } });
  const s = { ...base, analog: { tasks: { w: { status: 'loaded', task: { id: 'w', eventViews: [EVENT_VIEW_ID], namedViews: [] } } }, views: { [EVENT_VIEW_ID]: { status: 'loaded', view: EVENT_VIEW } } } };
  const h = renderHistoryScreen(s, NOW);
  const thread = h.slice(h.indexOf('id="thread"'));
  assert.match(thread, /^id="thread"><div class="et-list"><section class="et">/, 'at the top of the transcript');
  assert.match(h, /done/);
  assert.doesNotMatch(renderHistoryScreen(base, NOW), /et-list/, 'no task read (or no task): no table');
});
