// The memory gate's host (host/memory-gate.js): each seat card's lessons asked once by its call id, kept in the store's
// memoryGate slice; the owner's override of a red line posted in their words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMemoryGate, gateOf } from '../../client/js/host/memory-gate.js';
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
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }) });
  await gate.ensure();
  await gate.ensure();
  assert.deepEqual(asked, ['/data/memory/gate?callId=c%3A1', '/data/memory/gate?callId=c2', '/data/memory/gate?callId=c3'], 'once each; no card without a call id, no approval card');
  const kept = store.get().memoryGate;
  assert.deepEqual(kept['c:1'], { status: 'ready', gate: GATE });
  assert.deepEqual(kept.c2, { status: 'none' });
  assert.deepEqual(kept.c3, { status: 'failed' });
  assert.equal(gateOf(store.get(), store.get().conversations[0].messages[0]), kept['c:1'].gate);
  assert.equal(gateOf(store.get(), store.get().conversations[0].messages[1]), null);
  assert.equal(gateOf(store.get(), store.get().conversations[0].messages[3]), null);
});

test('a card is asked while its read is in flight once only, and a body with no gate is a failed read', async () => {
  const store = storeOf([card('e1', 'c1')]);
  const asked = [];
  let release;
  const getJson = path => { asked.push(path); return new Promise(r => { release = () => r({ ok: true }); }); };
  const gate = startMemoryGate({ store, getJson, postJson: async () => ({ ok: true }) });
  const first = gate.ensure();
  assert.deepEqual(store.get().memoryGate.c1, { status: 'loading' });
  await gate.ensure();
  release();
  await first;
  assert.equal(asked.length, 1);
  assert.deepEqual(store.get().memoryGate.c1, { status: 'failed' });
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
  assert.deepEqual(s.memoryGate.__proto__, { status: 'loading' });
  s = R.memoryGateLoaded(s, { callId: 'a', gate: GATE });
  s = R.memoryGateNone(s, { callId: 'b' });
  s = R.memoryGateFailed(s, { callId: 'c' });
  assert.deepEqual(Object.keys(s.memoryGate), ['__proto__', 'a', 'b', 'c']);
  assert.equal(R.memoryGateLoaded(s, { callId: 7, gate: GATE }), s, 'no call id: no change');
  assert.equal(R.memoryGateLoaded(s, { callId: 'd', gate: null }), s, 'no gate: no change');
  const proto = card('e1', 'toString');
  assert.equal(gateOf(s, proto), null, 'a key of Object.prototype is no entry');
});
