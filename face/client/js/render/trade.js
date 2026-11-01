// face/client/js/render/trade.js — Trade on the face (spec 2026-10-22 §6.4, plan 2 Task 11), after gravit-ui's Trade (itself
// after Linqi's buyer-agent-demo ui/trade.js): the head with the Account's own writes chip, the kinds (the Account's tabs), the
// picker — what is held, starred and most traded of the kind, or a search's results — Under way with its one-click Cancel (and
// Change…, the Account's liveAmend sheet, where the venue changes the order in place) and
// the cards waiting (Review → to Cards), and the ticket: Where (the able lines as keys, the best marked, a public listing
// leading to Venues), Buy or Sell, the amount and its unit, Market or Limit, extended hours on a limit where the picked line
// offers them, the Account's quote, the signature's minutes, What you sign verbatim, what the Account said, and Sign and place
// — on only while the shown preparation is the form's (render/owner.js's rule). A page that does not sign reads: the picker
// and Under way, its device line where the form would be, no Sign and no Cancel. Every figure and word is a view's (host/trade-view.js, host/owner-view.js,
// host/account-view.js) or the Account's; this module puts a figure in its unit's words and draws them.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { fmtDate } from '../time.js';
import { money } from '../wire/account-model.js';
import { pageOk, headOf, cardsOf } from '../host/account-view.js';
import { TRADE_KINDS, pickerOf, ticketOf, quoteOf, underWayOf } from '../host/trade-view.js';
import { standingWords, whatYouSignLines, goodForWords } from '../host/owner-view.js';
import { goWord } from '../host/sheet-view.js';
import { askedOf } from '../host/sheet.js';
import { chip } from './thread.js';
import { mkAv, priceWord } from './markets.js';
import { orderWords, cardFactsOf, marketKeysOn, changeKey } from './account.js';

// the kinds' glyphs, Linqi's sprite
const KIND_ICONS = { crypto: 'coin', stocks: 'stock', rwas: 'rwa', predictions: 'prediction' };
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');
const empty = text => `<p class="mk-empty">${esc(text)}</p>`;
const note = text => `<p class="acct-note">${esc(text)}</p>`;
const path = text => `<div class="tk-path">${esc(text)}</div>`;
const tag = (text, tone = '') => `<span class="${cls('mk-tag', tone)}">${esc(text)}</span>`;
const group = (title, rows) => (rows.length ? `<div class="tk-pg"><div class="tk-pg-h">${esc(title)}</div><ul class="tk-list">${rows.join('')}</ul></div>` : '');
const kindOf = id => TRADE_KINDS.find(k => k.id === id) ?? TRADE_KINDS[0];

// ── the kinds and the picker ──

function kindsHtml(kind) {
  return `<div class="seg tk-seg" role="group" aria-label="Market kind">${TRADE_KINDS.map(k => `<button type="button"${attrs({
    class: cls('seg-item', k.id === kind && 'pressed'), 'aria-pressed': k.id === kind ? 'true' : 'false', 'data-action': 'tradeKind', 'data-value': k.id,
  })}>${icon(KIND_ICONS[k.id], 16, 2)}${esc(k.label)}</button>`).join('')}</div>`;
}

// a picker row: the market, where it trades or what is held of it, its price; a held prediction hands on its side, venue and
// outcome, a coin or a stock held its venue
const pickRow = (r, on) => `<li><button type="button"${attrs({
  class: cls('tk-row', on && 'on'), 'aria-current': on ? 'true' : null, 'data-action': 'pickMarket', 'data-id': r.id,
  'data-side': r.side ?? null, 'data-venue': r.venue ?? null, 'data-outcome': Number.isInteger(r.outcome) ? String(r.outcome) : null,
})}>${mkAv(r.name, 'sm')}<span class="tk-rn"><b>${esc(r.name)}</b><span class="mk-sub">${esc(r.sub)}</span></span>` +
  `<span class="tk-rp"><span class="num">${esc(r.priceWord)}</span></span></button></li>`;

// where the rows would be when there are none, from the read they are from
function searchWord(read, q, kind) {
  if (read?.status === 'error') return str(read.message) || 'Search is unavailable';
  if (read?.status === 'ready') return `Nothing matches “${q}” under ${kind.label}.`;
  return 'Searching…';
}
function picksWord(read) {
  if (read?.status === 'error') return str(read.message) || 'Markets unavailable';
  return read?.status === 'ready' ? 'No markets' : 'Loading…';
}

function picker(state, now) {
  const t = state.trade;
  const kind = kindOf(t.kind);
  const p = pickerOf(state, now);
  // the market whose ticket is open is marked once, on the first row that names it
  let open = t.ticket?.id ?? null;
  const row = r => { const on = r.id === open; if (on) open = null; return pickRow(r, on); };
  const q = str(t.q).trim();
  let body;
  if (q) {
    body = p.results.length ? group(`Results for “${q}”`, p.results.map(row)) : empty(searchWord(t.results, q, kind));
  } else {
    const read = isRecord(t.picks) && Object.hasOwn(t.picks, kind.id) ? t.picks[kind.id] : null;
    const groups = group('You hold', p.held.map(row)) + group('Watching', p.watching.map(row)) + group('Most traded', p.most.map(row));
    // a picks read that failed after an answer keeps its rows, with the Account's sentence over them
    const said = groups && read?.status === 'error' && str(read.message) ? note(read.message) : '';
    body = groups ? said + groups : empty(picksWord(read));
  }
  return `<section class="cardbox tk-pick"><div class="tk-pick-head"><h2 class="tk-h2">${esc(kind.label)}</h2><div class="tk-pfind">${icon('search', 16, 2)}` +
    `<label for="tq" class="sr-only">Search ${esc(kind.label)}</label><input${attrs({ id: 'tq', type: 'search', autocomplete: 'off', placeholder: `Search ${kind.label}`, 'data-action': 'tradeQuery', value: str(t.q) })}></div></div>${body}</section>`;
}

// ── Under way ──

// the cards waiting on the owner (the page's cards — Gravit's seat writes among them), each in the Cards tab's words with
// Review → to Cards, where it is answered: rows only, no key signs here (spec 2026-10-22 §6.4); none, nothing
function cardsWaiting(page, now) {
  const rows = cardsOf(page).flatMap(g => g.cards).map(c => `<tr><td>${esc([c.reason, cardFactsOf(c, now)].filter(Boolean).join(' · '))}</td>` +
    '<td class="r"><a class="btn-sm" href="#/account/cards">Review →</a></td></tr>');
  if (!rows.length) return '';
  return `<div class="tk-pg"><div class="tk-pg-h">Cards waiting</div><div class="mk-wrap"><table class="mk-t tk-t"><thead><tr><th scope="col">Card</th>` +
    `<th scope="col" class="r"><span class="sr-only">Review</span></th></tr></thead><tbody>${rows.join('')}</tbody></table></div></div>`;
}

// a row waiting for the operator's own browser wallet (a DEX order, a payment the Account built): Waiting for your wallet, what
// the last send said (host/wallet-send.js, by its key), and — on a page that signs — Send from wallet…, or Report again where a
// hash was sent: one this page keeps (it reports that hash), or one the Account already holds (the send asks the Account
// again and reports it); neither ever sends again; disabled while one is in the air. An order keeps its Cancel beside it
export function walletRow(what, id, key, data, reported, sends, signs, cancel) {
  const at = key && isRecord(sends) && isRecord(sends[key]) ? sends[key] : null;
  const said = at && str(at.said) ? `<span class="tk-why">${esc(at.said)}</span>` : '';
  const sending = at?.status === 'sending';
  const keyOf = !signs ? '' : at?.again === true
    ? `<button type="button"${attrs({ class: 'btn-sm', 'data-action': 'reportAgain', 'data-key': key, disabled: sending })}>Report again</button>`
    : `<button type="button"${attrs({ class: 'btn-sm', 'data-action': 'sendFromWallet', ...data, disabled: sending })}>${reported ? 'Report again' : 'Send from wallet…'}</button>`;
  return `<tr><td><b>${esc(what)}</b><span class="tk-why">${esc(['Waiting for your wallet', id].filter(Boolean).join(' · '))}</span>${said}</td><td class="r">${keyOf}${cancel}</td></tr>`;
}

// the page's working orders, by anyone, in the Account screen's words; Cancel where the Account knows what cancels it, on a
// page that signs; Change… where its venue changes it in place, on a page that signs for an Account that takes writes; what was said on Trade (a cancel's answer, a fill) over them; the cards waiting under them
function underWay(state, signs, now) {
  const a = state.account;
  const said = str(state.trade.said) ? `<p class="tk-said" role="status">${esc(state.trade.said)}</p>` : '';
  const head = n => `<div class="tk-pick-head"><h2 class="tk-h2">Under way</h2>${n === null ? '' : `<span class="dim">${n}</span>`}</div>`;
  if (!pageOk(a?.data)) {
    return `<section class="cardbox tk-open">${head(null)}${said}${empty(a?.data ? 'Account unreadable' : a?.status === 'error' ? 'Account unavailable' : 'Loading…')}</section>`;
  }
  const change = marketKeysOn(state);
  const rows = underWayOf(a.data).map(o => {
    const cancel = signs && o.cancel ? `<button type="button"${attrs({ class: 'btn-sm', 'data-action': 'cancelOrder', 'data-venue': o.cancel.venue, 'data-order': o.cancel.order })}>Cancel</button>` : '';
    if (o.payment) return walletRow(o.words, o.payment, o.key, { 'data-payment': o.payment }, o.walletReported, a.wallet, signs, '');
    if (o.walletSend) return walletRow(orderWords(o), o.id, o.walletKey, { 'data-order': o.walletSend.order }, o.walletReported, a.wallet, signs, cancel);
    return `<tr><td><b>${esc(orderWords(o))}</b>${o.id ? `<span class="tk-why">${esc(o.id)}</span>` : ''}</td><td class="r">${change ? changeKey(o, a.data) : ''}${cancel}</td></tr>`;
  });
  const table = `<div class="mk-wrap"><table class="mk-t tk-t"><thead><tr><th scope="col">Order</th><th scope="col" class="r"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  return `<section class="cardbox tk-open">${head(rows.length)}${said}${rows.length ? table : empty('Nothing under way.')}${cardsWaiting(a.data, now)}</section>`;
}

// ── the ticket ──

// a field of the order sheet's form: the plain form the trade host keeps, or the sheet-view's field list
function fieldOf(fields, name) {
  if (Array.isArray(fields)) return fields.find(f => isRecord(f) && f.name === name)?.value;
  return isRecord(fields) ? fields[name] : undefined;
}
const textOf = v => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

const textBox = (id, name, label, value, placeholder = null) => `<label class="field"><span class="field-label">${esc(label)}</span><input${attrs({
  id, class: 'input tk-input', type: 'text', name, value, placeholder, inputmode: 'decimal', autocomplete: 'off', 'data-action': 'ticketField',
})}></label>`;
const selectBox = (id, name, label, options, value) => `<label class="field"><span class="field-label">${esc(label)}</span><select${attrs({ id, class: 'input tk-input', name, 'data-action': 'ticketField' })}>` +
  `${options.map(([v, l]) => `<option${attrs({ value: v, selected: v === value })}>${esc(l)}</option>`).join('')}</select></label>`;

// the quote box: what is missing, asking, or the Account's quote of the shown preparation — its words, about what it costs, up
// to what if the price moves, its fee (none given: the venue charges it as it does), dimmed with What you sign while the form is
// not the draft it was asked for; a refusal is the muted line, not here
function quoteBox(s, venueName, stale) {
  let inner = '';
  if (!s || s.status === 'incomplete') inner = path(str(s?.words) || 'Fill it in to see what it would be.');
  else if (s.status === 'asking') inner = path('Asking…');
  else if (s.status !== 'refused' && s.prepared) {
    const q = quoteOf(s.prepared);
    if (q) {
      inner = `<div class="tk-big"><span>${esc(q.words)}${q.paper ? ` ${tag('Paper')}` : ''}</span>${q.notionalUsd !== null ? `<span>≈ ${esc(money(q.notionalUsd))}</span>` : ''}</div>` +
        `${q.maxUsd !== null ? path(`up to ${money(q.maxUsd)} if the price moves`) : ''}` +
        path(q.feeUsd === null ? `fee as ${venueName || 'the venue'} charges it` : `fee ${money(q.feeUsd)}`);
    } else if (str(s.prepared.quote?.words)) inner = path(s.prepared.quote.words);
  }
  return inner ? `<div class="${cls('tk-quote', stale && 'stale')}">${inner}</div>` : '';
}

// Where: the able lines as keys, the one the form is at pressed, the best and the paper marked; the other lines dim, a public
// listing leading to Venues to connect
function whereHtml(t, venue) {
  const unit = t.page.priced.unit;
  const rows = t.legs.map(l => {
    const name = `<b>${esc(l.venueName || l.venue)}</b>`;
    const px = esc(priceWord(l.price, unit));
    if (l.able) {
      return `<button type="button"${attrs({ class: 'tk-at', 'data-action': 'ticketVenue', 'data-venue': l.venue, 'aria-pressed': l.venue === venue ? 'true' : 'false' })}>` +
        `<span>${name}${l.best ? tag('Best', 'up') : ''}${l.paper ? tag('Paper') : ''}</span><span class="tk-at-r">${px}</span></button>`;
    }
    return `<div class="tk-at pub"><span>${name}${l.public ? tag('Public') : ''}${l.paper ? tag('Paper') : ''}</span>` +
      `<span class="tk-at-r">${px}${l.public ? '<a class="link" href="#/account/venues">Connect to trade</a>' : ''}</span></div>`;
  });
  return rows.length ? `<div class="tk-where-w"><div class="dsec-label">Where</div><div class="tk-where">${rows.join('')}</div></div>` : '';
}

function ticketPanel(state, now) {
  const t = ticketOf(state, now);
  if (!t) return `<div class="tk-h"><div class="tk-h-l"><span class="mk-tag tk-ktag">${esc(kindOf(state.trade.kind).label)}</span><h2 class="tk-title">Pick a market</h2></div></div>`;
  const s = state.sheet?.kind === 'order' ? state.sheet : null;
  const given = name => fieldOf(s?.fields, name);
  const side = given('side') === 'sell' ? 'sell' : given('side') === 'buy' ? 'buy' : t.side;
  const picked = Number(textOf(given('outcome')) || t.outcome);
  const outcome = Number.isInteger(picked) && picked >= 0 && picked < t.outcomes.length ? picked : 0;
  const venue = textOf(Array.isArray(given('venue')) ? given('venue')[0] : given('venue')) || t.venue || '';
  const leg = t.legs.find(l => l.able && l.venue === venue);
  const what = t.event ? t.outcomes[outcome]?.label || t.page.name : str(t.item.base) || t.page.name;

  const head = `<div class="tk-h"><div class="tk-h-l"><h2 class="tk-title">${esc(`${side === 'sell' ? 'Sell' : 'Buy'} ${what}`)}</h2></div>` +
    '<button type="button" class="close-key" data-action="closeTicket" aria-label="Close the ticket">×</button></div>';
  const closes = t.page.closesAt ? `closes ${fmtDate(Date.parse(t.page.closesAt))}` : '';
  const pickedHtml = `<div class="tk-picked">${mkAv(t.page.tile, 'sm')}<span class="tk-rn"><b>${esc(t.page.name)}</b><span class="mk-sub">${esc([...t.page.sub, closes].filter(Boolean).join(' · '))}</span></span>` +
    `${t.event ? '' : `<span class="tk-rp"><span class="num">${esc(priceWord(t.page.price, t.page.priced.unit))}</span></span>`}</div>`;
  const hand = `<button type="button"${attrs({ class: 'btn tk-hand', 'data-action': 'handToGravit', 'data-id': t.id })}>${icon('agent', 18, 2)}Hand to Gravit instead</button>`;

  // a page that does not sign: its device line where the form would be
  if (state.owner?.role !== 'signs') {
    const line = standingWords(state.owner).line;
    return `${head}<div class="tk-stack">${pickedHtml}${line ? note(line) : ''}</div>${hand}`;
  }

  const outs = t.event ? `<div class="tk-out">${t.outcomes.map((o, i) => `<button type="button"${attrs({
    class: cls(i ? 'mk-no' : 'mk-yes', i === outcome && 'pressed'), 'aria-pressed': i === outcome ? 'true' : 'false', 'data-action': 'ticketOutcome', 'data-value': String(i),
  })}>${esc(`${o.label} ${priceWord(o.cents, 'cents')}`)}</button>`).join('')}</div>` : '';
  const sideHtml = `<div class="seg tk-side" role="group" aria-label="Buy or sell">${[['buy', 'Buy'], ['sell', 'Sell']].map(([v, word]) => `<button type="button"${attrs({
    class: cls('seg-item', side === v && 'pressed'), 'aria-pressed': side === v ? 'true' : 'false', 'data-action': 'ticketSide', 'data-value': v,
  })}>${word}</button>`).join('')}</div>`;
  const orderType = given('orderType') === 'limit' ? 'limit' : 'market';
  const amount = `<div class="tk-row2">${textBox('tk-amount', 'amount', 'Amount', textOf(given('amount')), '25')}` +
    `${selectBox('tk-unit', 'unit', 'In', [['usd', 'Dollars'], ['qty', t.unitWord || 'Units']], given('unit') === 'qty' ? 'qty' : 'usd')}</div>`;
  const limit = orderType === 'limit' ? textBox('tk-limit', 'limit', t.event ? 'Limit, in cents' : 'Limit price', textOf(given('limit'))) : '';
  const order = `<div class="tk-row2">${selectBox('tk-type', 'orderType', 'Order', [['market', 'Market'], ['limit', 'Limit']], orderType)}${limit}</div>`;
  // extended hours ride a limit order alone, where the picked line offers them
  const ticked = given('extendedHours') === true || given('extendedHours') === 'true';
  const extended = orderType === 'limit' && leg?.session?.extendedHours === true
    ? `<label class="sheet-check"><input${attrs({ type: 'checkbox', name: 'extendedHours', value: 'true', checked: ticked, 'data-action': 'ticketField' })}>Extended hours</label>` : '';

  // the go key on only while the sheet is ready and the form's draft is the one the shown preparation was asked for
  const current = Boolean(s) && s.asked !== null && askedOf(s) === s.asked;
  const live = s?.status === 'ready' && current;
  // the shown preparation is not the form's: its quote and What you sign dimmed until the new one lands
  const stale = s?.status === 'ready' && !current;
  const left = s && s.deadline !== null && (s.status === 'ready' || s.status === 'signing') ? goodForWords(s.deadline - now) : '';
  const lines = s?.prepared ? whatYouSignLines(s.prepared) : [];
  const signs = lines.length
    ? `<details${attrs({ id: 'tk-signs', class: cls('acct-shown', stale && 'stale') })}><summary data-action="toggleSigns">What you sign</summary>${lines.map(l => `<div class="dsec-line">${esc(l)}</div>`).join('')}</details>`
    : '';
  const said = s?.status === 'refused' ? s.message : s?.status === 'done' ? str(s.said) : s?.status === 'signing' ? 'Placing it…' : '';
  const again = s?.status === 'refused' && s.again ? '<div class="btn-row"><button type="button" class="btn-sm" data-action="sheetAgain">Prepare again</button></div>' : '';
  const go = `<button${attrs({ type: 'submit', class: 'btn-primary tk-go', disabled: !live })}>${esc(goWord('order'))}</button>`;
  return `${head}<form class="tk-form" data-action="placeOrder" novalidate autocomplete="off">${pickedHtml}${outs}${whereHtml(t, venue)}` +
    `<div class="tk-stack">${sideHtml}${amount}${order}${extended}${quoteBox(s, leg?.venueName || leg?.venue, stale)}${left ? `<p class="tk-left">${esc(left)}</p>` : ''}${signs}` +
    `${said ? `<p class="tk-msg" role="status">${esc(said)}</p>` : ''}${again}${go}</div>${hand}</form>`;
}

/** The Trade screen: the head with the Account's writes chip, the kinds, the picker and Under way, and the ticket panel. */
export function renderTradeScreen(state, now) {
  const writes = headOf(state.account?.data).writes;
  const signs = state.owner?.role === 'signs';
  return `<main class="main trade"><div class="tp"><div class="tp-cols"><div class="tp-main"><div class="tp-head"><h1 class="head-title">Trade</h1>${writes ? chip(writes) : ''}</div>` +
    `${kindsHtml(kindOf(state.trade.kind).id)}${picker(state, now)}${underWay(state, signs, now)}</div><aside class="tk-panel" aria-label="Order ticket">${ticketPanel(state, now)}</aside></div></div></main>`;
}
