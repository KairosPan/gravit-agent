// The Desk page's routines (desk-page plan 2 Task 7): /data/desk/routines into the store's deskPage slice, at once and every
// DESK_ROUTINES_POLL_MS while the Desk shows, against recording timers, a recording getJson and postJson; the switch, Test
// and Delete posts, each read again after it answers; Running… from Test's click until a read asked after the face queued
// it holds no test of the routine; a refused act's line under its row; and the slice's reducers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startDeskRoutines, DESK_ROUTINES_POLL_MS } from '../../client/js/host/desk-routines.js';
import { sayOf } from '../../client/js/i18n/words.js';
import { deskRoutines } from './helpers/desk-news.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const refusal = (status, error) => Object.assign(new Error(error), { status, code: error });

function rig({ answer = deskRoutines({ running: undefined }) } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const posted = [];
  const answers = { routines: answer, post: { ok: true } };
  const getJson = path => {
    reads.push(path);
    const a = answers.routines;
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(typeof a === 'function' ? a() : a);
  };
  const postJson = (path, body) => {
    posted.push([path, body]);
    const a = typeof answers.post === 'function' ? answers.post(path, body) : answers.post;
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  };
  let id = 0;
  const timers = new Map();
  const schedule = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const cancelTimer = t => { timers.delete(t); };
  const clock = { t: 1000 };
  const fire = () => { clock.t += DESK_ROUTINES_POLL_MS; const due = [...timers.values()]; timers.clear(); for (const t of due) t.fn(); };
  const dr = startDeskRoutines({ store, getJson, postJson, schedule, cancelTimer, now: () => clock.t });
  return { store, dr, reads, posted, answers, timers, clock, fire, s: () => store.get().deskPage };
}

test('the slice starts with no routines read, no row open, nothing asked, busy or said', () => {
  const p = emptyState().deskPage;
  assert.deepEqual(p.routines, { status: 'idle', data: null, at: null, message: null });
  assert.deepEqual([p.rOpen, p.rAsk, p.rBusy, p.rSaid], ['', '', {}, {}]);
  assert.equal(DESK_ROUTINES_POLL_MS, 15_000);
});

test('the routines are read at once and every 15 s while the Desk shows; a failed read keeps them and says why', async () => {
  const r = rig();
  r.dr.show(true);
  assert.deepEqual(r.reads, ['/data/desk/routines']);
  await settle();
  assert.equal(r.s().routines.status, 'ready');
  assert.equal(r.s().routines.data.routines.length, 2);
  assert.deepEqual([...r.timers.values()].map(x => x.ms), [DESK_ROUTINES_POLL_MS]);
  r.answers.routines = new Error('HTTP 502');
  r.fire();
  await settle();
  assert.equal(r.s().routines.status, 'error');
  assert.equal(r.s().routines.message, 'HTTP 502');
  assert.equal(r.s().routines.data.routines.length, 2, 'the routines it had are kept');
  r.dr.show(false);
  assert.equal(r.timers.size, 0, 'hidden: the poll stops');
  r.answers.routines = { ok: false, error: 'boom' };
  r.clock.t += 60_000;
  r.dr.show(true);
  await settle();
  assert.equal(r.s().routines.message, 'boom');
  r.answers.routines = { nothing: true };
  r.clock.t += 60_000;
  r.dr.show(false); r.dr.show(true);
  await settle();
  assert.equal(sayOf(r.s().routines.message), 'not the routines');
});

test('the switch posts { id, enabled } and reads the routines again', async () => {
  const r = rig();
  await r.dr.switchOne('close-recap', true);
  await settle();
  assert.deepEqual(r.posted, [['/data/desk/routines/switch', { id: 'close-recap', enabled: true }]]);
  assert.deepEqual(r.reads, ['/data/desk/routines'], 'read again after it answers');
  await r.dr.switchOne('idea-screening', false);
  assert.deepEqual(r.posted[1], ['/data/desk/routines/switch', { id: 'idea-screening', enabled: false }]);
});

test('Test reads Running… from the click until a read asked after the face queued it holds no test of that routine', async () => {
  const r = rig();
  const queued = deskRoutines({ running: undefined, queued: ['idea-screening:test:2026-11-02T15:00:00.000Z'] });
  const running = deskRoutines({ running: 'idea-screening:test:2026-11-02T15:00:00.000Z' });
  const ended = deskRoutines({ running: undefined });
  let release;
  r.answers.post = () => new Promise(res => { release = () => res({ ok: true, result: 'queued' }); });
  r.answers.routines = queued;
  const done = r.dr.test('idea-screening');
  assert.deepEqual(r.s().rBusy, { 'idea-screening': 'test' }, 'Running… at the click');
  void r.dr.test('idea-screening');
  assert.equal(r.posted.length, 1, 'a second click while it runs posts nothing');
  assert.deepEqual(r.posted[0], ['/data/desk/routines/test', { id: 'idea-screening' }]);
  // a poll read asked before the face answered settles nothing, even with no test in it
  r.answers.routines = ended;
  r.dr.show(true);
  release();
  await done;
  await settle();
  assert.deepEqual(r.s().rBusy, {}, 'the read asked after the answer holds no test: it ended');
  // and the same while the read shows it queued, then running
  r.answers.post = { ok: true, result: 'queued' };
  r.answers.routines = queued;
  await r.dr.test('idea-screening');
  await settle();
  assert.deepEqual(r.s().rBusy, { 'idea-screening': 'test' }, 'queued: still Running…');
  r.answers.routines = running;
  r.fire();
  await settle();
  assert.deepEqual(r.s().rBusy, { 'idea-screening': 'test' }, 'running: still Running…');
  r.answers.routines = ended;
  r.fire();
  await settle();
  assert.deepEqual(r.s().rBusy, {}, 'ended');
});

test("a refused Test or switch is one line under its row - the desk paused, the cap spent, else the request failed - and the next act clears it", async () => {
  const r = rig();
  r.answers.post = refusal(409, 'paused');
  await r.dr.test('idea-screening');
  assert.deepEqual(r.s().rBusy, {}, 'no Running… after a refusal');
  assert.equal(sayOf(r.s().rSaid['idea-screening']), 'The desk is paused');
  assert.deepEqual(r.reads, [], 'nothing read after a refusal');
  r.answers.post = refusal(409, 'cap');
  await r.dr.test('idea-screening');
  assert.equal(sayOf(r.s().rSaid['idea-screening']), 'The daily cap is spent');
  r.answers.post = Object.assign(new Error('x'), { status: 409, body: { ok: false, error: 'paused' } });
  await r.dr.switchOne('idea-screening', false);
  assert.equal(sayOf(r.s().rSaid['idea-screening']), 'The desk is paused', 'a body carried on the error is read too');
  r.answers.post = refusal(404, 'unknown');
  await r.dr.remove('close-recap');
  assert.equal(sayOf(r.s().rSaid['close-recap']), 'request failed');
  r.answers.post = { ok: true };
  await r.dr.switchOne('idea-screening', true);
  assert.equal(r.s().rSaid['idea-screening'], undefined, 'the next act clears the line');
});

test('Delete posts { id }, closes the question and reads the routines again', async () => {
  const r = rig();
  r.store.dispatch('deskRoutineOpen', { id: 'close-recap' });
  r.store.dispatch('deskRoutineAsk', { id: 'close-recap' });
  await r.dr.remove('close-recap');
  await settle();
  assert.deepEqual(r.posted, [['/data/desk/routines/delete', { id: 'close-recap' }]]);
  assert.equal(r.s().rAsk, '');
  assert.deepEqual(r.reads, ['/data/desk/routines']);
  r.dr.dispose();
  await r.dr.remove('idea-screening');
  assert.equal(r.posted.length, 1, 'nothing after dispose');
});

test('Delete clears its question before the post, and a second Delete of an id in flight posts nothing', async () => {
  const r = rig();
  let answer;
  r.answers.post = () => new Promise(done => { answer = done; });
  r.store.dispatch('deskRoutineAsk', { id: 'close-recap' });
  const first = r.dr.remove('close-recap');
  assert.equal(r.s().rAsk, '', 'the question goes at the click');
  const second = r.dr.remove('close-recap');
  assert.deepEqual(r.posted, [['/data/desk/routines/delete', { id: 'close-recap' }]], 'one post for a double click');
  answer({ ok: true });
  await Promise.all([first, second]);
  await settle();
  r.answers.post = { ok: true };
  await r.dr.remove('close-recap');
  assert.equal(r.posted.length, 2, 'once answered, a Delete posts again');
});

test('a routines read drops the open row, the delete question, the busy and the said line of an id it no longer holds', () => {
  let s = emptyState();
  for (const id of ['close-recap', 'gone']) {
    s = reducers.deskRoutineBusy(s, { id, what: 'test' });
    s = reducers.deskRoutineSaid(s, { id, message: 'no' });
  }
  s = reducers.deskRoutineAsk(reducers.deskRoutineOpen(s, { id: 'gone' }), { id: 'gone' });
  const held = deskRoutines();
  const loaded = reducers.deskRoutinesLoaded(s, { data: held, at: 5 }).deskPage;
  assert.deepEqual([loaded.rOpen, loaded.rAsk], ['', '']);
  assert.deepEqual(loaded.rBusy, { 'close-recap': 'test' });
  assert.deepEqual(loaded.rSaid, { 'close-recap': 'no' });
  const kept = reducers.deskRoutinesLoaded(reducers.deskRoutineOpen(s, { id: 'close-recap' }), { data: held, at: 5 }).deskPage;
  assert.equal(kept.rOpen, 'close-recap', 'a row the read holds stays open');
  const unreadable = reducers.deskRoutinesLoaded(s, { data: deskRoutines({ load: { ok: false, error: 'x' }, routines: [] }), at: 5 }).deskPage;
  assert.deepEqual([unreadable.rOpen, unreadable.rSaid], ['gone', s.deskPage.rSaid], 'a store that cannot be read says nothing of which routines are gone');
});

test('the reducers: a row opened and closed, its delete question with it; busy and said by id', () => {
  let s = emptyState();
  s = reducers.deskRoutineOpen(s, { id: 'a' });
  assert.equal(s.deskPage.rOpen, 'a');
  s = reducers.deskRoutineAsk(s, { id: 'a' });
  assert.equal(s.deskPage.rAsk, 'a');
  s = reducers.deskRoutineOpen(s, { id: 'a' });
  assert.deepEqual([s.deskPage.rOpen, s.deskPage.rAsk], ['', ''], 'closed, and its question with it');
  s = reducers.deskRoutineAsk(reducers.deskRoutineOpen(s, { id: 'b' }), { id: 'b' });
  assert.equal(reducers.deskRoutineAskOff(s).deskPage.rAsk, '');
  assert.equal(reducers.deskRoutineOpen(s, { id: '' }), s, 'no id: no change');
  s = reducers.deskRoutineBusy(s, { id: 'a', what: 'test' });
  assert.deepEqual(s.deskPage.rBusy, { a: 'test' });
  assert.deepEqual(reducers.deskRoutineBusy(s, { id: 'a', what: null }).deskPage.rBusy, {});
  s = reducers.deskRoutineSaid(s, { id: 'a', message: 'no' });
  assert.deepEqual(s.deskPage.rSaid, { a: 'no' });
  assert.deepEqual(reducers.deskRoutineSaid(s, { id: 'a' }).deskPage.rSaid, {});
  const loaded = reducers.deskRoutinesLoaded(s, { data: { ok: true }, at: 5 });
  assert.deepEqual(loaded.deskPage.routines, { status: 'ready', data: { ok: true }, at: 5, message: null });
  assert.equal(loaded.deskPage.status, 'idle', "the news' own status untouched");
});
