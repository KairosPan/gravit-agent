// The status lines the host layer writes read the words table (plan 6 Task 5): each line, as the store holds it, in its
// exact bytes — plain text, a param put in as it is (never escaped here: renderStatus escapes once) — so a th() stored in
// the state, escaped again at the render, shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { mapFrame } from '../../client/js/wire/mapper.js';
import { makeActions, notSignedIn, failLine } from '../../client/js/host/actions.js';
import { startLive } from '../../client/js/host/live.js';
import { startTraces } from '../../client/js/host/traces.js';
import { chipText, endLine } from '../../client/js/host/jobs-view.js';
import { pillsText } from '../../client/js/host/turns-view.js';
import { admit, limitsLine, modelRefusalLine, attachmentsLine, extOf, DEFAULT_LIMITS } from '../../client/js/composer/files.js';
import { renderStatus } from '../../client/js/render/messages.js';
import { boot } from '../../client/js/app.js';
import { fakeWindow } from './helpers/fake-dom.js';
import { valueEditor } from './helpers/value-editor.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const conv = (id, over = {}) => ({ id, title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages: [], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const err = over => Object.assign(new Error('boom'), over);

function actionsRig(answers = {}, convs = [conv('s1')]) {
  const store = createStore({ initial: emptyState(), reducers });
  store.dispatch('hostList', { conversations: convs });
  store.dispatch('nav', { screen: 'messages', id: 's1' });
  const call = async endpoint => { const a = answers[endpoint]; if (a instanceof Error) throw a; return typeof a === 'function' ? a() : a; };
  const postJson = async () => { throw err({ code: 'face/<refused>' }); };
  const actions = makeActions({ store, call, answerGate: async () => { throw err({ code: 'gate/gone' }); }, postJson, requestId: () => 'r', timeZone: () => 'UTC' });
  return { store, actions, line: () => store.get().status.line };
}

test('the boot line, and a failure line: its verb, then the code, the HTTP status or the message; a 401 as notSignedIn', () => {
  assert.equal(emptyState().status.line, 'connecting…');
  assert.equal(notSignedIn(), 'Not signed in — open the URL gravit-face printed');
  assert.equal(failLine({ status: 401 }, 'fork'), 'Not signed in — open the URL gravit-face printed');
  assert.equal(failLine({ code: 'a/<b>' }, 'fork'), 'fork: a/<b>');
  assert.equal(failLine({ status: 502 }, 'fork'), 'fork: HTTP 502');
  assert.equal(failLine({ message: "can't & won't" }, 'fork'), "fork: can't & won't");
  assert.equal(failLine({}, 'fork'), 'fork: failed');
  assert.equal(renderStatus({ line: failLine({ code: 'a/<b>' }, 'fork') }), '<div class="status-line" role="status">fork: a/&lt;b&gt;</div>', 'escaped once, at the render');
});

test("the actions' lines, each verb in its words", async () => {
  const r = actionsRig({
    'session/cancel': err({ code: 'x/1' }), 'session/rename': err({ code: 'x/2' }), 'session/fork': () => ({}), 'commands/execute': () => undefined,
    'session/prompt': err({ code: 'x/3' }), 'session/create': () => ({}), 'subagents/interruptByParent': () => ({ accepted: false }),
    'workspace/pinSession': () => ({}),
  });
  await r.actions.stop('s1'); assert.equal(r.line(), 'stop: x/1');
  await r.actions.rename('s1', 'New'); assert.equal(r.line(), 'rename: x/2');
  await r.actions.fork('s1'); assert.equal(r.line(), 'fork: session/fork returned no sessionId');
  await r.actions.runCommand('s1', '/<b>'); assert.equal(r.line(), 'no command claimed /<b>');
  await r.actions.send('hello'); assert.equal(r.line(), 'send: x/3');
  await r.actions.newConversation({ text: 'hi' }); assert.equal(r.line(), 'new message: session/create returned no sessionId');
  await r.actions.stopChild('s1', 'c1', 'x'); assert.equal(r.line(), 'stop: refused');
  await r.actions.pin('s1'); assert.equal(r.line(), 'Pin failed. Try again later.');
  await r.actions.archive('s1', true); assert.equal(r.line(), 'archive: face/<refused>');
  await r.actions.archive('s1', false); assert.equal(r.line(), 'un-archive: face/<refused>');
  await r.actions.remove('s1'); assert.equal(r.line(), 'delete: face/<refused>');
  await r.actions.answer('ev', 'rejected'); assert.equal(r.line(), 'answer: gate/gone');
  assert.deepEqual(await r.actions.talkTo({ id: 'b', homeCwd: '/b' }), { error: 'talk to: session/create returned no sessionId' });

  const ok = actionsRig({ 'session/cancel': () => ({}), 'subagents/interruptByParent': () => ({}) });
  await ok.actions.stop('s1'); assert.equal(ok.line(), 'Stopped. A paused goal resumes with /goal resume');
  await ok.actions.stopChild('s1', 'c1', ''); assert.equal(ok.line(), 'Stopping the child');
  await ok.actions.stopChild('s1', 'c1', '<Scout>'); assert.equal(ok.line(), 'Stopping <Scout>');

  const busy = actionsRig({}, [conv('s1', { running: true })]);
  await busy.actions.archive('s1', true); assert.equal(busy.line(), 'Stop Gravit first');
  const waiting = actionsRig({}, [conv('s1', { messages: [{ id: 'q', kind: 'question', from: 'gravit', text: '', data: { questions: [] } }] })]);
  await waiting.actions.archive('s1', true); assert.equal(waiting.line(), 'Answer the waiting card first');
});

function liveRig({ list = { items: [] }, call: answer } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const streams = [];
  let opts = null;
  const mux = { stream(name, args, cbs) { streams.push({ name, cbs }); return { cancel() {} }; }, answer: async () => {}, close() {} };
  const call = async (endpoint, args) => (answer ? answer(endpoint, args) : endpoint === 'session/list' ? list : undefined);
  const getJson = async () => ({});
  const timers = { after() { return {}; }, cancel() {} };
  startLive({ store, openMux: o => { opts = o; return mux; }, call, mapFrame, getJson, timers, now: () => 1 });
  return { store, streams, opts: () => opts, line: () => store.get().status.line };
}

test("the live layer's lines", async () => {
  const r = liveRig({ list: { items: null } });
  r.opts().onDown('socket <closed>');
  assert.equal(r.line(), 'Reconnecting… (socket <closed>)');
  r.streams.find(s => s.name === 'session/control').cbs.onError({});
  assert.equal(r.line(), 'live session state unavailable: error');
  r.opts().onReady({});
  await settle();
  assert.equal(r.line(), 'the host answered without a session list');

  const down = liveRig({ call: async endpoint => { if (endpoint === 'session/list') throw Object.assign(new Error('x'), { status: 503 }); } });
  down.opts().onReady({});
  await settle();
  assert.equal(down.line(), 'list: HTTP 503');

  const rows = [{ sessionId: 's1', updatedAt: 5, agentAvailable: false, running: false, blank: false }];
  const cold = liveRig({ call: async endpoint => (endpoint === 'session/list' ? { items: rows } : endpoint === 'session/projections' ? { values: {} } : undefined) });
  cold.opts().onReady({});
  await settle();
  cold.store.dispatch('nav', { screen: 'messages', id: 's1' });
  cold.opts().onEvent('api-session/error', ['s1', '']);
  assert.equal(cold.line(), 'the agent failed');
});

test('a trace the loader could not read, with no words of its own', async () => {
  const store = createStore({ initial: emptyState(), reducers });
  const room = conv('room', { kind: 'group', members: ['gravit', 'b'], memberSessions: ['m1'] });
  store.dispatch('hostList', { conversations: [room] });
  store.dispatch('hostEvent', { convId: 'room', message: { id: 'e9', seq: 9, at: 1, from: 'b', kind: 'text', text: 'Hold', data: { memberSessionId: 'm1', memberTurn: 3 } } });
  const traces = startTraces({ store, call: async () => ({}), loadMemberTrace: async () => { throw {}; }, now: () => 5 });
  await traces.open('room', 'e9');
  assert.equal(store.get().traces.room.e9.line, 'The trace could not be read.');
});

test("the jobs' chip and end lines, the pills, and the composer's file lines", () => {
  assert.equal(chipText([{}], []), '1 job running');
  assert.equal(chipText([], [{}, {}]), '2 jobs finished');
  assert.equal(endLine({ status: 'completed', detail: 'exit code: 0' }), 'exit 0');
  assert.equal(endLine({ status: 'completed' }), 'exit');
  assert.equal(endLine({ status: 'killed', detail: 'signal: TERM' }), 'signal TERM');
  assert.equal(endLine({ status: 'killed' }), 'killed');
  assert.equal(endLine({ status: 'failed' }), 'failed');
  assert.deepEqual(pillsText({ turns: 1, steps: 2, speed: 38, tokens: 182_000, cache: 0.63 }), ['1 turn · 2 steps · 38 tok/s', '182k tokens · cache 63%']);
  const big = { key: 'a', name: 'a<b>.png', bytes: DEFAULT_LIMITS.maxImageBytes + 1, mediaType: 'image/png' };
  assert.equal(admit([], [big]).refusal, 'a<b>.png is over 20 MB');
  assert.equal(limitsLine(DEFAULT_LIMITS), 'Images: up to 20 a message, 20 MB each');
  assert.equal(modelRefusalLine('<Scout>'), "<Scout>'s model takes no images. Remove the image, or run <Scout> on a model that does.");
  assert.equal(attachmentsLine([{ type: 'image' }, { type: 'file' }]), 'image, file');
  assert.equal(extOf('README'), 'FILE');
});

// app.js on a fake window: one live conversation, its mux and its uploads recorded for the test to answer
async function appRig() {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const streams = [];
  let opts = null;
  const mux = { stream(name, args, cbs) { const st = { name, args, cbs }; streams.push(st); return { cancel() {} }; }, answer: async () => {}, close() {} };
  const rows = [{ sessionId: 's1', updatedAt: 5, agentAvailable: true, running: false, blank: false }];
  const call = async endpoint => (endpoint === 'session/list' ? { items: rows } : endpoint === 'session/projections' ? { asOfSeq: 20, values: {} } : endpoint === 'session/page' ? { records: [] } : undefined);
  const getJson = async path => (path === '/data/channels.json' ? { ok: true, root: '/r', channels: [], ungrouped: [], archived: [], presets: {} } : { ok: true, archived: [], deleted: [], bots: [] });
  const uploads = [];
  const attachments = {
    limits: () => DEFAULT_LIMITS, readLimits: async () => true, thumb: async () => {},
    upload(id, file) { const u = {}; u.done = new Promise((resolve, reject) => { u.fail = reject; }); uploads.push(u); return { done: u.done, abort() {} }; },
  };
  const store = boot(f.win, { editor: valueEditor, attachments, openMux: o => { opts = o; return mux; }, call, getJson, postJson: async () => ({ ok: true }), markdown: null, now: () => 1 });
  await settle();
  opts.onReady({});
  await settle();
  return { f, store, streams, uploads };
}

test("app.js's job note: a follow refused with no code, and one the host ended while the job runs", async () => {
  for (const [end, line] of [[st => st.cbs.onError({}), 'output unavailable: error'], [st => st.cbs.onEnd(), 'output ended']]) {
    const { f, store, streams } = await appRig();
    try {
      streams.filter(st => st.name === 'job/list').at(-1).cbs.onItem({ type: 'rows', jobs: [{ id: 'j1', kind: 'bash', label: 'run', owner: 's1', status: 'running', startedAt: 0, output: { total: 0, earliest: 0 } }] });
      store.dispatch('toggleDetails');
      await settle();
      const note = f.withId('jobnote-j1', { presentIf: /id="jobnote-j1"/ });
      f.click({ tagName: 'SUMMARY', dataset: { action: 'openJob', job: 'j1' }, parentElement: { tagName: 'DETAILS', open: false } });
      await settle();
      end(streams.filter(st => st.name === 'job/follow').at(-1));
      assert.equal(note.textContent, line);
    } finally {
      store.timers.clear();
    }
  }
});

test("app.js's upload line: a failure with no words of its own names the file", async () => {
  const { f, store, uploads } = await appRig();
  try {
    const input = f.withId('attach-input', { tagName: 'INPUT', type: 'file' });
    input.files = [{ name: 'a&b.csv', size: 10, type: 'text/csv', arrayBuffer: async () => new ArrayBuffer(0) }];
    f.fire('root', 'change', { target: input });
    uploads[0].fail(new Error(''));
    await settle();
    assert.equal(store.get().status.line, 'upload a&b.csv: the upload failed');
    assert.match(f.html(), /role="status">upload a&amp;b\.csv: the upload failed</);
  } finally {
    store.timers.clear();
  }
});
