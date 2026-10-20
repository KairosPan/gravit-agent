// Markets on the face (spec 2026-10-19 §7 Stage 2): the watchlist, the holdings and the search hits with their quotes,
// rendered from states built with the host reducers. No Trade, no venues, no prediction cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarketsScreen } from '../../client/js/render/markets.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const CJK = /[㐀-鿿]/;
const asset = (id, over = {}) => {
  const market = id.slice(0, id.indexOf(':'));
  const symbol = id.slice(id.indexOf(':') + 1);
  return { id, market, symbol, name: symbol, exchange: '', currency: market === 'cn' ? 'CNY' : 'USD', ...over };
};
const quote = (id, over = {}) => ({
  id, market: id.slice(0, id.indexOf(':')), symbol: id.slice(id.indexOf(':') + 1), transport: 'stream', price: 10, prev_close: 9, change: 1,
  change_pct: 1.5, volume: 1000, as_of: '2026-10-19T14:30:00Z', received_at: null, volume_as_of: null, source: 'Alpaca', feed: 'iex',
  basis: 'previous_close', quote_status: 'live', market_status: 'open', message: '', ...over,
});
const keyed = positions => ({ ok: true, available: true, host: 'paper-api.alpaca.markets', account: { equity: '1' }, positions, orders: [] });

function screen({ watch = [], quotes = [], positions = null, q = '', search = null, hits = [], tab = null, sort = null, connection = 'streaming', providers = [], watchError = null, route = { screen: 'markets', id: null } } = {}) {
  let s = R.nav(emptyState(), route);
  s = R.watchlistLoaded(s, { items: watch, error: watchError });
  s = R.quotesUpdated(s, { quotes: Object.fromEntries(quotes.map(x => [x.id, x])), providers, status: connection, note: '实时连接已断开，正在读取备用报价。' });
  if (positions) s = R.accountLoaded(s, { data: keyed(positions), at: NOW });
  if (q) s = R.setMarketsQuery(s, q);
  if (search) s = R.searchUpdated(s, { market: 'all', truncated: false, note: '部分行情源暂不可用', ...search });
  if (hits.length) s = R.hitQuotesLoaded(s, { quotes: hits });
  if (tab) s = R.setMarketsTab(s, tab);
  if (sort) s = R.setMarketsSort(s, sort);
  return { s, html: renderMarketsScreen(s, NOW) };
}
const rowIds = html => [...html.matchAll(/<tr data-id="([^"]+)"/g)].map(m => m[1]);
const rowOf = (html, id) => html.match(new RegExp(`<tr data-id="${id.replace(/[/]/g, '\\/')}">[\\s\\S]*?</tr>`))?.[0] ?? '';

test('rows are the watchlist and the holdings with their quotes', () => {
  const { html } = screen({
    watch: [asset('crypto:BTC/USD', { name: 'Bitcoin' }), asset('cn:600519', { name: 'Kweichow Moutai', exchange: 'SH' })],
    positions: [{ symbol: 'AAPL', asset_class: 'us_equity', exchange: 'NASDAQ' }],
    quotes: [quote('crypto:BTC/USD', { volume: 5000, source: 'Coinbase', feed: 'exchange', basis: '24h' }), quote('us:AAPL', { volume: 900 }), quote('cn:600519', { volume: null })],
  });
  assert.match(html, /^<main class="main mkts">/);
  assert.match(html, /<h1 class="head-title">Markets<\/h1>/);
  assert.deepEqual(rowIds(html), ['crypto:BTC/USD', 'us:AAPL', 'cn:600519'], 'Most traded, the A-share without a volume last');
  const aapl = rowOf(html, 'us:AAPL');
  assert.match(aapl, /<b>AAPL<\/b>/);
  assert.match(aapl, /AAPL · NASDAQ/);
  assert.match(aapl, /class="mk-tag">Held</);
  assert.match(aapl, /900 shares/);
  assert.match(aapl, /Live/);
  assert.match(rowOf(html, 'crypto:BTC/USD'), /<b>Bitcoin<\/b>[\s\S]*5k BTC/);
  assert.doesNotMatch(rowOf(html, 'crypto:BTC/USD'), /Held/);
  assert.match(rowOf(html, 'cn:600519'), /600519 · SH/);
});

test('price in its currency: $189.24, ¥1,688.00; null fields draw —', () => {
  const { html } = screen({
    watch: [asset('us:AAPL'), asset('cn:600519'), asset('us:ZZZZ')],
    quotes: [quote('us:AAPL', { price: 189.24, change_pct: -0.42 }), quote('cn:600519', { price: 1688, volume: null }), quote('us:ZZZZ', { price: null, change_pct: null, volume: null, quote_status: 'unavailable' })],
  });
  assert.match(rowOf(html, 'us:AAPL'), />\$189\.24</);
  assert.match(rowOf(html, 'us:AAPL'), /class="down"><span aria-hidden="true">▼<\/span><span class="sr-only">down<\/span> 0\.42%/);
  assert.match(rowOf(html, 'cn:600519'), />¥1,688\.00</);
  const z = rowOf(html, 'us:ZZZZ');
  assert.equal((z.match(/>—</g) ?? []).length, 3, 'price, change and volume');
  assert.match(z, /class="flat">—</, 'the change');
  assert.match(z, /No quote/);
});

test("the star's state and words", () => {
  const { html } = screen({ watch: [asset('crypto:BTC/USD')], positions: [{ symbol: 'AAPL', asset_class: 'us_equity' }], quotes: [] });
  assert.match(rowOf(html, 'crypto:BTC/USD'), /class="mk-star" data-action="toggleWatch" data-id="crypto:BTC\/USD" aria-pressed="true" aria-label="Stop watching BTC\/USD"/);
  assert.match(rowOf(html, 'us:AAPL'), /class="mk-star" data-action="toggleWatch" data-id="us:AAPL" aria-pressed="false" aria-label="Watch AAPL"/);
  assert.match(rowOf(html, 'us:AAPL'), /class="mk-name" data-action="openMarket" data-id="us:AAPL"/);
});

test('tabs and sorts as labelled; Stocks shows us and cn', () => {
  const watch = [asset('us:AAPL'), asset('cn:600519'), asset('crypto:BTC/USD')];
  const quotes = [quote('us:AAPL', { volume: 1, change_pct: 9 }), quote('cn:600519', { volume: null, change_pct: -2 }), quote('crypto:BTC/USD', { volume: 3, change_pct: 0.1 })];
  const all = screen({ watch, quotes }).html;
  assert.match(all, /class="mk-tab" data-action="mkTab" data-value="all" aria-pressed="true">All</);
  assert.match(all, /data-value="crypto" aria-pressed="false">Crypto</);
  assert.match(all, /data-value="stocks" aria-pressed="false">Stocks</);
  assert.match(all, /class="seg-item pressed" aria-pressed="true" data-action="mkSort" data-value="Most traded"/);
  assert.match(all, /data-action="mkSort" data-value="Biggest moves"/);
  assert.deepEqual(rowIds(all), ['crypto:BTC/USD', 'us:AAPL', 'cn:600519']);
  assert.deepEqual(rowIds(screen({ watch, quotes, sort: 'movers' }).html), ['us:AAPL', 'cn:600519', 'crypto:BTC/USD']);
  const stocks = screen({ watch, quotes, tab: 'stocks' }).html;
  assert.match(stocks, /data-value="stocks" aria-pressed="true">Stocks</);
  assert.deepEqual(rowIds(stocks), ['us:AAPL', 'cn:600519']);
  assert.deepEqual(rowIds(screen({ watch, quotes, tab: 'crypto' }).html), ['crypto:BTC/USD']);
  assert.doesNotMatch(screen({ watch: [asset('us:AAPL')], quotes }).html, /data-action="mkSort"/, 'one row needs no sort');
});

test('while searching the hits are the rows, with their REST quotes; the count and Clear show', () => {
  const { html } = screen({
    watch: [asset('us:KO')], q: 'nv',
    search: { query: 'nv', status: 'success', assets: [asset('us:NVDA', { name: 'NVIDIA', exchange: 'NASDAQ' }), asset('us:NVDL')], partial: false },
    hits: [quote('us:NVDA', { price: 123 })],
  });
  assert.deepEqual(rowIds(html), ['us:NVDA', 'us:NVDL']);
  assert.match(html, /<p class="mk-q">2 markets for “nv” <button type="button" class="mk-clear" data-action="mkClear">Clear<\/button><\/p>/);
  assert.match(rowOf(html, 'us:NVDA'), />\$123\.00</);
  assert.match(rowOf(html, 'us:NVDL'), /No quote/);
  assert.match(html, /id="mq" type="search" autocomplete="off" placeholder="Search markets" data-action="mkQuery" value="nv"/);
  const one = screen({ q: 'nvda', search: { query: 'nvda', status: 'success', assets: [asset('us:NVDA')], partial: true } }).html;
  assert.match(one, /1 market for “nvda”/);
  assert.match(one, /Some results may be missing/);
  assert.match(screen({ q: 'zz', search: { query: 'zz', status: 'loading', assets: [], partial: false } }).html, /Searching…/);
  assert.match(screen({ q: 'zz', search: { query: 'zz', status: 'success', assets: [], partial: false } }).html, /Nothing matches “zz”/);
  assert.match(screen({ q: 'zz', search: { query: 'zz', status: 'error', assets: [], partial: false } }).html, /Search is unavailable/);
});

test('no Chinese reaches the HTML', () => {
  const providers = [{ id: 'alpaca', market: 'us', status: 'unconfigured', source: 'Alpaca', feed: '', transport: 'poll', message: '美股行情待配置 Alpaca API 凭据' }];
  const states = [
    screen({ watch: [asset('us:AAPL')], quotes: [quote('us:AAPL', { message: '该标的暂无 Alpaca 行情', quote_status: 'stale' })], providers, connection: 'polling' }),
    screen({ watch: [asset('us:AAPL')], q: 'a', search: { query: 'a', status: 'error', assets: [], partial: false, note: '搜索服务暂时不可用，请稍后重试。' } }),
    screen({ watch: [asset('us:AAPL')], watchError: 'read' }),
  ];
  for (const { html } of states) assert.doesNotMatch(html, CJK);
});

test('the connection word shows while polling and not while streaming; the watchlist word shows', () => {
  const watch = [asset('us:AAPL')];
  assert.match(screen({ watch, connection: 'polling' }).html, /class="mk-note">Updating every 15 s</);
  assert.doesNotMatch(screen({ watch, connection: 'streaming' }).html, /mk-note/);
  assert.match(screen({ watch, connection: 'error' }).html, /Quotes unavailable/);
  assert.match(screen({ watch, watchError: 'full' }).html, /class="mk-note">The watchlist is full</);
});

test('nothing watched and no query: Nothing watched yet', () => {
  const { html } = screen();
  assert.match(html, /<p class="mk-empty">Nothing watched yet<\/p>/);
  assert.equal(rowIds(html).length, 0);
});

test('no Trade, Connect, Where, Buy or Sell', () => {
  const { html } = screen({ watch: [asset('us:AAPL'), asset('crypto:BTC/USD')], positions: [{ symbol: 'MSFT', asset_class: 'us_equity' }], quotes: [quote('us:AAPL')] });
  for (const word of [/Trade/, /Connect/, /Where/, />Buy</, />Sell</, /mk-card/, /tradeFrom/]) assert.doesNotMatch(html, word, String(word));
});

test("a market's page has the way back to Markets", () => {
  const { html } = screen({ watch: [asset('us:AAPL', { name: 'Apple' })], route: { screen: 'markets', id: 'us:AAPL' } });
  assert.match(html, /<a id="page-back" class="back-link page-back" href="#\/markets">‹ Markets<\/a>/);
  assert.match(html, /<h1 class="head-title">Apple<\/h1>/);
});
