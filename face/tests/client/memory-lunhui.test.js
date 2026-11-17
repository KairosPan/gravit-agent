// The lessons a Lunhui run's view draws (memory alert and Lunhui, Task 5): which runs the loaded views still want, the read
// of GET /data/memory/lunhui once per run, the slice it lands in, and what a view and a leader find there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runKey, wantedLessons, ensureLunhuiLessons, lessonsDue, lessonsFor, leaderLessons, LESSONS_RETRY_MS } from '../../client/js/host/memory-lunhui.js';
import { createStore } from '../../client/js/store.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';

const view = (strategy, run) => ({ strategy, run, ladder: null, stocks: {} });
const CHECKED = { state: 'checked', strategy: 'cn-market', run: 'r1', askedAt: '2026-11-15T07:10:00Z', leaders: [{ code: '600001', boards: 3, lessons: [], lessonsMore: 0, untold: [], untoldMore: 0 }] };
// two loaded views of r1 (other modules), one of r 2, one still loading
const stateWith = (over = {}) => ({
  ...emptyState(),
  lunhui: { views: { 'cn-market/r1/a': { status: 'loaded', view: view('cn-market', 'r1') }, 'cn-market/r1/': { status: 'loaded', view: view('cn-market', 'r1') },
    'cn-market/r 2/': { status: 'loaded', view: view('cn-market', 'r 2') }, 'cn-market/r3/': { status: 'loading' }, 'cn-market/r4/': { status: 'failed', error: 'HTTP 404' } }, ui: {}, stock: null },
  ...over,
});
const storeOf = state => createStore({ initial: state, reducers: R });

test('runKey joins the view’s own strategy and run', () => {
  assert.equal(runKey({ strategy: 'cn-market', run: 'r1' }), 'cn-market/r1');
});

test('wantedLessons: the loaded views’ runs with no entry, each once; a loading or failed view and a view with no names want none', () => {
  assert.deepEqual(wantedLessons(stateWith()), [{ runKey: 'cn-market/r1', strategy: 'cn-market', run: 'r1' }, { runKey: 'cn-market/r 2', strategy: 'cn-market', run: 'r 2' }]);
  const one = stateWith({ memoryLunhui: { 'cn-market/r1': { status: 'loading' } } });
  assert.deepEqual(wantedLessons(one).map(w => w.runKey), ['cn-market/r 2'], 'a run with an entry is not wanted');
  const nameless = { ...emptyState(), lunhui: { views: { k: { status: 'loaded', view: { strategy: '', run: 'r1' } }, j: { status: 'loaded', view: { run: 'r1' } } }, ui: {}, stock: null } };
  assert.deepEqual(wantedLessons(nameless), []);
  assert.deepEqual(wantedLessons(emptyState()), []);
});

test('ensureLunhuiLessons asks each run once, its names encoded, and lands the body’s lessons ready', async () => {
  const store = storeOf(stateWith());
  const asked = [];
  const seen = [];
  store.subscribe((s, type) => seen.push([type, s.memoryLunhui?.['cn-market/r1']?.status]));
  await ensureLunhuiLessons(store, async path => { asked.push(path); return { ok: true, lessons: path.includes('r1') ? CHECKED : { state: 'not connected', words: 'no memory here' } }; });
  assert.deepEqual(asked, ['/data/memory/lunhui?strategy=cn-market&run=r1', '/data/memory/lunhui?strategy=cn-market&run=r%202']);
  assert.deepEqual(seen.filter(([type]) => type.startsWith('memoryLunhui')).map(([type]) => type), ['memoryLunhuiLoading', 'memoryLunhuiLoading', 'memoryLunhuiLoaded', 'memoryLunhuiLoaded']);
  assert.deepEqual(store.get().memoryLunhui['cn-market/r1'], { status: 'ready', lessons: CHECKED });
  assert.equal(store.get().memoryLunhui['cn-market/r 2'].lessons.state, 'not connected');
  await ensureLunhuiLessons(store, async () => { throw new Error('asked again'); });
  assert.equal(store.get().memoryLunhui['cn-market/r1'].status, 'ready', 'a run with an entry is not asked again');
});

test('a throw, a 503 and a body with no lessons end failed, and a failed run is not asked again', async () => {
  for (const answer of [() => { throw Object.assign(new Error('HTTP 503'), { status: 503 }); }, () => ({ ok: true }), () => ({ ok: true, lessons: 'checked' }), () => null]) {
    const store = storeOf(stateWith({ lunhui: { views: { 'cn-market/r1/': { status: 'loaded', view: view('cn-market', 'r1') } }, ui: {}, stock: null } }));
    await ensureLunhuiLessons(store, async () => answer());
    assert.deepEqual(store.get().memoryLunhui['cn-market/r1'], { status: 'failed' });
    let again = 0;
    await ensureLunhuiLessons(store, async () => { again += 1; return { ok: true, lessons: CHECKED }; });
    assert.equal(again, 0);
  }
});

test('a failed read is asked once more on a render no sooner than 5,000 ms after it failed; failed twice, it stays failed', async () => {
  const store = storeOf(stateWith({ lunhui: { views: { 'cn-market/r1/': { status: 'loaded', view: view('cn-market', 'r1') } }, ui: {}, stock: null } }));
  let at = 1_000_000;
  const now = () => at;
  let calls = 0;
  const failing = async () => { calls += 1; throw new Error('HTTP 503'); };
  await ensureLunhuiLessons(store, failing, now);
  assert.equal(calls, 1);
  assert.equal(lessonsDue(store, now), false, 'nothing due at once');
  at += LESSONS_RETRY_MS - 1;
  await ensureLunhuiLessons(store, failing, now);
  assert.equal(calls, 1, 'not before 5,000 ms');
  at += 1;
  assert.equal(lessonsDue(store, now), true);
  await ensureLunhuiLessons(store, failing, now);
  assert.equal(calls, 2, 'asked once more');
  assert.deepEqual(store.get().memoryLunhui['cn-market/r1'], { status: 'failed' });
  at += 60_000;
  assert.equal(lessonsDue(store, now), false);
  await ensureLunhuiLessons(store, failing, now);
  assert.equal(calls, 2, 'failed twice: never asked again');

  const healed = storeOf(stateWith({ lunhui: { views: { 'cn-market/r1/': { status: 'loaded', view: view('cn-market', 'r1') } }, ui: {}, stock: null } }));
  let first = true;
  const once = async () => { if (first) { first = false; throw new Error('HTTP 503'); } return { ok: true, lessons: CHECKED }; };
  await ensureLunhuiLessons(healed, once, now);
  at += LESSONS_RETRY_MS;
  await ensureLunhuiLessons(healed, once, now);
  assert.deepEqual(healed.get().memoryLunhui['cn-market/r1'], { status: 'ready', lessons: CHECKED });
});

test('the one more read under nested renders is asked once', async () => {
  const store = storeOf(stateWith({ lunhui: { views: { 'cn-market/r1/': { status: 'loaded', view: view('cn-market', 'r1') } }, ui: {}, stock: null } }));
  let at = 0;
  const now = () => at;
  let calls = 0;
  await ensureLunhuiLessons(store, async () => { calls += 1; throw new Error('HTTP 503'); }, now);
  at = LESSONS_RETRY_MS;
  const getJson = async () => { calls += 1; return { ok: true, lessons: CHECKED }; };
  const pending = [];
  const off = store.subscribe(() => { pending.push(ensureLunhuiLessons(store, getJson, now)); });
  await ensureLunhuiLessons(store, getJson, now);
  await Promise.all(pending);
  off?.();
  assert.equal(calls, 2, 'the failed read, then one more');
  assert.equal(store.get().memoryLunhui['cn-market/r1'].status, 'ready');
});

test('renders nesting inside each dispatch (the app calls the ensure after every render) ask each run once', async () => {
  const store = storeOf(stateWith());
  const asked = [];
  const getJson = async path => { asked.push(path); return { ok: true, lessons: CHECKED }; };
  const pending = [];
  store.subscribe(() => { pending.push(ensureLunhuiLessons(store, getJson)); });
  await ensureLunhuiLessons(store, getJson);
  await Promise.all(pending);
  assert.equal(asked.length, 2, asked.join(' '));
  assert.equal(new Set(asked).size, 2);
});

test('lessonsFor: a view’s run’s ready lessons, else null; leaderLessons: a checked answer’s leader of that code, else null', () => {
  const s = stateWith({ memoryLunhui: { 'cn-market/r1': { status: 'ready', lessons: CHECKED }, 'cn-market/r 2': { status: 'loading' } } });
  assert.equal(lessonsFor(s, view('cn-market', 'r1')), CHECKED);
  assert.equal(lessonsFor(s, view('cn-market', 'r 2')), null, 'loading');
  assert.equal(lessonsFor(s, view('cn-market', 'r9')), null, 'no entry');
  assert.equal(lessonsFor(s, null), null);
  assert.equal(lessonsFor(s, undefined), null);
  assert.equal(lessonsFor(emptyState(), view('cn-market', 'r1')), null);
  assert.equal(leaderLessons(CHECKED, '600001'), CHECKED.leaders[0]);
  assert.equal(leaderLessons(CHECKED, '600002'), null);
  assert.equal(leaderLessons({ state: 'not connected', words: 'x' }, '600001'), null);
  assert.equal(leaderLessons(null, '600001'), null);
  assert.equal(leaderLessons({ state: 'checked', leaders: 'x' }, '600001'), null);
});
