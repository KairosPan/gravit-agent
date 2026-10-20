// The host reducers (spec 2026-10-19 §5): the store is a cache of what dsh says, keyed by the host's own ids and seqs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { needsAnswer } from '../../client/js/messages.js';

const NOW = 1_760_000_000_000;
const conv = (id, over = {}) => ({ id, title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: 5, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const msg = (id, seq, over = {}) => ({ id, seq, at: 1000 + seq, from: 'gravit', kind: 'text', text: 't' + seq, data: {}, ...over });
const gate = (id, over = {}) => ({ id, at: NOW, from: 'gravit', kind: 'approval', text: 'bash', data: { eventId: id, sessionId: 's1', toolName: 'bash' }, ...over });
const withConv = (...cs) => R.hostList(emptyState(NOW), { conversations: cs });
const seqs = (s, id) => s.conversations.find(c => c.id === id).messages.map(m => m.seq);
const get = (s, id) => s.conversations.find(c => c.id === id);

test('the empty state has no conversations, a connecting status line and the shapes later screens boot on', () => {
  const s = emptyState(NOW);
  assert.deepEqual(s.conversations, []);
  assert.deepEqual(s.status, { line: 'connecting…', bad: false, connected: false });
  assert.deepEqual(s.orphanGates, {}); assert.deepEqual(s.lastSeen, {}); assert.deepEqual(s.channels, []);
  assert.deepEqual(s.route, { screen: 'messages', id: null }); assert.equal(s.theme, 'system'); assert.equal(s.draft, null);
  assert.equal(s.counters, undefined);
  assert.deepEqual(s.plugins, { installed: [], mine: [], uploaded: [] }); assert.deepEqual(s.mail.items, []); assert.equal(s.discover.query, '');
  assert.deepEqual(s.compose, { files: [], listening: false });
});

test('hostStatus merges the line, the flag and the connection', () => {
  let s = R.hostStatus(emptyState(NOW), { line: 'Reconnecting…', bad: true });
  assert.deepEqual(s.status, { line: 'Reconnecting…', bad: true, connected: false });
  s = R.hostStatus(s, { line: '', connected: true });
  assert.deepEqual(s.status, { line: '', bad: false, connected: true });
});

test('hostList replaces the set in the given order and keeps what a surviving conversation already holds', () => {
  let s = withConv(conv('a'), conv('b'));
  s = R.hostWindow(s, { convId: 'a', messages: [msg('e1', 1)], usage: { tokenUsage: { outputTokens: 3 } } });
  s = R.hostPreview(s, { convId: 'a', preview: 'hello', at: 9 });
  s = R.hostThinking(s, { convId: 'a', mode: 'text' });
  s = R.markSeen(s, { convId: 'a', seq: 1 });
  s = R.hostList(s, { conversations: [conv('c'), conv('a', { title: 'A2', updatedAt: 7 })] });
  assert.deepEqual(s.conversations.map(c => c.id), ['c', 'a']);
  const a = get(s, 'a');
  assert.equal(a.title, 'A2'); assert.equal(a.updatedAt, 7);
  assert.deepEqual(seqs(s, 'a'), [1]); assert.equal(a.loaded, true); assert.equal(a.preview, 'hello');
  assert.deepEqual(a.usage, { tokenUsage: { outputTokens: 3 } }); assert.equal(a.thinking, 'text'); assert.equal(a.lastSeen, 1);
  assert.equal(get(s, 'b'), undefined);
});

test('hostEvent keeps seq order, ignores a message it has seen, and merges a tool result into its call', () => {
  let s = withConv(conv('a'));
  s = R.hostEvent(s, { convId: 'a', message: msg('e7', 7) });
  s = R.hostEvent(s, { convId: 'a', message: msg('e4', 4) });
  assert.deepEqual(seqs(s, 'a'), [4, 7]);
  const again = R.hostEvent(s, { convId: 'a', message: msg('e7', 7, { text: 'changed' }) });
  assert.equal(again, s, 'a seen id changes nothing');
  s = R.hostEvent(s, { convId: 'a', message: msg('tc1', 8, { kind: 'tool', text: 'bash', data: { callId: 'c1', title: 'ls' } }) });
  s = R.hostEvent(s, { convId: 'a', message: msg('tc1', 9, { kind: 'tool', merge: true, text: '', data: { result: 'ok', isError: false } }) });
  const row = get(s, 'a').messages.find(m => m.id === 'tc1');
  assert.equal(row.text, 'bash'); assert.deepEqual(row.data, { callId: 'c1', title: 'ls', result: 'ok', isError: false });
  assert.deepEqual(seqs(s, 'a'), [4, 7, 8]);
  s = R.hostEvent(s, { convId: 'a', message: msg('tc9', 12, { kind: 'tool', merge: true, data: { result: 'late', isError: true } }) });
  assert.equal(get(s, 'a').messages.at(-1).id, 'tc9', 'a result with no call row is appended as its own row');
  assert.equal(R.hostEvent(s, { convId: 'nope', message: msg('e1', 1) }), s);
});

test('hostEvent honours a compaction checkpoint: the shadowed seq range goes, gates stay, the summary lands', () => {
  let s = withConv(conv('a'));
  for (const seq of [4, 7, 9, 10, 11, 13]) s = R.hostEvent(s, { convId: 'a', message: msg('e' + seq, seq) });
  s = R.hostGate(s, { convId: 'a', message: gate('ev-1') });
  const g = get(s, 'a').messages.find(m => m.id === 'ev-1');
  assert.equal(g.seq, 13.5, 'a gate sits after the last event');
  s = R.hostEvent(s, { convId: 'a', message: msg('e15', 15, { from: 'system', replace: { start: 4, end: 11 } }) });
  assert.deepEqual(get(s, 'a').messages.map(m => m.id), ['e13', 'ev-1', 'e15']);
});

test('hostEvent clears the thinking row when anyone but the operator speaks', () => {
  let s = R.hostThinking(withConv(conv('a')), { convId: 'a', mode: 'reasoning' });
  s = R.hostEvent(s, { convId: 'a', message: msg('e1', 1, { from: 'you' }) });
  assert.equal(get(s, 'a').thinking, 'reasoning');
  s = R.hostEvent(s, { convId: 'a', message: msg('e2', 2) });
  assert.equal(get(s, 'a').thinking, null);
});

test('hostWindow replaces the window whole and marks it loaded', () => {
  let s = R.hostEvent(withConv(conv('a')), { convId: 'a', message: msg('e1', 1) });
  s = R.hostWindow(s, { convId: 'a', messages: [msg('e5', 5), msg('e6', 6)], usage: { contextPressure: 0.2 }, created: 123 });
  const a = get(s, 'a');
  assert.deepEqual(seqs(s, 'a'), [5, 6]); assert.equal(a.loaded, true); assert.equal(a.created, 123); assert.deepEqual(a.usage, { contextPressure: 0.2 });
  s = R.hostWindow(s, { convId: 'a', messages: [msg('e5', 5)] });
  assert.deepEqual(seqs(s, 'a'), [5], 'a re-opened follow replaces, never appends a second copy');
});

test('hostGate upserts by eventId and parks a gate whose conversation the list does not know yet', () => {
  let s = withConv(conv('a'));
  s = R.hostGate(s, { convId: 'a', message: gate('ev-1') });
  s = R.hostGate(s, { convId: 'a', message: gate('ev-1', { text: 'replayed' }) });
  const cards = get(s, 'a').messages.filter(m => m.id === 'ev-1');
  assert.equal(cards.length, 1); assert.equal(cards[0].text, 'replayed');
  s = R.hostGate(s, { convId: 'zz', message: gate('ev-2') });
  assert.deepEqual(Object.keys(s.orphanGates), ['ev-2']); assert.equal(s.orphanGates['ev-2'].convId, 'zz');
  assert.equal(get(s, 'a').messages.some(m => m.id === 'ev-2'), false);
});

test('hostGateGone marks the card closed unless this tab already answered it, and forgets an orphan', () => {
  let s = withConv(conv('a'));
  s = R.hostGate(s, { convId: 'a', message: gate('ev-1') });
  s = R.hostGate(s, { convId: 'a', message: gate('ev-3') });
  s = R.hostGate(s, { convId: 'zz', message: gate('ev-2') });
  s = R.hostGateGone(s, { eventId: 'ev-3', outcome: 'approved' });
  s = R.hostGateGone(s, { eventId: 'ev-3', outcome: 'closed' });
  s = R.hostGateGone(s, { eventId: 'ev-1', outcome: 'closed' });
  s = R.hostGateGone(s, { eventId: 'ev-2', outcome: 'closed' });
  assert.equal(get(s, 'a').messages.find(m => m.id === 'ev-1').answer, 'closed');
  assert.equal(get(s, 'a').messages.find(m => m.id === 'ev-3').answer, 'approved');
  assert.deepEqual(s.orphanGates, {});
  assert.equal(needsAnswer(get(s, 'a').messages.find(m => m.id === 'ev-1')), false);
});

test('needsAnswer is true for an unanswered card, approval or question only', () => {
  assert.equal(needsAnswer(gate('x')), true);
  assert.equal(needsAnswer(gate('x', { kind: 'question' })), true);
  assert.equal(needsAnswer(gate('x', { kind: 'card' })), true);
  assert.equal(needsAnswer(gate('x', { kind: 'tool' })), false);
  assert.equal(needsAnswer(gate('x', { answer: 'approved' })), false);
});

test('hostProjection: title, usage, room members and running', () => {
  let s = withConv(conv('a'));
  s = R.hostProjection(s, { convId: 'a', key: 'title', value: 'BTC under 70k' });
  s = R.hostProjection(s, { convId: 'a', key: 'tokenUsage', value: { outputTokens: 1 } });
  s = R.hostProjection(s, { convId: 'a', key: 'contextPressure', value: 0.4 });
  s = R.hostProjection(s, { convId: 'a', key: 'room', value: { kind: 'room', round: 1, members: { buffett: { state: 'idle' } }, organizing: true } });
  s = R.hostProjection(s, { convId: 'a', key: 'running', value: true });
  const a = get(s, 'a');
  assert.equal(a.title, 'BTC under 70k'); assert.deepEqual(a.usage, { tokenUsage: { outputTokens: 1 }, contextPressure: 0.4 });
  assert.equal(a.kind, 'group'); assert.deepEqual(a.members, ['gravit', 'buffett']); assert.equal(a.running, true);
  assert.equal(R.hostProjection(s, { convId: 'a', key: 'title', value: '' }), s, 'an empty title is not a title');
});

test('markSeen raises the last-seen seq on the conversation and in the per-viewer map', () => {
  let s = R.markSeen(withConv(conv('a')), { convId: 'a', seq: 9 });
  s = R.markSeen(s, { convId: 'a', seq: 4 });
  assert.equal(get(s, 'a').lastSeen, 9); assert.deepEqual(s.lastSeen, { a: 9 });
});
