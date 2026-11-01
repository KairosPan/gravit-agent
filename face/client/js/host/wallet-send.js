// face/client/js/host/wallet-send.js — what the Account built for the operator's own browser wallet, sent by that wallet and
// reported to the Account once (plan 4b Task 1; the retired page money.js sendFromWallet, trade.js sendOrderFromWallet): a
// payment (a move out of a wallet, a bridge) or a DEX order. The retired page is asked again first — what is no longer waiting
// for the wallet sends nothing, and a hash the Account already holds is reported again, never sent again; then the wallet that
// holds the transactions' address sends them (wire/wallet.js sendTxs), and the hash it returns is reported. A hash the wallet
// sent is kept, per key, until the Account takes its report: Report again reports that same hash and never asks the wallet to
// send. One flight per key (a payment's `<id>@<at>`, an order's client id): a second press joins the first. What it says lands
// in the store as `account.wallet[key] = { status, said, again }` (`again`: a hash is kept for Report again); nothing lands
// after close(). The face holds no key: the wallet signs in its own extension.
import { walletFor, sendTxs, short } from '../wire/wallet.js';
import { whyOf } from './owner-view.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');
const list = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const PAGE = '/data/account?fresh=1';
/** What a press with nothing to key it by answers: nothing was sent. */
export const NO_KEY = 'Nothing was sent: this one carries no id the Account can send for. Refresh and try again.';

/** A flight's end as the face says it: its words (`say`) and the Account read again (`reload`); no answer (closed): nothing. A
 *  flight that rejected — past the engine's own words — says why instead of leaving an unhandled rejection. */
export function settleWalletFlight(flight, { say, reload }) {
  return Promise.resolve(flight).then(r => {
    if (!r) return;
    if (typeof r.said === 'string') say(r.said);
    reload();
  }).catch(err => {
    try { say(`Your wallet's send did not finish: ${String(err?.message || err || 'no answer').slice(0, 200)}`); } catch { /* nowhere to say it */ }
    try { reload(); } catch { /* nothing to read again */ }
  });
}

/** The key a payment's wallet flow is held by (the retired page: its id and time, which no other run of the Account reuses). */
export const paymentKeyOf = p => `${str(p?.id)}@${str(p?.at)}`;
/** The key a DEX order's wallet flow is held by: its client id. */
export const orderKeyOf = o => str(o?.clientId);

export function startWalletSend({ store, post, getJson, getWallets, schedule }) {
  let closed = false;
  const flights = new Map();   // key → the flow in the air for it
  const kept = new Map();      // key → { kind: 'payment' | 'order', id, hash, name }: sent by the wallet, its report not yet taken

  const say = (key, status, said) => {
    if (!closed) store.dispatch('walletSaid', { key, status, said, again: kept.has(key) });
    return { key, status, said };
  };
  const gone = (id, now) => new Error(`${id} is no longer waiting for your wallet (${now ? str(now.status) || 'gone' : 'gone'}): nothing was sent`);

  // one flow per key: a second press while one is in the air joins it; no key (no payment id, no client id): nothing sent, and
  // the answer says why — no row to hang it on, so nothing lands in the store (app.js sendFromWallet says it under Trade)
  function once(key, run) {
    if (!key || key.startsWith('@')) return Promise.resolve({ key: '', status: 'refused', said: NO_KEY });
    const inAir = flights.get(key);
    if (inAir) return inAir;
    if (closed) return Promise.resolve(null);
    say(key, 'sending', 'Waiting for your wallet…');
    const flight = (async () => {
      try { return await run(); } catch (err) { return say(key, 'refused', str(err?.message) || 'the wallet refused'); }
    })().finally(() => { flights.delete(key); });
    flights.set(key, flight);
    return flight;
  }

  // the kept hash reported; taken: forgotten and said; refused: kept, and said with what Report again does
  async function report(key) {
    const k = kept.get(key);
    const r = await post(k.kind === 'payment' ? '/data/account/live/sent' : '/data/account/live/order-sent',
      k.kind === 'payment' ? { payment: k.id, hash: k.hash } : { order: k.id, hash: k.hash });
    if (r?.status !== 200) {
      return say(key, 'refused', `${whyOf(r) || 'the account could not take the transaction'}. Your wallet sent ${short(k.hash)}: Report again reports that same transaction, it does not send another`);
    }
    kept.delete(key);
    return say(key, 'sent', `${k.name || 'Your wallet'} sent it: ${short(k.hash)}`);
  }

  // the Account's read, asked again past the face's cache; unreadable: said in words, and nothing is sent
  async function pageNow() {
    let page;
    try { page = await getJson(PAGE); } catch { throw new Error('The Account could not be read: nothing was sent'); }
    return isRecord(page) ? page : {};
  }

  return {
    /** A payment the Account built for the wallet (`/data/account/exchange`'s `result.payment` with `result.wallet` and
     *  `walletTxs`, or a page payment's `legs[0].native.walletTx`/`walletTxs`): sent only while the Account's read, asked again,
     *  still has it `authorized` (or `failed` with `live.expired`); a `live.reported` hash reported, not sent again. */
    payment(p, tx, txs) {
      const key = paymentKeyOf(p);
      return once(key, async () => {
        // a hash the wallet already sent is reported first, whatever became of the payment since: the Account learns it was sent
        if (kept.has(key)) return report(key);
        const now = list((await pageNow()).payments).find(x => x.id === p.id && x.at === p.at);
        if (!now || !(now.status === 'authorized' || (now.status === 'failed' && now.live?.expired))) throw gone(p.id, now);
        if (str(now.live?.reported)) kept.set(key, { kind: 'payment', id: p.id, hash: now.live.reported, name: '' });
        else {
          const all = list(txs).length ? list(txs) : list([tx]);
          if (!all.length) throw new Error(`${p.id} has nothing for your wallet to send`);
          const wallet = await walletFor(await getWallets(), all[0].from);
          const hash = await sendTxs(wallet, all, { schedule });
          kept.set(key, { kind: 'payment', id: p.id, hash, name: wallet.name });
        }
        return report(key);
      });
    },
    /** A DEX order waiting for the wallet (`walletTxs`, no `ref`): sent only while the Account's read, asked again, still has it
     *  `pending` with no `ref`; its `reported` hash reported, not sent again; after its approvals the swap built again from a
     *  fresh quote (`live/order-requote`; a refusal that it cannot build the swap again keeps the one built). */
    order(o) {
      const key = orderKeyOf(o);
      return once(key, async () => {
        // a hash the wallet already sent is reported first, even for an order taken back since (the Account takes it back on)
        if (kept.has(key)) return report(key);
        const now = list((await pageNow()).orders).find(x => x.id === o.id);
        if (!now || str(now.ref) || now.status !== 'pending') throw gone(o.id, now);
        if (str(now.reported)) kept.set(key, { kind: 'order', id: o.id, hash: now.reported, name: '' });
        else {
          const txs = list(now.walletTxs);
          if (!txs.length) throw new Error(`${o.id} has nothing for your wallet to send`);
          const wallet = await walletFor(await getWallets(), txs[0].from);
          const requote = async () => {
            const fresh = await post('/data/account/live/order-requote', { order: o.id });
            if (fresh?.status === 200) return list(fresh.body?.order?.walletTxs).at(-1) ?? null;
            if (/cannot build the swap again/.test(str(fresh?.body?.refusal?.message))) return null;
            throw new Error(whyOf(fresh) || 'the swap could not be built again');
          };
          const hash = await sendTxs(wallet, txs, { requote, schedule });
          kept.set(key, { kind: 'order', id: o.id, hash, name: wallet.name });
        }
        return report(key);
      });
    },
    /** The hash kept for `key` reported again — the wallet is never asked to send; none kept: nothing. */
    reportAgain(key) {
      if (!kept.has(key)) return flights.get(key) ?? Promise.resolve(null);
      return once(key, () => report(key));
    },
    /** Whether a hash is kept for `key`, its report not yet taken. */
    holds: key => kept.has(key),
    close() { closed = true; },
  };
}
