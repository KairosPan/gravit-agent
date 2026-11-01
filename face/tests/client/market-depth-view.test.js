// A market's page's four reads beside its price (plan 4a Task 4): the pure views over the Account's asset sheet, its order book,
// its latest trades and a perpetual's funding, over the stand-in's answers (tests/fixtures/account/asset-*.json, book.json,
// trades.json) and shapes the Account's service types give (service.ts BookView, TradesView, VenueFunding).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assetKeyOf, hereOf, costOf, bookOf, tradesOf, fundingOf, fundingMissingOf } from '../../client/js/host/market-depth-view.js';

const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));

test('assetKeyOf reads a market as the Account’s own page does', () => {
  assert.equal(assetKeyOf({ kind: 'coin', base: 'btc' }), 'crypto:BTC');
  assert.equal(assetKeyOf({ kind: 'perp', base: 'BTC' }), 'crypto:BTC', 'a perpetual is its coin');
  assert.equal(assetKeyOf({ kind: 'stock', base: 'NVDA' }), 'equity:NVDA');
  assert.equal(assetKeyOf({ kind: 'rwa', base: 'USDY' }), 'rwa:USDY');
  assert.equal(assetKeyOf({ kind: 'event', at: [{ venue: 'pm', symbol: 'X:Yes', connected: false }, { venue: 'predict', symbol: 'SI-FEDCUT-DEC:YES', connected: true }] }), 'event:SI-FEDCUT-DEC:YES');
  for (const item of [{ kind: 'event', at: [{ symbol: 'X', connected: false }] }, { kind: 'coin' }, { kind: 'other', base: 'X' }, null, 'coin:BTC']) assert.equal(assetKeyOf(item), '');
});

test('hereOf names who placed each order and lists the agents’ actions', () => {
  const page = fx('account');
  const here = hereOf(fx('asset-sol'), page);
  assert.deepEqual(here.orders.map(o => [o.id, o.who]), [['ord-0010', 'Agent · Claude Code'], ['ord-0004', 'You'], ['ord-0002', 'You']]);
  assert.equal(here.orders[0].symbol, 'SOL/USDT');
  assert.equal(here.orders[1].stopPrice, 137.83, 'as openOrdersOf rows: the fields Change… seeds from');
  // the agents: its order at the page's key address, then the statement line by it
  assert.deepEqual(here.agents.map(a => a.type), ['order', 'line']);
  assert.equal(here.agents[0].order.who, 'Agent · Claude Code');
  assert.equal(here.agents[1].line.by, 'Claude Code, inside its limit');
  assert.ok(here.agents.every(a => a.type !== 'line' || a.line.by !== 'You'), 'no owner line among them');
  // no page to name the agent: An agent
  assert.equal(hereOf(fx('asset-sol'), null).orders[0].who, 'An agent');
  // what is held, its cost, no positions
  assert.deepEqual([here.held.asset, here.held.amount, here.held.usd], ['SOL', 25, 3571.25]);
  assert.deepEqual(costOf(here, { key: 'crypto:SOL' }), { key: 'crypto:SOL', side: '', symbol: '', avgCostUsd: null, costUsd: null, coveredQty: 0, ofQty: 25, words: 'cost known for 0 of 25 SOL' });
  assert.deepEqual(here.positions, []);
  assert.deepEqual(here.missing, []);

  // a coin with a perpetual held on it: the position as positionsOf words it, its cost by position:<venue>:<symbol>
  const btc = hereOf(fx('asset-btc'), page);
  assert.deepEqual(btc.positions.map(p => [p.venue, p.symbol, p.kind, p.side, p.qty, p.leverage]), [['ex', 'BTC/USDT:USDT', 'perp', 'long', 0.01, 3]]);
  assert.deepEqual(costOf(btc, btc.positions[0]), {
    key: 'position:ex:BTC/USDT:USDT', side: 'long', symbol: 'BTC/USDT:USDT', avgCostUsd: 60520, costUsd: null, coveredQty: 0.01, ofQty: 0.01,
    words: 'cost known for 0.01 of 0.01 contracts',
  });
  assert.deepEqual(btc.orders.map(o => o.who), ['You']);
  assert.deepEqual(btc.agents, [], 'the owner’s alone: no agent acts here');
  // an event contract's position: its cost is its own key's
  const fed = hereOf(fx('asset-event'), page);
  assert.equal(fed.held, null, 'no holdings row');
  assert.equal(costOf(fed, fed.positions[0]).costUsd, 31.5);
  // the venues it could not read, one sentence each
  const missed = hereOf({ ...fx('asset-sol'), missing: [{ venue: '*', venueName: 'every venue', why: 'x', part: 'compare' }, { venue: 'ex', venueName: 'Stand-in Exchange', why: 'y' }] }, page);
  assert.deepEqual(missed.missing, ['every venue did not answer', 'Stand-in Exchange did not answer']);
});

test('hereOf keeps the paper accounts’ holding apart: its row and cost, its positions but the spot one', () => {
  const body = {
    ok: true, key: 'crypto:BTC', positions: [], orders: [], lines: [], missing: [],
    cost: [],
    paper: {
      row: { key: 'crypto:BTC', asset: 'BTC', class: 'crypto', amount: 0.1, usd: 6300, venues: [{ venue: 'paper-1', venueName: 'Paper account', amount: 0.1, usd: 6300 }] },
      positions: [
        { venue: 'paper-1', venueName: 'Paper account', symbol: 'BTC/USD', kind: 'spot', side: 'long', qty: 0.1, paper: true },
        { venue: 'paper-1', venueName: 'Paper account', symbol: 'BTC-PERP', kind: 'perp', side: 'short', qty: 0.02 },
      ],
      cost: [
        { key: 'crypto:BTC', coveredQty: 0.1, ofQty: 0.1, avgCostUsd: 60010, words: 'cost known for 0.1 of 0.1 BTC' },
        { key: 'position:paper-1:BTC-PERP', side: 'short', symbol: 'BTC-PERP', avgCostUsd: 61000, coveredQty: 0.02, ofQty: 0.02 },
      ],
    },
  };
  const here = hereOf(body, fx('account'));
  assert.equal(here.held, null, 'no real row');
  assert.deepEqual([here.paperHeld.key, here.paperHeld.amount, here.paperHeld.usd], ['crypto:BTC', 0.1, 6300]);
  assert.deepEqual(here.positions.map(p => [p.symbol, p.kind, p.paper]), [['BTC-PERP', 'perp', true]], 'the spot position is the row again');
  assert.equal(costOf(here, { key: 'crypto:BTC' }), null, 'the real row’s cost is not the paper one');
  assert.equal(costOf(here, { key: 'crypto:BTC', paper: true }).avgCostUsd, 60010);
  assert.equal(costOf(here, here.positions[0]).avgCostUsd, 61000);
  // a sheet with no paper accounts connected has none
  assert.equal(hereOf(fx('asset-sol'), fx('account')).paperHeld, null);
});

test('hereOf of a refusal or an unknown body is empty', () => {
  const empty = { held: null, paperHeld: null, positions: [], orders: [], cost: [], paperCost: [], agents: [], missing: [] };
  for (const body of [
    { ok: false, refusal: { code: 'E_ACCOUNT_BAD_ACTION', message: 'an asset is named by its key' } },
    { ok: true }, { ok: true, positions: 'x', orders: [] }, { positions: [], orders: [] }, null, undefined, '<!DOCTYPE html>', [],
  ]) assert.deepEqual(hereOf(body, fx('account')), empty, JSON.stringify(body));
  assert.equal(costOf(empty, { venue: 'ex', symbol: 'BTC' }), null);
});

test('bookOf keeps best first and a null size', () => {
  const body = {
    ok: true, venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT',
    book: { bids: [[62495.6, 0.4], [62495, null], ['x', 1]], asks: [[62502, 1.25], [62503.5, 2]], at: '2026-11-01T12:06:43.836Z', from: 'Stand-in Exchange', depth: 'full' },
  };
  assert.deepEqual(bookOf(body), {
    bids: [{ price: 62495.6, size: 0.4 }, { price: 62495, size: null }], asks: [{ price: 62502, size: 1.25 }, { price: 62503.5, size: 2 }],
    from: 'Stand-in Exchange', at: '2026-11-01T12:06:43.836Z', depth: 'full', public: false,
  });
  // the stand-in's: the best bid and ask alone, no size given
  const top = bookOf(fx('book'));
  assert.equal(top.depth, 'top');
  assert.deepEqual([top.bids, top.asks], [[{ price: 62495.6, size: null }], [{ price: 62502, size: null }]]);
  assert.equal(bookOf({ ...fx('book'), public: true }).public, true);
  for (const body of [{ ok: false, refusal: {} }, { ok: true }, null, '<html>']) assert.deepEqual(bookOf(body), { bids: [], asks: [], from: '', at: '', depth: '', public: false });
});

test('tradesOf carries the none sentence', () => {
  assert.deepEqual(tradesOf(fx('trades')), { trades: [], none: 'Stand-in Exchange publishes no trades the account can read', public: false });
  const t = tradesOf({
    ok: true, venue: 'ex', symbol: 'BTC/USDT', public: true,
    trades: [
      { price: 62500, size: 0.01, side: 'buy', at: '2026-11-01T12:00:01.000Z' },
      { price: 62501, size: 0.02, at: '2026-11-01T12:00:03.000Z' },
      { price: 'x', size: 1, at: '2026-11-01T12:00:04.000Z' },
      { price: 62499, size: 0.5, side: 'sell', at: '2026-11-01T12:00:02.000Z' },
    ],
  });
  assert.deepEqual(t.trades, [
    { price: 62501, size: 0.02, side: '', at: '2026-11-01T12:00:03.000Z' },
    { price: 62499, size: 0.5, side: 'sell', at: '2026-11-01T12:00:02.000Z' },
    { price: 62500, size: 0.01, side: 'buy', at: '2026-11-01T12:00:01.000Z' },
  ], 'newest first; a side only where the source says it; a price that does not parse left out');
  assert.deepEqual([t.none, t.public], ['', true]);
  assert.deepEqual(tradesOf({ ok: false, unreachable: 'ECONNREFUSED' }), { trades: [], none: '', public: false });
});

test('fundingOf keeps the page’s symbol only, newest first', () => {
  const ex = {
    ok: true, missing: [], lines: [
      { at: '2026-11-01T10:00:00.000Z', symbol: 'BTC/USDT:USDT', side: 'long', qty: 0.01, rate: 0.0001, usd: 0.06, venue: 'ex', venueName: 'Stand-in Exchange' },
      { at: '2026-11-01T11:00:00.000Z', symbol: 'ETH/USDT:USDT', side: 'long', qty: 1, rate: 0.0001, usd: 0.3, venue: 'ex', venueName: 'Stand-in Exchange' },
    ],
  };
  const paper = {
    ok: true, missing: [], lines: [
      { at: '2026-11-01T11:00:00.000Z', symbol: 'BTC/USDC:USDC', side: 'short', qty: 0.5, rate: -0.00002, usd: -0.62, venue: 'paper', venueName: 'Paper', paper: true, quoted: true },
    ],
  };
  assert.deepEqual(fundingOf([ex, paper, { ok: false, refusal: { message: 'lists no funding' } }, null], ['BTC/USDT:USDT', 'BTC/USDC:USDC']), [
    { at: '2026-11-01T11:00:00.000Z', venueName: 'Paper', side: 'short', qty: 0.5, rate: -0.00002, usd: -0.62, paper: true },
    { at: '2026-11-01T10:00:00.000Z', venueName: 'Stand-in Exchange', side: 'long', qty: 0.01, rate: 0.0001, usd: 0.06, paper: false },
  ]);
  assert.deepEqual(fundingOf([ex], 'ETH/USDT:USDT').map(l => l.usd), [0.3], 'one symbol given as a string');
  assert.deepEqual(fundingOf('x', 'BTC'), []);
  // the venues the read could not read, as the Account's page says them; among the page's venues when given
  const missed = { ok: true, lines: [], missing: [{ venue: 'ex', venueName: 'Stand-in Exchange', why: 'no answer in time. ' }, { venue: 'hl', venueName: 'Hyperliquid', why: 'rate limited' }] };
  assert.equal(fundingMissingOf(missed), 'Not read: Stand-in Exchange: no answer in time · Hyperliquid: rate limited.');
  assert.equal(fundingMissingOf(missed, ['hl']), 'Not read: Hyperliquid: rate limited.');
  assert.equal(fundingMissingOf(missed, ['paper']), '');
  assert.equal(fundingMissingOf({ ok: false, refusal: {} }), '');
});
