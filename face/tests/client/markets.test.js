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
import { rowsOf, CANDLE_RANGES } from '../../client/js/host/market-view.js';
import { fmtClock, fmtDate, sameDay } from '../../client/js/time.js';
import { createStore } from '../../client/js/store.js';
import { startMarkets } from '../../client/js/host/markets.js';
import { getJsonVia } from '../../client/js/app.js';

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
  conversations = [], watchError = null, role = null, here,
} = {}) {
  let s = R.nav(emptyState(), route);
  if (all) s = R.exploreLoaded(s, { tab: 'all', data: all, at: NOW });
  if (predictions) s = R.exploreLoaded(s, { tab: 'predictions', data: predictions, at: NOW });
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
  if (tab) s = R.setMarketsTab(s, tab);
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

test('the table: the Account tabs, rows with source words, cents for an event, contracts for Kalshi, Closed past end', () => {
  const { s, html } = screen({
    all: withEvents(),
    // the latest quote at NVDA's broker: its price leads the row; its own 24 hours and volume do not
    live: [{ venue: 'broker', symbol: 'NVDA', market: { price: 183.1, bid: 183.05, ask: 183.15, quoteAt: ago(90_000), quoteFrom: 'Stand-in Broker · real time', changePct24h: 9.9, volumeUsd24h: 1 } }],
  });
  assert.match(html, /^<main class="main mkts">/);
  assert.match(html, /<h1 class="head-title">Markets<\/h1>/);
  assert.match(html, /id="mq" type="search" autocomplete="off" placeholder="Search markets" data-action="mkQuery" value=""/);
  // the Account's tabs in its order, each with its count; nothing starred and nothing searched: no Watching, no All results
  const tabs = [...html.matchAll(/<button type="button" class="mk-tab" data-action="mkTab" data-value="([^"]+)" aria-pressed="(true|false)">([^<]+)<\/button>/g)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(tabs, [
    ['all', 'true', 'All · 30'], ['crypto', 'false', 'Crypto · 6'], ['stocks', 'false', 'Stocks · 4'], ['rwas', 'false', 'RWAs · 4'],
    ['perps', 'false', 'Perps · 6'], ['preipo', 'false', 'Pre-IPO · 1'], ['predictions', 'false', 'Predictions · 9'], ['china', 'false', 'China'], ['desk', 'false', 'Desk'],
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
  assert.match(rowOf(html, 'perp:BTC'), /<span class="mk-av" aria-hidden="true">BTC<\/span><span class="mk-nm"><b>BTC perpetual<\/b><span class="mk-sub">BTC · Perpetual<\/span>/);
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
  const events = screen({ predictions, tab: 'predictions' });
  assert.match(events.html, /data-value="predictions" aria-pressed="true">Predictions · 9</);
  assert.deepEqual(sortsOf(events.html), [['volume', 'Most traded'], ['movers', 'Biggest moves'], ['closing', 'Closing soonest']]);
  const closing = screen({ predictions, tab: 'predictions', sort: 'closing' });
  assert.match(closing.html, /class="seg-item pressed" aria-pressed="true" data-action="mkSort" data-value="closing">Closing soonest</);
  assert.deepEqual(rowIds(closing.html).slice(0, 2), ['event:predict:SI-BTC15-2610220730', 'event:paper-momentum:SX-YIELD-FRI']);
  assert.equal(rowIds(screen({ predictions, tab: 'predictions', sort: 'movers' }).html)[0], 'event:predict:SI-ETH-WEEK', 'its 6¢ the biggest move');
  // All with an event among its rows offers it too
  assert.deepEqual(sortsOf(screen({ all: withEvents() }).html).map(x => x[0]), ['volume', 'movers', 'closing']);
  // one row needs no sort
  const one = fx('explore-all');
  one.items = one.items.slice(0, 1);
  assert.doesNotMatch(screen({ all: one }).html, /data-action="mkSort"/);
});

test('a cn row beside the Account rows under All, not under Stocks; Not listed line with Remove for a missed star', () => {
  const cnState = (over = {}) => screen({ cn: [MOUTAI, ZED], asked: { 'us:ZZZZ': null }, quotes: { 'cn:600519': moutaiQuote() }, ...over });
  const stocks = cnState({ tab: 'stocks' }).html;
  // Stocks is the Account's alone (China is the A shares' home); All counts the A share; the star the Account did not list stays
  assert.match(stocks, /data-value="all" aria-pressed="false">All · 31</);
  assert.match(stocks, /data-value="stocks" aria-pressed="true">Stocks · 4</);
  assert.match(stocks, /data-value="watching" aria-pressed="false">Watching</);
  assert.deepEqual(rowIds(stocks), ['stock:NVDA', 'stock:SPY', 'stock:AAPL', 'us:ZZZZ']);
  const all = cnState().html;
  const [star, name, px, move, volume, source] = cells(rowOf(all, 'cn:600519'));
  assert.match(star, /^<button type="button" class="mk-star" data-action="toggleWatch" data-id="cn:600519" aria-pressed="true" aria-label="Stop watching Kweichow Moutai">/);
  assert.match(name, /data-action="openMarket" data-id="cn:600519"><span class="mk-av" aria-hidden="true">K<\/span><span class="mk-nm"><b>Kweichow Moutai<\/b><span class="mk-sub">600519 · SH<\/span>/);
  assert.equal(px, '¥1,688.00');
  assert.equal(text(move), '▲up 0.48%');
  assert.equal(volume, '2M shares');
  assert.equal(text(source), 'Tencent', "the face's provider by its name, never the wire's own words");
  // the old star the Account could not find: Not listed, every figure a dash, Remove where the star would be, no page to open
  const zed = rowOf(stocks, 'us:ZZZZ');
  const z = cells(zed);
  assert.equal(z[0], '<button type="button" class="mk-clear" data-action="removeAsked" data-id="us:ZZZZ" aria-label="Remove Zed Corp">Remove</button>');
  assert.match(z[1], /^<span class="mk-who"><span class="mk-av" aria-hidden="true">Zed<\/span><span class="mk-nm"><b>Zed Corp<\/b><span class="mk-sub">Not listed at the Account<\/span><\/span><\/span>$/);
  assert.deepEqual(z.slice(2).map(text), ['—', '—', '—', '']);
  assert.doesNotMatch(zed, /mk-star|openMarket/);
  // the A shares' quotes read's state, only where a cn row is drawn: polling, as it always is, says nothing; a failed read is said
  assert.match(cnState({ connection: 'error' }).html, /<p class="mk-note">Quotes unavailable<\/p>/);
  assert.doesNotMatch(cnState().html, /mk-note/, 'polling says nothing');
  assert.doesNotMatch(stocks, /mk-note/);
  assert.doesNotMatch(cnState({ tab: 'crypto', connection: 'error' }).html, /Quotes unavailable/, 'no cn row on Crypto');
  assert.match(cnState({ tab: 'stocks', watchError: 'full' }).html, /<p class="mk-note">The watchlist is full<\/p>/);
  // Watching: every star — the Account's found in the read, a key no read lists as a placeholder, the A share, the Not listed line
  const watching = cnState({ watch: ['coin:BTC', 'kalshi:KXGONE-26'], tab: 'watching' }).html;
  assert.match(watching, /data-value="watching" aria-pressed="true">Watching</);
  assert.deepEqual(rowIds(watching), ['coin:BTC', 'kalshi:KXGONE-26', 'cn:600519', 'us:ZZZZ']);
  assert.match(rowOf(watching, 'coin:BTC'), /data-id="coin:BTC" aria-pressed="true" aria-label="Stop watching BTC"/);
  const gone = rowOf(watching, 'kalshi:KXGONE-26');
  assert.match(cells(gone)[0], /^<button type="button" class="mk-star" data-action="toggleWatch" data-id="kalshi:KXGONE-26" aria-pressed="true"/);
  assert.match(gone, /<span class="mk-who"><span class="mk-av" aria-hidden="true">KXGO<\/span><span class="mk-nm"><b>KXGONE-26<\/b><span class="mk-sub">Not in this read<\/span>/);
  assert.deepEqual(cells(gone).slice(2).map(text), ['—', '—', '—', '']);
  assert.doesNotMatch(gone, /openMarket/, 'no read lists it: no page');
});

test("Watching is the Account's list and the face's: a row watched at the Account alone reads Watched at the Account under its star", () => {
  const AT = '<span class="mk-at">Watched at the Account</span>';
  // the page watches ex BTC/USDT and DOGE/USD at standin-pubex; the face's list has AAPL and BTC
  const watching = screen({ account: true, watch: ['stock:AAPL', 'coin:BTC'], cn: [MOUTAI], tab: 'watching' }).html;
  assert.deepEqual(rowIds(watching), ['stock:AAPL', 'coin:BTC', 'coin:DOGE', 'cn:600519']);
  const doge = cells(rowOf(watching, 'coin:DOGE'))[0];
  assert.equal(doge, `<button type="button" class="mk-star" data-action="toggleWatch" data-id="coin:DOGE" aria-pressed="true" aria-label="Stop watching DOGE">${doge.match(/<svg[\s\S]*<\/svg>/)[0]}</button>${AT}`);
  for (const id of ['stock:AAPL', 'coin:BTC', 'cn:600519']) assert.doesNotMatch(rowOf(watching, id), /Watched at the Account/, `${id}: on the face's list`);
  // All: the page's rows starred, the tab drawn for the page's list alone
  const all = screen({ account: true }).html;
  assert.match(all, /data-value="watching" aria-pressed="false">Watching</);
  assert.match(cells(rowOf(all, 'coin:BTC'))[0], /aria-pressed="true" aria-label="Stop watching BTC">[\s\S]*Watched at the Account/);
  assert.match(cells(rowOf(all, 'coin:ETH'))[0], /aria-pressed="false"/);
  assert.doesNotMatch(cells(rowOf(all, 'coin:ETH'))[0], /mk-at/);
  // no page: no Watching tab, no star on
  const none = screen().html;
  assert.doesNotMatch(none, /data-value="watching"/);
  assert.doesNotMatch(none, /mk-at|aria-pressed="true" aria-label="Stop watching/);
  // a market's page reads it watched
  const pageHtml = screen({ account: true, route: { screen: 'markets', id: 'coin:DOGE' } }).html;
  assert.match(pageHtml, /data-action="toggleWatch" data-id="coin:DOGE" aria-pressed="true">[\s\S]*?Watching<\/button>/);
  // a refusal at the Account is its own sentence under the table
  const s = R.accountWatchLoaded(screen({ account: true }).s, { items: [], error: 'ETH/USDT is not listed at Stand-in Exchange.' });
  assert.match(renderMarketsScreen(s, NOW), /<p class="mk-note">ETH\/USDT is not listed at Stand-in Exchange\.<\/p>/);
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
  assert.match(html, /<button type="button" class="btn" data-action="handToGravit" data-id="coin:BTC">[\s\S]*?Hand to Gravit<\/button>/);
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
  // Gravit on it: the conversations that name its base as a word
  const gravit = section(html, 'Gravit on it');
  assert.match(gravit, /<a class="mk-line" href="#\/messages\/s1" data-action="open" data-id="s1">[\s\S]*?Is BTC breaking out\?/);
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
    '·Stand-in Broker · NVDA · $182.40 Best', '·Momentum · paper · NVDA · $182.40 Paper', '·Stand-in · 15 min delayed · NVDA · $182.40Connect to trade',
  ]);
  assert.deepEqual(linesOf(section(nvda.html, 'You here')).map(text), ['·2 NVDA · $364.80cost known for 0 of 2 NVDA'], 'nothing working: no order line');
  // what the paper accounts hold of it is its own line, marked Paper, with the paper cost: a sheet with no real row
  const papered = page('stock:NVDA', { here: { ok: true, key: 'equity:NVDA', positions: [], orders: [], lines: [], cost: [], missing: [],
    paper: { row: { key: 'equity:NVDA', asset: 'NVDA', class: 'equity', amount: 3, usd: 547.2 }, positions: [], cost: [{ key: 'equity:NVDA', words: 'cost known for 3 of 3 NVDA' }] } } });
  assert.deepEqual(linesOf(section(papered.html, 'You here')).map(text), ['·3 NVDA · $547.20 Papercost known for 3 of 3 NVDA']);
  assert.match(section(nvda.html, 'On the statement'), /<p class="mk-empty">Nothing on the statement about it yet\.<\/p>/);
  assert.equal(section(nvda.html, 'Gravit on it'), '');
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
  const fed = page('event:predict:SI-FEDCUT-DEC', { predictions: fx('explore-predictions'), tab: 'predictions' });
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
  assert.match(section(cn, 'Gravit on it'), /600519 into the close/);
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
  // BTC is held: Buy and Sell before Hand to Gravit and Watch
  const btc = keys(page('coin:BTC'));
  assert.ok(btc.startsWith(`<div class="mk-d-acts">${buy('coin:BTC')}${sell('coin:BTC')}<button type="button" class="btn" data-action="handToGravit"`), btc);
  // DOGE is not held: Buy alone
  const doge = keys(page('coin:DOGE'));
  assert.ok(doge.includes(buy('coin:DOGE')), doge);
  assert.doesNotMatch(doge, /data-side="sell"/);
  // a prediction held as a position
  const fed = keys(page('event:predict:SI-FEDCUT-DEC', { predictions: fx('explore-predictions'), tab: 'predictions' }));
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
  const fed = screen({ route: { screen: 'markets', id: 'event:predict:SI-FEDCUT-DEC' }, predictions: fx('explore-predictions'), tab: 'predictions', candles: { id: 'event:predict:SI-FEDCUT-DEC', range: '5D', data: read } }).html;
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
    screen(base), screen({ ...base, tab: 'stocks' }), screen({ ...base, tab: 'watching' }), screen({ ...base, tab: 'predictions' }),
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

test('empty states: Loading… before a read, No markets for an empty answer, Nothing watched yet; a refusal keeps its rows; the search line', () => {
  const unread = screen({ all: null }).html;
  assert.match(unread, /<p class="mk-empty">Loading…<\/p>/);
  // a count is the Account's: none is drawn before its read
  assert.match(unread, /data-value="all" aria-pressed="true">All<\/button>/);
  const none = fx('explore-all');
  none.items = [];
  assert.match(screen({ all: none }).html, /<p class="mk-empty">No markets<\/p>/);
  assert.match(screen({ tab: 'watching' }).html, /<p class="mk-empty">Nothing watched yet<\/p>/);
  // a read that failed before it ever answered says so, and the Account's sentence over that when it refused
  const failed = R.exploreFailed(R.nav(emptyState(), { screen: 'markets', id: null }), { tab: 'all', at: NOW, message: null });
  assert.match(renderMarketsScreen(failed, NOW), /<p class="mk-empty">Markets unavailable<\/p>/);
  const busy0 = R.exploreFailed(R.nav(emptyState(), { screen: 'markets', id: null }), { tab: 'all', at: NOW, message: 'The account is busy: try again in a moment' });
  const before = renderMarketsScreen(busy0, NOW);
  assert.match(before, /<p class="mk-note">The account is busy: try again in a moment<\/p><p class="mk-empty">Markets unavailable<\/p>/);
  assert.match(before, /data-value="all" aria-pressed="true">All<\/button>/, 'no count it never read');
  // a refusal after an answer: the last rows stay, the Account's own sentence over them
  const refused = R.exploreFailed(screen().s, { tab: 'all', at: NOW, message: 'The account is busy: try again in a moment' });
  const kept = renderMarketsScreen(refused, NOW);
  assert.equal(rowIds(kept).length, 12);
  assert.match(kept, /<p class="mk-note">The account is busy: try again in a moment<\/p>/);
  // the search: its rows, how many for what, Clear; All results leads the tabs; Searching… until anything answers
  const found = screen({ q: 'fed', results: fx('explore-predictions') }).html;
  assert.match(found, /<p class="mk-q">9 markets for “fed” <button type="button" class="mk-clear" data-action="mkClear">Clear<\/button><\/p>/);
  assert.match(found, /^[\s\S]*?<div class="mk-tabs" role="group" aria-label="Markets"><button type="button" class="mk-tab" data-action="mkTab" data-value="results" aria-pressed="true">All results<\/button>/);
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
  assert.match(rowOf(found, 'cn:600519'), /<span class="mk-sub">600519 · SH<\/span>/, 'drawn as an A share, not as an Account row');
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

test("an event's page finds the conversations that name it by its name, as Hand to Gravit names it", () => {
  const fed = 'Will the Fed cut rates at its December meeting?';
  const html = screen({
    route: { screen: 'markets', id: 'event:predict:SI-FEDCUT-DEC' }, predictions: fx('explore-predictions'), tab: 'predictions',
    conversations: [conv('s1', { title: `${fed} The odds into the meeting` }), conv('s2', { title: 'SI-FEDCUT-DEC sizing' })],
  }).html;
  const gravit = section(html, 'Gravit on it');
  assert.match(gravit, /<a class="mk-line" href="#\/messages\/s1" data-action="open" data-id="s1">/);
  assert.doesNotMatch(gravit, /s2/);
});

test('a kept sort the rows no longer offer gives way to Most traded: the seg presses it and the rows follow it', () => {
  // Closing soonest kept on Watching, whose two rows close never: LINK starred first, NVDA traded most
  const watching = R.setMarketsTab(screen({ watch: ['coin:LINK', 'stock:NVDA'] }).s, 'watching');
  const kept = R.setMarketsSort(watching, 'closing');
  assert.equal(kept.markets.sort, 'closing', 'the slice keeps the choice');
  const html = renderMarketsScreen(kept, NOW);
  assert.match(html, /<button type="button" class="seg-item pressed" aria-pressed="true" data-action="mkSort" data-value="volume">Most traded<\/button>/);
  assert.doesNotMatch(html, /data-value="closing"/);
  assert.deepEqual(rowIds(html), ['stock:NVDA', 'coin:LINK']);
});

test("the Account's sentence comes from the read the rows are from", () => {
  // Crypto's own read still on its way: its rows are All's, and All's refusal is said over them
  const crypto = R.setMarketsTab(screen().s, 'crypto');
  const waiting = R.exploreLoading(R.exploreFailed(crypto, { tab: 'all', at: NOW, message: 'All refused' }), { tab: 'crypto' });
  const html = renderMarketsScreen(waiting, NOW);
  assert.deepEqual(rowIds(html), ['coin:BTC', 'coin:ETH', 'coin:DOGE', 'coin:SOL', 'coin:LINK']);
  assert.match(html, /<p class="mk-note">All refused<\/p>/);
  // once Crypto's own read answers, the rows are its own, and so is the state said over them
  const coins = { ...fx('explore-all'), items: fx('explore-all').items.filter(i => i.kind === 'coin') };
  assert.doesNotMatch(renderMarketsScreen(R.exploreLoaded(waiting, { tab: 'crypto', data: coins, at: NOW }), NOW), /All refused/);
});

test("the Account's words are text, never markup: a name, a venue, a category, a sentence and a note with tags in them", () => {
  const all = fx('explore-all');
  const btc = itemOf(all, 'coin:BTC');
  btc.name = '<i>BTC</i> & "co"';
  btc.at[0].venueName = '<b>Stand-in</b> Exchange';
  all.items.push({ ...paris(), category: '<script>x</script>' });
  const candles = { id: 'coin:BTC', range: '1D', data: { ...fx('candles'), note: '<img src=x onerror=alert(1)>' } };
  const table = screen({ all, candles });
  const refused = renderMarketsScreen(R.exploreFailed(table.s, { tab: 'all', at: NOW, message: '<u>busy</u> & "later"' }), NOW);
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

test('a market route keeps an Account key whole and canonicalises a face id', () => {
  const nav = id => R.nav(emptyState(), { screen: 'markets', id }).route;
  assert.deepEqual(nav('event:predict:SI-FEDCUT-DEC'), { screen: 'markets', id: 'event:predict:SI-FEDCUT-DEC' });
  assert.deepEqual(nav('coin:BTC'), { screen: 'markets', id: 'coin:BTC' });
  assert.deepEqual(nav('us:aapl'), { screen: 'markets', id: 'us:AAPL' });
  assert.deepEqual(nav('crypto:btc-usd'), { screen: 'markets', id: 'crypto:BTC/USD' });
  assert.deepEqual(nav('garbage'), { screen: 'markets', id: null });
});

// ── the China tab and the A-share page (spec 2026-10-31) ──

const RANK = { ok: true, sort: 'volume', total: 5577, asOf: '2026-10-31T06:46:10Z', session: { phase: 'closed', lastSession: '2026-10-30' }, items: [
  { id: 'cn:300502', symbol: '300502', name: '新易盛', price: 196, change_pct: -14.19, turnover: 21_607_600_000 },
  { id: 'cn:688825', symbol: '688825', name: '长鑫科技', price: 41.8, change_pct: -2.5, turnover: 12_145_020_000 }] };
function chinaScreen(rank = s => R.rankLoaded(s, { sort: 'volume', data: RANK, at: NOW })) {
  const s = rank(R.setMarketsTab(screen().s, 'china'));
  return { s, html: renderMarketsScreen(s, NOW) };
}

test("the China table: Today and Turnover in its header, a row's cells, the closed line", () => {
  const { html } = chinaScreen();
  assert.match(html, /data-value="china" aria-pressed="true">China · 5,577</);
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

test('China as last read: the Account not answering is said over the kept rows; a stale read of its own in its words', () => {
  // the proxy re-served the kept ranking flagged stale: the Account is not answering, and the rows are never drawn bare
  const asLast = chinaScreen(s => R.rankLoaded(s, { sort: 'volume', data: { ...RANK, stale: true, status: { state: 'live', said: '' } }, at: NOW })).html;
  assert.deepEqual(rowIds(asLast), ['cn:300502', 'cn:688825']);
  assert.match(asLast, /<p class="mk-note">Closed · 10-30 15:00 Beijing<\/p><p class="mk-note">The Account is not answering · China as last read<\/p>/);
  // the Account answering that Tencent's ranking is stale: its own words, not the face's
  const said = chinaScreen(s => R.rankLoaded(s, { sort: 'volume', data: { ...RANK, stale: true, status: { state: 'stale', said: 'Tencent has not answered since 14:52' } }, at: NOW })).html;
  assert.match(said, /<p class="mk-note">Tencent has not answered since 14:52<\/p>/);
  assert.doesNotMatch(said, /The Account is not answering/);
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
  const s = R.rankFailed(R.setMarketsSort(R.rankLoaded(R.setMarketsTab(screen().s, 'china'), { sort: 'volume', data: RANK, at: NOW }), 'movers'), { sort: 'movers', at: NOW });
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
  assert.match(section(page('event:predict:SI-FEDCUT-DEC', { predictions: fx('explore-predictions'), tab: 'predictions' }), 'You here'), /data-kind="close" data-venue="predict"[^>]*>Sell…<\/button>/);
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
  assert.match(section(draw(depthOf(base, 'coin:BTC', 'trades', fx('trades'))), 'Latest trades'), /<p class="mk-empty">Stand-in Exchange publishes no trades the account can read<\/p>/);

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
      case '/data/account/explore': return json(fx('explore-all'));
      case '/data/account/candles': return json({ ...fx('candles'), venue: q.get('venue'), symbol: q.get('symbol'), range: q.get('range') });
      case '/data/account/compare': return json({ ...fx('compare'), base: q.get('base') });
      case '/data/account/quotes': return json({ ok: true, quotes: [] });
      case '/data/account/asset': return json(fx('asset-btc'));
      case '/data/account/book': return new Response('<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Error</title></head><body><pre>Cannot GET /api/account/book</pre></body></html>\n',
        { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
      case '/data/account/trades': return json({ ok: false, unreachable: 'ECONNREFUSED' }, 503);
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
    // the book and the trades are unavailable, with no words of the face's error in their place
    assert.match(section(html, 'Order book'), /<div class="mk-h2">Order book<\/div><p class="mk-empty">Order book unavailable<\/p><\/section>/);
    assert.match(section(html, 'Latest trades'), /<div class="mk-h2">Latest trades<\/div><p class="mk-empty">Trades unavailable<\/p><\/section>/);
    assert.doesNotMatch(html, /Cannot GET|DOCTYPE|ECONNREFUSED|HTTP 404|HTTP 503|SyntaxError/);
    markets.close();
  } finally {
    Object.assign(console, saved);
  }
  assert.deepEqual(errors, [], 'no parse error reaches the console');
});

// ---- the Desk tab and a level's marks (plan 2026-11-01-desk-p3-watch Task 11)

test('the Desk tab is listed last; on it the desk view is drawn in place of the table, with one Pause and no Resume', async () => {
  const { deskStatus, DESK_NOW } = await import('./helpers/desk-status.js');
  const { s } = screen({ tab: 'desk' });
  const html = renderMarketsScreen(R.deskLoaded(s, { data: deskStatus(), at: DESK_NOW }), DESK_NOW);
  const tabs = [...html.matchAll(/data-action="mkTab" data-value="([^"]+)" aria-pressed="(true|false)"/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(tabs.at(-1), ['desk', 'true']);
  assert.doesNotMatch(html, /<table class="mk-t">/, 'no market table on the Desk tab');
  const t = text(html);
  for (const words of [
    'up 3h 5m since 2026-11-02T11:55:00.000Z · desk on', 'watch: watching',
    'watch US: polling the 2026-11-02 session, 2 symbols, last poll 09:59 ET', 'alerts today (US): 1 sent, 1 suppressed (cap 1)',
    'watch A shares: the 2026-11-02 session has closed', 'alerts today (A shares): 1 sent, 1 suppressed (muted 1)',
    'filings: off: set ALPHA_EDGAR_USER_AGENT', 'alerts: muted until 11:00 ET (npm run desk -- unmute)',
    'NVDA stop · 169.8 ROBINHOOD', '1.8 s', 'suppressed (cap)', 'stop 170 · -1.30%', 'sell half on a close below 170',
    'desk/levels.yml', '1 of 3 refused: #3 TSLA: price must be a positive number', 'next 2026-11-03 09:20 ET', 'pid 4000', 'lost', '20 min',
  ]) assert.ok(t.includes(words), words);
  assert.equal((html.match(/data-action="deskPause"/g) ?? []).length, 1, 'one Pause');
  assert.doesNotMatch(html, /Resume/);
  // before the status lands: Loading…; a failed read with nothing kept: unavailable with its message; a failed read over a
  // view kept: the view, under the message
  assert.match(renderMarketsScreen(s, NOW), /<p class="mk-empty">Loading…<\/p>/);
  const failed = R.deskFailed(s, { at: NOW, message: '/data/desk/status: HTTP 503' });
  assert.match(renderMarketsScreen(failed, NOW), /Desk status unavailable/);
  const kept = R.deskFailed(R.deskLoaded(s, { data: deskStatus(), at: DESK_NOW }), { at: DESK_NOW, message: '/data/desk/status: HTTP 503' });
  const keptHtml = renderMarketsScreen(kept, DESK_NOW);
  assert.ok(text(keptHtml).includes('/data/desk/status: HTTP 503'));
  assert.ok(text(keptHtml).includes('watch: watching'));
});

test('a marked row draws its mark after its name; a page draws the plan and file under its price', async () => {
  const { deskStatus, DESK_NOW } = await import('./helpers/desk-status.js');
  const withDesk = st => R.deskLoaded(st, { data: deskStatus(), at: DESK_NOW });
  const { s } = screen({ cn: [MOUTAI], quotes: { 'cn:600519': moutaiQuote() } });
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

test('a level, an alert and a file the operator wrote are text, never markup: on the row, the page and the Desk tab', async () => {
  const { deskStatus, DESK_NOW } = await import('./helpers/desk-status.js');
  const EVIL = '<img src=x onerror=alert(1)>';
  const st = deskStatus();
  st.watch.marks[0] = { ...st.watch.marks[0], kind: EVIL, level: EVIL, plan: EVIL, file: EVIL };
  st.watch.recent[0] = { ...st.watch.recent[0], symbol: EVIL, label: EVIL, feed: EVIL, suppressed: EVIL, outcome: 'suppressed' };
  st.watch.files[0] = { ...st.watch.files[0], file: EVIL, refusals: [{ file: EVIL, index: 0, symbol: EVIL, reason: EVIL }] };
  st.standing.orders[0] = { ...st.standing.orders[0], id: EVIL, at: EVIL };
  const withDesk = x => R.deskLoaded(x, { data: st, at: DESK_NOW });
  const table = renderMarketsScreen(withDesk(screen().s), NOW);
  const page = renderMarketsScreen(withDesk(screen({ route: { screen: 'markets', id: 'stock:NVDA' }, account: true }).s), NOW);
  const desk = renderMarketsScreen(withDesk(screen({ tab: 'desk' }).s), DESK_NOW);
  for (const [name, html] of [['row', rowOf(table, 'stock:NVDA')], ['page', page], ['desk', desk]]) {
    assert.doesNotMatch(html, /<img/, `${name}: no markup`);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, `${name}: the text, escaped`);
  }
});
