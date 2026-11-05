// Trade's views (spec 2026-10-22 §6.4, plan 2 Task 9) over the stand-in's answers (tests/fixtures/account/): the picker's
// groups by kind — what is held, what is starred, the kind's most traded, a search's results; the ticket on a market's lines,
// the best marked, the public listings after; the Account's liveOrder draft from the ticket's fields (the owner-path map
// §3.1 — its type and fifteen fields, nothing added, a prediction's limit typed in cents and sent in dollars, no clock; prepare
// adds the two that make the seventeen it signs); the quote from a
// preparation; the orders under way with what cancels each; a fill as words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRADE_KIND_IDS, tradeKinds, tradeableOf, pickerOf, ticketOf, tradeFieldsOf, tradeDraftOf, quoteOf, underWayOf, fillWords, eventPriceOf,
} from '../../client/js/host/trade-view.js';
import { accountTabs } from '../../client/js/host/market-view.js';
import { fieldsOf, draftOf } from '../../client/js/host/sheet-view.js';
import { emptyState } from '../../client/js/data/empty.js';

// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const read = data => ({ status: 'ready', data, at: 1 });
const NOW = Date.parse('2026-10-22T07:40:00.000Z');
// a kind's picks as the explore read `tab=<kind>&limit=12` answers: All's items of that kind
const picksOf = (all, kind) => ({ ...all, items: all.items.filter(i => i.tabs.includes(kind)) });
const LIVE_ORDER_KEYS = ['type', 'venue', 'symbol', 'side', 'orderType', 'qty', 'limitPrice', 'stopPrice', 'tif', 'postOnly', 'reduceOnly',
  'extendedHours', 'trailPercent', 'trailPrice', 'takeProfit', 'stopLoss'];

// the face with the Account's page, its holdings and the reads Trade keeps: All's explore read on Markets, the crypto and
// predictions picks
function stateWith({ kind = 'crypto', q = '', results = null, watch = [], ticket = null, page = fx('account'), all = fx('explore-all') } = {}) {
  const s = emptyState();
  return {
    ...s,
    markets: { ...s.markets, explore: { all: read(all) }, watch },
    account: { ...s.account, status: 'ready', data: page, holdings: read(fx('holdings')) },
    trade: {
      ...s.trade, kind, q,
      picks: { crypto: read(picksOf(all, 'crypto')), predictions: read(fx('explore-predictions')) },
      results: results ? read(results) : s.trade.results,
      ticket,
    },
  };
}
const ids = rows => rows.map(r => r.id);
const venueCan = (page, id, can) => ({ ...page, venues: page.venues.map(v => (v.id === id ? { ...v, trade: { ...v.trade, can } } : v)) });
// the plain form as the trade host opens the sheet with it, each named value set
const form = over => ({ venue: 'ex', side: 'buy', outcome: '0', amount: '25', unit: 'usd', orderType: 'market', limit: '', extendedHours: false, ...over });

test('tradeKinds: the Account\'s crypto, stocks, RWAs and predictions tabs, its own ids and words', () => {
  assert.deepEqual(TRADE_KIND_IDS, ['crypto', 'stocks', 'rwas', 'predictions']);
  assert.deepEqual(tradeKinds(), [{ id: 'crypto', label: 'Crypto' }, { id: 'stocks', label: 'Stocks' }, { id: 'rwas', label: 'RWAs' }, { id: 'predictions', label: 'Predictions' }]);
  const tabs = new Map(accountTabs());
  for (const k of tradeKinds()) assert.equal(tabs.get(k.id), k.label, k.id);
  assert.equal(emptyState().trade.kind, TRADE_KIND_IDS[0]);
});

test('pickerOf: Crypto — the coins held from the leading lens by matchKey, the starred, the kind\'s most traded', () => {
  const p = pickerOf(stateWith({ watch: ['coin:BTC', 'stock:NVDA', 'coin:GONE'] }), NOW);
  // the holdings' crypto rows, the largest first; the stablecoins are not a market to pick
  assert.deepEqual(ids(p.held), ['coin:BTC', 'coin:ETH', 'coin:SOL']);
  assert.deepEqual(p.held[0], { id: 'coin:BTC', name: 'BTC', sub: '0.124 · Stand-in Exchange, Stand-in Wallet', priceWord: '$62,479.03', venue: 'ex' });
  assert.equal(p.held[0].side, undefined, 'a coin held opens as a buy');
  // the starred of this kind: a star no read lists still drawn, to be picked or seen; then the page's own (its DOGE)
  assert.deepEqual(ids(p.watching), ['coin:BTC', 'coin:GONE', 'coin:DOGE']);
  assert.deepEqual(p.watching[1], { id: 'coin:GONE', name: 'GONE', sub: 'Not in this read', priceWord: '—' });
  // the picks read's items
  assert.deepEqual(ids(p.most), ['coin:BTC', 'coin:ETH', 'coin:DOGE', 'coin:SOL', 'coin:LINK']);
  const eth = p.most.find(r => r.id === 'coin:ETH');
  assert.deepEqual(eth, { id: 'coin:ETH', name: 'ETH', sub: 'Stand-in Exchange, Stand-in Wallet, Momentum · paper · 1 public venue', priceWord: '$2,455.60' });
  // a coin listed only publicly and at the paper account
  assert.equal(p.most.find(r => r.id === 'coin:DOGE').sub, 'Momentum · paper · 1 public venue');
  assert.deepEqual(p.results, [], 'no query, no results');
});

test('pickerOf: an A share starred (the Account key, the page\'s china entry) never reaches the picker, whatever its tabs', () => {
  const all = fx('explore-all');
  // the worst case: an A-share item a read lists under the stocks tab
  all.items.push({ key: 'cn:600519', kind: 'stock', name: '贵州茅台', base: '600519', tabs: ['all', 'stocks'], at: [] });
  const page = { ...fx('account'), watch: [...fx('account').watch, { venue: 'china', symbol: '000001', at: '2026-11-01T01:00:00.000Z' }] };
  for (const kind of TRADE_KIND_IDS) {
    const p = pickerOf(stateWith({ kind, all, page, watch: ['cn:600519', 'stock:NVDA', 'coin:BTC'] }), NOW);
    assert.equal(ids(p.watching).some(id => id.startsWith('cn:')), false, kind);
  }
  assert.deepEqual(ids(pickerOf(stateWith({ kind: 'stocks', all, page, watch: ['cn:600519', 'stock:NVDA'] }), NOW).watching), ['stock:NVDA']);
});

test('pickerOf: Stocks held by matchKey; a prediction held opens as a sell of its outcome at its venue', () => {
  const stocks = pickerOf(stateWith({ kind: 'stocks', watch: ['stock:NVDA', 'coin:BTC'] }), NOW);
  assert.deepEqual(ids(stocks.held), ['stock:AAPL', 'stock:NVDA']);
  assert.equal(stocks.held[0].sub, '3 · Stand-in Broker');
  assert.equal(stocks.held[0].venue, 'broker');
  assert.deepEqual(ids(stocks.watching), ['stock:NVDA']);
  assert.deepEqual(stocks.most, [], 'no stocks picks read yet');
  const events = pickerOf(stateWith({ kind: 'predictions' }), NOW);
  assert.deepEqual(events.held, [{
    id: 'event:predict:SI-FEDCUT-DEC', name: 'Will the Fed cut rates at its December meeting?', sub: '50 contracts · Yes · Stand-in Predictions',
    priceWord: '62¢', side: 'sell', venue: 'predict', outcome: 0,
  }]);
  assert.equal(events.most.length, 9);
  assert.equal(events.most[0].priceWord, '62¢', 'an event in cents');
  // the paper lens leads when real money is zero and a paper venue is connected
  const s = stateWith({ kind: 'crypto' });
  const paperLeads = { ...s, account: { ...s.account, data: { ...s.account.data, totalUsd: 0 }, paper: read(fx('holdings-paper')) } };
  assert.deepEqual(pickerOf(paperLeads, NOW).held, [], 'the paper lens holds dollars and a stablecoin alone');
});

test("pickerOf: Watching is the face's stars and the page's own watch list together, once each, of the kind", () => {
  // the page watches ex BTC/USDT, the Fed cut's YES at predict and DOGE/USD at standin-pubex
  assert.deepEqual(ids(pickerOf(stateWith(), NOW).watching), ['coin:BTC', 'coin:DOGE']);
  assert.deepEqual(ids(pickerOf(stateWith({ watch: ['coin:ETH', 'coin:BTC'] }), NOW).watching), ['coin:ETH', 'coin:BTC', 'coin:DOGE']);
  assert.deepEqual(ids(pickerOf(stateWith({ kind: 'predictions' }), NOW).watching), ['event:predict:SI-FEDCUT-DEC'], 'found in the predictions picks');
  assert.deepEqual(ids(pickerOf(stateWith({ kind: 'stocks' }), NOW).watching), []);
  assert.deepEqual(ids(pickerOf(stateWith({ page: { ...fx('account'), watch: [] } }), NOW).watching), []);
});

test('pickerOf: a query\'s results of the kind, from the trade search\'s read; none while the query is blank', () => {
  const all = fx('explore-all');
  const results = { ...all, items: all.items.filter(i => i.key.endsWith(':ETH')) };
  const p = pickerOf(stateWith({ q: 'eth', results }), NOW);
  assert.deepEqual(ids(p.results), ['coin:ETH'], 'the ETH perpetual is not a kind Trade picks');
  assert.deepEqual(pickerOf(stateWith({ q: '  ', results }), NOW).results, []);
});

test('ticketOf: the market\'s lines, connected first with the able ones marked, the best marked, the public listings after', () => {
  assert.equal(ticketOf(stateWith(), NOW), null, 'no ticket open');
  assert.equal(ticketOf(stateWith({ ticket: { id: 'coin:NOPE', side: 'buy', venue: null, outcome: 0 } }), NOW), null, 'a market no read lists');
  const t = ticketOf(stateWith({ ticket: { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 } }), NOW);
  assert.equal(t.id, 'coin:ETH');
  assert.equal(t.item.key, 'coin:ETH');
  assert.equal(t.event, false);
  assert.deepEqual(t.outcomes, []);
  assert.equal(t.unitWord, 'ETH');
  assert.equal(t.side, 'buy');
  assert.equal(t.venue, 'ex', 'no venue given: the best able line');
  assert.deepEqual(t.legs.map(l => [l.venue, l.able, l.best, l.public, l.paper]), [
    ['ex', true, true, false, false], ['wallet', true, false, false, false], ['paper-momentum', true, false, false, true],
    ['standin-pubex-public', false, false, true, false],
  ]);
  assert.deepEqual(t.legs[0], {
    venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'ETH/USDT', price: 2455.6, bid: 2455.45, ask: 2455.75, best: true, paper: false,
    able: true, public: false, session: null,
  });
  // what is held of it, from the page's view
  assert.deepEqual(t.held.assets.map(a => a.asset), ['ETH']);
});

test('ticketOf: a venue that does not trade is not able, and the best is the best of the able lines', () => {
  const page = venueCan(fx('account'), 'ex', false);
  const t = ticketOf(stateWith({ page, ticket: { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 } }), NOW);
  assert.deepEqual(t.legs.map(l => [l.venue, l.able, l.best]), [
    ['ex', false, false], ['wallet', true, false], ['paper-momentum', true, true], ['standin-pubex-public', false, false],
  ]);
  assert.equal(t.venue, 'paper-momentum');
  // a venue given is kept; a stock's unit is shares, a line's session comes with it
  const nvda = ticketOf(stateWith({ kind: 'stocks', ticket: { id: 'stock:NVDA', side: 'sell', venue: 'broker', outcome: 0 } }), NOW);
  assert.equal(nvda.venue, 'broker');
  assert.equal(nvda.side, 'sell');
  assert.equal(nvda.unitWord, 'Shares');
  assert.deepEqual(nvda.legs[0].session, { open: false, opensAt: '2026-10-22T13:30:00.000Z' });
});

test('ticketOf: a venue given that does not take the order opens on the best able line, never on Pick where', () => {
  const open = venue => ticketOf(stateWith({ ticket: { id: 'coin:ETH', side: 'buy', venue, outcome: 0 } }), NOW);
  assert.equal(open('standin-pubex-public').venue, 'ex', 'a public listing');
  assert.equal(open('nowhere').venue, 'ex', 'a venue the market has no line at');
  assert.equal(open('wallet').venue, 'wallet', 'an able line given is kept');
  const shut = ticketOf(stateWith({ page: venueCan(fx('account'), 'ex', false), ticket: { id: 'coin:ETH', side: 'buy', venue: 'ex', outcome: 0 } }), NOW);
  assert.equal(shut.venue, 'paper-momentum', 'a venue that does not trade');
  assert.equal(tradeFieldsOf(shut).find(f => f.name === 'venue').value, 'paper-momentum');
  assert.equal(tradeFieldsOf(open('standin-pubex-public')).find(f => f.name === 'venue').value, 'ex');
});

test('tradeableOf: a market of a Trade kind, by its tabs else its key; a perpetual or a pre-IPO one is listed, not traded — ticketOf is null on it', () => {
  const all = fx('explore-all');
  const item = key => all.items.find(i => i.key === key);
  for (const key of ['coin:ETH', 'stock:NVDA']) assert.equal(tradeableOf(item(key)), true, key);
  assert.equal(tradeableOf(fx('explore-predictions').items.find(i => i.key === 'event:predict:SI-FEDCUT-DEC')), true);
  assert.equal(tradeableOf({ key: 'rwa:NVDA' }), true, 'no tabs: its key');
  assert.equal(tradeableOf(item('perp:ETH')), false);
  const preipo = { key: 'preipo:SPACEX', kind: 'perp', name: 'SpaceX', tabs: ['all', 'perps', 'preipo'], implied: { valuationUsd: 1 }, at: [] };
  assert.equal(tradeableOf(preipo), false);
  assert.equal(tradeableOf({ key: 'perp:BTC' }), false, 'no tabs: its key');
  for (const v of [null, undefined, 'coin:BTC', [], {}]) assert.equal(tradeableOf(v), false, String(v));
  // the ticket: a perpetual's page opens none, even at a venue that trades it, so neither a route nor a stale link opens one
  assert.equal(ticketOf(stateWith({ ticket: { id: 'perp:ETH', side: 'buy', venue: 'ex', outcome: 0 } }), NOW), null);
  all.items.push(preipo);
  assert.equal(ticketOf(stateWith({ all, ticket: { id: 'preipo:SPACEX', side: 'buy', venue: null, outcome: 0 } }), NOW), null);
  assert.equal(ticketOf(stateWith({ all, ticket: { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 } }), NOW).id, 'coin:ETH');
});

test('ticketOf: a prediction — its lines in cents, its outcomes with their lines at each venue', () => {
  const t = ticketOf(stateWith({ kind: 'predictions', ticket: { id: 'event:predict:SI-FEDCUT-DEC', side: 'buy', venue: null, outcome: 1 } }), NOW);
  assert.equal(t.event, true);
  assert.equal(t.unitWord, 'Contracts');
  assert.equal(t.outcome, 1);
  assert.equal(t.venue, 'predict');
  assert.deepEqual(t.legs.map(l => [l.venue, l.price, l.able, l.best]), [['predict', 62, true, true]]);
  assert.deepEqual(t.outcomes, [
    { label: 'Yes', cents: 62, bid: 61, ask: 63, at: [{ venue: 'predict', symbol: 'SI-FEDCUT-DEC:YES' }] },
    { label: 'No', cents: 38, bid: 37, ask: 39, at: [{ venue: 'predict', symbol: 'SI-FEDCUT-DEC:NO' }] },
  ]);
  assert.deepEqual(t.held.positions.map(p => p.symbol), ['SI-FEDCUT-DEC:YES']);
});

// the Account's ticket draft is its type and fifteen fields; prepare returns the seventeen it signs (maxNotional and deadline
// added, usd turned to qty)
test('tradeDraftOf: a market buy in dollars — the Account\'s liveOrder draft, usd in place of qty', () => {
  const ticket = ticketOf(stateWith({ ticket: { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 } }), NOW);
  const d = tradeDraftOf(form(), ticket);
  assert.deepEqual(d, {
    type: 'liveOrder', venue: 'ex', symbol: 'ETH/USDT', side: 'buy', orderType: 'market', usd: '25', limitPrice: '', stopPrice: '', tif: '',
    postOnly: '', reduceOnly: '', extendedHours: '', trailPercent: '', trailPrice: '', takeProfit: '', stopLoss: '',
  });
  assert.equal(Object.keys(d).length, 16);
  assert.deepEqual(Object.keys(d), LIVE_ORDER_KEYS.map(k => (k === 'qty' ? 'usd' : k)), 'the Account\'s field order');
  // at the paper account, the symbol is that line's
  assert.equal(tradeDraftOf(form({ venue: 'paper-momentum' }), ticket).symbol, 'ETH/USD');
});

test('tradeDraftOf: a limit sell in units — qty and the limit price as typed', () => {
  const ticket = ticketOf(stateWith({ ticket: { id: 'coin:ETH', side: 'sell', venue: 'ex', outcome: 0 } }), NOW);
  const d = tradeDraftOf(form({ side: 'sell', amount: '0.5', unit: 'qty', orderType: 'limit', limit: '2500.5' }), ticket);
  assert.deepEqual(Object.keys(d), LIVE_ORDER_KEYS);
  assert.equal(d.side, 'sell');
  assert.equal(d.qty, '0.5');
  assert.equal(d.usd, undefined);
  assert.equal(d.orderType, 'limit');
  assert.equal(d.limitPrice, '2500.5');
  // a market order carries no limit price, whatever the limit field holds
  assert.equal(tradeDraftOf(form({ limit: '2500.5' }), ticket).limitPrice, '');
});

test('tradeDraftOf: a prediction\'s limit is typed in cents and sent in dollars, at the picked outcome\'s symbol', () => {
  const ticket = ticketOf(stateWith({ kind: 'predictions', ticket: { id: 'event:predict:SI-FEDCUT-DEC', side: 'buy', venue: null, outcome: 0 } }), NOW);
  const d = tradeDraftOf(form({ venue: 'predict', outcome: '1', amount: '10', unit: 'qty', orderType: 'limit', limit: '62' }), ticket);
  assert.equal(d.symbol, 'SI-FEDCUT-DEC:NO');
  assert.equal(d.limitPrice, '0.62');
  assert.equal(d.qty, '10');
  assert.equal(tradeDraftOf(form({ venue: 'predict', outcome: '0', orderType: 'limit', limit: '62.5' }), ticket).limitPrice, '0.625');
  assert.equal(tradeDraftOf(form({ venue: 'predict', outcome: '0', orderType: 'limit', limit: '1.1' }), ticket).limitPrice, '0.011', 'no float noise');
  // the Account's tkPriceIn: six places, trailing zeros trimmed, never an exponent
  const limitOf = limit => tradeDraftOf(form({ venue: 'predict', orderType: 'limit', limit }), ticket);
  assert.equal(limitOf('1').limitPrice, '0.01');
  assert.equal(limitOf('0.5').limitPrice, '0.005');
  assert.equal(limitOf('62.123456789').limitPrice, '0.621235');
  assert.equal(limitOf('0.00001'), 'A price in cents is between 0 and 100', 'a price that rounds to nothing');
  for (const c of ['1', '0.5', '62.123456789', '99.9999']) assert.match(limitOf(c).limitPrice, /^\d+\.\d+$/, c);
  assert.equal(tradeDraftOf(form({ venue: 'predict', outcome: 0 }), ticket).symbol, 'SI-FEDCUT-DEC:YES', 'an outcome as a number too');
  for (const limit of ['0', '100', '120']) {
    assert.equal(tradeDraftOf(form({ venue: 'predict', orderType: 'limit', limit }), ticket), 'A price in cents is between 0 and 100', limit);
  }
});

test('tradeDraftOf: extended hours only on a limit, ticked, where the line offers it — the Account\'s tkOrderDraft', () => {
  const all = fx('explore-all');
  const nvda = all.items.find(i => i.key === 'stock:NVDA');
  nvda.at[0].session = { ...nvda.at[0].session, extendedHours: true };
  const ticket = ticketOf(stateWith({ all, kind: 'stocks', ticket: { id: 'stock:NVDA', side: 'buy', venue: 'broker', outcome: 0 } }), NOW);
  const limit = over => form({ venue: 'broker', orderType: 'limit', limit: '180', ...over });
  assert.equal(tradeDraftOf(limit({ extendedHours: true }), ticket).extendedHours, 'true');
  assert.equal(tradeDraftOf(limit({ extendedHours: false }), ticket).extendedHours, '');
  assert.equal(tradeDraftOf(form({ venue: 'broker', extendedHours: true }), ticket).extendedHours, '', 'a market order never carries it');
  assert.equal(tradeDraftOf(limit({ venue: 'paper-momentum', extendedHours: true }), ticket).extendedHours, '', 'the paper line does not offer it');
});

test('tradeDraftOf: the words for what is missing', () => {
  const ticket = ticketOf(stateWith({ ticket: { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 } }), NOW);
  assert.equal(tradeDraftOf(form(), null), 'Pick where');
  assert.equal(tradeDraftOf(form({ venue: '' }), ticket), 'Pick where');
  assert.equal(tradeDraftOf(form({ venue: 'standin-pubex-public' }), ticket), 'Pick where', 'a public listing does not take the owner\'s order');
  assert.equal(tradeDraftOf(form({ venue: 'nowhere' }), ticket), 'Pick where');
  assert.equal(tradeDraftOf(form({ amount: '' }), ticket), 'Type an amount');
  assert.equal(tradeDraftOf(form({ amount: '  ' }), ticket), 'Type an amount');
  assert.equal(tradeDraftOf(form({ amount: 'ten' }), ticket), 'Type an amount');
  assert.equal(tradeDraftOf(form({ amount: '0' }), ticket), 'Type an amount');
  assert.equal(tradeDraftOf(form({ orderType: 'limit', limit: '' }), ticket), 'Type the limit price');
  assert.equal(tradeDraftOf(form({ orderType: 'limit', limit: 'high' }), ticket), 'Type the limit price');
  // a venue that stops trading after the ticket opened is not a place to sign
  const shut = ticketOf(stateWith({ page: venueCan(fx('account'), 'ex', false), ticket: { id: 'coin:ETH', side: 'buy', venue: 'ex', outcome: 0 } }), NOW);
  assert.equal(tradeDraftOf(form(), shut), 'Pick where');
});

test('the order sheet: fieldsOf and draftOf delegate to the ticket, and the draft reads no clock', () => {
  const ticket = ticketOf(stateWith({ ticket: { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 } }), NOW);
  const seed = { id: 'coin:ETH', ticket };
  const fields = fieldsOf('order', seed);
  assert.deepEqual(fields, tradeFieldsOf(ticket));
  assert.deepEqual(fields.map(f => [f.name, f.type, f.value]), [
    ['venue', 'pick', 'ex'], ['side', 'seg', 'buy'], ['amount', 'number', ''], ['unit', 'select', 'usd'], ['orderType', 'select', 'market'], ['limit', 'number', ''],
  ]);
  assert.deepEqual(fields[0].options, [
    { value: 'ex', label: 'Stand-in Exchange' }, { value: 'wallet', label: 'Stand-in Wallet' }, { value: 'paper-momentum', label: 'Momentum · paper' },
  ], 'the able lines alone');
  assert.deepEqual(fields[1].options, [{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }]);
  assert.deepEqual(fields[3].options, [{ value: 'usd', label: 'Dollars' }, { value: 'qty', label: 'ETH' }]);
  assert.deepEqual(fields[4].options, [{ value: 'market', label: 'Market' }, { value: 'limit', label: 'Limit' }]);
  // as drawn: nothing typed yet
  assert.equal(draftOf('order', fields, seed, NOW), 'Type an amount');
  const typed = fields.map(f => (f.name === 'amount' ? { ...f, value: '25' } : f));
  assert.deepEqual(draftOf('order', typed, seed, NOW), tradeDraftOf(form(), ticket));
  assert.deepEqual(draftOf('order', typed, seed, 0), draftOf('order', typed, seed, NOW), 'no clock in the draft');
  assert.equal(draftOf('order', typed, {}, NOW), 'Pick where', 'a seed without its ticket');
  // a prediction draws its outcomes and its limit in cents; a line that offers extended hours draws the box
  const ev = ticketOf(stateWith({ kind: 'predictions', ticket: { id: 'event:predict:SI-FEDCUT-DEC', side: 'sell', venue: 'predict', outcome: 1 } }), NOW);
  const evFields = fieldsOf('order', { id: ev.id, ticket: ev });
  assert.deepEqual(evFields.map(f => f.name), ['venue', 'side', 'outcome', 'amount', 'unit', 'orderType', 'limit']);
  assert.deepEqual(evFields.find(f => f.name === 'outcome'), { name: 'outcome', label: 'Outcome', type: 'seg', options: [{ value: '0', label: 'Yes' }, { value: '1', label: 'No' }], value: '1' });
  assert.equal(evFields.find(f => f.name === 'side').value, 'sell');
  assert.equal(evFields.find(f => f.name === 'limit').label, 'Limit, in cents');
  assert.deepEqual(evFields.find(f => f.name === 'unit').options[1], { value: 'qty', label: 'Contracts' });
  const all = fx('explore-all');
  all.items.find(i => i.key === 'stock:NVDA').at[0].session.extendedHours = true;
  const nvda = ticketOf(stateWith({ all, kind: 'stocks', ticket: { id: 'stock:NVDA', side: 'buy', venue: 'broker', outcome: 0 } }), NOW);
  const nvdaFields = fieldsOf('order', { id: nvda.id, ticket: nvda });
  assert.deepEqual(nvdaFields.at(-1), { name: 'extendedHours', label: 'Extended hours', type: 'check', value: false });
  const paper = ticketOf(stateWith({ all, kind: 'stocks', ticket: { id: 'stock:NVDA', side: 'buy', venue: 'paper-momentum', outcome: 0 } }), NOW);
  assert.equal(fieldsOf('order', { id: paper.id, ticket: paper }).some(f => f.name === 'extendedHours'), false, 'the paper line does not offer it');
  assert.deepEqual(fieldsOf('order', {}), [], 'no ticket, no fields');
});

test('quoteOf: the preparation\'s order quote, each figure a number', () => {
  assert.deepEqual(quoteOf(fx('prepared-order')), {
    words: 'buy 0.0099 ETH at Stand-in Exchange · market · about $24.31', price: 2455.74, notionalUsd: 24.31, maxUsd: 24.8, feeUsd: null, capUsd: 250,
    paper: false, quoteFrom: '', quoteAt: '', name: 'ETH / USDT',
  }, 'no fee estimated for the order: none, never the outer quote\'s 0');
  const prepared = fx('prepared-order');
  prepared.quote.order = { ...prepared.quote.order, price: '2455.74', feeUsd: 0.02, paper: true, quoteFrom: 'Stand-in Exchange · real time', quoteAt: '2026-10-22T07:39:59.000Z', capUsd: 'lots' };
  const q = quoteOf(prepared);
  assert.equal(q.price, 2455.74);
  assert.equal(q.feeUsd, 0.02, 'the order\'s own fee');
  assert.equal(q.capUsd, null, 'a figure that does not parse is none');
  assert.equal(q.paper, true);
  assert.equal(q.quoteFrom, 'Stand-in Exchange · real time');
  assert.equal(q.quoteAt, '2026-10-22T07:39:59.000Z');
  assert.equal(quoteOf(fx('prepared-watch')), null, 'no order quote');
  assert.equal(quoteOf(null), null);
});

test('underWayOf: the page\'s working orders, each with what cancels it', () => {
  const rows = underWayOf(fx('account'));
  assert.deepEqual(rows.map(r => [r.id, r.status, r.who]), [
    ['ord-0010', 'open', 'Agent · Claude Code'], ['ord-0009', 'pending', 'You'], ['ord-0004', 'open', 'You'], ['ord-0003', 'open', 'You'], ['ord-0002', 'open', 'You'],
  ]);
  assert.deepEqual(rows[1].cancel, { venue: 'broker', order: 'ord-0009' });
  assert.equal(rows[1].symbol, 'SPY', 'the open orders row as it is');
  for (const r of rows) assert.deepEqual(r.cancel, { venue: r.venue, order: r.id });
  // an order the Account knows by its client id alone: nothing to cancel it by
  const page = fx('account');
  page.orders = [{ ...page.orders.find(o => o.id === 'ord-0002'), id: undefined }];
  const [noId] = underWayOf(page);
  assert.equal(noId.id, '');
  assert.equal(noId.cancel, null);
  assert.deepEqual(underWayOf(null), []);
  assert.deepEqual(underWayOf({ ok: false }), []);
});

test('underWayOf marks a DEX order waiting for the wallet; it keeps its own cancel', () => {
  const page = fx('account');
  const tx = { chainId: 8453, chainIdHex: '0x2105', from: '0x' + '12'.repeat(20), to: '0x' + '34'.repeat(20), data: '0xabcd', value: '0x0' };
  const base = page.orders.find(o => o.id === 'ord-0009');
  page.orders = [
    { ...base, id: 'ord-0031', clientId: 'c0ffee', status: 'pending', walletTxs: [tx], ref: undefined },
    { ...base, id: 'ord-0032', clientId: 'c0ffef', status: 'pending', walletTxs: [tx], ref: '0xsent' },
    { ...base, id: 'ord-0033', clientId: 'c0fff0', status: 'pending', walletTxs: [tx], ref: undefined, reported: '0x' + 'bb'.repeat(32) },
    page.orders.find(o => o.id === 'ord-0002'),
  ];
  page.venues = [...page.venues, { id: 'w1', name: 'My Wallet' }];
  page.payments = [
    { id: 'pay-0009', at: '2026-11-01T14:00:00.000Z', kind: 'send', from: 'w1', to: 'ex', status: 'authorized', legs: [{ native: { walletTx: tx } }], live: { network: 'Base' } },
    { id: 'pay-0010', at: '2026-11-01T14:01:00.000Z', kind: 'send', from: 'w1', to: 'ex', status: 'pending', legs: [{ native: { walletTx: tx } }] },
    { id: 'pay-0011', at: '2026-11-01T14:02:00.000Z', kind: 'withdraw', from: 'ex', to: 'w1', status: 'authorized', legs: [{}] },
    { id: 'pay-0012', at: '2026-11-01T14:03:00.000Z', kind: 'send', from: 'w1', to: 'ex', status: 'authorized', legs: [{ native: { walletTx: tx } }], live: { reported: '0x' + 'cc'.repeat(32) } },
  ];
  const rows = underWayOf(page);
  const [waits, placed, held, rests, pay, payHeld] = rows;
  assert.equal(rows.length, 6);
  assert.deepEqual([waits.id, waits.walletSend, waits.cancel, waits.walletKey, waits.walletReported], ['ord-0031', { order: 'ord-0031' }, { venue: waits.venue, order: 'ord-0031' }, 'c0ffee', false]);
  assert.deepEqual([held.walletSend, held.walletReported], [{ order: 'ord-0033' }, true], 'a hash the Account already holds');
  assert.equal(payHeld.walletReported, true);
  assert.deepEqual([placed.walletSend, placed.cancel], [null, { venue: placed.venue, order: 'ord-0032' }], 'sent (its ref): an order like any other');
  assert.deepEqual([rests.walletSend, rests.walletKey, rests.cancel], [null, null, { venue: 'ex', order: 'ord-0002' }]);
  assert.deepEqual(pay, { payment: 'pay-0009', words: 'Send · My Wallet → Stand-in Exchange · Base', key: 'pay-0009@2026-11-01T14:00:00.000Z', walletReported: false });
});

test('fillWords: a fill frame as one line — the side, the size and base, the price, the venue, paper said', () => {
  const fill = {
    venue: 'ex', venueName: 'Stand-in Exchange', ref: 'sx-00009', clientId: 'c1', filledQty: 0.04, symbol: 'ETH/USDT', name: 'ETH / USDT',
    kind: 'spot', side: 'buy', qty: 0.04, price: 3120.5, at: '2026-10-22T07:40:00.000Z', order: 'ord-0011', by: 'owner',
  };
  assert.equal(fillWords({ type: 'fill', id: '4dababf8.9', data: fill }), 'Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange');
  assert.equal(fillWords(fill), 'Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange', 'the frame\'s data alone too');
  const paper = { ...fill, venue: 'paper-momentum', venueName: 'Momentum · paper', paper: true, side: 'sell', symbol: 'SOL/USD', qty: 1, price: 142.85 };
  assert.equal(fillWords({ type: 'fill', data: paper }), 'Sold 1 SOL @ 142.85 · Momentum · paper', 'paper said once: the venue\'s name says it');
  assert.equal(fillWords({ type: 'fill', data: { ...paper, venueName: 'Momentum' } }), 'Sold 1 SOL @ 142.85 · Momentum · Paper account');
  assert.equal(fillWords({ type: 'fill', data: { ...fill, avg: true } }), 'Bought 0.04 ETH @ 3,120.50 avg · Stand-in Exchange', 'the order\'s average, said so');
  for (const qty of [0, -1, undefined, 'lots']) {
    const words = fillWords({ type: 'fill', data: { ...fill, qty } });
    assert.equal(words, 'Bought ETH @ 3,120.50 · Stand-in Exchange', String(qty));
    assert.doesNotMatch(words, /undefined|Bought 0/);
  }
  assert.equal(fillWords({ type: 'fill', data: { ...fill, symbol: 'SPY', kind: 'stock', price: undefined, qty: 2 } }), 'Bought 2 SPY · Stand-in Exchange', 'no price, no @');
  assert.equal(fillWords({ type: 'fill', data: { ...fill, symbol: 'SI-FEDCUT-DEC:YES', kind: 'event', name: 'Will the Fed cut rates at its December meeting? · Yes', qty: 10, price: 0.62 } }),
    'Bought 10 contracts · Will the Fed cut rates at its December meeting? · Yes @ 62¢ · Stand-in Exchange');
  assert.equal(fillWords({ type: 'quote', data: {} }), '');
  assert.equal(fillWords(null), '');
});

test('the views read the store as it boots without throwing', () => {
  const s = emptyState();
  assert.deepEqual(pickerOf(s, NOW), { held: [], watching: [], most: [], results: [] });
  assert.equal(ticketOf(s, NOW), null);
  assert.equal(ticketOf({ ...s, trade: { ...s.trade, ticket: { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 } } }, NOW), null);
});

test('eventPriceOf: cents typed as the dollars the Account signs, six places, trailing zeros trimmed; null outside 0 < c < 100', () => {
  assert.equal(eventPriceOf('62'), '0.62');
  assert.equal(eventPriceOf('0.5'), '0.005');
  assert.equal(eventPriceOf(' 10 '), '0.1');
  assert.equal(eventPriceOf('99.99'), '0.9999');
  for (const t of ['100', '0', '150', '-5', '', 'abc', '1e1', '0.00001']) assert.equal(eventPriceOf(t), null, JSON.stringify(t));
  assert.equal(eventPriceOf(62), null, 'a typed string only');
});
