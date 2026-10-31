// The reducers on host-shaped states (spec 2026-10-19 §5): routes, the draft, the defaults that skip archived
// conversations, and the empty state's slices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { parseHash } from '../../client/js/router.js';

const NOW = new Date(2026, 9, 9, 14, 7).getTime();
const hostConv = (id, over = {}) => ({ id, title: id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, archived: false, updatedAt: 1, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });

test('nav to a missing id and Cancel open the first open conversation, never an archived one', () => {
  const s = { ...emptyState(), conversations: [hostConv('old', { archived: 'face' }), hostConv('a')] };
  assert.equal(R.nav(s, { screen: 'messages', id: 'gone' }).route.id, 'a');
  assert.equal(R.nav(s, { screen: 'messages', id: null }).route.id, 'a');
  assert.equal(R.nav(s, { screen: 'messages', id: 'old' }).route.id, 'old', 'an archived conversation opens by its id');
  assert.equal(R.cancelDraft(R.startDraft(s, { now: NOW })).route.id, 'a');
  const allArchived = { ...s, conversations: [hostConv('old', { archived: 'host' })] };
  assert.equal(R.nav(allArchived, { screen: 'messages', id: null }).route.id, null);
});

test('nav opens a conversation, closes drawers and drops a draft', () => {
  const s = { ...emptyState(), conversations: [hostConv('a'), hostConv('b')] };
  let t = R.startDraft(R.toggleDetails(R.nav(s, { screen: 'messages', id: 'a' })), { now: NOW });
  assert.ok(t.draft);
  t = R.nav(t, { screen: 'messages', id: 'b' });
  assert.equal(t.draft, null); assert.equal(t.detailsOpen, false); assert.equal(t.route.id, 'b');
  assert.equal(R.nav(t, { screen: 'discover', id: null }).route.screen, 'discover');
  assert.equal(R.nav(s, { screen: 'messages', id: 'new' }).route.id, 'a', 'new without a draft opens the first');
});

test('nav folds #/mail to Messages', () => {
  const s = { ...emptyState(), conversations: [hostConv('a')] };
  assert.deepEqual(parseHash('#/mail/x'), { screen: 'messages', id: null });
  assert.deepEqual(R.nav(s, parseHash('#/mail')).route, { screen: 'messages', id: 'a' });
});

// the Account's quotes: the poll's answer and the stream's frames write the same pair, and the fresher price stays
test("a quotes poll answer older than the pair's kept quote leaves it; one with no stamp replaces one with none", () => {
  const pair = s => s.markets.accountQuotes['ex|ETH/USDT'];
  const poll = market => ({ quotes: [{ venue: 'ex', symbol: 'ETH/USDT', market }] });
  let s = R.streamQuote(emptyState(), { data: { venue: 'ex', symbol: 'ETH/USDT', last: 2455.6, priceAt: '2026-10-22T07:59:58.500Z', from: 'okx · live', live: true } });
  s = R.accountQuotesLoaded(s, poll({ price: 2450, quoteAt: '2026-10-22T07:59:55.000Z', quoteFrom: 'OKX · 3 s' }));
  assert.equal(pair(s).price, 2455.6, "the stream's fresher frame wins");
  assert.equal(pair(s).quoteFrom, 'okx · live');
  s = R.accountQuotesLoaded(s, poll({ price: 2457, quoteAt: '2026-10-22T07:59:59.000Z', quoteFrom: 'OKX' }));
  assert.equal(pair(s).price, 2457, 'a newer answer replaces it');
  s = R.accountQuotesLoaded(s, poll({ price: 2458, quoteAt: '2026-10-22T07:59:59.000Z' }));
  assert.equal(pair(s).price, 2458, 'as does one of the same moment');
  // without stamps the poll cannot be older: its answer replaces the pair's
  const nvda = s => s.markets.accountQuotes['broker|NVDA'];
  let t = R.accountQuotesLoaded(emptyState(), { quotes: [{ venue: 'broker', symbol: 'NVDA', market: { price: 182.4 } }] });
  t = R.accountQuotesLoaded(t, { quotes: [{ venue: 'broker', symbol: 'NVDA', market: { price: 183 } }] });
  assert.equal(nvda(t).price, 183);
  assert.equal(nvda(t).quoteAt, null);
});

// the Account's snapshot (a reconnect past its ring, another run): market events are never resumed, so a price the stream kept
// may be dead — the pairs the stream priced go, the quotes poll's stay, stamped or not
test("streamSnapshot drops the pairs the stream priced and keeps the quotes poll's", () => {
  const poll = (venue, symbol, market) => ({ quotes: [{ venue, symbol, market }] });
  const tick = (venue, symbol, last, at) => ({ data: { venue, symbol, last, priceAt: at, from: 'okx · live', live: true } });
  let s = R.accountQuotesLoaded(emptyState(), poll('broker', 'NVDA', { price: 182.4, quoteAt: '2026-10-22T07:59:58.000Z', quoteFrom: 'Stand-in Broker · real time' }));
  s = R.accountQuotesLoaded(s, poll('ex', 'BTC/USDT', { price: 63000 }));
  s = R.streamQuote(s, tick('ex', 'BTC/USDT', 63210, '2026-10-22T07:59:59.000Z'));
  s = R.streamQuote(s, tick('ex', 'ETH/USDT', 2455.6, '2026-10-22T07:59:58.500Z'));
  // a stream price the poll has replaced since is the poll's
  s = R.streamQuote(s, tick('ex', 'SOL/USDT', 141.4, '2026-10-22T07:59:57.000Z'));
  s = R.accountQuotesLoaded(s, poll('ex', 'SOL/USDT', { price: 141.5 }));
  const after = R.streamSnapshot(s);
  assert.deepEqual(Object.keys(after.markets.accountQuotes).sort(), ['broker|NVDA', 'ex|SOL/USDT']);
  assert.equal(after.markets.accountQuotes['broker|NVDA'].price, 182.4, "the poll's stamped price stays");
  assert.equal(after.markets.accountQuotes['ex|SOL/USDT'].price, 141.5);
  assert.equal(R.streamSnapshot(after), after, 'nothing the stream priced: the state as it was');
});

// a read beside the Account's page keeps the Account's sentence when it refuses, as the page read does: You hold, On the
// statement and the Statement drawer draw it
test("holdingsFailed keeps the Account's sentence over the holdings kept; the next answer clears it", () => {
  const rows = { ok: true, rows: [{ key: 'BTC', asset: 'BTC' }] };
  let s = R.holdingsLoaded(emptyState(), { data: rows, at: 1 });
  s = R.holdingsFailed(s, { at: 2, message: 'Venues are still settling.' });
  assert.deepEqual(s.account.holdings, { status: 'error', data: rows, at: 2, message: 'Venues are still settling.' });
  s = R.holdingsLoaded(s, { data: rows, at: 3 });
  assert.equal(s.account.holdings.message, null, 'an answer clears it');
  assert.equal(R.holdingsFailed(s, { at: 4 }).account.holdings.message, null, 'a failure without words carries none');
});

test("statementFailed keeps the Account's sentence over the lines kept; the next answer clears it", () => {
  const lines = { ok: true, lines: [{ key: 'order:o1', description: 'Buy 1 AAPL' }] };
  let s = R.statementLoaded(emptyState(), { data: lines, at: 1 });
  s = R.statementFailed(s, { at: 2, message: 'The statement is being rebuilt.' });
  assert.deepEqual(s.account.statement, { status: 'error', data: lines, at: 2, message: 'The statement is being rebuilt.' });
  s = R.statementLoaded(s, { data: lines, at: 3 });
  assert.equal(s.account.statement.message, null, 'an answer clears it');
  assert.equal(R.statementFailed(s, { at: 4 }).account.statement.message, null, 'a failure without words carries none');
});

// the owner device's slice (host/owner.js): its standing, the Account's words when it refused, a pairing in the air
test('the owner slice takes a known role, the refusal as words, busy as a boolean', () => {
  const s = emptyState();
  assert.deepEqual(s.owner, { role: 'unknown', kid: '', refusal: null, busy: false });
  let t = R.ownerStanding(s, { role: 'signs', kid: '0123456789abcdef' });
  assert.deepEqual(t.owner, { role: 'signs', kid: '0123456789abcdef', refusal: null, busy: false });
  assert.equal(R.ownerStanding(t, { role: 'signs', kid: '0123456789abcdef' }), t, 'the same standing: the state as it was');
  assert.equal(R.ownerStanding(t, { role: 'owner', kid: 'x' }), t, 'a role the device does not know changes nothing');
  assert.equal(R.ownerStanding(t, { role: 'signed-out' }).owner.kid, '', 'no kid is the empty one');
  t = R.ownerRefusal(t, 'that is not the pairing code this server printed in its terminal (4 tries left)');
  assert.equal(t.owner.refusal, 'that is not the pairing code this server printed in its terminal (4 tries left)');
  assert.equal(R.ownerRefusal(t, null).owner.refusal, null);
  assert.equal(R.ownerRefusal(t, { message: 'x' }).owner.refusal, null, 'only words are kept');
  assert.equal(R.ownerBusy(t, true).owner.busy, true);
  assert.equal(R.ownerBusy(R.ownerBusy(t, true), 'yes').owner.busy, false);
  assert.equal(R.ownerBusy(t, false), t);
});

// the owner sheet's slice (host/sheet.js): prepare, What you sign, sign
test('the sheet slice: open, a field, incomplete, a quiet and a loud ask, prepared, refused, signing, done, close', () => {
  const s = emptyState();
  assert.equal(s.sheet, null);
  for (const type of ['sheetField', 'sheetIncomplete', 'sheetAsking', 'sheetPrepared', 'sheetRefused', 'sheetSigning', 'sheetDone', 'sheetTick', 'sheetClose']) {
    assert.equal(R[type](s, {}), s, `${type} without a sheet changes nothing`);
  }
  const fields = [{ name: 'usd', label: 'Paper dollars to add', type: 'number', placeholder: '1000', value: '' }];
  let t = R.sheetOpen(s, { kind: 'topUp', seed: { venue: 'paper-a' }, fields });
  assert.deepEqual(t.sheet, {
    kind: 'topUp', seed: { venue: 'paper-a' }, fields, status: 'incomplete', words: '', prepared: null, preparedAt: null,
    asked: null, deadline: null, message: null, again: false, said: null,
  });
  t = R.sheetIncomplete(t, 'Type an amount');
  assert.equal(t.sheet.words, 'Type an amount');
  t = R.sheetField(t, { name: 'usd', value: '500' });
  assert.equal(t.sheet.fields[0].value, '500');
  assert.equal(fields[0].value, '', 'the fields given are not changed');
  assert.equal(t.sheet.status, 'incomplete', 'a field leaves the status as it was');
  assert.equal(R.sheetField(t, { name: 'nope', value: 'x' }), t, 'a field the sheet does not have changes nothing');
  const plain = R.sheetOpen(s, { kind: 'order', seed: {}, fields: { qty: '' } });
  assert.deepEqual(R.sheetField(plain, { name: 'qty', value: '2' }).sheet.fields, { qty: '2' }, 'a plain form takes the name');

  t = R.sheetAsking(t, { quiet: true });
  assert.equal(t.sheet.status, 'asking', 'a quiet ask with nothing shown is an ask');
  const prepared = { ok: true, action: { type: 'topUpPaper', nonce: 1 }, shown: [] };
  t = R.sheetPrepared(t, { prepared, at: 10, asked: '{"usd":"500"}', deadline: 600_010 });
  assert.equal(t.sheet.status, 'ready');
  assert.equal(t.sheet.prepared, prepared);
  assert.equal(t.sheet.preparedAt, 10);
  assert.equal(t.sheet.asked, '{"usd":"500"}');
  assert.equal(t.sheet.deadline, 600_010);
  assert.equal(t.sheet.words, '');
  assert.equal(R.sheetAsking(t, { quiet: true }), t, 'a quiet ask keeps the shown preparation, ready');
  const loud = R.sheetAsking(t, {});
  assert.equal(loud.sheet.status, 'asking');
  assert.equal(loud.sheet.prepared, null);
  assert.equal(loud.sheet.deadline, null);
  const tick = R.sheetTick(t);
  assert.notEqual(tick, t, 'a tick is a new state, so the countdown draws');
  assert.deepEqual(tick.sheet, t.sheet);

  const refused = R.sheetRefused(t, { message: 'the price moved', again: true, standing: false });
  assert.equal(refused.sheet.status, 'refused');
  assert.equal(refused.sheet.message, 'the price moved');
  assert.equal(refused.sheet.again, true);
  assert.equal(refused.sheet.prepared, null, 'nothing left to sign');
  assert.equal(refused.sheet.deadline, null);
  assert.equal(R.sheetRefused(t, { message: 7, again: 'yes' }).sheet.message, 'Refused', 'only words; again only when true');
  assert.equal(R.sheetRefused(t, { message: 7, again: 'yes' }).sheet.again, false);
  assert.equal(R.sheetPrepared(refused, { prepared, at: 20, asked: 'x', deadline: null }).sheet.message, null, 'a preparation clears it');

  t = R.sheetSigning(t);
  assert.equal(t.sheet.status, 'signing');
  t = R.sheetDone(t, { said: 'paper-a topped up by $500' });
  assert.equal(t.sheet.status, 'done');
  assert.equal(t.sheet.said, 'paper-a topped up by $500');
  assert.equal(t.sheet.deadline, null, 'no countdown over a done sheet');
  assert.equal(R.sheetClose(t).sheet, null);
});

test('the trade slice: the kind, the query, the picks by kind, the search, the ticket, what was said', () => {
  const s = emptyState();
  assert.deepEqual(s.trade, { kind: 'crypto', q: '', picks: {}, results: { status: 'idle', data: null, at: null }, ticket: null, said: null });
  let t = R.tradeKind(s, 'predictions');
  assert.equal(t.trade.kind, 'predictions');
  assert.equal(R.tradeKind(t, 'predictions'), t, 'the same kind: the state as it was');
  assert.equal(R.tradeKind(t, 'perps'), t, 'a kind Trade does not pick changes nothing');
  assert.equal(R.tradeKind(t, 'all'), t);
  t = R.tradeQuery(t, 'fed');
  assert.equal(t.trade.q, 'fed');
  assert.equal(R.tradeQuery(t, 42).trade.q, '', 'a query that is not text is blank');

  // the picks, by kind: a failed read keeps its items, with the Account's sentence
  const body = { ok: true, items: [{ key: 'coin:BTC' }] };
  t = R.picksLoading(t, { kind: 'crypto' });
  assert.deepEqual(t.trade.picks.crypto, { status: 'loading', data: null, at: null });
  t = R.picksLoaded(t, { kind: 'crypto', data: body, at: 5 });
  assert.deepEqual(t.trade.picks.crypto, { status: 'ready', data: body, at: 5, message: null });
  t = R.picksFailed(t, { kind: 'crypto', at: 6, message: 'The account is busy' });
  assert.deepEqual(t.trade.picks.crypto, { status: 'error', data: body, at: 6, message: 'The account is busy' });
  assert.equal(R.picksLoaded(t, { kind: 'perps', data: body, at: 7 }), t, 'a kind Trade does not pick is not kept');
  assert.equal(R.picksLoading(t, {}), t);

  // the trade search's read, apart from the Markets search's
  t = R.tradeResultsLoading(t);
  assert.equal(t.trade.results.status, 'loading');
  t = R.tradeResultsLoaded(t, { data: body, at: 8 });
  assert.deepEqual(t.trade.results, { status: 'ready', data: body, at: 8, message: null });
  t = R.tradeResultsFailed(t, { at: 9 });
  assert.deepEqual(t.trade.results, { status: 'error', data: body, at: 9, message: null });
  assert.deepEqual(t.markets.results, s.markets.results, 'the Markets search is untouched');
  assert.equal(R.resultsLoaded(s, { data: body, at: 1 }).trade.results.status, 'idle', 'and the Markets search leaves Trade\'s');

  // the ticket: a buy of the first outcome where the venue is not given; a word said is cleared by a new ticket
  t = R.tradeSaid(t, 'Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange');
  assert.equal(t.trade.said, 'Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange');
  t = R.ticketOpen(t, { id: 'coin:ETH' });
  assert.deepEqual(t.trade.ticket, { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 });
  assert.equal(t.trade.said, null);
  t = R.ticketOpen(t, { id: 'event:predict:SI-FEDCUT-DEC', side: 'sell', venue: 'predict', outcome: 1 });
  assert.deepEqual(t.trade.ticket, { id: 'event:predict:SI-FEDCUT-DEC', side: 'sell', venue: 'predict', outcome: 1 });
  assert.deepEqual(R.ticketOpen(t, { id: 'coin:ETH', side: 'short', venue: 7, outcome: -1 }).trade.ticket, { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 });
  assert.equal(R.ticketOpen(t, { id: '' }), t, 'no market, no ticket');
  assert.equal(R.ticketClose(t).trade.ticket, null);
  assert.equal(R.tradeSaid(t, null).trade.said, null);
  assert.equal(R.tradeSaid(t, 3).trade.said, null);
});

test('the empty state carries no demo slice', () => {
  const s = emptyState();
  for (const gone of ['plugins', 'memory', 'mail', 'banner', 'call', 'compose']) assert.equal(gone in s, false, gone);
  for (const gone of ['addMemory', 'editMemory', 'forgetMemory', 'forgetAll', 'setMemorySwitch', 'append']) assert.equal(R[gone], undefined, gone);
});

// the China tab (spec 2026-10-31): the ranking's read, the tab, an A share's history
test('the rank read: loading keeps the answer, loaded records its sort, a failure keeps the rows', () => {
  const data = { ok: true, sort: 'movers', total: 5577, items: [{ id: 'cn:300030' }] };
  assert.deepEqual(emptyState().markets.rank, { status: 'idle', data: null, at: null, sort: 'volume', message: null });
  let s = R.rankLoaded(emptyState(), { sort: 'movers', data, at: 1 });
  s = R.rankLoading(s, { sort: 'volume' });
  assert.equal(s.markets.rank.data, data);
  assert.equal(s.markets.rank.status, 'loading');
  s = R.rankFailed(s, { sort: 'volume', at: 2, message: null });
  assert.deepEqual([s.markets.rank.status, s.markets.rank.data, s.markets.rank.sort], ['error', data, 'volume']);
  assert.equal(R.rankLoaded(s, { sort: 'price', data: {}, at: 3 }), s, 'an unknown sort changes nothing');
});

test('China is a tab, starting from Most traded', () => {
  let s = R.setMarketsSort(emptyState(), 'movers');
  s = R.setMarketsTab(s, 'china');
  assert.deepEqual([s.markets.tab, s.markets.sort], ['china', 'volume']);
});

test('an A share page keeps its range and its history like an Account market', () => {
  let s = R.setRange(emptyState(), { id: 'cn:600519', range: '5D' });
  assert.equal(s.markets.candles['cn:600519'].range, '5D');
  s = R.candlesLoaded(s, { id: 'cn:600519', range: '5D', data: { ok: true, range: '5D', sessions: [] }, at: 1 });
  assert.equal(s.markets.candles['cn:600519'].status, 'ready');
  assert.equal(R.setRange(emptyState(), { id: 'cn:12345', range: '5D' }).markets.candles['cn:12345'], undefined);
});
