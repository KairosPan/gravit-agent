// The live layer (spec 2026-10-19 §5 "Follow policy"): the old client's reads, as decisions against a fake mux and host.
// These re-pin the policy tests that ran chat.js's own source (subagents.test.ts, until stage 1 deleted chat.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { mapFrame } from '../../client/js/wire/mapper.js';
import { startLive, viewFor, LIST_REFRESH_MS, PREVIEW_ROWS, FOLLOW_RETRY_MS } from '../../client/js/host/live.js';

const NOW = 1_760_000_000_000;
const frames = readFileSync(new URL('../fixtures/events.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const row = (id, over = {}) => ({ sessionId: id, updatedAt: 5, agentAvailable: false, running: false, blank: false, ...over });
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

// a fake mux: every stream is recorded with its handlers, the options are kept for the test to fire
function rig({ rows = [], channels = { ok: true, root: '/r', channels: [], ungrouped: [], archived: [], presets: {} }, bots = { bots: [] }, meta = { ok: true, archived: [], deleted: [] }, pages = {}, onReceipt } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const streams = [];
  let opts = null;
  const mux = {
    stream(name, args, cbs) { const s = { name, args, cbs, cancelled: false }; streams.push(s); return { cancel() { s.cancelled = true; } }; },
    answer: async () => {}, close() {},
  };
  const calls = [];
  const call = async (endpoint, args) => {
    calls.push([endpoint, args]);
    if (endpoint === 'session/list') return { items: rows };
    if (endpoint === 'session/projections') return { asOfSeq: 20, values: { title: 'projected' } };
    if (endpoint === 'session/page') return { records: pages[args.request.address.sessionId] ?? [] };
    return undefined;
  };
  // the /data answers by path; a test swaps one for an Error to fail that read
  const answers = { '/data/channels.json': channels, '/data/bots.json': bots, '/data/sessions-meta.json': meta };
  const getJson = async path => { const a = answers[path]; if (a instanceof Error) throw a; return a ?? {}; };
  const scheduled = [];
  const timers = { after(ms, fn) { scheduled.push({ ms, fn }); } };
  const live = startLive({ store, openMux: o => { opts = o; return mux; }, call, mapFrame, getJson, timers, now: () => NOW, onReceipt });
  const last = name => [...streams].reverse().find(s => s.name === name);
  const follows = () => streams.filter(s => s.name === 'session/follow');
  return { store, live, streams, calls, scheduled, answers, opts: () => opts, last, follows, ready: async () => { opts.onReady({ home: '/h' }); await settle(); } };
}
const fixture = i => ({ type: 'event', event: frames[i].event });

test('starting opens the control stream; ready refreshes the list and draws the rows', async () => {
  const r = rig({ rows: [row('s1', { projections: { values: { title: 'One' } } }), row('s2', { updatedAt: 9 })] });
  assert.equal(r.streams[0].name, 'session/control');
  await r.ready();
  assert.equal(r.calls[0][0], 'session/list'); assert.deepEqual(r.calls[0][1], { _request: {} });
  assert.deepEqual(r.store.get().conversations.map(c => c.id), ['s2', 's1']);
  assert.equal(r.store.get().conversations[1].title, 'One');
  assert.equal(r.store.get().status.connected, true);
});

test('opening a COLD session pages it without activating it: projections + page, never a follow', async () => {
  const r = rig({ rows: [row('cold')], pages: { cold: [{ type: 'event', event: frames[0].event }, { type: 'event', event: frames[1].event }] } });
  await r.ready();
  r.live.open('cold'); await settle();
  assert.deepEqual(r.calls.filter(c => c[0] !== 'session/list').map(c => c[0]).slice(0, 2), ['session/projections', 'session/page']);
  const opening = r.calls.find(c => c[0] === 'session/page' && c[1].request.maxMessages === undefined);
  assert.deepEqual(opening[1], { request: { address: { kind: 'session', sessionId: 'cold' }, throughSeq: 20 } });
  assert.equal(r.follows().length, 0);
  const conv = r.store.get().conversations[0];
  assert.equal(conv.loaded, true); assert.deepEqual(conv.messages.map(m => m.id), ['e4', 'e7']);
  assert.equal(conv.title, 'projected', 'the cut seeds the projections');
  assert.equal(viewFor(conv), 'page');
});

test('opening a LIVE session follows it with the assistant stream; the snapshot is the window and events append', async () => {
  const r = rig({ rows: [row('live', { agentAvailable: true })] });
  await r.ready();
  r.live.open('live'); await settle();
  const f = r.last('session/follow');
  assert.deepEqual(f.args, { request: { address: { kind: 'session', sessionId: 'live' }, assistantStream: true } });
  f.cbs.onItem({ type: 'snapshot', header: { createdAt: 7 }, cursor: 2, records: [fixture(0), fixture(1)], projections: { asOfSeq: 7, values: { tokenUsage: { outputTokens: 2 } } } });
  f.cbs.onItem({ type: 'event', event: frames[2].event });
  f.cbs.onItem({ type: 'event', event: frames[3].event });
  const conv = () => r.store.get().conversations[0];
  assert.deepEqual(conv().messages.map(m => m.id), ['e4', 'e7', 'tc1']);
  assert.equal(conv().messages[2].data.result, 'advancers 312 / decliners 188');
  assert.equal(conv().created, 7); assert.deepEqual(conv().usage, { tokenUsage: { outputTokens: 2 } });
  f.cbs.onItem({ type: 'assistant-stream', frame: frames[17].frame });
  assert.equal(conv().thinking, 'reasoning');
  f.cbs.onItem({ type: 'event', event: frames[11].event });
  assert.equal(conv().thinking, null);
  assert.equal(viewFor(conv()), 'follow');
});

test('a socket drop suspends the follow; ready re-follows a live session and its new snapshot REPLACES the window', async () => {
  const r = rig({ rows: [row('live', { agentAvailable: true })] });
  await r.ready();
  r.live.open('live'); await settle();
  const first = r.last('session/follow');
  first.cbs.onItem({ type: 'snapshot', header: {}, cursor: 1, records: [fixture(0)] });
  r.opts().onDown('socket closed');
  assert.equal(first.cancelled, true);
  assert.equal(r.store.get().status.connected, false);
  await r.ready();
  const second = r.last('session/follow');
  assert.notEqual(second, first);
  second.cbs.onItem({ type: 'snapshot', header: {}, cursor: 2, records: [fixture(0), fixture(10)] });
  assert.deepEqual(r.store.get().conversations[0].messages.map(m => m.id), ['e4', 'e10'], 'replaced, not appended twice');
});

test('a socket drop on a session that went cold re-pages it instead of following', async () => {
  const r = rig({ rows: [row('s', { agentAvailable: true })] });
  await r.ready();
  r.live.open('s'); await settle();
  assert.equal(r.follows().length, 1);
  r.opts().onDown('closed');
  // the host now lists it cold
  r.store.dispatch('hostList', { conversations: r.store.get().conversations.map(c => ({ ...c, live: false })) });
  const pagesBefore = r.calls.filter(c => c[0] === 'session/page' && c[1].request.maxMessages === undefined).length;
  r.live.reconcile();
  await settle();
  assert.equal(r.follows().length, 1, 'no second follow for a cold session');
  assert.equal(r.calls.filter(c => c[0] === 'session/page' && c[1].request.maxMessages === undefined).length, pagesBefore + 1, 're-paged instead');
});

test('a paged session is followed once this tab prompts it', async () => {
  const r = rig({ rows: [row('cold')] });
  await r.ready();
  r.live.open('cold'); await settle();
  assert.equal(r.follows().length, 0);
  r.live.promote('cold');
  assert.equal(r.follows().length, 1);
  assert.equal(r.last('session/follow').args.request.address.sessionId, 'cold');
});

test('the host reports a session alive: its page becomes a follow; gone: its follow stops', async () => {
  const r = rig({ rows: [row('s')] });
  await r.ready();
  r.live.open('s'); await settle();
  r.store.dispatch('hostList', { conversations: r.store.get().conversations.map(c => ({ ...c, live: true })) });
  r.live.reconcile();
  assert.equal(r.follows().length, 1);
  r.opts().onEvent('api-session/removed', ['s']);
  assert.equal(r.last('session/follow').cancelled, true);
  assert.equal(r.store.get().conversations[0].running, false);
});

test('a follow the host refuses is reported once on the status line and never retried', async () => {
  const r = rig({ rows: [row('s', { agentAvailable: true })] });
  await r.ready();
  r.live.open('s'); await settle();
  r.last('session/follow').cbs.onError({ code: 'session/not-found', message: 'gone' });
  assert.match(r.store.get().status.line, /session\/not-found/);
  r.live.reconcile();
  assert.equal(r.follows().length, 1);
  assert.equal(r.scheduled.some(s => s.ms === FOLLOW_RETRY_MS), false);
});

test('a follow the host ENDS is re-decided after the retry wait', async () => {
  const r = rig({ rows: [row('s', { agentAvailable: true })] });
  await r.ready();
  r.live.open('s'); await settle();
  r.last('session/follow').cbs.onEnd();
  const retry = r.scheduled.find(s => s.ms === FOLLOW_RETRY_MS);
  assert.ok(retry);
  retry.fn(); await settle();
  assert.equal(r.follows().length, 2);
});

test('a gate lands on its conversation; a replay is the same card; one for a room member lands on the room in the bot\'s name', async () => {
  const r = rig({ rows: [row('s1', { projections: { values: { agentPreset: 'gravit' } } }), row('s-b', { parentSessionId: 's1', projections: { values: { agentPreset: 'buffett' } } })] });
  await r.ready();
  assert.deepEqual(r.store.get().conversations.map(c => c.id), ['s1']);
  r.opts().onGate(frames[6]);
  r.opts().onGate(frames[6]);
  const cards = r.store.get().conversations[0].messages.filter(m => m.kind === 'approval');
  assert.equal(cards.length, 1); assert.equal(cards[0].id, 'ev-1');
  const memberGate = { ...frames[7], agentId: 's-b', eventId: 'ev-m' };
  r.opts().onGate(memberGate);
  const q = r.store.get().conversations[0].messages.find(m => m.id === 'ev-m');
  assert.equal(q.kind, 'question'); assert.equal(q.from, 'buffett');
  r.opts().onGateGone('ev-1');
  assert.equal(r.store.get().conversations[0].messages.find(m => m.id === 'ev-1').answer, 'closed');
});

test("a room member's gate replayed before the list lands survives the room's window load, in the bot's name", async () => {
  // on a reload the host replays pending gates right after ready, before session/list answers: the gate is an orphan first
  const r = rig({ rows: [row('s1', { projections: { values: { agentPreset: 'gravit' } } }), row('s-b', { parentSessionId: 's1', projections: { values: { agentPreset: 'buffett' } } })], pages: { s1: [fixture(1)] } });
  r.opts().onGate({ ...frames[7], agentId: 's-b', eventId: 'ev-m' });
  assert.deepEqual(Object.keys(r.store.get().orphanGates), ['ev-m']);
  await r.ready();
  r.live.open('s1');
  await settle();
  const room = r.store.get().conversations.find(c => c.id === 's1');
  assert.equal(room.loaded, true);
  const card = room.messages.find(m => m.id === 'ev-m');
  assert.ok(card, 'the card is still on the room after its window replaced the messages');
  assert.equal(card.from, 'buffett');
  assert.deepEqual(r.store.get().orphanGates, {});
});

test("the bots' display names from /data/bots.json reach the store, so the screens name a bot rather than its id", async () => {
  const r = rig({ rows: [row('s1')], bots: { bots: [{ id: 'buffett', name: 'Buffett Type' }, { id: 'drill-bear', name: '看空派' }] } });
  await r.ready();
  assert.deepEqual(r.store.get().bots, [{ id: 'buffett', name: 'Buffett Type' }, { id: 'drill-bear', name: '看空派' }]);
});

test('previews: a row is re-read when its session moves, and only then (a row read and found silent waits for activity)', async () => {
  const rows = [row('p1', { updatedAt: 5 }), row('p2', { updatedAt: 4 })];
  const pages = { p1: [fixture(1)], p2: [fixture(13)] };
  const r = rig({ rows, pages });
  await r.ready();
  await settle();
  const reads = id => r.calls.filter(c => c[0] === 'session/page' && c[1].request.maxMessages === 1 && c[1].request.address.sessionId === id).length;
  assert.equal(r.store.get().conversations.find(c => c.id === 'p1').preview, 'Both pivots are technically valid.');
  assert.equal(reads('p1'), 1); assert.equal(reads('p2'), 1);
  await r.live.refresh(); await settle();
  assert.equal(reads('p1'), 1, 'not moved: not re-read'); assert.equal(reads('p2'), 1, 'silent and not moved: not re-read');
  rows[0].updatedAt = 9;
  pages.p1 = [fixture(11)];
  await r.live.refresh(); await settle();
  assert.equal(reads('p1'), 2, 'moved: re-read');
  assert.equal(r.store.get().conversations.find(c => c.id === 'p1').preview, frames[11].event.data.message.content[0].text);
});

test('a gate for a session the list does not know yet waits, and lands once the list brings it', async () => {
  const r = rig({ rows: [] });
  await r.ready();
  r.opts().onGate(frames[6]);
  assert.deepEqual(Object.keys(r.store.get().orphanGates), ['ev-1']);
  r.store.dispatch('hostList', { conversations: [{ id: 's1', title: 'late', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, running: false, live: false, updatedAt: 1, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0 }] });
  r.live.retryOrphans();
  assert.deepEqual(r.store.get().orphanGates, {});
  assert.equal(r.store.get().conversations[0].messages[0].id, 'ev-1');
});

test('host facts: status sets running, activity and added schedule a list refresh, an error reaches the status line', async () => {
  const r = rig({ rows: [row('s1')] });
  await r.ready();
  r.store.dispatch('nav', { screen: 'messages', id: 's1' });
  const before = r.scheduled.length;
  r.opts().onEvent('api-session/status', ['s1', true]);
  assert.equal(r.store.get().conversations[0].running, true);
  r.opts().onEvent('api-session/activity', ['s1', 99]);
  r.opts().onEvent('api-session/added', [{ sessionId: 's9' }]);
  const refreshes = r.scheduled.slice(before).filter(s => s.ms === LIST_REFRESH_MS);
  assert.equal(refreshes.length, 1, 'a burst of host facts is one coalesced list refresh');
  r.opts().onEvent('api-session/error', ['s1', 'the model is out']);
  assert.equal(r.store.get().status.line, 'the model is out'); assert.equal(r.store.get().status.bad, true);
});

test('control projections reach the conversation; a baseline seeds every listed session', async () => {
  const r = rig({ rows: [row('s1'), row('s2')] });
  await r.ready();
  const control = r.streams[0];
  control.cbs.onItem({ type: 'baseline', value: { projections: { s1: { asOfSeq: 3, values: { title: 'Seeded', tokenUsage: { outputTokens: 1 } } }, s2: { kind: 'cached', values: { title: 'ignored' } } } } });
  const get = id => r.store.get().conversations.find(c => c.id === id);
  assert.equal(get('s1').title, 'Seeded'); assert.deepEqual(get('s1').usage, { tokenUsage: { outputTokens: 1 } });
  assert.equal(get('s2').title, 'Untitled', 'a cached block seeds nothing');
  control.cbs.onItem({ type: 'projection', sessionId: 's2', key: 'room', value: { kind: 'room', round: 1, members: { buffett: {} }, organizing: false }, seq: 4 });
  assert.equal(get('s2').kind, 'group'); assert.deepEqual(get('s2').members, ['gravit', 'buffett']);
});

test('previews: the first rows get one non-activating page of one message each', async () => {
  const rows = Array.from({ length: PREVIEW_ROWS + 3 }, (_, i) => row('p' + i, { updatedAt: 100 - i }));
  const pages = Object.fromEntries(rows.map(x => [x.sessionId, [{ type: 'event', event: frames[1].event }]]));
  const r = rig({ rows, pages });
  await r.ready();
  await settle(); await settle();
  const previewPages = r.calls.filter(c => c[0] === 'session/page' && c[1].request.maxMessages === 1);
  assert.equal(previewPages.length, PREVIEW_ROWS);
  assert.equal(r.store.get().conversations[0].preview, 'Both pivots are technically valid.');
  assert.equal(r.store.get().conversations[PREVIEW_ROWS + 1].preview, null);
});

test('previews: the last SPOKEN line, never an injected context row (a plugin notice, a runtime snapshot)', async () => {
  // frames[13] is a user-role record from plugin:fs-observation — a context row in the thread, not words anyone said
  const r = rig({ rows: [row('p1')], pages: { p1: [fixture(1), fixture(13)] } });
  await r.ready();
  await settle(); await settle();
  assert.equal(r.store.get().conversations[0].preview, 'Both pivots are technically valid.');
});

test('opening marks the conversation seen; the list keeps the open one seen when its activity moves', async () => {
  const r = rig({ rows: [row('s1', { updatedAt: 50 })] });
  await r.ready();
  r.store.dispatch('nav', { screen: 'messages', id: 's1' });
  r.live.open('s1'); await settle();
  assert.equal(r.store.get().conversations[0].lastSeen, 50);
});

// spec 2026-10-19 §6: the account is read again right after a fill
const orderCall = { type: 'tool/call', seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: 'c9', name: 'mcp__alpaca-kit__place_order', arguments: JSON.stringify({ symbol: 'BTC/USD', qty: 0.00008, side: 'buy', order_type: 'market' }) } };
const orderResult = (seq, text, isError) => ({ type: 'tool/result', seq, time: 1756512201000, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: `m-${seq}`, role: 'tool', source: { kind: 'tool', callId: 'c9' }, toolCallId: 'c9', content: [{ type: 'text', text }], isError } } });

test('a place_order result that is a receipt calls onReceipt once; a refusal or a backfilled receipt does not', async () => {
  let receipts = 0;
  const r = rig({ rows: [row('live', { agentAvailable: true })], onReceipt: () => { receipts++; } });
  await r.ready();
  r.live.open('live'); await settle();
  const f = r.last('session/follow');
  f.cbs.onItem({ type: 'snapshot', header: { createdAt: 7 }, cursor: 2, records: [{ type: 'event', event: orderCall }, { type: 'event', event: orderResult(41, JSON.stringify({ ok: true, id: 'ord-0' }), false) }] });
  assert.equal(receipts, 0, 'a receipt in the window is history');
  f.cbs.onItem({ type: 'event', event: { ...orderCall, seq: 42 } });
  f.cbs.onItem({ type: 'event', event: orderResult(43, JSON.stringify({ ok: true, id: 'ord-1', status: 'accepted' }), false) });
  assert.equal(receipts, 1);
  f.cbs.onItem({ type: 'event', event: orderResult(44, 'the user rejected tool "mcp__alpaca-kit__place_order"', true) });
  assert.equal(receipts, 1, 'a refusal is no fill');
});

// spec 2026-10-20 §6.2: a seat write's receipt reaches the app flagged seat, so it reloads the seat's standing, not the account
test("a seat write's receipt reaches onReceipt flagged seat; a seat read's result calls nothing", async () => {
  const seen = [];
  const r = rig({ rows: [row('live', { agentAvailable: true })], onReceipt: m => { seen.push(m); } });
  await r.ready();
  r.live.open('live'); await settle();
  const f = r.last('session/follow');
  f.cbs.onItem({ type: 'snapshot', header: { createdAt: 7 }, cursor: 2, records: [] });
  const seatCall = { type: 'tool/call', seq: 60, time: 1756512300000, data: { turn: 5, step: 1, callId: 'c10', name: 'mcp__account__portfolio_live_order', arguments: JSON.stringify({ venue: 'paper-1', symbol: 'AAPL', side: 'buy', usd: 100 }) } };
  const result = (seq, callId, text) => ({ type: 'tool/result', seq, time: 1756512301000, surfaceOp: 'append', data: { turn: 5, step: 1, message: { id: `m-${seq}`, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text }], isError: false } } });
  f.cbs.onItem({ type: 'event', event: seatCall });
  f.cbs.onItem({ type: 'event', event: result(61, 'c10', JSON.stringify({ ok: true, pending: true, card: { id: 'card-0007' } })) });
  assert.equal(seen.length, 1); assert.equal(seen[0].kind, 'receipt'); assert.equal(seen[0].data.seat, true); assert.equal(seen[0].data.cardId, 'card-0007');
  f.cbs.onItem({ type: 'event', event: { ...seatCall, seq: 62, data: { ...seatCall.data, callId: 'c11', name: 'mcp__account__portfolio_account', arguments: '{}' } } });
  f.cbs.onItem({ type: 'event', event: result(63, 'c11', JSON.stringify({ ok: true })) });
  assert.equal(seen.length, 1, 'a read is no receipt');
});

test('refresh reads sessions-meta; a failed channels, sessions-meta or bots read keeps the last good answer', async () => {
  const alpha = { workspaceId: 'w1', name: 'alpha', title: 'Alpha', dir: '/r/strategies/alpha', isRoot: false, missingDir: false, sessionIds: ['s1'] };
  const r = rig({
    rows: [row('s1'), row('s2'), row('s3'), row('s4')],
    channels: { ok: true, root: '/r', channels: [alpha], ungrouped: [], archived: ['s3'], presets: {} },
    meta: { ok: true, archived: ['s2'], deleted: ['s4'] },
    bots: { bots: [{ id: 'buffett', name: 'Buffett' }] },
  });
  await r.ready();
  const get = id => r.store.get().conversations.find(c => c.id === id);
  assert.equal(get('s2').archived, 'face'); assert.equal(get('s3').archived, 'host'); assert.equal(get('s4'), undefined, 'a deleted session leaves');
  assert.deepEqual(r.store.get().channels, [alpha]);
  assert.deepEqual(get('s1').channel, { workspaceId: 'w1', name: 'alpha' });
  for (const path of ['/data/channels.json', '/data/sessions-meta.json', '/data/bots.json']) r.answers[path] = new Error('HTTP 500');
  await r.live.refresh();
  assert.equal(get('s2').archived, 'face', 'a failed sessions-meta read un-archives nothing');
  assert.equal(get('s4'), undefined, 'nor brings back a deleted one');
  assert.equal(get('s3').archived, 'host');
  assert.deepEqual(r.store.get().channels, [alpha], 'a failed channels read keeps the groups');
  assert.deepEqual(get('s1').channel, { workspaceId: 'w1', name: 'alpha' });
  assert.deepEqual(r.store.get().bots, [{ id: 'buffett', name: 'Buffett' }], 'a failed bots read keeps the names');
});

test('the subagentCatalog projection reaches the conversation, and the list carries the child rows', async () => {
  const r = rig({ rows: [row('p'), row('c1', { origin: 'subagent', parentSessionId: 'p', running: true })] });
  await r.ready();
  const catalog = [{ id: 'c1', createdAt: 1, mode: 'continuable', label: 'Check' }];
  r.streams[0].cbs.onItem({ type: 'projection', sessionId: 'p', key: 'subagentCatalog', value: catalog, seq: 4 });
  const p = () => r.store.get().conversations.find(c => c.id === 'p');
  assert.deepEqual(p().subagentCatalog, catalog);
  assert.deepEqual(r.store.get().childRows, [{ sessionId: 'c1', parentSessionId: 'p', running: true, origin: 'subagent' }]);
  await r.live.refresh();
  assert.deepEqual(p().subagentCatalog, catalog, 'a list refresh keeps it');
});

// the drill of 2026-10-21: the approval waterfall and the session's follow stream are two streams on one socket, and
// the card reached the page before its tool/call did, so it read the tool name with no arguments and stayed so
test("a seat gate drawn before its tool/call arrives is drawn again with the call's arguments once the call lands, in place", async () => {
  const r = rig({ rows: [row('s1', { agentAvailable: true })] });
  await r.ready();
  r.live.open('s1'); await settle();
  const f = r.last('session/follow');
  f.cbs.onItem({ type: 'snapshot', header: { createdAt: 7 }, cursor: 2, records: [fixture(0), fixture(1)] });
  const gate = { ...frames[6], eventId: 'ev-seat', agentId: 's1', request: { toolName: 'mcp__account__portfolio_live_order', callId: 'c10', reason: 'Account seat - mcp__account__portfolio_live_order: side=buy usd=100 symbol=AAPL orderType=market venue=paper-1' } };
  r.opts().onGate(gate);
  const conv = () => r.store.get().conversations.find(c => c.id === 's1');
  const card = () => conv().messages.find(m => m.id === 'ev-seat');
  assert.equal(card().text, 'Your call: mcp__account__portfolio_live_order', 'before the call lands, the card knows only the tool');
  const seq = card().seq;
  f.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 60, time: NOW, data: { turn: 5, step: 1, callId: 'c10', name: 'mcp__account__portfolio_live_order', arguments: JSON.stringify({ venue: 'paper-1', symbol: 'AAPL', side: 'buy', usd: 100, orderType: 'market' }) } } });
  assert.equal(card().text, 'Your call: buy $100 of AAPL · market · paper-1');
  assert.equal(card().data.venue, 'paper-1');
  assert.equal(card().seq, seq, 'the card keeps its place in the thread');
  assert.equal(conv().messages.filter(m => m.id === 'ev-seat').length, 1);
  // another call of the same tool, under another id, never redresses this card
  f.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 61, time: NOW, data: { turn: 5, step: 2, callId: 'c11', name: 'mcp__account__portfolio_live_order', arguments: JSON.stringify({ venue: 'okx', symbol: 'BTC/USDT', side: 'sell', usd: 500 }) } } });
  assert.equal(card().text, 'Your call: buy $100 of AAPL · market · paper-1');
});
