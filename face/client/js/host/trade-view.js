// face/client/js/host/trade-view.js — Trade's pure view (spec 2026-10-22 §6.4, plan 2 Task 9): the owner's hand order through
// the Account's own ticket. The kinds Trade picks from (the Account's own tabs); the picker by kind — what is held (the leading
// lens's rows matched to an Account key by matchKey, a prediction held opening as a sell of its outcome), what is starred, the
// kind's most traded (the explore read `tab=<kind>&limit=12`), a search's results; the ticket on a market's page — its lines,
// connected first with the ones that take the owner's order now marked `able` and the best of those marked, the public listings
// after, a prediction's outcomes with their lines; the ticket's sheet fields and the Account's liveOrder draft from them, its
// Trade ticket's type and fifteen fields (docs/research/2026-10-22-account-owner-path-map.md §3.1; prepare adds maxNotional and
// deadline: the seventeen it signs), nothing added or renamed — a
// prediction's limit typed in cents and sent in dollars; no clock in the draft (the deadline is prepare's); the quote from a
// preparation; the orders under way with what cancels each; a fill frame as one line. Every Account string passes as it came
// (the renderer escapes); every figure and word the Trade screen draws is computed here. No DOM, no store.
import { number, price } from '../wire/market-model.js';
import { accountTabs, outcomeWords, pageOf, legsOf, matchKey, priceOf, watchKeysOf } from './market-view.js';
import { pageOk, assetsOf, positionsOf, openOrdersOf, worthOf } from './account-view.js';
import { isCnKey } from '../wire/china.js';
import { t, tn, said } from '../i18n/words.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
const own = (o, k) => (isRecord(o) && typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : undefined);
const EM = '—';
// a plain decimal, as the Account takes its amounts and prices
const DECIMAL = /^\d+(\.\d+)?$/;

/** The kinds Trade picks from: the Account's crypto, stocks, RWAs and predictions tabs, its own ids — and, read at each call,
 *  its words (tradeKinds). */
export const TRADE_KIND_IDS = ['crypto', 'stocks', 'rwas', 'predictions'];
export const tradeKinds = () => { const tabs = new Map(accountTabs()); return TRADE_KIND_IDS.map(id => ({ id, label: tabs.get(id) })); };
const KIND_IDS = new Set(TRADE_KIND_IDS);

// the Trade kind an Account key is, by its prefix: perpetuals and pre-IPO contracts are not one
const KEY_KINDS = { coin: 'crypto', stock: 'stocks', rwa: 'rwas', event: 'predictions', kalshi: 'predictions', pm: 'predictions', pmus: 'predictions' };
const kindOfKey = key => { const head = str(key).split(':')[0]; return Object.hasOwn(KEY_KINDS, head) ? KEY_KINDS[head] : null; };
// a market's Trade kind: its own tabs, else its key's
const kindOfItem = item => (Array.isArray(item.tabs) ? item.tabs.find(tab => KIND_IDS.has(tab)) ?? null : kindOfKey(item.key));

/** Whether the face's ticket trades a market: its kind is one of TRADE_KIND_IDS, by its tabs, else its key's prefix. Perpetuals and
 *  pre-IPO perpetuals are listed, not traded from the face this round (spec 2026-10-22 §2); anything not a market is not. */
export const tradeableOf = item => isRecord(item) && kindOfItem(item) !== null;
// what the quantity is counted in, as the Account's ticket says it: a stock's shares, an event's contracts, else the base
const unitWordOf = item => (item.kind === 'stock' ? t('trade.unit.shares') : item.kind === 'event' ? t('trade.unit.contracts') : str(item.base) || str(item.name));
// an outcome as a person says it (market-view's words): YES → Yes, UP → Up
const outcomeWord = label => { const s = str(label); const words = outcomeWords(); return Object.hasOwn(words, s) ? words[s] : s; };
// dollars per contract as cents, without the float's noise
const cents = v => { const n = number(v); return n === null ? null : Number((n * 100).toPrecision(12)); };
const centsWord = c => (c === null ? EM : `${Number(c.toFixed(1))}¢`);
const amountWord = n => (n === null ? EM : n.toLocaleString('en-US', { maximumFractionDigits: 8 }));

// ── the reads Trade looks markets up in ──

const itemsOf = body => (body?.ok === true ? records(body.items) : []);
// the lists an explore answer carries beside its items: its movers, closing and most traded
const besideOf = body => (body?.ok === true ? [body.movers, body.closing, body.mostTraded].flatMap(records) : []);
// the bodies a market is looked for in: the kind's picks, the trade search's, the other kinds' picks, then the Markets reads
function bodiesOf(state) {
  const tr = isRecord(state?.trade) ? state.trade : {};
  const m = isRecord(state?.markets) ? state.markets : {};
  const picks = isRecord(tr.picks) ? tr.picks : {};
  return [
    own(own(picks, tr.kind), 'data'), tr.results?.data,
    ...Object.keys(picks).filter(k => k !== tr.kind).map(k => own(picks[k], 'data')),
    ...Object.values(isRecord(m.explore) ? m.explore : {}).map(r => r?.data), m.results?.data,
  ];
}
// every market those bodies carry: every body's items first, then the lists beside them
const rowsIn = state => { const bodies = bodiesOf(state); return [...bodies.flatMap(itemsOf), ...bodies.flatMap(besideOf)]; };
const findItem = (rows, key) => rows.find(i => i.key === key) ?? null;

// the page's venues that take an order: `trade.can` true at the Account
function tradingVenues(state) {
  const page = state?.account?.data;
  return new Set(pageOk(page) ? records(page.venues).filter(v => v.trade?.can === true).map(v => str(v.id)) : []);
}

// ── the picker ──

// a market's price in its unit's words: an event's in cents, anything else in dollars
const priceWordOf = item => { const p = priceOf(item); return p.price === null ? EM : p.unit === 'cents' ? centsWord(p.price) : price(p.price); };
// where a market trades for the owner: the connected venues that take an order, then how many public listings
function whereWords(item, trading) {
  const legs = legsOf(item);
  const able = [...new Set(legs.filter(l => l.connected && trading.has(l.venue)).map(l => l.venueName || l.venue))];
  const pub = legs.filter(l => l.public).length;
  return [able.join(t('common.list.sep')), pub ? tn('trade.publicVenues', pub) : ''].filter(Boolean).join(' · '); // words-order: where it trades under the visual separator
}
const marketRow = (item, trading) => ({ id: str(item.key), name: str(item.name), sub: whereWords(item, trading), priceWord: priceWordOf(item) });
// a starred market no read lists: its key's last part as its name
const placeholderRow = key => ({ id: key, name: key.slice(key.lastIndexOf(':') + 1), sub: t('markets.notInRead'), priceWord: EM });

// the face id a holdings row is, for matchKey: a crypto asset's dollar pair, an equity's US symbol; anything else is none
const FACE_IDS = { crypto: a => `crypto:${a}/USD`, equity: a => `us:${a}` };
function heldRows(state, kind, rows) {
  const a = isRecord(state?.account) ? state.account : {};
  const lens = worthOf(a.data, a.holdings?.data, a.paper?.data).paperLeads ? a.paper?.data : a.holdings?.data;
  const out = [];
  for (const r of assetsOf(lens)) {
    const face = Object.hasOwn(FACE_IDS, r.cls) && r.asset ? FACE_IDS[r.cls](r.asset) : null;
    const match = face ? matchKey(face) : null;
    if (!match) continue;
    const key = `${match.kind}:${match.q}`;
    if (kindOfKey(key) !== kind) continue;
    const venues = [...new Set(r.venues.map(v => v.venueName || v.venue).filter(Boolean))];
    out.push({
      id: key, name: str(findItem(rows, key)?.name) || r.asset, sub: [amountWord(r.amount), venues.join(t('common.list.sep'))].filter(Boolean).join(' · '),
      priceWord: r.price === null ? EM : price(r.price), ...(r.venues[0]?.venue ? { venue: r.venues[0].venue } : {}),
    });
  }
  // a prediction held is a position at one of an event's outcomes: it opens as a sell of that outcome, at that venue
  if (kind === 'predictions') {
    for (const p of positionsOf(lens)) {
      const item = rows.find(i => i.kind === 'event' && records(i.outcomes).some(o => records(o.at).some(l => l.venue === p.venue && l.symbol === p.symbol)));
      if (!item) continue;
      const outcomes = records(item.outcomes);
      const outcome = outcomes.findIndex(o => records(o.at).some(l => l.venue === p.venue && l.symbol === p.symbol));
      out.push({
        id: str(item.key), name: str(item.name),
        sub: [t('trade.contracts', { n: amountWord(p.qty) }), outcomeWord(outcomes[outcome].label), p.venueName || p.venue].join(' · '), // words-order: a prediction's facts under the visual separator
        priceWord: centsWord(cents(p.markPrice)), side: 'sell', venue: p.venue, outcome,
      });
    }
  }
  const seen = new Set();
  return out.filter(r => !seen.has(r.id) && seen.add(r.id));
}

/** The picker for the kind Trade is on, each group's rows `{ id, name, sub, priceWord, side?, venue?, outcome? }`: `held` —
 *  the leading lens's assets matched to an Account key by matchKey (a coin's, a stock's), and a prediction held, opening as a
 *  sell of its outcome at its venue; `watching` — the Account keys starred (`markets.watch`), then those the page's own watch
 *  list names (watchKeysOf over the reads Trade keeps), once each, of the kind, a star no read lists as a placeholder; `most` — the kind's picks read (`trade.picks[kind]`); `results` — while the query is not blank, the trade
 *  search's (`trade.results`) of the kind. `now` is the renderer's clock (no word here is aged). */
export function pickerOf(state, now) {
  const tr = isRecord(state?.trade) ? state.trade : {};
  const kind = str(tr.kind);
  const rows = rowsIn(state);
  const trading = tradingVenues(state);
  const ofKind = items => items.filter(i => kindOfItem(i) === kind).map(i => marketRow(i, trading));
  // the face's stars, then the page's own watch list as the keys the reads list it under
  const watch = [...(Array.isArray(state?.markets?.watch) ? state.markets.watch : []), ...watchKeysOf(state?.account?.data, rows)];
  return {
    held: heldRows(state, kind, rows),
    // an A share starred (a cn key, the face's or the page's china entry) is not Trade's: the face does not trade A shares
    watching: [...new Set(watch.filter(k => typeof k === 'string' && k !== '' && !isCnKey(k)))].filter(k => {
      const item = findItem(rows, k);
      return item ? kindOfItem(item) === kind : kindOfKey(k) === kind;
    }).map(k => { const item = findItem(rows, k); return item ? marketRow(item, trading) : placeholderRow(k); }),
    most: ofKind(itemsOf(own(own(tr.picks, kind), 'data'))),
    results: str(tr.q).trim() ? ofKind(itemsOf(tr.results?.data)) : [],
  };
}

// ── the ticket ──

// the tab a market's page is looked up under: every read Trade keeps, merged
const TICKET_TAB = 'trade';
const SIDES = new Set(['buy', 'sell']);

/** The ticket open (`trade.ticket`) on its market's page, or null while none is open, no read lists it, or it is not
 *  tradeableOf (a perpetual, a pre-IPO one): `{ id, item, page,
 *  legs, event, outcomes, unitWord, held, side, venue, outcome }`. `legs` are the page's lines, connected first, each `{ venue,
 *  venueName, symbol, price, bid, ask, best, paper, able, public, session }` in the market's unit — `able` a connected line
 *  whose venue trades at the Account (`trade.can === true`), `best` the able line that takes an order now (a key that trades,
 *  a market not closed) with the lowest ask, else the lowest price; `session` the line's own. A prediction's `outcomes` are
 *  `{ label, cents, bid, ask, at: [{ venue, symbol }] }`. `venue` is the one the ticket was opened at where that is an able line, else the best able line;
 *  `held` what is held of the market (the page's). */
export function ticketOf(state, now) {
  const open = state?.trade?.ticket;
  if (!isRecord(open) || typeof open.id !== 'string' || open.id === '') return null;
  const m = isRecord(state.markets) ? state.markets : {};
  const merged = { ok: true, items: rowsIn(state) };
  const page = pageOf({ ...m, tab: TICKET_TAB, explore: { ...(isRecord(m.explore) ? m.explore : {}), [TICKET_TAB]: { data: merged } } }, state.account, open.id, now);
  // a market the face's ticket does not trade (a perpetual, a pre-IPO one) opens none, whatever route or link asked for it
  if (!page || !tradeableOf(page.item)) return null;
  const item = page.item;
  const trading = tradingVenues(state);
  const lines = records(item.at);
  const lineOf = l => lines.find(x => x.venue === l.venue && x.symbol === l.symbol) ?? {};
  const legs = page.legs.map(l => ({
    venue: l.venue, venueName: l.venueName, symbol: l.symbol, price: l.price, bid: l.bid, ask: l.ask, best: false, paper: l.paper,
    able: l.connected && trading.has(l.venue), public: l.public, session: isRecord(lineOf(l).session) ? lineOf(l).session : null,
    takes: l.connected && trading.has(l.venue) && l.canTrade === true && lineOf(l).open !== false,
  }));
  const takes = legs.filter(l => l.takes);
  const by = takes.some(l => l.ask !== null) ? 'ask' : 'price';
  let best = null;
  for (const l of takes) if (l[by] !== null && (best === null || l[by] < best[by])) best = l;
  if (best) best.best = true;
  const shown = legs.map(({ takes: _t, ...l }) => l);
  const event = item.kind === 'event';
  // a venue given is kept only where the order can go: another (a holding's wallet, a public listing) opens on the best able line
  const given = typeof open.venue === 'string' && shown.some(l => l.able && l.venue === open.venue) ? open.venue : null;
  return {
    id: open.id, item, page, legs: shown, event,
    outcomes: event ? records(item.outcomes).map(o => ({
      label: outcomeWord(o.label), cents: cents(o.price), bid: cents(o.bid), ask: cents(o.ask),
      at: records(o.at).map(l => ({ venue: str(l.venue), symbol: str(l.symbol) })),
    })) : [],
    unitWord: unitWordOf(item), held: page.held,
    side: SIDES.has(open.side) ? open.side : 'buy',
    venue: given ?? (shown.find(l => l.best) ?? shown.find(l => l.able))?.venue ?? null,
    outcome: Number.isInteger(open.outcome) && open.outcome >= 0 ? open.outcome : 0,
  };
}

/** The order sheet's fields for the ticket, as the sheet engine keeps them: `venue` (a pick over the able lines, its value the
 *  venue's id), `side` (Buy or Sell), `outcome` (a prediction's, its value the outcome's index as text), `amount`, `unit`
 *  (Dollars or the market's unit), `orderType` (Market or Limit), `limit` (a prediction's in cents; the screen shows it for a
 *  limit), and `extendedHours` (a box, only where the ticket's line offers it). No ticket, no fields. */
export function tradeFieldsOf(ticket) {
  if (!isRecord(ticket) || !Array.isArray(ticket.legs)) return [];
  const able = ticket.legs.filter(l => l.able);
  const leg = able.find(l => l.venue === ticket.venue);
  return [
    { name: 'venue', label: t('trade.field.where'), type: 'pick', options: able.map(l => ({ value: l.venue, label: l.venueName || l.venue })), value: leg ? leg.venue : '' },
    { name: 'side', label: t('trade.field.side'), type: 'seg', options: [{ value: 'buy', label: t('trade.buy') }, { value: 'sell', label: t('trade.sell') }], value: SIDES.has(ticket.side) ? ticket.side : 'buy' },
    ...(ticket.event ? [{ name: 'outcome', label: t('trade.field.outcome'), type: 'seg', options: records(ticket.outcomes).map((o, i) => ({ value: String(i), label: o.label })), value: String(ticket.outcome ?? 0) }] : []),
    { name: 'amount', label: t('trade.field.amount'), type: 'number', placeholder: '25', value: '' },
    { name: 'unit', label: t('trade.field.unit'), type: 'select', options: [{ value: 'usd', label: t('trade.field.dollars') }, { value: 'qty', label: str(ticket.unitWord) || t('trade.field.units') }], value: 'usd' },
    { name: 'orderType', label: t('trade.field.orderType'), type: 'select', options: [{ value: 'market', label: t('trade.field.market') }, { value: 'limit', label: t('trade.field.limit') }], value: 'market' },
    { name: 'limit', label: ticket.event ? t('trade.field.limitCents') : t('trade.field.limitPrice'), type: 'number', placeholder: '', value: '' },
    ...(leg?.session?.extendedHours === true ? [{ name: 'extendedHours', label: t('trade.field.extendedHours'), type: 'check', value: false }] : []),
  ];
}

// a field's value from the form: the sheet's fields, or a plain { name: value }
function valueOf(fields, name) {
  if (Array.isArray(fields)) return fields.find(f => isRecord(f) && f.name === name)?.value;
  return isRecord(fields) ? fields[name] : undefined;
}
const textOf = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const field = (fields, name) => textOf(valueOf(fields, name));

/** A prediction's price typed in cents as the dollars the Account signs: the Account's tkPriceIn — dollars to six places,
 *  trailing zeros trimmed, a plain decimal, never an exponent — or null for anything but a plain decimal with `0 < c < 100`
 *  (or one too small to be a dollar figure at six places). The Trade ticket's limit and a Change sheet's prices alike. */
export function eventPriceOf(typed) {
  const text = typeof typed === 'string' ? typed.trim() : '';
  if (!DECIMAL.test(text)) return null;
  const c = Number(text);
  if (!(c > 0 && c < 100)) return null;
  const dollars = (c / 100).toFixed(6).replace(/\.?0+$/, '');
  return dollars === '0' ? null : dollars;
}

/** The Account's liveOrder draft from the ticket's fields — its Trade ticket's type and fifteen fields in its order (prepare adds
 *  maxNotional and deadline: the seventeen it signs): `type`, `venue`, `symbol` (the line's; a prediction's, the picked
 *  outcome's at that venue), `side`, `orderType`, `qty` or `usd` by `unit` (as typed), `limitPrice` (for a limit: as typed; a
 *  prediction's typed in cents and sent in dollars to six places), `extendedHours` (`'true'` only on a limit, ticked, where the
 *  line offers it), every other field `''` — or, while something is missing, the words for it. Reads no clock: the deadline
 *  is the Account's prepare's. */
export function tradeDraftOf(fields, ticket) {
  if (!isRecord(ticket) || !Array.isArray(ticket.legs)) return t('trade.missing.where');
  const venue = (v => (Array.isArray(v) ? textOf(v[0]) : textOf(v)))(valueOf(fields, 'venue'));
  const leg = ticket.legs.find(l => l.able && l.venue === venue);
  if (!leg) return t('trade.missing.where');
  let symbol = leg.symbol;
  if (ticket.event) {
    const i = Number(field(fields, 'outcome') || 0);
    const outcome = Number.isInteger(i) && i >= 0 ? records(ticket.outcomes)[i] : undefined;
    symbol = str(records(outcome?.at).find(l => l.venue === leg.venue)?.symbol);
  }
  if (!symbol) return t('trade.missing.where');
  const side = SIDES.has(field(fields, 'side')) ? field(fields, 'side') : 'buy';
  const amount = field(fields, 'amount');
  if (!DECIMAL.test(amount) || !(Number(amount) > 0)) return t('trade.missing.amount');
  const unit = field(fields, 'unit') === 'qty' ? 'qty' : 'usd';
  const orderType = field(fields, 'orderType') === 'limit' ? 'limit' : 'market';
  let limitPrice = '';
  if (orderType === 'limit') {
    const typed = field(fields, 'limit');
    if (!DECIMAL.test(typed)) return t('trade.missing.limit');
    if (ticket.event) {
      const dollars = eventPriceOf(typed);
      if (dollars === null) return t('trade.missing.cents');
      limitPrice = dollars;
    } else {
      if (!(Number(typed) > 0)) return t('trade.missing.limit');
      limitPrice = typed;
    }
  }
  // the Account's tkOrderDraft: extended hours ride a limit order alone
  const ticked = valueOf(fields, 'extendedHours');
  const extendedHours = orderType === 'limit' && (ticked === true || ticked === 'true') && leg.session?.extendedHours === true ? 'true' : '';
  return {
    type: 'liveOrder', venue: leg.venue, symbol, side, orderType, [unit]: amount, limitPrice, stopPrice: '', tif: '', postOnly: '',
    reduceOnly: '', extendedHours, trailPercent: '', trailPrice: '', takeProfit: '', stopLoss: '',
  };
}

// ── what the Account answers ──

/** The preparation's order quote (`prepared.quote.order`): its words, its figures each a number or null (the fee the order's
 *  own estimate — none given is null: the venue charges it as it does), whether it is paper, where its price is from and when,
 *  the market's name. A preparation without an order quote: null. */
export function quoteOf(prepared) {
  const quote = isRecord(prepared?.quote) ? prepared.quote : null;
  const o = isRecord(quote?.order) ? quote.order : null;
  if (!o) return null;
  return {
    words: str(o.words), price: number(o.price), notionalUsd: number(o.notionalUsd), maxUsd: number(o.maxUsd),
    feeUsd: number(o.feeUsd), capUsd: number(o.capUsd), paper: o.paper === true,
    quoteFrom: str(o.quoteFrom), quoteAt: str(o.quoteAt), name: str(o.name),
  };
}

// a payment in the retired page's words (statement.js whatOf): a swap, a transfer between one venue's ledgers, else its kind,
// from → to, on its network; a venue by its name on the page
function paymentWordsOf(p, page) {
  const nameOf = id => str(records(page?.venues).find(v => v.id === id)?.name) || str(id);
  const legs = records(p.legs);
  if (p.kind === 'swap') return t('trade.payment.swap', { venue: nameOf(p.from), from: str(p.sourceToken), to: str(p.token) });
  if (p.kind === 'transfer' && p.from === p.to) return t('trade.payment.transfer', { venue: nameOf(p.from), from: str(legs[0]?.fromLedger), to: str(legs[0]?.toLedger) });
  const kind = paymentKindWord(str(p.kind));
  const network = str(p.live?.network);
  return `${kind} · ${nameOf(p.from)} → ${nameOf(p.to)}${network ? ` · ${network}` : ''}`; // words-order: a payment's kind, route and network under the visual separator
}
// a payment's kind, the Account's code worded; a code with no word as it came, none a payment
function paymentKindWord(kind) {
  switch (kind) {
    case 'deposit': return t('trade.paymentKind.deposit');
    case 'withdraw': return t('trade.paymentKind.withdraw');
    case 'transfer': return t('trade.paymentKind.transfer');
    case 'send': return t('trade.paymentKind.send');
    case 'swap': return t('trade.paymentKind.swap');
    case 'pay': return t('trade.paymentKind.pay');
    case 'refill': return t('trade.paymentKind.refill');
    case '': return t('trade.payment.kind');
    default: return kind;
  }
}

/** Under way: the page's working orders (openOrdersOf's rows, by anyone), each with what cancels it — the Account's
 *  `liveCancel` seed, `{ venue, order }`, or null for an order with no id or venue (one the Account knows by its client id
 *  alone: nothing to cancel it by) — and `walletSend`: `{ order: id }` for a DEX order waiting for the operator's wallet to send
 *  it (`walletTxs`, no `ref`; it keeps its own Cancel, which takes it back before the wallet sends it and frees its limit, as the
 *  the retired page's row does: trade.js tkOpenActs), its `walletKey` the order's client id and `walletReported` whether the Account
 *  already holds a hash for it (`reported`); else null. Then the page's payments waiting for the wallet
 *  (`legs[0].native.walletTx`, `authorized`), each `{ payment: id, words, key, walletReported }` — `key` its `<id>@<at>`,
 *  `walletReported` its `live.reported`. */
export function underWayOf(page) {
  const raw = pageOk(page) ? records(page.orders) : [];
  const orders = openOrdersOf(page).map(o => {
    const waits = o.waitingForWallet === true && o.id !== '';
    const at = waits ? raw.find(x => x.id === o.id) : undefined;
    return {
      ...o,
      cancel: o.id && o.venue ? { venue: o.venue, order: o.id } : null,
      walletSend: waits ? { order: o.id } : null,
      walletKey: waits ? str(at?.clientId) || null : null,
      walletReported: waits ? str(at?.reported) !== '' : false,
    };
  });
  const payments = (pageOk(page) ? records(page.payments) : [])
    .filter(p => p.status === 'authorized' && str(p.id) !== '' && isRecord(records(p.legs)[0]?.native?.walletTx))
    .map(p => ({ payment: p.id, words: paymentWordsOf(p, page), key: `${p.id}@${str(p.at)}`, walletReported: str(p.live?.reported) !== '' }));
  return [...orders, ...payments];
}

// a fill's price as the Account's toast groups it: 3,120.50, 0.12143
const fillPrice = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });

/** A `fill` frame on the Account's stream (`{ type: 'fill', data }`, or its data alone) as one line, kept as a said: `Bought
 *  0.04 ETH @ 3,120.50 · Stand-in Exchange` — the side, this fill's size (none drawn unless it is above zero) and the market's
 *  base (a prediction's contracts of its name), its price (a prediction's in cents) where the frame says one, with the
 *  Account's ` avg` when that price is the order's average, the venue, and `· Paper account` from a paper book — once: not
 *  where the venue's name already says paper. Anything else: ''. */
export function fillWords(ev) {
  if (!isRecord(ev)) return '';
  if (typeof ev.type === 'string' && ev.type !== 'fill') return '';
  const f = isRecord(ev.data) ? ev.data : ev;
  const side = f.side === 'buy' ? said('trade.fill.bought') : f.side === 'sell' ? said('trade.fill.sold') : '';
  if (!side) return '';
  const qty = number(f.qty);
  const size = qty !== null && qty > 0 ? amountWord(qty) : '';
  const event = f.kind === 'event';
  const name = str(f.name) || str(f.symbol);
  const contracts = size ? said('trade.contracts', { n: size }) : said('trade.contractsAny');
  const what = event ? (name ? said('trade.fill.contractsOf', { contracts, name }) : contracts)
    : [size, str(f.symbol).split('/')[0]].filter(Boolean).join(' ');
  const did = what ? said('trade.fill.did', { side, what }) : side;
  const p = number(f.price);
  const priced = p === null ? null : { line: did, price: event ? centsWord(cents(p)) : fillPrice(p) };
  const at = priced === null ? did : f.avg === true ? said('trade.fill.atAvg', priced) : said('trade.fill.at', priced);
  const venue = str(f.venueName) || str(f.venue);
  const where = venue ? said('trade.fill.venue', { line: at, venue }) : at;
  return f.paper === true && !/\bpaper\b/i.test(venue) ? said('trade.fill.onPaper', { line: where, paper: said('trade.fill.paper') }) : where;
}
