// face/client/js/wire/wallet.js — the operator's own browser wallet, as the Account's page speaks to it (plan 4b Task 1): the
// wallets this browser has (EIP-6963, account/src/portfolio/public/ui/connect.js findWallets), an address proven by the wallet's
// signature on the Account's sentence (connect.js proveWallet), the wallet that holds an address (core.js walletFor), and the
// transactions the Account built sent by that wallet — an approval waited for on chain (core.js mined), the swap built again
// after it, every send on its own chain, Robinhood Chain offered to a wallet that does not know it (trade.js tkSwitchChain).
// The face holds no key: the wallet shows and signs everything in its own extension; this module only relays. It talks to the
// wallet's provider and to the `post` it is handed (the face's /data/account/* proxy), nothing else.

/* Robinhood Chain, for a wallet that does not know it yet: the wallet shows it to the owner before adding it (chain 4663; its own
   RPC and the explorer Robinhood publishes for it) — the Account page's TK_ROBINHOOD_CHAIN */
export const ROBINHOOD_CHAIN = Object.freeze({
  chainId: '0x1237', chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.mainnet.chain.robinhood.com/'], blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
});
export const MINED_EVERY_MS = 2_000, MINED_WITHIN_MS = 120_000;

/** A long hex address or hash as the Account's page shortens it (core.js short): `0x123456…cdef`; anything else as it is. */
export const short = a => (/^0x[0-9a-fA-F]{16,}$/.test(String(a)) ? `${String(a).slice(0, 8)}…${String(a).slice(-4)}` : String(a));
/** A sentence as the hex `personal_sign` takes (connect.js hexOf). */
export const hexOf = text => '0x' + [...new TextEncoder().encode(String(text))].map(b => b.toString(16).padStart(2, '0')).join('');

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const words = v => (typeof v === 'string' && v.trim() !== '' ? v : '');
// the Account's words when it refuses (owner-view.js whyOf's order)
const whyOf = r => words(r?.body?.refusal?.message) || words(r?.body?.error) || words(r?.body?.result?.message);
// a wallet's own words for a refusal (an EIP-1193 error is an object with a message, not always an Error)
const walletWords = err => words(err?.message) || words(typeof err === 'string' ? err : '') || 'the wallet refused';
const sleep = (schedule, ms) => new Promise(resolve => schedule(resolve, ms));
const defaultSchedule = (fn, ms) => setTimeout(fn, ms);

// window.ethereum's name, as connect.js names it
const ethName = eth => (eth.isOkxWallet || eth.isOKExWallet ? 'OKX Wallet' : eth.isBinance ? 'Binance Wallet' : eth.isCoinbaseWallet ? 'Coinbase Wallet'
  : eth.isMetaMask ? 'MetaMask' : 'Browser wallet');

/** The wallets this browser has: every EIP-6963 `announceProvider` answer to one `requestProvider`, heard for `waitMs`, each once
 *  (by its uuid, else its rdns, else its name; the last answer kept); none announced and a `win.ethereum`: that one, as the EIP
 *  says, named as the Account's page names it; none at all: []. Each `{ id, name, icon, provider }`. */
export async function discoverWallets(win, { waitMs = 120 } = {}) {
  const found = new Map();
  const hear = e => {
    const d = e?.detail;
    if (!isRecord(d) || !isRecord(d.info) || !d.provider) return;
    const id = words(d.info.uuid) || words(d.info.rdns) || words(d.info.name);
    if (id) found.set(id, { id, name: words(d.info.name) || 'Browser wallet', icon: words(d.info.icon), provider: d.provider });
  };
  const hears = typeof win?.addEventListener === 'function' && typeof win?.dispatchEvent === 'function';
  if (hears) {
    win.addEventListener('eip6963:announceProvider', hear);
    try { win.dispatchEvent(new (win.Event ?? globalThis.Event)('eip6963:requestProvider')); } catch { /* a page with no events: window.ethereum alone */ }
  }
  await new Promise(resolve => setTimeout(resolve, waitMs));
  if (hears && typeof win.removeEventListener === 'function') win.removeEventListener('eip6963:announceProvider', hear);
  const list = [...found.values()];
  const eth = win?.ethereum;
  if (!list.length && eth && typeof eth.request === 'function') list.push({ id: 'window.ethereum', name: ethName(eth), icon: '', provider: eth });
  return list;
}

// a provider request whose refusal is an Error in the wallet's own words
async function ask(wallet, method, params) {
  try {
    return await wallet.provider.request(params === undefined ? { method } : { method, params });
  } catch (err) {
    throw Object.assign(new Error(walletWords(err)), { code: err?.code });
  }
}

/** An address shown to be the owner's: the wallet's address (`eth_requestAccounts`) and chain (`eth_chainId`, 1 when it does not
 *  say), the Account's sentence for it (`/data/account/wallet/challenge`), the wallet's signature on that sentence
 *  (`personal_sign`), the signature checked by the Account (`/data/account/wallet/prove`). `post(path, body)` answers
 *  `{ status, body }` (host/owner.js postVia). Resolves `{ address, wallet }`, the Account's address and the wallet's name; a
 *  refusal throws an Error in the Account's words, or the wallet's. */
export async function proveWallet(wallet, post) {
  const accounts = await ask(wallet, 'eth_requestAccounts');
  const address = Array.isArray(accounts) ? accounts[0] : undefined;
  if (!words(address)) throw new Error('the wallet gave no address');
  let chainId = 1;
  try { chainId = parseInt(await wallet.provider.request({ method: 'eth_chainId' }), 16) || 1; } catch { chainId = 1; }
  const c = await post('/data/account/wallet/challenge', { address, wallet: wallet.name, chainId });
  if (c?.status !== 200 || !words(c.body?.message)) throw new Error(whyOf(c) || 'no sentence to sign');
  const signature = await ask(wallet, 'personal_sign', [hexOf(c.body.message), address]);
  const p = await post('/data/account/wallet/prove', { address, signature });
  if (p?.status !== 200) throw new Error(whyOf(p) || 'the signature did not check');
  return { address: p.body?.address ?? address, wallet: wallet.name };
}

/** The wallet of `wallets` whose `eth_accounts` holds `address` (in any case); none: an Error naming the address. */
export async function walletFor(wallets, address) {
  const want = String(address ?? '').toLowerCase();
  for (const w of Array.isArray(wallets) ? wallets : []) {
    let accounts = [];
    try { accounts = await w.provider.request({ method: 'eth_accounts' }); } catch { accounts = []; }
    if ((Array.isArray(accounts) ? accounts : []).some(a => String(a).toLowerCase() === want)) return w;
  }
  throw new Error(`No wallet on this page holds ${short(address)}`);
}

/* a wallet's "I don't know that chain" (EIP-3085: 4902), as wallets wrap it */
const unknownChain = err => !!err && (err.code === 4902 || err.data?.originalError?.code === 4902);

/** The wallet on the transaction's chain: switched to it; a wallet that does not know Robinhood Chain is offered it first, then
 *  switched again. Any other refusal: an Error in the wallet's words. */
export async function switchChain(wallet, chainIdHex) {
  try {
    await wallet.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
  } catch (err) {
    if (!(unknownChain(err) && String(chainIdHex).toLowerCase() === ROBINHOOD_CHAIN.chainId)) throw new Error(`${wallet.name} did not switch to the right network: ${walletWords(err)}`);
    try {
      await wallet.provider.request({ method: 'wallet_addEthereumChain', params: [ROBINHOOD_CHAIN] });
      await wallet.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
    } catch (err2) {
      throw new Error(`${wallet.name} did not add Robinhood Chain: ${walletWords(err2)}`);
    }
  }
}

/** A transaction the wallet sent, waited for on chain as the wallet itself reports it (`eth_getTransactionReceipt` every 2 s, up
 *  to 120 s): a receipt with `status: "0x0"` throws, as does none in time. */
export async function mined(wallet, hash, { schedule = defaultSchedule, everyMs = MINED_EVERY_MS, withinMs = MINED_WITHIN_MS } = {}) {
  const tries = Math.max(1, Math.ceil(withinMs / everyMs));
  for (let i = 0; i < tries; i++) {
    let r = null;
    try { r = await wallet.provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }); } catch { r = null; }
    if (isRecord(r) && r.blockNumber) {
      if (r.status === '0x0') throw new Error(`transaction ${short(hash)} failed on chain`);
      return r;
    }
    await sleep(schedule, everyMs);
  }
  throw new Error(`transaction ${short(hash)} is not on chain yet: try again in a minute`);
}

// one transaction as the wallet takes it: what the Account built, its gas where it gave one
const txParams = t => ({ from: t.from, to: t.to, data: t.data, value: t.value, ...(t.gas ? { gas: t.gas } : {}) });

/** What the Account built, sent by the wallet: every transaction but the last sent and waited for on chain (an approval before
 *  its swap, a bridge's approval before its transfer), then — when `requote` is given and there were such — `requote()` once,
 *  whose answer (a fresh last transaction, or null to keep the one built) replaces the last; the last sent. Every send on its
 *  own chain first (switchChain). Resolves the last transaction's hash. */
export async function sendTxs(wallet, txs, { requote = null, schedule = defaultSchedule } = {}) {
  const all = Array.isArray(txs) ? txs.filter(isRecord) : [];
  if (!all.length) throw new Error('nothing for the wallet to send');
  const send = async t => {
    await switchChain(wallet, t.chainIdHex);
    return ask(wallet, 'eth_sendTransaction', [txParams(t)]);
  };
  for (const t of all.slice(0, -1)) await mined(wallet, await send(t), { schedule });
  let last = all[all.length - 1];
  if (typeof requote === 'function' && all.length > 1) {
    const fresh = await requote();
    if (isRecord(fresh)) last = fresh;
  }
  return send(last);
}
