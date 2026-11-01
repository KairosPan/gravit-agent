// face/client/js/host/sell-many.js — Sell many (plan 4b Task 3), the retired page openSellMany
// (the retired page at 9614314c, ui/earn.js:219-360) on the face: what the Account says can be sold (/data/account/sellable),
// up to SELL_MANY_MAX of it picked, each leg prepared by the Account in turn (a market sell of what is held, or — a perpetual,
// a future — the position's close), then one signature each, in turn, through the owner device (owner.prepare, owner.submit:
// the face holds no key). Each leg's answer stays where it landed: sold, the Account's refusal in its words, or — a DEX sale —
// waiting for the operator's own wallet, whose send is handed to `sendOrder` (app.js: to sendFromWallet, which reads the Account
// again once the wallet answers — host/wallet-send.js keys it, so a later press joins it). A holding is picked once, so it is never
// signed twice; a leg whose signature has under SELL_MANY_RESIGN_MS left is prepared again first; close() signs nothing
// further and lands nothing more; afterAction('sellMany') once when a run ends. The drawer's whole state is the store's
// `sellMany`; render/account.js draws it.
import { refusedAt, whyOf, saidOf } from './owner-view.js';

/** At most this many legs at once (earn.js:221). */
export const SELL_MANY_MAX = 10;
/** A leg whose signature has less than this left is prepared again before it is signed (earn.js:305). */
export const SELL_MANY_RESIGN_MS = 15_000;
const SELLABLE = '/data/account/sellable?fresh=1';
/** A DEX sale's words (earn.js:321): the order waits for the operator's wallet. */
export const WALLET_WORDS = 'Your wallet has to send it: it waits under Trade › Under way, Send from wallet…';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

/** earn.js:223-227 — one leg as the owner signs it: a market sell of `qty` (else all the item can sell, `sellQty`), or — a
 *  perpetual, a future — the position's close, of `qty` only where it is less than all of it. */
export function smDraft(item, qty) {
  const n = String(qty ?? '').trim();
  if (item.action === 'close') return { type: 'liveClose', venue: item.venue, symbol: item.symbol, qty: n && Number(n) < item.held ? n : '' };
  return { type: 'liveOrder', venue: item.venue, symbol: item.symbol, side: 'sell', orderType: 'market', qty: n || String(item.sellQty), limitPrice: '', stopPrice: '', tif: '', postOnly: '', reduceOnly: '' };
}

/** earn.js:239-242 — what the Account says can be sold, narrowed to one venue when one is named: the items an order could go for
 *  now, how many others were left out, and the venues that could not be read. */
export function smSellable(body, venue = '') {
  const within = id => !venue || id === venue;
  const mine = records(body?.items).filter(x => within(x.venue));
  return { items: mine.filter(x => x.ready === true), hidden: mine.filter(x => x.ready !== true).length, missing: records(body?.missing).filter(m => !m.venue || within(m.venue)) };
}

/** earn.js:229 — a holding by name: a position says it is closed. */
export const smLegName = x => (x.action === 'close' ? `Close ${str(x.side)} ${str(x.asset)}`.replace(/\s+/g, ' ').trim() : str(x.asset));

const qtyWord = n => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1000 ? 2 : 8 }) : '—');
const dollars = n => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '');

/** earn.js:231-236 — one prepared leg in words: `{ head, usd, path }`. */
export function smLegWords(leg) {
  const p = leg?.prepared;
  const item = leg?.item ?? {};
  if (!isRecord(p?.action)) return null;
  if (p.action.type === 'liveClose') {
    return { head: `Close ${str(p.action.qty) || `all ${qtyWord(item.held)}`} · ${str(item.asset)}`, usd: item.usd !== undefined ? `≈ ${dollars(item.usd)}` : '', path: `${str(item.venueName)} · at market, it only shrinks the position` };
  }
  const q = isRecord(p.quote?.order) ? p.quote.order : {};
  return { head: str(q.words), usd: typeof q.notionalUsd === 'number' ? `≈ ${dollars(q.notionalUsd)}` : '', path: `${str(item.venueName)} · at market${str(q.note) ? ` · ${q.note}` : ''}` };
}

// a preparation the Account made: a 200 with an action and the fields it shows
const preparedOf = r => (r?.status === 200 && !refusedAt(r) && isRecord(r.body?.action) && Array.isArray(r.body?.shown) ? r.body : null);
const deadlineOf = p => { const d = Number(p?.action?.deadline); return Number.isFinite(d) && d > 0 ? d : null; };

/** @param {{ store: any, getJson: any, owner: any, sendOrder?: (order: object) => unknown, afterAction?: (kind: string) => void, now?: () => number }} hosts */
export function startSellMany({ store, getJson, owner, sendOrder = () => {}, afterAction = () => {}, now = Date.now }) {
  let gen = 0;   // the drawer's phase: a read, a review or a run started for an older one lands nothing
  const get = () => store.get().sellMany;
  const set = patch => { const s = get(); if (s) store.dispatch('sellManySet', { ...s, ...patch }); };
  const live = mine => mine === gen && get() !== null;
  // one leg's answer, landed where it is in the list
  const setLeg = (i, patch) => { const s = get(); if (s) set({ legs: s.legs.map((l, n) => (n === i ? { ...l, ...patch } : l)) }); };

  /** Open the drawer: what can be sold read past the face's cache, at one venue when one is named. */
  async function open(venue) {
    const mine = ++gen;
    store.dispatch('sellManySet', { status: 'reading', venue: str(venue), items: [], hidden: 0, missing: [], picked: [], qtys: {}, legs: [], full: false, message: null, said: null });
    let body;
    try { body = await getJson(SELLABLE); } catch (e) { body = e?.body ?? null; }
    if (!live(mine)) return;
    if (!isRecord(body) || body.ok === false) {
      set({ status: 'picking', message: str(body?.refusal?.message) || str(body?.error) || 'What is held could not be read.' });
      return;
    }
    set({ status: 'picking', ...smSellable(body, str(venue)) });
  }

  /** Pick an item, or let it go: never more than SELL_MANY_MAX (the one past it is refused, and `full` says so). */
  function toggle(index) {
    const s = get();
    const i = Number(index);
    if (!s || s.status !== 'picking' || !Number.isInteger(i) || !s.items[i]) return false;
    if (s.picked.includes(i)) { set({ picked: s.picked.filter(x => x !== i), full: false }); return true; }
    if (s.picked.length >= SELL_MANY_MAX) { set({ full: true }); return false; }
    set({ picked: [...s.picked, i].sort((a, b) => a - b), full: false });
    return true;
  }

  /** How much of an item to sell, as typed (blank: all it can sell). */
  function setQty(index, value) {
    const s = get();
    const i = Number(index);
    if (!s || s.status !== 'picking' || !Number.isInteger(i) || !s.items[i]) return;
    set({ qtys: { ...s.qtys, [i]: String(value ?? '') } });
  }

  /** Each picked leg prepared by the Account in turn: what it would sign, or why it would not go (its words). */
  async function review() {
    const s = get();
    if (!s || s.status !== 'picking' || !s.picked.length) return;
    const mine = ++gen;
    const picked = [...new Set(s.picked)].slice(0, SELL_MANY_MAX);
    set({ status: 'reviewing', legs: picked.map(i => ({ index: i, item: s.items[i], draft: smDraft(s.items[i], s.qtys[i]), state: 'asking', prepared: null, why: '', said: '' })) });
    for (let i = 0; i < picked.length; i++) {
      const leg = get().legs[i];
      const r = await owner.prepare(leg.draft);
      if (!live(mine)) return;
      const p = preparedOf(r);
      setLeg(i, p ? { state: 'ready', prepared: p } : { state: 'refused', why: whyOf(r) || 'Refused' });
    }
  }

  /** Back to the picks from the review (a run cannot go back). */
  function back() {
    const s = get();
    if (!s || s.status !== 'reviewing') return;
    gen += 1;
    set({ status: 'picking', legs: [] });
  }

  /** One signature each, in turn, for the legs the Account prepared — each once. Closed mid-run: nothing further is signed. */
  async function run() {
    const s = get();
    if (!s || s.status !== 'reviewing' || s.legs.some(l => l.state === 'asking')) return;
    const mine = ++gen;
    const go = s.legs.map((l, i) => [l, i]).filter(([l]) => l.state === 'ready');
    if (!go.length) return;
    set({ status: 'running', legs: s.legs.map(l => (l.state === 'ready' ? { ...l, state: 'waiting' } : l)) });
    let done = 0, waiting = 0;
    try {
      for (const [leg, i] of go) {
        if (!live(mine)) break;
        setLeg(i, { state: 'signing' });
        let p = leg.prepared;
        const d = deadlineOf(p);
        if (d !== null && d - now() < SELL_MANY_RESIGN_MS) {
          const again = await owner.prepare(leg.draft);
          if (!live(mine)) break;
          p = preparedOf(again);
          if (!p) { setLeg(i, { state: 'refused', why: whyOf(again) || 'Refused' }); continue; }
          setLeg(i, { prepared: p });
        }
        const r = await owner.submit(p);
        if (!live(mine)) break;
        if (refusedAt(r)) { setLeg(i, { state: 'refused', why: whyOf(r) || 'Refused' }); continue; }
        const o = r.body?.kind === 'order' && isRecord(r.body.order) ? r.body.order : null;
        if (o && o.walletTxs && !o.ref) {
          waiting += 1;
          setLeg(i, { state: 'wallet', said: WALLET_WORDS });
          try { sendOrder(o); } catch { /* it still waits under Under way */ }
          continue;
        }
        done += 1;
        const said = saidOf(r.body);
        setLeg(i, { state: 'sold', said: said ? `Sold · ${said}` : 'Sold' });
      }
    } finally {
      if (live(mine)) set({ status: 'done', said: `Sell many: ${done} of ${plural(go.length, 'sale')} went through${waiting ? `, ${waiting} waiting for your wallet` : ''}` });
      afterAction('sellMany');
    }
  }

  /** Close the drawer: what is in the air lands nothing, and a run signs nothing further. */
  function close() {
    gen += 1;
    if (get() !== null) store.dispatch('sellManySet', null);
  }

  return { open, toggle, setQty, review, run, back, close };
}
