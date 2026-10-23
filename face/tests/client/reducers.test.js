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

test('the empty state carries no demo slice', () => {
  const s = emptyState();
  for (const gone of ['plugins', 'memory', 'mail', 'banner', 'call', 'compose']) assert.equal(gone in s, false, gone);
  for (const gone of ['addMemory', 'editMemory', 'forgetMemory', 'forgetAll', 'setMemorySwitch', 'append']) assert.equal(R[gone], undefined, gone);
});
