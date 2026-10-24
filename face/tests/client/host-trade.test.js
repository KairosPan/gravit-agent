// Trade's host (spec 2026-10-22 §6.4, plan 2 Task 10): the kinds' picks reads through the face's proxy, on screen and every
// 20 s; the trade search's read; a pick opening the ticket and the order sheet on its best able line, that line followed on the
// Account's stream, a venue change re-seeding and re-following; a quote frame for the followed line re-preparing quietly once
// the shown quote is 3 s old; a fill frame said; the one-click Cancel through the owner device; close releasing — over the
// stand-in's answers (tests/fixtures/account/), with a real store, recording timers, a recording getJson, a fake sheet engine,
// a fake owner device and a recording stream.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startTrade, PICKS_MS, PICK_LIMIT, FRESH_MS } from '../../client/js/host/trade.js';
import { ticketOf } from '../../client/js/host/trade-view.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const deferred = () => { let resolve; const promise = new Promise(res => { resolve = res; }); return { promise, resolve }; };
const refused = (status, body) => Object.assign(new Error(`HTTP ${status}`), { status, body });
const NOW = Date.parse('2026-10-22T08:00:00.000Z');
const picksOf = (all, kind) => ({ ...all, items: all.items.filter(i => i.tabs.includes(kind)) });

const CRYPTO = '/data/account/explore?tab=crypto&limit=12';
const PREDICTIONS = '/data/account/explore?tab=predictions&limit=12';
// the plain form the host opens the order sheet with
const FORM = { amount: '', unit: 'usd', orderType: 'market', limit: '', extendedHours: false };

function rig({ answer = () => undefined, act = () => ({ status: 200, body: { ok: true, kind: 'order', order: { id: 'ord-0010', status: 'canceled' } } }) } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  // the Account's page and All's explore read, as the Account and Markets hosts land them
  store.dispatch('accountLoaded', { data: fx('account'), at: NOW });
  store.dispatch('exploreLoaded', { tab: 'all', data: fx('explore-all'), at: NOW });
  const reads = [];
  const getJson = path => {
    reads.push(path);
    const a = answer(path);
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  };
  const timers = [];
  const schedule = (fn, ms) => { const t = { fn, ms, done: false, cancelled: false }; timers.push(t); return t; };
  const cancelTimer = t => { t.done = true; t.cancelled = true; };
  const due = ms => timers.filter(t => !t.done && (ms === undefined || t.ms === ms));
  const fire = ms => { for (const t of due(ms)) { t.done = true; t.fn(); } };
  const follows = [];
  const stream = { follow(keys) { follows.push([...keys]); } };
  // the sheet engine as the host drives it: open and close land in the store, every call recorded
  const calls = [];
  let prepare = () => Promise.resolve(null);
  const sheet = {
    open(kind, seed, fields) { calls.push(['open', kind, seed, fields]); store.dispatch('sheetOpen', { kind, seed, fields }); return Promise.resolve(null); },
    close() { calls.push(['close']); store.dispatch('sheetClose'); },
    prepareNow(opts) { calls.push(['prepareNow', opts]); return prepare(); },
    change() {}, submit() {}, again() {},
  };
  const acts = [];
  const owner = { act(draft) { acts.push(draft); return Promise.resolve(act(draft)); } };
  const after = [];
  const afterAction = (kind, body) => { after.push([kind, body]); };
  let clock = NOW;
  const trade = startTrade({ store, getJson, owner, sheet, stream, schedule, cancelTimer, now: () => clock, afterAction });
  return {
    store, trade, reads, timers, due, fire, follows, calls, acts, after,
    t: () => store.get().trade,
    setClock(ms) { clock = ms; },
    holdPrepare(fn) { prepare = fn; },
  };
}

test('show reads the kind\'s picks now and every 20 s; a kind change reads its own; show(false) stops the poll', async () => {
  assert.deepEqual([PICKS_MS, PICK_LIMIT, FRESH_MS], [20_000, 12, 3_000]);
  const all = fx('explore-all');
  let held = null;
  const r = rig({
    answer: path => {
      if (path === CRYPTO) return held ? held.promise : picksOf(all, 'crypto');
      if (path === PREDICTIONS) return refused(409, { ok: false, refusal: { code: 'E_ACCOUNT_BAD_ACTION', message: 'Predictions are resting' } });
      return undefined;
    },
  });
  assert.deepEqual(r.reads, [], 'nothing is read until Trade is on screen');
  assert.deepEqual(r.due(), []);

  r.trade.show(true);
  assert.deepEqual(r.reads, [CRYPTO], 'the kind on screen at once');
  assert.equal(r.t().picks.crypto.status, 'loading');
  assert.deepEqual(r.due().map(t => t.ms), [PICKS_MS]);
  r.trade.show(true);
  assert.equal(r.due().length, 1, 'shown again: no second poll');
  assert.equal(r.reads.length, 1);
  await settle();
  assert.equal(r.t().picks.crypto.status, 'ready');
  assert.equal(r.t().picks.crypto.at, NOW);
  assert.equal(r.t().picks.crypto.data.items.length, picksOf(all, 'crypto').items.length);

  // every 20 s: again; a read still in the air is joined, not asked twice
  held = deferred();
  r.fire(PICKS_MS);
  assert.deepEqual(r.reads, [CRYPTO, CRYPTO]);
  assert.deepEqual(r.due().map(t => t.ms), [PICKS_MS], 'the next beat armed');
  r.trade.kind('crypto');
  assert.equal(r.reads.length, 2, 'one flight per kind');
  held.resolve(picksOf(all, 'crypto'));
  await settle();
  held = null;

  // a kind change: its picks at once, the poll over from now; the Account's sentence kept on its refusal
  const before = r.due()[0];
  r.trade.kind('predictions');
  assert.equal(r.t().kind, 'predictions');
  assert.deepEqual(r.reads.slice(2), [PREDICTIONS]);
  assert.equal(before.cancelled, true);
  assert.deepEqual(r.due().map(t => t.ms), [PICKS_MS]);
  await settle();
  assert.equal(r.t().picks.predictions.status, 'error');
  assert.equal(r.t().picks.predictions.message, 'Predictions are resting');
  assert.equal(r.t().picks.crypto.status, 'ready', 'another kind\'s read stays');
  r.trade.kind('nonsense');
  assert.equal(r.reads.length, 3, 'a kind Trade does not have reads nothing');
  assert.equal(r.t().kind, 'predictions');

  // off screen: the poll stops; nothing is read until it is back
  r.trade.show(false);
  assert.deepEqual(r.due(), []);
  r.fire();
  assert.equal(r.reads.length, 3);
  r.trade.show(true);
  assert.deepEqual(r.reads.slice(3), [PREDICTIONS], 'back on screen: the kind on screen at once');
  assert.deepEqual(r.due().map(t => t.ms), [PICKS_MS]);
});

test('query reads the trade search into its own results; a blank query reads nothing and drops the one in the air', async () => {
  const all = fx('explore-all');
  let held = null;
  const r = rig({ answer: path => (path.startsWith('/data/account/explore?q=') ? (held ? held.promise : { ...all, items: all.items.slice(0, 2) }) : undefined) });
  r.trade.query('  eth usd ');
  assert.equal(r.t().q, '  eth usd ');
  assert.deepEqual(r.reads, ['/data/account/explore?q=eth%20usd&limit=12']);
  assert.equal(r.t().results.status, 'loading');
  assert.equal(r.store.get().markets.results.status, 'idle', 'never the Markets search\'s');
  await settle();
  assert.equal(r.t().results.status, 'ready');
  assert.equal(r.t().results.data.items.length, 2);

  held = deferred();
  r.trade.query('btc');
  assert.equal(r.reads.length, 2);
  r.trade.query('   ');
  assert.equal(r.reads.length, 2, 'a blank query reads nothing');
  assert.equal(r.t().q, '   ');
  held.resolve({ ...all, items: [] });
  await settle();
  assert.equal(r.t().results.data.items.length, 2, 'the dropped read lands nowhere');

  const failing = rig({ answer: () => refused(409, { ok: false, refusal: { message: 'Search is resting' } }) });
  failing.trade.query('x');
  await settle();
  assert.equal(failing.t().results.status, 'error');
  assert.equal(failing.t().results.message, 'Search is resting');
});

test('pick opens the ticket and the order sheet on the best able line and follows it; a venue change re-seeds and re-follows', async () => {
  const r = rig();
  r.trade.pick('coin:ETH');
  assert.deepEqual(r.t().ticket, { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 });
  const [open] = r.calls;
  assert.equal(open[0], 'open');
  assert.equal(open[1], 'order');
  assert.equal(open[2].id, 'coin:ETH');
  assert.deepEqual(open[2].ticket, ticketOf(r.store.get(), NOW), 'the seed carries the ticket as ruled now');
  assert.deepEqual(open[3], { venue: 'ex', side: 'buy', outcome: '0', ...FORM }, 'the best able line');
  assert.deepEqual(r.follows, [['ex:ETH/USDT']]);

  // a venue given that takes the order is kept; a sell of it opens as a sell
  r.trade.pick('coin:ETH', { side: 'sell', venue: 'wallet' });
  assert.deepEqual(r.calls.at(-1)[3], { venue: 'wallet', side: 'sell', outcome: '0', ...FORM });
  assert.deepEqual(r.follows.at(-1), ['wallet:WETH/USDC@Base']);
  // a venue given that does not take the order (a public listing) opens on the best able line
  r.trade.pick('coin:ETH', { venue: 'standin-pubex-public' });
  assert.equal(r.calls.at(-1)[3].venue, 'ex');
  assert.deepEqual(r.follows.at(-1), ['ex:ETH/USDT']);

  // the wiring changed the venue field, then tells the host: the sheet re-seeded with the fields kept, the new line followed
  r.store.dispatch('sheetField', { name: 'amount', value: '25' });
  r.store.dispatch('sheetField', { name: 'venue', value: 'paper-momentum' });
  const opens = r.calls.filter(c => c[0] === 'open').length;
  r.trade.venue('paper-momentum');
  const reseed = r.calls.at(-1);
  assert.equal(r.calls.filter(c => c[0] === 'open').length, opens + 1);
  assert.equal(reseed[1], 'order');
  assert.equal(reseed[2].id, 'coin:ETH');
  assert.deepEqual(reseed[2].ticket, ticketOf(r.store.get(), NOW));
  assert.deepEqual(reseed[3], { venue: 'paper-momentum', side: 'buy', outcome: '0', ...FORM, amount: '25' }, 'what was typed is kept');
  assert.deepEqual(r.follows.at(-1), ['paper-momentum:ETH/USD']);
  r.store.dispatch('sheetSigning');
  const signing = r.calls.length;
  r.trade.venue('wallet');
  assert.equal(r.calls.length, signing, 'a sheet signing is not re-seeded under its signature');
  assert.deepEqual(r.follows.at(-1), ['paper-momentum:ETH/USD']);

  // a prediction (its kind's picks read): its outcome as the field's text, its line followed
  r.store.dispatch('picksLoaded', { kind: 'predictions', data: fx('explore-predictions'), at: NOW });
  r.trade.pick('event:predict:SI-FEDCUT-DEC', { side: 'sell', venue: 'predict', outcome: 1 });
  assert.deepEqual(r.calls.at(-1)[3], { venue: 'predict', side: 'sell', outcome: '1', ...FORM });
  assert.deepEqual(r.follows.at(-1), ['predict:SI-FEDCUT-DEC:YES']);

  // a market no read lists: the sheet says Pick where, nothing is followed
  r.trade.pick('coin:NOPE');
  assert.equal(r.calls.at(-1)[2].ticket, null);
  assert.equal(r.calls.at(-1)[3].venue, '');
  assert.deepEqual(r.follows.at(-1), []);
  const n = r.calls.length;
  r.trade.pick('');
  assert.equal(r.calls.length, n, 'no market, no ticket');

  // closeTicket: the ticket and the sheet closed, the follow released
  r.trade.pick('coin:ETH');
  r.trade.closeTicket();
  assert.equal(r.t().ticket, null);
  assert.deepEqual(r.calls.at(-1), ['close']);
  assert.equal(r.store.get().sheet, null);
  assert.deepEqual(r.follows.at(-1), []);
  const m = r.calls.length;
  r.trade.venue('wallet');
  assert.equal(r.calls.length, m, 'no ticket open: a venue change re-seeds nothing');
});

test('a quote frame for the followed line re-prepares quietly once the shown quote is 3 s old, one at a time', async () => {
  const r = rig();
  const quote = (key, extra = {}) => ({ type: 'quote', id: undefined, data: { key, venue: key.split(':')[0], symbol: key.slice(key.indexOf(':') + 1), bid: 2455.4, ask: 2455.8, live: true, ...extra } });
  r.trade.onStreamEvent(quote('ex:ETH/USDT'));
  assert.equal(r.calls.length, 0, 'no ticket: nothing to prepare');
  r.trade.pick('coin:ETH');
  r.store.dispatch('sheetField', { name: 'amount', value: '25' });
  const prepared = n => r.calls.filter(c => c[0] === 'prepareNow').length === n;

  r.trade.onStreamEvent(quote('ex:ETH/USDT'));
  assert.ok(prepared(0), 'the sheet is not ready: nothing');
  r.store.dispatch('sheetPrepared', { prepared: fx('prepared-order'), at: NOW, asked: 'x', deadline: null });
  r.setClock(NOW + FRESH_MS - 1);
  r.trade.onStreamEvent(quote('ex:ETH/USDT'));
  assert.ok(prepared(0), 'under 3 s: the shown quote stands');
  r.setClock(NOW + FRESH_MS);
  r.trade.onStreamEvent(quote('wallet:WETH/USDC@Base'));
  r.trade.onStreamEvent(quote('ex:ETH/USD'));
  assert.ok(prepared(0), 'another line\'s quote: nothing');

  const held = deferred();
  r.holdPrepare(() => held.promise);
  r.trade.onStreamEvent(quote('ex:ETH/USDT'));
  assert.ok(prepared(1));
  assert.deepEqual(r.calls.at(-1), ['prepareNow', { quiet: true }]);
  r.trade.onStreamEvent(quote('ex:ETH/USDT'));
  assert.ok(prepared(1), 'one quiet re-prepare in the air at a time');
  held.resolve(null);
  await settle();
  r.holdPrepare(() => Promise.resolve(null));
  r.trade.onStreamEvent(quote('ex:ETH/USDT'));
  assert.ok(prepared(2), 'landed: the next frame may ask again');
  await settle();

  // a frame without a key, by its venue and symbol
  r.trade.onStreamEvent({ type: 'quote', data: { venue: 'ex', symbol: 'ETH/USDT', live: true } });
  assert.ok(prepared(3));
  // a sheet asking or signing is left alone; a frame that is no record is nothing
  r.store.dispatch('sheetSigning');
  r.trade.onStreamEvent(quote('ex:ETH/USDT'));
  r.trade.onStreamEvent({ type: 'quote', data: null });
  r.trade.onStreamEvent(null);
  assert.ok(prepared(3));
  // after the ticket closes, its line's quotes are nothing
  r.trade.closeTicket();
  r.trade.onStreamEvent(quote('ex:ETH/USDT'));
  assert.ok(prepared(3));
});

test('a fill frame is said in its words; a fill with no words says nothing', () => {
  const r = rig();
  r.trade.onStreamEvent({ type: 'fill', data: { venue: 'ex', venueName: 'Stand-in Exchange', side: 'buy', qty: 0.04, symbol: 'ETH/USDT', price: 3120.5 } });
  assert.equal(r.t().said, 'Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange');
  r.trade.onStreamEvent({ type: 'fill', data: { side: 'sideways' } });
  assert.equal(r.t().said, 'Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange', 'no words: nothing said over it');
  r.trade.onStreamEvent({ type: 'order', data: { side: 'sell', qty: 1, symbol: 'X' } });
  assert.equal(r.t().said, 'Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange', 'an order frame is not a fill');
});

test('cancel acts once through the owner device and says the answer; a refusal says the Account\'s sentence', async () => {
  const held = deferred();
  let answer = () => held.promise;
  const r = rig({ act: d => answer(d) });
  const first = r.trade.cancel('ex', 'ord-0010');
  r.trade.cancel('ex', 'ord-0010');
  assert.deepEqual(r.acts, [{ type: 'liveCancel', venue: 'ex', order: 'ord-0010' }], 'a second press while it is in the air acts nothing');
  const taken = { ok: true, kind: 'order', order: { id: 'ord-0010', status: 'canceled' } };
  held.resolve({ status: 200, body: taken });
  await first;
  assert.equal(r.t().said, 'ord-0010 · canceled');
  assert.deepEqual(r.after, [['cancel', taken]]);

  answer = () => ({ status: 409, body: { ok: false, refusal: { code: 'E_ACCOUNT_BAD_ACTION', message: 'That order is already filled' } } });
  await r.trade.cancel('ex', 'ord-0010');
  assert.equal(r.acts.length, 2, 'landed: it may be pressed again');
  assert.equal(r.t().said, 'That order is already filled');
  assert.equal(r.after.length, 1, 'a refusal changed nothing at the Account');

  answer = () => { throw new Error('gone'); };
  await r.trade.cancel('broker', 'ord-0011');
  assert.equal(r.t().said, 'Refused', 'no answer is a refusal');
  assert.equal(r.after.length, 1);
});

test('close stops the poll, releases the follow, and nothing lands after', async () => {
  const all = fx('explore-all');
  const picks = deferred();
  const search = deferred();
  const cancelled = deferred();
  const r = rig({
    answer: path => (path === CRYPTO ? picks.promise : search.promise),
    act: () => cancelled.promise,
  });
  r.trade.show(true);
  r.trade.query('eth');
  r.trade.pick('coin:ETH');
  r.store.dispatch('sheetPrepared', { prepared: fx('prepared-order'), at: NOW - FRESH_MS, asked: 'x', deadline: null });
  const cancel = r.trade.cancel('ex', 'ord-0010');
  const before = r.store.get();
  const reads = r.reads.length;

  r.trade.close();
  assert.deepEqual(r.due(), [], 'the poll stopped');
  assert.deepEqual(r.follows.at(-1), [], 'the follow released');
  picks.resolve(picksOf(all, 'crypto'));
  search.resolve(all);
  const taken = { ok: true, kind: 'order', order: { id: 'ord-0010', status: 'canceled' } };
  cancelled.resolve({ status: 200, body: taken });
  await cancel;
  await settle();
  assert.equal(r.t().picks.crypto.status, 'loading', 'the picks answer lands nowhere');
  assert.equal(r.t().results.status, 'loading', 'the search answer lands nowhere');
  assert.equal(r.t().said, null, 'the cancel answer is said nowhere');
  assert.deepEqual(r.after, [['cancel', taken]], 'the Account changed all the same: the reads after it are told');

  const calls = r.calls.length;
  const follows = r.follows.length;
  r.trade.show(true);
  r.trade.kind('predictions');
  r.trade.query('btc');
  r.trade.pick('coin:BTC');
  r.trade.venue('wallet');
  r.trade.closeTicket();
  r.trade.onStreamEvent({ type: 'quote', data: { key: 'ex:ETH/USDT' } });
  r.trade.onStreamEvent({ type: 'fill', data: { side: 'buy', qty: 1, symbol: 'BTC/USD', venueName: 'X' } });
  await r.trade.cancel('ex', 'ord-0012');
  assert.equal(r.reads.length, reads, 'nothing is read after close');
  assert.equal(r.calls.length, calls, 'the sheet is not touched');
  assert.equal(r.follows.length, follows, 'nothing followed');
  assert.equal(r.acts.length, 1, 'nothing acted');
  assert.deepEqual(r.store.get().trade, before.trade, 'the slice as it was');
  r.trade.close();
  assert.equal(r.follows.length, follows, 'closed twice: nothing more');
});
