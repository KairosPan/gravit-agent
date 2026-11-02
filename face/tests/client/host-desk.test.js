// The Desk host layer (plan 2026-11-01-desk-p3-watch Task 11): /data/desk/status read at once and every 10 s while Markets
// shows — any tab, a market's page among them, so the level marks on the rows stay fresh — and the page's one write, Pause,
// against recording timers, a recording getJson and postJson.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startDesk } from '../../client/js/host/desk.js';
import { DESK_POLL_MS } from '../../client/js/host/desk-view.js';
import { deskStatus } from './helpers/desk-status.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

function rig({ status = deskStatus(), pause = { ok: true, off: { setAt: '2026-11-02T15:00:00.000Z', by: 'page' } } } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const posts = [];
  const answers = { status, pause };
  const getJson = path => {
    reads.push(path);
    const a = answers.status;
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(typeof a === 'function' ? a() : a);
  };
  const postJson = (path, body) => {
    posts.push([path, body]);
    const a = answers.pause;
    // as the face does: a pause written is in the status read after it
    if (!(a instanceof Error) && answers.status && !(answers.status instanceof Error)) answers.status = { ...deskStatus(), off: a.off };
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  };
  // recording timers: fire() runs the due ones by hand
  let id = 0;
  const timers = new Map();
  const schedule = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const cancelTimer = t => { timers.delete(t); };
  const fire = () => { const due = [...timers.entries()]; timers.clear(); for (const [, t] of due) t.fn(); };
  const clock = { t: 1000 };
  const desk = startDesk({ store, getJson, postJson, schedule, cancelTimer, now: () => clock.t });
  // fire() also moves the clock on by the poll, as the timer it runs would have
  const tickPoll = () => { clock.t += DESK_POLL_MS; fire(); };
  return { store, desk, reads, posts, answers, timers, fire: tickPoll, clock, s: () => store.get().desk };
}

test('the desk slice starts idle with nothing read', () => {
  assert.deepEqual(emptyState().desk, { status: 'idle', data: null, at: null, message: null });
});

test('the desk status is read at once and every 10 s while Markets shows, and stops when it leaves', async () => {
  const r = rig();
  assert.deepEqual(r.reads, [], 'nothing before Markets shows');
  // Markets on screen on the Stocks tab: the Desk tab never visited
  r.store.dispatch('nav', { screen: 'markets', id: null });
  r.store.dispatch('setMarketsTab', 'stocks');
  r.desk.show(true);
  assert.deepEqual(r.reads, ['/data/desk/status']);
  assert.equal(r.s().status, 'loading');
  await settle();
  assert.equal(r.s().status, 'ready');
  assert.equal(r.s().data.watch.state, 'watching');
  assert.equal(r.s().at, 1000);
  assert.deepEqual([...r.timers.values()].map(x => x.ms), [DESK_POLL_MS]);
  r.desk.show(true);
  assert.equal(r.reads.length, 1, 'shown again while shown reads nothing more');
  r.fire(); await settle();
  assert.equal(r.reads.length, 2, '+10 s: read again');
  assert.equal(r.timers.size, 1, 'and armed again');
  // a market's page is Markets shown too
  r.store.dispatch('nav', { screen: 'markets', id: 'stock:NVDA' });
  r.fire(); await settle();
  assert.equal(r.reads.length, 3);
  r.desk.show(false);
  assert.equal(r.timers.size, 0, 'leaving Markets cancels the poll');
  // back within the poll (a tab hidden a moment): no second read now, only at the poll's turn — what remains of it
  r.clock.t += 4_200;
  r.desk.show(true);
  assert.equal(r.reads.length, 3, 'shown again 4.2 s after a read: not read twice');
  assert.deepEqual([...r.timers.values()].map(x => x.ms), [DESK_POLL_MS - 4_200]);
  r.fire(); await settle();
  assert.equal(r.reads.length, 4, 'read at the poll\'s turn');
  assert.deepEqual([...r.timers.values()].map(x => x.ms), [DESK_POLL_MS], 'then every 10 s');
  // back after a while away: at once again
  r.desk.show(false);
  r.clock.t += 60_000;
  r.desk.show(true);
  assert.equal(r.reads.length, 5);
  r.desk.dispose();
  assert.equal(r.timers.size, 0);
  r.clock.t += 60_000;
  r.desk.show(true);
  assert.equal(r.reads.length, 5, 'nothing after dispose');
});

test('one read in flight at a time: a tick while one is out asks nothing', async () => {
  let release;
  const r = rig({ status: () => new Promise(res => { release = () => res(deskStatus()); }) });
  r.desk.show(true);
  r.fire();
  assert.equal(r.reads.length, 1);
  release(); await settle();
  assert.equal(r.s().status, 'ready');
});

test('Pause posts once and reads the status again; a failed read keeps the last view with its message', async () => {
  const r = rig();
  r.desk.show(true); await settle();
  const before = r.reads.length;
  const a = r.desk.pause(); const b = r.desk.pause();
  await Promise.all([a, b]); await settle();
  assert.deepEqual(r.posts, [['/data/desk/pause', {}]], 'one post, with no until: paused until a terminal resumes');
  assert.equal(r.reads.length, before + 1, 'then the status is read again');
  assert.equal(r.s().data.off.by, 'page');
  // the pause's answer lands over the status kept, before the read confirms it; with no status kept, nothing to land on
  const landed = reducers.pauseAnswered(reducers.deskLoaded(emptyState(), { data: deskStatus(), at: 1 }), { off: { setAt: 'x', by: 'page' } });
  assert.deepEqual(landed.desk.data.off, { setAt: 'x', by: 'page' });
  assert.equal(reducers.pauseAnswered(emptyState(), { off: { setAt: 'x', by: 'page' } }).desk.data, null);
  // a read that fails keeps the view it had, with its message
  r.answers.status = new Error('/data/desk/status: HTTP 503');
  r.fire(); await settle();
  assert.equal(r.s().status, 'error');
  assert.equal(r.s().message, '/data/desk/status: HTTP 503');
  assert.equal(r.s().data.watch.state, 'watching', 'the last view stays');
  // a body that is not the status is a failure too
  r.answers.status = { ok: false, error: 'forbidden' };
  r.fire(); await settle();
  assert.equal(r.s().status, 'error');
  assert.equal(r.s().data.watch.state, 'watching');
  // a refused pause says so and reads nothing
  r.answers.pause = Object.assign(new Error('request failed'), { status: 500 });
  r.answers.status = deskStatus();
  const n = r.reads.length;
  await r.desk.pause(); await settle();
  assert.equal(r.s().message, 'Pause failed: request failed');
  assert.equal(r.reads.length, n);
});

test('a persistent failure stays said through the polls on their way: the message is kept while loading, cleared by an answer', async () => {
  const { renderDeskTab } = await import('../../client/js/render/desk.js');
  const { deskViewOf } = await import('../../client/js/host/desk-view.js');
  let release;
  const r = rig();
  r.desk.show(true); await settle();
  r.answers.status = new Error('/data/desk/status: HTTP 503');
  r.fire(); await settle();
  r.answers.status = () => new Promise(res => { release = res; });
  r.fire();
  assert.equal(r.s().status, 'loading');
  assert.equal(r.s().message, '/data/desk/status: HTTP 503', 'the read on its way keeps the sentence');
  const html = renderDeskTab(deskViewOf(r.s().data, new Date(r.clock.t).toISOString()), r.s());
  assert.match(html, /<p class="mk-note">\/data\/desk\/status: HTTP 503<\/p>/, 'and the tab still says it');
  release(deskStatus()); await settle();
  assert.equal(r.s().message, null);
  // with no view kept: unavailable, said through a poll on its way too
  assert.match(renderDeskTab(null, { status: 'loading', message: 'HTTP 503' }), /HTTP 503[\s\S]*Desk status unavailable/);
});
