// The Desk page's read (desk-page plan 1 Task 3): /data/desk/news into the store's deskPage slice, at once and every
// DESK_NEWS_POLL_MS while the Desk shows in a visible tab, against recording timers and a recording getJson; and the slice's
// three UI reducers, which change only their own fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startDeskNews, DESK_NEWS_POLL_MS } from '../../client/js/host/desk-news.js';
import { renderDeskScreen } from '../../client/js/render/desk-page.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const news = (over = {}) => ({ ok: true, date: '2026-11-13', today: true, sources: [], alerts: [], reports: [], rules: [], levels: 0, ...over });

function rig({ answer = news() } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const answers = { news: answer };
  const getJson = path => {
    reads.push(path);
    const a = answers.news;
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(typeof a === 'function' ? a() : a);
  };
  let id = 0;
  const timers = new Map();
  const schedule = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const cancelTimer = t => { timers.delete(t); };
  const clock = { t: 1000 };
  const fire = () => { clock.t += DESK_NEWS_POLL_MS; const due = [...timers.values()]; timers.clear(); for (const t of due) t.fn(); };
  const dn = startDeskNews({ store, getJson, schedule, cancelTimer, now: () => clock.t });
  return { store, dn, reads, answers, timers, fire, clock, s: () => store.get().deskPage };
}

test('the deskPage slice starts idle, on All, nothing open, the rules folded', () => {
  assert.deepEqual(emptyState().deskPage, { status: 'idle', data: null, at: null, message: null, filter: 'all', open: {}, rules: false,
    routines: { status: 'idle', data: null, at: null, message: null }, rOpen: '', rAsk: '', rBusy: {}, rSaid: {}, pSaid: {}, pBusy: {} });
  assert.equal(DESK_NEWS_POLL_MS, 15_000);
});

test('the news is read at once and every 15 s while the Desk shows, and stops when it hides', async () => {
  const r = rig();
  assert.deepEqual(r.reads, [], 'nothing before the Desk shows');
  r.dn.show(true);
  assert.deepEqual(r.reads, ['/data/desk/news']);
  assert.equal(r.s().status, 'loading');
  await settle();
  assert.equal(r.s().status, 'ready');
  assert.equal(r.s().data.date, '2026-11-13', 'the body as the face answered it');
  assert.equal(r.s().at, 1000);
  assert.deepEqual([...r.timers.values()].map(x => x.ms), [DESK_NEWS_POLL_MS]);
  r.dn.show(true);
  assert.equal(r.reads.length, 1, 'shown again while shown reads nothing more');
  r.fire(); await settle();
  assert.equal(r.reads.length, 2, 'the poll reads once more');
  assert.equal(r.timers.size, 1, 'and arms again');
  r.dn.show(false);
  assert.equal(r.timers.size, 0, 'hidden: the poll is cancelled');
  // shown again inside the poll: the read waits for the poll's turn
  r.clock.t += 5_000;
  r.dn.show(true);
  assert.equal(r.reads.length, 2, 'not read twice inside the poll');
  assert.deepEqual([...r.timers.values()].map(x => x.ms), [DESK_NEWS_POLL_MS - 5_000]);
  r.dn.show(false);
  r.clock.t += 60_000;
  r.dn.show(true);
  assert.equal(r.reads.length, 3, 'back after a while: at once');
  r.dn.dispose();
  assert.equal(r.timers.size, 0);
  r.dn.show(true);
  assert.equal(r.reads.length, 3, 'nothing after dispose');
});

test('one read in flight at a time', async () => {
  let release;
  const r = rig({ answer: () => new Promise(res => { release = () => res(news()); }) });
  r.dn.show(true);
  r.fire();
  assert.equal(r.reads.length, 1);
  release(); await settle();
  assert.equal(r.s().status, 'ready');
});

test('a failed read keeps the last data with its message; a body that is not the news is a failure too', async () => {
  const r = rig();
  r.dn.show(true); await settle();
  r.answers.news = new Error('/data/desk/news: HTTP 503');
  r.fire(); await settle();
  assert.equal(r.s().status, 'error');
  assert.equal(r.s().message, '/data/desk/news: HTTP 503');
  assert.equal(r.s().data.date, '2026-11-13', 'the last data stays');
  r.answers.news = { ok: false, error: 'forbidden' };
  r.fire(); await settle();
  assert.equal(r.s().message, 'forbidden');
  assert.equal(r.s().data.date, '2026-11-13');
  r.answers.news = news({ date: '2026-11-14' });
  r.fire(); await settle();
  assert.equal(r.s().status, 'ready');
  assert.equal(r.s().message, null, 'an answer clears the sentence');
  assert.equal(r.s().data.date, '2026-11-14');
});

test('the three UI reducers change only their own fields', () => {
  const loaded = reducers.deskNewsLoaded(emptyState(), { data: news(), at: 5 });
  const before = loaded.deskPage;
  const f = reducers.deskFilter(loaded, { value: 'NVDA' });
  assert.deepEqual(f.deskPage, { ...before, filter: 'NVDA' });
  const o = reducers.deskToggle(loaded, { id: 'a1' });
  assert.deepEqual(o.deskPage, { ...before, open: { a1: true } });
  assert.deepEqual(reducers.deskToggle(o, { id: 'a1' }).deskPage.open, { a1: false }, 'a second toggle folds it');
  assert.deepEqual(reducers.deskToggle(o, { id: 'a2' }).deskPage.open, { a1: true, a2: true });
  const k = reducers.deskRules(loaded);
  assert.deepEqual(k.deskPage, { ...before, rules: true });
  assert.equal(reducers.deskRules(k).deskPage.rules, false);
  for (const s of [f, o, k]) assert.equal(s.desk, loaded.desk, 'the status slice untouched');
  // a failure and a read on its way keep the UI fields
  const failed = reducers.deskNewsFailed(f, { at: 6, message: 'x' });
  assert.deepEqual(failed.deskPage, { ...f.deskPage, status: 'error', at: 6, message: 'x' });
  assert.equal(reducers.deskNewsLoading(failed).deskPage.message, 'x', 'the sentence stays while a read is on its way');
});

test('the Desk page before the desk status is read: its title and Loading…, no columns', () => {
  const html = renderDeskScreen(emptyState(), 0);
  assert.match(html, /^<main class="main dk"><header class="head">.*<h1 class="head-title">Desk<\/h1>/);
  assert.match(html, /Loading…/);
  assert.doesNotMatch(html, /dk-cols/);
});
