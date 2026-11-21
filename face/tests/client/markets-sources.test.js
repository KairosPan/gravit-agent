// Markets by underlying (spec 2026-11-19 G1–G8, §5.3): the tabs, Region, Form and Source, the main sources and their
// families, the resets, Form → All sources, the chips, the Watchlist, search and Back — the view (host/market-view.js) and
// the reducers (reducers/markets.js), with no DOM; and a contract's source identity and badge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../../client/js/data/empty.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import {
  MARKET_TABS, REGIONS, FORMS, TAB_SOURCES, SOURCE_FORMS, familiesOf, formsInView, exploreQueryOf, connectedQueryOf, rankQueryOf, filtersOf, onLocal, onChinaA, noSpotSource,
  marketOriginOf, tableOf, pageOf, rowsOf,
} from '../../client/js/host/market-view.js';
import { t } from '../../client/js/i18n/words.js';

const NOW = Date.parse('2026-11-19T18:00:00Z');
const markets = () => R.nav(emptyState(), { screen: 'markets', id: null });
const on = (tab, ...steps) => steps.reduce((s, [name, v]) => R[name](s, v), R.setMarketsTab(markets(), tab));
const decoded = q => (q === null ? null : Object.fromEntries(new URLSearchParams(q)));
const listing = (key, venue, symbol, extra = {}) => ({
  key, kind: 'perp', name: symbol, base: symbol.replace(/-PERP$/, ''), price: 100, volumeUsd24h: 1e6, asset: 'crypto', form: 'perp',
  tabs: ['all', 'perps'], at: [{ venue, symbol, venueName: venue === 'trade-xyz' ? 'trade.xyz' : 'Hyperliquid',
    public: true, connected: false, connectTo: 'hyperliquid-trade', connector: 'live:hyperliquid-trade', price: 100, ...extra }],
});
const body = (...items) => ({ ok: true, items, tabs: [{ id: 'all', count: items.length }], movers: [], closing: [], mostTraded: [], missing: [] });
// a tab's read landed for the query the screen asks now
const landed = (s, data, query = exploreQueryOf(s.markets)) => R.exploreLoaded(s, { tab: s.markets.tab, data, at: NOW, query });
const REGISTRY = { ok: true, value: [
  { id: 'hyperliquid', name: 'Hyperliquid' }, { id: 'trade-xyz', name: 'trade.xyz' }, { id: 'okx', name: 'OKX' },
  { id: 'okx-preipo', name: 'OKX Pre-IPO' }, { id: 'gate-preipo', name: 'Gate Pre-IPO' }, { id: 'hyperliquid-preipo', name: 'Hyperliquid' },
  { id: 'kalshi', name: 'Kalshi' }, { id: 'polymarket', name: 'Polymarket' }, { id: 'cboe', name: 'Cboe' },
] };

test('the fixed lists: the tabs, the regions, the forms, the main sources and what each source carries', () => {
  assert.deepEqual(MARKET_TABS, ['watchlist', 'crypto', 'stocks', 'indices', 'commodities', 'fx', 'preipo', 'macro']);
  assert.deepEqual(REGIONS, { stocks: ['us', 'cn', 'hk', 'jp', 'kr', 'tw', 'in'], indices: ['us', 'cn', 'hk', 'jp', 'kr', 'tw', 'in', 'eu'], later: { stocks: ['eu'] } });
  assert.deepEqual(FORMS, { live: ['spot', 'perp', 'token', 'event'], later: ['option'] });
  assert.deepEqual(Object.keys(TAB_SOURCES), ['crypto', 'stocks:us', 'stocks:cn', 'indices', 'commodities', 'fx', 'preipo', 'macro']);
  assert.deepEqual(TAB_SOURCES.preipo.main, ['hyperliquid-preipo', 'trade-xyz']);
  assert.deepEqual(TAB_SOURCES['stocks:cn'], { main: ['china'], also: [] });
  // every source a tab names says what it carries
  for (const { main, also } of Object.values(TAB_SOURCES)) for (const id of [...main, ...also]) assert.ok(SOURCE_FORMS[id]?.length, id);
  assert.deepEqual(SOURCE_FORMS['okx-preipo'], ['perp']);
  assert.deepEqual(SOURCE_FORMS.xstocks, ['token']);
});

test('Markets opens on the Watchlist', () => {
  const m = emptyState().markets;
  assert.equal(m.tab, 'watchlist');
  assert.deepEqual([m.region, m.form, m.source, m.open], ['us', '', 'main', null]);
  assert.equal(m.scope, undefined);
  assert.equal(exploreQueryOf(m), 'limit=200');
});

test('every tab opens on its main sources', () => {
  const q = tab => exploreQueryOf(on(tab).markets);
  assert.equal(q('crypto'), 'asset=crypto&sort=volume&limit=200&source=hyperliquid');
  assert.equal(q('stocks'), 'asset=stocks&sort=volume&limit=200&region=us&source=cboe');
  assert.equal(q('indices'), 'asset=indices&sort=volume&limit=200&region=us&source=trade-xyz');
  assert.equal(q('commodities'), 'asset=commodities&sort=volume&limit=200&source=trade-xyz');
  assert.equal(q('fx'), 'asset=fx&sort=volume&limit=200&source=trade-xyz');
  assert.equal(decoded(q('preipo')).source, 'hyperliquid-preipo,trade-xyz');
  assert.equal(decoded(q('macro')).source, 'kalshi,polymarket');
  // the sort in effect and a Form set go with it
  const movers = R.setMarketsSort(on('crypto', ['setMarketsForm', 'perp']), 'movers');
  assert.deepEqual(decoded(exploreQueryOf(movers.markets)), { asset: 'crypto', sort: 'movers', limit: '200', form: 'perp', source: 'hyperliquid' });
});

test('All sources sends the tab’s whole list, never no source', () => {
  const all = on('crypto', ['setMarketsSource', 'all']);
  assert.equal(decoded(exploreQueryOf(all.markets)).source, 'hyperliquid,coinbase,kraken,okx,binance,bybit,kalshi,polymarket');
  const stocks = on('stocks', ['setMarketsSource', 'all']);
  assert.equal(decoded(exploreQueryOf(stocks.markets)).source, 'cboe,trade-xyz,robinhood-stock-tokens,xstocks,ondo-stocks');
  // a family: its own ids
  const okx = on('preipo', ['setMarketsSource', 'okx']);
  assert.equal(decoded(exploreQueryOf(okx.markets)).source, 'okx-preipo');
  // a non-US region on Perp asks its region, trade.xyz alone (spec 5.4)
  assert.deepEqual(decoded(exploreQueryOf(on('indices', ['setMarketsRegion', 'cn'], ['setMarketsForm', 'perp']).markets)), { asset: 'indices', sort: 'volume', limit: '200', region: 'cn', form: 'perp', source: 'trade-xyz' });
});

test('All sources asks the connected half by class alone; Main and a family ask it the same list', () => {
  const all = on('crypto', ['setMarketsSource', 'all']);
  assert.equal(connectedQueryOf(all.markets), 'asset=crypto&sort=volume&limit=200');
  for (const s of [on('crypto'), on('preipo', ['setMarketsSource', 'okx']), markets()]) assert.equal(connectedQueryOf(s.markets), exploreQueryOf(s.markets));
  assert.equal(connectedQueryOf(on('stocks', ['setMarketsRegion', 'cn']).markets), null);
  assert.equal(decoded(connectedQueryOf(on('stocks', ['setMarketsForm', 'token']).markets)).form, 'token', 'a Form picked switches to All sources and goes with it');
});

test('a non-US region offers Spot and Perp alone, Spot when none is stored; US keeps today’s', () => {
  const perp = on('indices', ['setMarketsForm', 'perp']);
  const cn = R.setMarketsRegion(perp, 'cn');
  assert.deepEqual([cn.markets.region, cn.markets.form, cn.markets.source], ['cn', 'perp', 'main'], 'Perp is carried by every region');
  assert.deepEqual(formsInView(cn.markets), ['spot', 'perp']);
  assert.equal(R.setMarketsForm(cn, 'token'), cn);
  const spot = R.setMarketsForm(cn, 'spot');
  assert.deepEqual([spot.markets.form, spot.markets.source], ['spot', 'main'], 'no switch to All sources');
  for (const region of ['cn', 'hk', 'jp', 'kr', 'tw', 'in']) {
    const f = filtersOf(on('stocks', ['setMarketsRegion', region]).markets).form;
    assert.deepEqual(f.options.map(o => [o.id, o.disabled]), [['spot', false], ['perp', false]], region);
    assert.equal(f.value, 'spot', `${region}: a stored '' reads as Spot`);
  }
  assert.equal(filtersOf(on('indices', ['setMarketsRegion', 'eu']).markets).form.value, 'spot');
  assert.deepEqual(formsInView(on('indices').markets), ['spot', 'perp', 'event'], 'Indices › US gains Spot, the cash levels');
  assert.deepEqual(filtersOf(on('stocks').markets).form.options.map(o => o.id), ['', 'spot', 'perp', 'token', 'event', 'option'], 'Stocks › US keeps All');
});

test('onLocal: the region’s own read, by venue', () => {
  const o = (tab, region, ...more) => onLocal(on(tab, ['setMarketsRegion', region], ...more).markets);
  assert.deepEqual([o('stocks', 'cn'), o('stocks', 'hk'), o('stocks', 'kr'), o('stocks', 'tw')].map(l => [l.venue, l.region]), [['china', 'cn'], ['hk', 'hk'], ['kr', 'kr'], ['tw', 'tw']]);
  assert.deepEqual(o('indices', 'eu'), { venue: 'ix', region: 'eu' });
  assert.deepEqual(onLocal(on('indices', ['setMarketsForm', 'spot']).markets), { venue: 'ix', region: 'us' }, 'Indices › US › Spot');
  assert.equal(onLocal(on('indices').markets), null, 'Indices › US on All is today’s');
  assert.equal(onLocal(on('stocks', ['setMarketsForm', 'spot']).markets), null, 'Stocks › US is the generic read');
  assert.equal(o('stocks', 'hk', ['setMarketsForm', 'perp']), null);
  assert.equal(o('stocks', 'jp'), null);
  assert.equal(o('stocks', 'in'), null);
  assert.equal(onChinaA(on('stocks', ['setMarketsRegion', 'cn']).markets), true);
  assert.equal(onChinaA(on('stocks', ['setMarketsRegion', 'hk']).markets), false);
  assert.equal(onChinaA(on('indices', ['setMarketsRegion', 'cn']).markets), false, 'Indices › China A is the cash index read');
});

test('rankQueryOf and exploreQueryOf by region, form and tab', () => {
  const kr = on('stocks', ['setMarketsRegion', 'kr']);
  assert.equal(rankQueryOf(R.setMarketsSort(kr, 'movers').markets), 'asset=stocks&form=spot&region=kr&sort=movers&limit=20');
  assert.equal(rankQueryOf(R.setMarketsSort(kr, 'closing').markets), 'asset=stocks&form=spot&region=kr&sort=volume&limit=20');
  assert.equal(rankQueryOf(on('indices', ['setMarketsRegion', 'eu']).markets), 'asset=indices&form=spot&region=eu&sort=volume&limit=20');
  assert.equal(rankQueryOf(on('indices', ['setMarketsForm', 'spot']).markets), 'asset=indices&form=spot&region=us&sort=volume&limit=20');
  assert.equal(rankQueryOf(on('stocks').markets), null);
  assert.equal(rankQueryOf(on('stocks', ['setMarketsRegion', 'jp']).markets), null);
  assert.equal(exploreQueryOf(kr.markets), null, 'an own read asks no explore');
  assert.equal(exploreQueryOf(on('stocks', ['setMarketsRegion', 'kr'], ['setMarketsForm', 'perp']).markets), 'asset=stocks&sort=volume&limit=200&region=kr&form=perp&source=trade-xyz');
  assert.equal(exploreQueryOf(on('indices').markets), 'asset=indices&sort=volume&limit=200&region=us&source=trade-xyz', 'Indices › US on All sends today’s query, no form');
  // Japan and India on Spot: the generic read, which answers no rows, and the empty state's line
  assert.equal(exploreQueryOf(on('stocks', ['setMarketsRegion', 'jp']).markets), 'asset=stocks&sort=volume&limit=200&region=jp&form=spot');
  assert.equal(noSpotSource(on('stocks', ['setMarketsRegion', 'in']).markets), true);
  assert.equal(noSpotSource(on('stocks', ['setMarketsRegion', 'in'], ['setMarketsForm', 'perp']).markets), false);
  assert.equal(noSpotSource(on('stocks', ['setMarketsRegion', 'kr']).markets), false);
  assert.equal(t('markets.empty.noSpotSource'), 'No free source lists these shares; their perps are under Perp.');
});

test('Perp on a non-US region reads trade.xyz alone: the pill, the families and the query agree', () => {
  for (const [tab, region] of [['stocks', 'cn'], ['stocks', 'kr'], ['indices', 'jp']]) {
    const m = on(tab, ['setMarketsRegion', region], ['setMarketsForm', 'perp']).markets;
    const f = filtersOf(m).source;
    assert.deepEqual(f.options.map(o => o.id), ['main', 'all', 'trade-xyz'], `${tab} ${region}`);
    assert.equal(f.label, t('markets.source.main', { names: 'trade-xyz' }), `${tab} ${region}`);
    assert.equal(decoded(exploreQueryOf(m)).source, 'trade-xyz');
  }
});

test('a Form pick that makes the view local clears a family Source', () => {
  const s = on('indices', ['setMarketsSource', 'kalshi'], ['setMarketsForm', 'event']);
  assert.equal(s.markets.source, 'kalshi');
  const local = R.setMarketsForm(s, 'spot');
  assert.deepEqual([local.markets.form, local.markets.source], ['spot', 'main']);
});

test('the Source filter on a region’s own read is its one venue, fixed', () => {
  const names = (tab, region) => filtersOf(on(tab, ['setMarketsRegion', region]).markets).source.options.map(o => o.label);
  assert.deepEqual(names('stocks', 'hk').slice(2), ['Tencent']);
  assert.deepEqual(names('stocks', 'kr').slice(2), ['Naver']);
  assert.deepEqual(names('stocks', 'tw').slice(2), ['TWSE']);
  assert.deepEqual(names('indices', 'jp').slice(2), ['Indices']);
  assert.deepEqual(filtersOf(on('indices', ['setMarketsForm', 'spot']).markets).source.options.slice(2).map(o => o.label), ['Indices']);
});

test('the tab already open, with no search, keeps its filters', () => {
  const s = on('crypto', ['setMarketsSource', 'all'], ['setMarketsForm', 'spot']);
  assert.equal(R.setMarketsTab(s, 'crypto'), s);
  const searching = R.setMarketsQuery(s, 'btc');
  const ended = R.setMarketsTab(searching, 'crypto');
  assert.deepEqual([ended.markets.q, ended.markets.source, ended.markets.form], ['', 'main', ''], 'a search open: the tab pressed ends it, from its main sources');
});

test('Stocks › China A is the rank read, never sorted by closing', () => {
  const cn = on('stocks', ['setMarketsRegion', 'cn']);
  assert.equal(exploreQueryOf(cn.markets), null);
  assert.equal(rankQueryOf(R.setMarketsSort(cn, 'closing').markets), 'asset=stocks&form=spot&region=cn&sort=volume&limit=20');
  assert.equal(rankQueryOf(R.setMarketsSort(cn, 'movers').markets), 'asset=stocks&form=spot&region=cn&sort=movers&limit=20');
  // the table offers its two sorts alone, and draws no rows of a ranking read for another sort
  const table = tableOf(R.setMarketsSort(cn, 'closing').markets, NOW);
  assert.deepEqual([table.china, table.sorts.map(s => s.id), table.sort], [true, ['volume', 'movers'], 'volume']);
  // Spot and Perp there: a Form China A does not carry is cleared
  const token = R.setMarketsRegion(on('stocks', ['setMarketsForm', 'token']), 'cn');
  assert.equal(token.markets.form, '');
  assert.deepEqual(formsInView(token.markets), ['spot', 'perp']);
  assert.equal(R.setMarketsRegion(on('stocks', ['setMarketsForm', 'spot']), 'cn').markets.form, 'spot');
});

test('a tab switch resets region, form and source; a region pick resets source only', () => {
  let s = on('stocks', ['setMarketsRegion', 'cn'], ['setMarketsSource', 'all'], ['openMarketsFilter', 'source']);
  s = R.setMarketsSort(s, 'movers');
  const next = R.setMarketsTab(s, 'indices');
  assert.deepEqual(['tab', 'region', 'form', 'source', 'open', 'sort'].map(k => next.markets[k]), ['indices', 'us', '', 'main', null, 'volume']);
  // a region pick: Main again, the Form kept where China A carries it
  const picked = R.setMarketsRegion(on('stocks', ['setMarketsForm', 'spot'], ['setMarketsSource', 'all']), 'us');
  assert.deepEqual([picked.markets.region, picked.markets.form, picked.markets.source], ['us', 'spot', 'main']);
  // a region is Stocks' and Indices' alone, and one of the live regions alone
  assert.equal(R.setMarketsRegion(on('crypto'), 'cn').markets.region, 'us');
  assert.equal(R.setMarketsRegion(on('stocks'), 'hk').markets.region, 'hk');
  assert.equal(R.setMarketsRegion(on('stocks'), 'eu').markets.region, 'us', 'Europe has no share source');
  assert.equal(R.setMarketsRegion(on('indices'), 'eu').markets.region, 'eu');
  assert.equal(R.setMarketsTab(markets(), 'results').markets.tab, 'watchlist', 'a tab Markets does not have is no tab');
});

test('picking a Form the main sources do not carry switches Source to All sources', () => {
  const spot = on('crypto', ['setMarketsForm', 'spot']);
  assert.deepEqual([spot.markets.form, spot.markets.source], ['spot', 'all']);
  const perp = on('crypto', ['setMarketsForm', 'perp']);
  assert.deepEqual([perp.markets.form, perp.markets.source], ['perp', 'main']);
  // a form no source of the tab carries cannot be picked
  const macro = on('macro');
  assert.equal(R.setMarketsForm(macro, 'perp'), macro);
  assert.equal(R.setMarketsForm(macro, 'option'), macro);
  // a family that does not carry the Form set clears it; Main again clears one the main sources lack
  assert.deepEqual([R.setMarketsSource(spot, 'hyperliquid').markets.form, R.setMarketsSource(spot, 'okx').markets.form], ['', 'spot']);
  assert.deepEqual([R.setMarketsSource(spot, 'main').markets.source, R.setMarketsSource(spot, 'main').markets.form], ['main', '']);
  assert.equal(R.setMarketsSource(spot, 'nowhere'), spot, 'a source the tab does not list is no Source');
});

test('Form options a selection does not carry read none here; Options reads piece 3', () => {
  const form = s => Object.fromEntries(filtersOf(s.markets).form.options.map(o => [o.id, [o.disabled, o.note]]));
  const none = t('markets.filter.noneHere');
  assert.deepEqual(form(on('crypto')), {
    '': [false, null], spot: [false, null], perp: [false, null], token: [true, none], event: [false, null], option: [true, t('markets.filter.piece3')],
  }, 'under Main every form the tab carries is pickable (Spot switches to All sources)');
  assert.deepEqual(formsInView(on('macro').markets), ['event']);
  assert.deepEqual(formsInView(on('stocks').markets), ['spot', 'perp', 'token']);
  assert.deepEqual(formsInView(on('crypto', ['setMarketsSource', 'okx']).markets), ['spot'], 'a family carries its own');
  assert.equal(form(on('crypto', ['setMarketsSource', 'okx'])).perp[0], true);
});

test('Europe on Stocks is greyed with its note, Indices lights all eight, and there is no All region', () => {
  const region = filtersOf(on('stocks').markets).region;
  assert.equal(region.value, 'us');
  assert.deepEqual(region.options.map(o => [o.id, o.disabled, o.note]), [
    ...['us', 'cn', 'hk', 'jp', 'kr', 'tw', 'in'].map(id => [id, false, null]), ['eu', true, 'no source for European shares'],
  ]);
  assert.equal(t('markets.filter.noEuShares'), 'no source for European shares');
  assert.deepEqual(filtersOf(on('indices').markets).region.options.map(o => [o.id, o.disabled]), ['us', 'cn', 'hk', 'jp', 'kr', 'tw', 'in', 'eu'].map(id => [id, false]));
  for (const tab of ['crypto', 'commodities', 'fx', 'preipo', 'macro']) assert.equal(filtersOf(on(tab).markets).region, undefined, tab);
});

test('the empty table’s button returns to the main sources and keeps the region', () => {
  let s = on('stocks', ['setMarketsRegion', 'cn'], ['setMarketsSource', 'all'], ['setMarketsForm', 'spot']);
  s = R.marketsBackToMain(s);
  assert.deepEqual([s.markets.source, s.markets.form, s.markets.region], ['main', '', 'cn']);
  // an answered tab with no rows says so; one not answered says nothing yet
  const crypto = on('crypto', ['setMarketsForm', 'event']);
  assert.equal(tableOf(crypto.markets, NOW).empty, null);
  assert.equal(tableOf(landed(crypto, body()).markets, NOW).empty, 'filters');
});

test('the chips: Form and a non-main Source, each removable', () => {
  assert.deepEqual(filtersOf(on('crypto').markets).chips, [], 'Main draws none');
  const s = on('crypto', ['setMarketsSource', 'all']);
  assert.deepEqual(filtersOf(s.markets).chips, [{ kind: 'source', label: t('markets.source.all') }]);
  assert.equal(R.clearMarketsChip(s, 'source').markets.source, 'main');
  const both = on('crypto', ['setMarketsForm', 'spot']);
  assert.deepEqual(filtersOf(both.markets).chips.map(c => c.kind), ['form', 'source']);
  assert.deepEqual(filtersOf(both.markets).chips[0], { kind: 'form', label: t('markets.form.spot') });
  const noForm = R.clearMarketsChip(both, 'form');
  assert.deepEqual([noForm.markets.form, noForm.markets.source], ['', 'all']);
  // a popover opens by its name; a second press closes it; a pick closes it
  const open = R.openMarketsFilter(s, 'source');
  assert.equal(open.markets.open, 'source');
  assert.equal(R.openMarketsFilter(open, 'source').markets.open, null);
  assert.equal(R.setMarketsSource(open, 'main').markets.open, null);
  assert.equal(R.openMarketsFilter(s, 'bogus'), s);
});

test('the Source dropdown lists Main · names, All sources, then the tab’s families, main first', () => {
  const s = R.marketSourcesLoaded(on('preipo'), { data: REGISTRY, at: NOW });
  const source = filtersOf(s.markets).source;
  assert.deepEqual([source.value, source.label], ['main', t('markets.source.main', { names: 'Hyperliquid' })]);
  assert.deepEqual(source.options.slice(0, 2).map(o => o.id), ['main', 'all']);
  assert.equal(source.options[0].label, t('markets.source.main', { names: 'Hyperliquid' }));
  assert.deepEqual(familiesOf(s.markets).slice(0, 3), [
    { id: 'hyperliquid', label: 'Hyperliquid', ids: ['hyperliquid-preipo', 'trade-xyz'], main: true },
    { id: 'okx', label: 'OKX', ids: ['okx-preipo'], main: false },
    { id: 'gate', label: 'Gate', ids: ['gate-preipo'], main: false },
  ]);
  assert.deepEqual(source.options.slice(2).map(o => o.id), ['hyperliquid', 'okx', 'gate', 'krakenfutures', 'deribit', 'kucoinfutures', 'mexc', 'binance', 'bybit', 'kalshi', 'polymarket']);
  // two main families are named together
  const macro = R.marketSourcesLoaded(on('macro'), { data: REGISTRY, at: NOW });
  assert.equal(filtersOf(macro.markets).source.label, t('markets.source.main', { names: 'Kalshi + Polymarket' }));
  assert.deepEqual(familiesOf(macro.markets).map(f => [f.id, f.main]), [['kalshi', true], ['polymarket', true], ['polymarket-us', false]]);
  // a family picked is its chip, by its name
  assert.deepEqual(filtersOf(R.setMarketsSource(s, 'okx').markets).chips, [{ kind: 'source', label: 'OKX' }]);
  // Stocks: Main is Cboe; China A lists its one source
  assert.deepEqual(familiesOf(on('stocks', ['setMarketsRegion', 'cn']).markets).map(f => f.id), ['china']);
});

test('the Source dropdown works without the registry', () => {
  const failed = R.marketSourcesFailed(on('preipo'), { at: NOW, message: 'down' });
  assert.deepEqual(familiesOf(failed.markets).slice(0, 2).map(f => [f.id, f.label]), [['hyperliquid', 'hyperliquid'], ['okx', 'okx']]);
  assert.equal(filtersOf(failed.markets).source.label, t('markets.source.main', { names: 'hyperliquid' }));
  // the query is the same either way
  const ready = R.marketSourcesLoaded(on('preipo'), { data: REGISTRY, at: NOW });
  assert.equal(exploreQueryOf(failed.markets), exploreQueryOf(ready.markets));
  assert.equal(exploreQueryOf(R.setMarketsSource(failed, 'okx').markets), exploreQueryOf(R.setMarketsSource(ready, 'okx').markets));
  // never read at all
  assert.deepEqual(familiesOf(on('crypto').markets).map(f => f.label), ['hyperliquid', 'coinbase', 'kraken', 'okx', 'binance', 'bybit', 'kalshi', 'polymarket']);
});

test('an answer for another query is not drawn under the new filters', () => {
  const btc = listing('perp:BTC', 'hyperliquid', 'BTC-PERP');
  const crypto = on('crypto');
  const old = exploreQueryOf(crypto.markets);
  const s = R.setMarketsForm(crypto, 'perp');
  // the 20-second poll, or a slow source, lands the answer for Form all after Form Perp was picked
  const late = R.exploreLoaded(s, { tab: 'crypto', data: body(btc), at: NOW, query: old });
  const table = tableOf(late.markets, NOW);
  assert.deepEqual(table.rows, []);
  assert.deepEqual(table.read, { status: 'loading', answered: false, message: null });
  assert.equal(table.empty, null);
  // the answer for these filters is drawn
  assert.deepEqual(rowsOf(landed(late, body(btc)).markets, NOW).map(r => r.id), ['perp:BTC']);
  // a refusal for these filters drops the other filters' rows and says so
  const refused = R.exploreFailed(late, { tab: 'crypto', at: NOW, message: 'busy', query: exploreQueryOf(s.markets) });
  assert.deepEqual(tableOf(refused.markets, NOW).rows, []);
  assert.deepEqual(tableOf(refused.markets, NOW).read, { status: 'error', answered: false, message: 'busy' });
  // a refusal of a read again keeps its rows
  const again = R.exploreFailed(landed(late, body(btc)), { tab: 'crypto', at: NOW, message: 'busy', query: exploreQueryOf(s.markets) });
  assert.deepEqual(rowsOf(again.markets, NOW).map(r => r.id), ['perp:BTC']);
});

test('a sort change keeps the drawn rows while its read is asked', () => {
  const btc = listing('perp:BTC', 'hyperliquid', 'BTC-PERP', {});
  const eth = { ...listing('perp:ETH', 'hyperliquid', 'ETH-PERP'), changePct24h: 9, volumeUsd24h: 10 };
  const s = landed(on('crypto'), body({ ...btc, changePct24h: 1 }, eth));
  const movers = R.setMarketsSort(s, 'movers');
  assert.notEqual(exploreQueryOf(movers.markets), exploreQueryOf(s.markets));
  const table = tableOf(movers.markets, NOW);
  assert.equal(table.read.answered, true);
  assert.deepEqual(table.rows.map(r => r.id), ['perp:ETH', 'perp:BTC'], 'drawn in the new sort at once');
});

test('a search reaches every class and names it; Back restores the tab and its filters', () => {
  const nvda = { ...listing('stock:NVDA', 'cboe', 'NVDA'), kind: 'stock', asset: 'stocks', form: 'spot', region: 'us' };
  const fed = { key: 'kalshi:FED', kind: 'event', name: 'Fed cut?', price: 0.4, asset: 'macro', form: 'event', tabs: ['all'], at: [] };
  const odd = { ...listing('perp:para:ODD', 'hyperliquid', 'para:ODD-PERP'), asset: undefined, form: 'perp' };
  const moutai = { key: 'cn:600519', kind: 'ashare', name: '贵州茅台', base: '600519', currency: 'CNY', price: 1450, tabs: ['china'],
    at: [{ venue: 'china', venueName: 'Tencent', symbol: '600519', connected: false, public: true, price: 1450 }] };
  let s = on('indices', ['setMarketsForm', 'perp']);
  s = R.setMarketsQuery(s, '茅台');
  assert.deepEqual([s.markets.tab, s.markets.form], ['indices', 'perp'], 'the tab and its filters stay while searching');
  s = R.resultsLoaded(s, { data: body(nvda, fed, odd, moutai), at: NOW });
  const table = tableOf(s.markets, NOW);
  assert.equal(table.searching, true);
  assert.equal(table.filters, null, 'the bar is set aside while searching');
  assert.deepEqual(table.rows.map(r => [r.id, r.className]).sort(), [
    ['cn:600519', t('markets.tab.stocks')], ['kalshi:FED', t('markets.tab.macro')], ['perp:para:ODD', t('markets.form.perp')], ['stock:NVDA', t('markets.tab.stocks')],
  ]);
  const back = R.setMarketsQuery(s, '');
  assert.deepEqual([back.markets.tab, back.markets.form, back.markets.q, back.markets.results.data], ['indices', 'perp', '', null]);
  // another tab pressed while searching ends the search there
  const crypto = R.setMarketsTab(s, 'crypto');
  assert.deepEqual([crypto.markets.tab, crypto.markets.q, crypto.markets.results.data], ['crypto', '', null]);
});

test('the Watchlist has no filters and no star column, and keeps the sort', () => {
  const btc = listing('perp:BTC', 'hyperliquid', 'BTC-PERP');
  let s = R.exploreLoaded(markets(), { tab: 'watchlist', data: body(btc, listing('perp:ETH', 'hyperliquid', 'ETH-PERP')), at: NOW, query: 'limit=200' });
  s = R.accountWatchLoaded(s, { items: ['perp:BTC', 'coin:GONE'] });
  s = R.watchlistLoaded(s, { items: [{ id: 'cn:600519', market: 'cn', symbol: '600519', name: 'Moutai', currency: 'CNY' }] });
  assert.equal(filtersOf(s.markets), null);
  const table = tableOf(R.setMarketsSort(s, 'closing').markets, NOW);
  assert.equal(table.filters, null);
  assert.deepEqual(table.rows.map(r => [r.id, r.noStar, r.watched]), [['perp:BTC', true, true], ['coin:GONE', true, true], ['cn:600519', true, true]]);
  assert.deepEqual([table.sorts.map(x => x.id), table.sort], [['volume', 'movers'], 'volume']);
  assert.equal(R.setMarketsForm(s, 'perp'), s, 'no Form there');
  assert.equal(R.setMarketsSource(s, 'all'), s, 'no Source there');
  // a star read under another tab is found there
  const elsewhere = R.accountWatchLoaded(landed(on('stocks'), body({ ...btc, key: 'stock:NVDA' })), { items: ['stock:NVDA'] });
  assert.deepEqual(rowsOf(R.setMarketsTab(elsewhere, 'watchlist').markets, NOW).map(r => [r.id, r.placeholder ?? false]), [['stock:NVDA', false]]);
  // a tab's rows are its read's alone: no star draws there unless the read lists it
  assert.deepEqual(rowsOf(landed(R.setMarketsTab(s, 'crypto'), body()).markets, NOW), []);
});

test('an empty Watchlist says how to fill it', () => {
  const table = tableOf(markets().markets, NOW);
  assert.deepEqual([table.rows, table.empty], [[], 'watchlist']);
  assert.deepEqual(table.tabs.map(x => x.id), MARKET_TABS);
  assert.deepEqual(table.tabs.map(x => x.label), MARKET_TABS.map(id => t(`markets.tab.${id}`)));
  assert.ok(table.tabs.every(x => !('count' in x)), 'no counts (G1)');
});

test('a perp row is named perp', () => {
  const xyz = { ...listing('perp:xyz:BTC', 'trade-xyz', 'xyz:BTC-PERP'), name: 'xyz:BTC perp', base: 'xyz:BTC' };
  const s = landed(on('crypto'), body(xyz));
  const row = rowsOf(s.markets, NOW)[0];
  assert.deepEqual([row.id, row.name, row.tile, row.asset, row.form], ['perp:xyz:BTC', 'BTC perp', 'BTC', 'crypto', 'perp']);
  assert.equal(pageOf(s.markets, {}, xyz.key, NOW).name, 'BTC perp');
  // a supplied name stays verbatim
  assert.equal(rowsOf(landed(on('crypto'), body({ ...xyz, name: 'xyz:BTC custom label' })).markets, NOW)[0].name, 'xyz:BTC custom label');
});

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

test('each contract and its page carry a small accessible, local source mark', async () => {
  // the render is imported here alone: it is redrawn by underlying in Task 8
  const { renderMarketsScreen, sourceBadge } = await import('../../client/js/render/markets.js');
  const btc = listing('perp:BTC', 'hyperliquid', 'BTC-PERP');
  const nvda = listing('perp:xyz:NVDA', 'trade-xyz', 'xyz:NVDA-PERP');
  let s = landed(on('crypto', ['setMarketsSource', 'all']), body(btc, nvda));
  const html = renderMarketsScreen(s, NOW);
  const row = key => html.match(new RegExp(`<tr data-id="${key}">[\\s\\S]*?</tr>`))?.[0] ?? '';
  assert.match(row('perp:BTC'), /mk-source-hyperliquid" role="img" aria-label="Hyperliquid" title="Hyperliquid"/);
  assert.match(row('perp:xyz:NVDA'), /mk-source-xyz" role="img" aria-label="trade.xyz" title="trade.xyz"/);
  assert.doesNotMatch(html, /<img|https?:/);
  s = R.nav(s, { screen: 'markets', id: nvda.key });
  assert.match(renderMarketsScreen(s, NOW), /mk-pg-head[\s\S]*?mk-source-xyz" role="img" aria-label="trade.xyz"/);
  assert.equal(sourceBadge('<img src=x>'), '');
});
