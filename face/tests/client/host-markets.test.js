// The Markets host layer (spec 2026-10-22 §6.1): the Account's reads through the face's proxy — explore for the tab on screen,
// the quotes of the rows in view, a market page's candles and compare rows, the page's market followed on the Account's stream —
// the two watch stores, the old us:/crypto: stars asked of the Account once, and the face's own wire for the A shares alone;
// over the stand-in's answers (tests/fixtures/account/), with recording timers, a recording getJson, a fake stream, fake cn wire
// factories and a memory storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startMarkets, EXPLORE_MS, QUOTES_MS, QUOTE_PAIRS, WATCH_LIMIT } from '../../client/js/host/markets.js';
import { rowsOf, pageOf } from '../../client/js/host/market-view.js';
import { STORAGE_KEY, ACCOUNT_WATCH_KEY, readAccountWatch, saveAccountWatch } from '../../client/js/wire/market-model.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const itemOf = (body, key) => body.items.find(i => i.key === key);
const NOW = Date.parse('2026-10-22T08:00:00.000Z');
const asset = (id, over = {}) => {
  const [market, symbol] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  return { id, market, symbol, name: symbol, exchange: '', currency: market === 'cn' ? 'CNY' : 'USD', ...over };
};
const saved = items => JSON.stringify({ version: 1, items });
const deferred = () => { let resolve; const promise = new Promise(res => { resolve = res; }); return { promise, resolve }; };
// a refusal as the app's getJson rejects it: the status, with the Account's body carried on the error
const refused = (status, body) => Object.assign(new Error(`HTTP ${status}`), { status, body });
const query = path => Object.fromEntries(new URL(path, 'http://x').searchParams);
const pairsIn = path => query(path).pairs.split(',');

const ALL = '/data/account/explore?limit=200';
const PREDICTIONS = '/data/account/explore?tab=predictions&limit=200';
const IDLE = { status: 'idle', data: null, at: null };

// the Account's quotes?pairs= answer: each pair's market (the stand-in's NVDA figures, stamped), the paper perp's refused, and any
// pair named in `refuse` refused too
const quoted = (pairs, refuse = []) => ({
  ok: true,
  quotes: pairs.map(p => {
    const venue = p.slice(0, p.indexOf('|'));
    const symbol = p.slice(p.indexOf('|') + 1);
    if (venue === 'paper' || refuse.includes(p)) return { venue, symbol, refusal: { code: 'E_ACCOUNT_BAD_ACTION', message: 'not quoted here' } };
    return { venue, symbol, market: { ...fx('market').market, quoteAt: '2026-10-22T07:59:58.000Z', quoteFrom: 'Stand-in Broker · real time' } };
  }),
});
const NVDA_QUOTE = { price: 182.4, bid: 182.38, ask: 182.42, quoteAt: '2026-10-22T07:59:58.000Z', quoteFrom: 'Stand-in Broker · real time', changePct24h: 1.9, volumeUsd24h: 31688394070 };

// a browser's storage in memory; `failWrites` refuses every write, `failKeys` the writes under those keys alone
function memoryStorage(seed = {}, { failWrites = false, failKeys = [] } = {}) {
  const map = new Map(Object.entries(seed));
  const writes = [];
  return {
    map, writes,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { if (failWrites || failKeys.includes(key)) throw new Error('quota'); writes.push(key); map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

function rig({ storage = memoryStorage(), answer = () => undefined } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const live = { assets: [], visible: [], closed: false };
  const createLiveQuotes = onUpdate => {
    live.onUpdate = onUpdate;
    return { setAssets(a) { live.assets.push(a.map(x => x.id)); }, setVisible(v) { live.visible.push(v); }, refresh() {}, close() { live.closed = true; } };
  };
  const search = { queries: [], cancelled: 0, onUpdate: null };
  const createSymbolSearch = onUpdate => {
    search.onUpdate = onUpdate;
    return { search(q, market) { search.queries.push([q, market]); }, cancel() { search.cancelled++; } };
  };
  const reads = [];
  const getJson = path => {
    reads.push(path);
    const a = answer(path);
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  };
  // recording timers: nothing runs until a test fires the ones due at a delay
  const timers = [];
  const schedule = (fn, ms) => { const t = { fn, ms, done: false, cancelled: false }; timers.push(t); return t; };
  const cancelTimer = t => { t.done = true; t.cancelled = true; };
  const due = ms => timers.filter(t => !t.done && (ms === undefined || t.ms === ms));
  const fire = ms => { for (const t of due(ms)) { t.done = true; t.fn(); } };
  const follows = [];
  const stream = { follow(keys) { follows.push([...keys]); } };
  const listeners = {};
  const win = {
    addEventListener(type, fn) { (listeners[type] ??= new Set()).add(fn); },
    removeEventListener(type, fn) { listeners[type]?.delete(fn); },
  };
  const markets = startMarkets({ store, getJson, createLiveQuotes, createSymbolSearch, storage, win, stream, schedule, cancelTimer, now: () => NOW });
  const emit = (type, event) => { for (const fn of listeners[type] ?? []) fn(event); };
  return { store, markets, live, search, reads, storage, timers, due, fire, follows, listeners, emit, m: () => store.get().markets };
}

test('show reads explore now and every 20 s; quotes for the pairs in view every 5 s, twelve a call; show(false) cancels', async () => {
  assert.deepEqual(emptyState().markets, {
    tab: 'all', sort: 'volume', q: '',
    explore: {}, results: IDLE, accountQuotes: {}, candles: {}, compare: {}, watch: [], watchError: null, asked: {},
    watchlist: [], quotes: {}, providers: [], connection: 'idle', search: { query: '', status: 'idle', assets: [], partial: false }, hitQuotes: {},
  }, 'the slice the host starts from');
  // two quiet stocks past the fixture's twelve rows: Most traded puts them last, so the first twelve rows leave them out
  const quiet = (symbol, usd) => ({
    key: `stock:${symbol}`, kind: 'stock', name: symbol, base: symbol, price: 10, volumeUsd24h: usd, tabs: ['all', 'stocks'],
    at: [{ venue: 'broker', venueName: 'Stand-in Broker', symbol, connected: true, canTrade: true, public: false, price: 10, open: true }],
  });
  const all = fx('explore-all');
  all.items.push(quiet('MSFT', 2_000), quiet('KO', 1_000));
  let refuse = [];
  let held = null;
  const r = rig({
    answer: path => {
      if (path === ALL) return all;
      if (path === PREDICTIONS) return fx('explore-predictions');
      if (path.startsWith('/data/account/explore?tab=')) return { ok: true, items: [] };
      if (path.startsWith('/data/account/quotes?')) return held ? held.promise : quoted(pairsIn(path), refuse);
      return undefined;
    },
  });
  assert.deepEqual(r.reads, [], 'nothing is read until Markets is on screen');
  assert.deepEqual(r.due(), []);
  assert.equal(r.live.visible[0], false, "the face's wire is paused until then too");

  r.markets.show(true);
  assert.deepEqual(r.reads, [ALL], 'explore at once');
  assert.equal(r.m().explore.all.status, 'loading');
  assert.equal(r.live.visible.at(-1), true);
  assert.deepEqual(r.due().map(t => t.ms).sort((a, b) => a - b), [QUOTES_MS, EXPLORE_MS]);
  assert.deepEqual([EXPLORE_MS, QUOTES_MS, QUOTE_PAIRS], [20_000, 5_000, 12]);
  r.markets.show(true);
  assert.equal(r.due().length, 2, 'shown again: no second poll');
  assert.equal(r.reads.length, 1);
  await settle();
  assert.equal(r.m().explore.all.status, 'ready');
  assert.equal(r.m().explore.all.at, NOW);
  assert.equal(rowsOf(r.m(), NOW).length, 14);

  // every 5 s, the first twelve rows' most traded connected lines
  r.fire(QUOTES_MS);
  assert.match(r.reads.at(-1), /^\/data\/account\/quotes\?pairs=/);
  assert.deepEqual(pairsIn(r.reads.at(-1)), [
    'broker|NVDA', 'broker|SPY', 'broker|AAPL', 'ex|BTC/USDT:USDT', 'ex|BTC/USDT', 'ex|ETH/USDT:USDT', 'ex|ETH/USDT',
    'paper-momentum|DOGE/USD', 'ex|SOL/USDT:USDT', 'ex|SOL/USDT', 'paper-momentum|LINK/USD', 'paper|DOGE/USDC:USDC',
  ], 'twelve a call: the two quiet stocks wait');
  assert.equal(r.due(QUOTES_MS).length, 1, 'and again in 5 s');
  await settle();
  assert.deepEqual(r.m().accountQuotes['broker|NVDA'], NVDA_QUOTE);
  assert.equal(Object.hasOwn(r.m().accountQuotes, 'paper|DOGE/USDC:USDC'), false, 'a refused pair is not quoted');

  // the rows in view, as the screen names them: their pairs alone, in the table's order; a cn row has none
  r.markets.rowsInView(['stock:MSFT', 'coin:ETH', 'cn:600519', 'stock:NVDA']);
  refuse = ['broker|NVDA'];
  r.fire(QUOTES_MS);
  assert.deepEqual(pairsIn(r.reads.at(-1)), ['broker|NVDA', 'ex|ETH/USDT', 'broker|MSFT']);
  await settle();
  assert.deepEqual(r.m().accountQuotes['broker|NVDA'], NVDA_QUOTE, 'a refusal leaves the pair as it was');
  assert.equal(r.m().accountQuotes['broker|MSFT'].price, 182.4);
  // one quotes read in the air at a time: a slow Account is not asked again before it answers
  held = deferred();
  r.fire(QUOTES_MS);
  const asked = r.reads.length;
  r.markets.rowsInView(['stock:NVDA']);
  r.fire(QUOTES_MS);
  assert.equal(r.reads.length, asked, 'the tick while it is out asks nothing, even for other rows');
  held.resolve(quoted(['broker|NVDA']));
  held = null;
  await settle();
  r.markets.rowsInView([]);
  r.fire(QUOTES_MS);
  assert.equal(r.reads.length, asked, 'no rows in view: nothing asked');
  assert.equal(r.due(QUOTES_MS).length, 1, 'the poll goes on');

  // every 20 s, explore again
  r.fire(EXPLORE_MS);
  assert.equal(r.reads.at(-1), ALL);
  assert.equal(r.due(EXPLORE_MS).length, 1);
  // a tab changed while shown reads its own at once, and its poll starts over from the change; All's read is kept
  r.store.dispatch('setMarketsTab', 'predictions');
  assert.equal(r.reads.at(-1), PREDICTIONS, "a kind's tab reads its own");
  assert.equal(r.due(EXPLORE_MS).length, 1, 'one explore poll');
  await settle();
  assert.equal(r.m().explore.predictions.status, 'ready');
  assert.equal(r.m().explore.all.status, 'ready');
  assert.equal(r.m().explore.all.data, all);
  r.fire(EXPLORE_MS);
  assert.equal(r.reads.at(-1), PREDICTIONS, 'the poll reads the tab on screen');
  await settle();
  r.store.dispatch('setMarketsTab', 'watching');
  assert.equal(r.reads.at(-1), ALL, "Watching reads All's");

  r.markets.show(false);
  assert.equal(r.live.visible.at(-1), false);
  assert.deepEqual(r.due(), [], 'both polls cancelled');
  assert.equal(r.timers.filter(t => t.cancelled).length >= 2, true);
  const hidden = r.reads.length;
  r.store.dispatch('setMarketsTab', 'crypto');
  assert.equal(r.reads.length, hidden, 'a tab changed while hidden reads nothing');
  r.markets.show(true);
  assert.equal(r.reads.at(-1), '/data/account/explore?tab=crypto&limit=200', 'shown again: the tab on screen at once');
  r.markets.close();
  assert.deepEqual(r.due(), [], 'close leaves no timer');
  assert.equal(r.live.closed, true);
  assert.equal(r.search.cancelled, 1);
  assert.deepEqual(r.follows.at(-1), [], 'close lets every follow go');
  r.markets.show(true);
  assert.deepEqual(r.due(), [], 'closed: nothing starts again');
});

test('an explore refusal keeps the last rows and the Account message', async () => {
  const busy = 'The Account is reading its venues; try again in a moment.';
  let later = null;
  const answers = [
    fx('explore-all'),
    refused(409, { ok: false, refusal: { code: 'E_ACCOUNT_BUSY', message: busy } }),
    { ok: true, rows: [] },
    new Error('/data/account/explore: HTTP 503'),
    { ok: false, error: 'explore is not ready' },
    fx('explore-all'),
  ];
  const r = rig({ answer: path => (path === ALL ? (later ? later.promise : answers.shift()) : undefined) });
  r.markets.show(true);
  await settle();
  const rows = rowsOf(r.m(), NOW).map(x => x.id);
  assert.equal(rows.length, 12);

  r.fire(EXPLORE_MS);
  await settle();
  assert.equal(r.m().explore.all.status, 'error');
  assert.equal(r.m().explore.all.message, busy, "a 409 carries the Account's sentence");
  assert.equal(r.m().explore.all.at, NOW);
  assert.deepEqual(rowsOf(r.m(), NOW).map(x => x.id), rows, 'the last rows stay');
  r.fire(EXPLORE_MS);
  assert.equal(r.m().explore.all.status, 'loading');
  assert.equal(r.m().explore.all.message, busy, 'and its sentence, while the next read is out');
  await settle();
  assert.equal(r.m().explore.all.status, 'error', 'a body that is not explore is never its rows');
  assert.equal(r.m().explore.all.message, null);
  assert.deepEqual(rowsOf(r.m(), NOW).map(x => x.id), rows);
  r.fire(EXPLORE_MS);
  await settle();
  assert.equal(r.m().explore.all.status, 'error', 'an unreachable Account: no sentence of its own');
  assert.equal(r.m().explore.all.message, null);
  assert.deepEqual(rowsOf(r.m(), NOW).map(x => x.id), rows);
  r.fire(EXPLORE_MS);
  await settle();
  assert.equal(r.m().explore.all.message, 'explore is not ready', "a 200 that says ok: false is the Account's refusal too");
  assert.deepEqual(rowsOf(r.m(), NOW).map(x => x.id), rows);
  r.fire(EXPLORE_MS);
  await settle();
  assert.equal(r.m().explore.all.status, 'ready');
  assert.equal(r.m().explore.all.message, null, 'the next answer clears it');

  // one flight: a tick while the read is out joins it, and its answer lands once
  later = deferred();
  r.fire(EXPLORE_MS);
  const out = r.reads.length;
  r.store.dispatch('setMarketsTab', 'stocks');
  r.store.dispatch('setMarketsTab', 'all');
  assert.equal(r.reads.length, out + 1, "the tab's own read went; All's again joined the one out");
  later.resolve({ ok: false, refusal: { message: busy } });
  await settle();
  assert.equal(r.m().explore.all.message, busy);
  assert.deepEqual(rowsOf(r.m(), NOW).map(x => x.id), rows);
  // a read that answers after close lands nowhere
  later = deferred();
  r.fire(EXPLORE_MS);
  r.markets.close();
  const closed = r.m();
  later.resolve(fx('explore-all'));
  await settle();
  assert.equal(r.m(), closed);
});

test('search reads explore?q and the cn search; results land in results', async () => {
  const all = fx('explore-all');
  const only = base => ({ ...fx('explore-all'), items: all.items.filter(i => i.base === base) });
  const btc = deferred();
  const late = deferred();
  const r = rig({
    answer: path => {
      const q = query(path);
      if (path === ALL) return all;
      if (q.q === 'eth') return only('ETH');
      if (q.q === 'btc') return btc.promise;
      if (q.q === 'sol') return only('SOL');
      if (q.q === 'none') return refused(409, { ok: false, refusal: { message: 'Search is busy.' } });
      if (q.q === 'late') return late.promise;
      if (path.startsWith('/data/quotes?')) return { ok: true, generated_at: '2026-10-22T07:59:59Z', providers: [], quotes: [] };
      return { ok: true, items: [] };
    },
  });
  r.markets.show(true);
  await settle();
  r.store.dispatch('setMarketsSort', 'Biggest moves');
  assert.equal(r.m().sort, 'movers', 'a sort by its label');
  r.markets.search('eth');
  assert.equal(r.m().q, 'eth');
  assert.equal(r.m().tab, 'results', 'a query from nothing opens All results');
  assert.equal(r.m().sort, 'volume', 'from Most traded, as any tab');
  assert.equal(r.reads.at(-1), '/data/account/explore?q=eth&limit=200');
  assert.deepEqual(r.search.queries.at(-1), ['eth', 'cn'], "the face's search, for the A shares alone");
  assert.equal(r.m().results.status, 'loading');
  r.markets.search('eth');
  assert.equal(r.reads.filter(p => query(p).q === 'eth').length, 1, 'the same search in the air is one read');
  await settle();
  assert.equal(r.m().results.status, 'ready');
  assert.equal(r.m().results.at, NOW);
  assert.deepEqual(rowsOf(r.m(), NOW).map(x => x.id), ['perp:ETH', 'coin:ETH']);
  assert.equal(r.reads.filter(p => p === ALL).length, 1, 'All results while searching reads no explore of its own');

  // a later search wins: the one it overtook is dropped when it answers
  r.markets.search('btc');
  r.markets.search('sol');
  await settle();
  btc.resolve(only('BTC'));
  await settle();
  assert.deepEqual(rowsOf(r.m(), NOW).map(x => x.id), ['perp:SOL', 'coin:SOL']);
  assert.equal(r.m().tab, 'results', 'the tab stays while the query changes');
  // the cn search's hits get one quote read on the face's wire, as today
  r.search.onUpdate({ query: 'sol', market: 'cn', status: 'success', assets: [asset('cn:600519', { name: 'Kweichow Moutai', exchange: 'SH' })], partial: false, truncated: false, note: '' });
  assert.equal(r.reads.at(-1), '/data/quotes?ids=cn%3A600519');
  assert.deepEqual(r.m().search, { query: 'sol', status: 'success', assets: [asset('cn:600519', { name: 'Kweichow Moutai', exchange: 'SH' })], partial: false });
  // a refusal keeps the last results with the Account's sentence; the text is trimmed and encoded
  r.markets.search('none');
  await settle();
  assert.equal(r.m().results.status, 'error');
  assert.equal(r.m().results.message, 'Search is busy.');
  assert.deepEqual(rowsOf(r.m(), NOW).map(x => x.id).slice(0, 2), ['perp:SOL', 'coin:SOL']);
  r.markets.search(' S&P 500 ');
  assert.equal(r.reads.at(-1), '/data/account/explore?q=S%26P%20500&limit=200');
  assert.deepEqual(r.search.queries.at(-1), [' S&P 500 ', 'cn']);

  // a blank query: back to All, the results idle, the cn search cancelled, and a read still out dropped
  r.markets.search('late');
  r.markets.search('');
  assert.equal(r.m().q, '');
  assert.equal(r.m().tab, 'all', 'cleared on All results: back to All');
  assert.deepEqual(r.m().results, IDLE);
  assert.equal(r.search.cancelled, 1);
  late.resolve(only('ETH'));
  await settle();
  assert.deepEqual(r.m().results, IDLE, 'the read it overtook lands nowhere');
  const n = r.reads.length;
  r.markets.search('   ');
  assert.equal(r.reads.length, n, 'a blank query reads nothing');
  // a query typed on a kind's tab opens All results too; Watching, cleared, stays where it is
  r.store.dispatch('setMarketsTab', 'crypto');
  r.markets.search('do');
  assert.equal(r.m().tab, 'results');
  r.store.dispatch('setMarketsTab', 'watching');
  r.markets.search('');
  assert.equal(r.m().tab, 'watching');
  await settle();
  // All results with no query, chosen as a tab, reads All's; any tab starts from Most traded; a tab the Account does not draw is
  // nothing
  r.store.dispatch('setMarketsSort', 'movers');
  const before = r.reads.length;
  r.store.dispatch('setMarketsTab', 'results');
  assert.equal(r.m().tab, 'results');
  assert.equal(r.m().sort, 'volume');
  assert.deepEqual(r.reads.slice(before), [ALL]);
  r.store.dispatch('setMarketsTab', 'venues');
  assert.equal(r.m().tab, 'results');
  r.markets.close();
});

test('watch: an Account key goes to the account store, a cn id to the cn list; the cn wire subscribes cn only', async () => {
  const storage = memoryStorage({ [STORAGE_KEY]: saved([asset('cn:000001', { name: 'Ping An Bank', exchange: 'SZ' }), asset('us:MSFT')]) });
  const r = rig({ storage, answer: () => ({ ok: true, items: [] }) });
  await settle();
  assert.deepEqual(r.live.assets.at(-1), ['cn:000001'], 'never us:MSFT: the Account quotes it, or no one does');
  assert.equal(r.m().asked['us:MSFT'], null, 'the old star was asked and missed');

  r.markets.watch('coin:BTC');
  assert.deepEqual(r.m().watch, ['coin:BTC']);
  assert.equal(r.m().watchError, null);
  assert.deepEqual(JSON.parse(storage.map.get(ACCOUNT_WATCH_KEY)), { version: 1, items: ['coin:BTC'] });
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['cn:000001', 'us:MSFT'], 'the cn list as it was');
  r.markets.watch('coin:BTC');
  r.markets.watch('event:predict:SI-FEDCUT-DEC');
  assert.deepEqual(r.m().watch, ['coin:BTC', 'event:predict:SI-FEDCUT-DEC'], 'once each');
  r.markets.watch('cn:600519');
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['cn:000001', 'us:MSFT', 'cn:600519']);
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)).items.map(a => a.id), ['cn:000001', 'us:MSFT', 'cn:600519']);
  assert.deepEqual(r.live.assets.at(-1), ['cn:000001', 'cn:600519']);
  const writes = storage.writes.length;
  for (const id of ['us:AAPL', 'crypto:ETH/USD', 'garbage', '', null]) r.markets.watch(id);
  assert.equal(storage.writes.length, writes, 'a us:, crypto: or unknown id is nobody’s to star');
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['cn:000001', 'us:MSFT', 'cn:600519']);
  assert.deepEqual(r.m().watch, ['coin:BTC', 'event:predict:SI-FEDCUT-DEC']);

  // a cn page's own id joins the subscription first; an Account or us: page adds nothing
  r.store.reset({ ...r.store.get(), route: { screen: 'markets', id: 'cn:600000' } });
  assert.deepEqual(r.live.assets.at(-1), ['cn:600000', 'cn:000001', 'cn:600519']);
  r.store.reset({ ...r.store.get(), route: { screen: 'markets', id: 'coin:BTC' } });
  assert.deepEqual(r.live.assets.at(-1), ['cn:000001', 'cn:600519']);
  const subscriptions = r.live.assets.length;
  r.store.reset({ ...r.store.get(), route: { screen: 'markets', id: 'us:AAPL' } });
  assert.equal(r.live.assets.length, subscriptions, 'the same ids are not subscribed again');

  r.markets.unwatch('coin:BTC');
  assert.deepEqual(r.m().watch, ['event:predict:SI-FEDCUT-DEC']);
  assert.deepEqual(JSON.parse(storage.map.get(ACCOUNT_WATCH_KEY)).items, ['event:predict:SI-FEDCUT-DEC']);
  r.markets.unwatch('cn:600519');
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['cn:000001', 'us:MSFT']);
  assert.deepEqual(r.live.assets.at(-1), ['cn:000001']);
  // an old star still listed is taken off the cn list, and what it was found as is forgotten
  r.markets.unwatch('us:MSFT');
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['cn:000001']);
  assert.equal(Object.hasOwn(r.m().asked, 'us:MSFT'), false);

  // another tab's storage event for either key reloads both; other keys are ignored
  storage.map.set(ACCOUNT_WATCH_KEY, saved(['perp:ETH']));
  r.emit('storage', { key: 'something-else' });
  assert.deepEqual(r.m().watch, ['event:predict:SI-FEDCUT-DEC']);
  r.emit('storage', { key: ACCOUNT_WATCH_KEY });
  assert.deepEqual(r.m().watch, ['perp:ETH']);

  // the hundred-and-first key is refused as full; a failed write keeps the star and says unsaved
  const hundred = Array.from({ length: WATCH_LIMIT }, (_, i) => `stock:S${i}`);
  const full = rig({ storage: memoryStorage({ [ACCOUNT_WATCH_KEY]: saved(hundred) }) });
  full.markets.watch('coin:BTC');
  assert.equal(full.m().watch.length, WATCH_LIMIT);
  assert.equal(full.m().watchError, 'full');
  assert.deepEqual(full.storage.writes, []);
  full.markets.unwatch('stock:S0');
  assert.equal(full.m().watchError, null, 'the next save clears it');
  const failing = rig({ storage: memoryStorage({}, { failWrites: true }) });
  failing.markets.watch('coin:SOL');
  assert.deepEqual(failing.m().watch, ['coin:SOL']);
  assert.equal(failing.m().watchError, 'unsaved');

  // the stored keys: the Account's grammar only, once each, the first hundred; the stored value is left as it is
  const junk = memoryStorage({ [ACCOUNT_WATCH_KEY]: saved(['coin:BTC', 'coin:BTC', 'us:AAPL', 42, 'cn:600519', ...hundred, 'stock:LAST']) });
  const read = readAccountWatch(junk);
  assert.deepEqual(read.items, ['coin:BTC', ...hundred.slice(0, WATCH_LIMIT - 1)]);
  assert.equal(typeof read.error, 'string', 'the unreadable entries are said');
  assert.deepEqual(junk.writes, []);
  assert.deepEqual(readAccountWatch(memoryStorage()), { items: [], error: null });
  assert.equal(typeof readAccountWatch(memoryStorage({ [ACCOUNT_WATCH_KEY]: '{not json' })).error, 'string');
  assert.equal(typeof readAccountWatch(null).error, 'string');
  assert.equal(rig({ storage: memoryStorage({ [ACCOUNT_WATCH_KEY]: '{not json' }) }).m().watchError, 'read');
  assert.equal(rig({ storage: memoryStorage({ [STORAGE_KEY]: '{not json', [ACCOUNT_WATCH_KEY]: saved(['coin:BTC']) }) }).m().watchError, 'read', 'either store unreadable is said');
  const clean = memoryStorage();
  assert.equal(typeof saveAccountWatch(clean, ['coin:BTC', 'us:AAPL']), 'string', 'a face id is refused');
  assert.equal(typeof saveAccountWatch(clean, [...hundred, 'coin:BTC']), 'string', 'past a hundred is refused');
  assert.deepEqual(clean.writes, []);
  assert.equal(saveAccountWatch(clean, ['coin:BTC', 'coin:BTC', 'perp:ETH']), null);
  assert.deepEqual(JSON.parse(clean.map.get(ACCOUNT_WATCH_KEY)), { version: 1, items: ['coin:BTC', 'perp:ETH'] });
  for (const x of [r, full, failing]) x.markets.close();
});

test('page: candles for the range, compare for a coin, the stream follow; leaving releases the follow; range re-reads candles', async () => {
  const late = deferred();
  const moved = deferred();
  const r = rig({
    answer: path => {
      const q = query(path);
      if (path === ALL) return fx('explore-all');
      // an event that names a base all the same: only its kind keeps it from compare
      if (path === PREDICTIONS) { const body = fx('explore-predictions'); itemOf(body, 'event:predict:SI-FEDCUT-DEC').base = 'FED'; return body; }
      if (path.startsWith('/data/account/candles?') && q.range === '1Y') return refused(409, { ok: false, refusal: { message: 'No history at this range.' } });
      if (path.startsWith('/data/account/candles?') && q.range === '6M') return moved.promise;
      if (path.startsWith('/data/account/candles?')) return q.range === '1M' ? late.promise : { ...fx('candles'), venue: q.venue, symbol: q.symbol, range: q.range };
      if (path.startsWith('/data/account/compare?')) return { ...fx('compare'), base: q.base };
      return undefined;
    },
  });
  // a deep link: All's read has not answered, so the page's reads wait for the read that lists its market
  r.markets.page('coin:ETH');
  assert.deepEqual(r.reads, []);
  assert.deepEqual(r.follows, []);
  r.markets.show(true);
  await settle();
  assert.deepEqual(r.reads, [ALL, '/data/account/candles?venue=ex&symbol=ETH%2FUSDT&range=1D', '/data/account/compare?base=ETH&side=buy']);
  assert.deepEqual(r.follows.at(-1), ['ex:ETH/USDT'], 'its first connected line, venue:symbol');
  await settle();
  assert.equal(r.m().candles['coin:ETH'].status, 'ready');
  assert.equal(r.m().candles['coin:ETH'].range, '1D');
  assert.equal(r.m().compare.ETH.status, 'ready');
  const view = pageOf(r.m(), r.store.get().account, 'coin:ETH', NOW);
  assert.equal(view.range, '1D');
  assert.equal(view.candles.candles.length, 12);
  assert.deepEqual(view.compare.map(x => x.venue), ['ex', 'wallet']);
  r.fire(EXPLORE_MS);
  await settle();
  assert.equal(r.reads.filter(p => p.startsWith('/data/account/candles')).length, 1, "the page's reads ran once");

  // a range re-reads the candles for it, and the page keeps it; a range the Account does not draw is nothing
  r.markets.range('coin:ETH', '5D');
  assert.equal(r.m().candles['coin:ETH'].range, '5D');
  assert.equal(r.m().candles['coin:ETH'].status, 'loading');
  assert.equal(r.m().candles['coin:ETH'].data.range, '1D', 'the last candles stay while the next are read');
  assert.equal(r.reads.at(-1), '/data/account/candles?venue=ex&symbol=ETH%2FUSDT&range=5D');
  await settle();
  assert.equal(r.m().candles['coin:ETH'].data.range, '5D');
  const n = r.reads.length;
  r.markets.range('coin:ETH', '2D');
  r.markets.range('coin:ETH', '1d');
  assert.equal(r.reads.length, n);
  assert.equal(r.m().candles['coin:ETH'].range, '5D');
  // a range left before its candles answer: they land nowhere
  r.markets.range('coin:ETH', '1M');
  r.markets.range('coin:ETH', '3M');
  await settle();
  late.resolve({ ...fx('candles'), range: '1M' });
  await settle();
  assert.equal(r.m().candles['coin:ETH'].range, '3M');
  assert.equal(r.m().candles['coin:ETH'].data.range, '3M');
  // the range moved on with no read of its own (as when its market is no longer listed): the old range's answer lands nowhere
  r.markets.range('coin:ETH', '6M');
  r.store.dispatch('setRange', { id: 'coin:ETH', range: '3M' });
  moved.resolve({ ...fx('candles'), range: '6M' });
  await settle();
  assert.equal(r.m().candles['coin:ETH'].range, '3M');
  assert.equal(r.m().candles['coin:ETH'].data.range, '3M');

  // leaving lets the follow go
  r.markets.page(null);
  assert.deepEqual(r.follows.at(-1), []);
  // a stock is compared; an RWA only a public listing names follows that listing and is not compared; a cn page reads nothing
  r.markets.page('stock:NVDA');
  assert.deepEqual(r.reads.slice(-2), ['/data/account/candles?venue=broker&symbol=NVDA&range=1D', '/data/account/compare?base=NVDA&side=buy']);
  assert.deepEqual(r.follows.at(-1), ['broker:NVDA']);
  r.markets.page('perp:ETH');
  assert.deepEqual(r.reads.slice(-2), ['/data/account/candles?venue=ex&symbol=ETH%2FUSDT%3AUSDT&range=1D', '/data/account/compare?base=ETH&side=buy'], 'a perpetual is compared');
  assert.deepEqual(r.follows.at(-1), ['ex:ETH/USDT:USDT']);
  await settle();
  const rwa = r.reads.length;
  r.markets.page('rwa:NVDA');
  assert.deepEqual(r.reads.slice(rwa), ['/data/account/candles?venue=standin-stock-tokens&symbol=NVDA&range=1D'], 'a mover is listed too; an RWA is not compared');
  assert.deepEqual(r.follows.at(-1), ['standin-stock-tokens:NVDA'], 'no connected line: its first public listing');
  r.store.dispatch('setMarketsTab', 'predictions');
  await settle();
  const before = r.reads.length;
  r.markets.page('event:predict:SI-FEDCUT-DEC');
  assert.deepEqual(r.reads.slice(before), ['/data/account/candles?venue=predict&symbol=SI-FEDCUT-DEC%3AYES&range=1D'], 'an event is not compared');
  assert.deepEqual(r.follows.at(-1), ['predict:SI-FEDCUT-DEC:YES']);
  await settle();
  const quiet = r.reads.length;
  r.markets.page('cn:600519');
  assert.equal(r.reads.length, quiet, "a cn page is the face's wire's");
  assert.deepEqual(r.follows.at(-1), [], 'and follows nothing of the Account');
  // back to a page: its kept range
  r.store.dispatch('setMarketsTab', 'all');
  r.markets.page('coin:ETH');
  assert.equal(r.reads.filter(p => p.startsWith('/data/account/candles?')).at(-1), '/data/account/candles?venue=ex&symbol=ETH%2FUSDT&range=3M');
  assert.deepEqual(r.follows.at(-1), ['ex:ETH/USDT']);
  await settle();
  // a failed read keeps the last candles, under the range asked
  r.markets.range('coin:ETH', '1Y');
  await settle();
  assert.equal(r.m().candles['coin:ETH'].status, 'error');
  assert.equal(r.m().candles['coin:ETH'].range, '1Y');
  assert.equal(r.m().candles['coin:ETH'].data.range, '3M');
  assert.equal(r.m().candles['coin:ETH'].at, NOW);
  // a page whose market no read lists: nothing is read, and the page it left lets its follow go
  const unlisted = r.reads.length;
  r.markets.page('coin:NOPE');
  assert.equal(r.reads.length, unlisted);
  assert.deepEqual(r.follows.at(-1), []);
  r.markets.close();
  const closedReads = r.reads.length;
  r.markets.page('stock:SPY');
  r.markets.range('coin:ETH', '1Y');
  assert.equal(r.reads.length, closedReads, 'closed: nothing is read');
});

test('old us: and crypto: stars are asked of the Account once; a hit moves the star, a miss is Not listed', async () => {
  const all = fx('explore-all');
  const storage = memoryStorage({
    [STORAGE_KEY]: saved([
      asset('us:AAPL', { name: 'Apple' }), asset('cn:600519', { name: 'Kweichow Moutai', exchange: 'SH' }), asset('crypto:BTC/USD'),
      asset('us:ZZZZ'), asset('crypto:DOGE/USD'), asset('us:KO'),
    ]),
  });
  const aapl = deferred();
  const ko = deferred();
  const r = rig({
    storage,
    answer: path => {
      const q = query(path);
      if (q.limit !== '12') return path === ALL ? all : undefined;
      if (q.q === 'AAPL') return aapl.promise;
      // the perp first: only a coin answers a crypto star
      if (q.q === 'BTC') return { ...all, items: [itemOf(all, 'perp:BTC'), itemOf(all, 'coin:BTC')] };
      if (q.q === 'ZZZZ') return { ...all, items: [itemOf(all, 'stock:NVDA')] };
      if (q.q === 'DOGE') return refused(503, { ok: false, unreachable: 'ECONNREFUSED' });
      if (q.q === 'KO') return ko.promise;
      return undefined;
    },
  });
  assert.deepEqual(r.reads, ['/data/account/explore?q=AAPL&limit=12'], 'one ask at a time; a cn star asks nothing');
  assert.deepEqual(r.m().asked, {});
  aapl.resolve({ ...all, items: [{ ...itemOf(all, 'stock:AAPL'), base: 'aapl' }] });
  await settle();
  assert.deepEqual(r.reads, ['AAPL', 'BTC', 'ZZZZ', 'DOGE', 'KO'].map(q => `/data/account/explore?q=${q}&limit=12`));
  // the star taken off while its ask is out: the answer moves nothing
  r.markets.unwatch('us:KO');
  ko.resolve({ ok: true, items: [{ key: 'stock:KO', kind: 'stock', base: 'KO', name: 'Coca-Cola', at: [] }] });
  await settle();

  assert.deepEqual(r.m().asked, { 'us:AAPL': 'stock:AAPL', 'crypto:BTC/USD': 'coin:BTC', 'us:ZZZZ': null });
  assert.equal(Object.hasOwn(r.m().asked, 'crypto:DOGE/USD'), false, 'a failed read leaves it for the next boot');
  assert.deepEqual(r.m().watch, ['stock:AAPL', 'coin:BTC'], 'a hit moves the star to the Account key');
  assert.deepEqual(JSON.parse(storage.map.get(ACCOUNT_WATCH_KEY)).items, ['stock:AAPL', 'coin:BTC']);
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['cn:600519', 'us:ZZZZ', 'crypto:DOGE/USD']);
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)).items.map(a => a.id), ['cn:600519', 'us:ZZZZ', 'crypto:DOGE/USD']);
  assert.deepEqual(r.live.assets.at(-1), ['cn:600519'], 'the old stars were never on the wire');

  // the rows: the moved stars are the Account's rows, starred; the miss is listed once, Not listed at the Account; the
  // un-asked star draws nothing
  r.markets.show(true);
  await settle();
  const rows = rowsOf(r.m(), NOW);
  assert.deepEqual(rows.filter(x => x.watched).map(x => x.id), ['stock:AAPL', 'coin:BTC', 'cn:600519', 'us:ZZZZ']);
  assert.deepEqual(rows.filter(x => x.notListed).map(x => [x.id, x.sub]), [['us:ZZZZ', 'Not listed at the Account']]);
  assert.equal(rows.some(x => x.id === 'crypto:DOGE/USD'), false);

  // once: nothing is asked again in this run, whatever reloads the lists
  const asks = () => r.reads.filter(p => query(p).limit === '12').length;
  assert.equal(asks(), 5);
  r.emit('storage', { key: STORAGE_KEY });
  r.markets.watch('cn:600000');
  await settle();
  assert.equal(asks(), 5);
  // Remove on the Not listed line takes it off and forgets it
  r.markets.unwatch('us:ZZZZ');
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['cn:600519', 'crypto:DOGE/USD', 'cn:600000']);
  assert.equal(Object.hasOwn(r.m().asked, 'us:ZZZZ'), false);

  // the Account's list full: the star stays where it is, found as its key and starred so, until it is taken off as that key
  const hundred = Array.from({ length: WATCH_LIMIT }, (_, i) => `stock:S${i}`);
  const crowded = memoryStorage({ [ACCOUNT_WATCH_KEY]: saved(hundred), [STORAGE_KEY]: saved([asset('us:AAPL')]) });
  const full = rig({ storage: crowded, answer: path => (query(path).q === 'AAPL' ? { ...all, items: [itemOf(all, 'stock:AAPL')] } : path === ALL ? all : undefined) });
  await settle();
  assert.equal(full.m().asked['us:AAPL'], 'stock:AAPL');
  assert.deepEqual(full.m().watchlist.map(a => a.id), ['us:AAPL']);
  assert.equal(full.m().watch.length, WATCH_LIMIT);
  full.markets.show(true);
  await settle();
  assert.equal(rowsOf(full.m(), NOW).find(x => x.id === 'stock:AAPL').watched, true);
  full.markets.unwatch('stock:AAPL');
  assert.deepEqual(full.m().watchlist, []);
  assert.equal(Object.hasOwn(full.m().asked, 'us:AAPL'), false);
  assert.equal(rowsOf(full.m(), NOW).find(x => x.id === 'stock:AAPL').watched, false);

  // closed while an ask is out: its answer moves nothing
  const out = deferred();
  const gone = rig({ storage: memoryStorage({ [STORAGE_KEY]: saved([asset('us:AAPL')]) }), answer: path => (query(path).q === 'AAPL' ? out.promise : undefined) });
  gone.markets.close();
  out.resolve({ ...all, items: [itemOf(all, 'stock:AAPL')] });
  await settle();
  assert.deepEqual(gone.m().asked, {});
  assert.deepEqual(gone.m().watch, []);
  assert.deepEqual(gone.storage.writes, []);
  for (const x of [r, full]) x.markets.close();
});

test("an old star whose key the Account's store could not take stays on the cn list, said unsaved", async () => {
  const all = fx('explore-all');
  const storage = memoryStorage({ [STORAGE_KEY]: saved([asset('us:AAPL', { name: 'Apple' }), asset('cn:600519')]) }, { failKeys: [ACCOUNT_WATCH_KEY] });
  const r = rig({ storage, answer: path => (query(path).q === 'AAPL' ? { ...all, items: [itemOf(all, 'stock:AAPL')] } : undefined) });
  await settle();
  assert.equal(r.m().asked['us:AAPL'], 'stock:AAPL', 'found');
  assert.equal(r.m().watchError, 'unsaved', "the Account store's failure is said, and no cn write clears it");
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['us:AAPL', 'cn:600519'], 'the star stays where a reload finds it');
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)).items.map(a => a.id), ['us:AAPL', 'cn:600519']);
  assert.deepEqual(storage.writes, [], 'nothing was written');
  r.markets.close();
});

test('a stream quote updates the followed market', async () => {
  const r = rig({
    answer: path => (path === ALL ? fx('explore-all')
      : path.startsWith('/data/account/candles?') ? fx('candles')
        : path.startsWith('/data/account/compare?') ? fx('compare') : undefined),
  });
  r.markets.show(true);
  await settle();
  r.markets.page('coin:ETH');
  await settle();
  assert.deepEqual(r.follows.at(-1), ['ex:ETH/USDT']);
  // the quotes poll's figures first: the stream's own leave the 24h ones as they were
  r.store.dispatch('accountQuotesLoaded', { quotes: [{ venue: 'ex', symbol: 'ETH/USDT', market: { price: 2450, bid: 2449, ask: 2451, changePct24h: 2.1, volumeUsd24h: 1_185_208_857 } }] });
  // a quote event as the stream hands it to the host ({ type, id, data }), dispatched as the wiring does
  const frame = data => ({ type: 'quote', id: undefined, data: { key: 'ex:ETH/USDT', venue: 'ex', symbol: 'ETH/USDT', source: 'okx', at: '2026-10-22T07:59:59.000Z', seenAt: '2026-10-22T07:59:59.100Z', from: 'okx · live', live: true, seq: 7, ...data } });
  r.store.dispatch('streamQuote', frame({ bid: 2455.45, ask: 2455.75, last: 2455.6, priceAt: '2026-10-22T07:59:58.500Z' }));
  assert.deepEqual(r.m().accountQuotes['ex|ETH/USDT'], {
    price: 2455.6, bid: 2455.45, ask: 2455.75, quoteAt: '2026-10-22T07:59:58.500Z', quoteFrom: 'okx · live', changePct24h: 2.1, volumeUsd24h: 1_185_208_857,
  });
  const view = pageOf(r.m(), r.store.get().account, 'coin:ETH', Date.parse('2026-10-22T07:59:59.000Z'));
  assert.equal(view.live.price, 2455.6);
  assert.equal(view.sourceWord, 'okx · live');
  // no last trade: the middle of the bid and ask, stamped when the event was; one side alone is no price
  r.store.dispatch('streamQuote', frame({ bid: 2456, ask: 2457 }));
  assert.equal(r.m().accountQuotes['ex|ETH/USDT'].price, 2456.5);
  assert.equal(r.m().accountQuotes['ex|ETH/USDT'].quoteAt, '2026-10-22T07:59:59.000Z');
  r.store.dispatch('streamQuote', frame({ bid: 2458 }));
  assert.equal(r.m().accountQuotes['ex|ETH/USDT'].price, null);
  assert.equal(r.m().accountQuotes['ex|ETH/USDT'].bid, 2458);
  r.store.dispatch('streamQuote', frame({ last: 2460 }));
  // the hub with no quote yet, or a frame naming no market: the quote as it was
  const kept = r.m().accountQuotes;
  r.store.dispatch('streamQuote', { type: 'quote', data: { key: 'ex:ETH/USDT', venue: 'ex', symbol: 'ETH/USDT', source: 'okx', live: false } });
  r.store.dispatch('streamQuote', { type: 'quote', data: { last: 1, live: true } });
  r.store.dispatch('streamQuote', { type: 'quote', data: null });
  r.store.dispatch('streamQuote', {});
  assert.equal(r.m().accountQuotes, kept);
  assert.equal(pageOf(r.m(), r.store.get().account, 'coin:ETH', NOW).live.price, 2460);
  // another market's quote is its own pair's
  r.store.dispatch('streamQuote', { type: 'quote', data: { key: 'ex:BTC/USDT', venue: 'ex', symbol: 'BTC/USDT', last: 63_210, at: '2026-10-22T07:59:59.000Z', from: 'okx · live', live: true } });
  assert.equal(r.m().accountQuotes['ex|BTC/USDT'].price, 63_210);
  assert.equal(r.m().accountQuotes['ex|BTC/USDT'].changePct24h, null);
  assert.equal(r.m().accountQuotes['ex|ETH/USDT'].price, 2460);
  r.markets.close();
});
