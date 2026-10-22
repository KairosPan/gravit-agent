// The Markets view: the Account's explore items as the table's rows — tabs, prices by kind, the source word, the legs across
// venues — beside the face's A-share (cn:) rows, and a market's page with what is held, working and stated for it (spec
// 2026-10-22 §6.1), over the stand-in's answers (tests/fixtures/account/). And the face's own ids and English words from the cn
// wire's enums, with the list views over the face's quotes kept until their callers go (spec 2026-10-19 §7 Stage 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MARKET_TABS, MARKET_SORTS, canonicalId, holdingAssets, listAssets, marketRows, assetFor,
  quoteWord, connectionWord, providerWord, basisWord, sourceWord, volumeWord, searchWord, watchWord, barsWord, mentionsOf,
  ACCOUNT_TABS, ACCOUNT_SORTS, isAccountKey, tabsOf, priceOf, sourceWordOf, legsOf, rowsOf, matchKey, pairsOf, pageOf,
} from '../../client/js/host/market-view.js';

const CJK = /[㐀-鿿]/;
// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const itemOf = (body, key) => body.items.find(i => i.key === key);
// a read as the store keeps it
const read = data => ({ status: 'ready', data, at: 1 });
const asset = (id, over = {}) => {
  const [market, symbol] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  return { id, market, symbol, name: symbol, exchange: '', currency: market === 'cn' ? 'CNY' : 'USD', ...over };
};
const quote = (id, over = {}) => ({
  id, market: id.slice(0, id.indexOf(':')), symbol: id.slice(id.indexOf(':') + 1), transport: 'stream', price: 10, prev_close: 9, change: 1,
  change_pct: 11.11, volume: 1000, as_of: '2026-10-19T14:30:00Z', received_at: null, volume_as_of: null, source: 'Alpaca', feed: 'iex',
  basis: 'previous_close', quote_status: 'live', market_status: 'open', message: '', ...over,
});
// the markets slice: the face's own fields as today, and the Account's reads beside them (Task 10 builds it so)
const markets = (over = {}) => ({
  tab: 'all', sort: 'volume', q: '', watchlist: [], watchError: null, quotes: {}, providers: [], connection: 'idle',
  search: { query: '', status: 'idle', assets: [], partial: false }, hitQuotes: {}, bars: {},
  explore: { status: 'idle', data: null, at: null }, results: { status: 'idle', data: null, at: null },
  accountQuotes: {}, candles: {}, compare: {}, watch: [], asked: {}, ...over,
});
// the account slice as host/account.js keeps it, over the stand-in's page, holdings, paper lens and statement
const accountSlice = (over = {}) => ({
  status: 'ready', data: fx('account'), at: 1, message: null,
  holdings: read(fx('holdings')), paper: read(fx('holdings-paper')), statement: read(fx('statement')), ...over,
});
const account = positions => ({ ok: true, available: true, host: 'paper-api.alpaca.markets', account: {}, positions, orders: [] });

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
  // Watching and All results are the renderer's to add, from the slice's stars and query, never tabsOf's ...
  assert.equal(tabsOf(explore, 2).some(t => t.id === 'watching' || t.id === 'results'), false);
  // ... and when they are due, rowsOf answers them: the stars under Watching, the search's own rows under Results
  const m = markets({ explore: read(explore), watch: ['coin:ETH', 'stock:AAPL'], watchlist: [asset('cn:600519')] });
  assert.deepEqual(rowsOf({ ...m, tab: 'watching' }).map(r => r.id), ['stock:AAPL', 'coin:ETH', 'cn:600519']);
  const sol = fx('explore-all');
  sol.items = sol.items.filter(i => i.base === 'SOL');
  const searching = {
    ...m, q: 'sol', tab: 'results', results: read(sol),
    search: { query: 'sol', status: 'success', assets: [asset('crypto:SOL/USD'), asset('cn:601012', { name: 'LONGi' })], partial: false },
  };
  assert.deepEqual(rowsOf(searching).map(r => r.id), ['perp:SOL', 'coin:SOL', 'cn:601012'], "the Account's hits and the cn hits; never a crypto hit of the face's");
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
  assert.deepEqual(priceOf(null), { price: null, unit: 'usd', changePct: null, change24h: null, volume: null, volumeUnit: 'usd', implied: null });
});

test('sourceWordOf: the Account quoteFrom verbatim, with the age past 5 s', () => {
  const now = Date.parse('2026-10-22T14:00:00.000Z');
  const ago = ms => new Date(now - ms).toISOString();
  const hood = quoteAt => ({ key: 'stock:HOOD', kind: 'stock', name: 'Robinhood Markets', base: 'HOOD', price: 41.2, quoteFrom: 'Robinhood · real time', quoteAt, tabs: ['all', 'stocks'], at: [] });
  assert.equal(sourceWordOf(hood(ago(2_000)), now), 'Robinhood · real time');
  assert.equal(sourceWordOf(hood(ago(5_000)), now), 'Robinhood · real time', 'five seconds old is still fresh');
  assert.equal(sourceWordOf(hood(ago(12_000)), now), 'Robinhood · real time · 12 s ago');
  assert.equal(sourceWordOf(hood(ago(3 * 60_000 + 5_000)), now), 'Robinhood · real time · 3 min ago');
  assert.equal(sourceWordOf(hood(ago(2 * 3_600_000 + 60_000)), now), 'Robinhood · real time · 2 h ago');
  assert.equal(sourceWordOf(hood(ago(30 * 3_600_000)), now), 'Robinhood · real time · yesterday');
  assert.equal(sourceWordOf(hood(ago(3 * 86_400_000)), now), 'Robinhood · real time · 3 days ago');
  assert.equal(sourceWordOf(hood('not a time'), now), 'Robinhood · real time', 'a stamp that does not parse ages nothing');
  assert.equal(sourceWordOf(hood(ago(-60_000)), now), 'Robinhood · real time', 'a stamp ahead of the clock ages nothing');
  assert.equal(sourceWordOf(hood(undefined), now), 'Robinhood · real time');
  // no word on the row: its most traded line's (the first: the Account orders them by volume), with that line's stamp
  const cboe = {
    ...hood(undefined), quoteFrom: undefined,
    at: [{ venue: 'cboe-public', venueName: 'Cboe', symbol: 'HOOD', connected: false, canTrade: false, public: true, price: 41.2, quoteFrom: 'Cboe · 15 min delayed', quoteAt: ago(15 * 60_000) }],
  };
  assert.equal(sourceWordOf(cboe, now), 'Cboe · 15 min delayed · 15 min ago');
  assert.equal(sourceWordOf(itemOf(fx('explore-predictions'), 'event:paper-momentum:SX-JOBS-NEXT'), now), 'Stand-in Event Exchange');
  // no line says one either: the first venue the owner connected that lists it; nothing at all: no word
  assert.equal(sourceWordOf(itemOf(fx('explore-all'), 'stock:NVDA'), now), 'Stand-in Broker');
  assert.equal(sourceWordOf(itemOf(fx('explore-all'), 'coin:DOGE'), now), 'Momentum · paper', 'its public line says no source; its one connected venue is the paper account');
  assert.equal(sourceWordOf({ key: 'coin:Y', kind: 'coin', at: [{ venue: 'p', venueName: 'Public X', symbol: 'Y/USD', connected: false, public: true }] }, now), '');
  assert.equal(sourceWordOf(null, now), '');
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
  // no ask among the connected: the lowest price; a public line is never best; a canTrade the Account does not know stays unknown
  const hand = {
    key: 'coin:X', kind: 'coin', at: [
      { venue: 'c', venueName: 'C', symbol: 'X/USD', connected: false, canTrade: false, public: true, price: 9, ask: 9.1 },
      { venue: 'a', venueName: 'A', symbol: 'X/USD', connected: true, canTrade: 'unknown', public: false, price: 10 },
      { venue: 'b', venueName: 'B', symbol: 'X/USD', connected: true, canTrade: true, public: false, price: 9.5, ask: 'n/a' },
    ],
  };
  assert.deepEqual(legsOf(hand).map(l => [l.venue, l.best, l.canTrade, l.ask]), [['a', false, 'unknown', null], ['b', true, true, null], ['c', false, false, 9.1]]);
  assert.deepEqual(legsOf({ key: 'coin:Y', at: [{ venue: 'p', symbol: 'Y/USD', connected: false, public: true, ask: 1 }] }).map(l => l.best), [false]);
  assert.deepEqual(legsOf({ key: 'coin:Z', kind: 'coin' }), []);
  assert.deepEqual(legsOf(null), []);
});

test('rowsOf: the fixture rows and two cn rows side by side; source words; the three sorts; nulls last; a cn row only under All and Stocks', () => {
  const moutai = quote('cn:600519', { price: 1450, change_pct: -3, volume: 900_000_000, source: '同花顺', feed: 'realtime', message: '行情连接已断开，保留上次报价。' });
  const m = markets({
    explore: read(fx('explore-all')),
    watchlist: [asset('cn:600519', { name: '贵州茅台', exchange: 'SSE' }), asset('cn:000001', { name: '平安银行', exchange: 'SZSE' })],
    quotes: { 'cn:600519': moutai },
    accountQuotes: { 'broker|NVDA': fx('market').market },
    watch: ['coin:BTC'],
  });
  const rows = rowsOf(m);
  assert.deepEqual(rows.map(r => r.id), [
    'stock:NVDA', 'stock:SPY', 'stock:AAPL', 'perp:BTC', 'coin:BTC', 'perp:ETH', 'coin:ETH', 'cn:600519', 'coin:DOGE', 'perp:SOL',
    'coin:SOL', 'coin:LINK', 'perp:DOGE', 'cn:000001',
  ], "Most traded: the Account's dollars and the cn row's volume side by side, a row without one last");
  assert.deepEqual(rows.find(r => r.id === 'perp:BTC'), {
    id: 'perp:BTC', source: 'account', kind: 'perp', name: 'BTC perpetual', sub: 'BTC · Perpetual',
    priced: { price: 62498.8, unit: 'usd', changePct: 2.3, change24h: 1404.9, volume: 4121786065, volumeUnit: 'usd', implied: null },
    live: null, sourceWord: 'Stand-in Exchange', closeTime: null, pastEnd: false, watched: false,
    legs: [{ venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', connected: true, paper: false, canTrade: true, public: false, connectTo: '', connector: '', price: 62498.8, bid: 62495.6, ask: 62501.9, best: true }],
    tabs: ['all', 'perps'],
  });
  assert.deepEqual(rows.find(r => r.id === 'cn:600519'), {
    id: 'cn:600519', source: 'face', asset: asset('cn:600519', { name: '贵州茅台', exchange: 'SSE' }), quote: moutai, kind: 'stock', name: '贵州茅台', sub: 'SSE',
    priced: { price: 1450, unit: 'usd', changePct: -3, change24h: null, volume: 900000000, volumeUnit: 'usd', implied: null },
    live: null, sourceWord: 'iFinD', closeTime: null, pastEnd: false, watched: true, legs: [], tabs: ['all', 'stocks'],
  });
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  // the latest quote at the row's most traded connected venue rides beside the item's price; the star is the operator's
  assert.deepEqual(byId['stock:NVDA'].live, fx('market').market);
  assert.equal(byId['stock:NVDA'].priced.price, 182.4);
  assert.equal(byId['coin:BTC'].live, null);
  assert.deepEqual(rows.filter(r => r.watched).map(r => r.id), ['coin:BTC', 'cn:600519', 'cn:000001']);
  // the Account's own words for where each price is from, the face's provider for the cn rows; the second line of each
  assert.deepEqual(['stock:NVDA', 'coin:BTC', 'coin:LINK', 'cn:000001'].map(id => byId[id].sourceWord), ['Stand-in Broker', 'Stand-in Exchange', 'Momentum · paper', 'iFinD']);
  assert.deepEqual(['stock:NVDA', 'coin:BTC', 'perp:ETH', 'cn:000001'].map(id => byId[id].sub), ['Stand-in Broker', 'BTC', 'ETH · Perpetual', 'SZSE']);
  for (const r of rows) for (const word of [r.sub, r.sourceWord]) assert.doesNotMatch(word, CJK, word);
  assert.deepEqual(byId['cn:000001'].priced, { price: null, unit: 'usd', changePct: null, change24h: null, volume: null, volumeUnit: 'usd', implied: null });
  assert.equal(byId['cn:000001'].quote, null);

  // Biggest moves: the size of the 24h move, a tie in the list's order, a row without one last
  assert.deepEqual(rowsOf({ ...m, sort: 'movers' }).map(r => r.id), [
    'coin:DOGE', 'perp:DOGE', 'coin:LINK', 'perp:ETH', 'coin:ETH', 'cn:600519', 'perp:BTC', 'coin:BTC', 'stock:NVDA', 'perp:SOL',
    'coin:SOL', 'stock:AAPL', 'stock:SPY', 'cn:000001',
  ]);
  // Closing soonest: the events by their close, the soonest first, the rows that never close last
  const events = { ...m, explore: read(fx('explore-predictions')), sort: 'closing' };
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
  // while searching, the Account's rows are its search's; the cn watchlist stays, the cn hits join it once
  const searching = {
    ...m, q: 'ping', results: read({ ...fx('explore-all'), items: [] }),
    search: { query: 'ping', status: 'success', assets: [asset('cn:000001', { name: '平安银行', exchange: 'SZSE' }), asset('cn:601318', { name: '中国平安', exchange: 'SSE' })], partial: false },
    hitQuotes: { 'cn:601318': quote('cn:601318', { price: 52.1, change_pct: 0.4, volume: 5e7 }) },
  };
  assert.deepEqual(rowsOf(searching).map(r => [r.id, r.watched]), [['cn:600519', true], ['cn:601318', false], ['cn:000001', true]]);
  assert.equal(rowsOf(searching).find(r => r.id === 'cn:601318').priced.price, 52.1, 'a hit takes the quote its search read');
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
  const m = markets({ explore: read(body), watchlist: [asset('us:ZZZZ', { name: 'Zed Corp' }), asset('crypto:QQQ/USD')], asked: { 'us:ZZZZ': null, 'crypto:QQQ/USD': null } });
  const pm = body.items[1].key;
  // a contract volume sorts as its number; an unpriced row, and the Not listed lines, after every figure
  assert.deepEqual(rowsOf(m).map(r => r.id), ['event:predict:SI-FEDCUT-DEC', 'kalshi:KXFED-DEC', pm, 'coin:NEWT', 'us:ZZZZ', 'crypto:QQQ/USD']);
  assert.deepEqual(rowsOf({ ...m, sort: 'movers' }).map(r => r.id), ['event:predict:SI-FEDCUT-DEC', 'kalshi:KXFED-DEC', pm, 'coin:NEWT', 'us:ZZZZ', 'crypto:QQQ/USD']);
  assert.deepEqual(rowsOf({ ...m, sort: 'closing' }).map(r => r.id), [pm, 'event:predict:SI-FEDCUT-DEC', 'kalshi:KXFED-DEC', 'coin:NEWT', 'us:ZZZZ', 'crypto:QQQ/USD']);
  const byId = Object.fromEntries(rowsOf(m).map(r => [r.id, r]));
  // unpriced: every figure null, for the renderer's dashes; no venue to quote it, no source to name
  assert.deepEqual(byId['coin:NEWT'].priced, { price: null, unit: 'usd', changePct: null, change24h: null, volume: null, volumeUnit: 'usd', implied: null });
  assert.deepEqual([byId['coin:NEWT'].live, byId['coin:NEWT'].sourceWord, byId['coin:NEWT'].sub], [null, '', 'NEWT']);
  // past its end: the flag and the close time, for Closed; still priced in cents
  assert.deepEqual([byId[pm].pastEnd, byId[pm].closeTime, byId[pm].priced.price, byId[pm].priced.change24h, byId[pm].sub], [true, '2026-10-20T00:00:00.000Z', 12, -1, 'Climate']);
  assert.equal(byId['kalshi:KXFED-DEC'].pastEnd, false);
  // Kalshi's volume in contracts, never dollars
  assert.deepEqual([byId['kalshi:KXFED-DEC'].priced.volume, byId['kalshi:KXFED-DEC'].priced.volumeUnit], [412000, 'contracts']);
  assert.deepEqual([byId['event:predict:SI-FEDCUT-DEC'].priced.volume, byId['event:predict:SI-FEDCUT-DEC'].priced.volumeUnit], [1840000, 'usd']);
  // an old star the Account could not find: once, Not listed at the Account, every figure null
  assert.deepEqual(byId['us:ZZZZ'], {
    id: 'us:ZZZZ', source: 'face', notListed: true, kind: 'stock', name: 'Zed Corp', sub: 'Not listed at the Account',
    priced: { price: null, unit: 'usd', changePct: null, change24h: null, volume: null, volumeUnit: 'usd', implied: null },
    live: null, sourceWord: '', closeTime: null, pastEnd: false, watched: true, legs: [], tabs: ['all', 'stocks'],
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
  // the Account's row keys, never the face's ids
  for (const key of ['coin:BTC', 'stock:AAPL', 'perp:ETH', 'rwa:NVDA', 'kalshi:KXFED-DEC', `pm:0x${'ab'.repeat(32)}`, 'pmus:fed-dec']) assert.equal(isAccountKey(key), true, key);
  for (const id of ['cn:600519', 'us:AAPL', 'crypto:BTC/USD', 'coinBTC', 'BTC', '', null, undefined]) assert.equal(isAccountKey(id), false, String(id));

  // an old us:/crypto: star: nothing until it is asked; found, it stars the Account's row; not found, the Not listed line
  const explore = fx('explore-all');
  const old = [asset('us:AAPL', { name: 'Apple' }), asset('crypto:SOL/USD'), asset('us:ZZZZ'), asset('us:TSLA')];
  assert.deepEqual(rowsOf(markets({ explore: read(explore), watchlist: old, tab: 'watching' })), []);
  const asked = { 'us:AAPL': 'stock:AAPL', 'crypto:SOL/USD': 'coin:SOL', 'us:ZZZZ': null, 'us:TSLA': 'stock:TSLA' };
  assert.deepEqual(rowsOf(markets({ explore: read(explore), watchlist: old, asked, tab: 'watching' })).map(r => [r.id, r.source]),
    [['stock:AAPL', 'account'], ['coin:SOL', 'account'], ['us:ZZZZ', 'face']], 'TSLA was found, but no read lists it: nothing to draw');
  assert.equal(rowsOf(markets({ explore: read(explore), watchlist: old, asked })).some(r => r.id.startsWith('us:AAPL') || r.id.startsWith('crypto:')), false, 'the old id never draws itself');

  // pairsOf: the first `limit` rows' most traded connected venue as venue|symbol; a row with none is skipped
  const rows = rowsOf(markets({ explore: read(explore), watchlist: [asset('cn:600519')], quotes: { 'cn:600519': quote('cn:600519', { volume: 3e9 }) } }));
  assert.deepEqual(rows.slice(0, 6).map(r => r.id), ['stock:NVDA', 'stock:SPY', 'stock:AAPL', 'perp:BTC', 'cn:600519', 'coin:BTC']);
  assert.deepEqual(pairsOf(rows, 5), ['broker|NVDA', 'broker|SPY', 'broker|AAPL', 'ex|BTC/USDT:USDT']);
  assert.deepEqual(pairsOf(rows), [
    'broker|NVDA', 'broker|SPY', 'broker|AAPL', 'ex|BTC/USDT:USDT', 'ex|BTC/USDT', 'ex|ETH/USDT:USDT', 'ex|ETH/USDT',
    'paper-momentum|DOGE/USD', 'ex|SOL/USDT:USDT', 'ex|SOL/USDT', 'paper-momentum|LINK/USD',
  ], 'twelve rows by default, the cn row among them skipped: the thirteenth row (perp:DOGE) is not asked');
  assert.deepEqual(pairsOf([{ id: 'coin:Y', legs: legsOf({ at: [{ venue: 'p', symbol: 'Y/USD', connected: false, public: true }] }) }]), []);
  assert.deepEqual(pairsOf([]), []);
  assert.deepEqual(pairsOf(null), []);
});

test('pageOf: the item, its legs, candles for the range, compare rows, held, orders and lines for the market', () => {
  const m = markets({
    explore: read(fx('explore-all')),
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

  // an event: no base to hold as an asset; its leg's symbol names its position and its line; its price in cents
  const fed = pageOf(markets({ explore: read(fx('explore-predictions')) }), acct, 'event:predict:SI-FEDCUT-DEC');
  assert.deepEqual(fed.held.assets, []);
  assert.deepEqual(fed.held.positions.map(p => [p.venue, p.symbol, p.qty]), [['predict', 'SI-FEDCUT-DEC:YES', 50]]);
  assert.deepEqual(fed.lines.map(l => l.key), ['order:49864860e7f081d0fb8212efe0705c4f']);
  assert.deepEqual([fed.priced.price, fed.priced.unit, fed.compare], [62, 'cents', []]);

  // the leading lens: real money leads here; with none and a paper venue connected, the paper account's rows are what is held
  const paper = fx('holdings-paper');
  paper.rows.push({ key: 'crypto:BTC', asset: 'BTC', class: 'crypto', amount: 0.05, usd: 3124, venues: [{ venue: 'paper-momentum', venueName: 'Momentum · paper', amount: 0.05, usd: 3124 }] });
  assert.deepEqual(pageOf(m, accountSlice({ paper: read(paper) }), 'coin:BTC').held.assets.map(a => a.amount), [0.124]);
  assert.deepEqual(pageOf(m, accountSlice({ data: { ...fx('account'), totalUsd: 0 }, paper: read(paper) }), 'coin:BTC').held.assets.map(a => a.amount), [0.05]);

  // a market the search found; one no read lists, or a face id, is no page
  const searched = markets({ explore: read(fx('explore-all')), q: 'cpi', results: read(fx('explore-predictions')) });
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

test('no icon URL survives any view (an item given an https icon by hand)', () => {
  const ICON = 'https://logos.example-cdn.com/btc.png';
  const explore = fx('explore-all');
  const btc = itemOf(explore, 'coin:BTC');
  btc.icon = ICON;
  btc.at[0].icon = ICON;
  const predictions = fx('explore-predictions');
  const fed = itemOf(predictions, 'event:predict:SI-FEDCUT-DEC');
  fed.icon = ICON;
  fed.outcomes[0].icon = ICON;
  const m = markets({ explore: read(explore), results: read(predictions), q: 'fed', watch: ['coin:BTC', fed.key], watchlist: [asset('cn:600519')] });
  const acct = accountSlice();
  const outputs = [
    tabsOf(explore, 1), priceOf(btc), sourceWordOf(btc, Date.now()), legsOf(btc), priceOf(fed), sourceWordOf(fed, Date.now()), legsOf(fed),
    matchKey('crypto:BTC/USD'), pageOf(m, acct, 'coin:BTC'), pageOf(m, acct, fed.key),
  ];
  for (const q of ['', 'fed']) for (const tab of ['all', 'crypto', 'predictions', 'watching', 'results']) for (const { id: sort } of ACCOUNT_SORTS) {
    const rows = rowsOf({ ...m, q, tab, sort });
    outputs.push(rows, pairsOf(rows));
  }
  assert.ok(pageOf(m, acct, 'coin:BTC').item.at.length > 0, 'the page has the item, and its legs, to look through');
  for (const out of outputs) {
    const text = JSON.stringify(out) ?? '';
    assert.ok(!text.includes('example-cdn'), text.slice(0, 160));
    assert.ok(!text.includes('"icon"'), text.slice(0, 160));
  }
  // the views copy what they leave out: the store's own items keep their icons
  assert.deepEqual([btc.icon, btc.at[0].icon, fed.icon, fed.outcomes[0].icon], [ICON, ICON, ICON, ICON]);
});

// ── The face's own ids, words and list views ──

test('holdings become face ids; the list is the watchlist then the holdings, deduped; a query lists the hits', () => {
  const data = account([
    { symbol: 'AAPL', asset_class: 'us_equity', exchange: 'NASDAQ', qty: '5' },
    { symbol: 'BTCUSD', asset_class: 'crypto', exchange: 'CRYPTO', qty: '0.1' },
    { symbol: 'ETH/USD', asset_class: 'crypto', qty: '1' },
    { symbol: 'X', asset_class: 'us_option', qty: '1' },
  ]);
  assert.deepEqual(holdingAssets(data).map(a => a.id), ['us:AAPL', 'crypto:BTC/USD', 'crypto:ETH/USD']);
  assert.equal(holdingAssets(data)[0].exchange, 'NASDAQ');
  assert.deepEqual(holdingAssets(null), []);
  assert.deepEqual(holdingAssets({ ok: true, available: false, reason: 'no APCA keys in the environment' }), []);
  const m = markets({ watchlist: [asset('crypto:BTC/USD'), asset('cn:600519')] });
  assert.deepEqual(listAssets(m, data).map(a => a.id), ['crypto:BTC/USD', 'cn:600519', 'us:AAPL', 'crypto:ETH/USD']);
  const searching = markets({ ...m, q: 'nvd', search: { query: 'nvd', status: 'success', assets: [asset('us:NVDA', { name: 'NVIDIA' })], partial: false } });
  assert.deepEqual(listAssets(searching, data).map(a => a.id), ['us:NVDA']);
  const rows = marketRows({ ...searching, hitQuotes: { 'us:NVDA': quote('us:NVDA', { price: 123 }) } }, data);
  assert.equal(rows[0].quote.price, 123, 'a hit takes its REST quote');
});

test('tabs: Stocks holds us and cn, Crypto the crypto; the labels', () => {
  assert.deepEqual(MARKET_TABS.map(t => t.label), ['All', 'Crypto', 'Stocks']);
  assert.deepEqual(MARKET_SORTS.map(s => s.label), ['Most traded', 'Biggest moves']);
  const m = markets({ watchlist: [asset('us:AAPL'), asset('cn:600519'), asset('crypto:BTC/USD')] });
  assert.deepEqual(marketRows({ ...m, tab: 'stocks' }, null).map(r => r.asset.id), ['us:AAPL', 'cn:600519']);
  assert.deepEqual(marketRows({ ...m, tab: 'crypto' }, null).map(r => r.asset.id), ['crypto:BTC/USD']);
});

test('sorts put nulls last both ways and keep list order on ties', () => {
  const m = markets({
    watchlist: [asset('cn:600519'), asset('us:AAPL'), asset('us:MSFT'), asset('us:ZZZZ'), asset('us:KO')],
    quotes: {
      'cn:600519': quote('cn:600519', { volume: null, change_pct: -3 }),
      'us:AAPL': quote('us:AAPL', { volume: 500, change_pct: 1 }),
      'us:MSFT': quote('us:MSFT', { volume: 900, change_pct: -0.5 }),
      'us:ZZZZ': quote('us:ZZZZ', { price: null, volume: null, change_pct: null, quote_status: 'unavailable' }),
      'us:KO': quote('us:KO', { volume: 500, change_pct: 1 }),
    },
  });
  assert.deepEqual(marketRows(m, null).map(r => r.asset.id), ['us:MSFT', 'us:AAPL', 'us:KO', 'cn:600519', 'us:ZZZZ']);
  assert.deepEqual(marketRows({ ...m, sort: 'movers' }, null).map(r => r.asset.id), ['cn:600519', 'us:AAPL', 'us:KO', 'us:MSFT', 'us:ZZZZ']);
  const row = marketRows(m, account([{ symbol: 'AAPL', asset_class: 'us_equity' }])).find(r => r.asset.id === 'us:AAPL');
  assert.equal(row.watched, true); assert.equal(row.held, true); assert.equal(row.quote.volume, 500);
});

test('canonicalId: us:aapl → us:AAPL, crypto:btc-usd → crypto:BTC/USD, BTC → null; assetFor', () => {
  assert.equal(canonicalId('us:aapl'), 'us:AAPL');
  assert.equal(canonicalId('crypto:btc-usd'), 'crypto:BTC/USD');
  assert.equal(canonicalId('cn:600519'), 'cn:600519');
  for (const bad of ['BTC', '', 'us:', 'fx:EURUSD', null, undefined]) assert.equal(canonicalId(bad), null, String(bad));
  const known = asset('us:AAPL', { name: 'Apple', exchange: 'NASDAQ' });
  assert.equal(assetFor(markets({ watchlist: [known] }), null, 'us:aapl').name, 'Apple');
  assert.deepEqual(assetFor(markets(), null, 'us:MSFT'), { id: 'us:MSFT', market: 'us', symbol: 'MSFT', name: 'MSFT', exchange: '', currency: 'USD' });
  assert.equal(assetFor(markets(), null, 'garbage'), null);
});

test('every word is English, and each enum reads as it should', () => {
  const words = [];
  for (const quote_status of ['live', 'delayed', 'stale', 'unavailable']) for (const market_status of ['open', 'closed', 'unknown']) {
    words.push(quoteWord(quote('us:AAPL', { quote_status, market_status, message: '行情连接已断开，保留上次报价。' })));
  }
  for (const status of ['idle', 'connecting', 'streaming', 'polling', 'error', 'paused']) words.push(connectionWord(status));
  for (const id of ['alpaca', 'ifind', 'coinbase']) for (const status of ['connecting', 'connected', 'unconfigured', 'error', 'limited']) {
    words.push(providerWord({ id, market: 'us', status, source: 'Alpaca', feed: 'iex', transport: 'poll', message: '美股行情待配置 Alpaca API 凭据' }));
  }
  for (const basis of ['previous_close', '24h']) words.push(basisWord(quote('us:AAPL', { basis })));
  for (const feed of ['iex', 'sip', 'delayed_sip', 'exchange', 'realtime', '']) words.push(sourceWord(quote('us:AAPL', { feed })));
  words.push(sourceWord(quote('cn:600519', { source: '同花顺', feed: 'realtime' })));
  for (const status of ['idle', 'loading', 'success', 'error']) words.push(searchWord({ query: 'zz', status, assets: [], partial: false, note: '搜索服务暂时不可用，请稍后重试。' }));
  for (const error of [null, 'read', 'unsaved', 'full']) words.push(watchWord(error));
  words.push(barsWord({ ok: true, source: 'alpaca', feed: 'iex', as_of: '2026-10-17', rows: [] }), barsWord({ ok: true, source: 'bed', feed: null, as_of: '2026-07-09', rows: [], stale: true }));
  for (const word of words) assert.doesNotMatch(word, CJK, word);

  assert.equal(quoteWord(quote('us:AAPL')), 'Live');
  assert.equal(quoteWord(quote('us:AAPL', { quote_status: 'delayed', market_status: 'closed' })), 'Delayed · Closed');
  assert.equal(quoteWord(quote('us:AAPL', { quote_status: 'unavailable', price: null, market_status: 'closed' })), 'No quote');
  assert.equal(quoteWord(undefined), 'No quote');
  assert.deepEqual(['streaming', 'idle', 'connecting', 'polling', 'paused', 'error'].map(connectionWord), ['', '', 'Connecting…', 'Updating every 15 s', 'Paused', 'Quotes unavailable']);
  assert.equal(providerWord({ id: 'ifind', status: 'unconfigured' }), 'iFinD · Not configured');
  assert.equal(providerWord({ id: 'alpaca', status: 'connected' }), 'Alpaca · Connected');
  assert.equal(basisWord(quote('crypto:BTC/USD', { basis: '24h' })), '24h');
  assert.equal(basisWord(quote('us:AAPL')), 'vs previous close');
  assert.equal(sourceWord(quote('us:AAPL')), 'Alpaca · IEX');
  assert.equal(sourceWord(quote('us:AAPL', { feed: 'delayed_sip' })), 'Alpaca · SIP, delayed');
  assert.equal(sourceWord(quote('crypto:BTC/USD', { source: 'Coinbase', feed: 'exchange' })), 'Coinbase');
  assert.equal(searchWord({ query: 'zz', status: 'success', assets: [], partial: false }), 'Nothing matches “zz”');
  assert.equal(searchWord({ query: 'zz', status: 'loading', assets: [], partial: false }), 'Searching…');
  assert.equal(searchWord({ query: 'zz', status: 'error', assets: [], partial: false }), 'Search is unavailable');
  assert.equal(searchWord({ query: 'zz', status: 'success', assets: [asset('us:ZZ')], partial: true }), 'Some results may be missing');
  assert.equal(searchWord({ query: 'zz', status: 'success', assets: [asset('us:ZZ')], partial: false }), '');
  assert.equal(searchWord({ query: '', status: 'idle', assets: [], partial: false }), '');
  assert.deepEqual([null, 'read', 'unsaved', 'full'].map(watchWord), ['', "Couldn't read the saved watchlist", "Couldn't save the watchlist", 'The watchlist is full']);
  assert.equal(barsWord({ source: 'alpaca', feed: 'iex', as_of: '2026-10-17' }), 'Daily · Alpaca IEX');
  assert.equal(barsWord({ source: 'bed', feed: null, as_of: '2026-07-09', stale: true }), 'Daily · PIT bed · as of 2026-07-09 · stale');
  assert.equal(barsWord(undefined), '');
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
});

test('volumeWord: shares for a stock, the base for a coin, — for null', () => {
  assert.equal(volumeWord(asset('us:AAPL'), quote('us:AAPL', { volume: 52_300_000 })), '52.3M shares');
  assert.equal(volumeWord(asset('us:AAPL'), quote('us:AAPL', { volume: 2.3e9 })), '2.3B shares');
  assert.equal(volumeWord(asset('us:AAPL'), quote('us:AAPL', { volume: 950 })), '950 shares');
  assert.equal(volumeWord(asset('crypto:BTC/USD'), quote('crypto:BTC/USD', { volume: 12_345.6 })), '12.3k BTC');
  assert.equal(volumeWord(asset('crypto:BTC/USD'), quote('crypto:BTC/USD', { volume: 0.5 })), '0.5 BTC');
  assert.equal(volumeWord(asset('cn:600519'), quote('cn:600519', { volume: null })), '—');
  assert.equal(volumeWord(asset('us:AAPL'), undefined), '—');
});

test('Most traded ranks by dollar volume, price × volume, so a coin and a stock compare', () => {
  const m = markets({
    watchlist: [asset('crypto:DOGE/USD'), asset('crypto:ETH/USD'), asset('crypto:BTC/USD'), asset('us:BTCS')],
    quotes: {
      'crypto:DOGE/USD': quote('crypto:DOGE/USD', { price: 0.12, volume: 910_000_000 }),
      'crypto:ETH/USD': quote('crypto:ETH/USD', { price: 2630, volume: 98_000 }),
      'crypto:BTC/USD': quote('crypto:BTC/USD', { price: 82_710, volume: 5_200 }),
      'us:BTCS': quote('us:BTCS', { price: 3.1, volume: 840_000 }),
    },
  });
  assert.deepEqual(marketRows(m, null).map(r => r.asset.id), ['crypto:BTC/USD', 'crypto:ETH/USD', 'crypto:DOGE/USD', 'us:BTCS']);
  assert.equal(volumeWord(asset('crypto:BTC/USD'), m.quotes['crypto:BTC/USD']), '5.2k BTC', 'the volume still reads in units');
});

test('a market whose provider is not configured says so instead of No quote', () => {
  const unconfigured = [{ id: 'alpaca', market: 'us', status: 'unconfigured', source: 'Alpaca', feed: '', transport: 'poll', message: '美股行情待配置' }];
  assert.equal(quoteWord(undefined, unconfigured, 'us'), 'Not configured');
  assert.equal(quoteWord(quote('us:AAPL', { price: null, quote_status: 'unavailable' }), unconfigured), 'Not configured');
  assert.equal(quoteWord(quote('us:AAPL'), unconfigured), 'Live', 'a price is a price');
  assert.equal(quoteWord(undefined, unconfigured, 'crypto'), 'No quote');
  assert.equal(quoteWord(undefined), 'No quote');
});
