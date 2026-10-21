// The account view (spec 2026-10-19 §7 Stage 2): /data/account.json's payload — Alpaca's own decimal strings — as the portfolio,
// the orders by bucket, the statement and its CSV, and the venue's facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioOf, orderLine, statementOf, csvOf, venueOf, seatWords } from '../../client/js/host/account-view.js';

// spec 2026-10-20 §6.3: the Account seat's standing (/data/seat.json) in the words the Venues box draws
const seatView = (over = {}) => ({
  ok: true, url: 'http://127.0.0.1:4820', reachable: true, asOf: '2026-10-19T18:40:00.000Z', mode: 'guard', writes: { on: true, capUsd: 100 }, cardMinutes: 30,
  seat: { name: 'Gravit', status: 'admitted', address: '0xab12', validUntil: new Date(2026, 10, 19).getTime(), limits: [{ scope: 'trade', allow: ['paper-1'], perOrderUsd: 100, budgetUsd: 1000, spentUsd: 100, reservedUsd: 50, leftUsd: 850, validUntil: 1, expired: false }] },
  venues: [{ id: 'paper-1', name: 'Paper account · paper', paper: true, usd: 10000 }, { id: 'okx', name: 'OKX', paper: false, usd: 0, stale: true, notServed: 'OKX does not serve this location' }],
  cards: [{ id: 'card-7', usd: 56 }, { id: 'card-9', usd: 12 }], others: 1, ...over,
});

test('seatWords: nothing read, not reachable, and every standing in its words', () => {
  assert.deepEqual(seatWords(null), { service: '', mode: '', writes: '', seat: '', limits: [], venues: [], cards: '', url: '' });
  const off = seatWords({ ok: true, url: 'http://127.0.0.1:4820', reachable: false, error: 'ECONNREFUSED' });
  assert.equal(off.service, '127.0.0.1:4820 · not reachable'); assert.equal(off.seat, ''); assert.equal(off.mode, ''); assert.equal(off.url, 'http://127.0.0.1:4820');
  const on = seatWords(seatView());
  assert.equal(on.service, '127.0.0.1:4820 · reachable'); assert.equal(on.mode, 'Guard'); assert.equal(on.writes, 'Trading on · $100 a move');
  assert.equal(on.seat, 'Gravit · admitted until Nov 19');
  assert.deepEqual(on.limits, ['trade · paper-1 · $100 an order · $850 of $1,000 left']);
  assert.deepEqual(on.venues, [{ id: 'paper-1', name: 'Paper account · paper', paper: true, usd: '$10,000', note: '' }, { id: 'okx', name: 'OKX', paper: false, usd: '$0', note: 'OKX does not serve this location' }]);
  assert.equal(on.cards, '2 cards waiting'); assert.equal(on.url, 'http://127.0.0.1:4820');
  const standing = status => seatWords(seatView({ seat: { name: 'Gravit', status, limits: [] } })).seat;
  assert.equal(standing('knocking'), 'Gravit · knocking — admit it on the Account page');
  assert.equal(standing('absent'), 'Gravit · not on the account');
  assert.equal(standing('expired'), 'Gravit · expired');
  assert.equal(standing('revoked'), 'Gravit · revoked');
  assert.equal(standing('unknown'), 'Gravit · on the account · standing unknown');
  assert.equal(seatWords(seatView({ cards: [{ id: 'c', usd: 1 }] })).cards, '1 card waiting');
  assert.equal(seatWords(seatView({ cards: [] })).cards, '');
  assert.equal(seatWords(seatView({ mode: 'open' })).mode, 'Beast');
  assert.equal(seatWords(seatView({ writes: { on: false, capUsd: null } })).writes, 'Read-only');
  const lim = l => seatWords(seatView({ seat: { name: 'Gravit', status: 'admitted', limits: [l] } })).limits[0];
  assert.equal(lim({ scope: 'trade', allow: ['paper-1'], perOrderUsd: 100, budgetUsd: 1000, spentUsd: 0, reservedUsd: 0, leftUsd: 1000, validUntil: 1, expired: true }), 'trade · paper-1 · $100 an order · $1,000 of $1,000 left · expired');
  assert.equal(lim({ scope: 'trade', allow: ['paper-1', 'ex'], perOrderUsd: 100, budgetUsd: null, spentUsd: 0, reservedUsd: 0, leftUsd: null, validUntil: null, expired: false }), 'trade · paper-1, ex · $100 an order');
  assert.deepEqual(seatWords(seatView({ venues: [{ id: 'v', name: '', paper: false, usd: null, stale: true }] })).venues, [{ id: 'v', name: 'v', paper: false, usd: '', note: 'stale' }]);
});

const keyed = () => ({
  ok: true, available: true, host: 'paper-api.alpaca.markets',
  account: { equity: '123346.11', last_equity: '122011.09', cash: '50000.00', currency: 'USD', buying_power: '100000' },
  positions: [
    { symbol: 'AAPL', asset_class: 'us_equity', exchange: 'NASDAQ', qty: '5', market_value: '600.0', change_today: '0.0084' },
    { symbol: 'BTCUSD', asset_class: 'crypto', exchange: 'CRYPTO', qty: '0.5', market_value: '30000.0', change_today: '-0.02' },
  ],
  orders: [
    { id: 'o1', symbol: 'AAPL', side: 'buy', qty: '2', filled_qty: '0', type: 'limit', limit_price: '150', status: 'accepted', submitted_at: '2026-10-19T14:00:00Z' },
    { id: 'o2', symbol: 'AAPL', side: 'buy', qty: '3', filled_qty: '3', filled_avg_price: '189.5', type: 'market', status: 'filled', submitted_at: '2026-10-18T14:00:00Z', filled_at: '2026-10-18T14:00:05Z' },
    { id: 'o3', symbol: 'MSFT', side: 'sell', qty: '1', filled_qty: '0', type: 'market', status: 'canceled', submitted_at: '2026-10-17T14:00:00Z' },
    { id: 'o4', symbol: 'KO', side: 'buy', qty: '10', filled_qty: '0', type: 'limit', limit_price: '60', status: 'done_for_day', submitted_at: '2026-10-16T14:00:00Z' },
    { id: 'o5', symbol: 'NVDA', side: 'buy', notional: '500', qty: null, filled_qty: '2.5', filled_avg_price: '200', type: 'market', status: 'filled', submitted_at: '2026-10-19T15:00:00Z', filled_at: '2026-10-19T15:00:01Z' },
  ],
  orders_note: "Alpaca's most recent 50 orders, all statuses", orders_gate: { gate1_registered: false }, generated_at: '2026-10-19T16:00:00+00:00',
});

test('Portfolio from a keyed payload in Alpaca string amounts: net worth, today, the bar, holdings, orders by bucket', () => {
  const p = portfolioOf(keyed());
  assert.equal(p.available, true);
  assert.equal(p.netWorth, 123346.11);
  assert.ok(Math.abs(p.today - 1335.02) < 1e-6, String(p.today));
  assert.ok(Math.abs(p.todayPct - 1335.02 / 122011.09) < 1e-9);
  assert.equal(p.currency, 'USD');
  assert.deepEqual(p.alloc.map(a => [a.token, a.label]), [['cash', 'Cash'], ['equity', 'Stocks'], ['crypto', 'Crypto']]);
  assert.ok(Math.abs(p.alloc.reduce((t, a) => t + a.pct, 0) - 100) < 0.1);
  assert.deepEqual(p.holdings.map(h => [h.id, h.symbol, h.qty, h.value, h.changeToday]), [['us:AAPL', 'AAPL', 5, 600, 0.0084], ['crypto:BTC/USD', 'BTCUSD', 0.5, 30000, -0.02]]);
  const buckets = Object.fromEntries(Object.entries(p.orders).map(([k, v]) => [k, v.map(o => o.id)]));
  assert.deepEqual(buckets, { working: ['o1'], filled: ['o2', 'o5'], closed: ['o3'], other: ['o4'] });
});

test('the keyless payload is unavailable with its reason; unparseable amounts are null, never NaN', () => {
  const k = portfolioOf({ ok: true, available: false, reason: 'no APCA keys in the environment', orders_gate: {} });
  assert.equal(k.available, false); assert.equal(k.reason, 'no APCA keys in the environment');
  assert.equal(k.netWorth, null); assert.deepEqual(k.holdings, []); assert.deepEqual(k.alloc, []);
  const bad = portfolioOf({ ...keyed(), account: { equity: 'n/a', last_equity: '', cash: null } });
  assert.equal(bad.netWorth, null); assert.equal(bad.today, null); assert.equal(bad.todayPct, null);
  assert.ok(bad.alloc.every(a => Number.isFinite(a.pct)));
  assert.equal(portfolioOf({ ...keyed(), account: { equity: '10', last_equity: '0', cash: '10' } }).today, null, 'no day change against a zero base');
  assert.equal(portfolioOf(null).available, false);
  assert.equal(portfolioOf({ ok: false, error: 'GET /v2/orders -> HTTP 401' }).available, false);
});

test('orderLine reads like the order', () => {
  const o = keyed().orders;
  assert.equal(orderLine(o[0]), 'Buy 2 AAPL · limit 150 · 0 of 2 filled');
  assert.equal(orderLine(o[1]), 'Buy 3 AAPL · market · 3 of 3 filled');
  assert.equal(orderLine(o[2]), 'Sell 1 MSFT · market · 0 of 1 filled');
  assert.equal(orderLine(o[4]), 'Buy $500 NVDA · market · 2.5 filled');
  assert.equal(orderLine({ side: 'sell', qty: '1', filled_qty: '0', symbol: 'TSLA', type: 'trailing_stop' }), 'Sell 1 TSLA · trailing stop · 0 of 1 filled');
});

test('statement rows are the filled orders, newest first, and csvOf quotes commas and quotes', () => {
  const rows = statementOf(keyed());
  assert.deepEqual(rows.map(r => r.symbol), ['NVDA', 'AAPL']);
  assert.deepEqual(rows[1], { at: '2026-10-18T14:00:05Z', side: 'buy', qty: 3, symbol: 'AAPL', price: 189.5, amount: 568.5 });
  assert.equal(rows[0].qty, 2.5); assert.equal(rows[0].amount, 500);
  assert.equal(csvOf([{ at: '2026-10-18T14:00:05Z', side: 'buy', qty: 3, symbol: 'BRK,B "x"', price: 189.5, amount: 568.5 }]),
    'date,side,qty,symbol,price,amount\r\n2026-10-18T14:00:05Z,buy,3,"BRK,B ""x""",189.5,568.5\r\n');
  assert.equal(csvOf([]), 'date,side,qty,symbol,price,amount\r\n');
  assert.equal(csvOf([{ at: null, side: 'buy', qty: null, symbol: 'X', price: null, amount: null }]), 'date,side,qty,symbol,price,amount\r\n,buy,,X,,\r\n');
  assert.deepEqual(statementOf({ ok: true, available: false }), []);
});

test('venueOf: keys and order tools, each unknown until read', () => {
  assert.deepEqual(venueOf(keyed(), null, null), { host: 'paper-api.alpaca.markets', mode: 'Paper', keys: 'unknown', orders: 'unknown' });
  const creds = { APCA_API_KEY_ID: { configured: true, source: 'env', writable: false }, APCA_API_SECRET_KEY: { configured: true, source: 'env', writable: false } };
  assert.equal(venueOf(keyed(), creds, []).keys, 'env');
  assert.equal(venueOf(keyed(), { ...creds, APCA_API_SECRET_KEY: { configured: false, writable: true } }, []).keys, 'none');
  assert.equal(venueOf(keyed(), { APCA_API_KEY_ID: { configured: true, source: 'file' }, APCA_API_SECRET_KEY: { configured: true, source: 'file' } }, []).keys, 'file');
  assert.equal(venueOf(keyed(), creds, ['mcp__alpaca-kit__account', 'mcp__alpaca-kit__place_order']).orders, 'on');
  assert.equal(venueOf(keyed(), creds, ['mcp__alpaca-kit__account', 'mcp__alpaca-kit__orders']).orders, 'off');
  assert.equal(venueOf({ ...keyed(), host: 'api.alpaca.markets' }, creds, []).mode, 'Live');
  assert.deepEqual(venueOf({ ok: true, available: false }, null, null), { host: null, mode: '', keys: 'unknown', orders: 'unknown' });
});

test('the statement keeps every fill: a partly filled order canceled later, or still working, is on it; an unfilled one is not', () => {
  const data = { ...keyed(), orders: [
    { id: 'p1', symbol: 'AAPL', side: 'buy', qty: '10', filled_qty: '4', filled_avg_price: '150', type: 'limit', limit_price: '150', status: 'canceled', submitted_at: '2026-10-17T14:00:00Z', filled_at: '2026-10-17T14:05:00Z' },
    { id: 'p2', symbol: 'KO', side: 'buy', qty: '10', filled_qty: '3', filled_avg_price: '60', type: 'limit', limit_price: '60', status: 'partially_filled', submitted_at: '2026-10-19T14:00:00Z', filled_at: null },
    { id: 'p3', symbol: 'MSFT', side: 'sell', qty: '1', filled_qty: '0', type: 'market', status: 'canceled', submitted_at: '2026-10-18T14:00:00Z' },
  ] };
  assert.deepEqual(statementOf(data).map(r => [r.symbol, r.qty, r.amount]), [['KO', 3, 180], ['AAPL', 4, 600]]);
});

test('seatWords: a disabled seat row says so, and nothing else', () => {
  const off = seatWords({ ok: true, url: 'http://127.0.0.1:4820', reachable: false, error: 'disabled' });
  assert.equal(off.service, '127.0.0.1:4820 · seat disabled'); assert.equal(off.seat, ''); assert.deepEqual(off.venues, []); assert.equal(off.url, 'http://127.0.0.1:4820');
});
