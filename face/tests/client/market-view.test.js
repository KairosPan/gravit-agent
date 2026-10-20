// The market view (spec 2026-10-19 §7 Stage 2): face ids, the list, tabs and sorts, and English words from the wire's enums.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_TABS, MARKET_SORTS, canonicalId, holdingAssets, listAssets, marketRows, assetFor,
  quoteWord, connectionWord, providerWord, basisWord, sourceWord, volumeWord, searchWord, watchWord, barsWord, mentionsOf,
} from '../../client/js/host/market-view.js';

const CJK = /[㐀-鿿]/;
const asset = (id, over = {}) => {
  const [market, symbol] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  return { id, market, symbol, name: symbol, exchange: '', currency: market === 'cn' ? 'CNY' : 'USD', ...over };
};
const quote = (id, over = {}) => ({
  id, market: id.slice(0, id.indexOf(':')), symbol: id.slice(id.indexOf(':') + 1), transport: 'stream', price: 10, prev_close: 9, change: 1,
  change_pct: 11.11, volume: 1000, as_of: '2026-10-19T14:30:00Z', received_at: null, volume_as_of: null, source: 'Alpaca', feed: 'iex',
  basis: 'previous_close', quote_status: 'live', market_status: 'open', message: '', ...over,
});
const markets = (over = {}) => ({
  tab: 'all', sort: 'volume', q: '', watchlist: [], watchError: null, quotes: {}, providers: [], connection: 'idle',
  search: { query: '', status: 'idle', assets: [], partial: false }, hitQuotes: {}, bars: {}, ...over,
});
const account = positions => ({ ok: true, available: true, host: 'paper-api.alpaca.markets', account: {}, positions, orders: [] });

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
