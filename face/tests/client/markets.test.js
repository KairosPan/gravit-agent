// Markets on the face (spec 2026-10-22 §6.1): the Account's markets in one table — its tabs, its sorts, its search, each row's
// price by kind and where the price is from in the Account's own words — beside the face's A-share (cn:) rows, and a market's
// page from the Account's reads: its price and 24 hours, its facts, its price history for a range, its lines across venues,
// what is held, working and stated for it. A cn: page is the face's own quote. States are built with the reducers over the
// stand-in's answers (tests/fixtures/account/). Buy and Sell (the Trade ticket) only on a page that signs, Sell only where the market is held.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarketsScreen, marketPage, mkAv } from '../../client/js/render/markets.js';
import { candlesSvg } from '../../client/js/render/chart.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { rowsOf, CANDLE_RANGES, exploreQueryOf } from '../../client/js/host/market-view.js';
import * as MV from '../../client/js/host/market-view.js';
import { optionChainOf } from '../../client/js/wire/options.js';
import { fmtClock, fmtDate, sameDay } from '../../client/js/time.js';
import { createStore } from '../../client/js/store.js';
import { startMarkets } from '../../client/js/host/markets.js';
import { getJsonVia } from '../../client/js/app.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { nyDay } from '../../client/js/host/event-window.js';
import { localQuoteOf } from '../../client/js/wire/local.js';
import { EVENT_VIEW_ID, EVENT_VIEW_WITH_B, WYNN_B_CASE } from './helpers/event-view.js';
import { cryptoOptionsList, usOptionsList, btcChain, aaplChain, NO_OPTIONS } from './helpers/options.js';

// the renderer's clock: the stand-in's day — its statement is from that morning, its events close after it
const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();
const CJK = /[㐀-鿿]/;
// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const itemOf = (body, key) => body.items.find(i => i.key === key);

// two events beside the fixture's: a Kalshi market, whose volume is contracts, and a Polymarket one past its end
const PARIS = `pm:0x${'ab'.repeat(32)}`;
const kalshi = () => ({
  key: 'kalshi:KXFED-DEC', kind: 'event', name: 'Fed cuts in December?', price: 0.62, change24h: 0.03, contracts24h: 412000, volumeUsd24h: 4100000,
  category: 'Economics', closeTime: '2026-12-10T19:00:00.000Z', tabs: ['all', 'predictions'],
  outcomes: [{ label: 'YES', price: 0.62, at: [{ venue: 'kalshi', symbol: 'KXFED-DEC:YES' }] }, { label: 'NO', price: 0.38, at: [{ venue: 'kalshi', symbol: 'KXFED-DEC:NO' }] }],
  at: [{ venue: 'kalshi', venueName: 'Kalshi', symbol: 'KXFED-DEC:YES', connected: true, canTrade: true, public: false, price: 0.62, bid: 0.61, ask: 0.63, open: true }],
});
const paris = () => ({
  key: PARIS, kind: 'event', name: 'Will it rain in Paris on Sunday?', price: 0.12, change24h: -0.01, volumeUsd24h: 18000,
  category: 'Climate', closeTime: '2026-10-20T00:00:00.000Z', pastEnd: true, tabs: ['all', 'predictions'],
  at: [{ venue: 'pm-public', venueName: 'Polymarket', symbol: 'paris-rain:Yes', connected: false, canTrade: false, public: true, price: 0.12, pastEnd: true, connectTo: 'polymarket', connector: 'live:polymarket' }],
});
// All's read with the Fed question and the two above among its items
const withEvents = () => {
  const all = fx('explore-all');
  all.items.push(itemOf(fx('explore-predictions'), 'event:predict:SI-FEDCUT-DEC'), kalshi(), paris());
  return all;
};

// an A share as the face's wire stores it — an English name here, so the sweep for Chinese can cover its row — and its quote,
// whose own words (its source, its message) are Chinese and never drawn; an old us: star the Account could not find
const MOUTAI = { id: 'cn:600519', market: 'cn', symbol: '600519', name: 'Kweichow Moutai', exchange: 'SH', currency: 'CNY' };
const moutaiQuote = (over = {}) => ({
  id: 'cn:600519', market: 'cn', symbol: '600519', transport: 'stream', price: 1688, prev_close: 1680, change: 8, change_pct: 0.48, volume: 2_000_000,
  as_of: ago(60_000), received_at: null, volume_as_of: null, source: '同花顺', feed: 'realtime', basis: 'previous_close', quote_status: 'live',
  market_status: 'open', message: '行情连接已断开，保留上次报价。', ...over,
});
const ZED = { id: 'us:ZZZZ', market: 'us', symbol: 'ZZZZ', name: 'Zed Corp', exchange: '', currency: 'USD' };
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 60_000, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });

// a state the reducers build — Markets on screen or a market's page, the Account's reads that landed, the face's A shares — and
// what the screen draws of it
function screen({
  route = { screen: 'markets', id: null }, all = fx('explore-all'), predictions = null, tab = null, sort = null, q = '', results = null,
  cn = [], quotes = {}, connection = 'polling', status = null, watch = [], asked = {}, live = [], candles = null, account = false,
  conversations = [], watchError = null, role = null, here, source = null,
} = {}) {
  // the tab on screen (Crypto unless one is given) and, when given, its Source; `all` is the Watchlist's unscoped read and the
  // tab's own read for its query, `predictions` Macro & events' (market-view.js exploreQueryOf: a read is drawn for its query)
  const shown = tab ?? 'crypto';
  let s = R.setMarketsTab(R.nav(emptyState(), route), shown);
  if (source) s = R.setMarketsSource(s, source);
  if (all) s = R.exploreLoaded(s, { tab: 'watchlist', data: all, at: NOW, query: exploreQueryOf({ ...s.markets, tab: 'watchlist' }) });
  if (predictions && shown !== 'macro') s = R.exploreLoaded(s, { tab: 'macro', data: predictions, at: NOW, query: exploreQueryOf({ ...s.markets, tab: 'macro', source: 'main', form: '' }) });
  const own = shown === 'macro' && predictions ? predictions : all;
  if (own && shown !== 'watchlist') s = R.exploreLoaded(s, { tab: shown, data: own, at: NOW, query: exploreQueryOf(s.markets) });
  s = R.accountWatchLoaded(s, { items: watch, error: null });
  s = R.watchlistLoaded(s, { items: cn, error: watchError });
  for (const [faceId, key] of Object.entries(asked)) s = R.askedOfAccount(s, { faceId, key });
  s = R.quotesUpdated(s, { quotes, connection });
  if (status) s = R.chinaStatusUpdated(s, { status });
  if (live.length) s = R.accountQuotesLoaded(s, { quotes: live });
  if (candles) s = R.candlesLoaded(s, { at: NOW, ...candles });
  if (account) {
    s = R.accountLoaded(s, { data: fx('account'), at: NOW });
    s = R.holdingsLoaded(s, { data: fx('holdings'), at: NOW });
    s = R.paperLoaded(s, { data: fx('holdings-paper'), at: NOW });
    s = R.statementLoaded(s, { data: fx('statement'), at: NOW });
  }
  // the asset sheet of the page's market, the stand-in's (a market it holds nothing of: an empty sheet), with the Account's
  // reads; `here` another body, or null for none landed
  const sheet = here !== undefined ? here : account && route.id ? assetSheet(route.id) : null;
  if (sheet) s = R.depthLoaded(s, { id: route.id, part: 'here', data: sheet, at: NOW });
  if (q) s = R.setMarketsQuery(s, q);
  if (results) s = R.resultsLoaded(s, { data: results, at: NOW });
  if (sort) s = R.setMarketsSort(s, sort);
  if (conversations.length) s = { ...s, conversations };
  if (role) s = R.ownerStanding(s, { role, kid: role === 'signs' ? 'a5048199a8081854' : '' });
  return { s, html: renderMarketsScreen(s, NOW) };
}
// the stand-in's asset sheet for a market's page, by the asset the Account reads it as
const SHEETS = { 'coin:BTC': 'asset-btc', 'perp:BTC': 'asset-btc', 'coin:SOL': 'asset-sol', 'stock:NVDA': 'asset-nvda', 'event:predict:SI-FEDCUT-DEC': 'asset-event' };
const assetSheet = id => (Object.hasOwn(SHEETS, id) ? fx(SHEETS[id]) : { ok: true, key: id, positions: [], orders: [], lines: [], cost: [], missing: [] });
const rowIds = html => [...html.matchAll(/<tr data-id="([^"]+)"/g)].map(m => m[1]);
const rowOf = (html, id) => html.match(new RegExp(`<tr data-id="${id.replace(/[/.:]/g, c => `\\${c}`)}">[\\s\\S]*?</tr>`))?.[0] ?? '';
const cells = tr => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
const text = html => html.replace(/<[^>]+>/g, '');
const section = (html, label) => html.match(new RegExp(`<section class="dsec" aria-label="${label}">[\\s\\S]*?</section>`))?.[0] ?? '';
// a section's lines, one chunk each
const linesOf = sec => sec.split('<div class="mk-line">').slice(1);
// a statement line's time as the screen says it: the clock today, the day and the clock before it
const stamp = at => { const t = Date.parse(at); return sameDay(t, NOW) ? fmtClock(t) : `${fmtDate(t)} ${fmtClock(t)}`; };

test('the table: the tabs, rows with source words, cents for an event, contracts for Kalshi, Closed past end', () => {
  const { s, html } = screen({
    all: withEvents(),
    // the latest quote at NVDA's broker: its price leads the row; its own 24 hours and volume do not
    live: [{ venue: 'broker', symbol: 'NVDA', market: { price: 183.1, bid: 183.05, ask: 183.15, quoteAt: ago(90_000), quoteFrom: 'Stand-in Broker · real time', changePct24h: 9.9, volumeUsd24h: 1 } }],
  });
  assert.match(html, /^<main class="main mkts">/);
  assert.match(html, /<h1 class="head-title">Markets<\/h1>/);
  assert.match(html, /id="mq" type="search" autocomplete="off" placeholder="Search markets" data-action="mkQuery" value=""/);
  // the tabs: the Watchlist's star, then the seven classes, Crypto pressed, no counts
  const tabs = [...html.matchAll(/<button type="button" class="mk-tab" data-action="mkTab" data-value="([^"]+)" aria-pressed="(true|false)">([^<]+)<\/button>/g)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(tabs, [
    ['crypto', 'true', 'Crypto'], ['stocks', 'false', 'Stocks'], ['indices', 'false', 'Indices'], ['commodities', 'false', 'Commodities'],
    ['fx', 'false', 'FX'], ['preipo', 'false', 'Pre-IPO'], ['macro', 'false', 'Macro &amp; events'],
  ]);
  assert.match(html, /<th scope="col" class="r">Price<\/th><th scope="col" class="r mk-c-chg">24h<\/th><th scope="col" class="r mk-c-vol">Volume<\/th><th scope="col" class="r mk-c-st">Source<\/th>/);
  // every row of the tab, each by its key, in the view's order: Most traded, the events' smaller volumes last
  assert.deepEqual(rowIds(html), rowsOf(s.markets, NOW).map(r => r.id));
  assert.equal(rowIds(html).length, 15);
  assert.deepEqual(rowIds(html).slice(-3), ['event:predict:SI-FEDCUT-DEC', 'kalshi:KXFED-DEC', PARIS]);

  // a stock: its tile by its symbol, its broker under its name, the quote's price with where it is from and how old, the read's 24h
  const [star, name, px, move, volume, source] = cells(rowOf(html, 'stock:NVDA'));
  assert.match(star, /^<button type="button" class="mk-star" data-action="toggleWatch" data-id="stock:NVDA" aria-pressed="false" aria-label="Watch NVIDIA Corporation common stock"><svg [^>]*>[\s\S]*<\/svg><\/button>$/);
  assert.match(name, /^<button type="button" class="mk-name" data-action="openMarket" data-id="stock:NVDA"><span class="mk-av" aria-hidden="true">NVDA<\/span><span class="mk-nm"><b>NVIDIA Corporation common stock<\/b><span class="mk-sub">Stand-in Broker<\/span><\/span><\/button>$/);
  assert.equal(px, '$183.10');
  assert.equal(move, '<span class="up"><span aria-hidden="true">▲</span><span class="sr-only">up</span> 1.90%</span>');
  assert.equal(volume, '$31.7B');
  assert.equal(source, '<span class="mk-st">Stand-in Broker · real time · 1 min ago</span>');
  // without a quote, the explore read's price and the venue its 24h is from
  assert.deepEqual(cells(rowOf(html, 'stock:SPY')).slice(2).map(text), ['$662.10', '▲up 0.40%', '$27.9B', 'Stand-in Broker']);
  // a coin only a paper account trades says so; its price to its own precision
  assert.match(rowOf(html, 'coin:DOGE'), /<span class="mk-sub">DOGE <span class="mk-tag">Paper<\/span><\/span>/);
  assert.deepEqual(cells(rowOf(html, 'coin:DOGE')).slice(2).map(text), ['$0.1214', '▲up 12.40%', '$787.3M', 'Stand-in Public Exchange']);
  assert.match(rowOf(html, 'perp:BTC'), /<span class="mk-av" aria-hidden="true">BTC<\/span><span class="mk-nm"><b>BTC perpetual<\/b><span class="mk-sub">BTC · Perp<\/span>/, "the fixture's name as the Account gave it; the sub in the face's word, Perp");
  assert.doesNotMatch(rowOf(html, 'stock:NVDA'), /mk-tag/, 'its broker is real money');

  // an event: its category for its sub and its tile, its price and its move in cents
  const fed = rowOf(html, 'event:predict:SI-FEDCUT-DEC');
  assert.match(fed, /<span class="mk-av" aria-hidden="true">Econ<\/span><span class="mk-nm"><b>Will the Fed cut rates at its December meeting\?<\/b><span class="mk-sub">Economics<\/span>/);
  assert.deepEqual(cells(fed).slice(2).map(text), ['62¢', '▲up 4¢', '$1.8M', 'Stand-in Predictions']);
  // Kalshi counts contracts, never dollars
  assert.deepEqual(cells(rowOf(html, 'kalshi:KXFED-DEC')).slice(2).map(text), ['62¢', '▲up 3¢', '412k contracts', 'Kalshi']);
  // past its end: Closed; only a public listing prices it, so no source is named
  const rain = rowOf(html, PARIS);
  assert.match(rain, /<span class="mk-sub">Climate <span class="mk-tag">Closed<\/span><\/span>/);
  assert.deepEqual(cells(rain).slice(2).map(text), ['12¢', '▼down 1¢', '$18k', '']);
  assert.doesNotMatch(html, /mk-note/, 'nothing to say: the reads answered, no cn row is drawn');

  // the tile: the first word of what it is given, four letters at most
  assert.equal(mkAv('Economics'), '<span class="mk-av" aria-hidden="true">Econ</span>');
  assert.equal(mkAv('BTC perpetual', 'lg'), '<span class="mk-av mk-av-lg" aria-hidden="true">BTC</span>');
});

test('sorts: Most traded, Biggest moves, Closing soonest only with events', () => {
  const sortsOf = html => [...html.matchAll(/data-action="mkSort" data-value="([^"]+)">([^<]+)</g)].map(m => [m[1], m[2]]);
  // the fixture's All lists no event: two sorts, Most traded pressed
  const plain = screen();
  assert.deepEqual(sortsOf(plain.html), [['volume', 'Most traded'], ['movers', 'Biggest moves']]);
  assert.match(plain.html, /<button type="button" class="seg-item pressed" aria-pressed="true" data-action="mkSort" data-value="volume">Most traded<\/button>/);
  assert.deepEqual(rowIds(plain.html), ['stock:NVDA', 'stock:SPY', 'stock:AAPL', 'perp:BTC', 'coin:BTC', 'perp:ETH', 'coin:ETH', 'coin:DOGE', 'perp:SOL', 'coin:SOL', 'coin:LINK', 'perp:DOGE']);
  // Biggest moves: DOGE's 12.4 % first, the stocks' small moves last
  const movers = screen({ sort: 'movers' });
  assert.match(movers.html, /class="seg-item pressed" aria-pressed="true" data-action="mkSort" data-value="movers">Biggest moves</);
  assert.deepEqual(rowIds(movers.html), rowsOf(movers.s.markets, NOW).map(r => r.id));
  assert.deepEqual(rowIds(movers.html).slice(0, 3), ['coin:DOGE', 'perp:DOGE', 'coin:LINK']);
  assert.deepEqual(rowIds(movers.html).slice(-2), ['stock:AAPL', 'stock:SPY']);
  // the events' tab: Closing soonest too, the soonest first; an event's move in cents ranks under Biggest moves
  const predictions = fx('explore-predictions');
  const events = screen({ predictions, tab: 'macro' });
  assert.match(events.html, /data-value="macro" aria-pressed="true">Macro &amp; events</);
  assert.deepEqual(sortsOf(events.html), [['volume', 'Most traded'], ['movers', 'Biggest moves'], ['closing', 'Closing soonest']]);
  const closing = screen({ predictions, tab: 'macro', sort: 'closing' });
  assert.match(closing.html, /class="seg-item pressed" aria-pressed="true" data-action="mkSort" data-value="closing">Closing soonest</);
  assert.deepEqual(rowIds(closing.html).slice(0, 2), ['event:predict:SI-BTC15-2610220730', 'event:paper-momentum:SX-YIELD-FRI']);
  assert.equal(rowIds(screen({ predictions, tab: 'macro', sort: 'movers' }).html)[0], 'event:predict:SI-ETH-WEEK', 'its 6¢ the biggest move');
  // a tab with an event among its rows offers it too
  assert.deepEqual(sortsOf(screen({ all: withEvents() }).html).map(x => x[0]), ['volume', 'movers', 'closing']);
  // one row needs no sort
  const one = fx('explore-all');
  one.items = one.items.slice(0, 1);
  assert.doesNotMatch(screen({ all: one }).html, /data-action="mkSort"/);
});

test('a cn star on the Watchlist beside the Account stars, never under a tab; Not listed line with Remove for a missed star', () => {
  const cnState = (over = {}) => screen({ cn: [MOUTAI, ZED], asked: { 'us:ZZZZ': null }, quotes: { 'cn:600519': moutaiQuote() }, ...over });
  const stocks = cnState({ tab: 'stocks' }).html;
  assert.match(stocks, /data-value="stocks" aria-pressed="true">Stocks</);
  assert.match(stocks, /data-value="watchlist" aria-pressed="false" title="Watchlist">/);
  assert.doesNotMatch(stocks, /cn:600519|us:ZZZZ/, "a tab draws its own read's rows alone");
  assert.doesNotMatch(stocks, /mk-note/);
  const list = cnState({ tab: 'watchlist' }).html;
  assert.deepEqual(rowIds(list), ['cn:600519', 'us:ZZZZ']);
  // the Watchlist's rows carry no star column (G6)
  const [name, px, move, volume, source] = cells(rowOf(list, 'cn:600519'));
  assert.doesNotMatch(list, /class="mk-star"|<span class="sr-only">Watch<\/span>/);
  assert.match(name, /data-action="openMarket" data-id="cn:600519"><span class="mk-av" aria-hidden="true">K<\/span><span class="mk-nm"><b>Kweichow Moutai<\/b><span class="mk-sub">600519 · SH<\/span>/);
  assert.equal(px, '¥1,688.00');
  assert.equal(text(move), '▲up 0.48%');
  assert.equal(volume, '2M shares');
  assert.equal(text(source), 'Tencent', "the face's provider by its name, never the wire's own words");
  // the old star the Account could not find: Not listed, every figure a dash, Remove after its name, no page to open
  const zed = rowOf(list, 'us:ZZZZ');
  const z = cells(zed);
  assert.equal(z[0], '<span class="mk-who"><span class="mk-av" aria-hidden="true">Zed</span><span class="mk-nm"><b>Zed Corp</b><span class="mk-sub">Not listed at the Account</span></span><button type="button" class="mk-clear" data-action="removeAsked" data-id="us:ZZZZ" aria-label="Remove Zed Corp">Remove</button></span>');
  assert.deepEqual(z.slice(1).map(text), ['—', '—', '—', '']);
  assert.doesNotMatch(zed, /mk-star|openMarket/);
  // the A shares' quotes read's state, only where a cn row is drawn: polling, as it always is, says nothing; a failed read is said
  assert.match(cnState({ tab: 'watchlist', connection: 'error' }).html, /<p class="mk-note">Quotes unavailable<\/p>/);
  assert.doesNotMatch(list, /mk-note/, 'polling says nothing');
  assert.doesNotMatch(cnState({ tab: 'crypto', connection: 'error' }).html, /Quotes unavailable/, 'no cn row on Crypto');
  assert.match(cnState({ tab: 'stocks', watchError: 'full' }).html, /<p class="mk-note">The watchlist is full<\/p>/);
  // every star — the Account's found in the read, a key no read lists as a placeholder with Remove, the A share, the Not listed line
  const watching = cnState({ watch: ['coin:BTC', 'kalshi:KXGONE-26'], tab: 'watchlist' }).html;
  assert.match(watching, /data-value="watchlist" aria-pressed="true" title="Watchlist">/);
  assert.deepEqual(rowIds(watching), ['coin:BTC', 'kalshi:KXGONE-26', 'cn:600519', 'us:ZZZZ']);
  const gone = rowOf(watching, 'kalshi:KXGONE-26');
  assert.match(gone, /<span class="mk-who"><span class="mk-av" aria-hidden="true">KXGO<\/span><span class="mk-nm"><b>KXGONE-26<\/b><span class="mk-sub">Not in this read<\/span><\/span><button type="button" class="mk-clear" data-action="toggleWatch" data-id="kalshi:KXGONE-26" aria-label="Remove KXGONE-26">Remove<\/button>/);
  assert.deepEqual(cells(gone).slice(1).map(text), ['—', '—', '—', '']);
  assert.doesNotMatch(gone, /openMarket/, 'no read lists it: no page');
  assert.doesNotMatch(rowOf(watching, 'coin:BTC'), /mk-clear|mk-star/, 'a row a tab or a search reaches is un-starred there');
});

test("the Watchlist is the Account's list and the face's; under a tab a row watched at the Account alone reads Watched at the Account under its star", () => {
  const AT = '<span class="mk-at">Watched at the Account</span>';
  // the page watches ex BTC/USDT and DOGE/USD at standin-pubex; the face's list has AAPL and BTC
  const watching = screen({ account: true, watch: ['stock:AAPL', 'coin:BTC'], cn: [MOUTAI], tab: 'watchlist' }).html;
  assert.deepEqual(rowIds(watching), ['stock:AAPL', 'coin:BTC', 'coin:DOGE', 'cn:600519']);
  assert.doesNotMatch(watching, /mk-at|mk-star/, 'no star column on the Watchlist');
  // a tab: the page's rows starred, Watched at the Account under the star of one on the page's list alone
  const all = screen({ account: true }).html;
  assert.match(all, /data-value="watchlist" aria-pressed="false"/);
  const doge = cells(rowOf(all, 'coin:DOGE'))[0];
  assert.equal(doge, `<button type="button" class="mk-star" data-action="toggleWatch" data-id="coin:DOGE" aria-pressed="true" aria-label="Stop watching DOGE">${doge.match(/<svg[\s\S]*<\/svg>/)[0]}</button>${AT}`);
  assert.match(cells(rowOf(all, 'coin:BTC'))[0], /aria-pressed="true" aria-label="Stop watching BTC">[\s\S]*Watched at the Account/);
  assert.match(cells(rowOf(all, 'coin:ETH'))[0], /aria-pressed="false"/);
  assert.doesNotMatch(cells(rowOf(all, 'coin:ETH'))[0], /mk-at/);
  const faces = screen({ account: true, watch: ['stock:AAPL'] }).html;
  assert.doesNotMatch(cells(rowOf(faces, 'stock:AAPL'))[0], /mk-at/, "on the face's list");
  // no page: the Watchlist remains available, with no star on
  const none = screen().html;
  assert.match(none, /data-value="watchlist"/);
  assert.doesNotMatch(none, /mk-at|aria-pressed="true" aria-label="Stop watching/);
  // a market's page reads it watched
  const pageHtml = screen({ account: true, route: { screen: 'markets', id: 'coin:DOGE' } }).html;
  assert.match(pageHtml, /data-action="toggleWatch" data-id="coin:DOGE" aria-pressed="true">[\s\S]*?Watching<\/button>/);
  // a refusal at the Account is its own sentence under the table
  const s = R.accountWatchLoaded(screen({ account: true }).s, { items: [], error: 'ETH/USDT is not listed at Stand-in Exchange.' });
  assert.match(renderMarketsScreen(s, NOW), /<p class="mk-note">ETH\/USDT is not listed at Stand-in Exchange\.<\/p>/);
});

test('You here sorts the owner’s orders by their authority, never by the word that names the owner: under another table too', () => {
  const html = withTable({ 'agents.who.you': 'Vous' }, () => screen({ route: { screen: 'markets', id: 'coin:BTC' }, account: true }).html);
  const here = section(html, 'You here');
  assert.ok(linesOf(here).map(text).includes('·Stand-in Exchange · Sell 0.002 BTC/USDT · limit 63,226.6 · open · Vous'), 'the owner’s order under You here, in the table’s word');
  assert.doesNotMatch(here, /What agents do here/, 'the owner’s order is no agent’s');
});

test("a position's side, a statement line's status and who it was by, and a funding line's side are drawn from the table, and an unknown code as it came", () => {
  const probe = {
    'account.positionSide.long': 'LONG-W', 'markets.here.position': '{symbol} | {qty} | {side}', 'account.statementStatus.canceled': 'CANCELED-W',
    'account.statementStatus.open': 'OPEN-W', 'account.statementBy.you': 'YOU-W', 'account.statementBy.inLimit': '[{name}] in-limit', 'markets.funding.held': '{qty} {side}',
  };
  const btc = withTable(probe, () => screen({ route: { screen: 'markets', id: 'coin:BTC' }, account: true }).html);
  assert.ok(linesOf(section(btc, 'You here')).map(text).some(l => l.startsWith('·Stand-in Exchange · BTC/USDT:USDT | 0.01 | LONG-W · ')), 'a position in the table’s order');
  assert.deepEqual(linesOf(section(btc, 'On the statement')).map(text).map(l => l.slice(l.indexOf('$0.00') + 5)), ['CANCELED-W · YOU-W', 'OPEN-W · YOU-W']);
  const sol = withTable(probe, () => screen({ route: { screen: 'markets', id: 'coin:SOL' }, account: true }).html);
  assert.ok(linesOf(section(sol, 'You here')).map(text).some(l => l.endsWith('$0.00OPEN-W · [Claude Code] in-limit')), 'an agent’s statement line under what agents do here');
  const perp = screen({ route: { screen: 'markets', id: 'perp:BTC' }, account: true }).s;
  const funding = { ok: true, missing: [], lines: [{ at: '2026-10-22T10:00:00.000Z', symbol: 'BTC/USDT:USDT', side: 'long', qty: 0.01, rate: 0.0001, usd: 0.06, venue: 'ex', venueName: 'Stand-in Exchange' }] };
  const paid = withTable(probe, () => renderMarketsScreen(R.depthLoaded(perp, { id: 'perp:BTC', part: 'funding', data: funding, at: NOW }), NOW));
  assert.match(section(paid, 'Funding'), / · Stand-in Exchange · 0\.01 LONG-W · rate 0\.0100%/);
  // codes with no word: drawn as they came
  const here = fx('asset-btc');
  here.positions = here.positions.map(p => ({ ...p, side: 'flat' }));
  const s = screen({ route: { screen: 'markets', id: 'coin:BTC' }, account: true, here }).s;
  const statement = fx('statement');
  statement.lines = statement.lines.map(l => ({ ...l, status: 'held at the bank', by: 'Someone else' }));
  const odd = renderMarketsScreen(R.statementLoaded(s, { data: statement, at: NOW }), NOW);
  assert.ok(linesOf(section(odd, 'You here')).map(text).some(l => l.startsWith('·Stand-in Exchange · flat 0.01 BTC/USDT:USDT · ')), 'a side with no word');
  assert.ok(linesOf(section(odd, 'On the statement')).map(text).every(l => l.endsWith('$0.00held at the bank · Someone else')), 'a status and a by with no word');
});

test('the page: no Buy, no Sell on a page that does not sign; the range seg; Across venues with best and Connect to trade; You here; On the statement', () => {
  const page = (id, over = {}) => screen({ route: { screen: 'markets', id }, account: true, ...over });
  const btc = page('coin:BTC', {
    watch: ['coin:BTC'],
    live: [{ venue: 'ex', symbol: 'BTC/USDT', market: { price: 62510.5, bid: 62509, ask: 62512, quoteAt: ago(90_000), quoteFrom: 'Stand-in Exchange · live', changePct24h: 9.9, volumeUsd24h: 1 } }],
    conversations: [conv('s1', { title: 'Is BTC breaking out?' }), conv('s2', { title: 'cbBTC notes' })],
  });
  const html = btc.html;
  assert.equal(btc.s.route.id, 'coin:BTC', 'the route keeps the Account key whole');
  assert.match(html, /^<main class="main mkts mk-page"><a id="page-back" class="back-link page-back" href="#\/markets">‹ Markets<\/a>/);
  assert.match(html, /<div class="mk-who"><span class="mk-av mk-av-lg" aria-hidden="true">BTC<\/span><div><h1 class="head-title">BTC<\/h1><span class="mk-sub">Crypto · BTC\/USDT<\/span><\/div><\/div>/);
  assert.match(html, /<button type="button" class="btn" data-action="handToGravit" data-id="coin:BTC">[\s\S]*?Hand to gravit<\/button>/);
  assert.match(html, /<button type="button" class="btn mk-on" data-action="toggleWatch" data-id="coin:BTC" aria-pressed="true">[\s\S]*?Watching<\/button>/);
  // no Buy, no Sell, no Trade: this page does not sign for the Account
  for (const word of [/>Buy</, />Sell</, />Trade</, /data-action="(buy|sell|trade)/i]) assert.doesNotMatch(html, word, String(word));
  // the price now is the followed line's quote; its 24 hours and its volume the explore read's; where it is from, with its age
  assert.match(html, /<div class="mk-d-px"><span class="mk-big">\$62,510\.50<\/span><span class="up"><span aria-hidden="true">▲<\/span><span class="sr-only">up<\/span> 2\.30%<\/span><span class="mk-basis">24h<\/span><\/div>/);
  assert.match(html, /<p class="mk-asof">Stand-in Exchange · live · 1 min ago<\/p>/);
  assert.match(html, /<dl class="mk-facts"><div><dt>24h volume<\/dt><dd>\$2\.5B<\/dd><\/div><div><dt>Venues<\/dt><dd>4<\/dd><\/div><\/dl>/);
  assert.equal(html.split('Stand-in Exchange · live · 1 min ago').length - 1, 1, 'where the price is from, once: under it');
  // Price history: the Account's ranges, each naming the page, the kept one pressed — 1D until one is chosen; no read, no chart
  const history = section(html, 'Price history');
  const ranges = [...history.matchAll(/<button type="button" class="seg-item(?: pressed)?" aria-pressed="(true|false)" data-action="setRange" data-value="([^"]+)" data-id="coin:BTC">([^<]+)<\/button>/g)].map(m => [m[2], m[1], m[3]]);
  assert.deepEqual(ranges, CANDLE_RANGES.map(r => [r, String(r === '1D'), r]));
  assert.deepEqual(CANDLE_RANGES, ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX']);
  assert.doesNotMatch(history, /mk-chart|mk-note/);
  // Across venues: the connected lines first with their prices, the best one marked, Paper where so; the public listing leads to
  // Venues, where its venue is connected
  const across = linesOf(section(html, 'Across venues'));
  assert.equal(across.length, 4);
  assert.match(across[0], /<div class="mk-t1">Stand-in Exchange · BTC\/USDT · \$62,480\.00 <span class="mk-tag">Best<\/span><\/div>/);
  assert.match(across[1], /<div class="mk-t1">Stand-in Wallet · cbBTC\/USDC@Base · \$62,448\.77<\/div>/);
  assert.match(across[2], /<div class="mk-t1">Momentum · paper · BTC\/USD · \$62,480\.00 <span class="mk-tag">Paper<\/span><\/div>/);
  assert.match(across[3], /<div class="mk-t1">Stand-in Public Exchange · BTC\/USD · \$62,480\.00<\/div><\/div><a class="link mk-link" href="#\/account\/venues">Connect to trade<\/a>/);
  assert.equal(across.filter(l => l.includes('Connect to trade')).length, 1, 'only the public line');
  assert.equal(across.filter(l => l.includes('>Best<')).length, 1);
  // You here, from the asset sheet: the coin across its venues and the perpetual on it, each with what was paid; the order still
  // working, with who placed it; no agent acts here. You hold and Open orders are no more
  assert.deepEqual(linesOf(section(html, 'You here')).map(text), [
    '·0.124 BTC · $7,747.40cost known for 0 of 0.124 BTC',
    '·Stand-in Exchange · long 0.01 BTC/USDT:USDT · +$19.79avg $60,520.00 · cost known for 0.01 of 0.01 contracts',
    '·Stand-in Exchange · Sell 0.002 BTC/USDT · limit 63,226.6 · open · You',
  ]);
  assert.doesNotMatch(section(html, 'You here'), /What agents do here/);
  for (const gone of ['You hold', 'Open orders']) assert.equal(section(html, gone), '', gone);
  // On the statement: the lines that name it, newest first, in the Account's words; the Statement a click away
  const stated = section(html, 'On the statement');
  assert.match(stated, /<div class="mk-sec-head"><div class="mk-h2">On the statement<\/div><button type="button" class="link mk-link" data-action="openStatement">Open the Statement →<\/button><\/div>/);
  assert.deepEqual(linesOf(stated).map(text), [
    `·${stamp('2026-10-22T07:35:46.806Z')} · Buy 0.001 BTC · BTC / USDT · limit 59,352.9 · $0.00canceled · You`,
    `·${stamp('2026-10-22T07:35:46.798Z')} · Sell 0.002 BTC · BTC / USDT · limit 63,226.6 · $0.00open · You`,
  ]);
  // gravit on it: the conversations that name its base as a word
  const gravit = section(html, 'gravit on it');
  assert.match(gravit, /<a class="mk-line" href="#\/messages\/s1">[\s\S]*?Is BTC breaking out\?/);
  assert.doesNotMatch(gravit, /s2|cbBTC/);
  // before the Account's reads answer, nothing is claimed of what is held, working or stated: each part says Loading…
  const unread = page('coin:BTC', { account: false }).html;
  assert.match(unread, /aria-label="Across venues"/);
  for (const part of ['You here', 'On the statement']) assert.match(section(unread, part), /<p class="mk-empty">Loading…<\/p>/, part);
  assert.doesNotMatch(unread, /You don’t hold any|Nothing on the statement/);

  // a stock's page with its history: the closes for the range, the Account's own words under them; the public line is the
  // delayed feed, its paper account marked; no line held at a venue, nothing stated
  const bars = { ...fx('candles'), ends: 'Ends 16:00 New York', note: 'A stand-in: nothing here is real' };
  const nvda = page('stock:NVDA', { candles: { id: 'stock:NVDA', range: '1D', data: bars } });
  assert.match(nvda.html, /<span class="mk-sub">Stock · NVDA<\/span>/);
  assert.match(nvda.html, /<span class="mk-big">\$182\.40<\/span>/);
  assert.match(nvda.html, /<p class="mk-asof">Stand-in Broker<\/p>/);
  const chart = section(nvda.html, 'Price history');
  assert.ok(chart.includes('aria-label="Closes over 1D: from $179.16 to $179.20, low $178.50, high $179.20"'), chart);
  assert.match(chart, /<p class="mk-note">Ends 16:00 New York · A stand-in: nothing here is real<\/p><\/section>$/);
  assert.deepEqual(linesOf(section(nvda.html, 'Across venues')).map(text), [
    '·Stand-in Broker · NVDA · $182.40 Best', '·Momentum · paper · NVDA · $182.40 Paper', '·Stand-in · 15 min delayed · NVDA · $182.40',
  ]);
  assert.deepEqual(linesOf(section(nvda.html, 'You here')).map(text), ['·2 NVDA · $364.80cost known for 0 of 2 NVDA'], 'nothing working: no order line');
  // what the paper accounts hold of it is its own line, marked Paper, with the paper cost: a sheet with no real row
  const papered = page('stock:NVDA', { here: { ok: true, key: 'equity:NVDA', positions: [], orders: [], lines: [], cost: [], missing: [],
    paper: { row: { key: 'equity:NVDA', asset: 'NVDA', class: 'equity', amount: 3, usd: 547.2 }, positions: [], cost: [{ key: 'equity:NVDA', words: 'cost known for 3 of 3 NVDA' }] } } });
  assert.deepEqual(linesOf(section(papered.html, 'You here')).map(text), ['·3 NVDA · $547.20 Papercost known for 3 of 3 NVDA']);
  assert.match(section(nvda.html, 'On the statement'), /<p class="mk-empty">Nothing on the statement about it yet\.<\/p>/);
  assert.equal(section(nvda.html, 'gravit on it'), '');
  // a range chosen and still reading: Loading…, that range pressed; one answered with no closes: No history
  const reading = R.candlesLoading(R.setRange(nvda.s, { id: 'stock:NVDA', range: '5D' }), { id: 'stock:NVDA', range: '5D' });
  const loading = section(renderMarketsScreen(reading, NOW), 'Price history');
  assert.match(loading, /class="seg-item pressed" aria-pressed="true" data-action="setRange" data-value="5D" data-id="stock:NVDA">5D</);
  assert.match(loading, /<p class="mk-note">Loading…<\/p>/);
  assert.doesNotMatch(loading, /mk-chart/);
  const empty = page('stock:NVDA', { candles: { id: 'stock:NVDA', range: '1D', data: { ...bars, candles: bars.candles.slice(0, 1) } } });
  assert.match(section(empty.html, 'Price history'), /<p class="mk-note">No history<\/p>/);

  // an event's page, opened from Predictions (the read that lists it): its outcomes under its price, in cents; its category and
  // when it closes; its position, and the fill stated
  const fed = page('event:predict:SI-FEDCUT-DEC', { predictions: fx('explore-predictions'), tab: 'macro' });
  assert.match(fed.html, new RegExp(`<span class="mk-av mk-av-lg" aria-hidden="true">Econ</span><div><h1 class="head-title">Will the Fed cut rates at its December meeting\\?</h1><span class="mk-sub">Economics · closes ${fmtDate(Date.parse('2026-10-31T10:35:46.773Z'))}</span>`));
  assert.match(fed.html, /<span class="mk-big">62¢<\/span><span class="up"><span aria-hidden="true">▲<\/span><span class="sr-only">up<\/span> 4¢<\/span><span class="mk-basis">24h<\/span><\/div><div class="mk-outs"><span class="mk-out">Yes 62¢<\/span><span class="mk-out">No 38¢<\/span><\/div>/);
  assert.match(fed.html, /<dt>24h volume<\/dt><dd>\$1\.8M<\/dd>/);
  assert.deepEqual(linesOf(section(fed.html, 'Across venues')).map(text), ['·Stand-in Predictions · SI-FEDCUT-DEC:YES · 62¢ Best']);
  assert.match(section(fed.html, 'You here'), /Stand-in Predictions · long 50 SI-FEDCUT-DEC:YES · <span class="down">-\$0\.50<\/span><\/div><div class="mk-t2">avg 63¢ · cost \$31\.50 · cost known for 50 of 50 SI-FEDCUT-DEC:YES<\/div>/);
  const fill = linesOf(section(fed.html, 'On the statement'));
  assert.equal(fill.length, 1);
  assert.match(fill[0], /^<span class="mk-mark ok">✓<\/span>/);
  assert.match(text(fill[0]), /Buy 50 SI-FEDCUT-DEC:YES · Will the Fed cut rates at its December meeting\? · Yes · market · at 0\.63 · -\$31\.50filled · You$/);
  for (const word of [/>Buy</, />Sell</, />Trade</, />Buy Yes</]) assert.doesNotMatch(fed.html, word, String(word));

  // a cn page is the face's own quote and history: no venues, nothing held through the Account
  const cn = screen({ route: { screen: 'markets', id: 'cn:600519' }, cn: [MOUTAI], quotes: { 'cn:600519': moutaiQuote() }, account: true, conversations: [conv('s3', { title: '600519 into the close' })] }).html;
  assert.match(cn, /<h1 class="head-title">Kweichow Moutai<\/h1><span class="mk-sub">A-share · 600519 · SH<\/span>/);
  assert.match(cn, /<span class="mk-big">¥1,688\.00<\/span><span class="up">[\s\S]*?0\.48%<\/span><span class="mk-basis">vs previous close<\/span>/);
  assert.match(cn, /class="mk-asof">Tencent · Live</);
  assert.match(cn, /<dt>Previous close<\/dt><dd>¥1,680\.00<\/dd>/);
  assert.match(cn, /<dt>Volume<\/dt><dd>200万股<\/dd>/);
  assert.match(cn, /class="btn mk-on" data-action="toggleWatch" data-id="cn:600519" aria-pressed="true">/);
  assert.match(cn, /data-action="handToGravit" data-id="cn:600519"/);
  assert.match(section(cn, 'gravit on it'), /600519 into the close/);
  assert.doesNotMatch(cn, /Across venues|You hold|You here|Order book|Latest trades|Funding|On the statement/);
  // a key no read lists, and an old face id, are no page: the table
  assert.match(page('coin:GONE').html, /^<main class="main mkts">/);
  assert.match(page('us:AAPL').html, /^<main class="main mkts">/);
});

test('on a page that signs, a market\'s page carries Buy, and Sell where the market is held: each opens the Trade ticket', () => {
  const keys = html => html.match(/<div class="mk-d-acts">[\s\S]*?<\/div>/)?.[0] ?? '';
  const page = (id, over = {}) => screen({ route: { screen: 'markets', id }, account: true, role: 'signs', ...over }).html;
  const buy = id => `<button type="button" class="btn" data-action="openTicket" data-id="${id}" data-side="buy">Buy</button>`;
  const sell = id => `<button type="button" class="btn" data-action="openTicket" data-id="${id}" data-side="sell">Sell</button>`;
  // BTC is held: Buy and Sell before Hand to gravit and Watch
  const btc = keys(page('coin:BTC'));
  assert.ok(btc.startsWith(`<div class="mk-d-acts">${buy('coin:BTC')}${sell('coin:BTC')}<button type="button" class="btn" data-action="handToGravit"`), btc);
  // DOGE is not held: Buy alone
  const doge = keys(page('coin:DOGE'));
  assert.ok(doge.includes(buy('coin:DOGE')), doge);
  assert.doesNotMatch(doge, /data-side="sell"/);
  // a prediction held as a position
  const fed = keys(page('event:predict:SI-FEDCUT-DEC', { predictions: fx('explore-predictions'), tab: 'macro' }));
  assert.ok(fed.includes(buy('event:predict:SI-FEDCUT-DEC')) && fed.includes(sell('event:predict:SI-FEDCUT-DEC')), fed);
  // a perpetual, and a pre-IPO one, are listed, not traded from the face this round: no ticket, though spot ETH is held
  const perp = keys(page('perp:ETH'));
  assert.ok(perp.includes('data-action="handToGravit" data-id="perp:ETH"'), perp);
  assert.doesNotMatch(perp, /data-action="openTicket"/);
  const all = fx('explore-all');
  all.items.push({ key: 'preipo:SPACEX', kind: 'perp', name: 'SpaceX', price: 200, tabs: ['all', 'perps', 'preipo'], implied: { valuationUsd: 400e9 },
    at: [{ venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'SPACEX/USDT:USDT', connected: true, canTrade: true, public: false, price: 200, open: true }] });
  const preipo = page('preipo:SPACEX', { all });
  assert.match(preipo, /data-action="handToGravit" data-id="preipo:SPACEX"/);
  assert.doesNotMatch(preipo, /data-action="openTicket"/);
  // a page that does not sign, or does not know yet: neither
  for (const role of [null, 'pending', 'needs-code', 'signed-out', 'none', 'unknown']) {
    assert.doesNotMatch(page('coin:BTC', { role }), /data-action="openTicket"/, String(role));
  }
  // an A share is the face's own quote: no ticket at the Account
  const cn = screen({ route: { screen: 'markets', id: 'cn:600519' }, cn: [MOUTAI], quotes: { 'cn:600519': moutaiQuote() }, account: true, role: 'signs' }).html;
  assert.doesNotMatch(cn, /data-action="openTicket"/);
});

test('candlesSvg draws closes for a range; cents for an event', () => {
  const bars = fx('candles').candles;
  const word = t => `${fmtDate(t)} ${fmtClock(t)}`;
  const svg = candlesSvg(bars, { unit: 'usd', range: '1D' });
  assert.match(svg, /^<svg class="mk-chart" viewBox="0 0 400 140" preserveAspectRatio="none" role="img"/);
  assert.ok(svg.includes('aria-label="Closes over 1D: from $179.16 to $179.20, low $178.50, high $179.20"'), svg);
  assert.ok(svg.endsWith(`<div class="mk-axis"><span>${word(bars[0].t)}</span><span>Low $178.50 · High $179.20</span><span>${word(bars.at(-1).t)}</span></div>`));
  // an event contract's closes are dollars a contract: drawn in cents
  const contract = [{ t: bars[0].t, o: 0.6, h: 0.6, l: 0.6, c: 0.6 }, { t: bars[1].t, c: 0.58 }, { t: bars[2].t, c: 0.62 }];
  assert.ok(candlesSvg(contract, { unit: 'cents', range: '5D' }).includes('aria-label="Closes over 5D: from 60¢ to 62¢, low 58¢, high 62¢"'));
  // fewer than two closes draw nothing; a bar without a close or a time is left out
  for (const few of [[], undefined, bars.slice(0, 1), [{ t: 1, c: null }, { t: 2, c: 'n/a' }], [{ c: 5 }, { t: 'never', c: 6 }]]) {
    assert.equal(candlesSvg(few, { unit: 'usd', range: '1D' }), '', JSON.stringify(few));
  }
  // on a market's page: the Fed question's history in cents, under the range kept for it
  const read = { ok: true, venue: 'predict', venueName: 'Stand-in Predictions', symbol: 'SI-FEDCUT-DEC:YES', interval: '5m', range: '5D', candles: contract, more: false };
  const fed = screen({ route: { screen: 'markets', id: 'event:predict:SI-FEDCUT-DEC' }, predictions: fx('explore-predictions'), tab: 'macro', candles: { id: 'event:predict:SI-FEDCUT-DEC', range: '5D', data: read } }).html;
  const history = section(fed, 'Price history');
  assert.ok(history.includes('aria-label="Closes over 5D: from 60¢ to 62¢, low 58¢, high 62¢"'), history);
  assert.match(history, /class="seg-item pressed" aria-pressed="true" data-action="setRange" data-value="5D"/);
});

test('no CJK, no icon URL in any rendered string', () => {
  const ICON = 'https://logos.example-cdn.com/btc.png';
  const all = withEvents();
  for (const item of [...all.items, ...all.movers]) {
    item.icon = ICON;
    for (const l of item.at ?? []) l.icon = ICON;
    for (const o of item.outcomes ?? []) o.icon = ICON;
  }
  // and an item whose words are not words: an object for a name, a number for a base and a category
  all.items.push({ key: 'coin:ODD', kind: 'coin', name: { en: 'odd' }, base: 7, category: 9, tabs: ['all', 'crypto'], at: [] });
  const predictions = fx('explore-predictions');
  for (const item of predictions.items) item.icon = ICON;
  const candles = { ...fx('candles'), icon: ICON };
  // the face's own wire speaks Chinese in its messages and source names: none of it is drawn
  const status = { state: 'stale', said: 'Tencent answered late' };
  const base = {
    all, predictions, cn: [MOUTAI, ZED], asked: { 'us:ZZZZ': null }, quotes: { 'cn:600519': moutaiQuote({ quote_status: 'stale' }) }, status,
    connection: 'polling', account: true, watch: ['coin:BTC', 'stock:GONE'], candles: { id: 'stock:NVDA', range: '1D', data: candles },
    live: [{ venue: 'ex', symbol: 'BTC/USDT', market: { price: 62481, quoteFrom: 'Stand-in Exchange', quoteAt: ago(3_000), icon: ICON } }],
    conversations: [conv('s1', { title: 'BTC into the weekend' })],
  };
  const states = [
    screen(base), screen({ ...base, tab: 'stocks' }), screen({ ...base, tab: 'watchlist' }), screen({ ...base, tab: 'macro' }),
    screen({ ...base, sort: 'movers' }), screen({ ...base, q: 'fed', results: predictions }), screen({ ...base, watchError: 'read' }),
    ...['coin:BTC', 'stock:NVDA', 'perp:BTC', 'event:predict:SI-FEDCUT-DEC', 'kalshi:KXFED-DEC', PARIS, 'coin:ODD', 'cn:600519'].map(id => screen({ ...base, route: { screen: 'markets', id } })),
  ];
  assert.ok(states.filter(x => x.html.includes('mk-page')).length === 8, 'every page drew');
  for (const { html } of states) {
    // the A-share units the spec approved (万股, ¥…亿, ¥…万亿) are the face's own words; the wire's Chinese prose never is
    assert.doesNotMatch(html.replace(/\d(?:万亿|万股|亿股|万|亿)/g, ''), CJK);
    assert.ok(!html.includes('example-cdn'), 'no icon URL');
    assert.doesNotMatch(html, /<img\b/);
    assert.doesNotMatch(html, /NaN|undefined|\[object Object\]|>null</);
  }
});

test('empty states: Loading… before a read, Nothing here with these filters for an empty answer, the Watchlist’s hint; a refusal keeps its rows; the search line', () => {
  const unread = screen({ all: null }).html;
  assert.match(unread, /<p class="mk-empty">Loading…<\/p>/);
  assert.match(unread, /data-value="crypto" aria-pressed="true">Crypto<\/button>/, 'no count, before a read or after');
  const none = fx('explore-all');
  none.items = [];
  // on the main sources there is nothing to go back to: the sentence alone
  assert.match(screen({ all: none }).html, /<p class="mk-empty">Nothing here with these filters\.<\/p>/);
  assert.match(screen({ tab: 'watchlist' }).html, /<p class="mk-empty">Star a market under any tab to keep it here\.<\/p>/);
  // a read that failed before it ever answered says so, and the Account's sentence over that when it refused
  const crypto = R.setMarketsTab(R.nav(emptyState(), { screen: 'markets', id: null }), 'crypto');
  const query = exploreQueryOf(crypto.markets);
  const failed = R.exploreFailed(crypto, { tab: 'crypto', at: NOW, message: null, query });
  assert.match(renderMarketsScreen(failed, NOW), /<p class="mk-empty">Markets unavailable<\/p>/);
  const busy0 = R.exploreFailed(crypto, { tab: 'crypto', at: NOW, message: 'The account is busy: try again in a moment', query });
  const before = renderMarketsScreen(busy0, NOW);
  assert.match(before, /<p class="mk-note">The account is busy: try again in a moment<\/p><p class="mk-empty">Markets unavailable<\/p>/);
  // a refusal after an answer: the last rows stay, the Account's own sentence over them
  const shown = screen().s;
  const refused = R.exploreFailed(shown, { tab: 'crypto', at: NOW, message: 'The account is busy: try again in a moment', query: exploreQueryOf(shown.markets) });
  const kept = renderMarketsScreen(refused, NOW);
  assert.equal(rowIds(kept).length, 12);
  assert.match(kept, /<p class="mk-note">The account is busy: try again in a moment<\/p>/);
  // the search: its rows, how many for what, Back to the tab; the filters set aside; Searching… until anything answers
  const found = screen({ q: 'fed', results: fx('explore-predictions') }).html;
  assert.match(found, /<p class="mk-q">9 markets for “fed” <button type="button" class="mk-clear" data-action="mkBack">Back to Crypto<\/button><\/p>/);
  assert.doesNotMatch(found, /mk-filters|mk-pill/);
  assert.match(found, /id="mq" type="search" autocomplete="off" placeholder="Search markets" data-action="mkQuery" value="fed"/);
  assert.match(screen({ q: 'zz' }).html, /<p class="mk-empty">Searching…<\/p>/);
  const nothing = { ...fx('explore-predictions'), items: [] };
  const missed = screen({ q: 'zz', results: nothing }).html;
  assert.match(missed, /<p class="mk-q">0 markets for “zz”/);
  assert.match(missed, /<p class="mk-empty">No markets<\/p>/);
  const one = { ...fx('explore-predictions'), items: fx('explore-predictions').items.slice(0, 1) };
  assert.match(screen({ q: 'cut', results: one }).html, /<p class="mk-q">1 market for “cut”/);
  // the search refused before it answered: the Account's sentence, and the search said unavailable
  const busy = R.resultsFailed(screen({ q: 'zz' }).s, { at: NOW, message: 'Too many searches: wait a moment' });
  const said = renderMarketsScreen(busy, NOW);
  assert.match(said, /<p class="mk-note">Too many searches: wait a moment<\/p>/);
  assert.match(said, /<p class="mk-empty">Search is unavailable<\/p>/);
});

test("while searching, an answer without China's hits says the search is unavailable for them, over the Account's hits", () => {
  const missed = { ...fx('explore-predictions'), missing: [{ venue: 'china', venueName: 'Tencent', connected: false, why: 'no answer in time', code: 'E_ACCOUNT_BAD_ACTION' }] };
  const failed = screen({ q: 'fed', results: missed }).html;
  assert.match(failed, /<p class="mk-note">Search is unavailable<\/p>/);
  assert.equal(rowIds(failed).length, 9, "the Account's hits drawn under it");
  assert.doesNotMatch(failed, /no answer in time/, "the Account's reason is not the face's line");
  // China answered: its hits are cn rows, priced as the search carries them, and nothing is said
  const hit = { ...fx('explore-search-china') };
  const found = screen({ q: 'mao', results: hit }).html;
  assert.doesNotMatch(found, /mk-note/);
  assert.ok(rowIds(found).includes('cn:600519'));
  assert.match(rowOf(found, 'cn:600519'), /<span class="mk-sub"><span class="mk-tag">Stocks<\/span> 600519 · SH<\/span>/, 'drawn as an A share, not as an Account row, named by its class');
  // another venue missing is not China's
  assert.doesNotMatch(screen({ q: 'fed', results: { ...missed, missing: [{ venue: 'okx' }] } }).html, /Search is unavailable/);
  // the whole search failed: said once, where the rows would be
  const html = renderMarketsScreen(R.resultsFailed(screen({ q: 'zz' }).s, { at: NOW, message: null }), NOW);
  assert.equal(html.split('Search is unavailable').length - 1, 1);
  assert.match(html, /<p class="mk-empty">Search is unavailable<\/p>/);
});

test("each part of a market's page stands on its own read: Loading… until it answers, its empty words only after an answer, its failure said", () => {
  const bare = screen({ route: { screen: 'markets', id: 'coin:BTC' } }).s;
  const draw = s => renderMarketsScreen(s, NOW);
  const here = (s, data) => R.depthLoaded(s, { id: 'coin:BTC', part: 'here', data, at: NOW });
  // You here is the asset sheet's: Loading… until it answers, whatever else has — the page, the holdings
  const paged = R.paperLoaded(R.holdingsLoaded(R.accountLoaded(bare, { data: fx('account'), at: NOW }), { data: fx('holdings'), at: NOW }), { data: fx('holdings-paper'), at: NOW });
  const pagedHtml = draw(paged);
  assert.match(section(pagedHtml, 'You here'), /<p class="mk-empty">Loading…<\/p>/);
  assert.match(section(pagedHtml, 'On the statement'), /<p class="mk-empty">Loading…<\/p>/);
  assert.doesNotMatch(pagedHtml, /You don’t hold any|Nothing on the statement/);
  const sheeted = here(paged, fx('asset-btc'));
  assert.equal(linesOf(section(draw(sheeted), 'You here')).length, 3);
  // the statement read: the lines that name it; one that names nothing of it, the empty words
  const stated = R.statementLoaded(sheeted, { data: fx('statement'), at: NOW });
  assert.equal(linesOf(section(draw(stated), 'On the statement')).length, 2);
  assert.match(section(draw(R.statementLoaded(sheeted, { data: { ok: true, lines: [] }, at: NOW })), 'On the statement'), /<p class="mk-empty">Nothing on the statement about it yet\.<\/p>/);
  // the sheet answered holding nothing of it: the empty words
  const nothing = here(paged, { ok: true, key: 'crypto:BTC', positions: [], orders: [], lines: [], cost: [], missing: [] });
  assert.match(section(draw(nothing), 'You here'), /<p class="mk-empty">You don’t hold any\.<\/p>/);
  // the venues the sheet could not read, said over what it read
  const missed = here(paged, { ...fx('asset-btc'), missing: [{ venue: 'wallet', venueName: 'Stand-in Wallet', why: 'no answer' }] });
  assert.match(section(draw(missed), 'You here'), /<div class="mk-h2">You here<\/div><p class="mk-note">Stand-in Wallet did not answer<\/p><div class="mk-feed">/);
  // a read that failed before it answered says so, with the Account's sentence where the read keeps one
  assert.match(section(draw(R.statementFailed(sheeted, { at: NOW })), 'On the statement'), /<p class="mk-empty">Statement unavailable<\/p>/);
  const failed = m => R.depthFailed(paged, { id: 'coin:BTC', part: 'here', at: NOW, message: m });
  assert.match(section(draw(failed(null)), 'You here'), /<div class="mk-h2">You here<\/div><p class="mk-empty">Account unavailable<\/p><\/section>/);
  assert.match(section(draw(failed('Venues are still settling.')), 'You here'), /<p class="mk-note">Venues are still settling\.<\/p><p class="mk-empty">Account unavailable<\/p>/);
  assert.match(section(draw(R.statementFailed(sheeted, { at: NOW, message: 'The statement is being rebuilt.' })), 'On the statement'),
    /<p class="mk-note">The statement is being rebuilt\.<\/p><p class="mk-empty">Statement unavailable<\/p>/);
  assert.match(section(draw(R.statementFailed(stated, { at: NOW, message: 'The statement is being rebuilt.' })), 'On the statement'),
    /<p class="mk-note">The statement is being rebuilt\.<\/p><div class="mk-feed">/, 'over the lines kept');
  // a failure after an answer keeps what was read, with the sentence over it
  const kept = draw(R.depthFailed(stated, { id: 'coin:BTC', part: 'here', at: NOW, message: 'The account is restarting' }));
  assert.match(section(kept, 'You here'), /<p class="mk-note">The account is restarting<\/p><div class="mk-feed">[\s\S]*Sell 0\.002 BTC\/USDT/);
  // a kept answer the proxy re-served: As of the last fresh answer
  const staleHtml = draw(R.depthLoaded(sheeted, { id: 'coin:BTC', part: 'here', data: { ...fx('asset-btc'), stale: true }, at: NOW + 60_000 }));
  assert.match(section(staleHtml, 'You here'), new RegExp(`<p class="mk-note">As of ${fmtClock(NOW)}</p><div class="mk-feed">`));
  // a market the asset read names nothing for (an event no connected venue lists) holds nothing here, never Loading…
  const paris = screen({ route: { screen: 'markets', id: PARIS }, all: withEvents(), here: null }).html;
  assert.match(section(paris, 'You here'), /<p class="mk-empty">You don’t hold any\.<\/p>/);
});

test("a failed history read says so under the range seg — the Account's sentence, else History unavailable — and the closes kept for the range stay", () => {
  const nvda = screen({ route: { screen: 'markets', id: 'stock:NVDA' }, candles: { id: 'stock:NVDA', range: '1D', data: fx('candles') } }).s;
  const history = s => section(renderMarketsScreen(s, NOW), 'Price history');
  // a range not drawn yet, refused in the Account's words: its sentence right under the seg, and no chart
  const asked = R.candlesLoading(R.setRange(nvda, { id: 'stock:NVDA', range: '5Y' }), { id: 'stock:NVDA', range: '5Y' });
  const refused = history(R.candlesFailed(asked, { id: 'stock:NVDA', range: '5Y', at: NOW, message: 'No history at this range.' }));
  assert.match(refused, /data-value="MAX" data-id="stock:NVDA">MAX<\/button><\/div><\/div><p class="mk-note">No history at this range\.<\/p><\/section>$/);
  assert.doesNotMatch(refused, /mk-chart/);
  // the proxy unreachable, no sentence: History unavailable
  assert.match(history(R.candlesFailed(R.setRange(nvda, { id: 'stock:NVDA', range: '1Y' }), { id: 'stock:NVDA', range: '1Y', at: NOW })), /<p class="mk-note">History unavailable<\/p><\/section>$/);
  // the range's own closes read again and refused: the sentence over the closes kept
  assert.match(history(R.candlesFailed(nvda, { id: 'stock:NVDA', range: '1D', at: NOW, message: 'The venue did not answer' })), /<p class="mk-note">The venue did not answer<\/p><svg class="mk-chart"/);
  // and while the range's own closes are read again, they stay drawn
  const again = history(R.candlesLoading(nvda, { id: 'stock:NVDA', range: '1D' }));
  assert.match(again, /<svg class="mk-chart"/);
  assert.doesNotMatch(again, /Loading…/);
});

test("an event's page finds the conversations that name it by its name, as Hand to gravit names it", () => {
  const fed = 'Will the Fed cut rates at its December meeting?';
  const html = screen({
    route: { screen: 'markets', id: 'event:predict:SI-FEDCUT-DEC' }, predictions: fx('explore-predictions'), tab: 'macro',
    conversations: [conv('s1', { title: `${fed} The odds into the meeting` }), conv('s2', { title: 'SI-FEDCUT-DEC sizing' })],
  }).html;
  const gravit = section(html, 'gravit on it');
  assert.match(gravit, /<a class="mk-line" href="#\/messages\/s1">/);
  assert.doesNotMatch(gravit, /s2/);
});

test('a kept sort the rows no longer offer gives way to Most traded: the seg presses it and the rows follow it', () => {
  // Closing soonest kept on the Watchlist, whose two rows close never: LINK starred first, NVDA traded most
  const watching = R.setMarketsTab(screen({ watch: ['coin:LINK', 'stock:NVDA'] }).s, 'watchlist');
  const kept = R.setMarketsSort(watching, 'closing');
  assert.equal(kept.markets.sort, 'closing', 'the slice keeps the choice');
  const html = renderMarketsScreen(kept, NOW);
  assert.match(html, /<button type="button" class="seg-item pressed" aria-pressed="true" data-action="mkSort" data-value="volume">Most traded<\/button>/);
  assert.doesNotMatch(html, /data-value="closing"/);
  assert.deepEqual(rowIds(html), ['stock:NVDA', 'coin:LINK']);
});

test("the Account's sentence comes from the read the rows are from, and a read for other filters is never drawn", () => {
  const main = screen().s;
  const refused = R.exploreFailed(main, { tab: 'crypto', at: NOW, message: 'Main refused', query: exploreQueryOf(main.markets) });
  const said = renderMarketsScreen(refused, NOW);
  assert.match(said, /<p class="mk-note">Main refused<\/p>/);
  assert.equal(rowIds(said).length, 12, 'its rows kept under it');
  // All sources picked: the read kept is Main's, for another query: Loading…, none of its rows, none of its words
  const all = R.setMarketsSource(refused, 'all');
  const html = renderMarketsScreen(all, NOW);
  assert.deepEqual(rowIds(html), []);
  assert.match(html, /<p class="mk-empty">Loading…<\/p>/);
  assert.doesNotMatch(html, /Main refused/);
  // its own read answers: its rows, and nothing said over them
  const coins = { ...fx('explore-all'), items: fx('explore-all').items.filter(i => i.kind === 'coin') };
  const landed = renderMarketsScreen(R.exploreLoaded(all, { tab: 'crypto', data: coins, at: NOW, query: exploreQueryOf(all.markets) }), NOW);
  assert.deepEqual(rowIds(landed), ['coin:BTC', 'coin:ETH', 'coin:DOGE', 'coin:SOL', 'coin:LINK']);
  assert.doesNotMatch(landed, /mk-note/);
});

test("the Account's words are text, never markup: a name, a venue, a category, a sentence and a note with tags in them", () => {
  const all = fx('explore-all');
  const btc = itemOf(all, 'coin:BTC');
  btc.name = '<i>BTC</i> & "co"';
  btc.at[0].venueName = '<b>Stand-in</b> Exchange';
  all.items.push({ ...paris(), category: '<script>x</script>' });
  const candles = { id: 'coin:BTC', range: '1D', data: { ...fx('candles'), note: '<img src=x onerror=alert(1)>' } };
  const table = screen({ all, candles });
  const refused = renderMarketsScreen(R.exploreFailed(table.s, { tab: 'crypto', at: NOW, message: '<u>busy</u> & "later"', query: exploreQueryOf(table.s.markets) }), NOW);
  const page = screen({ all, candles, route: { screen: 'markets', id: 'coin:BTC' } }).html;
  for (const html of [table.html, refused, page]) {
    for (const raw of ['<i>BTC</i>', '<b>Stand-in</b>', '<script', '<img', '<u>busy</u>', '"co"', '"later"']) assert.ok(!html.includes(raw), raw);
  }
  assert.ok(table.html.includes('<b>&lt;i&gt;BTC&lt;/i&gt; &amp; &quot;co&quot;</b>'));
  assert.ok(table.html.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(refused.includes('<p class="mk-note">&lt;u&gt;busy&lt;/u&gt; &amp; &quot;later&quot;</p>'));
  assert.ok(page.includes('&lt;b&gt;Stand-in&lt;/b&gt; Exchange · BTC/USDT'));
  assert.ok(page.includes('<p class="mk-note">&lt;img src=x onerror=alert(1)&gt;</p>'));
});

// ── Markets by underlying (spec 2026-11-19 G1–G8, §5.3): the tab row, the filters and their popovers, the chips, the empty
// states, the search ──

const pillsOf = html => [...html.matchAll(/data-action="mkFilter" data-value="([^"]+)" aria-expanded="(true|false)" aria-haspopup="listbox"><span class="mk-pill-k">([^<]+)<\/span><span class="mk-pill-v">([^<]*)<\/span>/g)].map(m => [m[1], m[3], m[4]]);
const optionsOf = html => [...html.matchAll(/<button type="button" role="option" class="mk-opt" data-action="([^"]+)" data-value="([^"]*)" aria-selected="(true|false)"( disabled)?><span>([^<]+)<\/span>(?:<span class="mk-opt-note">([^<]+)<\/span>)?<\/button>/g)]
  .map(m => ({ action: m[1], id: m[2], selected: m[3] === 'true', disabled: Boolean(m[4]), label: m[5], note: m[6] ?? null }));
const chipsOf = html => [...html.matchAll(/<button type="button" class="mk-chip" data-action="mkChip" data-value="([^"]+)" aria-label="([^"]+)"><span>([^<]+)<\/span>/g)].map(m => [m[1], m[2], m[3]]);
const open = (s, name) => R.openMarketsFilter(s, name);

test("a search closes an open filter's popover, so Back to <tab> finds it closed", () => {
  const s = open(screen().s, 'source');
  assert.equal(s.markets.open, 'source');
  const searching = R.setMarketsQuery(s, 'BTC');
  assert.equal(searching.markets.open, null, 'the search closes it');
  assert.equal(R.setMarketsQuery(searching, '').markets.open, null, 'and it stays closed after the search');
  // a blank query (no search) leaves an open popover as it was
  assert.equal(R.setMarketsQuery(s, '  ').markets.open, 'source');
});

test('the tab row: the star first with its word for a screen reader, then the seven classes, no counts', () => {
  const html = screen({ tab: 'watchlist' }).html;
  const row = html.match(/<div class="mk-tabs" role="group" aria-label="Markets">([\s\S]*?)<\/div>/)[1];
  const tabs = [...row.matchAll(/data-value="([^"]+)" aria-pressed="(true|false)"/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(tabs, [['watchlist', 'true'], ['crypto', 'false'], ['stocks', 'false'], ['indices', 'false'], ['commodities', 'false'], ['fx', 'false'], ['preipo', 'false'], ['macro', 'false']]);
  // the star: its icon and its word for a screen reader alone, no word on screen
  assert.match(row, /^<button type="button" class="mk-tab mk-tab-star" data-action="mkTab" data-value="watchlist" aria-pressed="true" title="Watchlist"><svg [^>]*>[\s\S]*?<\/svg><span class="sr-only">Watchlist<\/span><\/button>/);
  const words = [...row.matchAll(/class="mk-tab" data-action="mkTab" data-value="[^"]+" aria-pressed="(?:true|false)">([^<]+)<\/button>/g)].map(m => m[1]);
  assert.deepEqual(words, ['Crypto', 'Stocks', 'Indices', 'Commodities', 'FX', 'Pre-IPO', 'Macro &amp; events']);
  assert.doesNotMatch(text(row), /\d/, 'no count after a name');
  // another tab open: the star not pressed (the CSS fills it while pressed)
  assert.match(screen().html, /class="mk-tab mk-tab-star" data-action="mkTab" data-value="watchlist" aria-pressed="false"/);
});

test('Stocks draws Region, Form and Source; Crypto draws Form and Source; the Watchlist none', () => {
  assert.deepEqual(pillsOf(screen({ tab: 'stocks' }).html), [['region', 'Region', 'US'], ['form', 'Form', 'All'], ['source', 'Source', 'Main · cboe']]);
  assert.deepEqual(pillsOf(screen({ tab: 'indices' }).html).map(p => p[0]), ['region', 'form', 'source']);
  assert.deepEqual(pillsOf(screen().html), [['form', 'Form', 'All'], ['source', 'Source', 'Main · hyperliquid']]);
  assert.deepEqual(pillsOf(screen({ tab: 'macro' }).html), [['form', 'Form', 'All'], ['source', 'Source', 'Main · kalshi + polymarket']]);
  const list = screen({ tab: 'watchlist', watch: ['coin:BTC', 'stock:NVDA'] }).html;
  assert.deepEqual(pillsOf(list), []);
  assert.doesNotMatch(list, /mk-filters|mk-chip/);
  assert.match(list, /data-action="mkSort" data-value="volume"/, 'the sort stays');
  assert.doesNotMatch(list, /data-value="closing"/);
  // the sources' names from the registry's read, once it answered
  const named = R.marketSourcesLoaded(screen().s, { data: { ok: true, value: [{ id: 'hyperliquid', name: 'Hyperliquid' }] }, at: NOW });
  assert.deepEqual(pillsOf(renderMarketsScreen(named, NOW))[1], ['source', 'Source', 'Main · Hyperliquid']);
});

test('a popover lists its options, the greyed ones disabled with their note', () => {
  const stocks = screen({ tab: 'stocks' }).s;
  assert.doesNotMatch(renderMarketsScreen(stocks, NOW), /mk-pop/, 'closed until its pill is pressed');
  const region = renderMarketsScreen(open(stocks, 'region'), NOW);
  assert.match(region, /data-action="mkFilter" data-value="region" aria-expanded="true" aria-haspopup="listbox">/);
  assert.match(region, /<div class="mk-pop" role="listbox" aria-label="Region">/);
  assert.deepEqual(optionsOf(region).map(o => [o.id, o.label, o.selected, o.disabled, o.note]), [
    ['us', 'US', true, false, null], ['cn', 'China A', false, false, null], ['hk', 'Hong Kong', false, false, null], ['jp', 'Japan', false, false, null],
    ['kr', 'Korea', false, false, null], ['tw', 'Taiwan', false, false, null], ['in', 'India', false, false, null], ['eu', 'Europe', false, true, 'no source for European shares'],
  ]);
  assert.ok(optionsOf(region).every(o => o.action === 'mkRegion'));
  // Form on Macro: every form but Event contract none here, Options none here, perp in its word
  const form = optionsOf(renderMarketsScreen(open(screen({ tab: 'macro' }).s, 'form'), NOW));
  assert.deepEqual(form.map(o => [o.action, o.id, o.label, o.selected, o.disabled, o.note]), [
    ['mkForm', '', 'All', true, false, null], ['mkForm', 'spot', 'Spot &amp; shares', false, true, 'none here'], ['mkForm', 'perp', 'Perp', false, true, 'none here'],
    ['mkForm', 'token', 'Tokenized', false, true, 'none here'], ['mkForm', 'event', 'Event contract', false, false, null], ['mkForm', 'option', 'Options', false, true, 'none here'],
  ]);
  // Source on Crypto: Main, All sources, then each source, the main one marked main
  const source = optionsOf(renderMarketsScreen(open(screen().s, 'source'), NOW));
  assert.deepEqual(source.slice(0, 4).map(o => [o.action, o.id, o.label, o.selected, o.note]), [
    ['mkSource', 'main', 'Main · hyperliquid', true, null], ['mkSource', 'all', 'All sources', false, null],
    ['mkSource', 'hyperliquid', 'hyperliquid', false, 'main'], ['mkSource', 'coinbase', 'coinbase', false, null],
  ]);
  assert.ok(source.every(o => !o.disabled));
  // one popover at a time
  assert.equal((renderMarketsScreen(open(open(stocks, 'region'), 'form'), NOW).match(/class="mk-pop"/g) ?? []).length, 1);
});

test('Form and a non-main Source draw a removable chip; Main draws none', () => {
  assert.deepEqual(chipsOf(screen().html), [], 'Main and every Form: no chip');
  const perp = R.setMarketsForm(screen().s, 'perp');
  const html = renderMarketsScreen(perp, NOW);
  assert.deepEqual(chipsOf(html), [['form', 'Remove Perp', 'Perp']]);
  assert.match(html, /<button type="button" class="mk-pill mk-pill-set" data-action="mkFilter" data-value="form"/);
  // a form the main sources lack: Source goes to All sources, a chip each
  const spot = renderMarketsScreen(R.setMarketsForm(screen().s, 'spot'), NOW);
  assert.deepEqual(chipsOf(spot), [['form', 'Remove Spot &amp; shares', 'Spot &amp; shares'], ['source', 'Remove All sources', 'All sources']]);
  assert.deepEqual(chipsOf(renderMarketsScreen(R.setMarketsSource(screen().s, 'coinbase'), NOW)), [['source', 'Remove coinbase', 'coinbase']]);
  // Region is never a chip
  assert.deepEqual(chipsOf(renderMarketsScreen(R.setMarketsRegion(screen({ tab: 'stocks' }).s, 'cn'), NOW)), []);
});

test('an empty filtered tab says so with Back to the main sources', () => {
  const none = { ...fx('explore-all'), items: [] };
  let s = R.setMarketsForm(screen({ all: none }).s, 'perp');
  s = R.exploreLoaded(s, { tab: 'crypto', data: none, at: NOW, query: exploreQueryOf(s.markets) });
  const html = renderMarketsScreen(s, NOW);
  assert.match(html, /<p class="mk-empty">Nothing here with these filters\. <button type="button" class="mk-clear" data-action="mkMain">Back to the main sources<\/button><\/p>/);
  assert.deepEqual(rowIds(html), []);
  // still asked: Loading…, not the empty state
  assert.match(renderMarketsScreen(R.setMarketsSource(s, 'all'), NOW), /<p class="mk-empty">Loading…<\/p>/);
});

test("a search sets the filters aside, names each result's class and offers Back to <tab>", () => {
  const nvda = itemOf(fx('explore-all'), 'stock:NVDA');
  const results = { ...fx('explore-all'), items: [{ ...nvda, asset: 'stocks', form: 'spot', region: 'us' }, { ...itemOf(fx('explore-all'), 'perp:BTC'), asset: 'crypto', form: 'perp', region: null },
    { ...itemOf(fx('explore-predictions'), 'event:predict:SI-FEDCUT-DEC'), asset: 'macro', form: 'event', region: null },
    { ...itemOf(fx('explore-all'), 'coin:LINK'), asset: null, form: 'perp', region: null }] };
  const { s, html } = screen({ tab: 'stocks', q: 'x', results });
  assert.equal(s.markets.tab, 'stocks', 'the tab kept for Back to');
  assert.doesNotMatch(html, /mk-filters|mk-pill|mk-chip/);
  assert.match(html, /<p class="mk-q">4 markets for “x” <button type="button" class="mk-clear" data-action="mkBack">Back to Stocks<\/button><\/p>/);
  assert.match(rowOf(html, 'stock:NVDA'), /<span class="mk-sub"><span class="mk-tag">Stocks<\/span> /);
  assert.match(rowOf(html, 'perp:BTC'), /<span class="mk-sub"><span class="mk-tag">Crypto<\/span> /);
  assert.match(rowOf(html, 'event:predict:SI-FEDCUT-DEC'), /<span class="mk-sub"><span class="mk-tag">Macro &amp; events<\/span> /);
  assert.match(rowOf(html, 'coin:LINK'), /<span class="mk-sub"><span class="mk-tag">Perp<\/span> /, 'no class: its form');
  assert.match(html, /class="mk-star"/, 'a result keeps its star');
  assert.match(screen({ tab: 'watchlist', q: 'x', results }).html, /data-action="mkBack">Back to Watchlist</);
});

test('the Watchlist draws no star column', () => {
  const html = screen({ tab: 'watchlist', watch: ['coin:BTC', 'stock:NVDA'] }).html;
  assert.deepEqual(rowIds(html), ['stock:NVDA', 'coin:BTC']);
  assert.doesNotMatch(html, /class="mk-star"|<span class="sr-only">Watch<\/span>/);
  assert.match(html, /<thead><tr><th scope="col" class="mk-c-name">Market<\/th>/);
  assert.equal(cells(rowOf(html, 'coin:BTC')).length, 5);
  // under a tab the column is there
  assert.match(screen().html, /<thead><tr><th scope="col"><span class="sr-only">Watch<\/span><\/th>/);
});

test('a perp row reads Perp', () => {
  const btc = { ...itemOf(fx('explore-all'), 'perp:BTC'), name: 'BTC perp' };
  const html = screen({ all: { ...fx('explore-all'), items: [btc] } }).html;
  assert.match(rowOf(html, 'perp:BTC'), /<b>BTC perp<\/b><span class="mk-sub">BTC · Perp<\/span>/);
  assert.doesNotMatch(html, /[Pp]erpetual/);
});

test('a market route keeps an Account key whole and canonicalises a face id', () => {
  const nav = id => R.nav(emptyState(), { screen: 'markets', id }).route;
  assert.deepEqual(nav('event:predict:SI-FEDCUT-DEC'), { screen: 'markets', id: 'event:predict:SI-FEDCUT-DEC' });
  assert.deepEqual(nav('coin:BTC'), { screen: 'markets', id: 'coin:BTC' });
  assert.deepEqual(nav('us:aapl'), { screen: 'markets', id: 'us:AAPL' });
  assert.deepEqual(nav('crypto:btc-usd'), { screen: 'markets', id: 'crypto:BTC/USD' });
  assert.deepEqual(nav('garbage'), { screen: 'markets', id: null });
});

// ── Stocks › China A and the A-share page (spec 2026-10-31; 2026-11-19 G2) ──

const RANK = { ok: true, sort: 'volume', total: 5577, asOf: '2026-10-31T06:46:10Z', session: { phase: 'closed', lastSession: '2026-10-30' }, items: [
  { id: 'cn:300502', symbol: '300502', name: '新易盛', price: 196, change_pct: -14.19, turnover: 21_607_600_000 },
  { id: 'cn:688825', symbol: '688825', name: '长鑫科技', price: 41.8, change_pct: -2.5, turnover: 12_145_020_000 }] };
function chinaScreen(rank = s => R.rankLoaded(s, { sort: 'volume', data: RANK, at: NOW })) {
  const s = rank(R.setMarketsRegion(R.setMarketsTab(screen().s, 'stocks'), 'cn'));
  return { s, html: renderMarketsScreen(s, NOW) };
}

test("the China table: Today and Turnover in its header, a row's cells, the closed line", () => {
  const { html } = chinaScreen();
  assert.match(html, /data-value="stocks" aria-pressed="true">Stocks</);
  assert.match(html, /data-value="region" aria-expanded="false" aria-haspopup="listbox"><span class="mk-pill-k">Region<\/span><span class="mk-pill-v">China A<\/span>/);
  assert.match(html, /<th scope="col" class="r mk-c-chg">Today<\/th>/);
  assert.match(html, /<th scope="col" class="r mk-c-vol">Turnover<\/th>/);
  assert.match(html, /<p class="mk-note">Closed · 10-30 15:00 Beijing<\/p>/);
  assert.deepEqual(rowIds(html), ['cn:300502', 'cn:688825']);
  const [, name, px, move, turnover, source] = cells(rowOf(html, 'cn:300502'));
  assert.match(name, /<span class="mk-av" aria-hidden="true">新<\/span><span class="mk-nm"><b>新易盛<\/b><span class="mk-sub">300502 · ChiNext<\/span>/);
  assert.equal(px, '¥196.00');
  assert.equal(text(move), '▼down 14.19%');
  assert.equal(turnover, '¥216.08亿');
  assert.equal(text(source), 'Tencent');
  assert.doesNotMatch(html, /Stale|New York|Closing soonest/);
});

test('the Account tabs keep 24h and Volume', () => {
  assert.match(screen().html, /<th scope="col" class="r mk-c-chg">24h<\/th><th scope="col" class="r mk-c-vol">Volume<\/th>/);
});

test('China failing: Loading… before any answer, unavailable after a failure, the kept rows under a note', () => {
  assert.match(chinaScreen(s => R.rankLoading(s, { sort: 'volume' })).html, /<p class="mk-empty">Loading…<\/p>/);
  assert.match(chinaScreen(s => R.rankFailed(s, { sort: 'volume', at: NOW })).html, /<p class="mk-empty">China unavailable<\/p>/);
  const kept = chinaScreen(s => R.rankFailed(R.rankLoaded(s, { sort: 'volume', data: RANK, at: NOW }), { sort: 'volume', at: NOW })).html;
  assert.deepEqual(rowIds(kept), ['cn:300502', 'cn:688825']);
  assert.match(kept, /<p class="mk-note">Couldn’t refresh China<\/p>/);
});

test('China as last read: the market not answering is said over the kept rows; a stale read of its own in its words', () => {
  // the proxy re-served the kept ranking flagged stale: the market is not answering, and the rows are never drawn bare
  const asLast = chinaScreen(s => R.rankLoaded(s, { sort: 'volume', data: { ...RANK, stale: true, status: { state: 'live', said: '' } }, at: NOW })).html;
  assert.deepEqual(rowIds(asLast), ['cn:300502', 'cn:688825']);
  assert.match(asLast, /<p class="mk-note">Closed · 10-30 15:00 Beijing<\/p><p class="mk-note">The market is not answering · China as last read<\/p>/);
  // the Account answering that Tencent's ranking is stale: its own words, not the face's
  const said = chinaScreen(s => R.rankLoaded(s, { sort: 'volume', data: { ...RANK, stale: true, status: { state: 'stale', said: 'Tencent has not answered since 14:52' } }, at: NOW })).html;
  assert.match(said, /<p class="mk-note">Tencent has not answered since 14:52<\/p>/);
  assert.doesNotMatch(said, /The market is not answering/);
  // a live read says neither
  assert.doesNotMatch(chinaScreen(s => R.rankLoaded(s, { sort: 'volume', data: { ...RANK, stale: false, status: { state: 'live', said: '' } }, at: NOW })).html, /not answering|Couldn’t refresh/);
});

test('an A-share page reached cold draws as an A share, with no Account read', () => {
  const html = screen({ route: { screen: 'markets', id: 'cn:600519' }, all: null }).html;
  assert.equal(marketPage('cn:600519', screen({ route: { screen: 'markets', id: 'cn:600519' }, all: null }).s, NOW), html);
  assert.match(html, /<h1 class="head-title">600519<\/h1><span class="mk-sub">A-share · 600519 · SH<\/span>/);
  assert.match(html, /aria-label="Price history"/);
  assert.doesNotMatch(html, /openTicket|You hold|Across venues/);
});

const MOUTAI_FACTS = { open: 1363, high: 1393.37, low: 1352.98, turnover: 8_257_380_000, turnover_rate: 0.48, market_cap: 1_740_176_000_000, pe_ttm: 21.18,
  limit_up: 1489.4, limit_down: 1218.6, amplitude: 2.98 };
const cnPage = (quote, candles = null) => screen({ route: { screen: 'markets', id: 'cn:600519' }, cn: [MOUTAI], quotes: { 'cn:600519': quote }, candles }).html;

test("the A-share page: its state line, the twelve facts, Moutai's words", () => {
  const html = cnPage(moutaiQuote({ price: 1392.05, prev_close: 1354, volume: 5_992_700, market_status: 'closed', quote_status: 'live', as_of: '2026-10-30T16:14:55+08:00', ...MOUTAI_FACTS }));
  assert.match(html, /class="mk-asof">Tencent · Closed · 10-30 15:00 Beijing</);
  assert.match(html, /<span class="mk-av mk-av-lg" aria-hidden="true">K<\/span>/);
  const facts = [...html.matchAll(/<dt>([^<]+)<\/dt><dd>([^<]+)<\/dd>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(facts, [['Previous close', '¥1,354.00'], ['Open', '¥1,363.00'], ['High', '¥1,393.37'], ['Low', '¥1,352.98'], ['Turnover', '¥82.57亿'],
    ['Turnover rate', '0.48%'], ['Market cap', '¥1.74万亿'], ['P/E (TTM)', '21.18'], ['Limit up', '¥1,489.40'], ['Limit down', '¥1,218.60'], ['Volume', '599万股'], ['Amplitude', '2.98%']]);
  assert.match(cnPage(moutaiQuote({ pe_ttm: -12.5 })), /<dt>P\/E \(TTM\)<\/dt><dd>−12\.50<\/dd>/);
  assert.match(cnPage(moutaiQuote({ open: null })), /<dt>Open<\/dt><dd>—<\/dd>/);
  assert.doesNotMatch(html, /Stale|New York|openTicket/);
});

test("the A-share page's price history: 1D the session chart, 5D the sessions chart, 1M yuan closes on Beijing dates", () => {
  const session = (date, n = 242) => ({ date, prec: 1354, price: Array.from({ length: n }, (_, i) => 1354 + (i % 7)), amount: Array.from({ length: n }, () => 1e6) });
  const one = cnPage(moutaiQuote(), { id: 'cn:600519', range: '1D', data: { ok: true, range: '1D', sessions: [session('2026-10-30')] } });
  assert.match(section(one, 'Price history'), /class="lh-chart"/);
  assert.match(section(one, 'Price history'), /data-action="setRange" data-value="1D"[^>]*data-id="cn:600519"|data-id="cn:600519"[^>]*data-action="setRange"/);
  const r = R.setRange(screen({ route: { screen: 'markets', id: 'cn:600519' }, cn: [MOUTAI] }).s, { id: 'cn:600519', range: '5D' });
  const five = renderMarketsScreen(R.candlesLoaded(r, { id: 'cn:600519', range: '5D', at: NOW,
    data: { ok: true, range: '5D', sessions: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map(d => session(d)) } }), NOW);
  assert.equal((section(five, 'Price history').match(/class="mk-chart-sep"/g) ?? []).length, 4);
  const single = renderMarketsScreen(R.candlesLoaded(r, { id: 'cn:600519', range: '5D', at: NOW, data: { ok: true, range: '5D', sessions: [session('2026-10-30', 3)] } }), NOW);
  assert.match(section(single, 'Price history'), /class="mk-chart"/, 'a share listed this week still draws');
  const m1 = R.setRange(screen({ route: { screen: 'markets', id: 'cn:600519' }, cn: [MOUTAI] }).s, { id: 'cn:600519', range: '1M' });
  const month = renderMarketsScreen(R.candlesLoaded(m1, { id: 'cn:600519', range: '1M', at: NOW,
    data: { ok: true, range: '1M', candles: [{ t: Date.parse('2026-10-29T07:00:00Z'), c: 1354 }, { t: Date.parse('2026-10-30T07:00:00Z'), c: 1392.05 }] } }), NOW);
  assert.match(section(month, 'Price history'), /class="mk-chart"[\s\S]*<span>2026-10-30<\/span>/);
});

test('a ranking 503 draws one note, not the route words under it (minor #2)', () => {
  const html = chinaScreen(s => R.rankFailed(R.rankLoaded(s, { sort: 'volume', data: RANK, at: NOW }), { sort: 'volume', at: NOW, message: 'ranking unavailable' })).html;
  assert.match(html, /Couldn’t refresh China/);
  assert.doesNotMatch(html, /ranking unavailable/);
});

test("a failed read right after a sort switch says China unavailable, not Loading… (minor #3)", () => {
  const s = R.rankFailed(R.setMarketsSort(R.rankLoaded(R.setMarketsRegion(R.setMarketsTab(screen().s, 'stocks'), 'cn'), { sort: 'volume', data: RANK, at: NOW }), 'movers'), { sort: 'movers', at: NOW });
  const html = renderMarketsScreen(s, NOW);
  assert.match(html, /<p class="mk-empty">China unavailable<\/p>/);
  assert.doesNotMatch(html, /Loading…/);
});

test("an A-share page's star reads the Account's list: an Account key, the page's china entry, an old cn star", () => {
  const route = { screen: 'markets', id: 'cn:600519' };
  const starOf = html => html.match(/data-action="toggleWatch" data-id="cn:600519" aria-pressed="(true|false)">[\s\S]*?(Watching|Watch)<\/button>/)?.slice(1).join(' ');
  assert.equal(starOf(screen({ route, all: null }).html), 'false Watch');
  assert.equal(starOf(screen({ route, all: null, watch: ['cn:600519'] }).html), 'true Watching', "in this browser's Account store");
  assert.equal(starOf(screen({ route, all: null, cn: [MOUTAI] }).html), 'true Watching', 'an old cn star the move left');
  const { s } = screen({ route, all: null });
  const page = { ...fx('account'), watch: [{ venue: 'china', symbol: '600519', at: '2026-11-01T01:00:00.000Z' }] };
  const atAccount = R.accountLoaded(s, { data: page, at: NOW });
  assert.equal(starOf(renderMarketsScreen(atAccount, NOW)), 'true Watching', "on the Account's own list");
  assert.equal(starOf(renderMarketsScreen(R.accountLoaded(s, { data: fx('account'), at: NOW }), NOW)), 'false Watch');
});

test("on a page that signs for an Account that takes writes, a market's page carries Close…, Change… and a perpetual's Leverage…", () => {
  const keys = html => html.match(/<div class="mk-d-acts">[\s\S]*?<\/div>/)?.[0] ?? '';
  const page = (id, over = {}) => screen({ route: { screen: 'markets', id }, account: true, role: 'signs', ...over }).html;
  // a perpetual: Leverage… among its keys at its first connected line, the leverage held there; You hold its Close… and Leverage…
  const btc = page('perp:BTC');
  assert.ok(keys(btc).startsWith('<div class="mk-d-acts"><button type="button" class="btn" data-action="openSheet" data-kind="leverage" data-venue="ex" data-venue-name="Stand-in Exchange" data-symbol="BTC/USDT:USDT" data-name="BTC perpetual" data-leverage="3">Leverage…</button>'), keys(btc));
  const held = section(btc, 'You here');
  assert.match(held, /data-kind="close" data-venue="ex" data-symbol="BTC\/USDT:USDT"[^>]*>Close…<\/button>/);
  assert.match(held, /data-kind="leverage" data-venue="ex"[^>]*>Leverage…<\/button>/);
  // a market with orders working: Open orders' Change… on each resting one at a venue that amends
  const sol = section(page('coin:SOL'), 'You here');
  for (const id of ['ord-0010', 'ord-0004', 'ord-0002']) assert.match(sol, new RegExp(`data-kind="amend" data-venue="ex" data-order="${id}"[^>]*>Change…</button>`), id);
  assert.doesNotMatch(keys(page('coin:SOL')), /data-kind="leverage"/, 'spot sets no leverage');
  // an event held is sold
  assert.match(section(page('event:predict:SI-FEDCUT-DEC', { predictions: fx('explore-predictions'), tab: 'macro' }), 'You here'), /data-kind="close" data-venue="predict"[^>]*>Sell…<\/button>/);
  // a page that does not sign, or an Account that is read-only: none of the three
  const none = /data-kind="(close|amend|leverage)"/;
  for (const role of [null, 'pending', 'signed-out']) assert.doesNotMatch(page('perp:BTC', { role }) + page('coin:SOL', { role }), none, String(role));
  const ro = { ...fx('account'), connectLive: { ...fx('account').connectLive, writes: { on: false, capUsd: 250 } } };
  for (const id of ['perp:BTC', 'coin:SOL']) {
    const { s } = screen({ route: { screen: 'markets', id }, account: true, role: 'signs' });
    assert.doesNotMatch(renderMarketsScreen(R.accountLoaded(s, { data: ro, at: NOW }), NOW), none, `read-only ${id}`);
  }
});

// ── a market page's four reads beside its price (plan 4a Task 4) ──

// a full book of `n` levels a side about 62,500, the size of the third bid not given
const fullBook = (n, over = {}) => ({
  ok: true, venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT',
  book: {
    bids: Array.from({ length: n }, (_, i) => [62500 - i, i === 2 ? null : 0.1 * (i + 1)]), asks: Array.from({ length: n }, (_, i) => [62501 + i, 0.2]),
    at: '2026-10-22T11:59:30.000Z', from: 'Stand-in Exchange', depth: 'full',
  },
  ...over,
});
const trade = (i, side) => ({ price: 62500 + i, size: 0.01, ...(side ? { side } : {}), at: new Date(NOW - (30 - i) * 1_000).toISOString() });
const depthOf = (s, id, part, data, extra = {}) => R.depthLoaded(s, { id, part, data, at: NOW, ...extra });

test('the four reads: You here with what agents do here, the order book, the latest trades, a perpetual’s funding', () => {
  // You here: the holding, the orders with who placed them, then a line per agent action
  const sol = screen({ route: { screen: 'markets', id: 'coin:SOL' }, account: true }).html;
  const solHere = section(sol, 'You here');
  const [mine, agents] = solHere.split('<div class="mk-h3">What agents do here</div>');
  assert.deepEqual(linesOf(mine).map(text), [
    '·25 SOL · $3,571.25cost known for 0 of 25 SOL',
    '·Stand-in Exchange · Sell 0.6 SOL/USDT · stop · open · You',
    '·Stand-in Exchange · Buy 0.5 SOL/USDT · limit 142.44 · open · You',
  ]);
  const at = fx('asset-sol').lines.find(l => l.by !== 'You').at;
  assert.deepEqual(linesOf(agents).map(text), [
    '·Stand-in Exchange · Buy 0.707 SOL/USDT · limit 141.44 · open · Agent · Claude Code',
    `·${stamp(at)} · Buy 0.707 SOL · SOL / USDT · limit 141.44 · $0.00open · Claude Code, inside its limit`,
  ]);
  // the agent's order is drawn once, under what agents do here, never in the owner's list too
  assert.equal(solHere.split('Buy 0.707 SOL/USDT · limit 141.44 · open · Agent · Claude Code').length - 1, 1);

  // the order book: ten levels a side, best first, a size not given as —, the source in its words
  const base = screen({ route: { screen: 'markets', id: 'coin:BTC' }, account: true }).s;
  const draw = s => renderMarketsScreen(s, NOW);
  const booked = draw(depthOf(base, 'coin:BTC', 'book', fullBook(12)));
  const book = section(booked, 'Order book');
  const rows = [...book.matchAll(/<tr><td class="r up">([^<]*)<\/td><td class="r">([^<]*)<\/td><td class="r down">([^<]*)<\/td><td class="r">([^<]*)<\/td><\/tr>/g)].map(m => m.slice(1));
  assert.equal(rows.length, 10, 'ten levels a side');
  assert.deepEqual(rows[0], ['$62,500.00', '0.1', '$62,501.00', '0.2']);
  assert.deepEqual(rows[2], ['$62,498.00', '—', '$62,503.00', '0.2']);
  assert.match(book, /<\/table><p class="mk-note">Stand-in Exchange<\/p><\/section>$/);
  // the stand-in's: the best bid and ask alone
  const top = section(draw(depthOf(base, 'coin:BTC', 'book', fx('book'))), 'Order book');
  assert.match(top, /<p class="mk-note">Stand-in Exchange · Top of book only<\/p>/);
  assert.equal([...top.matchAll(/<tr><td class="r up">/g)].length, 1);

  // the latest trades: twenty, newest first, the side that took where the source says it — or the Account's none sentence
  const traded = section(draw(depthOf(base, 'coin:BTC', 'trades', { ok: true, venue: 'ex', symbol: 'BTC/USDT', trades: Array.from({ length: 25 }, (_, i) => trade(i, i % 2 ? 'sell' : '')) })), 'Latest trades');
  const lines = linesOf(traded).map(text);
  assert.equal(lines.length, 20);
  assert.equal(lines[0], `·$62,524.00 · 0.01${fmtClock(NOW - 6_000)}`, 'the newest first, no side said');
  assert.equal(lines[1], `·$62,523.00 · 0.01Sell · ${fmtClock(NOW - 7_000)}`);
  assert.match(section(draw(depthOf(base, 'coin:BTC', 'trades', fx('connected-trades'))), 'Latest trades'), /<p class="mk-empty">Stand-in Exchange publishes no trades the account can read<\/p>/);

  // each before its read answers: Loading…; failed before an answer: unavailable, in the Account's sentence where it gave one
  for (const [part, label] of [['book', 'Order book'], ['trades', 'Latest trades']]) assert.match(section(draw(base), label), /<p class="mk-empty">Loading…<\/p>/, label);
  const failed = (s, part, message = null) => R.depthFailed(s, { id: 'coin:BTC', part, at: NOW, message });
  assert.match(section(draw(failed(base, 'book', 'Stand-in Exchange did not answer in time')), 'Order book'), /<p class="mk-note">Stand-in Exchange did not answer in time<\/p><p class="mk-empty">Order book unavailable<\/p>/);
  assert.match(section(draw(failed(base, 'trades')), 'Latest trades'), /<p class="mk-empty">Trades unavailable<\/p>/);
  // a kept book re-served stale: As of its own stamp
  assert.match(section(draw(depthOf(base, 'coin:BTC', 'book', { ...fullBook(2), stale: true })), 'Order book'), new RegExp(`<p class="mk-note">As of ${fmtClock(Date.parse('2026-10-22T11:59:30.000Z'))}</p><table class="mk-book">`));
  // no funding on a coin's page
  assert.equal(section(booked, 'Funding'), '');

  // a perpetual's funding: what was paid and received, newest first, at its lines alone; None yet. when there is none
  const perp = screen({ route: { screen: 'markets', id: 'perp:BTC' }, account: true }).s;
  assert.match(section(draw(perp), 'Funding'), /<p class="mk-empty">Loading…<\/p>/);
  const paid = depthOf(perp, 'perp:BTC', 'funding', {
    ok: true, lines: [
      { at: '2026-10-22T10:00:00.000Z', symbol: 'BTC/USDT:USDT', side: 'long', qty: 0.01, rate: 0.0001, usd: 0.06, venue: 'ex', venueName: 'Stand-in Exchange' },
      { at: '2026-10-22T11:00:00.000Z', symbol: 'BTC/USDT:USDT', side: 'long', qty: 0.01, rate: -0.00005, usd: -0.03, venue: 'ex', venueName: 'Stand-in Exchange' },
      { at: '2026-10-22T11:30:00.000Z', symbol: 'ETH/USDT:USDT', side: 'long', qty: 1, rate: 0.0001, usd: 0.3, venue: 'ex', venueName: 'Stand-in Exchange' },
    ],
    // a venue of the page's lines not read, and one the page trades nothing at
    missing: [{ venue: 'ex', venueName: 'Stand-in Exchange', why: 'no answer in time.', part: 'funding' }, { venue: 'okx', venueName: 'OKX', why: 'a key without read rights', part: 'funding' }],
  });
  assert.match(section(draw(paid), 'Funding'), /<\/div><p class="mk-note">Not read: Stand-in Exchange: no answer in time\.<\/p><\/section>$/, 'the page’s venues alone, in the Account’s words');
  assert.deepEqual(linesOf(section(draw(paid), 'Funding').split('<p class="mk-note">Not read')[0]).map(text), [
    `·Received $0.03${fmtClock(Date.parse('2026-10-22T11:00:00.000Z'))} · Stand-in Exchange · long 0.01 · rate -0.0050%`,
    `·Paid $0.06${fmtClock(Date.parse('2026-10-22T10:00:00.000Z'))} · Stand-in Exchange · long 0.01 · rate 0.0100%`,
  ]);
  assert.match(section(draw(depthOf(perp, 'perp:BTC', 'funding', { ok: true, missing: [], lines: [] })), 'Funding'), /<p class="mk-empty">None yet\.<\/p><\/section>$/);
  // the stand-in's: no venue lists funding — None yet., never unavailable
  assert.match(section(draw(depthOf(perp, 'perp:BTC', 'funding', { ok: true, lines: [], missing: [] })), 'Funding'), /None yet\./);
  // unavailable only when the read itself failed: in the Account's sentence where it gave one
  assert.match(section(draw(R.depthFailed(perp, { id: 'perp:BTC', part: 'funding', at: NOW, message: 'the account layer is not mounted' })), 'Funding'),
    /<p class="mk-note">the account layer is not mounted<\/p><p class="mk-empty">Funding unavailable<\/p>/);
  // a stock's page has none
  assert.equal(section(screen({ route: { screen: 'markets', id: 'stock:NVDA' }, account: true }).html, 'Funding'), '');
});

test('an Account that answers the book with express’s 404 page, and the trades with 503 unreachable', async () => {
  // the face's getJson over a fetch that answers as the proxy passes the Account through: its reads, but the book (an express
  // 404 page, HTML) and the trades (the proxy's 503 for an Account it cannot reach)
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async path => {
    const [route, query = ''] = path.split('?');
    const q = new URLSearchParams(query);
    switch (route) {
      case '/data/market/explore': return json(fx('explore-all'));
      case '/data/account/connected/explore': return json({ ok: true, items: [], movers: [], closing: [], mostTraded: [], tabs: [], missing: [], notes: [] });
      case '/data/account/connected/candles': return json({ ...fx('candles'), venue: q.get('venue'), symbol: q.get('symbol'), range: q.get('range') });
      case '/data/account/compare': return json({ ...fx('compare'), base: q.get('base') });
      case '/data/market/quotes':
      case '/data/account/connected/quotes': return json({ ok: true, quotes: [] });
      case '/data/account/asset': return json(fx('asset-btc'));
      case '/data/account/connected/book': return new Response('<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Error</title></head><body><pre>Cannot GET /api/account/book</pre></body></html>\n',
        { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
      case '/data/account/connected/trades': return json({ ok: false, unreachable: 'ECONNREFUSED' }, 503);
      default: return json({ ok: false, error: 'no such route' }, 404);
    }
  };
  const errors = [];
  const saved = { error: console.error, warn: console.warn, log: console.log };
  for (const k of Object.keys(saved)) console[k] = (...a) => { errors.push([k, a]); };
  try {
    const store = createStore({ initial: R.nav(emptyState(), { screen: 'markets', id: 'coin:BTC' }), reducers: R });
    const storage = { getItem: () => null, setItem() {}, removeItem() {} };
    const markets = startMarkets({ store, getJson: getJsonVia(fetch), storage, win: null, stream: { follow() {} }, schedule: () => null, cancelTimer() {}, now: () => NOW });
    markets.show(true);
    markets.page('coin:BTC');
    for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
    const html = renderMarketsScreen(store.get(), NOW);
    // its price, its history and You here are drawn
    assert.match(html, /<span class="mk-big">\$62,480\.00<\/span>/);
    assert.match(section(html, 'Price history'), /class="mk-chart"/);
    assert.match(section(html, 'You here'), /0\.124 BTC · \$7,747\.40/);
    // the book and the trades are unavailable: neither answer carries a body the face reads, which is the Account not answering,
    // and the line has no public twin of its connection to read instead — said in those words, none of the face's error's
    assert.match(section(html, 'Order book'), /<div class="mk-h2">Order book<\/div><p class="mk-note">The Account is not answering<\/p><p class="mk-empty">Order book unavailable<\/p><\/section>/);
    assert.match(section(html, 'Latest trades'), /<div class="mk-h2">Latest trades<\/div><p class="mk-note">The Account is not answering<\/p><p class="mk-empty">Trades unavailable<\/p><\/section>/);
    assert.doesNotMatch(html, /Cannot GET|DOCTYPE|ECONNREFUSED|HTTP 404|HTTP 503|SyntaxError/);
    markets.close();
  } finally {
    Object.assign(console, saved);
  }
  assert.deepEqual(errors, [], 'no parse error reaches the console');
});

// ---- a level's marks (plan 2026-11-01-desk-p3-watch Task 11); the Desk is its own screen since desk-page plan 1 Task 5

test('Markets lists no Desk tab, and setMarketsTab with desk leaves the tab as it was', async () => {
  const { deskStatus, DESK_NOW } = await import('./helpers/desk-status.js');
  const { s } = screen({ tab: 'watchlist' });
  const html = renderMarketsScreen(R.deskLoaded(s, { data: deskStatus(), at: DESK_NOW }), DESK_NOW);
  const tabs = [...html.matchAll(/data-action="mkTab" data-value="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs, ['watchlist', 'crypto', 'stocks', 'indices', 'commodities', 'fx', 'preipo', 'macro']);
  assert.doesNotMatch(html, /data-action="deskPause"/, 'no Pause on Markets');
  assert.equal(R.setMarketsTab(s, 'desk'), s, 'desk is no tab of Markets');
  assert.equal(R.setMarketsTab(s, 'desk').markets.tab, 'watchlist');
});

test('a marked row draws its mark after its name; a page draws the plan and file under its price', async () => {
  const { deskStatus, DESK_NOW } = await import('./helpers/desk-status.js');
  const withDesk = st => R.deskLoaded(st, { data: deskStatus(), at: DESK_NOW });
  const { s } = screen({ cn: [MOUTAI], quotes: { 'cn:600519': moutaiQuote() }, watch: ['stock:NVDA', 'coin:BTC'], tab: 'watchlist' });
  const html = renderMarketsScreen(withDesk(s), NOW);
  assert.match(rowOf(html, 'stock:NVDA'), /<b>NVIDIA[^<]*<\/b><span class="mk-level">stop 170 · -1\.30%<\/span>/);
  assert.match(rowOf(html, 'cn:600519'), /<span class="mk-level">buy_zone 1600-1650<\/span>/);
  assert.doesNotMatch(rowOf(html, 'coin:BTC'), /mk-level/);
  assert.doesNotMatch(renderMarketsScreen(s, NOW), /mk-level/, 'no status, no marks');
  // the pages: the Account's NVDA and the A share
  const nvda = screen({ route: { screen: 'markets', id: 'stock:NVDA' }, account: true });
  const page = renderMarketsScreen(withDesk(nvda.s), NOW);
  assert.match(page, /<p class="mk-plan"><span class="mk-level">stop 170 · -1\.30%<\/span> sell half on a close below 170 · desk\/levels\.yml<\/p>/);
  const cn = screen({ route: { screen: 'markets', id: 'cn:600519' }, cn: [MOUTAI], quotes: { 'cn:600519': moutaiQuote() } });
  assert.match(renderMarketsScreen(withDesk(cn.s), NOW), /<p class="mk-plan"><span class="mk-level">buy_zone 1600-1650<\/span> add 100 shares in the zone · desk\/levels\.yml<\/p>/);
  assert.doesNotMatch(renderMarketsScreen(nvda.s, NOW), /mk-plan/);
});

test('a level, its plan and its file as the operator wrote them are text, never markup: on the row and the page', async () => {
  const { deskStatus, DESK_NOW } = await import('./helpers/desk-status.js');
  const EVIL = '<img src=x onerror=alert(1)>';
  const st = deskStatus();
  st.watch.marks[0] = { ...st.watch.marks[0], kind: EVIL, level: EVIL, plan: EVIL, file: EVIL };
  const withDesk = x => R.deskLoaded(x, { data: st, at: DESK_NOW });
  const table = renderMarketsScreen(withDesk(screen().s), NOW);
  const page = renderMarketsScreen(withDesk(screen({ route: { screen: 'markets', id: 'stock:NVDA' }, account: true }).s), NOW);
  for (const [name, html] of [['row', rowOf(table, 'stock:NVDA')], ['page', page]]) {
    assert.doesNotMatch(html, /<img/, `${name}: no markup`);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, `${name}: the text, escaped`);
  }
});

// the final review's ruling: a title is derived from the first prompt, so a market page's conversations draw it masked
test("a market page's conversation titles are masked", () => {
  const SK = 'sk-proj-aB3dE6fG9hJ2kL5mN8pQ1rS4';
  const { html } = screen({ route: { screen: 'markets', id: 'coin:BTC' }, account: true, conversations: [conv('s1', { title: `BTC with ${SK}` })] });
  assert.ok(html.includes(`<div class="mk-t1">BTC with sk-proj-${'*'.repeat(SK.length - 8)}</div>`));
  assert.doesNotMatch(html, /aB3dE6fG9h/);
});

// ---- a stock's page at an event (analog event table Task 9): the window as daily candles, marked, against the market

const WYNN_A = 'ev-WYNN-2018-01-26';
const AT = '2018-01-26';
const KEY = `stock:WYNN@${AT}`;
// WYNN as All lists it: NVDA's row under WYNN's name and symbol
const wynnItem = () => {
  const nvda = itemOf(fx('explore-all'), 'stock:NVDA');
  return { ...nvda, key: 'stock:WYNN', base: 'WYNN', name: 'Wynn Resorts', at: nvda.at.map(l => ({ ...l, symbol: 'WYNN' })) };
};
const allWithWynn = () => { const all = fx('explore-all'); all.items.push(wynnItem()); return all; };
// the view's WYNN window (k = −30…60, o h l c v) on weekdays from 2017-12-15 at 09:30 New York, so k = 0 is 2018-01-26 and
// WYNN's second event (day 0 2018-02-07) k = 8; `after` bars after day 0 at most
function wynnBars(after = 60) {
  const rows = EVENT_VIEW_WITH_B.cases[0].window.filter(([k]) => k <= after);
  const bars = [];
  for (let t = Date.parse('2017-12-15T14:30:00Z'); bars.length < rows.length; t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const [, o, h, l, c, v] = rows[bars.length];
    bars.push({ t, o, h, l, c, v });
  }
  return bars;
}
const answer = (after = 60) => ({ ok: true, candles: wynnBars(after), source: 'Nasdaq · WYNN', adjustment: 'split-adjusted, not dividend-adjusted', more: true });
const eventRoute = (over = {}) => ({ screen: 'markets', id: 'stock:WYNN', event: { at: AT, view: EVENT_VIEW_ID, case: WYNN_A, ...over } });
// the page at the event, its window landed (or `bars` as given), its view as the analog slice holds it, drawn in Chinese
function eventPage({ route = eventRoute(), bars = answer(), view = { status: 'loaded', view: EVENT_VIEW_WITH_B } } = {}) {
  let { s } = screen({ route, all: allWithWynn(), account: true });
  const key = `stock:WYNN@${route.event.at}`;
  if (bars) s = R.eventBarsLoaded(s, { key, data: bars, at: NOW });
  if (view) s = { ...s, analog: { tasks: {}, views: { [EVENT_VIEW_ID]: view } } };
  return { s, html: withTable(ZH, () => renderMarketsScreen(s, NOW)) };
}
const svgOf = html => html.match(/<svg class="ew-chart"[\s\S]*?<\/svg>/)?.[0] ?? '';
const bannerOf = html => html.match(/<div class="ew-banner">[\s\S]*?(?=<div class="mk-d-px">)/)?.[0] ?? '';

test("a stock's page at an event: the banner, 事件前后 pressed, the candles marked, against the market, the caption", () => {
  const { html } = eventPage();
  assert.equal(nyDay(wynnBars()[30].t), AT);
  // the banner above the price: where it came from, the case's group, date and timing, label, note and three chips, a link back
  const banner = bannerOf(html);
  assert.ok(banner, html.slice(0, 2000));
  assert.ok(html.indexOf('class="ew-banner"') < html.indexOf('class="mk-big"'), 'above the price');
  assert.ok(banner.includes('从「事件对标」跳来'));
  assert.match(banner, /<a class="ew-back" href="#\/messages">回到消息 ›<\/a>/);
  assert.ok(banner.includes('>A 创始人/被查·在任<'));
  assert.ok(banner.includes('>2018-01-26<'));
  assert.ok(banner.includes('>盘中<'));
  assert.ok(banner.includes('>Wynn Resorts · Steve Wynn<'));
  assert.ok(banner.includes('>WSJ 性行为不端报道，盘中；当日仍为董事长兼 CEO<'));
  assert.deepEqual([...banner.matchAll(/<span class="et-chip (\w+)"><span class="et-chip-label">([^<]+)<\/span>([^<]+)<\/span>/g)].map(m => m.slice(1)),
    [['down', '当天', '−11.2%'], ['down', '5 天', '−14.6%'], ['up', '60 天', '+2.0%']]);
  // the range: 事件前后 first and pressed, then 1D…MAX
  const history = section(html, '价格历史');
  const items = [...history.matchAll(/<button type="button" class="seg-item( pressed)?" aria-pressed="(true|false)" data-action="setRange" data-value="([^"]+)" data-id="stock:WYNN">([^<]+)</g)].map(m => [m[3], m[2], m[4]]);
  assert.deepEqual(items[0], ['event', 'true', '事件前后']);
  assert.deepEqual(items.slice(1).map(i => i[0]), CANDLE_RANGES);
  assert.ok(items.slice(1).every(i => i[1] === 'false'));
  // the card titled with the window's first and last dates; the candles, day 0 and WYNN's other event in the window
  const bars = wynnBars();
  assert.ok(history.includes(`>${nyDay(bars[0].t)} 至 ${nyDay(bars[90].t)}<`), 'the card title');
  const svg = svgOf(history);
  assert.equal([...svg.matchAll(/class="ew-body (up|down)"/g)].length, 91);
  assert.ok(svg.includes('>01-26 Wynn Resorts · Steve Wynn</text>'));
  assert.ok(svg.includes('>B 创始人/当天离任 · Wynn Resorts · Steve Wynn resigns</text>'), 'the other event, labelled with its group and its label');
  assert.ok(svg.includes('>5 天 −14.6%</text>'));
  assert.ok(svg.includes('>60 天 +2.0%</text>'));
  assert.doesNotMatch(history, /class="mk-chart"/, 'no close line');
  // against the market, from the case's rel; the caption: the answer's source, its adjustment, and Nasdaq filled the window
  assert.ok(history.includes('相对大盘（SPY）· 消息前一天 = 100'));
  assert.match(history, /<svg class="ew-rel" /);
  assert.ok(history.includes('<p class="mk-note ew-caption">Nasdaq · WYNN · split-adjusted, not dividend-adjusted · Nasdaq 补齐</p>'));
});

test("the event page's window: Loading…, a failed read's words, no bar on the day", () => {
  const loading = eventPage({ bars: null });
  assert.match(section(loading.html, '价格历史'), /<p class="mk-note">加载中…<\/p>/);
  assert.equal(svgOf(loading.html), '');
  const failed = withTable(ZH, () => renderMarketsScreen(R.eventBarsFailed(loading.s, { key: KEY, at: NOW, message: 'Nasdaq did not answer' }), NOW));
  assert.match(section(failed, '价格历史'), /<p class="mk-note">Nasdaq did not answer<\/p>/);
  assert.equal(svgOf(failed), '');
  const none = eventPage({ bars: { ...answer(), candles: wynnBars().filter((_, i) => i !== 30) } });
  assert.ok(section(none.html, '价格历史').includes('2018-01-26 没有日线'));
});

test('a case whose rel is null draws the sentence, not the line (Review Focus 4)', () => {
  const { html } = eventPage({ route: eventRoute({ at: WYNN_B_CASE.day0, case: WYNN_B_CASE.id }) });
  const history = section(html, '价格历史');
  assert.ok(svgOf(history));
  assert.ok(history.includes('视图没有保留这个事件相对大盘的走势'));
  assert.doesNotMatch(history, /class="ew-rel"/);
  assert.ok(bannerOf(html).includes('>B 创始人/当天离任<'));
  // its day 0 labelled with its own label, the first event the other mark
  assert.ok(svgOf(history).includes('>02-07 Wynn Resorts · Steve Wynn resigns</text>'));
  assert.ok(svgOf(history).includes('>A 创始人/被查·在任 · Wynn Resorts · Steve Wynn</text>'));
});

test('+60 is not flagged when the window holds fewer than 61 bars after day 0 (Review Focus 2)', () => {
  const svg = svgOf(eventPage({ bars: answer(40) }).html);
  assert.equal([...svg.matchAll(/class="ew-body /g)].length, 71);
  assert.ok(svg.includes('>5 天 −14.6%</text>'));
  assert.doesNotMatch(svg, /60 天/);
});

test('a view no longer kept still draws the window and day 0, and says the view is no longer kept', () => {
  const { html } = eventPage({ view: { status: 'failed', error: 'HTTP 404', gone: true } });
  const svg = svgOf(html);
  assert.equal([...svg.matchAll(/class="ew-body /g)].length, 91);
  assert.match(svg, /<line class="ew-day0" /);
  assert.ok(svg.includes('>01-26</text>'));
  assert.doesNotMatch(svg, /ew-flag|ew-mark"/);
  assert.ok(bannerOf(html).includes('对标视图已不再保留这个事件'));
  assert.doesNotMatch(html, /相对大盘（SPY）/);
  // the view's texts are masked and escaped: a key in a label is not drawn, markup is text
  const key = 'sk-ant-api03-' + 'a'.repeat(40);
  const view = { ...EVENT_VIEW_WITH_B, cases: EVENT_VIEW_WITH_B.cases.map(c => (c.id === WYNN_A ? { ...c, label: `<b>Wynn</b> ${key}`, note: '<img src=x>' } : c)) };
  const masked = eventPage({ view: { status: 'loaded', view } }).html;
  assert.doesNotMatch(masked, /<b>Wynn|<img src=x>/);
  assert.ok(!masked.includes(key), 'the key is masked');
  assert.ok(masked.includes('&lt;b&gt;Wynn&lt;/b&gt;'));
});

test('a hand-edited view= that is no view id says the view is no longer kept, never Loading… (it is never read)', () => {
  const { html } = eventPage({ route: eventRoute({ view: 'not-a-view' }), view: null });
  const banner = bannerOf(html);
  assert.ok(banner.includes('对标视图已不再保留这个事件'), banner);
  assert.doesNotMatch(banner, /加载|读取/);
  assert.equal([...svgOf(html).matchAll(/class="ew-body /g)].length, 91, 'the window and day 0 still drawn');
});

test('choosing 1M on the event page navigates to the plain stock page and draws 1M; 事件前后 does nothing', async () => {
  const route = eventRoute();
  let { s } = screen({ route, all: allWithWynn(), account: true });
  s = R.eventBarsLoaded(s, { key: KEY, data: answer(), at: NOW });
  const store = createStore({ initial: s, reducers: R });
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const win = { location: { hash: '#/markets/stock:WYNN?at=2018-01-26&view=an-20261112-50c20b08&case=ev-WYNN-2018-01-26' }, addEventListener() {}, removeEventListener() {} };
  const reads = [];
  const getJson = async path => { reads.push(path); return path.includes('/candles?') && path.includes('range=1M') ? { ...fx('candles'), range: '1M' } : { ok: false }; };
  const markets = startMarkets({ store, getJson, storage, win, stream: { follow() {} }, schedule: () => null, cancelTimer() {}, now: () => NOW });
  markets.range('stock:WYNN', 'event');
  assert.equal(win.location.hash, '#/markets/stock:WYNN?at=2018-01-26&view=an-20261112-50c20b08&case=ev-WYNN-2018-01-26', '事件前后 is where it is');
  assert.deepEqual(store.get().route, route);
  markets.range('stock:WYNN', '1M');
  assert.equal(win.location.hash, '#/markets/stock:WYNN');
  assert.deepEqual(store.get().route, { screen: 'markets', id: 'stock:WYNN' });
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  assert.ok(reads.some(p => p.includes('/candles?') && p.includes('range=1M')), reads.join());
  const history = section(renderMarketsScreen(store.get(), NOW), 'Price history');
  assert.match(history, /class="seg-item pressed" aria-pressed="true" data-action="setRange" data-value="1M" data-id="stock:WYNN">1M</);
  assert.doesNotMatch(history, /data-value="event"|ew-chart/);
  assert.match(history, /class="mk-chart"/);
  markets.close();
});

// ── the local path (spec 2026-11-20 §5.6): Hong Kong, Korea, Taiwan and the cash indices drawn as China A's ranking is ──

const HK_QUERY = 'asset=stocks&form=spot&region=hk&sort=volume&limit=20';
const KR_QUERY = 'asset=stocks&form=spot&region=kr&sort=volume&limit=20';
const EU_QUERY = 'asset=indices&form=spot&region=eu&sort=volume&limit=20';
const localRank = (venue, query, items) => ({ ok: true, venue, query, sort: 'volume', total: items.length, asOf: '2026-11-21T02:30:00Z', session: { phase: 'trading', lastSession: '2026-11-20' },
  status: { state: 'live', said: '' }, stale: false, items });
const HK_RANK = localRank('hk', HK_QUERY, [
  { id: 'hk:00700', symbol: '00700', name: 'Tencent', name_local: '騰訊控股', kind: 'share', price: 400, change_pct: 1.27, turnover: 4.8e9, currency: 'HKD', quote_from: 'Tencent' },
  { id: 'hk:09988', symbol: '09988', name: 'Alibaba', kind: 'share', price: 80, change_pct: -0.5, turnover: 3e9, currency: 'HKD', quote_from: 'Tencent' }]);
const EU_RANK = localRank('ix', EU_QUERY, [{ id: 'ix:eu:dax', symbol: 'dax', name: 'DAX', kind: 'index', price: 18000.5, change: 12.5, change_pct: 0.07, quote_from: 'Naver · 15 min delayed' }]);
const onRegion = (tab, region) => R.setMarketsRegion(R.setMarketsTab(screen().s, tab), region);

test('the ranking a query was not last asked for is dropped (Review Focus 5); one with no query lands as China A always did', () => {
  let s = R.rankLoading(onRegion('stocks', 'hk'), { sort: 'volume', query: HK_QUERY });
  s = R.rankLoading(R.setMarketsRegion(s, 'kr'), { sort: 'volume', query: KR_QUERY });
  assert.equal(s.markets.rank.query, KR_QUERY);
  const late = R.rankLoaded(s, { sort: 'volume', query: HK_QUERY, data: HK_RANK, at: NOW });
  assert.equal(late, s, "Hong Kong's answer, landing after Korea was asked, changes nothing");
  assert.equal(R.rankFailed(s, { sort: 'volume', query: HK_QUERY, at: NOW }), s, 'nor its failure');
  const kr = localRank('kr', KR_QUERY, [{ id: 'kr:005930', symbol: '005930', name: '삼성전자', kind: 'share', price: 55000, change_pct: 1, turnover: 1e12, currency: 'KRW', quote_from: 'Naver' }]);
  assert.equal(R.rankLoaded(s, { sort: 'volume', query: KR_QUERY, data: kr, at: NOW }).markets.rank.data, kr);
  assert.equal(R.rankLoaded(s, { sort: 'volume', data: RANK, at: NOW }).markets.rank.data, RANK, 'no query: as it always was');
});

test("a local ranking's rows: a share's code and local name, its price and turnover in its currency, no star; an index's level", () => {
  const s = R.rankLoaded(R.rankLoading(onRegion('stocks', 'hk'), { sort: 'volume', query: HK_QUERY }), { sort: 'volume', query: HK_QUERY, data: HK_RANK, at: NOW });
  const rows = rowsOf(s.markets, NOW);
  assert.deepEqual(rows.map(r => [r.id, r.name, r.sub, r.priced.unit, r.currency, r.noStar]), [
    ['hk:00700', 'Tencent', '00700 · 騰訊控股', 'hkd', 'HKD', true], ['hk:09988', 'Alibaba', '09988', 'hkd', 'HKD', true]]);
  const html = renderMarketsScreen(s, NOW);
  assert.deepEqual(rowIds(html), ['hk:00700', 'hk:09988']);
  const [name, px, move, turnover, source] = cells(rowOf(html, 'hk:00700'));
  assert.match(name, /<b>Tencent<\/b><span class="mk-sub">00700 · 騰訊控股<\/span>/);
  assert.equal(px, 'HK$400.00');
  assert.equal(text(move), '▲up 1.27%');
  assert.equal(turnover, 'HK$4.8B');
  assert.equal(text(source), 'Tencent');
  assert.doesNotMatch(html, /mk-star/, 'no watchlist star on a Hong Kong row');
  // the cash indices: a level, no currency, its change %
  const ix = R.rankLoaded(R.rankLoading(onRegion('indices', 'eu'), { sort: 'volume', query: EU_QUERY }), { sort: 'volume', query: EU_QUERY, data: EU_RANK, at: NOW });
  const [dax] = rowsOf(ix.markets, NOW);
  assert.deepEqual([dax.id, dax.kind, dax.name, dax.priced.unit, dax.priced.change24h, dax.currency], ['ix:eu:dax', 'index', 'DAX', 'level', 12.5, null]);
  const ixHtml = renderMarketsScreen(ix, NOW);
  assert.equal(cells(rowOf(ixHtml, 'ix:eu:dax'))[1], '18,000.50');
  assert.equal(text(cells(rowOf(ixHtml, 'ix:eu:dax'))[4]), 'Naver · 15 min delayed');
  // a ranking kept for Hong Kong is no answer on Korea's screen
  assert.deepEqual(rowsOf(R.setMarketsRegion(s, 'kr').markets, NOW), []);
});

test('Stocks › Japan and India on Spot: the empty line says no free source lists those shares', () => {
  for (const region of ['jp', 'in']) {
    const html = renderMarketsScreen(onRegion('stocks', region), NOW);
    assert.match(html, /<p class="mk-empty">No free source lists these shares; their perps are under Perp\.<\/p>/, region);
  }
  assert.doesNotMatch(renderMarketsScreen(R.setMarketsForm(onRegion('stocks', 'jp'), 'perp'), NOW), /No free source/);
});

// ── a local market's page (spec 2026-11-20 §5.6): a Hong Kong, Korean or Taiwanese share's, a cash index's, the A share's kind ──

const localQuote = (venue, symbol, market) => localQuoteOf({ venue, symbol, market }, NOW);
const HK_FACTS = { prevClose: 395, open: 396, high: 402.4, low: 394.2, volume: 18_200_000, turnover: 7.3e9, lastSession: '2026-11-20', phase: 'midday', quoteStatus: 'unsaid' };
const TENCENT_Q = localQuote('hk', '00700', { symbol: '00700', name: 'Tencent', price: 400, change24h: 5, changePct24h: 1.27, quoteAt: '2026-11-21T03:30:00Z', quoteFrom: 'Tencent', currency: 'HKD', local: HK_FACTS });
const SAMSUNG_Q = localQuote('kr', '005930', { symbol: '005930', name: '삼성전자', price: 71500, change24h: -500, changePct24h: -0.69, quoteAt: '2026-11-21T05:00:00Z', quoteFrom: 'Naver · 15 min delayed', currency: 'KRW',
  local: { prevClose: 72000, open: 71800, high: 72100, low: 71200, volume: 9_100_000, turnover: 1.23e12, lastSession: '2026-11-21', phase: 'trading', quoteStatus: 'delayed' } });
const DAX_Q = localQuote('ix', 'eu:dax', { symbol: 'eu:dax', name: 'DAX', price: 18000.5, change24h: 12.5, changePct24h: 0.07, quoteAt: '2026-11-21T10:00:00Z', quoteFrom: 'Naver · 15 min delayed',
  local: { prevClose: 17988, open: 17990, high: 18050.25, low: 17950, volume: null, turnover: null, lastSession: '2026-11-20', phase: 'closed', quoteStatus: 'delayed' } });
const localPage = (id, quote, over = {}) => screen({ route: { screen: 'markets', id }, all: null, quotes: quote ? { [id]: quote } : {}, ...over }).html;
const factsOf = html => [...html.matchAll(/<dt>([^<]+)<\/dt><dd>([^<]+)<\/dd>/g)].map(m => [m[1], m[2]]);

test("a Hong Kong share's page: its price in HK$, the eight facts, its code and local name, Hand to gravit and no star", () => {
  const route = R.nav(emptyState(), { screen: 'markets', id: 'hk:00700' }).route;
  assert.deepEqual(route, { screen: 'markets', id: 'hk:00700' }, 'a local key opens its page as it is');
  const ranked = R.rankLoaded(R.rankLoading(onRegion('stocks', 'hk'), { sort: 'volume', query: HK_QUERY }), { sort: 'volume', query: HK_QUERY, data: HK_RANK, at: NOW });
  const s = R.quotesUpdated(R.nav(ranked, { screen: 'markets', id: 'hk:00700' }), { quotes: { 'hk:00700': TENCENT_Q }, connection: 'polling' });
  const html = renderMarketsScreen(s, NOW);
  assert.equal(marketPage('hk:00700', s, NOW), html);
  assert.match(html, /<h1 class="head-title">Tencent<\/h1><span class="mk-sub">Hong Kong · 00700 · 騰訊控股<\/span>/);
  assert.match(html, /<span class="mk-big">HK\$400\.00<\/span>/);
  assert.deepEqual(factsOf(html), [['Previous close', 'HK$395.00'], ['Open', 'HK$396.00'], ['High', 'HK$402.40'], ['Low', 'HK$394.20'],
    ['Volume', '18.2M shares'], ['Turnover', 'HK$7.3B'], ['Session', 'Lunch break'], ['Source', 'Tencent']]);
  assert.match(html, /aria-label="Price history"/);
  assert.match(html, /data-action="handToGravit" data-id="hk:00700"/);
  assert.doesNotMatch(html, /toggleWatch|openTicket|You hold|Across venues|Limit up|P\/E/);
  // reached cold, before any quote: its code alone, every fact —
  const cold = localPage('hk:00700', null);
  assert.match(cold, /<h1 class="head-title">00700<\/h1>/);
  assert.ok(factsOf(cold).every(([, v]) => v === '—'), factsOf(cold).join());
});

test("a Korean share's price prints with no decimals; an index's level has no currency sign and no share facts", () => {
  const kr = localPage('kr:005930', SAMSUNG_Q);
  assert.match(kr, /<span class="mk-big">₩71,500<\/span>/);
  assert.deepEqual(factsOf(kr), [['Previous close', '₩72,000'], ['Open', '₩71,800'], ['High', '₩72,100'], ['Low', '₩71,200'],
    ['Volume', '9.1M shares'], ['Turnover', '₩1.2T'], ['Session', 'Open'], ['Source', 'Naver · 15 min delayed']]);
  assert.match(kr, /<span class="mk-sub">Korea · 005930<\/span>/);
  const dax = localPage('ix:eu:dax', DAX_Q);
  assert.match(dax, /<h1 class="head-title">DAX<\/h1><span class="mk-sub">Index · Europe<\/span>/);
  assert.match(dax, /<span class="mk-big">18,000\.50<\/span>/);
  assert.deepEqual(factsOf(dax), [['Previous close', '17,988.00'], ['Open', '17,990.00'], ['High', '18,050.25'], ['Low', '17,950.00'],
    ['Session', 'Closed'], ['Source', 'Naver · 15 min delayed']]);
  assert.doesNotMatch(dax, /\$|₩|Turnover|Volume/);
  // a Taiwanese share's price in NT$
  const tw = localPage('tw:2330', localQuote('tw', '2330', { symbol: '2330', name: 'TSMC', price: 1025, change24h: 10, changePct24h: 0.99, quoteAt: '2026-11-21T03:00:00Z', quoteFrom: 'TWSE', currency: 'TWD', local: HK_FACTS }));
  assert.match(tw, /<span class="mk-big">NT\$1,025\.00<\/span>/);
});

test("a local page's price history: a refusal's sentence in the chart area; 1D and 5D the sessions, longer the closes in its currency", () => {
  const route = { screen: 'markets', id: 'hk:00700' };
  const refused = screen({ route, all: null, quotes: { 'hk:00700': TENCENT_Q } }).s;
  const failed = renderMarketsScreen(R.candlesFailed(R.candlesLoading(refused, { id: 'hk:00700', range: '1D' }), { id: 'hk:00700', range: '1D', at: NOW, message: 'Tencent has no minute chart for this share' }), NOW);
  assert.match(section(failed, 'Price history'), /<p class="mk-note">Tencent has no minute chart for this share<\/p>/);
  assert.match(section(failed, 'Price history'), /data-action="setRange" data-value="1D"[^>]*data-id="hk:00700"|data-id="hk:00700"[^>]*data-action="setRange"/);
  const session = (date, n = 331) => ({ date, prec: 395, price: Array.from({ length: n }, (_, i) => 395 + (i % 9)), amount: Array.from({ length: n }, () => 1e6) });
  const one = renderMarketsScreen(R.candlesLoaded(refused, { id: 'hk:00700', range: '1D', at: NOW, data: { ok: true, range: '1D', sessions: [session('2026-11-21', 120)] } }), NOW);
  assert.match(section(one, 'Price history'), /class="mk-chart"[\s\S]*HK\$395\.00/);
  const m1 = R.setRange(refused, { id: 'hk:00700', range: '1M' });
  const month = renderMarketsScreen(R.candlesLoaded(m1, { id: 'hk:00700', range: '1M', at: NOW,
    data: { ok: true, range: '1M', candles: [{ t: Date.parse('2026-11-19T07:00:00Z'), c: 390 }, { t: Date.parse('2026-11-20T07:00:00Z'), c: 395 }] } }), NOW);
  assert.match(section(month, 'Price history'), /class="mk-chart"[\s\S]*<span>2026-11-20<\/span>/);
  assert.match(section(month, 'Price history'), /HK\$395\.00/);
});

test("a search's Hong Kong and Korean hits are listed beside the A shares, each drawn as its region's share, its price in its currency", () => {
  const hk = { key: 'hk:00700', kind: 'share', name: 'Tencent', nameLocal: '騰訊控股', base: '00700', currency: 'HKD', price: 400, changePct24h: 1.27, quoteFrom: 'Tencent', tabs: ['hk'], at: [] };
  const kr = { key: 'kr:005930', kind: 'share', name: '삼성전자', base: '005930', currency: 'KRW', price: 71500, changePct24h: -0.69, quoteFrom: 'Naver', tabs: ['kr'], at: [] };
  const body = fx('explore-search-china');
  body.items.push(hk, kr);
  const { s, html } = screen({ q: 'te', results: body });
  const s2 = R.hitQuotesLoaded(s, { quotes: { 'hk:00700': { price: 400, change_pct: 1.27 }, 'kr:005930': { price: 71500, change_pct: -0.69 } } });
  const drawn = renderMarketsScreen(s2, NOW);
  assert.ok(rowIds(html).includes('cn:600519'));
  assert.deepEqual(rowIds(drawn).filter(id => /^(hk|kr):/.test(id)), ['hk:00700', 'kr:005930']);
  assert.match(rowOf(drawn, 'hk:00700'), /<b>Tencent<\/b><span class="mk-sub"><span class="mk-tag">Stocks<\/span> 00700 · 騰訊控股<\/span>/);
  assert.equal(cells(rowOf(drawn, 'hk:00700'))[2], 'HK$400.00');
  assert.equal(cells(rowOf(drawn, 'kr:005930'))[2], '₩71,500');
  assert.match(rowOf(drawn, 'hk:00700'), /data-action="openMarket" data-id="hk:00700"/);
  assert.doesNotMatch(rowOf(drawn, 'hk:00700'), /mk-star/, 'no star on a Hong Kong share');
});

test("a region's own table: Change and Turnover for its shares, Level, Change and Change % for its indices; its source named when it fails", () => {
  const hk = renderMarketsScreen(R.rankLoaded(R.rankLoading(onRegion('stocks', 'hk'), { sort: 'volume', query: HK_QUERY }), { sort: 'volume', query: HK_QUERY, data: HK_RANK, at: NOW }), NOW);
  assert.match(hk, /<th scope="col" class="r">Price<\/th><th scope="col" class="r mk-c-chg">Change<\/th><th scope="col" class="r mk-c-vol">Turnover<\/th>/);
  const ix = renderMarketsScreen(R.rankLoaded(R.rankLoading(onRegion('indices', 'eu'), { sort: 'volume', query: EU_QUERY }), { sort: 'volume', query: EU_QUERY, data: EU_RANK, at: NOW }), NOW);
  assert.match(ix, /<th scope="col" class="r">Level<\/th><th scope="col" class="r mk-c-chg">Change<\/th><th scope="col" class="r mk-c-vol">Change %<\/th>/);
  const [, level, change, pct] = cells(rowOf(ix, 'ix:eu:dax'));
  assert.deepEqual([level, text(change), text(pct)], ['18,000.50', '+12.50', '▲up 0.07%']);
  // a failed read before any answer: the source named, no Back to the main sources
  const down = renderMarketsScreen(R.rankFailed(R.rankLoading(onRegion('stocks', 'kr'), { sort: 'volume', query: KR_QUERY }), { sort: 'volume', query: KR_QUERY, at: NOW }), NOW);
  assert.match(down, /<p class="mk-empty">Naver is not answering: Korean shares cannot be read now<\/p>/);
  assert.doesNotMatch(down, /mkMain|Back to the main sources/);
  const ixDown = renderMarketsScreen(R.rankFailed(R.rankLoading(onRegion('indices', 'eu'), { sort: 'volume', query: EU_QUERY }), { sort: 'volume', query: EU_QUERY, at: NOW }), NOW);
  assert.match(ixDown, /<p class="mk-empty">The index sources are not answering: the indices cannot be read now<\/p>/);
  // an answer with no rows: none, said once, no key
  const none = renderMarketsScreen(R.rankLoaded(R.rankLoading(onRegion('stocks', 'hk'), { sort: 'volume', query: HK_QUERY }), { sort: 'volume', query: HK_QUERY, data: { ...HK_RANK, items: [] }, at: NOW }), NOW);
  assert.match(none, /<p class="mk-empty">No markets<\/p>/);
  assert.doesNotMatch(none, /mkMain/);
  // the session's line above the table, in the region's own words
  const closed = renderMarketsScreen(R.rankLoaded(R.rankLoading(onRegion('stocks', 'hk'), { sort: 'volume', query: HK_QUERY }), { sort: 'volume', query: HK_QUERY, data: { ...HK_RANK, session: { phase: 'closed', lastSession: '2026-11-20' } }, at: NOW }), NOW);
  assert.match(closed, /<p class="mk-note">Closed · last session 11-20<\/p>/);
  assert.doesNotMatch(closed, /Beijing/);
});

test("every word of a local page and table is in the Chinese table", () => {
  const zh = f => withTable(ZH, f);
  const page = zh(() => localPage('hk:00700', TENCENT_Q));
  assert.match(page, /港币|HK\$/);
  for (const [label] of zh(() => factsOf(localPage('hk:00700', TENCENT_Q)))) assert.match(label, CJK, label);
  const down = zh(() => renderMarketsScreen(R.rankFailed(R.rankLoading(onRegion('stocks', 'kr'), { sort: 'volume', query: KR_QUERY }), { sort: 'volume', query: KR_QUERY, at: NOW }), NOW));
  assert.match(down, /Naver/);
  assert.match(text(down.match(/<p class="mk-empty">[^<]*<\/p>/)?.[0] ?? ''), CJK);
});

test("a search hit's source keeps its declared delay, and a hit naming no currency is priced in its venue's", () => {
  const kr = { key: 'kr:005930', kind: 'share', name: '삼성전자', base: '005930', price: 71500, changePct24h: -0.69, quoteFrom: 'Naver · 15 min delayed', tabs: ['kr'], at: [] };
  const tw = { key: 'tw:2330', kind: 'share', name: 'TSMC', base: '2330', currency: 'TWD', price: 1025, changePct24h: 0.99, tabs: ['tw'], at: [] };
  const body = { ...fx('explore-search-china'), items: [...fx('explore-search-china').items, kr, tw] };
  const html = screen({ q: 'sa', results: body }).html;
  const row = cells(rowOf(html, 'kr:005930'));
  assert.equal(row[2], '₩71,500', 'no currency named: the won, the venue’s');
  assert.equal(text(row.at(-1)), 'Naver · 15 min delayed', 'the hit’s own words, its delay in its own figure');
  assert.equal(text(cells(rowOf(html, 'tw:2330')).at(-1)), 'TWSE', 'a hit naming no source: its venue’s name alone');
});

test("a local page says under its price when the market is not answering, or its source fails", () => {
  const route = { screen: 'markets', id: 'hk:00700' };
  const base = screen({ route, all: null, quotes: { 'hk:00700': TENCENT_Q } }).s;
  assert.doesNotMatch(renderMarketsScreen(base, NOW), /mk-asof/, 'answering: nothing said');
  const stale = renderMarketsScreen(R.quotesUpdated(base, { quotes: { 'hk:00700': TENCENT_Q }, connection: 'stale' }), NOW);
  assert.match(stale, /<p class="mk-asof">The market is not answering · as last read<\/p>/);
  const said = renderMarketsScreen(R.localStatusUpdated(base, { venue: 'hk', status: { state: 'unavailable', said: '', notAnswering: true } }), NOW);
  assert.match(said, /<p class="mk-asof">The market is not answering · as last read<\/p>/);
  const down = renderMarketsScreen(R.localStatusUpdated(base, { venue: 'hk', status: { state: 'unavailable', said: '' } }), NOW);
  assert.match(down, /<p class="mk-asof">Tencent is not answering: Hong Kong shares cannot be read now<\/p>/);
  const own = renderMarketsScreen(R.localStatusUpdated(base, { venue: 'hk', status: { state: 'unavailable', said: 'Tencent refused the quote' } }), NOW);
  assert.match(own, /<p class="mk-asof">Tencent refused the quote<\/p>/);
  // another venue's trouble is not this page's
  assert.doesNotMatch(renderMarketsScreen(R.localStatusUpdated(base, { venue: 'kr', status: { state: 'unavailable', said: '' } }), NOW), /mk-asof/);
});

test("a US index's 1M closes are drawn on their own session dates, whichever source stamped them", () => {
  const route = { screen: 'markets', id: 'ix:us:spx' };
  const spx = localQuote('ix', 'us:spx', { symbol: 'us:spx', name: 'S&P 500', price: 5900.1, change24h: 10, changePct24h: 0.17, quoteAt: '2026-11-20T21:00:00Z', quoteFrom: 'Naver',
    local: { prevClose: 5890.1, open: 5891, high: 5910, low: 5880, volume: null, turnover: null, lastSession: '2026-11-20', phase: 'closed', quoteStatus: 'unsaid' } });
  const s = R.setRange(screen({ route, all: null, quotes: { 'ix:us:spx': spx } }).s, { id: 'ix:us:spx', range: '1M' });
  // Eastmoney's bars: the US session's date at 15:00 Beijing (07:00Z, the night before New York's close of that date)
  const em = renderMarketsScreen(R.candlesLoaded(s, { id: 'ix:us:spx', range: '1M', at: NOW,
    data: { ok: true, range: '1M', candles: [{ t: Date.parse('2026-11-19T15:00:00+08:00'), c: 5880 }, { t: Date.parse('2026-11-20T15:00:00+08:00'), c: 5900.1 }] } }), NOW);
  assert.match(section(em, 'Price history'), /<span>2026-11-19<\/span>[\s\S]*<span>2026-11-20<\/span>/);
  // Naver's bars: the session's local date at 15:30 UTC+9
  const naver = renderMarketsScreen(R.candlesLoaded(s, { id: 'ix:us:spx', range: '1M', at: NOW,
    data: { ok: true, range: '1M', candles: [{ t: Date.parse('2026-11-19T15:30:00+09:00'), c: 5880 }, { t: Date.parse('2026-11-20T15:30:00+09:00'), c: 5900.1 }] } }), NOW);
  assert.match(section(naver, 'Price history'), /<span>2026-11-19<\/span>[\s\S]*<span>2026-11-20<\/span>/);
  assert.doesNotMatch(section(naver, 'Price history'), /2026-11-21/);
  assert.match(section(naver, 'Price history'), /5,900\.10/);
  assert.doesNotMatch(section(naver, 'Price history'), /\$/);
});


// ---- the option chains (spec 2026-11-22 §5.4)

// a tab on Options with its read answered (market-view.js exploreQueryOf's query, the market's alone)
const optionsTab = (tab, body) => {
  const s = R.setMarketsForm(R.setMarketsTab(R.nav(emptyState(), { screen: 'markets', id: null }), tab), 'option');
  return R.exploreLoaded(s, { tab, data: body, at: NOW, query: exploreQueryOf(s.markets) });
};
const headsOf = html => [...html.matchAll(/<th scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map(m => text(m[1]));

test('an options view: a row an underlying with its price and change, nearest expiry, volume, open interest, ATM IV and source; no star', () => {
  const html = renderMarketsScreen(optionsTab('crypto', cryptoOptionsList()), NOW);
  assert.deepEqual(headsOf(html), ['Underlying', 'Price', 'Nearest expiry', 'Volume', 'Open interest', 'ATM IV', 'Source']);
  assert.deepEqual(rowIds(html), ['opt:BTC', 'opt:ETH', 'opt:HYPE'], "the market's order");
  const btc = cells(rowOf(html, 'opt:BTC'));
  assert.equal(btc.length, 7, 'no star column');
  assert.match(btc[0], /data-action="openMarket" data-id="opt:BTC"/);
  assert.match(text(btc[0]), /BTC options/);
  assert.match(text(btc[0]), /Deribit · OKX/);
  assert.match(text(btc[1]), /\$60,487\.12/);
  assert.match(text(btc[1]), /1\.84%/);
  assert.deepEqual(btc.slice(2).map(text), ['Nov 23', '$129.5M', '412.3k BTC', '41.2%', 'Deribit']);
  // OKX's row: no dollars given, so its volume is contracts; no IV given is —
  assert.deepEqual(cells(rowOf(html, 'opt:HYPE')).slice(2, 6).map(text), ['Nov 28', '1.2k contracts', '9.8k HYPE', '—']);
  assert.doesNotMatch(html, /mk-star/);
  // the market's notes under the rows, in its words
  assert.match(html, /<p class="mk-note">Crypto options: Deribit&#39;s figures where Deribit lists the coin/);
});

test('a US options view: contracts, the nearest expiry said on each row, the list read in part said under it', () => {
  const html = renderMarketsScreen(optionsTab('stocks', usOptionsList()), NOW);
  const nvda = cells(rowOf(html, 'opt:NVDA'));
  assert.match(text(nvda[0]), /Nasdaq · nearest expiry/);
  assert.deepEqual(nvda.slice(2).map(text), ['Nov 28', '1.3M contracts', '3.4M contracts', '—', 'Cboe · 15 min delayed']);
  // a row the US line did not price: no price, no change
  assert.equal(text(cells(rowOf(html, 'opt:SPY'))[1]).trim().startsWith('—'), true);
  assert.match(html, /<p class="mk-note">US options: 3 of 10 read<\/p>/);
  // a source that did not answer is said under the rows it left
  const down = renderMarketsScreen(optionsTab('stocks', usOptionsList({ missing: [{ venue: 'nasdaq', venueName: 'Nasdaq', why: 'Nasdaq refused this address' }] })), NOW);
  assert.match(down, /<p class="mk-note">Nasdaq refused this address<\/p>/);
  // in Chinese, the heads and the row's words
  const zh = withTable(ZH, () => renderMarketsScreen(optionsTab('stocks', usOptionsList()), NOW));
  assert.deepEqual(headsOf(zh), ['标的', '价格', '最近到期', '成交量', '未平仓量', '平值隐含波动率', '来源']);
  assert.match(zh, /NVDA 期权/);
  assert.match(zh, /纳斯达克 · 最近到期日/);
});

// a chain's page with the chain read for `query` answered (`chain`), or failed with the market's sentence
const chainPage = (id, { list = null, tab = 'crypto', chain = null, refusal = null, pick = null } = {}) => {
  let s = list ? optionsTab(tab, list) : R.nav(emptyState(), { screen: 'markets', id: null });
  s = R.nav(s, { screen: 'markets', id });
  if (pick) s = R.chainPicked(s, pick);
  const view = s.markets;
  const u = id.slice(4);
  const { chainQueryOf } = MV;
  const query = chainQueryOf(view, id);
  s = R.chainLoading(s, { query });
  if (chain) s = R.chainLoaded(s, { query, data: optionChainOf({ ok: true, value: chain }), at: NOW });
  if (refusal) s = R.chainFailed(s, { query, at: NOW, message: refusal });
  return { s, query, u, html: renderMarketsScreen(s, NOW) };
};

test("a chain's page: the expiry tabs, the venue switch, calls | strike | puts, the ATM strike marked and the money shaded", () => {
  const { html, query } = chainPage('opt:BTC', { list: cryptoOptionsList(), chain: btcChain() });
  assert.equal(query, 'underlying=BTC&venue=deribit', 'Deribit first for a coin it lists, the nearest expiry');
  assert.match(html, /<h1 class="head-title">BTC options<\/h1>/);
  assert.match(html, /<span class="mk-big">\$60,487\.12<\/span>/);
  assert.match(html, /<p class="mk-asof">Deribit<\/p>/);
  // the venue switch, Deribit pressed; the expiry tabs, the nearest pressed
  assert.match(html, /data-action="optVenue" data-value="deribit" data-id="opt:BTC">Deribit</);
  assert.match(html, /aria-pressed="false" data-action="optVenue" data-value="okx" data-id="opt:BTC">OKX</);
  const tabs = [...html.matchAll(/aria-pressed="(true|false)" data-action="optExpiry" data-value="([^"]+)"[^>]*>([^<]+)</g)].map(m => [m[2], m[3], m[1]]);
  assert.deepEqual(tabs, [['2026-11-23', 'Nov 23', 'true'], ['2026-11-24', 'Nov 24', 'false'], ['2026-11-28', 'Nov 28', 'false'], ['2026-12-26', 'Dec 26', 'false'], ['2027-03-26', 'Mar 26', 'false']]);
  // the table: two sides of seven and the strike between
  const chain = html.match(/<table class="mk-t mk-chain">[\s\S]*?<\/table>/)[0];
  assert.match(chain, />Calls<\/th>[\s\S]*>Strike<\/th>[\s\S]*>Puts<\/th>/);
  const rows = [...chain.matchAll(/<tr( class="mk-atm")?>(<td[\s\S]*?)<\/tr>/g)];
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => Boolean(r[1])), [false, true, false], 'the ATM strike, 60,000, marked');
  assert.match(rows[1][2], /▸ <\/span>60,000<span aria-hidden="true"> ◂<\/span><span class="sr-only"> at the money/);
  const tds = r => [...r.matchAll(/<td class="([^"]*)">([\s\S]*?)<\/td>/g)].map(m => [m[1], m[2]]);
  const k58 = tds(rows[0][2]), k62 = tds(rows[2][2]);
  assert.equal(k58.length, 14);
  assert.ok(k58.slice(0, 7).every(([c]) => c.includes('mk-itm')), 'a call below the price is in the money');
  assert.ok(k58.slice(7).every(([c]) => !c.includes('mk-itm')), 'a put below it is not');
  assert.ok(k62.slice(7).every(([c]) => c.includes('mk-itm')), 'a put above it is');
  // a crypto leg: its coin price, its dollars under it; its change a percent; its IV; a last the source gave none of is —
  assert.equal(text(k58[0][1]), `0.0405$${(0.0405 * 60487.12).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`);
  assert.match(k58[3][1], /class="up">\+3\.20%</);
  assert.equal(text(k58[6][1]), '41.5%');
  assert.equal(text(k58[9][1]), '—');
  assert.match(html, /<p class="mk-note">Prices in BTC, US dollars under each<\/p>/);
  assert.doesNotMatch(html, /As of the last read/);
  // the proxy re-serving the chain it kept: said as last read, the strikes kept
  const { s } = chainPage('opt:BTC', { list: cryptoOptionsList(), chain: btcChain() });
  const kept = R.chainLoaded(s, { query: s.markets.chain.query, data: { ...s.markets.chain.data, stale: true }, at: NOW });
  assert.match(renderMarketsScreen(kept, NOW), /<p class="mk-note">As of the last read<\/p>[\s\S]*mk-chain"/);
});

test("a US chain's page: Nasdaq, no venue switch, dollars and the change in dollars, no IV, its last trade under the price", () => {
  const { html, query } = chainPage('opt:AAPL', { list: usOptionsList(), tab: 'stocks', chain: aaplChain() });
  assert.equal(query, 'underlying=AAPL&venue=nasdaq');
  assert.doesNotMatch(html, /optVenue/);
  assert.match(html, /<p class="mk-asof">Nasdaq · LAST TRADE: \$342\.56 \(AS OF NOV 20, 2026\)<\/p>/);
  const chain = html.match(/<table class="mk-t mk-chain">[\s\S]*?<\/table>/)[0];
  assert.match(chain, /<td class="r mk-itm">\$5\.10<\/td>/, 'a dollar price, no dollars under it');
  assert.match(chain, /class="up">\+\$0\.45</);
  assert.doesNotMatch(html, /Prices in/);
  // ATM 345 against 342.56: the 345 put is in the money, the 340 call is
  assert.match(chain, /<tr class="mk-atm">/);
});

test("a ticker Nasdaq lists no options for: the market's sentence in place of the table, never a table that looks loading", () => {
  const { html } = chainPage('opt:BRK.A', { refusal: NO_OPTIONS });
  assert.match(html, /<h1 class="head-title">BRK\.A options<\/h1>/);
  assert.match(html, new RegExp(`<p class="mk-empty">${NO_OPTIONS.replace('.', '\\.')}</p>`));
  assert.doesNotMatch(html, /mk-chain"/);
  assert.doesNotMatch(html, /Loading/);
  // before it answers: Loading…
  assert.match(chainPage('opt:BRK.A').html, /<p class="mk-empty">Loading…<\/p>/);
});

test("an expiry or a venue picked: the kept chain of another is not drawn as this one's", () => {
  const { s } = chainPage('opt:BTC', { list: cryptoOptionsList(), chain: btcChain() });
  const picked = R.chainPicked(s, { underlying: 'BTC', expiry: '2026-11-28' });
  const query = MV.chainQueryOf(picked.markets, 'opt:BTC');
  assert.equal(query, 'underlying=BTC&venue=deribit&expiry=2026-11-28');
  const asking = R.chainLoading(picked, { query });
  const html = renderMarketsScreen(asking, NOW);
  assert.doesNotMatch(html, /mk-chain"/, "Nov 23's strikes are not drawn under Nov 28");
  assert.match(html, /<p class="mk-empty">Loading…<\/p>/);
  // a late answer for the expiry left behind lands nowhere
  const late = R.chainLoaded(asking, { query: 'underlying=BTC&venue=deribit', data: optionChainOf({ ok: true, value: btcChain() }), at: NOW });
  assert.equal(late, asking);
  assert.equal(R.chainFailed(asking, { query: 'underlying=BTC&venue=deribit', at: NOW, message: 'x' }), asking);
  // OKX picked: the expiry goes back to OKX's nearest
  const okx = R.chainPicked(picked, { underlying: 'BTC', venue: 'okx' });
  assert.equal(MV.chainQueryOf(okx.markets, 'opt:BTC'), 'underlying=BTC&venue=okx');
  // a coin OKX alone lists: OKX, no switch
  assert.equal(MV.chainQueryOf(chainPage('opt:HYPE', { list: cryptoOptionsList() }).s.markets, 'opt:HYPE'), 'underlying=HYPE&venue=okx');
  assert.doesNotMatch(chainPage('opt:HYPE', { list: cryptoOptionsList(), chain: { ...btcChain(), underlying: 'HYPE', venue: 'okx' } }).html, /optVenue/);
  // a deep link with no row: a coin at Deribit, anything else at Nasdaq
  assert.equal(MV.chainQueryOf(emptyState().markets, 'opt:ETH'), 'underlying=ETH&venue=deribit');
  assert.equal(MV.chainQueryOf(emptyState().markets, 'opt:TSLA'), 'underlying=TSLA&venue=nasdaq');
  // leaving the page drops the chain and the picks
  const left = R.chainDropped(okx);
  assert.deepEqual([left.markets.chain.query, left.markets.chainPick], [null, null]);
});

test("a US share's page carries Options, to its chain's page; a coin's does not", () => {
  const aapl = screen({ route: { screen: 'markets', id: 'stock:AAPL' }, account: true }).html;
  assert.match(aapl, /<a class="btn" href="#\/markets\/opt:AAPL">Options<\/a>/);
  assert.doesNotMatch(screen({ route: { screen: 'markets', id: 'coin:BTC' }, account: true }).html, /#\/markets\/opt:/);
  assert.match(withTable(ZH, () => screen({ route: { screen: 'markets', id: 'stock:AAPL' }, account: true }).html), /href="#\/markets\/opt:AAPL">期权<\/a>/);
  // the route keeps the chain's key
  assert.equal(R.nav(emptyState(), { screen: 'markets', id: 'opt:AAPL' }).route.id, 'opt:AAPL');
});

test('a search lists the option rows the market found for it, each named Options, opening its chain', () => {
  let s = R.setMarketsQuery(R.setMarketsTab(R.nav(emptyState(), { screen: 'markets', id: null }), 'stocks'), 'nvda');
  s = R.resultsLoaded(s, { data: { ...fx('explore-all'), items: [itemOf(fx('explore-all'), 'stock:NVDA')] }, at: NOW });
  s = R.optionHitsLoaded(s, { q: 'nvda', data: { ...usOptionsList(), items: usOptionsList().items.filter(i => i.base === 'NVDA') } });
  const html = renderMarketsScreen(s, NOW);
  assert.deepEqual(rowIds(html), ['stock:NVDA', 'opt:NVDA']);
  assert.match(rowOf(html, 'opt:NVDA'), /data-action="openMarket" data-id="opt:NVDA"/);
  assert.match(text(rowOf(html, 'opt:NVDA')), /NVDA options/);
  assert.match(rowOf(html, 'opt:NVDA'), /<span class="mk-tag">Options<\/span>/);
  // hits for another query are not this one's
  assert.ok(!rowIds(renderMarketsScreen(R.setMarketsQuery(s, 'nvd'), NOW)).includes('opt:NVDA'));
});
