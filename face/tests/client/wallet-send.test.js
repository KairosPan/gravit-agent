// host/wallet-send.js against a fake wallet and a fake Account: asked again first, sent once, reported once; Report again
// reports the kept hash and never asks the wallet to send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWalletSend, paymentKeyOf, orderKeyOf } from '../../client/js/host/wallet-send.js';
import { reducers } from '../../client/js/reducers/account.js';
import { emptyState } from '../../client/js/data/empty.js';
import { short } from '../../client/js/wire/wallet.js';
import { fakeProvider, ADDRESS, hashOf, now } from './helpers/fake-wallet.js';

const TX = (what, over = {}) => ({ chainId: 8453, chainIdHex: '0x2105', from: ADDRESS, to: '0x' + '34'.repeat(20), data: '0xabcd', value: '0x0', what, ...over });
const PAY = { id: 'pay-0007', at: '2026-11-01T14:00:00.000Z', kind: 'send', from: 'w1', to: 'ex', status: 'authorized', legs: [{ native: { walletTx: TX('send') } }], live: { network: 'Base' } };
const ORDER = { id: 'ord-0031', clientId: 'c0ffee00c0ffee00c0ffee00c0ffee00', venue: 'dex', status: 'pending', walletTxs: [TX('approve'), TX('swap')] };

// the store as the app's: the account reducers over the empty state, every dispatch recorded
function fakeStore() {
  let s = emptyState();
  const seen = [];
  return { get: () => s, dispatch(type, payload) { seen.push([type, payload]); s = reducers[type](s, payload); }, seen };
}
// the Account: its page as given (a function of the reads so far, or a value), its routes answering as told, every post recorded
function fakeAccount({ page, answers = {} }) {
  const posts = [];
  let reads = 0;
  return {
    posts,
    reads: () => reads,
    getJson: async path => { assert.equal(path, '/data/account?fresh=1', 'asked past the face\'s cache'); reads += 1; return typeof page === 'function' ? page(reads) : page; },
    post: async (path, body) => {
      posts.push([path, body]);
      const a = answers[path];
      return typeof a === 'function' ? a(body, posts) : a ?? { status: 200, body: { ok: true } };
    },
    sent: path => posts.filter(([p]) => p === path).map(([, b]) => b),
  };
}
function harness({ page, answers, provider = fakeProvider() }) {
  const store = fakeStore();
  const acct = fakeAccount({ page, answers });
  const wallets = [{ id: 'fake', name: 'Fake Wallet', icon: '', provider }];
  const ws = startWalletSend({ store, post: acct.post, getJson: acct.getJson, getWallets: async () => wallets, schedule: now });
  return { store, acct, provider, ws };
}

test('a payment is asked again before it is sent, then reported', async () => {
  const h = harness({ page: { ok: true, payments: [PAY], orders: [] } });
  const key = paymentKeyOf(PAY);
  assert.equal(key, 'pay-0007@2026-11-01T14:00:00.000Z');
  const out = await h.ws.payment(PAY, TX('send'), undefined);
  assert.equal(h.acct.reads(), 1);
  assert.equal(h.provider.count('eth_sendTransaction'), 1);
  assert.deepEqual(h.acct.posts, [['/data/account/live/sent', { payment: 'pay-0007', hash: hashOf(1) }]]);
  assert.deepEqual(out, { key, status: 'sent', said: `Fake Wallet sent it: ${short(hashOf(1))}` });
  assert.deepEqual(h.store.get().account.wallet[key], { status: 'sent', said: `Fake Wallet sent it: ${short(hashOf(1))}`, again: false });
  assert.deepEqual(h.store.seen.map(([, p]) => p.status), ['sending', 'sent']);
  assert.equal(h.store.seen[0][1].said, 'Waiting for your wallet…');
  // failed, but expired: sent again; a page that no longer has it authorized: nothing sent
  const expired = harness({ page: { ok: true, payments: [{ ...PAY, status: 'failed', live: { expired: true } }] } });
  assert.equal((await expired.ws.payment(PAY, TX('send'))).status, 'sent');
  const settled = harness({ page: { ok: true, payments: [{ ...PAY, status: 'pending' }] } });
  assert.deepEqual(await settled.ws.payment(PAY, TX('send')), { key, status: 'refused', said: 'pay-0007 is no longer waiting for your wallet (pending): nothing was sent' });
  assert.equal(settled.provider.requests.length, 0, 'the wallet is never asked');
  const gone = harness({ page: { ok: true, payments: [] } });
  assert.equal((await gone.ws.payment(PAY, TX('send'))).said, 'pay-0007 is no longer waiting for your wallet (gone): nothing was sent');
  // a bridge: its approval on chain before the transfer, then the transfer reported
  const bridge = harness({ page: { ok: true, payments: [PAY] } });
  await bridge.ws.payment(PAY, TX('transfer'), [TX('approve'), TX('transfer')]);
  assert.deepEqual(bridge.provider.methods().filter(m => m === 'eth_sendTransaction' || m === 'eth_getTransactionReceipt'), ['eth_sendTransaction', 'eth_getTransactionReceipt', 'eth_sendTransaction']);
  assert.deepEqual(bridge.acct.sent('/data/account/live/sent'), [{ payment: 'pay-0007', hash: hashOf(2) }]);
});

test('a payment already reported is reported again, never sent', async () => {
  const reported = '0x' + 'bb'.repeat(32);
  const h = harness({ page: { ok: true, payments: [{ ...PAY, live: { reported } }] } });
  const out = await h.ws.payment(PAY, TX('send'));
  assert.equal(h.provider.requests.length, 0, 'the wallet is not asked at all');
  assert.deepEqual(h.acct.posts, [['/data/account/live/sent', { payment: 'pay-0007', hash: reported }]]);
  assert.equal(out.said, `Your wallet sent it: ${short(reported)}`);
  // an order's: the same
  const o = harness({ page: { ok: true, orders: [{ ...ORDER, reported }] } });
  await o.ws.order(ORDER);
  assert.equal(o.provider.requests.length, 0);
  assert.deepEqual(o.acct.posts, [['/data/account/live/order-sent', { order: 'ord-0031', hash: reported }]]);
});

test('pressed twice, one send', async () => {
  let release;
  const held = new Promise(r => { release = r; });
  const provider = fakeProvider({ answers: { eth_sendTransaction: async () => { await held; return hashOf(1); } } });
  const h = harness({ page: { ok: true, payments: [PAY] }, provider });
  const first = h.ws.payment(PAY, TX('send'));
  const second = h.ws.payment(PAY, TX('send'));
  assert.equal(first, second, 'the second press joins the first');
  release();
  await Promise.all([first, second]);
  assert.equal(provider.count('eth_sendTransaction'), 1);
  assert.equal(h.acct.sent('/data/account/live/sent').length, 1);
  // a DEX order pressed twice: one flow, by its client id
  let releaseO;
  const heldO = new Promise(r => { releaseO = r; });
  const pO = fakeProvider({ answers: { eth_getTransactionReceipt: async () => { await heldO; return { blockNumber: '0x1', status: '0x1' }; } } });
  const o = harness({ page: { ok: true, orders: [ORDER] }, provider: pO });
  assert.equal(orderKeyOf(ORDER), ORDER.clientId);
  const a = o.ws.order(ORDER);
  const b = o.ws.order({ ...ORDER });
  assert.equal(a, b);
  releaseO();
  await a;
  assert.equal(pO.count('eth_sendTransaction'), 2, 'its approval and its swap, once each');
  assert.deepEqual(o.acct.sent('/data/account/live/order-requote'), [{ order: 'ord-0031' }]);
  assert.deepEqual(o.acct.sent('/data/account/live/order-sent'), [{ order: 'ord-0031', hash: hashOf(2) }]);
});

test('the wallet sent and the report failed: Report again reports the kept hash and the wallet is never asked to send again', async () => {
  let reports = 0;
  const h = harness({
    page: { ok: true, payments: [PAY] },
    answers: { '/data/account/live/sent': () => (++reports < 3 ? { status: 0, body: { ok: false, error: 'The Account did not answer' } } : { status: 200, body: { ok: true } }) },
  });
  const key = paymentKeyOf(PAY);
  const failed = `The Account did not answer. Your wallet sent ${short(hashOf(1))}: Report again reports that same transaction, it does not send another`;
  assert.deepEqual(await h.ws.payment(PAY, TX('send')), { key, status: 'refused', said: failed });
  assert.deepEqual(h.store.get().account.wallet[key], { status: 'refused', said: failed, again: true });
  assert.equal(h.ws.holds(key), true);
  // Report again, refused once more: the same hash, the wallet not asked
  const asked = h.provider.requests.length;
  assert.equal((await h.ws.reportAgain(key)).said, failed);
  // and again, taken
  assert.deepEqual(await h.ws.reportAgain(key), { key, status: 'sent', said: `Fake Wallet sent it: ${short(hashOf(1))}` });
  assert.equal(h.provider.requests.length, asked, 'Report again never speaks to the wallet');
  assert.equal(h.provider.count('eth_sendTransaction'), 1);
  assert.deepEqual(h.acct.sent('/data/account/live/sent'), [1, 2, 3].map(() => ({ payment: 'pay-0007', hash: hashOf(1) })));
  assert.equal(h.store.get().account.wallet[key].again, false);
  assert.equal(h.ws.holds(key), false);
  assert.equal(await h.ws.reportAgain(key), null, 'nothing kept: nothing reported');
  assert.equal(h.acct.sent('/data/account/live/sent').length, 3);
  // a Send from wallet… pressed while the hash is kept (the row drawn before the refusal landed): reported, not sent
  const k = harness({ page: { ok: true, payments: [PAY] }, answers: { '/data/account/live/sent': (b, posts) => (posts.length < 2 ? { status: 500, body: { ok: false, refusal: { message: 'the account is busy' } } } : { status: 200, body: { ok: true } }) } });
  assert.match((await k.ws.payment(PAY, TX('send'))).said, /^the account is busy\. Your wallet sent /);
  assert.equal((await k.ws.payment(PAY, TX('send'))).status, 'sent');
  assert.equal(k.provider.count('eth_sendTransaction'), 1);
  // an order's report refused: Report again reports to order-sent
  const o = harness({ page: { ok: true, orders: [ORDER] }, answers: { '/data/account/live/order-sent': (b, posts) => (posts.filter(([p]) => p.endsWith('order-sent')).length < 2 ? { status: 400, body: { ok: false, refusal: { message: 'no order ord-0031 is waiting for a wallet' } } } : { status: 200, body: { ok: true } }) } });
  await o.ws.order(ORDER);
  const sentOnce = o.provider.count('eth_sendTransaction');
  assert.equal((await o.ws.reportAgain(ORDER.clientId)).status, 'sent');
  assert.equal(o.provider.count('eth_sendTransaction'), sentOnce);
  assert.deepEqual(o.acct.sent('/data/account/live/order-sent'), [{ order: 'ord-0031', hash: hashOf(2) }, { order: 'ord-0031', hash: hashOf(2) }]);
});

test("a hash kept when the order is then taken back is still reported: the Account learns the wallet did send", async () => {
  let pageNow = { ok: true, orders: [ORDER] };
  let reports = 0;
  const h = harness({ page: () => pageNow, answers: { '/data/account/live/order-sent': () => (++reports === 1 ? { status: 0, body: { ok: false, error: 'The Account did not answer' } } : { status: 200, body: { ok: true } }) } });
  assert.equal((await h.ws.order(ORDER)).status, 'refused');
  pageNow = { ok: true, orders: [{ ...ORDER, status: 'canceled' }] };
  const reads = h.acct.reads();
  assert.deepEqual(await h.ws.order(ORDER), { key: ORDER.clientId, status: 'sent', said: `Fake Wallet sent it: ${short(hashOf(2))}` });
  assert.equal(h.acct.reads(), reads, 'reported before the page is asked');
  assert.equal(h.provider.count('eth_sendTransaction'), 2, 'its approval and swap, once');
  assert.deepEqual(h.acct.sent('/data/account/live/order-sent'), [{ order: 'ord-0031', hash: hashOf(2) }, { order: 'ord-0031', hash: hashOf(2) }]);
});

test('an Account that cannot be read says so in words and sends nothing', async () => {
  const store = fakeStore();
  const provider = fakeProvider();
  const ws = startWalletSend({ store, post: async () => ({ status: 200, body: { ok: true } }), getJson: async path => { throw Object.assign(new Error(`${path}: HTTP 502`), { status: 502 }); }, getWallets: async () => [{ id: 'f', name: 'Fake Wallet', icon: '', provider }], schedule: now });
  assert.deepEqual(await ws.payment(PAY, TX('send')), { key: paymentKeyOf(PAY), status: 'refused', said: 'The Account could not be read: nothing was sent' });
  assert.equal((await ws.order(ORDER)).said, 'The Account could not be read: nothing was sent');
  assert.equal(provider.requests.length, 0);
});

test('an order taken back since the page was read sends nothing and says so', async () => {
  const h = harness({ page: { ok: true, orders: [{ ...ORDER, status: 'canceled' }] } });
  assert.deepEqual(await h.ws.order(ORDER), { key: ORDER.clientId, status: 'refused', said: 'ord-0031 is no longer waiting for your wallet (canceled): nothing was sent' });
  assert.equal(h.provider.requests.length, 0);
  assert.deepEqual(h.acct.posts, []);
  const placed = harness({ page: { ok: true, orders: [{ ...ORDER, ref: 'tx-1' }] } });
  assert.equal((await placed.ws.order(ORDER)).status, 'refused');
  assert.equal(placed.provider.requests.length, 0);
  const gone = harness({ page: { ok: true, orders: [] } });
  assert.equal((await gone.ws.order(ORDER)).said, 'ord-0031 is no longer waiting for your wallet (gone): nothing was sent');
});

test("a DEX order's swap is built again after its approval; a refusal to build it again keeps the one built, any other stops it", async () => {
  const fresh = TX('swap', { data: '0xfeed' });
  const h = harness({ page: { ok: true, orders: [ORDER] }, answers: { '/data/account/live/order-requote': { status: 200, body: { ok: true, order: { ...ORDER, walletTxs: [TX('approve'), fresh] } } } } });
  await h.ws.order(ORDER);
  assert.equal(h.provider.requests.filter(r => r.method === 'eth_sendTransaction').at(-1).params[0].data, '0xfeed');
  const kept = harness({ page: { ok: true, orders: [ORDER] }, answers: { '/data/account/live/order-requote': { status: 400, body: { ok: false, refusal: { message: 'the venue cannot build the swap again' } } } } });
  assert.equal((await kept.ws.order(ORDER)).status, 'sent');
  assert.equal(kept.provider.count('eth_sendTransaction'), 2);
  const stop = harness({ page: { ok: true, orders: [ORDER] }, answers: { '/data/account/live/order-requote': { status: 400, body: { ok: false, refusal: { message: 'the quote moved past its slippage' } } } } });
  assert.deepEqual(await stop.ws.order(ORDER), { key: ORDER.clientId, status: 'refused', said: 'the quote moved past its slippage' });
  assert.equal(stop.provider.count('eth_sendTransaction'), 1, 'the approval alone');
  assert.deepEqual(stop.acct.sent('/data/account/live/order-sent'), []);
  // no wallet on this page holds the address: said, nothing sent
  const none = harness({ page: { ok: true, orders: [ORDER] }, provider: fakeProvider({ accounts: [] }) });
  assert.equal((await none.ws.order(ORDER)).said, `No wallet on this page holds ${short(ADDRESS)}`);
  assert.equal(none.provider.count('eth_sendTransaction'), 0);
});

test('nothing lands after close()', async () => {
  let release;
  const held = new Promise(r => { release = r; });
  const provider = fakeProvider({ answers: { eth_sendTransaction: async () => { await held; return hashOf(1); } } });
  const h = harness({ page: { ok: true, payments: [PAY] }, provider });
  const flight = h.ws.payment(PAY, TX('send'));
  await new Promise(r => setTimeout(r, 0));
  const seen = h.store.seen.length;
  h.ws.close();
  release();
  await flight;
  assert.equal(h.store.seen.length, seen);
  assert.equal(await h.ws.payment({ ...PAY, at: 'later' }, TX('send')), null, 'closed: nothing starts');
});
