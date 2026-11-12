// A task's full process (one-entry plan 2 Task 8): #/task/<id> is the worker's transcript, read-only — its head (back to
// Messages, the title, the state, the strategy, Stop or Continue by state, Details), the thread with its gates answerable,
// and in place of a composer one line that sends the operator to Gravit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskScreen } from '../../client/js/render/task.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN } from '../../client/js/time.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 5 * MIN, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const task = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW - 3 * MIN, lastEventAt: NOW - MIN, lastSeq: 1, ...over });
const on = (convs, tasks, id) => R.nav(R.tasksLoaded(R.hostList(emptyState(), { conversations: convs, channels: [], bots: [] }), { conversation: 'c', tasks, at: NOW }), { screen: 'task', id });

test('the page has no composer and says to tell Gravit', () => {
  const messages = [
    { id: 'b1', from: 'system', kind: 'task', text: 'Read the tape\n\nPrice it', seq: 1, at: NOW - 3 * MIN, data: { form: 'brief' } },
    { id: 'm2', from: 'gravit', kind: 'text', text: 'held <b>', seq: 2, at: NOW - 2 * MIN, data: {} },
    { id: 'm3', from: 'gravit', kind: 'approval', text: 'run it', seq: 3, at: NOW - MIN, data: { eventId: 'm3', sessionId: 'w', toolName: 'bash' } },
  ];
  const s = on([conv('c'), conv('w', { title: 'old title', messages, loaded: true })], [task('w', { title: 'Read <the> tape', strategy: 'cn-market' })], 'w');
  const h = renderTaskScreen(s, NOW);
  assert.match(h, /<a class="task-back" href="#\/messages" aria-label="Back to Messages">/, 'back to Messages');
  assert.match(h, /<h1 class="head-title">Read &lt;the&gt; tape<\/h1>/, "the task's title");
  assert.match(h, /<span class="task-head-state"><span class="task-dot waiting"><\/span>Needs your approval<\/span>/, 'its state: the gate waits on the operator');
  assert.match(h, /<a class="task-head-strategy" href="#\/strategy\/cn-market">cn-market<\/a>/, 'its strategy');
  assert.match(h, /held &lt;b&gt;/, "the worker's transcript");
  assert.match(h, /data-action="answer"/, 'a gate answerable as on its line');
  assert.match(h, /data-action="toggleDetails"/, 'Details, for its jobs');
  assert.doesNotMatch(h, /class="composer"|id="say"|contenteditable/, 'no composer');
  assert.match(h, /<a class="task-tell" href="#\/messages">To change course, tell Gravit<\/a>/);
  // Details is the worker's: its jobs, and no Stop Gravit (the head's Stop stops the task)
  const d = renderTaskScreen(R.toggleDetails(s), NOW);
  assert.match(d, /class="drawer details"/);
  assert.doesNotMatch(d, /data-action="stopGravit"/);
});

test('a worker no task lists (aged out of the window) still gets the worker\'s Details: no Stop Gravit, titled from its session', () => {
  const s = R.toggleDetails(on([conv('c'), conv('w', { title: 'Old <run>', running: true, loaded: true })], [], 'w'));
  const d = renderTaskScreen(s, NOW);
  assert.match(d, /class="drawer details"/);
  assert.doesNotMatch(d, /data-action="stopGravit"/, 'never Stop Gravit on a worker');
  assert.match(d, /<div class="dsec-title">Old &lt;run&gt;<\/div>/, "titled from the session's record");
});

test('Stop and Continue follow the state', () => {
  const keysOf = (state, busy = false) => {
    let s = on([conv('c'), conv('w', { loaded: true })], [task('w', { state, group: 'running' })], 'w');
    if (busy) s = R.taskBusy(s, { id: 'w', on: true });
    const head = renderTaskScreen(s, NOW).split('</header>')[0];
    return [...head.matchAll(/<button[^>]*data-action="(task\w+)"[^>]*>/g)].map(m => m[1] + (/disabled/.test(m[0]) ? ':off' : ''));
  };
  assert.deepEqual(keysOf('running'), ['taskStop']);
  assert.deepEqual(keysOf('waiting'), ['taskStop']);
  assert.deepEqual(keysOf('stalled'), ['taskStop', 'taskResume']);
  assert.deepEqual(keysOf('failed'), ['taskResume']);
  assert.deepEqual(keysOf('blocked'), ['taskResume']);
  assert.deepEqual(keysOf('done'), []);
  assert.deepEqual(keysOf('stopped'), []);
  assert.deepEqual(keysOf('stalled', true), ['taskStop:off', 'taskResume:off'], 'while one is in flight');
});

test('a task whose transcript is not listed yet reads Loading…; one nobody knows reads Not found', () => {
  const h = renderTaskScreen(on([conv('c')], [task('w', { title: 'Fresh' })], 'w'), NOW);
  assert.match(h, /<h1 class="head-title">Fresh<\/h1>/, 'the head from the task');
  assert.match(h, /Loading…/);
  assert.match(renderTaskScreen(on([conv('c')], [], 'gone'), NOW), /Not found/);
  assert.match(renderTaskScreen(R.nav(emptyState(), { screen: 'task', id: 'x' }), NOW), /Loading…/, 'before the list lands');
});

// ---- the event tables at the top of the task's page (analog event table, Task 7)
test("the page draws its task's named views' tables, newest first, else its last event view's", async () => {
  const { EVENT_VIEW, EVENT_VIEW_ID } = await import('./helpers/event-view.js');
  const OTHER = 'an-20261112-0000aaaa';
  const OLD = 'an-20261111-0000bbbb';
  const views = { [EVENT_VIEW_ID]: { status: 'loaded', view: EVENT_VIEW }, [OTHER]: { status: 'loaded', view: { ...EVENT_VIEW, id: OTHER, title: 'The second table' } }, [OLD]: { status: 'loaded', view: { ...EVENT_VIEW, id: OLD, title: 'The old table' } } };
  const base = on([conv('c'), conv('w', { loaded: true, messages: [{ id: 'm1', from: 'gravit', kind: 'text', text: 'done', seq: 1, at: NOW, data: {} }] })], [task('w')], 'w');
  const withTask = taskRead => ({ ...base, analog: { tasks: { w: { status: 'loaded', task: taskRead } }, views } });
  const named = renderTaskScreen(withTask({ id: 'w', eventViews: [OLD, EVENT_VIEW_ID, OTHER], namedViews: [EVENT_VIEW_ID, OTHER] }), NOW);
  const thread = named.slice(named.indexOf('id="thread"'));
  assert.match(thread, /^id="thread"><div class="et-list"><section class="et">/, 'at the top of the page');
  const second = thread.indexOf('The second table');
  const first = thread.indexOf('CEO 风波');
  assert.ok(second > 0 && first > second, 'newest first: the last named drawn first');
  assert.doesNotMatch(named, /The old table/, 'an event view no report named is not drawn');
  // none named: the last event view alone
  const last = renderTaskScreen(withTask({ id: 'w', eventViews: [OLD, OTHER], namedViews: [] }), NOW);
  assert.match(last, /The second table/);
  assert.doesNotMatch(last, /The old table/);
  // no event view, or the task not read: no table
  assert.doesNotMatch(renderTaskScreen(withTask({ id: 'w', eventViews: [], namedViews: [] }), NOW), /et-list/);
  assert.doesNotMatch(renderTaskScreen(base, NOW), /et-list/);
});
