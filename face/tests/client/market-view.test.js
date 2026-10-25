// The Markets view: the Account's explore items as the table's rows — tabs, prices by kind, the source word, the legs across
// venues — beside the face's A-share (cn:) rows, and a market's page with what is held, working and stated for it (spec
// 2026-10-22 §6.1), over the stand-in's answers (tests/fixtures/account/); what Hand to Gravit says of a market. And the face's
// own ids and English words from the cn wire's enums (spec 2026-10-19 §7 Stage 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalId, quoteWord, connectionWord, providerWord, basisWord, sourceWord, volumeWord, volumeWordOf, searchWord, watchWord, mentionsOf,
  ACCOUNT_TABS, ACCOUNT_SORTS, CANDLE_RANGES, isAccountKey, tabsOf, priceOf, sourceWordOf, legsOf, rowsOf, tableOf, sortsOf, matchKey, pairsOf,
  pageOf, faceAssetOf, handWordsOf, watchedOf, watchKeysOf, setWatchOf,
} from '../../client/js/host/market-view.js';

const CJK = /[㐀-鿿]/;
// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const itemOf = (body, key) => body.items.find(i => i.key === key);
// a read as the store keeps it
const read = data => ({ status: 'ready', data, at: 1 });
// the renderer's clock, months from the machine's so a view reading Date.now() instead would show, and a stamp that long before it
const NOW = Date.parse('2026-01-15T12:00:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();
const asset = (id, over = {}) => {
  const [market, symbol] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  return { id, market, symbol, name: symbol, exchange: '', currency: market === 'cn' ? 'CNY' : 'USD', ...over };
};
const quote = (id, over = {}) => ({
  id, market: id.slice(0, id.indexOf(':')), symbol: id.slice(id.indexOf(':') + 1), transport: 'stream', price: 10, prev_close: 9, change: 1,
  change_pct: 11.11, volume: 1000, as_of: '2026-10-19T14:30:00Z', received_at: null, volume_as_of: null, source: 'Alpaca', feed: 'iex',
  basis: 'previous_close', quote_status: 'live', market_status: 'open', message: '', ...over,
});
// the markets slice: the face's own fields as today, and the Account's reads beside them (Task 10 builds it so) — `explore` by
// tab: `all` is explore?limit=200, a kind's own explore?tab=<kind>&limit=200
const markets = (over = {}) => ({
  tab: 'all', sort: 'volume', q: '', watchlist: [], watchError: null, quotes: {}, providers: [], connection: 'idle',
  search: { query: '', status: 'idle', assets: [], partial: false }, hitQuotes: {},
  explore: {}, results: { status: 'idle', data: null, at: null },
  accountQuotes: {}, candles: {}, compare: {}, watch: [], asked: {}, ...over,
});
// the account slice as host/account.js keeps it, over the stand-in's page, holdings, paper lens and statement
const accountSlice = (over = {}) => ({
  status: 'ready', data: fx('account'), at: 1, message: null,
  holdings: read(fx('holdings')), paper: read(fx('holdings-paper')), statement: read(fx('statement')), ...over,
});
const UNPRICED = { price: null, unit: 'usd', changePct: null, change24h: null, volume: null, volumeUnit: 'usd', implied: null };

// ── The Account's markets ──

test('tabsOf: the fixture tabs in order, All first; Stocks raised by cn rows; Watching and Results when due', () => {
  assert.deepEqual(ACCOUNT_TABS, [['all', 'All'], ['crypto', 'Crypto'], ['stocks', 'Stocks'], ['rwas', 'RWAs'], ['perps', 'Perps'], ['preipo', 'Pre-IPO'], ['predictions', 'Predictions']]);
  assert.deepEqual(ACCOUNT_SORTS, [{ id: 'volume', label: 'Most traded' }, { id: 'movers', label: 'Biggest moves' }, { id: 'closing', label: 'Closing soonest' }]);
  const explore = fx('explore-all');
  assert.deepEqual(tabsOf(explore, 0), [
    { id: 'all', label: 'All', count: 30 }, { id: 'crypto', label: 'Crypto', count: 6 }, { id: 'stocks', label: 'Stocks', count: 4 },
    { id: 'rwas', label: 'RWAs', count: 4 }, { id: 'perps', label: 'Perps', count: 6 }, { id: 'preipo', label: 'Pre-IPO', count: 1 },
    { id: 'predictions', label: 'Predictions', count: 9 },
  ]);
  // two cn rows: All and Stocks count them too
  assert.deepEqual(tabsOf(explore, 2).map(t => [t.id, t.count]), [['all', 32], ['crypto', 6], ['stocks', 6], ['rwas', 4], ['perps', 6], ['preipo', 1], ['predictions', 9]]);
  // ACCOUNT_TABS gives the order and the labels, not the Account; an empty tab, or one the face does not know, is not drawn
  const odd = fx('explore-all');
  odd.tabs = [...odd.tabs].reverse().map(t => (t.id === 'crypto' ? { ...t, label: 'Krypto' } : t.id === 'rwas' ? { ...t, count: 0 } : t));
  odd.tabs.push({ id: 'venues', label: 'Venues', count: 3 });
  assert.deepEqual(tabsOf(odd, 0).map(t => `${t.id}:${t.label}`), ['all:All', 'crypto:Crypto', 'stocks:Stocks', 'perps:Perps', 'preipo:Pre-IPO', 'predictions:Predictions']);
  // no Stocks from the Account: the cn rows make one, in its place; without them there is none
  const noStocks = fx('explore-all');
  noStocks.tabs = noStocks.tabs.filter(t => t.id !== 'stocks');
  assert.deepEqual(tabsOf(noStocks, 2).slice(0, 3).map(t => [t.id, t.count]), [['all', 32], ['crypto', 6], ['stocks', 2]]);
  assert.equal(tabsOf(noStocks, 0).some(t => t.id === 'stocks'), false);
  // nothing read yet, or a refusal: All alone, and Stocks for the cn rows
  assert.deepEqual(tabsOf(null, 0), [{ id: 'all', label: 'All', count: 0 }]);
  assert.deepEqual(tabsOf({ ok: false, refusal: { message: 'The account is busy' } }, 3), [{ id: 'all', label: 'All', count: 3 }, { id: 'stocks', label: 'Stocks', count: 3 }]);
  // Watching and All results when due, in the Account's order: All results first while searching, Watching last once anything is starred
  const RESULTS = { id: 'results', label: 'All results', count: null };
  const WATCHING = { id: 'watching', label: 'Watching', count: null };
  assert.deepEqual(tabsOf(explore, 0, { searching: true, watching: true }), [RESULTS, ...tabsOf(explore, 0), WATCHING]);
  assert.deepEqual(tabsOf(explore, 0, { watching: true }).map(t => t.id), ['all', 'crypto', 'stocks', 'rwas', 'perps', 'preipo', 'predictions', 'watching']);
  assert.deepEqual(tabsOf(null, 1, { searching: true }), [RESULTS, { id: 'all', label: 'All', count: 1 }, { id: 'stocks', label: 'Stocks', count: 1 }]);
  assert.deepEqual(tabsOf(explore, 2, { searching: false, watching: false }), tabsOf(explore, 2));
  // ... and rowsOf answers them: the stars under Watching, the search's own rows under All results
  const m = markets({ explore: { all: read(explore) }, watch: ['coin:ETH', 'stock:AAPL'], watchlist: [asset('cn:600519')] });
  assert.deepEqual(rowsOf({ ...m, tab: 'watching' }).map(r => r.id), ['stock:AAPL', 'coin:ETH', 'cn:600519']);
  const sol = fx('explore-all');
  sol.items = sol.items.filter(i => i.base === 'SOL');
  const searching = {
    ...m, q: 'sol', tab: 'results', results: read(sol),
    search: { query: 'sol', status: 'success', assets: [asset('crypto:SOL/USD'), asset('cn:601012', { name: 'LONGi' })], partial: false },
  };
  assert.deepEqual(rowsOf(searching).map(r => r.id), ['perp:SOL', 'coin:SOL', 'cn:601012'], "the Account's hits and the cn hits; never a crypto hit of the face's");
  assert.deepEqual(rowsOf({ ...searching, tab: 'all' }).map(r => r.id), ['perp:SOL', 'coin:SOL', 'cn:601012'], 'while searching, All is the search too');
  assert.deepEqual(rowsOf({ ...searching, tab: 'watching' }).map(r => r.id), ['perp:SOL', 'coin:SOL', 'cn:601012'], 'a search typed on Watching searches every market: the watchlist is not searched');
  assert.deepEqual(rowsOf({ ...searching, q: '' }), [], 'no query, no results');
});

test('priceOf: a coin in dollars; an event in cents with change in cents; Kalshi volume in contracts; a pre-IPO implied', () => {
  assert.deepEqual(priceOf(itemOf(fx('explore-all'), 'coin:BTC')),
    { price: 62480, unit: 'usd', changePct: 2.3, change24h: 1404.5, volume: 2511381622, volumeUnit: 'usd', implied: null });
  const predictions = fx('explore-predictions');
  assert.deepEqual(priceOf(itemOf(predictions, 'event:predict:SI-FEDCUT-DEC')),
    { price: 62, unit: 'cents', changePct: null, change24h: 4, volume: 1840000, volumeUnit: 'usd', implied: null });
  // 0.14 × 100 is 14.000000000000002 in floating point: the cents are the contract's, not the float's
  assert.equal(priceOf(itemOf(predictions, 'event:predict:SI-BTC15-2610220730')).price, 14);
  assert.equal(priceOf(itemOf(predictions, 'event:predict:SI-CPI-NEXT')).change24h, -3);
  const kalshi = {
    key: 'kalshi:KXFED-DEC', kind: 'event', name: 'Fed cuts in December?', price: 0.62, change24h: 0.03, contracts24h: 412000,
    volumeUsd24h: 4100000, category: 'Economics', tabs: ['all', 'predictions'], at: [],
  };
  assert.deepEqual(priceOf(kalshi), { price: 62, unit: 'cents', changePct: null, change24h: 3, volume: 412000, volumeUnit: 'contracts', implied: null });
  const preipo = {
    key: 'preipo:anthropic', kind: 'perp', name: 'Anthropic pre-IPO perpetual', base: 'ANTHROPIC', price: 182.5, changePct24h: -0.4,
    volumeUsd24h: 12500000, category: 'Pre-IPO', implied: { usd: 183000000000, unit: 'valuation' }, group: { id: 'preipo:anthropic', title: 'Anthropic' },
    tabs: ['all', 'preipo'], at: [],
  };
  assert.deepEqual(priceOf(preipo), { price: 182.5, unit: 'usd', changePct: -0.4, change24h: null, volume: 12500000, volumeUnit: 'usd', implied: 183000000000 });
  // a figure the Account does not give, or one that does not parse, is null: never NaN, never 0
  assert.deepEqual(priceOf({ key: 'coin:X', kind: 'coin', price: 'n/a', changePct24h: NaN, volumeUsd24h: '1.5e6', implied: 'big' }),
    { price: null, unit: 'usd', changePct: null, change24h: null, volume: 1500000, volumeUnit: 'usd', implied: null });
  assert.deepEqual(priceOf({ key: 'kalshi:X', kind: 'event', price: '', change24h: 'up' }),
    { price: null, unit: 'cents', changePct: null, change24h: null, volume: null, volumeUnit: 'contracts', implied: null });
  assert.deepEqual(priceOf(null), UNPRICED);
});

test('sourceWordOf: the Account quoteFrom verbatim, with the age past 5 s', () => {
  const hood = quoteAt => ({ key: 'stock:HOOD', kind: 'stock', name: 'Robinhood Markets', base: 'HOOD', price: 41.2, quoteFrom: 'Robinhood · real time', quoteAt, tabs: ['all', 'stocks'], at: [] });
  assert.equal(sourceWordOf(hood(ago(2_000)), NOW), 'Robinhood · real time');
  assert.equal(sourceWordOf(hood(ago(5_000)), NOW), 'Robinhood · real time', 'five seconds old is still fresh');
  assert.equal(sourceWordOf(hood(ago(12_000)), NOW), 'Robinhood · real time · 12 s ago');
  assert.equal(sourceWordOf(hood(ago(3 * 60_000 + 5_000)), NOW), 'Robinhood · real time · 3 min ago');
  assert.equal(sourceWordOf(hood(ago(2 * 3_600_000 + 60_000)), NOW), 'Robinhood · real time · 2 h ago');
  assert.equal(sourceWordOf(hood(ago(30 * 3_600_000)), NOW), 'Robinhood · real time · yesterday');
  assert.equal(sourceWordOf(hood(ago(3 * 86_400_000)), NOW), 'Robinhood · real time · 3 days ago');
  assert.equal(sourceWordOf(hood('not a time'), NOW), 'Robinhood · real time', 'a stamp that does not parse ages nothing');
  assert.equal(sourceWordOf(hood(ago(-60_000)), NOW), 'Robinhood · real time', 'a stamp ahead of the clock ages nothing');
  assert.equal(sourceWordOf(hood(undefined), NOW), 'Robinhood · real time');
  // no word on the row: the venue its 24h change is from
  assert.equal(sourceWordOf({ ...hood(ago(3 * 60_000)), quoteFrom: undefined, changeFrom: { venue: 'coinbase', venueName: 'Coinbase' } }, NOW), 'Coinbase · 3 min ago');
  // nor that: the first venue the owner connected that lists it — its line's word, else its name — with that line's stamp
  const cboe = { venue: 'cboe-public', venueName: 'Cboe', symbol: 'HOOD', connected: false, canTrade: false, public: true, price: 41.2, quoteFrom: 'Cboe · 15 min delayed', quoteAt: ago(15 * 60_000) };
  const broker = { ...cboe, venue: 'broker', venueName: 'Stand-in Broker', connected: true, canTrade: true, public: false };
  const lines = at => ({ ...hood(undefined), quoteFrom: undefined, at });
  assert.equal(sourceWordOf(lines([cboe, broker]), NOW), 'Cboe · 15 min delayed · 15 min ago');
  assert.equal(sourceWordOf(lines([cboe, { ...broker, quoteFrom: undefined }]), NOW), 'Stand-in Broker · 15 min ago');
  assert.equal(sourceWordOf(lines([cboe]), NOW), '', 'a public line alone names no source: never the first line for itself');
  // the fixtures: each row's change is its venue's; a public-led row is the public exchange's, not the paper account's
  const explore = fx('explore-all');
  assert.equal(sourceWordOf(itemOf(explore, 'stock:NVDA'), NOW), 'Stand-in Broker');
  assert.equal(sourceWordOf(itemOf(explore, 'coin:DOGE'), NOW), 'Stand-in Public Exchange');
  assert.equal(sourceWordOf({ ...itemOf(explore, 'coin:DOGE'), changeFrom: undefined }, NOW), 'Stand-in Public Exchange', 'the paper line says where its price is from');
  assert.equal(sourceWordOf(itemOf(fx('explore-predictions'), 'event:paper-momentum:SX-JOBS-NEXT'), NOW), 'Momentum · paper', 'a market only the paper account lists');
  assert.equal(sourceWordOf({ key: 'coin:Y', kind: 'coin', at: [{ venue: 'p', venueName: 'Public X', symbol: 'Y/USD', connected: false, public: true }] }, NOW), '');
  assert.equal(sourceWordOf(null, NOW), '');
});

test('legsOf: connected first, best marked, public legs with connectTo', () => {
  const explore = fx('explore-all');
  const btc = legsOf(itemOf(explore, 'coin:BTC'));
  assert.deepEqual(btc.map(l => `${l.venue}|${l.symbol}`), ['ex|BTC/USDT', 'wallet|cbBTC/USDC@Base', 'paper-momentum|BTC/USD', 'standin-pubex-public|BTC/USD']);
  assert.deepEqual(btc[0], {
    venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT', connected: true, paper: false, canTrade: true, public: false,
    connectTo: '', connector: '', price: 62480, bid: 62476.8, ask: 62483.2, best: true,
  });
  assert.deepEqual(btc.map(l => l.best), [true, false, false, false], 'the lowest ask among the connected: 62,483.2 at ex, under the paper account’s 62,484.7');
  assert.equal(btc[2].paper, true);
  assert.deepEqual(btc[3], {
    venue: 'standin-pubex-public', venueName: 'Stand-in Public Exchange', symbol: 'BTC/USD', connected: false, paper: false, canTrade: false, public: true,
    connectTo: 'standin-pubex', connector: 'live:standin-pubex', price: 62480, bid: 62475.3, ask: 62484.7, best: false,
  });
  // two paper accounts at one ask: one best, the first
  assert.deepEqual(legsOf(itemOf(explore, 'perp:DOGE')).map(l => [l.venue, l.best]), [['paper', true], ['paper-momentum', false], ['standin-pubperps-public', false]]);
  // no ask among the lines that can take an order: the lowest price; a public line is never best; a canTrade the Account does
  // not know stays unknown, and is never best
  const hand = {
    key: 'coin:X', kind: 'coin', at: [
      { venue: 'c', venueName: 'C', symbol: 'X/USD', connected: false, canTrade: false, public: true, price: 9, ask: 9.1 },
      { venue: 'a', venueName: 'A', symbol: 'X/USD', connected: true, canTrade: true, public: false, price: 10 },
      { venue: 'b', venueName: 'B', symbol: 'X/USD', connected: true, canTrade: true, public: false, price: 9.5, ask: 'n/a' },
      { venue: 'd', venueName: 'D', symbol: 'X/USD', connected: true, canTrade: 'unknown', public: false, price: 9 },
    ],
  };
  assert.deepEqual(legsOf(hand).map(l => [l.venue, l.best, l.canTrade, l.ask]), [['a', false, true, null], ['b', true, true, null], ['d', false, 'unknown', null], ['c', false, false, 9.1]]);
  // only a line that takes an order now can be best: a closed market, a key that cannot trade, never; none that can: no best
  const shut = {
    key: 'coin:W', kind: 'coin', at: [
      { venue: 'closed', venueName: 'Closed', symbol: 'W/USD', connected: true, canTrade: true, public: false, open: false, price: 9, ask: 9 },
      { venue: 'watch', venueName: 'Watch only', symbol: 'W/USD', connected: true, canTrade: false, public: false, price: 9.1, ask: 9.1 },
      { venue: 'maybe', venueName: 'Unknown', symbol: 'W/USD', connected: true, canTrade: 'unknown', public: false, price: 9.2, ask: 9.2 },
      { venue: 'open', venueName: 'Open', symbol: 'W/USD', connected: true, canTrade: true, public: false, open: true, price: 9.5, ask: 9.6 },
    ],
  };
  assert.deepEqual(legsOf(shut).map(l => [l.venue, l.best]), [['closed', false], ['watch', false], ['maybe', false], ['open', true]]);
  assert.deepEqual(legsOf({ ...shut, at: shut.at.slice(0, 3) }).map(l => l.best), [false, false, false]);
  assert.deepEqual(legsOf({ key: 'coin:Y', at: [{ venue: 'p', symbol: 'Y/USD', connected: false, public: true, ask: 1 }] }).map(l => l.best), [false]);
  assert.deepEqual(legsOf({ key: 'coin:Z', kind: 'coin' }), []);
  assert.deepEqual(legsOf(null), []);
});

test('rowsOf: the fixture rows and two cn rows side by side; source words; the three sorts; nulls last; a cn row only under All and Stocks', () => {
  const moutai = quote('cn:600519', { price: 1450, change_pct: -3, volume: 900_000_000, source: '同花顺', feed: 'realtime', message: '行情连接已断开，保留上次报价。' });
  const m = markets({
    explore: { all: read(fx('explore-all')) },
    watchlist: [asset('cn:600519', { name: '贵州茅台', exchange: 'SSE' }), asset('cn:000001', { name: '平安银行', exchange: 'SZSE' })],
    quotes: { 'cn:600519': moutai },
    accountQuotes: { 'broker|NVDA': fx('market').market },
    watch: ['coin:BTC'],
  });
  const rows = rowsOf(m);
  assert.deepEqual(rows.map(r => r.id), [
    'stock:NVDA', 'stock:SPY', 'stock:AAPL', 'perp:BTC', 'coin:BTC', 'perp:ETH', 'coin:ETH', 'coin:DOGE', 'perp:SOL', 'coin:SOL',
    'coin:LINK', 'perp:DOGE', 'cn:600519', 'cn:000001',
  ], "Most traded: the Account's rows by their dollars, then the cn rows, whose volume is shares; a row without one last");
  assert.deepEqual(rows.find(r => r.id === 'perp:BTC'), {
    id: 'perp:BTC', source: 'account', kind: 'perp', name: 'BTC perpetual', tile: 'BTC', sub: 'BTC · Perpetual',
    priced: { price: 62498.8, unit: 'usd', changePct: 2.3, change24h: 1404.9, volume: 4121786065, volumeUnit: 'usd', implied: null }, price: 62498.8,
    live: null, sourceWord: 'Stand-in Exchange', closeTime: null, pastEnd: false, paper: false, watched: false, atAccount: false,
    legs: [{ venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', connected: true, paper: false, canTrade: true, public: false, connectTo: '', connector: '', price: 62498.8, bid: 62495.6, ask: 62501.9, best: true }],
    tabs: ['all', 'perps'],
  });
  assert.deepEqual(rows.find(r => r.id === 'cn:600519'), {
    id: 'cn:600519', source: 'face', asset: asset('cn:600519', { name: '贵州茅台', exchange: 'SSE' }), quote: moutai, kind: 'stock', name: '贵州茅台', tile: '600519', sub: 'SSE',
    priced: { price: 1450, unit: 'cny', changePct: -3, change24h: null, volume: 900000000, volumeUnit: 'shares', implied: null }, price: 1450,
    live: null, sourceWord: 'iFinD', closeTime: null, pastEnd: false, paper: false, watched: true, atAccount: false, legs: [], tabs: ['all', 'stocks'],
  });
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  // the latest quote at the row's most traded connected venue rides beside the item's price; the star is the operator's
  assert.deepEqual(byId['stock:NVDA'].live, fx('market').market);
  assert.equal(byId['stock:NVDA'].priced.price, 182.4);
  assert.equal(byId['coin:BTC'].live, null);
  assert.deepEqual(rows.filter(r => r.watched).map(r => r.id), ['coin:BTC', 'cn:600519', 'cn:000001']);
  // the Account's own words for where each price is from, the face's provider for the cn rows; the second line of each
  assert.deepEqual(['stock:NVDA', 'coin:BTC', 'coin:LINK', 'cn:000001'].map(id => byId[id].sourceWord), ['Stand-in Broker', 'Stand-in Exchange', 'Stand-in Public Exchange', 'iFinD']);
  assert.deepEqual(['stock:NVDA', 'coin:BTC', 'perp:ETH', 'cn:000001'].map(id => byId[id].sub), ['Stand-in Broker', 'BTC', 'ETH · Perpetual', 'SZSE']);
  for (const r of rows) for (const word of [r.sub, r.sourceWord]) assert.doesNotMatch(word, CJK, word);
  assert.deepEqual(byId['cn:000001'].priced, { price: null, unit: 'cny', changePct: null, change24h: null, volume: null, volumeUnit: 'shares', implied: null });
  assert.equal(byId['cn:000001'].quote, null);
  // the live quote's own source and stamp say where the price is from and how old it is, on the renderer's clock
  const nasdaq = { ...fx('market').market, quoteFrom: 'Nasdaq · real time', quoteAt: ago(2 * 60_000) };
  assert.equal(rowsOf({ ...m, accountQuotes: { 'broker|NVDA': nasdaq } }, NOW).find(r => r.id === 'stock:NVDA').sourceWord, 'Nasdaq · real time · 2 min ago');

  // the cn rows under Most traded: after every Account row, among themselves by price × volume (turnover), not shares alone
  const turnover = rowsOf(markets({
    explore: { all: read(fx('explore-all')) }, watchlist: [asset('cn:000001'), asset('cn:601318'), asset('cn:600519')],
    quotes: { 'cn:000001': quote('cn:000001', { price: 11.2, volume: 3e8 }), 'cn:601318': quote('cn:601318', { price: 52.1, volume: 9e7 }), 'cn:600519': quote('cn:600519', { price: 1450, volume: 2e6 }) },
  }));
  assert.equal(turnover.slice(0, 12).every(r => r.source === 'account'), true);
  assert.deepEqual(turnover.slice(12).map(r => r.id), ['cn:601318', 'cn:000001', 'cn:600519']);

  // Biggest moves: the size of the 24h move, a tie in the list's order, a row without one last
  assert.deepEqual(rowsOf({ ...m, sort: 'movers' }).map(r => r.id), [
    'coin:DOGE', 'perp:DOGE', 'coin:LINK', 'perp:ETH', 'coin:ETH', 'cn:600519', 'perp:BTC', 'coin:BTC', 'stock:NVDA', 'perp:SOL',
    'coin:SOL', 'stock:AAPL', 'stock:SPY', 'cn:000001',
  ]);
  // Closing soonest: the events by their close, the soonest first, the rows that never close last
  const events = { ...m, explore: { all: read(fx('explore-predictions')) }, sort: 'closing' };
  assert.deepEqual(rowsOf(events).map(r => r.id), [
    'event:predict:SI-BTC15-2610220730', 'event:paper-momentum:SX-YIELD-FRI', 'event:standin-pubevents-public:SX-YIELD-FRI',
    'event:predict:SI-CPI-NEXT', 'event:predict:SI-ETH-WEEK', 'event:paper-momentum:SX-JOBS-NEXT', 'event:standin-pubevents-public:SX-JOBS-NEXT',
    'event:predict:SI-FEDCUT-DEC', 'event:predict:SI-IPO-ANTHROPIC', 'cn:600519', 'cn:000001',
  ]);
  assert.equal(rowsOf(events)[0].closeTime, '2026-10-22T07:45:00.000Z');
  assert.equal(rowsOf(events)[0].sub, 'Crypto', "an event's second line is its category");
  // a cn row is under All and Stocks, and under no other kind's tab
  assert.deepEqual(rowsOf({ ...m, tab: 'stocks' }).map(r => r.id), ['stock:NVDA', 'stock:SPY', 'stock:AAPL', 'cn:600519', 'cn:000001']);
  assert.deepEqual(rowsOf({ ...m, tab: 'crypto' }).map(r => r.id), ['coin:BTC', 'coin:ETH', 'coin:DOGE', 'coin:SOL', 'coin:LINK']);
  assert.deepEqual(rowsOf({ ...m, tab: 'perps' }).map(r => r.id), ['perp:BTC', 'perp:ETH', 'perp:SOL', 'perp:DOGE']);
  for (const tab of ['rwas', 'preipo', 'predictions']) assert.deepEqual(rowsOf({ ...m, tab }), [], tab);
  assert.equal(rowsOf({ ...m, tab: 'somewhere' }).length, 14, 'a tab the view does not know is All');

  // a tab's own read once it lands: its rows, which may lie past All's cut; until then All's rows of that kind
  const all = fx('explore-all');
  const rwas = { ...fx('explore-all'), items: fx('explore-all').movers.filter(i => i.kind === 'rwa') };
  assert.deepEqual(rowsOf({ ...m, tab: 'rwas', explore: { all: read(all), rwas: read(rwas) } }).map(r => [r.id, r.sub]), [['rwa:NVDA', 'Stand-in Stock Tokens'], ['rwa:TSLA', 'Stand-in Stock Tokens']]);
  assert.deepEqual(rowsOf({ ...m, tab: 'rwas', explore: { all: read(all), rwas: { status: 'loading', data: null, at: null } } }), []);
  const solOnly = { ...fx('explore-all'), items: [itemOf(fx('explore-all'), 'coin:SOL')] };
  assert.deepEqual(rowsOf({ ...m, tab: 'crypto', explore: { all: read(all), crypto: read(solOnly) } }).map(r => r.id), ['coin:SOL']);
  // a pre-IPO perpetual's second line says what it is (its implied valuation, or its tab); any other perpetual's names its base
  const anthropic = { key: 'preipo:anthropic', kind: 'perp', name: 'Anthropic', base: 'ANTHROPIC', price: 182.5, implied: { usd: 183e9, unit: 'valuation' }, category: 'Pre-IPO', tabs: ['all', 'preipo'], at: [] };
  const openai = { ...anthropic, key: 'preipo:openai', name: 'OpenAI', base: 'OPENAI', implied: undefined };
  const pre = rowsOf(markets({ explore: { all: read({ ...fx('explore-all'), items: [anthropic, openai, itemOf(fx('explore-all'), 'perp:BTC')] }) } }));
  assert.deepEqual(pre.map(r => [r.id, r.sub]), [['perp:BTC', 'BTC · Perpetual'], ['preipo:anthropic', 'Pre-IPO · Perpetual'], ['preipo:openai', 'Pre-IPO · Perpetual']]);

  // while searching, the Account's rows are its search's and the cn rows its hits alone, never the whole cn watchlist
  const searching = {
    ...m, q: 'ping', results: read({ ...fx('explore-all'), items: [] }),
    search: { query: 'ping', status: 'success', assets: [asset('cn:000001', { name: '平安银行', exchange: 'SZSE' }), asset('cn:601318', { name: '中国平安', exchange: 'SSE' })], partial: false },
    hitQuotes: { 'cn:601318': quote('cn:601318', { price: 52.1, change_pct: 0.4, volume: 5e7 }) },
  };
  assert.deepEqual(rowsOf(searching).map(r => [r.id, r.watched]), [['cn:601318', false], ['cn:000001', true]], 'a hit on the watchlist is starred');
  assert.equal(rowsOf(searching).find(r => r.id === 'cn:601318').priced.price, 52.1, 'a hit takes the quote its search read');
  assert.deepEqual(rowsOf({ ...searching, tab: 'stocks' }).map(r => r.id), ['cn:601318', 'cn:000001']);
  assert.deepEqual(rowsOf({ ...searching, tab: 'crypto' }), []);
  // a search not answered yet leaves the explore rows in place
  assert.equal(rowsOf({ ...searching, results: { status: 'loading', data: null, at: null } }).filter(r => r.source === 'account').length, 12);
  // nothing read at all: the cn rows alone
  assert.deepEqual(rowsOf(markets({ watchlist: m.watchlist, quotes: m.quotes })).map(r => r.id), ['cn:600519', 'cn:000001']);
  assert.deepEqual(rowsOf(undefined), []);
});

test('unpriced, past-end and contract-volume rows: dashes, Closed, contracts', () => {
  const body = fx('explore-predictions');
  body.items = [
    {
      key: 'coin:NEWT', kind: 'coin', name: 'NEWT', base: 'NEWT', tabs: ['all', 'crypto'],
      at: [{ venue: 'newx-public', venueName: 'New Exchange', symbol: 'NEWT/USD', connected: false, canTrade: false, public: true, connectTo: 'newx', connector: 'live:newx' }],
    },
    {
      key: `pm:0x${'ab'.repeat(32)}`, kind: 'event', name: 'Will it rain in Paris on Sunday?', price: 0.12, change24h: -0.01, volumeUsd24h: 18000,
      category: 'Climate', closeTime: '2026-10-20T00:00:00.000Z', pastEnd: true, tabs: ['all', 'predictions'],
      at: [{ venue: 'pm-public', venueName: 'Polymarket', symbol: 'paris-rain:Yes', connected: false, canTrade: false, public: true, price: 0.12, pastEnd: true, connectTo: 'polymarket', connector: 'live:polymarket' }],
    },
    {
      key: 'kalshi:KXFED-DEC', kind: 'event', name: 'Fed cuts in December?', price: 0.62, change24h: 0.03, contracts24h: 412000, volumeUsd24h: 4100000,
      category: 'Economics', closeTime: '2026-12-10T19:00:00.000Z', tabs: ['all', 'predictions'],
      at: [{ venue: 'kalshi', venueName: 'Kalshi', symbol: 'KXFED-DEC:YES', connected: true, canTrade: true, public: false, price: 0.62, bid: 0.61, ask: 0.63 }],
    },
    itemOf(fx('explore-predictions'), 'event:predict:SI-FEDCUT-DEC'),
  ];
  const m = markets({ explore: { all: read(body) }, watchlist: [asset('us:ZZZZ', { name: 'Zed Corp' }), asset('crypto:QQQ/USD')], asked: { 'us:ZZZZ': null, 'crypto:QQQ/USD': null } });
  const pm = body.items[1].key;
  // a contract volume sorts as its number; an unpriced row, and the Not listed lines, after every figure
  assert.deepEqual(rowsOf(m).map(r => r.id), ['event:predict:SI-FEDCUT-DEC', 'kalshi:KXFED-DEC', pm, 'coin:NEWT', 'us:ZZZZ', 'crypto:QQQ/USD']);
  assert.deepEqual(rowsOf({ ...m, sort: 'movers' }).map(r => r.id), ['event:predict:SI-FEDCUT-DEC', 'kalshi:KXFED-DEC', pm, 'coin:NEWT', 'us:ZZZZ', 'crypto:QQQ/USD']);
  assert.deepEqual(rowsOf({ ...m, sort: 'closing' }).map(r => r.id), [pm, 'event:predict:SI-FEDCUT-DEC', 'kalshi:KXFED-DEC', 'coin:NEWT', 'us:ZZZZ', 'crypto:QQQ/USD']);
  const byId = Object.fromEntries(rowsOf(m).map(r => [r.id, r]));
  // unpriced: every figure null, for the renderer's dashes; no venue to quote it, no source to name
  assert.deepEqual(byId['coin:NEWT'].priced, UNPRICED);
  assert.deepEqual([byId['coin:NEWT'].live, byId['coin:NEWT'].sourceWord, byId['coin:NEWT'].sub], [null, '', 'NEWT']);
  // past its end: the flag and the close time, for Closed; still priced in cents
  assert.deepEqual([byId[pm].pastEnd, byId[pm].closeTime, byId[pm].priced.price, byId[pm].priced.change24h, byId[pm].sub], [true, '2026-10-20T00:00:00.000Z', 12, -1, 'Climate']);
  assert.equal(byId['kalshi:KXFED-DEC'].pastEnd, false);
  // Kalshi's volume in contracts, never dollars
  assert.deepEqual([byId['kalshi:KXFED-DEC'].priced.volume, byId['kalshi:KXFED-DEC'].priced.volumeUnit], [412000, 'contracts']);
  assert.deepEqual([byId['event:predict:SI-FEDCUT-DEC'].priced.volume, byId['event:predict:SI-FEDCUT-DEC'].priced.volumeUnit], [1840000, 'usd']);
  // an old star the Account could not find: once, Not listed at the Account, every figure null
  assert.deepEqual(byId['us:ZZZZ'], {
    id: 'us:ZZZZ', source: 'face', notListed: true, kind: 'stock', name: 'Zed Corp', tile: 'Zed Corp', sub: 'Not listed at the Account',
    priced: UNPRICED, price: null, live: null, sourceWord: '', closeTime: null, pastEnd: false, paper: false, watched: true, atAccount: false, legs: [], tabs: ['all', 'stocks'],
  });
  assert.deepEqual([byId['crypto:QQQ/USD'].kind, byId['crypto:QQQ/USD'].name, byId['crypto:QQQ/USD'].tabs], ['coin', 'QQQ/USD', ['all', 'crypto']]);
  assert.deepEqual(rowsOf({ ...m, tab: 'stocks' }).map(r => r.id), ['us:ZZZZ']);
  // nothing here is NaN: a figure is a number or null
  for (const row of rowsOf(m)) for (const [k, v] of Object.entries(row.priced)) assert.ok(v === null || typeof v === 'string' || Number.isFinite(v), `${row.id} ${k}`);
});

test('matchKey and pairsOf', () => {
  assert.deepEqual(matchKey('us:AAPL'), { q: 'AAPL', kind: 'stock' });
  assert.deepEqual(matchKey('us:brk.b'), { q: 'BRK.B', kind: 'stock' });
  assert.deepEqual(matchKey('crypto:BTC/USD'), { q: 'BTC', kind: 'coin' });
  assert.deepEqual(matchKey('crypto:eth-usd'), { q: 'ETH', kind: 'coin' });
  for (const id of ['cn:600519', 'coin:BTC', 'stock:AAPL', 'BTC', '', null, undefined]) assert.equal(matchKey(id), null, String(id));
  // the Account's row keys — every one the stand-in sends, an event at another venue's and a pre-IPO perpetual's among them —
  // and never the face's ids
  for (const key of ['coin:BTC', 'stock:AAPL', 'perp:ETH', 'rwa:NVDA', 'kalshi:KXFED-DEC', `pm:0x${'ab'.repeat(32)}`, 'pmus:fed-dec', 'event:predict:SI-FEDCUT-DEC', 'preipo:anthropic']) assert.equal(isAccountKey(key), true, key);
  for (const body of [fx('explore-all'), fx('explore-predictions')]) for (const item of [...body.items, ...body.movers, ...body.closing, ...body.mostTraded]) assert.equal(isAccountKey(item.key), true, item.key);
  for (const id of ['cn:600519', 'us:AAPL', 'crypto:BTC/USD', 'coinBTC', 'BTC', 'events:x', '', null, undefined]) assert.equal(isAccountKey(id), false, String(id));

  // an old us:/crypto: star: nothing until it is asked; found, it stars the Account's row; not found, the Not listed line; found
  // but in no read, a placeholder that can still be un-starred
  const explore = fx('explore-all');
  const old = [asset('us:AAPL', { name: 'Apple' }), asset('crypto:SOL/USD'), asset('us:ZZZZ'), asset('us:TSLA')];
  assert.deepEqual(rowsOf(markets({ explore: { all: read(explore) }, watchlist: old, tab: 'watching' })), []);
  const asked = { 'us:AAPL': 'stock:AAPL', 'crypto:SOL/USD': 'coin:SOL', 'us:ZZZZ': null, 'us:TSLA': 'stock:TSLA' };
  const after = rowsOf(markets({ explore: { all: read(explore) }, watchlist: old, asked, tab: 'watching' }));
  assert.deepEqual(after.map(r => [r.id, r.source]), [['stock:AAPL', 'account'], ['coin:SOL', 'account'], ['stock:TSLA', 'account'], ['us:ZZZZ', 'face']]);
  assert.deepEqual(after.find(r => r.id === 'stock:TSLA'), {
    id: 'stock:TSLA', source: 'account', placeholder: true, kind: 'stock', name: 'TSLA', tile: 'TSLA', sub: 'Not in this read',
    priced: UNPRICED, price: null, live: null, sourceWord: '', closeTime: null, pastEnd: false, paper: false, watched: true, atAccount: false, legs: [], tabs: ['all', 'watching'],
  });
  assert.equal(rowsOf(markets({ explore: { all: read(explore) }, watchlist: old, asked })).some(r => r.id.startsWith('us:AAPL') || r.id.startsWith('crypto:')), false, 'a star found at the Account draws as its row, never as its old id');
  // a star past the read's items: found among its movers, closing or most traded lists; found nowhere, a placeholder
  const outside = rowsOf(markets({ explore: { all: read(explore) }, tab: 'watching', watch: ['kalshi:KXGONE-26', 'rwa:TSLA', 'event:predict:SI-BTC15-2610220730'] }));
  assert.deepEqual(outside.map(r => [r.id, r.placeholder === true]), [['rwa:TSLA', false], ['event:predict:SI-BTC15-2610220730', false], ['kalshi:KXGONE-26', true]]);
  assert.deepEqual([outside[0].sub, outside[0].priced.price, outside[1].priced.price], ['Stand-in Stock Tokens', 251.3, 14]);
  assert.deepEqual([outside[2].kind, outside[2].name, outside[2].sub], ['kalshi', 'KXGONE-26', 'Not in this read']);

  // pairsOf: the first `limit` rows' most traded connected venue as venue|symbol; a row with none is skipped
  const rows = rowsOf(markets({ explore: { all: read(explore) }, sort: 'movers', watchlist: [asset('cn:600519')], quotes: { 'cn:600519': quote('cn:600519', { change_pct: -3, volume: 3e9 }) } }));
  assert.deepEqual(rows.slice(0, 7).map(r => r.id), ['coin:DOGE', 'perp:DOGE', 'coin:LINK', 'perp:ETH', 'coin:ETH', 'cn:600519', 'perp:BTC']);
  assert.deepEqual(pairsOf(rows, 6), ['paper-momentum|DOGE/USD', 'paper|DOGE/USDC:USDC', 'paper-momentum|LINK/USD', 'ex|ETH/USDT:USDT', 'ex|ETH/USDT']);
  assert.deepEqual(pairsOf(rows), [
    'paper-momentum|DOGE/USD', 'paper|DOGE/USDC:USDC', 'paper-momentum|LINK/USD', 'ex|ETH/USDT:USDT', 'ex|ETH/USDT', 'ex|BTC/USDT:USDT',
    'ex|BTC/USDT', 'broker|NVDA', 'ex|SOL/USDT:USDT', 'ex|SOL/USDT', 'broker|AAPL',
  ], 'twelve rows by default, the cn row among them skipped: the thirteenth (SPY) is not asked');
  assert.deepEqual(pairsOf([{ id: 'coin:Y', legs: legsOf({ at: [{ venue: 'p', symbol: 'Y/USD', connected: false, public: true }] }) }]), []);
  assert.deepEqual(pairsOf([]), []);
  assert.deepEqual(pairsOf(null), []);
});

test('pageOf: the item, its legs, candles for the range, compare rows, held, orders and lines for the market', () => {
  const m = markets({
    explore: { all: read(fx('explore-all')) },
    accountQuotes: { 'broker|NVDA': fx('market').market },
    candles: { 'stock:NVDA': { status: 'ready', data: fx('candles'), at: 1, range: '1D' } },
    compare: { ETH: read(fx('compare')) },
  });
  const acct = accountSlice();
  // stock:NVDA: the chart for its range, the quote at its broker, the shares held, nothing working or stated
  const nvda = pageOf(m, acct, 'stock:NVDA');
  assert.deepEqual(nvda.item, itemOf(fx('explore-all'), 'stock:NVDA'));
  assert.deepEqual(nvda.legs.map(l => `${l.venue}|${l.symbol}`), ['broker|NVDA', 'paper-momentum|NVDA', 'standin-stocks-public|NVDA']);
  assert.deepEqual(nvda.priced, { price: 182.4, unit: 'usd', changePct: 1.9, change24h: 3.4, volume: 31688393074, volumeUnit: 'usd', implied: null });
  assert.deepEqual(nvda.live, fx('market').market);
  assert.equal(nvda.sourceWord, 'Stand-in Broker');
  assert.deepEqual(nvda.candles, fx('candles'));
  assert.equal(nvda.range, '1D');
  assert.deepEqual(nvda.compare, [], 'no compare read for its base');
  assert.deepEqual(nvda.held.assets.map(a => [a.key, a.amount, a.usd]), [['equity:NVDA', 2, 364.8]]);
  assert.deepEqual([nvda.held.positions, nvda.orders, nvda.lines], [[], [], []]);
  assert.equal(pageOf({ ...m, candles: { 'stock:NVDA': { status: 'ready', data: fx('candles'), at: 1, range: '5D' } } }, acct, 'stock:NVDA').range, '5D');
  // a chart read that answered a refusal is no chart; the range chosen stays
  const refused = pageOf({ ...m, candles: { 'stock:NVDA': { status: 'error', data: { ok: false, refusal: { message: 'The venue did not answer' } }, at: 1, range: '5D' } } }, acct, 'stock:NVDA');
  assert.deepEqual([refused.candles, refused.range], [null, '5D']);

  // coin:ETH: the compare rows for its base; no chart read yet, so 1D; the statement's lines that name ETH as a word
  const eth = pageOf(m, acct, 'coin:ETH');
  assert.deepEqual(eth.compare.map(r => [r.venue, r.symbol, r.price, r.best === true]), [['ex', 'ETH/USDT', 2455.75, true], ['wallet', 'WETH/USDC@Base', 2458.55, false]]);
  assert.deepEqual([eth.candles, eth.range, eth.live], [null, '1D', null]);
  assert.deepEqual(eth.held.assets.map(a => [a.key, a.amount]), [['crypto:ETH', 2.153]]);
  assert.deepEqual(eth.lines.map(l => l.description), ['Buy 0.05 ETH · ETH perpetual · market · at 2,456.73'], 'WETH is not ETH');

  // coin:BTC: its open order at a leg (the canceled one is not working), the two lines that name it, newest first
  const btc = pageOf(m, acct, 'coin:BTC');
  assert.deepEqual(btc.orders.map(o => [o.id, o.venue, o.symbol, o.side, o.status, o.who]), [['ord-0003', 'ex', 'BTC/USDT', 'sell', 'open', 'You']]);
  assert.deepEqual(btc.lines.map(l => l.description), ['Buy 0.001 BTC · BTC / USDT · limit 59,352.9', 'Sell 0.002 BTC · BTC / USDT · limit 63,226.6']);
  assert.deepEqual(btc.held.assets.map(a => [a.key, a.amount]), [['crypto:BTC', 0.124]]);
  assert.deepEqual(btc.held.positions, [], 'the BTC perpetual is held at another symbol');
  // perp:BTC: the position at its own leg
  assert.deepEqual(pageOf(m, acct, 'perp:BTC').held.positions.map(p => [p.venue, p.symbol, p.side, p.qty, p.paper]), [['ex', 'BTC/USDT:USDT', 'long', 0.01, false]]);

  // rwa:TSLA, past the read's items (among its movers), only public listings carry: the quote at its first public line, the one
  // the page follows, with that quote's own source and age on the renderer's clock; a row asks /quotes at a connected venue only
  const tokens = { price: 251.4, bid: 251.2, ask: 251.6, quoteFrom: 'Stand-in Stock Tokens · live', quoteAt: ago(90_000) };
  const tsla = pageOf({ ...m, accountQuotes: { 'standin-stock-tokens|TSLA': tokens } }, acct, 'rwa:TSLA', NOW);
  assert.equal(tsla.item.name, 'Tesla stock token');
  assert.deepEqual(tsla.live, tokens);
  assert.equal(tsla.sourceWord, 'Stand-in Stock Tokens · live · 1 min ago');
  const rwas = { ...fx('explore-all'), items: fx('explore-all').movers.filter(i => i.kind === 'rwa') };
  assert.equal(rowsOf({ ...m, tab: 'rwas', explore: { all: read(fx('explore-all')), rwas: read(rwas) }, accountQuotes: { 'standin-stock-tokens|TSLA': tokens } }).find(r => r.id === 'rwa:TSLA').live, null);
  // a market only the current tab's own read lists
  const pepe = { key: 'coin:PEPE', kind: 'coin', name: 'PEPE', base: 'PEPE', price: 0.0000091, tabs: ['all', 'crypto'], at: [] };
  assert.equal(pageOf({ ...m, tab: 'crypto', explore: { all: read(fx('explore-all')), crypto: read({ ...fx('explore-all'), items: [pepe] }) } }, acct, 'coin:PEPE').item.name, 'PEPE');

  // an event: no base to hold as an asset; every outcome's lines — its YES and its NO — name its positions, orders and lines;
  // its own lines stay the lead outcome's; its price in cents
  const fed = pageOf(markets({ explore: { all: read(fx('explore-predictions')) } }), acct, 'event:predict:SI-FEDCUT-DEC');
  assert.deepEqual(fed.held.assets, []);
  assert.deepEqual(fed.held.positions.map(p => [p.venue, p.symbol, p.qty]), [['predict', 'SI-FEDCUT-DEC:YES', 50]]);
  assert.deepEqual(fed.lines.map(l => l.key), ['order:49864860e7f081d0fb8212efe0705c4f']);
  assert.deepEqual([fed.priced.price, fed.priced.unit, fed.compare], [62, 'cents', []]);
  const holdingsNo = fx('holdings');
  holdingsNo.positions.push({ venue: 'predict', venueName: 'Stand-in Predictions', symbol: 'SI-FEDCUT-DEC:NO', name: 'Will the Fed cut rates at its December meeting? · No', kind: 'event', side: 'long', qty: 20, entryPrice: 0.39, markPrice: 0.38, usd: 7.6 });
  const pageNo = fx('account');
  pageNo.orders.unshift({ id: 'ord-0011', venue: 'predict', venueName: 'Stand-in Predictions', symbol: 'SI-FEDCUT-DEC:NO', side: 'buy', type: 'limit', qty: 10, filledQty: 0, limitPrice: 0.35, status: 'open', authority: 'owner' });
  const statementNo = fx('statement');
  statementNo.lines.unshift({
    key: 'order:no-side', id: 'ord-0011', at: '2026-10-22T07:40:00.000Z', updatedAt: '2026-10-22T07:40:00.000Z', type: 'trade', kind: 'buy', account: 'predict',
    accountName: 'Stand-in Predictions', description: 'Buy 10 SI-FEDCUT-DEC:NO · Will the Fed cut rates at its December meeting? · No · limit 0.35', amountUsd: 0, status: 'open', by: 'You',
  });
  const both = pageOf(markets({ explore: { all: read(fx('explore-predictions')) } }), accountSlice({ data: pageNo, holdings: read(holdingsNo), statement: read(statementNo) }), 'event:predict:SI-FEDCUT-DEC');
  assert.deepEqual(both.held.positions.map(p => p.symbol), ['SI-FEDCUT-DEC:YES', 'SI-FEDCUT-DEC:NO']);
  assert.deepEqual(both.orders.map(o => [o.id, o.symbol]), [['ord-0011', 'SI-FEDCUT-DEC:NO']]);
  assert.deepEqual(both.lines.map(l => l.key), ['order:no-side', 'order:49864860e7f081d0fb8212efe0705c4f']);
  assert.deepEqual(both.legs.map(l => l.symbol), ['SI-FEDCUT-DEC:YES']);

  // the leading lens: real money leads here; with none and a paper venue connected, the paper account's rows are what is held
  const paper = fx('holdings-paper');
  paper.rows.push({ key: 'crypto:BTC', asset: 'BTC', class: 'crypto', amount: 0.05, usd: 3124, venues: [{ venue: 'paper-momentum', venueName: 'Momentum · paper', amount: 0.05, usd: 3124 }] });
  assert.deepEqual(pageOf(m, accountSlice({ paper: read(paper) }), 'coin:BTC').held.assets.map(a => a.amount), [0.124]);
  assert.deepEqual(pageOf(m, accountSlice({ data: { ...fx('account'), totalUsd: 0 }, paper: read(paper) }), 'coin:BTC').held.assets.map(a => a.amount), [0.05]);

  // a market the search found; one no read lists, or a face id, is no page
  const searched = markets({ explore: { all: read(fx('explore-all')) }, q: 'cpi', results: read(fx('explore-predictions')) });
  assert.equal(pageOf(searched, acct, 'event:predict:SI-CPI-NEXT').item.name, 'Will US inflation come in above 3.0% in the next CPI report?');
  for (const id of ['stock:TSLA', 'cn:600519', '', undefined]) assert.equal(pageOf(m, acct, id), null, String(id));
  assert.equal(pageOf(markets(), acct, 'coin:BTC'), null);
  // the account not read yet: the page still draws, holding nothing
  const idle = { status: 'idle', data: null, at: null, holdings: { status: 'idle', data: null, at: null }, paper: { status: 'idle', data: null, at: null }, statement: { status: 'idle', data: null, at: null } };
  for (const a of [idle, undefined]) {
    const bare = pageOf(m, a, 'coin:BTC');
    assert.deepEqual([bare.held.assets, bare.held.positions, bare.orders, bare.lines], [[], [], [], []]);
  }
});

test('tableOf: the tabs counted once All answers, the sort in effect, the read the rows are from', () => {
  // before All's read: All alone, with no count it never read; the read on its way
  const unread = tableOf(markets({ explore: { all: { status: 'loading', data: null, at: null } } }), NOW);
  assert.deepEqual([unread.rows, unread.tabs, unread.read], [[], [{ id: 'all', label: 'All', count: null }], { status: 'loading', answered: false, message: null }]);
  // All answered: the Account's counts, the A shares among them; Watching once anything is starred
  const m = markets({ explore: { all: read(fx('explore-all')) }, watchlist: [asset('cn:600519')] });
  const t = tableOf(m, NOW);
  assert.deepEqual(t.tabs.map(x => [x.id, x.count]), [['all', 31], ['crypto', 6], ['stocks', 5], ['rwas', 4], ['perps', 6], ['preipo', 1], ['predictions', 9], ['watching', null]]);
  assert.deepEqual(t.read, { status: 'ready', answered: true, message: null });
  assert.deepEqual(t.rows, rowsOf(m, NOW));
  // the sort in effect: the kept one when the rows offer it, else Most traded
  assert.deepEqual([t.sorts.map(s => s.id), t.sort], [['volume', 'movers'], 'volume']);
  assert.deepEqual(tableOf({ ...m, sort: 'movers' }, NOW).sort, 'movers');
  const closing = tableOf({ ...m, sort: 'closing' }, NOW);
  assert.deepEqual([closing.sort, closing.rows.map(r => r.id)], ['volume', t.rows.map(r => r.id)]);
  const events = tableOf({ ...m, explore: { all: read(fx('explore-predictions')) }, sort: 'closing' }, NOW);
  assert.deepEqual([events.sorts.map(s => s.id), events.sort, events.rows[0].id], [['volume', 'movers', 'closing'], 'closing', 'event:predict:SI-BTC15-2610220730']);
  assert.deepEqual(sortsOf([], 'closing'), { sorts: ACCOUNT_SORTS.slice(0, 2), sort: 'volume' });
  // the read the rows are from: a kind's own once it has answered, else All's, its sentence with it; while searching, the search's
  const refused = { ...read(fx('explore-all')), status: 'error', message: 'All refused' };
  assert.deepEqual(tableOf({ ...m, tab: 'crypto', explore: { all: refused, crypto: { status: 'loading', data: null, at: null } } }, NOW).read, { status: 'error', answered: true, message: 'All refused' });
  assert.deepEqual(tableOf({ ...m, tab: 'crypto', explore: { all: refused, crypto: read(fx('explore-all')) } }, NOW).read, { status: 'ready', answered: true, message: null });
  assert.deepEqual(tableOf({ ...m, q: 'fed', tab: 'results', results: { status: 'error', data: null, at: 1, message: 'Too many searches' } }, NOW).read, { status: 'error', answered: false, message: 'Too many searches' });
  // each row says the price it shows and the word its tile is lettered from
  const live = tableOf({ ...m, accountQuotes: { 'broker|NVDA': { price: 183.1 } } }, NOW).rows.find(r => r.id === 'stock:NVDA');
  assert.deepEqual([live.price, live.priced.price, live.tile, live.paper], [183.1, 182.4, 'NVDA', false]);
  const doge = t.rows.find(r => r.id === 'coin:DOGE');
  assert.deepEqual([doge.tile, doge.paper], ['DOGE', true], 'a coin only a paper account trades first');
  const fedRow = tableOf(markets({ explore: { all: read(fx('explore-predictions')) }, accountQuotes: { 'predict|SI-FEDCUT-DEC:YES': { price: 0.64 } } }), NOW).rows.find(r => r.id === 'event:predict:SI-FEDCUT-DEC');
  assert.deepEqual([fedRow.price, fedRow.priced.price, fedRow.tile], [64, 62, 'Economics'], "an event's quote in cents");
});

test("pageOf: the price shown, the page's words, its history's state and the read each part stands on", () => {
  const m = markets({
    explore: { all: read(fx('explore-all')) }, watch: ['coin:BTC'],
    accountQuotes: { 'ex|BTC/USDT': { price: 62510.5, quoteFrom: 'Stand-in Exchange · live', quoteAt: ago(90_000) } },
    candles: { 'coin:BTC': { status: 'error', data: null, at: 1, range: '5D', message: 'No history at this range.' } },
  });
  const btc = pageOf(m, accountSlice(), 'coin:BTC', NOW);
  assert.deepEqual([btc.price, btc.name, btc.tile, btc.sub, btc.closesAt, btc.outcomes, btc.preipo, btc.watched], [62510.5, 'BTC', 'BTC', ['Crypto', 'BTC/USDT'], null, [], false, true]);
  assert.deepEqual(btc.about, { symbol: 'BTC', name: 'BTC' });
  assert.deepEqual(btc.history, { status: 'error', message: 'No history at this range.', current: false });
  assert.deepEqual(btc.reads, { held: { answered: true, failed: false, message: null, unreadable: false }, orders: { answered: true, failed: false, message: null, unreadable: false }, lines: { answered: true, failed: false, message: null } });
  // starred as an old star found at the Account; not starred at all
  assert.equal(pageOf({ ...m, watch: [], watchlist: [asset('crypto:BTC/USD')], asked: { 'crypto:BTC/USD': 'coin:BTC' } }, accountSlice(), 'coin:BTC', NOW).watched, true);
  assert.equal(pageOf({ ...m, watch: [] }, accountSlice(), 'coin:BTC', NOW).watched, true, "the Account's own list watches it");
  assert.equal(pageOf({ ...m, watch: [] }, accountSlice({ data: { ...fx('account'), watch: [] } }), 'coin:BTC', NOW).watched, false);
  // the candles kept are the range's own while it is read again; a stock's sub names its broker's symbol
  const nvda = pageOf({ ...m, candles: { 'stock:NVDA': { status: 'loading', data: fx('candles'), at: 1, range: '1D' } } }, accountSlice(), 'stock:NVDA', NOW);
  assert.deepEqual([nvda.history, nvda.sub, nvda.price], [{ status: 'loading', message: null, current: true }, ['Stock', 'NVDA'], 182.4]);
  assert.equal(pageOf({ ...m, candles: { 'stock:NVDA': { status: 'ready', data: fx('candles'), at: 1, range: '5D' } } }, accountSlice(), 'stock:NVDA', NOW).history.current, false, "the 1D closes are not 5D's");
  // an event: its category and close, its outcomes in cents, its lines' prices in cents, found by its name
  const fed = pageOf(markets({ explore: { all: read(fx('explore-predictions')) }, accountQuotes: { 'predict|SI-FEDCUT-DEC:YES': { price: 0.64 } } }), accountSlice(), 'event:predict:SI-FEDCUT-DEC', NOW);
  assert.deepEqual([fed.price, fed.tile, fed.sub, fed.closesAt], [64, 'Economics', ['Economics'], '2026-10-31T10:35:46.773Z']);
  assert.deepEqual(fed.outcomes, [{ label: 'Yes', cents: 62 }, { label: 'No', cents: 38 }]);
  assert.deepEqual(fed.legs.map(l => [l.price, l.bid, l.ask]), [[62, 61, 63]]);
  assert.deepEqual(fed.about, { name: 'Will the Fed cut rates at its December meeting?' });
  // a pre-IPO perpetual says so; an outcome named as a person says it
  const preipo = {
    key: 'preipo:anthropic', kind: 'perp', name: 'Anthropic perpetual', base: 'ANTH', implied: { usd: 2.1e11, unit: 'valuation' }, tabs: ['all', 'preipo'],
    at: [{ venue: 'hl-public', venueName: 'Hyperliquid', symbol: 'ANTH-PERP', connected: false, canTrade: false, public: true, price: 210 }],
  };
  const up = { key: 'event:predict:UPDOWN', kind: 'event', name: 'Up or down', category: '', tabs: ['all', 'predictions'], outcomes: [{ label: 'UP', price: 0.14 }, { label: 'DOWN', price: 0.86 }], at: [] };
  const odd = markets({ explore: { all: read({ ...fx('explore-all'), items: [preipo, up] }) } });
  const anth = pageOf(odd, undefined, 'preipo:anthropic', NOW);
  assert.deepEqual([anth.preipo, anth.sub, anth.tile], [true, ['Pre-IPO', 'ANTH-PERP'], 'ANTH']);
  const updown = pageOf(odd, undefined, 'event:predict:UPDOWN', NOW);
  assert.deepEqual([updown.outcomes, updown.tile, updown.sub], [[{ label: 'Up', cents: 14 }, { label: 'Down', cents: 86 }], 'Event', []]);
  // what each part stands on: nothing read; the page alone, which names paper venues, so what is held waits for its lens too; a
  // read that failed, the page's with its sentence
  const idle = { status: 'idle', data: null, at: null, message: null, holdings: { status: 'idle', data: null }, paper: { status: 'idle', data: null }, statement: { status: 'idle', data: null } };
  const no = { answered: false, failed: false, message: null };
  // what is held and the orders stand on the page as well: each says whether the page that landed is one the face cannot read
  const noPage = { ...no, unreadable: false };
  assert.deepEqual(pageOf(m, idle, 'coin:BTC', NOW).reads, { held: noPage, orders: noPage, lines: no });
  assert.deepEqual(pageOf(m, undefined, 'coin:BTC', NOW).reads, { held: noPage, orders: noPage, lines: no });
  const paged = { ...idle, status: 'ready', data: fx('account'), holdings: read(fx('holdings')) };
  assert.deepEqual(pageOf(m, paged, 'coin:BTC', NOW).reads.held, noPage, 'the paper lens not read yet');
  assert.deepEqual(pageOf(m, { ...paged, paper: read(fx('holdings-paper')) }, 'coin:BTC', NOW).reads.held, { answered: true, failed: false, message: null, unreadable: false });
  const refused = { ...idle, status: 'error', message: 'The account is restarting', statement: { status: 'error', data: null } };
  assert.deepEqual(pageOf(m, refused, 'coin:BTC', NOW).reads, {
    held: noPage, orders: { answered: false, failed: true, message: 'The account is restarting', unreadable: false }, lines: { answered: false, failed: true, message: null },
  });
  // a page that landed as one the face does not recognise (the Account moved its API): the orders are unreadable — failed, with
  // no sentence — never still loading; and so is what is held, the holdings read or not, since which lens leads is the page's to say
  const moved = { ...idle, status: 'ready', data: { ...fx('account'), venues: undefined } };
  assert.deepEqual(pageOf(m, moved, 'coin:BTC', NOW).reads.orders, { answered: false, failed: true, message: null, unreadable: true });
  assert.deepEqual(pageOf(m, moved, 'coin:BTC', NOW).reads.held, { answered: false, failed: true, message: null, unreadable: true });
  assert.deepEqual(pageOf(m, { ...moved, holdings: read(fx('holdings')), paper: read(fx('holdings-paper')) }, 'coin:BTC', NOW).reads.held,
    { answered: false, failed: true, message: null, unreadable: true }, 'never the real lens in its place');
  // the holdings' and the statement's own sentences when they refused (their reads keep them): You hold and On the statement say them
  const said = { ...accountSlice(), holdings: { status: 'error', data: null, message: 'Venues are still settling.' }, statement: { status: 'error', data: fx('statement'), message: 'The statement is being rebuilt.' } };
  assert.deepEqual(pageOf(m, said, 'coin:BTC', NOW).reads, {
    held: { answered: false, failed: true, message: 'Venues are still settling.', unreadable: false },
    orders: { answered: true, failed: false, message: null, unreadable: false },
    lines: { answered: true, failed: true, message: 'The statement is being rebuilt.' },
  });
  // what is held stands on the paper lens too: its sentence when it refused; a sentence a read kept from an earlier refusal while
  // it is read again is not said
  const lensSaid = { ...accountSlice(), paper: { status: 'error', data: null, message: 'The paper book is being rebuilt.' } };
  assert.deepEqual(pageOf(m, lensSaid, 'coin:BTC', NOW).reads.held, { answered: false, failed: true, message: 'The paper book is being rebuilt.', unreadable: false });
  const again = { ...lensSaid, holdings: { status: 'loading', data: fx('holdings'), message: 'Venues are still settling.' } };
  assert.equal(pageOf(m, again, 'coin:BTC', NOW).reads.held.message, 'The paper book is being rebuilt.');
});

// what a star press acts on: whether the market is starred as its star is drawn (rowsOf's and pageOf's `watched`)
test('watchedOf: an Account key starred by the operator or found for an old star still listed; a face id on the cn list; nothing else', () => {
  const m = markets({ watch: ['coin:BTC'], watchlist: [asset('cn:600519'), asset('us:AAPL')], asked: { 'us:AAPL': 'stock:AAPL' } });
  assert.equal(watchedOf(m, 'coin:BTC'), true, "the operator's own");
  assert.equal(watchedOf(m, 'stock:AAPL'), true, 'an old star found at the Account and still on the cn list');
  assert.equal(watchedOf(m, 'coin:ETH'), false);
  assert.equal(watchedOf(m, 'cn:600519'), true);
  assert.equal(watchedOf(m, 'us:aapl'), true, 'a face id, canonicalised');
  assert.equal(watchedOf(m, 'cn:000001'), false);
  assert.equal(watchedOf({ ...m, watchlist: [asset('cn:600519')] }, 'stock:AAPL'), false, 'a find whose old star has gone stars nothing by itself');
  for (const id of ['garbage', '', null, undefined]) assert.equal(watchedOf(m, id), false, String(id));
  assert.equal(watchedOf(undefined, 'coin:BTC'), false);
  // the same as the page draws it
  const btc = markets({ explore: { all: read(fx('explore-all')) }, watch: ['coin:BTC'] });
  assert.equal(watchedOf(btc, 'coin:BTC'), pageOf(btc, accountSlice(), 'coin:BTC', NOW).watched);
});

// every row an explore answer carries: its items, then the lists beside them
const everyRowOf = body => [...body.items, ...body.movers, ...body.closing, ...body.mostTraded];

test("watchKeysOf: the page's own watch list as Account keys, through the lines the explore rows list; one no read lists left out", () => {
  const page = fx('account');
  const rows = everyRowOf(fx('explore-all'));
  // ex BTC/USDT at its connected line; DOGE/USD at standin-pubex, the venue its public listing connects to; the Fed cut no read
  // here lists
  assert.deepEqual(watchKeysOf(page, rows), ['coin:BTC', 'coin:DOGE']);
  const predictions = fx('explore-predictions');
  assert.deepEqual(watchKeysOf(page, [...rows, ...predictions.items]), ['coin:BTC', 'event:predict:SI-FEDCUT-DEC', 'coin:DOGE']);
  // an outcome's own line names its event; a line at a venue by its own id too
  const at = '2026-10-22T07:35:46.839Z';
  assert.deepEqual(watchKeysOf({ ...page, watch: [{ venue: 'predict', symbol: 'SI-FEDCUT-DEC:NO', at }] }, predictions.items), ['event:predict:SI-FEDCUT-DEC']);
  assert.deepEqual(watchKeysOf({ ...page, watch: [{ venue: 'standin-pubex-public', symbol: 'DOGE/USD', at }] }, rows), ['coin:DOGE']);
  // a symbol at a venue that does not list it, an entry not a market, a page not recognised, no rows: nothing
  assert.deepEqual(watchKeysOf({ ...page, watch: [{ venue: 'broker', symbol: 'BTC/USDT', at }] }, rows), []);
  assert.deepEqual(watchKeysOf({ ...page, watch: [null, 'ex', { venue: 'ex' }, { venue: 'ex', symbol: 42 }, { venue: '', symbol: 'BTC/USDT' }] }, rows), []);
  assert.deepEqual(watchKeysOf({ ok: false, watch: page.watch }, rows), []);
  for (const p of [null, undefined, {}]) assert.deepEqual(watchKeysOf(p, rows), [], String(p));
  assert.deepEqual(watchKeysOf(page, null), []);
});

test("Watching is the Account's list and the face's together: watchedOf, the rows' watched, the tab, a market's page", () => {
  const page = fx('account');
  const explore = fx('explore-all');
  const m = markets({ explore: { all: read(explore) }, watch: ['stock:AAPL', 'coin:BTC'], watchlist: [asset('cn:600519')] });
  assert.equal(watchedOf(m, 'coin:DOGE'), false, "the face's list alone");
  assert.equal(watchedOf(m, 'coin:DOGE', page), true, "the Account's list too");
  assert.equal(watchedOf(m, 'coin:ETH', page), false);
  assert.equal(watchedOf(m, 'cn:600519', page), true, 'a cn id: the face’s list');
  // Watching: the face's stars, the page's beside them, the A shares; a row on the Account's list alone says so
  const watching = rowsOf({ ...m, tab: 'watching' }, NOW, page);
  assert.deepEqual(watching.map(r => [r.id, r.watched, r.atAccount === true]), [
    ['stock:AAPL', true, false], ['coin:BTC', true, false], ['coin:DOGE', true, true], ['cn:600519', true, false],
  ]);
  assert.equal(watching.some(r => r.placeholder === true), false);
  // All: the page's rows starred among the rest
  const all = rowsOf(m, NOW, page);
  assert.deepEqual(all.filter(r => r.watched).map(r => r.id).sort(), ['cn:600519', 'coin:BTC', 'coin:DOGE', 'stock:AAPL']);
  assert.deepEqual(all.filter(r => r.atAccount === true).map(r => r.id), ['coin:DOGE']);
  assert.equal(rowsOf(m, NOW).find(r => r.id === 'coin:DOGE').watched, false, 'no page: the face’s list as before');
  // the Watching tab for the page's list alone
  const bare = markets({ explore: { all: read(explore) } });
  assert.equal(tableOf(bare, NOW).tabs.some(t => t.id === 'watching'), false);
  assert.equal(tableOf(bare, NOW, page).tabs.at(-1).id, 'watching');
  assert.deepEqual(rowsOf({ ...bare, tab: 'watching' }, NOW, page).map(r => r.id), ['coin:BTC', 'coin:DOGE']);
  // a page-watched market only a kind's read lists is found there, never a placeholder (the rows by Most traded)
  const both = markets({ explore: { all: read(explore), predictions: read(fx('explore-predictions')) }, tab: 'watching' });
  assert.deepEqual(rowsOf(both, NOW, page).map(r => [r.id, r.placeholder === true]), [['coin:BTC', false], ['coin:DOGE', false], ['event:predict:SI-FEDCUT-DEC', false]]);
  // a market's page reads it watched the same way
  assert.equal(pageOf(bare, accountSlice(), 'coin:DOGE', NOW).watched, true);
  assert.equal(pageOf(bare, accountSlice(), 'coin:ETH', NOW).watched, false);
  assert.equal(watchedOf(bare, 'coin:DOGE', page), pageOf(bare, accountSlice(), 'coin:DOGE', NOW).watched);
});

test('setWatchOf: what a star signs — on, the followed line (a public listing by the venue it connects to); off, the page’s own entry', () => {
  const page = fx('account');
  const explore = fx('explore-all');
  // a stock listed only at a public source that connects to nothing: no line to watch at
  explore.items.push({
    key: 'stock:QQQ', kind: 'stock', name: 'QQQ', base: 'QQQ', tabs: ['all', 'stocks'],
    at: [{ venue: 'standin-stocks-public', venueName: 'Stand-in Stocks', symbol: 'QQQ', connected: false, public: true }],
  });
  const m = markets({ explore: { all: read(explore) } });
  assert.deepEqual(setWatchOf(m, page, 'coin:BTC'), { on: { venue: 'ex', symbol: 'BTC/USDT' }, off: { venue: 'ex', symbol: 'BTC/USDT' } });
  // watched at the public listing's venue, followed at its first connected line: off names the entry as the page keeps it
  assert.deepEqual(setWatchOf(m, page, 'coin:DOGE'), { on: { venue: 'paper-momentum', symbol: 'DOGE/USD' }, off: { venue: 'standin-pubex', symbol: 'DOGE/USD' } });
  assert.deepEqual(setWatchOf(m, page, 'coin:ETH'), { on: { venue: 'ex', symbol: 'ETH/USDT' }, off: null });
  assert.deepEqual(setWatchOf(m, page, 'rwa:TSLA'), { on: { venue: 'standin-stock-tokens', symbol: 'TSLA' }, off: null });
  assert.deepEqual(setWatchOf(m, page, 'stock:QQQ'), { on: null, off: null });
  assert.deepEqual(setWatchOf(m, null, 'coin:BTC'), { on: { venue: 'ex', symbol: 'BTC/USDT' }, off: null });
  for (const id of ['coin:GONE', 'cn:600519', '', null]) assert.deepEqual(setWatchOf(m, page, id), { on: null, off: null }, String(id));
  // a refusal is kept as the Account's sentence, and said as it is
  assert.equal(watchWord('ETH/USDT is not listed at Stand-in Exchange.'), 'ETH/USDT is not listed at Stand-in Exchange.');
  for (const v of [42, {}, undefined]) assert.equal(watchWord(v), '');
});

test('no icon URL survives any view (an item given an https icon by hand)', () => {
  const ICON = 'https://logos.example-cdn.com/btc.png';
  const explore = fx('explore-all');
  const btc = itemOf(explore, 'coin:BTC');
  btc.icon = ICON;
  btc.at[0].icon = ICON;
  const avax = explore.movers.find(i => i.key === 'coin:AVAX');
  avax.icon = ICON;
  const predictions = fx('explore-predictions');
  const fed = itemOf(predictions, 'event:predict:SI-FEDCUT-DEC');
  fed.icon = ICON;
  fed.outcomes[0].icon = ICON;
  // and on what the views pass through: a quote, a compare row, a chart
  const quoteBtc = { price: 62481, quoteFrom: 'Stand-in Exchange', icon: ICON };
  const compare = fx('compare');
  compare.rows[0].icon = ICON;
  const candles = fx('candles');
  candles.icon = ICON;
  candles.candles[0].icon = ICON;
  const m = markets({
    explore: { all: read(explore) }, results: read(predictions), q: 'fed', watch: ['coin:BTC', 'coin:AVAX', fed.key, 'stock:GONE'],
    watchlist: [asset('cn:600519')], accountQuotes: { 'ex|BTC/USDT': quoteBtc }, compare: { ETH: read(compare) },
    candles: { 'stock:NVDA': { status: 'ready', data: candles, at: 1, range: '1D' } },
  });
  const acct = accountSlice();
  const outputs = [
    tabsOf(explore, 1, { searching: true, watching: true }), priceOf(btc), sourceWordOf(btc, NOW), legsOf(btc), priceOf(fed), sourceWordOf(fed, NOW), legsOf(fed),
    matchKey('crypto:BTC/USD'),
  ];
  for (const q of ['', 'fed']) {
    for (const id of ['coin:BTC', 'coin:AVAX', 'coin:ETH', 'stock:NVDA', fed.key]) outputs.push(pageOf({ ...m, q }, acct, id, NOW));
    for (const tab of ['all', 'crypto', 'predictions', 'watching', 'results']) for (const { id: sort } of ACCOUNT_SORTS) {
      const rows = rowsOf({ ...m, q, tab, sort }, NOW);
      outputs.push(rows, pairsOf(rows));
    }
  }
  // the views had each of them to look through: the item and its lines, the quote, the compare rows, the chart, a placeholder
  const calm = { ...m, q: '' };
  assert.equal(pageOf(calm, acct, 'coin:BTC', NOW).live.price, 62481);
  assert.equal(pageOf(calm, acct, 'coin:ETH', NOW).compare.length, 2);
  assert.equal(pageOf(calm, acct, 'stock:NVDA', NOW).candles.candles.length, 12);
  assert.equal(rowsOf({ ...calm, tab: 'watching' }, NOW).find(r => r.id === 'coin:BTC').live.price, 62481);
  assert.equal(rowsOf({ ...calm, tab: 'watching' }, NOW).some(r => r.placeholder === true), true);
  for (const out of outputs) {
    const text = JSON.stringify(out) ?? '';
    assert.ok(!text.includes('example-cdn'), text.slice(0, 160));
    assert.ok(!text.includes('"icon"'), text.slice(0, 160));
  }
  // the views copy what they leave out: the store's own values keep their icons
  assert.deepEqual([btc.icon, btc.at[0].icon, avax.icon, fed.icon, fed.outcomes[0].icon, quoteBtc.icon, compare.rows[0].icon, candles.icon, candles.candles[0].icon], Array(9).fill(ICON));
});

// ── What Hand to Gravit says of a market ──

test('handWordsOf: an Account key by its base and name; a face id by its watchlist or search asset, else its own; anything else null', () => {
  const m = markets({
    explore: { all: read(fx('explore-all')), predictions: read(fx('explore-predictions')) },
    watchlist: [asset('cn:600519', { name: 'Kweichow Moutai', exchange: 'SH' }), asset('us:AAPL', { name: 'Apple' })],
    search: { query: '0000', status: 'success', assets: [asset('cn:000001', { name: 'Ping An Bank', exchange: 'SZ' })], partial: false },
  });
  const acct = accountSlice();
  // the Account's, from its page's item: its base and its name; an event has no base, so its name is both
  assert.deepEqual(handWordsOf(m, acct, 'stock:NVDA', NOW), { symbol: 'NVDA', name: 'NVIDIA Corporation common stock' });
  assert.deepEqual(handWordsOf(m, acct, 'coin:BTC', NOW), { symbol: 'BTC', name: 'BTC' });
  const fed = 'Will the Fed cut rates at its December meeting?';
  assert.deepEqual(handWordsOf({ ...m, tab: 'predictions' }, acct, 'event:predict:SI-FEDCUT-DEC', NOW), { symbol: fed, name: fed });
  assert.deepEqual(handWordsOf(m, undefined, 'perp:ETH'), { symbol: 'ETH', name: 'ETH perpetual' }, 'the account not read changes nothing');
  // a market no read lists: nothing to hand
  assert.equal(handWordsOf(m, acct, 'coin:GONE', NOW), null);
  // the face's: the watchlist's asset, else the search's, else the id's own — the id canonicalised
  assert.deepEqual(handWordsOf(m, acct, 'cn:600519', NOW), { symbol: '600519', name: 'Kweichow Moutai' });
  assert.deepEqual(handWordsOf(m, acct, 'us:aapl', NOW), { symbol: 'AAPL', name: 'Apple' });
  assert.deepEqual(handWordsOf(m, acct, 'cn:000001', NOW), { symbol: '000001', name: 'Ping An Bank' });
  assert.deepEqual(handWordsOf(m, acct, 'crypto:eth-usd', NOW), { symbol: 'ETH/USD', name: 'ETH/USD' });
  for (const id of ['garbage', '', null, undefined]) assert.equal(handWordsOf(m, acct, id, NOW), null, String(id));
  // faceAssetOf: the asset a face id names, its exchange and currency with it; nothing for an Account key
  assert.deepEqual(faceAssetOf(m, 'cn:600519'), { id: 'cn:600519', market: 'cn', symbol: '600519', name: 'Kweichow Moutai', exchange: 'SH', currency: 'CNY' });
  assert.deepEqual(faceAssetOf(markets(), 'us:MSFT'), { id: 'us:MSFT', market: 'us', symbol: 'MSFT', name: 'MSFT', exchange: '', currency: 'USD' });
  assert.equal(faceAssetOf(m, 'coin:BTC'), null);
  assert.equal(faceAssetOf(undefined, 'cn:600519').symbol, '600519');
  // the Account's candle ranges, in its order
  assert.deepEqual(CANDLE_RANGES, ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX']);
});

// ── The face's own ids and words ──

test('canonicalId: us:aapl → us:AAPL, crypto:btc-usd → crypto:BTC/USD; BTC, or an Account key, → null', () => {
  assert.equal(canonicalId('us:aapl'), 'us:AAPL');
  assert.equal(canonicalId('crypto:btc-usd'), 'crypto:BTC/USD');
  assert.equal(canonicalId('cn:600519'), 'cn:600519');
  for (const bad of ['BTC', '', 'us:', 'fx:EURUSD', 'coin:BTC', null, undefined]) assert.equal(canonicalId(bad), null, String(bad));
});

test('every word is English, and each enum reads as it should', () => {
  const words = [];
  for (const quote_status of ['live', 'delayed', 'stale', 'unavailable']) for (const market_status of ['open', 'closed', 'unknown']) {
    words.push(quoteWord(quote('us:AAPL', { quote_status, market_status, message: '行情连接已断开，保留上次报价。' })));
  }
  for (const status of ['idle', 'connecting', 'streaming', 'polling', 'error', 'paused']) words.push(connectionWord(status));
  for (const id of ['ifind', 'alpaca']) for (const status of ['connecting', 'connected', 'unconfigured', 'error', 'limited']) {
    words.push(providerWord({ id, market: 'cn', status, source: 'iFinD', feed: 'realtime', transport: 'poll', message: 'A 股实时行情待开通 iFinD 账号并配置接口凭据' }));
  }
  for (const basis of ['previous_close', '24h']) words.push(basisWord(quote('us:AAPL', { basis })));
  for (const feed of ['realtime', 'iex', '']) words.push(sourceWord(quote('cn:600519', { feed })));
  words.push(sourceWord(quote('cn:600519', { source: '同花顺', feed: 'realtime' })));
  for (const status of ['idle', 'loading', 'success', 'error']) words.push(searchWord({ query: 'zz', status, assets: [], partial: false, note: '搜索服务暂时不可用，请稍后重试。' }));
  for (const error of [null, 'read', 'unsaved', 'full']) words.push(watchWord(error));
  for (const word of words) assert.doesNotMatch(word, CJK, word);

  assert.equal(quoteWord(quote('us:AAPL')), 'Live');
  assert.equal(quoteWord(quote('us:AAPL', { quote_status: 'delayed', market_status: 'closed' })), 'Delayed · Closed');
  assert.equal(quoteWord(quote('us:AAPL', { quote_status: 'unavailable', price: null, market_status: 'closed' })), 'No quote');
  assert.equal(quoteWord(undefined), 'No quote');
  assert.deepEqual(['streaming', 'idle', 'connecting', 'polling', 'paused', 'error'].map(connectionWord), ['', '', 'Connecting…', 'Updating every 15 s', 'Paused', 'Quotes unavailable']);
  assert.equal(providerWord({ id: 'ifind', status: 'unconfigured' }), 'iFinD · Not configured');
  assert.equal(providerWord({ id: 'ifind', status: 'connected' }), 'iFinD · Connected');
  assert.equal(providerWord({ id: 'alpaca', status: 'connected' }), 'Quotes · Connected', 'a provider the face no longer has is named by none of its own');
  assert.equal(basisWord(quote('crypto:BTC/USD', { basis: '24h' })), '24h');
  assert.equal(basisWord(quote('us:AAPL')), 'vs previous close');
  assert.equal(sourceWord(quote('cn:600519', { source: 'iFinD', feed: 'realtime' })), 'iFinD');
  assert.equal(sourceWord({ market: 'us' }), 'Quotes', 'an old us: star has no provider of the face');
  assert.equal(sourceWord({ market: 'crypto' }), 'Quotes');
  assert.equal(searchWord({ query: 'zz', status: 'success', assets: [], partial: false }), 'Nothing matches “zz”');
  assert.equal(searchWord({ query: 'zz', status: 'loading', assets: [], partial: false }), 'Searching…');
  assert.equal(searchWord({ query: 'zz', status: 'error', assets: [], partial: false }), 'Search is unavailable');
  assert.equal(searchWord({ query: 'zz', status: 'success', assets: [asset('us:ZZ')], partial: true }), 'Some results may be missing');
  assert.equal(searchWord({ query: 'zz', status: 'success', assets: [asset('us:ZZ')], partial: false }), '');
  assert.equal(searchWord({ query: '', status: 'idle', assets: [], partial: false }), '');
  assert.deepEqual([null, 'read', 'unsaved', 'full'].map(watchWord), ['', "Couldn't read the saved watchlist", "Couldn't save the watchlist", 'The watchlist is full']);
});

test("mentionsOf matches whole words in titles: AAPL in 'Is AAPL cheap?', not in 'AAPLX'; a crypto pair by its base", () => {
  const convs = [
    { id: 's1', title: 'Is AAPL cheap?' }, { id: 's2', title: 'AAPLX notes' }, { id: 's3', title: 'BTC breaking out' },
    { id: 's4', title: 'aapl lower-case' }, { id: 's5', title: 'Untitled' }, { id: 's6', title: 'BRK.B or BRKXB' },
  ];
  assert.deepEqual(mentionsOf(convs, asset('us:AAPL')).map(c => c.id), ['s1']);
  assert.deepEqual(mentionsOf(convs, asset('crypto:BTC/USD')).map(c => c.id), ['s3']);
  assert.deepEqual(mentionsOf(convs, asset('us:BRK.B')).map(c => c.id), ['s6']);
  assert.deepEqual(mentionsOf(convs, asset('cn:600519')), []);
  assert.deepEqual(mentionsOf(undefined, asset('us:AAPL')), []);
  // a market with no symbol — an event — by its name, whole
  const fed = 'Will the Fed cut rates at its December meeting?';
  const asked = [{ id: 'e1', title: `${fed} Odds` }, { id: 'e2', title: 'Fed cut odds' }, { id: 'e3', title: 'SI-FEDCUT-DEC sizing' }];
  assert.deepEqual(mentionsOf(asked, { name: fed }).map(c => c.id), ['e1']);
  assert.deepEqual(mentionsOf(asked, { symbol: '', name: '' }), []);
  assert.deepEqual(mentionsOf(asked, { symbol: 'SI-FEDCUT-DEC', name: fed }).map(c => c.id), ['e3'], 'a symbol, where there is one, is what is looked for');
});

test('volumeWord: shares for a stock, the base for a coin, — for null', () => {
  assert.equal(volumeWord(asset('us:AAPL'), quote('us:AAPL', { volume: 52_300_000 })), '52.3M shares');
  assert.equal(volumeWord(asset('us:AAPL'), quote('us:AAPL', { volume: 2.3e9 })), '2.3B shares');
  assert.equal(volumeWord(asset('us:AAPL'), quote('us:AAPL', { volume: 950 })), '950 shares');
  assert.equal(volumeWord(asset('crypto:BTC/USD'), quote('crypto:BTC/USD', { volume: 12_345.6 })), '12.3k BTC');
  assert.equal(volumeWord(asset('crypto:BTC/USD'), quote('crypto:BTC/USD', { volume: 0.5 })), '0.5 BTC');
  assert.equal(volumeWord(asset('cn:600519'), quote('cn:600519', { volume: null })), '—');
  assert.equal(volumeWord(asset('us:AAPL'), undefined), '—');
  // a row's or a page's volume in the same compact word: dollars, contracts, an A share's shares
  const priced = (volume, volumeUnit) => ({ ...UNPRICED, volume, volumeUnit });
  assert.deepEqual([priced(31688393074, 'usd'), priced(787322717, 'usd'), priced(412000, 'contracts'), priced(123456789, 'shares'), priced(999960, 'usd'), priced(950, 'usd'), priced(null, 'usd')].map(volumeWordOf),
    ['$31.7B', '$787.3M', '412k contracts', '123.5M shares', '$1M', '$950', '—']);
  assert.equal(volumeWordOf(undefined), '—');
});

test('a market whose provider is not configured says so instead of No quote', () => {
  const unconfigured = [{ id: 'ifind', market: 'cn', status: 'unconfigured', source: 'iFinD', feed: '', transport: 'poll', message: 'A 股行情待配置 iFinD' }];
  assert.equal(quoteWord(undefined, unconfigured, 'cn'), 'Not configured');
  assert.equal(quoteWord(quote('cn:600519', { price: null, quote_status: 'unavailable' }), unconfigured), 'Not configured');
  assert.equal(quoteWord(quote('cn:600519'), unconfigured), 'Live', 'a price is a price');
  assert.equal(quoteWord(undefined, unconfigured, 'us'), 'No quote', 'an old us: star has no provider of the face');
  assert.equal(quoteWord(undefined), 'No quote');
});
