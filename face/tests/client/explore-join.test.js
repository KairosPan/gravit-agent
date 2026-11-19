// The explore join (plan A2 Task 6): the market's public rows and the account's connected rows, as one explore body the views
// read — a public line left out where a connected venue speaks for its connection or the venues read says its venue does not
// serve here; a row both list carrying the connected lines first, then the public, then the paper; a stale connected half
// dropped; either half down said in `missing`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joinExplore } from '../../client/js/host/explore-join.js';
import { rowsOf, pageOf, exploreQueryOf } from '../../client/js/host/market-view.js';
import { renderMarketsScreen } from '../../client/js/render/markets.js';
import { emptyState } from '../../client/js/data/empty.js';
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

test('an explicit More provider keeps only its public lines and keeps unavailable trading routes read-only', () => {
  const market = body([
    row('coin:BTC', [pub('okx', 'BTC/USDT', 'live:exchange:okx'), pub('kraken', 'BTC/USD', 'live:exchange:kraken')]),
    row('coin:ETH', [pub('okx', 'ETH/USDT', 'live:exchange:okx')]),
    row('coin:SOL', [pub('kraken', 'SOL/USD', 'live:exchange:kraken')]),
  ]);
  const connected = body([row('coin:BTC', [con('practice', 'BTC/USDT', { paper: true, connector: 'live:paper' })], { paper: true, price: 99, volumeUsd24h: undefined })]);
  const joined = joinExplore(market, connected, { scope: 'more', source: 'okx', here: [{ connector: 'live:exchange:okx', verdict: 'not-served' }] });
  assert.deepEqual(keys(joined), ['coin:BTC', 'coin:ETH']);
  assert.deepEqual(linesOf(joined, 'coin:BTC'), ['okx|BTC/USDT', 'practice|BTC/USDT']);
  for (const item of joined.items) for (const line of item.at.filter(line => line.public)) {
    assert.equal(line.venue, 'okx');
    assert.equal(line.canTrade, false);
    assert.equal(line.connectTo, undefined);
  }
  assert.equal(joined.items[0].volumeUsd24h, 1_000, 'the paper line borrows its matching public statistics');
  const s = emptyState();
  s.route = { screen: 'markets', id: 'coin:ETH' };
  s.markets = { ...s.markets, scope: 'more', source: 'okx', explore: { all: { status: 'ready', data: joined } } };
  assert.doesNotMatch(renderMarketsScreen(s), /Connect to trade/);
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

test('connected-only categories join the public tabs and retain server totals beyond either list limit', () => {
  const connector = 'live:hyperliquid-trade';
  const nvda = row('perp:xyz:NVDA', [pub('trade-xyz', 'xyz:NVDA-PERP', connector)], { category: 'stocks', tabs: ['all', 'stocks'], volumeUsd24h: 5_000 });
  const gold = row('perp:xyz:GOLD', [con('wallet', 'XYZ-GOLD/USDC:USDC', { connector, dex: 'xyz' })], { category: 'commodities', tabs: ['all', 'commodities'] });
  const market = body([nvda], { tabs: [{ id: 'all', label: 'All', count: 80 }, { id: 'stocks', label: 'Stocks', count: 80 }] });
  const connected = body([gold], { tabs: [{ id: 'all', label: 'All', count: 9 }, { id: 'commodities', label: 'Commodities', count: 9 }, { id: 'fx', label: 'FX', count: 0 }] });
  const joined = joinExplore(market, connected, { scope: 'xyz', limit: 200 });
  assert.deepEqual(keys(joined), ['perp:xyz:NVDA', 'perp:xyz:GOLD']);
  assert.deepEqual(joined.tabs.map(t => [t.id, t.label, t.count]), [['all', 'All', 81], ['stocks', 'Stocks', 80], ['commodities', 'Commodities', 9]]);
  const capped = joinExplore(market, connected, { scope: 'xyz', limit: 1 });
  assert.deepEqual(keys(capped), ['perp:xyz:NVDA']);
  assert.deepEqual(capped.tabs, joined.tabs, 'the final visible list cut changes no category totals');
});

test('a connected row removed by the source scope adds neither a count nor a category tab', () => {
  const connector = 'live:hyperliquid-trade';
  const nvda = row('perp:xyz:NVDA', [pub('trade-xyz', 'xyz:NVDA-PERP', connector)], { category: 'stocks', tabs: ['all', 'stocks'] });
  const native = row('perp:BTC', [con('wallet', 'BTC/USDC:USDC', { connector, dex: '' })], { category: 'crypto', tabs: ['all', 'crypto'] });
  const gold = row('perp:xyz:GOLD', [con('wallet', 'XYZ-GOLD/USDC:USDC', { connector, dex: 'xyz' })], { category: 'commodities', tabs: ['all', 'commodities'] });
  const market = body([nvda], { tabs: [{ id: 'all', label: 'All', count: 1 }, { id: 'stocks', label: 'Stocks', count: 1 }] });
  const connected = body([native, gold], { tabs: [{ id: 'all', label: 'All', count: 2 }, { id: 'crypto', label: 'Crypto', count: 1 }, { id: 'commodities', label: 'Commodities', count: 1 }] });
  const joined = joinExplore(market, connected, { scope: 'xyz', limit: 200 });
  assert.deepEqual(keys(joined), ['perp:xyz:NVDA', 'perp:xyz:GOLD']);
  assert.deepEqual(joined.tabs.map(t => [t.id, t.count]), [['all', 2], ['stocks', 1], ['commodities', 1]]);
  const alone = joinExplore(null, connected, { scope: 'xyz', limit: 200 });
  assert.deepEqual(keys(alone), ['perp:xyz:GOLD']);
  assert.deepEqual(alone.tabs.filter(t => t.count > 0).map(t => [t.id, t.count]), [['all', 1], ['commodities', 1]], 'the same filtering applies while the public half is down');
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

test('focused entries keep missing public contracts visible beside a connected Hyperliquid wallet', () => {
  const connector = 'live:hyperliquid-trade';
  const market = body([
    row('perp:xyz:NVDA', [pub('trade-xyz', 'xyz:NVDA-PERP', connector)], { tabs: ['all', 'perps'] }),
    row('perp:xyz:GOLD', [pub('trade-xyz', 'xyz:GOLD-PERP', connector)], { tabs: ['all', 'perps'] }),
  ]);
  const connected = body([row('perp:xyz:NVDA', [con('hl-wallet', 'XYZ-NVDA/USDC:USDC')], { tabs: ['all', 'perps'] })]);
  const venues = [{ id: 'hl-wallet', connector }];
  const joined = joinExplore(market, connected, { scope: 'xyz', venues });
  assert.deepEqual(keys(joined), ['perp:xyz:NVDA', 'perp:xyz:GOLD']);
  assert.deepEqual(linesOf(joined, 'perp:xyz:NVDA'), ['hl-wallet|XYZ-NVDA/USDC:USDC']);
  assert.deepEqual(linesOf(joined, 'perp:xyz:GOLD'), ['trade-xyz|xyz:GOLD-PERP']);
  const pending = joinExplore(market, undefined, { scope: 'xyz', venues });
  assert.deepEqual(keys(pending), ['perp:xyz:NVDA', 'perp:xyz:GOLD'], 'public markets remain visible while the wallet answers');
});

test('scoped joins keep native, xyz and other deployers distinct', () => {
  const connector = 'live:hyperliquid-trade';
  const market = body([
    row('perp:BTC', [pub('hyperliquid', 'BTC-PERP', connector)]),
    row('perp:xyz:NVDA', [pub('trade-xyz', 'xyz:NVDA-PERP', connector)]),
    row('preipo:anthropic', [pub('hyperliquid-preipo', 'io:ANTH-PERP', connector)], { kind: 'perp' }),
  ]);
  assert.deepEqual(keys(joinExplore(market, body([]), { scope: 'hyperliquid' })), ['perp:BTC']);
  assert.deepEqual(keys(joinExplore(market, body([]), { scope: 'xyz' })), ['perp:xyz:NVDA']);
  assert.deepEqual(keys(joinExplore(market, body([]), { scope: 'more' })), ['preipo:anthropic']);
});

test('scoped joins preserve generic paper rehearsals with explicit source identity', () => {
  const market = body([row('perp:xyz:NVDA', [pub('trade-xyz', 'xyz:NVDA-PERP', 'live:hyperliquid-trade')], { price: 100 })]);
  const connected = body([row('perp:xyz:NVDA', [con('paper', 'xyz:NVDA-PERP', { paper: true, dex: 'xyz', connector: 'live:paper', price: 99 })], { paper: true, price: 99 })]);
  const joined = joinExplore(market, connected, { scope: 'xyz' });
  assert.deepEqual(linesOf(joined, 'perp:xyz:NVDA'), ['trade-xyz|xyz:NVDA-PERP', 'paper|xyz:NVDA-PERP']);
  assert.equal(joined.items[0].price, 100, 'the public market lends its price, the rehearsal remains a separate line');
});

test('focused unavailable markets retain read-only public data, including paper statistics and public-only contracts', () => {
  for (const [scope, venue, base, extraBase, dex] of [['hyperliquid', 'hyperliquid', 'BTC', 'ETH', ''], ['xyz', 'trade-xyz', 'xyz:NVDA', 'xyz:GOLD', 'xyz']]) {
    const key = `perp:${base}`, symbol = `${base}-PERP`;
    const publicRow = row(key, [pub(venue, symbol, 'live:hyperliquid-trade', { dex })], {
      base, tabs: ['all', 'perps'], price: 100, changePct24h: -5, change24h: -5.263, volumeUsd24h: 1_234_567,
      changeFrom: { venue, venueName: scope === 'xyz' ? 'trade.xyz' : 'Hyperliquid' },
    });
    const publicOnly = row(`perp:${extraBase}`, [pub(venue, `${extraBase}-PERP`, 'live:hyperliquid-trade', { dex })], {
      base: extraBase, tabs: ['all', 'perps'], changePct24h: 2, volumeUsd24h: 500_000,
    });
    const paperRow = row(key, [con('paper', symbol, { paper: true, dex, connector: 'live:paper', price: 99 })], {
      base, tabs: ['all', 'perps'], paper: true, price: 99, volumeUsd24h: undefined,
    });
    const market = body([publicRow, publicOnly]), connected = body([paperRow]);
    const original = structuredClone([market, connected]);
    for (const verdict of ['not-served', 'closed', 'close-only']) {
      const here = [{ connector: 'live:hyperliquid-trade', verdict }];
      const joined = joinExplore(market, connected, { scope, here });
      assert.deepEqual(keys(joined), [key, publicOnly.key], 'the public-only contract remains discoverable');
      assert.deepEqual(linesOf(joined, key), [`${venue}|${symbol}`, `paper|${symbol}`]);
      const got = joined.items[0];
      assert.deepEqual([got.price, got.paper, got.changePct24h, got.change24h, got.volumeUsd24h], [100, true, -5, -5.263, 1_234_567]);
      assert.deepEqual(got.changeFrom, publicRow.changeFrom, 'statistics keep their public provenance');
      for (const item of joined.items) {
        const leg = item.at[0];
        assert.deepEqual([leg.venue, leg.connector, leg.dex, leg.public, leg.canTrade], [venue, 'live:hyperliquid-trade', dex, true, false]);
        assert.equal(Object.hasOwn(leg, 'connectTo'), false, 'the unavailable real trading connection is not offered');
      }
      assert.equal(got.at[1].canTrade, true, 'the allowed paper line is unchanged');
      const state = emptyState();
      // drawn under a tab, as its read for the query the screen asks
      const tabbed = { ...state.markets, tab: scope === 'xyz' ? 'stocks' : 'crypto', source: 'all' };
      state.markets = { ...tabbed, explore: { [tabbed.tab]: { status: 'ready', data: joined, query: exploreQueryOf(tabbed) } } };
      const renderedRow = rowsOf(state.markets)[0];
      const page = pageOf(state.markets, state.account, key);
      assert.deepEqual([renderedRow.priced.changePct, renderedRow.priced.volume, page.priced.changePct, page.priced.volume], [-5, 1_234_567, -5, 1_234_567]);
      for (const id of [key, publicOnly.key]) {
        state.route = { screen: 'markets', id };
        const html = renderMarketsScreen(state);
        assert.match(html, new RegExp(`aria-label="${scope === 'xyz' ? 'trade.xyz' : 'Hyperliquid'}"`), 'public source badge remains');
        assert.doesNotMatch(html, /Connect to trade/, 'a read-only market offers no real connection');
        assert.ok(pageOf(state.markets, state.account, id), 'the public-only market has a detail page');
      }
      const unscoped = joinExplore(market, connected, { here });
      assert.deepEqual(keys(unscoped), [key], 'unscoped availability filtering is unchanged');
      assert.deepEqual(linesOf(unscoped, key), [`paper|${symbol}`]);
      assert.equal(unscoped.items[0].changePct24h, undefined);
      assert.equal(unscoped.items[0].volumeUsd24h, undefined);
      assert.equal(joinExplore(null, connected, { scope, here }).items[0].changePct24h, undefined, 'a missing public read invents no statistics');
    }
    assert.deepEqual([market, connected], original, 'availability never rewrites source responses');
  }
});

test('More keeps excluding an unavailable public market', () => {
  const market = body([row('coin:BTC', [pub('kraken', 'BTC/USD', 'live:exchange:kraken')])]);
  assert.deepEqual(keys(joinExplore(market, body([]), { scope: 'more', here: [{ connector: 'live:exchange:kraken', verdict: 'not-served' }] })), []);
});

// By underlying (markets-by-underlying Task 5): a source list on the class path (asset, form or region asked, or two sources
// or more) keeps each half's lines of the listed sources only; the old params keep the join as it was.
test('a source list keeps the public lines of its sources only', () => {
  const market = body([
    row('event:A', [pub('kalshi', 'A-YES', 'live:kalshi'), pub('polymarket-us', 'A-YES', 'live:polymarket-us')], { kind: 'event' }),
    row('event:B', [pub('polymarket-us', 'B-YES', 'live:polymarket-us')], { kind: 'event' }),
    row('event:C', [pub('polymarket', 'C-YES', 'live:polymarket')], { kind: 'event' }),
  ]);
  const joined = joinExplore(market, body([]), { asset: 'predictions', source: 'kalshi,polymarket' });
  assert.deepEqual(keys(joined), ['event:A', 'event:C'], 'a row whose only line was polymarket-us goes');
  assert.deepEqual(linesOf(joined, 'event:A'), ['kalshi|A-YES'], "polymarket-us's public line is dropped");
  // two sources with no class are the class path too
  assert.deepEqual(keys(joinExplore(market, body([]), { source: 'kalshi,polymarket' })), ['event:A', 'event:C']);
  // one source on the old params (no scope) keeps the join as it was: every line
  assert.deepEqual(keys(joinExplore(market, body([]), { source: 'kalshi' })), ['event:A', 'event:B', 'event:C']);
});

test('a connected line is kept when its venue or its publicSource is listed', () => {
  const market = body([row('coin:BTC', [pub('kalshi', 'BTC-YES', 'live:kalshi')])]);
  const connected = body([
    row('coin:BTC', [con('paper-1', 'BTC/USDT', { paper: true, publicSource: 'kalshi' }), con('okx-1', 'BTC/USDT')]),
    row('coin:ETH', [con('okx-1', 'ETH/USDT')]),
    row('coin:SOL', [con('kalshi', 'SOL/USD')]),
  ]);
  const joined = joinExplore(market, connected, { form: 'perp', source: 'kalshi,polymarket' });
  assert.deepEqual(linesOf(joined, 'coin:BTC'), ['kalshi|BTC-YES', 'paper-1|BTC/USDT'], 'the paper line stays by its publicSource, okx-1 goes');
  assert.deepEqual(linesOf(joined, 'coin:SOL'), ['kalshi|SOL/USD'], 'a connected line stays by its own venue id');
  assert.equal(joined.items.some(i => i.key === 'coin:ETH'), false, 'a connected row left with no line goes');
});

test('under All sources the list rules the public lines alone: every connected line of the class stays', () => {
  const market = body([row('coin:BTC', [pub('hyperliquid', 'BTC-PERP', 'live:hyperliquid'), pub('okx-preipo', 'BTC-PERP', 'live:okx')])]);
  const connected = body([row('coin:BTC', [con('my-broker', 'BTC/USD')]), row('coin:ETH', [con('my-broker', 'ETH/USD', { publicSource: 'somewhere' })])]);
  const all = joinExplore(market, connected, { asset: 'crypto', source: 'hyperliquid,coinbase', allSources: true });
  assert.deepEqual(linesOf(all, 'coin:BTC'), ['my-broker|BTC/USD', 'hyperliquid|BTC-PERP'], 'a public line outside the list goes; the connected one stays');
  assert.deepEqual(linesOf(all, 'coin:ETH'), ['my-broker|ETH/USD'], 'venue and publicSource outside the list, kept');
  // Main (no allSources): the same connected lines go
  const main = joinExplore(market, connected, { asset: 'crypto', source: 'hyperliquid' });
  assert.deepEqual(linesOf(main, 'coin:BTC'), ['hyperliquid|BTC-PERP']);
  assert.equal(main.items.some(i => i.key === 'coin:ETH'), false);
});

test('no source keeps every line, connected and public', () => {
  const market = body([row('coin:BTC', [pub('okx', 'BTC/USDT', 'live:exchange:okx'), pub('kraken', 'BTC/USD', 'live:exchange:kraken')])]);
  const connected = body([row('coin:BTC', [con('paper-1', 'BTC/USDT', { paper: true })]), row('coin:ETH', [con('okx-1', 'ETH/USDT')])]);
  const joined = joinExplore(market, connected, { asset: 'crypto', source: '' });
  assert.deepEqual(keys(joined), ['coin:BTC', 'coin:ETH']);
  assert.deepEqual(linesOf(joined, 'coin:BTC'), ['okx|BTC/USDT', 'kraken|BTC/USD', 'paper-1|BTC/USDT']);
  assert.deepEqual(linesOf(joined, 'coin:ETH'), ['okx-1|ETH/USDT']);
});

test('Biggest moves orders events by the size of their cent change', () => {
  const ev = (key, change24h, volumeUsd24h) => row(key, [pub('kalshi', `${key}-YES`, 'live:kalshi')], { kind: 'event', change24h, volumeUsd24h, tabs: ['all', 'predictions'] });
  const market = body([ev('event:small', 0.01, 3_000), ev('event:up', 0.05, 2_000), ev('event:down', -0.09, 1_000)]);
  const joined = joinExplore(market, body([]), { asset: 'predictions', sort: 'movers', source: 'kalshi' });
  assert.deepEqual(keys(joined), ['event:down', 'event:up', 'event:small']);
  // the old params order as before: an event has no percent move, so the busiest first
  assert.deepEqual(keys(joinExplore(market, body([]), { tab: 'predictions', sort: 'movers' })), ['event:small', 'event:up', 'event:down']);
});

test('a query carries its asset, form, region and raw source list to the join', async () => {
  const { orderOf } = await import('../../client/js/host/explore-halves.js');
  assert.deepEqual(orderOf('asset=crypto&form=perp&region=us&source=kalshi%2Cpolymarket&sort=movers&limit=50'),
    { tab: '', q: '', sort: 'movers', scope: '', source: 'kalshi,polymarket', asset: 'crypto', form: 'perp', region: 'us', limit: 50 });
  assert.deepEqual(orderOf('tab=crypto&limit=12'), { tab: 'crypto', q: '', sort: '', scope: '', source: '', asset: '', form: '', region: '', limit: 12 });
});

// The class path browses named sources like the focused scopes (final review item 1): a connection that does not serve here
// keeps its public lines read-only, and a connected venue speaks only for the rows it lists itself.
test('the class path keeps an away source read-only, and the old params still drop it', () => {
  const market = body([
    row('event:A', [pub('kalshi', 'A-YES', 'live:kalshi')], { kind: 'event', tabs: ['all', 'predictions'] }),
    row('event:B', [pub('polymarket', 'B-YES', 'live:polymarket')], { kind: 'event', tabs: ['all', 'predictions'] }),
  ]);
  const here = [{ connector: 'live:polymarket', verdict: 'close-only' }];
  for (const opts of [{ asset: 'macro', source: 'kalshi,polymarket' }, { asset: 'predictions', source: 'polymarket' }, { source: 'kalshi,polymarket' }]) {
    const joined = joinExplore(market, body([]), { ...opts, here });
    assert.ok(keys(joined).includes('event:B'), `${JSON.stringify(opts)}: the close-only source's lines stay`);
    const leg = joined.items.find(i => i.key === 'event:B').at[0];
    assert.deepEqual([leg.venue, leg.public, leg.canTrade], ['polymarket', true, false]);
    assert.equal(Object.hasOwn(leg, 'connectTo'), false, 'no connect-to-trade route for a source that does not serve here');
    const kalshi = joined.items.find(i => i.key === 'event:A');
    if (kalshi) assert.equal(kalshi.at[0].connectTo, 'kalshi', 'a serving source keeps its route');
  }
  // the old params, unscoped with one source or none: unchanged
  assert.deepEqual(keys(joinExplore(market, body([]), { here })), ['event:A']);
  assert.deepEqual(keys(joinExplore(market, body([]), { tab: 'predictions', source: 'polymarket', here })), ['event:A']);
});

test('on the class path a connected venue speaks only for the rows it lists, not the whole public source', () => {
  const connector = 'live:hyperliquid-trade';
  const market = body([
    row('perp:BTC', [pub('hyperliquid', 'BTC-PERP', connector)], { tabs: ['all', 'crypto'] }),
    row('perp:DOGE', [pub('hyperliquid', 'DOGE-PERP', connector)], { tabs: ['all', 'crypto'] }),
    row('perp:xyz:GOLD', [pub('trade-xyz', 'xyz:GOLD-PERP', connector)], { tabs: ['all', 'commodities'] }),
  ]);
  const connected = body([row('perp:BTC', [con('hl-wallet', 'BTC/USDC:USDC', { publicSource: 'hyperliquid' })], { tabs: ['all', 'crypto'] })]);
  const venues = [{ id: 'hl-wallet', connector, paper: false }];
  const crypto = joinExplore(market, connected, { asset: 'crypto', source: 'hyperliquid', venues });
  assert.deepEqual(keys(crypto), ['perp:BTC', 'perp:DOGE'], 'a public perp the wallet does not list stays');
  assert.deepEqual(linesOf(crypto, 'perp:BTC'), ['hl-wallet|BTC/USDC:USDC'], 'the wallet speaks for the row it lists');
  const commodities = joinExplore(market, connected, { asset: 'commodities', source: 'trade-xyz', venues });
  assert.deepEqual(keys(commodities), ['perp:xyz:GOLD']);
  // the old params, unscoped: a connected venue speaks for its whole connection, as before
  assert.deepEqual(keys(joinExplore(market, connected, { venues })), ['perp:BTC']);
});
