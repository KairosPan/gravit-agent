// Markets on the face (spec 2026-10-22 §6.1): the Account's markets in one table — its tabs, its sorts, its search, each row's
// price by kind and where the price is from in the Account's own words — beside the face's A-share (cn:) rows, and a market's
// page from the Account's reads: its price and 24 hours, its facts, its price history for a range, its lines across venues,
// what is held, working and stated for it. A cn: page is the face's own quote. States are built with the reducers over the
// stand-in's answers (tests/fixtures/account/). No Buy, no Sell, no Trade: the hand order is stage 2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarketsScreen, mkAv } from '../../client/js/render/markets.js';
import { candlesSvg } from '../../client/js/render/chart.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { rowsOf, CANDLE_RANGES } from '../../client/js/host/market-view.js';
import { fmtClock, fmtDate, sameDay } from '../../client/js/time.js';

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
  cn = [], quotes = {}, connection = 'streaming', providers = [], watch = [], asked = {}, live = [], candles = null, account = false,
  conversations = [], watchError = null,
} = {}) {
  let s = R.nav(emptyState(), route);
  if (all) s = R.exploreLoaded(s, { tab: 'all', data: all, at: NOW });
  if (predictions) s = R.exploreLoaded(s, { tab: 'predictions', data: predictions, at: NOW });
  s = R.accountWatchLoaded(s, { items: watch, error: null });
  s = R.watchlistLoaded(s, { items: cn, error: watchError });
  for (const [faceId, key] of Object.entries(asked)) s = R.askedOfAccount(s, { faceId, key });
  s = R.quotesUpdated(s, { quotes, providers, status: connection, note: '实时连接已断开，正在读取备用报价。' });
  if (live.length) s = R.accountQuotesLoaded(s, { quotes: live });
  if (candles) s = R.candlesLoaded(s, { at: NOW, ...candles });
  if (account) {
    s = R.accountLoaded(s, { data: fx('account'), at: NOW });
    s = R.holdingsLoaded(s, { data: fx('holdings'), at: NOW });
    s = R.paperLoaded(s, { data: fx('holdings-paper'), at: NOW });
    s = R.statementLoaded(s, { data: fx('statement'), at: NOW });
  }
  if (tab) s = R.setMarketsTab(s, tab);
  if (q) s = R.setMarketsQuery(s, q);
  if (results) s = R.resultsLoaded(s, { data: results, at: NOW });
  if (sort) s = R.setMarketsSort(s, sort);
  if (conversations.length) s = { ...s, conversations };
  return { s, html: renderMarketsScreen(s, NOW) };
}
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
    ['perps', 'false', 'Perps · 6'], ['preipo', 'false', 'Pre-IPO · 1'], ['predictions', 'false', 'Predictions · 9'],
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
  assert.deepEqual(cells(rowOf(html, 'coin:DOGE')).slice(2).map(text), ['$0.1214', '▲up 12.40%', '$787M', 'Stand-in Public Exchange']);
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

test('a cn row beside the Account rows under Stocks; Not listed line with Remove for a missed star', () => {
  const cnState = (over = {}) => screen({ cn: [MOUTAI, ZED], asked: { 'us:ZZZZ': null }, quotes: { 'cn:600519': moutaiQuote() }, ...over });
  const stocks = cnState({ tab: 'stocks' }).html;
  // Stocks counts the A share; the Account's stocks first, then the face's, then the star the Account did not list
  assert.match(stocks, /data-value="all" aria-pressed="false">All · 31</);
  assert.match(stocks, /data-value="stocks" aria-pressed="true">Stocks · 5</);
  assert.match(stocks, /data-value="watching" aria-pressed="false">Watching</);
  assert.deepEqual(rowIds(stocks), ['stock:NVDA', 'stock:SPY', 'stock:AAPL', 'cn:600519', 'us:ZZZZ']);
  const [star, name, px, move, volume, source] = cells(rowOf(stocks, 'cn:600519'));
  assert.match(star, /^<button type="button" class="mk-star" data-action="toggleWatch" data-id="cn:600519" aria-pressed="true" aria-label="Stop watching Kweichow Moutai">/);
  assert.match(name, /data-action="openMarket" data-id="cn:600519"><span class="mk-av" aria-hidden="true">6005<\/span><span class="mk-nm"><b>Kweichow Moutai<\/b><span class="mk-sub">SH<\/span>/);
  assert.equal(px, '¥1,688.00');
  assert.equal(text(move), '▲up 0.48%');
  assert.equal(volume, '2M shares');
  assert.equal(text(source), 'iFinD', "the face's provider by its name, never the wire's own words");
  // the old star the Account could not find: Not listed, every figure a dash, Remove where the star would be, no page to open
  const zed = rowOf(stocks, 'us:ZZZZ');
  const z = cells(zed);
  assert.equal(z[0], '<button type="button" class="mk-clear" data-action="removeAsked" data-id="us:ZZZZ" aria-label="Remove Zed Corp">Remove</button>');
  assert.match(z[1], /^<span class="mk-who"><span class="mk-av" aria-hidden="true">Zed<\/span><span class="mk-nm"><b>Zed Corp<\/b><span class="mk-sub">Not listed at the Account<\/span><\/span><\/span>$/);
  assert.deepEqual(z.slice(2).map(text), ['—', '—', '—', '']);
  assert.doesNotMatch(zed, /mk-star|openMarket/);
  // the face's wire's connection word, only where a cn row is drawn
  assert.match(cnState({ tab: 'stocks', connection: 'polling' }).html, /<p class="mk-note">Updating every 15 s<\/p>/);
  assert.doesNotMatch(stocks, /mk-note/, 'streaming says nothing');
  assert.doesNotMatch(cnState({ tab: 'crypto', connection: 'polling' }).html, /Updating every 15 s/, 'no cn row on Crypto');
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

test('the page: no Buy, no Sell; the range seg; Across venues with best and Connect to trade; You hold and Open orders; On the statement', () => {
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
  // no Buy, no Sell, no Trade: the owner's hand order is the next stage
  for (const word of [/>Buy</, />Sell</, />Trade</, /data-action="(buy|sell|trade)/i]) assert.doesNotMatch(html, word, String(word));
  // the price now is the followed line's quote; its 24 hours and its volume the explore read's; where it is from, with its age
  assert.match(html, /<div class="mk-d-px"><span class="mk-big">\$62,510\.50<\/span><span class="up"><span aria-hidden="true">▲<\/span><span class="sr-only">up<\/span> 2\.30%<\/span><span class="mk-basis">24h<\/span><\/div>/);
  assert.match(html, /<p class="mk-asof">Stand-in Exchange · live · 1 min ago<\/p>/);
  assert.match(html, /<dl class="mk-facts"><div><dt>24h volume<\/dt><dd>\$2\.5B<\/dd><\/div><div><dt>Venues<\/dt><dd>4<\/dd><\/div><div><dt>Source<\/dt><dd>Stand-in Exchange · live · 1 min ago<\/dd><\/div><\/dl>/);
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
  // You hold: the coin across its venues; Open orders: the one still working at its lines, the canceled one not
  assert.deepEqual(linesOf(section(html, 'You hold')).map(text), ['·0.124 BTC · $7,747.40']);
  assert.deepEqual(linesOf(section(html, 'Open orders')).map(text), ['·Stand-in Exchange · Sell 0.002 BTC/USDT · limit 63,226.6 · open · You']);
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
  // before the Account's page is read, nothing is said of what is held, working or stated: no claim it did not read
  const unread = page('coin:BTC', { account: false }).html;
  assert.match(unread, /aria-label="Across venues"/);
  assert.doesNotMatch(unread, /You hold|Open orders|On the statement|You don’t hold any/);

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
  assert.deepEqual(linesOf(section(nvda.html, 'You hold')).map(text), ['·2 NVDA · $364.80']);
  assert.equal(section(nvda.html, 'Open orders'), '', 'nothing working: no section');
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
  assert.match(section(fed.html, 'You hold'), /Stand-in Predictions · long 50 SI-FEDCUT-DEC:YES · <span class="down">-\$0\.50<\/span>/);
  const fill = linesOf(section(fed.html, 'On the statement'));
  assert.equal(fill.length, 1);
  assert.match(fill[0], /^<span class="mk-mark ok">✓<\/span>/);
  assert.match(text(fill[0]), /Buy 50 SI-FEDCUT-DEC:YES · Will the Fed cut rates at its December meeting\? · Yes · market · at 0\.63 · -\$31\.50filled · You$/);
  for (const word of [/>Buy</, />Sell</, />Trade</, />Buy Yes</]) assert.doesNotMatch(fed.html, word, String(word));

  // a cn page is the face's own quote: no venues, no chart, nothing held through the Account
  const cn = screen({ route: { screen: 'markets', id: 'cn:600519' }, cn: [MOUTAI], quotes: { 'cn:600519': moutaiQuote() }, account: true, conversations: [conv('s3', { title: '600519 into the close' })] }).html;
  assert.match(cn, /<h1 class="head-title">Kweichow Moutai<\/h1><span class="mk-sub">A-share · 600519 · SH<\/span>/);
  assert.match(cn, /<span class="mk-big">¥1,688\.00<\/span><span class="up">[\s\S]*?0\.48%<\/span><span class="mk-basis">vs previous close<\/span>/);
  assert.match(cn, /class="mk-asof">as of \d\d:\d\d · Live</);
  assert.match(cn, /<dt>Previous close<\/dt><dd>¥1,680\.00<\/dd>/);
  assert.match(cn, /<dt>Volume<\/dt><dd>2M shares<\/dd>/);
  assert.match(cn, /<dt>Source<\/dt><dd>iFinD<\/dd>/);
  assert.match(cn, /class="btn mk-on" data-action="toggleWatch" data-id="cn:600519" aria-pressed="true">/);
  assert.match(cn, /data-action="handToGravit" data-id="cn:600519"/);
  assert.match(section(cn, 'Gravit on it'), /600519 into the close/);
  assert.doesNotMatch(cn, /Price history|Across venues|You hold|On the statement|mk-chart/);
  // a key no read lists, and an old face id, are no page: the table
  assert.match(page('coin:GONE').html, /^<main class="main mkts">/);
  assert.match(page('us:AAPL').html, /^<main class="main mkts">/);
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
  const providers = [{ id: 'ifind', market: 'cn', status: 'unconfigured', source: '同花顺', feed: '', transport: 'poll', message: 'A 股行情待配置 iFinD 凭据' }];
  const base = {
    all, predictions, cn: [MOUTAI, ZED], asked: { 'us:ZZZZ': null }, quotes: { 'cn:600519': moutaiQuote({ quote_status: 'stale' }) }, providers,
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
    assert.doesNotMatch(html, CJK);
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
  // a read that failed before it ever answered says so, and the Account's sentence when it refused
  const failed = R.exploreFailed(R.nav(emptyState(), { screen: 'markets', id: null }), { tab: 'all', at: NOW, message: null });
  assert.match(renderMarketsScreen(failed, NOW), /<p class="mk-empty">Markets unavailable<\/p>/);
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

test('a market route keeps an Account key whole and canonicalises a face id', () => {
  const nav = id => R.nav(emptyState(), { screen: 'markets', id }).route;
  assert.deepEqual(nav('event:predict:SI-FEDCUT-DEC'), { screen: 'markets', id: 'event:predict:SI-FEDCUT-DEC' });
  assert.deepEqual(nav('coin:BTC'), { screen: 'markets', id: 'coin:BTC' });
  assert.deepEqual(nav('us:aapl'), { screen: 'markets', id: 'us:AAPL' });
  assert.deepEqual(nav('crypto:btc-usd'), { screen: 'markets', id: 'crypto:BTC/USD' });
  assert.deepEqual(nav('garbage'), { screen: 'markets', id: null });
});
