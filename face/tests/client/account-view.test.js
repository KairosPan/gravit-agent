// The Account screen's pure views (spec 2026-10-22 §6.2) over the Account's own payloads as the face proxies them — the page
// (/data/account), holdings?cost=1 and its paper lens, history, statement and agents, read from the stand-in's fixtures
// (tests/fixtures/account/) — and the seat box's words over /data/seat.json (spec 2026-10-20 §6.3). And, until their last
// caller goes, the Alpaca-shaped views (spec 2026-10-19 §7 Stage 2): /data/account.json's payload — Alpaca's own decimal
// strings — as the portfolio, the orders by bucket, and the statement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  portfolioOf, statementOf, seatWords,
  pageOk, headOf, worthOf, changeOf, assetsOf, positionsOf, openOrdersOf, missingWords, statementLinesOf, statementCsvOf,
  venuesOf, agentsOf, cardsOf, asksOf, requestsOf,
} from '../../client/js/host/account-view.js';

// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));

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

test('statement rows are the filled orders, newest first', () => {
  const rows = statementOf(keyed());
  assert.deepEqual(rows.map(r => r.symbol), ['NVDA', 'AAPL']);
  assert.deepEqual(rows[1], { at: '2026-10-18T14:00:05Z', side: 'buy', qty: 3, symbol: 'AAPL', price: 189.5, amount: 568.5 });
  assert.equal(rows[0].qty, 2.5); assert.equal(rows[0].amount, 500);
  assert.deepEqual(statementOf({ ok: true, available: false }), []);
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

// ── the Account's own payloads (spec 2026-10-22 §6.2), over the stand-in's fixtures ──

test('pageOk: the fixture is a page; a body missing venues, cards, signers or connectLive is not', () => {
  const page = fx('account');
  assert.equal(pageOk(page), true);
  for (const key of ['venues', 'cards', 'orders', 'signers', 'connectLive']) {
    const { [key]: _gone, ...rest } = page;
    assert.equal(pageOk(rest), false, `without ${key}`);
  }
  assert.equal(pageOk({ ...page, venues: {} }), false, 'venues that are not a list');
  assert.equal(pageOk({ ...page, ok: false }), false);
  assert.equal(pageOk({ ...page, ok: 'true' }), false);
  assert.equal(pageOk({ ok: false, refusal: { code: 'E_ACCOUNT_BAD_ACTION', message: 'no' } }), false);
  assert.equal(pageOk(null), false); assert.equal(pageOk(undefined), false); assert.equal(pageOk('page'), false);
});

test('headOf: guard + writes on → Guard, Trading on · $250 a move; open → Beast; writes off → Read-only', () => {
  const page = fx('account');   // the stand-in: mode guard, connectLive.writes { on: true, capUsd: 250 }
  assert.deepEqual(headOf(page), { mode: 'Guard', writes: 'Trading on · $250 a move' });
  assert.equal(headOf({ ...page, mode: 'open' }).mode, 'Beast');
  assert.equal(headOf({ ...page, mode: 'beast' }).mode, '', 'only the wire values');
  const writes = w => headOf({ ...page, connectLive: { ...page.connectLive, writes: w } }).writes;
  assert.equal(writes({ on: false, capUsd: 250, turnOn: 'npm run account' }), 'Read-only');
  assert.equal(writes({ on: true, capUsd: 1000, turnOn: 'npm run account' }), 'Trading on · $1,000 a move');
  assert.equal(writes({ on: true, capUsd: 'n/a' }), 'Trading on');
  assert.equal(writes(undefined), '');
  assert.deepEqual(headOf({ ...page, mode: undefined, connectLive: { home: '/x', options: [] } }), { mode: '', writes: '' });
});

test('worthOf: real money leads when totalUsd > 0; with totalUsd 0 and a paper venue, Paper leads and real is second', () => {
  const page = fx('account'), holdings = fx('holdings'), paper = fx('holdings-paper');   // 29,138.10 real; 25,400 paper
  assert.deepEqual(worthOf(page, holdings, paper), { lead: { label: 'Net worth', usd: 29138.1 }, second: { label: 'Paper', usd: 25400 }, paperLeads: false });
  const zero = { ...page, totalUsd: 0 };
  assert.deepEqual(worthOf(zero, holdings, paper), { lead: { label: 'Paper', usd: 25400 }, second: { label: 'Net worth', usd: 0 }, paperLeads: true });
  assert.deepEqual(worthOf({ ...page, totalUsd: 'n/a' }, holdings, paper), { lead: { label: 'Paper', usd: 25400 }, second: null, paperLeads: true }, 'a real total that does not parse is no figure');
  assert.deepEqual(worthOf(zero, holdings, null), { lead: { label: 'Net worth', usd: 0 }, second: null, paperLeads: false }, 'the paper lens not read yet');
  assert.deepEqual(worthOf(zero, holdings, { ok: true, paper: true, rows: [] }), { lead: { label: 'Net worth', usd: 0 }, second: null, paperLeads: false }, 'a paper lens without a total');
  const realOnly = page.venues.filter(v => v.paper !== true);
  assert.deepEqual(worthOf({ ...zero, venues: realOnly }, holdings, paper), { lead: { label: 'Net worth', usd: 0 }, second: null, paperLeads: false }, 'no paper venue connected');
  assert.deepEqual(worthOf({ ...page, venues: realOnly }, holdings, paper), { lead: { label: 'Net worth', usd: 29138.1 }, second: null, paperLeads: false });
});

test('changeOf: usd, pct, partial, first; nulls when the history is missing', () => {
  assert.deepEqual(changeOf(fx('history')), { usd: 208.78, pct: 0.72, partial: false, first: '2026-10-15T07:35:46.850Z', sinceStartUsd: null, rebuilt: false });
  assert.deepEqual(changeOf(fx('history-paper')), { usd: 0, pct: 0, partial: false, first: '2026-10-22T07:35:46.786Z', sinceStartUsd: null, rebuilt: true },
    'a flat curve is 0, not nothing; the paper curve says it was rebuilt from the book');
  assert.equal(changeOf({ ...fx('history'), partial: true }).partial, true);
  assert.equal(changeOf({ ...fx('history-paper'), startUsd: 25000, sinceStartUsd: 400 }).sinceStartUsd, 400);
  const none = { usd: null, pct: null, partial: false, first: null, sinceStartUsd: null, rebuilt: false };
  assert.deepEqual(changeOf(null), none); assert.deepEqual(changeOf(undefined), none); assert.deepEqual(changeOf('history'), none);
  assert.deepEqual(changeOf({ ok: true, changeUsd: 'n/a', changePct: Infinity, partial: 'yes', first: 7, sinceStartUsd: 'n/a', rebuilt: 'yes' }), none);
});

test('assetsOf and positionsOf: the fixture rows in order, amounts numeric, a row without usd is null', () => {
  const holdings = fx('holdings');
  const assets = assetsOf(holdings);
  assert.deepEqual(assets.map(a => a.key), ['crypto:BTC', 'stable:USDT', 'crypto:ETH', 'crypto:SOL', 'cash:USD', 'rwa:USDY', 'stable:USDC', 'equity:AAPL', 'equity:NVDA', 'earn:ex:flex:USDT']);
  assert.deepEqual(assets[0], {
    key: 'crypto:BTC', asset: 'BTC', cls: 'crypto', amount: 0.124, usd: 7747.4, price: 62479.03226, changePct24h: 2.3,
    venues: [{ venue: 'ex', venueName: 'Stand-in Exchange', amount: 0.12, usd: 7497.6, stale: false }, { venue: 'wallet', venueName: 'Stand-in Wallet', amount: 0.004, usd: 249.8, stale: false }],
  });
  assert.equal(assets[1].changePct24h, null, 'USDT carries no 24h change');
  assert.equal(assets[9].cls, 'earn');
  const hand = assetsOf({ ok: true, rows: [
    { key: 'a', asset: 'A', class: 'crypto', amount: 1, usd: 5, venues: [{ venue: 'ex', venueName: 'Ex', amount: 1, usd: 5, stale: true }] },
    { key: 'b', asset: 'B', class: 'crypto', amount: 2, venues: [] },
    { key: 'c', asset: 'C', class: 'equity', amount: '3', usd: '10', price: 'n/a' },
    { key: 'd', asset: 'D', class: 'rwa', amount: 4, usd: 'n/a' },
  ] });
  assert.deepEqual(hand.map(a => [a.key, a.usd]), [['c', 10], ['a', 5], ['b', null], ['d', null]], 'largest first, the unpriced last');
  assert.equal(hand[0].amount, 3); assert.equal(hand[0].price, null); assert.deepEqual(hand[0].venues, []);
  assert.equal(hand[1].venues[0].stale, true);

  const positions = positionsOf(holdings);
  assert.deepEqual(positions.map(p => p.symbol), ['BTC/USDT:USDT', 'ETH/USDT:USDT', 'SI-FEDCUT-DEC:YES']);
  assert.deepEqual(positions[0], { venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', side: 'long', qty: 0.01, entryPrice: 60520, markPrice: 62498.8, usd: 624.99, unrealizedUsd: 19.79, paper: false });
  assert.equal(positions[2].unrealizedUsd, -0.5);
  assert.deepEqual(positionsOf(fx('holdings-paper')), []);
  assert.deepEqual(positionsOf({ ok: true, positions: [{ venue: 'paper-1', symbol: 'ETH/USD:USD', side: 'short', qty: 2, paper: true }] }), [
    { venue: 'paper-1', venueName: '', symbol: 'ETH/USD:USD', name: '', side: 'short', qty: 2, entryPrice: null, markPrice: null, usd: null, unrealizedUsd: null, paper: true },
  ]);

  // the same read's third list, `missing`: the venues it could not reach, one sentence a venue
  assert.deepEqual(missingWords(holdings.missing), []);
  assert.deepEqual(missingWords([
    { venue: 'ex', venueName: 'Stand-in Exchange', why: 'no answer in 4 s', part: 'stats' },
    { venue: 'ex', venueName: 'Stand-in Exchange', why: 'no answer in 4 s', part: 'positions' },
    { venue: 'kalshi', why: 'E_VENUE_GEOBLOCKED' },
    { venueName: 'No id' }, { venue: '' }, null,
  ]), ['Stand-in Exchange did not answer', 'kalshi did not answer']);
});

test('openOrdersOf: only open, partial and pending; who is You or the agent name', () => {
  const page = fx('account');
  const open = openOrdersOf(page);
  assert.deepEqual(open.map(o => [o.id, o.status, o.who]), [
    ['ord-0010', 'open', 'Agent · Claude Code'], ['ord-0009', 'pending', 'You'], ['ord-0004', 'open', 'You'], ['ord-0003', 'open', 'You'], ['ord-0002', 'open', 'You'],
  ], "an agent's order is named through the page's keys by its agent address");
  assert.deepEqual(open[1], { id: 'ord-0009', venue: 'broker', venueName: 'Stand-in Broker', symbol: 'SPY', side: 'buy', type: 'limit', qty: 0.25, filledQty: 0, limitPrice: 660.07, status: 'pending', who: 'You', paper: false });
  assert.equal(open[2].type, 'stop'); assert.equal(open[2].limitPrice, null, 'a stop carries no limit price');
  const hand = openOrdersOf({ ...page,
    keys: [...page.keys, { address: '0xAB12', name: 'Gravit', status: 'ok' }, { address: '0xc0de', name: '', status: 'ok' }],
    orders: [
      { id: 'p1', status: 'partial', authority: 'agent', agent: '0xab12', venue: 'paper-1', qty: 2, filledQty: '0.5', paper: true },
      { id: 'p2', status: 'open', authority: 'agent', agent: '0xdead', agentName: 'Claude Code' },
      { id: 'p3', status: 'pending', authority: 'agent', agent: '0xC0DE' },
      { id: 'p4', status: 'open', authority: 'owner', agent: '0xab12' },
      { id: 'p5', status: 'open' },
      ...['filled', 'canceled', 'rejected', 'expired', 'waiting for wallet', undefined].map((status, i) => ({ id: `x${i}`, status, authority: 'owner' })),
    ] });
  // the key at the order's address in any case names it; no key, or a nameless one, is An agent (an order's own agentName is not taken)
  assert.deepEqual(hand.map(o => [o.id, o.who, o.paper, o.filledQty]), [
    ['p1', 'Agent · Gravit', true, 0.5], ['p2', 'An agent', false, null], ['p3', 'An agent', false, null], ['p4', 'You', false, null], ['p5', 'An agent', false, null],
  ]);
});

test('statementLinesOf and statementCsvOf: newest first; the CSV header and a quoted description', () => {
  const statement = fx('statement');
  const keys = statement.lines.map(l => l.key);
  const lines = statementLinesOf(statement);
  assert.deepEqual(lines.map(l => l.key), keys, 'the Account sends them newest first');
  assert.deepEqual(statementLinesOf({ ok: true, lines: [...statement.lines].reverse() }).map(l => l.key), keys, 'and they are drawn so whatever the order');
  assert.deepEqual(lines[0], { key: 'order:d22725bed586b5e46850da6bd3208923', at: '2026-10-22T07:35:46.827Z', type: 'trade', kind: 'buy', description: 'Buy 0.707 SOL · SOL / USDT · limit 141.44', amountUsd: 0, feeUsd: null, status: 'open', by: 'Claude Code, inside its limit', paper: false });
  const filled = lines.find(l => l.key === 'order:726571125e42799be6620d52189cd5c5');
  assert.equal(filled.amountUsd, -49.17); assert.equal(filled.feeUsd, 0.1475);
  const odd = statementLinesOf({ ok: true, lines: [{ key: 'late', at: 'not a time', paper: true }, ...statement.lines.slice(0, 2)] });
  assert.deepEqual(odd.map(l => l.key), [keys[0], keys[1], 'late'], 'a time that does not parse sorts last');
  assert.equal(odd[2].paper, true); assert.equal(odd[2].amountUsd, null);

  const header = 'date,type,kind,description,amount,fee,status,by\r\n';
  assert.equal(statementCsvOf(lines.slice(0, 2)), header +
    '2026-10-22T07:35:46.827Z,trade,buy,Buy 0.707 SOL · SOL / USDT · limit 141.44,0,,open,"Claude Code, inside its limit"\r\n' +
    '2026-10-22T07:35:46.821Z,earn,supply,Supply 150 USDT · USDT · Flexible (stand-in) · 4.6% APY,150,,pending,You\r\n');
  const csv = statementCsvOf(lines).split('\r\n');
  assert.equal(csv.length, 14, 'the header, the twelve lines and the end of the last');
  assert.ok(csv.includes('2026-10-22T07:35:46.806Z,trade,buy,"Buy 0.001 BTC · BTC / USDT · limit 59,352.9",0,,canceled,You'), 'a price grouped with a comma is quoted');
  assert.equal(statementCsvOf([{ at: '2026-10-22T07:00:00.000Z', type: 'trade', kind: 'buy', description: 'Buy 1 "BRK.B"', amountUsd: -500, feeUsd: null, status: 'filled', by: 'You' }]),
    `${header}2026-10-22T07:00:00.000Z,trade,buy,"Buy 1 ""BRK.B""",-500,,filled,You\r\n`);
  assert.equal(statementCsvOf([]), header);

  // a text cell a spreadsheet would run as a formula is led by an apostrophe, then quoted as any other; the amounts stay numbers
  assert.equal(statementCsvOf([{ at: '2026-10-22T07:00:00.000Z', type: 'transfer', kind: 'pay', description: '-5 USDC withheld · fee', amountUsd: -49.17, feeUsd: 0.5, status: 'settled',
    by: '=HYPERLINK("https://example.com","Claude Code"), inside its limit' }]),
  `${header}2026-10-22T07:00:00.000Z,transfer,pay,'-5 USDC withheld · fee,-49.17,0.5,settled,"'=HYPERLINK(""https://example.com"",""Claude Code""), inside its limit"\r\n`);
  for (const [text, cell] of [['+1', "'+1"], ['@SUM(A1)', "'@SUM(A1)"], ['\tx', "'\tx"], ['\rx', `"'\rx"`], ['a-b', 'a-b']]) {
    assert.equal(statementCsvOf([{ status: text }]), `${header},,,,,,${cell},\r\n`, JSON.stringify(text));
  }
});

test('venuesOf: health from lastOkAt/lastFailAt; does words; the paper flag; details without a key value', () => {
  const page = fx('account');
  const venues = venuesOf(page);
  assert.deepEqual(venues.map(v => [v.id, v.health, v.paper]), [
    ['broker', 'not-read', false], ['ex', 'answers', false], ['paper', 'not-read', true], ['paper-momentum', 'not-read', true],
    ['agent-claude-code', 'not-read', false], ['wallet', 'not-read', false], ['predict', 'not-read', false],
  ]);
  const { details, ...ex } = venues[1];
  assert.deepEqual(ex, { id: 'ex', name: 'Stand-in Exchange', usd: 21638.93, frontLine: 'Exchange', health: 'answers', healthWords: 'Answers', since: null, does: ['Trades', 'Moves money', 'Earns'], what: 'spot and perpetuals', paper: false, asOf: '2026-10-22T07:35:46.781Z', stale: false });
  assert.equal(details.holdings.length, 7);
  assert.deepEqual(details.holdings[0], { asset: 'BTC', amount: 0.12, usd: 7497.6 });
  assert.deepEqual({ ...details, holdings: [] }, { holdings: [], noTradeBecause: '', restricted: '', notServed: '', closeOnly: '', watchOnly: 'Live · read-only', keyFile: '' });
  assert.equal(venues[0].healthWords, 'Not read yet');
  // what each does, and what it trades; watchOnly — "Live · read-only", on every live connection — is a Details fact, not a thing it does
  assert.deepEqual(venues.map(v => v.does), [['Trades'], ['Trades', 'Moves money', 'Earns'], ['Trades'], ['Trades'], ['Receives'], ['Trades'], ['Trades']]);
  assert.deepEqual(venues.map(v => v.what), ['US stocks and ETFs', 'spot and perpetuals', 'perpetuals',
    'paper trading in the public markets: US stocks, coins, perpetuals with leverage, tokenised shares, event contracts', '', 'tokens, swapped from this wallet', 'event contracts']);
  assert.equal(venues[4].details.noTradeBecause, 'An agent wallet pays for things; agents trade at the venues it funds.');

  // health: the newer of the last good read and the last failure
  const health = h => venuesOf({ ...page, health: { broker: h } })[0];
  const failed = health({ lastOkAt: '2026-10-22T07:00:00.000Z', lastFailAt: '2026-10-22T07:30:00.000Z', code: 'E_VENUE_TIMEOUT', message: 'no answer' });
  assert.deepEqual([failed.health, failed.healthWords, failed.since], ['not-answering', 'Not answering', '2026-10-22T07:30:00.000Z']);
  assert.equal(health({ lastOkAt: '2026-10-22T07:30:00.000Z', lastFailAt: '2026-10-22T07:00:00.000Z' }).health, 'answers');
  assert.equal(health({ lastFailAt: '2026-10-22T07:00:00.000Z' }).health, 'not-answering');
  assert.equal(health({ lastOkAt: '2026-10-22T07:00:00.000Z', lastFailAt: '2026-10-22T07:00:00.000Z' }).health, 'not-answering', 'a failure as new as the last good read');
  assert.equal(health({ lastOkAt: 'garbled' }).health, 'not-read');
  assert.equal(health({ ms: 12 }).since, null);

  // stale in the Account's words where it says them; the details' facts; a key file is its path, never what is in it
  const hand = venuesOf({ ...page, venues: [
    { id: 'kalshi', name: 'Kalshi', usd: 'n/a', stale: 'the venue said 429', keyFile: 'credentials/kalshi/api-key.json', restricted: 'not for US persons',
      notServed: { said: 'Kalshi does not serve this location' }, closeOnly: { said: 'sells and closes only' }, trade: { can: 'unknown' }, earn: { can: false } },
    { id: 'okx', name: 'OKX', stale: true, keyFile: { apiKey: 'SECRET-KEY', secret: 'SECRET-VALUE' }, liveCan: { withdraw: true } },
  ] });
  assert.equal(hand[0].usd, null); assert.equal(hand[0].stale, 'the venue said 429'); assert.deepEqual(hand[0].does, []);
  assert.deepEqual(hand[0].details, { holdings: [], noTradeBecause: '', restricted: 'not for US persons', notServed: 'Kalshi does not serve this location', closeOnly: 'sells and closes only', watchOnly: '', keyFile: 'credentials/kalshi/api-key.json' });
  assert.equal(hand[1].stale, true); assert.deepEqual(hand[1].does, ['Moves money']); assert.equal(hand[1].details.keyFile, '');
  assert.ok(!JSON.stringify(hand).includes('SECRET'), 'no key value travels');
});

test('agentsOf: Gravit first from the seat view, then the Account agents with their limit words', () => {
  const agents = fx('agents');
  // Gravit's row: the seat view's standing and limits; the counts are the Account's for the seat's agent — null while its agents are not read
  const gravit = (cards, orders) => ({ gravit: true, name: 'Gravit', standing: 'Gravit · admitted until Nov 19', limits: ['trade · paper-1 · $100 an order · $850 of $1,000 left'], cards, orders });
  const claude = { gravit: false, name: 'Claude Code', status: 'ok', validUntil: '2026-11-21T07:35:46.778Z', limits: [
    'trade · ex, predict, wallet · $150 an order · $380.01 of $600 left',
    'venues · ex, agent-claude-code · $50 an order · $200 of $200 left',
    'payees · api.example.com · $2 an order · $20 of $20 left',
  ], cards: 1, orders: 1 };
  assert.deepEqual(agentsOf(agents, seatView()), [gravit(0, 0), claude], 'the stand-in lists no agent at the seat address');

  // the Account's own row for the seat is the agent at the seat view's address, in any case: left out, its cards and its open orders
  // counted on Gravit's row; while the seat view carries an address, a name alone hides nothing
  const seatAgent = { address: '0xAB12', name: 'Gravit', status: 'ok', limits: [], cards: [{ id: 'card-7' }, { id: 'card-9' }],
    orders: ['open', 'filled', 'partial', 'canceled', 'pending'].map((status, i) => ({ id: `g${i}`, status })) };
  const more = { ...agents, agents: [...agents.agents, seatAgent,
    { address: '0x01d', name: ' gravit ', status: 'expired', limits: [], cards: [], orders: [{ id: 'old', status: 'open' }] },
    { address: '0x9a5', name: 'Gravitas', status: 'ok', validUntil: '2026-11-01T00:00:00.000Z', limits: [{ scope: 'trade', allow: ['ex'], perPaymentUsd: 100, budgetUsd: 1000, leftUsd: 1000, expired: true }], cards: [], orders: [] },
  ] };
  const listed = agentsOf(more, seatView());
  assert.deepEqual(listed.map(a => [a.name, a.gravit, a.cards, a.orders]), [['Gravit', true, 2, 3], ['Claude Code', false, 1, 1], [' gravit ', false, 0, 1], ['Gravitas', false, 0, 0]]);
  assert.deepEqual(listed[3].limits, ['trade · ex · $100 an order · $1,000 of $1,000 left · expired']);
  // with no address on the seat view (knocking: no key yet), the seat's agents are found by name, in any case, and all counted
  const knocking = agentsOf(more, seatView({ seat: { name: 'Gravit', status: 'knocking', limits: [] } }));
  assert.deepEqual(knocking.map(a => [a.name, a.gravit, a.cards, a.orders]), [['Gravit', true, 2, 4], ['Claude Code', false, 1, 1], ['Gravitas', false, 0, 0]]);
  assert.equal(knocking[0].standing, 'Gravit · knocking — admit it on the Account page');
  // the seat's name is the seat view's
  const scout = agentsOf({ ...agents, agents: [{ name: 'SCOUT', status: 'ok' }, { name: 'Gravit', status: 'ok' }] }, seatView({ seat: { name: 'Scout', status: 'admitted', limits: [] } }));
  assert.deepEqual(scout.map(a => [a.name, a.gravit, a.standing ?? a.status]), [['Scout', true, 'Scout · admitted'], ['Gravit', false, 'ok']]);

  // a limit: an amount that is not there is no clause, never $0; a scope or an allowed id that is not a string is no word
  const probe = agentsOf({ ok: true, agents: [{ name: 'Probe', status: 'ok', limits: [
    { scope: 'trade', allow: ['ex'], perPaymentUsd: 100, budgetUsd: 1000 },
    { scope: 'trade', allow: ['ex'], perPaymentUsd: 100, budgetUsd: '1000', leftUsd: '250.5' },
    { scope: 5, allow: ['ex', 7, null, 'wallet'], perPaymentUsd: 10, budgetUsd: 20, leftUsd: 20 },
  ] }] }, null);
  assert.deepEqual(probe[0].limits, ['trade · ex · $100 an order', 'trade · ex · $100 an order · $250.5 of $1,000 left', 'ex, wallet · $10 an order · $20 of $20 left']);
  const seatLimit = { scope: 'trade', allow: ['paper-1'], perOrderUsd: 100, budgetUsd: 1000, spentUsd: 0, reservedUsd: 0, leftUsd: null, validUntil: null, expired: false };
  assert.deepEqual(agentsOf({ ok: true, agents: [] }, seatView({ seat: { name: 'Gravit', status: 'admitted', address: '0xab12', limits: [seatLimit] } }))[0].limits,
    ['trade · paper-1 · $100 an order'], 'the seat box words its limits the same way');

  // no seat view to stand on: the Account's list is the whole answer; no agents read: Gravit's row alone, its counts unknown
  const unreachable = { ok: true, url: 'http://127.0.0.1:4820', reachable: false, error: 'ECONNREFUSED' };
  assert.deepEqual(agentsOf(more, unreachable).map(a => [a.name, a.gravit]), [['Claude Code', false], ['Gravit', false], [' gravit ', false], ['Gravitas', false]]);
  assert.deepEqual(agentsOf(agents, null), [claude]);
  assert.deepEqual(agentsOf({ ok: true }, seatView()), [gravit(null, null)]);
  assert.deepEqual(agentsOf({ ok: false, error: 'no' }, null), []);
});

test('cardsOf, asksOf, requestsOf: grouped by agent; shown verbatim', () => {
  const page = fx('account');
  const [group, ...others] = cardsOf(page);
  assert.deepEqual(others, []);
  assert.equal(group.agentName, 'Claude Code');
  assert.deepEqual(group.cards, [{ id: 'card-0001', reason: 'Claude Code asks to buy 0.0479 ETH at Stand-in Exchange · market · about $117.63', usd: 119.99, expiresAt: '2026-10-22T08:05:46.830Z', shown: page.cards[0].shown }]);
  assert.equal(group.cards[0].shown.length, 12);
  assert.deepEqual(group.cards[0].shown[9], { name: 'qty', value: '' }, 'an empty field stays, empty');

  // cards without an agent address group by name, as they are named
  const card = (id, agentName, more = {}) => ({ id, flight: 'F-1', usd: 1, reason: `card ${id}`, hash: '0x00', kind: 'agentLiveOrder', ...(agentName === undefined ? {} : { agentName }), expiresAt: '2026-10-22T08:00:00.000Z', shown: [], ...more });
  const groups = cardsOf({ ...page, cards: [card('a1', 'A'), card('b1', 'B'), card('a2', 'A'), card('x1', undefined), card('x2', ''),
    card('n1', 'N', { shown: [{ name: 'qty', value: 5 }, { name: 'reduceOnly', value: false }, { name: 7, value: null }, { name: 'leg', value: { side: 'buy' } }, { name: 'legs', value: '[{"side":"buy"}]' }] })] });
  assert.deepEqual(groups.map(g => [g.agentName, g.cards.map(c => c.id)]), [['A', ['a1', 'a2']], ['B', ['b1']], ['An agent', ['x1', 'x2']], ['N', ['n1']]]);
  // a field that is not a string draws nothing, never undefined, null or [object Object], on a card the owner signs
  assert.deepEqual(groups[3].cards[0].shown, [{ name: 'qty', value: '' }, { name: 'reduceOnly', value: '' }, { name: '', value: '' }, { name: 'leg', value: '' }, { name: 'legs', value: '[{"side":"buy"}]' }]);
  // cards with an agent address group by it, in any case, under the group's first name: one display name can be two agents
  const byAgent = cardsOf({ ...page, cards: [card('c1', undefined, { agent: '0xCCC' }), card('a1', 'Claude Code', { agent: '0xAAA' }), card('c2', 'Scout', { agent: '0xccc' }),
    card('a2', 'Claude Code (renamed)', { agent: '0xaaa' }), card('d1', 'Claude Code', { agent: '0xddd' }), card('x1', 'Claude Code')] });
  assert.deepEqual(byAgent.map(g => [g.agentName, g.cards.map(c => c.id)]), [['Scout', ['c1', 'c2']], ['Claude Code', ['a1', 'a2']], ['Claude Code', ['d1']], ['Claude Code', ['x1']]]);

  assert.deepEqual(asksOf(page), [
    { id: 'ask-0001', agentName: 'Claude Code', kind: 'limit', text: 'Raise my trading budget to $1,000 so I can finish the SOL position you asked for', expiresAt: '2026-10-23T07:35:46.836Z' },
    { id: 'ask-0002', agentName: 'Claude Code', kind: 'venue', text: 'Connect Stand-in Public Exchange: DOGE trades only there', expiresAt: '2026-10-23T07:35:46.838Z' },
  ]);
  assert.deepEqual(requestsOf(page), []);
  assert.deepEqual(requestsOf({ ...page, requests: [{ address: '0xab12', name: 'Gravit', at: '2026-10-22T07:00:00.000Z' }] }), [{ address: '0xab12', name: 'Gravit', at: '2026-10-22T07:00:00.000Z' }]);
});

test('an unrecognised page is unreadable, never a number: every function answers empty on {ok:true} alone', () => {
  const bare = { ok: true };
  const noWorth = { lead: { label: 'Net worth', usd: null }, second: null, paperLeads: false };
  assert.equal(pageOk(bare), false);
  assert.deepEqual(headOf(bare), { mode: '', writes: '' });
  assert.deepEqual(worthOf(bare), noWorth);
  assert.deepEqual(worthOf({ ok: true, totalUsd: 29138.1, mode: 'guard' }, fx('holdings'), fx('holdings-paper')), noWorth, 'a total on a body that is not a page is not drawn');
  assert.deepEqual(changeOf(bare), { usd: null, pct: null, partial: false, first: null, sinceStartUsd: null, rebuilt: false });
  for (const view of [assetsOf, positionsOf, openOrdersOf, missingWords, statementLinesOf, venuesOf, agentsOf, cardsOf, asksOf, requestsOf]) assert.deepEqual(view(bare), [], view.name);
  assert.equal(statementCsvOf(statementLinesOf(bare)), 'date,type,kind,description,amount,fee,status,by\r\n');
  // the page with ok false, or a read that is not an answer, is no page either
  const refused = { ...fx('account'), ok: false };
  assert.deepEqual([headOf(refused), worthOf(refused, null, fx('holdings-paper')), openOrdersOf(refused), venuesOf(refused), cardsOf(refused), asksOf(refused), requestsOf(refused)],
    [{ mode: '', writes: '' }, noWorth, [], [], [], [], []]);
  assert.deepEqual([assetsOf({ ...fx('holdings'), ok: false }), statementLinesOf({ ...fx('statement'), ok: false }), agentsOf({ ...fx('agents'), ok: false })], [[], [], []]);

  // pure: the views leave the bodies as they found them, the lists they sort included
  const holdings = fx('holdings'), statement = fx('statement');
  const bodies = [fx('account'), { ...holdings, rows: [...holdings.rows].reverse() }, fx('holdings-paper'), fx('history'), { ...statement, lines: [...statement.lines].reverse() }, fx('agents')];
  const before = JSON.stringify(bodies);
  const [page, held, paper, history, lines, agents] = bodies;
  headOf(page); worthOf(page, held, paper); changeOf(history); assetsOf(held); positionsOf(held); openOrdersOf(page); missingWords(held.missing);
  statementCsvOf(statementLinesOf(lines)); venuesOf(page); agentsOf(agents, seatView()); cardsOf(page); asksOf(page); requestsOf(page);
  assert.equal(JSON.stringify(bodies), before);
});
