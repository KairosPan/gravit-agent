// wire/wallet.js against a fake EIP-1193 provider: discovery, an address proven, the wallet that holds it, what it sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverWallets, proveWallet, walletFor, sendTxs, switchChain, mined, hexOf, short, ROBINHOOD_CHAIN } from '../../client/js/wire/wallet.js';
import { fakeProvider, fakeWin, ADDRESS, hashOf, now } from './helpers/fake-wallet.js';

const wallet = (provider, name = 'Fake Wallet') => ({ id: name, name, icon: '', provider });
const TX = (what, over = {}) => ({ chainId: 8453, chainIdHex: '0x2105', from: ADDRESS, to: '0x' + '34'.repeat(20), data: '0xabcd', value: '0x0', what, ...over });

test('discoverWallets lists each announced wallet once, else window.ethereum, else none', async () => {
  const a = fakeProvider();
  const b = fakeProvider();
  const win = fakeWin({
    times: 2,
    announce: [
      { info: { uuid: 'u-1', rdns: 'io.metamask', name: 'MetaMask', icon: 'data:image/svg+xml,a' }, provider: a },
      { info: { rdns: 'com.okx', name: 'OKX Wallet' }, provider: b },
      { info: { name: 'No provider' } },
    ],
    ethereum: fakeProvider({ flags: { isMetaMask: true } }),
  });
  const found = await discoverWallets(win, { waitMs: 1 });
  assert.deepEqual(found.map(w => [w.id, w.name, w.icon]), [['u-1', 'MetaMask', 'data:image/svg+xml,a'], ['com.okx', 'OKX Wallet', '']]);
  assert.equal(found[0].provider, a);
  assert.equal(found[1].provider, b);
  assert.deepEqual(win.listeners['eip6963:announceProvider'], [], 'the listener goes when the wait ends');
  // nothing announced: the injected one, named as the Account's page names it
  const eth = fakeProvider({ flags: { isCoinbaseWallet: true } });
  const one = await discoverWallets(fakeWin({ ethereum: eth }), { waitMs: 1 });
  assert.deepEqual(one.map(w => [w.id, w.name]), [['window.ethereum', 'Coinbase Wallet']]);
  assert.equal(one[0].provider, eth);
  assert.equal((await discoverWallets(fakeWin({ ethereum: fakeProvider() }), { waitMs: 1 }))[0].name, 'Browser wallet');
  assert.deepEqual(await discoverWallets(fakeWin(), { waitMs: 1 }), []);
  assert.deepEqual(await discoverWallets({}, { waitMs: 1 }), [], 'a window with no events and no wallet');
});

test('proveWallet posts the challenge and the proof and returns the Account\'s address', async () => {
  const provider = fakeProvider({ chainId: '0x2105' });
  const posts = [];
  const post = async (path, body) => {
    posts.push([path, body]);
    if (path === '/data/account/wallet/challenge') return { status: 200, body: { ok: true, message: 'example.com wants you to sign in' } };
    return { status: 200, body: { ok: true, address: ADDRESS.toUpperCase().replace('0X', '0x'), wallet: 'Fake Wallet' } };
  };
  const out = await proveWallet(wallet(provider), post);
  assert.deepEqual(out, { address: ADDRESS.toUpperCase().replace('0X', '0x'), wallet: 'Fake Wallet' });
  assert.deepEqual(posts[0], ['/data/account/wallet/challenge', { address: ADDRESS, wallet: 'Fake Wallet', chainId: 8453 }]);
  const sign = provider.requests.find(r => r.method === 'personal_sign');
  assert.deepEqual(sign.params, [hexOf('example.com wants you to sign in'), ADDRESS]);
  assert.equal(hexOf('ab'), '0x6162');
  assert.deepEqual(posts[1], ['/data/account/wallet/prove', { address: ADDRESS, signature: '0x' + 'ee'.repeat(65) }]);
  // a wallet that does not say its chain: chain 1
  const quiet = fakeProvider({ answers: { eth_chainId: () => { throw new Error('no'); } } });
  posts.length = 0;
  await proveWallet(wallet(quiet), post);
  assert.equal(posts[0][1].chainId, 1);
});

test('a declined signature throws the wallet\'s words and posts no proof', async () => {
  const provider = fakeProvider({ answers: { personal_sign: () => { throw { code: 4001, message: 'User rejected the request.' }; } } });
  const posts = [];
  const post = async (path, body) => { posts.push(path); return { status: 200, body: { ok: true, message: 'sign this' } }; };
  await assert.rejects(proveWallet(wallet(provider), post), err => err instanceof Error && err.message === 'User rejected the request.' && err.code === 4001);
  assert.deepEqual(posts, ['/data/account/wallet/challenge']);
});

test('the Account\'s refusal of the proof is its words', async () => {
  const provider = fakeProvider();
  const post = async path => (path === '/data/account/wallet/challenge'
    ? { status: 200, body: { ok: true, message: 'sign this' } }
    : { status: 400, body: { ok: false, refusal: { code: 'E_ACCOUNT_BAD_SIGNATURE', message: 'that signature is not this address\'s' } } });
  await assert.rejects(proveWallet(wallet(provider), post), { message: 'that signature is not this address\'s' });
  // and its refusal of the challenge
  const noSentence = async () => ({ status: 400, body: { ok: false, refusal: { message: 'writes are off' } } });
  await assert.rejects(proveWallet(wallet(fakeProvider()), noSentence), { message: 'writes are off' });
});

test('walletFor finds the wallet that holds the address, in any case, else says none does', async () => {
  const other = wallet(fakeProvider({ accounts: ['0x' + '99'.repeat(20)] }), 'Other');
  const mine = wallet(fakeProvider({ accounts: [ADDRESS.toUpperCase().replace('0X', '0x')] }), 'Mine');
  assert.equal(await walletFor([other, mine], ADDRESS), mine);
  assert.equal(mine.provider.count('eth_requestAccounts'), 0, 'asked with eth_accounts, which opens no prompt');
  await assert.rejects(walletFor([other], ADDRESS), { message: `No wallet on this page holds ${short(ADDRESS)}` });
  assert.equal(short(ADDRESS), '0x121212…1212');
});

test('sendTxs waits for the approval on chain, requotes once, sends the fresh swap', async () => {
  let receipts = 0;
  const provider = fakeProvider({ answers: { eth_getTransactionReceipt: () => (++receipts < 3 ? null : { blockNumber: '0x11', status: '0x1' }) } });
  const waits = [];
  const schedule = (fn, ms) => { waits.push(ms); return now(fn); };
  let requotes = 0;
  const requote = async () => {
    requotes += 1;
    assert.equal(receipts, 3, 'after the approval is on chain');
    return TX('swap', { data: '0xf4e5' });
  };
  const hash = await sendTxs(wallet(provider), [TX('approve', { gas: '0x5208' }), TX('swap')], { requote, schedule });
  assert.equal(hash, hashOf(2));
  assert.equal(requotes, 1);
  assert.deepEqual(waits, [2000, 2000], 'a receipt asked every 2 s');
  const sends = provider.requests.filter(r => r.method === 'eth_sendTransaction').map(r => r.params[0]);
  assert.deepEqual(sends, [
    { from: ADDRESS, to: TX('approve').to, data: '0xabcd', value: '0x0', gas: '0x5208' },
    { from: ADDRESS, to: TX('swap').to, data: '0xf4e5', value: '0x0' },
  ]);
  assert.deepEqual(provider.methods().filter(m => m !== 'eth_getTransactionReceipt'),
    ['wallet_switchEthereumChain', 'eth_sendTransaction', 'wallet_switchEthereumChain', 'eth_sendTransaction'], 'every send on its own chain first');
  // a requote that keeps the swap built (null): the swap as it was
  const p2 = fakeProvider();
  await sendTxs(wallet(p2), [TX('approve'), TX('swap', { data: '0x5a5a' })], { requote: async () => null, schedule: now });
  assert.equal(p2.requests.filter(r => r.method === 'eth_sendTransaction').at(-1).params[0].data, '0x5a5a');
  // one transaction alone: no receipt waited for, no requote
  const p3 = fakeProvider();
  let asked = 0;
  assert.equal(await sendTxs(wallet(p3), [TX('send')], { requote: async () => { asked += 1; return null; }, schedule: now }), hashOf(1));
  assert.equal(asked, 0);
  assert.equal(p3.count('eth_getTransactionReceipt'), 0);
});

test('a receipt with status 0x0 throws and sends nothing more', async () => {
  const provider = fakeProvider({ answers: { eth_getTransactionReceipt: () => ({ blockNumber: '0x11', status: '0x0' }) } });
  let requoted = false;
  await assert.rejects(sendTxs(wallet(provider), [TX('approve'), TX('swap')], { requote: async () => { requoted = true; return null; }, schedule: now }),
    { message: `transaction ${short(hashOf(1))} failed on chain` });
  assert.equal(provider.count('eth_sendTransaction'), 1);
  assert.equal(requoted, false);
  // none on chain in time
  const slow = fakeProvider({ answers: { eth_getTransactionReceipt: () => null } });
  await assert.rejects(mined(wallet(slow), hashOf(7), { schedule: now, everyMs: 2000, withinMs: 6000 }), /is not on chain yet/);
  assert.equal(slow.count('eth_getTransactionReceipt'), 3);
  // a declined send is the wallet's words
  const no = fakeProvider({ answers: { eth_sendTransaction: () => { throw { code: 4001, message: 'User denied transaction signature.' }; } } });
  await assert.rejects(sendTxs(wallet(no), [TX('send')], { schedule: now }), { message: 'User denied transaction signature.' });
});

test('switchChain adds Robinhood Chain on 4902 and switches again', async () => {
  let switches = 0;
  const provider = fakeProvider({ answers: { wallet_switchEthereumChain: () => { if (++switches === 1) throw { code: 4902, message: 'Unrecognized chain ID' }; return null; } } });
  await switchChain(wallet(provider), '0x1237');
  assert.deepEqual(provider.methods(), ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
  assert.deepEqual(provider.requests[1].params, [ROBINHOOD_CHAIN]);
  assert.equal(ROBINHOOD_CHAIN.chainId, '0x1237');
  // wrapped as a wallet wraps it
  let s2 = 0;
  const wrapped = fakeProvider({ answers: { wallet_switchEthereumChain: () => { if (++s2 === 1) throw { code: -32603, data: { originalError: { code: 4902 } } }; return null; } } });
  await switchChain(wallet(wrapped), '0x1237');
  assert.equal(wrapped.count('wallet_addEthereumChain'), 1);
  // another chain the wallet does not know: said, nothing added
  const other = fakeProvider({ answers: { wallet_switchEthereumChain: () => { throw { code: 4902, message: 'Unrecognized chain ID' }; } } });
  await assert.rejects(switchChain(wallet(other), '0xa4b1'), { message: 'Fake Wallet did not switch to the right network: Unrecognized chain ID' });
  assert.equal(other.count('wallet_addEthereumChain'), 0);
  // the owner declines adding it
  const decline = fakeProvider({ answers: { wallet_switchEthereumChain: () => { throw { code: 4902 }; }, wallet_addEthereumChain: () => { throw { code: 4001, message: 'User rejected' }; } } });
  await assert.rejects(switchChain(wallet(decline), '0x1237'), { message: 'Fake Wallet did not add Robinhood Chain: User rejected' });
});
