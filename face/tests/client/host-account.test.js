// The account host layer (spec 2026-10-19 §7 Stage 2): /data/account.json, credentials/describe, the plugin registry and the
// quote providers into the store, against a recording getJson and call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startAccount, KEY_REFS, PROBE_IDS } from '../../client/js/host/account.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const keyed = (over = {}) => ({ ok: true, available: true, host: 'paper-api.alpaca.markets', account: { equity: '100' }, positions: [], orders: [], generated_at: 'g', ...over });

function rig({ json = {}, describe = async () => ({}) } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const calls = [];
  const getJson = path => {
    reads.push(path);
    const answer = Object.entries(json).find(([prefix]) => path.startsWith(prefix))?.[1];
    if (typeof answer === 'function') return answer(path);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  const call = (endpoint, args) => { calls.push([endpoint, args]); return describe(endpoint, args); };
  let t = 100;
  const account = startAccount({ store, getJson, call, now: () => ++t });
  return { store, account, reads, calls, a: () => store.get().account };
}

test('load reads /data/account.json once even when asked twice', async () => {
  let release;
  const r = rig({ json: { '/data/account.json': () => new Promise(res => { release = res; }) } });
  assert.equal(r.a().status, 'idle');
  const first = r.account.load();
  const second = r.account.load();
  assert.equal(r.a().status, 'loading');
  await tick();
  assert.equal(r.reads.length, 1);
  release(keyed());
  await Promise.all([first, second]);
  assert.equal(r.a().status, 'ready');
  assert.equal(r.a().data.account.equity, '100');
  assert.equal(typeof r.a().at, 'number');
  r.account.load();
  await tick();
  assert.equal(r.reads.length, 2, 'a load after the flight landed reads again');
});

test('a stale body stays stale; a 503 keeps the last good data and reads error; the keyless answer is ready', async () => {
  const answers = [keyed(), keyed({ stale: true }), Object.assign(new Error('/data/account.json: HTTP 503'), { status: 503 }), { ok: false, error: 'GET /v2/account -> HTTP 401' }, { ok: true, available: false, reason: 'no APCA keys in the environment' }];
  const r = rig({ json: { '/data/account.json': () => { const next = answers.shift(); return next instanceof Error ? Promise.reject(next) : Promise.resolve(next); } } });
  await r.account.load();
  await r.account.load();
  assert.equal(r.a().status, 'ready');
  assert.equal(r.a().data.stale, true);
  await r.account.load();
  assert.equal(r.a().status, 'error');
  assert.equal(r.a().data.stale, true, 'the last data stays');
  await r.account.load();
  assert.equal(r.a().status, 'error', 'an ok:false body is a failure');
  assert.equal(r.a().data.available, true);
  await r.account.load();
  assert.equal(r.a().status, 'ready');
  assert.equal(r.a().data.available, false);
});

test('describe makes three reads, and one failing leaves the others', async () => {
  const creds = { APCA_API_KEY_ID: { configured: true, source: 'env', writable: false }, APCA_API_SECRET_KEY: { configured: true, source: 'env', writable: false } };
  const providers = [{ id: 'alpaca', market: 'us', status: 'connected', source: 'Alpaca', feed: 'iex', transport: 'stream', message: '' }];
  const r = rig({
    json: {
      '/data/plugins.json': Promise.resolve({ mcp: [{ server: 'alpaca-kit', phase: 'active', tools: [{ name: 'mcp__alpaca-kit__account', description: '' }, { name: 'mcp__alpaca-kit__place_order', description: '' }] }], agentTools: [], rows: [] }),
      '/data/quotes': Promise.resolve({ ok: true, generated_at: '2026-10-19T14:30:01Z', quotes: [], providers }),
    },
    describe: async () => creds,
  });
  await r.account.describe();
  assert.deepEqual(r.calls, [['credentials/describe', { refs: KEY_REFS }]]);
  assert.deepEqual(KEY_REFS, ['APCA_API_KEY_ID', 'APCA_API_SECRET_KEY']);
  assert.deepEqual(r.reads.sort(), ['/data/plugins.json', `/data/quotes?ids=${encodeURIComponent(PROBE_IDS.join(','))}`].sort());
  assert.deepEqual(PROBE_IDS, ['us:SPY', 'crypto:BTC/USD', 'cn:600519']);
  assert.deepEqual(r.a().creds, creds);
  assert.deepEqual(r.a().tools, ['mcp__alpaca-kit__account', 'mcp__alpaca-kit__place_order']);
  assert.deepEqual(r.a().probe, providers);

  const broken = rig({
    json: { '/data/plugins.json': new Error('/data/plugins.json: HTTP 500'), '/data/quotes': Promise.resolve({ ok: true, generated_at: '2026-10-19T14:30:01Z', quotes: [], providers }) },
    describe: async () => { throw Object.assign(new Error('credentials service is absent'), { code: 'gateway/internal' }); },
  });
  await broken.account.describe();
  await settle();
  assert.equal(broken.a().creds, null, 'unknown, not absent');
  assert.equal(broken.a().tools, null);
  assert.deepEqual(broken.a().probe, providers);
  const garbled = rig({ json: { '/data/plugins.json': Promise.resolve({ mcp: 'x' }), '/data/quotes': Promise.resolve({ ok: false }) }, describe: async () => creds });
  await garbled.account.describe();
  assert.equal(garbled.a().tools, null);
  assert.deepEqual(garbled.a().probe, []);
  assert.deepEqual(garbled.a().creds, creds);
});
