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
