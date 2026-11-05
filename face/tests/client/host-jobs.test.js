// Background jobs' host layer (host/jobs.js): the job/list stream into the slice, one job/follow whose output stays
// here, job/kill and its status line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startJobs, JOB_OUTPUT_KEEP, shownOutput } from '../../client/js/host/jobs.js';
import { withTable } from '../../client/js/i18n/words.js';
import { EN } from '../../client/js/i18n/en.js';
import { FOLLOW_RETRY_MS, CONTROL_RETRY_MS } from '../../client/js/host/live.js';
import { spoken } from './helpers/spoken.js';

// the marker a held output carries where bytes were dropped (host/jobs.js DROPPED, without its newline)
const DROPPED = '\u0000dropped\u0000';
const job = (id, status = 'running', more = {}) => ({ id, kind: 'bash', label: id, owner: 's1', status, startedAt: 1, output: { total: 0, earliest: 0 }, ...more });

function fakeMux() {
  const streams = [];
  return {
    streams,
    stream(endpoint, args, handlers = {}) {
      // an end or an error finishes the stream, as the real mux's does
      const s = {
        endpoint, args, cancelled: false, cancel() { s.cancelled = true; },
        handlers: {
          onItem: v => handlers.onItem?.(v),
          onEnd: () => { s.cancelled = true; handlers.onEnd?.(); },
          onError: e => { s.cancelled = true; handlers.onError?.(e); },
        },
      };
      streams.push(s);
      return { cancel: () => s.cancel() };
    },
    live(endpoint) { return streams.filter(s => s.endpoint === endpoint && !s.cancelled); },
  };
}

function fakeTimers() {
  return {
    list: [], n: 0,
    after(ms, fn) { const id = ++this.n; this.list.push({ id, ms, fn }); return id; },
    cancel(id) { this.list = this.list.filter(t => t.id !== id); },
    fire() { const t = this.list.shift(); t?.fn(); },
  };
}

function rig(call = async () => ({ outcome: 'requested' })) {
  const store = createStore({ initial: emptyState(), reducers });
  const mux = fakeMux();
  const timers = fakeTimers();
  const outputs = [];
  const calls = [];
  const dispatched = [];
  const dispatch = store.dispatch.bind(store);
  store.dispatch = (name, payload) => { dispatched.push(name); return dispatch(name, payload); };
  const jobs = startJobs({ store, mux, timers, call: (m, a) => { calls.push([m, a]); return call(m, a); }, onOutput: id => outputs.push(id) });
  return { store, mux, timers, outputs, calls, dispatched, jobs };
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
  assert.deepEqual(spoken(gone.store.get().status.line), 'stop: job/not-found');
  assert.equal(gone.store.get().status.bad, true);
  const out = rig(async () => { throw Object.assign(new Error('401'), { status: 401 }); });
  assert.equal(await out.jobs.kill('s1', 'a'), false);
  assert.equal(spoken(out.store.get().status.line), 'Not signed in — open the URL gravit-face printed');
});

test('watching another conversation, or none, cancels the follow too', () => {
  const r = rig();
  r.jobs.watch('s1');
  r.jobs.follow('s1', job('a'));
  r.jobs.watch('s2');
  assert.equal(r.mux.live('job/follow').length, 0);
  assert.equal(r.jobs.outputOf('a'), null);
  r.jobs.follow('s2', job('b'));
  r.jobs.watch('s2');
  assert.equal(r.mux.live('job/follow').length, 1, 'the same conversation keeps its follow');
  r.jobs.watch(null);
  assert.equal(r.mux.live('job/follow').length, 0);
});

test('a job/list the host ends is opened again after FOLLOW_RETRY_MS, the rows kept until its first frame', () => {
  const r = rig();
  r.jobs.watch('s1');
  const first = r.mux.streams[0];
  first.handlers.onItem({ type: 'rows', jobs: [job('a')] });
  first.handlers.onEnd();
  assert.deepEqual(r.timers.list.map(t => t.ms), [FOLLOW_RETRY_MS]);
  r.timers.fire();
  const lists = r.mux.streams.filter(s => s.endpoint === 'job/list');
  assert.equal(lists.length, 2);
  assert.deepEqual(lists[1].args, { request: { sessionId: 's1' } });
  assert.deepEqual(r.store.get().jobs.rows.map(j => j.id), ['a']);
  first.handlers.onItem({ type: 'rows', jobs: [job('x')] });   // the ended stream's late frame lands nowhere
  assert.deepEqual(r.store.get().jobs.rows.map(j => j.id), ['a']);
  lists[1].handlers.onItem({ type: 'rows', jobs: [] });
  assert.deepEqual(r.store.get().jobs.rows, []);
});

test('a refused job/list is opened again after the longer CONTROL_RETRY_MS', () => {
  const r = rig();
  r.jobs.watch('s1');
  r.mux.streams[0].handlers.onError({ code: 'x' });
  assert.deepEqual(r.timers.list.map(t => t.ms), [CONTROL_RETRY_MS]);
  assert.ok(CONTROL_RETRY_MS > FOLLOW_RETRY_MS);
  r.timers.fire();
  assert.equal(r.mux.live('job/list').length, 1);
});

test('watching another conversation in the backoff opens nothing for the old one; the same one opens at once, once', () => {
  const r = rig();
  r.jobs.watch('s1');
  r.mux.streams[0].handlers.onEnd();
  const fire = r.timers.list[0].fn;
  r.jobs.watch('s2');
  assert.equal(r.timers.list.length, 0, 'the backoff is cancelled');
  fire();   // a timer whose cancel did not land
  assert.deepEqual(r.mux.live('job/list').map(s => s.args.request.sessionId), ['s2']);

  const q = rig();
  q.jobs.watch('s1');
  q.mux.streams[0].handlers.onItem({ type: 'rows', jobs: [job('a')] });
  q.mux.streams[0].handlers.onEnd();
  const late = q.timers.list[0].fn;
  q.jobs.watch('s1');
  assert.equal(q.timers.list.length, 0);
  assert.deepEqual(q.mux.live('job/list').map(s => s.args.request.sessionId), ['s1']);
  late();
  assert.equal(q.mux.streams.filter(s => s.endpoint === 'job/list' && !s.cancelled).length, 1, 'no second stream');
  assert.deepEqual(q.store.get().jobs.rows.map(j => j.id), ['a']);

  const n = rig();
  n.jobs.watch('s1');
  n.mux.streams[0].handlers.onEnd();
  n.jobs.watch(null);
  assert.equal(n.timers.list.length, 0);
});

test('the dropped line never appears twice in a row', () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  const f = r.mux.streams[0].handlers;
  f.onItem({ type: 'opened', job: job('a', 'running', { output: { total: 500, earliest: 200 } }), from: 200 });
  f.onItem({ type: 'output', chunks: [{ at: 200, text: 'one', gapBefore: true }], next: 203, lossy: true });
  assert.equal(r.jobs.outputOf('a').text, `${DROPPED}\none`);
});

test('a re-opened follow past what was held marks the bytes it lost', () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  const f = r.mux.streams[0].handlers;
  f.onItem({ type: 'opened', job: job('a'), from: 0 });
  f.onItem({ type: 'output', chunks: [{ at: 0, text: 'old\n' }], next: 4 });
  f.onItem({ type: 'opened', job: job('a', 'running', { output: { total: 900, earliest: 800 } }), from: 800 });
  f.onItem({ type: 'output', chunks: [{ at: 800, text: 'new' }], next: 803 });
  assert.equal(r.jobs.outputOf('a').text, `old\n${DROPPED}\nnew`);
});

test('the cap never keeps half a surrogate pair', () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  const f = r.mux.streams[0].handlers;
  f.onItem({ type: 'opened', job: job('a'), from: 0 });
  const head = `${DROPPED}\n`;
  // a 100-unit prefix, ten pairs, then a fill: the text is past the cap and the cut lands on index 101, the first pair's
  // low half
  const pairs = '😀'.repeat(10);
  const fill = 'a'.repeat(JOB_OUTPUT_KEEP - head.length - 19);
  const big = `${'x'.repeat(100)}${pairs}${fill}`;
  assert.ok(big.length > JOB_OUTPUT_KEEP);
  assert.equal(big.length - (JOB_OUTPUT_KEEP - head.length), 101);
  f.onItem({ type: 'output', chunks: [{ at: 0, text: big }], next: 1 });
  const text = r.jobs.outputOf('a').text;
  assert.ok(text.startsWith(head));
  const c = text.charCodeAt(head.length);
  assert.ok(!(c >= 0xdc00 && c <= 0xdfff), 'no lone low surrogate after the dropped line');
  assert.ok(text.length <= JOB_OUTPUT_KEEP);
});

test('a follow the host ends without a status, or refuses, reads as ended and calls onOutput', () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  r.mux.streams[0].handlers.onItem({ type: 'opened', job: job('a'), from: 0 });
  r.mux.streams[0].handlers.onEnd();
  assert.deepEqual(r.jobs.outputOf('a'), { text: '', ended: true });
  assert.deepEqual(r.outputs, ['a', 'a']);
  r.jobs.follow('s1', job('b'));
  r.mux.streams[1].handlers.onError({ code: 'job/not-found' });
  assert.deepEqual(r.jobs.outputOf('b'), { text: '', ended: true, error: 'job/not-found' });
  assert.deepEqual(r.outputs, ['a', 'a', 'b']);
  assert.equal(r.mux.streams.length, 2, 'nothing reopens it');
});

test('a kill answered with no known outcome says stop: failed and answers false', async () => {
  const r = rig(async () => ({ outcome: 'maybe' }));
  assert.equal(await r.jobs.kill('s1', 'a'), false);
  assert.equal(spoken(r.store.get().status.line), 'stop: failed');
});

// the dropped-output marker after a switch of the table (plan 7 Task 2, Review Focus 4): the held text carries a sentinel,
// so a re-opened follow under another table finds its own marker, and the draw words it in the table that stands
const ZH_DROPPED = Object.freeze({ 'jobs.dropped': '…之前的输出已丢弃…' });
const count = (text, word) => text.split(word).length - 1;

test('a re-opened follow after a table switch adds no second marker', () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  const f = r.mux.streams[0].handlers;
  f.onItem({ type: 'opened', job: job('a', 'running', { output: { total: 50, earliest: 0 } }), from: 0 });
  f.onItem({ type: 'output', chunks: [{ at: 0, text: 'one\n' }], next: 4 });
  // a re-open under English whose oldest byte is past what was held: the bytes between are gone, one marker
  f.onItem({ type: 'opened', job: job('a', 'running', { output: { total: 60, earliest: 30 } }), from: 30 });
  assert.equal(r.jobs.outputOf('a').text, `one\n${DROPPED}\n`);
  // the mux re-opens the follow under the other table, its oldest byte past what was held: the marker already ends the text
  withTable(ZH_DROPPED, () => f.onItem({ type: 'opened', job: job('a', 'running', { output: { total: 90, earliest: 60 } }), from: 60 }));
  const text = r.jobs.outputOf('a').text;
  assert.equal(count(text, DROPPED), 1, 'one marker');
  assert.equal(count(withTable(ZH_DROPPED, () => shownOutput(text)), '…之前的输出已丢弃…'), 1);
  assert.equal(count(withTable(ZH_DROPPED, () => shownOutput(text)), EN['jobs.dropped']), 0, 'no English one beside it');
});

test('the marker is drawn in the table that stands', () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  const f = r.mux.streams[0].handlers;
  f.onItem({ type: 'opened', job: job('a', 'running', { output: { total: 500, earliest: 200 } }), from: 200 });
  f.onItem({ type: 'output', chunks: [{ at: 200, text: 'one\n' }, { at: 300, text: 'two', gapBefore: true }], next: 305 });
  const held = r.jobs.outputOf('a').text;
  assert.equal(shownOutput(held), `${EN['jobs.dropped']}\none\n${EN['jobs.dropped']}\ntwo`);
  assert.equal(withTable(ZH_DROPPED, () => shownOutput(held)), '…之前的输出已丢弃…\none\n…之前的输出已丢弃…\ntwo');
  assert.equal(shownOutput('no marker here'), 'no marker here');
});

test("an output frame's NUL characters arrive as U+FFFD, so no output can hold the marker", () => {
  const r = rig();
  r.jobs.follow('s1', job('a'));
  const f = r.mux.streams[0].handlers;
  f.onItem({ type: 'opened', job: job('a', 'running', { output: { total: 20, earliest: 0 } }), from: 0 });
  f.onItem({ type: 'output', chunks: [{ at: 0, text: `a${DROPPED}\nb\u0000` }], next: 20 });
  assert.equal(r.jobs.outputOf('a').text, 'a\uFFFDdropped\uFFFD\nb\uFFFD');
  assert.equal(shownOutput(r.jobs.outputOf('a').text), 'a\uFFFDdropped\uFFFD\nb\uFFFD');
});
