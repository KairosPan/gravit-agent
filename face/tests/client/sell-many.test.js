// Sell many (plan 4b Task 3): host/sell-many.js over a fake owner whose prepare and submit answer per draft, a fake wallet send
// and a fake clock — the Account page's own openSellMany (account/src/portfolio/public/ui/earn.js:219-360): what can be sold,
// up to ten picked, each leg prepared in turn, one signature each in turn, a leg near its deadline prepared again, a DEX sale
// handed to the wallet, each answer kept where it landed, and close() signing nothing further.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startSellMany, SELL_MANY_MAX, SELL_MANY_RESIGN_MS, WALLET_WORDS, smDraft } from '../../client/js/host/sell-many.js';

const START = 1_792_854_000_000;
const TEN_MINUTES = 600_000;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

// what the Account says can be sold (service.ts Sellable): a spot sale, a perpetual's close, a DEX sale, a refused one, and
// two left out
const item = (asset, over = {}) => ({ key: `crypto:${asset}`, asset, venue: 'ex', venueName: 'Stand-in Exchange', action: 'sell', symbol: `${asset}/USDT`, kind: 'spot', held: 2, sellQty: 2, price: 10, usd: 20, ready: true, ...over });
const SELLABLE = {
  ok: true,
  items: [
    item('SOL', { held: 25, sellQty: 25, usd: 3571.25 }),
    item('BTC', { action: 'close', symbol: 'BTC/USDT:USDT', kind: 'perp', side: 'long', held: 0.01, sellQty: 0.01, usd: 624.99 }),
    item('WETH', { venue: 'dex', venueName: 'Stand-in DEX', symbol: 'WETH/USDC', held: 0.35, sellQty: 0.35 }),
    item('ETH', { held: 1.8, sellQty: 1.8 }),
    item('DUST', { ready: false, why: 'below the smallest order' }),
    item('AAPL', { venue: 'broker', venueName: 'Stand-in Broker', ready: false, why: 'the market is closed' }),
  ],
  missing: [{ venue: 'kraken', venueName: 'Kraken', why: 'the venue said 429' }],
};

function rig({ sellable = SELLABLE } = {}) {
  const clock = { t: START };
  const store = createStore({ initial: emptyState(), reducers });
  const reads = [];
  const getJson = async path => { reads.push(path); return structuredClone(sellable); };
  // per draft symbol: prepare's answer (a function of the draft, or a body), submit's answer
  const owner = { prepared: [], submitted: [], prepareAs: {}, submitAs: {}, onSubmit: null, nonce: 1 };
  owner.prepare = async draft => {
    owner.prepared.push(draft);
    const as = owner.prepareAs[draft.symbol];
    const r = typeof as === 'function' ? as(draft) : as;
    if (r) return r;
    return { status: 200, body: { ok: true, action: { ...draft, nonce: owner.nonce++, deadline: clock.t + TEN_MINUTES }, shown: [{ name: 'Sell', value: draft.symbol }], quote: { order: { words: `sell ${draft.qty} ${draft.symbol}`, notionalUsd: 20 } } } };
  };
  owner.submit = async prepared => {
    owner.submitted.push(prepared);
    const as = owner.submitAs[prepared.action.symbol];
    const r = typeof as === 'function' ? as(prepared) : as;
    if (owner.onSubmit) owner.onSubmit(prepared);
    return r ?? { status: 200, body: { ok: true, kind: 'order', order: { id: `ord-${owner.submitted.length}`, status: 'filled' } } };
  };
  const wallet = { orders: [], order(o) { this.orders.push(o); if (this.onOrder) this.onOrder(o); return Promise.resolve({ status: 'sending' }); } };
  const after = [];
  const sm = startSellMany({ store, getJson, owner, walletSend: wallet, afterAction: k => after.push(k), now: () => clock.t });
  return { store, sm, owner, wallet, after, reads, clock, state: () => store.get().sellMany };
}

const REFUSED = message => ({ status: 409, body: { ok: false, refusal: { code: 'E_ACCOUNT_BAD_ACTION', message } } });

test('open lists the ready items and counts the rest', async () => {
  const r = rig();
  const opening = r.sm.open();
  assert.equal(r.state().status, 'reading');
  await opening;
  assert.deepEqual(r.reads, ['/data/account/sellable?fresh=1'], 'past the face\'s cache');
  const s = r.state();
  assert.equal(s.status, 'picking');
  assert.deepEqual(s.items.map(x => x.asset), ['SOL', 'BTC', 'WETH', 'ETH']);
  assert.equal(s.hidden, 2, 'the two that cannot be sold now, counted');
  assert.deepEqual(s.missing, [{ venue: 'kraken', venueName: 'Kraken', why: 'the venue said 429' }]);
  // one venue named: its items alone
  const one = rig();
  await one.sm.open('broker');
  assert.deepEqual([one.state().items.length, one.state().hidden], [0, 1]);
  // a refusal said in the Account's words
  const no = rig({ sellable: { ok: false, refusal: { message: 'the account is read-only' } } });
  await no.sm.open();
  assert.equal(no.state().message, 'the account is read-only');
  // closed while it read: nothing lands
  const gone = rig();
  const p = gone.sm.open();
  gone.sm.close();
  await p;
  assert.equal(gone.state(), null);
});

test('the eleventh pick is refused', async () => {
  const many = { ok: true, items: Array.from({ length: 12 }, (_, i) => item(`C${i}`)), missing: [] };
  const r = rig({ sellable: many });
  await r.sm.open();
  for (let i = 0; i < SELL_MANY_MAX; i++) assert.equal(r.sm.toggle(i), true);
  assert.equal(r.sm.toggle(10), false, 'the eleventh');
  assert.equal(r.state().picked.length, 10);
  assert.equal(r.state().full, true);
  assert.equal(r.sm.toggle(3), true, 'one let go');
  assert.equal(r.state().full, false);
  assert.equal(r.sm.toggle(10), true, 'now it fits');
  assert.equal(r.sm.toggle(99), false, 'no such item');
  // a pick toggled twice is one pick, never two: a holding is never signed twice
  r.sm.toggle(10); r.sm.toggle(10);
  assert.equal(new Set(r.state().picked).size, r.state().picked.length);
});

test('review prepares each leg in turn and keeps a refusal as its why', async () => {
  const r = rig();
  await r.sm.open();
  r.sm.toggle(0); r.sm.toggle(1); r.sm.toggle(3);
  r.sm.setQty(0, '10');
  r.owner.prepareAs['ETH/USDT'] = REFUSED('below the smallest order at Stand-in Exchange');
  await r.sm.review();
  const s = r.state();
  assert.equal(s.status, 'reviewing');
  assert.deepEqual(r.owner.prepared, [
    { type: 'liveOrder', venue: 'ex', symbol: 'SOL/USDT', side: 'sell', orderType: 'market', qty: '10', limitPrice: '', stopPrice: '', tif: '', postOnly: '', reduceOnly: '' },
    { type: 'liveClose', venue: 'ex', symbol: 'BTC/USDT:USDT', qty: '' },
    { type: 'liveOrder', venue: 'ex', symbol: 'ETH/USDT', side: 'sell', orderType: 'market', qty: '1.8', limitPrice: '', stopPrice: '', tif: '', postOnly: '', reduceOnly: '' },
  ], 'in turn: the qty typed, a close of all of it, the item\'s sellQty');
  assert.deepEqual(s.legs.map(l => [l.item.asset, l.state, l.why]), [['SOL', 'ready', ''], ['BTC', 'ready', ''], ['ETH', 'refused', 'below the smallest order at Stand-in Exchange']]);
  assert.ok(s.legs[0].prepared.action.nonce);
  assert.deepEqual(smDraft({ action: 'close', venue: 'ex', symbol: 'X', held: 2 }, '1'), { type: 'liveClose', venue: 'ex', symbol: 'X', qty: '1' }, 'part of a position');
  assert.equal(smDraft({ action: 'close', venue: 'ex', symbol: 'X', held: 2 }, '2').qty, '', 'all of it is no qty');
  // Back: to the picks, the legs gone
  r.sm.back();
  assert.equal(r.state().status, 'picking');
  assert.deepEqual(r.state().legs, []);
  assert.deepEqual(r.state().picked, [0, 1, 3], 'the picks stay');
});

test('run signs each in turn and re-prepares a leg near its deadline', async () => {
  const r = rig();
  await r.sm.open();
  r.sm.toggle(0); r.sm.toggle(3);
  await r.sm.review();
  // the clock moves on: the first leg's signature is under fifteen seconds, the second's still good
  const first = r.state().legs[0].prepared;
  r.clock.t = first.action.deadline - SELL_MANY_RESIGN_MS + 1;
  r.state().legs[1].prepared.action.deadline = r.clock.t + TEN_MINUTES;
  const order = [];
  r.owner.onSubmit = p => order.push(p.action.symbol);
  await r.sm.run();
  assert.equal(r.owner.prepared.length, 3, 'the near one prepared again, the other not');
  assert.equal(r.owner.prepared[2].symbol, 'SOL/USDT');
  assert.deepEqual(order, ['SOL/USDT', 'ETH/USDT'], 'one signature each, in turn');
  assert.notEqual(r.owner.submitted[0], first, 'the fresh preparation signed, not the near one');
  assert.equal(r.owner.submitted[0].action.nonce, 3);
  const s = r.state();
  assert.equal(s.status, 'done');
  assert.deepEqual(s.legs.map(l => [l.state, l.said]), [['sold', 'Sold · ord-1 · filled'], ['sold', 'Sold · ord-2 · filled']]);
  assert.equal(s.said, 'Sell many: 2 of 2 sales went through');
  assert.deepEqual(r.after, ['sellMany'], 'the Account read again once');
  // a second run of the same review signs nothing again
  await r.sm.run();
  assert.equal(r.owner.submitted.length, 2);
});

test('a run with a refused prepare, a refused signature, a DEX sale and the drawer closed after the second leg', async () => {
  const r = rig();
  await r.sm.open();
  for (const i of [0, 1, 2, 3]) r.sm.toggle(i);
  // SOL's preparation is refused at the review; BTC's signature is refused; WETH sells on a DEX and waits for the wallet; ETH
  // would sell, but the drawer is closed as the wallet's send starts
  r.owner.prepareAs['SOL/USDT'] = REFUSED('SOL/USDT is not trading now');
  r.owner.submitAs['BTC/USDT:USDT'] = REFUSED('the position changed since: prepare it again');
  const dex = { id: 'ord-dex', clientId: 'c-dex', status: 'pending', walletTxs: [{ from: '0x1', to: '0x2', data: '0x' }] };
  r.owner.submitAs['WETH/USDC'] = { status: 200, body: { ok: true, kind: 'order', order: dex } };
  await r.sm.review();
  assert.deepEqual(r.state().legs.map(l => l.state), ['refused', 'ready', 'ready', 'ready']);
  let seen = null;
  r.wallet.onOrder = () => { seen = structuredClone(r.state()); r.sm.close(); };
  await r.sm.run();
  await settle();
  // the words where they landed, as the drawer last showed them
  assert.deepEqual(seen.legs.map(l => [l.item.asset, l.state, l.why || l.said]), [
    ['SOL', 'refused', 'SOL/USDT is not trading now'],
    ['BTC', 'refused', 'the position changed since: prepare it again'],
    ['WETH', 'wallet', WALLET_WORDS],
    ['ETH', 'waiting', ''],
  ]);
  assert.equal(WALLET_WORDS, 'Your wallet has to send it: it waits under Trade › Under way, Send from wallet…');
  assert.deepEqual(r.wallet.orders, [dex], 'the DEX sale\'s wallet send started, once');
  assert.deepEqual(r.owner.submitted.map(p => p.action.symbol), ['BTC/USDT:USDT', 'WETH/USDC'], 'a refused preparation is never signed; nothing after the close');
  assert.equal(r.state(), null, 'closed');
  assert.deepEqual(r.after, ['sellMany'], 'the Account read again once');
});

test('closed while a signature is in the air: its answer lands nothing and nothing further is signed', async () => {
  const r = rig();
  await r.sm.open();
  r.sm.toggle(0); r.sm.toggle(3);
  await r.sm.review();
  let release;
  r.owner.submitAs['SOL/USDT'] = () => new Promise(res => { release = () => res({ status: 200, body: { ok: true, kind: 'order', order: { id: 'ord-1', status: 'filled' } } }); });
  const running = r.sm.run();
  await settle();
  r.sm.close();
  release();
  await running;
  assert.equal(r.owner.submitted.length, 1);
  assert.equal(r.state(), null);
  assert.deepEqual(r.after, ['sellMany']);
});
