// The live layer (spec 2026-10-19 §5 "Follow policy"): the old client's reads, as decisions against a fake mux and host.
// These re-pin the policy tests that ran chat.js's own source (subagents.test.ts, until stage 1 deleted chat.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { mapFrame } from '../../client/js/wire/mapper.js';
import { startLive, viewFor, LIST_REFRESH_MS, PREVIEW_ROWS, FOLLOW_RETRY_MS, ACTIVATE_MS, EARLIER_MAX_PAGES } from '../../client/js/host/live.js';

const NOW = 1_760_000_000_000;
const frames = readFileSync(new URL('../fixtures/events.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const row = (id, over = {}) => ({ sessionId: id, updatedAt: 5, agentAvailable: false, running: false, blank: false, ...over });
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

// a fake mux: every stream is recorded with its handlers, the options are kept for the test to fire
function rig({ rows = [], channels = { ok: true, root: '/r', channels: [], ungrouped: [], archived: [], presets: {} }, bots = { bots: [] }, meta = { ok: true, archived: [], deleted: [] }, pages = {}, onReceipt, projections, atTail } = {}) {
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
    if (endpoint === 'session/projections') return projections ? projections(args.request.sessionId) : { asOfSeq: 20, values: { title: 'projected' } };
    if (endpoint === 'session/page') {
      const p = pages[args.request.address.sessionId];
      return typeof p === 'function' ? p(args.request) : { records: p ?? [] };   // a function answers {records, hasMore} per request
    }
    return undefined;
  };
  // the /data answers by path; a test swaps one for an Error to fail that read
  const answers = { '/data/channels.json': channels, '/data/bots.json': bots, '/data/sessions-meta.json': meta };
  const getJson = async path => { const a = answers[path]; if (a instanceof Error) throw a; return a ?? {}; };
  const scheduled = [];
  const cancelled = [];
  const timers = { after(ms, fn) { const t = { ms, fn }; scheduled.push(t); return t; }, cancel(t) { cancelled.push(t); } };
  const live = startLive({ store, openMux: o => { opts = o; return mux; }, call, mapFrame, getJson, timers, now: () => NOW, onReceipt, atTail });
  const last = name => [...streams].reverse().find(s => s.name === name);
  const follows = () => streams.filter(s => s.name === 'session/follow');
  return { store, live, streams, calls, scheduled, cancelled, answers, opts: () => opts, last, follows, ready: async () => { opts.onReady({ home: '/h' }); await settle(); } };
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

test("rc.5's kinded cut: a sequenced answer pages through its asOfSeq", async () => {
  const r = rig({ rows: [row('cold')], projections: () => ({ kind: 'sequenced', asOfSeq: 31, values: { title: 'projected' } }), pages: { cold: [fixture(0)] } });
  await r.ready();
  r.live.open('cold'); await settle();
  assert.equal(r.calls.find(c => c[0] === 'session/page' && c[1].request.maxMessages === undefined)[1].request.throughSeq, 31);
  assert.equal(r.store.get().status.line, '' , 'no status line for a readable session');
});

test('a session whose log needs migration opens on the status line, never throws, and keeps the list', async () => {
  const r = rig({ rows: [row('old'), row('new', { updatedAt: 9 })], projections: id => id === 'old' ? { kind: 'migration-required', values: { title: 'old' } } : { kind: 'sequenced', asOfSeq: 4, values: {} } });
  await r.ready();
  r.live.open('old'); await settle();
  assert.match(r.store.get().status.line, /^open: session\/migration-required/);
  assert.equal(r.calls.some(c => c[0] === 'session/page' && c[1].request.address.sessionId === 'old' && c[1].request.maxMessages === undefined), false, 'no page without a cut');
  assert.deepEqual(r.store.get().conversations.map(c => c.id).sort(), ['new', 'old'], 'the list keeps both rows');
  r.live.open('new'); await settle();
  assert.equal(r.calls.some(c => c[0] === 'session/page' && c[1].request.address.sessionId === 'new'), true, 'another session still opens');
});

test('a migration-required row gets no preview and the preview pass goes on to the next row', async () => {
  const r = rig({ rows: [row('old'), row('new')], pages: { new: [fixture(0), fixture(1)] }, projections: id => id === 'old' ? { kind: 'migration-required', values: {} } : { kind: 'sequenced', asOfSeq: 4, values: {} } });
  await r.ready();
  assert.equal(r.calls.some(c => c[0] === 'session/page' && c[1].request.address.sessionId === 'old'), false);
  assert.equal(r.calls.some(c => c[0] === 'session/page' && c[1].request.address.sessionId === 'new'), true);
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
  assert.deepEqual(r.store.get().bots, [{ id: 'buffett', name: 'Buffett Type', description: '' }, { id: 'drill-bear', name: '看空派', description: '' }]);
});

test("the list keeps each bot's description", async () => {
  const r = rig({ rows: [row('s1')], bots: { bots: [{ id: 'news-scout', name: 'News Scout', description: 'Reads the wires' }, { id: 'drill-bull', name: 'Bull' }] } });
  await r.ready();
  assert.deepEqual(r.store.get().bots, [{ id: 'news-scout', name: 'News Scout', description: 'Reads the wires' }, { id: 'drill-bull', name: 'Bull', description: '' }]);
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

test('previews: a conversation that ends in a composed answer previews its summary', async () => {
  const args = { strategy: 'cn-market', run: 'r1', summary: '上证涨 0.5%，15 家上涨。', blocks: [{ kind: 'sources' }] };
  const call = { type: 'tool/call', seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: 'k1', name: 'lunhui_present', arguments: JSON.stringify(args) } };
  const result = { type: 'tool/result', seq: 41, time: 1756512201000, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: 'm-41', role: 'tool', source: { kind: 'tool', callId: 'k1' }, toolCallId: 'k1', content: [{ type: 'text', text: JSON.stringify({ ok: true, blocks: ['sources'], modules: [] }) }], isError: false } } };
  const r = rig({ rows: [row('p1')], pages: { p1: [fixture(1), { type: 'event', event: call }, { type: 'event', event: result }] } });
  await r.ready();
  await settle(); await settle();
  assert.equal(r.store.get().conversations[0].preview, '上证涨 0.5%，15 家上涨。');
});

test('opening marks the conversation seen; the list keeps the open one seen when its activity moves', async () => {
  const r = rig({ rows: [row('s1', { updatedAt: 50 })] });
  await r.ready();
  r.store.dispatch('nav', { screen: 'messages', id: 's1' });
  r.live.open('s1'); await settle();
  assert.equal(r.store.get().conversations[0].lastSeen, 50);
});

// spec 2026-10-19 §6: the account is read again right after a fill
const orderCall = { type: 'tool/call', seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: 'c9', name: 'mcp__account__portfolio_live_order', arguments: JSON.stringify({ venue: 'paper-1', symbol: 'BTC/USD', side: 'buy', usd: 10 }) } };
const orderResult = (seq, text, isError) => ({ type: 'tool/result', seq, time: 1756512201000, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: `m-${seq}`, role: 'tool', source: { kind: 'tool', callId: 'c9' }, toolCallId: 'c9', content: [{ type: 'text', text }], isError } } });

test('a seat order result that is a receipt calls onReceipt once; a refusal or a backfilled receipt does not', async () => {
  let receipts = 0;
  const r = rig({ rows: [row('live', { agentAvailable: true })], onReceipt: () => { receipts++; } });
  await r.ready();
  r.live.open('live'); await settle();
  const f = r.last('session/follow');
  f.cbs.onItem({ type: 'snapshot', header: { createdAt: 7 }, cursor: 2, records: [{ type: 'event', event: orderCall }, { type: 'event', event: orderResult(41, JSON.stringify({ ok: true, order: { id: 'ord-0' } }), false) }] });
  assert.equal(receipts, 0, 'a receipt in the window is history');
  f.cbs.onItem({ type: 'event', event: { ...orderCall, seq: 42 } });
  f.cbs.onItem({ type: 'event', event: orderResult(43, JSON.stringify({ ok: true, order: { id: 'ord-1', status: 'accepted', paper: true } }), false) });
  assert.equal(receipts, 1);
  f.cbs.onItem({ type: 'event', event: orderResult(44, 'the user rejected tool "mcp__account__portfolio_live_order"', true) });
  assert.equal(receipts, 1, 'a refusal is no fill');
});

// an old session's alpaca-kit order: its result is a tool row and nothing more, so it is no receipt
test("an old session's place_order result calls nothing", async () => {
  let receipts = 0;
  const r = rig({ rows: [row('live', { agentAvailable: true })], onReceipt: () => { receipts++; } });
  await r.ready();
  r.live.open('live'); await settle();
  const f = r.last('session/follow');
  f.cbs.onItem({ type: 'snapshot', header: { createdAt: 7 }, cursor: 2, records: [] });
  f.cbs.onItem({ type: 'event', event: { ...orderCall, seq: 50, data: { ...orderCall.data, name: 'mcp__alpaca-kit__place_order', arguments: JSON.stringify({ symbol: 'BTC/USD', qty: 0.00008, side: 'buy', order_type: 'market' }) } } });
  f.cbs.onItem({ type: 'event', event: orderResult(51, JSON.stringify({ ok: true, id: 'ord-1', status: 'accepted' }), false) });
  assert.equal(receipts, 0);
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
  assert.deepEqual(r.store.get().bots, [{ id: 'buffett', name: 'Buffett', description: '' }], 'a failed bots read keeps the names');
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

// the drill and the security review of 2026-10-21: the approval waterfall and the session's follow stream are two streams
// on one socket, so a gate can reach the page before its tool/call; the card's title is made from the host's own reason
// line, so it never waits on the call and no later call under the same id can change it
test("a seat gate is titled from the host's line before its tool/call reaches the page, and a call landing later changes nothing", async () => {
  const r = rig({ rows: [row('s1', { agentAvailable: true })] });
  await r.ready();
  r.live.open('s1'); await settle();
  const f = r.last('session/follow');
  f.cbs.onItem({ type: 'snapshot', header: { createdAt: 7 }, cursor: 2, records: [fixture(0), fixture(1)] });
  const gate = { ...frames[6], eventId: 'ev-seat', agentId: 's1', request: { toolName: 'mcp__account__portfolio_live_order', callId: 'c10', reason: 'Account seat - mcp__account__portfolio_live_order: side=buy usd=100 symbol=AAPL orderType=market venue=paper-1' } };
  r.opts().onGate(gate);
  const conv = () => r.store.get().conversations.find(c => c.id === 's1');
  const card = () => conv().messages.find(m => m.id === 'ev-seat');
  assert.equal(card().text, 'Your call: buy $100 of AAPL · market · paper-1');
  assert.equal(card().data.venue, 'paper-1');
  const seq = card().seq;
  f.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 60, time: NOW, data: { turn: 5, step: 1, callId: 'c10', name: 'mcp__account__portfolio_live_order', arguments: JSON.stringify({ venue: 'okx', symbol: 'BTC/USDT', side: 'sell', usd: 500 }) } } });
  assert.equal(card().text, 'Your call: buy $100 of AAPL · market · paper-1', 'a call under the same id, saying otherwise, changes nothing');
  assert.equal(card().seq, seq);
  assert.equal(conv().messages.filter(m => m.id === 'ev-seat').length, 1);
});

test("the workspace follow's baseline sets the pin set and a pinned frame replaces it", async () => {
  const r = rig();
  const w = r.last('workspace/follow');
  assert.deepEqual(w.args, {});
  w.cbs.onItem({ type: 'baseline', value: { items: [], archivedSessionIds: [], pinnedSessionIds: ['a', 'b'] } });
  assert.deepEqual(r.store.get().pinned, ['a', 'b']);
  w.cbs.onItem({ type: 'pinned', pinnedSessionIds: ['c'] });
  assert.deepEqual(r.store.get().pinned, ['c']);
});

test('the follow opens again after the mux reconnects, and the new baseline wins', async () => {
  const r = rig();
  r.last('workspace/follow').cbs.onItem({ type: 'baseline', value: { pinnedSessionIds: ['a'] } });
  r.opts().onDown('lost');
  assert.equal(r.last('workspace/follow').cancelled, true);
  r.opts().onReady({ home: '/h' });
  await settle();
  const again = r.streams.filter(s => s.name === 'workspace/follow');
  assert.equal(again.length, 2);
  again[1].cbs.onItem({ type: 'baseline', value: { pinnedSessionIds: ['z'] } });
  assert.deepEqual(r.store.get().pinned, ['z']);
  // a stream the host ended is opened again on the retry timer, once
  again[1].cbs.onEnd();
  for (const t of r.scheduled.splice(0)) t.fn();
  assert.equal(r.streams.filter(s => s.name === 'workspace/follow').length, 3);
});

// ---- activate (plan 3 task 8): a cold conversation opened before a command runs on it
const watch = p => { const out = { done: false, value: undefined }; void p.then(v => { out.done = true; out.value = v; }); return out; };

test('activate follows a paged conversation and answers once its snapshot lands', async () => {
  const r = rig({ rows: [row('cold')] });
  await r.ready();
  r.live.open('cold'); await settle();
  assert.equal(r.follows().length, 0);
  const got = watch(r.live.activate('cold'));
  assert.equal(r.follows().length, 1, 'followed, as promote does');
  const f = r.last('session/follow');
  assert.deepEqual(f.args, { request: { address: { kind: 'session', sessionId: 'cold' }, assistantStream: true } });
  f.cbs.onItem({ type: 'event', event: frames[0].event });
  await settle();
  assert.equal(got.done, false, 'an event is not the snapshot');
  f.cbs.onItem({ type: 'snapshot', header: {}, records: [fixture(0)], projections: { asOfSeq: 1, values: {} } });
  await settle();
  assert.deepEqual(got, { done: true, value: true });
  const again = watch(r.live.activate('cold'));
  await settle();
  assert.deepEqual(again, { done: true, value: true }, 'a follow that has its snapshot answers at once');
  assert.equal(r.follows().length, 1, 'and is not followed twice');
});

test('activate is true at once for a live conversation, false when the follow fails or never answers', async () => {
  const r = rig({ rows: [row('live', { agentAvailable: true }), row('a'), row('b')] });
  await r.ready();
  const live = watch(r.live.activate('live'));
  await settle();
  assert.deepEqual(live, { done: true, value: true });
  assert.equal(r.follows().length, 0, 'a live one needs no follow to answer');

  r.live.open('a'); await settle();
  const other = watch(r.live.activate('b'));
  await settle();
  assert.deepEqual(other, { done: true, value: false }, 'the view is on another conversation');

  const failed = watch(r.live.activate('a'));
  r.last('session/follow').cbs.onError({ code: 'gateway/lookup-not-found', message: 'gone' });
  await settle();
  assert.deepEqual(failed, { done: true, value: false });

  r.live.open('a'); await settle();
  const ended = watch(r.live.activate('a'));
  r.last('session/follow').cbs.onEnd();
  await settle();
  assert.deepEqual(ended, { done: true, value: false });

  r.live.open('a'); await settle();
  r.scheduled.splice(0);
  const silent = watch(r.live.activate('a'));
  await settle();
  assert.equal(silent.done, false);
  const timer = r.scheduled.find(t => t.ms === ACTIVATE_MS);
  assert.ok(timer, 'a deadline of ACTIVATE_MS');
  assert.equal(ACTIVATE_MS, 10_000);
  timer.fn();
  await settle();
  assert.deepEqual(silent, { done: true, value: false });
  r.last('session/follow').cbs.onItem({ type: 'snapshot', header: {}, records: [], projections: { asOfSeq: 1, values: {} } });
  await settle();
  assert.deepEqual(silent, { done: true, value: false }, 'a late snapshot changes nothing');
});

test('an activate that answers clears its deadline', async () => {
  const r = rig({ rows: [row('cold'), row('b')] });
  await r.ready();
  r.live.open('cold'); await settle();
  r.scheduled.splice(0);
  const got = watch(r.live.activate('cold'));
  const timer = r.scheduled.find(t => t.ms === ACTIVATE_MS);
  r.last('session/follow').cbs.onItem({ type: 'snapshot', header: {}, records: [], projections: { asOfSeq: 1, values: {} } });
  await settle();
  assert.deepEqual(got, { done: true, value: true });
  assert.deepEqual(r.cancelled, [timer], 'the snapshot cleared the deadline');
  r.live.open('b'); await settle();
  r.scheduled.splice(0);
  const gone = watch(r.live.activate('b'));
  const t2 = r.scheduled.find(t => t.ms === ACTIVATE_MS);
  r.last('session/follow').cbs.onError({ code: 'x', message: 'y' });
  await settle();
  assert.deepEqual(gone, { done: true, value: false });
  assert.ok(r.cancelled.includes(t2), 'a failed follow clears it too');
});

test('previews: an attachment-only last message reads as its names', async () => {
  const content = [{ type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'chart.png' } }, { type: 'file', attachment: { attachmentId: 'a2', name: 'q3.csv', bytes: 2 } }];
  const event = { type: 'user/message', seq: 7, time: 1, surfaceOp: 'append', data: { id: 'm7', role: 'user', content, source: { kind: 'user' } } };
  const r = rig({ rows: [row('p1', { updatedAt: 5 })], pages: { p1: [{ type: 'event', event }] } });
  await r.ready();
  await settle();
  assert.equal(r.store.get().conversations.find(c => c.id === 'p1').preview, 'chart.png, q3.csv');
});

// ---- the history window (plan 5 task 3)
const um = seq => ({ type: 'event', event: { ...frames[0].event, seq, data: { ...frames[0].event.data, id: 'msg-' + seq } } });
const ums = (...seqs) => seqs.map(um);
const ids = (r, id) => r.store.get().conversations.find(c => c.id === id).messages.map(m => m.seq);
const winOf = (r, id) => r.store.get().conversations.find(c => c.id === id).window;
const earlierCalls = r => r.calls.filter(c => c[0] === 'session/page' && c[1].request.beforeSeq !== undefined);
// a cold conversation opened on a 40 cut: its first page is 30-31, earlier pages by beforeSeq from `book`
const coldRig = (book, extra = {}) => rig({
  rows: [row('c'), row('d')], projections: () => ({ kind: 'sequenced', asOfSeq: 40, values: {} }),
  pages: { c: req => (req.beforeSeq === undefined ? { records: ums(30, 31), hasMore: true } : book(req)), d: [um(2)] }, ...extra,
});

test("a follow's snapshot sets the window from its records, cursor and hasMore; a page from asOfSeq and its hasMore", async () => {
  const r = rig({ rows: [row('live', { agentAvailable: true }), row('cold')], projections: () => ({ kind: 'sequenced', asOfSeq: 20, values: {} }),
    pages: { cold: req => ({ records: ums(10, 11), hasMore: req.maxMessages === undefined }) } });
  await r.ready();
  r.live.open('live'); await settle();
  r.last('session/follow').cbs.onItem({ type: 'snapshot', header: {}, cursor: 12, hasMore: true, records: ums(4, 7), projections: { asOfSeq: 12, values: {} } });
  assert.deepEqual(winOf(r, 'live'), { start: 4, through: 12, hasMore: true, replaced: [] });
  r.live.open('cold'); await settle();
  assert.deepEqual(winOf(r, 'cold'), { start: 10, through: 20, hasMore: true, replaced: [] });
});

test("earlier pages with beforeSeq at the window's start and throughSeq at its through, maxMessages 50", async () => {
  const r = coldRig(() => ({ records: ums(20, 21), hasMore: true }));
  await r.ready();
  r.live.open('c'); await settle();
  assert.equal(await r.live.earlier('c'), true);
  assert.deepEqual(earlierCalls(r).map(c => c[1]), [{ request: { address: { kind: 'session', sessionId: 'c' }, throughSeq: 40, beforeSeq: 30, maxMessages: 50 } }]);
  assert.deepEqual(ids(r, 'c'), [20, 21, 30, 31]);
  assert.deepEqual(winOf(r, 'c'), { start: 20, through: 40, hasMore: true, replaced: [] });
});

test('earlier with toSeq pages until the start reaches it, and dispatches once', async () => {
  const book = { 30: ums(20, 21), 20: ums(10, 11), 10: ums(5) };
  const r = coldRig(req => ({ records: book[req.beforeSeq], hasMore: true }));
  await r.ready();
  r.live.open('c'); await settle();
  const seen = [];
  const dispatch = r.store.dispatch;
  r.store.dispatch = (name, arg) => { seen.push(name); return dispatch(name, arg); };
  const p1 = r.live.earlier('c', { toSeq: 12 });
  assert.equal(r.live.earlier('c'), p1, 'a second call while one runs answers the first\'s promise');
  assert.equal(await p1, true);
  assert.deepEqual(earlierCalls(r).map(c => c[1].request.beforeSeq), [30, 20]);
  assert.equal(seen.filter(n => n === 'hostEarlier').length, 1);
  assert.deepEqual(ids(r, 'c'), [10, 11, 20, 21, 30, 31]);
  assert.equal(winOf(r, 'c').start, 10); assert.equal(winOf(r, 'c').loading, undefined);
});

test('earlier on a conversation with no more history, or not on screen, calls nothing', async () => {
  const r = rig({ rows: [row('c'), row('d')], projections: () => ({ kind: 'sequenced', asOfSeq: 40, values: {} }),
    pages: { c: () => ({ records: ums(30, 31), hasMore: false }), d: () => ({ records: ums(3), hasMore: true }) } });
  await r.ready();
  r.live.open('c'); await settle();
  const before = r.calls.length;
  assert.equal(await r.live.earlier('c'), false);
  assert.equal(await r.live.earlier('d'), false, 'd is not on screen');
  assert.equal(r.calls.length, before);
});

test('a conversation opened mid-paging drops the pages and clears loading', async () => {
  let release;
  const r = coldRig(() => new Promise(res => { release = () => res({ records: ums(20, 21), hasMore: true }); }));
  await r.ready();
  r.live.open('c'); await settle();
  const p = r.live.earlier('c', { toSeq: 1 });
  await settle();
  assert.equal(winOf(r, 'c').loading, true);
  r.live.open('d'); await settle();
  release();
  assert.equal(await p, false);
  assert.deepEqual(ids(r, 'c'), [30, 31], 'nothing prepended');
  assert.equal(winOf(r, 'c').loading, undefined);
  assert.deepEqual(ids(r, 'd'), [2], 'the new conversation starts at its tail');
  assert.equal(earlierCalls(r).length, 1, 'no further page');
});

test('a refused page says earlier: code and keeps the window', async () => {
  const r = coldRig(() => { throw Object.assign(new Error('nope'), { code: 'gateway/bad-request' }); });
  await r.ready();
  r.live.open('c'); await settle();
  assert.equal(await r.live.earlier('c'), false);
  assert.deepEqual(r.store.get().status, { line: 'earlier: gateway/bad-request', bad: true, connected: true });
  assert.deepEqual(ids(r, 'c'), [30, 31]);
  assert.deepEqual(winOf(r, 'c'), { start: 30, through: 40, hasMore: true, replaced: [] });
});

test('earlier never opens a follow', async () => {
  const r = rig({ rows: [row('live', { agentAvailable: true })], pages: { live: req => ({ records: ums(20, 21), hasMore: false, req }) } });
  await r.ready();
  r.live.open('live'); await settle();
  r.last('session/follow').cbs.onItem({ type: 'snapshot', header: {}, cursor: 44, hasMore: true, records: ums(30, 31), projections: { asOfSeq: 44, values: {} } });
  const streams = r.streams.length;
  assert.equal(await r.live.earlier('live'), true);
  assert.equal(r.streams.length, streams);
  assert.equal(earlierCalls(r)[0][1].request.throughSeq, 44, 'a followed one pages against its cursor');
  assert.deepEqual(ids(r, 'live'), [20, 21, 30, 31]);
  assert.equal(winOf(r, 'live').hasMore, false);
});

test("a compaction in the loaded window hides the seqs an earlier page brings back", async () => {
  const checkpoint = { type: 'event', event: { ...um(31).event, surfaceOp: { op: 'replace', startSeq: 20, endSeq: 29 } } };
  const r = rig({ rows: [row('c')], projections: () => ({ kind: 'sequenced', asOfSeq: 40, values: {} }),
    pages: { c: req => (req.beforeSeq === undefined ? { records: [um(30), checkpoint], hasMore: true } : { records: ums(18, 19, 20, 21), hasMore: true }) } });
  await r.ready();
  r.live.open('c'); await settle();
  assert.deepEqual(winOf(r, 'c').replaced, [[20, 29]]);
  assert.equal(await r.live.earlier('c'), true);
  assert.deepEqual(ids(r, 'c'), [18, 19, 30, 31]);
});

test('a stale earlier run neither clears a newer run\'s loading nor leaves its own behind', async () => {
  const held = [];
  const r = coldRig(req => new Promise(res => { held.push(() => res({ records: ums(req.beforeSeq - 10), hasMore: true })); }));
  await r.ready();
  r.live.open('c'); await settle();
  const stale = r.live.earlier('c');
  await settle();
  r.live.open('d'); await settle();
  r.live.open('c'); await settle();
  assert.equal(winOf(r, 'c').loading, undefined, 'the re-opened window starts with no loading');
  const fresh = r.live.earlier('c');
  assert.notEqual(fresh, stale);
  await settle();
  assert.equal(winOf(r, 'c').loading, true);
  held[0]();
  assert.equal(await stale, false);
  assert.equal(winOf(r, 'c').loading, true, 'the stale run leaves the newer one\'s loading');
  held[1]();
  assert.equal(await fresh, true);
  assert.equal(winOf(r, 'c').loading, undefined);
  assert.deepEqual(ids(r, 'c'), [20, 30, 31]);
});

test('a re-snapshot past a gap while an earlier read runs drops its pages, with no loading flicker', async () => {
  let release;
  const r = rig({ rows: [row('live', { agentAvailable: true })],
    pages: { live: () => new Promise(res => { release = () => res({ records: ums(10, 11), hasMore: true }); }) } });
  await r.ready();
  r.live.open('live'); await settle();
  const f = r.last('session/follow');
  f.cbs.onItem({ type: 'snapshot', header: {}, cursor: 69, hasMore: true, records: ums(20, 69), projections: { asOfSeq: 69, values: {} } });
  const p = r.live.earlier('live');
  await settle();
  const seen = [];
  const dispatch = r.store.dispatch;
  r.store.dispatch = (name, arg) => { seen.push([name, arg?.window?.loading]); return dispatch(name, arg); };
  f.cbs.onItem({ type: 'snapshot', header: {}, cursor: 129, hasMore: true, records: ums(80, 129), projections: { asOfSeq: 129, values: {} } });
  assert.deepEqual(seen.filter(([n]) => n === 'hostWindow' || n === 'hostEarlierLoading'), [['hostWindow', true]], 'one dispatch, loading folded in');
  assert.equal(winOf(r, 'live').loading, true);
  release();
  assert.equal(await p, false);
  assert.deepEqual(ids(r, 'live'), [80, 129]);
  assert.equal(winOf(r, 'live').start, 80); assert.equal(winOf(r, 'live').loading, undefined);
});

// the final review's ruling: the drawn window is bounded
test('one earlier call reads at most 40 pages toward its toSeq', async () => {
  assert.equal(EARLIER_MAX_PAGES, 40);
  const r = rig({ rows: [row('c')], projections: () => ({ kind: 'sequenced', asOfSeq: 9000, values: {} }),
    pages: { c: req => (req.beforeSeq === undefined ? { records: ums(5000, 5001), hasMore: true } : { records: ums(req.beforeSeq - 1), hasMore: true }) } });
  await r.ready();
  r.live.open('c'); await settle();
  assert.equal(await r.live.earlier('c', { toSeq: 1 }), true);
  assert.equal(earlierCalls(r).length, 40);
  assert.equal(winOf(r, 'c').start, 4960);
  assert.equal(winOf(r, 'c').hasMore, true);
});

const turnStart = (seq, turn) => ({ type: 'event', event: { type: 'turn/start', seq, time: NOW, data: { turn } } });
async function droppingRig(tail) {
  const r = rig({ rows: [row('live', { agentAvailable: true })], atTail: id => tail.at(id), pages: { live: () => ({ records: ums(20, 21), hasMore: true }) } });
  await r.ready();
  r.live.open('live'); await settle();
  r.last('session/follow').cbs.onItem({ type: 'snapshot', header: {}, cursor: 40, hasMore: true, records: ums(30, 31), projections: { asOfSeq: 40, values: {} } });
  assert.equal(await r.live.earlier('live'), true);
  assert.deepEqual(ids(r, 'live'), [20, 21, 30, 31]);
  return r;
}

test('a turn starting while the reader is at the tail drops the earlier pages, keeping the follow\'s own window', async () => {
  const asked = [];
  const r = await droppingRig({ at: id => { asked.push(id); return true; } });
  r.last('session/follow').cbs.onItem(turnStart(41, 3));
  assert.deepEqual(asked, ['live']);
  assert.deepEqual(ids(r, 'live'), [30, 31]);
  assert.deepEqual(winOf(r, 'live'), { start: 30, through: 40, hasMore: true, replaced: [] });
  // Earlier messages pages from the follow's start again
  assert.equal(await r.live.earlier('live'), true);
  assert.equal(earlierCalls(r).at(-1)[1].request.beforeSeq, 30);
});

test('a turn starting while the reader reads up keeps the earlier pages', async () => {
  const r = await droppingRig({ at: () => false });
  r.last('session/follow').cbs.onItem(turnStart(41, 3));
  assert.deepEqual(ids(r, 'live'), [20, 21, 30, 31]);
  assert.equal(winOf(r, 'live').start, 20);
  // a turn's end drops nothing either
  const r2 = await droppingRig({ at: () => true });
  r2.last('session/follow').cbs.onItem({ type: 'event', event: { type: 'turn/end', seq: 41, time: NOW, data: { turn: 3 } } });
  assert.deepEqual(ids(r2, 'live'), [20, 21, 30, 31]);
});
