// Background jobs' host layer (host/jobs.js): the job/list stream into the slice, one job/follow whose output stays
// here, job/kill and its status line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startJobs, JOB_OUTPUT_KEEP } from '../../client/js/host/jobs.js';
import { NOT_SIGNED_IN } from '../../client/js/host/actions.js';

const DROPPED = '… earlier output dropped …';
const job = (id, status = 'running', more = {}) => ({ id, kind: 'bash', label: id, owner: 's1', status, startedAt: 1, output: { total: 0, earliest: 0 }, ...more });

function fakeMux() {
  const streams = [];
  return {
    streams,
    stream(endpoint, args, handlers = {}) {
      const s = { endpoint, args, handlers, cancelled: false, cancel() { s.cancelled = true; } };
      streams.push(s);
      return { cancel: () => s.cancel() };
    },
    live(endpoint) { return streams.filter(s => s.endpoint === endpoint && !s.cancelled); },
  };
}

function rig(call = async () => ({ outcome: 'requested' })) {
  const store = createStore({ initial: emptyState(), reducers });
  const mux = fakeMux();
  const outputs = [];
  const calls = [];
  const dispatched = [];
  const dispatch = store.dispatch.bind(store);
  store.dispatch = (name, payload) => { dispatched.push(name); return dispatch(name, payload); };
  const jobs = startJobs({ store, mux, call: (m, a) => { calls.push([m, a]); return call(m, a); }, onOutput: id => outputs.push(id) });
  return { store, mux, outputs, calls, dispatched, jobs };
}

test('watch opens job/list with {request: {sessionId}}, replaces it on another conversation, and opens none for null', () => {
  const r = rig();
  r.jobs.watch('s1');
  assert.deepEqual(r.mux.live('job/list').map(s => s.args), [{ request: { sessionId: 's1' } }]);
  assert.equal(r.store.get().jobs.convId, 's1');
  r.jobs.watch('s1');
  assert.equal(r.mux.streams.length, 1, 'the same conversation keeps its stream');
  r.jobs.watch('s2');
  assert.equal(r.mux.streams[0].cancelled, true);
  assert.deepEqual(r.mux.live('job/list').map(s => s.args), [{ request: { sessionId: 's2' } }]);
  r.jobs.watch(null);
  assert.equal(r.mux.live('job/list').length, 0);
  assert.equal(r.mux.streams.length, 2);
  assert.equal(r.store.get().jobs.convId, null);
});

test("rows frames replace the slice whole; a re-opened stream's empty rows empty it", () => {
  const r = rig();
  r.jobs.watch('s1');
  const s = r.mux.streams[0];
  s.handlers.onItem({ type: 'rows', jobs: [job('a'), job('b', 'completed')] });
  assert.deepEqual(r.store.get().jobs.rows.map(j => j.id), ['a', 'b']);
  s.handlers.onItem({ type: 'rows', jobs: [job('b', 'completed')] });
  assert.deepEqual(r.store.get().jobs.rows.map(j => j.id), ['b']);
  // after a reconnect the mux re-opens the stream with its first args: its first frame is the whole set
  s.handlers.onItem({ type: 'rows', jobs: [] });
  assert.deepEqual(r.store.get().jobs.rows, []);
  // a cancelled stream's late frame lands nowhere
  r.jobs.watch('s2');
  s.handlers.onItem({ type: 'rows', jobs: [job('x')] });
  assert.deepEqual(r.store.get().jobs.rows, []);
});

test('follow opens job/follow with {request: {sessionId, jobId}}, without sessionId for an unowned job', () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  assert.deepEqual(r.mux.live('job/follow').map(s => s.args), [{ request: { sessionId: 's1', jobId: 'a' } }]);
  const { owner, ...unowned } = job('u');
  r.jobs.follow('s1', unowned);
  assert.equal(r.mux.streams[0].cancelled, true);
  assert.deepEqual(r.mux.live('job/follow').map(s => s.args), [{ request: { jobId: 'u' } }]);
  r.jobs.unfollow();
  assert.equal(r.mux.live('job/follow').length, 0);
  assert.equal(r.jobs.outputOf('u'), null);
});

test('output appends in order, marks a head the host dropped, a gap and a lossy frame, and calls onOutput without dispatching', () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  const f = r.mux.streams[0].handlers;
  const before = r.dispatched.length;
  f.onItem({ type: 'opened', job: job('a', 'running', { output: { total: 500, earliest: 200 } }), from: 200 });
  assert.deepEqual(r.jobs.outputOf('a'), { text: `${DROPPED}\n`, ended: false });
  f.onItem({ type: 'output', chunks: [{ at: 200, text: 'one\n' }, { at: 204, text: 'two\n' }], next: 208 });
  assert.equal(r.jobs.outputOf('a').text, `${DROPPED}\none\ntwo\n`);
  f.onItem({ type: 'output', chunks: [{ at: 300, text: 'three', gapBefore: true }], next: 305 });
  assert.equal(r.jobs.outputOf('a').text, `${DROPPED}\none\ntwo\n${DROPPED}\nthree`);
  f.onItem({ type: 'output', chunks: [{ at: 400, text: 'four\n' }], next: 405, lossy: true });
  assert.equal(r.jobs.outputOf('a').text, `${DROPPED}\none\ntwo\n${DROPPED}\nthree\n${DROPPED}\nfour\n`);
  f.onItem({ type: 'status', job: job('a', 'completed', { detail: 'exit code: 0' }) });
  assert.equal(r.jobs.outputOf('a').ended, true);
  assert.equal(r.jobs.outputOf('b'), null);
  assert.deepEqual(r.outputs, ['a', 'a', 'a', 'a', 'a']);
  assert.equal(r.dispatched.length, before, 'nothing is dispatched for output');
  // a fresh job from its first byte has no dropped line
  r.jobs.follow('s1', job('c'));
  const g = r.mux.streams[1].handlers;
  g.onItem({ type: 'opened', job: job('c'), from: 0 });
  g.onItem({ type: 'output', chunks: [{ at: 0, text: 'hi' }], next: 2 });
  assert.deepEqual(r.jobs.outputOf('c'), { text: 'hi', ended: false });
  // the old follow's late frame lands nowhere
  f.onItem({ type: 'output', chunks: [{ at: 405, text: 'late' }], next: 409 });
  assert.equal(r.jobs.outputOf('c').text, 'hi');
});

test('a re-opened follow repeats no chunk', () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  const f = r.mux.streams[0].handlers;
  const chunks = [{ at: 0, text: 'x'.repeat(100) }, { at: 100, text: 'y'.repeat(100) }, { at: 200, text: 'z'.repeat(100) }];
  f.onItem({ type: 'opened', job: job('a'), from: 0 });
  f.onItem({ type: 'output', chunks, next: 300 });
  const held = r.jobs.outputOf('a').text;
  assert.equal(held.length, 300);
  // the reconnect: the mux opens the same follow again, from the oldest retained byte
  f.onItem({ type: 'opened', job: job('a', 'running', { output: { total: 300, earliest: 0 } }), from: 0 });
  f.onItem({ type: 'output', chunks, next: 300 });
  assert.equal(r.jobs.outputOf('a').text, held);
  f.onItem({ type: 'output', chunks: [{ at: 300, text: 'new' }], next: 303 });
  assert.equal(r.jobs.outputOf('a').text, `${held}new`);
});

test('the kept output is capped from the head and starts with the dropped line', () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  const f = r.mux.streams[0].handlers;
  f.onItem({ type: 'opened', job: job('a'), from: 0 });
  const big = 'a'.repeat(JOB_OUTPUT_KEEP - 10);
  f.onItem({ type: 'output', chunks: [{ at: 0, text: big }], next: big.length });
  assert.equal(r.jobs.outputOf('a').text, big);
  f.onItem({ type: 'output', chunks: [{ at: big.length, text: 'b'.repeat(100) + 'END' }], next: big.length + 103 });
  const text = r.jobs.outputOf('a').text;
  assert.equal(JOB_OUTPUT_KEEP, 262144);
  assert.ok(text.length <= JOB_OUTPUT_KEEP);
  assert.ok(text.startsWith(`${DROPPED}\n`));
  assert.ok(text.endsWith('b'.repeat(100) + 'END'));
});

test('kill calls job/kill with {request: {sessionId, jobId}}; a throw says stop: job/not-found and answers false', async () => {
  const r = rig();
  assert.equal(await r.jobs.kill('s1', 'a'), true);
  assert.deepEqual(r.calls, [['job/kill', { request: { sessionId: 's1', jobId: 'a' } }]]);
  const done = rig(async () => ({ outcome: 'already-finished' }));
  assert.equal(await done.jobs.kill('s1', 'a'), true);
  const gone = rig(async () => { throw Object.assign(new Error('gone'), { code: 'job/not-found' }); });
  assert.equal(await gone.jobs.kill('s1', 'a'), false);
  assert.deepEqual(gone.store.get().status.line, 'stop: job/not-found');
  assert.equal(gone.store.get().status.bad, true);
  const out = rig(async () => { throw Object.assign(new Error('401'), { status: 401 }); });
  assert.equal(await out.jobs.kill('s1', 'a'), false);
  assert.equal(out.store.get().status.line, NOT_SIGNED_IN);
});
