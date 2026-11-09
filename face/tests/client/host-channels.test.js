// The channels host layer (spec 2026-10-19 §7 Stage 3 "Channels"): the overview read, latest-started wins, a failure
// keeps the last data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startChannels } from '../../client/js/host/channels.js';
import { spoken } from './helpers/spoken.js';

function rig(answer, extra = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const posted = [];
  const postJson = async (path, body) => { posted.push([path, body]); return answer(path, body); };
  const channels = startChannels({ store, postJson, getJson: async () => ({}), refresh: async () => {}, now: () => 7, ...extra });
  return { store, channels, posted };
}

test('overview posts the workspace id and lands', async () => {
  const r = rig(() => ({ ok: true, channel: { workspaceId: 'w1' }, status: {}, body: {} }));
  await r.channels.overview('w1');
  assert.deepEqual(r.posted, [['/data/channels/overview', { workspaceId: 'w1' }]]);
  const c = r.store.get().channel;
  assert.equal(c.id, 'w1'); assert.equal(c.status, 'ready'); assert.deepEqual(c.data.channel, { workspaceId: 'w1' }); assert.equal(c.at, 7);
});

test('a later read for another channel wins over an earlier one', async () => {
  const pending = {};
  const r = rig((path, body) => new Promise(res => { pending[body.workspaceId] = res; }));
  const a = r.channels.overview('w1');
  const b = r.channels.overview('w2');
  pending.w2({ ok: true, channel: { workspaceId: 'w2' } });
  await b;
  pending.w1({ ok: true, channel: { workspaceId: 'w1' } });
  await a;
  assert.equal(r.store.get().channel.id, 'w2');
  assert.deepEqual(r.store.get().channel.data.channel, { workspaceId: 'w2' });
});

test('a failed read keeps the last data and reads failed; a 404 reads missing', async () => {
  let fail = null;
  const r = rig(() => { if (fail) throw fail; return { ok: true, channel: { workspaceId: 'w1' } }; });
  await r.channels.overview('w1');
  fail = Object.assign(new Error('HTTP 500'), { status: 500 });
  await r.channels.overview('w1');
  assert.equal(r.store.get().channel.status, 'failed');
  assert.deepEqual(r.store.get().channel.data.channel, { workspaceId: 'w1' });
  fail = Object.assign(new Error('no such channel'), { status: 404 });
  await r.channels.overview('w1');
  assert.equal(r.store.get().channel.status, 'missing');
});

const gamma = { workspaceId: 'w9', name: 'gamma-ray', title: 'gamma-ray', dir: '/r/strategies/gamma-ray', isRoot: false, missingDir: false, sessionIds: [] };

test('create folds the name, posts it and finds the new channel by its dir', async () => {
  const r = rig((path, body) => ({ ok: true, name: body.name, dir: `/r/strategies/${body.name}`, isRoot: false }), {
    refresh: async () => { r.store.dispatch('hostList', { conversations: [], channels: [gamma] }); },
  });
  assert.deepEqual(await r.channels.create('  gamma ray '), { workspaceId: 'w9' });
  assert.deepEqual(r.posted, [['/data/channels', { name: 'gamma-ray' }]]);
});

test('an invalid name or _template is refused before any post; a route refusal brings its words', async () => {
  const r = rig(() => { throw Object.assign(new Error('channel already exists'), { status: 409, code: 'channel already exists' }); });
  for (const bad of ['', '   ', '_template', 'a/b', 'x.y', '-lead']) assert.deepEqual(spoken(await r.channels.create(bad)), { error: 'Letters, digits, - or _' }, bad);
  assert.deepEqual(r.posted, []);
  assert.deepEqual(await r.channels.create('alpha'), { error: 'channel already exists' });
});

test('setAgents and setBots post and re-read the overview; a seventh bot is refused', async () => {
  const r = rig((path, body) => (path === '/data/channels/overview' ? { ok: true, channel: { workspaceId: body.workspaceId } } : { ok: true }));
  assert.deepEqual(await r.channels.setAgents('w1', ['codex']), { ok: true });
  assert.deepEqual(await r.channels.setBots('w1', ['buffett', 'drill-bear']), { ok: true });
  assert.deepEqual(r.posted.map(p => p[0]), ['/data/channels/agents', '/data/channels/overview', '/data/channels/bots', '/data/channels/overview']);
  assert.deepEqual(r.posted[0][1], { workspaceId: 'w1', agents: ['codex'] });
  assert.deepEqual(r.posted[2][1], { workspaceId: 'w1', bots: ['buffett', 'drill-bear'] });
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(spoken(await r.channels.setBots('w1', seven)), { error: 'At most six bots' });
  assert.equal(r.posted.length, 4, 'nothing posted for seven');
});

test('agentChoices are the connected agents that answered', async () => {
  const r = rig(() => ({ ok: true }), {
    getJson: async () => ({ main: {}, local: [{ bin: 'codex', label: 'Codex', found: true }, { bin: 'gone', label: 'Gone', found: false }, { bin: 'claude', found: true }], candidates: [{ bin: 'gemini' }] }),
  });
  assert.deepEqual(await r.channels.agentChoices(), [{ bin: 'codex', label: 'Codex' }, { bin: 'claude', label: 'claude' }]);
});

// one-entry plan 2: the paper positions at the venue a strategy's status.yaml names
test('positions reads /data/account/positions?venue=… and maps through positionsOf', async () => {
  const reads = [];
  const r = rig(() => ({ ok: true, channel: { workspaceId: 'w1' }, status: {}, body: {} }), {
    getJson: async path => { reads.push(path); return { ok: true, positions: [{ venue: 'paper-us', symbol: 'NVDA', side: 'long', qty: '12', entryPrice: 120.5, markPrice: '131.25', unrealizedUsd: 129, paper: true, extra: 'x' }] }; },
  });
  await r.channels.overview('w1');
  assert.deepEqual(reads, [], 'an overview naming no venue reads none');
  await r.channels.positions('paper/us');
  assert.deepEqual(reads, ['/data/account/positions?venue=paper%2Fus']);
  const p = r.store.get().channel.positions;
  assert.equal(p.status, 'ready'); assert.equal(p.venue, 'paper/us');
  assert.deepEqual(p.rows, [{ venue: 'paper-us', venueName: '', symbol: 'NVDA', name: '', side: 'long', qty: 12, entryPrice: 120.5, markPrice: 131.25, usd: null, unrealizedUsd: 129, paper: true, kind: '', leverage: null }]);
});

test('an overview naming a venue reads its positions once', async () => {
  const reads = [];
  const r = rig(() => ({ ok: true, channel: { workspaceId: 'w1' }, status: { venue: 'paper-us' }, body: {} }), {
    getJson: async path => { reads.push(path); return { ok: true, positions: [] }; },
  });
  await r.channels.overview('w1');
  await new Promise(res => setImmediate(res));
  assert.deepEqual(reads, ['/data/account/positions?venue=paper-us']);
  assert.equal(r.store.get().channel.positions.status, 'ready');
});

test('a 409 refusal is a line, not a throw', async () => {
  const r = rig(() => ({ ok: true, channel: { workspaceId: 'w1' }, status: {}, body: {} }), {
    getJson: async () => { throw Object.assign(new Error('HTTP 409'), { status: 409, body: { ok: false, refusal: { code: 'NOT_PAPER', message: 'paper-x is not a paper venue' } } }); },
  });
  await r.channels.overview('w1');
  await assert.doesNotReject(r.channels.positions('paper-x'));
  assert.deepEqual(r.store.get().channel.positions, { status: 'refused', venue: 'paper-x', rows: [], message: 'paper-x is not a paper venue' });
  // a refusal with a code alone says its code; the Account down (no body) fails, with no words of its own
  const coded = rig(() => ({ ok: true }), { getJson: async () => { throw Object.assign(new Error('HTTP 409'), { status: 409, body: { ok: false, refusal: { code: 'NOT_PAPER' } } }); } });
  await coded.channels.overview('w1');
  await coded.channels.positions('paper-x');
  assert.equal(coded.store.get().channel.positions.message, 'NOT_PAPER');
  const down = rig(() => ({ ok: true }), { getJson: async () => { throw Object.assign(new Error('HTTP 502'), { status: 502 }); } });
  await down.channels.overview('w1');
  await down.channels.positions('paper-x');
  assert.deepEqual(down.store.get().channel.positions, { status: 'failed', venue: 'paper-x', rows: [], message: null });
});
