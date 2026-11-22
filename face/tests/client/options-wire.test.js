// The option chains' wire (spec 2026-11-22 §5.4): a chain page's key and one chain as /api/options answers it, over answers in the
// market's shapes (tests/client/helpers/options.js, after market/src/live/options.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { optionKeyOf, isOptionKey, optionChainOf, OPTION_COINS } from '../../client/js/wire/options.js';
import { btcChain, aaplChain, chainAnswer, noOptionsBody } from './helpers/options.js';

test('optionKeyOf: a coin, a US ticker, a class share; the keys it refuses', () => {
  assert.deepEqual(optionKeyOf('opt:BTC'), { underlying: 'BTC' });
  assert.deepEqual(optionKeyOf('opt:AAPL'), { underlying: 'AAPL' });
  assert.deepEqual(optionKeyOf('opt:BRK.A'), { underlying: 'BRK.A' });
  for (const bad of ['opt:', 'opt:btc', 'opt:BTC USD', 'opt:.A', 'stock:AAPL', 'coin:BTC', `opt:${'A'.repeat(16)}`, '', null, 7]) {
    assert.equal(optionKeyOf(bad), null, String(bad));
    assert.equal(isOptionKey(bad), false);
  }
  assert.deepEqual(OPTION_COINS, ['BTC', 'ETH', 'SOL', 'XRP', 'AVAX', 'TRX', 'HYPE'], "the market's coins (reads.ts OPTION_COINS)");
});

test('optionChainOf: the chain as the market gives it, a figure it does not give null, the strikes in order', () => {
  const chain = btcChain();
  chain.strikes.reverse();
  const c = optionChainOf(chainAnswer(chain));
  assert.deepEqual([c.underlying, c.venue, c.venueName, c.price, c.expiry, c.atmStrike, c.quoteFrom], ['BTC', 'deribit', 'Deribit', 60487.12, '2026-11-23', 60000, 'Deribit']);
  assert.deepEqual(c.expiries, ['2026-11-23', '2026-11-24', '2026-11-28', '2026-12-26', '2027-03-26']);
  assert.deepEqual(c.strikes.map(s => s.strike), [58000, 60000, 62000], 'in order, whatever order they came in');
  const put = c.strikes[0].put;
  assert.deepEqual([put.bid, put.ask, put.last, put.iv, put.unit, put.change, put.changePct], [0.0021, 0.0025, null, 44.1, 'BTC', null, null], 'no last is null, never 0');
  assert.equal(c.strikes[0].call.changePct, 3.2);
  assert.equal(c.strikes[0].call.usd.bid, 0.0405 * 60487.12);
  // a Nasdaq chain: dollars, an absolute change, no IV, its last trade in Nasdaq's words
  const a = optionChainOf(chainAnswer(aaplChain()));
  assert.deepEqual([a.venue, a.lastTrade, a.strikes[0].call.change, a.strikes[0].call.changePct, a.strikes[0].call.iv, a.strikes[0].call.usd], ['nasdaq', 'LAST TRADE: $342.56 (AS OF NOV 20, 2026)', 0.45, null, null, null]);
  assert.equal(a.strikes[1].put.last, null);
  assert.equal(c.stale, false);
  assert.equal(optionChainOf({ ...chainAnswer(btcChain()), stale: true }).stale, true, "the proxy's kept answer, re-served");
  // a refusal, or a body of another shape, is no chain
  for (const bad of [noOptionsBody(), { ok: true }, { ok: true, value: { ...btcChain(), venue: 'binance' } }, { ok: true, value: { ...btcChain(), strikes: null } }, null, 'x']) assert.equal(optionChainOf(bad), null);
  // a strike that is no number is left out
  const odd = btcChain();
  odd.strikes.push({ strike: '--', call: null });
  assert.equal(optionChainOf(chainAnswer(odd)).strikes.length, 3);
});
