import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../../client/js/data/empty.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { marketOriginOf, marketScopeOf, marketNavigationOf, moreSourcesOf, tableOf, pageOf, rowsOf, setWatchOf } from '../../client/js/host/market-view.js';
import { renderMarketsScreen, sourceBadge } from '../../client/js/render/markets.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';

const NOW = Date.parse('2026-11-05T18:00:00Z');
const listing = (key, venue, symbol, extra = {}) => ({
  key, kind: 'perp', name: symbol, base: symbol.replace(/-PERP$/, ''), price: 100, volumeUsd24h: 1e6,
  tabs: ['all', 'perps'], at: [{ venue, symbol, venueName: venue === 'trade-xyz' ? 'trade.xyz' : 'Hyperliquid',
    public: true, connected: false, connectTo: 'hyperliquid-trade', connector: 'live:hyperliquid-trade', price: 100, ...extra }],
});
const body = (...items) => ({ ok: true, items, tabs: [{ id: 'all', count: items.length }, { id: 'perps', count: items.length }], movers: [], closing: [], mostTraded: [], missing: [] });
const state = (scope = 'hyperliquid') => {
  const s = R.nav(emptyState(), { screen: 'markets', id: null });
  return { ...s, markets: { ...s.markets, scope } };
};

test('source identity follows the source or connector and the qualified coin, never the account display name', () => {
  assert.equal(marketOriginOf({ venue: 'hyperliquid', symbol: 'BTC-PERP' }), 'hyperliquid');
  assert.equal(marketOriginOf({ venue: 'my-wallet', connector: 'live:hyperliquid-trade', symbol: 'BTC/USDC:USDC' }), 'hyperliquid');
  assert.equal(marketOriginOf({ venue: 'practice', connector: 'live:hyperliquid-paper', symbol: 'ETH/USDC:USDC' }), 'hyperliquid');
  assert.equal(marketOriginOf({ venue: 'trade-xyz', symbol: 'xyz:GOLD-PERP' }), 'xyz');
  assert.equal(marketOriginOf({ venue: 'hyperliquid-preipo', symbol: 'xyz:ANTHROPIC-PERP' }), 'xyz');
  assert.equal(marketOriginOf({ venue: 'my-wallet', connector: 'live:hyperliquid-trade', symbol: 'xyz:NVDA/USDC:USDC' }), 'xyz');
  assert.equal(marketOriginOf({ venue: 'my-wallet', connector: 'live:hyperliquid-trade', symbol: 'XYZ-NVDA/USDC:USDC' }), 'xyz');
  assert.equal(marketOriginOf({ venue: 'my-wallet', connector: 'live:hyperliquid-trade', symbol: 'SPECIAL-COIN/USDC:USDC', dex: '' }), 'hyperliquid');
  assert.equal(marketOriginOf({ venue: 'practice', connector: 'live:paper', paper: true, symbol: 'xyz:NVDA-PERP', dex: 'xyz' }), 'xyz');
  assert.equal(marketOriginOf({ venue: 'practice', connector: 'live:paper', paper: true, symbol: 'BTC-PERP', dex: '' }), 'hyperliquid');
  for (const leg of [
    { venue: 'hyperliquid-preipo', symbol: 'io:ANTH-PERP' },
    { venue: 'wallet', connector: 'live:hyperliquid-trade', symbol: 'cash:USA500/USDT0:USDT0' },
    { venue: 'wallet', connector: 'live:hyperliquid-trade', symbol: 'IO-ANTH/USDC:USDC' },
    { venue: 'wallet', connector: 'live:hyperliquid-trade', symbol: 'ANYTHING/USDC:USDC', dex: 'io' },
    { venue: 'binance', symbol: 'xyz:NVDA-PERP', venueName: 'Hyperliquid' },
    { venue: 'not-hyperliquid', symbol: 'BTC-PERP' }, {}, null,
    { venue: 'practice', connector: 'live:paper', paper: true, symbol: 'BTC-PERP' },
    { venue: 'practice', connector: 'live:paper', paper: true, symbol: 'NVDA', dex: 'io' },
  ]) assert.equal(marketOriginOf(leg), null, JSON.stringify(leg));
});

test('all three sources stay expanded with their categories and separate Watching and Desk controls', () => {
  assert.equal(marketScopeOf({}), 'more', 'old unscoped reads remain broad');
  const s = state();
  const html = renderMarketsScreen(s, NOW);
  const entries = [...html.matchAll(/data-action="mkScope" data-value="([^"]+)" aria-pressed="(true|false)"/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(entries, [['hyperliquid', 'true'], ['xyz', 'false'], ['more', 'false']]);
  assert.match(html, /More markets/);
  const navigation = marketNavigationOf(s.markets);
  assert.deepEqual(navigation.map(row => [row.id, row.categories.map(c => c.id)]), [
    ['hyperliquid', ['all', 'crypto']],
    ['xyz', ['all', 'stocks', 'indices', 'commodities', 'fx', 'preipo']],
    ['more', ['all', 'crypto', 'stocks', 'rwas', 'perps', 'preipo', 'predictions', 'china']],
  ]);
  assert.ok(navigation.every(row => row.categories.every(c => c.count === null)), 'unread counts remain unknown');
  assert.deepEqual([...html.matchAll(/data-action="mkTab" data-value="([^"]+)"/g)].map(m => m[1]), ['watching', 'desk']);
  assert.match(html, /data-action="mkCategory" data-scope="xyz" data-value="stocks"/);
  assert.doesNotMatch(html, /data-action="mkCategory" data-scope="more"/, 'More expands providers; its categories appear only when selected');
  assert.deepEqual(tableOf(s.markets, NOW).tabs.map(t => t.id), ['all', 'watching', 'desk']);
  const broad = R.setMarketsScope(s, 'more');
  assert.ok(tableOf(broad.markets, NOW).tabs.some(t => t.id === 'china'));
  assert.match(renderMarketsScreen(broad, NOW), /data-action="mkCategory" data-scope="more" data-value="china"/);
  const zh = withTable(ZH, () => renderMarketsScreen(broad, NOW));
  assert.match(zh, /更多市场/);
  assert.match(zh, /aria-label="市场来源"/);
});

test('More shows the actual provider registry while Hyperliquid is selected, with distinct pre-IPO names', () => {
  const value = [
    { id: 'hyperliquid', name: 'Hyperliquid' }, { id: 'trade-xyz', name: 'trade.xyz' },
    { id: 'okx', name: 'OKX' }, { id: 'robinhood-stock-tokens', name: 'Robinhood Stock Tokens', kind: 'tokens' },
    { id: 'okx-preipo', name: 'OKX' }, { id: 'hyperliquid-preipo', name: 'Hyperliquid' },
  ];
  const s = R.marketSourcesLoaded(state(), { data: { ok: true, value }, at: NOW });
  assert.deepEqual(moreSourcesOf(s.markets).map(source => [source.id, source.label]), [
    ['okx', 'OKX'], ['robinhood-stock-tokens', 'Robinhood Stock Tokens'], ['okx-preipo', 'OKX Pre-IPO'], ['hyperliquid-preipo', 'Hyperliquid HIP-3'],
  ]);
  const html = renderMarketsScreen(s, NOW);
  assert.deepEqual([...html.matchAll(/data-action="mkSource" data-value="([^"]*)"/g)].map(m => m[1]), ['', 'okx', 'robinhood-stock-tokens', 'okx-preipo', 'hyperliquid-preipo']);
  assert.match(html, />Robinhood Stock Tokens<\/button>/);
  const picked = R.setMarketsLocation(s, { scope: 'more', source: 'robinhood-stock-tokens', tab: 'all' });
  assert.deepEqual([picked.markets.scope, picked.markets.source, picked.markets.tab], ['more', 'robinhood-stock-tokens', 'all']);
  assert.equal(picked.markets.sources, s.markets.sources, 'catalog is not discarded with market rows');
  assert.equal(R.setMarketsLocation(picked, { scope: 'more', source: 'invented' }), picked);
  assert.equal(R.setMarketsLocation(picked, { scope: 'more', source: 'robinhood-stock-tokens', tab: 'china' }), picked);
  assert.equal(R.setMarketsTab(picked, 'china'), picked);
  const starred = R.watchlistLoaded(picked, { items: [{ id: 'cn:600519', market: 'cn', symbol: '600519', name: 'Moutai', currency: 'CNY' }] });
  assert.deepEqual(rowsOf(starred.markets, NOW), [], 'a provider All list never borrows China stars');
  assert.equal(rowsOf(R.setMarketsTab(starred, 'watching').markets, NOW).length, 1);
  const back = R.setMarketsLocation(starred, { scope: 'more' });
  assert.equal(back.markets.source, '');
  assert.equal(rowsOf(back.markets, NOW).length, 1, 'More All retains the broad watch contract');
});

test('category counts come only from the selected source All read, never another source or Watching', () => {
  const data = { ...body(), tabs: [{ id: 'all', count: 120 }, { id: 'stocks', count: 95 }, { id: 'indices', count: 6 }, { id: 'perps', count: 120 }] };
  const s = R.exploreLoaded(state('xyz'), { tab: 'all', data, at: NOW });
  const nav = marketNavigationOf(s.markets);
  assert.deepEqual(nav.find(row => row.id === 'xyz').categories.map(c => [c.id, c.count]), [['all', 120], ['stocks', 95], ['indices', 6], ['commodities', null], ['fx', null], ['preipo', null]]);
  assert.ok(nav.filter(row => row.id !== 'xyz').every(row => row.categories.every(c => c.count === null)));
  assert.ok(marketNavigationOf(R.setMarketsTab(s, 'watching').markets).every(row => row.categories.every(c => c.count === null)));
  const direct = R.exploreLoaded(state('xyz'), { tab: 'stocks', data, at: NOW });
  assert.ok(marketNavigationOf(direct.markets).every(row => row.categories.every(c => c.count === null)), 'a category response cannot impersonate the source All count');
});

test('source and category selection is atomic and preserves search within the same source', () => {
  const original = R.exploreLoaded(state(), { tab: 'all', data: body(listing('perp:BTC', 'hyperliquid', 'BTC-PERP')), at: NOW });
  const searching = R.setMarketsQuery(original, 'BTC');
  const changed = R.setMarketsLocation(searching, { scope: 'xyz', tab: 'stocks' });
  assert.deepEqual([changed.markets.scope, changed.markets.tab, changed.markets.q], ['xyz', 'stocks', '']);
  assert.deepEqual(changed.markets.explore, {});
  assert.equal(changed.markets.results.data, null);
  assert.equal(R.setMarketsLocation(changed, { scope: 'hyperliquid', tab: 'stocks' }), changed, 'irrelevant source categories are rejected');
  assert.equal(R.setMarketsLocation(changed, { scope: 'toString', tab: 'all' }), changed);
  const query = R.setMarketsQuery(changed, 'NVDA');
  const same = R.setMarketsLocation(query, { scope: 'xyz', tab: 'stocks' });
  assert.equal(same.markets.q, 'NVDA');
  assert.equal(same.markets.tab, 'stocks');
  const watching = R.exploreLoaded(R.setMarketsTab(same, 'watching'), { tab: 'all', data: body(), at: NOW });
  assert.deepEqual(R.setMarketsLocation(watching, { scope: 'xyz', tab: 'indices' }).markets.explore, {}, 'leaving global Watching discards its broad rows');
});

test('underlying asset categories filter perpetual contracts without changing their kind or source', () => {
  const nvda = { ...listing('perp:xyz:NVDA', 'trade-xyz', 'xyz:NVDA-PERP'), tabs: ['all', 'perps', 'stocks'] };
  const gold = { ...listing('perp:xyz:GOLD', 'trade-xyz', 'xyz:GOLD-PERP'), tabs: ['all', 'perps', 'commodities'] };
  const s = R.exploreLoaded(state('xyz'), { tab: 'all', data: body(nvda, gold), at: NOW });
  const chosen = R.setMarketsLocation(s, { scope: 'xyz', tab: 'commodities' });
  const rows = rowsOf(chosen.markets, NOW);
  assert.deepEqual(rows.map(row => [row.id, row.kind]), [['perp:xyz:GOLD', 'perp']]);
  assert.equal(marketOriginOf(rows[0].legs[0]), 'xyz');
  assert.match(renderMarketsScreen(chosen, NOW), /data-scope="xyz" data-value="commodities" aria-pressed="true"/);
});

test('each contract and its page carry a small accessible, local source mark', () => {
  const btc = listing('perp:BTC', 'hyperliquid', 'BTC-PERP');
  const nvda = listing('perp:xyz:NVDA', 'trade-xyz', 'xyz:NVDA-PERP');
  let s = R.exploreLoaded(state(), { tab: 'all', data: body(btc, nvda), at: NOW });
  const html = renderMarketsScreen(s, NOW);
  const row = key => html.match(new RegExp(`<tr data-id="${key}">[\\s\\S]*?</tr>`))?.[0] ?? '';
  assert.match(row('perp:BTC'), /mk-source-hyperliquid" role="img" aria-label="Hyperliquid" title="Hyperliquid"/);
  assert.match(row('perp:xyz:NVDA'), /mk-source-xyz" role="img" aria-label="trade.xyz" title="trade.xyz"/);
  assert.doesNotMatch(html, /<img|https?:/);
  s = R.nav(s, { screen: 'markets', id: nvda.key });
  assert.match(renderMarketsScreen(s, NOW), /mk-pg-head[\s\S]*?mk-source-xyz" role="img" aria-label="trade.xyz"/);
  assert.equal(sourceBadge('<img src=x>'), '');
});

test('changing scope drops previous list and search results while preserving exact-key pages and cross-market stars', () => {
  const nvda = listing('perp:xyz:NVDA', 'trade-xyz', 'xyz:NVDA-PERP');
  let s = R.exploreLoaded(state('xyz'), { tab: 'all', data: body(nvda), at: NOW });
  s = R.marketLocated(s, { id: nvda.key, data: body(nvda), at: NOW });
  s = R.accountWatchLoaded(s, { items: [nvda.key] });
  s = R.setMarketsQuery(s, 'NVDA');
  s = R.resultsLoaded(s, { data: body(nvda), at: NOW });
  s = R.setMarketsSort(s, 'movers');
  const located = s.markets.located;
  s = R.setMarketsScope(s, 'hyperliquid');
  assert.deepEqual([s.markets.scope, s.markets.tab, s.markets.sort, s.markets.q], ['hyperliquid', 'all', 'volume', '']);
  assert.deepEqual(s.markets.explore, {});
  assert.equal(s.markets.results.data, null);
  assert.equal(s.markets.located, located);
  assert.deepEqual(rowsOf(s.markets, NOW), [], 'the other venue is absent from the new list');
  assert.equal(pageOf(s.markets, {}, nvda.key, NOW)?.name, 'xyz:NVDA-PERP');
  const watching = R.setMarketsTab(s, 'watching');
  assert.deepEqual(rowsOf(watching.markets, NOW).map(r => [r.id, r.placeholder ?? false]), [[nvda.key, false]]);
  assert.deepEqual(setWatchOf(s.markets, null, nvda.key).on, { venue: 'hyperliquid-trade', symbol: 'xyz:NVDA-PERP' });
  assert.equal(R.setMarketsScope(s, 'untrusted'), s);
  assert.equal(R.setMarketsScope(s, 'hyperliquid'), s);
  const broadWatch = R.exploreLoaded(watching, { tab: 'all', data: body(nvda), at: NOW });
  const back = R.setMarketsTab(broadWatch, 'all');
  assert.deepEqual(rowsOf(back.markets, NOW), [], 'Watching’s unscoped list never leaks into Hyperliquid');
  assert.equal(back.markets.located, located);
});

test('saved A-share stars stay in Watching and do not leak into a focused venue list', () => {
  let s = R.watchlistLoaded(state(), { items: [{ id: 'cn:600519', market: 'cn', symbol: '600519', name: 'Moutai', currency: 'CNY' }] });
  assert.deepEqual(rowsOf(s.markets, NOW), []);
  s = R.setMarketsTab(s, 'watching');
  assert.deepEqual(rowsOf(s.markets, NOW).map(r => r.id), ['cn:600519']);
});

test('qualified contract identities keep their namespace while generated titles and tiles use the asset name', () => {
  const nvda = { ...listing('perp:xyz:NVDA', 'trade-xyz', 'xyz:NVDA-PERP'), name: 'xyz:NVDA perpetual' };
  let s = R.exploreLoaded(state('xyz'), { tab: 'all', data: body(nvda), at: NOW });
  const row = rowsOf(s.markets, NOW)[0];
  assert.deepEqual([row.id, row.name, row.tile, row.sub], ['perp:xyz:NVDA', 'NVDA perpetual', 'NVDA', 'NVDA · Perpetual']);
  const page = pageOf(s.markets, {}, nvda.key, NOW);
  assert.deepEqual([page.name, page.item.name, page.item.base], ['NVDA perpetual', 'xyz:NVDA perpetual', 'xyz:NVDA']);
  s = R.exploreLoaded(s, { tab: 'all', data: body({ ...nvda, name: 'xyz:NVDA custom label' }), at: NOW });
  assert.equal(rowsOf(s.markets, NOW)[0].name, 'xyz:NVDA custom label', 'a supplied name stays verbatim');
});
