// The Markets host layer (spec 2026-10-22 §6.1): the Account's reads through the face's proxy — explore for the tab on screen,
// the quotes of the rows in view, a market page's candles and compare rows, the page's market followed on the Account's stream —
// the two watch stores, the old us:/crypto: stars asked of the Account once, and the A shares — China's ranking, their quotes,
// history and search — from the Account too, never the face's own wire; over the stand-in's answers (tests/fixtures/account/),
// with recording timers, a recording getJson, a fake stream and a memory storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startMarkets, EXPLORE_MS, QUOTES_MS, QUOTE_PAIRS, WATCH_LIMIT, RANK_ROWS, BOOK_DEPTH, TRADES_LIMIT, FUNDING_LIMIT } from '../../client/js/host/markets.js';
import { rowsOf, pageOf, cnStateWord } from '../../client/js/host/market-view.js';
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

const ALL = '/data/market/explore?limit=200';
const PREDICTIONS = '/data/market/explore?tab=predictions&limit=200';
const CONNECTED_ALL = '/data/account/connected/explore?limit=200';
const IDLE = { status: 'idle', data: null, at: null };
// a market page's four reads beside its price (plan 4a Task 4)
const DEPTH_READ = /^\/data\/(account\/(asset|funding|connected\/book|connected\/trades)|market\/(book|trades))\?/;

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

// the account's connected explore where a test gives none: it lists nothing, so the join is the market's rows
const NO_CONNECTED = () => ({ ok: true, asOf: '2026-10-22T08:00:00.000Z', items: [], movers: [], closing: [], mostTraded: [], tabs: [], missing: [], notes: [] });
const isTwin = path => path.startsWith('/data/account/connected/explore?') || path === '/data/account/venues';

// `reads` are the reads but each explore's connected twin and the venues read (`allReads` has them: the tests of the two
// halves read those); the connected explore a test does not answer lists nothing
function rig({ storage = memoryStorage(), answer = () => undefined, owner, afterAction } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const allReads = [];
  const getJson = path => {
    allReads.push(path);
    if (!isTwin(path)) reads.push(path);
    let a = answer(path);
    if (a === undefined && path.startsWith('/data/account/connected/explore?')) a = NO_CONNECTED();
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
  const marketFollows = [];
  const marketStream = { follow(keys) { marketFollows.push([...keys]); } };
  const listeners = {};
  const win = {
    addEventListener(type, fn) { (listeners[type] ??= new Set()).add(fn); },
    removeEventListener(type, fn) { listeners[type]?.delete(fn); },
  };
  const markets = startMarkets({ store, getJson, storage, win, stream, marketStream, schedule, cancelTimer, now: () => NOW, owner, afterAction });
  const emit = (type, event) => { for (const fn of listeners[type] ?? []) fn(event); };
  return { store, markets, reads, allReads, storage, timers, due, fire, follows, marketFollows, listeners, emit, m: () => store.get().markets };
}

test('show reads explore now and every 20 s; quotes for the pairs in view every 5 s, twelve a call; show(false) cancels', async () => {
  assert.deepEqual(emptyState().markets, {
    tab: 'all', sort: 'volume', q: '',
    explore: {}, results: IDLE, accountQuotes: {}, candles: {}, compare: {}, watch: [], watchError: null, asked: {},
    watchlist: [], quotes: {}, providers: [], connection: 'idle', hitQuotes: {},
    rank: { status: 'idle', data: null, at: null, sort: 'volume', message: null }, depth: {},
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
      if (path.startsWith('/data/market/explore?tab=')) return { ok: true, items: [] };
      if (path.startsWith('/data/market/quotes?')) return held ? held.promise : quoted(pairsIn(path), refuse);
      return undefined;
    },
  });
  assert.deepEqual(r.reads, [], 'nothing is read until Markets is on screen');
  assert.deepEqual(r.due(), []);

  r.markets.show(true);
  assert.deepEqual(r.reads, [ALL], 'explore at once');
  assert.equal(r.m().explore.all.status, 'loading');
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
  assert.match(r.reads.at(-1), /^\/data\/market\/quotes\?pairs=/);
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
  // a tab changed while shown reads its own at once, and its poll starts over from the change; All's rows are kept, and its
  // read in the air when the tab changed lands nowhere
  const allRows = r.m().explore.all.data.items.map(i => i.key);
  r.store.dispatch('setMarketsTab', 'predictions');
  assert.equal(r.reads.at(-1), PREDICTIONS, "a kind's tab reads its own");
  assert.equal(r.due(EXPLORE_MS).length, 1, 'one explore poll');
  await settle();
  assert.equal(r.m().explore.predictions.status, 'ready');
  assert.equal(r.m().explore.all.status, 'loading', "All's read left lands nowhere");
  assert.deepEqual(r.m().explore.all.data.items.map(i => i.key), allRows);
  assert.deepEqual(allRows, all.items.map(i => i.key), "the join over a connected half listing nothing is the market's rows");
  r.fire(EXPLORE_MS);
  assert.equal(r.reads.at(-1), PREDICTIONS, 'the poll reads the tab on screen');
  await settle();
  r.store.dispatch('setMarketsTab', 'watching');
  assert.equal(r.reads.at(-1), ALL, "Watching reads All's");

  r.markets.show(false);
  assert.deepEqual(r.due(), [], 'both polls cancelled');
  assert.equal(r.timers.filter(t => t.cancelled).length >= 2, true);
  const hidden = r.reads.length;
  r.store.dispatch('setMarketsTab', 'crypto');
  assert.equal(r.reads.length, hidden, 'a tab changed while hidden reads nothing');
  r.markets.show(true);
  assert.equal(r.reads.at(-1), '/data/market/explore?tab=crypto&limit=200', 'shown again: the tab on screen at once');
  r.markets.close();
  assert.deepEqual(r.due(), [], 'close leaves no timer');
  assert.deepEqual(r.follows.at(-1), [], 'close lets every follow go');
  r.markets.show(true);
  assert.deepEqual(r.due(), [], 'closed: nothing starts again');
});

test('an explore refusal of both halves keeps the last rows and the market message', async () => {
  const busy = 'The Account is reading its venues; try again in a moment.';
  let later = null;
  const answers = [
    fx('explore-all'),
    refused(409, { ok: false, refusal: { code: 'E_ACCOUNT_BUSY', message: busy } }),
    { ok: true, rows: [] },
    new Error('/data/market/explore: HTTP 503'),
    { ok: false, error: 'explore is not ready' },
    fx('explore-all'),
  ];
  // the connected half fails beside each of the market's failures: only both failed is a failed read
  const twins = [NO_CONNECTED(), new Error('HTTP 503'), new Error('HTTP 503'), new Error('HTTP 503'), new Error('HTTP 503'), NO_CONNECTED()];
  const r = rig({
    answer: path => (path === ALL ? (later ? later.promise : answers.shift())
      : path === CONNECTED_ALL ? (later ? new Error('HTTP 503') : twins.shift()) : undefined),
  });
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

  // one flight: a tick while the read is out joins it, and its answer lands once; a tab left drops its read, so All's back on
  // screen is asked again
  later = deferred();
  r.fire(EXPLORE_MS);
  const out = r.reads.length;
  r.fire(EXPLORE_MS);
  assert.equal(r.reads.length, out, 'a tick while the read is out joins it');
  r.store.dispatch('setMarketsTab', 'stocks');
  r.store.dispatch('setMarketsTab', 'all');
  assert.equal(r.reads.length, out + 2, "the tab's own read went; All's, dropped on leaving, is asked again");
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

test('search reads explore?q alone; results land in results', async () => {
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
  assert.equal(r.reads.at(-1), '/data/market/explore?q=eth&limit=200');
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
  // a refusal keeps the last results with the Account's sentence; the text is trimmed and encoded
  r.markets.search('none');
  await settle();
  assert.equal(r.m().results.status, 'error');
  assert.equal(r.m().results.message, 'Search is busy.');
  assert.deepEqual(rowsOf(r.m(), NOW).map(x => x.id).slice(0, 2), ['perp:SOL', 'coin:SOL']);
  r.markets.search(' S&P 500 ');
  assert.equal(r.reads.at(-1), '/data/market/explore?q=S%26P%20500&limit=200');

  // a blank query: back to All, the results idle, and a read still out dropped
  r.markets.search('late');
  r.markets.search('');
  assert.equal(r.m().q, '');
  assert.equal(r.m().tab, 'all', 'cleared on All results: back to All');
  assert.deepEqual(r.m().results, IDLE);
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

test('watch: an Account key goes to the account store, an A share among them', async () => {
  const storage = memoryStorage({ [STORAGE_KEY]: saved([asset('us:MSFT')]) });
  const r = rig({ storage, answer: () => ({ ok: true, items: [] }) });
  await settle();
  assert.equal(r.m().asked['us:MSFT'], null, 'the old star was asked and missed');

  r.markets.watch('coin:BTC');
  assert.deepEqual(r.m().watch, ['coin:BTC']);
  assert.equal(r.m().watchError, null);
  assert.deepEqual(JSON.parse(storage.map.get(ACCOUNT_WATCH_KEY)), { version: 1, items: ['coin:BTC'] });
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['us:MSFT'], 'the cn list as it was');
  r.markets.watch('coin:BTC');
  r.markets.watch('event:predict:SI-FEDCUT-DEC');
  assert.deepEqual(r.m().watch, ['coin:BTC', 'event:predict:SI-FEDCUT-DEC'], 'once each');
  // an A share is an Account key: the Account store, never the cn list; cn:sh600519 is the same share
  r.markets.watch('cn:600519');
  r.markets.watch('cn:sh600519');
  assert.deepEqual(r.m().watch, ['coin:BTC', 'event:predict:SI-FEDCUT-DEC', 'cn:600519']);
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['us:MSFT']);
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)).items.map(a => a.id), ['us:MSFT']);
  const writes = storage.writes.length;
  for (const id of ['us:AAPL', 'crypto:ETH/USD', 'cn:60051x', 'cn:', 'garbage', '', null]) r.markets.watch(id);
  assert.equal(storage.writes.length, writes, 'a us:, crypto:, malformed cn or unknown id is nobody’s to star');
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['us:MSFT']);
  assert.deepEqual(r.m().watch, ['coin:BTC', 'event:predict:SI-FEDCUT-DEC', 'cn:600519']);

  r.markets.unwatch('coin:BTC');
  assert.deepEqual(r.m().watch, ['event:predict:SI-FEDCUT-DEC', 'cn:600519']);
  r.markets.unwatch('cn:600519');
  assert.deepEqual(r.m().watch, ['event:predict:SI-FEDCUT-DEC']);
  assert.deepEqual(JSON.parse(storage.map.get(ACCOUNT_WATCH_KEY)).items, ['event:predict:SI-FEDCUT-DEC']);
  // an old star still listed is taken off the cn list, and what it was found as is forgotten
  r.markets.unwatch('us:MSFT');
  assert.deepEqual(r.m().watchlist.map(a => a.id), []);
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
  const junk = memoryStorage({ [ACCOUNT_WATCH_KEY]: saved(['coin:BTC', 'coin:BTC', 'us:AAPL', 42, 'cn:600519', 'cn:60051x', ...hundred, 'stock:LAST']) });
  const read = readAccountWatch(junk);
  assert.deepEqual(read.items, ['coin:BTC', 'cn:600519', ...hundred.slice(0, WATCH_LIMIT - 2)]);
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
      if (path.startsWith('/data/account/connected/candles?') && q.range === '1Y') return refused(409, { ok: false, refusal: { message: 'No history at this range.' } });
      if (path.startsWith('/data/account/connected/candles?') && q.range === '6M') return moved.promise;
      if (path.startsWith('/data/account/connected/candles?')) return q.range === '1M' ? late.promise : { ...fx('candles'), venue: q.venue, symbol: q.symbol, range: q.range };
      if (path.startsWith('/data/account/compare?')) return { ...fx('compare'), base: q.base };
      return undefined;
    },
  });
  // the reads this test is about: the page's four beside its price are the next test's
  const older = () => r.reads.filter(p => !DEPTH_READ.test(p));
  // a deep link: All's read has not answered, so the page's reads wait for the read that lists its market
  r.markets.page('coin:ETH');
  assert.deepEqual(older(), []);
  assert.deepEqual(r.follows, []);
  r.markets.show(true);
  await settle();
  assert.deepEqual(older(), [ALL, '/data/account/connected/candles?venue=ex&symbol=ETH%2FUSDT&range=1D', '/data/account/compare?base=ETH&side=buy']);
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
  assert.equal(older().filter(p => p.startsWith('/data/account/connected/candles')).length, 1, "the page's reads ran once");

  // a range re-reads the candles for it, and the page keeps it; a range the Account does not draw is nothing
  r.markets.range('coin:ETH', '5D');
  assert.equal(r.m().candles['coin:ETH'].range, '5D');
  assert.equal(r.m().candles['coin:ETH'].status, 'loading');
  assert.equal(r.m().candles['coin:ETH'].data.range, '1D', 'the last candles stay while the next are read');
  assert.equal(older().at(-1), '/data/account/connected/candles?venue=ex&symbol=ETH%2FUSDT&range=5D');
  await settle();
  assert.equal(r.m().candles['coin:ETH'].data.range, '5D');
  const n = older().length;
  r.markets.range('coin:ETH', '2D');
  r.markets.range('coin:ETH', '1d');
  assert.equal(older().length, n);
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
  assert.deepEqual(older().slice(-2), ['/data/account/connected/candles?venue=broker&symbol=NVDA&range=1D', '/data/account/compare?base=NVDA&side=buy']);
  assert.deepEqual(r.follows.at(-1), ['broker:NVDA']);
  r.markets.page('perp:ETH');
  assert.deepEqual(older().slice(-2), ['/data/account/connected/candles?venue=ex&symbol=ETH%2FUSDT%3AUSDT&range=1D', '/data/account/compare?base=ETH&side=buy'], 'a perpetual is compared');
  assert.deepEqual(r.follows.at(-1), ['ex:ETH/USDT:USDT']);
  await settle();
  const rwa = older().length;
  r.markets.page('rwa:NVDA');
  assert.deepEqual(older().slice(rwa), ['/data/market/candles?venue=standin-stock-tokens&symbol=NVDA&range=1D'], "a mover is listed too; an RWA is not compared; a public line's history is the market's");
  assert.deepEqual(r.marketFollows.at(-1), ['standin-stock-tokens:NVDA'], "no connected line: its first public listing, on the market's stream");
  assert.deepEqual(r.follows.at(-1), [], "and the Account's stream follows nothing");
  r.store.dispatch('setMarketsTab', 'predictions');
  await settle();
  const before = older().length;
  r.markets.page('event:predict:SI-FEDCUT-DEC');
  assert.deepEqual(older().slice(before), ['/data/account/connected/candles?venue=predict&symbol=SI-FEDCUT-DEC%3AYES&range=1D'], 'an event is not compared');
  assert.deepEqual(r.follows.at(-1), ['predict:SI-FEDCUT-DEC:YES']);
  await settle();
  const quiet = older().length;
  r.markets.page('cn:600519');
  assert.deepEqual(older().slice(quiet), ['/data/market/candles?venue=china&symbol=600519&range=1D', '/data/market/quotes?pairs=china%7C600519'], "a cn page reads its history at the market's china venue, and its price at once");
  assert.deepEqual(r.follows.at(-1), [], 'and follows nothing on the stream');
  assert.deepEqual(r.marketFollows.at(-1), [], 'nor on the market\'s');
  // back to a page: its kept range
  r.store.dispatch('setMarketsTab', 'all');
  r.markets.page('coin:ETH');
  assert.equal(older().filter(p => p.startsWith('/data/account/connected/candles?')).at(-1), '/data/account/connected/candles?venue=ex&symbol=ETH%2FUSDT&range=3M');
  assert.deepEqual(r.follows.at(-1), ['ex:ETH/USDT']);
  await settle();
  // a failed read keeps the last candles, under the range asked
  r.markets.range('coin:ETH', '1Y');
  await settle();
  assert.equal(r.m().candles['coin:ETH'].status, 'error');
  assert.equal(r.m().candles['coin:ETH'].range, '1Y');
  assert.equal(r.m().candles['coin:ETH'].data.range, '3M');
  assert.equal(r.m().candles['coin:ETH'].at, NOW);
  assert.equal(r.m().candles['coin:ETH'].message, 'No history at this range.', "the Account's sentence kept with it");
  // the next answer clears it
  r.markets.range('coin:ETH', '3M');
  await settle();
  assert.deepEqual([r.m().candles['coin:ETH'].status, r.m().candles['coin:ETH'].message], ['ready', null]);
  // a page whose market no read lists: nothing is read, and the page it left lets its follow go
  const unlisted = older().length;
  r.markets.page('coin:NOPE');
  assert.equal(older().length, unlisted);
  assert.deepEqual(r.follows.at(-1), []);
  r.markets.close();
  const closedReads = older().length;
  r.markets.page('stock:SPY');
  r.markets.range('coin:ETH', '1Y');
  assert.equal(older().length, closedReads, 'closed: nothing is read');
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
  assert.deepEqual(r.reads, ['/data/market/explore?q=AAPL&limit=12'], 'one ask at a time; a cn star asks nothing');
  assert.deepEqual(r.m().asked, {});
  aapl.resolve({ ...all, items: [{ ...itemOf(all, 'stock:AAPL'), base: 'aapl' }] });
  await settle();
  assert.deepEqual(r.reads, ['AAPL', 'BTC', 'ZZZZ', 'DOGE', 'KO'].map(q => `/data/market/explore?q=${q}&limit=12`));
  // the star taken off while its ask is out: the answer moves nothing
  r.markets.unwatch('us:KO');
  ko.resolve({ ok: true, items: [{ key: 'stock:KO', kind: 'stock', base: 'KO', name: 'Coca-Cola', at: [] }] });
  await settle();

  assert.deepEqual(r.m().asked, { 'us:AAPL': 'stock:AAPL', 'crypto:BTC/USD': 'coin:BTC', 'us:ZZZZ': null });
  assert.equal(Object.hasOwn(r.m().asked, 'crypto:DOGE/USD'), false, 'a failed read leaves it for the next boot');
  // the cn star moved at load, before any ask; a hit moves an old star to the Account key after it
  assert.deepEqual(r.m().watch, ['cn:600519', 'stock:AAPL', 'coin:BTC'], 'a hit moves the star to the Account key');
  assert.deepEqual(JSON.parse(storage.map.get(ACCOUNT_WATCH_KEY)).items, ['cn:600519', 'stock:AAPL', 'coin:BTC']);
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['us:ZZZZ', 'crypto:DOGE/USD']);
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)).items.map(a => a.id), ['us:ZZZZ', 'crypto:DOGE/USD']);

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
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['crypto:DOGE/USD']);
  assert.deepEqual(r.m().watch, ['cn:600519', 'stock:AAPL', 'coin:BTC', 'cn:600000'], 'a new A-share star is an Account key');
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

test('an old us star is asked of the Account, never quoted as an A share', async () => {
  const all = fx('explore-all');
  const storage = memoryStorage({ [STORAGE_KEY]: saved([asset('us:AAPL', { name: 'Apple' }), asset('cn:600519', { name: 'Kweichow Moutai' })]) });
  const r = rig({
    storage,
    answer: path => {
      if (query(path).q === 'AAPL') return { ok: true, items: [] };
      if (path === ALL) return all;
      if (path.startsWith('/data/market/quotes?')) return { ok: true, quotes: [] };
      return undefined;
    },
  });
  // its own page on screen, Markets shown: the old star is still never the face's to quote
  r.store.dispatch('nav', { screen: 'markets', id: 'us:aapl' });
  r.markets.page('us:AAPL');
  r.markets.show(true);
  await settle();
  assert.deepEqual(r.reads.filter(p => query(p).limit === '12'), ['/data/market/explore?q=AAPL&limit=12'], 'asked of the Account once');
  assert.equal(r.m().asked['us:AAPL'], null, 'not listed there');
  r.fire(QUOTES_MS);
  const cnQuotes = r.reads.filter(p => p.startsWith('/data/market/quotes?') && pairsIn(p).some(x => x.startsWith('china|')));
  assert.deepEqual(cnQuotes.map(pairsIn), [['china|600519']], 'the A share alone is quoted at china');
  assert.ok(r.reads.every(p => !faceWire(p) && !decodeURIComponent(p).includes('us:')), 'the old star is never asked for as itself');
  assert.deepEqual(rowsOf(r.m(), NOW).filter(x => x.notListed).map(x => [x.id, x.sub]), [['us:AAPL', 'Not listed at the Account']]);
  r.markets.close();
});

test('a stream quote updates the followed market', async () => {
  const r = rig({
    answer: path => (path === ALL ? fx('explore-all')
      : path.startsWith('/data/account/connected/candles?') ? fx('candles')
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
    streamed: true,
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

// a market's page draws no table rows and names its own key (app.js's rowsInView); the market need not be a row of the tab on
// screen, and the quotes poll asks for its pair all the same, from the page's own view (spec §6.1)
test('a page whose market is not a row of the tab still polls its pair', async () => {
  const all = fx('explore-all');
  const STOCKS = '/data/market/explore?tab=stocks&limit=200';
  const r = rig({
    answer: path => {
      if (path === ALL) return all;
      if (path === STOCKS) return { ...fx('explore-all'), items: fx('explore-all').items.filter(i => i.kind === 'stock') };
      if (path.startsWith('/data/market/quotes?')) return quoted(pairsIn(path));
      return undefined;
    },
  });
  r.markets.show(true);
  await settle();
  // a deep link to a market only the movers list carries (AVAX): no row of All, its page's own most traded connected line asked
  assert.equal(rowsOf(r.m(), NOW).some(row => row.id === 'coin:AVAX'), false, 'no row of All');
  r.markets.rowsInView(['coin:AVAX']);
  r.fire(QUOTES_MS);
  assert.deepEqual(pairsIn(r.reads.at(-1)), ['paper-momentum|AVAX/USD']);
  await settle();
  assert.equal(pageOf(r.m(), r.store.get().account, 'coin:AVAX', NOW).live.price, 182.4, 'the page prices from its answer');
  // Back onto Stocks with a coin's page on screen: the coin is no row of that tab, and its pair is asked all the same
  r.store.dispatch('setMarketsTab', 'stocks');
  await settle();
  assert.equal(r.reads.includes(STOCKS), true);
  assert.equal(rowsOf(r.m(), NOW).some(row => row.id === 'coin:BTC'), false, 'no row of Stocks');
  r.markets.rowsInView(['coin:BTC']);
  r.fire(QUOTES_MS);
  assert.deepEqual(pairsIn(r.reads.at(-1)), ['ex|BTC/USDT']);
  await settle();
  // a key no read lists has no page and no pair: nothing is asked
  const asked = r.reads.length;
  r.markets.rowsInView(['coin:NOPE']);
  r.fire(QUOTES_MS);
  assert.equal(r.reads.length, asked);
  r.markets.close();
});

// the owner device as the Markets host meets it: every draft recorded, each answered by `reply` (a taken account answer by default)
function fakeOwner(reply = () => ({ status: 200, body: { ok: true, kind: 'account', summary: 'Watching updated' } })) {
  const acts = [];
  return { acts, act(draft) { acts.push(draft); return Promise.resolve(reply(draft)); } };
}
const TAKEN = { status: 200, body: { ok: true, kind: 'account', summary: 'Watching updated' } };

test('a star on a signing page acts setWatch for the followed line; un-starring signs the page’s entry off; the face’s list as before otherwise', async () => {
  const owner = fakeOwner();
  const after = [];
  const storage = memoryStorage({ [ACCOUNT_WATCH_KEY]: saved(['coin:BTC', 'stock:AAPL']) });
  const r = rig({ storage, owner, afterAction: (kind, body) => after.push([kind, body]), answer: path => (path === ALL ? fx('explore-all') : undefined) });
  r.markets.show(true);
  await settle();
  const page = fx('account');
  r.store.dispatch('accountLoaded', { data: page, at: NOW });
  r.store.dispatch('ownerStanding', { role: 'signs', kid: 'a5048199a8081854' });
  const writes = storage.writes.length;

  // on: the row's followed line, exactly the four fields; the face's list untouched; the reads told
  r.markets.watch('coin:ETH');
  assert.deepEqual(owner.acts, [{ type: 'setWatch', venue: 'ex', symbol: 'ETH/USDT', on: 'true' }]);
  await settle();
  assert.deepEqual(after, [['setWatch', TAKEN.body]]);
  assert.deepEqual(r.m().watch, ['coin:BTC', 'stock:AAPL']);
  assert.equal(storage.writes.length, writes, 'nothing stored in this browser');
  assert.equal(r.m().watchError, null);
  // the page read again lists it: the row reads watched, at the Account alone
  r.store.dispatch('accountLoaded', { data: { ...page, watch: [...page.watch, { venue: 'ex', symbol: 'ETH/USDT', at: '2026-10-22T08:00:00.000Z' }] }, at: NOW });
  const eth = rowsOf(r.m(), NOW, r.store.get().account.data).find(x => x.id === 'coin:ETH');
  assert.deepEqual([eth.watched, eth.atAccount], [true, true]);
  // starred already, at either list: nothing signed
  r.markets.watch('coin:ETH');
  r.markets.watch('coin:BTC');
  assert.equal(owner.acts.length, 1);

  // off, on the Account's list alone: its own entry, as the page keeps it
  r.markets.unwatch('coin:DOGE');
  assert.deepEqual(owner.acts.at(-1), { type: 'setWatch', venue: 'standin-pubex', symbol: 'DOGE/USD', on: '' });
  await settle();
  assert.deepEqual(after.at(-1), ['setWatch', TAKEN.body]);
  assert.deepEqual(r.m().watch, ['coin:BTC', 'stock:AAPL']);
  // on both: signed off and taken off the face's list
  r.markets.unwatch('coin:BTC');
  assert.deepEqual(owner.acts.at(-1), { type: 'setWatch', venue: 'ex', symbol: 'BTC/USDT', on: '' });
  assert.deepEqual(r.m().watch, ['stock:AAPL']);
  await settle();
  // on the face's list alone: nothing signed
  const acts = owner.acts.length;
  r.markets.unwatch('stock:AAPL');
  assert.equal(owner.acts.length, acts);
  assert.deepEqual(r.m().watch, []);

  // a page that does not sign: the face's list, one click, no signature
  r.store.dispatch('ownerStanding', { role: 'pending', kid: '' });
  r.markets.watch('coin:SOL');
  assert.equal(owner.acts.length, acts);
  assert.deepEqual(r.m().watch, ['coin:SOL']);
  r.markets.unwatch('coin:DOGE');
  assert.equal(owner.acts.length, acts, 'the Account’s list is the page’s to sign');
  r.markets.close();

  // no owner given: the face's list as before
  const plain = rig({ answer: path => (path === ALL ? fx('explore-all') : undefined) });
  plain.store.dispatch('ownerStanding', { role: 'signs', kid: 'a5048199a8081854' });
  plain.markets.watch('coin:ETH');
  assert.deepEqual(plain.m().watch, ['coin:ETH']);
  plain.markets.close();
});

test("a refused setWatch is the Account's sentence in the watchlist's words; the lists stay; one signature at a time per market", async () => {
  const sentence = 'ETH/USDT is not listed at Stand-in Exchange.';
  let reply = () => ({ status: 409, body: { ok: false, refusal: { code: 'E_ACCOUNT_BAD_ACTION', message: sentence } } });
  const owner = fakeOwner(draft => reply(draft));
  const after = [];
  const r = rig({ owner, afterAction: (kind, body) => after.push([kind, body]), answer: path => (path === ALL ? fx('explore-all') : undefined) });
  r.markets.show(true);
  await settle();
  const page = fx('account');
  r.store.dispatch('accountLoaded', { data: page, at: NOW });
  r.store.dispatch('ownerStanding', { role: 'signs', kid: 'a5048199a8081854' });
  r.markets.watch('coin:ETH');
  await settle();
  assert.equal(r.m().watchError, sentence);
  assert.deepEqual(r.m().watch, []);
  assert.deepEqual(r.store.get().account.data.watch, page.watch, 'the page as it was');
  assert.deepEqual(after, [], 'nothing to read again');
  // a thrown act is a refusal too, in the screen's word for one without a sentence
  reply = () => { throw new Error('boom'); };
  r.markets.unwatch('coin:BTC');
  await settle();
  assert.equal(r.m().watchError, 'Refused');
  // taken: the sentence clears
  reply = () => TAKEN;
  r.markets.watch('coin:ETH');
  await settle();
  assert.equal(r.m().watchError, null);
  // one in the air per market: a second press waits for the first
  const held = deferred();
  reply = () => held.promise;
  const before = owner.acts.length;
  r.markets.watch('coin:SOL');
  r.markets.watch('coin:SOL');
  assert.equal(owner.acts.length, before + 1);
  held.resolve(TAKEN);
  await settle();
  assert.deepEqual(after.at(-1), ['setWatch', TAKEN.body]);
  r.markets.close();
});

// ── China (spec 2026-10-31, plan 2026-11-01): the ranking, an A share's history, its quotes and its search, all the Account's ──

const CHINA = sort => `/data/market/explore?tab=china&sort=${sort}&limit=20`;
// the Account's china tab answer for a sort: the stand-in's, read for that sort
const ranked = sort => { const body = fx('explore-china'); body.china.sort = sort; return body; };
const isChina = path => path.startsWith('/data/market/explore?tab=china&');
const chinaAnswer = path => (isChina(path) ? ranked(query(path).sort) : undefined);
// the face's own wire, which nothing reads any more
const faceWire = path => /^\/data\/(quotes|symbols|cn)\b/.test(path);
// a quotes?pairs= answer of china rows from the stand-in's, each pair asked for its own row (refused where named, or not listed)
const cnQuoted = (path, refuse = []) => {
  const rows = fx('quotes-china').quotes;
  return {
    ok: true,
    quotes: pairsIn(path).map(p => {
      const symbol = p.slice(p.indexOf('|') + 1);
      const row = rows.find(q => q.symbol === symbol && q.market);
      if (refuse.includes(symbol) || !row) return { venue: 'china', symbol, refusal: { ok: false, code: 'E_ACCOUNT_BAD_ACTION', message: `no A-share quote for ${symbol}` } };
      return row;
    }),
  };
};

test('China reads the Account: explore tab=china now, every 20 s, and again on a new sort', async () => {
  const r = rig({ answer: chinaAnswer });
  r.store.dispatch('setMarketsTab', 'china');
  assert.equal(RANK_ROWS, 20);
  r.markets.show(true);
  assert.deepEqual(r.reads, [CHINA('volume')], 'at once, nothing else');
  assert.equal(r.m().rank.status, 'loading');
  await settle();
  assert.equal(r.m().rank.status, 'ready');
  assert.deepEqual(r.m().rank.data.items.map(i => [i.id, i.name]), [['cn:600519', '贵州茅台'], ['cn:688981', '中芯国际'], ['cn:300750', '宁德时代']]);
  assert.equal(r.m().rank.data.total, 5577);
  assert.deepEqual(r.m().providers, [{ id: 'tencent', market: 'cn', status: 'connected', said: 'Tencent · answering' }], "China's state, the Account's");
  assert.deepEqual(rowsOf(r.m(), NOW).map(x => x.id), ['cn:600519', 'cn:688981', 'cn:300750']);
  r.fire(EXPLORE_MS);
  assert.equal(r.reads.at(-1), CHINA('volume'), 'every 20 s');
  await settle();
  r.store.dispatch('setMarketsSort', 'movers');
  assert.equal(r.reads.at(-1), CHINA('movers'), 'again on a new sort');
  await settle();
  assert.equal(r.m().rank.data.sort, 'movers');
  assert.ok(r.reads.every(p => !faceWire(p)), 'nothing reads the face wire');
  r.markets.close();
});

test('a sort chosen on China reads that sort; the answer for the old sort lands nowhere; a refusal is said in its words', async () => {
  const slow = deferred();
  let refuse = false;
  const r = rig({ answer: path => (refuse && isChina(path) ? refused(409, { ok: false, refusal: { message: 'China is not read on this account' } })
    : path === CHINA('volume') ? slow.promise : chinaAnswer(path)) });
  r.store.dispatch('setMarketsTab', 'china');
  r.markets.show(true);
  r.store.dispatch('setMarketsSort', 'movers');
  await settle();
  assert.ok(r.reads.includes(CHINA('movers')));
  slow.resolve(ranked('volume'));
  await settle();
  assert.equal(r.m().rank.sort, 'movers');
  assert.equal(r.m().rank.data.sort, 'movers');
  // an answer for another sort than the one asked is no ranking
  const wrong = rig({ answer: path => (isChina(path) ? ranked('movers') : undefined) });
  wrong.store.dispatch('setMarketsTab', 'china');
  wrong.markets.show(true);
  await settle();
  assert.equal(wrong.m().rank.status, 'error');
  assert.equal(wrong.m().rank.data, null);
  // the Account refusing: the rows kept, its sentence as the read's
  refuse = true;
  r.fire(EXPLORE_MS);
  await settle();
  assert.equal(r.m().rank.status, 'error');
  assert.equal(r.m().rank.message, 'China is not read on this account');
  assert.equal(r.m().rank.data.items.length, 3, 'the rows kept');
  for (const x of [r, wrong]) x.markets.close();
});

test('the Account down while China is on screen: the kept ranking re-served stale lands marked stale, never bare', async () => {
  let stale = false;
  const r = rig({ answer: path => (isChina(path) ? { ...ranked(query(path).sort), ...(stale ? { stale: true } : {}) } : undefined) });
  r.store.dispatch('setMarketsTab', 'china');
  r.markets.show(true);
  await settle();
  assert.equal(r.m().rank.data.stale, false);
  stale = true;
  r.fire(EXPLORE_MS);
  await settle();
  assert.equal(r.m().rank.status, 'ready');
  assert.equal(r.m().rank.data.stale, true, 'the proxy said it is the last read');
  // the Venues line: never the Account's last live sentence while it is not answering (plan-1 final review #3)
  assert.deepEqual(r.m().providers, [{ id: 'tencent', market: 'cn', status: 'error', said: 'The market is not answering · China as last read' }]);
  stale = false;
  r.fire(EXPLORE_MS);
  await settle();
  assert.equal(r.m().providers[0].status, 'connected', 'the Account back: its own state again');
  r.markets.close();
});

test('off screen, or on another tab, nothing reads the ranking', async () => {
  const r = rig({ answer: chinaAnswer });
  r.store.dispatch('setMarketsTab', 'china');
  await settle();
  assert.equal(r.reads.some(isChina), false, 'not shown');
  r.store.dispatch('setMarketsTab', 'crypto');
  r.markets.show(true);
  r.fire(EXPLORE_MS);
  await settle();
  assert.equal(r.reads.some(isChina), false, 'another tab');
  r.markets.close();
});

test('an A share page reached cold reads its candles at venue china', async () => {
  const r = rig({ answer: path => (path.startsWith('/data/market/candles?') ? (query(path).range === '1D' ? fx('candles-china-1d') : { ...fx('candles-china-1m'), range: query(path).range }) : undefined) });
  assert.deepEqual(r.m().rank.data, null, 'nothing read: no ranking, no search, no star');
  r.markets.page('cn:600519');
  // its price at once, not on the 5 s tick (plan-1 final review #2)
  assert.deepEqual(r.reads, ['/data/market/candles?venue=china&symbol=600519&range=1D', '/data/market/quotes?pairs=china%7C600519']);
  await settle();
  assert.equal(r.m().candles['cn:600519'].status, 'ready');
  assert.equal(r.m().candles['cn:600519'].data.sessions.length, 1, "the 1D answer's sessions kept as they are");
  r.markets.range('cn:600519', '5D');
  assert.equal(r.reads.at(-1), '/data/market/candles?venue=china&symbol=600519&range=5D');
  await settle();
  assert.equal(r.m().candles['cn:600519'].range, '5D');
  r.markets.range('cn:600519', '1M');
  await settle();
  assert.equal(r.m().candles['cn:600519'].data.candles.length, 2);
  assert.deepEqual(r.follows, [], 'an A share follows nothing on the stream');
  assert.ok(r.reads.every(p => !faceWire(p)), 'nothing reads the face wire');
  r.markets.close();
});

test('A-share quotes: the page first, then the cn rows in view, twelve a call, every 5 s', async () => {
  const many = Array.from({ length: 14 }, (_, i) => asset(`cn:6000${String(10 + i)}`));
  const storage = memoryStorage({ [STORAGE_KEY]: saved([asset('cn:600519', { name: 'Kweichow Moutai' }), asset('cn:600000')]) });
  const r = rig({ storage, answer: path => (path.startsWith('/data/market/quotes?') ? cnQuoted(path) : path === ALL ? { ok: true, items: [] } : undefined) });
  r.store.dispatch('nav', { screen: 'markets', id: 'cn:600000' });
  r.markets.show(true);
  await settle();
  assert.equal(r.reads.some(p => p.startsWith('/data/market/quotes?')), false, 'on the 5 s tick, not before');
  r.fire(QUOTES_MS);
  const asked = r.reads.filter(p => p.startsWith('/data/market/quotes?'));
  assert.deepEqual(asked, ['/data/market/quotes?pairs=china%7C600000%2Cchina%7C600519'], 'the page first, then the cn rows, once each');
  await settle();
  const moutai = r.m().quotes['cn:600519'];
  assert.equal(moutai.price, 1392.05);
  assert.equal(moutai.quote_status, 'live');
  assert.equal(moutai.market_status, 'closed');
  assert.equal(r.m().connection, 'polling');
  // the rows in view alone, as the screen names them; twelve a call
  r.store.dispatch('nav', { screen: 'markets', id: null });
  r.markets.rowsInView(['cn:600519']);
  r.fire(QUOTES_MS);
  assert.deepEqual(pairsIn(r.reads.at(-1)), ['china|600519']);
  await settle();
  r.store.dispatch('watchlistLoaded', { items: many, error: null });
  r.markets.rowsInView(null);
  r.fire(QUOTES_MS);
  assert.equal(pairsIn(r.reads.at(-1)).length, QUOTE_PAIRS);
  await settle();
  // one in the air at a time
  const held = deferred();
  const slow = rig({ storage, answer: path => (path.startsWith('/data/market/quotes?') ? held.promise : undefined) });
  slow.markets.show(true);
  slow.fire(QUOTES_MS);
  const n = slow.reads.length;
  slow.fire(QUOTES_MS);
  assert.equal(slow.reads.length, n, 'the tick while one is out asks nothing');
  held.resolve({ ok: true, quotes: [] });
  await settle();
  // a quote kept, then the Account refusing that share: the price kept, marked stale, and China's state its sentence
  const refusing = rig({ storage, answer: path => (path.startsWith('/data/market/quotes?') ? cnQuoted(path, refusingNow ? ['600519'] : []) : undefined) });
  let refusingNow = false;
  refusing.markets.show(true);
  refusing.fire(QUOTES_MS);
  await settle();
  refusingNow = true;
  refusing.fire(QUOTES_MS);
  await settle();
  assert.equal(refusing.m().quotes['cn:600519'].price, 1392.05, 'the kept price');
  assert.equal(refusing.m().quotes['cn:600519'].quote_status, 'stale');
  assert.deepEqual(refusing.m().providers, [{ id: 'tencent', market: 'cn', status: 'error', said: 'no A-share quote for 600519' }]);
  assert.equal(cnStateWord(refusing.m().quotes['cn:600519'], refusing.m().connection, refusing.m().providers), 'Quotes unavailable', 'said over the last price');
  for (const x of [r, slow, refusing]) assert.ok(x.reads.every(p => !faceWire(p)), 'nothing reads the face wire');
  for (const x of [r, slow, refusing]) x.markets.close();
});

test('a failed A-share quote read keeps the price and says the connection failed; a stale re-served answer marks its prices stale', async () => {
  let mode = 'ok';
  const storage = memoryStorage({ [STORAGE_KEY]: saved([asset('cn:600519', { name: 'Kweichow Moutai' })]) });
  const r = rig({
    storage,
    answer: path => {
      if (isChina(path)) return ranked(query(path).sort);
      if (!path.startsWith('/data/market/quotes?')) return undefined;
      if (mode === 'down') return refused(503, { ok: false, unreachable: 'ECONNREFUSED' });
      return mode === 'stale' ? { ...cnQuoted(path), stale: true } : cnQuoted(path);
    },
  });
  r.markets.show(true);
  r.fire(QUOTES_MS);
  await settle();
  assert.equal(r.m().quotes['cn:600519'].price, 1392.05);
  mode = 'down';
  r.fire(QUOTES_MS);
  await settle();
  assert.equal(r.m().quotes['cn:600519'].price, 1392.05, 'the price kept');
  assert.equal(r.m().connection, 'error');
  assert.equal(cnStateWord(r.m().quotes['cn:600519'], r.m().connection, r.m().providers), 'Quotes unavailable');
  mode = 'stale';
  r.fire(QUOTES_MS);
  await settle();
  assert.equal(r.m().connection, 'stale', 'the Account not answering is its own connection (plan-1 final review #1)');
  assert.equal(r.m().quotes['cn:600519'].quote_status, 'stale', "the proxy's last read is no live price");
  assert.match(cnStateWord(r.m().quotes['cn:600519'], r.m().connection, r.m().providers), /^The market is not answering · as of \d{2}-\d{2} \d{2}:\d{2} Beijing$/);
  assert.equal(r.m().providers[0]?.said, 'The market is not answering · China as last read', 'nor Tencent answering on Venues');
  mode = 'ok';
  r.fire(QUOTES_MS);
  await settle();
  assert.equal(r.m().connection, 'polling');
  // the Account back off the China tab: its state read again, never the not-answering sentence left on Venues
  await settle();
  assert.equal(r.m().providers[0]?.status, 'connected', 'China’s state read again once the Account answers');
  assert.ok(r.reads.every(p => !faceWire(p)), 'nothing reads the face wire');
  r.markets.close();
});

test('the Account answering afresh on another screen reads China’s state again, once, only when it was said not answering', async () => {
  let stale = true;
  const r = rig({ answer: path => (isChina(path) ? { ...ranked(query(path).sort), ...(stale ? { stale: true } : {}) } : undefined) });
  const ranks = () => r.reads.filter(isChina).length;
  // China's state as the Account's: a fresh page asks nothing
  r.store.dispatch('chinaStatusUpdated', { status: { state: 'live', said: 'Tencent · live' } });
  r.markets.accountAnswered({ ok: true });
  await settle();
  assert.equal(ranks(), 0);
  // said not answering: a page the proxy re-served stale asks nothing, a fresh one reads the state again
  r.store.dispatch('chinaStatusUpdated', { status: { state: 'unavailable', said: 'The market is not answering · China as last read' } });
  r.markets.accountAnswered({ ok: true, stale: true });
  await settle();
  assert.equal(ranks(), 0);
  stale = false;
  r.markets.accountAnswered({ ok: true });
  r.markets.accountAnswered({ ok: true });
  await settle();
  assert.equal(ranks(), 1, 'one read in the air');
  assert.equal(r.m().providers[0].status, 'connected');
  r.markets.accountAnswered({ ok: true });
  await settle();
  assert.equal(ranks(), 1, 'its state known again: nothing more');
  r.markets.close();
});

test('search is one explore?q read; its A shares are hits with their prices', async () => {
  const storage = memoryStorage();
  const r = rig({ storage, answer: path => (query(path).q === 'mao' ? fx('explore-search-china') : path === ALL ? { ok: true, items: [] } : undefined) });
  r.markets.show(true);
  await settle();
  const before = r.reads.length;
  r.markets.search('mao');
  assert.deepEqual(r.reads.slice(before), ['/data/market/explore?q=mao&limit=200'], 'one read');
  await settle();
  assert.deepEqual(r.m().hitQuotes['cn:600519'], { price: 1392.05, change_pct: 2.81 });
  const rows = rowsOf(r.m(), NOW);
  assert.deepEqual(rows.map(x => [x.id, x.source]), [['stock:AAPL', 'account'], ['cn:600519', 'face'], ['cn:688981', 'face'], ['cn:300750', 'face']]);
  assert.equal(rows.find(x => x.id === 'cn:600519').price, 1392.05, "a hit priced as the search carries it");
  // a star on a hit: its key in the Account store, its row starred under its name
  r.markets.watch('cn:600519');
  assert.deepEqual(JSON.parse(storage.getItem(ACCOUNT_WATCH_KEY)).items, ['cn:600519']);
  assert.equal(storage.getItem(STORAGE_KEY), null, 'the cn list is not written');
  const hit = rowsOf(r.m(), NOW).find(x => x.id === 'cn:600519');
  assert.deepEqual([hit.watched, hit.name], [true, '贵州茅台']);
  assert.ok(r.reads.every(p => !faceWire(p)), 'nothing reads the face wire');
  r.markets.close();
});

test("a star on a China row is its Account key, the row filled; under All and Watching it keeps the share's name", async () => {
  const storage = memoryStorage();
  const r = rig({ storage, answer: chinaAnswer });
  r.store.dispatch('setMarketsTab', 'china');
  r.markets.show(true);
  await settle();
  r.markets.watch('cn:688981');
  assert.deepEqual(JSON.parse(storage.getItem(ACCOUNT_WATCH_KEY)).items, ['cn:688981']);
  assert.equal(rowsOf(r.m(), NOW).find(x => x.id === 'cn:688981').watched, true, 'on China the starred row is filled');
  for (const tab of ['all', 'watching']) {
    r.store.dispatch('setMarketsTab', tab);
    const row = rowsOf(r.m(), NOW).find(x => x.id === 'cn:688981');
    assert.deepEqual([row.source, row.watched, row.name, row.asset.currency], ['face', true, '中芯国际', 'CNY'], tab);
  }
  r.markets.unwatch('cn:688981');
  assert.deepEqual(r.m().watch, [], 'and comes off the Account store');
  assert.deepEqual(JSON.parse(storage.getItem(ACCOUNT_WATCH_KEY)).items, []);
  r.markets.close();
});

// ── A shares on the Account's watch list (plan 1, task 7) ──

test('an A-share star on a page that signs is the Account setWatch china|<code>', async () => {
  const owner = fakeOwner();
  const after = [];
  const storage = memoryStorage();
  const r = rig({ storage, owner, afterAction: (kind, body) => after.push([kind, body]) });
  const page = fx('account');
  r.store.dispatch('accountLoaded', { data: page, at: NOW });
  r.store.dispatch('ownerStanding', { role: 'signs', kid: 'a5048199a8081854' });
  r.markets.watch('cn:600519');
  assert.deepEqual(owner.acts, [{ type: 'setWatch', venue: 'china', symbol: '600519', on: 'true' }], 'no read needed');
  await settle();
  assert.deepEqual(after, [['setWatch', TAKEN.body]]);
  assert.deepEqual(storage.writes, [], 'nothing kept in this browser');
  assert.deepEqual(r.m().watch, []);
  // the page read again lists it: starred, the press signs it off with the page's own entry
  r.store.dispatch('accountLoaded', { data: { ...page, watch: [...page.watch, { venue: 'china', symbol: '600519', at: '2026-11-01T01:00:00.000Z' }] }, at: NOW });
  r.markets.watch('cn:600519');
  assert.equal(owner.acts.length, 1, 'starred already: nothing signed');
  r.markets.unwatch('cn:600519');
  assert.deepEqual(owner.acts.at(-1), { type: 'setWatch', venue: 'china', symbol: '600519', on: '' });
  await settle();
  assert.deepEqual(storage.writes, []);
  r.markets.close();
});

test("an A-share star on a page that does not sign is kept in the browser's Account store", async () => {
  const owner = fakeOwner();
  const storage = memoryStorage();
  const r = rig({ storage, owner });
  r.store.dispatch('ownerStanding', { role: 'pending', kid: '' });
  r.markets.watch('cn:600519');
  assert.deepEqual(owner.acts, []);
  assert.deepEqual(JSON.parse(storage.map.get(ACCOUNT_WATCH_KEY)).items, ['cn:600519']);
  assert.equal(storage.map.has(STORAGE_KEY), false, 'the cn list untouched');
  r.markets.unwatch('cn:600519');
  assert.deepEqual(JSON.parse(storage.map.get(ACCOUNT_WATCH_KEY)).items, []);
  assert.equal(storage.map.has(STORAGE_KEY), false);
  r.markets.close();
});

test('the old cn list moves to the Account store once at load', async () => {
  const storage = memoryStorage({ [STORAGE_KEY]: saved([asset('cn:000001', { name: 'Ping An Bank' }), asset('us:MSFT'), asset('cn:600519')]) });
  const owner = fakeOwner();
  const r = rig({ storage, owner, answer: () => ({ ok: true, items: [] }) });
  assert.deepEqual(JSON.parse(storage.map.get(ACCOUNT_WATCH_KEY)).items, ['cn:000001', 'cn:600519']);
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)).items.map(a => a.id), ['us:MSFT']);
  assert.deepEqual(r.m().watch, ['cn:000001', 'cn:600519']);
  assert.deepEqual(r.m().watchlist.map(a => a.id), ['us:MSFT']);
  assert.equal(r.m().watchError, null);
  assert.deepEqual(owner.acts, [], 'nothing is signed on its own');
  await settle();
  r.markets.close();
  // a second boot moves nothing: the stores as the first left them
  const writes = storage.writes.length;
  const again = rig({ storage, answer: () => ({ ok: true, items: [] }) });
  assert.equal(storage.writes.slice(writes).filter(k => k === ACCOUNT_WATCH_KEY).length, 0);
  assert.deepEqual(again.m().watch, ['cn:000001', 'cn:600519']);
  again.markets.close();
  // one already in the Account store moves without a second copy; an unreadable store moves nothing over it
  const dup = memoryStorage({ [ACCOUNT_WATCH_KEY]: saved(['cn:600519']), [STORAGE_KEY]: saved([asset('cn:600519')]) });
  const d = rig({ storage: dup });
  assert.deepEqual(JSON.parse(dup.map.get(ACCOUNT_WATCH_KEY)).items, ['cn:600519']);
  assert.deepEqual(JSON.parse(dup.map.get(STORAGE_KEY)).items, []);
  d.markets.close();
  const damaged = memoryStorage({ [ACCOUNT_WATCH_KEY]: '{not json', [STORAGE_KEY]: saved([asset('cn:600519')]) });
  const x = rig({ storage: damaged });
  assert.deepEqual(damaged.writes, [], 'the damaged store is kept as it was');
  assert.equal(x.m().watchError, 'read');
  x.markets.close();
  // a failed write of the keys leaves the cn list whole
  const failing = memoryStorage({ [STORAGE_KEY]: saved([asset('cn:600519')]) }, { failKeys: [ACCOUNT_WATCH_KEY] });
  const f = rig({ storage: failing });
  assert.deepEqual(JSON.parse(failing.map.get(STORAGE_KEY)).items.map(a => a.id), ['cn:600519']);
  assert.equal(f.m().watchError, 'unsaved');
  f.markets.close();
});

test('the move keeps what does not fit and says the store is full', async () => {
  const ninetyNine = Array.from({ length: WATCH_LIMIT - 1 }, (_, i) => `stock:S${i}`);
  const storage = memoryStorage({
    [ACCOUNT_WATCH_KEY]: saved(ninetyNine),
    [STORAGE_KEY]: saved([asset('cn:000001'), asset('us:MSFT'), asset('cn:600519', { name: 'Kweichow Moutai' })]),
  });
  const r = rig({ storage, answer: () => ({ ok: true, items: [] }) });
  assert.deepEqual(r.m().watch, [...ninetyNine, 'cn:000001']);
  assert.deepEqual(JSON.parse(storage.map.get(ACCOUNT_WATCH_KEY)).items, [...ninetyNine, 'cn:000001']);
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)).items.map(a => a.id), ['us:MSFT', 'cn:600519'], 'what did not fit stays');
  assert.equal(r.m().watchError, 'full');
  // never dropped: still starred, still drawn under its name, and a press takes it off the cn list
  const row = rowsOf({ ...r.m(), tab: 'watching' }, NOW).find(x => x.id === 'cn:600519');
  assert.deepEqual([row.watched, row.name], [true, 'Kweichow Moutai']);
  r.markets.watch('cn:600519');
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)).items.map(a => a.id), ['us:MSFT', 'cn:600519'], 'starred already: a second star changes nothing');
  r.markets.unwatch('cn:600519');
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)).items.map(a => a.id), ['us:MSFT']);
  await settle();
  r.markets.close();
  // room made, the next boot moves the rest
  const room = memoryStorage({ [ACCOUNT_WATCH_KEY]: saved(ninetyNine.slice(1)), [STORAGE_KEY]: saved([asset('cn:600519')]) });
  const next = rig({ storage: room });
  assert.deepEqual(next.m().watch.slice(-1), ['cn:600519']);
  assert.deepEqual(JSON.parse(room.map.get(STORAGE_KEY)).items, []);
  assert.equal(next.m().watchError, null);
  next.markets.close();
});

test('readAccountWatch keeps cn:600519 and drops cn:60051x', () => {
  const storage = memoryStorage({ [ACCOUNT_WATCH_KEY]: saved(['cn:600519', 'cn:60051x', 'cn:6005190', 'cn:sh600519', 'coin:BTC']) });
  const read = readAccountWatch(storage);
  assert.deepEqual(read.items, ['cn:600519', 'coin:BTC']);
  assert.equal(typeof read.error, 'string', 'the unreadable ones are said');
  assert.equal(saveAccountWatch(memoryStorage(), ['cn:600519']), null);
  assert.equal(typeof saveAccountWatch(memoryStorage(), ['cn:60051x']), 'string');
});

// ── a market page's four reads beside its price (plan 4a Task 4): the asset sheet once on entering and after an owner action,
// its book and latest trades at once and every 5 s while the page is on screen, a perpetual's funding once a connected venue

const BOOK = { ok: true, venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', book: { bids: [[62495.6, 0.4]], asks: [[62502, 1]], at: '2026-10-22T07:59:59.000Z', from: 'Stand-in Exchange', depth: 'full' } };
const TRADES = { ok: true, venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', trades: [{ price: 62500, size: 0.01, side: 'buy', at: '2026-10-22T07:59:58.000Z' }] };
// the funding read at every venue that lists it: a line at one, the other not read
const FUNDING = {
  ok: true, lines: [{ at: '2026-10-22T07:00:00.000Z', symbol: 'BTC/USDT:USDT', side: 'long', qty: 0.01, rate: 0.0001, usd: 0.06, venue: 'ex', venueName: 'Stand-in Exchange' }],
  missing: [{ venue: 'paper', venueName: 'Paper', why: 'lists no funding to the account', part: 'funding' }],
};
// the four reads' answers, the stand-in's asset sheet for any key
function depthAnswer(path) {
  const q = query(path);
  if (path.startsWith('/data/account/asset?')) return { ...fx('asset-btc'), key: q.key };
  if (path.startsWith('/data/account/connected/book?')) return { ...BOOK, venue: q.venue, symbol: q.symbol };
  if (path.startsWith('/data/account/connected/trades?')) return { ...TRADES, venue: q.venue, symbol: q.symbol };
  if (path.startsWith('/data/account/funding?')) return FUNDING;
  return undefined;
}
// All's read with the BTC perpetual connected at a second venue, the paper account
function allWithPerp() {
  const all = fx('explore-all');
  itemOf(all, 'perp:BTC').at.push({ venue: 'paper', venueName: 'Paper', symbol: 'BTC/USDC:USDC', connected: true, canTrade: true, public: false, price: 62490, open: true });
  return all;
}
const depthReads = r => r.reads.filter(p => DEPTH_READ.test(p));

test('a market page reads its asset, book, trades and, for a perpetual, funding; the book and trades every 5 s; nothing after leaving', async () => {
  const r = rig({ answer: path => (path === ALL ? allWithPerp() : depthAnswer(path) ?? (path.startsWith('/data/market/explore?') ? { ok: true, items: [] } : undefined)) });
  r.markets.show(true);
  await settle();
  r.markets.page('perp:BTC');
  assert.deepEqual(depthReads(r), [
    '/data/account/asset?key=crypto%3ABTC',
    '/data/account/funding?limit=100',
    '/data/account/connected/book?venue=ex&symbol=BTC%2FUSDT%3AUSDT&depth=10',
    '/data/account/connected/trades?venue=ex&symbol=BTC%2FUSDT%3AUSDT&limit=20',
  ], 'the asset its coin as the Account reads it, funding once at every venue as the Account’s page reads it, the book and trades at the followed line');
  assert.deepEqual([BOOK_DEPTH, TRADES_LIMIT, FUNDING_LIMIT], [10, 20, 100]);
  const d = () => r.m().depth['perp:BTC'];
  assert.deepEqual(['here', 'book', 'trades', 'funding'].map(k => d()[k].status), ['loading', 'loading', 'loading', 'loading']);
  await settle();
  assert.deepEqual(['here', 'book', 'trades', 'funding'].map(k => d()[k].status), ['ready', 'ready', 'ready', 'ready']);
  assert.equal(d().here.data.key, 'crypto:BTC');
  assert.equal(d().here.at, NOW);
  assert.deepEqual([d().funding.data.lines.length, d().funding.data.missing.length], [1, 1], 'the one answer, its missing venue with it');
  assert.equal(d().book.data.book.from, 'Stand-in Exchange');

  // every 5 s the book and the trades again; the asset sheet and the funding not
  const n = depthReads(r).length;
  r.fire(QUOTES_MS);
  assert.deepEqual(depthReads(r).slice(n), ['/data/account/connected/book?venue=ex&symbol=BTC%2FUSDT%3AUSDT&depth=10', '/data/account/connected/trades?venue=ex&symbol=BTC%2FUSDT%3AUSDT&limit=20']);
  await settle();
  r.fire(QUOTES_MS);
  assert.equal(depthReads(r).length, n + 4);
  await settle();
  // an owner action taken: the asset sheet again, past the face's cache
  r.markets.afterAction();
  assert.equal(depthReads(r).at(-1), '/data/account/asset?key=crypto%3ABTC&fresh=1');
  await settle();

  // hidden: no beat; shown again, the beat goes on
  r.markets.show(false);
  const hidden = depthReads(r).length;
  r.fire(QUOTES_MS);
  assert.equal(depthReads(r).length, hidden);
  r.markets.show(true);
  await settle();

  // leaving: what was read goes, nothing more is read, an action reads nothing
  r.markets.page(null);
  assert.equal(Object.hasOwn(r.m().depth, 'perp:BTC'), false, 'dropped on leaving');
  const left = depthReads(r).length;
  r.fire(QUOTES_MS);
  r.markets.afterAction();
  await settle();
  assert.equal(depthReads(r).length, left);
  // a read in the air when the page is left lands nowhere
  const slow = deferred();
  const r2 = rig({ answer: path => (path === ALL ? allWithPerp() : path.startsWith('/data/account/connected/book?') ? slow.promise : depthAnswer(path)) });
  r2.markets.show(true);
  await settle();
  r2.markets.page('perp:BTC');
  r2.markets.page('stock:NVDA');
  slow.resolve(BOOK);
  await settle();
  assert.equal(Object.hasOwn(r2.m().depth, 'perp:BTC'), false);
  // and nothing after close()
  r2.markets.close();
  const closed = depthReads(r2).length;
  r2.fire(QUOTES_MS);
  r2.markets.page('perp:BTC');
  r2.markets.afterAction();
  assert.equal(depthReads(r2).length, closed);
});

test("a stock's page reads no funding", async () => {
  const r = rig({ answer: path => (path === ALL ? fx('explore-all') : depthAnswer(path)) });
  r.markets.show(true);
  await settle();
  r.markets.page('stock:NVDA');
  assert.deepEqual(depthReads(r), [
    '/data/account/asset?key=equity%3ANVDA',
    '/data/account/connected/book?venue=broker&symbol=NVDA&depth=10',
    '/data/account/connected/trades?venue=broker&symbol=NVDA&limit=20',
  ]);
  await settle();
  assert.equal(r.m().depth['stock:NVDA'].funding, undefined);
  // a source that publishes no trades: said once, and asked no more while the page is on
  const none = rig({ answer: path => (path === ALL ? fx('explore-all') : path.startsWith('/data/account/connected/trades?') ? fx('trades') : depthAnswer(path)) });
  none.markets.show(true);
  await settle();
  none.markets.page('stock:NVDA');
  await settle();
  none.fire(QUOTES_MS);
  assert.deepEqual(depthReads(none).filter(p => p.startsWith('/data/account/connected/trades?')).length, 1);
  assert.equal(depthReads(none).filter(p => p.startsWith('/data/account/connected/book?')).length, 2, 'the book still beats');
});

test("an A share's page reads none of the four", async () => {
  const r = rig({ answer: path => (path === ALL ? fx('explore-all') : path.startsWith('/data/market/candles?') ? fx('candles-china-1d') : depthAnswer(path)) });
  r.markets.show(true);
  await settle();
  r.markets.page('cn:600519');
  await settle();
  r.fire(QUOTES_MS);
  r.markets.afterAction();
  await settle();
  assert.deepEqual(depthReads(r), []);
  assert.deepEqual(r.m().depth, {});
});

test('only the latest book read lands', async () => {
  const first = deferred();
  const third = deferred();
  let books = 0;
  const r = rig({
    answer: path => {
      if (path === ALL) return fx('explore-all');
      if (path.startsWith('/data/account/connected/book?')) { books += 1; return books === 1 ? first.promise : books === 3 ? third.promise : { ...BOOK, venue: query(path).venue }; }
      return depthAnswer(path);
    },
  });
  r.markets.show(true);
  await settle();
  // in the air on the coin's page; the page left for another and come back to: a new read
  r.markets.page('coin:BTC');
  r.markets.page('stock:NVDA');
  await settle();
  r.markets.page('coin:BTC');
  assert.equal(books, 3);
  // the first answer, overtaken, lands nowhere; the latest does
  first.resolve({ ...BOOK, book: { ...BOOK.book, from: 'the first' } });
  await settle();
  assert.equal(r.m().depth['coin:BTC'].book.status, 'loading');
  assert.equal(r.m().depth['coin:BTC'].book.data, null);
  third.resolve({ ...BOOK, book: { ...BOOK.book, from: 'the latest' } });
  await settle();
  assert.equal(r.m().depth['coin:BTC'].book.data.book.from, 'the latest');
  // a refusal lands as a failure with the Account's sentence, the book kept; an answer re-served stale keeps the last fresh time
  books = 10;
  const refusing = rig({
    answer: path => {
      if (path === ALL) return fx('explore-all');
      if (path.startsWith('/data/account/connected/book?')) return (books += 1) === 12 ? refused(409, { ok: false, refusal: { message: 'Stand-in Exchange did not answer in time' } }) : books === 13 ? { ...BOOK, stale: true } : BOOK;
      return depthAnswer(path);
    },
  });
  refusing.markets.show(true);
  await settle();
  refusing.markets.page('coin:BTC');
  await settle();
  refusing.fire(QUOTES_MS);
  await settle();
  const book = () => refusing.m().depth['coin:BTC'].book;
  assert.deepEqual([book().status, book().message, book().data.book.from], ['error', 'Stand-in Exchange did not answer in time', 'Stand-in Exchange']);
  refusing.fire(QUOTES_MS);
  await settle();
  assert.deepEqual([book().status, book().data.stale, book().freshAt], ['ready', true, NOW]);
});

// ── two upstreams (plan A2 Task 6): the market's public reads and the account's connected reads, joined in the host ──

const line = (venue, symbol, over = {}) => ({ venue, venueName: venue, symbol, connected: false, public: false, canTrade: false, price: 100, open: true, ...over });
const exploreBody = (items, over = {}) => ({ ok: true, asOf: '2026-10-22T08:00:00.000Z', items, movers: [], closing: [], mostTraded: [], tabs: [{ id: 'all', label: 'All', count: items.length }], missing: [], notes: [], ...over });
const coinRow = (base, at, over = {}) => ({ key: `coin:${base}`, kind: 'coin', name: base, base, price: 100, volumeUsd24h: 1_000, tabs: ['all', 'crypto'], at, ...over });
// the page with these venues beside the stand-in's own
const pageWith = (...venues) => { const page = fx('account'); page.venues = [...page.venues, ...venues]; return page; };
const UNREACHABLE = () => refused(503, { ok: false, unreachable: 'ECONNREFUSED' });

test('explore reads both halves and lands their join', async () => {
  const market = exploreBody([coinRow('BTC', [line('kraken', 'BTC/USD', { public: true, connector: 'live:exchange:kraken' })])]);
  const connected = exploreBody([coinRow('BTC', [line('my-okx', 'BTC/USDT', { connected: true, canTrade: true })], { volumeUsd24h: 5_000 }),
    { key: 'stock:NVDA', kind: 'stock', name: 'NVDA', base: 'NVDA', price: 180, tabs: ['all', 'stocks'], at: [line('broker', 'NVDA', { connected: true })] }]);
  const halfOf = deferred();
  const r = rig({ answer: path => (path === ALL ? market : path === CONNECTED_ALL ? halfOf.promise : undefined) });
  r.markets.show(true);
  assert.deepEqual(r.allReads.filter(p => p.includes('/explore?')), [ALL, CONNECTED_ALL], 'both halves, the same query');
  assert.ok(r.allReads.includes('/data/account/venues'), 'and the venues read, once');
  await settle();
  assert.deepEqual(r.m().explore.all.data.items.map(i => i.key), ['coin:BTC'], "the market's half lands at once");
  halfOf.resolve(connected);
  await settle();
  const data = r.m().explore.all.data;
  assert.deepEqual(data.items.map(i => i.key), ['coin:BTC', 'stock:NVDA'], "the market's row, then the one only the account lists");
  assert.deepEqual(data.items[0].at.map(l => l.venue), ['my-okx', 'kraken'], 'the connected line first, then the public');
  assert.equal(data.tabs[0].count, 2, "the account's own row counted");
  // the venues read says kraken does not serve here: the join is made again over it
  r.fire(EXPLORE_MS);
  await settle();
  assert.equal(r.allReads.filter(p => p === '/data/account/venues').length, 1, 'the venues read is asked once');
  r.markets.close();
});

test('the venues read joins again: a public line where its connection does not serve here is left out', async () => {
  const market = exploreBody([coinRow('BTC', [line('kraken', 'BTC/USD', { public: true, connector: 'live:exchange:kraken' }), line('okx', 'BTC/USDT', { public: true, connector: 'live:exchange:okx' })])]);
  const venues = deferred();
  const r = rig({ answer: path => (path === ALL ? market : path === '/data/account/venues' ? venues.promise : undefined) });
  r.markets.show(true);
  await settle();
  assert.deepEqual(r.m().explore.all.data.items[0].at.map(l => l.venue), ['kraken', 'okx']);
  venues.resolve({ ok: true, venues: [{ connector: 'live:exchange:okx', verdict: 'not-served' }] });
  await settle();
  assert.equal(r.store.get().account.venuesHere.status, 'ready');
  assert.deepEqual(r.m().explore.all.data.items[0].at.map(l => l.venue), ['kraken']);
  r.markets.close();
});

test('the market down: the connected rows alone, with the market not answering in missing', async () => {
  const connected = exploreBody([coinRow('BTC', [line('my-okx', 'BTC/USDT', { connected: true })])]);
  const r = rig({ answer: path => (path === ALL ? UNREACHABLE() : path === CONNECTED_ALL ? connected : undefined) });
  r.markets.show(true);
  await settle();
  const data = r.m().explore.all.data;
  assert.equal(r.m().explore.all.status, 'ready');
  assert.deepEqual(data.items.map(i => i.key), ['coin:BTC']);
  assert.deepEqual(data.missing, [{ venue: 'market', venueName: 'the market', why: 'The market is not answering: public markets are not listed' }]);
  r.markets.close();
});

test('an explore half for a tab left lands nowhere', async () => {
  const crypto = deferred();
  const cryptoConnected = deferred();
  const r = rig({
    answer: path => {
      if (path === '/data/market/explore?tab=crypto&limit=200') return crypto.promise;
      if (path === '/data/account/connected/explore?tab=crypto&limit=200') return cryptoConnected.promise;
      if (path.startsWith('/data/market/explore?tab=stocks')) return exploreBody([]);
      return undefined;
    },
  });
  r.store.dispatch('setMarketsTab', 'crypto');
  r.markets.show(true);
  assert.equal(r.m().explore.crypto.status, 'loading');
  // the market's half lands while crypto is on screen; the connected half is still out when the tab changes
  crypto.resolve(exploreBody([coinRow('BTC', [line('kraken', 'BTC/USD', { public: true })])]));
  await settle();
  const landed = r.m().explore.crypto.data;
  assert.deepEqual(landed.items.map(i => i.key), ['coin:BTC']);
  r.store.dispatch('setMarketsTab', 'stocks');
  cryptoConnected.resolve(exploreBody([coinRow('ETH', [line('my-okx', 'ETH/USDT', { connected: true })])]));
  await settle();
  assert.equal(r.m().explore.crypto.data, landed, "the late half for crypto lands nowhere");
  assert.equal(r.m().explore.stocks.status, 'ready');
  r.markets.close();
});

test("a page on a connected line reads its candles, book and trades from the Account's connected routes", async () => {
  const all = exploreBody([coinRow('BTC', [line('ex', 'BTC/USDT', { connected: true, canTrade: true }), line('kraken', 'BTC/USD', { public: true, connector: 'live:exchange:kraken' })])]);
  const r = rig({ answer: path => (path === ALL ? all : path.startsWith('/data/account/connected/candles?') ? { ...fx('candles') } : depthAnswer(path)) });
  r.markets.show(true);
  await settle();
  r.markets.page('coin:BTC');
  assert.ok(r.reads.includes('/data/account/connected/candles?venue=ex&symbol=BTC%2FUSDT&range=1D'));
  assert.ok(r.reads.includes('/data/account/connected/book?venue=ex&symbol=BTC%2FUSDT&depth=10'));
  assert.ok(r.reads.includes('/data/account/connected/trades?venue=ex&symbol=BTC%2FUSDT&limit=20'));
  assert.ok(r.reads.includes('/data/account/asset?key=crypto%3ABTC'), 'the asset sheet stays the account\'s');
  assert.ok(r.reads.includes('/data/account/compare?base=BTC&side=buy'), "compare stays the account's");
  assert.equal(r.reads.some(p => /^\/data\/market\/(candles|book|trades)\?/.test(p)), false, 'the market is not asked');
  await settle();
  assert.equal(r.m().candles['coin:BTC'].status, 'ready');
  assert.equal(r.m().depth['coin:BTC'].book.status, 'ready');
  r.markets.close();
});

test("the Account down: a connected line falls back to its public twin, never another connection's", async () => {
  // a keyed testnet venue: its public neighbour is another connection (Hyperliquid mainnet's), so nothing is read in its place
  const hl = coinRow('HYPE', [
    line('hyperliquid-paper', 'HYPE/USDC:USDC', { connected: true, canTrade: true, paper: true, connector: 'live:hyperliquid-paper' }),
    line('hyperliquid', 'HYPE/USDC:USDC', { public: true, connector: 'live:hyperliquid-trade' }),
  ]);
  // a connected okx: the public okx line of the same connection reads in its place
  const okx = coinRow('BTC', [
    line('my-okx', 'BTC/USDT', { connected: true, canTrade: true }),
    line('okx', 'BTC/USDT', { public: true, connector: 'live:exchange:okx' }),
  ]);
  const all = exploreBody([hl, okx]);
  const r = rig({
    answer: path => {
      if (path === ALL) return all;
      if (path.startsWith('/data/account/connected/')) return UNREACHABLE();
      if (path.startsWith('/data/market/book?')) return { ...BOOK, venue: query(path).venue, symbol: query(path).symbol };
      if (path.startsWith('/data/market/trades?')) return { ...TRADES, venue: query(path).venue };
      if (path.startsWith('/data/market/candles?')) return { ...fx('candles') };
      return depthAnswer(path);
    },
  });
  // the page names my-okx: the join leaves its public twin out of the row, and the fallback finds it in the market's own row
  r.store.dispatch('accountLoaded', { data: pageWith({ id: 'my-okx', name: 'OKX', connector: 'live:exchange:okx', usd: 0 }, { id: 'hyperliquid-paper', name: 'Hyperliquid testnet', connector: 'live:hyperliquid-paper', usd: 0, paper: true }), at: NOW });
  r.markets.show(true);
  await settle();
  r.markets.page('coin:HYPE');
  await settle();
  assert.equal(r.reads.some(p => /^\/data\/market\/(candles|book|trades)\?/.test(p)), false, "no mainnet read for the testnet's page");
  assert.equal(r.m().depth['coin:HYPE'].book.status, 'error');
  assert.equal(r.m().depth['coin:HYPE'].book.message, 'The Account is not answering');
  assert.equal(r.m().depth['coin:HYPE'].trades.message, 'The Account is not answering');
  assert.equal(r.m().candles['coin:HYPE'].message, 'The Account is not answering');

  r.markets.page('coin:BTC');
  await settle();
  assert.deepEqual(r.reads.filter(p => p.startsWith('/data/market/book?')), ['/data/market/book?venue=okx&symbol=BTC%2FUSDT&depth=10'], 'asked once, at the public okx line');
  assert.ok(r.reads.includes('/data/market/candles?venue=okx&symbol=BTC%2FUSDT&range=1D'));
  assert.equal(r.m().depth['coin:BTC'].book.status, 'ready');
  assert.equal(r.m().candles['coin:BTC'].status, 'ready');
  r.markets.close();
});

test('a refusal from the Account is the answer, with no fallback', async () => {
  const okx = coinRow('BTC', [
    line('my-okx', 'BTC/USDT', { connected: true, canTrade: true, connector: 'live:exchange:okx' }),
    line('okx', 'BTC/USDT', { public: true, connector: 'live:exchange:okx' }),
  ]);
  const said = 'my-okx did not answer in time';
  const r = rig({
    answer: path => (path === ALL ? exploreBody([okx])
      : path.startsWith('/data/account/connected/') ? refused(409, { ok: false, refusal: { code: 'E_VENUE_UNREACHABLE', message: said } }) : depthAnswer(path)),
  });
  r.markets.show(true);
  await settle();
  r.markets.page('coin:BTC');
  await settle();
  assert.equal(r.reads.some(p => /^\/data\/market\/(candles|book|trades)\?/.test(p)), false);
  assert.equal(r.m().depth['coin:BTC'].book.message, said);
  assert.equal(r.m().candles['coin:BTC'].message, said);
  r.markets.close();
});

test('quotes split by line: connected pairs to the Account, the rest to the market', async () => {
  const r = rig({ answer: path => (path === ALL ? fx('explore-all') : path.includes('/quotes?') ? quoted(pairsIn(path)) : undefined) });
  // a page that names broker and paper, not ex: ex's pairs are asked of the market
  const page = fx('account');
  page.venues = page.venues.filter(v => v.id !== 'ex');
  r.store.dispatch('accountLoaded', { data: page, at: NOW });
  r.markets.show(true);
  await settle();
  r.markets.rowsInView(['stock:NVDA', 'coin:ETH', 'perp:DOGE']);
  r.fire(QUOTES_MS);
  const account = r.reads.filter(p => p.startsWith('/data/account/connected/quotes?'));
  const market = r.reads.filter(p => p.startsWith('/data/market/quotes?'));
  assert.deepEqual(account.map(pairsIn), [['broker|NVDA', 'paper|DOGE/USDC:USDC']]);
  assert.deepEqual(market.map(pairsIn), [['ex|ETH/USDT']]);
  assert.equal(r.reads.some(p => p.startsWith('/data/account/quotes?')), false);
  await settle();
  assert.equal(r.m().accountQuotes['broker|NVDA'].price, 182.4);
  assert.equal(r.m().accountQuotes['ex|ETH/USDT'].price, 182.4, 'both answers land');
  r.markets.close();
});

test("a public line is followed on the market stream, a connected line on the Account's", async () => {
  const pubOnly = coinRow('DOGE', [line('kraken', 'DOGE/USD', { public: true, connector: 'live:exchange:kraken' })]);
  const conn = coinRow('BTC', [line('ex', 'BTC/USDT', { connected: true, canTrade: true })]);
  const r = rig({ answer: path => (path === ALL ? exploreBody([pubOnly, conn]) : depthAnswer(path)) });
  r.markets.show(true);
  await settle();
  r.markets.page('coin:DOGE');
  assert.deepEqual(r.marketFollows.at(-1), ['kraken:DOGE/USD']);
  assert.deepEqual(r.follows.at(-1), []);
  r.markets.page('coin:BTC');
  assert.deepEqual(r.follows.at(-1), ['ex:BTC/USDT']);
  assert.deepEqual(r.marketFollows.at(-1), []);
  r.markets.page(null);
  assert.deepEqual([r.follows.at(-1), r.marketFollows.at(-1)], [[], []], 'leaving lets both go');
  r.markets.close();
});

test("China's ranking, search and history are the market's", async () => {
  const fakeHit = { key: 'cn:600000', kind: 'ashare', name: '浦发银行', base: '600000', price: 9, tabs: ['china'], at: [] };
  const r = rig({
    answer: path => {
      if (path.startsWith('/data/market/explore?tab=china')) return fx('explore-china');
      if (path.startsWith('/data/market/explore?q=')) return fx('explore-search-china');
      if (path.startsWith('/data/account/connected/explore?q=')) return exploreBody([fakeHit]);
      if (path.startsWith('/data/market/candles?')) return fx('candles-china-1d');
      return undefined;
    },
  });
  r.store.dispatch('setMarketsTab', 'china');
  r.markets.show(true);
  assert.ok(r.reads.includes(CHINA('volume')), 'the ranking is asked of the market');
  assert.equal(r.allReads.some(p => p.startsWith('/data/account/connected/explore?tab=china')), false, 'and of nothing else');
  r.markets.search('mao');
  assert.ok(r.allReads.includes('/data/account/connected/explore?q=mao&limit=200'), "the search's connected twin");
  await settle();
  assert.deepEqual(Object.keys(r.m().hitQuotes).sort(), ['cn:300750', 'cn:600519', 'cn:688981'], "the hits are the market's alone");
  r.markets.page('cn:600519');
  assert.ok(r.reads.includes('/data/market/candles?venue=china&symbol=600519&range=1D'));
  assert.equal(r.allReads.some(p => /^\/data\/account\/(candles|quotes|explore)\?/.test(p)), false, "nothing of China's is asked of the account's old routes");
  r.markets.close();
});
