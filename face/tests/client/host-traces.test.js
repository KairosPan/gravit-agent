// A room member's trace (spec 2026-10-19 §7 Stage 3): read non-activating — projections, then the history paged back —
// once per answer, its calls folded with their results as the thread folds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { mapFrame } from '../../client/js/wire/mapper.js';
import { loadMemberTrace } from '../../client/js/wire/member-traces.js';
import { startTraces } from '../../client/js/host/traces.js';
import { memberTurn, memberPage } from './helpers/trace.js';
import { spoken } from './helpers/spoken.js';

const answer = (over = {}) => ({ id: 'e9', seq: 9, at: 1, from: 'buffett', kind: 'text', text: 'Hold', data: { name: 'Buffett', markdown: true, memberSessionId: 'm1', memberTurn: 3, ...over } });
const room = (id, memberSessions) => ({ id, title: 'R', kind: 'group', members: ['gravit', 'buffett'], memberSessions, channel: null, preset: 'gravit', running: false, live: true, archived: false, updatedAt: 1, created: null, messages: [], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0 });
// `others`: more rooms, each with its own member's answer
function rig(message = answer(), others = []) {
  const store = createStore({ initial: emptyState(), reducers });
  store.dispatch('hostList', { conversations: [room('room', ['m1']), ...others.map(o => room(o.id, [o.message.data.memberSessionId]))] });
  store.dispatch('hostEvent', { convId: 'room', message });
  for (const o of others) store.dispatch('hostEvent', { convId: o.id, message: o.message });
  const calls = [];
  const records = memberTurn();
  const call = async (endpoint, args) => {
    calls.push([endpoint, args]);
    if (endpoint === 'session/projections') return { asOfSeq: 13, values: {} };
    if (endpoint === 'session/page') return memberPage(records);
    throw new Error(`unexpected ${endpoint}`);
  };
  const traces = startTraces({ store, call, loadMemberTrace, mapFrame, now: () => 5 });
  return { store, traces, calls, t: (convId = 'room') => store.get().traces[convId]?.e9 };
}

test('open reads projections then pages back, once per message, and folds each call with its result', async () => {
  const r = rig();
  await Promise.all([r.traces.open('room', 'e9'), r.traces.open('room', 'e9')]);
  await r.traces.open('room', 'e9');
  assert.deepEqual(r.calls.map(c => c[0]), ['session/projections', 'session/page']);
  assert.deepEqual(r.calls[0][1], { request: { sessionId: 'm1' } });
  assert.equal(r.calls.some(c => c[0] === 'session/follow'), false);
  assert.equal(r.t().status, 'ready');
  const tools = r.t().messages.filter(m => m.kind === 'tool');
  assert.equal(tools.length, 1);
  assert.equal(tools[0].data.name, 'mcp__alpaca-kit__account');
  assert.equal(tools[0].data.result, '{"ok":true,"equity":"100"}');
});

// a message id is the room log's sequence: two rooms following the same script repeat them
test("two rooms' answers with the same message id each read their own member's turn", async () => {
  const r = rig(answer(), [{ id: 'room2', message: answer({ memberSessionId: 'm2' }) }]);
  await r.traces.open('room', 'e9');
  await r.traces.open('room2', 'e9');
  assert.deepEqual(r.calls.filter(c => c[0] === 'session/projections').map(c => c[1].request.sessionId), ['m1', 'm2']);
  assert.equal(r.t('room').status, 'ready');
  assert.equal(r.t('room2').status, 'ready');
});

test('a loader error lands as its words', async () => {
  const r = rig(answer({ memberTurn: undefined }));
  await r.traces.open('room', 'e9');
  assert.deepEqual(spoken(r.t()), { status: 'failed', line: 'This answer recorded no member turn.' });
  assert.deepEqual(r.calls, []);
});
