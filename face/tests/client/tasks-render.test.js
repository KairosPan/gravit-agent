// The rail of tasks, drawn (one-entry plan 2 Task 4): one line each, its summary only a dot, the title, the short status and
// a caret; expanded, its strategy, steps, result or gate, usage and the keys its state allows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskRail, scheduledLineHtml, waitingLineHtml } from '../../client/js/render/tasks.js';
import { scheduledOf, railOf } from '../../client/js/host/rail-view.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { MIN } from '../../client/js/time.js';

const NOW = new Date(2026, 10, 9, 14, 7).getTime();
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const task = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW - 12 * MIN, lastEventAt: NOW - MIN, lastSeq: 1, ...over });
const state = (tasks, convs = []) => R.tasksLoaded(R.hostList(emptyState(), { conversations: [conv('conv'), ...convs], channels: [] }), { conversation: 'conv', tasks, at: NOW });
const lineOf = (h, id) => h.match(new RegExp(`<details class="task-line"[^>]*data-task="${id}"[\\s\\S]*?</details>`))?.[0] ?? '';
const keysOf = h => h.slice(h.indexOf('</summary>'));

test('nothing to draw: no rail', () => {
  assert.equal(renderTaskRail(state([]), NOW), '');
  assert.equal(renderTaskRail(emptyState(), NOW), '');
});

test('the rail: its name, a head per group in order, the fold that counts the lines waiting on you', () => {
  const h = renderTaskRail(state([task('r1'), task('d1', { state: 'done', group: 'done' }), task('f1', { state: 'failed', group: 'you' })]), NOW);
  assert.match(h, /^<aside class="tasks"/);
  assert.match(h, /<details class="tasks-fold" id="tasks-fold"><summary class="tasks-fold-key">Tasks under way · 1 waiting on you<\/summary><\/details>/);
  const heads = [...h.matchAll(/class="task-group-head">([^<]+)</g)].map(x => x[1]);
  assert.deepEqual(heads, ['Waiting on you', 'Running', 'Done today']);
  withTable(ZH, () => {
    const z = renderTaskRail(state([task('r1'), task('d1', { state: 'done', group: 'done' }), task('f1', { state: 'failed', group: 'you' })]), NOW);
    assert.deepEqual([...z.matchAll(/class="task-group-head">([^<]+)</g)].map(x => x[1]), ['等你', '进行中', '今天完成']);
    assert.match(z, /class="tasks-title">在办的事</);
    assert.match(z, /tasks-fold-key">在办的事 · 等你 1</);
  });
  const two = renderTaskRail(state([task('r1')]), NOW);
  assert.deepEqual([...two.matchAll(/class="task-group-head">([^<]+)</g)].map(x => x[1]), ['Running'], 'empty groups are left out');
});

test("a line's summary holds only the dot, the title, the status and the caret", () => {
  const h = renderTaskRail(state([task('t1', { steps: ['a', 'b'] })]), NOW);
  const summary = h.match(/<summary[^>]*data-task="t1"[^>]*>([\s\S]*?)<\/summary>/)[1];
  const parts = [...summary.matchAll(/<span class="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(parts, ['task-dot running', 'task-title', 'task-status', 'task-caret']);
  assert.match(summary, /task-title">Task t1</);
  assert.match(summary, /task-status">2 steps · 12 min</);
  assert.doesNotMatch(summary, /<button|<a /, 'no key inside the summary');
});

test('an expanded waiting line draws the card with its approve and reject keys', () => {
  const w = task('t1', { state: 'waiting', group: 'you', waitingFor: { kind: 'approval', id: 'c', tool: 'x' } });
  const s = R.hostGate(state([w], [conv('t1')]), { convId: 't1', message: { id: 'ev-1', seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Buy 1 NVDA', data: { eventId: 'ev-1', sessionId: 't1', title: 'Buy 1 NVDA', venue: 'paper' } } });
  const line = lineOf(renderTaskRail(s, NOW, { open: new Set(['t1']) }), 't1');
  assert.match(line, /^<details class="task-line" data-task="t1" open>/, 'open while the page holds it open');
  assert.match(line, /class="task-gate"><div class="card orange">/);
  assert.match(line, /data-action="answer" data-conv="t1" data-msg="ev-1" data-value="rejected"/);
  assert.match(line, /data-action="answer" data-conv="t1" data-msg="ev-1" data-value="allowed-once"/);
  assert.match(line, /task-status">Needs your approval</);
  const closed = lineOf(renderTaskRail(s, NOW), 't1');
  assert.match(closed, /^<details class="task-line" data-task="t1">/, 'closed unless the page holds it open');
});

test('a waiting card with a lesson applying offers no one-click approve on the rail: it points at the task, beside Decline', () => {
  const w = task('t1', { state: 'waiting', group: 'you', waitingFor: { kind: 'approval', id: 'c', tool: 'x' } });
  const s = R.hostGate(state([w], [conv('t1')]), { convId: 't1', message: { id: 'ev-1', seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Buy 1 NVDA', data: { eventId: 'ev-1', sessionId: 't1', callId: 'c1', title: 'Buy 1 NVDA', venue: 'paper' } } });
  const line = l => ({ order: 'buy 1 NVDA', considering: ['open'], positionRead: true, lessons: [], lessonsMore: 0, untold: [], untoldMore: 0, ...l });
  const at = (gate) => lineOf(renderTaskRail(R.memoryGateLoaded(s, { callId: 'c1', gate }), NOW, { open: new Set(['t1']) }), 't1');
  for (const strength of ['caveat', 'red-line']) {
    const lesson = { id: 'L-1', strength, says: strength === 'red-line' ? 'dont' : 'careful', words: 'Do not chase', fired: 1, followed: 0, overridden: 0 };
    const h = at({ callId: 'c1', state: 'checked', lines: [line({ lessons: [lesson] })], redLine: strength === 'red-line', overridden: false });
    assert.doesNotMatch(h, /allowed-once|aria-label="Approve"/, strength);
    assert.doesNotMatch(h, /overrideGate|data-field/, `${strength}: no form on the rail`);
    assert.match(h, /<a href="#\/task\/t1">A lesson applies - open the task<\/a>/, strength);
    assert.match(h, /data-action="answer" data-conv="t1" data-msg="ev-1" data-value="rejected"/, `${strength}: Decline`);
  }
  // only lessons counted past the drawn ones still apply
  assert.match(at({ callId: 'c1', state: 'checked', lines: [line({ lessonsMore: 1 })], redLine: false, overridden: false }), /A lesson applies - open the task/);
  // no lesson applying: the one-click keys as today
  for (const gate of [{ callId: 'c1', state: 'checked', lines: [line({ untold: [{ id: 'u', needs: ['market'] }] })], redLine: false, overridden: false }, { callId: 'c1', state: 'not connected', words: 'no memory here', lines: [], redLine: false, overridden: false }]) {
    const h = at(gate);
    assert.match(h, /data-value="rejected"[\s\S]*data-value="allowed-once"/);
    assert.doesNotMatch(h, /open the task/);
  }
  withTable(ZH, () => assert.match(lineOf(renderTaskRail(R.memoryGateLoaded(s, { callId: 'c1', gate: { callId: 'c1', state: 'checked', lines: [line({ lessonsMore: 1 })], redLine: false, overridden: false } }), NOW, { open: new Set(['t1']) }), 't1'), />有一条教训适用 - 打开任务<\/a>/));
});

test('a waiting line whose gate this page has not seen (after a reload) points at the full process', () => {
  const w = task('t1', { state: 'waiting', group: 'you', waitingFor: { kind: 'approval', id: 'c', tool: 'x' } });
  const line = lineOf(renderTaskRail(state([w], [conv('t1')]), NOW), 't1');
  assert.doesNotMatch(line, /class="task-gate"/, 'no gate to draw');
  assert.match(line, /<div class="task-gate-there">To answer it, open View the full process<\/div>/);
  withTable(ZH, () => assert.match(lineOf(renderTaskRail(state([w], [conv('t1')]), NOW), 't1'), /task-gate-there">要回答，请打开查看完整过程</));
  // once the gate is on the page, the card stands in its place
  const s = R.hostGate(state([w], [conv('t1')]), { convId: 't1', message: { id: 'ev-1', seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Buy 1 NVDA', data: { eventId: 'ev-1', sessionId: 't1', title: 'Buy 1 NVDA', venue: 'paper' } } });
  assert.doesNotMatch(lineOf(renderTaskRail(s, NOW), 't1'), /task-gate-there/);
  // a running task waits on nobody
  assert.doesNotMatch(lineOf(renderTaskRail(state([task('t2')]), NOW), 't2'), /task-gate-there/);
});

test('a question gate is answered on its line', () => {
  const w = task('t1', { state: 'waiting', group: 'you', waitingFor: { kind: 'question', id: 'c', tool: 'ask_user_question' } });
  const s = R.hostGate(state([w], [conv('t1')]), { convId: 't1', message: { id: 'ev-2', seq: 1.5, at: NOW, from: 'gravit', kind: 'question', text: '', data: { eventId: 'ev-2', sessionId: 't1', questions: [{ id: 'q1', question: 'Which venue?', options: [{ label: 'Paper' }] }] } } });
  const line = lineOf(renderTaskRail(s, NOW), 't1');
  assert.match(line, /data-gate="ev-2"/);
  assert.match(line, /data-action="answerQuestion" data-conv="t1" data-msg="ev-2"/);
});

test('an expanded line: its strategy, its steps newest last, its result, its usage and the full process', () => {
  const t = task('t1', { state: 'done', group: 'done', strategy: 'cn-market', steps: ['first', 'second'], result: { status: 'ready', text: 'Bought nothing' }, usage: { uncachedInputTokens: 1000, cacheReadTokens: 234, outputTokens: 56, cacheWriteTokens: 0, routes: [] } });
  const line = lineOf(renderTaskRail(state([t]), NOW), 't1');
  assert.match(line, /<a class="task-strategy-link" href="#\/strategy\/cn-market">cn-market<\/a>/);
  assert.match(line, /<ol class="task-steps"><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(line, /class="task-result">Bought nothing</);
  assert.match(line, /class="task-usage">1,234 tokens in · 56 out</);
  assert.match(line, /<a class="btn-sm" href="#\/task\/t1">View the full process<\/a>/);
  withTable(ZH, () => {
    const z = lineOf(renderTaskRail(state([t]), NOW), 't1');
    assert.match(z, /class="task-usage">输入 1,234 token · 输出 56 token</);
    assert.match(z, />查看完整过程<\/a>/);
    assert.match(z, /task-strategy-label">策略</);
  });
});

test('Stop and Continue follow the state', () => {
  const table = {
    running: [true, false], waiting: [true, false], stalled: [true, true], failed: [false, true], blocked: [false, true], done: [false, false], stopped: [false, false],
  };
  for (const [st, [stop, cont]] of Object.entries(table)) {
    const group = { running: 'running', done: 'done', stopped: 'done' }[st] ?? 'you';
    const keys = keysOf(lineOf(renderTaskRail(state([task('t1', { state: st, group })]), NOW), 't1'));
    assert.equal(/data-action="taskStop" data-task="t1"/.test(keys), stop, `${st}: Stop`);
    assert.equal(/data-action="taskResume" data-task="t1"/.test(keys), cont, `${st}: Continue`);
    assert.match(keys, /href="#\/task\/t1"/, `${st}: the full process, always`);
  }
  withTable(ZH, () => {
    const keys = keysOf(lineOf(renderTaskRail(state([task('t1', { state: 'stalled', group: 'you' })]), NOW), 't1'));
    assert.match(keys, /data-action="taskStop"[^>]*>停止</);
    assert.match(keys, /data-action="taskResume"[^>]*>继续</);
  });
});

test("a busy task's Stop is disabled", () => {
  const s = R.taskBusy(state([task('t1', { state: 'stalled', group: 'you' }), task('t2')]), { id: 't1', on: true });
  const h = renderTaskRail(s, NOW);
  assert.match(lineOf(h, 't1'), /<button type="button" class="btn-sm" data-action="taskStop" data-task="t1" disabled>/);
  assert.match(lineOf(h, 't1'), /data-action="taskResume" data-task="t1" disabled>/);
  assert.match(lineOf(h, 't2'), /data-action="taskStop" data-task="t2">/, 'another task stays pressable');
});

test('titles and steps are escaped', () => {
  const h = renderTaskRail(state([task('t1', { title: '<img src=x onerror=alert(1)>', steps: ['<b>bold</b>'], strategy: 'a"b' })]), NOW);
  assert.doesNotMatch(h, /<img|<b>/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(h, /href="#\/strategy\/a%22b"/);
});

// the desk keeps its own screen (desk-page plan 1 Task 6): the rail draws no desk line and no Scheduled group; a standing
// order's line is scheduledLineHtml's, for a strategy's page
const withDesk = (s, desk) => R.tasksLoaded(s, { conversation: 'conv', tasks: s.tasks.items, desk, at: NOW });
const ORDER = { order: 'brief', strategy: 'cn-market', next: '2026-11-09T20:30:00.000Z', last: { outcome: 'finished', t: '2026-11-08T20:31:00.000Z', sessionId: 'desk-1' }, enabled: true, expired: false };
const DESK_LINE = { id: 'annotation:p1', kind: 'annotation', title: 'NVDA', state: 'done', startedAt: '2026-11-09T19:00:00.000Z', endedAt: '2026-11-09T19:02:00.000Z', sessionId: 'desk-9', text: 'NVDA fell on <guidance>' };

test('the rail draws no desk line and no Scheduled group', () => {
  const desk = { scheduled: [ORDER], lines: [DESK_LINE] };
  assert.equal(renderTaskRail(withDesk(state([]), desk), NOW, { open: new Set(['order:brief', 'desk:annotation:p1']) }), '', 'only the desk: no rail');
  const h = renderTaskRail(withDesk(state([task('t1')]), desk), NOW);
  assert.deepEqual([...h.matchAll(/class="task-group-head">([^<]+)</g)].map(x => x[1]), ['Running']);
  assert.doesNotMatch(h, /Scheduled|data-task="order:|data-task="desk:|NVDA fell/);
  withTable(ZH, () => assert.doesNotMatch(renderTaskRail(withDesk(state([task('t1')]), desk), NOW), /定时/));
});

test('a scheduled line draws no button', () => {
  const s = withDesk(state([]), { scheduled: [ORDER], lines: [] });
  const line = scheduledLineHtml(scheduledOf(s, NOW)[0], NOW, new Set(['order:brief']));
  assert.match(line, /<details class="task-line" data-task="order:brief" open>/);
  assert.match(line, /task-title">brief</);
  assert.doesNotMatch(line, /<button/);
  assert.match(line, /href="#\/strategy\/cn-market"/);
  assert.match(line, /href="#\/history\/desk-1"/, 'its last session, in History');
  assert.match(line, /Last Finished/i);
  const off = scheduledLineHtml(scheduledOf(withDesk(state([]), { scheduled: [{ order: 'brief', enabled: false, expired: false }], lines: [] }), NOW)[0], NOW, null);
  assert.match(off, /task-dot stopped/);
  assert.doesNotMatch(off, /history/, 'no session: no link');
});

test("a scheduled line's next time is drawn in New York time", () => {
  const s = withDesk(state([]), { scheduled: [{ order: 'brief', next: '2026-11-09T20:30:00.000Z', enabled: true, expired: false }], lines: [] });
  const status = scheduledLineHtml(scheduledOf(s, NOW)[0], NOW, null).match(/task-status">([^<]*)</)[1];
  assert.match(status, /15:30 ET$/, '20:30 UTC is 15:30 in New York in November');
  withTable(ZH, () => assert.match(scheduledLineHtml(scheduledOf(s, NOW)[0], NOW, null), /task-status">下次 (?:\S+ )?15:30 ET</));
});

test('a phone task names its origin', () => {
  const h = renderTaskRail(state([task('p1', { origin: 'phone', network: 'slack' }), task('w1')]), NOW);
  assert.match(lineOf(h, 'p1'), /class="task-origin">Phone · Slack</);
  assert.doesNotMatch(lineOf(h, 'w1'), /task-origin/);
  withTable(ZH, () => assert.match(lineOf(renderTaskRail(state([task('p1', { origin: 'phone', network: 'telegram' })]), NOW), 'p1'), /class="task-origin">手机 · Telegram</));
});

test("a bot task's rail line shows the bot before its title; a gravit task's none", () => {
  const h = renderTaskRail(state([task('b1', { title: 'Argue the bull case', bot: 'drill-bull' }), task('g1')]), NOW);
  const summary = lineOf(h, 'b1').match(/<summary[\s\S]*?<\/summary>/)[0];
  assert.match(summary, /<span class="task-dot running"><\/span><span class="task-bot">drill-bull<\/span><span class="task-title">Argue the bull case<\/span>/);
  assert.doesNotMatch(lineOf(h, 'g1'), /task-bot/);
  assert.match(renderTaskRail(state([task('x', { bot: '<b>' })]), NOW), /task-bot">&lt;b&gt;</, 'the bot id is escaped');
});

test('the gravit box draws a waiting card as the rail does: a lesson applying sends the owner to the task, no one-click approve', () => {
  const w = task('t1', { state: 'waiting', group: 'you', waitingFor: { kind: 'approval', id: 'c', tool: 'x' } });
  const s = R.hostGate(state([w], [conv('t1')]), { convId: 't1', message: { id: 'ev-1', seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Buy 1 NVDA', data: { eventId: 'ev-1', sessionId: 't1', callId: 'c1', title: 'Buy 1 NVDA', venue: 'paper' } } });
  const lesson = { id: 'L-1', strength: 'caveat', says: 'careful', words: 'Do not chase', fired: 1, followed: 0, overridden: 0 };
  const gate = { callId: 'c1', state: 'checked', lines: [{ order: 'buy 1 NVDA', considering: ['open'], positionRead: true, lessons: [lesson], lessonsMore: 0, untold: [], untoldMore: 0 }], redLine: false, overridden: false };
  const kept = R.memoryGateLoaded(s, { callId: 'c1', gate });
  const [line] = railOf(kept, NOW).you;
  const h = waitingLineHtml(line, kept);
  assert.doesNotMatch(h, /allowed-once/);
  assert.match(h, /<a href="#\/task\/t1">A lesson applies - open the task<\/a>/);
  assert.match(waitingLineHtml(railOf(s, NOW).you[0], s), /data-value="allowed-once"/, 'no lesson kept: the one-click keys');
});
