// The explore join (plan A2 Task 6): the market's public rows and the account's connected rows, as one explore body the views
// read — a public line left out where a connected venue speaks for its connection or the venues read says its venue does not
// serve here; a row both list carrying the connected lines first, then the public, then the paper; a stale connected half
// dropped; either half down said in `missing`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joinExplore } from '../../client/js/host/explore-join.js';
import { spoken } from './helpers/spoken.js';

const pub = (venue, symbol, connector, over = {}) => ({ venue, venueName: venue, symbol, connected: false, public: true, canTrade: false, connector, connectTo: venue, price: 100, ...over });
const con = (venue, symbol, over = {}) => ({ venue, venueName: venue, symbol, connected: true, public: false, canTrade: true, price: 101, ...over });
const row = (key, at, over = {}) => ({ key, kind: key.split(':')[0], name: key, base: key.split(':')[1], price: 100, volumeUsd24h: 1_000, tabs: ['all', 'crypto'], at, ...over });
const body = (items, over = {}) => ({
  ok: true, asOf: '2026-11-03T08:00:00.000Z', items, movers: [], closing: [], mostTraded: [],
  tabs: [{ id: 'all', label: 'All', count: items.length }, { id: 'crypto', label: 'Crypto', count: items.length }, { id: 'stocks', label: 'Stocks', count: 0 }],
  missing: [], notes: [], ...over,
});
const linesOf = (b, key) => b.items.find(i => i.key === key)?.at.map(l => `${l.venue}|${l.symbol}`);
const keys = b => b.items.map(i => i.key);

test('a public line is left out where a connected venue speaks for its connection', () => {
  const market = body([
    row('coin:BTC', [pub('okx', 'BTC/USDT', 'live:exchange:okx'), pub('kraken', 'BTC/USD', 'live:exchange:kraken')]),
    row('coin:XRP', [pub('okx', 'XRP/USDT', 'live:exchange:okx')]),
  ]);
  const connected = body([row('coin:BTC', [con('my-okx', 'BTC/USDT')])]);
  const venues = [{ id: 'my-okx', connector: 'live:exchange:okx', paper: false }];
  const joined = joinExplore(market, connected, { venues });
  assert.deepEqual(linesOf(joined, 'coin:BTC'), ['my-okx|BTC/USDT', 'kraken|BTC/USD'], "okx's public line goes: the connected okx speaks for it");
  assert.equal(joined.items.some(i => i.key === 'coin:XRP'), false, 'a row left with no lines is dropped');
  // a paper venue never speaks for a public connection
  const paper = joinExplore(market, connected, { venues: [{ id: 'my-okx', connector: 'live:exchange:okx', paper: true }] });
  assert.deepEqual(linesOf(paper, 'coin:BTC'), ['my-okx|BTC/USDT', 'okx|BTC/USDT', 'kraken|BTC/USD']);
});

test('a public line is left out where the venues read says its venue does not serve here', () => {
  const market = body([
    row('coin:BTC', [pub('okx', 'BTC/USDT', 'live:exchange:okx'), pub('kraken', 'BTC/USD', 'live:exchange:kraken'), pub('geo', 'BTC/USD', 'live:geo')]),
    row('event:X', [], { kind: 'event', outcomes: [{ label: 'YES', at: [pub('okx', 'X-YES', 'live:exchange:okx'), pub('kraken', 'X-YES', 'live:exchange:kraken')] }] }),
  ]);
  const here = [{ connector: 'live:exchange:okx', verdict: 'not-served' }, { connector: 'live:geo', verdict: 'close-only' }, { connector: 'live:exchange:kraken', verdict: 'open' }];
  const joined = joinExplore(market, body([]), { here });
  assert.deepEqual(linesOf(joined, 'coin:BTC'), ['kraken|BTC/USD']);
  assert.deepEqual(joined.items.find(i => i.key === 'event:X').outcomes[0].at.map(l => l.venue), ['kraken'], "an outcome's lines too");
  const closed = joinExplore(market, body([]), { here: [{ connector: 'live:exchange:kraken', verdict: 'closed' }] });
  assert.deepEqual(linesOf(closed, 'coin:BTC'), ['okx|BTC/USDT', 'geo|BTC/USD']);
});

test('a row both list carries the connected lines first, then the public, then the paper', () => {
  const market = body([row('coin:BTC', [pub('kraken', 'BTC/USD', 'live:exchange:kraken')], { volumeUsd24h: 5_000, name: 'Bitcoin (public)' })]);
  const connected = body([row('coin:BTC', [con('paper-1', 'BTC/USD', { paper: true }), con('my-okx', 'BTC/USDT')], { volumeUsd24h: 9_000, name: 'Bitcoin (connected)', icon: undefined })]);
  const joined = joinExplore(market, connected, {});
  assert.deepEqual(linesOf(joined, 'coin:BTC'), ['my-okx|BTC/USDT', 'kraken|BTC/USD', 'paper-1|BTC/USD']);
  assert.equal(joined.items[0].name, 'Bitcoin (connected)', 'the connected row trades more: it lends the row');
  const quieter = joinExplore(market, body([row('coin:BTC', [con('my-okx', 'BTC/USDT')], { volumeUsd24h: 10, name: 'Bitcoin (connected)', closeTime: 'x' })]), {});
  assert.equal(quieter.items[0].name, 'Bitcoin (public)', 'the market row trades more: it lends the row');
  assert.equal(quieter.items[0].closeTime, 'x', 'a field the lender lacks comes from the other');
});

test('a paper row lends no price where the market lists the thing', () => {
  const market = body([row('coin:DOGE', [pub('kraken', 'DOGE/USD', 'live:exchange:kraken')], { price: 0.2, volumeUsd24h: 5 })]);
  const connected = body([row('coin:DOGE', [con('paper-1', 'DOGE/USD', { paper: true })], { price: 9, volumeUsd24h: 1e12, paper: true })]);
  const joined = joinExplore(market, connected, { venues: [{ id: 'paper-1', connector: 'live:paper', paper: true }] });
  assert.equal(joined.items[0].price, 0.2);
  assert.deepEqual(linesOf(joined, 'coin:DOGE'), ['kraken|DOGE/USD', 'paper-1|DOGE/USD']);
});

test("a row only the Account lists competes on the sort with the market's rows", () => {
  // all rows at 1,000 of volume unless named: the market's first on a tie
  const market = body([row('coin:BTC', [pub('kraken', 'BTC/USD', 'live:exchange:kraken')], { volumeUsd24h: 5_000 }), row('coin:ETH', [pub('kraken', 'ETH/USD', 'live:exchange:kraken')])],
    { movers: [row('coin:ETH', [pub('kraken', 'ETH/USD', 'live:exchange:kraken')], { changePct24h: 2 })] });
  const nvda = row('stock:NVDA', [con('broker', 'NVDA')], { tabs: ['all', 'stocks'], volumeUsd24h: 3_000, changePct24h: -9 });
  const connected = body([nvda, row('coin:BTC', [con('my-okx', 'BTC/USDT')])], { movers: [nvda], missing: [{ venue: 'x', venueName: 'X', why: 'x is down' }], notes: ['n1'] });
  const joined = joinExplore({ ...market, notes: ['n1', 'n0'], china: { status: { state: 'open' } } }, connected, { limit: 200 });
  assert.deepEqual(keys(joined), ['coin:BTC', 'stock:NVDA', 'coin:ETH'], 'one list sorted by volume, the account-only row among them');
  assert.deepEqual(keys(joinExplore(market, connected, { limit: 2 })), ['coin:BTC', 'stock:NVDA'], 'then cut once at the limit');
  assert.deepEqual(keys(joinExplore(market, connected, { sort: 'movers', limit: 200 })), ['stock:NVDA', 'coin:BTC', 'coin:ETH'], 'the sort asked for: the biggest move first');
  assert.deepEqual(keys(joinExplore(market, connected, { q: 'eth', limit: 200 })), ['coin:ETH', 'coin:BTC', 'stock:NVDA'], 'a search: the row that is what was typed first');
  assert.deepEqual(joined.tabs.map(t => [t.id, t.label, t.count]), [['all', 'All', 3], ['crypto', 'Crypto', 2], ['stocks', 'Stocks', 1]], "the market's tabs, the connected-only rows counted in");
  assert.deepEqual(joined.movers.map(i => i.key), ['stock:NVDA', 'coin:ETH'], 'movers merged and sorted by the move');
  assert.deepEqual(joined.missing, [{ venue: 'x', venueName: 'X', why: 'x is down' }]);
  assert.deepEqual(joined.notes, ['n1', 'n0']);
  assert.equal(joined.asOf, market.asOf);
  assert.deepEqual(joined.china, { status: { state: 'open' } });
  assert.equal(joined.ok, true);
});

test('the market half full at the limit: an account-only row that sorts high enough makes the cut, one that does not is cut', () => {
  const LIMIT = 3;
  const market = body([5_000, 4_000, 3_000].map((v, n) => row(`coin:M${n}`, [pub('kraken', `M${n}/USD`, 'live:exchange:kraken')], { volumeUsd24h: v })));
  const high = row('stock:HIGH', [con('broker', 'HIGH')], { tabs: ['all', 'stocks'], volumeUsd24h: 4_500 });
  const low = row('stock:LOW', [con('broker', 'LOW')], { tabs: ['all', 'stocks'], volumeUsd24h: 10 });
  const joined = joinExplore(market, body([high, low]), { limit: LIMIT });
  assert.deepEqual(keys(joined), ['coin:M0', 'stock:HIGH', 'coin:M1'], 'HIGH makes the cut, pushing the quietest market row out');
  assert.equal(keys(joined).includes('stock:LOW'), false, 'LOW sorts below every market row: cut');
  // the curated Predictions list keeps the market's order, the account's own rows after it
  const ev = (key, v) => row(key, [pub('kalshi', key, 'live:kalshi')], { kind: 'event', tabs: ['all', 'predictions'], volumeUsd24h: v });
  const curated = joinExplore(body([ev('event:A', 1), ev('event:B', 9)]), body([ev('event:C', 99)]), { tab: 'predictions', limit: 200 });
  assert.deepEqual(keys(curated), ['event:A', 'event:B', 'event:C']);
});

test('a stale connected half is dropped, and missing says the Account is not answering', () => {
  const market = body([row('coin:BTC', [pub('kraken', 'BTC/USD', 'live:exchange:kraken')])]);
  const connected = body([row('coin:BTC', [con('my-okx', 'BTC/USDT')]), row('stock:NVDA', [con('broker', 'NVDA')])], { stale: true });
  const joined = joinExplore(market, connected, {});
  assert.deepEqual(linesOf(joined, 'coin:BTC'), ['kraken|BTC/USD'], 'no connected line is offered on a dead account');
  assert.deepEqual(keys(joined), ['coin:BTC']);
  assert.deepEqual(spoken(joined.missing), [{ venue: 'account', venueName: 'the Account', why: 'The Account is not answering: the venues connected are not listed' }]);
  assert.equal(joined.stale, undefined);
  // a stale market half is kept, said stale
  const old = joinExplore({ ...market, stale: true }, body([]), {});
  assert.equal(old.stale, true);
  assert.deepEqual(keys(old), ['coin:BTC']);
  assert.equal(joinExplore(null, null, {}), null, 'both halves down: nothing to draw');
});

test('with the connected half down or stale, a connected venue no longer speaks for its public line', () => {
  const market = body([
    row('coin:BTC', [pub('okx', 'BTC/USDT', 'live:exchange:okx')]),
    row('coin:ETH', [pub('okx', 'ETH/USDT', 'live:exchange:okx'), pub('kraken', 'ETH/USD', 'live:exchange:kraken')]),
  ]);
  const venues = [{ id: 'my-okx', connector: 'live:exchange:okx', paper: false }];
  const stale = body([row('coin:BTC', [con('my-okx', 'BTC/USDT')])], { stale: true });
  for (const connected of [null, stale]) {
    const joined = joinExplore(market, connected, { venues });
    assert.deepEqual(keys(joined), ['coin:BTC', 'coin:ETH'], 'the row whose only line is the public okx one stays');
    assert.deepEqual(linesOf(joined, 'coin:BTC'), ['okx|BTC/USDT'], 'the screens fall back to the public data');
    assert.deepEqual(linesOf(joined, 'coin:ETH'), ['okx|ETH/USDT', 'kraken|ETH/USD']);
  }
  // not landed yet is not down: the connected okx still speaks for its line
  assert.equal(joinExplore(market, undefined, { venues }).items.some(i => i.key === 'coin:BTC'), false);
});

test('the market down: the connected rows alone, and missing says the market is not answering', () => {
  const connected = body([row('coin:BTC', [con('my-okx', 'BTC/USDT')]), row('stock:NVDA', [con('broker', 'NVDA')], { tabs: ['all', 'stocks'] })],
    { tabs: [{ id: 'all', label: 'All', count: 2 }, { id: 'stocks', label: 'Stocks', count: 1 }] });
  const joined = joinExplore(null, connected, {});
  assert.deepEqual(keys(joined), ['coin:BTC', 'stock:NVDA']);
  assert.deepEqual(spoken(joined.missing), [{ venue: 'market', venueName: 'the market', why: 'The market is not answering: public markets are not listed' }]);
  assert.deepEqual(joined.tabs.map(t => [t.id, t.count]), [['all', 2], ['stocks', 1]]);
  assert.equal(joined.ok, true);
});

test('a half not landed yet is no failure: nothing said missing for it', () => {
  const market = body([row('coin:BTC', [pub('kraken', 'BTC/USD', 'live:exchange:kraken')])]);
  const joined = joinExplore(market, undefined, {});
  assert.deepEqual(joined.missing, []);
  assert.deepEqual(keys(joined), ['coin:BTC']);
  assert.equal(joinExplore(undefined, undefined, {}), null);
});
