// The rail of tasks, as facts (one-entry plan 2 Task 4): the three groups in order, a line's open gate read from its
// worker's record, the short status in words under EN and ZH, and the count the Messages badge shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railOf, waitingCount } from '../../client/js/host/rail-view.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { withTable } from '../../client/js/i18n/words.js';
import { EN } from '../../client/js/i18n/en.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { MIN } from '../../client/js/time.js';

const NOW = new Date(2026, 10, 9, 14, 7).getTime();
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const task = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW - 12 * MIN, lastEventAt: NOW - MIN, lastSeq: 1, ...over });
const card = (id, sessionId) => ({ id, seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Buy 1 NVDA', data: { eventId: id, sessionId } });
const question = (id, sessionId) => ({ id, seq: 1.5, at: NOW, from: 'gravit', kind: 'question', text: '', data: { eventId: id, sessionId, questions: [{ id: 'q1', question: 'Which venue?' }] } });

const state = (tasks, convs = []) => R.tasksLoaded(R.hostList(emptyState(), { conversations: [conv('conv'), ...convs], channels: [] }), { conversation: 'conv', tasks, at: NOW });
const ids = lines => lines.map(l => l.task.id);

test('groups follow you → running → done and empty groups are left out', () => {
  const s = state([task('r1'), task('d1', { state: 'done', group: 'done' }), task('w1', { state: 'waiting', group: 'you', waitingFor: { kind: 'approval', id: 'a', tool: 'x' } }), task('f1', { state: 'failed', group: 'you' })]);
  const rail = railOf(s, NOW);
  assert.deepEqual(Object.keys(rail), ['you', 'running', 'done']);
  assert.deepEqual(ids(rail.you), ['w1', 'f1']);
  assert.deepEqual(ids(rail.running), ['r1']);
  assert.deepEqual(ids(rail.done), ['d1']);
  const only = railOf(state([task('r1')]), NOW);
  assert.deepEqual([only.you.length, only.running.length, only.done.length], [0, 1, 0]);
  assert.deepEqual(railOf(state([]), NOW), { you: [], running: [], done: [] });
  assert.deepEqual(railOf(emptyState(), NOW), { you: [], running: [], done: [] }, 'nothing loaded yet: nothing drawn');
});

test("a waiting line carries the worker's open gate", () => {
  const w = task('t1', { state: 'waiting', group: 'you', waitingFor: { kind: 'approval', id: 'call-1', tool: 'mcp__account__portfolio_place_order' } });
  let s = R.hostGate(state([w], [conv('t1')]), { convId: 't1', message: card('ev-1', 't1') });
  const [line] = railOf(s, NOW).you;
  assert.equal(line.gate?.id, 'ev-1', "the worker's open card");
  s = R.hostGateGone(s, { eventId: 'ev-1', outcome: 'approved' });
  const after = railOf(s, NOW);
  assert.equal([...after.you, ...after.running].find(l => l.task.id === 't1').gate, null, 'answered: no gate');
  assert.deepEqual(ids(after.you), [], 'answered here: it waits on no one until the next read says otherwise');
  assert.deepEqual(ids(after.running), ['t1']);
});

test('a gate delivered before the read moves the line under you; a waiting task whose gate has not come yet stays there', () => {
  const s = R.hostGate(state([task('t1')], [conv('t1')]), { convId: 't1', message: card('ev-1', 't1') });
  assert.deepEqual(ids(railOf(s, NOW).you), ['t1']);
  const early = state([task('t2', { state: 'waiting', group: 'you', waitingFor: { kind: 'question', id: 'c', tool: 'ask_user_question' } })]);
  const [line] = railOf(early, NOW).you;
  assert.equal(line.task.id, 't2');
  assert.equal(line.gate, null);
});

const statusOf = (s, id) => { const r = railOf(s, NOW); return [...r.you, ...r.running, ...r.done].find(l => l.task.id === id).status; };

test('the short status', () => {
  const waitingCard = R.hostGate(state([task('t1', { state: 'waiting', group: 'you', waitingFor: { kind: 'approval', id: 'c', tool: 'x' } })], [conv('t1')]), { convId: 't1', message: card('ev-1', 't1') });
  const waitingQuestion = R.hostGate(state([task('t1', { state: 'waiting', group: 'you', waitingFor: { kind: 'question', id: 'c', tool: 'ask_user_question' } })], [conv('t1')]), { convId: 't1', message: question('ev-2', 't1') });
  const notYet = state([task('t1', { state: 'waiting', group: 'you', waitingFor: { kind: 'question', id: 'c', tool: 'ask_user_question' } })]);
  const running = state([task('t1', { steps: ['read the tape', 'priced it', 'drafted'] })]);
  const one = state([task('t1', { steps: ['read'], startedAt: NOW - 30_000 })]);
  const done = state([task('t1', { state: 'done', group: 'done', lastEventAt: new Date(2026, 10, 9, 9, 5).getTime() })]);
  const word = st => statusOf(state([task('t1', { state: st, group: st === 'stopped' ? 'done' : 'you' })]), 't1');
  const pins = {
    EN: [waitingCard, 'Needs your approval', waitingQuestion, 'Needs your answer', notYet, 'Needs your answer', running, '3 steps · 12 min', one, '1 step · 0 min', done, 'Done 09:05'],
    ZH: [waitingCard, '等你批', waitingQuestion, '等你答', notYet, '等你答', running, '3 步 · 12 分钟', one, '1 步 · 0 分钟', done, '09:05 完成'],
  };
  const words = { EN: { failed: 'Failed', stalled: 'Stalled', blocked: 'Blocked', stopped: 'Stopped' }, ZH: { failed: '失败了', stalled: '卡住了', blocked: '受阻', stopped: '已停止' } };
  for (const [name, table] of [['EN', EN], ['ZH', ZH]]) {
    withTable(table, () => {
      const p = pins[name];
      for (let i = 0; i < p.length; i += 2) assert.equal(statusOf(p[i], 't1'), p[i + 1], `${name} ${p[i + 1]}`);
      for (const [st, w] of Object.entries(words[name])) assert.equal(word(st), w, `${name} ${st}`);
    });
  }
});

test('waitingCount counts the you group', () => {
  const s = R.hostGate(state([task('a', { state: 'failed', group: 'you' }), task('b', { state: 'blocked', group: 'you' }), task('c'), task('d', { state: 'done', group: 'done' }), task('e')], [conv('e')]), { convId: 'e', message: card('ev-1', 'e') });
  assert.equal(waitingCount(s), 3, 'failed, blocked, and the running task whose card came');
  assert.equal(waitingCount(state([task('c')])), 0);
  assert.equal(waitingCount(emptyState()), 0);
});
