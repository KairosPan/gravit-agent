// The seat host layer (spec 2026-10-20 §6.3): /data/seat.json into the store, one flight at a time, against a recording getJson.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startSeat } from '../../client/js/host/seat.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const view = (over = {}) => ({ ok: true, url: 'http://127.0.0.1:4820', reachable: true, asOf: '2026-10-20T14:40:00.000Z', mode: 'guard', writes: { on: true, capUsd: 100 }, cardMinutes: 30, seat: { name: 'Gravit', status: 'admitted', limits: [] }, venues: [], cards: [], others: 0, ...over });

function rig(json = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const getJson = path => {
    reads.push(path);
    const answer = Object.entries(json).find(([prefix]) => path.startsWith(prefix))?.[1];
    if (typeof answer === 'function') return answer(path);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  let t = 100;
  const seat = startSeat({ store, getJson, now: () => ++t });
  return { store, seat, reads, s: () => store.get().seat };
}

test('the seat slice starts idle with nothing read', () => {
  assert.deepEqual(emptyState().seat, { status: 'idle', data: null, at: null });
});

test('load reads /data/seat.json once even when asked twice, and the view lands', async () => {
  const r = rig({ '/data/seat.json': view() });
  const a = r.seat.load(); const b = r.seat.load();
  assert.equal(r.s().status, 'loading');
  await Promise.all([a, b]); await settle();
  assert.deepEqual(r.reads, ['/data/seat.json']);
  assert.equal(r.s().status, 'ready'); assert.equal(r.s().data.seat.status, 'admitted'); assert.equal(r.s().at, 101);
});

test('a fresh load reads ?fresh=1', async () => {
  const r = rig({ '/data/seat.json': view() });
  await r.seat.load({ fresh: true }); await settle();
  assert.deepEqual(r.reads, ['/data/seat.json?fresh=1']);
});

test('a failed read is error and keeps the last data; a body that is not the view is error too', async () => {
  const answers = { '/data/seat.json': view() };
  const r = rig(answers);
  await r.seat.load(); await settle();
  answers['/data/seat.json'] = new Error('HTTP 503');
  await r.seat.load({ fresh: true }); await settle();
  assert.equal(r.s().status, 'error'); assert.equal(r.s().data.seat.status, 'admitted', 'the last good view stays');
  answers['/data/seat.json'] = { ok: false, error: 'forbidden' };
  await r.seat.load({ fresh: true }); await settle();
  assert.equal(r.s().status, 'error');
  answers['/data/seat.json'] = view({ reachable: false, error: 'ECONNREFUSED' });
  await r.seat.load({ fresh: true }); await settle();
  assert.equal(r.s().status, 'ready'); assert.equal(r.s().data.reachable, false, 'not reachable is a state the view carries, not a failed read');
});
