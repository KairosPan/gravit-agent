// The memory gate's host (host/memory-gate.js): each seat card's lessons asked once by its call id, kept in the store's
// memoryGate slice; the owner's override of a red line posted in their words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMemoryGate, gateOf, GATE_WATCH_READ_MS } from '../../client/js/host/memory-gate.js';
import { createStore } from '../../client/js/store.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';

const NOW = Date.UTC(2026, 10, 15, 15);
const conv = (id, messages) => ({ id, title: id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: NOW, created: null, messages, loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0 });
const card = (id, callId, over = {}) => ({ id, seq: 1, at: NOW, from: 'gravit', kind: 'card', text: 'Your call', data: { eventId: id, sessionId: 'w1', toolName: 'mcp__account__portfolio_live_order', ...(callId === undefined ? {} : { callId }), venue: 'paper-1', line: 'Account seat' }, ...over });
const GATE = { callId: 'c:1', state: 'checked', lines: [], redLine: false, overridden: false };
const storeOf = messages => createStore({ initial: R.hostList(emptyState(), { conversations: [conv('w1', messages)], channels: [], bots: [] }), reducers: R });
const settle = () => new Promise(r => setTimeout(r, 0));
const failWith = status => Object.assign(new Error(`HTTP ${status}`), { status });

test('ensure() asks each seat card with a call id once, by its encoded id, and keeps what the face answered', async () => {
  const store = storeOf([card('e1', 'c:1'), card('e2', 'c2'), card('e3', 'c3'), card('e4', undefined), { ...card('e5', 'c5'), kind: 'approval' }]);
  const asked = [];
  const getJson = async path => {
    asked.push(path);
    if (path.endsWith('c%3A1')) return { ok: true, gate: GATE };
    if (path.endsWith('c2')) throw failWith(404);
    throw failWith(500);
  };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => NOW });
  await gate.ensure();
  await gate.ensure();
  assert.deepEqual(asked, ['/data/memory/gate?callId=c%3A1', '/data/memory/gate?callId=c2', '/data/memory/gate?callId=c3'], 'once each; no card without a call id, no approval card');
  const kept = store.get().memoryGate;
  assert.deepEqual(kept['c:1'], { status: 'ready', gate: GATE, at: NOW, again: 0 });
  assert.deepEqual(kept.c2, { status: 'none', at: NOW, again: 0 });
  assert.deepEqual(kept.c3, { status: 'failed', at: NOW, again: 0 });
  assert.equal(gateOf(store.get(), store.get().conversations[0].messages[0]), kept['c:1'].gate);
  assert.equal(gateOf(store.get(), store.get().conversations[0].messages[1]), null);
  assert.equal(gateOf(store.get(), store.get().conversations[0].messages[3]), null);
});

test('a card is asked while its read is in flight once only, and a body with no gate is a failed read', async () => {
  const store = storeOf([card('e1', 'c1')]);
  const asked = [];
  let release;
  const getJson = path => { asked.push(path); return new Promise(r => { release = () => r({ ok: true }); }); };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => NOW });
  const first = gate.ensure();
  assert.deepEqual(store.get().memoryGate.c1, { status: 'loading', at: NOW, again: 0 });
  await gate.ensure();
  release();
  await first;
  assert.equal(asked.length, 1);
  assert.deepEqual(store.get().memoryGate.c1, { status: 'failed', at: NOW, again: 0 });
});

test('an answered card is asked once too, for what was registered; a call id outside the grammar is not asked', async () => {
  const store = storeOf([card('e1', 'c1', { answer: 'approved' }), card('e2', 'bad id!'), card('e3', '')]);
  const asked = [];
  const gate = startMemoryGate({ store, getJson: async path => { asked.push(path); return { ok: true, gate: GATE }; }, postJson: async () => ({ ok: true }) });
  await gate.ensure();
  assert.deepEqual(asked, ['/data/memory/gate?callId=c1']);
});

test('override() posts the trimmed reason (and wrongIf only when said), resolves true, and asks the gate once more', async () => {
  const store = storeOf([card('e1', 'c-1')]);
  const asked = [];
  const posted = [];
  const getJson = async path => { asked.push(path); return { ok: true, gate: { ...GATE, callId: 'c-1', redLine: true, overridden: asked.length > 1 } }; };
  const gate = startMemoryGate({ store, getJson, postJson: async (path, body) => { posted.push([path, body]); return { ok: true }; } });
  await gate.ensure();
  assert.equal(await gate.override('c-1', ' why ', ''), true);
  assert.equal(await gate.override('c-1', 'because', '  it rallies  '), true);
  assert.deepEqual(posted, [['/data/memory/gate/override', { callId: 'c-1', reason: 'why' }], ['/data/memory/gate/override', { callId: 'c-1', reason: 'because', wrongIf: 'it rallies' }]]);
  await settle();
  assert.equal(asked.length, 3, 'asked once at first, once after each override');
  assert.equal(store.get().memoryGate['c-1'].gate.overridden, true);
});

test('override() resolves false on a refusal, and on a reason with no words without posting', async () => {
  const store = storeOf([card('e1', 'c-1')]);
  const posted = [];
  const gate = startMemoryGate({ store, getJson: async () => ({ ok: true, gate: GATE }), postJson: async (path, body) => { posted.push([path, body]); throw Object.assign(new Error('this card has no red line'), { status: 409 }); } });
  assert.equal(await gate.override('c-1', 'why', ''), false);
  assert.equal(posted.length, 1);
  assert.equal(await gate.override('c-1', '   ', ''), false);
  assert.equal(posted.length, 1, 'no words: nothing posted');
});

test('the slice keeps each call by its id, a call id that is an object key among them', () => {
  let s = emptyState();
  s = R.memoryGateLoading(s, { callId: '__proto__' });
  assert.ok(Object.hasOwn(s.memoryGate, '__proto__'));
  assert.deepEqual(s.memoryGate.__proto__, { status: 'loading', again: 0 });
  s = R.memoryGateLoaded(s, { callId: 'a', gate: GATE });
  s = R.memoryGateNone(s, { callId: 'b' });
  s = R.memoryGateFailed(s, { callId: 'c' });
  assert.deepEqual(Object.keys(s.memoryGate), ['__proto__', 'a', 'b', 'c']);
  assert.equal(R.memoryGateLoaded(s, { callId: 7, gate: GATE }), s, 'no call id: no change');
  assert.equal(R.memoryGateLoaded(s, { callId: 'd', gate: null }), s, 'no gate: no change');
  const proto = card('e1', 'toString');
  assert.equal(gateOf(s, proto), null, 'a key of Object.prototype is no entry');
});

// ---- the reads again: an answered card until its gate says what was registered, and a failed read, each at most three
// more times, 2,000 ms apart, brought by the renders that call ensure()
const answer = (store, convId, msgId, outcome = 'approved') => store.dispatch('hostGateGone', { eventId: msgId, outcome });

test('an answered card whose gate says nothing registered is read again, 2,000 ms apart, at most three more times', async () => {
  const store = storeOf([card('ev-1', 'c1')]);
  let clock = NOW;
  const asked = [];
  const getJson = async path => { asked.push(path); return { ok: true, gate: { ...GATE, callId: 'c1', lines: [{ order: 'buy 1 NVDA', lessons: [] }] } }; };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => clock });
  await gate.ensure();
  assert.equal(asked.length, 1, 'the waiting card read once');
  clock += 2_000;
  await gate.ensure();
  assert.equal(asked.length, 1, 'still waiting: not read again');
  answer(store, 'w1', 'ev-1');
  assert.equal(store.get().conversations[0].messages[0].answer, 'approved');
  await gate.ensure();
  assert.equal(asked.length, 2, 'answered: read again');
  assert.equal(store.get().memoryGate.c1.again, 1);
  clock += 1_999;
  await gate.ensure();
  assert.equal(asked.length, 2, 'inside 2,000 ms of the last read: nothing');
  clock += 1;
  await gate.ensure();
  assert.equal(asked.length, 3);
  clock += 2_000;
  await gate.ensure();
  assert.equal(asked.length, 4, 'the third read again');
  clock += 10_000;
  await gate.ensure();
  await gate.ensure();
  assert.equal(asked.length, 4, 'three spent: never again');
});

test('once a line carries registered, the answered card is not read again', async () => {
  const store = storeOf([card('ev-1', 'c1')]);
  let clock = NOW;
  const asked = [];
  const getJson = async path => {
    asked.push(path);
    return { ok: true, gate: { ...GATE, callId: 'c1', lines: [{ order: 'buy 1 NVDA', lessons: [], ...(asked.length > 1 ? { registered: 'registered: open' } : {}) }] } };
  };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => clock });
  await gate.ensure();
  answer(store, 'w1', 'ev-1');
  clock += 2_000;
  await gate.ensure();
  assert.equal(asked.length, 2);
  assert.equal(store.get().memoryGate.c1.gate.lines[0].registered, 'registered: open');
  clock += 60_000;
  await gate.ensure();
  assert.equal(asked.length, 2, 'registered: no further read');
});

test('a failed read is retried under the same limits; a none stays none, an answered card among them', async () => {
  const store = storeOf([card('ev-1', 'c1'), card('ev-2', 'c2', { answer: 'approved' })]);
  let clock = NOW;
  const asked = [];
  const getJson = async path => { asked.push(path); throw failWith(path.endsWith('c2') ? 404 : 500); };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => clock });
  await gate.ensure();
  assert.deepEqual(asked, ['/data/memory/gate?callId=c1', '/data/memory/gate?callId=c2']);
  clock += 1_000;
  await gate.ensure();
  assert.equal(asked.length, 2, 'inside 2,000 ms: nothing');
  for (let i = 0; i < 5; i++) { clock += 2_000; await gate.ensure(); }
  assert.deepEqual(asked.slice(2), ['/data/memory/gate?callId=c1', '/data/memory/gate?callId=c1', '/data/memory/gate?callId=c1'], 'three retries of the failed read, none of the 404');
  assert.equal(store.get().memoryGate.c2.status, 'none');
  assert.equal(store.get().memoryGate.c1.status, 'failed');
});

test('a failed read retried that lands its gate is ready; while a read again runs the kept gate is still drawn', async () => {
  const store = storeOf([card('ev-1', 'c1')]);
  let clock = NOW;
  let release = null;
  let n = 0;
  const kept = { ...GATE, callId: 'c1', lines: [{ order: 'buy 1 NVDA', lessons: [] }] };
  const getJson = path => {
    n++;
    if (n === 1) return Promise.resolve({ ok: true, gate: kept });
    return new Promise(r => { release = () => r({ ok: true, gate: { ...kept, lines: [{ order: 'buy 1 NVDA', lessons: [], registered: 'registered: open' }] } }); });
  };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => clock });
  await gate.ensure();
  answer(store, 'w1', 'ev-1');
  clock += 2_000;
  const again = gate.ensure();
  const m = store.get().conversations[0].messages[0];
  assert.equal(store.get().memoryGate.c1.busy, true);
  assert.equal(gateOf(store.get(), m), kept, 'the kept gate stays drawn while the read again runs');
  await gate.ensure();
  assert.equal(n, 2, 'one read again in flight');
  release();
  await again;
  assert.equal(gateOf(store.get(), m).lines[0].registered, 'registered: open');
  assert.equal(store.get().memoryGate.c1.busy, undefined);
  // a read again that fails keeps the gate as it was
  const failed = R.memoryGateFailed(R.memoryGateLoading(store.get(), { callId: 'c1', at: clock, again: 2 }), { callId: 'c1' });
  assert.equal(failed.memoryGate.c1.status, 'ready');
  assert.equal(failed.memoryGate.c1.again, 2);
  assert.equal(failed.memoryGate.c1.busy, undefined);
});

// ---- a line whose Account card the face watches (Guard mode): read again 5,000 ms apart for as long as it watches,
// and those reads are not counted against the three
const watchedGate = (watching, registered) => ({ ...GATE, callId: 'c1', lines: [{ order: 'buy 1 NVDA', lessons: [], ...(watching ? { watching: true } : {}), ...(registered ? { registered } : {}) }] });

test('an answered card with a watching line is read again 5,000 ms apart, uncounted, until the line stops watching', async () => {
  assert.equal(GATE_WATCH_READ_MS, 5_000);
  const store = storeOf([card('ev-1', 'c1', { answer: 'approved' })]);
  let clock = NOW;
  const asked = [];
  let answer = () => watchedGate(true);
  const getJson = async path => { asked.push(path); return { ok: true, gate: answer() }; };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => clock });
  await gate.ensure();
  assert.equal(asked.length, 1);
  for (const step of [2_000, 2_999]) { clock += step; await gate.ensure(); }
  assert.equal(asked.length, 1, 'inside 5,000 ms of the last read: nothing');
  for (let i = 0; i < 5; i++) { clock += 1 + (i === 0 ? 0 : 4_999); await gate.ensure(); }
  assert.equal(asked.length, 6, 'five reads again while it watches: more than three');
  assert.equal(store.get().memoryGate.c1.again, 0, 'none of them counted');
  answer = () => watchedGate(false);
  clock += 5_000;
  await gate.ensure();
  assert.equal(asked.length, 7, 'the read that finds the watch over');
  for (let i = 0; i < 3; i++) { clock += 2_000; await gate.ensure(); }
  assert.equal(asked.length, 10, 'nothing registered yet: the three counted reads follow');
  clock += 60_000;
  await gate.ensure();
  assert.equal(asked.length, 10);
});

test('a watching line that turns registered: one more read, then none', async () => {
  const store = storeOf([card('ev-1', 'c1', { answer: 'approved' })]);
  let clock = NOW;
  const asked = [];
  const getJson = async path => { asked.push(path); return { ok: true, gate: asked.length === 1 ? watchedGate(true) : watchedGate(false, 'registered: buy') }; };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => clock });
  await gate.ensure();
  clock += 5_000;
  await gate.ensure();
  assert.equal(asked.length, 2);
  clock += 60_000;
  await gate.ensure();
  assert.equal(asked.length, 2);
});

test('an answered gate with no lines (not connected, not checked) is not read again', async () => {
  const store = storeOf([card('ev-1', 'c1', { answer: 'approved' }), card('ev-2', 'c2', { answer: 'rejected' })]);
  let clock = NOW;
  const asked = [];
  const getJson = async path => {
    asked.push(path);
    return { ok: true, gate: path.endsWith('c1') ? { ...GATE, callId: 'c1', state: 'not connected', words: 'no memory here', lines: [] } : { ...GATE, callId: 'c2', state: 'not checked', words: 'not checked for this tool', lines: [] } };
  };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => clock });
  await gate.ensure();
  for (let i = 0; i < 4; i++) { clock += 2_000; await gate.ensure(); }
  assert.equal(asked.length, 2, 'each read once');
});

test('a read again slower than 2,000 ms does not push its next read back to the next state change', async () => {
  const store = storeOf([card('ev-1', 'c1')]);
  let clock = NOW;
  const asked = [];
  let release = null;
  const getJson = path => {
    asked.push(path);
    if (asked.length === 2) return new Promise((_, reject) => { release = () => reject(failWith(500)); });
    return Promise.reject(failWith(500));
  };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => clock });
  const renders = [];
  store.subscribe(() => { renders.push(gate.ensure()); });
  await gate.ensure();
  await Promise.all(renders);
  assert.equal(store.get().memoryGate.c1.status, 'failed');
  clock += 2_000;
  const slow = gate.ensure();
  await settle();
  assert.equal(asked.length, 2, 'the read again is out');
  clock += 3_000;
  release();
  await slow;
  await Promise.all(renders);
  assert.equal(store.get().memoryGate.c1.status, 'failed');
  await gate.ensure();
  assert.equal(asked.length, 3, 'the next ensure reads again, 3,000 ms after the slow read began, with no state change between');
});

// a gate read's own dispatch renders, and the render calls ensure() again (app.js): no card is asked twice by that
test('a render that follows each dispatch and calls ensure() asks each of three cards once, and once each per pass of reads again', async () => {
  const store = storeOf([card('ev-1', 'c1'), card('ev-2', 'c2'), card('ev-3', 'c3')]);
  let clock = NOW;
  const asked = [];
  const getJson = async path => { asked.push(path); return { ok: true, gate: { ...GATE, callId: path.slice(-2), lines: [{ order: 'buy 1 NVDA', lessons: [] }] } }; };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }), now: () => clock });
  const renders = [];
  store.subscribe(() => { renders.push(gate.ensure()); });
  await gate.ensure();
  await Promise.all(renders);
  await settle();
  assert.deepEqual([...asked].sort(), ['/data/memory/gate?callId=c1', '/data/memory/gate?callId=c2', '/data/memory/gate?callId=c3'], 'one GET each on first sight');
  // all three answered, their gates ready with nothing registered: one pass of reads again, one GET each
  for (const id of ['ev-1', 'ev-2', 'ev-3']) answer(store, 'w1', id);
  await Promise.all(renders);
  await settle();
  assert.equal(asked.length, 3, 'inside 2,000 ms of the first reads: nothing');
  clock += 2_000;
  asked.length = 0;
  await gate.ensure();
  await Promise.all(renders);
  await settle();
  assert.deepEqual([...asked].sort(), ['/data/memory/gate?callId=c1', '/data/memory/gate?callId=c2', '/data/memory/gate?callId=c3'], 'one GET each in the pass of reads again');
  assert.deepEqual(['c1', 'c2', 'c3'].map(id => store.get().memoryGate[id].again), [1, 1, 1]);
});
