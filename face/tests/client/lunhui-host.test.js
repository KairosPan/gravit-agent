// The composed answer's view (plan 2 of the Lunhui run view, task 4): the key and the path a composed message's view is read
// by, which views the open conversation still wants, the read itself, and the slice it lands in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewKey, viewPath, wantedViews, ensureViews } from '../../client/js/host/lunhui.js';
import { createStore } from '../../client/js/store.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { VIEW_1027 } from './helpers/lunhui-view.js';

const RUN = '20261027T201627Z-6937d208';
const conv = (id, messages) => ({ id, title: id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages, loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0 });
const composed = (id, over = {}) => ({ id, seq: 1, at: 1, from: 'gravit', kind: 'composed', text: '弱势日', data: { callId: id.slice(1), strategy: 'cn-market', run: RUN, summary: '弱势日', blocks: [{ kind: 'breadth' }], choices: [], modules: ['environment', 'sentiment'], ...over } });
const stateWith = (messages, route = { screen: 'messages', id: 'c1' }) => ({ ...emptyState(), route, conversations: [conv('c1', messages), conv('c2', [composed('p9', { run: 'other' })])] });
const storeOf = state => createStore({ initial: state, reducers: R });

test('viewKey joins strategy, run and modules; viewPath encodes each value and an empty list asks modules=', () => {
  assert.equal(viewKey({ strategy: 'cn-market', run: RUN, modules: ['environment', 'sentiment'] }), `cn-market/${RUN}/environment,sentiment`);
  assert.equal(viewPath({ strategy: 'cn-market', run: RUN, modules: ['environment', 'sentiment'] }), `/data/lunhui/view?strategy=cn-market&run=${RUN}&modules=environment%2Csentiment`);
  assert.equal(viewPath({ strategy: 'a b', run: 'r&1', modules: [] }), '/data/lunhui/view?strategy=a%20b&run=r%261&modules=');
  const asked = new URL(viewPath({ strategy: 'cn-market', run: RUN, modules: ['environment', 'sentiment'] }), 'http://x').searchParams;
  assert.equal(asked.get('modules'), 'environment,sentiment', 'the route splits what it reads on commas');
});

test("wantedViews: the open conversation's composed messages whose view has no entry yet, each key once", () => {
  const s = stateWith([composed('p1'), composed('p2'), composed('p3', { modules: [] }), { id: 'e4', seq: 4, at: 1, from: 'gravit', kind: 'text', text: 'x', data: {} }]);
  assert.deepEqual(wantedViews(s), [
    { key: `cn-market/${RUN}/environment,sentiment`, strategy: 'cn-market', run: RUN, modules: ['environment', 'sentiment'] },
    { key: `cn-market/${RUN}/`, strategy: 'cn-market', run: RUN, modules: [] },
  ]);
  const loading = R.lunhuiViewLoading(s, `cn-market/${RUN}/environment,sentiment`);
  assert.deepEqual(wantedViews(loading).map(w => w.key), [`cn-market/${RUN}/`], 'a key already loading is skipped');
  const failed = R.lunhuiViewFailed(loading, { key: `cn-market/${RUN}/`, error: 'HTTP 404' });
  assert.deepEqual(wantedViews(failed), [], 'a failed view waits for Retry');
  assert.deepEqual(wantedViews(R.lunhuiRetry(failed, `cn-market/${RUN}/`)).map(w => w.key), [`cn-market/${RUN}/`], 'Retry forgets it, so it is wanted again');
  assert.deepEqual(wantedViews({ ...s, route: { screen: 'markets', id: null } }), [], 'off Messages nothing is read');
  assert.deepEqual(wantedViews(stateWith([composed('p1', { modules: 'x' })])).map(w => w.modules), [[]], 'modules that are not a list ask none');
});

test('ensureViews reads each wanted view once and lands it loaded', async () => {
  const store = storeOf(stateWith([composed('p1'), composed('p2')]));
  const asked = [];
  const seen = [];
  store.subscribe((s, type) => seen.push([type, s.lunhui.views[`cn-market/${RUN}/environment,sentiment`]?.status]));
  await ensureViews(store, async path => { asked.push(path); return { ok: true, view: VIEW_1027 }; });
  assert.deepEqual(asked, [`/data/lunhui/view?strategy=cn-market&run=${RUN}&modules=environment%2Csentiment`]);
  assert.deepEqual(seen, [['lunhuiViewLoading', 'loading'], ['lunhuiViewLoaded', 'loaded']]);
  const entry = store.get().lunhui.views[`cn-market/${RUN}/environment,sentiment`];
  assert.equal(entry.status, 'loaded'); assert.equal(entry.view, VIEW_1027);
  await ensureViews(store, async () => { throw new Error('read again'); });
  assert.equal(store.get().lunhui.views[`cn-market/${RUN}/environment,sentiment`].status, 'loaded', 'a loaded view is not read again');
});

test('a render between two loads (the app calls ensureViews after every render) asks nothing twice', async () => {
  const store = storeOf(stateWith([composed('p1'), composed('p2', { modules: [] })]));
  const asked = [];
  const getJson = async path => { asked.push(path); return { ok: true, view: VIEW_1027 }; };
  const pending = [];
  store.subscribe(() => { pending.push(ensureViews(store, getJson)); });
  await ensureViews(store, getJson);
  await Promise.all(pending);
  assert.equal(asked.length, 2, asked.join(' '));
  assert.equal(new Set(asked).size, 2);
});

test('a view read that fails (404, a dead face, no view in the answer, a throw before the promise) ends failed with its words (Review Focus 3)', async () => {
  const run = async getJson => { const store = storeOf(stateWith([composed('p1')])); await ensureViews(store, getJson); return store.get().lunhui.views[`cn-market/${RUN}/environment,sentiment`]; };
  assert.deepEqual(await run(async path => { throw Object.assign(new Error(`${path}: HTTP 404`), { status: 404 }); }), { status: 'failed', error: 'HTTP 404' });
  assert.deepEqual(await run(async () => { throw new TypeError('Failed to fetch'); }), { status: 'failed', error: 'Failed to fetch' });
  assert.deepEqual(await run(async () => ({ ok: true })), { status: 'failed', error: 'the answer held no view' });
  assert.deepEqual(await run(() => { throw new Error('sync'); }), { status: 'failed', error: 'sync' });
  assert.deepEqual(await run(async () => { throw 'odd'; }), { status: 'failed', error: 'the view could not be read' });
});

test('the lunhui slice: lunhuiUi merges a patch into one answer\'s ui; Retry deletes only its own key', () => {
  let s = emptyState();
  assert.deepEqual(s.lunhui, { views: {}, ui: {} });
  s = R.lunhuiUi(s, { id: 'c1-p7', patch: { tile: 'theme' } });
  s = R.lunhuiUi(s, { id: 'c1-p7', patch: { breadth: 'dist' } });
  assert.deepEqual(s.lunhui.ui, { 'c1-p7': { tile: 'theme', breadth: 'dist' } });
  s = R.lunhuiViewLoaded(R.lunhuiViewFailed(s, { key: 'a', error: 'HTTP 500' }), { key: 'b', view: VIEW_1027 });
  const kept = R.lunhuiRetry(s, 'a');
  assert.deepEqual(Object.keys(kept.lunhui.views), ['b']);
  assert.equal(R.lunhuiRetry(kept, 'zzz'), kept, 'retrying an unknown key changes nothing');
});
