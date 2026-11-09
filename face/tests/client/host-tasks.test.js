// The tasks host layer (one-entry plan 2 Task 2): /data/tasks read at once, after a list refresh and every TASKS_POLL_MS;
// Stop and Continue post once while one is in flight; a 404 read is off, any other failure keeps the last items.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startTasks, followUpText, TASKS_POLL_MS } from '../../client/js/host/tasks.js';
import { spoken } from './helpers/spoken.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const view = (id, over = {}) => ({ id, title: id.toUpperCase(), status: 'running', ...over });
const err = status => Object.assign(new Error(`HTTP ${status}`), { status });

function rig({ read = { ok: true, conversation: 'conv-1', tasks: [view('a'), view('b')] } } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = []; const posts = [];
  const answers = { read, post: null };
  const gates = [];
  const getJson = async path => {
    reads.push(path);
    const a = typeof answers.read === 'function' ? answers.read() : answers.read;
    if (a instanceof Error) throw a;
    return a;
  };
  const postJson = (path, body) => {
    posts.push([path, body]);
    if (answers.post instanceof Error) return Promise.reject(answers.post);
    return new Promise(res => gates.push(() => res({ ok: true, task: body.task })));
  };
  let id = 0; const timers = new Map();
  const t = { after: (ms, fn) => { timers.set(++id, { fn, ms }); return id; }, cancel: x => { timers.delete(x); } };
  const fire = async () => { const due = [...timers.entries()]; timers.clear(); for (const [, x] of due) x.fn(); await settle(); };
  const tasks = startTasks({ store, getJson, postJson, timers: t, now: () => 777 });
  return { store, tasks, reads, posts, answers, gates, timers, fire, s: () => store.get().tasks };
}

test('refresh fills state.tasks with the conversation and the views', async () => {
  const r = rig();
  assert.equal(r.s().status, 'loading');
  await settle();
  assert.deepEqual(r.s(), { status: 'ready', conversation: 'conv-1', items: [view('a'), view('b')], at: 777, busy: [] });
  r.answers.read = { ok: true, conversation: null, tasks: [] };
  await r.tasks.refresh();
  assert.equal(r.s().conversation, null);
  assert.deepEqual(r.s().items, []);
});

test('a 404 from /data/tasks is off, not failed', async () => {
  const r = rig({ read: err(404) });
  await settle();
  assert.equal(r.s().status, 'off');
  assert.deepEqual(r.s().items, []);
});

test('a 500 is failed and keeps the last items', async () => {
  const r = rig();
  await settle();
  r.answers.read = err(500);
  await r.tasks.refresh();
  assert.equal(r.s().status, 'failed');
  assert.deepEqual(r.s().items, [view('a'), view('b')]);
  assert.equal(r.s().at, 777);
});

test('refresh runs again every TASKS_POLL_MS and dispose stops it', async () => {
  const r = rig();
  await settle();
  assert.equal(r.reads.length, 1);
  assert.deepEqual([...r.timers.values()].map(x => x.ms), [TASKS_POLL_MS]);
  await r.fire();
  assert.equal(r.reads.length, 2);
  await r.fire();
  assert.equal(r.reads.length, 3);
  r.tasks.dispose();
  assert.equal(r.timers.size, 0);
  await r.fire();
  assert.equal(r.reads.length, 3);
});

test('stop posts /data/tasks/stop once while one is in flight', async () => {
  const r = rig();
  await settle();
  const first = r.tasks.stop('a');
  const second = r.tasks.stop('a');
  await settle();
  assert.deepEqual(r.posts, [['/data/tasks/stop', { task: 'a' }]]);
  assert.deepEqual(r.s().busy, ['a']);
  const before = r.reads.length;
  r.gates[0]();
  await Promise.all([first, second]);
  assert.deepEqual(r.s().busy, []);
  assert.equal(r.reads.length, before + 1, 'then a refresh');
  assert.equal(r.posts.length, 1);
});

test('resume posts /data/tasks/continue {task} and refreshes', async () => {
  const r = rig();
  await settle();
  const before = r.reads.length;
  const p = r.tasks.resume('b');
  await settle();
  assert.deepEqual(r.posts, [['/data/tasks/continue', { task: 'b' }]]);
  r.gates[0]();
  await p;
  assert.equal(r.reads.length, before + 1);
  assert.deepEqual(r.s().busy, []);
});

test('a failed stop is a status line, not a throw', async () => {
  const r = rig();
  await settle();
  r.answers.post = err(404);
  await r.tasks.stop('a');
  assert.equal(r.store.get().status.bad, true);
  assert.equal(spoken(r.store.get().status.line), 'That task has already ended');
  assert.deepEqual(r.s().busy, []);
  r.answers.post = err(409);
  await r.tasks.stop('a');
  assert.equal(spoken(r.store.get().status.line), 'That task has already ended', 'a 409 (the task ended meanwhile) is the gone line too');
  r.answers.post = err(500);
  await r.tasks.stop('a');
  assert.equal(spoken(r.store.get().status.line), 'Could not stop the task');
  await r.tasks.resume('a');
  assert.equal(spoken(r.store.get().status.line), 'Could not continue the task');
});

test('followUpText puts the tag on its own first line', () => {
  assert.equal(followUpText({ id: 'session-1', title: 'CRWV' }, '再看一下'), '[follow-up · task session-1 · CRWV]\n再看一下');
  assert.equal(followUpText({ id: 's', title: 'a\nb] c' }, 'x'), '[follow-up · task s · a b c]\nx');
});
