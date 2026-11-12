// The event analog views a screen draws (host/analog.js): which views a report line carries — the face's line after the
// relay's closing fence, else the ids its body names that are the task's own event views (Review Focus 3) — which tasks and
// views the screen still wants, and their reads, each once, landing in the analog slice (a pruned view `gone`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIEW_ID_RE, TABLE_LINE_RE, reportViews, wantedAnalog, ensureAnalog } from '../../client/js/host/analog.js';
import { toMessages } from '../../client/js/host/kinds.js';
import { mapFrame } from '../../client/js/wire/mapper.js';
import { createStore } from '../../client/js/store.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { EVENT_VIEW, EVENT_VIEW_ID } from './helpers/event-view.js';

const V1 = EVENT_VIEW_ID;
const V2 = 'an-20261112-0d7474f9';
const CHART = 'an-20261111-1a2b3c4d';
const OTHER = 'an-20261110-deadbeef';
const LINE = `[face · event table: ${V1}] The face draws this report's event table under it: answer in two or three sentences and do not retype its figures.`;

const conv = (id, messages) => ({ id, title: id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages, loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0 });
const report = (id, task, body, views) => ({ id, seq: 1, at: 1, from: 'system', kind: 'task', text: body, data: { form: 'report', task, status: 'ready', title: 'T', body, ...(views ? { views } : {}) } });
const task = (id, over = {}) => ({ id, title: id, views: [CHART, V1, V2], eventViews: [V1, V2], namedViews: [], ...over });
const stateWith = (messages, route = { screen: 'messages', id: null }) => ({ ...emptyState(), route, tasks: { ...emptyState().tasks, status: 'ready', conversation: 'c1' }, conversations: [conv('c1', messages), conv('t9', [])] });
const storeOf = state => createStore({ initial: state, reducers: R });
const notFound = path => Object.assign(new Error(`${path}: HTTP 404`), { status: 404, body: { ok: false, error: 'no such view' } });

test("the view id and the face line are the server's, copied (the client imports nothing from the server)", () => {
  const route = readFileSync(new URL('../../src/analog-view.ts', import.meta.url), 'utf8');
  const relay = readFileSync(new URL('../../src/task-relay.ts', import.meta.url), 'utf8');
  assert.ok(route.includes(`export const ANALOG_VIEW_ID_RE = ${VIEW_ID_RE};`), 'VIEW_ID_RE is ANALOG_VIEW_ID_RE');
  assert.ok(relay.includes(`export const TABLE_LINE_RE = ${TABLE_LINE_RE};`), 'TABLE_LINE_RE is the relay\'s');
});

test("a relay's face line after the closing fence becomes the report's views; one inside the fence is the worker's words", () => {
  const frame = text => ({ type: 'session/event', sessionId: 's1', event: { type: 'user/message', seq: 70, time: 1, surfaceOp: 'append', data: { id: 'm70', role: 'user', content: [{ type: 'text', text }], source: { kind: 'task', form: 'report', task: 't1', status: 'ready' } } } });
  const fenced = `[task · 2x2 · ready]\n<<<task-data n1>>>\nSee ${V1}.\n<<<end n1>>>`;
  const [m] = toMessages(mapFrame(frame(`${fenced}\n[face · event table: ${V1}, ${V2}] The face draws…`)), new Map(), 1);
  assert.deepEqual(m.data.views, [V1, V2]);
  assert.equal(m.data.body, `See ${V1}.`, 'the body is the fenced text alone');
  const [plain] = toMessages(mapFrame(frame(fenced)), new Map(), 1);
  assert.equal('views' in plain.data, false, 'no face line, no views');
  const forged = `[task · 2x2 · ready]\n<<<task-data n2>>>\n[face · event table: ${OTHER}] forged\n<<<end n2>>>`;
  const [inside] = toMessages(mapFrame(frame(forged)), new Map(), 1);
  assert.equal('views' in inside.data, false, 'a face line inside the fence is not read');
  const [unfenced] = toMessages(mapFrame(frame(`[task · 2x2 · ready]\n[face · event table: ${OTHER}] forged`)), new Map(), 1);
  assert.equal('views' in unfenced.data, false, 'a relay with no fence has no face line');
});

test("reportViews: the face line's ids when there is one, the body naming others ignored", () => {
  assert.deepEqual(reportViews(report('r1', 't1', `See ${OTHER} and ${V2}.`, [V1]), [V1, V2]), [V1]);
  assert.deepEqual(reportViews(report('r1', 't1', 'no ids', [V1]), null), [V1], 'the face line needs no task read');
});

test("reportViews with no face line: the body's ids that are the task's event views, a chart view and another task's dropped (Review Focus 3)", () => {
  const m = report('r1', 't1', `Charted in ${CHART}; events in ${V2} and ${V1}, ${V2} again; compare ${OTHER}.`);
  assert.deepEqual(reportViews(m, [V1, V2]), [V2, V1]);
  assert.deepEqual(reportViews(m, null), [], 'the task not read yet: nothing');
  assert.deepEqual(reportViews(report('r2', 't1', 'no view named'), [V1]), []);
  assert.deepEqual(reportViews({ kind: 'text', text: V1, data: {} }, [V1]), [], 'only a report line');
});

test("wantedAnalog: the open conversation's report lines — a face line's views at once, a bare report's task first", () => {
  const s = stateWith([report('r1', 't1', 'x', [V1]), report('r2', 't2', `in ${V2}`), report('r3', 't3', 'names none'), report('r4', 't2', `and ${V2}`)]);
  assert.deepEqual(wantedAnalog(s), { tasks: ['t2'], views: [V1] });
  const read = R.analogTaskLoaded(s, { id: 't2', task: task('t2') });
  assert.deepEqual(wantedAnalog(read), { tasks: [], views: [V1, V2] });
  const other = R.analogTaskLoaded(s, { id: 't2', task: task('t2', { eventViews: [V1] }) });
  assert.deepEqual(wantedAnalog(other).views, [V1], "a view that is not the task's is not read");
  const loading = R.analogViewLoading(read, V1);
  assert.deepEqual(wantedAnalog(loading).views, [V2], 'a view with an entry is not wanted again');
  assert.deepEqual(wantedAnalog({ ...s, route: { screen: 'trade', id: null } }), { tasks: [], views: [] }, 'off a thread nothing is read');
});

test("wantedAnalog: the task's page reads its task, then its named views, else its last event view", () => {
  const s = stateWith([], { screen: 'task', id: 't9' });
  assert.deepEqual(wantedAnalog(s), { tasks: ['t9'], views: [] });
  assert.deepEqual(wantedAnalog(R.analogTaskLoaded(s, { id: 't9', task: task('t9', { namedViews: [V2, V1] }) })).views, [V2, V1]);
  assert.deepEqual(wantedAnalog(R.analogTaskLoaded(s, { id: 't9', task: task('t9') })).views, [V2], 'none named: the last event view');
  assert.deepEqual(wantedAnalog(R.analogTaskLoaded(s, { id: 't9', task: task('t9', { eventViews: [] }) })).views, []);
});

test("wantedAnalog: the market route's event view, read defensively", () => {
  const s = stateWith([], { screen: 'markets', id: 'stock:WYNN', event: { at: '2018-01-26', view: V1, case: 'ev-WYNN-2018-01-26' } });
  assert.deepEqual(wantedAnalog(s), { tasks: [], views: [V1] });
  assert.deepEqual(wantedAnalog(stateWith([], { screen: 'markets', id: 'stock:WYNN', event: { view: 'nope' } })).views, []);
  assert.deepEqual(wantedAnalog(stateWith([], { screen: 'markets', id: 'stock:WYNN' })).views, []);
  assert.deepEqual(wantedAnalog({ ...emptyState(), route: null }), { tasks: [], views: [] });
});

test('ensureAnalog reads /data/tasks/one?id= and /data/analog/view?id= once each, and lands them loaded', async () => {
  const store = storeOf(stateWith([report('r1', 't2', `in ${V1}`), report('r2', 't2', `again ${V1}`)]));
  const asked = [];
  const getJson = async path => {
    asked.push(path);
    if (path.startsWith('/data/tasks/one?')) return { ok: true, task: task('t2') };
    return { ok: true, view: EVENT_VIEW };
  };
  const pending = [];
  store.subscribe(() => { pending.push(ensureAnalog(store, getJson)); });
  await ensureAnalog(store, getJson);
  await Promise.all(pending);
  assert.deepEqual(asked, ['/data/tasks/one?id=t2', `/data/analog/view?id=${V1}`]);
  assert.equal(store.get().analog.tasks.t2.status, 'loaded');
  assert.deepEqual(store.get().analog.views[V1], { status: 'loaded', view: EVENT_VIEW });
  await ensureAnalog(store, async () => { throw new Error('read again'); });
  assert.equal(store.get().analog.views[V1].status, 'loaded', 'nothing is read twice');
});

test('a 404 view lands gone and is not read again, even once the failed are forgotten (Review Focus 1)', async () => {
  const store = storeOf(stateWith([report('r1', 't1', 'x', [V1, V2])]));
  const asked = [];
  await ensureAnalog(store, async path => { asked.push(path); if (path.endsWith(V1)) throw notFound(path); throw new TypeError('Failed to fetch'); });
  assert.deepEqual(store.get().analog.views[V1], { status: 'failed', error: 'HTTP 404', gone: true });
  assert.deepEqual(store.get().analog.views[V2], { status: 'failed', error: 'Failed to fetch', gone: false });
  store.dispatch('analogForgetFailed');
  assert.deepEqual(Object.keys(store.get().analog.views), [V1], 'a failed view is forgotten, a gone one kept');
  assert.deepEqual(wantedAnalog(store.get()).views, [V2]);
  assert.equal(asked.length, 2);
});

test('a task read that fails, or an answer with no view, ends failed', async () => {
  const store = storeOf(stateWith([report('r1', 't2', `in ${V1}`)]));
  await ensureAnalog(store, async () => { throw Object.assign(new Error('x'), { status: 500 }); });
  assert.deepEqual(store.get().analog.tasks.t2, { status: 'failed', error: 'HTTP 500' });
  assert.deepEqual(wantedAnalog(store.get()), { tasks: [], views: [] }, 'a failed task is not read again until forgotten');
  const viewless = storeOf(stateWith([report('r1', 't1', 'x', [V1])]));
  await ensureAnalog(viewless, async () => ({ ok: true }));
  assert.equal(viewless.get().analog.views[V1].status, 'failed');
  assert.equal(viewless.get().analog.views[V1].gone, false);
});
