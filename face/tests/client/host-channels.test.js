// The channels host layer (spec 2026-10-19 §7 Stage 3 "Channels"): the overview read, latest-started wins, a failure
// keeps the last data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startChannels } from '../../client/js/host/channels.js';

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
