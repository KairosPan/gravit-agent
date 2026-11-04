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
import { t } from '../../client/js/i18n/words.js';

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
  // app.js's own lines with a param, as the table holds them
  assert.equal(t('status.uploadFailed', { name: 'a&b.csv' }), 'upload a&b.csv: the upload failed');
  assert.equal(t('status.fail', { what: t('status.verb.send'), reason: t('status.unreadable', { name: "it's.png" }) }), "send: it's.png could not be read");
  assert.equal(t('jobs.outputEnded'), 'output ended');
});
