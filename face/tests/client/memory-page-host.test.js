// The Memory screen's reads (memory screen plan Task 2): the open tab's read and the waiting read (the tab's count) into the
// store's memoryPage slice, at once and every MEMORY_POLL_MS while the screen shows in a visible tab, against recording timers
// and a recording getJson; one read of a path in flight at a time; a failed read keeps the data it had; the decisions read
// carries the symbol the slice holds; and the slice's reducers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startMemoryPage, MEMORY_POLL_MS, PATH_OF_READ } from '../../client/js/host/memory-page.js';
import { sayOf } from '../../client/js/i18n/words.js';
import { memoryLessons, memoryDecisions, memoryWaiting, memoryHealth, memoryProposals } from './helpers/memory-page.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const READ = { status: 'idle', data: null, at: null, message: null, why: null };
const LESSONS = '/data/memory/lessons';
const REVIEW = '/data/memory/review';

function rig() {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const answers = {
    [LESSONS]: memoryLessons(), '/data/memory/decisions': memoryDecisions(), [REVIEW]: memoryWaiting({ proposals: memoryProposals() }), '/data/memory/status': memoryHealth(),
  };
  const getJson = path => {
    reads.push(path);
    const a = answers[path.split('?')[0]];
    if (typeof a === 'function') return a();
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  };
  let id = 0;
  const timers = new Map();
  const schedule = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const cancelTimer = t => { timers.delete(t); };
  const clock = { t: 1000 };
  const fire = () => { clock.t += MEMORY_POLL_MS; const due = [...timers.values()]; timers.clear(); for (const t of due) t.fn(); };
  const mp = startMemoryPage({ store, getJson, schedule, cancelTimer, now: () => clock.t });
  return { store, mp, reads, answers, timers, fire, clock, s: () => store.get().memoryPage };
}

test('the memoryPage slice starts idle: four reads unread, nothing open, no symbol, the newest decisions', () => {
  assert.deepEqual(emptyState().memoryPage, { lessons: READ, decisions: READ, waiting: READ, health: READ, open: {}, diff: {}, symbol: '', before: '' });
  assert.equal(MEMORY_POLL_MS, 20_000);
  assert.deepEqual(PATH_OF_READ, { lessons: '/data/memory/lessons', decisions: '/data/memory/decisions', waiting: '/data/memory/review', health: '/data/memory/status' });
});

test('shown on Lessons: the lessons and the waiting read at once and every 20 s; hidden: neither', async () => {
  const r = rig();
  assert.deepEqual(r.reads, [], 'nothing before the screen shows');
  r.mp.show(false, 'lessons');
  assert.deepEqual(r.reads, [], 'nor while it is not shown');
  r.mp.show(true, 'lessons');
  assert.deepEqual(r.reads.sort(), [LESSONS, REVIEW]);
  assert.equal(r.s().lessons.status, 'loading');
  await settle();
  assert.equal(r.s().lessons.status, 'ready');
  assert.deepEqual(r.s().lessons.data, memoryLessons(), 'the body as the face answered it');
  assert.equal(r.s().lessons.at, 1000);
  assert.equal(r.s().waiting.data.proposals.length, 2);
  assert.equal(r.s().decisions.status, 'idle', 'another tab is not read');
  assert.deepEqual([...r.timers.values()].map(x => x.ms), [MEMORY_POLL_MS]);
  r.mp.show(true, 'lessons');
  assert.equal(r.reads.length, 2, 'shown again on the same tab reads nothing more');
  r.fire(); await settle();
  assert.deepEqual(r.reads.slice(2).sort(), [LESSONS, REVIEW], 'the poll reads both once more');
  assert.equal(r.timers.size, 1, 'and arms again');
  r.mp.show(false);
  assert.equal(r.timers.size, 0, 'hidden: the poll is cancelled');
  r.mp.show(true, 'lessons');
  assert.equal(r.reads.length, 6, 'shown again: at once');
  r.mp.dispose();
  assert.equal(r.timers.size, 0);
  r.mp.show(true, 'health');
  assert.equal(r.reads.length, 6, 'nothing after dispose');
});

test("another tab reads its own path at once and the old one is no longer polled; on Waiting one read serves the tab and its count", async () => {
  const r = rig();
  r.mp.show(true, 'lessons');
  await settle();
  r.mp.show(true, 'health');
  assert.deepEqual(r.reads.slice(2).sort(), ['/data/memory/review', '/data/memory/status']);
  await settle();
  assert.equal(r.timers.size, 1, 'one poll');
  r.fire(); await settle();
  assert.deepEqual(r.reads.slice(4).sort(), ['/data/memory/review', '/data/memory/status'], 'the poll reads the new tab, not Lessons');
  r.mp.show(true, 'waiting');
  assert.deepEqual(r.reads.slice(6), [REVIEW], 'Waiting: the review read alone');
  await settle();
  r.fire(); await settle();
  assert.deepEqual(r.reads.slice(7), [REVIEW], 'once a tick');
  r.mp.show(true, 'nowhere');
  assert.deepEqual(r.reads.slice(8).sort(), [LESSONS, REVIEW], 'an unknown tab is Lessons');
  r.mp.dispose();
});

test('one read of a path in flight at a time', async () => {
  const r = rig();
  let release;
  r.answers[LESSONS] = () => new Promise(res => { release = () => res(memoryLessons()); });
  r.mp.show(true, 'lessons');
  r.fire();
  assert.equal(r.reads.filter(p => p === LESSONS).length, 1, 'the poll does not ask while the first is out');
  release(); await settle();
  assert.equal(r.s().lessons.status, 'ready');
  r.fire(); await settle();
  assert.equal(r.reads.filter(p => p === LESSONS).length, 2, 'asked again once it answered');
  r.mp.dispose();
});

test('a failed read keeps the data it had, with its words; the next answer replaces the line', async () => {
  const r = rig();
  r.mp.show(true, 'lessons');
  await settle();
  const kept = r.s().lessons.data;
  r.answers[LESSONS] = Object.assign(new Error('/data/memory/lessons: HTTP 504'), { status: 504, body: { ok: false, error: 'the memory did not answer in time' } });
  r.fire(); await settle();
  assert.equal(r.s().lessons.status, 'error');
  assert.equal(sayOf(r.s().lessons.message), 'the memory did not answer in time', "the route's own words");
  assert.deepEqual(r.s().lessons.data, kept, 'the data it had');
  assert.equal(r.s().lessons.why, null, 'a refusal with no why carries none');
  r.answers[LESSONS] = Object.assign(new Error('/data/memory/lessons: HTTP 502'), { status: 502, body: { ok: false, error: 'the memory could not be read', why: 'config.json is not valid JSON' } });
  r.fire(); await settle();
  assert.equal(sayOf(r.s().lessons.message), 'the memory could not be read');
  assert.equal(r.s().lessons.why, 'config.json is not valid JSON', "the memory's own sentence kept beside the route's words");
  r.answers[LESSONS] = new Error('network down');
  r.fire(); await settle();
  assert.equal(sayOf(r.s().lessons.message), 'network down', 'a throw with no body: its message');
  assert.equal(r.s().lessons.why, null, 'and no why');
  r.answers[LESSONS] = { ok: false, error: 'GET only' };
  r.fire(); await settle();
  assert.equal(sayOf(r.s().lessons.message), 'GET only', "another body: its error");
  r.answers[LESSONS] = { nothing: true };
  r.fire(); await settle();
  assert.equal(r.s().lessons.status, 'error');
  assert.equal(sayOf(r.s().lessons.message), 'not an answer from the memory', 'a body with no words: the face says what it is not');
  assert.deepEqual(r.s().lessons.data, kept);
  r.answers[LESSONS] = memoryLessons({ ownerChainBroken: true });
  r.fire(); await settle();
  assert.equal(r.s().lessons.status, 'ready');
  assert.equal(r.s().lessons.message, null, 'the line goes with the next answer');
  assert.equal(r.s().lessons.why, null);
  assert.equal(r.s().lessons.data.ownerChainBroken, true);
  r.mp.dispose();
});

test('the decisions read carries the symbol the slice holds, and reads again when it changes', async () => {
  const r = rig();
  r.mp.show(true, 'decisions');
  assert.ok(r.reads.includes('/data/memory/decisions'), 'no symbol: the plain path');
  await settle();
  r.store.dispatch('memoryPageSymbol', { symbol: 'BRK.B' });
  r.mp.show(true, 'decisions');
  assert.equal(r.reads.at(-1), '/data/memory/decisions?symbol=BRK.B', 'shown again with a new symbol: read at once');
  await settle();
  const n = r.reads.length;
  r.mp.show(true, 'decisions');
  assert.equal(r.reads.length, n, 'the same symbol: nothing more');
  r.store.dispatch('memoryPageSymbol', { symbol: 'A&B' });
  await r.mp.reread('decisions');
  assert.equal(r.reads.at(-1), '/data/memory/decisions?symbol=A%26B', 'reread: the symbol encoded');
  r.fire(); await settle();
  assert.ok(r.reads.slice(n + 1).includes('/data/memory/decisions?symbol=A%26B'), 'the poll reads it too');
  r.store.dispatch('memoryPageSymbol', { symbol: '' });
  r.fire(); await settle();
  assert.equal(r.reads.filter(p => p.startsWith('/data/memory/decisions')).at(-1), '/data/memory/decisions', 'cleared: the plain path');
  r.mp.dispose();
});

test('the decisions read carries the decision it is read before, beside the symbol, each only when set; either changed reads again', async () => {
  const r = rig();
  r.mp.show(true, 'decisions');
  await settle();
  r.store.dispatch('memoryPageBefore', { id: 'd-20261113-1b2c3d4e' });
  await r.mp.reread('decisions');
  assert.equal(r.reads.at(-1), '/data/memory/decisions?before=d-20261113-1b2c3d4e');
  r.store.dispatch('memoryPageSymbol', { symbol: 'NVDA' });
  assert.equal(r.s().before, '', 'a symbol typed reads the newest again');
  r.store.dispatch('memoryPageBefore', { id: 'd-20261112-2c3d4e5f' });
  r.mp.show(true, 'decisions');
  assert.equal(r.reads.at(-1), '/data/memory/decisions?symbol=NVDA&before=d-20261112-2c3d4e5f', 'shown again with a new window: read at once, both');
  await settle();
  const n = r.reads.length;
  r.mp.show(true, 'decisions');
  assert.equal(r.reads.length, n, 'the same window: nothing more');
  r.store.dispatch('memoryPageBefore', {});
  r.fire(); await settle();
  assert.equal(r.reads.filter(p => p.startsWith('/data/memory/decisions')).at(-1), '/data/memory/decisions?symbol=NVDA', 'back to the newest');
  r.mp.dispose();
});

test('a reread asked while its read is out is read once more after it answers', async () => {
  const r = rig();
  let release;
  r.answers['/data/memory/decisions'] = () => new Promise(res => { release = () => res(memoryDecisions()); });
  r.mp.show(true, 'decisions');
  r.store.dispatch('memoryPageSymbol', { symbol: 'NVDA' });
  void r.mp.reread('decisions');
  assert.equal(r.reads.filter(p => p.startsWith('/data/memory/decisions')).length, 1, 'not two in flight');
  r.answers['/data/memory/decisions'] = memoryDecisions();
  release(); await settle();
  assert.equal(r.reads.filter(p => p.startsWith('/data/memory/decisions')).at(-1), '/data/memory/decisions?symbol=NVDA');
  r.mp.dispose();
});

test("the slice's reducers: a read's three states, a row opened, a diff shown, the symbol; an unknown read changes nothing", () => {
  const R = reducers;
  let s = emptyState();
  s = R.memoryPageLoading(s, { read: 'health' });
  assert.equal(s.memoryPage.health.status, 'loading');
  s = R.memoryPageLoaded(s, { read: 'health', data: memoryHealth(), at: 5 });
  assert.deepEqual(s.memoryPage.health, { status: 'ready', data: memoryHealth(), at: 5, message: null, why: null });
  s = R.memoryPageFailed(s, { read: 'health', at: 6, message: 'the memory could not be read' });
  assert.deepEqual(s.memoryPage.health, { status: 'error', data: memoryHealth(), at: 6, message: 'the memory could not be read', why: null });
  s = R.memoryPageLoading(s, { read: 'health' });
  assert.equal(s.memoryPage.health.message, 'the memory could not be read', 'a read under way keeps the line until it answers');
  assert.equal(R.memoryPageLoaded(s, { read: 'nowhere', data: {} }), s);
  s = R.memoryPageToggle(s, { id: 'chase-gap' });
  assert.deepEqual(s.memoryPage.open, { 'chase-gap': true });
  s = R.memoryPageToggle(s, { id: 'chase-gap' });
  assert.deepEqual(s.memoryPage.open, { 'chase-gap': false });
  s = R.memoryPageDiff(s, { id: 'chase-gap' });
  assert.deepEqual(s.memoryPage.diff, { 'chase-gap': true });
  assert.equal(R.memoryPageToggle(s, { id: '' }), s);
  s = R.memoryPageSymbol(s, { symbol: 'NVDA' });
  assert.equal(s.memoryPage.symbol, 'NVDA');
  s = R.memoryPageSymbol(s, { symbol: 7 });
  assert.equal(s.memoryPage.symbol, '');
  s = R.memoryPageBefore(s, { id: 'd-20261113-1b2c3d4e' });
  assert.equal(s.memoryPage.before, 'd-20261113-1b2c3d4e');
  assert.equal(R.memoryPageBefore(s, { id: 'd x' }).memoryPage.before, '', 'an id that is not plain: the newest');
  assert.equal(R.memoryPageBefore(s, {}).memoryPage.before, '');
  assert.equal(R.memoryPageSymbol(s, { symbol: 'NVDA' }).memoryPage.before, '', 'a symbol clears the window');
  s = R.memoryPageToggle(s, { id: 'constructor' });
  assert.equal(Object.hasOwn(s.memoryPage.open, 'constructor') && s.memoryPage.open.constructor === true, true, 'the first press opens a row named constructor');
});
