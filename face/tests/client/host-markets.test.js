// The markets host layer (spec 2026-10-19 §7 Stage 2): the face's live quotes, search, watchlist and bars into the store,
// against fake wire factories, a memory storage and a recording getJson.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startMarkets, WATCH_LIMIT, HIT_QUOTES } from '../../client/js/host/markets.js';
import { STORAGE_KEY, LEGACY_STORAGE_KEY } from '../../client/js/wire/market-model.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const asset = (id, over = {}) => {
  const market = id.slice(0, id.indexOf(':'));
  const symbol = id.slice(id.indexOf(':') + 1);
  return { id, market, symbol, name: symbol, exchange: '', currency: market === 'cn' ? 'CNY' : 'USD', ...over };
};
const saved = items => JSON.stringify({ version: 1, items });
const quote = (id, over = {}) => ({
  id, market: id.slice(0, id.indexOf(':')), symbol: id.slice(id.indexOf(':') + 1), price: 10, prev_close: 9, change: 1, change_pct: 11.1,
  volume: 100, as_of: '2026-10-19T14:30:00Z', received_at: null, volume_as_of: null, source: 'Alpaca', feed: 'iex', basis: 'previous_close',
  quote_status: 'live', market_status: 'open', message: '', ...over,
});
const payload = quotes => ({ ok: true, generated_at: '2026-10-19T14:30:01Z', quotes, providers: [] });

function memoryStorage(seed = {}, { failWrites = false, failReads = false } = {}) {
  const map = new Map(Object.entries(seed));
  const writes = [];
  return {
    map, writes,
    getItem(key) { if (failReads) throw new Error('denied'); return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { if (failWrites) throw new Error('quota'); writes.push(key); map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

function rig({ storage = memoryStorage(), account = null, json = {} } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  if (account) store.dispatch('accountLoaded', { data: account, at: 1 });
  const live = { assets: [], visible: [], onUpdate: null, closed: false };
  const createLiveQuotes = onUpdate => {
    live.onUpdate = onUpdate;
    return { setAssets(a) { live.assets.push(a.map(x => x.id)); }, setVisible(v) { live.visible.push(v); }, refresh() {}, close() { live.closed = true; } };
  };
  const search = { queries: [], onUpdate: null, cancelled: 0 };
  const createSymbolSearch = onUpdate => {
    search.onUpdate = onUpdate;
    return { search(q, market) { search.queries.push([q, market]); }, cancel() { search.cancelled++; } };
  };
  const reads = [];
  const getJson = path => {
    reads.push(path);
    const answer = Object.entries(json).find(([prefix]) => path.startsWith(prefix))?.[1];
    if (typeof answer === 'function') return answer(path);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? {});
  };
  const listeners = {};
  const win = {
    addEventListener(type, fn) { (listeners[type] ??= new Set()).add(fn); },
    removeEventListener(type, fn) { listeners[type]?.delete(fn); },
  };
  const markets = startMarkets({ store, createLiveQuotes, createSymbolSearch, storage, getJson, win });
  const m = () => store.get().markets;
  const fire = (type, event) => { for (const fn of listeners[type] ?? []) fn(event); };
  return { store, markets, live, search, reads, storage, m, fire, listeners, lastAssets: () => live.assets.at(-1) };
}
const keyed = positions => ({ ok: true, available: true, host: 'paper-api.alpaca.markets', account: { equity: '1' }, positions, orders: [] });

test('show(true) subscribes the watchlist and the holdings; show(false) pauses; coming back resumes', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: saved([asset('crypto:BTC/USD')]) });
  const r = rig({ storage, account: keyed([{ symbol: 'AAPL', asset_class: 'us_equity', exchange: 'NASDAQ' }]) });
  assert.equal(r.live.visible[0], false, 'paused until Markets is on screen');
  r.markets.show(true);
  assert.equal(r.live.visible.at(-1), true);
  assert.deepEqual(r.lastAssets(), ['crypto:BTC/USD', 'us:AAPL']);
  r.markets.show(false);
  assert.equal(r.live.visible.at(-1), false);
  r.markets.show(true);
  assert.equal(r.live.visible.at(-1), true);
  const calls = r.live.assets.length;
  r.store.dispatch('hostStatus', { line: 'connected', bad: false, connected: true });
  assert.equal(r.live.assets.length, calls, 'the same id set is not subscribed again');
  r.store.dispatch('accountLoaded', { data: keyed([{ symbol: 'AAPL', asset_class: 'us_equity' }, { symbol: 'MSFT', asset_class: 'us_equity' }]), at: 2 });
  assert.deepEqual(r.lastAssets(), ['crypto:BTC/USD', 'us:AAPL', 'us:MSFT'], 'a new holding joins');
});

test("a market page's own asset joins the subscription first, and leaves with the page", () => {
  const r = rig({ storage: memoryStorage({ [STORAGE_KEY]: saved([asset('us:AAPL')]) }) });
  r.markets.show(true);
  r.store.reset({ ...r.store.get(), route: { screen: 'markets', id: 'us:NVDA' } });
  assert.deepEqual(r.lastAssets(), ['us:NVDA', 'us:AAPL']);
  r.store.reset({ ...r.store.get(), route: { screen: 'markets', id: null } });
  assert.deepEqual(r.lastAssets(), ['us:AAPL']);
});

test('a watch saves the asset under gravit.market.watchlist.v1 and re-subscribes; unwatch removes it', () => {
  const r = rig();
  r.markets.show(true);
  r.search.onUpdate({ query: 'apple', market: 'all', status: 'success', assets: [asset('us:AAPL', { name: 'Apple', exchange: 'NASDAQ' })], partial: false, truncated: false, note: '' });
  r.markets.watch('us:aapl');
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['us:AAPL']);
  assert.equal(r.m().watchError, null);
  const stored = JSON.parse(r.storage.map.get(STORAGE_KEY));
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.items.map(a => [a.id, a.name, a.exchange]), [['us:AAPL', 'Apple', 'NASDAQ']]);
  assert.deepEqual(r.lastAssets(), ['us:AAPL']);
  r.markets.watch('us:AAPL');
  assert.equal(r.m().watchlist.length, 1, 'no duplicate');
  r.markets.watch('garbage');
  assert.equal(r.m().watchlist.length, 1, 'an invalid id is ignored');
  r.markets.watch('crypto:btc-usd');
  assert.deepEqual(r.m().watchlist.map(a => [a.id, a.name]), [['us:AAPL', 'Apple'], ['crypto:BTC/USD', 'BTC/USD']]);
  r.markets.unwatch('us:AAPL');
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['crypto:BTC/USD']);
  assert.deepEqual(JSON.parse(r.storage.map.get(STORAGE_KEY)).items.map(a => a.id), ['crypto:BTC/USD']);
  assert.deepEqual(r.lastAssets(), ['crypto:BTC/USD']);
});

test('a list saved by the old page under the kairos key is read, and never written or removed', () => {
  const storage = memoryStorage({ [LEGACY_STORAGE_KEY]: saved([asset('us:MSFT', { name: 'Microsoft' })]) });
  const r = rig({ storage });
  assert.deepEqual(r.m().watchlist.map(a => [a.id, a.name]), [['us:MSFT', 'Microsoft']]);
  assert.deepEqual(storage.writes, [], 'reading writes nothing');
  r.markets.watch('us:AAPL');
  assert.deepEqual(storage.writes, [STORAGE_KEY]);
  assert.ok(storage.map.has(LEGACY_STORAGE_KEY));
});

test('a failed save keeps the list and reports unsaved; the 101st watch is refused as full; an unreadable list reads as read', () => {
  const failing = rig({ storage: memoryStorage({}, { failWrites: true }) });
  failing.markets.watch('us:AAPL');
  assert.deepEqual(failing.m().watchlist.map(a => a.id), ['us:AAPL']);
  assert.equal(failing.m().watchError, 'unsaved');

  const hundred = Array.from({ length: WATCH_LIMIT }, (_, i) => asset(`us:S${i}`));
  const full = rig({ storage: memoryStorage({ [STORAGE_KEY]: saved(hundred) }) });
  full.markets.watch('us:AAPL');
  assert.equal(full.m().watchlist.length, WATCH_LIMIT);
  assert.equal(full.m().watchError, 'full');
  assert.deepEqual(full.storage.writes, []);
  full.markets.unwatch('us:S0');
  assert.equal(full.m().watchError, null, 'the next save clears it');

  assert.equal(rig({ storage: memoryStorage({}, { failReads: true }) }).m().watchError, 'read');
  assert.equal(rig({ storage: memoryStorage({ [STORAGE_KEY]: '{not json' }) }).m().watchError, 'read');
});

test('quotes and search reach the store without their notes; hits get one REST quote read', async () => {
  const r = rig({ json: { '/data/quotes': () => Promise.resolve(payload([quote('us:NVDA', { price: 123 })])) } });
  r.live.onUpdate({ quotes: { 'us:AAPL': quote('us:AAPL') }, providers: [{ id: 'alpaca', market: 'us', status: 'connected', source: 'Alpaca', feed: 'iex', transport: 'stream', message: '' }], status: 'streaming', refreshing: false, generatedAt: 'x', note: '行情连接已断开', limited: 0 });
  assert.equal(r.m().quotes['us:AAPL'].price, 10);
  assert.equal(r.m().providers[0].status, 'connected');
  assert.equal(r.m().connection, 'streaming');
  r.markets.search('nvd');
  assert.deepEqual(r.search.queries, [['nvd', 'all']]);
  r.search.onUpdate({ query: 'nvd', market: 'all', status: 'loading', assets: [], partial: false, truncated: false, note: '' });
  assert.deepEqual(r.m().search, { query: 'nvd', status: 'loading', assets: [], partial: false });
  assert.deepEqual(r.reads, []);
  r.search.onUpdate({ query: 'nvd', market: 'all', status: 'success', assets: [asset('us:NVDA'), asset('us:NVDL')], partial: true, truncated: false, note: '部分行情源暂不可用' });
  assert.equal(r.reads.length, 1);
  assert.equal(new URL(r.reads[0], 'http://x').searchParams.get('ids'), 'us:NVDA,us:NVDL');
  await settle();
  assert.equal(r.m().hitQuotes['us:NVDA'].price, 123);
  assert.equal(r.m().search.partial, true);
  assert.doesNotMatch(JSON.stringify(r.m()), /行情连接已断开|部分行情源暂不可用/, 'no note reaches the store');
});

test('a hit read asks for at most 30 quotes, a malformed answer leaves the hits without quotes, and a late answer loses to a newer search', async () => {
  let release;
  const answers = [new Promise(res => { release = res; }), Promise.resolve(payload([quote('us:B0', { price: 2 })]))];
  const r = rig({ json: { '/data/quotes': () => answers.shift() } });
  const many = Array.from({ length: HIT_QUOTES + 5 }, (_, i) => asset(`us:A${i}`));
  r.search.onUpdate({ query: 'a', market: 'all', status: 'success', assets: many, partial: false, truncated: false, note: '' });
  assert.equal(new URL(r.reads[0], 'http://x').searchParams.get('ids').split(',').length, HIT_QUOTES);
  r.search.onUpdate({ query: 'b', market: 'all', status: 'loading', assets: [], partial: false, truncated: false, note: '' });
  r.search.onUpdate({ query: 'b', market: 'all', status: 'success', assets: [asset('us:B0')], partial: false, truncated: false, note: '' });
  await settle();
  release(payload([quote('us:A0', { price: 1 })]));
  await settle();
  assert.deepEqual(Object.keys(r.m().hitQuotes), ['us:B0'], 'the older search answered last and was dropped');

  const bad = rig({ json: { '/data/quotes': () => Promise.resolve({ ok: true, quotes: 'nope' }) } });
  bad.search.onUpdate({ query: 'z', market: 'all', status: 'success', assets: [asset('us:Z')], partial: false, truncated: false, note: '' });
  await settle();
  assert.deepEqual(bad.m().hitQuotes, {});
});

test('bars: one read of /data/bars per call for a us id, none for crypto or cn; a failure reads failed', async () => {
  const rows = [{ date: '2026-10-16', open: 1, high: 1, low: 1, close: 1, volume: 1 }, { date: '2026-10-17', open: 2, high: 2, low: 2, close: 2, volume: 2 }];
  const r = rig({ json: { '/data/bars?id=us%3AAAPL': () => Promise.resolve({ ok: true, id: 'us:AAPL', source: 'alpaca', feed: 'iex', as_of: '2026-10-17', rows }), '/data/bars?id=us%3AMSFT': new Error('/data/bars: HTTP 503') } });
  const loading = r.markets.bars('us:aapl');
  assert.equal(r.m().bars['us:AAPL'].status, 'loading');
  await loading;
  assert.deepEqual(r.reads, ['/data/bars?id=us%3AAAPL&days=120']);
  assert.equal(r.m().bars['us:AAPL'].status, 'ready');
  assert.equal(r.m().bars['us:AAPL'].payload.rows.length, 2);
  await r.markets.bars('us:AAPL');
  assert.equal(r.reads.length, 2, 'once per call');
  await r.markets.bars('crypto:BTC/USD');
  await r.markets.bars('cn:600519');
  await r.markets.bars('garbage');
  assert.equal(r.reads.length, 2);
  await r.markets.bars('us:MSFT');
  assert.deepEqual(r.m().bars['us:MSFT'], { status: 'failed' });
});

test("another tab's storage event reloads the watchlist; other keys are ignored; close stops listening", () => {
  const storage = memoryStorage();
  const r = rig({ storage });
  r.markets.show(true);
  storage.map.set(STORAGE_KEY, saved([asset('us:KO')]));
  r.fire('storage', { key: 'something-else' });
  assert.deepEqual(r.m().watchlist, []);
  r.fire('storage', { key: STORAGE_KEY });
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['us:KO']);
  assert.deepEqual(r.lastAssets(), ['us:KO']);
  r.markets.close();
  assert.equal(r.live.closed, true);
  assert.equal(r.listeners.storage.size, 0);
  storage.map.set(STORAGE_KEY, saved([]));
  r.fire('storage', { key: STORAGE_KEY });
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['us:KO'], 'closed: no reload');
});
