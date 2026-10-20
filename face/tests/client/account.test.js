// Account on the face (spec 2026-10-19 §7 Stage 2): the paper account /data/account.json reads — Portfolio, the Statement
// drawer, Venues — rendered from states built with the host reducers; the Settings drawer. No Guard | Beast, no panels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAccountScreen, renderSettings } from '../../client/js/render/account.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';

const NOW = new Date(2026, 9, 19, 14, 40).getTime();
const CJK = /[\u3400-\u9fff]/;
const order = (id, status, over = {}) => ({ id, symbol: 'AAPL', side: 'buy', qty: '2', filled_qty: '0', type: 'limit', limit_price: '150', status, submitted_at: '2026-10-19T14:00:00Z', ...over });
const keyed = (over = {}) => ({
  ok: true, available: true, host: 'paper-api.alpaca.markets',
  account: { equity: '123346.11', last_equity: '122011.09', cash: '50000.00', currency: 'USD', buying_power: '100000' },
  positions: [
    { symbol: 'AAPL', asset_class: 'us_equity', exchange: 'NASDAQ', qty: '5', market_value: '600.0', change_today: '0.0084' },
    { symbol: 'BTCUSD', asset_class: 'crypto', exchange: 'CRYPTO', qty: '0.5', market_value: '30000.0', change_today: '-0.02' },
  ],
  orders: [
    order('o1', 'accepted'),
    order('o2', 'filled', { qty: '3', filled_qty: '3', filled_avg_price: '189.5', type: 'market', limit_price: null, filled_at: '2026-10-18T14:00:05Z' }),
    order('o3', 'canceled', { symbol: 'MSFT', side: 'sell', qty: '1', type: 'market', limit_price: null }),
    order('o4', 'done_for_day', { symbol: 'KO', qty: '10', limit_price: '60' }),
  ],
  orders_note: "Alpaca's most recent 50 orders, all statuses", orders_gate: { gate1_registered: false },
  generated_at: new Date(2026, 9, 19, 14, 32).toISOString(), ...over,
});
const keyless = { ok: true, available: false, reason: 'no APCA keys in the environment', orders_gate: {}, generated_at: 'g' };
const creds = source => ({ APCA_API_KEY_ID: { configured: true, source, writable: false }, APCA_API_SECRET_KEY: { configured: true, source, writable: false } });
const providers = [
  { id: 'alpaca', market: 'us', status: 'connected', source: 'Alpaca', feed: 'iex', transport: 'stream', message: '美股实时行情已连接' },
  { id: 'coinbase', market: 'crypto', status: 'connected', source: 'Coinbase', feed: 'exchange', transport: 'stream', message: '' },
  { id: 'ifind', market: 'cn', status: 'unconfigured', source: 'iFinD', feed: '', transport: 'poll', message: 'A 股行情待配置 iFinD' },
];

function screen({ tab = 'portfolio', data, failed = false, loading = false, keys = null, tools = null, probe = [], statement = false } = {}) {
  let s = R.nav(emptyState(), { screen: 'account', tab });
  if (data !== undefined) s = R.accountLoaded(s, { data, at: NOW });
  if (failed) s = R.accountFailed(s, { at: NOW });
  if (loading) s = R.accountLoading(s);
  if (keys) s = R.credentialsLoaded(s, keys);
  if (tools) s = R.toolsLoaded(s, tools);
  if (probe.length) s = R.probeLoaded(s, probe);
  if (statement) s = R.openStatement(s);
  return { s, html: renderAccountScreen(s, NOW) };
}

test('Portfolio from a keyed payload: net worth, today with its sign, the bar, holdings linking their market, orders by bucket', () => {
  const { html } = screen({ data: keyed() });
  assert.match(html, /^<main class="main acct">/);
  assert.match(html, /<h1 class="head-title">Account<\/h1><span class="chip grey">Paper<\/span>/);
  assert.match(html, /data-action="refreshAccount">Refresh</);
  assert.match(html, /data-action="openSettings">Settings</);
  assert.match(html, /class="seg-item pressed" aria-current="page" href="#\/account\/portfolio">Portfolio</);
  assert.match(html, /href="#\/account\/venues">Venues</);
  assert.match(html, /class="networth">\$123,346\.11</);
  assert.match(html, /<span class="up">\+\$1,335\.02 · \+1\.09%<\/span><span class="dim">today<\/span>/);
  assert.deepEqual([...html.matchAll(/class="alloc-seg alloc-(\w+)"/g)].map(m => m[1]), ['cash', 'equity', 'crypto']);
  assert.match(html, /<span>Cash 62%<\/span><span>Stocks 1%<\/span><span>Crypto 37%<\/span>/);
  assert.match(html, /<a class="ticker" href="#\/markets\/us:AAPL">AAPL<\/a><span class="dim"> · 5 shares<\/span><\/span><span class="num">\$600\.00<\/span><span class="up">\+0\.84%<\/span>/);
  assert.match(html, /<a class="ticker" href="#\/markets\/crypto:BTC\/USD">BTCUSD<\/a><span class="dim"> · 0\.5 BTC<\/span><\/span><span class="num">\$30,000\.00<\/span><span class="down">-2\.00%<\/span>/);
  for (const [bucket, line] of [['Working', 'Buy 2 AAPL · limit 150 · 0 of 2 filled'], ['Filled', 'Buy 3 AAPL · market · 3 of 3 filled'], ['Closed', 'Sell 1 MSFT · market · 0 of 1 filled'], ['Other', 'Buy 10 KO · limit 60 · 0 of 10 filled']]) {
    assert.match(html, new RegExp(`<div class="dsec-label">${bucket}</div><div class="order-row">${line.replace(/[$.]/g, '\\$&')}</div>`), bucket);
  }
  assert.match(html, /data-action="openStatement">Statement</);
  assert.doesNotMatch(html, /stale|As of/);
  assert.match(screen({ data: keyed({ orders: [] }) }).html, /<p class="acct-note">No orders<\/p>/);
  assert.match(screen({ data: keyed({ account: { equity: '100', last_equity: '110', cash: '100' } }) }).html, /<span class="down">-\$10\.00 · -9\.09%<\/span>/);
});

test('the keyless face says No APCA keys in the environment and draws no numbers', () => {
  const { html } = screen({ data: keyless });
  assert.match(html, /<p class="acct-note">No APCA keys in the environment<\/p>/);
  for (const gone of [/networth/, /alloc-bar/, /\$/, /class="chip/, /data-action="openStatement"/]) assert.doesNotMatch(html, gone, String(gone));
});

test('a 503 with nothing loaded: Account unavailable and Retry; with data loaded: the data, stamped stale, and Retry', () => {
  const bare = screen({ failed: true }).html;
  assert.match(bare, /<p class="acct-note">Account unavailable<\/p>/);
  assert.match(bare, /data-action="refreshAccount">Retry</);
  const loaded = screen({ data: keyed(), failed: true }).html;
  assert.match(loaded, /class="networth">\$123,346\.11</);
  assert.match(loaded, /<p class="acct-note">As of 14:32 · stale<\/p>/, 'the numbers are the last good read, and say so');
  assert.match(loaded, /data-action="refreshAccount">Retry</);
  assert.doesNotMatch(loaded, /unavailable/);
  assert.match(screen({ loading: true }).html, /<p class="acct-note">Loading…<\/p>/);
});

test('a stale payload carries its stamp', () => {
  assert.match(screen({ data: keyed({ stale: true }) }).html, /<p class="acct-note">As of 14:32 · stale<\/p>/);
});

test('the Statement drawer: its rows, the 50-orders line and Export CSV', () => {
  const { html } = screen({ data: keyed(), statement: true });
  assert.match(html, /^<main class="main acct with-drawer">/);
  assert.match(html, /<aside class="drawer" aria-label="Statement"><div class="drawer-head"><h2>Statement<\/h2><button type="button" class="close-key" data-action="closeStatement" aria-label="Close">×<\/button><\/div>/);
  assert.match(html, /<p class="acct-note">The 50 most recent orders<\/p>/);
  assert.equal((html.match(/class="activity-row"/g) ?? []).length, 1);
  assert.match(html, /<span class="activity-text">Buy 3 AAPL · \$189\.50<\/span><span class="num">\$568\.50<\/span>/);
  assert.match(html, /data-action="exportStatement">Export CSV</);
  const none = screen({ data: keyed({ orders: [order('o1', 'accepted')] }), statement: true }).html;
  assert.match(none, /No filled orders/);
  assert.doesNotMatch(none, /exportStatement/, 'nothing to export');
});

test('Venues: keys and order tools, each unknown until read, then the providers', () => {
  const unread = screen({ tab: 'venues', data: keyed() }).html;
  assert.match(unread, /class="seg-item pressed" aria-current="page" href="#\/account\/venues">Venues</);
  assert.match(unread, /<div class="venue"><span><b>Alpaca paper<\/b><br><span class="dim">paper-api\.alpaca\.markets · Keys unknown · Order tools unknown<\/span><\/span><\/div>/);
  assert.doesNotMatch(unread, /Quotes/);
  const read = screen({ tab: 'venues', data: keyed(), keys: creds('env'), tools: ['mcp__alpaca-kit__account', 'mcp__alpaca-kit__place_order'], probe: providers }).html;
  assert.match(read, /paper-api\.alpaca\.markets · Keys · env · Order tools on/);
  assert.match(read, /<div class="cardbox-title">Quotes<\/div><div class="venues"><div class="venue"><span>Alpaca · Connected<\/span><\/div><div class="venue"><span>Coinbase · Connected<\/span><\/div><div class="venue"><span>iFinD · Not configured<\/span><\/div><\/div>/);
  const off = screen({ tab: 'venues', data: keyless, keys: { APCA_API_KEY_ID: { configured: false, writable: true }, APCA_API_SECRET_KEY: { configured: false, writable: true } }, tools: ['mcp__alpaca-kit__account'] }).html;
  assert.match(off, /<b>Alpaca<\/b><br><span class="dim">No keys · Order tools off<\/span>/);
});

test('no Chinese ever reaches the HTML', () => {
  const states = [
    screen({ data: { ok: false, error: '账户读取失败：HTTP 401' }, failed: true }),
    screen({ tab: 'venues', data: keyed(), probe: providers }),
    screen({ data: keyless }),
    screen({ data: keyed({ stale: true }), statement: true }),
  ];
  for (const { html } of states) assert.doesNotMatch(html, CJK);
});

test('no Guard, Beast, Trading on, Move, Receive, Connect or Memory', () => {
  const html = screen({ data: keyed() }).html + screen({ tab: 'venues', data: keyed() }).html;
  for (const gone of [/Guard/, /Beast/, /Trading on/, /Move/, /Receive/, /Connect/, /Memory/, /openPanel/]) assert.doesNotMatch(html, gone, String(gone));
});

test('Settings drawer: the theme seg', () => {
  const h = renderSettings({ ...emptyState(), theme: 'black' });
  assert.match(h, /<aside class="drawer" aria-label="Settings">/);
  assert.match(h, /class="seg-item pressed" aria-pressed="true" data-action="setTheme" data-value="Black"/);
});
